import { test, expect } from '@playwright/test';
import { pageCode, registeredPages } from './pages.js';

// Development-header mode (port 3100). Part 03.10, FR-05, T-01: the visual regression baseline. Every page of the application, as a super administrator
// sees it, in the light, dark and high-contrast themes at 360, 768 and 1280 px wide: the first screen of each page is compared with the stored image.
// A page whose content changes from run to run (times, counts of what other tests did) is compared with its content masked, so what is checked is the
// frame, the header, the headings, the colours and the layout. The file is named a0 so that it runs first, on a database no other test has used. The baselines are of the Linux image the tests run on; change them on purpose with
// `npm run test:visual:update` and review the images in the pull request.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
const THEMES = ['light', 'dark', 'high-contrast'];
const SIZES = [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }];
// pages whose content is the state of the whole system or of the clock: only their frame is compared
const VOLATILE = new Set(['/admin/navigation', '/admin/audit', '/admin/security-events', '/admin/operations', '/admin/operations/health', '/admin/operations/jobs', '/admin/operations/schedules', '/admin/operations/dead-letters', '/admin/integrations/log', '/admin/data-health', '/admin/about', '/admin/architecture', '/admin/security/routes',
  '/admin/migration', '/account/sessions', '/admin/security/login-history', '/work', '/home', '/admin/console', '/admin/feature-flags', '/admin/formulas/shadow', '/admin/sample-requests/overview', '/field']);
const pages = registeredPages().filter((p) => !p.onboardingOnly);

async function company(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()).data.id;
}

for (const theme of THEMES) {
  test(`T-01 FR-05 visual baseline of every page, ${theme} theme, at 360, 768 and 1280 px`, async ({ browser, request }, info) => {
    test.skip(info.project.name === 'mobile', 'the three widths are set here');
    test.setTimeout(3_000_000); // 361 pages x 3 widths: about 1 100 screenshots a theme
    const c = await company(request, `VIS${theme.slice(0, 2).toUpperCase()}`);
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: SIZES[2], reducedMotion: 'reduce' });
    await context.addInitScript(([v, th]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: th, density: 'comfortable', language: 'en' })); localStorage.setItem('erp.shell.closed-groups', JSON.stringify([])); }, [{ user: 'e2e-visual', roles: 'SUPADM', company: String(c) }, theme]);
    const page = await context.newPage();
    for (const p of pages) {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.goto(p.route);
        await expect(page.locator('main')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);
        // a page of changing content: its content is hidden (not covered by a mask, which would cover the fixed bar of a phone when the content grows)
        if (VOLATILE.has(p.route)) await page.addStyleTag({ content: 'main > *:not(:first-child), .sh-crumbs { visibility: hidden !important; }' }); // a rule, so a page that draws again keeps it
        await expect(page).toHaveScreenshot(`${pageCode(p.route)}-${theme}-${size.width}.png`, {
          animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.01, timeout: 20_000, // a large page under the load of the whole run needs longer than 5 s to settle; the comparison is unchanged
        });
      }
    }
    await context.close();
  });
}
