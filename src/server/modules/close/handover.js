import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv } from '../../platform/security/csv.js';
import { workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createBase, nowIso, rid } from '../proc/base.js';

/**
 * Part 26.02: project handover, as-builts, O&M manuals and the client asset register (built on the owner's instruction of 2026-11-25,
 * audit AUD-DEF-004).
 *
 *  - FR-01 A handover carries a checklist (as-built drawings, O&M manuals, warranties, statutory approvals, spares, training, test and
 *    commissioning certificates, snags, keys ...); each item is done with its evidence: a file, an issued document revision (04.10) or an
 *    issued commissioning certificate (26.01).
 *  - FR-02 The dossier: the index of every evidence by section, as JSON for the page and as a CSV index; the files download through the file
 *    service with its own access checks.
 *  - FR-03 The client asset register: tag, description, location, make, model, serial number, capacity, warranty and maintenance notes, the
 *    commissioning system it belongs to; exported as CSV for the client's facility management.
 *  - FR-04 A handover is for the whole project or an area (a location of the project or a named area), with its defects liability period.
 *  - FR-05 The handover certificate: requested by the project manager, approved by the project director through the workflow (07: PM -> PD ->
 *    client), then the project manager records the client's signatory, date and signed copy. Issue fixes the effective date and announces
 *    ho.handover.issued: the defects liability period (26.03) starts from it.
 *  - BR-01 The certificate is refused while a mandatory checklist item is not done, a class A snag of the area is open, or a commissioning
 *    system of the area has not reached ready for start-up. Checked at request and again when the client signs.
 */
export const HANDOVER_FLAG = 'ff.close.p2602';
export const HO_DOC = 'HO_CERTIFICATE';
export const CATEGORIES = ['AS_BUILT', 'OM_MANUAL', 'WARRANTY', 'STATUTORY', 'SPARES', 'TRAINING', 'TEST_CERTIFICATE', 'COMMISSIONING', 'SNAGS', 'KEYS', 'OTHER'];
/** The checklist a new handover starts with (each can be marked not applicable when it is not mandatory, or more items added). */
const DEFAULT_ITEMS = [
  ['AS_BUILT', 'As-built drawings', 1], ['OM_MANUAL', 'Operation and maintenance manuals', 1], ['WARRANTY', 'Warranties and guarantees', 1],
  ['STATUTORY', 'Statutory approvals and certificates (occupancy, fire, lift, electrical)', 1], ['TEST_CERTIFICATE', 'Test certificates', 1],
  ['COMMISSIONING', 'Commissioning certificates (ready for start-up)', 0], ['SPARES', 'Spares and tools handed over', 0],
  ['TRAINING', "Training of the client's operators", 0], ['SNAGS', 'Snag list closed', 1], ['KEYS', 'Keys, access cards and utility meters', 1],
];
const LIVE = ['DRAFT', 'SUBMITTED', 'APPROVED'];
const addMonths = (day, n) => { const [y, m, d] = day.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, last)); return t.toISOString().slice(0, 10); };
export { addMonths };

