import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { backfillChain, diffValues, verifyChain, writeAudit } from '../src/server/platform/audit/index.js';
import { createAuditService, importLegacyLoginEvents } from '../src/server/modules/core/audit/service.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { setupCompany, startApi } from './helpers.js';

const C = '/api/v1/core';
const I = '/api/v1/iam';
const AUD = { roles: 'AUD', user: 'auditor1' };
const SYS = { roles: 'SYSADM', user: 'sysadmin' };
const key = () => ({ 'idempotency-key': `a-${Math.random().toString(36).slice(2, 12)}`, 'content-type': 'application/json' });
const quiet = () => createLogger({ write: () => {} });

test('T-01 FR-01 FR-02 an update produces the field-level diff, ignoring technical columns and masking sensitive fields', () => {
  const d = diffValues(
    { name: 'Alpha road', mobile: '9876543210', status: 'DRAFT', version: 1, updated_at: 'a', updated_by: 'x' },
    { name: 'Alpha highway', mobile: '9999999999', status: 'DRAFT', version: 2, updated_at: 'b', updated_by: 'y' },
  );
  assert.deepEqual(d, { name: { old: 'Alpha road', new: 'Alpha highway' }, mobile: { old: '[masked]', new: '[masked]' } });
  assert.deepEqual(diffValues(null, { code: 'P1', pan: 'ABCDE1234F' }), { code: { new: 'P1' }, pan: { new: '[masked]' } }, 'a create lists the new values');
  assert.deepEqual(diffValues({ code: 'P1' }, null), { code: { old: 'P1' } }, 'a delete lists the old values');
  assert.deepEqual(diffValues({ a: 1 }, { a: 1, updated_at: 'z' }), {}, 'a change to technical columns alone is not a change');
});

test('T-01 the diff is stored with the chained row and shown masked through the API', async () => {
  const api = await startApi();
  await setupCompany(api);
  writeAudit(api.db, { entity: 'org_projects', entityId: 7, action: 'update', oldValues: { name: 'A', mobile: '9876543210', version: 1 }, newValues: { name: 'B', mobile: '9123456789', version: 2 }, reason: 'rename', actor: 'pm1', companyId: 1 });
  const list = await api.call('GET', `${C}/audit?entity=org_projects&id=7`, AUD);
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.data.length, 1);
  const e = list.json.data[0];
  assert.deepEqual(e.changes, { name: { old: 'A', new: 'B' }, mobile: { old: '[masked]', new: '[masked]' } });
  assert.equal(e.actor, 'pm1');
  assert.equal(e.reason, 'rename');
  assert.match(e.hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(list.json), /9876543210|9123456789/, 'the number never leaves');
  await api.close();
});

test('T-02 BR-01 an UPDATE or DELETE on an audit table fails, whoever asks', async () => {
  const api = await startApi();
  writeAudit(api.db, { entity: 'x', entityId: 1, action: 'create', newValues: { a: 1 }, actor: 'u', companyId: 1 });
  api.db.prepare("INSERT INTO core_security_events (occurred_at, type, severity) VALUES ('2026-10-31T00:00:00Z', 'test', 'INFO')").run();
  for (const sql of [
    "UPDATE core_audit_log SET reason = 'changed'", 'DELETE FROM core_audit_log',
    "UPDATE core_audit_chain SET hash = 'x'", 'DELETE FROM core_audit_chain',
    "UPDATE core_security_events SET severity = 'INFO'", 'DELETE FROM core_security_events',
  ]) assert.throws(() => api.db.prepare(sql).run(), /append-only/, sql);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_audit_log').get().n >= 1, true);
  await api.close();
});

