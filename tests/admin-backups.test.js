import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import '../src/server/modules/registry.js';
import { backupsOf, executeApprovedRestore } from '../src/server/modules/admin/backups.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.06: backup, restore and disaster recovery.
// T-01 the quarterly drill restores within the RTO with data loss within the RPO. FR-01 full and snapshot backups, encrypted off-site copy,
// file replication; FR-02 retention; FR-03 restore to an isolated folder with validation; FR-04 drills with reports; FR-05 monitoring and
// alerts; BR-01 a production restore needs a documented incident, ITADM then DIR, and is executed by the operator.
const B = '/api/v1/admin/backups';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `bkp-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const it = as('ITADM', 'bk-it'); const it2 = as('ITADM', 'bk-it2'); const sys = as('SYSADM', 'bk-sys'); const dir = as('DIR', 'bk-dir'); const aud = as('AUD', 'bk-aud'); const se = as('SE', 'bk-se');
const opened = []; after(async () => { for (const c of opened) await c(); });
const DEV_KEY = 'development-backup-key-not-for-production-use';

async function setup() {
  const storage = mkdtempSync(join(tmpdir(), 'erp-bk-'));
  const api = await startApi({}, { storagePath: storage }); opened.push(async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); }); await setupCompany(api); const db = api.db;
  for (const u of [it, it2, sys, dir, aud, se]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2906', 1, 'Backup fixture', 0, 1)").run();
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  return { api, db, call, storage };
}

test('FR-01 FR-03 a full backup is verified and copied encrypted off site; a restore test in isolation validates it; a tampered copy fails; roles', async () => {
  const t = await setup();
  writeFileSync(join(t.storage, 'drawing.pdf'), 'file body');
  t.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by) VALUES (1, 'drawing.pdf', 'drawing.pdf', 'pdf', 'application/pdf', 'document', 9, 'x', 'CLEAN', 'test', 1, 'test')").run();
  const r = await t.call(it, 'POST', B, { type: 'FULL' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const b = r.json.data;
  assert.deepEqual([b.status, b.type, b.encrypted, b.offsite], ['VERIFIED', 'FULL', true, true]); assert.ok(b.rows > 0 && b.tables > 100);
  assert.deepEqual(b.files, { copied: 1, present: 0, missing: 0 }, 'the stored files are replicated to the second location');
  assert.ok(existsSync(join(t.storage, 'backups-offsite', 'files', 'drawing.pdf')));
  const row = t.db.prepare('SELECT * FROM ops_backups WHERE id = ?').get(b.id);
  const enc = readFileSync(row.offsite_location);
  assert.equal(enc.subarray(0, 6).toString(), 'ERPBK1'); assert.ok(!enc.includes(Buffer.from('SQLite format 3')), 'the off-site copy is encrypted');
  assert.ok(JSON.parse(row.tiers_json).includes('daily'));
  // FR-03: restored into an isolated folder and validated table by table
  const test1 = (await t.call(it, 'POST', `${B}/tests`, { backupId: b.id })).json.data;
  assert.equal(test1.status, 'PASSED', JSON.stringify(test1.checks)); assert.ok(test1.checks.find((c) => c.check === 'Integrity, row counts and table checksums').ok);
  assert.equal(test1.environment, 'ISOLATED'); assert.ok(!existsSync(join(t.storage, 'restore-tests', `test-${test1.id}`)), 'the isolated copy is removed after the test');
  const pdf = await t.api.raw('GET', `${B}/tests/${test1.id}/report?format=pdf`, aud); assert.equal(pdf.status, 200); assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  // a changed off-site copy is caught
  writeFileSync(row.offsite_location, Buffer.concat([enc.subarray(0, enc.length - 10), Buffer.from('0123456789')]));
  const bad = (await t.call(it, 'POST', `${B}/tests`, { backupId: b.id })).json.data;
  assert.equal(bad.status, 'FAILED'); assert.ok(bad.checks.some((c) => !c.ok));
  // roles
  assert.equal((await t.call(aud, 'GET', `${B}/status`)).status, 200);
  assert.equal((await t.call(aud, 'POST', B, { type: 'FULL' })).status, 403);
  assert.equal((await t.call(se, 'GET', `${B}/status`)).status, 403);
  const list = (await t.call(aud, 'GET', B)).json.data; assert.equal(list.total, 1);
});

test('T-01 FR-04 FR-05 the drill restores within the RTO with loss within the RPO; a stale recovery point fails it; monitoring alerts IT and resolves', async () => {
  const t = await setup(); const svc = backupsOf(t.db);
  const m0 = (await t.call(it, 'POST', `${B}/monitor`)).json.data;
  assert.deepEqual(m0.raised.sort(), ['drill', 'full', 'offsite', 'rpo'], 'nothing backed up yet: four checks fail');
  assert.ok(t.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'admin.backup.alert'").get() ?? t.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'admin.backup.alert_raised'").get(), 'IT is alerted');
  await t.call(it, 'POST', B, { type: 'FULL' });
  await t.call(it, 'POST', B, { type: 'SNAPSHOT' });
  const drill = (await t.call(it, 'POST', `${B}/tests`, { kind: 'DRILL', note: 'Q4 drill' })).json.data;
  assert.equal(drill.status, 'PASSED', JSON.stringify(drill));
  assert.ok(Number(drill.restoreMinutes) <= drill.rtoTarget, `restored in ${drill.restoreMinutes} min, target ${drill.rtoTarget}`);
  assert.ok(Number(drill.dataLossMinutes) <= drill.rpoTarget, `data loss ${drill.dataLossMinutes} min, target ${drill.rpoTarget}`);
  assert.equal(drill.backupType, 'SNAPSHOT', 'the drill restores the newest recovery point');
  const m1 = svc.checks(); assert.deepEqual(m1.resolved.sort(), ['drill', 'full', 'offsite', 'rpo']);
  const st = (await t.call(dir, 'GET', `${B}/status`)).json.data;
  assert.equal(st.healthy, true); assert.deepEqual([st.targets.rpoMinutes, st.targets.rtoMinutes, st.retention.daily, st.retention.yearly], [15, 240, 14, 7]); assert.equal(st.lastDrill.status, 'PASSED');
  // a recovery point older than the RPO fails the drill
  t.db.prepare("UPDATE ops_backups SET finished_at = ? WHERE status = 'VERIFIED'").run(new Date(Date.now() - 40 * 60_000).toISOString());
  const late = (await t.call(it, 'POST', `${B}/tests`, { kind: 'DRILL' })).json.data;
  assert.equal(late.status, 'FAILED'); assert.ok(Number(late.dataLossMinutes) > 15);
  assert.ok(svc.checks().raised.includes('rpo'));
  const drills = (await t.call(aud, 'GET', `${B}/tests?kind=DRILL`)).json.data; assert.equal(drills.total, 2);
});

test('FR-02 retention keeps 14 daily, 8 weekly, 12 monthly and 7 yearly fulls and 48 hours of snapshots', async () => {
  const t = await setup(); const svc = backupsOf(t.db);
  const dir = join(t.storage, 'fake'); writeFileSync(join(t.storage, 'x'), '');
  const ins = t.db.prepare("INSERT INTO ops_backups (backup_type, name, started_at, finished_at, location, status, tiers_json) VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?)");
  const day = (n) => new Date(Date.UTC(2026, 10, 22) - n * 86_400_000).toISOString();
  for (let n = 0; n < 40; n += 1) {
    const d = new Date(day(n)); const tiers = ['daily', ...(d.getUTCDay() === 0 ? ['weekly'] : []), ...(d.getUTCDate() === 1 ? ['monthly'] : []), ...(n === 39 ? ['yearly'] : [])];
    const f = join(t.storage, `f${n}.sqlite`); writeFileSync(f, 'x'); ins.run('FULL', `full-${n}`, day(n), day(n), f, JSON.stringify(tiers));
  }
  for (let h = 0; h < 60; h += 6) { const s = new Date(Date.now() - h * 3_600_000).toISOString(); ins.run('SNAPSHOT', `snap-${h}`, s, s, join(dir, `s${h}`), '[]'); }
  const r = (await t.call(it, 'POST', `${B}/retention`)).json.data;
  const kept = t.db.prepare("SELECT name FROM ops_backups WHERE status = 'VERIFIED'").all().map((x) => x.name);
  const fulls = kept.filter((n) => n.startsWith('full-')).map((n) => Number(n.slice(5)));
  assert.ok(fulls.filter((n) => n < 14).length === 14, 'the newest 14 dailies'); assert.ok(fulls.includes(39), 'the yearly is kept');
  assert.ok(fulls.some((n) => n >= 14 && new Date(day(n)).getUTCDay() === 0), 'older Sunday fulls are kept as weeklies');
  assert.ok(!fulls.includes(15) || new Date(day(15)).getUTCDay() === 0 || new Date(day(15)).getUTCDate() === 1);
  assert.deepEqual(kept.filter((n) => n.startsWith('snap-')).map((n) => Number(n.slice(5))).sort((a, b) => a - b), [0, 6, 12, 18, 24, 30, 36, 42], 'snapshots of the last 48 hours');
  assert.ok(r.expired > 0); assert.ok(!existsSync(join(t.storage, 'f20.sqlite')) || fulls.includes(20), 'an expired backup\'s file is deleted');
  void svc;
});

test('BR-01 a production restore needs a tested backup, a documented incident, ITADM then DIR; the operator executes it with a safety copy', async () => {
  const t = await setup();
  const b = (await t.call(it, 'POST', B, { type: 'FULL' })).json.data;
  assert.match((await t.call(sys, 'POST', `${B}/restores`, { backupId: b.id, incidentRef: 'INC-204', incident: 'Database corrupted by a failed disk' })).json.error.message, /no passed restore test/);
  await t.call(it, 'POST', `${B}/tests`, { backupId: b.id });
  const rq = await t.call(sys, 'POST', `${B}/restores`, { backupId: b.id, incidentRef: 'INC-204', incident: 'Database corrupted by a failed disk' });
  assert.equal(rq.status, 201, JSON.stringify(rq.json)); assert.equal(rq.json.data.status, 'SUBMITTED');
  assert.equal((await t.call(sys, 'POST', `${B}/restores`, { backupId: b.id, incidentRef: 'INC-205', incident: 'Second request at once' })).status, 409);
  assert.equal((await t.call(aud, 'POST', `${B}/restores`, { backupId: b.id, incidentRef: 'INC-206', incident: 'Auditor may not' })).status, 403);
  assert.notEqual((await t.call(dir, 'POST', `${B}/restores/${rq.json.data.id}/act`, { action: 'approve' })).status, 200, 'DIR approves after ITADM');
  assert.equal((await t.call(it, 'POST', `${B}/restores/${rq.json.data.id}/act`, { action: 'approve', comment: 'Incident confirmed' })).json.data.status, 'SUBMITTED');
  const ok = (await t.call(dir, 'POST', `${B}/restores/${rq.json.data.id}/act`, { action: 'approve', comment: 'Go' })).json.data;
  assert.equal(ok.status, 'APPROVED'); assert.equal(ok.command, `npm run db:restore -- --approved ${ok.id}`);
  // the operator's step, on a database file holding this state
  const file = join(t.storage, 'live.sqlite'); t.db.exec(`VACUUM INTO '${file}'`);
  assert.equal(executeApprovedRestore({ dbPath: file, requestId: 999, secret: DEV_KEY, storagePath: t.storage, by: 'ops' }).ok, false);
  const done = executeApprovedRestore({ dbPath: file, requestId: ok.id, secret: DEV_KEY, storagePath: t.storage, by: 'ops' });
  assert.equal(done.ok, true, JSON.stringify(done)); assert.ok(existsSync(done.safetyCopy), 'the database as it was is kept');
  const restored = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(restored.prepare('SELECT status FROM ops_restore_requests WHERE id = ?').get(ok.id).status, 'EXECUTED'); } finally { restored.close(); }
  assert.equal(executeApprovedRestore({ dbPath: file, requestId: ok.id, secret: DEV_KEY, storagePath: t.storage, by: 'ops' }).ok, false, 'an approval is used once');
});
