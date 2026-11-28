import { test, expect } from '@playwright/test';
import { H, api, company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// PACK-18 in the browser (flag ff.bill.pack18): the site engineer measures on the phone with deduction lines and the position, the form is
// kept on the device while offline and offered again after a reload, the saved entry shows the lines, the position and the camera input of
// its documents; once certified, the quantity reconciliation shows the value certified and not yet billed. Screenshots go to pack-reports/
// (git-ignored), so no tracked file changes.
const OUT = 'pack-reports/screens/pack18';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
async function decide(request, c, roles, user) { const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows; for (const t of tasks) await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'ok' }); return tasks.length; }

test('PACK-18 measurement on a phone: deduction lines, position, offline copy, photos on the entry, value certified not billed', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `p18${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['se', 'SE'], ['qs', 'QS'], ['pm', 'PM']]);
  for (const key of ['ff.bill.pack18']) { const f = await request.patch(`/api/v1/core/feature-flags/${key}`, { headers: H('SYSADM', c, 'e2e-setup'), data: { scope: { level: 'company', companyId: c }, enabled: true, reason: 'e2e: PACK-18' } }); expect(f.status(), await f.text()).toBeLessThan(300); }
  const d = db(); const ver = fill(d, 'proj_boq_versions', { company_id: c, org_project_id: s.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  fill(d, 'proj_boq_lines', { company_id: c, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 100_000, rate: 60_000_000, amount: 0 }); fill(d, 'proj_locations', { company_id: c, project_id: s.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' }); d.close();
  const se = await open(browser, info, c, 'SE', s.u('se'), '/bill/mb-record'); const p = se.page; const errors = watch(p);
  await se.context.grantPermissions(['geolocation']); await se.context.setGeolocation({ latitude: 17.385044, longitude: 78.486671, accuracy: 9 });
  await expect(p.getByTestId('bill-mb-form')).toBeVisible(); await p.getByTestId('bill-mb-project').selectOption(String(s.A)); await p.getByTestId('bill-mb-item').selectOption({ index: 1 }); await p.getByTestId('bill-mb-location').selectOption({ index: 1 });
  await p.getByTestId('bill-mb-description').fill('Footing F1 to F6'); await p.getByTestId('bill-mb-nos').fill('6'); await p.getByTestId('bill-mb-length').fill('2.5'); await p.getByTestId('bill-mb-breadth').fill('2.5'); await p.getByTestId('bill-mb-depth').fill('0.6');
  // offline: told that the form is kept on the phone
  await se.context.setOffline(true); await expect(p.getByTestId('bill-mb-offline')).toBeVisible(); await noOverflow(p); await shot(p, '1-offline', info); await se.context.setOffline(false); await expect(p.getByTestId('bill-mb-offline')).toHaveCount(0);
  // the copy on the device is offered after a reload
  await p.reload(); await expect(p.getByTestId('bill-mb-local')).toBeVisible(); await p.getByTestId('bill-mb-local-resume').click(); await expect(p.getByTestId('bill-mb-description')).toHaveValue('Footing F1 to F6'); await expect(p.getByTestId('bill-mb-depth')).toHaveValue('0.6');
  // deduction lines replace the single deduction
  await p.getByTestId('bill-mb-ded-add').click(); const l1 = p.getByTestId('bill-mb-deduction-line').nth(0); await l1.getByTestId('bill-mb-ded-description').fill('Pedestal openings'); await l1.getByTestId('bill-mb-ded-nos').fill('2'); await l1.getByTestId('bill-mb-ded-length').fill('0.5'); await l1.getByTestId('bill-mb-ded-breadth').fill('0.5'); await l1.getByTestId('bill-mb-ded-depth').fill('0.6');
  await p.getByTestId('bill-mb-ded-add').click(); const l2 = p.getByTestId('bill-mb-deduction-line').nth(1); await l2.getByTestId('bill-mb-ded-description').fill('Sump'); await l2.getByTestId('bill-mb-ded-length').fill('1'); await l2.getByTestId('bill-mb-ded-breadth').fill('1'); await l2.getByTestId('bill-mb-ded-depth').fill('0.2');
  await expect(p.getByTestId('bill-mb-deduction')).toHaveCount(0); await expect(p.getByTestId('bill-mb-computed')).toContainText('22 cum'); await expect(p.getByTestId('bill-mb-ded-total')).toContainText('0.5');
  await p.locator('#bill-mb-geo').getByRole('button').first().click(); await expect(p.locator('#bill-mb-geo')).toContainText('Position captured'); await expect(p.locator('#bill-mb-geo input').first()).toHaveValue('17.385044');
  await noOverflow(p); await shot(p, '2-lines-position', info);
  await p.getByTestId('bill-mb-save').click(); await expect(p.getByTestId('bill-mb-object')).toBeVisible(); await expect(p.getByTestId('bill-mb-qty-value')).toContainText('22');
  expect(await p.evaluate(() => localStorage.getItem('erp.bill.mb.local'))).toBeNull();
  await expect(p.getByTestId('bill-mb-ded-list').locator('li')).toHaveCount(2); await expect(p.getByTestId('bill-mb-geo-shown')).toContainText('17.385044, 78.486671'); await noOverflow(p); await shot(p, '3-entry', info);
  await p.getByTestId('bill-mb-tab-documents').click(); await expect(p.getByTestId('camera-input')).toHaveAttribute('capture', 'environment'); await expect(p.getByTestId('camera-input')).toHaveAttribute('accept', 'image/*');
  // certified: the reconciliation shows the value certified and not billed
  await p.getByTestId('bill-submit').click(); await expect(p.getByTestId('bill-mb-object')).toHaveAttribute('data-status', 'SUBMITTED');
  await decide(request, c, 'QS', s.u('qs')); await decide(request, c, 'PM', s.u('pm'));
  const qs = await open(browser, info, c, 'QS', s.u('qs'), `/bill/qty-recon?projectId=${s.A}`); const q = qs.page; const qerr = watch(q);
  await expect(q.getByTestId('bill-recon-money')).toBeVisible(); await expect(q.getByTestId('bill-recon-tie')).toHaveAttribute('data-ties', 'yes');
  const row = q.getByTestId('bill-recon-money-row').filter({ hasText: '2.1' }); await expect(row).toContainText('1,32,000.00'); await expect(row).toContainText(/Certified, not billed/);
  await noOverflow(q); await shot(q, '4-recon-money', info);
  expect([...errors, ...qerr], [...errors, ...qerr].join('\n')).toEqual([]);
});
