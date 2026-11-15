import { test, expect } from '@playwright/test';
import { api, company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 22.09 in the browser: the quantity surveyor builds the monthly CVR of a project in the workbench (the lines come from the owners, the accrual is assessed with a note), saves and submits it; the project manager, the commercial manager and (a loss) the project director approve it and it is locked; the contract control tower shows the margin to the director and hides it from the surveyor.
const OUT = 'docs/erp/screenshots/bill-cvr';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function decide(request, c, roles, user) { const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows; for (const t of tasks) await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'ok' }); return tasks.length; }
test('CVR: workbench, approval and lock, control tower', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `c${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['qs', 'QS'], ['pm', 'PM'], ['cm', 'COMMGR'], ['pd', 'PD'], ['dir', 'DIR']]);
  const d = db(); const period = day(0).slice(0, 7);
  fill(d, 'ctl_facts', { company_id: c, org_project_id: s.A, actual_cost: 20_000_000, budget_cost: 50_000_000, resource_type: 'MATERIAL', period_key: period });
  const k = fill(d, 'ctr_contracts', { company_id: c, org_project_id: s.A, contract_no: `C-${t}`, status: 'APPROVED', contract_state: 'ACTIVE', original_paise: 100_000_000, revised_paise: 100_000_000 });
  const bill = fill(d, 'bill_client_bills', { company_id: c, org_project_id: s.A, contract_id: k, bill_no: `RA-${t}`, seq_no: 1, period_from: day(-60), period_to: day(-40), net_paise: 9_000_000, gross_paise: 10_000_000, status: 'APPROVED', client_state: 'SENT', sent_on: day(-30) });
  fill(d, 'bill_certifications', { company_id: c, org_project_id: s.A, contract_id: k, bill_id: bill, cert_no: `CE-${t}`, cert_date: day(-10), submitted_gross_paise: 10_000_000, certified_gross_paise: 9_000_000, status: 'APPROVED' });
  fill(d, 'ctr_claims', { company_id: c, org_project_id: s.A, claim_no: `CL-${t}`, contract_id: k, title: 'Delay', claim_state: 'SUBMITTED', amount_claimed_paise: 2_000_000, status: 'APPROVED' });
  const qs = await open(browser, info, c, 'QS', s.u('qs'), '/bill/cvr?new=1'); const p = qs.page; const errors = watch(p);
  await expect(p.getByTestId('bill-cvr-form')).toBeVisible(); await p.getByTestId('bill-cvr-project').selectOption(String(s.A));
  await expect(p.getByTestId('bill-cvr-value-CERTIFIED')).toContainText('90,000.00'); await expect(p.getByTestId('bill-cvr-cost-ACTUAL')).toContainText('2,00,000.00'); await expect(p.getByTestId('bill-cvr-claim')).toHaveCount(1);
  await p.getByTestId('bill-cvr-prob').fill('50'); await p.getByTestId('bill-cvr-prob-note').fill('Counsel opinion: even chance'); await expect(p.getByTestId('bill-cvr-value-CLAIMS_ASSESSED')).toContainText('10,000.00');
  await p.getByTestId('bill-cvr-add-accrual').click(); await p.getByTestId('bill-cvr-accruals-amount').fill('10000'); await expect(p.getByTestId('bill-cvr-preview')).toBeVisible();
  await p.getByTestId('bill-cvr-accruals-note').fill('Invoice awaited from the supplier'); await expect(p.getByTestId('bill-cvr-cost-ACCRUAL')).toContainText('10,000.00'); await noOverflow(p); await shot(p, '1-workbench', info);
  await p.getByTestId('bill-cvr-commentary').fill('Hire accrual estimated'); await p.getByTestId('bill-cvr-save').click(); await expect(p.getByTestId('bill-cvr-object')).toBeVisible(); await expect(p.getByTestId('bill-cvr-object')).toHaveAttribute('data-status', 'DRAFT');
  await p.getByTestId('bill-submit').click(); await expect(p.getByTestId('bill-cvr-object')).toHaveAttribute('data-status', 'SUBMITTED');
  for (const [r, u] of [['PM', 'pm'], ['COMMGR', 'cm'], ['PD', 'pd']]) await decide(request, c, r, s.u(u));
  await p.reload(); await expect(p.getByTestId('bill-cvr-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByText(/Locked|बंद/).first()).toBeVisible(); await noOverflow(p); await shot(p, '2-approved', info);
  const dir = await open(browser, info, c, 'DIR', s.u('dir'), '/bill/control-tower'); const q = dir.page; await expect(q.getByTestId('bill-tower')).toBeVisible(); await expect(q.getByTestId('bill-ct-row')).toHaveCount(1); await expect(q.getByTestId('bill-ct-margin')).toContainText('₹'); await expect(q.getByTestId('bill-ct-exceptions')).toContainText('1'); await noOverflow(q); await shot(q, '3-tower-director', info);
  const qs2 = await open(browser, info, c, 'QS', s.u('qs'), '/bill/control-tower'); await expect(qs2.page.getByTestId('bill-ct-margin')).not.toContainText('₹'); await shot(qs2.page, '4-tower-surveyor', info);
  expect(errors, errors.join('\n')).toEqual([]);
});
