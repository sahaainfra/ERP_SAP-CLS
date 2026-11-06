import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { templateServiceOf } from '../eng/templates.js';
import { addDays } from './att-calc.js';
import { employeesOf } from './employees.js';

// Exit and people relations (part 07.13). A resignation (by the employee, in self-service) or a termination (by HR) states its reason; the last working day comes from the notice of the company's policy (shorter on probation), less a waiver the
// company grants or a buyout the employee pays; the chain approves it (the manager and the HR manager for a resignation or a waiver, the HR manager and the director for a termination). Approval puts the person on notice through the change documents
// of 07.01 and schedules the separation on the last working day, when the user account goes (BR-02) and hr.employee.separated reaches access, assets, payroll and messaging. Each department clears what it holds (IT, stores, accounts, admin, the project,
// HR); the full-and-final inputs (leave encashment, notice recovery or pay, gratuity eligibility, claims to pay, advances and items to recover) are released to payroll only when every clearance is cleared or waived (BR-01). Relieving and experience
// letters come from the template library. Grievances (anonymous ones keep no identity) are tracked to resolution against an SLA; disciplinary cases are restricted to HR and the director, and the employee sees and answers what concerns them.
export const SEP_DOC = 'HR_SEPARATION';
export const SEP_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Accepted, clearing', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SETTLED: 'Settled' };
export const REASONS = { BETTER_OPPORTUNITY: 'Better opportunity', PERSONAL: 'Personal reasons', RELOCATION: 'Relocation', HIGHER_STUDIES: 'Higher studies', HEALTH: 'Health', RETIREMENT: 'Retirement', MISCONDUCT: 'Misconduct', PERFORMANCE: 'Performance', REDUNDANCY: 'Redundancy', CONTRACT_END: 'End of contract', OTHER: 'Other' };
export const GRV_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Received', IN_REVIEW: 'Being looked into', RESOLVED: 'Resolved', CLOSED: 'Closed', REJECTED: 'Not a grievance', CANCELLED: 'Withdrawn' };
export const GRV_CATEGORIES = { WAGES: 'Wages and payments', WORKING_CONDITIONS: 'Working conditions', SAFETY: 'Safety', HARASSMENT: 'Harassment', DISCRIMINATION: 'Discrimination', LEAVE: 'Leave and attendance', ACCOMMODATION: 'Accommodation and food', SUPERVISOR: 'Supervisor or manager', OTHER: 'Other' };
export const CASE_STATUS = { OPEN: 'Open', SHOW_CAUSE: 'Show-cause issued', RESPONDED: 'Response received', INQUIRY: 'Under inquiry', ACTION_TAKEN: 'Action taken', CLOSED: 'Closed', DROPPED: 'Dropped' };
const DEFAULT_CLEARANCE = [
  { code: 'IT', name: 'IT', roles: ['ITADM'], items: [['ACCESS', 'User account and system access removed'], ['DEVICES', 'Laptop, phone and SIM returned']] },
  { code: 'STORES', name: 'Stores', roles: ['SK', 'STOREMGR'], items: [['TOOLS', 'Tools returned'], ['PPE', 'PPE returned (helmet, shoes, harness)']] },
  { code: 'ACCOUNTS', name: 'Accounts', roles: ['ACCMGR'], items: [['ADVANCES', 'Advances settled or recovered'], ['IMPREST', 'Imprest and cash accounted for']] },
  { code: 'ADMIN', name: 'Admin', roles: ['HRMGR'], items: [['ID_CARD', 'ID card and access card returned'], ['ACCOMMODATION', 'Accommodation vacated']] },
  { code: 'PROJECT', name: 'Project', roles: ['PM'], manager: true, items: [['HANDOVER', 'Documents and drawings handed over'], ['TASKS', 'Open tasks handed over']] },
  { code: 'HR', name: 'HR', roles: ['HRMGR'], items: [['EXIT_INTERVIEW', 'Exit interview done'], ['DOCUMENTS', 'Company documents returned']] },
];
for (const [key, dataType, def, description, extra] of [
  ['hr.exit.notice_days', 'integer', 30, 'FR-01: the notice of a confirmed employee (calendar days).', { min: 0, max: 180 }],
  ['hr.exit.notice_days_probation', 'integer', 15, 'FR-01: the notice of an employee on probation (not yet confirmed).', { min: 0, max: 180 }],
  ['hr.exit.clearance_departments', 'json', DEFAULT_CLEARANCE, 'FR-02: the departments that clear a leaver, the roles that clear for them (or the reporting manager) and their items.', {}],
  ['hr.fnf.gratuity_min_years', 'integer', 5, 'FR-04: the years of service from which a leaver is eligible for gratuity.', { min: 1, max: 10 }],
  ['hr.grievance.sla_days', 'json', { HARASSMENT: 3, SAFETY: 3, DEFAULT: 7 }, 'FR-06: the days to resolve a grievance, by category (DEFAULT for the others).', {}],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const money = (m) => (m == null ? null : Math.round(m) / 100);
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const sys = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export const separationList = defineList({
  code: 'hr.separations', label: 'Separations', permission: 'hr.separation.view',
  from: 'hr_separations s JOIN hr_employees e ON e.id = s.employee_id', where: 's.deleted_at IS NULL', searchable: ['s.doc_no', 'e.full_name', 'e.emp_code'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 's.doc_no', type: 'text', label: 'Separation' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' },
    type: { sql: 's.sep_type', type: 'enum', label: 'Kind', options: [['RESIGNATION', 'Resignation'], ['TERMINATION', 'Termination']] }, reason: { sql: 's.reason_code', type: 'enum', label: 'Reason', options: Object.entries(REASONS) },
    submittedOn: { sql: 's.submitted_on', type: 'date', label: 'Submitted' }, lastWorkingDay: { sql: 's.last_working_day', type: 'date', label: 'Last working day' }, status: { sql: 's.status', type: 'enum', label: 'Status', options: Object.entries(SEP_STATUS) },
  },
});
export const grievanceList = defineList({
  code: 'hr.grievances', label: 'Grievances', permission: 'hr.grievance.view',
  from: 'hr_grievances g', where: 'g.deleted_at IS NULL', searchable: ['g.doc_no', 'g.subject'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'g.doc_no', type: 'text', label: 'Grievance' }, subject: { sql: 'g.subject', type: 'text', label: 'Subject' }, category: { sql: 'g.category', type: 'enum', label: 'Category', options: Object.entries(GRV_CATEGORIES) },
    anonymous: { sql: 'g.anonymous', type: 'enum', label: 'Anonymous', options: [['1', 'Anonymous'], ['0', 'Named']] }, assignedTo: { sql: 'g.assigned_to', type: 'text', label: 'Officer' }, slaDue: { sql: 'g.sla_due', type: 'date', label: 'Resolve by' },
    docDate: { sql: 'g.doc_date', type: 'date', label: 'Raised' }, status: { sql: 'g.status', type: 'enum', label: 'Status', options: Object.entries(GRV_STATUS) },
  },
});

export function createExitService({ db, dep }) {
  const { may, need, nextDoc, event, usernameOf, myEmployee } = dep;
  const notif = notificationsOf(db);
  const today = () => todayIST();
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: today() });
  const maker = (actor, r) => same(r.created_by, actor.user);
  const emp = (id) => db.prepare('SELECT e.*, g.name AS designation, g.level AS grade_level, d.name AS department, u.username, (SELECT p.lifecycle FROM iam_user_profiles p WHERE p.user_id = e.user_id) AS user_lifecycle FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN org_departments d ON d.id = e.department_id LEFT JOIN iam_users u ON u.id = e.user_id WHERE e.id = ?').get(id);
  const reportees = (employeeId) => new Set(db.prepare('WITH RECURSIVE r(id, depth) AS (SELECT id, 1 FROM hr_employees WHERE manager_id = ? AND deleted_at IS NULL UNION SELECT e.id, r.depth + 1 FROM hr_employees e JOIN r ON e.manager_id = r.id WHERE e.deleted_at IS NULL AND r.depth < 12) SELECT id FROM r').all(employeeId).map((x) => x.id));
  const meOf = (actor) => { const id = myEmployee(actor); if (!id) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record. Ask HR to link it.'); return emp(id); };
  const holders = (companyId, roles) => db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => roles.some((r) => json(u.roles_json, []).includes(r))).map((u) => u.username);
  const tell = (companyId, to, templateCode, data, link, key) => to && notif.notify({ companyId, templateCode, recipients: [`user:${to}`], data, link, sourceType: 'hr_exit', sourceId: key, eventKey: `${templateCode}:${key}` });

  // ------------------------------------------------------------------ the notice and the last working day (FR-01)
  /** The notice of a person: the probation notice until they are confirmed, the standard notice after. */
  const noticeOf = (companyId, e) => Number(param(companyId, e.confirmation_date && e.confirmation_date <= today() ? 'hr.exit.notice_days' : 'hr.exit.notice_days_probation')) || 0;
  /** The computation, done again at every save and submit: the standard last day, the day asked for, the days short of the notice and how they are treated. */
  function computeNotice(companyId, e, b) {
    const notice = noticeOf(companyId, e);
    const standard = addDays(b.submittedOn, notice);
    let lwd = b.requestedLwd ?? standard; const problems = [];
    if (lwd < b.submittedOn) problems.push({ field: 'requestedLwd', message: 'The last working day cannot be before the day it is submitted' });
    if (lwd < e.doj) problems.push({ field: 'requestedLwd', message: 'The last working day is on or after the date of joining' });
    const short = Math.max(0, days(lwd, standard));
    let mode = b.earlyMode ?? 'NONE';
    if (short > 0 && mode === 'NONE' && b.type === 'RESIGNATION') problems.push({ field: 'earlyMode', message: `The day asked for is ${short} day(s) short of the notice: ask for a waiver or buy the days out` });
    if (short === 0) mode = 'NONE';
    if (lwd > addDays(standard, 90)) { problems.push({ field: 'requestedLwd', message: 'The last working day is more than 90 days after the notice ends' }); lwd = standard; }
    const noticePay = b.type === 'TERMINATION' ? short : 0;
    return { notice, standard, lwd, short, mode: b.type === 'TERMINATION' ? 'NONE' : mode, waiver: b.type === 'RESIGNATION' && mode === 'WAIVER' ? short : 0, buyout: b.type === 'RESIGNATION' && mode === 'BUYOUT' ? short : 0, noticePay, problems };
  }

  // ------------------------------------------------------------------ separations
  const canSeeEmp = (actor, employeeId) => { if (may(actor, 'hr.separation.view_all')) return true; const me = myEmployee(actor); return Boolean(me && (me === employeeId || reportees(me).has(employeeId))); };
  const sepRow = (actor, id) => { const s = db.prepare('SELECT * FROM hr_separations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!s || !(maker(actor, s) || canSeeEmp(actor, s.employee_id))) throw notFound('That separation does not exist.'); return s; };
  const clearancesOf = (sepId) => db.prepare("SELECT * FROM hr_clearances WHERE separation_id = ? AND deleted_at IS NULL AND clr_status != 'CANCELLED' ORDER BY id").all(sepId);
  const clearanceView = (actor, c) => ({ id: c.id, separationId: c.separation_id, department: c.department_code, name: c.department_name, ownerRoles: json(c.owner_roles, []), ownerUser: c.owner_user, items: json(c.items_json, []).map((i) => ({ ...i, recovery: money(i.recoveryMinor ?? 0) })), dueDate: c.due_date, status: c.clr_status, clearedBy: c.cleared_by, clearedAt: c.cleared_at, waivedBy: c.waived_by, waiveReason: c.waive_reason, rowVersion: c.version, can: { clear: c.clr_status === 'PENDING' && mayClear(actor, c), waive: c.clr_status === 'PENDING' && may(actor, 'hr.clearance.waive') } });
  function mayClear(actor, c) {
    if (!may(actor, 'hr.clearance.clear')) return false;
    const s = db.prepare('SELECT employee_id FROM hr_separations WHERE id = ?').get(c.separation_id);
    if (s && myEmployee(actor) === s.employee_id) return false; // nobody clears themselves
    return (c.owner_user && same(c.owner_user, actor.user)) || json(c.owner_roles, []).some((r) => (actor.roles ?? []).includes(r));
  }
  function sepView(actor, s, { detail = false } = {}) {
    const e = emp(s.employee_id); const editable = ['DRAFT', 'RETURNED'].includes(s.status) && maker(actor, s); const hr = may(actor, 'hr.separation.view_all');
    const out = {
      id: s.id, docNo: s.doc_no, status: s.status, statusLabel: SEP_STATUS[s.status], rowVersion: s.version, type: s.sep_type, employeeId: s.employee_id, employee: e.full_name, employeeCode: e.emp_code, designation: e.designation, doj: e.doj, employmentStatus: e.employment_status,
      reasonCode: s.reason_code, reasonLabel: REASONS[s.reason_code], reason: hr || myEmployee(actor) === s.employee_id ? s.reason : null, submittedOn: s.submitted_on, noticeDays: s.notice_days, standardLwd: s.standard_lwd, lastWorkingDay: s.last_working_day, earlyMode: s.early_mode, waiverDays: s.waiver_days, buyoutDays: s.buyout_days, noticePayDays: s.notice_pay_days,
      workflowInstanceId: s.workflow_instance_id, requestedBy: s.requested_by, approvedAt: s.approved_at, fnfReleasedAt: s.fnf_released_at, relievingIssued: Boolean(s.relieving_doc_id), experienceIssued: Boolean(s.experience_doc_id),
      can: {
        edit: editable, submit: editable && may(actor, 'hr.separation.submit'), delete: s.status === 'DRAFT' && maker(actor, s), withdraw: s.status === 'SUBMITTED' && same(s.requested_by, actor.user),
        cancel: (['SUBMITTED', 'RETURNED'].includes(s.status) && maker(actor, s)) || (s.status === 'APPROVED' && s.last_working_day > today() && may(actor, 'hr.separation.cancel') && hr),
        interview: ['APPROVED', 'SETTLED'].includes(s.status) && (may(actor, 'hr.separation.interview') || myEmployee(actor) === s.employee_id), fnf: s.status === 'APPROVED' && may(actor, 'hr.separation.fnf'),
        letter: s.last_working_day <= today() && ['APPROVED', 'SETTLED'].includes(s.status) && may(actor, 'hr.separation.letter'), print: may(actor, 'hr.separation.print'),
      },
    };
    if (detail) {
      out.clearances = clearancesOf(s.id).map((c) => clearanceView(actor, c));
      const iv = db.prepare('SELECT * FROM hr_exit_interviews WHERE separation_id = ? AND deleted_at IS NULL').get(s.id);
      out.interview = iv && (hr || may(actor, 'hr.separation.interview') || myEmployee(actor) === s.employee_id) ? { rating: iv.overall_rating, reasonCode: iv.reason_code, wouldRejoin: iv.would_rejoin == null ? null : Boolean(iv.would_rejoin), responses: json(iv.responses_json, {}), by: iv.conducted_by, at: iv.conducted_at } : iv ? { done: true } : null;
      out.fnf = s.fnf_json ? json(s.fnf_json, null) : null;
    }
    return out;
  }
  const sepScope = (actor) => { if (may(actor, 'hr.separation.view_all')) return 's.company_id = :c'; const me = myEmployee(actor); const ids = me ? [me, ...reportees(me)] : []; return `s.company_id = :c AND s.employee_id IN (${ids.length ? ids.join(',') : '0'})`; };
  const separations = {
    list(actor, query) { need(actor, 'hr.separation.view', 'see separations'); return runList(db, separationList, parseListRequest(separationList, query), { select: 's.*', scopeSql: sepScope(actor), params: { c: actor.companyId }, tieBreaker: 's.id', map: (s) => sepView(actor, s) }); },
    exportSource(actor, req) {
      need(actor, 'hr.separation.export', 'export separations');
      const opts = { select: 's.*', scopeSql: sepScope(actor), params: { c: actor.companyId }, tieBreaker: 's.id' };
      return { title: separationList.label, permission: 'hr.separation.export', personal: true, columns: Object.entries(separationList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, separationList, req, opts), rows: () => runList(db, separationList, req, { ...opts, limit: null, map: (s) => { const v = sepView(actor, s); return { docNo: v.docNo, employee: v.employee, code: v.employeeCode, type: v.type, reason: v.reasonLabel, submittedOn: v.submittedOn, lastWorkingDay: v.lastWorkingDay, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${separationList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { return sepView(actor, sepRow(actor, id), { detail: true }); },
    mine(actor) { need(actor, 'hr.separation.view', 'see your resignation'); const me = meOf(actor); const s = db.prepare("SELECT * FROM hr_separations WHERE employee_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED') ORDER BY id DESC LIMIT 1").get(me.id); return { employee: { id: me.id, name: me.full_name, code: me.emp_code, doj: me.doj, confirmed: Boolean(me.confirmation_date && me.confirmation_date <= today()), noticeDays: noticeOf(actor.companyId, me) }, separation: s ? sepView(actor, s, { detail: true }) : null }; },
    /** The preview of the notice computation as typed. */
    preview(actor, b) { const e = b.type === 'TERMINATION' && b.employeeId ? emp(b.employeeId) : meOf(actor); if (!e || e.company_id !== actor.companyId) throw notFound('That employee does not exist.'); const r = computeNotice(actor.companyId, e, b); return { noticeDays: r.notice, standardLwd: r.standard, lastWorkingDay: r.lwd, shortDays: r.short, waiverDays: r.waiver, buyoutDays: r.buyout, noticePayDays: r.noticePay, problems: r.problems }; },
    create(actor, b) {
      let e;
      if (b.type === 'RESIGNATION') { need(actor, 'hr.separation.create', 'resign'); e = meOf(actor); if (b.employeeId && b.employeeId !== e.id) throw forbidden('You resign for yourself; HR records a termination.'); }
      else { need(actor, 'hr.separation.terminate', 'start a termination'); e = emp(b.employeeId); if (!e || e.company_id !== actor.companyId || e.deleted_at) throw notFound('That employee does not exist.'); if (myEmployee(actor) === e.id) throw forbidden('Nobody terminates themselves.'); }
      if (!['ACTIVE', 'NOTICE'].includes(e.employment_status) || e.record_status !== 'APPROVED') throw conflict('Only an employee who is in service is separated.');
      if (db.prepare("SELECT 1 FROM hr_separations WHERE employee_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')").get(e.id)) throw conflict('This person has a separation in progress already.');
      const r = computeNotice(actor.companyId, e, b); if (r.problems.length) throw badRequest('Some fields are not valid.', r.problems);
      return transaction(db, () => {
        const no = nextDoc(actor, SEP_DOC, 'hr_separations', 'SEP');
        const id = Number(db.prepare("INSERT INTO hr_separations (company_id, doc_no, doc_date, employee_id, sep_type, reason_code, reason, submitted_on, notice_days, standard_lwd, last_working_day, early_mode, waiver_days, buyout_days, notice_pay_days, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'hr_separation')")
          .run(actor.companyId, no, today(), e.id, b.type, b.reasonCode, b.reason, b.submittedOn, r.notice, r.standard, r.lwd, r.mode, r.waiver, r.buyout, r.noticePay, e.project_id ?? null, e.site_id ?? null, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'hr_separations', entityId: id, action: 'create', newValues: { docNo: no, type: b.type, lastWorkingDay: r.lwd }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? separations.submit(actor, id, {}) : separations.get(actor, id);
      });
    },
    update(actor, id, b) {
      const s = sepRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict(`A separation that is ${SEP_STATUS[s.status].toLowerCase()} is not changed.`);
      if (!maker(actor, s)) throw forbidden(`Only ${s.created_by}, who raised it, changes it.`);
      if (s.version !== b.version) throw conflict('This separation was changed by someone else. Reload it and try again.');
      const r = computeNotice(actor.companyId, emp(s.employee_id), { ...b, type: s.sep_type }); if (r.problems.length) throw badRequest('Some fields are not valid.', r.problems);
      db.prepare('UPDATE hr_separations SET reason_code = ?, reason = ?, submitted_on = ?, notice_days = ?, standard_lwd = ?, last_working_day = ?, early_mode = ?, waiver_days = ?, buyout_days = ?, notice_pay_days = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.reasonCode, b.reason, b.submittedOn, r.notice, r.standard, r.lwd, r.mode, r.waiver, r.buyout, r.noticePay, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_separations', entityId: id, action: 'update', oldValues: { lastWorkingDay: s.last_working_day }, newValues: { lastWorkingDay: r.lwd }, actor: actor.user, companyId: actor.companyId });
      return separations.get(actor, id);
    },
    remove(actor, id) {
      const s = sepRow(actor, id);
      if (s.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; withdraw or cancel the others.');
      if (!maker(actor, s)) throw forbidden(`Only ${s.created_by} deletes this draft.`);
      db.prepare('UPDATE hr_separations SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'hr_separations', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const s = sepRow(actor, id); need(actor, 'hr.separation.submit', 'submit separations');
      if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict(`This separation is ${SEP_STATUS[s.status].toLowerCase()}.`);
      if (!maker(actor, s)) throw forbidden(`Only ${s.created_by}, who raised it, submits it.`);
      const e = emp(s.employee_id); const r = computeNotice(actor.companyId, e, { type: s.sep_type, submittedOn: s.submitted_on, requestedLwd: s.last_working_day, earlyMode: s.early_mode });
      if (r.problems.length) throw badRequest('The separation cannot be sent yet.', r.problems);
      return transaction(db, () => {
        const ctx = { type: s.sep_type, waiver: s.waiver_days > 0, senior: (e.grade_level ?? 1) >= 7, employeeId: s.employee_id };
        if (s.status === 'RETURNED') workflowOf(db).resubmit(actor, s.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: SEP_DOC, docId: id, comment: comment ?? (s.sep_type === 'RESIGNATION' ? 'Resignation' : 'Termination'), context: ctx }); db.prepare('UPDATE hr_separations SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE hr_separations SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_separations', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return separations.get(actor, id);
      });
    },
    withdraw(actor, id, { reason }) {
      const s = sepRow(actor, id);
      if (s.status !== 'SUBMITTED') throw unprocessable('Only a separation in approval is withdrawn.');
      if (!same(s.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, s.workflow_instance_id, { comment: reason });
      return separations.get(actor, id);
    },
    /** A separation in approval is cancelled by whoever raised it; an accepted one, before the last working day, by HR: the scheduled separation is taken back and the person is active again. */
    cancel(actor, id, { reason }) {
      const s = sepRow(actor, id); const v = sepView(actor, s);
      if (!v.can.cancel) throw unprocessable(s.status === 'APPROVED' ? 'An accepted separation is cancelled by HR before the last working day.' : 'This separation cannot be cancelled now.');
      return transaction(db, () => {
        if (s.status === 'SUBMITTED') { workflowOf(db).abandon(actor.companyId, s.workflow_instance_id, actor.user, 'CANCELLED', reason); decide({ docId: s.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); return separations.get(actor, id); }
        if (s.status === 'APPROVED') {
          const ex = employeesOf(db).exits;
          if (s.exit_change_id) ex.unschedule(actor, s.exit_change_id, reason);
          ex.schedule(actor, s.employee_id, { status: 'ACTIVE', effectiveDate: today(), reason: `Separation ${s.doc_no} cancelled: ${reason}`, sourceId: s.id });
          db.prepare("UPDATE hr_clearances SET clr_status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE separation_id = ? AND clr_status = 'PENDING'").run(actor.user, nowIso(), s.id);
        }
        db.prepare("UPDATE hr_separations SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_separations', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        event('hr.separation.cancelled', actor, 'hr_separation', id, s.company_id, { docNo: s.doc_no, employeeId: s.employee_id }, s.project_id, s.site_id);
        return separations.get(actor, id);
      });
    },
    history(actor, id) { const s = sepRow(actor, id); return { approvals: s.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(s.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('hr_separations', 'hr_clearances') AND (entity_id = ? OR entity_id IN (SELECT CAST(id AS TEXT) FROM hr_clearances WHERE separation_id = ?)) ORDER BY id").all(String(id), id).map((x) => ({ action: x.action, by: x.actor, reason: x.reason, at: x.at })) }; },
    print(actor, id) {
      need(actor, 'hr.separation.print', 'print separations'); const v = sepView(actor, sepRow(actor, id), { detail: true });
      writeAudit(db, { entity: 'hr_separations', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>${esc(v.type === 'RESIGNATION' ? 'Resignation' : 'Termination')} ${esc(v.docNo)}</h1><p>${esc(v.employee)} (${esc(v.employeeCode)}) · ${esc(v.designation ?? '')} · ${esc(v.statusLabel)}</p><p>Submitted ${esc(v.submittedOn)} · Notice ${v.noticeDays} days · Last working day ${esc(v.lastWorkingDay)}${v.waiverDays ? ` · waiver ${v.waiverDays} days` : ''}${v.buyoutDays ? ` · buyout ${v.buyoutDays} days` : ''}</p><h2>Clearance</h2><table><tr><th>Department</th><th>Status</th><th>By</th></tr>${v.clearances.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.status)}</td><td>${esc(c.clearedBy ?? c.waivedBy ?? '')}</td></tr>`).join('')}</table></body></html>`;
    },
  };

  // ------------------------------------------------------------------ clearances (FR-02)
  function openClearances(actor, s) {
    const e = emp(s.employee_id); const depts = param(s.company_id, 'hr.exit.clearance_departments'); const list = Array.isArray(depts) && depts.length ? depts : DEFAULT_CLEARANCE;
    const managerUser = e.manager_id ? usernameOf(db.prepare('SELECT user_id FROM hr_employees WHERE id = ?').get(e.manager_id)?.user_id) : null;
    for (const d of list) {
      const items = (d.items ?? []).map(([code, label]) => ({ code, label, status: 'PENDING', note: null, recoveryMinor: 0 }));
      db.prepare('INSERT OR IGNORE INTO hr_clearances (company_id, separation_id, department_code, department_name, owner_roles, owner_user, items_json, due_date, clr_status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'PENDING\', ?, ?, ?, \'hr_separation\')')
        .run(s.company_id, s.id, d.code, d.name, JSON.stringify(d.roles ?? []), d.manager ? managerUser : null, JSON.stringify(items), s.last_working_day, s.project_id, s.site_id, actor.user);
      const to = d.manager && managerUser ? [managerUser] : holders(s.company_id, d.roles ?? []);
      for (const u of to) tell(s.company_id, u, 'sep.clearance', { dept: d.name, name: e.full_name, code: e.emp_code, due: s.last_working_day }, '/exit/clearances', `clr:${s.id}:${d.code}:${u}`);
    }
  }
  /** What the system knows for an item, so that nobody clears what is not done: the user account (IT), the advances outstanding (accounts), the open tasks (project), the exit interview (HR). */
  function facts(s) {
    const e = emp(s.employee_id);
    const advances = db.prepare("SELECT COALESCE(SUM(balance_minor), 0) AS n FROM exp_advances WHERE employee_id = ? AND status = 'DISBURSED' AND deleted_at IS NULL").get(s.employee_id)?.n ?? 0;
    const tasks = e.username ? db.prepare("SELECT COUNT(*) AS n FROM tsk_tasks t JOIN tsk_assignees a ON a.task_id = t.id AND a.role = 'ASSIGNEE' WHERE t.company_id = ? AND lower(a.user_ref) = lower(?) AND t.status NOT IN ('DONE', 'VERIFIED', 'CLOSED', 'CANCELLED') AND t.deleted_at IS NULL").get(s.company_id, e.username).n : 0;
    return { userActive: Boolean(e.user_id && e.user_lifecycle !== 'DEACTIVATED'), advancesMinor: advances, openTasks: tasks, interview: Boolean(db.prepare('SELECT 1 FROM hr_exit_interviews WHERE separation_id = ? AND deleted_at IS NULL').get(s.id)) };
  }
  const tryFacts = (s) => { try { return facts(s); } catch { return { userActive: false, advancesMinor: 0, openTasks: 0, interview: false }; } };
  const clearances = {
    worklist(actor) {
      need(actor, 'hr.clearance.view', 'see clearance items');
      const rows = db.prepare("SELECT c.*, s.doc_no, s.employee_id, s.last_working_day FROM hr_clearances c JOIN hr_separations s ON s.id = c.separation_id WHERE c.company_id = ? AND c.clr_status = 'PENDING' AND c.deleted_at IS NULL AND s.status = 'APPROVED' ORDER BY c.due_date, c.id").all(actor.companyId);
      return rows.filter((c) => mayClear(actor, c) || may(actor, 'hr.clearance.waive')).map((c) => { const e = emp(c.employee_id); const left = days(today(), c.due_date ?? today()); return { ...clearanceView(actor, c), docNo: c.doc_no, employee: e.full_name, employeeCode: e.emp_code, lastWorkingDay: c.last_working_day, daysLeft: left, tone: left < 0 ? 'RED' : left <= 3 ? 'AMBER' : 'GREEN', facts: tryFacts({ id: c.separation_id, employee_id: c.employee_id, company_id: c.company_id }) }; });
    },
    /** The department marks its items: cleared, not applicable, or cleared with an amount to recover in the full-and-final. */
    update(actor, id, { items, version }) {
      const c = db.prepare('SELECT * FROM hr_clearances WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!c) throw notFound('That clearance does not exist.');
      if (!mayClear(actor, c)) throw forbidden(`The ${c.department_name} clearance is done by its department.`);
      if (c.clr_status !== 'PENDING') throw conflict(`This clearance is ${c.clr_status.toLowerCase()} already.`);
      if (version !== c.version) throw conflict('This clearance was changed by someone else. Reload it and try again.');
      const s = db.prepare('SELECT * FROM hr_separations WHERE id = ?').get(c.separation_id); const f = facts(s);
      const cur = json(c.items_json, []); const problems = [];
      const next = cur.map((it) => {
        const u = items.find((x) => x.code === it.code); if (!u) return it;
        const n = { ...it, status: u.status, note: u.note ?? it.note, recoveryMinor: Math.round((u.recovery ?? 0) * 100) };
        if (u.status === 'CLEARED') {
          if (it.code === 'ACCESS' && f.userActive && s.last_working_day > today()) problems.push({ field: `items.${it.code}`, message: 'The user account is still active: it is removed on the last working day' });
          if (it.code === 'ADVANCES' && f.advancesMinor > 0 && n.recoveryMinor < f.advancesMinor) problems.push({ field: `items.${it.code}`, message: `Advances of ${money(f.advancesMinor)} are outstanding: settle them or enter them as a recovery in the full-and-final` });
          if (it.code === 'EXIT_INTERVIEW' && !f.interview) problems.push({ field: `items.${it.code}`, message: 'The exit interview is not recorded yet' });
        }
        return n;
      });
      if (problems.length) throw badRequest('Some items cannot be cleared yet.', problems);
      const done = next.every((i) => ['CLEARED', 'NA'].includes(i.status));
      db.prepare('UPDATE hr_clearances SET items_json = ?, clr_status = ?, cleared_by = ?, cleared_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(next), done ? 'CLEARED' : 'PENDING', done ? actor.user : null, done ? nowIso() : null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_clearances', entityId: id, action: done ? 'clear' : 'update', newValues: { items: next.map((i) => `${i.code}:${i.status}`) }, actor: actor.user, companyId: actor.companyId });
      if (done) event('hr.clearance.cleared', actor, 'hr_clearance', id, actor.companyId, { separationId: c.separation_id, department: c.department_code }, null, null);
      return clearanceView(actor, db.prepare('SELECT * FROM hr_clearances WHERE id = ?').get(id));
    },
    /** BR-01: a department that cannot clear is waived only by HR, with the reason, and never by the person who leaves. */
    waive(actor, id, { reason }) {
      need(actor, 'hr.clearance.waive', 'waive clearances');
      const c = db.prepare('SELECT * FROM hr_clearances WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!c) throw notFound('That clearance does not exist.');
      if (c.clr_status !== 'PENDING') throw conflict(`This clearance is ${c.clr_status.toLowerCase()} already.`);
      const s = db.prepare('SELECT employee_id FROM hr_separations WHERE id = ?').get(c.separation_id);
      if (myEmployee(actor) === s.employee_id) throw forbidden('Nobody waives their own clearance.');
      db.prepare("UPDATE hr_clearances SET clr_status = 'WAIVED', waived_by = ?, waive_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, reason, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_clearances', entityId: id, action: 'waive', reason, actor: actor.user, companyId: actor.companyId });
      return clearanceView(actor, db.prepare('SELECT * FROM hr_clearances WHERE id = ?').get(id));
    },
  };

  // ------------------------------------------------------------------ the exit interview (FR-03)
  const interviews = {
    record(actor, sepId, b) {
      const s = sepRow(actor, sepId);
      if (!['APPROVED', 'SETTLED'].includes(s.status)) throw unprocessable('The exit interview is recorded once the separation is accepted.');
      if (!(may(actor, 'hr.separation.interview') || myEmployee(actor) === s.employee_id)) throw forbidden('HR or the person leaving records the exit interview.');
      const cols = [JSON.stringify(b.responses ?? {}), b.rating, b.reasonCode ?? null, b.wouldRejoin == null ? null : b.wouldRejoin ? 1 : 0, actor.user, nowIso()];
      const ex = db.prepare('SELECT id FROM hr_exit_interviews WHERE separation_id = ? AND deleted_at IS NULL').get(sepId);
      if (ex) db.prepare('UPDATE hr_exit_interviews SET responses_json = ?, overall_rating = ?, reason_code = ?, would_rejoin = ?, conducted_by = ?, conducted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...cols, actor.user, nowIso(), ex.id);
      else db.prepare("INSERT INTO hr_exit_interviews (company_id, separation_id, responses_json, overall_rating, reason_code, would_rejoin, conducted_by, conducted_at, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_separation')").run(actor.companyId, sepId, ...cols, s.project_id, s.site_id, actor.user);
      writeAudit(db, { entity: 'hr_separations', entityId: sepId, action: 'exit_interview', newValues: { rating: b.rating }, actor: actor.user, companyId: actor.companyId });
      return separations.get(actor, sepId);
    },
    analytics(actor, { from = null, to = null } = /** @type {any} */ ({})) {
      need(actor, 'hr.separation.interview', 'see the exit interview analysis');
      const rows = db.prepare("SELECT i.*, s.reason_code AS sep_reason, s.sep_type, d.name AS department FROM hr_exit_interviews i JOIN hr_separations s ON s.id = i.separation_id JOIN hr_employees e ON e.id = s.employee_id LEFT JOIN org_departments d ON d.id = e.department_id WHERE i.company_id = ? AND i.deleted_at IS NULL AND (? IS NULL OR substr(i.conducted_at, 1, 10) >= ?) AND (? IS NULL OR substr(i.conducted_at, 1, 10) <= ?)").all(actor.companyId, from, from, to, to);
      const by = (k) => { const m = {}; for (const r of rows) { const key = r[k] ?? r.sep_reason ?? 'OTHER'; m[key] = (m[key] ?? 0) + 1; } return Object.entries(m).map(([key, n]) => ({ key, label: REASONS[key] ?? key, n })).sort((a, b) => b.n - a.n); };
      const rated = rows.filter((r) => r.overall_rating != null); const rejoin = rows.filter((r) => r.would_rejoin != null);
      const leavers = db.prepare("SELECT COUNT(*) AS n FROM hr_separations WHERE company_id = ? AND status IN ('APPROVED', 'SETTLED') AND deleted_at IS NULL AND (? IS NULL OR last_working_day >= ?) AND (? IS NULL OR last_working_day <= ?)").get(actor.companyId, from, from, to, to).n;
      const depts = {}; for (const r of rows) { const k = r.department ?? '—'; depts[k] = depts[k] ?? { name: k, n: 0, rating: 0 }; depts[k].n += 1; depts[k].rating += r.overall_rating ?? 0; }
      return { interviews: rows.length, leavers, avgRating: rated.length ? Math.round((rated.reduce((s, r) => s + r.overall_rating, 0) / rated.length) * 10) / 10 : null, wouldRejoinPct: rejoin.length ? Math.round((rejoin.filter((r) => r.would_rejoin === 1).length / rejoin.length) * 100) : null, byReason: by('reason_code'), byDepartment: Object.values(depts).map((d) => ({ name: d.name, n: d.n, avgRating: d.n ? Math.round((d.rating / d.n) * 10) / 10 : null })) };
    },
  };

  // ------------------------------------------------------------------ full-and-final inputs (FR-04, BR-01) and letters (FR-05)
  function fnfInputs(actor, s) {
    const e = emp(s.employee_id);
    const served = Math.max(0, days(s.submitted_on, s.last_working_day));
    let leaveDays = 0;
    try {
      const yr = Number(s.last_working_day.slice(0, 4));
      for (const t of db.prepare("SELECT * FROM lv_types WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'").all(s.company_id)) {
        const rules = json(t.rules_json, {}); if (!rules.encashable) continue;
        const n = db.prepare('SELECT COALESCE(SUM(days), 0) AS d FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ? AND deleted_at IS NULL').get(s.company_id, s.employee_id, t.id, yr).d;
        leaveDays += Math.max(0, n);
      }
    } catch { leaveDays = 0; }
    const yearsExact = days(e.doj, s.last_working_day) / 365.25; const minYears = Number(param(s.company_id, 'hr.fnf.gratuity_min_years')) || 5;
    const gratuityYears = Math.floor(yearsExact) + (yearsExact - Math.floor(yearsExact) >= 0.5 ? 1 : 0);
    const claims = (() => { try { return db.prepare("SELECT COALESCE(SUM(net_payable_minor), 0) AS n, COUNT(*) AS c FROM exp_claims WHERE employee_id = ? AND status IN ('SUBMITTED', 'APPROVED', 'PASSED') AND deleted_at IS NULL").get(s.employee_id); } catch { return { n: 0, c: 0 }; } })();
    const advances = (() => { try { return db.prepare("SELECT COALESCE(SUM(balance_minor), 0) AS n FROM exp_advances WHERE employee_id = ? AND status = 'DISBURSED' AND deleted_at IS NULL").get(s.employee_id).n; } catch { return 0; } })();
    const cl = clearancesOf(s.id);
    const itemRecoveries = cl.flatMap((c) => json(c.items_json, []).filter((i) => (i.recoveryMinor ?? 0) > 0 && i.code !== 'ADVANCES').map((i) => ({ department: c.department_name, item: i.label, amount: money(i.recoveryMinor) })));
    const pending = cl.filter((c) => c.clr_status === 'PENDING').map((c) => c.department_name);
    const blockers = [];
    if (pending.length) blockers.push(`Clearance pending: ${pending.join(', ')}`);
    if (s.last_working_day > today()) blockers.push(`The last working day (${s.last_working_day}) has not come yet`);
    if (s.status !== 'APPROVED') blockers.push(`The separation is ${SEP_STATUS[s.status].toLowerCase()}`);
    return {
      employeeId: s.employee_id, employee: e.full_name, code: e.emp_code, doj: e.doj, lastWorkingDay: s.last_working_day, noticeDays: s.notice_days, servedDays: served,
      notice: { shortDays: Math.max(0, s.notice_days - served), waiverDays: s.waiver_days, recoveryDays: s.buyout_days + (s.early_mode === 'NONE' && s.sep_type === 'RESIGNATION' ? Math.max(0, s.notice_days - served) : 0), payInLieuDays: s.notice_pay_days },
      leaveEncashmentDays: Math.round(leaveDays * 100) / 100, gratuity: { years: Math.round(yearsExact * 100) / 100, countedYears: gratuityYears, minYears, eligible: yearsExact >= minYears },
      reimbursements: { pendingClaims: claims.c, amount: money(claims.n) }, recoveries: { advances: money(advances), items: itemRecoveries, total: money(advances + itemRecoveries.reduce((x, i) => x + Math.round(i.amount * 100), 0)) },
      clearances: cl.map((c) => ({ department: c.department_name, status: c.clr_status })), canRelease: blockers.length === 0, blockers,
    };
  }
  const fnf = {
    inputs(actor, id) { const s = sepRow(actor, id); if (!(may(actor, 'hr.separation.fnf') || may(actor, 'hr.separation.view_all'))) throw forbidden('You may not see the full-and-final inputs (permission hr.separation.fnf).'); return s.fnf_json ? { ...json(s.fnf_json, {}), released: true, releasedAt: s.fnf_released_at, releasedBy: s.fnf_released_by } : { ...fnfInputs(actor, s), released: false }; },
    /** BR-01: released to payroll (24.05) only when every clearance is cleared or waived and the last working day has passed; the inputs are frozen as they were then. */
    release(actor, id) {
      need(actor, 'hr.separation.fnf', 'release the full-and-final inputs'); const s = sepRow(actor, id);
      if (s.status === 'SETTLED') throw conflict('The full-and-final inputs were released already.');
      const x = fnfInputs(actor, s);
      if (!x.canRelease) throw new HttpError(422, 'FNF_BLOCKED', `The full-and-final cannot be released yet: ${x.blockers.join('; ')}.`);
      return transaction(db, () => {
        db.prepare("UPDATE hr_separations SET status = 'SETTLED', fnf_json = ?, fnf_released_at = ?, fnf_released_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(x), nowIso(), actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_separations', entityId: id, action: 'fnf_release', newValues: { leaveEncashmentDays: x.leaveEncashmentDays, gratuityEligible: x.gratuity.eligible, recoveries: x.recoveries.total }, actor: actor.user, companyId: actor.companyId });
        event('hr.fnf.released', actor, 'hr_separation', id, s.company_id, x, s.project_id, s.site_id);
        return { ...x, released: true };
      });
    },
  };
  const letters = {
    async issue(actor, id, { kind }) {
      need(actor, 'hr.separation.letter', 'issue relieving and experience letters'); const s = sepRow(actor, id);
      if (s.last_working_day > today() || !['APPROVED', 'SETTLED'].includes(s.status)) throw unprocessable('The letters are issued after the last working day.');
      const col = kind === 'RELIEVING' ? 'relieving_doc_id' : 'experience_doc_id';
      if (s[col]) throw conflict('That letter was issued already.');
      const tpl = templateServiceOf(db); if (!tpl) throw unprocessable('The document templates are not running.');
      const e = emp(s.employee_id); const company = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(s.company_id)?.legal_name ?? '';
      const text = kind === 'RELIEVING'
        ? `${e.full_name} (employee code ${e.emp_code}), ${e.designation ?? 'employee'}, is relieved from the services of ${company} at the close of ${s.last_working_day}, ${s.sep_type === 'RESIGNATION' ? 'on the acceptance of the resignation' : 'on the termination of the employment'}.`
        : `This is to certify that ${e.full_name} (employee code ${e.emp_code}) worked with ${company} from ${e.doj} to ${s.last_working_day}${e.designation ? `, last as ${e.designation}` : ''}${e.department ? ` in the ${e.department} department` : ''}.`;
      const entityId = `SEP-${s.id}-${kind}`;
      tpl.records.publish(sys(actor.companyId), { docType: 'CERTIFICATE', entityId, docNo: `${s.doc_no}-${kind === 'RELIEVING' ? 'R' : 'E'}`, approved: true, data: { certificate: { title: kind === 'RELIEVING' ? 'Relieving letter' : 'Experience certificate', text }, recipient: { name: e.full_name }, issuedFor: kind === 'RELIEVING' ? 'Relieving' : 'Experience', issuedOn: today(), lines: [] }, reason: 'Exit letter' });
      const doc = await tpl.generate(actor, { docType: 'CERTIFICATE', entityId, reason: 'Exit letter' });
      db.prepare(`UPDATE hr_separations SET ${col} = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(doc.id, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_separations', entityId: id, action: `letter_${kind.toLowerCase()}`, newValues: { generatedDocId: doc.id }, actor: actor.user, companyId: actor.companyId });
      return separations.get(actor, id);
    },
    async content(actor, id, kind, { download = true } = {}) {
      const s = sepRow(actor, id); const docId = kind === 'RELIEVING' ? s.relieving_doc_id : s.experience_doc_id;
      if (!docId) throw unprocessable('That letter has not been issued yet.');
      if (!(myEmployee(actor) === s.employee_id || may(actor, 'hr.separation.letter'))) throw forbidden('You may not open this letter.');
      writeAudit(db, { entity: 'hr_separations', entityId: id, action: download ? 'download' : 'view', actor: actor.user, companyId: actor.companyId });
      return templateServiceOf(db).generated.content(sys(actor.companyId), docId, { download });
    },
  };

  // ------------------------------------------------------------------ grievances (FR-06)
  const slaDays = (companyId, category) => { const m = param(companyId, 'hr.grievance.sla_days') ?? {}; return Number(m[category] ?? m.DEFAULT ?? 7) || 7; };
  const officer = (actor) => may(actor, 'hr.grievance.manage');
  const grvRow = (actor, id) => {
    const g = db.prepare('SELECT * FROM hr_grievances WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!g || !(officer(actor) || same(g.assigned_to, actor.user) || (g.raised_by && same(g.raised_by, actor.user)))) throw notFound('That grievance does not exist.');
    return g;
  };
  function grvView(actor, g) {
    const mine = g.raised_by && same(g.raised_by, actor.user); const off = officer(actor) || same(g.assigned_to, actor.user);
    const who = !g.anonymous && g.complainant_id ? (g.complainant_type === 'EMPLOYEE' ? db.prepare('SELECT full_name AS n, emp_code AS c FROM hr_employees WHERE id = ?').get(g.complainant_id) : db.prepare('SELECT name AS n, worker_code AS c FROM lab_workers WHERE id = ?').get(g.complainant_id)) : null;
    return {
      id: g.id, docNo: g.doc_no, status: g.status, statusLabel: GRV_STATUS[g.status], rowVersion: g.version, category: g.category, categoryLabel: GRV_CATEGORIES[g.category], subject: g.subject, description: g.description, anonymous: Boolean(g.anonymous), complainantType: g.complainant_type,
      complainant: g.anonymous ? null : who ? `${who.n} (${who.c})` : null, raisedOn: g.doc_date, priority: g.priority, assignedTo: g.assigned_to, slaDue: g.sla_due, overdue: ['SUBMITTED', 'IN_REVIEW'].includes(g.status) && g.sla_due && g.sla_due < today(),
      notes: off ? json(g.notes_json, []) : json(g.notes_json, []).filter((n) => n.shared), resolution: g.resolution, resolvedBy: g.resolved_by, resolvedAt: g.resolved_at, reopenCount: g.reopen_count, mine: Boolean(mine),
      can: { edit: g.status === 'DRAFT' && mine, submit: g.status === 'DRAFT' && mine, delete: g.status === 'DRAFT' && mine, cancel: ['SUBMITTED', 'IN_REVIEW'].includes(g.status) && mine, assign: officer(actor) && ['SUBMITTED', 'IN_REVIEW'].includes(g.status), note: off && ['SUBMITTED', 'IN_REVIEW'].includes(g.status), resolve: off && ['SUBMITTED', 'IN_REVIEW'].includes(g.status), reject: officer(actor) && ['SUBMITTED', 'IN_REVIEW'].includes(g.status), accept: mine && g.status === 'RESOLVED', reopen: mine && g.status === 'RESOLVED', print: may(actor, 'hr.grievance.print') && off },
    };
  }
  const grvScope = (actor) => (officer(actor) ? 'g.company_id = :c AND (1 = 1 OR :u IS NULL)' : 'g.company_id = :c AND (lower(g.raised_by) = lower(:u) OR lower(g.assigned_to) = lower(:u))');
  const grvTell = (g, state, comment) => { if (g.raised_by) tell(g.company_id, g.raised_by, 'grv.update', { ref: g.doc_no, state, comment: comment ? `: ${comment}` : '' }, `/grievances/grievance?id=${g.id}`, `grv:${g.id}:${state}:${Date.now()}`); };
  const grvByCode = (actor, code) => { const g = code ? db.prepare('SELECT * FROM hr_grievances WHERE tracking_hash = ? AND company_id = ? AND deleted_at IS NULL').get(sha(`${actor.companyId}:${code}`), actor.companyId) : null; if (!g) throw notFound('No grievance has that tracking code.'); return g; };
  const grievances = {
    list(actor, query) { need(actor, 'hr.grievance.view', 'see grievances'); return runList(db, grievanceList, parseListRequest(grievanceList, query), { select: 'g.*', scopeSql: grvScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'g.id', map: (g) => grvView(actor, g) }); },
    exportSource(actor, req) {
      need(actor, 'hr.grievance.export', 'export grievances');
      const opts = { select: 'g.*', scopeSql: grvScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'g.id' };
      return { title: grievanceList.label, permission: 'hr.grievance.export', personal: true, columns: Object.entries(grievanceList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, grievanceList, req, opts), rows: () => runList(db, grievanceList, req, { ...opts, limit: null, map: (g) => { const v = grvView(actor, g); return { docNo: v.docNo, subject: v.subject, category: v.categoryLabel, anonymous: v.anonymous ? 'Anonymous' : 'Named', assignedTo: v.assignedTo, slaDue: v.slaDue, docDate: v.raisedOn, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${grievanceList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { return grvView(actor, grvRow(actor, id)); },
    /** A named grievance is kept as a draft or sent; an anonymous one is sent at once and keeps no identity: the person gets a tracking code, shown once. A worker's grievance is raised for them by somebody who sees the labour register. */
    create(actor, b) {
      need(actor, 'hr.grievance.create', 'raise grievances');
      let complainantId = null;
      if (b.complainantType === 'WORKER') {
        if (!may(actor, 'hr.worker.view')) throw forbidden('A worker\'s grievance is raised by somebody who sees the labour register.');
        if (!b.workerId || !db.prepare('SELECT 1 FROM lab_workers WHERE id = ? AND company_id = ?').get(b.workerId, actor.companyId)) throw badRequest('Some fields are not valid.', [{ field: 'workerId', message: 'Choose the worker' }]);
        complainantId = b.workerId;
      } else if (!b.anonymous) complainantId = meOf(actor).id;
      if (b.anonymous && !b.submit) throw badRequest('Some fields are not valid.', [{ field: 'anonymous', message: 'An anonymous grievance is sent at once: no draft keeps it' }]);
      const code = b.anonymous ? randomBytes(6).toString('hex').toUpperCase() : null;
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_GRIEVANCE', 'hr_grievances', 'GRV');
        const id = Number(db.prepare("INSERT INTO hr_grievances (company_id, doc_no, doc_date, complainant_type, complainant_id, anonymous, tracking_hash, raised_by, category, subject, description, priority, status, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'hr_grievance')")
          .run(actor.companyId, no, today(), b.complainantType, complainantId, b.anonymous ? 1 : 0, code ? sha(`${actor.companyId}:${code}`) : null, b.anonymous ? null : actor.user, b.category, b.subject, b.description, ['HARASSMENT', 'SAFETY'].includes(b.category) ? 'HIGH' : 'NORMAL', b.siteId ?? null, b.anonymous ? 'anonymous' : actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'create', newValues: { docNo: no, category: b.category, anonymous: Boolean(b.anonymous) }, actor: b.anonymous ? 'anonymous' : actor.user, companyId: actor.companyId });
        if (b.submit) submitGrv(actor, id, b.anonymous);
        const g = db.prepare('SELECT * FROM hr_grievances WHERE id = ?').get(id);
        return b.anonymous ? { id: null, docNo: g.doc_no, status: g.status, trackingCode: code, slaDue: g.sla_due } : grvView(actor, g);
      });
    },
    update(actor, id, b) {
      const g = grvRow(actor, id);
      if (g.status !== 'DRAFT' || !same(g.raised_by, actor.user)) throw conflict('Only your own draft is changed.');
      if (g.version !== b.version) throw conflict('This grievance was changed by someone else. Reload it and try again.');
      db.prepare('UPDATE hr_grievances SET category = ?, subject = ?, description = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.category, b.subject, b.description, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'update', actor: actor.user, companyId: actor.companyId });
      return grievances.get(actor, id);
    },
    remove(actor, id) {
      const g = grvRow(actor, id);
      if (g.status !== 'DRAFT' || !same(g.raised_by, actor.user)) throw new HttpError(409, 'LOCKED', 'Only your own draft is deleted.');
      db.prepare('UPDATE hr_grievances SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      return { id, deleted: true };
    },
    submit(actor, id) { const g = grvRow(actor, id); if (g.status !== 'DRAFT' || !same(g.raised_by, actor.user)) throw conflict('Only your own draft is sent.'); submitGrv(actor, id, false); return grievances.get(actor, id); },
    withdraw(actor, id, { reason }) { return grievances.cancel(actor, id, { reason }); },
    cancel(actor, id, { reason }) {
      const g = grvRow(actor, id);
      if (!same(g.raised_by, actor.user) || !['SUBMITTED', 'IN_REVIEW'].includes(g.status)) throw unprocessable('You withdraw your own grievance while it is open.');
      db.prepare("UPDATE hr_grievances SET status = 'CANCELLED', closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'withdraw', reason, actor: actor.user, companyId: actor.companyId });
      return grievances.get(actor, id);
    },
    assign(actor, id, { officer: to }) {
      if (!officer(actor)) throw forbidden('Grievance officers assign grievances (permission hr.grievance.manage).');
      const g = grvRow(actor, id); if (!['SUBMITTED', 'IN_REVIEW'].includes(g.status)) throw conflict('Only an open grievance is assigned.');
      const u = db.prepare('SELECT username FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, to); if (!u) throw badRequest('Some fields are not valid.', [{ field: 'officer', message: 'That user does not exist' }]);
      if (g.raised_by && same(g.raised_by, u.username)) throw forbidden('A grievance is not handled by the person who raised it.');
      db.prepare("UPDATE hr_grievances SET assigned_to = ?, status = 'IN_REVIEW', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(u.username, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'assign', newValues: { officer: u.username }, actor: actor.user, companyId: actor.companyId });
      tell(actor.companyId, u.username, 'grv.update', { ref: g.doc_no, state: 'assigned to you', comment: '' }, `/grievances/grievance?id=${id}`, `grv:${id}:assign:${u.username}`);
      grvTell(g, 'being looked into', null);
      return grievances.get(actor, id);
    },
    note(actor, id, { text, shared }) {
      const g = grvRow(actor, id); if (!(officer(actor) || same(g.assigned_to, actor.user))) throw forbidden('The officer of the grievance writes its notes.');
      if (!['SUBMITTED', 'IN_REVIEW'].includes(g.status)) throw conflict('The grievance is not open.');
      const notes = [...json(g.notes_json, []), { at: nowIso(), by: actor.user, text, shared: Boolean(shared) }];
      db.prepare("UPDATE hr_grievances SET notes_json = ?, status = 'IN_REVIEW', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(notes), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'note', actor: actor.user, companyId: actor.companyId });
      if (shared) grvTell(g, 'updated', text);
      return grievances.get(actor, id);
    },
    resolve(actor, id, { resolution }) {
      const g = grvRow(actor, id); if (!(officer(actor) || same(g.assigned_to, actor.user))) throw forbidden('The officer of the grievance resolves it.');
      if (!['SUBMITTED', 'IN_REVIEW'].includes(g.status)) throw conflict('The grievance is not open.');
      db.prepare("UPDATE hr_grievances SET status = 'RESOLVED', resolution = ?, resolved_by = ?, resolved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(resolution, actor.user, nowIso(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'resolve', reason: resolution, actor: actor.user, companyId: actor.companyId });
      event('hr.grievance.resolved', actor, 'hr_grievance', id, actor.companyId, { docNo: g.doc_no, category: g.category, onTime: !g.sla_due || today() <= g.sla_due }, null, g.site_id);
      grvTell(g, 'resolved', resolution);
      return grievances.get(actor, id);
    },
    reject(actor, id, { reason }) {
      if (!officer(actor)) throw forbidden('A grievance officer decides that it is not a grievance.');
      const g = grvRow(actor, id); if (!['SUBMITTED', 'IN_REVIEW'].includes(g.status)) throw conflict('The grievance is not open.');
      db.prepare("UPDATE hr_grievances SET status = 'REJECTED', resolution = ?, resolved_by = ?, resolved_at = ?, closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), nowIso(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'reject', reason, actor: actor.user, companyId: actor.companyId });
      grvTell(g, 'closed as not a grievance', reason);
      return grievances.get(actor, id);
    },
    /** The person who raised it accepts the resolution (closed) or reopens it with a reason; an anonymous one does it with the tracking code. */
    respond(actor, id, { accept, reason }, g0 = null) {
      const g = g0 ?? grvRow(actor, id);
      if (!g0 && !same(g.raised_by, actor.user)) throw forbidden('The person who raised the grievance accepts or reopens it.');
      if (g.status !== 'RESOLVED') throw conflict('Only a resolved grievance is accepted or reopened.');
      if (!accept && !(reason && reason.length >= 5)) throw badRequest('Some fields are not valid.', [{ field: 'reason', message: 'Say why it is not resolved (at least 5 characters)' }]);
      if (accept) db.prepare("UPDATE hr_grievances SET status = 'CLOSED', closed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), g.id);
      else db.prepare("UPDATE hr_grievances SET status = 'IN_REVIEW', reopen_count = reopen_count + 1, sla_due = ?, notes_json = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(addDays(today(), slaDays(g.company_id, g.category)), JSON.stringify([...json(g.notes_json, []), { at: nowIso(), by: g.anonymous ? 'complainant' : actor.user, text: `Reopened: ${reason}`, shared: true }]), nowIso(), g.id);
      writeAudit(db, { entity: 'hr_grievances', entityId: g.id, action: accept ? 'close' : 'reopen', reason: reason ?? null, actor: g.anonymous ? 'anonymous' : actor.user, companyId: g.company_id });
      if (!accept && g.assigned_to) tell(g.company_id, g.assigned_to, 'grv.update', { ref: g.doc_no, state: 'reopened', comment: `: ${reason}` }, `/grievances/grievance?id=${g.id}`, `grv:${g.id}:reopen:${g.reopen_count}`);
      return { docNo: g.doc_no, status: accept ? 'CLOSED' : 'IN_REVIEW' };
    },
    track(actor, { code }) { need(actor, 'hr.grievance.create', 'track grievances'); const g = grvByCode(actor, code); return { docNo: g.doc_no, status: g.status, statusLabel: GRV_STATUS[g.status], category: GRV_CATEGORIES[g.category], subject: g.subject, raisedOn: g.doc_date, slaDue: g.sla_due, notes: json(g.notes_json, []).filter((n) => n.shared).map((n) => ({ at: n.at, text: n.text })), resolution: g.resolution, can: { accept: g.status === 'RESOLVED', reopen: g.status === 'RESOLVED' } }; },
    trackRespond(actor, { code, accept, reason }) { need(actor, 'hr.grievance.create', 'answer grievances'); const g = grvByCode(actor, code); return grievances.respond(actor, g.id, { accept, reason }, g); },
    history(actor, id) { const g = grvRow(actor, id); return { approvals: [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'hr_grievances' AND entity_id = ? ORDER BY id").all(String(g.id)).map((x) => ({ action: x.action, by: x.actor, reason: x.reason, at: x.at })) }; },
    print(actor, id) { need(actor, 'hr.grievance.print', 'print grievances'); const v = grvView(actor, grvRow(actor, id)); writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId }); return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}</style></head><body><h1>Grievance ${esc(v.docNo)}</h1><p>${esc(v.categoryLabel)} · ${esc(v.statusLabel)} · raised ${esc(v.raisedOn)} · resolve by ${esc(v.slaDue ?? '')}</p><p>${v.anonymous ? 'Anonymous' : esc(v.complainant ?? '')}</p><h2>${esc(v.subject)}</h2><p>${esc(v.description)}</p><h2>Resolution</h2><p>${esc(v.resolution ?? '')}</p></body></html>`; },
  };
  function submitGrv(actor, id, anonymous) {
    const g = db.prepare('SELECT * FROM hr_grievances WHERE id = ?').get(id);
    const due = addDays(today(), slaDays(g.company_id, g.category));
    db.prepare("UPDATE hr_grievances SET status = 'SUBMITTED', sla_due = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(due, nowIso(), id);
    writeAudit(db, { entity: 'hr_grievances', entityId: id, action: 'submit', actor: anonymous ? 'anonymous' : actor.user, companyId: g.company_id });
    event('hr.grievance.raised', anonymous ? { user: 'anonymous' } : actor, 'hr_grievance', id, g.company_id, { docNo: g.doc_no, category: g.category, anonymous: Boolean(anonymous), slaDue: due }, null, g.site_id);
    for (const u of holders(g.company_id, ['HRMGR'])) tell(g.company_id, u, 'grv.update', { ref: g.doc_no, state: 'received', comment: `: ${GRV_CATEGORIES[g.category]}` }, `/grievances/grievance?id=${id}`, `grv:${id}:new:${u}`);
  }

  // ------------------------------------------------------------------ disciplinary cases (FR-07): restricted
  const caseRow = (actor, id) => { const c = db.prepare('SELECT * FROM hr_disciplinary_cases WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!c || !(may(actor, 'hr.disciplinary.view') || myEmployee(actor) === c.employee_id)) throw notFound('That case does not exist.'); return c; };
  function caseView(actor, c) {
    const e = emp(c.employee_id); const full = may(actor, 'hr.disciplinary.view'); const actions = json(c.actions_json, []);
    return {
      id: c.id, docNo: c.doc_no, status: c.case_status, statusLabel: CASE_STATUS[c.case_status], rowVersion: c.version, employeeId: c.employee_id, employee: e.full_name, employeeCode: e.emp_code, incidentDate: c.incident_date, category: c.category, severity: c.severity,
      incident: full ? c.incident : null, documents: full ? json(c.documents_json, []) : [], responseDue: c.response_due, finalAction: c.final_action,
      actions: actions.filter((a) => full || ['SHOW_CAUSE', 'RESPONSE', 'ACTION', 'CLOSED'].includes(a.stage)).map((a) => ({ ...a, text: full || a.stage !== 'INQUIRY' ? a.text : null })),
      can: { manage: may(actor, 'hr.disciplinary.manage') && !['CLOSED', 'DROPPED'].includes(c.case_status) && myEmployee(actor) !== c.employee_id, respond: myEmployee(actor) === c.employee_id && c.case_status === 'SHOW_CAUSE' },
    };
  }
  const cases = {
    list(actor) {
      if (!may(actor, 'hr.disciplinary.view')) { const me = myEmployee(actor); return me ? db.prepare('SELECT * FROM hr_disciplinary_cases WHERE company_id = ? AND employee_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(actor.companyId, me).map((c) => caseView(actor, c)) : []; }
      writeAudit(db, { entity: 'hr_disciplinary_cases', entityId: 'list', action: 'view', actor: actor.user, companyId: actor.companyId });
      return db.prepare('SELECT * FROM hr_disciplinary_cases WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 500').all(actor.companyId).map((c) => caseView(actor, c));
    },
    get(actor, id) { const c = caseRow(actor, id); writeAudit(db, { entity: 'hr_disciplinary_cases', entityId: id, action: 'view', actor: actor.user, companyId: actor.companyId }); return caseView(actor, c); },
    create(actor, b) {
      need(actor, 'hr.disciplinary.manage', 'open disciplinary cases');
      const e = emp(b.employeeId); if (!e || e.company_id !== actor.companyId) throw notFound('That employee does not exist.');
      if (myEmployee(actor) === e.id) throw forbidden('Nobody opens a case against themselves.');
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_DISCIPLINARY', 'hr_disciplinary_cases', 'DSC');
        const id = Number(db.prepare("INSERT INTO hr_disciplinary_cases (company_id, doc_no, doc_date, employee_id, incident_date, category, severity, incident, documents_json, actions_json, case_status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, 'hr_disciplinary')")
          .run(actor.companyId, no, today(), e.id, b.incidentDate, b.category, b.severity, b.incident, JSON.stringify(b.documents ?? []), JSON.stringify([{ stage: 'OPENED', at: nowIso(), by: actor.user, text: 'Case opened' }]), actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'hr_disciplinary_cases', entityId: id, action: 'create', newValues: { docNo: no, employee: e.emp_code, severity: b.severity }, actor: actor.user, companyId: actor.companyId });
        return caseView(actor, db.prepare('SELECT * FROM hr_disciplinary_cases WHERE id = ?').get(id));
      });
    },
    /** The stages: show-cause (with the day to answer by), inquiry (notes), action (warning, suspension, termination recommended, none), close, drop. Each is a line of the timeline with who and when. */
    step(actor, id, b) {
      need(actor, 'hr.disciplinary.manage', 'manage disciplinary cases'); const c = caseRow(actor, id);
      if (['CLOSED', 'DROPPED'].includes(c.case_status)) throw conflict('This case is closed.');
      if (myEmployee(actor) === c.employee_id) throw forbidden('A case is handled by somebody else than the person it concerns.');
      if (c.version !== b.version) throw conflict('This case was changed by someone else. Reload it and try again.');
      const next = { SHOW_CAUSE: 'SHOW_CAUSE', INQUIRY: 'INQUIRY', ACTION: 'ACTION_TAKEN', CLOSE: 'CLOSED', DROP: 'DROPPED' }[b.stage];
      if (b.stage === 'SHOW_CAUSE' && !b.dueDate) throw badRequest('Some fields are not valid.', [{ field: 'dueDate', message: 'Give the day to answer by' }]);
      if (b.stage === 'ACTION' && !b.action) throw badRequest('Some fields are not valid.', [{ field: 'action', message: 'Choose the action' }]);
      if (b.stage === 'CLOSE' && c.case_status !== 'ACTION_TAKEN') throw unprocessable('A case is closed after the action is recorded; drop it otherwise.');
      const actions = [...json(c.actions_json, []), { stage: b.stage === 'ACTION' ? 'ACTION' : b.stage === 'CLOSE' ? 'CLOSED' : b.stage, at: nowIso(), by: actor.user, text: b.text, outcome: b.action ?? null, dueDate: b.dueDate ?? null }];
      db.prepare('UPDATE hr_disciplinary_cases SET case_status = ?, actions_json = ?, response_due = COALESCE(?, response_due), final_action = COALESCE(?, final_action), documents_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next, JSON.stringify(actions), b.dueDate ?? null, b.action ?? null, JSON.stringify([...json(c.documents_json, []), ...(b.documents ?? [])]), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_disciplinary_cases', entityId: id, action: b.stage.toLowerCase(), newValues: { status: next, action: b.action ?? null }, actor: actor.user, companyId: actor.companyId });
      if (b.stage === 'SHOW_CAUSE') { const e = emp(c.employee_id); tell(c.company_id, e.username, 'grv.update', { ref: c.doc_no, state: 'a show-cause notice was issued to you', comment: `: answer by ${b.dueDate}` }, '/disciplinary/mine', `dsc:${id}:sc`); }
      if (b.stage === 'ACTION') event('hr.disciplinary.action_taken', actor, 'hr_disciplinary_case', id, c.company_id, { employeeId: c.employee_id, action: b.action }, null, null);
      return caseView(actor, db.prepare('SELECT * FROM hr_disciplinary_cases WHERE id = ?').get(id));
    },
    respond(actor, id, { text }) {
      const c = caseRow(actor, id);
      if (myEmployee(actor) !== c.employee_id) throw forbidden('The person the case concerns answers the show-cause.');
      if (c.case_status !== 'SHOW_CAUSE') throw conflict('There is no show-cause to answer.');
      const actions = [...json(c.actions_json, []), { stage: 'RESPONSE', at: nowIso(), by: actor.user, text, late: c.response_due && today() > c.response_due }];
      db.prepare("UPDATE hr_disciplinary_cases SET case_status = 'RESPONDED', actions_json = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(actions), nowIso(), id);
      writeAudit(db, { entity: 'hr_disciplinary_cases', entityId: id, action: 'respond', actor: actor.user, companyId: actor.companyId });
      for (const u of holders(c.company_id, ['HRMGR'])) tell(c.company_id, u, 'grv.update', { ref: c.doc_no, state: 'answered by the employee', comment: '' }, '/disciplinary', `dsc:${id}:resp:${u}`);
      return caseView(actor, db.prepare('SELECT * FROM hr_disciplinary_cases WHERE id = ?').get(id));
    },
  };

  // ------------------------------------------------------------------ the daily watch, the widget, the decision
  function cycle(companyId) {
    const out = { overdue: 0, autoClosed: 0 };
    for (const g of db.prepare("SELECT * FROM hr_grievances WHERE company_id = ? AND status IN ('SUBMITTED', 'IN_REVIEW') AND sla_due < ? AND overdue_alerted = 0 AND deleted_at IS NULL").all(companyId, today())) {
      for (const u of new Set([...holders(companyId, ['HRMGR']), ...(g.assigned_to ? [g.assigned_to] : [])])) tell(companyId, u, 'grv.update', { ref: g.doc_no, state: 'past its SLA', comment: `: due ${g.sla_due}` }, `/grievances/grievance?id=${g.id}`, `grv:${g.id}:overdue:${u}`);
      db.prepare('UPDATE hr_grievances SET overdue_alerted = 1 WHERE id = ?').run(g.id); out.overdue += 1;
    }
    out.autoClosed = db.prepare("UPDATE hr_grievances SET status = 'CLOSED', closed_at = ?, notes_json = json_insert(notes_json, '$[#]', json_object('at', ?, 'by', 'system', 'text', 'Closed: no answer within 15 days of the resolution', 'shared', 1)) WHERE company_id = ? AND status = 'RESOLVED' AND resolved_at < ? AND deleted_at IS NULL").run(nowIso(), nowIso(), companyId, new Date(Date.now() - 15 * 86_400_000).toISOString()).changes;
    return out;
  }
  const widget = (actor) => (may(actor, 'hr.grievance.manage') ? { value: db.prepare("SELECT COUNT(*) AS n FROM hr_grievances WHERE company_id = ? AND status IN ('SUBMITTED', 'IN_REVIEW') AND sla_due < ? AND deleted_at IS NULL").get(actor.companyId, today()).n } : { value: 0 });
  function decide(instance, actor, outcome, comment) {
    const s = db.prepare('SELECT * FROM hr_separations WHERE id = ?').get(Number(instance.docId));
    if (!s || !['SUBMITTED', 'RETURNED'].includes(s.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      const ex = employeesOf(db).exits; const a = sys(s.company_id);
      const noticeId = s.last_working_day > today() ? ex.schedule(a, s.employee_id, { status: 'NOTICE', lastWorkingDate: s.last_working_day, effectiveDate: today(), reason: `${REASONS[s.reason_code]} (${s.doc_no})`, sourceId: s.id }) : null;
      const exitId = ex.schedule(a, s.employee_id, { status: 'SEPARATED', lastWorkingDate: s.last_working_day, effectiveDate: s.last_working_day, reason: `${REASONS[s.reason_code]} (${s.doc_no})`, sourceId: s.id });
      db.prepare("UPDATE hr_separations SET status = 'APPROVED', approved_at = ?, notice_change_id = ?, exit_change_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, noticeId, exitId, actor.user, now, s.id);
      openClearances(actor, db.prepare('SELECT * FROM hr_separations WHERE id = ?').get(s.id));
      event('hr.separation.approved', actor, 'hr_separation', s.id, s.company_id, { docNo: s.doc_no, employeeId: s.employee_id, type: s.sep_type, lastWorkingDay: s.last_working_day }, s.project_id, s.site_id);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE hr_separations SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, s.id);
      if (withdrawn) db.prepare('UPDATE hr_separations SET workflow_instance_id = NULL WHERE id = ?').run(s.id);
    }
    writeAudit(db, { entity: 'hr_separations', entityId: s.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: s.company_id });
    const e = emp(s.employee_id);
    tell(s.company_id, s.requested_by ?? s.created_by, 'sep.decided', { what: s.sep_type === 'RESIGNATION' ? 'Resignation' : 'Termination', ref: s.doc_no, title: e.full_name, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? `accepted, last working day ${s.last_working_day}` : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment: comment ? `: ${comment}` : '' }, `/exit/separation?id=${s.id}`, `sep:${s.id}:${outcome}`);
    if (s.sep_type === 'TERMINATION' && outcome === 'APPROVED') tell(s.company_id, e.username, 'sep.decided', { what: 'Separation', ref: s.doc_no, title: e.full_name, decision: `decided, last working day ${s.last_working_day}`, comment: '' }, '/exit/resign', `sep:${s.id}:emp`);
  }
  return { separations, clearances, interviews, fnf, letters, grievances, cases, cycle, widget, decisions: { separation: decide } };
}

const services = new WeakMap();
export const bindExit = (db, s) => services.set(db, s);
export const exitOf = (db) => services.get(db) ?? null;

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
if (!workflowResolvers.get('sep.manager')) workflowResolvers.register('sep.manager', ({ db, instance }) => {
  const r = db.prepare('SELECT employee_id FROM hr_separations WHERE id = ?').get(Number(instance.docId));
  const m = r && db.prepare('SELECT m.user_id FROM hr_employees e JOIN hr_employees m ON m.id = e.manager_id WHERE e.id = ?').get(r.employee_id);
  const u = m?.user_id ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(m.user_id)?.username : null;
  return u && !same(u, instance.submittedBy) ? [{ user: u }] : [{ role: 'HRMGR' }];
});
workflowTypes.register({
  docType: SEP_DOC, label: 'Resignation or termination', processOwner: 'HRMGR', route: (id) => `/exit/separation?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.sep_type, x.requested_by, e.full_name FROM hr_separations x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.sep_type === 'RESIGNATION' ? 'Resignation' : 'Termination'}: ${r.full_name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, e.emp_code, e.doj FROM hr_separations x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Separation', value: r.doc_no }, { label: 'Employee', value: `${r.full_name} (${r.emp_code})` }, { label: 'Kind', value: r.sep_type === 'RESIGNATION' ? 'Resignation' : 'Termination' }, { label: 'Reason', value: REASONS[r.reason_code] ?? r.reason_code }, { label: 'Submitted', value: r.submitted_on }, { label: 'Notice', value: `${r.notice_days} days, ends ${r.standard_lwd}` }, { label: 'Last working day', value: r.last_working_day }, { label: 'Waiver / buyout', value: `${r.waiver_days} / ${r.buyout_days} days` }] }; },
  defaultDefinition: { name: 'Separation: manager and HR manager for a resignation or a notice waiver; HR manager and director for a termination', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('MANAGER', 'Reporting manager', [{ kind: 'resolver', resolver: 'sep.manager' }], { field: 'type', op: 'eq', value: 'RESIGNATION' }), step('HRMGR', 'HR manager', [{ kind: 'role', role: 'HRMGR' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }], { field: 'type', op: 'eq', value: 'TERMINATION' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => exitOf(db)?.decisions.separation(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => exitOf(db)?.decisions.separation(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => exitOf(db)?.decisions.separation(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => exitOf(db)?.decisions.separation(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(SEP_DOC, ({ db, instance }) => {
  const s = db.prepare('SELECT x.*, e.doj, e.full_name FROM hr_separations x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ?').get(Number(instance.docId)); if (!s) return { sections: [] };
  const years = Math.round((Date.parse(s.last_working_day) - Date.parse(s.doj)) / (365.25 * 86_400_000) * 10) / 10;
  const cases = db.prepare("SELECT COUNT(*) AS n FROM hr_disciplinary_cases WHERE employee_id = ? AND case_status NOT IN ('DROPPED') AND deleted_at IS NULL").get(s.employee_id).n;
  return { sections: [{ code: 'hr-separation', title: 'Before approving', kind: 'metrics', items: [{ label: 'Service', value: `${years} years since ${s.doj}`, format: 'text' }, { label: 'Days short of the notice', value: String(Math.max(0, Math.round((Date.parse(s.standard_lwd) - Date.parse(s.last_working_day)) / 86_400_000))), format: 'text' }, { label: 'Treated as', value: s.early_mode === 'WAIVER' ? 'Waiver by the company (no recovery)' : s.early_mode === 'BUYOUT' ? 'Buyout by the employee (recovered)' : 'Full notice', format: 'text', tone: s.early_mode === 'WAIVER' ? 'warn' : undefined }, { label: 'Disciplinary cases on record', value: String(cases), format: 'text' }] }] };
});
fileEntities.register({
  entity: 'hr_disciplinary', label: 'Disciplinary case documents (restricted)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id FROM hr_disciplinary_cases WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const ok = a.check(actor, 'hr.disciplinary.manage').allowed;
    return { companyId: r.company_id, projectId: null, siteId: null, canView: ok || a.check(actor, 'hr.disciplinary.view').allowed, canEdit: ok, locked: false };
  },
});
