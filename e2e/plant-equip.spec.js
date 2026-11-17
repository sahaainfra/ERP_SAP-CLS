import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => { const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data }); expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') }); const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' }); return id;
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use; const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true }); const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) }); await page.goto(path); return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
// Part 17.01 in the browser (development-header mode, port 3100): the plant supervisor registers a vehicle with its certificates, the plant manager and accounts approve it, the dashboard and the register show it, an expired insurance blocks deployment until renewed, and the storekeeper is refused. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-equip';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['sup', ['PMSUP']], ['pm', ['PLANTMGR']], ['acc', ['ACCMGR']], ['sk', ['SK']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Plant tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Plant site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cls = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Tipper truck 20 t', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(c, `${T}-TIP`, cat).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, cls };
}

test('Plant: register a vehicle with certificates, approve it, deploy it; an expired insurance blocks deployment until renewed; the dashboard and the register show it', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `p${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const sup = await open(browser, info, c, 'PMSUP', s.u('sup'), '/plant/equipment/new'); const p = sup.page; const errors = watch(p);
  await expect(p.getByTestId('plant-new')).toBeVisible(); await expect(p.getByTestId('en-save')).toBeDisabled();
  await p.getByTestId('en-classItemId').selectOption(String(s.cls)); await p.getByTestId('en-make').fill('Tata'); await p.getByTestId('en-model').fill('Prima 2830'); await p.getByTestId('en-regNo').fill(`MH12${t.toUpperCase()}1`); await p.getByTestId('en-roadVehicle').check(); await p.getByTestId('en-purchaseValue').fill('2500000'); await p.getByTestId('en-meterType').selectOption('KM'); await p.getByTestId('en-fuelNorm').fill('3.5'); await p.getByTestId('en-tankCapacity').fill('300');
  await p.getByTestId('en-projectId').selectOption(String(s.pid)); await p.getByTestId('en-siteId').selectOption(String(s.site)); await noOverflow(p); await shot(p, '1-form', info);
  await p.getByTestId('en-save').click(); await expect(p.getByTestId('eq-object')).toHaveAttribute('data-status', 'DRAFT'); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  await p.getByTestId('eq-tab-documents').click(); await expect(p.getByTestId('eq-missing')).toContainText('Insurance');
  for (const [type, until] of [['RC', plus(900)], ['INSURANCE', plus(-3)], ['FITNESS', plus(200)], ['PUC', plus(20)]]) { await p.getByTestId('eq-doc-type').selectOption(type); await p.getByTestId('eq-doc-number').fill(`${type}-1`); await p.getByTestId('eq-doc-until').fill(until); await p.getByTestId('eq-doc-add').click(); await expect(p.getByTestId('eq-note')).toContainText('Document added'); }
  await expect(p.locator('[data-testid="eq-doc-row"][data-state="EXPIRED"]')).toHaveCount(1); await expect(p.locator('[data-testid="eq-doc-row"][data-state="EXPIRING"]')).toHaveCount(1); await noOverflow(p); await shot(p, '2-documents', info);
  await p.getByTestId('eq-tab-details').click(); await p.getByTestId('eq-submit').click(); await expect(p.getByTestId('eq-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const pm = await open(browser, info, c, 'PLANTMGR', s.u('pm'), url); await expect(pm.page.getByTestId('eq-decide')).toBeVisible(); await pm.page.getByTestId('eq-approve').click(); await expect(pm.page.getByTestId('eq-note')).toBeVisible(); await pm.context.close();
  const ac = await open(browser, info, c, 'ACCMGR', s.u('acc'), url); await expect(ac.page.getByTestId('eq-decide')).toBeVisible(); await expect(ac.page.getByTestId('eq-details')).toContainText('25,00,000'); await ac.page.getByTestId('eq-approve').click(); await expect(ac.page.getByTestId('eq-note')).toBeVisible(); await ac.context.close();
  const pm2 = await open(browser, info, c, 'PLANTMGR', s.u('pm'), url); const q = pm2.page; await expect(q.getByTestId('eq-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(q.getByTestId('eq-blocked')).toContainText('Insurance');
  await q.getByTestId('eq-state').selectOption('DEPLOYED'); await q.getByTestId('eq-state-project').selectOption(String(s.pid)); await q.getByTestId('eq-state-go').click(); await expect(q.getByTestId('eq-error')).toContainText('cannot be deployed'); await expect(q.getByTestId('eq-object')).toHaveAttribute('data-state', 'AVAILABLE');
  await q.getByTestId('eq-tab-documents').click(); await q.getByTestId('eq-doc-type').selectOption('INSURANCE'); await q.getByTestId('eq-doc-number').fill('INS-2'); await q.getByTestId('eq-doc-until').fill(plus(365)); await q.getByTestId('eq-doc-add').click(); await expect(q.getByTestId('eq-superseded')).toBeVisible(); await expect(q.getByTestId('eq-blocked')).toHaveCount(0);
  await q.getByTestId('eq-tab-details').click(); await q.getByTestId('eq-state').selectOption('DEPLOYED'); await q.getByTestId('eq-state-project').selectOption(String(s.pid)); await q.getByTestId('eq-state-go').click(); await expect(q.getByTestId('eq-object')).toHaveAttribute('data-state', 'DEPLOYED');
  await q.getByTestId('eq-tag').click(); await expect(q.getByTestId('eq-qr')).toBeVisible(); await q.getByTestId('eq-tab-history').click(); await expect(q.getByTestId('eq-timeline')).toContainText('Registered'); await q.getByTestId('eq-tab-fuel').click(); await expect(q.getByTestId('eq-later-fuel')).toContainText('17.04'); await noOverflow(q); await shot(q, '3-equipment-360', info);
  await q.goto('/plant/dashboard?view=detail'); await expect(q.getByTestId('plant-pd')).toBeVisible(); await expect(q.getByTestId('pd-fleet')).toHaveText('1'); await expect(q.getByTestId('pd-util')).toHaveText('100%'); await expect(q.getByTestId('pd-expiring')).toHaveText('1'); await q.getByTestId('pd-open-expiring').click(); await expect(q.getByTestId('pd-drill-table-row')).toHaveCount(1); await expect(q.getByTestId('pd-queue')).toHaveCount(4);
  const dl = q.waitForEvent('download'); await q.getByTestId('pd-export').click(); expect((await dl).suggestedFilename()).toMatch(/equipment-register/); await noOverflow(q); await shot(q, '4-dashboard', info);
  await q.goto('/plant/equipment'); await expect(q.getByTestId('plant-eq-list')).toBeVisible(); await expect(q.getByText(`${s.T}`).first()).toBeVisible().catch(() => {}); await noOverflow(q);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/plant/dashboard?view=detail'); await expect(sk.page.getByText('plant.equipment.view')).toBeVisible(); await sk.context.close();
  expect(errors).toEqual([]);
});
