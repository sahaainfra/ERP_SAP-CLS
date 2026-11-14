import { test, expect } from '@playwright/test';
import { company, db, fill, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 20.01 in the browser: the plant in-charge makes a plant with a silo and a scale and sends it; the project manager approves; a mix design is made with a live volume check, trials and effective date; the plant quality engineer and the quality control manager approve it. Desktop and mobile.
const OUT = 'docs/erp/screenshots/rmc-plants';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
test('Batching plant and mix design: plant with silo and scale, approval, mix proportions checked live, two-level quality approval', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const t = `p${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['pl', 'PLANTMGR'], ['pm', 'PM'], ['qe', 'QCE'], ['qm', 'QCMGR']]);
  const d = db(); const it = {}; for (const [k, name] of [['cement', 'Cement OPC 53'], ['flyAsh', 'Fly ash'], ['sand', 'River sand'], ['agg20', '20 mm aggregate'], ['agg10', '10 mm aggregate'], ['adm', 'Superplasticiser']]) it[k] = fill(d, 'mdm_items', { company_id: c, code: `${k.toUpperCase()}-${t}`, name, base_uom: 'KG', item_status: 'ACTIVE' }); d.close();
  const pl = await open(browser, info, c, 'PLANTMGR', s.u('pl'), '/rmc/plants?new=1'); const p = pl.page; const errors = watch(p);
  await expect(p.getByTestId('rmc-plant-form')).toBeVisible(); await p.getByTestId('rmc-project').selectOption(String(s.A)); await p.getByTestId('rmc-site').selectOption(String(s.site)); await p.getByTestId('rmc-plant-code').fill(`BP-${t}`); await p.getByTestId('rmc-plant-name').fill('Batching plant 1'); await p.getByTestId('rmc-plant-capacity').fill('60'); await p.getByTestId('rmc-plant-cc').fill('CC-BP1'); await noOverflow(p); await shot(p, '1-new-plant', info); await p.getByTestId('rmc-plant-save').click();
  await expect(p.getByTestId('rmc-plant-object')).toBeVisible(); await expect(p.getByTestId('rmc-plant-cap')).toHaveText('60');
  await p.getByTestId('rmc-silo-code').fill('S1'); await p.getByTestId('rmc-silo-item').selectOption(String(it.cement)); await p.getByTestId('rmc-silo-capacity').fill('100000'); await p.getByTestId('rmc-silo-add').click(); await expect(p.getByTestId('rmc-silo-row')).toHaveCount(1);
  await p.getByTestId('rmc-scale-code').fill('W1'); await p.getByTestId('rmc-scale-due').fill(`${Number(today().slice(0, 4)) + 1}-01-15`); await p.getByTestId('rmc-scale-add').click(); await expect(p.getByTestId('rmc-scale-row')).toHaveAttribute('data-state', 'OK'); await noOverflow(p); await shot(p, '2-plant', info);
  const url = p.url(); await p.getByTestId('rmc-submit').click(); await expect(p.getByTestId('rmc-plant-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const pm = await open(browser, info, c, 'PM', s.u('pm'), url.replace(/^https?:\/\/[^/]+/, '')); await expect(pm.page.getByTestId('rmc-decide')).toBeVisible(); await pm.page.getByTestId('rmc-approve').click(); await expect(pm.page.getByTestId('rmc-plant-object')).toHaveAttribute('data-status', 'APPROVED'); await shot(pm.page, '3-approved', info);
  await p.goto('/rmc/mix-designs?new=1'); await expect(p.getByTestId('rmc-mix-form')).toBeVisible(); await p.getByTestId('rmc-mix-plant').selectOption({ index: 1 }); await p.getByTestId('rmc-mix-grade').selectOption('M25');
  for (const [k, q, i] of [['CEMENT', 340, it.cement], ['FLY_ASH', 60, it.flyAsh], ['WATER', 160, null], ['SAND', 700, it.sand], ['AGG_20', 700, it.agg20], ['AGG_10', 450, it.agg10], ['ADMIXTURE', 4, it.adm]]) { await p.getByTestId(`rmc-mix-qty-${k}`).fill(String(q)); if (i) await p.getByTestId(`rmc-mix-item-${k}`).selectOption(String(i)); }
  await expect(p.getByTestId('rmc-mix-check')).toHaveAttribute('data-ok', 'true'); await expect(p.getByTestId('rmc-mix-wc')).toHaveText('0.4');
  await p.getByTestId('rmc-mix-qty-SAND').fill('300'); await expect(p.getByTestId('rmc-mix-check')).toHaveAttribute('data-ok', 'false'); await p.getByTestId('rmc-mix-qty-SAND').fill('700');
  await p.getByTestId('rmc-mix-from').fill(`${Number(today().slice(0, 4)) - 1}-01-01`); const tr = p.getByTestId('rmc-mix-trial').first(); await tr.locator('input[type="date"]').fill(today()); await p.getByTestId('rmc-mix-cube28-0').fill('36'); await noOverflow(p); await shot(p, '4-new-mix', info);
  await p.getByTestId('rmc-mix-save').click(); await expect(p.getByTestId('rmc-mix-object')).toBeVisible(); await expect(p.getByTestId('rmc-mix-wc')).toHaveText('0.4'); await expect(p.getByTestId('rmc-mix-problems')).toHaveCount(0); const murl = p.url(); await p.getByTestId('rmc-submit').click(); await expect(p.getByTestId('rmc-mix-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const qe = await open(browser, info, c, 'QCE', s.u('qe'), murl.replace(/^https?:\/\/[^/]+/, '')); await qe.page.getByTestId('rmc-approve').click(); await expect(qe.page.getByTestId('rmc-mix-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const qm = await open(browser, info, c, 'QCMGR', s.u('qm'), murl.replace(/^https?:\/\/[^/]+/, '')); await qm.page.getByTestId('rmc-approve').click(); await expect(qm.page.getByTestId('rmc-mix-object')).toHaveAttribute('data-status', 'APPROVED'); await noOverflow(qm.page); await shot(qm.page, '5-mix-approved', info);
  await p.goto('/rmc/mix-designs'); await expect(p.getByTestId('rmc-mixes')).toBeVisible(); await noOverflow(p); await shot(p, '6-mix-list', info);
  expect(errors, errors.join('\n')).toEqual([]);
});
