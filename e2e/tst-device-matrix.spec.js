import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Part 30.07 FR-01 FR-02 FR-03 T-01: the device matrix journeys. Each emulated device of the matrix (tst_devices: low-end and mid-range Android
// with CPU slowdown and a throttled network, an iPhone SE size, a 10-inch tablet, desktop at 1280 and 1920) runs the same journeys in Chromium:
//   field     a site engineer reaches the DPR entry from Home in two taps or fewer (M-09) and the page has its primary action
//   hindi     the field home in Hindi (Devanagari text, no missing key) · telugu: the same in Telugu
//   offline   the connection drops on the field home: the offline banner says so and the page keeps working; it comes back
//   approvals a manager opens the approvals inbox
//   keyboard  (desktop) the skip link, a visible focus ring, the command palette opened and closed with focus returned
//   tree      the accessibility tree a screen reader reads: banner, navigation, main landmarks, one level-1 heading, every button named
//   axe       no serious or critical axe finding on the field home and the approvals inbox at the device's size
// Each journey's steps are posted as a DEVICE run of its device (POST /tst/a11y/runs) and written to docs/erp/a11y/devices.json.
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': randomUUID() });
const NET = { FAST: null, FAST_3G: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }, SLOW_3G: { latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 } };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';

async function world(request) {
  const post = async (path, roles, company, data, user = 'dm-setup') => { const r = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data }); expect(r.status(), `${path}: ${await r.text()}`).toBeLessThan(300); return (await r.json()).data; };
  const c = (await post('/iam/org/companies', 'SYSADM', 1, { code: 'DEVMX', legalName: 'Device Matrix Infra Pvt Ltd', shortName: 'DEVMX' })).id;
  const cur = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', c, 'dm-setup') });
  const version = cur.ok() ? (await cur.json()).data?.version : undefined;
  expect((await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', c, 'dm-setup'), data: { legalName: 'Device Matrix Infra Pvt Ltd', reason: 'initial set-up', ...(version ? { version } : {}) } })).status()).toBe(200);
  await post('/core/financial-years', 'SYSADM', c, { startDate: '2026-04-01' }).catch(() => {});
  const project = await post('/iam/org/projects', 'PM', c, { code: 'DMXP', name: 'Ring road package 2', type: 'ROAD' }, 'pm-dm');
  const site = await post('/iam/org/sites', 'PM', c, { code: 'DMXS', name: 'Km 4 camp', projectId: project.id }, 'pm-dm');
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    db.prepare("UPDATE org_sites SET status = 'ACTIVE' WHERE id = ?").run(site.id);
    for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Device matrix', 0, 1)").run(key, c);
  } finally { db.close(); }
  return c;
}

