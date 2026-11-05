import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { employeesOf } from '../src/server/modules/hr/employees.js';
import { templateWorkbook } from '../src/server/modules/eng/xl-xlsx.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.01: the employee master. T-01 statutory and bank details are masked in the API and the export for a site manager and visible to HR; T-02 a duplicate PAN is blocked and an import of 500 employees with 20 errors gives the right error file;
// T-03 a separation on its effective date deactivates the user's access. Also: activation by a second HR manager (never the person who entered it), return and resubmit, amendments of statutory, bank and employment details through
// their approval chains and effective dates, the history timeline, the user link, self-service, isolation, document expiry and idempotent replay.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'h') => ({ ...json, 'idempotency-key': `hr-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1');
const hr2 = as('HRMGR', 'hr2');
const pay1 = as('PAY', 'pay1');
const dir = as('DIR', 'dir1');
const pm = as('PM', 'pm1');
const se = as('SE', 'se1');
const emp = as('EMP', 'emp1');
const aud = as('AUD', 'aud1');
const other = as('HRMGR', 'hr9', '2');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const base = (o = {}) => ({
  firstName: 'Rakesh', lastName: 'Kulkarni', gender: 'MALE', dob: '1990-05-17', bloodGroup: 'B+', maritalStatus: 'MARRIED', mobile: '9876500011', email: 'rakesh.k@example.com',
  permanentAddress: { line: '12 Shivaji Nagar', city: 'Pune', stateCode: 'MH', pin: '411005' }, currentAddress: null,
  departmentId: o.departmentId, designationId: o.designationId, employmentType: 'PERMANENT', doj: '2026-04-01', locationType: 'HO', salaryPaymentMode: 'BANK_TRANSFER',
  languages: ['English', 'Hindi', 'Marathi'], skills: ['AutoCAD'],
  contacts: [{ type: 'EMERGENCY', name: 'Sunita Kulkarni', relation: 'Spouse', phone: '9876500022' }, { type: 'NOMINEE', name: 'Sunita Kulkarni', relation: 'Spouse', sharePct: '60' }, { type: 'NOMINEE', name: 'Aarav Kulkarni', relation: 'Son', sharePct: '40' }],
  education: [{ qualification: 'B.E. Civil', institute: 'COEP Pune', year: 2012, grade: 'First class' }], experience: [{ employer: 'Larsen Infra', jobTitle: 'Site Engineer', fromDate: '2012-07-01', toDate: '2026-03-15' }],
  statutory: { pan: 'ABCPK1234F', aadhaar: '123456789012', uan: '100200300400', esicIp: null, pfApplicable: true, esiApplicable: false, ptState: 'MH', lwfState: 'MH' },
  bank: { accountNo: '123456789012', ifsc: 'SBIN0001234', accountName: 'Rakesh Kulkarni' }, ...o,
});
const setup = async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-hr-'));
  const api = await startApi({}, { storagePath: storage });
  opened.push({ close: async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); } });
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  for (const [n, r, c] of [['hr1', ['HRMGR'], 1], ['hr2', ['HRMGR'], 1], ['pay1', ['PAY'], 1], ['pay2', ['PAY'], 1], ['dir1', ['DIR'], 1], ['pm1', ['PM'], 1], ['se1', ['SE'], 1], ['emp1', ['EMP'], 1], ['aud1', ['AUD'], 1], ['sys1', ['SYSADM'], 1], ['hr9', ['HRMGR'], 2]]) {
    api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, n, `${n.toUpperCase()} Person`, JSON.stringify(r), `${n}@example.com`);
  }
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const dept2 = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ACC', 'Accounts', 't', 'test')");
  const junior = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const senior = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'GM', 'General Manager', 'G9', 9, 't', 'test')");
  const mid = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SSE', 'Senior Site Engineer', 'G4', 4, 't', 'test')");
  const project = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const site = org("INSERT INTO org_sites (company_id, org_project_id, code, name, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road Site 1', 't', 'test')", project);
  const ids = { dept, dept2, junior, senior, mid, project, site };
  const call = (who, method, path, body, k) => api.call(method, `${H}${path}`, { ...who, headers: key(k), body });
  const act = async (who, instanceId, action = 'approve', comment = 'checked the documents and the details') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const instanceOf = (r) => r.json.data.workflow?.id ?? r.json.data.instanceId;
  const make = (o = {}) => base({ departmentId: dept, designationId: junior, ...o });
  /** An employee through approval: entered by hr1, approved by hr2. */
  const active = async (o = {}) => {
    const r = await call(hr1, 'POST', '/employees', { ...make(o), submit: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    await act(hr2, instanceOf(r));
    return (await call(hr1, 'GET', `/employees/${r.json.data.id}`)).json.data;
  };
  return { api, call, act, ids, make, active, instanceOf, storage };
};

test('FR-01 FR-02 AC-01 an employee is entered, sent for approval, approved by another HR manager and seen in Employee 360 with its history', async () => {
  const t = await setup();
  const r = await t.call(hr1, 'POST', '/employees', t.make());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const e = r.json.data;
  assert.equal(e.status, 'DRAFT');
  assert.equal(e.code, 'EMP-00001');
  assert.equal(e.grade, 'G3', 'the grade is filled from the designation');
  assert.equal(e.name, 'Rakesh Kulkarni');
  assert.equal(e.statutory.pan, 'ABCPK1234F');
  assert.equal(e.statutory.aadhaar, '•••• •••• 9012', 'only the last four digits of the Aadhaar are kept');
  assert.equal(JSON.stringify(e).includes('123456789012'), false, 'neither the Aadhaar nor the bank account number is in the response');
  assert.equal(e.banks[0].account, '••••••9012');
  const sub = await t.call(hr1, 'POST', `/employees/${e.id}/submit`, {});
  assert.equal(sub.status, 202, JSON.stringify(sub.json));
  assert.equal(sub.json.data.status, 'SUBMITTED');
  // the person who entered it cannot approve it: no task for them, and the other HR manager has it
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, hr1)).json.data.rows.some((x) => x.instance.id === sub.json.data.workflow.id), false);
  assert.equal((await t.call(hr1, 'PATCH', `/employees/${e.id}`, { ...t.make(), version: sub.json.data.rowVersion })).status, 409, 'a submitted record is locked');
  await t.act(hr2, sub.json.data.workflow.id);
  const got = (await t.call(hr2, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(got.status, 'APPROVED');
  assert.equal(got.employmentStatus, 'ACTIVE');
  assert.deepEqual(got.history.map((h) => h.event), ['JOINED']);
  assert.equal(got.banks[0].status, 'ACTIVE');
  assert.equal(got.banks[0].verified, 'UNVERIFIED');
  // the approved record is locked
  assert.equal((await t.call(hr1, 'PATCH', `/employees/${e.id}`, { ...t.make(), version: got.rowVersion })).status, 409);
  assert.equal((await t.call(hr1, 'DELETE', `/employees/${e.id}`)).status, 409);
  const hist = (await t.call(hr2, 'GET', `/employees/${e.id}/history`)).json.data;
  assert.ok(hist.approvals.length >= 2 && hist.audit.some((a) => a.action === 'submit'));
  // payroll verifies the bank account; the person who entered it cannot
  const bankId = got.banks[0].id;
  const v = await t.call(pay1, 'POST', `/employees/${e.id}/banks/${bankId}/verify`, { result: 'VERIFIED', note: 'Penny drop checked on the bank portal' });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.data.verified, 'VERIFIED');
  // events for the other modules
  const ev = t.api.db.prepare("SELECT event_type AS type FROM core_outbox WHERE event_type LIKE 'hr.employee.%'").all().map((x) => x.type);
  assert.ok(ev.includes('hr.employee.activated'), JSON.stringify(ev));
});

