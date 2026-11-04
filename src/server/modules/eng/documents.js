import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { ROLE_TEMPLATES, authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { searchEntities } from '../../platform/search/index.js';
import { alertDatasets } from '../../platform/alerts/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { issueNumber } from '../core/numbering/service.js';
import { createNumberSeries } from './documents-series.js';

// The document management service (part 04.10): the register, the revisions, check-out and check-in, the folders of a project, who may see what, sharing, distribution with acknowledgement,
// markups kept as layers, expiry and the approval of a revision. Files go through the file service (01.05) as entity `doc_version`; the page of the register, the viewer and the downloads are in the
// module's routes. Other modules (drawings 11.01, contracts 21.01, HR 07.01, QA and HSE records, the portals) create and read documents through this service.
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));
export const REVISION_DOC = 'DOC_REVISION';
export const CONFIG_DOC = 'DOC_CONFIG';
export const LEVELS = Object.freeze(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
export const DOC_STATUSES = Object.freeze(['DRAFT', 'IN_REVIEW', 'ISSUED', 'ARCHIVED', 'CANCELLED']);
export const levelKey = (c) => (c === 'CONFIDENTIAL' ? 'doc.document.view_confidential' : c === 'RESTRICTED' ? 'doc.document.view_restricted' : 'doc.document.view');
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A, B, ... Z, AA, AB ... for the number of a revision. */
export function revisionName(n) {
  let s = '';
  let k = n;
  while (k > 0) { k -= 1; s = ALPHA[k % 26] + s; k = Math.floor(k / 26); }
  return s;
}
const META_FIELDS = ['title', 'docType', 'discipline', 'confidentiality', 'validUntil', 'wbsRef', 'locationRef', 'folder', 'tags', 'owner', 'retentionClass'];
const META_LABEL = { title: 'Title', docType: 'Type', discipline: 'Discipline', confidentiality: 'Confidentiality', validUntil: 'Valid until', wbsRef: 'WBS', locationRef: 'Location', folder: 'Folder', tags: 'Tags', owner: 'Owner', retentionClass: 'Retention' };

// ---- the approval of a revision ----
const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const cfgStep = step('CHECK', 'System administrator or director', 'SYSADM|DIR');

export function createDocumentService({ db, engine }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const may = (actor, key, scope) => authz.check(actor, key, scope ?? { companyId: actor.companyId }).allowed;
  const today = () => new Date(engine.clock().getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const nowIso = () => engine.clock().toISOString();
  const userRow = (companyId, name) => db.prepare("SELECT username, display_name, email FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1 AND status = 'ACTIVE'").get(companyId, name);
  const nameOf = (companyId, u) => userRow(companyId, u)?.display_name ?? u;
  const holders = (companyId, roles) => db.prepare("SELECT u.username FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 AND u.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN (SELECT value FROM json_each(?))) ORDER BY u.username").all(companyId, JSON.stringify(roles)).map((r) => r.username);

  // ---- types and folder templates (shared rows, then the company's own) ----
  const types = {
    get(companyId, code) {
      return db.prepare("SELECT * FROM doc_types WHERE (company_id = ? OR company_id IS NULL) AND code = ? AND status = 'ACTIVE' AND is_active = 1 ORDER BY company_id IS NULL, type_version DESC LIMIT 1").get(companyId, code);
    },
    list(companyId) {
      const rows = db.prepare("SELECT * FROM doc_types WHERE (company_id = ? OR company_id IS NULL) AND status IN ('ACTIVE') AND is_active = 1 ORDER BY code, company_id IS NULL, type_version DESC").all(companyId);
      const seen = new Set();
      return rows.filter((r) => (seen.has(r.code) ? false : seen.add(r.code))).sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)).map(typeRow);
    },
  };
  const typeRow = (r) => ({ id: r.id, code: r.code, name: r.name, requiresReview: r.requires_review === 1, reviewerRole: r.reviewer_role, approverRole: r.approver_role, hasValidity: r.has_validity === 1, defaultConfidentiality: r.default_confidentiality, retentionClass: r.retention_class, version: r.type_version, shared: r.company_id === null });
  const templates = {
    get(companyId, code) {
      return db.prepare("SELECT * FROM doc_folder_templates WHERE (company_id = ? OR company_id IS NULL) AND code = ? AND status = 'ACTIVE' AND is_active = 1 ORDER BY company_id IS NULL, template_version DESC LIMIT 1").get(companyId, code);
    },
    list(companyId) {
      const rows = db.prepare("SELECT * FROM doc_folder_templates WHERE (company_id = ? OR company_id IS NULL) AND status = 'ACTIVE' AND is_active = 1 ORDER BY code, company_id IS NULL, template_version DESC").all(companyId);
      const seen = new Set();
      return rows.filter((r) => (seen.has(r.code) ? false : seen.add(r.code))).map((r) => ({ id: r.id, code: r.code, name: r.name, tree: JSON.parse(r.tree_json), version: r.template_version, shared: r.company_id === null }));
    },
  };

  // ---- who may see and do what with a document (FR-04) ----
  const sharesOf = (documentId) => db.prepare('SELECT * FROM doc_shares WHERE document_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY id').all(documentId, nowIso());
  const myShare = (actor, d) => {
    const roles = actor.roles ?? [];
    const rows = sharesOf(d.id).filter((s) => (s.principal_type === 'USER' && s.principal_id === actor.user) || (s.principal_type === 'ROLE' && roles.includes(s.principal_id)));
    return { view: rows.length > 0, edit: rows.some((s) => s.permission === 'EDIT') };
  };
  /** { view, edit, manage, owner }: the owner and author always; a share; or the right for the level of confidentiality inside the person's scope. */
  function access(actor, d) {
    if (!actor?.companyId || d.company_id !== actor.companyId) return { view: false, edit: false, manage: false, owner: false };
    const scope = { companyId: d.company_id, projectId: d.project_id ?? undefined, siteId: d.site_id ?? undefined };
    const owner = d.owner_user_ref === actor.user || d.created_by === actor.user;
    const share = myShare(actor, d);
    const level = may(actor, 'doc.document.view', scope) && (d.confidentiality === 'PUBLIC' || d.confidentiality === 'INTERNAL' || may(actor, levelKey(d.confidentiality), scope));
    const view = owner || share.view || level;
    const closed = ['ARCHIVED', 'CANCELLED'].includes(d.status);
    const edit = !closed && (owner || share.edit || (level && may(actor, 'doc.document.create', scope)));
    return { view, edit, manage: view && may(actor, 'doc.document.manage', scope), owner };
  }
  /** The SQL that limits a query of the register to what the person may see (BR-03): the same rules as `access`, so a list, a search and a download agree. */
  function visibleSql(actor, a = 'd') {
    const p = { me: actor.user, now: nowIso() };
    const roles = actor.roles ?? [];
    roles.forEach((r, i) => { p[`r${i}`] = r; });
    const scope = (k) => authz.scopeFilter(actor, k, { project: `${a}.project_id`, site: `${a}.site_id` }).sql;
    const sql = `(${a}.owner_user_ref = :me OR ${a}.created_by = :me OR EXISTS (SELECT 1 FROM doc_shares s WHERE s.document_id = ${a}.id AND s.is_active = 1 AND (s.expires_at IS NULL OR s.expires_at > :now) AND ((s.principal_type = 'USER' AND s.principal_id = :me)${roles.length ? ` OR (s.principal_type = 'ROLE' AND s.principal_id IN (${roles.map((_, i) => `:r${i}`).join(', ')}))` : ''}))
      OR (${scope('doc.document.view')} AND (${a}.confidentiality IN ('PUBLIC', 'INTERNAL') OR (${a}.confidentiality = 'CONFIDENTIAL' AND ${scope('doc.document.view_confidential')}) OR (${a}.confidentiality = 'RESTRICTED' AND ${scope('doc.document.view_restricted')}))))`;
    return { sql, params: p };
  }
  const load = (actor, id, need = 'view') => {
    const d = db.prepare('SELECT * FROM doc_documents WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
    if (!d) throw notFound('That document does not exist.');
    const acc = access(actor, d);
    if (!acc.view) throw notFound('That document does not exist.'); // BR-03: it is not even said to exist
    if (need === 'edit' && !acc.edit) {
      if (['ARCHIVED', 'CANCELLED'].includes(d.status)) throw conflict(`This document is ${d.status.toLowerCase()}; it is read-only.`);
      throw forbidden('You may not change this document.');
    }
    if (need === 'manage' && !acc.manage) throw forbidden('Only the document controller may do that (permission doc.document.manage).');
    return { d, acc };
  };
  const versionOrThrow = (d, versionId) => {
    const v = db.prepare('SELECT * FROM doc_versions WHERE id = ? AND document_id = ? AND is_active = 1').get(versionId, d.id);
    if (!v) throw notFound('That revision does not exist.');
    return v;
  };

  const event = (type, d, actor, extra = {}) => publishEvent(db, { type, entity: 'controlled_document', entityId: d.id, actorId: actor, companyId: d.company_id, projectId: d.project_id ?? null, siteId: d.site_id ?? null, data: { docNo: d.doc_no, status: d.status, revision: d.current_revision, docType: d.doc_type, ...extra } });
  const tell = (d, code, users, data, key, version = null) => {
    const list = [...new Set(users)].filter((u) => u && userRow(d.company_id, u));
    if (!list.length) return;
    notif.notify({ companyId: d.company_id, templateCode: code, recipients: list.map((u) => `user:${u}`), data: { docNo: d.doc_no, title: d.title, revision: version?.revision ?? d.current_revision ?? '', ...data }, link: `/documents/document?id=${d.id}`, projectId: d.project_id, siteId: d.site_id, sourceType: 'document', sourceId: d.id, eventKey: key ?? `doc:${d.id}:${code}:${nowIso()}` });
  };
  const metaOf = (d) => ({ title: d.title, docType: d.doc_type, discipline: d.discipline ?? '', confidentiality: d.confidentiality, validUntil: d.valid_until ?? '', wbsRef: d.wbs_ref ?? '', locationRef: d.location_ref ?? '', folder: d.folder_id ? (db.prepare('SELECT path FROM doc_folders WHERE id = ?').get(d.folder_id)?.path ?? '') : '', tags: JSON.parse(d.tags_json || '[]').join(', '), owner: d.owner_user_ref, retentionClass: d.retention_class });
  const ensureSeries = (companyId, actor) => {
    try { return issueNumber(db, { companyId, docType: 'DMS_DOC', projectId: null, actor }); } catch (e) {
      if (e.code !== 'NUMBER_SERIES_MISSING') throw e;
      createNumberSeries(db, companyId, actor);
      return issueNumber(db, { companyId, docType: 'DMS_DOC', projectId: null, actor });
    }
  };

  // ---- presenting ----
  const versionRow = (v, d) => ({
    id: v.id, revision: v.revision, revisionNo: v.revision_no, status: v.status, changeNote: v.change_note, fileId: v.file_id, current: d.current_version_id === v.id, submittedBy: v.submitted_by, submittedAt: v.submitted_at, approvedAt: v.approved_at, supersededAt: v.superseded_at,
    instanceId: v.instance_id, createdBy: v.created_by, createdAt: v.created_at, file: v.file_id ? fileRow(v.file_id) : null, draftFile: !v.file_id ? draftFile(v.id) : null,
  });
  const fileRow = (id) => { const f = db.prepare('SELECT id, original_name, extension, mime, size_bytes, scan_status, sha256 FROM core_files WHERE id = ?').get(id); return f ? { id: f.id, name: f.original_name, extension: f.extension, mime: f.mime, size: f.size_bytes, scan: f.scan_status, sha256: f.sha256 } : null; };
  const draftFile = (versionId) => { const f = db.prepare("SELECT id, original_name, extension, mime, size_bytes, scan_status, sha256 FROM core_files WHERE linked_entity = 'doc_version' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY id DESC LIMIT 1").get(versionId); return f ? { id: f.id, name: f.original_name, extension: f.extension, mime: f.mime, size: f.size_bytes, scan: f.scan_status, sha256: f.sha256 } : null; };
  const row = (d) => ({
    id: d.id, docNo: d.doc_no, title: d.title, docType: d.doc_type, typeName: types.get(d.company_id, d.doc_type)?.name ?? d.doc_type, discipline: d.discipline, folderId: d.folder_id, wbsRef: d.wbs_ref, locationRef: d.location_ref, revision: d.current_revision, status: d.status,
    confidentiality: d.confidentiality, owner: d.owner_user_ref, retentionClass: d.retention_class, validUntil: d.valid_until, tags: JSON.parse(d.tags_json || '[]'), projectId: d.project_id, siteId: d.site_id, checkedOutBy: d.checked_out_by, checkedOutAt: d.checked_out_at, checkoutNote: d.checkout_note,
    currentVersionId: d.current_version_id, createdBy: d.created_by, createdAt: d.created_at, updatedAt: d.updated_at ?? d.created_at, version: d.version, daysToExpiry: d.valid_until ? Math.round((Date.parse(d.valid_until) - Date.parse(today())) / 86_400_000) : null,
  });

  const documents = {
    list(actor, q = {}) {
      const vis = visibleSql(actor);
      /** @type {Record<string, any>} */
      const p = { ...vis.params, c: actor.companyId };
      const where = ['d.company_id = :c', 'd.is_active = 1', vis.sql];
      for (const [k, col] of [['projectId', 'project_id'], ['siteId', 'site_id'], ['docType', 'doc_type'], ['status', 'status'], ['discipline', 'discipline'], ['confidentiality', 'confidentiality'], ['owner', 'owner_user_ref']]) if (q[k] !== undefined && q[k] !== '') { where.push(`d.${col} = :${k}`); p[k] = q[k]; }
      if (q.folderId) {
        if (q.includeSub) { where.push('(d.folder_id = :folder OR d.folder_id IN (SELECT id FROM doc_folders WHERE path LIKE (SELECT path FROM doc_folders WHERE id = :folder) || \'/%\'))'); } else where.push('d.folder_id = :folder');
        p.folder = q.folderId;
      }
      if (q.checkedOut) where.push('d.checked_out_by IS NOT NULL');
      if (q.expiring !== undefined && q.expiring !== '') { where.push('d.valid_until IS NOT NULL AND d.valid_until <= :soon AND d.status != \'ARCHIVED\''); p.soon = new Date(Date.parse(today()) + Number(q.expiring) * 86_400_000).toISOString().slice(0, 10); }
      if (q.tag) { where.push('EXISTS (SELECT 1 FROM json_each(d.tags_json) t WHERE t.value = :tag)'); p.tag = q.tag; }
      if (q.q) { where.push('(d.doc_no LIKE :q OR d.title LIKE :q OR d.tags_json LIKE :q OR d.wbs_ref LIKE :q OR d.location_ref LIKE :q)'); p.q = `%${q.q}%`; }
      const order = { newest: 'd.id DESC', number: 'd.doc_no', title: 'd.title COLLATE NOCASE', expiry: 'd.valid_until IS NULL, d.valid_until', updated: 'COALESCE(d.updated_at, d.created_at) DESC' }[q.sort ?? 'newest'];
      const total = db.prepare(`SELECT COUNT(*) AS n FROM doc_documents d WHERE ${where.join(' AND ')}`).get(only(`SELECT COUNT(*) AS n FROM doc_documents d WHERE ${where.join(' AND ')}`, p)).n;
      const sql = `SELECT d.* FROM doc_documents d WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit OFFSET :offset`;
      const rows = db.prepare(sql).all(only(sql, { ...p, limit: q.limit ?? 25, offset: q.offset ?? 0 })).map(row);
      return { rows, total };
    },
    get(actor, id) {
      const { d, acc } = load(actor, id);
      const vs = db.prepare('SELECT * FROM doc_versions WHERE document_id = ? AND is_active = 1 ORDER BY revision_no DESC').all(d.id);
      const open = vs.find((v) => ['DRAFT', 'RETURNED'].includes(v.status));
      const inReview = vs.find((v) => v.status === 'IN_REVIEW');
      const locked = d.checked_out_by;
      const type = types.get(d.company_id, d.doc_type);
      const out = {
        ...row(d), type: type ? typeRow(type) : null, versions: vs.map((v) => versionRow(v, d)), links: db.prepare('SELECT entity, entity_id, label, route FROM doc_links WHERE document_id = ? AND is_active = 1 ORDER BY id').all(d.id).map((l) => ({ entity: l.entity, entityId: l.entity_id, label: l.label, route: l.route })),
        folderPath: d.folder_id ? db.prepare('SELECT path FROM doc_folders WHERE id = ?').get(d.folder_id)?.path ?? null : null,
        shares: acc.manage || acc.owner ? sharesOf(d.id).map(shareRow) : [],
        distributions: distributionsOf(actor, d, acc),
        relation: { owner: acc.owner, manage: acc.manage },
        draftVersionId: open?.id ?? null, reviewVersionId: inReview?.id ?? null,
        allowed: {
          edit: acc.edit && !inReview, checkOut: acc.edit && !locked && !inReview && d.status !== 'DRAFT' && !open, checkIn: Boolean(locked) && (locked === actor.user), forceCheckIn: Boolean(locked) && locked !== actor.user && acc.manage,
          newRevision: acc.edit && d.status === 'ISSUED' && !open && !inReview && (!locked || locked === actor.user), submit: Boolean(open) && acc.edit && (!locked || locked === actor.user), distribute: acc.edit && d.status === 'ISSUED', share: acc.manage || acc.owner,
          archive: acc.manage && ['ISSUED', 'DRAFT'].includes(d.status), cancel: acc.edit && d.status === 'DRAFT' && !d.current_version_id, upload: Boolean(open) && acc.edit && (!locked || locked === actor.user),
          acknowledge: Boolean(ackRow(actor, d)),
        },
      };
      return out;
    },
    /** FR-01: a new controlled document with its first revision (a draft the author works on, checked out to them until it is sent for approval). */
    create(actor, b) {
      const scope = { companyId: actor.companyId, projectId: b.projectId ?? undefined, siteId: b.siteId ?? undefined };
      if (!may(actor, 'doc.document.create', scope)) throw forbidden('You may not add documents here (permission doc.document.create).');
      const type = types.get(actor.companyId, b.docType);
      if (!type) throw badRequest('The document is not valid.', [{ field: 'docType', message: `${b.docType} is not a document type of this company.` }]);
      const problems = [];
      if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(b.projectId, actor.companyId)) problems.push({ field: 'projectId', message: 'There is no such project.' });
      let folder = null;
      if (b.folderId) {
        folder = db.prepare('SELECT * FROM doc_folders WHERE id = ? AND company_id = ? AND is_active = 1').get(b.folderId, actor.companyId);
        if (!folder) problems.push({ field: 'folderId', message: 'There is no such folder.' });
        else if ((folder.project_id ?? null) !== (b.projectId ?? null)) problems.push({ field: 'folderId', message: 'That folder belongs to another project.' });
      }
      const acl = folder ? JSON.parse(folder.default_acl_json || '{}') : {};
      const level = b.confidentiality ?? acl.confidentiality ?? type.default_confidentiality;
      if (!LEVELS.includes(level)) problems.push({ field: 'confidentiality', message: 'Choose public, internal, confidential or restricted.' });
      if (b.validUntil && !type.has_validity) problems.push({ field: 'validUntil', message: `${type.name} has no validity date.` });
      if (type.has_validity && !b.validUntil) problems.push({ field: 'validUntil', message: `${type.name} needs the date until which it is valid.` });
      if (b.owner && !userRow(actor.companyId, b.owner) && b.owner !== actor.user) problems.push({ field: 'owner', message: `${b.owner} is not an active person of this company.` });
      if (problems.length) throw badRequest('The document is not valid.', problems);
      return transaction(db, () => {
        const { number } = ensureSeries(actor.companyId, actor.user);
        const stamp = nowIso();
        const res = db.prepare(`INSERT INTO doc_documents (company_id, doc_no, title, doc_type, discipline, folder_id, wbs_ref, location_ref, status, confidentiality, owner_user_ref, retention_class, valid_until, tags_json, checked_out_by, checked_out_at, checkout_note, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, 'Working on the first revision', ?, ?, ?, ?, ?)`)
          .run(actor.companyId, number, b.title.trim(), type.code, b.discipline ?? null, folder?.id ?? null, b.wbsRef ?? null, b.locationRef ?? null, level, b.owner ?? actor.user, b.retentionClass ?? type.retention_class, b.validUntil ?? null, JSON.stringify([...new Set(b.tags ?? [])]), actor.user, stamp, b.projectId ?? null, b.siteId ?? null, actor.user, b.source?.type ?? 'document_form', b.source?.id != null ? String(b.source.id) : null);
        const id = Number(res.lastInsertRowid);
        const d = db.prepare('SELECT * FROM doc_documents WHERE id = ?').get(id);
        const v = newVersion(d, actor, 1, b.changeNote ?? 'First issue');
        for (const r of acl.shareRoles ?? []) db.prepare("INSERT INTO doc_shares (company_id, document_id, principal_type, principal_id, principal_name, permission, granted_by, project_id, site_id, created_by, source_type) VALUES (?, ?, 'ROLE', ?, ?, 'VIEW', ?, ?, ?, ?, 'folder_acl')").run(actor.companyId, id, r, r, actor.user, d.project_id, d.site_id, actor.user);
        for (const l of b.links ?? []) db.prepare('INSERT OR IGNORE INTO doc_links (company_id, document_id, entity, entity_id, label, route, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'link\')').run(actor.companyId, id, l.entity, String(l.entityId), l.label ?? null, l.route ?? null, d.project_id, d.site_id, actor.user);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'create', newValues: { docNo: number, title: d.title, docType: type.code, confidentiality: level, projectId: d.project_id }, actor: actor.user, companyId: actor.companyId });
        event('doc.document.created', d, actor.user, { versionId: v.id });
        return documents.get(actor, id);
      });
    },
    update(actor, id, b) {
      const { d, acc } = load(actor, id, 'edit');
      if (d.status === 'IN_REVIEW') throw conflict('This document has a revision in approval. Its details are fixed until it is decided.');
      if (b.version !== undefined && b.version !== d.version) throw conflict('The document was changed by someone else. Refresh it and try again.');
      if (d.checked_out_by && d.checked_out_by !== actor.user) throw conflict(`${nameOf(d.company_id, d.checked_out_by)} has this document checked out.`);
      const type = types.get(d.company_id, d.doc_type);
      const problems = [];
      if (b.confidentiality && b.confidentiality !== d.confidentiality) {
        if (!LEVELS.includes(b.confidentiality)) problems.push({ field: 'confidentiality', message: 'Choose public, internal, confidential or restricted.' });
        else if (!acc.manage && LEVELS.indexOf(b.confidentiality) < LEVELS.indexOf(d.confidentiality)) problems.push({ field: 'confidentiality', message: 'Only the document controller makes a document less confidential.' });
      }
      if (b.validUntil !== undefined && b.validUntil && !type?.has_validity) problems.push({ field: 'validUntil', message: `${type?.name ?? d.doc_type} has no validity date.` });
      if (b.owner && !userRow(d.company_id, b.owner)) problems.push({ field: 'owner', message: `${b.owner} is not an active person of this company.` });
      if (b.folderId) { const f = db.prepare('SELECT project_id FROM doc_folders WHERE id = ? AND company_id = ? AND is_active = 1').get(b.folderId, d.company_id); if (!f || (f.project_id ?? null) !== (d.project_id ?? null)) problems.push({ field: 'folderId', message: 'Choose a folder of the same project.' }); }
      if (problems.length) throw badRequest('The document is not valid.', problems);
      return transaction(db, () => {
        const old = metaOf(d);
        const sets = [];
        const args = [];
        const map = { title: 'title', discipline: 'discipline', confidentiality: 'confidentiality', validUntil: 'valid_until', wbsRef: 'wbs_ref', locationRef: 'location_ref', owner: 'owner_user_ref', retentionClass: 'retention_class', folderId: 'folder_id' };
        for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { sets.push(`${col} = ?`); args.push(b[k] === '' ? null : b[k]); }
        if (b.tags !== undefined) { sets.push('tags_json = ?'); args.push(JSON.stringify([...new Set(b.tags)])); }
        if (b.validUntil !== undefined) sets.push('expiry_notified_at = NULL');
        if (sets.length) db.prepare(`UPDATE doc_documents SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...args, actor.user, nowIso(), id);
        const fresh = db.prepare('SELECT * FROM doc_documents WHERE id = ?').get(id);
        const now = metaOf(fresh);
        const changed = Object.fromEntries(META_FIELDS.filter((f) => String(old[f]) !== String(now[f])).map((f) => [f, [old[f], now[f]]]));
        if (Object.keys(changed).length) { writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'update', oldValues: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[0]])), newValues: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[1]])), actor: actor.user, companyId: d.company_id }); event('doc.document.updated', fresh, actor.user, { changed: Object.keys(changed) }); }
        return documents.get(actor, id);
      });
    },
    /** BR-02: one person at a time works on a document. */
    checkOut(actor, id, note) {
      return transaction(db, () => {
        const { d } = load(actor, id, 'edit');
        if (d.status === 'IN_REVIEW') throw conflict('A revision is in approval; it cannot be checked out now.');
        if (d.checked_out_by) throw conflict(d.checked_out_by === actor.user ? 'You have already checked this document out.' : `${nameOf(d.company_id, d.checked_out_by)} has this document checked out since ${d.checked_out_at}.`);
        db.prepare('UPDATE doc_documents SET checked_out_by = ?, checked_out_at = ?, checkout_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), note ?? null, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'check_out', newValues: { by: actor.user, note }, actor: actor.user, companyId: d.company_id });
        event('doc.document.checked_out', { ...d, checked_out_by: actor.user }, actor.user);
        return documents.get(actor, id);
      });
    },
    checkIn(actor, id, { reason } = /** @type {{ reason?: string }} */ ({})) {
      return transaction(db, () => {
        const { d, acc } = load(actor, id);
        if (!d.checked_out_by) throw conflict('This document is not checked out.');
        const forced = d.checked_out_by !== actor.user;
        if (forced) {
          if (!acc.manage) throw forbidden(`${nameOf(d.company_id, d.checked_out_by)} has this document checked out. Only the document controller can check it in for them.`);
          if (!reason || reason.trim().length < 5) throw badRequest('Say why you are forcing the check-in.', [{ field: 'reason', message: 'Give a reason of at least 5 characters.' }]);
        } else if (!acc.edit) throw forbidden('You may not change this document.');
        db.prepare('UPDATE doc_documents SET checked_out_by = NULL, checked_out_at = NULL, checkout_note = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: forced ? 'force_check_in' : 'check_in', oldValues: { checkedOutBy: d.checked_out_by }, reason: reason ?? undefined, actor: actor.user, companyId: d.company_id });
        event('doc.document.checked_in', { ...d, checked_out_by: null }, actor.user, { forced });
        if (forced) tell(d, 'doc.distribution.reminder', [d.checked_out_by], {}, `doc:${id}:forced:${nowIso()}`);
        return documents.get(actor, id);
      });
    },
    /** A new revision of an issued document, a draft the author works on under their own check-out. */
    newRevision(actor, id, { changeNote }) {
      return transaction(db, () => {
        const { d } = load(actor, id, 'edit');
        if (d.status !== 'ISSUED') throw conflict(d.status === 'IN_REVIEW' ? 'A revision is already in approval.' : 'Only an issued document is revised.');
        if (db.prepare("SELECT 1 FROM doc_versions WHERE document_id = ? AND status IN ('DRAFT', 'RETURNED', 'IN_REVIEW') AND is_active = 1").get(id)) throw conflict('There is already a revision in progress.');
        if (d.checked_out_by && d.checked_out_by !== actor.user) throw conflict(`${nameOf(d.company_id, d.checked_out_by)} has this document checked out; it cannot be revised by anyone else (an administrator can check it in with a reason).`);
        const next = (db.prepare('SELECT MAX(revision_no) AS n FROM doc_versions WHERE document_id = ?').get(id).n ?? 0) + 1;
        if (!d.checked_out_by) db.prepare('UPDATE doc_documents SET checked_out_by = ?, checked_out_at = ?, checkout_note = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), `Working on revision ${revisionName(next)}`, id);
        const v = newVersion(d, actor, next, changeNote);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'new_revision', newValues: { revision: v.revision, changeNote }, actor: actor.user, companyId: d.company_id });
        event('doc.document.revision_started', d, actor.user, { versionId: v.id, revision: v.revision });
        return documents.get(actor, id);
      });
    },
    /** Send the draft revision for approval: it needs its file, scanned clean; the check-out ends (the work is done). */
    submit(actor, id) {
      return transaction(db, () => {
        const { d } = load(actor, id, 'edit');
        const v = db.prepare("SELECT * FROM doc_versions WHERE document_id = ? AND status IN ('DRAFT', 'RETURNED') AND is_active = 1 ORDER BY revision_no DESC").get(id);
        if (!v) throw conflict('There is no draft revision to send. Start a new revision first.');
        if (d.checked_out_by && d.checked_out_by !== actor.user) throw conflict(`${nameOf(d.company_id, d.checked_out_by)} has this document checked out.`);
        const f = db.prepare("SELECT * FROM core_files WHERE linked_entity = 'doc_version' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY id DESC LIMIT 1").get(v.id);
        if (!f) throw unprocessable('Attach the file of this revision before sending it for approval.');
        if (f.scan_status !== 'CLEAN') throw unprocessable(f.scan_status === 'PENDING' ? 'The file is still being scanned for viruses. Try again in a moment.' : 'The file did not pass the virus scan. Attach a clean file.');
        const type = types.get(d.company_id, d.doc_type);
        const prev = db.prepare("SELECT * FROM doc_versions WHERE document_id = ? AND revision_no < ? AND is_active = 1 ORDER BY revision_no DESC LIMIT 1").get(id, v.revision_no);
        if (prev?.file_id === f.id) throw unprocessable('This revision has the same file as the one before it. Attach the new file.');
        const snapshot = metaOf(d);
        db.prepare("UPDATE doc_versions SET file_id = ?, metadata_json = ?, submitted_by = ?, submitted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(f.id, JSON.stringify(snapshot), actor.user, nowIso(), actor.user, nowIso(), v.id);
        db.prepare('UPDATE doc_documents SET checked_out_by = NULL, checked_out_at = NULL, checkout_note = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), id);
        const context = { approverRole: type?.approver_role ?? 'PM', requiresReview: type?.requires_review === 1 ? 'yes' : 'no', revision: v.revision, docType: d.doc_type };
        // a revision that came back is sent again on the same approval (the engine resubmits it)
        const instance = engine.submit(actor, { docType: REVISION_DOC, docId: v.id, comment: v.change_note ?? undefined, context });
        db.prepare('UPDATE doc_versions SET instance_id = ? WHERE id = ?').run(instance.id, v.id);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'submit_revision', newValues: { revision: v.revision, instanceId: instance.id }, actor: actor.user, companyId: d.company_id });
        return { ...documents.get(actor, id), workflow: instance };
      });
    },
    archive(actor, id, reason) {
      return transaction(db, () => {
        const { d } = load(actor, id, 'manage');
        if (!['ISSUED', 'DRAFT'].includes(d.status)) throw conflict(`A ${d.status.toLowerCase().replace('_', ' ')} document cannot be archived.`);
        if (d.checked_out_by) throw conflict('Check the document in before archiving it.');
        if (!reason || reason.trim().length < 5) throw badRequest('Say why it is archived.', [{ field: 'reason', message: 'Give a reason of at least 5 characters.' }]);
        db.prepare("UPDATE doc_documents SET status = 'ARCHIVED', archived_at = ?, archive_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), reason.trim(), actor.user, nowIso(), id);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'archive', oldValues: { status: d.status }, newValues: { status: 'ARCHIVED' }, reason, actor: actor.user, companyId: d.company_id });
        event('doc.document.archived', { ...d, status: 'ARCHIVED' }, actor.user);
        return documents.get(actor, id);
      });
    },
    cancel(actor, id, reason) {
      return transaction(db, () => {
        const { d } = load(actor, id, 'edit');
        if (d.status !== 'DRAFT' || d.current_version_id) throw conflict('Only a document that was never issued is cancelled; an issued one is archived.');
        if (!reason || reason.trim().length < 5) throw badRequest('Say why it is cancelled.', [{ field: 'reason', message: 'Give a reason of at least 5 characters.' }]);
        db.prepare("UPDATE doc_documents SET status = 'CANCELLED', checked_out_by = NULL, checked_out_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: d.company_id });
        event('doc.document.cancelled', { ...d, status: 'CANCELLED' }, actor.user);
        return documents.get(actor, id);
      });
    },
    /** FR-02: the metadata of two revisions side by side, and the files. */
    compare(actor, id, fromId, toId) {
      const { d } = load(actor, id);
      const a = versionOrThrow(d, fromId);
      const b = versionOrThrow(d, toId);
      const ma = JSON.parse(a.metadata_json || '{}');
      const mb = JSON.parse(b.metadata_json || '{}');
      const fa = a.file_id ? fileRow(a.file_id) : draftFile(a.id);
      const fb = b.file_id ? fileRow(b.file_id) : draftFile(b.id);
      const rows = META_FIELDS.map((f) => ({ field: f, label: META_LABEL[f], from: ma[f] ?? '', to: mb[f] ?? '', changed: String(ma[f] ?? '') !== String(mb[f] ?? '') }));
      rows.push({ field: 'file', label: 'File', from: fa ? `${fa.name} (${fa.size} bytes)` : '', to: fb ? `${fb.name} (${fb.size} bytes)` : '', changed: fa?.sha256 !== fb?.sha256 });
      rows.push({ field: 'changeNote', label: 'Change note', from: a.change_note ?? '', to: b.change_note ?? '', changed: (a.change_note ?? '') !== (b.change_note ?? '') });
      return { from: { id: a.id, revision: a.revision, status: a.status }, to: { id: b.id, revision: b.revision, status: b.status }, rows, changes: rows.filter((r) => r.changed).length };
    },
  };
  const only = (sql, p) => Object.fromEntries(Object.entries(p).filter(([k]) => new RegExp(`:${k}\\b`).test(sql)));

  function newVersion(d, actor, no, note) {
    const res = db.prepare("INSERT INTO doc_versions (company_id, document_id, revision, revision_no, status, change_note, metadata_json, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 'revision')")
      .run(d.company_id, d.id, revisionName(no), no, note ?? null, JSON.stringify(metaOf(d)), d.project_id, d.site_id, actor.user);
    if (no === 1) db.prepare('UPDATE doc_documents SET current_revision = ?, version = version + 1 WHERE id = ?').run(revisionName(no), d.id);
    return db.prepare('SELECT * FROM doc_versions WHERE id = ?').get(Number(res.lastInsertRowid));
  }

  // ---- the workflow of a revision: what its decisions do to the register (BR-01) ----
  const issue = (instance, actor) => transaction(db, () => {
    const v = db.prepare('SELECT * FROM doc_versions WHERE id = ?').get(Number(instance.docId));
    if (!v || v.status !== 'IN_REVIEW') return;
    const d = db.prepare('SELECT * FROM doc_documents WHERE id = ?').get(v.document_id);
    const stamp = nowIso();
    const prev = db.prepare("SELECT * FROM doc_versions WHERE document_id = ? AND status = 'ISSUED' AND id != ?").all(d.id, v.id);
    for (const p of prev) db.prepare("UPDATE doc_versions SET status = 'SUPERSEDED', superseded_at = ?, superseded_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, v.id, actor.user, stamp, p.id);
    db.prepare("UPDATE doc_versions SET status = 'ISSUED', approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, actor.user, stamp, v.id);
    db.prepare("UPDATE doc_documents SET status = 'ISSUED', current_revision = ?, current_version_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(v.revision, v.id, actor.user, stamp, d.id);
    const fresh = db.prepare('SELECT * FROM doc_documents WHERE id = ?').get(d.id);
    writeAudit(db, { entity: 'doc_documents', entityId: d.id, action: 'issue', newValues: { revision: v.revision, superseded: prev.map((p) => p.revision) }, actor: actor.user, companyId: d.company_id });
    event('doc.document.issued', fresh, actor.user, { versionId: v.id, supersedes: prev.map((p) => p.revision) });
    for (const p of prev) event('doc.document.superseded', fresh, actor.user, { versionId: p.id, revision: p.revision, by: v.revision });
    tell(fresh, 'doc.revision.issued', [v.submitted_by, d.owner_user_ref], {}, `doc:${d.id}:issued:${v.id}`, v);
    for (const s of sharesOf(d.id).filter((s) => s.principal_type === 'USER')) tell(fresh, 'doc.revision.issued', [s.principal_id], {}, `doc:${d.id}:issued:${v.id}`, v);
  });
  const backToAuthor = (instance, status) => transaction(db, () => {
    const v = db.prepare('SELECT * FROM doc_versions WHERE id = ?').get(Number(instance.docId));
    if (!v || v.status !== 'IN_REVIEW') return;
    db.prepare('UPDATE doc_versions SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, nowIso(), v.id);
    const d = db.prepare('SELECT * FROM doc_documents WHERE id = ?').get(v.document_id);
    db.prepare("UPDATE doc_documents SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(d.current_version_id ? 'ISSUED' : 'DRAFT', nowIso(), d.id);
    if (status === 'RETURNED' || status === 'DRAFT') db.prepare('UPDATE doc_documents SET checked_out_by = ?, checked_out_at = ?, checkout_note = ? WHERE id = ? AND checked_out_by IS NULL').run(v.submitted_by, nowIso(), `Correcting revision ${v.revision}`, d.id);
  });
  const resubmitted = (instance) => db.prepare("UPDATE doc_versions SET status = 'IN_REVIEW', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), Number(instance.docId));

  // ---- sharing (FR-04) ----
  const shareRow = (s) => ({ id: s.id, type: s.principal_type, principal: s.principal_id, name: s.principal_name ?? s.principal_id, permission: s.permission, expiresAt: s.expires_at, grantedBy: s.granted_by, grantedAt: s.created_at });
  const shares = {
    add(actor, id, b) {
      return transaction(db, () => {
        const { d, acc } = load(actor, id);
        if (!(acc.manage || acc.owner)) throw forbidden('Only the owner of the document or the document controller shares it.');
        if (['ARCHIVED', 'CANCELLED'].includes(d.status)) throw conflict('This document is closed; it is not shared further.');
        const problems = [];
        if (b.type === 'USER' && !userRow(d.company_id, b.principal)) problems.push({ field: 'principal', message: `${b.principal} is not an active person of this company.` });
        if (b.type === 'ROLE' && !ROLE_CODES.has(b.principal)) problems.push({ field: 'principal', message: `${b.principal} is not a role.` });
        if (b.type === 'EXTERNAL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.principal)) problems.push({ field: 'principal', message: 'Give the e-mail address of the outside person.' });
        if (b.type === 'EXTERNAL' && b.permission === 'EDIT') problems.push({ field: 'permission', message: 'An outside person may only view.' });
        if (b.type === 'EXTERNAL' && !b.expiresAt) problems.push({ field: 'expiresAt', message: 'Sharing with an outside person needs an end date.' });
        if (b.expiresAt && b.expiresAt <= today()) problems.push({ field: 'expiresAt', message: 'The end date must be in the future.' });
        if (problems.length) throw badRequest('The share is not valid.', problems);
        const old = db.prepare('SELECT id FROM doc_shares WHERE document_id = ? AND principal_type = ? AND principal_id = ? AND is_active = 1').get(id, b.type, b.principal);
        if (old) db.prepare('UPDATE doc_shares SET permission = ?, expires_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.permission, b.expiresAt ? `${b.expiresAt}T23:59:59.999Z` : null, actor.user, nowIso(), old.id);
        else db.prepare('INSERT INTO doc_shares (company_id, document_id, principal_type, principal_id, principal_name, permission, expires_at, granted_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'share\')').run(d.company_id, id, b.type, b.principal, b.type === 'USER' ? nameOf(d.company_id, b.principal) : b.principal, b.permission, b.expiresAt ? `${b.expiresAt}T23:59:59.999Z` : null, actor.user, d.project_id, d.site_id, actor.user);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'share', newValues: { type: b.type, principal: b.principal, permission: b.permission, expiresAt: b.expiresAt ?? null }, actor: actor.user, companyId: d.company_id });
        event('doc.document.shared', d, actor.user, { type: b.type, principal: b.principal });
        return documents.get(actor, id);
      });
    },
    remove(actor, id, shareId) {
      return transaction(db, () => {
        const { d, acc } = load(actor, id);
        if (!(acc.manage || acc.owner)) throw forbidden('Only the owner of the document or the document controller changes who it is shared with.');
        const r = db.prepare('UPDATE doc_shares SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ? AND document_id = ? AND is_active = 1').run(nowIso(), actor.user, shareId, id);
        if (!Number(r.changes)) throw notFound('That share does not exist.');
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'unshare', newValues: { shareId }, actor: actor.user, companyId: d.company_id });
        return documents.get(actor, id);
      });
    },
  };

  // ---- distribution and acknowledgement (FR-06) ----
  const distRow = (r) => ({ id: r.id, versionId: r.version_id, revision: db.prepare('SELECT revision FROM doc_versions WHERE id = ?').get(r.version_id)?.revision, type: r.recipient_type, recipient: r.recipient_id, name: r.recipient_name ?? r.recipient_id, email: r.recipient_email, sentBy: r.sent_by, sentAt: r.sent_at, message: r.message, dueAt: r.due_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by, ackNote: r.ack_note, overdue: !r.acknowledged_at && r.due_at && r.due_at < nowIso() });
  const ackRow = (actor, d) => db.prepare("SELECT * FROM doc_distributions WHERE document_id = ? AND recipient_type = 'USER' AND recipient_id = ? AND acknowledged_at IS NULL AND is_active = 1 ORDER BY id DESC LIMIT 1").get(d.id, actor.user);
  function distributionsOf(actor, d, acc) {
    const all = db.prepare('SELECT * FROM doc_distributions WHERE document_id = ? AND is_active = 1 ORDER BY id DESC').all(d.id);
    return (acc.manage || acc.owner || acc.edit ? all : all.filter((r) => r.recipient_type === 'USER' && r.recipient_id === actor.user)).map(distRow);
  }
  const distribution = {
    send(actor, id, b) {
      return transaction(db, () => {
        const { d } = load(actor, id, 'edit');
        if (d.status !== 'ISSUED' || !d.current_version_id) throw conflict('Only an issued document is distributed.');
        const v = db.prepare('SELECT * FROM doc_versions WHERE id = ?').get(d.current_version_id);
        const people = new Map();
        const problems = [];
        for (const [i, r] of b.recipients.entries()) {
          if (r.type === 'USER') { const u = userRow(d.company_id, r.id); if (!u) problems.push({ field: `recipients.${i}`, message: `${r.id} is not an active person of this company.` }); else people.set(`USER:${u.username}`, { type: 'USER', id: u.username, name: u.display_name, email: u.email }); }
          else if (r.type === 'ROLE') { const us = holders(d.company_id, [r.id]); if (!us.length) problems.push({ field: `recipients.${i}`, message: `Nobody holds the role ${r.id}.` }); for (const un of us) { const u = userRow(d.company_id, un); people.set(`USER:${un}`, { type: 'USER', id: un, name: u.display_name, email: u.email }); } }
          else if (r.type === 'EXTERNAL') { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.id)) problems.push({ field: `recipients.${i}`, message: 'Give the e-mail address of the outside person.' }); else people.set(`EXTERNAL:${r.id.toLowerCase()}`, { type: 'EXTERNAL', id: r.id.toLowerCase(), name: r.name ?? r.id, email: r.id.toLowerCase() }); }
        }
        if (problems.length) throw badRequest('The distribution is not valid.', problems);
        const due = b.dueDays ? new Date(Date.parse(today()) + b.dueDays * 86_400_000).toISOString() : null;
        const sent = [];
        const skipped = [];
        for (const p of people.values()) {
          const old = db.prepare('SELECT id FROM doc_distributions WHERE version_id = ? AND recipient_type = ? AND recipient_id = ? AND is_active = 1').get(v.id, p.type, p.id);
          if (old) { skipped.push(p.id); continue; }
          db.prepare('INSERT INTO doc_distributions (company_id, document_id, version_id, recipient_type, recipient_id, recipient_name, recipient_email, sent_by, sent_at, message, due_at, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'distribution\')').run(d.company_id, d.id, v.id, p.type, p.id, p.name, p.email, actor.user, nowIso(), b.message ?? null, due, d.project_id, d.site_id, actor.user);
          sent.push(p);
        }
        tell(d, 'doc.distribution.sent', sent.filter((p) => p.type === 'USER').map((p) => p.id), { actor: nameOf(d.company_id, actor.user), message: b.message ?? '' }, undefined, v);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'distribute', newValues: { revision: v.revision, recipients: sent.map((p) => p.id), skipped }, actor: actor.user, companyId: d.company_id });
        event('doc.document.distributed', d, actor.user, { versionId: v.id, recipients: sent.length });
        return { ...documents.get(actor, id), sent: sent.length, skipped: skipped.length };
      });
    },
    acknowledge(actor, id, note) {
      return transaction(db, () => {
        const { d } = load(actor, id);
        const r = ackRow(actor, d);
        if (!r) throw conflict('Nothing was sent to you for acknowledgement, or you have acknowledged it already.');
        db.prepare('UPDATE doc_distributions SET acknowledged_at = ?, acknowledged_by = ?, ack_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, note ?? null, actor.user, nowIso(), r.id);
        writeAudit(db, { entity: 'doc_documents', entityId: id, action: 'acknowledge', newValues: { versionId: r.version_id }, actor: actor.user, companyId: d.company_id });
        event('doc.document.acknowledged', d, actor.user, { versionId: r.version_id });
        return documents.get(actor, id);
      });
    },
    /** For the job: remind those who have not acknowledged by the date, once a day. */
    remind() {
      let n = 0;
      for (const r of db.prepare("SELECT x.*, d.doc_no, d.title, d.company_id AS dc, d.project_id AS dp, d.site_id AS ds, d.id AS did FROM doc_distributions x JOIN doc_documents d ON d.id = x.document_id WHERE x.acknowledged_at IS NULL AND x.recipient_type = 'USER' AND x.is_active = 1 AND x.due_at IS NOT NULL AND x.due_at < ? AND (x.reminded_at IS NULL OR substr(x.reminded_at, 1, 10) < ?)").all(nowIso(), today())) {
        const d = { id: r.did, company_id: r.dc, doc_no: r.doc_no, title: r.title, project_id: r.dp, site_id: r.ds };
        tell(d, 'doc.distribution.reminder', [r.recipient_id], {}, `doc:${r.did}:remind:${r.id}:${today()}`, db.prepare('SELECT revision FROM doc_versions WHERE id = ?').get(r.version_id));
        db.prepare('UPDATE doc_distributions SET reminded_at = ? WHERE id = ?').run(nowIso(), r.id);
        n += 1;
      }
      return n;
    },
  };

  // ---- markups, kept as layers over a revision (FR-07) ----
  const annRow = (a) => ({ id: a.id, versionId: a.version_id, user: a.user_ref, page: a.page, shape: JSON.parse(a.shape_json), comment: a.comment, resolved: a.resolved === 1, createdAt: a.created_at });
  const annotations = {
    list(actor, versionId) {
      const v = db.prepare('SELECT * FROM doc_versions WHERE id = ? AND is_active = 1').get(versionId);
      if (!v) throw notFound('That revision does not exist.');
      load(actor, v.document_id);
      return db.prepare('SELECT * FROM doc_annotations WHERE version_id = ? AND is_active = 1 ORDER BY page, id').all(versionId).map(annRow);
    },
    add(actor, versionId, b) {
      const v = db.prepare('SELECT * FROM doc_versions WHERE id = ? AND is_active = 1').get(versionId);
      if (!v) throw notFound('That revision does not exist.');
      const { d } = load(actor, v.document_id);
      if (['ARCHIVED', 'CANCELLED'].includes(d.status)) throw conflict('This document is closed.');
      const res = db.prepare('INSERT INTO doc_annotations (company_id, version_id, user_ref, page, shape_json, comment, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'markup\')').run(d.company_id, versionId, actor.user, b.page, JSON.stringify(b.shape), b.comment ?? null, d.project_id, d.site_id, actor.user);
      writeAudit(db, { entity: 'doc_annotations', entityId: Number(res.lastInsertRowid), action: 'create', newValues: { versionId, page: b.page, kind: b.shape.kind }, actor: actor.user, companyId: d.company_id });
      return annRow(db.prepare('SELECT * FROM doc_annotations WHERE id = ?').get(Number(res.lastInsertRowid)));
    },
    set(actor, annotationId, b) {
      const a = db.prepare('SELECT * FROM doc_annotations WHERE id = ? AND company_id = ? AND is_active = 1').get(annotationId, actor.companyId);
      if (!a) throw notFound('That markup does not exist.');
      const v = db.prepare('SELECT document_id FROM doc_versions WHERE id = ?').get(a.version_id);
      const { acc } = load(actor, v.document_id);
      if (a.user_ref !== actor.user && !acc.edit) throw forbidden('You may change your own markups, or those of a document you edit.');
      if (b.remove) db.prepare('UPDATE doc_annotations SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ?').run(nowIso(), actor.user, a.id);
      else db.prepare('UPDATE doc_annotations SET resolved = ?, comment = COALESCE(?, comment), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.resolved ? 1 : 0, b.comment ?? null, actor.user, nowIso(), a.id);
      return b.remove ? { removed: true } : annRow(db.prepare('SELECT * FROM doc_annotations WHERE id = ?').get(a.id));
    },
  };

  // ---- folders (FR-03) ----
  const folderRow = (f) => ({ id: f.id, parentId: f.parent_id, name: f.name, path: f.path, projectId: f.project_id, template: f.template_code, defaultAcl: JSON.parse(f.default_acl_json || '{}'), sortOrder: f.sort_order });
  const folders = {
    tree(actor, projectId) {
      const scope = { companyId: actor.companyId, projectId: projectId ?? undefined };
      if (!may(actor, 'doc.document.view', scope)) throw forbidden('You may not see the documents of this project (permission doc.document.view).');
      const rows = db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM doc_documents d WHERE d.folder_id = f.id AND d.is_active = 1 AND d.status != 'CANCELLED') AS n FROM doc_folders f WHERE f.company_id = ? AND COALESCE(f.project_id, 0) = ? AND f.is_active = 1 ORDER BY f.path`).all(actor.companyId, projectId ?? 0);
      return rows.map((f) => ({ ...folderRow(f), documents: f.n }));
    },
    create(actor, b) {
      const scope = { companyId: actor.companyId, projectId: b.projectId ?? undefined };
      if (!may(actor, 'doc.document.manage', scope)) throw forbidden('Only the document controller makes folders (permission doc.document.manage).');
      return transaction(db, () => {
        let parent = null;
        if (b.parentId) { parent = db.prepare('SELECT * FROM doc_folders WHERE id = ? AND company_id = ? AND is_active = 1').get(b.parentId, actor.companyId); if (!parent || (parent.project_id ?? null) !== (b.projectId ?? null)) throw notFound('The parent folder does not exist in this project.'); }
        if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(b.projectId, actor.companyId)) throw badRequest('The folder is not valid.', [{ field: 'projectId', message: 'There is no such project.' }]);
        const name = b.name.trim();
        if (/[/\\]/.test(name)) throw badRequest('The folder is not valid.', [{ field: 'name', message: 'A folder name has no slash.' }]);
        if (db.prepare('SELECT 1 FROM doc_folders WHERE company_id = ? AND COALESCE(project_id, 0) = ? AND COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE AND is_active = 1').get(actor.companyId, b.projectId ?? 0, b.parentId ?? 0, name)) throw conflict(`There is already a folder called ${name} here.`);
        const id = Number(db.prepare('INSERT INTO doc_folders (company_id, parent_id, name, path, default_acl_json, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, \'folder\')').run(actor.companyId, b.parentId ?? null, name, parent ? `${parent.path}/${name}` : name, JSON.stringify(b.defaultAcl ?? {}), b.projectId ?? null, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'doc_folders', entityId: id, action: 'create', newValues: { name, projectId: b.projectId ?? null }, actor: actor.user, companyId: actor.companyId });
        return folderRow(db.prepare('SELECT * FROM doc_folders WHERE id = ?').get(id));
      });
    },
    /** The standard folders of a project, from a template (once). */
    applyTemplate(actor, projectId, code) {
      const scope = { companyId: actor.companyId, projectId };
      if (!may(actor, 'doc.document.manage', scope)) throw forbidden('Only the document controller makes folders (permission doc.document.manage).');
      if (!db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(projectId, actor.companyId)) throw notFound('That project does not exist.');
      const t = templates.get(actor.companyId, code);
      if (!t) throw notFound('That folder template does not exist.');
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM doc_folders WHERE company_id = ? AND project_id = ? AND template_code = ? AND is_active = 1').get(actor.companyId, projectId, code)) throw conflict('This project already has the folders of that template.');
        let n = 0;
        const make = (nodes, parent, path, sort0) => nodes.forEach((node, i) => {
          const full = path ? `${path}/${node.name}` : node.name;
          const id = Number(db.prepare('INSERT INTO doc_folders (company_id, parent_id, name, path, template_code, default_acl_json, sort_order, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'folder_template\')').run(actor.companyId, parent, node.name, full, code, JSON.stringify(node.acl ?? {}), sort0 + i, projectId, actor.user).lastInsertRowid);
          n += 1;
          if (node.children) make(node.children, id, full, 0);
        });
        make(JSON.parse(t.tree_json), null, '', 0);
        writeAudit(db, { entity: 'doc_folders', entityId: projectId, action: 'apply_template', newValues: { template: code, folders: n }, actor: actor.user, companyId: actor.companyId });
        return { folders: n, tree: folders.tree(actor, projectId) };
      });
    },
  };

  // ---- expiry (FR-09): the owner is told 30 days before, and again when it has passed ----
  function expirySweep() {
    let told = 0;
    const soon = new Date(Date.parse(today()) + 30 * 86_400_000).toISOString().slice(0, 10);
    for (const d of db.prepare("SELECT * FROM doc_documents WHERE is_active = 1 AND status = 'ISSUED' AND valid_until IS NOT NULL AND valid_until <= ? AND (expiry_notified_at IS NULL OR substr(expiry_notified_at, 1, 10) < ?)").all(soon, new Date(Date.parse(today()) - 6 * 86_400_000).toISOString().slice(0, 10))) {
      const days = Math.round((Date.parse(d.valid_until) - Date.parse(today())) / 86_400_000);
      tell(d, 'doc.document.expiring', [d.owner_user_ref], { validUntil: d.valid_until, days: String(days) }, `doc:${d.id}:expiry:${today()}`);
      db.prepare('UPDATE doc_documents SET expiry_notified_at = ? WHERE id = ?').run(nowIso(), d.id);
      event(days < 0 ? 'doc.document.expired' : 'doc.document.expiring', d, 'system', { validUntil: d.valid_until, days });
      told += 1;
    }
    return told;
  }

  return { documents, versions: { get: (actor, id, versionId) => { const { d } = load(actor, id); return versionRow(versionOrThrow(d, versionId), d); }, locate: (actor, versionId) => { const v = db.prepare('SELECT id, document_id, revision, status FROM doc_versions WHERE id = ? AND company_id = ? AND is_active = 1').get(versionId, actor.companyId); if (!v) throw notFound('That revision does not exist.'); load(actor, v.document_id); return { id: v.id, documentId: v.document_id, revision: v.revision, status: v.status }; } }, shares, distribution, annotations, folders, types, templates, access, visibleSql, load, expirySweep, today, nowIso, issue, backToAuthor, resubmitted, ensureSeries, only, fileRow, metaOf, row, userRow };
}

