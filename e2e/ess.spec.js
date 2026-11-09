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

const OUT = 'docs/erp/screenshots/ess';
const W = '/workflow';
const decide = async (request, c, roles, user, instanceId, action) => {
  const tasks = await api(request, c, roles, user, 'get', `${W}/tasks?mine=assigned`);
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, 'the task waits for the approver').toBeTruthy();
  await api(request, c, roles, user, 'post', `${W}/tasks/${task.id}/act`, { action, comment: 'checked it' });
};

// Part 07.09: employee and manager self-service. Asha sees her day and month on My HR, her attendance, asks for an employment letter and a change of her mobile number; the HR manager approves the letter and HR issues it from the template;
// Asha downloads the PDF; her manager sees both reportees on My Team; a Hindi session shows the Hindi labels. On a computer and a phone, no console errors, no horizontal scroll; screenshots for the report.
test('AC-01 My HR, My Attendance, a letter from request to PDF, a profile change, My Team and Hindi, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'ESM' : 'ESD');
  const g = seed(c, phone ? 'esm' : 'esd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), '/my-hr');
  const errors = watch(emp.page);
  await expect(emp.page.getByTestId('my-hr')).toBeVisible();
  await expect(emp.page.getByTestId('mh-who')).toContainText('Asha Kulkarni');
  await expect(emp.page.getByTestId('mh-today')).toBeVisible();
  await expect(emp.page.getByTestId('mh-month')).toBeVisible();
  await expect(emp.page.getByTestId('mh-team')).toHaveCount(0);
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '01-my-hr');
  await emp.page.goto('/my-hr/attendance');
  await expect(emp.page.getByTestId('my-attendance')).toBeVisible();
  await expect(emp.page.getByTestId('ma-totals')).toBeVisible();
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '02-attendance');
  // a letter request
  await emp.page.goto('/my-hr/letters');
  await emp.page.getByTestId('lr-type').selectOption('EMPLOYMENT');
  await emp.page.getByTestId('lr-purpose').fill('Bank loan application');
  await emp.page.getByTestId('lr-to').fill('The Branch Manager');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '03-letter-form');
  await emp.page.getByTestId('lr-send').click();
  await expect(emp.page.getByTestId('lr-note')).toContainText('sent');
  const row = emp.page.getByTestId('lr-row').first();
  await expect(row).toHaveAttribute('data-status', 'SUBMITTED');
  await shot(emp.page, '04-letter-sent');
  const mine = await api(request, c, 'EMP', g.u('emp'), 'get', '/hr/ess/letters?scope=mine');
  const letter = mine[0];
  await decide(request, c, 'HRMGR', g.u('hr'), letter.workflowInstanceId, 'approve');
  // HR issues it
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/my-hr/letters');
  const hErrors = watch(hr.page);
  await expect(hr.page.getByTestId('lq-row')).toHaveCount(1);
  await hr.page.getByTestId('lq-issue').click();
  await expect(hr.page.getByTestId('lr-note')).toContainText('issued');
  await shot(hr.page, '05-hr-issue');
  await emp.page.goto('/my-hr/letters');
  await expect(emp.page.getByTestId('lr-row').first()).toHaveAttribute('data-status', 'ISSUED');
  await expect(emp.page.getByTestId('lr-download')).toBeVisible();
  const pdf = await request.get(`/api/v1/hr/ess/letters/${letter.id}/content`, { headers: H('EMP', c, g.u('emp')) });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  // somebody else cannot download it
  expect((await request.get(`/api/v1/hr/ess/letters/${letter.id}/content`, { headers: H('EMP', c, g.u('emp2')) })).status()).toBeGreaterThanOrEqual(400);
  // a profile change
  await emp.page.goto('/my-hr/profile');
  await emp.page.getByTestId('pc-mobile').fill('9876512345');
  await emp.page.getByTestId('pc-reason').fill('New number');
  await emp.page.getByTestId('pc-send').click();
  await expect(emp.page.getByTestId('pc-note')).toBeVisible();
  await expect(emp.page.getByTestId('pc-list')).toBeVisible();
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '06-profile');
  // the manager's team
  const mgr = await open(browser, info, c, 'PM', g.u('mgr'), '/my-team');
  const mErrors = watch(mgr.page);
  await expect(mgr.page.getByTestId('my-team')).toBeVisible();
  await expect(mgr.page.getByTestId('mt-row')).toHaveCount(2);
  await expect(mgr.page.getByTestId('mt-total')).toHaveText('2');
  await expect(mgr.page.getByText('Meera Manager')).toHaveCount(0);
  if (phone) await noOverflow(mgr.page);
  await shot(mgr.page, '07-my-team');
  // Hindi
  const hi = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  const hp = await hi.newPage();
  const hiErrors = watch(hp);
  await hp.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'hi' })); }, { user: g.u('emp'), roles: 'EMP', company: String(c) });
  await hp.goto('/my-hr');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('मेरा HR');
  if (phone) await noOverflow(hp);
  await shot(hp, '08-hindi');
  await hp.goto('/my-hr/letters');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('पत्र अनुरोध');
  expect([...errors, ...hErrors, ...mErrors, ...hiErrors]).toEqual([]);
});
