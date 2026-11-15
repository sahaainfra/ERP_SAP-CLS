import { test, expect } from '@playwright/test';
import { api, company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 22.07 in the browser: the quantity surveyor sees the retention held back from a subcontractor's bills (deducted, released, balance, ageing), records an advance to the subcontractor and sends it for approval (project manager, commercial manager, CFO), then asks for a release of retention: the checklist shows the checks, a failing check blocks the request unless a reason is given.
const OUT = 'docs/erp/screenshots/bill-ledger';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
async function decide(request, c, roles, user) { const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows; for (const t of tasks) await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'ok' }); return tasks.length; }
test('Ledgers: retention summary, advance recovery, release request', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `l${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['qs', 'QS'], ['pm', 'PM'], ['cm', 'COMMGR'], ['cfo', 'CFO']]);
  const d = db(); const sub = fill(d, 'mdm_partners', { company_id: c, code: `S-${t}`, legal_name: 'Shree Civil Works', constitution: 'PARTNERSHIP', partner_status: 'ACTIVE' });
  const wo = fill(d, 'ctr_work_orders', { company_id: c, wo_no: `WO/${t}/1`, org_project_id: s.A, subcontractor_id: sub, status: 'APPROVED', requested_by: 'cm1' });
  fill(d, 'bill_retention_ledger', { company_id: c, org_project_id: s.A, party_type: 'SUBCONTRACTOR', kind: 'RETENTION', wo_id: wo, party_id: sub, txn_type: 'DEDUCTED', txn_source: 'MANUAL', txn_source_id: 1, bill_ref: 'SB-1', amount_paise: 5000000, txn_date: today, balance_paise: 5000000 });
  fill(d, 'bill_retention_ledger', { company_id: c, org_project_id: s.A, party_type: 'SUBCONTRACTOR', kind: 'RETENTION', wo_id: wo, party_id: sub, txn_type: 'DEDUCTED', txn_source: 'MANUAL', txn_source_id: 2, bill_ref: 'SB-2', amount_paise: 3000000, txn_date: today, balance_paise: 8000000 });
  const qs = await open(browser, info, c, 'QS', s.u('qs'), '/bill/retention'); const p = qs.page; const errors = watch(p);
  await expect(p.getByTestId('bill-retention')).toBeVisible(); await p.getByTestId('bill-rt-side').selectOption('SUBCONTRACTOR');
  await expect(p.getByTestId('bill-rt-row')).toHaveCount(1); await expect(p.getByTestId('bill-rt-t-balance')).toContainText('80,000.00'); await expect(p.getByTestId('bill-rt-t-deducted')).toContainText('80,000.00'); await noOverflow(p); await shot(p, '1-retention', info);
  await p.getByTestId('bill-rt-open').click(); await expect(p.getByTestId('bill-rt-entry')).toHaveCount(2); await shot(p, '2-entries', info);
  await p.goto('/bill/advances?new=1'); await expect(p.getByTestId('bill-adv-form')).toBeVisible(); const pj = p.getByTestId('bill-adv-project'); await pj.selectOption(String(s.A)); await p.getByTestId('bill-adv-scope').selectOption(String(wo)); await p.getByTestId('bill-adv-ref').fill(`ADV-${t}`); await p.getByTestId('bill-adv-amount').fill('100000'); await p.getByTestId('bill-adv-pct').fill('25'); await shot(p, '3-advance-form', info);
  await p.getByTestId('bill-adv-save').click(); await expect(p.getByTestId('bill-adv-object')).toBeVisible(); await expect(p.getByTestId('bill-adv-outstanding')).toContainText('1,00,000.00');
  await p.getByTestId('bill-submit').click(); await expect(p.getByTestId('bill-adv-object')).toHaveAttribute('data-status', 'SUBMITTED');
  for (const [r, u] of [['PM', 'pm'], ['COMMGR', 'cm'], ['CFO', 'cfo']]) await decide(request, c, r, s.u(u));
  await p.reload(); await expect(p.getByTestId('bill-adv-object')).toHaveAttribute('data-state', 'ACTIVE'); await p.getByTestId('bill-adv-tab-schedule').click(); await expect(p.getByTestId('bill-adv-schedule')).toContainText('50,000.00'); await noOverflow(p); await shot(p, '4-advance', info);
  await p.goto('/bill/releases?new=1'); await expect(p.getByTestId('bill-rel-form')).toBeVisible(); await p.getByTestId('bill-rel-project').selectOption(String(s.A)); await p.getByTestId('bill-rel-scope').selectOption(String(wo)); await p.getByTestId('bill-rel-amount').fill('30000');
  await expect(p.getByTestId('bill-rel-checklist')).toBeVisible(); await expect(p.locator('[data-testid="bill-rel-checklist"] [data-code="BALANCE"]')).toHaveAttribute('data-ok', '1'); await shot(p, '5-release-form', info);
  await p.getByTestId('bill-rel-amount').fill('900000'); await expect(p.locator('[data-testid="bill-rel-checklist"] [data-code="BALANCE"]')).toHaveAttribute('data-ok', '0');
  await p.getByTestId('bill-rel-amount').fill('30000'); await p.getByTestId('bill-rel-save').click(); await expect(p.getByTestId('bill-rel-object')).toBeVisible(); await noOverflow(p); await shot(p, '6-release', info);
  await p.goto('/bill/releases'); await expect(p.getByTestId('bill-releases')).toBeVisible(); await expect(p.getByTestId('bill-releases')).toContainText('REL'); await noOverflow(p);
  expect(errors, errors.join('\n')).toEqual([]);
});
