import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

// PACK-12 (ff.charts.pack12) on a real page: the Page Patterns gallery draws line and bar charts with sample data. Every chart's accessible
// summary says what it shows; "View as table" builds its rows when opened and has every category; axe (WCAG 2.1 A/AA) passes on each chart.
// Screenshots at 1366 px (desktop project) and 360 px (mobile project) go to pack-reports/pack12-shots (not tracked).
// The 5,000-point S-curve is timed by pack-reports/tools/chart_perf.mjs on the same Chart component.
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const SHOTS = 'pack-reports/pack12-shots';
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });

test('PACK-12 charts on a real page: a summary that says what they show, a table built when opened, axe clean; 360 and 1366 screenshots', async ({ browser, request }, info) => {
  const phone = info.project.name === 'mobile';
  const code = phone ? 'CHPM' : 'CHPD';
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const c = (await res.json()).data.id;
  for (const key of ['ff.charts.pack12', 'ff.ui.p16602']) {
    const f = await request.patch(`/api/v1/core/feature-flags/${key}`, { headers: H('SYSADM', c, 'e2e-setup'), data: { scope: { level: 'company', companyId: c }, enabled: true, reason: 'e2e: PACK-12' } });
    expect(f.status(), `${key}: ${await f.text()}`).toBe(200);
  }
  const viewport = phone ? { width: 360, height: 740 } : { width: 1366, height: 800 };
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport, hasTouch: phone });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: `e2e-charts-${code}`, roles: 'SYSADM', company: String(c) });
  await page.goto('/admin/design-system/patterns');
  const charts = page.locator('figure.ch:not(.ch-empty)');
  await expect(charts.first()).toBeVisible();
  const n = await charts.count();
  expect(n).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(400); // the flag is read; the summary is drawn with it
  await page.evaluate(AXE);
  for (let i = 0; i < n; i += 1) {
    const fig = charts.nth(i);
    const title = await fig.locator('svg > title').textContent();
    expect(title, `chart ${i + 1} summary`).toMatch(/\d+ points from .+ to .+\. .+: .+ at the start, .+ at the end, highest .+ at .+\./);
    // the table is built only when opened, then has a row per category
    expect(await fig.locator('tbody tr').count()).toBe(0);
    await fig.locator('details.ch-table > summary').click();
    await expect.poll(() => fig.locator('tbody tr').count(), { message: `chart ${i + 1} table rows` }).toBeGreaterThan(0);
    const rows = await fig.locator('tbody tr').count();
    const firstPoints = Number(title.match(/^[^.]+\. (\d[\d,]*) points/)[1].replace(/,/g, ''));
    expect(rows).toBe(firstPoints);
    const ax = await page.evaluate((k) => window.axe.run(document.querySelectorAll('figure.ch:not(.ch-empty)')[k], { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }), i);
    expect(ax.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`), `axe, chart ${i + 1}`).toEqual([]);
    await fig.locator('details.ch-table > summary').click(); // close again for the screenshot
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll').toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await charts.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/patterns-${viewport.width}.png`, fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
