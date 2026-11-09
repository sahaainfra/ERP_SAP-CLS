import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { procurementCheck } from '../src/server/modules/engg/submittals.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 11.03: submittals. T-01 a purchase order for an item with a rejected (or pending) material approval is blocked when configured, warns by default, and passes for an approved make. Also: the types and the register fields, the required-by date from the need date,
// the internal approval (the quality control manager for materials, the construction manager for method statements; the sender never signs), the response codes A to D and the revision cycle, approved makes, the schedule and the overdue report, roles, isolation and the flag.
const E = '/api/v1/engg';
const W = '/api/v1/workflow';
const C = '/api/v1/core';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `su-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const qce = as('QCE', 'uqce1'); const qcm = as('QCMGR', 'uqcm1'); const qcm2 = as('QCMGR', 'uqcm2'); const cm = as('CM', 'ucm1'); const des = as('DESIGN', 'udes1'); const se = as('SE', 'use1'); const pm = as('PM', 'upm1'); const bd = as('BD', 'ubd1'); const qs = as('QS', 'uqs1');
const opened = []; const dirs = [];
after(async () => { for (const a of opened) await a.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function setup() {
  const storage = mkdtempSync(join(tmpdir(), 'erp-sub-')); dirs.push(storage);
  const api = await startApi({}, { storagePath: storage }); opened.push(api); await setupCompany(api);
  for (const [n, r] of [['uqce1', ['QCE']], ['uqcm1', ['QCMGR']], ['uqcm2', ['QCMGR']], ['ucm1', ['CM']], ['udes1', ['DESIGN']], ['use1', ['SE']], ['upm1', ['PM']], ['ubd1', ['BD']], ['uqs1', ['QS']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'BUILDING').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'upm1', 'test')").run(id); return id; };
  const a = mk('SBA', 'Alpha towers'); const b = mk('SBB', 'Beta bridge');
  const cat = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, steward_role, created_by, source_type) VALUES (1, 'CEM', 'Cement', 'CEM', 'PROCMGR', 't', 'test')").run().lastInsertRowid);
  const item = Number(api.db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, created_by, source_type) VALUES (1, 'CEM-OPC53', 'OPC 53 grade cement', 'MATERIAL', ?, 'BAG', '2020-01-01', 't', 'test')").run(cat).lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${E}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const jobs = runtimeOf(api.db).jobs;
  const attach = async (who, id) => { const fd = new FormData(); fd.append('entity', 'engg_submittal'); fd.append('entityId', String(id)); fd.append('file', new Blob([PNG]), 'datasheet.png'); const r = await api.raw('POST', `${C}/files`, { ...who, body: fd }); assert.equal(r.status, 201, JSON.stringify(r.json)); await jobs.drain(); };
  return { api, call, act, hasTask, attach, a, b, item };
}
const mar = (t, over = {}) => ({ projectId: t.a, type: 'MAR', title: 'OPC 53 grade cement for the foundation concrete', specSection: '03 30 00', activityRef: 'A1010 Foundation concrete', itemId: t.item, make: 'UltraTech', model: 'OPC 53', supplier: 'Sri Traders', consultant: 'Mehta Associates', needDate: plus(60), leadTimeDays: 21, reviewDays: 14, ...over });
/** Created, documents attached, sent, approved internally; it is now with the consultant. */
async function sent(t, over = {}, who = qce) {
  const c = await t.call(who, 'POST', '/submittals', mar(t, over)); assert.equal(c.status, 201, JSON.stringify(c.json)); await t.attach(who, c.json.data.id);
  const s = await t.call(who, 'POST', `/submittals/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json));
  const reviewer = c.json.data.internalApprover === 'CM' ? cm : qcm; await t.act(reviewer, s.json.data.workflowInstanceId);
  return (await t.call(who, 'GET', `/submittals/${c.json.data.id}`)).json.data;
}

