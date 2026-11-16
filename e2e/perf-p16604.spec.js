import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Development-header mode (port 3100). The design-system pages are the system administrator's. Part 166.4 in the browser (ff.perf.p16604 is ON in test):
//  FR-01 a page's code is fetched when the page is opened, not with the first download; the field home fetches the bottom bar's pages once idle;
//        a page whose code cannot be fetched says so and offers to try again;
//  FR-03 low-bandwidth mode draws charts as their tables;
//  FR-04 reloading into a new version saves the open form's draft first.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const open = async (page, { user, roles, company = '1', path, lowbw = false, context = null }) => {
  await page.addInitScript(([v, low, c]) => {
    if (sessionStorage.getItem('erp.test.identity-set')) return;
    localStorage.setItem('erp.dev.identity', JSON.stringify(v));
    localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' }));
    if (low) localStorage.setItem('erp.lowbw', 'on');
    if (c) localStorage.setItem('erp.context', JSON.stringify(c));
    sessionStorage.setItem('erp.test.identity-set', '1');
  }, [{ user, roles, company: String(company) }, lowbw, context]);
  await page.goto(path);
};
/** The scripts the page asked the server for, by file name. */
const scripts = (page) => {
  const seen = [];
  page.on('request', (r) => { const m = /\/assets\/([^/?]+\.js)/.exec(r.url()); if (m) seen.push(m[1]); });
  return seen;
};
const goInApp = (page, to) => page.evaluate((url) => { window.history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
const SHOTS = 'docs/erp/screenshots/166.4';
const shot = (page, info, name) => page.screenshot({ path: `${SHOTS}/after-${name}-${info.project.name}.png`, fullPage: false });
function errorsOf(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

// a page's request answered by the service worker is not seen (nor routed) by the page: these tests watch the network, so no worker
test.describe('the network of a page', () => {
  test.use({ serviceWorkers: 'block' });

test('FR-01 T-03 the first screen fetches the shell and its own page only; another page\'s code comes when it is opened', async ({ page }) => {
  const seen = scripts(page);
  const errors = errorsOf(page);
  await open(page, { user: 'e2e-perf-admin', roles: 'SYSADM', path: '/home' });
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  expect(seen.some((f) => /^LaunchpadPage-/.test(f)), 'the home page\'s own code').toBe(true);
  for (const other of ['ProjectsPage-', 'GanttPage-', 'DprEntryPage-', 'PagePatternsPage-']) expect(seen.some((f) => f.startsWith(other)), `${other} is not fetched for Home`).toBe(false);
  expect(seen.some((f) => /^hi-|^te-/.test(f)), 'an English screen fetches no Hindi or Telugu text').toBe(false);
  await goInApp(page, '/admin/design-system/patterns');
  await expect(page.getByRole('heading', { name: 'Page Patterns', level: 1 })).toBeVisible();
  expect(seen.some((f) => f.startsWith('PagePatternsPage-')), 'fetched when opened').toBe(true);
  expect(errors).toEqual([]);
});

test('FR-01 a page whose code cannot be fetched says so; a reload opens it', async ({ page }, info) => {
  const errors = errorsOf(page);
  await open(page, { user: 'e2e-perf-admin2', roles: 'SYSADM', path: '/home' });
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await page.route(/\/assets\/PagePatternsPage-[^/]+\.js$/, (route) => route.abort('internetdisconnected'));
  await goInApp(page, '/admin/design-system/patterns');
  const failed = page.getByTestId('page-load-failed');
  await expect(failed).toBeVisible();
  await expect(failed.getByRole('heading', { name: 'This page could not be opened', level: 1 })).toBeVisible();
  await expect(failed).toContainText('A newer version may have been released');
  await shot(page, info, 'page-load-failed');
  await page.unroute(/\/assets\/PagePatternsPage-[^/]+\.js$/);
  await failed.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('heading', { name: 'Page Patterns', level: 1 })).toBeVisible();
  await expect(page.getByTestId('page-load-failed')).toHaveCount(0);
  expect(errors.filter((e) => !/PagePatternsPage|dynamically imported module|Importing a module script/.test(e))).toEqual([]);
});

test('FR-01 on a phone the field home fetches the code of the bottom bar\'s pages once it is idle, before they are tapped', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'the bottom bar is the phone\'s');
  const seen = scripts(page);
  await open(page, { user: 'e2e-perf-se', roles: 'SE', path: '/field' });
  await expect(page.getByTestId('bottom-nav')).toBeVisible();
  await expect.poll(() => seen.some((f) => f.startsWith('ScannerPage-')), { timeout: 10_000, message: 'the Scan page is fetched without a tap' }).toBe(true);
  const before = seen.length;
  await page.getByTestId('bottom-scan').click();
  await expect(page.getByRole('heading', { name: 'Scan', level: 1 })).toBeVisible();
  expect(seen.slice(before).filter((f) => f.startsWith('ScannerPage-'))).toEqual([]); // already here: the tap fetches nothing for the page
});

test('FR-03 in low-bandwidth mode a chart is drawn as its table, and the chart only on request', async ({ page }, info) => {
  await open(page, { user: 'e2e-perf-lb', roles: 'SYSADM', path: '/admin/design-system/patterns', lowbw: true });
  await expect(page.getByRole('heading', { name: 'Page Patterns', level: 1 })).toBeVisible();
  const tables = page.getByTestId('chart-as-table');
  await expect(tables.first()).toBeVisible();
  expect(await tables.count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('figure.ch svg.ch-svg')).toHaveCount(0);
  await expect(tables.first().getByRole('table')).toBeVisible();
  await expect(tables.first()).toContainText('Shown as a table to save data.');
  await tables.first().scrollIntoViewIfNeeded();
  await shot(page, info, 'chart-as-table');
  await tables.first().getByRole('button', { name: 'Draw the chart' }).click();
  await expect(page.locator('figure.ch svg.ch-svg')).toHaveCount(1);
  // the same page without the mode draws the charts
  await page.evaluate(() => localStorage.setItem('erp.lowbw', 'off'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Page Patterns', level: 1 })).toBeVisible();
  await expect(page.getByTestId('chart-as-table')).toHaveCount(0);
  expect(await page.locator('figure.ch svg.ch-svg').count()).toBeGreaterThanOrEqual(2);
});

});

test('FR-04 "A new version is ready — Reload": the half-filled form is saved as a draft first and offered back after the reload', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough: the worker file is shared');
  test.setTimeout(120_000);
  const code = 'PF4D';
  const post = async (path, roles, company, data) => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, 'e2e-setup'), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const current = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup') });
  const version = current.ok() ? (await current.json()).data?.version : undefined;
  await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } });
  await post('/core/financial-years', 'SYSADM', company, { startDate: '2026-04-01' });
  const project = await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Flyover package', type: 'BRIDGE' });
  const site = await post('/iam/org/sites', 'PM', company, { code: `${code}S`, name: 'Pier yard', projectId: project.id });

  await open(page, { user: 'e2e-perf-draft', roles: 'PM', company, path: '/admin/sample-requests?new=1', context: { projectId: project.id, siteId: site.id } });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true);
  await page.locator('#f-title').fill('Bearings for pier P7');
  const file = join('dist', 'sw.js');
  const real = readFileSync(file, 'utf8');
  writeFileSync(file, `${real}\n// a newer build\n`);
  try {
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    const banner = page.getByTestId('pwa-update');
    await expect(banner).toContainText('A new version is ready');
    await expect(banner).toContainText('is kept as a draft first');
    await shot(page, info, 'update-banner');
    await page.locator('#f-title').focus(); // still typing: nothing has been saved by leaving the field
    await page.getByRole('button', { name: 'Reload now' }).click();
    await expect(page.getByTestId('draft-banner')).toContainText('Bearings for pier P7', { timeout: 20_000 });
    await expect(page.getByTestId('pwa-update')).toHaveCount(0);
  } finally {
    writeFileSync(file, real);
  }
});
