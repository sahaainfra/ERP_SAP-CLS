import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { todayIST } from '../../../shared/dates.js';
import {
  COPY_STATUS, DISCIPLINES, DRAWING_DOC, LINK_TYPES, ORIGINATORS, RANK, REV_STATUS, STATUS_CODES, nowIso, rid, same, esc,
} from './constants.js';

// Drawing control (part 11.01). The register holds one row per drawing (number, title, discipline, package, location, scale, size, originator) and one row per revision of it. A revision is received or uploaded as a draft, checked and, for issue for construction,
// approved (document controller, design coordinator, project manager) and issued. Issuing a revision supersedes the earlier issued ones it replaces (BR-02): the old revision is marked "SUPERSEDED, DO NOT USE", its file is closed to site teams, and the holders of its
// controlled copies are told and receive a copy of the new one to acknowledge. Only an issued IFC revision may be used to execute work (BR-01): `drawingUseCheck` is what work authorisation (14.01) reads.
const SUP = 'SUPERSEDED, DO NOT USE';
const services = new WeakMap();
export const bindEngg = (db, s) => services.set(db, s);
export const enggOf = (db) => services.get(db) ?? null;

export const drawingList = defineList({
  code: 'engg.drawings', label: 'Drawing register', permission: 'engg.drawing.view',
  from: 'engg_drawings x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.drawing_no', 'x.title', 'p.code', 'x.package_name', 'x.originator'], defaultSort: 'drawingNo',
  columns: {
    drawingNo: { sql: 'x.drawing_no', type: 'text', label: 'Drawing no.' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    discipline: { sql: 'x.discipline', type: 'enum', label: 'Discipline', options: Object.entries(DISCIPLINES) }, package: { sql: 'x.package_name', type: 'text', label: 'Package' },
    revision: { sql: 'x.current_revision', type: 'text', label: 'Revision' }, statusCode: { sql: 'x.current_status_code', type: 'enum', label: 'Status code', options: Object.entries(STATUS_CODES) },
    originatorType: { sql: 'x.originator_type', type: 'enum', label: 'Originator', options: Object.entries(ORIGINATORS) }, planned: { sql: 'x.planned_receipt', type: 'date', label: 'Planned receipt' }, actual: { sql: 'x.actual_receipt', type: 'date', label: 'Received' },
    response: { sql: 'x.response_code', type: 'enum', label: 'Response', options: [['A', 'A Approved'], ['B', 'B Approved with comments'], ['C', 'C Revise and resubmit'], ['D', 'D Rejected']] },
    overdue: { sql: "(CASE WHEN x.actual_receipt IS NULL AND x.planned_receipt IS NOT NULL AND x.planned_receipt < date('now', '+330 minutes') AND x.register_status = 'ACTIVE' THEN 1 ELSE 0 END)", type: 'number', label: 'Overdue' },
    registerStatus: { sql: 'x.register_status', type: 'enum', label: 'Register', options: [['ACTIVE', 'Active'], ['CANCELLED', 'Cancelled']] },
  },
});

