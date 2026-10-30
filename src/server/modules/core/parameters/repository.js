/** Data access for core_parameters. Rows are never changed in place: a new value closes the old row and adds a new one. */
export function createParameterRepository(db) {
  const visible = '(company_id IS NULL OR company_id = :c) AND is_active = 1 AND deleted_at IS NULL';
  return {
    list({ companyId, q, key, limit, offset }) {
      const where = `${visible} AND key LIKE :q ESCAPE '\\' AND (:key IS NULL OR key = :key)`;
      const params = { c: companyId, q: q, key: key ?? null };
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_parameters WHERE ${where}`).get(params).n;
      const rows = db
        .prepare(
          `SELECT * FROM core_parameters WHERE ${where}
           ORDER BY key, CASE scope_type WHEN 'system' THEN 0 WHEN 'company' THEN 1 WHEN 'project' THEN 2 ELSE 3 END, scope_id, effective_from DESC
           LIMIT :limit OFFSET :offset`,
        )
        .all({ ...params, limit, offset });
      return { rows, total };
    },
    forScope: (key, scopeType, scopeId) =>
      db.prepare('SELECT * FROM core_parameters WHERE key = ? AND scope_type = ? AND COALESCE(scope_id, 0) = ? AND is_active = 1 ORDER BY effective_from').all(key, scopeType, scopeId ?? 0),
    insert(v, actor) {
      const res = db
        .prepare(
          `INSERT INTO core_parameters (key, value, data_type, scope_type, scope_id, effective_from, effective_to, company_id, created_by, remarks, source_type)
           VALUES (:key, :value, :dataType, :scopeType, :scopeId, :effectiveFrom, :effectiveTo, :companyId, :actor, :reason, 'parameter')`,
        )
        .run({ ...v, actor });
      return Number(res.lastInsertRowid);
    },
    closeRow(id, effectiveTo, actor, now) {
      db.prepare('UPDATE core_parameters SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(effectiveTo, actor, now, id);
    },
  };
}
