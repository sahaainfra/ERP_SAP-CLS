import { transaction } from '../../platform/db/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { enggOf } from './drawings.js';
import { CRS_STATUS, DEFAULT_WEIGHTS, DELIVERABLE_DOC, DELIV_DISCIPLINES, DELIV_TYPES, MILESTONES, MILESTONE_RANK, VDR_DOC, VDR_STATUS, VDR_TYPES, addDays, esc, nowIso, pct, rid, same } from './constants.js';

// EPC engineering deliverables and vendor document review (part 11.04). The master register lists every drawing, calculation, specification, data sheet and MTO with a weight and the planned and actual dates of IFR, IFA, IFC and as-built. Progress is worked out on the
// server from the weights of the milestone reached (IFR 50 %, IFA 70 %, IFC 100 % by default) and rolled up by weight into the discipline, the package and the project; only recorded milestones count, and IFC counts only after the release is approved (BR-01).
// Client comments are kept on a resolution sheet per revision; holds record deliverables that wait for information and what they hold up; vendor document requirements are tracked per purchase order with their due dates and review codes.
if (!parameterRegistry.get('engg.progress_weights')) parameterRegistry.define({ key: 'engg.progress_weights', dataType: 'json', default: JSON.stringify(DEFAULT_WEIGHTS), scopes: ['system', 'company'], description: 'FR-02: the share of a deliverable that is done when it reaches a milestone, in basis points (10000 = 100 %): {"IFR":5000,"IFA":7000,"IFC":10000,"ASBUILT":10000}.' });
const OVERDUE_SQL = "(CASE WHEN x.reg_status = 'ACTIVE' AND ((x.plan_ifr < date('now', '+330 minutes') AND x.act_ifr IS NULL) OR (x.plan_ifa < date('now', '+330 minutes') AND x.act_ifa IS NULL) OR (x.plan_ifc < date('now', '+330 minutes') AND x.act_ifc IS NULL) OR (x.plan_asbuilt < date('now', '+330 minutes') AND x.act_asbuilt IS NULL)) THEN 1 ELSE 0 END)";
export const deliverableList = defineList({
  code: 'engg.deliverables', label: 'Deliverable register', permission: 'engg.deliverable.view',
  from: 'engg_deliverables x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.deliverable_no', 'x.title', 'p.code', 'x.package_name', 'x.owner_user'], defaultSort: 'deliverableNo',
  columns: {
    deliverableNo: { sql: 'x.deliverable_no', type: 'text', label: 'Deliverable no.' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    discipline: { sql: 'x.discipline', type: 'enum', label: 'Discipline', options: Object.entries(DELIV_DISCIPLINES) }, type: { sql: 'x.deliverable_type', type: 'enum', label: 'Type', options: Object.entries(DELIV_TYPES) }, package: { sql: 'x.package_name', type: 'text', label: 'Package' },
    weight: { sql: 'x.weight', type: 'number', label: 'Weight' }, milestone: { sql: 'x.milestone', type: 'enum', label: 'Milestone', options: [['NOT_STARTED', 'Not started'], ['IFR', 'IFR'], ['IFA', 'IFA'], ['IFC', 'IFC'], ['ASBUILT', 'As-built']] },
    progress: { sql: '(x.progress_bp / 100.0)', type: 'number', label: 'Progress (%)' }, planIfc: { sql: 'x.plan_ifc', type: 'date', label: 'Planned IFC' }, actIfc: { sql: 'x.act_ifc', type: 'date', label: 'Actual IFC' }, overdue: { sql: OVERDUE_SQL, type: 'number', label: 'Overdue' },
    registerStatus: { sql: 'x.reg_status', type: 'enum', label: 'Register', options: [['ACTIVE', 'Active'], ['CANCELLED', 'Cancelled']] },
  },
});
export const vdrList = defineList({
  code: 'engg.vdr_items', label: 'VDR tracker', permission: 'engg.vdr_item.view',
  from: 'engg_vdr_items x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.vdr_no', 'x.po_ref', 'x.vendor', 'x.title', 'p.code'], defaultSort: 'dueDate',
  columns: {
    vdrNo: { sql: 'x.vdr_no', type: 'text', label: 'VDR no.' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, poRef: { sql: 'x.po_ref', type: 'text', label: 'PO' }, vendor: { sql: 'x.vendor', type: 'text', label: 'Vendor' },
    docType: { sql: 'x.doc_type', type: 'enum', label: 'Document', options: Object.entries(VDR_TYPES) }, title: { sql: 'x.title', type: 'text', label: 'Title' }, dueDate: { sql: 'x.due_date', type: 'date', label: 'Due' }, submittedOn: { sql: 'x.submitted_on', type: 'date', label: 'Submitted' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(VDR_STATUS) }, reviewCode: { sql: 'x.review_code', type: 'enum', label: 'Review code', options: [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']] }, cycle: { sql: 'x.cycle_no', type: 'number', label: 'Cycle' },
    overdue: { sql: "(CASE WHEN x.status IN ('REQUIRED', 'RESUBMIT') AND x.due_date < date('now', '+330 minutes') THEN 1 ELSE 0 END)", type: 'number', label: 'Overdue' },
  },
});

export function createDeliverableService({ db, base }) {
  const { may, need, fail, project, orgOf, scopeSql, audit, event, today } = base;
  const weightsFor = (companyId) => { try { const v = createParameterStore(db).get('engg.progress_weights', { companyId, date: today() }); const w = typeof v === 'string' ? JSON.parse(v) : v; return { ...DEFAULT_WEIGHTS, ...(w ?? {}) }; } catch { return { ...DEFAULT_WEIGHTS }; } };
  const bpOf = (w, milestone) => (milestone === 'NOT_STARTED' ? 0 : Math.max(0, Math.min(10000, Number(w[milestone] ?? 0))));
  const row = (actor, id, key = 'engg.deliverable.view') => {
    const r = db.prepare('SELECT * FROM engg_deliverables WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'engg.deliverable.view', r.org_project_id)) throw notFound('That deliverable does not exist.');
    if (key !== 'engg.deliverable.view') need(actor, key, 'do that with a deliverable', r.org_project_id);
    return r;
  };
  const fresh = (id) => db.prepare('SELECT * FROM engg_deliverables WHERE id = ?').get(id);
  const nextNo = (table, col, prefix, companyId) => { let k = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n + 1; let no = `${prefix}-${String(k).padStart(5, '0')}`; while (db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND ${col} = ?`).get(companyId, no)) { k += 1; no = `${prefix}-${String(k).padStart(5, '0')}`; } return no; };
  const PLAN = { IFR: 'plan_ifr', IFA: 'plan_ifa', IFC: 'plan_ifc', ASBUILT: 'plan_asbuilt' }; const ACT = { IFR: 'act_ifr', IFA: 'act_ifa', IFC: 'act_ifc', ASBUILT: 'act_asbuilt' };
  const recompute = (id) => {
    const r = fresh(id); const w = weightsFor(r.company_id); const reached = MILESTONES.filter((m) => r[ACT[m]]).sort((a, b) => MILESTONE_RANK[b] - MILESTONE_RANK[a])[0] ?? 'NOT_STARTED';
    db.prepare('UPDATE engg_deliverables SET milestone = ?, progress_bp = ?, version = version + 1 WHERE id = ?').run(reached, bpOf(w, reached), id); return fresh(id);
  };
  /** The weighted progress of a set of deliverables in basis points: the sum of weight times progress over the sum of weight. */
  const rollup = (rows) => { const total = rows.reduce((s, r) => s + r.weight, 0); return total ? Math.round(rows.reduce((s, r) => s + r.weight * r.progress_bp, 0) / total) : 0; };
  const plannedBp = (w, r, d) => { let best = 0; for (const m of MILESTONES) if (r[PLAN[m]] && r[PLAN[m]] <= d) best = Math.max(best, bpOf(w, m)); return best; };
  const actualBp = (w, r, d) => { let best = 0; for (const m of MILESTONES) if (r[ACT[m]] && r[ACT[m]] <= d) best = Math.max(best, bpOf(w, m)); return best; };
  const projectProgress = (companyId, projectId) => rollup(db.prepare("SELECT weight, progress_bp FROM engg_deliverables WHERE company_id = ? AND org_project_id = ? AND reg_status = 'ACTIVE' AND deleted_at IS NULL").all(companyId, projectId));
  const progressEvent = (actor, r, why) => event('engg.progress.updated', actor, 'engg_deliverable', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, deliverableId: r.id, deliverableNo: r.deliverable_no, discipline: r.discipline, milestone: r.milestone, progressBp: r.progress_bp, projectProgressBp: projectProgress(r.company_id, r.org_project_id), reason: why });

  // ---- views --------------------------------------------------------------------------------------------------------------------------------------
  const commentsOf = (id) => db.prepare('SELECT * FROM engg_crs WHERE deliverable_id = ? AND deleted_at IS NULL ORDER BY revision, comment_no').all(id).map((c) => ({ id: c.id, revision: c.revision, no: c.comment_no, comment: c.comment_text, raisedBy: c.raised_by, response: c.response_text, respondedBy: c.responded_by, respondedOn: c.responded_on, status: c.comment_status, statusLabel: CRS_STATUS[c.comment_status], closedOn: c.closed_on }));
  const holdView = (h) => ({ id: h.id, holdNo: h.hold_no, deliverableId: h.deliverable_id, description: h.description, impactProcurement: Boolean(h.impact_procurement), impactConstruction: Boolean(h.impact_construction), poRef: h.po_ref, activityRef: h.activity_ref, raisedOn: h.raised_on, raisedBy: h.raised_by, clearedOn: h.cleared_on, clearedBy: h.cleared_by, clearNote: h.clear_note, status: h.hold_status });
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const day = today(); const active = r.reg_status === 'ACTIVE';
    const miles = MILESTONES.map((m) => ({ code: m, plan: r[PLAN[m]], actual: r[ACT[m]], state: r[ACT[m]] ? 'DONE' : r[PLAN[m]] && r[PLAN[m]] < day ? 'OVERDUE' : 'PLANNED', late: Boolean(r[ACT[m]] && r[PLAN[m]] && r[ACT[m]] > r[PLAN[m]]) }));
    const d = r.drawing_id ? db.prepare('SELECT drawing_no FROM engg_drawings WHERE id = ?').get(r.drawing_id) : null;
    const out = {
      id: r.id, deliverableNo: r.deliverable_no, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, title: r.title, discipline: r.discipline, disciplineLabel: DELIV_DISCIPLINES[r.discipline], type: r.deliverable_type, typeLabel: DELIV_TYPES[r.deliverable_type], packageName: r.package_name, weight: r.weight,
      milestone: r.milestone, progress: pct(r.progress_bp), progressBp: r.progress_bp, milestones: miles, overdue: active && miles.some((m) => m.state === 'OVERDUE'), drawingId: r.drawing_id, drawingNo: d?.drawing_no ?? null, documentId: r.document_id, ownerUser: r.owner_user,
      releaseStatus: r.release_status, workflowInstanceId: r.workflow_instance_id, requestedBy: r.requested_by, registerStatus: r.reg_status, rowVersion: r.version,
      openHolds: db.prepare("SELECT COUNT(*) AS n FROM engg_holds WHERE deliverable_id = ? AND hold_status = 'OPEN' AND deleted_at IS NULL").get(r.id).n, openComments: db.prepare("SELECT COUNT(*) AS n FROM engg_crs WHERE deliverable_id = ? AND comment_status <> 'CLOSED' AND deleted_at IS NULL").get(r.id).n,
      can: { edit: can('engg.deliverable.edit') && active, release: can('engg.deliverable.submit') && active && r.release_status === 'NONE' && Boolean(r.act_ifa) && !r.act_ifc, withdraw: r.release_status === 'PENDING' && same(r.requested_by, actor.user), cancel: can('engg.deliverable.cancel') && active && r.release_status === 'NONE',
        delete: can('engg.deliverable.delete') && r.milestone === 'NOT_STARTED' && !r.workflow_instance_id, amend: can('engg.deliverable.amend') && active && Boolean(r.act_ifc), print: can('engg.deliverable.print'), export: can('engg.deliverable.export') },
    };
    if (detail) { out.comments = commentsOf(r.id); out.holds = db.prepare('SELECT * FROM engg_holds WHERE deliverable_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(r.id).map(holdView); }
    return out;
  }
  function problems(actor, o, b, cur = null) {
    const p = []; const get = (k, c) => (k in b ? b[k] : cur?.[c] ?? null);
    const seq = [['planIfr', 'plan_ifr'], ['planIfa', 'plan_ifa'], ['planIfc', 'plan_ifc'], ['planAsbuilt', 'plan_asbuilt']].map(([k, c]) => get(k, c)).filter(Boolean);
    if (seq.some((v, i) => i && v < seq[i - 1])) p.push({ field: 'planIfa', message: 'The planned dates follow IFR, IFA, IFC, as-built in that order' });
    if (b.drawingId && !db.prepare('SELECT 1 FROM engg_drawings WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.drawingId, o.id)) p.push({ field: 'drawingId', message: 'Choose a drawing of this project' });
    if (b.documentId && !db.prepare('SELECT 1 FROM doc_documents WHERE id = ? AND company_id = ?').get(b.documentId, actor.companyId)) p.push({ field: 'documentId', message: 'Choose a document of your company' });
    if (b.ownerUser && !db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, b.ownerUser)) p.push({ field: 'ownerUser', message: 'The owner is an active user of your company' });
    return p;
  }
  const COLS = { title: 'title', discipline: 'discipline', type: 'deliverable_type', packageName: 'package_name', weight: 'weight', planIfr: 'plan_ifr', planIfa: 'plan_ifa', planIfc: 'plan_ifc', planAsbuilt: 'plan_asbuilt', drawingId: 'drawing_id', documentId: 'document_id', ownerUser: 'owner_user' };

  const deliverables = {
    list(actor, query) {
      need(actor, 'engg.deliverable.view', 'see deliverables'); const s = scopeSql(actor, 'engg.deliverable.view');
      return runList(db, deliverableList, parseListRequest(deliverableList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, deliverableNo: v.deliverableNo, title: v.title, projectId: v.projectId, project: v.projectCode, discipline: v.disciplineLabel, type: v.typeLabel, package: v.packageName, weight: v.weight, milestone: v.milestone, progress: v.progress, planIfc: x.plan_ifc, actIfc: x.act_ifc, overdue: v.overdue ? 1 : 0, openHolds: v.openHolds, registerStatus: v.registerStatus }; } });
    },
    exportSource(actor, req) {
      need(actor, 'engg.deliverable.export', 'export the deliverable register'); const s = scopeSql(actor, 'engg.deliverable.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: deliverableList.label, permission: 'engg.deliverable.export', personal: false, columns: [{ key: 'deliverableNo', label: 'Deliverable no.', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'discipline', label: 'Discipline', type: 'text' }, { key: 'package', label: 'Package', type: 'text' }, { key: 'weight', label: 'Weight', type: 'number' }, { key: 'milestone', label: 'Milestone', type: 'text' }, { key: 'progress', label: 'Progress (%)', type: 'text' }, { key: 'planIfc', label: 'Planned IFC', type: 'text' }, { key: 'actIfc', label: 'Actual IFC', type: 'text' }],
        rows: () => runList(db, deliverableList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { deliverableNo: v.deliverableNo, title: v.title, project: v.projectCode, discipline: v.disciplineLabel, package: v.packageName ?? '', weight: v.weight, milestone: v.milestone, progress: v.progress, planIfc: x.plan_ifc ?? '', actIfc: x.act_ifc ?? '' }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All deliverables you may see'], count: () => countList(db, deliverableList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.deliverable.create', 'engg.deliverable.view'); fail(problems(actor, o, b));
      if (db.prepare('SELECT 1 FROM engg_deliverables WHERE company_id = ? AND deliverable_no = ? AND deleted_at IS NULL').get(actor.companyId, b.deliverableNo)) throw conflict(`Deliverable ${b.deliverableNo} is in the register already.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO engg_deliverables (company_id, deliverable_no, org_project_id, title, discipline, deliverable_type, package_name, weight, plan_ifr, plan_ifa, plan_ifc, plan_asbuilt, drawing_id, document_id, owner_user, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_deliverables', ?)")
          .run(o.company_id, b.deliverableNo, o.id, b.title, b.discipline, b.type, b.packageName, b.weight, b.planIfr, b.planIfa, b.planIfc, b.planAsbuilt, b.drawingId, b.documentId, b.ownerUser, o.id, actor.user, o.code).lastInsertRowid);
        audit(actor, 'engg_deliverables', id, 'create', o.company_id, { newValues: { deliverableNo: b.deliverableNo, weight: b.weight } }); return deliverables.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'engg.deliverable.edit'); if (r.reg_status !== 'ACTIVE') throw conflict(`${r.deliverable_no} is cancelled.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this deliverable; reload it.');
      if (r.release_status === 'PENDING') throw conflict('The IFC release waits for approval: withdraw it first.');
      const o = orgOf(r.org_project_id); fail(problems(actor, o, b, r)); const sets = Object.entries(COLS).filter(([k]) => k in b);
      return transaction(db, () => {
        if (sets.length) db.prepare(`UPDATE engg_deliverables SET ${sets.map(([, c]) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map(([k]) => b[k]), actor.user, nowIso(), r.id);
        audit(actor, 'engg_deliverables', r.id, 'update', r.company_id, { newValues: Object.fromEntries(Object.keys(b).filter((k) => k !== 'rowVersion').map((k) => [k, b[k]])) });
        if ('weight' in b) progressEvent(actor, fresh(r.id), 'weight changed'); return deliverables.get(actor, r.id);
      });
    },
    remove(actor, id) {
      const r = row(actor, id, 'engg.deliverable.delete'); if (r.milestone !== 'NOT_STARTED' || r.workflow_instance_id || db.prepare('SELECT 1 FROM engg_crs WHERE deliverable_id = ? AND deleted_at IS NULL').get(r.id) || db.prepare('SELECT 1 FROM engg_holds WHERE deliverable_id = ? AND deleted_at IS NULL').get(r.id)) throw unprocessable('Only a deliverable with no milestone, comment or hold is deleted. Cancel it instead.');
      db.prepare('UPDATE engg_deliverables SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'engg_deliverables', r.id, 'delete', r.company_id); return { id: r.id, deleted: true };
    },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'engg.deliverable.cancel'); if (r.reg_status !== 'ACTIVE' || r.release_status !== 'NONE') throw unprocessable('Only an active deliverable with no release waiting is cancelled.');
      return transaction(db, () => { db.prepare("UPDATE engg_deliverables SET reg_status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'engg_deliverables', r.id, 'cancel', r.company_id, { reason }); progressEvent(actor, fresh(r.id), 'cancelled'); return deliverables.get(actor, r.id); });
    },
    /** IFR, IFA and as-built are recorded by the people who manage the deliverables; the date is today or earlier and the order is kept. IFC is released by approval (below). */
    record(actor, id, b) {
      const r = row(actor, id, 'engg.deliverable.edit'); if (r.reg_status !== 'ACTIVE') throw conflict(`${r.deliverable_no} is cancelled.`);
      const day = b.date ?? today(); if (day > today()) fail([{ field: 'date', message: 'The date of a milestone is not in the future' }]);
      if (b.milestone === 'IFA' && !r.act_ifr) throw unprocessable('IFR comes before IFA.'); if (b.milestone === 'ASBUILT' && !r.act_ifc) throw unprocessable('As-built follows the approved IFC release.');
      if (r[ACT[b.milestone]]) throw conflict(`${b.milestone} is recorded already (${r[ACT[b.milestone]]}).`);
      const prev = MILESTONES.slice(0, MILESTONES.indexOf(b.milestone)).map((m) => r[ACT[m]]).filter(Boolean).pop(); if (prev && day < prev) fail([{ field: 'date', message: `The date is not before the previous milestone (${prev})` }]);
      return transaction(db, () => { db.prepare(`UPDATE engg_deliverables SET ${ACT[b.milestone]} = ?, updated_by = ?, updated_at = ? WHERE id = ?`).run(day, actor.user, nowIso(), r.id); const n = recompute(r.id); audit(actor, 'engg_deliverables', r.id, `milestone_${b.milestone.toLowerCase()}`, r.company_id, { newValues: { date: day } }); progressEvent(actor, n, b.milestone); return deliverables.get(actor, r.id); });
    },
    /** The IFC release: discipline lead, engineering manager, project manager. It counts as progress only when approved (BR-01). */
    release(actor, id) {
      const r = row(actor, id, 'engg.deliverable.submit'); if (r.reg_status !== 'ACTIVE' || r.release_status !== 'NONE' || r.act_ifc) throw unprocessable('Only an active deliverable that is not released and has no release waiting is sent.');
      if (!r.act_ifa) throw unprocessable('IFA is recorded before the IFC release is sent.');
      return transaction(db, () => {
        const inst = workflowOf(db).submit(actor, { docType: DELIVERABLE_DOC, docId: `${r.id}.${r.version}`, comment: `${r.deliverable_no}: release for construction`.slice(0, 300), context: { projectId: r.org_project_id } });
        db.prepare("UPDATE engg_deliverables SET release_status = 'PENDING', workflow_instance_id = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(inst.id, actor.user, actor.user, nowIso(), r.id); audit(actor, 'engg_deliverables', r.id, 'submit_release', r.company_id); return deliverables.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.release_status !== 'PENDING') throw unprocessable('Only a release waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return deliverables.get(actor, r.id); },
    /** An approved release is taken back (the design changed): IFC and as-built are cleared and the progress falls back to IFA. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'engg.deliverable.amend'); if (!r.act_ifc) throw unprocessable('Only a released deliverable is reopened.');
      return transaction(db, () => { db.prepare("UPDATE engg_deliverables SET act_ifc = NULL, act_asbuilt = NULL, release_status = 'NONE', workflow_instance_id = NULL, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); const n = recompute(r.id); audit(actor, 'engg_deliverables', r.id, 'reopen', r.company_id, { reason }); progressEvent(actor, n, 'reopened'); return deliverables.get(actor, r.id); });
    },
    history(actor, id) {
      const r = row(actor, id);
      return { approvals: db.prepare("SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.company_id = ? AND i.doc_type = ? AND i.doc_id LIKE ? ORDER BY h.id").all(r.company_id, DELIVERABLE_DOC, `${r.id}.%`), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'engg_deliverables' AND entity_id = ? ORDER BY id").all(String(r.id)) };
    },
    print(actor, id) {
      const r = row(actor, id, 'engg.deliverable.print'); const v = view(actor, r, { detail: true });
      const rows = v.milestones.map((m) => `<tr><td>${esc(m.code)}</td><td>${esc(m.plan ?? '')}</td><td>${esc(m.actual ?? '')}</td><td>${esc(m.state)}</td></tr>`).join('');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.deliverableNo)}</title></head><body><h1>${esc(v.deliverableNo)}: ${esc(v.title)}</h1><p>${esc(v.projectCode)} · ${esc(v.disciplineLabel)} · ${esc(v.typeLabel)} · weight ${v.weight} · progress ${esc(v.progress)} %</p><table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Milestone</th><th>Planned</th><th>Actual</th><th>State</th></tr></thead><tbody>${rows}</tbody></table><p>Open comments ${v.openComments} · open holds ${v.openHolds}</p></body></html>`;
    },
    import(actor, b) {
      project(actor, b.projectId, 'engg.deliverable.create', 'engg.deliverable.view'); const made = []; const errors = [];
      b.rows.forEach((x, i) => { try { const v = deliverables.create(actor, { projectId: b.projectId, ...x }); made.push({ row: i + 1, id: v.id, deliverableNo: v.deliverableNo }); } catch (e) { errors.push({ row: i + 1, deliverableNo: x.deliverableNo, message: e.details?.[0]?.message ?? e.message }); } });
      return { created: made.length, errors, rows: made };
    },
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.release_status !== 'PENDING') return;
      if (outcome === 'APPROVED') { db.prepare("UPDATE engg_deliverables SET act_ifc = ?, release_status = 'NONE', updated_by = ?, updated_at = ? WHERE id = ?").run(today(), actor.user, nowIso(), r.id); const n = recompute(r.id); audit(actor, 'engg_deliverables', r.id, 'release', r.company_id); event('engg.deliverable.released', actor, 'engg_deliverable', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, deliverableId: r.id, deliverableNo: r.deliverable_no, discipline: r.discipline, drawingId: r.drawing_id, documentId: r.document_id }); progressEvent(actor, n, 'IFC released'); return; }
      db.prepare("UPDATE engg_deliverables SET release_status = 'NONE', workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(outcome === 'CANCELLED' && instance.status === 'WITHDRAWN' ? null : r.workflow_instance_id, actor.user, nowIso(), r.id); audit(actor, 'engg_deliverables', r.id, `release_${outcome.toLowerCase()}`, r.company_id, { reason: comment ?? null });
    },
  };

  // ---- the client comment resolution sheet ---------------------------------------------------------------------------------------------------------------
  const crsRow = (actor, id) => { const c = db.prepare('SELECT * FROM engg_crs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!c || !may(actor, 'engg.deliverable.view', c.org_project_id)) throw notFound('That comment does not exist.'); need(actor, 'engg.deliverable.edit', 'work on the comment sheet', c.org_project_id); return c; };
  const comments = {
    add(actor, id, b) {
      const r = row(actor, id, 'engg.deliverable.edit'); if (r.reg_status !== 'ACTIVE') throw conflict(`${r.deliverable_no} is cancelled.`);
      const no = (db.prepare('SELECT MAX(comment_no) AS n FROM engg_crs WHERE deliverable_id = ? AND revision = ?').get(r.id, b.revision).n ?? 0) + 1;
      db.prepare("INSERT INTO engg_crs (company_id, deliverable_id, org_project_id, revision, comment_no, comment_text, raised_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_deliverables', ?)").run(r.company_id, r.id, r.org_project_id, b.revision, no, b.comment, actor.user, r.org_project_id, actor.user, String(r.id));
      audit(actor, 'engg_deliverables', r.id, 'comment_add', r.company_id, { newValues: { revision: b.revision, no } }); return deliverables.get(actor, r.id);
    },
    respond(actor, id, b) {
      const c = crsRow(actor, id); if (c.comment_status === 'CLOSED') throw conflict('That comment is closed.');
      db.prepare("UPDATE engg_crs SET response_text = ?, responded_by = ?, responded_on = ?, comment_status = 'RESPONDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.response, actor.user, today(), actor.user, nowIso(), c.id);
      audit(actor, 'engg_crs', c.id, 'respond', c.company_id); return deliverables.get(actor, c.deliverable_id);
    },
    close(actor, id) {
      const c = crsRow(actor, id); if (c.comment_status !== 'RESPONDED') throw unprocessable('Only a comment that has a response is closed.');
      db.prepare("UPDATE engg_crs SET comment_status = 'CLOSED', closed_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(today(), actor.user, nowIso(), c.id); audit(actor, 'engg_crs', c.id, 'close', c.company_id); return deliverables.get(actor, c.deliverable_id);
    },
    reopen(actor, id, { reason }) {
      const c = crsRow(actor, id); if (c.comment_status === 'OPEN') throw unprocessable('That comment is open already.');
      db.prepare("UPDATE engg_crs SET comment_status = 'OPEN', closed_on = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), c.id); audit(actor, 'engg_crs', c.id, 'reopen', c.company_id, { reason }); return deliverables.get(actor, c.deliverable_id);
    },
  };

  // ---- holds (FR-05) ---------------------------------------------------------------------------------------------------------------------------------------
  const holds = {
    list(actor, q = {}) {
      need(actor, 'engg.deliverable.view', 'see holds'); const s = scopeSql(actor, 'engg.deliverable.view'); const params = { ...s.params }; const w = ['x.deleted_at IS NULL']; if (q.projectId) { w.push('x.org_project_id = :pid'); params.pid = Number(q.projectId); } if (q.status) { w.push('x.hold_status = :st'); params.st = q.status; }
      return db.prepare(`SELECT x.*, d.deliverable_no, d.title FROM engg_holds x JOIN engg_deliverables d ON d.id = x.deliverable_id WHERE ${w.join(' AND ')} AND ${s.sql} ORDER BY x.hold_status, x.id DESC LIMIT 500`).all(params).map((h) => ({ ...holdView(h), deliverableNo: h.deliverable_no, deliverableTitle: h.title }));
    },
    raise(actor, b) {
      const r = row(actor, b.deliverableId, 'engg.deliverable.edit'); if (r.reg_status !== 'ACTIVE') throw conflict(`${r.deliverable_no} is cancelled.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO engg_holds (company_id, hold_no, deliverable_id, org_project_id, description, impact_procurement, impact_construction, po_ref, activity_ref, raised_on, raised_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_deliverables', ?)")
          .run(r.company_id, nextNo('engg_holds', 'hold_no', 'HLD', r.company_id), r.id, r.org_project_id, b.description, b.impactProcurement ? 1 : 0, b.impactConstruction ? 1 : 0, b.poRef, b.activityRef, today(), actor.user, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
        const h = db.prepare('SELECT * FROM engg_holds WHERE id = ?').get(id); audit(actor, 'engg_holds', id, 'raise', r.company_id, { newValues: { holdNo: h.hold_no } });
        event('engg.hold.raised', actor, 'engg_hold', id, r.company_id, r.org_project_id, { projectId: r.org_project_id, holdId: id, holdNo: h.hold_no, deliverableId: r.id, deliverableNo: r.deliverable_no, poRef: b.poRef, activityRef: b.activityRef, impactProcurement: b.impactProcurement, impactConstruction: b.impactConstruction }); return holdView(h);
      });
    },
    clear(actor, id, b) {
      const h = db.prepare('SELECT * FROM engg_holds WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!h || !may(actor, 'engg.deliverable.view', h.org_project_id)) throw notFound('That hold does not exist.'); need(actor, 'engg.deliverable.edit', 'clear a hold', h.org_project_id);
      if (h.hold_status !== 'OPEN') throw unprocessable('That hold is cleared already.');
      db.prepare("UPDATE engg_holds SET hold_status = 'CLEARED', cleared_on = ?, cleared_by = ?, clear_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(today(), actor.user, b.note, actor.user, nowIso(), h.id);
      audit(actor, 'engg_holds', h.id, 'clear', h.company_id); event('engg.hold.cleared', actor, 'engg_hold', h.id, h.company_id, h.org_project_id, { projectId: h.org_project_id, holdId: h.id, holdNo: h.hold_no, deliverableId: h.deliverable_id, poRef: h.po_ref, activityRef: h.activity_ref });
      return holdView(db.prepare('SELECT * FROM engg_holds WHERE id = ?').get(h.id));
    },
  };

  // ---- progress, S-curve and the dashboard (FR-02, BR-01) -------------------------------------------------------------------------------------------------------
  const progress = {
    get(actor, q = {}) {
      need(actor, 'engg.deliverable.view', 'see the engineering progress'); const s = scopeSql(actor, 'engg.deliverable.view'); const params = { ...s.params }; let extra = ''; if (q.projectId) { extra = ' AND x.org_project_id = :pid'; params.pid = Number(q.projectId); }
      const rows = db.prepare(`SELECT x.* FROM engg_deliverables x WHERE x.deleted_at IS NULL AND x.reg_status = 'ACTIVE' AND ${s.sql}${extra}`).all(params); const day = today(); const w = weightsFor(actor.companyId);
      const group = (key) => Object.entries(rows.reduce((m, r) => { (m[r[key] ?? '—'] ??= []).push(r); return m; }, {})).map(([k, list]) => ({ key: k, label: key === 'discipline' ? DELIV_DISCIPLINES[k] ?? k : k, count: list.length, weight: list.reduce((a, r) => a + r.weight, 0), progressBp: rollup(list), progress: pct(rollup(list)), plannedBp: Math.round(list.reduce((a, r) => a + r.weight * plannedBp(w, r, day), 0) / (list.reduce((a, r) => a + r.weight, 0) || 1)) })).map((g) => ({ ...g, planned: pct(g.plannedBp) })).sort((a, b) => a.label.localeCompare(b.label));
      const total = rows.reduce((a, r) => a + r.weight, 0) || 1; const planned = (d) => Math.round(rows.reduce((a, r) => a + r.weight * plannedBp(w, r, d), 0) / total); const actual = (d) => Math.round(rows.reduce((a, r) => a + r.weight * actualBp(w, r, d), 0) / total);
      const dates = rows.flatMap((r) => MILESTONES.map((m) => r[PLAN[m]]).filter(Boolean)).sort(); const sCurve = [];
      if (dates.length) {
        const first = dates[0]; const last = dates[dates.length - 1]; let cur = `${first.slice(0, 7)}-01`; const seen = new Set();
        while (cur <= last && sCurve.length < 60) { const [y, m] = cur.split('-').map(Number); const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); const d = end > last ? last : end; if (!seen.has(d)) { seen.add(d); sCurve.push({ date: d, plannedBp: planned(d), planned: pct(planned(d)), actualBp: d <= day ? actual(d) : null, actual: d <= day ? pct(actual(d)) : null }); } cur = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); }
        if (day > first && day < last && !seen.has(day)) { sCurve.push({ date: day, plannedBp: planned(day), planned: pct(planned(day)), actualBp: actual(day), actual: pct(actual(day)) }); sCurve.sort((a, b) => a.date.localeCompare(b.date)); }
      }
      const overdue = rows.filter((r) => MILESTONES.some((m) => r[PLAN[m]] && r[PLAN[m]] < day && !r[ACT[m]])).map((r) => { const m = MILESTONES.find((mm) => r[PLAN[mm]] && r[PLAN[mm]] < day && !r[ACT[mm]]); return { id: r.id, deliverableNo: r.deliverable_no, title: r.title, discipline: DELIV_DISCIPLINES[r.discipline], milestone: m, planned: r[PLAN[m]], daysLate: Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${r[PLAN[m]]}T00:00:00Z`)) / 86_400_000) }; }).sort((a, b) => b.daysLate - a.daysLate);
      const openHolds = holds.list(actor, { projectId: q.projectId, status: 'OPEN' }); const overall = rollup(rows); const plannedNow = planned(day);
      const vdrOverdue = db.prepare(`SELECT COUNT(*) AS n FROM engg_vdr_items x WHERE x.deleted_at IS NULL AND x.status IN ('REQUIRED', 'RESUBMIT') AND x.due_date < :day AND ${s.sql}${extra}`).get({ ...params, day }).n;
      const openComments = db.prepare(`SELECT COUNT(*) AS n FROM engg_crs x WHERE x.deleted_at IS NULL AND x.comment_status <> 'CLOSED' AND ${s.sql}${extra}`).get(params).n;
      return { asOf: day, weights: w, overall: { progressBp: overall, progress: pct(overall), plannedBp: plannedNow, planned: pct(plannedNow), varianceBp: overall - plannedNow, deliverables: rows.length, weight: rows.reduce((a, r) => a + r.weight, 0) }, byDiscipline: group('discipline'), byPackage: group('package_name'), sCurve, overdue, holds: openHolds,
        tiles: [['progress', 'Actual progress (%)', pct(overall)], ['planned', 'Planned progress (%)', pct(plannedNow)], ['overdue', 'Overdue deliverables', overdue.length], ['holds', 'Open holds', openHolds.length], ['comments', 'Open client comments', openComments], ['vdr', 'VDR items overdue', vdrOverdue]].map(([key, label, value]) => ({ key, label, value })) };
    },
  };
  return { deliverables, comments, holds, progress, deliverableDecide: deliverables.decide, _helpers: { view, nextNo, row: fresh } };
}

// ---- workflow, resolvers, evidence -----------------------------------------------------------------------------------------------------------------------
const userRoles = (u) => { try { return JSON.parse(u.roles_json ?? '[]'); } catch { return []; } };
/** The discipline lead checks first: a design coordinator other than the sender; when there is none, the construction manager. */
if (!workflowResolvers.get('engg.disciplineLead')) workflowResolvers.register('engg.disciplineLead', ({ db, companyId, instance }) => {
  const me = String(instance.submittedBy ?? '').toLowerCase();
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes('DESIGN') && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'CM' }];
});
if (!workflowResolvers.get('engg.deliverablePm')) workflowResolvers.register('engg.deliverablePm', ({ db, companyId, instance }) => {
  const oid = db.prepare('SELECT org_project_id AS n FROM engg_deliverables WHERE id = ?').get(rid(instance.docId))?.n; const x = oid ? db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(oid) : null; const me = String(instance.submittedBy ?? '').toLowerCase();
  if (x?.pm_user && x.pm_user.toLowerCase() !== me) return [{ user: x.pm_user }];
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes('PM') && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'PD' }];
});
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const dline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM engg_deliverables x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: DELIVERABLE_DOC, label: 'IFC release of a deliverable', processOwner: 'DESIGN', route: (id) => `/engg/deliverable?id=${id}`,
  describe(db, companyId, id) { const r = dline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.deliverable_no, title: `${r.code} ${r.title}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = dline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Deliverable', value: `${r.deliverable_no} · ${r.title}` }, { label: 'Discipline', value: DELIV_DISCIPLINES[r.discipline] }, { label: 'Type', value: DELIV_TYPES[r.deliverable_type] }, { label: 'Weight', value: String(r.weight) }, { label: 'Planned IFC', value: r.plan_ifc ?? 'Not set' }, { label: 'IFA recorded', value: r.act_ifa ?? 'No' }], lines: [] }; },
  defaultDefinition: { name: 'Deliverable IFC release: discipline lead, engineering manager, project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('LEAD', 'Discipline lead', [{ kind: 'resolver', resolver: 'engg.disciplineLead' }]), step('DESIGN', 'Engineering manager', [{ kind: 'role', role: 'DESIGN' }]), step('PM', 'Project manager', [{ kind: 'resolver', resolver: 'engg.deliverablePm' }])] },
  hooks: { onApproved: (db, { instance, actor }) => enggOf(db)?.deliverableDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => enggOf(db)?.deliverableDecide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => enggOf(db)?.deliverableDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => enggOf(db)?.deliverableDecide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(DELIVERABLE_DOC, ({ db, instance }) => {
  const r = dline(db, rid(instance.docId)); if (!r) return { sections: [] }; const open = db.prepare("SELECT COUNT(*) AS n FROM engg_crs WHERE deliverable_id = ? AND comment_status <> 'CLOSED' AND deleted_at IS NULL").get(r.id).n; const holds = db.prepare("SELECT COUNT(*) AS n FROM engg_holds WHERE deliverable_id = ? AND hold_status = 'OPEN' AND deleted_at IS NULL").get(r.id).n;
  return { sections: [{ code: 'engg-deliverable', title: 'The deliverable', kind: 'metrics', items: [{ label: 'Deliverable', value: `${r.deliverable_no} ${r.title}`, format: 'text' }, { label: 'Milestone reached', value: r.milestone, format: 'text' }, { label: 'IFR / IFA recorded', value: `${r.act_ifr ?? '—'} / ${r.act_ifa ?? '—'}`, format: 'text' }, { label: 'Planned IFC', value: r.plan_ifc ?? '—', format: 'text' }, { label: 'Open client comments', value: String(open), format: 'text' }, { label: 'Open holds', value: String(holds), format: 'text' }] }] };
});
void badRequest; void addDays;
export { VDR_DOC };
