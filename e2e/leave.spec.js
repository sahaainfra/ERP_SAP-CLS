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
  const users = {};
  for (const [n, roles] of [['hr', ['HRMGR']], ['mgr', ['PM']], ['emp', ['EMP']], ['emp2', ['EMP']]]) users[n] = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`).lastInsertRowid);
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  const des = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  const p1 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  const s1 = one("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (?, ?, 'N1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 'e2e', 'e2e')", c, p1);
  let n = 0;
  const emp = (name, code, userId = null, managerId = null) => { n += 1; return one("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, site_id, project_id, grade, created_by, source_type) VALUES (?, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, ?, ?, ?, 'G3', 'e2e', 'e2e')", c, code, name, `${t}${n}`, `93000${String(n).padStart(5, '0')}${t.length}`, dept, des, userId, managerId, s1, p1); };
  const dep = (e) => one("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (?, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 'e2e', 'e2e')", c, `DEP-${t}-${e}`, e, p1, s1, p1, s1);
  const manager = emp('Meera Manager', `${t.toUpperCase()}M`, users.mgr);
  const asha = emp('Asha Kulkarni', `${t.toUpperCase()}A`, users.emp, manager); const bhanu = emp('Bhanu Rao', `${t.toUpperCase()}B`, users.emp2, manager);
  for (const e of [manager, asha, bhanu]) dep(e);
  const shift = one("INSERT INTO att_shifts (company_id, code, name, start_minute, end_minute, break_minutes, grace_minutes, half_day_minutes, full_day_minutes, ot_after_minutes, status, created_by, source_type) VALUES (?, 'GEN', 'General', 540, 1080, 60, 15, 240, 480, 480, 'ACTIVE', 'e2e', 'e2e')", c);
  one("INSERT INTO att_policies (company_id, code, name, version_no, effective_from, rules_json, band, status, created_by, source_type) VALUES (?, 'PO', 'Policy PO', 1, '2026-01-01', ?, 'STANDARD', 'APPROVED', 'e2e', 'e2e')", c, JSON.stringify({ late: { enabled: true, countPerHalfDay: 3 }, earlyGoing: { enabled: true, graceMinutes: 0, countPerHalfDay: 3 }, missingPunch: { mode: 'REGULARISE' }, compOff: { enabled: false }, ot: { enabled: false } }));
  one("INSERT INTO att_policy_assignments (company_id, scope_type, scope_id, policy_code, shift_id, weekly_off_json, effective_from, created_by, source_type) VALUES (?, 'COMPANY', 0, 'PO', ?, ?, '2026-01-01', 'e2e', 'e2e')", c, shift, JSON.stringify({ type: 'FIXED', days: [0] }));
  db.close();
  return { s1, p1, u: (k) => `${t}-${k}` };
}
const open = async (browser, info, c, roles, user, path, extra = {}) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, ...extra });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

const OUT = 'docs/erp/screenshots/leave';

// Part 07.07: leave. HR runs the accrual; Asha applies for two days in December on the page, sees the days, the balance after and that Bhanu is away on one of them; the manager approves from the worklist; My Leave shows the leave and the
// balance; the team calendar shows both; Asha cancels it before it starts and the days go back; HR sees the balance report, edits a leave type and previews the year-end. On a computer and a phone; screenshots for the report.
test('AC-01 apply, approve and cancel leave, the balance, the team calendar, the types and the year-end, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'LVM' : 'LVD');
  const g = seed(c, phone ? 'lvm' : 'lvd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/leave/accrual/run', { from: '2026-01-01', to: '2026-12-31' });
  // Bhanu has applied for the 15th already (through the API, as he would)
  const bhanu = (await api(request, c, 'EMP', g.u('emp2'), 'get', '/hr/leave/my')).employeeId;
  const types = await api(request, c, 'HRMGR', g.u('hr'), 'get', '/hr/leave/types');
  await api(request, c, 'EMP', g.u('emp2'), 'post', '/hr/applications', { employeeId: bhanu, leaveTypeId: types.find((x) => x.code === 'CL').id, fromDate: '2026-12-15', toDate: '2026-12-15', halfDay: 'NONE', reason: 'Visiting the bank', submit: true });
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), '/leave/apply');
  const errors = watch(emp.page);
  await emp.page.getByTestId('al-from').fill('2026-12-14'); await emp.page.getByTestId('al-to').fill('2026-12-15');
  await expect(emp.page.getByTestId('al-days')).toContainText('2 days');
  await expect(emp.page.getByTestId('al-balance')).toContainText('after this leave 10');
  await expect(emp.page.getByTestId('al-clash')).toContainText('Bhanu Rao');
  await emp.page.getByTestId('al-reason').fill('Cousin wedding in Nagpur');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '01-apply');
  await emp.page.getByTestId('al-send').click();
  await expect(emp.page.getByTestId('ml-note')).toContainText('was sent for approval');
  await expect(emp.page.getByTestId('ml-row').first()).toHaveAttribute('data-status', 'SUBMITTED');
  await expect(emp.page.getByTestId('ml-balance').filter({ has: emp.page.locator('[data-label="Type"]', { hasText: 'Casual' }) })).toContainText('12');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '02-my-leave');
  // the manager approves from the worklist
  const mgr = await open(browser, info, c, 'PM', g.u('mgr'), '/leave/approvals');
  const mErrors = watch(mgr.page);
  await expect(mgr.page.getByTestId('la-row')).toHaveCount(2);
  await mgr.page.getByLabel(/Pick LV-\d+, Asha Kulkarni/).check();
  if (phone) await noOverflow(mgr.page);
  await shot(mgr.page, '03-approvals');
  await mgr.page.getByTestId('la-approve').click();
  await expect(mgr.page.getByTestId('la-done')).toContainText('1 done');
  await emp.page.goto('/leave/my');
  await expect(emp.page.getByTestId('ml-row').first()).toHaveAttribute('data-status', 'APPROVED');
  await expect(emp.page.getByTestId('ml-balance').filter({ hasText: 'Casual' })).toContainText('10');
  // the team calendar
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/leave/calendar');
  const hErrors = watch(hr.page);
  await hr.page.getByTestId('tc-from').fill('2026-12-01');
  await expect(hr.page.getByTestId('tc-row')).toHaveCount(2);
  await expect(hr.page.locator('[data-testid="tc-cell"][data-status="APPROVED"]')).toHaveCount(2);
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '04-calendar');
  // Asha cancels before it starts: the days go back
  await emp.page.goto('/leave/my');
  emp.page.once('dialog', (d) => d.accept('Plans changed, the wedding moved'));
  await emp.page.getByTestId('ml-row').first().getByTestId('ml-cancel').click();
  await expect(emp.page.getByTestId('ml-note')).toContainText('days went back');
  await expect(emp.page.getByTestId('ml-balance').filter({ hasText: 'Casual' })).toContainText('12');
  await shot(emp.page, '05-cancelled');
  // the balance report, the types, the year-end
  await hr.page.goto('/leave/balances');
  await expect(hr.page.getByText('Asha Kulkarni').first()).toBeVisible();
  await shot(hr.page, '06-balances');
  await hr.page.goto('/leave/types');
  await hr.page.locator('[data-testid="lt-row"][data-code="CL"]').getByTestId('lt-edit').click();
  await hr.page.getByTestId('lt-maxConsecutive').fill('4');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '07-types');
  await hr.page.getByTestId('lt-save').click();
  await expect(hr.page.getByTestId('lt-note')).toContainText('was saved');
  await hr.page.goto('/leave/year-end');
  await hr.page.getByTestId('ye-year').fill('2026');
  await expect(hr.page.getByTestId('ye-totals')).toBeVisible();
  await expect(hr.page.getByTestId('ye-waiting')).toContainText('1 leave application');
  await expect(hr.page.getByTestId('ye-run')).toBeDisabled();
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '08-year-end');
  expect([...errors, ...mErrors, ...hErrors]).toEqual([]);
});
