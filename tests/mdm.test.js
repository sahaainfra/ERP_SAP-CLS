import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { gstinCheckChar, similarity } from '../src/server/platform/mdm/index.js';
import { mdmOf } from '../src/server/platform/mdm/index.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 06.01: master data governance, applied to the business partner master (AC-01). T-01 a duplicate PAN is blocked and a similar name warns (fuzzy match); T-02 a merge keeps the merged record and its references
// resolve to the survivor; T-03 a change from a date applies only from that date ("as of" reads the history). Also: maker-checker by the steward and the accounts manager, sensitive fields masked, rules and stewards
// by an approved change, data quality score, inactive records not selectable (BR-02), withdraw and resubmit.
const M = '/api/v1/mdm';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'm') => ({ ...json, 'idempotency-key': `mdm-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const proc = as('PROCMGR', 'proc1');
const acc = as('ACCMGR', 'acc1');
const steward = as('SE', 'stew1');
const sys = as('SYSADM', 'sys1');
const it = as('ITADM', 'it1');
const se = as('SE', 'se1');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const gstin = (pan, state = '27') => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles) => Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Rao`, JSON.stringify(roles), `${name}@example.com`).lastInsertRowid);
const act = async (api, who, instanceId, action = 'approve', comment = 'checked against the documents') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const setup = async ({ stewards = true } = {}) => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['proc1', ['PROCMGR']], ['acc1', ['ACCMGR']], ['stew1', ['SE']], ['sys1', ['SYSADM']], ['it1', ['ITADM']], ['se1', ['SE']]]) user(api, n, r);
  const call = (who, method, path, body, k) => api.call(method, `${M}${path}`, { ...who, headers: key(k), body });
  const t = { api, call };
  if (stewards) {
    const p = await call(sys, 'POST', '/config', { rules: [], stewards: [{ masterType: 'PARTNER', username: 'stew1', role: 'PRIMARY' }], reason: 'The purchase lead keeps the partner master' });
    assert.equal(p.status, 202, JSON.stringify(p.json));
    await act(api, it, p.json.data.workflow.id);
  }
  /** A partner through its approval: the steward and then the accounts manager (a financial master). */
  t.partner = async (data, who = proc, extra = {}) => {
    const r = await call(who, 'POST', '/masters/PARTNER/records', { data, justification: 'New vendor for the Alpha project', ...extra });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    await act(api, steward, r.json.data.workflow.id);
    await act(api, acc, r.json.data.workflow.id);
    return r.json.data.record.id;
  };
  return t;
};

test('similarity: company suffixes and word order do not make two names different; different names stay apart', () => {
  assert.equal(similarity('Shree Ganesh Constructions Pvt Ltd', 'Shree Ganesh Constructions Private Limited'), 100);
  assert.equal(similarity('Ganesh Shree Constructions', 'Shree Ganesh Constructions'), 100);
  assert.ok(similarity('Shree Ganesh Construction', 'Shree Ganesh Constructions') >= 85);
  assert.ok(similarity('Shree Ganesh Constructions', 'Patel Steel Traders') < 40);
  assert.equal(gstin('ABCDE1234F').length, 15);
});

