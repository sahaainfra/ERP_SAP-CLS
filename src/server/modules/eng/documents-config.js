import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { ROLE_TEMPLATES, authzOf } from '../../platform/authz/index.js';
import { badRequest, conflict, forbidden } from '../../platform/http/errors.js';
import { CONFIG_DOC } from './documents.js';

// Document Types and Folder Templates (part 04.10, section 7.4): the kinds of document a company controls, who reviews and approves each, whether it expires and how long it is kept; and the folder
// trees a project is given. The standard ones are shared; a company may change them or add its own. A change waits for the system administrator or a director.
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));

export function createDocumentConfig({ db, engine, service }) {
  const authz = authzOf(db);
  const may = (actor, key) => authz.check(actor, key, { companyId: actor.companyId }).allowed;
  const countNodes = (nodes, depth = 1) => nodes.reduce((n, x) => n + 1 + (x.children ? countNodes(x.children, depth + 1) : 0), 0);
  const deep = (nodes, depth = 1) => Math.max(depth, ...nodes.map((x) => (x.children?.length ? deep(x.children, depth + 1) : depth)));
  return {
    get(actor) {
      if (!may(actor, 'doc.config.view')) throw forbidden('You may not see the document configuration (permission doc.config.view).');
      const pending = (t) => db.prepare(`SELECT * FROM ${t} WHERE company_id = ? AND status = 'PENDING' AND is_active = 1 ORDER BY id`).all(actor.companyId);
      const pt = pending('doc_types');
      const pf = pending('doc_folder_templates');
      return {
        types: service.types.list(actor.companyId), templates: service.templates.list(actor.companyId),
        pendingTypes: pt.map((r) => ({ code: r.code, name: r.name, approverRole: r.approver_role })), pendingTemplates: pf.map((r) => ({ code: r.code, name: r.name })),
        pendingBatch: pt[0] ?? pf[0] ? { batchId: (pt[0] ?? pf[0]).batch_id, instanceId: (pt[0] ?? pf[0]).instance_id, by: (pt[0] ?? pf[0]).created_by, reason: (pt[0] ?? pf[0]).reason } : null,
        roles: [...ROLE_CODES].sort(), canEdit: may(actor, 'doc.config.edit'),
      };
    },
    propose(actor, b) {
      if (!may(actor, 'doc.config.edit')) throw forbidden('You may not change the document configuration (permission doc.config.edit).');
      const problems = [];
      const seen = new Set();
      b.types.forEach((t, i) => {
        if (seen.has(`t:${t.code}`)) problems.push({ field: `types.${i}.code`, message: `${t.code} is given twice.` });
        seen.add(`t:${t.code}`);
        for (const r of t.reviewerRole.split('|')) if (!ROLE_CODES.has(r)) problems.push({ field: `types.${i}.reviewerRole`, message: `${r} is not a role of the catalogue.` });
        if (!t.requiresReview && t.reviewerRole === '') problems.push({ field: `types.${i}.reviewerRole`, message: 'Name the reviewer role even if review is not asked for.' });
      });
      b.templates.forEach((t, i) => {
        if (seen.has(`f:${t.code}`)) problems.push({ field: `templates.${i}.code`, message: `${t.code} is given twice.` });
        seen.add(`f:${t.code}`);
        if (countNodes(t.tree) > 200) problems.push({ field: `templates.${i}.tree`, message: 'A template has at most 200 folders.' });
        if (deep(t.tree) > 5) problems.push({ field: `templates.${i}.tree`, message: 'Folders go at most five levels deep.' });
        const names = (nodes, path) => { const s = new Set(); for (const n of nodes) { if (s.has(n.name.toLowerCase())) problems.push({ field: `templates.${i}.tree`, message: `${path}${n.name} is given twice.` }); s.add(n.name.toLowerCase()); if (n.children) names(n.children, `${path}${n.name}/`); } };
        names(t.tree, '');
      });
      if (problems.length) throw badRequest('The configuration is not valid.', problems);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM doc_types WHERE company_id = ? AND status = 'PENDING' UNION SELECT 1 FROM doc_folder_templates WHERE company_id = ? AND status = 'PENDING' LIMIT 1").get(actor.companyId, actor.companyId)) throw conflict('A change of the document configuration is already waiting for approval. It must be decided first.');
        const batch = Number(db.prepare('SELECT MAX(b) + 1 AS n FROM (SELECT COALESCE(MAX(batch_id), 0) AS b FROM doc_types UNION ALL SELECT COALESCE(MAX(batch_id), 0) FROM doc_folder_templates)').get().n);
        for (const t of b.types) {
          const v = (db.prepare('SELECT MAX(type_version) AS v FROM doc_types WHERE COALESCE(company_id, 0) IN (0, ?) AND code = ?').get(actor.companyId, t.code).v ?? 0) + 1;
          db.prepare(`INSERT INTO doc_types (company_id, code, name, requires_review, reviewer_role, approver_role, has_validity, default_confidentiality, retention_class, sort_order, type_version, status, batch_id, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'config_change')`)
            .run(actor.companyId, t.code, t.name, t.requiresReview ? 1 : 0, t.reviewerRole, t.approverRole, t.hasValidity ? 1 : 0, t.defaultConfidentiality, t.retentionClass, t.sortOrder ?? 100, v, batch, b.reason, actor.user);
        }
        for (const t of b.templates) {
          const v = (db.prepare('SELECT MAX(template_version) AS v FROM doc_folder_templates WHERE COALESCE(company_id, 0) IN (0, ?) AND code = ?').get(actor.companyId, t.code).v ?? 0) + 1;
          db.prepare("INSERT INTO doc_folder_templates (company_id, code, name, tree_json, template_version, status, batch_id, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'config_change')").run(actor.companyId, t.code, t.name, JSON.stringify(t.tree), v, batch, b.reason, actor.user);
        }
        writeAudit(db, { entity: 'doc_types', entityId: batch, action: 'propose', newValues: { types: b.types.map((t) => t.code), templates: b.templates.map((t) => t.code) }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine.submit(actor, { docType: CONFIG_DOC, docId: batch, comment: b.reason, context: {} });
        db.prepare('UPDATE doc_types SET instance_id = ? WHERE batch_id = ?').run(instance.id, batch);
        db.prepare('UPDATE doc_folder_templates SET instance_id = ? WHERE batch_id = ?').run(instance.id, batch);
        return { batch, workflow: instance };
      });
    },
  };
}
