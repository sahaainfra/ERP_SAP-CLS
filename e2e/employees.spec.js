import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100).
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' });
  return id;
}
// the people and the organisation of the company: written straight into the throw-away database of the run
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const people = [[`${t}-hr`, ['HRMGR'], 'Hema HR'], [`${t}-hr2`, ['HRMGR'], 'Harsh HR'], [`${t}-pay`, ['PAY'], 'Pooja Payroll'], [`${t}-pm`, ['PM'], 'Pavan Manager'], [`${t}-se`, ['SE'], 'Sanjay Engineer'], [`${t}-dir`, ['DIR'], 'Dina Director'], [`${t}-aud`, ['AUD'], 'Asha Auditor']];
  for (const [name, roles, display] of people) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, name, display, JSON.stringify(roles), `${name}@example.com`);
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ACC', 'Accounts', 'e2e', 'e2e')", c);
  const se = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  const sse = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SSE', 'Senior Site Engineer', 'G4', 4, 'e2e', 'e2e')", c);
  const project = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  const site = one("INSERT INTO org_sites (company_id, org_project_id, code, name, created_by, source_type) VALUES (?, ?, 'S1', 'Ring Road Site 1', 'e2e', 'e2e')", c, project);
  db.close();
  return { dept, se, sse, site, u: (k) => `${t}-${k}` };
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

// Part 07.01: the employee master. HR enters an employee with the wizard (the duplicate PAN of an existing employee shown as it is typed, the documents with expiry), sends it; another HR manager approves; Employee 360
// shows the history and the statutory data to HR but masked to the project manager the employee reports to. A promotion asked for on the page waits for the date and then writes the history. The overview and the
// directory show live figures. On a computer and a phone.
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked the documents and the details' });
};
const body = (g, over = {}) => ({
  firstName: 'Rakesh', lastName: 'Kulkarni', gender: 'MALE', dob: '1990-05-17', mobile: '9876500011', email: 'rakesh.k@example.com', permanentAddress: { line: '12 Shivaji Nagar', city: 'Pune', stateCode: 'MH', pin: '411005' }, departmentId: g.dept, designationId: g.se,
  employmentType: 'PERMANENT', doj: '2026-04-01', locationType: 'HO', salaryPaymentMode: 'BANK_TRANSFER', languages: ['English'], skills: [], contacts: [{ type: 'EMERGENCY', name: 'Sunita', relation: 'Spouse', phone: '9876500022' }], education: [], experience: [],
  statutory: { pan: 'ABCPK1234F', aadhaar: '123456789012', pfApplicable: true, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '123456789012', ifsc: 'SBIN0001234', accountName: 'Rakesh Kulkarni' }, ...over,
});
async function setup(request, code) {
  const c = await company(request, code);
  const g = seed(c, code.toLowerCase());
  const active = async (over = {}) => {
    const r = await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/employees', { ...body(g, over), submit: true });
    await act(request, c, 'HRMGR', g.u('hr2'), r.workflow.id);
    return r;
  };
  return { c, g, active };
}

