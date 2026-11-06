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
const iso = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00Z`) - 19_800_000).toISOString();
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const users = {};
  for (const [n, roles] of [['hr', ['HRMGR']], ['hr2', ['HRMGR']], ['ws', ['WSUP']], ['cfo', ['CFO']], ['emp', ['EMP']], ['emp2', ['EMP']]]) users[n] = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`).lastInsertRowid);
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  const des = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  const p1 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  const s1 = one("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (?, ?, 'N1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 'e2e', 'e2e')", c, p1);
  let n = 0;
  const emp = (name, code, userId = null) => { n += 1; return one("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, employment_type, doj, location_type, employment_status, record_status, user_id, grade, created_by, source_type) VALUES (?, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, 'G3', 'e2e', 'e2e')", c, code, name, `${t}${n}`, `92000${String(n).padStart(5, '0')}${t.length}`, dept, des, userId); };
  const dep = (e) => one("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (?, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 'e2e', 'e2e')", c, `DEP-${t}-${e}`, e, p1, s1, p1, s1);
  const people = { asha: emp('Asha Kulkarni', `${t.toUpperCase()}A`, users.emp), bhanu: emp('Bhanu Rao', `${t.toUpperCase()}B`, users.emp2) };
  for (const e of Object.values(people)) dep(e);
  const shift = one("INSERT INTO att_shifts (company_id, code, name, start_minute, end_minute, break_minutes, grace_minutes, half_day_minutes, full_day_minutes, ot_after_minutes, status, created_by, source_type) VALUES (?, 'GEN', 'General', 540, 1080, 60, 15, 240, 480, 480, 'ACTIVE', 'e2e', 'e2e')", c);
  one("INSERT INTO att_policies (company_id, code, name, version_no, effective_from, rules_json, band, status, created_by, source_type) VALUES (?, 'PO', 'Policy PO', 1, '2026-01-01', ?, 'STANDARD', 'APPROVED', 'e2e', 'e2e')", c, JSON.stringify({ late: { enabled: true, countPerHalfDay: 3 }, earlyGoing: { enabled: true, graceMinutes: 0, countPerHalfDay: 3 }, missingPunch: { mode: 'REGULARISE' }, compOff: { enabled: false }, ot: { enabled: true, multiplier: 2, maxPerDayMinutes: 360, maxPerWeekMinutes: 1200, eligibleGrades: [], eligibleCategories: [] } }));
  one("INSERT INTO att_policy_assignments (company_id, scope_type, scope_id, policy_code, shift_id, weekly_off_json, effective_from, created_by, source_type) VALUES (?, 'COMPANY', 0, 'PO', ?, ?, '2026-01-01', 'e2e', 'e2e')", c, shift, JSON.stringify({ type: 'FIXED', days: [0] }));
  let u = 0;
  const punch = (e, date, type, hhmm) => { u += 1; one("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, method, recorded_by, client_uuid, result, project_id, site_id, created_by, source_type) VALUES (?, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, ?, 'MOBILE', 'e2e', ?, 'ACCEPTED', ?, ?, 'e2e', 'e2e')", c, e, s1, type, date, iso(date, hhmm), iso(date, hhmm), iso(date, hhmm), `${t}-${e}-${u}-0000-0000-000000000000`, p1, s1); };
  for (const d of ['2026-08-03', '2026-08-05', '2026-08-06', '2026-08-07']) for (const e of Object.values(people)) { punch(e, d, 'IN', '09:00'); punch(e, d, 'OUT', '18:00'); }
  punch(people.asha, '2026-08-04', 'IN', '09:00'); // no out punch
  punch(people.bhanu, '2026-08-04', 'IN', '09:00'); punch(people.bhanu, '2026-08-04', 'OUT', '18:00');
  db.close();
  return { s1, p1, people, u: (k) => `${t}-${k}` };
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

const OUT = 'docs/erp/screenshots/register';

