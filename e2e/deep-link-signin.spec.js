import { test, expect } from '@playwright/test';

// PACK-07: a link into the application opened while signed out (a bookmark, a link in an e-mail or a message) opens that page, with
// its query, once the person has signed in. Runs against the API in sign-in mode (AUTH_MODE=iam, port 3101,
// scripts/e2e_iam_server.mjs); desktop and mobile use their own seeded person (pmx-d, pmx-m).
test.use({ baseURL: 'http://localhost:3101' });

const PW = 'Excavator-Test-9-Pw';

test('PACK-07 a deep link survives the sign-in: the page and its query open after signing in', async ({ page }, info) => {
  const user = info.project.name === 'desktop' ? 'pmx-d' : 'pmx-m';
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/approvals?tab=mine&q=footing');
  // signed out: the sign-in form is shown at the same address
  await expect(page.getByLabel('Username, email or mobile')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/approvals');
  await page.getByLabel('Username, email or mobile').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // signed in: the same page, with its query, not the start page
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByLabel('Username, email or mobile')).toHaveCount(0);
  const url = new URL(page.url());
  expect(url.pathname).toBe('/approvals');
  expect(url.searchParams.get('tab')).toBe('mine');
  expect(url.searchParams.get('q')).toBe('footing');
  expect(errors).toEqual([]);
});
