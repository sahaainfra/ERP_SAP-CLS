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


const OUT = 'docs/erp/screenshots/exit';
const W = '/workflow';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', `${W}/tasks?mine=assigned`);
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `${W}/tasks/${task.id}/act`, { action, comment: 'checked it' });
};

// Part 07.13: exit, full-and-final inputs, grievances and disciplinary records. Asha resigns on her phone: the notice of the policy, the last working day it gives; her manager and the HR manager accept it; she fills the exit interview and sees
// the clearances. HR starts a termination of Bhanu with an earlier last day; the director approves; his access goes at once; IT clears its item from the worklist, HR waives the rest, the full-and-final goes to payroll and the relieving letter is
// issued. Asha raises an anonymous grievance and follows it by its code; HR notes and resolves it; she accepts. HR opens a disciplinary case, issues a show-cause and the employee answers. Hindi. On a computer and a phone, no console errors, no
// horizontal scroll.
test('T-01 resignation, approvals, interview, a termination whose last day passed, clearance, F&F and letter, an anonymous grievance, a disciplinary case and Hindi, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(540_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'XTM' : 'XTD');
  const t = phone ? 'xtm' : 'xtd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['hr2', ['HRMGR']], ['dir', ['DIR']], ['it', ['ITADM']], ['pay', ['PAY']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, g.u(n), n, JSON.stringify(roles), `${g.u(n)}@example.com`);
  db.close();
  const day = (n) => new Date(Date.now() + 19_800_000 + n * 86_400_000).toISOString().slice(0, 10);
  // Asha resigns: the notice of the policy and the day it gives
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), '/exit/resign');
  const eErrors = watch(emp.page);
  await expect(emp.page.getByTestId('resignation')).toHaveAttribute('data-status', 'NONE');
  await expect(emp.page.getByTestId('rs-policy')).toContainText('Asha Kulkarni');
  await emp.page.getByTestId('rs-reason-code').selectOption('HIGHER_STUDIES'); await emp.page.getByTestId('rs-reason').fill('Admitted to a master’s programme');
  await expect(emp.page.getByTestId('rs-preview')).toContainText('Last working day');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '01-resignation');
  await emp.page.getByTestId('rs-send').click();
  await expect(emp.page.getByTestId('resignation')).toHaveAttribute('data-status', 'SUBMITTED');
  const mine = await api(request, c, 'EMP', g.u('emp'), 'get', '/hr/separations/mine');
  const sepA = mine.separation;
  await decide(request, c, 'PM', g.u('mgr'), sepA.workflowInstanceId); await decide(request, c, 'HRMGR', g.u('hr'), sepA.workflowInstanceId);
  await emp.page.reload();
  await expect(emp.page.getByTestId('resignation')).toHaveAttribute('data-status', 'APPROVED');
  await expect(emp.page.getByTestId('rs-clearances')).toContainText('IT');
  await emp.page.getByTestId('iv-rating').selectOption('4'); await emp.page.getByTestId('iv-liked').fill('The site team'); await emp.page.getByTestId('iv-rejoin').selectOption('yes');
  await emp.page.getByTestId('iv-save').click();
  await expect(emp.page.getByTestId('rs-interview-done')).toBeVisible();
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '02-resignation-accepted');
  // HR starts a termination of Bhanu with a day already passed; the director approves
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/exit/separations');
  const hErrors = watch(hr.page);
  await expect(hr.page.getByTestId('separations')).toBeVisible();
  await hr.page.getByRole('button', { name: 'Initiate termination' }).first().click();
  await hr.page.locator('#sl-emp').click(); await hr.page.locator('#sl-emp').fill('Bhanu'); await hr.page.getByRole('option', { name: /Bhanu Rao/ }).click();
  await hr.page.getByTestId('sl-reason-code').selectOption('PERFORMANCE'); await hr.page.getByTestId('sl-reason').fill('Did not meet the improvement plan');
  await hr.page.getByTestId('sl-on').fill(day(-20)); await hr.page.getByTestId('sl-lwd').fill(day(-1));
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '03-terminate');
  await hr.page.getByTestId('sl-send').click();
  await expect(hr.page.getByTestId('separation')).toHaveAttribute('data-status', 'SUBMITTED');
  const sepB = Number(new URL(hr.page.url()).searchParams.get('id'));
  const instB = (await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/separations/${sepB}`)).workflowInstanceId;
  await decide(request, c, 'HRMGR', g.u('hr2'), instB); await decide(request, c, 'DIR', g.u('dir'), instB);
  await hr.page.reload();
  await expect(hr.page.getByTestId('separation')).toHaveAttribute('data-status', 'APPROVED');
  await expect(hr.page.getByTestId('fnf-blockers')).toContainText('Clearance pending');
  // IT clears its item from the worklist: the account went on the last working day
  const it = await open(browser, info, c, 'ITADM', g.u('it'), '/exit/clearances');
  const iErrors = watch(it.page);
  const item = it.page.getByTestId('cw-item').filter({ hasText: 'Bhanu Rao' });
  await expect(item).toHaveAttribute('data-tone', 'RED');
  await expect(item.getByTestId('cw-facts')).toContainText('closed');
  await item.getByTestId('cw-all').click(); await item.getByTestId('cw-save').click();
  await expect(it.page.getByTestId('cw-note')).toContainText('saved');
  if (phone) await noOverflow(it.page);
  await shot(it.page, '04-clearances');
  // HR waives the rest; the F&F goes to payroll; the relieving letter
  await hr.page.reload();
  hr.page.on('dialog', (d) => d.accept('Handled offline by the department head'));
  for (let i = 0; i < 6; i += 1) {
    await expect(hr.page.getByTestId('sp-clr-row').first()).toBeVisible();
    if (!(await hr.page.getByTestId('sp-waive').count())) break;
    await hr.page.getByTestId('sp-waive').first().click(); await expect(hr.page.getByTestId('sp-note')).toContainText('waived'); await hr.page.reload();
  }
  await expect(hr.page.getByTestId('sp-clr-row').filter({ hasText: 'Pending' })).toHaveCount(0);
  await expect(hr.page.getByTestId('fnf-release')).toBeEnabled();
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '05-fnf-ready');
  await hr.page.getByTestId('fnf-release').click();
  await expect(hr.page.getByTestId('fnf-released')).toBeVisible();
  await hr.page.getByTestId('sp-relieving').click();
  await expect(hr.page.getByTestId('sp-note')).toContainText('issued');
  await expect(hr.page.getByTestId('separation')).toHaveAttribute('data-status', 'SETTLED');
  await shot(hr.page, '06-settled');
  // Asha raises an anonymous grievance and keeps the code
  await emp.page.goto('/grievances/new');
  await emp.page.getByTestId('rg-category').selectOption('ACCOMMODATION'); await emp.page.getByTestId('rg-subject').fill('Drinking water at the labour camp'); await emp.page.getByTestId('rg-description').fill('The water filter at the camp has not worked for a week.');
  await emp.page.getByTestId('rg-anonymous').check();
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '07-raise-grievance');
  await emp.page.getByTestId('rg-send').click();
  const code = (await emp.page.getByTestId('rg-code').textContent()).trim();
  expect(code).toMatch(/^[0-9A-F]{12}$/);
  await shot(emp.page, '08-tracking-code');
  // HR notes and resolves it
  const list = await api(request, c, 'HRMGR', g.u('hr'), 'get', '/hr/grievances');
  const grv = (Array.isArray(list) ? list : list.rows).find((r) => r.subject === 'Drinking water at the labour camp');
  await hr.page.goto(`/grievances/grievance?id=${grv.id}`);
  await expect(hr.page.getByTestId('grievance')).toHaveAttribute('data-status', 'SUBMITTED');
  await hr.page.getByTestId('gv-text').fill('Plumber booked for tomorrow'); await hr.page.getByTestId('gv-note-add').click();
  await expect(hr.page.getByTestId('gv-note')).toContainText('Note added');
  await hr.page.getByTestId('gv-text').fill('The filter was replaced and the water tested.'); await hr.page.getByTestId('gv-resolve').click();
  await expect(hr.page.getByTestId('grievance')).toHaveAttribute('data-status', 'RESOLVED');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '09-grievance-resolved');
  // Asha follows it by its code and accepts
  await emp.page.goto('/grievances');
  await emp.page.getByTestId('gl-code').fill(code); await emp.page.getByTestId('gl-track-go').click();
  await expect(emp.page.getByTestId('gl-tracked')).toContainText('Plumber booked');
  await expect(emp.page.getByTestId('gl-resolution')).toContainText('filter was replaced');
  await emp.page.getByTestId('gl-accept').click();
  await expect(emp.page.getByTestId('gl-tracked')).toContainText('Closed');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '10-grievance-tracked');
  // a disciplinary case: HR opens it, issues a show-cause; the manager answers
  await hr.page.goto('/disciplinary');
  await hr.page.getByTestId('dc-new').click();
  await hr.page.locator('#dc-emp').click(); await hr.page.locator('#dc-emp').fill('Meera'); await hr.page.getByRole('option', { name: /Meera Manager/ }).click();
  await hr.page.getByTestId('dc-date').fill(day(-3)); await hr.page.getByTestId('dc-category').selectOption('SAFETY_BREACH'); await hr.page.getByTestId('dc-severity').selectOption('MAJOR');
  await hr.page.getByTestId('dc-incident').fill('Allowed work at height without harnesses on block C.');
  await hr.page.getByTestId('dc-create').click();
  await expect(hr.page.getByTestId('dc-note')).toContainText('opened');
  await hr.page.getByTestId('dc-open').first().click();
  await hr.page.getByTestId('dc-stage').selectOption('SHOW_CAUSE'); await hr.page.getByTestId('dc-due').fill(day(3)); await hr.page.getByTestId('dc-text').fill('Explain why the permit to work was not followed.');
  await hr.page.getByTestId('dc-step-go').click();
  await expect(hr.page.getByTestId('dc-row').first()).toHaveAttribute('data-status', 'SHOW_CAUSE');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '11-disciplinary');
  const mgr = await open(browser, info, c, 'PM', g.u('mgr'), '/disciplinary/mine');
  const mErrors = watch(mgr.page);
  await mgr.page.getByTestId('dc-open').first().click();
  await expect(mgr.page.getByTestId('dc-incident-text')).toHaveCount(0);
  await mgr.page.getByTestId('dc-answer').fill('The harness store was locked; I have arranged a second key.'); await mgr.page.getByTestId('dc-answer-send').click();
  await expect(mgr.page.getByTestId('dc-row').first()).toHaveAttribute('data-status', 'RESPONDED');
  if (phone) await noOverflow(mgr.page);
  await shot(mgr.page, '12-disciplinary-answer');
  // Hindi
  const hi = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  const hp = await hi.newPage();
  const hiErrors = watch(hp);
  await hp.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'hi' })); }, { user: g.u('emp'), roles: 'EMP', company: String(c) });
  await hp.goto('/exit/resign');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('इस्तीफा');
  if (phone) await noOverflow(hp);
  await shot(hp, '13-hindi');
  expect([...eErrors, ...hErrors, ...iErrors, ...mErrors, ...hiErrors]).toEqual([]);
});