// Part 07.06: the attendance register. HR sees the month (August 2026) and the missing punch of Asha on the 4th; Asha asks for a regularisation from her phone; the supervisor approves it from the worklist; the register shows the day as present;
// Asha claims overtime; HR sees the checklist of the period lock, locks the period, and the daily list shows the rows. On a computer and a phone; screenshots for the report.
test('AC-01 the register, a regularisation from the employee to the supervisor, the overtime request and the lock of the period, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'RGM' : 'RGD');
  const g = seed(c, phone ? 'rgm' : 'rgd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  // HR runs the register for the site
  await api(request, c, 'HRMGR', g.u('hr'), 'post', '/att/recompute', { siteId: g.s1, from: '2026-08-01', to: '2026-08-31' });
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/att/register');
  const errors = watch(hr.page);
  await hr.page.getByTestId('rgs-period').fill('2026-08-15');
  await expect(hr.page.getByTestId('rgs-head')).toContainText('2026-08-01 to 2026-08-31');
  await expect(hr.page.getByTestId('rgs-row')).toHaveCount(2);
  await expect(hr.page.getByTestId('rgs-open')).toBeVisible();
  const cells = hr.page.locator('[data-testid="rgs-cell"][data-code="M"]');
  await expect(cells).toHaveCount(1);
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '01-register');
  await cells.first().click();
  await expect(hr.page.getByTestId('rgs-day')).toContainText('Missing punch');
  await shot(hr.page, '02-register-day');
  await hr.page.getByTestId('rgs-day-close').click();
  await expect(hr.page.getByTestId('rgs-xlsx')).toBeVisible();
  // Asha asks for the regularisation
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), '/att/regularisation');
  const empErrors = watch(emp.page);
  await expect(emp.page.getByTestId('rq-me')).toHaveValue(/Asha/);
  await emp.page.getByTestId('rq-date').fill('2026-08-04');
  await emp.page.getByTestId('rq-out').fill('2026-08-04T18:05');
  await emp.page.getByTestId('rq-reason').fill('The card reader did not beep at the gate');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '03-regularisation-form');
  await emp.page.getByTestId('rq-send').click();
  await expect(emp.page.getByTestId('rq-note')).toContainText('was sent for approval');
  await expect(emp.page.getByTestId('rq-row')).toHaveCount(1);
  await shot(emp.page, '04-regularisation-sent');
  // the supervisor approves it from the worklist
  const ws = await open(browser, info, c, 'WSUP', g.u('ws'), '/att/approvals');
  const wsErrors = watch(ws.page);
  await expect(ws.page.getByTestId('ap-row')).toHaveCount(1);
  await expect(ws.page.getByTestId('ap-row')).toContainText('Asha Kulkarni');
  if (phone) await noOverflow(ws.page);
  await shot(ws.page, '05-approvals');
  await ws.page.getByTestId('ap-pick').check();
  await ws.page.getByTestId('ap-approve').click();
  await expect(ws.page.getByTestId('ap-done')).toContainText('1 done');
  await expect(ws.page.getByTestId('ap-row')).toHaveCount(0);
  // the register has the day
  await hr.page.reload();
  await hr.page.getByTestId('rgs-period').fill('2026-08-15');
  await expect(hr.page.locator('[data-testid="rgs-cell"][data-code="M"]')).toHaveCount(0);
  await shot(hr.page, '06-register-after');
  // the overtime request, from the phone or the computer
  await emp.page.goto('/att/overtime');
  await emp.page.getByTestId('rq-date').fill('2026-08-05');
  await emp.page.getByTestId('rq-hours').fill('1.5');
  await emp.page.getByTestId('rq-reason').fill('Finishing the deck pour');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '07-overtime-form');
  await emp.page.getByTestId('rq-send').click();
  await expect(emp.page.getByTestId('rq-note')).toContainText('was sent for approval');
  // the period lock: the overtime request still waits, so the checklist says so; once decided, HR locks
  await hr.page.goto('/att/lock');
  await hr.page.getByTestId('pl-period').fill('2026-08-15');
  await expect(hr.page.getByTestId('pl-checklist')).toContainText('1 overtime request(s) wait');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '08-lock-not-ready');
  await ws.page.reload();
  await ws.page.getByTestId('ap-pick').check();
  await ws.page.getByTestId('ap-approve').click();
  await expect(ws.page.getByTestId('ap-done')).toContainText('1 done');
  await hr.page.reload();
  await hr.page.getByTestId('pl-period').fill('2026-08-15');
  await expect(hr.page.getByTestId('pl-checklist')).toContainText('No overtime request waits');
  await hr.page.getByTestId('pl-lock').click();
  await expect(hr.page.getByTestId('pl-note')).toContainText('The period is locked');
  await expect(hr.page.getByTestId('pl-locked')).toContainText('Locked by');
  await shot(hr.page, '09-locked');
  await hr.page.goto('/att/register');
  await hr.page.getByTestId('rgs-period').fill('2026-08-15');
  await expect(hr.page.getByTestId('rgs-locked')).toBeVisible();
  // the daily list
  await hr.page.goto('/att/daily');
  await expect(hr.page.getByRole('heading', { name: 'Daily Attendance' }).first()).toBeVisible();
  await expect(hr.page.getByText('Asha Kulkarni').first()).toBeVisible();
  await shot(hr.page, '10-daily');
  expect([...errors, ...empErrors, ...wsErrors]).toEqual([]);
});
