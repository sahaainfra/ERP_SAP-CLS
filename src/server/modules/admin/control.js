import { createHash } from 'node:crypto';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createFlagRepository } from '../core/feature-flags/repository.js';
import { resolveFlag, setFlag } from '../core/feature-flags/service.js';
import { createParameterService } from '../core/parameters/service.js';
import { iamAuthOf } from '../iam/index.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';

// integrity: the workflow states of this part's tables (the Data Health check)
integrityRegistry.register({ statuses: { 'adm_emergency_actions': ['PENDING', 'RATIFIED'] } });

/**
 * Part 29.01 — the Super Admin Enterprise Control Center.
 *
 * FR-01 one catalogue of the configuration pages of every earlier part (from the navigation registry), searchable, with the recent changes.
 * FR-02 the governance dashboard: admin approvals waiting, open segregation-of-duties violations, active privileged access, dormant accounts,
 * failed jobs and integrations, integrity failures, backups (29.06), expiring licences and certificates, AI usage — each drilling to its list.
 * FR-03, BR-01 configuration change requests through the shared approval engine (`core_change_requests`): a feature flag or a parameter is
 * changed only when a checker approves (SYSADM → ITADM; financial and security keys → ITADM then CFO or DIR); configuration snapshots
 * export the settings of an environment and a snapshot from another environment is compared key by key, its differences raised as change
 * requests — never applied directly.
 * FR-04 the onboarding checklist of a company: what is set up (settings, financial year, numbering, chart of accounts, users with roles).
 * FR-05 emergency controls act at once — read-only mode for the company, a feature kill switch, force logout — and each raises a ratification
 * request that must be decided within 24 hours (BR-01).
 */
export const ADMIN_FLAG = 'ff.admin.p2901';
export const CHANGE_TYPE = 'admin_config_change';
export const RATIFY_TYPE = 'admin_emergency_ratify';
export const AREAS = Object.freeze({ FEATURE_FLAG: 'Feature flag', PARAMETER: 'Parameter' });
const RATIFY_HOURS = 24;
const FIN = /^(fin|bill|pay|proc|ctr|bud|close|tax)\./;
const SEC = /^(iam|sec|core\.security|auth|ai\.(kill|provider))/;
/** BR-01 / section 9: SYSADM prepares; ITADM checks; a financial or security key also needs the CFO or a director. */
export const chainFor = (area, key) => (area === 'PARAMETER' && FIN.test(key) ? ['ITADM', 'CFO|DIR'] : SEC.test(key) ? ['ITADM', 'DIR'] : ['ITADM']);

const shape = { type: 'object', additionalProperties: true };
for (const [type, description] of [
  ['admin.config.changed', 'An approved configuration change was applied (part 29.01): data { area, key, from, to, requestId }.'],
  ['admin.emergency.executed', 'An emergency control was used (part 29.01): data { action, reason, ratifyBy }.'],
  ['admin.emergency.ratified', 'An emergency action was ratified by a checker (part 29.01).'],
]) eventTypes.define({ type, version: 1, schema: shape, owner: 'admin', description });

