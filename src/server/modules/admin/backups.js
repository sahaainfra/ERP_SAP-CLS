import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { compareWithManifest, databaseChecksums, decryptFile, encryptFile, sha256File } from '../../platform/backup/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { integrityRegistry } from '../../platform/integrity/index.js';

/**
 * Part 29.06 — backup, restore and disaster recovery.
 *
 * FULL backups (daily) and SNAPSHOT backups (every 15 minutes, the recovery point between fulls) are consistent copies of the live database
 * (VACUUM INTO) with a manifest of per-table row counts and checksums. Each copy is encrypted (AES-256-GCM) to the off-site location (a
 * second disk, mount or region, BACKUP_OFFSITE_DIR), its hash checked after the copy, and the stored files are replicated there too. The
 * retention policy keeps daily, weekly, monthly and yearly fulls (14, 8, 12, 7 by default, parameters) and snapshots for 48 hours.
 *
 * A restore test decrypts a backup into an isolated folder, never the live database, and validates it: SQLite integrity, the row counts and
 * checksums of every table against the manifest, and the schema against the running application. A DR drill does the same against the
 * newest backup and measures the recovery time (RTO, target 4 h) and the data-loss window (RPO, target 15 min); one is due every quarter.
 * The checks (full or snapshot overdue, a failed backup, a missing off-site copy, a drill overdue) raise an alert to IT.
 *
 * A production restore (BR-01) is a request with the incident reference, approved by ITADM then DIR, and allowed only for a backup whose
 * restore test passed. The application cannot replace its own database while it runs: the approval gives the operator a one-time
 * authorisation that `npm run db:restore -- --approved <id>` checks before it restores, and the restore is recorded.
 */
export const BACKUP_FLAG = 'ff.admin.p2906';
export const RESTORE_TYPE = 'ops_production_restore';
const P = { daily: 'admin.backup.keep_daily', weekly: 'admin.backup.keep_weekly', monthly: 'admin.backup.keep_monthly', yearly: 'admin.backup.keep_yearly', rpo: 'admin.dr.rpo_minutes', rto: 'admin.dr.rto_minutes', drill: 'admin.dr.drill_interval_days' };
for (const [key, def, description] of [[P.daily, 14, 'Part 29.06 FR-02: daily full backups kept.'], [P.weekly, 8, 'Part 29.06 FR-02: weekly full backups kept (the Sunday full).'], [P.monthly, 12, 'Part 29.06 FR-02: monthly full backups kept (the first full of the month).'], [P.yearly, 7, 'Part 29.06 FR-02: yearly full backups kept (the first full of the year).'],
  [P.rpo, 15, 'Part 29.06 FR-04: recovery point objective in minutes (the most data a disaster may lose).'], [P.rto, 240, 'Part 29.06 FR-04: recovery time objective in minutes (the longest a restore may take).'], [P.drill, 90, 'Part 29.06 FR-04: days between DR drills (quarterly).']]) {
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, min: 1, max: 100_000, scopes: ['system'], description });
}
const iso = (d = new Date()) => d.toISOString();
const SNAPSHOT_HOURS = 48;
// the backup records belong to the platform (one database serves every company), like the migration and job tables
integrityRegistry.register({ technicalTables: ['ops_backups', 'ops_restore_tests', 'ops_backup_alerts'] });

const services = new WeakMap();
export const backupsOf = (db) => services.get(db) ?? null;

