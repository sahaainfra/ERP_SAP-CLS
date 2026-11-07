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
  for (const [n, roles] of [['hr', ['HRMGR']], ['hr2', ['HRMGR']], ['dir', ['DIR']], ['pm', ['PM']], ['ws', ['WSUP']], ['se', ['SE']]]) {
    users[n] = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`).lastInsertRowid);
  }
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  const des = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  const p1 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  const p2 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P2', 'River Bridge', 'BRIDGE', 'ACTIVE', 'e2e', 'e2e')", c);
  const site = (p, code, name) => one("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (?, ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')", c, p, code, name);
  const s1 = site(p1, 'N1', 'Ring Road North'); const s2 = site(p2, 'B1', 'Bridge Pier Yard');
  for (const [p, u] of [[p1, 'pm']]) db.prepare("INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, applied, created_by, source_type) VALUES (?, 'PROJECT', ?, 'PROJECT_MANAGER', ?, '2026-01-01', 1, 'e2e', 'e2e')").run(c, p, users[u]);
  let n = 0;
  const emp = (name, userId = null) => { n += 1; return one("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, employment_type, doj, location_type, employment_status, record_status, user_id, created_by, source_type) VALUES (?, ?, 'Emp', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, 'e2e', 'e2e')", c, `${t.toUpperCase()}${100 + n}`, name, name.toLowerCase(), `97000000${String(n).padStart(2, '0')}`, dept, des, userId); };
  const ashaUser = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-asha`, 'Asha Kulkarni', '[]', `${t}-asha@example.com`).lastInsertRowid);
  const people = { asha: emp('Asha Kulkarni', ashaUser), bhanu: emp('Bhanu Rao'), chetan: emp('Chetan Iyer') };
  for (const p of Object.values(people)) one("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (?, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 'e2e', 'e2e')", c, `${t}-D${p}`, p, p1, s1, p1, s1);
  db.close();
  return { dept, des, p1, p2, s1, s2, people, u: (k) => `${t}-${k}` };
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
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
// The first day from tomorrow that is a Monday to Thursday in India, so it and the two days after it are working days (Sunday is the weekly off): the roster steps do not depend on the day the test runs.
const R = (() => { let n = 1; while (![1, 2, 3, 4].includes(new Date(`${day(n)}T00:00:00Z`).getUTCDay())) n += 1; return n; })();


const OUT = 'docs/erp/screenshots/attendance';

