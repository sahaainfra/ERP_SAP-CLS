import { test, expect } from '@playwright/test';
import { menu } from './shell-helpers.js';

// Signed in for real (port 3101, scripts/e2e_iam_server.mjs). Part 03.09, FR-03: a person chooses the grouping of amounts and the hour format in My
// Profile, sees an example of each before saving, and finds the choice kept; "use my company's setting" takes it back. Runs after the other sign-in specs.
test.use({ baseURL: 'http://localhost:3101' });
const PW = 'Excavator-Test-9-Pw'; // secret-scan:allow label text, not a credential
const suf = (info) => (info.project.name === 'desktop' ? 'd' : 'm');

test('FR-03 AC-01 number grouping and hour format: examples, saved per person, back to the company setting', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const errors = [];
  const context = await browser.newContext({ viewport: info.project.use.viewport });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (401|403|404)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByLabel('Username, email or mobile').fill(`format-${suf(info)}`);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
  await (await menu(page)).getByRole('link', { name: 'My Profile' }).click();
  const panel = page.getByTestId('format-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('\u20b9 12,34,56,789.00');
  await expect(panel).toContainText('\u20b9 123,456,789.00');
  await expect(panel).toContainText('14:05');
  await expect(panel).toContainText('2:05 PM');
  await panel.getByLabel(/International grouping/).check();
  await panel.getByLabel(/12-hour/).check();
  await panel.getByRole('button', { name: 'Save format' }).click();
  await expect(page.getByTestId('format-notice')).toContainText('Your format was saved');
  await page.reload();
  await expect(page.getByTestId('format-panel').getByLabel(/International grouping/)).toBeChecked();
  await expect(page.getByTestId('format-panel').getByLabel(/12-hour/)).toBeChecked();
  await page.getByTestId('format-panel').getByLabel(/Use my company's setting \(now Indian/).check();
  await page.getByTestId('format-panel').getByLabel(/Use my company's setting \(now 24-hour/).check();
  await page.getByTestId('format-panel').getByRole('button', { name: 'Save format' }).click();
  await expect(page.getByTestId('format-notice')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
