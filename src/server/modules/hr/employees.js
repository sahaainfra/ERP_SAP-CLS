import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createVault } from '../../platform/integrations/vault.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { FORMATS, mask, nameKey, similarity } from '../../platform/mdm/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { fromUnits, toUnits } from '../../../shared/money.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { commonOf } from '../mdm/common.js';
import { userAdminOf } from '../iam/usermgmt/service.js';
import { parseCreate as parseUserCreate } from '../iam/usermgmt/validators.js';

// The employee master (part 07.01): one record per person employed by a company, at the head office or on a site. A new employee is saved as a Draft (employee code from the numbering service, or the next free
// EMP-nnnnn when no series is set up) and sent for approval (HR_EMPLOYEE: the HR manager, never the person who entered it). Statutory identifiers (PAN encrypted with a hash for duplicates, Aadhaar only as its
// last four digits, UAN, ESIC) and the bank account (encrypted, last four digits, IFSC, verification by payroll) are restricted to HR, payroll and the employee (BR-01) and masked everywhere else, in the API,
// exports and search. After approval the record is locked: personal data, statutory, bank, employment and status changes are requests (hr_employee_changes) approved through the workflow engine and applied on
// their effective date (BR-02): promotions, transfers and designation changes write the employment history; a separation or absconding deactivates the person's user account on the effective date through
// user management (02.03). Education, experience, skills, languages, documents and the photo are kept by HR without approval, audited.
export const EMP_DOC = 'HR_EMPLOYEE';
export const CHANGE_DOCS = { PROFILE: 'HR_EMP_PROFILE', STATUTORY: 'HR_EMP_STATUTORY', BANK: 'HR_EMP_BANK', EMPLOYMENT: 'HR_EMP_EMPLOYMENT', SEPARATION: 'HR_EMP_SEPARATION' };
export const STATUS_LABELS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const EMPLOYMENT_LABELS = { ACTIVE: 'Active', NOTICE: 'On notice', SEPARATED: 'Separated', ABSCONDING: 'Absconding' };
export const TYPE_LABELS = { PERMANENT: 'Permanent', CONTRACT: 'Contract', TRAINEE: 'Trainee', CONSULTANT: 'Consultant' };
export const DOC_LABELS = { ID_PROOF: 'ID proof', ADDRESS_PROOF: 'Address proof', OFFER_LETTER: 'Offer letter', APPOINTMENT_LETTER: 'Appointment letter', CERTIFICATE: 'Certificate', DRIVING_LICENCE: 'Driving licence', MEDICAL: 'Medical fitness', OTHER: 'Other' };
export const CHANGE_LABELS = { PROFILE: 'Personal details', STATUTORY: 'Statutory details', BANK: 'Bank account', EMPLOYMENT: 'Employment details', SEPARATION: 'Employment status' };
const nowIso = () => new Date().toISOString();
const dayPlus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const trimNum = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const yearsBetween = (a, b) => { const d = new Date(`${a}T00:00:00Z`); const e = new Date(`${b}T00:00:00Z`); let y = e.getUTCFullYear() - d.getUTCFullYear(); if (e.getUTCMonth() < d.getUTCMonth() || (e.getUTCMonth() === d.getUTCMonth() && e.getUTCDate() < d.getUTCDate())) y -= 1; return y; };
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

