import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv, toPdf, toXlsx } from '../../platform/export/index.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { calculate, isoOf, ordOf } from './cpm.js';

// The delay register and time-impact records (part 13.05).
// - A delay (FR-01) is an event with its dates, cause, responsibility, the activities it touches, its mitigation and concurrency notes. Its classification (cause and responsibility) is approved by the
//   project manager and then the commercial manager; the planner who prepared it never decides it. Approved, it is locked; a change is a revision that replaces it when approved.
// - Drafts come by themselves (FR-02) from the RFIs answered with a time impact (11.02); hindrances and weather shutdowns (14.03) are not built yet.
// - A time-impact analysis (FR-03) puts a fragnet into a copy of the schedule as at the event date, works the copy out with the CPM pass of 13.01 and compares the completion dates; the schedule and the
//   baselines are never written (BR-01): the copy is in memory and only the result is kept, with the picture it was made from.
// - Evidence (FR-04) links the RFIs, letters, drawings and files the delay rests on; the summary (FR-05) totals the delays by cause and responsibility, excusable and compensable, for the EOT claims (21.06).
export const DELAY_DOC = 'PLAN_DELAY';
export const DELAY_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved (classification locked)', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded by a revision' };
export const CAUSES = { LATE_DRAWINGS: 'Late drawings or information', LATE_HANDOVER: 'Late site handover', CHANGE: 'Change or variation', WEATHER: 'Weather', FORCE_MAJEURE: 'Force majeure', CONTRACTOR_RESOURCES: 'Contractor resources', STATUTORY: 'Statutory approvals', OTHER: 'Other' };
export const RESPONSIBILITY = { EMPLOYER: 'Employer', CONTRACTOR: 'Contractor', NEUTRAL: 'Neutral' };
/** Excusable: time is due (employer or neutral risk); compensable: time and money are due (employer risk). */
export const classOf = (resp) => ({ excusable: resp === 'EMPLOYER' || resp === 'NEUTRAL', compensable: resp === 'EMPLOYER' });
export const EVIDENCE = { engg_rfi: 'RFI', engg_letter: 'Letter', engg_drawing: 'Drawing', core_file: 'File', plan_constraint: 'Constraint', plan_weekly_plan: 'Weekly plan' };
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const daysOf = (from, to) => ordOf(to) - ordOf(from) + 1;
const COLS = 'x.id, x.company_id, x.doc_no, x.doc_date, x.org_project_id, x.schedule_id, x.title, x.description, x.cause_category, x.responsibility, x.start_date, x.end_date, x.delay_days, x.affected_activities_json, x.mitigation, x.concurrency_note, x.impact_days, x.tia_id, x.revision_no, x.parent_delay_id, x.status, x.src_entity, x.src_id, x.workflow_instance_id, x.requested_by, x.approved_by, x.approved_at, x.reason, x.created_by, x.created_at, x.updated_at, x.version';

export const delayList = defineList({
  code: 'plan.delays', label: 'Delay register', permission: 'plan.delay.view',
  from: 'plan_delays x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'p.code', 'x.description'], defaultSort: '-startDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Delay no.' }, title: { sql: 'x.title', type: 'text', label: 'Event' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    cause: { sql: 'x.cause_category', type: 'enum', label: 'Cause', options: Object.entries(CAUSES) }, responsibility: { sql: 'x.responsibility', type: 'enum', label: 'Responsibility', options: Object.entries(RESPONSIBILITY) },
    startDate: { sql: 'x.start_date', type: 'date', label: 'From' }, endDate: { sql: 'x.end_date', type: 'date', label: 'To' }, delayDays: { sql: 'x.delay_days', type: 'number', label: 'Delay days' }, impactDays: { sql: 'x.impact_days', type: 'number', label: 'Impact on completion (days)' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(DELAY_STATUS) }, source: { sql: 'x.src_entity', type: 'text', label: 'Source' },
  },
});

