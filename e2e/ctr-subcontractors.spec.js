import { test, expect } from '@playwright/test';
import { company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 21.04 in the browser: the subcontractor coordinator opens the month, compiles the checklist with the PF challan missing (payment goes on hold), asks for a waiver; the HR manager returns it; the coordinator fixes it and the HR manager verifies it (the hold is lifted); committed manpower and the labour strength; the commercial manager rates the month.
const OUT = 'docs/erp/screenshots/ctr-subcontractors';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
test('Subcontractor workspace: compliance, hold, waiver request, verification, strength, rating', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `u${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['sb', 'SUBCO'], ['hr', 'HRMGR'], ['c1', 'COMMGR'], ['pm', 'PM']]);
  const d = db(); fill(d, 'proj_projects', { company_id: c, project_id: s.A, status: 'APPROVED', contract_type: 'ITEM_RATE', contract_no: `SHA/${t}`, contract_value: 50_000_000_000, start_date: '2026-04-01', scheduled_completion: '2028-03-31', dlp_months: 24, retention_pct: 50000, mob_advance_pct: 100000 });
  const sub = fill(d, 'mdm_partners', { company_id: c, code: `SB-${t}`, legal_name: 'Shree Earthworks', partner_status: 'ACTIVE' }); fill(d, 'mdm_partner_roles', { company_id: c, partner_id: sub, partner_role: 'SUBCONTRACTOR' });
  fill(d, 'ctr_work_orders', { company_id: c, doc_no: `WOR/${t}`, wo_no: `WO-${t}`, wo_type: 'ITEM_RATE', org_project_id: s.A, subcontractor_id: sub, title: 'Earthwork', start_date: day(-120), end_date: day(180), value_paise: 80_000_000, status: 'APPROVED', wo_state: 'ISSUED' });
  const sb = await open(browser, info, c, 'SUBCO', s.u('sb'), '/ctr/sub-compliance'); const p = sb.page; const errors = watch(p);
  await expect(p.getByTestId('ctr-sub-compliance')).toBeVisible(); await p.getByTestId('ctr-sc-open').click(); await expect(p.getByTestId('ctr-note')).toBeVisible();
  d.prepare("UPDATE ctr_sub_compliance SET due_date = ? WHERE company_id = ?").run(day(-3), c);
  const cid = d.prepare('SELECT id FROM ctr_sub_compliance WHERE company_id = ?').get(c).id; await p.goto(`/ctr/sub-compliance?id=${cid}`); await expect(p.getByTestId('ctr-sc-object')).toBeVisible(); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  for (const code of ['CLRA', 'ESI', 'WAGE_REG', 'WC_INSURANCE', 'BOCW']) { await p.getByTestId(`ctr-sc-status-${code}`).selectOption('OK'); await p.getByTestId(`ctr-sc-ref-${code}`).fill(`${code}/${t}`); }
  await p.getByTestId('ctr-sc-status-GST_RETURN').selectOption('NA'); await noOverflow(p); await shot(p, '1-checklist', info); await p.getByTestId('ctr-sc-save').click(); await expect(p.getByTestId('ctr-note')).toBeVisible();
  await p.reload(); await expect(p.getByTestId('ctr-sc-object')).toHaveAttribute('data-missing', '1'); await expect(p.getByTestId('ctr-sc-overdue')).toBeVisible();
  await p.getByTestId('ctr-sw-item-PF').check(); await p.getByTestId('ctr-sw-reason').fill('The PF challan is being paid this week'); await p.getByTestId('ctr-sw-valid').fill(day(10)); await p.getByTestId('ctr-sw-save').click(); await expect(p.getByTestId('ctr-sw-object')).toBeVisible(); await shot(p, '2-waiver', info);
  await p.goto(`/ctr/subcontractors?subcontractorId=${sub}&projectId=${s.A}`); await expect(p.getByTestId('ctr-ws-hold')).toBeVisible(); await expect(p.getByTestId('ctr-ws')).toHaveAttribute('data-hold', '1'); await noOverflow(p); await shot(p, '3-workspace-hold', info);
  await p.goto(url); await p.getByTestId('ctr-sc-submit').click(); await expect(p.getByTestId('ctr-sc-object')).toHaveAttribute('data-state', 'SUBMITTED');
  const hr = await open(browser, info, c, 'HRMGR', s.u('hr'), url); hr.page.once('dialog', (dl) => dl.accept('PF challan of the month is missing')); await hr.page.getByTestId('ctr-sc-return').click(); await expect(hr.page.getByTestId('ctr-sc-object')).toHaveAttribute('data-state', 'RETURNED');
  await p.reload(); await p.getByTestId('ctr-sc-status-PF').selectOption('OK'); await p.getByTestId('ctr-sc-ref-PF').fill(`PF/${t}`); await p.getByTestId('ctr-sc-save').click(); await expect(p.getByTestId('ctr-note')).toBeVisible(); await p.getByTestId('ctr-sc-submit').click(); await expect(p.getByTestId('ctr-sc-object')).toHaveAttribute('data-state', 'SUBMITTED');
  await hr.page.reload(); await hr.page.getByTestId('ctr-sc-verify').click(); await expect(hr.page.getByTestId('ctr-sc-object')).toHaveAttribute('data-state', 'VERIFIED'); await shot(hr.page, '4-verified', info);
  await p.goto(`/ctr/subcontractors?subcontractorId=${sub}&projectId=${s.A}`); await expect(p.getByTestId('ctr-ws-hold')).toHaveCount(0); await expect(p.getByTestId('ctr-ws')).toHaveAttribute('data-hold', '0');
  // the committed manpower and the strength
  for (const n of [1, 2]) { const id = fill(d, 'site_dprs', { company_id: c, org_project_id: s.A, dpr_date: day(-n), status: 'APPROVED' }); fill(d, 'site_dpr_labour', { company_id: c, dpr_id: id, category: 'CONTRACT', contractor_id: sub, trade_code: 'MASON', headcount: n === 1 ? 10 : 20 }); }
  await p.goto(`/ctr/sub-strength?projectId=${s.A}`); await p.getByTestId('ctr-ss-sub').selectOption(String(sub)); await p.getByTestId('ctr-ss-trade').fill('MASON'); await p.getByTestId('ctr-ss-committed').fill('20'); await p.getByTestId('ctr-ss-from').fill(day(-30)); await p.getByTestId('ctr-ss-save').click(); await expect(p.getByTestId('ctr-ss-manpower')).toBeVisible();
  await p.reload(); await expect(p.getByTestId('ctr-ss-row').filter({ has: p.locator('[data-flagged="1"]') }).or(p.locator('[data-testid=ctr-ss-row][data-flagged="1"]'))).toHaveCount(1); await noOverflow(p); await shot(p, '5-strength', info);
  const c1 = await open(browser, info, c, 'COMMGR', s.u('c1'), `/ctr/subcontractors?subcontractorId=${sub}&projectId=${s.A}`); await c1.page.getByTestId('ctr-ws-rate').click(); await expect(c1.page.getByTestId('ctr-ws-rating')).toBeVisible(); await expect(c1.page.getByTestId('ctr-ws-f-value')).toContainText('8,00,000'); await noOverflow(c1.page); await shot(c1.page, '6-workspace', info);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/ctr/subcontractors'); await expect(pm.page.getByTestId('ctr-ws-row')).toHaveCount(1); await noOverflow(pm.page);
  expect(errors, errors.join('\n')).toEqual([]);
});
