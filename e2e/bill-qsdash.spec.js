import { test, expect } from '@playwright/test';
import { company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 22.08 in the browser: the quantity surveyor sees the chain in money, the variations and claims in progress, the queues and the leakage indicators for a project; a tile opens the records behind it; the back-to-back margin is hidden from the surveyor and shown to the commercial manager.
const OUT = 'docs/erp/screenshots/bill-qsdash';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
test('QS dashboard: tiles, drill-down, queues, margin right', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `q${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['qs', 'QS'], ['cm', 'COMMGR']]);
  const d = db(); const ver = fill(d, 'proj_boq_versions', { company_id: c, org_project_id: s.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  const line = fill(d, 'proj_boq_lines', { company_id: c, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25', uom: 'cum', qty: 100_000, rate: 60_000_000, amount: 0 });
  fill(d, 'bill_mb_entries', { company_id: c, org_project_id: s.A, boq_line_id: line, description: 'Footings', qty_th: 8000, uom: 'cum', status: 'SUBMITTED', check_status: 'NOT_CHECKED', measured_on: day(-3) });
  fill(d, 'ctr_change_requests', { company_id: c, org_project_id: s.A, cr_no: `CR-${t}`, kind: 'CLIENT', origin_type: 'INTERNAL', title: 'Extra drainage', description: 'Extra drainage works', cr_state: 'WITH_CLIENT', value_claimed_paise: 5_000_000, status: 'APPROVED' });
  const k = fill(d, 'ctr_contracts', { company_id: c, org_project_id: s.A, contract_no: `C-${t}`, status: 'APPROVED' });
  fill(d, 'ctr_claims', { company_id: c, org_project_id: s.A, claim_no: `CL-${t}`, contract_id: k, title: 'Delay', claim_state: 'SUBMITTED', amount_claimed_paise: 2_000_000, status: 'APPROVED' });
  fill(d, 'bill_client_bills', { company_id: c, org_project_id: s.A, contract_id: k, bill_no: `RA-${t}-9`, seq_no: 9, period_from: day(-60), period_to: day(-40), net_paise: 7_000_000, gross_paise: 8_000_000, status: 'APPROVED', client_state: 'NOT_SENT' });
  const sent = fill(d, 'bill_client_bills', { company_id: c, org_project_id: s.A, contract_id: k, bill_no: `RA-${t}-8`, seq_no: 8, period_from: day(-90), period_to: day(-70), net_paise: 4_000_000, gross_paise: 5_000_000, status: 'APPROVED', client_state: 'SENT', sent_on: day(-50) });
  fill(d, 'bill_certifications', { company_id: c, org_project_id: s.A, contract_id: k, bill_id: sent, cert_no: `CE-${t}`, cert_date: day(-10), submitted_gross_paise: 10_000_000, certified_gross_paise: 9_000_000, disputed_paise: 300_000, status: 'APPROVED' });
  fill(d, 'bill_sub_bills', { company_id: c, org_project_id: s.A, bill_no: `SB-${t}`, gross_paise: 6_000_000, net_paise: 5_500_000, status: 'APPROVED' });
  const qs = await open(browser, info, c, 'QS', s.u('qs'), '/bill/qs-dashboard'); const p = qs.page; const errors = watch(p);
  await expect(p.getByTestId('bill-qs-dashboard')).toBeVisible(); await p.getByTestId('bill-qd-project').selectOption(String(s.A));
  await expect(p.getByTestId('bill-qd-kpi-measuredNotCertified-value')).toContainText('48,000.00'); await expect(p.getByTestId('bill-qd-kpi-variationPipeline-value')).toContainText('50,000.00'); await expect(p.getByTestId('bill-qd-kpi-claimsPending-value')).toContainText('20,000.00');
  await expect(p.getByTestId('bill-qd-kpi-overdueSubmission')).toHaveAttribute('data-status', 'red'); await noOverflow(p); await shot(p, '1-dashboard', info);
  await p.getByTestId('bill-qd-open-overdueSubmission').click(); await expect(p.getByTestId('bill-qd-drill')).toHaveAttribute('data-kind', 'overdueSubmission'); await expect(p.getByTestId('bill-qd-drill-row')).toHaveCount(1); await expect(p.getByTestId('bill-qd-drill-row')).toContainText(`RA-${t}-9`); await shot(p, '2-drill', info);
  await expect(p.getByTestId('bill-qd-queue-certAwaited')).toHaveAttribute('data-count', '0'); await expect(p.getByTestId('bill-qd-queue-mbPending')).toHaveAttribute('data-count', '1');
  await expect(p.getByTestId('bill-qd-margin')).not.toContainText('30,000'); await expect(p.getByTestId('bill-qd-leakage')).toContainText('10,000.00');
  const cm = await open(browser, info, c, 'COMMGR', s.u('cm'), `/bill/qs-dashboard?projectId=${s.A}`); const q = cm.page; await expect(q.getByTestId('bill-qd-margin')).toContainText('₹ 30,000.00'); await noOverflow(q); await shot(q, '3-commercial-manager', info);
  expect(errors, errors.join('\n')).toEqual([]);
});
