import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { accountabilityOf } from '../src/server/platform/accountability/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.05: the RACI of a scope, the gap check, the action ledger and the scores.
// T-01 the gap check flags a process without an Accountable person; T-02 the ledger receives entries from workflow approvals and module events.
const A = '/api/v1/acc';
const W = '/api/v1/workflow';
const E = '/api/v1/eng';
const json = { 'content-type': 'application/json' };
const key = (k = 'a') => ({ ...json, 'idempotency-key': `ac-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const pm2 = as('PM', 'pm2');
const aud = as('AUD', 'aud1');
const sk = as('SK', 'sk1');
const hr = as('HRMGR', 'hr1');
const PEOPLE = { PM: 'pm1', PD: 'pd1', STOREMGR: 'store1', CFO: 'cfo1', COMMGR: 'com1', HRMGR: 'hr1' };

const setup = async (status = 'DRAFT') => {
  const api = await startApi();
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', ?, 't', 'test')").run(status).lastInsertRowid);
  return { api, project };
};
const gaps = async (api, who, q = '') => (await api.call('GET', `${A}/raci/gaps${q}`, who)).json.data;
const apply = (api, who, body) => api.call('POST', `${A}/raci/apply-template`, { ...who, headers: key('t'), body: { scopeType: 'PROJECT', reason: 'Standard set for the project', people: PEOPLE, ...body } });
const tasks = async (api, who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
const decide = async (api, who, instanceId, action = 'approve') => {
  const t = (await tasks(api, who)).find((x) => x.instance.id === instanceId);
  assert.ok(t, `a task for ${who.user}`);
  const r = await api.call('POST', `${W}/tasks/${t.id}/act`, { ...who, headers: key('d'), body: { action, comment: action === 'approve' ? 'ok' : 'No, this is not right at all' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const ledger = async (api, who, q = '') => (await api.call('GET', `${A}/ledger${q}`, who));

test('T-01 FR-06 BR-01 the gap check flags every process without an Accountable person; a template names one; the company can answer for all projects; a second Accountable is refused', async () => {
  const { api, project } = await setup();
  let g = await gaps(api, hr);
  assert.equal(g.summary.projects, 1);
  assert.equal(g.summary.gaps, 15, 'every process of the list has nobody accountable');
  assert.ok(g.rows.every((r) => r.status === 'GAP' && r.projectId === project));
  // the template needs a person for each accountable role
  let r = await apply(api, hr, { scopeId: project, people: { PM: 'pm1' } });
  assert.equal(r.status, 400);
  assert.ok(r.json.error.details.some((d) => d.field === 'people.CFO'));
  // a project that is not live takes the change at once
  r = await apply(api, hr, { scopeId: project, processCodes: ['PO_ISSUE', 'PR_RAISE'], people: PEOPLE });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.applied, true);
  g = await gaps(api, hr);
  assert.equal(g.summary.gaps, 13);
  assert.ok(!g.rows.some((x) => x.processCode === 'PO_ISSUE'));
  // the company answers for the rest
  r = await api.call('POST', `${A}/raci/changes`, { ...hr, headers: key('c'), body: { scopeType: 'COMPANY', reason: 'The company default owners', processes: [{ processCode: 'DPR_SUBMIT', assignments: [{ user: 'pm9', raci: 'A' }, { role: 'SE', raci: 'R' }] }] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await gaps(api, hr)).summary.gaps, 12, 'the company default counts for the project');
  const resolved = (await api.call('GET', `${A}/raci/resolve?processCode=DPR_SUBMIT&projectId=${project}`, hr)).json.data;
  assert.deepEqual([resolved.accountable, resolved.scope.type], ['pm9', 'COMPANY']);
  const own = (await api.call('GET', `${A}/raci/resolve?processCode=PO_ISSUE&projectId=${project}`, hr)).json.data;
  assert.deepEqual([own.accountable, own.scope.type], ['pm1', 'PROJECT']);
  assert.deepEqual(own.responsible, [{ role: 'PROCMGR' }]);
  // BR-01: exactly one Accountable, a person
  const bad = (assignments) => api.call('POST', `${A}/raci/changes`, { ...hr, headers: key('b'), body: { scopeType: 'PROJECT', scopeId: project, reason: 'A try that must fail', processes: [{ processCode: 'GRN', assignments }] } });
  assert.equal((await bad([{ user: 'a1', raci: 'A' }, { user: 'a2', raci: 'A' }])).status, 400);
  assert.equal((await bad([{ user: 'a1', raci: 'R' }])).status, 400);
  assert.equal((await bad([{ role: 'PM', raci: 'A' }])).status, 400);
  assert.equal((await bad([{ user: 'a1', raci: 'A' }, { role: 'NOT_A_ROLE', raci: 'R' }])).status, 400);
  // many Responsible are fine, and a second change replaces the first from its date
  r = await api.call('POST', `${A}/raci/changes`, { ...hr, headers: key('b'), body: { scopeType: 'PROJECT', scopeId: project, reason: 'Two engineers are responsible', processes: [{ processCode: 'PO_ISSUE', assignments: [{ user: 'pm3', raci: 'A' }, { user: 'eng1', raci: 'R' }, { user: 'eng2', raci: 'R' }] }] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const grid = (await api.call('GET', `${A}/raci?scopeType=PROJECT&scopeId=${project}`, hr)).json.data;
  const po = grid.processes.find((p) => p.code === 'PO_ISSUE');
  assert.deepEqual(po.assignments.map((x) => `${x.user}:${x.raci}`).sort(), ['eng1:R', 'eng2:R', 'pm3:A']);
  assert.equal(po.accountable, 'pm3');
  assert.equal((await api.call('POST', `${A}/raci/changes`, { ...hr, headers: key('b'), body: { scopeType: 'PROJECT', scopeId: project, reason: 'The same again', processes: [{ processCode: 'PO_ISSUE', assignments: [{ user: 'pm3', raci: 'A' }, { user: 'eng1', raci: 'R' }, { user: 'eng2', raci: 'R' }] }] } })).status, 422, 'nothing changed');
  // a fault of the data (two Accountable rows) is named
  api.db.prepare("INSERT INTO acc_raci_assignments (company_id, scope_type, scope_id, process_code, user_id, raci, status, effective_from, batch_id, created_by, source_type) VALUES (1, 'PROJECT', ?, 'PO_ISSUE', 'intruder', 'A', 'ACTIVE', '2026-01-01', 999, 't', 'test')").run(project);
  g = await gaps(api, hr);
  assert.ok(g.rows.some((x) => x.processCode === 'PO_ISSUE' && x.status === 'MULTIPLE'));
  // history keeps the earlier answer
  const hist = (await api.call('GET', `${A}/raci/history?scopeType=PROJECT&scopeId=${project}&processCode=PO_ISSUE`, hr)).json.data;
  assert.ok(hist.some((h) => h.user === 'pm1' && h.status === 'RETIRED') || hist.some((h) => h.user === 'pm1'));
  await api.close();
});

test('FR-01 AC-04 a change to the RACI of a live project is approved by the project manager and then the project director; it cannot be sidestepped', async () => {
  const { api, project } = await setup('ACTIVE');
  const body = { scopeType: 'PROJECT', scopeId: project, reason: 'The project manager changes', processes: [{ processCode: 'DPR_SUBMIT', assignments: [{ user: 'pm1', raci: 'A' }, { role: 'SE', raci: 'R' }] }] };
  assert.equal((await api.call('POST', `${A}/raci/changes`, { ...sk, headers: key('x'), body })).status, 403);
  let r = await api.call('POST', `${A}/raci/changes`, { ...pm, headers: key('x'), body });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.data.applied, false);
  const inst = r.json.data.workflow.id;
  assert.deepEqual(r.json.data.workflow.steps.map((s) => s.code), ['L1', 'L2'], 'the matrix names the chain (project manager, then project director)');
  assert.equal(api.db.prepare("SELECT status FROM acc_raci_assignments WHERE batch_id = ? LIMIT 1").get(r.json.data.batchId).status, 'PENDING');
  assert.equal((await gaps(api, hr)).summary.gaps, 15, 'a pending change answers nothing yet');
  assert.equal((await api.call('POST', `${A}/raci/changes`, { ...pm, headers: key('x'), body: { ...body, reason: 'A second one meanwhile' } })).status, 409);
  assert.equal((await tasks(api, pm)).filter((t) => t.instance.id === inst).length, 0, 'the proposer does not approve their own change');
  await decide(api, pm2, inst);
  await decide(api, pd, inst);
  assert.equal(api.db.prepare("SELECT status FROM acc_raci_assignments WHERE batch_id = ? LIMIT 1").get(r.json.data.batchId).status, 'ACTIVE');
  assert.equal((await gaps(api, hr)).summary.gaps, 14);
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'acc.raci.changed'").get());
  // a rejection leaves what was in force
  r = await api.call('POST', `${A}/raci/changes`, { ...pm, headers: key('y'), body: { ...body, reason: 'Another try', processes: [{ processCode: 'DPR_SUBMIT', assignments: [{ user: 'pm7', raci: 'A' }, { role: 'SE', raci: 'R' }] }] } });
  assert.equal(r.status, 202);
  await decide(api, pm2, r.json.data.workflow.id, 'reject');
  assert.equal(api.db.prepare("SELECT status FROM acc_raci_assignments WHERE batch_id = ? LIMIT 1").get(r.json.data.batchId).status, 'REJECTED');
  assert.equal((await api.call('GET', `${A}/raci/resolve?processCode=DPR_SUBMIT&projectId=${project}`, hr)).json.data.accountable, 'pm1');
  // another company sees nothing of it
  assert.equal((await api.call('GET', `${A}/raci?scopeType=PROJECT&scopeId=${project}`, as('PM', 'pmx', '2'))).status, 404);
  await api.close();
});

test('T-02 FR-03 FR-04 FR-05 the ledger receives entries from the workflow, from module events and from the audit trail, once each, and cannot be changed; scores and My Accountability are built from it', async () => {
  const { api, project } = await setup();
  assert.equal((await apply(api, hr, { scopeId: project })).status, 200);
  const make = async (title, amount = '12000.00') => (await api.call('POST', `${E}/sample-docs`, { ...pd, headers: key('m'), body: { title, amount, projectId: project } })).json.data;
  const submit = async (d) => (await api.call('POST', `${E}/sample-docs/${d.id}/submit`, { ...pd, headers: key('s'), body: {} })).json.data.workflow;
  const d1 = await make('Cement');
  const w1 = await submit(d1);
  await decide(api, pm, w1.id);
  const d2 = await make('Steel');
  const w2 = await submit(d2);
  await decide(api, pm, w2.id, 'return');
  const d3 = await make('Sand');
  const w3 = await submit(d3);
  await decide(api, pm, w3.id, 'reject');
  let l = (await ledger(api, aud, '?limit=100')).json.data;
  const of = (a, ref) => l.rows.filter((x) => x.action === a && x.entityRef === ref);
  assert.equal(of('created', d1.docNo).length, 1, 'from the audit trail of the document');
  assert.equal(of('submitted', d1.docNo).length, 1, 'from the workflow');
  const approved = of('approved', d1.docNo)[0];
  assert.deepEqual([approved.actor, approved.role, approved.outcome, approved.onTime, approved.process], ['pm1', 'PM', 'APPROVED', true, 'SAMPLE_DOC']);
  assert.ok(approved.dueAt);
  const returned = of('rejected', d2.docNo)[0];
  assert.deepEqual([returned.outcome, returned.affectedUser], ['RETURNED', 'pd1']);
  assert.equal(of('rejected', d3.docNo)[0].outcome, 'REJECTED');
  assert.equal(l.rows.find((x) => x.entityRef === d1.docNo).projectId, project);
  // once each: a second reading writes nothing, and the entries cannot be changed
  assert.equal(accountabilityOf(api.db).sync(), 0);
  assert.throws(() => api.db.prepare("UPDATE acc_action_ledger SET outcome = 'X'").run(), /cannot be changed/);
  assert.throws(() => api.db.prepare('DELETE FROM acc_action_ledger').run(), /cannot be removed/);
  // a module can write an entry itself, once
  const direct = { companyId: 1, actor: 'store1', roleCode: 'STOREMGR', action: 'reconciled', entity: 'MATERIAL_RECON', entityId: '2026-10', projectId: project, onTime: false, dueAt: '2026-11-01T00:00:00.000Z' };
  assert.equal(accountabilityOf(api.db).record(direct, { type: 'module', id: 'recon-1' }), true);
  assert.equal(accountabilityOf(api.db).record(direct, { type: 'module', id: 'recon-1' }), false);
  // who sees what
  assert.equal((await ledger(api, sk, '')).json.data.total, 0, 'a store keeper sees only their own actions');
  assert.equal((await ledger(api, sk, '?user=pm1')).status, 403);
  assert.equal((await ledger(api, pm, '?user=pm1')).json.data.total >= 3, true);
  assert.equal((await ledger(api, aud, `?user=pm1&action=approved&project=${project}`)).json.data.total, 1);
  // the scores
  const s = (await api.call('GET', `${A}/scores?by=person`, aud)).json.data;
  const pmRow = s.rows.find((x) => x.key === 'pm1');
  assert.deepEqual([pmRow.onTime, pmRow.late, pmRow.onTimePct], [3, 0, 100]);
  const pdRow = s.rows.find((x) => x.key === 'pd1');
  assert.deepEqual([pdRow.returnsReceived, pdRow.rejectsReceived], [1, 1]);
  assert.ok(pdRow.score < 100 && s.note.includes('never'), 'the score is an input to a review');
  assert.equal(s.rows.find((x) => x.key === 'store1').late, 1);
  assert.equal((await api.call('GET', `${A}/scores?by=role`, aud)).json.data.rows.find((x) => x.key === 'PM').onTime, 3);
  assert.equal((await api.call('GET', `${A}/scores?by=project`, aud)).json.data.rows[0].label.startsWith('P1'), true);
  assert.equal((await api.call('GET', `${A}/scores`, sk)).status, 403);
  assert.equal((await api.raw('GET', `${A}/scores/export?format=csv`, aud)).status, 200);
  // My Accountability
  const mine = (await api.call('GET', `${A}/me`, pm)).json.data;
  assert.equal(mine.counts.accountable >= 1, true);
  assert.ok(mine.responsibilities.some((x) => x.processCode === 'SAMPLE_DOC' && x.raci === 'A'));
  assert.equal(mine.recent.length >= 3, true);
  assert.equal(mine.score.onTimePct, 100);
  assert.equal((await api.call('GET', `${A}/me`, sk)).json.data.recent.length, 0);
  // overdue: a task of mine past its time
  const d4 = await make('Bricks');
  const w4 = await submit(d4);
  workflowOf(api.db).setClock(() => new Date(Date.now() + 40 * 86_400_000));
  const over = (await api.call('GET', `${A}/me`, pm)).json.data.overdue;
  assert.ok(over.some((x) => x.title.includes(d4.docNo)));
  workflowOf(api.db).setClock(() => new Date());
  assert.ok(w4);
  await api.close();
});
