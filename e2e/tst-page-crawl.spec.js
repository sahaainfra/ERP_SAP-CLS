import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { trackPageRequests } from './page-requests.js';
import { allRegisteredPages } from './pages.js';
import { TEMPLATE_PERMISSIONS } from '../src/server/platform/authz/templates.js';

// Part 30.03 T-01 / FR-02: the route crawler. Every registered page (100 % of the client registry) is opened on a 360 px phone, in a company
// with every feature on, by a user holding every internal role. For each route it records console errors, API calls that fail on the server
// (5xx), sideways overflow and a page that shows nothing, and posts the results to the page completion audit in batches (one crawl run).
// The audit must report full coverage; the routes with findings are listed in the run (and become the defects of the audit).
const pages = allRegisteredPages().filter((p) => !p.onboardingOnly);
const ROLES = Object.keys(TEMPLATE_PERMISSIONS).filter((c) => !/^(X-.*|GUARD|EMP|SUBCO)$/.test(c)).join(',');
const H = (company, user, roles = 'SYSADM') => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': randomUUID() });

const state = () => {
  const main = document.querySelector('main');
  if (!main) return 'blank';
  if (main.querySelector('[data-testid="no-permission"]')) return 'denied';
  if (main.querySelector('[data-testid="error-state"]')) return 'error';
  if (main.querySelector('[data-testid="empty-state"]') && !main.querySelector('table, [data-testid$="-tiles"], form')) return 'empty';
  return main.textContent.trim().length > 0 || main.querySelector('h1') ? 'content' : 'blank';
};

test('T-01 the crawler opens every registered route and the audit reports 100 % coverage', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the crawl runs once, on the phone (360 px), where overflow is checked');
  test.setTimeout(5_400_000);
  const created = await request.post('/api/v1/iam/org/companies', { headers: H(1, 'crawl-setup'), data: { code: 'CRAWL', legalName: 'Crawl Infra Pvt Ltd', shortName: 'CRAWL' } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const company = (await created.json()).data.id;
  expect((await request.put('/api/v1/core/company-settings', { headers: H(company, 'crawl-setup'), data: { legalName: 'Crawl Infra Pvt Ltd', reason: 'initial set-up' } })).status()).toBe(200);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    // every capability on for this company: the crawl sees each page's content, not its "not enabled" state
    for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Route crawl', 0, 1)").run(key, company);
  } finally {
    db.close();
  }
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  await context.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, { user: 'crawl-all', roles: ROLES, company: String(company) });
  const page = await context.newPage();
  const settled = trackPageRequests(page, { dataOnly: true });
  let consoleErrors = []; let failed = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/socket\.io|WebSocket|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.status() >= 500) failed.push(`${r.request().method()} ${u.pathname} ${r.status()}`); });
  const results = [];
  for (const p of pages) {
    consoleErrors = []; failed = [];
    const started = Date.now();
    await page.goto(p.route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('page-loading')).toHaveCount(0, { timeout: 30_000 }).catch(() => {});
    await expect.poll(settled, { timeout: 30_000 }).toEqual([]).catch(() => {});
    const overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    results.push({ route: p.route, state: await page.evaluate(state), consoleErrors: [...new Set(consoleErrors)].slice(0, 10).map((e) => e.slice(0, 480)), failedRequests: [...new Set(failed)].slice(0, 10), overflowPx, loadMs: Math.min(600_000, Date.now() - started) });
  }
  let runId = null; let out = null;
  for (let i = 0; i < results.length; i += 100) {
    const res = await request.post('/api/v1/tst/page-audits/crawl', { headers: H(company, 'crawl-all', 'ITADM'), data: { viewport: 'mobile', role: 'ALL_INTERNAL', results: results.slice(i, i + 100), ...(runId ? { runId } : {}), final: i + 100 >= results.length } });
    expect(res.status(), await res.text()).toBe(201);
    out = (await res.json()).data; runId = out.id;
  }
  const findings = results.filter((r) => r.consoleErrors.length || r.failedRequests.length || r.overflowPx > 0 || r.state === 'blank');
  info.annotations.push({ type: 'crawl', description: `${results.length} routes; ${findings.length} with findings; coverage ${out.coverage.pct} %` });
  for (const f of findings.slice(0, 40)) info.annotations.push({ type: 'finding', description: `${f.route}: ${[...f.consoleErrors, ...f.failedRequests, f.overflowPx ? `overflow ${f.overflowPx}px` : '', f.state === 'blank' ? 'blank' : ''].filter(Boolean).join(' | ').slice(0, 400)}` });
  expect(out.coverage.pct).toBe(100);
  expect(out.coverage.missing).toEqual([]);
  expect(findings.map((f) => f.route)).toEqual([]);
});