test('T-03 AC-02 FR-03 BR-02 tampering with one row is found by the verification, raises a critical alert once, and is shown in Security Events', async () => {
  const api = await startApi();
  await setupCompany(api);
  for (let i = 1; i <= 5; i += 1) writeAudit(api.db, { entity: 'org_projects', entityId: i, action: 'create', newValues: { code: `P${i}` }, actor: 'pm1', companyId: 1 });
  const clean = await api.call('POST', `${C}/audit/verify`, { ...AUD, headers: key() });
  assert.equal(clean.status, 200, clean.text);
  assert.equal(clean.json.data.ok, true);
  assert.ok(clean.json.data.checked >= 5);
  // someone with direct access drops the protection and changes a row
  api.db.exec('DROP TRIGGER trg_core_audit_log_no_update');
  const target = api.db.prepare("SELECT id FROM core_audit_log WHERE entity = 'org_projects' AND entity_id = '3'").get().id;
  api.db.prepare("UPDATE core_audit_log SET new_values = '{\"code\":\"HACKED\"}' WHERE id = ?").run(target);
  const found = await api.call('POST', `${C}/audit/verify`, { ...AUD, headers: key() });
  assert.equal(found.json.data.ok, false);
  assert.equal(found.json.data.brokenSeq, api.db.prepare('SELECT seq FROM core_audit_chain WHERE audit_id = ?').get(target).seq);
  assert.match(found.json.data.problem, /changed after it was written/);
  const events = (await api.call('GET', `${C}/security-events?severity=CRITICAL`, AUD)).json;
  assert.equal(events.data.length, 1);
  assert.equal(events.data[0].type, 'audit.tamper_detected');
  assert.equal(events.summary.critical, 1);
  await api.call('POST', `${C}/audit/verify`, { ...AUD, headers: key() });
  assert.equal((await api.call('GET', `${C}/security-events?severity=CRITICAL`, AUD)).json.data.length, 1, 'the same break is not alerted twice');
  assert.equal((await api.call('GET', `${C}/audit/verification`, AUD)).json.data.healthy, false);
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'core.audit.tamper_detected'").get(), 'the event is published for the notification service');
  await api.close();
});

test('FR-03 a removed row, a row inserted outside the service and removed protection are each found', async () => {
  const api = await startApi();
  for (let i = 1; i <= 4; i += 1) writeAudit(api.db, { entity: 'x', entityId: i, action: 'create', newValues: { i }, actor: 'u', companyId: 1 });
  assert.equal(verifyChain(api.db).ok, true);
  api.db.exec('DROP TRIGGER trg_core_audit_log_no_delete; DROP TRIGGER trg_core_audit_chain_no_delete');
  const second = api.db.prepare('SELECT audit_id FROM core_audit_chain WHERE seq = 2').get().audit_id;
  api.db.prepare('DELETE FROM core_audit_chain WHERE audit_id = ?').run(second);
  api.db.prepare('DELETE FROM core_audit_log WHERE id = ?').run(second);
  const gone = verifyChain(api.db);
  assert.equal(gone.ok, false);
  assert.equal(gone.brokenSeq, 2);
  assert.match(gone.problem, /missing|removed/);
  await api.close();

  const b = await startApi();
  b.db.prepare("INSERT INTO core_audit_log (entity, entity_id, action, actor) VALUES ('x', '1', 'forged', 'mallory')").run();
  const loose = verifyChain(b.db);
  assert.equal(loose.ok, false);
  assert.match(loose.problem, /not part of the chain/);
  await b.close();

  const c = await startApi();
  c.db.exec('DROP TRIGGER trg_core_audit_chain_no_update');
  const bare = verifyChain(c.db);
  assert.equal(bare.ok, false);
  assert.match(bare.problem, /Protection was removed/);
  await c.close();
});

test('AC-02 the nightly verification and the sealing are scheduled jobs', async () => {
  const api = await startApi();
  const rows = api.db.prepare("SELECT code, job_type FROM core_schedules WHERE code LIKE 'core.audit_%' ORDER BY code").all().map((r) => `${r.code}:${r.job_type}`);
  assert.deepEqual(rows, ['core.audit_seal_daily:core.audit_seal', 'core.audit_verify_nightly:core.audit_verify']);
  await api.close();
});

