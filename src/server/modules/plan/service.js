import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { calculate, findCycle, isoOf, makeCalendar, ordOf } from './cpm.js';

// The schedule core (part 13.01). A project has one working schedule in versions (baselines come in 13.03): activities on WBS nodes and locations with their type, duration, calendar, constraint, quantity, BOQ split and person
// responsible; FS/SS/FF/SF links with lags (a loop is refused with its path, BR-02); calendars of working days and holidays; the CPM pass that only the server runs (BR-01, FR-06); and the progress at a data date (FR-07).
// A schedule is approved by the project controls manager and then locked: its logic changes only in a new version; its progress keeps being updated. Calendars and templates are put in force by a second person.
export const SCHEDULE_DOC = 'PLAN_SCHEDULE';
export const SCHEDULE_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved (logic locked)', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded by a new version' };
export const ACT_TYPES = { TASK: 'Task', MILESTONE: 'Milestone', LOE: 'Level of effort', SUMMARY: 'WBS summary' };
export const CONSTRAINTS = { NONE: 'None', SNET: 'Start no earlier than', FNLT: 'Finish no later than' };
const CAL_STATUS = { DRAFT: 'Draft', ACTIVE: 'In force', CANCELLED: 'Cancelled' };
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const same = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cell = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s; };
const csvOf = (rows) => rows.map((r) => r.map((v) => `"${cell(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');

export const scheduleList = defineList({
  code: 'plan.schedules', label: 'Schedules', permission: 'plan.schedule.view',
  from: 'plan_schedules x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.name', 'p.code', 'p.name'], defaultSort: '-docDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Schedule no.' }, name: { sql: 'x.name', type: 'text', label: 'Name' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    docDate: { sql: 'x.doc_date', type: 'date', label: 'Date' }, versionNo: { sql: 'x.version_no', type: 'number', label: 'Version' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(SCHEDULE_STATUS) },
    startDate: { sql: 'x.start_date', type: 'date', label: 'Start' }, finishDate: { sql: 'x.finish_date', type: 'date', label: 'Finish' }, dataDate: { sql: 'x.data_date', type: 'date', label: 'Data date' }, activities: { sql: 'x.activities_count', type: 'number', label: 'Activities' }, critical: { sql: 'x.critical_count', type: 'number', label: 'Critical' },
  },
});

export function createPlanService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const companyWide = (actor, key) => authz.check(actor, key, { companyId: actor.companyId }).allowed;
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const event = (type, actor, id, companyId, projectId, data) => publishEvent(db, { type, entity: 'plan_schedule', entityId: id, actorId: actor.user, companyId, projectId, data });
  const notify = (companyId, code, users, ref, subject, detail, link, sourceId) => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId }); } catch { /* saved anyway */ } };
  const system = (companyId) => ({ user: 'system', companyId, roles: ['SYSTEM'] });
  const numberFor = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: SCHEDULE_DOC, actor: actor.user, refType: 'plan_schedules' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM plan_schedules WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1; return `SCH/${String(n).padStart(5, '0')}`;
  };
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  function project(actor, projectId, key = 'plan.schedule.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.schedule.view', o.id)) throw notFound('That project does not exist.');
    if (key !== 'plan.schedule.view') need(actor, key, 'do that for this project', o.id);
    return o;
  }

  // ---- calendars (FR-05) --------------------------------------------------------------------------------------------------------------------------------------------
  const calRow = (actor, id) => { const r = db.prepare('SELECT * FROM plan_calendars WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That calendar does not exist.'); return r; };
  const holidaysOf = (hcId) => (hcId ? db.prepare('SELECT holiday_date FROM core_holidays WHERE calendar_id = ? AND deleted_at IS NULL').all(hcId).map((h) => h.holiday_date) : []);
  /** The working calendar of a row: its week, the holidays of its holiday calendar (01.03) and its own exceptions. */
  const calendarOf = (r) => makeCalendar({ workWeek: r.work_week, holidays: holidaysOf(r.holiday_calendar_id), exceptions: json(r.exceptions_json, []) });
  const calView = (actor, r) => {
    const hc = r.holiday_calendar_id ? db.prepare('SELECT code, name FROM core_holiday_calendars WHERE id = ?').get(r.holiday_calendar_id) : null; const o = r.org_project_id ? orgOf(r.org_project_id) : null;
    const canManage = r.org_project_id ? may(actor, 'plan.calendar.manage', r.org_project_id) : companyWide(actor, 'plan.calendar.manage'); const canApprove = r.org_project_id ? may(actor, 'plan.calendar.approve', r.org_project_id) : companyWide(actor, 'plan.calendar.approve');
    return { id: r.id, code: r.code, name: r.name, projectId: r.org_project_id, project: o ? `${o.code} ${o.name}` : null, workWeek: r.work_week, hoursPerDay: r.hours_per_day, holidayCalendarId: r.holiday_calendar_id, holidayCalendar: hc ? `${hc.code} ${hc.name}` : null, holidays: holidaysOf(r.holiday_calendar_id).length, exceptions: json(r.exceptions_json, []), status: r.status, statusLabel: CAL_STATUS[r.status], reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, rowVersion: r.version, can: { edit: canManage && r.status === 'DRAFT', activate: canApprove && r.status === 'DRAFT' && !same(r.requested_by, actor.user), cancel: (canManage && r.status === 'DRAFT') || (canApprove && r.status === 'ACTIVE') } };
  };
  const calCheck = (actor, b) => {
    const p = [];
    if (b.holidayCalendarId && !db.prepare('SELECT 1 FROM core_holiday_calendars WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.holidayCalendarId, actor.companyId)) p.push({ field: 'holidayCalendarId', message: 'Choose a holiday calendar of the company' });
    const seen = new Set(); for (const [i, e] of (b.exceptions ?? []).entries()) { if (seen.has(e.date)) p.push({ field: `exceptions.${i}.date`, message: 'A date is given twice' }); seen.add(e.date); }
    return p;
  };
  const calendars = {
    list(actor, { projectId = null } = {}) {
      if (!authz.check(actor, 'plan.calendar.view').allowed) throw forbidden('You may not see the work calendars (permission plan.calendar.view).');
      const rows = db.prepare(`SELECT * FROM plan_calendars WHERE company_id = ? AND deleted_at IS NULL${projectId ? ' AND (org_project_id IS NULL OR org_project_id = ?)' : ''} ORDER BY org_project_id IS NOT NULL, code, id DESC`).all(actor.companyId, ...(projectId ? [projectId] : []))
        .filter((r) => r.org_project_id == null || may(actor, 'plan.calendar.view', r.org_project_id));
      const holidayCalendars = db.prepare('SELECT id, code, name FROM core_holiday_calendars WHERE company_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId);
      return { rows: rows.map((r) => calView(actor, r)), holidayCalendars, inForce: rows.filter((r) => r.status === 'ACTIVE').length };
    },
    get(actor, id) { if (!authz.check(actor, 'plan.calendar.view').allowed) throw forbidden('You may not see the work calendars (permission plan.calendar.view).'); return calView(actor, calRow(actor, id)); },
    create(actor, b) {
      if (b.projectId) project(actor, b.projectId, 'plan.schedule.view');
      if (b.projectId ? !may(actor, 'plan.calendar.manage', b.projectId) : !companyWide(actor, 'plan.calendar.manage')) throw forbidden('You may not draft this calendar (permission plan.calendar.manage).');
      fail(calCheck(actor, b));
      if (db.prepare("SELECT 1 FROM plan_calendars WHERE company_id = ? AND COALESCE(org_project_id, 0) = ? AND code = ? COLLATE NOCASE AND status IN ('DRAFT', 'ACTIVE') AND deleted_at IS NULL").get(actor.companyId, b.projectId ?? 0, b.code)) throw conflict('A calendar of that code exists.');
      const id = Number(db.prepare("INSERT INTO plan_calendars (company_id, org_project_id, code, name, work_week, hours_per_day, holiday_calendar_id, exceptions_json, status, reason, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
        .run(actor.companyId, b.projectId ?? null, b.code, b.name, b.workWeek, b.hoursPerDay, b.holidayCalendarId ?? null, JSON.stringify(b.exceptions ?? []), b.reason, actor.user, b.projectId ?? null, actor.user).lastInsertRowid);
      audit(actor, 'plan_calendars', id, 'create', actor.companyId, { reason: b.reason, newValues: { code: b.code, workWeek: b.workWeek } }); return calendars.get(actor, id);
    },
    update(actor, id, b) {
      const r = calRow(actor, id); const v = calView(actor, r); if (!v.can.edit) throw r.status === 'DRAFT' ? forbidden('You may not change this calendar (permission plan.calendar.manage).') : conflict('A calendar in force is locked: cancel it and draft another.');
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this calendar; reload it.'); fail(calCheck(actor, b));
      db.prepare('UPDATE plan_calendars SET name = ?, work_week = ?, hours_per_day = ?, holiday_calendar_id = ?, exceptions_json = ?, reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.name ?? r.name, b.workWeek ?? r.work_week, b.hoursPerDay ?? r.hours_per_day, 'holidayCalendarId' in b ? b.holidayCalendarId : r.holiday_calendar_id, b.exceptions ? JSON.stringify(b.exceptions) : r.exceptions_json, b.reason ?? r.reason, actor.user, nowIso(), r.id);
      audit(actor, 'plan_calendars', r.id, 'update', actor.companyId, { reason: b.reason }); return calendars.get(actor, r.id);
    },
    /** Maker-checker: a second person puts a calendar in force. */
    activate(actor, id) {
      const r = calRow(actor, id); if (r.status !== 'DRAFT') throw unprocessable('Only a draft calendar is put in force.');
      if (!(r.org_project_id ? may(actor, 'plan.calendar.approve', r.org_project_id) : companyWide(actor, 'plan.calendar.approve'))) throw forbidden('You may not put a calendar in force (permission plan.calendar.approve).');
      if (same(r.requested_by, actor.user)) throw forbidden('The person who drafted a calendar does not put it in force (segregation of duties).');
      const now = nowIso(); db.prepare("UPDATE plan_calendars SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
      audit(actor, 'plan_calendars', r.id, 'activate', actor.companyId); return calendars.get(actor, r.id);
    },
    cancel(actor, id, { reason }) {
      const r = calRow(actor, id); const v = calView(actor, r); if (!v.can.cancel) throw ['DRAFT', 'ACTIVE'].includes(r.status) ? forbidden('You may not cancel this calendar.') : unprocessable('This calendar is cancelled already.');
      if (r.status === 'ACTIVE' && db.prepare("SELECT 1 FROM plan_schedules WHERE calendar_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL UNION SELECT 1 FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE a.calendar_id = ? AND a.deleted_at IS NULL AND s.status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')").get(r.id, r.id)) throw unprocessable('A schedule or activity in use runs on this calendar: change it first.');
      db.prepare("UPDATE plan_calendars SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'plan_calendars', r.id, 'cancel', actor.companyId, { reason }); return calendars.get(actor, r.id);
    },
    days(actor, id, { from, to }) {
      const r = calRow(actor, id); if (!authz.check(actor, 'plan.calendar.view').allowed) throw forbidden('You may not see the work calendars.');
      const c = calendarOf(r); const out = []; const hol = new Set(holidaysOf(r.holiday_calendar_id)); const a = ordOf(from); const b = ordOf(to); if (b - a > 400) throw badRequest('Ask for at most 400 days at a time', [{ field: 'to', message: 'At most 400 days' }]);
      for (let o = a; o <= b; o += 1) out.push({ date: isoOf(o), working: c.isWork(o), holiday: hol.has(isoOf(o)) });
      return { calendarId: r.id, from, to, days: out, working: out.filter((d) => d.working).length };
    },
    history(actor, id) { const r = calRow(actor, id); return { audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'plan_calendars' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
  };
  const usableCalendar = (actor, calId, projectId) => { const r = db.prepare("SELECT * FROM plan_calendars WHERE id = ? AND company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND (org_project_id IS NULL OR org_project_id = ?)").get(calId, actor.companyId, projectId); return r ?? null; };

  // ---- templates (FR-03) ------------------------------------------------------------------------------------------------------------------------------------------------
  const tplView = (actor, r) => ({ id: r.id, code: r.code, name: r.name, target: r.target, steps: json(r.steps_json, []), chainStep: r.chain_step, status: r.status, statusLabel: CAL_STATUS[r.status], system: r.company_id == null, requestedBy: r.requested_by, approvedBy: r.approved_by, can: { activate: r.company_id != null && r.status === 'DRAFT' && companyWide(actor, 'plan.template.approve') && !same(r.requested_by, actor.user), cancel: r.company_id != null && r.status !== 'CANCELLED' && (companyWide(actor, 'plan.template.manage') || companyWide(actor, 'plan.template.approve')) } });
  const templates = {
    list(actor) { if (!authz.check(actor, 'plan.schedule.view').allowed) throw forbidden('You may not see the schedule templates.'); return { rows: db.prepare("SELECT * FROM plan_templates WHERE (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL AND status <> 'CANCELLED' ORDER BY company_id IS NOT NULL, code").all(actor.companyId).map((r) => tplView(actor, r)) }; },
    create(actor, b) {
      if (!companyWide(actor, 'plan.template.manage')) throw forbidden('You may not draft a schedule template (permission plan.template.manage).');
      const keys = new Set(); const p = [];
      b.steps.forEach((s, i) => { if (keys.has(s.key)) p.push({ field: `steps.${i}.key`, message: 'A key is used twice' }); if (s.after && !keys.has(s.after)) p.push({ field: `steps.${i}.after`, message: 'A step follows an earlier step of the template' }); keys.add(s.key); });
      if (b.chainStep && !keys.has(b.chainStep)) p.push({ field: 'chainStep', message: 'The chaining step is a step of the template' }); fail(p);
      if (db.prepare("SELECT 1 FROM plan_templates WHERE (company_id = ? OR company_id IS NULL) AND code = ? COLLATE NOCASE AND status IN ('DRAFT', 'ACTIVE') AND deleted_at IS NULL").get(actor.companyId, b.code)) throw conflict('A template of that code exists.');
      const id = Number(db.prepare("INSERT INTO plan_templates (company_id, code, name, target, steps_json, chain_step, status, reason, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(actor.companyId, b.code, b.name, b.target, JSON.stringify(b.steps), b.chainStep, b.reason, actor.user, actor.user).lastInsertRowid);
      audit(actor, 'plan_templates', id, 'create', actor.companyId, { reason: b.reason }); return tplView(actor, db.prepare('SELECT * FROM plan_templates WHERE id = ?').get(id));
    },
    activate(actor, id) {
      const r = db.prepare('SELECT * FROM plan_templates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That template does not exist.');
      if (!companyWide(actor, 'plan.template.approve')) throw forbidden('You may not put a template in force (permission plan.template.approve).'); if (r.status !== 'DRAFT') throw unprocessable('Only a draft template is put in force.');
      if (same(r.requested_by, actor.user)) throw forbidden('The person who drafted a template does not put it in force (segregation of duties).');
      db.prepare("UPDATE plan_templates SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), actor.user, nowIso(), r.id); audit(actor, 'plan_templates', r.id, 'activate', actor.companyId);
      return tplView(actor, db.prepare('SELECT * FROM plan_templates WHERE id = ?').get(r.id));
    },
    cancel(actor, id, { reason }) {
      const r = db.prepare('SELECT * FROM plan_templates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That template does not exist.');
      if (!tplView(actor, r).can.cancel) throw forbidden('You may not cancel this template.');
      db.prepare("UPDATE plan_templates SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'plan_templates', r.id, 'cancel', actor.companyId, { reason });
      return tplView(actor, db.prepare('SELECT * FROM plan_templates WHERE id = ?').get(r.id));
    },
  };

  // ---- schedules (FR-01) ------------------------------------------------------------------------------------------------------------------------------------------------
  const fresh = (id) => db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(id);
  function row(actor, id, key = 'plan.schedule.view') {
    const r = db.prepare('SELECT * FROM plan_schedules WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'plan.schedule.view', r.org_project_id)) throw notFound('That schedule does not exist.');
    if (key !== 'plan.schedule.view') need(actor, key, 'do that with a schedule', r.org_project_id);
    return r;
  }
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(`${r.doc_no} is ${SCHEDULE_STATUS[r.status].toLowerCase()}: its logic is changed in a new version.`); };
  const openOf = (r) => db.prepare("SELECT doc_no FROM plan_schedules WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND id <> ? AND deleted_at IS NULL").get(r.org_project_id, r.id);
  const dirty = (scheduleId) => db.prepare('UPDATE plan_schedules SET needs_calc = 1 WHERE id = ?').run(scheduleId);
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const cal = db.prepare('SELECT id, code, name FROM plan_calendars WHERE id = ?').get(r.calendar_id); const can = (k) => may(actor, k, r.org_project_id);
    const v = {
      id: r.id, docNo: r.doc_no, docDate: r.doc_date, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, name: r.name, versionType: r.version_type, versionNo: r.version_no, parentScheduleId: r.parent_schedule_id,
      calendarId: r.calendar_id, calendar: cal ? `${cal.code} ${cal.name}` : null, startDate: r.start_date, dataDate: r.data_date, finishDate: r.finish_date, status: r.status, statusLabel: SCHEDULE_STATUS[r.status], activities: r.activities_count, critical: r.critical_count,
      needsCalc: Boolean(r.needs_calc), calculatedAt: r.calculated_at, calcMs: r.calc_ms, reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, lockedAt: r.locked_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: {
        edit: can('plan.schedule.edit') && editable(r), submit: can('plan.schedule.submit') && editable(r) && r.activities_count > 0, withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('plan.schedule.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status),
        delete: can('plan.schedule.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, amend: can('plan.schedule.amend') && ['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status) && !openOf(r), calculate: (can('plan.schedule.edit') && editable(r)) || (can('plan.schedule.progress') && ['APPROVED', 'DRAFT', 'RETURNED'].includes(r.status)),
        progress: can('plan.schedule.progress') && ['DRAFT', 'RETURNED', 'APPROVED'].includes(r.status), print: can('plan.schedule.print'), export: can('plan.schedule.export'),
      },
    };
    if (detail) { const x = db.prepare("SELECT SUM(act_type = 'MILESTONE') AS m, SUM(actual_finish IS NOT NULL) AS done, SUM(actual_start IS NOT NULL AND actual_finish IS NULL) AS wip, SUM(total_float < 0) AS neg, (SELECT COUNT(*) FROM plan_dependencies d WHERE d.schedule_id = ? AND d.deleted_at IS NULL) AS links FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL").get(r.id, r.id); Object.assign(v, { milestones: x.m ?? 0, done: x.done ?? 0, inProgress: x.wip ?? 0, negativeFloat: x.neg ?? 0, links: x.links ?? 0, openVersion: openOf(r)?.doc_no ?? null }); }
    return v;
  }
  const recount = (id) => { const c = db.prepare('SELECT COUNT(*) AS n, SUM(is_critical) AS k FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').get(id); db.prepare('UPDATE plan_schedules SET activities_count = ?, critical_count = ? WHERE id = ?').run(c.n, c.k ?? 0, id); };
  const scheduleScope = (actor) => { const f = authz.scopeFilter(actor, 'plan.schedule.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };

  // ---- activities (FR-02) and links (FR-04) ------------------------------------------------------------------------------------------------------------------------
  const actRow = (actor, id, key = 'plan.schedule.view') => {
    const a = db.prepare('SELECT * FROM plan_activities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!a) throw notFound('That activity does not exist.');
    const s = row(actor, a.schedule_id, key); return { a, s };
  };
  const wbsOk = (projectId, id) => (id ? db.prepare("SELECT id, code, name FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL").get(id, projectId) : null);
  const locOk = (projectId, id) => (id ? db.prepare("SELECT id, code, name FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL").get(id, projectId) : null);
  function actCheck(actor, s, b, existing = null) {
    const p = []; const t = b.type ?? existing?.act_type ?? 'TASK';
    if ('wbsId' in b && b.wbsId && !wbsOk(s.org_project_id, b.wbsId)) p.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
    if ('locationId' in b && b.locationId && !locOk(s.org_project_id, b.locationId)) p.push({ field: 'locationId', message: 'Choose a location of this project' });
    if ('calendarId' in b && b.calendarId && !usableCalendar(actor, b.calendarId, s.org_project_id)) p.push({ field: 'calendarId', message: 'Choose a calendar in force' });
    const ct = b.constraintType ?? existing?.constraint_type ?? 'NONE'; const cd = 'constraintDate' in b ? b.constraintDate : existing?.constraint_date ?? null;
    if (ct !== 'NONE' && !cd) p.push({ field: 'constraintDate', message: 'A constraint has a date' });
    const d = b.duration ?? existing?.duration_days ?? 0;
    if (t === 'MILESTONE' && d !== 0) p.push({ field: 'duration', message: 'A milestone has no duration' });
    if (t === 'TASK' && d === 0 && ('duration' in b || 'type' in b)) p.push({ field: 'duration', message: 'A task takes at least a day (or make it a milestone)' });
    if (t === 'SUMMARY' && !(b.wbsId ?? existing?.wbs_id)) p.push({ field: 'wbsId', message: 'A WBS summary sits on a WBS node' });
    return { problems: p, constraintType: ct, constraintDate: ct === 'NONE' ? null : cd };
  }
  const nextCode = (scheduleId) => { const n = db.prepare("SELECT COUNT(*) AS n FROM plan_activities WHERE schedule_id = ?").get(scheduleId).n; let k = (n + 1) * 10; while (db.prepare('SELECT 1 FROM plan_activities WHERE schedule_id = ? AND code = ? AND deleted_at IS NULL').get(scheduleId, `A${k}`)) k += 10; return `A${k}`; };
  const insAct = (actor, s, b, extra = {}) => {
    const code = b.code ?? nextCode(s.id);
    if (db.prepare('SELECT 1 FROM plan_activities WHERE schedule_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(s.id, code)) throw conflict(`Activity ${code} exists in this schedule.`);
    const sort = (db.prepare('SELECT MAX(sort_order) AS m FROM plan_activities WHERE schedule_id = ?').get(s.id).m ?? 0) + 10;
    return Number(db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, wbs_id, location_id, act_type, duration_days, calendar_id, constraint_type, constraint_date, qty, uom, responsible_user, sort_order, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(s.company_id, s.id, code, b.name, b.wbsId ?? null, b.locationId ?? null, b.type ?? 'TASK', b.type === 'MILESTONE' ? 0 : (b.duration ?? 1), b.calendarId ?? null, b.constraintType ?? 'NONE', (b.constraintType ?? 'NONE') === 'NONE' ? null : b.constraintDate, Math.round((b.qty ?? 0) * 1000), b.uom ?? null, b.responsible ?? null, sort, s.org_project_id, actor.user, extra.sourceType ?? 'api', extra.sourceId ?? null).lastInsertRowid);
  };
  const linksOf = (scheduleId) => db.prepare('SELECT id, pred_id AS pred, succ_id AS succ, dep_type AS type, lag_days AS lag FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL').all(scheduleId);
  const codesOf = (ids) => ids.map((i) => db.prepare('SELECT code FROM plan_activities WHERE id = ?').get(i)?.code ?? String(i));
  const actView = (a, wbs, loc, cal, preds, succs, boqN) => ({
    id: a.id, code: a.code, name: a.name, wbsId: a.wbs_id, wbs: wbs ? `${wbs.code} ${wbs.name}` : null, wbsCode: wbs?.code ?? null, locationId: a.location_id, location: loc ? `${loc.code} ${loc.name}` : null, type: a.act_type, typeLabel: ACT_TYPES[a.act_type], duration: a.duration_days,
    calendarId: a.calendar_id, calendar: cal ?? null, constraintType: a.constraint_type, constraintDate: a.constraint_date, qty: a.qty / 1000, uom: a.uom, es: a.es, ef: a.ef, ls: a.ls, lf: a.lf, totalFloat: a.total_float, freeFloat: a.free_float, critical: Boolean(a.is_critical),
    actualStart: a.actual_start, actualFinish: a.actual_finish, pctComplete: a.pct_complete / 100, pctSource: a.pct_source, remainingDays: a.remaining_days, responsible: a.responsible_user, predecessors: preds ?? [], successors: succs ?? [], boqLines: boqN ?? 0, rowVersion: a.version,
    delayed: a.total_float != null && a.total_float < 0, status: a.actual_finish ? 'DONE' : a.actual_start ? 'IN_PROGRESS' : 'NOT_STARTED',
  });
  function listActivities(actor, scheduleId, q) {
    const s = row(actor, scheduleId); const where = ['a.schedule_id = ?', 'a.deleted_at IS NULL']; const args = [s.id];
    if (q.filter === 'critical') where.push('a.is_critical = 1'); if (q.filter === 'delayed') where.push('a.total_float < 0'); if (q.filter === 'open') where.push('a.actual_finish IS NULL');
    if (q.wbsId) { where.push('a.wbs_id IN (WITH RECURSIVE t(id) AS (SELECT ? UNION SELECT w.id FROM proj_wbs w JOIN t ON w.parent_id = t.id) SELECT id FROM t)'); args.push(q.wbsId); }
    if (q.q) { where.push('(a.code LIKE ? OR a.name LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    const sql = `FROM plan_activities a LEFT JOIN proj_wbs w ON w.id = a.wbs_id WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
    const rows = db.prepare(`SELECT a.*, w.code AS wcode, w.name AS wname, l.code AS lcode, l.name AS lname, c.code AS ccode ${sql.replace('LEFT JOIN proj_wbs w ON w.id = a.wbs_id', 'LEFT JOIN proj_wbs w ON w.id = a.wbs_id LEFT JOIN proj_locations l ON l.id = a.location_id LEFT JOIN plan_calendars c ON c.id = a.calendar_id')} ORDER BY COALESCE(w.code, '~'), a.sort_order, a.id LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
    const ids = rows.map((r) => r.id); const preds = new Map(); const succs = new Map(); const boq = new Map();
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      for (const d of db.prepare(`SELECT d.id, d.pred_id, d.succ_id, d.dep_type, d.lag_days, p.code AS pcode, s.code AS scode FROM plan_dependencies d JOIN plan_activities p ON p.id = d.pred_id JOIN plan_activities s ON s.id = d.succ_id WHERE d.deleted_at IS NULL AND (d.succ_id IN (${ph}) OR d.pred_id IN (${ph}))`).all(...ids, ...ids)) {
        if (preds.has(d.succ_id) || ids.includes(d.succ_id)) { const x = preds.get(d.succ_id) ?? []; x.push({ id: d.id, activityId: d.pred_id, code: d.pcode, type: d.dep_type, lag: d.lag_days }); preds.set(d.succ_id, x); }
        if (ids.includes(d.pred_id)) { const x = succs.get(d.pred_id) ?? []; x.push({ id: d.id, activityId: d.succ_id, code: d.scode, type: d.dep_type, lag: d.lag_days }); succs.set(d.pred_id, x); }
      }
      for (const b of db.prepare(`SELECT activity_id, COUNT(*) AS n FROM plan_activity_boq WHERE deleted_at IS NULL AND activity_id IN (${ph}) GROUP BY activity_id`).all(...ids)) boq.set(b.activity_id, b.n);
    }
    const out = rows.map((r) => actView(r, r.wcode ? { code: r.wcode, name: r.wname } : null, r.lcode ? { code: r.lcode, name: r.lname } : null, r.ccode, preds.get(r.id), succs.get(r.id), boq.get(r.id)));
    const groups = []; for (const a of out) { const k = a.wbsCode ?? '—'; const g = groups.at(-1); if (g?.key === k) g.count += 1; else groups.push({ key: k, label: a.wbs ?? 'No WBS node', count: 1 }); }
    return { scheduleId: s.id, total, page: q.page, pageSize: q.pageSize, rows: out, groups, counts: db.prepare("SELECT COUNT(*) AS n, SUM(is_critical) AS critical, SUM(total_float < 0) AS delayed, SUM(actual_finish IS NULL) AS open FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL").get(s.id) };
  }
  const activities = {
    list: listActivities,
    get(actor, id) { const { a } = actRow(actor, id); const r = listActivities(actor, a.schedule_id, { filter: 'all', q: a.code, page: 1, pageSize: 1000, wbsId: null }).rows.find((x) => x.id === a.id); r.boq = db.prepare('SELECT b.id, b.boq_line_id, b.qty, l.item_code, l.description, l.uom, l.qty AS line_qty FROM plan_activity_boq b JOIN proj_boq_lines l ON l.id = b.boq_line_id WHERE b.activity_id = ? AND b.deleted_at IS NULL ORDER BY l.item_code').all(a.id).map((x) => ({ boqLineId: x.boq_line_id, itemCode: x.item_code, description: x.description, uom: x.uom, qty: x.qty / 1000, lineQty: x.line_qty / 1000 })); return r; },
    create(actor, scheduleId, b) {
      const s = row(actor, scheduleId, 'plan.schedule.edit'); mustEdit(s); const c = actCheck(actor, s, b); fail(c.problems);
      return transaction(db, () => { const id = insAct(actor, s, { ...b, constraintType: c.constraintType, constraintDate: c.constraintDate }); dirty(s.id); recount(s.id); audit(actor, 'plan_activities', id, 'create', s.company_id, { newValues: { schedule: s.doc_no, code: b.code } }); return activities.get(actor, id); });
    },
    update(actor, id, b) {
      const { a, s } = actRow(actor, id, 'plan.schedule.edit'); mustEdit(s); if (b.rowVersion && b.rowVersion !== a.version) throw conflict('Someone changed this activity; reload it.');
      const c = actCheck(actor, s, b, a); fail(c.problems);
      const map = { name: 'name', wbsId: 'wbs_id', locationId: 'location_id', type: 'act_type', duration: 'duration_days', calendarId: 'calendar_id', uom: 'uom', responsible: 'responsible_user' }; const sets = []; const vals = [];
      for (const [k, col] of Object.entries(map)) if (k in b) { sets.push(`${col} = ?`); vals.push(b[k]); }
      if ('qty' in b) { sets.push('qty = ?'); vals.push(Math.round(b.qty * 1000)); }
      if ((b.type ?? a.act_type) === 'MILESTONE') { sets.push('duration_days = 0'); }
      sets.push('constraint_type = ?', 'constraint_date = ?'); vals.push(c.constraintType, c.constraintDate);
      return transaction(db, () => { db.prepare(`UPDATE plan_activities SET ${[...sets, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), a.id); dirty(s.id); audit(actor, 'plan_activities', a.id, 'update', s.company_id, { newValues: b }); return activities.get(actor, a.id); });
    },
    /** Bulk edit of the grid: the same change to many activities of one schedule, each checked. */
    bulk(actor, scheduleId, { ids, set }) {
      const s = row(actor, scheduleId, 'plan.schedule.edit'); mustEdit(s); const problems = []; const rows = ids.map((i) => db.prepare('SELECT * FROM plan_activities WHERE id = ? AND schedule_id = ? AND deleted_at IS NULL').get(i, s.id));
      rows.forEach((a, i) => { if (!a) { problems.push({ field: `ids.${i}`, message: 'Not an activity of this schedule' }); return; } const c = actCheck(actor, s, set, a); for (const p of c.problems) problems.push({ field: `${a.code}.${p.field}`, message: `${a.code}: ${p.message}` }); });
      fail(problems);
      return transaction(db, () => { for (const a of rows) activities.update(actor, a.id, set); audit(actor, 'plan_schedules', s.id, 'bulk_edit', s.company_id, { newValues: { count: rows.length, set } }); return { updated: rows.length }; });
    },
    remove(actor, id) {
      const { a, s } = actRow(actor, id, 'plan.schedule.edit'); mustEdit(s); const now = nowIso();
      transaction(db, () => { db.prepare('UPDATE plan_dependencies SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE (pred_id = ? OR succ_id = ?) AND deleted_at IS NULL').run(now, actor.user, a.id, a.id); db.prepare('UPDATE plan_activity_boq SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE activity_id = ? AND deleted_at IS NULL').run(now, actor.user, a.id); db.prepare('UPDATE plan_activities SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, a.id); dirty(s.id); recount(s.id); audit(actor, 'plan_activities', a.id, 'delete', s.company_id); });
      return { id: a.id, deleted: true };
    },
    /** FR-02: the BOQ lines of the contract BOQ an activity carries; across the activities of a schedule a line is never split beyond its quantity. */
    setBoq(actor, id, { lines }) {
      const { a, s } = actRow(actor, id, 'plan.schedule.edit'); mustEdit(s); const p = []; const seen = new Set();
      lines.forEach((l, i) => {
        const line = db.prepare("SELECT l.id, l.qty, l.item_code FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.id = ? AND v.org_project_id = ? AND l.deleted_at IS NULL AND l.line_kind = 'ITEM'").get(l.boqLineId, s.org_project_id);
        if (!line) { p.push({ field: `lines.${i}.boqLineId`, message: 'Choose an item line of a BOQ of this project' }); return; }
        if (seen.has(l.boqLineId)) p.push({ field: `lines.${i}.boqLineId`, message: 'A line is given twice' }); seen.add(l.boqLineId);
        const others = db.prepare('SELECT COALESCE(SUM(b.qty), 0) AS q FROM plan_activity_boq b JOIN plan_activities a ON a.id = b.activity_id WHERE b.boq_line_id = ? AND a.schedule_id = ? AND a.id <> ? AND b.deleted_at IS NULL AND a.deleted_at IS NULL').get(l.boqLineId, s.id, a.id).q;
        if (others + Math.round(l.qty * 1000) > line.qty) p.push({ field: `lines.${i}.qty`, message: `Item ${line.item_code}: ${(others / 1000)} is split to other activities; at most ${(line.qty - others) / 1000} is left of ${line.qty / 1000}` });
      });
      fail(p);
      return transaction(db, () => {
        const now = nowIso(); db.prepare('UPDATE plan_activity_boq SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE activity_id = ? AND deleted_at IS NULL').run(now, actor.user, a.id);
        for (const l of lines) db.prepare("INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'api')").run(s.company_id, a.id, l.boqLineId, Math.round(l.qty * 1000), s.org_project_id, actor.user);
        audit(actor, 'plan_activities', a.id, 'boq', s.company_id, { newValues: { lines: lines.length } }); return activities.get(actor, a.id);
      });
    },
  };
  const links = {
    /** FR-04, BR-02: a link between two activities of the schedule; a link that closes a loop is refused with the loop. */
    create(actor, scheduleId, b) {
      const s = row(actor, scheduleId, 'plan.schedule.edit'); mustEdit(s);
      const p = db.prepare('SELECT id, code FROM plan_activities WHERE id = ? AND schedule_id = ? AND deleted_at IS NULL').get(b.predId, s.id); const q = db.prepare('SELECT id, code FROM plan_activities WHERE id = ? AND schedule_id = ? AND deleted_at IS NULL').get(b.succId, s.id);
      const problems = []; if (!p) problems.push({ field: 'predId', message: 'Choose an activity of this schedule' }); if (!q) problems.push({ field: 'succId', message: 'Choose an activity of this schedule' }); if (p && q && p.id === q.id) problems.push({ field: 'succId', message: 'An activity does not follow itself' }); fail(problems);
      if (db.prepare('SELECT 1 FROM plan_dependencies WHERE schedule_id = ? AND pred_id = ? AND succ_id = ? AND deleted_at IS NULL').get(s.id, p.id, q.id)) throw conflict(`${p.code} → ${q.code} is linked already.`);
      const ids = db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id).map((x) => x.id);
      const cycle = findCycle(ids, [...linksOf(s.id), { pred: p.id, succ: q.id }]);
      if (cycle) throw Object.assign(unprocessable(`This link closes a loop: ${codesOf(cycle).join(' → ')}. Remove one of these links first (BR-02).`), { details: [{ field: 'succId', message: `Loop: ${codesOf(cycle).join(' → ')}` }] });
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(s.company_id, s.id, p.id, q.id, b.type, b.lag, s.org_project_id, actor.user).lastInsertRowid);
        dirty(s.id); audit(actor, 'plan_dependencies', id, 'create', s.company_id, { newValues: { link: `${p.code} ${b.type}${b.lag ? (b.lag > 0 ? `+${b.lag}` : b.lag) : ''} ${q.code}` } });
        return { id, predId: p.id, pred: p.code, succId: q.id, succ: q.code, type: b.type, lag: b.lag };
      });
    },
    remove(actor, id) {
      const d = db.prepare('SELECT * FROM plan_dependencies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!d) throw notFound('That link does not exist.');
      const s = row(actor, d.schedule_id, 'plan.schedule.edit'); mustEdit(s);
      db.prepare('UPDATE plan_dependencies SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, d.id); dirty(s.id); audit(actor, 'plan_dependencies', d.id, 'delete', s.company_id); return { id: d.id, deleted: true };
    },
  };

  // ---- the CPM pass (FR-06, BR-01) -----------------------------------------------------------------------------------------------------------------------------------
  function runCalc(actor, s) {
    const started = performance.now();
    const acts = db.prepare('SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id); if (!acts.length) throw unprocessable('The schedule has no activities to calculate.');
    const calRowS = db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(s.calendar_id); const cal = calendarOf(calRowS);
    const cals = new Map(); for (const a of acts) if (a.calendar_id && a.calendar_id !== s.calendar_id && !cals.has(a.calendar_id)) cals.set(a.calendar_id, calendarOf(db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(a.calendar_id)));
    const wbsPath = new Map(); const pathOf = (w) => { if (!w) return null; if (wbsPath.has(w)) return wbsPath.get(w); const r = db.prepare('SELECT parent_id FROM proj_wbs WHERE id = ?').get(w); const p = r?.parent_id ? [...(pathOf(r.parent_id) ?? []), w] : [w]; wbsPath.set(w, p); return p; };
    const res = calculate({
      start: s.start_date, dataDate: s.data_date, calendar: cal, calendars: cals, links: linksOf(s.id),
      activities: acts.map((a) => ({ id: a.id, type: a.act_type, duration: a.duration_days, calendarId: a.calendar_id && a.calendar_id !== s.calendar_id ? a.calendar_id : null, constraintType: a.constraint_type, constraintDate: a.constraint_date, actualStart: a.actual_start, actualFinish: a.actual_finish, remaining: a.remaining_days, pct: a.pct_complete, wbsPath: pathOf(a.wbs_id) })),
    });
    if (!res.ok) throw Object.assign(unprocessable(`The logic has a loop: ${codesOf(res.cycle).join(' → ')} (BR-02). Remove one of its links.`), { details: [{ field: 'links', message: `Loop: ${codesOf(res.cycle).join(' → ')}` }] });
    const upd = db.prepare('UPDATE plan_activities SET es = ?, ef = ?, ls = ?, lf = ?, total_float = ?, free_float = ?, is_critical = ? WHERE id = ?');
    transaction(db, () => {
      for (const a of acts) { const x = res.results.get(a.id); upd.run(x.es, x.ef, x.ls, x.lf, x.totalFloat, x.freeFloat, x.critical ? 1 : 0, a.id); }
      const ms = Math.round(performance.now() - started); const now = nowIso();
      db.prepare('UPDATE plan_schedules SET finish_date = ?, needs_calc = 0, calculated_at = ?, calc_ms = ? WHERE id = ?').run(res.finish, now, ms, s.id); recount(s.id);
      const c = fresh(s.id); event('plan.schedule.calculated', actor, s.id, s.company_id, s.org_project_id, { scheduleId: s.id, projectId: s.org_project_id, docNo: s.doc_no, versionNo: s.version_no, status: s.status, start: s.start_date, finish: res.finish, dataDate: s.data_date, activities: c.activities_count, critical: c.critical_count, ms });
    });
    return { ...view(actor, fresh(s.id), { detail: true }), finishUnits: res.finishUnits };
  }

  const schedules = {
    list(actor, query) { if (!authz.check(actor, 'plan.schedule.view').allowed) throw forbidden('You may not see schedules (permission plan.schedule.view).'); const sc = scheduleScope(actor); return runList(db, scheduleList, parseListRequest(scheduleList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, name: v.name, project: v.projectCode, projectId: v.projectId, docDate: v.docDate, versionNo: v.versionNo, status: v.status, statusLabel: v.statusLabel, startDate: v.startDate, finishDate: v.finishDate, dataDate: v.dataDate, activities: v.activities, critical: v.critical }; } }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'plan.schedule.export').allowed) throw forbidden('You may not export schedules (permission plan.schedule.export).'); const sc = scheduleScope(actor); const opts = { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: scheduleList.label, permission: 'plan.schedule.export', personal: false, columns: ['docNo', 'project', 'name', 'versionNo', 'status', 'startDate', 'finishDate', 'dataDate', 'activities', 'critical'].map((k) => ({ key: k, label: scheduleList.columns[k]?.label ?? k, type: 'text' })), rows: () => runList(db, scheduleList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, project: v.projectCode, name: v.name, versionNo: String(v.versionNo), status: v.statusLabel, startDate: v.startDate, finishDate: v.finishDate ?? '', dataDate: v.dataDate ?? '', activities: String(v.activities), critical: String(v.critical) }; } }).data, describe: (r) => [r.q ? `Search: ${r.q}` : 'All schedules you may see'], count: () => countList(db, scheduleList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    /** What the pages offer for a project: its schedules, calendars in force, WBS nodes, locations and the templates. */
    options(actor, projectId) {
      const o = project(actor, projectId);
      return { projectId: o.id, projectCode: o.code, schedules: db.prepare('SELECT id, doc_no, name, version_no, status FROM plan_schedules WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY version_no DESC').all(o.id).map((x) => ({ id: x.id, docNo: x.doc_no, name: x.name, versionNo: x.version_no, status: x.status })),
        calendars: db.prepare("SELECT id, code, name, org_project_id FROM plan_calendars WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND (org_project_id IS NULL OR org_project_id = ?) ORDER BY code").all(actor.companyId, o.id).map((c) => ({ id: c.id, code: c.code, name: c.name, project: c.org_project_id != null })),
        wbs: db.prepare("SELECT id, code, name, parent_id, level FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL AND wbs_status = 'ACTIVE' ORDER BY code").all(o.id).map((w) => ({ id: w.id, code: w.code, name: w.name, parentId: w.parent_id, level: w.level })),
        locations: db.prepare("SELECT id, code, name, loc_type, parent_id FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL AND loc_status = 'ACTIVE' ORDER BY sort_order, code").all(o.id).map((l) => ({ id: l.id, code: l.code, name: l.name, type: l.loc_type, parentId: l.parent_id })),
        templates: templates.list(actor).rows.filter((t) => t.status === 'ACTIVE').map((t) => ({ id: t.id, code: t.code, name: t.name, target: t.target, steps: t.steps.length })) };
    },
    projects(actor) { if (!authz.check(actor, 'plan.schedule.view').allowed) throw forbidden('You may not see schedules (permission plan.schedule.view).'); const f = authz.scopeFilter(actor, 'plan.schedule.view', { project: 'p.id' }); return db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = :c AND p.deleted_at IS NULL AND ${f.sql} ORDER BY p.code`).all({ c: actor.companyId, ...(f.params ?? {}) }).map((p) => ({ id: p.id, code: p.code, name: p.name })); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'plan.schedule.create');
      if (!usableCalendar(actor, b.calendarId, o.id)) fail([{ field: 'calendarId', message: 'Choose a calendar in force for this project' }]);
      if (b.dataDate && b.dataDate < b.startDate) fail([{ field: 'dataDate', message: 'The data date is not before the start' }]);
      const ap = db.prepare("SELECT doc_no FROM plan_schedules WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(o.id); if (ap) throw conflict(`${ap.doc_no} is the approved schedule of ${o.code}: it is changed by a new version (amend).`);
      const op = db.prepare("SELECT doc_no FROM plan_schedules WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(o.id); if (op) throw conflict(`${op.doc_no} is open for ${o.code}: finish or cancel it first.`);
      return transaction(db, () => {
        const vno = (db.prepare('SELECT MAX(version_no) AS n FROM plan_schedules WHERE org_project_id = ? AND deleted_at IS NULL').get(o.id).n ?? 0) + 1;
        const id = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, version_type, version_no, calendar_id, start_date, data_date, status, reason, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'WORKING', ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
          .run(actor.companyId, numberFor(actor), todayIST(), o.id, b.name, vno, b.calendarId, b.startDate, b.dataDate ?? null, b.reason ?? null, actor.user, o.id, actor.user).lastInsertRowid);
        audit(actor, 'plan_schedules', id, 'create', actor.companyId, { newValues: { project: o.code, start: b.startDate } }); return schedules.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'plan.schedule.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this schedule; reload it.');
      if (b.calendarId && !usableCalendar(actor, b.calendarId, r.org_project_id)) fail([{ field: 'calendarId', message: 'Choose a calendar in force for this project' }]);
      const sets = []; const vals = []; for (const [k, c] of [['name', 'name'], ['calendarId', 'calendar_id'], ['startDate', 'start_date'], ['dataDate', 'data_date'], ['reason', 'reason']]) if (k in b) { sets.push(`${c} = ?`); vals.push(b[k]); }
      db.prepare(`UPDATE plan_schedules SET ${[...sets, 'needs_calc = 1', 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id); audit(actor, 'plan_schedules', r.id, 'update', r.company_id, { newValues: b }); return schedules.get(actor, r.id);
    },
    remove(actor, id) {
      const r = row(actor, id, 'plan.schedule.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.');
      transaction(db, () => { const now = nowIso(); for (const t of ['plan_dependencies', 'plan_activities']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE schedule_id = ? AND deleted_at IS NULL`).run(now, actor.user, r.id); db.prepare('UPDATE plan_schedules SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'plan_schedules', r.id, 'delete', r.company_id); });
      return { id: r.id, deleted: true };
    },
    calculate(actor, id) { const r = row(actor, id); const v = view(actor, r); if (!v.can.calculate) throw (['DRAFT', 'RETURNED', 'APPROVED'].includes(r.status) ? forbidden('You may not calculate this schedule.') : conflict(`${r.doc_no} is ${SCHEDULE_STATUS[r.status].toLowerCase()}: it is not calculated now.`)); return runCalc(actor, r); },
    /** FR-07: the progress at a data date (actual dates, per cent, remaining duration), then a new pass. The logic of an approved schedule stays locked; its progress is updated. */
    progress(actor, id, b) { return applyProgress(actor, row(actor, id, 'plan.schedule.progress'), b, 'MANUAL'); },
  };
  /** FR-07 itself, for the API (after its permission check) and for the DPR events (14.05). */
  function applyProgress(actor, r, b, source) {
    {
      if (!['DRAFT', 'RETURNED', 'APPROVED'].includes(r.status)) throw conflict(`${r.doc_no} is ${SCHEDULE_STATUS[r.status].toLowerCase()}: its progress is not updated.`);
      if (b.dataDate < r.start_date) fail([{ field: 'dataDate', message: 'The data date is not before the start of the schedule' }]);
      const p = []; const rows = b.rows.map((x, i) => { const a = db.prepare('SELECT * FROM plan_activities WHERE id = ? AND schedule_id = ? AND deleted_at IS NULL').get(x.activityId, r.id); if (!a) p.push({ field: `rows.${i}.activityId`, message: 'Not an activity of this schedule' }); return { x, a, i }; });
      for (const { x, a, i } of rows) {
        if (!a) continue; const as = 'actualStart' in x ? x.actualStart : a.actual_start; const af = 'actualFinish' in x ? x.actualFinish : a.actual_finish; const f = (field, message) => p.push({ field: `rows.${i}.${field}`, message: `${a.code}: ${message}` });
        if (as && as > b.dataDate) f('actualStart', 'an actual start is not after the data date'); if (af && af > b.dataDate) f('actualFinish', 'an actual finish is not after the data date');
        if (af && !as) f('actualStart', 'a finished activity has started'); if (af && as && af < as) f('actualFinish', 'it does not finish before it starts');
        if (x.pctComplete != null && x.pctComplete > 0 && !as) f('pctComplete', 'progress needs an actual start'); if (x.pctComplete === 100 && !af) f('actualFinish', '100 % needs an actual finish');
        if (['LOE', 'SUMMARY'].includes(a.act_type)) f('activityId', 'a LOE or summary activity takes its dates from others');
      }
      fail(p);
      return transaction(db, () => {
        for (const { x, a } of rows) {
          const af = 'actualFinish' in x ? x.actualFinish : a.actual_finish; const as = 'actualStart' in x ? x.actualStart : a.actual_start;
          const pct = af ? 10000 : x.pctComplete != null ? Math.round(x.pctComplete * 100) : (as ? a.pct_complete : 0); const rem = af ? 0 : x.remainingDays != null ? x.remainingDays : (as ? Math.max(0, Math.round((a.duration_days * (10000 - pct)) / 10000)) : null);
          db.prepare('UPDATE plan_activities SET actual_start = ?, actual_finish = ?, pct_complete = ?, pct_source = ?, remaining_days = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(as ?? null, af ?? null, pct, source, rem, actor.user, nowIso(), a.id);
        }
        db.prepare('UPDATE plan_schedules SET data_date = ?, needs_calc = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.dataDate, actor.user, nowIso(), r.id);
        audit(actor, 'plan_schedules', r.id, 'progress', r.company_id, { newValues: { dataDate: b.dataDate, rows: rows.length, source } });
        const out = runCalc(actor, fresh(r.id));
        event('plan.progress.updated', actor, r.id, r.company_id, r.org_project_id, { scheduleId: r.id, projectId: r.org_project_id, dataDate: b.dataDate, source, finish: out.finishDate, activities: rows.map(({ a }) => { const n = db.prepare('SELECT * FROM plan_activities WHERE id = ?').get(a.id); return { activityId: n.id, code: n.code, actualStart: n.actual_start, actualFinish: n.actual_finish, pctComplete: n.pct_complete / 100, remainingDays: n.remaining_days }; }) });
        return out;
      });
    }
  }
  Object.assign(schedules, {
    submit(actor, id) {
      const r = row(actor, id, 'plan.schedule.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned schedule is sent for approval.');
      if (!r.activities_count) throw unprocessable('The schedule has no activities.'); const calc = /** @type {any} */ (runCalc(actor, r));
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, activities: calc.activities, negativeFloat: calc.negativeFloat };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: SCHEDULE_DOC, docId: String(r.id), comment: `${r.doc_no} ${r.name}`.slice(0, 300), context: ctx }); db.prepare('UPDATE plan_schedules SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE plan_schedules SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'plan_schedules', r.id, 'submit', r.company_id, { newValues: { finish: calc.finishDate } }); return schedules.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a schedule waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return schedules.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'plan.schedule.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a schedule that is not decided is cancelled; an approved one is changed by a new version.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE plan_schedules SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'plan_schedules', r.id, 'cancel', r.company_id, { reason }); return schedules.get(actor, r.id); });
    },
    /** A new working version: a copy of the activities, links and BOQ splits (and the progress) of the schedule, to be changed and approved again. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'plan.schedule.amend'); if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) throw unprocessable('Only an approved, rejected or cancelled schedule is amended.');
      const op = openOf(r); if (op) throw conflict(`${op.doc_no} is open for this project: finish or cancel it first.`);
      return transaction(db, () => {
        const vno = (db.prepare('SELECT MAX(version_no) AS n FROM plan_schedules WHERE org_project_id = ? AND deleted_at IS NULL').get(r.org_project_id).n ?? 0) + 1;
        const nid = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, version_type, version_no, parent_schedule_id, calendar_id, start_date, data_date, finish_date, status, reason, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'WORKING', ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'plan_schedule', ?)")
          .run(r.company_id, numberFor(actor), todayIST(), r.org_project_id, r.name, vno, r.id, r.calendar_id, r.start_date, r.data_date, r.finish_date, reason, actor.user, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
        const map = new Map();
        for (const a of db.prepare('SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id)) {
          const n = Number(db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, wbs_id, location_id, act_type, duration_days, calendar_id, constraint_type, constraint_date, qty, uom, es, ef, ls, lf, total_float, free_float, is_critical, actual_start, actual_finish, pct_complete, pct_source, remaining_days, responsible_user, sort_order, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plan_activity', ?)")
            .run(a.company_id, nid, a.code, a.name, a.wbs_id, a.location_id, a.act_type, a.duration_days, a.calendar_id, a.constraint_type, a.constraint_date, a.qty, a.uom, a.es, a.ef, a.ls, a.lf, a.total_float, a.free_float, a.is_critical, a.actual_start, a.actual_finish, a.pct_complete, a.pct_source, a.remaining_days, a.responsible_user, a.sort_order, a.project_id, actor.user, String(a.id)).lastInsertRowid);
          map.set(a.id, n);
          for (const b of db.prepare('SELECT * FROM plan_activity_boq WHERE activity_id = ? AND deleted_at IS NULL').all(a.id)) db.prepare("INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'plan_activity')").run(b.company_id, n, b.boq_line_id, b.qty, b.project_id, actor.user);
        }
        for (const d of db.prepare('SELECT * FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL').all(r.id)) db.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plan_schedule')").run(d.company_id, nid, map.get(d.pred_id), map.get(d.succ_id), d.dep_type, d.lag_days, d.project_id, actor.user);
        recount(nid); db.prepare('UPDATE plan_schedules SET needs_calc = 1 WHERE id = ?').run(nid);
        audit(actor, 'plan_schedules', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return schedules.get(actor, nid);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'plan_schedules' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'plan.schedule.print'); const v = view(actor, r, { detail: true }); const acts = listActivities(actor, r.id, { filter: 'all', q: '', page: 1, pageSize: 1000, wbsId: null }).rows;
      const tr = (c, h = false) => `<tr>${c.map((x) => `<${h ? 'th' : 'td'}>${esc(x)}</${h ? 'th' : 'td'}>`).join('')}</tr>`;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED SCHEDULE</strong></p>`}<h1>Schedule ${esc(v.docNo)} · ${esc(v.projectCode)} ${esc(v.projectName)}</h1>`
        + `<p>${esc(v.name)} · version ${v.versionNo} · start ${esc(v.startDate)} · finish ${esc(v.finishDate ?? 'not calculated')} · data date ${esc(v.dataDate ?? '—')} · ${v.activities} activities, ${v.critical} critical${v.needsCalc ? ' · CHANGED SINCE THE LAST CALCULATION' : ''}</p>`
        + `<table border="1" cellpadding="3">${tr(['Code', 'Activity', 'WBS', 'Dur.', 'Early start', 'Early finish', 'Late start', 'Late finish', 'Total float', 'Free float', '%'], true)}${acts.map((a) => tr([a.code, a.name, a.wbsCode ?? '', a.duration, a.es ?? '', a.ef ?? '', a.ls ?? '', a.lf ?? '', a.totalFloat ?? '', a.freeFloat ?? '', a.pctComplete])).join('')}</table></body></html>`;
    },
    /** The activities of a schedule as rows (code, name, WBS and location codes, type, duration, predecessors such as "A10;A20SS+2"); the links are made after all the rows. */
    import(actor, id, { rows }) {
      const s = row(actor, id, 'plan.schedule.edit'); mustEdit(s); const errors = []; const made = [];
      const wbs = new Map(db.prepare('SELECT id, code FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL').all(s.org_project_id).map((w) => [w.code.toLowerCase(), w.id]));
      const locs = new Map(db.prepare('SELECT id, code FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL').all(s.org_project_id).map((w) => [w.code.toLowerCase(), w.id]));
      return transaction(db, () => {
        rows.forEach((x, i) => {
          try {
            const wbsId = x.wbsCode ? wbs.get(x.wbsCode.toLowerCase()) : null; if (x.wbsCode && !wbsId) throw new Error(`WBS ${x.wbsCode} is not a node of this project`);
            const locationId = x.locationCode ? locs.get(x.locationCode.toLowerCase()) : null; if (x.locationCode && !locationId) throw new Error(`Location ${x.locationCode} is not a location of this project`);
            const c = actCheck(actor, s, { type: x.type, duration: x.duration, wbsId }); if (c.problems.length) throw new Error(c.problems[0].message);
            made.push({ row: i + 1, id: insAct(actor, s, { code: x.code, name: x.name, wbsId, locationId, type: x.type, duration: x.duration, responsible: x.responsible }, { sourceType: 'import' }), preds: x.predecessors });
          } catch (e) { errors.push({ row: i + 1, code: x.code, message: e.message }); }
        });
        let linked = 0;
        for (const m of made) for (const part of (m.preds ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean)) {
          const mm = /^([A-Za-z0-9._-]+?)(FS|SS|FF|SF)?([+-]\d+)?$/i.exec(part); const p = mm && db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(s.id, mm[1]);
          if (!p) { errors.push({ row: m.row, message: `Predecessor ${part} is not an activity of this schedule` }); continue; }
          try { links.create(actor, s.id, { predId: p.id, succId: m.id, type: (mm[2] ?? 'FS').toUpperCase(), lag: Number(mm[3] ?? 0) }); linked += 1; } catch (e) { errors.push({ row: m.row, message: e.message }); }
        }
        dirty(s.id); recount(s.id); audit(actor, 'plan_schedules', s.id, 'import', s.company_id, { newValues: { created: made.length, linked, errors: errors.length } });
        return { created: made.length, linked, errors };
      });
    },
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        transaction(db, () => {
          const prev = db.prepare("SELECT * FROM plan_schedules WHERE org_project_id = ? AND status = 'APPROVED' AND id <> ? AND deleted_at IS NULL").get(r.org_project_id, r.id);
          if (prev) db.prepare("UPDATE plan_schedules SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, prev.id);
          db.prepare("UPDATE plan_schedules SET status = 'APPROVED', approved_by = ?, approved_at = ?, locked_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, actor.user, now, r.id);
          audit(actor, 'plan_schedules', r.id, 'approve', r.company_id, { newValues: { supersedes: prev?.doc_no ?? null } });
          event('plan.schedule.approved', actor, r.id, r.company_id, r.org_project_id, { scheduleId: r.id, projectId: r.org_project_id, docNo: r.doc_no, versionNo: r.version_no, previousScheduleId: prev?.id ?? null, start: r.start_date, finish: r.finish_date, activities: r.activities_count, critical: r.critical_count });
          notify(r.company_id, 'plan.schedule.approved', [r.requested_by], r.doc_no, r.name, `Schedule ${r.doc_no} version ${r.version_no} is approved: its logic is locked.`, `/plan/activities?scheduleId=${r.id}`, r.id);
        });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE plan_schedules SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'plan_schedules', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'plan.schedule.rejected', [r.requested_by], r.doc_no, r.name, `Schedule ${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/plan/activities?scheduleId=${r.id}`, r.id);
    },
    /** What 13.04, 14.01, 15.02 and 17.08 read: the approved schedule of a project (or, with `working`, the open version) and its activities with their dates. */
    current(actor, projectId, { working = false } = {}) {
      const o = project(actor, projectId); const s = db.prepare(`SELECT * FROM plan_schedules WHERE org_project_id = ? AND deleted_at IS NULL AND status ${working ? "IN ('DRAFT', 'RETURNED', 'SUBMITTED')" : "= 'APPROVED'"}`).get(o.id);
      if (!s) return { projectId: o.id, schedule: null, activities: [] };
      return { projectId: o.id, schedule: view(actor, s), activities: listActivities(actor, s.id, { filter: 'all', q: '', page: 1, pageSize: 1000, wbsId: null }).rows.map((a) => ({ id: a.id, code: a.code, name: a.name, wbsId: a.wbsId, locationId: a.locationId, type: a.type, duration: a.duration, qty: a.qty, uom: a.uom, es: a.es, ef: a.ef, ls: a.ls, lf: a.lf, totalFloat: a.totalFloat, critical: a.critical, actualStart: a.actualStart, actualFinish: a.actualFinish, pctComplete: a.pctComplete, responsible: a.responsible })) };
    },
  });

  // ---- FR-03: generating activities from a template (per WBS node or per location) or from the BOQ split by WBS ----------------------------------------------------------
  function plan(actor, s, b) {
    const out = []; const linkPlan = []; const problems = []; const exists = (code) => Boolean(db.prepare('SELECT 1 FROM plan_activities WHERE schedule_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(s.id, code));
    if (b.mode === 'TEMPLATE') {
      const t = db.prepare("SELECT * FROM plan_templates WHERE id = ? AND (company_id IS NULL OR company_id = ?) AND status = 'ACTIVE' AND deleted_at IS NULL").get(b.templateId ?? 0, actor.companyId);
      if (!t) { problems.push({ field: 'templateId', message: 'Choose a template in force' }); return { problems }; }
      const steps = json(t.steps_json, []);
      const targets = t.target === 'WBS'
        ? b.wbsIds.map((i) => wbsOk(s.org_project_id, i)).filter(Boolean).sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }))
        : b.locationIds.map((i) => locOk(s.org_project_id, i)).filter(Boolean);
      if (!targets.length) problems.push({ field: t.target === 'WBS' ? 'wbsIds' : 'locationIds', message: t.target === 'WBS' ? 'Choose the WBS nodes of this project to generate for' : 'Choose the locations of this project to generate for' });
      if (t.target === 'LOCATION' && b.wbsId && !wbsOk(s.org_project_id, b.wbsId)) problems.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
      targets.forEach((g, gi) => {
        for (const st of steps) {
          const code = `${b.prefix}${g.code}-${st.key}`.slice(0, 30); out.push({ code, name: `${st.name} · ${g.name}`, duration: st.duration, type: st.duration === 0 ? 'MILESTONE' : 'TASK', wbsId: t.target === 'WBS' ? g.id : (b.wbsId ?? null), locationId: t.target === 'LOCATION' ? g.id : null, exists: exists(code), source: `${t.code}:${st.key}` });
          if (st.after) linkPlan.push({ pred: `${b.prefix}${g.code}-${st.after}`.slice(0, 30), succ: code, type: st.type ?? 'FS', lag: st.lag ?? 0 });
        }
        if (b.chain && t.chain_step && gi > 0) { const prev = targets[gi - 1]; const first = steps.find((x) => !x.after) ?? steps[0]; linkPlan.push({ pred: `${b.prefix}${prev.code}-${t.chain_step}`.slice(0, 30), succ: `${b.prefix}${g.code}-${first.key}`.slice(0, 30), type: 'FS', lag: 0 }); }
      });
    } else {
      const nodes = b.wbsIds.length ? b.wbsIds.map((i) => wbsOk(s.org_project_id, i)).filter(Boolean) : db.prepare('SELECT DISTINCT w.id, w.code, w.name FROM proj_boq_line_wbs x JOIN proj_wbs w ON w.id = x.wbs_id JOIN proj_boq_lines l ON l.id = x.line_id JOIN proj_boq_versions v ON v.id = l.version_id WHERE w.project_id = ? AND x.deleted_at IS NULL AND l.deleted_at IS NULL AND v.status = \'APPROVED\' ORDER BY w.code').all(s.org_project_id);
      if (!nodes.length) problems.push({ field: 'wbsIds', message: 'No WBS node of this project carries BOQ quantities (map the BOQ in 10.04 first)' });
      for (const w of nodes) {
        const lines = db.prepare("SELECT l.id, l.item_code, l.description, l.uom, x.qty FROM proj_boq_line_wbs x JOIN proj_boq_lines l ON l.id = x.line_id JOIN proj_boq_versions v ON v.id = l.version_id WHERE x.wbs_id = ? AND x.deleted_at IS NULL AND l.deleted_at IS NULL AND v.status = 'APPROVED' AND v.org_project_id = ? ORDER BY l.item_code").all(w.id, s.org_project_id);
        if (!lines.length) continue;
        const code = `${b.prefix}${w.code}`.slice(0, 30); const one = lines.length === 1 ? lines[0] : null;
        out.push({ code, name: one ? `${one.description} · ${w.code}` : `Work of ${w.code} ${w.name}`, duration: b.duration, type: 'TASK', wbsId: w.id, locationId: null, qty: one ? one.qty / 1000 : 0, uom: one?.uom ?? null, boq: lines.map((l) => ({ boqLineId: l.id, itemCode: l.item_code, qty: l.qty / 1000 })), exists: exists(code), source: 'BOQ' });
      }
      if (b.chain) for (let i = 1; i < out.length; i += 1) linkPlan.push({ pred: out[i - 1].code, succ: out[i].code, type: 'FS', lag: 0 });
    }
    return { problems, rows: out, links: linkPlan };
  }
  const generate = {
    preview(actor, id, b) { const s = row(actor, id, 'plan.schedule.edit'); const p = plan(actor, s, b); fail(p.problems); return { rows: p.rows, links: p.links, create: p.rows.filter((r) => !r.exists).length, skip: p.rows.filter((r) => r.exists).length }; },
    run(actor, id, b) {
      const s = row(actor, id, 'plan.schedule.edit'); mustEdit(s); const p = plan(actor, s, b); fail(p.problems);
      return transaction(db, () => {
        let created = 0; let linked = 0; const codeId = (code) => db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(s.id, code)?.id;
        for (const r of p.rows) {
          if (r.exists) continue;
          const aid = insAct(actor, s, { code: r.code, name: r.name, duration: r.duration, type: r.type, wbsId: r.wbsId, locationId: r.locationId, qty: r.qty ?? 0, uom: r.uom ?? null }, { sourceType: b.mode === 'BOQ' ? 'proj_boq' : 'plan_template', sourceId: r.source });
          for (const l of r.boq ?? []) db.prepare("INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'proj_boq')").run(s.company_id, aid, l.boqLineId, Math.round(l.qty * 1000), s.org_project_id, actor.user);
          created += 1;
        }
        for (const l of p.links) {
          const pi = codeId(l.pred); const si = codeId(l.succ); if (!pi || !si) continue;
          if (db.prepare('SELECT 1 FROM plan_dependencies WHERE schedule_id = ? AND pred_id = ? AND succ_id = ? AND deleted_at IS NULL').get(s.id, pi, si)) continue;
          db.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plan_template')").run(s.company_id, s.id, pi, si, l.type, l.lag, s.org_project_id, actor.user); linked += 1;
        }
        const ids = db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id).map((x) => x.id); const cyc = findCycle(ids, linksOf(s.id));
        if (cyc) throw unprocessable(`The generated links close a loop: ${codesOf(cyc).join(' → ')} (BR-02).`);
        dirty(s.id); recount(s.id); audit(actor, 'plan_schedules', s.id, 'generate', s.company_id, { newValues: { mode: b.mode, created, linked } });
        return { created, linked, skipped: p.rows.length - created };
      });
    },
  };

  // ---- the critical path and float report -------------------------------------------------------------------------------------------------------------------------
  function critical(actor, id, { near = 5 } = {}) {
    const s = row(actor, id); const acts = db.prepare('SELECT a.*, w.code AS wcode FROM plan_activities a LEFT JOIN proj_wbs w ON w.id = a.wbs_id WHERE a.schedule_id = ? AND a.deleted_at IS NULL ORDER BY a.es, a.code').all(s.id);
    const ls = linksOf(s.id); const crit = new Set(acts.filter((a) => a.is_critical).map((a) => a.id)); const byId = new Map(acts.map((a) => [a.id, a]));
    // the critical chains: critical activities joined by links between critical activities, from those that no critical activity precedes
    const nexts = new Map(); const hasPrev = new Set(); for (const l of ls) if (crit.has(l.pred) && crit.has(l.succ)) { nexts.set(l.pred, [...(nexts.get(l.pred) ?? []), l.succ]); hasPrev.add(l.succ); }
    // walked without recursion and within bounds: a critical chain can be thousands of activities long, and branches multiply (at most 20 paths, 200 branches waiting)
    const paths = []; const stack = acts.filter((a) => crit.has(a.id) && !hasPrev.has(a.id)).map((a) => [a.id]).reverse();
    while (stack.length && paths.length < 20) {
      const path = stack.pop(); const seen = new Set(path); let cur = path.at(-1);
      for (;;) { const n = (nexts.get(cur) ?? []).filter((x) => !seen.has(x)); if (!n.length) { paths.push(path); break; } for (const x of n.slice(1)) if (stack.length < 200) stack.push([...path, x]); cur = n[0]; path.push(cur); seen.add(cur); }
    }
    const buckets = /** @type {[string, (f: number) => boolean][]} */ ([['negative', (f) => f < 0], ['0', (f) => f === 0], ['1-5', (f) => f >= 1 && f <= 5], ['6-10', (f) => f >= 6 && f <= 10], ['11-20', (f) => f >= 11 && f <= 20], ['over 20', (f) => f > 20]]).map(([label, test]) => ({ label, count: acts.filter((a) => a.total_float != null && test(a.total_float)).length }));
    const row2 = (a) => ({ id: a.id, code: a.code, name: a.name, wbs: a.wcode, type: a.act_type, duration: a.duration_days, es: a.es, ef: a.ef, ls: a.ls, lf: a.lf, totalFloat: a.total_float, freeFloat: a.free_float, critical: Boolean(a.is_critical), pctComplete: a.pct_complete / 100 });
    return { scheduleId: s.id, docNo: s.doc_no, projectId: s.org_project_id, start: s.start_date, finish: s.finish_date, dataDate: s.data_date, needsCalc: Boolean(s.needs_calc), calculatedAt: s.calculated_at, near,
      critical: acts.filter((a) => a.is_critical).map(row2), nearCritical: acts.filter((a) => !a.is_critical && a.total_float != null && a.total_float <= near).map(row2), buckets,
      paths: paths.map((p) => ({ codes: p.map((x) => byId.get(x).code), duration: p.reduce((t, x) => t + byId.get(x).duration_days, 0), start: byId.get(p[0]).es, finish: byId.get(p.at(-1)).ef })), totals: { activities: acts.length, critical: crit.size, nearCritical: acts.filter((a) => !a.is_critical && a.total_float != null && a.total_float <= near).length, negative: acts.filter((a) => a.total_float != null && a.total_float < 0).length } };
  }
  function criticalCsv(actor, id) {
    const r = critical(actor, id, { near: 1000000 }); need(actor, 'plan.schedule.export', 'export the float report', r.projectId);
    const rows = [...r.critical, ...r.nearCritical].sort((a, b) => (a.totalFloat ?? 0) - (b.totalFloat ?? 0) || String(a.es).localeCompare(String(b.es)));
    audit(actor, 'plan_schedules', r.scheduleId, 'export', actor.companyId, { newValues: { report: 'critical path and float' } });
    return { name: `critical-path-${r.docNo.replace(/\W+/g, '-')}.csv`, body: csvOf([['Code', 'Activity', 'WBS', 'Duration', 'Early start', 'Early finish', 'Late start', 'Late finish', 'Total float', 'Free float', 'Critical'], ...rows.map((a) => [a.code, a.name, a.wbs ?? '', a.duration, a.es ?? '', a.ef ?? '', a.ls ?? '', a.lf ?? '', a.totalFloat ?? '', a.freeFloat ?? '', a.critical ? 'Yes' : 'No'])]) };
  }

  // ---- progress from the DPR (14.05 publishes it) ---------------------------------------------------------------------------------------------------------------------
  const onDpr = (e) => {
    const d = e.data ?? {}; const companyId = Number(e.companyId ?? d.companyId); if (!companyId || !d.projectId || !d.date) return null;
    const s = db.prepare("SELECT * FROM plan_schedules WHERE org_project_id = ? AND company_id = ? AND status IN ('APPROVED') AND deleted_at IS NULL").get(Number(d.projectId), companyId); if (!s) return null;
    const rows = (d.lines ?? []).map((l) => { const a = db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? AND (id = ? OR code = ?) AND deleted_at IS NULL').get(s.id, Number(l.activityId) || 0, String(l.activityCode ?? '')); return a ? { activityId: a.id, ...(l.actualStart ? { actualStart: l.actualStart } : {}), ...(l.actualFinish ? { actualFinish: l.actualFinish } : {}), pctComplete: l.pctComplete == null ? null : Number(l.pctComplete), remainingDays: null } : null; }).filter(Boolean);
    if (!rows.length) return null;
    try { return applyProgress(system(companyId), s, { dataDate: d.date, rows }, 'DPR'); } catch (x) { if (x?.status === 400) return null; throw x; }
  };

  return { plan: { calendars, templates, schedules, activities, links, generate, critical, criticalCsv, onDpr, calendarOf, runCalc: (actor, id) => runCalc(actor, row(actor, id)) }, planDecide: schedules.decide };
}