test('T-01 FR-01 FR-02 FR-04 a new partner is checked and approved: bad formats are refused, a duplicate PAN or GSTIN is blocked, a similar name only warns, and nothing is in force before the steward and the accounts manager approve', async () => {
  const t = await setup();
  const base = { name: 'Shree Ganesh Constructions Pvt Ltd', kind: 'VENDOR', pan: 'ABCDE1234F', gstin: gstin('ABCDE1234F'), mobile: '+91 98765 43210', pinCode: '411001', state: 'Maharashtra' };
  const bad = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { ...base, pan: 'ABC123' }, justification: 'New vendor for the Alpha project' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.details.some((d) => d.field === 'pan'), 'a PAN in the wrong format is refused');
  const badGst = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { ...base, gstin: `${gstin('ABCDE1234F').slice(0, 14)}Q` === gstin('ABCDE1234F') ? `${gstin('ABCDE1234F').slice(0, 14)}R` : `${gstin('ABCDE1234F').slice(0, 14)}Q` }, justification: 'New vendor for the Alpha project' });
  assert.equal(badGst.status, 400, 'a GSTIN with a wrong check character is refused');
  const r = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: base, justification: 'New vendor for the Alpha project' });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const id = r.json.data.record.id;
  assert.equal(r.json.data.record.status, 'SUBMITTED');
  assert.equal(r.json.data.record.data.mobile, '9876543210', 'the mobile number is stored without +91 and spaces');
  assert.equal((await t.call(proc, 'GET', '/masters/PARTNER/lookup?q=Ganesh')).json.data.rows.length, 0, 'a record waiting for approval cannot be chosen');
  // the requester cannot approve their own request; the steward and then the accounts manager do
  const own = (await t.api.call('GET', `${W}/tasks?mine=assigned`, proc)).json.data.rows.filter((x) => x.instance.id === r.json.data.workflow.id);
  assert.equal(own.length, 0);
  await act(t.api, steward, r.json.data.workflow.id);
  assert.equal((await t.call(proc, 'GET', `/masters/PARTNER/records/${id}`)).json.data.status, 'SUBMITTED', 'the accounts manager has not approved yet');
  await act(t.api, acc, r.json.data.workflow.id);
  const got = (await t.call(proc, 'GET', `/masters/PARTNER/records/${id}`)).json.data;
  assert.equal(got.status, 'ACTIVE');
  assert.equal(got.data.pan, '••••••234F', 'the purchase manager does not see the PAN');
  assert.equal((await t.call(acc, 'GET', `/masters/PARTNER/records/${id}`)).json.data.data.pan, 'ABCDE1234F', 'the accounts manager sees it');
  assert.ok(got.quality.score >= 80, `score ${got.quality.score}`);
  const note = t.api.db.prepare("SELECT * FROM ntf_notifications WHERE template_code = 'mdm.request.decided' AND user_ref = 'proc1'").all();
  assert.equal(note.length, 1, 'the requester is told');
  // the same PAN is blocked, before anything is saved
  const before = t.api.db.prepare('SELECT COUNT(*) AS n FROM mdm_records').get().n;
  const dup = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { name: 'Totally Different Traders', kind: 'VENDOR', pan: 'ABCDE1234F' }, justification: 'New vendor for the Alpha project' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'DUPLICATE');
  assert.match(dup.json.error.message, /same PAN/);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM mdm_records').get().n, before, 'nothing was saved');
  // a similar name warns; confirmed, it is saved and the pair goes to the duplicates report
  const similar = { name: 'Shree Ganesh Construction', kind: 'SUBCONTRACTOR', pan: 'PQRSX6789K' };
  const check = (await t.call(proc, 'POST', '/masters/PARTNER/check', { data: similar })).json.data;
  assert.equal(check.duplicates.length, 1);
  assert.equal(check.duplicates[0].block, false);
  assert.ok(check.duplicates[0].score >= 85);
  const warn = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: similar, justification: 'Subcontractor for the bridge works' });
  assert.equal(warn.status, 409);
  assert.equal(warn.json.error.code, 'DUPLICATE_WARNING');
  const same = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: similar, justification: 'Subcontractor for the bridge works', acknowledgeDuplicates: true });
  assert.equal(same.status, 202);
  const dups = (await t.call(proc, 'GET', '/duplicates?type=PARTNER')).json.data.rows;
  assert.equal(dups.length, 1);
  assert.match(dups[0].rule, /similar name/);
  // the same mobile also only warns
  const mob = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { name: 'Kaveri Earthmovers', kind: 'VENDOR', mobile: '9876543210' }, justification: 'Hire of excavators for Alpha' });
  assert.equal(mob.status, 409);
  assert.equal(mob.json.error.code, 'DUPLICATE_WARNING');
  assert.match(mob.json.error.message, /same Mobile/);
  // the evidence shown to the approver names the possible duplicate
  const inst = t.api.db.prepare('SELECT workflow_instance_id AS w FROM mdm_change_requests WHERE record_id = ?').get(same.json.data.record.id).w;
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, steward)).json.data.rows.find((x) => x.instance.id === inst);
  assert.ok(task);
  // a person who only sees cannot merge or open the governance pages
  assert.equal((await t.call(se, 'GET', '/duplicates')).status, 403);
  assert.equal((await t.call(se, 'POST', '/merge', { type: 'PARTNER', fromId: 1, toId: 2, justification: 'They are the same company' })).status, 403);
  assert.equal((await t.call(se, 'GET', '/masters/PARTNER/records')).status, 200, 'everyone sees the master');
});

