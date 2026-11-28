import { test, expect } from '@playwright/test';

// PACK-13: the sticky action bar of a long form on a phone (the reference form, Sample Material Request). With the on-screen keyboard open the
// page is resized (viewport `interactive-widget=resizes-content`), which a headless browser cannot open, so the keyboard is simulated by
// shrinking the viewport to what is left above it. The bar must stay on screen and must not be covered by the bottom navigation.

const rects = (page) => page.evaluate(() => {
  const r = (el) => (el ? (({ top, bottom, height }) => ({ top, bottom, height }))(el.getBoundingClientRect()) : null);
  const nav = document.querySelector('[data-testid="bottom-nav"]');
  const navShown = nav && getComputedStyle(nav).display !== 'none' && nav.getBoundingClientRect().height > 0;
  return { vh: window.innerHeight, bar: r(document.querySelector('.ff-actionbar')), nav: navShown ? r(nav) : null };
});

test('PACK-13 the form action bar stays on screen above the bottom navigation, with and without the on-screen keyboard', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone project');
  await page.addInitScript(() => localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'pack13-bar', roles: 'PM', company: '1' })));
  await page.goto('/admin/sample-requests?new=1');
  const bar = page.locator('.ff-actionbar');
  await expect(bar).toBeVisible();
  const before = await rects(page);
  info.annotations.push({ type: 'measure', description: JSON.stringify({ keyboard: false, ...before }) });
  console.log('PACK-13 bar', JSON.stringify({ keyboard: false, ...before }));
  expect(before.bar.bottom, 'the bar is on screen').toBeLessThanOrEqual(before.vh + 1);
  if (before.nav) expect(before.bar.bottom, 'the bar is not under the bottom navigation').toBeLessThanOrEqual(before.nav.top + 1);

  // the keyboard opens over the lower part of the screen while a field low in the long form is being typed in: the page is resized to what is
  // left. (A sticky bar cannot rise above the top of its form, so the first field of a form keeps its own place; the bar follows once the
  // person is into the form.)
  const picked = await page.evaluate(() => {
    const all = [...document.querySelectorAll('form input:not([type=hidden]):not([type=checkbox]):not([type=radio]), form textarea')].filter((el) => el.getClientRects().length && !el.disabled && !el.closest('.ff-actionbar'));
    const el = all.at(-1); el.scrollIntoView({ block: 'center' }); el.focus(); el.setAttribute('data-pack13', '1');
    return all.length;
  });
  expect(picked).toBeGreaterThan(1);
  const field = page.locator('[data-pack13="1"]');
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) });
  await page.waitForTimeout(300);
  const open = await rects(page);
  console.log('PACK-13 bar', JSON.stringify({ keyboard: true, ...open }));
  info.annotations.push({ type: 'measure', description: JSON.stringify({ keyboard: true, ...open }) });
  expect(open.bar.bottom, 'with the keyboard: the bar is on screen').toBeLessThanOrEqual(open.vh + 1);
  if (open.nav) expect(open.bar.bottom, 'with the keyboard: the bar is not under the bottom navigation').toBeLessThanOrEqual(open.nav.top + 1);
  await expect(field).toBeFocused();
});
