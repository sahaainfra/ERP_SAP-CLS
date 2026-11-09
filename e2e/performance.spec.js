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


const OUT = 'docs/erp/screenshots/performance';
const W = '/workflow';
const decide = async (request, c, roles, user, instanceId, action) => {
  const tasks = await api(request, c, roles, user, 'get', `${W}/tasks?mine=assigned`);
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `${W}/tasks/${task.id}/act`, { action, comment: 'checked it' });
};

// Part 07.11: performance management. HR makes a KPI and a second HR person activates it; HR opens a cycle and makes the reviews; Asha sees her KPI with its evidence and disputes nothing wrongly; goals go to the manager; self-review, manager review,
// calibration, approval by the manager, the skip-level reviewer and the HR manager; the appraisal letter; the team page of the manager; feedback; Hindi. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 KPI library, cycle, KPIs with evidence and a dispute, goals, the review through approval, the letter, team, feedback and Hindi, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'PFM' : 'PFD');
  const t = phone ? 'pfm' : 'pfd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['hr2', ['HRMGR']], ['dir1', ['DIR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, g.u(n), n, JSON.stringify(roles), `${g.u(n)}@example.com`);
  const prev = (() => { const d = new Date(Date.now() + 19_800_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const nextYear = new Date(Date.now() + 19_800_000).getUTCFullYear() + 1;
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/performance/kpis');
  const errors = watch(hr.page);
  await expect(hr.page.getByTestId('kpi-library')).toBeVisible();
  await hr.page.getByTestId('kl-code').fill('TASKS'); await hr.page.getByTestId('kl-name').fill('Tasks on time'); await hr.page.getByTestId('kl-metric').selectOption('TASK_ONTIME_PCT');
  await hr.page.getByTestId('kl-target').fill('80'); await hr.page.getByTestId('kl-weight').fill('60'); await hr.page.getByTestId('kl-from').fill(`${prev}-01`);
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '01-kpi-library');
  await hr.page.getByTestId('kl-save').click();
  await expect(hr.page.getByTestId('kl-row').filter({ hasText: 'TASKS' })).toHaveAttribute('data-status', 'DRAFT');
  // a second person activates it
  const hr2 = await open(browser, info, c, 'HRMGR', g.u('hr2'), '/performance/kpis');
  await hr2.page.getByTestId('kl-row').filter({ hasText: 'TASKS' }).getByTestId('kl-activate').click();
  await expect(hr2.page.getByTestId('kl-row').filter({ hasText: 'TASKS' })).toHaveAttribute('data-status', 'ACTIVE');
  // the cycle
  await hr.page.reload();
  await hr.page.getByTestId('cy-code').fill('FY27'); await hr.page.getByTestId('cy-name').fill('Appraisal cycle'); await hr.page.getByTestId('cy-start').fill(`${prev}-01`); await hr.page.getByTestId('cy-end').fill(`${nextYear}-03-31`);
  await hr.page.getByTestId('cy-save').click();
  await expect(hr.page.getByTestId('cy-row').filter({ hasText: 'FY27' })).toHaveAttribute('data-status', 'DRAFT');
  await hr.page.getByTestId('cy-row').filter({ hasText: 'FY27' }).getByTestId('cy-open').click();
  await expect(hr.page.getByTestId('cy-row').filter({ hasText: 'FY27' })).toHaveAttribute('data-status', 'OPEN');
  await shot(hr.page, '02-cycles');
  await hr.page.goto('/performance/reviews');
  await hr.page.getByTestId('rl-launch').click();
  await expect(hr.page.getByTestId('rl-note')).toContainText('3 review');
  // KPI data: two tasks of Asha in the last month, one on time and one late; compute
  const task = (no, due, status, done) => {
    const id = Number(db.prepare("INSERT INTO tsk_tasks (company_id, task_no, title, status, due_date, completed_at, assigner, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'e2e', 'e2e', 'e2e')").run(c, `${t}-${no}`, `Task ${no}`, status, due, done).lastInsertRowid);
    db.prepare("INSERT INTO tsk_assignees (company_id, task_id, user_ref, role, created_by, source_type) VALUES (?, ?, ?, 'ASSIGNEE', 'e2e', 'e2e')").run(c, id, g.u('emp'));
  };
  task('A', `${prev}-05`, 'DONE', `${prev}-04T10:00:00Z`); task('B', `${prev}-12`, 'DONE', `${prev}-14T10:00:00Z`);
  await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/performance/compute', { month: prev });
  // Asha: the KPI with its evidence
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), '/performance');
  const eErrors = watch(emp.page);
  await expect(emp.page.getByTestId('my-performance')).toBeVisible();
  await expect(emp.page.getByTestId('mp-kpis')).toContainText('Tasks on time');
  await expect(emp.page.getByTestId('mp-value')).toHaveText('50%');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '03-my-performance');
  await emp.page.getByTestId('mp-evidence').click();
  await expect(emp.page.getByTestId('ev-records').locator('tbody tr')).toHaveCount(2);
  await expect(emp.page.getByTestId('ev-reproduced')).toContainText('same');
  await shot(emp.page, '04-evidence');
  // the dispute freezes the value; HR decides
  await emp.page.getByTestId('ev-reason').fill('Task B was waiting for the client drawing');
  await emp.page.getByTestId('ev-raise').click();
  await expect(emp.page.getByTestId('mp-note')).toContainText('disputed');
  const dsp = (await api(request, c, 'HRMGR', g.u('hr'), 'get', '/hr/performance/disputes?status=OPEN'))[0];
  await api(request, c, 'HRMGR', g.u('hr'), 'post', `/hr/performance/disputes/${dsp.id}/resolve`, { outcome: 'UPHELD', resolution: 'The client drawing was late; value corrected', adjustedValue: 100 });
  await emp.page.reload();
  await expect(emp.page.getByTestId('mp-value')).toHaveText('100%');
  // goals: Asha writes one and sends it; the manager sees it waiting on the team page and agrees it
  await emp.page.goto('/performance/goals');
  await emp.page.getByTestId('gs-title').fill('Finish the retaining wall'); await emp.page.getByTestId('gs-target').fill('120 m'); await emp.page.getByTestId('gs-weight').fill('50');
  await emp.page.getByTestId('gs-save').click();
  await expect(emp.page.getByTestId('gs-row')).toHaveCount(1);
  await emp.page.getByTestId('gs-propose').click();
  await expect(emp.page.getByTestId('gs-row')).toHaveAttribute('data-status', 'PROPOSED');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '05-goals');
  const mgr = await open(browser, info, c, 'PM', g.u('mgr'), '/performance/team');
  const mErrors = watch(mgr.page);
  await expect(mgr.page.getByTestId('tp-people')).toHaveText('2');
  await expect(mgr.page.getByTestId('tp-goals')).toHaveText('1');
  if (phone) await noOverflow(mgr.page);
  await shot(mgr.page, '06-team');
  const goal = (await api(request, c, 'EMP', g.u('emp'), 'get', '/hr/performance/goals')).goals[0];
  await api(request, c, 'PM', g.u('mgr'), 'post', `/hr/performance/goals/${goal.id}/agree`, {});
  // the review: self, manager, calibration, submit
  const rvId = (await api(request, c, 'EMP', g.u('emp'), 'get', '/hr/reviews')).find((r) => r.employee === 'Asha Kulkarni').id;
  await emp.page.goto(`/performance/review?id=${rvId}`);
  await emp.page.getByTestId('rv-rating').selectOption('5'); await emp.page.getByTestId('rv-comments').fill('I delivered the wall and mentored two juniors');
  await shot(emp.page, '07-self-review');
  await emp.page.getByTestId('rv-self-send').click();
  await expect(emp.page.getByTestId('review')).toHaveAttribute('data-stage', 'MANAGER');
  await mgr.page.goto(`/performance/review?id=${rvId}`);
  await expect(mgr.page.getByTestId('rv-self-comments')).toContainText('mentored');
  await mgr.page.getByTestId('rv-rating').selectOption('3'); await mgr.page.getByTestId('rv-comments').fill('Solid, though one task slipped');
  await mgr.page.getByTestId('rv-manager-send').click();
  await expect(mgr.page.getByTestId('review')).toHaveAttribute('data-stage', 'CALIBRATION');
  await emp.page.reload();
  await expect(emp.page.getByTestId('rv-manager-rating')).toHaveText('Shown after approval');
  await hr.page.goto(`/performance/review?id=${rvId}`);
  await hr.page.getByTestId('rv-cal-rating').selectOption('4'); await hr.page.getByTestId('rv-reason').fill('Compared with the other engineers of the cycle');
  await hr.page.getByTestId('rv-plan-input').fill('Planning course in the first quarter');
  await shot(hr.page, '08-calibrate');
  await hr.page.getByTestId('rv-calibrate-save').click();
  await expect(hr.page.getByTestId('review')).toHaveAttribute('data-stage', 'FINAL');
  await hr.page.getByTestId('rv-submit').click();
  await expect(hr.page.getByTestId('review')).toHaveAttribute('data-status', 'SUBMITTED');
  const inst = (await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/reviews/${rvId}`)).workflowInstanceId;
  await decide(request, c, 'PM', g.u('mgr'), inst, 'approve');
  await decide(request, c, 'DIR', g.u('dir1'), inst, 'approve');
  await decide(request, c, 'HRMGR', g.u('hr2'), inst, 'approve');
  await hr.page.reload();
  await expect(hr.page.getByTestId('review')).toHaveAttribute('data-status', 'APPROVED');
  await hr.page.getByTestId('rv-letter').click();
  await expect(hr.page.getByTestId('rv-note')).toContainText('letter');
  await emp.page.reload();
  await expect(emp.page.getByTestId('rv-final')).toContainText('4');
  await expect(emp.page.getByTestId('rv-manager-rating')).toHaveText('3');
  await expect(emp.page.getByTestId('rv-download')).toBeVisible();
  const pdf = await request.get(`/api/v1/hr/reviews/${rvId}/letter`, { headers: H('EMP', c, g.u('emp')) });
  expect(pdf.status()).toBe(200); expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  expect((await request.get(`/api/v1/hr/reviews/${rvId}/letter`, { headers: H('EMP', c, g.u('emp2')) })).status()).toBeGreaterThanOrEqual(400);
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '09-approved');
  // feedback written by a colleague and read by Asha
  const asha = (await api(request, c, 'EMP', g.u('emp'), 'get', '/hr/ess/home')).employee.id;
  await api(request, c, 'EMP', g.u('emp2'), 'post', '/hr/performance/feedback', { employeeId: asha, kind: 'RECOGNITION', body: 'Thank you for covering the pour on Sunday' });
  await emp.page.goto('/performance/feedback');
  await expect(emp.page.getByTestId('fb-row').first()).toContainText('covering the pour');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '10-feedback');
  await hr.page.goto('/performance/reviews');
  await expect(hr.page.getByText('Asha Kulkarni').first()).toBeVisible();
  // Hindi
  const hi = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  const hp = await hi.newPage();
  const hiErrors = watch(hp);
  await hp.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'hi' })); }, { user: g.u('emp'), roles: 'EMP', company: String(c) });
  await hp.goto('/performance');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('मेरा प्रदर्शन');
  if (phone) await noOverflow(hp);
  await shot(hp, '11-hindi');
  db.close();
  expect([...errors, ...eErrors, ...mErrors, ...hiErrors]).toEqual([]);
});
