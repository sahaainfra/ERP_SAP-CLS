import { test, expect as playwrightExpect } from '@playwright/test';
import { api, company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 22.02 in the browser: the quantity chain of an item with its drill-down, the forecast typed by the QS, the items approaching their limit, a deviation statement prepared from the items beyond the allowance, approved by the commercial manager and the project manager, sent to the client and accepted into a change request; an extra item decided by the project manager.
const OUT = 'docs/erp/screenshots/bill-recon';
const expect = playwrightExpect.configure({ timeout: 20_000 });
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
async function decide(request, c, roles, user) { const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows; for (const t of tasks) await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'ok' }); return tasks.length; }
test('Quantity reconciliation, forecast, limits, deviation statement to the client and the extra item', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `r${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['qs', 'QS'], ['cm', 'COMMGR'], ['pm', 'PM'], ['se', 'SE']]);
  const d = db(); const ver = fill(d, 'proj_boq_versions', { company_id: c, org_project_id: s.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  const footing = fill(d, 'proj_boq_lines', { company_id: c, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 100_000, rate: 60_000_000, amount: 0 });
  fill(d, 'proj_boq_lines', { company_id: c, version_id: ver, line_kind: 'ITEM', item_code: '2.2', description: 'Reinforcement steel', uom: 'MT', qty: 50_000, rate: 600_000_000, amount: 0 });
  const block = fill(d, 'proj_locations', { company_id: c, project_id: s.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' });
  fill(d, 'bill_mb_entries', { company_id: c, org_project_id: s.A, boq_line_id: footing, location_id: block,
    description: 'Block 1 footing measurement', template: 'QTY', qty_th: 10_000, uom: 'cum',
    measured_by: s.u('qs'), measured_on: '2026-04-01', status: 'SUBMITTED' });
  const qs = await open(browser, info, c, 'QS', s.u('qs'), `/bill/qty-recon?projectId=${s.A}`); const p = qs.page; const errors = watch(p);
  await expect(p.getByTestId('bill-recon-table')).toBeVisible(); await expect(p.getByTestId('bill-recon-row')).toHaveCount(2); await expect(p.getByTestId('bill-recon-count-items')).toContainText('2'); await noOverflow(p); await shot(p, '1-reconciliation', info);
  await p.getByTestId('bill-recon-row').first().getByTestId('bill-recon-open').click(); await expect(p.getByTestId('bill-recon-detail')).toBeVisible();
  await p.getByTestId('bill-forecast-qty').fill('140'); await p.getByTestId('bill-forecast-basis').fill('Revised drawings add footings'); await p.getByTestId('bill-forecast-save').click(); await expect(p.getByTestId('bill-forecast-now')).toContainText('140'); await noOverflow(p); await shot(p, '2-forecast', info);
  await expect(p.locator('[data-testid="bill-recon-row"][data-code="2.1"]')).toHaveAttribute('data-level', 'FORECAST_OVER');
  await p.getByTestId('bill-recon-by').selectOption('location');
  await expect(p.getByTestId('bill-recon-row').filter({ hasText: 'Block 1' })).toHaveCount(1);
  await p.goto(`/bill/qty-limits`); await p.getByTestId('bill-limits-project').selectOption(String(s.A)); await expect(p.getByTestId('bill-limits-row')).toHaveCount(1); await noOverflow(p); await shot(p, '3-limits', info);
  await p.goto(`/bill/deviations?new=1&projectId=${s.A}`); await expect(p.getByTestId('bill-ds-candidate')).toHaveCount(1); await p.getByTestId('bill-ds-pick').check(); await p.getByTestId('bill-ds-reason').fill('Extra footings for the revised drawings'); await noOverflow(p); await shot(p, '4-new-statement', info);
  await p.getByTestId('bill-ds-save').click(); await expect(p.getByTestId('bill-ds-object')).toBeVisible(); const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await expect(p.getByTestId('bill-ds-count')).toContainText('1'); await expect(p.getByTestId('bill-ds-effect')).toContainText('2,40,000'); await p.getByTestId('bill-submit').click(); await expect(p.getByTestId('bill-ds-object')).toHaveAttribute('data-status', 'SUBMITTED');
  await decide(request, c, 'COMMGR', s.u('cm')); await decide(request, c, 'PM', s.u('pm')); await p.reload(); await expect(p.getByTestId('bill-ds-object')).toHaveAttribute('data-status', 'APPROVED'); await p.getByTestId('bill-ds-tab-client').click(); await p.getByTestId('bill-ds-sent-ref').fill('CLT/DS/1'); await p.getByTestId('bill-ds-send').click(); await expect(p.getByTestId('bill-ds-object')).toHaveAttribute('data-client', 'SENT');
  await p.getByTestId('bill-ds-tab-client').click(); await p.getByTestId('bill-ds-decision').selectOption('ACCEPTED'); await p.getByTestId('bill-ds-outcome').selectOption('VARIATION'); await noOverflow(p); await shot(p, '5-client', info); await p.getByTestId('bill-ds-respond').click(); await expect(p.getByTestId('bill-ds-object')).toHaveAttribute('data-client', 'ACCEPTED'); await p.getByTestId('bill-ds-tab-client').click(); await expect(p.getByTestId('bill-ds-cr')).toBeVisible(); await shot(p, '6-accepted', info);
  await p.goto('/bill/deviations'); await expect(p.getByTestId('bill-deviations')).toBeVisible(); await noOverflow(p);
  await p.goto('/bill/deviations?xnew=1'); await p.getByTestId('bill-xi-project').selectOption(String(s.A)); await p.getByTestId('bill-xi-description').fill('Retaining wall at the culvert'); await p.getByTestId('bill-xi-uom').fill('cum'); await p.getByTestId('bill-xi-qty').fill('50'); await p.getByTestId('bill-xi-rate').fill('800'); await p.getByTestId('bill-xi-reason').fill('Client instruction after the soil report'); await p.getByTestId('bill-xi-save').click(); await expect(p.getByTestId('bill-xi-object')).toBeVisible(); const xurl = p.url().replace(/^https?:\/\/[^/]+/, '');
  const pm = await open(browser, info, c, 'PM', s.u('pm'), xurl);
  await expect(pm.page.getByTestId('bill-xi-object')).toBeVisible();
  await expect(pm.page.getByTestId('bill-xi-decide-form')).toBeVisible();
  await shot(pm.page, '7-extra', info); await pm.page.getByTestId('bill-xi-ref').fill('CLT/APP/3'); await pm.page.getByTestId('bill-xi-decide').click(); await expect(pm.page.getByTestId('bill-xi-object')).toHaveAttribute('data-state', 'APPROVED'); await noOverflow(pm.page);
  await expect(p.getByTestId('bill-xi-decide-form')).toHaveCount(0); const se = await open(browser, info, c, 'SE', s.u('se'), `/bill/qty-recon?projectId=${s.A}`); await expect(se.page.getByTestId('bill-recon-table')).toBeVisible(); await se.page.getByTestId('bill-recon-open').first().click(); await expect(se.page.getByTestId('bill-forecast-form')).toHaveCount(0); await expect(se.page.getByTestId('bill-recon-prepare')).toHaveCount(0);
  void url; expect(errors, errors.join('\n')).toEqual([]);
});
