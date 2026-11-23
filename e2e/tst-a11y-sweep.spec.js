import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { trackPageRequests } from './page-requests.js';
import { allRegisteredPages } from './pages.js';
import { TEMPLATE_PERMISSIONS } from '../src/server/platform/authz/templates.js';

// Part 30.07 FR-02 FR-03 T-01: the accessibility and responsive sweep. Every registered page is opened, in a company with every feature on, by a
// user holding every internal role, at one width per run (A11Y_WIDTH: 360 by default, also 768, 1280 and 1920). At each page it records the axe
// findings against WCAG 2.1 A and AA (A11Y_AXE=0 skips them on the wider sweeps), sideways overflow, touch targets under 44 px on a phone,
// form fields under 16 px on a phone, the load time and the theme. The results go to the validation results (POST /tst/a11y/runs) in batches,
// and to docs/erp/a11y/a11y-<width>.json (A11Y_OUT changes the folder). A11Y_ROUTES limits the sweep to a file of routes (a re-test after fixes).
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const OUT = process.env.A11Y_OUT ?? 'docs/erp/a11y';
const WIDTH = Number(process.env.A11Y_WIDTH ?? 360);
const HEIGHT = WIDTH <= 400 ? 740 : WIDTH <= 800 ? 1024 : WIDTH <= 1300 ? 800 : 1080;
const AXE_ON = process.env.A11Y_AXE !== '0';
const THEME = process.env.A11Y_THEME ?? 'light';
const only = process.env.A11Y_ROUTES ? new Set(readFileSync(process.env.A11Y_ROUTES, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) : null;
const pages = allRegisteredPages().filter((p) => !p.onboardingOnly && (!only || only.has(p.route)));
const ROLES = Object.keys(TEMPLATE_PERMISSIONS).filter((c) => !/^(X-.*|GUARD|EMP|SUBCO)$/.test(c)).join(',');
const H = (company, user, roles = 'SYSADM') => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': randomUUID() });

/** The results into one run of the validation results, in batches under the API's 50 kB body limit (null when the part is not mounted). */
export async function postSweep(request, headers, head, results) {
  const slim = results.map(({ route, loadMs, violations, overflowPx, smallTargetCount, tinyInputs, error }) => ({ route, loadMs, overflowPx, smallTargets: smallTargetCount ?? 0, tinyInputs: tinyInputs ?? 0, ...(error ? { error } : {}),
    violations: violations.slice(0, 60).map((v) => ({ rule: v.rule, impact: v.impact, help: v.help.slice(0, 120), nodes: v.nodes, targets: v.targets.slice(0, 1).map((t) => t.slice(0, 100)) })) }));
  const batches = []; let cur = []; let size = 0;
  for (const r of slim) { const n = JSON.stringify(r).length; if (cur.length && (size + n > 38_000 || cur.length >= 150)) { batches.push(cur); cur = []; size = 0; } cur.push(r); size += n; }
  if (cur.length) batches.push(cur);
  let runId = null; let out = null;
  for (const [i, b] of batches.entries()) {
    const res = await request.post('/api/v1/tst/a11y/runs', { headers: { ...headers, 'idempotency-key': randomUUID() }, data: { ...head, ...(runId ? { runId } : {}), final: i === batches.length - 1, results: b } });
    if (res.status() === 404) return null;
    expect(res.status(), await res.text()).toBe(201);
    out = (await res.json()).data; runId = out.id;
  }
  return out;
}

const measure = (phone) => {
  const main = document.querySelector('main');
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const small = phone && main ? [...main.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select')]
    .filter((e) => visible(e) && !e.closest('table, [data-inline-link], p, li') && Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width) < 44)
    .map((e) => `${e.tagName.toLowerCase()}${e.dataset.testid ? `[data-testid=${e.dataset.testid}]` : ''}: ${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 40)}`) : [];
  const tinyInputs = phone && main ? [...main.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')].filter((e) => visible(e) && parseFloat(getComputedStyle(e).fontSize) < 16).length : 0;
  return { overflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth), smallTargets: small.slice(0, 20), smallTargetCount: small.length, tinyInputs, h1: document.querySelectorAll('main h1').length };
};

test(`T-01 FR-02 FR-03 every page at ${WIDTH} px: axe, overflow, touch targets`, async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the sweep runs once per width, from the mobile project');
  test.setTimeout(7_200_000);
  const code = `A11Y${WIDTH}`;
  const created = await request.post('/api/v1/iam/org/companies', { headers: H(1, 'a11y-setup'), data: { code, legalName: 'Accessibility Infra Pvt Ltd', shortName: code } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const company = (await created.json()).data.id;
  expect((await request.put('/api/v1/core/company-settings', { headers: H(company, 'a11y-setup'), data: { legalName: 'Accessibility Infra Pvt Ltd', reason: 'initial set-up' } })).status()).toBe(200);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try { for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Accessibility sweep', 0, 1)").run(key, company); } finally { db.close(); }
  const phone = WIDTH <= 480;
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: WIDTH, height: HEIGHT }, hasTouch: phone, isMobile: phone, bypassCSP: true });
  await context.addInitScript(([v, theme]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme, density: 'comfortable', language: 'en' })); }, [{ user: 'a11y-all', roles: ROLES, company: String(company) }, THEME]);
  const page = await context.newPage();
  const settled = trackPageRequests(page, { dataOnly: true });
  const results = [];
  for (const p of pages) {
    const started = Date.now();
    try {
      await page.goto(p.route);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByTestId('page-loading')).toHaveCount(0, { timeout: 30_000 }).catch(() => {});
      await expect.poll(settled, { timeout: 30_000 }).toEqual([]).catch(() => {});
      const loadMs = Date.now() - started;
      const m = await page.evaluate(measure, phone);
      let violations = [];
      if (AXE_ON) {
        if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ content: AXE });
        const out = await page.evaluate(async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
        violations = out.violations.map((v) => ({ rule: v.id, impact: v.impact ?? 'minor', help: v.help.slice(0, 200), nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => String(n.target?.[0] ?? '').slice(0, 160)) }));
      }
      results.push({ route: p.route, loadMs: Math.min(600_000, loadMs), violations, ...m });
    } catch (err) {
      results.push({ route: p.route, loadMs: Date.now() - started, violations: [], overflowPx: 0, smallTargets: [], smallTargetCount: 0, tinyInputs: 0, h1: 0, error: String(err.message ?? err).slice(0, 300) });
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/a11y-${WIDTH}${THEME === 'light' ? '' : `-${THEME}`}.json`, JSON.stringify({ width: WIDTH, theme: THEME, axe: AXE_ON, at: new Date().toISOString(), results }, null, 1));
  // the results, in batches into one run of the validation results
  const out = await postSweep(request, H(company, 'a11y-all', 'ITADM'), { kind: AXE_ON ? 'AXE' : 'RESPONSIVE', width: WIDTH, height: HEIGHT, theme: THEME, language: 'en', network: 'FAST' }, results);
  const serious = results.filter((r) => r.violations.some((v) => v.impact === 'serious' || v.impact === 'critical'));
  info.annotations.push({ type: 'sweep', description: `${results.length} pages at ${WIDTH} px; ${serious.length} with serious or critical findings; ${results.filter((r) => r.overflowPx > 0).length} overflowing` });
  if (out) expect(out.coverage.pct).toBe(100);
});
