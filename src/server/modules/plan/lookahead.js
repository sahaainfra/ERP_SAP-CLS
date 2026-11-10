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
import { openRfisOf } from '../engg/rfis.js';
import { drawingsWithoutIfc } from '../engg/drawings.js';
import { isoOf, ordOf } from './cpm.js';

// Look-ahead planning, constraints and weekly work plans (part 13.04).
// - The look-ahead (FR-01) is the activities of a schedule that start or run in the next N weeks, by week, by site or work front, each with its open constraints and whether it is ready.
// - A constraint (FR-02) is what stops an activity. Some are found by this module in the others (an open RFI or a drawing without an IFC revision on the activity's WBS node and location, a predecessor
//   that should be finished and is not, labour of a trade that no approved crew covers) and clear by themselves when the source is resolved (BR-02); the others are logged by hand with an owner and a date.
// - An activity is ready (FR-03) only when none of its constraints is open; a weekly plan is not sent with a commitment on an activity that is not ready.
// - The weekly work plan (FR-04) commits quantities by activity and crew for a week, is approved by the construction manager and then the project manager, then records what was done; a commitment is
//   completed when its completed quantity reaches the committed one; PPC = completed commitments / commitments (BR-01); what was not done carries a variance code. The daily breakdown (FR-05) spreads
//   every commitment over the working days of the week between the dates of the activity, for work authorisation (14.01).
export const WEEKLY_DOC = 'PLAN_WEEKLY';
export const WEEKLY_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved (locked)', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed', SUPERSEDED: 'Superseded by a revision' };
export const CONSTRAINT_TYPES = { DRAWING: 'Drawing', RFI: 'RFI', SUBMITTAL: 'Submittal', MATERIAL: 'Material', LABOUR: 'Labour', PLANT: 'Plant', PERMIT: 'Permit', PREDECESSOR: 'Predecessor', CLIENT_APPROVAL: 'Client approval', ACCESS: 'Access' };
export const CONSTRAINT_STATUS = { OPEN: 'Open', CLEARED: 'Cleared', WAIVED: 'Waived' };
export const VARIANCE_CODES = { DRAWINGS: 'Drawings or RFI', MATERIAL: 'Material', LABOUR: 'Labour', PLANT: 'Plant and equipment', WEATHER: 'Weather', PREDECESSOR: 'Predecessor late', CLIENT: 'Client or consultant', PERMIT: 'Permit or access', QUALITY: 'Quality rework', SAFETY: 'Safety stop', OTHER: 'Other' };
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-');
const mondayOf = (iso) => isoOf(ordOf(iso) - ((ordOf(iso) + 3) % 7)); // 1970-01-01 was a Thursday: ord 0 is weekday 3 counted from Monday
const isMonday = (iso) => mondayOf(iso) === iso;
const WP_COLS = 'x.id, x.company_id, x.doc_no, x.doc_date, x.org_project_id, x.wp_site_id, x.schedule_id, x.week_start, x.revision_no, x.parent_plan_id, x.status, x.items_count, x.completed_count, x.ppc, x.note, x.reason, x.workflow_instance_id, x.requested_by, x.approved_by, x.approved_at, x.closed_at, x.closed_by, x.created_by, x.created_at, x.updated_at, x.version';

export const constraintList = defineList({
  code: 'plan.constraints', label: 'Constraints', permission: 'plan.constraint.view',
  from: 'plan_constraints x JOIN org_projects p ON p.id = x.org_project_id JOIN plan_activities a ON a.id = x.activity_id', where: 'x.deleted_at IS NULL', searchable: ['x.description', 'a.code', 'a.name', 'p.code', 'x.owner_user'], defaultSort: 'dueDate',
  columns: {
    project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, activity: { sql: 'a.code', type: 'text', label: 'Activity' },
    ctype: { sql: 'x.ctype', type: 'enum', label: 'Type', options: Object.entries(CONSTRAINT_TYPES) }, description: { sql: 'x.description', type: 'text', label: 'Description' }, owner: { sql: 'x.owner_user', type: 'text', label: 'Owner' },
    dueDate: { sql: 'x.due_date', type: 'date', label: 'Due' }, origin: { sql: 'x.origin', type: 'enum', label: 'Found', options: [['AUTO', 'By the system'], ['MANUAL', 'By hand']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(CONSTRAINT_STATUS) },
    scheduleId: { sql: 'x.schedule_id', type: 'number', label: 'Schedule id' }, activityId: { sql: 'x.activity_id', type: 'number', label: 'Activity id' },
  },
});
export const weeklyList = defineList({
  code: 'plan.weekly_plans', label: 'Weekly work plans', permission: 'plan.weekly_plan.view',
  from: 'plan_weekly_plans x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 'p.name'], defaultSort: '-weekStart',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Plan no.' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, weekStart: { sql: 'x.week_start', type: 'date', label: 'Week from' },
    revisionNo: { sql: 'x.revision_no', type: 'number', label: 'Revision' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(WEEKLY_STATUS) }, items: { sql: 'x.items_count', type: 'number', label: 'Commitments' }, ppc: { sql: 'x.ppc', type: 'number', label: 'PPC' },
  },
});