export function createEnggService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const event = (type, actor, entity, id, companyId, projectId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const scopeSql = (actor, perm) => { const f = authz.scopeFilter(actor, perm, { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  function project(actor, projectId, key, base = 'engg.drawing.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id) || !may(actor, base, o.id)) throw notFound('That project does not exist.');
    if (key !== base) need(actor, key, 'do that with drawings', o.id);
    return o;
  }
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const today = () => todayIST();
  const staff = (actor, pid) => may(actor, 'engg.drawing.edit', pid) || may(actor, 'engg.drawing.approve', pid);

  // ---- views --------------------------------------------------------------------------------------------------------------------------------------------
  const fileOf = (revId) => { const f = db.prepare("SELECT id, original_name, extension, mime, size_bytes FROM core_files WHERE linked_entity = 'engg_drawing_revision' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY id DESC LIMIT 1").get(revId); return f ? { id: f.id, name: f.original_name, extension: f.extension, mime: f.mime, size: f.size_bytes } : null; };
  const revsOf = (drawingId) => db.prepare('SELECT * FROM engg_drawing_revisions WHERE drawing_id = ? AND deleted_at IS NULL ORDER BY rev_seq DESC').all(drawingId);
  function rview(actor, r, d) {
    const can = (k) => may(actor, k, r.org_project_id); const editable = ['DRAFT', 'RETURNED'].includes(r.rev_status); const seeFile = r.rev_status === 'ISSUED' || staff(actor, r.org_project_id);
    return {
      id: r.id, drawingId: r.drawing_id, seq: r.rev_seq, label: r.rev_label, statusCode: r.status_code, statusCodeLabel: STATUS_CODES[r.status_code], issuePurpose: r.issue_purpose, changeNote: r.change_note, cloudSummary: r.cloud_summary, receivedOn: r.received_on, issuedOn: r.issued_on,
      status: r.rev_status, statusLabel: REV_STATUS[r.rev_status], superseded: r.rev_status === 'SUPERSEDED', banner: r.rev_status === 'SUPERSEDED' ? SUP : null, supersededById: r.superseded_by_id, supersededAt: r.superseded_at, supersedesId: r.supersedes_id,
      file: seeFile ? fileOf(r.id) : null, fileHidden: !seeFile, requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, createdBy: r.created_by, rowVersion: r.version, needsApproval: r.status_code === 'IFC',
      can: { edit: can('engg.drawing.edit') && editable, submit: can('engg.drawing.submit') && editable, withdraw: r.rev_status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('engg.drawing.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.rev_status),
        delete: can('engg.drawing.delete') && r.rev_status === 'DRAFT' && !r.workflow_instance_id && (revsOf(r.drawing_id).length > 1 || !db.prepare("SELECT 1 FROM engg_transmittal_items WHERE drawing_id = ?").get(r.drawing_id)), distribute: can('engg.drawing.distribute') && r.rev_status === 'ISSUED' },
      drawingNo: d?.drawing_no,
    };
  }
  const linksOf = (id) => db.prepare('SELECT * FROM engg_drawing_links WHERE drawing_id = ? AND deleted_at IS NULL ORDER BY link_type, id').all(id).map((l) => ({ id: l.id, type: l.link_type, typeLabel: LINK_TYPES[l.link_type], targetId: l.target_id, ref: l.target_ref }));
  const copiesOf = (drawingId) => db.prepare("SELECT c.*, r.rev_label FROM engg_copies c JOIN engg_drawing_revisions r ON r.id = c.revision_id WHERE c.drawing_id = ? AND c.deleted_at IS NULL ORDER BY c.id DESC").all(drawingId).map((c) => ({ id: c.id, revisionId: c.revision_id, revision: c.rev_label, holder: c.holder_user, siteId: c.holder_site_id, copyNo: c.copy_no, issuedOn: c.issued_on, acknowledgedAt: c.acknowledged_at, status: c.copy_status, statusLabel: COPY_STATUS[c.copy_status], banner: c.copy_status === 'SUPERSEDED' ? SUP : null }));
  const respLabel = { A: 'A Approved', B: 'B Approved with comments', C: 'C Revise and resubmit', D: 'D Rejected' };
  function view(actor, d, { detail = false } = {}) {
    const o = orgOf(d.org_project_id); const can = (k) => may(actor, k, d.org_project_id); const today0 = today();
    const out = {
      id: d.id, projectId: d.org_project_id, projectCode: o?.code, projectName: o?.name, drawingNo: d.drawing_no, title: d.title, discipline: d.discipline, disciplineLabel: DISCIPLINES[d.discipline], packageName: d.package_name, wbsId: d.wbs_id, locationId: d.location_id, scale: d.scale, sheetSize: d.sheet_size,
      originatorType: d.originator_type, originatorLabel: ORIGINATORS[d.originator_type], originator: d.originator, documentId: d.document_id, plannedReceipt: d.planned_receipt, actualReceipt: d.actual_receipt,
      overdue: !d.actual_receipt && Boolean(d.planned_receipt) && d.planned_receipt < today0 && d.register_status === 'ACTIVE', currentRevisionId: d.current_revision_id, currentRevision: d.current_revision, currentStatusCode: d.current_status_code, currentStatusLabel: d.current_status_code ? STATUS_CODES[d.current_status_code] : null,
      currentIfcRevisionId: d.current_ifc_revision_id, usable: Boolean(d.current_ifc_revision_id) && d.register_status === 'ACTIVE', responseCode: d.response_code, responseLabel: d.response_code ? respLabel[d.response_code] : null, responseDate: d.response_date, registerStatus: d.register_status, rowVersion: d.version,
      can: { edit: can('engg.drawing.edit') && d.register_status === 'ACTIVE', create: can('engg.drawing.create'), amend: can('engg.drawing.amend') && d.register_status === 'ACTIVE', cancel: can('engg.drawing.cancel') && d.register_status === 'ACTIVE', distribute: can('engg.drawing.distribute'), print: can('engg.drawing.print'), export: can('engg.drawing.export') },
    };
    if (detail) {
      out.revisions = revsOf(d.id).map((r) => rview(actor, r, d)); out.links = linksOf(d.id); out.copies = copiesOf(d.id); out.rfis = [];
      out.transmittals = db.prepare('SELECT DISTINCT t.id, t.doc_no, t.direction, t.purpose, t.status, t.issued_on, i.response_code, r.rev_label FROM engg_transmittal_items i JOIN engg_transmittals t ON t.id = i.transmittal_id JOIN engg_drawing_revisions r ON r.id = i.revision_id WHERE i.drawing_id = ? AND i.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY t.id DESC').all(d.id)
        .map((t) => ({ id: t.id, docNo: t.doc_no, direction: t.direction, purpose: t.purpose, status: t.status, issuedOn: t.issued_on, revision: t.rev_label, responseCode: t.response_code }));
    }
    return out;
  }
  const row = (actor, id, key = 'engg.drawing.view') => {
    const d = db.prepare('SELECT * FROM engg_drawings WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!d || !may(actor, 'engg.drawing.view', d.org_project_id)) throw notFound('That drawing does not exist.');
    if (key !== 'engg.drawing.view') need(actor, key, 'do that with a drawing', d.org_project_id);
    return d;
  };
  const rrow = (actor, id, key = 'engg.drawing.view') => {
    const r = db.prepare('SELECT * FROM engg_drawing_revisions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'engg.drawing.view', r.org_project_id)) throw notFound('That revision does not exist.');
    if (key !== 'engg.drawing.view') need(actor, key, 'do that with a drawing revision', r.org_project_id);
    return r;
  };
  const dfresh = (id) => db.prepare('SELECT * FROM engg_drawings WHERE id = ?').get(id);

  // ---- the links and the fields --------------------------------------------------------------------------------------------------------------------------
  function problems(actor, o, b, drawingId = null) {
    const p = [];
    if (b.wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.wbsId, o.id)) p.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
    if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, o.id)) p.push({ field: 'locationId', message: 'Choose a location of this project' });
    if (b.documentId && !db.prepare('SELECT 1 FROM doc_documents WHERE id = ? AND company_id = ?').get(b.documentId, actor.companyId)) p.push({ field: 'documentId', message: 'Choose a document of your company' });
    for (const [i, l] of (b.links ?? []).entries()) {
      if (l.type === 'WBS' && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(l.targetId, o.id)) p.push({ field: `links.${i}.targetId`, message: 'Choose a WBS node of this project' });
      if (l.type === 'LOCATION' && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(l.targetId, o.id)) p.push({ field: `links.${i}.targetId`, message: 'Choose a location of this project' });
      if (l.type === 'BOQ' && !db.prepare('SELECT 1 FROM proj_boq_lines WHERE id = ? AND project_id = ?').get(l.targetId, o.id) && !db.prepare('SELECT 1 FROM proj_boq_items WHERE id = ? AND project_id = ?').get(l.targetId, o.id)) p.push({ field: `links.${i}.targetId`, message: 'Choose a BOQ item of this project' });
    }
    void drawingId; return p;
  }
  function writeLinks(actor, d, links) {
    db.prepare('UPDATE engg_drawing_links SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE drawing_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, d.id);
    const seen = new Set();
    for (const l of links) {
      const key = `${l.type}:${l.ref}`; if (seen.has(key)) continue; seen.add(key);
      db.prepare("INSERT INTO engg_drawing_links (company_id, drawing_id, org_project_id, link_type, target_id, target_ref, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'engg_drawings', ?)").run(d.company_id, d.id, d.org_project_id, l.type, l.targetId ?? null, l.ref, d.org_project_id, actor.user, String(d.id));
    }
  }
  const addRevision = (actor, d, b, supersedes = null) => {
    const seq = (db.prepare('SELECT MAX(rev_seq) AS n FROM engg_drawing_revisions WHERE drawing_id = ?').get(d.id).n ?? 0) + 1;
    if (db.prepare('SELECT 1 FROM engg_drawing_revisions WHERE drawing_id = ? AND lower(rev_label) = lower(?) AND deleted_at IS NULL AND rev_status NOT IN (\'CANCELLED\', \'REJECTED\')').get(d.id, b.label)) throw conflict(`Revision ${b.label} of ${d.drawing_no} exists already.`);
    return Number(db.prepare("INSERT INTO engg_drawing_revisions (company_id, drawing_id, org_project_id, rev_seq, rev_label, status_code, issue_purpose, change_note, cloud_summary, received_on, supersedes_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_drawings', ?)").run(d.company_id, d.id, d.org_project_id, seq, b.label, b.statusCode, b.issuePurpose ?? null, b.changeNote ?? null, b.cloudSummary ?? null, b.receivedOn ?? null, supersedes, d.org_project_id, actor.user, String(d.id)).lastInsertRowid);
  };

  // ---- issue and supersession (BR-02) ---------------------------------------------------------------------------------------------------------------------
  /** Which issued revisions a newly issued one replaces: IFC replaces IFR, IFA and IFC; IFA replaces IFR and IFA; IFR replaces IFR; as-built replaces as-built. */
  const replaces = (newCode, oldCode) => (newCode === 'ASBUILT' ? oldCode === 'ASBUILT' : oldCode !== 'ASBUILT' && RANK[oldCode] <= RANK[newCode]);
  function recompute(drawingId) {
    const issued = db.prepare("SELECT * FROM engg_drawing_revisions WHERE drawing_id = ? AND rev_status = 'ISSUED' AND deleted_at IS NULL ORDER BY rev_seq DESC").all(drawingId);
    const cur = issued[0] ?? null; const ifc = issued.find((r) => r.status_code === 'IFC') ?? null;
    db.prepare('UPDATE engg_drawings SET current_revision_id = ?, current_revision = ?, current_status_code = ?, current_ifc_revision_id = ?, version = version + 1 WHERE id = ?').run(cur?.id ?? null, cur?.rev_label ?? null, cur?.status_code ?? null, ifc?.id ?? null, drawingId);
  }
  function issue(actor, r) {
    const d = dfresh(r.drawing_id); const day = today();
    db.prepare("UPDATE engg_drawing_revisions SET rev_status = 'ISSUED', issued_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(day, actor.user, nowIso(), r.id);
    const old = db.prepare("SELECT * FROM engg_drawing_revisions WHERE drawing_id = ? AND rev_status = 'ISSUED' AND id <> ? AND deleted_at IS NULL").all(r.drawing_id, r.id).filter((x) => replaces(r.status_code, x.status_code));
    const holders = new Map();
    for (const x of old) {
      db.prepare("UPDATE engg_drawing_revisions SET rev_status = 'SUPERSEDED', superseded_by_id = ?, superseded_at = ?, version = version + 1 WHERE id = ?").run(r.id, nowIso(), x.id);
      for (const c of db.prepare("SELECT * FROM engg_copies WHERE revision_id = ? AND copy_status IN ('ISSUED', 'ACKNOWLEDGED') AND deleted_at IS NULL").all(x.id)) {
        const nid = Number(db.prepare("INSERT INTO engg_copies (company_id, drawing_id, revision_id, org_project_id, holder_user, holder_site_id, copy_no, issued_on, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_copies', ?)").run(c.company_id, c.drawing_id, r.id, c.org_project_id, c.holder_user, c.holder_site_id, c.copy_no, day, c.org_project_id, actor.user, String(c.id)).lastInsertRowid);
        db.prepare("UPDATE engg_copies SET copy_status = 'SUPERSEDED', replaced_by_id = ?, version = version + 1 WHERE id = ?").run(nid, c.id);
        if (!holders.has(c.holder_user.toLowerCase())) holders.set(c.holder_user.toLowerCase(), { user: c.holder_user, old: x });
      }
    }
    if (!d.actual_receipt) db.prepare('UPDATE engg_drawings SET actual_receipt = ? WHERE id = ?').run(r.received_on ?? day, d.id);
    recompute(d.id);
    const link = `/engg/drawing?id=${d.id}`;
    for (const h of holders.values()) {
      try { notificationsOf(db).notify({ companyId: d.company_id, templateCode: 'engg.drawing.superseded', recipients: [`user:${h.user}`], data: { drawing: d.drawing_no, title: d.title, oldRevision: h.old.rev_label, newRevision: r.rev_label, statusCode: r.status_code, link }, link, sourceType: 'engg_drawing', sourceId: d.id }); } catch { /* the revision stays issued; the notice is a convenience */ }
    }
    audit(actor, 'engg_drawing_revisions', r.id, 'issue', d.company_id, { newValues: { drawingNo: d.drawing_no, revision: r.rev_label, superseded: old.map((x) => x.rev_label) } });
    event('engg.drawing.issued', actor, 'engg_drawing', d.id, d.company_id, d.org_project_id, { projectId: d.org_project_id, drawingId: d.id, drawingNo: d.drawing_no, revisionId: r.id, revision: r.rev_label, statusCode: r.status_code, superseded: old.map((x) => ({ id: x.id, revision: x.rev_label })), holdersNotified: holders.size, wbsId: d.wbs_id, locationId: d.location_id });
    if (old.length) event('engg.drawing.superseded', actor, 'engg_drawing', d.id, d.company_id, d.org_project_id, { projectId: d.org_project_id, drawingId: d.id, drawingNo: d.drawing_no, by: r.rev_label, revisions: old.map((x) => x.rev_label), holdersNotified: [...holders.values()].map((h) => h.user) });
    return { superseded: old.length, holdersNotified: holders.size };
  }

  // ---- the drawings --------------------------------------------------------------------------------------------------------------------------------------
  const drawings = {
    list(actor, query) {
      need(actor, 'engg.drawing.view', 'see the drawing register'); const s = scopeSql(actor, 'engg.drawing.view');
      return runList(db, drawingList, parseListRequest(drawingList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, drawingNo: v.drawingNo, title: v.title, projectId: v.projectId, project: v.projectCode, currentRevisionId: v.currentRevisionId, discipline: v.disciplineLabel, package: v.packageName, revision: v.currentRevision, statusCode: v.currentStatusCode, planned: v.plannedReceipt, actual: v.actualReceipt, response: v.responseCode, overdue: v.overdue ? 1 : 0, usable: v.usable, registerStatus: v.registerStatus }; } });
    },
    exportSource(actor, req) {
      need(actor, 'engg.drawing.export', 'export the drawing register'); const s = scopeSql(actor, 'engg.drawing.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: drawingList.label, permission: 'engg.drawing.export', personal: false, columns: [{ key: 'drawingNo', label: 'Drawing no.', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'discipline', label: 'Discipline', type: 'text' }, { key: 'package', label: 'Package', type: 'text' }, { key: 'revision', label: 'Revision', type: 'text' }, { key: 'statusCode', label: 'Status code', type: 'text' }, { key: 'planned', label: 'Planned receipt', type: 'text' }, { key: 'actual', label: 'Received', type: 'text' }, { key: 'response', label: 'Response', type: 'text' }],
        rows: () => runList(db, drawingList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { drawingNo: v.drawingNo, title: v.title, project: v.projectCode, discipline: v.disciplineLabel, package: v.packageName ?? '', revision: v.currentRevision ?? '', statusCode: v.currentStatusCode ?? '', planned: v.plannedReceipt ?? '', actual: v.actualReceipt ?? '', response: v.responseCode ?? '' }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All drawings you may see'], count: () => countList(db, drawingList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.drawing.create'); fail(problems(actor, o, b));
      if (db.prepare('SELECT 1 FROM engg_drawings WHERE company_id = ? AND org_project_id = ? AND drawing_no = ? AND deleted_at IS NULL').get(actor.companyId, o.id, b.drawingNo)) throw conflict(`Drawing ${b.drawingNo} is in the register already.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO engg_drawings (company_id, org_project_id, drawing_no, title, discipline, package_name, wbs_id, location_id, scale, sheet_size, originator_type, originator, document_id, planned_receipt, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_drawings', ?)").run(o.company_id, o.id, b.drawingNo, b.title, b.discipline, b.packageName, b.wbsId, b.locationId, b.scale, b.sheetSize, b.originatorType, b.originator, b.documentId, b.plannedReceipt, o.id, actor.user, b.drawingNo).lastInsertRowid);
        const d = dfresh(id); writeLinks(actor, d, b.links ?? []); addRevision(actor, d, b.revision);
        audit(actor, 'engg_drawings', id, 'create', o.company_id, { newValues: { drawingNo: b.drawingNo, revision: b.revision.label } }); return drawings.get(actor, id);
      });
    },
    update(actor, id, b) {
      const d = row(actor, id, 'engg.drawing.edit'); if (d.register_status !== 'ACTIVE') throw conflict(`${d.drawing_no} is cancelled.`);
      if (b.rowVersion && b.rowVersion !== d.version) throw conflict('Someone changed this drawing; reload it.');
      const o = orgOf(d.org_project_id); fail(problems(actor, o, b));
      const m = { title: 'title', discipline: 'discipline', packageName: 'package_name', wbsId: 'wbs_id', locationId: 'location_id', scale: 'scale', sheetSize: 'sheet_size', originatorType: 'originator_type', originator: 'originator', documentId: 'document_id', plannedReceipt: 'planned_receipt' };
      return transaction(db, () => {
        const sets = Object.entries(m).filter(([k]) => k in b); if (sets.length) db.prepare(`UPDATE engg_drawings SET ${sets.map(([, c]) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map(([k]) => b[k]), actor.user, nowIso(), d.id);
        if (b.links) writeLinks(actor, d, b.links);
        audit(actor, 'engg_drawings', d.id, 'update', d.company_id, { newValues: Object.fromEntries(Object.keys(b).filter((k) => k !== 'rowVersion').map((k) => [k, b[k]])) }); return drawings.get(actor, d.id);
      });
    },
    remove(actor, id) {
      const d = row(actor, id, 'engg.drawing.delete'); const revs = revsOf(d.id);
      if (revs.some((r) => r.rev_status !== 'DRAFT' || r.workflow_instance_id) || db.prepare('SELECT 1 FROM engg_transmittal_items WHERE drawing_id = ? AND deleted_at IS NULL').get(d.id)) throw unprocessable('Only a drawing whose revisions are all drafts that were never sent, and that is on no transmittal, is deleted. Cancel it instead.');
      return transaction(db, () => { for (const t of ['engg_drawing_revisions', 'engg_drawing_links']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE drawing_id = ? AND deleted_at IS NULL`).run(nowIso(), actor.user, d.id); db.prepare('UPDATE engg_drawings SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, d.id); audit(actor, 'engg_drawings', d.id, 'delete', d.company_id); return { id: d.id, deleted: true }; });
    },
    cancel(actor, id, { reason }) {
      const d = row(actor, id, 'engg.drawing.cancel'); if (d.register_status !== 'ACTIVE') throw unprocessable('That drawing is cancelled already.');
      if (db.prepare("SELECT 1 FROM engg_drawing_revisions WHERE drawing_id = ? AND rev_status = 'SUBMITTED' AND deleted_at IS NULL").get(d.id)) throw conflict('A revision waits for approval: withdraw or cancel it first.');
      return transaction(db, () => {
        db.prepare("UPDATE engg_drawing_revisions SET rev_status = 'CANCELLED', version = version + 1 WHERE drawing_id = ? AND rev_status IN ('DRAFT', 'RETURNED') AND deleted_at IS NULL").run(d.id);
        db.prepare("UPDATE engg_drawings SET register_status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), d.id);
        audit(actor, 'engg_drawings', d.id, 'cancel', d.company_id, { reason }); return drawings.get(actor, d.id);
      });
    },
    history(actor, id) {
      const d = row(actor, id); const ids = revsOf(d.id).map((r) => r.id);
      const approvals = ids.length ? db.prepare(`SELECT h.event, h.actor, h.comment, h.at, h.step_code, r.rev_label AS revision FROM wf_history h JOIN engg_drawing_revisions r ON r.workflow_instance_id = h.instance_id WHERE r.drawing_id = ? ORDER BY h.id`).all(d.id) : [];
      return { approvals, audit: db.prepare("SELECT action, actor, reason, created_at AS at, entity FROM core_audit_log WHERE (entity = 'engg_drawings' AND entity_id = ?) OR (entity = 'engg_drawing_revisions' AND entity_id IN (SELECT CAST(id AS TEXT) FROM engg_drawing_revisions WHERE drawing_id = ?)) ORDER BY id").all(String(d.id), d.id) };
    },
    print(actor, id) {
      const d = row(actor, id, 'engg.drawing.print'); const v = view(actor, d, { detail: true });
      const rows = v.revisions.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.statusCode)}</td><td>${esc(r.statusLabel)}</td><td>${esc(r.issuedOn ?? '')}</td><td>${esc(r.changeNote ?? '')}</td></tr>`).join('');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.drawingNo)}</title></head><body><h1>${esc(v.drawingNo)}: ${esc(v.title)}</h1><p>${esc(v.projectCode)} · ${esc(v.disciplineLabel)} · ${esc(v.packageName ?? '')} · current revision ${esc(v.currentRevision ?? 'none')} ${esc(v.currentStatusCode ?? '')}</p><table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Rev.</th><th>Code</th><th>Status</th><th>Issued</th><th>Change note</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    },
    /** Rows of the register come in as a batch; a row that fails is reported and the rest are made. */
    import(actor, b) {
      const o = project(actor, b.projectId, 'engg.drawing.create'); const created = []; const errors = [];
      b.rows.forEach((r, i) => {
        try { const x = drawings.create(actor, { projectId: o.id, ...r, links: r.links ?? [] }); created.push({ row: i + 1, id: x.id, drawingNo: x.drawingNo }); } catch (e) { errors.push({ row: i + 1, drawingNo: r.drawingNo, message: e.details?.[0]?.message ?? e.message }); }
      });
      return { created: created.length, errors, rows: created };
    },
  };

  // ---- the revisions -------------------------------------------------------------------------------------------------------------------------------------
  const revisions = {
    get(actor, id) { const r = rrow(actor, id); return rview(actor, r, dfresh(r.drawing_id)); },
    update(actor, id, b) {
      const r = rrow(actor, id, 'engg.drawing.edit'); if (!['DRAFT', 'RETURNED'].includes(r.rev_status)) throw conflict(`Revision ${r.rev_label} is ${REV_STATUS[r.rev_status].toLowerCase()}: make a new revision by an amendment.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this revision; reload it.');
      if (b.label && b.label.toLowerCase() !== r.rev_label.toLowerCase() && db.prepare("SELECT 1 FROM engg_drawing_revisions WHERE drawing_id = ? AND lower(rev_label) = lower(?) AND id <> ? AND deleted_at IS NULL AND rev_status NOT IN ('CANCELLED', 'REJECTED')").get(r.drawing_id, b.label, r.id)) throw conflict(`Revision ${b.label} exists already.`);
      const m = { label: 'rev_label', statusCode: 'status_code', issuePurpose: 'issue_purpose', changeNote: 'change_note', cloudSummary: 'cloud_summary', receivedOn: 'received_on' };
      const sets = Object.entries(m).filter(([k]) => k in b); if (sets.length) db.prepare(`UPDATE engg_drawing_revisions SET ${sets.map(([, c]) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map(([k]) => b[k]), actor.user, nowIso(), r.id);
      audit(actor, 'engg_drawing_revisions', r.id, 'update', r.company_id); return revisions.get(actor, r.id);
    },
    remove(actor, id) {
      const r = rrow(actor, id, 'engg.drawing.delete'); if (r.rev_status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted.');
      if (revsOf(r.drawing_id).length < 2) throw unprocessable('This is the only revision: delete the drawing instead.');
      db.prepare('UPDATE engg_drawing_revisions SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'engg_drawing_revisions', r.id, 'delete', r.company_id); return { id: r.id, deleted: true };
    },
    /** A revision is sent: IFC goes to the document controller, the design coordinator and the project manager; the other codes are issued by the document controller at once. */
    submit(actor, id) {
      const r = rrow(actor, id, 'engg.drawing.submit'); if (!['DRAFT', 'RETURNED'].includes(r.rev_status)) throw unprocessable('Only a draft or a returned revision is sent.');
      const d = dfresh(r.drawing_id); if (d.register_status !== 'ACTIVE') throw conflict(`${d.drawing_no} is cancelled.`);
      const f = fileOf(r.id); if (!f) throw unprocessable('Attach the drawing file to the revision before it is sent.');
      return transaction(db, () => {
        db.prepare('UPDATE engg_drawing_revisions SET file_id = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(f.id, actor.user, actor.user, nowIso(), r.id);
        if (r.status_code !== 'IFC') { issue(actor, db.prepare('SELECT * FROM engg_drawing_revisions WHERE id = ?').get(r.id)); return revisions.get(actor, r.id); }
        const ctx = { projectId: r.org_project_id };
        if (r.rev_status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: DRAWING_DOC, docId: String(r.id), comment: `${d.drawing_no} rev ${r.rev_label} for construction`.slice(0, 300), context: ctx }); db.prepare('UPDATE engg_drawing_revisions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE engg_drawing_revisions SET rev_status = 'SUBMITTED' WHERE id = ?").run(r.id); audit(actor, 'engg_drawing_revisions', r.id, 'submit', r.company_id); return revisions.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = rrow(actor, id); if (r.rev_status !== 'SUBMITTED') throw unprocessable('Only a revision waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return revisions.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = rrow(actor, id, 'engg.drawing.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.rev_status)) throw unprocessable('Only a revision that is not yet issued is cancelled.');
      return transaction(db, () => { if (r.rev_status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE engg_drawing_revisions SET rev_status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'engg_drawing_revisions', r.id, 'cancel', r.company_id, { reason }); return revisions.get(actor, r.id); });
    },
    /** A new revision is begun from the current one; the file is attached to it and it is sent for issue. */
    amend(actor, drawingId, b) {
      const d = row(actor, drawingId, 'engg.drawing.amend'); if (d.register_status !== 'ACTIVE') throw conflict(`${d.drawing_no} is cancelled.`);
      if (db.prepare("SELECT 1 FROM engg_drawing_revisions WHERE drawing_id = ? AND rev_status IN ('DRAFT', 'RETURNED', 'SUBMITTED') AND deleted_at IS NULL").get(d.id)) throw conflict('A revision is in preparation or waiting for approval already.');
      return transaction(db, () => { const id = addRevision(actor, d, b, d.current_revision_id); audit(actor, 'engg_drawing_revisions', id, 'amend', d.company_id, { newValues: { revision: b.label, changeNote: b.changeNote } }); return revisions.get(actor, id); });
    },
    /** Two revisions side by side: what changed in the data, and the files for the viewer. A superseded file is shown only to staff. */
    compare(actor, q) {
      const a = rrow(actor, q.from); const b = rrow(actor, q.to); if (a.drawing_id !== b.drawing_id) throw unprocessable('Compare two revisions of the same drawing.');
      const d = dfresh(a.drawing_id); const va = rview(actor, a, d); const vb = rview(actor, b, d); const fields = ['label', 'statusCode', 'issuePurpose', 'changeNote', 'cloudSummary', 'receivedOn', 'issuedOn', 'status'];
      return { drawingId: d.id, drawingNo: d.drawing_no, from: va, to: vb, differences: fields.filter((f) => String(va[f] ?? '') !== String(vb[f] ?? '')).map((f) => ({ field: f, from: va[f] ?? null, to: vb[f] ?? null })) };
    },
    /** The decision of the approval chain. */
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM engg_drawing_revisions WHERE id = ?').get(rid(instance.docId)); if (!r || r.rev_status !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') { issue(actor, r); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE engg_drawing_revisions SET rev_status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, nowIso(), r.id);
      audit(actor, 'engg_drawing_revisions', r.id, outcome.toLowerCase(), r.company_id, { reason: comment ?? null });
    },
  };

  // ---- controlled copies and the site view ----------------------------------------------------------------------------------------------------------------
  const distribution = {
    distribute(actor, drawingId, b) {
      const d = row(actor, drawingId, 'engg.drawing.distribute'); const r = db.prepare('SELECT * FROM engg_drawing_revisions WHERE id = ? AND drawing_id = ? AND deleted_at IS NULL').get(b.revisionId, d.id);
      if (!r) throw notFound('That revision does not belong to this drawing.'); if (r.rev_status !== 'ISSUED') throw unprocessable(r.rev_status === 'SUPERSEDED' ? `Revision ${r.rev_label} is ${SUP}: distribute the current one.` : 'Only an issued revision is distributed.');
      const p = []; b.holders.forEach((h, i) => {
        if (!db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, h.user)) p.push({ field: `holders.${i}.user`, message: `${h.user} is not a user of your company` });
        if (h.siteId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND company_id = ?').get(h.siteId, actor.companyId)) p.push({ field: `holders.${i}.siteId`, message: 'Choose a site of your company' });
      }); fail(p);
      return transaction(db, () => {
        const made = [];
        for (const h of b.holders) {
          if (db.prepare("SELECT 1 FROM engg_copies WHERE revision_id = ? AND lower(holder_user) = lower(?) AND copy_status IN ('ISSUED', 'ACKNOWLEDGED') AND deleted_at IS NULL").get(r.id, h.user)) continue;
          for (let n = 1; n <= h.copies; n += 1) made.push(Number(db.prepare("INSERT INTO engg_copies (company_id, drawing_id, revision_id, org_project_id, holder_user, holder_site_id, copy_no, issued_on, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_drawings', ?)").run(d.company_id, d.id, r.id, d.org_project_id, h.user, h.siteId ?? null, n, today(), d.org_project_id, actor.user, String(d.id)).lastInsertRowid));
        }
        audit(actor, 'engg_drawings', d.id, 'distribute', d.company_id, { newValues: { revision: r.rev_label, copies: made.length } }); return { drawingId: d.id, revisionId: r.id, copiesMade: made.length, copies: copiesOf(d.id) };
      });
    },
    acknowledge(actor, copyId) {
      const c = db.prepare('SELECT * FROM engg_copies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(copyId), actor.companyId);
      if (!c || !may(actor, 'engg.drawing.view', c.org_project_id)) throw notFound('That copy does not exist.');
      if (!same(c.holder_user, actor.user)) throw forbidden('Only the holder of a controlled copy acknowledges it.'); if (c.copy_status === 'SUPERSEDED') throw unprocessable(`That copy is ${SUP}.`);
      if (c.copy_status === 'ACKNOWLEDGED') return { id: c.id, status: 'ACKNOWLEDGED', acknowledgedAt: c.acknowledged_at };
      db.prepare("UPDATE engg_copies SET copy_status = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, c.id); audit(actor, 'engg_copies', c.id, 'acknowledge', c.company_id); return { id: c.id, status: 'ACKNOWLEDGED', acknowledgedAt: nowIso() };
    },
    /** Current drawings for my site: only what may be built from (BR-01, FR-04): the current IFC of each drawing with the state of my controlled copy. Superseded revisions are not offered. */
    site(actor, q = {}) {
      need(actor, 'engg.drawing.view', 'see the drawings'); const s = scopeSql(actor, 'engg.drawing.view'); const where = ["x.deleted_at IS NULL", "x.register_status = 'ACTIVE'", 'x.current_ifc_revision_id IS NOT NULL', s.sql]; const params = { ...s.params };
      if (q.projectId) { where.push('x.org_project_id = :pid'); params.pid = Number(q.projectId); }
      if (q.locationId) { where.push('x.location_id = :lid'); params.lid = Number(q.locationId); }
      if (q.discipline) { where.push('x.discipline = :disc'); params.disc = q.discipline; }
      const rows = db.prepare(`SELECT x.*, p.code AS pcode FROM engg_drawings x JOIN org_projects p ON p.id = x.org_project_id WHERE ${where.join(' AND ')} ORDER BY p.code, x.drawing_no LIMIT 500`).all(params);
      return rows.map((d) => {
        const r = db.prepare('SELECT * FROM engg_drawing_revisions WHERE id = ?').get(d.current_ifc_revision_id); const c = db.prepare("SELECT * FROM engg_copies WHERE revision_id = ? AND lower(holder_user) = lower(?) AND copy_status IN ('ISSUED', 'ACKNOWLEDGED') AND deleted_at IS NULL ORDER BY id LIMIT 1").get(r.id, actor.user);
        return { drawingId: d.id, drawingNo: d.drawing_no, title: d.title, project: d.pcode, projectId: d.org_project_id, discipline: DISCIPLINES[d.discipline], locationId: d.location_id, revisionId: r.id, revision: r.rev_label, statusCode: r.status_code, issuedOn: r.issued_on, changeNote: r.change_note, file: fileOf(r.id), copyId: c?.id ?? null, copyStatus: c?.copy_status ?? null, copyStatusLabel: c ? COPY_STATUS[c.copy_status] : 'No controlled copy for you', acknowledged: c?.copy_status === 'ACKNOWLEDGED' };
      });
    },
  };

  // ---- the schedule, the dashboard and the use check ------------------------------------------------------------------------------------------------------
  const schedule = {
    /** FR-06: planned against actual receipt of each drawing, and the overdue report. */
    report(actor, q = {}) {
      need(actor, 'engg.drawing.view', 'see the drawing schedule'); const s = scopeSql(actor, 'engg.drawing.view'); const where = ["x.deleted_at IS NULL", "x.register_status = 'ACTIVE'", s.sql]; const params = { ...s.params };
      if (q.projectId) { where.push('x.org_project_id = :pid'); params.pid = Number(q.projectId); }
      const day = today(); const list = db.prepare(`SELECT x.*, p.code AS pcode FROM engg_drawings x JOIN org_projects p ON p.id = x.org_project_id WHERE ${where.join(' AND ')} ORDER BY x.planned_receipt IS NULL, x.planned_receipt, x.drawing_no LIMIT 1000`).all(params);
      const days = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
      const rows = list.map((d) => { const state = d.actual_receipt ? (d.planned_receipt && d.actual_receipt > d.planned_receipt ? 'LATE' : 'RECEIVED') : d.planned_receipt && d.planned_receipt < day ? 'OVERDUE' : 'PENDING'; return { drawingId: d.id, drawingNo: d.drawing_no, title: d.title, project: d.pcode, projectId: d.org_project_id, discipline: DISCIPLINES[d.discipline], package: d.package_name, planned: d.planned_receipt, actual: d.actual_receipt, state, varianceDays: d.planned_receipt ? days(d.actual_receipt ?? day, d.planned_receipt) : null }; });
      return { asOf: day, rows, overdue: rows.filter((r) => r.state === 'OVERDUE'), counts: { planned: rows.filter((r) => r.planned).length, received: rows.filter((r) => r.actual).length, overdue: rows.filter((r) => r.state === 'OVERDUE').length, late: rows.filter((r) => r.state === 'LATE').length } };
    },
  };
  const dashboard = {
    get(actor, q = {}) {
      need(actor, 'engg.drawing.view', 'see the drawings dashboard'); const s = scopeSql(actor, 'engg.drawing.view'); const params = { ...s.params }; let extra = ''; if (q.projectId) { extra = ' AND x.org_project_id = :pid'; params.pid = Number(q.projectId); }
      const one = (sql, p = params) => db.prepare(sql).get(p).n;
      const base = `FROM engg_drawings x WHERE x.deleted_at IS NULL AND x.register_status = 'ACTIVE' AND ${s.sql}${extra}`; const day = today();
      const byCode = Object.fromEntries(Object.keys(STATUS_CODES).map((c) => [c, one(`SELECT COUNT(*) AS n ${base} AND x.current_status_code = '${c}'`)]));
      const txBase = `FROM engg_transmittal_items i JOIN engg_transmittals x ON x.id = i.transmittal_id WHERE i.deleted_at IS NULL AND x.deleted_at IS NULL AND ${s.sql}${extra}`;
      const copyBase = `FROM engg_copies x WHERE x.deleted_at IS NULL AND ${s.sql}${extra}`;
      const out = {
        asOf: day, total: one(`SELECT COUNT(*) AS n ${base}`), planned: one(`SELECT COUNT(*) AS n ${base} AND x.planned_receipt IS NOT NULL AND x.planned_receipt <= :day`, { ...params, day }), received: one(`SELECT COUNT(*) AS n ${base} AND x.actual_receipt IS NOT NULL`), overdue: one(`SELECT COUNT(*) AS n ${base} AND x.actual_receipt IS NULL AND x.planned_receipt IS NOT NULL AND x.planned_receipt < :day`, { ...params, day }),
        byCode, noIfc: one(`SELECT COUNT(*) AS n ${base} AND x.current_ifc_revision_id IS NULL`), awaitingApproval: one(`SELECT COUNT(*) AS n FROM engg_drawing_revisions x WHERE x.deleted_at IS NULL AND x.rev_status = 'SUBMITTED' AND ${s.sql}${extra}`),
        pendingResponses: one(`SELECT COUNT(*) AS n ${txBase} AND x.direction = 'OUT' AND x.purpose = 'FOR_APPROVAL' AND x.status = 'ISSUED' AND i.response_code IS NULL`), responsesOverdue: one(`SELECT COUNT(*) AS n ${txBase} AND x.direction = 'OUT' AND x.purpose = 'FOR_APPROVAL' AND x.status = 'ISSUED' AND i.response_code IS NULL AND x.due_on IS NOT NULL AND x.due_on < :day`, { ...params, day }),
        copiesUnacknowledged: one(`SELECT COUNT(*) AS n ${copyBase} AND x.copy_status = 'ISSUED'`),
      };
      return { ...out, tiles: [['total', 'Drawings in the register', out.total], ['received', 'Received', out.received], ['planned', 'Due by today', out.planned], ['overdue', 'Overdue', out.overdue], ['ifc', 'With a current IFC', out.byCode.IFC], ['noIfc', 'With no current IFC', out.noIfc], ['pending', 'Waiting for approval', out.awaitingApproval], ['responses', 'Responses pending', out.pendingResponses], ['copies', 'Copies not acknowledged', out.copiesUnacknowledged]].map(([key, label, value]) => ({ key, label, value })) };
    },
  };
  /** BR-01: may this revision of this drawing be used to execute work? Work authorisation (14.01) reads this. */
  function useCheck(actor, q) {
    const o = orgOf(Number(q.projectId)); if (!o || o.company_id !== actor.companyId || (!actor.isSystem && !may(actor, 'engg.drawing.view', o.id))) throw notFound('That project does not exist.');
    const d = db.prepare('SELECT * FROM engg_drawings WHERE company_id = ? AND org_project_id = ? AND drawing_no = ? AND deleted_at IS NULL').get(actor.companyId, o.id, q.drawingNo);
    if (!d) return { usable: false, level: 'BLOCK', reason: 'NOT_IN_REGISTER', message: `${q.drawingNo} is not in the drawing register.` };
    const r = db.prepare("SELECT * FROM engg_drawing_revisions WHERE drawing_id = ? AND lower(rev_label) = lower(?) AND deleted_at IS NULL AND rev_status NOT IN ('CANCELLED', 'REJECTED') ORDER BY id DESC").get(d.id, q.revision);
    const cur = d.current_ifc_revision_id ? db.prepare('SELECT * FROM engg_drawing_revisions WHERE id = ?').get(d.current_ifc_revision_id) : null;
    const base = { drawingId: d.id, drawingNo: d.drawing_no, requested: q.revision, currentIfcRevision: cur?.rev_label ?? null };
    if (d.register_status !== 'ACTIVE') return { ...base, usable: false, level: 'BLOCK', reason: 'CANCELLED', message: `${d.drawing_no} is cancelled.` };
    if (!r) return { ...base, usable: false, level: 'BLOCK', reason: 'UNKNOWN_REVISION', message: `Revision ${q.revision} of ${d.drawing_no} is not in the register.` };
    if (r.rev_status === 'SUPERSEDED') return { ...base, usable: false, level: 'BLOCK', reason: 'SUPERSEDED', message: `${SUP}: revision ${r.rev_label} was replaced${cur ? ` by ${cur.rev_label}` : ''}.` };
    if (r.rev_status !== 'ISSUED' || r.status_code !== 'IFC') return { ...base, usable: false, level: 'BLOCK', reason: 'NOT_IFC', message: `Revision ${r.rev_label} is ${r.rev_status === 'ISSUED' ? STATUS_CODES[r.status_code].toLowerCase() : REV_STATUS[r.rev_status].toLowerCase()}, not issued for construction.` };
    return { ...base, usable: true, level: 'OK', reason: 'CURRENT_IFC', message: `Revision ${r.rev_label} is the current IFC.`, revisionId: r.id };
  }
  /** The projects the person may use the drawing pages for, and the master data a drawing refers to: WBS nodes and locations. */
  const options = {
    projects(actor) {
      need(actor, 'engg.drawing.view', 'see the drawings');
      return db.prepare('SELECT o.id, o.code, o.name FROM org_projects o JOIN proj_projects p ON p.project_id = o.id WHERE o.company_id = ? AND p.deleted_at IS NULL ORDER BY o.code').all(actor.companyId).filter((o) => may(actor, 'engg.drawing.view', o.id)).map((o) => ({ projectId: o.id, code: o.code, name: o.name }));
    },
    structure(actor, projectId) {
      const o = project(actor, projectId, 'engg.drawing.view');
      return { wbs: db.prepare('SELECT id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500').all(o.id), locations: db.prepare('SELECT id, code, name FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500').all(o.id) };
    },
  };
  return { options, drawings, revisions, distribution, schedule, dashboard, useCheck, issue, recompute, may, need, fail, project, orgOf, scopeSql, audit, event, today, fileOf, rrow, dfresh, view, rview, copiesOf, staff };
}

/** What 14.01 (work authorisation) and later parts read without a request: is the revision the current issued-for-construction one? */
export function drawingUseCheck(db, { companyId, projectId, drawingNo, revision }) {
  const svc = enggOf(db); if (!svc) return null;
  return svc.useCheck({ companyId, user: 'system', roles: ['SYSADM'], isSystem: true }, { projectId, drawingNo, revision });
}
/** The current IFC drawings linked to a WBS node, a location, a BOQ item or an activity (FR-05). */
export function drawingsForTarget(db, { projectId, type, targetId = null, ref = null }) {
  return db.prepare(`SELECT d.id, d.drawing_no, d.title, d.current_revision, d.current_ifc_revision_id FROM engg_drawing_links l JOIN engg_drawings d ON d.id = l.drawing_id WHERE l.org_project_id = ? AND l.link_type = ? AND l.deleted_at IS NULL AND d.deleted_at IS NULL AND d.register_status = 'ACTIVE' AND (${targetId != null ? 'l.target_id = ?' : 'l.target_ref = ?'}) ORDER BY d.drawing_no`).all(projectId, type, targetId ?? ref)
    .map((d) => ({ drawingId: d.id, drawingNo: d.drawing_no, title: d.title, currentRevision: d.current_revision, currentIfcRevisionId: d.current_ifc_revision_id, usable: Boolean(d.current_ifc_revision_id) }));
}

// ---- workflow, resolvers, evidence and the files of a revision -------------------------------------------------------------------------------------------
const userRoles = (u) => { try { return JSON.parse(u.roles_json ?? '[]'); } catch { return []; } };
/** The first check is made by a document controller other than the sender; when there is none, a construction manager checks. */
if (!workflowResolvers.get('engg.docCheck')) workflowResolvers.register('engg.docCheck', ({ db, companyId, instance }) => {
  const me = String(instance.submittedBy ?? '').toLowerCase();
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes('DOC') && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'CM' }];
});
if (!workflowResolvers.get('engg.pm')) workflowResolvers.register('engg.pm', ({ db, companyId, instance }) => {
  const oid = db.prepare('SELECT org_project_id AS n FROM engg_drawing_revisions WHERE id = ?').get(rid(instance.docId))?.n;
  const x = oid ? db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(oid) : null; const me = String(instance.submittedBy ?? '').toLowerCase();
  if (x?.pm_user && x.pm_user.toLowerCase() !== me) return [{ user: x.pm_user }];
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes('PM') && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'PD' }];
});
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const rline = (db, id) => db.prepare('SELECT r.*, d.drawing_no, d.title, d.discipline, p.code, p.name AS pname FROM engg_drawing_revisions r JOIN engg_drawings d ON d.id = r.drawing_id JOIN org_projects p ON p.id = r.org_project_id WHERE r.id = ?').get(id);
workflowTypes.register({
  docType: DRAWING_DOC, label: 'Issue of a drawing for construction', processOwner: 'DOC', route: (id) => `/engg/drawing?revision=${id}`,
  describe(db, companyId, id) { const r = rline(db, rid(id)); return r && r.company_id === companyId ? { ref: `${r.drawing_no} rev ${r.rev_label}`, title: `${r.code} ${r.title}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = rline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Drawing', value: `${r.drawing_no} · ${r.title}` }, { label: 'Revision', value: `${r.rev_label} (${STATUS_CODES[r.status_code]})` }, { label: 'Discipline', value: DISCIPLINES[r.discipline] }, { label: 'Change note', value: r.change_note ?? '' }, { label: 'Revision cloud', value: r.cloud_summary ?? '' }], lines: [] }; },
  defaultDefinition: { name: 'Drawing IFC issue: document control checks, design approves, the project manager releases', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DOC', 'Document control check', [{ kind: 'resolver', resolver: 'engg.docCheck' }]), step('DESIGN', 'Design coordinator', [{ kind: 'role', role: 'DESIGN' }]), step('PM', 'Project manager', [{ kind: 'resolver', resolver: 'engg.pm' }])] },
  hooks: { onApproved: (db, { instance, actor }) => enggOf(db)?.revisions.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => enggOf(db)?.revisions.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => enggOf(db)?.revisions.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => enggOf(db)?.revisions.decide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(DRAWING_DOC, ({ db, instance }) => {
  const r = rline(db, rid(instance.docId)); if (!r) return { sections: [] }; const prev = r.supersedes_id ? db.prepare('SELECT rev_label, status_code FROM engg_drawing_revisions WHERE id = ?').get(r.supersedes_id) : null; const f = db.prepare("SELECT original_name, size_bytes FROM core_files WHERE linked_entity = 'engg_drawing_revision' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY id DESC LIMIT 1").get(r.id);
  const holders = prev ? db.prepare("SELECT COUNT(DISTINCT holder_user) AS n FROM engg_copies WHERE drawing_id = ? AND copy_status IN ('ISSUED', 'ACKNOWLEDGED') AND deleted_at IS NULL").get(r.drawing_id).n : 0;
  return { sections: [{ code: 'engg-drawing', title: 'The revision to be issued', kind: 'metrics', items: [{ label: 'Drawing', value: `${r.drawing_no} ${r.title}`, format: 'text' }, { label: 'Revision', value: `${r.rev_label} ${r.status_code}`, format: 'text' }, { label: 'Replaces', value: prev ? `${prev.rev_label} ${prev.status_code}` : 'Nothing: the first issue', format: 'text' }, { label: 'File', value: f ? `${f.original_name} (${Math.round(f.size_bytes / 1024)} KB)` : 'None attached', format: 'text' }, { label: 'Holders of controlled copies to be told', value: String(holders), format: 'text' }, { label: 'Change note', value: r.change_note ?? '', format: 'text' }] }] };
});
// the files of a revision: whoever may see the drawing sees an issued revision; a superseded, draft or waiting revision is for the register staff only (FR-04)
fileEntities.register({
  entity: 'engg_drawing_revision', label: 'Drawing revision',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT * FROM engg_drawing_revisions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); const svc = enggOf(db);
    if (!r || !svc || !svc.may(actor, 'engg.drawing.view', r.org_project_id)) return null;
    const staff = svc.staff(actor, r.org_project_id); const editable = ['DRAFT', 'RETURNED'].includes(r.rev_status);
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: null, canView: r.rev_status === 'ISSUED' || staff, canEdit: editable && svc.may(actor, 'engg.drawing.edit', r.org_project_id), locked: !editable };
  },
});
void unprocessable;
