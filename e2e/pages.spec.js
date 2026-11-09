import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { pageCode, registeredPages } from './pages.js';

// Development-header mode (port 3100). Part 03.10, FR-01, FR-02, FR-03, BR-02: every page of the application is opened by a super administrator and
// checked against the machine-checkable part of the Page Completion Checklist: it draws inside the shell with one heading and a title, it ends loading,
// it has no console error, no placeholder text, no horizontal scroll at 360, 768 and 1280, and axe finds nothing serious or critical. A page with a
// finding fails here; a finding that is not the page's own is logged in DEFECTS.md.
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
const PLACEHOLDER = /lorem ipsum|\bTODO\b|\bFIXME\b|coming soon|under construction|\bdummy\b|\bplaceholder text\b|undefined|\[object Object\]|NaN\b/i;
const SIZES = [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }];

const pages = registeredPages().filter((p) => !p.onboardingOnly);

async function company(request, code) {
  const post = async (path, data, roles = 'SYSADM') => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, 1, 'e2e-setup'), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const id = (await post('/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  expect((await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } })).status()).toBe(200);
  return id;
}

test('every registered page is a page of the tracker, and no page is registered twice', () => {
  const codes = pages.map((p) => pageCode(p.route));
  expect(new Set(codes).size).toBe(codes.length);
  expect(codes.length).toBeGreaterThanOrEqual(60);
});

test('FR-01 FR-02 FR-03 BR-02 every page passes the checks of the Page Completion Checklist that a machine can make', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'the pages are visited at all three widths in one run');
  test.setTimeout(1_800_000); // every page at three widths: the sweep grows with every part
  const c = await company(request, 'PGS');
  const { baseURL } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport: SIZES[2] });
  await context.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, { user: 'e2e-super', roles: 'SUPADM', company: String(c) });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|422)/.test(m.text()) && errors.push(`${page.url()} ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${page.url()} ${String(e)}`));
  const problems = [];
  for (const p of pages) {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(p.route);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(150);
      const at = `${p.route} @${size.width}`;
      const facts = await page.evaluate(() => ({
        h1: document.querySelectorAll('main h1, #main h1').length, title: document.title, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        text: document.querySelector('main')?.innerText ?? '', skeleton: document.querySelectorAll('main [aria-busy="true"]').length, shell: Boolean(document.querySelector('.app-shell')), where: location.pathname,
      }));
      if (!facts.shell) problems.push(`${at}: drawn outside the shell`);
      if (facts.where !== p.route) problems.push(`${at}: ended at ${facts.where}`);
      if (facts.h1 !== 1) problems.push(`${at}: ${facts.h1} level-1 headings`);
      if (!facts.title || /^ERP$/.test(facts.title)) problems.push(`${at}: no page title`);
      if (facts.overflow > 0) problems.push(`${at}: scrolls sideways by ${facts.overflow}px`);
      if (facts.skeleton > 0 && p.route !== '/admin/design-system/object-page') problems.push(`${at}: still loading`); // that page shows a loading box on purpose, as an example
      const bad = PLACEHOLDER.exec(facts.text);
      if (bad) problems.push(`${at}: placeholder-like text "${bad[0]}"`);
      if (size.width === 1280) {
        await page.evaluate(AXE);
        const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
        for (const v of r.violations.filter((x) => ['serious', 'critical'].includes(x.impact))) problems.push(`${at}: ${v.impact} ${v.id} (${v.nodes.length}) ${String(v.nodes[0].html).slice(0, 100)}`);
      }
    }
  }
  expect(errors, 'console errors').toEqual([]);
  expect(problems).toEqual([]);
});
