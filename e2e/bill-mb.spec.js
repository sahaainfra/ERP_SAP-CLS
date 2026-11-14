import { test, expect } from '@playwright/test';
import { api, company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 22.01 in the browser: the site engineer records a measurement on the phone form (the server works out the quantity and runs the checks), sends it; the quantity surveyor records the check measurement and approves; the project manager certifies; the entry is locked with its page of the book; a second entry beyond the BOQ quantity shows the warning; the abstract and the book in print.
const OUT = 'docs/erp/screenshots/bill-mb';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function decide(request, c, roles, user) { const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows; for (const t of tasks) await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'ok' }); return tasks.length; }
test('Measurement book: record on the phone, check measurement, certification, lock, warning beyond the BOQ, abstract and book', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `b${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['se', 'SE'], ['qs', 'QS'], ['pm', 'PM'], ['cm', 'COMMGR']]);
  const d = db(); const ver = fill(d, 'proj_boq_versions', { company_id: c, org_project_id: s.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  fill(d, 'proj_boq_lines', { company_id: c, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 100_000, rate: 60_000_000, amount: 0 }); fill(d, 'proj_locations', { company_id: c, project_id: s.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' });
  const se = await open(browser, info, c, 'SE', s.u('se'), '/bill/mb-record'); const p = se.page; const errors = watch(p);
  await expect(p.getByTestId('bill-mb-form')).toBeVisible(); await p.getByTestId('bill-mb-project').selectOption(String(s.A)); await p.getByTestId('bill-mb-item').selectOption({ index: 1 }); await p.getByTestId('bill-mb-location').selectOption({ index: 1 });
  await p.getByTestId('bill-mb-description').fill('Footing F1 to F6'); await p.getByTestId('bill-mb-nos').fill('6'); await p.getByTestId('bill-mb-length').fill('2.5'); await p.getByTestId('bill-mb-breadth').fill('2.5'); await p.getByTestId('bill-mb-depth').fill('0.6'); await p.getByTestId('bill-mb-deduction').fill('0.5');
  await expect(p.getByTestId('bill-mb-computed')).toContainText('22 cum'); await expect(p.getByTestId('bill-cumulative')).toContainText('100'); await noOverflow(p); await shot(p, '1-record', info);
  await p.getByTestId('bill-mb-save').click(); await expect(p.getByTestId('bill-mb-object')).toBeVisible(); const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await expect(p.getByTestId('bill-mb-qty-value')).toContainText('22'); await p.getByTestId('bill-mb-tab-documents').click(); await noOverflow(p); await shot(p, '2-entry', info);
  await p.getByTestId('bill-submit').click(); await expect(p.getByTestId('bill-mb-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const qs = await open(browser, info, c, 'QS', s.u('qs'), url); await expect(qs.page.getByTestId('bill-check-form')).toBeVisible(); await expect(p.getByTestId('bill-check-form')).toHaveCount(0);
  await qs.page.getByTestId('bill-check-qty').fill('21'); await qs.page.getByTestId('bill-check-name').fill('R. Mehta'); await qs.page.getByTestId('bill-check-org').fill('Consultant'); await qs.page.getByTestId('bill-check-signature').fill('SIG-1'); await noOverflow(qs.page); await shot(qs.page, '3-check', info); await qs.page.getByTestId('bill-check-save').click();
  await expect(qs.page.getByTestId('bill-mb-object')).toHaveAttribute('data-check', 'DIFFERENCE'); await expect(qs.page.getByTestId('bill-mb-checked')).toContainText('21');
  await decide(request, c, 'QS', s.u('qs')); await decide(request, c, 'PM', s.u('pm')); await qs.page.reload(); await expect(qs.page.getByTestId('bill-mb-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(qs.page.getByTestId('bill-mb-certified')).toContainText('21'); await expect(qs.page.getByTestId('bill-check-form')).toHaveCount(0); await shot(qs.page, '4-certified', info);
  await p.goto('/bill/mb-record'); await p.getByTestId('bill-mb-project').selectOption(String(s.A)); await p.getByTestId('bill-mb-item').selectOption({ index: 1 }); await p.getByTestId('bill-mb-template').selectOption('QTY'); await p.getByTestId('bill-mb-description').fill('Extra footings'); await p.getByTestId('bill-mb-qty').fill('90');
  await expect(p.getByTestId('bill-issues').locator('[data-code="OVER_LIMIT"]')).toBeVisible(); await noOverflow(p); await shot(p, '5-over-limit', info);
  await p.goto('/bill/mb-entries'); await expect(p.getByTestId('bill-mb-list')).toBeVisible(); await noOverflow(p); await shot(p, '6-book', info);
  await qs.page.goto('/bill/mb-abstract'); await qs.page.getByTestId('bill-abs-project').selectOption(String(s.A)); await expect(qs.page.getByTestId('bill-abs-row')).toHaveCount(1); await expect(qs.page.getByTestId('bill-abs-row')).toContainText('21'); await noOverflow(qs.page); await shot(qs.page, '7-abstract', info);
  const dl = qs.page.waitForEvent('download'); await qs.page.getByTestId('bill-abs-pdf').click(); expect((await dl).suggestedFilename()).toMatch(/\.pdf$/);
  const cm = await open(browser, info, c, 'COMMGR', s.u('cm'), '/bill/mb-record'); await cm.page.waitForLoadState('networkidle'); await expect(cm.page.getByTestId('bill-mb-form')).toHaveCount(0); await expect(cm.page.getByTestId('bill-mb-save')).toHaveCount(0); await noOverflow(cm.page);
  expect(errors, errors.join('\n')).toEqual([]);
});
