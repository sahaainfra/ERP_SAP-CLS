import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BREAKPOINTS, FIELD_ROLES, landsOnField, layoutFor } from '../src/shared/device/breakpoints.js';
import { lowBandwidthFrom } from '../src/client/platform/device/lowBandwidth.js';
import { accuracyRating, mockHints, positionProblem, readPosition } from '../src/client/platform/device/location.js';
import { PATTERNS, vibrate } from '../src/client/platform/device/haptics.js';
import { pullState, swipeDirection } from '../src/client/platform/device/gestures.js';
import { describePhoto, limitsFor } from '../src/client/platform/device/camera.js';
import { keyBytes } from '../src/client/platform/device/push.js';
import { syncQueue } from '../src/client/platform/device/syncQueue.js';
import { installDismissed } from '../src/client/platform/device/pwa.js';
import { ICONS, pngSize } from '../scripts/build_pwa_assets.mjs';

// Part 03.06: the pure rules of the device layer: layouts by width, the field roles, low-bandwidth, position hints, gestures, vibration, photos,
// the queue, and the installable app's files.
test('FR-01 five breakpoints and three layouts; site roles land on the field home, others do not', () => {
  assert.deepEqual(BREAKPOINTS, { phone: 360, tablet: 768, laptop: 1024, desktop: 1280, wide: 1920 });
  assert.deepEqual([360, 767, 768, 1023, 1024, 1280, 1920].map(layoutFor), ['phone', 'phone', 'tablet', 'tablet', 'desktop', 'desktop', 'desktop']);
  assert.deepEqual(FIELD_ROLES, ['SE', 'CSUP', 'WSUP', 'SK', 'PMSUP', 'QCE', 'HSEE', 'GUARD', 'EMP']);
  assert.equal(landsOnField(['SE']), true);
  assert.equal(landsOnField(['SK', 'EMP']), true);
  assert.equal(landsOnField(['PM']), false);
  assert.equal(landsOnField(['SE', 'PM']), false, 'a person with an office role keeps the launchpad');
  assert.equal(landsOnField([]), false);
  assert.equal(landsOnField(undefined), false);
});

test('FR-06 low-bandwidth mode follows the person, else the data saver or a slow connection', () => {
  assert.equal(lowBandwidthFrom('on', { saveData: false, effectiveType: '4g' }), true);
  assert.equal(lowBandwidthFrom('off', { saveData: true, effectiveType: '2g' }), false);
  assert.equal(lowBandwidthFrom('auto', { saveData: true }), true);
  for (const t of ['slow-2g', '2g']) assert.equal(lowBandwidthFrom('auto', { effectiveType: t }), true, t);
  for (const t of ['3g', '4g']) assert.equal(lowBandwidthFrom('auto', { effectiveType: t }), false, t);
  assert.equal(lowBandwidthFrom('auto', undefined), false, 'a browser that does not say');
  const settings = { image: { maxPx: 1600, quality: 0.8 }, lowBandwidth: { maxPx: 1024, quality: 0.6 } };
  assert.deepEqual([limitsFor(settings, false).maxPx, limitsFor(settings, true).maxPx], [1600, 1024]);
});

