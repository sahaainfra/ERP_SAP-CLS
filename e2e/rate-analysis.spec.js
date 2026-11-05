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
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/number-series', { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix: 'SMP', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  return id;
}
// the people of the company: written straight into the throw-away database of the run (the dev-header mode has no sign-in to make them)
function people(c, list) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [name, roles, display] of list) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, name, display, JSON.stringify(roles), `${name}@example.com`);
  db.close();
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

// Part 06.06: the rate analysis engine. The estimator keeps the rate library and a schedule of rates, starts an M25 analysis from the template (priced from the library), links it to the SOR item and
// submits it; the director releases it; the released version is locked and amended; the impact report shows the effect of a cement price rise; on a computer and a phone, with no console error and no
// sideways scroll.
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked the components' });
};
/** The items, the library and a schedule of the company (straight into the throw-away database for the items; the rates through the API). */
async function setup(request, code) {
  const c = await company(request, code);
  const t = code.toLowerCase();
  const u = { est: `${t}-est`, dir: `${t}-dir`, qs: `${t}-qs` };
  people(c, [[u.est, ['EST'], 'Esha Estimator'], [u.dir, ['DIR'], 'Dev Director'], [u.qs, ['QS'], 'Quentin Surveyor']]);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'RAE', 'Rate test', 'RAE', '[]', '[]', 'EST', 'ACTIVE')").run(c).lastInsertRowid);
  const item = (ic, name, type, uom) => Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, search_text) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE', ?)").run(c, `${code}-${ic}`, name, type, cat, uom, name.toLowerCase()).lastInsertRowid);
  const it = { cement: item('CEM', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('SND', 'Coarse sand', 'MATERIAL', 'CUM'), agg: item('AGG', 'Coarse aggregate 20 mm', 'MATERIAL', 'CUM'), mason: item('MSN', 'Mason', 'LABOUR', 'DAY'), beldar: item('BLD', 'Beldar', 'LABOUR', 'DAY'), mixer: item('MIX', 'Concrete mixer with operator', 'EQUIPMENT', 'DAY'), vib: item('VIB', 'Needle vibrator', 'EQUIPMENT', 'DAY'), m25: item('M25', 'RCC M25 in superstructure', 'WORK_ITEM', 'CUM') };
  db.close();
  for (const [i, v, uom] of [[it.cement, '7200', 'MT'], [it.sand, '1850', 'CUM'], [it.agg, '1650', 'CUM'], [it.mason, '950', 'DAY'], [it.beldar, '650', 'DAY'], [it.mixer, '2400', 'DAY'], [it.vib, '600', 'DAY']]) await api(request, c, 'EST', u.est, 'post', '/mdm/resource-rates', { itemId: i, rate: v, uom, basis: 'MARKET_SURVEY', effectiveFrom: '2026-01-01' });
  return { c, u, it };
}

