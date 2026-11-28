// PACK-06: clipped Telugu and Hindi text at 320 px on the 50 worst pages (pack-reports/top50-worst-pages.csv).
//   PW_EXE=<chrome> npx playwright test -c pack-reports/tools/playwright.clip.config.js
// For each page and language (te, hi) at 320x700: how much of the page's text is in that script (a page still in English cannot show
// Telugu clipping), and every control whose text does not fit: a button, link, input, select, chip, label, table cell or heading whose
// content is wider or taller than its box while its overflow is hidden or clipped, or ends in an ellipsis. Results:
// pack-reports/clip320.json; screenshots of pages with clipping in pack-reports/clip320/ (ignored by git).
/* global document, getComputedStyle */ // measure() runs in the page
import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TEMPLATE_PERMISSIONS } from '../../src/server/platform/authz/templates.js';

const OUT = 'pack-reports/clip320';
const routes = readFileSync('pack-reports/top50-worst-pages.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[1]);
const ROLES = Object.keys(TEMPLATE_PERMISSIONS).filter((c) => !/^(X-.*|GUARD|EMP|SUBCO)$/.test(c)).join(',');
const H = (company, user) => ({ 'x-erp-user': user, 'x-erp-roles': 'SYSADM', 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': randomUUID() });

const measure = (lang) => {
  const script = lang === 'te' ? /\p{Script=Telugu}/gu : /\p{Script=Devanagari}/gu;
  const letters = /[A-Za-z\p{Script=Devanagari}\p{Script=Telugu}]/gu;
  const main = document.querySelector('main') ?? document.body;
  const text = main.innerText ?? '';
  const total = (text.match(letters) ?? []).length; const inScript = (text.match(script) ?? []).length;
  const clipped = [];
  for (const el of main.querySelectorAll('button, a, input, select, label, th, td, h1, h2, h3, .lr-chip, .sh-chip, .chip, [class*="badge"], [class*="tile"] *')) {
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    const hidden = /hidden|clip/.test(s.overflowX + s.overflowY) || s.textOverflow === 'ellipsis' || el.tagName === 'INPUT' || el.tagName === 'SELECT';
    const wide = el.scrollWidth > el.clientWidth + 1; const tall = el.scrollHeight > el.clientHeight + 2;
    if (!hidden || !(wide || tall)) continue;
    const t = (el.value ?? el.innerText ?? '').trim(); if (!t) continue;
    if (!script.test(t)) { script.lastIndex = 0; continue; } script.lastIndex = 0; // only text in the language under test
    clipped.push({ tag: el.tagName.toLowerCase(), text: t.slice(0, 60), box: `${Math.round(r.width)}x${Math.round(r.height)}`, over: `${el.scrollWidth - el.clientWidth}x${el.scrollHeight - el.clientHeight}` });
  }
  return { scriptShare: total ? Math.round((inScript / total) * 100) : 0, clipped: clipped.slice(0, 20), clippedCount: clipped.length };
};

test('PACK-06 clipped Telugu and Hindi text at 320 px on the top 50 pages', async ({ browser, request }, info) => {
  test.setTimeout(3_600_000);
  mkdirSync(OUT, { recursive: true });
  const created = await request.post('/api/v1/iam/org/companies', { headers: H(1, 'clip-setup'), data: { code: 'CLIPS', legalName: 'Clip Check Infra Pvt Ltd', shortName: 'CLIPS' } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const company = (await created.json()).data.id;
  await request.put('/api/v1/core/company-settings', { headers: H(company, 'clip-setup'), data: { legalName: 'Clip Check Infra Pvt Ltd', reason: 'initial set-up' } });
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'PACK-06 clipping check', 1, 1)").run(key, company);
  db.close();
  const results = [];
  for (const lang of ['te', 'hi']) {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true });
    await context.addInitScript(([v, language]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language })); }, [{ user: `clip-${lang}`, roles: ROLES, company: String(company) }, lang]);
    const page = await context.newPage();
    for (const [i, route] of routes.entries()) {
      try {
        const settle = async () => { await page.locator('main').waitFor({ timeout: 15_000 }); await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}); await page.waitForTimeout(400); };
        await page.goto(route); await settle();
        if (await page.getByText(/Too many requests/).count()) { await page.waitForTimeout(11_000); await page.goto(route); await settle(); }
        const m = await page.evaluate(measure, lang);
        if (m.clippedCount) await page.screenshot({ path: `${OUT}/${lang}-${String(i + 1).padStart(2, '0')}-${route.replace(/^\//, '').replace(/[/?=&]/g, '_')}.png` });
        results.push({ lang, route, ...m });
      } catch (e) { results.push({ lang, route, error: String(e.message).slice(0, 160) }); }
    }
    await context.close();
  }
  writeFileSync('pack-reports/clip320.json', JSON.stringify(results, null, 1));
});
