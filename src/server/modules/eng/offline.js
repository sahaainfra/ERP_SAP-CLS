import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { createBuiltinScanner, runScanners } from '../../platform/files/scan.js';
import { checkType } from '../../platform/files/types.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';

// The offline-first field engine (part 04.15). The browser keeps an encrypted local copy of the masters a person needs and a queue of commands made while offline; this service is the other half:
//  - devices: a browser is registered once; revoking it makes its next contact answer "wipe" (BR-03);
//  - masters: role-relevant subsets with delta updates, so a phone downloads only what changed (FR-02);
//  - sync: a batch of commands, each with a client-made id, replayed in order. The same id twice is one record (BR-01); a command that arrives before the one it depends on waits (out-of-order);
//    commands older than the configured age wait for a supervisor (BR-02); a change to something the server changed meanwhile is a field-level conflict that a person resolves (FR-06);
//  - forms: the offline-capable forms registry (FR-08). A form says how it is validated (the same rules the phone caches, FR-04) and how a command becomes a record through the module's own service;
//  - media: photos sent in resumable chunks, linked to the record the command made (FR-05);
//  - clock: the difference between the device clock and the server clock is measured on every contact and the time of a command is corrected by it (FR-09).
export const FORM_CODES_PLANNED = [
  ['attendance_punch', 'Attendance punch', '07.05'], ['dpr', 'Daily progress report', '14.02'], ['material_request', 'Material request', '15.01'], ['grn_count', 'GRN count', '16.03'],
  ['inspection_checklist', 'Inspection checklist', '18.02'], ['hse_observation', 'HSE observation', '19.04'], ['log_book_entry', 'Log book entry', '17.03'],
];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 1024 * 1024;
const nowIso = () => new Date().toISOString();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ---- the registers: what modules plug in ----
export const offlineForms = new Map();
/**
 * @param {any} def { code, label, labelHi?, module, permission, attachmentEntity, fields: [{ key, label, type, required }], rules(db, actor) -> object,
 *   validate(values, rules) -> [{ field, message }], create(db, actor, values, ctx) -> { entityId, version, projectId },
 *   load(db, actor, entityId) -> { version, values, projectId } | null, update(db, actor, entityId, values, ctx) -> { entityId, version }, projectOf?(values) }
 */
export function registerOfflineForm(def) {
  if (!/^[a-z][a-z_]{1,40}$/.test(def.code ?? '')) throw new Error(`Offline form code "${def.code}" must be lower-case letters and underscores`);
  if (offlineForms.has(def.code)) throw new Error(`Offline form ${def.code} is already registered`);
  for (const k of ['label', 'module', 'permission', 'fields', 'validate', 'create', 'load', 'update']) if (!def[k]) throw new Error(`Offline form ${def.code} needs ${k}`);
  offlineForms.set(def.code, { rules: () => ({}), ...def });
}
export const offlineMasters = new Map();
/** A subset of master data a phone may keep: `{ code, label, permission, rows(db, actor, sinceIso) -> { rows: object[], removed: (string|number)[] } }`. */
export function registerOfflineMaster(def) {
  if (offlineMasters.has(def.code)) throw new Error(`Offline master ${def.code} is already registered`);
  offlineMasters.set(def.code, def);
}