test('FR-01 FR-02 the rate library and a schedule of rates: filters, a new rate, items pasted and the edition put in use', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'RLM' : 'RLD');
  const { page } = await open(browser, info, g.c, 'EST', g.u.est, '/admin/rate-library');
  const errors = watch(page);
  await expect(page.getByTestId('rl-row').first()).toBeVisible();
  await expect(page.getByTestId('rl-row')).toHaveCount(7);
  await page.getByTestId('rl-q').fill('Cement');
  await expect(page.getByTestId('rl-row')).toHaveCount(1);
  await expect(page.getByTestId('rl-row').first()).toContainText('7,200.00');
  await noOverflow(page);
  await page.goto('/admin/schedule-of-rates');
  await page.getByTestId('sor-new').click();
  await page.getByTestId('sor-f-code').fill('DSR-DL');
  await page.getByTestId('sor-f-name').fill('CPWD Delhi Schedule of Rates');
  await page.getByTestId('sor-f-year').fill('2025');
  await page.getByTestId('sor-f-save').click();
  await expect(page.getByTestId('sor-note')).toContainText('Created DSR-DL');
  await page.getByTestId('sor-text').fill('Item code,Description,Unit,Rate\n5.1.2,Providing and laying RCC M25 (1:1:2),CUM,8000\n6.1.1,Brickwork 1:6,CUM,7100.50');
  await page.getByTestId('sor-add').click();
  await expect(page.getByTestId('sor-item')).toHaveCount(2);
  await page.getByTestId('sor-activate').click();
  await expect(page.getByTestId('sor-note')).toContainText('is in use');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-03 FR-04 BR-01 T-03 an M25 analysis from the template, priced from the library, released by the director, locked and amended', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'RAM' : 'RAD');
  const { page } = await open(browser, info, g.c, 'EST', g.u.est, '/admin/rate-analyses');
  const errors = watch(page);
  await expect(page.getByTestId('rate-analyses')).toContainText('No rate analysis yet');
  await page.getByTestId('ra-template').selectOption('CONCRETE_M25');
  await page.getByTestId('ra-new').click();
  await expect(page.getByTestId('rad-line')).toHaveCount(7);
  await page.getByTestId('rad-work').click();
  await page.getByTestId('is-q').fill('rcc m25');
  await expect(page.getByTestId('is-row').filter({ hasText: 'RCC M25 in superstructure' })).toBeVisible();
  await page.getByTestId('is-row').filter({ hasText: 'RCC M25 in superstructure' }).getByTestId('is-pick').check();
  await page.getByTestId('is-done').click();
  await expect(page.getByTestId('rad-work')).toContainText('RCC M25');
  await noOverflow(page);
  await page.getByTestId('rad-save').click();
  await expect(page.getByTestId('ra-unit-rate')).toContainText('8,409.83');
  await expect(page.getByTestId('ra-direct')).toContainText('7,205.25');
  await expect(page.getByTestId('ra-line')).toHaveCount(7);
  await noOverflow(page);
  await page.getByTestId('ra-submit').click();
  await expect(page.getByTestId('ra-note')).toContainText('sent for release (the director)');
  const id = Number(new URL(page.url()).searchParams.get('id'));
  const a = await api(request, g.c, 'EST', g.u.est, 'get', `/mdm/analyses/${id}`);
  await act(request, g.c, 'DIR', g.u.dir, a.instanceId);
  await page.reload();
  await expect(page.getByTestId('ra-locked')).toBeVisible();
  await expect(page.getByTestId('ra-edit')).toHaveCount(0);
  await page.getByTestId('ra-reason').fill('cement price revision');
  await page.getByTestId('ra-amend').click();
  await expect(page.getByTestId('ra-note')).toContainText('Version 2 is a draft');
  await page.getByTestId('ra-tab-versions').click();
  await expect(page.getByTestId('ra-version')).toHaveCount(2);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-05 T-02 the impact of a cement price rise on the analyses, read by the quantity surveyor', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'RIM' : 'RID');
  const lines = [[g.it.cement, 'MT', '0.4', '2'], [g.it.sand, 'CUM', '0.42', '5'], [g.it.agg, 'CUM', '0.84', '5'], [g.it.mason, 'DAY', '0.17', '0'], [g.it.beldar, 'DAY', '2.5', '0'], [g.it.mixer, 'DAY', '0.07', '0'], [g.it.vib, 'DAY', '0.07', '0']].map(([itemId, uom, qty, wastagePct]) => ({ itemId, uom, qty, wastagePct }));
  await api(request, g.c, 'EST', g.u.est, 'post', '/mdm/analyses', { workItemId: g.it.m25, basisQty: '1', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines });
  const { page } = await open(browser, info, g.c, 'QS', g.u.qs, '/admin/rate-analyses/impact');
  const errors = watch(page);
  await page.getByTestId('ri-pick').click();
  await page.getByTestId('is-q').fill('cement');
  await expect(page.getByTestId('is-row').filter({ hasText: 'Cement OPC 53' })).toBeVisible();
  await page.getByTestId('is-row').filter({ hasText: 'Cement OPC 53' }).getByTestId('is-pick').check();
  await page.getByTestId('is-done').click();
  await page.getByTestId('ri-rate').fill('8000');
  await page.getByTestId('ri-run').click();
  await expect(page.getByTestId('ri-count')).toHaveText('1');
  await expect(page.getByTestId('ri-row').first()).toContainText('8,790.80');
  await expect(page.getByTestId('ri-row').first()).toContainText('4.53%');
  await noOverflow(page);
  expect(errors).toEqual([]);
});
