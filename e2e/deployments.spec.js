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
  for (const [n, roles] of [['hr', ['HRMGR']], ['hr2', ['HRMGR']], ['pm', ['PM']], ['pm2', ['PM']], ['pd', ['PD']], ['se', ['SE']], ['ws', ['WSUP']]]) {
    users[n] = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`).lastInsertRowid);
  }
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  const des = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  const p1 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  const p2 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P2', 'River Bridge', 'BRIDGE', 'ACTIVE', 'e2e', 'e2e')", c);
  const site = (p, code, name) => one("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (?, ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')", c, p, code, name);
  const s1 = site(p1, 'N1', 'Ring Road North'); const s2 = site(p2, 'B1', 'Bridge Pier Yard');
  for (const [p, u] of [[p1, 'pm'], [p2, 'pm2']]) db.prepare("INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, applied, created_by, source_type) VALUES (?, 'PROJECT', ?, 'PROJECT_MANAGER', ?, '2026-01-01', 1, 'e2e', 'e2e')").run(c, p, users[u]);
  let n = 0;
  const emp = (name, userId = null) => { n += 1; return one("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, employment_type, doj, location_type, employment_status, record_status, user_id, created_by, source_type) VALUES (?, ?, 'Emp', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, 'e2e', 'e2e')", c, `${t.toUpperCase()}${100 + n}`, name, name.toLowerCase(), `97000000${String(n).padStart(2, '0')}`, dept, des, userId); };
  const ashaUser = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-asha`, 'Asha Kulkarni', '[]', `${t}-asha@example.com`).lastInsertRowid);
  const people = { asha: emp('Asha Kulkarni', ashaUser), bhanu: emp('Bhanu Rao'), chetan: emp('Chetan Iyer') };
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
const OUT = 'docs/erp/screenshots/deployments';

