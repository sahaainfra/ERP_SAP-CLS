/** Data access for core_document_types, core_number_series, core_number_counters and core_number_issues. */
export function createNumberingRepository(db) {
  return {
    // ---- document types (installation-wide registry) ----
    docTypes: () => db.prepare('SELECT * FROM core_document_types WHERE is_active = 1 AND deleted_at IS NULL ORDER BY module, code').all(),
    docTypeByCode: (code) => db.prepare('SELECT * FROM core_document_types WHERE code = ? AND deleted_at IS NULL').get(code),
    docTypeById: (id) => db.prepare('SELECT * FROM core_document_types WHERE id = ? AND deleted_at IS NULL').get(id),
    insertDocType(v, actor) {
      const res = db
        .prepare(
          `INSERT INTO core_document_types (code, name, module, template_id, workflow_code, retention_class, statutory, assign_at, created_by, source_type)
           VALUES (:code, :name, :module, :templateId, :workflowCode, :retentionClass, :statutory, :assignAt, :actor, 'document_type')`,
        )
        .run({ code: v.code, name: v.name, module: v.module, templateId: v.templateId, workflowCode: v.workflowCode, retentionClass: v.retentionClass, statutory: v.statutory ? 1 : 0, assignAt: v.assignAt, actor });
      return Number(res.lastInsertRowid);
    },
    updateDocType(id, version, v, actor, now) {
      const res = db
        .prepare(
          `UPDATE core_document_types SET name = :name, template_id = :templateId, workflow_code = :workflowCode, retention_class = :retentionClass,
             statutory = :statutory, assign_at = :assignAt, is_active = :isActive, updated_by = :actor, updated_at = :now, version = version + 1
           WHERE id = :id AND version = :version`,
        )
        .run({ name: v.name, templateId: v.templateId, workflowCode: v.workflowCode, retentionClass: v.retentionClass, statutory: v.statutory ? 1 : 0, assignAt: v.assignAt, isActive: v.isActive ? 1 : 0, id, version, actor, now });
      return Number(res.changes) === 1;
    },
    docTypeUsed: (docTypeId) => Boolean(db.prepare('SELECT 1 FROM core_number_issues WHERE doc_type_id = ? LIMIT 1').get(docTypeId)),

    // ---- series ----
    seriesList(companyId, docTypeId) {
      return db
        .prepare(
          `SELECT s.*, t.code AS doc_type_code FROM core_number_series s JOIN core_document_types t ON t.id = s.doc_type_id
           WHERE s.company_id = :c AND s.is_active = 1 AND s.deleted_at IS NULL AND (:d IS NULL OR s.doc_type_id = :d) ORDER BY t.code, s.id`,
        )
        .all({ c: companyId, d: docTypeId ?? null });
    },
    seriesById: (id, companyId) => db.prepare('SELECT s.*, t.code AS doc_type_code FROM core_number_series s JOIN core_document_types t ON t.id = s.doc_type_id WHERE s.id = ? AND s.company_id = ? AND s.deleted_at IS NULL').get(id, companyId),
    /** The most specific active series for a company, document type, branch and project. */
    findSeries(companyId, docTypeId, branchCode, projectId) {
      return db
        .prepare(
          `SELECT * FROM core_number_series
           WHERE company_id = :c AND doc_type_id = :d AND is_active = 1 AND deleted_at IS NULL
             AND (branch_code IS NULL OR branch_code = :b) AND (project_id IS NULL OR project_id = :p)
           ORDER BY (project_id IS NOT NULL) DESC, (branch_code IS NOT NULL) DESC LIMIT 1`,
        )
        .get({ c: companyId, d: docTypeId, b: branchCode, p: projectId });
    },
    seriesScopeTaken: (companyId, docTypeId, branchCode, projectId, exceptId = 0) =>
      Boolean(
        db
          .prepare("SELECT 1 FROM core_number_series WHERE company_id = ? AND doc_type_id = ? AND COALESCE(branch_code, '') = ? AND COALESCE(project_id, 0) = ? AND id <> ? AND is_active = 1")
          .get(companyId, docTypeId, branchCode ?? '', projectId ?? 0, exceptId),
      ),
    insertSeries(companyId, v, actor) {
      const res = db
        .prepare(
          `INSERT INTO core_number_series (company_id, doc_type_id, branch_code, project_id, name, prefix, format, gap_free, reset_rule, seq_start, created_by, source_type)
           VALUES (:companyId, :docTypeId, :branchCode, :projectId, :name, :prefix, :format, :gapFree, :resetRule, :seqStart, :actor, 'number_series')`,
        )
        .run({ companyId, docTypeId: v.docTypeId, branchCode: v.branchCode ?? null, projectId: v.projectId ?? null, name: v.name, prefix: v.prefix, format: v.format, gapFree: v.gapFree ? 1 : 0, resetRule: v.resetRule, seqStart: v.seqStart, actor });
      return Number(res.lastInsertRowid);
    },
    updateSeries(id, version, v, actor, now) {
      const res = db
        .prepare(
          `UPDATE core_number_series SET branch_code = :branchCode, project_id = :projectId, name = :name, prefix = :prefix, format = :format, gap_free = :gapFree,
             reset_rule = :resetRule, seq_start = :seqStart, is_active = :isActive, updated_by = :actor, updated_at = :now, version = version + 1
           WHERE id = :id AND version = :version`,
        )
        .run({ branchCode: v.branchCode ?? null, projectId: v.projectId ?? null, name: v.name, prefix: v.prefix, format: v.format, gapFree: v.gapFree ? 1 : 0, resetRule: v.resetRule, seqStart: v.seqStart, isActive: v.isActive ? 1 : 0, id, version, actor, now });
      return Number(res.changes) === 1;
    },
    seriesUsed: (seriesId) => Boolean(db.prepare('SELECT 1 FROM core_number_issues WHERE series_id = ? LIMIT 1').get(seriesId) || db.prepare('SELECT 1 FROM core_number_counters WHERE series_id = ? LIMIT 1').get(seriesId)),
    issuedCount: (seriesId) => db.prepare('SELECT COUNT(*) AS n FROM core_number_issues WHERE series_id = ?').get(seriesId).n,

    // ---- counters and issued numbers ----
    peek: (seriesId, periodKey) => db.prepare('SELECT next_value FROM core_number_counters WHERE series_id = ? AND period_key = ?').get(seriesId, periodKey)?.next_value ?? null,
    /** Take the next sequence value: one statement, so it is atomic inside the caller's transaction. */
    take(seriesId, periodKey, start) {
      const row = db
        .prepare(
          `INSERT INTO core_number_counters (series_id, period_key, next_value) VALUES (?, ?, ?)
           ON CONFLICT (series_id, period_key) DO UPDATE SET next_value = next_value + 1 RETURNING next_value`,
        )
        .get(seriesId, periodKey, start + 1);
      return row.next_value - 1;
    },
    insertIssue(i, actor) {
      db.prepare(
        `INSERT INTO core_number_issues (company_id, series_id, doc_type_id, period_key, seq, number, status, ref_type, ref_id, project_id, created_by, source_type)
         VALUES (:companyId, :seriesId, :docTypeId, :periodKey, :seq, :number, 'ISSUED', :refType, :refId, :projectId, :actor, 'number_issue')`,
      ).run({ ...i, actor });
    },
    cancelIssue(companyId, docTypeId, number, actor, now) {
      const res = db
        .prepare("UPDATE core_number_issues SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND doc_type_id = ? AND number = ? AND status = 'ISSUED'")
        .run(actor, now, companyId, docTypeId, number);
      return Number(res.changes) === 1;
    },
    recentIssues(companyId, seriesId, limit, offset) {
      const where = 'company_id = :c AND (:s IS NULL OR series_id = :s)';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_number_issues WHERE ${where}`).get({ c: companyId, s: seriesId ?? null }).n;
      const rows = db.prepare(`SELECT * FROM core_number_issues WHERE ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all({ c: companyId, s: seriesId ?? null, limit, offset });
      return { rows, total };
    },
  };
}
