import { test, expect } from '@playwright/test';
import { buildExifSegment, readExif } from '../src/client/platform/device/exif.js';
import { menu, userMenu } from './shell-helpers.js';

// Development-header mode (port 3100). The field side of part 03.06: the field home of a site person, the layouts by width, the scanner (typed,
// photographed and by camera), the position read once with its notice, a photo made smaller with its EXIF kept, touch targets, swipe and pull.
// The camera is Chrome's fake one and the code reader a stand-in, so the page's own handling is what is tested: that real Android Chrome and
// iOS Safari behave the same is a check on a device (D-146 in DEFECTS.md).
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const as = async (browser, info, company, roles, user, path, { geolocation, init } = {}) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {}) });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  if (init) await page.addInitScript(init);
  await page.goto(path);
  return page;
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const current = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup') });
  const version = current.ok() ? (await current.json()).data?.version : undefined;
  expect((await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } })).status()).toBe(200);
  for (const [path, data] of [['/core/financial-years', { startDate: '2026-04-01' }], ['/core/number-series', { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' }]]) {
    const res = await request.post(`/api/v1${path}`, { headers: H('SYSADM', company, 'e2e-setup'), data });
    expect([201, 409], `${path}: ${await res.text()}`).toContain(res.status());
  }
  const project = await post('/iam/org/projects', 'PM', company, { code: `${code}-P`, name: 'NH-48 Widening', type: 'ROAD' });
  const site = await post('/iam/org/sites', 'PM', company, { code: `${code}-S1`, name: 'Km 12 camp', projectId: project.id });
  const r = await post('/ui/sample-requests', 'PM', company, { title: 'Footing F3 reinforcement', docDate: '2026-10-31', requiredBy: '2026-11-20', projectId: project.id, siteId: site.id, lines: [{ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }] }, 'e2e-pm');
  const request1 = await post(`/ui/sample-requests/${r.id}/submit`, 'PM', company, { version: r.version }, 'e2e-pm');
  return { company, request: request1 };
}

/** The controls a thumb has to hit that are smaller than 44 px (links inside a sentence are exempt). */
const smallTargets = (page) => page.evaluate(() => [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]')]
  .filter((e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && !e.closest('.visually-hidden, .skip, [hidden], p, dd') && !e.classList.contains('visually-hidden'); })
  .filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43 || r.width < 43; })
  .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 28)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));