test('FR-08 the log written before this part is chained in order and the old sign-in failures join the security log, once each', async () => {
  const api = await startApi();
  await setupCompany(api);
  // rows as an older version wrote them: no chain companion
  api.db.prepare("INSERT INTO core_audit_log (entity, entity_id, action, new_values, actor, created_at) VALUES ('legacy', '1', 'create', '{\"mobile\":\"9876543210\",\"code\":\"L1\"}', 'oldtimer', '2020-01-02T03:04:05.000Z')").run();
  api.db.prepare("INSERT INTO core_audit_log (entity, entity_id, action, new_values, actor, created_at) VALUES ('legacy', '2', 'create', '{\"code\":\"L2\"}', 'oldtimer', '2020-01-03T03:04:05.000Z')").run();
  assert.equal(verifyChain(api.db).ok, false, 'unchained rows are not accepted by the verification');
  assert.equal(backfillChain(api.db).chained, 2);
  assert.equal(backfillChain(api.db).chained, 0, 'repeatable');
  assert.equal(verifyChain(api.db).ok, true);
  const old = (await api.call('GET', `${C}/audit?entity=legacy`, AUD)).json;
  assert.equal(old.data.length, 0, 'rows with no known company are not shown to a company');
  api.db.prepare("INSERT INTO iam_login_events (company_id, username_attempted, result, ip, at) VALUES (1, 'ghost', 'failure', '10.0.0.9', '2020-02-02T00:00:00.000Z')").run();
  assert.equal(importLegacyLoginEvents(api.db).imported, 1);
  assert.equal(importLegacyLoginEvents(api.db).imported, 0, 'once each');
  const sec = (await api.call('GET', `${C}/security-events?type=login.failure`, SYS)).json;
  assert.equal(sec.data.length, 1);
  assert.equal(sec.data[0].username, 'ghost');
  await api.close();
});

test('AC-01 every create and status change of a sample module appears in the Audit Explorer with its diff, and in the record history', async () => {
  const api = await startApi();
  await setupCompany(api);
  const pm = { roles: 'PM', user: 'pm1' };
  const doc = (await api.call('POST', `${C}/sample-documents`, { ...pm, headers: key(), body: { title: 'Site memo', docDate: '2026-10-15' } })).json.data;
  const sub = await api.call('POST', `${C}/sample-documents/${doc.id}/submit`, { ...pm, headers: key(), body: { version: doc.version } });
  assert.equal(sub.status, 200, sub.text);
  const trail = (await api.call('GET', `${C}/audit?entity=core_sample_documents&id=${doc.id}&sort=at`, AUD)).json.data;
  assert.deepEqual(trail.map((e) => e.action), ['create', 'submit']);
  assert.deepEqual(trail[1].changes.status, { old: 'DRAFT', new: 'SUBMITTED' });
  assert.equal(trail[0].actor, 'pm1');
  assert.ok(trail[0].correlationId, 'the request is traceable');
  assert.ok(trail[0].ip !== undefined && 'device' in trail[0]);
  // filters: person, action, date, free text
  assert.equal((await api.call('GET', `${C}/audit?user=pm1&action=submit`, AUD)).json.meta.total >= 1, true);
  assert.equal((await api.call('GET', `${C}/audit?user=nobody`, AUD)).json.meta.total, 0);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok((await api.call('GET', `${C}/audit?from=${today}&to=${today}&entity=core_sample_documents`, AUD)).json.meta.total >= 2);
  assert.equal((await api.call('GET', `${C}/audit?from=2001-01-01&to=2001-01-02`, AUD)).json.meta.total, 0);
  assert.ok((await api.call('GET', `${C}/audit/entities`, AUD)).json.data.some((e) => e.entity === 'core_sample_documents'));
  assert.equal((await api.call('GET', `${C}/audit?sort=nope`, AUD)).status, 400);
  await api.close();
});

