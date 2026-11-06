import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { templateServiceOf } from '../eng/templates.js';
import { addDays } from './att-calc.js';
import { trainingOf } from './training.js';

// Performance management (part 07.11): measure people fairly from what the system recorded. A KPI of the library names a metric the system can compute (tasks done on time, actions on time, approvals within their SLA, attendance, mandatory training) with a
// target, a direction and a weight; every month the value is computed for each person the KPI applies to, with the evidence that reproduces it (the records behind the figure, the days left out, the dates), leave and transfer days are left out (BR-01),
// and a person can dispute a value: it is frozen until HR resolves it. Goals are agreed with the manager. Feedback, recognition and one-to-one notes are continuous. A review cycle makes a review for each person: self-review, manager review,
// calibration by HR, the final rating approved by the manager, the skip-level reviewer and the HR manager (the director too for senior grades), a development plan and an appraisal letter. A rating is a human judgement: nothing here rates anybody
// by itself, and a KPI score is shown beside the rating, never instead of it.
export const REVIEW_DOC = 'HR_PERF_REVIEW';
export const REVIEW_STATUS = { DRAFT: 'In progress', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const STAGES = { SELF: 'Self-review', MANAGER: 'Manager review', CALIBRATION: 'Calibration', FINAL: 'Final approval', DONE: 'Done' };
export const RATING_LABELS = { 1: 'Needs improvement', 2: 'Below expectations', 3: 'Meets expectations', 4: 'Exceeds expectations', 5: 'Outstanding' };
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (num, den) => (den > 0 ? r1((num / den) * 100) : null);
const systemActor = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });

/** The days of a month a person is not measured on (BR-01): approved leave and the days of an approved transfer between relieving and joining. */
export function excludedDays(db, companyId, employeeId, from, to) {
  const out = new Set();
  const span = (a, b) => { for (let d = a < from ? from : a; d <= (b > to ? to : b); d = addDays(d, 1)) out.add(d); };
  for (const l of db.prepare("SELECT from_date, to_date FROM lv_applications WHERE company_id = ? AND employee_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND from_date <= ? AND to_date >= ?").all(companyId, employeeId, to, from)) span(l.from_date, l.to_date);
  try { for (const t of db.prepare("SELECT relieve_date, join_date FROM hr_transfers WHERE company_id = ? AND employee_id = ? AND status NOT IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED') AND deleted_at IS NULL AND relieve_date <= ? AND join_date >= ?").all(companyId, employeeId, to, from)) span(t.relieve_date, t.join_date); } catch { /* transfers not installed */ }
  return out;
}

/**
 * The metrics a KPI can name. Each reads records the system keeps and returns the figure with the records behind it, so that the same figure is reproduced from the evidence. `p` has the company, the person (id, username), the dates and the days to leave out.
 * A figure that needs data of a module that is not built yet (daily progress reports, stock, closing) is added here when that module exists (D-360).
 */
