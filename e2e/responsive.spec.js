import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). T-03 of part 03.06: every page of the application opens at 360 px without a horizontal page scroll (a table
// or a wide grid may scroll inside its own box, the page may not), and without errors in the console. The list of pages is the navigation registry,
// so a page added later is swept too. The key pages are also looked at at the other widths the application is designed for.
const H = { 'x-erp-user': 'e2e-sweep', 'x-erp-roles': 'SYSADM', 'x-erp-company': '1' };
const identity = { user: 'e2e-sweep', roles: 'SYSADM', company: '1' };

async function routesOf(request) {
  const nav = (await (await request.get('/api/v1/ui/navigation', { headers: H })).json()).data;
  const seen = new Set(['/field', '/field/scan']);
  for (const g of nav.groups) for (const p of g.pages) seen.add(p.route);
  for (const d of nav.denied) seen.add(d.route); // pages this role cannot open show the no-permission state, which must fit too
  seen.delete('/welcome'); // only for a person who is being onboarded
  return [...seen].sort();
}

/** What sticks out to the right of the screen, named, or an empty list. */
const stickingOut = (page) => page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= w) return [];
  return [...document.querySelectorAll('body *')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'); })
    .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}:${Math.round(e.getBoundingClientRect().right)}`);
});

test('T-03 AC-02 every page of the application renders at 360 px without a horizontal page scroll and without console errors', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone width');
  test.setTimeout(420_000);
  const routes = await routesOf(request);
  expect(routes.length).toBeGreaterThanOrEqual(55);
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), identity);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text())) errors.push(`${page.url()} ${m.text().slice(0, 120)}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()} ${String(e).slice(0, 120)}`));
  const wide = [];
  for (const route of routes) {
    await page.goto(route);
    await page.locator('main').waitFor();
    await page.waitForLoadState('networkidle').catch(() => null);
    await page.waitForTimeout(250);
    const out = await stickingOut(page);
    if (out.length) wide.push(`${route}: ${out.join(', ')}`);
  }
  expect(wide, 'pages with a horizontal page scroll at 360 px').toEqual([]);
  expect(errors, 'console errors while sweeping').toEqual([]);
});

test('FR-02 the key pages fit at 768, 1280 and 1920 px as well', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set by the test itself');
  test.setTimeout(180_000);
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), identity);
  const problems = [];
  for (const width of [768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/home', '/field', '/field/scan', '/admin/sample-requests', '/admin/users', '/admin/navigation', '/admin/console', '/admin/design-system/forms', '/account/profile']) {
      await page.goto(route);
      await page.locator('main').waitFor();
      await page.waitForLoadState('networkidle').catch(() => null);
      const out = await stickingOut(page);
      if (out.length) problems.push(`${width} px ${route}: ${out.join(', ')}`);
    }
  }
  expect(problems).toEqual([]);
});
