import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { evidenceProviders, workflowOf } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.03: the approval inbox, the task drawer and its evidence, approving in bulk, approving from a secure link, the documents I follow.
// T-01 the inbox shows a person's own tasks (and what is delegated to them) with the right time colour; T-02 bulk approval refuses what the policy refuses, with reasons;
// T-03 a link works once, expires, and above the threshold needs the person to sign in.
const W = '/api/v1/workflow';
const E = '/api/v1/eng';
const json = { 'content-type': 'application/json' };
const key = (k = 'i') => ({ ...json, 'idempotency-key': `in-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const pm2 = as('PM', 'pm2');
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const cfo = as('CFO', 'cfo1');
const aud = as('AUD', 'aud1');

const make = async (api, who, amount, title = 'Formwork') => { const r = await api.call('POST', `${E}/sample-docs`, { ...who, headers: key('c'), body: { title, amount } }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
const submit = async (api, who, doc) => (await api.call('POST', `${E}/sample-docs/${doc.id}/submit`, { ...who, headers: key('s'), body: {} })).json.data.workflow;
const inbox = async (api, who, q = '') => (await api.call('GET', `${W}/inbox${q}`, who)).json.data;
const bulk = (api, who, taskIds, comment) => api.call('POST', `${W}/tasks/bulk-act`, { ...who, headers: key('b'), body: { taskIds, action: 'approve', ...(comment ? { comment } : {}) } });
const outbox = (api, type) => api.db.prepare('SELECT payload FROM core_outbox WHERE event_type = ?').all(type).map((r) => JSON.parse(r.payload));

test('T-01 FR-01 FR-08 the inbox shows only my tasks (and what is delegated to me), with the time left, in order of urgency, with filters and counts', async () => {
  const api = await startApi();
  await setupCompany(api);
  const engine = workflowOf(api.db);
  const wfs = [];
  for (const [amount, title] of [['10000.00', 'Cement'], ['20000.00', 'Steel'], ['30000.00', 'Sand']]) wfs.push(await submit(api, pd, await make(api, pd, amount, title)));
  const mine = await inbox(api, pm);
  assert.equal(mine.total, 3);
  assert.deepEqual(mine.rows.map((r) => r.title).sort(), ['Cement', 'Sand', 'Steel']);
  assert.ok(mine.rows.every((r) => r.sla === 'ON_TRACK' && r.docType === 'ENG_SAMPLE_DOC' && r.submittedBy === 'pd1' && r.step === 'MANAGER' && r.canAct));
  assert.equal((await inbox(api, as('ACCMGR', 'acc1'))).total, 0, 'the accounts manager is not asked yet');
  assert.equal((await inbox(api, pd)).total, 0, 'the person who raised them never sees them as theirs to decide');
  assert.equal((await api.call('GET', `${W}/inbox`, as('SK', 'sk1'))).json.data.total, 0);
  // the time: due soon after the reminder point, overdue after the due time, escalated after the sweep
  const task = wfs[0].tasks[0];
  const raw = JSON.parse(api.db.prepare('SELECT scope_json FROM wf_tasks WHERE id = ?').get(task.id).scope_json).sla;
  engine.setClock(() => new Date(new Date(raw.remindAt).getTime() + 60_000));
  let rows = (await inbox(api, pm)).rows;
  assert.equal(rows.find((r) => r.taskId === task.id).sla, 'DUE_SOON');
  engine.setClock(() => new Date(new Date(task.dueAt).getTime() + 60_000));
  rows = (await inbox(api, pm)).rows;
  assert.equal(rows.find((r) => r.taskId === task.id).sla, 'OVERDUE');
  assert.equal(rows[0].sla, 'OVERDUE', 'overdue first');
  engine.sweepSla();
  engine.sweepSla();
  const after = await inbox(api, pm);
  assert.ok(['ESCALATED', 'OVERDUE'].includes(after.rows.find((r) => r.taskId === task.id).sla));
  assert.equal(after.counts.pending >= 3, true);
  assert.ok(after.counts.overdue >= 1);
  // the person the task climbed to sees it, marked as an escalation
  const up = await inbox(api, as('PD', 'pd9'));
  assert.ok(up.rows.some((r) => r.escalation), 'the next level sees the escalated task');
  engine.setClock(() => new Date());
  // filters, sort and pages
  assert.equal((await inbox(api, pm, '?q=steel')).total, 1);
  assert.equal((await inbox(api, pm, '?docType=ENG_SAMPLE_DOC&limit=2')).rows.length, 2);
  assert.equal((await inbox(api, pm, '?limit=2&offset=2')).rows.length, 1);
  assert.deepEqual((await inbox(api, pm, '?sort=amount')).rows.map((r) => r.amount), [30000, 20000, 10000]);
  assert.equal((await api.call('GET', `${W}/inbox?sort=nonsense`, pm)).status, 400);
  assert.equal((await api.call('GET', `${W}/inbox?docType=X&extra=1`, pm)).status, 400);
  // delegations: a person with a delegation sees the delegator's tasks, marked on behalf of
  const D = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const del = await api.call('POST', `${W}/delegations`, { ...pm, headers: key('g'), body: { delegate: 'del1', docTypes: ['ENG_SAMPLE_DOC'], from: D(0), to: D(3), reason: 'On site visits' } });
  assert.equal(del.status, 201, JSON.stringify(del.json));
  const cover = await inbox(api, as('SE', 'del1'));
  assert.equal(cover.total >= 1, true);
  assert.ok(cover.rows.every((r) => r.canAct));
  assert.equal(cover.counts.pending, cover.total);
  // counts for the bell and the widget
  const c = (await api.call('GET', `${W}/inbox/counts`, pm)).json.data;
  assert.equal(c.pending, 3);
  assert.equal(c.watching, 0);
  const w = await api.call('GET', '/api/v1/ui/widgets/workflow.inbox/data', pm);
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(w.json.data.value ?? w.json.data.data?.value, 3);
  // the originator's own list
  const sub = (await api.call('GET', `${W}/inbox/submissions?kind=submitted`, pd)).json.data;
  assert.equal(sub.total, 3);
  assert.ok(sub.rows[0].waitingFor.includes('PM'));
  assert.equal((await api.call('GET', `${W}/inbox/submissions?kind=watching`, pd)).json.data.total, 3, 'the originator watches by default');
  assert.equal((await api.call('POST', `${W}/instances/${wfs[0].id}/watch`, { ...aud, headers: key('w'), body: {} })).status, 200);
  assert.equal((await api.call('GET', `${W}/inbox/submissions?kind=watching`, aud)).json.data.total, 1);
  await api.close();
});

test('T-02 FR-04 BR-02 bulk approval refuses what the policy refuses and says why; what it accepts is decided like any other', async () => {
  const api = await startApi();
  await setupCompany(api);
  const small = await submit(api, pd, await make(api, pd, '10000.00', 'Small A'));
  const small2 = await submit(api, pd, await make(api, pd, '20000.00', 'Small B'));
  const big = await submit(api, pd, await make(api, pd, '90000.00', 'Large'));
  const flagged = (await api.call('POST', `${W}/submit`, { ...pd, headers: key('f'), body: { docType: 'ENG_SAMPLE_DOC', docId: (await make(api, pd, '5000.00', 'Single source')).id, context: { amount: 5000, singleSource: true } } })).json.data;
  const mineRows = (await inbox(api, pm)).rows;
  const by = (t) => mineRows.find((r) => r.title === t);
  assert.equal(by('Small A').bulkEligible, true);
  assert.equal(by('Large').bulkEligible, false);
  assert.match(by('Large').bulkReason, /above the bulk limit of ₹50,000/);
  assert.equal(by('Single source').bulkEligible, false);
  assert.match(by('Single source').bulkReason, /risk flags \(single-source purchase\)/);
  assert.equal((await inbox(api, pm, '?bulk=true')).total, 2);
  // bad requests
  assert.equal((await api.call('POST', `${W}/tasks/bulk-act`, { ...pm, headers: json, body: { taskIds: [1], action: 'approve' } })).status, 400, 'an Idempotency-Key is needed');
  assert.equal((await bulk(api, pm, [])).status, 400);
  assert.equal((await api.call('POST', `${W}/tasks/bulk-act`, { ...pm, headers: key('b'), body: { taskIds: [1], action: 'reject', comment: 'no' } })).status, 400, 'only approval is done in bulk');
  const own = await submit(api, pm, await make(api, pm, '1000.00', 'Mine'));
  const ids = [small.tasks[0].id, small2.tasks[0].id, big.tasks[0].id, flagged.tasks[0].id, own.tasks[0].id, 99999];
  const r = await bulk(api, pm, ids, 'quantities checked');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const res = Object.fromEntries(r.json.data.results.map((x) => [x.taskId, x]));
  assert.equal(res[small.tasks[0].id].ok, true);
  assert.equal(res[small2.tasks[0].id].ok, true);
  assert.equal(res[big.tasks[0].id].ok, false);
  assert.match(res[big.tasks[0].id].reason, /above the bulk limit/);
  assert.equal(res[flagged.tasks[0].id].ok, false);
  assert.match(res[flagged.tasks[0].id].reason, /risk flags/);
  assert.equal(res[own.tasks[0].id].ok, false);
  assert.match(res[own.tasks[0].id].reason, /raised this document/);
  assert.equal(res[99999].ok, false);
  assert.equal(r.json.data.approved, 2);
  assert.equal(r.json.data.refused, 4);
  // what was approved moved on like any other approval, with the comment, and was audited; what was refused is untouched
  const moved = (await api.call('GET', `${W}/instances/${small.id}`, pm)).json.data;
  assert.equal(moved.currentStep, 'FINANCE');
  assert.equal(moved.tasks[0].comment, 'quantities checked');
  assert.equal((await api.call('GET', `${W}/instances/${big.id}`, pm)).json.data.currentStep, 'MANAGER');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'wf_tasks' AND action = 'bulk_approve'").get().n, 1);
  assert.equal(outbox(api, 'workflow.bulk.approved').length, 1);
  // a person cannot approve in bulk what is not theirs
  const acc = as('ACCMGR', 'acc1');
  const stray = await bulk(api, acc, [big.tasks[0].id]);
  assert.equal(stray.json.data.results[0].ok, false);
  assert.equal(stray.json.data.approved, 0);
  // the policy is a setting changed through approval: raise the bulk limit and the large one becomes eligible
  const pol = await api.call('POST', `${W}/approval-policies/changes`, { ...sys, headers: key('p'), body: { policies: [{ docType: 'ENG_SAMPLE_DOC', bulkEligible: true, bulkMaxAmount: 100000, linkEligible: true, linkReauthAmount: 25000, linkExpiryMinutes: 60 }], effectiveFrom: new Date().toISOString().slice(0, 10), reason: 'Bigger limit for small requests' } });
  assert.equal(pol.status, 202, JSON.stringify(pol.json));
  assert.equal((await api.call('POST', `${W}/approval-policies/changes`, { ...pm, headers: key('p'), body: { policies: [], effectiveFrom: '2030-01-01', reason: 'No' } })).status, 403);
  assert.equal((await inbox(api, pm)).rows.find((x) => x.title === 'Large').bulkEligible, false, 'not before it is approved');
  let wf = pol.json.data.instance;
  for (const w of [sys2, cfo]) wf = (await api.call('POST', `${W}/tasks/${wf.tasks.find((t) => t.status === 'OPEN').id}/act`, { ...w, headers: key('a'), body: { action: 'approve' } })).json.data;
  assert.equal(wf.status, 'APPROVED');
  assert.equal((await inbox(api, pm)).rows.find((x) => x.title === 'Large').bulkEligible, true);
  const listed = (await api.call('GET', `${W}/approval-policies`, aud)).json.data;
  assert.equal(listed.find((p) => p.docType === 'ENG_SAMPLE_DOC' && p.status === 'ACTIVE' && p.bulkMaxAmount === 100000) != null, true);
  await api.close();
});

test('T-03 FR-06 BR-03 a link approves once, expires, cannot be replayed, and above the threshold needs the person to sign in', async () => {
  const api = await startApi();
  await setupCompany(api);
  const engine = workflowOf(api.db);
  const pub = (method, path, body) => fetch(api.base + path, { method, headers: json, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const small = await submit(api, pd, await make(api, pd, '10000.00', 'Link small'));
  const big = await submit(api, pd, await make(api, pd, '40000.00', 'Link big'));
  // only the approver gets a link to their own task
  assert.equal((await api.call('POST', `${W}/tasks/${small.tasks[0].id}/links`, { ...as('ACCMGR', 'acc1'), headers: key('l'), body: {} })).status, 404, 'a stranger to the approval does not even see it');
  assert.equal((await api.call('POST', `${W}/tasks/${small.tasks[0].id}/links`, { ...pd, headers: key('l'), body: {} })).status, 403);
  const issued = await api.call('POST', `${W}/tasks/${small.tasks[0].id}/links`, { ...pm, headers: key('l'), body: {} });
  assert.equal(issued.status, 201, JSON.stringify(issued.json));
  const { token, expiresAt, reauthRequired } = issued.json.data;
  assert.equal(reauthRequired, false);
  assert.equal(token.length >= 40, true);
  assert.ok(new Date(expiresAt).getTime() - Date.now() <= 61 * 60_000);
  const stored = api.db.prepare('SELECT * FROM wf_link_tokens').get();
  assert.notEqual(stored.token_hash, token, 'only the hash is kept');
  assert.equal(JSON.stringify(outbox(api, 'workflow.link.issued')).includes(token), false, 'the token is in no event');
  // what the link shows, without signing in
  const peek = await pub('GET', `${W}/links/${token}`);
  assert.equal(peek.status, 200, JSON.stringify(peek.json));
  assert.equal(peek.json.data.title, 'Link small');
  assert.equal(peek.json.data.amount, 10000);
  assert.equal((await pub('GET', `${W}/links/${'x'.repeat(43)}`)).status, 410, 'a guess learns nothing');
  assert.equal((await pub('GET', `${W}/links/short`)).status, 400);
  // rejecting needs a reason; approving works, once
  assert.equal((await pub('POST', `${W}/links/${token}/decide`, { action: 'reject' })).status, 400);
  const done = await pub('POST', `${W}/links/${token}/decide`, { action: 'approve', comment: 'ok from the site' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal((await api.call('GET', `${W}/instances/${small.id}`, pm)).json.data.currentStep, 'FINANCE');
  assert.equal((await api.call('GET', `${W}/instances/${small.id}`, pm)).json.data.tasks[0].comment, 'ok from the site');
  const replay = await pub('POST', `${W}/links/${token}/decide`, { action: 'approve' });
  assert.equal(replay.status, 410, 'it cannot be replayed');
  assert.equal((await pub('GET', `${W}/links/${token}`)).status, 410);
  assert.equal(api.db.prepare("SELECT status FROM wf_link_tokens WHERE id = ?").get(stored.id).status, 'USED');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'wf_link_tokens' AND action = 'decide_approve'").get().n, 1);
  // a link expires
  const second = await api.call('POST', `${W}/tasks/${(await submit(api, pd, await make(api, pd, '5000.00', 'Link expiry'))).tasks[0].id}/links`, { ...pm, headers: key('l'), body: {} });
  engine.setClock(() => new Date(Date.now() + 2 * 3_600_000));
  assert.equal((await pub('GET', `${W}/links/${second.json.data.token}`)).status, 410);
  assert.equal((await pub('POST', `${W}/links/${second.json.data.token}/decide`, { action: 'approve' })).status, 410);
  assert.equal(api.db.prepare("SELECT status FROM wf_link_tokens WHERE id = ?").get(second.json.data.id).status, 'EXPIRED');
  engine.setClock(() => new Date());
  // above the threshold: the person must sign in again, as themselves
  const bigLink = (await api.call('POST', `${W}/tasks/${big.tasks[0].id}/links`, { ...pm, headers: key('l'), body: {} })).json.data;
  assert.equal(bigLink.reauthRequired, true);
  assert.equal((await pub('GET', `${W}/links/${bigLink.token}`)).json.data.reauthRequired, true);
  const noSession = await pub('POST', `${W}/links/${bigLink.token}/decide`, { action: 'approve' });
  assert.equal(noSession.status, 401);
  assert.equal(noSession.json.error.code, 'REAUTH_REQUIRED');
  assert.equal((await api.call('POST', `${W}/links/${bigLink.token}/confirm`, { ...pm2, headers: key('c'), body: { action: 'approve' } })).status, 403, 'a link made for another person');
  assert.equal((await api.call('GET', `${W}/instances/${big.id}`, pm)).json.data.currentStep, 'MANAGER', 'nothing was decided yet');
  const ok = await api.call('POST', `${W}/links/${bigLink.token}/confirm`, { ...pm, headers: key('c'), body: { action: 'approve', comment: 'signed in again' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await api.call('POST', `${W}/links/${bigLink.token}/confirm`, { ...pm, headers: key('c'), body: { action: 'approve' } })).status, 410);
  assert.equal(outbox(api, 'workflow.link.used').length, 2);
  // a new link replaces the one before it; a link to a task already decided is gone
  const t3 = (await submit(api, pd, await make(api, pd, '1000.00', 'Link twice'))).tasks[0].id;
  const l1 = (await api.call('POST', `${W}/tasks/${t3}/links`, { ...pm, headers: key('l'), body: {} })).json.data;
  const l2 = (await api.call('POST', `${W}/tasks/${t3}/links`, { ...pm, headers: key('l'), body: {} })).json.data;
  assert.equal((await pub('GET', `${W}/links/${l1.token}`)).status, 410, 'the earlier link was replaced');
  assert.equal((await pub('GET', `${W}/links/${l2.token}`)).status, 200);
  await api.call('POST', `${W}/tasks/${t3}/act`, { ...pm, headers: key('a'), body: { action: 'approve' } });
  assert.equal((await pub('GET', `${W}/links/${l2.token}`)).status, 410, 'the task is decided, so the link is gone');
  await api.close();
});

test('FR-02 FR-03 BR-01 the task drawer: the document at a glance and the evidence, computed when opened, read-only, masked, and honest when a module has none', async () => {
  const api = await startApi();
  await setupCompany(api);
  const earlier = await submit(api, pd, await make(api, pd, '300000.00', 'Cement'));
  await api.call('POST', `${W}/tasks/${earlier.tasks[0].id}/act`, { ...pm, headers: key('a'), body: { action: 'reject', comment: 'wrong grade of cement' } });
  const wf = await submit(api, pd, await make(api, pd, '2500000.00', 'Cement'));
  const ev = await api.call('GET', `${W}/tasks/${wf.tasks[0].id}/evidence`, pm);
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  const d = ev.json.data;
  assert.equal(d.canAct, true);
  assert.equal(d.summary.fields.find((f) => f.label === 'Title').value, 'Cement');
  const codes = d.sections.map((s) => s.code);
  for (const c of ['time', 'history', 'similar', 'request', 'recent']) assert.ok(codes.includes(c), c);
  const similar = d.sections.find((s) => s.code === 'similar');
  assert.equal(similar.rows.length, 1);
  assert.equal(similar.rows[0].status, 'rejected');
  assert.ok(d.flags.some((f) => f.code === 'large'), 'a large amount is flagged');
  assert.equal(d.hasProviders, true);
  assert.ok(Math.abs(Date.now() - Date.parse(d.computedAt)) < 5000, 'computed when opened');
  assert.equal(d.bulk.eligible, false);
  // read-only: the drawer changes nothing
  const before = api.db.prepare('SELECT COUNT(*) AS n FROM wf_history').get().n;
  await api.call('GET', `${W}/tasks/${wf.tasks[0].id}/evidence`, pm);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM wf_history').get().n, before);
  // who may open it: the approver, a reader of all (the auditor, who cannot act), not a stranger, not another company
  const a = await api.call('GET', `${W}/tasks/${wf.tasks[0].id}/evidence`, aud);
  assert.equal(a.status, 200);
  assert.equal(a.json.data.canAct, false);
  assert.equal((await api.call('GET', `${W}/tasks/${wf.tasks[0].id}/evidence`, as('SK', 'sk1'))).status, 404);
  assert.equal((await api.call('GET', `${W}/tasks/${wf.tasks[0].id}/evidence`, { ...pm, company: '2' })).status, 404);
  assert.equal((await api.call('GET', `${W}/tasks/${wf.tasks[0].id}/evidence`, pd)).json.data.canAct, false, 'the originator can look, not decide');
  // a document type whose module has not added its evidence says so
  const req = await api.call('POST', `${W}/definitions/draft`, { ...sys, headers: key('d'), body: { docType: 'ENG_SAMPLE_DOC' } });
  const act = await api.call('POST', `${W}/definitions/${req.json.data.id}/activate`, { ...sys, headers: key('x'), body: {} });
  const none = await api.call('GET', `${W}/tasks/${act.json.data.instance.tasks[0].id}/evidence`, sys2);
  assert.equal(none.status, 200, JSON.stringify(none.json));
  assert.equal(none.json.data.hasProviders, false);
  assert.match(none.json.data.emptyMessage, /has not added its own evidence/);
  assert.ok(none.json.data.sections.some((s) => s.code === 'history'), 'what the approval itself knows is still shown');
  // a provider that fails is reported and never stops the others; a masked value is hidden from a role that may not see it
  evidenceProviders.register('WF_DEFINITION', () => { throw new Error('the budget service is down'); });
  evidenceProviders.register('WF_DEFINITION', () => ({ sections: [{ code: 'pay', title: 'Pay', kind: 'metrics', items: [{ label: 'Salary', value: 100000, format: 'inr', mask: ['employee', 'salary'] }] }] }));
  const mixed = (await api.call('GET', `${W}/tasks/${act.json.data.instance.tasks[0].id}/evidence`, sys2)).json.data;
  assert.equal(mixed.unavailable.length, 1);
  assert.equal(mixed.sections.find((s) => s.code === 'pay').items[0].value, null);
  assert.equal(mixed.sections.find((s) => s.code === 'pay').items[0].masked, true);
  await api.close();
});