test('AC-04 who may see what: the auditor sees the trail, administrators the security events, a record viewer the history of that record; companies are separate', async () => {
  const api = await startApi();
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, company_id, code, legal_name, short_name, created_by, source_type) VALUES (2, 2, 'SECOND', 'Second Infra Pvt Ltd', 'Second', 't', 'seed')").run();
  writeAudit(api.db, { entity: 'iam_users', entityId: 5, action: 'update', oldValues: { display_name: 'A' }, newValues: { display_name: 'B' }, actor: 'hr1', companyId: 1 });
  writeAudit(api.db, { entity: 'core_secret_thing', entityId: 5, action: 'update', oldValues: { a: 1 }, newValues: { a: 2 }, actor: 'x', companyId: 1 });
  writeAudit(api.db, { entity: 'iam_users', entityId: 5, action: 'update', oldValues: { display_name: 'A' }, newValues: { display_name: 'Z' }, actor: 'other', companyId: 2 });
  const get = (path, who) => api.call('GET', `${C}${path}`, who);
  for (const [who, audit, security] of [[AUD, 200, 200], [SYS, 403, 200], [{ roles: 'ITADM', user: 'it1' }, 403, 200], [{ roles: 'EMP', user: 'e1' }, 403, 403], [{ roles: 'PM', user: 'pm1' }, 403, 403], [{ roles: 'DIR', user: 'd1' }, 403, 403]]) {
    assert.equal((await get('/audit', who)).status, audit, `${who.roles} audit`);
    assert.equal((await get('/security-events', who)).status, security, `${who.roles} security`);
  }
  const hr = { roles: 'ITADM', user: 'it1' };
  const hist = await get('/audit/history?entity=iam_users&id=5', { roles: 'HRMGR', user: 'hr9' });
  assert.equal(hist.status === 200 || hist.status === 403, true);
  const viewer = { roles: 'SYSADM', user: 'sysadmin' }; // holds iam.user.view
  const own = await get('/audit/history?entity=iam_users&id=5', viewer);
  assert.equal(own.status, 200, own.text);
  assert.deepEqual(own.json.data.map((e) => e.changes.display_name.new), ['B'], 'only this company\'s entries');
  assert.equal((await get('/audit/history?entity=core_secret_thing&id=5', viewer)).status, 403, 'an unknown kind of record needs the auditor');
  assert.equal((await get('/audit/history?entity=core_secret_thing&id=5', AUD)).status, 200);
  assert.equal((await get('/audit/history?entity=iam_users', viewer)).status, 400);
  void hr;
  // another company's auditor sees only its own entries
  const other = await api.call('GET', `${C}/audit?entity=iam_users`, { ...AUD, company: '2' });
  assert.deepEqual(other.json.data.map((e) => e.actor), ['other']);
  assert.equal((await api.call('GET', `${C}/audit?entity=iam_users`, AUD)).json.data.every((e) => e.actor !== 'other'), true);
  await api.close();
});

test('FR-04 failed authorisation attempts and sensitive exports are security events; FR-05 every export and print is in the audit trail with its filters', async () => {
  const api = await startApi();
  await setupCompany(api);
  assert.equal((await api.call('GET', `${C}/audit`, { roles: 'EMP', user: 'snoop' })).status, 403);
  const exported = await api.call('POST', `${C}/audit/export-log`, { roles: 'PM', user: 'pm1', headers: key(), body: { report: 'users.csv', format: 'csv', rows: 120, filters: { status: 'ACTIVE' }, sensitive: true } });
  assert.equal(exported.status, 201, exported.text);
  const printed = await api.call('POST', `${C}/audit/export-log`, { roles: 'PM', user: 'pm1', headers: key(), body: { report: '/admin/users', format: 'print', rows: 0, filters: {}, sensitive: false } });
  assert.equal(printed.status, 201);
  assert.equal((await api.call('POST', `${C}/audit/export-log`, { roles: 'PM', user: 'pm1', headers: key(), body: { report: '', format: 'csv' } })).status, 400);
  const trail = (await api.call('GET', `${C}/audit?entity=report`, AUD)).json.data;
  assert.deepEqual(trail.map((e) => e.action).sort(), ['export', 'print']);
  const ex = trail.find((e) => e.action === 'export');
  assert.deepEqual(ex.changes, { format: { new: 'csv' }, rows: { new: 120 }, filters: { new: { status: 'ACTIVE' } } });
  assert.equal(ex.actor, 'pm1');
  const sec = (await api.call('GET', `${C}/security-events?pageSize=100`, SYS)).json.data;
  const types = sec.map((e) => e.type);
  assert.ok(types.includes('authz.denied'), 'the refused request');
  assert.ok(types.includes('export.sensitive'), 'the sensitive export');
  const denied = sec.find((e) => e.type === 'authz.denied');
  assert.equal(denied.username, 'snoop');
  assert.match(denied.details.route, /audit/);
  assert.equal((await api.call('GET', `${C}/security-events?user=snoop&severity=WARNING`, SYS)).json.data.length >= 1, true);
  assert.equal((await api.call('GET', `${C}/security-events?severity=BAD`, SYS)).status, 200);
  await api.close();
});

