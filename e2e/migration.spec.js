import { test, expect } from '@playwright/test';
import { pageCode, registeredPages } from './pages.js';

// Development-header mode (port 3100). Part 03.10: the Screen Migration Tracker (FR-06, FR-07, BR-02), and an old address that leads to its page (T-03).
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const as = async (browser, info, company, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
  return page;
};
const params = (page) => page.getByRole('search', { name: 'Report parameters' });
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
async function company(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()).data.id;
}

test('FR-06 FR-07 BR-02 the tracker: progress by module, filters, a defect blocks verification, the owner verifies, the module is signed off, the export', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'the tracker is shared by both viewports, so it is changed once (the phone only reads it, below)');
  test.setTimeout(150_000);
  const c = await company(request, pick(info, 'MGD', 'MGM'));
  const page = await as(browser, info, c, 'ITADM', pick(info, 'e2e-it-d', 'e2e-it-m'), '/admin/migration');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Screen Migration Tracker', level: 1 })).toBeVisible();
  await expect(page.getByTestId('mt-total')).toHaveText(String(registeredPages().length));
  await expect(page.getByTestId('mt-progress')).toContainText('0 verified');
  // the chart is also a table (its own "view as table"), and a bar drills into the list
  await expect(page.locator('svg.ch-svg')).toBeVisible();
  await params(page).getByLabel('Module').selectOption('core');
  await expect(page.getByTestId('mt-row-admin.feature-flags')).toBeVisible();
  await expect(page.getByTestId('mt-row-admin.users')).toHaveCount(0);
  await params(page).getByLabel('Name or address').fill('feature flags');
  await expect(page.getByRole('region', { name: 'Pages' }).locator('tbody tr')).toHaveCount(1);
  // a High defect blocks the verification; resolved, the owner verifies
  await page.getByRole('button', { name: 'Details of Feature Flags' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('A defect found on this page').fill('The toggle does nothing on a phone');
  await d.getByLabel('Severity').selectOption('High');
  await d.getByRole('button', { name: 'Add defect' }).click();
  await expect(page.getByTestId('mt-notice')).toContainText('Defect added');
  await d.getByLabel('Reason or what was checked').fill('Checked with the IT lead on site');
  await d.getByRole('button', { name: 'Change status' }).click();
  await expect(d.getByRole('alert')).toContainText('High or Critical');
  await d.getByLabel(/What was done about P-/).fill('Fixed and checked on a phone');
  await d.getByRole('button', { name: /^Resolve P-/ }).click();
  await expect(page.getByTestId('mt-notice')).toContainText('resolved');
  await d.getByLabel('Reason or what was checked').fill('Checked with the IT lead on site');
  await d.getByRole('button', { name: 'Change status' }).click();
  await expect(page.getByTestId('mt-notice')).toContainText('is now verified');
  await d.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('mt-row-admin.feature-flags')).toContainText('Verified');
  await expect(page.getByTestId('mt-progress')).toContainText('1 verified');
  // sign off the module: the rest of the core pages become verified, in the owner's name
  await params(page).getByLabel('Name or address').fill('');
  await page.getByRole('button', { name: 'Sign off Core platform' }).click();
  await page.getByLabel('What was checked, and with whom').fill('All core pages walked through with the owners');
  await page.getByRole('button', { name: 'Sign off', exact: true }).click();
  await expect(page.getByTestId('mt-notice')).toContainText('page(s) verified');
  await params(page).getByLabel('Status').selectOption('MIGRATED');
  await expect(page.getByTestId('mt-row-admin.users')).toHaveCount(0);
  await params(page).getByLabel('Module').selectOption('iam');
  await expect(page.getByTestId('mt-row-admin.users')).toBeVisible();
  // only pages with open defects, and the totals row follows the filter
  await params(page).getByLabel('Status').selectOption('');
  await params(page).getByLabel('Only pages with open defects').check();
  await expect(page.getByTestId('mt-shown-defects')).not.toHaveText('0');
  // the export is the filtered report
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export XLSX' }).click();
  expect((await download).suggestedFilename()).toBe('screen-migration.xlsx');
  await noOverflow(page);
  expect(errors).toEqual([]);
  // another role: the system administrator reads it but does not own the core pages; the project manager has no access
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys-m', '/admin/migration');
  await sys.getByRole('button', { name: 'Sign off Core platform' }).click();
  await sys.getByLabel('What was checked, and with whom').fill('Trying as a system administrator');
  await sys.getByRole('button', { name: 'Sign off', exact: true }).click();
  await expect(sys.getByRole('dialog').getByRole('alert')).toContainText('Only the owner of the core module');
  const denied = await as(browser, info, c, 'PM', 'e2e-pm-m', '/admin/migration');
  await expect(denied.getByTestId('no-permission')).toBeVisible();
});

test('T-03 FR-04 an old address leads to its page with its query and fragment, after another administrator approves it; an unknown address goes Home', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const c = await company(request, pick(info, 'RDD', 'RDM'));
  const code = pageCode('/admin/users');
  const list = await request.get('/api/v1/ui/page-migration', { headers: H('SYSADM', c, 'e2e-sys-1') });
  const row = (await list.json()).data.rows.find((r) => r.code === code);
  const old = `/admin/people-${pick(info, 'd', 'm')}`;
  const asked = await request.post(`/api/v1/ui/page-migration/${code}/route`, { headers: H('SYSADM', c, 'e2e-sys-1'), data: { oldRoute: old, reason: 'The old address is in bookmarks', version: row.version } });
  expect(asked.status(), await asked.text()).toBe(201);
  // the tracker shows it waiting; the second administrator approves it on the page
  const first = await as(browser, info, c, 'SYSADM', 'e2e-sys-1', '/admin/migration');
  await expect(first.getByRole('table', { name: 'Old addresses waiting for approval' })).toContainText('Waiting for another administrator');
  const second = await as(browser, info, c, 'SYSADM', 'e2e-sys-2', '/admin/migration');
  const pending = second.getByRole('table', { name: 'Old addresses waiting for approval' });
  await pending.getByRole('button', { name: 'Approve' }).click();
  await expect(pending).toHaveCount(0);
  // a bookmark of the old address
  const visitor = await as(browser, info, c, 'SYSADM', 'e2e-sys-3', `${old}?q=e2e#top`);
  await expect(visitor.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  expect(new URL(visitor.url()).pathname).toBe('/admin/users');
  expect(new URL(visitor.url()).search).toBe('?q=e2e');
  await expect(second.getByTestId('mt-row-admin.users')).toBeVisible();
  // an address nobody registered: Home, as before
  const lost = await as(browser, info, c, 'SYSADM', 'e2e-sys-3', '/admin/never-existed');
  await expect(lost.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  expect(new URL(lost.url()).pathname).toBe('/home');
});

test('FR-06 the tracker on a phone: progress, chart, filters and the table fit the screen and open a page\'s details', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the desktop run changes the tracker; this is the phone\'s look at it');
  const c = await company(request, 'MGP');
  const page = await as(browser, info, c, 'ITADM', 'e2e-it-p', '/admin/migration');
  await expect(page.getByTestId('mt-total')).toHaveText(String(registeredPages().length));
  await expect(page.locator('svg.ch-svg')).toBeVisible();
  await params(page).getByLabel('Module').selectOption('ui');
  await page.getByRole('button', { name: 'Details of Home' }).click();
  await expect(page.getByRole('dialog')).toContainText('home');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await noOverflow(page);
});
