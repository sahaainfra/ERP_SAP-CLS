import { authzOf } from '../../platform/authz/index.js';
import { companyScope } from '../../platform/db/scope.js';
import { createFrom } from '../../platform/forms/index.js';
import { notFound } from '../../platform/http/errors.js';
import { lookupRegistry } from '../../platform/lookups/index.js';

// What forms can look up from the core masters (part 03.02): units of measure (01.06; the UOM master of 06.02 replaces them,
// D-042). And a sample document can start a sample material request (FR-09), its title, date, project and site carried over.
const cid = (actor) => companyScope(actor).params._company_scope;

lookupRegistry.register({
  module: 'core', name: 'uoms', label: 'Units of measure',
  columns: [{ key: 'dimension', label: 'Measures' }],
  search(db, actor, q) {
    const ids = q.ids ? `AND id IN (${q.ids.map(Number).join(',')})` : '';
    const base = `core_uoms WHERE deleted_at IS NULL AND (company_id IS NULL OR company_id = :c) ${ids} AND (code LIKE :q ESCAPE '\\' OR name LIKE :q ESCAPE '\\')`;
    const params = { c: cid(actor), q: q.like };
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${base}`).get(params).n;
    const rows = db.prepare(`SELECT id, code, name, dimension FROM ${base} ORDER BY code LIMIT :limit OFFSET :offset`).all({ ...params, limit: q.limit, offset: q.offset });
    return { total, rows: rows.map((u) => ({ id: u.id, code: u.code, name: u.name, extra: { dimension: u.dimension ?? '' } })) };
  },
});

createFrom.register({
  target: 'ui.sample_request', source: 'core.sample_document', label: 'Sample document', permission: 'core.sample.use',
  prefill(db, actor, sourceId) {
    const d = db.prepare('SELECT id, company_id, project_id, site_id, doc_no, doc_date, title, status FROM core_sample_documents WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(sourceId, cid(actor));
    if (!d || !authzOf(db).check(actor, 'core.sample.use', { companyId: d.company_id, projectId: d.project_id ?? undefined }).allowed) throw notFound('That sample document does not exist.');
    if (d.status === 'CANCELLED') throw notFound('That sample document is cancelled, so nothing can be started from it.');
    return {
      values: { title: d.title, projectId: d.project_id ?? '', siteId: d.site_id ?? '', sourceType: 'core.sample_document', sourceId: d.id },
      note: `Started from sample document ${d.doc_no ?? `#${d.id}`} dated ${d.doc_date}.`,
    };
  },
});