// Part 07.03: deployment. HR deploys an employee on the form (the plan check shown as it is typed) and sends it; the project manager approves; the board shows the person against the plan and a move to another crew waits for approval
// (Undo withdraws it); crews are made and filled; a transfer to another project goes through both project managers and HR, and the handover is ticked. On a computer and a phone; screenshots for the report.
test('AC-01 deployment, board with a move, crew, transfer with handover, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'DPM' : 'DPD');
  const g = seed(c, phone ? 'dpm' : 'dpd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const hrApi = (method, path, data) => api(request, c, 'HRMGR', g.u('hr'), method, path, data);
  await hrApi('put', '/hr/site-plans', { siteId: g.s1, designationId: g.des, planned: 3, validFrom: '2026-01-01' });
  await hrApi('put', '/hr/site-plans', { siteId: g.s2, designationId: g.des, planned: 2, validFrom: '2026-01-01' });
  // HR deploys Asha to the north site on the form; the plan check says it is within the plan
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), '/hr/deployments/new');
  const errors = watch(hr.page);
  await hr.page.locator('#nd-person').click(); await hr.page.getByRole('option', { name: /Asha Kulkarni/ }).click();
  await hr.page.locator('#nd-project').click(); await hr.page.getByRole('option', { name: /Ring Road/ }).click();
  await hr.page.locator('#nd-site').click(); await hr.page.getByRole('option', { name: /Ring Road North/ }).click();
  await hr.page.getByTestId('nd-role').fill('Quality engineer');
  await hr.page.getByTestId('nd-access').selectOption('WSUP');
  await hr.page.getByTestId('nd-from').fill(day(-3));
  await expect(hr.page.getByTestId('nd-plan')).toContainText('Within the plan');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '01-new-deployment');
  await hr.page.getByTestId('nd-send').click();
  await expect(hr.page.getByTestId('dp-sent')).toBeVisible();
  const depId = Number(new URL(hr.page.url()).searchParams.get('id'));
  const dep = await hrApi('get', `/hr/deployments/${depId}`);
  await act(request, c, 'PM', g.u('pm'), dep.workflowInstanceId);
  await hr.page.reload();
  await expect(hr.page.getByTestId('dp-when')).toContainText('In force today');
  await expect(hr.page.getByTestId('deployment-page')).toContainText('Approved');
  await shot(hr.page, '02-deployment');
  // a second primary posting for the same person is refused, with the deployment it clashes with
  const clash = await request.post('/api/v1/hr/deployments', { headers: H('HRMGR', c, g.u('hr')), data: { personId: g.people.asha, projectId: g.p2, siteId: g.s2, fromDate: day(0), isPrimary: true } });
  expect(clash.status()).toBe(400);
  expect(await clash.text()).toContain('already has the primary deployment');
  // two more people and two crews
  for (const p of [g.people.bhanu, g.people.chetan]) {
    const d = await hrApi('post', '/hr/deployments', { personId: p, projectId: g.p1, siteId: g.s1, siteRole: 'Foreman', fromDate: day(-2), isPrimary: true, submit: true });
    await act(request, c, 'PM', g.u('pm'), d.workflowInstanceId);
  }
  // crews: made on the page, then filled
  const crews = await open(browser, info, c, 'HRMGR', g.u('hr'), '/hr/crews');
  await expect(crews.page.getByTestId('crews')).toBeVisible();
  await crews.page.getByRole('button', { name: 'New crew' }).click();
  await crews.page.locator('#cw-project').click(); await crews.page.getByRole('option', { name: /Ring Road/ }).click();
  await crews.page.locator('#cw-site').click(); await crews.page.getByRole('option', { name: /Ring Road North/ }).click();
  await crews.page.getByTestId('cw-code').fill('FIT-1');
  await crews.page.getByTestId('cw-name').fill('Fitters A');
  await crews.page.getByTestId('cw-trade').fill('Fitter');
  await crews.page.locator('#cw-supervisor').click(); await crews.page.getByRole('option', { name: /Bhanu Rao/ }).click();
  if (phone) await noOverflow(crews.page);
  await shot(crews.page, '03-new-crew');
  await crews.page.getByTestId('cw-create').click();
  await expect(crews.page.getByTestId('crew-page')).toContainText('Fitters A');
  await expect(crews.page.getByTestId('cr-supervisor')).toContainText('Bhanu Rao');
  const crewId = Number(new URL(crews.page.url()).searchParams.get('id'));
  await crews.page.locator('#cr-person').click(); await crews.page.getByRole('option', { name: /Chetan Iyer/ }).click();
  await crews.page.getByTestId('cr-add').click();
  await expect(crews.page.getByTestId('cr-count')).toHaveText('1');
  if (phone) await noOverflow(crews.page);
  await shot(crews.page, '04-crew');
  await hrApi('post', '/hr/crews', { siteId: g.s1, code: 'FIT-2', name: 'Fitters B', trade: 'Fitter' });
  // the board: the people against the plan; moving Asha to the crew Fitters A is sent for approval, Undo withdraws it
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/hr/deployment-board?siteId=${g.s1}`);
  const pmErrors = watch(pm.page);
  await expect(pm.page.getByTestId('db-site-count')).toHaveText('3');
  await expect(pm.page.getByTestId('db-counts')).toContainText('Site Engineer');
  await expect(pm.page.locator('[data-testid="db-crew"][aria-label^="Fitters A,"]')).toContainText('Chetan Iyer');
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '05-deployment-board');
  await pm.page.getByTestId('db-person').filter({ hasText: 'Asha Kulkarni' }).getByTestId('db-move').selectOption({ label: 'Fitters B' });
  await expect(pm.page.getByTestId('db-undo')).toContainText('Asha Kulkarni sent to Fitters B for approval');
  await expect(pm.page.getByTestId('db-person').filter({ hasText: 'Asha Kulkarni' })).toContainText('Change waiting');
  await shot(pm.page, '06-board-move-waiting');
  await pm.page.getByTestId('db-undo-go').click();
  await expect(pm.page.getByTestId('db-person').filter({ hasText: 'Asha Kulkarni' })).not.toContainText('Change waiting');
  // a transfer of Asha to the bridge: current manager, receiving manager, HR manager
  const trf = await open(browser, info, c, 'HRMGR', g.u('hr'), '/hr/transfers/new');
  const trfErrors = watch(trf.page);
  await trf.page.locator('#nt-employee').click(); await trf.page.getByRole('option', { name: /Asha Kulkarni/ }).click();
  await trf.page.locator('#nt-project').click(); await trf.page.getByRole('option', { name: /River Bridge/ }).click();
  await trf.page.locator('#nt-site').click(); await trf.page.getByRole('option', { name: /Bridge Pier Yard/ }).click();
  await trf.page.getByTestId('nt-role').fill('Bridge quality engineer');
  await trf.page.getByTestId('nt-relieve').fill(day(5));
  await trf.page.getByTestId('nt-join').fill(day(7));
  await trf.page.getByTestId('nt-reason').fill('The bridge needs a quality engineer');
  await trf.page.getByTestId('nt-travel').check();
  if (phone) await noOverflow(trf.page);
  await shot(trf.page, '07-transfer-request');
  await trf.page.getByTestId('nt-send').click();
  await expect(trf.page.getByTestId('tp-sent')).toContainText('receiving project manager');
  const trfId = Number(new URL(trf.page.url()).searchParams.get('id'));
  const t = await hrApi('get', `/hr/transfers/${trfId}`);
  await act(request, c, 'PM', g.u('pm'), t.workflowInstanceId);
  await act(request, c, 'PM', g.u('pm2'), t.workflowInstanceId);
  await act(request, c, 'HRMGR', g.u('hr2'), t.workflowInstanceId);
  await trf.page.reload();
  await expect(trf.page.getByTestId('transfer-page')).toContainText('Approved');
  await trf.page.getByRole('tab', { name: 'Handover' }).click();
  await trf.page.getByTestId('tp-item-WORK').click();
  await expect(trf.page.getByTestId('tp-item-WORK')).toBeChecked();
  await expect(trf.page.getByTestId('tp-handover')).toContainText('-hr');
  await trf.page.getByRole('tab', { name: 'Details' }).click();
  await expect(trf.page.getByTestId('tp-details')).toContainText('Deployment given');
  if (phone) await noOverflow(trf.page);
  await shot(trf.page, '08-transfer');
  // the deployments register shows the old posting ending on the relieving date and the new one from the joining date
  const list = await open(browser, info, c, 'HRMGR', g.u('hr'), '/hr/deployments');
  await expect(list.page.getByTestId('deployments')).toContainText('Asha Kulkarni');
  await expect(list.page.getByTestId('deployments')).toContainText('Bridge Pier Yard');
  if (phone) await noOverflow(list.page);
  await shot(list.page, '09-deployments');
  // the history of the person on Employee 360
  const e360 = await open(browser, info, c, 'HRMGR', g.u('hr'), `/hr/employees/employee?id=${g.people.asha}`);
  await e360.page.getByRole('tab', { name: 'Deployments' }).click();
  await expect(e360.page.locator('#e3-panel-rel-deployments, [role="tabpanel"]').first()).toContainText('Ring Road North');
  expect(crewId).toBeGreaterThan(0);
  expect(errors, 'no console errors on the deployment form').toEqual([]);
  expect(pmErrors, 'no console errors on the board').toEqual([]);
  expect(trfErrors, 'no console errors on the transfer form').toEqual([]);
});

test('AC-03 a site engineer sees the board of nothing and cannot deploy; a pages sweep has no console errors', async ({ browser, request }, info) => {
  const phone = info.project.name === 'mobile';
  const c = await company(request, phone ? 'DSM' : 'DSD');
  const g = seed(c, phone ? 'dsm' : 'dsd');
  const se = await open(browser, info, c, 'SE', g.u('se'), '/hr/deployments/new');
  const errors = watch(se.page);
  await expect(se.page.locator('main, #root').first()).toBeVisible();
  const denied = await request.post('/api/v1/hr/deployments', { headers: H('SE', c, g.u('se')), data: { personId: g.people.asha, projectId: g.p1, siteId: g.s1, fromDate: day(0) } });
  expect(denied.status()).toBe(403);
  for (const path of ['/hr/deployment-board', '/hr/deployments', '/hr/crews', '/hr/transfers']) {
    await se.page.goto(path);
    await expect(se.page.locator('h1, [role="alert"]').first()).toBeVisible();
    if (phone) await noOverflow(se.page);
  }
  expect(errors).toEqual([]);
});
