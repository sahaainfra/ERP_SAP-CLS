import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { addDays } from './att-calc.js';
import { attendanceOf } from './attendance.js';
import { registerLeaveSource, registerOf } from './att-register.js';
import { DEFAULT_TYPES, accrualsFor, countDays, withDefaults, yearEnd } from './lv-calc.js';

// Leave management (part 07.07). Types and their rules per company; what a person earns (accrual, pro-rata for a joiner, comp-off from work on a day off) and spends is a ledger, and the balance of a person, a type and a year
// is always the sum of its ledger (FR-05). An application is approval-controlled: the reporting manager, and the HR manager for more than 10 days or a special type. When it is approved the ledger is charged, the attendance register
// shows the days as leave (BR-03), and the approver of a person who is away is delegated to someone for the days. Cancelling reverses all of it. Year-end carries forward, encashes and lapses (FR-08).
export const LEAVE_DOC = 'HR_LEAVE';
export const ADJUST_DOC = 'HR_LV_ADJUST';
export const STATUS_LABELS = { DRAFT: 'Draft', SUBMITTED: 'In approval', APPROVED: 'Approved', RETURNED: 'Returned', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const EXTENDED_DAYS = 10;
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const r2 = (n) => Math.round(n * 100) / 100;
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const OWN = new Set(['view', 'create', 'edit', 'delete', 'submit', 'cancel', 'amend', 'print']);

export const applicationList = defineList({
  code: 'hr.leave_applications', label: 'Leave applications', permission: 'hr.application.view',
  from: 'lv_applications x JOIN hr_employees e ON e.id = x.employee_id JOIN lv_types t ON t.id = x.leave_type_id LEFT JOIN org_sites s ON s.id = x.doc_site_id',
  where: "x.deleted_at IS NULL AND x.status != 'SUPERSEDED'", searchable: ['x.doc_no', 'e.full_name', 'e.emp_code', 't.name'], defaultSort: '-fromDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Application' }, revision: { sql: 'x.revision_no', type: 'number', label: 'Revision' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' },
    type: { sql: 't.name', type: 'text', label: 'Leave type' }, typeCode: { sql: 't.code', type: 'text', label: 'Type code' }, fromDate: { sql: 'x.from_date', type: 'date', label: 'From' }, toDate: { sql: 'x.to_date', type: 'date', label: 'To' },
    days: { sql: 'x.days', type: 'number', label: 'Days' }, site: { sql: 's.name', type: 'text', label: 'Site' }, siteId: { sql: 'x.doc_site_id', type: 'number', label: 'Site id' },
    band: { sql: 'x.band', type: 'text', label: 'Band' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS_LABELS) }, reason: { sql: 'x.reason', type: 'text', label: 'Reason' },
    updatedAt: { sql: 'COALESCE(x.updated_at, x.created_at)', type: 'datetime', label: 'Changed' },
  },
});
export const balanceList = defineList({
  code: 'lv.balances', label: 'Leave balances', permission: 'lv.team.view',
  from: 'lv_entitlements n JOIN hr_employees e ON e.id = n.employee_id JOIN lv_types t ON t.id = n.leave_type_id LEFT JOIN org_departments d ON d.id = e.department_id',
  where: 'n.deleted_at IS NULL', searchable: ['e.full_name', 'e.emp_code', 't.name'], defaultSort: 'employee',
  columns: {
    code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, department: { sql: 'd.name', type: 'text', label: 'Department' }, departmentId: { sql: 'e.department_id', type: 'number', label: 'Department id' },
    type: { sql: 't.name', type: 'text', label: 'Leave type' }, typeCode: { sql: 't.code', type: 'text', label: 'Type code' }, year: { sql: 'n.year', type: 'number', label: 'Year' },
    opening: { sql: 'n.opening', type: 'number', label: 'Opening', total: true }, accrued: { sql: 'n.accrued', type: 'number', label: 'Accrued', total: true }, adjusted: { sql: 'n.adjusted', type: 'number', label: 'Adjusted', total: true },
    availed: { sql: 'n.availed', type: 'number', label: 'Availed', total: true }, lapsed: { sql: 'n.lapsed', type: 'number', label: 'Lapsed', total: true }, encashed: { sql: 'n.encashed', type: 'number', label: 'Encashed', total: true },
    remaining: { sql: 'n.remaining', type: 'number', label: 'Balance', total: true },
  },
});