test('FR-07 BR-01 a site person lands on the field home: quick actions for the role, whether the device is online, what waits to be sent, and the location notice', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const w = await world(request, pick(info, 'FLDD', 'FLDM'));
  const page = await as(browser, info, w.company, 'SE', pick(info, 'e2e-se-d', 'e2e-se-m'), '/');
  const errors = watch(page);
  await expect(page).toHaveURL(/\/field$/);
  // part 166.3 (ff.field.p16603 ON in test): the field home opens with a greeting band; the heading is the greeting
  await expect(page.getByTestId('field-band').getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), e2e-se/);
  await expect(page.getByTestId('field-tile-scan')).toBeVisible();
  await expect(page.getByTestId('field-tile-drafts')).toBeVisible();
  await expect(page.getByTestId('field-tile-material-request')).toHaveCount(0); // a site engineer does not raise these here
  await expect(page.getByTestId('location-notice')).toContainText('read once');
  await expect(page.getByTestId('field-online')).toHaveAttribute('data-online', 'true');
  await expect(page.getByTestId('sync-count')).toContainText('Nothing is waiting to be sent');
  // something waiting to be sent (the offline engine of 04.15 will fill this; here another tab's change is simulated)
  await page.evaluate(() => { localStorage.setItem('erp.sync.queue', JSON.stringify([{ id: 'p1', label: 'Punch', at: '2026-11-02T04:00:00Z' }])); window.dispatchEvent(new StorageEvent('storage', { key: 'erp.sync.queue' })); });
  await expect(page.getByTestId('sync-count')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('sync-count')).toContainText('Not sent yet (1)'); // the wording of part 166.3
  await page.context().setOffline(true);
  await expect(page.getByTestId('field-online')).toHaveAttribute('data-online', 'false');
  await expect(page.getByTestId('field-online')).toContainText('Offline');
  await page.context().setOffline(false);
  await expect(page.getByTestId('field-online')).toHaveAttribute('data-online', 'true');
  // a person with an office role has the launchpad; on the field home the project manager's tiles are their own (part 166.3: the 03.06 sample
  // material request gives way to the daily progress report and the approvals on the phone)
  const pm = await as(browser, info, w.company, 'PM', pick(info, 'e2e-pm-d', 'e2e-pm-m'), '/');
  await expect(pm).toHaveURL(/\/home$/);
  await pm.goto('/field');
  await expect(pm.getByTestId('field-tile-phone-approvals')).toContainText('Approvals');
  await expect(pm.getByTestId('field-tile-material-request')).toHaveCount(0);
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-01 on a phone the bottom navigation has Home, Tasks (My Work), Scan and More; More opens the whole menu; every target is thumb-sized', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone layout');
  const w = await world(request, 'FLDB');
  const page = await as(browser, info, w.company, 'SE', 'e2e-se-bottom', '/');
  const errors = watch(page);
  const bottom = page.getByTestId('bottom-nav');
  await expect(bottom).toBeVisible();
  await expect(bottom.getByRole('link')).toHaveText(['Home', 'Tasks', 'Scan', 'Messages']); // Messages since 05.01; My Work is called Tasks from 166.3
  await expect(bottom.getByRole('button', { name: 'Open menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(1); // the header has no second menu button
  await expect(page.getByTestId('bottom-home')).toHaveAttribute('aria-current', 'page');
  expect((await bottom.boundingBox()).y + (await bottom.boundingBox()).height).toBeCloseTo(740, -1); // fixed at the bottom of the screen
  expect(await smallTargets(page), 'Field Home').toEqual([]);
  await page.getByTestId('bottom-scan').click();
  await expect(page.getByRole('heading', { name: 'Scan', level: 1 })).toBeVisible();
  await expect(page.getByTestId('bottom-scan')).toHaveAttribute('aria-current', 'page');
  expect(await smallTargets(page), 'Scanner').toEqual([]);
  await page.getByTestId('bottom-work').click();
  await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
  const nav = await menu(page);
  await expect(nav.getByRole('link', { name: 'Field Home' })).toBeVisible();
  await nav.getByRole('link', { name: 'Field Home' }).click();
  await expect(page.getByTestId('field-band')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden(); // the menu closes once a page is chosen
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-01 a tablet has a rail that opens on demand, a computer the full sidebar', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set by the test itself');
  const w = await world(request, 'FLDT');
  const page = await as(browser, info, w.company, 'PM', 'e2e-pm-tablet', '/home');
  const widthOfNav = () => page.getByRole('navigation', { name: 'Main' }).evaluate((el) => el.getBoundingClientRect().width);
  for (const [width, layout] of [[1920, 'desktop'], [1280, 'desktop'], [1024, 'desktop'], [800, 'tablet'], [768, 'tablet'], [360, 'phone']]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-layout', layout);
    await noOverflow(page);
    if (layout === 'desktop') expect(await widthOfNav()).toBeGreaterThan(200);
    if (layout === 'tablet') expect(await widthOfNav(), `${width} px`).toBeLessThan(80);
    if (layout === 'phone') await expect(page.getByTestId('bottom-nav')).toBeVisible();
    else await expect(page.getByTestId('bottom-nav')).toBeHidden();
  }
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: 'Expand menu' }).click();
  expect(await widthOfNav()).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  expect(await widthOfNav()).toBeLessThan(80);
});

