import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';
import { isBusinessPage } from '../src/server/modules/tst/a11y.js';
import { registeredPages } from '../src/server/modules/tst/pageaudit.js';

// Part 30.07: accessibility, responsive and device validation. Sweeps of every registered page (coverage, judgement, unknown routes refused),
// device journeys and screen-reader sessions, issues fixed and re-tested by the next passing run, BR-01 the verdict on business pages, the
// sign-off through the approval engine (asked by the UX lead, approved by the QA lead, never the same person), roles, export.
const T = '/api/v1/tst';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'idempotency-key': `a11y-${Date.now().toString(36)}-${(seq += 1)}` });
const qa = { roles: 'ITADM', user: 'qa-lead' }; const ux = { roles: 'SYSADM', user: 'ux-lead' }; const aud = { roles: 'AUD', user: 'aud1' }; const pm = { roles: 'PM', user: 'pm1' };
async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); enableFlags(api.db, 1, ['ff.qa.p3007']);
  for (const [u, r] of [['qa-lead', 'ITADM'], ['ux-lead', 'SYSADM']]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u, u, JSON.stringify([r]), `${u}@example.com`);
  return { api, d: api.db, call: (who, method, path, body) => api.call(method, `${T}${path}`, { ...who, headers: key(), body }) };
}
const routes = registeredPages().filter((p) => !p.onboardingOnly).map((p) => p.route);
const SERIOUS = [{ rule: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', nodes: 3, targets: ['.btn-ghost'] }];
const MINOR = [{ rule: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks', nodes: 1, targets: ['footer'] }];
async function sweep(t, who, width, bad = {}, kind = 'AXE') {
  let runId = null; let out = null;
  for (let i = 0; i < routes.length; i += 150) {
    const batch = routes.slice(i, i + 150).map((route) => ({ route, loadMs: 120, violations: bad[route]?.violations ?? [], overflowPx: bad[route]?.overflowPx ?? 0 }));
    const r = await t.call(who, 'POST', '/a11y/runs', { kind, width, height: 740, theme: 'light', ...(runId ? { runId } : {}), final: i + 150 >= routes.length, results: batch });
    assert.equal(r.status, 201, JSON.stringify(r.json)); out = r.json.data; runId = out.id;
  }
  return out;
}

test('BR-01 business pages and consoles', () => {
  assert.equal(isBusinessPage('/site/dpr-entry'), true); assert.equal(isBusinessPage('/fin/journals'), true);
  assert.equal(isBusinessPage('/admin/test-coverage'), false); assert.equal(isBusinessPage('/dev/sandbox'), false);
  assert.ok(routes.length > 700);
});

test('T-01 FR-02 FR-03 FR-04 BR-01 a sweep covers every page; a serious finding on a business page blocks; fixed and re-tested by the next sweep', async () => {
  const t = await boot();
  let o = (await t.call(qa, 'GET', '/a11y')).json.data;
  assert.deepEqual([o.verdict.swept, o.verdict.blocked], [false, true]); assert.ok(o.devices.length >= 10, 'the device matrix is seeded');
  assert.equal((await t.call(qa, 'POST', '/a11y/runs', { kind: 'AXE', width: 360, results: [{ route: '/no/such/page' }] })).status, 400, 'an unregistered route');
  assert.equal((await t.call(qa, 'POST', '/a11y/runs', { kind: 'AXE', results: [{ route: routes[0] }] })).status, 400, 'a sweep has a width');
  const first = await sweep(t, qa, 360, { '/site/dpr-entry': { violations: SERIOUS }, '/fin/journals': { violations: MINOR }, '/admin/test-coverage': { violations: SERIOUS } });
  assert.deepEqual([first.kind, first.status, first.items, first.failed, first.coverage.pct, first.coverage.missingCount], ['AXE', 'DONE', routes.length, 2, 100, 0]);
  o = (await t.call(qa, 'GET', '/a11y')).json.data;
  assert.deepEqual([o.verdict.blocked, o.verdict.blockerCount, o.verdict.blockers[0].route], [true, 1, '/site/dpr-entry'], 'the console page does not block; the moderate one does not fail');
  assert.equal(o.rules[0].rule, 'color-contrast'); assert.equal(o.byWidth.find((w) => w.width === 360).serious, 2);
  assert.equal((await t.call(ux, 'POST', '/a11y/signoff', { reason: 'Ready for the gate review' })).status, 422, 'BR-01 blocks the sign-off');
  // the issue is fixed in a commit, then the next sweep re-tests it
  const issue = o.results.rows.find((x) => x.route === '/site/dpr-entry');
  assert.equal(issue.issue, 'OPEN'); assert.equal((await t.call(aud, 'POST', `/a11y/results/${issue.id}/fix`, { fixedIn: 'abc1234' })).status, 403);
  assert.equal((await t.call(qa, 'POST', `/a11y/results/${issue.id}/fix`, { fixedIn: 'abc1234' })).json.data.issue, 'FIXED');
  const second = await sweep(t, qa, 360, { '/admin/test-coverage': { violations: SERIOUS } });
  assert.equal(second.retested, 1);
  const r = (await t.call(qa, 'GET', `/a11y/results/${issue.id}`)).json.data; assert.deepEqual([r.issue, r.fixedIn, r.history.length], ['RETESTED', 'abc1234', 2]);
  o = (await t.call(qa, 'GET', '/a11y')).json.data; assert.deepEqual([o.verdict.blocked, o.issues.retested], [false, 1]);
  // a responsive sweep at another width: sideways scrolling fails a page
  const wide = await sweep(t, qa, 1920, { '/bud/budgets': { overflowPx: 24 } }, 'RESPONSIVE');
  assert.equal(wide.failed, routes.includes('/bud/budgets') ? 1 : 0);
});

test('FR-01 FR-02 device journeys and screen-reader sessions; AC-01 the sign-off is asked by the UX lead and approved by another person', async () => {
  const t = await boot();
  await sweep(t, qa, 360);
  const dev = await t.call(qa, 'POST', '/a11y/runs', { kind: 'DEVICE', deviceCode: 'android-low', final: true, results: [{ journey: 'Field: reach the DPR entry', result: 'PASS', steps: [{ step: 'open Home', result: 'PASS', ms: 2100 }, { step: 'tap the DPR tile', result: 'PASS', ms: 1800 }] }, { journey: 'Offline and back', steps: [{ step: 'banner shows', result: 'FAIL', note: 'not shown' }] }] });
  assert.equal(dev.status, 201, JSON.stringify(dev.json)); assert.deepEqual([dev.json.data.items, dev.json.data.failed, dev.json.data.device.code, dev.json.data.network], [2, 1, 'android-low', 'SLOW_3G']);
  assert.equal((await t.call(qa, 'POST', '/a11y/runs', { kind: 'DEVICE', deviceCode: 'nokia-3310', results: [{ journey: 'x x x' }] })).status, 400);
  assert.equal((await t.call(qa, 'POST', '/a11y/runs', { kind: 'DEVICE', deviceCode: 'android-low', results: [{ route: '/field' }] })).status, 400, 'a journey is named');
  const again = await t.call(qa, 'POST', '/a11y/runs', { kind: 'DEVICE', deviceCode: 'android-low', final: true, results: [{ journey: 'Offline and back', result: 'PASS', steps: [{ step: 'banner shows', result: 'PASS' }] }] });
  assert.equal(again.json.data.retested, 1, 'the failed journey on the same device is re-tested');
  assert.equal((await t.call(ux, 'POST', '/a11y/manual', { kind: 'SCREEN_READER', journey: 'Approve a purchase order', result: 'PASS' })).status, 400, 'names the screen reader');
  assert.equal((await t.call(ux, 'POST', '/a11y/manual', { kind: 'SCREEN_READER', assistiveTech: 'NVDA', journey: 'Approve a purchase order', result: 'FAIL' })).status, 400, 'a failure says what failed');
  const sr = await t.call(ux, 'POST', '/a11y/manual', { kind: 'SCREEN_READER', assistiveTech: 'NVDA', journey: 'Approve a purchase order', result: 'PASS', language: 'en', steps: [{ step: 'the inbox is announced as a list', result: 'PASS' }] });
  assert.equal(sr.status, 201, JSON.stringify(sr.json));
  assert.equal((await t.call(ux, 'POST', '/a11y/manual', { kind: 'DEVICE', deviceCode: 'iphone-real', journey: 'DPR on a real iPhone', result: 'PASS', language: 'hi' })).status, 201);
  const o = (await t.call(aud, 'GET', '/a11y')).json.data;
  assert.equal(o.devices.find((x) => x.code === 'android-low').last.result, 'PASS'); assert.equal(o.devices.find((x) => x.code === 'iphone-real').last.result, 'PASS');
  assert.equal(o.screenReader[0].assistiveTech, 'NVDA');
  // the sign-off: the UX lead asks; the QA lead approves; the asker cannot
  const ask = await t.call(ux, 'POST', '/a11y/signoff', { reason: 'Every page swept, device journeys pass' }); assert.equal(ask.status, 201, JSON.stringify(ask.json));
  assert.equal((await t.call(ux, 'POST', `/a11y/signoff/${ask.json.data.id}/act`, { action: 'approve' })).status, 403);
  assert.equal((await t.call(qa, 'GET', '/a11y')).json.data.signoff.awaitingMe, true);
  assert.equal((await t.call(qa, 'POST', `/a11y/signoff/${ask.json.data.id}/act`, { action: 'approve', comment: 'Checked the report' })).json.data.status, 'APPROVED');
  assert.equal((await t.call(aud, 'GET', '/a11y')).json.data.signoff.status, 'APPROVED');
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'tst_a11y_signoff' AND action = 'signed_off'").get());
  assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'tst.a11y.signed_off'").get());
});

test('AC-03 roles: QA and the UX lead record; only the UX lead asks for the sign-off; the auditor reads and exports; others are refused', async () => {
  const t = await boot();
  assert.equal((await t.call(pm, 'GET', '/a11y')).status, 403);
  assert.equal((await t.call(aud, 'POST', '/a11y/manual', { kind: 'SCREEN_READER', assistiveTech: 'NVDA', journey: 'x x x', result: 'PASS' })).status, 403);
  assert.equal((await t.call(qa, 'POST', '/a11y/signoff', { reason: 'Asking as QA here' })).status, 403, 'the QA lead approves; does not ask');
  assert.deepEqual((await t.call(qa, 'GET', '/a11y')).json.data.can, { record: true, signoff: false, export: true });
  await sweep(t, qa, 360, { '/site/dpr-entry': { violations: SERIOUS } });
  const x = await t.api.raw('GET', `${T}/a11y/export?format=csv&issue=ALL`, aud); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /color-contrast/);
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'report' AND entity_id = 'tst.a11y'").get());
  assert.equal((await t.call({ ...qa, company: '2' }, 'GET', '/a11y')).status, 404);
  assert.equal((await t.call(qa, 'GET', '/a11y/results/99999')).status, 404);
});
