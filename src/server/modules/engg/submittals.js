import { transaction } from '../../platform/db/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { enggOf } from './drawings.js';
import { SUBMITTAL_DOC, SUB_CM_TYPES, SUB_OPEN, SUB_RESPONSE, SUB_STATUS, SUB_TYPES, addDays, diffDays, esc, nowIso, rid, same } from './constants.js';

// Submittals (part 11.03): material approval requests, method statements, shop drawings, samples, mock-ups, product data and quality plans that must be approved before work or procurement. The preparer sends the submittal for internal approval (the quality control
// manager for materials, the construction manager for method statements and shop drawings); once approved it goes to the consultant, whose response code A (approved), B (approved as noted), C (revise and resubmit) or D (rejected) is recorded; C starts a new revision.
// An approved material approval makes its make and model an approved make that procurement (15.03, 15.05) and receiving inspection (18.03) read; at the purchase-order stage an item whose material approval is pending, rejected or for another make warns or blocks (BR-01).
if (!parameterRegistry.get('engg.po_mar_control')) parameterRegistry.define({ key: 'engg.po_mar_control', dataType: 'string', default: 'WARN', scopes: ['system', 'company'], description: 'BR-01: what the purchase order does with an item whose material approval (MAR) is pending, rejected or for another make: WARN (the default), BLOCK, or OFF.' });
const CLOSED = ['APPROVED', 'REJECTED', 'CANCELLED'];
export const submittalList = defineList({
  code: 'engg.submittals', label: 'Submittal register', permission: 'engg.submittal.view',
  from: 'engg_submittals x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.submittal_no', 'x.title', 'p.code', 'x.spec_section', 'x.make', 'x.model', 'x.activity_ref'], defaultSort: '-submittalNo',
  columns: {
    submittalNo: { sql: 'x.submittal_no', type: 'text', label: 'No.' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    type: { sql: 'x.submittal_type', type: 'enum', label: 'Type', options: Object.entries(SUB_TYPES) }, specSection: { sql: 'x.spec_section', type: 'text', label: 'Spec section' }, make: { sql: 'x.make', type: 'text', label: 'Make' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(SUB_STATUS) }, requiredBy: { sql: 'x.required_by', type: 'date', label: 'Required by' }, revision: { sql: 'x.current_rev', type: 'number', label: 'Revision' },
    response: { sql: 'x.response_code', type: 'enum', label: 'Response', options: Object.entries(SUB_RESPONSE) }, itemId: { sql: 'x.item_id', type: 'number', label: 'Item id' },
    overdue: { sql: "(CASE WHEN x.status NOT IN ('APPROVED', 'REJECTED', 'CANCELLED') AND x.required_by < date('now', '+330 minutes') THEN 1 ELSE 0 END)", type: 'number', label: 'Overdue' },
  },
});