for (const [key, dataType, def, description, extra] of [
  ['hr.employee.expiry_warning_days', 'integer', 30, 'How many days before a document of an employee expires (driving licence, medical fitness, ID) HR is told.', { min: 1, max: 180 }],
  ['hr.employee.senior_level', 'integer', 8, 'FR-02: the level of a designation (1 to 20, from the organisation master) from which a change of designation, grade or manager also needs the director.', { min: 1, max: 20 }],
  ['hr.employee.min_age', 'integer', 18, 'The youngest age, in years on the date of joining, at which a person is employed.', { min: 14, max: 25 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/** Other parts tell the Employee 360 what they hold for a person (attendance 07.06, leave 07.07, assets, training): register({ code, label, summary(db, companyId, employee) -> [{ label, value, route }] }). */
const related = new Map();
export const employeeRelated = { register(def) { related.set(def.code, def); }, list: () => [...related.values()] };

/** The Employee Directory (List Report, 03.03): contact details hidden from people outside the reporting line, PAN masked unless the viewer may see it. */
const FROM = 'hr_employees e LEFT JOIN org_departments d ON d.id = e.department_id LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN org_branches b ON b.id = e.branch_id LEFT JOIN hr_employees m ON m.id = e.manager_id LEFT JOIN org_sites s ON s.id = e.site_id LEFT JOIN hr_employee_statutory st ON st.employee_id = e.id AND st.deleted_at IS NULL';
export const employeeList = defineList({
  code: 'hr.employees', label: 'Employees', permission: 'hr.employee.team.view',
  from: FROM, where: 'e.deleted_at IS NULL', searchable: ['e.emp_code', 'e.full_name', 'e.mobile', 'e.email'], defaultSort: 'code',
  columns: {
    code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, name: { sql: 'e.full_name', type: 'text', label: 'Name' },
    department: { sql: 'd.name', type: 'text', label: 'Department' }, departmentId: { sql: 'e.department_id', type: 'id', label: 'Department id' },
    designation: { sql: 'g.name', type: 'text', label: 'Designation' }, designationId: { sql: 'e.designation_id', type: 'id', label: 'Designation id' },
    branch: { sql: 'b.name', type: 'text', label: 'Branch' }, branchId: { sql: 'e.branch_id', type: 'id', label: 'Branch id' },
    grade: { sql: 'e.grade', type: 'text', label: 'Grade' },
    employmentType: { sql: 'e.employment_type', type: 'enum', label: 'Type', options: Object.entries(TYPE_LABELS) },
    locationType: { sql: 'e.location_type', type: 'enum', label: 'Work location', options: [['HO', 'Head office'], ['SITE', 'Site']] },
    site: { sql: 's.name', type: 'text', label: 'Site' }, siteId: { sql: 'e.site_id', type: 'id', label: 'Site id' },
    status: { sql: 'e.employment_status', type: 'enum', label: 'Status', options: Object.entries(EMPLOYMENT_LABELS) },
    recordStatus: { sql: 'e.record_status', type: 'enum', label: 'Record', options: Object.entries(STATUS_LABELS) },
    doj: { sql: 'e.doj', type: 'date', label: 'Date of joining' }, lastWorkingDate: { sql: 'e.last_working_date', type: 'date', label: 'Last working day' },
    manager: { sql: 'm.full_name', type: 'text', label: 'Reports to' }, managerId: { sql: 'e.manager_id', type: 'id', label: 'Manager id' },
    mobile: { sql: 'e.mobile', type: 'text', label: 'Mobile', sensitive: true }, email: { sql: 'e.email', type: 'text', label: 'E-mail', sensitive: true },
    pan: { sql: 'st.pan_last4', type: 'text', label: 'PAN', sensitive: true, sortable: false, filterable: false },
    hasUser: { sql: "CASE WHEN e.user_id IS NULL THEN 'NO' ELSE 'YES' END", type: 'enum', label: 'Has a user account', options: [['YES', 'Yes'], ['NO', 'No']] },
    updatedAt: { sql: 'COALESCE(e.updated_at, e.created_at)', type: 'datetime', label: 'Changed' },
  },
});

export function createEmployeeService({ db, vaultKey }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const vault = createVault({ secret: vaultKey ?? undefined });
  const param = (key, companyId) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const slot = (companyId, kind, id) => `hr_employee_${kind}/${companyId}/${id}`;
  const hash = (companyId, kind, v) => createHash('sha256').update(`${companyId}:${kind}:${v}`).digest('hex');
  const myUserId = (actor) => actor.userId ?? db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, actor.user)?.id ?? null;
  const myEmployee = (actor) => { const u = myUserId(actor); return u ? db.prepare("SELECT * FROM hr_employees WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED'").get(actor.companyId, u) ?? null : null; };
  const isSelf = (actor, e) => e.user_id != null && e.user_id === myUserId(actor);
  const seesSensitive = (actor, e = null) => may(actor, 'hr.employee.sensitive.view') || (e != null && isSelf(actor, e));
  const REPORTS = 'WITH RECURSIVE r(id) AS (SELECT id FROM hr_employees WHERE manager_id = ? AND deleted_at IS NULL UNION SELECT h.id FROM hr_employees h JOIN r ON h.manager_id = r.id WHERE h.deleted_at IS NULL) SELECT id FROM r';
  const reportsOf = (empId) => new Set(db.prepare(REPORTS).all(empId).map((r) => r.id));
  const inLine = (actor, e) => { const me = myEmployee(actor); return Boolean(me && (me.id === e.id || reportsOf(me.id).has(e.id))); };
  const orgName = (table, id) => (id ? db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id)?.name ?? null : null);
  // the states and banks are shared reference data: read with the system, so a person without the right to browse the common masters (an employee asking for a change) is still checked against them
  const reader = (actor) => ({ user: 'system', userId: null, companyId: actor.companyId, roles: ['SYSADM'] });
  const stateRow = (actor, code) => (code ? commonOf(db)?.list(reader(actor), 'states', { key: code, limit: 1, offset: 0 }).rows[0] ?? null : null);

  /** How much of a person the viewer may see: full (HR, payroll, director, auditor), the person themself, or team (reporting line and deployed staff: basic data). */
  function access(actor, e) {
    if (e.company_id !== actor.companyId) return null;
    if (may(actor, 'hr.employee.view')) return 'full';
    if (isSelf(actor, e)) return 'self';
    if (e.record_status !== 'APPROVED' || !may(actor, 'hr.employee.team.view')) return null;
    if (inLine(actor, e)) return 'team';
    const f = authz.scopeFilter(actor, 'hr.employee.team.view', { project: 'x.project_id', site: 'x.site_id', branch: 'x.branch_id', department: 'x.department_id' });
    if (!f.unrestricted && f.sql !== '1 = 0' && db.prepare(`SELECT 1 FROM hr_employees x WHERE x.id = ? AND ${f.sql}`).get(e.id)) return 'team';
    return null;
  }
  const row = (actor, id) => {
    const e = db.prepare('SELECT * FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!e || !access(actor, e)) throw notFound('That employee does not exist.');
    return e;
  };
  const maker = (actor, e) => e.requested_by?.toLowerCase() === actor.user.toLowerCase() || e.created_by?.toLowerCase() === actor.user.toLowerCase();

  // ---- the employee code ----
  function nextCode(actor) {
    try {
      return issueNumber(db, { companyId: actor.companyId, docType: 'HR_EMPLOYEE', actor: actor.user, refType: 'hr_employee' }).number;
    } catch (e) {
      if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(e?.code)) throw e;
    }
    const n = db.prepare('SELECT COUNT(*) AS n FROM hr_employees WHERE company_id = ?').get(actor.companyId).n + 1;
    let code = `EMP-${String(n).padStart(5, '0')}`;
    for (let k = n + 1; db.prepare('SELECT 1 FROM hr_employees WHERE company_id = ? AND emp_code = ?').get(actor.companyId, code); k += 1) code = `EMP-${String(k).padStart(5, '0')}`;
    return code;
  }

  // ---- checking what is entered (FR-01 to FR-05, FR-09) ----
  function checkLinks(actor, b, problems, current = null) {
    const own = (table, id, field, what, extra = '') => { if (id != null && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND company_id = ? AND is_active = 1 ${extra}`).get(id, actor.companyId)) problems.push({ field, message: `${what} does not exist in your company` }); };
    own('org_branches', b.branchId, 'branchId', 'That branch', "AND status = 'ACTIVE'");
    own('org_departments', b.departmentId, 'departmentId', 'That department', "AND status = 'ACTIVE'");
    own('org_designations', b.designationId, 'designationId', 'That designation', "AND status = 'ACTIVE'");
    own('org_cost_centres', b.costCentreId, 'costCentreId', 'That cost centre', "AND status = 'ACTIVE'");
    own('org_projects', b.projectId, 'projectId', 'That project');
    own('org_sites', b.siteId, 'siteId', 'That site');
    if (b.managerId != null) {
      const m = db.prepare("SELECT id, employment_status FROM hr_employees WHERE id = ? AND company_id = ? AND record_status = 'APPROVED' AND deleted_at IS NULL").get(b.managerId, actor.companyId);
      if (!m) problems.push({ field: 'managerId', message: 'The manager must be an approved employee of your company' });
      else if (['SEPARATED', 'ABSCONDING'].includes(m.employment_status)) problems.push({ field: 'managerId', message: 'That person has left the company' });
      else if (current && (m.id === current.id || reportsOf(current.id).has(m.id))) problems.push({ field: 'managerId', message: 'A person cannot report to themself or to someone who reports to them' });
    }
    if (b.locationType === 'SITE' && !b.siteId && !b.projectId) problems.push({ field: 'siteId', message: 'Choose the site (or the project) the person works at' });
  }
  function checkCore(actor, b, problems, current = null) {
    if (!validDate(b.dob)) problems.push({ field: 'dob', message: 'Enter the date of birth, for example 1990-05-17' });
    if (!validDate(b.doj)) problems.push({ field: 'doj', message: 'Enter the date of joining, for example 2026-12-01' });
    if (validDate(b.dob) && validDate(b.doj)) {
      const min = param('hr.employee.min_age', actor.companyId) ?? 18;
      if (b.dob >= todayIST()) problems.push({ field: 'dob', message: 'The date of birth is in the past' });
      else if (yearsBetween(b.dob, b.doj) < min) problems.push({ field: 'dob', message: `A person is at least ${min} years old on the date of joining` });
      if (yearsBetween(b.dob, todayIST()) > 80) problems.push({ field: 'dob', message: 'Check the date of birth: the person would be over 80' });
    }
    if (b.confirmationDate && validDate(b.doj) && b.confirmationDate < b.doj) problems.push({ field: 'confirmationDate', message: 'Confirmation is on or after the date of joining' });
    if (!FORMATS.MOBILE.test(b.mobile ?? '')) problems.push({ field: 'mobile', message: `Mobile is not valid (${FORMATS.MOBILE.hint})` });
    if (b.email && !FORMATS.EMAIL.test(b.email)) problems.push({ field: 'email', message: 'E-mail is not valid' });
    for (const k of ['permanentAddress', 'currentAddress']) {
      const a = b[k];
      if (!a) continue;
      if (a.pin && !FORMATS.PIN.test(a.pin)) problems.push({ field: `${k}.pin`, message: 'A PIN code has six digits' });
      if (a.stateCode && !stateRow(actor, a.stateCode)) problems.push({ field: `${k}.stateCode`, message: `${a.stateCode} is not a state` });
    }
    checkLinks(actor, b, problems, current);
  }
  function checkStatutory(actor, s, problems, field = 'statutory') {
    if (!s) return;
    if (s.pan) {
      if (!FORMATS.PAN.test(s.pan)) problems.push({ field: `${field}.pan`, message: `PAN is not valid (${FORMATS.PAN.hint})` });
      else if (s.pan[3] !== 'P') problems.push({ field: `${field}.pan`, message: `The fourth character of an individual's PAN is P, not ${s.pan[3]}` });
    }
    for (const k of ['ptState', 'lwfState']) if (s[k] && !stateRow(actor, s[k])) problems.push({ field: `${field}.${k}`, message: `${s[k]} is not a state` });
  }
  function checkBank(actor, bk, problems, field = 'bank') {
    if (!bk) return { bankName: null, branch: null };
    if (!FORMATS.BANK_ACCOUNT.test(bk.accountNo)) problems.push({ field: `${field}.accountNo`, message: `An account number has ${FORMATS.BANK_ACCOUNT.hint}` });
    if (!FORMATS.IFSC.test(bk.ifsc)) problems.push({ field: `${field}.ifsc`, message: `IFSC is not valid (${FORMATS.IFSC.hint})` });
    const bank = FORMATS.IFSC.test(bk.ifsc) ? commonOf(db)?.list(reader(actor), 'banks', { key: bk.ifsc, limit: 1, offset: 0 }).rows[0] ?? null : null;
    return { bankName: bank?.bankName ?? null, branch: bank?.branch ?? null };
  }
  function checkContacts(contacts, problems) {
    for (const [i, c] of contacts.entries()) {
      if (c.phone && !FORMATS.MOBILE.test(c.phone)) problems.push({ field: `contacts.${i}.phone`, message: `Phone is not valid (${FORMATS.MOBILE.hint})` });
      if (c.type === 'EMERGENCY' && !c.phone) problems.push({ field: `contacts.${i}.phone`, message: 'An emergency contact needs a phone number' });
      if (c.type !== 'NOMINEE' && c.sharePct != null) problems.push({ field: `contacts.${i}.sharePct`, message: 'Only a nominee has a share' });
      if (c.dob && !validDate(c.dob)) problems.push({ field: `contacts.${i}.dob`, message: 'Use a date such as 1990-05-17' });
    }
    const nominees = contacts.filter((c) => c.type === 'NOMINEE');
    if (nominees.length) {
      if (nominees.some((c) => c.sharePct == null || !/^\d{1,3}(\.\d{1,4})?$/.test(String(c.sharePct)) || Number(c.sharePct) <= 0)) problems.push({ field: 'contacts', message: 'Give every nominee a share above 0 (for example 50)' });
      else if (Math.round(nominees.reduce((a, c) => a + Number(c.sharePct) * 10000, 0)) !== 1_000_000) problems.push({ field: 'contacts', message: `The nominees' shares add up to ${trimNum(String(nominees.reduce((a, c) => a + Number(c.sharePct), 0)))}%; they must add up to 100%` });
    }
  }
  function checkHistoryRows(b, problems) {
    for (const [i, x] of (b.experience ?? []).entries()) {
      if (!validDate(x.fromDate)) problems.push({ field: `experience.${i}.fromDate`, message: 'Use a date such as 2018-04-01' });
      else if (x.toDate && x.toDate < x.fromDate) problems.push({ field: `experience.${i}.toDate`, message: 'The job ends after it starts' });
    }
  }
  /** Who looks like this person (FR-09): the same PAN or Aadhaar blocks (a separated employee's record is a rehire and only warns); the same mobile or the same name and date of birth warn. */
  function duplicates(companyId, b, exceptId = null) {
    const out = [];
    const ex = exceptId ? 'AND e.id != ?' : '';
    const args = (x) => (exceptId ? [...x, exceptId] : x);
    const live = "e.record_status NOT IN ('CANCELLED', 'REJECTED') AND e.deleted_at IS NULL";
    const push = (e, rule, field, blockIfLive) => out.push({ id: e.id, code: e.emp_code, name: e.full_name, rule, field, block: blockIfLive && !['SEPARATED', 'ABSCONDING'].includes(e.employment_status), rehire: ['SEPARATED', 'ABSCONDING'].includes(e.employment_status) });
    if (b.statutory?.pan) for (const e of db.prepare(`SELECT e.* FROM hr_employee_statutory s JOIN hr_employees e ON e.id = s.employee_id WHERE s.company_id = ? AND s.pan_hash = ? AND s.deleted_at IS NULL AND ${live} ${ex}`).all(...args([companyId, hash(companyId, 'pan', b.statutory.pan)]))) push(e, 'same PAN', 'statutory.pan', true);
    if (b.statutory?.aadhaar?.length === 12) for (const e of db.prepare(`SELECT e.* FROM hr_employee_statutory s JOIN hr_employees e ON e.id = s.employee_id WHERE s.company_id = ? AND s.aadhaar_hash = ? AND s.deleted_at IS NULL AND ${live} ${ex}`).all(...args([companyId, hash(companyId, 'aadhaar', b.statutory.aadhaar)]))) push(e, 'same Aadhaar', 'statutory.aadhaar', true);
    if (b.mobile) for (const e of db.prepare(`SELECT e.* FROM hr_employees e WHERE e.company_id = ? AND e.mobile = ? AND ${live} ${ex}`).all(...args([companyId, b.mobile]))) push(e, 'same mobile', 'mobile', false);
    if (b.firstName && b.dob) {
      const key = nameKey(`${b.firstName} ${b.lastName ?? ''}`);
      for (const e of db.prepare(`SELECT e.* FROM hr_employees e WHERE e.company_id = ? AND e.dob = ? AND ${live} ${ex}`).all(...args([companyId, b.dob]))) if (similarity(key, e.name_key) >= 90) push(e, 'same name and date of birth', 'firstName', false);
    }
    const seen = new Map();
    for (const d of out) { const k = `${d.id}:${d.rule}`; if (!seen.has(k)) seen.set(k, d); }
    return [...seen.values()].sort((a, c) => Number(c.block) - Number(a.block));
  }
  function prepare(actor, b, current = null) {
    const problems = [];
    checkCore(actor, b, problems, current);
    checkStatutory(actor, b.statutory, problems);
    const bank = checkBank(actor, b.bank, problems);
    checkContacts(b.contacts ?? [], problems);
    checkHistoryRows(b, problems);
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    const designation = b.designationId ? db.prepare('SELECT grade, level FROM org_designations WHERE id = ?').get(b.designationId) : null;
    return { bank, grade: b.grade ?? designation?.grade ?? null, dups: duplicates(actor.companyId, b, current?.id ?? null) };
  }
  const dupError = (dups, ack) => {
    const block = dups.filter((d) => d.block);
    if (block.length) return new HttpError(409, 'DUPLICATE', `This person already works here: ${block.map((d) => `${d.code} ${d.name} (${d.rule})`).join('; ')}.`, block.map((d) => ({ field: d.field, message: `${d.rule} as ${d.code}`, employeeId: d.id })));
    if (dups.length && !ack) return new HttpError(409, 'DUPLICATE_WARNING', `This looks like ${dups.map((d) => `${d.code} ${d.name} (${d.rule}${d.rehire ? ', has left: a rehire' : ''})`).join('; ')}. Check it, then confirm it is a different person${dups.some((d) => d.rehire) ? ' or a rehire' : ''}.`, dups.map((d) => ({ field: d.field, message: `${d.rule} as ${d.code}`, employeeId: d.id })));
    return null;
  };

  // ---- writing ----
  const statutoryCols = (actor, empId, s, existing = null) => {
    const merged = { ...(existing ?? {}), ...(s ?? {}) };
    return [
      merged.pan ? vault.encrypt(merged.pan, slot(actor.companyId, 'pan', empId)) : null, merged.pan ? hash(actor.companyId, 'pan', merged.pan) : null, merged.pan ? merged.pan.slice(-4) : null,
      merged.aadhaar ? merged.aadhaar.slice(-4) : (existing?.aadhaarLast4 ?? null), merged.aadhaar?.length === 12 ? hash(actor.companyId, 'aadhaar', merged.aadhaar) : (existing?.aadhaarHash ?? null),
      merged.uan ?? null, merged.esicIp ?? null, merged.pfApplicable ? 1 : 0, merged.esiApplicable ? 1 : 0, merged.ptState ?? null, merged.lwfState ?? null,
    ];
  };
  function writeStatutory(actor, empId, s) {
    db.prepare('UPDATE hr_employee_statutory SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE employee_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, empId);
    if (!s) return;
    db.prepare("INSERT INTO hr_employee_statutory (company_id, employee_id, pan_enc, pan_hash, pan_last4, aadhaar_last4, aadhaar_hash, uan, esic_ip, pf_applicable, esi_applicable, pt_state, lwf_state, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')")
      .run(actor.companyId, empId, ...statutoryCols(actor, empId, s), actor.user);
  }
  function insertBank(actor, empId, bk, meta, { status, primary = false, changeId = null, reason = null }) {
    const enc = vault.encrypt(bk.accountNo, slot(actor.companyId, 'bank', empId));
    return Number(db.prepare("INSERT INTO hr_employee_banks (company_id, employee_id, account_enc, account_hash, account_last4, ifsc, bank_name, branch_name, account_name, bank_status, is_primary, change_id, remarks, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')")
      .run(actor.companyId, empId, enc, hash(actor.companyId, 'bank', bk.accountNo), bk.accountNo.slice(-4), bk.ifsc, meta.bankName ?? null, meta.branch ?? null, bk.accountName, status, primary ? 1 : 0, changeId, reason, actor.user).lastInsertRowid);
  }
  function writeContacts(actor, empId, contacts, types = null) {
    db.prepare(`UPDATE hr_employee_contacts SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE employee_id = ? AND deleted_at IS NULL ${types ? `AND contact_type IN (${types.map(() => '?').join(',')})` : ''}`).run(nowIso(), actor.user, empId, ...(types ?? []));
    for (const c of contacts) db.prepare("INSERT INTO hr_employee_contacts (company_id, employee_id, contact_type, name, relation, phone, dob, share_pct, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')")
      .run(actor.companyId, empId, c.type, c.name, c.relation, c.phone ?? null, c.dob ?? null, c.sharePct != null ? toUnits(c.sharePct, 'percent') : null, actor.user);
  }
  function writeEducation(actor, empId, list) {
    db.prepare('UPDATE hr_employee_education SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE employee_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, empId);
    for (const x of list) db.prepare("INSERT INTO hr_employee_education (company_id, employee_id, qualification, institute, pass_year, grade_text, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'hr_employee')").run(actor.companyId, empId, x.qualification, x.institute ?? null, x.year ?? null, x.grade ?? null, actor.user);
  }
  function writeExperience(actor, empId, list) {
    db.prepare('UPDATE hr_employee_experience SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE employee_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, empId);
    for (const x of list) db.prepare("INSERT INTO hr_employee_experience (company_id, employee_id, employer, job_title, from_date, to_date, leaving_reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')").run(actor.companyId, empId, x.employer, x.jobTitle, x.fromDate, x.toDate ?? null, x.leavingReason ?? null, actor.user);
  }
  const addr = (a) => (a ? JSON.stringify(a) : null);
  const HEAD_COLS = ['first_name', 'last_name', 'full_name', 'name_key', 'gender', 'dob', 'blood_group', 'marital_status', 'mobile', 'email', 'permanent_address', 'current_address', 'branch_id', 'department_id', 'designation_id', 'grade', 'employment_type', 'doj', 'confirmation_date', 'manager_id', 'cost_centre_id', 'location_type', 'project_id', 'site_id', 'salary_payment_mode', 'languages_json', 'skills_json'];
  const HEAD_SQL = HEAD_COLS.map((c) => `${c} = ?`).join(', ');
  const headArgs = (b, grade) => {
    const full = `${b.firstName}${b.lastName ? ` ${b.lastName}` : ''}`.trim();
    return [b.firstName, b.lastName ?? null, full, nameKey(full), b.gender, b.dob, b.bloodGroup ?? null, b.maritalStatus ?? null, b.mobile, b.email ?? null, addr(b.permanentAddress), addr(b.currentAddress), b.branchId ?? null, b.departmentId, b.designationId, grade, b.employmentType, b.doj, b.confirmationDate ?? null, b.managerId ?? null, b.costCentreId ?? null, b.locationType, b.projectId ?? null, b.siteId ?? null, b.salaryPaymentMode, JSON.stringify(b.languages ?? []), JSON.stringify(b.skills ?? [])];
  };
  function writeChildren(actor, empId, b, prep) {
    writeStatutory(actor, empId, b.statutory);
    writeContacts(actor, empId, b.contacts ?? []);
    writeEducation(actor, empId, b.education ?? []);
    writeExperience(actor, empId, b.experience ?? []);
    if (b.bank) {
      db.prepare("UPDATE hr_employee_banks SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE employee_id = ? AND bank_status = 'PENDING_APPROVAL' AND change_id IS NULL AND deleted_at IS NULL").run(nowIso(), actor.user, empId);
      insertBank(actor, empId, b.bank, prep.bank, { status: 'PENDING_APPROVAL', primary: true, reason: 'Joining' });
    }
  }
  const addHistory = (actor, e, eventType, effectiveDate, from, to, extra = {}) => db.prepare("INSERT INTO hr_employee_history (company_id, employee_id, event_type, effective_date, from_json, to_json, reference_doc, reason, change_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')")
    .run(e.company_id, e.id, eventType, effectiveDate, JSON.stringify(from ?? {}), JSON.stringify(to ?? {}), extra.referenceDoc ?? null, extra.reason ?? null, extra.changeId ?? null, actor.user);

  // ---- views ----
  const bankView = (bk, reveal) => ({ id: bk.id, account: `••••••${bk.account_last4}`, last4: bk.account_last4, ifsc: bk.ifsc, bankName: bk.bank_name, branch: bk.branch_name, accountName: reveal ? bk.account_name : mask(bk.account_name), status: bk.bank_status, verified: bk.verified_status, verifiedBy: bk.verified_by, verifiedAt: bk.verified_at, verifyNote: bk.verify_note, primary: Boolean(bk.is_primary), changeId: bk.change_id, createdAt: bk.created_at });
  const docState = (d) => (!d.valid_until ? 'NO_EXPIRY' : d.valid_until < todayIST() ? 'EXPIRED' : d.valid_until <= dayPlus(param('hr.employee.expiry_warning_days', d.company_id) ?? 30) ? 'DUE' : 'VALID');
  const docView = (d) => ({ id: d.id, type: d.doc_type, typeLabel: DOC_LABELS[d.doc_type], number: d.document_ref, fileId: d.file_id, validFrom: d.valid_from, validUntil: d.valid_until, verifiedBy: d.verified_by, verifiedAt: d.verified_at, addedBy: d.created_by, state: docState(d) });
  const addrView = (s) => json(s, null);
  function userView(e) {
    if (!e.user_id) return null;
    const u = db.prepare("SELECT u.id, u.username, u.display_name, COALESCE(p.lifecycle, 'ACTIVE') AS lifecycle FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.id = ?").get(e.user_id);
    return u ? { id: u.id, username: u.username, displayName: u.display_name, lifecycle: u.lifecycle } : null;
  }
  function view(actor, e, { full = false } = {}) {
    const level = access(actor, e);
    const sens = seesSensitive(actor, e);
    const line = level === 'full' || level === 'self' || inLine(actor, e);
    const dg = e.designation_id ? db.prepare('SELECT name, level FROM org_designations WHERE id = ?').get(e.designation_id) : null;
    const base = { id: e.id, code: e.emp_code, firstName: e.first_name, lastName: e.last_name, name: e.full_name, photoFileId: e.photo_file_id, gender: e.gender, dob: level === 'team' ? undefined : e.dob, bloodGroup: level === 'team' ? undefined : e.blood_group, maritalStatus: level === 'team' ? undefined : e.marital_status,
      mobile: line ? e.mobile : mask(e.mobile), email: line ? e.email : (e.email ? `${e.email[0]}•••@${e.email.split('@')[1] ?? ''}` : null),
      branchId: e.branch_id, branch: orgName('org_branches', e.branch_id), departmentId: e.department_id, department: orgName('org_departments', e.department_id), designationId: e.designation_id, designation: dg?.name ?? null, designationLevel: dg?.level ?? null, grade: e.grade,
      employmentType: e.employment_type, employmentTypeLabel: TYPE_LABELS[e.employment_type], doj: e.doj, confirmationDate: e.confirmation_date, managerId: e.manager_id, manager: e.manager_id ? db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(e.manager_id) : null,
      costCentreId: e.cost_centre_id, costCentre: orgName('org_cost_centres', e.cost_centre_id), locationType: e.location_type, projectId: e.project_id, project: orgName('org_projects', e.project_id), siteId: e.site_id, site: orgName('org_sites', e.site_id), salaryPaymentMode: e.salary_payment_mode,
      employmentStatus: e.employment_status, employmentStatusLabel: EMPLOYMENT_LABELS[e.employment_status], statusEffectiveDate: e.status_effective_date, lastWorkingDate: e.last_working_date, separationReason: level === 'team' ? undefined : e.separation_reason, accessNote: level === 'full' ? e.access_note : undefined,
      status: e.record_status, statusLabel: STATUS_LABELS[e.record_status], requestedBy: e.requested_by, activatedAt: e.activated_at, instanceId: e.workflow_instance_id, rowVersion: e.version, accessLevel: level, masked: !sens, user: level === 'team' ? null : userView(e),
      languages: json(e.languages_json, []), skills: json(e.skills_json, []), canEdit: ['DRAFT', 'RETURNED'].includes(e.record_status) && may(actor, 'hr.employee.edit') && maker(actor, e), isSelf: isSelf(actor, e) };
    if (!full) return base;
    const st = db.prepare('SELECT * FROM hr_employee_statutory WHERE employee_id = ? AND deleted_at IS NULL').get(e.id);
    const statutory = st && level !== 'team' ? {
      pan: st.pan_enc ? (sens ? vault.decrypt(st.pan_enc, slot(e.company_id, 'pan', e.id)) : `••••••${st.pan_last4}`) : null, aadhaar: st.aadhaar_last4 ? `•••• •••• ${st.aadhaar_last4}` : null, uan: sens ? st.uan : mask(st.uan), esicIp: sens ? st.esic_ip : mask(st.esic_ip),
      pfApplicable: Boolean(st.pf_applicable), esiApplicable: Boolean(st.esi_applicable), ptState: st.pt_state, lwfState: st.lwf_state,
    } : (st ? { pan: st.pan_last4 ? `••••••${st.pan_last4}` : null, aadhaar: st.aadhaar_last4 ? `•••• •••• ${st.aadhaar_last4}` : null, uan: mask(st.uan), esicIp: mask(st.esic_ip), pfApplicable: Boolean(st.pf_applicable), esiApplicable: Boolean(st.esi_applicable), ptState: st.pt_state, lwfState: st.lwf_state } : null);
    const docs = level === 'team' ? [] : db.prepare('SELECT * FROM hr_employee_documents WHERE employee_id = ? AND deleted_at IS NULL ORDER BY valid_until IS NULL, valid_until').all(e.id).map(docView);
    return { ...base,
      permanentAddress: level === 'team' ? undefined : addrView(e.permanent_address), currentAddress: level === 'team' ? undefined : addrView(e.current_address),
      statutory, banks: db.prepare("SELECT * FROM hr_employee_banks WHERE employee_id = ? AND deleted_at IS NULL ORDER BY CASE bank_status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING_APPROVAL' THEN 1 ELSE 2 END, id DESC").all(e.id).map((bk) => bankView(bk, sens)),
      contacts: level === 'team' ? [] : db.prepare('SELECT * FROM hr_employee_contacts WHERE employee_id = ? AND deleted_at IS NULL ORDER BY contact_type, id').all(e.id).map((c) => ({ id: c.id, type: c.contact_type, name: c.name, relation: c.relation, phone: c.phone, dob: c.dob, sharePct: c.share_pct != null ? trimNum(fromUnits(c.share_pct, 'percent').toFixed()) : null })),
      education: level === 'team' ? [] : db.prepare('SELECT * FROM hr_employee_education WHERE employee_id = ? AND deleted_at IS NULL ORDER BY pass_year DESC, id').all(e.id).map((x) => ({ id: x.id, qualification: x.qualification, institute: x.institute, year: x.pass_year, grade: x.grade_text })),
      experience: level === 'team' ? [] : db.prepare('SELECT * FROM hr_employee_experience WHERE employee_id = ? AND deleted_at IS NULL ORDER BY from_date DESC, id').all(e.id).map((x) => ({ id: x.id, employer: x.employer, jobTitle: x.job_title, fromDate: x.from_date, toDate: x.to_date, leavingReason: x.leaving_reason })),
      documents: docs, expiredDocuments: docs.filter((d) => d.state === 'EXPIRED').length, dueDocuments: docs.filter((d) => d.state === 'DUE').length,
      history: db.prepare('SELECT * FROM hr_employee_history WHERE employee_id = ? AND deleted_at IS NULL ORDER BY effective_date DESC, id DESC').all(e.id).map((h) => ({ id: h.id, event: h.event_type, effectiveDate: h.effective_date, from: json(h.from_json, {}), to: json(h.to_json, {}), referenceDoc: h.reference_doc, reason: h.reason, by: h.created_by, at: h.created_at })),
      changes: level === 'team' ? [] : db.prepare('SELECT * FROM hr_employee_changes WHERE employee_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30').all(e.id).map((c) => changeView(actor, c, sens)),
      relatedTabs: related.size ? [...related.values()].map((r) => ({ code: r.code, label: r.label, items: r.summary(db, e.company_id, e) })) : [],
      canSeeSensitive: sens, canAmend: may(actor, 'hr.employee.amend') || isSelf(actor, e), canSeparate: may(actor, 'hr.employee.separate'), canLinkUser: may(actor, 'hr.employee.link_user'), canVerifyBank: may(actor, 'hr.employee.bank.verify'), canPrint: may(actor, 'hr.employee.print'), canCancel: may(actor, 'hr.employee.cancel'),
      canEditDetails: may(actor, 'hr.employee.edit') && e.record_status === 'APPROVED', canSubmit: ['DRAFT', 'RETURNED'].includes(e.record_status) && may(actor, 'hr.employee.submit') && maker(actor, e), canDelete: e.record_status === 'DRAFT' && may(actor, 'hr.employee.delete') && maker(actor, e) };
  }
  function changeView(actor, c, sens) {
    const summary = json(c.summary_json, {});
    return { id: c.id, employeeId: c.employee_id, type: c.change_type, typeLabel: CHANGE_LABELS[c.change_type], effectiveDate: c.effective_date, summary: c.change_type === 'STATUTORY' || c.change_type === 'BANK' ? (sens ? summary : Object.fromEntries(Object.keys(summary).map((k) => [k, 'changed']))) : summary,
      before: json(c.before_json, {}), reason: c.reason, status: c.change_status, senior: Boolean(c.senior), requestedBy: c.requested_by, selfService: Boolean(c.requested_self), decidedBy: c.decided_by, decidedAt: c.decided_at, appliedAt: c.applied_at, instanceId: c.workflow_instance_id, createdAt: c.created_at };
  }

  // ---- registration and approval (FR-01, FR-02, AC-01) ----
  const tell = (e, what, decision, comment, to = e.requested_by) => to && notif.notify({ companyId: e.company_id, templateCode: 'hr.employee.decided', recipients: [`user:${to}`], data: { decision, code: e.emp_code, name: e.full_name, what, comment: comment ? `: ${comment}` : '' }, link: `/hr/employees/employee?id=${e.id}`, sourceType: 'hr_employee', sourceId: String(e.id), eventKey: `hr.employee.decided:${e.id}:${what}:${decision}:${Date.now()}` });
  const event = (type, actor, e, data = {}) => publishEvent(db, { type, entity: 'hr_employee', entityId: e.id, actorId: actor.user, companyId: e.company_id, projectId: e.project_id ?? undefined, siteId: e.site_id ?? undefined, data: { code: e.emp_code, userId: e.user_id ?? null, ...data } });
  const registration = {
    check(actor, b) {
      need(actor, 'hr.employee.create', 'enter employees');
      try { const pr = prepare(actor, b, b.employeeId ? row(actor, b.employeeId) : null); return { errors: [], duplicates: pr.dups }; } catch (e) { if (e instanceof HttpError && e.status === 400) return { errors: e.details, duplicates: duplicates(actor.companyId, b, b.employeeId ?? null) }; throw e; }
    },
    create(actor, b) {
      need(actor, 'hr.employee.create', 'enter employees');
      const pr = prepare(actor, b);
      const err = dupError(pr.dups, b.acknowledgeDuplicates);
      if (err) throw err;
      return transaction(db, () => {
        const code = nextCode(actor);
        const id = Number(db.prepare(`INSERT INTO hr_employees (company_id, emp_code, ${HEAD_COLS.join(', ')}, record_status, requested_by, created_by, source_type) VALUES (?, ?, ${HEAD_COLS.map(() => '?').join(', ')}, 'DRAFT', ?, ?, 'hr_employee')`)
          .run(actor.companyId, code, ...headArgs(b, pr.grade), actor.user, actor.user).lastInsertRowid);
        writeChildren(actor, id, b, pr);
        writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'create', newValues: { code, name: `${b.firstName} ${b.lastName ?? ''}`.trim(), departmentId: b.departmentId, designationId: b.designationId, employmentType: b.employmentType, doj: b.doj }, actor: actor.user, companyId: actor.companyId });
        const out = view(actor, row(actor, id), { full: true });
        return b.submit ? { ...out, ...registration.submit(actor, id, { comment: b.comment }) } : out;
      });
    },
    update(actor, id, b) {
      need(actor, 'hr.employee.edit', 'change employees');
      const e = row(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(e.record_status)) throw conflict(`An employee that is ${STATUS_LABELS[e.record_status].toLowerCase()} is changed by a request: use Amend on the employee page.`);
      if (!maker(actor, e)) throw forbidden(`Only ${e.requested_by ?? e.created_by}, who entered this employee, changes the draft.`);
      if (e.version !== b.version) throw conflict('This employee was changed by someone else. Reload it and try again.');
      const pr = prepare(actor, b, e);
      const err = dupError(pr.dups, b.acknowledgeDuplicates);
      if (err) throw err;
      return transaction(db, () => {
        db.prepare(`UPDATE hr_employees SET ${HEAD_SQL}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...headArgs(b, pr.grade), actor.user, nowIso(), id);
        writeChildren(actor, id, b, pr);
        writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'update', newValues: { name: `${b.firstName} ${b.lastName ?? ''}`.trim(), departmentId: b.departmentId, designationId: b.designationId }, actor: actor.user, companyId: actor.companyId });
        return view(actor, row(actor, id), { full: true });
      });
    },
    remove(actor, id, { reason } = /** @type {any} */ ({})) {
      need(actor, 'hr.employee.delete', 'delete employees');
      const e = row(actor, id);
      if (e.record_status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (!maker(actor, e)) throw forbidden(`Only ${e.requested_by ?? e.created_by}, who entered this employee, deletes the draft.`);
      const now = nowIso();
      transaction(db, () => {
        db.prepare('UPDATE hr_employees SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(now, actor.user, id);
        for (const t of ['hr_employee_statutory', 'hr_employee_banks', 'hr_employee_contacts', 'hr_employee_education', 'hr_employee_experience', 'hr_employee_documents']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE employee_id = ? AND deleted_at IS NULL`).run(now, actor.user, id);
        writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'delete', reason: reason ?? null, actor: actor.user, companyId: actor.companyId });
      });
      return { id, deleted: true };
    },
    /** Send a Draft (or a returned record) for approval. The workflow engine routes it; the person who entered it never approves it. */
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      need(actor, 'hr.employee.submit', 'submit employees');
      const e = row(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(e.record_status)) throw conflict(`This employee is ${STATUS_LABELS[e.record_status].toLowerCase()}.`);
      if (!maker(actor, e)) throw forbidden(`Only ${e.requested_by ?? e.created_by}, who entered this employee, sends it for approval.`);
      const problems = [];
      if (!db.prepare("SELECT 1 FROM hr_employee_contacts WHERE employee_id = ? AND contact_type = 'EMERGENCY' AND deleted_at IS NULL").get(id)) problems.push({ field: 'contacts', message: 'Give at least one emergency contact' });
      if (e.salary_payment_mode === 'BANK_TRANSFER' && !db.prepare("SELECT 1 FROM hr_employee_banks WHERE employee_id = ? AND deleted_at IS NULL AND bank_status IN ('PENDING_APPROVAL', 'ACTIVE')").get(id)) problems.push({ field: 'bank', message: 'Give the bank account for the salary transfer (or choose another payment mode)' });
      const st = db.prepare('SELECT 1 FROM hr_employee_statutory WHERE employee_id = ? AND deleted_at IS NULL').get(id);
      if (!st) problems.push({ field: 'statutory', message: 'Give the statutory details (PAN, PF and ESI applicability)' });
      if (problems.length) throw badRequest('Complete the record before sending it for approval.', problems);
      const sameStat = db.prepare("SELECT s.pan_hash, s.aadhaar_hash FROM hr_employee_statutory s WHERE s.employee_id = ? AND s.deleted_at IS NULL").get(id);
      for (const [col, rule] of [['pan_hash', 'same PAN'], ['aadhaar_hash', 'same Aadhaar']]) if (sameStat?.[col]) {
        const o = db.prepare(`SELECT e.emp_code, e.full_name FROM hr_employee_statutory s JOIN hr_employees e ON e.id = s.employee_id WHERE s.company_id = ? AND s.${col} = ? AND s.employee_id != ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL AND e.record_status NOT IN ('CANCELLED', 'REJECTED') AND e.employment_status NOT IN ('SEPARATED', 'ABSCONDING')`).get(e.company_id, sameStat[col], id);
        if (o) throw new HttpError(409, 'DUPLICATE', `This person already works here: ${o.emp_code} ${o.full_name} (${rule}).`, [{ field: 'statutory', message: `${rule} as ${o.emp_code}` }]);
      }
      return transaction(db, () => {
        if (e.record_status === 'RETURNED') workflowOf(db).resubmit(actor, e.workflow_instance_id, { comment: comment ?? 'Corrected', context: { locationType: e.location_type } });
        else { const inst = workflowOf(db).submit(actor, { docType: EMP_DOC, docId: id, comment: comment ?? 'New employee', context: { locationType: e.location_type, employmentType: e.employment_type } }); db.prepare('UPDATE hr_employees SET workflow_instance_id = ? WHERE id = ?').run(inst?.id ?? null, id); }
        db.prepare("UPDATE hr_employees SET record_status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return { ...view(actor, row(actor, id), { full: true }), workflow: { id: db.prepare('SELECT workflow_instance_id AS id FROM hr_employees WHERE id = ?').get(id).id } };
      });
    },
    withdraw(actor, id, { reason }) {
      const e = row(actor, id);
      if (e.record_status !== 'SUBMITTED') throw unprocessable('Only an employee in approval is withdrawn.');
      if (!maker(actor, e)) throw forbidden('Only the person who sent it for approval withdraws it.');
      workflowOf(db).withdraw(actor, e.workflow_instance_id, { comment: reason });
      return view(actor, row(actor, id), { full: true });
    },
    cancel(actor, id, { reason }) {
      need(actor, 'hr.employee.cancel', 'cancel employees');
      const e = row(actor, id);
      if (!['SUBMITTED', 'RETURNED'].includes(e.record_status)) throw unprocessable('Only an employee in approval or returned is cancelled; delete a draft, amend an approved record.');
      if (maker(actor, e)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, e.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.employee({ docId: e.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, e.workflow_instance_id, { reason });
      return view(actor, row(actor, id), { full: true });
    },
  };

  // ---- changes after approval (amendments, FR-04, FR-07, BR-02) ----
  const FIELD_LABELS = { firstName: 'First name', lastName: 'Last name', gender: 'Gender', dob: 'Date of birth', bloodGroup: 'Blood group', maritalStatus: 'Marital status', mobile: 'Mobile', email: 'E-mail', permanentAddress: 'Permanent address', currentAddress: 'Current address', contacts: 'Contacts and nominees',
    branchId: 'Branch', departmentId: 'Department', designationId: 'Designation', grade: 'Grade', employmentType: 'Employment type', confirmationDate: 'Confirmation date', managerId: 'Reports to', costCentreId: 'Cost centre', locationType: 'Work location', projectId: 'Project', siteId: 'Site', salaryPaymentMode: 'Salary payment mode',
    pan: 'PAN', aadhaar: 'Aadhaar', uan: 'UAN', esicIp: 'ESIC IP number', pfApplicable: 'PF applicable', esiApplicable: 'ESI applicable', ptState: 'PT state', lwfState: 'LWF state' };
  const SELF_FIELDS = new Set(['mobile', 'email', 'permanentAddress', 'currentAddress', 'maritalStatus', 'bloodGroup', 'contacts']);
  const COL = { firstName: 'first_name', lastName: 'last_name', gender: 'gender', dob: 'dob', bloodGroup: 'blood_group', maritalStatus: 'marital_status', mobile: 'mobile', email: 'email', branchId: 'branch_id', departmentId: 'department_id', designationId: 'designation_id', grade: 'grade', employmentType: 'employment_type', confirmationDate: 'confirmation_date', managerId: 'manager_id', costCentreId: 'cost_centre_id', locationType: 'location_type', projectId: 'project_id', siteId: 'site_id', salaryPaymentMode: 'salary_payment_mode' };
  const display = (actor, key, v) => {
    if (v == null || v === '') return '—';
    if (key === 'branchId') return orgName('org_branches', v); if (key === 'departmentId') return orgName('org_departments', v); if (key === 'designationId') return orgName('org_designations', v);
    if (key === 'costCentreId') return orgName('org_cost_centres', v); if (key === 'projectId') return orgName('org_projects', v); if (key === 'siteId') return orgName('org_sites', v);
    if (key === 'managerId') { const m = db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(v); return m ? `${m.emp_code} ${m.full_name}` : String(v); }
    if (key === 'permanentAddress' || key === 'currentAddress') { const a = typeof v === 'string' ? json(v, null) : v; return a ? [a.line, a.city, a.stateCode, a.pin].filter(Boolean).join(', ') : '—'; }
    if (key === 'contacts') return `${v.length} contact(s)`;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };
  const currentValue = (e, key) => (key in COL ? e[COL[key]] : key === 'permanentAddress' ? e.permanent_address : key === 'currentAddress' ? e.current_address : undefined);
  const amendments = {
    /** Ask for a change to an approved employee (HR with edit rights, or the employee for the limited self-service fields). */
    request(actor, id, b) {
      const e = row(actor, id);
      if (e.record_status !== 'APPROVED') throw conflict('Only an approved employee is amended; correct a draft or returned record directly.');
      const self = isSelf(actor, e) && !may(actor, 'hr.employee.amend');
      if (!self) need(actor, b.type === 'SEPARATION' ? 'hr.employee.separate' : 'hr.employee.amend', b.type === 'SEPARATION' ? 'change the employment status' : 'amend employees');
      if (self && (b.type !== 'PROFILE' && b.type !== 'STATUTORY' && b.type !== 'BANK')) throw forbidden('You may ask for a change to your own contact details, addresses, nominees, statutory and bank details; HR changes the rest.');
      if (self && b.type === 'PROFILE') { const bad = Object.keys(b.changes).filter((k) => !SELF_FIELDS.has(k)); if (bad.length) throw forbidden(`You may ask for a change to your contact details, addresses, marital status, blood group and contacts; ${bad.map((k) => FIELD_LABELS[k]).join(', ')} is changed by HR.`); }
      if (db.prepare("SELECT 1 FROM hr_employee_changes WHERE employee_id = ? AND change_type = ? AND change_status IN ('PENDING', 'RETURNED') AND deleted_at IS NULL").get(id, b.type)) throw conflict(`A change of the ${CHANGE_LABELS[b.type].toLowerCase()} of this employee is already waiting.`);
      const when = b.effectiveDate ?? todayIST();
      if (!validDate(when)) throw badRequest('Some fields are not valid.', [{ field: 'effectiveDate', message: 'Use a date such as 2026-12-01' }]);
      if (when < e.doj && b.type !== 'PROFILE') throw badRequest('Some fields are not valid.', [{ field: 'effectiveDate', message: 'The change cannot start before the date of joining' }]);
      if (['EMPLOYMENT', 'SEPARATION'].includes(b.type) && ['SEPARATED', 'ABSCONDING'].includes(e.employment_status)) throw conflict('This person has left the company.');
      const c = b.changes;
      const problems = [];
      /** @type {Record<string, any>} */ let summary = {}; /** @type {Record<string, any>} */ let before = {}; /** @type {any} */ let payload = c; let senior = 0;
      if (b.type === 'PROFILE') {
        const merged = { dob: c.dob ?? e.dob, mobile: c.mobile ?? e.mobile, email: c.email === undefined ? e.email : c.email, doj: e.doj, permanentAddress: c.permanentAddress ?? null, currentAddress: c.currentAddress ?? null };
        const p2 = []; checkCore(actor, { ...merged, branchId: null, departmentId: null, designationId: null, costCentreId: null, projectId: null, siteId: null, managerId: null, locationType: 'HO' }, p2); problems.push(...p2.filter((p) => !['branchId', 'departmentId'].includes(p.field)));
        if (c.contacts) checkContacts(c.contacts, problems);
        if (c.mobile || c.dob || c.firstName) { const dups = duplicates(actor.companyId, { mobile: c.mobile, firstName: c.firstName ?? e.first_name, lastName: c.lastName ?? e.last_name, dob: c.dob ?? e.dob }, id).filter((d) => d.block); if (dups.length) problems.push({ field: 'mobile', message: `Same as ${dups[0].code}` }); }
        for (const k of Object.keys(c)) { summary[FIELD_LABELS[k]] = display(actor, k, c[k]); before[FIELD_LABELS[k]] = k === 'contacts' ? `${db.prepare("SELECT COUNT(*) AS n FROM hr_employee_contacts WHERE employee_id = ? AND deleted_at IS NULL").get(id).n} contact(s)` : display(actor, k, currentValue(e, k)); }
      } else if (b.type === 'EMPLOYMENT') {
        const next = { ...Object.fromEntries(Object.entries(COL).map(([k, col]) => [k, e[col]])), ...c };
        checkLinks(actor, next, problems, e);
        if (c.confirmationDate && c.confirmationDate < e.doj) problems.push({ field: 'confirmationDate', message: 'Confirmation is on or after the date of joining' });
        for (const k of Object.keys(c)) { if (c[k] === currentValue(e, k) || (c[k] === null && currentValue(e, k) == null)) { delete c[k]; continue; } summary[FIELD_LABELS[k]] = display(actor, k, c[k]); before[FIELD_LABELS[k]] = display(actor, k, currentValue(e, k)); }
        if (!Object.keys(c).length && b.eventType !== 'INCREMENT') problems.push({ field: 'changes', message: 'Nothing changes: give at least one new value (or record an increment)' });
        if (b.eventType === 'INCREMENT') { summary['Increment'] = b.referenceDoc ? `letter ${b.referenceDoc}` : 'recorded'; }
        const level = (id2) => (id2 ? db.prepare('SELECT level FROM org_designations WHERE id = ?').get(id2)?.level ?? 0 : 0);
        if (c.designationId || c.grade || c.managerId !== undefined) senior = Math.max(level(c.designationId ?? e.designation_id), level(e.designation_id)) >= (param('hr.employee.senior_level', actor.companyId) ?? 8) ? 1 : 0;
        if (c.designationId && !c.grade) { const g = db.prepare('SELECT grade FROM org_designations WHERE id = ?').get(c.designationId)?.grade; if (g && g !== e.grade) { c.grade = g; summary[FIELD_LABELS.grade] = g; before[FIELD_LABELS.grade] = e.grade ?? '—'; } }
        payload = { ...c, eventType: b.eventType ?? null, referenceDoc: b.referenceDoc ?? null };
      } else if (b.type === 'STATUTORY') {
        checkStatutory(actor, c, problems, 'changes');
        const old = db.prepare('SELECT * FROM hr_employee_statutory WHERE employee_id = ? AND deleted_at IS NULL').get(id);
        const dups = duplicates(actor.companyId, { statutory: c }, id).filter((d) => d.block); if (dups.length) problems.push({ field: 'changes.pan', message: `Already recorded for ${dups[0].code} ${dups[0].name}` });
        if (!Object.keys(c).length) problems.push({ field: 'changes', message: 'Give at least one new value' });
        for (const k of Object.keys(c)) { summary[FIELD_LABELS[k]] = k === 'pan' ? mask(c.pan) : k === 'aadhaar' ? `•••• ${c.aadhaar.slice(-4)}` : k === 'uan' || k === 'esicIp' ? mask(c[k]) : display(actor, k, c[k]); before[FIELD_LABELS[k]] = !old ? '—' : k === 'pan' ? (old.pan_last4 ? `••••••${old.pan_last4}` : '—') : k === 'aadhaar' ? (old.aadhaar_last4 ? `•••• ${old.aadhaar_last4}` : '—') : k === 'uan' ? mask(old.uan) ?? '—' : k === 'esicIp' ? mask(old.esic_ip) ?? '—' : k === 'pfApplicable' ? (old.pf_applicable ? 'Yes' : 'No') : k === 'esiApplicable' ? (old.esi_applicable ? 'Yes' : 'No') : (old[k === 'ptState' ? 'pt_state' : 'lwf_state'] ?? '—'); }
      } else if (b.type === 'BANK') {
        const meta = checkBank(actor, c, problems, 'changes');
        if (db.prepare("SELECT 1 FROM hr_employee_banks WHERE company_id = ? AND account_hash = ? AND employee_id != ? AND bank_status IN ('PENDING_APPROVAL', 'ACTIVE') AND deleted_at IS NULL").get(actor.companyId, hash(actor.companyId, 'bank', c.accountNo ?? ''), id)) problems.push({ field: 'changes.accountNo', message: 'This account belongs to another employee: one account, one person' });
        if (!problems.length) {
          const old = db.prepare("SELECT * FROM hr_employee_banks WHERE employee_id = ? AND bank_status = 'ACTIVE' AND deleted_at IS NULL").get(id);
          summary = { 'New account': `••••••${c.accountNo.slice(-4)} (${c.ifsc})`, 'Name on the account': c.accountName }; before = { 'Account now': old ? `••••••${old.account_last4} (${old.ifsc})` : 'none' }; payload = { meta };
        }
      } else if (b.type === 'SEPARATION') {
        if (c.status === 'ACTIVE' && e.employment_status === 'ACTIVE') problems.push({ field: 'changes.status', message: 'The person is already active' });
        if (c.status === e.employment_status) problems.push({ field: 'changes.status', message: `The person is already ${EMPLOYMENT_LABELS[e.employment_status].toLowerCase()}` });
        if (['NOTICE', 'SEPARATED'].includes(c.status) && !c.lastWorkingDate) problems.push({ field: 'changes.lastWorkingDate', message: 'Give the last working day' });
        if (c.lastWorkingDate && (!validDate(c.lastWorkingDate) || c.lastWorkingDate < e.doj)) problems.push({ field: 'changes.lastWorkingDate', message: 'The last working day is on or after the date of joining' });
        if (c.status === 'SEPARATED' && c.lastWorkingDate && c.lastWorkingDate > when) problems.push({ field: 'effectiveDate', message: 'A separation takes effect on or after the last working day' });
        summary = { Status: EMPLOYMENT_LABELS[c.status], 'Last working day': c.lastWorkingDate ?? '—', Reason: c.separationReason }; before = { Status: EMPLOYMENT_LABELS[e.employment_status] };
      }
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const secret = vault.encrypt(JSON.stringify(payload), slot(actor.companyId, 'change', id));
        const cid = Number(db.prepare("INSERT INTO hr_employee_changes (company_id, employee_id, change_type, effective_date, payload_enc, summary_json, before_json, reason, senior, requested_by, requested_self, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')")
          .run(actor.companyId, id, b.type, when, secret, JSON.stringify(summary), JSON.stringify(before), b.reason, senior, actor.user, self ? 1 : 0, actor.user).lastInsertRowid);
        if (b.type === 'BANK') insertBank(actor, id, c, payload.meta, { status: 'PENDING_APPROVAL', changeId: cid, reason: b.reason });
        const inst = workflowOf(db).submit(actor, { docType: CHANGE_DOCS[b.type], docId: cid, comment: b.reason, context: { band: senior ? 'SENIOR' : 'STANDARD', employeeId: id, locationType: e.location_type } });
        db.prepare('UPDATE hr_employee_changes SET workflow_instance_id = ? WHERE id = ?').run(inst?.id ?? null, cid);
        writeAudit(db, { entity: 'hr_employee_changes', entityId: cid, action: 'request', newValues: { employee: e.emp_code, type: b.type, effectiveDate: when, fields: Object.keys(summary) }, reason: b.reason, actor: actor.user, companyId: actor.companyId });
        return { change: changeView(actor, db.prepare('SELECT * FROM hr_employee_changes WHERE id = ?').get(cid), seesSensitive(actor, e)), workflow: inst };
      });
    },
    cancel(actor, changeId, { reason }) {
      const c = db.prepare('SELECT * FROM hr_employee_changes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(changeId, actor.companyId);
      if (!c) throw notFound('That change does not exist.');
      const e = row(actor, c.employee_id);
      if (!['PENDING', 'RETURNED', 'SCHEDULED'].includes(c.change_status)) throw unprocessable('Only a change that is waiting is cancelled.');
      if (c.requested_by.toLowerCase() !== actor.user.toLowerCase() && !may(actor, 'hr.employee.cancel')) throw forbidden('Only the person who asked for the change, or HR, cancels it.');
      transaction(db, () => {
        if (c.change_status === 'SCHEDULED') decisions.change({ docId: c.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason);
        else if (c.requested_by.toLowerCase() === actor.user.toLowerCase()) { workflowOf(db).abandon(actor.companyId, c.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.change({ docId: c.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); }
        else workflowOf(db).cancel(actor, c.workflow_instance_id, { reason });
      });
      return changeView(actor, db.prepare('SELECT * FROM hr_employee_changes WHERE id = ?').get(changeId), seesSensitive(actor, e));
    },
    list(actor, { status, type } = /** @type {any} */ ({})) {
      need(actor, 'hr.employee.view', 'see employee changes');
      const where = ['c.company_id = ?', 'c.deleted_at IS NULL']; const args = [actor.companyId];
      if (status) { where.push('c.change_status = ?'); args.push(status); }
      if (type) { where.push('c.change_type = ?'); args.push(type); }
      const sens = may(actor, 'hr.employee.sensitive.view');
      return db.prepare(`SELECT c.*, e.emp_code, e.full_name FROM hr_employee_changes c JOIN hr_employees e ON e.id = c.employee_id WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 200`).all(...args).map((c) => ({ ...changeView(actor, c, sens), code: c.emp_code, name: c.full_name }));
    },
  };

  // ---- applying an approved change on its effective date (BR-02) ----
  const systemActor = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });
  /** @returns {{ done: boolean, note: string }} */
  function removeAccess(e, status, date) {
    if (!e.user_id) return { done: true, note: 'The person has no user account.' };
    const admin = userAdminOf(db);
    if (!admin) return { done: false, note: 'User management is not running: deactivate the account by hand.' };
    const sys = systemActor(e.company_id);
    const reason = `${e.emp_code} ${EMPLOYMENT_LABELS[status].toLowerCase()} from ${date}`;
    const manager = e.manager_id ? db.prepare("SELECT u.id FROM hr_employees m JOIN iam_users u ON u.id = m.user_id WHERE m.id = ? AND u.is_active = 1").get(e.manager_id) : null;
    const attempt = (successorId) => { admin.deactivate(sys, e.user_id, { reason, ...(successorId ? { successorId } : {}) }); };
    try { attempt(null); return { done: true, note: 'The user account was deactivated and its sessions ended.' }; } catch (err) {
      if (/already deactivated/i.test(String(err?.message))) return { done: true, note: 'The user account was already deactivated.' };
      if (manager) { try { attempt(manager.id); return { done: true, note: 'The user account was deactivated; open items went to the reporting manager.' }; } catch (err2) { return { done: false, note: `Access was NOT removed: ${err2.message}` }; } }
      return { done: false, note: `Access was NOT removed: ${err?.message ?? 'unknown reason'}` };
    }
  }
  const GRADE_EVENTS = { designationId: 'DESIGNATION_CHANGE', grade: 'GRADE_CHANGE', managerId: 'MANAGER_CHANGE', branchId: 'TRANSFER', departmentId: 'TRANSFER', siteId: 'TRANSFER', projectId: 'TRANSFER', locationType: 'TRANSFER' };
  function applyChange(c, actor) {
    const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(c.employee_id);
    const payload = json(vault.decrypt(c.payload_enc, slot(c.company_id, 'change', c.employee_id)), {});
    const now = nowIso();
    const who = { user: actor.user, companyId: c.company_id };
    if (c.change_type === 'PROFILE') {
      const sets = []; const args = [];
      for (const [k, v] of Object.entries(payload)) {
        if (k === 'contacts') continue;
        if (k === 'permanentAddress' || k === 'currentAddress') { sets.push(`${k === 'permanentAddress' ? 'permanent_address' : 'current_address'} = ?`); args.push(addr(v)); } else { sets.push(`${COL[k]} = ?`); args.push(v ?? null); }
      }
      if (payload.firstName !== undefined || payload.lastName !== undefined) { const fn = payload.firstName ?? e.first_name; const ln = payload.lastName === undefined ? e.last_name : payload.lastName; const full = `${fn}${ln ? ` ${ln}` : ''}`.trim(); sets.push('full_name = ?', 'name_key = ?'); args.push(full, nameKey(full)); }
      if (sets.length) db.prepare(`UPDATE hr_employees SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...args, actor.user, now, e.id);
      if (payload.contacts) writeContacts(who, e.id, payload.contacts, ['EMERGENCY', 'FAMILY', 'NOMINEE']);
    } else if (c.change_type === 'STATUTORY') {
      const old = db.prepare('SELECT * FROM hr_employee_statutory WHERE employee_id = ? AND deleted_at IS NULL').get(e.id);
      const existing = old ? { pan: old.pan_enc ? vault.decrypt(old.pan_enc, slot(e.company_id, 'pan', e.id)) : null, aadhaarLast4: old.aadhaar_last4, aadhaarHash: old.aadhaar_hash, uan: old.uan, esicIp: old.esic_ip, pfApplicable: Boolean(old.pf_applicable), esiApplicable: Boolean(old.esi_applicable), ptState: old.pt_state, lwfState: old.lwf_state } : null;
      writeStatutory(who, e.id, null);
      db.prepare("INSERT INTO hr_employee_statutory (company_id, employee_id, pan_enc, pan_hash, pan_last4, aadhaar_last4, aadhaar_hash, uan, esic_ip, pf_applicable, esi_applicable, pt_state, lwf_state, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')")
        .run(e.company_id, e.id, ...statutoryCols(who, e.id, payload, existing), actor.user);
      db.prepare('UPDATE hr_employees SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, now, e.id);
    } else if (c.change_type === 'BANK') {
      const nb = db.prepare('SELECT * FROM hr_employee_banks WHERE change_id = ? AND deleted_at IS NULL').get(c.id);
      if (nb) {
        db.prepare("UPDATE hr_employee_banks SET bank_status = 'REPLACED', is_primary = 0, updated_at = ? WHERE employee_id = ? AND bank_status = 'ACTIVE' AND deleted_at IS NULL").run(now, e.id);
        db.prepare("UPDATE hr_employee_banks SET bank_status = 'ACTIVE', is_primary = 1, verified_status = 'VERIFIED', verified_by = ?, verified_at = ?, verify_note = 'Verified by payroll when the change was approved', updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, nb.id);
      }
      db.prepare('UPDATE hr_employees SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, now, e.id);
    } else if (c.change_type === 'EMPLOYMENT') {
      const { eventType, referenceDoc, ...fields } = payload;
      const sets = []; const args = []; const from = {}; const to = {};
      for (const [k, v] of Object.entries(fields)) { sets.push(`${COL[k]} = ?`); args.push(v ?? null); from[FIELD_LABELS[k]] = display(actor, k, e[COL[k]]); to[FIELD_LABELS[k]] = display(actor, k, v); }
      if (sets.length) db.prepare(`UPDATE hr_employees SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...args, actor.user, now, e.id);
      const kinds = [...new Set(Object.keys(fields).map((k) => GRADE_EVENTS[k]).filter(Boolean))];
      if (fields.confirmationDate && !kinds.length) kinds.push('CONFIRMED');
      const main = eventType && eventType !== 'INCREMENT' ? eventType : (kinds.length ? (kinds.length === 1 ? kinds[0] : (kinds.includes('DESIGNATION_CHANGE') ? 'DESIGNATION_CHANGE' : kinds[0])) : null);
      if (eventType === 'INCREMENT') addHistory(actor, e, 'INCREMENT', c.effective_date, {}, { note: 'Increment recorded' }, { referenceDoc, reason: c.reason, changeId: c.id });
      if (main || sets.length) addHistory(actor, e, main ?? 'OTHER', c.effective_date, from, to, { referenceDoc, reason: c.reason, changeId: c.id });
    } else if (c.change_type === 'SEPARATION') {
      const p = payload;
      db.prepare('UPDATE hr_employees SET employment_status = ?, status_effective_date = ?, last_working_date = ?, separation_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(p.status, c.effective_date, p.lastWorkingDate ?? null, p.separationReason, actor.user, now, e.id);
      addHistory(actor, e, ['SEPARATED', 'ABSCONDING'].includes(p.status) ? 'SEPARATION' : 'STATUS_CHANGE', c.effective_date, { status: EMPLOYMENT_LABELS[e.employment_status] }, { status: EMPLOYMENT_LABELS[p.status], lastWorkingDate: p.lastWorkingDate ?? null }, { reason: p.separationReason, changeId: c.id });
      if (['SEPARATED', 'ABSCONDING'].includes(p.status)) {
        const access = removeAccess(e, p.status, c.effective_date);
        db.prepare('UPDATE hr_employees SET access_note = ? WHERE id = ?').run(access.note, e.id);
        const fresh = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(e.id);
        event('hr.employee.separated', actor, fresh, { status: p.status, effectiveDate: c.effective_date, lastWorkingDate: p.lastWorkingDate ?? null, accessRemoved: access.done });
        const people = tasksOf(db).holders(e.company_id, ['HRMGR']);
        if (people.length) notif.notify({ companyId: e.company_id, templateCode: 'hr.employee.separated', recipients: people.map((u) => `user:${u}`), data: { code: e.emp_code, name: e.full_name, status: EMPLOYMENT_LABELS[p.status].toLowerCase(), date: c.effective_date, access: access.note }, link: `/hr/employees/employee?id=${e.id}`, sourceType: 'hr_employee', sourceId: String(e.id), eventKey: `hr.employee.separated:${e.id}:${c.id}` });
      } else if (p.status === 'ACTIVE') db.prepare("UPDATE hr_employees SET last_working_date = NULL, separation_reason = NULL WHERE id = ?").run(e.id);
    }
    db.prepare("UPDATE hr_employee_changes SET change_status = 'APPLIED', applied_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, now, c.id);
    const after = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(e.id);
    if (c.change_type !== 'SEPARATION' || payload.status === 'NOTICE' || payload.status === 'ACTIVE') event('hr.employee.updated', actor, after, { changeType: c.change_type, effectiveDate: c.effective_date });
    writeAudit(db, { entity: 'hr_employee_changes', entityId: c.id, action: 'apply', newValues: { employee: e.emp_code, type: c.change_type, effectiveDate: c.effective_date }, actor: actor.user, companyId: c.company_id });
  }
  function applyDecision(c, outcome, actor, comment) {
    db.prepare('UPDATE hr_employee_changes SET change_status = ?, decided_by = ?, decided_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome, actor.user, outcome === 'RETURNED' ? null : nowIso(), nowIso(), c.id);
    if (c.change_type === 'BANK' && ['REJECTED', 'CANCELLED'].includes(outcome)) db.prepare("UPDATE hr_employee_banks SET bank_status = 'REJECTED', updated_at = ? WHERE change_id = ? AND bank_status = 'PENDING_APPROVAL'").run(nowIso(), c.id);
    writeAudit(db, { entity: 'hr_employee_changes', entityId: c.id, action: outcome.toLowerCase(), actor: actor.user, companyId: c.company_id, reason: comment ?? null });
  }

  // ---- approval decisions ----
  const decisions = {
    employee(instance, actor, outcome, comment) {
      const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(instance.docId));
      if (!e || !['SUBMITTED', 'RETURNED'].includes(e.record_status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE hr_employees SET record_status = 'APPROVED', employment_status = 'ACTIVE', activated_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, e.id);
        db.prepare("UPDATE hr_employee_banks SET bank_status = 'ACTIVE', is_primary = 1, updated_at = ? WHERE employee_id = ? AND bank_status = 'PENDING_APPROVAL' AND change_id IS NULL AND deleted_at IS NULL").run(now, e.id);
        addHistory(actor, e, 'JOINED', e.doj, {}, { department: orgName('org_departments', e.department_id), designation: orgName('org_designations', e.designation_id), grade: e.grade, type: TYPE_LABELS[e.employment_type] }, { reason: 'New employee approved' });
        event('hr.employee.activated', actor, db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(e.id), { departmentId: e.department_id, designationId: e.designation_id, employmentType: e.employment_type, doj: e.doj, locationType: e.location_type, siteId: e.site_id, projectId: e.project_id, managerId: e.manager_id });
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        const status = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
        db.prepare('UPDATE hr_employees SET record_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, now, e.id);
        if (withdrawn) db.prepare('UPDATE hr_employees SET workflow_instance_id = NULL WHERE id = ?').run(e.id);
      }
      writeAudit(db, { entity: 'hr_employees', entityId: e.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: e.company_id });
      tell(e, 'Registration', outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'CANCELLED' ? (instance.status === 'WITHDRAWN' ? 'withdrawn' : 'cancelled') : 'rejected', comment);
    },
    change(instance, actor, outcome, comment) {
      const c = db.prepare('SELECT * FROM hr_employee_changes WHERE id = ?').get(Number(instance.docId));
      if (!c || !['PENDING', 'RETURNED', 'SCHEDULED'].includes(c.change_status)) return;
      const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(c.employee_id);
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE hr_employee_changes SET decided_by = ?, decided_at = ? WHERE id = ?").run(actor.user, nowIso(), c.id);
        if (c.effective_date <= todayIST()) applyChange(c, actor);
        else { db.prepare("UPDATE hr_employee_changes SET change_status = 'SCHEDULED', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), c.id); writeAudit(db, { entity: 'hr_employee_changes', entityId: c.id, action: 'scheduled', newValues: { effectiveDate: c.effective_date }, actor: actor.user, companyId: c.company_id }); }
      } else {
        applyDecision(c, outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED', actor, comment);
      }
      tell(e, CHANGE_LABELS[c.change_type], outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? (c.effective_date <= todayIST() ? 'approved and applied' : `approved, applies on ${c.effective_date}`) : outcome === 'CANCELLED' ? 'cancelled' : 'rejected', comment, c.requested_by);
    },
  };

  // ---- details that need no approval, documents, banks, the user link ----
  const details = {
    update(actor, id, b) {
      need(actor, 'hr.employee.edit', 'change employees');
      const e = row(actor, id);
      if (e.record_status !== 'APPROVED') throw conflict('Use the registration form for a record that is not approved yet.');
      if (e.version !== b.version) throw conflict('This employee was changed by someone else. Reload it and try again.');
      const problems = []; checkHistoryRows(b, problems);
      if (b.photoFileId != null && !db.prepare("SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = 'hr_employee' AND linked_id = ?").get(b.photoFileId, actor.companyId, id)) problems.push({ field: 'photoFileId', message: 'Upload the photo to this employee first' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        if (b.education) writeEducation(actor, id, b.education);
        if (b.experience) writeExperience(actor, id, b.experience);
        if (b.skills) db.prepare('UPDATE hr_employees SET skills_json = ? WHERE id = ?').run(JSON.stringify(b.skills), id);
        if (b.languages) db.prepare('UPDATE hr_employees SET languages_json = ? WHERE id = ?').run(JSON.stringify(b.languages), id);
        if (b.photoFileId !== undefined) db.prepare('UPDATE hr_employees SET photo_file_id = ? WHERE id = ?').run(b.photoFileId, id);
        db.prepare('UPDATE hr_employees SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'update_details', newValues: { fields: Object.keys(b).filter((k) => !['version', 'reason'].includes(k)) }, reason: b.reason ?? null, actor: actor.user, companyId: actor.companyId });
        event('hr.employee.updated', actor, db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(id), { changeType: 'DETAILS' });
        return view(actor, row(actor, id), { full: true });
      });
    },
    addDocument(actor, id, d) {
      const e = row(actor, id);
      if (!may(actor, 'hr.employee.edit') && !isSelf(actor, e)) throw forbidden('Only HR, or the employee, adds a document.');
      if (d.validFrom && d.validUntil && d.validUntil < d.validFrom) throw badRequest('Some fields are not valid.', [{ field: 'validUntil', message: 'Valid until is after valid from' }]);
      if (d.fileId != null && !db.prepare("SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = 'hr_employee' AND linked_id = ?").get(d.fileId, actor.companyId, id)) throw badRequest('Some fields are not valid.', [{ field: 'fileId', message: 'Upload the file to this employee first' }]);
      const did = Number(db.prepare("INSERT INTO hr_employee_documents (company_id, employee_id, doc_type, document_ref, file_id, valid_from, valid_until, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'hr_employee')").run(actor.companyId, id, d.docType, d.docNo ?? null, d.fileId ?? null, d.validFrom ?? null, d.validUntil ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'hr_employee_documents', entityId: did, action: 'create', newValues: { employee: e.emp_code, ...d }, actor: actor.user, companyId: actor.companyId });
      return view(actor, row(actor, id), { full: true }).documents;
    },
    verifyDocument(actor, id, docId) {
      need(actor, 'hr.employee.edit', 'verify documents');
      const e = row(actor, id);
      const d = db.prepare('SELECT * FROM hr_employee_documents WHERE id = ? AND employee_id = ? AND deleted_at IS NULL').get(docId, id);
      if (!d) throw notFound('That document is not of this employee.');
      if (d.created_by?.toLowerCase() === actor.user.toLowerCase()) throw forbidden('The person who added a document does not verify it.');
      db.prepare('UPDATE hr_employee_documents SET verified_by = ?, verified_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), nowIso(), docId);
      writeAudit(db, { entity: 'hr_employee_documents', entityId: docId, action: 'verify', newValues: { employee: e.emp_code }, actor: actor.user, companyId: actor.companyId });
      return view(actor, row(actor, id), { full: true }).documents;
    },
  };
  const banks = {
    /** Payroll verifies a bank account: someone other than the person who entered it (SoD). A change that PAY approved is verified by that approval. */
    verify(actor, id, bankId, { result, note }) {
      need(actor, 'hr.employee.bank.verify', 'verify bank accounts');
      const e = row(actor, id);
      const bk = db.prepare('SELECT * FROM hr_employee_banks WHERE id = ? AND employee_id = ? AND deleted_at IS NULL').get(bankId, id);
      if (!bk) throw notFound('That bank account is not of this employee.');
      if (bk.created_by?.toLowerCase() === actor.user.toLowerCase() || e.created_by?.toLowerCase() === actor.user.toLowerCase()) throw forbidden('The person who entered a bank account does not verify it.');
      db.prepare('UPDATE hr_employee_banks SET verified_status = ?, verified_by = ?, verified_at = ?, verify_note = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(result, actor.user, nowIso(), note, nowIso(), bankId);
      writeAudit(db, { entity: 'hr_employee_banks', entityId: bankId, action: 'verify', newValues: { employee: e.emp_code, result }, actor: actor.user, companyId: actor.companyId, reason: note });
      return bankView(db.prepare('SELECT * FROM hr_employee_banks WHERE id = ?').get(bankId), true);
    },
    /** The full account number, for HR, payroll and the employee only; every view is in the audit trail (BR-01). */
    reveal(actor, id, bankId) {
      const e = row(actor, id);
      if (!seesSensitive(actor, e)) throw forbidden('Bank account numbers are shown to HR, payroll and the employee only (permission hr.employee.sensitive.view).');
      const bk = db.prepare('SELECT * FROM hr_employee_banks WHERE id = ? AND employee_id = ? AND deleted_at IS NULL').get(bankId, id);
      if (!bk) throw notFound('That bank account is not of this employee.');
      writeAudit(db, { entity: 'hr_employee_banks', entityId: bankId, action: 'view_bank', actor: actor.user, companyId: actor.companyId, reason: 'Full account number shown' });
      return { id: bankId, accountNo: vault.decrypt(bk.account_enc, slot(e.company_id, 'bank', e.id)), ifsc: bk.ifsc, accountName: bk.account_name };
    },
  };
  const userLink = {
    /** FR-08: a user account is created from the employee record (an invitation goes to the employee) and linked at once. */
    async createUser(actor, id, b) {
      need(actor, 'hr.employee.link_user', 'create user accounts from employees');
      const e = row(actor, id);
      if (e.record_status !== 'APPROVED' || e.employment_status === 'SEPARATED' || e.employment_status === 'ABSCONDING') throw conflict('A user account is created for an approved employee who is still here.');
      if (e.user_id) throw conflict('This employee already has a user account.');
      const admin = userAdminOf(db);
      if (!admin) throw unprocessable('User management is not running.');
      const input = parseUserCreate({ ...(b.username ? { username: b.username } : {}), displayName: e.full_name, email: e.email, mobile: `+91${e.mobile}`, language: 'en', userType: 'INTERNAL', employeeCode: e.emp_code, departmentId: e.department_id, projectId: e.project_id, invite: b.invite, ...(b.channel ? { channel: b.channel } : {}) });
      const created = await admin.create(actor, input);
      db.prepare('UPDATE hr_employees SET user_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(created.id, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'create_user', newValues: { userId: created.id, username: created.username }, actor: actor.user, companyId: actor.companyId });
      event('hr.employee.updated', actor, db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(id), { changeType: 'USER_LINKED' });
      return { employee: view(actor, row(actor, id), { full: true }), user: { id: created.id, username: created.username, status: created.status }, inviteResult: created.inviteResult ?? null };
    },
    /** Link an existing account. One account per employee and one employee per account (BR-03). */
    link(actor, id, { userId }) {
      need(actor, 'hr.employee.link_user', 'link user accounts to employees');
      const e = row(actor, id);
      if (e.record_status !== 'APPROVED') throw conflict('Link accounts to approved employees.');
      if (e.user_id) throw conflict('This employee is already linked to a user account.');
      const admin = userAdminOf(db);
      if (!admin) throw unprocessable('User management is not running.');
      const u = admin.get(actor, userId);
      if (db.prepare("SELECT 1 FROM hr_employees WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL AND record_status NOT IN ('CANCELLED', 'REJECTED')").get(actor.companyId, userId)) throw new HttpError(409, 'DUPLICATE', `${u.username} is already linked to another employee: one account, one person.`);
      if (u.employeeCode && u.employeeCode !== e.emp_code) throw conflict(`${u.username} is already linked to employee code ${u.employeeCode} in user management.`);
      return transaction(db, () => {
        if (!u.employeeCode) admin.update(actor, userId, { version: u.version, employeeCode: e.emp_code, reason: `Linked to employee ${e.emp_code}` });
        db.prepare('UPDATE hr_employees SET user_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(userId, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'link_user', newValues: { userId, username: u.username }, actor: actor.user, companyId: actor.companyId });
        event('hr.employee.updated', actor, db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(id), { changeType: 'USER_LINKED' });
        return view(actor, row(actor, id), { full: true });
      });
    },
  };

  // ---- the daily cycle: scheduled changes come into force, document expiry (FR-06) ----
  function cycle(companyId, { today = todayIST() } = {}) {
    const out = { applied: 0, documentsDue: 0, documentsExpired: 0 };
    for (const c of db.prepare("SELECT * FROM hr_employee_changes WHERE company_id = ? AND change_status = 'SCHEDULED' AND effective_date <= ? AND deleted_at IS NULL ORDER BY effective_date, id").all(companyId, today)) {
      transaction(db, () => applyChange(c, systemActor(companyId)));
      out.applied += 1;
    }
    const warn = param('hr.employee.expiry_warning_days', companyId) ?? 30;
    const due = new Date(Date.parse(`${today}T00:00:00Z`) + warn * 86_400_000).toISOString().slice(0, 10);
    for (const d of db.prepare("SELECT d.*, e.emp_code, e.full_name FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.valid_until IS NOT NULL AND d.valid_until <= ? AND e.employment_status IN ('ACTIVE', 'NOTICE') AND e.record_status = 'APPROVED' AND COALESCE(d.alert_stage, '') != CASE WHEN d.valid_until < ? THEN 'EXPIRED' ELSE 'DUE' END").all(companyId, due, today)) {
      const stage = d.valid_until < today ? 'EXPIRED' : 'DUE';
      if (stage === 'DUE' && d.alert_stage === 'EXPIRED') continue;
      const people = tasksOf(db).holders(companyId, ['HRMGR']);
      if (people.length) notif.notify({ companyId, templateCode: 'hr.employee.document_expiry', recipients: people.map((u) => `user:${u}`), data: { stage: stage === 'EXPIRED' ? 'expired' : 'expires', code: d.emp_code, name: d.full_name, doc: DOC_LABELS[d.doc_type], date: d.valid_until }, link: `/hr/employees/employee?id=${d.employee_id}&tab=documents`, sourceType: 'hr_employee', sourceId: String(d.employee_id), eventKey: `hr.employee.document_expiry:${d.id}:${stage}` });
      db.prepare('UPDATE hr_employee_documents SET alert_stage = ?, updated_at = ? WHERE id = ?').run(stage, nowIso(), d.id);
      out[stage === 'EXPIRED' ? 'documentsExpired' : 'documentsDue'] += 1;
    }
    return out;
  }

  // ---- lists, 360, overview, worklist ----
  /** What the viewer may list: HR and the others who hold hr.employee.view see the company; the others their reporting line and the staff deployed to their projects and sites (approved records only). */
  function listScope(actor) {
    if (may(actor, 'hr.employee.view')) return { scopeSql: 'e.company_id = :c', params: { c: actor.companyId } };
    const me = myEmployee(actor);
    const f = authz.scopeFilter(actor, 'hr.employee.team.view', { project: 'e.project_id', site: 'e.site_id', branch: 'e.branch_id', department: 'e.department_id' });
    const parts = ['e.id = :me', 'e.user_id = :uid'];
    if (me) parts.push(`e.id IN (${REPORTS.replace('manager_id = ?', 'manager_id = :me')})`);
    if (!f.unrestricted && f.sql !== '1 = 0') parts.push(f.sql);
    return { scopeSql: `e.company_id = :c AND (e.record_status = 'APPROVED' OR e.user_id = :uid) AND (${parts.join(' OR ')})`, params: { c: actor.companyId, me: me?.id ?? 0, uid: myUserId(actor) ?? 0 } };
  }
  const listReq = (actor, query) => {
    const req = parseListRequest(employeeList, query);
    if (!may(actor, 'hr.employee.sensitive.view') && (req.sort.some((x) => ['pan'].includes(x.key)) || req.filters.some((x) => ['pan'].includes(x.key)))) throw badRequest('Some list parameters are invalid.', [{ field: 'pan', message: 'PAN is hidden for your role, so it cannot be sorted or filtered.' }]);
    return req;
  };
  const present = (actor, { reveal = false } = {}) => {
    const full = may(actor, 'hr.employee.view'); const sensitive = may(actor, 'hr.employee.sensitive.view');
    const me = myEmployee(actor); const line = me ? reportsOf(me.id) : new Set();
    return (r) => {
      const open = full || r.user_id === myUserId(actor) || line.has(r.id) || r.id === me?.id;
      return { id: r.id, code: r.emp_code, name: r.full_name, department: r.department_name, designation: r.designation_name, branch: r.branch_name, grade: r.grade, employmentType: r.employment_type, locationType: r.location_type, site: r.site_name, status: r.employment_status, recordStatus: r.record_status, doj: r.doj, lastWorkingDate: r.last_working_date,
        manager: r.manager_name, mobile: open ? r.mobile : mask(r.mobile), email: open ? r.email : (r.email ? `${r.email[0]}•••@${r.email.split('@')[1] ?? ''}` : null),
        pan: r.pan_last4 ? (reveal && sensitive && r.pan_enc ? vault.decrypt(r.pan_enc, slot(r.company_id, 'pan', r.id)) : `••••••${r.pan_last4}`) : null, hasUser: Boolean(r.user_id), updatedAt: r.updated_at ?? r.created_at };
    };
  };
  const select = `e.*, d.name AS department_name, g.name AS designation_name, b.name AS branch_name, m.full_name AS manager_name, s.name AS site_name, st.pan_last4 AS pan_last4, st.pan_enc AS pan_enc`;
  const register = {
    list(actor, query) {
      if (!may(actor, 'hr.employee.view') && !may(actor, 'hr.employee.team.view')) throw forbidden('You may not see employees (permission hr.employee.team.view).');
      return runList(db, employeeList, listReq(actor, query), { select, ...listScope(actor), tieBreaker: 'e.id', map: present(actor) });
    },
    exportSource(actor, req) {
      need(actor, 'hr.employee.export', 'export employees');
      const cols = Object.entries(employeeList.columns).filter(([k]) => !k.endsWith('Id')).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type }));
      return { title: employeeList.label, permission: 'hr.employee.export', personal: true, columns: cols, count: () => countList(db, employeeList, req, listScope(actor)),
        rows: () => runList(db, employeeList, req, { select, ...listScope(actor), tieBreaker: 'e.id', limit: null, map: present(actor, { reveal: true }) }).data,
        describe: (r) => [r.q ? `search "${r.q}"` : '', ...r.filters.map((x) => `${employeeList.columns[x.key].label} ${x.op} ${x.raw}`)].filter(Boolean).join('; ') };
    },
  };
  function get(actor, id) { return view(actor, row(actor, id), { full: true }); }
  /** The signed-in person's own record (self-service, FR-01): no permission is needed to see yourself. */
  function me(actor) {
    const e = myEmployee(actor);
    if (!e) throw notFound('Your user account is not linked to an employee record. Ask HR to link it.');
    return view(actor, e, { full: true });
  }
  function history(actor, id) {
    const e = row(actor, id);
    if (access(actor, e) === 'team') throw forbidden('Your role sees the basic data of this person only.');
    const changeIds = db.prepare('SELECT id, workflow_instance_id FROM hr_employee_changes WHERE employee_id = ?').all(id);
    const insts = [e.workflow_instance_id, ...changeIds.map((c) => c.workflow_instance_id)].filter(Boolean);
    const wf = insts.flatMap((i) => db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(i).map((h) => ({ instanceId: i, ...h })));
    const audit = db.prepare("SELECT action, actor, reason, created_at AS at, entity, entity_id FROM core_audit_log WHERE (entity = 'hr_employees' AND entity_id = ?) OR (entity = 'hr_employee_changes' AND entity_id IN (SELECT CAST(id AS TEXT) FROM hr_employee_changes WHERE employee_id = ?)) ORDER BY id").all(String(id), id);
    return { approvals: wf, audit: audit.map((x) => ({ entity: x.entity, action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }
  /** HR Overview (dashboard): every figure from the live records, each with the filter that opens the list behind it. */
  function overview(actor, { from, to, branchId, departmentId, locationType } = /** @type {any} */ ({})) {
    need(actor, 'hr.employee.view', 'see the HR overview');
    const today = todayIST(); const f = from ?? dayPlus(-30); const t = to ?? today;
    const w = ["e.company_id = ?", "e.record_status = 'APPROVED'", 'e.deleted_at IS NULL']; const a = [actor.companyId];
    if (branchId) { w.push('e.branch_id = ?'); a.push(branchId); } if (departmentId) { w.push('e.department_id = ?'); a.push(departmentId); } if (locationType) { w.push('e.location_type = ?'); a.push(locationType); }
    const W = w.join(' AND ');
    const n = (sql, ...x) => db.prepare(sql).get(...x).n;
    const live = `${W} AND e.employment_status IN ('ACTIVE', 'NOTICE')`;
    const group = (col, join, label) => db.prepare(`SELECT ${label} AS label, ${col} AS key, COUNT(*) AS n FROM hr_employees e ${join} WHERE ${live} GROUP BY ${col} ORDER BY n DESC, label LIMIT 15`).all(...a);
    const joiners = n(`SELECT COUNT(*) AS n FROM hr_employees e WHERE ${W} AND e.doj >= ? AND e.doj <= ?`, ...a, f, t);
    const leavers = n(`SELECT COUNT(*) AS n FROM hr_employees e WHERE ${W} AND e.employment_status IN ('SEPARATED', 'ABSCONDING') AND e.status_effective_date >= ? AND e.status_effective_date <= ?`, ...a, f, t);
    const headcount = n(`SELECT COUNT(*) AS n FROM hr_employees e WHERE ${live}`, ...a);
    const pendingActivations = n("SELECT COUNT(*) AS n FROM hr_employees WHERE company_id = ? AND record_status IN ('SUBMITTED', 'RETURNED') AND deleted_at IS NULL", actor.companyId);
    const pendingChanges = n("SELECT COUNT(*) AS n FROM hr_employee_changes WHERE company_id = ? AND change_status IN ('PENDING', 'RETURNED') AND deleted_at IS NULL", actor.companyId);
    const scheduled = n("SELECT COUNT(*) AS n FROM hr_employee_changes WHERE company_id = ? AND change_status = 'SCHEDULED' AND deleted_at IS NULL", actor.companyId);
    const noUser = n(`SELECT COUNT(*) AS n FROM hr_employees e WHERE ${live} AND e.user_id IS NULL`, ...a);
    const expired = n("SELECT COUNT(DISTINCT d.employee_id) AS n FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.valid_until < ? AND e.employment_status IN ('ACTIVE', 'NOTICE') AND e.record_status = 'APPROVED'", actor.companyId, today);
    const due = n("SELECT COUNT(DISTINCT d.employee_id) AS n FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.valid_until >= ? AND d.valid_until <= ? AND e.employment_status IN ('ACTIVE', 'NOTICE') AND e.record_status = 'APPROVED'", actor.companyId, today, dayPlus(param('hr.employee.expiry_warning_days', actor.companyId) ?? 30));
    const accessGaps = n(`SELECT COUNT(*) AS n FROM hr_employees e WHERE ${W} AND e.employment_status IN ('SEPARATED', 'ABSCONDING') AND e.access_note LIKE 'Access was NOT removed%'`, ...a);
    const attention = [];
    if (accessGaps) attention.push({ kind: 'ERROR', text: `${accessGaps} separated employee(s) still have access: remove it in User Management`, link: '/hr/employees?filter[status]=SEPARATED' });
    if (expired) attention.push({ kind: 'ERROR', text: `${expired} employee(s) have an expired document`, link: '/hr/employees' });
    if (due) attention.push({ kind: 'WARNING', text: `${due} employee(s) have a document that expires within ${param('hr.employee.expiry_warning_days', actor.companyId) ?? 30} days`, link: '/hr/employees' });
    if (noUser) attention.push({ kind: 'INFO', text: `${noUser} employee(s) have no user account yet`, link: '/hr/employees?filter[hasUser]=NO&filter[status]=ACTIVE' });
    return {
      period: { from: f, to: t }, asOf: today,
      tiles: [
        { key: 'headcount', label: 'Headcount', value: headcount, tone: 'neutral', hint: 'Active and on notice', to: '/hr/employees?filter[recordStatus]=APPROVED&filter[status]=ACTIVE,NOTICE' },
        { key: 'joiners', label: 'Joiners', value: joiners, tone: 'success', hint: `${f} to ${t}`, to: `/hr/employees?filter[doj][between]=${f},${t}` },
        { key: 'leavers', label: 'Leavers', value: leavers, tone: leavers ? 'warning' : 'neutral', hint: `${f} to ${t}`, to: '/hr/employees?filter[status]=SEPARATED,ABSCONDING' },
        { key: 'notice', label: 'On notice', value: n(`SELECT COUNT(*) AS n FROM hr_employees e WHERE ${W} AND e.employment_status = 'NOTICE'`, ...a), tone: 'warning', hint: 'Serving notice', to: '/hr/employees?filter[status]=NOTICE' },
        { key: 'pending', label: 'Waiting for approval', value: pendingActivations + pendingChanges, tone: pendingActivations + pendingChanges ? 'warning' : 'success', hint: `${pendingActivations} new, ${pendingChanges} changes`, to: '/hr/employees?filter[recordStatus]=SUBMITTED,RETURNED' },
        { key: 'scheduled', label: 'Changes scheduled', value: scheduled, tone: 'neutral', hint: 'Approved, on their date', to: '/hr/employees' },
      ],
      byDepartment: group('e.department_id', 'LEFT JOIN org_departments d ON d.id = e.department_id', "COALESCE(d.name, 'No department')"),
      bySite: db.prepare(`SELECT COALESCE(s.name, CASE e.location_type WHEN 'HO' THEN 'Head office' ELSE 'Site (not named)' END) AS label, COALESCE(e.site_id, 0) AS key, COUNT(*) AS n FROM hr_employees e LEFT JOIN org_sites s ON s.id = e.site_id WHERE ${live} GROUP BY COALESCE(e.site_id, 0), e.location_type ORDER BY n DESC LIMIT 15`).all(...a),
      byType: group('e.employment_type', '', 'e.employment_type').map((r) => ({ ...r, label: TYPE_LABELS[r.label] ?? r.label })),
      attention, recentJoiners: db.prepare(`SELECT e.id, e.emp_code AS code, e.full_name AS name, e.doj, d.name AS department FROM hr_employees e LEFT JOIN org_departments d ON d.id = e.department_id WHERE ${W} ORDER BY e.doj DESC, e.id DESC LIMIT 8`).all(...a),
      recentLeavers: db.prepare(`SELECT e.id, e.emp_code AS code, e.full_name AS name, e.status_effective_date AS date, e.employment_status AS status FROM hr_employees e WHERE ${W} AND e.employment_status IN ('SEPARATED', 'ABSCONDING') ORDER BY e.status_effective_date DESC LIMIT 8`).all(...a),
      mine: may(actor, 'hr.employee.queue') ? queue(actor).rows.filter((r) => r.mine).slice(0, 8) : [],
    };
  }
  function widget(actor) {
    const o = overview(actor, {});
    return { value: o.tiles[0].value, joiners: o.tiles[1].value, leavers: o.tiles[2].value, attention: o.attention.filter((x) => x.kind !== 'INFO').length };
  }
  /** The worklist: new employees and changes waiting for approval, documents about to expire, separations whose access could not be removed; oldest first against a 48-hour SLA. */
  function queue(actor, { kind } = /** @type {any} */ ({})) {
    need(actor, 'hr.employee.queue', 'see the HR worklist');
    const out = [];
    const age = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
    if (!kind || kind === 'ACTIVATION') for (const e of db.prepare("SELECT e.*, w.status AS wf FROM hr_employees e LEFT JOIN wf_instances w ON w.id = e.workflow_instance_id WHERE e.company_id = ? AND e.record_status IN ('SUBMITTED', 'RETURNED') AND e.deleted_at IS NULL").all(actor.companyId)) out.push({ kind: 'ACTIVATION', id: e.id, employeeId: e.id, code: e.emp_code, name: e.full_name, what: `New ${TYPE_LABELS[e.employment_type].toLowerCase()} employee, joining ${e.doj}`, by: e.requested_by, since: e.updated_at ?? e.created_at, ageHours: age(e.updated_at ?? e.created_at), instanceId: e.workflow_instance_id, returned: e.record_status === 'RETURNED' });
    if (!kind || kind === 'CHANGE') for (const c of db.prepare("SELECT c.*, e.emp_code, e.full_name FROM hr_employee_changes c JOIN hr_employees e ON e.id = c.employee_id WHERE c.company_id = ? AND c.change_status IN ('PENDING', 'RETURNED', 'SCHEDULED') AND c.deleted_at IS NULL").all(actor.companyId)) out.push({ kind: 'CHANGE', id: c.id, employeeId: c.employee_id, code: c.emp_code, name: c.full_name, what: `${CHANGE_LABELS[c.change_type]} from ${c.effective_date}${c.change_status === 'SCHEDULED' ? ' (approved, waiting for its date)' : ''}`, by: c.requested_by, since: c.created_at, ageHours: c.change_status === 'SCHEDULED' ? 0 : age(c.created_at), instanceId: c.workflow_instance_id, returned: c.change_status === 'RETURNED', scheduled: c.change_status === 'SCHEDULED' });
    if (!kind || kind === 'DOCUMENT') for (const d of db.prepare("SELECT d.*, e.emp_code, e.full_name FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.valid_until IS NOT NULL AND d.valid_until <= ? AND e.employment_status IN ('ACTIVE', 'NOTICE') AND e.record_status = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM hr_employee_documents n WHERE n.employee_id = d.employee_id AND n.doc_type = d.doc_type AND n.deleted_at IS NULL AND n.id != d.id AND (n.valid_until IS NULL OR n.valid_until > d.valid_until))").all(actor.companyId, dayPlus(param('hr.employee.expiry_warning_days', actor.companyId) ?? 30)))
      out.push({ kind: 'DOCUMENT', id: d.id, employeeId: d.employee_id, code: d.emp_code, name: d.full_name, what: `${DOC_LABELS[d.doc_type]} ${d.valid_until < todayIST() ? 'expired' : 'expires'} on ${d.valid_until}`, by: d.created_by, since: d.valid_until, ageHours: d.valid_until < todayIST() ? age(`${d.valid_until}T00:00:00Z`) : 0, expired: d.valid_until < todayIST() });
    if (!kind || kind === 'ACCESS') for (const e of db.prepare("SELECT * FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND employment_status IN ('SEPARATED', 'ABSCONDING') AND access_note LIKE 'Access was NOT removed%'").all(actor.companyId)) out.push({ kind: 'ACCESS', id: e.id, employeeId: e.id, code: e.emp_code, name: e.full_name, what: e.access_note, by: 'system', since: e.status_effective_date, ageHours: age(`${e.status_effective_date}T00:00:00Z`), expired: true });
    const mine = new Set((workflowOf(db).listTasks?.(actor, { mine: 'assigned', limit: 200 })?.rows ?? []).map((t) => t.instance?.id));
    const rows = out.map((x) => ({ ...x, tone: x.expired || x.ageHours >= 96 ? 'error' : x.ageHours >= 48 ? 'warning' : 'neutral', mine: Boolean(x.instanceId && mine.has(x.instanceId)) })).sort((a, b) => Number(b.mine) - Number(a.mine) || b.ageHours - a.ageHours);
    const counts = {}; for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return { rows, counts };
  }
  /** Active employees for the lookups of other forms (reporting manager, deployment, attendance): code, name, designation. */
  function lookup(actor, { q, limit, offset = 0, ids = null }) {
    if (!may(actor, 'hr.employee.view') && !may(actor, 'hr.employee.team.view')) throw forbidden('You may not see employees (permission hr.employee.team.view).');
    const sc = listScope(actor);
    const where = [sc.scopeSql, "e.record_status = 'APPROVED'", "e.employment_status IN ('ACTIVE', 'NOTICE')", 'e.deleted_at IS NULL'];
    /** @type {Record<string, any>} */
    const args = { ...sc.params };
    if (q) { where.push('(e.emp_code LIKE :q1 OR e.full_name LIKE :q2)'); args.q1 = `${q}%`; args.q2 = `%${q}%`; }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM hr_employees e WHERE ${where.join(' AND ')}`).get(args).n;
    const rows = db.prepare(`SELECT e.id, e.emp_code, e.full_name, g.name AS designation FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id WHERE ${where.join(' AND ')} ORDER BY e.full_name LIMIT :limit OFFSET :offset`).all({ ...args, limit, offset });
    const picked = ids ? rows.filter((r) => ids.includes(r.id)) : rows;
    return { rows: picked.map((r) => ({ id: r.id, code: r.emp_code, name: r.full_name, extra: { designation: r.designation ?? '' } })), total };
  }
  /** A printable page (HTML) of the employee profile; sensitive data only for those who may see it. Printing is in the audit trail. */
  function print(actor, id) {
    need(actor, 'hr.employee.print', 'print employees');
    const v = view(actor, row(actor, id), { full: true });
    writeAudit(db, { entity: 'hr_employees', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
    const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const kv = (rows) => `<table>${rows.map(([k, x]) => `<tr><th>${e(k)}</th><td>${e(x)}</td></tr>`).join('')}</table>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.code)} ${e(v.name)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:12px}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:26%;background:#f3f5f7}h2{margin:14px 0 4px}</style></head><body>
<h1>Employee ${e(v.code)} · ${e(v.name)}</h1><p>${e(v.statusLabel)} · ${e(v.employmentStatusLabel)}${v.masked ? ' · statutory and bank details are masked' : ''}</p>
<h2>Personal</h2>${kv([['Name', v.name], ['Gender', v.gender], ['Date of birth', v.dob], ['Blood group', v.bloodGroup], ['Marital status', v.maritalStatus], ['Mobile', v.mobile], ['E-mail', v.email]])}
<h2>Employment</h2>${kv([['Department', v.department], ['Designation', v.designation], ['Grade', v.grade], ['Type', v.employmentTypeLabel], ['Date of joining', v.doj], ['Confirmation', v.confirmationDate], ['Reports to', v.manager ? `${v.manager.emp_code} ${v.manager.full_name}` : null], ['Cost centre', v.costCentre], ['Work location', v.locationType === 'SITE' ? `Site ${v.site ?? v.project ?? ''}` : 'Head office']])}
<h2>Statutory</h2>${kv(v.statutory ? [['PAN', v.statutory.pan], ['Aadhaar', v.statutory.aadhaar], ['UAN', v.statutory.uan], ['ESIC IP', v.statutory.esicIp], ['PF', v.statutory.pfApplicable ? 'Yes' : 'No'], ['ESI', v.statutory.esiApplicable ? 'Yes' : 'No'], ['PT state', v.statutory.ptState], ['LWF state', v.statutory.lwfState]] : [['Statutory', 'none']])}
<h2>Bank</h2>${kv(v.banks.slice(0, 1).map((b) => [`${b.bankName ?? b.ifsc}`, `${b.account} (${b.status.toLowerCase().replace(/_/g, ' ')}, ${b.verified.toLowerCase()})`]))}
<h2>History</h2>${kv(v.history.map((h) => [`${h.effectiveDate} ${h.event.replace(/_/g, ' ').toLowerCase()}`, `${Object.entries(h.to).map(([k, x]) => `${k}: ${x}`).join('; ')}`]))}
<p>Printed ${e(nowIso())} by ${e(actor.user)}.</p></body></html>`;
  }

  return { registration, amendments, details, banks, userLink, decisions, register, get, me, history, overview, widget, queue, lookup, print, cycle, seesSensitive, access, row };
}

const services = new WeakMap();
export const bindEmployees = (db, s) => services.set(db, s);
export const employeesOf = (db) => services.get(db) ?? null;

// ---- workflow definitions (the chains are seeded in the approval matrix as well, 04.02) ----
const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (fn) => ({
  onApproved: (db, { instance, actor }) => employeesOf(db)?.decisions[fn](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => employeesOf(db)?.decisions[fn](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => employeesOf(db)?.decisions[fn](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => employeesOf(db)?.decisions[fn](instance, actor, 'CANCELLED', comment),
});
const employeeRef = (db, companyId, id) => db.prepare('SELECT emp_code, full_name, requested_by FROM hr_employees WHERE id = ? AND company_id = ?').get(Number(id), companyId);
workflowTypes.register({
  docType: EMP_DOC, label: 'New employee activation', processOwner: 'HRMGR', route: (id) => `/hr/employees/employee?id=${id}`,
  describe(db, companyId, id) { const e = employeeRef(db, companyId, id); return e ? { ref: e.emp_code, title: e.full_name, originator: e.requested_by } : null; },
  summarise(db, _actor, id) {
    const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(id));
    if (!e) return null;
    return { fields: [{ label: 'Employee', value: `${e.emp_code} ${e.full_name}` }, { label: 'Department', value: db.prepare('SELECT name FROM org_departments WHERE id = ?').get(e.department_id)?.name ?? '—' }, { label: 'Designation', value: `${db.prepare('SELECT name FROM org_designations WHERE id = ?').get(e.designation_id)?.name ?? '—'}${e.grade ? ` (${e.grade})` : ''}` }, { label: 'Type', value: TYPE_LABELS[e.employment_type] }, { label: 'Joining', value: e.doj }, { label: 'Work location', value: e.location_type === 'SITE' ? 'Site' : 'Head office' }] };
  },
  defaultDefinition: { name: 'New employee: HR manager (the HR executive who entered it cannot approve)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('HRMGR', 'HR manager', 'HRMGR')] },
  hooks: hooks('employee'),
});
const changeType = (docType, label, steps) => workflowTypes.register({
  docType, label, processOwner: 'HRMGR', route: () => '/hr/employees',
  describe(db, companyId, id) { const c = db.prepare('SELECT c.*, e.emp_code, e.full_name FROM hr_employee_changes c JOIN hr_employees e ON e.id = c.employee_id WHERE c.id = ? AND c.company_id = ?').get(Number(id), companyId); return c ? { ref: `${c.emp_code} ${CHANGE_LABELS[c.change_type].toLowerCase()}`, title: c.full_name, originator: c.requested_by } : null; },
  summarise(db, _actor, id) {
    const c = db.prepare('SELECT c.*, e.emp_code, e.full_name FROM hr_employee_changes c JOIN hr_employees e ON e.id = c.employee_id WHERE c.id = ?').get(Number(id));
    if (!c) return null;
    const sum = json(c.summary_json, {}); const bef = json(c.before_json, {});
    return { fields: [{ label: 'Employee', value: `${c.emp_code} ${c.full_name}` }, { label: 'Change', value: CHANGE_LABELS[c.change_type] }, { label: 'From', value: c.effective_date }, ...Object.keys(sum).map((k) => ({ label: k, value: `${bef[k] ?? '—'} → ${sum[k]}` })), { label: 'Reason', value: c.reason }, { label: 'Asked by', value: `${c.requested_by}${c.requested_self ? ' (the employee)' : ''}` }] };
  },
  defaultDefinition: { name: label, settings: { resubmit: 'first', distinctApprovers: true }, steps },
  hooks: hooks('change'),
});
changeType(CHANGE_DOCS.PROFILE, 'Change of personal details: HR manager', [step('HRMGR', 'HR manager', 'HRMGR')]);
changeType(CHANGE_DOCS.STATUTORY, 'Change of statutory details: HR manager', [step('HRMGR', 'HR manager', 'HRMGR')]);
changeType(CHANGE_DOCS.BANK, 'Change of bank account: HR manager, then payroll verification', [step('HRMGR', 'HR manager', 'HRMGR'), step('PAY', 'Payroll verification', 'PAY')]);
changeType(CHANGE_DOCS.EMPLOYMENT, 'Designation, grade or manager change: HR manager (senior grades also the director)', [step('HRMGR', 'HR manager', 'HRMGR'), step('DIR', 'Director (senior grades)', 'DIR', { field: 'band', op: 'eq', value: 'SENIOR' })]);
changeType(CHANGE_DOCS.SEPARATION, 'Separation, notice or absconding: HR manager', [step('HRMGR', 'HR manager', 'HRMGR')]);

evidenceProviders.register(EMP_DOC, ({ db, instance }) => {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(instance.docId));
  if (!e) return { sections: [] };
  const st = db.prepare('SELECT pan_last4, aadhaar_last4, uan FROM hr_employee_statutory WHERE employee_id = ? AND deleted_at IS NULL').get(e.id);
  const bank = db.prepare("SELECT account_last4, ifsc FROM hr_employee_banks WHERE employee_id = ? AND bank_status = 'PENDING_APPROVAL' AND deleted_at IS NULL").get(e.id);
  const docs = db.prepare('SELECT doc_type FROM hr_employee_documents WHERE employee_id = ? AND deleted_at IS NULL').all(e.id).map((d) => DOC_LABELS[d.doc_type]);
  const emerg = db.prepare("SELECT COUNT(*) AS n FROM hr_employee_contacts WHERE employee_id = ? AND contact_type = 'EMERGENCY' AND deleted_at IS NULL").get(e.id).n;
  const same = db.prepare("SELECT emp_code FROM hr_employees WHERE company_id = ? AND id != ? AND mobile = ? AND deleted_at IS NULL AND record_status NOT IN ('CANCELLED', 'REJECTED')").all(e.company_id, e.id, e.mobile);
  return { sections: [{ code: 'hr-employee', title: 'What the approver checks', kind: 'metrics', items: [
    { label: 'PAN on file', value: st?.pan_last4 ? 'Yes (valid format)' : 'Missing', format: 'text', tone: st?.pan_last4 ? undefined : 'warn' }, { label: 'Aadhaar reference', value: st?.aadhaar_last4 ? `ending ${st.aadhaar_last4}` : 'none', format: 'text' },
    { label: 'Bank account', value: bank ? `ending ${bank.account_last4}, ${bank.ifsc}` : 'none given', format: 'text', tone: bank ? undefined : 'warn' }, { label: 'Emergency contacts', value: emerg, format: 'text', tone: emerg ? undefined : 'warn' },
    { label: 'Documents', value: docs.join(', ') || 'none yet', format: 'text' }, { label: 'Other employees with this mobile', value: same.map((x) => x.emp_code).join(', ') || 'None', format: 'text', tone: same.length ? 'warn' : undefined }] }] };
});
objectTypes.register({
  type: 'hr_employee', label: 'Employee', permission: 'hr.employee.team.view', route: (id) => `/hr/employees/employee?id=${id}`,
  access(db, actor, id) { const e = employeesOf(db); if (!e) return null; try { const r = e.row(actor, Number(id)); return { companyId: r.company_id, projectId: r.project_id ?? null, siteId: r.site_id ?? null, status: r.record_status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'hr_employees', id }],
  summary(db, actor, id) { const e = employeesOf(db); if (!e) return null; try { const r = e.row(actor, Number(id)); return { label: `${r.emp_code} ${r.full_name}`, status: r.record_status }; } catch { return null; } },
  search(db, actor, q, limit) {
    const a = authzOf(db);
    if (!a.check(actor, 'hr.employee.view').allowed) return [];
    return db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status NOT IN ('CANCELLED', 'REJECTED') AND (emp_code LIKE ? OR full_name LIKE ?) ORDER BY full_name LIMIT ?").all(actor.companyId, `${q}%`, `%${q}%`, limit);
  },
});
fileEntities.register({
  entity: 'hr_employee', label: 'Employee (photo, identity, address and education documents)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, user_id, project_id, site_id FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!r) return null;
    const a = authzOf(db);
    const uid = actor.userId ?? db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?)').get(actor.companyId, actor.user)?.id;
    const own = r.user_id != null && r.user_id === uid;
    const hr = a.check(actor, 'hr.employee.view').allowed;
    return { companyId: r.company_id, projectId: null, siteId: null, canView: hr || own, canEdit: a.check(actor, 'hr.employee.edit').allowed || own, locked: false };
  },
});
