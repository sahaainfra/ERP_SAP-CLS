import { test, expect } from '@playwright/test';
import { menu, setTheme, userMenu } from './shell-helpers.js';

// Development-header mode (port 3100). The style guide and the theme menu of the shell (part 03.01).
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};
const open = async (page, roles, path, user) => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: '1' });
  await page.goto(path);
};

test('Style guide: themes side by side, the contrast report, typography with the served fonts, density, status, and every icon', async ({ page }, info) => {
  const errors = watch(page);
  await open(page, 'SYSADM', '/admin/design-system', pick(info, 'e2e-ds-d', 'e2e-ds-m'));
  await expect(page.getByRole('heading', { name: 'Design System', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Design System/);
  await expect((await menu(page)).getByRole('link', { name: 'Design System' })).toBeVisible();
  for (const t of ['light', 'dark', 'high-contrast']) await expect(page.getByTestId(`preview-${t}`)).toBeVisible();
  // each preview really carries its own theme: the dark one has a dark page colour
  const bg = await page.getByTestId('preview-dark').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(15, 20, 26)');
  await expect(page.getByTestId('contrast-summary')).toContainText('Text pairs below WCAG AA0');
  await page.getByLabel('Only pairs that fail').check();
  await expect(page.getByText('Every text pair meets WCAG AA.')).toBeVisible();
  await page.getByLabel('Only pairs that fail').uncheck();
  await page.locator('select[aria-label="Contrast theme"]').selectOption('high-contrast');
  await expect(page.getByTestId('contrast-table').locator('tbody tr').first()).toContainText('high-contrast');
  await expect(page.getByTestId('swatch-brand.primary')).toContainText('#1D4F91');
  await expect(page.getByTestId('status-samples')).toContainText('Overdue');
  expect(await page.getByTestId('status-samples').locator('[data-tone="error"]').count()).toBeGreaterThanOrEqual(3);
  // the fonts are served by the application
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return { sans: document.fonts.check('600 16px "IBM Plex Sans"'), mono: document.fonts.check('400 12px "IBM Plex Mono"'), hindi: document.fonts.check('400 16px "IBM Plex Sans Devanagari"', 'हिन्दी') }; });
  expect(fonts).toEqual({ sans: true, mono: true, hindi: true });
  // density: the two previews have different control heights and table text
  const sizes = await page.evaluate(() => ['comfortable', 'compact'].map((d) => {
    const box = document.querySelector(`[data-testid=density-${d}]`);
    return { control: box.querySelector('input').getBoundingClientRect().height, font: parseFloat(getComputedStyle(box.querySelector('td')).fontSize) };
  }));
  expect(sizes[0].control).toBe(44);
  // compact is 28 px where a mouse is used; on a phone every control keeps 44 px so a thumb can hit it (part 03.06, FR-05)
  expect(sizes[1].control).toBe(info.project.name === 'mobile' ? 44 : 28);
  expect(sizes[0].font).toBeGreaterThan(sizes[1].font);
  // icons
  await page.getByRole('searchbox', { name: 'Search icons' }).fill('crane');
  await expect(page.getByTestId('icon-erp.cx.crane').locator('svg')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search icons' }).fill('');
  await page.locator('select[aria-label="Icon group"]').selectOption('States');
  await expect(page.getByTestId('icon-grid').locator('li')).toHaveCount(11);
  await page.getByRole('searchbox', { name: 'Search icons' }).fill('nothing-is-called-this');
  await expect(page.getByRole('heading', { name: 'No icons' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export the tokens' }).click()]);
  expect(download.suggestedFilename()).toBe('design-tokens.json');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('T-02 the theme changes every component at once, without a reload, and the choice follows the person to another device', async ({ browser }, info) => {
  const user = pick(info, 'e2e-theme-d', 'e2e-theme-m');
  const first = await browser.newContext({ viewport: info.project.use.viewport });
  const page = await first.newPage();
  const errors = watch(page);
  await open(page, 'PM', '/admin/projects', user);
  await expect(page.getByRole('heading', { name: 'Projects & Sites' })).toBeVisible();
  await page.evaluate(() => { window.__notReloaded = true; });
  const surface = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await surface();
  const saved = page.waitForResponse((r) => r.url().includes('/api/v1/ui/preferences') && r.request().method() === 'PATCH');
  await setTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await surface()).not.toBe(light);
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
  expect((await saved).status()).toBe(200);
  await setTheme(page, 'high-contrast');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  expect(await surface()).toBe('rgb(255, 255, 255)');
  expect(errors).toEqual([]);
  await page.waitForTimeout(300);
  await first.close();

  // another device: nothing in its storage, the saved theme arrives from the server
  const second = await browser.newContext({ viewport: info.project.use.viewport });
  const other = await second.newPage();
  await open(other, 'PM', '/admin/projects', user);
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  await expect((await userMenu(other)).getByLabel('Theme')).toHaveValue('high-contrast');
  await noOverflow(other);
  await second.close();
});

test('a first visit follows the device: a device that asks for dark gets the dark theme until the person chooses', async ({ browser }, info) => {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: info.project.use.viewport });
  const page = await ctx.newPage();
  await open(page, 'PM', '/admin/projects', pick(info, 'e2e-firstvisit-d', 'e2e-firstvisit-m'));
  await expect(page.getByRole('heading', { name: 'Projects & Sites' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await ctx.close();
});