// Part 07.04: shifts, policies, assignment, roster. HR makes a day shift and a night shift on the editor (the summary says the night shift ends the next day), writes a policy whose examples are worked out by the server and sends it;
// the HR manager and the director approve; HR assigns it with a shift and the Sunday off to the company and sees who gets what; the project manager plans a rotating pattern on the roster planner, asks for a change of one day (it waits,
// Undo withdraws it) and the supervisor and the project manager approve another; the planner then shows it. On a computer and a phone; screenshots for the report.
test('AC-01 shifts, policy with examples, assignment and who gets what, roster planner with a change, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'ATM' : 'ATD');
  const g = seed(c, phone ? 'atm' : 'atd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/hr/attendance/shifts/shift');
  const errors = watch(hr.page);
  await hr.page.getByTestId('se-code').fill('GEN');
  await hr.page.getByTestId('se-name').fill('General');
  await expect(hr.page.getByTestId('se-summary')).toContainText('9 h on site, 8 h paid');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '01-shift-editor');
  await hr.page.getByTestId('se-save').click();
  await expect(hr.page.getByTestId('shift-editor')).toContainText('GEN · General');
  // a night shift: the summary says it ends the next day
  await hr.page.goto('/hr/attendance/shifts/shift');
  await hr.page.getByTestId('se-code').fill('NIGHT');
  await hr.page.getByTestId('se-name').fill('Night');
  await hr.page.getByTestId('se-start').fill('22:00');
  await hr.page.getByTestId('se-end').fill('06:00');
  await hr.page.getByTestId('se-full').fill('7');
  await hr.page.getByTestId('se-ot').fill('7.5');
  await expect(hr.page.getByTestId('se-summary')).toContainText('the next day');
  await hr.page.getByTestId('se-save').click();
  await expect(hr.page.getByTestId('shift-editor')).toContainText('NIGHT · Night');
  await hr.page.goto('/hr/attendance/shifts');
  await expect(hr.page.getByTestId('shifts')).toContainText('GEN');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '02-shifts');
  // the policy: the examples are computed by the server
  await hr.page.goto('/hr/attendance/policies/policy');
  await hr.page.getByTestId('pe-code').fill('STD');
  await hr.page.getByTestId('pe-name').fill('Standard attendance');
  await hr.page.getByTestId('pe-from').fill(day(1));
  await hr.page.getByTestId('pe-ot-on').check();
  await hr.page.getByTestId('pe-ot-day').fill('120');
  await expect(hr.page.getByTestId('pe-ex-table')).toBeVisible();
  await expect(hr.page.getByTestId('pe-ex-row')).toHaveCount(7);
  await expect(hr.page.getByTestId('pe-ex-table')).toContainText('half day off');
  await expect(hr.page.getByTestId('pe-ex-table')).toContainText('× 2');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '03-policy-editor');
  await hr.page.getByTestId('pe-send').click();
  await expect(hr.page.getByTestId('pe-sent')).toBeVisible();
  const polId = Number(new URL(hr.page.url()).searchParams.get('id'));
  const pol = await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/att/policies/${polId}`);
  expect(pol.band).toBe('PAY_IMPACTING');
  await act(request, c, 'HRMGR', g.u('hr2'), pol.workflowInstanceId);
  await act(request, c, 'DIR', g.u('dir'), pol.workflowInstanceId);
  await hr.page.reload();
  await expect(hr.page.getByTestId('policy-editor')).toContainText('Approved');
  await shot(hr.page, '04-policy-approved');
  // the assignment and who gets what
  await hr.page.goto('/hr/attendance/assignment');
  await expect(hr.page.getByTestId('policy-assignment')).toBeVisible();
  await hr.page.getByTestId('pa-policy').selectOption('STD');
  await hr.page.getByTestId('pa-shift').selectOption({ label: `GEN · 09:00 to 18:00` });
  await hr.page.getByTestId('pa-from').fill(day(-30));
  await hr.page.getByTestId('pa-go').click();
  await expect(hr.page.getByTestId('pa-note')).toContainText('Assigned');
  await expect(hr.page.getByTestId('pa-level-COMPANY')).toContainText('STD');
  await hr.page.locator('#pa-res-emp').click(); await hr.page.getByRole('option', { name: /Asha Kulkarni/ }).click();
  await hr.page.getByTestId('pa-res-date').fill(day(R));
  await hr.page.getByTestId('pa-res-go').click();
  await expect(hr.page.getByTestId('pa-res-policy')).toContainText('STD');
  await expect(hr.page.getByTestId('pa-res-shift')).toContainText('GEN');
  await expect(hr.page.getByTestId('pa-period-now')).toContainText('day 1');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '05-policy-assignment');
  // the roster planner: a rotating pattern, a change that waits, a change that is approved
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/hr/attendance/roster?siteId=${g.s1}&from=${day(R)}`);
  const pmErrors = watch(pm.page);
  await expect(pm.page.getByTestId('rp-row')).toHaveCount(3);
  await pm.page.getByTestId('pt-name').fill('Rotation');
  await pm.page.getByTestId('pt-from').fill(day(R));
  await pm.page.getByTestId('pt-day-0').selectOption({ label: 'GEN' });
  await pm.page.getByTestId('pt-day-1').selectOption({ label: 'NIGHT' });
  await pm.page.getByTestId('pt-day-2').selectOption({ label: 'GEN' });
  await pm.page.getByTestId('pt-day-3').selectOption('OFF');
  await pm.page.getByTestId('pt-create').click();
  await expect(pm.page.getByTestId('rp-patterns')).toContainText('GEN → NIGHT → GEN → Off');
  await pm.page.reload();
  await expect(pm.page.getByTestId('rp-row').first().getByTestId('rp-cell').first()).toContainText('GEN');
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '06-roster-planner');
  await pm.page.getByTestId('rp-row').first().getByTestId('rp-cell').nth(2).getByTestId('rp-change').selectOption({ label: 'NIGHT' });
  await expect(pm.page.getByTestId('rp-undo')).toContainText('sent for approval');
  await shot(pm.page, '07-roster-change-waiting');
  await pm.page.getByTestId('rp-undo-go').click();
  await expect(pm.page.getByTestId('rp-undo')).toHaveCount(0);
  const ch = await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/att/roster-changes', { siteId: g.s1, kind: 'CHANGE', employeeId: g.people.asha, workDate: day(R + 1), shiftId: null, isOff: true, reason: 'A day off asked for', submit: true });
  await act(request, c, 'WSUP', g.u('ws'), ch.workflowInstanceId);
  await act(request, c, 'PM', g.u('pm'), ch.workflowInstanceId);
  await pm.page.reload();
  await expect(pm.page.getByTestId('rp-row').first().getByTestId('rp-cell').nth(1)).toContainText('*');
  await expect(pm.page.getByTestId('rp-changes')).toContainText('Approved');
  expect(errors, 'no console errors on the editors').toEqual([]);
  expect(pmErrors, 'no console errors on the planner').toEqual([]);
});

test('AC-03 a site engineer reads shifts and cannot change them; the pages show no console errors', async ({ browser, request }, info) => {
  const phone = info.project.name === 'mobile';
  const c = await company(request, phone ? 'AUM' : 'AUD');
  const g = seed(c, phone ? 'aum' : 'aud');
  const se = await open(browser, info, c, 'SE', g.u('se'), '/hr/attendance/shifts');
  const errors = watch(se.page);
  await expect(se.page.getByTestId('shifts')).toBeVisible();
  await expect(se.page.getByRole('button', { name: 'New shift' })).toHaveCount(0);
  const denied = await request.post('/api/v1/hr/att/shifts', { headers: H('SE', c, g.u('se')), data: { code: 'X', name: 'X', startTime: '09:00', endTime: '18:00', halfDayHours: 4, fullDayHours: 8 } });
  expect(denied.status()).toBe(403);
  for (const path of ['/hr/attendance/policies', '/hr/attendance/assignment', '/hr/attendance/roster']) {
    await se.page.goto(path);
    await expect(se.page.locator('h1, [role="alert"]').first()).toBeVisible();
    if (phone) await noOverflow(se.page);
  }
  expect(errors).toEqual([]);
});
