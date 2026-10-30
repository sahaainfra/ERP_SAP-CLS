import { likePattern, orderBySql } from '../../../platform/pagination/index.js';
import { updateVersioned } from '../../../platform/db/repository.js';

// The columns a client may sort by, mapped to SQL expressions (allow-list: nothing else reaches ORDER BY).
const SORT_COLUMNS = { key: 'key', environment: "COALESCE(environment, '')", changed_at: 'changed_at', version: 'version' };
const STABLE_ORDER = "key, COALESCE(environment, ''), COALESCE(company_id, 0), COALESCE(project_id, 0)";
const COLUMNS = `id, key, description, default_enabled, environment, company_id, project_id, enabled,
  changed_by, changed_at, version, remarks`;

/** Data access for core_feature_flags. No business rules here: the service decides, this only reads and writes. */
export function createFlagRepository(db) {
  return {
    activeRows(key) {
      return db.prepare('SELECT * FROM core_feature_flags WHERE key = ? AND is_active = 1 AND deleted_at IS NULL').all(key);
    },

    findScopeRow(key, scope) {
      return db
        .prepare(
          `SELECT * FROM core_feature_flags
           WHERE key = :key AND COALESCE(environment,'') = :env
             AND COALESCE(company_id,0) = :company AND COALESCE(project_id,0) = :project
             AND is_active = 1 AND deleted_at IS NULL`,
        )
        .get({ key, env: scope.environment ?? '', company: scope.companyId ?? 0, project: scope.projectId ?? 0 });
    },

    getById(id) {
      return db.prepare('SELECT * FROM core_feature_flags WHERE id = ?').get(id);
    },

    /** Company and project overrides of other companies are never returned. */
    listPage({ companyId, q, sort, filters, limit, offset }) {
      let where = `is_active = 1 AND deleted_at IS NULL
        AND (company_id IS NULL OR company_id = :company)
        AND (key LIKE :q ESCAPE '\\' OR COALESCE(description,'') LIKE :q ESCAPE '\\')`;
      const params = { company: companyId ?? -1, q: likePattern(q) };
      if (filters.environment) {
        where += ' AND environment = :environment';
        params.environment = filters.environment;
      }
      if (filters.key) {
        where += ' AND key = :key';
        params.key = filters.key;
      }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_feature_flags WHERE ${where}`).get(params).n;
      const order = orderBySql(sort, SORT_COLUMNS, STABLE_ORDER) || `ORDER BY ${STABLE_ORDER}`;
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM core_feature_flags WHERE ${where} ${order} LIMIT :limit OFFSET :offset`)
        .all({ ...params, limit, offset });
      return { rows, total };
    },

    insertOverride({ key, description, defaultEnabled, scope, enabled, actor, now, reason }) {
      const res = db
        .prepare(
          `INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, project_id,
             enabled, changed_by, changed_at, created_by, remarks)
           VALUES (:key, :description, :defaultEnabled, :env, :company, :project, :enabled, :actor, :now, :actor, :reason)`,
        )
        .run({
          key,
          description,
          defaultEnabled,
          env: scope.environment ?? null,
          company: scope.companyId ?? null,
          project: scope.projectId ?? null,
          enabled: enabled ? 1 : 0,
          actor,
          now,
          reason,
        });
      return Number(res.lastInsertRowid);
    },

    /** Optimistic update; false when the row's version moved on. */
    updateEnabled(id, version, { enabled, actor, now, reason }) {
      return updateVersioned(db, 'core_feature_flags', id, version, { enabled: enabled ? 1 : 0, changed_by: actor, changed_at: now, remarks: reason }, { actor, now: new Date(now) });
    },

    setDefaultEnabled(id, enabled) {
      db.prepare('UPDATE core_feature_flags SET default_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    },
  };
}
