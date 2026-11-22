import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { verifyWebhook } from '../src/server/platform/integrations/webhooks.js';
import { CATALOGUE, apiPlatformOf } from '../src/server/modules/admin/apiplatform.js';
import { fill } from './qa-helpers.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.03: public API, webhooks and developer portal.
// T-01 webhook signature verification; scope enforcement on every public endpoint. FR-01 versions and deprecation; FR-02 service accounts
// with scopes mapped to permissions and data scope, key rotation; FR-03 signed webhooks, retries, delivery logs, replay; FR-04 portal;
// FR-05 usage and rate tiers; BR-01 the public API goes through the same permissions, validation and idempotency; section 9 a client with
// write scopes is active only after the director approves it.
const A = '/api/v1/admin/api';
const P = '/api/public/v1';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `api-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const it = as('ITADM', 'api-it'); const dir = as('DIR', 'api-dir'); const aud = as('AUD', 'api-aud'); const se = as('SE', 'api-se');
const opened = []; after(async () => { for (const c of opened) await c(); });
const now = new Date().toISOString();

async function setup() {
  const api = await startApi(); opened.push(() => api.close()); await setupCompany(api); const db = api.db;
  for (const [n, r] of [['api-it', 'ITADM'], ['api-dir', 'DIR'], ['api-aud', 'AUD'], ['api-se', 'SE']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  for (const f of ['ff.admin.p2903', 'ff.plant.p1707']) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'API fixture', 0, 1)").run(f);
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'AP-1', 'Metro depot', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'AP-2', 'Flyover', 'ROAD', 'ACTIVE')").run().lastInsertRowid);
  db.exec('PRAGMA foreign_keys = OFF');
  fill(db, 'plt_equipment', { company_id: 1, doc_no: 'EQ-A1', asset_code: 'EXC-11', class_item_id: 1, requested_by: 'plant', status: 'APPROVED', org_project_id: project });
  db.exec('PRAGMA foreign_keys = ON');
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  const pub = (method, path, { token, body, headers = {} } = {}) => api.call(method, path, { user: null, roles: '', company: null, body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  const tokenOf = async (client, secret, scope) => { const r = await pub('POST', `${P}/oauth/token`, { body: { grant_type: 'client_credentials', client_id: client.clientId, client_secret: secret, ...(scope ? { scope } : {}) } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.access_token; };
  const create = async (body, who = it) => { const r = await call(who, 'POST', `${A}/clients`, { reason: 'Integration for the plant partner', ...body }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  return { api, db, call, pub, tokenOf, create, project, other };
}

test('T-01 FR-01 FR-02 tokens, scope enforcement on every public endpoint, versions, deprecation and the service account\'s own permissions', async () => {
  const t = await setup();
  assert.equal((await t.call(it, 'POST', `${A}/clients`, { name: 'Bad role', role: 'SE', scopes: ['plant:read'], reason: 'Should be refused' })).status, 422, 'SE does not hold plant.telematics.view');
  assert.equal((await t.call(it, 'POST', `${A}/clients`, { name: 'Admin role', role: 'ITADM', scopes: ['masters:read'], reason: 'Should be refused' })).status, 422, 'a client never acts as an administrator');
  assert.equal((await t.call(aud, 'POST', `${A}/clients`, { name: 'Auditor', role: 'PM', scopes: ['plant:read'], reason: 'Auditor may not' })).status, 403);
  const c = await t.create({ name: 'Partner dashboard', role: 'PM', scopes: ['plant:read', 'site:read'], tier: 'STANDARD' });
  assert.equal(c.status, 'ACTIVE', 'read scopes need no approval'); assert.match(c.clientSecret, /^cs_/); assert.equal(c.secretHint, c.clientSecret.slice(-4));
  assert.ok(!JSON.stringify((await t.call(it, 'GET', `${A}/clients`)).json).includes(c.clientSecret), 'the secret is shown only once');
  // OAuth2 client credentials
  assert.equal((await t.pub('POST', `${P}/oauth/token`, { body: { client_id: c.clientId, client_secret: 'cs_wrong' } })).json.error, 'invalid_client');
  assert.equal((await t.pub('POST', `${P}/oauth/token`, { body: { client_id: c.clientId, client_secret: c.clientSecret, scope: 'plant:write' } })).json.error, 'invalid_scope');
  const basic = await t.api.raw('POST', `${P}/oauth/token`, { user: null, company: null, headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&scope=plant%3Aread' });
  assert.equal(basic.status, 200); assert.deepEqual([basic.json.token_type, basic.json.expires_in, basic.json.scope], ['Bearer', 3600, 'plant:read']);
  const narrow = basic.json.access_token;
  // T-01: every catalogue route outside the token's scopes is refused, whatever the client's role could do
  for (const e of CATALOGUE.filter((x) => x.scope !== 'plant:read')) {
    const r = await t.pub(e.method, `/api/public/${e.version}${e.path}`, { token: narrow, body: e.method === 'POST' ? {} : undefined, headers: { 'idempotency-key': `s-${e.id}` } });
    assert.equal(r.status, 403, `${e.id} must need ${e.scope}`); assert.equal(r.json.error.code, 'INSUFFICIENT_SCOPE');
  }
  const pos = await t.pub('GET', `${P}/telematics/positions`, { token: narrow });
  assert.equal(pos.status, 200, JSON.stringify(pos.json)); assert.equal(pos.headers.get('ratelimit-limit'), '300');
  assert.equal((await t.pub('GET', `${P}/telematics/positions`)).status, 401);
  assert.equal((await t.pub('GET', `${P}/telematics/positions`, { token: 'at_forged' })).status, 401);
  assert.equal((await t.pub('GET', '/api/public/v9/telematics/positions', { token: narrow })).json.error.code, 'UNKNOWN_VERSION');
  assert.equal((await t.pub('GET', `${P}/admin/api/clients`, { token: narrow })).status, 404, 'only catalogue routes are public');
  // FR-01: a deprecated route says so and names its successor
  const full = await t.tokenOf(c, c.clientSecret);
  const old = await t.pub('GET', `${P}/dpr`, { token: full });
  assert.match(old.headers.get('deprecation') ?? '', /^@\d+$/); assert.match(old.headers.get('sunset') ?? '', /2027/); assert.match(old.headers.get('link') ?? '', /\/v1\/dprs/);
  // FR-04 portal and FR-05 usage
  const portal = (await t.call(aud, 'GET', `${A}/portal`)).json.data;
  assert.equal(portal.endpoints.length, CATALOGUE.length); assert.ok(portal.scopes.some((s) => s.code === 'plant:write' && s.write)); assert.ok(portal.changelog.length); assert.equal(portal.sandbox[0].clientId, c.clientId);
  const u = (await t.call(it, 'GET', `${A}/usage`)).json.data;
  assert.ok(u.total.calls >= CATALOGUE.length + 1); assert.ok(u.byEndpoint.some((e) => e.endpoint === 'telematics.positions' && e.calls === 1));
  assert.equal((await t.call(se, 'GET', `${A}/clients`)).status, 403);
});

test('Section 9 BR-01 FR-02 FR-05 write clients wait for the director; the public write uses the internal rules, idempotency and the data scope; bulk, rate tier, rotation and revocation', async () => {
  const t = await setup();
  const c = await t.create({ name: 'Fleet tracker feed', role: 'PLANTMGR', scopes: ['plant:read', 'plant:write'], environment: 'LIVE' });
  assert.equal(c.status, 'PENDING_APPROVAL');
  assert.match((await t.pub('POST', `${P}/oauth/token`, { body: { client_id: c.clientId, client_secret: c.clientSecret } })).json.error_description, /waiting for approval/);
  assert.notEqual((await t.call(it, 'POST', `${A}/clients/requests/${c.requestId}/act`, { action: 'approve' })).status, 200, 'IT cannot approve its own client');
  const ok = await t.call(dir, 'POST', `${A}/clients/requests/${c.requestId}/act`, { action: 'approve', comment: 'Partner contract signed' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const token = await t.tokenOf(c, c.clientSecret);
  const reading = { source: 'partner', readings: [{ assetCode: 'EXC-11', timestamp: now, lat: 17.4, lng: 78.5, engineHours: 1200.5, ignition: true, fuelLevel: 55 }] };
  assert.equal((await t.pub('POST', `${P}/telematics/readings`, { token, body: reading })).status >= 400, true, 'the internal route still wants an Idempotency-Key');
  const w1 = await t.pub('POST', `${P}/telematics/readings`, { token, body: reading, headers: { 'idempotency-key': 'feed-0001' } });
  assert.equal(w1.status, 201, JSON.stringify(w1.json)); assert.equal(w1.json.data.stored, 1);
  const w2 = await t.pub('POST', `${P}/telematics/readings`, { token, body: reading, headers: { 'idempotency-key': 'feed-0001' } });
  assert.deepEqual(w2.json, w1.json, 'a replayed key gives the first answer'); assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM plt_telematics').get().n, 1);
  const bad = await t.pub('POST', `${P}/telematics/readings`, { token, body: { source: 'partner', readings: [{ ...reading.readings[0], assetCode: 'NOPE-1' }] }, headers: { 'idempotency-key': 'feed-0002' } });
  assert.equal(bad.status, 400, 'the owner\'s validation applies (BR-01)');
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'plt_telematics' AND actor LIKE 'svc-%'").get(), 'audited as the service account');
  // bulk: each call goes back through the gateway on its own
  const b = await t.pub('POST', `${P}/bulk`, { token, headers: { 'idempotency-key': 'bulk-0001' }, body: { requests: [{ id: 'a', method: 'POST', path: '/telematics/readings', body: { source: 'partner', readings: [{ ...reading.readings[0], timestamp: new Date(Date.now() + 60_000).toISOString() }] } }, { id: 'b', method: 'POST', path: '/telematics/readings', body: { source: 'partner', readings: [{ ...reading.readings[0], assetCode: 'NOPE-2' }] } }] } });
  assert.equal(b.status, 207, JSON.stringify(b.json)); assert.deepEqual(b.json.data.results.map((r) => r.status), [201, 400]);
  assert.equal((await t.pub('POST', `${P}/bulk`, { token, headers: { 'idempotency-key': 'bulk-0002' }, body: { requests: [{ method: 'GET', path: '/telematics/positions' }] } })).status, 422, 'only write routes are bulk routes');
  // data scope: a client limited to another project cannot reach this machine
  const scoped = await t.create({ name: 'Flyover feed', role: 'PLANTMGR', scopes: ['plant:write'], projectIds: [t.other] });
  await t.call(dir, 'POST', `${A}/clients/requests/${scoped.requestId}/act`, { action: 'approve' });
  const st = await t.tokenOf(scoped, scoped.clientSecret);
  const out = await t.pub('POST', `${P}/telematics/readings`, { token: st, body: reading, headers: { 'idempotency-key': 'feed-0003' } });
  assert.equal(out.status, 400, 'outside its projects'); assert.match(JSON.stringify(out.json), /No such equipment/);
  // FR-05: the BASIC tier allows 60 calls a minute
  const slow = await t.create({ name: 'Basic reader', role: 'PM', scopes: ['plant:read'], tier: 'BASIC' });
  const sTok = await t.tokenOf(slow, slow.clientSecret); let last;
  for (let i = 0; i < 61; i += 1) last = await t.pub('GET', `${P}/telematics/positions`, { token: sTok });
  assert.equal(last.status, 429); assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.equal((await t.call(it, 'GET', `${A}/usage`)).json.data.byClient.find((x) => x.clientId === slow.clientId).throttled, 1);
  // FR-02 rotation: both secrets work for the grace period; revocation ends every token
  const rot = (await t.call(it, 'POST', `${A}/clients/${c.id}/rotate`, { reason: 'Quarterly rotation' })).json.data;
  assert.notEqual(rot.clientSecret, c.clientSecret); assert.ok(rot.previousSecretUntil);
  await t.tokenOf(c, c.clientSecret); await t.tokenOf(c, rot.clientSecret);
  assert.equal((await t.call(it, 'POST', `${A}/clients/${c.id}/revoke`, { reason: 'Partner contract ended' })).json.data.status, 'REVOKED');
  assert.equal((await t.pub('GET', `${P}/telematics/positions`, { token })).status, 401);
  assert.equal((await t.pub('POST', `${P}/oauth/token`, { body: { client_id: c.clientId, client_secret: rot.clientSecret } })).status, 401);
});

test('T-01 FR-03 signed webhooks: the receiver verifies the signature; retries with back-off; delivery log, replay and roles', async () => {
  const t = await setup();
  const got = []; let failNext = 0; let secret = '';
  const rx = createServer((req, res) => { let raw = ''; req.on('data', (x) => { raw += x; }); req.on('end', () => {
    const v = verifyWebhook({ secret, rawBody: raw, signature: req.headers['x-signature'], timestamp: req.headers['x-timestamp'] });
    got.push({ ok: v.ok, body: JSON.parse(raw), id: req.headers['x-delivery-id'], type: req.headers['x-erp-event'], raw, sig: req.headers['x-signature'], ts: req.headers['x-timestamp'] });
    res.statusCode = failNext > 0 ? 500 : v.ok ? 200 : 401; failNext -= 1; res.end('ok');
  }); });
  await new Promise((r) => rx.listen(0, '127.0.0.1', r)); opened.push(() => rx.close());
  const url = `http://127.0.0.1:${rx.address().port}/hooks/erp`;
  const c = await t.create({ name: 'Plant events', role: 'PM', scopes: ['plant:read'] });
  assert.equal((await t.call(it, 'POST', `${A}/webhooks`, { clientRef: c.id, url, events: ['proc.*'] })).status, 403, 'only events of the client\'s scopes');
  assert.equal((await t.call(it, 'POST', `${A}/webhooks`, { clientRef: c.id, url: 'ftp://x.example/hook', events: ['plant.*'] })).status, 422);
  const h = await t.call(it, 'POST', `${A}/webhooks`, { clientRef: c.id, url, events: ['plant.*'] });
  assert.equal(h.status, 201, JSON.stringify(h.json)); secret = h.json.data.signingSecret; assert.match(secret, /^whsec_/);
  assert.notEqual(t.db.prepare('SELECT secret_enc FROM api_webhooks').get().secret_enc, secret, 'the signing secret is stored encrypted');
  const ping = (await t.call(it, 'POST', `${A}/webhooks/${h.json.data.id}/test`)).json.data;
  assert.equal(ping.status, 'DELIVERED'); assert.equal(got[0].ok, true, 'T-01: the receiver verifies the signature'); assert.equal(got[0].type, 'admin.webhook.pinged');
  // T-01: a tampered body or another secret does not verify
  assert.equal(verifyWebhook({ secret, rawBody: got[0].raw.replace('pinged', 'pinged!'), signature: got[0].sig, timestamp: got[0].ts }).ok, false);
  assert.equal(verifyWebhook({ secret: `${secret}x`, rawBody: got[0].raw, signature: got[0].sig, timestamp: got[0].ts }).ok, false);
  // a domain event of the company, through the bus: queued, signed, delivered; another company's event is not
  const rt = runtimeOf(t.db); const ap = apiPlatformOf(t.db);
  publishEvent(t.db, { type: 'plant.telematics.alerted', entity: 'plt_equipment', entityId: 1, actorId: 'system', companyId: 1, data: { assetCode: 'EXC-11', alert: 'IDLE', bankAccountNo: '123456789012' } });
  publishEvent(t.db, { type: 'plant.telematics.alerted', entity: 'plt_equipment', entityId: 9, actorId: 'system', companyId: 2, data: { assetCode: 'X' } });
  publishEvent(t.db, { type: 'proc.material_request.created', entity: 'proc_mr', entityId: 1, actorId: 'system', companyId: 1, data: {} });
  rt.bus.drain(); await ap.deliverDue();
  const ev = got.filter((g) => g.type === 'plant.telematics.alerted');
  assert.equal(ev.length, 1, 'one delivery: same company and subscribed type only'); assert.equal(ev[0].ok, true); assert.equal(ev[0].body.data.assetCode, 'EXC-11');
  assert.notEqual(ev[0].body.data.bankAccountNo, '123456789012', 'sensitive fields are masked as in every event');
  // retries: the endpoint fails, the delivery waits with back-off, then succeeds; the log keeps both attempts
  failNext = 1;
  publishEvent(t.db, { type: 'plant.telematics.alerted', entity: 'plt_equipment', entityId: 2, actorId: 'system', companyId: 1, data: { assetCode: 'EXC-11', alert: 'GEOFENCE' } });
  rt.bus.drain(); await ap.deliverDue();
  let d = t.db.prepare("SELECT * FROM api_webhook_deliveries WHERE payload_json LIKE '%GEOFENCE%'").get();
  assert.deepEqual([d.status, d.attempts, d.response_code], ['FAILED', 1, 500]); assert.ok(d.next_attempt_at > new Date().toISOString());
  assert.deepEqual(await ap.deliverDue(), { delivered: 0, failed: 0, dead: 0 }, 'not before its back-off');
  t.db.prepare('UPDATE api_webhook_deliveries SET next_attempt_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', d.id);
  await ap.deliverDue(); d = t.db.prepare('SELECT * FROM api_webhook_deliveries WHERE id = ?').get(d.id);
  assert.deepEqual([d.status, d.attempts], ['DELIVERED', 2]);
  // replay and the log
  const rp = await t.call(it, 'POST', `${A}/deliveries/${d.id}/replay`);
  assert.equal(rp.status, 201, JSON.stringify(rp.json)); assert.deepEqual([rp.json.data.status, rp.json.data.replayOf, rp.json.data.eventId], ['DELIVERED', d.id, d.event_id]);
  const log = (await t.call(aud, 'GET', `${A}/deliveries?webhookId=${h.json.data.id}`)).json.data; assert.equal(log.total, 4);
  assert.equal((await t.api.raw('GET', `${A}/deliveries/export?format=csv`, aud)).status, 200);
  const hooks = (await t.call(aud, 'GET', `${A}/webhooks`)).json.data.rows; assert.equal(hooks[0].ok, 4);
  assert.equal((await t.call(aud, 'POST', `${A}/deliveries/${d.id}/replay`)).status, 403);
  assert.equal((await t.call(it, 'POST', `${A}/webhooks/${h.json.data.id}/disable`)).json.data.status, 'DISABLED');
  publishEvent(t.db, { type: 'plant.telematics.alerted', entity: 'plt_equipment', entityId: 3, actorId: 'system', companyId: 1, data: { assetCode: 'EXC-11' } });
  rt.bus.drain(); const before = got.length; await ap.deliverDue(); assert.equal(got.length, before, 'a disabled webhook receives nothing');
  // volume: 100,000 deliveries list fast
  t.db.exec('BEGIN'); const ins = t.db.prepare("INSERT INTO api_webhook_deliveries (company_id, webhook_id, event_id, event_type, payload_json, status, next_attempt_at) VALUES (1, ?, ?, 'plant.x.y', '{}', 'DELIVERED', '2026-01-01')");
  for (let i = 0; i < 100_000; i += 1) ins.run(h.json.data.id, `bulk-${i}`); t.db.exec('COMMIT');
  const t0 = performance.now(); assert.equal((await t.call(aud, 'GET', `${A}/deliveries?webhookId=${h.json.data.id}&pageSize=25`)).status, 200); assert.ok(performance.now() - t0 < 500);
});