test('T-01 the purchase order check: a pending, rejected or other-make item warns or blocks; an approved make passes', async () => {
  const t = await setup(); const q = (extra = '') => `/submittals/po-check?projectId=${t.a}&itemId=${t.item}${extra}`;
  assert.deepEqual([(await t.call(se, 'GET', q())).json.data.status, (await t.call(se, 'GET', q())).json.data.reason], ['OK', 'NO_MAR_REQUIRED'], 'no material approval is required for an item with none registered');
  const s = await sent(t); assert.equal(s.status, 'WITH_CONSULTANT');
  const pend = (await t.call(se, 'GET', q())).json.data; assert.deepEqual([pend.status, pend.reason, pend.mode], ['WARN', 'PENDING', 'WARN'], 'pending: a warning by default');
  // the company configures a block
  const rej = await t.call(qcm, 'POST', `/submittals/${s.id}/respond`, { code: 'D', text: 'The make does not meet the strength class' }); assert.equal(rej.json.data.status, 'REJECTED');
  assert.deepEqual([(await t.call(se, 'GET', q())).json.data.reason, (await t.call(se, 'GET', q())).json.data.status], ['REJECTED', 'WARN']);
  assert.equal(procurementCheck(t.api.db, { companyId: 1, projectId: t.a, itemId: t.item }).reason, 'REJECTED');
  // a second MAR with another make is approved: that make passes, another make does not
  const s2 = await sent(t, { make: 'Ambuja', model: 'OPC 53 S', title: 'OPC 53 cement, alternative make' }); const ok = await t.call(qcm, 'POST', `/submittals/${s2.id}/respond`, { code: 'B', text: 'Use only with the batch certificates' }); assert.equal(ok.json.data.status, 'APPROVED');
  assert.deepEqual([(await t.call(se, 'GET', q('&make=Ambuja'))).json.data.status, (await t.call(se, 'GET', q('&make=Ambuja'))).json.data.reason], ['OK', 'APPROVED']);
  const other = (await t.call(se, 'GET', q('&make=Birla'))).json.data; assert.deepEqual([other.status, other.reason, other.approvedMakes.map((m) => m.make)], ['WARN', 'MAKE_NOT_APPROVED', ['Ambuja']]);
  assert.deepEqual((await t.call(pm, 'GET', `/approved-makes?projectId=${t.a}`)).json.data.map((m) => [m.make, m.model, m.code, m.submittalNo]), [['Ambuja', 'OPC 53 S', 'B', s2.submittalNo]]);
  assert.equal((await t.call(se, 'GET', `/submittals/po-check?projectId=${t.b}&itemId=${t.item}`)).json.data.reason, 'NO_MAR_REQUIRED', 'another project has its own approvals');
  assert.equal((await t.call(bd, 'GET', q())).status, 403);
  for (const e of ['engg.submittal.submitted', 'engg.submittal.responded', 'engg.submittal.approved']) assert.ok(t.api.db.prepare('SELECT 1 FROM core_outbox WHERE event_type = ?').get(e), `${e} went out`);
  const ap = JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'engg.submittal.approved'").get().payload).data; assert.deepEqual([ap.make, ap.itemId, ap.code], ['Ambuja', t.item, 'B']);
});

test('T-01 the block: with the company parameter set to BLOCK the check says BLOCK', async () => {
  const t = await setup();
  const c = await t.call(qce, 'POST', '/submittals', mar(t)); assert.equal(c.status, 201);
  t.api.db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'engg.po_mar_control', 'BLOCK', 'string', 'company', 1, '2020-01-01', 't', 'test')").run();
  const r = (await t.call(se, 'GET', `/submittals/po-check?projectId=${t.a}&itemId=${t.item}`)).json.data; assert.deepEqual([r.status, r.reason, r.mode], ['BLOCK', 'PENDING', 'BLOCK']);
});

