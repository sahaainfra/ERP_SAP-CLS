import { test, expect } from '@playwright/test';
import { menu } from './shell-helpers.js';

const sizes = [[320, 640], [360, 740], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]];
const fits = (page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

for (const [width, height] of sizes) {
  test(`responsive navigation, line grid and photo dialog at ${width}x${height}`, async ({ page }, info) => {
    test.skip(info.project.name !== (width < 768 ? 'mobile' : 'desktop'));
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'layout-review', roles: 'SYSADM', company: '1' })));
    await page.goto('/field');
    await expect(page.getByTestId('field-band')).toBeVisible();
    await fits(page);
    const nav = await menu(page);
    await nav.getByRole('link', { name: 'Scan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Scan', level: 1 })).toBeVisible();
    await fits(page);
    await page.goto('/admin/design-system/forms');
    const search = page.getByRole('searchbox', { name: 'Find a component' });
    await search.fill('unknown component');
    await expect(page.getByRole('heading', { name: /No component matches/ })).toBeVisible();
    await search.fill('Photo');
    const grid = page.locator('.ff-gridwrap');
    if (width <= 768) {
      await grid.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      expect(await grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
    const field = page.locator('.ff-photo').first();
    await field.locator('input').setInputFiles('public/icons/icon-512.png');
    const open = field.getByRole('button', { name: /View photo/ });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Photo for Photo' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.getByRole('img').boundingBox();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    if ([320, 390, 1024].includes(width)) {
      const path = info.outputPath('photo-dialog.png');
      await page.screenshot({ path });
      await info.attach('photo-dialog', { path, contentType: 'image/png' });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await fits(page);
  });
}

for (const [width, height] of [[320, 640], [1024, 768], [1366, 768]]) {
  test(`registry states and form actions at ${width}x${height}`, async ({ page }, info) => {
    test.skip(info.project.name !== (width < 768 ? 'mobile' : 'desktop'));
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'layout-pm', roles: sessionStorage.getItem('part13-role') || 'PM', company: '1' })));
    await page.goto('/admin/navigation');
    await expect(page.getByTestId('no-permission')).toBeVisible();
    await fits(page);
    await page.goto('/admin/sample-requests?new=1');
    const actions = page.getByRole('toolbar', { name: 'Form actions' });
    await expect(actions).toBeVisible();
    await page.getByLabel('Title', { exact: false }).first().focus();
    await page.setViewportSize({ width, height: height - 220 });
    await actions.scrollIntoViewIfNeeded();
    const rect = await actions.boundingBox();
    const bottom = page.getByTestId('bottom-nav');
    const available = width < 768 ? (await bottom.boundingBox()).y : height - 220;
    expect(rect.y + rect.height).toBeLessThanOrEqual(available + 1);
    await fits(page);

    await page.evaluate(() => sessionStorage.setItem('part13-role', 'SYSADM'));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/v1/ui/form-registry', async (route) => {
      await gate;
      await route.fulfill({ status: 503, json: { error: { message: 'Registry unavailable' } } });
    });
    await page.goto('/admin/design-system/forms');
    try {
      await expect(page.getByRole('status', { name: 'Loading the form registry' })).toBeVisible();
      await fits(page);
    } finally { release(); }
    await expect(page.getByTestId('error-state')).toBeVisible();
    await fits(page);
    await page.unroute('**/api/v1/ui/form-registry');
    await page.getByTestId('error-state').getByRole('button').click();
    await expect(page.getByRole('table', { name: /Form definitions/ })).toBeVisible();
  });
}

test('dashboard role selector fits a 320px phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'layout-review', roles: 'SYSADM', company: '1' })));
  await page.goto('/admin/dashboards');
  await expect(page.getByTestId('dd-role')).toBeVisible();
  await fits(page);
});

test('phone menu still fits with the device feature switched off', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'layout-flags', roles: 'SYSADM', company: '1' })));
  await page.route('**/api/v1/core/feature-flags/evaluate?**', async (route) => {
    const response = await route.fetch();
    const result = await response.json();
    if ('ff.ui.p0306' in result.data) result.data['ff.ui.p0306'] = false;
    await route.fulfill({ response, json: result });
  });
  await page.goto('/home');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-device', 'off');
  await page.locator('.sh-burger').click();
  await fits(page);
  await page.locator('#sh-nav').getByRole('link', { name: 'Form Components', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Form Components', exact: true })).toBeVisible();
});
