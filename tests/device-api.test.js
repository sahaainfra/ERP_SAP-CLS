import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { admin, setupCompany, startApi } from './helpers.js';
import { createDeviceService } from '../src/server/modules/ui/device.js';

// Part 03.06: the device server contract: the camera's limits, push subscriptions (own devices only, vendor push services only), a test
// notification, and the resolver that turns a scanned code into the record it names under the person's own permission and scope.
const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `dev-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pm = as('PM', 'pm1');
const acc = as('ACCMGR', 'acc1');
const today = '2026-10-31';
const keys = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
};
const sub = (n, extra = {}) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: keys(), ...extra });

async function world(api) {
  await setupCompany(api, { company: '1' });
  const mr = await api.call('POST', '/api/v1/core/number-series', { ...admin('1'), headers: key('n'), body: { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' } });
  assert.equal(mr.status, 201, JSON.stringify(mr.json));
  const project = (await api.call('POST', '/api/v1/iam/org/projects', { ...pm, headers: key('p'), body: { code: 'NH1', name: 'NH-48 Widening', type: 'ROAD' } })).json.data;
  const site = (await api.call('POST', '/api/v1/iam/org/sites', { ...pm, headers: key('s'), body: { code: 'S1', name: 'Km 12 camp', projectId: project.id } })).json.data;
  return { project, site };
}
const record = async (api, w) => (await api.call('POST', `${U}/sample-requests`, { ...pm, headers: key('mk'), body: { title: 'Footing F3', docDate: today, requiredBy: '2026-11-05', projectId: w.project.id, siteId: w.site.id, priority: 'NORMAL', returnable: false, lines: [{ description: 'TMT bar', uom: 'MT', quantity: '2', unitRate: '58000' }] } })).json.data;

test('BR-02 FR-06 the camera\'s limits are parameters of the company, smaller for low bandwidth; push is on offer once the installation has a key pair', async () => {
  const api = await startApi();
  await world(api);
  const s = (await api.call('GET', `${U}/device-settings`, pm)).json.data;
  assert.deepEqual([s.image, s.lowBandwidth], [{ maxPx: 1600, quality: 0.8 }, { maxPx: 1024, quality: 0.6 }]);
  assert.equal(s.push.available, true);
  assert.match(s.push.publicKey, /^[\w-]{86,90}$/);
  // a company can change the limits within the range the parameter allows
  const set = await api.call('POST', '/api/v1/core/parameters', { ...admin('1'), headers: key('prm'), body: { key: 'ui.device.image_max_px', scopeType: 'company', scopeId: 1, value: 1200, effectiveFrom: new Date(Date.now() + 19_800_000).toISOString().slice(0, 10), reason: 'Slow mobile data on the sites' } });
  assert.equal(set.status, 201, JSON.stringify(set.json));
  assert.equal((await api.call('GET', `${U}/device-settings`, pm)).json.data.image.maxPx, 1200);
  const tooBig = await api.call('POST', '/api/v1/core/parameters', { ...admin('1'), headers: key('prm2'), body: { key: 'ui.device.image_max_px', scopeType: 'company', scopeId: 1, value: 9000, effectiveFrom: new Date(Date.now() + 19_800_000).toISOString().slice(0, 10), reason: 'Larger photos for the survey' } });
  assert.ok(tooBig.status >= 400 && tooBig.status < 500, 'above the allowed range');
  await api.close();
});

test('FR-04 push subscriptions: own devices only, vendor push services only, one per browser, ten per person', async () => {
  const api = await startApi();
  await world(api);
  const post = (who, body, k = 'sub') => api.call('POST', `${U}/push-subscriptions`, { ...who, headers: { ...key(k), 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130' }, body });
  const a = await post(pm, sub(1, { deviceLabel: 'Site phone' }));
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.deepEqual([a.json.data.deviceLabel, a.json.data.host], ['Site phone', 'fcm.googleapis.com']);
  assert.equal(JSON.stringify(a.json).includes('p256dh'), false, 'the keys are never sent back');
  // the same browser again is the same subscription
  const again = await post(pm, { ...sub(1), keys: keys() });
  assert.equal(again.status, 201);
  assert.equal(again.json.data.id, a.json.data.id);
  assert.equal((await api.call('GET', `${U}/push-subscriptions`, pm)).json.data.length, 1);
  // refusals: not a push service, not https, malformed keys
  const refuse = async (body, field) => {
    const r = await post(pm, body, 'bad');
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.match(JSON.stringify(r.json.error), new RegExp(field));
  };
  await refuse({ ...sub(2), endpoint: 'https://evil.example.com/x' }, 'known browser push service');
  await refuse({ ...sub(2), endpoint: 'http://fcm.googleapis.com/x' }, 'https');
  await refuse({ ...sub(2), endpoint: 'https://localhost/x' }, 'known browser push service');
  await refuse({ ...sub(2), endpoint: 'https://169.254.169.254/latest' }, 'known browser push service');
  await refuse({ ...sub(2), keys: { p256dh: 'short', auth: 'x' } }, 'p256dh');
  await refuse({ ...sub(2), extra: 1 }, 'extra|unrecognized|Unrecognized');
  // personal: another person sees nothing and cannot remove it
  const other = as('PM', 'pm2');
  assert.equal((await api.call('GET', `${U}/push-subscriptions`, other)).json.data.length, 0);
  assert.equal((await api.call('DELETE', `${U}/push-subscriptions/${a.json.data.id}`, other)).status, 404);
  assert.equal((await api.call('DELETE', `${U}/push-subscriptions`, { ...other, headers: json, body: { endpoint: sub(1).endpoint } })).status, 404);
  // a browser that changes hands moves to the new person
  const moved = await post(other, sub(1));
  assert.equal(moved.status, 201);
  assert.equal((await api.call('GET', `${U}/push-subscriptions`, pm)).json.data.length, 0);
  assert.equal((await api.call('GET', `${U}/push-subscriptions`, other)).json.data.length, 1);
  // the limit
  for (let i = 10; i < 20; i += 1) assert.equal((await post(pm, sub(i), `l${i}`)).status, 201);
  const over = await post(pm, sub(99), 'over');
  assert.equal(over.status, 422);
  assert.match(over.json.error.message, /at most|can keep 10/i);
  // removal, by address or by row
  assert.equal((await api.call('DELETE', `${U}/push-subscriptions`, { ...pm, headers: json, body: { endpoint: sub(10).endpoint } })).status, 200);
  const rows = (await api.call('GET', `${U}/push-subscriptions`, pm)).json.data;
  assert.equal(rows.length, 9);
  assert.equal((await api.call('DELETE', `${U}/push-subscriptions/${rows[0].id}`, pm)).status, 200);
  // audited and announced
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_push_subscriptions' AND action IN ('subscribe', 'unsubscribe', 'resubscribe')").get().n >= 12);
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'ui.push_subscription.changed'").get().n >= 12);
  await api.close();
});

test('FR-04 a test notification goes to the person\'s own devices, and a device the push service has dropped is forgotten', async () => {
  const api = await startApi();
  await world(api);
  const sent = [];
  let reply = { ok: true, gone: false, status: 201 };
  const service = createDeviceService({ db: api.db, push: { vapid: { publicKey: 'k' }, send: async (s, m) => { sent.push({ s, m }); return typeof reply === 'function' ? reply(s) : reply; } } });
  const actor = { user: 'pm1', companyId: 1, roles: ['PM'] };
  await assert.rejects(() => service.sendTest(actor), /None of your devices/);
  service.subscribe(actor, sub(1), 'ua');
  service.subscribe(actor, sub(2), 'ua');
  service.subscribe({ ...actor, user: 'pm2' }, sub(3), 'ua');
  const ok = await service.sendTest(actor);
  assert.deepEqual(ok.results.map((r) => r.delivered), [true, true]);
  assert.equal(sent.length, 2, 'only the person\'s own devices');
  assert.match(sent[0].m.body, /Notifications work/);
  assert.ok(sent.every((x) => x.s.p256dh && x.s.auth && x.s.endpoint.includes('device-')));
  reply = (s) => (s.endpoint.endsWith('device-1') ? { ok: false, gone: true, status: 410 } : { ok: false, gone: false, status: 500 });
  const next = await service.sendTest(actor);
  assert.deepEqual(next.results.map((r) => [r.gone, r.delivered]), [[true, false], [false, false]]);
  assert.equal(service.subscriptions(actor).length, 1, 'the dropped device is gone');
  assert.equal(api.db.prepare('SELECT failure_count FROM ui_push_subscriptions WHERE endpoint LIKE ?').get('%device-2').failure_count, 1);
  const none = createDeviceService({ db: api.db, push: null });
  await assert.rejects(() => none.sendTest(actor), /not set up/);
  assert.throws(() => none.subscribe(actor, sub(4), 'ua'), /not set up/);
  await api.close();
});

test('FR-04 the resolver turns a scanned code into the record it names, if the person may open it', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await record(api, w);
  const sent = (await api.call('POST', `${U}/sample-requests/${r.id}/submit`, { ...pm, headers: key('sub'), body: { version: r.version } })).json.data;
  const resolve = (who, code) => api.call('GET', `${U}/qr/resolve?code=${encodeURIComponent(code)}`, who);
  const byNumber = await resolve(pm, sent.docNo);
  assert.equal(byNumber.status, 200, JSON.stringify(byNumber.json));
  assert.deepEqual([byNumber.json.data.status, byNumber.json.data.type, byNumber.json.data.id, byNumber.json.data.route], ['found', 'SAMPLE_REQUEST', r.id, `/admin/sample-requests?open=${r.id}`]);
  assert.match(byNumber.json.data.title, new RegExp(sent.docNo.replace(/[/]/g, '\\/')));
  const byPayload = await resolve(pm, `ERP:SAMPLE_REQUEST:${r.id}`);
  assert.equal(byPayload.json.data.id, r.id);
  // a person who cannot use the record type, or a stranger's code, learns nothing more than "not known"
  const none = await resolve(as('EMP', 'emp1'), sent.docNo);
  const missing = await resolve(pm, 'ERP:SAMPLE_REQUEST:99999');
  const junk = await resolve(pm, 'hello world');
  for (const x of [none, missing, junk]) {
    assert.equal(x.status, 404);
    assert.match(x.json.error.message, /not one this application knows, or it names something you cannot open/);
  }
  assert.equal((await resolve(pm, '')).status, 400, 'a code is needed');
  assert.equal((await resolve(pm, 'x'.repeat(250))).status, 400);
  assert.equal((await resolve(pm, 'MR/1\n2')).status, 404, 'control characters are not a code');
  // another company's request is never found
  await setupCompany(api, { company: '2' });
  assert.equal((await resolve(as('PM', 'pm9', '2'), sent.docNo)).status, 404);
  await api.close();
});

test('the device endpoints are for signed-in people only', async () => {
  const api = await startApi({ AUTH_MODE: 'iam' });
  for (const [method, path] of [['GET', '/device-settings'], ['GET', '/push-subscriptions'], ['GET', '/qr/resolve?code=x']]) {
    const res = await api.call(method, `${U}${path}`, {});
    assert.equal(res.status, 401, `${method} ${path} without a sign-in`);
  }
  await api.close();
});

test('FR-07 the field home\'s quick actions come from the registry: only pages the role may open, in the order the registry sets, under the name the tile gives', async () => {
  const api = await startApi();
  await world(api);
  const tiles = async (who) => (await api.call('GET', `${U}/navigation`, who)).json.data.groups.flatMap((g) => g.pages).filter((p) => p.field).sort((a, b) => a.field.order - b.field.order).map((p) => [p.field.code, p.field.label]);
  const all = [['material-request', 'Material Request'], ['scan', 'Scan'], ['approvals', 'Approvals'], ['drafts', 'My Drafts']];
  assert.deepEqual(await tiles(pm), all.filter(([c]) => c !== 'approvals'), 'a project manager raises requests but decides none');
  assert.deepEqual(await tiles(acc), all, 'the accounts manager has them all');
  assert.deepEqual(await tiles(as('SE', 'se1')), [['scan', 'Scan'], ['drafts', 'My Drafts']], 'a site engineer: only what is open to every signed-in person');
  const pages = (await api.call('GET', `${U}/navigation`, pm)).json.data.groups.flatMap((g) => g.pages);
  assert.deepEqual(['field-home', 'field-scan'].map((c) => pages.some((p) => p.code === c)), [true, true], 'both pages are in everyone\'s menu');
  await api.close();
});
