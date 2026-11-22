import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.01: the Super Admin Enterprise Control Center.
// T-01 a change without approval is not applied, and the configuration diff between environments is accurate; BR-01 maker-checker for every
// admin change (SYSADM → ITADM; financial keys → ITADM then CFO or DIR), self-approval refused; FR-05 emergency controls act at once and are
// ratified; FR-02 the governance dashboard; FR-04 onboarding checklist; section 8 roles.
const A = '/api/v1/admin';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `adm-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'adm-sys'); const it = as('ITADM', 'adm-it'); const cfo = as('CFO', 'adm-cfo'); const dir = as('DIR', 'adm-dir'); const aud = as('AUD', 'adm-aud'); const se = as('SE', 'adm-se');
const opened = []; after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const { db } = api;
  for (const [n, r] of [['adm-sys', 'SYSADM'], ['adm-it', 'ITADM'], ['adm-cfo', 'CFO'], ['adm-dir', 'DIR'], ['adm-aud', 'AUD'], ['adm-se', 'SE']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2901', 1, 'Control center fixture', 0, 1)").run();
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  const flagOn = async (k) => (await call(sys, 'GET', `${A}/areas`)).json.data.FEATURE_FLAG.find((f) => f.key === k).value;
  const param = async (k) => (await call(sys, 'GET', `${A}/areas`)).json.data.PARAMETER.find((p) => p.key === k).value;
  return { api, db, call, flagOn, param };
}

test('T-01 BR-01 a configuration change applies only after the checker approves; financial keys need a second checker; self-approval refused', async () => {
  const t = await setup();
  const before = await t.flagOn('ff.ai.p2801');
  const r = await t.call(sys, 'POST', `${A}/changes`, { area: 'FEATURE_FLAG', key: 'ff.ai.p2801', value: !before, reason: 'Switch the AI gateway for the pilot' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const req = r.json.data; assert.deepEqual(req.chain, ['ITADM']);
  assert.equal(await t.flagOn('ff.ai.p2801'), before, 'T-01: not applied before approval');
  assert.equal((await t.call(sys, 'POST', `${A}/changes`, { area: 'FEATURE_FLAG', key: 'ff.ai.p2801', value: !before, reason: 'Second request for the same key' })).status, 409, 'one open request per key');
  assert.notEqual((await t.call(sys, 'POST', `${A}/changes/${req.id}/act`, { action: 'approve' })).status, 200, 'the maker cannot approve');
  assert.equal((await t.call(se, 'POST', `${A}/changes`, { area: 'FEATURE_FLAG', key: 'ff.ai.p2801', value: true, reason: 'not allowed at all' })).status, 403);
  const ok = await t.call(it, 'POST', `${A}/changes/${req.id}/act`, { action: 'approve', comment: 'Checked with the pilot plan' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(await t.flagOn('ff.ai.p2801'), !before, 'applied on approval');
  assert.ok(t.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'admin.config.changed'").get());
  // a financial parameter: ITADM, then the CFO
  const cur = Number(await t.param('proc.rti.window_days'));
  const fin = (await t.call(sys, 'POST', `${A}/changes`, { area: 'PARAMETER', key: 'proc.rti.window_days', value: String(cur + 30), reason: 'Longer benchmark window for steel' })).json.data;
  assert.deepEqual(fin.chain, ['ITADM', 'CFO|DIR']);
  assert.equal((await t.call(it, 'POST', `${A}/changes/${fin.id}/act`, { action: 'approve', comment: 'IT check' })).status, 200);
  assert.equal(Number(await t.param('proc.rti.window_days')), cur, 'still waiting for the CFO');
  assert.equal((await t.call(cfo, 'POST', `${A}/changes/${fin.id}/act`, { action: 'approve', comment: 'Finance agrees' })).status, 200);
  assert.equal(Number(await t.param('proc.rti.window_days')), cur + 30);
  // a rejection needs a comment and applies nothing; out of range is refused at once
  const z = (await t.call(sys, 'POST', `${A}/changes`, { area: 'PARAMETER', key: 'ai.anomaly.z_threshold', value: '4', reason: 'Fewer false alarms please' })).json.data;
  assert.equal((await t.call(it, 'POST', `${A}/changes/${z.id}/act`, { action: 'reject' })).status, 400);
  assert.equal((await t.call(it, 'POST', `${A}/changes/${z.id}/act`, { action: 'reject', comment: 'Keep 3.5 until the review' })).status, 200);
  assert.equal(String(await t.param('ai.anomaly.z_threshold')), '3.5');
  assert.equal((await t.call(sys, 'POST', `${A}/changes`, { area: 'PARAMETER', key: 'ai.anomaly.z_threshold', value: '99', reason: 'out of the allowed range' })).status, 422);
  // a request whose value changed meanwhile is refused at approval (nothing silently overwritten)
  const s1 = (await t.call(sys, 'POST', `${A}/changes`, { area: 'PARAMETER', key: 'ai.anomaly.min_history', value: '10', reason: 'More history before flags' })).json.data;
  t.db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'ai.anomaly.min_history', '12', 'integer', 'company', 1, '2020-01-01', 'other', 'test')").run();
  assert.equal((await t.call(it, 'POST', `${A}/changes/${s1.id}/act`, { action: 'approve', comment: 'ok' })).status, 409);
  // AC-04: the old direct paths are closed while the control center is on
  assert.equal((await t.call(sys, 'POST', '/api/v1/core/parameters', { key: 'ai.anomaly.min_history', value: '15', scopeType: 'company', scopeId: 1, effectiveFrom: '2026-12-01', reason: 'direct edit attempt' })).status, 422);
  assert.equal((await t.call(sys, 'PATCH', '/api/v1/core/feature-flags/ff.ai.p2802', { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'direct edit attempt' })).status, 422);
  const list = (await t.call(aud, 'GET', `${A}/changes`)).json.data; assert.ok(list.rows.length >= 4); assert.equal(list.rows.every((x) => x.canDecide === false), true, 'the auditor only reads');
});

test('FR-05 BR-01 emergency controls act at once and are ratified: read-only mode, feature kill switch, force logout', async () => {
  const t = await setup();
  const ro = await t.call(it, 'POST', `${A}/emergency/read-only`, { on: true, reason: 'Suspected data corruption on the ledger' });
  assert.equal(ro.status, 200, JSON.stringify(ro.json)); assert.equal(ro.json.data.readOnly, true);
  assert.equal((await t.call(sys, 'POST', `${A}/snapshots`, { note: 'blocked' })).status, 423, 'every write is refused');
  assert.equal((await t.call(sys, 'GET', `${A}/dashboard`)).status, 200, 'reading continues');
  const action = ro.json.data.actions[0]; assert.equal(action.action, 'READ_ONLY_ON'); assert.equal(action.status, 'PENDING');
  assert.ok(Date.parse(action.ratifyDue) - Date.now() > 23 * 3_600_000, 'ratify within 24 hours');
  // ratified by a checker other than the one who acted (the emergency endpoints and approvals still work in read-only mode)
  assert.notEqual((await t.call(it, 'POST', `${A}/changes/${action.requestId}/act`, { action: 'approve' })).status, 200, 'not by the one who acted');
  assert.equal((await t.call(dir, 'POST', `${A}/changes/${action.requestId}/act`, { action: 'approve', comment: 'Ratified: right call' })).status, 423, 'decisions are writes too: refused in read-only mode');
  assert.equal((await t.call(it, 'POST', `${A}/emergency/read-only`, { on: false, reason: 'Ledger verified, resuming' })).status, 200);
  assert.equal((await t.call(dir, 'POST', `${A}/changes/${action.requestId}/act`, { action: 'approve', comment: 'Ratified: right call' })).status, 200);
  assert.equal(t.db.prepare('SELECT status FROM adm_emergency_actions WHERE id = ?').get(action.id).status, 'RATIFIED');
  // kill switch: the feature stops at once
  t.db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.ai.p2801', 1, 'on', 0, 1)").run();
  const kill = await t.call(dir, 'POST', `${A}/emergency/kill`, { key: 'ff.ai.p2801', reason: 'AI provider leaking data' });
  assert.equal(kill.status, 200, JSON.stringify(kill.json)); assert.equal((await t.call(sys, 'GET', `${A}/areas`)).json.data.FEATURE_FLAG.find((f) => f.key === 'ff.ai.p2801').value, false);
  assert.equal((await t.call(dir, 'POST', `${A}/emergency/kill`, { key: 'ff.admin.p2901', reason: 'switch off the console' })).status, 422);
  // force logout: every other session of the company ends
  const uid = t.db.prepare("SELECT id FROM iam_users WHERE username = 'adm-se'").get().id;
  t.db.prepare("INSERT INTO iam_sessions (public_id, user_id, company_id, expires_at) VALUES ('s-1', ?, 1, '2099-01-01T00:00:00Z')").run(uid);
  const fl = await t.call(it, 'POST', `${A}/emergency/force-logout`, { reason: 'Credential leak suspected' });
  assert.equal(fl.status, 200, JSON.stringify(fl.json)); assert.ok(fl.json.data.sessionsEnded >= 1);
  assert.ok(t.db.prepare("SELECT revoked_at FROM iam_sessions WHERE public_id = 's-1'").get().revoked_at);
  assert.equal((await t.call(sys, 'POST', `${A}/emergency/force-logout`, { reason: 'the system administrator may too' })).status, 200);
  assert.equal((await t.call(aud, 'POST', `${A}/emergency/read-only`, { on: true, reason: 'auditor may not' })).status, 403);
  // the dashboard counts the unratified actions once they are overdue
  t.db.prepare("UPDATE adm_emergency_actions SET ratify_due = '2026-01-01T00:00:00Z' WHERE action = 'FEATURE_KILL'").run();
  const m = Object.fromEntries((await t.call(aud, 'GET', `${A}/dashboard`)).json.data.metrics.map((x) => [x.key, x]));
  assert.equal(m.emergency.value, 1); assert.ok(m.approvals.value >= 2); assert.equal(typeof m.dormant.value, 'number'); assert.ok('backup' in m && 'sod' in m && 'integrity' in m);
});

test('T-01 FR-03 configuration snapshots: export, an accurate diff against another environment, import only as change requests', async () => {
  const t = await setup();
  const snap = await t.call(sys, 'POST', `${A}/snapshots`, { note: 'Before go-live' }); assert.equal(snap.status, 201);
  const exp = await t.api.raw('GET', `${A}/snapshots/${snap.json.data.id}/export`, sys); assert.equal(exp.status, 200);
  const file = JSON.parse(exp.buffer.toString('utf8')); assert.equal(file.format, 'erp-config/1');
  // the same environment: no difference
  assert.deepEqual((await t.call(sys, 'POST', `${A}/snapshots/diff`, { file })).json.data.differences, []);
  // the "UAT" copy: one flag and one parameter changed, one parameter only there, one flag missing
  const uat = JSON.parse(JSON.stringify(file.content)); const flagKey = 'ff.ai.p2801'; const oldFlag = uat.FEATURE_FLAG[flagKey];
  uat.FEATURE_FLAG[flagKey] = !oldFlag; uat.PARAMETER['ai.anomaly.z_threshold'] = '4.5'; uat.PARAMETER['zz.custom.param'] = '1'; delete uat.FEATURE_FLAG['ff.ai.p2803'];
  const { createHash } = await import('node:crypto');
  const other = { format: 'erp-config/1', environment: 'uat', takenAt: '2026-11-21T10:00:00Z', checksum: createHash('sha256').update(JSON.stringify(uat)).digest('hex'), content: uat };
  const d = (await t.call(sys, 'POST', `${A}/snapshots/diff`, { file: other })).json.data;
  assert.deepEqual(d.differences.map((x) => [x.area, x.key, x.change]).sort(), [['FEATURE_FLAG', 'ff.ai.p2801', 'CHANGED'], ['FEATURE_FLAG', 'ff.ai.p2803', 'ONLY_HERE'], ['PARAMETER', 'ai.anomaly.z_threshold', 'CHANGED'], ['PARAMETER', 'zz.custom.param', 'ONLY_INCOMING']].sort());
  const z = d.differences.find((x) => x.key === 'ai.anomaly.z_threshold'); assert.deepEqual([z.current, z.incoming], ['3.5', '4.5']);
  assert.equal((await t.call(sys, 'POST', `${A}/snapshots/diff`, { file: { ...other, checksum: '0'.repeat(64) } })).status, 422, 'a tampered file');
  // import: change requests, nothing applied
  const im = await t.call(sys, 'POST', `${A}/snapshots/import`, { file: other, keys: ['PARAMETER:ai.anomaly.z_threshold', `FEATURE_FLAG:${flagKey}`], reason: 'Align production with UAT' });
  assert.equal(im.status, 201, JSON.stringify(im.json)); assert.equal(im.json.data.length, 2); assert.equal(String(await t.param('ai.anomaly.z_threshold')), '3.5');
  assert.equal((await t.call(it, 'POST', `${A}/snapshots/diff`, { file: other })).status, 403, 'IT checks, it does not import');
});

test('FR-01 FR-02 FR-04 catalogue, dashboard and onboarding checklist; roles; volume of the approvals list', async () => {
  const t = await setup();
  const cat = (await t.call(sys, 'GET', `${A}/catalogue`)).json.data; assert.ok(cat.pages.length > 5, JSON.stringify(cat).slice(0, 600)); assert.ok(cat.pages.every((p) => p.route.startsWith('/')));
  const found = (await t.call(sys, 'GET', `${A}/catalogue?q=flag`)).json.data; assert.ok(found.pages.length >= 1 && found.pages.length < cat.pages.length);
  const ob = (await t.call(sys, 'GET', `${A}/onboarding`)).json.data; assert.equal(ob.total, 6); assert.equal(ob.steps.find((s) => s.key === 'settings').done, true, 'setupCompany saved the settings'); assert.equal(ob.steps.find((s) => s.key === 'financialYear').done, true);
  assert.equal((await t.call(it, 'GET', `${A}/onboarding`)).status, 403);
  assert.equal((await t.call(se, 'GET', `${A}/dashboard`)).status, 403);
  t.db.exec('BEGIN'); const ins = t.db.prepare("INSERT INTO core_change_requests (company_id, type, title, target_type, target_id, payload_json, reason, status, chain_json, current_step, requested_by, created_by, source_type) VALUES (1, 'admin_config_change', 't', 'PARAMETER', 'k', '{}', 'r', 'APPROVED', '[\"ITADM\"]', 1, 'x', 'x', 'test')");
  for (let i = 0; i < 100_000; i += 1) ins.run(); t.db.exec('COMMIT');
  const t0 = performance.now(); const l = await t.call(sys, 'GET', `${A}/changes?pageSize=25`); const ms = performance.now() - t0;
  assert.equal(l.status, 200); assert.ok(ms < 500, `${ms} ms`);
});