export function createLeaveService({ db, dep }) {
  const authz = authzOf(db);
  const { may, need, nextDoc, event, usernameOf, myEmployee, root, orgName } = dep;
  const att = () => attendanceOf(db);
  const notif = notificationsOf(db);
  const siteRow = (id) => (id ? db.prepare('SELECT id, name, org_project_id AS project_id FROM org_sites WHERE id = ?').get(id) : null);
  const scopeOf = (siteId) => { const s = siteRow(siteId); return s ? { projectId: s.project_id, siteId: s.id } : undefined; };
  const emp = (id) => db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(id);
  const empName = (id) => db.prepare('SELECT full_name AS n, emp_code AS c FROM hr_employees WHERE id = ?').get(id);
  const maker = (actor, r) => same(r.created_by, actor.user);
  const systemActor = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });
  const yearOf = (d) => Number(d.slice(0, 4));

  // ------------------------------------------------------------------ leave types (FR-01)
  const typeView = (t) => ({ id: t.id, code: t.code, name: t.name, paid: t.paid === 1, status: t.status, sortOrder: t.sort_order, rules: withDefaults(json(t.rules_json, {})), rowVersion: t.version });
  function ensureTypes(companyId) {
    if (db.prepare('SELECT 1 FROM lv_types WHERE company_id = ? LIMIT 1').get(companyId)) return;
    for (const t of DEFAULT_TYPES) db.prepare("INSERT OR IGNORE INTO lv_types (company_id, code, name, paid, rules_json, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'system', 'lv_default')").run(companyId, t.code, t.name, t.paid, JSON.stringify(t.rules), t.sort);
  }
  const typeRow = (companyId, id) => { ensureTypes(companyId); const t = db.prepare('SELECT * FROM lv_types WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!t) throw notFound('That leave type does not exist.'); return t; };
  const types = {
    list(actor) { need(actor, 'lv.type.view', 'see leave types'); ensureTypes(actor.companyId); return db.prepare('SELECT * FROM lv_types WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort_order, code').all(actor.companyId).map(typeView); },
    /** The types a person may choose from (any signed-in person with the right to apply). */
    options(actor, employeeId) {
      ensureTypes(actor.companyId);
      const e = employeeId ? emp(employeeId) : null;
      return db.prepare("SELECT * FROM lv_types WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY sort_order, code").all(actor.companyId).map(typeView).filter((t) => !e || appliesTo(t.rules, e));
    },
    create(actor, b) {
      need(actor, 'lv.type.edit', 'change leave types'); ensureTypes(actor.companyId);
      if (db.prepare('SELECT 1 FROM lv_types WHERE company_id = ? AND code = ? COLLATE NOCASE').get(actor.companyId, b.code)) throw conflict(`The code ${b.code} is used already.`);
      const id = Number(db.prepare("INSERT INTO lv_types (company_id, code, name, paid, rules_json, status, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lv_type')").run(actor.companyId, b.code.toUpperCase(), b.name, b.paid ? 1 : 0, JSON.stringify(b.rules), b.status ?? 'ACTIVE', b.sortOrder ?? 100, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'lv_types', entityId: id, action: 'create', newValues: b, actor: actor.user, companyId: actor.companyId });
      return typeView(typeRow(actor.companyId, id));
    },
    update(actor, id, b) {
      need(actor, 'lv.type.edit', 'change leave types'); const t = typeRow(actor.companyId, id);
      if (t.version !== b.version) throw conflict('This leave type was changed by someone else. Reload it and try again.');
      db.prepare('UPDATE lv_types SET name = ?, paid = ?, rules_json = ?, status = ?, sort_order = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name, b.paid ? 1 : 0, JSON.stringify(b.rules), b.status, b.sortOrder ?? t.sort_order, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lv_types', entityId: id, action: 'update', oldValues: { rules: json(t.rules_json, {}), paid: t.paid }, newValues: { rules: b.rules, paid: b.paid, status: b.status }, actor: actor.user, companyId: actor.companyId });
      return typeView(typeRow(actor.companyId, id));
    },
  };
  /** May this person take this type at all (gender, employment category)? */
  const appliesTo = (rules, e) => (!rules.genders.length || rules.genders.includes(e.gender)) && (!rules.categories.length || rules.categories.includes(e.employment_type));

  // ------------------------------------------------------------------ the ledger and the balances (FR-05)
  function rollup(companyId, employeeId, typeId, year) {
    const sum = (types2) => db.prepare(`SELECT COALESCE(SUM(days), 0) AS d FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ? AND deleted_at IS NULL AND txn_type IN (${types2.map(() => '?').join(',')})`).get(companyId, employeeId, typeId, year, ...types2).d;
    const v = { opening: r2(sum(['OPENING'])), accrued: r2(sum(['ACCRUAL', 'COMP_OFF'])), adjusted: r2(sum(['ADJUSTMENT'])), availed: r2(-sum(['AVAILED', 'REVERSAL'])), lapsed: r2(-sum(['LAPSED'])), encashed: r2(-sum(['ENCASHED'])) };
    v.remaining = r2(v.opening + v.accrued + v.adjusted - v.availed - v.lapsed - v.encashed);
    const e = emp(employeeId);
    const ex = db.prepare('SELECT id FROM lv_entitlements WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ?').get(companyId, employeeId, typeId, year);
    if (ex) db.prepare('UPDATE lv_entitlements SET opening = ?, accrued = ?, adjusted = ?, availed = ?, lapsed = ?, encashed = ?, remaining = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v.opening, v.accrued, v.adjusted, v.availed, v.lapsed, v.encashed, v.remaining, nowIso(), ex.id);
    else db.prepare("INSERT INTO lv_entitlements (company_id, employee_id, leave_type_id, year, opening, accrued, adjusted, availed, lapsed, encashed, remaining, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'lv_ledger')").run(companyId, employeeId, typeId, year, v.opening, v.accrued, v.adjusted, v.availed, v.lapsed, v.encashed, v.remaining, e?.project_id ?? null, e?.site_id ?? null);
    return v;
  }
  /** One movement; with a `key` it happens once (a second try is answered with false). */
  function post(companyId, { employeeId, typeId, year, date, type, days, refType = null, refId = null, key = null, expiresOn = null, note = null, by = 'system' }) {
    if (!days) return false;
    if (key && db.prepare('SELECT 1 FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND ref_key = ?').get(companyId, employeeId, typeId, key)) return false;
    db.prepare('INSERT INTO lv_ledger (company_id, employee_id, leave_type_id, year, txn_date, txn_type, days, ref_type, ref_id, ref_key, expires_on, note, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, employeeId, typeId, year, date, type, r2(days), refType, refId, key, expiresOn, note, by, refType ?? 'lv_ledger');
    rollup(companyId, employeeId, typeId, year);
    return true;
  }
  const remainingOf = (c, e, t, y) => db.prepare("SELECT COALESCE(SUM(days), 0) AS d FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ? AND deleted_at IS NULL").get(c, e, t, y).d;
  const reservedOf = (c, e, t, y, exceptRoot = 0) => db.prepare("SELECT COALESCE(SUM(days), 0) AS d FROM lv_applications WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND leave_year = ? AND status = 'SUBMITTED' AND deleted_at IS NULL AND COALESCE(root_id, id) != ?").get(c, e, t, y, exceptRoot).d;
  const balances = {
    /** What a person has, type by type, for a year: the balance, what is waiting for approval, and what can still be asked for. */
    of(actor, employeeId, year = yearOf(todayIST())) {
      const e = emp(employeeId);
      if (!e || e.company_id !== actor.companyId) throw notFound('That employee does not exist.');
      if (employeeId !== myEmployee(actor)) need(actor, 'lv.team.view', 'see the leave balances of others', e.site_id ? scopeOf(e.site_id) : undefined);
      ensureTypes(actor.companyId);
      return db.prepare("SELECT * FROM lv_types WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY sort_order, code").all(actor.companyId).map(typeView).filter((t) => appliesTo(t.rules, e)).map((t) => {
        const v = rollup(actor.companyId, employeeId, t.id, year); const reserved = r2(reservedOf(actor.companyId, employeeId, t.id, year));
        return { typeId: t.id, code: t.code, name: t.name, paid: t.paid, year, ...v, reserved, available: r2(v.remaining - reserved), advanceMax: t.rules.advanceMax };
      });
    },
    ledger(actor, employeeId, { typeId, year }) {
      const e = emp(employeeId);
      if (!e || e.company_id !== actor.companyId) throw notFound('That employee does not exist.');
      if (employeeId !== myEmployee(actor)) need(actor, 'lv.team.view', 'see the leave ledger of others', e.site_id ? scopeOf(e.site_id) : undefined);
      return db.prepare(`SELECT l.*, t.code AS type_code FROM lv_ledger l JOIN lv_types t ON t.id = l.leave_type_id WHERE l.company_id = ? AND l.employee_id = ? AND l.deleted_at IS NULL${typeId ? ' AND l.leave_type_id = ?' : ''}${year ? ' AND l.year = ?' : ''} ORDER BY l.txn_date, l.id`)
        .all(...[actor.companyId, employeeId, ...(typeId ? [typeId] : []), ...(year ? [year] : [])]).map((l) => ({ id: l.id, date: l.txn_date, year: l.year, type: l.txn_type, typeCode: l.type_code, days: l.days, refType: l.ref_type, refId: l.ref_id, expiresOn: l.expires_on, note: l.note, by: l.created_by }));
    },
    list(actor, query) {
      need(actor, 'lv.team.view', 'see leave balances');
      return runList(db, balanceList, parseListRequest(balanceList, query), { select: BAL_SELECT, scopeSql: balScope(actor), params: { c: actor.companyId }, tieBreaker: 'n.id', map: balPresent });
    },
    exportSource(actor, req) {
      need(actor, 'hr.application.export', 'export leave balances');
      const opts = { select: BAL_SELECT, scopeSql: balScope(actor), params: { c: actor.companyId }, tieBreaker: 'n.id' };
      return { title: balanceList.label, permission: 'hr.application.export', personal: false, columns: Object.entries(balanceList.columns).filter(([k]) => !['departmentId', 'typeCode'].includes(k)).map(([key, c]) => ({ key, label: c.label, type: c.type })), count: () => countList(db, balanceList, req, opts), rows: () => runList(db, balanceList, req, { ...opts, limit: null, map: balPresent }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${balanceList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
  };
  const BAL_SELECT = 'n.*, e.emp_code AS emp_code, e.full_name AS employee_name, d.name AS department_name, t.name AS type_name, t.code AS type_code';
  const balScope = (actor) => `n.company_id = :c AND ${authz.scopeFilter(actor, 'lv.team.view', { project: 'e.project_id', site: 'e.site_id' }).sql}`;
  const balPresent = (n) => ({ id: n.id, employeeId: n.employee_id, code: n.emp_code, employee: n.employee_name, department: n.department_name, type: n.type_name, typeCode: n.type_code, year: n.year, opening: n.opening, accrued: n.accrued, adjusted: n.adjusted, availed: n.availed, lapsed: n.lapsed, encashed: n.encashed, remaining: n.remaining });

  // ------------------------------------------------------------------ accrual, comp-off, lapse (FR-02, FR-06)
  /** Credits what people earn in each month from `from` to `to` (a month is credited once, so a second run adds nothing); a joiner in mid-month is pro-rated. */
  function accrue(companyId, from, to) {
    ensureTypes(companyId);
    const tys = db.prepare("SELECT * FROM lv_types WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'").all(companyId).map(typeView).filter((t) => t.rules.quota > 0 && t.rules.accrual !== 'NONE');
    const out = { credited: 0, people: new Set() };
    for (let y = yearOf(from), m = Number(from.slice(5, 7)); y < yearOf(to) || (y === yearOf(to) && m <= Number(to.slice(5, 7))); m += 1) {
      if (m > 12) { m = 1; y += 1; }
      const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
      const people = db.prepare("SELECT * FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND doj <= ? AND (last_working_date IS NULL OR last_working_date >= ?)").all(companyId, monthEnd, `${y}-${String(m).padStart(2, '0')}-01`);
      for (const e of people) for (const t of tys) {
        if (!appliesTo(t.rules, e)) continue;
        for (const a of accrualsFor({ rules: t.rules, doj: e.doj, year: y, month: m })) {
          if (post(companyId, { employeeId: e.id, typeId: t.id, year: y, date: `${y}-${String(m).padStart(2, '0')}-01`, type: 'ACCRUAL', days: a.days, key: `acc:${a.key}`, note: `Accrual ${a.key}`, refType: 'lv_accrual' })) { out.credited += 1; out.people.add(e.id); }
        }
      }
    }
    return { credited: out.credited, people: out.people.size };
  }
  /** Comp-off earned by working on a holiday or weekly off (the register gives it, 07.06): credited once per day, valid for the days of the type. */
  function creditCompOff(companyId, from, to) {
    ensureTypes(companyId);
    const co = db.prepare("SELECT * FROM lv_types WHERE company_id = ? AND code = 'CO' AND deleted_at IS NULL").get(companyId); if (!co) return { credited: 0 };
    const rules = withDefaults(json(co.rules_json, {})); let credited = 0;
    for (const d of db.prepare("SELECT id, person_id, work_date, comp_off FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND comp_off > 0 AND work_date BETWEEN ? AND ? AND deleted_at IS NULL").all(companyId, from, to)) {
      if (post(companyId, { employeeId: d.person_id, typeId: co.id, year: yearOf(d.work_date), date: d.work_date, type: 'COMP_OFF', days: d.comp_off, key: `att_daily:${d.id}`, expiresOn: addDays(d.work_date, rules.expiryDays ?? 60), note: 'Worked on a day off', refType: 'att_daily', refId: d.id })) credited += 1;
    }
    return { credited };
  }
  /** Comp-off not used by the day it expires lapses: what was earned and has expired, less what was used, less what has lapsed already. */
  function lapseCompOff(companyId, asOf) {
    const co = db.prepare("SELECT id FROM lv_types WHERE company_id = ? AND code = 'CO' AND deleted_at IS NULL").get(companyId); if (!co) return { lapsed: 0 };
    let lapsed = 0;
    for (const p of db.prepare("SELECT DISTINCT employee_id FROM lv_ledger WHERE company_id = ? AND leave_type_id = ? AND txn_type = 'COMP_OFF' AND expires_on < ?").all(companyId, co.id, asOf)) {
      const g = (q, ...a) => db.prepare(q).get(companyId, p.employee_id, co.id, ...a).d;
      const expired = g("SELECT COALESCE(SUM(days), 0) AS d FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND txn_type = 'COMP_OFF' AND expires_on < ?", asOf);
      const used = -g("SELECT COALESCE(SUM(days), 0) AS d FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND txn_type IN ('AVAILED', 'REVERSAL')");
      const done = -g("SELECT COALESCE(SUM(days), 0) AS d FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND txn_type = 'LAPSED' AND ref_type = 'lv_comp_off'");
      const due = r2(expired - used - done);
      if (due > 0 && post(companyId, { employeeId: p.employee_id, typeId: co.id, year: yearOf(asOf), date: asOf, type: 'LAPSED', days: -due, refType: 'lv_comp_off', key: `colapse:${asOf}`, note: 'Comp-off expired' })) lapsed += 1;
    }
    return { lapsed };
  }
  const daily = (companyId) => { const t = todayIST(); const a = accrue(companyId, `${yearOf(t)}-${t.slice(5, 7)}-01`, t); const c = creditCompOff(companyId, addDays(t, -30), t); const l = lapseCompOff(companyId, t); return { ...a, compOff: c.credited, lapsed: l.lapsed }; };

  // ------------------------------------------------------------------ applying for leave (FR-03)
  const typeById = (c, id) => typeView(typeRow(c, id));
  /** Everything the form and the service need to know before saving: the days (holidays and weekly offs aside), the balance, the problems, and the people of the team away on the same days. */
  function check(actor, b, ignoreRoot = 0) {
    const c = actor.companyId; const problems = [];
    const e = emp(b.employeeId);
    if (!e || e.company_id !== c || e.record_status !== 'APPROVED') { problems.push({ field: 'employeeId', message: 'That is not an employee' }); return { problems }; }
    const t = typeById(c, b.leaveTypeId);
    if (t.status !== 'ACTIVE') problems.push({ field: 'leaveTypeId', message: 'That leave type is not in use' });
    if (!appliesTo(t.rules, e)) problems.push({ field: 'leaveTypeId', message: `${t.name} does not apply to this employee` });
    if (b.toDate < b.fromDate) problems.push({ field: 'toDate', message: 'The end is before the start' });
    if (yearOf(b.fromDate) !== yearOf(b.toDate)) problems.push({ field: 'toDate', message: 'A leave stays within one calendar year: apply for each year separately' });
    if (b.fromDate < e.doj) problems.push({ field: 'fromDate', message: 'The person had not joined yet' });
    if (b.halfDay !== 'NONE' && !t.rules.allowHalfDay) problems.push({ field: 'halfDay', message: `${t.name} cannot be taken in halves` });
    const service = Math.floor((Date.parse(b.fromDate) - Date.parse(e.doj)) / 86_400_000);
    if (t.rules.minServiceDays && service < t.rules.minServiceDays) problems.push({ field: 'fromDate', message: `${t.name} needs ${t.rules.minServiceDays} days of service` });
    if (problems.length) return { problems, type: t };
    const facts = att().facts(c);
    const dayType = (d) => { try { const r = att().resolveFor(c, e.id, d, facts); return r.dayType === 'WORKING' ? 'WORKING' : r.dayType === 'HOLIDAY' ? 'HOLIDAY' : 'WEEKLY_OFF'; } catch { return 'WORKING'; } };
    const calc = countDays({ from: b.fromDate, to: b.toDate, half: b.halfDay, dayType, sandwich: t.rules.sandwich });
    if (calc.error) { problems.push({ field: 'fromDate', message: calc.error }); return { problems, type: t, calc }; }
    if (t.rules.maxConsecutive && calc.days > t.rules.maxConsecutive) problems.push({ field: 'toDate', message: `${t.name} is at most ${t.rules.maxConsecutive} days at a time` });
    if (t.rules.documentAfterDays != null && calc.days > t.rules.documentAfterDays && !b.attachmentFileId) problems.push({ field: 'attachmentFileId', message: `A certificate is needed for ${t.name} of more than ${t.rules.documentAfterDays} days` });
    const overlap = db.prepare("SELECT doc_no FROM lv_applications WHERE company_id = ? AND employee_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND from_date <= ? AND to_date >= ? AND COALESCE(root_id, id) != ?").get(c, e.id, b.toDate, b.fromDate, ignoreRoot);
    if (overlap) problems.push({ field: 'fromDate', message: `${overlap.doc_no} already covers some of these days` });
    const year = yearOf(b.fromDate);
    const credit = ignoreRoot ? db.prepare("SELECT COALESCE(SUM(days), 0) AS d FROM lv_applications WHERE company_id = ? AND COALESCE(root_id, id) = ? AND status = 'APPROVED' AND leave_type_id = ? AND leave_year = ?").get(c, ignoreRoot, t.id, year).d : 0;
    const remaining = remainingOf(c, e.id, t.id, year) + credit; const reserved = reservedOf(c, e.id, t.id, year, ignoreRoot);
    const available = r2(remaining - reserved);
    if (calc.days > available + t.rules.advanceMax) problems.push({ field: 'toDate', message: `Not enough ${t.name}: ${available} day(s) available${t.rules.advanceMax ? ` (and up to ${t.rules.advanceMax} in advance)` : ''}, ${calc.days} asked for` });
    // the team: people of the same manager or the same site away on these days (approved or waiting)
    const team = db.prepare(`SELECT DISTINCT p.full_name AS name, a.from_date, a.to_date, a.status FROM lv_applications a JOIN hr_employees p ON p.id = a.employee_id WHERE a.company_id = ? AND a.employee_id != ? AND a.deleted_at IS NULL AND a.status IN ('SUBMITTED', 'APPROVED') AND a.from_date <= ? AND a.to_date >= ? AND ((p.manager_id IS NOT NULL AND p.manager_id = ?) OR (p.site_id IS NOT NULL AND p.site_id = ?))`).all(c, e.id, b.toDate, b.fromDate, e.manager_id ?? -1, e.site_id ?? -1);
    return { problems, type: t, calc, balance: { year, remaining: r2(remaining), reserved: r2(reserved), available, after: r2(available - calc.days) }, clashes: team.map((x) => ({ name: x.name, from: x.from_date, to: x.to_date, status: x.status })), employee: e };
  }
  const preview = (actor, b) => {
    const mine = b.employeeId === myEmployee(actor);
    if (!mine) need(actor, 'lv.team.view', 'check leave of others', emp(b.employeeId)?.site_id ? scopeOf(emp(b.employeeId).site_id) : undefined);
    else need(actor, 'hr.application.create', 'apply for leave');
    const r = check(actor, b);
    return { days: r.calc?.days ?? 0, working: r.calc?.working ?? 0, sandwiched: r.calc?.sandwiched ?? 0, offDays: r.calc?.offDays ?? 0, balance: r.balance ?? null, clashes: r.clashes ?? [], problems: r.problems, band: r.calc && (r.calc.days > EXTENDED_DAYS || r.type?.rules.special) ? 'EXTENDED' : 'STANDARD', documentNeeded: Boolean(r.type?.rules.documentAfterDays != null && (r.calc?.days ?? 0) > r.type.rules.documentAfterDays) };
  };

  function allowed(actor, action, r) {
    const key = `hr.application.${action}`;
    if (OWN.has(action) && r.employee_id === myEmployee(actor)) return authz.check(actor, key).allowed;
    const sc = r.doc_site_id ? scopeOf(r.doc_site_id) : undefined;
    return may(actor, 'lv.team.view', sc) && may(actor, key, sc);
  }
  const needOn = (actor, action, what, r) => { if (!allowed(actor, action, r)) throw forbidden(`You may not ${what} (permission hr.application.${action}).`); };
  const rowOf = (actor, id) => {
    const r = db.prepare('SELECT * FROM lv_applications WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!r || !(maker(actor, r) || allowed(actor, 'view', r))) throw notFound('That leave application does not exist.');
    return r;
  };
  function view(actor, r) {
    const e = empName(r.employee_id); const t = typeById(r.company_id, r.leave_type_id); const can = (a) => allowed(actor, a, r);
    const editable = ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r);
    return {
      id: r.id, docNo: r.doc_no, revision: r.revision_no, supersedesId: r.supersedes_id, docDate: r.doc_date, status: r.status, statusLabel: STATUS_LABELS[r.status], rowVersion: r.version,
      employeeId: r.employee_id, employee: e?.n ?? null, employeeCode: e?.c ?? null, leaveTypeId: r.leave_type_id, leaveType: t.name, leaveTypeCode: t.code, paid: t.paid, siteId: r.doc_site_id, site: orgName('org_sites', r.doc_site_id),
      fromDate: r.from_date, toDate: r.to_date, halfDay: r.half_day, days: r.days, reason: r.reason, attachmentFileId: r.attachment_file_id, delegateUser: r.delegate_user, band: r.band, workflowInstanceId: r.workflow_instance_id, requestedBy: r.requested_by, createdBy: r.created_by,
      can: { edit: editable && can('edit'), submit: editable && can('submit'), delete: r.status === 'DRAFT' && maker(actor, r) && can('delete'), withdraw: r.status === 'SUBMITTED' && maker(actor, r), cancel: ['SUBMITTED', 'RETURNED'].includes(r.status) ? can('cancel') : r.status === 'APPROVED' && r.from_date > todayIST() && can('cancel'), amend: r.status === 'APPROVED' && can('amend'), print: can('print') },
    };
  }
  const history = (actor, id) => {
    const r = rowOf(actor, id);
    const ids = db.prepare('SELECT id, workflow_instance_id FROM lv_applications WHERE company_id = ? AND doc_no = ?').all(r.company_id, r.doc_no);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ requestId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'lv_applications' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ requestId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  };
  const checkDelegate = (c, b, e) => {
    if (!b.delegateUser) return;
    const u = db.prepare('SELECT username FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(c, b.delegateUser);
    if (!u) throw badRequest('Some fields are not valid.', [{ field: 'delegateUser', message: 'That person is not a user' }]);
    if (e.user_id && same(usernameOf(e.user_id), u.username)) throw badRequest('Some fields are not valid.', [{ field: 'delegateUser', message: 'Name somebody else to cover your approvals' }]);
  };
  const applications = {
    check: preview,
    create(actor, b) {
      const c = actor.companyId; const e = emp(b.employeeId);
      if (!e || e.company_id !== c) throw badRequest('Some fields are not valid.', [{ field: 'employeeId', message: 'That is not an employee' }]);
      const ghost = { employee_id: e.id, doc_site_id: e.site_id ?? null };
      needOn(actor, 'create', 'apply for leave for this person', ghost);
      const r = check(actor, b); if (r.problems.length) throw badRequest('Some fields are not valid.', r.problems);
      checkDelegate(c, b, e);
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_LEAVE', 'lv_applications', 'LV');
        const siteId = e.site_id ?? (() => { try { return att().resolveFor(c, e.id, b.fromDate).siteId ?? null; } catch { return null; } })();
        const id = Number(db.prepare("INSERT INTO lv_applications (company_id, doc_no, doc_date, employee_id, leave_type_id, doc_site_id, from_date, to_date, half_day, days, leave_year, reason, attachment_file_id, delegate_user, band, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STANDARD', 'DRAFT', ?, ?, ?, ?, 'lv_application')")
          .run(c, no, todayIST(), e.id, b.leaveTypeId, siteId, b.fromDate, b.toDate, b.halfDay, r.calc.days, yearOf(b.fromDate), b.reason, b.attachmentFileId ?? null, b.delegateUser ?? null, actor.user, scopeOf(siteId)?.projectId ?? null, siteId, actor.user).lastInsertRowid);
        db.prepare('UPDATE lv_applications SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'lv_applications', entityId: id, action: 'create', newValues: { docNo: no, from: b.fromDate, to: b.toDate, days: r.calc.days }, actor: actor.user, companyId: c });
        return b.submit ? applications.submit(actor, id, { comment: b.comment }) : view(actor, rowOf(actor, id));
      });
    },
    get(actor, id) { return { ...view(actor, rowOf(actor, id)), history: history(actor, id) }; },
    update(actor, id, b) {
      const r = rowOf(actor, id); needOn(actor, 'edit', 'change leave applications', r);
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`An application that is ${STATUS_LABELS[r.status].toLowerCase()} is changed by an amendment.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this application, changes it.`);
      if (r.version !== b.version) throw conflict('This application was changed by someone else. Reload it and try again.');
      const res = check(actor, { ...b, employeeId: r.employee_id }, root(r)); if (res.problems.length) throw badRequest('Some fields are not valid.', res.problems);
      checkDelegate(r.company_id, b, emp(r.employee_id));
      db.prepare('UPDATE lv_applications SET leave_type_id = ?, from_date = ?, to_date = ?, half_day = ?, days = ?, leave_year = ?, reason = ?, attachment_file_id = ?, delegate_user = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.leaveTypeId, b.fromDate, b.toDate, b.halfDay, res.calc.days, yearOf(b.fromDate), b.reason, b.attachmentFileId ?? null, b.delegateUser ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lv_applications', entityId: id, action: 'update', newValues: { from: b.fromDate, to: b.toDate, days: res.calc.days }, actor: actor.user, companyId: actor.companyId });
      return view(actor, rowOf(actor, id));
    },
    remove(actor, id) {
      const r = rowOf(actor, id); needOn(actor, 'delete', 'delete leave applications', r);
      if (r.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} deletes this draft.`);
      db.prepare('UPDATE lv_applications SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'lv_applications', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const r = rowOf(actor, id); needOn(actor, 'submit', 'submit leave applications', r);
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`This application is ${STATUS_LABELS[r.status].toLowerCase()}.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this application, submits it.`);
      return transaction(db, () => {
        const res = check(actor, { employeeId: r.employee_id, leaveTypeId: r.leave_type_id, fromDate: r.from_date, toDate: r.to_date, halfDay: r.half_day, attachmentFileId: r.attachment_file_id }, root(r));
        if (res.problems.length) throw unprocessable(res.problems[0].message);
        const span = (Date.parse(r.to_date) - Date.parse(r.from_date)) / 86_400_000 + 1;
        const band = res.calc.days > EXTENDED_DAYS || span > EXTENDED_DAYS || res.type.rules.special ? 'EXTENDED' : 'STANDARD';
        db.prepare('UPDATE lv_applications SET days = ?, band = ? WHERE id = ?').run(res.calc.days, band, id);
        const ctx = { band, employeeId: r.employee_id, days: res.calc.days, typeCode: res.type.code, special: res.type.rules.special };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: LEAVE_DOC, docId: id, comment: comment ?? 'Leave', context: ctx, amendsDocId: r.supersedes_id ?? null }); db.prepare('UPDATE lv_applications SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE lv_applications SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'lv_applications', entityId: id, action: 'submit', newValues: { band, days: res.calc.days }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return view(actor, rowOf(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const r = rowOf(actor, id);
      if (r.status !== 'SUBMITTED') throw unprocessable('Only an application in approval is withdrawn.');
      if (!maker(actor, r)) throw forbidden('Only the person who raised it withdraws it.');
      workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason });
      return view(actor, rowOf(actor, id));
    },
    /** In approval or returned: cancelled with the workflow. Approved: only before it starts (BR-03: the balance and the attendance go back); after it starts, an amendment shortens it. */
    cancel(actor, id, { reason }) {
      const r = rowOf(actor, id); needOn(actor, 'cancel', 'cancel leave', r);
      if (r.status === 'APPROVED') {
        if (r.from_date <= todayIST()) throw unprocessable('The leave has started: amend it to shorten it, and the days not taken go back to the balance.');
        return transaction(db, () => {
          db.prepare("UPDATE lv_applications SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
          undo(actor, r, 'cancel');
          writeAudit(db, { entity: 'lv_applications', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
          event('lv.application.cancelled', actor, 'lv_application', id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, from: r.from_date, to: r.to_date, days: r.days }, r.project_id, r.doc_site_id);
          return view(actor, rowOf(actor, id));
        });
      }
      if (!['SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable('Only an application in approval, returned or approved is cancelled; delete a draft.');
      if (maker(actor, r)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); decide({ docId: r.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, r.workflow_instance_id, { reason });
      return view(actor, rowOf(actor, id));
    },
    amend(actor, id, { reason }) {
      const r = rowOf(actor, id); needOn(actor, 'amend', 'amend leave', r);
      if (r.status !== 'APPROVED') throw unprocessable('Only an approved application is amended.');
      if (db.prepare("SELECT 1 FROM lv_applications WHERE company_id = ? AND doc_no = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.company_id, r.doc_no)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${r.doc_no} is already open.`);
      return transaction(db, () => {
        const rev = db.prepare('SELECT MAX(revision_no) AS v FROM lv_applications WHERE company_id = ? AND doc_no = ?').get(r.company_id, r.doc_no).v + 1;
        const nid = Number(db.prepare("INSERT INTO lv_applications (company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, leave_type_id, doc_site_id, from_date, to_date, half_day, days, leave_year, reason, attachment_file_id, delegate_user, band, status, requested_by, project_id, site_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'lv_application', ?, ?)")
          .run(r.company_id, r.doc_no, rev, root(r), r.id, todayIST(), r.employee_id, r.leave_type_id, r.doc_site_id, r.from_date, r.to_date, r.half_day, r.days, r.leave_year, r.reason, r.attachment_file_id, r.delegate_user, r.band, actor.user, r.project_id, r.site_id, actor.user, String(r.id), reason).lastInsertRowid);
        writeAudit(db, { entity: 'lv_applications', entityId: nid, action: 'amend', newValues: { from: r.id, revision: rev }, reason, actor: actor.user, companyId: actor.companyId });
        return view(actor, rowOf(actor, nid));
      });
    },
    history(actor, id) { return history(actor, id); },
    print(actor, id) {
      const r = rowOf(actor, id); needOn(actor, 'print', 'print leave applications', r);
      const v = view(actor, r);
      writeAudit(db, { entity: 'lv_applications', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
      const rows = [['Employee', `${v.employee} (${v.employeeCode})`], ['Leave type', v.leaveType], ['From', v.fromDate], ['To', v.toDate], ['Half day', v.halfDay === 'NONE' ? 'No' : v.halfDay === 'FIRST' ? 'First half' : 'Second half'], ['Days', v.days], ['Reason', v.reason], ['Status', v.statusLabel]];
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.docNo)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:30%}</style></head><body><h2>Leave ${e(v.docNo)} (revision ${v.revision})</h2><table>${rows.map(([a, x]) => `<tr><th>${e(a)}</th><td>${e(x)}</td></tr>`).join('')}</table></body></html>`;
    },
  };

  // ------------------------------------------------------------------ what approval does (BR-03) and what undoing does
  const APPROVER_ROLES = new Set(['PM', 'PD', 'CM', 'WSUP', 'HRMGR', 'DIR', 'CFO', 'PROCMGR', 'ACCMGR', 'COMMGR', 'QCMGR', 'PCMGR', 'HSEE', 'SE']);
  function charge(actor, r) {
    post(r.company_id, { employeeId: r.employee_id, typeId: r.leave_type_id, year: r.leave_year, date: r.from_date, type: 'AVAILED', days: -r.days, refType: 'lv_application', refId: r.id, key: `app:${r.id}`, note: `${r.doc_no}: ${r.from_date} to ${r.to_date}`, by: actor.user });
    // the approver is away: someone covers the approvals for the days (04.02), if they named one and the days are within the limit of a delegation
    const e = emp(r.employee_id); const me = e?.user_id ? db.prepare('SELECT username, roles_json FROM iam_users WHERE id = ?').get(e.user_id) : null;
    if (r.delegate_user && me) {
      const roles = json(me.roles_json, []).filter((x) => APPROVER_ROLES.has(x));
      const days = (Date.parse(r.to_date) - Date.parse(r.from_date)) / 86_400_000 + 1;
      if (roles.length && days <= 15 && !same(me.username, r.delegate_user) && r.to_date >= todayIST()) {
        const id = Number(db.prepare("INSERT INTO wf_delegations (company_id, delegator, delegate, doc_types_json, delegator_roles_json, from_date, to_date, reason, status, created_by, source_type, source_id) VALUES (?, ?, ?, '[]', ?, ?, ?, ?, 'ACTIVE', ?, 'lv_application', ?)").run(r.company_id, me.username, r.delegate_user, JSON.stringify(roles), r.from_date > todayIST() ? r.from_date : todayIST(), r.to_date, `On leave: ${r.doc_no}`, actor.user, String(r.id)).lastInsertRowid);
        db.prepare('UPDATE lv_applications SET delegation_id = ? WHERE id = ?').run(id, r.id);
      }
    }
  }
  /** Reverses an approved leave: the ledger gets the days back, the delegation ends, the register is computed again. */
  function undo(actor, r, why) {
    post(r.company_id, { employeeId: r.employee_id, typeId: r.leave_type_id, year: r.leave_year, date: todayIST(), type: 'REVERSAL', days: r.days, refType: 'lv_application', refId: r.id, key: `rev:${r.id}`, note: `${r.doc_no} ${why === 'cancel' ? 'cancelled' : 'replaced by an amendment'}`, by: actor.user });
    if (r.delegation_id) db.prepare("UPDATE wf_delegations SET status = 'REVOKED', revoked_by = ?, revoked_at = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'").run(actor.user, nowIso(), nowIso(), r.delegation_id);
    registerOf(db)?.queueChange(r.company_id, r.employee_id, r.from_date);
  }
  function decide(instance, actor, outcome, comment) {
    const r = db.prepare('SELECT * FROM lv_applications WHERE id = ?').get(Number(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      db.prepare("UPDATE lv_applications SET status = 'APPROVED', applied_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, r.id);
      if (r.supersedes_id) { const old = db.prepare('SELECT * FROM lv_applications WHERE id = ?').get(r.supersedes_id); if (old?.status === 'APPROVED') { db.prepare("UPDATE lv_applications SET status = 'SUPERSEDED', version = version + 1 WHERE id = ?").run(old.id); undo(actor, old, 'amend'); } }
      charge(actor, db.prepare('SELECT * FROM lv_applications WHERE id = ?').get(r.id));
      const t = typeById(r.company_id, r.leave_type_id);
      event('lv.application.approved', actor, 'lv_application', r.id, r.company_id, { docNo: r.doc_no, revision: r.revision_no, employeeId: r.employee_id, leaveType: t.code, paid: t.paid, from: r.from_date, to: r.to_date, halfDay: r.half_day, days: r.days }, r.project_id, r.doc_site_id);
      registerOf(db)?.queueChange(r.company_id, r.employee_id, r.from_date);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE lv_applications SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
      if (withdrawn) db.prepare('UPDATE lv_applications SET workflow_instance_id = NULL WHERE id = ?').run(r.id);
    }
    writeAudit(db, { entity: 'lv_applications', entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    tell(r.company_id, r.requested_by ?? r.created_by, 'Leave', r.doc_no, `${empName(r.employee_id)?.n ?? ''}, ${r.from_date} to ${r.to_date}`, outcome, comment, '/leave/my');
  }
  const tell = (companyId, to, what, ref, title, outcome, comment, link) => to && notif.notify({ companyId, templateCode: 'lv.decided', recipients: [`user:${to}`], data: { what, ref, title, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment: comment ? `: ${comment}` : '' }, link, sourceType: 'lv_application', sourceId: ref, eventKey: `lv.decided:${ref}:${outcome}:${Date.now()}` });

  // ------------------------------------------------------------------ balance adjustments (FR-05): HR asks, the HR manager decides
  const adjView = (a) => ({ id: a.id, docNo: a.doc_no, employeeId: a.employee_id, employee: empName(a.employee_id)?.n, leaveTypeId: a.leave_type_id, leaveType: typeById(a.company_id, a.leave_type_id).name, year: a.year, days: a.days, reason: a.reason, status: a.status, statusLabel: STATUS_LABELS[a.status], workflowInstanceId: a.workflow_instance_id, requestedBy: a.requested_by, rowVersion: a.version });
  const adjRow = (actor, id) => { const a = db.prepare('SELECT * FROM lv_adjustments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!a) throw notFound('That adjustment does not exist.'); need(actor, 'lv.adjust.view', 'see balance adjustments'); return a; };
  const adjustments = {
    list(actor) { need(actor, 'lv.adjust.view', 'see balance adjustments'); return db.prepare("SELECT * FROM lv_adjustments WHERE company_id = ? AND deleted_at IS NULL AND status != 'SUPERSEDED' ORDER BY id DESC LIMIT 200").all(actor.companyId).map(adjView); },
    get(actor, id) { return adjView(adjRow(actor, id)); },
    create(actor, b) {
      need(actor, 'lv.adjust.create', 'adjust leave balances');
      const e = emp(b.employeeId); if (!e || e.company_id !== actor.companyId) throw badRequest('Some fields are not valid.', [{ field: 'employeeId', message: 'That is not an employee' }]);
      const t = typeById(actor.companyId, b.leaveTypeId);
      if (b.days < 0 && remainingOf(actor.companyId, e.id, t.id, b.year) + b.days < -t.rules.advanceMax) throw badRequest('Some fields are not valid.', [{ field: 'days', message: `The balance of ${t.name} cannot go below ${-t.rules.advanceMax}` }]);
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_LV_ADJUST', 'lv_adjustments', 'LVA');
        const id = Number(db.prepare("INSERT INTO lv_adjustments (company_id, doc_no, doc_date, employee_id, leave_type_id, doc_site_id, year, days, reason, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'lv_adjustment')").run(actor.companyId, no, todayIST(), e.id, t.id, e.site_id ?? null, b.year, b.days, b.reason, actor.user, actor.user).lastInsertRowid);
        db.prepare('UPDATE lv_adjustments SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'lv_adjustments', entityId: id, action: 'create', newValues: { employeeId: e.id, type: t.code, year: b.year, days: b.days }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? adjustments.submit(actor, id) : adjView(adjRow(actor, id));
      });
    },
    submit(actor, id) {
      const a = adjRow(actor, id); need(actor, 'lv.adjust.create', 'submit balance adjustments');
      if (!['DRAFT', 'RETURNED'].includes(a.status)) throw conflict(`This adjustment is ${STATUS_LABELS[a.status].toLowerCase()}.`);
      if (!maker(actor, a)) throw forbidden(`Only ${a.created_by} submits it.`);
      return transaction(db, () => {
        if (a.status === 'RETURNED') workflowOf(db).resubmit(actor, a.workflow_instance_id, { comment: 'Corrected', context: { band: 'STANDARD' } });
        else { const inst = workflowOf(db).submit(actor, { docType: ADJUST_DOC, docId: id, comment: 'Balance adjustment', context: { band: 'STANDARD' } }); db.prepare('UPDATE lv_adjustments SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE lv_adjustments SET status = 'SUBMITTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        return adjView(adjRow(actor, id));
      });
    },
    cancel(actor, id, { reason }) {
      const a = adjRow(actor, id);
      if (!['SUBMITTED', 'RETURNED', 'DRAFT'].includes(a.status)) throw unprocessable('Only an adjustment not yet approved is cancelled.');
      if (!maker(actor, a)) throw forbidden('Only the person who raised it cancels it.');
      if (a.workflow_instance_id) workflowOf(db).abandon(actor.companyId, a.workflow_instance_id, actor.user, 'CANCELLED', reason);
      db.prepare("UPDATE lv_adjustments SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
      return adjView(adjRow(actor, id));
    },
  };
  function decideAdjust(instance, actor, outcome, comment) {
    const a = db.prepare('SELECT * FROM lv_adjustments WHERE id = ?').get(Number(instance.docId));
    if (!a || !['SUBMITTED', 'RETURNED'].includes(a.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      const t = typeById(a.company_id, a.leave_type_id);
      if (a.days < 0 && remainingOf(a.company_id, a.employee_id, t.id, a.year) + a.days < -t.rules.advanceMax) throw unprocessable(`The balance of ${t.name} would go below ${-t.rules.advanceMax}.`);
      db.prepare("UPDATE lv_adjustments SET status = 'APPROVED', applied_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, a.id);
      post(a.company_id, { employeeId: a.employee_id, typeId: a.leave_type_id, year: a.year, date: todayIST(), type: 'ADJUSTMENT', days: a.days, refType: 'lv_adjustment', refId: a.id, key: `adj:${a.id}`, note: a.reason, by: actor.user });
      event('lv.balance.adjusted', actor, 'lv_adjustment', a.id, a.company_id, { docNo: a.doc_no, employeeId: a.employee_id, leaveType: t.code, year: a.year, days: a.days }, null, a.doc_site_id);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE lv_adjustments SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, a.id);
    }
    writeAudit(db, { entity: 'lv_adjustments', entityId: a.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: a.company_id });
    tell(a.company_id, a.requested_by, 'Balance adjustment', a.doc_no, `${empName(a.employee_id)?.n ?? ''}, ${a.days} day(s)`, outcome, comment, '/leave/balances');
  }

  // ------------------------------------------------------------------ the register of applications, the team calendar
  const SELECT = 'x.*, e.full_name AS employee_name, e.emp_code AS employee_code, t.name AS type_name, t.code AS type_code, s.name AS site_name';
  const regScope = (actor) => {
    const sc = authz.scopeFilter(actor, 'lv.team.view', { project: 'x.project_id', site: 'x.doc_site_id' }).sql; const me = myEmployee(actor);
    return `x.company_id = :c AND (${sc} OR lower(x.created_by) = lower(:u)${me ? ` OR x.employee_id = ${Number(me)}` : ''})`;
  };
  const present = (r) => ({ id: r.id, docNo: r.doc_no, revision: r.revision_no, code: r.employee_code, employee: r.employee_name, employeeId: r.employee_id, type: r.type_name, typeCode: r.type_code, fromDate: r.from_date, toDate: r.to_date, days: r.days, halfDay: r.half_day, site: r.site_name, band: r.band, status: r.status, statusLabel: STATUS_LABELS[r.status] ?? r.status, reason: r.reason });
  const register = {
    list(actor, query) { need(actor, 'hr.application.view', 'see leave applications'); return runList(db, applicationList, parseListRequest(applicationList, query), { select: SELECT, scopeSql: regScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'x.id', map: present }); },
    exportSource(actor, req) {
      need(actor, 'hr.application.export', 'export leave applications');
      const opts = { select: SELECT, scopeSql: regScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'x.id' };
      return { title: applicationList.label, permission: 'hr.application.export', personal: false, columns: Object.entries(applicationList.columns).filter(([k]) => !['siteId', 'updatedAt', 'revision', 'typeCode'].includes(k)).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, applicationList, req, opts), rows: () => runList(db, applicationList, req, { ...opts, limit: null, map: present }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${applicationList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
  };
  const calendar = {
    /** Who is away when: the people the viewer may see, a row each, a mark for each day of leave (approved, or waiting for approval). */
    get(actor, { from, to, siteId, departmentId }) {
      need(actor, 'lv.team.view', 'see the team leave calendar');
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 62) throw badRequest('Some fields are not valid.', [{ field: 'to', message: 'Show at most 62 days' }]);
      const where = ['a.company_id = :c', 'a.deleted_at IS NULL', "a.status IN ('SUBMITTED', 'APPROVED')", 'a.from_date <= :to', 'a.to_date >= :from', authz.scopeFilter(actor, 'lv.team.view', { project: 'a.project_id', site: 'a.doc_site_id' }).sql];
      const p = { c: actor.companyId, from, to };
      if (siteId) { where.push('a.doc_site_id = :s'); p.s = siteId; }
      if (departmentId) { where.push('e.department_id = :d'); p.d = departmentId; }
      const rows = db.prepare(`SELECT a.*, e.full_name, e.emp_code, t.code AS type_code, t.name AS type_name, s.name AS site_name FROM lv_applications a JOIN hr_employees e ON e.id = a.employee_id JOIN lv_types t ON t.id = a.leave_type_id LEFT JOIN org_sites s ON s.id = a.doc_site_id WHERE ${where.join(' AND ')} ORDER BY e.full_name, a.from_date`).all(p);
      const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      const people = new Map();
      for (const a of rows) {
        let x = people.get(a.employee_id); if (!x) { x = { employeeId: a.employee_id, name: a.full_name, code: a.emp_code, site: a.site_name, cells: {} }; people.set(a.employee_id, x); }
        for (let d = a.from_date < from ? from : a.from_date; d <= (a.to_date > to ? to : a.to_date); d = addDays(d, 1)) x.cells[d] = { code: a.type_code, type: a.type_name, status: a.status, half: a.half_day !== 'NONE', docNo: a.doc_no };
      }
      const list = [...people.values()];
      const perDay = Object.fromEntries(days.map((d) => [d, list.filter((p2) => p2.cells[d]).length]));
      return { from, to, days, weekdays: days.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()), rows: list, perDay, holidays: holidaysOf(actor.companyId, days) };
    },
  };
  const holidaysOf = (c, days) => db.prepare(`SELECT DISTINCT holiday_date AS d, name FROM core_holidays WHERE holiday_date IN (${days.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(...days).map((h) => ({ date: h.d, name: h.name }));
  const mine = (actor, year) => {
    need(actor, 'hr.application.view', 'see your leave');
    const me = myEmployee(actor);
    if (!me) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record, so there is no leave to show.');
    const y = year ?? yearOf(todayIST());
    return { employeeId: me, year: y, balances: balances.of(actor, me, y), applications: db.prepare("SELECT * FROM lv_applications WHERE company_id = ? AND employee_id = ? AND deleted_at IS NULL AND status != 'SUPERSEDED' ORDER BY from_date DESC LIMIT 50").all(actor.companyId, me).map((r) => view(actor, r)) };
  };

  // ------------------------------------------------------------------ year-end (FR-08)
  function yearEndPlan(companyId, year) {
    ensureTypes(companyId);
    const rows = [];
    for (const n of db.prepare('SELECT n.*, e.emp_code, e.full_name FROM lv_entitlements n JOIN hr_employees e ON e.id = n.employee_id WHERE n.company_id = ? AND n.year = ? AND n.deleted_at IS NULL ORDER BY e.emp_code').all(companyId, year)) {
      const v = rollup(companyId, n.employee_id, n.leave_type_id, year); const t = typeById(companyId, n.leave_type_id);
      const reserved = reservedOf(companyId, n.employee_id, n.leave_type_id, year);
      const y = yearEnd({ balance: v.remaining, rules: t.rules });
      if (v.remaining === 0 && !reserved) continue;
      rows.push({ employeeId: n.employee_id, code: n.emp_code, employee: n.full_name, typeId: t.id, type: t.code, balance: v.remaining, ...y, waiting: r2(reserved) });
    }
    return rows;
  }
  const yearEndApi = {
    preview(actor, year) {
      need(actor, 'lv.yearend.run', 'run year-end processing');
      const rows = yearEndPlan(actor.companyId, year); const done = db.prepare('SELECT * FROM lv_year_runs WHERE company_id = ? AND year = ? AND deleted_at IS NULL').get(actor.companyId, year);
      const waiting = db.prepare("SELECT COUNT(*) AS n FROM lv_applications WHERE company_id = ? AND leave_year = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(actor.companyId, year).n;
      return { year, done: Boolean(done), doneBy: done?.run_by ?? null, rows, waiting, totals: { people: new Set(rows.map((r) => r.employeeId)).size, carry: r2(rows.reduce((a, r) => a + Math.max(0, r.carry), 0)), lapse: r2(rows.reduce((a, r) => a + r.lapse, 0)), encash: r2(rows.reduce((a, r) => a + r.encash, 0)) } };
    },
    run(actor, year) {
      need(actor, 'lv.yearend.run', 'run year-end processing');
      if (year >= yearOf(todayIST())) throw unprocessable('Year-end is run after the year has ended.');
      if (db.prepare('SELECT 1 FROM lv_year_runs WHERE company_id = ? AND year = ? AND deleted_at IS NULL').get(actor.companyId, year)) throw conflict(`Year-end of ${year} was processed already.`);
      return transaction(db, () => {
        const waiting = db.prepare("SELECT doc_no FROM lv_applications WHERE company_id = ? AND leave_year = ? AND status = 'SUBMITTED' AND deleted_at IS NULL LIMIT 5").all(actor.companyId, year);
        if (waiting.length) throw new HttpError(409, 'APPLICATIONS_WAITING', `Leave applications of ${year} still wait for a decision: ${waiting.map((w) => w.doc_no).join(', ')}.`);
        const rows = yearEndPlan(actor.companyId, year); const out = [];
        for (const r of rows) {
          const date = `${year}-12-31`;
          if (r.encash > 0) post(actor.companyId, { employeeId: r.employeeId, typeId: r.typeId, year, date, type: 'ENCASHED', days: -r.encash, refType: 'lv_year_end', key: `ye:${year}:enc`, note: `Year-end ${year}`, by: actor.user });
          if (r.lapse > 0) post(actor.companyId, { employeeId: r.employeeId, typeId: r.typeId, year, date, type: 'LAPSED', days: -r.lapse, refType: 'lv_year_end', key: `ye:${year}:lapse`, note: `Year-end ${year}`, by: actor.user });
          if (r.carry !== 0) {
            post(actor.companyId, { employeeId: r.employeeId, typeId: r.typeId, year, date, type: 'LAPSED', days: -r.carry, refType: 'lv_year_end', key: `ye:${year}:carry`, note: `Carried forward to ${year + 1}`, by: actor.user });
            post(actor.companyId, { employeeId: r.employeeId, typeId: r.typeId, year: year + 1, date: `${year + 1}-01-01`, type: 'OPENING', days: r.carry, refType: 'lv_year_end', key: `ye:${year}:open`, note: `Carried forward from ${year}`, by: actor.user });
          }
          out.push(r);
        }
        const summary = { people: new Set(rows.map((r) => r.employeeId)).size, carry: r2(rows.reduce((a, r) => a + Math.max(0, r.carry), 0)), lapse: r2(rows.reduce((a, r) => a + r.lapse, 0)), encash: r2(rows.reduce((a, r) => a + r.encash, 0)) };
        const id = Number(db.prepare("INSERT INTO lv_year_runs (company_id, year, status, summary_json, run_by, run_at, created_by, source_type) VALUES (?, ?, 'DONE', ?, ?, ?, ?, 'lv_year_run')").run(actor.companyId, year, JSON.stringify(summary), actor.user, nowIso(), actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'lv_year_runs', entityId: id, action: 'run', newValues: { year, ...summary }, actor: actor.user, companyId: actor.companyId });
        event('lv.year_end.processed', actor, 'lv_year_run', id, actor.companyId, { year, ...summary }, null, null);
        // the encashment inputs for payroll: the days to be paid, person by person (24.02)
        for (const r of out.filter((x) => x.encash > 0)) event('lv.encashment.input', actor, 'lv_year_run', id, actor.companyId, { year, employeeId: r.employeeId, leaveType: r.type, days: r.encash }, null, null);
        return { id, year, ...summary, rows: out };
      });
    },
    runs(actor) { need(actor, 'lv.yearend.run', 'see year-end runs'); return db.prepare('SELECT * FROM lv_year_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY year DESC').all(actor.companyId).map((r) => ({ id: r.id, year: r.year, runBy: r.run_by, runAt: r.run_at, summary: json(r.summary_json, {}) })); },
  };
  const runAccrual = (actor, { from, to }) => { need(actor, 'lv.accrual.run', 'run the accrual'); return transaction(db, () => { const a = accrue(actor.companyId, from, to); const c = creditCompOff(actor.companyId, from, to); return { ...a, compOff: c.credited }; }); };

  /** Leave in the attendance register (07.06): an approved application covering a working day without punches makes it leave (BR-03). */
  const leaveOn = (c, employeeId, date) => {
    const a = db.prepare("SELECT a.half_day, t.code, t.paid FROM lv_applications a JOIN lv_types t ON t.id = a.leave_type_id WHERE a.company_id = ? AND a.employee_id = ? AND a.status = 'APPROVED' AND a.deleted_at IS NULL AND a.from_date <= ? AND a.to_date >= ? ORDER BY a.id DESC LIMIT 1").get(c, employeeId, date, date);
    return a ? { fraction: a.half_day === 'NONE' ? 1 : 0.5, paid: a.paid === 1, code: a.code } : null;
  };
  const widget = (actor) => {
    if (!may(actor, 'hr.application.approve')) return { value: 0 };
    const tasks = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 });
    return { value: (tasks.rows ?? []).filter((t) => t.instance?.docType === LEAVE_DOC).length };
  };
  const approvals = {
    list(actor) {
      need(actor, 'hr.application.approve', 'see leave approvals');
      const tasks = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 });
      return (tasks.rows ?? []).filter((t) => t.instance?.docType === LEAVE_DOC).map((t) => {
        const r = db.prepare('SELECT * FROM lv_applications WHERE id = ? AND company_id = ?').get(Number(t.instance.docId), actor.companyId); if (!r) return null;
        const v = view(actor, r); const clashes = check(actor, { employeeId: r.employee_id, leaveTypeId: r.leave_type_id, fromDate: r.from_date, toDate: r.to_date, halfDay: r.half_day, attachmentFileId: r.attachment_file_id }, root(r)).clashes ?? [];
        return { taskId: t.id, docId: r.id, docNo: v.docNo, employee: v.employee, employeeCode: v.employeeCode, leaveType: v.leaveType, fromDate: v.fromDate, toDate: v.toDate, days: v.days, halfDay: v.halfDay, reason: v.reason, band: v.band, clashes, requestedBy: v.requestedBy };
      }).filter(Boolean);
    },
    bulk(actor, { taskIds, decision, comment }) {
      need(actor, 'hr.application.approve', 'decide leave');
      const action = { APPROVE: 'approve', REJECT: 'reject', RETURN: 'return' }[decision];
      const out = taskIds.map((taskId) => { try { workflowOf(db).act(actor, taskId, { action, comment }); return { taskId, ok: true }; } catch (e) { return { taskId, ok: false, error: e.message }; } });
      return { decision, done: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, results: out };
    },
  };
  return { types, balances, applications, adjustments, register, calendar, mine, yearEnd: yearEndApi, runAccrual, accrue, creditCompOff, lapseCompOff, daily, approvals, widget, decisions: { leave: decide, adjust: decideAdjust }, leaveOn, ensureTypes, systemActor, post, rollup, check: preview };
}

const services = new WeakMap();
registerLeaveSource((db, c, employeeId, date) => leaveOf(db)?.leaveOn(c, employeeId, date) ?? null);
export const bindLeave = (db, s) => services.set(db, s);
export const leaveOf = (db) => services.get(db) ?? null;

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const role = (r) => ({ kind: 'role', role: r });
/** The reporting manager of the person (the manager on the employee record), the HR manager when there is none or the person is the submitter. */
workflowResolvers.register('lv.manager', ({ db, instance }) => {
  const a = db.prepare('SELECT employee_id FROM lv_applications WHERE id = ?').get(Number(instance.docId));
  const m = a && db.prepare('SELECT m.user_id FROM hr_employees e JOIN hr_employees m ON m.id = e.manager_id WHERE e.id = ?').get(a.employee_id);
  const u = m?.user_id ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(m.user_id)?.username : null;
  return u && !same(u, instance.submittedBy) ? [{ user: u }] : [{ role: 'HRMGR' }];
});
const hooks = (fn) => ({
  onApproved: (db, { instance, actor }) => leaveOf(db)?.decisions[fn](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => leaveOf(db)?.decisions[fn](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => leaveOf(db)?.decisions[fn](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => leaveOf(db)?.decisions[fn](instance, actor, 'CANCELLED', comment),
});
workflowTypes.register({
  docType: LEAVE_DOC, label: 'Leave application', processOwner: 'HRMGR', route: () => '/leave/approvals',
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.from_date, x.to_date, x.requested_by, x.created_by, x.doc_site_id, x.project_id, e.full_name FROM lv_applications x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.full_name}, ${r.from_date} to ${r.to_date}`, originator: r.requested_by ?? r.created_by, projectId: r.project_id ?? undefined, siteId: r.doc_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, t.name AS type_name FROM lv_applications x JOIN hr_employees e ON e.id = x.employee_id JOIN lv_types t ON t.id = x.leave_type_id WHERE x.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Application', value: r.doc_no }, { label: 'Employee', value: r.full_name }, { label: 'Leave type', value: r.type_name }, { label: 'From', value: r.from_date }, { label: 'To', value: r.to_date }, { label: 'Days', value: String(r.days) }, { label: 'Reason', value: r.reason }] }; },
  defaultDefinition: { name: 'Leave: reporting manager, HR manager beyond 10 days or for a special type', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('MANAGER', 'Reporting manager', [{ kind: 'resolver', resolver: 'lv.manager' }]), step('HRMGR', 'HR manager', [role('HRMGR')], { field: 'band', op: 'eq', value: 'EXTENDED' })] },
  hooks: hooks('leave'),
});
workflowTypes.register({
  docType: ADJUST_DOC, label: 'Leave balance adjustment', processOwner: 'HRMGR', route: () => '/leave/balances',
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.days, x.requested_by, e.full_name FROM lv_adjustments x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.full_name}, ${r.days} day(s)`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, t.name AS type_name FROM lv_adjustments x JOIN hr_employees e ON e.id = x.employee_id JOIN lv_types t ON t.id = x.leave_type_id WHERE x.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Adjustment', value: r.doc_no }, { label: 'Employee', value: r.full_name }, { label: 'Leave type', value: r.type_name }, { label: 'Year', value: String(r.year) }, { label: 'Days', value: String(r.days) }, { label: 'Reason', value: r.reason }] }; },
  defaultDefinition: { name: 'Balance adjustment: HR manager', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('HRMGR', 'HR manager', [role('HRMGR')])] },
  hooks: hooks('adjust'),
});
evidenceProviders.register(LEAVE_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM lv_applications WHERE id = ?').get(Number(instance.docId)); if (!r) return { sections: [] };
  const rem = db.prepare("SELECT COALESCE(SUM(days), 0) AS d FROM lv_ledger WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ? AND deleted_at IS NULL").get(r.company_id, r.employee_id, r.leave_type_id, r.leave_year).d;
  const team = db.prepare("SELECT COUNT(*) AS n FROM lv_applications a JOIN hr_employees p ON p.id = a.employee_id JOIN hr_employees me ON me.id = ? WHERE a.company_id = ? AND a.employee_id != ? AND a.deleted_at IS NULL AND a.status IN ('SUBMITTED', 'APPROVED') AND a.from_date <= ? AND a.to_date >= ? AND ((p.manager_id IS NOT NULL AND p.manager_id = me.manager_id) OR (p.site_id IS NOT NULL AND p.site_id = me.site_id))").get(r.employee_id, r.company_id, r.employee_id, r.to_date, r.from_date).n;
  return { sections: [{ code: 'lv-leave', title: 'Before approving', kind: 'metrics', items: [{ label: 'Balance now', value: `${Math.round(rem * 100) / 100} day(s)`, format: 'text' }, { label: 'Days asked for', value: String(r.days), format: 'text' }, { label: 'Others of the team away on these days', value: String(team), format: 'text', tone: team > 0 ? 'warn' : undefined }, { label: 'Goes to', value: r.band === 'EXTENDED' ? 'The HR manager also (over 10 days or a special type)' : 'The reporting manager', format: 'text' }] }] };
});
void notFound;
