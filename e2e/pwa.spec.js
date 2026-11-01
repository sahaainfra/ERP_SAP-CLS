import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { menu, userMenu } from './shell-helpers.js';

// Development-header mode (port 3100). The installable app (part 03.06): the manifest and icons a browser needs to offer installation, a service
// worker that takes control, the app shell opening with no connection, a person's cached copies never shown to another, the install notice, the
// update notice, and the setting of low-bandwidth mode. T-01: Lighthouse itself is a download, so its installability criteria are checked directly.
const identity = { user: 'e2e-pwa-admin', roles: 'SYSADM', company: '1' };
const start = async (page, path = '/home', id = identity) => {
  await page.addInitScript((v) => { if (!sessionStorage.getItem('erp.test.identity-set')) { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); sessionStorage.setItem('erp.test.identity-set', '1'); } }, id);
  await page.goto(path);
};
/** Wait until a service worker controls the page (the first visit installs it; it takes control as soon as it is active). */
const controlled = async (page) => {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true);
};

test('T-01 FR-03 the manifest, icons and service worker meet the browser\'s installability criteria', async ({ page, request }) => {
  await start(page);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const res = await request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/manifest\+json|json/);
  expect(res.headers()['cache-control']).toContain('no-cache');
  const manifest = await res.json();
  expect(manifest).toMatchObject({ display: 'standalone', scope: '/', id: '/' });
  expect(manifest.name.length).toBeGreaterThan(3);
  expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect([r.status(), r.headers()['content-type']]).toEqual([200, 'image/png']);
  }
  expect(manifest.start_url.startsWith('/')).toBe(true);
  expect((await request.get(manifest.start_url)).status()).toBe(200);
  // a service worker that has a fetch handler and takes control of the page
  const worker = await request.get('/sw.js');
  expect(worker.headers()['cache-control']).toContain('no-cache');
  const source = await worker.text();
  expect(source).toContain("addEventListener('fetch'");
  expect(source).not.toContain('__PRECACHE__');
  await controlled(page);
  const info = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r.scope, state: r.active.state, script: new URL(r.active.scriptURL).pathname }; });
  expect(info).toMatchObject({ script: '/sw.js', state: 'activated' });
  expect(info.scope).toMatch(/\/$/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1C2530');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
});

test('T-01 FR-03 the app shell opens with no connection, from the first load on', async ({ page, context }) => {
  test.setTimeout(90_000);
  await start(page);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await controlled(page);
  await page.reload(); // now the service worker answers, and the calls that draw the shell leave their copy
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByTestId('search-trigger')).toBeVisible(); // the header, drawn by the cached app
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible(); // the launchpad, from the copy kept for this person
  await context.setOffline(false);
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);
});

test('FR-03 a copy kept for offline use is never shown to another person on the same device', async ({ page, context }) => {
  test.setTimeout(90_000);
  await start(page);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await controlled(page);
  await page.reload();
  await expect((await menu(page)).getByRole('link', { name: 'Navigation Registry' })).toBeVisible(); // the administrator's menu was kept
  // another person takes over the device (the identity of the page changes), and the connection drops
  await page.evaluate(() => localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'e2e-pwa-pm', roles: 'PM', company: '1' })));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Navigation Registry' })).toHaveCount(0);
  await expect(page.getByText('Could not reach the server')).toBeVisible(); // nothing of the administrator's is shown to this person
  await context.setOffline(false);
});

test('FR-03 a newer version waits for the person, who reloads into it from the notice', async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await controlled(page);
  await expect(page.getByTestId('pwa-update')).toHaveCount(0);
  // the server now has a different worker file (one more comment is enough to make it a new version); the file is put back afterwards
  const file = join('dist', 'sw.js');
  const real = readFileSync(file, 'utf8');
  writeFileSync(file, `${real}
// a newer build
`);
  try {
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await expect(page.getByTestId('pwa-update')).toContainText('A new version is ready');
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => Boolean(r.waiting)))).toBe(true);
    const loads = [];
    page.on('load', () => loads.push(1));
    await page.getByRole('button', { name: 'Reload now' }).click();
    await expect.poll(() => loads.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await expect(page.getByTestId('pwa-update')).toHaveCount(0);
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => Boolean(r.waiting)))).toBe(false);
  } finally {
    writeFileSync(file, real);
  }
});

test('FR-03 the install notice appears when the browser offers installation, installs on a click, and stays away for a while when dismissed', async ({ page }) => {
  await start(page);
  await controlled(page);
  await expect(page.getByTestId('pwa-install')).toHaveCount(0);
  const offer = () => page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = (window.__prompted ?? 0) + 1; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await offer();
  await expect(page.getByTestId('pwa-install')).toContainText('Install the app on this device');
  await page.getByTestId('pwa-install').getByRole('button', { name: 'Install' }).click();
  await expect.poll(() => page.evaluate(() => window.__prompted)).toBe(1);
  await expect(page.getByTestId('pwa-install')).toHaveCount(0);
  await offer();
  await page.getByTestId('pwa-install').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('pwa-install')).toHaveCount(0);
  await page.reload();
  await controlled(page);
  await offer();
  await expect(page.getByTestId('pwa-install')).toHaveCount(0); // asked once, not again for two weeks
});

test('FR-03 on an iPhone the install notice gives the steps of Safari, since it has no prompt', async ({ browser }, info) => {
  const { baseURL } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 800 }, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await context.newPage();
  await start(page);
  await expect(page.getByTestId('pwa-install')).toContainText('Add to Home Screen');
  await expect(page.getByTestId('pwa-install').getByRole('button', { name: 'Install' })).toHaveCount(0);
  await context.close();
});

test('FR-06 low-bandwidth mode is a setting of this device in the account menu, on by itself for a data saver', async ({ page }) => {
  await start(page);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page.locator('html[data-lowbw]')).toHaveCount(0);
  const menu = await userMenu(page);
  await menu.getByTestId('lowbw-select').selectOption('on');
  await expect(menu.getByTestId('lowbw-on')).toBeVisible();
  await expect(page.locator('html[data-lowbw]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('html[data-lowbw]')).toHaveCount(1);
  await (await userMenu(page)).getByTestId('lowbw-select').selectOption('auto');
  await expect(page.locator('html[data-lowbw]')).toHaveCount(0);
});
