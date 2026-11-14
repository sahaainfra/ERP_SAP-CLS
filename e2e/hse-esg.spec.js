import { test, expect } from '@playwright/test';
import { api, company, noOverflow, open, watch, world } from './hse-helpers.js';

// Part 19.05 in the browser: the HSE engineer enters the month's data; a factor is made and activated by the HSE officer; the carbon report and the dashboard show the emissions; waste and consents are recorded. Desktop and mobile.
const OUT = 'docs/erp/screenshots/hse-esg';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
test('ESG: monthly data, factor maker-checker, carbon report, waste, consents, dashboard', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const t = `e${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['he', 'HSEE'], ['ho', 'HSEO'], ['pm', 'PM']]);
  const he = await open(browser, info, c, 'HSEE', s.u('he'), '/hse/esg-entry'); const p = he.page; const errors = watch(p);
  await expect(p.getByTestId('hse-esg-entry')).toBeVisible(); await p.getByTestId('hse-project').selectOption(String(s.A)); await p.getByTestId('hse-site').selectOption(String(s.site)); await p.getByTestId('hse-esg-v-ELECTRICITY').fill('10000'); await p.getByTestId('hse-esg-v-FUEL_DIESEL').fill('500'); await p.getByTestId('hse-esg-v-NOISE_DAY').fill('82'); await noOverflow(p); await shot(p, '1-entry', info);
  await p.getByTestId('hse-esg-save').click();  await expect(p.getByTestId('hse-esg-note')).toBeVisible();
  await p.goto('/hse/emission-factors'); await p.getByText('New factor version').click(); await p.getByTestId('hse-factor-metric').selectOption('ELECTRICITY'); await p.getByTestId('hse-factor-value').fill('0.82'); await p.getByTestId('hse-factor-unit').fill('kgCO2e/kWh'); await p.getByTestId('hse-factor-source').fill('CEA CO2 baseline database'); await p.getByTestId('hse-factor-save').click(); await expect(p.getByTestId('hse-factor-note')).toBeVisible();
  await api(request, c, 'HSEE', s.u('he'), 'post', '/hse/esg/factors', { metric: 'FUEL_DIESEL', scope: 1, factor: 2.68, unit: 'kgCO2e/litre', source: 'IPCC 2006', effectiveFrom: '2020-01-01' });
  const ho = await open(browser, info, c, 'HSEO', s.u('ho'), '/hse/emission-factors'); const h = ho.page; await expect(h.getByTestId('hse-factors')).toBeVisible(); const facs = await api(request, c, 'HSEO', s.u('ho'), 'get', '/hse/esg/factors'); for (const f of facs.data ?? facs) await api(request, c, 'HSEO', s.u('ho'), 'post', `/hse/esg/factors/${f.id}/activate`, {}); await h.reload();
  await noOverflow(h); await shot(h, '2-factors', info);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/hse/carbon'); const m = pm.page; await expect(m.getByTestId('hse-carbon-table')).toBeVisible(); await expect(m.getByTestId('hse-carbon-total')).toContainText('9.54'); await noOverflow(m); await shot(m, '3-carbon', info); const dl = m.waitForEvent('download'); await m.getByTestId('hse-carbon-csv').click(); expect((await dl).suggestedFilename()).toContain('carbon');
  await p.goto('/hse/waste'); await p.getByText('Record waste').click(); await p.getByTestId('hse-project').selectOption(String(s.A)); await p.getByTestId('hse-site').selectOption(String(s.site)); await p.getByTestId('hse-waste-qty').fill('1500'); await p.getByTestId('hse-waste-save').click(); await expect(p.getByTestId('hse-waste-note')).toBeVisible(); await noOverflow(p); await shot(p, '4-waste', info);
  await p.goto('/hse/consents'); await p.getByText('Record a consent').click(); await p.getByTestId('hse-project').selectOption(String(s.A)); await p.getByTestId('hse-consent-no').fill('CTE/2026/118'); await p.getByTestId('hse-consent-authority').fill('State Pollution Control Board'); await p.getByTestId('hse-consent-until').fill(`${today().slice(0, 4)}-12-31`); await p.getByTestId('hse-consent-save').click(); await expect(p.getByTestId('hse-consent-note')).toBeVisible(); await noOverflow(p);
  await m.goto('/hse/esg'); await expect(m.getByTestId('hse-esg-dashboard')).toBeVisible(); await expect(m.getByTestId('hse-esg-t-elec')).toContainText('10,000'); await expect(m.getByTestId('hse-esg-breaches')).toBeVisible(); await noOverflow(m); await shot(m, '5-dashboard', info);
  expect(errors, errors.join('\n')).toEqual([]);
});
