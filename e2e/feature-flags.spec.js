import { test, expect } from '@playwright/test';

// The database is shared by both viewport projects (run in order), so each test uses its own scope.
const identity = (roles, company = '1', user = 'e2e-user') => ({ user, roles, company });

async function open(page, id) {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), id);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  return errors;
}

test('SYSADM sees the flags, toggles one with a reason and the page chip reacts at once', async ({ page }, info) => {
  const company = info.project.name === 'desktop' ? '21' : '22';
  const errors = await open(page, identity('SYSADM', company));
  await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
  await expect(page).toHaveTitle(/Feature Flags/);
  const chip = page.getByTestId('page-flag-chip');
  await expect(chip).toContainText('ON'); // environment default in test
  await page.getByRole('button', { name: 'Add override' }).click();
  const add = page.getByRole('dialog', { name: 'Add a flag override' });
  await add.locator('select[name=key]').selectOption('ff.prog.p0002');
  await add.locator('select[name=level]').selectOption('company');
  await add.locator('input[name=companyId]').fill(company);
  await add.getByLabel(/Reason/).fill('turn off for this company');
  await add.getByRole('button', { name: 'Save override' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await expect(chip).toContainText('OFF'); // scoped users see the change immediately (AC-02)
  // refresh: the change persisted
  await page.reload();
  await expect(page.getByTestId('page-flag-chip')).toContainText('OFF');
  // toggle it back via the switch
  await page.getByRole('switch', { name: new RegExp(`ff.prog.p0002 Company ${company}: OFF`) }).click();
  const toggle = page.getByRole('dialog', { name: /Turn ON ff.prog.p0002/ });
  await toggle.getByLabel(/Reason/).fill('back on after pilot');
  await toggle.getByRole('button', { name: 'Confirm change' }).click();
  await expect(page.getByTestId('page-flag-chip')).toContainText('ON');
  expect(errors).toEqual([]);
});

test('a too-short reason is blocked and the dialog can be cancelled', async ({ page }) => {
  await open(page, identity('SYSADM', '31'));
  await page.getByRole('switch').first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/Reason/).fill('abcd'); // below the 5 character minimum; browser validation blocks submit
  await dlg.getByRole('button', { name: 'Confirm change' }).click();
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('ITADM can view but the toggles are disabled with a reason', async ({ page }) => {
  await open(page, identity('ITADM', '41'));
  await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
  await expect(page.getByRole('switch').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add override' })).toBeDisabled();
});

test('a role without access sees the no-permission state', async ({ page }) => {
  await open(page, identity('PM', '51'));
  await expect(page.getByRole('heading', { name: 'You do not have access to feature flags' })).toBeVisible();
});

test('search narrows the list and shows an empty state with a clear action', async ({ page }) => {
  await open(page, identity('SYSADM', '61'));
  await page.getByPlaceholder('Search key or description').fill('zzz-no-such-flag');
  await expect(page.getByRole('heading', { name: 'No flags match' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('switch').first()).toBeVisible();
});

test('a server failure shows the error state with a correlation id and retry', async ({ page }) => {
  await open(page, identity('SYSADM', '71'));
  await page.route('**/api/v1/core/feature-flags?*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.', details: [], correlationId: 'corr-12345678' } }) }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Could not load the feature flags' })).toBeVisible();
  await expect(page.getByText('corr-12345678')).toBeVisible();
  await page.unroute('**/api/v1/core/feature-flags?*');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('switch').first()).toBeVisible();
});

test('CSV export downloads a file', async ({ page }) => {
  await open(page, identity('SYSADM', '81'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('feature-flags.csv');
});

test('no horizontal page scroll and themes apply', async ({ page }) => {
  await open(page, identity('SYSADM', '91'));
  await expect(page.getByRole('switch').first()).toBeVisible();
  // Wider fonts (as on Linux runners) must not cause sideways scrolling either.
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const theme of ['dark', 'high-contrast']) {
    await page.getByLabel('Theme').selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
});
