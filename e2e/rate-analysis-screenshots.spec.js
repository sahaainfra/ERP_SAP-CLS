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

// Screenshots of the 06.06 pages for docs/erp/screenshots/rates. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/rates';
// (setup as in rate-analysis.spec.js) The estimator keeps the rate library and a schedule of rates, starts an M25 analysis from the template (priced from the library), links it to the SOR item and
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


test('screenshots of the rate analysis pages', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  void watch; void noOverflow;
  const g = await setup(request, phone ? 'RSM' : 'RSD');
  const b = await api(request, g.c, 'EST', g.u.est, 'post', '/mdm/sor-books', { code: 'DSR-DL', name: 'CPWD Delhi Schedule of Rates', authority: 'CPWD', year: 2025, region: 'DL' });
  await api(request, g.c, 'EST', g.u.est, 'put', `/mdm/sor-books/${b.id}/items`, { items: [{ itemCode: '5', description: 'Concrete work' }, { itemCode: '5.1.2', parentCode: '5', description: 'Providing and laying RCC M25 (1:1:2)', uom: 'CUM', rate: '8000' }, { itemCode: '6.1.1', description: 'Brickwork 1:6', uom: 'CUM', rate: '7100.50' }] });
  await api(request, g.c, 'EST', g.u.est, 'post', `/mdm/sor-books/${b.id}/activate`, { reason: 'DSR 2025 in use' });
  const sor = (await api(request, g.c, 'EST', g.u.est, 'get', '/mdm/sor-items?q=5.1.2')).rows[0];
  const lines = [[g.it.cement, 'MT', '0.4', '2'], [g.it.sand, 'CUM', '0.42', '5'], [g.it.agg, 'CUM', '0.84', '5'], [g.it.mason, 'DAY', '0.17', '0'], [g.it.beldar, 'DAY', '2.5', '0'], [g.it.mixer, 'DAY', '0.07', '0'], [g.it.vib, 'DAY', '0.07', '0']].map(([itemId, uom, qty, wastagePct]) => ({ itemId, uom, qty, wastagePct }));
  const a = await api(request, g.c, 'EST', g.u.est, 'post', '/mdm/analyses', { workItemId: g.it.m25, title: 'RCC M25 per cum', basisQty: '1', sorItemId: sor.id, addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines, submit: true });
  await act(request, g.c, 'DIR', g.u.dir, a.instanceId);
  await api(request, g.c, 'EST', g.u.est, 'post', '/mdm/analyses', { workItemId: g.it.m25, title: 'RCC M25 per 10 cum', basisQty: '10', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines });
  const shot = async (path, name, prep) => {
    const { page, context } = await open(browser, info, g.c, 'EST', g.u.est, path);
    await page.waitForLoadState('networkidle');
    if (prep) await prep(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: !phone });
    await context.close();
  };
  await shot('/admin/rate-library', 'rate-library', (p) => expect(p.getByTestId('rl-row').first()).toBeVisible());
  await shot('/admin/schedule-of-rates', 'schedule-of-rates', async (p) => { await p.getByTestId('sor-open').first().click(); await expect(p.getByTestId('sor-item').first()).toBeVisible(); });
  await shot('/admin/rate-analyses', 'rate-analyses', (p) => expect(p.getByTestId('ra-row').first()).toBeVisible());
  await shot(`/admin/rate-analyses/analysis?id=${a.id}`, 'rate-analysis', (p) => expect(p.getByTestId('ra-line').first()).toBeVisible());
  await shot(`/admin/rate-analyses/analysis?id=${a.id}`, 'rate-analysis-sor', async (p) => { await p.getByTestId('ra-tab-sor').click(); await expect(p.getByTestId('ra-sor-diff')).toBeVisible(); });
  await shot('/admin/rate-analyses/analysis?new=1&template=CONCRETE_M25', 'rate-analysis-new', (p) => expect(p.getByTestId('rad-line').first()).toBeVisible());
  await shot('/admin/rate-analyses/impact', 'rate-impact', async (p) => { await p.getByTestId('ri-pick').click(); await p.getByTestId('is-q').fill('cement'); await p.getByTestId('is-row').filter({ hasText: 'Cement OPC 53' }).getByTestId('is-pick').check(); await p.getByTestId('is-done').click(); await p.getByTestId('ri-rate').fill('8000'); await p.getByTestId('ri-run').click(); await expect(p.getByTestId('ri-row').first()).toBeVisible(); });
});