/** BR-01: what the purchase order should do with an item. Procurement (15.03, 15.05) calls this; the answer is OK, WARN or BLOCK with the reason. */
export function procurementCheck(db, { companyId, projectId, itemId = null, material = null, make = null }) {
  const store = createParameterStore(db); const mode = String(store.get('engg.po_mar_control', { companyId, date: new Date().toISOString().slice(0, 10) }) ?? 'WARN').toUpperCase();
  const where = ["x.company_id = ?", 'x.org_project_id = ?', "x.submittal_type = 'MAR'", 'x.deleted_at IS NULL', "x.status <> 'CANCELLED'"]; const params = [companyId, projectId]; const match = [];
  if (itemId) { match.push('x.item_id = ?'); params.push(itemId); } if (material) { match.push('lower(x.material_ref) = lower(?)'); params.push(material); }
  if (!match.length) return { status: 'OK', reason: 'NO_ITEM', message: 'Name the item or the material to check.', mode, approvedMakes: [] };
  const mars = db.prepare(`SELECT x.* FROM engg_submittals x WHERE ${where.join(' AND ')} AND (${match.join(' OR ')}) ORDER BY x.id`).all(...params);
  if (!mars.length) return { status: 'OK', reason: 'NO_MAR_REQUIRED', message: 'No material approval is required for this item.', mode, approvedMakes: [] };
  const makes = db.prepare(`SELECT make, model, supplier, submittal_id FROM engg_approved_makes WHERE company_id = ? AND org_project_id = ? AND make_status = 'ACTIVE' AND deleted_at IS NULL AND submittal_id IN (${mars.map(() => '?').join(',')})`).all(companyId, projectId, ...mars.map((m) => m.id));
  const violation = (reason, message, submittalId) => ({ status: mode === 'OFF' ? 'OK' : mode, reason, message, mode, submittalId, approvedMakes: makes });
  if (makes.length) {
    if (make && !makes.some((m) => m.make.toLowerCase() === String(make).toLowerCase())) return violation('MAKE_NOT_APPROVED', `${make} is not an approved make for this item (approved: ${makes.map((m) => m.make).join(', ')}).`, makes[0].submittal_id);
    return { status: 'OK', reason: 'APPROVED', message: 'The material approval is in place.', mode, submittalId: makes[0].submittal_id, approvedMakes: makes };
  }
  const open = mars.find((m) => SUB_OPEN.includes(m.status)); if (open) return violation('PENDING', `Material approval ${open.submittal_no} is ${SUB_STATUS[open.status].toLowerCase()}: the item is not approved for purchase yet.`, open.id);
  const last = mars[mars.length - 1]; return violation(last.status === 'REJECTED' ? 'REJECTED' : 'NOT_APPROVED', `Material approval ${last.submittal_no} is ${SUB_STATUS[last.status].toLowerCase()}.`, last.id);
}

