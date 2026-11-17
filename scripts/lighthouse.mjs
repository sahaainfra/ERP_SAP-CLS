#!/usr/bin/env node
// Lighthouse on the phone pages (part 166.4, T-02): mobile form factor with Lighthouse's simulated Slow 4G and 4x slower processor, a cold cache.
// Pages: Home, Field Home, DPR entry, GRN and Approvals, each opened as the role that uses it. Targets: Performance >= 80, LCP <= 3 s, CLS <= 0.1.
//
// It needs a running application in development-header sign-in (the e2e server: NODE_ENV=test AUTH_MODE=dev-headers node scripts/e2e_server.mjs),
// and runs Lighthouse with npx (pinned, not a dependency of the application). The person is set the way the development identity bar sets it, in a
// fresh browser profile seeded from a JSON address of the same site, so no script of the application is cached before the measured visit.
//
// Usage: node scripts/lighthouse.mjs --base http://127.0.0.1:4791 [--out reports] [--runs 1] [--only <part of a path>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIGHTHOUSE = 'lighthouse@13.5.0';
export const TARGETS = Object.freeze({ performance: 80, lcpMs: 3000, cls: 0.1 });
export const PAGES = Object.freeze([
  { name: 'Home', path: '/home', user: 'lh-pm', roles: 'PM' },
  { name: 'Field Home', path: '/field', user: 'lh-se', roles: 'SE' },
  { name: 'DPR entry', path: '/site/dpr-entry', user: 'lh-se', roles: 'SE' },
  { name: 'GRN', path: '/inv/grns', user: 'lh-sk', roles: 'SK' },
  { name: 'Approvals', path: '/field/approvals', user: 'lh-pm', roles: 'PM' },
]);

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

/** The verdict of one Lighthouse result against the targets. */
export function verdict(lhr) {
  const a = lhr.audits ?? {};
  const out = {
    performance: Math.round((lhr.categories?.performance?.score ?? 0) * 100),
    lcpMs: Math.round(a['largest-contentful-paint']?.numericValue ?? NaN),
    cls: Number((a['cumulative-layout-shift']?.numericValue ?? NaN).toFixed(3)),
    fcpMs: Math.round(a['first-contentful-paint']?.numericValue ?? NaN),
    tbtMs: Math.round(a['total-blocking-time']?.numericValue ?? NaN),
    ttiMs: Math.round(a.interactive?.numericValue ?? NaN),
    bytes: Math.round(a['total-byte-weight']?.numericValue ?? NaN),
  };
  out.ok = out.performance >= TARGETS.performance && out.lcpMs <= TARGETS.lcpMs && out.cls <= TARGETS.cls;
  return out;
}

async function seedProfile(base, page, chrome) {
  const { chromium } = await import('playwright');
  const dir = mkdtempSync(join(tmpdir(), 'erp-lh-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const tab = ctx.pages()[0] ?? await ctx.newPage();
  await tab.goto(`${base}/health/live`); // a JSON answer of the same site: the identity is stored without loading the application
  await tab.evaluate(({ user, roles }) => {
    localStorage.setItem('erp.dev.identity', JSON.stringify({ user, roles, company: '1' }));
    localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' }));
  }, page);
  await ctx.close();
  return dir;
}

async function main() {
  const base = arg('--base', 'http://127.0.0.1:4791');
  const out = arg('--out', 'reports');
  const runs = Number(arg('--runs', '1'));
  // CHROME_PATH, else the Chromium installed for the browser tests (/opt/pw-browsers/chromium), else Playwright's own
  const chrome = process.env.CHROME_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : (await import('playwright')).chromium.executablePath());
  mkdirSync(out, { recursive: true });
  const results = [];
  const only = arg('--only', ''); // a part of the path, e.g. --only field
  for (const page of PAGES.filter((pg) => !only || pg.path.includes(only))) {
    const scores = [];
    for (let i = 0; i < runs; i += 1) {
      const profile = await seedProfile(base, page, chrome);
      const file = join(out, `lighthouse-${page.path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'root'}${runs > 1 ? `-run${i + 1}` : ''}.json`); // each run kept, to see what a slow one did
      const r = spawnSync('npx', ['--yes', LIGHTHOUSE, `${base}${page.path}`, '--only-categories=performance', '--form-factor=mobile', '--throttling-method=simulate',
        '--disable-storage-reset', '--output=json', `--output-path=${file}`, '--quiet', `--chrome-flags=--headless=new --no-sandbox --user-data-dir=${profile}`],
      { encoding: 'utf8', env: { ...process.env, CHROME_PATH: chrome }, timeout: 240_000 });
      rmSync(profile, { recursive: true, force: true });
      if (r.status !== 0) { console.error(`${page.name}: lighthouse failed\n${r.stderr?.slice(-2000)}`); scores.push({ ok: false, error: 'lighthouse failed' }); continue; }
      const lhr = JSON.parse(readFileSync(file, 'utf8'));
      scores.push({ ...verdict(lhr), finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl });
    }
    // the median run by performance score
    const sorted = [...scores].sort((a, b) => (a.performance ?? 0) - (b.performance ?? 0));
    const median = sorted[Math.floor(sorted.length / 2)];
    results.push({ ...page, ...median, runs: scores });
    console.log(`${page.name.padEnd(12)} perf ${median.performance}  LCP ${median.lcpMs} ms  CLS ${median.cls}  FCP ${median.fcpMs} ms  TBT ${median.tbtMs} ms  ${Math.round((median.bytes ?? 0) / 1024)} KB  ${median.ok ? 'PASS' : 'FAIL'}`);
  }
  const ok = results.every((r) => r.ok);
  writeFileSync(join(out, 'lighthouse.json'), `${JSON.stringify({ lighthouse: LIGHTHOUSE, targets: TARGETS, settings: 'mobile, simulated Slow 4G (150 ms, 1.6 Mbps), 4x CPU slowdown, cold cache', results }, null, 2)}\n`);
  const md = ['# Lighthouse, phone (part 166.4, T-02)', '', `${LIGHTHOUSE}; mobile, simulated Slow 4G (150 ms round trip, 1.6 Mbps), 4x slower processor, cold cache. Targets: Performance >= ${TARGETS.performance}, LCP <= ${TARGETS.lcpMs} ms, CLS <= ${TARGETS.cls}.`, '',
    '| Page | Role | Performance | LCP | CLS | FCP | TBT | Transferred | Result |', '|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...results.map((r) => `| ${r.name} (${r.path}) | ${r.roles} | ${r.performance} | ${r.lcpMs} ms | ${r.cls} | ${r.fcpMs} ms | ${r.tbtMs} ms | ${Math.round((r.bytes ?? 0) / 1024)} KB | ${r.ok ? 'PASS' : 'FAIL'} |`), ''].join('\n');
  writeFileSync(join(out, 'lighthouse.md'), md);
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
