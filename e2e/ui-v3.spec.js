import { test, expect } from '@playwright/test';
import { registeredPages } from './pages.js';

// Part 166.2, T-01 to T-04: every registered page, opened by a super administrator in a company of its own, on the viewport of the project
// (desktop 1280, mobile 360):
//  T-01 the page names itself with the shared PageHeader (or, when it only shows a state, with the state's own heading);
//  T-02 no key figure is laid out in the form grid;
//  T-03 on a phone nothing scrolls the page sideways, and every table is cards or opted out (data-no-cards) in a box that scrolls on its own;
//  T-04 with the text 25 % larger, no header, key-figure tile or button cuts its words off.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
const pages = registeredPages().filter((p) => !p.onboardingOnly);

async function company(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const id = (await res.json()).data.id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  expect((await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } })).status()).toBe(200);
  return id;
}

/** What the checks need, read from the page in one go. */
const facts = () => {
  const main = document.querySelector('main');
  const h1s = [...(main?.querySelectorAll('h1') ?? [])];
  const inHeader = (h) => Boolean(h.closest('[data-page-header]'));
  const inState = (h) => Boolean(h.closest('[data-testid="no-permission"], [data-testid="error-state"], [data-testid="empty-state"]'));
  const tables = [...(main?.querySelectorAll('table') ?? [])].filter((t) => t.getClientRects().length && !t.closest('.ch-table'));
  const cut = [...(main?.querySelectorAll('[data-page-header] h1, .kpi-label, .kpi-value, .btn, .ph-actions button') ?? [])].filter((e) => e.getClientRects().length && getComputedStyle(e).overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${e.textContent.trim().slice(0, 30)}"`);
  return {
    uiV3: document.documentElement.dataset.uiV3 === 'on',
    h1: h1s.length,
    headers: main?.querySelectorAll('[data-page-header]').length ?? 0,
    loose: h1s.filter((h) => !inHeader(h) && !inState(h)).length,
    kpiInGrid: main?.querySelectorAll('.form-grid .mdm-panel strong, .form-grid .kpi-tile').length ?? 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tables: tables.map((t) => ({ cards: getComputedStyle(t).display === 'block', noCards: Boolean(t.closest('[data-no-cards]')), boxed: Boolean(t.closest('.table-scroll, .table-wrap, [data-no-cards]')) })),
    cut,
  };
};

test('T-01 T-02 T-03 T-04 every registered page has the page header, no key figure in a form grid, and fits the screen', async ({ browser, request }, info) => {
  test.setTimeout(3_600_000); // every registered page (366 at part 166.2), about 3 s each
  const c = await company(request, info.project.name === 'mobile' ? 'UV3M' : 'UV3D');
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  await context.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, { user: 'e2e-super', roles: 'SUPADM', company: String(c) });
  const page = await context.newPage();
  const phone = info.project.name === 'mobile';
  const problems = [];
  let tablesAsCards = 0; let tablesOptedOut = 0;
  for (const p of pages) {
    await page.goto(p.route);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(150);
    const f = await page.evaluate(facts);
    const at = `${p.route} @${phone ? 360 : 1280}`;
    if (!f.uiV3) problems.push(`${at}: the UI v3 flag is not applied`);
    if (f.h1 !== 1) problems.push(`${at}: ${f.h1} level-1 headings`);
    if (f.loose > 0) problems.push(`${at}: a level-1 heading outside the PageHeader`);
    if (f.headers === 0 && f.h1 > 0 && f.loose > 0) problems.push(`${at}: no PageHeader`);
    if (f.kpiInGrid > 0) problems.push(`${at}: ${f.kpiInGrid} key figure(s) in a form grid`);
    if (phone) {
      if (f.overflow > 0) problems.push(`${at}: scrolls sideways by ${f.overflow}px`);
      for (const t of f.tables) {
        if (t.cards) tablesAsCards++; else if (t.noCards) tablesOptedOut++;
        else if (!t.boxed) problems.push(`${at}: a table that is neither cards nor opted out, outside a scrolling box`);
      }
      // T-04: the text 25 % larger (the browser's text size); headers, tiles and buttons wrap their words instead of cutting them off
      await page.addStyleTag({ content: 'html { font-size: 125% !important; } body, main { font-size: 1.25em; }' });
      const big = await page.evaluate(facts);
      for (const c2 of big.cut) problems.push(`${at} text 125%: cut off ${c2}`);
      if (big.overflow > 0) problems.push(`${at} text 125%: scrolls sideways by ${big.overflow}px`);
    }
  }
  info.annotations.push({ type: 'tables', description: `${tablesAsCards} tables shown as cards, ${tablesOptedOut} opted out (data-no-cards)` });
  expect(problems).toEqual([]);
});
