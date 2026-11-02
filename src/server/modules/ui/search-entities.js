import { objectTypes } from '../../platform/objects/index.js';
import { searchEntities } from '../../platform/search/registry.js';

// Part 03.08: the sample material requests (the reference register of the platform) and the discussion on any record.
const PERMISSION = 'core.sample.use';

searchEntities.register({
  type: 'sample_request', label: 'Sample material requests', labelHi: 'नमूना सामग्री अनुरोध', icon: 'erp.group.supply', order: 75, permission: PERMISSION, table: 'ui_sample_requests', statuses: ['DRAFT', 'SUBMITTED', 'CANCELLED'],
  events: ['ui.sample_request.*'], eventEntity: 'sample_request', dateLabel: 'Request date', secretFields: [{ entity: 'ui_sample_request', field: 'total' }],
  route: (id) => `/admin/sample-requests?open=${id}`,
  load(db, id) {
    const r = db.prepare('SELECT r.*, p.code AS project_code FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id WHERE r.id = ?').get(id);
    if (!r || r.deleted_at !== null || r.is_active !== 1) return null;
    const lines = db.prepare('SELECT description FROM ui_sample_request_lines WHERE request_id = ? ORDER BY id').all(id).map((l) => l.description);
    return {
      companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, departmentId: r.department_id, code: r.doc_no, title: r.title,
      subtitle: [r.doc_no ? null : 'Draft', `Project ${r.project_code}`, r.requested_by, r.priority === 'URGENT' ? 'Urgent' : null].filter(Boolean).join(' · '),
      body: [r.delivery_note, ...lines], status: r.status, docDate: r.doc_date, permissionKey: PERMISSION, secrets: [{ entity: 'ui_sample_request', field: 'total', value: r.total_amount }],
    };
  },
});

searchEntities.register({
  type: 'comment', label: 'Discussions', labelHi: 'चर्चा', icon: 'erp.group.collab', order: 110, permission: PERMISSION, permissionKeys: () => objectTypes.list().map((t) => t.permission), table: 'ui_record_comments', statuses: [],
  events: ['ui.comment.created'], eventEntity: 'comment', scoped: true,
  idFromEvent: (db, event) => db.prepare('SELECT MAX(id) AS id FROM ui_record_comments WHERE entity_type = ? AND entity_id = ?').get(event.entity, Number(event.entityId))?.id ?? null,
  route: (id) => `/admin/sample-requests?comment=${id}`,
  load(db, id) {
    const r = db.prepare('SELECT * FROM ui_record_comments WHERE id = ?').get(id);
    if (!r || r.deleted_at !== null || r.is_active !== 1) return null;
    const type = objectTypes.get(r.entity_type);
    if (!type) return null;
    const text = String(r.body).replace(/\s+/g, ' ').trim();
    return { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, title: text.length > 90 ? `${text.slice(0, 87)}…` : text, subtitle: `${r.author_ref} on ${type.label} ${r.entity_id}`, body: [text], status: null, permissionKey: type.permission, route: type.route ? type.route(r.entity_id) : '/home' };
  },
  access(db, actor, id) {
    const r = db.prepare('SELECT entity_type, entity_id FROM ui_record_comments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    return r && objectTypes.get(r.entity_type)?.access(db, actor, r.entity_id) ? { companyId: actor.companyId } : null;
  },
});
