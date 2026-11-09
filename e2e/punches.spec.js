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
const LAT = 18.5204; const LNG = 73.8567;
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const users = {};
  for (const [n, roles] of [['hr', ['HRMGR']], ['hr2', ['HRMGR']], ['ws', ['WSUP']], ['se', ['SE']], ['pm', ['PM']], ['emp', ['EMP']], ['emp2', ['EMP']]]) users[n] = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`).lastInsertRowid);
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  const des = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  const p1 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  const s1 = one("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (?, ?, 'N1', 'Ring Road North', 'ACTIVE', ?, ?, 'CIRCLE', 200, 'e2e', 'e2e')", c, p1, LAT, LNG);
  let n = 0;
  const emp = (name, code, userId = null) => { n += 1; return one("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, employment_type, doj, location_type, employment_status, record_status, user_id, created_by, source_type) VALUES (?, ?, 'Emp', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, 'e2e', 'e2e')", c, code, name, name.toLowerCase(), `96000000${String(n).padStart(2, '0')}`, dept, des, userId); };
  const dep = (e) => one("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (?, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 'e2e', 'e2e')", c, `${t}-D${e}`, e, p1, s1, p1, s1);
  const people = { asha: emp('Asha Kulkarni', `${t.toUpperCase()}A`, users.emp), bhanu: emp('Bhanu Rao', `${t.toUpperCase()}B`, users.emp2), sup: emp('Sunil Supervisor', `${t.toUpperCase()}S`, users.ws) };
  for (const e of Object.values(people)) dep(e);
  const crew = one("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade, supervisor_id, project_id, site_id, created_by, source_type) VALUES (?, ?, 'C1', 'Crew One', 'Fitter', ?, ?, ?, 'e2e', 'e2e')", c, s1, people.sup, p1, s1);
  const workers = ['Chetan Iyer', 'Deepa Nair', 'Esha Rao'].map((nm, i) => { const w = emp(nm, `${t.toUpperCase()}K${i}`); dep(w); one("INSERT INTO hr_crew_members (company_id, crew_id, person_type, person_id, from_date, project_id, site_id, created_by, source_type) VALUES (?, ?, 'EMPLOYEE', ?, '2026-01-01', ?, ?, 'e2e', 'e2e')", c, crew, w, p1, s1); return w; });
  db.close();
  return { dept, des, p1, s1, crew, people, workers, u: (k) => `${t}-${k}`, code: (k) => `${t.toUpperCase()}${k}` };
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




const OUT = 'docs/erp/screenshots/punches';
const north = (m) => LAT + m / 111_000;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const geo = (m, accuracy = 10) => ({ geolocation: { latitude: north(m), longitude: LNG, accuracy }, permissions: ['geolocation'] });

// Part 07.05: geo-fenced attendance. An employee punches in from inside the fence (the screen says inside, a punch is recorded), then tries from 700 m away and is refused with the reason; the supervisor punches the crew with a group photo;
// the site engineer runs the kiosk with a badge code; HR reviews the outside-fence anomaly, and the report of the day counts only what was accepted. On a computer and a phone; screenshots for the report.
test('AC-01 punch in and out, the fence decides, crew punch, kiosk, anomalies and the report, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'GPM' : 'GPD');
  const g = seed(c, phone ? 'gpm' : 'gpd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), '/att/punch', geo(0));
  const errors = watch(emp.page);
  await expect(emp.page.getByTestId('pu-notice')).toContainText('not tracked in the background');
  await expect(emp.page.getByTestId('pu-site')).toContainText('Ring Road North');
  await emp.page.getByTestId('pu-locate').click();
  await expect(emp.page.getByTestId('pu-fence')).toContainText('Inside the fence');
  await expect(emp.page.getByTestId('pu-map')).toBeVisible();
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '01-punch-inside');
  await emp.page.getByTestId('pu-punch').click();
  await expect(emp.page.getByTestId('pu-note')).toContainText('In punch recorded');
  await expect(emp.page.getByTestId('pu-last')).toContainText('Accepted');
  // 700 m away: the phone says outside, and the server refuses with the reason
  await emp.context.setGeolocation({ latitude: north(700), longitude: LNG, accuracy: 15 });
  await emp.page.getByTestId('pu-locate').click();
  await expect(emp.page.getByTestId('pu-fence')).toContainText('Outside the fence');
  await emp.page.getByTestId('pu-punch').click();
  await expect(emp.page.getByTestId('pu-note')).toContainText('outside the site fence');
  await shot(emp.page, '02-punch-outside');
  // the supervisor punches the crew
  const ws = await open(browser, info, c, 'WSUP', g.u('ws'), '/att/crew-punch', geo(0));
  const wsErrors = watch(ws.page);
  await ws.page.locator('#cp-crew').click(); await ws.page.getByRole('option', { name: /Crew One/ }).click();
  await expect(ws.page.getByTestId('cp-member')).toHaveCount(3);
  await ws.page.getByTestId('cp-all').check();
  await ws.page.getByTestId('cp-photo').setInputFiles({ name: 'crew.png', mimeType: 'image/png', buffer: PNG });
  await expect(ws.page.getByTestId('cp-thumb')).toBeVisible();
  if (phone) await noOverflow(ws.page);
  await shot(ws.page, '03-crew-punch');
  await ws.page.getByTestId('cp-send').click();
  await expect(ws.page.getByTestId('cp-result')).toContainText('3 of 3 recorded');
  // the kiosk, run by the site engineer
  const se = await open(browser, info, c, 'SE', g.u('se'), '/att/kiosk');
  const seErrors = watch(se.page);
  await se.page.locator('#ki-site').click(); await se.page.getByRole('option', { name: /Ring Road North/ }).click();
  await se.page.getByTestId('ki-badge').fill(g.code('B'));
  await se.page.getByTestId('ki-photo').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: PNG });
  if (phone) await noOverflow(se.page);
  await shot(se.page, '04-kiosk');
  await se.page.getByTestId('ki-go').click();
  await expect(se.page.getByTestId('ki-answer')).toContainText('Welcome');
  await shot(se.page, '05-kiosk-answer');
  await expect(se.page.getByTestId('ki-badge')).toBeVisible({ timeout: 9000 });
  await se.page.getByTestId('ki-badge').fill('NOBODY');
  await se.page.getByTestId('ki-go').click();
  await expect(se.page.getByTestId('ki-error')).toContainText('not known');
  // HR reviews the anomaly
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/att/anomalies');
  const hrErrors = watch(hr.page);
  await expect(hr.page.locator('[data-testid="an-row"][data-type="OUTSIDE_FENCE"]')).toHaveCount(1);
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '06-anomalies');
  await hr.page.getByTestId('an-accept').first().click();
  await expect(hr.page.getByTestId('an-error')).toContainText('note first');
  await hr.page.getByTestId('an-note').fill('The fence is drawn too tight at the gate');
  await hr.page.getByTestId('an-accept').first().click();
  await expect(hr.page.getByTestId('an-done')).toContainText('Accepted');
  // the report of the day
  await hr.page.goto('/att/today');
  await expect(hr.page.getByTestId('td-row')).toHaveCount(1);
  await expect(hr.page.getByTestId('td-present')).toHaveText('5');
  await hr.page.getByTestId('td-open-present').click();
  await expect(hr.page.getByTestId('td-drill-row').first()).toBeVisible();
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '07-today');
  await hr.page.getByTestId('st-site').selectOption({ index: 1 });
  await hr.page.getByTestId('st-selfie').selectOption('REQUIRED');
  await hr.page.getByTestId('st-save').click();
  await expect(hr.page.getByTestId('st-note')).toContainText('Saved');
  expect(errors, 'no console errors on the punch screen').toEqual([]);
  expect(wsErrors).toEqual([]); expect(seErrors).toEqual([]); expect(hrErrors).toEqual([]);
});

test('AC-03 a worker has no report, no anomalies and no kiosk; the pages show no console errors', async ({ browser, request }, info) => {
  const phone = info.project.name === 'mobile';
  const c = await company(request, phone ? 'GQM' : 'GQD');
  const g = seed(c, phone ? 'gqm' : 'gqd');
  const emp = await open(browser, info, c, 'EMP', g.u('emp2'), '/att/punch', geo(0));
  const errors = watch(emp.page);
  await expect(emp.page.getByTestId('punch-page')).toBeVisible();
  const denied = await request.get('/api/v1/att/anomalies', { headers: H('EMP', c, g.u('emp2')) });
  expect(denied.status()).toBe(403);
  for (const path of ['/att/anomalies', '/att/today', '/att/kiosk', '/att/crew-punch']) {
    await emp.page.goto(path);
    await expect(emp.page.locator('h1, [role="alert"]').first()).toBeVisible();
    if (phone) await noOverflow(emp.page);
  }
  expect(errors).toEqual([]);
});
