import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 166.3 in the browser, on the mobile project (360 px):
//  T-01 each field role reaches its daily task in one tap from Home (a field tile, or the bottom bar for a manager), the task's first screen has its
//       primary action, so starting the task is the second tap;
//  T-03 the field pages in Telugu: Telugu text, no missing key, the Telugu typeface, nothing scrolls sideways at 360 px;
//  T-04 a 4 MB camera photo leaves the phone at 300 KB or less with the time and the position burnt in, and the server keeps it at that size.
// T-02 (a DPR made offline, sent once when the signal returns, no duplicate) is e2e/site-dpr.spec.js, which now runs through this part's photo path.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function world(request, code) {
  const c = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', c, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, c, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, c, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' });
  const project = await api(request, c, 'PM', `pm-${code}`, 'post', '/iam/org/projects', { code: `${code}P`, name: 'Ring road package 2', type: 'ROAD' });
  const site = await api(request, c, 'PM', `pm-${code}`, 'post', '/iam/org/sites', { code: `${code}S`, name: 'Km 4 camp', projectId: project.id });
  const db = new DatabaseSync(process.env.DATABASE_PATH ?? 'data/e2e.sqlite');
  db.prepare("UPDATE org_sites SET status = 'ACTIVE' WHERE id = ?").run(site.id); // a new site is a draft; the field works on active ones
  db.close();
  return { c, project, site };
}
const open = async (browser, info, c, roles, user, path, { language = 'en', geolocation } = {}) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {}) });
  const page = await context.newPage();
  await page.addInitScript(([v, lang]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: lang })); }, [{ user, roles, company: String(c) }, language]);
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
const OUT = 'docs/erp/screenshots/166.3';

// role, the tile (or bottom-bar slot) of the daily task, where it opens, the heading there
const ROLES = [
  ['SE', 'field-tile-dpr', '/site/dpr-entry', /Daily Progress Report Entry/],
  ['CSUP', 'field-tile-dpr', '/site/dpr-entry', /Daily Progress Report Entry/], // the supervisor's report; gang attendance needs att.punch.crew, which CSUP does not hold (D-678)
  ['WSUP', 'field-tile-crew-attendance', '/att/crew-punch', /Crew Punch/],
  ['PMSUP', 'field-tile-equipment-log', '/plant/log-entry', /Daily Equipment Log/],
  ['SK', 'field-tile-grn', '/inv/grn-new', /GRN/],
  ['QCE', 'field-tile-inspection', '/qa/perform', /Inspection/],
  ['HSEE', 'field-tile-observation', '/hse/observation', /Observation/],
  ['CM', 'bottom-field-approvals', '/field/approvals', /Approvals/],
];

test('T-01 FR-01 FR-02 each field role reaches its daily task in one tap from Home; the task opens on its first step', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone');
  test.setTimeout(240_000);
  const w = await world(request, 'FT1');
  const problems = [];
  for (const [role, target, route, heading] of ROLES) {
    const { page } = await open(browser, info, w.c, role, `e2e-${role.toLowerCase()}-ft1`, '/');
    const errors = watch(page);
    await expect(page.locator('main')).toBeVisible();
    if (role !== 'CM') await expect(page, `${role} lands on the field home`).toHaveURL(/\/field$/);
    await page.waitForLoadState('networkidle');
    let taps = 0;
    await page.getByTestId(target).click(); taps += 1;
    await expect(page, `${role}: one tap opens ${route}`).toHaveURL(new RegExp(`${route.replace(/\//g, '\\/')}(\\?|$)`));
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(heading);
    await expect(page.getByTestId('no-permission'), `${role} may use ${route}`).toHaveCount(0);
    // the second tap starts the task: a control of the task itself is on the first screen (a fresh company may show the task's own empty state,
    // whose action is then that control), with no further navigation through the menu
    const action = page.locator('main section').first().locator('button, a, select, input, label.btn').first().or(page.getByTestId('empty-state')); // an approvals list with nothing waiting is its own answer
    await expect(action, `${role}: the task's first action is on the screen`).toBeVisible();
    if (taps > 1) problems.push(`${role}: ${taps} taps`);
    if (await overflow(page) > 0) problems.push(`${role}: ${route} scrolls sideways`);
    if (role === 'SE') await page.screenshot({ path: `${OUT}/after-dpr-one-tap-mobile.png` });
    if (errors.length) problems.push(`${role}: ${errors.join(' | ')}`);
  }
  expect(problems).toEqual([]);
});

