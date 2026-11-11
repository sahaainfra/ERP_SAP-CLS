import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { createProtocolService } from '../src/server/modules/eng/protocol.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.04: the Protocol & Control Engine. T-01 a control in OBSERVE logs but does not block, in ENFORCE it blocks, an approved exception lets the action go ahead;
// T-02 the same control stops the action on the API path and on the import path; T-03 an emergency exception that is not regularised in time escalates.
const P = '/api/v1/pcs';
const W = '/api/v1/workflow';
const E = '/api/v1/eng';
const json = { 'content-type': 'application/json' };
const key = (k = 'p') => ({ ...json, 'idempotency-key': `pc-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const aud = as('AUD', 'aud1');
const procmgr = as('PROCMGR', 'proc1');
const sk = as('SK', 'sk1');

const setup = async () => {
  const api = await startApi();
  await setupCompany(api);
  await api.call('GET', `${P}/control-points`, sys); // a company gets its control points the first time they are read
  return api;
};
const mode = (api, code, m, company = 1) => api.db.prepare('UPDATE pcs_control_points SET mode = ?, observe_since = COALESCE(observe_since, date(\'now\')) WHERE company_id = ? AND code = ?').run(m, company, code);
const make = async (api, who, amount, title = 'Shuttering') => { const r = await api.call('POST', `${E}/sample-docs`, { ...who, headers: key('c'), body: { title, amount } }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
const submit = (api, who, doc) => api.call('POST', `${E}/sample-docs/${doc.id}/submit`, { ...who, headers: key('s'), body: {} });
const results = (api, code, entityId) => { api.db; return api.db.prepare('SELECT result, mode, check_source AS source, user_id AS user FROM pcs_check_results WHERE control_code = ?' + (entityId ? ' AND entity_id = ?' : '') + ' ORDER BY id').all(...(entityId ? [code, String(entityId)] : [code])); };
const flush = async () => { await new Promise((r) => setImmediate(r)); };
const evidence = (api, exceptionId) => api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, 'site-photo.jpg', 'jpg', 'image/jpeg', 'image', 1000, ?, 'CLEAN', 'pcs_exception', ?, 'test', 'test')").run(`k-${Math.random()}`, `h-${Math.random()}`, exceptionId);
const tasks = async (api, who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
const decide = async (api, who, instanceId, action = 'approve') => {
  const t = (await tasks(api, who)).find((x) => x.instance.id === instanceId);
  assert.ok(t, `a task for ${who.user}`);
  const r = await api.call('POST', `${W}/tasks/${t.id}/act`, { ...who, headers: key('a'), body: { action, comment: action === 'approve' ? 'ok' : 'No, not justified at all' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const raise = async (api, who, doc, over = {}) => api.call('POST', `${P}/exceptions`, { ...who, headers: key('x'), body: { controlCode: 'CP-ENG-01', entity: 'sample_doc', entityId: String(doc.id), reasonCode: 'URGENT_COMMERCIAL', justification: 'The slab must be cast on Saturday and the supplier needs the order today.', ...over } });

test('T-01 FR-01 FR-02 FR-03 FR-06 a control in OBSERVE logs what it would have done but never blocks; in ENFORCE it blocks; an approved exception lets the action go ahead', async () => {
  const api = await setup();
  const doc = await make(api, pd, '750000.00');
  // OBSERVE (the sample control starts there): nothing is stopped, what would have been stopped is written down
  let r = await submit(api, pd, doc);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await flush();
  assert.deepEqual(results(api, 'CP-ENG-01', doc.id).map((x) => x.result), ['WOULD_REQUIRE_EXCEPTION']);
  const stats = (await api.call('GET', `${P}/control-points/CP-ENG-01`, sys)).json.data.stats;
  assert.equal(stats.wouldRequireException, 1);
  assert.equal(stats.blocked, 0);
  // ENFORCE: the same kind of request is stopped, and what stopped it is on record although the action was undone
  mode(api, 'CP-ENG-01', 'ENFORCE');
  const doc2 = await make(api, pd, '750000.00', 'Scaffolding');
  r = await submit(api, pd, doc2);
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'EXCEPTION_REQUIRED');
  assert.ok(r.json.error.details.some((d) => d.field === 'control' && d.message === 'CP-ENG-01'));
  await flush();
  assert.equal(api.db.prepare('SELECT status FROM eng_sample_docs WHERE id = ?').get(doc2.id).status, 'DRAFT');
  assert.equal(results(api, 'CP-ENG-01', doc2.id)[0].result, 'EXCEPTION_REQUIRED');
  // an exception: it needs the reason, the justification and (this control asks for it) evidence
  assert.equal((await raise(api, pd, doc2, { reasonCode: 'NOT_A_REASON' })).status, 400);
  assert.equal((await raise(api, pd, doc2, { justification: 'too short' })).status, 400);
  const other = await make(api, pd, '10.00', 'Nails');
  assert.equal((await raise(api, pd, other)).status, 422, 'no exception for an action no control stopped');
  r = await raise(api, pd, doc2);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const ex = r.json.data;
  assert.equal(ex.status, 'DRAFT');
  assert.equal(ex.valueAtRisk, '750000.00');
  assert.equal((await raise(api, pd, doc2)).status, 409, 'one open exception for one action');
  r = await api.call('POST', `${P}/exceptions/${ex.id}/submit`, { ...pd, headers: key('s'), body: {} });
  assert.equal(r.status, 422, 'the evidence is required');
  evidence(api, ex.id);
  r = await api.call('POST', `${P}/exceptions/${ex.id}/submit`, { ...pd, headers: key('s'), body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.status, 'PENDING');
  assert.deepEqual(r.json.data.evidenceFileIds.length, 1);
  assert.equal((await submit(api, pd, doc2)).status, 422, 'still stopped while the exception waits');
  // the level 1 approver is the project manager; the person who raised it cannot decide it
  const inst = r.json.data.workflow.id;
  assert.equal((await api.call('GET', `${W}/tasks?mine=assigned`, pd)).json.data.rows.length, 0);
  await decide(api, pm, inst);
  assert.equal(api.db.prepare('SELECT status FROM pcs_exceptions WHERE id = ?').get(ex.id).status, 'APPROVED');
  r = await submit(api, pd, doc2);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(api.db.prepare('SELECT status, used_by FROM pcs_exceptions WHERE id = ?').get(ex.id).status, 'USED');
  await flush();
  assert.ok(results(api, 'CP-ENG-01', doc2.id).some((x) => x.result === 'EXCEPTED'));
  // the control cycle of the document: planned, verified, in approval
  const cycle = (await api.call('GET', `${P}/cycle/sample_doc/${doc2.id}`, pd)).json.data;
  assert.deepEqual(cycle.filter((s) => s.done).map((s) => s.stage), ['PLAN', 'VERIFY']);
  assert.equal(cycle.length, 8);
  // the events, the audit trail and the outbox
  const types = api.db.prepare("SELECT event_type FROM core_outbox WHERE event_type LIKE 'pcs.%'").all().map((x) => x.event_type);
  assert.ok(types.includes('pcs.exception.raised') && types.includes('pcs.exception.approved'));
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'pcs_exceptions' AND action = 'use'").get());
  // a warning control lets the action go ahead and says so
  const pd2 = as('PD', 'pd2');
  const small = await make(api, pd2, '1000.00', 'Alpha');
  await submit(api, pd2, small);
  const big = await make(api, pd2, '90000.00', 'Bravo');
  r = await submit(api, pd2, big);
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.data.controlWarnings.map((w) => w.control), ['CP-ENG-02']);
  await api.close();
});

test('T-02 FR-02 the same control stops the action on the API path and on the import path, and a blocking control cannot be excepted', async () => {
  const api = await setup();
  mode(api, 'CP-ENG-01', 'ENFORCE');
  mode(api, 'CP-ENG-03', 'ENFORCE');
  const doc = await make(api, pd, '600000.00', 'Via the API');
  const viaApi = await submit(api, pd, doc);
  assert.equal(viaApi.status, 422);
  assert.equal(viaApi.json.error.code, 'EXCEPTION_REQUIRED');
  const imp = await api.call('POST', `${E}/sample-docs/import`, { ...pd, headers: key('i'), body: { rows: [{ title: 'Row one', amount: '600000.00' }, { title: 'Row two', amount: '20000.00' }, { title: 'Row three', amount: '20000000.00' }] } });
  assert.equal(imp.status, 201, JSON.stringify(imp.json));
  const rows = imp.json.data.rows;
  assert.deepEqual(rows.map((x) => [x.ok, x.code ?? null, x.status]), [[false, 'EXCEPTION_REQUIRED', 'DRAFT'], [true, null, 'IN_APPROVAL'], [false, 'CONTROL_BLOCKED', 'DRAFT']]);
  await flush();
  const sources = results(api, 'CP-ENG-01').map((x) => x.source);
  assert.ok(sources.includes('api') && sources.includes('import'), JSON.stringify(sources));
  // a control that blocks cannot be excepted
  const huge = api.db.prepare("SELECT id FROM eng_sample_docs WHERE title = 'Row three'").get();
  const r = await api.call('POST', `${P}/exceptions`, { ...pd, headers: key('x'), body: { controlCode: 'CP-ENG-03', entity: 'sample_doc', entityId: String(huge.id), reasonCode: 'ONE_TIME', justification: 'A reason that cannot help because the control blocks outright.' } });
  assert.equal(r.status, 422);
  // OFF: the control does nothing and writes nothing
  mode(api, 'CP-ENG-03', 'OFF');
  const before = results(api, 'CP-ENG-03').length;
  await submit(api, pd, { id: huge.id });
  await flush();
  assert.equal(results(api, 'CP-ENG-03').length, before);
  await api.close();
});

test('T-03 BR-02 an emergency exception lets the action go ahead at once, is regularised by approval, and escalates when it is not regularised in time', async () => {
  const api = await setup();
  mode(api, 'CP-ENG-01', 'ENFORCE');
  const engine = workflowOf(api.db);
  const service = createProtocolService({ db: api.db, engine });
  const doc = await make(api, pd, '800000.00', 'Emergency cement');
  assert.equal((await submit(api, pd, doc)).status, 422);
  await flush();
  assert.equal((await raise(api, sk, doc, { emergency: true })).status, 422, 'only the person who was stopped can raise it');
  assert.equal((await raise(api, pm, doc, { emergency: true })).status, 422);
  const r0 = await raise(api, pd, doc, { emergency: true });
  assert.equal(r0.status, 201, JSON.stringify(r0.json));
  const ex = r0.json.data;
  assert.equal(ex.emergency, true);
  assert.ok(Date.parse(ex.regulariseBy) > Date.now() + 71 * 3_600_000);
  evidence(api, ex.id);
  const sub = await api.call('POST', `${P}/exceptions/${ex.id}/submit`, { ...pd, headers: key('s'), body: {} });
  assert.equal(sub.status, 201);
  // the action goes ahead although the exception has not been decided
  const go = await submit(api, pd, doc);
  assert.equal(go.status, 201, JSON.stringify(go.json));
  assert.equal(api.db.prepare('SELECT status, used_at IS NOT NULL AS used FROM pcs_exceptions WHERE id = ?').get(ex.id).status, 'PENDING');
  // nothing to escalate yet
  assert.equal(service.exceptions.sweepEmergencies().escalated, 0);
  // eighty hours later it is overdue and climbs
  engine.setClock(() => new Date(Date.now() + 80 * 3_600_000));
  const swept = service.exceptions.sweepEmergencies();
  assert.equal(swept.escalated, 1);
  assert.equal(service.exceptions.sweepEmergencies().escalated, 0, 'only once');
  const row = api.db.prepare('SELECT escalated_at FROM pcs_exceptions WHERE id = ?').get(ex.id);
  assert.ok(row.escalated_at);
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'pcs.exception.escalated'").get());
  assert.ok(api.db.prepare('SELECT 1 FROM wf_tasks WHERE instance_id = ? AND escalated_at IS NOT NULL').get(sub.json.data.workflow.id), 'the approval task climbed too');
  const dash = (await api.call('GET', `${P}/dashboard`, sys)).json.data;
  assert.equal(dash.tiles.emergencyOverdue, 1);
  // regularised late: the approval makes it USED (it was used already)
  await decide(api, pm, sub.json.data.workflow.id);
  const fin = api.db.prepare('SELECT status, regularised_at FROM pcs_exceptions WHERE id = ?').get(ex.id);
  assert.equal(fin.status, 'USED');
  assert.ok(fin.regularised_at);
  engine.setClock(() => new Date());
  await api.close();
});

test('BR-01 a control goes to ENFORCE only after 14 days of OBSERVE data and an approval by its owner and then the auditor or director; a control in ENFORCE changes only the same way', async () => {
  const api = await setup();
  const put = (who, body, k = 'm') => api.call('PUT', `${P}/control-points/CP-ENG-02`, { ...who, headers: key(k), body });
  assert.equal((await put(pm, { mode: 'OBSERVE' })).status, 403, 'only those who manage controls change them');
  assert.equal((await put(sys, { mode: 'OFF' })).status, 200);
  let r = await put(sys, { mode: 'ENFORCE', reason: 'We have seen enough of it.' });
  assert.equal(r.status, 422, 'from OFF straight to ENFORCE is refused');
  assert.equal((await put(sys, { mode: 'OBSERVE' })).status, 200);
  r = await put(sys, { mode: 'ENFORCE', reason: 'We have seen enough of it.' });
  assert.equal(r.status, 422);
  assert.match(r.json.error.message, /14 days/);
  api.db.prepare("UPDATE pcs_control_points SET observe_since = date('now', '-20 days') WHERE code = 'CP-ENG-02'").run();
  assert.equal((await put(sys, { mode: 'ENFORCE' })).status, 400, 'a reason is needed');
  r = await put(sys, { mode: 'ENFORCE', reason: 'Twenty days observed; it would have stopped four requests.' });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.data.applied, false);
  assert.equal((await put(sys, { mode: 'WARN' })).status, 409, 'one change at a time');
  const inst = r.json.data.workflow.id;
  assert.equal(api.db.prepare("SELECT mode FROM pcs_control_points WHERE code = 'CP-ENG-02'").get().mode, 'OBSERVE');
  await decide(api, procmgr, inst); // the process owner
  await decide(api, aud, inst); // then the auditor or the director
  assert.equal(api.db.prepare("SELECT mode, pending_change_id FROM pcs_control_points WHERE code = 'CP-ENG-02'").get().mode, 'ENFORCE');
  // a control in ENFORCE is relaxed only through the approval; a rejection leaves it as it was
  r = await put(sys2, { mode: 'WARN', reason: 'Too many false alarms on site.' });
  assert.equal(r.status, 202);
  await decide(api, procmgr, r.json.data.workflow.id, 'reject');
  const row = api.db.prepare("SELECT mode, pending_change_id FROM pcs_control_points WHERE code = 'CP-ENG-02'").get();
  assert.deepEqual([row.mode, row.pending_change_id], ['ENFORCE', null]);
  // the maker cannot approve their own change
  r = await put(sys, { thresholds: { times: 5 }, reason: 'Five times is plenty of room.' });
  assert.equal(r.status, 202);
  const t = (await tasks(api, as('SYSADM', 'sys1'))).find((x) => x.instance.id === r.json.data.workflow.id);
  assert.ok(!t || !t.canAct);
  await api.close();
});

test('FR-01 FR-04 the registry: a control written as data, reason codes with a company\'s own changes, and the reason picker of the dialogs', async () => {
  const api = await setup();
  const body = { code: 'CP-PROC-09', module: 'proc', stage: 'VERIFY', description: 'A purchase over the limit needs an exception', enforcement: 'EXCEPTION', rule: { field: 'amount', op: 'gt', threshold: 'limit' }, thresholds: { limit: 100000 }, escalationLevel: 2, ownerRole: 'PROCMGR' };
  assert.equal((await api.call('POST', `${P}/control-points`, { ...pm, headers: key('n'), body })).status, 403);
  assert.equal((await api.call('POST', `${P}/control-points`, { ...sys, headers: key('n'), body: { ...body, code: 'CP-X-1' } })).status, 400);
  assert.equal((await api.call('POST', `${P}/control-points`, { ...sys, headers: key('n'), body })).status, 201);
  assert.equal((await api.call('POST', `${P}/control-points`, { ...sys, headers: key('n'), body })).status, 409);
  const one = (await api.call('GET', `${P}/control-points/CP-PROC-09`, pm)).json.data;
  assert.deepEqual([one.mode, one.rule.kind, one.thresholds.limit], ['OFF', 'expression', 100000]);
  const prot = (await import('../src/server/platform/protocol/index.js')).protocolOf(api.db);
  api.db.prepare("UPDATE pcs_control_points SET mode = 'WARN' WHERE code = 'CP-PROC-09'").run();
  assert.equal(prot.check({ companyId: 1, user: 'u' }, 'CP-PROC-09', { entity: 'po', entityId: '1', amount: 250000 }).outcome, 'warn');
  assert.equal(prot.check({ companyId: 1, user: 'u' }, 'CP-PROC-09', { entity: 'po', entityId: '2', amount: 5 }).outcome, 'pass');
  assert.equal((await api.call('DELETE', `${P}/control-points/CP-PROC-09`, { ...sys, headers: key('d') })).status, 422, 'put it OFF first');
  assert.equal((await api.call('DELETE', `${P}/control-points/CP-ENG-01`, { ...sys, headers: key('d') })).status, 422, 'a module control is never removed');
  // reason codes: the ones the dialogs always offered, and the new ones
  const cancel = (await api.call('GET', `/api/v1/ui/reason-codes?for=cancel`, pm)).json.data;
  assert.ok(cancel.some((c) => c.code === 'DUPLICATE'));
  const reverse = (await api.call('GET', `/api/v1/ui/reason-codes?for=reverse`, pm)).json.data;
  assert.ok(reverse.some((c) => c.code === 'WRONG_POSTING'));
  assert.equal((await api.call('POST', `${P}/reason-codes`, { ...pm, headers: key('r'), body: { actionType: 'reverse', code: 'X_CODE', label: 'Nope' } })).status, 403);
  let r = await api.call('POST', `${P}/reason-codes`, { ...sys, headers: key('r'), body: { actionType: 'reverse', code: 'WRONG_GST', label: 'Wrong GST rate applied', requiresEvidence: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok((await api.call('GET', `/api/v1/ui/reason-codes?for=reverse`, pm)).json.data.some((c) => c.code === 'WRONG_GST' && c.requiresEvidence));
  // a company can switch a shared code off for itself without touching the others
  r = await api.call('POST', `${P}/reason-codes`, { ...sys, headers: key('r'), body: { actionType: 'reverse', code: 'DUPLICATE_ENTRY', label: 'Entered twice', active: false } });
  assert.equal(r.status, 201);
  assert.ok(!(await api.call('GET', `/api/v1/ui/reason-codes?for=reverse`, pm)).json.data.some((c) => c.code === 'DUPLICATE_ENTRY'));
  await setupCompany(api, { company: '2' });
  assert.ok((await api.call('GET', `/api/v1/ui/reason-codes?for=reverse`, as('PM', 'pm9', '2'))).json.data.some((c) => c.code === 'DUPLICATE_ENTRY'));
  const stale = await api.call('PUT', `${P}/reason-codes`, { ...sys, headers: key('r'), body: { actionType: 'reverse', code: 'WRONG_GST', label: 'Wrong GST', version: 99 } });
  assert.equal(stale.status, 409);
  await api.close();
});

test('AC-04 FR-07 who sees and does what: exceptions are private to those who raise them and those who watch; the dashboard and the export follow the permission; another company sees nothing', async () => {
  const api = await setup();
  mode(api, 'CP-ENG-01', 'ENFORCE');
  const doc = await make(api, pd, '900000.00', 'Large');
  await submit(api, pd, doc);
  await flush();
  const ex = (await raise(api, pd, doc)).json.data;
  assert.equal((await api.call('GET', `${P}/exceptions/${ex.id}`, pd)).status, 200);
  assert.equal((await api.call('GET', `${P}/exceptions/${ex.id}`, sk)).status, 404, 'a store keeper who has no part in it');
  assert.equal((await api.call('GET', `${P}/exceptions`, sk)).json.data.total, 0);
  assert.equal((await api.call('GET', `${P}/exceptions`, aud)).json.data.total, 1);
  assert.equal((await api.call('GET', `${P}/exceptions/${ex.id}`, as('AUD', 'aud2', '2'))).status, 404);
  assert.equal((await api.call('GET', `${P}/dashboard`, sk)).status, 403);
  assert.equal((await api.call('GET', `${P}/control-points`, sk)).status, 403);
  assert.equal((await api.call('PUT', `${P}/exceptions/${ex.id}`, { ...sk, headers: key('u'), body: { reasonCode: 'ONE_TIME', justification: 'A different justification written by somebody else.' } })).status, 404);
  const upd = await api.call('PUT', `${P}/exceptions/${ex.id}`, { ...pd, headers: key('u'), body: { reasonCode: 'ONE_TIME', justification: 'A different justification written by the person who raised it.', version: 1 } });
  assert.equal(upd.status, 200);
  assert.equal((await api.call('PUT', `${P}/exceptions/${ex.id}`, { ...pd, headers: key('u'), body: { reasonCode: 'ONE_TIME', justification: 'A different justification written by the person who raised it.', version: 1 } })).status, 409, 'a stale version');
  // idempotent replay of a create
  const k = key('same');
  const d2 = await make(api, pd, '900000.00', 'Large two');
  await submit(api, pd, d2);
  await flush();
  const a = await api.call('POST', `${P}/exceptions`, { ...pd, headers: k, body: { controlCode: 'CP-ENG-01', entity: 'sample_doc', entityId: String(d2.id), reasonCode: 'ONE_TIME', justification: 'The same request sent twice by a flaky phone connection.' } });
  const b = await api.call('POST', `${P}/exceptions`, { ...pd, headers: k, body: { controlCode: 'CP-ENG-01', entity: 'sample_doc', entityId: String(d2.id), reasonCode: 'ONE_TIME', justification: 'The same request sent twice by a flaky phone connection.' } });
  assert.deepEqual([a.status, b.status, a.json.data.id === b.json.data.id], [201, 201, true]);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM pcs_exceptions').get().n, 2);
  // the dashboard and the export
  const dash = (await api.call('GET', `${P}/dashboard`, aud)).json.data;
  assert.equal(dash.tiles.open, 0, 'drafts are not open approvals');
  assert.ok(dash.topFailing.some((f) => f.control === 'CP-ENG-01'));
  assert.equal(dash.rollout.ENFORCE >= 1, true);
  const csv = await api.raw('GET', `${P}/exceptions/export?format=csv`, aud);
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString('utf8'), /EXC-00001/);
  assert.equal((await api.raw('GET', `${P}/exceptions/export?format=pdf`, aud)).status, 200);
  // the flag
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.eng.p0404'").run();
  await api.close();
});
