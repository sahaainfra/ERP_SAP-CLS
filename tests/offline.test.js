import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { todayIST } from '../src/shared/dates.js';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { EICAR } from '../src/server/platform/files/scan.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.15: the offline-first field engine (the server half).
// T-01 a duplicate replay creates one record and out-of-order commands are handled; T-02 a field-level conflict is resolved (mine, the server's, field by field); T-03 a revoked device is told to wipe itself.
const O = '/api/v1/off';
const json = { 'content-type': 'application/json' };
const key = (k = 'o') => ({ ...json, 'idempotency-key': `off-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const se = as('SE', 'se1');
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const it = as('ITADM', 'it1');
const aud = as('AUD', 'aud1');
const emp = as('EMP', 'emp1');
const DEV = 'device-se1-aaaa';
let n = 0;
const cid = () => `cmd-${Date.now().toString(36)}-${(n += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Kumar`, JSON.stringify(roles), `${name}@example.com`);
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [u, r] of [['se1', ['SE']], ['pd1', ['PD']], ['pm1', ['PM']], ['it1', ['ITADM']], ['aud1', ['AUD']], ['emp1', ['EMP']]]) user(api, u, r);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const call = (who, method, path, body, k) => api.call(method, `${O}${path}`, { ...who, headers: key(k), body });
  const reg = async (who = se, deviceId = DEV) => { const r = await call(who, 'POST', '/devices', { deviceId, name: 'Site phone', platform: 'Android' }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  const sync = (who, commands, extra = {}) => call(who, 'POST', '/sync', { deviceId: DEV, deviceTime: new Date().toISOString(), commands, ...extra }, 's');
  const create = (over = {}) => ({ id: cid(), seq: 1, type: 'sample_doc', op: 'create', values: { title: 'Shuttering at P1', amount: '12000.00', projectId: project }, createdAt: new Date().toISOString(), ...over });
  const drain = async () => { runtimeOf(api.db).bus.drain(); await runtimeOf(api.db).jobs.drain(); };
  return { api, project, call, reg, sync, create, drain };
};
const docs = (api) => api.db.prepare('SELECT * FROM eng_sample_docs ORDER BY id').all();

test('FR-08 the engine lists the offline forms, available or planned, and registers a device once', async () => {
  const { api, reg, call } = await setup();
  const d = await reg();
  assert.deepEqual([d.deviceId, d.status, d.user], [DEV, 'ACTIVE', 'se1']);
  assert.equal((await reg()).id, d.id, 'registering again is the same device');
  const m = (await call(se, 'GET', '/masters')).json.data;
  const forms = Object.fromEntries(m.forms.map((f) => [f.code, f]));
  assert.equal(forms.sample_doc.available, true);
  assert.deepEqual(forms.sample_doc.rules, { titleMin: 3, titleMax: 200, amountPattern: '^\\d{1,13}(\\.\\d{1,2})?$', amountMin: '0.01' });
  for (const c of ['attendance_punch', 'dpr', 'material_request', 'grn_count', 'inspection_checklist', 'hse_observation', 'log_book_entry']) assert.deepEqual([forms[c].available, forms[c].planned], [false, true], c);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM off_devices').get().n, 1);
});

test('T-01 BR-01 a duplicate replay creates one record; the answer to the second send is the first answer', async () => {
  const { api, reg, sync, create } = await setup();
  await reg();
  const c = create();
  const a = (await sync(se, [c])).json.data;
  assert.equal(a.results[0].status, 'APPLIED', JSON.stringify(a));
  const doc = docs(api);
  assert.equal(doc.length, 1);
  assert.equal(doc[0].requested_by, 'se1');
  assert.equal(doc[0].source_type, 'off_command');
  for (let i = 0; i < 3; i += 1) {
    const again = (await sync(se, [c])).json.data.results[0];
    assert.deepEqual([again.status, again.replayed, again.entityId], ['APPLIED', true, String(doc[0].id)]);
  }
  assert.equal(docs(api).length, 1, 'N replays, one record');
  // the same command id from another person is refused, never replayed into their name
  await reg(pd, 'device-pd1-aaaa');
  const stolen = (await api.call('POST', `${O}/sync`, { ...pd, headers: key('s'), body: { deviceId: 'device-pd1-aaaa', commands: [c] } })).json.data.results[0];
  assert.equal(stolen.status, 'REJECTED');
  assert.equal(docs(api).length, 1);
});

test('T-01 FR-03 commands arrive out of order: a change before the record it belongs to waits, and is applied when it is sent again', async () => {
  const { api, reg, sync, create } = await setup();
  await reg();
  const made = create({ id: cid(), seq: 1, ref: undefined, clientRef: 'ref-new-doc-0001' });
  const edit = { id: cid(), seq: 2, type: 'sample_doc', op: 'update', ref: 'ref-new-doc-0001', values: { title: 'Shuttering, corrected' }, createdAt: new Date().toISOString() };
  // the change reaches the server first
  const first = (await sync(se, [edit])).json.data.results[0];
  assert.deepEqual([first.status, first.retry], ['DEFERRED', true]);
  assert.equal(docs(api).length, 0);
  // then the record; then the change again
  assert.equal((await sync(se, [made])).json.data.results[0].status, 'APPLIED');
  const second = (await sync(se, [edit])).json.data.results[0];
  assert.equal(second.status, 'APPLIED', JSON.stringify(second));
  assert.equal(docs(api)[0].title, 'Shuttering, corrected');
  // in one batch the order of seq decides, whatever the order in the file
  const m2 = create({ seq: 10, clientRef: 'ref-new-doc-0002' });
  const e2 = { id: cid(), seq: 11, type: 'sample_doc', op: 'update', ref: 'ref-new-doc-0002', values: { amount: '15000.00' }, createdAt: new Date().toISOString() };
  const both = (await sync(se, [e2, m2])).json.data;
  assert.deepEqual(both.results.map((r) => r.status), ['APPLIED', 'APPLIED']);
  assert.equal(docs(api)[1].amount, 1500000);
});

test('FR-04 the server validates again; a form that does not exist, a person without the right and a bad amount are refused with a reason', async () => {
  const { api, reg, sync, create, call } = await setup();
  await reg();
  await reg(emp, 'device-emp1-aaa');
  const r = (await sync(se, [create({ values: { title: 'ab', amount: '12.345' } }), create({ id: cid(), seq: 2, type: 'nothing_here' }), create({ id: cid(), seq: 3, values: { title: 'Fine title', amount: '-5' } })])).json.data.results;
  assert.deepEqual(r.map((x) => x.status), ['REJECTED', 'REJECTED', 'REJECTED']);
  assert.match(r[0].error, /Title/);
  assert.match(r[1].error, /no offline form/);
  assert.match(r[2].error, /Amount/);
  assert.equal(docs(api).length, 0);
  const denied = (await api.call('POST', `${O}/sync`, { ...emp, headers: key('s'), body: { deviceId: 'device-emp1-aaa', commands: [create()] } })).json.data.results[0];
  assert.equal(denied.status, 'REJECTED');
  assert.match(denied.error, /eng\.sample\.use/);
  // a rejected command stays rejected on replay; nothing was made
  const c = create({ values: { title: 'x', amount: '5' } });
  assert.equal((await sync(se, [c])).json.data.results[0].status, 'REJECTED');
  assert.equal((await sync(se, [c])).json.data.results[0].replayed, true);
  // bad input at the door
  assert.equal((await call(se, 'POST', '/sync', { deviceId: DEV, commands: [{ id: 'short', type: 'sample_doc' }] })).status, 400);
  assert.equal((await call(se, 'POST', '/sync', { deviceId: DEV, commands: [] })).status, 400);
  assert.equal((await call(se, 'POST', '/sync', { deviceId: 'device-never-registered', commands: [create()] })).json.error.code, 'DEVICE_UNKNOWN');
});

test('T-02 FR-06 a conflict is found field by field; changes to other fields merge by themselves; mine, the server\'s or a mix resolves it', async () => {
  const { api, reg, sync, create, call, project } = await setup();
  await reg();
  const mk = async (title) => (await api.call('POST', '/api/v1/eng/sample-docs', { ...se, headers: key('d'), body: { title, amount: '1000.00', projectId: project } })).json.data;
  const serverEdit = (d, body) => api.call('PUT', `/api/v1/eng/sample-docs/${d.id}`, { ...se, headers: key('u'), body: { title: d.title, amount: '1000.00', projectId: project, version: d.version, ...body } });
  const upd = (d, values, baseValues) => ({ id: cid(), seq: 1, type: 'sample_doc', op: 'update', entityId: String(d.id), baseVersion: d.version, baseValues, values, createdAt: new Date().toISOString() });
  // a change to another field is not a conflict
  const a = await mk('Kerb stones');
  await serverEdit(a, { amount: '2000.00' });
  const ok = (await sync(se, [upd(a, { title: 'Kerb stones, 300 mm' }, { title: 'Kerb stones' })])).json.data.results[0];
  assert.equal(ok.status, 'APPLIED', JSON.stringify(ok));
  assert.deepEqual([docs(api)[0].title, docs(api)[0].amount], ['Kerb stones, 300 mm', 200000]);
  // the same field changed on both sides
  const clash = async (title) => {
    const d = await mk(title);
    await serverEdit(d, { title: `${title} (server)` });
    const r = (await sync(se, [upd(d, { title: `${title} (mine)`, amount: '3000.00' }, { title, amount: '1000.00' })])).json.data.results[0];
    assert.equal(r.status, 'CONFLICT', JSON.stringify(r));
    assert.deepEqual(r.conflict.fields.map((f) => [f.key, f.base, f.mine, f.server]), [['title', title, `${title} (mine)`, `${title} (server)`]]);
    assert.deepEqual(r.conflict.otherChanges, { amount: '3000.00' });
    const row = api.db.prepare('SELECT id FROM off_sync_log WHERE command_id = ?').get(r.commandId);
    return { d, id: row.id };
  };
  const get = (id) => ({ ...api.db.prepare('SELECT title, amount FROM eng_sample_docs WHERE id = ?').get(id) });
  const mine = await clash('Bricks');
  assert.equal(get(mine.d.id).title, 'Bricks (server)', 'nothing was overwritten');
  assert.equal((await call(se, 'POST', `/commands/${mine.id}/resolve`, { choice: 'MINE' })).json.data.status, 'RESOLVED');
  assert.deepEqual(get(mine.d.id), { title: 'Bricks (mine)', amount: 300000 });
  const server = await clash('Sand');
  await call(se, 'POST', `/commands/${server.id}/resolve`, { choice: 'SERVER' });
  assert.deepEqual(get(server.d.id), { title: 'Sand (server)', amount: 300000 }, 'the server\'s title; the amount nobody else touched is still mine');
  const merge = await clash('Cement');
  assert.equal((await call(se, 'POST', `/commands/${merge.id}/resolve`, { choice: 'MERGE', fields: {} })).status, 422, 'choose a side for every field');
  const done = (await call(se, 'POST', `/commands/${merge.id}/resolve`, { choice: 'MERGE', fields: { title: 'Cement OPC 53' } })).json.data;
  assert.deepEqual([done.status, done.resolution], ['RESOLVED', 'MERGE']);
  assert.equal(get(merge.d.id).title, 'Cement OPC 53');
  // resolving twice, or someone else's conflict, is refused
  assert.equal((await call(se, 'POST', `/commands/${merge.id}/resolve`, { choice: 'MINE' })).status, 409);
  const other = await clash('Steel');
  assert.equal((await call(pd, 'POST', `/commands/${other.id}/resolve`, { choice: 'MINE' })).status, 404);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'off_sync_log' AND action = 'resolve'").get());
  void create;
});

test('BR-02 a command older than the configured age waits for a supervisor, who cannot be its author and acts for the author\'s rights', async () => {
  const { api, reg, sync, create, call } = await setup();
  await reg();
  const old = create({ createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString() });
  const r = (await sync(se, [old])).json.data.results[0];
  assert.deepEqual([r.status, docs(api).length], ['NEEDS_CONFIRMATION', 0]);
  assert.match(r.error, /7 days/);
  const row = api.db.prepare('SELECT id FROM off_sync_log WHERE command_id = ?').get(old.id).id;
  assert.equal((await call(se, 'GET', '/confirmations')).status, 403, 'the author is not a supervisor');
  assert.equal((await call(se, 'POST', `/commands/${row}/confirm`, { decision: 'CONFIRM' })).status, 403);
  assert.equal((await call(emp, 'POST', `/commands/${row}/confirm`, { decision: 'CONFIRM' })).status, 403);
  const waiting = (await call(pm, 'GET', '/confirmations')).json.data.rows;
  assert.deepEqual(waiting.map((w) => [w.id, w.user]), [[row, 'se1']]);
  const done = (await call(pm, 'POST', `/commands/${row}/confirm`, { decision: 'CONFIRM' })).json.data;
  assert.deepEqual([done.status, done.confirmedBy], ['APPLIED', 'pm1']);
  assert.deepEqual([docs(api).length, docs(api)[0].requested_by], [1, 'se1']);
  assert.equal((await call(pm, 'POST', `/commands/${row}/confirm`, { decision: 'CONFIRM' })).status, 409);
  // declined: nothing is made
  const old2 = create({ createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString() });
  await sync(se, [old2]);
  const row2 = api.db.prepare('SELECT id FROM off_sync_log WHERE command_id = ?').get(old2.id).id;
  assert.equal((await call(pm, 'POST', `/commands/${row2}/confirm`, { decision: 'DECLINE', reason: 'Not needed any more' })).json.data.status, 'DECLINED');
  assert.equal(docs(api).length, 1);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'off_sync_log' AND action = 'decline_old' AND reason = 'Not needed any more'").get());
});

test('T-03 BR-03 a revoked device is told to wipe itself at its next contact, whatever it asks; it cannot come back', async () => {
  const { api, reg, create, call } = await setup();
  const d = await reg();
  assert.equal((await call(se, 'POST', `/devices/${d.id}/revoke`, { reason: '' })).status, 400);
  assert.equal((await call(pd, 'POST', `/devices/${d.id}/revoke`, { reason: 'Not mine to revoke' })).status, 404, 'another field user cannot');
  const revoked = await call(it, 'POST', `/devices/${d.id}/revoke`, { reason: 'Phone lost on site' });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
  assert.deepEqual([revoked.json.data.status, revoked.json.data.revokedBy], ['REVOKED', 'it1']);
  for (const [method, path, body] of [['POST', '/sync', { deviceId: DEV, commands: [create()] }], ['POST', '/devices', { deviceId: DEV }]]) {
    const r = await call(se, method, path, body);
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error.code, 'DEVICE_REVOKED');
    assert.equal(r.json.error.details[0].wipe, true);
  }
  assert.equal(docs(api).length, 0, 'nothing from a revoked device is saved');
  assert.equal((await call(it, 'POST', `/devices/${d.id}/revoke`, { reason: 'twice' })).status, 409);
  assert.equal((await call(se, 'POST', '/devices/wiped', { deviceId: DEV })).json.data.status, 'WIPED');
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'off_devices' AND action = 'revoke' AND reason = 'Phone lost on site'").get());
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'off.device.revoked'").get());
  // a person revokes their own lost phone
  const mine = await reg(pd, 'device-pd1-aaaa');
  assert.equal((await call(pd, 'POST', `/devices/${mine.id}/revoke`, { reason: 'Lost my phone' })).json.data.status, 'REVOKED');
  // the list: own devices; all of them for the IT administrator
  assert.deepEqual((await call(se, 'GET', '/devices?all=true')).json.data.rows.map((r) => r.user), ['se1']);
  const all = (await call(it, 'GET', '/devices?all=true')).json.data;
  assert.deepEqual([all.total, all.counts, all.canManage], [2, { active: 0, revoked: 2 }, true]);
});

test('FR-09 the difference between the device clock and the server clock is measured and the time of a command is corrected by it', async () => {
  const { api, reg, sync, create, call } = await setup();
  await reg();
  const ahead = 10 * 60_000;
  const captured = new Date(Date.now() + ahead - 60_000).toISOString(); // the device thought it was a minute ago, but its clock runs 10 minutes fast
  const r = (await sync(se, [create({ createdAt: captured })], { deviceTime: new Date(Date.now() + ahead).toISOString() })).json.data;
  assert.ok(Math.abs(r.driftMs - ahead) < 5000, `drift ${r.driftMs}`);
  assert.match(r.driftWarning, /ahead of the server/);
  const row = api.db.prepare('SELECT client_created_at, effective_at, received_at FROM off_sync_log').get();
  assert.ok(Math.abs(Date.parse(row.effective_at) - (Date.now() - 60_000)) < 5000, 'the time is the server\'s view of when it happened');
  assert.notEqual(row.client_created_at, row.effective_at);
  assert.ok(Math.abs((await call(se, 'GET', '/devices')).json.data.rows[0].clockDriftMs - ahead) < 5000);
  const ok = (await sync(se, [create({ id: cid() })])).json.data;
  assert.equal(ok.driftWarning, null);
  void api;
});

test('FR-02 masters: the subsets a role needs, a delta since the last time, removed rows, and nothing for a role with no form', async () => {
  const { api, project, call } = await setup();
  const full = (await call(se, 'GET', '/masters')).json.data;
  assert.deepEqual(Object.keys(full.masters).sort(), ['people', 'projects', 'sites']);
  assert.deepEqual(full.masters.projects.rows.map((p) => p.code), ['P1']);
  assert.equal(full.masters.projects.full, true);
  assert.ok(Date.parse(full.expiresAt) > Date.now() + 71 * 3_600_000, 'the copy may be used for 72 hours without contact');
  assert.ok(full.masters.people.rows.some((p) => p.code === 'pd1'));
  const since = full.serverTime;
  const none = (await call(se, 'GET', `/masters?since=${encodeURIComponent(since)}`)).json.data;
  assert.deepEqual([none.masters.projects.rows.length, none.masters.projects.full], [0, false], 'nothing changed: nothing sent');
  await new Promise((r) => setTimeout(r, 15));
  api.db.prepare("UPDATE org_projects SET name = 'Ring Road, phase 2', updated_at = ? WHERE id = ?").run(new Date().toISOString(), project);
  const delta = (await call(se, 'GET', `/masters?since=${encodeURIComponent(since)}`)).json.data;
  assert.deepEqual(delta.masters.projects.rows.map((p) => p.name), ['Ring Road, phase 2']);
  const p2 = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, is_active, created_by, source_type) VALUES (1, 'P2', 'Bypass', 'ROAD', 'ACTIVE', 1, 't', 'test')").run().lastInsertRowid);
  const t2 = (await call(se, 'GET', '/masters')).json.data.serverTime;
  await new Promise((r) => setTimeout(r, 15));
  api.db.prepare("UPDATE org_projects SET is_active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), p2);
  const gone = (await call(se, 'GET', `/masters?since=${encodeURIComponent(t2)}`)).json.data.masters.projects;
  assert.deepEqual([gone.rows.length, gone.removed], [0, [p2]]);
  assert.deepEqual(Object.keys((await call(se, 'GET', '/masters?codes=sites')).json.data.masters), ['sites']);
  const e = (await call(emp, 'GET', '/masters')).json.data;
  assert.deepEqual([Object.keys(e.masters), e.forms.find((f) => f.code === 'sample_doc').available], [[], false]);
  assert.equal((await call(se, 'GET', '/masters?since=yesterday')).status, 400);
});

test('AC-01 FR-05 a photo goes up in chunks, resumes after a break, is checked (type, virus, size) and is attached to the record the command made', async () => {
  const { api, reg, sync, create, call } = await setup();
  await reg();
  const c = create();
  const start = (body = {}) => call(se, 'POST', '/uploads', { deviceId: DEV, commandId: c.id, fileName: 'site.png', totalSize: PNG.length, chunkSize: 40, ...body });
  assert.equal((await start()).status, 404, 'the record must be sent first');
  assert.equal((await sync(se, [c])).json.data.results[0].status, 'APPLIED');
  const put = (id, i, buf, who = se) => api.raw('PUT', `${O}/uploads/${id}/chunks/${i}`, { ...who, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': `c-${i}-${Math.random()}` }, body: buf });
  const u = (await start()).json.data;
  assert.deepEqual([u.totalChunks, u.received, u.status], [Math.ceil(PNG.length / 40), [], 'OPEN']);
  assert.equal((await put(u.uploadId, 0, PNG.subarray(0, 39))).status, 422, 'a chunk of the wrong size');
  assert.equal((await put(u.uploadId, 99, PNG.subarray(0, 40))).status, 400);
  assert.equal((await put(u.uploadId, 0, PNG.subarray(0, 40))).status, 200);
  // the connection breaks; the phone asks again and is told what is already there
  const again = (await start()).json.data;
  assert.deepEqual([again.uploadId, again.received], [u.uploadId, [0]]);
  assert.equal((await call(se, 'POST', `/uploads/${u.uploadId}/complete`)).status, 422, 'not all chunks yet');
  assert.equal((await put(u.uploadId, 1, PNG.subarray(40, 80), pd)).status, 404, 'only the owner');
  for (let i = 1; i < u.totalChunks; i += 1) assert.equal((await put(u.uploadId, i, PNG.subarray(i * 40, (i + 1) * 40))).status, 200);
  const done = await call(se, 'POST', `/uploads/${u.uploadId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.status, 'COMPLETE');
  const file = api.db.prepare('SELECT * FROM core_files WHERE id = ?').get(done.json.data.fileId);
  assert.deepEqual([file.linked_entity, file.linked_id, file.scan_status, file.mime, file.size_bytes], ['sample_doc', docs(api)[0].id, 'CLEAN', 'image/png', PNG.length]);
  assert.equal((await call(se, 'POST', `/uploads/${u.uploadId}/complete`)).json.data.fileId, file.id, 'completing twice is the same file');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_files WHERE source_type = 'off_upload'").get().n, 1);
  // the photo is among the document's files for whoever may open the document
  const list = await api.call('GET', `/api/v1/core/files?entity=sample_doc&entityId=${docs(api)[0].id}`, pd);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.equal(list.json.data.length ?? list.json.data.rows?.length, 1);
  // a virus, a program renamed as a photo, a file that is not what its name says, a file too large
  const bad = async (name, buf) => {
    const s = (await call(se, 'POST', '/uploads', { deviceId: DEV, commandId: c.id, fileName: name, totalSize: buf.length, chunkSize: 1024 })).json.data;
    assert.equal((await put(s.uploadId, 0, buf)).status, 200);
    return call(se, 'POST', `/uploads/${s.uploadId}/complete`);
  };
  assert.equal((await bad('virus.png', Buffer.concat([PNG, Buffer.from(EICAR)]))).status, 422);
  assert.equal((await bad('fake.png', Buffer.from('MZ not a picture at all, but a program'))).status, 422);
  assert.equal((await bad('notes.exe', PNG)).status, 422);
  assert.equal((await call(se, 'POST', '/uploads', { deviceId: DEV, commandId: c.id, fileName: 'big.png', totalSize: 30 * 1024 * 1024, chunkSize: 1024 })).status, 400);
});

test('FR-07 the person sees their own commands and what became of them; the auditor sees all; the supervisor list is for supervisors', async () => {
  const { api, reg, sync, create, call } = await setup();
  await reg();
  await reg(pd, 'device-pd1-aaaa');
  await sync(se, [create(), create({ id: cid(), seq: 2, values: { title: 'x', amount: '1' } })]);
  await api.call('POST', `${O}/sync`, { ...pd, headers: key('s'), body: { deviceId: 'device-pd1-aaaa', commands: [create({ id: cid() })] } });
  const mine = (await call(se, 'GET', '/commands')).json.data;
  assert.deepEqual([mine.total, mine.counts], [2, { APPLIED: 1, REJECTED: 1 }]);
  assert.deepEqual((await call(se, 'GET', '/commands?status=REJECTED')).json.data.rows.map((r) => r.status), ['REJECTED']);
  assert.equal((await call(se, 'GET', '/commands?all=true')).json.data.total, 2, 'all=true needs off.sync.view_all');
  assert.equal((await call(aud, 'GET', '/commands?all=true')).json.data.total, 3);
  assert.equal((await call(aud, 'GET', `/commands/${mine.rows[0].id}`)).status, 200);
  assert.equal((await call(emp, 'GET', `/commands/${mine.rows[0].id}`)).status, 404);
  assert.deepEqual((await call(se, 'GET', '/confirmations')).status, 403);
});

test('AC-04 the settings are parameters (limits, audit, effect at once); the feature flag switches the API off', async () => {
  const { api, reg, sync, create } = await setup();
  await reg();
  const set = (body) => api.call('POST', '/api/v1/core/parameters', { ...as('SYSADM', 'sys1'), headers: key('p'), body: { scopeType: 'company', scopeId: 1, effectiveFrom: todayIST(), reason: 'Sites in the hills sync rarely', ...body } });
  assert.equal((await set({ key: 'off.command.max_age_days', value: 500 })).status, 400);
  assert.equal((await set({ key: 'off.sync.batch_max', value: 10 })).status, 201);
  const cmds = Array.from({ length: 11 }, (_, i) => create({ id: cid(), seq: i }));
  assert.equal((await sync(se, cmds)).status, 422, 'more than the batch limit');
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE new_values LIKE '%off.sync.batch_max%'").get());
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.eng.p0415'").run();
  assert.equal((await sync(se, [create()])).status, 404);
});
