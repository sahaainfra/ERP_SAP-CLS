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


const OUT = 'docs/erp/screenshots/training';

// Part 07.10: training, certifications, skills. HR sets up a mandatory course and plans a session for today, nominates two people; Asha signs in with the code of the session on her phone; HR marks the score and completes the session; the compliance
// report shows her compliant; a draft session is moved on the calendar; an expired operator licence shows in the register; a manager assesses a skill in the matrix; Hindi labels. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 course set-up, a session with QR sign-in, attendance, completion, calendar move, certificates, skill matrix, compliance and Hindi, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'TRM' : 'TRD');
  const g = seed(c, phone ? 'trm' : 'trd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 19_800_000 + 86_400_000).toISOString().slice(0, 10);
  // HR: set-up through the page
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/training/setup');
  const errors = watch(hr.page);
  await expect(hr.page.getByTestId('training-setup')).toBeVisible();
  await hr.page.getByTestId('su-t-code').fill('WAHT'); await hr.page.getByTestId('su-t-name').fill('Working at height ticket'); await hr.page.getByTestId('su-t-validity').fill('12');
  await hr.page.getByTestId('su-t-save').click();
  await expect(hr.page.getByTestId('su-note')).toContainText('Saved');
  await expect(hr.page.getByTestId('su-types')).toContainText('Working at height ticket');
  await hr.page.getByTestId('su-c-code').fill('WAH'); await hr.page.getByTestId('su-c-title').fill('Working at height'); await hr.page.getByTestId('su-c-all').check();
  await hr.page.getByTestId('su-c-validity').fill('12'); await hr.page.getByTestId('su-c-pass').fill('60'); await hr.page.getByTestId('su-c-cert').selectOption('WAHT');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '01-setup');
  await hr.page.getByTestId('su-c-save').click();
  await expect(hr.page.getByTestId('su-course-row').filter({ hasText: 'WAH' })).toHaveCount(1);
  await api(request, c, 'HRMGR', g.u('hr'), 'put', '/hr/training/skill-defs', { code: 'SHUTTER', name: 'Shuttering', trade: 'Carpentry' });
  // HR: plan a session for today and send it
  await hr.page.goto('/training');
  await hr.page.getByTestId('tcal-new').click();
  const courseId = (await api(request, c, 'HRMGR', g.u('hr'), 'get', '/hr/training/courses'))[0].id;
  await hr.page.getByTestId('sf-course').selectOption(String(courseId));
  await hr.page.getByTestId('sf-start').fill(`${today}T00:01`); await hr.page.getByTestId('sf-end').fill(`${today}T23:58`);
  await hr.page.getByTestId('sf-trainer').fill('Safety trainer'); await hr.page.getByTestId('sf-venue').fill('Site hall'); await hr.page.getByTestId('sf-capacity').fill('10');
  await shot(hr.page, '02-plan');
  await hr.page.getByTestId('sf-send').click();
  await expect(hr.page.getByTestId('training-session')).toHaveAttribute('data-status', 'APPROVED');
  const sid = Number(new URL(hr.page.url()).searchParams.get('id'));
  // nominations (the manager nominates the team)
  await api(request, c, 'PM', g.u('mgr'), 'post', `/hr/sessions/${sid}/nominations`, { people: [{ personType: 'EMPLOYEE', personId: (await api(request, c, 'EMP', g.u('emp'), 'get', '/hr/ess/home')).employee.id }, { personType: 'EMPLOYEE', personId: (await api(request, c, 'EMP', g.u('emp2'), 'get', '/hr/ess/home')).employee.id }] });
  await hr.page.reload();
  await expect(hr.page.getByTestId('ts-row')).toHaveCount(2);
  await hr.page.getByTestId('ts-qr-show').click();
  await expect(hr.page.getByTestId('ts-qr').locator('svg')).toBeVisible();
  const url = await hr.page.getByTestId('ts-qr-url').innerText();
  expect(url).toContain('/training/mine?t=');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '03-session');
  // Asha signs in with the code (the address the QR code opens)
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), url.replace(/^https?:\/\/[^/]+/, ''));
  const eErrors = watch(emp.page);
  await expect(emp.page.getByTestId('mt-token')).toHaveValue(/.{8,}/);
  await emp.page.getByTestId('mt-signin-go').click();
  await expect(emp.page.getByTestId('mt-note')).toContainText('signed in');
  await expect(emp.page.getByTestId('mt-up-row')).toHaveCount(1);
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '04-my-training');
  // HR: marks the score of Asha, completes the session
  await hr.page.reload();
  const row = hr.page.getByTestId('ts-row').filter({ hasText: 'Asha Kulkarni' });
  await expect(row).toHaveAttribute('data-attendance', 'ATTENDED');
  await row.getByTestId('ts-score').fill('85');
  await row.getByTestId('ts-present').click();
  await expect(hr.page.getByTestId('ts-note')).toContainText('Attendance recorded');
  await hr.page.getByTestId('ts-complete').click();
  await expect(hr.page.getByTestId('ts-note')).toContainText('1 certificate');
  await expect(hr.page.getByTestId('training-session')).toHaveAttribute('data-status', 'COMPLETED');
  await shot(hr.page, '05-completed');
  // Asha: the certificate, and the feedback
  await emp.page.goto('/training/mine');
  await expect(emp.page.getByTestId('mt-cert-row')).toHaveCount(1);
  await expect(emp.page.getByTestId('mt-cert-row')).toHaveAttribute('data-state', 'VALID');
  await emp.page.getByTestId('mt-rating').selectOption('5');
  await emp.page.getByTestId('mt-rate-go').click();
  await expect(emp.page.getByTestId('mt-note')).toContainText('Thank you');
  // compliance: Asha is compliant, Bhanu and the manager are not
  await hr.page.goto('/training/compliance');
  await expect(hr.page.getByTestId('cp-compliant')).toHaveText('1');
  await expect(hr.page.getByTestId('cp-row').filter({ hasText: 'Asha Kulkarni' })).toHaveAttribute('data-status', 'COMPLIANT');
  await expect(hr.page.getByTestId('cp-row').filter({ hasText: 'Bhanu Rao' })).toHaveAttribute('data-status', 'NOT_DONE');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '06-compliance');
  await hr.page.getByTestId('cp-tab-cost').click();
  await expect(hr.page.getByTestId('cc-summary')).toBeVisible();
  // the calendar: a draft for tomorrow moves with the date field and back with undo
  const draft = await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/sessions', { courseId, startAt: `${tomorrow}T10:00`, endAt: `${tomorrow}T12:00`, trainer: 'T', venue: 'Hall', capacity: 5, cost: 0, submit: false });
  await hr.page.goto('/training');
  await expect(hr.page.getByTestId('tcal-chip').first()).toBeVisible();
  const dayAfter = new Date(Date.now() + 19_800_000 + 2 * 86_400_000).toISOString().slice(0, 10);
  if (dayAfter.slice(0, 7) === today.slice(0, 7)) {
    await hr.page.getByTestId('tcal-table').locator('tr', { hasText: draft.docNo }).getByTestId('tcal-move').fill(dayAfter);
    await expect(hr.page.getByTestId('tcal-note')).toContainText('moved');
    await hr.page.getByTestId('tcal-undo').click();
    await expect(hr.page.getByTestId('tcal-note')).toContainText('undone');
  }
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '07-calendar');
  // certificates: an expired operator licence shows in the register
  const bhanu = (await api(request, c, 'EMP', g.u('emp2'), 'get', '/hr/ess/home')).employee.id;
  await api(request, c, 'HRMGR', g.u('hr'), 'put', '/hr/training/cert-types', { code: 'OPLIC', name: 'Crane operator licence', validityMonths: 24, alertDays: 30, requiredFor: {} });
  await api(request, c, 'HRMGR', g.u('hr'), 'post', '/hr/training/certs', { personType: 'EMPLOYEE', personId: bhanu, certType: 'OPLIC', number: 'LIC-77', issuer: 'RTO', validFrom: '2020-01-01', validUntil: '2024-01-01' });
  await hr.page.goto('/training/certifications');
  await expect(hr.page.getByText('Bhanu Rao').first()).toBeVisible();
  await expect(hr.page.getByText('Expired').first()).toBeVisible();
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '08-certifications');
  // skill matrix: the manager assesses Asha
  const mgr = await open(browser, info, c, 'PM', g.u('mgr'), '/training/skills');
  const mErrors = watch(mgr.page);
  await expect(mgr.page.getByTestId('sk-table')).toBeVisible();
  await mgr.page.getByTestId('sk-row').filter({ hasText: 'Asha Kulkarni' }).getByTestId('sk-cell').selectOption('3');
  await expect(mgr.page.getByTestId('sk-note')).toContainText('saved');
  if (phone) await noOverflow(mgr.page);
  await shot(mgr.page, '09-skills');
  // Hindi
  const hi = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  const hp = await hi.newPage();
  const hiErrors = watch(hp);
  await hp.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'hi' })); }, { user: g.u('emp'), roles: 'EMP', company: String(c) });
  await hp.goto('/training/mine');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('मेरा प्रशिक्षण');
  if (phone) await noOverflow(hp);
  await shot(hp, '10-hindi');
  expect([...errors, ...eErrors, ...mErrors, ...hiErrors]).toEqual([]);
});