test('FR-01 the field home: greeting band, today\'s tasks from the records, quick actions of the role, what is not sent yet', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone');
  const w = await world(request, 'FT2');
  const { page } = await open(browser, info, w.c, 'SE', 'e2e-se-ft2', '/field');
  const errors = watch(page);
  await expect(page.getByTestId('field-band').getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), e2e-se-ft2/);
  await expect(page.getByTestId('field-today-dpr')).toHaveAttribute('data-count', '1'); // the active site has no DPR sent today
  await expect(page.getByTestId('field-tile-dpr')).toHaveAttribute('data-tone', 'amber');
  await expect(page.getByTestId('field-tile-material-request')).toHaveCount(0);
  await expect(page.getByTestId('sync-count')).toContainText('Nothing is waiting to be sent');
  await page.evaluate(() => { localStorage.setItem('erp.sync.queue', JSON.stringify([{ id: 'p1', label: 'Punch', at: '2026-11-02T04:00:00Z' }, { id: 'p2', label: 'DPR', at: '2026-11-02T04:01:00Z' }])); window.dispatchEvent(new StorageEvent('storage', { key: 'erp.sync.queue' })); });
  await expect(page.getByTestId('sync-count')).toContainText('Not sent yet (2)');
  await page.evaluate(() => { localStorage.setItem('erp.sync.queue', '[]'); window.dispatchEvent(new StorageEvent('storage', { key: 'erp.sync.queue' })); });
  const bottom = page.getByTestId('bottom-nav');
  await expect(bottom.getByRole('link')).toHaveText(['Home', 'Tasks', 'Scan', 'Messages']);
  await page.screenshot({ path: `${OUT}/after-field-home-mobile.png`, fullPage: true });
  await page.getByTestId('field-today-dpr').click();
  await expect(page).toHaveURL(/\/site\/dpr-entry/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // a project manager's bar has Approvals in place of My Work
  const pm = (await open(browser, info, w.c, 'PM', 'e2e-pm-ft2', '/home')).page;
  await expect(pm.getByTestId('bottom-nav').getByRole('link')).toHaveText(['Home', 'Approvals', 'Scan', 'Messages']);
  expect(errors).toEqual([]);
});

