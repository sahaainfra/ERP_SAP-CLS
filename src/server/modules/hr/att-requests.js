import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { todayIST } from '../../../shared/dates.js';
import { addDays, withDefaults } from './att-calc.js';
import { attendanceOf } from './attendance.js';
import { registerOf } from './att-register.js';

// Regularisation, overtime and manual attendance (part 07.06, FR-03 to FR-05). Three kinds of request share one shape: a person, a day, a reason, a band that decides how far it goes for approval, and the usual
// draft / submit / withdraw / cancel / amend life. A regularisation corrects the punches of a day (the person or their supervisor asks); an overtime request approves hours before or after they are worked, and the register pays
// the hours the punches show up to the hours approved; a manual entry is attendance typed in by HR, made by one person and approved by another (maker-checker). When one is approved the register recomputes the day.
export const REG_DOC = 'HR_REGULARISATION';
export const OT_DOC = 'HR_OVERTIME_REQUEST';
export const MANUAL_DOC = 'HR_ATT_MANUAL';
export const STATUS_LABELS = { DRAFT: 'Draft', SUBMITTED: 'In approval', APPROVED: 'Approved', RETURNED: 'Returned', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const OT_DAY_PM_MINUTES = 240; // more than 4 hours in a day also needs the project manager
export const OT_MONTH_PM_MINUTES = 3000; // more than 50 hours in a calendar month also needs the project manager
export const REG_MONTH_LIMIT = 3; // the fourth regularisation of a month also needs the HR manager
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const monthOf = (d) => d.slice(0, 7);
const OWN_ACTIONS = new Set(['view', 'create', 'edit', 'delete', 'submit', 'cancel', 'print']);

export const KINDS = {
  regularisation: { table: 'att_regularisations', docType: REG_DOC, prefix: 'REG', perm: 'hr.regularisation', label: 'Regularisation', own: true, route: '/att/regularisation', cols: ['requested_in', 'requested_out', 'reason', 'evidence_file_id'] },
  overtime: { table: 'att_overtime_requests', docType: OT_DOC, prefix: 'OTR', perm: 'hr.overtime_request', label: 'Overtime request', own: true, route: '/att/overtime', cols: ['ot_type', 'minutes_requested', 'reason'] },
  manual: { table: 'att_manual_entries', docType: MANUAL_DOC, prefix: 'MAN', perm: 'att.manual', label: 'Manual attendance entry', own: false, route: '/att/approvals', cols: ['entry_status', 'in_time', 'out_time', 'reason', 'evidence_file_id'] },
};
const listFor = (kind) => {
  const k = KINDS[kind];
  const extra = kind === 'regularisation' ? { requestedIn: { sql: 'x.requested_in', type: 'text', label: 'Requested in' }, requestedOut: { sql: 'x.requested_out', type: 'text', label: 'Requested out' } }
    : kind === 'overtime' ? { otType: { sql: 'x.ot_type', type: 'enum', label: 'When', options: [['PRE', 'Before the work'], ['POST', 'After the work']] }, minutes: { sql: 'COALESCE(x.minutes_approved, x.minutes_requested)', type: 'number', label: 'Minutes' } }
      : { entryStatus: { sql: 'x.entry_status', type: 'enum', label: 'Entry', options: [['PRESENT', 'Present'], ['HALF_DAY', 'Half day'], ['ABSENT', 'Absent'], ['ON_DUTY', 'On duty'], ['COMP_OFF', 'Comp-off']] }, inTime: { sql: 'x.in_time', type: 'text', label: 'In' }, outTime: { sql: 'x.out_time', type: 'text', label: 'Out' } };
  return defineList({
    code: { regularisation: 'hr.regularisations', overtime: 'hr.overtime_requests', manual: 'att.manual_entries' }[kind], label: { regularisation: 'Regularisation requests', overtime: 'Overtime register', manual: 'Manual attendance entries' }[kind], permission: `${k.perm}.view`,
    from: `${k.table} x JOIN hr_employees e ON e.id = x.employee_id LEFT JOIN org_sites s ON s.id = x.doc_site_id`, where: "x.deleted_at IS NULL AND x.status != 'SUPERSEDED'", searchable: ['x.doc_no', 'e.full_name', 'e.emp_code', 'x.reason'], defaultSort: '-docNo',
    columns: {
      docNo: { sql: 'x.doc_no', type: 'text', label: 'Request' }, revision: { sql: 'x.revision_no', type: 'number', label: 'Revision' }, workDate: { sql: 'x.work_date', type: 'date', label: 'Day' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' },
      site: { sql: 's.name', type: 'text', label: 'Site' }, siteId: { sql: 'x.doc_site_id', type: 'number', label: 'Site id' }, ...extra, reason: { sql: 'x.reason', type: 'text', label: 'Reason' },
      band: { sql: 'x.band', type: 'text', label: 'Band' }, arrears: { sql: 'x.arrears', type: 'enum', label: 'After the lock', options: [['1', 'Arrears'], ['0', 'Normal']] },
      status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS_LABELS) }, requestedBy: { sql: 'x.requested_by', type: 'text', label: 'Raised by' }, updatedAt: { sql: 'COALESCE(x.updated_at, x.created_at)', type: 'datetime', label: 'Changed' },
    },
  });
}
export const lists = { regularisation: listFor('regularisation'), overtime: listFor('overtime'), manual: listFor('manual') };