export function createDelayService({ db, plan }) {
  const authz = authzOf(db);
  const may = (actor, key, pid) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed;
  const need = (actor, key, what, pid) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, users, ref, subject, detail, link, sourceId) => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId }); } catch { /* saved anyway */ } };
  const orgOf = (id) => db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ?').get(id);
  const numberFor = (companyId, user) => {
    try { return issueNumber(db, { companyId, docType: DELAY_DOC, actor: user, refType: 'plan_delays' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM plan_delays WHERE company_id = ?').get(companyId).n ?? 0) + 1; return `DL/${String(n).padStart(5, '0')}`;
  };
  const currentSchedule = (companyId, projectId) => db.prepare("SELECT * FROM plan_schedules WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'DRAFT', 'RETURNED', 'SUBMITTED') ORDER BY (status = 'APPROVED') DESC, id DESC").get(companyId, projectId);
  const project = (actor, projectId, key = 'plan.delay.view') => { const o = orgOf(Number(projectId)); if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.delay.view', o.id)) throw notFound('That project does not exist.'); if (key !== 'plan.delay.view') need(actor, key, 'do that for this project', o.id); return o; };
  const scheduleOf = (actor, projectId, id) => { const s = db.prepare('SELECT * FROM plan_schedules WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!s || s.org_project_id !== projectId) fail([{ field: 'scheduleId', message: 'Choose a schedule of the project' }]); return s; };

  // ---- the delay (FR-01) -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  function row(actor, id, key = 'plan.delay.view') {
    const r = db.prepare(`SELECT ${COLS} FROM plan_delays x WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL`).get(rid(id), actor.companyId);
    if (!r || !may(actor, 'plan.delay.view', r.org_project_id)) throw notFound('That delay does not exist.'); if (key !== 'plan.delay.view') need(actor, key, 'do that with a delay', r.org_project_id); return r;
  }
  const fresh = (id) => db.prepare(`SELECT ${COLS} FROM plan_delays x WHERE x.id = ?`).get(id);
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(r.status === 'APPROVED' ? `${r.doc_no} is approved: its classification is locked; a change is a revision.` : `${r.doc_no} is ${lower(DELAY_STATUS[r.status])}: it is not changed now.`); };
  const evidenceOf = (id) => db.prepare('SELECT * FROM plan_delay_evidence WHERE delay_id = ? AND deleted_at IS NULL ORDER BY id').all(id).map((e) => ({ id: e.id, entity: e.entity, entityLabel: EVIDENCE[e.entity], entityId: e.entity_id, label: e.label, note: e.note, link: linkOf(e.entity, e.entity_id), by: e.created_by, at: e.created_at }));
  const linkOf = (entity, id) => ({ engg_rfi: `/engg/rfi?id=${id}`, engg_letter: `/engg/letters?id=${id}`, engg_drawing: `/engg/drawings?id=${id}`, core_file: null, plan_constraint: `/plan/constraints?id=${id}`, plan_weekly_plan: `/plan/weekly?id=${id}` })[entity] ?? null;
  const tiaView = (t) => ({ id: t.id, delayId: t.delay_id, scheduleId: t.schedule_id, scheduleRef: t.schedule_copy_ref, dataDate: t.data_date, fragnet: json(t.fragnet_json, {}), completionBefore: t.completion_before, completionAfter: t.completion_after, impactDays: t.impact_days, impactWorkingDays: t.impact_working_days, result: json(t.result_json, {}), analysedBy: t.analysed_by, analysedAt: t.analysed_at, note: t.note });
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const s = r.schedule_id ? db.prepare('SELECT doc_no, version_no, status FROM plan_schedules WHERE id = ?').get(r.schedule_id) : null; const can = (k) => may(actor, k, r.org_project_id); const c = classOf(r.responsibility);
    const v = {
      id: r.id, docNo: r.doc_no, docDate: r.doc_date, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, scheduleId: r.schedule_id, scheduleDocNo: s?.doc_no ?? null, title: r.title, description: r.description,
      cause: r.cause_category, causeLabel: CAUSES[r.cause_category], responsibility: r.responsibility, responsibilityLabel: RESPONSIBILITY[r.responsibility], excusable: c.excusable, compensable: c.compensable,
      startDate: r.start_date, endDate: r.end_date, delayDays: r.delay_days, impactDays: r.impact_days, tiaId: r.tia_id, affected: json(r.affected_activities_json, []), mitigation: r.mitigation, concurrency: r.concurrency_note,
      revisionNo: r.revision_no, parentDelayId: r.parent_delay_id, status: r.status, statusLabel: DELAY_STATUS[r.status], source: r.src_entity ? { entity: r.src_entity, id: r.src_id, label: EVIDENCE[r.src_entity] ?? r.src_entity, link: linkOf(r.src_entity, r.src_id) } : null,
      requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, reason: r.reason, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('plan.delay.edit') && editable(r), analyse: can('plan.delay.analyse') && editable(r), submit: can('plan.delay.submit') && editable(r), withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('plan.delay.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('plan.delay.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('plan.delay.amend') && r.status === 'APPROVED' && !db.prepare("SELECT 1 FROM plan_delays WHERE parent_delay_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id), evidence: can('plan.delay.edit') && !['CANCELLED', 'SUPERSEDED', 'REJECTED'].includes(r.status), print: can('plan.delay.print'), export: can('plan.delay.export') },
    };
    if (detail) { v.evidence = evidenceOf(r.id); v.tias = db.prepare('SELECT * FROM plan_tia WHERE delay_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(r.id).map(tiaView); const p = r.parent_delay_id ? fresh(r.parent_delay_id) : null; v.previous = p ? { id: p.id, docNo: p.doc_no, cause: p.cause_category, responsibility: p.responsibility, startDate: p.start_date, endDate: p.end_date, delayDays: p.delay_days, impactDays: p.impact_days } : null; }
    return v;
  }
  const scope = (actor) => { const f = authz.scopeFilter(actor, 'plan.delay.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  /** A row of the register: what the list shows, without the actions of the record (worked out when it is opened). */
  const listRow = (_actor, x) => ({ id: x.id, docNo: x.doc_no, title: x.title, project: x.pcode ?? orgOf(x.org_project_id)?.code, projectId: x.org_project_id, cause: x.cause_category, causeLabel: CAUSES[x.cause_category], responsibility: x.responsibility, responsibilityLabel: RESPONSIBILITY[x.responsibility], startDate: x.start_date, endDate: x.end_date, delayDays: x.delay_days, impactDays: x.impact_days, status: x.status, statusLabel: DELAY_STATUS[x.status], source: x.src_entity ? EVIDENCE[x.src_entity] ?? x.src_entity : null });
  /** The activities a delay touches: of the schedule given, by id; kept with code and name so the record reads the same when the schedule moves on. */
  const affectedOf = (s, ids) => { const p = []; const out = []; ids.forEach((aid, i) => { const a = db.prepare('SELECT id, code, name FROM plan_activities WHERE id = ? AND schedule_id = ? AND deleted_at IS NULL').get(aid, s.id); if (!a) p.push({ field: `activityIds.${i}`, message: 'Choose an activity of the schedule' }); else out.push({ activityId: a.id, code: a.code, name: a.name }); }); fail(p); return out; };
  const check = (b) => { const p = []; if (b.endDate < b.startDate) p.push({ field: 'endDate', message: 'The end is on or after the start' }); fail(p); };

  const delays = {
    list(actor, query) { if (!authz.check(actor, 'plan.delay.view').allowed) throw forbidden('You may not see delays (permission plan.delay.view).'); const sc = scope(actor); return runList(db, delayList, parseListRequest(delayList, query), { select: `${COLS}, p.code AS pcode`, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => listRow(actor, x) }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'plan.delay.export').allowed) throw forbidden('You may not export delays (permission plan.delay.export).'); const sc = scope(actor); const opts = { select: `${COLS}, p.code AS pcode`, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: delayList.label, permission: 'plan.delay.export', personal: false, columns: ['docNo', 'project', 'title', 'cause', 'responsibility', 'startDate', 'endDate', 'delayDays', 'impactDays', 'status'].map((k) => ({ key: k, label: delayList.columns[k]?.label ?? k, type: 'text' })),
        rows: () => runList(db, delayList, req, { ...opts, limit: null, map: (x) => { const v = listRow(actor, x); return { docNo: v.docNo, project: v.project, title: v.title, cause: v.causeLabel, responsibility: v.responsibilityLabel, startDate: v.startDate, endDate: v.endDate, delayDays: String(v.delayDays), impactDays: v.impactDays == null ? '' : String(v.impactDays), status: v.statusLabel }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All delays you may see'], count: () => countList(db, delayList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    /** What the forms offer for a project: the schedule in use and its activities, the causes and the kinds of evidence. */
    options(actor, projectId) {
      const o = project(actor, projectId); const s = currentSchedule(actor.companyId, o.id);
      return { projectId: o.id, projectCode: o.code, schedule: s ? { id: s.id, docNo: s.doc_no, versionNo: s.version_no, status: s.status, start: s.start_date, finish: s.finish_date, dataDate: s.data_date } : null,
        activities: s ? db.prepare("SELECT id, code, name, es, ef, is_critical FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL AND act_type IN ('TASK', 'MILESTONE') ORDER BY sort_order, id").all(s.id).map((a) => ({ id: a.id, code: a.code, name: a.name, es: a.es, ef: a.ef, critical: Boolean(a.is_critical) })) : [],
        causes: Object.entries(CAUSES).map(([code, label]) => ({ code, label })), responsibilities: Object.entries(RESPONSIBILITY).map(([code, label]) => ({ code, label })), evidence: Object.entries(EVIDENCE).map(([code, label]) => ({ code, label })) };
    },
    create(actor, b) {
      const o = project(actor, b.projectId, 'plan.delay.create'); check(b); const s = b.scheduleId ? scheduleOf(actor, o.id, b.scheduleId) : currentSchedule(actor.companyId, o.id); const affected = s ? affectedOf(s, b.activityIds ?? []) : [];
      if ((b.activityIds ?? []).length && !s) fail([{ field: 'activityIds', message: 'The project has no schedule' }]);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO plan_delays (company_id, doc_no, doc_date, org_project_id, schedule_id, title, description, cause_category, responsibility, start_date, end_date, delay_days, affected_activities_json, mitigation, concurrency_note, revision_no, status, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'DRAFT', ?, ?, ?, 'api')")
          .run(actor.companyId, numberFor(actor.companyId, actor.user), todayIST(), o.id, s?.id ?? null, b.title, b.description ?? null, b.cause, b.responsibility, b.startDate, b.endDate, daysOf(b.startDate, b.endDate), JSON.stringify(affected), b.mitigation ?? null, b.concurrency ?? null, actor.user, o.id, actor.user).lastInsertRowid);
        audit(actor, 'plan_delays', id, 'create', actor.companyId, { newValues: { title: b.title, cause: b.cause, responsibility: b.responsibility, from: b.startDate, to: b.endDate } }); return delays.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'plan.delay.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this delay; reload it.');
      const start = b.startDate ?? r.start_date; const end = b.endDate ?? r.end_date; check({ startDate: start, endDate: end });
      const s = 'scheduleId' in b && b.scheduleId ? scheduleOf(actor, r.org_project_id, b.scheduleId) : (r.schedule_id ? db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(r.schedule_id) : currentSchedule(actor.companyId, r.org_project_id));
      const affected = 'activityIds' in b ? (s ? affectedOf(s, b.activityIds) : []) : null;
      const sets = []; const vals = []; for (const [k, c] of [['title', 'title'], ['description', 'description'], ['cause', 'cause_category'], ['responsibility', 'responsibility'], ['startDate', 'start_date'], ['endDate', 'end_date'], ['mitigation', 'mitigation'], ['concurrency', 'concurrency_note']]) if (k in b) { sets.push(`${c} = ?`); vals.push(b[k]); }
      sets.push('delay_days = ?'); vals.push(daysOf(start, end)); if (affected) { sets.push('affected_activities_json = ?', 'schedule_id = ?'); vals.push(JSON.stringify(affected), s?.id ?? null); }
      db.prepare(`UPDATE plan_delays SET ${[...sets, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
      const changed = { ...b }; delete changed.rowVersion; audit(actor, 'plan_delays', r.id, 'update', r.company_id, { oldValues: { cause: r.cause_category, responsibility: r.responsibility, from: r.start_date, to: r.end_date }, newValues: changed }); return delays.get(actor, r.id);
    },
    remove(actor, id) { const r = row(actor, id, 'plan.delay.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { const now = nowIso(); db.prepare('UPDATE plan_delay_evidence SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE delay_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE plan_delays SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'plan_delays', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = row(actor, id, 'plan.delay.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned delay is sent for approval.');
      const p = []; if (!json(r.affected_activities_json, []).length) p.push({ field: 'activityIds', message: 'Name the activities the delay touches' }); if (!db.prepare('SELECT 1 FROM plan_delay_evidence WHERE delay_id = ? AND deleted_at IS NULL').get(r.id)) p.push({ field: 'evidence', message: 'Link the evidence the delay rests on (an RFI, a letter, a drawing or a file)' }); fail(p);
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, responsibility: r.responsibility, cause: r.cause_category, delayDays: r.delay_days, impactDays: r.impact_days };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: DELAY_DOC, docId: String(r.id), comment: `${r.doc_no} ${r.title}`.slice(0, 300), context: ctx }); db.prepare('UPDATE plan_delays SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE plan_delays SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'plan_delays', r.id, 'submit', r.company_id, { newValues: ctx }); return delays.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a delay waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return delays.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'plan.delay.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a delay that is not decided is cancelled; an approved one is changed by a revision.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE plan_delays SET status = 'CANCELLED', reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'plan_delays', r.id, 'cancel', r.company_id, { reason }); return delays.get(actor, r.id); });
    },
    /** An approved delay is changed by a revision: a draft copy of it (with its evidence) that replaces it when approved; the time-impact analysis is made again on the revision. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'plan.delay.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved delay is revised.'); if (db.prepare("SELECT 1 FROM plan_delays WHERE parent_delay_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('A revision of this delay is open.');
      return transaction(db, () => {
        const nid = Number(db.prepare("INSERT INTO plan_delays (company_id, doc_no, doc_date, org_project_id, schedule_id, title, description, cause_category, responsibility, start_date, end_date, delay_days, affected_activities_json, mitigation, concurrency_note, revision_no, parent_delay_id, status, reason, src_entity, src_id, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 'plan_delay', ?)")
          .run(r.company_id, numberFor(r.company_id, actor.user), todayIST(), r.org_project_id, r.schedule_id, r.title, r.description, r.cause_category, r.responsibility, r.start_date, r.end_date, r.delay_days, r.affected_activities_json, r.mitigation, r.concurrency_note, r.revision_no + 1, r.id, reason, r.src_entity, r.src_id, actor.user, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
        for (const e of db.prepare('SELECT * FROM plan_delay_evidence WHERE delay_id = ? AND deleted_at IS NULL').all(r.id)) db.prepare("INSERT INTO plan_delay_evidence (company_id, delay_id, entity, entity_id, label, note, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plan_delay')").run(e.company_id, nid, e.entity, e.entity_id, e.label, e.note, e.project_id, actor.user);
        audit(actor, 'plan_delays', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return delays.get(actor, nid);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'plan_delays' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'plan.delay.print'); const v = view(actor, r, { detail: true }); const t = v.tias.find((x) => x.id === v.tiaId); const tr = (c, h = false) => `<tr>${c.map((x) => `<${h ? 'th' : 'td'}>${esc(x)}</${h ? 'th' : 'td'}>`).join('')}</tr>`; audit(actor, 'plan_delays', r.id, 'print', r.company_id);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED CLASSIFICATION</strong></p>`}<h1>Delay ${esc(v.docNo)} · ${esc(v.projectCode)} ${esc(v.projectName)}</h1>`
        + `<p><strong>${esc(v.title)}</strong>${v.revisionNo > 1 ? ` · revision ${v.revisionNo}` : ''}</p>${v.description ? `<p>${esc(v.description)}</p>` : ''}`
        + `<p>Cause: ${esc(v.causeLabel)} · Responsibility: ${esc(v.responsibilityLabel)} (${v.compensable ? 'excusable and compensable' : v.excusable ? 'excusable, not compensable' : 'not excusable'}) · ${esc(v.startDate)} to ${esc(v.endDate)}: ${v.delayDays} days${v.impactDays != null ? ` · impact on completion ${v.impactDays} days` : ''}</p>`
        + `<p>Activities: ${esc(v.affected.map((a) => `${a.code} ${a.name}`).join('; ') || '—')}</p>${v.mitigation ? `<p>Mitigation: ${esc(v.mitigation)}</p>` : ''}${v.concurrency ? `<p>Concurrency: ${esc(v.concurrency)}</p>` : ''}`
        + (t ? `<h2>Time impact analysis</h2><p>On ${esc(t.scheduleRef)} as at ${esc(t.dataDate)}: completion ${esc(t.completionBefore)} → ${esc(t.completionAfter)} (${t.impactDays} days, ${t.impactWorkingDays} working days).</p><table border="1" cellpadding="3">${tr(['Fragnet activity', 'Duration', 'After', 'Before'], true)}${(t.fragnet.activities ?? []).map((a) => tr([`${a.code} ${a.name}`, a.duration, (t.fragnet.links ?? []).filter((l) => l.succ === a.code).map((l) => l.pred).join(', '), (t.fragnet.links ?? []).filter((l) => l.pred === a.code).map((l) => l.succ).join(', ')])).join('')}</table>` : '')
        + `<h2>Evidence</h2><table border="1" cellpadding="3">${tr(['Kind', 'Reference', 'Note'], true)}${v.evidence.map((e) => tr([e.entityLabel, e.label, e.note ?? ''])).join('')}</table>`
        + `<p>${v.approvedAt ? `Approved by ${esc(v.approvedBy)} on ${esc(v.approvedAt.slice(0, 10))}` : `Prepared by ${esc(v.requestedBy ?? '')}`}</p></body></html>`;
    },
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        transaction(db, () => {
          if (r.parent_delay_id) db.prepare("UPDATE plan_delays SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_delay_id);
          db.prepare("UPDATE plan_delays SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); audit(actor, 'plan_delays', r.id, 'approve', r.company_id);
          const c = classOf(r.responsibility);
          publishEvent(db, { type: 'plan.delay.approved', entity: 'plan_delay', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, data: { delayId: r.id, projectId: r.org_project_id, docNo: r.doc_no, revisionNo: r.revision_no, supersedes: r.parent_delay_id ?? null, title: r.title, cause: r.cause_category, responsibility: r.responsibility, excusable: c.excusable, compensable: c.compensable, startDate: r.start_date, endDate: r.end_date, delayDays: r.delay_days, impactDays: r.impact_days, tiaId: r.tia_id, activities: json(r.affected_activities_json, []).map((a) => a.code) } });
          notify(r.company_id, 'plan.delay.approved', [r.requested_by], r.doc_no, r.title, `Delay ${r.doc_no} is approved as ${RESPONSIBILITY[r.responsibility].toLowerCase()} (${CAUSES[r.cause_category].toLowerCase()}).`, `/plan/delays?id=${r.id}`, r.id);
        });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE plan_delays SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'plan_delays', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'plan.delay.rejected', [r.requested_by], r.doc_no, r.title, `Delay ${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/plan/delays?id=${r.id}`, r.id);
    },
  };

  // ---- FR-04: evidence -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The record an evidence link points to, of the same company and project, with the label it is shown by. */
  function evidenceTarget(r, entity, id) {
    const q = (sql) => db.prepare(sql).get(id, r.company_id);
    const t = entity === 'engg_rfi' ? q('SELECT org_project_id AS pid, rfi_no || \': \' || subject AS label FROM engg_rfis WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
      : entity === 'engg_letter' ? q("SELECT org_project_id AS pid, COALESCE(letter_no, 'Letter ' || id) || ': ' || subject AS label FROM engg_letters WHERE id = ? AND company_id = ? AND deleted_at IS NULL")
        : entity === 'engg_drawing' ? q("SELECT org_project_id AS pid, drawing_no || ': ' || title AS label FROM engg_drawings WHERE id = ? AND company_id = ? AND deleted_at IS NULL")
          : entity === 'core_file' ? (() => { const f = q("SELECT project_id AS pid, original_name AS label, linked_entity, linked_id, scan_status FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL"); return f && f.linked_entity === 'plan_delay' && Number(f.linked_id) === r.id && f.scan_status !== 'INFECTED' ? { pid: r.org_project_id, label: f.label } : null; })()
            : entity === 'plan_constraint' ? q("SELECT org_project_id AS pid, ctype || ': ' || description AS label FROM plan_constraints WHERE id = ? AND company_id = ? AND deleted_at IS NULL")
              : entity === 'plan_weekly_plan' ? q("SELECT org_project_id AS pid, doc_no || ' week of ' || week_start AS label FROM plan_weekly_plans WHERE id = ? AND company_id = ? AND deleted_at IS NULL") : null;
    return t && t.pid === r.org_project_id ? t : null;
  }
  const evidence = {
    add(actor, id, b) {
      const r = row(actor, id, 'plan.delay.edit'); if (['CANCELLED', 'SUPERSEDED', 'REJECTED'].includes(r.status)) throw conflict(`${r.doc_no} is ${lower(DELAY_STATUS[r.status])}.`);
      const t = evidenceTarget(r, b.entity, b.entityId); if (!t) fail([{ field: 'entityId', message: b.entity === 'core_file' ? 'Choose a file attached to this delay' : `Choose ${lower(EVIDENCE[b.entity])} of the same project` }]);
      if (db.prepare('SELECT 1 FROM plan_delay_evidence WHERE delay_id = ? AND entity = ? AND entity_id = ? AND deleted_at IS NULL').get(r.id, b.entity, String(b.entityId))) throw conflict('This evidence is linked already.');
      const eid = Number(db.prepare("INSERT INTO plan_delay_evidence (company_id, delay_id, entity, entity_id, label, note, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, b.entity, String(b.entityId), String(t.label).slice(0, 300), b.note ?? null, r.org_project_id, actor.user).lastInsertRowid);
      audit(actor, 'plan_delays', r.id, 'evidence_add', r.company_id, { newValues: { entity: b.entity, id: b.entityId, label: t.label } }); return { id: eid, rows: evidenceOf(r.id) };
    },
    remove(actor, id, evidenceId) {
      const r = row(actor, id, 'plan.delay.edit'); mustEdit(r); const e = db.prepare('SELECT * FROM plan_delay_evidence WHERE id = ? AND delay_id = ? AND deleted_at IS NULL').get(rid(evidenceId), r.id); if (!e) throw notFound('That evidence is not linked to this delay.');
      db.prepare('UPDATE plan_delay_evidence SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, e.id); audit(actor, 'plan_delays', r.id, 'evidence_remove', r.company_id, { oldValues: { entity: e.entity, id: e.entity_id } }); return { rows: evidenceOf(r.id) };
    },
    /** What can be linked: the RFIs, letters and drawings of the project and the files attached to the delay, matching a search. */
    candidates(actor, id, { entity, q }) {
      const r = row(actor, id); const like = `%${q ?? ''}%`; const pid = r.org_project_id;
      const rows = entity === 'engg_rfi' ? db.prepare('SELECT id, rfi_no || \': \' || subject AS label FROM engg_rfis WHERE org_project_id = ? AND deleted_at IS NULL AND (rfi_no LIKE ? OR subject LIKE ?) ORDER BY id DESC LIMIT 50').all(pid, like, like)
        : entity === 'engg_letter' ? db.prepare("SELECT id, COALESCE(letter_no, 'Letter ' || id) || ': ' || subject AS label FROM engg_letters WHERE org_project_id = ? AND deleted_at IS NULL AND (COALESCE(letter_no, '') LIKE ? OR subject LIKE ?) ORDER BY id DESC LIMIT 50").all(pid, like, like)
          : entity === 'engg_drawing' ? db.prepare("SELECT id, drawing_no || ': ' || title AS label FROM engg_drawings WHERE org_project_id = ? AND deleted_at IS NULL AND (drawing_no LIKE ? OR title LIKE ?) ORDER BY drawing_no LIMIT 50").all(pid, like, like)
            : entity === 'core_file' ? db.prepare("SELECT id, original_name AS label FROM core_files WHERE company_id = ? AND linked_entity = 'plan_delay' AND linked_id = ? AND deleted_at IS NULL AND scan_status <> 'INFECTED' AND original_name LIKE ? ORDER BY id DESC LIMIT 50").all(r.company_id, r.id, like)
              : entity === 'plan_constraint' ? db.prepare("SELECT id, ctype || ': ' || description AS label FROM plan_constraints WHERE org_project_id = ? AND deleted_at IS NULL AND description LIKE ? ORDER BY id DESC LIMIT 50").all(pid, like)
                : db.prepare("SELECT id, doc_no || ' week of ' || week_start AS label FROM plan_weekly_plans WHERE org_project_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY week_start DESC LIMIT 50").all(pid, like);
      return { entity, rows };
    },
  };

  // ---- FR-03, BR-01: the time-impact analysis --------------------------------------------------------------------------------------------------------------------------------------------
  /**
   * The schedule as at the event date, worked out in memory twice: as it stands, and with the fragnet. Progress after the event date is taken out (an activity started later is not started, one
   * finished later is in progress with its remaining duration) so the copy is the schedule as it stood on that day. Nothing is written.
   */
  function analyse(r, s, dataDate, fragnet) {
    const cal = plan.calendarOf(db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(s.calendar_id)); const acts = db.prepare('SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id);
    const cals = new Map(); for (const a of acts) if (a.calendar_id && a.calendar_id !== s.calendar_id && !cals.has(a.calendar_id)) cals.set(a.calendar_id, plan.calendarOf(db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(a.calendar_id)));
    const byCode = new Map(acts.map((a) => [lower(a.code), a])); const p = [];
    const fa = fragnet.activities.map((x, i) => { if (byCode.has(lower(x.code))) p.push({ field: `fragnet.activities.${i}.code`, message: `${x.code} is an activity of the schedule: give the fragnet its own codes` }); return { ...x, id: -(i + 1) }; });
    const fcodes = new Map(fa.map((a) => [lower(a.code), a])); if (fcodes.size !== fa.length) p.push({ field: 'fragnet.activities', message: 'A code is given twice in the fragnet' });
    const idOf = (code) => fcodes.get(lower(code))?.id ?? byCode.get(lower(code))?.id ?? null;
    const fl = fragnet.links.map((l, i) => { const pred = idOf(l.pred); const succ = idOf(l.succ); if (!pred) p.push({ field: `fragnet.links.${i}.pred`, message: `${l.pred} is neither in the fragnet nor in the schedule` }); if (!succ) p.push({ field: `fragnet.links.${i}.succ`, message: `${l.succ} is neither in the fragnet nor in the schedule` }); if (pred && succ && pred > 0 && succ > 0) p.push({ field: `fragnet.links.${i}`, message: 'A link of the fragnet joins at least one fragnet activity' }); return { pred, succ, type: l.type, lag: l.lag }; });
    for (const a of fa) if (!fl.some((l) => l.pred === a.id || l.succ === a.id)) p.push({ field: 'fragnet.links', message: `${a.code} is not linked: a fragnet activity drives or is driven by the schedule` });
    fail(p);
    // an activity started by the data date and finished after it: its remaining duration is its duration less the working days it had run by then (its later progress is not known on that day)
    const ran = (from) => { let n = 0; for (let o = ordOf(from); o < ordOf(dataDate); o += 1) if (cal.isWork(o)) n += 1; return n; };
    const asAt = (a) => { const st = a.actual_start && a.actual_start <= dataDate ? a.actual_start : null; const fin = st && a.actual_finish && a.actual_finish <= dataDate ? a.actual_finish : null; const later = Boolean(st && !fin && a.actual_finish); return { actualStart: st, actualFinish: fin, remaining: fin ? 0 : later ? Math.max(1, a.duration_days - ran(st)) : st ? a.remaining_days : null, pct: fin ? 10000 : later ? Math.round((Math.min(a.duration_days, ran(st)) * 10000) / Math.max(1, a.duration_days)) : st ? a.pct_complete : 0 }; };
    const base = acts.map((a) => ({ id: a.id, type: a.act_type, duration: a.duration_days, calendarId: a.calendar_id && a.calendar_id !== s.calendar_id ? a.calendar_id : null, constraintType: a.constraint_type, constraintDate: a.constraint_date, ...asAt(a) }));
    const links = db.prepare('SELECT pred_id AS pred, succ_id AS succ, dep_type AS type, lag_days AS lag FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id);
    const run = (activities, ls) => calculate({ start: s.start_date, dataDate, calendar: cal, calendars: cals, activities, links: ls });
    const before = run(base, links); if (!before.ok) throw unprocessable('The schedule has a loop; correct it before analysing.');
    const after = run([...base, ...fa.map((a) => ({ id: a.id, type: a.duration === 0 ? 'MILESTONE' : 'TASK', duration: a.duration, calendarId: null, constraintType: 'NONE', constraintDate: null, actualStart: null, actualFinish: null, remaining: null, pct: 0 }))], [...links, ...fl]);
    if (!after.ok) { const name = (id) => (id < 0 ? fa[-id - 1].code : acts.find((a) => a.id === id)?.code ?? id); throw Object.assign(unprocessable(`The fragnet closes a loop: ${after.cycle.map(name).join(' → ')}.`), { details: [{ field: 'fragnet.links', message: `Loop: ${after.cycle.map(name).join(' → ')}` }] }); }
    let work = 0; const o1 = ordOf(before.finish); const o2 = ordOf(after.finish); for (let o = Math.min(o1, o2) + 1; o <= Math.max(o1, o2); o += 1) if (cal.isWork(o)) work += 1;
    const moved = acts.map((a) => ({ a, b: before.results.get(a.id), c: after.results.get(a.id) })).filter((x) => x.b && x.c && x.c.ef !== x.b.ef).sort((x, y) => ordOf(y.c.ef) - ordOf(x.c.ef) || x.a.code.localeCompare(y.a.code))
      .slice(0, 200).map((x) => ({ code: x.a.code, name: x.a.name, efBefore: x.b.ef, efAfter: x.c.ef, shift: ordOf(x.c.ef) - ordOf(x.b.ef), critical: x.c.critical }));
    const frag = fa.map((a) => { const x = after.results.get(a.id); return { code: a.code, name: a.name, duration: a.duration, es: x.es, ef: x.ef, critical: x.critical, totalFloat: x.totalFloat }; });
    const impact = o2 - o1;
    return { completionBefore: before.finish, completionAfter: after.finish, impactDays: impact, impactWorkingDays: impact >= 0 ? work : -work, moved, fragnet: frag, affectedCritical: acts.filter((a) => after.results.get(a.id)?.critical && json(r.affected_activities_json, []).some((x) => x.activityId === a.id)).map((a) => a.code) };
  }
  const tia = {
    /** The analysis worked out and shown; nothing is kept. */
    preview(actor, id, b) { const r = row(actor, id, 'plan.delay.analyse'); const s = scheduleOf(actor, r.org_project_id, b.scheduleId ?? r.schedule_id ?? currentSchedule(actor.companyId, r.org_project_id)?.id); return { scheduleId: s.id, scheduleRef: `${s.doc_no} v${s.version_no}`, dataDate: b.dataDate ?? r.start_date, ...analyse(r, s, b.dataDate ?? r.start_date, b.fragnet) }; },
    /** The analysis kept with the picture it was made from; it becomes the impact of the delay (BR-01: the schedule is not touched). */
    save(actor, id, b) {
      const r = row(actor, id, 'plan.delay.analyse'); mustEdit(r); const s = scheduleOf(actor, r.org_project_id, b.scheduleId ?? r.schedule_id ?? currentSchedule(actor.companyId, r.org_project_id)?.id); const dataDate = b.dataDate ?? r.start_date; const x = analyse(r, s, dataDate, b.fragnet);
      return transaction(db, () => {
        const tid = Number(db.prepare("INSERT INTO plan_tia (company_id, delay_id, schedule_id, schedule_copy_ref, data_date, fragnet_json, completion_before, completion_after, impact_days, impact_working_days, result_json, analysed_by, analysed_at, note, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
          .run(r.company_id, r.id, s.id, `${s.doc_no} v${s.version_no} (${s.status.toLowerCase()}, calculated ${s.calculated_at ?? 'never'})`, dataDate, JSON.stringify(b.fragnet), x.completionBefore, x.completionAfter, x.impactDays, x.impactWorkingDays, JSON.stringify({ moved: x.moved, fragnet: x.fragnet, affectedCritical: x.affectedCritical }), actor.user, nowIso(), b.note ?? null, r.org_project_id, actor.user).lastInsertRowid);
        db.prepare('UPDATE plan_delays SET tia_id = ?, impact_days = ?, schedule_id = COALESCE(schedule_id, ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(tid, x.impactDays, s.id, actor.user, nowIso(), r.id);
        audit(actor, 'plan_delays', r.id, 'tia', r.company_id, { newValues: { tiaId: tid, schedule: s.doc_no, dataDate, before: x.completionBefore, after: x.completionAfter, impactDays: x.impactDays } }); return delays.get(actor, r.id);
      });
    },
  };

  // ---- FR-05: the summary by cause and responsibility, and what the claims read -------------------------------------------------------------------------------------------------------
  function summaryRows(actor, q) {
    if (q.projectId) project(actor, q.projectId); else if (!authz.check(actor, 'plan.delay.view').allowed) throw forbidden('You may not see delays (permission plan.delay.view).');
    const sc = scope(actor); const where = [sc.sql, 'x.deleted_at IS NULL']; const params = { ...sc.params }; const st = q.status === 'all' ? null : q.status ?? 'APPROVED';
    if (st) { where.push('x.status = :st'); params.st = st; } else where.push("x.status NOT IN ('CANCELLED', 'SUPERSEDED', 'REJECTED')");
    if (q.projectId) { where.push('x.org_project_id = :pid'); params.pid = q.projectId; } if (q.from) { where.push('x.end_date >= :from'); params.from = q.from; } if (q.to) { where.push('x.start_date <= :to'); params.to = q.to; }
    return db.prepare(`SELECT ${COLS}, p.code AS pcode FROM plan_delays x JOIN org_projects p ON p.id = x.org_project_id WHERE ${where.join(' AND ')} ORDER BY x.start_date, x.id`).all(params);
  }
  function summary(actor, q) {
    const rows = summaryRows(actor, q); const cell = new Map(); const tot = { count: 0, delayDays: 0, impactDays: 0, excusable: 0, compensable: 0, nonExcusable: 0 }; const byResp = {}; const byCause = {};
    for (const r of rows) {
      const k = `${r.cause_category}|${r.responsibility}`; const x = cell.get(k) ?? { cause: r.cause_category, responsibility: r.responsibility, count: 0, delayDays: 0, impactDays: 0 }; const imp = r.impact_days ?? 0; const c = classOf(r.responsibility);
      x.count += 1; x.delayDays += r.delay_days; x.impactDays += imp; cell.set(k, x); tot.count += 1; tot.delayDays += r.delay_days; tot.impactDays += imp; if (c.excusable) tot.excusable += imp; if (c.compensable) tot.compensable += imp; if (!c.excusable) tot.nonExcusable += imp;
      for (const [m, key] of [[byResp, r.responsibility], [byCause, r.cause_category]]) { m[key] ??= { count: 0, delayDays: 0, impactDays: 0 }; m[key].count += 1; m[key].delayDays += r.delay_days; m[key].impactDays += imp; }
    }
    const pid = q.projectId ?? null;
    return { projectId: pid, status: q.status ?? 'APPROVED', from: q.from ?? null, to: q.to ?? null,
      cells: [...cell.values()].map((x) => ({ ...x, causeLabel: CAUSES[x.cause], responsibilityLabel: RESPONSIBILITY[x.responsibility] })).sort((a, b) => b.impactDays - a.impactDays || b.delayDays - a.delayDays),
      byResponsibility: Object.keys(RESPONSIBILITY).map((k) => ({ code: k, label: RESPONSIBILITY[k], ...(byResp[k] ?? { count: 0, delayDays: 0, impactDays: 0 }) })), byCause: Object.keys(CAUSES).map((k) => ({ code: k, label: CAUSES[k], ...(byCause[k] ?? { count: 0, delayDays: 0, impactDays: 0 }) })).filter((x) => x.count),
      totals: tot, drill: q.cause || q.responsibility ? rows.filter((r) => (!q.cause || r.cause_category === q.cause) && (!q.responsibility || r.responsibility === q.responsibility)).map((r) => listRow(actor, r)) : null,
      can: { export: pid ? may(actor, 'plan.delay.export', pid) : authz.check(actor, 'plan.delay.export').allowed } };
  }
  function summaryExport(actor, q) {
    if (q.projectId) need(actor, 'plan.delay.export', 'export the delay summary', q.projectId); else if (!authz.check(actor, 'plan.delay.export').allowed) throw forbidden('You may not export delays (permission plan.delay.export).');
    const s = summary(actor, q); const rows = summaryRows(actor, q); const columns = [{ key: 'docNo', label: 'Delay no.', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'title', label: 'Event', type: 'text' }, { key: 'cause', label: 'Cause', type: 'text' }, { key: 'responsibility', label: 'Responsibility', type: 'text' }, { key: 'from', label: 'From', type: 'text' }, { key: 'to', label: 'To', type: 'text' }, { key: 'delayDays', label: 'Delay days', type: 'number' }, { key: 'impactDays', label: 'Impact on completion (days)', type: 'number' }, { key: 'kind', label: 'Excusable / compensable', type: 'text' }];
    const out = rows.map((r) => { const c = classOf(r.responsibility); return { docNo: r.doc_no, project: r.pcode, title: r.title, cause: CAUSES[r.cause_category], responsibility: RESPONSIBILITY[r.responsibility], from: r.start_date, to: r.end_date, delayDays: r.delay_days, impactDays: r.impact_days ?? '', kind: c.compensable ? 'Excusable and compensable' : c.excusable ? 'Excusable' : 'Not excusable' }; });
    out.push({ docNo: 'Total', title: `${s.totals.count} delays`, delayDays: s.totals.delayDays, impactDays: s.totals.impactDays, kind: `excusable ${s.totals.excusable}, compensable ${s.totals.compensable}, not excusable ${s.totals.nonExcusable}` });
    const footer = ['Delay summary by cause and responsibility', `Status: ${s.status === 'all' ? 'all but cancelled, rejected and superseded' : DELAY_STATUS[s.status] ?? s.status}${q.from || q.to ? `; from ${q.from ?? '…'} to ${q.to ?? '…'}` : ''}. Impact days are the completion shift of the time-impact analysis of each delay.`, `Generated by ${actor.user} on ${todayIST()}`]; const name = `delay-summary-${todayIST()}`;
    audit(actor, 'plan_delays', 0, 'export', actor.companyId, { newValues: { report: 'delay summary', format: q.format, rows: rows.length } });
    if (q.format === 'csv') return { buffer: toCsv({ columns, rows: out, footer }), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: rows.length };
    if (q.format === 'pdf') return { buffer: toPdf({ columns: columns.filter((c) => c.key !== 'project'), rows: out, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: rows.length };
    return { buffer: toXlsx({ columns, rows: out, footer, sheetName: 'Delays' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: rows.length };
  }
  /** What the EOT claims (21.06) and LD (21.07) read: the approved delays of a project with their classification and impact, and the totals. */
  function claims(actor, projectId) {
    const o = project(actor, projectId); const rows = db.prepare(`SELECT ${COLS} FROM plan_delays x WHERE x.org_project_id = ? AND x.status = 'APPROVED' AND x.deleted_at IS NULL ORDER BY x.start_date`).all(o.id);
    const out = rows.map((r) => { const c = classOf(r.responsibility); const t = r.tia_id ? db.prepare('SELECT completion_before, completion_after, impact_days, data_date FROM plan_tia WHERE id = ?').get(r.tia_id) : null; return { delayId: r.id, docNo: r.doc_no, title: r.title, cause: r.cause_category, responsibility: r.responsibility, excusable: c.excusable, compensable: c.compensable, startDate: r.start_date, endDate: r.end_date, delayDays: r.delay_days, impactDays: r.impact_days, tia: t ? { dataDate: t.data_date, completionBefore: t.completion_before, completionAfter: t.completion_after } : null, activities: json(r.affected_activities_json, []).map((a) => a.code) }; });
    const sum = (f) => out.filter(f).reduce((n, x) => n + (x.impactDays ?? 0), 0);
    return { projectId: o.id, projectCode: o.code, rows: out, totals: { excusableDays: sum((x) => x.excusable), compensableDays: sum((x) => x.compensable), nonExcusableDays: sum((x) => !x.excusable) } };
  }

  // ---- FR-02: drafts from the RFIs answered with a time impact ---------------------------------------------------------------------------------------------------------------------------
  /** One draft for each RFI answer with a time impact; an RFI answered again with a new impact updates its draft while it is a draft. The delay starts at the required-by date of the RFI. */
  function fromRfi(e) {
    const d = e.data ?? {}; const companyId = Number(e.companyId ?? e.company_id); const pid = Number(d.projectId); const days = Number(d.timeImpactDays ?? 0); if (!companyId || !pid || !d.rfiId || !(days > 0)) return null;
    const rfi = db.prepare('SELECT id, rfi_no, subject, required_by, responded_on, activity_ref, drawing_id FROM engg_rfis WHERE id = ? AND company_id = ?').get(Number(d.rfiId), companyId); if (!rfi) return null;
    const start = rfi.required_by ?? rfi.responded_on ?? todayIST(); const end = isoOf(ordOf(start) + days - 1); const s = currentSchedule(companyId, pid);
    const a = s && rfi.activity_ref ? db.prepare('SELECT id, code, name FROM plan_activities WHERE schedule_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(s.id, rfi.activity_ref) : null; const affected = a ? [{ activityId: a.id, code: a.code, name: a.name }] : [];
    const have = db.prepare("SELECT id, status FROM plan_delays WHERE src_entity = 'engg_rfi' AND src_id = ? AND company_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') ORDER BY id DESC").get(String(rfi.id), companyId);
    const sys = { user: 'system', companyId };
    return transaction(db, () => {
      if (have) { if (have.status === 'DRAFT') { db.prepare('UPDATE plan_delays SET start_date = ?, end_date = ?, delay_days = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(start, end, days, 'system', nowIso(), have.id); audit(sys, 'plan_delays', have.id, 'update', companyId, { reason: `${rfi.rfi_no} answered again`, newValues: { days } }); } return have.id; }
      const id = Number(db.prepare("INSERT INTO plan_delays (company_id, doc_no, doc_date, org_project_id, schedule_id, title, description, cause_category, responsibility, start_date, end_date, delay_days, affected_activities_json, revision_no, status, src_entity, src_id, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'LATE_DRAWINGS', 'EMPLOYER', ?, ?, ?, ?, 1, 'DRAFT', 'engg_rfi', ?, NULL, ?, 'system', 'engg_rfi', ?)")
        .run(companyId, numberFor(companyId, 'system'), todayIST(), pid, s?.id ?? null, `${rfi.rfi_no}: ${rfi.subject}`.slice(0, 200), `Drafted from the answer to ${rfi.rfi_no}, which gave a time impact of ${days} day(s). Check the cause, the responsibility and the activities, then analyse the impact.`, start, end, days, JSON.stringify(affected), String(rfi.id), pid, String(rfi.id)).lastInsertRowid);
      db.prepare("INSERT INTO plan_delay_evidence (company_id, delay_id, entity, entity_id, label, project_id, created_by, source_type) VALUES (?, ?, 'engg_rfi', ?, ?, ?, 'system', 'engg_rfi')").run(companyId, id, String(rfi.id), `${rfi.rfi_no}: ${rfi.subject}`.slice(0, 300), pid);
      if (rfi.drawing_id) { const dw = db.prepare('SELECT drawing_no, title FROM engg_drawings WHERE id = ?').get(rfi.drawing_id); if (dw) db.prepare("INSERT INTO plan_delay_evidence (company_id, delay_id, entity, entity_id, label, project_id, created_by, source_type) VALUES (?, ?, 'engg_drawing', ?, ?, ?, 'system', 'engg_rfi')").run(companyId, id, String(rfi.drawing_id), `${dw.drawing_no}: ${dw.title}`.slice(0, 300), pid); }
      audit(sys, 'plan_delays', id, 'create', companyId, { reason: `Drafted from ${rfi.rfi_no}`, newValues: { days, activity: a?.code ?? null } });
      publishEvent(db, { type: 'plan.delay.drafted', entity: 'plan_delay', entityId: id, actorId: 'system', companyId, projectId: pid, data: { delayId: id, projectId: pid, source: 'engg_rfi', sourceId: rfi.id, delayDays: days } });
      return id;
    });
  }

  return { delays, evidence, tia, summary, summaryExport, claims, fromRfi, delayDecide: delays.decide };
}
