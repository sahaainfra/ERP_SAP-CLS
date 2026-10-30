import { transaction } from '../../../platform/db/index.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { pageResponse } from '../../../platform/pagination/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { badRequest, forbidden, notFound } from '../../../platform/http/errors.js';
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
    set(actor, key, { scope, enabled, reason, version }, correlationId) {
      assertPermission(actor, 'core.flag.configure');
      if ((scope.level === 'company' || scope.level === 'project') && scope.companyId !== actor.companyId) {
        throw forbidden('You can only change overrides for your own company.');
      }
      return setFlagRow(db, repo, {
        key,
        scope: {
          level: scope.level,
          environment: scope.level === 'environment' ? scope.environment : undefined,
          companyId: scope.companyId,
          projectId: scope.projectId,
        },
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
export const resolveFlag = (db, key, context) => resolveWith(createFlagRepository(db), key, context);
export const isEnabled = (db, key, context) => resolveFlag(db, key, context).enabled;
export const setFlag = (db, opts) => setFlagRow(db, createFlagRepository(db), opts);