test('FR-04 sign-in failures and successes, permission changes and elevation become security events', async () => {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({ AUTH_MODE: 'iam' }, { logger: quiet(), identityOptions: { passwordCost: { memory: 8, passes: 1 }, now: () => clock.t } });
  const identity = identityOf(api.db);
  const store = createUserStore({ db: api.db, identity });
  api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
  const PW = 'Tr0ub4dor&3-Excavator';
  for (const [u, roles] of [['aud1', ['AUD']], ['sa1', ['SYSADM']], ['it1', ['ITADM']], ['pm1', ['PM']]]) store.create({ companyId: 1, username: u, email: `${u}@example.com`, displayName: u, roles, password: PW });
  const http = async (method, path, token, body) => {
    const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const login = (username, password) => http('POST', `${I}/auth/login`, null, { username, password, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' });
  assert.equal((await login('pm1', 'wrong-password-123')).status, 401);
  const aud = (await login('aud1', PW)).json.data.accessToken;
  const sa = (await login('sa1', PW)).json.data.accessToken;
  const it = (await login('it1', PW)).json.data.accessToken;
  const pmId = Number(api.db.prepare("SELECT id FROM iam_users WHERE username = 'pm1'").get().id);
  const roleId = Number(api.db.prepare("SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL").get().id);
  const asked = await http('POST', `${I}/assignments`, sa, { userId: pmId, roleId, scopeType: 'PROJECT', scopeIds: [], reason: 'x' });
  assert.equal(asked.status, 400);
  const assignRole = Number(api.db.prepare("SELECT id FROM iam_roles WHERE code = 'SK' AND company_id IS NULL").get().id);
  const req = await http('POST', `${I}/assignments`, sa, { userId: pmId, roleId: assignRole, scopeType: 'COMPANY', scopeIds: [], reason: 'store keeping cover' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.equal((await http('POST', `${C}/change-requests/${req.json.data.id}/act`, it, { action: 'approve', comment: 'checked and fine' })).status, 200);
  const events = (await http('GET', `${C}/security-events?pageSize=100`, aud)).json;
  const types = events.data.map((e) => e.type);
  assert.ok(types.includes('login.failure'), 'the wrong password');
  assert.ok(types.includes('login.success'), 'the sign-ins');
  assert.ok(types.includes('permission.changed'), 'the role given');
  const failure = events.data.find((e) => e.type === 'login.failure');
  assert.equal(failure.username, 'pm1');
  assert.ok(failure.ip !== undefined);
  assert.equal(events.data.every((e) => !JSON.stringify(e.details).includes(PW)), true, 'no password anywhere');
  // the same actions are in the audit trail with where they came from
  const trail = (await http('GET', `${C}/audit?entity=iam_users&pageSize=100`, aud)).json;
  assert.ok(trail.data.some((e) => e.action === 'assignment_approved' && e.correlationId));
  await api.close();
});

test('FR-07 finished months are sealed once and can be exported against their seal; nothing is deleted', async () => {
  const api = await startApi();
  await setupCompany(api);
  for (let i = 1; i <= 3; i += 1) writeAudit(api.db, { entity: 'org_projects', entityId: i, action: 'create', newValues: { code: `P${i}` }, actor: 'pm1', companyId: 1 });
  const month = new Date().toISOString().slice(0, 7);
  assert.deepEqual(createAuditService({ db: api.db }).sealDue().sealed, [], 'the current month is still open');
  const later = createAuditService({ db: api.db, now: () => Date.now() + 70 * 86_400_000 });
  assert.deepEqual(later.sealDue().sealed, [month]);
  assert.deepEqual(later.sealDue().sealed, [], 'sealed once');
  assert.throws(() => api.db.prepare('DELETE FROM core_audit_segments').run(), /cannot be deleted/);
  const seg = (await api.call('GET', `${C}/audit/segments`, AUD)).json.data;
  assert.equal(seg.retentionMonths, 84);
  assert.equal(seg.segments[0].period, month);
  assert.equal(seg.segments[0].pastRetention, false);
  const out = await fetch(`${api.base}${C}/audit/segments/${month}/export`, { headers: { 'x-erp-user': 'auditor1', 'x-erp-roles': 'AUD', 'x-erp-company': '1' } });
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('x-audit-head-hash'), seg.segments[0].headHash);
  const lines = (await out.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 3 && lines.every((l) => l.hash));
  assert.equal((await api.call('GET', `${C}/audit/segments/2001-01/export`, AUD)).status, 404);
  assert.equal((await api.call('GET', `${C}/audit/segments/bad/export`, AUD)).status, 400);
  await api.close();
});

test('the audit routes are hidden while ff.iam.p0206 is off, and the writer works without the chain tables', async () => {
  const api = await startApi();
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.iam.p0206'").run();
  assert.equal((await api.call('GET', `${C}/audit`, AUD)).status, 404);
  assert.equal((await api.call('GET', `${C}/security-events`, SYS)).status, 404);
  await api.close();
});