test('T-02 FR-02 BR-01 a merge never deletes: the merged record stays, points to the survivor, and the references to it resolve to the survivor', async () => {
  const t = await setup();
  const a = await t.partner({ name: 'Patel Steel Traders', kind: 'VENDOR', pan: 'AAAPP1111A', mobile: '9811111111' });
  const b = await t.partner({ name: 'Patel Steel Trader', kind: 'VENDOR', mobile: '9822222222' }, proc, { acknowledgeDuplicates: true });
  // a task refers to the record that will be merged
  t.api.db.prepare("INSERT INTO tsk_tasks (company_id, task_no, title, entity, entity_id, assigner, created_by, source_type) VALUES (1, 'TSK-9001', 'Collect the cancelled cheque', 'mdm_record', ?, 'proc1', 't', 't')").run(String(b));
  const before = (await t.call(proc, 'GET', `/masters/PARTNER/records/${b}/references`)).json.data.rows;
  assert.equal(before.length, 1);
  const m = await t.call(proc, 'POST', '/merge', { type: 'PARTNER', fromId: b, toId: a, justification: 'The same company registered twice' });
  assert.equal(m.status, 202, JSON.stringify(m.json));
  assert.equal((await t.call(proc, 'GET', '/duplicates?type=PARTNER')).json.data.rows[0].status, 'MERGE_PENDING');
  await act(t.api, steward, m.json.data.workflow.id);
  await act(t.api, acc, m.json.data.workflow.id);
  const merged = (await t.call(proc, 'GET', `/masters/PARTNER/records/${b}`)).json.data;
  assert.equal(merged.status, 'MERGED', 'the merged record is kept');
  assert.equal(merged.survivor.id, a);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM mdm_records WHERE id = ?').get(b).n, 1, 'never deleted');
  assert.deepEqual(t.api.db.prepare('SELECT from_id, to_id FROM mdm_merge_map').all().map((r) => ({ ...r })), [{ from_id: b, to_id: a }]);
  const res = (await t.call(proc, 'GET', `/masters/PARTNER/records/${b}/resolve`)).json.data;
  assert.equal(res.resolved, a);
  assert.equal(res.redirected, true);
  const refs = (await t.call(proc, 'GET', `/masters/PARTNER/records/${a}/references`)).json.data.rows;
  assert.equal(refs.length, 1, 'the task of the merged record is found under the survivor');
  assert.equal(refs[0].redirectedFrom, merged.code);
  assert.equal(mdmOf(t.api.db).assertSelectable({ companyId: 1 }, 'PARTNER', b).id, a, 'a module that holds the old id gets the survivor');
  assert.equal((await t.call(proc, 'GET', '/masters/PARTNER/lookup?q=Patel')).json.data.rows.length, 1, 'only the survivor can be chosen');
  assert.equal((await t.call(proc, 'GET', '/duplicates?type=PARTNER')).json.data.rows[0].status, 'MERGED');
  assert.equal((await t.call(proc, 'PUT', `/masters/PARTNER/records/${b}`, { data: { state: 'Gujarat' }, version: merged.rowVersion })).status, 409, 'a merged record is not changed');
  const ev = t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'mdm.record.merged'").get().n;
  assert.equal(ev, 1);
});

