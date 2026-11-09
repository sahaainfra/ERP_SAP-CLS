import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.12: employee advances, expense claims and travel. T-01 the policy limit of the grade applies, a duplicate bill is found, an advance settles against a claim and the net is right. Also: per diem and mileage computed by the server, the receipt
// rule, old bills, the approval chain by amount and by deviation (manager, accounts manager, CFO), the salary advance with its instalments for payroll, the hand-off events, the travel request, scope, idempotency and maker-checker on the policies.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const acc1 = as('ACCMGR', 'acc1'); const cfo1 = as('CFO', 'cfo1'); const pay1 = as('PAY', 'pay1');
const emp1 = as('EMP', 'emp1'); const emp2 = as('EMP', 'emp2'); const lead1 = as('EMP', 'lead1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'r') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const ist = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  const mkUser = (n, roles) => { user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, n, JSON.stringify(roles), `${n}@example.com`).lastInsertRowid); return user[n]; };
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['hr3', ['HRMGR']], ['acc1', ['ACCMGR']], ['acc2', ['ACCMGR']], ['cfo1', ['CFO']], ['pay1', ['PAY']]]) mkUser(n, r);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const des = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 't', 'test')", p1);
  let n = 0;
  const mkEmp = (o = {}) => { n += 1; return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, site_id, project_id, created_by, source_type) VALUES (1, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'G3', 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, ?, ?, ?, 't', 'test')", o.code ?? `E${n}`, o.name ?? `Employee ${n}`, `e${n}`, `91000${String(n).padStart(5, '0')}`, dept, des, o.userId ?? null, o.managerId ?? null, s1, p1); };
  // a line: head (mgr1) <- lead (lead1) <- a, b ; head <- c ; and a stranger (str1) in the same company
  const head = mkEmp({ code: 'M1', name: 'Meera Head', userId: mkUser('mgr1', ['EMP']) });
  const lead = mkEmp({ code: 'L1', name: 'Lalit Lead', userId: mkUser('lead1', ['EMP']), managerId: head });
  const a = mkEmp({ code: 'A1', name: 'Asha Kulkarni', userId: mkUser('emp1', []), managerId: lead });
  const b = mkEmp({ code: 'B1', name: 'Bhanu Rao', userId: mkUser('emp2', []), managerId: lead });
  const c = mkEmp({ code: 'C1', name: 'Chitra Iyer', userId: mkUser('emp3', []), managerId: head });
  const stranger = mkEmp({ code: 'S1', name: 'Sanjay Stranger', userId: mkUser('str1', []) });
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'hr9', 'HR9', '[\"HRMGR\"]', 'hr9@example.com')").run();
  mkEmp({ code: 'H1', name: 'Hema HR', userId: user.hr3 });
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };

  const put = (who, path, b) => call(who, 'PUT', path, b, uid());
  const file = () => Number(api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, 'bill.jpg', 'jpg', 'image/jpeg', 'image', 10, 'abc', 'CLEAN', 'exp_claim', 1, 't', 'test')").run(`k/${uid()}`).lastInsertRowid);
  // policies: activated by a second person
  return { api, call, post, put, act, org, file, ids: { head, lead, a, b, c, stranger, s1, p1 }, user };
};
const policy = async (t, o) => { const p = (await t.put(acc1, `${H}/expenses/policies`, { grade: 'G3', category: '*', cityTier: '*', effectiveFrom: '2026-01-01', ...o })).json.data; assert.ok(p?.id, JSON.stringify(p)); assert.equal((await t.post(cfo1, `${H}/expenses/policies/${p.id}/activate`, {})).status, 200); return p; };
const line = (o = {}) => ({ category: 'LODGING', date: ist(-2), description: 'Hotel in Nagpur', amount: 2500, gst: 0, vendorName: 'Hotel Orange', invoiceNo: 'INV-1', ...o });
const claim = (o = {}) => ({ periodFrom: ist(-5), periodTo: ist(-1), purpose: 'Site visit to Nagpur', cityTier: 'T2', lines: [line()], ...o });

