import { test, expect } from '@playwright/test';
import { H, api, company, db, noOverflow, open, watch } from './hse-helpers.js';

// PACK-19 in the browser (flag ff.est.pack19): an M25 analysis priced from the rate library shows "Show calculation": the unit rate trace
// (inputs, every step with its formula, the rounding, the result and the formula version) ending in the rate on the Components tab.
// Screenshots go to pack-reports/ (git-ignored).
const OUT = 'pack-reports/screens/pack19';
test('PACK-19 the calculation trace of a rate analysis is on the screen', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const code = `R19${info.project.name === 'mobile' ? 'M' : 'D'}${Date.now().toString(36).slice(-3).toUpperCase()}`; const c = await company(request, code); const t = code.toLowerCase(); const est = `${t}-est`; const qs = `${t}-qs`;
  const f = await request.patch('/api/v1/core/feature-flags/ff.est.pack19', { headers: H('SYSADM', c, 'e2e-setup'), data: { scope: { level: 'company', companyId: c }, enabled: true, reason: 'e2e: PACK-19' } }); expect(f.status(), await f.text()).toBeLessThan(300);
  const d = db(); for (const [u, r] of [[est, 'EST'], [qs, 'QS']]) d.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, u, u, JSON.stringify([r]), `${u}@example.com`);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'R19', 'Rate test', 'R19', '[]', '[]', 'EST', 'ACTIVE')").run(c).lastInsertRowid);
  const item = (ic, name, type, uom) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, search_text) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE', ?)").run(c, `${code}-${ic}`, name, type, cat, uom, name.toLowerCase()).lastInsertRowid);
  const it = { cement: item('CEM', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('SND', 'Coarse sand', 'MATERIAL', 'CUM'), beldar: item('BLD', 'Beldar', 'LABOUR', 'DAY'), m25: item('M25', 'RCC M25', 'WORK_ITEM', 'CUM') }; d.close();
  for (const [i, v, uom] of [[it.cement, '7200', 'MT'], [it.sand, '1850', 'CUM'], [it.beldar, '650', 'DAY']]) await api(request, c, 'EST', est, 'post', '/mdm/resource-rates', { itemId: i, rate: v, uom, basis: 'MARKET_SURVEY', effectiveFrom: '2026-01-01' });
  const lines = [[it.cement, 'MT', '0.4', '2'], [it.sand, 'CUM', '0.42', '5'], [it.beldar, 'DAY', '2.5', '0']].map(([itemId, uom, qty, wastagePct]) => ({ itemId, uom, qty, wastagePct }));
  const a = await api(request, c, 'EST', est, 'post', '/mdm/analyses', { workItemId: it.m25, basisQty: '1', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines });
  const { page } = await open(browser, info, c, 'QS', qs, `/admin/rate-analyses/analysis?id=${a.id}`); const errors = watch(page);
  await page.getByTestId('ra-tab-calc').click(); await expect(page.getByTestId('ra-calc')).toBeVisible();
  const unit = page.locator('[data-testid="ra-calc-trace"][data-code="ra.unit_rate"]'); await expect(unit).toBeVisible(); await expect(unit.getByTestId('trace')).toContainText('ra.unit_rate');
  await expect(unit).toContainText(String(Number(a.unitRate).toFixed(2)).replace(/\.00$/, '')); await expect(page.locator('[data-testid="ra-calc-trace"][data-code="ra.line_amount"]')).toBeVisible();
  await noOverflow(page); await page.screenshot({ path: `${OUT}/${info.project.name}-1-calc.png`, fullPage: true });
  expect(errors, errors.join('\n')).toEqual([]);
});