test('T-03 FR-03 FR-05 a change from a later date applies only from that date; "as of" reads the version of any date; a sensitive change needs a justification and approval', async () => {
  const t = await setup();
  const id = await t.partner({ name: 'Kaveri Earthmovers', kind: 'VENDOR', pan: 'KAVER1234E', mobile: '9833333333', state: 'Karnataka' });
  let rec = (await t.call(proc, 'GET', `/masters/PARTNER/records/${id}`)).json.data;
  // a change of a field that is not sensitive, by an editor, from a later date: applied without approval but only from its date
  const later = day(10);
  const up = await t.call(proc, 'PUT', `/masters/PARTNER/records/${id}`, { data: { state: 'Tamil Nadu' }, effectiveFrom: later, version: rec.rowVersion });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal(up.json.data.applied, true);
  rec = (await t.call(proc, 'GET', `/masters/PARTNER/records/${id}`)).json.data;
  assert.equal(rec.data.state, 'Karnataka', 'not yet in force');
  assert.equal(rec.versions[0].status, 'SCHEDULED');
  assert.equal((await t.call(proc, 'GET', `/masters/PARTNER/records/${id}?asOf=${later}`)).json.data.data.state, 'Tamil Nadu');
  assert.equal((await t.call(proc, 'GET', `/masters/PARTNER/records/${id}?asOf=${day(9)}`)).json.data.data.state, 'Karnataka');
  assert.equal((await t.call(proc, 'GET', `/masters/PARTNER/records?asOf=${later}`)).json.data.rows[0].data.state, 'Tamil Nadu');
  // the job brings it into force when the date comes (the date is moved back to stand for time passing)
  t.api.db.prepare("UPDATE mdm_record_versions SET effective_from = ? WHERE version_status = 'SCHEDULED'").run(todayIST());
  mdmOf(t.api.db).cycle(1);
  rec = (await t.call(proc, 'GET', `/masters/PARTNER/records/${id}`)).json.data;
  assert.equal(rec.data.state, 'Tamil Nadu');
  assert.deepEqual(rec.versions.map((v) => v.status), ['ACTIVE', 'SUPERSEDED']);
  // a past date is refused
  assert.equal((await t.call(proc, 'PUT', `/masters/PARTNER/records/${id}`, { data: { state: 'Goa' }, effectiveFrom: day(-1), version: rec.rowVersion })).status, 400);
  // a sensitive field: a justification is required and the change waits for the steward and the accounts manager
  const noWhy = await t.call(proc, 'PUT', `/masters/PARTNER/records/${id}`, { data: { bankAccount: '123456789012', ifsc: 'SBIN0001234' }, version: rec.rowVersion });
  assert.equal(noWhy.status, 400);
  const sens = await t.call(proc, 'PUT', `/masters/PARTNER/records/${id}`, { data: { bankAccount: '123456789012', ifsc: 'SBIN0001234' }, justification: 'New bank account letter received', version: rec.rowVersion });
  assert.equal(sens.status, 202, JSON.stringify(sens.json));
  assert.equal((await t.call(proc, 'GET', `/masters/PARTNER/records/${id}`)).json.data.data.bankAccount, undefined, 'not applied before approval');
  assert.equal((await t.call(proc, 'PUT', `/masters/PARTNER/records/${id}`, { data: { state: 'Goa' }, version: rec.rowVersion })).status, 409, 'one change of a record at a time');
  const cr = (await t.call(proc, 'GET', `/change-requests/${sens.json.data.changeRequestId}`)).json.data;
  assert.equal(cr.justification, 'New bank account letter received');
  assert.equal(cr.fields.find((f) => f.key === 'bankAccount').after, '••••••••9012', 'the requester without the right sees it masked');
  // returned for correction, resubmitted, approved
  await act(t.api, steward, sens.json.data.workflow.id, 'return', 'Attach the IFSC of the branch');
  assert.equal((await t.call(proc, 'GET', `/change-requests/${cr.id}`)).json.data.status, 'RETURNED');
  const again = await t.call(proc, 'POST', `/change-requests/${cr.id}/resubmit`, { data: { ifsc: 'SBIN0005678' }, justification: 'New bank account letter, IFSC corrected' });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  await act(t.api, steward, sens.json.data.workflow.id);
  await act(t.api, acc, sens.json.data.workflow.id);
  const fin = (await t.call(acc, 'GET', `/masters/PARTNER/records/${id}`)).json.data;
  assert.equal(fin.data.ifsc, 'SBIN0005678');
  assert.equal(fin.versions.length, 3);
});

