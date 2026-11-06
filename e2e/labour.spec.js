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
  for (const [n, roles] of [['hr', ['HRMGR']], ['hr2', ['HRMGR']], ['sup', ['WSUP']], ['sub', ['SUBCO']], ['hse', ['HSEE']], ['com', ['COMMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const p1 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  one("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (?, ?, 'N1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 'e2e', 'e2e')", c, p1);
  const k = one("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, 'LC1', 'Shiv Labour Supply', 'shiv labour supply', 'PROPRIETORSHIP', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')", c);
  one("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, created_by, source_type) VALUES (?, ?, 'LABOUR_CONTRACTOR', 'e2e', 'e2e')", c, k);
  db.close();
  return { u: (x) => `${t}-${x}`, k };
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
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
const OUT = 'docs/erp/screenshots/labour';
const yearsAgo = (y) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };

// Part 07.08: contract labour. The coordinator registers a worker on the page (a date of birth under 18 is refused on the screen), the supervisor level and the HR manager approve, HR records the induction and medical clearance,
// sets the licence of the contractor, prints the labour card with its QR, and sets a minimum wage and sees a contract rate below it refused. On a computer and a phone; screenshots for the report.
test('AC-01 register a worker, approve, clear, deploy-ready, print the card, set the licence and the wage rates, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'LBM' : 'LBD');
  const g = seed(c, phone ? 'lbm' : 'lbd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const sub = await open(browser, info, c, 'SUBCO', g.u('sub'), '/labour/workers/new');
  const errors = watch(sub.page);
  await sub.page.getByTestId('rw-name').fill('Ramesh Yadav');
  await sub.page.getByTestId('rw-dob').fill(yearsAgo(16));
  await expect(sub.page.getByTestId('rw-age')).toContainText('nobody under 18');
  await expect(sub.page.getByTestId('rw-send')).toBeDisabled();
  await sub.page.getByTestId('rw-dob').fill(yearsAgo(27));
  await expect(sub.page.getByTestId('rw-age')).toContainText('27 years');
  await sub.page.getByTestId('rw-aadhaar').fill('234567890123');
  await sub.page.getByTestId('rw-mobile').fill('9800011122');
  await sub.page.locator('#rw-contractor').click(); await sub.page.getByRole('option', { name: /Shiv Labour Supply/ }).click();
  await sub.page.getByTestId('rw-trade').selectOption('MASON'); await sub.page.getByTestId('rw-skill').selectOption('SKILLED');
  await sub.page.getByTestId('rw-state').fill('Bihar');
  if (phone) await noOverflow(sub.page);
  await shot(sub.page, '01-register');
  await sub.page.getByTestId('rw-send').click();
  await expect(sub.page.getByTestId('wp-note-top')).toContainText('Sent for approval');
  await expect(sub.page.getByTestId('wp-details')).toContainText('XXXX-XXXX-0123');
  const id = Number(new URL(sub.page.url()).searchParams.get('id'));
  const w = await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/workers/${id}`);
  await act(request, c, 'SUBCO', g.u('sub'), w.workflowInstanceId).catch(async () => act(request, c, 'WSUP', g.u('sup'), w.workflowInstanceId));
  await act(request, c, 'HRMGR', g.u('hr'), w.workflowInstanceId);
  // HR records the clearance on the worker page
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), `/labour/workers/worker?id=${id}`);
  const hErrors = watch(hr.page);
  await expect(hr.page.getByTestId('worker')).toContainText('Not cleared');
  await hr.page.getByTestId('wp-tab-clearance').click();
  await hr.page.getByTestId('cl-induction').selectOption('CLEARED'); await hr.page.getByTestId('cl-induction-date').fill(new Date().toISOString().slice(0, 10));
  await hr.page.getByTestId('cl-medical').selectOption('FIT'); await hr.page.getByTestId('cl-medical-until').fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
  await hr.page.getByTestId('cl-save').click();
  await expect(hr.page.getByTestId('wp-note')).toContainText('Clearance recorded');
  await hr.page.getByTestId('ppe-item').fill('Safety helmet'); await hr.page.getByTestId('ppe-add').click();
  await expect(hr.page.getByTestId('wp-ppe')).toContainText('Safety helmet');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '02-worker-clearance');
  await expect(hr.page.getByTestId('worker')).toContainText('Cleared for work');
  // the licence of the contractor
  await hr.page.goto(`/labour/contractors/contractor?id=${g.k}`);
  await hr.page.getByTestId('cp-licence').fill('CLRA/2026/77');
  await hr.page.getByTestId('cp-valid').fill(new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10));
  await hr.page.getByTestId('cp-max').fill('25');
  await hr.page.getByTestId('cp-save').click();
  await expect(hr.page.getByTestId('cp-note')).toContainText('saved');
  await expect(hr.page.getByTestId('contractor')).toContainText('Licence ending soon');
  await shot(hr.page, '03-contractor');
  await hr.page.goto('/labour/contractors');
  await expect(hr.page.locator('[data-testid="lc-row"][data-state="EXPIRING"]')).toHaveCount(1);
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '04-contractors');
  // the labour card with its QR
  await hr.page.goto(`/labour/cards?ids=${id}`);
  await hr.page.getByTestId('pc-make').click();
  await expect(hr.page.getByTestId('pc-card')).toContainText('Ramesh Yadav');
  await expect(hr.page.getByTestId('pc-card').locator('svg')).toBeVisible();
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '05-card');
  // the wage rates: the minimum wage, then a contract rate below it is refused
  await hr.page.goto('/labour/wages');
  await hr.page.getByTestId('wr-new').click();
  await hr.page.getByTestId('wr-state').fill('Bihar'); await hr.page.getByTestId('wr-skill').selectOption('SKILLED'); await hr.page.getByTestId('wr-rate').fill('420');
  await hr.page.getByTestId('wr-ref').fill('Notification 12/2026'); await hr.page.getByTestId('wr-send').click();
  await expect(hr.page.getByTestId('wr-note')).toContainText('was sent for approval');
  const rates = await api(request, c, 'HRMGR', g.u('hr'), 'get', '/hr/labour/wage-rates');
  await act(request, c, 'HRMGR', g.u('hr2'), (await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/labour/wage-rates/${rates[0]?.id ?? rates.data?.[0]?.id}`)).workflowInstanceId);
  await hr.page.goto('/labour/wages');
  await hr.page.getByTestId('wr-new').click();
  await hr.page.getByTestId('wr-kind').selectOption('CONTRACT');
  await hr.page.locator('#wr-contractor').click(); await hr.page.getByRole('option', { name: /Shiv Labour Supply/ }).click();
  await hr.page.getByTestId('wr-state').fill('Bihar'); await hr.page.getByTestId('wr-skill').selectOption('SKILLED'); await hr.page.getByTestId('wr-rate').fill('300');
  await hr.page.getByTestId('wr-save').click();
  await expect(hr.page.getByTestId('wr-error')).toContainText('below the minimum wage of Bihar');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '06-wages');
  // the register and the blacklisting by the safety officer
  await hr.page.goto('/labour/workers');
  await expect(hr.page.getByText('Ramesh Yadav').first()).toBeVisible();
  await shot(hr.page, '07-workers');
  const hse = await open(browser, info, c, 'HSEE', g.u('hse'), `/labour/workers/worker?id=${id}`);
  const sErrors = watch(hse.page);
  await hse.page.getByTestId('wp-blacklist').click(); await hse.page.getByTestId('wp-reason').fill('Worked at height without a harness');
  await hse.page.getByTestId('wp-reason-go').click();
  await expect(hse.page.getByTestId('wp-blacklisted')).toContainText('harness');
  expect([...errors, ...hErrors, ...sErrors]).toEqual([]);
});