test('FR-01 to FR-03 the register, the internal approval by type, the response codes and the revision cycle', async () => {
  const t = await setup();
  assert.equal((await t.call(bd, 'POST', '/submittals', mar(t))).status, 403); assert.equal((await t.call(qs, 'POST', '/submittals', mar(t))).status, 403);
  for (const bad of [{ type: 'LETTER' }, { title: 'x' }, { itemId: 99999 }, { wbsId: 99999 }, { drawingId: 99999 }, { needDate: undefined, requiredBy: undefined }, { extra: 1 }, { leadTimeDays: -1 }]) assert.equal((await t.call(qce, 'POST', '/submittals', mar(t, bad))).status, 400, JSON.stringify(bad));
  const c = await t.call(qce, 'POST', '/submittals', mar(t)); const r0 = c.json.data;
  assert.deepEqual([r0.submittalNo, r0.status, r0.revision, r0.requiredBy, r0.internalApprover, r0.typeLabel], ['SUB-00001', 'DRAFT', 1, plus(60 - 35), 'QCMGR', 'Material approval'], 'required-by = need date - lead time - review days');
  assert.equal((await t.call(qce, 'PATCH', `/submittals/${r0.id}`, { leadTimeDays: 30 })).json.data.requiredBy, plus(60 - 44)); assert.equal((await t.call(qce, 'PATCH', `/submittals/${r0.id}`, { requiredBy: plus(5) })).json.data.requiredBy, plus(5)); assert.equal((await t.call(qce, 'PATCH', `/submittals/${r0.id}`, { title: 'X', rowVersion: 1 })).status, 400);
  assert.equal((await t.call(qce, 'POST', `/submittals/${r0.id}/submit`)).status, 422, 'documents are attached first'); await t.attach(qce, r0.id);
  const noMake = await t.call(qce, 'POST', '/submittals', mar(t, { make: undefined, model: undefined })); await t.attach(qce, noMake.json.data.id); assert.equal((await t.call(qce, 'POST', `/submittals/${noMake.json.data.id}/submit`)).status, 422, 'a MAR names the make');
  const s = await t.call(qce, 'POST', `/submittals/${r0.id}/submit`); const wf = s.json.data.workflowInstanceId; assert.equal(s.json.data.status, 'SUBMITTED');
  assert.equal(await t.hasTask(qce, wf), false, 'the sender does not sign'); assert.equal(await t.hasTask(cm, wf), false, 'a material is checked by quality control, not by the construction manager'); assert.equal(await t.hasTask(qcm, wf), true);
  assert.equal((await t.call(qce, 'PATCH', `/submittals/${r0.id}`, { title: 'Late change' })).status, 409);
  await t.act(qcm, wf, 'return'); assert.equal((await t.call(qce, 'GET', `/submittals/${r0.id}`)).json.data.status, 'RETURNED');
  const again = await t.call(qce, 'POST', `/submittals/${r0.id}/submit`); assert.equal(again.json.data.workflowInstanceId, wf); await t.act(qcm, wf);
  const w = (await t.call(qce, 'GET', `/submittals/${r0.id}`)).json.data; assert.deepEqual([w.status, w.submittedOn, w.revisions[0].submittedOn], ['WITH_CONSULTANT', plus(0), plus(0)]);
  // the response: rights, rules, C starts a new revision
  assert.equal((await t.call(qce, 'POST', `/submittals/${r0.id}/respond`, { code: 'A' })).status, 403); assert.equal((await t.call(qcm, 'POST', `/submittals/${r0.id}/respond`, { code: 'C' })).status, 400, 'a comment goes with C'); assert.equal((await t.call(qcm, 'POST', `/submittals/${r0.id}/respond`, { code: 'E' })).status, 400); assert.equal((await t.call(qcm, 'POST', `/submittals/${r0.id}/respond`, { code: 'A', responseOn: plus(3) })).status, 400);
  const c1 = await t.call(des, 'POST', `/submittals/${r0.id}/respond`, { code: 'C', text: 'Add the manufacturer test certificate for the 28-day strength' }); assert.deepEqual([c1.json.data.status, c1.json.data.responseCode, c1.json.data.revisions[0].responseCode], ['REVISE', 'C', 'C']);
  assert.equal((await t.call(des, 'POST', `/submittals/${r0.id}/respond`, { code: 'A' })).status, 422, 'answered');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'engg.submittal.responded' AND user_ref = 'uqce1'").get().n, 1, 'the preparer is told');
  assert.equal((await t.call(qs, 'POST', `/submittals/${r0.id}/resubmit`, { changeNote: 'Certificate added' })).status, 403); assert.equal((await t.call(qce, 'POST', `/submittals/${r0.id}/resubmit`, { changeNote: 'x' })).status, 400);
  const rs = await t.call(qce, 'POST', `/submittals/${r0.id}/resubmit`, { changeNote: 'Test certificate added' }); assert.deepEqual([rs.json.data.status, rs.json.data.revision, rs.json.data.responseCode, rs.json.data.revisions.length], ['DRAFT', 2, null, 2]);
  const s2 = await t.call(qce, 'POST', `/submittals/${r0.id}/submit`); await t.act(qcm, s2.json.data.workflowInstanceId);
  const a = await t.call(qcm, 'POST', `/submittals/${r0.id}/respond`, { code: 'A', text: null }); assert.deepEqual([a.json.data.status, a.json.data.revision, a.json.data.approvedMake.make, a.json.data.approvedMake.status], ['APPROVED', 2, 'UltraTech', 'ACTIVE']);
  // amend: an approved submittal is reopened, its approved make is withdrawn
  const am = await t.call(qcm, 'POST', `/submittals/${r0.id}/amend`, { reason: 'The supplier changed the plant of manufacture' }); assert.equal(am.status, 200, JSON.stringify(am.json)); assert.deepEqual([am.json.data.status, am.json.data.revision], ['DRAFT', 3]);
  assert.deepEqual((await t.call(pm, 'GET', `/approved-makes?projectId=${t.a}`)).json.data, []);
  // method statements are checked by the construction manager
  const ms = await t.call(se, 'POST', '/submittals', { projectId: t.a, type: 'METHOD_STATEMENT', title: 'Method statement for the pier 4 pour', hseRef: 'RA-014', activityRef: 'A1010', requiredBy: plus(10), reviewDays: 7, leadTimeDays: 0 }); assert.equal(ms.json.data.internalApprover, 'CM');
  await t.attach(se, ms.json.data.id); const mss = await t.call(se, 'POST', `/submittals/${ms.json.data.id}/submit`); assert.equal(await t.hasTask(cm, mss.json.data.workflowInstanceId), true); assert.equal(await t.hasTask(qcm, mss.json.data.workflowInstanceId), false); await t.act(cm, mss.json.data.workflowInstanceId);
  const mr = await t.call(qcm, 'POST', `/submittals/${ms.json.data.id}/respond`, { code: 'A' }); assert.equal(mr.json.data.approvedMake, null, 'only a material approval makes an approved make');
  assert.equal(JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'engg.submittal.approved' ORDER BY id DESC").get().payload).data.hseRef, 'RA-014', 'the method statement goes to HSE');
  const h = (await t.call(qce, 'GET', `/submittals/${r0.id}/history`)).json.data; assert.ok(h.approvals.length >= 4); assert.equal(h.revisions.length, 3);
});

test('FR-06 the schedule and overdue report; register, cancel, delete, import, print, export; isolation and the flag', async () => {
  const t = await setup();
  const late = await t.call(qce, 'POST', '/submittals', mar(t, { title: 'Late one', needDate: undefined, requiredBy: plus(-5) })); const fine = await t.call(qce, 'POST', '/submittals', mar(t, { title: 'Future one', make: 'Birla', needDate: undefined, requiredBy: plus(20) }));
  const done = await sent(t, { title: 'Approved on time', make: 'ACC', needDate: undefined, requiredBy: plus(10) }); await t.call(qcm, 'POST', `/submittals/${done.id}/respond`, { code: 'A' });
  const sc = (await t.call(pm, 'GET', `/submittal-schedule?projectId=${t.a}`)).json.data; assert.deepEqual([sc.counts.total, sc.counts.overdue, sc.counts.onTime, sc.counts.pending], [3, 1, 1, 1]); assert.deepEqual(sc.overdue.map((x) => x.title), ['Late one']); assert.ok(sc.overdue[0].varianceDays >= 5); assert.equal(sc.byType.MAR.total, 3);
  assert.equal((await t.call(qce, 'GET', `/submittals?filter[projectId]=${t.a}&filter[overdue]=1`)).json.data.length, 1); assert.equal((await t.call(qce, 'GET', '/submittals?q=future')).json.data.length, 1);
  // cancel / delete
  assert.equal((await t.call(qce, 'POST', `/submittals/${fine.json.data.id}/cancel`, { reason: 'x' })).status, 400); assert.equal((await t.call(qce, 'POST', `/submittals/${fine.json.data.id}/cancel`, { reason: 'No longer needed: the make was dropped' })).json.data.status, 'CANCELLED');
  assert.equal((await t.call(qce, 'DELETE', `/submittals/${late.json.data.id}`)).json.data.deleted, true); assert.equal((await t.call(qce, 'GET', `/submittals/${late.json.data.id}`)).status, 404);
  // import / print / export
  const imp = await t.call(qce, 'POST', '/submittals/import', { projectId: t.a, rows: [{ type: 'SHOP_DRAWING', title: 'Shop drawing of the stair railing', requiredBy: plus(15), leadTimeDays: 0, reviewDays: 14 }, { type: 'SAMPLE', title: 'Tile sample', leadTimeDays: 0, reviewDays: 14 }] }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.deepEqual([imp.json.data.created, imp.json.data.errors[0].row], [1, 2]);
  assert.match((await t.api.raw('GET', `${E}/submittals/${done.id}/print`, pm)).buffer.toString(), /Approved on time/); assert.equal((await t.api.raw('GET', `${E}/submittals/${done.id}/print`, qs)).status, 403);
  assert.match((await t.api.raw('GET', `${E}/submittals/export?format=csv`, pm)).buffer.toString(), /Approved on time/); assert.equal((await t.api.raw('GET', `${E}/submittals/export?format=csv`, qce)).status, 403);
  t.api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'OTH', 'Other Pvt Ltd', 'Other', 't', 'test')").run(); assert.equal((await t.api.call('GET', `${E}/submittals/${done.id}`, as('QCMGR', 'uqcm1', '2'))).status, 404);
  assert.equal((await t.call(qs, 'GET', '/submittals')).status, 200); void qcm2;
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.engg.p1103'").run(); assert.equal((await t.call(qce, 'GET', '/submittals')).status, 404, 'flag off'); assert.equal((await t.call(des, 'GET', '/drawings')).status, 200); t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.engg.p1103'").run();
});