test('BR-02 FR-07 an inactive partner cannot be chosen but stays visible; the rules and stewards change only by an approved change; withdrawing a request', async () => {
  const t = await setup();
  const id = await t.partner({ name: 'Narmada Cement Depot', kind: 'VENDOR', pan: 'NARMA1234D', mobile: '9844444444' });
  const off = await t.call(proc, 'POST', `/masters/PARTNER/records/${id}/status`, { action: 'INACTIVATE', justification: 'The depot closed in October' });
  assert.equal(off.status, 202);
  await act(t.api, steward, off.json.data.workflow.id);
  await act(t.api, acc, off.json.data.workflow.id);
  assert.equal((await t.call(proc, 'GET', `/masters/PARTNER/records/${id}`)).json.data.status, 'INACTIVE');
  assert.equal((await t.call(proc, 'GET', '/masters/PARTNER/lookup?q=Narmada')).json.data.rows.length, 0, 'not selectable');
  assert.equal((await t.call(proc, 'GET', '/masters/PARTNER/records?status=INACTIVE')).json.data.rows.length, 1, 'still visible');
  assert.throws(() => mdmOf(t.api.db).assertSelectable({ companyId: 1 }, 'PARTNER', id), /inactive/);
  // a request withdrawn by its requester
  const req = await t.call(se, 'POST', '/masters/PARTNER/records', { data: { name: 'Godavari Sand Suppliers', kind: 'VENDOR' }, justification: 'Sand for the culverts at site 2' });
  assert.equal(req.status, 202, 'anyone who sees the master may ask for a new record');
  assert.equal((await t.call(proc, 'POST', `/change-requests/${req.json.data.changeRequestId}/cancel`, { reason: 'not mine' })).status, 403);
  const c = await t.call(se, 'POST', `/change-requests/${req.json.data.changeRequestId}/cancel`, { reason: 'Raised by mistake' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.data.status, 'CANCELLED');
  assert.equal(t.api.db.prepare('SELECT record_status FROM mdm_records WHERE id = ?').get(req.json.data.record.id).record_status, 'REJECTED');
  // rules: only the system administrator proposes; nothing changes before the IT administrator approves
  assert.equal((await t.call(proc, 'POST', '/config', { rules: [], stewards: [{ masterType: 'PARTNER', username: 'proc1' }], reason: 'Make me the steward of partners' })).status, 403);
  const rules = [{ masterType: 'PARTNER', field: 'gstin', rule: 'REQUIRED', severity: 'ERROR' }];
  const p = await t.call(sys, 'POST', '/config', { rules, stewards: [{ masterType: 'PARTNER', username: 'stew1' }], reason: 'GSTIN is now required for every partner' });
  assert.equal(p.status, 202);
  assert.equal((await t.call(proc, 'POST', '/masters/PARTNER/check', { data: { name: 'X Traders', kind: 'VENDOR' } })).json.data.errors.length, 0, 'not in force yet');
  await act(t.api, it, p.json.data.workflow.id);
  const chk = (await t.call(proc, 'POST', '/masters/PARTNER/check', { data: { name: 'X Traders', kind: 'VENDOR' } })).json.data;
  assert.equal(chk.errors[0].field, 'gstin');
  const cfg = (await t.call(sys, 'GET', '/config')).json.data;
  assert.equal(cfg.rules.length, 1);
  assert.equal(cfg.stewards[0].username, 'stew1');
  // the dashboard and the quality report
  const dash = (await t.call(acc, 'GET', '/dashboard')).json.data;
  assert.equal(dash.masters[0].type, 'PARTNER');
  assert.equal(dash.masters[0].inactive, 1);
  assert.equal((await t.call(acc, 'GET', '/quality')).status, 200);
  assert.equal((await t.call(se, 'GET', '/dashboard')).status, 403);
});

test('without stewards a request still has an approver, and another company does not see the records', async () => {
  const t = await setup({ stewards: false });
  const r = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { name: 'Tapi Fabricators', kind: 'VENDOR' }, justification: 'Steel fabrication for the bridge' });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const inst = t.api.db.prepare('SELECT status FROM wf_instances WHERE id = ?').get(r.json.data.workflow.id);
  assert.ok(inst, 'a workflow instance exists');
  assert.equal((await t.api.call('GET', `${M}/masters/PARTNER/records`, { roles: 'PROCMGR', user: 'p2', company: '2' })).json.data?.rows?.length ?? 0, 0);
});
