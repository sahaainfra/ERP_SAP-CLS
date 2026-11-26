import { transaction } from '../../../platform/db/index.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { pageResponse } from '../../../platform/pagination/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { badRequest, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { createFlagRepository } from './repository.js';

const toBool = (v) => v === 1 || v === true;

/** Scope level of a stored row. */
export function levelOf(row) {
  if (row.project_id != null) return 'project';
  if (row.company_id != null) return 'company';
  if (row.environment != null) return 'environment';
  return 'default';
}

/**
 * Resolve a flag for a context. Evaluation order (BR-01 of part 00.02):
 * project override -> company override -> environment default -> flag default. An undefined flag is OFF.
 */
export function resolveWith(repo, key, { environment, companyId = null, projectId = null }) {
  const rows = repo.activeRows(key);
  if (rows.length === 0) return { enabled: false, source: 'undefined' };
  const find = (pred) => rows.find(pred);
  if (companyId != null && projectId != null) {
    const r = find((x) => x.environment == null && x.company_id === companyId && x.project_id === projectId);
    if (r) return { enabled: toBool(r.enabled), source: 'project' };
  }
  if (companyId != null) {
    const r = find((x) => x.environment == null && x.company_id === companyId && x.project_id == null);
    if (r) return { enabled: toBool(r.enabled), source: 'company' };
  }
  const env = find((x) => x.environment === environment && x.company_id == null && x.project_id == null);
  if (env) return { enabled: toBool(env.enabled), source: 'environment' };
  const base = find((x) => x.environment == null && x.company_id == null && x.project_id == null);
  return { enabled: base ? toBool(base.default_enabled) : false, source: 'default' };
}

const present = (r) => ({
  id: r.id,
  key: r.key,
  description: r.description,
  level: levelOf(r),
  environment: r.environment,
  companyId: r.company_id,
  projectId: r.project_id,
  enabled: toBool(r.enabled),
  defaultEnabled: toBool(r.default_enabled),
  changedBy: r.changed_by,
  changedAt: r.changed_at,
  version: r.version,
  remarks: r.remarks,
});

/**
 * Feature-flag service. All business rules and the permission and data-scope guards live here, so jobs,
 * imports and other modules calling the service are protected exactly like HTTP requests.
 */
export function createFlagService({ db, environment }) {
  const repo = createFlagRepository(db);

  return {
    /** List flag rows visible to the actor's company. */
    list(actor, query) {
      assertPermission(actor, 'core.flag.view');
      const { rows, total } = repo.listPage({ companyId: actor.companyId, ...query });
      return pageResponse(rows.map(present), total, query);
    },

    /** Is a flag ON for the actor's company? For other services that ship a capability behind a flag. */
    isOn(actor, key) {
      return resolveWith(repo, key, { environment, companyId: actor.companyId, projectId: null }).enabled;
    },

    /** Evaluate flags for the actor's own company (any signed-in user). */
    evaluate(actor, { keys, companyId, projectId }) {
      const company = companyId ?? actor.companyId;
      if (company != null && company !== actor.companyId) throw forbidden('You can only evaluate flags for your own company.');
      return Object.fromEntries(keys.map((k) => [k, resolveWith(repo, k, { environment, companyId: company, projectId: projectId ?? null }).enabled]));
    },

    /** Set a flag at a scope. Audit entry and outbox event are written in the same transaction. */
    set(actor, key, { scope: given, enabled, reason, version }, correlationId) {
      assertPermission(actor, 'core.flag.configure');
      // Only the fields of the chosen level count: a stray companyId on an environment or default change must never reach another company's row.
      const scope = {
        level: given.level,
        environment: given.level === 'environment' ? given.environment : undefined,
        companyId: given.level === 'company' || given.level === 'project' ? given.companyId : undefined,
        projectId: given.level === 'project' ? given.projectId : undefined,
      };
      // part 29.01, BR-01: once the control center is on for the company, its flags change only through an approved change request
      if (['company', 'project'].includes(scope.level) && resolveWith(repo, 'ff.admin.p2901', { environment, companyId: actor.companyId }).enabled) {
        throw unprocessable('Feature flags of this company are changed through the Enterprise Control Center: raise a change request there for a checker to approve.');
      }
      if ((scope.level === 'company' || scope.level === 'project') && scope.companyId !== actor.companyId) {
        throw forbidden('You can only change overrides for your own company.');
      }
      // Audit AUD-DEF-009 / D-002: in staging and production a flag change is a configuration change, maker-checker by the approval reference
      // (part 29.01: SYSADM -> ITADM; financial and security modules -> CFO or DIR too). It is recorded and applied when approved.
      if (MAKER_CHECKER_ENVIRONMENTS.includes(environment)) return { pending: true, request: requestChange(db, repo, actor, key, { scope, enabled, reason }) };
      return setFlagRow(db, repo, {
        key,
        scope,
        enabled,
        reason,
        version,
        actor: actor.user,
        companyId: actor.companyId,
        correlationId,
      });
    },
  };
}

function setFlagRow(db, repo, { key, scope, enabled, reason, version, actor, correlationId, companyId = null }) {
  return transaction(db, () => {
    const base = repo.findScopeRow(key, {});
    if (!base) throw notFound(`Feature flag ${key} is not defined. Flags are created by a reference-seed migration.`);
    const row = repo.findScopeRow(key, scope);
    const now = new Date().toISOString();
    let savedId;
    let oldValues = null;
    if (row) {
      assertVersion(row.version, version, key, 'Refresh the list and try again.');
      oldValues = { enabled: toBool(row.enabled), version: row.version };
      if (!repo.updateEnabled(row.id, row.version, { enabled, actor, now, reason })) {
        assertVersion(row.version + 1, version, key, 'Refresh the list and try again.');
      }
      savedId = row.id;
    } else {
      if (scope.level === 'default') throw badRequest('The default row of a flag always exists and cannot be created.');
      savedId = repo.insertOverride({ key, description: base.description, defaultEnabled: base.default_enabled, scope, enabled, actor, now, reason });
    }
    if (scope.level === 'default') repo.setDefaultEnabled(savedId, enabled); // the base row's value is the flag's default
    const saved = repo.getById(savedId);
    writeAudit(db, {
      entity: 'core_feature_flags',
      entityId: saved.id,
      action: row ? 'update' : 'create',
      oldValues,
      newValues: { enabled: toBool(saved.enabled), version: saved.version },
      reason,
      actor,
      correlationId,
    });
    publishEvent(db, {
      type: 'core.feature_flag.changed',
      entity: 'feature_flag',
      entityId: saved.id,
      version: saved.version,
      actorId: actor,
      companyId,
      data: {
        key,
        level: scope.level,
        environment: scope.environment ?? null,
        companyId: scope.companyId ?? null,
        projectId: scope.projectId ?? null,
        enabled: toBool(saved.enabled),
      },
    });
    return saved;
  });
}

// Entry points for callers that already hold a database handle and have done their own authorisation
// (golden-output runners, seeds, other services). They skip the actor guards by design.
// ---- maker-checker of flag changes (audit AUD-DEF-009, D-002) -------------------------------------------------------------------------------
// The approval reference (07, part 29.01) and the role catalogue (06, SYSADM) make a configuration change maker-checker: SYSADM proposes,
// ITADM approves, and a change in a financial or security area also needs the CFO or a director. It is kept in this module, not in the
// workflow engine, because that engine is itself switched on by a flag (ff.eng.p0401): a flag change must never wait on a flag.
/** The environments in which a flag change waits for its checkers. Development and test change at once (audited), so suites can set flags. */
export const MAKER_CHECKER_ENVIRONMENTS = Object.freeze(['staging', 'production']);
const FINANCIAL_MODULES = new Set(['fin', 'pay', 'bud', 'bill', 'ctr', 'ap', 'ar', 'pmt', 'cash']);
const SECURITY_MODULES = new Set(['iam', 'sec', 'admin']);
/** The area of a flag from its module (ff.<module>.<feature>): a financial or security flag needs a CFO or director as a second checker. */
export const flagArea = (key) => { const m = /^ff\.([a-z0-9]+)\./.exec(key)?.[1] ?? ''; return FINANCIAL_MODULES.has(m) ? 'FINANCIAL' : SECURITY_MODULES.has(m) ? 'SECURITY' : 'GENERAL'; };
const changeView = (r) => ({ id: r.id, docNo: r.doc_no, key: r.flag_key, level: r.scope_level, environment: r.scope_environment, companyId: r.scope_company_id, projectId: r.scope_project_id, enabled: r.enabled === 1, area: r.area, reason: r.reason, status: r.status, requestedBy: r.requested_by, requestedAt: r.created_at, firstApprovedBy: r.first_approved_by, decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.decision_note, version: r.version });
const rolesOf = (actor) => (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
const sameUser = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

function requestChange(db, repo, actor, key, { scope, enabled, reason }) {
  if (!repo.findScopeRow(key, {})) throw notFound(`Feature flag ${key} is not defined. Flags are created by a reference-seed migration.`);
  // a flag's default holds for every company: one company's maker and checker do not change it (a reference-seed migration does)
  if (scope.level === 'default') throw badRequest('A flag\'s default applies to every company, so it is changed by a reference-seed migration, not by a change request. Request a company or project override instead.');
  const open = db.prepare("SELECT doc_no FROM core_flag_changes WHERE company_id = ? AND flag_key = ? AND scope_level = ? AND COALESCE(scope_environment, '') = ? AND COALESCE(scope_company_id, 0) = ? AND COALESCE(scope_project_id, 0) = ? AND status = 'PENDING' AND deleted_at IS NULL")
    .get(actor.companyId, key, scope.level, scope.environment ?? '', scope.companyId ?? 0, scope.projectId ?? 0);
  if (open) throw unprocessable(`A change of ${key} at this scope is already waiting for approval (${open.doc_no}).`);
  return transaction(db, () => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM core_flag_changes WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
    const docNo = `FLG/${String(n).padStart(5, '0')}`; const area = flagArea(key);
    const id = Number(db.prepare("INSERT INTO core_flag_changes (company_id, doc_no, flag_key, scope_level, scope_environment, scope_company_id, scope_project_id, enabled, area, reason, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 'api')")
      .run(actor.companyId, docNo, key, scope.level, scope.level === 'environment' ? scope.environment : null, scope.companyId ?? null, scope.projectId ?? null, enabled ? 1 : 0, area, reason, actor.user, actor.user).lastInsertRowid);
    writeAudit(db, { companyId: actor.companyId, entity: 'core_flag_changes', entityId: String(id), action: 'request', actor: actor.user, reason, newValues: { key, scope, enabled, area } });
    return changeView(db.prepare('SELECT * FROM core_flag_changes WHERE id = ?').get(id));
  });
}

/** The checks of a change of the actor's company: list, approve or reject (core.flag.approve, never one's own), cancel (the requester). */
export function createFlagChanges({ db }) {
  const rowOf = (actor, id) => { const r = db.prepare('SELECT * FROM core_flag_changes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That flag change does not exist.'); return r; };
  const close = (r, actor, status, note) => {
    const now = new Date().toISOString();
    db.prepare('UPDATE core_flag_changes SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, now, note ?? null, actor.user, now, r.id);
    writeAudit(db, { companyId: r.company_id, entity: 'core_flag_changes', entityId: String(r.id), action: status.toLowerCase(), actor: actor.user, reason: note ?? undefined, newValues: { status } });
  };
  return {
    list(actor, { status = null } = {}) {
      assertPermission(actor, 'core.flag.view');
      const rows = db.prepare(`SELECT * FROM core_flag_changes WHERE company_id = ? AND deleted_at IS NULL ${status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT 100`).all(...[actor.companyId, ...(status ? [status] : [])]);
      return rows.map(changeView);
    },
    decide(actor, id, { decision, note }) {
      assertPermission(actor, 'core.flag.approve');
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (r.status !== 'PENDING') throw unprocessable(`${r.doc_no} is ${r.status.toLowerCase()}: it is not decided again.`);
        if (sameUser(r.requested_by, actor.user)) throw forbidden('You asked for this change: somebody else approves or rejects it.');
        if (r.first_approved_by && sameUser(r.first_approved_by, actor.user)) throw forbidden('You approved this change already: a different person gives the second approval.');
        if (decision === 'REJECT') { if (!note) throw badRequest('Say why the change is rejected.'); close(r, actor, 'REJECTED', note); return changeView(rowOf(actor, id)); }
        const roles = rolesOf(actor); const twoStep = r.area !== 'GENERAL';
        // the first (or only) approval is the IT administrator's (part 29.01: SYSADM -> ITADM); the CFO and directors give only the second
        if (!r.first_approved_by && !roles.includes('ITADM')) throw forbidden('An IT administrator approves a flag change first.');
        // the second approval of a financial or security flag is the CFO's or a director's; the first is the IT administrator's
        if (twoStep && r.first_approved_by && !roles.some((x) => ['CFO', 'DIR'].includes(x))) throw forbidden(`A ${r.area.toLowerCase()} flag is approved a second time by the CFO or a director.`);
        if (twoStep && !r.first_approved_by) {
          const now = new Date().toISOString();
          db.prepare('UPDATE core_flag_changes SET first_approved_by = ?, first_approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, now, actor.user, now, r.id);
          writeAudit(db, { companyId: r.company_id, entity: 'core_flag_changes', entityId: String(r.id), action: 'first_approval', actor: actor.user, reason: note ?? undefined });
          return changeView(rowOf(actor, id));
        }
        const repo = createFlagRepository(db);
        const scope = { level: r.scope_level, environment: r.scope_level === 'environment' ? r.scope_environment : undefined, companyId: r.scope_company_id ?? undefined, projectId: r.scope_project_id ?? undefined };
        const current = repo.findScopeRow(r.flag_key, scope);
        const approvers = [r.first_approved_by, actor.user].filter(Boolean).join(' and ');
        setFlagRow(db, repo, { key: r.flag_key, scope, enabled: r.enabled === 1, reason: `${r.reason} (${r.doc_no}, requested by ${r.requested_by}, approved by ${approvers})`, version: current?.version, actor: actor.user, companyId: r.company_id, correlationId: null });
        close(r, actor, 'APPLIED', note);
        return changeView(rowOf(actor, id));
      });
    },
    cancel(actor, id, { reason }) {
      assertPermission(actor, 'core.flag.configure');
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (r.status !== 'PENDING') throw unprocessable(`${r.doc_no} is ${r.status.toLowerCase()}.`);
        if (!sameUser(r.requested_by, actor.user)) throw forbidden('Only the person who asked for the change cancels it.');
        close(r, actor, 'CANCELLED', reason); return changeView(rowOf(actor, id));
      });
    },
  };
}

export const resolveFlag = (db, key, context) => resolveWith(createFlagRepository(db), key, context);
export const isEnabled = (db, key, context) => resolveFlag(db, key, context).enabled;
export const setFlag = (db, opts) => setFlagRow(db, createFlagRepository(db), opts);
