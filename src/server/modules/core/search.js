import { objectTypes } from '../../platform/objects/index.js';
import { searchEntities } from '../../platform/search/registry.js';

// Part 03.08: what of the core records can be searched. The sample documents and bills are the reference records of the platform; documents are the
// files attached to any record whose type is registered on the Object Page (a file is as visible as the record it is attached to).
const PERMISSION = 'core.sample.use';
const live = (r) => r && r.is_active === 1 && r.deleted_at === null;

searchEntities.register({
  type: 'sample_document', label: 'Sample documents', labelHi: 'नमूना दस्तावेज़', icon: 'erp.action.document', order: 80, permission: PERMISSION, table: 'core_sample_documents', statuses: ['DRAFT', 'SUBMITTED', 'CANCELLED'],
  events: ['core.sample_document.*'], eventEntity: 'sample_document', dateLabel: 'Document date', route: () => '/admin/sample-documents',
  load(db, id) {
    const r = db.prepare('SELECT * FROM core_sample_documents WHERE id = ?').get(id);
    if (!live(r)) return null;
    return { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, code: r.doc_no, title: r.title, subtitle: r.doc_no ? `Document ${r.doc_no}` : 'Draft', body: [], status: r.status, docDate: r.doc_date, permissionKey: PERMISSION };
  },
});
searchEntities.register({
  type: 'sample_bill', label: 'Bills', labelHi: 'बिल', icon: 'erp.group.finance', order: 90, permission: PERMISSION, table: 'core_sample_bills', statuses: ['DRAFT', 'SUBMITTED'],
  events: ['core.sample_bill.*'], eventEntity: 'sample_bill', route: () => '/admin/sample-bills',
  load(db, id) {
    const r = db.prepare('SELECT * FROM core_sample_bills WHERE id = ?').get(id);
    if (!live(r)) return null;
    return { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, title: r.title, subtitle: `Sample bill ${r.id}`, body: [], status: r.status, permissionKey: PERMISSION };
  },
});

const typeOfFile = (linkedEntity) => objectTypes.list().map((t) => objectTypes.get(t.type)).find((t) => t.attachmentEntity === linkedEntity);
searchEntities.register({
  type: 'document', label: 'Documents', labelHi: 'दस्तावेज़', icon: 'erp.action.attach', order: 100, permission: PERMISSION, permissionKeys: () => objectTypes.list().map((t) => t.permission), table: 'core_files', statuses: ['CLEAN', 'PENDING'],
  events: ['core.file.*'], eventEntity: 'file', route: (id) => `/admin/sample-requests?file=${id}`,
  load(db, id) {
    const r = db.prepare('SELECT * FROM core_files WHERE id = ?').get(id);
    if (!live(r) || r.scan_status === 'INFECTED' || !r.linked_entity || !r.linked_id) return null;
    const type = typeOfFile(r.linked_entity);
    if (!type) return null;
    return { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, title: r.original_name, subtitle: `${r.category ?? 'file'} attached to ${type.label} ${r.linked_id}`, body: [r.extension, r.category], status: r.scan_status, permissionKey: type.permission, route: type.route ? type.route(r.linked_id) : '/home' };
  },
  access(db, actor, id) {
    const r = db.prepare('SELECT linked_entity, linked_id FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    const type = r && typeOfFile(r.linked_entity);
    return type && type.access(db, actor, r.linked_id) ? { companyId: actor.companyId } : null;
  },
});
