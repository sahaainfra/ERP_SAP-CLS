import { test, expect } from '@playwright/test';
import { api, company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 21.03 in the browser: the commercial manager makes an item-rate work order mapped to the client BOQ and sends it; another commercial manager approves; the subcontractor coordinator records the acceptance; the work order is amended with an added item and approved; the back-to-back margin report shows the items; the work order is closed with its final bill.
const OUT = 'docs/erp/screenshots/ctr-workorders';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function decide(request, c, roles, user) { const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows; for (const t of tasks) await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'ok' }); return tasks.length; }
test('Work order: from the client BOQ, margin, approval, acceptance, amendment, margin report, closure', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `w${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['c1', 'COMMGR'], ['c2', 'COMMGR'], ['sb', 'SUBCO'], ['pm', 'PM']]);
  const d = db(); const sub = fill(d, 'mdm_partners', { company_id: c, code: `SB-${t}`, legal_name: 'Shree Earthworks', partner_status: 'ACTIVE' }); fill(d, 'mdm_partner_roles', { company_id: c, partner_id: sub, partner_role: 'SUBCONTRACTOR' });
  fill(d, 'proj_projects', { company_id: c, project_id: s.A, status: 'APPROVED', contract_type: 'ITEM_RATE', contract_no: `SHA/${t}`, contract_value: 50_000_000_000, start_date: '2026-04-01', scheduled_completion: '2028-03-31', dlp_months: 24, retention_pct: 50000, mob_advance_pct: 100000 });
  const ver = fill(d, 'proj_boq_versions', { company_id: c, org_project_id: s.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED' });
  fill(d, 'proj_boq_lines', { company_id: c, version_id: ver, line_kind: 'ITEM', item_code: '1.1', description: 'Earthwork in embankment', uom: 'cum', qty: 1_000_000, rate: 10_000_000, amount: 0 });
  const c1 = await open(browser, info, c, 'COMMGR', s.u('c1'), '/ctr/work-orders?new=1'); const p = c1.page; const errors = watch(p);
  await expect(p.getByTestId('ctr-wo-form')).toBeVisible(); await p.getByTestId('ctr-wo-project').selectOption(String(s.A)); await p.getByTestId('ctr-wo-woNo').fill(`WO-${t}`); await p.getByTestId('ctr-wo-title').fill('Earthwork in embankment, chainage 0 to 5');
  await p.getByTestId('ctr-wo-subcontractorId').selectOption(String(sub)); await p.getByTestId('ctr-wo-justification').fill('Only local party with the plant on site'); await p.getByTestId('ctr-wo-endDate').fill(day(180));
  await p.getByTestId('ctr-wo-add-item').click(); await p.getByTestId('ctr-wo-boq').selectOption({ index: 1 }); await p.getByTestId('ctr-wo-qty').fill('100'); await p.getByTestId('ctr-wo-rate').fill('800'); await expect(p.getByTestId('ctr-wo-total')).toContainText('80,000');
  await noOverflow(p); await shot(p, '1-new-work-order', info); await p.getByTestId('ctr-wo-save').click(); await expect(p.getByTestId('ctr-wo-object')).toBeVisible(); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  await expect(p.getByTestId('ctr-wo-value')).toContainText('80,000'); await expect(p.getByTestId('ctr-wo-margin')).toContainText('20,000'); await p.getByTestId('ctr-wo-tab-margin-btn').click(); await expect(p.getByTestId('ctr-wo-margin-row')).toHaveAttribute('data-negative', '0'); await noOverflow(p); await shot(p, '2-work-order', info);
  await p.getByTestId('ctr-submit').click(); await expect(p.getByTestId('ctr-wo-object')).toHaveAttribute('data-status', 'SUBMITTED'); await decide(request, c, 'COMMGR', s.u('c2')); await p.reload(); await expect(p.getByTestId('ctr-wo-object')).toHaveAttribute('data-state', 'ISSUED'); await expect(p.getByTestId('ctr-wo-committed')).toContainText('80,000');
  const sb = await open(browser, info, c, 'SUBCO', s.u('sb'), url); sb.page.once('dialog', (dl) => dl.accept('Mr Patel')); await sb.page.getByTestId('ctr-wo-accept').click(); await expect(sb.page.getByTestId('ctr-wo-object')).toHaveAttribute('data-state', 'ACCEPTED'); await expect(sb.page.getByTestId('ctr-wo-margin')).toHaveCount(0); await shot(sb.page, '3-accepted-subco', info);
  await p.reload(); await p.getByTestId('ctr-wo-amend').click(); await p.getByTestId('ctr-woa-qty-1').fill('150'); await p.getByTestId('ctr-woa-desc').fill('More earthwork on the extended chainage'); await p.getByTestId('ctr-woa-save').click(); await expect(p.getByTestId('ctr-woa-object')).toBeVisible(); await expect(p.getByTestId('ctr-woa-delta')).toContainText('40,000'); await noOverflow(p); await shot(p, '4-amendment', info);
  await p.getByTestId('ctr-submit').click(); await expect(p.getByTestId('ctr-woa-object')).toHaveAttribute('data-status', 'SUBMITTED'); await decide(request, c, 'COMMGR', s.u('c2')); await p.goto(url); await expect(p.getByTestId('ctr-wo-value')).toContainText('1,20,000'); await expect(p.getByTestId('ctr-wo-committed')).toContainText('1,20,000');
  await p.goto('/ctr/wo-margin'); await expect(p.getByTestId('ctr-wm-row')).toHaveCount(1); await expect(p.getByTestId('ctr-wm-margin')).toContainText('30,000'); await noOverflow(p); await shot(p, '5-margin-report', info);
  await p.goto(url); p.once('dialog', (dl) => dl.accept('FB/2026/1')); await p.getByTestId('ctr-wo-close').click(); await expect(p.getByTestId('ctr-wo-object')).toHaveAttribute('data-state', 'CLOSED');
  await p.goto('/ctr/work-orders'); await expect(p.getByTestId('ctr-work-orders')).toBeVisible(); await noOverflow(p); await shot(p, '6-register', info);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/ctr/work-orders'); await expect(pm.page.getByTestId('ctr-work-orders')).toBeVisible(); await noOverflow(pm.page);
  expect(errors, errors.join('\n')).toEqual([]);
});