test('T-01 BR-01 statutory and bank details are masked in the API, the list and the export for a manager, and shown to HR, payroll and the employee', async () => {
  const t = await setup();
  const manager = await t.active({ firstName: 'Mahesh', lastName: 'Patil', mobile: '9811100001', statutory: { pan: 'AAAPP1111A', aadhaar: '111122223333', uan: null, esicIp: null, pfApplicable: false, esiApplicable: false, ptState: 'MH', lwfState: null }, bank: { accountNo: '555566667777', ifsc: 'SBIN0001234', accountName: 'Mahesh Patil' } });
  const e = await t.active({ managerId: manager.id });
  // the project manager is linked to the manager's record; the employee reports to him
  const pmUser = t.api.db.prepare("SELECT id FROM iam_users WHERE username = 'pm1'").get().id;
  t.api.db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(pmUser, manager.id);
  const asHr = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(asHr.statutory.pan, 'ABCPK1234F');
  assert.equal(asHr.masked, false);
  const asPm = await t.call(pm, 'GET', `/employees/${e.id}`);
  assert.equal(asPm.status, 200, JSON.stringify(asPm.json));
  assert.equal(asPm.json.data.accessLevel, 'team');
  assert.equal(asPm.json.data.statutory.pan, '••••••234F');
  assert.equal(asPm.json.data.banks[0].account, '••••••9012');
  assert.equal(asPm.json.data.masked, true);
  const raw = JSON.stringify(asPm.json);
  for (const secret of ['ABCPK1234F', '123456789012', '100200300400', 'Rakesh Kulkarni\u0000']) assert.equal(raw.includes(secret), false, `${secret} must not reach a manager`);
  assert.equal(asPm.json.data.contacts.length, 0, 'family and nominee details are not basic data');
  assert.equal((await t.call(pm, 'GET', `/employees/${e.id}/banks/${asHr.banks[0].id}/reveal`)).status, 403);
  // payroll sees the statutory data; the full account number is shown on request and logged
  assert.equal((await t.call(pay1, 'GET', `/employees/${e.id}`)).json.data.statutory.pan, 'ABCPK1234F');
  const shown = await t.call(pay1, 'GET', `/employees/${e.id}/banks/${asHr.banks[0].id}/reveal`);
  assert.equal(shown.json.data.accountNo, '123456789012');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'hr_employee_banks' AND action = 'view_bank'").get());
  // the list: PAN masked
  const list = (await t.call(pm, 'GET', '/employees?pageSize=50')).json;
  assert.equal(list.data.every((r) => !r.pan || r.pan.startsWith('••••••')), true);
  // exports: the project manager (export right) gets masked PAN, HR the full number
  const asCsv = async (who) => { const r = await t.api.raw('GET', `${H}/employees/export?format=csv`, who); assert.equal(r.status, 200, r.buffer.toString().slice(0, 200)); return r.buffer.toString('utf8'); };
  const pmCsv = await asCsv(pm);
  assert.ok(pmCsv.includes('••••••234F') && !pmCsv.includes('ABCPK1234F'), pmCsv);
  const hrCsv = await asCsv(hr1);
  assert.ok(hrCsv.includes('ABCPK1234F'), hrCsv);
  // a site engineer outside the line cannot even open the record; the employee sees their own statutory data
  assert.equal((await t.call(se, 'GET', `/employees/${e.id}`)).status, 404);
  const user = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, 'rakesh', 'Rakesh Kulkarni', '[\"EMP\"]')").run().lastInsertRowid);
  t.api.db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(user, e.id);
  const mine = await t.call(as('EMP', 'rakesh'), 'GET', '/employees/me');
  assert.equal(mine.status, 200, JSON.stringify(mine.json));
  assert.equal(mine.json.data.statutory.pan, 'ABCPK1234F');
  assert.equal((await t.call(as('EMP', 'rakesh'), 'GET', `/employees/${manager.id}`)).status, 404, 'an employee does not see others');
  assert.equal((await t.call(emp, 'GET', '/employees')).status, 403);
});

