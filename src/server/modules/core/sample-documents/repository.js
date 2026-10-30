/** Data access for core_sample_documents. */
export function createSampleDocumentRepository(db) {
  return {
    list(companyId, limit, offset) {
      const total = db.prepare('SELECT COUNT(*) AS n FROM core_sample_documents WHERE company_id = ? AND is_active = 1').get(companyId).n;
      const rows = db.prepare('SELECT * FROM core_sample_documents WHERE company_id = ? AND is_active = 1 ORDER BY id DESC LIMIT ? OFFSET ?').all(companyId, limit, offset);
      return { rows, total };
    },
    find: (id, companyId) => db.prepare('SELECT * FROM core_sample_documents WHERE id = ? AND company_id = ? AND is_active = 1').get(id, companyId),
    insert(companyId, v, actor) {
      const res = db
        .prepare("INSERT INTO core_sample_documents (company_id, project_id, doc_date, title, status, created_by, source_type) VALUES (?, ?, ?, ?, 'DRAFT', ?, 'sample_document')")
        .run(companyId, v.projectId ?? null, v.docDate, v.title, actor);
      return Number(res.lastInsertRowid);
    },
    assignPoint: (docTypeCode) => db.prepare('SELECT assign_at FROM core_document_types WHERE code = ?').get(docTypeCode)?.assign_at,
    setNumber: (id, docNo) => db.prepare('UPDATE core_sample_documents SET doc_no = ? WHERE id = ?').run(docNo, id),
    transition(id, version, status, actor, now) {
      const res = db.prepare('UPDATE core_sample_documents SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?').run(status, actor, now, id, version);
      return Number(res.changes) === 1;
    },
  };
}