const services = new WeakMap();
export const controlOf = (db) => services.get(db) ?? null;
export function requireAdmin(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, ADMIN_FLAG)) throw notFound('The control center is not enabled for this company.');
}
const has = (db, t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
const iso = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

/** @param {any} context */
export function createControlCenter(context) {
  const { db, environment } = context;
  const store = createParameterStore(db);
  const params = createParameterService({ db, store, registry: parameterRegistry });
  const guard = (actor, key) => { requireAdmin(context, actor); if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`); };
  const audit = (actor, entity, id, action, extra = {}) => writeAudit(db, { companyId: actor.companyId, entity, entityId: String(id), action, actor: actor.user, ...extra });

  // ---------------------------------------------------------------- the areas a change request can change (each through its owner)
  const area = {
    FEATURE_FLAG: {
      exists: (key) => Boolean(createFlagRepository(db).findScopeRow(key, {})),
      current: (companyId, key) => resolveFlag(db, key, { environment, companyId }).enabled,
      parse: (v) => { if (typeof v === 'boolean') return v; if (v === 'true' || v === 'false') return v === 'true'; throw unprocessable('A feature flag is on (true) or off (false).'); },
      apply(companyId, key, value, by, reason) {
        const scope = { level: 'company', companyId };
        const row = createFlagRepository(db).findScopeRow(key, scope);
        setFlag(db, { key, scope, enabled: value, reason, version: row?.version, actor: by, companyId });
      },
      list: (companyId) => db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY key').all().map((r) => ({ key: r.key, value: area.FEATURE_FLAG.current(companyId, r.key) })),
    },
    PARAMETER: {
      exists: (key) => Boolean(parameterRegistry.get(key)),
      // read fresh: another module's parameter store may have changed the value since (a stale cache must never hide a conflict)
      current: (companyId, key) => { store.invalidate(); return store.get(key, { companyId, date: todayIST() }) ?? parameterRegistry.get(key)?.default ?? null; },
      parse: (v) => v,
      apply(companyId, key, value, by, reason) {
        // applied on the approved request's authority (BR-01): the parameter service still validates the type and bounds
        params.set({ companyId, user: by, roles: ['SYSADM'], viaChangeRequest: true }, { key, value, scopeType: 'company', scopeId: companyId, effectiveFrom: todayIST(), reason });
        store.invalidate?.();
      },
      list: (companyId) => { store.invalidate(); const date = todayIST(); return parameterRegistry.list().filter((d) => d.scopes.includes('company')).map((d) => ({ key: d.key, value: store.get(d.key, { companyId, date }) })); },
    },
  };
  const norm = (v) => (v === null || v === undefined ? null : typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) ? JSON.stringify(v) : String(v));

  // ---------------------------------------------------------------- the approval engine of this module (maker-checker, BR-01)
  const handlers = {
    [CHANGE_TYPE]: {
      authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
      apply(_db, request, actor) {
        const { area: a, key, from, to } = request.payload;
        const now = norm(area[a].current(request.companyId, key));
        if (now !== norm(from)) throw conflict(`${AREAS[a]} ${key} was changed since the request was raised (it is now ${now}); raise a new request.`);
        area[a].apply(request.companyId, key, to, actor.user, `Change request ${request.id}: ${request.reason}`);
        writeAudit(db, { companyId: request.companyId, entity: 'core_change_requests', entityId: String(request.id), action: 'apply', actor: actor.user, oldValues: { [key]: from }, newValues: { [key]: to } });
        publishEvent(db, { type: 'admin.config.changed', entity: 'core_change_requests', entityId: request.id, actorId: actor.user, companyId: request.companyId, data: { area: a, key, from, to, requestId: request.id } });
      },
    },
    [RATIFY_TYPE]: {
      authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
      apply(_db, request, actor) {
        db.prepare("UPDATE adm_emergency_actions SET ratified_by = ?, ratified_at = ?, status = 'RATIFIED', updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), iso(), request.payload.actionId);
        publishEvent(db, { type: 'admin.emergency.ratified', entity: 'adm_emergency_actions', entityId: request.payload.actionId, actorId: actor.user, companyId: request.companyId, data: { requestId: request.id } });
      },
    },
  };
  const engine = createApprovalEngine({ db, handlers });

  const changes = {
    /** FR-03: raise a change; nothing is applied until the checker approves. */
    request(actor, { area: a, key, value, reason }) {
      guard(actor, 'adm.change.create');
      if (!area[a]) throw unprocessable('Unknown area.');
      if (!area[a].exists(key)) throw notFound(`${AREAS[a]} ${key} does not exist.`);
      const to = area[a].parse(value); const from = area[a].current(actor.companyId, key);
      if (norm(from) === norm(to)) throw unprocessable(`${key} already has this value.`);
      if (a === 'PARAMETER') { const def = parameterRegistry.get(key); const n = Number(to);
        if (['integer', 'decimal'].includes(def.dataType) && (!Number.isFinite(n) || (def.min != null && n < def.min) || (def.max != null && n > def.max))) throw unprocessable(`${key} must be a number${def.min != null ? ` from ${def.min}` : ''}${def.max != null ? ` to ${def.max}` : ''}.`); }
      if (db.prepare("SELECT 1 FROM core_change_requests WHERE company_id = ? AND type = ? AND target_id = ? AND status = 'SUBMITTED' AND is_active = 1").get(actor.companyId, CHANGE_TYPE, key)) throw conflict(`A change of ${key} is already waiting for approval.`);
      return engine.submit(actor, { type: CHANGE_TYPE, title: `${AREAS[a]} ${key}: ${norm(from)} → ${norm(to)}`, targetType: a, targetId: key, payload: { area: a, key, from, to }, reason, chain: chainFor(a, key) });
    },
    list(actor, { status = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'adm.control.view');
      const where = "company_id = ? AND is_active = 1 AND type IN ('admin_config_change', 'admin_emergency_ratify')" + (status ? ' AND status = ?' : '');
      const params = [actor.companyId, ...(status ? [status] : [])];
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_change_requests WHERE ${where}`).get(...params).n;
      const ids = db.prepare(`SELECT id FROM core_change_requests WHERE ${where} ORDER BY status = 'SUBMITTED' DESC, id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize).map((x) => x.id);
      const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      return { rows: ids.map((i) => ({ ...engine.get(actor, i), canDecide: mine.has(i) })), total, page, pageSize };
    },
    act(actor, id, body) { guard(actor, 'adm.control.view'); const r = engine.get(actor, id); if (![CHANGE_TYPE, RATIFY_TYPE].includes(r.type)) throw notFound('That request does not exist.'); return engine.act(actor, id, body); },
    withdraw(actor, id) { guard(actor, 'adm.change.create'); return engine.withdraw(actor, id); },
  };

  // ---------------------------------------------------------------- emergency controls (FR-05): at once, logged, ratified within 24 h
  const controlRow = (companyId) => db.prepare('SELECT * FROM adm_controls WHERE company_id = ?').get(companyId) ?? { read_only: 0 };
  function emergency(actor, action, reason, detail) {
    const due = new Date(Date.now() + RATIFY_HOURS * 3_600_000).toISOString();
    const id = Number(db.prepare(`INSERT INTO adm_emergency_actions (company_id, action, reason, detail_json, executed_by, executed_at, ratify_due, status, created_by, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'emergency')`).run(actor.companyId, action, reason, JSON.stringify(detail), actor.user, iso(), due, actor.user).lastInsertRowid);
    audit(actor, 'adm_emergency_actions', id, action.toLowerCase(), { reason, newValues: detail });
    publishEvent(db, { type: 'admin.emergency.executed', entity: 'adm_emergency_actions', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { action, reason, ratifyBy: due } });
    const req = engine.submit(actor, { type: RATIFY_TYPE, title: `Ratify ${action.toLowerCase().replace(/_/g, ' ')} by ${actor.user}`, targetType: 'EMERGENCY', targetId: String(id), payload: { actionId: id, action, detail }, reason, chain: ['ITADM|DIR'] });
    db.prepare('UPDATE adm_emergency_actions SET ratification_request_id = ? WHERE id = ?').run(req.id, id);
    return id;
  }
  const emergencies = {
    readOnly(actor, { on, reason }) {
      guard(actor, 'adm.emergency.execute');
      return transaction(db, () => {
        const cur = controlRow(actor.companyId);
        if (Boolean(cur.read_only) === on) throw unprocessable(on ? 'The company is already read-only.' : 'The company is not read-only.');
        db.prepare(`INSERT INTO adm_controls (company_id, read_only, read_only_reason, read_only_by, read_only_at, created_by) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (company_id) DO UPDATE SET read_only = excluded.read_only, read_only_reason = excluded.read_only_reason, read_only_by = excluded.read_only_by, read_only_at = excluded.read_only_at, updated_at = excluded.read_only_at, version = adm_controls.version + 1`)
          .run(actor.companyId, on ? 1 : 0, reason, actor.user, iso(), actor.user);
        readOnlyCache.delete(actor.companyId);
        emergency(actor, on ? 'READ_ONLY_ON' : 'READ_ONLY_OFF', reason, { on });
        return emergencies.state(actor);
      });
    },
    killFeature(actor, { key, reason }) {
      guard(actor, 'adm.emergency.execute');
      if (!area.FEATURE_FLAG.exists(key)) throw notFound(`Feature flag ${key} does not exist.`);
      if (key === ADMIN_FLAG) throw unprocessable('The control center cannot switch itself off.');
      return transaction(db, () => {
        if (!area.FEATURE_FLAG.current(actor.companyId, key)) throw unprocessable(`${key} is already off.`);
        area.FEATURE_FLAG.apply(actor.companyId, key, false, actor.user, `Emergency kill switch: ${reason}`);
        emergency(actor, 'FEATURE_KILL', reason, { key });
        return emergencies.state(actor);
      });
    },
    forceLogout(actor, { reason }) {
      guard(actor, 'adm.emergency.execute');
      const auth = iamAuthOf(db); if (!auth) throw unprocessable('Sign-in is not installed.');
      return transaction(db, () => {
        let ended = 0;
        for (const u of db.prepare("SELECT id FROM iam_users WHERE company_id = ? AND deleted_at IS NULL AND username <> ?").all(actor.companyId, actor.user)) ended += auth.revokeSessions(u.id, { reason: 'force_logout', by: actor.user });
        emergency(actor, 'FORCE_LOGOUT', reason, { sessions: ended });
        return { ...emergencies.state(actor), sessionsEnded: ended };
      });
    },
    state(actor) {
      guard(actor, 'adm.control.view');
      const c = controlRow(actor.companyId);
      const actions = db.prepare('SELECT * FROM adm_emergency_actions WHERE company_id = ? ORDER BY id DESC LIMIT 20').all(actor.companyId).map((a) => ({ id: a.id, action: a.action, reason: a.reason, detail: JSON.parse(a.detail_json),
        by: a.executed_by, at: a.executed_at, ratifyDue: a.ratify_due, status: a.status, overdue: a.status === 'PENDING' && a.ratify_due < iso(), ratifiedBy: a.ratified_by, requestId: a.ratification_request_id }));
      return { readOnly: Boolean(c.read_only), readOnlyReason: c.read_only_reason ?? null, readOnlySince: c.read_only ? c.read_only_at : null, readOnlyBy: c.read_only ? c.read_only_by : null, actions, canExecute: hasPermissionAnywhere(actor, 'adm.emergency.execute') };
    },
  };

  // ---------------------------------------------------------------- configuration snapshots and the diff between environments (FR-03)
  const contentOf = (companyId) => ({ FEATURE_FLAG: Object.fromEntries(area.FEATURE_FLAG.list(companyId).map((x) => [x.key, x.value])), PARAMETER: Object.fromEntries(area.PARAMETER.list(companyId).map((x) => [x.key, norm(x.value)])) });
  const checksum = (c) => createHash('sha256').update(JSON.stringify(c)).digest('hex');
  /** T-01: every key whose value differs, is only in one side, with the current and incoming values. */
  function diffOf(current, incoming) {
    const out = [];
    for (const a of Object.keys(AREAS)) {
      const cur = current[a] ?? {}; const inc = incoming[a] ?? {};
      for (const key of [...new Set([...Object.keys(cur), ...Object.keys(inc)])].sort()) {
        const c = key in cur ? norm(cur[key]) : undefined; const i = key in inc ? norm(inc[key]) : undefined;
        if (c === i) continue;
        out.push({ area: a, key, current: c ?? null, incoming: i ?? null, change: c === undefined ? 'ONLY_INCOMING' : i === undefined ? 'ONLY_HERE' : 'CHANGED', canApply: c !== undefined && i !== undefined });
      }
    }
    return out;
  }
  const snapshots = {
    take(actor, { note }) {
      guard(actor, 'adm.snapshot.manage');
      const content = contentOf(actor.companyId); const sum = checksum(content);
      const id = Number(db.prepare('INSERT INTO adm_config_snapshots (company_id, environment, taken_at, checksum, content_json, note, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, environment, iso(), sum, JSON.stringify(content), note ?? null, actor.user, 'snapshot').lastInsertRowid);
      audit(actor, 'adm_config_snapshots', id, 'take', { newValues: { checksum: sum, environment } });
      return snapshots.get(actor, id);
    },
    list(actor) { guard(actor, 'adm.control.view'); return db.prepare('SELECT id, environment, taken_at, checksum, note, created_by FROM adm_config_snapshots WHERE company_id = ? ORDER BY id DESC LIMIT 50').all(actor.companyId).map((s) => ({ id: s.id, environment: s.environment, takenAt: s.taken_at, checksum: s.checksum, note: s.note, by: s.created_by })); },
    get(actor, id) { guard(actor, 'adm.control.view'); const s = db.prepare('SELECT * FROM adm_config_snapshots WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!s) throw notFound('That snapshot does not exist.'); return { id: s.id, environment: s.environment, takenAt: s.taken_at, checksum: s.checksum, note: s.note, by: s.created_by, content: JSON.parse(s.content_json) }; },
    /** The export file: the content with its environment and checksum (verified again on import). */
    exportFile(actor, id) { const s = snapshots.get(actor, id); audit(actor, 'adm_config_snapshots', s.id, 'export'); return { buffer: Buffer.from(JSON.stringify({ format: 'erp-config/1', environment: s.environment, takenAt: s.takenAt, checksum: s.checksum, content: s.content }, null, 2)), contentType: 'application/json', fileName: `config-${s.environment}-${s.takenAt.slice(0, 10)}.json` }; },
    diff(actor, file) {
      guard(actor, 'adm.snapshot.manage');
      if (file?.format !== 'erp-config/1' || typeof file.content !== 'object') throw unprocessable('This is not a configuration export of this ERP.');
      if (checksum(file.content) !== file.checksum) throw unprocessable('The file was changed after it was exported (the checksum does not match).');
      return { from: { environment: file.environment, takenAt: file.takenAt }, to: { environment }, differences: diffOf(contentOf(actor.companyId), file.content) };
    },
    /** Each chosen difference becomes a change request (maker-checker); nothing is written here. */
    importChanges(actor, { file, keys, reason }) {
      const d = snapshots.diff(actor, file); const pick = d.differences.filter((x) => x.canApply && keys.includes(`${x.area}:${x.key}`));
      if (!pick.length) throw unprocessable('Choose at least one difference that exists on both sides.');
      return transaction(db, () => pick.map((x) => changes.request(actor, { area: x.area, key: x.key, value: x.area === 'FEATURE_FLAG' ? x.incoming === 'true' : x.incoming, reason: `${reason} (from ${d.from.environment} ${d.from.takenAt})` })));
    },
  };

  // ---------------------------------------------------------------- FR-01 the catalogue of configuration pages, FR-02 the governance dashboard
  function catalogue(actor, { q = null } = {}) {
    guard(actor, 'adm.control.view');
    const like = q ? `%${q.toLowerCase()}%` : null;
    const rows = db.prepare(`SELECT code, parent_code, label, route, permission_key, feature_flag, keywords FROM ui_navigation_entries WHERE kind = 'page' AND is_active = 1 AND deleted_at IS NULL
      AND (parent_code IN ('g-administration', 'g-console', 'g-configuration', 'g-settings') OR keywords LIKE '%config%' OR keywords LIKE '%setting%' OR label LIKE '%Settings%' OR label LIKE '%Configuration%')
      ${like ? 'AND (LOWER(label) LIKE ? OR LOWER(keywords) LIKE ? OR LOWER(route) LIKE ?)' : ''} ORDER BY label`).all(...(like ? [like, like, like] : []));
    const visible = rows.filter((r) => !r.permission_key || r.permission_key === 'self' || hasPermissionAnywhere(actor, r.permission_key)).filter((r) => !r.feature_flag || context.flags.isOn(actor, r.feature_flag));
    // the change history of the company's configuration: every approval-controlled configuration request (all modules), newest first
    const recent = db.prepare("SELECT id, type, title, status, requested_by, COALESCE(updated_at, created_at) AS at FROM core_change_requests WHERE company_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 25").all(actor.companyId);
    return { pages: visible.map((r) => ({ code: r.code, label: r.label, route: r.route, group: r.parent_code })), recent: recent.map((r) => ({ id: r.id, type: r.type, title: r.title, status: r.status, by: r.requested_by, at: r.at })) };
  }
  function dashboard(actor) {
    guard(actor, 'adm.control.view');
    const c = actor.companyId; const m = [];
    const add = (key, value, tone, drill, extra = {}) => m.push({ key, value, tone, drill, ...extra });
    add('approvals', db.prepare("SELECT COUNT(*) AS n FROM core_change_requests WHERE company_id = ? AND status = 'SUBMITTED' AND is_active = 1").get(c).n, null, '/admin/control?tab=approvals');
    if (has(db, 'iam_sod_violations')) add('sod', db.prepare("SELECT COUNT(*) AS n FROM iam_sod_violations WHERE company_id = ? AND status = 'OPEN' AND deleted_at IS NULL").get(c).n, 'error', '/iam/sod');
    if (has(db, 'iam_elevations')) add('privileged', db.prepare("SELECT COUNT(*) AS n FROM iam_elevations WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(c).n, 'warning', '/iam/elevations');
    add('dormant', db.prepare("SELECT COUNT(*) AS n FROM iam_users WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND COALESCE(last_login_at, created_at) < ?").get(c, daysAgo(90)).n, 'warning', '/iam/users?dormant=90');
    add('failedJobs', db.prepare("SELECT COUNT(*) AS n FROM core_jobs WHERE (company_id = ? OR company_id IS NULL) AND status = 'FAILED' AND created_at >= ?").get(c, daysAgo(7)).n, 'error', '/ops/jobs?status=FAILED');
    add('failedIntegrations', db.prepare("SELECT COUNT(*) AS n FROM core_integration_logs WHERE company_id = ? AND status <> 'success' AND created_at >= ?").get(c, daysAgo(7)).n, 'error', '/admin/connectors');
    const run = db.prepare('SELECT run_id FROM core_integrity_runs ORDER BY id DESC LIMIT 1').get();
    add('integrity', run ? db.prepare('SELECT COUNT(*) AS n FROM core_integrity_runs WHERE run_id = ? AND failures_count > 0').get(run.run_id).n : 0, 'error', '/ops/integrity', { never: !run });
    if (has(db, 'ops_backups')) { const b = db.prepare("SELECT status, finished_at FROM ops_backups WHERE status IN ('VERIFIED', 'COMPLETED', 'FAILED') ORDER BY id DESC LIMIT 1").get(); add('backup', b ? (b.status === 'FAILED' ? 1 : 0) : 1, b?.status === 'FAILED' || !b ? 'error' : 'success', '/admin/backups', { lastAt: b?.finished_at ?? null, lastStatus: b?.status ?? null }); }
    else add('backup', 1, 'error', '/admin/backups', { lastAt: null, lastStatus: null });
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    add('expiries', has(db, 'doc_documents') ? db.prepare("SELECT COUNT(*) AS n FROM doc_documents WHERE company_id = ? AND deleted_at IS NULL AND valid_until IS NOT NULL AND valid_until <= ? AND status <> 'CANCELLED'").get(c, soon).n : 0, 'warning', '/documents?expiring=30');
    if (has(db, 'ai_logs')) { const u = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost), 0) AS p FROM ai_logs WHERE company_id = ? AND created_at >= ?").get(c, `${todayIST().slice(0, 7)}-01`); add('ai', u.n, null, '/ai/features?tab=usage', { costRupees: Math.round(Number(u.p) * 100) / 100 }); }
    add('emergency', db.prepare("SELECT COUNT(*) AS n FROM adm_emergency_actions WHERE company_id = ? AND status = 'PENDING' AND ratify_due < ?").get(c, iso()).n, 'error', '/admin/control?tab=emergency');
    return { metrics: m, readOnly: Boolean(controlRow(c).read_only), myApprovals: engine.awaiting(actor).filter((x) => [CHANGE_TYPE, RATIFY_TYPE].includes(x.type)).length, environment };
  }
  /** FR-04: what a company still needs before go-live, each step checked against its owner's records. */
  function onboarding(actor, companyId) {
    guard(actor, 'adm.onboarding.run');
    const cid = Number(companyId ?? actor.companyId);
    const co = db.prepare('SELECT id, code, legal_name FROM org_companies WHERE id = ?').get(cid); if (!co) throw notFound('That company does not exist.');
    const step = (key, done, route, detail) => ({ key, done: Boolean(done), route, detail });
    const setting = has(db, 'core_company_settings') ? db.prepare('SELECT 1 FROM core_company_settings WHERE company_id = ?').get(cid) : null;
    const fy = has(db, 'core_financial_years') ? db.prepare('SELECT COUNT(*) AS n FROM core_financial_years WHERE company_id = ?').get(cid).n : 0;
    const series = has(db, 'core_number_series') ? db.prepare('SELECT COUNT(*) AS n FROM core_number_series WHERE company_id = ?').get(cid).n : 0;
    const coa = has(db, 'fin_accounts') ? db.prepare('SELECT COUNT(*) AS n FROM fin_accounts WHERE company_id = ?').get(cid).n : has(db, 'gl_accounts') ? db.prepare('SELECT COUNT(*) AS n FROM gl_accounts WHERE company_id = ?').get(cid).n : 0;
    const users = db.prepare("SELECT COUNT(*) AS n FROM iam_users WHERE company_id = ? AND deleted_at IS NULL AND roles_json <> '[]'").get(cid).n;
    const projects = db.prepare('SELECT COUNT(*) AS n FROM org_projects WHERE company_id = ? AND deleted_at IS NULL').get(cid).n;
    const steps = [step('settings', setting, '/core/company-settings', null), step('financialYear', fy, '/core/financial-years', fy), step('numbering', series, '/core/number-series', series),
      step('chartOfAccounts', coa, '/finance/chart-of-accounts', coa), step('users', users, '/iam/users', users), step('projects', projects, '/org/projects', projects)];
    return { company: { id: co.id, code: co.code, name: co.legal_name }, steps, done: steps.filter((s) => s.done).length, total: steps.length };
  }
  function areas(actor) {
    guard(actor, 'adm.control.view');
    return { FEATURE_FLAG: area.FEATURE_FLAG.list(actor.companyId), PARAMETER: area.PARAMETER.list(actor.companyId).map((p) => ({ ...p, value: norm(p.value), type: parameterRegistry.get(p.key)?.dataType, description: parameterRegistry.get(p.key)?.description })) };
  }

  const svc = { changes, emergencies, snapshots, catalogue, dashboard, onboarding, areas, engine, diffOf };
  services.set(db, svc);
  return svc;
}

// ---------------------------------------------------------------- BR-01 / FR-05: the read-only guard of the request pipeline
const readOnlyCache = new Map();
const ALLOWED = [/^\/admin\/emergency\//, /^\/iam\/auth\//, /^\/iam\/session/, /^\/core\/session/, /^\/core\/client-errors/, /^\/ops\/client-errors/];
/** Refuses every write of a company in read-only mode (423), except the emergency controls themselves and signing in or out. */
export function readOnlyGuard(db) {
  return (req, _res, next) => {
    const c = req.actor?.companyId;
    if (!c || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || ALLOWED.some((re) => re.test(req.path))) return next();
    let hit = readOnlyCache.get(c);
    if (!hit || Date.now() - hit.at > 2000) {
      const on = has(db, 'adm_controls') ? db.prepare('SELECT read_only, read_only_reason FROM adm_controls WHERE company_id = ?').get(c) : null;
      hit = { at: Date.now(), on: Boolean(on?.read_only), reason: on?.read_only_reason ?? null }; readOnlyCache.set(c, hit);
    }
    if (!hit.on) return next();
    return next(new HttpError(423, 'READ_ONLY_MODE', `The ERP is in read-only mode for your company: ${hit.reason ?? 'emergency control'}. Nothing can be saved until an administrator ends it.`));
  };
}