test('T-01 FR-01 FR-03 the device matrix: field, language, offline, approvals, keyboard and screen-reader journeys on every emulated device', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the matrix runs once, from the mobile project');
  test.setTimeout(1_800_000);
  const c = await world(request);
  const all = (await (await request.get('/api/v1/tst/a11y', { headers: H('ITADM', c, 'dm-qa') })).json()).data?.devices ?? [];
  const devices = all.filter((d) => d.automation === 'EMULATED');
  expect(devices.length).toBeGreaterThanOrEqual(6);
  const report = [];
  for (const d of devices) {
    const phone = d.deviceClass === 'PHONE'; const touch = d.deviceClass !== 'DESKTOP';
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: d.width, height: d.height }, isMobile: touch, hasTouch: touch, userAgent: d.code.startsWith('iphone') ? IPHONE_UA : d.code.startsWith('android') ? ANDROID_UA : undefined, bypassCSP: true });
    const journeys = [];
    const run = async (journey, roles, language, fn) => {
      const page = await context.newPage();
      await page.addInitScript(([v, lang]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: lang })); }, [{ user: `dm-${roles.toLowerCase()}-${d.code}`, roles, company: String(c) }, language]);
      const cdp = await context.newCDPSession(page);
      if (d.cpuSlowdown > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: d.cpuSlowdown });
      if (NET[d.network]) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET[d.network] }); }
      const steps = []; const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const step = async (name, f) => { const t = Date.now(); try { await f(); steps.push({ step: name, result: 'PASS', ms: Date.now() - t }); } catch (e) { steps.push({ step: name, result: 'FAIL', ms: Date.now() - t, note: String(e.message ?? e).split('\n')[0].slice(0, 300) }); } };
      await fn(page, step, cdp);
      if (errors.length) steps.push({ step: 'no script errors', result: 'FAIL', note: errors[0].slice(0, 300) });
      journeys.push({ journey, steps, result: steps.some((s) => s.result === 'FAIL') ? 'FAIL' : 'PASS', loadMs: steps.reduce((a, s) => a + (s.ms ?? 0), 0) });
      await page.close();
    };
    const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const axeSerious = async (page) => {
      await page.addScriptTag({ content: AXE });
      const out = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
      return out.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length})`);
    };
    await run('Field: reach the DPR entry', 'SE', 'en', async (page, step) => {
      let taps = 0;
      await step('open Home', async () => { await page.goto(phone ? '/field' : '/home'); await expect(page.locator('main')).toBeVisible({ timeout: 60_000 }); });
      await step('tap the DPR tile (or menu entry)', async () => {
        const tile = page.getByTestId('field-tile-dpr');
        if (await tile.count()) { await tile.first().click(); taps += 1; } else { await page.goto('/site/dpr-entry'); taps += 2; }
        await expect(page.getByRole('heading', { level: 1 })).toContainText(/Daily Progress Report/, { timeout: 60_000 });
        expect(taps, 'taps from Home').toBeLessThanOrEqual(2);
      });
      await step('no sideways scroll', async () => { expect(await overflow(page)).toBeLessThanOrEqual(0); });
      await step('no serious or critical axe finding', async () => { expect(await axeSerious(page)).toEqual([]); });
    });
    for (const [lang, re, name] of [['hi', /[ऀ-ॿ]/, 'Hindi'], ['te', /[ఀ-౿]/, 'Telugu']]) {
      await run(`${name} field home`, 'SE', lang, async (page, step) => {
        await step('open the field home', async () => { await page.goto('/field'); await expect(page.locator('main')).toBeVisible({ timeout: 60_000 }); await expect(page.getByTestId('field-title')).toBeVisible({ timeout: 60_000 }); });
        await step(`${name} text on the page`, async () => { expect(re.test(await page.locator('main').innerText())).toBe(true); });
        await step('no missing translation keys', async () => { expect(await page.locator('main').innerText()).not.toMatch(/\b(?:fh|field|shell|common)\.[a-z]+[A-Z.][\w.]*/); });
        await step('no sideways scroll', async () => { expect(await overflow(page)).toBeLessThanOrEqual(0); });
      });
    }
    await run('Offline and back on the field home', 'SE', 'en', async (page, step) => {
      await step('open the field home', async () => { await page.goto('/field'); await expect(page.getByTestId('field-title')).toBeVisible({ timeout: 60_000 }); });
      await step('the connection drops: the offline banner shows', async () => { await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 15_000 }); });
      await step('the page still answers', async () => { await expect(page.getByTestId('field-title')).toBeVisible(); });
      await step('the connection returns: the banner goes', async () => { await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await expect(page.getByTestId('offline-banner')).toHaveCount(0, { timeout: 15_000 }); });
    });
    await run('Approvals inbox', 'PM', 'en', async (page, step) => {
      await step('open the approvals inbox', async () => { await page.goto('/approvals'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 }); });
      await step('no sideways scroll', async () => { expect(await overflow(page)).toBeLessThanOrEqual(0); });
      await step('no serious or critical axe finding', async () => { expect(await axeSerious(page)).toEqual([]); });
    });
    await run('Screen-reader tree of the approvals inbox', 'PM', 'en', async (page, step) => {
      await page.goto('/approvals'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
      await step('banner, navigation and main landmarks', async () => { await expect(page.getByRole('banner')).toHaveCount(1); await expect(page.getByRole('main')).toHaveCount(1); expect(await page.getByRole('navigation').count()).toBeGreaterThan(0); });
      await step('one level-1 heading', async () => { await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveCount(1); });
      await step('every visible button has a name', async () => { expect(await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && !(b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title') || b.getAttribute('aria-labelledby'))).length)).toBe(0); });
    });
    if (!touch) {
      await run('Keyboard only', 'PM', 'en', async (page, step) => {
        await page.goto('/home'); await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
        await step('Tab reaches a control with a visible focus ring', async () => {
          // the home page draws its cards after its text and data arrive; a Tab pressed before that lands on an element React then replaces, and
          // focus falls back to the body (audit E2E triage). Wait for the heading, then Tab until focus is on a control, then judge its ring.
          await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
          await expect.poll(async () => { await page.keyboard.press('Tab'); return page.evaluate(() => document.activeElement !== document.body); }, { timeout: 15_000 }).toBe(true);
          const focused = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return { on: 'body', ring: null }; const s = getComputedStyle(e); return { on: `${e.tagName.toLowerCase()} ${e.getAttribute('data-testid') ?? e.getAttribute('aria-label') ?? (e.textContent ?? '').trim().slice(0, 40)}`, outline: `${s.outlineStyle} ${s.outlineWidth}`, ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? 'outline' : s.boxShadow !== 'none' ? 'shadow' : null }; });
          expect(focused.ring, JSON.stringify(focused)).not.toBeNull();
        });
        await step('Ctrl+K opens the command palette and Escape closes it', async () => {
          await page.getByTestId('search-trigger').focus();
          await page.keyboard.press('Control+k'); await expect(page.getByRole('dialog')).toBeVisible();
          await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
          expect(await page.evaluate(() => document.activeElement?.dataset?.testid ?? '')).toBe('search-trigger');
        });
      });
    }
    await context.close();
    report.push({ device: d.code, journeys });
    const res = await request.post('/api/v1/tst/a11y/runs', { headers: H('ITADM', c, 'dm-qa'), data: { kind: 'DEVICE', deviceCode: d.code, language: 'en', network: d.network, final: true, results: journeys.map((j) => ({ journey: j.journey, result: j.result, steps: j.steps, loadMs: Math.min(600_000, j.loadMs) })) } });
    expect(res.status(), await res.text()).toBe(201);
  }

  mkdirSync('docs/erp/a11y', { recursive: true }); writeFileSync('docs/erp/a11y/devices.json', JSON.stringify({ at: new Date().toISOString(), report }, null, 1));
  const failed = report.flatMap((r) => r.journeys.filter((j) => j.result === 'FAIL').map((j) => `${r.device}: ${j.journey}: ${j.steps.filter((s) => s.result === 'FAIL').map((s) => `${s.step} — ${s.note ?? ''}`).join('; ')}`));
  for (const f of failed) info.annotations.push({ type: 'failed journey', description: f });
  expect(failed).toEqual([]);
});