export const METRICS = {
  TASK_ONTIME_PCT: {
    label: 'Tasks finished by their due date (%)', unit: 'PERCENT', source: 'tsk_tasks',
    run({ db, companyId, user, from, to, asOf, skip }) {
      const rows = db.prepare("SELECT t.id, t.task_no, t.due_date, t.status, t.completed_at FROM tsk_tasks t JOIN tsk_assignees a ON a.task_id = t.id AND a.role = 'ASSIGNEE' AND a.deleted_at IS NULL WHERE t.company_id = ? AND t.deleted_at IS NULL AND lower(a.user_ref) = lower(?) AND t.due_date >= ? AND t.due_date <= ? AND t.status != 'CANCELLED' ORDER BY t.due_date, t.id").all(companyId, user, from, to);
      const records = []; let ok = 0;
      for (const t of rows) {
        if (skip.has(t.due_date)) continue;
        const done = ['DONE', 'VERIFIED', 'CLOSED'].includes(t.status) && t.completed_at;
        if (!done && t.due_date >= asOf) continue; // not due yet
        const onTime = Boolean(done && t.completed_at.slice(0, 10) <= t.due_date);
        if (onTime) ok += 1;
        records.push({ entity: 'tsk_tasks', id: t.id, ref: t.task_no, date: t.due_date, result: onTime ? 'ON_TIME' : 'LATE' });
      }
      return { value: pct(ok, records.length), sample: records.length, records };
    },
  },
  ACTION_ONTIME_PCT: {
    label: 'Recorded actions done on time (%)', unit: 'PERCENT', source: 'acc_action_ledger',
    run({ db, companyId, user, from, to, skip }) {
      const rows = db.prepare("SELECT id, entity, entity_id, entity_ref, action, on_time, substr(occurred_at, 1, 10) AS day FROM acc_action_ledger WHERE company_id = ? AND lower(actor_id) = lower(?) AND on_time IS NOT NULL AND substr(occurred_at, 1, 10) >= ? AND substr(occurred_at, 1, 10) <= ? AND deleted_at IS NULL ORDER BY id").all(companyId, user, from, to).filter((r) => !skip.has(r.day));
      const ok = rows.filter((r) => r.on_time === 1).length;
      return { value: pct(ok, rows.length), sample: rows.length, records: rows.map((r) => ({ entity: 'acc_action_ledger', id: r.id, ref: r.entity_ref ?? `${r.entity} ${r.entity_id}`, date: r.day, result: r.on_time === 1 ? 'ON_TIME' : 'LATE' })) };
    },
  },
  APPROVAL_TIMELINESS_PCT: {
    label: 'Approvals decided within their SLA (%)', unit: 'PERCENT', source: 'wf_tasks',
    run({ db, companyId, user, from, to, skip }) {
      const rows = db.prepare("SELECT id, instance_id, step_code, due_at, acted_at, substr(acted_at, 1, 10) AS day FROM wf_tasks WHERE company_id = ? AND lower(assignee_user_id) = lower(?) AND status = 'DONE' AND acted_at IS NOT NULL AND due_at IS NOT NULL AND substr(acted_at, 1, 10) >= ? AND substr(acted_at, 1, 10) <= ? AND superseded = 0 ORDER BY id").all(companyId, user, from, to).filter((r) => !skip.has(r.day));
      const ok = rows.filter((r) => r.acted_at <= r.due_at).length;
      return { value: pct(ok, rows.length), sample: rows.length, records: rows.map((r) => ({ entity: 'wf_tasks', id: r.id, ref: `Approval ${r.instance_id} · ${r.step_code}`, date: r.day, result: r.acted_at <= r.due_at ? 'ON_TIME' : 'LATE' })) };
    },
  },
  ATTENDANCE_PCT: {
    label: 'Attendance on working days (%)', unit: 'PERCENT', source: 'att_daily',
    run({ db, companyId, employeeId, from, to, skip }) {
      const rows = db.prepare("SELECT id, work_date, status FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date >= ? AND work_date <= ? AND status IN ('PRESENT', 'ON_DUTY', 'HALF_DAY', 'ABSENT', 'MISSING_PUNCH') AND deleted_at IS NULL ORDER BY work_date").all(companyId, employeeId, from, to).filter((r) => !skip.has(r.work_date));
      const credit = (s) => (['PRESENT', 'ON_DUTY'].includes(s) ? 1 : s === 'HALF_DAY' ? 0.5 : 0);
      const got = rows.reduce((s, r) => s + credit(r.status), 0);
      return { value: pct(got, rows.length), sample: rows.length, records: rows.map((r) => ({ entity: 'att_daily', id: r.id, ref: r.work_date, date: r.work_date, result: r.status })) };
    },
  },
  TRAINING_COMPLIANCE_PCT: {
    label: 'Mandatory training up to date (%)', unit: 'PERCENT', source: 'trn_attendance', asOfOnly: true,
    run({ db, companyId, employeeId }) {
      const trn = trainingOf(db); if (!trn) return { value: null, sample: 0, records: [] };
      const rep = trn.compliance.report(systemActor(companyId), { kind: 'EMPLOYEE', limit: 100000 });
      const mine = rep.rows.filter((r) => r.personId === employeeId);
      const ok = mine.filter((r) => r.status === 'COMPLIANT' || r.status === 'DUE_SOON').length;
      return { value: pct(ok, mine.length), sample: mine.length, records: mine.map((r) => ({ entity: 'trn_courses', id: r.courseId, ref: r.course, date: r.doneOn, result: r.status })) };
    },
  },
  MANUAL: { label: 'Entered by the manager, with a note', unit: 'PERCENT', source: 'manual', manual: true, run: () => ({ value: null, sample: 0, records: [] }) },
};
/** The score of a value against its target: 100 when the target is met, in proportion below it, whichever way is better. */
export function scoreOf(value, target, direction) {
  if (value == null) return null;
  if (direction === 'LOWER') return value <= target ? 100 : Math.max(0, Math.min(100, Math.round((target / value) * 100)));
  return target <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

export const reviewList = defineList({
  code: 'hr.reviews', label: 'Appraisal reviews', permission: 'hr.review.view',
  from: 'perf_reviews r JOIN hr_employees e ON e.id = r.employee_id JOIN perf_cycles c ON c.id = r.cycle_id',
  where: 'r.deleted_at IS NULL', searchable: ['r.doc_no', 'e.full_name', 'e.emp_code', 'c.name'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'r.doc_no', type: 'text', label: 'Review' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, cycle: { sql: 'c.name', type: 'text', label: 'Cycle' }, cycleId: { sql: 'r.cycle_id', type: 'number', label: 'Cycle id' },
    stage: { sql: 'r.stage', type: 'enum', label: 'Stage', options: Object.entries(STAGES) }, status: { sql: 'r.status', type: 'enum', label: 'Status', options: Object.entries(REVIEW_STATUS) },
    band: { sql: 'r.band', type: 'enum', label: 'Grade', options: [['STANDARD', 'Standard'], ['SENIOR', 'Senior']] }, kpiScore: { sql: 'r.kpi_score', type: 'number', label: 'KPI score' },
  },
});

export function createPerformanceService({ db, dep }) {
  const { may, need, nextDoc, event, usernameOf, myEmployee } = dep;
  const notif = notificationsOf(db);
  const today = () => todayIST();
  const hrUsers = (companyId) => db.prepare("SELECT username FROM iam_users WHERE company_id = ? AND is_active = 1 AND roles_json LIKE '%\"HRMGR\"%'").all(companyId).map((u) => u.username);
  const emp = (id) => db.prepare('SELECT e.*, g.code AS designation_code, g.name AS designation, g.level AS grade_level, d.code AS department_code, d.name AS department, u.username FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN org_departments d ON d.id = e.department_id LEFT JOIN iam_users u ON u.id = e.user_id WHERE e.id = ?').get(id);
  const reportees = (employeeId) => new Set(db.prepare('WITH RECURSIVE r(id, depth) AS (SELECT id, 1 FROM hr_employees WHERE manager_id = ? AND deleted_at IS NULL UNION SELECT e.id, r.depth + 1 FROM hr_employees e JOIN r ON e.manager_id = r.id WHERE e.deleted_at IS NULL AND r.depth < 12) SELECT id FROM r').all(employeeId).map((x) => x.id));
  const meOf = (actor) => { const id = myEmployee(actor); if (!id) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record, so there is no performance to show. Ask HR to link it.'); return emp(id); };
  const seesAll = (actor) => may(actor, 'hr.review.view_all');
  /** An employee is seen by themselves, by the people above them in the reporting line, and by those who see all reviews. */
  const canSee = (actor, employeeId) => { if (seesAll(actor)) return true; const me = myEmployee(actor); return Boolean(me && (me === employeeId || reportees(me).has(employeeId))); };
  const isLine = (actor, employeeId) => { const me = myEmployee(actor); return Boolean(me && me !== employeeId && reportees(me).has(employeeId)); };
  const tell = (companyId, to, templateCode, data, link, key) => to && notif.notify({ companyId, templateCode, recipients: [`user:${to}`], data, link, sourceType: 'perf', sourceId: key, eventKey: `${templateCode}:${key}` });
  const cycleRow = (companyId, id) => { const c = db.prepare('SELECT * FROM perf_cycles WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!c) throw notFound('That review cycle does not exist.'); return c; };
  const currentCycle = (companyId, id = null) => (id ? cycleRow(companyId, id) : db.prepare("SELECT * FROM perf_cycles WHERE company_id = ? AND deleted_at IS NULL AND cycle_status = 'OPEN' ORDER BY start_date DESC LIMIT 1").get(companyId) ?? db.prepare('SELECT * FROM perf_cycles WHERE company_id = ? AND deleted_at IS NULL ORDER BY start_date DESC LIMIT 1').get(companyId) ?? null);
  const cycleView = (c) => ({ id: c.id, code: c.code, name: c.name, kind: c.kind, startDate: c.start_date, endDate: c.end_date, selfDue: c.self_due, seniorFromLevel: c.senior_from_level, status: c.cycle_status, rowVersion: c.version, reviews: db.prepare("SELECT COUNT(*) AS n FROM perf_reviews WHERE cycle_id = ? AND deleted_at IS NULL AND status != 'CANCELLED'").get(c.id).n });

  // ------------------------------------------------------------------ the KPI library and the cycles (config, maker-checker)
  const kpiView = (k) => ({ id: k.id, code: k.code, name: k.name, nameHi: k.name_hi, appliesTo: json(k.applies_to_json, {}), formulaRef: k.formula_ref, metricLabel: METRICS[k.formula_ref]?.label ?? k.formula_ref, unit: k.unit, direction: k.direction, target: k.target_value, weight: k.weight, effectiveFrom: k.effective_from, effectiveTo: k.effective_to, status: k.kpi_status, activatedBy: k.activated_by, rowVersion: k.version, createdBy: k.created_by, updatedBy: k.updated_by });
  const config = {
    metrics() { return Object.entries(METRICS).map(([code, m]) => ({ code, label: m.label, unit: m.unit, source: m.source, manual: Boolean(m.manual) })); },
    kpis: {
      list(actor) {
        need(actor, 'hr.perf.configure', 'see the KPI library');
        return db.prepare('SELECT * FROM perf_kpis WHERE company_id = ? AND deleted_at IS NULL ORDER BY kpi_status, code').all(actor.companyId).map(kpiView);
      },
      save(actor, b) {
        need(actor, 'hr.perf.configure', 'keep the KPI library');
        if (!METRICS[b.formulaRef]) throw badRequest('Some fields are not valid.', [{ field: 'formulaRef', message: 'Choose one of the metrics the system can compute' }]);
        if (b.effectiveTo && b.effectiveTo < b.effectiveFrom) throw badRequest('Some fields are not valid.', [{ field: 'effectiveTo', message: 'The KPI cannot end before it starts' }]);
        const cols = [b.name, b.nameHi ?? null, JSON.stringify(b.appliesTo ?? {}), b.formulaRef, METRICS[b.formulaRef].unit, b.direction, b.target, b.weight, b.effectiveFrom, b.effectiveTo ?? null];
        if (b.id) {
          const k = db.prepare('SELECT * FROM perf_kpis WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.id, actor.companyId); if (!k) throw notFound('That KPI does not exist.');
          if (b.version !== k.version) throw conflict('This KPI was changed by someone else. Reload it and try again.');
          // a change goes back to a draft: a second person activates it again (maker-checker); the old values are in the audit trail
          db.prepare("UPDATE perf_kpis SET name = ?, name_hi = ?, applies_to_json = ?, formula_ref = ?, unit = ?, direction = ?, target_value = ?, weight = ?, effective_from = ?, effective_to = ?, kpi_status = CASE WHEN kpi_status = 'RETIRED' THEN 'RETIRED' ELSE 'DRAFT' END, activated_by = NULL, activated_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(...cols, actor.user, nowIso(), k.id);
          writeAudit(db, { entity: 'perf_kpis', entityId: k.id, action: 'update', oldValues: { target: k.target_value, weight: k.weight, formula: k.formula_ref, status: k.kpi_status }, newValues: { target: b.target, weight: b.weight, formula: b.formulaRef }, actor: actor.user, companyId: actor.companyId });
          return kpiView(db.prepare('SELECT * FROM perf_kpis WHERE id = ?').get(k.id));
        }
        if (db.prepare('SELECT 1 FROM perf_kpis WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, b.code)) throw conflict(`A KPI with the code ${b.code} exists already.`);
        const id = Number(db.prepare("INSERT INTO perf_kpis (company_id, code, name, name_hi, applies_to_json, formula_ref, unit, direction, target_value, weight, effective_from, effective_to, kpi_status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'perf_kpi')").run(actor.companyId, b.code, ...cols, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'perf_kpis', entityId: id, action: 'create', newValues: { code: b.code, formula: b.formulaRef }, actor: actor.user, companyId: actor.companyId });
        return kpiView(db.prepare('SELECT * FROM perf_kpis WHERE id = ?').get(id));
      },
      activate(actor, id) {
        need(actor, 'hr.perf.config_approve', 'activate KPIs');
        const k = db.prepare('SELECT * FROM perf_kpis WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!k) throw notFound('That KPI does not exist.');
        if (k.kpi_status === 'ACTIVE') throw conflict('This KPI is active already.');
        if (k.kpi_status === 'RETIRED') throw unprocessable('A retired KPI is not activated: make a new one.');
        if (same(actor.user, k.updated_by ?? k.created_by)) throw forbidden('You made or changed this KPI: somebody else activates it.');
        db.prepare("UPDATE perf_kpis SET kpi_status = 'ACTIVE', activated_by = ?, activated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'perf_kpis', entityId: id, action: 'activate', actor: actor.user, companyId: actor.companyId });
        return kpiView(db.prepare('SELECT * FROM perf_kpis WHERE id = ?').get(id));
      },
      retire(actor, id) {
        need(actor, 'hr.perf.config_approve', 'retire KPIs');
        const k = db.prepare('SELECT * FROM perf_kpis WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!k) throw notFound('That KPI does not exist.');
        db.prepare("UPDATE perf_kpis SET kpi_status = 'RETIRED', effective_to = COALESCE(effective_to, ?), version = version + 1 WHERE id = ?").run(today(), id);
        writeAudit(db, { entity: 'perf_kpis', entityId: id, action: 'retire', actor: actor.user, companyId: actor.companyId });
        return kpiView(db.prepare('SELECT * FROM perf_kpis WHERE id = ?').get(id));
      },
      history(actor, id) {
        need(actor, 'hr.perf.configure', 'see the history of a KPI');
        return db.prepare("SELECT action, actor, old_values, new_values, created_at FROM core_audit_log WHERE entity = 'perf_kpis' AND entity_id = ? ORDER BY id").all(String(id)).map((a) => ({ action: a.action, by: a.actor, at: a.created_at, old: json(a.old_values, null), new: json(a.new_values, null) }));
      },
    },
    cycles: {
      list(actor) { need(actor, 'hr.perf.own', 'see review cycles'); return db.prepare('SELECT * FROM perf_cycles WHERE company_id = ? AND deleted_at IS NULL ORDER BY start_date DESC').all(actor.companyId).map(cycleView); },
      save(actor, b) {
        need(actor, 'hr.perf.configure', 'keep the review cycles');
        if (b.endDate <= b.startDate) throw badRequest('Some fields are not valid.', [{ field: 'endDate', message: 'The cycle must end after it starts' }]);
        if (b.id) {
          const c = cycleRow(actor.companyId, b.id);
          if (c.cycle_status !== 'DRAFT') throw conflict('Only a cycle that is not open yet is changed.');
          if (b.version !== c.version) throw conflict('This cycle was changed by someone else. Reload it and try again.');
          db.prepare('UPDATE perf_cycles SET name = ?, kind = ?, start_date = ?, end_date = ?, self_due = ?, senior_from_level = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name, b.kind, b.startDate, b.endDate, b.selfDue ?? null, b.seniorFromLevel, actor.user, nowIso(), c.id);
          return cycleView(cycleRow(actor.companyId, c.id));
        }
        if (db.prepare('SELECT 1 FROM perf_cycles WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, b.code)) throw conflict(`A cycle with the code ${b.code} exists already.`);
        const id = Number(db.prepare("INSERT INTO perf_cycles (company_id, code, name, kind, start_date, end_date, self_due, senior_from_level, cycle_status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'perf_cycle')").run(actor.companyId, b.code, b.name, b.kind, b.startDate, b.endDate, b.selfDue ?? null, b.seniorFromLevel, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'perf_cycles', entityId: id, action: 'create', newValues: { code: b.code }, actor: actor.user, companyId: actor.companyId });
        return cycleView(cycleRow(actor.companyId, id));
      },
      open(actor, id) {
        need(actor, 'hr.perf.configure', 'open a review cycle');
        const c = cycleRow(actor.companyId, id);
        if (c.cycle_status !== 'DRAFT') throw conflict('This cycle is open or closed already.');
        db.prepare("UPDATE perf_cycles SET cycle_status = 'OPEN', opened_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), id);
        writeAudit(db, { entity: 'perf_cycles', entityId: id, action: 'open', actor: actor.user, companyId: actor.companyId });
        event('perf.cycle.opened', actor, 'perf_cycle', id, actor.companyId, { code: c.code, startDate: c.start_date, endDate: c.end_date }, null, null);
        return cycleView(cycleRow(actor.companyId, id));
      },
      close(actor, id) {
        need(actor, 'hr.perf.configure', 'close a review cycle');
        const c = cycleRow(actor.companyId, id);
        if (c.cycle_status !== 'OPEN') throw conflict('Only an open cycle is closed.');
        const waiting = db.prepare("SELECT COUNT(*) AS n FROM perf_reviews WHERE cycle_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(id).n;
        if (waiting) throw unprocessable(`${waiting} final rating(s) are still in approval: decide them before the cycle is closed.`);
        db.prepare("UPDATE perf_cycles SET cycle_status = 'CLOSED', closed_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), id);
        writeAudit(db, { entity: 'perf_cycles', entityId: id, action: 'close', actor: actor.user, companyId: actor.companyId });
        event('perf.cycle.closed', actor, 'perf_cycle', id, actor.companyId, { code: c.code }, null, null);
        return cycleView(cycleRow(actor.companyId, id));
      },
    },
  };

  // ------------------------------------------------------------------ computing the KPIs (FR-03) and their evidence
  /** The KPIs that apply to a person on a day: active, in force, and for everybody, their designation or their department. */
  function kpisFor(companyId, e, on) {
    return db.prepare("SELECT * FROM perf_kpis WHERE company_id = ? AND deleted_at IS NULL AND kpi_status = 'ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY code").all(companyId, on, on).filter((k) => {
      const a = json(k.applies_to_json, {});
      return a.all || (a.designationCodes ?? []).some((c) => same(c, e.designation_code)) || (a.departmentCodes ?? []).some((c) => same(c, e.department_code));
    });
  }
  /** One figure, from the records, with everything needed to get it again (BR-01: leave and transfer days are left out). */
  function evaluate(companyId, e, kpi, period, asOf) {
    const m = METRICS[kpi.formula_ref];
    const from = `${period}-01`; const full = monthEnd(period); const to = asOf < full ? asOf : full;
    const skip = excludedDays(db, companyId, e.id, from, to);
    const r = m.manual ? { value: null, sample: 0, records: [] } : m.run({ db, companyId, employeeId: e.id, user: e.username, from, to, asOf, skip });
    return { ...r, from, to, asOf, excluded: [...skip].sort() };
  }
  const evidenceOf = (kpi, e, r) => ({ metric: kpi.formula_ref, source: METRICS[kpi.formula_ref]?.source, employeeId: e.id, user: e.username, from: r.from, to: r.to, asOf: r.asOf, direction: kpi.direction, excluded: r.excluded, sample: r.sample, records: r.records.slice(0, 300), truncated: r.records.length > 300 });
  /** Compute and keep one value; a value that is disputed (frozen) or adjusted by HR is never overwritten by the computation. */
  function computeOne(companyId, e, kpi, period, asOf) {
    const prev = db.prepare('SELECT * FROM perf_kpi_values WHERE company_id = ? AND employee_id = ? AND kpi_code = ? COLLATE NOCASE AND period = ? AND deleted_at IS NULL').get(companyId, e.id, kpi.code, period);
    if (prev && ['DISPUTED', 'ADJUSTED'].includes(prev.value_status)) return { id: prev.id, skipped: prev.value_status };
    if (METRICS[kpi.formula_ref]?.manual) return { skipped: 'MANUAL' };
    if (!e.username && !['ATTENDANCE_PCT', 'TRAINING_COMPLIANCE_PCT'].includes(kpi.formula_ref)) return { skipped: 'NO_USER' };
    const r = evaluate(companyId, e, kpi, period, asOf);
    const status = r.value == null ? 'NO_DATA' : 'COMPUTED'; const score = scoreOf(r.value, kpi.target_value, kpi.direction);
    const ev = JSON.stringify(evidenceOf(kpi, e, r));
    if (prev) { db.prepare("UPDATE perf_kpi_values SET as_of = ?, value = ?, target_value = ?, score = ?, sample_size = ?, excluded_days = ?, evidence_json = ?, value_status = ?, computed_at = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(asOf, r.value, kpi.target_value, score, r.sample, r.excluded.length, ev, status, nowIso(), nowIso(), prev.id); return { id: prev.id, value: r.value, score }; }
    const id = Number(db.prepare("INSERT INTO perf_kpi_values (company_id, employee_id, kpi_code, period, as_of, value, target_value, score, sample_size, excluded_days, evidence_json, value_status, computed_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'perf_kpi')").run(companyId, e.id, kpi.code, period, asOf, r.value, kpi.target_value, score, r.sample, r.excluded.length, ev, status, nowIso()).lastInsertRowid);
    return { id, value: r.value, score };
  }
  const compute = {
    /** For one person or everybody (HR), for a month: every KPI that applies. The nightly job calls it for the current month. */
    run(actor, { employeeId = null, month = null } = /** @type {any} */ ({})) {
      const period = month ?? today().slice(0, 7); const asOf = today();
      let ids;
      if (employeeId) {
        if (!(may(actor, 'hr.perf.compute') || isLine(actor, employeeId) || myEmployee(actor) === employeeId)) throw forbidden('You may compute the KPIs of yourself and the people who report to you (HR computes anybody).');
        ids = [employeeId];
      } else { need(actor, 'hr.perf.compute', 'compute the KPIs of everybody'); ids = db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND employment_status IN ('ACTIVE', 'NOTICE')").all(actor.companyId).map((x) => x.id); }
      return compute.batch(actor.companyId, ids, period, asOf, actor);
    },
    batch(companyId, ids, period, asOf, actor = systemActor(companyId)) {
      let values = 0; let skipped = 0;
      transaction(db, () => { for (const id of ids) { const e = emp(id); if (!e || e.company_id !== companyId) continue; for (const k of kpisFor(companyId, e, asOf)) { const r = computeOne(companyId, e, k, period, asOf); if (r.skipped) skipped += 1; else values += 1; } } });
      writeAudit(db, { entity: 'perf_kpi_values', entityId: period, action: 'compute', newValues: { people: ids.length, values, skipped }, actor: actor.user, companyId });
      return { period, people: ids.length, values, skipped };
    },
    /** A KPI of the manual kind: the manager of the person enters the value with a note (the note is the evidence). */
    manual(actor, b) {
      const e = emp(b.employeeId); if (!e || e.company_id !== actor.companyId) throw notFound('That employee does not exist.');
      if (!(isLine(actor, b.employeeId) || may(actor, 'hr.perf.compute'))) throw forbidden('You enter manual KPI values for the people who report to you (HR for anybody).');
      if (myEmployee(actor) === b.employeeId) throw forbidden('Nobody enters their own KPI value.');
      const kpi = db.prepare("SELECT * FROM perf_kpis WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL AND kpi_status = 'ACTIVE' AND formula_ref = 'MANUAL'").get(actor.companyId, b.kpiCode);
      if (!kpi) throw badRequest('Some fields are not valid.', [{ field: 'kpiCode', message: 'Choose an active KPI of the manual kind' }]);
      const ev = JSON.stringify({ metric: 'MANUAL', employeeId: e.id, from: `${b.period}-01`, to: monthEnd(b.period), asOf: today(), note: b.note, enteredBy: actor.user, excluded: [], sample: 1, records: [] });
      const score = scoreOf(b.value, kpi.target_value, kpi.direction);
      const prev = db.prepare('SELECT * FROM perf_kpi_values WHERE company_id = ? AND employee_id = ? AND kpi_code = ? COLLATE NOCASE AND period = ? AND deleted_at IS NULL').get(actor.companyId, e.id, kpi.code, b.period);
      if (prev && prev.value_status === 'DISPUTED') throw unprocessable('This value is disputed and frozen until HR resolves the dispute.');
      if (prev) db.prepare("UPDATE perf_kpi_values SET value = ?, score = ?, evidence_json = ?, value_status = 'COMPUTED', as_of = ?, computed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.value, score, ev, today(), nowIso(), actor.user, nowIso(), prev.id);
      else db.prepare("INSERT INTO perf_kpi_values (company_id, employee_id, kpi_code, period, as_of, value, target_value, score, sample_size, excluded_days, evidence_json, value_status, computed_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 'COMPUTED', ?, ?, 'perf_kpi_manual')").run(actor.companyId, e.id, kpi.code, b.period, today(), b.value, kpi.target_value, score, ev, nowIso(), actor.user);
      writeAudit(db, { entity: 'perf_kpi_values', entityId: `${e.id}/${kpi.code}/${b.period}`, action: 'manual', newValues: { value: b.value, note: b.note }, actor: actor.user, companyId: actor.companyId });
      return { employeeId: e.id, kpiCode: kpi.code, period: b.period, value: b.value, score };
    },
  };
  const valueRow = (actor, id) => {
    const v = db.prepare('SELECT * FROM perf_kpi_values WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!v || !canSee(actor, v.employee_id)) throw notFound('That KPI value does not exist.');
    return v;
  };
  const valueView = (v, kpi) => ({ id: v.id, employeeId: v.employee_id, kpiCode: v.kpi_code, name: kpi?.name ?? v.kpi_code, nameHi: kpi?.name_hi ?? null, unit: kpi?.unit ?? 'PERCENT', direction: kpi?.direction ?? 'HIGHER', period: v.period, asOf: v.as_of, value: v.value, target: v.target_value, score: v.score, sample: v.sample_size, excludedDays: v.excluded_days, status: v.value_status, adjustReason: v.adjust_reason });
  const kpiOf = (companyId, code) => db.prepare('SELECT * FROM perf_kpis WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(companyId, code);
  /** The evidence of a value: the records behind it, the days left out, and the same figure computed again from the same query (T-01). */
  function evidence(actor, id) {
    const v = valueRow(actor, id); const kpi = kpiOf(actor.companyId, v.kpi_code); const ev = json(v.evidence_json, {});
    let reproduced = null;
    if (kpi && ev.metric && ev.metric !== 'MANUAL' && METRICS[ev.metric] && v.value_status !== 'ADJUSTED') {
      const e = emp(v.employee_id);
      const skip = excludedDays(db, actor.companyId, v.employee_id, ev.from, ev.to);
      const r = METRICS[ev.metric].run({ db, companyId: actor.companyId, employeeId: v.employee_id, user: e.username, from: ev.from, to: ev.to, asOf: ev.asOf, skip });
      reproduced = { value: r.value, sample: r.sample, matches: r.value === v.value && r.sample === v.sample_size };
    }
    return { ...valueView(v, kpi), metric: ev.metric, source: ev.source, from: ev.from, to: ev.to, excluded: ev.excluded ?? [], records: ev.records ?? [], truncated: Boolean(ev.truncated), note: ev.note ?? null, enteredBy: ev.enteredBy ?? null, reproduced,
      dispute: db.prepare("SELECT id, reason, dispute_status AS status, resolution, resolved_by AS resolvedBy FROM perf_kpi_disputes WHERE kpi_value_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(v.id) ?? null,
      can: { dispute: myEmployee(actor) === v.employee_id && v.value_status !== 'DISPUTED' && v.value_status !== 'NO_DATA' && !db.prepare("SELECT 1 FROM perf_kpi_disputes WHERE kpi_value_id = ? AND dispute_status = 'OPEN'").get(v.id) } };
  }

  // ------------------------------------------------------------------ disputes (FR-06)
  const disputes = {
    raise(actor, id, { reason }) {
      need(actor, 'hr.perf.own', 'dispute a KPI value');
      const v = valueRow(actor, id);
      if (myEmployee(actor) !== v.employee_id) throw forbidden('You dispute your own KPI values.');
      if (v.value_status === 'DISPUTED') throw conflict('This value is disputed already.');
      if (v.value_status === 'NO_DATA') throw unprocessable('There is nothing to dispute: no data was found for this month.');
      return transaction(db, () => {
        const did = Number(db.prepare("INSERT INTO perf_kpi_disputes (company_id, kpi_value_id, employee_id, reason, dispute_status, created_by, source_type) VALUES (?, ?, ?, ?, 'OPEN', ?, 'perf_dispute')").run(actor.companyId, id, v.employee_id, reason, actor.user).lastInsertRowid);
        db.prepare("UPDATE perf_kpi_values SET value_status = 'DISPUTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'perf_kpi_disputes', entityId: did, action: 'raise', reason, newValues: { kpiValueId: id }, actor: actor.user, companyId: actor.companyId });
        event('perf.kpi.disputed', actor, 'perf_kpi_dispute', did, actor.companyId, { employeeId: v.employee_id, kpiCode: v.kpi_code, period: v.period }, null, null);
        for (const u of hrUsers(actor.companyId)) tell(actor.companyId, u, 'perf.decided', { what: 'KPI dispute', ref: `#${did}`, title: `${v.kpi_code} ${v.period}`, decision: 'raised', comment: `: ${reason}` }, '/performance', `dispute:${did}`);
        return { id: did, status: 'OPEN', valueId: id };
      });
    },
    list(actor, { status = null } = /** @type {any} */ ({})) {
      if (!(may(actor, 'hr.perf.dispute_resolve') || may(actor, 'hr.perf.team'))) throw forbidden('You may not see disputes (permission hr.perf.dispute_resolve).');
      const all = may(actor, 'hr.perf.dispute_resolve') || seesAll(actor); const me = myEmployee(actor); const line = me ? reportees(me) : new Set();
      return db.prepare('SELECT d.*, e.full_name, e.emp_code, v.kpi_code, v.period, v.value, v.target_value FROM perf_kpi_disputes d JOIN hr_employees e ON e.id = d.employee_id JOIN perf_kpi_values v ON v.id = d.kpi_value_id WHERE d.company_id = ? AND d.deleted_at IS NULL AND (? IS NULL OR d.dispute_status = ?) ORDER BY d.id DESC LIMIT 200').all(actor.companyId, status, status)
        .filter((d) => all || line.has(d.employee_id)).map((d) => ({ id: d.id, valueId: d.kpi_value_id, employeeId: d.employee_id, employee: d.full_name, code: d.emp_code, kpiCode: d.kpi_code, period: d.period, value: d.value, target: d.target_value, reason: d.reason, status: d.dispute_status, resolution: d.resolution, resolvedBy: d.resolved_by, adjustedValue: d.adjusted_value }));
    },
    /** HR decides: upheld (the value is replaced by the corrected one, with the reason) or rejected (the value stands and is computed again). Not by the person who disputed it. */
    resolve(actor, id, b) {
      need(actor, 'hr.perf.dispute_resolve', 'resolve KPI disputes');
      const d = db.prepare('SELECT * FROM perf_kpi_disputes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!d) throw notFound('That dispute does not exist.');
      if (d.dispute_status !== 'OPEN') throw conflict('This dispute is resolved already.');
      if (myEmployee(actor) === d.employee_id) throw forbidden('You raised this dispute: HR decides it.');
      const v = db.prepare('SELECT * FROM perf_kpi_values WHERE id = ?').get(d.kpi_value_id); const kpi = kpiOf(actor.companyId, v.kpi_code);
      if (b.outcome === 'UPHELD' && b.adjustedValue == null) throw badRequest('Some fields are not valid.', [{ field: 'adjustedValue', message: 'Give the corrected value' }]);
      return transaction(db, () => {
        db.prepare('UPDATE perf_kpi_disputes SET dispute_status = ?, resolution = ?, adjusted_value = ?, resolved_by = ?, resolved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.outcome, b.resolution, b.adjustedValue ?? null, actor.user, nowIso(), actor.user, nowIso(), id);
        if (b.outcome === 'UPHELD') db.prepare("UPDATE perf_kpi_values SET value = ?, score = ?, value_status = 'ADJUSTED', adjusted_by = ?, adjust_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.adjustedValue, scoreOf(b.adjustedValue, v.target_value, kpi?.direction ?? 'HIGHER'), actor.user, b.resolution, actor.user, nowIso(), v.id);
        else { db.prepare("UPDATE perf_kpi_values SET value_status = 'COMPUTED', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), v.id); const e = emp(v.employee_id); if (kpi && e) computeOne(actor.companyId, e, kpi, v.period, today()); }
        writeAudit(db, { entity: 'perf_kpi_disputes', entityId: id, action: b.outcome.toLowerCase(), reason: b.resolution, newValues: { adjustedValue: b.adjustedValue ?? null }, actor: actor.user, companyId: actor.companyId });
        event('perf.kpi.dispute_resolved', actor, 'perf_kpi_dispute', id, actor.companyId, { employeeId: d.employee_id, kpiCode: v.kpi_code, period: v.period, outcome: b.outcome }, null, null);
        const to = usernameOf(emp(d.employee_id)?.user_id); tell(actor.companyId, to, 'perf.decided', { what: 'KPI dispute', ref: `#${id}`, title: `${v.kpi_code} ${v.period}`, decision: b.outcome === 'UPHELD' ? 'upheld' : 'rejected', comment: `: ${b.resolution}` }, '/performance', `dispute:${id}:r`);
        return { id, status: b.outcome };
      });
    },
  };

  // ------------------------------------------------------------------ the scores of a person in a cycle
  const openDisputes = (employeeId) => db.prepare("SELECT COUNT(*) AS n FROM perf_kpi_disputes WHERE employee_id = ? AND dispute_status = 'OPEN' AND deleted_at IS NULL").get(employeeId).n;
  function kpiSummary(companyId, employeeId, from, to) {
    const e = emp(employeeId); const asOf = to < today() ? to : today();
    const defs = kpisFor(companyId, e, asOf);
    const rows = [];
    for (const k of defs) {
      const values = db.prepare("SELECT * FROM perf_kpi_values WHERE company_id = ? AND employee_id = ? AND kpi_code = ? COLLATE NOCASE AND period >= ? AND period <= ? AND deleted_at IS NULL ORDER BY period").all(companyId, employeeId, k.code, from.slice(0, 7), to.slice(0, 7));
      const counted = values.filter((v) => ['COMPUTED', 'ADJUSTED'].includes(v.value_status) && v.score != null);
      rows.push({ kpi: k, values, avgScore: counted.length ? Math.round(counted.reduce((s, v) => s + v.score, 0) / counted.length) : null });
    }
    const weighted = rows.filter((r) => r.avgScore != null); const wsum = weighted.reduce((s, r) => s + r.kpi.weight, 0);
    return { rows, score: wsum ? Math.round(weighted.reduce((s, r) => s + r.kpi.weight * r.avgScore, 0) / wsum) : null };
  }
  const goalScore = (employeeId, cycleId) => { const g = db.prepare("SELECT weight, progress_pct FROM perf_goals WHERE employee_id = ? AND cycle_id = ? AND goal_status = 'AGREED' AND deleted_at IS NULL").all(employeeId, cycleId); const w = g.reduce((s, x) => s + x.weight, 0); return w ? Math.round(g.reduce((s, x) => s + x.weight * x.progress_pct, 0) / w) : null; };

  // ------------------------------------------------------------------ goals (FR-02)
  const goalView = (actor, g) => {
    const mine = myEmployee(actor) === g.employee_id; const line = isLine(actor, g.employee_id);
    return { id: g.id, employeeId: g.employee_id, cycleId: g.cycle_id, title: g.title, measure: g.measure, target: g.target_text, weight: g.weight, progress: g.progress_pct, status: g.goal_status, managerNote: g.manager_note, agreedBy: g.agreed_by, agreedAt: g.agreed_at, rowVersion: g.version,
      can: { edit: mine && ['DRAFT', 'RETURNED'].includes(g.goal_status), delete: mine && g.goal_status === 'DRAFT', propose: mine && ['DRAFT', 'RETURNED'].includes(g.goal_status), agree: line && g.goal_status === 'PROPOSED', return: line && g.goal_status === 'PROPOSED', progress: mine && g.goal_status === 'AGREED' } };
  };
  const goalRow = (actor, id) => { const g = db.prepare('SELECT * FROM perf_goals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!g || !canSee(actor, g.employee_id)) throw notFound('That goal does not exist.'); return g; };
  const weightLeft = (employeeId, cycleId, exceptId = 0) => 100 - db.prepare("SELECT COALESCE(SUM(weight), 0) AS w FROM perf_goals WHERE employee_id = ? AND cycle_id = ? AND goal_status IN ('PROPOSED', 'AGREED') AND deleted_at IS NULL AND id != ?").get(employeeId, cycleId, exceptId).w;
  const goals = {
    list(actor, { cycleId = null, employeeId = null } = /** @type {any} */ ({})) {
      need(actor, 'hr.perf.own', 'see goals');
      const c = currentCycle(actor.companyId, cycleId); if (!c) return { cycle: null, goals: [] };
      const target = employeeId ?? meOf(actor).id;
      if (!canSee(actor, target)) throw notFound('That employee does not exist.');
      return { cycle: cycleView(c), employeeId: target, goals: db.prepare('SELECT * FROM perf_goals WHERE company_id = ? AND employee_id = ? AND cycle_id = ? AND deleted_at IS NULL ORDER BY id').all(actor.companyId, target, c.id).map((g) => goalView(actor, g)), weightLeft: weightLeft(target, c.id) };
    },
    create(actor, b) {
      need(actor, 'hr.perf.own', 'set goals');
      const c = cycleRow(actor.companyId, b.cycleId); if (c.cycle_status === 'CLOSED') throw unprocessable('This cycle is closed.');
      const me = meOf(actor); const target = b.employeeId ?? me.id;
      const byManager = target !== me.id;
      if (byManager && !isLine(actor, target)) throw forbidden('You set goals for yourself and for the people who report to you.');
      if (b.weight > weightLeft(target, c.id) && (byManager)) throw unprocessable(`Only ${weightLeft(target, c.id)}% of the weight is left for this person.`);
      const status = byManager ? 'AGREED' : 'DRAFT';
      const id = Number(db.prepare('INSERT INTO perf_goals (company_id, employee_id, cycle_id, title, measure, target_text, weight, goal_status, agreed_by, agreed_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, target, c.id, b.title, b.measure ?? null, b.target ?? null, b.weight, status, byManager ? actor.user : null, byManager ? nowIso() : null, actor.user, 'perf_goal').lastInsertRowid);
      writeAudit(db, { entity: 'perf_goals', entityId: id, action: 'create', newValues: { title: b.title, weight: b.weight, byManager }, actor: actor.user, companyId: actor.companyId });
      if (byManager) event('perf.goal.agreed', actor, 'perf_goal', id, actor.companyId, { employeeId: target, cycleId: c.id, title: b.title, weight: b.weight }, null, null);
      return goalView(actor, goalRow(actor, id));
    },
    update(actor, id, b) {
      const g = goalRow(actor, id);
      if (myEmployee(actor) !== g.employee_id || !['DRAFT', 'RETURNED'].includes(g.goal_status)) throw conflict('Only your own goal that is a draft or returned is changed.');
      if (b.version !== g.version) throw conflict('This goal was changed by someone else. Reload it and try again.');
      db.prepare('UPDATE perf_goals SET title = ?, measure = ?, target_text = ?, weight = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.title, b.measure ?? null, b.target ?? null, b.weight, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'perf_goals', entityId: id, action: 'update', newValues: { title: b.title, weight: b.weight }, actor: actor.user, companyId: actor.companyId });
      return goalView(actor, goalRow(actor, id));
    },
    remove(actor, id) {
      const g = goalRow(actor, id);
      if (myEmployee(actor) !== g.employee_id || g.goal_status !== 'DRAFT') throw conflict('Only your own draft goal is deleted.');
      db.prepare('UPDATE perf_goals SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'perf_goals', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    propose(actor, id) {
      const g = goalRow(actor, id);
      if (myEmployee(actor) !== g.employee_id || !['DRAFT', 'RETURNED'].includes(g.goal_status)) throw conflict('Only your own draft or returned goal is sent to your manager.');
      if (g.weight > weightLeft(g.employee_id, g.cycle_id, id)) throw unprocessable(`The weights would pass 100%: only ${weightLeft(g.employee_id, g.cycle_id, id)}% is left.`);
      db.prepare("UPDATE perf_goals SET goal_status = 'PROPOSED', manager_note = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
      writeAudit(db, { entity: 'perf_goals', entityId: id, action: 'propose', actor: actor.user, companyId: actor.companyId });
      const m = emp(g.employee_id)?.manager_id; const to = m ? usernameOf(emp(m)?.user_id) : null;
      tell(actor.companyId, to, 'perf.decided', { what: 'Goal', ref: `#${id}`, title: g.title, decision: 'sent for your agreement', comment: '' }, '/performance/goals', `goal:${id}:p`);
      return goalView(actor, goalRow(actor, id));
    },
    agree(actor, id) {
      const g = goalRow(actor, id);
      if (!isLine(actor, g.employee_id)) throw forbidden('Your manager agrees your goals; you cannot agree your own.');
      if (g.goal_status !== 'PROPOSED') throw conflict('Only a goal that was sent for agreement is agreed.');
      db.prepare("UPDATE perf_goals SET goal_status = 'AGREED', agreed_by = ?, agreed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'perf_goals', entityId: id, action: 'agree', actor: actor.user, companyId: actor.companyId });
      event('perf.goal.agreed', actor, 'perf_goal', id, actor.companyId, { employeeId: g.employee_id, cycleId: g.cycle_id, title: g.title, weight: g.weight }, null, null);
      tell(actor.companyId, usernameOf(emp(g.employee_id)?.user_id), 'perf.decided', { what: 'Goal', ref: `#${id}`, title: g.title, decision: 'agreed', comment: '' }, '/performance/goals', `goal:${id}:a`);
      return goalView(actor, goalRow(actor, id));
    },
    giveBack(actor, id, { reason }) {
      const g = goalRow(actor, id);
      if (!isLine(actor, g.employee_id)) throw forbidden('Your manager returns your goals.');
      if (g.goal_status !== 'PROPOSED') throw conflict('Only a goal that was sent for agreement is returned.');
      db.prepare("UPDATE perf_goals SET goal_status = 'RETURNED', manager_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'perf_goals', entityId: id, action: 'return', reason, actor: actor.user, companyId: actor.companyId });
      tell(actor.companyId, usernameOf(emp(g.employee_id)?.user_id), 'perf.decided', { what: 'Goal', ref: `#${id}`, title: g.title, decision: 'returned for correction', comment: `: ${reason}` }, '/performance/goals', `goal:${id}:r`);
      return goalView(actor, goalRow(actor, id));
    },
    progress(actor, id, { progress }) {
      const g = goalRow(actor, id);
      if (myEmployee(actor) !== g.employee_id || g.goal_status !== 'AGREED') throw conflict('You update the progress of your own agreed goal.');
      db.prepare('UPDATE perf_goals SET progress_pct = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(progress, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'perf_goals', entityId: id, action: 'progress', newValues: { progress }, actor: actor.user, companyId: actor.companyId });
      return goalView(actor, goalRow(actor, id));
    },
  };

  // ------------------------------------------------------------------ feedback, recognition and one-to-one notes (FR-04)
  const feedback = {
    give(actor, b) {
      need(actor, 'hr.perf.feedback', 'give feedback');
      const me = meOf(actor); const e = emp(b.employeeId);
      if (!e || e.company_id !== actor.companyId || e.deleted_at) throw notFound('That employee does not exist.');
      if (e.id === me.id) throw forbidden('Feedback is for somebody else.');
      if (b.kind !== 'RECOGNITION' && !(isLine(actor, e.id) || seesAll(actor))) throw forbidden('You give feedback and one-to-one notes to the people who report to you; recognition can go to anybody.');
      const shared = b.kind === 'RECOGNITION' ? 1 : b.shared === false ? 0 : 1;
      const id = Number(db.prepare('INSERT INTO perf_feedback (company_id, employee_id, author, author_employee_id, kind, body, shared, meeting_date, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, e.id, actor.user, me.id, b.kind, b.body, shared, b.meetingDate ?? null, actor.user, 'perf_feedback').lastInsertRowid);
      writeAudit(db, { entity: 'perf_feedback', entityId: id, action: 'create', newValues: { kind: b.kind, employeeId: e.id }, actor: actor.user, companyId: actor.companyId });
      event('perf.feedback.given', actor, 'perf_feedback', id, actor.companyId, { employeeId: e.id, kind: b.kind }, null, null);
      if (shared) tell(actor.companyId, usernameOf(e.user_id), 'perf.feedback', { kind: b.kind === 'RECOGNITION' ? 'recognition' : b.kind === 'ONE_TO_ONE' ? 'one-to-one note' : 'feedback', from: me.full_name, body: b.body.slice(0, 120) }, '/performance/feedback', `fb:${id}`);
      return { id, kind: b.kind, employeeId: e.id, shared: Boolean(shared) };
    },
    /** What a person sees: what was written about them and shared, what they wrote; a manager also the private notes they wrote; HR everything. */
    list(actor, { employeeId = null } = /** @type {any} */ ({})) {
      need(actor, 'hr.perf.own', 'see feedback');
      const meId = employeeId && seesAll(actor) ? myEmployee(actor) : meOf(actor).id; const target = employeeId ?? meId;
      if (!canSee(actor, target)) throw notFound('That employee does not exist.');
      const me = { id: meId };
      const rows = db.prepare('SELECT f.*, a.full_name AS author_name, p.full_name AS person FROM perf_feedback f LEFT JOIN hr_employees a ON a.id = f.author_employee_id JOIN hr_employees p ON p.id = f.employee_id WHERE f.company_id = ? AND f.deleted_at IS NULL AND (f.employee_id = ? OR (? = 1 AND f.author_employee_id = ?)) ORDER BY f.id DESC LIMIT 200').all(actor.companyId, target, target === me.id ? 1 : 0, me.id ?? 0);
      return rows.filter((f) => f.shared === 1 || same(f.author, actor.user) || seesAll(actor)).map((f) => ({ id: f.id, employeeId: f.employee_id, person: f.person, kind: f.kind, body: f.body, shared: Boolean(f.shared), meetingDate: f.meeting_date, author: f.author_name ?? f.author, at: f.created_at, direction: f.employee_id === me.id ? 'RECEIVED' : 'GIVEN' }));
    },
  };

  // ------------------------------------------------------------------ the dashboards (My Performance, Team Performance)
  const trendOf = (companyId, employeeId, code, uptoPeriod) => db.prepare("SELECT id, period, value, score, value_status FROM perf_kpi_values WHERE company_id = ? AND employee_id = ? AND kpi_code = ? COLLATE NOCASE AND period <= ? AND deleted_at IS NULL ORDER BY period DESC LIMIT 6").all(companyId, employeeId, code, uptoPeriod).reverse();
  const tone = (score) => (score == null ? 'NONE' : score >= 80 ? 'GREEN' : score >= 60 ? 'AMBER' : 'RED');
  function dashboard(actor, employeeId, cycleId) {
    const e = emp(employeeId); const c = currentCycle(actor.companyId, cycleId);
    const to = c ? (c.end_date < today() ? c.end_date : today()) : today(); const from = c ? c.start_date : `${today().slice(0, 4)}-01-01`;
    const sum = kpiSummary(actor.companyId, employeeId, from, to);
    const kpis = sum.rows.map(({ kpi, values, avgScore }) => {
      const latest = [...values].reverse().find((v) => v.value_status !== 'NO_DATA') ?? values[values.length - 1] ?? null;
      return { code: kpi.code, name: kpi.name, nameHi: kpi.name_hi, unit: kpi.unit, direction: kpi.direction, target: kpi.target_value, weight: kpi.weight, formulaRef: kpi.formula_ref, avgScore, tone: tone(latest?.score ?? avgScore),
        latest: latest ? { id: latest.id, period: latest.period, value: latest.value, score: latest.score, status: latest.value_status, sample: latest.sample_size, excludedDays: latest.excluded_days } : null,
        trend: trendOf(actor.companyId, employeeId, kpi.code, to.slice(0, 7)).map((v) => ({ id: v.id, period: v.period, value: v.value, score: v.score, status: v.value_status })) };
    });
    const review = c ? db.prepare("SELECT * FROM perf_reviews WHERE employee_id = ? AND cycle_id = ? AND deleted_at IS NULL AND status != 'CANCELLED'").get(employeeId, c.id) : null;
    const gl = c ? db.prepare("SELECT goal_status, COUNT(*) AS n FROM perf_goals WHERE employee_id = ? AND cycle_id = ? AND deleted_at IS NULL GROUP BY goal_status").all(employeeId, c.id) : [];
    const goalCounts = Object.fromEntries(gl.map((x) => [x.goal_status, x.n]));
    return { employee: { id: e.id, name: e.full_name, code: e.emp_code, designation: e.designation, department: e.department }, cycle: c ? cycleView(c) : null, kpiScore: sum.score, tone: tone(sum.score), kpis, goalScore: c ? goalScore(employeeId, c.id) : null, goalCounts,
      review: review ? { id: review.id, docNo: review.doc_no, stage: review.stage, status: review.status } : null, openDisputes: openDisputes(employeeId), feedbackCount: db.prepare('SELECT COUNT(*) AS n FROM perf_feedback WHERE employee_id = ? AND shared = 1 AND deleted_at IS NULL').get(employeeId).n };
  }
  const my = {
    get(actor, { cycleId = null } = /** @type {any} */ ({})) {
      need(actor, 'hr.perf.own', 'see your performance');
      const me = meOf(actor); const d = dashboard(actor, me.id, cycleId); const pending = [];
      if (d.review && d.review.stage === 'SELF' && d.review.status === 'DRAFT') pending.push({ kind: 'SELF_REVIEW', to: `/performance/review?id=${d.review.id}` });
      if ((d.goalCounts.DRAFT ?? 0) + (d.goalCounts.RETURNED ?? 0) > 0) pending.push({ kind: 'GOALS_TO_SEND', to: '/performance/goals' });
      if (d.cycle && d.cycle.status === 'OPEN' && !d.goalCounts.AGREED && !d.goalCounts.PROPOSED && !d.goalCounts.DRAFT) pending.push({ kind: 'SET_GOALS', to: '/performance/goals' });
      if (isManager(me.id)) { const n = db.prepare("SELECT COUNT(*) AS n FROM perf_goals g JOIN hr_employees p ON p.id = g.employee_id WHERE g.company_id = ? AND g.goal_status = 'PROPOSED' AND g.deleted_at IS NULL AND p.manager_id = ?").get(actor.companyId, me.id).n; if (n) pending.push({ kind: 'GOALS_TO_AGREE', n, to: '/performance/team' }); }
      return { ...d, pending, isManager: isManager(me.id), can: { compute: true } };
    },
    evidence,
  };
  const isManager = (employeeId) => Boolean(db.prepare('SELECT 1 FROM hr_employees WHERE manager_id = ? AND deleted_at IS NULL LIMIT 1').get(employeeId));
  const team = {
    get(actor, { cycleId = null } = /** @type {any} */ ({})) {
      need(actor, 'hr.perf.team', 'see your team performance');
      const me = meOf(actor); const ids = seesAll(actor) ? null : [...reportees(me.id)];
      const c = currentCycle(actor.companyId, cycleId);
      const people = db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND employment_status IN ('ACTIVE', 'NOTICE')").all(actor.companyId).map((x) => x.id).filter((id) => id !== me.id && (!ids || ids.includes(id)));
      const rows = people.slice(0, 300).map((id) => {
        const e = emp(id); const to = c ? (c.end_date < today() ? c.end_date : today()) : today(); const sum = kpiSummary(actor.companyId, id, c?.start_date ?? `${today().slice(0, 4)}-01-01`, to);
        const rv = c ? db.prepare("SELECT id, doc_no, stage, status FROM perf_reviews WHERE employee_id = ? AND cycle_id = ? AND deleted_at IS NULL AND status != 'CANCELLED'").get(id, c.id) : null;
        const g = c ? db.prepare("SELECT goal_status AS s, COUNT(*) AS n FROM perf_goals WHERE employee_id = ? AND cycle_id = ? AND deleted_at IS NULL GROUP BY goal_status").all(id, c.id) : [];
        const gc = Object.fromEntries(g.map((x) => [x.s, x.n]));
        return { id, name: e.full_name, code: e.emp_code, designation: e.designation, kpiScore: sum.score, tone: tone(sum.score), goalsAgreed: gc.AGREED ?? 0, goalsWaiting: gc.PROPOSED ?? 0, goalScore: c ? goalScore(id, c.id) : null, review: rv ? { id: rv.id, docNo: rv.doc_no, stage: rv.stage, status: rv.status } : null, openDisputes: openDisputes(id), direct: db.prepare('SELECT 1 FROM hr_employees WHERE id = ? AND manager_id = ?').get(id, me.id) != null };
      });
      const scored = rows.filter((r) => r.kpiScore != null);
      return { cycle: c ? cycleView(c) : null, summary: { people: rows.length, avgScore: scored.length ? Math.round(scored.reduce((s, r) => s + r.kpiScore, 0) / scored.length) : null, green: rows.filter((r) => r.tone === 'GREEN').length, amber: rows.filter((r) => r.tone === 'AMBER').length, red: rows.filter((r) => r.tone === 'RED').length, goalsWaiting: rows.reduce((s, r) => s + r.goalsWaiting, 0), reviewsWaiting: rows.filter((r) => r.review && r.review.stage === 'MANAGER' && r.review.status === 'DRAFT').length, openDisputes: rows.reduce((s, r) => s + r.openDisputes, 0) }, people: rows };
    },
    member(actor, employeeId, { cycleId = null } = /** @type {any} */ ({})) {
      need(actor, 'hr.perf.team', 'see the performance of your team');
      if (!canSee(actor, employeeId) || myEmployee(actor) === employeeId) throw notFound('That person does not report to you.');
      return dashboard(actor, employeeId, cycleId);
    },
  };

  // ------------------------------------------------------------------ the review cycle (FR-05)
  const rowOf = (actor, id) => {
    const r = db.prepare('SELECT * FROM perf_reviews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!r || !(canSee(actor, r.employee_id))) throw notFound('That review does not exist.');
    return r;
  };
  function view(actor, r, { detail = false } = {}) {
    const e = emp(r.employee_id); const c = db.prepare('SELECT * FROM perf_cycles WHERE id = ?').get(r.cycle_id);
    const mine = myEmployee(actor) === r.employee_id; const line = isLine(actor, r.employee_id); const all = seesAll(actor);
    const final = r.status === 'APPROVED';
    const hideManager = mine && !all && !final;
    const out = {
      id: r.id, docNo: r.doc_no, employeeId: r.employee_id, employee: e.full_name, code: e.emp_code, designation: e.designation, cycleId: r.cycle_id, cycle: c.name, stage: r.stage, stageLabel: STAGES[r.stage], status: r.status, statusLabel: REVIEW_STATUS[r.status], band: r.band, rowVersion: r.version,
      selfRating: r.self_rating, selfComments: r.self_comments, selfAt: r.self_at, kpiScore: r.kpi_score, goalScore: r.goal_score,
      managerRating: hideManager ? null : r.manager_rating, managerComments: hideManager ? null : r.manager_comments, managerBy: hideManager ? null : r.manager_by, calibratedRating: hideManager ? null : r.calibrated_rating, calibrationReason: mine && !all ? null : r.calibration_reason,
      finalRating: mine && !all && !final ? null : r.final_rating, finalLabel: r.final_rating && (final || !mine || all) ? RATING_LABELS[r.final_rating] : null, developmentPlan: hideManager ? null : r.development_plan, workflowInstanceId: r.workflow_instance_id, letterIssued: Boolean(r.letter_doc_id), approvedAt: r.approved_at, requestedBy: r.requested_by, hidden: hideManager,
      can: {
        self: mine && r.stage === 'SELF' && r.status === 'DRAFT' && c.cycle_status === 'OPEN' && may(actor, 'hr.review.edit'),
        manager: line && r.stage === 'MANAGER' && r.status === 'DRAFT' && may(actor, 'hr.review.edit'),
        calibrate: all && may(actor, 'hr.review.calibrate') && ['CALIBRATION', 'FINAL'].includes(r.stage) && ['DRAFT', 'RETURNED'].includes(r.status) && !mine,
        submit: may(actor, 'hr.review.submit') && r.stage === 'FINAL' && ['DRAFT', 'RETURNED'].includes(r.status) && all && !mine,
        withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: ['DRAFT', 'SUBMITTED', 'RETURNED'].includes(r.status) && may(actor, 'hr.review.cancel') && all,
        sendBack: all && may(actor, 'hr.review.calibrate') && ['CALIBRATION', 'FINAL'].includes(r.stage) && r.status !== 'SUBMITTED',
        letter: final && !r.letter_doc_id && may(actor, 'hr.review.letter'), download: final && Boolean(r.letter_doc_id) && (mine || may(actor, 'hr.review.letter')), print: may(actor, 'hr.review.print') && (all || line || mine),
      },
    };
    if (detail) {
      out.cycleDetail = cycleView(c);
      out.kpis = kpiSummary(actor.companyId, r.employee_id, c.start_date, c.end_date < today() ? c.end_date : today()).rows.map(({ kpi, values, avgScore }) => ({ code: kpi.code, name: kpi.name, nameHi: kpi.name_hi, unit: kpi.unit, target: kpi.target_value, weight: kpi.weight, avgScore, values: values.map((v) => ({ id: v.id, period: v.period, value: v.value, score: v.score, status: v.value_status })) }));
      out.goals = db.prepare("SELECT * FROM perf_goals WHERE employee_id = ? AND cycle_id = ? AND goal_status = 'AGREED' AND deleted_at IS NULL ORDER BY id").all(r.employee_id, r.cycle_id).map((g) => ({ id: g.id, title: g.title, measure: g.measure, target: g.target_text, weight: g.weight, progress: g.progress_pct }));
      out.openDisputes = openDisputes(r.employee_id);
      out.feedback = db.prepare("SELECT kind, body, created_at FROM perf_feedback WHERE employee_id = ? AND shared = 1 AND deleted_at IS NULL AND created_at >= ? ORDER BY id DESC LIMIT 20").all(r.employee_id, c.start_date).map((f) => ({ kind: f.kind, body: f.body, at: f.created_at }));
    }
    return out;
  }
  const refreshScores = (r) => { const c = db.prepare('SELECT * FROM perf_cycles WHERE id = ?').get(r.cycle_id); const s = kpiSummary(r.company_id, r.employee_id, c.start_date, c.end_date < today() ? c.end_date : today()); db.prepare('UPDATE perf_reviews SET kpi_score = ?, goal_score = ? WHERE id = ?').run(s.score, goalScore(r.employee_id, r.cycle_id), r.id); };
  const reviews = {
    list(actor, query) {
      need(actor, 'hr.review.view', 'see appraisal reviews');
      const me = myEmployee(actor); const ids = seesAll(actor) ? null : [me, ...(me ? reportees(me) : [])].filter(Boolean);
      return runList(db, reviewList, parseListRequest(reviewList, query), { select: 'r.*', scopeSql: `r.company_id = :c${ids ? ` AND r.employee_id IN (${ids.length ? ids.join(',') : '0'})` : ''}`, params: { c: actor.companyId }, tieBreaker: 'r.id', map: (r) => view(actor, r) });
    },
    exportSource(actor, req) {
      need(actor, 'hr.review.export', 'export appraisal reviews');
      const opts = { select: 'r.*', scopeSql: 'r.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'r.id' };
      return { title: reviewList.label, permission: 'hr.review.export', personal: true, columns: [...Object.entries(reviewList.columns).filter(([k]) => k !== 'cycleId').map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), { key: 'finalRating', label: 'Final rating', type: 'number' }], count: () => countList(db, reviewList, req, opts), rows: () => runList(db, reviewList, req, { ...opts, limit: null, map: (r) => { const v = view(actor, r); return { docNo: v.docNo, employee: v.employee, code: v.code, cycle: v.cycle, stage: v.stageLabel, status: v.statusLabel, band: v.band, kpiScore: v.kpiScore, finalRating: v.finalRating }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${reviewList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { return view(actor, rowOf(actor, id), { detail: true }); },
    /** HR makes the reviews of an open cycle: one for each person in service who joined before the cycle ended. A person who has one already is left alone. */
    launch(actor, { cycleId }) {
      need(actor, 'hr.review.create', 'start the reviews of a cycle');
      const c = cycleRow(actor.companyId, cycleId);
      if (c.cycle_status !== 'OPEN') throw unprocessable('Open the cycle before its reviews are made.');
      let made = 0;
      transaction(db, () => {
        for (const e of db.prepare("SELECT e.id, e.user_id, g.level FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.record_status = 'APPROVED' AND e.employment_status IN ('ACTIVE', 'NOTICE') AND e.doj <= ?").all(actor.companyId, c.end_date)) {
          if (db.prepare("SELECT 1 FROM perf_reviews WHERE cycle_id = ? AND employee_id = ? AND deleted_at IS NULL AND status != 'CANCELLED'").get(c.id, e.id)) continue;
          const no = nextDoc(actor, REVIEW_DOC, 'perf_reviews', 'APR');
          const id = Number(db.prepare("INSERT INTO perf_reviews (company_id, doc_no, doc_date, employee_id, cycle_id, stage, status, band, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'SELF', 'DRAFT', ?, ?, 'perf_review')").run(actor.companyId, no, today(), e.id, c.id, (e.level ?? 1) >= c.senior_from_level ? 'SENIOR' : 'STANDARD', actor.user).lastInsertRowid);
          writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'create', newValues: { docNo: no, cycle: c.code }, actor: actor.user, companyId: actor.companyId });
          tell(actor.companyId, usernameOf(e.user_id), 'perf.cycle_open', { cycle: c.name, due: c.self_due ?? c.end_date }, `/performance/review?id=${id}`, `cycle:${c.id}:${e.id}`);
          made += 1;
        }
        event('perf.review.launched', actor, 'perf_cycle', c.id, actor.companyId, { code: c.code, reviews: made }, null, null);
      });
      return { cycleId: c.id, made, total: db.prepare("SELECT COUNT(*) AS n FROM perf_reviews WHERE cycle_id = ? AND deleted_at IS NULL AND status != 'CANCELLED'").get(c.id).n };
    },
    self(actor, id, b) {
      const r = rowOf(actor, id); need(actor, 'hr.review.edit', 'write your self-review');
      if (myEmployee(actor) !== r.employee_id) throw forbidden('You write your own self-review.');
      if (r.stage !== 'SELF' || r.status !== 'DRAFT') throw conflict('Your self-review was sent already.');
      db.prepare("UPDATE perf_reviews SET self_rating = ?, self_comments = ?, self_at = ?, stage = 'MANAGER', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.rating, b.comments, nowIso(), actor.user, nowIso(), id);
      refreshScores(r);
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'self_review', newValues: { rating: b.rating }, actor: actor.user, companyId: actor.companyId });
      event('perf.review.self_submitted', actor, 'perf_review', id, actor.companyId, { employeeId: r.employee_id, cycleId: r.cycle_id }, null, null);
      const m = emp(r.employee_id).manager_id; tell(actor.companyId, m ? usernameOf(emp(m)?.user_id) : null, 'perf.decided', { what: 'Review', ref: r.doc_no, title: emp(r.employee_id).full_name, decision: 'ready for your review', comment: '' }, `/performance/review?id=${id}`, `rv:${id}:s`);
      return reviews.get(actor, id);
    },
    manager(actor, id, b) {
      const r = rowOf(actor, id); need(actor, 'hr.review.edit', 'write a manager review');
      if (!isLine(actor, r.employee_id)) throw forbidden('The manager of the person writes the manager review; nobody reviews themselves.');
      if (r.stage !== 'MANAGER' || r.status !== 'DRAFT') throw conflict(r.stage === 'SELF' ? 'The person has not written their self-review yet.' : 'The manager review was sent already.');
      db.prepare("UPDATE perf_reviews SET manager_rating = ?, manager_comments = ?, manager_by = ?, manager_at = ?, stage = 'CALIBRATION', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.rating, b.comments, actor.user, nowIso(), actor.user, nowIso(), id);
      refreshScores(r);
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'manager_review', newValues: { rating: b.rating }, actor: actor.user, companyId: actor.companyId });
      event('perf.review.manager_reviewed', actor, 'perf_review', id, actor.companyId, { employeeId: r.employee_id, cycleId: r.cycle_id }, null, null);
      for (const u of hrUsers(actor.companyId)) tell(actor.companyId, u, 'perf.decided', { what: 'Review', ref: r.doc_no, title: emp(r.employee_id).full_name, decision: 'waits for calibration', comment: '' }, `/performance/review?id=${id}`, `rv:${id}:m:${u}`);
      return reviews.get(actor, id);
    },
    /** HR compares the ratings of the managers across the cycle and sets the rating to be approved; a rating that differs from the manager's carries the reason, and the development plan is written here. */
    calibrate(actor, id, b) {
      need(actor, 'hr.review.calibrate', 'calibrate ratings');
      const r = rowOf(actor, id);
      if (myEmployee(actor) === r.employee_id) throw forbidden('Your own review is calibrated by somebody else.');
      if (!['CALIBRATION', 'FINAL'].includes(r.stage) || !['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('This review is not at calibration.');
      if (b.rating !== r.manager_rating && !(b.reason && b.reason.length >= 5)) throw badRequest('Some fields are not valid.', [{ field: 'reason', message: 'Say why the rating differs from the manager\'s (at least 5 characters)' }]);
      db.prepare("UPDATE perf_reviews SET calibrated_rating = ?, calibration_reason = ?, calibrated_by = ?, calibrated_at = ?, final_rating = ?, development_plan = ?, stage = 'FINAL', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.rating, b.reason ?? null, actor.user, nowIso(), b.rating, b.developmentPlan, actor.user, nowIso(), id);
      refreshScores(r);
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'calibrate', oldValues: { managerRating: r.manager_rating }, newValues: { rating: b.rating }, reason: b.reason ?? null, actor: actor.user, companyId: actor.companyId });
      event('perf.review.calibrated', actor, 'perf_review', id, actor.companyId, { employeeId: r.employee_id, cycleId: r.cycle_id, managerRating: r.manager_rating, rating: b.rating }, null, null);
      return reviews.get(actor, id);
    },
    sendBack(actor, id, { reason }) {
      need(actor, 'hr.review.calibrate', 'send a review back');
      const r = rowOf(actor, id);
      if (!['CALIBRATION', 'FINAL'].includes(r.stage) || r.status === 'SUBMITTED') throw conflict('This review cannot be sent back to the manager now.');
      db.prepare("UPDATE perf_reviews SET stage = 'MANAGER', status = 'DRAFT', calibrated_rating = NULL, final_rating = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'send_back', reason, actor: actor.user, companyId: actor.companyId });
      return reviews.get(actor, id);
    },
    /** The final rating goes to the manager, the skip-level reviewer and the HR manager (the director too for a senior grade). A person with a KPI dispute still open is not sent: the dispute is decided first (BR-01). */
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      need(actor, 'hr.review.submit', 'send final ratings for approval');
      const r = rowOf(actor, id);
      if (r.stage !== 'FINAL' || !['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(r.stage === 'FINAL' ? `This review is ${REVIEW_STATUS[r.status].toLowerCase()}.` : 'Calibrate the rating before it is sent for approval.');
      if (myEmployee(actor) === r.employee_id) throw forbidden('Your own review is sent by somebody else.');
      const open = openDisputes(r.employee_id);
      if (open) throw unprocessable(`${open} KPI dispute(s) of this person are still open: HR decides them first, because a disputed KPI is frozen.`);
      return transaction(db, () => {
        refreshScores(r);
        const ctx = { band: r.band, rating: r.final_rating, employeeId: r.employee_id };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: REVIEW_DOC, docId: id, comment: comment ?? 'Final rating', context: ctx }); db.prepare('UPDATE perf_reviews SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE perf_reviews SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return reviews.get(actor, id);
      });
    },
    withdraw(actor, id, { reason }) {
      const r = rowOf(actor, id);
      if (r.status !== 'SUBMITTED') throw unprocessable('Only a rating in approval is withdrawn.');
      if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason });
      return reviews.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      need(actor, 'hr.review.cancel', 'cancel reviews');
      const r = rowOf(actor, id);
      if (!['DRAFT', 'SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable('An approved or closed review is not cancelled.');
      return transaction(db, () => {
        if (r.status === 'SUBMITTED') { workflowOf(db).cancel(actor, r.workflow_instance_id, { reason }); return reviews.get(actor, id); }
        db.prepare("UPDATE perf_reviews SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        return reviews.get(actor, id);
      });
    },
    remove(actor, id) {
      need(actor, 'hr.review.delete', 'delete reviews');
      const r = rowOf(actor, id);
      if (r.status !== 'DRAFT' || r.stage !== 'SELF' || r.self_rating) throw conflict('Only a review nobody has started is deleted; cancel the others.');
      db.prepare('UPDATE perf_reviews SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    history(actor, id) {
      const r = rowOf(actor, id);
      return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'perf_reviews' AND entity_id = ? ORDER BY id").all(String(id)).map((x) => ({ action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
    },
    print(actor, id) {
      need(actor, 'hr.review.print', 'print reviews');
      const v = view(actor, rowOf(actor, id), { detail: true });
      const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)} appraisal</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>Appraisal ${esc(v.docNo)}</h1><p>${esc(v.employee)} (${esc(v.code)}) · ${esc(v.designation ?? '')} · ${esc(v.cycle)} · ${esc(v.statusLabel)}</p><p>Self rating: ${esc(v.selfRating ?? '—')} · Manager rating: ${esc(v.managerRating ?? '—')} · Calibrated: ${esc(v.calibratedRating ?? '—')} · Final: ${esc(v.finalRating ?? '—')} ${esc(v.finalLabel ?? '')}</p><p>KPI score: ${esc(v.kpiScore ?? '—')} · Goal score: ${esc(v.goalScore ?? '—')}</p><h2>KPIs</h2><table><tr><th>KPI</th><th>Target</th><th>Weight</th><th>Score</th></tr>${v.kpis.map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.target)}</td><td>${esc(k.weight)}</td><td>${esc(k.avgScore ?? '—')}</td></tr>`).join('')}</table><h2>Goals</h2><table><tr><th>Goal</th><th>Weight</th><th>Progress</th></tr>${v.goals.map((g) => `<tr><td>${esc(g.title)}</td><td>${esc(g.weight)}</td><td>${esc(g.progress)}%</td></tr>`).join('')}</table><h2>Development plan</h2><p>${esc(v.developmentPlan ?? '')}</p></body></html>`;
    },
    /** The appraisal letter of an approved review, from the template library (04.11): a numbered, verifiable PDF the employee downloads. */
    async letter(actor, id) {
      need(actor, 'hr.review.letter', 'issue appraisal letters');
      const r = rowOf(actor, id);
      if (r.status !== 'APPROVED') throw unprocessable('Only an approved review has a letter.');
      if (r.letter_doc_id) throw conflict('The letter was issued already.');
      const tpl = templateServiceOf(db); if (!tpl) throw unprocessable('The document templates are not running.');
      const e = emp(r.employee_id); const c = db.prepare('SELECT * FROM perf_cycles WHERE id = ?').get(r.cycle_id); const company = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? '';
      const text = `${e.full_name} (employee code ${e.emp_code}), ${e.designation ?? 'employee'} of ${company}: your performance for ${c.name} (${c.start_date} to ${c.end_date}) was rated ${r.final_rating} of 5, ${RATING_LABELS[r.final_rating].toLowerCase()}. ${r.development_plan ? `Development plan: ${r.development_plan}` : ''}`.trim();
      const entityId = `PRF-${r.id}`;
      tpl.records.publish(systemActor(actor.companyId), { docType: 'CERTIFICATE', entityId, docNo: r.doc_no, approved: true, data: { certificate: { title: 'Appraisal letter', text }, recipient: { name: e.full_name }, issuedFor: c.name, issuedOn: today(), lines: [] }, reason: 'Appraisal letter' });
      const doc = await tpl.generate(actor, { docType: 'CERTIFICATE', entityId, reason: 'Appraisal letter' });
      db.prepare('UPDATE perf_reviews SET letter_doc_id = ?, letter_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(doc.id, nowIso(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: 'letter', newValues: { generatedDocId: doc.id }, actor: actor.user, companyId: actor.companyId });
      tell(actor.companyId, usernameOf(e.user_id), 'perf.decided', { what: 'Appraisal letter', ref: r.doc_no, title: c.name, decision: 'issued: you can download it', comment: '' }, `/performance/review?id=${id}`, `rv:${id}:l`);
      return reviews.get(actor, id);
    },
    async letterContent(actor, id, { download = true } = {}) {
      const r = rowOf(actor, id);
      if (!r.letter_doc_id) throw unprocessable('The letter has not been issued yet.');
      if (!(myEmployee(actor) === r.employee_id || may(actor, 'hr.review.letter'))) throw forbidden('You may not open this letter.');
      writeAudit(db, { entity: 'perf_reviews', entityId: id, action: download ? 'download' : 'view', actor: actor.user, companyId: actor.companyId });
      return templateServiceOf(db).generated.content(systemActor(actor.companyId), r.letter_doc_id, { download });
    },
  };

  // ------------------------------------------------------------------ the nightly computation and the widget
  function cycle(companyId) {
    const ids = db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND employment_status IN ('ACTIVE', 'NOTICE')").all(companyId).map((x) => x.id);
    const t = today(); const out = compute.batch(companyId, ids, t.slice(0, 7), t);
    if (Number(t.slice(8)) <= 5) compute.batch(companyId, ids, addDays(`${t.slice(0, 7)}-01`, -1).slice(0, 7), t); // the first days of a month finish the month before
    return out;
  }
  const widget = (actor) => (may(actor, 'hr.review.calibrate') ? { value: db.prepare("SELECT COUNT(*) AS n FROM perf_reviews WHERE company_id = ? AND stage = 'CALIBRATION' AND status = 'DRAFT' AND deleted_at IS NULL").get(actor.companyId).n } : { value: 0 });

  // ------------------------------------------------------------------ the decision of the approval workflow
  function decide(instance, actor, outcome, comment) {
    const r = db.prepare('SELECT * FROM perf_reviews WHERE id = ?').get(Number(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      db.prepare("UPDATE perf_reviews SET status = 'APPROVED', stage = 'DONE', approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, r.id);
      event('perf.review.approved', actor, 'perf_review', r.id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, cycleId: r.cycle_id, finalRating: r.final_rating, band: r.band }, null, null);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE perf_reviews SET status = ?, stage = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', outcome === 'RETURNED' ? 'CALIBRATION' : r.stage, actor.user, now, r.id);
      if (withdrawn) db.prepare('UPDATE perf_reviews SET workflow_instance_id = NULL WHERE id = ?').run(r.id);
    }
    writeAudit(db, { entity: 'perf_reviews', entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    const e = emp(r.employee_id);
    tell(r.company_id, r.requested_by ?? r.created_by, 'perf.decided', { what: 'Appraisal', ref: r.doc_no, title: e.full_name, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment: comment ? `: ${comment}` : '' }, `/performance/review?id=${r.id}`, `rv:${r.id}:${outcome}`);
    if (outcome === 'APPROVED') tell(r.company_id, usernameOf(e.user_id), 'perf.decided', { what: 'Your appraisal', ref: r.doc_no, title: db.prepare('SELECT name FROM perf_cycles WHERE id = ?').get(r.cycle_id)?.name ?? '', decision: 'approved: see your rating', comment: '' }, `/performance/review?id=${r.id}`, `rv:${r.id}:emp`);
  }
  return { config, compute, evidence, disputes, goals, feedback, my, team, reviews, cycle, widget, decisions: { review: decide }, canSee };
}

const services = new WeakMap();
export const bindPerformance = (db, s) => services.set(db, s);
export const performanceOf = (db) => services.get(db) ?? null;

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 72, requireAttachment: false, checklist: [], when, notify: [], action: null });
/** The manager of the person reviewed (the manager on the employee record); the HR manager when there is none or the manager is the one who sent it. */
workflowResolvers.register('perf.manager', ({ db, instance }) => {
  const r = db.prepare('SELECT employee_id FROM perf_reviews WHERE id = ?').get(Number(instance.docId));
  const m = r && db.prepare('SELECT m.user_id FROM hr_employees e JOIN hr_employees m ON m.id = e.manager_id WHERE e.id = ?').get(r.employee_id);
  const u = m?.user_id ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(m.user_id)?.username : null;
  return u && !same(u, instance.submittedBy) ? [{ user: u }] : [{ role: 'HRMGR' }];
});
/** The skip-level reviewer: the manager of the manager; the director when the manager has none above. */
workflowResolvers.register('perf.skip', ({ db, instance }) => {
  const r = db.prepare('SELECT employee_id FROM perf_reviews WHERE id = ?').get(Number(instance.docId));
  const m = r && db.prepare('SELECT mm.user_id FROM hr_employees e JOIN hr_employees m ON m.id = e.manager_id JOIN hr_employees mm ON mm.id = m.manager_id WHERE e.id = ?').get(r.employee_id);
  const u = m?.user_id ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(m.user_id)?.username : null;
  return u && !same(u, instance.submittedBy) ? [{ user: u }] : [{ role: 'DIR' }];
});
workflowTypes.register({
  docType: REVIEW_DOC, label: 'Final appraisal rating', processOwner: 'HRMGR', route: () => '/performance/reviews',
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.requested_by, e.full_name, c.name FROM perf_reviews x JOIN hr_employees e ON e.id = x.employee_id JOIN perf_cycles c ON c.id = x.cycle_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.full_name}, ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, e.emp_code, c.name AS cycle_name FROM perf_reviews x JOIN hr_employees e ON e.id = x.employee_id JOIN perf_cycles c ON c.id = x.cycle_id WHERE x.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Review', value: r.doc_no }, { label: 'Employee', value: `${r.full_name} (${r.emp_code})` }, { label: 'Cycle', value: r.cycle_name }, { label: 'Self rating', value: String(r.self_rating ?? '—') }, { label: 'Manager rating', value: String(r.manager_rating ?? '—') }, { label: 'Final rating', value: `${r.final_rating} · ${RATING_LABELS[r.final_rating] ?? ''}` }, { label: 'KPI score', value: String(r.kpi_score ?? '—') }, { label: 'Grade', value: r.band === 'SENIOR' ? 'Senior (the director approves too)' : 'Standard' }] }; },
  defaultDefinition: { name: 'Final appraisal rating: manager, skip-level reviewer, HR manager (the director for senior grades)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('MANAGER', 'Manager', [{ kind: 'resolver', resolver: 'perf.manager' }]), step('REVIEWER', 'Skip-level reviewer', [{ kind: 'resolver', resolver: 'perf.skip' }]), step('HRMGR', 'HR manager', [{ kind: 'role', role: 'HRMGR' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }], { field: 'band', op: 'eq', value: 'SENIOR' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => performanceOf(db)?.decisions.review(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => performanceOf(db)?.decisions.review(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => performanceOf(db)?.decisions.review(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => performanceOf(db)?.decisions.review(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(REVIEW_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM perf_reviews WHERE id = ?').get(Number(instance.docId)); if (!r) return { sections: [] };
  const peers = db.prepare("SELECT final_rating, COUNT(*) AS n FROM perf_reviews WHERE cycle_id = ? AND final_rating IS NOT NULL AND deleted_at IS NULL AND status != 'CANCELLED' GROUP BY final_rating ORDER BY final_rating").all(r.cycle_id).map((x) => `${x.final_rating}: ${x.n}`).join(' · ');
  return { sections: [{ code: 'perf-review', title: 'Before approving', kind: 'metrics', items: [{ label: 'KPI score', value: String(r.kpi_score ?? '—'), format: 'text' }, { label: 'Goal score', value: String(r.goal_score ?? '—'), format: 'text' }, { label: 'Self / manager / final', value: `${r.self_rating ?? '—'} / ${r.manager_rating ?? '—'} / ${r.final_rating ?? '—'}`, format: 'text' }, { label: 'Calibration reason', value: r.calibration_reason ?? 'Same as the manager', format: 'text' }, { label: 'Ratings in this cycle so far', value: peers || '—', format: 'text' }] }] };
});
void forbidden;