export function createLookaheadService({ db, plan }) {
  const authz = authzOf(db);
  const may = (actor, key, pid) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed;
  const need = (actor, key, what, pid) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const event = (type, actor, entity, id, r, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, data });
  const notify = (companyId, code, users, ref, subject, detail, link, sourceId) => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId }); } catch { /* saved anyway */ } };
  const system = (companyId) => ({ user: 'system', companyId, roles: ['SYSTEM'] });
  const orgOf = (id) => db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ?').get(id);
  const schedRow = (id) => db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(id);
  /** A schedule the person may see through the look-ahead (404 otherwise). */
  function schedule(actor, id, key = 'plan.lookahead.view') {
    const s = db.prepare('SELECT * FROM plan_schedules WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!s || !may(actor, 'plan.lookahead.view', s.org_project_id) && !may(actor, 'plan.weekly_plan.view', s.org_project_id)) throw notFound('That schedule does not exist.');
    if (key !== 'plan.lookahead.view') need(actor, key, 'do that for this schedule', s.org_project_id); return s;
  }
  /** The schedule in use of a project: the approved one, else the one in work. */
  const currentSchedule = (companyId, projectId) => db.prepare(`SELECT * FROM plan_schedules WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'DRAFT', 'RETURNED', 'SUBMITTED') ORDER BY (status = 'APPROVED') DESC, id DESC`).get(companyId, projectId);
  const calOf = (s) => plan.calendarOf(db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(s.calendar_id));
  const numberFor = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: WEEKLY_DOC, actor: actor.user, refType: 'plan_weekly_plans' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM plan_weekly_plans WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1; return `WP/${String(n).padStart(5, '0')}`;
  };

  // ---- FR-02, BR-02: constraints found in the other modules, cleared when their source is resolved -------------------------------------------------------------------------------
  /**
   * Works out the constraints the system can see for the activities of a schedule that are not finished and start within twelve weeks, adds the ones that are new and clears the ones whose source is resolved.
   * It is run when a look-ahead is made, when the person asks, and when an RFI, a drawing or the progress of the schedule changes (the events).
   */
  function sync(companyId, scheduleId) {
    const s = schedRow(scheduleId); if (!s || s.company_id !== companyId || ['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(s.status)) return { raised: 0, cleared: 0 };
    const pid = s.org_project_id; const today = todayIST(); const horizon = isoOf(ordOf(today) + 84); const now = nowIso(); const actor = system(companyId);
    const acts = db.prepare("SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL AND act_type IN ('TASK', 'MILESTONE')").all(s.id); const byId = new Map(acts.map((a) => [a.id, a]));
    const open = acts.filter((a) => !a.actual_finish && (!a.es || a.es <= horizon)); const rfis = openRfisOf(db, companyId, pid); const noIfc = drawingsWithoutIfc(db, companyId, pid);
    const preds = new Map(); for (const d of db.prepare("SELECT pred_id, succ_id, dep_type FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL AND dep_type = 'FS'").all(s.id)) { if (!preds.has(d.succ_id)) preds.set(d.succ_id, []); preds.get(d.succ_id).push(d.pred_id); }
    const labour = new Map(); for (const r of db.prepare("SELECT activity_id, trade, res_key FROM plan_activity_resources WHERE schedule_id = ? AND deleted_at IS NULL AND resource_type = 'LABOUR' AND trade IS NOT NULL").all(s.id)) { if (!labour.has(r.activity_id)) labour.set(r.activity_id, []); labour.get(r.activity_id).push(r); }
    const crewHas = db.prepare("SELECT 1 FROM hr_deployments d JOIN hr_crews c ON c.id = d.crew_id WHERE d.company_id = ? AND d.dep_project_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND lower(c.trade) = lower(?) AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) LIMIT 1");
    const here = (a, w, l) => (w != null && w === a.wbs_id && (l == null || l === a.location_id));
    const found = new Map(); const want = (a, ctype, entity, id, description, due) => found.set(`${a.id}|${ctype}|${entity}|${id}`, { a, ctype, entity, id: String(id), description, due });
    for (const a of open) {
      for (const r of rfis) if (same(r.activityRef, a.code) || here(a, r.wbsId, r.locationId)) want(a, 'RFI', 'engg_rfi', r.rfiId, `Open RFI ${r.rfiNo}${r.drawingNo ? ` on drawing ${r.drawingNo}` : ''}: ${r.subject}`.slice(0, 500), r.requiredBy);
      for (const d of noIfc) if (here(a, d.wbsId, d.locationId)) want(a, 'DRAWING', 'engg_drawing', d.drawingId, `No IFC revision yet of drawing ${d.drawingNo}: ${d.title}`.slice(0, 500), d.plannedReceipt ?? a.es);
      for (const pr of preds.get(a.id) ?? []) { const p = byId.get(pr); if (p && !p.actual_finish && p.ef && p.ef < today) want(a, 'PREDECESSOR', 'plan_activity', p.id, `Predecessor ${p.code} ${p.name} is not finished (planned finish ${p.ef})`.slice(0, 500), p.ef); }
      for (const r of labour.get(a.id) ?? []) if (a.es && a.ef && !crewHas.get(companyId, pid, r.trade, a.ef, a.es)) want(a, 'LABOUR', 'plan_resource', r.res_key, `No approved crew of trade ${r.trade} is deployed on the project over ${a.es} to ${a.ef}`, a.es);
    }
    return transaction(db, () => {
      let raised = 0; let cleared = 0; const insert = db.prepare("INSERT OR IGNORE INTO plan_constraints (company_id, org_project_id, schedule_id, activity_id, ctype, description, due_date, origin, src_entity, src_id, status, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'AUTO', ?, ?, 'OPEN', ?, 'system', 'detected')");
      const waived = db.prepare("SELECT 1 FROM plan_constraints WHERE activity_id = ? AND ctype = ? AND src_entity = ? AND src_id = ? AND status = 'WAIVED' AND deleted_at IS NULL"); // a waived constraint is not raised again for the same source
      for (const f of found.values()) { if (waived.get(f.a.id, f.ctype, f.entity, f.id)) continue; const r = insert.run(companyId, pid, s.id, f.a.id, f.ctype, f.description, f.due ?? null, f.entity, f.id, pid); if (Number(r.changes)) { raised += 1; const row = db.prepare("SELECT id FROM plan_constraints WHERE activity_id = ? AND ctype = ? AND src_entity = ? AND src_id = ? AND status = 'OPEN' AND deleted_at IS NULL").get(f.a.id, f.ctype, f.entity, f.id); audit(actor, 'plan_constraints', row.id, 'raise', companyId, { newValues: { activity: f.a.code, type: f.ctype, source: `${f.entity}:${f.id}` } }); event('plan.constraint.raised', actor, 'plan_constraint', row.id, { company_id: companyId, org_project_id: pid }, { constraintId: row.id, projectId: pid, scheduleId: s.id, activityId: f.a.id, code: f.a.code, type: f.ctype, source: f.entity, sourceId: f.id, dueDate: f.due ?? null }); } }
      const evaluated = new Set(open.map((a) => a.id));
      for (const c of db.prepare("SELECT * FROM plan_constraints WHERE schedule_id = ? AND origin = 'AUTO' AND status = 'OPEN' AND deleted_at IS NULL").all(s.id)) {
        const a = byId.get(c.activity_id); const gone = !a || Boolean(a.actual_finish); if (!gone && !evaluated.has(c.activity_id)) continue; if (!gone && found.has(`${c.activity_id}|${c.ctype}|${c.src_entity}|${c.src_id}`)) continue;
        db.prepare("UPDATE plan_constraints SET status = 'CLEARED', cleared_on = ?, cleared_by = 'system', clear_note = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(todayIST(), gone ? 'The activity is finished' : 'The source is resolved', now, c.id); cleared += 1;
        audit(actor, 'plan_constraints', c.id, 'clear', companyId, { reason: gone ? 'The activity is finished' : 'The source is resolved', newValues: { source: `${c.src_entity}:${c.src_id}` } });
        event('plan.constraint.cleared', actor, 'plan_constraint', c.id, { company_id: companyId, org_project_id: pid }, { constraintId: c.id, projectId: pid, scheduleId: s.id, activityId: c.activity_id, type: c.ctype, by: 'system' });
      }
      return { raised, cleared };
    });
  }
  /** The events that can resolve or raise a constraint: the schedule of the project in use is worked out again. */
  function onEvent(e) {
    const pid = Number(e.data?.projectId ?? e.projectId); const companyId = Number(e.companyId ?? e.company_id); if (!pid || !companyId) return;
    const s = currentSchedule(companyId, pid); if (s) sync(companyId, s.id);
  }

  const conView = (actor, r, today = todayIST()) => ({
    id: r.id, projectId: r.org_project_id, projectCode: r.pcode, scheduleId: r.schedule_id, activityId: r.activity_id, activity: r.acode, activityName: r.aname, type: r.ctype, typeLabel: CONSTRAINT_TYPES[r.ctype], description: r.description, owner: r.owner_user, dueDate: r.due_date,
    overdue: r.status === 'OPEN' && Boolean(r.due_date) && r.due_date < today, origin: r.origin, source: r.src_entity ? { entity: r.src_entity, id: r.src_id } : null, status: r.status, statusLabel: CONSTRAINT_STATUS[r.status], clearedOn: r.cleared_on, clearedBy: r.cleared_by, clearNote: r.clear_note, rowVersion: r.version,
    can: { edit: r.status === 'OPEN' && may(actor, 'plan.constraint.manage', r.org_project_id), clear: r.status === 'OPEN' && r.origin === 'MANUAL' && may(actor, 'plan.constraint.manage', r.org_project_id), waive: r.status === 'OPEN' && may(actor, 'plan.constraint.manage', r.org_project_id) },
  });
  const CON_SQL = 'SELECT x.*, p.code AS pcode, a.code AS acode, a.name AS aname FROM plan_constraints x JOIN org_projects p ON p.id = x.org_project_id JOIN plan_activities a ON a.id = x.activity_id';
  const conRow = (actor, id, key = 'plan.constraint.view') => {
    const r = db.prepare(`${CON_SQL} WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL`).get(rid(id), actor.companyId);
    if (!r || !may(actor, 'plan.constraint.view', r.org_project_id)) throw notFound('That constraint does not exist.'); if (key !== 'plan.constraint.view') need(actor, key, 'change constraints of this project', r.org_project_id); return r;
  };
  const conScope = (actor) => { const f = authz.scopeFilter(actor, 'plan.constraint.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const checkOwner = (actor, owner) => { if (owner && !db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?)').get(actor.companyId, owner)) fail([{ field: 'owner', message: 'Choose a person of the company' }]); };
  const constraints = {
    list(actor, query) { if (!authz.check(actor, 'plan.constraint.view').allowed) throw forbidden('You may not see constraints (permission plan.constraint.view).'); const sc = conScope(actor); const t = todayIST(); return runList(db, constraintList, parseListRequest(constraintList, query), { select: 'x.*, p.code AS pcode, a.code AS acode, a.name AS aname', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => conView(actor, x, t) }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'plan.constraint.view').allowed) throw forbidden('You may not export constraints (permission plan.constraint.view).'); const sc = conScope(actor); const opts = { select: 'x.*, p.code AS pcode, a.code AS acode, a.name AS aname', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' }; const t = todayIST();
      return { title: constraintList.label, permission: 'plan.constraint.view', personal: false, columns: ['project', 'activity', 'ctype', 'description', 'owner', 'dueDate', 'origin', 'status'].map((k) => ({ key: k, label: constraintList.columns[k]?.label ?? k, type: 'text' })),
        rows: () => runList(db, constraintList, req, { ...opts, limit: null, map: (x) => { const v = conView(actor, x, t); return { project: v.projectCode, activity: `${v.activity} ${v.activityName}`, ctype: v.typeLabel, description: v.description, owner: v.owner ?? '', dueDate: v.dueDate ?? '', origin: v.origin === 'AUTO' ? 'By the system' : 'By hand', status: v.statusLabel }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All constraints you may see'], count: () => countList(db, constraintList, req, opts) };
    },
    get(actor, id) { return conView(actor, conRow(actor, id)); },
    /** The constraints of one activity, for the board and the Gantt. */
    ofActivity(actor, activityId) { const a = db.prepare('SELECT * FROM plan_activities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(activityId), actor.companyId); if (!a || !may(actor, 'plan.constraint.view', a.project_id)) throw notFound('That activity does not exist.'); return { rows: db.prepare(`${CON_SQL} WHERE x.activity_id = ? AND x.deleted_at IS NULL ORDER BY x.status, x.due_date`).all(a.id).map((r) => conView(actor, r)) }; },
    create(actor, b) {
      const a = db.prepare('SELECT * FROM plan_activities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.activityId, actor.companyId); if (!a) throw notFound('That activity does not exist.');
      const s = schedRow(a.schedule_id); need(actor, 'plan.constraint.manage', 'log constraints for this project', s.org_project_id); if (a.actual_finish) throw unprocessable(`${a.code} is finished: nothing holds it.`); if (['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(s.status)) throw unprocessable(`${s.doc_no} is ${lower(s.status)}.`);
      checkOwner(actor, b.owner); const id = Number(db.prepare("INSERT INTO plan_constraints (company_id, org_project_id, schedule_id, activity_id, ctype, description, owner_user, due_date, origin, status, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 'OPEN', ?, ?, 'api')").run(actor.companyId, s.org_project_id, s.id, a.id, b.type, b.description, b.owner ?? null, b.dueDate ?? null, s.org_project_id, actor.user).lastInsertRowid);
      audit(actor, 'plan_constraints', id, 'create', actor.companyId, { newValues: { activity: a.code, type: b.type, owner: b.owner, due: b.dueDate } }); event('plan.constraint.raised', actor, 'plan_constraint', id, { company_id: actor.companyId, org_project_id: s.org_project_id }, { constraintId: id, projectId: s.org_project_id, scheduleId: s.id, activityId: a.id, code: a.code, type: b.type, source: null, sourceId: null, dueDate: b.dueDate ?? null });
      return constraints.get(actor, id);
    },
    update(actor, id, b) {
      const r = conRow(actor, id, 'plan.constraint.manage'); if (r.status !== 'OPEN') throw conflict('A constraint that is cleared or waived is not changed.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this constraint; reload it.');
      if (r.origin === 'AUTO' && ('type' in b || 'description' in b)) throw unprocessable('A constraint found by the system keeps its type and description: only the owner and the due date are set.'); if ('owner' in b) checkOwner(actor, b.owner);
      const sets = []; const vals = []; for (const [k, c] of [['type', 'ctype'], ['description', 'description'], ['owner', 'owner_user'], ['dueDate', 'due_date']]) if (k in b) { sets.push(`${c} = ?`); vals.push(b[k]); }
      db.prepare(`UPDATE plan_constraints SET ${[...sets, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id); const changed = { ...b }; delete changed.rowVersion; audit(actor, 'plan_constraints', r.id, 'update', r.company_id, { newValues: changed }); return constraints.get(actor, r.id);
    },
    /** A constraint logged by hand is cleared by the person; one found by the system clears itself (or is waived with a reason). */
    clear(actor, id, { note }) {
      const r = conRow(actor, id, 'plan.constraint.manage'); if (r.status !== 'OPEN') throw conflict('This constraint is not open.'); if (r.origin === 'AUTO') throw unprocessable('This constraint was found by the system and clears itself when its source is resolved; if it does not apply, waive it with a reason.');
      db.prepare("UPDATE plan_constraints SET status = 'CLEARED', cleared_on = ?, cleared_by = ?, clear_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(todayIST(), actor.user, note ?? null, actor.user, nowIso(), r.id);
      audit(actor, 'plan_constraints', r.id, 'clear', r.company_id, { reason: note }); event('plan.constraint.cleared', actor, 'plan_constraint', r.id, r, { constraintId: r.id, projectId: r.org_project_id, scheduleId: r.schedule_id, activityId: r.activity_id, type: r.ctype, by: actor.user }); return constraints.get(actor, r.id);
    },
    waive(actor, id, { reason }) {
      const r = conRow(actor, id, 'plan.constraint.manage'); if (r.status !== 'OPEN') throw conflict('This constraint is not open.');
      db.prepare("UPDATE plan_constraints SET status = 'WAIVED', cleared_on = ?, cleared_by = ?, clear_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(todayIST(), actor.user, reason, actor.user, nowIso(), r.id);
      audit(actor, 'plan_constraints', r.id, 'waive', r.company_id, { reason }); event('plan.constraint.cleared', actor, 'plan_constraint', r.id, r, { constraintId: r.id, projectId: r.org_project_id, scheduleId: r.schedule_id, activityId: r.activity_id, type: r.ctype, by: actor.user, waived: true }); return constraints.get(actor, r.id);
    },
    detect(actor, scheduleId) { const s = schedule(actor, scheduleId, 'plan.constraint.manage'); const r = sync(actor.companyId, s.id); audit(actor, 'plan_schedules', s.id, 'detect_constraints', s.company_id, { newValues: r }); return { scheduleId: s.id, ...r }; },
  };

  // ---- FR-01, FR-03: the look-ahead ---------------------------------------------------------------------------------------------------------------------------------------------------
  function board(actor, scheduleId, q) {
    const s = schedule(actor, scheduleId); const today = todayIST(); const from = q.from ? mondayOf(q.from) : mondayOf(today); const weeks = q.weeks; const to = isoOf(ordOf(from) + weeks * 7 - 1);
    if (q.siteId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND org_project_id = ?').get(q.siteId, s.org_project_id)) fail([{ field: 'siteId', message: 'Choose a site of this project' }]);
    if (q.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(q.locationId, s.org_project_id)) fail([{ field: 'locationId', message: 'Choose a location of this project' }]);
    const where = ["a.schedule_id = ?", 'a.deleted_at IS NULL', "a.act_type IN ('TASK', 'MILESTONE')", 'a.actual_finish IS NULL', 'a.es IS NOT NULL', 'a.es <= ?', 'a.ef >= ?']; const args = [s.id, to, from];
    if (q.locationId) { where.push('a.location_id IN (WITH RECURSIVE t(id) AS (SELECT ? UNION SELECT l.id FROM proj_locations l JOIN t ON l.parent_id = t.id) SELECT id FROM t)'); args.push(q.locationId); }
    if (q.siteId) { where.push('(l.site_id = ? OR l.id IS NULL)'); args.push(q.siteId); }
    if (q.onlyBlocked) where.push("EXISTS (SELECT 1 FROM plan_constraints c WHERE c.activity_id = a.id AND c.status = 'OPEN' AND c.deleted_at IS NULL)");
    if (q.q) { where.push('(a.code LIKE ? OR a.name LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    const rows = db.prepare(`SELECT a.*, w.code AS wcode, l.code AS lcode, l.name AS lname FROM plan_activities a LEFT JOIN proj_wbs w ON w.id = a.wbs_id LEFT JOIN proj_locations l ON l.id = a.location_id WHERE ${where.join(' AND ')} ORDER BY a.es, COALESCE(w.code, '~'), a.sort_order, a.id LIMIT 2000`).all(...args);
    const ids = rows.map((r) => r.id); const cons = new Map();
    if (ids.length) for (let i = 0; i < ids.length; i += 500) { const part = ids.slice(i, i + 500); for (const c of db.prepare(`SELECT id, activity_id, ctype, description, owner_user, due_date, origin FROM plan_constraints WHERE status = 'OPEN' AND deleted_at IS NULL AND activity_id IN (${part.map(() => '?').join(',')}) ORDER BY due_date`).all(...part)) { if (!cons.has(c.activity_id)) cons.set(c.activity_id, []); cons.get(c.activity_id).push({ id: c.id, type: c.ctype, description: c.description, owner: c.owner_user, dueDate: c.due_date, origin: c.origin, overdue: Boolean(c.due_date) && c.due_date < today }); } }
    const cards = rows.map((a) => { const cs = cons.get(a.id) ?? []; return { id: a.id, code: a.code, name: a.name, type: a.act_type, wbs: a.wcode, location: a.lcode ? `${a.lcode} ${a.lname}` : null, locationId: a.location_id, es: a.es, ef: a.ef, duration: a.duration_days, totalFloat: a.total_float, critical: Boolean(a.is_critical), started: Boolean(a.actual_start), pctComplete: a.pct_complete / 100, week: mondayOf(a.es < from ? from : a.es), constraints: cs, ready: cs.length === 0, rowVersion: a.version }; });
    const cols = Array.from({ length: weeks }, (_, i) => { const w = isoOf(ordOf(from) + i * 7); const mine = cards.filter((c) => c.week === w); return { weekStart: w, weekEnd: isoOf(ordOf(w) + 6), activities: mine.length, ready: mine.filter((c) => c.ready).length, blocked: mine.filter((c) => !c.ready).length }; });
    const sch = { id: s.id, docNo: s.doc_no, versionNo: s.version_no, status: s.status, projectId: s.org_project_id, needsCalc: Boolean(s.needs_calc) };
    const editable = may(actor, 'plan.schedule.edit', s.org_project_id) && ['DRAFT', 'RETURNED'].includes(s.status);
    return { schedule: sch, from, to, weeks, today, columns: cols, activities: cards, summary: { activities: cards.length, ready: cards.filter((c) => c.ready).length, blocked: cards.filter((c) => !c.ready).length, readyPct: cards.length ? Math.round((cards.filter((c) => c.ready).length * 10000) / cards.length) / 100 : null, constraints: cards.reduce((n, c) => n + c.constraints.length, 0), overdue: cards.reduce((n, c) => n + c.constraints.filter((x) => x.overdue).length, 0), critical: cards.filter((c) => c.critical).length },
      can: { detect: may(actor, 'plan.constraint.manage', s.org_project_id), move: editable && may(actor, 'plan.lookahead.view', s.org_project_id), save: may(actor, 'plan.weekly_plan.create', s.org_project_id), plan: may(actor, 'plan.weekly_plan.create', s.org_project_id), addConstraint: may(actor, 'plan.constraint.manage', s.org_project_id) } };
  }
  const laView = (r) => ({ id: r.id, projectId: r.org_project_id, scheduleId: r.schedule_id, siteId: r.la_site_id, locationId: r.location_id, from: r.from_date, to: r.to_date, weeks: r.weeks, generatedAt: r.generated_at, generatedBy: r.generated_by, activities: r.activities_count, ready: r.ready_count, blocked: r.blocked_count, status: r.status });
  const lookaheads = {
    board,
    /** The projects and schedules the person can plan, with the sites and work fronts, for the pickers. */
    options(actor, projectId) {
      const o = orgOf(Number(projectId)); if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.lookahead.view', o.id)) throw notFound('That project does not exist.'); const cur = currentSchedule(actor.companyId, o.id);
      return { projectId: o.id, projectCode: o.code, scheduleId: cur?.id ?? null, schedule: cur ? { id: cur.id, docNo: cur.doc_no, versionNo: cur.version_no, status: cur.status } : null,
        sites: db.prepare("SELECT id, code, name FROM org_sites WHERE org_project_id = ? AND status <> 'INACTIVE' ORDER BY code").all(o.id), locations: db.prepare("SELECT id, code, name, loc_type, parent_id FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL AND loc_status = 'ACTIVE' ORDER BY sort_order, code").all(o.id).map((l) => ({ id: l.id, code: l.code, name: l.name, type: l.loc_type, parentId: l.parent_id })),
        crews: db.prepare('SELECT c.id, c.code, c.name, c.trade, c.crew_site_id AS siteId FROM hr_crews c JOIN org_sites s ON s.id = c.crew_site_id WHERE s.org_project_id = ? AND c.active = 1 ORDER BY c.code').all(o.id) };
    },
    list(actor, scheduleId) { const s = schedule(actor, scheduleId); return { rows: db.prepare('SELECT * FROM plan_lookaheads WHERE schedule_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(s.id).map(laView) }; },
    /** Saves the look-ahead as made now (FR-01): its window and counts; the constraints are worked out first. */
    create(actor, scheduleId, q) {
      const s = schedule(actor, scheduleId, 'plan.weekly_plan.create'); return transaction(db, () => {
        sync(actor.companyId, s.id); const b = board(actor, s.id, q); const id = Number(db.prepare("INSERT INTO plan_lookaheads (company_id, org_project_id, schedule_id, la_site_id, location_id, from_date, to_date, weeks, generated_at, generated_by, activities_count, ready_count, blocked_count, status, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 'api')")
          .run(actor.companyId, s.org_project_id, s.id, q.siteId ?? null, q.locationId ?? null, b.from, b.to, b.weeks, nowIso(), actor.user, b.summary.activities, b.summary.ready, b.summary.blocked, s.org_project_id, actor.user).lastInsertRowid);
        audit(actor, 'plan_lookaheads', id, 'create', actor.companyId, { newValues: { from: b.from, to: b.to, activities: b.summary.activities, blocked: b.summary.blocked } }); return laView(db.prepare('SELECT * FROM plan_lookaheads WHERE id = ?').get(id));
      });
    },
  };

  // ---- FR-04, FR-05, BR-01: the weekly work plan --------------------------------------------------------------------------------------------------------------------------------------
  function wpRow(actor, id, key = 'plan.weekly_plan.view') {
    const r = db.prepare(`SELECT ${WP_COLS} FROM plan_weekly_plans x WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL`).get(rid(id), actor.companyId);
    if (!r || !may(actor, 'plan.weekly_plan.view', r.org_project_id)) throw notFound('That weekly plan does not exist.'); if (key !== 'plan.weekly_plan.view') need(actor, key, 'do that with a weekly plan', r.org_project_id); return r;
  }
  const wpFresh = (id) => db.prepare(`SELECT ${WP_COLS} FROM plan_weekly_plans x WHERE x.id = ?`).get(id);
  const wpEditable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const ppcOf = (done, n) => (n ? Math.round((done * 10000) / n) : null); // percent x 100
  const itemsOf = (planId) => db.prepare('SELECT i.*, a.code AS acode, a.name AS aname, a.es, a.ef, a.actual_finish, c.code AS ccode, c.name AS cname, c.trade, (SELECT COUNT(*) FROM plan_constraints k WHERE k.activity_id = i.activity_id AND k.status = \'OPEN\' AND k.deleted_at IS NULL) AS open_constraints FROM plan_weekly_items i JOIN plan_activities a ON a.id = i.activity_id LEFT JOIN hr_crews c ON c.id = i.crew_id WHERE i.plan_id = ? AND i.deleted_at IS NULL ORDER BY a.es, a.code, i.id').all(planId);
  const itemView = (i) => ({ id: i.id, activityId: i.activity_id, activity: i.acode, activityName: i.aname, es: i.es, ef: i.ef, crewId: i.crew_id, crew: i.ccode ? `${i.ccode} ${i.cname}` : null, trade: i.trade ?? null, uom: i.uom, committedQty: i.committed_qty / 1000, completedQty: i.completed_qty / 1000, completed: Boolean(i.completed), varianceCode: i.variance_code, varianceLabel: i.variance_code ? VARIANCE_CODES[i.variance_code] : null, note: i.note, openConstraints: i.open_constraints, ready: i.open_constraints === 0 });
  function wpView(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const site = r.wp_site_id ? db.prepare('SELECT code, name FROM org_sites WHERE id = ?').get(r.wp_site_id) : null; const can = (k) => may(actor, k, r.org_project_id); const s = schedRow(r.schedule_id);
    const v = { id: r.id, docNo: r.doc_no, docDate: r.doc_date, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, siteId: r.wp_site_id, site: site ? `${site.code} ${site.name}` : null, scheduleId: r.schedule_id, scheduleDocNo: s?.doc_no ?? null, weekStart: r.week_start, weekEnd: isoOf(ordOf(r.week_start) + 6), revisionNo: r.revision_no, parentPlanId: r.parent_plan_id,
      status: r.status, statusLabel: WEEKLY_STATUS[r.status], items: r.items_count, completedCount: r.completed_count, ppc: r.ppc != null ? r.ppc / 100 : (['APPROVED', 'CLOSED'].includes(r.status) && r.items_count ? ppcOf(r.completed_count, r.items_count) / 100 : null), ppcFinal: r.ppc != null, note: r.note, reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, closedAt: r.closed_at, closedBy: r.closed_by, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('plan.weekly_plan.edit') && wpEditable(r), submit: can('plan.weekly_plan.submit') && wpEditable(r) && r.items_count > 0, withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('plan.weekly_plan.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('plan.weekly_plan.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('plan.weekly_plan.amend') && r.status === 'APPROVED' && !db.prepare("SELECT 1 FROM plan_weekly_plans WHERE parent_plan_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id), record: can('plan.weekly_plan.record') && r.status === 'APPROVED', close: can('plan.weekly_plan.record') && r.status === 'APPROVED', print: can('plan.weekly_plan.print'), export: can('plan.weekly_plan.export') } };
    if (detail) { v.lines = itemsOf(r.id).map(itemView); v.variance = varianceBreakdown(v.lines); }
    return v;
  }
  const varianceBreakdown = (lines) => { const m = new Map(); for (const l of lines) if (!l.completed && l.varianceCode) m.set(l.varianceCode, (m.get(l.varianceCode) ?? 0) + 1); return [...m].map(([code, n]) => ({ code, label: VARIANCE_CODES[code], n })).sort((a, b) => b.n - a.n); };
  const wpScope = (actor) => { const f = authz.scopeFilter(actor, 'plan.weekly_plan.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const listRow = (actor, x) => { const v = wpView(actor, x); return { id: v.id, docNo: v.docNo, project: v.projectCode, projectId: v.projectId, site: v.site, weekStart: v.weekStart, revisionNo: v.revisionNo, status: v.status, statusLabel: v.statusLabel, items: v.items, ppc: v.ppc }; };
  /** Checks the commitments of a plan against the schedule and the crews of the project; returns rows ready to write. */
  function checkItems(actor, s, items, weekStart, siteId) {
    const p = []; const seen = new Set(); const week = isoOf(ordOf(weekStart) + 6);
    const out = items.map((x, i) => {
      const a = db.prepare('SELECT * FROM plan_activities WHERE id = ? AND schedule_id = ? AND deleted_at IS NULL').get(x.activityId, s.id);
      if (!a) { p.push({ field: `items.${i}.activityId`, message: 'Choose an activity of the schedule' }); return null; }
      if (a.actual_finish) p.push({ field: `items.${i}.activityId`, message: `${a.code} is finished` }); if (!['TASK', 'MILESTONE'].includes(a.act_type)) p.push({ field: `items.${i}.activityId`, message: `${a.code} is a ${lower(a.act_type)}: commit the activities under it` });
      if (a.es && (a.es > week || a.ef < weekStart)) p.push({ field: `items.${i}.activityId`, message: `${a.code} is planned ${a.es} to ${a.ef}, outside the week` });
      let crew = null; if (x.crewId) { crew = db.prepare('SELECT c.*, s.org_project_id AS pid FROM hr_crews c JOIN org_sites s ON s.id = c.crew_site_id WHERE c.id = ? AND c.company_id = ? AND c.active = 1').get(x.crewId, actor.companyId); if (!crew || crew.pid !== s.org_project_id || (siteId && crew.crew_site_id !== siteId)) { p.push({ field: `items.${i}.crewId`, message: 'Choose a crew of this project' }); crew = null; } }
      const k = `${x.activityId}|${x.crewId ?? 0}`; if (seen.has(k)) p.push({ field: `items.${i}.activityId`, message: 'This activity is committed twice for the same crew' }); seen.add(k);
      return { ...x, uom: x.uom ?? a.uom ?? null, crewId: crew?.id ?? null };
    });
    fail(p); return out;
  }
  const writeItems = (actor, r, items) => {
    const now = nowIso(); db.prepare('UPDATE plan_weekly_items SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE plan_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id);
    const ins = db.prepare("INSERT INTO plan_weekly_items (company_id, plan_id, activity_id, crew_id, committed_qty, completed_qty, uom, completed, variance_code, note, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')");
    for (const x of items) { const c = Math.round(x.committedQty * 1000); const d = Math.round((x.completedQty ?? 0) * 1000); ins.run(r.company_id, r.id, x.activityId, x.crewId, c, d, x.uom, d >= c && c > 0 ? 1 : 0, x.varianceCode ?? null, x.note ?? null, r.org_project_id, actor.user); }
    recount(r.id);
  };
  const recount = (planId) => { const c = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(completed), 0) AS d FROM plan_weekly_items WHERE plan_id = ? AND deleted_at IS NULL').get(planId); db.prepare('UPDATE plan_weekly_plans SET items_count = ?, completed_count = ? WHERE id = ?').run(c.n, c.d, planId); };
  const siteOk = (s, siteId) => { if (siteId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND org_project_id = ?').get(siteId, s.org_project_id)) fail([{ field: 'siteId', message: 'Choose a site of this project' }]); };

  /** FR-05: the commitments spread over the working days of the week between the dates of each activity. */
  function dailyOf(r) {
    const s = schedRow(r.schedule_id); const cal = calOf(s); const days = Array.from({ length: 7 }, (_, i) => isoOf(ordOf(r.week_start) + i)); const total = Object.fromEntries(days.map((d) => [d, 0])); const lines = [];
    for (const i of itemsOf(r.id)) {
      const from = i.es && i.es > r.week_start ? i.es : r.week_start; const to = i.ef && i.ef < days[6] ? i.ef : days[6]; let work = days.filter((d) => d >= from && d <= to && cal.isWork(ordOf(d))); if (!work.length) work = days.filter((d) => cal.isWork(ordOf(d))).slice(0, 1);
      const q = i.committed_qty; const base = Math.floor(q / work.length); const by = Object.fromEntries(days.map((d) => [d, 0])); work.forEach((d, k) => { by[d] = (k === work.length - 1 ? q - base * (work.length - 1) : base) / 1000; total[d] += by[d]; });
      lines.push({ itemId: i.id, activityId: i.activity_id, activity: i.acode, activityName: i.aname, crewId: i.crew_id, crew: i.ccode ? `${i.ccode} ${i.cname}` : null, uom: i.uom, byDay: by, total: q / 1000 });
    }
    return { planId: r.id, docNo: r.doc_no, weekStart: r.week_start, days: days.map((d) => ({ date: d, working: cal.isWork(ordOf(d)), total: Math.round(total[d] * 1000) / 1000 })), lines };
  }
  const weekly = {
    list(actor, query) { if (!authz.check(actor, 'plan.weekly_plan.view').allowed) throw forbidden('You may not see weekly plans (permission plan.weekly_plan.view).'); const sc = wpScope(actor); return runList(db, weeklyList, parseListRequest(weeklyList, query), { select: WP_COLS, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => listRow(actor, x) }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'plan.weekly_plan.export').allowed) throw forbidden('You may not export weekly plans (permission plan.weekly_plan.export).'); const sc = wpScope(actor); const opts = { select: WP_COLS, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: weeklyList.label, permission: 'plan.weekly_plan.export', personal: false, columns: ['docNo', 'project', 'weekStart', 'revisionNo', 'status', 'items', 'ppc'].map((k) => ({ key: k, label: weeklyList.columns[k]?.label ?? k, type: 'text' })),
        rows: () => runList(db, weeklyList, req, { ...opts, limit: null, map: (x) => { const v = listRow(actor, x); return { docNo: v.docNo, project: v.project, weekStart: v.weekStart, revisionNo: String(v.revisionNo), status: v.statusLabel, items: String(v.items), ppc: v.ppc == null ? '' : `${v.ppc} %` }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All weekly plans you may see'], count: () => countList(db, weeklyList, req, opts) };
    },
    get(actor, id) { return wpView(actor, wpRow(actor, id), { detail: true }); },
    create(actor, b) {
      const s = schedule(actor, b.scheduleId, 'plan.weekly_plan.create'); const p = []; if (!isMonday(b.weekStart)) p.push({ field: 'weekStart', message: 'A week starts on a Monday' }); fail(p); siteOk(s, b.siteId);
      if (['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(s.status)) throw unprocessable(`${s.doc_no} is ${lower(s.status)}: plan the week on the schedule in use.`);
      const dup = db.prepare("SELECT doc_no FROM plan_weekly_plans WHERE org_project_id = ? AND COALESCE(wp_site_id, 0) = ? AND week_start = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED')").get(s.org_project_id, b.siteId ?? 0, b.weekStart); if (dup) throw conflict(`${dup.doc_no} is the plan of that week${b.siteId ? ' and site' : ''}: change it, or revise it if it is approved.`);
      const items = checkItems(actor, s, b.items, b.weekStart, b.siteId);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO plan_weekly_plans (company_id, doc_no, doc_date, org_project_id, wp_site_id, schedule_id, week_start, revision_no, status, note, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'DRAFT', ?, ?, ?, ?, 'api')")
          .run(actor.companyId, numberFor(actor), todayIST(), s.org_project_id, b.siteId ?? null, s.id, b.weekStart, b.note ?? null, actor.user, s.org_project_id, actor.user).lastInsertRowid);
        writeItems(actor, { id, company_id: actor.companyId, org_project_id: s.org_project_id }, items); audit(actor, 'plan_weekly_plans', id, 'create', actor.companyId, { newValues: { week: b.weekStart, items: items.length } }); return weekly.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = wpRow(actor, id, 'plan.weekly_plan.edit'); if (!wpEditable(r)) throw conflict(`${r.doc_no} is ${lower(WEEKLY_STATUS[r.status])}: ${r.status === 'APPROVED' ? 'an approved plan is changed by a revision' : 'it is not changed now'}.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this plan; reload it.');
      const s = schedRow(r.schedule_id); const items = b.items ? checkItems(actor, s, b.items, r.week_start, r.wp_site_id) : null;
      return transaction(db, () => { db.prepare('UPDATE plan_weekly_plans SET note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('note' in b ? b.note : r.note, actor.user, nowIso(), r.id); if (items) writeItems(actor, r, items); audit(actor, 'plan_weekly_plans', r.id, 'update', r.company_id, { newValues: { items: items?.length ?? undefined, note: b.note } }); return weekly.get(actor, r.id); });
    },
    remove(actor, id) { const r = wpRow(actor, id, 'plan.weekly_plan.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { const now = nowIso(); db.prepare('UPDATE plan_weekly_items SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE plan_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE plan_weekly_plans SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'plan_weekly_plans', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    /** FR-03: a plan is not sent with a commitment on an activity that still has an open constraint. */
    submit(actor, id) {
      const r = wpRow(actor, id, 'plan.weekly_plan.submit'); if (!wpEditable(r)) throw unprocessable('Only a draft or a returned plan is sent for approval.'); if (!r.items_count) throw unprocessable('The plan has no commitments.');
      sync(actor.companyId, r.schedule_id); const blocked = itemsOf(r.id).filter((i) => i.open_constraints > 0);
      if (blocked.length) throw Object.assign(unprocessable(`Not ready: ${blocked.map((i) => i.acode).join(', ')} ${blocked.length === 1 ? 'has' : 'have'} open constraints. Clear them, waive them with a reason, or take the commitment out.`), { details: blocked.map((i) => ({ field: 'items', message: `${i.acode} has ${i.open_constraints} open constraint(s)` })) });
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, items: r.items_count, weekStart: r.week_start };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: WEEKLY_DOC, docId: String(r.id), comment: `${r.doc_no} week of ${r.week_start}`.slice(0, 300), context: ctx }); db.prepare('UPDATE plan_weekly_plans SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE plan_weekly_plans SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'plan_weekly_plans', r.id, 'submit', r.company_id, { newValues: { items: r.items_count } }); return weekly.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = wpRow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a plan waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return weekly.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = wpRow(actor, id, 'plan.weekly_plan.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a plan that is not decided is cancelled; an approved one is changed by a revision.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE plan_weekly_plans SET status = 'CANCELLED', reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'plan_weekly_plans', r.id, 'cancel', r.company_id, { reason }); return weekly.get(actor, r.id); });
    },
    /** An approved plan is changed by a revision: a draft copy of its commitments that replaces it when approved. */
    amend(actor, id, { reason }) {
      const r = wpRow(actor, id, 'plan.weekly_plan.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved plan is revised.'); if (db.prepare("SELECT 1 FROM plan_weekly_plans WHERE parent_plan_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('A revision of this plan is open.');
      return transaction(db, () => {
        const nid = Number(db.prepare("INSERT INTO plan_weekly_plans (company_id, doc_no, doc_date, org_project_id, wp_site_id, schedule_id, week_start, revision_no, parent_plan_id, status, note, reason, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 'plan_weekly_plan', ?)")
          .run(r.company_id, numberFor(actor), todayIST(), r.org_project_id, r.wp_site_id, r.schedule_id, r.week_start, r.revision_no + 1, r.id, r.note, reason, actor.user, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
        writeItems(actor, { id: nid, company_id: r.company_id, org_project_id: r.org_project_id }, itemsOf(r.id).map((i) => ({ activityId: i.activity_id, crewId: i.crew_id, committedQty: i.committed_qty / 1000, completedQty: 0, uom: i.uom, note: i.note })));
        audit(actor, 'plan_weekly_plans', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return weekly.get(actor, nid);
      });
    },
    history(actor, id) { const r = wpRow(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'plan_weekly_plans' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    daily(actor, id) { return dailyOf(wpRow(actor, id)); },
    print(actor, id) {
      const r = wpRow(actor, id, 'plan.weekly_plan.print'); const v = wpView(actor, r, { detail: true }); const d = dailyOf(r); const tr = (c, h = false) => `<tr>${c.map((x) => `<${h ? 'th' : 'td'}>${esc(x)}</${h ? 'th' : 'td'}>`).join('')}</tr>`; audit(actor, 'plan_weekly_plans', r.id, 'print', r.company_id);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${['APPROVED', 'CLOSED'].includes(v.status) ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED PLAN</strong></p>`}<h1>Weekly work plan ${esc(v.docNo)} · ${esc(v.projectCode)} ${esc(v.projectName)}</h1>`
        + `<p>Week ${esc(v.weekStart)} to ${esc(v.weekEnd)}${v.site ? ` · site ${esc(v.site)}` : ''} · revision ${v.revisionNo} · ${v.items} commitments${v.ppc != null ? ` · PPC ${v.ppc} %` : ''}</p>${v.note ? `<p>${esc(v.note)}</p>` : ''}`
        + `<table border="1" cellpadding="3">${tr(['Activity', 'Crew', 'Unit', 'Committed', 'Completed', 'Variance', ...d.days.map((x) => x.date.slice(5))], true)}${v.lines.map((l) => { const dl = d.lines.find((x) => x.itemId === l.id); return tr([`${l.activity} ${l.activityName}`, l.crew ?? '', l.uom ?? '', l.committedQty, l.completedQty, l.completed ? '' : (l.varianceLabel ?? ''), ...d.days.map((x) => dl?.byDay[x.date] || '')]); }).join('')}</table></body></html>`;
    },
    /** FR-04: what was done, recorded on the approved plan. The commitment is completed when the completed quantity reaches the committed one; a plan that is not approved has nothing to record. */
    record(actor, id, { items }) {
      const r = wpRow(actor, id, 'plan.weekly_plan.record'); if (r.status !== 'APPROVED') throw conflict(`${r.doc_no} is ${lower(WEEKLY_STATUS[r.status])}: ${r.status === 'CLOSED' ? 'a closed week is not changed' : 'record the week once the plan is approved'}.`);
      const mine = new Map(db.prepare('SELECT * FROM plan_weekly_items WHERE plan_id = ? AND deleted_at IS NULL').all(r.id).map((i) => [i.id, i])); const p = [];
      items.forEach((x, k) => { if (!mine.has(x.itemId)) p.push({ field: `items.${k}.itemId`, message: 'Choose a commitment of this plan' }); });
      fail(p);
      return transaction(db, () => {
        const upd = db.prepare('UPDATE plan_weekly_items SET completed_qty = ?, completed = ?, variance_code = ?, note = COALESCE(?, note), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?');
        for (const x of items) { const i = mine.get(x.itemId); const d = Math.round(x.completedQty * 1000); const done = d >= i.committed_qty && i.committed_qty > 0; upd.run(d, done ? 1 : 0, done ? null : (x.varianceCode ?? null), x.note ?? null, actor.user, nowIso(), i.id); }
        recount(r.id); audit(actor, 'plan_weekly_plans', r.id, 'record', r.company_id, { newValues: { items: items.length } }); return weekly.get(actor, r.id);
      });
    },
    /** BR-01: PPC is fixed when the week is closed; every commitment not completed has its variance code. */
    close(actor, id) {
      const r = wpRow(actor, id, 'plan.weekly_plan.record'); if (r.status !== 'APPROVED') throw conflict(`${r.doc_no} is ${lower(WEEKLY_STATUS[r.status])}: only an approved plan is closed.`); if (r.week_start > todayIST()) throw unprocessable(`The week starts on ${r.week_start}: it is closed when it has been worked.`);
      const missing = itemsOf(r.id).filter((i) => !i.completed && !i.variance_code); if (missing.length) throw Object.assign(unprocessable(`Give the reason for what was not completed: ${missing.map((i) => i.acode).join(', ')}.`), { details: missing.map((i) => ({ field: 'items', message: `${i.acode} was not completed: give the variance code` })) });
      return transaction(db, () => {
        recount(r.id); const f = wpFresh(r.id); const ppc = ppcOf(f.completed_count, f.items_count); const now = nowIso();
        db.prepare("UPDATE plan_weekly_plans SET status = 'CLOSED', ppc = ?, closed_at = ?, closed_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(ppc, now, actor.user, actor.user, now, r.id);
        const lines = itemsOf(r.id); audit(actor, 'plan_weekly_plans', r.id, 'close', r.company_id, { newValues: { ppc: ppc == null ? null : ppc / 100, items: f.items_count, completed: f.completed_count } });
        event('plan.weekly_plan.closed', actor, 'plan_weekly_plan', r.id, r, { planId: r.id, projectId: r.org_project_id, siteId: r.wp_site_id, docNo: r.doc_no, weekStart: r.week_start, items: f.items_count, completed: f.completed_count, ppc: ppc == null ? null : ppc / 100, variance: varianceBreakdown(lines.map(itemView)).map((v) => ({ code: v.code, n: v.n })) });
        return weekly.get(actor, r.id);
      });
    },
    decide(instance, actor, outcome, comment) {
      const r = wpFresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        transaction(db, () => {
          if (r.parent_plan_id) db.prepare("UPDATE plan_weekly_plans SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_plan_id);
          db.prepare("UPDATE plan_weekly_plans SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); audit(actor, 'plan_weekly_plans', r.id, 'approve', r.company_id);
          const d = dailyOf(r); event('plan.weekly_plan.approved', actor, 'plan_weekly_plan', r.id, r, { planId: r.id, projectId: r.org_project_id, siteId: r.wp_site_id, scheduleId: r.schedule_id, docNo: r.doc_no, weekStart: r.week_start, revisionNo: r.revision_no, supersedes: r.parent_plan_id ?? null, items: r.items_count,
            daily: d.lines.flatMap((l) => d.days.filter((x) => l.byDay[x.date] > 0).map((x) => ({ date: x.date, activityId: l.activityId, activity: l.activity, crewId: l.crewId, qty: l.byDay[x.date], uom: l.uom }))) });
          notify(r.company_id, 'plan.weekly_plan.approved', [r.requested_by], r.doc_no, `week of ${r.week_start}`, `Weekly plan ${r.doc_no} for the week of ${r.week_start} is approved: record what is done during the week.`, `/plan/weekly?id=${r.id}`, r.id);
        });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE plan_weekly_plans SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'plan_weekly_plans', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'plan.weekly_plan.rejected', [r.requested_by], r.doc_no, `week of ${r.week_start}`, `Weekly plan ${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/plan/weekly?id=${r.id}`, r.id);
    },
  };

  // ---- the report: PPC trend and variance reasons (BR-01) ------------------------------------------------------------------------------------------------------------------------
  function ppcReport(actor, q) {
    const o = orgOf(q.projectId); if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.weekly_plan.view', o.id)) throw notFound('That project does not exist.');
    const where = ["x.org_project_id = ?", "x.status = 'CLOSED'", 'x.deleted_at IS NULL']; const args = [o.id]; if (q.siteId) { where.push('x.wp_site_id = ?'); args.push(q.siteId); } if (q.from) { where.push('x.week_start >= ?'); args.push(q.from); } if (q.to) { where.push('x.week_start <= ?'); args.push(q.to); }
    const plans = db.prepare(`SELECT x.id, x.doc_no, x.week_start, x.items_count, x.completed_count, x.wp_site_id FROM plan_weekly_plans x WHERE ${where.join(' AND ')} ORDER BY x.week_start, x.id`).all(...args); const byWeek = new Map();
    for (const p of plans) { const w = byWeek.get(p.week_start) ?? { weekStart: p.week_start, plans: 0, items: 0, completed: 0 }; w.plans += 1; w.items += p.items_count; w.completed += p.completed_count; byWeek.set(p.week_start, w); }
    const weeks = [...byWeek.values()].map((w) => ({ ...w, ppc: w.items ? Math.round((w.completed * 10000) / w.items) / 100 : null })); let cum = 0; let cumItems = 0; for (const w of weeks) { cum += w.completed; cumItems += w.items; w.cumulativePpc = cumItems ? Math.round((cum * 10000) / cumItems) / 100 : null; }
    const ids = plans.map((p) => p.id); const reasons = new Map(); let missed = 0;
    for (let i = 0; i < ids.length; i += 500) { const part = ids.slice(i, i + 500); for (const r of db.prepare(`SELECT variance_code AS code, COUNT(*) AS n FROM plan_weekly_items WHERE plan_id IN (${part.map(() => '?').join(',')}) AND deleted_at IS NULL AND completed = 0 GROUP BY variance_code`).all(...part)) { reasons.set(r.code ?? 'OTHER', (reasons.get(r.code ?? 'OTHER') ?? 0) + r.n); missed += r.n; } }
    let run = 0; const variance = [...reasons].map(([code, n]) => ({ code, label: VARIANCE_CODES[code], n })).sort((a, b) => b.n - a.n).map((v) => { run += v.n; return { ...v, pct: Math.round((v.n * 10000) / missed) / 100, cumulativePct: Math.round((run * 10000) / missed) / 100 }; });
    const items = weeks.reduce((n, w) => n + w.items, 0); const completed = weeks.reduce((n, w) => n + w.completed, 0); const t = weeks.at(-1);
    return { projectId: o.id, projectCode: o.code, siteId: q.siteId ?? null, weeks, variance, totals: { weeks: weeks.length, plans: plans.length, items, completed, missed, ppc: items ? Math.round((completed * 10000) / items) / 100 : null, last: t?.ppc ?? null }, can: { export: may(actor, 'plan.weekly_plan.export', o.id) } };
  }
  function ppcExport(actor, q) {
    const r = ppcReport(actor, q); need(actor, 'plan.weekly_plan.export', 'export the PPC report', r.projectId);
    const columns = [{ key: 'weekStart', label: 'Week from', type: 'text' }, { key: 'plans', label: 'Plans', type: 'number' }, { key: 'items', label: 'Commitments', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' }, { key: 'ppc', label: 'PPC %', type: 'number' }, { key: 'cumulativePpc', label: 'Cumulative PPC %', type: 'number' }, { key: 'reason', label: 'Variance reason', type: 'text' }, { key: 'n', label: 'Not completed', type: 'number' }, { key: 'pct', label: 'Share %', type: 'number' }];
    const rows = [...r.weeks.map((w) => ({ ...w })), ...r.variance.map((v) => ({ reason: v.label, n: v.n, pct: v.pct })), { weekStart: 'Total', plans: r.totals.plans, items: r.totals.items, completed: r.totals.completed, ppc: r.totals.ppc ?? '', n: r.totals.missed }];
    const footer = [`PPC trend and variance reasons of ${r.projectCode}`, `PPC = completed commitments / commitments, of the weeks closed${q.from || q.to ? ` from ${q.from ?? '…'} to ${q.to ?? '…'}` : ''}.`, `Generated by ${actor.user} on ${todayIST()}`]; const name = `ppc-${slug(r.projectCode)}-${todayIST()}`;
    audit(actor, 'plan_weekly_plans', 0, 'export', actor.companyId, { newValues: { report: 'ppc', project: r.projectCode, format: q.format } });
    if (q.format === 'csv') return { buffer: toCsv({ columns, rows, footer }), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: r.weeks.length };
    if (q.format === 'pdf') return { buffer: toPdf({ columns, rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: r.weeks.length };
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'PPC' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: r.weeks.length };
  }
  /** What 14.01 reads: the daily plan of the approved weekly plans of a project for a date. */
  function dailyPlan(actor, projectId, date) {
    const o = orgOf(Number(projectId)); if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.weekly_plan.view', o.id)) throw notFound('That project does not exist.');
    const plans = db.prepare("SELECT x.id FROM plan_weekly_plans x WHERE x.org_project_id = ? AND x.deleted_at IS NULL AND x.status IN ('APPROVED', 'CLOSED') AND x.week_start <= ? AND x.week_start >= ?").all(o.id, date, isoOf(ordOf(date) - 6)); const rows = [];
    for (const p of plans) { const d = dailyOf(wpFresh(p.id)); for (const l of d.lines) if (l.byDay[date] > 0) rows.push({ planId: p.id, docNo: d.docNo, itemId: l.itemId, activityId: l.activityId, activity: l.activity, activityName: l.activityName, crewId: l.crewId, crew: l.crew, qty: l.byDay[date], uom: l.uom }); }
    return { projectId: o.id, date, rows };
  }
  return { constraints, lookaheads, weekly, ppcReport, ppcExport, dailyPlan, sync, onEvent, weeklyDecide: weekly.decide };
}
