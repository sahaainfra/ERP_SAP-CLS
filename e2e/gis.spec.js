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

const OUT = 'docs/erp/screenshots/gis';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pm', ['PM']], ['pm2', ['PM']], ['pd', ['PD']], ['se', ['SE']], ['plan', ['PLAN']], ['qs', ['QS']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Ring road package 2', 'ROAD')").run(c, `${t.toUpperCase()}-R`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (?, ?, 'e2e')").run(c, id);
  db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m) VALUES (?, ?, 'MAIN', 'Main camp', 'ACTIVE', 18.52, 73.85, 'CIRCLE', 300)").run(c, id);
  const loc = (code, from, to, lat, lng) => db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, chainage_from, chainage_to, lat, lng, created_by) VALUES (?, ?, 'CHAINAGE', ?, ?, ?, ?, ?, ?, 'e2e')").run(c, id, code, `Chainage ${code}`, from, to, lat, lng);
  loc('CH0', 0, 1000, 18.52, 73.85); loc('CH1', 1000, 2000, 18.525, 73.855); loc('CH2', 2000, 3000, 18.53, 73.86);
  db.close();
  return { u: (k) => `${t}-${k}`, id };
}
const GEO = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Site boundary' }, geometry: { type: 'Polygon', coordinates: [[[73.84, 18.51], [73.87, 18.51], [73.87, 18.54], [73.84, 18.54], [73.84, 18.51]]] } }, { type: 'Feature', properties: { name: 'Gate 1' }, geometry: { type: 'Point', coordinates: [73.85, 18.515] } }] });
const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Part 10.07: a site engineer proposes a boundary layer (GeoJSON pasted) and a plan overlay; the project manager approves; the map shows the sites with their geofence, the locations, the layer and the overlay with toggles and a legend; list mode shows the same data;
// the planner records progress by location and the strip chart and heatmap follow; the quantity surveyor can view but not change. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 project map with layers and overlays, list mode, progress and the chainage strip chart, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'GSM' : 'GSD');
  const t = phone ? 'gsm' : 'gsd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const se = await open(browser, info, c, 'SE', g.u('se'), `/proj/gis-config?projectId=${g.id}`);
  const errors = watch(se.page);
  await expect(se.page.getByTestId('gis-config')).toBeVisible(); await expect(se.page.getByTestId('gisc-layers-empty')).toBeVisible();
  // a layer is proposed, sent and approved by the project manager (not the maker)
  await se.page.getByTestId('gisc-f-name').fill('Site boundary and gates'); await se.page.getByTestId('gisc-f-type').selectOption('BOUNDARY'); await se.page.getByTestId('gisc-f-content').fill(GEO); await se.page.getByTestId('gisc-f-save').click();
  const row = se.page.getByTestId('gisc-layer-Site boundary and gates'); await expect(row).toHaveAttribute('data-status', 'DRAFT', { timeout: 15_000 }); await expect(row).toHaveAttribute('data-live', '0');
  await se.page.getByTestId(`gisc-layer-submit-${(await api(request, c, 'SE', g.u('se'), 'get', `/proj/gis/layers?projectId=${g.id}`))[0].id}`).click(); await expect(row).toHaveAttribute('data-status', 'SUBMITTED', { timeout: 15_000 });
  const layers = await api(request, c, 'SE', g.u('se'), 'get', `/proj/gis/layers?projectId=${g.id}`); await decide(request, c, 'PM', g.u('pm'), layers[0].workflowInstanceId);
  // an overlay
  await se.page.getByTestId('gisc-o-name').fill('Site plan rev A'); await se.page.getByTestId('gisc-o-url').fill(TINY); await se.page.getByTestId('gisc-o-s').fill('18.50'); await se.page.getByTestId('gisc-o-w').fill('73.83'); await se.page.getByTestId('gisc-o-n').fill('18.55'); await se.page.getByTestId('gisc-o-e').fill('73.88'); await se.page.getByTestId('gisc-o-save').click();
  const orow = se.page.getByTestId('gisc-overlay-Site plan rev A'); await expect(orow).toHaveAttribute('data-status', 'DRAFT', { timeout: 15_000 });
  const ovs = await api(request, c, 'SE', g.u('se'), 'get', `/proj/gis/overlays?projectId=${g.id}`); await api(request, c, 'SE', g.u('se'), 'post', `/proj/gis/overlays/${ovs[0].id}/submit`, {}); const ovs2 = await api(request, c, 'SE', g.u('se'), 'get', `/proj/gis/overlays?projectId=${g.id}`); await decide(request, c, 'PM', g.u('pm'), ovs2[0].workflowInstanceId);
  await se.page.reload(); await expect(se.page.getByTestId('gisc-layer-Site boundary and gates')).toHaveAttribute('data-status', 'APPROVED'); await expect(se.page.getByTestId('gisc-layer-Site boundary and gates')).toHaveAttribute('data-live', '1'); await expect(se.page.getByTestId('gisc-overlay-Site plan rev A')).toHaveAttribute('data-status', 'APPROVED');
  if (phone) await noOverflow(se.page);
  await shot(se.page, '01-layers-overlays');
  // the planner records progress; the map shows everything
  const plan = await open(browser, info, c, 'PLAN', g.u('plan'), `/proj/strip-chart?projectId=${g.id}`); const planErrors = watch(plan.page);
  await expect(plan.page.getByTestId('strip-empty')).toBeVisible();
  for (const [code, pct] of [['CH0', '100'], ['CH1', '50'], ['CH2', '0']]) {
    await plan.page.getByTestId('rec-location').selectOption({ label: `${code} · Chainage ${code}` }); await plan.page.getByTestId('rec-activity').fill('Earthwork'); await plan.page.getByTestId('rec-pct').fill(pct); await plan.page.getByTestId('rec-save').click(); await expect(plan.page.getByTestId('strip-note')).toBeVisible({ timeout: 15_000 });
  }
  await expect(plan.page.getByTestId('strip-svg')).toBeVisible(); await expect(plan.page.getByTestId('strip-total-Earthwork')).toContainText('50%'); await expect(plan.page.getByTestId('strip-seg-0-CH1')).toHaveAttribute('data-pct', '50');
  if (phone) await noOverflow(plan.page);
  await shot(plan.page, '02-strip-chart');
  await plan.page.goto(`/proj/map?projectId=${g.id}`);
  await expect(plan.page.getByTestId('project-map')).toBeVisible(); await expect(plan.page.locator('.leaflet-container')).toBeVisible({ timeout: 20_000 }); await expect(plan.page.getByTestId('gis-legend')).toBeVisible();
  await expect(plan.page.getByTestId('gis-loc-CH1')).toContainText('50%');
  if (phone) await noOverflow(plan.page);
  await shot(plan.page, '03-map');
  await plan.page.getByTestId('gis-toggle-sites').uncheck(); await plan.page.getByTestId('gis-heat').uncheck(); await expect(plan.page.locator('.leaflet-container')).toBeVisible();
  await plan.page.getByTestId('gis-list-mode').click(); await expect(plan.page.getByTestId('project-map')).toHaveAttribute('data-mode', 'list'); await expect(plan.page.locator('.leaflet-container')).toHaveCount(0); await expect(plan.page.getByTestId('gis-list')).toContainText('Chainage CH2');
  if (phone) await noOverflow(plan.page);
  await shot(plan.page, '04-list-mode');
  // the quantity surveyor views but cannot change
  const qs = await open(browser, info, c, 'QS', g.u('qs'), `/proj/gis-config?projectId=${g.id}`); const qsErrors = watch(qs.page);
  await expect(qs.page.getByTestId('gis-config')).toBeVisible(); await expect(qs.page.getByTestId('gisc-layer-form')).toHaveCount(0); await expect(qs.page.getByTestId('gisc-overlay-form')).toHaveCount(0);
  expect(errors, 'console errors (site engineer)').toEqual([]); expect(planErrors, 'console errors (planner)').toEqual([]); expect(qsErrors, 'console errors (quantity surveyor)').toEqual([]);
});