test('BR-01 FR-04 the position is read once; accuracy is rated and signs of a mocked position are reported as hints', async () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  const fix = { lat: 18.520431, lng: 73.856744, accuracy: 12, timestamp: now - 3000 };
  assert.deepEqual(mockHints(fix, { nowMs: now }), []);
  const codes = (p, o) => mockHints({ ...fix, ...p }, { nowMs: now, ...o }).map((h) => h.code);
  assert.deepEqual(codes({ accuracy: 0 }), ['accuracy_exact']);
  assert.deepEqual(codes({ lat: 18.52, lng: 73.857 }), ['rounded']);
  assert.deepEqual(codes({ timestamp: now - 5 * 60_000 }), ['stale']);
  assert.deepEqual(codes({ timestamp: now + 5 * 60_000 }), ['future']);
  assert.deepEqual(codes({ mocked: true }), ['device_says_mocked']);
  assert.deepEqual(codes({ timestamp: now - 1000 }, { previous: { ...fix } }), ['repeat']);
  assert.deepEqual(codes({}, { previous: { ...fix, lat: 18.5 } }), []);
  assert.deepEqual([accuracyRating(8).level, accuracyRating(60).level, accuracyRating(400).level, accuracyRating(null).level], ['good', 'fair', 'poor', 'poor']);
  assert.match(accuracyRating(400).text, /Move into the open/);
  // one reading through the browser's one-shot call
  const calls = [];
  const geolocation = { getCurrentPosition: (ok, fail, opts) => { calls.push(opts); ok({ coords: { latitude: 18.520431, longitude: 73.856744, accuracy: 14.4, altitude: null }, timestamp: now }); } };
  const p = await readPosition({ geolocation, nowMs: () => now });
  assert.deepEqual([p.lat, p.lng, p.accuracy, p.capturedAt, p.rating.level], [18.520431, 73.856744, 14.4, '2026-11-02T10:00:00.000Z', 'good']);
  assert.deepEqual(calls, [{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }], 'a fresh reading, never an old one');
  for (const [code, reason] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
    await assert.rejects(() => readPosition({ geolocation: { getCurrentPosition: (_ok, fail) => fail({ code, message: 'x' }) } }), (e) => e.reason === reason);
    assert.ok(positionProblem(reason).length > 20);
  }
  await assert.rejects(() => readPosition({ geolocation: undefined }), (e) => e.reason === 'unsupported');
});

test('BR-01 no background tracking: the browser\'s continuous position watching is not used anywhere in the client', () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const hits = walk('src/client').filter((f) => /\.(jsx?|mjs)$/.test(f)).filter((f) => readFileSync(f, 'utf8').includes('watchPosition'));
  assert.deepEqual(hits, []);
});

test('FR-04 FR-05 vibration is short, never for a person who asked for less motion, and silent where the device cannot', () => {
  const calls = [];
  const nav = { vibrate: (p) => { calls.push(p); return true; } };
  assert.equal(vibrate('success', { nav, reduced: false }), true);
  assert.deepEqual(calls, [PATTERNS.success]);
  assert.equal(vibrate('error', { nav, reduced: true }), false);
  assert.equal(vibrate('nonsense', { nav, reduced: false }), false);
  assert.equal(vibrate('success', { nav: {}, reduced: false }), false, 'iOS Safari');
  assert.equal(vibrate('success', { nav: undefined, reduced: false }), false);
  assert.equal(vibrate('success', { nav: { vibrate: () => { throw new Error('blocked'); } }, reduced: false }), false);
  assert.ok(Object.values(PATTERNS).flat().every((n) => n <= 200), 'nothing long');
});

test('FR-05 a swipe is a mostly-horizontal drag far enough; a pull to refresh starts at the top and is ready past its threshold', () => {
  assert.equal(swipeDirection(-80, 5), 'left');
  assert.equal(swipeDirection(80, 5), 'right');
  assert.equal(swipeDirection(-30, 0), null, 'too short');
  assert.equal(swipeDirection(-80, 70), null, 'the person is scrolling');
  assert.deepEqual(pullState(40), { pulling: true, ready: false, offset: 20 });
  assert.deepEqual(pullState(100), { pulling: true, ready: true, offset: 50 });
  assert.deepEqual(pullState(500), { pulling: true, ready: true, offset: 72 }, 'the indicator stops growing');
  assert.deepEqual(pullState(100, { atTop: false }), { pulling: false, ready: false, offset: 0 });
  assert.deepEqual(pullState(-10), { pulling: false, ready: false, offset: 0 });
});