test('T-01 FR-04 FR-05 the limit of the grade applies, a duplicate bill is found, an advance settles against a claim and the net is right; policies need a second person', async () => {
  const t = await setup(); const { b } = t.ids;
  t.org("UPDATE hr_employees SET grade = 'G5' WHERE id = ?", b);
  // maker-checker on the policy
  const p0 = (await t.put(acc1, `${H}/expenses/policies`, { grade: 'G3', category: 'LODGING', cityTier: '*', limit: 3000, receiptAbove: 500, effectiveFrom: '2026-01-01' })).json.data;
  assert.equal(p0.status, 'DRAFT');
  assert.equal((await t.post(acc1, `${H}/expenses/policies/${p0.id}/activate`, {})).status, 403, 'the maker does not activate');
  assert.equal((await t.post(cfo1, `${H}/expenses/policies/${p0.id}/activate`, {})).status, 200);
  await policy(t, { grade: 'G5', category: 'LODGING', limit: 6000, receiptAbove: 500 });
  await policy(t, { grade: 'G3', category: 'PER_DIEM', perDiem: 500 });
  await policy(t, { grade: 'G3', category: 'MILEAGE', mileageRate: 10 });
  assert.equal((await t.put(emp1, `${H}/expenses/policies`, { grade: 'G3', effectiveFrom: '2026-01-01' })).status, 403);
  // the same bill of 4500: over the limit of G3 (3000), within that of G5 (6000)
  const bill = t.file();
  const c1 = await t.post(emp1, `${H}/claims`, claim({ lines: [line({ amount: 4500, fileId: bill, invoiceNo: 'INV-A' })] }));
  assert.equal(c1.status, 201, JSON.stringify(c1.json));
  assert.equal(c1.json.data.lines[0].flag, 'OVER_LIMIT'); assert.equal(c1.json.data.lines[0].limit, 3000); assert.equal(c1.json.data.flagCount, 1);
  const noWhy = await t.post(emp1, `${H}/claims/${c1.json.data.id}/submit`, {});
  assert.equal(noWhy.status, 400); assert.match(JSON.stringify(noWhy.json), /write why/);
  const c2 = await t.post(emp2, `${H}/claims`, claim({ lines: [line({ amount: 4500, fileId: bill, invoiceNo: 'INV-B' })] }));
  assert.equal(c2.json.data.lines[0].flag, 'NONE', 'the same bill is within the limit of grade G5');
  // per diem and mileage are computed by the system
  const pd = await t.post(emp1, `${H}/claims`, claim({ lines: [{ category: 'PER_DIEM', date: ist(-2), description: 'Per diem', days: 3 }, { category: 'MILEAGE', date: ist(-2), description: 'Own bike to site', km: 100 }] }));
  assert.equal(pd.json.data.lines[0].amount, 1500); assert.equal(pd.json.data.lines[1].amount, 1000); assert.equal(pd.json.data.total, 2500);
  assert.equal((await t.post(emp1, `${H}/claims`, claim({ lines: [{ category: 'PER_DIEM', date: ist(-2), description: 'Per diem', days: 3, amount: 9999 }] }))).status, 400, 'a figure the client sent that differs from the computed one is refused');
  assert.equal((await t.post(emp2, `${H}/claims`, claim({ lines: [{ category: 'PER_DIEM', date: ist(-2), description: 'Per diem', days: 2 }] }))).status, 400, 'no per-diem policy for grade G5');
  // a bill above the receipt threshold needs its photo; GST needs the GSTIN and the invoice
  const nr = await t.post(emp1, `${H}/claims`, claim({ lines: [line({ amount: 2000, invoiceNo: 'INV-C' })] }));
  assert.equal(nr.json.data.lines[0].flag, 'NO_RECEIPT'); assert.equal((await t.post(emp1, `${H}/claims/${nr.json.data.id}/submit`, {})).status, 400);
  assert.equal((await t.post(emp1, `${H}/claims`, claim({ lines: [line({ gst: 100, invoiceNo: null, fileId: bill })] }))).status, 400);
  assert.equal((await t.post(emp1, `${H}/claims`, claim({ lines: [line({ gst: 100, vendorGstin: 'BADGSTIN', fileId: bill })] }))).status, 400);
  // the duplicate: the same vendor, invoice number and amount cannot be claimed twice
  const gstin = '27ABCDE1234F1Z5';
  const d1 = await t.post(emp1, `${H}/claims`, claim({ lines: [line({ amount: 2800, fileId: bill, vendorGstin: gstin, vendorName: 'Hotel Orange', invoiceNo: 'DUP-1', gst: 300 })] }));
  assert.equal((await t.post(emp1, `${H}/claims/${d1.json.data.id}/submit`, {})).status, 202);
  const d2 = await t.post(emp2, `${H}/claims`, claim({ lines: [line({ amount: 2800, fileId: bill, vendorGstin: gstin, vendorName: 'Hotel Orange', invoiceNo: 'DUP-1', gst: 300 })] }));
  assert.equal(d2.json.data.lines[0].flag, 'DUPLICATE'); assert.match(d2.json.data.lines[0].flagText, new RegExp(d1.json.data.docNo));
  const blocked = await t.post(emp2, `${H}/claims/${d2.json.data.id}/submit`, {});
  assert.equal(blocked.status, 400); assert.match(JSON.stringify(blocked.json), /bill is paid once/);
  // settlement: a travel advance of 20,000 paid out; a claim of 15,000 settles it: net 0, 5,000 still outstanding; a second claim of 8,000 clears the rest and is payable 3,000
  const adv = (await t.post(emp1, `${H}/advances`, { type: 'IMPREST', amount: 20000, purpose: 'Site imprest for December' })).json.data;
  assert.equal((await t.post(emp1, `${H}/claims`, claim({ advanceId: adv.id }))).status, 400, 'an advance that is not paid out is not settled against');
  await t.post(emp1, `${H}/advances/${adv.id}/submit`, {});
  const ai = t.api.db.prepare('SELECT workflow_instance_id AS i FROM exp_advances WHERE id = ?').get(adv.id).i;
  await t.act(lead1, ai); await t.act(acc1, ai);
  assert.equal((await t.post(acc1, `${H}/advances/${adv.id}/disburse`, { reference: 'UTR-1' })).json.data.status, 'DISBURSED');
  const big = await t.post(emp1, `${H}/claims`, claim({ advanceId: adv.id, lines: [line({ amount: 15000, category: 'TRAVEL', fileId: bill, invoiceNo: 'T-1', description: 'Taxi and train' })] }));
  const sub = (await t.post(emp1, `${H}/claims/${big.json.data.id}/submit`, {})).json.data;
  assert.equal(sub.advanceAdjusted, 15000); assert.equal(sub.netPayable, 0); assert.equal(sub.recoverable, 5000);
  await t.act(lead1, sub.workflowInstanceId);
  assert.equal(t.api.db.prepare('SELECT balance_minor AS n FROM exp_advances WHERE id = ?').get(adv.id).n, 500_000, 'the settlement took 15,000 off the advance at approval');
  const small = await t.post(emp1, `${H}/claims`, claim({ advanceId: adv.id, lines: [line({ amount: 8000, category: 'TRAVEL', fileId: bill, invoiceNo: 'T-2', description: 'Return travel' })] }));
  const sub2 = (await t.post(emp1, `${H}/claims/${small.json.data.id}/submit`, {})).json.data;
  assert.equal(sub2.advanceAdjusted, 5000); assert.equal(sub2.netPayable, 3000); assert.equal(sub2.recoverable, 0);
  await t.act(lead1, sub2.workflowInstanceId);
  const closed = (await t.call(emp1, 'GET', `${H}/advances/${adv.id}`)).json.data;
  assert.equal(closed.status, 'CLOSED'); assert.equal(closed.outstanding, 0); assert.equal(closed.recoveries.filter((r) => r.kind === 'SETTLEMENT').length, 2);
  void b;
});