export function createHandover({ db }) {
  const base = createBase({ db });
  const { may, need, audit, number } = base;
  const scope = (actor, key, alias = 'h') => base.authz.scopeFilter(actor, key, { project: `${alias}.org_project_id`, site: `${alias}.org_site_id` }).sql;
  const row = (actor, id, key = 'ho.view') => {
    const h = db.prepare('SELECT * FROM ho_handovers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!h || !may(actor, 'ho.view', h.org_project_id, h.org_site_id)) throw notFound('That handover does not exist.');
    if (key !== 'ho.view') need(actor, key, 'do that for this handover', h.org_project_id, h.org_site_id);
    return h;
  };
  const editable = (h) => { if (!['DRAFT', 'REJECTED'].includes(h.status)) throw conflict(`${h.doc_no} is ${h.status.toLowerCase()}: its checklist and assets change while it is a draft or rejected.`); };
  const fileOk = (companyId, fileId) => Boolean(db.prepare('SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(fileId), companyId));
  const items = (id) => db.prepare('SELECT * FROM ho_checklist_items WHERE handover_id = ? AND deleted_at IS NULL ORDER BY id').all(id);
  const assets = (id) => db.prepare("SELECT * FROM ho_client_assets WHERE handover_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY tag_no").all(id);
  const hasTable = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

  // ---- readiness (BR-01) ------------------------------------------------------------------------------------------------------------------------
  function readiness(h) {
    const blockers = [];
    const open = items(h.id).filter((i) => i.mandatory && i.status !== 'DONE');
    if (open.length) blockers.push(`${open.length} mandatory checklist item(s) not done: ${open.map((i) => i.title).join('; ')}.`);
    const where = ["q.company_id = ? AND q.org_project_id = ? AND q.deleted_at IS NULL AND q.punch_class = 'A' AND q.status IN ('OPEN', 'RECTIFIED')"]; const args = [h.company_id, h.org_project_id];
    if (h.org_site_id) { where.push('q.org_site_id = ?'); args.push(h.org_site_id); }
    if (h.location_id) { where.push('q.location_id = ?'); args.push(h.location_id); }
    const snags = hasTable('qa_snags') ? db.prepare(`SELECT q.doc_no FROM qa_snags q WHERE ${where.join(' AND ')} ORDER BY q.id LIMIT 20`).all(...args) : [];
    if (snags.length) blockers.push(`Open class A snag(s): ${snags.map((s) => s.doc_no).join(', ')}.`);
    // The systems of the handover's scope: the whole project (narrowed to its site, if any); for an area, the systems of its site and the
    // systems its client assets belong to (systems carry no location, so an area without a site is matched through its assets only).
    const sw = ["s.company_id = ? AND s.org_project_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE' AND s.parent_id IS NULL AND s.stage != 'RFSU'"]; const sa = [h.company_id, h.org_project_id];
    const ofAssets = "s.id IN (SELECT a.tnc_system_id FROM ho_client_assets a WHERE a.handover_id = ? AND a.deleted_at IS NULL AND a.status = 'ACTIVE')";
    if (h.scope_type === 'PROJECT') { if (h.org_site_id) { sw.push('(s.org_site_id = ? OR s.org_site_id IS NULL)'); sa.push(h.org_site_id); } }
    else if (h.org_site_id) { sw.push(`(s.org_site_id = ? OR ${ofAssets})`); sa.push(h.org_site_id, h.id); }
    else { sw.push(ofAssets); sa.push(h.id); }
    const systems = hasTable('tnc_systems') ? db.prepare(`SELECT s.code FROM tnc_systems s WHERE ${sw.join(' AND ')} ORDER BY s.code LIMIT 20`).all(...sa) : [];
    if (systems.length) blockers.push(`Commissioning system(s) not ready for start-up: ${systems.map((s) => s.code).join(', ')}.`);
    return { ready: blockers.length === 0, blockers };
  }

  // ---- views ----------------------------------------------------------------------------------------------------------------------------------------
  const evidenceOf = (i) => {
    if (i.file_id) { const f = db.prepare('SELECT id, original_name FROM core_files WHERE id = ?').get(i.file_id); return { kind: 'FILE', fileId: i.file_id, ref: f?.original_name ?? `file ${i.file_id}` }; }
    if (i.doc_revision_id) { const v = db.prepare('SELECT v.id, v.revision, v.file_id, d.doc_no, d.title FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ?').get(i.doc_revision_id); return { kind: 'DOCUMENT', fileId: v?.file_id ?? null, ref: v ? `${v.doc_no} rev ${v.revision} ${v.title}` : `revision ${i.doc_revision_id}` }; }
    if (i.tnc_certificate_id) { const c = db.prepare('SELECT doc_no, kind, client_file_id FROM tnc_certificates WHERE id = ?').get(i.tnc_certificate_id); return { kind: 'CERTIFICATE', fileId: c?.client_file_id ?? null, ref: c ? `${c.kind} ${c.doc_no}` : `certificate ${i.tnc_certificate_id}` }; }
    return null;
  };
  const itemView = (i) => ({ id: i.id, category: i.category, title: i.title, mandatory: Boolean(i.mandatory), status: i.status, note: i.note, doneBy: i.done_by, doneAt: i.done_at, evidence: evidenceOf(i), version: i.version });
  const assetView = (a) => ({ id: a.id, handoverId: a.handover_id, systemId: a.tnc_system_id, tagNo: a.tag_no, description: a.description, category: a.category, location: a.location_text, make: a.make, model: a.model, serialNo: a.serial_no, capacity: a.capacity, warrantyUntil: a.warranty_until, maintenance: a.maintenance_note, version: a.version, handover: db.prepare('SELECT doc_no FROM ho_handovers WHERE id = ?').get(a.handover_id)?.doc_no ?? null, project: db.prepare('SELECT code FROM org_projects WHERE id = ?').get(a.org_project_id)?.code ?? null });
  const view = (h) => {
    const its = items(h.id);
    return { id: h.id, docNo: h.doc_no, title: h.title, projectId: h.org_project_id, siteId: h.org_site_id, locationId: h.location_id, scopeType: h.scope_type, areaLabel: h.area_label, plannedOn: h.planned_on, effectiveOn: h.effective_on, dlpMonths: h.dlp_months, dlpEndsOn: h.effective_on ? addMonths(h.effective_on, h.dlp_months) : null, status: h.status, requestedBy: h.requested_by, approvedAt: h.approved_at, clientSignatory: h.client_signatory, clientSignedOn: h.client_signed_on, clientFileId: h.client_file_id, issuedAt: h.issued_at, workflowInstanceId: h.workflow_instance_id, version: h.version, project: db.prepare('SELECT code FROM org_projects WHERE id = ?').get(h.org_project_id)?.code ?? null, items: { total: its.length, done: its.filter((i) => i.status !== 'OPEN').length, mandatoryOpen: its.filter((i) => i.mandatory && i.status !== 'DONE').length } };
  };

  const svc = {
    readiness: (actor, id) => readiness(row(actor, id)),
    list(actor, { projectId = null, status = null } = {}) {
      if (!base.authz.hasAnywhere(actor, 'ho.view')) throw forbidden('You may not see the handovers (permission ho.view).');
      const where = ['h.company_id = ?', 'h.deleted_at IS NULL', scope(actor, 'ho.view')]; const args = [actor.companyId];
      if (projectId) { where.push('h.org_project_id = ?'); args.push(rid(projectId)); } if (status) { where.push('h.status = ?'); args.push(status); }
      return db.prepare(`SELECT h.* FROM ho_handovers h WHERE ${where.join(' AND ')} ORDER BY h.id DESC LIMIT 500`).all(...args).map(view);
    },
    options(actor, { projectId = null } = {}) {
      if (!base.authz.hasAnywhere(actor, 'ho.view')) throw forbidden('You may not see the handovers (permission ho.view).');
      const projects = db.prepare('SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500').all(actor.companyId).filter((p) => may(actor, 'ho.view', p.id)).map((p) => ({ ...p }));
      if (!projectId || !projects.some((p) => p.id === rid(projectId))) return { projects, sites: [], locations: [], certificates: [], systems: [], categories: CATEGORIES };
      const pid = rid(projectId);
      return {
        projects, categories: CATEGORIES,
        sites: db.prepare('SELECT id, code, name FROM org_sites WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId, pid).map((x) => ({ ...x })),
        locations: hasTable('proj_locations') ? db.prepare('SELECT id, code, name FROM proj_locations WHERE company_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500').all(actor.companyId, pid).map((x) => ({ ...x })) : [],
        certificates: hasTable('tnc_certificates') ? db.prepare("SELECT c.id, c.doc_no AS docNo, c.kind, s.code AS system FROM tnc_certificates c JOIN tnc_systems s ON s.id = c.system_id WHERE c.company_id = ? AND s.org_project_id = ? AND c.status = 'ISSUED' AND c.deleted_at IS NULL ORDER BY c.id").all(actor.companyId, pid).map((x) => ({ ...x })) : [],
        systems: hasTable('tnc_systems') ? db.prepare('SELECT id, code, name FROM tnc_systems WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId, pid).map((x) => ({ ...x })) : [],
      };
    },
    create(actor, b) {
      const p = base.project(actor, b.projectId, 'ho.view', 'ho.manage');
      if (b.siteId && !base.siteOf(actor.companyId, p.id, b.siteId)) throw unprocessable('That site is not a site of the project.');
      if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND company_id = ? AND project_id = ? AND deleted_at IS NULL').get(rid(b.locationId), actor.companyId, p.id)) throw unprocessable('That location is not a location of the project.');
      if (b.scopeType === 'AREA' && !b.locationId && !b.areaLabel) throw unprocessable('An area handover names its location or area.');
      if (b.scopeType === 'PROJECT' && db.prepare("SELECT 1 FROM ho_handovers WHERE company_id = ? AND org_project_id = ? AND scope_type = 'PROJECT' AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED') AND deleted_at IS NULL").get(actor.companyId, p.id)) throw conflict('The project already has a whole-project handover.');
      return transaction(db, () => {
        const docNo = number(actor.companyId, actor.user, 'HO_HANDOVER', 'ho_handovers', 'HO');
        const id = Number(db.prepare("INSERT INTO ho_handovers (company_id, org_project_id, org_site_id, location_id, doc_no, title, scope_type, area_label, planned_on, dlp_months, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
          .run(actor.companyId, p.id, b.siteId ?? null, b.locationId ?? null, docNo, b.title, b.scopeType, b.areaLabel ?? null, b.plannedOn ?? null, b.dlpMonths, p.id, b.siteId ?? null, actor.user).lastInsertRowid);
        for (const [category, title, mandatory] of DEFAULT_ITEMS) db.prepare("INSERT INTO ho_checklist_items (company_id, handover_id, category, title, mandatory, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, id, category, title, mandatory, p.id, b.siteId ?? null, actor.user);
        audit(actor, 'ho_handovers', String(id), 'create', actor.companyId, { newValues: b });
        return svc.get(actor, id);
      });
    },
    get(actor, id) {
      const h = row(actor, id);
      return { ...view(h), checklist: items(h.id).map(itemView), assets: assets(h.id).map(assetView), readiness: readiness(h), can: { manage: may(actor, 'ho.manage', h.org_project_id, h.org_site_id), request: may(actor, 'ho.request', h.org_project_id, h.org_site_id), sign: may(actor, 'ho.sign', h.org_project_id, h.org_site_id), export: may(actor, 'ho.export', h.org_project_id, h.org_site_id) } };
    },
    addItem(actor, id, b) {
      const h = row(actor, id, 'ho.manage'); editable(h);
      const iid = Number(db.prepare("INSERT INTO ho_checklist_items (company_id, handover_id, category, title, mandatory, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, h.id, b.category, b.title, b.mandatory ? 1 : 0, h.org_project_id, h.org_site_id, actor.user).lastInsertRowid);
      audit(actor, 'ho_checklist_items', String(iid), 'create', actor.companyId, { newValues: b });
      return svc.get(actor, h.id);
    },
    /** FR-01: an item done with its evidence, or not applicable (only an item that is not mandatory), or open again. */
    recordItem(actor, itemId, b) {
      const i = db.prepare('SELECT * FROM ho_checklist_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(itemId), actor.companyId);
      if (!i) throw notFound('That checklist item does not exist.');
      const h = row(actor, i.handover_id, 'ho.manage'); editable(h);
      if (b.rowVersion != null && b.rowVersion !== i.version) throw conflict('The item changed since you opened it; reload and try again.');
      let file = null; let revision = null; let cert = null;
      if (b.status === 'NOT_APPLICABLE' && i.mandatory) throw unprocessable('A mandatory item is done, not set aside.');
      if (b.status === 'DONE') {
        if (b.fileId) { if (!fileOk(actor.companyId, b.fileId)) throw unprocessable('That file does not exist.'); file = rid(b.fileId); }
        if (b.docRevisionId) {
          const v = db.prepare('SELECT v.id, v.status, d.project_id FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ? AND v.company_id = ? AND d.deleted_at IS NULL').get(rid(b.docRevisionId), actor.companyId);
          if (!v || (v.project_id != null && v.project_id !== h.org_project_id) || !may(actor, 'doc.document.view', h.org_project_id)) throw unprocessable('That document revision is not a document of this project you may see.');
          if (v.status !== 'ISSUED') throw unprocessable('Only an issued revision goes into the dossier.');
          revision = v.id;
        }
        if (b.certificateId) {
          const c = db.prepare("SELECT c.id FROM tnc_certificates c JOIN tnc_systems s ON s.id = c.system_id WHERE c.id = ? AND c.company_id = ? AND s.org_project_id = ? AND c.status = 'ISSUED'").get(rid(b.certificateId), actor.companyId, h.org_project_id);
          if (!c) throw unprocessable('That is not an issued commissioning certificate of this project.'); cert = c.id;
        }
        if (!file && !revision && !cert && i.category !== 'SNAGS') throw unprocessable('Attach the evidence: a file, an issued document revision or a commissioning certificate.');
        if (i.category === 'COMMISSIONING' && !cert) throw unprocessable('A commissioning item is done with an issued commissioning certificate.');
      }
      if (b.status === 'NOT_APPLICABLE' && (b.note ?? '').length < 5) throw unprocessable('Say why the item does not apply (at least 5 characters).');
      db.prepare('UPDATE ho_checklist_items SET status = ?, file_id = ?, doc_revision_id = ?, tnc_certificate_id = ?, note = ?, done_by = ?, done_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.status, file, revision, cert, b.note ?? null, b.status === 'OPEN' ? null : actor.user, b.status === 'OPEN' ? null : nowIso(), actor.user, nowIso(), i.id);
      audit(actor, 'ho_checklist_items', String(i.id), b.status.toLowerCase(), actor.companyId, { newValues: { file, revision, cert }, reason: b.note });
      return svc.get(actor, h.id);
    },
    // FR-03 the client asset register
    addAsset(actor, id, b) {
      const h = row(actor, id, 'ho.manage'); editable(h);
      if (b.systemId && !db.prepare('SELECT 1 FROM tnc_systems WHERE id = ? AND company_id = ? AND org_project_id = ? AND deleted_at IS NULL').get(rid(b.systemId), actor.companyId, h.org_project_id)) throw unprocessable('That commissioning system is not a system of this project.');
      if (db.prepare('SELECT 1 FROM ho_client_assets WHERE handover_id = ? AND tag_no = ? AND deleted_at IS NULL').get(h.id, b.tagNo)) throw conflict(`The handover already lists ${b.tagNo}.`);
      const aid = Number(db.prepare("INSERT INTO ho_client_assets (company_id, handover_id, org_project_id, tnc_system_id, tag_no, description, category, location_text, make, model, serial_no, capacity, warranty_until, maintenance_note, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
        .run(actor.companyId, h.id, h.org_project_id, b.systemId ?? null, b.tagNo, b.description, b.category, b.location ?? null, b.make ?? null, b.model ?? null, b.serialNo ?? null, b.capacity ?? null, b.warrantyUntil ?? null, b.maintenance ?? null, h.org_project_id, h.org_site_id, actor.user).lastInsertRowid);
      audit(actor, 'ho_client_assets', String(aid), 'create', actor.companyId, { newValues: b });
      return svc.get(actor, h.id);
    },
    removeAsset(actor, assetId) {
      const a = db.prepare('SELECT * FROM ho_client_assets WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(assetId), actor.companyId); if (!a) throw notFound('That asset does not exist.');
      const h = row(actor, a.handover_id, 'ho.manage'); editable(h);
      db.prepare("UPDATE ho_client_assets SET status = 'CANCELLED', deleted_at = ?, deleted_by = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, a.id);
      audit(actor, 'ho_client_assets', String(a.id), 'delete', actor.companyId);
      return svc.get(actor, h.id);
    },
    assetRegister(actor, { projectId = null, handoverId = null } = {}) {
      if (!base.authz.hasAnywhere(actor, 'ho.view')) throw forbidden('You may not see the client asset register (permission ho.view).');
      const where = ["a.company_id = ? AND a.deleted_at IS NULL AND a.status = 'ACTIVE'", scope(actor, 'ho.view')]; const args = [actor.companyId];
      if (projectId) { where.push('h.org_project_id = ?'); args.push(rid(projectId)); } if (handoverId) { where.push('h.id = ?'); args.push(rid(handoverId)); }
      return db.prepare(`SELECT a.* FROM ho_client_assets a JOIN ho_handovers h ON h.id = a.handover_id WHERE ${where.join(' AND ')} ORDER BY h.id, a.tag_no LIMIT 2000`).all(...args).map(assetView);
    },
    assetExport(actor, q) {
      if (!base.authz.hasAnywhere(actor, 'ho.export')) throw forbidden('You may not export the client asset register (permission ho.export).');
      const rows = svc.assetRegister(actor, q);
      const headers = ['Handover', 'Project', 'Tag', 'Description', 'Category', 'Location', 'Make', 'Model', 'Serial number', 'Capacity', 'Warranty until', 'Maintenance'];
      audit(actor, 'ho_client_assets', '0', 'export', actor.companyId, { reason: `${rows.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `client-assets-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows.map((a) => [a.handover, a.project, a.tagNo, a.description, a.category, a.location ?? '', a.make ?? '', a.model ?? '', a.serialNo ?? '', a.capacity ?? '', a.warrantyUntil ?? '', a.maintenance ?? '']))}`, 'utf8') };
    },
    // FR-02 the dossier index
    dossier(actor, id) {
      const h = row(actor, id);
      const sections = CATEGORIES.map((category) => ({ category, items: items(h.id).filter((i) => i.category === category).map((i) => ({ title: i.title, status: i.status, mandatory: Boolean(i.mandatory), evidence: evidenceOf(i), note: i.note })) })).filter((s) => s.items.length);
      return { handover: view(h), sections, assets: assets(h.id).length };
    },
    dossierExport(actor, id) {
      const h = row(actor, id, 'ho.export'); const d = svc.dossier(actor, h.id);
      const rows = d.sections.flatMap((s, si) => s.items.map((i, ii) => [`${si + 1}.${ii + 1}`, s.category, i.title, i.mandatory ? 'Mandatory' : 'Optional', i.status, i.evidence?.kind ?? '', i.evidence?.ref ?? '', i.note ?? '']));
      audit(actor, 'ho_handovers', String(h.id), 'export', actor.companyId, { reason: 'dossier index' });
      return { contentType: 'text/csv; charset=utf-8', fileName: `dossier-${h.doc_no.replace(/[^A-Za-z0-9-]/g, '-')}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['No.', 'Section', 'Item', 'Mandatory', 'Status', 'Evidence', 'Reference', 'Note'], rows)}`, 'utf8') };
    },
    // FR-05 the certificate
    request(actor, id) {
      const h = row(actor, id, 'ho.request');
      if (!['DRAFT', 'REJECTED'].includes(h.status)) throw conflict(`${h.doc_no} is ${h.status.toLowerCase()}.`);
      const r = readiness(h);
      if (!r.ready) throw unprocessable(`The handover certificate is refused: ${r.blockers.join(' ')}`, r.blockers.map((m) => ({ field: 'readiness', message: m })));
      return transaction(db, () => {
        db.prepare("UPDATE ho_handovers SET status = 'SUBMITTED', requested_by = ?, readiness_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, JSON.stringify(r), actor.user, nowIso(), h.id);
        const inst = workflowOf(db).submit(actor, { docType: HO_DOC, docId: String(h.id), comment: `Handover ${h.doc_no}`, context: { projectId: h.org_project_id, siteId: h.org_site_id } });
        db.prepare('UPDATE ho_handovers SET workflow_instance_id = ? WHERE id = ?').run(inst.id, h.id);
        audit(actor, 'ho_handovers', String(h.id), 'request', actor.companyId);
        return svc.get(actor, h.id);
      });
    },
    decide(instance, actor, outcome, comment) {
      const h = db.prepare('SELECT * FROM ho_handovers WHERE id = ?').get(rid(instance.docId)); if (!h || h.status !== 'SUBMITTED') return;
      const status = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'CANCELLED' ? 'DRAFT' : 'REJECTED';
      db.prepare('UPDATE ho_handovers SET status = ?, approved_at = ?, remarks = COALESCE(?, remarks), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, status === 'APPROVED' ? nowIso() : null, comment ?? null, actor?.user ?? 'system', nowIso(), h.id);
      audit(actor, 'ho_handovers', String(h.id), outcome.toLowerCase(), h.company_id, { reason: comment ?? undefined });
    },
    clientSign(actor, id, b) {
      const h = row(actor, id, 'ho.sign');
      if (h.status !== 'APPROVED') throw conflict(`${h.doc_no} is ${h.status.toLowerCase()}: the client signs an approved handover.`);
      if (!fileOk(actor.companyId, b.fileId)) throw unprocessable('Attach the copy the client signed.');
      if (b.signedOn > todayIST()) throw unprocessable('The client signed on a day that has come.');
      const effectiveOn = b.effectiveOn ?? b.signedOn;
      if (effectiveOn > todayIST()) throw unprocessable('The handover takes effect on a day that has come.');
      const r = readiness(h);
      if (!r.ready) throw unprocessable(`The handover is no longer ready: ${r.blockers.join(' ')}`, r.blockers.map((m) => ({ field: 'readiness', message: m })));
      return transaction(db, () => {
        db.prepare("UPDATE ho_handovers SET status = 'ISSUED', client_signatory = ?, client_signed_on = ?, client_file_id = ?, effective_on = ?, issued_by = ?, issued_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.signatory, b.signedOn, rid(b.fileId), effectiveOn, actor.user, nowIso(), actor.user, nowIso(), h.id);
        audit(actor, 'ho_handovers', String(h.id), 'issue', actor.companyId, { newValues: { signatory: b.signatory, signedOn: b.signedOn, effectiveOn } });
        publishEvent(db, { type: 'ho.handover.issued', entity: 'ho_handovers', entityId: String(h.id), actorId: actor.user, companyId: actor.companyId, projectId: h.org_project_id, data: { handoverId: h.id, docNo: h.doc_no, projectId: h.org_project_id, siteId: h.org_site_id, locationId: h.location_id, scopeType: h.scope_type, areaLabel: h.area_label, effectiveOn, dlpMonths: h.dlp_months, dlpEndsOn: addMonths(effectiveOn, h.dlp_months), assets: assets(h.id).length } });
        return svc.get(actor, h.id);
      });
    },
    cancel(actor, id, { reason }) {
      const h = row(actor, id, 'ho.manage');
      if (!['DRAFT', 'REJECTED'].includes(h.status)) throw conflict(`${h.doc_no} is ${h.status.toLowerCase()}: only a draft or rejected handover is cancelled.`);
      db.prepare("UPDATE ho_handovers SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), h.id);
      audit(actor, 'ho_handovers', String(h.id), 'cancel', actor.companyId, { reason });
      return svc.get(actor, h.id);
    },
  };
  return svc;
}

const instances = new WeakMap();
export const handoverOf = (db) => { if (!instances.has(db)) instances.set(db, createHandover({ db })); return instances.get(db); };
export { LIVE };

workflowTypes.register({
  docType: HO_DOC, label: 'Handover certificate', processOwner: 'PD', route: (id) => `/close/handover?id=${id}`,
  describe(db, companyId, id) { const h = db.prepare('SELECT * FROM ho_handovers WHERE id = ?').get(rid(id)); return h && h.company_id === companyId ? { ref: h.doc_no, title: `Handover ${h.doc_no}: ${h.title}`.slice(0, 300), originator: h.requested_by, projectId: h.org_project_id, siteId: h.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const h = db.prepare('SELECT * FROM ho_handovers WHERE id = ?').get(rid(id)); if (!h) return null; const n = db.prepare("SELECT COUNT(*) AS n, SUM(status != 'OPEN') AS d FROM ho_checklist_items WHERE handover_id = ? AND deleted_at IS NULL").get(h.id); return { fields: [{ label: 'Handover', value: `${h.doc_no} ${h.title}` }, { label: 'Scope', value: h.scope_type === 'AREA' ? `Area: ${h.area_label ?? h.location_id}` : 'Whole project' }, { label: 'Checklist', value: `${n.d ?? 0} of ${n.n} items closed` }, { label: 'Defects liability', value: `${h.dlp_months} months from the effective date` }] }; },
  defaultDefinition: { name: 'Handover certificate: the project director approves what the project manager requested; the client signs after', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'PD', name: 'Project director', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'PD' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: {
    onApproved: (db, { instance, actor }) => handoverOf(db).decide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => handoverOf(db).decide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => handoverOf(db).decide(instance, actor, 'REJECTED', comment),
    onCancelled: (db, { instance, actor, comment }) => handoverOf(db).decide(instance, actor, 'CANCELLED', comment),
  },
});
