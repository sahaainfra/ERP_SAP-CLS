import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { test, expect as playwrightExpect } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });

const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const route = '/site/dpr-entry';
const labels = {
  en: ['Site', 'Date', 'Start the report', 'Work done', 'Could not load the report data'],
  hi: ['साइट', 'तारीख', 'रिपोर्ट शुरू करें', 'किया गया काम', 'रिपोर्ट का डेटा लोड नहीं हो सका'],
};

async function open(page, language, { role = 'SE', theme = 'light', query = '' } = {}) {
  await page.addInitScript(({ language, role, theme }) => {
    localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'part14-review', roles: role, company: '1' }));
    localStorage.setItem('erp.appearance', JSON.stringify({ language, theme, density: 'comfortable' }));
  }, { language, role, theme });
  await page.goto(route + query);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}
const fits = (page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

for (const [language, [site, date, start, work, failure]] of Object.entries(labels)) {
  test('DPR keyboard, accessible names and retry in ' + language, async ({ page }, info) => {
    const sizes = info.project.name === 'mobile'
      ? [[320, 640], [360, 740], [375, 812], [390, 844], [430, 932]]
      : [[768, 1024], [1024, 768], [1366, 768], [1920, 1080]];
    // The site picker only lists active sites. Use the same disposable SQLite fixture as site-dpr.spec.js.
    const db = new DatabaseSync('data/e2e.sqlite');
    let siteId;
    try {
      db.exec('PRAGMA busy_timeout = 8000;');
      const code = ('P14-' + language + '-' + info.project.name[0] + '-' + Date.now().toString(36)).toUpperCase();
      const project = db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, 'Bridge works', 'ROAD', 'ACTIVE')").run(code);
      siteId = db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, 'Pier work area', 'ACTIVE')").run(project.lastInsertRowid, code).lastInsertRowid;
    } finally {
      db.close();
    }
    const endpoint = '**/api/v1/site/dprs/prefill?**';
    await page.route(endpoint, (r) => r.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Upstream English error', correlationId: 'part14-prefill' } } }));
    await open(page, language);
    const select = page.getByRole('combobox', { name: site, exact: true });
    await select.selectOption(String(siteId));
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await fits(page);
    }
    await select.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(date, { exact: true })).toBeFocused();
    // Chromium can tab through the native date segments before moving to the radio group.
    const dateInput = page.getByLabel(date, { exact: true });
    for (let segment = 0; segment < 5 && await dateInput.evaluate((el) => el === document.activeElement); segment += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(page.locator('input[name="scope"]:checked')).toBeFocused();
    await page.keyboard.press('Tab');
    const startButton = page.getByRole('button', { name: start, exact: true });
    await expect(startButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('dpr-error')).toContainText(failure);
    await expect(page.getByTestId('dpr-error')).toContainText('part14-prefill');
    await page.unroute(endpoint);
    await startButton.press('Enter');
    const heading = page.getByRole('heading', { name: work, exact: true });
    await expect(heading).toBeFocused();
    await expect(page.getByTestId('dpr-step-work')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('dpr-work-empty')).toBeVisible();
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await fits(page);
    }
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('dpr-back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('dpr-next')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('dpr-labour').getByRole('heading')).toBeFocused();
    await page.getByTestId('dpr-step-materials').press('Enter');
    await expect(page.getByTestId('dpr-materials').getByRole('heading').first()).toBeFocused();
    await page.getByTestId('dpr-back').press('Enter');
    await expect(page.getByTestId('dpr-labour').getByRole('heading')).toBeFocused();
    if (language === 'hi' && info.project.name === 'mobile') {
      const name = info.outputPath('hindi-dpr.png');
      await page.screenshot({ path: name });
      await info.attach('Hindi DPR', { path: name, contentType: 'image/png' });
      await info.attach('DPR accessibility tree', { body: await page.locator('main').ariaSnapshot(), contentType: 'text/plain' });
    }
  });
}

for (const theme of ['light', 'dark', 'high-contrast']) {
  test('DPR semantics and contrast in ' + theme, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'hi', { theme });
    await expect(page.getByRole('combobox', { name: 'साइट', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches && parseFloat(getComputedStyle(document.querySelector('.btn')).animationDuration) <= 0.00001)).toBe(true);
    await page.evaluate(axe);
    const violations = await page.evaluate(async () => (await window.axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })));
    expect(violations).toEqual([]);
  });
}

test('DPR access is guarded for an accounting role', async ({ page }) => {
  await open(page, 'hi', { role: 'ACCMGR' });
  await expect(page.getByTestId('no-permission')).toContainText('अनुमति');
  await expect(page.getByTestId('dpr-site')).toHaveCount(0);
  await fits(page);
});

test('existing DPR exposes loading and keeps Day unavailable in edit mode', async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/site/dprs/987654', async (request) => {
    await pending;
    await request.fulfill({ json: { data: { siteCode: 'S1', siteId: 1, dprDate: '2026-11-27', scope: 'SITE', work: [], labour: [], materials: [], equipment: [], notes: [] } } });
  });
  await open(page, 'en', { role: 'CSUP', query: '?id=987654' });
  try {
    await expect(page.getByRole('status', { name: 'Daily Progress Report Entry' })).toBeVisible();
    await fits(page);
  } finally {
    release();
  }
  await expect(page.getByTestId('dpr-work')).toBeVisible();
  await expect(page.getByTestId('dpr-step-day')).toBeDisabled();
  await expect(page.getByTestId('dpr-back')).toBeDisabled();
});
