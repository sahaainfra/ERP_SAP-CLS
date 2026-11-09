import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { templateServiceOf } from '../eng/templates.js';
import { policiesOf } from '../pol/service.js';
import { addDays } from './att-calc.js';
import { leaveOf } from './leave.js';

// Employee and manager self-service (part 07.09). Self-service is a way of reaching what the earlier parts of the module keep, not a second copy of it: the home page and the attendance calendar read the register and the punches (07.05, 07.06),
// the leave balances and applications come from 07.07, a change of one's own details is the change document of 07.01, a policy to acknowledge is 05.05. What this part owns is the letter request (employment, salary and no-objection
// certificates): the employee asks, the HR manager approves, and HR issues it from the template library (04.11). Everything an employee sees is their own (BR-01); a manager sees the people who report to them, directly or through others,
// and only what a manager may see: no bank, ID, salary or address of a reportee.
export const LETTER_DOC = 'HR_ESS_LETTER';
export const LETTER_TYPES = { EMPLOYMENT: 'Employment certificate', SALARY: 'Salary certificate', NOC: 'No-objection certificate' };
export const STATUS_LABELS = { DRAFT: 'Draft', SUBMITTED: 'In approval', APPROVED: 'Approved, waiting to be issued', RETURNED: 'Returned', REJECTED: 'Rejected', CANCELLED: 'Cancelled', ISSUED: 'Issued' };
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const r2 = (n) => Math.round(n * 100) / 100;
const sentence = (d) => { const m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']; return `${Number(d.slice(8, 10))} ${m[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`; };

export function createEssService({ db, dep }) {
  const { may, need, nextDoc, event, usernameOf, myEmployee } = dep;
  const notif = notificationsOf(db);
  const today = () => todayIST();
  const maker = (actor, r) => same(r.created_by, actor.user);
  const emp = (id) => db.prepare('SELECT e.*, g.name AS designation, d.name AS department, s.name AS site_name FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN org_departments d ON d.id = e.department_id LEFT JOIN org_sites s ON s.id = e.site_id WHERE e.id = ?').get(id);
  const meOf = (actor) => {
    const id = myEmployee(actor);
    if (!id) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record, so there is no self-service to show. Ask HR to link it.');
    return emp(id);
  };
  /** Everyone who reports to a person, directly or through others (the reporting line of the employee record). */
  const reporteesOf = (employeeId) => db.prepare(`WITH RECURSIVE r(id, depth) AS (
      SELECT id, 1 FROM hr_employees WHERE manager_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND employment_status IN ('ACTIVE', 'NOTICE')
      UNION SELECT e.id, r.depth + 1 FROM hr_employees e JOIN r ON e.manager_id = r.id WHERE e.deleted_at IS NULL AND e.record_status = 'APPROVED' AND e.employment_status IN ('ACTIVE', 'NOTICE') AND r.depth < 12)
    SELECT id, MIN(depth) AS depth FROM r GROUP BY id`).all(employeeId);

  /** How a person's day stands: the register's row when there is one, else the punches so far, else leave, else nothing yet. */
  function dayOf(companyId, ids, date) {
    const out = new Map();
    for (const id of ids) {
      const row = db.prepare("SELECT status, in_time, out_time, late, worked_minutes FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND deleted_at IS NULL").get(companyId, id, date);
      const punches = db.prepare("SELECT punch_type, effective_time FROM att_punches WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND result IN ('ACCEPTED', 'FLAGGED') AND deleted_at IS NULL ORDER BY effective_time").all(companyId, id, date);
      const leave = db.prepare("SELECT t.name, a.half_day FROM lv_applications a JOIN lv_types t ON t.id = a.leave_type_id WHERE a.company_id = ? AND a.employee_id = ? AND a.status = 'APPROVED' AND a.deleted_at IS NULL AND a.from_date <= ? AND a.to_date >= ? LIMIT 1").get(companyId, id, date, date);
      const firstIn = punches.find((p) => p.punch_type === 'IN'); const lastOut = [...punches].reverse().find((p) => p.punch_type === 'OUT');
      const local = (iso) => (iso ? new Date(Date.parse(iso) + 19_800_000).toISOString().slice(11, 16) : null);
      let status;
      if (row && date < today()) status = row.status;
      else if (leave && leave.half_day === 'NONE' && !firstIn) status = 'ON_LEAVE';
      else if (firstIn && !lastOut) status = 'WORKING';
      else if (firstIn && lastOut) status = row?.status ?? 'PRESENT';
      else if (row && row.status !== 'ABSENT') status = row.status;
      else status = date < today() ? 'ABSENT' : 'NOT_IN';
      out.set(id, { status, inTime: row?.in_time?.slice(11, 16) ?? local(firstIn?.effective_time), outTime: row?.out_time?.slice(11, 16) ?? local(lastOut?.effective_time), late: row?.late === 1, leaveType: leave?.name ?? null });
    }
    return out;
  }
  const PRESENT = new Set(['PRESENT', 'WORKING', 'HALF_DAY', 'ON_DUTY', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED']);

  // ------------------------------------------------------------------ my HR (the employee's home)
  const my = {
    home(actor) {
      need(actor, 'hr.ess.view', 'see your self-service');
      const me = meOf(actor); const c = actor.companyId; const date = today();
      const day = dayOf(c, [me.id], date).get(me.id);
      const month = `${date.slice(0, 7)}-01`;
      const stats = db.prepare("SELECT COALESCE(SUM(CASE WHEN status IN ('PRESENT', 'ON_DUTY', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED') THEN 1 WHEN status = 'HALF_DAY' THEN 0.5 ELSE 0 END), 0) AS present, COALESCE(SUM(status = 'ABSENT'), 0) AS absent, COALESCE(SUM(late), 0) AS late, COALESCE(SUM(status = 'ON_LEAVE'), 0) AS leave, COALESCE(SUM(status = 'MISSING_PUNCH'), 0) AS missing FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date >= ? AND work_date <= ? AND deleted_at IS NULL").get(c, me.id, month, date);
      const lv = leaveOf(db);
      const balances = lv ? lv.balances.of(actor, me.id, Number(date.slice(0, 4))).filter((b) => b.remaining !== 0 || b.accrued !== 0).map((b) => ({ code: b.code, name: b.name, remaining: b.remaining, reserved: b.reserved })) : [];
      const count = (sql, ...a) => db.prepare(sql).get(c, me.id, ...a).n;
      const pending = {
        leave: count("SELECT COUNT(*) AS n FROM lv_applications WHERE company_id = ? AND employee_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL"),
        regularisations: count("SELECT COUNT(*) AS n FROM att_regularisations WHERE company_id = ? AND employee_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL"),
        overtime: count("SELECT COUNT(*) AS n FROM att_overtime_requests WHERE company_id = ? AND employee_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL"),
        letters: count("SELECT COUNT(*) AS n FROM ess_requests WHERE company_id = ? AND employee_id = ? AND status IN ('SUBMITTED', 'APPROVED') AND deleted_at IS NULL"),
        profile: count("SELECT COUNT(*) AS n FROM hr_employee_changes WHERE company_id = ? AND employee_id = ? AND change_status IN ('PENDING', 'RETURNED') AND deleted_at IS NULL"),
      };
      pending.returned = db.prepare("SELECT (SELECT COUNT(*) FROM lv_applications WHERE company_id = :c AND employee_id = :e AND status = 'RETURNED' AND deleted_at IS NULL) + (SELECT COUNT(*) FROM att_regularisations WHERE company_id = :c AND employee_id = :e AND status = 'RETURNED' AND deleted_at IS NULL) + (SELECT COUNT(*) FROM ess_requests WHERE company_id = :c AND employee_id = :e AND status = 'RETURNED' AND deleted_at IS NULL) AS n").get({ c, e: me.id }).n;
      let policies;
      try { const p = policiesOf(db)?.mine.list(actor); policies = p ? { toAcknowledge: p.counts.toAcknowledge, overdue: p.counts.overdue } : null; } catch { policies = null; }
      const tasks = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 1 });
      const docs = db.prepare("SELECT COUNT(*) AS n FROM hr_employee_documents WHERE employee_id = ? AND deleted_at IS NULL").get(me.id).n;
      const letters = db.prepare("SELECT COUNT(*) AS n FROM ess_requests WHERE company_id = ? AND employee_id = ? AND status = 'ISSUED' AND deleted_at IS NULL").get(c, me.id).n;
      return {
        employee: { id: me.id, code: me.emp_code, name: me.full_name, designation: me.designation, department: me.department, site: me.site_name }, date, today: day, month: { from: month, to: date, ...stats },
        balances, pending, waitingForMe: tasks.total ?? (tasks.rows ?? []).length, policies, documents: docs, lettersIssued: letters, isManager: reporteesOf(me.id).length > 0,
        can: { attendance: true, leave: may(actor, 'hr.application.create'), regularise: may(actor, 'hr.regularisation.create'), letter: may(actor, 'hr.ess.letter.create'), team: may(actor, 'hr.ess.team') },
      };
    },
    /** FR-01: my attendance calendar for a month and the punches of today. Only the person's own days are ever read. */
    attendance(actor, { month }) {
      need(actor, 'hr.ess.view', 'see your attendance');
      const me = meOf(actor); const m = month ?? today().slice(0, 7);
      const from = `${m}-01`; const to = `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
      const rows = db.prepare("SELECT work_date, status, in_time, out_time, late, early_going, worked_minutes, ot_paid_minutes, paid_day, lop_day, flags_json, locked FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY work_date").all(actor.companyId, me.id, from, to);
      const days = rows.map((r) => ({ date: r.work_date, status: r.status, in: r.in_time?.slice(11, 16) ?? null, out: r.out_time?.slice(11, 16) ?? null, late: r.late === 1, early: r.early_going === 1, workedMinutes: r.worked_minutes, otMinutes: r.ot_paid_minutes, paidDay: r.paid_day, lopDay: r.lop_day, locked: r.locked === 1, flags: json(r.flags_json, []) }));
      const punches = db.prepare("SELECT punch_type AS type, effective_time AS at, result, punch_site_id AS siteId FROM att_punches WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND deleted_at IS NULL ORDER BY effective_time").all(actor.companyId, me.id, today());
      const sum = (k) => r2(rows.reduce((a, r) => a + (r[k] ?? 0), 0));
      return { month: m, from, to, employeeId: me.id, days, today: { date: today(), punches, ...dayOf(actor.companyId, [me.id], today()).get(me.id) }, totals: { paidDays: sum('paid_day'), lopDays: sum('lop_day'), lateMarks: sum('late'), otMinutes: sum('ot_paid_minutes') } };
    },
    /** FR-01: the changes of my own details that I asked for and where they stand (the change documents of 07.01). */
    profileChanges(actor) {
      need(actor, 'hr.ess.view', 'see your requests');
      const me = meOf(actor);
      return db.prepare("SELECT id, change_type AS type, change_status AS status, effective_date AS effectiveDate, reason, summary_json AS summary, created_at AS at FROM hr_employee_changes WHERE company_id = ? AND employee_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30").all(actor.companyId, me.id).map((c) => ({ ...c, summary: json(c.summary, {}) }));
    },
  };

  // ------------------------------------------------------------------ my team (the manager's home)
  const team = {
    /** FR-02, BR-01: the people who report to the viewer, where each stands on a day, what waits for the viewer's decision, who is away soon. */
    overview(actor, { date = today() } = /** @type {any} */ ({})) {
      need(actor, 'hr.ess.team', 'see your team');
      const me = meOf(actor); const c = actor.companyId;
      const reps = reporteesOf(me.id);
      const ids = reps.map((r) => r.id);
      const rows = ids.length ? db.prepare(`SELECT e.id, e.emp_code, e.full_name, e.manager_id, g.name AS designation, d.name AS department, s.name AS site_name FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN org_departments d ON d.id = e.department_id LEFT JOIN org_sites s ON s.id = e.site_id WHERE e.id IN (${ids.map(() => '?').join(',')}) ORDER BY e.full_name`).all(...ids) : [];
      const days = dayOf(c, ids, date); const depth = new Map(reps.map((r) => [r.id, r.depth]));
      const members = rows.map((e) => { const x = days.get(e.id); return { id: e.id, code: e.emp_code, name: e.full_name, designation: e.designation, department: e.department, site: e.site_name, direct: depth.get(e.id) === 1, status: x.status, inTime: x.inTime, outTime: x.outTime, late: x.late, leaveType: x.leaveType }; });
      const count = (f) => members.filter((m) => f(m.status)).length;
      const summary = { total: members.length, present: count((s) => PRESENT.has(s)), onLeave: count((s) => s === 'ON_LEAVE'), absent: count((s) => ['ABSENT', 'MISSING_PUNCH'].includes(s)), notIn: count((s) => s === 'NOT_IN'), late: members.filter((m) => m.late).length };
      // what waits for the viewer, by kind (the same tasks as the approval inbox, 04.03)
      const tasks = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 });
      const KIND = { HR_LEAVE: 'leave', HR_REGULARISATION: 'regularisation', HR_OVERTIME_REQUEST: 'overtime', HR_ATT_MANUAL: 'manual', HR_ESS_LETTER: 'letter', HR_WORKER: 'worker', HR_ATT_VISIT: 'visit' };
      const approvals = {};
      for (const t of tasks.rows ?? []) { const k = KIND[t.instance?.docType]; if (k) approvals[k] = (approvals[k] ?? 0) + 1; }
      const away = ids.length ? db.prepare(`SELECT a.id, a.doc_no, a.employee_id, a.from_date, a.to_date, a.days, a.status, t.code AS type_code, p.full_name FROM lv_applications a JOIN lv_types t ON t.id = a.leave_type_id JOIN hr_employees p ON p.id = a.employee_id WHERE a.company_id = ? AND a.employee_id IN (${ids.map(() => '?').join(',')}) AND a.deleted_at IS NULL AND a.status IN ('SUBMITTED', 'APPROVED') AND a.from_date <= ? AND a.to_date >= ? ORDER BY a.from_date`).all(c, ...ids, addDays(date, 14), date) : [];
      return { date, employeeId: me.id, summary, members, approvals, approvalsTotal: Object.values(approvals).reduce((a, n) => a + n, 0), away: away.map((a) => ({ id: a.id, docNo: a.doc_no, employeeId: a.employee_id, name: a.full_name, from: a.from_date, to: a.to_date, days: a.days, type: a.type_code, waiting: a.status === 'SUBMITTED' })) };
    },
    /** A reportee's own record in the form a manager may see (name, post, place, today): the viewer must be in the line. */
    member(actor, id) {
      need(actor, 'hr.ess.team', 'see your team');
      const me = meOf(actor);
      if (!reporteesOf(me.id).some((r) => r.id === id)) throw notFound('That person does not report to you.');
      const e = emp(id);
      const day = dayOf(actor.companyId, [id], today()).get(id);
      return { id: e.id, code: e.emp_code, name: e.full_name, designation: e.designation, department: e.department, site: e.site_name, employmentType: e.employment_type, doj: e.doj, today: day };
    },
    widget(actor) {
      if (!may(actor, 'hr.ess.team')) return { value: 0 };
      try { const t = team.overview(actor); return { value: t.summary.present, total: t.summary.total }; } catch { return { value: 0 }; }
    },
  };

  // ------------------------------------------------------------------ letters (FR-03)
  const rowOf = (actor, id) => {
    const r = db.prepare('SELECT * FROM ess_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!r || !(r.employee_id === myEmployee(actor) || maker(actor, r) || may(actor, 'hr.ess.letter.view_all'))) throw notFound('That request does not exist.');
    return r;
  };
  function view(actor, r) {
    const e = emp(r.employee_id); const mine = r.employee_id === myEmployee(actor); const hr = may(actor, 'hr.ess.issue');
    const editable = ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r);
    return {
      id: r.id, docNo: r.doc_no, status: r.status, statusLabel: STATUS_LABELS[r.status], rowVersion: r.version, employeeId: r.employee_id, employee: e?.full_name, employeeCode: e?.emp_code, letterType: r.letter_type, letterLabel: LETTER_TYPES[r.letter_type],
      purpose: r.purpose, addressedTo: r.addressed_to, payload: json(r.payload_json, {}), requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, generatedDocId: r.generated_doc_id, issuedAt: r.issued_at, issuedBy: r.issued_by, createdAt: r.created_at,
      can: { edit: editable, submit: editable, delete: r.status === 'DRAFT' && maker(actor, r), withdraw: r.status === 'SUBMITTED' && maker(actor, r), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(r.status) && (maker(actor, r) || hr), issue: r.status === 'APPROVED' && hr, download: r.status === 'ISSUED' && (mine || hr) },
    };
  }
  const validate = (b) => {
    const problems = [];
    if (!LETTER_TYPES[b.letterType]) problems.push({ field: 'letterType', message: 'Choose the kind of letter' });
    if (!b.purpose || b.purpose.trim().length < 5) problems.push({ field: 'purpose', message: 'Say what the letter is for (at least 5 characters)' });
    return problems;
  };
  const letters = {
    list(actor, { scope = 'mine' } = /** @type {any} */ ({})) {
      need(actor, 'hr.ess.view', 'see your requests');
      if (scope === 'all') { need(actor, 'hr.ess.letter.view_all', 'see the letter requests of everyone'); return db.prepare("SELECT * FROM ess_requests WHERE company_id = ? AND deleted_at IS NULL ORDER BY (status = 'APPROVED') DESC, id DESC LIMIT 200").all(actor.companyId).map((r) => view(actor, r)); }
      const me = meOf(actor);
      return db.prepare('SELECT * FROM ess_requests WHERE company_id = ? AND employee_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 100').all(actor.companyId, me.id).map((r) => view(actor, r));
    },
    get(actor, id) { return view(actor, rowOf(actor, id)); },
    create(actor, b) {
      need(actor, 'hr.ess.letter.create', 'ask for a letter');
      const me = meOf(actor);
      const problems = validate(b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, LETTER_DOC, 'ess_requests', 'LTR');
        const id = Number(db.prepare("INSERT INTO ess_requests (company_id, doc_no, doc_date, employee_id, request_type, letter_type, purpose, addressed_to, payload_json, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, 'LETTER', ?, ?, ?, '{}', 'DRAFT', ?, ?, ?, ?, 'ess_request')")
          .run(actor.companyId, no, today(), me.id, b.letterType, b.purpose.trim(), b.addressedTo ?? null, actor.user, me.project_id ?? null, me.site_id ?? null, actor.user).lastInsertRowid);
        db.prepare('UPDATE ess_requests SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'ess_requests', entityId: id, action: 'create', newValues: { docNo: no, letterType: b.letterType }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? letters.submit(actor, id, { comment: b.comment }) : view(actor, rowOf(actor, id));
      });
    },
    update(actor, id, b) {
      const r = rowOf(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`A request that is ${STATUS_LABELS[r.status].toLowerCase()} is not changed: cancel it and ask again.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who asked for it, changes it.`);
      if (r.version !== b.version) throw conflict('This request was changed by someone else. Reload it and try again.');
      const problems = validate(b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE ess_requests SET letter_type = ?, purpose = ?, addressed_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.letterType, b.purpose.trim(), b.addressedTo ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'ess_requests', entityId: id, action: 'update', newValues: { letterType: b.letterType }, actor: actor.user, companyId: actor.companyId });
      return view(actor, rowOf(actor, id));
    },
    remove(actor, id) {
      const r = rowOf(actor, id);
      if (r.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} deletes this draft.`);
      db.prepare('UPDATE ess_requests SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'ess_requests', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const r = rowOf(actor, id); need(actor, 'hr.ess.letter.submit', 'submit requests');
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`This request is ${STATUS_LABELS[r.status].toLowerCase()}.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who asked for it, submits it.`);
      return transaction(db, () => {
        const ctx = { band: 'STANDARD', letterType: r.letter_type, employeeId: r.employee_id };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: LETTER_DOC, docId: id, comment: comment ?? 'Letter request', context: ctx }); db.prepare('UPDATE ess_requests SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE ess_requests SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'ess_requests', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return view(actor, rowOf(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const r = rowOf(actor, id);
      if (r.status !== 'SUBMITTED') throw unprocessable('Only a request in approval is withdrawn.');
      if (!maker(actor, r)) throw forbidden('Only the person who asked for it withdraws it.');
      workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason });
      return view(actor, rowOf(actor, id));
    },
    cancel(actor, id, { reason }) {
      const r = rowOf(actor, id);
      if (!['SUBMITTED', 'RETURNED', 'APPROVED'].includes(r.status)) throw unprocessable('Only a request in approval, returned or approved is cancelled; delete a draft.');
      if (r.status === 'APPROVED') {
        if (!may(actor, 'hr.ess.issue') && !maker(actor, r)) throw forbidden('You may not cancel this request.');
        db.prepare("UPDATE ess_requests SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'ess_requests', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        return view(actor, rowOf(actor, id));
      }
      if (maker(actor, r)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); decide({ docId: r.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else { need(actor, 'hr.ess.letter.approve', 'cancel requests of others'); workflowOf(db).cancel(actor, r.workflow_instance_id, { reason }); }
      return view(actor, rowOf(actor, id));
    },
    history(actor, id) {
      const r = rowOf(actor, id);
      return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'ess_requests' AND entity_id = ? ORDER BY id").all(String(id)).map((x) => ({ action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
    },
    /** HR issues an approved request from the template library: the text is made from the employee record, the document is a numbered, verifiable PDF (04.11). A salary certificate states the monthly gross that HR enters here (payroll, M24, will give it). */
    async issue(actor, id, b) {
      need(actor, 'hr.ess.issue', 'issue letters');
      const r = rowOf(actor, id);
      if (r.status !== 'APPROVED') throw unprocessable(r.status === 'ISSUED' ? 'This letter was issued already.' : 'Only an approved request is issued.');
      if (r.letter_type === 'SALARY' && !(b.salaryMonthly > 0)) throw badRequest('Some fields are not valid.', [{ field: 'salaryMonthly', message: 'Give the gross monthly salary the certificate states' }]);
      const tpl = templateServiceOf(db); if (!tpl) throw unprocessable('The document templates are not running.');
      const e = emp(r.employee_id); const company = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? '';
      const since = sentence(e.doj); const who = `${e.full_name} (employee code ${e.emp_code})`;
      const post = `${e.designation ?? 'an employee'}${e.department ? ` in the ${e.department} department` : ''}`;
      const text = {
        EMPLOYMENT: `${who} is employed with ${company} as ${post}, and has been in service since ${since}. This certificate is issued at the request of the employee for ${r.purpose}.`,
        SALARY: `${who} is employed with ${company} as ${post}, and has been in service since ${since}. The gross monthly salary of the employee is Rs ${Number(b.salaryMonthly).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. This certificate is issued at the request of the employee for ${r.purpose}.`,
        NOC: `${company} has no objection to ${who}, ${post}, for ${r.purpose}. This certificate is issued at the request of the employee${r.addressed_to ? ` and is addressed to ${r.addressed_to}` : ''}.`,
      }[r.letter_type];
      const entityId = `ESS-${r.id}`;
      // the record is published with the system's rights (the right to issue letters was checked above); the document is generated with the HR manager's own rights
      const sys = { user: actor.user, userId: null, companyId: actor.companyId, roles: ['SYSADM'] };
      tpl.records.publish(sys, { docType: 'CERTIFICATE', entityId, docNo: r.doc_no, approved: true, data: { certificate: { title: LETTER_TYPES[r.letter_type], text }, recipient: { name: e.full_name }, issuedFor: r.purpose, issuedOn: today(), lines: [] }, reason: 'Issued through self-service' });
      const doc = await tpl.generate(actor, { docType: 'CERTIFICATE', entityId, reason: 'Issued through self-service' });
      db.prepare("UPDATE ess_requests SET status = 'ISSUED', generated_doc_id = ?, issued_at = ?, issued_by = ?, payload_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(doc.id, nowIso(), actor.user, JSON.stringify(r.letter_type === 'SALARY' ? { salaryMonthly: b.salaryMonthly } : {}), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'ess_requests', entityId: id, action: 'issue', newValues: { generatedDocId: doc.id, docNumber: doc.docNumber ?? null }, actor: actor.user, companyId: actor.companyId });
      event('ess.letter.issued', actor, 'ess_request', id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, letterType: r.letter_type, generatedDocId: doc.id }, null, null);
      tell(r.company_id, usernameOf(e.user_id) ?? r.requested_by, LETTER_TYPES[r.letter_type], r.doc_no, e.full_name, 'issued', null, '/my-hr/letters');
      return view(actor, rowOf(actor, id));
    },
    /** The letter itself, for the person it was issued to and for HR. The document service sees the system, after the check of who is asking. */
    async content(actor, id, { download = true } = {}) {
      const r = rowOf(actor, id);
      if (r.status !== 'ISSUED' || !r.generated_doc_id) throw unprocessable('The letter has not been issued yet.');
      if (!(r.employee_id === myEmployee(actor) || may(actor, 'hr.ess.issue'))) throw forbidden('You may not open this letter.');
      writeAudit(db, { entity: 'ess_requests', entityId: id, action: download ? 'download' : 'view', actor: actor.user, companyId: actor.companyId });
      return templateServiceOf(db).generated.content({ user: actor.user, userId: null, companyId: actor.companyId, roles: ['SYSADM'] }, r.generated_doc_id, { download });
    },
  };
  const tell = (companyId, to, what, ref, title, outcome, comment, link) => to && notif.notify({ companyId, templateCode: 'ess.decided', recipients: [`user:${to}`], data: { what, ref, title, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : outcome === 'issued' ? 'issued: you can download it' : 'cancelled', comment: comment ? `: ${comment}` : '' }, link, sourceType: 'ess_request', sourceId: ref, eventKey: `ess.decided:${ref}:${outcome}:${Date.now()}` });
  function decide(instance, actor, outcome, comment) {
    const r = db.prepare('SELECT * FROM ess_requests WHERE id = ?').get(Number(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      db.prepare("UPDATE ess_requests SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
      event('ess.letter.approved', actor, 'ess_request', r.id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, letterType: r.letter_type }, null, null);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE ess_requests SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
      if (withdrawn) db.prepare('UPDATE ess_requests SET workflow_instance_id = NULL WHERE id = ?').run(r.id);
    }
    writeAudit(db, { entity: 'ess_requests', entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    tell(r.company_id, r.requested_by ?? r.created_by, LETTER_TYPES[r.letter_type], r.doc_no, emp(r.employee_id)?.full_name ?? '', outcome, comment, '/my-hr/letters');
  }
  return { my, team, letters, decisions: { letter: decide }, reporteesOf, dayOf };
}

const services = new WeakMap();
export const bindEss = (db, s) => services.set(db, s);
export const essOf = (db) => services.get(db) ?? null;

workflowTypes.register({
  docType: LETTER_DOC, label: 'Letter request (certificate)', processOwner: 'HRMGR', route: () => '/my-hr/letters',
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.letter_type, x.requested_by, e.full_name FROM ess_requests x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${LETTER_TYPES[r.letter_type]} for ${r.full_name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, e.emp_code FROM ess_requests x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Request', value: r.doc_no }, { label: 'Letter', value: LETTER_TYPES[r.letter_type] }, { label: 'Employee', value: `${r.full_name} (${r.emp_code})` }, { label: 'What it is for', value: r.purpose }, { label: 'Addressed to', value: r.addressed_to ?? '—' }] }; },
  defaultDefinition: { name: 'Letter request: HR manager', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [{ code: 'HRMGR', name: 'HR manager', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'HRMGR' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: {
    onApproved: (db, { instance, actor }) => essOf(db)?.decisions.letter(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => essOf(db)?.decisions.letter(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => essOf(db)?.decisions.letter(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => essOf(db)?.decisions.letter(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(LETTER_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM ess_requests WHERE id = ?').get(Number(instance.docId)); if (!r) return { sections: [] };
  const e = db.prepare('SELECT e.emp_code, e.doj, e.employment_status, g.name AS designation FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id WHERE e.id = ?').get(r.employee_id);
  const earlier = db.prepare("SELECT COUNT(*) AS n FROM ess_requests WHERE company_id = ? AND employee_id = ? AND letter_type = ? AND status = 'ISSUED' AND deleted_at IS NULL").get(r.company_id, r.employee_id, r.letter_type).n;
  return { sections: [{ code: 'ess-letter', title: 'Before approving', kind: 'metrics', items: [{ label: 'In service since', value: e?.doj ?? '—', format: 'text' }, { label: 'Status', value: e?.employment_status ?? '—', format: 'text', tone: e && !['ACTIVE', 'NOTICE'].includes(e.employment_status) ? 'warn' : undefined }, { label: 'Designation', value: e?.designation ?? '—', format: 'text' }, { label: 'Letters of this kind issued before', value: String(earlier), format: 'text' }] }] };
});
void forbidden;
