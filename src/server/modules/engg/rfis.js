import { transaction } from '../../platform/db/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { enggOf } from './drawings.js';
import { BALL, DISCIPLINES, RESPONSE_TYPES, RFI_CLOSE_DOC, RFI_ISSUE_DOC, RFI_OPEN, RFI_PRIORITY, RFI_SLA_DAYS, RFI_STATUS, addDays, diffDays, esc, nowIso, rid, rupees, same, toPaise } from './constants.js';

// RFI management (part 11.02). An RFI is raised on site with its links (location, activity, BOQ item, drawing and revision, specification clause), photos and markups. It is checked by the design coordinator (or the construction manager) and issued to the consultant;
// the consultant answers (a clarification, a design change or an instruction); the answer is verified by the design coordinator and the raiser's lead, and only then is the RFI closed (BR-01). The ball in court says who has to act; ageing and the SLA by priority
// say how late it is; an answer with a time impact makes a delay-register draft (BR-02) until 13.05 takes it over; an open RFI that holds an activity shows as a constraint for the look-ahead (13.04).
const OPEN_SQL = "('SUBMITTED', 'ISSUED', 'RESPONDED', 'CLOSE_REQUESTED')";
const AGE_SQL = "CAST(julianday(date('now', '+330 minutes')) - julianday(COALESCE(x.issued_on, substr(x.created_at, 1, 10))) AS INTEGER)";
export const rfiList = defineList({
  code: 'engg.rfis', label: 'RFI register', permission: 'engg.rfi.view',
  from: 'engg_rfis x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.rfi_no', 'x.subject', 'p.code', 'x.question', 'x.activity_ref', 'x.spec_ref'], defaultSort: '-rfiNo',
  columns: {
    rfiNo: { sql: 'x.rfi_no', type: 'text', label: 'RFI no.' }, subject: { sql: 'x.subject', type: 'text', label: 'Subject' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    discipline: { sql: 'x.discipline', type: 'enum', label: 'Discipline', options: Object.entries(DISCIPLINES) }, priority: { sql: 'x.priority', type: 'enum', label: 'Priority', options: Object.entries(RFI_PRIORITY) },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(RFI_STATUS) }, ball: { sql: 'x.ball_in_court', type: 'enum', label: 'Ball in court', options: Object.entries(BALL) },
    requiredBy: { sql: 'x.required_by', type: 'date', label: 'Required by' }, issuedOn: { sql: 'x.issued_on', type: 'date', label: 'Issued' }, drawingId: { sql: 'x.drawing_id', type: 'number', label: 'Drawing id' },
    ageDays: { sql: `(CASE WHEN x.status IN ${OPEN_SQL} THEN ${AGE_SQL} ELSE 0 END)`, type: 'number', label: 'Age (days)' },
    overdue: { sql: `(CASE WHEN x.status IN ${OPEN_SQL} AND x.required_by < date('now', '+330 minutes') THEN 1 ELSE 0 END)`, type: 'number', label: 'Overdue' },
    critical: { sql: `(CASE WHEN x.activity_critical = 1 AND x.status IN ${OPEN_SQL} THEN 1 ELSE 0 END)`, type: 'number', label: 'On critical path' },
    hold: { sql: `(CASE WHEN x.hold_activity = 1 AND x.status IN ${OPEN_SQL} THEN 1 ELSE 0 END)`, type: 'number', label: 'Holds an activity' },
    costImpact: { sql: '(x.cost_impact / 100.0)', type: 'money', label: 'Cost impact (₹)' }, timeImpact: { sql: 'x.time_impact_days', type: 'number', label: 'Time impact (days)' },
  },
});

