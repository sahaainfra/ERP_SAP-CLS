import { test, expect } from '@playwright/test';

// T-02 signed in for real (port 3101, scripts/e2e_iam_server.mjs): a person sets their appearance in My Profile on one device and
// finds it on another after signing in there. Runs last: sign-in is limited per minute and per address.
test.use({ baseURL: 'http://localhost:3101' });
test.describe.configure({ mode: 'serial' });

const PW = 'Excavator-Test-9-Pw'; // secret-scan:allow label text, not a credential
const suf = (info) => (info.project.name === 'desktop' ? 'd' : 'm');

async function signIn(page, username) {
  await page.goto('/');
  await page.getByLabel('Username, email or mobile').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
}

test('T-02 appearance chosen in My Profile applies at once and follows the person to another device', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const user = `appear-${suf(info)}`;
  const errors = [];
  const a = await browser.newContext({ viewport: info.project.use.viewport });
  const page = await a.newPage();
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (401|403|404)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await signIn(page, user);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My Profile' }).click();
  const look = page.getByTestId('appearance');
  await expect(look.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await expect(look.getByRole('button', { name: 'Save appearance' })).toBeEnabled(); // nothing is saved yet, so the current look can be kept
  await look.getByLabel('High contrast').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  await look.getByRole('radio', { name: /^Compact/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await look.locator('select[name=appearance-language]').selectOption('hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await look.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'high-contrast');
  await look.getByLabel('High contrast').check();
  await look.getByRole('radio', { name: /^Compact/ }).check();
  await look.getByRole('button', { name: 'Save appearance' }).click();
  await expect(page.getByTestId('appearance-notice')).toContainText('every device');
  expect(errors).toEqual([]);
  await a.close();

  const b = await browser.newContext({ viewport: info.project.use.viewport });
  const other = await b.newPage();
  await signIn(other, user);
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  await expect(other.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(other.getByLabel('Theme')).toHaveValue('high-contrast');
  expect(await other.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await b.close();
});
