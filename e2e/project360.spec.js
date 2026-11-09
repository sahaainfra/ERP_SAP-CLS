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
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

const OUT = 'docs/erp/screenshots/project360';
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pm', ['PM']], ['se', ['SE']], ['qs', ['QS']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const mk = (code, name, state) => {
    const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, ?, 'ROAD')").run(c, code, name).lastInsertRowid);
    db.prepare("INSERT INTO proj_projects (company_id, project_id, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, ?, ?, 2500000000, '2026-01-10', '2027-09-30', 'e2e')").run(c, id, state, `${t}-pm`);
    return id;
  };
  const a = mk(`${t.toUpperCase()}-A`, 'Ring road package 2', 'EXECUTION'); const b = mk(`${t.toUpperCase()}-B`, 'Flyover at the junction', 'MOBILISATION');
  const ms = db.prepare("INSERT INTO proj_milestones (company_id, project_id, code, name, planned_date, milestone_status, created_by) VALUES (?, ?, ?, ?, ?, 'PLANNED', 'e2e')");
  ms.run(c, a, 'M1', 'Mobilisation complete', day(-20)); ms.run(c, a, 'M2', 'Earthwork complete', day(60)); ms.run(c, b, 'M1', 'Site handed over', day(40));
  db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, chainage_from, chainage_to, lat, lng, created_by) VALUES (?, ?, 'CHAINAGE', 'CH0', 'Chainage 0', 0, 1000, 18.52, 73.85, 'e2e')").run(c, a);
  db.close();
  return { u: (k) => `${t}-${k}`, a, b };
}
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

// Part 10.08: the project manager opens Project 360 of a project with an overdue milestone, a critical risk and an issue: the header, the health tiles (time red, risk red, the modules that are not live say "no data"), the widgets with their figures and links,
// the tabs, and an empty slot that names the part that will supply it; a quantity surveyor sees the same page without the risk and issue widgets; the portfolio shows both projects with their health and filters by it. On a computer and a phone, no
// console errors, no horizontal scroll.
test('AC-01 Project 360 with live widgets and empty slots, tabs, period, and the portfolio overview, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'P3M' : 'P3D');
  const t = phone ? 'p3m' : 'p3d';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  await api(request, c, 'PM', g.u('pm'), 'post', '/proj/risks', { projectId: g.a, rtype: 'RISK', title: 'Monsoon delays concreting', category: 'TECHNICAL', ownerUser: g.u('se'), probability: 4, impactCost: 5, impactTime: 3, strategy: 'MITIGATE', exposureCost: { min: '2000000', mostLikely: '5000000', max: '9000000' }, actions: [{ description: 'Order rain covers', ownerUser: g.u('se'), dueDate: day(10) }] });
  await api(request, c, 'PM', g.u('pm'), 'post', '/proj/issues', { projectId: g.a, title: 'Tower crane breakdown', priority: 'HIGH', ownerUser: g.u('se'), dueDate: day(-2) });
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/proj/project-360?projectId=${g.a}`);
  const errors = watch(pm.page);
  await expect(pm.page.getByTestId('project-360')).toBeVisible(); await expect(pm.page.getByTestId('project-360')).toHaveAttribute('data-health', 'RED');
  await expect(pm.page.getByTestId('p3-header')).toContainText('Execution'); await expect(pm.page.getByTestId('p3-value')).toContainText('2,50,00,000.00');
  await expect(pm.page.getByTestId('p3-health-TIME')).toHaveAttribute('data-level', 'RED'); await expect(pm.page.getByTestId('p3-health-RISK')).toHaveAttribute('data-level', 'RED'); await expect(pm.page.getByTestId('p3-health-COST')).toContainText('No data');
  await expect(pm.page.getByTestId('p3-fig-risks-critical')).toContainText('1'); await expect(pm.page.getByTestId('p3-fig-issues-overdue')).toContainText('1'); await expect(pm.page.getByTestId('p3-fig-milestones-overdue')).toContainText('1');
  await expect(pm.page.getByTestId('p3-empty-progress')).toContainText('14.05'); await expect(pm.page.getByTestId('p3-widget-progress')).toHaveAttribute('data-status', 'NOT_LIVE');
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '01-project-360');
  // a figure opens the records behind it
  await pm.page.getByTestId('p3-fig-risks-critical').getByRole('link').click(); await expect(pm.page).toHaveURL(/\/proj\/risks/); await expect(pm.page.getByTestId('risks')).toBeVisible();
  // tabs and the period
  await pm.page.goto(`/proj/project-360?projectId=${g.a}`); await pm.page.getByTestId('tab-time').click(); await expect(pm.page.getByTestId('p3-tab-time')).toBeVisible(); await expect(pm.page.getByTestId('p3-empty-schedule')).toContainText('13.x');
  await pm.page.getByTestId('tab-resources').click(); await expect(pm.page.getByTestId('p3-widget-team')).toBeVisible(); await expect(pm.page.getByTestId('p3-empty-procurement')).toContainText('15.x');
  await shot(pm.page, '02-resources-tab');
  await pm.page.getByTestId('tab-overview').click(); await pm.page.getByTestId('p3-period').fill(day(60).slice(0, 7)); await expect(pm.page.getByTestId('p3-fig-milestones-due')).toContainText('1', { timeout: 15_000 });
  // the quantity surveyor: no risk and issue widgets, the page still draws
  const qs = await open(browser, info, c, 'QS', g.u('qs'), `/proj/project-360?projectId=${g.a}`); const qsErrors = watch(qs.page);
  await expect(qs.page.getByTestId('project-360')).toBeVisible(); await expect(qs.page.getByTestId('p3-widget-milestones')).toHaveCount(0); await qs.page.getByTestId('tab-cost').click(); await expect(qs.page.getByTestId('p3-widget-boq')).toBeVisible(); await expect(qs.page.getByTestId('p3-empty-budget')).toContainText('12.x'); await qs.page.getByTestId('tab-overview').click(); await expect(qs.page.getByTestId('p3-widget-risks')).toHaveCount(0); await expect(qs.page.getByTestId('p3-widget-issues')).toHaveCount(0); await expect(qs.page.getByTestId('p3-export-pdf')).toHaveCount(0);
  if (phone) await noOverflow(qs.page);
  // the portfolio
  await pm.page.goto('/proj/portfolio'); await expect(pm.page.getByTestId('portfolio')).toBeVisible(); await expect(pm.page.getByTestId(`pf-card-${t.toUpperCase()}-A`)).toHaveAttribute('data-health', 'RED'); await expect(pm.page.getByTestId(`pf-card-${t.toUpperCase()}-B`)).toBeVisible();
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '03-portfolio');
  await pm.page.getByTestId('pf-tile-RED').click(); await expect(pm.page.getByTestId(`pf-card-${t.toUpperCase()}-B`)).toHaveCount(0); await expect(pm.page.getByTestId(`pf-card-${t.toUpperCase()}-A`)).toBeVisible();
  await pm.page.getByTestId(`pf-card-${t.toUpperCase()}-A`).getByRole('link').first().click(); await expect(pm.page.getByTestId('project-360')).toBeVisible();
  expect(errors, 'console errors (project manager)').toEqual([]); expect(qsErrors, 'console errors (quantity surveyor)').toEqual([]);
});