test('FR-06 BR-03 approvals by amount and by deviation, the hand-off events, pass for payment and payment, cancel puts the settlement back', async () => {
  const t = await setup(); const { a } = t.ids; const bill = t.file();
  await policy(t, { grade: 'G3', category: 'LODGING', limit: 3000, receiptAbove: 500 });
  const raise = async (user, lines, o = {}) => { const c = (await t.post(user, `${H}/claims`, claim({ lines, ...o }))).json.data; const s = await t.post(user, `${H}/claims/${c.id}/submit`, {}); assert.equal(s.status, 202, JSON.stringify(s.json)); return s.json.data; };
  const stepsOf = (inst) => t.api.db.prepare('SELECT step_code FROM wf_tasks WHERE instance_id = ? ORDER BY id').all(inst).map((x) => x.step_code);
  // up to 25,000: the manager only
  const small = await raise(emp1, [line({ amount: 2500, fileId: bill, invoiceNo: 'S-1' })]);
  assert.equal(small.level, 1); await t.act(lead1, small.workflowInstanceId);
  let s = (await t.call(emp1, 'GET', `${H}/claims/${small.id}`)).json.data; assert.equal(s.status, 'APPROVED');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'exp.claim.approved'").get().n >= 1, 'the hand-off event for posting');
  // a policy deviation moves it one level up: 4,500 against a limit of 3,000 goes to the accounts manager too
  const dev = await raise(emp1, [line({ amount: 4500, fileId: bill, invoiceNo: 'D-1', justification: 'The only hotel with a room that night' })]);
  assert.equal(dev.level, 2);
  await t.act(lead1, dev.workflowInstanceId); assert.equal((await t.call(emp1, 'GET', `${H}/claims/${dev.id}`)).json.data.status, 'SUBMITTED');
  await t.act(acc1, dev.workflowInstanceId); assert.equal((await t.call(emp1, 'GET', `${H}/claims/${dev.id}`)).json.data.status, 'APPROVED');
  // an old bill needs the higher approval (BR-03)
  const old = await raise(emp1, [line({ amount: 1500, date: ist(-90), fileId: bill, invoiceNo: 'O-1', justification: 'Claimed late: I was on leave for a month' })]);
  assert.equal(old.level, 2); assert.equal((await t.call(emp1, 'GET', `${H}/claims/${old.id}`)).json.data.lines[0].flag, 'OLD');
  // between 25,000 and 1 lakh: manager, then the accounts manager
  const mid = await raise(emp1, [line({ amount: 60000, category: 'SITE_PURCHASE', fileId: bill, invoiceNo: 'M-1', description: 'Shuttering oil', vendorName: 'Oil Co' })]);
  assert.equal(mid.level, 2); assert.deepEqual(stepsOf(mid.workflowInstanceId).slice(0, 1), ['MANAGER']);
  await t.act(lead1, mid.workflowInstanceId); await t.act(acc1, mid.workflowInstanceId);
  // above 1 lakh: the CFO too
  const huge = await raise(emp1, [line({ amount: 150000, category: 'SITE_PURCHASE', fileId: bill, invoiceNo: 'H-1', description: 'Generator hire', vendorName: 'Gen Co' })]);
  assert.equal(huge.level, 3);
  await t.act(lead1, huge.workflowInstanceId); await t.act(acc1, huge.workflowInstanceId);
  assert.equal((await t.call(emp1, 'GET', `${H}/claims/${huge.id}`)).json.data.status, 'SUBMITTED', 'the CFO is still to decide');
  await t.act(cfo1, huge.workflowInstanceId); assert.equal((await t.call(emp1, 'GET', `${H}/claims/${huge.id}`)).json.data.status, 'APPROVED');
  // the claimant never approves: no task for them
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, emp1)).json.data.rows.length, 0);
  // the accounts manager passes the approved claim for payment; the claimant cannot; payment is recorded
  assert.equal((await t.post(emp1, `${H}/claims/${small.id}/pass`, {})).status, 403);
  const worklist = (await t.call(acc1, 'GET', `${H}/expenses/approvals`)).json.data; assert.ok(worklist.toPass.length >= 4);
  assert.equal((await t.post(acc1, `${H}/claims/${small.id}/pass`, {})).json.data.status, 'PASSED');
  assert.equal((await t.post(acc1, `${H}/claims/${small.id}/pass`, {})).status, 422, 'passed once');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'exp.claim.passed'").get().n >= 1);
  assert.equal((await t.post(acc1, `${H}/claims/${small.id}/paid`, { reference: 'NEFT-9' })).json.data.status, 'PAID');
  // reject and return paths, and a held claim cancelled by the claimant
  const r1 = await raise(emp1, [line({ amount: 1000, fileId: bill, invoiceNo: 'R-1' })]);
  await t.act(lead1, r1.workflowInstanceId, 'return');
  assert.equal((await t.call(emp1, 'GET', `${H}/claims/${r1.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.post(emp1, `${H}/claims/${r1.id}/submit`, {})).status, 202, 'corrected and sent again');
  const r2 = await raise(emp1, [line({ amount: 1100, fileId: bill, invoiceNo: 'R-2' })]);
  await t.act(lead1, r2.workflowInstanceId, 'reject'); assert.equal((await t.call(emp1, 'GET', `${H}/claims/${r2.id}`)).json.data.status, 'REJECTED');
  assert.equal((await t.post(emp1, `${H}/claims/${r2.id}/cancel`, { reason: 'No longer needed' })).status, 422);
  // scope: a colleague and a stranger do not see the claim; the manager and accounts do
  assert.equal((await t.call(emp2, 'GET', `${H}/claims/${small.id}`)).status, 404);
  assert.equal((await t.call(lead1, 'GET', `${H}/claims/${small.id}`)).status, 200);
  assert.equal((await t.call(acc1, 'GET', `${H}/claims/${small.id}`)).status, 200);
  assert.equal((await t.call(emp1, 'GET', `${H}/claims`)).json.data.length >= 6, true);
  assert.equal((await t.call(emp2, 'GET', `${H}/claims`)).json.data.length, 0);
  assert.equal((await t.api.raw('GET', `${H}/claims/export?format=csv`, acc1)).status, 200);
  assert.equal((await t.api.raw('GET', `${H}/claims/export?format=csv`, emp1)).status, 403);
  assert.equal((await t.call(emp1, 'POST', `${H}/claims`, claim({ lines: [line({ amount: 100 })] }))).status, 400, 'an idempotency key is required to create');
  void a;
});

test('FR-02 FR-06 a salary advance: manager, HR manager and the CFO above the limit; paid out; instalments for payroll; recovery closes it; one at a time', async () => {
  const t = await setup(); const { a } = t.ids;
  const mk = (amount, instalments = 6) => t.post(emp1, `${H}/advances`, { type: 'SALARY', amount, purpose: 'Family medical expenses', instalments });
  assert.equal((await mk(150000)).status, 400, 'above the most a salary advance may be');
  assert.equal((await t.post(emp1, `${H}/advances`, { type: 'SALARY', amount: 30000, purpose: 'Family medical', instalments: 40 })).status, 400);
  assert.equal((await t.post(emp1, `${H}/advances`, { type: 'TRAVEL', amount: 5000, purpose: 'Trip', instalments: 3 })).status, 400, 'a travel advance is settled, not recovered in instalments');
  const ad = (await mk(30000, 3)).json.data; assert.equal(ad.instalment, 10000);
  const sub = (await t.post(emp1, `${H}/advances/${ad.id}/submit`, {})).json.data;
  assert.equal((await mk(20000)).status, 400, 'one salary advance at a time');
  await t.act(lead1, sub.workflowInstanceId);
  assert.equal((await t.call(emp1, 'GET', `${H}/advances/${ad.id}`)).json.data.status, 'SUBMITTED', 'the HR manager decides next');
  await t.act(hr2, sub.workflowInstanceId);
  assert.equal((await t.call(emp1, 'GET', `${H}/advances/${ad.id}`)).json.data.status, 'APPROVED');
  assert.equal((await t.post(emp1, `${H}/advances/${ad.id}/disburse`, { reference: 'X1' })).status, 403);
  assert.equal((await t.post(acc1, `${H}/advances/${ad.id}/disburse`, { reference: 'UTR-77', date: '2026-11-10' })).json.data.status, 'DISBURSED');
  const due = (await t.call(pay1, 'GET', `${H}/advances/recoveries?month=2027-01`)).json.data;
  assert.equal(due.length, 2, 'the instalments of December and January'); assert.equal(due[0].dueMonth, '2026-12'); assert.equal(due[0].amount, 10000);
  assert.equal((await t.call(emp1, 'GET', `${H}/advances/recoveries?month=2027-01`)).status, 403);
  assert.equal((await t.post(pay1, `${H}/advances/recoveries/${due[0].id}/recover`, { reference: 'PAYROLL-DEC' })).json.data.outstanding, 20000);
  assert.equal((await t.post(pay1, `${H}/advances/recoveries/${due[0].id}/recover`, {})).status, 409);
  await t.post(pay1, `${H}/advances/recoveries/${due[1].id}/recover`, {});
  const last = t.api.db.prepare("SELECT id FROM exp_advance_recoveries WHERE advance_id = ? AND rec_status = 'PLANNED'").get(ad.id);
  await t.post(pay1, `${H}/advances/recoveries/${last.id}/recover`, {});
  const done = (await t.call(emp1, 'GET', `${H}/advances/${ad.id}`)).json.data; assert.equal(done.status, 'CLOSED'); assert.equal(done.outstanding, 0);
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type IN ('exp.advance.disbursed', 'exp.advance.recovered', 'exp.advance.closed')").get().n >= 5);
  // above the limit: the CFO decides too
  const big = (await t.post(emp1, `${H}/advances`, { type: 'SALARY', amount: 80000, purpose: 'House deposit', instalments: 10 })).json.data;
  const sb = (await t.post(emp1, `${H}/advances/${big.id}/submit`, {})).json.data;
  await t.act(lead1, sb.workflowInstanceId); await t.act(hr2, sb.workflowInstanceId);
  assert.equal((await t.call(emp1, 'GET', `${H}/advances/${big.id}`)).json.data.status, 'SUBMITTED'); await t.act(cfo1, sb.workflowInstanceId);
  assert.equal((await t.call(emp1, 'GET', `${H}/advances/${big.id}`)).json.data.status, 'APPROVED');
  void a;
});

test('FR-01 a travel request goes to the manager and the project manager (or the department head); it can be settled by a claim and a travel advance', async () => {
  const t = await setup(); const { a, p1 } = t.ids; const bill = t.file();
  await t.put(hr1, `${H}/expenses/policies`, { grade: 'G3', effectiveFrom: '2026-01-01' }).catch(() => null);
  t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'pm9', 'PM9', '[\"PM\"]', 'pm9@example.com')").run();
  const trv = await t.post(emp1, `${H}/travel-requests`, { purpose: 'Client meeting and site inspection', fromPlace: 'Pune', toPlace: 'Nagpur', startDate: ist(3), endDate: ist(5), mode: 'TRAIN', estCost: 12000, advance: 8000, projectId: p1 });
  assert.equal(trv.status, 201, JSON.stringify(trv.json));
  assert.equal((await t.post(emp1, `${H}/travel-requests`, { purpose: 'Backwards trip', fromPlace: 'Pune', toPlace: 'Nagpur', startDate: ist(5), endDate: ist(3), mode: 'TRAIN', estCost: 100 })).status, 400);
  assert.equal((await t.post(emp1, `${H}/travel-requests`, { purpose: 'Too much advance', fromPlace: 'Pune', toPlace: 'Nagpur', startDate: ist(3), endDate: ist(5), mode: 'TRAIN', estCost: 100, advance: 500 })).status, 400);
  const s = (await t.post(emp1, `${H}/travel-requests/${trv.json.data.id}/submit`, {})).json.data; assert.equal(s.status, 'SUBMITTED');
  await t.act(lead1, s.workflowInstanceId); await t.act(as('PM', 'pm9'), s.workflowInstanceId);
  const ok = (await t.call(emp1, 'GET', `${H}/travel-requests/${trv.json.data.id}`)).json.data; assert.equal(ok.status, 'APPROVED'); assert.equal(ok.can.claim, true);
  // the travel advance the request asked for; a claim for the trip
  const ta = await t.post(emp1, `${H}/advances`, { type: 'TRAVEL', amount: 9000, purpose: 'Trip to Nagpur', travelRequestId: trv.json.data.id });
  assert.equal(ta.status, 400, 'more than the request asked for');
  const ta2 = await t.post(emp1, `${H}/advances`, { type: 'TRAVEL', amount: 8000, purpose: 'Trip to Nagpur', travelRequestId: trv.json.data.id });
  assert.equal(ta2.status, 201);
  const cl = await t.post(emp1, `${H}/claims`, claim({ travelRequestId: trv.json.data.id, lines: [line({ amount: 900, fileId: bill, invoiceNo: 'TR-1', category: 'TRAVEL', description: 'Train tickets' })] }));
  assert.equal(cl.status, 201, JSON.stringify(cl.json));
  const sc = (await t.post(emp1, `${H}/claims/${cl.json.data.id}/submit`, {})).json.data; await t.act(lead1, sc.workflowInstanceId);
  assert.equal((await t.call(emp1, 'GET', `${H}/travel-requests/${trv.json.data.id}`)).json.data.status, 'CLOSED', 'the claim closes the trip');
  assert.equal((await t.call(emp2, 'GET', `${H}/travel-requests/${trv.json.data.id}`)).status, 404);
  assert.equal((await t.api.raw('GET', `${H}/travel-requests/${trv.json.data.id}/print`, emp1)).status, 200);
  // the analysis: by project, category and employee
  const an = (await t.call(acc1, 'GET', `${H}/expenses/analysis`)).json.data; assert.equal(an.total, 900); assert.equal(an.byCategory[0].name, 'Travel'); assert.equal(an.byEmployee[0].name, 'Asha Kulkarni');
  assert.equal((await t.call(emp1, 'GET', `${H}/expenses/analysis`)).status, 403);
  void a;
});