test('T-02 FR-09 a duplicate PAN or Aadhaar is blocked, the same mobile or name and date of birth warns, a rehire is allowed with confirmation', async () => {
  const t = await setup();
  const first = await t.active();
  const dupPan = await t.call(hr1, 'POST', '/employees', t.make({ firstName: 'Someone', mobile: '9811122233', dob: '1991-01-01', statutory: { ...base().statutory, aadhaar: '999988887777' } }));
  assert.equal(dupPan.status, 409, JSON.stringify(dupPan.json));
  assert.equal(dupPan.json.error.code, 'DUPLICATE');
  assert.match(dupPan.json.error.message, new RegExp(first.code));
  const dupAadhaar = await t.call(hr1, 'POST', '/employees', t.make({ firstName: 'Someone', mobile: '9811122233', dob: '1991-01-01', statutory: { ...base().statutory, pan: 'XYZPA1234B' } }));
  assert.equal(dupAadhaar.status, 409);
  const checked = await t.call(hr1, 'POST', '/employees/check', t.make({ mobile: '9876500011', statutory: { ...base().statutory, pan: 'XYZPA1234B', aadhaar: '999988887777' } }));
  assert.equal(checked.json.data.duplicates[0].rule, 'same mobile');
  const warn = await t.call(hr1, 'POST', '/employees', t.make({ statutory: { ...base().statutory, pan: 'XYZPA1234B', aadhaar: '999988887777' }, bank: { ...base().bank, accountNo: '100100100100' } }));
  assert.equal(warn.status, 409);
  assert.equal(warn.json.error.code, 'DUPLICATE_WARNING');
  const ok = await t.call(hr1, 'POST', '/employees', { ...t.make({ statutory: { ...base().statutory, pan: 'XYZPA1234B', aadhaar: '999988887777' }, bank: { ...base().bank, accountNo: '100100100100' } }), acknowledgeDuplicates: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  // invalid values are refused with the field named
  const bad = async (o, field) => { const r = await t.call(hr1, 'POST', '/employees', t.make({ ...o, mobile: o.mobile ?? '9811100077', statutory: o.statutory ?? { ...base().statutory, pan: 'QWEPR9999Z', aadhaar: '444455556666' }, bank: o.bank ?? { ...base().bank, accountNo: '200200200200' } })); assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.json)}`); assert.ok(r.json.error.details.some((d) => d.field.startsWith(field)), `${field} in ${JSON.stringify(r.json.error.details)}`); };
  await bad({ mobile: '12345' }, 'mobile');
  await bad({ dob: '2015-01-01' }, 'dob');
  await bad({ statutory: { ...base().statutory, pan: 'ABCDE1234F' } }, 'statutory.pan');
  await bad({ bank: { accountNo: '12', ifsc: 'SBIN001234', accountName: 'X' } }, 'bank');
  await bad({ contacts: [{ type: 'EMERGENCY', name: 'A', relation: 'B', phone: '9876500022' }, { type: 'NOMINEE', name: 'C', relation: 'D', sharePct: '60' }, { type: 'NOMINEE', name: 'E', relation: 'F', sharePct: '30' }] }, 'contacts');
  await bad({ confirmationDate: '2020-01-01' }, 'confirmationDate');
  await bad({ managerId: 9999 }, 'managerId');
  await bad({ locationType: 'SITE' }, 'siteId');
  // separated employee: a rehire warns instead of blocking
  const left = await t.active({ firstName: 'Old', lastName: 'Hand', mobile: '9811100055', statutory: { ...base().statutory, pan: 'LMNPO1234Q', aadhaar: '777788889999' }, bank: { ...base().bank, accountNo: '300300300300' } });
  t.api.db.prepare("UPDATE hr_employees SET employment_status = 'SEPARATED' WHERE id = ?").run(left.id);
  const rehire = await t.call(hr1, 'POST', '/employees', t.make({ firstName: 'Old', lastName: 'Hand', mobile: '9811100056', dob: '1985-01-01', statutory: { ...base().statutory, pan: 'LMNPO1234Q', aadhaar: '777788889999' }, bank: { ...base().bank, accountNo: '300300300301' } }));
  assert.equal(rehire.status, 409);
  assert.equal(rehire.json.error.code, 'DUPLICATE_WARNING');
  assert.match(rehire.json.error.message, /rehire/);
});

test('FR-10 AC-04 T-02 an import of 500 employees with 20 errors gives the right error file; every valid row is a new employee waiting for approval', async () => {
  const t = await setup();
  const { dept, junior } = t.ids;
  void dept; void junior;
  const login = async (who) => (await t.api.call('GET', '/api/v1/xl/templates', who)).json.data.types.find((x) => x.code === 'HR_EMPLOYEE');
  assert.equal((await t.api.call('GET', '/api/v1/xl/templates', se)).status === 200 ? (await t.api.call('GET', '/api/v1/xl/templates', se)).json.data.types.some((x) => x.code === 'HR_EMPLOYEE') : false, false, 'a site engineer does not see the import');
  const type = await login(hr1);
  assert.ok(type, 'HR sees the employee import');
  const pan = (i) => `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26]}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(i / 26) % 26]}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(i / 676) % 26]}PX${String(1000 + i).padStart(4, '0')}K`;
  const rows = Array.from({ length: 500 }, (_, i) => ({
    firstName: `Worker${i}`, lastName: 'Test', gender: 'MALE', dob: new Date(Date.UTC(1965, 0, 1) + i * 17 * 86_400_000).toISOString().slice(0, 10), mobile: `98${String(10000000 + i).padStart(8, '0')}`, email: '', department: 'ENG', designation: 'SE', branch: '', costCentre: '', employmentType: 'PERMANENT', doj: '2026-04-01', manager: '',
    locationType: 'HO', site: '', pan: pan(i), aadhaar: String(100000000000 + i), uan: '', esicIp: '', pf: 'Yes', esi: 'No', ptState: 'MH', accountNo: String(900000000000 + i), ifsc: 'SBIN0001234', accountName: `Worker${i} Test`,
    emergencyName: 'Family', emergencyRelation: 'Brother', emergencyPhone: '9876500022', notDuplicate: '',
  }));
  // 20 errors of different kinds: 4 mobiles, 5 PANs, 5 departments, 3 emergency phones, a PAN twice in the file, a designation, a date of birth
  for (let i = 0; i < 4; i += 1) rows[i * 10].mobile = '12345';
  for (let i = 0; i < 5; i += 1) rows[i * 10 + 1].pan = 'BADPAN';
  for (let i = 0; i < 5; i += 1) rows[i * 10 + 2].department = 'NOPE';
  for (let i = 0; i < 3; i += 1) rows[i * 10 + 3].emergencyPhone = '';
  rows[53].pan = rows[43].pan; // the same PAN twice in the file... and one equal to a person already employed (below)
  rows[63].designation = 'GHOST';
  rows[73].dob = '2015-01-01';
  const wb = templateWorkbook({ importType: 'HR_EMPLOYEE', version: 0, title: 'HR_EMPLOYEE', columns: type.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: ['x'], rowsRaw: true, rows: rows.map((r) => type.columns.map((c) => r[c.key] ?? '')) });
  const up = await t.api.raw('POST', `/api/v1/xl/jobs?type=HR_EMPLOYEE&fileName=employees.xlsx`, { ...hr1, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': `xl-${Math.random().toString(36).slice(2, 10)}` }, body: wb });
  assert.equal(up.status, 202, up.buffer.toString().slice(0, 300));
  const runtime = runtimeOf(t.api.db);
  const drain = async () => { for (let i = 0; i < 8; i += 1) { runtime.bus.drain(); await runtime.jobs.drain(); } };
  await drain();
  const job = up.json.data;
  const state = (await t.api.call('GET', `/api/v1/xl/jobs/${job.id}`, hr1)).json.data;
  assert.equal(state.rowsTotal ?? state.totalRows ?? state.rows, 500, JSON.stringify(state).slice(0, 400));
  const errors = (await t.api.call('GET', `/api/v1/xl/jobs/${job.id}/errors?limit=500`, hr1)).json;
  const errRows = new Set((errors.data.rows ?? errors.data ?? []).map((e) => e.line ?? e.row ?? e.rowNo));
  assert.equal(errRows.size, 20, `20 rows have errors: ${JSON.stringify(errors).slice(0, 600)}`);
  const commit = await t.api.call('POST', `/api/v1/xl/jobs/${job.id}/commit`, { ...hr1, headers: key('c'), body: { skipInvalid: true } });
  assert.ok([200, 202].includes(commit.status), JSON.stringify(commit.json).slice(0, 400));
  // the commit runs as a background job, in this process; the connection of the test client may have been closed while it ran, so the result is read from the database
  await drain();
  const done = t.api.db.prepare('SELECT status, last_error FROM xl_jobs WHERE id = ?').get(job.id);
  assert.equal(done.status, 'COMMITTED', done.last_error);
  const created = t.api.db.prepare("SELECT COUNT(*) AS n, SUM(record_status = 'SUBMITTED') AS s, SUM(record_status = 'APPROVED') AS a FROM hr_employees").get();
  assert.equal(created.n, 480);
  assert.equal(created.s, 480, 'imported employees wait for approval');
  assert.equal(created.a ?? 0, 0, 'an import never approves');
});

test('T-03 BR-02 FR-08 a user is created from the employee; a separation approved for a later date is scheduled and, on its effective date, deactivates the access', async () => {
  const t = await setup();
  const e = await t.active();
  const u = await t.call(hr1, 'POST', `/employees/${e.id}/user`, { invite: false });
  assert.equal(u.status, 201, JSON.stringify(u.json));
  assert.equal(u.json.data.employee.user.username.length > 2, true);
  const userId = u.json.data.user.id;
  assert.equal(t.api.db.prepare('SELECT employee_code FROM iam_user_profiles WHERE user_id = ?').get(userId).employee_code, e.code, 'the account carries the employee code');
  assert.equal((await t.call(hr1, 'POST', `/employees/${e.id}/user`, { invite: false })).status, 409, 'one account per employee');
  // a second account cannot be linked to the same person, and one account cannot serve two people
  const e2 = await t.active({ firstName: 'Second', mobile: '9811100002', statutory: { ...base().statutory, pan: 'AAAPB2222B', aadhaar: '222233334444' }, bank: { ...base().bank, accountNo: '400400400400' }, dob: '1988-03-03' });
  const link = await t.call(hr1, 'POST', `/employees/${e2.id}/link-user`, { userId });
  assert.equal(link.status, 409, JSON.stringify(link.json));
  const separate = (id, who, status, effectiveDate, extra = {}) => t.call(who, 'POST', `/employees/${id}/amend`, { type: 'SEPARATION', changes: { status, lastWorkingDate: effectiveDate, separationReason: 'Resigned: joined another company', ...extra }, effectiveDate, reason: 'Resignation accepted by the director' });
  assert.equal((await separate(e.id, pm, 'SEPARATED', day(3))).status, 404, 'a manager outside the line does not even see the record');
  assert.equal((await separate(e.id, aud, 'SEPARATED', day(3))).status, 403, 'only HR changes the employment status');
  const r = await separate(e.id, hr1, 'SEPARATED', day(3));
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal((await separate(e.id, hr1, 'ABSCONDING', day(3))).status, 409, 'one change of this kind at a time');
  await t.act(hr2, r.json.data.workflow.id);
  let got = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(got.employmentStatus, 'ACTIVE', 'still here until the effective date');
  assert.equal(got.changes[0].status, 'SCHEDULED');
  assert.equal(t.api.db.prepare('SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?').get(userId).lifecycle !== 'DEACTIVATED', true);
  const svc = employeesOf(t.api.db);
  assert.equal(svc.cycle(1, { today: day(2) }).applied, 0, 'not yet');
  assert.equal(svc.cycle(1, { today: day(3) }).applied, 1, 'on the effective date');
  got = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(got.employmentStatus, 'SEPARATED');
  assert.equal(got.statusEffectiveDate, day(3));
  assert.match(got.accessNote, /deactivated/);
  assert.equal(t.api.db.prepare('SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?').get(userId).lifecycle, 'DEACTIVATED', 'access is removed');
  assert.equal(t.api.db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(userId).roles_json, '[]');
  assert.deepEqual(got.history.map((h) => h.event), ['SEPARATION', 'JOINED']);
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'hr.employee.separated'").all();
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].payload).data.accessRemoved, true);
  assert.equal(svc.cycle(1, { today: day(4) }).applied, 0, 'idempotent');
  // a separation for today applies on approval; an employee who has left cannot be changed again; absconding removes access too
  const e3 = await t.active({ firstName: 'Third', email: 'third@example.com', mobile: '9811100003', statutory: { ...base().statutory, pan: 'AAAPC3333C', aadhaar: '333344445555' }, bank: { ...base().bank, accountNo: '500500500500' }, dob: '1986-06-06' });
  const u3 = (await t.call(hr1, 'POST', `/employees/${e3.id}/user`, { invite: false })).json.data.user.id;
  const notice = await separate(e3.id, hr1, 'NOTICE', day(0), { lastWorkingDate: day(30) });
  await t.act(hr2, notice.json.data.workflow.id);
  assert.equal((await t.call(hr1, 'GET', `/employees/${e3.id}`)).json.data.employmentStatus, 'NOTICE');
  assert.notEqual(t.api.db.prepare('SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?').get(u3).lifecycle, 'DEACTIVATED', 'a notice does not remove access');
  const abs = await separate(e3.id, hr1, 'ABSCONDING', day(0), { lastWorkingDate: null });
  await t.act(hr2, abs.json.data.workflow.id);
  assert.equal((await t.call(hr1, 'GET', `/employees/${e3.id}`)).json.data.employmentStatus, 'ABSCONDING');
  assert.equal(t.api.db.prepare('SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?').get(u3).lifecycle, 'DEACTIVATED');
  assert.equal((await separate(e3.id, hr1, 'SEPARATED', day(0))).status, 409);
});

test('FR-02 FR-04 FR-07 AC-04 statutory, bank and employment changes go through their chains, are effective-dated and write the history', async () => {
  const t = await setup();
  const e = await t.active();
  const amend = (id, who, body) => t.call(who, 'POST', `/employees/${id}/amend`, body);
  // statutory: HR manager approves; a duplicate PAN is refused; the old value is masked for a manager
  const other = await t.active({ firstName: 'Other', mobile: '9811100009', dob: '1984-04-04', statutory: { ...base().statutory, pan: 'DDDPE4444E', aadhaar: '444455556666' }, bank: { ...base().bank, accountNo: '600600600600' } });
  assert.equal((await amend(e.id, hr1, { type: 'STATUTORY', changes: { pan: 'DDDPE4444E' }, reason: 'PAN corrected after the card was seen' })).status, 400, 'another employee holds that PAN');
  const st = await amend(e.id, hr1, { type: 'STATUTORY', changes: { pan: 'ABCPK9999F', uan: '100200300411' }, reason: 'PAN corrected after the card was seen' });
  assert.equal(st.status, 202, JSON.stringify(st.json));
  assert.equal(JSON.stringify(st.json).includes('ABCPK9999F'), false, 'the new PAN is not echoed');
  assert.equal(JSON.stringify(t.api.db.prepare('SELECT * FROM hr_employee_changes').all()).includes('ABCPK9999F'), false, 'the new PAN is stored encrypted');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, hr1)).json.data.rows.some((x) => x.instance.id === st.json.data.workflow.id), false);
  assert.equal(((await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data.statutory.pan), 'ABCPK1234F', 'unchanged until approved');
  await t.act(hr2, st.json.data.workflow.id);
  const after = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(after.statutory.pan, 'ABCPK9999F');
  assert.equal(after.statutory.uan, '100200300411');
  assert.equal(after.statutory.aadhaar, '•••• •••• 9012', 'fields not asked for keep their value');
  assert.equal(after.changes[0].status, 'APPLIED');
  // bank: HR manager then payroll; payroll's approval verifies it; the old account is replaced
  const bk = await amend(e.id, hr1, { type: 'BANK', changes: { accountNo: '777788889999', ifsc: 'HDFC0000123', accountName: 'Rakesh Kulkarni' }, reason: 'Salary account moved to HDFC' });
  assert.equal(bk.status, 202, JSON.stringify(bk.json));
  assert.equal(JSON.stringify(bk.json).includes('777788889999'), false);
  await t.act(hr2, bk.json.data.workflow.id);
  assert.equal((await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data.banks.find((b) => b.status === 'ACTIVE').last4, '9012', 'payroll has not verified yet');
  await t.act(pay1, bk.json.data.workflow.id);
  const banks = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data.banks;
  assert.equal(banks.find((b) => b.status === 'ACTIVE').last4, '9999');
  assert.equal(banks.find((b) => b.status === 'ACTIVE').verified, 'VERIFIED');
  assert.equal(banks.find((b) => b.last4 === '9012').status, 'REPLACED');
  // employment: designation, grade and manager. A middle grade needs the HR manager; a senior grade the director as well
  const mgr = await t.active({ firstName: 'Boss', mobile: '9811100010', dob: '1980-01-01', statutory: { ...base().statutory, pan: 'EEEPF5555F', aadhaar: '555566667777' }, bank: { ...base().bank, accountNo: '700700700700' } });
  const promo = await amend(e.id, hr1, { type: 'EMPLOYMENT', changes: { designationId: t.ids.mid, managerId: mgr.id }, effectiveDate: day(5), reason: 'Promoted after the annual review', eventType: 'PROMOTION', referenceDoc: 'PL/2026/14' });
  assert.equal(promo.status, 202, JSON.stringify(promo.json));
  await t.act(hr2, promo.json.data.workflow.id);
  let got = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(got.designation, 'Site Engineer', 'effective from a later date');
  assert.equal(got.changes[0].status, 'SCHEDULED');
  assert.equal(employeesOf(t.api.db).cycle(1, { today: day(5) }).applied, 1);
  got = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal([got.designation, got.grade, got.manager.emp_code].join('|'), `Senior Site Engineer|G4|${mgr.code}`, 'the grade follows the designation');
  assert.deepEqual(got.history.map((h) => h.event), ['PROMOTION', 'JOINED']);
  assert.equal(got.history[0].referenceDoc, 'PL/2026/14');
  assert.equal(got.history[0].effectiveDate, day(5));
  assert.equal(got.history[0].from.Designation, 'Site Engineer');
  assert.equal(got.history[0].to.Designation, 'Senior Site Engineer');
  const big = await amend(e.id, hr1, { type: 'EMPLOYMENT', changes: { designationId: t.ids.senior }, reason: 'Appointed General Manager' });
  assert.equal(big.status, 202);
  await t.act(hr2, big.json.data.workflow.id);
  assert.equal((await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data.designation, 'Senior Site Engineer', 'a senior grade also needs the director');
  await t.act(dir, big.json.data.workflow.id);
  got = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(got.designation, 'General Manager');
  assert.ok(got.history.some((h) => h.event === 'DESIGNATION_CHANGE'));
  // a manager cannot be a report of the person (no loop); nothing to change is refused; an increment is recorded without a field change
  assert.equal((await amend(mgr.id, hr1, { type: 'EMPLOYMENT', changes: { managerId: e.id }, reason: 'A loop in the reporting line' })).status, 400);
  assert.equal((await amend(e.id, hr1, { type: 'EMPLOYMENT', changes: { grade: 'G9' }, reason: 'No change at all here' })).status, 400);
  const inc = await amend(e.id, hr1, { type: 'EMPLOYMENT', changes: {}, reason: 'Annual increment', eventType: 'INCREMENT', referenceDoc: 'INC/2026/7' });
  assert.equal(inc.status, 202, JSON.stringify(inc.json));
  await t.act(hr2, inc.json.data.workflow.id); await t.act(dir, inc.json.data.workflow.id).catch(() => {});
  // personal details by HR; a manager and an auditor cannot amend
  assert.equal((await amend(e.id, pm, { type: 'PROFILE', changes: { mobile: '9811100077' }, reason: 'Not allowed to change this' })).status, 404, 'a manager outside the line does not see the record');
  assert.equal((await amend(e.id, aud, { type: 'PROFILE', changes: { mobile: '9811100077' }, reason: 'Not allowed to change this' })).status, 403);
  const prof = await amend(e.id, hr1, { type: 'PROFILE', changes: { mobile: '9811100077', currentAddress: { line: '5 MG Road', city: 'Pune', stateCode: 'MH', pin: '411001' } }, reason: 'New mobile and address' });
  assert.equal(prof.status, 202, JSON.stringify(prof.json));
  await t.act(hr2, prof.json.data.workflow.id);
  got = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(got.mobile, '9811100077');
  assert.equal(got.currentAddress.city, 'Pune');
  void other;
  // a change can be cancelled by the person who asked
  const c = await amend(e.id, hr1, { type: 'PROFILE', changes: { email: 'new@example.com' }, reason: 'Changed e-mail address' });
  const cancelled = await t.call(hr1, 'POST', `/employees/changes/${c.json.data.change.id}/cancel`, { reason: 'Asked by mistake' });
  assert.equal(cancelled.json.data.status, 'CANCELLED');
  assert.equal((await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data.email, 'rakesh.k@example.com');
});

test('FR-01 self-service: an employee sees their own record and asks for a change of contact details, which HR approves; they cannot ask for more', async () => {
  const t = await setup();
  const e = await t.active();
  const user = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, 'rakesh', 'Rakesh Kulkarni', '[\"EMP\"]')").run().lastInsertRowid);
  t.api.db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(user, e.id);
  const self = as('EMP', 'rakesh');
  assert.equal((await t.call(self, 'GET', '/employees/me')).json.data.code, e.code);
  assert.equal((await t.call(emp, 'GET', '/employees/me')).status, 404, 'a user without an employee record');
  const ask = await t.call(self, 'POST', '/employees/me/changes', { type: 'PROFILE', changes: { mobile: '9811100088' }, reason: 'I changed my mobile number' });
  assert.equal(ask.status, 202, JSON.stringify(ask.json));
  assert.equal(ask.json.data.change.selfService, true);
  assert.equal((await t.call(self, 'POST', '/employees/me/changes', { type: 'PROFILE', changes: { dob: '1985-01-01' }, reason: 'I want a younger date' })).status, 403);
  assert.equal((await t.call(self, 'POST', '/employees/me/changes', { type: 'EMPLOYMENT', changes: { grade: 'G9' }, reason: 'I want a higher grade' })).status, 403);
  assert.equal((await t.call(self, 'PATCH', `/employees/${e.id}`, { ...base(), version: 1 })).status, 403);
  await t.act(hr1, ask.json.data.workflow.id);
  assert.equal((await t.call(self, 'GET', '/employees/me')).json.data.mobile, '9811100088');
  // the employee asks for a bank change; payroll verifies in the chain
  const bank = await t.call(self, 'POST', '/employees/me/changes', { type: 'BANK', changes: { accountNo: '888899990000', ifsc: 'SBIN0001234', accountName: 'Rakesh Kulkarni' }, reason: 'New salary account' });
  assert.equal(bank.status, 202, JSON.stringify(bank.json));
});

test('AC-04 FR-01 the approval chain: return and resubmit, reject, withdraw, cancel, delete a draft; the creator never approves; a replay with the same key does nothing twice', async () => {
  const t = await setup();
  const k = 'replay-1';
  const first = await t.api.call('POST', `${H}/employees`, { ...hr1, headers: { ...json, 'idempotency-key': k }, body: { ...t.make({ mobile: '9811100031', statutory: { ...base().statutory, pan: 'GGGPH7777H', aadhaar: '777788880000' }, bank: { ...base().bank, accountNo: '121212121212' } }), submit: true } });
  const replay = await t.api.call('POST', `${H}/employees`, { ...hr1, headers: { ...json, 'idempotency-key': k }, body: { ...t.make({ mobile: '9811100031', statutory: { ...base().statutory, pan: 'GGGPH7777H', aadhaar: '777788880000' }, bank: { ...base().bank, accountNo: '121212121212' } }), submit: true } });
  assert.equal(first.status, 201);
  assert.equal(replay.json.data.id, first.json.data.id);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM hr_employees').get().n, 1);
  assert.equal((await t.api.call('POST', `${H}/employees`, { ...hr1, headers: json, body: t.make() })).status, 400, 'an Idempotency-Key is required');
  const inst = first.json.data.workflow.id;
  // returned for correction
  await t.act(hr2, inst, 'return', 'The emergency phone number is missing a digit');
  let e = (await t.call(hr1, 'GET', `/employees/${first.json.data.id}`)).json.data;
  assert.equal(e.status, 'RETURNED');
  assert.equal((await t.call(hr2, 'PATCH', `/employees/${e.id}`, { ...t.make({ mobile: '9811100031', statutory: { ...base().statutory, pan: 'GGGPH7777H', aadhaar: '777788880000' }, bank: { ...base().bank, accountNo: '121212121212' } }), version: e.rowVersion })).status, 403, 'only the person who entered it corrects it');
  const fixed = await t.call(hr1, 'PATCH', `/employees/${e.id}`, { ...t.make({ mobile: '9811100031', statutory: { ...base().statutory, pan: 'GGGPH7777H', aadhaar: '777788880000' }, bank: { ...base().bank, accountNo: '121212121212' } }), version: e.rowVersion });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  assert.equal((await t.call(hr1, 'PATCH', `/employees/${e.id}`, { ...t.make(), version: 1 })).status, 409, 'a stale version is refused');
  const again = await t.call(hr1, 'POST', `/employees/${e.id}/submit`, {});
  assert.equal(again.status, 202, JSON.stringify(again.json));
  await t.act(hr2, again.json.data.workflow.id, 'reject', 'Duplicate of an employee on the payroll of the sister company');
  e = (await t.call(hr1, 'GET', `/employees/${e.id}`)).json.data;
  assert.equal(e.status, 'REJECTED');
  // withdraw, then cancel
  const d = await t.call(hr1, 'POST', '/employees', { ...t.make({ mobile: '9811100032', statutory: { ...base().statutory, pan: 'HHHPI8888I', aadhaar: '888899991111' }, bank: { ...base().bank, accountNo: '131313131313' } }), submit: true });
  const w = await t.call(hr1, 'POST', `/employees/${d.json.data.id}/withdraw`, { reason: 'Sent too early, joining date unsure' });
  assert.equal(w.json.data.status, 'DRAFT');
  assert.equal((await t.call(hr2, 'DELETE', `/employees/${d.json.data.id}`)).status, 403, 'only the person who entered a draft deletes it');
  const del = await t.call(hr1, 'DELETE', `/employees/${d.json.data.id}`);
  assert.equal(del.json.data.deleted, true);
  assert.equal((await t.call(hr1, 'GET', `/employees/${d.json.data.id}`)).status, 404);
  const s2 = await t.call(hr1, 'POST', '/employees', { ...t.make({ mobile: '9811100033', statutory: { ...base().statutory, pan: 'IIIPJ9999J', aadhaar: '999900002222' }, bank: { ...base().bank, accountNo: '141414141414' } }), submit: true });
  const cc = await t.call(hr1, 'POST', `/employees/${s2.json.data.id}/cancel`, { reason: 'The offer was withdrawn' });
  assert.equal(cc.json.data.status, 'CANCELLED');
  // submission needs the record complete
  const bare = await t.call(hr1, 'POST', '/employees', t.make({ mobile: '9811100034', contacts: [], statutory: null, bank: null }));
  const sub = await t.call(hr1, 'POST', `/employees/${bare.json.data.id}/submit`, {});
  assert.equal(sub.status, 400);
  assert.ok(sub.json.error.details.length >= 3);
  // permissions
  assert.equal((await t.call(se, 'POST', '/employees', t.make())).status, 403);
  assert.equal((await t.call(pay1, 'POST', '/employees', t.make())).status, 403);
  assert.equal((await t.call(other, 'GET', `/employees/${first.json.data.id}`)).status, 404, 'another company sees nothing');
  assert.equal((await t.call(other, 'GET', '/employees')).json.data.length, 0);
});

test('FR-06 FR-05 documents with expiry are reported to HR, the directory filters, the overview counts the live records, the worklist and the lookup work', async () => {
  const t = await setup();
  const a = await t.active();
  const b = await t.active({ firstName: 'Site', lastName: 'Worker', mobile: '9811100041', email: 'sw@example.com', dob: '1993-09-09', locationType: 'SITE', siteId: t.ids.site, designationId: t.ids.mid, departmentId: t.ids.dept2, employmentType: 'CONTRACT', statutory: { ...base().statutory, pan: 'JJJPK1010K', aadhaar: '101010101010' }, bank: { ...base().bank, accountNo: '151515151515' } });
  assert.equal(b.site, 'Ring Road Site 1');
  // documents: added by HR, verified by another person, with expiry
  const doc = await t.call(hr1, 'POST', `/employees/${a.id}/documents`, { docType: 'DRIVING_LICENCE', docNo: 'MH12 20190001234', validFrom: '2019-01-01', validUntil: day(10) });
  assert.equal(doc.status, 201, JSON.stringify(doc.json));
  assert.equal(doc.json.data[0].state, 'DUE');
  assert.equal((await t.call(hr1, 'POST', `/employees/${a.id}/documents/${doc.json.data[0].id}/verify`, {})).status, 403, 'not by the person who added it');
  assert.equal((await t.call(hr2, 'POST', `/employees/${a.id}/documents/${doc.json.data[0].id}/verify`, {})).status, 200);
  await t.call(hr1, 'POST', `/employees/${b.id}/documents`, { docType: 'MEDICAL', validUntil: day(-2) });
  assert.equal((await t.call(hr1, 'POST', `/employees/${a.id}/documents`, { docType: 'MEDICAL', validFrom: day(5), validUntil: day(1) })).status, 400);
  assert.equal((await t.call(hr1, 'POST', `/employees/${a.id}/documents`, { docType: 'ID_PROOF', fileId: 99999 })).status, 400, 'a file that was not uploaded to this employee');
  const cy = employeesOf(t.api.db).cycle(1);
  assert.deepEqual([cy.documentsDue, cy.documentsExpired], [1, 1]);
  assert.deepEqual(Object.values(employeesOf(t.api.db).cycle(1)).slice(1), [0, 0], 'each alert once');
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'hr.employee.document_expiry'").get(), 'HR is told');
  // education, experience, skills without approval (audited)
  const upd = await t.call(hr1, 'PUT', `/employees/${a.id}/details`, { skills: ['AutoCAD', 'Primavera'], languages: ['English'], education: [{ qualification: 'M.Tech Structures', institute: 'IIT Bombay', year: 2015 }], version: (await t.call(hr1, 'GET', `/employees/${a.id}`)).json.data.rowVersion });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.deepEqual(upd.json.data.skills, ['AutoCAD', 'Primavera']);
  assert.equal(upd.json.data.education[0].qualification, 'M.Tech Structures');
  assert.equal((await t.call(hr1, 'PUT', `/employees/${a.id}/details`, { skills: [], version: 1 })).status, 409);
  // the directory: filters, search, sort, paging
  const list = async (q, who = hr1) => (await t.call(who, 'GET', `/employees?${q}`)).json;
  assert.equal((await list('')).meta.total, 2);
  assert.equal((await list('filter[employmentType]=CONTRACT')).data[0].code, b.code);
  assert.equal((await list('filter[locationType]=SITE')).meta.total, 1);
  assert.equal((await list('q=Kulkarni')).meta.total, 1);
  assert.equal((await list('filter[department]=Accounts')).meta.total, 1);
  assert.equal((await list('sort=-name&pageSize=10')).data.map((r) => r.name).join('|'), 'Site Worker|Rakesh Kulkarni');
  assert.equal((await t.call(hr1, 'GET', '/employees?filter[pan]=ABC')).status, 400, 'the PAN is never a filter');
  assert.equal((await t.call(pm, 'GET', '/employees?sort=pan')).status, 400, 'PAN is hidden, so it cannot be sorted by a manager');
  assert.equal((await list('', pm)).meta.total, 0, 'a manager sees only their line');
  // the overview
  const o = (await t.call(hr1, 'GET', '/employees/overview')).json.data;
  assert.equal(o.tiles.find((x) => x.key === 'headcount').value, 2);
  assert.equal(o.tiles.find((x) => x.key === 'joiners').value, 0, 'joined in April, not in the last 30 days');
  assert.equal((await t.call(hr1, 'GET', `/employees/overview?from=2026-03-01&to=${day(0)}`)).json.data.tiles.find((x) => x.key === 'joiners').value, 2);
  assert.ok(o.byDepartment.some((d) => d.label === 'Accounts' && d.n === 1));
  assert.ok(o.bySite.some((d) => d.label === 'Ring Road Site 1'));
  assert.ok(o.attention.some((x) => x.kind === 'ERROR'), 'an expired document is an exception');
  assert.equal((await t.call(se, 'GET', '/employees/overview')).status, 403);
  // the worklist: what waits, documents, oldest first
  const pending = await t.call(hr1, 'POST', '/employees', { ...t.make({ firstName: 'Queue', lastName: 'Person', dob: '1991-11-11', mobile: '9811100042', statutory: { ...base().statutory, pan: 'KKKPL2020L', aadhaar: '202020202020' }, bank: { ...base().bank, accountNo: '161616161616' } }), submit: true });
  const q = (await t.call(hr2, 'GET', '/employees/queue')).json.data;
  assert.equal(q.counts.ACTIVATION, 1);
  assert.equal(q.rows[0].mine, true, 'the task of the second HR manager comes first');
  assert.ok(q.counts.DOCUMENT >= 1);
  assert.equal((await t.call(se, 'GET', '/employees/queue')).status, 403);
  // lookups for forms, print, change list
  const lk = await t.api.call('GET', '/api/v1/hr/lookups/employees?q=Site', hr1);
  assert.equal(lk.json.data[0].code, b.code);
  assert.equal((await t.api.call('GET', '/api/v1/hr/lookups/employees', emp)).status, 403);
  const pr = await t.api.raw('GET', `${H}/employees/${a.id}/print`, pm);
  assert.equal(pr.status, 403);
  const printed = await t.api.raw('GET', `${H}/employees/${a.id}/print`, hr1);
  assert.equal(printed.status, 200);
  assert.match(printed.buffer.toString(), /ABCPK1234F/);
  assert.equal((await t.api.raw('GET', `${H}/employees/${a.id}/print`, aud)).status, 403, 'printing is a permission of its own');
  assert.equal((await t.call(hr1, 'GET', '/employees/changes')).status, 200);
  void pending;
  // link an existing account; the employee code goes onto the account
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'sitew', 'Site Worker', '[]', 'sw@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_user_profiles (company_id, user_id, lifecycle, user_type, language, created_by, source_type) VALUES (1, ?, 'ACTIVE', 'INTERNAL', 'en', 't', 'test')").run(uid);
  const linked = await t.call(hr1, 'POST', `/employees/${b.id}/link-user`, { userId: uid });
  assert.equal(linked.status, 200, JSON.stringify(linked.json));
  assert.equal(linked.json.data.user.username, 'sitew');
  assert.equal(t.api.db.prepare('SELECT employee_code FROM iam_user_profiles WHERE user_id = ?').get(uid).employee_code, b.code);
  assert.equal((await t.call(se, 'POST', `/employees/${a.id}/link-user`, { userId: uid })).status, 403);
});
