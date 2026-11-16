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

// Screenshots of the HR pages for the completion report (part 07.01): docs/erp/screenshots/employees/, on a computer and a phone.
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked the documents and the details' });
};
const body = (g, over = {}) => ({
  firstName: 'Rakesh', lastName: 'Kulkarni', gender: 'MALE', dob: '1990-05-17', mobile: '9876500011', email: 'rakesh.k@example.com', permanentAddress: { line: '12 Shivaji Nagar', city: 'Pune', stateCode: 'MH', pin: '411005' }, departmentId: g.dept, designationId: g.se,
  employmentType: 'PERMANENT', doj: '2026-04-01', locationType: 'HO', salaryPaymentMode: 'BANK_TRANSFER', languages: ['English', 'Hindi'], skills: ['AutoCAD'], contacts: [{ type: 'EMERGENCY', name: 'Sunita Kulkarni', relation: 'Spouse', phone: '9876500022' }, { type: 'NOMINEE', name: 'Sunita Kulkarni', relation: 'Spouse', sharePct: '100' }],
  education: [{ qualification: 'B.E. Civil', institute: 'COEP Pune', year: 2012 }], experience: [], statutory: { pan: 'ABCPK1234F', aadhaar: '123456789012', uan: '100200300400', pfApplicable: true, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '123456789012', ifsc: 'SBIN0001234', accountName: 'Rakesh Kulkarni' }, ...over,
});
const OUT = 'docs/erp/screenshots/employees';
test('screenshots of the HR pages', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'EMSM' : 'EMSD');
  const g = seed(c, phone ? 'emsm' : 'emsd');
  const active = async (over) => { const r = await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/employees', { ...body(g, over), submit: true }); await act(request, c, 'HRMGR', g.u('hr2'), r.workflow.id); return r; };
  const boss = await active({ firstName: 'Mahesh', lastName: 'Patil', mobile: '9811100001', dob: '1980-01-01', designationId: g.sse, statutory: { pan: 'AAAPP1111A', aadhaar: '111122223333', pfApplicable: false, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '555566667777', ifsc: 'SBIN0001234', accountName: 'Mahesh Patil' } });
  const e = await active({ managerId: boss.id });
  await active({ firstName: 'Sita', lastName: 'Rane', gender: 'FEMALE', mobile: '9811100002', dob: '1991-02-02', locationType: 'SITE', siteId: g.site, statutory: { pan: 'CCCPR3333C', aadhaar: '333344445555', pfApplicable: true, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '700700700700', ifsc: 'SBIN0001234', accountName: 'Sita Rane' } });
  await api(request, c, 'HRMGR', g.u('hr'), 'post', `/hr/employees/${e.id}/documents`, { docType: 'DRIVING_LICENCE', docNo: 'MH12 20190001234', validFrom: '2019-01-01', validUntil: '2031-03-31' });
  const promo = await api(request, c, 'HRMGR', g.u('hr'), 'post', `/hr/employees/${e.id}/amend`, { type: 'EMPLOYMENT', changes: { designationId: g.sse }, reason: 'Promoted after the annual review', eventType: 'PROMOTION', referenceDoc: 'PL/2026/14' });
  await act(request, c, 'HRMGR', g.u('hr2'), promo.workflow.id);
  const pending = await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/employees', { ...body(g, { firstName: 'Neha', lastName: 'Joshi', gender: 'FEMALE', mobile: '9811100003', dob: '1994-04-04', statutory: { pan: 'DDDPJ4444D', aadhaar: '444455556666', pfApplicable: true, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '800800800800', ifsc: 'SBIN0001234', accountName: 'Neha Joshi' } }), submit: true });
  void pending;
  const shot = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/hr?view=detail');
  const errors = watch(hr.page);
  await expect(hr.page.getByTestId('hro-headcount')).toHaveText('3');
  await shot(hr.page, '01-hr-overview');
  await hr.page.goto('/hr/employees');
  await expect(hr.page.getByText('Rakesh Kulkarni').first()).toBeVisible();
  await shot(hr.page, '02-employee-directory');
  await hr.page.goto('/hr/employees/new');
  await hr.page.getByTestId('ne-first').fill('Anil');
  await hr.page.getByTestId('ne-last').fill('Deshmukh');
  await hr.page.getByTestId('ne-mobile').fill('9811100001');
  await hr.page.getByTestId('ne-dob').fill('1992-08-21');
  await hr.page.getByTestId('ne-gender').selectOption('MALE');
  await expect(hr.page.getByTestId('ne-duplicates')).toContainText('same mobile');
  await shot(hr.page, '03-new-employee-duplicate-check');
  await hr.page.goto(`/hr/employees/employee?id=${e.id}`);
  await expect(hr.page.getByTestId('e3-designation')).toContainText('Senior Site Engineer');
  await shot(hr.page, '04-employee-360-personal');
  await hr.page.getByTestId('e3-tab-statutory').click();
  await expect(hr.page.getByTestId('e3-pan')).toContainText('ABCPK1234F');
  await shot(hr.page, '05-employee-360-statutory-hr');
  await hr.page.getByTestId('e3-tab-history').click();
  await shot(hr.page, '06-employee-360-history');
  await hr.page.getByTestId('e3-tab-documents').click();
  await shot(hr.page, '07-employee-360-documents');
  await hr.page.getByTestId('e3-tab-personal').click();
  await hr.page.getByTestId('e3-amend').click();
  await hr.page.getByTestId('e3-amend-type').selectOption('SEPARATION');
  await shot(hr.page, '08-employee-360-amend-status');
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  const uid = db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(c, g.u('pm')).id;
  db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(uid, boss.id); db.close();
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/hr/employees/employee?id=${e.id}&tab=statutory`);
  await expect(pm.page.getByTestId('e3-statutory')).toContainText('Masked for your role');
  await shot(pm.page, '09-employee-360-statutory-masked-for-manager');
  await pm.page.goto('/hr/employees');
  await expect(pm.page.getByText('Rakesh Kulkarni').first()).toBeVisible();
  await shot(pm.page, '10-employee-directory-manager');
  if (phone) await noOverflow(hr.page);
  expect(errors).toEqual([]);
});
