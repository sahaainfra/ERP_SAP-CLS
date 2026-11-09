import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { calcOf } from '../../platform/calc/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { dec } from '../../../shared/decimal.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { tendersOf } from '../bd/tender.js';
import { esc, json, nowIso, num, rid, same, units } from './constants.js';
import { estimatesOf } from './estimate.js';

// Quantity take-off, material take-off and bar bending schedules (part 09.02). A take-off sheet measures the quantities of a drawing revision line by line (number x length x breadth x height less deductions, by a formula
// template per kind of work: concrete volume, plaster area, excavation and so on); an engineering MTO lists the line items of an EPC package (piping, structural steel, electrical) with their specs, typed or pasted from the
// design tool. A bar bending schedule lists the bar marks of a member with the IS 2502 shape code, the cut length (legs, hooks and bend deductions configurable) and the weight (d x d / 162 kg/m). Every quantity comes from the
// calculation engine (mto.measure, mto.bbs_line, mto.requirement; BR-01). Both are released by a checker (QS or the design lead) and a released revision never changes: a new drawing revision is a new revision of the sheet,
// compared with the previous released one (BR-02, FR-05). A released take-off explodes its BOQ quantities into materials through the bills of resources (06.03) with wastage (FR-04) and feeds the quantities of a draft
// estimate (09.01, FR-06); a released BBS gives the steel by diameter for procurement. The requirements are stored and published for MRP (15.02).
export const TAKEOFF_DOC = 'MTO_TAKEOFF';
export const BBS_DOC = 'MTO_BBS';
export const STATUS = { DRAFT: 'Draft', SUBMITTED: 'With the checker', APPROVED: 'Released', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const DISCIPLINES = { CIVIL: 'Civil', STRUCTURAL: 'Structural steel', PIPING: 'Piping', ELECTRICAL: 'Electrical', MECHANICAL: 'Mechanical', OTHER: 'Other' };
const OPEN = ['DRAFT', 'SUBMITTED', 'RETURNED'];
/** FR-01: the formula templates: which dimensions a line of each kind uses and its unit. A DIRECT line (engineering MTO) carries its quantity as typed. */
/** @type {[string, string, string[], string | null][]} */
export const TEMPLATES = [
  ['CONCRETE_VOLUME', 'Concrete volume (L x B x D)', ['length', 'breadth', 'height'], 'CUM'], ['EXCAVATION', 'Excavation (L x B x depth)', ['length', 'breadth', 'height'], 'CUM'], ['BRICKWORK', 'Masonry volume (L x thickness x H)', ['length', 'breadth', 'height'], 'CUM'],
  ['PLASTER_AREA', 'Plaster or paint area (L x H)', ['length', 'height'], 'SQM'], ['FLOOR_AREA', 'Floor or slab area (L x B)', ['length', 'breadth'], 'SQM'], ['SHUTTERING', 'Formwork area (L x H)', ['length', 'height'], 'SQM'],
  ['RUNNING_LENGTH', 'Running length (L)', ['length'], 'RM'], ['COUNT', 'Number', [], 'NOS'], ['DIRECT', 'Quantity as given', [], null],
];
/** FR-02, BR-01: IS 2502 shape codes: the legs that add up to the length along the bar, the hooks (in bar diameters each) and the bends whose deductions are subtracted. */
const SHAPES = [
  { code: '00', name: 'Straight bar', legs: { a: 1 }, hooks: 0, hookD: 0, bends: {} }, { code: '11', name: 'L-bar (one 90° bend)', legs: { a: 1, b: 1 }, hooks: 0, hookD: 0, bends: { d90: 1 } },
  { code: '21', name: 'U-bar (two 90° bends)', legs: { a: 1, b: 1, c: 1 }, hooks: 0, hookD: 0, bends: { d90: 2 } }, { code: '33', name: 'Straight with two 180° hooks', legs: { a: 1 }, hooks: 2, hookD: 9, bends: {} },
  { code: '41', name: 'Crank bar (four 45° bends; b the inclined length)', legs: { a: 1, b: 1, c: 1 }, hooks: 0, hookD: 0, bends: { d45: 4 } }, { code: '51', name: 'Closed stirrup (rectangular, 135° hooks)', legs: { a: 2, b: 2 }, hooks: 2, hookD: 10, bends: { d90: 3 } },
  { code: '99', name: 'Other (legs a + b + c + d as given)', legs: { a: 1, b: 1, c: 1, d: 1 }, hooks: 0, hookD: 0, bends: {} },
];
for (const [key, dataType, def, description] of [
  ['mto.bbs.shape_codes', 'json', SHAPES, 'BR-01: the IS 2502 shape codes of the bar bending schedule: [{ code, name, legs: { a, b, c, d coefficients }, hooks, hookD (bar diameters per hook), bends: { d45, d90, d135 counts } }].'],
  ['mto.bbs.bend_deductions', 'json', { d45: 1, d90: 2, d135: 3 }, 'BR-01: the deduction of each bend, in bar diameters (IS 2502: 45° 1d, 90° 2d, 135° 3d).'],
  ['mto.bbs.steel_items', 'json', {}, 'FR-04: the item code of the reinforcement steel of each diameter, as { "12": "MAT-TMT-12" }, for the requirements of a BBS (a diameter without one is listed by its description).'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });

const listOf = (code, label, permission, from, extra) => defineList({
  code, label, permission, from, where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'x.drawing_ref', 'p.name'], defaultSort: '-docNo',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Number' }, revisionNo: { sql: 'x.revision_no', type: 'number', label: 'Revision' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, drawingRef: { sql: 'x.drawing_ref', type: 'text', label: 'Drawing' }, drawingRev: { sql: 'x.drawing_rev', type: 'text', label: 'Drawing revision' }, project: { sql: 'p.name', type: 'text', label: 'Project' }, ...extra, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) } },
});
export const takeoffList = listOf('est.takeoffs', 'Take-off sheets', 'est.takeoff.view', 'mto_takeoffs x LEFT JOIN org_projects p ON p.id = x.project_id', { kind: { sql: 'x.kind', type: 'enum', label: 'Kind', options: [['TAKEOFF', 'Take-off sheet'], ['ENGINEERING', 'Engineering MTO']] }, discipline: { sql: 'x.discipline', type: 'enum', label: 'Discipline', options: Object.entries(DISCIPLINES) } });
export const bbsList = listOf('est.bbs', 'Bar bending schedules', 'est.bb.view', 'mto_bbs x LEFT JOIN org_projects p ON p.id = x.project_id', { member: { sql: 'x.member', type: 'text', label: 'Member' }, weightKg: { sql: '(x.total_weight / 1000.0)', type: 'number', label: 'Weight (kg)' } });

export function createMtoService({ db }) {
  const authz = authzOf(db);
  const calc = () => calcOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const ev = (code, inputs, rec = null) => calc().evaluate(code, inputs, rec ? { entity: rec.entity, entityId: rec.id, field: rec.field, companyId: rec.companyId, user: rec.user } : {}).result;
  const event = (type, actor, entity, id, companyId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, data });
  const sees = (actor, key, projectId) => (projectId == null ? may(actor, key) : authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed);
  const scopeSql = (actor, key) => { const f = authz.scopeFilter(actor, key, { project: 'x.project_id' }); return { sql: `x.company_id = :c AND (x.project_id IS NULL OR ${f.sql})`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const projectOf = (id) => (id ? db.prepare('SELECT id, code, name FROM org_projects WHERE id = ?').get(id) ?? null : null);
  const shapes = (companyId) => { const s = param(companyId, 'mto.bbs.shape_codes'); return Array.isArray(s) && s.length ? s : SHAPES; };
  const deductions = (companyId) => ({ d45: 1, d90: 2, d135: 3, ...(param(companyId, 'mto.bbs.bend_deductions') ?? {}) });

  // ---- the shared life of a take-off and a BBS: revisions, the checker, release (BR-02) -------------------------------------------------------
  const KIND = {
    takeoff: { table: 'mto_takeoffs', lines: 'mto_takeoff_lines', fk: 'takeoff_id', doc: TAKEOFF_DOC, perm: 'est.takeoff', prefix: 'TO', entity: 'mto_takeoff', label: 'take-off sheet', route: (id) => `/est/takeoff?id=${id}` },
    bbs: { table: 'mto_bbs', lines: 'mto_bbs_lines', fk: 'bbs_id', doc: BBS_DOC, perm: 'est.bb', prefix: 'BBS', entity: 'mto_bbs', label: 'bar bending schedule', route: (id) => `/est/bbs/sheet?id=${id}` },
  };
  const row = (k, actor, id, key = `${KIND[k].perm}.view`) => {
    const r = db.prepare(`SELECT * FROM ${KIND[k].table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(rid(id), actor.companyId);
    if (!r || !sees(actor, key, r.project_id)) throw notFound(`That ${KIND[k].label} does not exist or is not yours to see.`);
    return r;
  };
  const editable = (k, actor, id, version) => {
    const r = row(k, actor, id); need(actor, `${KIND[k].perm}.edit`, `change ${KIND[k].label}s`);
    if (!['DRAFT', 'RETURNED'].includes(r.status)) throw new HttpError(409, 'LOCKED', `${r.doc_no} R${r.revision_no} is ${STATUS[r.status].toLowerCase()}; a change is a new revision.`);
    if (!same(r.created_by, actor.user)) throw forbidden('Only the person who prepared this revision changes it; make a new revision.');
    if (version != null && version !== r.version) throw conflict(`The ${KIND[k].label} was changed by someone else (version ${r.version}, you had ${version}); reload it.`);
    if (!sees(actor, `${KIND[k].perm}.edit`, r.project_id)) throw notFound(`That ${KIND[k].label} does not exist or is not yours to see.`);
    return r;
  };
  const bump = (k, actor, id) => db.prepare(`UPDATE ${KIND[k].table} SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, nowIso(), id);
  const nextNo = (k, actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: KIND[k].doc, actor: actor.user, refType: KIND[k].table }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    let n = db.prepare(`SELECT COUNT(DISTINCT doc_no) AS n FROM ${KIND[k].table} WHERE company_id = ?`).get(actor.companyId).n + 1; let no = `${KIND[k].prefix}-${String(n).padStart(5, '0')}`;
    while (db.prepare(`SELECT 1 FROM ${KIND[k].table} WHERE company_id = ? AND doc_no = ?`).get(actor.companyId, no)) { n += 1; no = `${KIND[k].prefix}-${String(n).padStart(5, '0')}`; }
    return no;
  };
  const previousReleased = (k, r) => db.prepare(`SELECT * FROM ${KIND[k].table} WHERE company_id = ? AND doc_no = ? AND revision_no < ? AND status IN ('APPROVED', 'SUPERSEDED') AND deleted_at IS NULL ORDER BY revision_no DESC LIMIT 1`).get(r.company_id, r.doc_no, r.revision_no) ?? null;
  const revisions = (k, actor, r) => db.prepare(`SELECT id, revision_no, drawing_rev, status, created_by, created_at, released_at FROM ${KIND[k].table} WHERE company_id = ? AND doc_no = ? AND deleted_at IS NULL ORDER BY revision_no DESC`).all(r.company_id, r.doc_no).map((x) => ({ id: x.id, revisionNo: x.revision_no, drawingRev: x.drawing_rev, status: x.status, statusLabel: STATUS[x.status], createdBy: x.created_by, createdAt: x.created_at, releasedAt: x.released_at }));
  const can = (k, actor, r) => {
    const mine = same(r.created_by, actor.user); const ed = ['DRAFT', 'RETURNED'].includes(r.status); const p = KIND[k].perm;
    const otherOpen = db.prepare(`SELECT 1 FROM ${KIND[k].table} WHERE company_id = ? AND doc_no = ? AND id != ? AND status = 'SUBMITTED' AND deleted_at IS NULL`).get(r.company_id, r.doc_no, r.id);
    return { edit: ed && mine && may(actor, `${p}.edit`), delete: r.status === 'DRAFT' && mine && may(actor, `${p}.delete`), submit: ed && mine && !otherOpen && may(actor, `${p}.submit`), withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: OPEN.includes(r.status) && mine && may(actor, `${p}.cancel`), revise: may(actor, `${p}.create`) && (r.status !== 'APPROVED' || may(actor, `${p}.amend`)), print: may(actor, `${p}.print`), export: may(actor, `${p}.export`) };
  };
  function lifecycle(k) {
    const K = KIND[k];
    return {
      submit(actor, id, prepare) {
        const r = editable(k, actor, id, null); need(actor, `${K.perm}.submit`, `send ${K.label}s to the checker`);
        if (db.prepare(`SELECT 1 FROM ${K.table} WHERE company_id = ? AND doc_no = ? AND id != ? AND status = 'SUBMITTED' AND deleted_at IS NULL`).get(r.company_id, r.doc_no, r.id)) throw conflict('Another revision is with the checker; withdraw it first.');
        const n = db.prepare(`SELECT COUNT(*) AS n FROM ${K.lines} WHERE ${K.fk} = ? AND deleted_at IS NULL`).get(r.id).n; if (!n) throw unprocessable(`A ${K.label} has at least one line.`, [{ field: 'lines', message: 'Add the lines first' }]);
        return transaction(db, () => {
          prepare?.(r);
          const ctx = { projectId: r.project_id, drawingRef: r.drawing_ref };
          if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
          else { const inst = workflowOf(db).submit(actor, { docType: K.doc, docId: String(r.id), comment: `${r.doc_no} R${r.revision_no}`, context: ctx }); db.prepare(`UPDATE ${K.table} SET workflow_instance_id = ? WHERE id = ?`).run(inst.id, r.id); }
          db.prepare(`UPDATE ${K.table} SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, actor.user, nowIso(), r.id);
          writeAudit(db, { entity: K.table, entityId: r.id, action: 'submit', actor: actor.user, companyId: r.company_id });
        });
      },
      withdraw(actor, id, reason) { const r = row(k, actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a revision with the checker is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); },
      cancel(actor, id, reason) {
        const r = row(k, actor, id); need(actor, `${K.perm}.cancel`, `cancel ${K.label}s`);
        if (!OPEN.includes(r.status) || !same(r.created_by, actor.user)) throw unprocessable('Only an open revision is cancelled, by the person who prepared it.');
        transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare(`UPDATE ${K.table} SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(reason, actor.user, nowIso(), r.id); writeAudit(db, { entity: K.table, entityId: r.id, action: 'cancel', reason, actor: actor.user, companyId: r.company_id }); });
      },
      remove(actor, id) {
        const r = row(k, actor, id); need(actor, `${K.perm}.delete`, `delete ${K.label}s`);
        if (r.status !== 'DRAFT' || !same(r.created_by, actor.user)) throw unprocessable('Only a draft revision is deleted, by the person who prepared it.');
        db.prepare(`UPDATE ${K.table} SET deleted_at = ?, deleted_by = ? WHERE id = ?`).run(nowIso(), actor.user, r.id); writeAudit(db, { entity: K.table, entityId: r.id, action: 'delete', actor: actor.user, companyId: r.company_id });
      },
      history(actor, id) { const r = row(k, actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all(K.table, String(r.id)) }; },
      /** FR-05: a new revision (a new drawing revision) copied from this one; a released one only with the amend right and a reason. */
      revise(actor, id, { reason, drawingRev, copyLines }) {
        const r = row(k, actor, id); need(actor, `${K.perm}.create`, `make ${K.label}s`);
        if (!sees(actor, `${K.perm}.create`, r.project_id)) throw forbidden('The project is outside your assignments.');
        if (r.status === 'APPROVED') need(actor, `${K.perm}.amend`, `revise released ${K.label}s`);
        return transaction(db, () => {
          const n = db.prepare(`SELECT MAX(revision_no) AS n FROM ${K.table} WHERE company_id = ? AND doc_no = ?`).get(r.company_id, r.doc_no).n + 1;
          const cols = Object.keys(r).filter((c) => !['id', 'revision_no', 'status', 'workflow_instance_id', 'requested_by', 'released_at', 'supersedes_id', 'created_by', 'created_at', 'updated_by', 'updated_at', 'version', 'deleted_at', 'deleted_by', 'source_type', 'source_id', 'remarks', 'drawing_rev'].includes(c));
          const nid = Number(db.prepare(`INSERT INTO ${K.table} (${cols.join(', ')}, revision_no, drawing_rev, status, supersedes_id, created_by, source_type, source_id, remarks) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`).run(...cols.map((c) => r[c]), n, drawingRev ?? r.drawing_rev, r.id, actor.user, K.entity, String(r.id), reason ?? null).lastInsertRowid);
          copyLines(r.id, nid);
          writeAudit(db, { entity: K.table, entityId: nid, action: 'revise', newValues: { from: `${r.doc_no} R${r.revision_no}`, revisionNo: n, drawingRev: drawingRev ?? r.drawing_rev }, reason: reason ?? null, actor: actor.user, companyId: r.company_id });
          return nid;
        });
      },
    };
  }
  const L = { takeoff: lifecycle('takeoff'), bbs: lifecycle('bbs') };
  function headerProblems(actor, perm, b, isNew) {
    const p = [];
    if (isNew) {
      if (!b.projectId && !b.tenderId) p.push({ field: 'projectId', message: 'A sheet is for a project or a tender' });
      if (b.projectId) { if (!db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.projectId, actor.companyId)) p.push({ field: 'projectId', message: 'Choose a project of your company' }); else if (!sees(actor, `${perm}.create`, b.projectId)) p.push({ field: 'projectId', message: 'The project is outside your assignments' }); }
      if (b.tenderId) { let t; try { t = tendersOf(db)?.tenderRow(actor, b.tenderId) ?? null; } catch { t = null; } if (!t) p.push({ field: 'tenderId', message: 'Choose a tender of your company that you can see' }); }
    }
    if (b.estimateId) { const e = estimatesOf(db)?.access(actor, b.estimateId); if (!e) p.push({ field: 'estimateId', message: 'Choose an estimate you can see' }); }
    return p;
  }

  // ---- take-off sheets and engineering MTOs (FR-01, FR-03) ----------------------------------------------------------------------------------
  const templates = () => TEMPLATES.map(([code, name, dims, uom]) => ({ code, name, dims, uom }));
  const tLines = (id) => db.prepare('SELECT l.*, w.code AS work_code, w.name AS work_name, m.code AS mat_code, m.name AS mat_name FROM mto_takeoff_lines l LEFT JOIN mdm_items w ON w.id = l.work_item_id LEFT JOIN mdm_items m ON m.id = l.material_item_id WHERE l.takeoff_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(id);
  const tLineView = (l) => ({ id: l.id, lineNo: l.line_no, boqItemRef: l.boq_item_ref, description: l.description, location: l.location, template: l.formula_code, workItemId: l.work_item_id, workItem: l.work_item_id ? { code: l.work_code, name: l.work_name } : null, materialItemId: l.material_item_id, materialItem: l.material_item_id ? { code: l.mat_code, name: l.mat_name } : null, spec: l.spec, nos: num(l.nos, 'quantity'), length: num(l.length, 'quantity'), breadth: num(l.breadth, 'quantity'), height: num(l.height, 'quantity'), deduction: num(l.deduction, 'quantity'), quantity: num(l.quantity, 'quantity'), uom: l.uom });
  /** The quantity of each BOQ item of a take-off (lines grouped by their reference and unit). */
  const byItem = (lines) => { const m = new Map(); for (const l of lines) { const k = `${(l.boq_item_ref ?? l.description).toLowerCase()}|${l.uom}`; const x = m.get(k) ?? { ref: l.boq_item_ref ?? null, description: l.description, uom: l.uom, qty: dec(0), lines: 0, workItemId: l.work_item_id, materialItemId: l.material_item_id }; x.qty = x.qty.add(dec(num(l.quantity, 'quantity'))); x.lines += 1; m.set(k, x); } return m; };
  function takeoffView(actor, t, { detail = false } = {}) {
    const p = projectOf(t.project_id); const tn = t.tender_id ? db.prepare('SELECT id, doc_no, name_of_work FROM tdr_tenders WHERE id = ?').get(t.tender_id) : null;
    const est = t.estimate_id ? db.prepare('SELECT id, doc_no, version_no, status FROM est_estimates WHERE id = ?').get(t.estimate_id) : null;
    const base = { id: t.id, docNo: t.doc_no, revisionNo: t.revision_no, ref: `${t.doc_no} R${t.revision_no}`, kind: t.kind, discipline: t.discipline, disciplineLabel: DISCIPLINES[t.discipline], title: t.title, projectId: t.project_id, project: p, tenderId: t.tender_id, tender: tn ? { id: tn.id, docNo: tn.doc_no, nameOfWork: tn.name_of_work } : null, estimateId: t.estimate_id, estimate: est ? { id: est.id, ref: `${est.doc_no}/v${est.version_no}`, status: est.status } : null, drawingRef: t.drawing_ref, drawingRev: t.drawing_rev, status: t.status, statusLabel: STATUS[t.status], rowVersion: t.version, requestedBy: t.requested_by, createdBy: t.created_by, releasedAt: t.released_at, workflowInstanceId: t.workflow_instance_id };
    if (!detail) return base;
    const lines = tLines(t.id);
    return { ...base, lines: lines.map(tLineView), items: [...byItem(lines).values()].map((x) => ({ ref: x.ref, description: x.description, uom: x.uom, qty: x.qty.round(3).toFixed(3), lines: x.lines })), templates: templates(), revisions: revisions('takeoff', actor, t), previousReleased: previousReleased('takeoff', t)?.id ?? null, can: can('takeoff', actor, t) };
  }
  /** One line measured: the template's dimensions through mto.measure; a DIRECT line keeps its quantity; the result is never below zero. */
  function measure(actor, l, i, p, kind) {
    const at = (f) => `lines.${i}.${f}`;
    const t = TEMPLATES.find(([c]) => c === l.template); if (!t) { p.push({ field: at('template'), message: 'Choose the formula template of the line' }); return null; }
    if (kind === 'TAKEOFF' && t[0] === 'DIRECT' && !l.materialItemId && !l.workItemId) p.push({ field: at('template'), message: 'A take-off line is measured; a quantity as given is for an engineering MTO or a line with its item' });
    const description = String(l.description ?? '').trim(); if (!description) p.push({ field: at('description'), message: 'Describe the line' });
    for (const [f, id] of [['workItemId', l.workItemId], ['materialItemId', l.materialItemId]]) if (id && !db.prepare('SELECT 1 FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId)) p.push({ field: at(f), message: 'Choose an item of your company' });
    let quantity = '0';
    if (t[0] === 'DIRECT') { if (l.quantity == null || l.quantity === '') p.push({ field: at('quantity'), message: 'Give the quantity' }); else quantity = String(l.quantity); }
    else {
      const dims = Object.fromEntries(['length', 'breadth', 'height'].map((d) => [d, t[2].includes(d) ? l[d] : '1']));
      for (const d of t[2]) if (l[d] == null || l[d] === '') p.push({ field: at(d), message: `Give the ${d}` });
      if (t[2].every((d) => l[d] != null && l[d] !== '')) {
        const gross = ev('mto.measure', { nos: String(l.nos ?? '1'), length: String(dims.length), breadth: String(dims.breadth), height: String(dims.height), deduction: '0' }).quantity;
        if (dec(String(l.deduction ?? '0')).gt(dec(gross))) p.push({ field: at('deduction'), message: `The deductions are more than the measured ${gross}` });
        else quantity = ev('mto.measure', { nos: String(l.nos ?? '1'), length: String(dims.length), breadth: String(dims.breadth), height: String(dims.height), deduction: String(l.deduction ?? '0') }).quantity;
      }
    }
    const uom = String(l.uom ?? t[3] ?? '').trim().toUpperCase(); if (!uom) p.push({ field: at('uom'), message: 'Give the unit' });
    const u = (v) => (v == null || v === '' ? null : units(v, 'quantity'));
    return { line_no: i + 1, boq_item_ref: l.boqItemRef?.trim() || null, description, location: l.location?.trim() || null, formula_code: t[0], work_item_id: l.workItemId ?? null, material_item_id: l.materialItemId ?? null, spec: l.spec?.trim() || null, nos: units(l.nos ?? '1', 'quantity'), length: t[2].includes('length') ? u(l.length) : null, breadth: t[2].includes('breadth') ? u(l.breadth) : null, height: t[2].includes('height') ? u(l.height) : null, deduction: units(l.deduction ?? '0', 'quantity'), quantity: units(quantity, 'quantity'), uom };
  }
  const writeTLines = (actor, t, lines) => {
    db.prepare('UPDATE mto_takeoff_lines SET deleted_at = ?, deleted_by = ? WHERE takeoff_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, t.id);
    for (const l of lines) db.prepare("INSERT INTO mto_takeoff_lines (company_id, takeoff_id, line_no, boq_item_ref, description, location, formula_code, work_item_id, material_item_id, spec, nos, length, breadth, height, deduction, quantity, uom, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mto_takeoff')")
      .run(t.company_id, t.id, l.line_no, l.boq_item_ref, l.description, l.location, l.formula_code, l.work_item_id, l.material_item_id, l.spec, l.nos, l.length, l.breadth, l.height, l.deduction, l.quantity, l.uom, actor.user);
  };
  const copyTLines = (from, to) => db.prepare("INSERT INTO mto_takeoff_lines (company_id, takeoff_id, line_no, boq_item_ref, description, location, formula_code, work_item_id, material_item_id, spec, nos, length, breadth, height, deduction, quantity, uom, created_by, source_type, source_id) SELECT company_id, ?, line_no, boq_item_ref, description, location, formula_code, work_item_id, material_item_id, spec, nos, length, breadth, height, deduction, quantity, uom, created_by, 'mto_takeoff_line', id FROM mto_takeoff_lines WHERE takeoff_id = ? AND deleted_at IS NULL").run(to, from);

  // ---- the material requirements (FR-04) ---------------------------------------------------------------------------------------------------
  /** The bill of resources of a work item (06.03), read through its own table (read-only adapter; the items service has no read call). */
  const bor = (itemId) => db.prepare('SELECT r.component_item_id, r.qty_per_unit, r.uom, r.wastage_pct, c.code, c.name, c.item_type FROM mdm_item_resources r JOIN mdm_items c ON c.id = r.component_item_id WHERE r.parent_item_id = ? AND r.deleted_at IS NULL ORDER BY r.sort_order, r.id').all(itemId);
  function explodeTakeoff(t) {
    const out = new Map(); const unexploded = [];
    const add = (key, x, net, gross) => { const y = out.get(key) ?? { ...x, net: dec(0), qty: dec(0), from: [] }; y.net = y.net.add(dec(net)); y.qty = y.qty.add(dec(gross)); y.from.push(x.boqItemRef ?? x.description); out.set(key, y); };
    for (const x of byItem(tLines(t.id)).values()) {
      const q = x.qty.round(3).toFixed(3);
      if (x.materialItemId) { const m = db.prepare('SELECT id, code, name FROM mdm_items WHERE id = ?').get(x.materialItemId); add(`${m.id}|${x.uom}`, { itemId: m.id, itemCode: m.code, description: m.name, uom: x.uom, wastagePct: '0', boqItemRef: x.ref }, q, q); continue; }
      const comps = x.workItemId ? bor(x.workItemId) : [];
      if (!comps.length) { unexploded.push({ ref: x.ref, description: x.description, qty: q, uom: x.uom, reason: x.workItemId ? 'The work item has no bill of resources' : 'No work item on the line' }); continue; }
      for (const c of comps) { const r = ev('mto.requirement', { quantity: q, per_unit: num(c.qty_per_unit, 'quantity'), wastage_percent: num(c.wastage_pct, 'percent') }); add(`${c.component_item_id}|${c.uom}`, { itemId: c.component_item_id, itemCode: c.code, description: c.name, uom: c.uom, wastagePct: num(c.wastage_pct, 'percent'), boqItemRef: x.ref, type: c.item_type }, r.net, r.gross); }
    }
    return { rows: [...out.values()].map((y) => ({ itemId: y.itemId, itemCode: y.itemCode, description: y.description, uom: y.uom, wastagePct: y.wastagePct, net: y.net.round(3).toFixed(3), qty: y.qty.round(3).toFixed(3), from: [...new Set(y.from)].join(', ') })), unexploded };
  }
  function explodeBbs(b) {
    const map = param(b.company_id, 'mto.bbs.steel_items') ?? {};
    return { rows: byDia(b.id).map((d) => { const code = map[String(d.dia)]; const it = code ? db.prepare('SELECT id, code, name FROM mdm_items WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(b.company_id, code) : null; return { itemId: it?.id ?? null, itemCode: it?.code ?? null, description: it?.name ?? `Reinforcement steel ${d.dia} mm`, uom: 'KG', wastagePct: '0', net: d.weightKg, qty: d.weightKg, from: `${d.dia} mm` }; }), unexploded: [] };
  }
  function storeRequirements(actor, kind, r, rows) {
    const st = kind === 'takeoff' ? 'mto_takeoff' : 'mto_bbs';
    db.prepare('UPDATE mto_material_requirements SET deleted_at = ?, deleted_by = ? WHERE source_type = ? AND source_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, st, String(r.id));
    for (const x of rows) db.prepare('INSERT INTO mto_material_requirements (company_id, source_type, source_id, source_ref, item_id, description, boq_item_ref, net_qty, wastage_pct, qty, uom, project_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.company_id, st, String(r.id), `${r.doc_no} R${r.revision_no}`, x.itemId, x.description, x.from || null, units(x.net, 'quantity'), units(x.wastagePct ?? '0', 'percent'), units(x.qty, 'quantity'), x.uom, r.project_id, actor.user);
  }

  function takeoffDelta(t, base) {
    if (base && base.doc_no !== t.doc_no) throw unprocessable('Compare two revisions of the same take-off.');
    const a = base ? byItem(tLines(base.id)) : new Map(); const b = byItem(tLines(t.id));
    const rows = [...new Set([...b.keys(), ...a.keys()])].map((k) => { const x = a.get(k); const y = b.get(k); const ref = y ?? x; const from = x ? x.qty.round(3) : dec(0); const to = y ? y.qty.round(3) : dec(0); return { ref: ref.ref, description: ref.description, uom: ref.uom, from: x ? from.toFixed(3) : null, to: y ? to.toFixed(3) : null, delta: to.sub(from).toFixed(3), change: !x ? 'ADDED' : !y ? 'REMOVED' : from.eq(to) ? 'SAME' : 'CHANGED' }; });
    return { kind: 'takeoff', current: { id: t.id, ref: `${t.doc_no} R${t.revision_no}`, drawingRev: t.drawing_rev, status: t.status }, base: base ? { id: base.id, ref: `${base.doc_no} R${base.revision_no}`, drawingRev: base.drawing_rev, status: base.status } : null, rows, counts: Object.fromEntries(['ADDED', 'REMOVED', 'CHANGED', 'SAME'].map((c) => [c.toLowerCase(), rows.filter((r) => r.change === c).length])) };
    }
  const takeoffs = {
    list(actor, query) { need(actor, 'est.takeoff.view', 'see take-off sheets'); const s = scopeSql(actor, 'est.takeoff.view'); return runList(db, takeoffList, parseListRequest(takeoffList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (t) => { const v = takeoffView(actor, t); return { id: v.id, docNo: v.docNo, revisionNo: v.revisionNo, ref: v.ref, title: v.title, drawingRef: v.drawingRef, drawingRev: v.drawingRev, project: v.project?.name ?? v.tender?.docNo ?? null, kind: v.kind, discipline: v.disciplineLabel, status: v.status, statusLabel: v.statusLabel }; } }); },
    exportSource(actor, req) {
    need(actor, 'est.takeoff.export', 'export take-off sheets'); const s = scopeSql(actor, 'est.takeoff.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
    return { title: takeoffList.label, permission: 'est.takeoff.export', personal: false, columns: Object.entries(takeoffList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, takeoffList, req, opts),
      rows: () => runList(db, takeoffList, req, { ...opts, limit: null, map: (t) => { const v = takeoffView(actor, t); return { docNo: v.docNo, revisionNo: v.revisionNo, title: v.title, drawingRef: v.drawingRef, drawingRev: v.drawingRev ?? '', project: v.project?.name ?? '', kind: v.kind, discipline: v.disciplineLabel, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : ''].filter(Boolean) };
    },
    templates,
    get(actor, id) { need(actor, 'est.takeoff.view', 'see take-off sheets'); return takeoffView(actor, row('takeoff', actor, id), { detail: true }); },
    create(actor, b) {
    need(actor, 'est.takeoff.create', 'prepare take-off sheets'); fail(headerProblems(actor, 'est.takeoff', b, true));
    return transaction(db, () => {
      const no = nextNo('takeoff', actor);
      const id = Number(db.prepare("INSERT INTO mto_takeoffs (company_id, doc_no, revision_no, kind, discipline, title, project_id, tender_id, estimate_id, drawing_ref, drawing_rev, status, created_by, source_type, source_id) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)")
        .run(actor.companyId, no, b.kind ?? 'TAKEOFF', b.discipline ?? 'CIVIL', b.title.trim(), b.projectId ?? null, b.tenderId ?? null, b.estimateId ?? null, b.drawingRef.trim(), b.drawingRev?.trim() || null, actor.user, b.projectId ? 'org_project' : 'tdr_tender', String(b.projectId ?? b.tenderId)).lastInsertRowid);
      writeAudit(db, { entity: 'mto_takeoffs', entityId: id, action: 'create', newValues: { docNo: no, drawingRef: b.drawingRef }, actor: actor.user, companyId: actor.companyId });
      return takeoffs.get(actor, id);
    });
    },
    update(actor, id, b) {
    const t = editable('takeoff', actor, id, b.version); fail(headerProblems(actor, 'est.takeoff', b, false));
    return transaction(db, () => {
      const sets = []; const vals = [];
      for (const [k, col] of [['title', 'title'], ['discipline', 'discipline'], ['drawingRef', 'drawing_ref'], ['drawingRev', 'drawing_rev'], ['estimateId', 'estimate_id']]) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(typeof b[k] === 'string' ? b[k].trim() || null : b[k]); }
      if (sets.length) db.prepare(`UPDATE mto_takeoffs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, t.id);
      bump('takeoff', actor, t.id); writeAudit(db, { entity: 'mto_takeoffs', entityId: t.id, action: 'update', newValues: b, actor: actor.user, companyId: t.company_id });
      return takeoffs.get(actor, t.id);
    });
    },
    /** FR-01, FR-03: the lines saved whole and measured on the server. */
    putLines(actor, id, { lines, version }) {
    const t = editable('takeoff', actor, id, version); const p = [];
    const out = lines.map((l, i) => measure(actor, l, i, p, t.kind)); fail(p);
    return transaction(db, () => { writeTLines(actor, t, out); bump('takeoff', actor, t.id); writeAudit(db, { entity: 'mto_takeoffs', entityId: t.id, action: 'lines', newValues: { lines: out.length }, actor: actor.user, companyId: t.company_id }); return takeoffs.get(actor, t.id); });
    },
    /** One line added by the Excel import (04.13) of an engineering MTO. */
    importLine(actor, { docNo, revisionNo, line }) {
    const t = db.prepare('SELECT * FROM mto_takeoffs WHERE company_id = ? AND doc_no = ? AND revision_no = ? AND deleted_at IS NULL').get(actor.companyId, docNo, Number(revisionNo ?? 0));
    if (!t) throw unprocessable(`Take-off ${docNo} R${revisionNo ?? 0} does not exist`);
    const e = editable('takeoff', actor, t.id, null); need(actor, 'est.takeoff.import', 'import MTOs');
    const p = []; const n = db.prepare('SELECT COALESCE(MAX(line_no), 0) AS n FROM mto_takeoff_lines WHERE takeoff_id = ? AND deleted_at IS NULL').get(e.id).n;
    const m = measure(actor, line, n, p, e.kind); if (p.length) throw unprocessable(p.map((x) => x.message).join('; '));
    db.prepare("INSERT INTO mto_takeoff_lines (company_id, takeoff_id, line_no, boq_item_ref, description, location, formula_code, work_item_id, material_item_id, spec, nos, length, breadth, height, deduction, quantity, uom, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'xl_import')")
      .run(e.company_id, e.id, n + 1, m.boq_item_ref, m.description, m.location, m.formula_code, m.work_item_id, m.material_item_id, m.spec, m.nos, m.length, m.breadth, m.height, m.deduction, m.quantity, m.uom, actor.user);
    bump('takeoff', actor, e.id); return { id: e.id, ref: `${e.doc_no} R${e.revision_no} line ${n + 1}` };
    },
    remove(actor, id) { L.takeoff.remove(actor, id); return { id: rid(id), deleted: true }; },
    submit(actor, id) { L.takeoff.submit(actor, id); return takeoffs.get(actor, id); },
    withdraw(actor, id, { reason }) { L.takeoff.withdraw(actor, id, reason); return takeoffs.get(actor, id); },
    cancel(actor, id, { reason }) { L.takeoff.cancel(actor, id, reason); return takeoffs.get(actor, id); },
    history: (actor, id) => L.takeoff.history(actor, id),
    revise(actor, id, b) { const nid = L.takeoff.revise(actor, id, { ...b, copyLines: copyTLines }); return takeoffs.get(actor, nid); },
    /** FR-05, T-02: the revision against the previous released one (or the one named), BOQ item by item. */
    delta(actor, id, withId = null) { const t = row('takeoff', actor, id); return takeoffDelta(t, withId ? row('takeoff', actor, withId) : previousReleased('takeoff', t)); },
    /** FR-04: the materials of the take-off (stored when released; worked out live before). */
    explosion(actor, id) {
    const t = row('takeoff', actor, id); const stored = db.prepare("SELECT r.*, m.code FROM mto_material_requirements r LEFT JOIN mdm_items m ON m.id = r.item_id WHERE r.source_type = 'mto_takeoff' AND r.source_id = ? AND r.deleted_at IS NULL ORDER BY r.id").all(String(t.id));
    const live = explodeTakeoff(t);
    return { source: { id: t.id, ref: `${t.doc_no} R${t.revision_no}`, status: t.status, kind: 'takeoff' }, stored: stored.length > 0, rows: stored.length ? stored.map((r) => ({ itemId: r.item_id, itemCode: r.code, description: r.description, uom: r.uom, wastagePct: num(r.wastage_pct, 'percent'), net: num(r.net_qty, 'quantity'), qty: num(r.qty, 'quantity'), from: r.boq_item_ref })) : live.rows, unexploded: live.unexploded };
    },
    /** FR-06: the quantities of a released take-off into the items of a draft estimate with the same BOQ item number. */
    applyToEstimate(actor, id, { estimateId }) {
    const t = row('takeoff', actor, id); if (t.status !== 'APPROVED') throw unprocessable('Only a released take-off feeds an estimate.');
    const target = estimateId ?? t.estimate_id; if (!target) throw badRequest('Choose the estimate', [{ field: 'estimateId', message: 'Choose the draft estimate to update' }]);
    const quantities = [...byItem(tLines(t.id)).values()].filter((x) => x.ref).map((x) => ({ itemNo: x.ref, qty: x.qty.round(3).toFixed(3) }));
    const r = estimatesOf(db).estimates.applyQuantities(actor, target, { quantities, source: `${t.doc_no} R${t.revision_no}` });
    writeAudit(db, { entity: 'mto_takeoffs', entityId: t.id, action: 'apply_to_estimate', newValues: { estimateId: target, matched: r.matched.length }, actor: actor.user, companyId: t.company_id });
    return r;
    },
    print(actor, id) {
    need(actor, 'est.takeoff.print', 'print take-off sheets'); const v = takeoffs.get(actor, id);
    writeAudit(db, { entity: 'mto_takeoffs', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
    const rows = v.lines.map((l) => `<tr><td>${l.lineNo}</td><td>${esc(l.boqItemRef)}</td><td>${esc(l.description)}${l.spec ? `<br><small>${esc(l.spec)}</small>` : ''}</td><td>${esc(l.nos)}</td><td>${esc(l.length ?? '')}</td><td>${esc(l.breadth ?? '')}</td><td>${esc(l.height ?? '')}</td><td>${esc(l.deduction)}</td><td style="text-align:right">${esc(l.quantity)}</td><td>${esc(l.uom)}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.ref)}</title><style>body{font:13px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body><h1>${v.kind === 'ENGINEERING' ? 'Engineering MTO' : 'Take-off sheet'} ${esc(v.ref)}</h1><p>${esc(v.title)} · drawing ${esc(v.drawingRef)} ${esc(v.drawingRev ?? '')} · ${esc(v.project?.name ?? v.tender?.docNo)} · ${esc(v.statusLabel)}</p><table><thead><tr><th>#</th><th>BOQ item</th><th>Description</th><th>No.</th><th>L</th><th>B</th><th>H/D</th><th>Deduct</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>${rows}</tbody></table><h2>By BOQ item</h2><ul>${v.items.map((i) => `<li>${esc(i.ref ?? i.description)}: ${esc(i.qty)} ${esc(i.uom)}</li>`).join('')}</ul></body></html>`;
    },
  };

  // ---- bar bending schedules (FR-02, BR-01) -------------------------------------------------------------------------------------------------
  const bLines = (id) => db.prepare('SELECT * FROM mto_bbs_lines WHERE bbs_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  const bLineView = (l) => ({ id: l.id, lineNo: l.line_no, member: l.member, barMark: l.bar_mark, dia: l.dia_mm, shapeCode: l.shape_code, a: num(l.dim_a, 'quantity'), b: num(l.dim_b, 'quantity'), c: num(l.dim_c, 'quantity'), d: num(l.dim_d, 'quantity'), membersCount: l.members_count, barsEach: l.bars_each, nos: l.nos, cutLength: num(l.cut_length_m, 'quantity'), totalLength: num(l.total_length_m, 'quantity'), unitWeight: num(l.unit_weight, 'quantity'), weightKg: num(l.weight_kg, 'quantity') });
  /** FR-02: the summary by diameter: total length, weight in kg and in tonnes. */
  function byDia(bbsId) {
    return db.prepare('SELECT dia_mm, COUNT(*) AS marks, SUM(nos) AS bars, SUM(total_length_m) AS len, SUM(weight_kg) AS w FROM mto_bbs_lines WHERE bbs_id = ? AND deleted_at IS NULL GROUP BY dia_mm ORDER BY dia_mm').all(bbsId)
    .map((x) => ({ dia: x.dia_mm, marks: x.marks, bars: x.bars, totalLength: num(x.len, 'quantity'), weightKg: dec(num(x.w, 'quantity')).round(3).toFixed(3), weightMt: dec(num(x.w, 'quantity')).div(1000, 6).round(3).toFixed(3) }));
  }
  function bbsView(actor, b, { detail = false } = {}) {
    const p = projectOf(b.project_id);
    const base = { id: b.id, docNo: b.doc_no, revisionNo: b.revision_no, ref: `${b.doc_no} R${b.revision_no}`, title: b.title, member: b.member, projectId: b.project_id, project: p, drawingRef: b.drawing_ref, drawingRev: b.drawing_rev, weightKg: dec(num(b.total_weight, 'quantity')).round(3).toFixed(3), status: b.status, statusLabel: STATUS[b.status], rowVersion: b.version, requestedBy: b.requested_by, createdBy: b.created_by, releasedAt: b.released_at, workflowInstanceId: b.workflow_instance_id };
    if (!detail) return base;
    return { ...base, lines: bLines(b.id).map(bLineView), byDia: byDia(b.id), shapes: shapes(b.company_id), deductions: deductions(b.company_id), revisions: revisions('bbs', actor, b), previousReleased: previousReleased('bbs', b)?.id ?? null, can: can('bbs', actor, b) };
  }
  /** One bar mark: its legs from the shape code, then mto.bbs_line for the cut length, the total length and the weight. */
  function bend(actor, b, l, i, p) {
    const at = (f) => `lines.${i}.${f}`; const sh = shapes(b.company_id).find((s) => s.code === l.shapeCode); const dd = deductions(b.company_id);
    if (!sh) { p.push({ field: at('shapeCode'), message: 'Choose a shape code of the library' }); return null; }
    if (!String(l.barMark ?? '').trim()) p.push({ field: at('barMark'), message: 'Give the bar mark' });
    const dia = Number(l.dia); if (!Number.isInteger(dia) || dia < 6 || dia > 50) p.push({ field: at('dia'), message: 'The diameter is a whole number of millimetres from 6 to 50' });
    const nos = Number(l.membersCount ?? 1) * Number(l.barsEach); if (!Number.isInteger(nos) || nos < 1) p.push({ field: at('barsEach'), message: 'Give the number of bars in each member' });
    let legs = dec(0);
    for (const [k, coef] of Object.entries(sh.legs ?? {})) { if (l[k] == null || l[k] === '') { p.push({ field: at(k), message: `Shape ${sh.code} needs the length ${k}` }); continue; } legs = legs.add(dec(String(l[k])).mul(dec(String(coef)))); }
    const bendD = Object.entries(sh.bends ?? {}).reduce((s, [k, n]) => s + Number(n) * Number(dd[k] ?? 0), 0);
    if (p.some((x) => x.field.startsWith(`lines.${i}.`))) return null;
    const r = ev('mto.bbs_line', { legs: legs.round(3).toFixed(3), hooks: String(sh.hooks ?? 0), hook_d: String(sh.hookD ?? 0), bend_d: String(bendD), dia_mm: String(dia), nos: String(nos) });
    const u = (v) => (v == null || v === '' ? null : units(v, 'quantity'));
    return { line_no: i + 1, member: String(l.member ?? b.member).trim() || b.member, bar_mark: String(l.barMark).trim(), dia_mm: dia, shape_code: sh.code, dim_a: u(l.a), dim_b: u(l.b), dim_c: u(l.c), dim_d: u(l.d), members_count: Number(l.membersCount ?? 1), bars_each: Number(l.barsEach), nos, cut_length_m: units(r.cut_length, 'quantity'), total_length_m: units(r.total_length, 'quantity'), unit_weight: units(r.unit_weight, 'quantity'), weight_kg: units(r.weight, 'quantity') };
  }
  const copyBLines = (from, to) => db.prepare("INSERT INTO mto_bbs_lines (company_id, bbs_id, line_no, member, bar_mark, dia_mm, shape_code, dim_a, dim_b, dim_c, dim_d, members_count, bars_each, nos, cut_length_m, total_length_m, unit_weight, weight_kg, created_by, source_type, source_id) SELECT company_id, ?, line_no, member, bar_mark, dia_mm, shape_code, dim_a, dim_b, dim_c, dim_d, members_count, bars_each, nos, cut_length_m, total_length_m, unit_weight, weight_kg, created_by, 'mto_bbs_line', id FROM mto_bbs_lines WHERE bbs_id = ? AND deleted_at IS NULL").run(to, from);
  const bbsTotal = (id) => db.prepare('UPDATE mto_bbs SET total_weight = (SELECT COALESCE(SUM(weight_kg), 0) FROM mto_bbs_lines WHERE bbs_id = ? AND deleted_at IS NULL) WHERE id = ?').run(id, id);
  function bbsDelta(x, base) {
    if (base && base.doc_no !== x.doc_no) throw unprocessable('Compare two revisions of the same bar bending schedule.');
    const key = (l) => `${l.member}|${l.bar_mark}`.toLowerCase();
    const a = new Map((base ? bLines(base.id) : []).map((l) => [key(l), l])); const b = new Map(bLines(x.id).map((l) => [key(l), l]));
    const rows = [...new Set([...b.keys(), ...a.keys()])].map((k) => { const p = a.get(k); const q = b.get(k); const ref = q ?? p; const w = (l) => (l ? dec(num(l.weight_kg, 'quantity')) : dec(0)); return { ref: `${ref.member} ${ref.bar_mark}`, description: `${ref.dia_mm} mm shape ${ref.shape_code}`, uom: 'KG', from: p ? w(p).toFixed(3) : null, to: q ? w(q).toFixed(3) : null, delta: w(q).sub(w(p)).toFixed(3), fromNos: p?.nos ?? null, toNos: q?.nos ?? null, change: !p ? 'ADDED' : !q ? 'REMOVED' : p.dia_mm === q.dia_mm && p.nos === q.nos && p.cut_length_m === q.cut_length_m && p.shape_code === q.shape_code ? 'SAME' : 'CHANGED' }; });
    const da = new Map((base ? byDia(base.id) : []).map((d) => [d.dia, d])); const dbm = new Map(byDia(x.id).map((d) => [d.dia, d]));
    const dias = [...new Set([...da.keys(), ...dbm.keys()])].sort((m, n) => m - n).map((d) => ({ dia: d, from: da.get(d)?.weightKg ?? '0.000', to: dbm.get(d)?.weightKg ?? '0.000', delta: dec(dbm.get(d)?.weightKg ?? '0').sub(dec(da.get(d)?.weightKg ?? '0')).toFixed(3) }));
    return { kind: 'bbs', current: { id: x.id, ref: `${x.doc_no} R${x.revision_no}`, drawingRev: x.drawing_rev, status: x.status }, base: base ? { id: base.id, ref: `${base.doc_no} R${base.revision_no}`, drawingRev: base.drawing_rev, status: base.status } : null, rows, byDia: dias, counts: Object.fromEntries(['ADDED', 'REMOVED', 'CHANGED', 'SAME'].map((c) => [c.toLowerCase(), rows.filter((r) => r.change === c).length])) };
    }
  const bbs = {
    list(actor, query) { need(actor, 'est.bb.view', 'see bar bending schedules'); const s = scopeSql(actor, 'est.bb.view'); return runList(db, bbsList, parseListRequest(bbsList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (b) => { const v = bbsView(actor, b); return { id: v.id, docNo: v.docNo, revisionNo: v.revisionNo, ref: v.ref, title: v.title, drawingRef: v.drawingRef, drawingRev: v.drawingRev, project: v.project?.name ?? null, member: v.member, weightKg: v.weightKg, status: v.status, statusLabel: v.statusLabel }; } }); },
    exportSource(actor, req) {
    need(actor, 'est.bb.export', 'export bar bending schedules'); const s = scopeSql(actor, 'est.bb.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
    return { title: bbsList.label, permission: 'est.bb.export', personal: false, columns: Object.entries(bbsList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, bbsList, req, opts),
      rows: () => runList(db, bbsList, req, { ...opts, limit: null, map: (b) => { const v = bbsView(actor, b); return { docNo: v.docNo, revisionNo: v.revisionNo, title: v.title, drawingRef: v.drawingRef, drawingRev: v.drawingRev ?? '', project: v.project?.name ?? '', member: v.member, weightKg: v.weightKg, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : ''].filter(Boolean) };
    },
    shapes: (actor) => { need(actor, 'est.bb.view', 'see bar bending schedules'); return { shapes: shapes(actor.companyId), deductions: deductions(actor.companyId) }; },
    get(actor, id) { need(actor, 'est.bb.view', 'see bar bending schedules'); return bbsView(actor, row('bbs', actor, id), { detail: true }); },
    create(actor, b) {
    need(actor, 'est.bb.create', 'prepare bar bending schedules'); const p = headerProblems(actor, 'est.bb', { ...b, tenderId: null }, true); if (!b.projectId) p.splice(0, p.length, ...p.filter((x) => x.field !== 'projectId'), { field: 'projectId', message: 'A bar bending schedule is for a project' }); fail(p);
    return transaction(db, () => {
      const no = nextNo('bbs', actor);
      const id = Number(db.prepare("INSERT INTO mto_bbs (company_id, doc_no, revision_no, title, project_id, drawing_ref, drawing_rev, member, status, created_by, source_type, source_id) VALUES (?, ?, 0, ?, ?, ?, ?, ?, 'DRAFT', ?, 'org_project', ?)").run(actor.companyId, no, b.title.trim(), b.projectId, b.drawingRef.trim(), b.drawingRev?.trim() || null, b.member.trim(), actor.user, String(b.projectId)).lastInsertRowid);
      writeAudit(db, { entity: 'mto_bbs', entityId: id, action: 'create', newValues: { docNo: no, member: b.member }, actor: actor.user, companyId: actor.companyId });
      return bbs.get(actor, id);
    });
    },
    update(actor, id, b) {
    const x = editable('bbs', actor, id, b.version);
    return transaction(db, () => { const sets = []; const vals = []; for (const [k, col] of [['title', 'title'], ['member', 'member'], ['drawingRef', 'drawing_ref'], ['drawingRev', 'drawing_rev']]) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(String(b[k]).trim() || null); } if (sets.length) db.prepare(`UPDATE mto_bbs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, x.id); bump('bbs', actor, x.id); writeAudit(db, { entity: 'mto_bbs', entityId: x.id, action: 'update', newValues: b, actor: actor.user, companyId: x.company_id }); return bbs.get(actor, x.id); });
    },
    putLines(actor, id, { lines, version }) {
    const x = editable('bbs', actor, id, version); const p = [];
    const out = lines.map((l, i) => bend(actor, x, l, i, p));
    const marks = new Map(); out.forEach((l, i) => { if (!l) return; const k = `${l.member}|${l.bar_mark}`.toLowerCase(); if (marks.has(k)) p.push({ field: `lines.${i}.barMark`, message: `Bar mark ${l.bar_mark} of ${l.member} is listed twice` }); marks.set(k, i); });
    fail(p);
    return transaction(db, () => {
      db.prepare('UPDATE mto_bbs_lines SET deleted_at = ?, deleted_by = ? WHERE bbs_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, x.id);
      for (const l of out) db.prepare("INSERT INTO mto_bbs_lines (company_id, bbs_id, line_no, member, bar_mark, dia_mm, shape_code, dim_a, dim_b, dim_c, dim_d, members_count, bars_each, nos, cut_length_m, total_length_m, unit_weight, weight_kg, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mto_bbs')")
        .run(x.company_id, x.id, l.line_no, l.member, l.bar_mark, l.dia_mm, l.shape_code, l.dim_a, l.dim_b, l.dim_c, l.dim_d, l.members_count, l.bars_each, l.nos, l.cut_length_m, l.total_length_m, l.unit_weight, l.weight_kg, actor.user);
      bbsTotal(x.id); bump('bbs', actor, x.id); writeAudit(db, { entity: 'mto_bbs', entityId: x.id, action: 'lines', newValues: { lines: out.length }, actor: actor.user, companyId: x.company_id });
      return bbs.get(actor, x.id);
    });
    },
    remove(actor, id) { L.bbs.remove(actor, id); return { id: rid(id), deleted: true }; },
    submit(actor, id) { L.bbs.submit(actor, id); return bbs.get(actor, id); },
    withdraw(actor, id, { reason }) { L.bbs.withdraw(actor, id, reason); return bbs.get(actor, id); },
    cancel(actor, id, { reason }) { L.bbs.cancel(actor, id, reason); return bbs.get(actor, id); },
    history: (actor, id) => L.bbs.history(actor, id),
    revise(actor, id, b) { const nid = L.bbs.revise(actor, id, { ...b, copyLines: copyBLines }); bbsTotal(nid); return bbs.get(actor, nid); },
    /** FR-05, T-02: bar mark by bar mark, and the weight by diameter, against the previous released revision. */
    delta(actor, id, withId = null) { const x = row('bbs', actor, id); return bbsDelta(x, withId ? row('bbs', actor, withId) : previousReleased('bbs', x)); },
    /** FR-02: the steel of the released schedules of a project (or of one schedule) by diameter. */
    summary(actor, { projectId = null, bbsId = null } = /** @type {any} */ ({})) {
    need(actor, 'est.bb.view', 'see bar bending schedules');
    let ids;
    if (bbsId) ids = [row('bbs', actor, bbsId).id];
    else { const s = scopeSql(actor, 'est.bb.view'); ids = db.prepare(`SELECT x.id FROM mto_bbs x WHERE ${s.sql} AND x.deleted_at IS NULL AND x.status = 'APPROVED'${projectId ? ' AND x.project_id = :p' : ''}`).all({ ...s.params, ...(projectId ? { p: projectId } : {}) }).map((r) => r.id); }
    const per = new Map(); const schedules = [];
    for (const id of ids) { const b = db.prepare('SELECT * FROM mto_bbs WHERE id = ?').get(id); schedules.push({ id: b.id, ref: `${b.doc_no} R${b.revision_no}`, member: b.member, status: b.status, weightKg: dec(num(b.total_weight, 'quantity')).round(3).toFixed(3) }); for (const d of byDia(id)) { const y = per.get(d.dia) ?? { dia: d.dia, marks: 0, bars: 0, len: dec(0), w: dec(0) }; y.marks += d.marks; y.bars += d.bars; y.len = y.len.add(dec(d.totalLength)); y.w = y.w.add(dec(d.weightKg)); per.set(d.dia, y); } }
    const rows = [...per.values()].sort((a, b) => a.dia - b.dia).map((y) => ({ dia: y.dia, marks: y.marks, bars: y.bars, totalLength: y.len.round(3).toFixed(3), weightKg: y.w.round(3).toFixed(3), weightMt: y.w.div(1000, 6).round(3).toFixed(3) }));
    const total = rows.reduce((s, r) => s.add(dec(r.weightKg)), dec(0));
    return { rows, schedules, totalKg: total.round(3).toFixed(3), totalMt: total.div(1000, 6).round(3).toFixed(3) };
    },
    explosion(actor, id) { const b = row('bbs', actor, id); return { source: { id: b.id, ref: `${b.doc_no} R${b.revision_no}`, status: b.status, kind: 'bbs' }, stored: b.status === 'APPROVED', ...explodeBbs(b) }; },
    print(actor, id) {
    need(actor, 'est.bb.print', 'print bar bending schedules'); const v = bbs.get(actor, id);
    writeAudit(db, { entity: 'mto_bbs', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
    const rows = v.lines.map((l) => `<tr><td>${esc(l.member)}</td><td>${esc(l.barMark)}</td><td>${l.dia}</td><td>${esc(l.shapeCode)}</td><td>${esc([l.a, l.b, l.c, l.d].filter((x) => x != null).join(' / '))}</td><td>${l.nos}</td><td>${esc(l.cutLength)}</td><td>${esc(l.totalLength)}</td><td style="text-align:right">${esc(l.weightKg)}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.ref)}</title><style>body{font:13px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body><h1>Bar bending schedule ${esc(v.ref)}</h1><p>${esc(v.title)} · ${esc(v.member)} · drawing ${esc(v.drawingRef)} ${esc(v.drawingRev ?? '')} · ${esc(v.statusLabel)}</p><table><thead><tr><th>Member</th><th>Bar mark</th><th>Dia (mm)</th><th>Shape</th><th>a / b / c / d (m)</th><th>No.</th><th>Cut length (m)</th><th>Total length (m)</th><th>Weight (kg)</th></tr></thead><tbody>${rows}</tbody></table><h2>By diameter</h2><ul>${v.byDia.map((d) => `<li>${d.dia} mm: ${esc(d.totalLength)} m, ${esc(d.weightKg)} kg</li>`).join('')}</ul><p>Total ${esc(v.weightKg)} kg</p></body></html>`;
    },
  };

  /** The decision of the checker: released, the earlier released revision superseded, the requirements stored and published (BR-02, FR-04, FR-06). */
  function decide(k, instance, actor, outcome, comment) {
    const K = KIND[k]; const r = db.prepare(`SELECT * FROM ${K.table} WHERE id = ?`).get(rid(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
    db.prepare(`UPDATE ${K.table} SET status = ?, released_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(to, to === 'APPROVED' ? nowIso() : null, actor.user, nowIso(), r.id);
    if (withdrawn) db.prepare(`UPDATE ${K.table} SET workflow_instance_id = NULL WHERE id = ?`).run(r.id);
    writeAudit(db, { entity: K.table, entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    if (to !== 'APPROVED') return;
    db.prepare(`UPDATE ${K.table} SET status = 'SUPERSEDED', updated_at = ? WHERE company_id = ? AND doc_no = ? AND id != ? AND status = 'APPROVED'`).run(nowIso(), r.company_id, r.doc_no, r.id);
    const ex = k === 'takeoff' ? explodeTakeoff(r) : explodeBbs(r);
    storeRequirements(actor, k, r, ex.rows);
    const prev = previousReleased(k, r);
    const deltaCounts = prev ? (k === 'takeoff' ? takeoffDelta(r, prev) : bbsDelta(r, prev)).counts : null;
    if (k === 'takeoff') event('est.takeoff.released', actor, 'mto_takeoff', r.id, r.company_id, { takeoffId: r.id, docNo: r.doc_no, revisionNo: r.revision_no, kind: r.kind, projectId: r.project_id, tenderId: r.tender_id, estimateId: r.estimate_id, drawingRef: r.drawing_ref, drawingRev: r.drawing_rev, quantities: [...byItem(tLines(r.id)).values()].map((x) => ({ boqItemRef: x.ref, description: x.description, uom: x.uom, qty: x.qty.round(3).toFixed(3) })), requirements: ex.rows, delta: deltaCounts });
    else event('est.bbs.released', actor, 'mto_bbs', r.id, r.company_id, { bbsId: r.id, docNo: r.doc_no, revisionNo: r.revision_no, projectId: r.project_id, member: r.member, drawingRef: r.drawing_ref, byDia: byDia(r.id), totalKg: dec(num(r.total_weight, 'quantity')).round(3).toFixed(3), requirements: ex.rows, delta: deltaCounts });
  }
  const access = (k) => (actor, id) => { const r = db.prepare(`SELECT * FROM ${KIND[k].table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(rid(id), actor.companyId); if (!r || !sees(actor, `${KIND[k].perm}.view`, r.project_id)) return null; return { companyId: r.company_id, projectId: r.project_id, siteId: null, canView: true, canEdit: ['DRAFT', 'RETURNED'].includes(r.status) && same(r.created_by, actor.user), locked: !['DRAFT', 'RETURNED'].includes(r.status) }; };
  const deltaOf = (k, r) => (k === 'takeoff' ? takeoffDelta(r, previousReleased('takeoff', r)) : bbsDelta(r, previousReleased('bbs', r)));
  return { takeoffs, bbs, decide, deltaOf, access: { takeoff: access('takeoff'), bbs: access('bbs') } };
}

const services = new WeakMap();
export const bindMto = (db, s) => services.set(db, s);
export const mtoOf = (db) => services.get(db) ?? null;

if (!workflowResolvers.get('mto.checker')) workflowResolvers.register('mto.checker', ({ db, companyId, instance }) => {
  const table = instance.docType === BBS_DOC ? 'mto_bbs' : 'mto_takeoffs';
  const r = db.prepare(`SELECT created_by FROM ${table} WHERE id = ?`).get(rid(instance.docId));
  const out = new Set([instance.submittedBy, r?.created_by].filter(Boolean).map((x) => String(x).toLowerCase()));
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => { const roles = json(u.roles_json, []); return (roles.includes('QS') || roles.includes('DESIGN')) && !out.has(u.username.toLowerCase()); }).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'PM' }];
});
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
for (const [docType, label, table, route, kind] of [[TAKEOFF_DOC, 'Take-off sheet or MTO release', 'mto_takeoffs', (id) => `/est/takeoff?id=${id}`, 'takeoff'], [BBS_DOC, 'Bar bending schedule release', 'mto_bbs', (id) => `/est/bbs/sheet?id=${id}`, 'bbs']]) {
  workflowTypes.register({
    docType, label, processOwner: 'QS', route,
    describe(db, companyId, id) { const r = db.prepare(`SELECT doc_no, revision_no, title, requested_by FROM ${table} WHERE id = ? AND company_id = ?`).get(rid(id), companyId); return r ? { ref: `${r.doc_no} R${r.revision_no}`, title: r.title, originator: r.requested_by } : null; },
    summarise(db, _actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rid(id)); if (!r) return null; return { fields: [{ label: 'Sheet', value: `${r.doc_no} R${r.revision_no}` }, { label: 'Title', value: r.title }, { label: 'Drawing', value: `${r.drawing_ref} ${r.drawing_rev ?? ''}` }, ...(kind === 'bbs' ? [{ label: 'Weight', value: `${dec(num(r.total_weight, 'quantity')).round(3).toFixed(3)} kg` }] : [])] }; },
    defaultDefinition: { name: `${label}: the preparer, then a checker (QS or the design lead; the project manager when there is none)`, settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CHECK', 'Checker', [{ kind: 'resolver', resolver: 'mto.checker' }])] },
    hooks: {
      onApproved: (db, { instance, actor }) => mtoOf(db)?.decide(kind, instance, actor, 'APPROVED'),
      onRejected: (db, { instance, actor, comment }) => mtoOf(db)?.decide(kind, instance, actor, 'REJECTED', comment),
      onReturned: (db, { instance, actor, comment }) => mtoOf(db)?.decide(kind, instance, actor, 'RETURNED', comment),
      onCancelled: (db, { instance, actor, comment }) => mtoOf(db)?.decide(kind, instance, actor, 'CANCELLED', comment),
    },
  });
  evidenceProviders.register(docType, ({ db, instance }) => {
    const s = mtoOf(db); const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rid(instance.docId)); if (!s || !r) return { sections: [] };
    const d = s.deltaOf(kind, r);
    return { sections: [{ code: `mto-${kind}`, title: 'Before releasing', kind: 'metrics', items: [{ label: 'Against the last released revision', value: d.base ? `${d.counts.added} added, ${d.counts.removed} removed, ${d.counts.changed} changed` : 'first release', format: 'text' }, ...(kind === 'bbs' ? [{ label: 'Steel', value: `${dec(num(r.total_weight, 'quantity')).round(3).toFixed(3)} kg`, format: 'text' }] : [])] }] };
  });
}
for (const [entity, label, kind] of [['mto_takeoff', 'Drawings and take-off evidence', 'takeoff'], ['mto_bbs', 'Bar bending schedule drawings', 'bbs']]) fileEntities.register({ entity, label, resolve(db, actor, id) { return mtoOf(db)?.access[kind](actor, id) ?? null; } });