test('FR-01 FR-02 FR-06 FR-09 AC-01 the wizard: the duplicate PAN shown while typing, the documents, sent for approval, approved by another HR manager, Employee 360 with history and masking', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const s = await setup(request, phone ? 'EMWM' : 'EMWD');
  const boss = await s.active({ firstName: 'Mahesh', lastName: 'Patil', mobile: '9811100001', dob: '1980-01-01', statutory: { pan: 'AAAPP1111A', aadhaar: '111122223333', pfApplicable: false, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '555566667777', ifsc: 'SBIN0001234', accountName: 'Mahesh Patil' } });
  const p = await open(browser, info, s.c, 'HRMGR', s.g.u('hr'), '/hr/employees/new');
  const errors = watch(p.page);
  await p.page.getByTestId('ne-first').fill('Anil');
  await p.page.getByTestId('ne-last').fill('Deshmukh');
  await p.page.getByTestId('ne-gender').selectOption('MALE');
  await p.page.getByTestId('ne-dob').fill('1992-08-21');
  await p.page.getByTestId('ne-mobile').fill('9822200033');
  await p.page.getByTestId('ne-email').fill('anil.d@example.com');
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('ne-next').click();
  await p.page.locator('#emp-department').click();
  await p.page.getByRole('option', { name: /Engineering/ }).click();
  await p.page.locator('#emp-designation').click();
  await p.page.getByRole('option', { name: /Site Engineer/ }).first().click();
  await expect(p.page.getByTestId('emp-grade')).toHaveValue('G3');
  await p.page.locator('#emp-manager').click();
  await p.page.getByRole('option', { name: /Mahesh Patil/ }).click();
  await p.page.getByTestId('ne-doj').fill('2026-11-02');
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('ne-next').click();
  await p.page.getByTestId('ne-pan').fill('AAAPP1111A');
  await expect(p.page.getByTestId('ne-duplicates')).toContainText('same PAN');
  await p.page.getByTestId('ne-pan').fill('BBBPD2222B');
  await p.page.getByTestId('ne-aadhaar').fill('222233334444');
  await p.page.getByTestId('ne-acct').fill('50100012345678');
  await p.page.getByTestId('ne-ifsc').fill('HDFC0000240');
  await p.page.getByTestId('ne-acct-name').fill('Anil Deshmukh');
  await expect(p.page.getByTestId('ne-duplicates')).toHaveCount(0);
  await p.page.getByTestId('ne-next').click();
  await p.page.getByTestId('contact-name').first().fill('Meera Deshmukh');
  await p.page.getByTestId('contact-relation').first().fill('Mother');
  await p.page.getByTestId('contact-phone').first().fill('9822200044');
  await p.page.getByTestId('add-nominee').click();
  await p.page.getByTestId('contact-name').nth(1).fill('Meera Deshmukh');
  await p.page.getByTestId('contact-relation').nth(1).fill('Mother');
  await p.page.getByTestId('contact-share').fill('100');
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('ne-next').click();
  await expect(p.page.getByTestId('ne-review')).toContainText('••••••5678');
  await p.page.getByTestId('ne-save-docs').click();
  await expect(p.page.getByTestId('ne-documents')).toBeVisible();
  await p.page.getByTestId('ne-doc-type').selectOption('DRIVING_LICENCE');
  await p.page.getByTestId('ne-doc-until').fill('2031-03-31');
  await p.page.getByTestId('ne-doc-add').click();
  await expect(p.page.getByTestId('ne-doc-list')).toContainText('Driving licence');
  await p.page.getByTestId('ne-send').click();
  await expect(p.page.getByTestId('e3-sent')).toBeVisible();
  await expect(p.page.getByRole('heading', { level: 1 })).toContainText('EMP-00002');
  await expect(p.page.getByTestId('employee-page')).toContainText('Waiting for approval');
  const id = Number(new URL(p.page.url()).searchParams.get('id'));
  const draft = await api(request, s.c, 'HRMGR', s.g.u('hr'), 'get', `/hr/employees/${id}`);
  await act(request, s.c, 'HRMGR', s.g.u('hr2'), draft.instanceId);
  await p.page.reload();
  await expect(p.page.getByTestId('employee-page')).toContainText('Approved');
  await p.page.getByTestId('e3-tab-statutory').click();
  await expect(p.page.getByTestId('e3-pan')).toContainText('BBBPD2222B');
  await p.page.getByTestId('e3-tab-bank').click();
  await expect(p.page.getByTestId('e3-bank').first()).toContainText('••••••5678');
  await p.page.getByTestId('e3-tab-history').click();
  await expect(p.page.getByTestId('e3-history-row').first()).toContainText('Joined');
  await p.page.getByTestId('e3-tab-documents').click();
  await expect(p.page.getByTestId('e3-doc').first()).toContainText('Driving licence');
  if (phone) await noOverflow(p.page);
  // the manager sees the basic data and a masked PAN; a site engineer outside the line does not see the person
  const pmUser = s.g.u('pm');
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  const uid = db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(s.c, pmUser).id;
  db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(uid, boss.id); db.close();
  const m = await open(browser, info, s.c, 'PM', pmUser, `/hr/employees/employee?id=${id}`);
  await expect(m.page.getByTestId('employee-page')).toContainText('Anil Deshmukh');
  await expect(m.page.getByTestId('e3-tab-documents')).toHaveCount(0);
  await m.page.getByTestId('e3-tab-statutory').click();
  await expect(m.page.getByTestId('e3-statutory')).toContainText('••••••222B'.slice(0, 6) + '222B');
  await expect(m.page.getByTestId('e3-statutory')).not.toContainText('BBBPD2222B');
  const se = await open(browser, info, s.c, 'SE', s.g.u('se'), `/hr/employees/employee?id=${id}`);
  await expect(se.page.getByText(/does not exist|could not|not found/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('FR-02 FR-07 BR-02 an employment change asked for on Employee 360 is approved and applied on its date; the overview and the directory show the live figures; the employee asks for a change of their own', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const s = await setup(request, phone ? 'EMCM' : 'EMCD');
  const e = await s.active();
  const e2 = await s.active({ firstName: 'Sita', lastName: 'Rane', gender: 'FEMALE', mobile: '9811100002', dob: '1991-02-02', locationType: 'SITE', siteId: s.g.site, statutory: { pan: 'CCCPR3333C', aadhaar: '333344445555', pfApplicable: true, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '700700700700', ifsc: 'SBIN0001234', accountName: 'Sita Rane' } });
  void e2;
  const p = await open(browser, info, s.c, 'HRMGR', s.g.u('hr'), `/hr/employees/employee?id=${e.id}`);
  const errors = watch(p.page);
  await expect(p.page.getByTestId('e3-department')).toContainText('Engineering');
  await p.page.getByTestId('e3-amend').click();
  await p.page.getByTestId('e3-amend-type').selectOption('EMPLOYMENT');
  await p.page.locator('#emp-designation').click();
  await p.page.getByRole('option', { name: /Senior Site Engineer/ }).click();
  await p.page.getByTestId('e3-amend-event').selectOption('PROMOTION');
  await p.page.getByTestId('e3-amend-reason').fill('Promoted after the annual review of 2026');
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('e3-amend-go').click();
  await expect(p.page.getByTestId('e3-amend-note')).toContainText('Sent for approval');
  const full = await api(request, s.c, 'HRMGR', s.g.u('hr'), 'get', `/hr/employees/${e.id}`);
  const change = full.changes[0];
  await act(request, s.c, 'HRMGR', s.g.u('hr2'), change.instanceId);
  await p.page.reload();
  await expect(p.page.getByTestId('e3-designation')).toContainText('Senior Site Engineer');
  await p.page.getByTestId('e3-tab-history').click();
  await expect(p.page.getByTestId('e3-history-row').first()).toContainText('Promotion');
  await p.page.getByTestId('e3-tab-changes').click();
  await expect(p.page.getByTestId('e3-change').first()).toContainText('Applied');
  // the overview: headcount and the bars; the tile opens the directory
  const o = await open(browser, info, s.c, 'HRMGR', s.g.u('hr'), '/hr?view=detail');
  await expect(o.page.getByTestId('hro-headcount')).toHaveText('2');
  await expect(o.page.getByTestId('hr-overview')).toContainText('Engineering');
  await expect(o.page.getByTestId('hr-overview')).toContainText('Ring Road Site 1');
  if (phone) await noOverflow(o.page);
  await o.page.getByTestId('hro-headcount').click();
  await expect(o.page).toHaveURL(/\/hr\/employees/);
  await expect(o.page.getByText('Rakesh Kulkarni').first()).toBeVisible();
  await expect(o.page.getByText('Sita Rane').first()).toBeVisible();
  if (phone) await noOverflow(o.page);
  // the auditor can read but not enter
  const a = await open(browser, info, s.c, 'AUD', s.g.u('aud'), '/hr/employees');
  await expect(a.page.getByText('Rakesh Kulkarni').first()).toBeVisible();
  await expect(a.page.getByRole('button', { name: /New employee/ })).toHaveCount(0);
  // the employee's own record
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  const self = s.g.u('emp');
  db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, 'Rakesh Kulkarni', '[\"EMP\"]', ?)").run(s.c, self, `${self}@example.com`);
  const uid = db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(s.c, self).id;
  db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(uid, e.id); db.close();
  const me = await open(browser, info, s.c, 'EMP', self, '/hr/employees/employee?me=1');
  await expect(me.page.getByTestId('employee-page')).toContainText('EMP-00001');
  await me.page.getByTestId('e3-amend').click();
  await me.page.getByTestId('e3-amend-mobile').fill('9811100077');
  await me.page.getByTestId('e3-amend-reason').fill('I changed my mobile number');
  await me.page.getByTestId('e3-amend-go').click();
  await expect(me.page.getByTestId('e3-amend-note')).toContainText('Sent for approval');
  if (phone) await noOverflow(me.page);
  expect(errors).toEqual([]);
});