export function createSubmittalService({ db, base }) {
  const { may, need, fail, project, orgOf, scopeSql, audit, event, today } = base;
  const row = (actor, id, key = 'engg.submittal.view') => {
    const r = db.prepare('SELECT * FROM engg_submittals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'engg.submittal.view', r.org_project_id)) throw notFound('That submittal does not exist.');
    if (key !== 'engg.submittal.view') need(actor, key, 'do that with a submittal', r.org_project_id);
    return r;
  };
  const fresh = (id) => db.prepare('SELECT * FROM engg_submittals WHERE id = ?').get(id);
  const nextNo = (companyId) => { let k = db.prepare('SELECT COUNT(*) AS n FROM engg_submittals WHERE company_id = ?').get(companyId).n + 1; let no = `SUB-${String(k).padStart(5, '0')}`; while (db.prepare('SELECT 1 FROM engg_submittals WHERE company_id = ? AND submittal_no = ?').get(companyId, no)) { k += 1; no = `SUB-${String(k).padStart(5, '0')}`; } return no; };
  const filesOf = (id) => db.prepare("SELECT id, original_name, size_bytes FROM core_files WHERE linked_entity = 'engg_submittal' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY id").all(id).map((f) => ({ id: f.id, name: f.original_name, size: f.size_bytes }));
  const makeOf = (id) => db.prepare('SELECT * FROM engg_approved_makes WHERE submittal_id = ? AND deleted_at IS NULL').get(id);
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const editable = ['DRAFT', 'RETURNED'].includes(r.status); const open = !CLOSED.includes(r.status);
    const d = r.drawing_id ? db.prepare('SELECT drawing_no FROM engg_drawings WHERE id = ?').get(r.drawing_id) : null; const it = r.item_id ? db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(r.item_id) : null;
    const out = {
      id: r.id, submittalNo: r.submittal_no, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, type: r.submittal_type, typeLabel: SUB_TYPES[r.submittal_type], title: r.title, specSection: r.spec_section, activityRef: r.activity_ref, wbsId: r.wbs_id,
      itemId: r.item_id, itemCode: it?.code ?? null, itemName: it?.name ?? null, materialRef: r.material_ref, make: r.make, model: r.model, supplier: r.supplier, drawingId: r.drawing_id, drawingNo: d?.drawing_no ?? null, hseRef: r.hse_ref, consultant: r.consultant,
      needDate: r.need_date, leadTimeDays: r.lead_time_days, reviewDays: r.review_days, requiredBy: r.required_by, revision: r.current_rev, submittedOn: r.submitted_on, responseCode: r.response_code, responseLabel: r.response_code ? `${r.response_code} ${SUB_RESPONSE[r.response_code]}` : null, responseOn: r.response_on, responseText: r.response_text,
      status: r.status, statusLabel: SUB_STATUS[r.status], overdue: open && r.required_by < today(), requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, createdBy: r.created_by, rowVersion: r.version, internalApprover: SUB_CM_TYPES.includes(r.submittal_type) ? 'CM' : 'QCMGR',
      can: { edit: can('engg.submittal.edit') && editable, submit: can('engg.submittal.submit') && editable, withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('engg.submittal.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'WITH_CONSULTANT', 'REVISE'].includes(r.status),
        delete: can('engg.submittal.delete') && r.status === 'DRAFT' && r.current_rev === 1 && !r.workflow_instance_id, amend: can('engg.submittal.amend') && ['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status), respond: can('engg.submittal.respond') && r.status === 'WITH_CONSULTANT',
        resubmit: can('engg.submittal.edit') && r.status === 'REVISE', print: can('engg.submittal.print'), export: can('engg.submittal.export') },
    };
    if (detail) {
      out.revisions = db.prepare('SELECT * FROM engg_submittal_revisions WHERE submittal_id = ? AND deleted_at IS NULL ORDER BY rev_no DESC').all(r.id).map((v) => ({ id: v.id, revNo: v.rev_no, changeNote: v.change_note, submittedOn: v.submitted_on, responseCode: v.response_code, responseLabel: v.response_code ? `${v.response_code} ${SUB_RESPONSE[v.response_code]}` : null, responseOn: v.response_on, responseBy: v.response_by, responseText: v.response_text }));
      const m = makeOf(r.id); out.approvedMake = m ? { make: m.make, model: m.model, supplier: m.supplier, approvedOn: m.approved_on, code: m.approval_code, status: m.make_status } : null; out.files = filesOf(r.id);
    }
    return out;
  }
  const computeRequired = (b, cur = null) => {
    if (b.requiredBy) return b.requiredBy;
    const need0 = b.needDate !== undefined ? b.needDate : cur?.need_date; const lead = b.leadTimeDays ?? cur?.lead_time_days ?? 0; const rev = b.reviewDays ?? cur?.review_days ?? 14;
    return need0 ? addDays(need0, -(lead + rev)) : null;
  };
  function problems(actor, o, b) {
    const p = [];
    if (b.wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.wbsId, o.id)) p.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
    if (b.itemId && !db.prepare('SELECT 1 FROM mdm_items WHERE id = ? AND company_id = ?').get(b.itemId, actor.companyId)) p.push({ field: 'itemId', message: 'Choose an item of your company' });
    if (b.drawingId && !db.prepare('SELECT 1 FROM engg_drawings WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.drawingId, o.id)) p.push({ field: 'drawingId', message: 'Choose a drawing of this project' });
    return p;
  }
  const COLS = { type: 'submittal_type', title: 'title', specSection: 'spec_section', activityRef: 'activity_ref', wbsId: 'wbs_id', itemId: 'item_id', materialRef: 'material_ref', make: 'make', model: 'model', supplier: 'supplier', drawingId: 'drawing_id', hseRef: 'hse_ref', consultant: 'consultant', needDate: 'need_date', leadTimeDays: 'lead_time_days', reviewDays: 'review_days' };
  const revRow = (r, note = null) => db.prepare("INSERT INTO engg_submittal_revisions (company_id, submittal_id, org_project_id, rev_no, change_note, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'engg_submittals', ?)").run(r.company_id, r.id, r.org_project_id, r.current_rev, note, r.org_project_id, r.created_by, String(r.id));
  const dropMake = (id) => db.prepare("UPDATE engg_approved_makes SET make_status = 'WITHDRAWN', version = version + 1 WHERE submittal_id = ? AND make_status = 'ACTIVE'").run(id);

  const submittals = {
    list(actor, query) {
      need(actor, 'engg.submittal.view', 'see submittals'); const s = scopeSql(actor, 'engg.submittal.view');
      return runList(db, submittalList, parseListRequest(submittalList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, submittalNo: v.submittalNo, title: v.title, projectId: v.projectId, project: v.projectCode, type: v.type, typeLabel: v.typeLabel, specSection: v.specSection, make: v.make, status: v.status, statusLabel: v.statusLabel, requiredBy: v.requiredBy, revision: v.revision, response: v.responseCode, overdue: v.overdue ? 1 : 0 }; } });
    },
    exportSource(actor, req) {
      need(actor, 'engg.submittal.export', 'export the submittal register'); const s = scopeSql(actor, 'engg.submittal.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: submittalList.label, permission: 'engg.submittal.export', personal: false, columns: [{ key: 'submittalNo', label: 'No.', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'specSection', label: 'Spec section', type: 'text' }, { key: 'make', label: 'Make', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'requiredBy', label: 'Required by', type: 'text' }, { key: 'revision', label: 'Revision', type: 'number' }, { key: 'response', label: 'Response', type: 'text' }],
        rows: () => runList(db, submittalList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { submittalNo: v.submittalNo, title: v.title, project: v.projectCode, type: v.typeLabel, specSection: v.specSection ?? '', make: v.make ?? '', status: v.statusLabel, requiredBy: v.requiredBy, revision: v.revision, response: v.responseCode ?? '' }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All submittals you may see'], count: () => countList(db, submittalList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.submittal.create', 'engg.submittal.view'); const required = computeRequired(b);
      const p = problems(actor, o, b); if (!required) p.push({ field: 'requiredBy', message: 'Give the required-by date, or the site need date with the lead time' }); fail(p);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO engg_submittals (company_id, submittal_no, org_project_id, submittal_type, title, spec_section, activity_ref, wbs_id, item_id, material_ref, make, model, supplier, drawing_id, hse_ref, consultant, need_date, lead_time_days, review_days, required_by, current_rev, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'engg_submittals', ?)")
          .run(o.company_id, nextNo(o.company_id), o.id, b.type, b.title, b.specSection, b.activityRef, b.wbsId, b.itemId, b.materialRef, b.make, b.model, b.supplier, b.drawingId, b.hseRef, b.consultant, b.needDate, b.leadTimeDays, b.reviewDays, required, o.id, actor.user, o.code).lastInsertRowid);
        const r = fresh(id); revRow(r); audit(actor, 'engg_submittals', id, 'create', o.company_id, { newValues: { submittalNo: r.submittal_no, type: b.type } }); return submittals.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'engg.submittal.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`${r.submittal_no} is ${SUB_STATUS[r.status].toLowerCase()}: it is not edited now.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this submittal; reload it.');
      const o = orgOf(r.org_project_id); fail(problems(actor, o, b)); const sets = Object.entries(COLS).filter(([k]) => k in b).map(([k, c]) => [c, b[k]]);
      if (['requiredBy', 'needDate', 'leadTimeDays', 'reviewDays'].some((k) => k in b)) { const req = computeRequired(b, r); if (req) sets.push(['required_by', req]); }
      return transaction(db, () => { if (sets.length) db.prepare(`UPDATE engg_submittals SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map(([, v]) => v), actor.user, nowIso(), r.id); audit(actor, 'engg_submittals', r.id, 'update', r.company_id); return submittals.get(actor, r.id); });
    },
    remove(actor, id) { const r = row(actor, id, 'engg.submittal.delete'); if (r.status !== 'DRAFT' || r.current_rev !== 1 || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted.'); db.prepare('UPDATE engg_submittals SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'engg_submittals', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    /** FR-03: the preparer sends the submittal for internal approval; a material approval names the make and carries its documents. */
    submit(actor, id) {
      const r = row(actor, id, 'engg.submittal.submit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or a returned submittal is sent.');
      if (r.submittal_type === 'MAR' && !r.make) throw unprocessable('A material approval names the make (and model) proposed.');
      if (!filesOf(r.id).length) throw unprocessable('Attach the documents (datasheet, test certificates, drawings, method) before it is sent.');
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: SUBMITTAL_DOC, docId: `${r.id}.${r.current_rev}`, comment: `${r.submittal_no}: ${r.title}`.slice(0, 300), context: ctx }); db.prepare('UPDATE engg_submittals SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE engg_submittals SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'engg_submittals', r.id, 'submit', r.company_id); return submittals.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a submittal waiting for internal approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return submittals.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'engg.submittal.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'WITH_CONSULTANT', 'REVISE'].includes(r.status)) throw unprocessable('That submittal cannot be cancelled now.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE engg_submittals SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); dropMake(r.id); audit(actor, 'engg_submittals', r.id, 'cancel', r.company_id, { reason }); return submittals.get(actor, r.id); });
    },
    /** FR-03: the consultant's response code, recorded by the quality control manager or the design coordinator (until the portal, 25.04). */
    respond(actor, id, b) {
      const r = row(actor, id, 'engg.submittal.respond'); if (r.status !== 'WITH_CONSULTANT') throw unprocessable('A response is recorded on a submittal that is with the consultant.');
      if (['B', 'C', 'D'].includes(b.code) && !b.text) fail([{ field: 'text', message: `Say what the comments are (code ${b.code})` }]);
      const day = b.responseOn ?? today(); if (day > today()) fail([{ field: 'responseOn', message: 'The date of a response is not in the future' }]);
      return transaction(db, () => {
        const status = b.code === 'A' || b.code === 'B' ? 'APPROVED' : b.code === 'C' ? 'REVISE' : 'REJECTED';
        db.prepare('UPDATE engg_submittals SET status = ?, response_code = ?, response_on = ?, response_text = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, b.code, day, b.text, actor.user, nowIso(), r.id);
        db.prepare('UPDATE engg_submittal_revisions SET response_code = ?, response_on = ?, response_by = ?, response_text = ?, version = version + 1 WHERE submittal_id = ? AND rev_no = ?').run(b.code, day, actor.user, b.text, r.id, r.current_rev);
        let makeId = null;
        if (status === 'APPROVED' && r.submittal_type === 'MAR' && r.make) {
          db.prepare('UPDATE engg_approved_makes SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE submittal_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id);
          makeId = Number(db.prepare("INSERT INTO engg_approved_makes (company_id, submittal_id, org_project_id, item_id, material_ref, make, model, supplier, approved_on, approval_code, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_submittals', ?)").run(r.company_id, r.id, r.org_project_id, r.item_id, r.material_ref, r.make, r.model, r.supplier, day, b.code, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
        }
        audit(actor, 'engg_submittals', r.id, 'respond', r.company_id, { newValues: { code: b.code } });
        const link = `/engg/submittal?id=${r.id}`;
        if (r.requested_by || r.created_by) { try { notificationsOf(db).notify({ companyId: r.company_id, templateCode: 'engg.submittal.responded', recipients: [`user:${r.requested_by ?? r.created_by}`], data: { submittal: r.submittal_no, title: r.title, detail: `Response ${b.code}: ${SUB_RESPONSE[b.code]}.${b.code === 'C' ? ' Revise and resubmit.' : ''}`, link }, link, sourceType: 'engg_submittal', sourceId: r.id }); } catch { /* the response stays recorded */ } }
        event('engg.submittal.responded', actor, 'engg_submittal', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, submittalId: r.id, submittalNo: r.submittal_no, type: r.submittal_type, revision: r.current_rev, code: b.code, status });
        if (status === 'APPROVED') event('engg.submittal.approved', actor, 'engg_submittal', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, submittalId: r.id, submittalNo: r.submittal_no, type: r.submittal_type, code: b.code, itemId: r.item_id, materialRef: r.material_ref, make: r.make, model: r.model, supplier: r.supplier, approvedMakeId: makeId, activityRef: r.activity_ref, hseRef: r.hse_ref, drawingId: r.drawing_id });
        return submittals.get(actor, r.id);
      });
    },
    /** Response C: a new revision is begun and goes through the internal approval again. */
    resubmit(actor, id, { changeNote }) {
      const r = row(actor, id, 'engg.submittal.edit'); if (r.status !== 'REVISE') throw unprocessable('Only a submittal the consultant asked to revise is resubmitted.');
      return transaction(db, () => { db.prepare("UPDATE engg_submittals SET status = 'DRAFT', current_rev = current_rev + 1, workflow_instance_id = NULL, response_code = NULL, response_on = NULL, response_text = NULL, submitted_on = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); revRow(fresh(r.id), changeNote); audit(actor, 'engg_submittals', r.id, 'resubmit', r.company_id, { newValues: { revision: r.current_rev + 1 } }); return submittals.get(actor, r.id); });
    },
    /** An approved, rejected or cancelled submittal is taken up again as a new revision; an approved make is withdrawn until it is approved again. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'engg.submittal.amend'); if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) throw unprocessable('Only an approved, rejected or cancelled submittal is amended.');
      return transaction(db, () => { db.prepare("UPDATE engg_submittals SET status = 'DRAFT', current_rev = current_rev + 1, workflow_instance_id = NULL, response_code = NULL, response_on = NULL, response_text = NULL, submitted_on = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); dropMake(r.id); revRow(fresh(r.id), reason); audit(actor, 'engg_submittals', r.id, 'amend', r.company_id, { reason }); return submittals.get(actor, r.id); });
    },
    history(actor, id) {
      const r = row(actor, id);
      return { approvals: db.prepare("SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.company_id = ? AND i.doc_type = ? AND (i.doc_id = ? OR i.doc_id LIKE ?) ORDER BY h.id").all(r.company_id, SUBMITTAL_DOC, String(r.id), `${r.id}.%`), revisions: view(actor, r, { detail: true }).revisions, audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'engg_submittals' AND entity_id = ? ORDER BY id").all(String(r.id)) };
    },
    print(actor, id) {
      const r = row(actor, id, 'engg.submittal.print'); const v = view(actor, r, { detail: true });
      const rows = v.revisions.map((x) => `<tr><td>${x.revNo}</td><td>${esc(x.submittedOn ?? '')}</td><td>${esc(x.responseLabel ?? 'Waiting')}</td><td>${esc(x.responseText ?? '')}</td></tr>`).join('');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.submittalNo)}</title></head><body><h1>${esc(v.submittalNo)}: ${esc(v.title)}</h1><p>${esc(v.projectCode)} · ${esc(v.typeLabel)} · ${esc(v.specSection ?? '')} · required by ${esc(v.requiredBy)} · ${esc(v.statusLabel)}</p><p>Make ${esc(v.make ?? '—')} ${esc(v.model ?? '')}</p><table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Rev.</th><th>Submitted</th><th>Response</th><th>Comments</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    },
    import(actor, b) {
      project(actor, b.projectId, 'engg.submittal.create', 'engg.submittal.view'); const made = []; const errors = [];
      b.rows.forEach((x, i) => { try { const v = submittals.create(actor, { projectId: b.projectId, ...x }); made.push({ row: i + 1, id: v.id, submittalNo: v.submittalNo }); } catch (e) { errors.push({ row: i + 1, title: x.title, message: e.details?.[0]?.message ?? e.message }); } });
      return { created: made.length, errors, rows: made };
    },
    /** FR-06: planned (required-by) against actual (submitted and responded) and the overdue report. */
    schedule(actor, q = {}) {
      need(actor, 'engg.submittal.view', 'see the submittal schedule'); const s = scopeSql(actor, 'engg.submittal.view'); const params = { ...s.params }; let extra = ''; if (q.projectId) { extra = ' AND x.org_project_id = :pid'; params.pid = Number(q.projectId); }
      const day = today(); const list = db.prepare(`SELECT x.*, p.code AS pcode FROM engg_submittals x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.status <> 'CANCELLED' AND ${s.sql}${extra} ORDER BY x.required_by, x.id LIMIT 1000`).all(params);
      const rows = list.map((r) => {
        const state = r.status === 'APPROVED' ? (r.response_on <= r.required_by ? 'ON_TIME' : 'LATE') : r.status === 'REJECTED' ? 'REJECTED' : r.required_by < day ? 'OVERDUE' : 'PENDING';
        return { id: r.id, submittalNo: r.submittal_no, title: r.title, project: r.pcode, projectId: r.org_project_id, type: r.submittal_type, typeLabel: SUB_TYPES[r.submittal_type], status: r.status, requiredBy: r.required_by, submittedOn: r.submitted_on, responseOn: r.response_on, revision: r.current_rev, state, varianceDays: diffDays(r.status === 'APPROVED' ? r.response_on : day, r.required_by) };
      });
      const byType = {}; for (const r of rows) { byType[r.type] ??= { total: 0, overdue: 0, approved: 0 }; byType[r.type].total += 1; if (r.state === 'OVERDUE') byType[r.type].overdue += 1; if (['ON_TIME', 'LATE'].includes(r.state)) byType[r.type].approved += 1; }
      const count = (st) => rows.filter((r) => r.state === st).length;
      return { asOf: day, rows, overdue: rows.filter((r) => r.state === 'OVERDUE'), byType, counts: { total: rows.length, onTime: count('ON_TIME'), late: count('LATE'), overdue: count('OVERDUE'), pending: count('PENDING'), rejected: count('REJECTED') } };
    },
    approvedMakes(actor, q = {}) {
      need(actor, 'engg.submittal.view', 'see approved makes'); const s = scopeSql(actor, 'engg.submittal.view'); const params = { ...s.params }; const w = [`x.make_status = 'ACTIVE'`, 'x.deleted_at IS NULL'];
      if (q.projectId) { w.push('x.org_project_id = :pid'); params.pid = Number(q.projectId); } if (q.itemId) { w.push('x.item_id = :iid'); params.iid = Number(q.itemId); }
      return db.prepare(`SELECT x.*, p.code AS pcode, sb.submittal_no FROM engg_approved_makes x JOIN org_projects p ON p.id = x.org_project_id JOIN engg_submittals sb ON sb.id = x.submittal_id WHERE ${w.join(' AND ')} AND ${s.sql} ORDER BY x.id DESC LIMIT 500`).all(params)
        .map((m) => ({ id: m.id, projectId: m.org_project_id, project: m.pcode, itemId: m.item_id, materialRef: m.material_ref, make: m.make, model: m.model, supplier: m.supplier, approvedOn: m.approved_on, code: m.approval_code, submittalId: m.submittal_id, submittalNo: m.submittal_no }));
    },
    poCheck(actor, q) {
      const o = orgOf(Number(q.projectId)); if (!o || o.company_id !== actor.companyId || !may(actor, 'engg.submittal.view', o.id)) throw notFound('That project does not exist.');
      return procurementCheck(db, { companyId: actor.companyId, projectId: o.id, itemId: q.itemId ?? null, material: q.material ?? null, make: q.make ?? null });
    },
    /** The decision of the internal approval: an approved submittal goes to the consultant. */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE engg_submittals SET status = 'WITH_CONSULTANT', submitted_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(today(), actor.user, nowIso(), r.id);
        db.prepare('UPDATE engg_submittal_revisions SET submitted_on = ?, version = version + 1 WHERE submittal_id = ? AND rev_no = ?').run(today(), r.id, r.current_rev); audit(actor, 'engg_submittals', r.id, 'send_to_consultant', r.company_id);
        event('engg.submittal.submitted', actor, 'engg_submittal', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, submittalId: r.id, submittalNo: r.submittal_no, type: r.submittal_type, revision: r.current_rev, consultant: r.consultant, requiredBy: r.required_by });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE engg_submittals SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, nowIso(), r.id); audit(actor, 'engg_submittals', r.id, outcome.toLowerCase(), r.company_id, { reason: comment ?? null });
    },
  };
  return { submittals };
}

// ---- workflow, resolver, evidence and files -------------------------------------------------------------------------------------------------------------
const userRoles = (u) => { try { return JSON.parse(u.roles_json ?? '[]'); } catch { return []; } };
/** Materials are checked by the quality control manager, method statements and shop drawings by the construction manager; never the sender. */
if (!workflowResolvers.get('engg.submittalReviewer')) workflowResolvers.register('engg.submittalReviewer', ({ db, companyId, instance }) => {
  const r = db.prepare('SELECT submittal_type FROM engg_submittals WHERE id = ?').get(rid(instance.docId)); const role = SUB_CM_TYPES.includes(r?.submittal_type) ? 'CM' : 'QCMGR'; const me = String(instance.submittedBy ?? '').toLowerCase();
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes(role) && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role }];
});
const sline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM engg_submittals x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: SUBMITTAL_DOC, label: 'Internal approval of a submittal', processOwner: 'QCMGR', route: (id) => `/engg/submittal?id=${id}`,
  describe(db, companyId, id) { const r = sline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.submittal_no, title: `${r.code} ${r.title}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = sline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Submittal', value: `${r.submittal_no} · ${r.title}` }, { label: 'Type', value: SUB_TYPES[r.submittal_type] }, { label: 'Revision', value: String(r.current_rev) }, { label: 'Spec section', value: r.spec_section ?? '' }, { label: 'Make and model', value: [r.make, r.model].filter(Boolean).join(' ') }, { label: 'Required by', value: r.required_by }], lines: [] }; },
  defaultDefinition: { name: 'Submittal: the quality control manager (materials) or the construction manager (method statements) approves before it goes to the consultant', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'REVIEW', name: 'Internal review', type: 'approval', mode: 'single', approvers: [{ kind: 'resolver', resolver: 'engg.submittalReviewer' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: { onApproved: (db, { instance, actor }) => enggOf(db)?.submittals.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => enggOf(db)?.submittals.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => enggOf(db)?.submittals.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => enggOf(db)?.submittals.decide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(SUBMITTAL_DOC, ({ db, instance }) => {
  const r = sline(db, rid(instance.docId)); if (!r) return { sections: [] }; const files = db.prepare("SELECT original_name FROM core_files WHERE linked_entity = 'engg_submittal' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1").all(r.id);
  return { sections: [{ code: 'engg-submittal', title: 'The submittal', kind: 'metrics', items: [{ label: 'Submittal', value: `${r.submittal_no} ${r.title}`, format: 'text' }, { label: 'Type', value: SUB_TYPES[r.submittal_type], format: 'text' }, { label: 'Revision', value: String(r.current_rev), format: 'text' }, { label: 'Make and model', value: [r.make, r.model].filter(Boolean).join(' ') || '—', format: 'text' }, { label: 'Spec section', value: r.spec_section ?? '—', format: 'text' }, { label: 'Required by', value: r.required_by, format: 'text' }, { label: 'Documents', value: files.length ? files.map((f) => f.original_name).join(', ') : 'None', format: 'text' }] }] };
});
fileEntities.register({
  entity: 'engg_submittal', label: 'Submittal',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT * FROM engg_submittals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); const svc = enggOf(db);
    if (!r || !svc || !svc.may(actor, 'engg.submittal.view', r.org_project_id)) return null;
    const editable = (['DRAFT', 'RETURNED'].includes(r.status) && svc.may(actor, 'engg.submittal.edit', r.org_project_id)) || (r.status === 'WITH_CONSULTANT' && svc.may(actor, 'engg.submittal.respond', r.org_project_id));
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: null, canView: true, canEdit: editable, locked: !editable };
  },
});
void badRequest;
