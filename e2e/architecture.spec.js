import { test, expect } from '@playwright/test';

async function open(page, roles, path = '/admin/architecture', company = '1') {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'e2e-arch', roles, company });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  return errors;
}

test('administrators read the guide: sections, module map, error codes and the pagination contract', async ({ page }) => {
  const errors = await open(page, 'ITADM');
  await expect(page.getByRole('heading', { name: 'Architecture & API Conventions Guide' })).toBeVisible();
  await expect(page).toHaveTitle(/Architecture/);
  await expect(page.getByRole('heading', { name: '1. Layers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '4. Request pipeline' })).toBeVisible();
  await expect(page.getByTestId('modules-table').getByText('Reference implementation')).toBeVisible();
  await expect(page.getByTestId('error-codes-table').getByText('VERSION_CONFLICT')).toBeVisible();
  await expect(page.getByText('Maximum page size')).toContainText('200');
  expect(errors).toEqual([]);
});

test('the error-code table filters, shows an empty state and exports a CSV', async ({ page }) => {
  await open(page, 'SYSADM');
  const table = page.getByTestId('error-codes-table');
  await expect(table.getByText('INTERNAL_ERROR')).toBeVisible();
  await page.getByPlaceholder('Filter by code, status or text').fill('409');
  await expect(table.getByText('VERSION_CONFLICT')).toBeVisible();
  await expect(table.getByText('INTERNAL_ERROR')).toHaveCount(0);
  await page.getByPlaceholder('Filter by code, status or text').fill('zzz-none');
  await expect(page.getByRole('heading', { name: 'No error code matches' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('error-codes.csv');
});

test('the table of contents links jump to a section', async ({ page }) => {
  await open(page, 'SYSADM');
  await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: '8. Health' }).click();
  await expect(page).toHaveURL(/#8-health$/);
  await expect(page.getByRole('heading', { name: '8. Health' })).toBeInViewport();
});

test('other roles get the no-permission state', async ({ page }) => {
  await open(page, 'PM');
  await expect(page.getByRole('heading', { name: 'You do not have access to the architecture guide' })).toBeVisible();
  await expect(page.getByTestId('modules-table')).toHaveCount(0);
});

test('navigation shows Architecture for administrators and hides it from other roles', async ({ page }) => {
  await open(page, 'SYSADM', '/admin/feature-flags');
  await expect(page.getByRole('link', { name: 'Architecture' })).toBeVisible();
  await page.getByRole('link', { name: 'Architecture' }).click();
  await expect(page).toHaveURL(/\/admin\/architecture$/);
  const pm = await page.context().newPage();
  await pm.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'pm', roles: 'PM', company: '1' });
  await pm.goto('/admin/feature-flags');
  await expect(pm.getByRole('heading', { name: 'You do not have access to feature flags' })).toBeVisible();
  await expect(pm.getByRole('link', { name: 'Architecture' })).toHaveCount(0);
  await expect(pm.getByRole('link', { name: 'About' })).toHaveCount(0);
});

test('turning the feature flag OFF for the company hides the entry and the guide at once', async ({ page }, info) => {
  // Both viewport projects share one database, so each uses its own company.
  const company = info.project.name === 'desktop' ? '41' : '42';
  await open(page, 'SYSADM', '/admin/architecture', company);
  await expect(page.getByRole('heading', { name: '1. Layers' })).toBeVisible();
  const res = await page.request.patch('/api/v1/core/feature-flags/ff.core.p0101', {
    headers: { 'x-erp-user': 'e2e-arch', 'x-erp-roles': 'SYSADM', 'x-erp-company': company },
    data: { scope: { level: 'company', companyId: Number(company) }, enabled: false, reason: 'e2e: hide the guide' },
  });
  expect(res.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The architecture guide is not enabled' })).toBeVisible();
  await expect(page.getByText('ff.core.p0101 is OFF')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Architecture' })).toHaveCount(0);
});

test('a server failure shows an error with the correlation id and a retry', async ({ page }) => {
  await open(page, 'SYSADM', '/admin/architecture', '51');
  await expect(page.getByRole('heading', { name: '1. Layers' })).toBeVisible();
  await page.route('**/api/v1/core/architecture', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.', details: [], correlationId: 'corr-arch-1234' } }) }),
  );
  await page.goto('/admin/architecture');
  await expect(page.getByRole('heading', { name: 'Could not load the architecture guide' })).toBeVisible();
  await expect(page.getByText('corr-arch-1234')).toBeVisible();
  await page.unroute('**/api/v1/core/architecture');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: '1. Layers' })).toBeVisible();
});

test('no horizontal scroll with wide fonts, in every theme', async ({ page }) => {
  await open(page, 'SYSADM', '/admin/architecture', '61');
  await expect(page.getByRole('heading', { name: '1. Layers' })).toBeVisible();
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  for (const theme of ['light', 'dark', 'high-contrast']) {
    await page.getByLabel('Theme').selectOption(theme);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, theme).toBeLessThanOrEqual(0);
  }
});
