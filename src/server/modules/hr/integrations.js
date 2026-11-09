import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { EMPLOYMENT_TYPES, GENDERS } from './validators.js';
import { nameKey, similarity } from '../../platform/mdm/index.js';
import { employeesOf } from './employees.js';

// The employee master (part 07.01) for the rest of the ERP: the lookup of employees for forms (GET /api/v1/hr/lookups/employees: approved employees who are still here, within the viewer's scope) and the Excel import (04.13, FR-10):
// each row is a new employee sent for approval, like one typed in the wizard; an import never approves anything (AC-04) and a duplicate PAN or Aadhaar is refused row by row.
lookupRegistry.register({
  module: 'hr', name: 'employees', label: 'Employees', permission: 'hr.employee.team.view', columns: [{ key: 'designation', label: 'Designation' }],
  search(db, actor, q) {
    const s = employeesOf(db);
    if (!s) return { rows: [], total: 0 };
    const out = s.lookup(actor, { q: q.text || undefined, limit: q.ids ? 200 : q.limit, offset: q.ids ? 0 : q.offset, ids: q.ids });
    return q.ids ? { rows: out.rows.filter((r) => q.ids.includes(r.id)), total: q.ids.length } : out;
  },
});

// designations and branches for the employee form (the organisation master has no lookup of them yet): the active ones of the company, searched by code or name
for (const [name, label, table, extra, cols] of [['designations', 'Designations', 'org_designations', ', grade, level', [{ key: 'grade', label: 'Grade' }, { key: 'level', label: 'Level' }]], ['branches', 'Branches', 'org_branches', '', []]]) {
  lookupRegistry.register({
    module: 'hr', name, label, permission: 'hr.requisition.view', columns: cols,
    search(db, actor, q) {
      const where = ["company_id = ?", "status = 'ACTIVE'", 'is_active = 1', 'deleted_at IS NULL']; const args = [actor.companyId];
      if (q.ids) { where.push(`id IN (${q.ids.map(() => '?').join(',')})`); args.push(...q.ids); }
      if (q.text) { where.push('(code LIKE ? OR name LIKE ?)'); args.push(`${q.text}%`, `%${q.text}%`); }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where.join(' AND ')}`).get(...args).n;
      const rows = db.prepare(`SELECT id, code, name${extra} FROM ${table} WHERE ${where.join(' AND ')} ORDER BY code LIMIT ? OFFSET ?`).all(...args, q.ids ? 200 : q.limit, q.ids ? 0 : q.offset);
      return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, extra: { grade: r.grade ?? '', level: r.level ?? '' } })), total };
    },
  });
}

const find = (table, extra = '') => (ctx, v) => ctx.db.prepare(`SELECT id, code FROM ${table} WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1 ${extra}`).all(ctx.companyId, v);
const codes = (table, extra = '') => (ctx) => ctx.db.prepare(`SELECT code FROM ${table} WHERE company_id = ? AND is_active = 1 ${extra}`).all(ctx.companyId).map((r) => r.code);
const idOf = (db, table, companyId, code) => (code ? db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1`).get(companyId, code)?.id ?? null : null);
const yes = (v) => v === true;
const phone = (v) => (v ? String(v).replace(/[\s-]/g, '').replace(/^(\+91|0)/, '') : null);

/** What earlier rows of the same file already hold (the engine hands one ctx to every row of a file): a PAN or Aadhaar twice in a file is caught before anything is saved. */
const inFile = new WeakMap();
registerImportType({
  code: 'HR_EMPLOYEE', label: 'Employees (new, sent for approval)', module: 'hr',
  description: 'Each row enters an employee and sends it for approval by the HR manager. Department, designation, branch, cost centre and site are given by their codes; the manager by employee code. PAN, mobile, bank and the emergency contact are checked; a duplicate PAN or Aadhaar is refused.',
  permission: 'hr.employee.import', exportPermission: 'hr.employee.export', onExisting: ['ERROR'], chunked: true,
  columns: [
    { key: 'firstName', label: 'First name', type: 'text', required: true, maxLength: 60 }, { key: 'lastName', label: 'Last name', type: 'text', maxLength: 60 },
    { key: 'gender', label: 'Gender', type: 'enum', values: GENDERS, required: true }, { key: 'dob', label: 'Date of birth', type: 'date', required: true },
    { key: 'mobile', label: 'Mobile', type: 'text', required: true, maxLength: 16 }, { key: 'email', label: 'E-mail', type: 'text', maxLength: 160 },
    { key: 'department', label: 'Department code', type: 'lookup', required: true, lookup: { noun: 'department', resolve: find('org_departments'), list: codes('org_departments') } },
    { key: 'designation', label: 'Designation code', type: 'lookup', required: true, lookup: { noun: 'designation', resolve: find('org_designations'), list: codes('org_designations') } },
    { key: 'branch', label: 'Branch code', type: 'lookup', lookup: { noun: 'branch', resolve: find('org_branches'), list: codes('org_branches') } },
    { key: 'costCentre', label: 'Cost centre code', type: 'lookup', lookup: { noun: 'cost centre', resolve: find('org_cost_centres'), list: codes('org_cost_centres') } },
    { key: 'employmentType', label: 'Employment type', type: 'enum', values: EMPLOYMENT_TYPES, required: true }, { key: 'doj', label: 'Date of joining', type: 'date', required: true },
    { key: 'manager', label: 'Manager (employee code)', type: 'text', maxLength: 30 },
    { key: 'locationType', label: 'Work location', type: 'enum', values: ['HO', 'SITE'], required: true }, { key: 'site', label: 'Site code', type: 'lookup', lookup: { noun: 'site', resolve: find('org_sites'), list: codes('org_sites') } },
    { key: 'pan', label: 'PAN', type: 'text', maxLength: 10 }, { key: 'aadhaar', label: 'Aadhaar (12 digits; only the last four are kept)', type: 'text', maxLength: 12 },
    { key: 'uan', label: 'UAN', type: 'text', maxLength: 12 }, { key: 'esicIp', label: 'ESIC IP number', type: 'text', maxLength: 17 },
    { key: 'pf', label: 'PF applicable', type: 'bool' }, { key: 'esi', label: 'ESI applicable', type: 'bool' }, { key: 'ptState', label: 'PT state code', type: 'text', maxLength: 3 },
    { key: 'accountNo', label: 'Bank account number', type: 'text', maxLength: 18 }, { key: 'ifsc', label: 'IFSC', type: 'text', maxLength: 11 }, { key: 'accountName', label: 'Name on the account', type: 'text', maxLength: 120 },
    { key: 'emergencyName', label: 'Emergency contact name', type: 'text', required: true, maxLength: 100 }, { key: 'emergencyRelation', label: 'Emergency contact relation', type: 'text', required: true, maxLength: 40 }, { key: 'emergencyPhone', label: 'Emergency contact phone', type: 'text', required: true, maxLength: 16 },
    { key: 'notDuplicate', label: 'Not a duplicate', type: 'bool', help: 'Yes when the row looks like an existing employee (same mobile, or the same name and date of birth) but is a different person.' },
  ],
  keys: ['mobile', 'dob'],
  findExisting: () => null,
  validateRow(ctx, row) {
    const s = employeesOf(ctx.db);
    const b = bodyOf(ctx, row);
    const c = s.registration.check(ctx.actor, b);
    const out = c.errors.map((e) => ({ column: colOf(e.field), message: e.message }));
    if (row.accountNo && !row.ifsc) out.push({ column: 'ifsc', message: 'Give the IFSC with the account number' });
    if (!row.accountNo && b.salaryPaymentMode === 'BANK_TRANSFER') out.push({ column: 'accountNo', message: 'Give the bank account for the salary transfer' });
    if (!row.pan) out.push({ column: 'pan', message: 'PAN is required' });
    if (row.manager && !b.managerId) out.push({ column: 'manager', message: `${row.manager} is not an approved employee` });
    const seen = inFile.get(ctx) ?? { pan: new Map(), aadhaar: new Map(), mobile: new Map(), byDob: new Map() }; inFile.set(ctx, seen);
    for (const [k, v] of [['pan', b.statutory?.pan], ['aadhaar', b.statutory?.aadhaar?.length === 12 ? b.statutory.aadhaar : null]]) if (v) { if (seen[k].has(v)) out.push({ column: k, message: `The same ${k === 'pan' ? 'PAN' : 'Aadhaar'} is in another row of this file (${seen[k].get(v)})`, code: 'DUPLICATE' }); else seen[k].set(v, `${row.firstName} ${row.lastName ?? ''}`.trim()); }
    // possible duplicates among the rows of this file (same mobile, or the same name and date of birth) warn like those against the records
    const full = nameKey(`${row.firstName} ${row.lastName ?? ''}`);
    const twin = seen.mobile.get(b.mobile) ?? (seen.byDob.get(row.dob) ?? []).find((x) => similarity(full, x.key) >= 90);
    if (twin && !yes(row.notDuplicate)) out.push({ column: seen.mobile.has(b.mobile) ? 'mobile' : 'firstName', message: `Looks like ${twin.name ?? twin} in another row of this file (${seen.mobile.has(b.mobile) ? 'same mobile' : 'same name and date of birth'}): write Yes in "Not a duplicate" if it is a different person`, code: 'POSSIBLE_DUPLICATE' });
    seen.mobile.set(b.mobile, { name: `${row.firstName} ${row.lastName ?? ''}`.trim() });
    seen.byDob.set(row.dob, [...(seen.byDob.get(row.dob) ?? []), { key: full, name: `${row.firstName} ${row.lastName ?? ''}`.trim() }]);
    for (const d of c.duplicates) if (d.block || !yes(row.notDuplicate)) out.push({ column: colOf(d.field), message: `${d.rule} as ${d.code} ${d.name}${d.block ? '' : ': write Yes in "Not a duplicate" if it is a different person'}`, code: d.block ? 'DUPLICATE' : 'POSSIBLE_DUPLICATE' });
    return out;
  },
  commitRow(ctx, { row }) {
    const r = employeesOf(ctx.db).registration.create(ctx.actor, { ...bodyOf(ctx, row), acknowledgeDuplicates: yes(row.notDuplicate), submit: true, comment: 'Imported from Excel' });
    return { id: r.id, ref: `${r.code} (waiting for approval)` };
  },
});
const colOf = (f) => ({ firstName: 'firstName', mobile: 'mobile', dob: 'dob', doj: 'doj', email: 'email', 'statutory.pan': 'pan', 'statutory.aadhaar': 'aadhaar', 'statutory.uan': 'uan', 'statutory.esicIp': 'esicIp', 'bank.accountNo': 'accountNo', 'bank.ifsc': 'ifsc', departmentId: 'department', designationId: 'designation', branchId: 'branch', costCentreId: 'costCentre', managerId: 'manager', siteId: 'site', confirmationDate: 'doj' }[String(f ?? '')] ?? (String(f ?? '').startsWith('contacts') ? 'emergencyPhone' : String(f ?? '').split('.')[0]));
function bodyOf(ctx, row) {
  const db = ctx.db; const c = ctx.companyId;
  const manager = row.manager ? db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND emp_code = ? COLLATE NOCASE AND record_status = 'APPROVED' AND deleted_at IS NULL").get(c, row.manager)?.id ?? null : null;
  const aad = row.aadhaar ? String(row.aadhaar).replace(/\s/g, '') : null;
  return {
    firstName: row.firstName, lastName: row.lastName ?? null, gender: row.gender, dob: row.dob, bloodGroup: null, maritalStatus: null, mobile: phone(row.mobile), email: row.email ? String(row.email).toLowerCase() : null, permanentAddress: null, currentAddress: null,
    branchId: idOf(db, 'org_branches', c, row.branch), departmentId: idOf(db, 'org_departments', c, row.department), designationId: idOf(db, 'org_designations', c, row.designation), grade: null,
    employmentType: row.employmentType, doj: row.doj, confirmationDate: null, managerId: manager, costCentreId: idOf(db, 'org_cost_centres', c, row.costCentre),
    locationType: row.locationType, projectId: null, siteId: idOf(db, 'org_sites', c, row.site), salaryPaymentMode: row.accountNo ? 'BANK_TRANSFER' : 'CASH', languages: [], skills: [],
    contacts: [{ type: 'EMERGENCY', name: row.emergencyName, relation: row.emergencyRelation, phone: phone(row.emergencyPhone), dob: null, sharePct: null }], education: [], experience: [],
    statutory: { pan: row.pan ? String(row.pan).toUpperCase() : null, aadhaar: aad, uan: row.uan ?? null, esicIp: row.esicIp ?? null, pfApplicable: yes(row.pf), esiApplicable: yes(row.esi), ptState: row.ptState ? String(row.ptState).toUpperCase() : null, lwfState: null },
    bank: row.accountNo ? { accountNo: String(row.accountNo).replace(/\s/g, ''), ifsc: String(row.ifsc ?? '').toUpperCase(), accountName: row.accountName || `${row.firstName} ${row.lastName ?? ''}`.trim() } : null,
  };
}