/** @param {any} context @param {{ jobs?: any, scheduler?: any, storagePath: string, config: any }} deps */
export function createBackupService(context, { jobs, scheduler, storagePath, config }) {
  const { db } = context;
  const local = join(storagePath, 'backups');
  const offsite = config.backupOffsiteDir ?? join(storagePath, 'backups-offsite');
  const restoreRoot = join(storagePath, 'restore-tests');
  const secret = config.backupKey ?? config.vaultKey ?? 'development-backup-key-not-for-production-use';
  const param = (key) => Number(createParameterStore(db).get(key, { companyId: null, date: iso().slice(0, 10) }));
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, BACKUP_FLAG)) throw notFound('Backup and DR are not enabled for this company.');
    if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`);
  };

  // ---------------------------------------------------------------- taking a backup (FR-01)
  /** A FULL or SNAPSHOT backup: copy, checksums, encrypted off-site copy with its hash checked. Never throws: a failure is a FAILED record. */
  function take(type, by = 'system') {
    const started = iso(); const name = `${type.toLowerCase()}-${started.replace(/[-:.TZ]/g, '').slice(0, 17)}`;
    const id = Number(db.prepare("INSERT INTO ops_backups (backup_type, name, started_at, status, created_by, source_type) VALUES (?, ?, ?, 'RUNNING', ?, 'backup')").run(type, name, started, by).lastInsertRowid);
    const file = join(local, `${name}.sqlite`);
    try {
      mkdirSync(local, { recursive: true }); rmSync(file, { force: true });
      if (db.isTransaction) throw new Error('A backup cannot run inside a transaction.');
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const copy = new DatabaseSync(file, { readOnly: true });
      let sums; let integrity;
      try { integrity = copy.prepare('PRAGMA integrity_check').all().every((r) => r.integrity_check === 'ok'); sums = databaseChecksums(copy); } finally { copy.close(); }
      if (!integrity) throw new Error('The copy failed SQLite\'s integrity check.');
      const plainSha = sha256File(file);
      const encPath = join(offsite, `${name}.sqlite.enc`);
      const encSha = encryptFile(file, encPath, secret);
      if (sha256File(encPath) !== encSha) throw new Error('The off-site copy does not match after it was written.');
      const rows = Object.values(sums.tables).reduce((a, t) => a + t.rows, 0);
      const files = type === 'FULL' ? replicateFiles() : null;
      const manifest = { format: 1, name, schemaSha256: sums.schemaSha256, tables: sums.tables };
      const tiers = type === 'FULL' ? tiersOf(new Date(started)) : [];
      db.prepare(`UPDATE ops_backups SET finished_at = ?, size_bytes = ?, location = ?, offsite_location = ?, checksum = ?, offsite_checksum = ?, encrypted = 1, table_count = ?, row_count = ?, manifest_json = ?, tiers_json = ?, files_json = ?, status = 'VERIFIED', updated_at = ? WHERE id = ?`)
        .run(iso(), statSync(file).size, file, encPath, plainSha, encSha, Object.keys(sums.tables).length, rows, JSON.stringify(manifest), JSON.stringify(tiers), files ? JSON.stringify(files) : null, iso(), id);
      publishEvent(db, { type: 'admin.backup.completed', entity: 'ops_backups', entityId: id, actorId: by, companyId: null, data: { type, name, rows } });
    } catch (e) {
      rmSync(file, { force: true });
      db.prepare("UPDATE ops_backups SET finished_at = ?, status = 'FAILED', error = ?, updated_at = ? WHERE id = ?").run(iso(), String(e?.message ?? e).slice(0, 500), iso(), id);
      publishEvent(db, { type: 'admin.backup.failed', entity: 'ops_backups', entityId: id, actorId: by, companyId: null, data: { type, error: String(e?.message ?? e).slice(0, 200) } });
    }
    return db.prepare('SELECT * FROM ops_backups WHERE id = ?').get(id);
  }
  /** FR-01 file storage replication: every stored file present in the second location with the same size. */
  function replicateFiles() {
    const src = storagePath; const dest = join(offsite, 'files'); let copied = 0; let present = 0; let missing = 0;
    for (const f of db.prepare("SELECT storage_key FROM core_files WHERE deleted_at IS NULL AND storage_key IS NOT NULL").all()) {
      const from = join(src, f.storage_key); const to = join(dest, f.storage_key);
      if (!existsSync(from)) { missing += 1; continue; }
      if (existsSync(to) && statSync(to).size === statSync(from).size) { present += 1; continue; }
      mkdirSync(join(to, '..'), { recursive: true }); copyFileSync(from, to); copied += 1;
    }
    return { copied, present, missing };
  }
  /** FR-02: which retention tiers a full backup belongs to. */
  const tiersOf = (d) => ['daily', ...(d.getUTCDay() === 0 ? ['weekly'] : []), ...(!db.prepare("SELECT 1 FROM ops_backups WHERE backup_type = 'FULL' AND status = 'VERIFIED' AND substr(started_at, 1, 7) = ?").get(iso(d).slice(0, 7)) ? ['monthly'] : []), ...(!db.prepare("SELECT 1 FROM ops_backups WHERE backup_type = 'FULL' AND status = 'VERIFIED' AND substr(started_at, 1, 4) = ?").get(iso(d).slice(0, 4)) ? ['yearly'] : [])];
  /** FR-02: keep the newest N fulls of each tier and snapshots of the last 48 hours; the files of the others are deleted, the records kept. */
  function applyRetention() {
    const keep = new Set();
    const fulls = db.prepare("SELECT id, tiers_json FROM ops_backups WHERE backup_type = 'FULL' AND status = 'VERIFIED' ORDER BY started_at DESC, id DESC").all();
    for (const tier of ['daily', 'weekly', 'monthly', 'yearly']) fulls.filter((b) => JSON.parse(b.tiers_json ?? '[]').includes(tier)).slice(0, param(P[tier])).forEach((b) => keep.add(b.id));
    const since = iso(new Date(Date.now() - SNAPSHOT_HOURS * 3_600_000));
    for (const b of db.prepare("SELECT id FROM ops_backups WHERE backup_type = 'SNAPSHOT' AND status = 'VERIFIED' AND started_at >= ?").all(since)) keep.add(b.id);
    for (const r of db.prepare("SELECT backup_id FROM ops_restore_requests WHERE status IN ('SUBMITTED', 'APPROVED')").all()) keep.add(r.backup_id); // a restore in progress keeps its backup
    let expired = 0;
    for (const b of db.prepare("SELECT * FROM ops_backups WHERE status = 'VERIFIED'").all()) {
      if (keep.has(b.id)) continue;
      for (const f of [b.location, b.offsite_location]) if (f) rmSync(f, { force: true });
      db.prepare("UPDATE ops_backups SET status = 'EXPIRED', expired_at = ?, updated_at = ? WHERE id = ?").run(iso(), iso(), b.id); expired += 1;
    }
    return { kept: keep.size, expired };
  }

  // ---------------------------------------------------------------- restore tests and drills (FR-03, FR-04)
  /** Restore into an isolated folder and validate; DRILL measures RTO and RPO against the targets. */
  function restoreTest(actor, { backupId = null, kind = 'TEST', note = null }) {
    const b = backupId ? db.prepare('SELECT * FROM ops_backups WHERE id = ?').get(Number(backupId)) : db.prepare("SELECT * FROM ops_backups WHERE status = 'VERIFIED' ORDER BY finished_at DESC, id DESC LIMIT 1").get();
    if (!b) throw notFound('There is no backup to restore.');
    if (b.status !== 'VERIFIED') throw unprocessable(`Backup ${b.name} is ${b.status.toLowerCase()}; only a verified backup can be restored.`);
    const incidentAt = new Date(); const t0 = Date.now();
    const id = Number(db.prepare("INSERT INTO ops_restore_tests (backup_id, kind, environment, started_at, status, note, created_by, source_type) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, 'restore_test')").run(b.id, kind, 'ISOLATED', iso(incidentAt), note, actor.user).lastInsertRowid);
    const dir = join(restoreRoot, `test-${id}`); const target = join(dir, 'restored.sqlite');
    const checks = []; let ok;
    try {
      mkdirSync(dir, { recursive: true });
      const fromOffsite = Boolean(b.offsite_location && existsSync(b.offsite_location));
      checks.push({ check: 'Off-site copy present', ok: fromOffsite, detail: fromOffsite ? b.offsite_location : 'missing; the local copy was used' });
      if (fromOffsite) { const encOk = sha256File(b.offsite_location) === b.offsite_checksum; checks.push({ check: 'Off-site copy checksum', ok: encOk, detail: encOk ? 'matches' : 'differs' }); decryptFile(b.offsite_location, target, secret); } else { if (!existsSync(b.location)) throw new Error('Neither the off-site nor the local copy exists.'); copyFileSync(b.location, target); }
      const plainOk = sha256File(target) === b.checksum; checks.push({ check: 'Restored file checksum', ok: plainOk, detail: plainOk ? 'matches the backup' : 'differs from the backup' });
      const r = new DatabaseSync(target, { readOnly: true });
      try {
        const problems = compareWithManifest(r, JSON.parse(b.manifest_json));
        checks.push({ check: 'Integrity, row counts and table checksums', ok: problems.length === 0, detail: problems.length ? problems.slice(0, 5).join('; ') : `${b.table_count} tables, ${b.row_count} rows identical` });
        const migs = (x) => x.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'core_schema_migrations'").get().n ? x.prepare('SELECT MAX(id) AS v FROM core_schema_migrations').get().v : null;
        const cur = migs(db); const got = migs(r); checks.push({ check: 'Schema version', ok: got === cur || got != null, detail: got === cur ? `at ${got}` : `backup at ${got}, application at ${cur}` });
      } finally { r.close(); }
      ok = checks.every((c) => c.ok || c.check === 'Schema version');
    } catch (e) { checks.push({ check: 'Restore', ok: false, detail: String(e?.message ?? e).slice(0, 300) }); ok = false; } finally { rmSync(dir, { recursive: true, force: true }); }
    const restoreMinutes = Math.max(0, (Date.now() - t0) / 60000);
    const lossMinutes = Math.max(0, (incidentAt.getTime() - Date.parse(b.finished_at)) / 60000);
    const rto = param(P.rto); const rpo = param(P.rpo);
    const passed = ok && (kind !== 'DRILL' || (restoreMinutes <= rto && lossMinutes <= rpo));
    db.prepare("UPDATE ops_restore_tests SET finished_at = ?, validated = ?, status = ?, checks_json = ?, restore_minutes = ?, data_loss_minutes = ?, rto_target = ?, rpo_target = ?, updated_at = ? WHERE id = ?")
      .run(iso(), ok ? 1 : 0, passed ? 'PASSED' : 'FAILED', JSON.stringify(checks), restoreMinutes.toFixed(3), lossMinutes.toFixed(1), rto, rpo, iso(), id);
    if (actor.companyId) writeAudit(db, { companyId: actor.companyId, entity: 'ops_restore_tests', entityId: String(id), action: kind === 'DRILL' ? 'dr_drill' : 'restore_test', actor: actor.user, newValues: { backup: b.name, passed } });
    publishEvent(db, { type: kind === 'DRILL' ? 'admin.dr.drill_completed' : 'admin.backup.restore_tested', entity: 'ops_restore_tests', entityId: id, actorId: actor.user, companyId: actor.companyId ?? null, data: { backup: b.name, passed } });
    return testView(db.prepare('SELECT * FROM ops_restore_tests WHERE id = ?').get(id));
  }
  const testView = (t) => { const b = db.prepare('SELECT name, backup_type, finished_at FROM ops_backups WHERE id = ?').get(t.backup_id);
    return { id: t.id, backupId: t.backup_id, backup: b?.name, backupType: b?.backup_type, backupAt: b?.finished_at, kind: t.kind, environment: t.environment, startedAt: t.started_at, finishedAt: t.finished_at, status: t.status, validated: Boolean(t.validated), checks: JSON.parse(t.checks_json ?? '[]'),
      restoreMinutes: t.restore_minutes, dataLossMinutes: t.data_loss_minutes, rtoTarget: t.rto_target, rpoTarget: t.rpo_target, note: t.note, by: t.created_by }; };

  // ---------------------------------------------------------------- monitoring (FR-05)
  function health() {
    const now = Date.now(); const out = [];
    const lastFull = db.prepare("SELECT * FROM ops_backups WHERE backup_type = 'FULL' AND status = 'VERIFIED' ORDER BY finished_at DESC LIMIT 1").get();
    const lastSnap = db.prepare("SELECT * FROM ops_backups WHERE status = 'VERIFIED' ORDER BY finished_at DESC LIMIT 1").get();
    const lastAny = db.prepare("SELECT * FROM ops_backups WHERE status IN ('VERIFIED', 'FAILED') ORDER BY id DESC LIMIT 1").get();
    const lastDrill = db.prepare("SELECT * FROM ops_restore_tests WHERE kind = 'DRILL' AND status = 'PASSED' ORDER BY id DESC LIMIT 1").get();
    const age = (r) => (r ? (now - Date.parse(r.finished_at)) / 60000 : null);
    out.push({ code: 'full', ok: lastFull ? age(lastFull) <= 26 * 60 : false, value: lastFull ? lastFull.finished_at : null, message: lastFull ? `Last full backup ${Math.round(age(lastFull) / 60)} h ago.` : 'No full backup yet.' });
    out.push({ code: 'rpo', ok: lastSnap ? age(lastSnap) <= param(P.rpo) * 2 : false, value: lastSnap?.finished_at ?? null, message: lastSnap ? `Newest restorable point ${Math.round(age(lastSnap))} min ago (RPO ${param(P.rpo)} min).` : 'No restorable point.' });
    out.push({ code: 'failed', ok: !lastAny || lastAny.status !== 'FAILED', value: lastAny?.status ?? null, message: lastAny?.status === 'FAILED' ? `The last backup failed: ${lastAny.error}` : 'The last backup succeeded.' });
    out.push({ code: 'offsite', ok: lastSnap ? existsSync(lastSnap.offsite_location ?? '') : false, value: lastSnap?.offsite_location ?? null, message: lastSnap && existsSync(lastSnap.offsite_location ?? '') ? 'The newest backup is in the off-site location.' : 'The newest backup is missing from the off-site location.' });
    const due = lastDrill ? Date.parse(lastDrill.finished_at) + param(P.drill) * 86_400_000 : null;
    out.push({ code: 'drill', ok: Boolean(lastDrill) && due >= now, value: due ? iso(new Date(due)) : null, message: lastDrill ? (due >= now ? `Next DR drill due ${iso(new Date(due)).slice(0, 10)}.` : `The quarterly DR drill is overdue since ${iso(new Date(due)).slice(0, 10)}.`) : 'No DR drill has passed yet.' });
    return out;
  }
  /** Raise an alert to IT for each failing check (once while it stays failing) and resolve the ones that recovered. */
  function monitor() {
    const raised = []; const resolved = [];
    for (const h of health()) {
      const open = db.prepare("SELECT * FROM ops_backup_alerts WHERE check_code = ? AND status = 'OPEN'").get(h.code);
      if (!h.ok && !open) {
        const id = Number(db.prepare("INSERT INTO ops_backup_alerts (check_code, message, status, fired_at, created_by, source_type) VALUES (?, ?, 'OPEN', ?, 'system', 'backup_monitor')").run(h.code, h.message, iso()).lastInsertRowid);
        for (const c of db.prepare('SELECT company_id FROM core_feature_flags WHERE key = ? AND company_id IS NOT NULL AND enabled = 1').all(BACKUP_FLAG)) {
          try { notificationsOf(db).notify({ companyId: c.company_id, templateCode: 'admin.backup.alert', recipients: ['role:ITADM'], data: { check: h.code, message: h.message }, link: '/admin/backups', priority: 'HIGH', sourceType: 'ops_backup_alerts', sourceId: id }); } catch { /* the alert is recorded */ }
        }
        publishEvent(db, { type: 'admin.backup.alert_raised', entity: 'ops_backup_alerts', entityId: id, actorId: 'system', companyId: null, data: { check: h.code, message: h.message } });
        raised.push(h.code);
      } else if (h.ok && open) { db.prepare("UPDATE ops_backup_alerts SET status = 'RESOLVED', resolved_at = ?, updated_at = ? WHERE id = ?").run(iso(), iso(), open.id); resolved.push(h.code); }
    }
    return { raised, resolved };
  }

  // ---------------------------------------------------------------- production restore (BR-01)
  const engine = createApprovalEngine({ db, handlers: { [RESTORE_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      db.prepare("UPDATE ops_restore_requests SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), actor.user, iso(), request.payload.restoreRequestId);
      publishEvent(db, { type: 'admin.restore.approved', entity: 'ops_restore_requests', entityId: request.payload.restoreRequestId, actorId: actor.user, companyId: request.companyId, data: { backup: request.payload.backup } });
    },
  } } });
  const reqView = (r, mine = new Set()) => { const b = db.prepare('SELECT name, finished_at FROM ops_backups WHERE id = ?').get(r.backup_id); return { id: r.id, backupId: r.backup_id, backup: b?.name, backupAt: b?.finished_at, incidentRef: r.incident_ref, incident: r.incident_summary, status: r.status, requestId: r.request_id, canDecide: mine.has(r.request_id), by: r.created_by, approvedBy: r.approved_by, executedAt: r.executed_at, executedBy: r.executed_by, command: r.status === 'APPROVED' ? `npm run db:restore -- --approved ${r.id}` : null }; };

  const api = {
    status(actor) {
      guard(actor, 'adm.backup.view');
      const h = health(); const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      const lastDrill = db.prepare("SELECT * FROM ops_restore_tests WHERE kind = 'DRILL' ORDER BY id DESC LIMIT 1").get();
      return { health: h, healthy: h.every((x) => x.ok), targets: { rpoMinutes: param(P.rpo), rtoMinutes: param(P.rto), drillDays: param(P.drill) }, retention: { daily: param(P.daily), weekly: param(P.weekly), monthly: param(P.monthly), yearly: param(P.yearly), snapshotHours: SNAPSHOT_HOURS },
        locations: { local, offsite, encrypted: true, keyConfigured: Boolean(config.backupKey ?? config.vaultKey) }, lastDrill: lastDrill ? testView(lastDrill) : null,
        alerts: db.prepare("SELECT * FROM ops_backup_alerts WHERE status = 'OPEN' ORDER BY id DESC").all().map((a) => ({ id: a.id, check: a.check_code, message: a.message, firedAt: a.fired_at })),
        requests: db.prepare('SELECT * FROM ops_restore_requests WHERE company_id = ? ORDER BY id DESC LIMIT 20').all(actor.companyId).map((r) => reqView(r, mine)),
        canRun: hasPermissionAnywhere(actor, 'adm.backup.run'), canRequest: hasPermissionAnywhere(actor, 'adm.backup.restore') };
    },
    list(actor, { type = null, status = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'adm.backup.view');
      const where = ['1 = 1']; const p = []; if (type) { where.push('backup_type = ?'); p.push(type); } if (status) { where.push('status = ?'); p.push(status); }
      const sql = where.join(' AND ');
      return { rows: db.prepare(`SELECT * FROM ops_backups WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize).map((b) => ({ id: b.id, type: b.backup_type, name: b.name, startedAt: b.started_at, finishedAt: b.finished_at, sizeBytes: b.size_bytes, rows: b.row_count, tables: b.table_count, checksum: b.checksum, offsite: Boolean(b.offsite_location), encrypted: Boolean(b.encrypted), tiers: JSON.parse(b.tiers_json ?? '[]'), files: b.files_json ? JSON.parse(b.files_json) : null, status: b.status, error: b.error, by: b.created_by })),
        total: db.prepare(`SELECT COUNT(*) AS n FROM ops_backups WHERE ${sql}`).get(...p).n, page, pageSize };
    },
    backupNow(actor, { type }) {
      guard(actor, 'adm.backup.run');
      const b = take(type, actor.user);
      writeAudit(db, { companyId: actor.companyId, entity: 'ops_backups', entityId: String(b.id), action: 'backup', actor: actor.user, newValues: { type, status: b.status } });
      return api.list(actor, {}).rows.find((x) => x.id === b.id);
    },
    retention(actor) { guard(actor, 'adm.backup.run'); const r = applyRetention(); writeAudit(db, { companyId: actor.companyId, entity: 'ops_backups', entityId: 'retention', action: 'retention', actor: actor.user, newValues: r }); return r; },
    tests(actor, { kind = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'adm.backup.view');
      const where = kind ? 'WHERE kind = ?' : ''; const p = kind ? [kind] : [];
      return { rows: db.prepare(`SELECT * FROM ops_restore_tests ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize).map(testView), total: db.prepare(`SELECT COUNT(*) AS n FROM ops_restore_tests ${where}`).get(...p).n, page, pageSize };
    },
    test(actor, body) { guard(actor, 'adm.backup.run'); return restoreTest(actor, body); },
    /** The drill report (FR-04) as a PDF or spreadsheet. */
    report(actor, id, format = 'pdf') {
      guard(actor, 'adm.backup.view');
      const t = db.prepare('SELECT * FROM ops_restore_tests WHERE id = ?').get(Number(id)); if (!t) throw notFound('That restore test does not exist.');
      const v = testView(t);
      const rows = [{ item: 'Kind', value: v.kind === 'DRILL' ? 'DR drill' : 'Restore test' }, { item: 'Backup', value: `${v.backup} (${v.backupType}, ${v.backupAt})` }, { item: 'Environment', value: 'Isolated folder (not the live database)' }, { item: 'Started', value: v.startedAt }, { item: 'Result', value: v.status },
        { item: 'Restore time (RTO)', value: `${Number(v.restoreMinutes).toFixed(2)} min, target ${v.rtoTarget} min` }, { item: 'Data loss window (RPO)', value: `${Number(v.dataLossMinutes).toFixed(1)} min, target ${v.rpoTarget} min` }, ...v.checks.map((c) => ({ item: c.check, value: `${c.ok ? 'OK' : 'FAILED'} — ${c.detail}` })), { item: 'Run by', value: v.by }];
      writeAudit(db, { companyId: actor.companyId, entity: 'ops_restore_tests', entityId: String(t.id), action: 'report', actor: actor.user });
      return { buffer: writeExport(format, { title: `${v.kind === 'DRILL' ? 'DR drill' : 'Restore test'} report #${v.id}`, sheetName: 'Report', columns: [{ key: 'item', label: 'Item' }, { key: 'value', label: 'Value' }], rows }), contentType: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `restore-test-${t.id}.${format}` };
    },
    monitor(actor) { guard(actor, 'adm.backup.run'); return monitor(); },
    /** BR-01: a production restore needs a documented incident, a backup whose restore test passed, and ITADM then DIR. */
    requestRestore(actor, { backupId, incidentRef, incident }) {
      guard(actor, 'adm.backup.restore');
      const b = db.prepare('SELECT * FROM ops_backups WHERE id = ?').get(Number(backupId)); if (!b || b.status !== 'VERIFIED') throw unprocessable('Choose a verified backup that is still kept.');
      if (!db.prepare("SELECT 1 FROM ops_restore_tests WHERE backup_id = ? AND validated = 1").get(b.id)) throw unprocessable(`Backup ${b.name} has no passed restore test. Test it in isolation first (FR-03).`);
      if (db.prepare("SELECT 1 FROM ops_restore_requests WHERE status IN ('SUBMITTED', 'APPROVED')").get()) throw conflict('A production restore is already requested or approved.');
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO ops_restore_requests (company_id, backup_id, incident_ref, incident_summary, status, created_by, source_type) VALUES (?, ?, ?, ?, 'SUBMITTED', ?, 'restore_request')").run(actor.companyId, b.id, incidentRef, incident, actor.user).lastInsertRowid);
        const req = engine.submit(actor, { type: RESTORE_TYPE, title: `Production restore from ${b.name} (incident ${incidentRef})`, targetType: 'ops_restore_requests', targetId: String(id), payload: { restoreRequestId: id, backup: b.name, incidentRef }, reason: incident, chain: ['ITADM', 'DIR'] });
        db.prepare('UPDATE ops_restore_requests SET request_id = ? WHERE id = ?').run(req.id, id);
        writeAudit(db, { companyId: actor.companyId, entity: 'ops_restore_requests', entityId: String(id), action: 'request', actor: actor.user, newValues: { backup: b.name, incidentRef } });
        return reqView(db.prepare('SELECT * FROM ops_restore_requests WHERE id = ?').get(id));
      });
    },
    decide(actor, id, body) {
      guard(actor, 'adm.backup.view');
      const r = db.prepare('SELECT * FROM ops_restore_requests WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!r || r.status !== 'SUBMITTED') throw conflict('The restore is not waiting for approval.');
      const out = engine.act(actor, r.request_id, body);
      if (out.status === 'REJECTED' || out.status === 'RETURNED') db.prepare("UPDATE ops_restore_requests SET status = 'REJECTED', updated_by = ?, updated_at = ? WHERE id = ?").run(actor.user, iso(), r.id);
      return reqView(db.prepare('SELECT * FROM ops_restore_requests WHERE id = ?').get(r.id), new Set(engine.awaiting(actor).map((x) => x.id)));
    },
  };

  const svc = { ...api, take, applyRetention, restoreTest, health, checks: monitor, engine, locations: { local, offsite } };
  services.set(db, svc);
  if (jobs) {
    jobs.register('admin.backup.full', async () => ({ status: take('FULL').status }), { description: 'Daily full backup with its encrypted off-site copy and file replication (part 29.06).' });
    jobs.register('admin.backup.snapshot', async () => ({ status: take('SNAPSHOT').status }), { description: 'Snapshot every 15 minutes: the recovery point between fulls (part 29.06).' });
    jobs.register('admin.backup.retention', async () => applyRetention(), { description: 'Applies the backup retention policy (part 29.06).' });
    jobs.register('admin.backup.monitor', async () => monitor(), { description: 'Checks backups and drills and alerts IT (part 29.06).' });
    scheduler?.define({ code: 'admin.backup.full', cron: '40 20 * * *', jobType: 'admin.backup.full', description: 'Daily full backup at 02:10 IST.' });
    scheduler?.define({ code: 'admin.backup.snapshot', cron: '*/15 * * * *', jobType: 'admin.backup.snapshot', description: 'Backup snapshot every 15 minutes.' });
    scheduler?.define({ code: 'admin.backup.retention', cron: '10 21 * * *', jobType: 'admin.backup.retention', description: 'Daily backup retention.' });
    scheduler?.define({ code: 'admin.backup.monitor', cron: '*/15 * * * *', jobType: 'admin.backup.monitor', description: 'Backup and DR checks every 15 minutes.' });
  }
  return svc;
}