export function createRfiService({ db, base }) {
  const authz = authzOf(db);
  const { may, need, fail, project, orgOf, scopeSql, audit, event, today } = base;
  void authz;
  const row = (actor, id, key = 'engg.rfi.view') => {
    const r = db.prepare('SELECT * FROM engg_rfis WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'engg.rfi.view', r.org_project_id)) throw notFound('That RFI does not exist.');
    if (key !== 'engg.rfi.view') need(actor, key, 'do that with an RFI', r.org_project_id);
    return r;
  };
  const fresh = (id) => db.prepare('SELECT * FROM engg_rfis WHERE id = ?').get(id);
  const nextNo = (companyId) => { let k = db.prepare('SELECT COUNT(*) AS n FROM engg_rfis WHERE company_id = ?').get(companyId).n + 1; let no = `RFI-${String(k).padStart(5, '0')}`; while (db.prepare('SELECT 1 FROM engg_rfis WHERE company_id = ? AND rfi_no = ?').get(companyId, no)) { k += 1; no = `RFI-${String(k).padStart(5, '0')}`; } return no; };
  const route = (r, ev, to, by, note = null, from = null) => {
    const seq = (db.prepare('SELECT MAX(seq) AS n FROM engg_rfi_routing WHERE rfi_id = ?').get(r.id).n ?? 0) + 1;
    db.prepare("INSERT INTO engg_rfi_routing (company_id, rfi_id, org_project_id, seq, event, from_party, to_party, note, at, by_user, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_rfis', ?)").run(r.company_id, r.id, r.org_project_id, seq, ev, from, to, note, nowIso(), by, r.org_project_id, by, String(r.id));
  };
  const setBall = (r, ball, ev, by, note = null) => { db.prepare('UPDATE engg_rfis SET ball_in_court = ? WHERE id = ?').run(ball, r.id); route(r, ev, ball, by, note, r.ball_in_court); };

  // ---- views ------------------------------------------------------------------------------------------------------------------------------------
  const ageOf = (r) => (RFI_OPEN.includes(r.status) ? Math.max(0, diffDays(today(), r.issued_on ?? r.created_at.slice(0, 10))) : 0);

  /** FR-04: use the same overdue rule and outbox event for manual and scheduled escalation. */
  function escalateOverdue(actor, canView) {
    return transaction(db, () => {
      const day = today();
      const rows = db.prepare(`SELECT * FROM engg_rfis
        WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL
          AND status IN ('ISSUED', 'RESPONDED') AND escalated_at IS NULL
        ORDER BY activity_critical DESC, id`).all(actor.companyId);
      const done = [];
      for (const r of rows) {
        const slaBreached = r.status === 'ISSUED' && r.issued_on && day > addDays(r.issued_on, RFI_SLA_DAYS[r.priority]);
        if (!(slaBreached || r.required_by < day) || !canView(r)) continue;
        const ageDays = ageOf(r);
        const critical = Boolean(r.activity_critical);
        const recipients = ['role:DESIGN'];
        const raiser = r.requested_by ?? r.created_by;
        if (raiser) recipients.push(`user:${raiser}`);
        const link = `/engg/rfi?id=${r.id}`;
        notificationsOf(db)?.notify({
          companyId: r.company_id, projectId: r.org_project_id, siteId: r.rfi_site_id,
          templateCode: 'engg.rfi.overdue', recipients,
          data: { rfi: r.rfi_no, subject: r.subject,
            detail: `${RFI_PRIORITY[r.priority]} priority, ${ageDays} days old${critical ? ', on the critical path' : ''}, ball with ${BALL[r.ball_in_court]}.`, link },
          link, sourceType: 'engg_rfi', sourceId: r.id,
        });
        const escalatedAt = nowIso();
        db.prepare('UPDATE engg_rfis SET escalated_at = ? WHERE id = ?').run(escalatedAt, r.id);
        route(r, 'ESCALATED', r.ball_in_court, actor.user, `${ageDays} days`, r.ball_in_court);
        audit(actor, 'engg_rfis', r.id, 'escalate', r.company_id, { oldValues: { escalatedAt: null }, newValues: { escalatedAt } });
        event('engg.rfi.escalated', actor, 'engg_rfi', r.id, r.company_id, r.org_project_id,
          { projectId: r.org_project_id, rfiId: r.id, rfiNo: r.rfi_no, priority: r.priority, ageDays, critical, ballInCourt: r.ball_in_court });
        done.push({ id: r.id, rfiNo: r.rfi_no, critical });
      }
      return { escalated: done.length, rows: done };
    });
  }
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const open = RFI_OPEN.includes(r.status); const editable = ['DRAFT', 'RETURNED'].includes(r.status);
    const slaDue = r.issued_on ? addDays(r.issued_on, RFI_SLA_DAYS[r.priority]) : null; const d = r.drawing_id ? db.prepare('SELECT drawing_no, title FROM engg_drawings WHERE id = ?').get(r.drawing_id) : null;
    const rev = r.drawing_revision_id ? db.prepare('SELECT rev_label, status_code FROM engg_drawing_revisions WHERE id = ?').get(r.drawing_revision_id) : null; const rr = r.response_revision_id ? db.prepare('SELECT rev_label, status_code, drawing_id FROM engg_drawing_revisions WHERE id = ?').get(r.response_revision_id) : null;
    const out = {
      id: r.id, rfiNo: r.rfi_no, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, subject: r.subject, question: r.question, discipline: r.discipline, disciplineLabel: DISCIPLINES[r.discipline], siteId: r.rfi_site_id, wbsId: r.wbs_id, locationId: r.location_id,
      activityRef: r.activity_ref, activityCritical: Boolean(r.activity_critical), holdActivity: Boolean(r.hold_activity), hold: Boolean(r.hold_activity) && open, boqItemId: r.boq_item_id, drawingId: r.drawing_id, drawingNo: d?.drawing_no ?? null, drawingTitle: d?.title ?? null,
      drawingRevisionId: r.drawing_revision_id, drawingRevision: rev?.rev_label ?? null, specRef: r.spec_ref, proposedSolution: r.proposed_solution, priority: r.priority, priorityLabel: RFI_PRIORITY[r.priority], requiredBy: r.required_by,
      costImpactFlag: Boolean(r.cost_impact_flag), timeImpactFlag: Boolean(r.time_impact_flag), ballInCourt: r.ball_in_court, ballLabel: BALL[r.ball_in_court], status: r.status, statusLabel: RFI_STATUS[r.status], issuedOn: r.issued_on, consultant: r.consultant,
      ageDays: ageOf(r), slaDays: RFI_SLA_DAYS[r.priority], slaDue, slaBreached: r.status === 'ISSUED' && Boolean(slaDue) && today() > slaDue, overdue: open && r.required_by < today(), criticalOpen: Boolean(r.activity_critical) && open, escalatedAt: r.escalated_at,
      responseType: r.response_type, responseTypeLabel: r.response_type ? RESPONSE_TYPES[r.response_type] : null, responseText: r.response_text, respondedOn: r.responded_on, respondedBy: r.responded_by, responseRevisionId: r.response_revision_id, responseRevision: rr ? `${rr.rev_label} ${rr.status_code}` : null, instructionRef: r.instruction_ref,
      costImpact: rupees(r.cost_impact), timeImpactDays: r.time_impact_days, variationRef: r.variation_ref, verifiedBy: r.verified_by, verifiedOn: r.verified_on, closedAt: r.closed_at, requestedBy: r.requested_by, issueWorkflowId: r.issue_workflow_id, closeWorkflowId: r.close_workflow_id, createdBy: r.created_by, rowVersion: r.version,
      can: {
        edit: can('engg.rfi.edit') && editable, submit: can('engg.rfi.submit') && editable, withdraw: (r.status === 'SUBMITTED' || r.status === 'CLOSE_REQUESTED') && same(r.requested_by, actor.user), cancel: can('engg.rfi.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'ISSUED', 'RESPONDED'].includes(r.status),
        delete: can('engg.rfi.delete') && r.status === 'DRAFT' && !r.issue_workflow_id, amend: can('engg.rfi.amend') && ['CLOSED', 'CANCELLED', 'REJECTED'].includes(r.status), respond: can('engg.rfi.respond') && r.status === 'ISSUED', requestClose: can('engg.rfi.submit') && r.status === 'RESPONDED',
        rework: can('engg.rfi.approve') && r.status === 'RESPONDED', print: can('engg.rfi.print'), export: can('engg.rfi.export'),
      },
    };
    if (detail) {
      out.routing = db.prepare('SELECT seq, event, from_party, to_party, note, at, by_user FROM engg_rfi_routing WHERE rfi_id = ? ORDER BY seq').all(r.id).map((x) => ({ seq: x.seq, event: x.event, from: x.from_party, to: x.to_party, note: x.note, at: x.at, by: x.by_user }));
      const dd = db.prepare('SELECT id, delay_days, draft_status FROM engg_rfi_delay_drafts WHERE rfi_id = ? AND deleted_at IS NULL').get(r.id); out.delayDraft = dd ? { id: dd.id, days: dd.delay_days, status: dd.draft_status } : null;
    }
    return out;
  };

  // ---- validation -----------------------------------------------------------------------------------------------------------------------------
  function problems(actor, o, b, current = null) {
    const p = []; const day = today();
    if (b.requiredBy !== undefined && b.requiredBy < day && (!current || b.requiredBy !== current.required_by)) p.push({ field: 'requiredBy', message: 'The required-by date is today or later' });
    if (b.siteId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND company_id = ?').get(b.siteId, actor.companyId)) p.push({ field: 'siteId', message: 'Choose a site of your company' });
    if (b.wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.wbsId, o.id)) p.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
    if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, o.id)) p.push({ field: 'locationId', message: 'Choose a location of this project' });
    if (b.boqItemId && !db.prepare('SELECT 1 FROM proj_boq_lines WHERE id = ? AND project_id = ?').get(b.boqItemId, o.id) && !db.prepare('SELECT 1 FROM proj_boq_items WHERE id = ? AND project_id = ?').get(b.boqItemId, o.id)) p.push({ field: 'boqItemId', message: 'Choose a BOQ item of this project' });
    if (b.drawingId && !db.prepare("SELECT 1 FROM engg_drawings WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL").get(b.drawingId, o.id)) p.push({ field: 'drawingId', message: 'Choose a drawing of this project' });
    if (b.drawingRevisionId) {
      const drawingId = b.drawingId ?? current?.drawing_id; const r = db.prepare('SELECT drawing_id FROM engg_drawing_revisions WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.drawingRevisionId, o.id);
      if (!r || (drawingId && r.drawing_id !== drawingId)) p.push({ field: 'drawingRevisionId', message: 'Choose a revision of the drawing' });
    }
    return p;
  }
  const FIELD = { subject: 'subject', question: 'question', discipline: 'discipline', siteId: 'rfi_site_id', wbsId: 'wbs_id', locationId: 'location_id', activityRef: 'activity_ref', activityCritical: 'activity_critical', holdActivity: 'hold_activity', boqItemId: 'boq_item_id', drawingId: 'drawing_id', drawingRevisionId: 'drawing_revision_id', specRef: 'spec_ref', proposedSolution: 'proposed_solution', priority: 'priority', requiredBy: 'required_by', costImpactFlag: 'cost_impact_flag', timeImpactFlag: 'time_impact_flag', consultant: 'consultant' };
  const dbv = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

  // ---- the RFIs ----------------------------------------------------------------------------------------------------------------------------------
  const rfis = {
    list(actor, query) {
      need(actor, 'engg.rfi.view', 'see RFIs'); const s = scopeSql(actor, 'engg.rfi.view');
      return runList(db, rfiList, parseListRequest(rfiList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, rfiNo: v.rfiNo, subject: v.subject, projectId: v.projectId, project: v.projectCode, discipline: v.disciplineLabel, priority: v.priority, priorityLabel: v.priorityLabel, status: v.status, statusLabel: v.statusLabel, ball: v.ballInCourt, ballLabel: v.ballLabel, requiredBy: v.requiredBy, issuedOn: v.issuedOn, ageDays: v.ageDays, overdue: v.overdue ? 1 : 0, critical: v.criticalOpen ? 1 : 0, hold: v.hold ? 1 : 0, drawingNo: v.drawingNo, costImpact: v.costImpact, timeImpact: v.timeImpactDays }; } });
    },
    exportSource(actor, req) {
      need(actor, 'engg.rfi.export', 'export the RFI register'); const s = scopeSql(actor, 'engg.rfi.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: rfiList.label, permission: 'engg.rfi.export', personal: false, columns: [{ key: 'rfiNo', label: 'RFI no.', type: 'text' }, { key: 'subject', label: 'Subject', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'discipline', label: 'Discipline', type: 'text' }, { key: 'priority', label: 'Priority', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'ball', label: 'Ball in court', type: 'text' }, { key: 'requiredBy', label: 'Required by', type: 'text' }, { key: 'ageDays', label: 'Age (days)', type: 'number' }, { key: 'costImpact', label: 'Cost impact (₹)', type: 'money' }, { key: 'timeImpact', label: 'Time impact (days)', type: 'number' }],
        rows: () => runList(db, rfiList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { rfiNo: v.rfiNo, subject: v.subject, project: v.projectCode, discipline: v.disciplineLabel, priority: v.priorityLabel, status: v.statusLabel, ball: v.ballLabel, requiredBy: v.requiredBy, ageDays: v.ageDays, costImpact: v.costImpact, timeImpact: v.timeImpactDays }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All RFIs you may see'], count: () => countList(db, rfiList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.rfi.create', 'engg.rfi.view'); fail(problems(actor, o, b));
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO engg_rfis (company_id, rfi_no, org_project_id, subject, question, discipline, rfi_site_id, wbs_id, location_id, activity_ref, activity_critical, hold_activity, boq_item_id, drawing_id, drawing_revision_id, spec_ref, proposed_solution, priority, required_by, cost_impact_flag, time_impact_flag, consultant, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_rfis', ?)")
          .run(o.company_id, nextNo(o.company_id), o.id, b.subject, b.question, b.discipline, b.siteId, b.wbsId, b.locationId, b.activityRef, dbv(b.activityCritical), dbv(b.holdActivity), b.boqItemId, b.drawingId, b.drawingRevisionId, b.specRef, b.proposedSolution, b.priority, b.requiredBy, dbv(b.costImpactFlag), dbv(b.timeImpactFlag), b.consultant, o.id, actor.user, o.code).lastInsertRowid);
        const r = fresh(id); route(r, 'RAISED', 'RAISER', actor.user); audit(actor, 'engg_rfis', id, 'create', o.company_id, { newValues: { rfiNo: r.rfi_no, subject: b.subject } }); return rfis.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'engg.rfi.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`${r.rfi_no} is ${RFI_STATUS[r.status].toLowerCase()}: it is not edited now.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this RFI; reload it.');
      const o = orgOf(r.org_project_id); fail(problems(actor, o, b, r));
      const sets = Object.entries(FIELD).filter(([k]) => k in b);
      return transaction(db, () => {
        if (sets.length) db.prepare(`UPDATE engg_rfis SET ${sets.map(([, c]) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map(([k]) => dbv(b[k])), actor.user, nowIso(), r.id);
        audit(actor, 'engg_rfis', r.id, 'update', r.company_id); return rfis.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'engg.rfi.delete'); if (r.status !== 'DRAFT' || r.issue_workflow_id) throw unprocessable('Only a draft that was never sent is deleted.'); db.prepare('UPDATE engg_rfis SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'engg_rfis', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    /** The raiser sends the RFI to the design coordinator (or the construction manager), who checks it and issues it to the consultant. */
    submit(actor, id) {
      const r = row(actor, id, 'engg.rfi.submit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or a returned RFI is sent.');
      if (r.required_by < today()) throw unprocessable('The required-by date has passed: change it before sending.');
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.issue_workflow_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: RFI_ISSUE_DOC, docId: String(r.id), comment: `${r.rfi_no}: ${r.subject}`.slice(0, 300), context: ctx }); db.prepare('UPDATE engg_rfis SET issue_workflow_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE engg_rfis SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id);
        setBall(fresh(r.id), 'DESIGN', 'SENT', actor.user); audit(actor, 'engg_rfis', r.id, 'submit', r.company_id); return rfis.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) {
      const r = row(actor, id); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      if (r.status === 'SUBMITTED') workflowOf(db).withdraw(actor, r.issue_workflow_id, { comment: reason });
      else if (r.status === 'CLOSE_REQUESTED') workflowOf(db).withdraw(actor, r.close_workflow_id, { comment: reason });
      else throw unprocessable('Only an RFI waiting for approval is withdrawn.');
      return rfis.get(actor, r.id);
    },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'engg.rfi.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'ISSUED', 'RESPONDED'].includes(r.status)) throw unprocessable('That RFI cannot be cancelled now.');
      return transaction(db, () => {
        if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.issue_workflow_id, actor.user, 'CANCELLED', reason);
        db.prepare("UPDATE engg_rfis SET status = 'CANCELLED', ball_in_court = 'NONE', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id);
        db.prepare("UPDATE engg_rfi_delay_drafts SET draft_status = 'DISCARDED' WHERE rfi_id = ? AND draft_status = 'DRAFT'").run(r.id);
        route(fresh(r.id), 'CANCELLED', 'NONE', actor.user, reason, r.ball_in_court); audit(actor, 'engg_rfis', r.id, 'cancel', r.company_id, { reason }); return rfis.get(actor, r.id);
      });
    },
    /** A closed, cancelled or rejected RFI is taken up again as a new draft that points at the old one. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'engg.rfi.amend'); if (!['CLOSED', 'CANCELLED', 'REJECTED'].includes(r.status)) throw unprocessable('Only a closed, cancelled or rejected RFI is amended.');
      return transaction(db, () => {
        const n = rfis.create(actor, { projectId: r.org_project_id, subject: r.subject, question: `${r.question}\n(Amends ${r.rfi_no}: ${reason})`, discipline: r.discipline, siteId: r.rfi_site_id, wbsId: r.wbs_id, locationId: r.location_id, activityRef: r.activity_ref, activityCritical: Boolean(r.activity_critical), holdActivity: Boolean(r.hold_activity), boqItemId: r.boq_item_id, drawingId: r.drawing_id, drawingRevisionId: r.drawing_revision_id, specRef: r.spec_ref, proposedSolution: r.proposed_solution, priority: r.priority, requiredBy: r.required_by < today() ? addDays(today(), RFI_SLA_DAYS[r.priority] + 3) : r.required_by, costImpactFlag: Boolean(r.cost_impact_flag), timeImpactFlag: Boolean(r.time_impact_flag), consultant: r.consultant });
        audit(actor, 'engg_rfis', r.id, 'amend', r.company_id, { reason, newValues: { newRfiNo: n.rfiNo } }); return n;
      });
    },
    /** FR-03: the answer of the consultant, recorded by the design coordinator (until the consultant portal, 25.04). */
    respond(actor, id, b) {
      const r = row(actor, id, 'engg.rfi.respond'); if (r.status !== 'ISSUED') throw unprocessable('An answer is recorded on an RFI that is with the consultant.');
      const p = []; let revision = null;
      if (b.drawingRevisionId) { revision = db.prepare('SELECT r.*, d.org_project_id AS dproject FROM engg_drawing_revisions r JOIN engg_drawings d ON d.id = r.drawing_id WHERE r.id = ? AND r.deleted_at IS NULL').get(b.drawingRevisionId); if (!revision || revision.dproject !== r.org_project_id) p.push({ field: 'drawingRevisionId', message: 'Choose a revision of a drawing of this project' }); else if (!['ISSUED', 'SUBMITTED', 'DRAFT'].includes(revision.rev_status)) p.push({ field: 'drawingRevisionId', message: 'Choose a revision that is current or in preparation' }); }
      if (b.responseType === 'DESIGN_CHANGE' && !b.drawingRevisionId && !b.instructionRef) p.push({ field: 'drawingRevisionId', message: 'A design change names the drawing revision that carries it, or the instruction (BR-01)' });
      if (b.responseType === 'INSTRUCTION' && !b.instructionRef) p.push({ field: 'instructionRef', message: 'An instruction names its reference' });
      fail(p);
      const cost = toPaise(b.costImpact);
      return transaction(db, () => {
        db.prepare("UPDATE engg_rfis SET status = 'RESPONDED', response_type = ?, response_text = ?, responded_on = ?, responded_by = ?, response_revision_id = ?, instruction_ref = ?, cost_impact = ?, time_impact_days = ?, variation_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(b.responseType, b.text, today(), actor.user, b.drawingRevisionId, b.instructionRef, cost, b.timeImpactDays, b.variationRef, actor.user, nowIso(), r.id);
        let delayId = null;
        if (b.timeImpactDays > 0) { // BR-02
          db.prepare("UPDATE engg_rfi_delay_drafts SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE rfi_id = ? AND deleted_at IS NULL").run(nowIso(), actor.user, r.id);
          delayId = Number(db.prepare("INSERT INTO engg_rfi_delay_drafts (company_id, rfi_id, org_project_id, delay_days, activity_ref, reason, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'engg_rfis', ?)").run(r.company_id, r.id, r.org_project_id, b.timeImpactDays, r.activity_ref, `${r.rfi_no}: ${r.subject}`, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
        }
        const n = fresh(r.id); setBall(n, 'VERIFIER', 'RESPONDED', actor.user, RESPONSE_TYPES[b.responseType]); audit(actor, 'engg_rfis', r.id, 'respond', r.company_id, { newValues: { responseType: b.responseType, costImpact: b.costImpact, timeImpactDays: b.timeImpactDays } });
        const link = `/engg/rfi?id=${r.id}`;
        if (r.requested_by) { try { notificationsOf(db).notify({ companyId: r.company_id, templateCode: 'engg.rfi.responded', recipients: [`user:${r.requested_by}`], data: { rfi: r.rfi_no, subject: r.subject, detail: `Answered (${RESPONSE_TYPES[b.responseType]}). Verify the answer and close the RFI.`, link }, link, sourceType: 'engg_rfi', sourceId: r.id }); } catch { /* the answer stays recorded */ } }
        event('engg.rfi.responded', actor, 'engg_rfi', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, rfiId: r.id, rfiNo: r.rfi_no, responseType: b.responseType, drawingId: revision?.drawing_id ?? r.drawing_id, drawingRevisionId: b.drawingRevisionId, instructionRef: b.instructionRef, costImpact: rupees(cost), timeImpactDays: b.timeImpactDays, variationRef: b.variationRef, activityRef: r.activity_ref, hold: Boolean(r.hold_activity), delayDraftId: delayId });
        return rfis.get(actor, r.id);
      });
    },
    /** The answer is not enough: it goes back to the consultant. */
    rework(actor, id, { reason }) {
      const r = row(actor, id, 'engg.rfi.approve'); if (r.status !== 'RESPONDED') throw unprocessable('Only an answer waiting to be verified is sent back.');
      return transaction(db, () => {
        db.prepare("UPDATE engg_rfis SET status = 'ISSUED', response_type = NULL, response_text = NULL, responded_on = NULL, responded_by = NULL, response_revision_id = NULL, instruction_ref = NULL, cost_impact = 0, time_impact_days = 0, variation_ref = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id);
        db.prepare("UPDATE engg_rfi_delay_drafts SET draft_status = 'DISCARDED' WHERE rfi_id = ? AND draft_status = 'DRAFT'").run(r.id);
        setBall(fresh(r.id), 'CONSULTANT', 'ANSWER_REJECTED', actor.user, reason); audit(actor, 'engg_rfis', r.id, 'rework', r.company_id, { reason }); return rfis.get(actor, r.id);
      });
    },
    /** BR-01: the raiser asks to close; the design coordinator and then the raiser's lead verify the answer before the RFI is closed. */
    requestClose(actor, id, { note }) {
      const r = row(actor, id, 'engg.rfi.submit'); if (r.status !== 'RESPONDED') throw unprocessable('Only an RFI with a recorded answer is closed.');
      if (r.response_type === 'DESIGN_CHANGE' && !r.response_revision_id && !r.instruction_ref) throw unprocessable('A design-change answer needs its drawing revision or instruction before the RFI closes (BR-01).');
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id }; const inst = workflowOf(db).submit(actor, { docType: RFI_CLOSE_DOC, docId: String(r.id), comment: `${r.rfi_no}: verify the answer and close${note ? ` (${note})` : ''}`.slice(0, 300), context: ctx });
        db.prepare("UPDATE engg_rfis SET status = 'CLOSE_REQUESTED', close_workflow_id = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(inst.id, actor.user, actor.user, nowIso(), r.id);
        setBall(fresh(r.id), 'VERIFIER', 'CLOSE_REQUESTED', actor.user, note); audit(actor, 'engg_rfis', r.id, 'request_close', r.company_id); return rfis.get(actor, r.id);
      });
    },
    history(actor, id) {
      const r = row(actor, id); const wf = [r.issue_workflow_id, r.close_workflow_id].filter(Boolean);
      return { approvals: wf.length ? db.prepare(`SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id IN (${wf.map(() => '?').join(',')}) ORDER BY id`).all(...wf) : [], routing: view(actor, r, { detail: true }).routing, audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'engg_rfis' AND entity_id = ? ORDER BY id").all(String(r.id)) };
    },
    print(actor, id) {
      const r = row(actor, id, 'engg.rfi.print'); const v = view(actor, r, { detail: true });
      const rows = v.routing.map((x) => `<tr><td>${esc(String(x.at).slice(0, 16).replace('T', ' '))}</td><td>${esc(x.event)}</td><td>${esc(x.to)}</td><td>${esc(x.by ?? '')}</td></tr>`).join('');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.rfiNo)}</title></head><body><h1>${esc(v.rfiNo)}: ${esc(v.subject)}</h1><p>${esc(v.projectCode)} · ${esc(v.disciplineLabel)} · ${esc(v.priorityLabel)} · required by ${esc(v.requiredBy)} · ${esc(v.statusLabel)}</p><h2>Question</h2><p>${esc(v.question)}</p><h2>Response</h2><p>${esc(v.responseTypeLabel ?? 'None yet')}: ${esc(v.responseText ?? '')}</p><p>Cost impact ₹ ${esc(v.costImpact)} · time impact ${v.timeImpactDays} days</p><h2>Routing</h2><table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>When</th><th>Event</th><th>Ball in court</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    },
    import(actor, b) {
      project(actor, b.projectId, 'engg.rfi.create', 'engg.rfi.view'); const made = []; const errors = [];
      b.rows.forEach((x, i) => { try { const v = rfis.create(actor, { projectId: b.projectId, ...x }); made.push({ row: i + 1, id: v.id, rfiNo: v.rfiNo }); } catch (e) { errors.push({ row: i + 1, subject: x.subject, message: e.details?.[0]?.message ?? e.message }); } });
      return { created: made.length, errors, rows: made };
    },
    escalate(actor) {
      need(actor, 'engg.rfi.approve', 'escalate RFIs');
      return escalateOverdue(actor, (r) => may(actor, 'engg.rfi.view', r.org_project_id));
    },
    /** FR-06: the activities that open RFIs hold, for the look-ahead constraints (13.04). */
    constraints(actor, q = {}) {
      need(actor, 'engg.rfi.view', 'see RFIs'); const s = scopeSql(actor, 'engg.rfi.view'); const params = { ...s.params }; let extra = ''; if (q.projectId) { extra = ' AND x.org_project_id = :pid'; params.pid = Number(q.projectId); }
      return db.prepare(`SELECT x.*, p.code AS pcode FROM engg_rfis x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.hold_activity = 1 AND x.status IN ${OPEN_SQL} AND ${s.sql}${extra} ORDER BY x.activity_critical DESC, x.required_by, x.id`).all(params)
        .map((r) => ({ rfiId: r.id, rfiNo: r.rfi_no, projectId: r.org_project_id, project: r.pcode, activityRef: r.activity_ref, locationId: r.location_id, wbsId: r.wbs_id, critical: Boolean(r.activity_critical), priority: r.priority, requiredBy: r.required_by, ballInCourt: r.ball_in_court, overdue: r.required_by < today(), subject: r.subject }));
    },
  };
  const dashboard = {
    get(actor, q = {}) {
      need(actor, 'engg.rfi.view', 'see the RFI dashboard'); const s = scopeSql(actor, 'engg.rfi.view'); const params = { ...s.params }; let extra = ''; if (q.projectId) { extra = ' AND x.org_project_id = :pid'; params.pid = Number(q.projectId); }
      const base0 = `FROM engg_rfis x WHERE x.deleted_at IS NULL AND ${s.sql}${extra}`; const one = (sql, p = params) => db.prepare(sql).get(p).n; const day = today();
      const ball = Object.fromEntries(Object.keys(BALL).filter((k) => k !== 'NONE').map((k) => [k, one(`SELECT COUNT(*) AS n ${base0} AND x.status IN ${OPEN_SQL} AND x.ball_in_court = '${k}'`)]));
      const open = db.prepare(`SELECT x.* ${base0} AND x.status IN ${OPEN_SQL}`).all(params);
      const ageing = { d0_7: 0, d8_14: 0, d15_30: 0, d30_plus: 0 }; for (const r of open) { const a = ageOf(r); if (a <= 7) ageing.d0_7 += 1; else if (a <= 14) ageing.d8_14 += 1; else if (a <= 30) ageing.d15_30 += 1; else ageing.d30_plus += 1; }
      const impact = db.prepare(`SELECT COALESCE(SUM(x.cost_impact), 0) AS cost, COALESCE(SUM(x.time_impact_days), 0) AS days, COUNT(*) AS n ${base0} AND x.status IN ('RESPONDED', 'CLOSE_REQUESTED', 'CLOSED') AND (x.cost_impact > 0 OR x.time_impact_days > 0)`).get(params);
      const mine = open.filter((r) => (r.ball_in_court === 'RAISER' && same(r.requested_by ?? r.created_by, actor.user)) || (r.ball_in_court === 'DESIGN' && may(actor, 'engg.rfi.approve', r.org_project_id)) || (r.ball_in_court === 'CONSULTANT' && may(actor, 'engg.rfi.respond', r.org_project_id)) || (r.ball_in_court === 'VERIFIER' && may(actor, 'engg.rfi.approve', r.org_project_id)))
        .concat(db.prepare(`SELECT x.* ${base0} AND x.status IN ('DRAFT', 'RETURNED') AND x.created_by = :me`).all({ ...params, me: actor.user })).slice(0, 20).map((r) => ({ id: r.id, rfiNo: r.rfi_no, subject: r.subject, status: r.status, ball: r.ball_in_court, requiredBy: r.required_by }));
      const out = {
        asOf: day, total: one(`SELECT COUNT(*) AS n ${base0}`), open: open.length, overdue: open.filter((r) => r.required_by < day).length, slaBreached: open.filter((r) => r.status === 'ISSUED' && r.issued_on && day > addDays(r.issued_on, RFI_SLA_DAYS[r.priority])).length,
        criticalOpen: open.filter((r) => r.activity_critical).length, holds: open.filter((r) => r.hold_activity).length, closed: one(`SELECT COUNT(*) AS n ${base0} AND x.status = 'CLOSED'`), ball, ageing, impact: { count: impact.n, cost: rupees(impact.cost), days: impact.days }, mine,
        critical: open.filter((r) => r.activity_critical).sort((a, b) => a.required_by.localeCompare(b.required_by)).slice(0, 10).map((r) => ({ id: r.id, rfiNo: r.rfi_no, subject: r.subject, activityRef: r.activity_ref, requiredBy: r.required_by, overdue: r.required_by < day })),
      };
      return { ...out, tiles: [['open', 'Open RFIs', out.open], ['overdue', 'Overdue', out.overdue], ['sla', 'Past SLA', out.slaBreached], ['critical', 'On critical path', out.criticalOpen], ['holds', 'Holding an activity', out.holds], ['closed', 'Closed', out.closed]].map(([key, label, value]) => ({ key, label, value })) };
    },
  };
  /** The decision of the issue approval or of the closure approval. */
  function rfiDecide(kind, instance, actor, outcome, comment) {
    const r = fresh(rid(instance.docId)); if (!r) return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    if (kind === 'ISSUE') {
      if (r.status !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE engg_rfis SET status = 'ISSUED', issued_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(today(), actor.user, nowIso(), r.id);
        setBall(fresh(r.id), 'CONSULTANT', 'ISSUED', actor.user, r.consultant); audit(actor, 'engg_rfis', r.id, 'issue', r.company_id);
        event('engg.rfi.issued', actor, 'engg_rfi', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, rfiId: r.id, rfiNo: r.rfi_no, priority: r.priority, requiredBy: r.required_by, drawingId: r.drawing_id, activityRef: r.activity_ref, hold: Boolean(r.hold_activity), consultant: r.consultant });
        return;
      }
      const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE engg_rfis SET status = ?, issue_workflow_id = ?, ball_in_court = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.issue_workflow_id, ['RETURNED', 'DRAFT'].includes(to) ? 'RAISER' : 'NONE', actor.user, nowIso(), r.id);
      route(fresh(r.id), outcome, ['RETURNED', 'DRAFT'].includes(to) ? 'RAISER' : 'NONE', actor.user, comment ?? null, 'DESIGN'); audit(actor, 'engg_rfis', r.id, outcome.toLowerCase(), r.company_id, { reason: comment ?? null });
      return;
    }
    if (r.status !== 'CLOSE_REQUESTED') return;
    if (outcome === 'APPROVED') {
      db.prepare("UPDATE engg_rfis SET status = 'CLOSED', ball_in_court = 'NONE', verified_by = ?, verified_on = ?, closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, today(), nowIso(), actor.user, nowIso(), r.id);
      route(fresh(r.id), 'CLOSED', 'NONE', actor.user, null, 'VERIFIER'); audit(actor, 'engg_rfis', r.id, 'close', r.company_id);
      event('engg.rfi.closed', actor, 'engg_rfi', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, rfiId: r.id, rfiNo: r.rfi_no, responseType: r.response_type, costImpact: rupees(r.cost_impact), timeImpactDays: r.time_impact_days, activityRef: r.activity_ref, verifiedBy: actor.user });
      return;
    }
    db.prepare("UPDATE engg_rfis SET status = 'RESPONDED', close_workflow_id = NULL, ball_in_court = 'VERIFIER', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id);
    route(fresh(r.id), `CLOSE_${outcome}`, 'VERIFIER', actor.user, comment ?? null, 'VERIFIER'); audit(actor, 'engg_rfis', r.id, `close_${outcome.toLowerCase()}`, r.company_id, { reason: comment ?? null });
  }
  return { rfis, rfiDashboard: dashboard, rfiDecide,
    sweepRfis: (companyId) => escalateOverdue({ companyId, user: 'scheduler' }, () => true) };
}


export function rfiConstraintsOf(db, companyId, projectId = null) {
  const params = [companyId]; let extra = ''; if (projectId) { extra = ' AND x.org_project_id = ?'; params.push(projectId); }
  return db.prepare(`SELECT x.*, p.code AS pcode FROM engg_rfis x JOIN org_projects p ON p.id = x.org_project_id WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.hold_activity = 1 AND x.status IN ${OPEN_SQL}${extra} ORDER BY x.activity_critical DESC, x.required_by, x.id`).all(...params)
    .map((r) => ({ rfiId: r.id, rfiNo: r.rfi_no, projectId: r.org_project_id, project: r.pcode, activityRef: r.activity_ref, locationId: r.location_id, wbsId: r.wbs_id, critical: Boolean(r.activity_critical), priority: r.priority, requiredBy: r.required_by, ballInCourt: r.ball_in_court, subject: r.subject }));
}

/** Every open RFI (held activity or not) with the drawing, activity, WBS node and location it concerns: the constraints the look-ahead (13.04) detects by itself and clears when the RFI is closed. */
export function openRfisOf(db, companyId, projectId) {
  return db.prepare(`SELECT x.id, x.rfi_no, x.subject, x.activity_ref, x.wbs_id, x.location_id, x.drawing_id, x.required_by, x.status, d.drawing_no FROM engg_rfis x LEFT JOIN engg_drawings d ON d.id = x.drawing_id WHERE x.company_id = ? AND x.org_project_id = ? AND x.deleted_at IS NULL AND x.status IN ${OPEN_SQL}`).all(companyId, projectId)
    .map((r) => ({ rfiId: r.id, rfiNo: r.rfi_no, subject: r.subject, activityRef: r.activity_ref, wbsId: r.wbs_id, locationId: r.location_id, drawingId: r.drawing_id, drawingNo: r.drawing_no, requiredBy: r.required_by, status: r.status }));
}

// ---- workflow, resolvers, evidence and the files ----------------------------------------------------------------------------------------------------
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 24, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const rline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM engg_rfis x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
const userRoles = (u) => { try { return JSON.parse(u.roles_json ?? '[]'); } catch { return []; } };
/** The raiser's lead verifies the answer: the manager of the project, a construction manager, never the raiser. */
if (!workflowResolvers.get('engg.rfiLead')) workflowResolvers.register('engg.rfiLead', ({ db, companyId, instance }) => {
  const r = db.prepare('SELECT org_project_id, created_by FROM engg_rfis WHERE id = ?').get(rid(instance.docId)); const me = String(instance.submittedBy ?? r?.created_by ?? '').toLowerCase();
  const x = r ? db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(r.org_project_id) : null;
  if (x?.pm_user && x.pm_user.toLowerCase() !== me && String(r.created_by ?? '').toLowerCase() !== x.pm_user.toLowerCase()) return [{ user: x.pm_user }];
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => (userRoles(u).includes('CM') || userRoles(u).includes('PM')) && u.username.toLowerCase() !== me && u.username.toLowerCase() !== String(r?.created_by ?? '').toLowerCase()).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'PD' }];
});
const hooks = (kind) => ({
  onApproved: (db, { instance, actor }) => enggOf(db)?.rfiDecide(kind, instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => enggOf(db)?.rfiDecide(kind, instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => enggOf(db)?.rfiDecide(kind, instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => enggOf(db)?.rfiDecide(kind, instance, actor, 'CANCELLED', comment),
});
const describe = (db, companyId, id) => { const r = rline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.rfi_no, title: `${r.code} ${r.subject}`, originator: r.requested_by } : null; };
const summarise = (db, _actor, id) => {
  const r = rline(db, rid(id)); if (!r) return null;
  return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'RFI', value: `${r.rfi_no} · ${r.subject}` }, { label: 'Priority', value: RFI_PRIORITY[r.priority] }, { label: 'Required by', value: r.required_by }, { label: 'Question', value: r.question }, { label: 'Answer', value: r.response_text ? `${RESPONSE_TYPES[r.response_type]}: ${r.response_text}` : 'Not yet answered' }, { label: 'Cost impact (₹)', value: rupees(r.cost_impact) }, { label: 'Time impact (days)', value: String(r.time_impact_days) }], lines: [] };
};
workflowTypes.register({
  docType: RFI_ISSUE_DOC, label: 'Issue of an RFI to the consultant', processOwner: 'DESIGN', route: (id) => `/engg/rfi?id=${id}`, describe, summarise,
  defaultDefinition: { name: 'RFI issue: the design coordinator checks and issues', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DESIGN', 'Design coordinator', [{ kind: 'role', role: 'DESIGN' }])] },
  hooks: hooks('ISSUE'),
});
workflowTypes.register({
  docType: RFI_CLOSE_DOC, label: 'Closure of an RFI', processOwner: 'DESIGN', route: (id) => `/engg/rfi?id=${id}`, describe, summarise,
  defaultDefinition: { name: 'RFI closure: the design coordinator verifies, then the raiser\'s lead', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DESIGN', 'Design coordinator', [{ kind: 'role', role: 'DESIGN' }]), step('LEAD', 'Raiser\'s lead', [{ kind: 'resolver', resolver: 'engg.rfiLead' }])] },
  hooks: hooks('CLOSE'),
});
for (const doc of [RFI_ISSUE_DOC, RFI_CLOSE_DOC]) {
  evidenceProviders.register(doc, ({ db, instance }) => {
    const r = rline(db, rid(instance.docId)); if (!r) return { sections: [] };
    const d = r.drawing_id ? db.prepare('SELECT drawing_no FROM engg_drawings WHERE id = ?').get(r.drawing_id) : null;
    return { sections: [{ code: 'engg-rfi', title: 'The RFI', kind: 'metrics', items: [{ label: 'RFI', value: `${r.rfi_no} ${r.subject}`, format: 'text' }, { label: 'Priority', value: RFI_PRIORITY[r.priority], format: 'text' }, { label: 'Required by', value: r.required_by, format: 'text' }, { label: 'Drawing', value: d?.drawing_no ?? 'None linked', format: 'text' }, { label: 'On the critical path', value: r.activity_critical ? 'Yes' : 'No', format: 'text' }, { label: 'Holds the activity', value: r.hold_activity ? 'Yes' : 'No', format: 'text' }, { label: 'Answer', value: r.response_type ? RESPONSE_TYPES[r.response_type] : 'None yet', format: 'text' }, { label: 'Cost impact (₹)', value: rupees(r.cost_impact), format: 'text' }, { label: 'Time impact (days)', value: String(r.time_impact_days), format: 'text' }] }] };
  });
}
// the photos, markups and answers attached to an RFI go through the file service
fileEntities.register({
  entity: 'engg_rfi', label: 'RFI',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT * FROM engg_rfis WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); const svc = enggOf(db);
    if (!r || !svc || !svc.may(actor, 'engg.rfi.view', r.org_project_id)) return null;
    const editable = (['DRAFT', 'RETURNED'].includes(r.status) && svc.may(actor, 'engg.rfi.edit', r.org_project_id)) || (r.status === 'ISSUED' && svc.may(actor, 'engg.rfi.respond', r.org_project_id));
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.rfi_site_id ?? null, canView: true, canEdit: editable, locked: !editable };
  },
});
void badRequest;
