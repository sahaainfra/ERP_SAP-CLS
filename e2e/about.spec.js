import { test, expect } from '@playwright/test';
import { menu } from './shell-helpers.js';

async function open(page, roles, path = '/admin/about', company = '1') {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'e2e-about', roles, company });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  return errors;
}

test('administrators see version, build, commit, environment and applied migrations', async ({ page }) => {
  const errors = await open(page, 'SYSADM');
  await expect(page.getByRole('heading', { name: 'About & Build Information' })).toBeVisible();
  await expect(page).toHaveTitle(/About/);
  await expect(page.getByTestId('about-version')).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(page.getByTestId('about-build')).toHaveText('dev');
  await expect(page.getByText(/Migrations applied \(\d+\)/)).toBeVisible();
  await expect(page.getByText('20261030000004_seed_flag_p0003')).toBeVisible();
  expect(errors).toEqual([]);
});

test('IT administrators can view it too', async ({ page }) => {
  await open(page, 'ITADM');
  await expect(page.getByTestId('about-build')).toBeVisible();
});

test('other roles get the no-permission state and no build data', async ({ page }) => {
  await open(page, 'PM');
  await expect(page.getByTestId('no-permission')).toBeVisible();
  await expect(page.getByTestId('about-build')).toHaveCount(0);
});

test('the shell navigation moves between Feature Flags and About without a reload', async ({ page }) => {
  await open(page, 'SYSADM', '/admin/feature-flags');
  await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
  await (await menu(page)).getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/about$/);
  await expect(page.getByTestId('about-build')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
});

test('the build ID never appears on the business-facing flags page', async ({ page }) => {
  await open(page, 'SYSADM', '/admin/feature-flags');
  await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
  await expect(page.getByTestId('about-build')).toHaveCount(0);
});

test('no horizontal scroll and the migrations table adapts on a phone', async ({ page }) => {
  await open(page, 'SYSADM');
  await expect(page.getByTestId('about-build')).toBeVisible();
  // Wider fonts (as on Linux runners) must not cause sideways scrolling either.
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
