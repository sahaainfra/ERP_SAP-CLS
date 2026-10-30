import { transaction } from './db.js';
import { conflict, notFound, badRequest } from './errors.js';

const toBool = (v) => v === 1 || v === true;

function activeRows(db, key) {
  return db
    .prepare('SELECT * FROM core_feature_flags WHERE key = ? AND is_active = 1 AND deleted_at IS NULL')
    .all(key);
}

/**
 * Resolve a flag for a context. Evaluation order (BR-01):
 * project override -> company override -> environment default -> flag default.
 * An undefined flag is OFF.
 */
export function resolveFlag(db, key, { environment, companyId = null, projectId = null }) {
  const rows = activeRows(db, key);
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

export function isEnabled(db, key, context) {
  return resolveFlag(db, key, context).enabled;
}

/** Scope level of a stored row. */
export function levelOf(row) {
  if (row.project_id != null) return 'project';
  if (row.company_id != null) return 'company';
  if (row.environment != null) return 'environment';
  return 'default';
}

const COLUMNS = `id, key, description, default_enabled, environment, company_id, project_id, enabled,
  changed_by, changed_at, version, remarks`;

const escapeLike = (s) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

/** List flag rows. Company/project overrides of other companies are never returned. */
export function listFlags(db, { companyId, q = '', page = 1, pageSize = 25 }) {
  const like = `%${escapeLike(q)}%`;
  const where = `is_active = 1 AND deleted_at IS NULL
    AND (company_id IS NULL OR company_id = :company)
    AND (key LIKE :q ESCAPE '\\' OR COALESCE(description,'') LIKE :q ESCAPE '\\')`;
  const params = { company: companyId ?? -1, q: like };
  const total = db.prepare(`SELECT COUNT(*) AS n FROM core_feature_flags WHERE ${where}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM core_feature_flags WHERE ${where}
       ORDER BY key, COALESCE(environment,''), COALESCE(company_id,0), COALESCE(project_id,0)
       LIMIT :limit OFFSET :offset`,
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
  return {
    data: rows.map((r) => ({
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
    })),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

function findScopeRow(db, key, scope) {
  return db
    .prepare(
      `SELECT * FROM core_feature_flags
       WHERE key = :key AND COALESCE(environment,'') = :env
         AND COALESCE(company_id,0) = :company AND COALESCE(project_id,0) = :project
         AND is_active = 1 AND deleted_at IS NULL`,
    )
    .get({
      key,
      env: scope.environment ?? '',
      company: scope.companyId ?? 0,
      project: scope.projectId ?? 0,
    });
}

/**
 * Set a flag value at a scope. Runs in one transaction with the audit entry and the
 * outbox event `core.feature_flag.changed`. Updating an existing row needs the current
 * version (409 on mismatch); the first override at a scope creates the row.
 */
export function setFlag(db, { key, scope, enabled, reason, version, actor, correlationId }) {
  return transaction(db, () => {
    const base = findScopeRow(db, key, {});
    if (!base) throw notFound(`Feature flag ${key} is not defined. Flags are created by a reference-seed migration.`);
    const row = findScopeRow(db, key, scope);
    const now = new Date().toISOString();
    let saved;
    let oldValues = null;
    if (row) {
      if (version === undefined || version !== row.version) {
        throw conflict(
          `${key} was changed by someone else (you have version ${version ?? 'none'}, current is ${row.version}). Refresh the list and try again.`,
          [{ field: 'version', message: `current version is ${row.version}` }],
        );
      }
      oldValues = { enabled: toBool(row.enabled), version: row.version };
      db.prepare(
        `UPDATE core_feature_flags SET enabled = :enabled, changed_by = :actor, changed_at = :now,
           updated_by = :actor, updated_at = :now, version = version + 1, remarks = :reason WHERE id = :id`,
      ).run({ enabled: enabled ? 1 : 0, actor, now, reason, id: row.id });
      saved = db.prepare('SELECT * FROM core_feature_flags WHERE id = ?').get(row.id);
    } else {
      if (scope.level === 'default') throw badRequest('The default row of a flag always exists and cannot be created.');
      const res = db
        .prepare(
          `INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, project_id,
             enabled, changed_by, changed_at, created_by, remarks)
           VALUES (:key, :description, :defaultEnabled, :env, :company, :project, :enabled, :actor, :now, :actor, :reason)`,
        )
        .run({
          key,
          description: base.description,
          defaultEnabled: base.default_enabled,
          env: scope.environment ?? null,
          company: scope.companyId ?? null,
          project: scope.projectId ?? null,
          enabled: enabled ? 1 : 0,
          actor,
          now,
          reason,
        });
      saved = db.prepare('SELECT * FROM core_feature_flags WHERE id = ?').get(res.lastInsertRowid);
    }
    if (scope.level === 'default') {
      // The base row's enabled value is the flag's default value.
      db.prepare('UPDATE core_feature_flags SET default_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, saved.id);
    }
    const newValues = { enabled: toBool(saved.enabled), version: saved.version };
    const entityId = String(saved.id);
    db.prepare(
      `INSERT INTO core_audit_log (entity, entity_id, action, old_values, new_values, reason, actor, correlation_id)
       VALUES ('core_feature_flags', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entityId,
      row ? 'update' : 'create',
      oldValues && JSON.stringify(oldValues),
      JSON.stringify(newValues),
      reason,
      actor,
      correlationId ?? null,
    );
    db.prepare('INSERT INTO core_outbox (event_type, aggregate_id, payload) VALUES (?, ?, ?)').run(
      'core.feature_flag.changed',
      entityId,
      JSON.stringify({
        key,
        level: scope.level,
        environment: scope.environment ?? null,
        companyId: scope.companyId ?? null,
        projectId: scope.projectId ?? null,
        enabled: toBool(saved.enabled),
        by: actor,
      }),
    );
    return saved;
  });
}