test('BR-02 a prepared photo is described by what it carries; the key of the server is turned into bytes for the push manager', () => {
  assert.equal(describePhoto({ bytes: 310 * 1024, originalBytes: 4200 * 1024, width: 1600, height: 1200, takenAt: '2026-10-30T10:15:42', gps: { lat: 18.520431, lng: 73.856744 } }), '4200 KB made 310 KB, 1600 x 1200, taken 2026-10-30 10:15, position 18.52043, 73.85674');
  assert.match(describePhoto({ bytes: 80 * 1024, originalBytes: 80 * 1024, width: 800, height: 600, takenAt: null, gps: null }), /80 KB, 800 x 600, no time or position in the file/);
  assert.deepEqual([...keyBytes('AQID')], [1, 2, 3]);
  assert.equal(keyBytes('BNcRdreALm-RpXH8FMvOuR_BQzMyM0cZ3ROrQRnYvFBM6J8XaNtjRLgS0t9pzyxGsFy3I7TB4lYQVEPPpEUi9sU').length, 65);
});

test('FR-07 the queue of things waiting to be sent starts empty, never repeats an item and can be emptied', () => {
  syncQueue.clear();
  assert.equal(syncQueue.count(), 0);
  syncQueue.enqueue({ id: 'a', label: 'Punch' });
  syncQueue.enqueue({ id: 'a', label: 'Punch again' });
  syncQueue.enqueue({ id: 'b', label: 'DPR' });
  syncQueue.enqueue({ label: 'no id' });
  assert.deepEqual(syncQueue.list().map((x) => x.id), ['a', 'b']);
  let heard = 0;
  const off = syncQueue.subscribe(() => { heard += 1; });
  syncQueue.dequeue('a');
  assert.equal(syncQueue.count(), 1);
  syncQueue.clear();
  off();
  assert.equal(heard, 2);
  assert.equal(syncQueue.count(), 0);
});

test('FR-03 the manifest has what a browser needs to offer installation, and the icons are real PNGs of the sizes it names', () => {
  const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'id', 'icons']) assert.ok(m[k], `manifest.${k}`);
  assert.equal(m.display, 'standalone');
  assert.ok(m.short_name.length <= 12);
  assert.match(m.start_url, /^\//);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'the sizes a browser requires');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'an icon for round and squircle masks');
  for (const icon of m.icons) {
    const size = pngSize(readFileSync(`public${icon.src}`));
    assert.deepEqual([`${size.width}x${size.height}`, icon.type], [icon.sizes, 'image/png'], icon.src);
  }
  for (const i of ICONS) assert.ok(pngSize(readFileSync(`public/icons/${i.file}`)), i.file);
  for (const s of m.shortcuts) assert.ok(s.url.startsWith('/') && s.name, s.name);
  const html = readFileSync('index.html', 'utf8');
  for (const needle of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="theme-color"', 'viewport-fit=cover']) assert.ok(html.includes(needle), needle);
});

test('FR-03 the service worker keeps the shell and a short list of calls, and nothing of the business data', () => {
  const sw = readFileSync('src/client/sw.js', 'utf8');
  assert.ok(sw.includes("event.request") === false && sw.includes("if (request.method !== 'GET') return;"), 'only a GET is ever answered from the cache');
  assert.ok(sw.includes("'__BUILD_ID__'") && sw.includes("'__PRECACHE__'"), 'the build fills in its id and file list');
  const listed = /const OFFLINE_OK = \[(.*)\];/.exec(sw)[1];
  for (const sensitive of ['sample-requests', 'users', 'audit', 'approvals', 'lookups']) assert.ok(!listed.includes(sensitive), `${sensitive} is not kept for offline use`);
  assert.ok(sw.includes('x-erp-cache-scope'), 'copies are kept per person');
  assert.ok(sw.includes("'CLEAR_API'") && sw.includes("'SKIP_WAITING'"));
  assert.equal(installDismissed(), false);
});