// ---- registered once: the workflow documents, the file entity, the search entity, the alert dataset ----
const services = new WeakMap();
export const bind = (db, service) => services.set(db, service);
const bound = (db) => services.get(db);

workflowTypes.register({
  docType: REVISION_DOC,
  label: 'Document revision',
  processOwner: 'DOC',
  route: (id) => `/documents/document?version=${id}`, // the page finds the document of the revision
  describe(db, companyId, id) {
    const v = db.prepare('SELECT v.*, d.doc_no, d.title FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ? AND v.company_id = ?').get(Number(id), companyId);
    return v ? { ref: `${v.doc_no} rev ${v.revision}`, title: v.title, originator: v.submitted_by ?? v.created_by, projectId: v.project_id ?? undefined, siteId: v.site_id ?? undefined } : null;
  },
  summarise(db, actor, id) {
    const v = db.prepare('SELECT v.*, d.doc_no, d.title, d.doc_type, d.discipline, d.confidentiality, d.valid_until FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ?').get(Number(id));
    if (!v) return null;
    const f = v.file_id ? db.prepare('SELECT original_name, size_bytes FROM core_files WHERE id = ?').get(v.file_id) : null;
    return { fields: [{ label: 'Document', value: `${v.doc_no}: ${v.title}` }, { label: 'Revision', value: v.revision }, { label: 'Type', value: v.doc_type }, { label: 'Discipline', value: v.discipline ?? '' }, { label: 'Confidentiality', value: v.confidentiality }, { label: 'Change', value: v.change_note ?? '' }, { label: 'File', value: f ? `${f.original_name} (${f.size_bytes} bytes)` : '' }, ...(v.valid_until ? [{ label: 'Valid until', value: v.valid_until }] : [])] };
  },
  defaultDefinition: {
    name: 'Document revision issue',
    settings: { resubmit: 'first', distinctApprovers: true },
    steps: [
      step('REVIEW', 'Reviewer (discipline lead)', 'DESIGN|SE|QCE|PLAN|COMMGR|HRMGR|HSEE|HSEO', { field: 'requiresReview', op: 'eq', value: 'yes' }),
      step('APPROVE_PM', 'Project manager', 'PM', { field: 'approverRole', op: 'eq', value: 'PM' }),
      step('APPROVE_QC', 'Quality control manager', 'QCMGR', { field: 'approverRole', op: 'eq', value: 'QCMGR' }),
    ],
  },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.issue(instance, actor),
    onRejected: (db, { instance }) => bound(db)?.backToAuthor(instance, 'REJECTED'),
    onReturned: (db, { instance }) => bound(db)?.backToAuthor(instance, 'RETURNED'),
    onCancelled: (db, { instance }) => bound(db)?.backToAuthor(instance, 'DRAFT'),
    onResubmitted: (db, { instance }) => bound(db)?.resubmitted(instance),
    onSubmitted: (db, { instance }) => {
      db.prepare("UPDATE doc_versions SET status = 'IN_REVIEW', updated_at = ?, version = version + 1 WHERE id = ?").run(new Date().toISOString(), Number(instance.docId));
      const v = db.prepare('SELECT document_id FROM doc_versions WHERE id = ?').get(Number(instance.docId));
      if (v) db.prepare("UPDATE doc_documents SET status = CASE WHEN current_version_id IS NULL THEN 'IN_REVIEW' ELSE status END, updated_at = ?, version = version + 1 WHERE id = ?").run(new Date().toISOString(), v.document_id);
    },
  },
});
evidenceProviders.register(REVISION_DOC, ({ db, instance }) => {
  const v = db.prepare('SELECT v.*, d.doc_no, d.title, d.current_version_id FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ?').get(Number(instance.docId));
  if (!v) return { sections: [] };
  const prev = v.current_version_id ? db.prepare('SELECT * FROM doc_versions WHERE id = ?').get(v.current_version_id) : null;
  const file = v.file_id ? db.prepare('SELECT original_name, size_bytes, scan_status FROM core_files WHERE id = ?').get(v.file_id) : null;
  const a = prev ? JSON.parse(prev.metadata_json || '{}') : {};
  const b = JSON.parse(v.metadata_json || '{}');
  const changed = META_FIELDS.filter((f) => prev && String(a[f] ?? '') !== String(b[f] ?? ''));
  return {
    sections: [
      { code: 'revision', title: 'The revision', kind: 'metrics', items: [{ label: 'Revision', value: v.revision, format: 'text' }, { label: 'Replaces', value: prev ? `revision ${prev.revision}` : 'nothing (first issue)', format: 'text' }, { label: 'File', value: file ? `${file.original_name}, ${file.size_bytes} bytes, scan ${file.scan_status}` : 'none', format: 'text', tone: file?.scan_status === 'CLEAN' ? 'success' : 'warning' }] },
      ...(prev ? [{ code: 'changes', title: `What changed since revision ${prev.revision}`, kind: 'table', columns: [{ key: 'field', label: 'Detail' }, { key: 'from', label: 'Before' }, { key: 'to', label: 'Now' }], rows: changed.map((f) => ({ field: META_LABEL[f], from: String(a[f] ?? ''), to: String(b[f] ?? '') })) }] : []),
    ],
    flags: [],
  };
});
workflowTypes.register({
  docType: CONFIG_DOC,
  label: 'Document types and folder templates change',
  processOwner: 'SYSADM',
  route: () => '/admin/document-types',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM doc_types WHERE batch_id = ? AND company_id = ? LIMIT 1').get(Number(id), companyId) ?? db.prepare('SELECT * FROM doc_folder_templates WHERE batch_id = ? AND company_id = ? LIMIT 1').get(Number(id), companyId);
    return r ? { ref: `Document configuration #${id}`, title: 'Change of document types or folder templates', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const t = db.prepare('SELECT * FROM doc_types WHERE batch_id = ? ORDER BY code').all(Number(id));
    const f = db.prepare('SELECT * FROM doc_folder_templates WHERE batch_id = ? ORDER BY code').all(Number(id));
    if (!t.length && !f.length) return null;
    return { fields: [{ label: 'Types changed', value: t.map((r) => r.code).join(', ') || 'none' }, { label: 'Templates changed', value: f.map((r) => r.code).join(', ') || 'none' }, { label: 'Reason', value: (t[0] ?? f[0]).reason ?? '' }],
      lines: { columns: [{ key: 'what', label: 'What' }, { key: 'detail', label: 'Detail' }], rows: [...t.map((r) => ({ what: `Type ${r.code}`, detail: `${r.name}; review ${r.requires_review ? 'yes' : 'no'}; approver ${r.approver_role}; ${r.default_confidentiality}; retention ${r.retention_class}${r.has_validity ? '; has a validity date' : ''}` })), ...f.map((r) => ({ what: `Template ${r.code}`, detail: `${r.name}; ${JSON.parse(r.tree_json).length} top folders` }))] } };
  },
  defaultDefinition: { name: 'Document configuration approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [cfgStep] },
  hooks: {
    onApproved: (db, { instance, actor }) => {
      const batch = Number(instance.docId);
      for (const [table, col, ver] of [['doc_types', 'code', 'type_version'], ['doc_folder_templates', 'code', 'template_version']]) {
        for (const r of db.prepare(`SELECT * FROM ${table} WHERE batch_id = ? AND status = 'PENDING'`).all(batch)) {
          db.prepare(`UPDATE ${table} SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id IS ? AND ${col} = ? AND status = 'ACTIVE'`).run(actor.user, new Date().toISOString(), r.company_id, r[col]);
          db.prepare(`UPDATE ${table} SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, new Date().toISOString(), r.id);
          void ver;
        }
      }
      const any = db.prepare('SELECT company_id FROM doc_types WHERE batch_id = ? UNION SELECT company_id FROM doc_folder_templates WHERE batch_id = ? LIMIT 1').get(batch, batch);
      if (any) { writeAudit(db, { entity: 'doc_types', entityId: batch, action: 'activate', actor: actor.user, companyId: any.company_id }); publishEvent(db, { type: 'doc.config.changed', entity: 'document_config', entityId: batch, actorId: actor.user, companyId: any.company_id, data: { batch } }); }
    },
    onRejected: (db, { instance, actor }) => rejectConfig(db, Number(instance.docId), actor),
    onReturned: (db, { instance, actor }) => rejectConfig(db, Number(instance.docId), actor),
    onCancelled: (db, { instance, actor }) => rejectConfig(db, Number(instance.docId), actor),
  },
});
function rejectConfig(db, batch, actor) {
  for (const t of ['doc_types', 'doc_folder_templates']) db.prepare(`UPDATE ${t} SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE batch_id = ? AND status = 'PENDING'`).run(actor.user, new Date().toISOString(), batch);
}

// the files of a revision go through the file service; whoever may see the document may see its files, whoever may edit it, while it is a draft, may attach them (BR-03)
fileEntities.register({
  entity: 'doc_version', label: 'Document revision',
  resolve(db, actor, id) {
    const s = bound(db);
    const v = db.prepare('SELECT v.*, d.checked_out_by FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ? AND v.company_id = ? AND v.is_active = 1').get(Number(id), actor.companyId);
    if (!v || !s) return null;
    const d = db.prepare('SELECT * FROM doc_documents WHERE id = ?').get(v.document_id);
    const acc = s.access(actor, d);
    if (!acc.view) return null;
    const draft = ['DRAFT', 'RETURNED'].includes(v.status);
    return { companyId: d.company_id, projectId: d.project_id ?? null, siteId: d.site_id ?? null, canView: true, canEdit: acc.edit && draft && (!d.checked_out_by || d.checked_out_by === actor.user), locked: !draft };
  },
});

searchEntities.register({
  type: 'controlled_document', label: 'Documents', labelHi: 'दस्तावेज़', icon: 'erp.action.list', order: 35, permission: 'doc.document.view', table: 'doc_documents', statuses: ['DRAFT', 'IN_REVIEW', 'ISSUED', 'ARCHIVED'],
  events: ['doc.document.*'], eventEntity: 'controlled_document', permissionKeys: () => ['doc.document.view', 'doc.document.view_confidential', 'doc.document.view_restricted'],
  load(db, id) {
    const d = db.prepare('SELECT * FROM doc_documents WHERE id = ? AND is_active = 1').get(Number(id));
    if (!d || d.status === 'CANCELLED') return null;
    const v = d.current_version_id ? db.prepare('SELECT text_extract FROM doc_versions WHERE id = ?').get(d.current_version_id) : null;
    // BR-03: the right needed to find a confidential document is the right to see it; the index holds it under that key
    return { companyId: d.company_id, projectId: d.project_id, siteId: d.site_id, ownerUserId: d.owner_user_ref, code: d.doc_no, title: d.title, subtitle: `${d.doc_type} revision ${d.current_revision ?? '-'}`, body: [d.discipline, d.wbs_ref, d.location_ref, ...JSON.parse(d.tags_json || '[]'), (v?.text_extract ?? '').slice(0, 2000)].filter(Boolean), status: d.status, docDate: (d.updated_at ?? d.created_at).slice(0, 10), permissionKey: levelKey(d.confidentiality) };
  },
  route: (id) => `/documents/document?id=${id}`,
  access(db, actor, id) {
    const s = bound(db);
    const d = db.prepare('SELECT * FROM doc_documents WHERE id = ? AND is_active = 1').get(Number(id));
    if (!d || !s || !s.access(actor, d).view) return null;
    return { companyId: d.company_id, projectId: d.project_id ?? null, siteId: d.site_id ?? null, status: d.status };
  },
});

// documents with a validity date are what rules of the alert engine (04.09) watch: expiry of licences, insurance, certificates
alertDatasets.register({
  code: 'core.document', label: 'Documents with a validity date', ownerModule: 'documents', entity: 'document',
  fields: [{ key: 'docNo', label: 'Document number', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'docType', label: 'Type', type: 'text' }, { key: 'validUntil', label: 'Valid until', type: 'date' }, { key: 'daysToExpiry', label: 'Days to expiry', type: 'number' }, { key: 'owner', label: 'Owner', type: 'text' }],
  query(db, { companyId, today }) {
    return db.prepare("SELECT * FROM doc_documents WHERE company_id = ? AND is_active = 1 AND status = 'ISSUED' AND valid_until IS NOT NULL").all(companyId).map((d) => ({
      id: String(d.id), label: `${d.doc_no} ${d.title}`, route: `/documents/document?id=${d.id}`, projectId: d.project_id, siteId: d.site_id, owners: [d.owner_user_ref],
      fields: { docNo: d.doc_no, title: d.title, docType: d.doc_type, validUntil: d.valid_until, daysToExpiry: Math.round((Date.parse(d.valid_until) - Date.parse(today)) / 86_400_000), owner: d.owner_user_ref },
    }));
  },
});
