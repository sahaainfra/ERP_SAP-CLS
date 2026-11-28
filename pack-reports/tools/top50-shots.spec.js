// PACK-02: screenshots of the 50 worst pages (pack-reports/top50-worst-pages.csv) at 360x740 and 1280x800, light theme, as the user of
// the a11y sweep (every internal role) in a fresh company with every flag on. Written to pack-reports/screens/ (ignored by git).
//   PW_EXE=<chrome> npx playwright test -c pack-reports/tools/playwright.shots.config.js
import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { TEMPLATE_PERMISSIONS } from '../../src/server/platform/authz/templates.js';

const OUT = process.env.SHOTS_OUT ?? 'pack-reports/screens';
const routes = readFileSync('pack-reports/top50-worst-pages.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[1]);
const ROLES = Object.keys(TEMPLATE_PERMISSIONS).filter((c) => !/^(X-.*|GUARD|EMP|SUBCO)$/.test(c)).join(',');
const H = (company, user) => ({ 'x-erp-user': user, 'x-erp-roles': 'SYSADM', 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': randomUUID() });

test('PACK-02 top-50 screenshots at 360 and 1280 px', async ({ browser, request }, info) => {
  test.setTimeout(3_600_000);
  mkdirSync(OUT, { recursive: true });
  const code = 'SHOTS'; // fixed, so two runs on fresh databases draw the same text (before/after comparisons)
  const created = await request.post('/api/v1/iam/org/companies', { headers: H(1, 'shots-setup'), data: { code, legalName: 'Screenshot Infra Pvt Ltd', shortName: code } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const company = (await created.json()).data.id;
  await request.put('/api/v1/core/company-settings', { headers: H(company, 'shots-setup'), data: { legalName: 'Screenshot Infra Pvt Ltd', reason: 'initial set-up' } });
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'PACK-02 screenshots', 1, 1)").run(key, company);
  db.close();
  for (const [w, h] of [[360, 740], [1280, 800]]) {
    const phone = w <= 480;
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    await context.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); }, { user: 'shots-all', roles: ROLES, company: String(company) });
    const page = await context.newPage();
    for (const [i, route] of routes.entries()) {
      try {
        // settle: the data calls finished (no loading skeleton), and a page refused by the per-account rate limit is taken again
        const settle = async () => { await page.locator('main').waitFor({ timeout: 15_000 }); await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}); await page.waitForTimeout(500); };
        await page.goto(route); await settle();
        if (await page.getByText(/Too many requests/).count()) { await page.waitForTimeout(11_000); await page.goto(route); await settle(); }
        await page.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}-${w}-${route.replace(/^\//, '').replace(/[/?=&]/g, '_')}.png`, fullPage: false });
      } catch (e) { info.annotations.push({ type: 'shot-failed', description: `${route} at ${w}: ${String(e.message).slice(0, 120)}` }); }
    }
    await context.close();
  }
});