export function createOfflineService({ db, storage }) {
  const authz = authzOf(db);
  const scanner = createBuiltinScanner();
  const settings = (actor) => {
    const store = createParameterStore(db);
    const ctx = { companyId: actor.companyId, date: todayIST() };
    return {
      maxAgeDays: Number(store.get('off.command.max_age_days', ctx)),
      maxDriftSeconds: Number(store.get('off.clock.max_drift_seconds', ctx)),
      dataMaxAgeHours: Number(store.get('off.data.max_age_hours', ctx)),
      batchMax: Number(store.get('off.sync.batch_max', ctx)),
    };
  };
  const may = (actor, key, scope) => authz.check(actor, key, scope ?? { companyId: actor.companyId }).allowed;
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const snapshot = (actor) => ({ user: actor.user, userId: actor.userId, roles: actor.roles ?? [], companyId: actor.companyId });
  const actorOf = (snap) => {
    const u = db.prepare("SELECT id, roles_json FROM iam_users WHERE company_id = ? AND username = ? AND status = 'ACTIVE' AND is_active = 1").get(snap.companyId, snap.user);
    const roles = u ? JSON.parse(u.roles_json || '[]') : snap.roles;
    return authz.enrich({ user: snap.user, userId: u?.id ?? snap.userId, companyId: snap.companyId, roles: roles?.length ? roles : snap.roles });
  };

  // ---- devices ----
  const deviceView = (d) => ({ id: d.id, deviceId: d.device_id, name: d.device_name, platform: d.platform, user: d.user_ref, registeredAt: d.registered_at, lastSyncAt: d.last_sync_at, lastSeenAt: d.last_seen_at,
    clockDriftMs: d.clock_drift_ms, revokedAt: d.revoked_at, revokedBy: d.revoked_by, revokeReason: d.revoke_reason, wipedAt: d.wiped_at, status: d.revoked_at ? (d.wiped_at ? 'WIPED' : 'REVOKED') : 'ACTIVE',
    pending: db.prepare("SELECT COUNT(*) AS n FROM off_sync_log WHERE device_pk = ? AND status IN ('CONFLICT', 'NEEDS_CONFIRMATION', 'DEFERRED')").get(d.id).n });
  /** The device row of this person; a revoked device is told to wipe itself (BR-03). */
  function liveDevice(actor, deviceId, { touch = true } = {}) {
    if (!deviceId) throw badRequest('Say which device this is (deviceId).', [{ field: 'deviceId', message: 'is required' }]);
    const d = db.prepare('SELECT * FROM off_devices WHERE company_id = ? AND user_ref = ? AND device_id = ? AND is_active = 1').get(actor.companyId, actor.user, deviceId);
    if (!d) throw new HttpError(404, 'DEVICE_UNKNOWN', 'This device is not registered. Register it first.', [{ field: 'deviceId', message: 'is not registered', register: true }]);
    if (d.revoked_at) {
      db.prepare('UPDATE off_devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), d.id);
      throw new HttpError(403, 'DEVICE_REVOKED', 'This device was revoked. Its offline data will be removed from it.', [{ field: 'deviceId', message: 'revoked', wipe: true }]);
    }
    if (touch) db.prepare('UPDATE off_devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), d.id);
    return d;
  }
  const devices = {
    register(actor, { deviceId, name, platform }) {
      return transaction(db, () => {
        const ex = db.prepare('SELECT * FROM off_devices WHERE company_id = ? AND user_ref = ? AND device_id = ?').get(actor.companyId, actor.user, deviceId);
        if (ex?.revoked_at) throw new HttpError(403, 'DEVICE_REVOKED', 'This device was revoked and cannot be registered again. Ask the IT administrator.', [{ field: 'deviceId', message: 'revoked', wipe: true }]);
        if (ex) {
          db.prepare('UPDATE off_devices SET device_name = ?, platform = ?, last_seen_at = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(name ?? ex.device_name, platform ?? ex.platform, nowIso(), nowIso(), actor.user, ex.id);
          return deviceView(db.prepare('SELECT * FROM off_devices WHERE id = ?').get(ex.id));
        }
        const id = Number(db.prepare("INSERT INTO off_devices (company_id, user_ref, device_id, device_name, platform, last_seen_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'off_device')").run(actor.companyId, actor.user, deviceId, name ?? '', platform ?? null, nowIso(), actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'off_devices', entityId: id, action: 'register', newValues: { deviceId, name, platform }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'off.device.registered', entity: 'off_device', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { deviceId } });
        return deviceView(db.prepare('SELECT * FROM off_devices WHERE id = ?').get(id));
      });
    },
    /** @param {any} actor @param {{ all?: boolean, status?: string, q?: string, limit?: number, offset?: number }} [o] */
    list(actor, { all = false, status, q, limit = 50, offset = 0 } = {}) {
      const mgr = anywhere(actor, 'off.device.manage');
      const where = ['d.company_id = :c', 'd.is_active = 1']; const p = { c: actor.companyId, limit, offset };
      if (!(mgr && all)) { where.push('d.user_ref = :u'); p.u = actor.user; }
      if (status === 'ACTIVE') where.push('d.revoked_at IS NULL'); else if (status === 'REVOKED') where.push('d.revoked_at IS NOT NULL');
      if (q) { where.push('(d.user_ref LIKE :q OR d.device_name LIKE :q)'); p.q = `%${q}%`; }
      const pc = { ...p }; delete pc.limit; delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM off_devices d WHERE ${where.join(' AND ')}`).get(pc).n;
      const rows = db.prepare(`SELECT d.* FROM off_devices d WHERE ${where.join(' AND ')} ORDER BY d.last_seen_at DESC, d.id DESC LIMIT :limit OFFSET :offset`).all(p).map(deviceView);
      const counts = db.prepare(`SELECT SUM(revoked_at IS NULL) AS active, SUM(revoked_at IS NOT NULL) AS revoked FROM off_devices d WHERE d.company_id = ? AND d.is_active = 1 ${mgr && all ? '' : 'AND d.user_ref = ?'}`).get(...(mgr && all ? [actor.companyId] : [actor.companyId, actor.user]));
      return { rows, total, counts: { active: counts.active ?? 0, revoked: counts.revoked ?? 0 }, canManage: mgr };
    },
    /** The IT administrator revokes any device; a person may revoke their own (a lost phone). */
    revoke(actor, id, { reason }) {
      const d = db.prepare('SELECT * FROM off_devices WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      if (!d || (d.user_ref !== actor.user && !anywhere(actor, 'off.device.manage'))) throw notFound('That device does not exist.');
      if (d.revoked_at) throw conflict('This device is already revoked.');
      return transaction(db, () => {
        db.prepare('UPDATE off_devices SET revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, reason, actor.user, nowIso(), d.id);
        writeAudit(db, { entity: 'off_devices', entityId: d.id, action: 'revoke', newValues: { user: d.user_ref, deviceId: d.device_id }, reason, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'off.device.revoked', entity: 'off_device', entityId: d.id, actorId: actor.user, companyId: actor.companyId, data: { user: d.user_ref, deviceId: d.device_id } });
        return deviceView(db.prepare('SELECT * FROM off_devices WHERE id = ?').get(d.id));
      });
    },
    /** The phone says its local copy is gone. */
    wiped(actor, deviceId) {
      const d = db.prepare('SELECT * FROM off_devices WHERE company_id = ? AND user_ref = ? AND device_id = ? AND is_active = 1').get(actor.companyId, actor.user, deviceId);
      if (!d) throw notFound('That device does not exist.');
      if (!d.revoked_at) throw unprocessable('This device is not revoked, so there is nothing to wipe.');
      db.prepare('UPDATE off_devices SET wiped_at = COALESCE(wiped_at, ?), updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), d.id);
      writeAudit(db, { entity: 'off_devices', entityId: d.id, action: 'wiped', newValues: { deviceId }, actor: actor.user, companyId: actor.companyId });
      return deviceView(db.prepare('SELECT * FROM off_devices WHERE id = ?').get(d.id));
    },
  };

  // ---- masters and rules for the phone (FR-02, FR-04) ----
  const masters = {
    forms(actor) {
      /** @type {any[]} */
      const forms = [...offlineForms.values()].map((f) => ({ code: f.code, label: f.label, labelHi: f.labelHi ?? null, module: f.module, fields: f.fields, available: anywhere(actor, f.permission), rules: anywhere(actor, f.permission) ? f.rules(db, actor) : null }));
      for (const [code, label, part] of FORM_CODES_PLANNED) if (!offlineForms.has(code)) forms.push({ code, label, labelHi: null, module: part, fields: [], available: false, planned: true, rules: null });
      return forms;
    },
    /** @param {any} actor @param {{ since?: string, codes?: string[] }} [o] */
    get(actor, { since, codes } = {}) {
      const s = settings(actor);
      const serverTime = nowIso();
      const out = {};
      for (const m of offlineMasters.values()) {
        if (codes && !codes.includes(m.code)) continue;
        if (m.permission && !anywhere(actor, m.permission)) continue;
        const r = m.rows(db, actor, since ?? null);
        out[m.code] = { label: m.label, full: !since, rows: r.rows, removed: r.removed ?? [] };
      }
      return { serverTime, expiresAt: new Date(Date.now() + s.dataMaxAgeHours * 3_600_000).toISOString(), since: since ?? null, forms: masters.forms(actor), masters: out, settings: { maxAgeDays: s.maxAgeDays, maxDriftSeconds: s.maxDriftSeconds, batchMax: s.batchMax } };
    },
  };

  // ---- commands ----
  const rowView = (r) => ({ id: r.id, commandId: r.command_id, seq: r.seq, type: r.command_type, op: r.op, status: r.status, entityId: r.server_entity_id, error: r.error_message, conflict: r.conflict_json ? JSON.parse(r.conflict_json) : null,
    clientCreatedAt: r.client_created_at, effectiveAt: r.effective_at, receivedAt: r.received_at, processedAt: r.processed_at, confirmedBy: r.confirmed_by, resolution: r.resolution, resolvedBy: r.resolved_by, user: r.user_ref, label: JSON.parse(r.payload_json || '{}').label ?? null });
  const resultOf = (r, replayed = false) => ({ logId: r.id, commandId: r.command_id, status: r.status, entityId: r.server_entity_id, version: r.result_json ? JSON.parse(r.result_json).version ?? null : null, replayed, error: r.error_message, conflict: r.conflict_json ? JSON.parse(r.conflict_json) : null, retry: r.status === 'DEFERRED' });
  const FIELD_LABEL = (form, key) => form.fields.find((f) => f.key === key)?.label ?? key;
  const sameValue = (a, b) => (typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null) ? JSON.stringify(a ?? null) === JSON.stringify(b ?? null) : String(a ?? '') === String(b ?? '');

  /** Run one command for `actor`. Returns { status, entityId, version, error, conflict }. Throws nothing a person should see as a crash: a refusal is a REJECTED outcome. */
  function execute(actor, form, c, ctx) {
    const errors = form.validate(c.values ?? {}, form.rules(db, actor), c.op);
    if (c.op === 'create') {
      if (errors.length) return { status: 'REJECTED', error: errors.map((e) => e.message).join(' ') };
      const r = form.create(db, actor, c.values, ctx);
      return { status: 'APPLIED', entityId: String(r.entityId), version: r.version };
    }
    // update: the target is the id the server gave, or the client's reference to a record an earlier command made
    let entityId = c.entityId ?? null;
    if (!entityId && c.ref) {
      const made = db.prepare("SELECT server_entity_id FROM off_sync_log WHERE company_id = ? AND client_ref = ? AND command_type = ? AND server_entity_id IS NOT NULL AND status IN ('APPLIED', 'RESOLVED')").get(actor.companyId, c.ref, c.type);
      if (!made) return { status: 'DEFERRED', error: 'The record this change belongs to has not reached the server yet. It will be sent again.' };
      entityId = made.server_entity_id;
    }
    if (!entityId) return { status: 'REJECTED', error: 'The change does not say which record it is for.' };
    const current = form.load(db, actor, entityId);
    if (!current) return { status: 'REJECTED', error: 'That record does not exist or you may not open it.' };
    const changes = c.values ?? {};
    const bad = form.validate({ ...current.values, ...changes }, form.rules(db, actor), 'update');
    if (bad.length) return { status: 'REJECTED', error: bad.map((e) => e.message).join(' ') };
    const clash = [];
    if (c.baseVersion !== undefined && c.baseVersion !== null && c.baseVersion !== current.version) {
      for (const [k, mine] of Object.entries(changes)) {
        const base = (c.baseValues ?? {})[k];
        if (!sameValue(current.values[k], base) && !sameValue(current.values[k], mine)) clash.push({ key: k, label: FIELD_LABEL(form, k), base: base ?? null, mine, server: current.values[k] ?? null });
      }
    }
    if (clash.length) return { status: 'CONFLICT', entityId: String(entityId), conflict: { serverVersion: current.version, baseVersion: c.baseVersion, fields: clash, otherChanges: Object.fromEntries(Object.entries(changes).filter(([k]) => !clash.some((x) => x.key === k))) }, error: 'The record was changed on the server while you were offline.' };
    const r = form.update(db, actor, entityId, changes, { ...ctx, version: current.version });
    return { status: 'APPLIED', entityId: String(r.entityId), version: r.version };
  }
  const persist = (row, o) => {
    db.prepare(`UPDATE off_sync_log SET status = ?, server_entity_id = COALESCE(?, server_entity_id), conflict_json = ?, result_json = ?, error_message = ?, processed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
      .run(o.status, o.entityId ?? null, o.conflict ? JSON.stringify(o.conflict) : null, JSON.stringify({ version: o.version ?? null }), o.error ?? null, nowIso(), nowIso(), row.id);
    return db.prepare('SELECT * FROM off_sync_log WHERE id = ?').get(row.id);
  };
  const projectOfCommand = (form, c, actor) => {
    if (c.values?.projectId) return Number(c.values.projectId);
    const id = c.entityId ?? (c.ref ? db.prepare('SELECT server_entity_id AS id FROM off_sync_log WHERE company_id = ? AND client_ref = ? AND server_entity_id IS NOT NULL').get(actor.companyId, c.ref)?.id : null);
    return id ? (form.load(db, actor, id)?.projectId ?? null) : null;
  };

  const sync = {
    /**
     * @param {any} actor
     * @param {{ deviceId: string, deviceTime: string, commands: any[] }} body
     */
    run(actor, { deviceId, deviceTime, commands }) {
      const s = settings(actor);
      if (commands.length > s.batchMax) throw unprocessable(`Send at most ${s.batchMax} commands at a time.`, [{ field: 'commands', message: `at most ${s.batchMax}` }]);
      const device = liveDevice(actor, deviceId);
      const serverNow = Date.now();
      const drift = deviceTime ? Date.parse(deviceTime) - serverNow : 0;
      const ordered = [...commands].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const results = [];
      for (const c of ordered) results.push(sync.one(actor, device, c, drift, s));
      db.prepare('UPDATE off_devices SET last_sync_at = ?, last_seen_at = ?, clock_drift_ms = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), Number.isFinite(drift) ? Math.round(drift) : 0, nowIso(), device.id);
      const counts = {};
      for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
      publishEvent(db, { type: 'off.sync.completed', entity: 'off_device', entityId: device.id, actorId: actor.user, companyId: actor.companyId, data: { deviceId, counts } });
      const warn = Math.abs(drift) > s.maxDriftSeconds * 1000;
      return { serverTime: new Date(serverNow).toISOString(), driftMs: Math.round(drift), driftWarning: warn ? `The clock of this device is ${Math.round(Math.abs(drift) / 1000)} seconds ${drift > 0 ? 'ahead of' : 'behind'} the server. Times are corrected, but please set the device to automatic time.` : null, results, counts };
    },
    one(actor, device, c, drift, s) {
      const form = offlineForms.get(c.type);
      const prior = db.prepare('SELECT * FROM off_sync_log WHERE company_id = ? AND command_id = ?').get(actor.companyId, c.id);
      if (prior && prior.status !== 'DEFERRED') {
        if (prior.user_ref !== actor.user) return { commandId: c.id, status: 'REJECTED', error: 'This command id belongs to someone else.', replayed: true };
        return resultOf(prior, true); // BR-01: the same command again is the same record
      }
      const effective = c.createdAt ? new Date(Date.parse(c.createdAt) - (Number.isFinite(drift) ? drift : 0)).toISOString() : nowIso();
      const fresh = {
        seq: Number(c.seq ?? 0), type: c.type, op: c.op ?? 'create', ref: c.ref ?? null, values: c.values ?? {}, label: c.label ?? null,
      };
      return transaction(db, () => {
        let row = prior;
        if (!row) {
          const id = Number(db.prepare(`INSERT INTO off_sync_log (company_id, device_pk, user_ref, command_id, seq, command_type, op, client_ref, status, base_version, payload_json, client_created_at, device_clock_at, effective_at, lat, lng, accuracy, actor_json, created_by, source_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DEFERRED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'off_command')`)
            .run(actor.companyId, device.id, actor.user, c.id, fresh.seq, c.type, fresh.op, c.clientRef ?? c.ref ?? null, c.baseVersion ?? null,
              JSON.stringify({ values: fresh.values, baseValues: c.baseValues ?? {}, entityId: c.entityId ?? null, ref: c.ref ?? null, label: fresh.label }), c.createdAt ?? null, c.deviceClock ?? c.createdAt ?? null, effective, c.gps?.lat ?? null, c.gps?.lng ?? null, c.gps?.accuracy ?? null, JSON.stringify(snapshot(actor)), actor.user).lastInsertRowid);
          row = db.prepare('SELECT * FROM off_sync_log WHERE id = ?').get(id);
        }
        if (!form) return resultOf(persist(row, { status: 'REJECTED', error: `There is no offline form called ${c.type}.` }));
        if (!anywhere(actor, form.permission)) return resultOf(persist(row, { status: 'REJECTED', error: `You may not use this form (permission ${form.permission}).` }));
        const projectId = projectOfCommand(form, c, actor);
        if (projectId && !may(actor, form.permission, { companyId: actor.companyId, projectId })) return resultOf(persist(row, { status: 'REJECTED', error: 'You may not do this for that project.' }));
        // BR-02: an old command waits for a supervisor
        if (Date.now() - Date.parse(effective) > s.maxAgeDays * 86_400_000) {
          writeAudit(db, { entity: 'off_sync_log', entityId: row.id, action: 'held_old', newValues: { commandId: c.id, effectiveAt: effective }, actor: actor.user, companyId: actor.companyId });
          return resultOf(persist(row, { status: 'NEEDS_CONFIRMATION', error: `This was captured more than ${s.maxAgeDays} days ago, so a supervisor must confirm it before it is saved.` }));
        }
        return resultOf(sync.apply(actor, form, row, { ...c, values: fresh.values }, effective));
      });
    },
    /** Apply a stored command (also used after a supervisor confirms or a person resolves a conflict). */
    apply(actor, form, row, c, effective) {
      const ctx = { commandId: row.command_id, clientRef: row.client_ref, effectiveAt: effective ?? row.effective_at, gps: row.lat !== null ? { lat: row.lat, lng: row.lng, accuracy: row.accuracy } : null };
      let outcome;
      try {
        outcome = execute(actor, form, { ...c, op: row.op, type: row.command_type, baseVersion: row.base_version }, ctx);
      } catch (e) {
        if (e instanceof HttpError && e.status < 500) outcome = { status: 'REJECTED', error: e.message };
        else throw e;
      }
      const saved = persist(row, outcome);
      if (outcome.status === 'APPLIED') writeAudit(db, { entity: 'off_sync_log', entityId: saved.id, action: 'apply', newValues: { commandId: row.command_id, type: row.command_type, entityId: outcome.entityId, effectiveAt: ctx.effectiveAt }, actor: actor.user, companyId: actor.companyId });
      if (outcome.status === 'CONFLICT') {
        writeAudit(db, { entity: 'off_sync_log', entityId: saved.id, action: 'conflict', newValues: { commandId: row.command_id, fields: outcome.conflict.fields.map((f) => f.key) }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'off.conflict.raised', entity: 'off_sync_log', entityId: saved.id, actorId: actor.user, companyId: actor.companyId, data: { commandType: row.command_type, entityId: outcome.entityId } });
      }
      return saved;
    },
    /** The commands of the person (all with off.sync.view_all) and what became of them. */
    /** @param {any} actor @param {{ status?: string, all?: boolean, limit?: number, offset?: number }} [o] */
    list(actor, { status, all = false, limit = 50, offset = 0 } = {}) {
      const wide = all && anywhere(actor, 'off.sync.view_all');
      const where = ['l.company_id = :c', 'l.is_active = 1']; const p = { c: actor.companyId, limit, offset };
      if (!wide) { where.push('l.user_ref = :u'); p.u = actor.user; }
      if (status) { where.push('l.status = :s'); p.s = status; }
      const pc = { ...p }; delete pc.limit; delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM off_sync_log l WHERE ${where.join(' AND ')}`).get(pc).n;
      const rows = db.prepare(`SELECT l.* FROM off_sync_log l WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT :limit OFFSET :offset`).all(p).map(rowView);
      const counts = Object.fromEntries(db.prepare(`SELECT l.status, COUNT(*) AS n FROM off_sync_log l WHERE ${where.filter((w) => !w.startsWith('l.status')).join(' AND ')} GROUP BY l.status`).all(Object.fromEntries(Object.entries(pc).filter(([k]) => k !== 's'))).map((r) => [r.status, r.n]));
      return { rows, total, counts };
    },
    /** One command that waits for a decision, with what both sides hold. */
    get(actor, id) {
      const r = db.prepare('SELECT * FROM off_sync_log WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      if (!r) throw notFound('That command does not exist.');
      if (r.user_ref !== actor.user && !anywhere(actor, 'off.sync.view_all')) {
        // a supervisor sees the commands waiting for them, of the projects they hold the right for
        const payload = JSON.parse(r.payload_json);
        const form = offlineForms.get(r.command_type);
        const projectId = form ? projectOfCommand(form, { values: payload.values, entityId: payload.entityId, ref: payload.ref }, actorOf(JSON.parse(r.actor_json))) : null;
        if (!(r.status === 'NEEDS_CONFIRMATION' && may(actor, 'off.sync.confirm', { companyId: actor.companyId, projectId: projectId ?? undefined }))) throw notFound('That command does not exist.');
      }
      return { ...rowView(r), mine: JSON.parse(r.payload_json) };
    },
    /** The person resolves their own conflict: keep mine, keep the server's, or choose field by field. */
    resolve(actor, id, { choice, fields = {} }) {
      const r = db.prepare('SELECT * FROM off_sync_log WHERE id = ? AND company_id = ? AND user_ref = ? AND is_active = 1').get(id, actor.companyId, actor.user);
      if (!r) throw notFound('That conflict does not exist.');
      if (r.status !== 'CONFLICT') throw conflict(`This command is ${r.status.toLowerCase().replace('_', ' ')}, so there is nothing to resolve.`);
      const form = offlineForms.get(r.command_type);
      const cf = JSON.parse(r.conflict_json);
      const payload = JSON.parse(r.payload_json);
      return transaction(db, () => {
        let values;
        if (choice === 'MINE') values = payload.values;
        else if (choice === 'MERGE') {
          values = { ...cf.otherChanges };
          for (const f of cf.fields) {
            const pick = fields[f.key];
            if (pick === undefined) throw unprocessable(`Choose mine or the server's for "${f.label}".`, [{ field: f.key, message: 'choose a side' }]);
            if (pick === 'mine') values[f.key] = f.mine; else if (pick !== 'server') values[f.key] = pick; // a typed value
          }
        } else values = { ...cf.otherChanges }; // SERVER: only what the server did not also change
        let outcome = { status: 'RESOLVED', entityId: r.server_entity_id };
        if (Object.keys(values).length && form) {
          const cur = form.load(db, actor, r.server_entity_id);
          if (!cur) throw unprocessable('That record no longer exists or you may not open it.');
          const bad = form.validate({ ...cur.values, ...values }, form.rules(db, actor), 'update');
          if (bad.length) throw unprocessable(bad.map((e) => e.message).join(' '), bad.map((e) => ({ field: e.field, message: e.message })));
          const done = form.update(db, actor, r.server_entity_id, values, { commandId: r.command_id, effectiveAt: r.effective_at, version: cur.version });
          outcome = { status: 'RESOLVED', entityId: String(done.entityId), version: done.version };
        }
        db.prepare("UPDATE off_sync_log SET status = 'RESOLVED', resolution = ?, resolved_by = ?, resolved_at = ?, result_json = ?, processed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(choice, actor.user, nowIso(), JSON.stringify({ version: outcome.version ?? null, values }), nowIso(), nowIso(), r.id);
        writeAudit(db, { entity: 'off_sync_log', entityId: r.id, action: 'resolve', oldValues: { server: Object.fromEntries(cf.fields.map((f) => [f.key, f.server])) }, newValues: { choice, values }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'off.conflict.resolved', entity: 'off_sync_log', entityId: r.id, actorId: actor.user, companyId: actor.companyId, data: { choice } });
        return rowView(db.prepare('SELECT * FROM off_sync_log WHERE id = ?').get(r.id));
      });
    },
    /** BR-02: a supervisor confirms an old command (it is then applied with the rights of the person who made it) or declines it. */
    confirmList(actor) {
      if (!anywhere(actor, 'off.sync.confirm')) return [];
      return db.prepare("SELECT l.* FROM off_sync_log l WHERE l.company_id = ? AND l.status = 'NEEDS_CONFIRMATION' AND l.is_active = 1 ORDER BY l.id LIMIT 200").all(actor.companyId)
        .filter((r) => { const form = offlineForms.get(r.command_type); const p = form ? projectOfCommand(form, { ...JSON.parse(r.payload_json), values: JSON.parse(r.payload_json).values, entityId: JSON.parse(r.payload_json).entityId, ref: JSON.parse(r.payload_json).ref }, actorOf(JSON.parse(r.actor_json))) : null; return may(actor, 'off.sync.confirm', { companyId: actor.companyId, projectId: p ?? undefined }); })
        .map((r) => ({ ...rowView(r), mine: JSON.parse(r.payload_json) }));
    },
    decide(actor, id, { decision, reason }) {
      const r = db.prepare('SELECT * FROM off_sync_log WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      if (!r) throw notFound('That command does not exist.');
      if (r.status !== 'NEEDS_CONFIRMATION') throw conflict('This command is not waiting for confirmation.');
      const original = actorOf(JSON.parse(r.actor_json));
      if (original.user === actor.user) throw forbidden('You cannot confirm your own offline command.');
      const form = offlineForms.get(r.command_type);
      const payload = JSON.parse(r.payload_json);
      const projectId = form ? projectOfCommand(form, { values: payload.values, entityId: payload.entityId, ref: payload.ref }, original) : null;
      if (!may(actor, 'off.sync.confirm', { companyId: actor.companyId, projectId: projectId ?? undefined })) throw forbidden('You may not confirm commands for this project (permission off.sync.confirm).');
      return transaction(db, () => {
        db.prepare('UPDATE off_sync_log SET confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?').run(actor.user, nowIso(), nowIso(), r.id);
        writeAudit(db, { entity: 'off_sync_log', entityId: r.id, action: decision === 'CONFIRM' ? 'confirm_old' : 'decline_old', newValues: { commandId: r.command_id }, reason, actor: actor.user, companyId: actor.companyId });
        if (decision === 'DECLINE') return rowView(persist(db.prepare('SELECT * FROM off_sync_log WHERE id = ?').get(r.id), { status: 'DECLINED', error: `Declined by ${actor.user}${reason ? `: ${reason}` : ''}` }));
        const fresh = db.prepare('SELECT * FROM off_sync_log WHERE id = ?').get(r.id);
        return rowView(sync.apply(original, form, fresh, { values: payload.values, baseValues: payload.baseValues, entityId: payload.entityId, ref: payload.ref }, r.effective_at));
      });
    },
  };

  // ---- media: photos in resumable chunks (FR-05) ----
  const uploadView = (u) => ({ uploadId: u.upload_id, commandId: u.command_id, fileName: u.file_name, totalSize: u.total_size, chunkSize: u.chunk_size, totalChunks: u.total_chunks, received: JSON.parse(u.received_json), status: u.status, fileId: u.file_id, error: u.error_message });
  const mine = (actor, uploadId) => {
    const u = db.prepare('SELECT * FROM off_uploads WHERE upload_id = ? AND company_id = ? AND user_ref = ? AND is_active = 1').get(uploadId, actor.companyId, actor.user);
    if (!u) throw notFound('That upload does not exist.');
    return u;
  };
  const chunkKey = (u, i) => `c${u.company_id}/off/${u.upload_id}/${String(i).padStart(6, '0')}`;
  const uploads = {
    start(actor, { deviceId, commandId, fileName, totalSize, chunkSize }) {
      const device = liveDevice(actor, deviceId);
      if (totalSize > MAX_UPLOAD_BYTES) throw unprocessable(`A photo can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, [{ field: 'totalSize', message: 'is too large' }]);
      if (chunkSize > MAX_CHUNK_BYTES) throw unprocessable(`A chunk can be at most ${MAX_CHUNK_BYTES / 1024} KB.`, [{ field: 'chunkSize', message: 'is too large' }]);
      const cmd = db.prepare('SELECT * FROM off_sync_log WHERE company_id = ? AND command_id = ? AND user_ref = ?').get(actor.companyId, commandId, actor.user);
      if (!cmd) throw notFound('Send the record first; that command is not known to the server.');
      const total = Math.max(1, Math.ceil(totalSize / chunkSize));
      const open = db.prepare("SELECT * FROM off_uploads WHERE company_id = ? AND user_ref = ? AND command_id = ? AND file_name = ? AND total_size = ? AND status IN ('OPEN', 'COMPLETE') AND is_active = 1").get(actor.companyId, actor.user, commandId, fileName, totalSize);
      if (open) return uploadView(open); // resume, or a replay of a finished one
      const uploadId = randomUUID();
      db.prepare("INSERT INTO off_uploads (company_id, device_pk, user_ref, upload_id, command_id, file_name, total_size, chunk_size, total_chunks, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'off_upload')").run(actor.companyId, device.id, actor.user, uploadId, commandId, fileName.slice(0, 200), totalSize, chunkSize, total, actor.user);
      return uploadView(db.prepare('SELECT * FROM off_uploads WHERE upload_id = ?').get(uploadId));
    },
    get: (actor, uploadId) => uploadView(mine(actor, uploadId)),
    async chunk(actor, uploadId, index, buffer) {
      const u = mine(actor, uploadId);
      liveDevice(actor, db.prepare('SELECT device_id FROM off_devices WHERE id = ?').get(u.device_pk).device_id, { touch: false });
      if (u.status !== 'OPEN') throw conflict('This upload is already finished.');
      if (!Number.isInteger(index) || index < 0 || index >= u.total_chunks) throw badRequest('That chunk number is outside this file.');
      if (buffer.length > MAX_CHUNK_BYTES) throw badRequest('That chunk is too large.');
      const expected = index === u.total_chunks - 1 ? u.total_size - u.chunk_size * (u.total_chunks - 1) : u.chunk_size;
      if (buffer.length !== expected) throw unprocessable(`Chunk ${index} should be ${expected} bytes; it has ${buffer.length}.`);
      await storage.putBuffer(chunkKey(u, index), buffer);
      const got = new Set(JSON.parse(u.received_json)); got.add(index);
      db.prepare('UPDATE off_uploads SET received_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...got].sort((a, b) => a - b)), nowIso(), u.id);
      return uploadView(db.prepare('SELECT * FROM off_uploads WHERE id = ?').get(u.id));
    },
    async complete(actor, uploadId) {
      const u = mine(actor, uploadId);
      if (u.status === 'COMPLETE') return uploadView(u); // idempotent
      const got = JSON.parse(u.received_json);
      if (got.length !== u.total_chunks) throw unprocessable(`${u.total_chunks - got.length} chunk(s) have not arrived yet.`, [{ field: 'chunks', message: 'incomplete' }]);
      const cmd = db.prepare('SELECT * FROM off_sync_log WHERE company_id = ? AND command_id = ?').get(u.company_id, u.command_id);
      const form = cmd ? offlineForms.get(cmd.command_type) : null;
      if (!cmd || !cmd.server_entity_id || !['APPLIED', 'RESOLVED'].includes(cmd.status) || !form) throw conflict('The record this photo belongs to has not been saved on the server yet. Send the record first.');
      if (!form.load(db, actor, cmd.server_entity_id)) throw forbidden('You may not add files to that record.');
      const parts = [];
      for (let i = 0; i < u.total_chunks; i += 1) { const chunks = []; for await (const c of storage.createReadStream(chunkKey(u, i))) chunks.push(c); parts.push(Buffer.concat(chunks)); }
      const buffer = Buffer.concat(parts);
      const fail = async (msg) => { db.prepare("UPDATE off_uploads SET status = 'FAILED', error_message = ?, updated_at = ? WHERE id = ?").run(msg, nowIso(), u.id); for (let i = 0; i < u.total_chunks; i += 1) await storage.remove?.(chunkKey(u, i)); throw unprocessable(msg); };
      if (buffer.length !== u.total_size) return fail('The photo arrived with the wrong size; send it again.');
      const type = checkType(u.file_name, buffer.subarray(0, 4096), ['jpg', 'jpeg', 'png', 'webp', 'pdf']);
      if (!type.ok) return fail(type.problem);
      const verdict = await runScanners([scanner], async function* () { yield buffer; });
      if (verdict.status === 'INFECTED') return fail(`The photo was refused by the virus scan (${verdict.detail}).`);
      const hash = sha256(buffer);
      const day = new Date();
      const key = `c${u.company_id}/off/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${type.extension}`;
      await storage.putBuffer(key, buffer);
      return transaction(db, () => {
        const entity = form.attachmentEntity ?? form.code;
        const f = db.prepare(`INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, scanned_at, linked_entity, linked_id, version_no, retention_class, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLEAN', ?, ?, ?, 1, 'standard', ?, 'off_upload')`).run(u.company_id, key, u.file_name, type.extension, type.mime, type.category, buffer.length, hash, nowIso(), entity, Number(cmd.server_entity_id), actor.user);
        db.prepare("UPDATE off_uploads SET status = 'COMPLETE', file_id = ?, sha256 = ?, updated_at = ? WHERE id = ?").run(Number(f.lastInsertRowid), hash, nowIso(), u.id);
        writeAudit(db, { entity: 'off_uploads', entityId: u.id, action: 'complete', newValues: { fileName: u.file_name, size: buffer.length, hash, linkedTo: `${entity}:${cmd.server_entity_id}` }, actor: actor.user, companyId: u.company_id });
        return uploadView(db.prepare('SELECT * FROM off_uploads WHERE id = ?').get(u.id));
      });
    },
  };

  return { devices, masters, sync, uploads, settings, deviceView };
}

const services = new WeakMap();
export const bind = (db, s) => services.set(db, s);
export const offlineOf = (db) => services.get(db);