test('FR-04 the scanner takes a typed number to the record, tells a wrong code from one it may not open, and reads a code with the camera', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const w = await world(request, pick(info, 'FLDS', 'FLDN'));
  const init = () => {
    window.BarcodeDetector = class { async detect() { return window.__code ? [{ rawValue: window.__code, format: 'qr_code' }] : []; } };
    window.__vibrations = [];
    navigator.vibrate = (p) => { window.__vibrations.push(p); return true; };
  };
  const page = await as(browser, info, w.company, 'PM', pick(info, 'e2e-scan-pm-d', 'e2e-scan-pm-m'), '/field/scan', { init });
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Scan', level: 1 })).toBeVisible();
  await expect(page.getByTestId('no-scans')).toBeVisible();
  // typed, or from a scanner gun that types and presses Enter
  await page.getByTestId('scan-typed').fill(w.request.docNo);
  await page.getByTestId('scan-typed').press('Enter');
  await expect(page.getByRole('heading', { name: w.request.docNo })).toBeVisible();
  expect(await page.evaluate(() => window.__vibrations)).toEqual([[30]]);
  // a code nobody knows
  await page.goto('/field/scan');
  await page.getByTestId('scan-typed').fill('NOT-A-CODE-77');
  await page.getByRole('button', { name: 'Look it up' }).click();
  await expect(page.getByTestId('scan-error')).toContainText('Nothing found for NOT-A-CODE-77');
  await expect(page.getByTestId('scan-error')).toContainText('not one this application knows');
  await expect(page.getByTestId('scan-error')).toContainText('Correlation ID');
  expect((await page.evaluate(() => window.__vibrations)).at(-1)).toEqual([140]);
  await page.getByTestId('scan-typed').fill('');
  await page.getByRole('button', { name: 'Look it up' }).click();
  await expect(page.getByTestId('scan-message')).toContainText('Type or scan a code first');
  // the recent scans of this session
  await expect(page.getByRole('list', { name: 'Recent scans' }).getByRole('button', { name: new RegExp(w.request.docNo.replace(/\//g, '\\/')) })).toBeVisible();
  // by camera: the fake camera shows a picture, the reader stand-in finds the code in it, the phone vibrates and the record opens
  await page.getByTestId('scan-camera').click();
  await expect(page.getByTestId('scan-video')).toBeVisible();
  await expect(page.getByTestId('scan-message')).toContainText('Point the camera at the code');
  await page.evaluate((code) => { window.__code = code; }, `ERP:SAMPLE_REQUEST:${w.request.id}`);
  await expect(page.getByRole('heading', { name: w.request.docNo })).toBeVisible();
  expect((await page.evaluate(() => window.__vibrations)).at(-1)).toEqual([30]);
  // a person who may not open requests is told the same as for a wrong code
  const se = await as(browser, info, w.company, 'SE', pick(info, 'e2e-scan-se-d', 'e2e-scan-se-m'), '/field/scan');
  await se.getByTestId('scan-typed').fill(w.request.docNo);
  await se.getByRole('button', { name: 'Look it up' }).click();
  await expect(se.getByTestId('scan-error')).toContainText('names something you cannot open');
  expect(errors).toEqual([]);
});

test('FR-04 the scanner says so when the camera cannot be used, and the typed way still works', async ({ browser, request }, info) => {
  const w = await world(request, pick(info, 'FLDX', 'FLDY'));
  const init = () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); window.BarcodeDetector = class { async detect() { return []; } }; };
  const page = await as(browser, info, w.company, 'PM', pick(info, 'e2e-nocam-d', 'e2e-nocam-m'), '/field/scan', { init });
  await page.getByTestId('scan-camera').click();
  await expect(page.getByTestId('scan-message')).toContainText('The camera could not be opened');
  await expect(page.getByTestId('scan-video')).toHaveCount(0);
  await page.getByTestId('scan-typed').fill(w.request.docNo);
  await page.getByTestId('scan-typed').press('Enter');
  await expect(page.getByRole('heading', { name: w.request.docNo })).toBeVisible();
  // a browser that cannot read codes at all
  const plain = await as(browser, info, w.company, 'PM', pick(info, 'e2e-nodet-d', 'e2e-nodet-m'), '/field/scan', { init: () => { delete window.BarcodeDetector; } });
  await plain.getByTestId('scan-camera').click();
  await expect(plain.getByTestId('scan-message')).toContainText('cannot read codes with the camera');
});

test('BR-01 FR-04 the position is read once, on the button, with the notice; its accuracy and signs of a mocked position are shown; nothing is followed', async ({ browser }, info) => {
  const watched = () => { window.__watch = 0; const g = navigator.geolocation; const orig = g.watchPosition.bind(g); g.watchPosition = (...a) => { window.__watch += 1; return orig(...a); }; };
  const gps = (page) => page.locator('[data-testid^="gallery-"]').filter({ has: page.locator('.ff-gps') }).first();
  // an exact-looking reading: round numbers and a claimed accuracy under a metre
  const page = await as(browser, info, 1, 'SYSADM', pick(info, 'e2e-gps-d', 'e2e-gps-m'), '/admin/design-system/forms', { geolocation: { latitude: 18.52, longitude: 73.857, accuracy: 0.5 }, init: watched });
  const errors = watch(page);
  await expect(gps(page).getByTestId('location-notice').first()).toContainText('read once');
  await gps(page).getByRole('button', { name: 'Use my position' }).first().click();
  await expect(gps(page).getByText(/Position captured/).first()).toBeVisible();
  await expect(gps(page).getByLabel('Latitude').first()).toHaveValue('18.520000');
  await expect(gps(page).getByTestId('gps-hints').first()).toContainText('better than one metre');
  await expect(gps(page).getByTestId('gps-hints').first()).toContainText('round numbers');
  // a believable reading: fair accuracy, no hints
  await page.context().setGeolocation({ latitude: 18.520431, longitude: 73.856744, accuracy: 35 });
  await gps(page).getByRole('button', { name: 'Use my position' }).first().click();
  await expect(gps(page).getByLabel('Latitude').first()).toHaveValue('18.520431');
  await expect(gps(page).getByText(/Accurate to 35 m/).first()).toBeVisible();
  await expect(gps(page).getByTestId('gps-hints')).toHaveCount(0);
  // a weak fix tells the person what to do
  await page.context().setGeolocation({ latitude: 18.520431, longitude: 73.856744, accuracy: 400 });
  await gps(page).getByRole('button', { name: 'Use my position' }).first().click();
  await expect(gps(page).getByText(/Move into the open/).first()).toBeVisible();
  expect(await page.evaluate(() => window.__watch), 'the position is never followed').toBe(0);
  // refused
  const refused = await as(browser, info, 1, 'SYSADM', pick(info, 'e2e-gps2-d', 'e2e-gps2-m'), '/admin/design-system/forms', { init: () => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1, message: 'User denied' }); } });
  await gps(refused).getByRole('button', { name: 'Use my position' }).first().click();
  await expect(gps(refused).getByText(/Location permission was refused/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('BR-02 FR-04 FR-06 a photo is made smaller before it goes anywhere, the time and position the camera wrote stay in it, and low-bandwidth mode makes it smaller still', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const page = await as(browser, info, 1, 'SYSADM', pick(info, 'e2e-photo-d', 'e2e-photo-m'), '/admin/design-system/forms');
  const errors = watch(page);
  // a 3000 x 2000 photo as a phone camera would write it: turned on its side (orientation 6), with the time and the position
  const facts = { takenAt: '2026-10-30T10:15:42', gps: { lat: 18.520431, lng: 73.856744 }, orientation: 6 };
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const g = c.getContext('2d');
    for (let i = 0; i < 400; i += 1) { g.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 40)}%)`; g.fillRect((i * 97) % 3000, (i * 53) % 2000, 300 + (i % 200), 200 + (i % 150)); }
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  const plain = Buffer.from(base64, 'base64');
  const segment = Buffer.from(buildExifSegment(facts));
  const original = Buffer.concat([plain.subarray(0, 2), segment, plain.subarray(2)]);
  expect(readExif(original).orientation).toBe(6);
  const row = page.locator('[data-testid^="gallery-"]').filter({ has: page.locator('.ff-photo') }).first();
  const choose = (buffer) => row.locator('input[type="file"]').first().setInputFiles({ name: 'site-photo.jpg', mimeType: 'image/jpeg', buffer });
  await choose(original);
  const summary = row.getByTestId('photo-summary').first();
  await expect(summary).toContainText('site-photo.jpg');
  await expect(summary).toContainText('made');
  await expect(summary).toContainText('1067 x 1600'); // turned upright, the long side 1600
  await expect(summary).toContainText('taken 2026-10-30 10:15');
  await expect(summary).toContainText('position 18.52043, 73.85674');
  const out = Buffer.from((await row.locator('img.ff-photo-img').first().getAttribute('src')).split(',')[1], 'base64');
  expect(out.length).toBeLessThan(original.length / 2);
  const kept = readExif(out);
  expect(kept.takenAt).toBe('2026-10-30T10:15:42');
  expect(Math.abs(kept.gps.lat - 18.520431)).toBeLessThan(0.00001);
  expect(kept.orientation, 'the pixels are already upright').toBe(1);
  // low-bandwidth mode: smaller again
  await (await userMenu(page)).getByTestId('lowbw-select').selectOption('on');
  await page.keyboard.press('Escape');
  await choose(original);
  await expect(summary).toContainText('683 x 1024');
  await expect(summary).toContainText('taken 2026-10-30 10:15');
  // a photo that says nothing about itself says so; one already small is sent as it is; a file that is no photo is refused
  const small = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; c.getContext('2d').fillRect(0, 0, 320, 240); return c.toDataURL('image/jpeg', 0.5).split(',')[1]; });
  await choose(Buffer.from(small, 'base64'));
  await expect(summary).toContainText('320 x 240, no time or position in the file');
  await row.locator('input[type="file"]').first().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  await expect(row.getByText('Choose a photo (JPEG, PNG or WebP).').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('FR-05 on a phone a list row is swiped to show its actions, and a pull down refreshes the list', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch gestures');
  const w = await world(request, 'FLDG');
  const page = await as(browser, info, w.company, 'PM', 'e2e-swipe-pm', '/admin/sample-requests');
  const errors = watch(page);
  const card = page.getByTestId('list-card').first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('group', { name: /Actions for/ })).toHaveCount(0);
  // the same actions are reachable without a gesture
  await expect(card.getByRole('button', { name: /^Actions for/ })).toBeVisible();
  const touch = (type, x, y, target) => page.evaluate(([t, px, py, sel]) => {
    const el = sel ? document.querySelector(sel) : document;
    const touch = new Touch({ identifier: 1, target: el === document ? document.body : el, clientX: px, clientY: py });
    const init = { bubbles: true, cancelable: true, touches: t === 'touchend' ? [] : [touch], targetTouches: t === 'touchend' ? [] : [touch], changedTouches: [touch] };
    (el === document ? window : el).dispatchEvent(new TouchEvent(t, init));
  }, [type, x, y, target]);
  await touch('touchstart', 300, 200, '[data-testid="list-card"]');
  await touch('touchend', 120, 205, '[data-testid="list-card"]');
  await expect(card.getByRole('group', { name: /Actions for/ })).toBeVisible();
  await expect(card.getByRole('group', { name: /Actions for/ }).getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await touch('touchstart', 120, 200, '[data-testid="list-card"]');
  await touch('touchend', 300, 200, '[data-testid="list-card"]');
  await expect(card.getByRole('group', { name: /Actions for/ })).toHaveCount(0);
  // pull to refresh: a drag down from the top of the page asks the server again
  const asked = page.waitForResponse((r) => r.url().includes('/api/v1/ui/sample-requests') && !r.url().includes('/export') && r.request().method() === 'GET' && r.status() === 200);
  await touch('touchstart', 180, 100, null);
  await touch('touchmove', 180, 140, null);
  await expect(page.getByText('Pull down to refresh')).toBeVisible();
  await touch('touchmove', 180, 260, null);
  await expect(page.getByText('Let go to refresh')).toBeVisible();
  await touch('touchend', 180, 260, null);
  await asked;
  await expect(page.getByText('Let go to refresh')).toHaveCount(0);
  await expect(page.getByTestId('list-card').first()).toBeVisible();
  expect(errors).toEqual([]);
});