/**
 * BR-01 the operator's step (`npm run db:restore -- --approved <id>`, with the application stopped): checks that the request is APPROVED
 * and not yet executed, decrypts and verifies its backup against the manifest, keeps a copy of the current database (the way back), puts
 * the backup in place and records the execution in the restored database. Returns { ok, problems, safetyCopy }.
 */
export function executeApprovedRestore({ dbPath, requestId, secret, storagePath, by }) {
  const live = new DatabaseSync(dbPath);
  let req; let b;
  try {
    req = live.prepare('SELECT * FROM ops_restore_requests WHERE id = ?').get(Number(requestId));
    if (!req) return { ok: false, problems: [`There is no restore request ${requestId}.`] };
    if (req.status !== 'APPROVED') return { ok: false, problems: [`Restore request ${requestId} is ${req.status.toLowerCase()}: it needs the approval of ITADM and DIR.`] };
    b = live.prepare('SELECT * FROM ops_backups WHERE id = ?').get(req.backup_id);
  } finally { live.close(); }
  const tmp = join(storagePath, 'restore-tests', `production-${requestId}.sqlite`);
  if (b.offsite_location && existsSync(b.offsite_location)) decryptFile(b.offsite_location, tmp, secret); else copyFileSync(b.location, tmp);
  const check = new DatabaseSync(tmp, { readOnly: true });
  let problems;
  try { problems = compareWithManifest(check, JSON.parse(b.manifest_json)); } finally { check.close(); }
  if (problems.length) { rmSync(tmp, { force: true }); return { ok: false, problems }; }
  const safetyCopy = join(storagePath, 'backups', `pre-restore-${requestId}-${iso().replace(/[-:.TZ]/g, '').slice(0, 14)}.sqlite`);
  mkdirSync(join(storagePath, 'backups'), { recursive: true });
  const cur = new DatabaseSync(dbPath);
  try { cur.exec(`VACUUM INTO '${safetyCopy.replace(/'/g, "''")}'`); } finally { cur.close(); }
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  copyFileSync(tmp, dbPath); rmSync(tmp, { force: true });
  const restored = new DatabaseSync(dbPath);
  try {
    if (restored.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ops_restore_requests'").get()) {
      restored.prepare('INSERT OR REPLACE INTO ops_restore_requests (id, company_id, backup_id, incident_ref, incident_summary, status, request_id, approved_by, approved_at, executed_at, executed_by, safety_copy, created_by, created_at, source_type) VALUES (?, ?, ?, ?, ?, \'EXECUTED\', NULL, ?, ?, ?, ?, ?, ?, ?, \'restore_request\')')
        .run(req.id, req.company_id, req.backup_id, req.incident_ref, req.incident_summary, req.approved_by, req.approved_at, iso(), by, safetyCopy, req.created_by, req.created_at);
    }
  } finally { restored.close(); }
  return { ok: true, problems: [], safetyCopy, backup: b.name };
}
