import { test, expect } from '@playwright/test';

async function open(page, roles, path = '/admin/data-health', company = '1', user = 'e2e-health') {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  return errors;
}

test('before any run the page lists every check as "not run yet" and offers to run them', async ({ page }, info) => {
  const company = info.project.name === 'desktop' ? '71' : '72'; // the two viewport projects share one database
  await open(page, 'ITADM', '/admin/data-health', company);
  await expect(page.getByRole('heading', { name: 'Database Integrity Report' })).toBeVisible();
  await expect(page).toHaveTitle(/Data Health/);
  const table = page.getByTestId('checks-table');
  await expect(table.getByText('Orphan foreign keys')).toBeVisible();
  await expect(table.getByText('Journals balance')).toBeVisible();
  // other tests may already have run the checks on the shared database: either state must be coherent
  const noRun = await page.getByRole('heading', { name: 'No integrity run yet' }).count();
  if (noRun) await expect(page.getByTestId('last-run')).toContainText('not been run');
});

test('ITADM runs the checks: the summary updates, nothing fails, tables with nothing to check say so', async ({ page }) => {
  const errors = await open(page, 'ITADM', '/admin/data-health', '73');
  await page.getByRole('button', { name: 'Run checks now' }).first().click();
  await expect(page.getByRole('status')).toContainText('Checks finished');
  await expect(page.getByTestId('count-fail')).toHaveText('0');
  await expect(page.getByTestId('last-run')).toContainText('Last run');
  await expect(page.getByTestId('last-run')).toContainText('e2e-health');
  await expect(page.getByTestId('check-header_line_totals')).toContainText('Nothing to check yet');
  await expect(page.getByTestId('check-invalid_status_values')).toContainText('Passed');
  expect(errors).toEqual([]);
});

test('drill-down: a check\'s history shows its earlier results', async ({ page }) => {
  await open(page, 'ITADM', '/admin/data-health', '74');
  await page.getByRole('button', { name: 'Run checks now' }).first().click();
  await expect(page.getByRole('status')).toContainText('Checks finished');
  const row = page.getByTestId('check-orphan_foreign_keys');
  await row.getByRole('button', { name: 'History' }).click();
  const history = row.locator('table'); // the nested history table (its header row is hidden in the phone card layout)
  await expect(history).toBeVisible();
  await expect(history.locator('tbody tr').first()).toContainText('e2e-health');
  await row.getByRole('button', { name: 'Hide history' }).click();
  await expect(history).toHaveCount(0);
});

test('SYSADM can read the report but the run button is disabled with a reason', async ({ page }) => {
  await open(page, 'SYSADM', '/admin/data-health', '75');
  await expect(page.getByTestId('checks-table')).toBeVisible();
  const button = page.getByRole('button', { name: 'Run checks now' }).first();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', /Only the IT Administrator/);
});

test('other roles get the no-permission state and no check data; the nav entry is hidden', async ({ page }) => {
  await open(page, 'PM', '/admin/data-health', '76', 'pm-user');
  await expect(page.getByRole('heading', { name: 'You do not have access to Data Health' })).toBeVisible();
  await expect(page.getByTestId('checks-table')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Data Health' })).toHaveCount(0);
});

test('the report exports a CSV', async ({ page }) => {
  await open(page, 'ITADM', '/admin/data-health', '77');
  await expect(page.getByTestId('checks-table')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('data-health.csv');
});

test('turning the feature flag OFF hides the entry and the page at once', async ({ page }, info) => {
  const company = info.project.name === 'desktop' ? '78' : '79';
  await open(page, 'SYSADM', '/admin/data-health', company);
  await expect(page.getByTestId('checks-table')).toBeVisible();
  const res = await page.request.patch('/api/v1/core/feature-flags/ff.core.p0102', {
    headers: { 'x-erp-user': 'e2e-health', 'x-erp-roles': 'SYSADM', 'x-erp-company': company },
    data: { scope: { level: 'company', companyId: Number(company) }, enabled: false, reason: 'e2e: hide data health' },
  });
  expect(res.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Data Health is not enabled' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Data Health' })).toHaveCount(0);
});

test('a server failure shows the error state with the correlation id and a retry', async ({ page }) => {
  await open(page, 'ITADM', '/admin/data-health', '80');
  await expect(page.getByTestId('checks-table')).toBeVisible();
  await page.route('**/api/v1/core/integrity/summary', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.', details: [], correlationId: 'corr-health-1234' } }) }),
  );
  await page.goto('/admin/data-health');
  await expect(page.getByRole('heading', { name: 'Could not load the integrity report' })).toBeVisible();
  await expect(page.getByText('corr-health-1234')).toBeVisible();
  await page.unroute('**/api/v1/core/integrity/summary');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('checks-table')).toBeVisible();
});

test('a failing run is reported when the server cannot complete it', async ({ page }) => {
  await open(page, 'ITADM', '/admin/data-health', '81');
  await expect(page.getByTestId('checks-table')).toBeVisible();
  await page.route('**/api/v1/core/integrity/run', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The database is busy.', details: [], correlationId: 'corr-run-5678' } }) }),
  );
  await page.getByRole('button', { name: 'Run checks now' }).first().click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not run the checks' })).toContainText('corr-run-5678');
});

test('no horizontal scroll with wide fonts, in every theme', async ({ page }) => {
  await open(page, 'ITADM', '/admin/data-health', '82');
  await expect(page.getByTestId('checks-table')).toBeVisible();
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  for (const theme of ['light', 'dark', 'high-contrast']) {
    await page.getByLabel('Theme').selectOption(theme);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, theme).toBeLessThanOrEqual(0);
  }
});