export function createRequestService({ db, dep }) {
  const authz = authzOf(db);
  const { may, need, nextDoc, event, usernameOf, myEmployee, root, orgName } = dep;
  const att = () => attendanceOf(db);
  const reg = () => registerOf(db);
  const notif = notificationsOf(db);
  const siteRow = (id) => (id ? db.prepare('SELECT id, name, org_project_id AS project_id FROM org_sites WHERE id = ?').get(id) : null);
  const scopeOf = (siteId) => { const s = siteRow(siteId); return s ? { projectId: s.project_id, siteId: s.id } : undefined; };
  const maker = (actor, r) => same(r.created_by, actor.user);
  const empName = (id) => db.prepare('SELECT full_name AS n, emp_code AS c, user_id AS u FROM hr_employees WHERE id = ?').get(id);
  const siteOn = (c, employeeId, date) => { try { return att().resolveFor(c, employeeId, date).siteId ?? null; } catch { return null; } };

  /** The right to do `action` to a request: your own (when the kind allows it) on the plain permission, anybody else's on the permission and the register right at the site. */
  function allowed(actor, kind, action, r) {
    const key = `${KINDS[kind].perm}.${action}`;
    if (KINDS[kind].own && OWN_ACTIONS.has(action) && r.employee_id === myEmployee(actor)) return authz.check(actor, key).allowed;
    const sc = r.doc_site_id ? scopeOf(r.doc_site_id) : undefined;
    return may(actor, 'att.register.view', sc) && may(actor, key, sc);
  }
  const needOn = (actor, kind, action, what, r) => { if (!allowed(actor, kind, action, r)) throw forbidden(`You may not ${what} (permission ${KINDS[kind].perm}.${action}).`); };
  const rowOf = (actor, kind, id) => {
    const r = db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(id, actor.companyId);
    if (!r || !(maker(actor, r) || allowed(actor, kind, 'view', r))) throw notFound(`That ${KINDS[kind].label.toLowerCase()} does not exist.`);
    return r;
  };

  function view(actor, kind, r) {
    const e = empName(r.employee_id);
    const can = (a) => allowed(actor, kind, a, r);
    const k = KINDS[kind];
    const fields = kind === 'regularisation' ? { requestedIn: r.requested_in, requestedOut: r.requested_out, reason: r.reason, evidenceFileId: r.evidence_file_id }
      : kind === 'overtime' ? { otType: r.ot_type, minutes: r.minutes_requested, minutesApproved: r.minutes_approved ?? (r.status === 'APPROVED' ? r.minutes_requested : null), reason: r.reason }
        : { entryStatus: r.entry_status, inTime: r.in_time, outTime: r.out_time, reason: r.reason, evidenceFileId: r.evidence_file_id };
    const editable = ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r);
    return {
      id: r.id, kind, docNo: r.doc_no, revision: r.revision_no, supersedesId: r.supersedes_id, docDate: r.doc_date, status: r.status, statusLabel: STATUS_LABELS[r.status], rowVersion: r.version,
      employeeId: r.employee_id, employee: e?.n ?? null, employeeCode: e?.c ?? null, siteId: r.doc_site_id, site: orgName('org_sites', r.doc_site_id), workDate: r.work_date, band: r.band, arrears: r.arrears === 1,
      ...fields, workflowInstanceId: r.workflow_instance_id, requestedBy: r.requested_by, createdBy: r.created_by,
      can: { edit: editable && can('edit'), submit: editable && can('submit'), delete: r.status === 'DRAFT' && maker(actor, r) && can('delete'), withdraw: r.status === 'SUBMITTED' && maker(actor, r), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(r.status) && can('cancel'), amend: r.status === 'APPROVED' && can('amend'), print: can('print') },
      label: k.label,
    };
  }
  const history = (actor, kind, id) => {
    const r = rowOf(actor, kind, id); const t = KINDS[kind].table;
    const ids = db.prepare(`SELECT id, workflow_instance_id FROM ${t} WHERE company_id = ? AND doc_no = ?`).all(r.company_id, r.doc_no);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ requestId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = '${t}' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ requestId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  };

  // ------------------------------------------------------------------ the rules of each kind
  const localOk = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s ?? ''));
  function validate(actor, kind, b, ignoreId = null) {
    const c = actor.companyId; const problems = []; const t = KINDS[kind].table;
    const e = db.prepare("SELECT id, record_status, employment_status, doj, last_working_date FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(b.employeeId, c);
    if (!e || e.record_status !== 'APPROVED') problems.push({ field: 'employeeId', message: 'That is not an employee' });
    else if (b.workDate < e.doj || (e.last_working_date && b.workDate > e.last_working_date)) problems.push({ field: 'workDate', message: 'The person was not in service on that day' });
    const isPre = kind === 'overtime' && b.otType === 'PRE';
    if (!isPre && b.workDate > todayIST()) problems.push({ field: 'workDate', message: kind === 'overtime' ? 'Overtime worked is claimed for a day that has come; ask for approval before the work with "before the work"' : 'The day has not come yet' });
    if (isPre && b.workDate < todayIST()) problems.push({ field: 'workDate', message: 'Approval before the work is asked for today or a coming day' });
    if (kind === 'regularisation') {
      if (!b.requestedIn && !b.requestedOut) problems.push({ field: 'requestedIn', message: 'Give the in time, the out time or both' });
      if (b.requestedIn && !localOk(b.requestedIn)) problems.push({ field: 'requestedIn', message: 'Use a date and time such as 2026-12-01T09:00' });
      if (b.requestedOut && !localOk(b.requestedOut)) problems.push({ field: 'requestedOut', message: 'Use a date and time such as 2026-12-01T18:00' });
      if (b.requestedIn && b.requestedOut && b.requestedOut <= b.requestedIn) problems.push({ field: 'requestedOut', message: 'The out time is after the in time' });
      for (const [f, v] of [['requestedIn', b.requestedIn], ['requestedOut', b.requestedOut]]) if (v && localOk(v) && (v.slice(0, 10) < b.workDate || v.slice(0, 10) > addDays(b.workDate, 1))) problems.push({ field: f, message: 'The time falls on the day or the day after (a night shift)' });
    }
    if (kind === 'manual') {
      if ((b.inTime && !b.outTime) || (!b.inTime && b.outTime)) problems.push({ field: 'inTime', message: 'Give both the in time and the out time, or neither' });
      if (b.inTime && b.outTime && (!localOk(b.inTime) || !localOk(b.outTime))) problems.push({ field: 'inTime', message: 'Use a date and time such as 2026-12-01T09:00' });
      if (b.inTime && b.outTime && b.outTime <= b.inTime) problems.push({ field: 'outTime', message: 'The out time is after the in time' });
    }
    if (kind === 'overtime' && !(b.minutes >= 15 && b.minutes <= 720)) problems.push({ field: 'minutes', message: 'Overtime is between 15 minutes and 12 hours' });
    if (!problems.length) {
      const twin = db.prepare(`SELECT doc_no FROM ${t} WHERE company_id = ? AND employee_id = ? AND work_date = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND COALESCE(root_id, id) != ?${kind === 'overtime' ? ' AND ot_type = ?' : ''}`).get(...[c, b.employeeId, b.workDate, ignoreId ? (db.prepare(`SELECT COALESCE(root_id, id) AS r FROM ${t} WHERE id = ?`).get(ignoreId)?.r ?? 0) : 0, ...(kind === 'overtime' ? [b.otType] : [])]);
      if (twin) problems.push({ field: 'workDate', message: `${twin.doc_no} already covers that person and day: change or cancel it, or amend it if it is approved` });
    }
    return problems;
  }
  /** After the lock a request is raised as arrears; before that it cannot be mistaken for one. */
  function lockState(c, b, siteId) {
    const l = reg().lockedDay(c, b.workDate, siteId);
    if (l && !b.arrears) throw new HttpError(409, 'PERIOD_LOCKED', `The attendance of ${b.workDate} is locked (${l.period_start} to ${l.period_end}). A correction now is raised as arrears for payroll: send "arrears": true to confirm.`, /** @type {any} */ ({ lockId: l.id, periodStart: l.period_start }));
    return l ? 1 : 0;
  }
  const colsOf = (kind, b) => (kind === 'regularisation' ? [b.requestedIn ?? null, b.requestedOut ?? null, b.reason, b.evidenceFileId ?? null]
    : kind === 'overtime' ? [b.otType, b.minutes, b.reason] : [b.entryStatus, b.inTime ?? null, b.outTime ?? null, b.reason, b.evidenceFileId ?? null]);
  const bodyOf = (kind, r) => ({ employeeId: r.employee_id, workDate: r.work_date, arrears: r.arrears === 1, ...(kind === 'regularisation' ? { requestedIn: r.requested_in, requestedOut: r.requested_out, reason: r.reason, evidenceFileId: r.evidence_file_id } : kind === 'overtime' ? { otType: r.ot_type, minutes: r.minutes_requested, reason: r.reason } : { entryStatus: r.entry_status, inTime: r.in_time, outTime: r.out_time, reason: r.reason, evidenceFileId: r.evidence_file_id }) });

  /** How far the request goes for approval (BR-02): a fourth regularisation in a month, overtime beyond a day or a month, or beyond the policy. */
  function bandOf(kind, r) {
    const c = r.company_id;
    if (kind === 'regularisation') {
      const n = db.prepare("SELECT COUNT(*) AS n FROM att_regularisations WHERE company_id = ? AND employee_id = ? AND substr(work_date, 1, 7) = ? AND status IN ('SUBMITTED', 'APPROVED') AND deleted_at IS NULL AND id != ? AND COALESCE(root_id, id) != COALESCE(?, 0)").get(c, r.employee_id, monthOf(r.work_date), r.id, r.root_id ?? r.id).n;
      return { band: n + 1 > REG_MONTH_LIMIT ? 'REPEATED' : 'STANDARD', note: `${n + 1} this month` };
    }
    if (kind === 'overtime') {
      const sum = (extra, ...a) => db.prepare(`SELECT COALESCE(SUM(COALESCE(minutes_approved, minutes_requested)), 0) AS m FROM att_overtime_requests WHERE company_id = ? AND employee_id = ? AND status IN ('SUBMITTED', 'APPROVED') AND deleted_at IS NULL AND id != ? AND COALESCE(root_id, id) != ? ${extra}`).get(c, r.employee_id, r.id, r.root_id ?? r.id, ...a).m;
      const day = sum('AND work_date = ?', r.work_date) + r.minutes_requested; const month = sum("AND substr(work_date, 1, 7) = ?", monthOf(r.work_date)) + r.minutes_requested;
      let exception = false; let why = '';
      try {
        const x = att().resolveFor(c, r.employee_id, r.work_date); const ot = withDefaults(x.policy?.rules ?? {}).ot;
        const eligible = ot.enabled && (ot.eligibleGrades.length === 0 || ot.eligibleGrades.includes(x.grade)) && (ot.eligibleCategories.length === 0 || ot.eligibleCategories.includes(x.category));
        if (!eligible) { exception = true; why = 'Overtime is not paid under the policy that applies to this person'; } else if (ot.maxPerDayMinutes != null && day > ot.maxPerDayMinutes) { exception = true; why = `More than the policy limit of ${ot.maxPerDayMinutes / 60} hours a day`; }
      } catch { exception = true; why = 'No policy could be found'; }
      const band = exception ? 'POLICY_EXCEPTION' : day > OT_DAY_PM_MINUTES || month > OT_MONTH_PM_MINUTES ? 'PM_LEVEL' : 'STANDARD';
      return { band, note: why || `${(day / 60).toFixed(1)} h that day, ${(month / 60).toFixed(1)} h that month` };
    }
    return { band: 'STANDARD', note: 'Entered by hand' };
  }

  // ------------------------------------------------------------------ the life of a request
  const api = (kind) => {
    const k = KINDS[kind]; const table = k.table;
    const insert = (actor, b, extra) => {
      const c = actor.companyId;
      const siteId = siteOn(c, b.employeeId, b.workDate);
      const sc = siteId ? scopeOf(siteId) : undefined;
      const ghost = { employee_id: b.employeeId, doc_site_id: siteId };
      needOn(actor, kind, 'create', `raise ${k.label.toLowerCase()}s for this person`, ghost);
      const problems = validate(actor, kind, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const arrears = lockState(c, b, siteId);
      const no = nextDoc(actor, k.docType, table, k.prefix);
      const id = Number(db.prepare(`INSERT INTO ${table} (company_id, doc_no, doc_date, employee_id, doc_site_id, work_date, ${k.cols.join(', ')}, arrears, status, requested_by, project_id, site_id, created_by, source_type${extra ? ', source_id, remarks' : ''}) VALUES (?, ?, ?, ?, ?, ?, ${k.cols.map(() => '?').join(', ')}, ?, 'DRAFT', ?, ?, ?, ?, ?${extra ? ', ?, ?' : ''})`)
        .run(c, no, todayIST(), b.employeeId, siteId, b.workDate, ...colsOf(kind, b), arrears, actor.user, sc?.projectId ?? null, siteId, actor.user, `att_${kind}`, ...(extra ? [extra.sourceId, extra.remarks] : [])).lastInsertRowid);
      db.prepare(`UPDATE ${table} SET root_id = COALESCE(root_id, id) WHERE id = ?`).run(id);
      writeAudit(db, { entity: table, entityId: id, action: 'create', newValues: { docNo: no, employeeId: b.employeeId, workDate: b.workDate, arrears }, actor: actor.user, companyId: c });
      return id;
    };
    const svc = {
      create(actor, b) {
        return transaction(db, () => { const id = insert(actor, b); return b.submit ? svc.submit(actor, id, { comment: b.comment }) : view(actor, kind, rowOf(actor, kind, id)); });
      },
      get(actor, id) { return { ...view(actor, kind, rowOf(actor, kind, id)), history: history(actor, kind, id) }; },
      update(actor, id, b) {
        const r = rowOf(actor, kind, id);
        needOn(actor, kind, 'edit', `change ${k.label.toLowerCase()}s`, r);
        if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`A request that is ${STATUS_LABELS[r.status].toLowerCase()} is changed by an amendment.`);
        if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this request, changes it.`);
        if (r.version !== b.version) throw conflict('This request was changed by someone else. Reload it and try again.');
        const problems = validate(actor, kind, b, id); if (problems.length) throw badRequest('Some fields are not valid.', problems);
        const siteId = siteOn(actor.companyId, b.employeeId, b.workDate); const arrears = lockState(actor.companyId, b, siteId);
        db.prepare(`UPDATE ${table} SET employee_id = ?, doc_site_id = ?, work_date = ?, ${k.cols.map((x) => `${x} = ?`).join(', ')}, arrears = ?, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
          .run(b.employeeId, siteId, b.workDate, ...colsOf(kind, b), arrears, scopeOf(siteId)?.projectId ?? null, siteId, actor.user, nowIso(), id);
        writeAudit(db, { entity: table, entityId: id, action: 'update', newValues: { workDate: b.workDate }, actor: actor.user, companyId: actor.companyId });
        return view(actor, kind, rowOf(actor, kind, id));
      },
      remove(actor, id) {
        const r = rowOf(actor, kind, id);
        needOn(actor, kind, 'delete', `delete ${k.label.toLowerCase()}s`, r);
        if (r.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
        if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} deletes this draft.`);
        db.prepare(`UPDATE ${table} SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?`).run(nowIso(), actor.user, id);
        writeAudit(db, { entity: table, entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
        return { id, deleted: true };
      },
      submit(actor, id, { comment } = /** @type {any} */ ({})) {
        const r = rowOf(actor, kind, id);
        needOn(actor, kind, 'submit', `submit ${k.label.toLowerCase()}s`, r);
        if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`This request is ${STATUS_LABELS[r.status].toLowerCase()}.`);
        if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this request, submits it.`);
        return transaction(db, () => {
          const problems = validate(actor, kind, bodyOf(kind, r), id); if (problems.length) throw unprocessable(problems[0].message);
          lockState(actor.companyId, bodyOf(kind, r), r.doc_site_id);
          const { band, note } = bandOf(kind, r);
          const ctx = { band, employeeId: r.employee_id, workDate: r.work_date, siteId: r.doc_site_id, arrears: r.arrears === 1, note };
          if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
          else { const inst = workflowOf(db).submit(actor, { docType: k.docType, docId: id, comment: comment ?? k.label, context: ctx, amendsDocId: r.supersedes_id ?? null }); db.prepare(`UPDATE ${table} SET workflow_instance_id = ? WHERE id = ?`).run(inst.id, id); }
          db.prepare(`UPDATE ${table} SET status = 'SUBMITTED', band = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(band, actor.user, actor.user, nowIso(), id);
          writeAudit(db, { entity: table, entityId: id, action: 'submit', newValues: { band, note }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
          return view(actor, kind, rowOf(actor, kind, id));
        });
      },
      withdraw(actor, id, { reason }) {
        const r = rowOf(actor, kind, id);
        if (r.status !== 'SUBMITTED') throw unprocessable('Only a request in approval is withdrawn.');
        if (!maker(actor, r)) throw forbidden('Only the person who raised it withdraws it.');
        workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason });
        return view(actor, kind, rowOf(actor, kind, id));
      },
      cancel(actor, id, { reason }) {
        const r = rowOf(actor, kind, id);
        needOn(actor, kind, 'cancel', `cancel ${k.label.toLowerCase()}s`, r);
        if (r.status === 'APPROVED') {
          return transaction(db, () => {
            db.prepare(`UPDATE ${table} SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, nowIso(), id);
            writeAudit(db, { entity: table, entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
            reg()?.onChange(r.company_id, r.employee_id, r.work_date);
            return view(actor, kind, rowOf(actor, kind, id));
          });
        }
        if (!['SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable('Only a request in approval, returned or approved is cancelled; delete a draft.');
        if (maker(actor, r)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); decide(kind, { docId: r.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
        else workflowOf(db).cancel(actor, r.workflow_instance_id, { reason });
        return view(actor, kind, rowOf(actor, kind, id));
      },
      /** An approved request is changed by a new revision, approved again; when it is, the earlier one is superseded and the day recomputed. */
      amend(actor, id, { reason }) {
        const r = rowOf(actor, kind, id);
        needOn(actor, kind, 'amend', `amend ${k.label.toLowerCase()}s`, r);
        if (r.status !== 'APPROVED') throw unprocessable('Only an approved request is amended.');
        if (db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL`).get(r.company_id, r.doc_no)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${r.doc_no} is already open.`);
        return transaction(db, () => {
          const rev = db.prepare(`SELECT MAX(revision_no) AS v FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(r.company_id, r.doc_no).v + 1;
          const arrears = lockState(r.company_id, { ...bodyOf(kind, r), arrears: true }, r.doc_site_id);
          const nid = Number(db.prepare(`INSERT INTO ${table} (company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, doc_site_id, work_date, ${k.cols.join(', ')}, arrears, status, requested_by, project_id, site_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${k.cols.map(() => '?').join(', ')}, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)`)
            .run(r.company_id, r.doc_no, rev, root(r), r.id, todayIST(), r.employee_id, r.doc_site_id, r.work_date, ...k.cols.map((cn) => r[cn]), arrears, actor.user, r.project_id, r.site_id, actor.user, `att_${kind}`, String(r.id), reason).lastInsertRowid);
          writeAudit(db, { entity: table, entityId: nid, action: 'amend', newValues: { from: r.id, revision: rev }, reason, actor: actor.user, companyId: actor.companyId });
          return view(actor, kind, rowOf(actor, kind, nid));
        });
      },
      history(actor, id) { return history(actor, kind, id); },
      print(actor, id) {
        const r = rowOf(actor, kind, id); needOn(actor, kind, 'print', `print ${k.label.toLowerCase()}s`, r);
        const v = view(actor, kind, r);
        writeAudit(db, { entity: table, entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
        const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
        const rows = [['Employee', `${v.employee} (${v.employeeCode})`], ['Day', v.workDate], ['Site', v.site], ...(kind === 'regularisation' ? [['In', v.requestedIn], ['Out', v.requestedOut]] : kind === 'overtime' ? [['When', v.otType === 'PRE' ? 'Before the work' : 'After the work'], ['Hours', ((v.minutesApproved ?? v.minutes) / 60).toFixed(2)]] : [['Entry', v.entryStatus], ['In', v.inTime], ['Out', v.outTime]]), ['Reason', v.reason], ['After the lock', v.arrears ? 'Yes (arrears)' : 'No'], ['Status', v.statusLabel]];
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.docNo)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:30%}</style></head><body><h2>${e(k.label)} ${e(v.docNo)} (revision ${v.revision})</h2><table>${rows.map(([a, x]) => `<tr><th>${e(a)}</th><td>${e(x)}</td></tr>`).join('')}</table></body></html>`;
      },
    };
    return svc;
  };
  const svcs = { regularisation: api('regularisation'), overtime: api('overtime'), manual: api('manual') };

  // ------------------------------------------------------------------ the decision of the approvers
  function decide(kind, instance, actor, outcome, comment) {
    const k = KINDS[kind]; const table = k.table;
    const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      db.prepare(`UPDATE ${table} SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, now, r.id);
      if (r.supersedes_id) db.prepare(`UPDATE ${table} SET status = 'SUPERSEDED', version = version + 1 WHERE id = ? AND status = 'APPROVED'`).run(r.supersedes_id);
      event(`att.${kind === 'manual' ? 'manual' : kind}.approved`, actor, `att_${kind}`, r.id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, workDate: r.work_date, arrears: r.arrears === 1, band: r.band }, r.project_id, r.doc_site_id);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare(`UPDATE ${table} SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
      if (withdrawn) db.prepare(`UPDATE ${table} SET workflow_instance_id = NULL WHERE id = ?`).run(r.id);
    }
    writeAudit(db, { entity: table, entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    tellOwner(r, kind, outcome, comment);
    if (outcome === 'APPROVED') reg()?.onChange(r.company_id, r.employee_id, r.work_date);
  }
  function tellOwner(r, kind, outcome, comment) {
    const to = r.requested_by ?? r.created_by; if (!to || !notif) return;
    const e = empName(r.employee_id);
    notif.notify({ companyId: r.company_id, templateCode: 'att.reg.decided', recipients: [`user:${to}`], data: { what: KINDS[kind].label, ref: r.doc_no, title: `${e?.n ?? ''} on ${r.work_date}`, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment: comment ? `: ${comment}` : '' }, link: KINDS[kind].route, sourceType: `att_${kind}`, sourceId: r.doc_no, eventKey: `att.reg.decided:${r.doc_no}:${outcome}:${Date.now()}` });
  }

  // ------------------------------------------------------------------ registers (lists, exports)
  const regScope = (actor, kind) => {
    const sc = authz.scopeFilter(actor, 'att.register.view', { project: 'x.project_id', site: 'x.doc_site_id' }).sql;
    const me = myEmployee(actor);
    return `x.company_id = :c AND (${sc} OR lower(x.created_by) = lower(:u)${me && KINDS[kind].own ? ` OR x.employee_id = ${Number(me)}` : ''})`;
  };
  const SELECT = 'x.*, e.full_name AS employee_name, e.emp_code AS employee_code, s.name AS site_name';
  const present = (kind) => (r) => {
    const base = { id: r.id, docNo: r.doc_no, revision: r.revision_no, workDate: r.work_date, code: r.employee_code, employee: r.employee_name, employeeId: r.employee_id, site: r.site_name, reason: r.reason, band: r.band, arrears: r.arrears === 1, status: r.status, statusLabel: STATUS_LABELS[r.status] ?? r.status, requestedBy: r.requested_by };
    return kind === 'regularisation' ? { ...base, requestedIn: r.requested_in, requestedOut: r.requested_out } : kind === 'overtime' ? { ...base, otType: r.ot_type, minutes: r.minutes_approved ?? r.minutes_requested } : { ...base, entryStatus: r.entry_status, inTime: r.in_time, outTime: r.out_time };
  };
  const registers = Object.fromEntries(Object.keys(KINDS).map((kind) => {
    const def = lists[kind];
    return [kind, {
      list(actor, query) { need(actor, `${KINDS[kind].perm}.view`, `see ${KINDS[kind].label.toLowerCase()}s`); return runList(db, def, parseListRequest(def, query), { select: SELECT, scopeSql: regScope(actor, kind), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'x.id', map: present(kind) }); },
      exportSource(actor, req) {
        need(actor, `${KINDS[kind].perm}.export`, `export ${KINDS[kind].label.toLowerCase()}s`);
        const opts = { select: SELECT, scopeSql: regScope(actor, kind), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'x.id' };
        return { title: def.label, permission: `${KINDS[kind].perm}.export`, personal: false, columns: Object.entries(def.columns).filter(([key]) => !['siteId', 'updatedAt', 'revision'].includes(key)).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, def, req, opts), rows: () => runList(db, def, req, { ...opts, limit: null, map: present(kind) }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${def.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
      },
    }];
  }));

  // ------------------------------------------------------------------ the approvals worklist (FR-03 to FR-05)
  const TYPES = { [REG_DOC]: 'regularisation', [OT_DOC]: 'overtime', [MANUAL_DOC]: 'manual' };
  const approvals = {
    list(actor) {
      need(actor, 'att.register.view', 'see attendance approvals');
      const tasks = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 });
      const rows = (tasks.rows ?? tasks.data ?? tasks.items ?? []).filter((t) => TYPES[t.instance?.docType]);
      return rows.map((t) => {
        const kind = TYPES[t.instance.docType]; const r = db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ? AND company_id = ?`).get(Number(t.instance.docId), actor.companyId); if (!r) return null;
        const e = empName(r.employee_id);
        return { taskId: t.id, kind, label: KINDS[kind].label, docId: r.id, docNo: r.doc_no, employee: e?.n, employeeCode: e?.c, workDate: r.work_date, band: r.band, arrears: r.arrears === 1, reason: r.reason, step: t.stepCode ?? t.step_code ?? t.step?.code ?? null, requestedBy: r.requested_by, version: t.version };
      }).filter(Boolean);
    },
    /** Approve, reject or return many at once (FR-03): each is decided on its own, so one refusal does not stop the others. */
    bulk(actor, { taskIds, decision, comment }) {
      need(actor, 'att.register.view', 'decide attendance approvals');
      const action = { APPROVE: 'approve', REJECT: 'reject', RETURN: 'return' }[decision];
      const out = taskIds.map((taskId) => { try { workflowOf(db).act(actor, taskId, { action, comment }); return { taskId, ok: true }; } catch (e) { return { taskId, ok: false, error: e.message }; } });
      return { decision, done: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, results: out };
    },
  };
  return { ...svcs, registers, decisions: { regularisation: (...a) => decide('regularisation', ...a), overtime: (...a) => decide('overtime', ...a), manual: (...a) => decide('manual', ...a) }, approvals, bandOf, view, usernameOf };
}

const services = new WeakMap();
export const bindRequests = (db, s) => services.set(db, s);
export const requestsOf = (db) => services.get(db) ?? null;

const step = (code, name, roles, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: roles.map((role) => ({ kind: 'role', role })), slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (kind) => ({
  onApproved: (db, { instance, actor }) => requestsOf(db)?.decisions[kind](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => requestsOf(db)?.decisions[kind](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => requestsOf(db)?.decisions[kind](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => requestsOf(db)?.decisions[kind](instance, actor, 'CANCELLED', comment),
});
const describeOf = (kind) => (db, companyId, id) => {
  const k = KINDS[kind]; const r = db.prepare(`SELECT x.doc_no, x.work_date, x.requested_by, x.created_by, x.doc_site_id, x.project_id, e.full_name FROM ${k.table} x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?`).get(Number(id), companyId);
  return r ? { ref: r.doc_no, title: `${r.full_name} on ${r.work_date}`, originator: r.requested_by ?? r.created_by, projectId: r.project_id ?? undefined, siteId: r.doc_site_id ?? undefined } : null;
};
const summariseOf = (kind) => (db, _actor, id) => {
  const k = KINDS[kind]; const r = db.prepare(`SELECT x.*, e.full_name FROM ${k.table} x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ?`).get(Number(id)); if (!r) return null;
  const extra = kind === 'regularisation' ? [{ label: 'In', value: r.requested_in ?? '—' }, { label: 'Out', value: r.requested_out ?? '—' }] : kind === 'overtime' ? [{ label: 'When', value: r.ot_type === 'PRE' ? 'Before the work' : 'After the work' }, { label: 'Hours', value: (r.minutes_requested / 60).toFixed(2) }] : [{ label: 'Entry', value: r.entry_status }, { label: 'In', value: r.in_time ?? '—' }, { label: 'Out', value: r.out_time ?? '—' }];
  return { fields: [{ label: 'Request', value: r.doc_no }, { label: 'Employee', value: r.full_name }, { label: 'Day', value: r.work_date }, ...extra, { label: 'Reason', value: r.reason }, { label: 'After the lock', value: r.arrears === 1 ? 'Yes: raised as arrears for payroll' : 'No' }] };
};
workflowTypes.register({
  docType: REG_DOC, label: 'Attendance regularisation', processOwner: 'HRMGR', route: () => '/att/approvals', describe: describeOf('regularisation'), summarise: summariseOf('regularisation'),
  defaultDefinition: { name: 'Regularisation: supervisor or project manager, HR manager from the fourth in a month', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('WSUP', 'Supervisor or project manager', ['WSUP', 'PM']), step('HRMGR', 'HR manager (fourth in a month)', ['HRMGR'], { field: 'band', op: 'eq', value: 'REPEATED' })] },
  hooks: hooks('regularisation'),
});
workflowTypes.register({
  docType: OT_DOC, label: 'Overtime request', processOwner: 'HRMGR', route: () => '/att/approvals', describe: describeOf('overtime'), summarise: summariseOf('overtime'),
  defaultDefinition: { name: 'Overtime: supervisor, project manager beyond 4 h a day or 50 h a month, HR manager for policy exceptions', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('WSUP', 'Supervisor', ['WSUP']), step('PM', 'Project manager', ['PM'], { field: 'band', op: 'in', value: ['PM_LEVEL', 'POLICY_EXCEPTION'] }), step('HRMGR', 'HR manager (policy exception)', ['HRMGR'], { field: 'band', op: 'eq', value: 'POLICY_EXCEPTION' })] },
  hooks: hooks('overtime'),
});
workflowTypes.register({
  docType: MANUAL_DOC, label: 'Manual attendance entry', processOwner: 'HRMGR', route: () => '/att/approvals', describe: describeOf('manual'), summarise: summariseOf('manual'),
  defaultDefinition: { name: 'Manual attendance: HR manager', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('HRMGR', 'HR manager', ['HRMGR'])] },
  hooks: hooks('manual'),
});
for (const [docType, kind] of [[REG_DOC, 'regularisation'], [OT_DOC, 'overtime'], [MANUAL_DOC, 'manual']]) {
  evidenceProviders.register(docType, ({ db, instance }) => {
    const r = db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ?`).get(Number(instance.docId)); if (!r) return { sections: [] };
    const day = db.prepare("SELECT status, in_time, out_time, worked_minutes, ot_minutes FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND deleted_at IS NULL").get(r.company_id, r.employee_id, r.work_date);
    const items = [{ label: 'The register shows', value: day ? `${day.status}, in ${day.in_time ?? '—'}, out ${day.out_time ?? '—'}, ${(day.worked_minutes / 60).toFixed(1)} h worked` : 'Nothing yet for that day', format: 'text' }, { label: 'Goes to', value: r.band === 'STANDARD' ? 'The usual approvers' : `Further approval (${r.band.toLowerCase().replace('_', ' ')})`, format: 'text', tone: r.band === 'STANDARD' ? undefined : 'warn' }];
    if (r.arrears === 1) items.push({ label: 'After the lock', value: 'The period is locked: an approval is paid as arrears', format: 'text', tone: 'warn' });
    return { sections: [{ code: `att-${kind}`, title: 'Before approving', kind: 'metrics', items }] };
  });
}
void countList;