test('FR-01 the field home on a desktop: the same band, cards and tiles, laid out wide', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'the desktop');
  const w = await world(request, 'FT5');
  const { page } = await open(browser, info, w.c, 'SE', 'e2e-se-ft5', '/field');
  const errors = watch(page);
  await expect(page.getByTestId('field-band').getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), e2e-se-ft5/);
  await expect(page.getByTestId('field-today-dpr')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('field-tile-dpr')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT}/after-field-home-desktop.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('T-03 FR-07 the field pages in Telugu: Telugu text, no missing key, the Telugu typeface, nothing scrolls sideways at 360 px', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone');
  test.setTimeout(120_000);
  const w = await world(request, 'FT3');
  const { page } = await open(browser, info, w.c, 'SE', 'e2e-se-ft3', '/field', { language: 'te' });
  const errors = watch(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'te');
  await expect(page.getByTestId('field-title')).toHaveText('ఫీల్డ్ హోమ్');
  await expect(page.getByTestId('field-band').getByRole('heading', { level: 1 })).toContainText(/శుభోదయం|నమస్కారం|శుభ సాయంత్రం/);
  await expect(page.getByTestId('field-online')).toContainText('ఆన్‌లైన్');
  await expect(page.getByTestId('field-tile-dpr')).toContainText('రోజువారీ ప్రగతి నివేదిక');
  await expect(page.getByTestId('bottom-nav').getByRole('link')).toHaveText(['హోమ్', 'పనులు', 'స్కాన్', 'సందేశాలు']);
  const font = await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load('16px "Noto Sans Telugu"', 'తెలుగు'); return document.fonts.check('16px "Noto Sans Telugu"', 'తెలుగు'); });
  expect(font, 'the Telugu typeface is served by the application').toBe(true);
  await page.screenshot({ path: `${OUT}/after-field-home-telugu-mobile.png`, fullPage: true });
  const problems = [];
  for (const path of ['/field', '/field/scan', `/site/dpr-entry?siteId=${w.site.id}`, '/field/sync', '/account/profile']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    if (path.startsWith('/site/dpr-entry')) { await page.getByTestId('dpr-start').click(); await expect(page.getByTestId('dpr-work')).toBeVisible(); }
    const missing = await page.evaluate(() => [...(window.__erpMissingKeys ?? [])].filter((k) => /^te\.(common|shell|palette|field|format|site\.dpr)\./.test(k)));
    if (missing.length) problems.push(`${path}: missing ${missing.join(', ')}`);
    const o = await overflow(page);
    if (o > 0) problems.push(`${path}: scrolls sideways by ${o}px`);
    const cut = await page.evaluate(() => [...document.querySelectorAll('main h1, main h2, main .btn, .sh-bottom a, .field-tiles strong')].filter((e) => e.getClientRects().length && getComputedStyle(e).overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 30)));
    if (cut.length) problems.push(`${path}: cut off ${cut.join(', ')}`);
    if (path.startsWith('/site/dpr-entry')) await page.screenshot({ path: `${OUT}/after-dpr-telugu-mobile.png`, fullPage: true });
  }
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('T-04 FR-03 a 4 MB camera photo is stored at 300 KB or less, with the time and position burnt in', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone');
  test.setTimeout(180_000);
  const w = await world(request, 'FT4');
  const { page } = await open(browser, info, w.c, 'SE', 'e2e-se-ft4', `/site/dpr-entry?siteId=${w.site.id}`, { geolocation: { latitude: 17.385044, longitude: 78.486671, accuracy: 12 } });
  const errors = watch(page);
  await page.getByTestId('dpr-start').click();
  await expect(page.getByTestId('dpr-work')).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByTestId('dpr-next').click(); // work, labour, materials, equipment and notes, then photos
  await expect(page.getByTestId('dpr-photos')).toBeVisible();
  // a camera-sized picture (4000 x 3000) of fine detail, which a JPEG cannot shrink much: what a phone writes for a busy site scene
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    const x = c.getContext('2d'); const img = x.createImageData(4000, 3000);
    let s = 12345; for (let i = 0; i < img.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = s & 255; img.data[i] = v; img.data[i + 1] = (v * 7) & 255; img.data[i + 2] = (v * 13) & 255; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.6));
    const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const buffer = Buffer.from(b64, 'base64');
  expect(buffer.length, 'the camera photo is at least 4 MB').toBeGreaterThanOrEqual(4 * 1024 * 1024);
  await page.getByTestId('dpr-photo-input').setInputFiles([{ name: 'IMG_20261116_101500.jpg', mimeType: 'image/jpeg', buffer }]);
  const line = page.getByTestId('dpr-photo-line');
  await expect(line).toBeVisible({ timeout: 60_000 });
  const text = await line.textContent();
  const after = Number(/made (\d+) KB/.exec(text)?.[1]);
  expect(after, text).toBeGreaterThan(0);
  expect(after, 'at most 300 KB on the phone').toBeLessThanOrEqual(300);
  await expect(page.getByTestId('dpr-photo-stamp')).toContainText(/\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST · 17\.38504, 78\.48667 ±12 m/);
  await page.screenshot({ path: `${OUT}/after-photo-stamp-mobile.png`, fullPage: true });
  await page.getByTestId('dpr-next').click();
  await page.getByTestId('dpr-save').click();
  // the draft and its photo reach the server through the offline engine; the stored file is the small one
  await expect.poll(() => {
    const db = new DatabaseSync(process.env.DATABASE_PATH ?? 'data/e2e.sqlite', { readOnly: true });
    try { return db.prepare("SELECT f.size_bytes AS n FROM core_files f JOIN site_dprs d ON d.id = f.linked_id WHERE f.linked_entity = 'site_dpr' AND d.company_id = ? ORDER BY f.id DESC LIMIT 1").get(w.c)?.n ?? 0; } finally { db.close(); }
  }, { timeout: 60_000 }).toBeGreaterThan(0);
  const db = new DatabaseSync(process.env.DATABASE_PATH ?? 'data/e2e.sqlite', { readOnly: true });
  const stored = db.prepare("SELECT f.size_bytes AS n, f.mime FROM core_files f JOIN site_dprs d ON d.id = f.linked_id WHERE f.linked_entity = 'site_dpr' AND d.company_id = ? ORDER BY f.id DESC LIMIT 1").get(w.c);
  db.close();
  expect(stored.mime).toBe('image/jpeg');
  expect(stored.n, 'the server keeps at most 300 KB').toBeLessThanOrEqual(300 * 1024);
  expect(errors).toEqual([]);
});
