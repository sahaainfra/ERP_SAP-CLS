import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { authzOf } from '../../platform/authz/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { addDays } from './att-calc.js';

// Employee advances, expense claims and travel (part 07.12). A travel request asks for a trip; an advance (salary, travel or imprest) is approved, then paid by accounts, and is recovered by payroll in instalments (salary) or settled against a claim
// (travel, imprest); a claim has lines (travel, lodging, food, local conveyance, site purchase, per diem, mileage) with GST details, a bill photo, a project and a cost code. Per diem and mileage are computed from the policy of the grade, a line
// over its limit needs a justification and shows as a flag to the approver, a receipt is mandatory above the threshold, the same bill (vendor, invoice number, amount) is never paid twice, and an old claim needs a higher approval. An approved claim settles
// against the advance (net payable or recoverable); the accounts manager passes it for payment and the payment (23.04) and the posting (23.02) follow from the events. Money is kept in paise.
export const CLAIM_DOC = 'HR_EXP_CLAIM'; export const ADVANCE_DOC = 'HR_EXP_ADVANCE'; export const TRAVEL_DOC = 'HR_EXP_TRAVEL';
export const CATEGORIES = { TRAVEL: 'Travel', LODGING: 'Lodging', FOOD: 'Food', LOCAL_CONVEYANCE: 'Local conveyance', SITE_PURCHASE: 'Site purchase', PER_DIEM: 'Per diem', MILEAGE: 'Mileage', OTHER: 'Other' };
export const CLAIM_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved, to be passed for payment', PASSED: 'Passed for payment', PAID: 'Paid', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const ADVANCE_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved, to be paid', DISBURSED: 'Paid out', CLOSED: 'Closed', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const TRAVEL_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed' };
export const ADVANCE_TYPES = { SALARY: 'Salary advance', TRAVEL: 'Travel advance', IMPREST: 'Imprest' };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const minor = (rupees) => Math.round(Number(rupees) * 100);
const money = (m) => (m == null ? null : Math.round(m) / 100);
const L = 100_000;

for (const [key, dataType, def, description, extra] of [
  ['exp.claim.max_age_days', 'integer', 60, 'BR-03: a claim with a bill older than this many days needs the next higher approval and a justification.', { min: 1, max: 730 }],
  ['exp.receipt.threshold_minor', 'integer', 50_000, 'FR-04: a bill above this amount (paise) must have its photo or scan; a policy may set its own threshold.', { min: 0, max: 100_000_000 }],
  ['exp.duplicate.mode', 'string', 'BLOCK', 'BR-02: a bill with the same vendor, invoice number and amount as one claimed already is refused (BLOCK) or sent with a flag the approver sees (WARN).', {}],
  ['exp.advance.salary_max_minor', 'integer', 10_000_000, 'FR-02: the most a salary advance may be (paise).', { min: 0, max: 1_000_000_000 }],
  ['exp.advance.salary_cfo_above_minor', 'integer', 5_000_000, 'A salary advance above this (paise, about one month salary until payroll holds salaries) goes to the CFO too.', { min: 0, max: 1_000_000_000 }],
  ['exp.advance.max_instalments', 'integer', 24, 'FR-02: the most instalments a salary advance is recovered in.', { min: 1, max: 36 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const claimList = defineList({
  code: 'hr.claims', label: 'Expense claims', permission: 'hr.claim.view',
  from: 'exp_claims c JOIN hr_employees e ON e.id = c.employee_id', where: 'c.deleted_at IS NULL', searchable: ['c.doc_no', 'e.full_name', 'e.emp_code', 'c.purpose'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'c.doc_no', type: 'text', label: 'Claim' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, purpose: { sql: 'c.purpose', type: 'text', label: 'Purpose' },
    periodFrom: { sql: 'c.period_from', type: 'date', label: 'From' }, periodTo: { sql: 'c.period_to', type: 'date', label: 'To' }, total: { sql: 'c.total_minor', type: 'number', label: 'Total (paise)' }, net: { sql: 'c.net_payable_minor', type: 'number', label: 'Net payable (paise)' },
    flags: { sql: 'c.flag_count', type: 'number', label: 'Flags' }, status: { sql: 'c.status', type: 'enum', label: 'Status', options: Object.entries(CLAIM_STATUS) },
  },
});
export const advanceList = defineList({
  code: 'hr.advances', label: 'Advances', permission: 'hr.advance.view',
  from: 'exp_advances a JOIN hr_employees e ON e.id = a.employee_id', where: 'a.deleted_at IS NULL', searchable: ['a.doc_no', 'e.full_name', 'e.emp_code', 'a.purpose'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'a.doc_no', type: 'text', label: 'Advance' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, type: { sql: 'a.advance_type', type: 'enum', label: 'Kind', options: Object.entries(ADVANCE_TYPES) },
    purpose: { sql: 'a.purpose', type: 'text', label: 'Purpose' }, amount: { sql: 'a.amount_minor', type: 'number', label: 'Amount (paise)' }, balance: { sql: 'a.balance_minor', type: 'number', label: 'Outstanding (paise)' }, status: { sql: 'a.status', type: 'enum', label: 'Status', options: Object.entries(ADVANCE_STATUS) },
  },
});
export const travelList = defineList({
  code: 'hr.travel_requests', label: 'Travel requests', permission: 'hr.travel_request.view',
  from: 'exp_travel_requests t JOIN hr_employees e ON e.id = t.employee_id LEFT JOIN org_projects p ON p.id = t.project_id', where: 't.deleted_at IS NULL', searchable: ['t.doc_no', 'e.full_name', 't.purpose', 't.to_place'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 't.doc_no', type: 'text', label: 'Request' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, purpose: { sql: 't.purpose', type: 'text', label: 'Purpose' }, project: { sql: 'p.name', type: 'text', label: 'Project' },
    from: { sql: 't.from_place', type: 'text', label: 'From' }, to: { sql: 't.to_place', type: 'text', label: 'To' }, startDate: { sql: 't.start_date', type: 'date', label: 'Start' }, endDate: { sql: 't.end_date', type: 'date', label: 'End' },
    estCost: { sql: 't.est_cost_minor', type: 'number', label: 'Estimated cost (paise)' }, status: { sql: 't.status', type: 'enum', label: 'Status', options: Object.entries(TRAVEL_STATUS) },
  },
});

export function createExpenseService({ db, dep }) {
  const { may, need, nextDoc, event, usernameOf, myEmployee } = dep;
  const notif = notificationsOf(db);
  const today = () => todayIST();
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: today() });
  const maker = (actor, r) => same(r.created_by, actor.user);
  const emp = (id) => db.prepare('SELECT e.*, g.name AS designation, g.grade AS desig_grade, g.level AS grade_level, u.username FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN iam_users u ON u.id = e.user_id WHERE e.id = ?').get(id);
  const reportees = (employeeId) => new Set(db.prepare('WITH RECURSIVE r(id, depth) AS (SELECT id, 1 FROM hr_employees WHERE manager_id = ? AND deleted_at IS NULL UNION SELECT e.id, r.depth + 1 FROM hr_employees e JOIN r ON e.manager_id = r.id WHERE e.deleted_at IS NULL AND r.depth < 12) SELECT id FROM r').all(employeeId).map((x) => x.id));
  const meOf = (actor) => { const id = myEmployee(actor); if (!id) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record, so you cannot raise claims or advances. Ask HR to link it.'); return emp(id); };
  const KINDS = {
    claim: { table: 'exp_claims', doc: CLAIM_DOC, perm: 'hr.claim', prefix: 'CLM', label: 'Expense claim', labels: CLAIM_STATUS, link: '/expenses/claim' },
    advance: { table: 'exp_advances', doc: ADVANCE_DOC, perm: 'hr.advance', prefix: 'ADV', label: 'Advance', labels: ADVANCE_STATUS, link: '/expenses/advance' },
    travel: { table: 'exp_travel_requests', doc: TRAVEL_DOC, perm: 'hr.travel_request', prefix: 'TRV', label: 'Travel request', labels: TRAVEL_STATUS, link: '/expenses/travel' },
  };
  /** A record is seen by its owner, by the people above the owner in the reporting line, and by those who see all of its kind. */
  const canSee = (actor, kind, employeeId) => { if (may(actor, `${KINDS[kind].perm}.view_all`)) return true; const me = myEmployee(actor); return Boolean(me && (me === employeeId || reportees(me).has(employeeId))); };
  const rowOf = (actor, kind, id) => {
    const r = db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(id, actor.companyId);
    if (!r || !(maker(actor, r) || canSee(actor, kind, r.employee_id))) throw notFound(`That ${KINDS[kind].label.toLowerCase()} does not exist.`);
    return r;
  };
  const scopeIds = (actor, kind) => { if (may(actor, `${KINDS[kind].perm}.view_all`)) return null; const me = myEmployee(actor); return [...(me ? [me, ...reportees(me)] : [])]; };
  const scopeSql = (actor, kind, alias) => { const ids = scopeIds(actor, kind); return `${alias}.company_id = :c${ids ? ` AND ${alias}.employee_id IN (${ids.length ? ids.join(',') : '0'})` : ''}`; };
  const tell = (companyId, to, kind, ref, title, outcome, comment) => to && notif.notify({ companyId, templateCode: 'exp.decided', recipients: [`user:${to}`], data: { what: KINDS[kind].label, ref, title, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : outcome, comment: comment ? `: ${comment}` : '' }, link: KINDS[kind].link, sourceType: KINDS[kind].table, sourceId: ref, eventKey: `exp.decided:${ref}:${outcome}` });

  // ------------------------------------------------------------------ policies (FR-04, the Config page)
  const policyView = (p) => ({ id: p.id, grade: p.grade, category: p.category, cityTier: p.city_tier, limit: money(p.limit_minor), perDiem: money(p.per_diem_minor), mileageRate: money(p.mileage_rate_minor), receiptAbove: money(p.receipt_above_minor), effectiveFrom: p.effective_from, effectiveTo: p.effective_to, status: p.policy_status, rowVersion: p.version, createdBy: p.created_by, updatedBy: p.updated_by });
  const policies = {
    list(actor) { need(actor, 'hr.expense.configure', 'see the expense policies'); return db.prepare('SELECT * FROM exp_policies WHERE company_id = ? AND deleted_at IS NULL ORDER BY policy_status, category, grade, city_tier, effective_from DESC').all(actor.companyId).map(policyView); },
    save(actor, b) {
      need(actor, 'hr.expense.configure', 'keep the expense policies');
      if (b.effectiveTo && b.effectiveTo < b.effectiveFrom) throw badRequest('Some fields are not valid.', [{ field: 'effectiveTo', message: 'The policy cannot end before it starts' }]);
      const cols = [b.grade, b.category, b.cityTier, minor(b.limit ?? 0), minor(b.perDiem ?? 0), minor(b.mileageRate ?? 0), b.receiptAbove == null ? null : minor(b.receiptAbove), b.effectiveFrom, b.effectiveTo ?? null];
      if (b.id) {
        const p = db.prepare('SELECT * FROM exp_policies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.id, actor.companyId); if (!p) throw notFound('That policy does not exist.');
        if (b.version !== p.version) throw conflict('This policy was changed by someone else. Reload it and try again.');
        db.prepare("UPDATE exp_policies SET grade = ?, category = ?, city_tier = ?, limit_minor = ?, per_diem_minor = ?, mileage_rate_minor = ?, receipt_above_minor = ?, effective_from = ?, effective_to = ?, policy_status = CASE WHEN policy_status = 'RETIRED' THEN 'RETIRED' ELSE 'DRAFT' END, activated_by = NULL, activated_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(...cols, actor.user, nowIso(), p.id);
        writeAudit(db, { entity: 'exp_policies', entityId: p.id, action: 'update', oldValues: { limit: money(p.limit_minor), perDiem: money(p.per_diem_minor), mileageRate: money(p.mileage_rate_minor), status: p.policy_status }, newValues: { limit: b.limit, perDiem: b.perDiem, mileageRate: b.mileageRate }, actor: actor.user, companyId: actor.companyId });
        return policyView(db.prepare('SELECT * FROM exp_policies WHERE id = ?').get(p.id));
      }
      const id = Number(db.prepare("INSERT INTO exp_policies (company_id, grade, category, city_tier, limit_minor, per_diem_minor, mileage_rate_minor, receipt_above_minor, effective_from, effective_to, policy_status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'exp_policy')").run(actor.companyId, ...cols, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'exp_policies', entityId: id, action: 'create', newValues: { grade: b.grade, category: b.category, cityTier: b.cityTier }, actor: actor.user, companyId: actor.companyId });
      return policyView(db.prepare('SELECT * FROM exp_policies WHERE id = ?').get(id));
    },
    activate(actor, id) {
      need(actor, 'hr.expense.config_approve', 'activate expense policies');
      const p = db.prepare('SELECT * FROM exp_policies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!p) throw notFound('That policy does not exist.');
      if (p.policy_status === 'ACTIVE') throw conflict('This policy is active already.');
      if (p.policy_status === 'RETIRED') throw unprocessable('A retired policy is not activated: make a new one.');
      if (same(actor.user, p.updated_by ?? p.created_by)) throw forbidden('You made or changed this policy: somebody else activates it.');
      db.prepare("UPDATE exp_policies SET policy_status = 'ACTIVE', activated_by = ?, activated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
      writeAudit(db, { entity: 'exp_policies', entityId: id, action: 'activate', actor: actor.user, companyId: actor.companyId });
      return policyView(db.prepare('SELECT * FROM exp_policies WHERE id = ?').get(id));
    },
    retire(actor, id) {
      need(actor, 'hr.expense.config_approve', 'retire expense policies');
      const p = db.prepare('SELECT * FROM exp_policies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!p) throw notFound('That policy does not exist.');
      db.prepare("UPDATE exp_policies SET policy_status = 'RETIRED', effective_to = COALESCE(effective_to, ?), version = version + 1 WHERE id = ?").run(today(), id);
      writeAudit(db, { entity: 'exp_policies', entityId: id, action: 'retire', actor: actor.user, companyId: actor.companyId });
      return policyView(db.prepare('SELECT * FROM exp_policies WHERE id = ?').get(id));
    },
    history(actor, id) {
      need(actor, 'hr.expense.configure', 'see the history of a policy');
      // The policy is read in the caller's company first: another company's history is not found (audit AUD-DEF-013).
      if (!db.prepare('SELECT 1 FROM exp_policies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId)) throw notFound('That policy does not exist.');
      return db.prepare("SELECT action, actor, old_values, new_values, created_at FROM core_audit_log WHERE entity = 'exp_policies' AND entity_id = ? ORDER BY id").all(String(id)).map((a) => ({ action: a.action, by: a.actor, at: a.created_at, old: json(a.old_values, null), new: json(a.new_values, null) }));
    },
    /** The policy that applies: the most specific active one (category, then grade, then city tier) in force on the day. */
    find(companyId, grade, category, tier, on) {
      const rows = db.prepare("SELECT * FROM exp_policies WHERE company_id = ? AND deleted_at IS NULL AND policy_status = 'ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND category IN (?, '*') AND grade IN (?, '*') AND city_tier IN (?, '*')").all(companyId, on, on, category, grade ?? '', tier);
      const score = (p) => (p.category === category ? 4 : 0) + (p.grade === grade ? 2 : 0) + (p.city_tier === tier ? 1 : 0);
      return rows.sort((a, b) => score(b) - score(a) || b.effective_from.localeCompare(a.effective_from))[0] ?? null;
    },
  };
  const gradeOf = (e) => e.grade ?? e.desig_grade ?? null;

  // ------------------------------------------------------------------ the claim: lines, policy checks, flags, settlement
  const lineView = (l) => ({ id: l.id, lineNo: l.line_no, category: l.category, categoryLabel: CATEGORIES[l.category], date: l.spend_date, description: l.description, amount: money(l.amount_minor), gst: money(l.gst_minor), vendorName: l.vendor_name, vendorGstin: l.vendor_gstin, invoiceNo: l.invoice_no, fileId: l.file_id, costCodeId: l.cost_code_id, costCode: l.cost_code_id ? db.prepare('SELECT code FROM fin_cost_codes WHERE id = ?').get(l.cost_code_id)?.code ?? null : null, projectId: l.project_id, project: l.project_id ? db.prepare('SELECT name FROM org_projects WHERE id = ?').get(l.project_id)?.name ?? null : null, km: l.km, days: l.days, limit: money(l.limit_minor), flag: l.policy_flag, flagText: l.flag_text, justification: l.justification });
  const claimLines = (id) => db.prepare('SELECT * FROM exp_claim_lines WHERE claim_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  /** The duplicate check (BR-02): the same vendor (GSTIN, else name), invoice number and amount in a claim that is alive, or twice in this one. */
  const duplicateOf = (companyId, claimId, l) => {
    if (!l.invoiceNo) return null;
    const vend = l.vendorGstin ? 'upper(l.vendor_gstin) = upper(?)' : 'lower(l.vendor_name) = lower(?)';
    return db.prepare(`SELECT l.id, c.doc_no FROM exp_claim_lines l JOIN exp_claims c ON c.id = l.claim_id WHERE l.company_id = ? AND l.claim_id != ? AND l.deleted_at IS NULL AND c.deleted_at IS NULL AND c.status NOT IN ('CANCELLED', 'REJECTED', 'DRAFT', 'RETURNED') AND ${vend} AND lower(l.invoice_no) = lower(?) AND l.amount_minor = ? LIMIT 1`).get(companyId, claimId, l.vendorGstin ?? l.vendorName ?? '', l.invoiceNo, l.amountMinor) ?? null;
  };
  /** Computes every line again on the server: per diem and mileage from the policy, the limit and the flags, the totals. A figure the client sent that differs from the computed one is refused. */
  function prepare(actor, e, header, lines, claimId) {
    const t = today(); const maxAge = Number(param(actor.companyId, 'exp.claim.max_age_days')) || 60; const dupMode = String(param(actor.companyId, 'exp.duplicate.mode')).toUpperCase();
    const receiptDefault = Number(param(actor.companyId, 'exp.receipt.threshold_minor')) || 0;
    const problems = []; const submitProblems = []; const rows = []; const seen = new Set();
    lines.forEach((l, i) => {
      const at = `lines.${i}`; const on = l.date;
      const pol = policies.find(actor.companyId, gradeOf(e), l.category, header.cityTier, on);
      const row = { lineNo: i + 1, category: l.category, spendDate: on, description: l.description, vendorName: l.vendorName ?? null, vendorGstin: l.vendorGstin ? l.vendorGstin.toUpperCase() : null, invoiceNo: l.invoiceNo ?? null, fileId: l.fileId ?? null, costCodeId: l.costCodeId ?? null, projectId: l.projectId ?? null, km: null, days: null, justification: l.justification ?? null, gstMinor: minor(l.gst ?? 0), flags: [] };
      if (l.category === 'PER_DIEM') {
        if (!l.days) problems.push({ field: `${at}.days`, message: 'Give the number of days' });
        else if (!pol?.per_diem_minor) problems.push({ field: `${at}.category`, message: `No per-diem policy is active for grade ${gradeOf(e) ?? '—'} (${header.cityTier}): ask HR to set it` });
        else { row.days = l.days; row.amountMinor = l.days * pol.per_diem_minor; if (l.amount != null && minor(l.amount) !== row.amountMinor) problems.push({ field: `${at}.amount`, message: `The per diem is ${money(row.amountMinor)} (${l.days} days at ${money(pol.per_diem_minor)}): the amount is computed by the system` }); }
      } else if (l.category === 'MILEAGE') {
        if (!l.km) problems.push({ field: `${at}.km`, message: 'Give the kilometres' });
        else if (!pol?.mileage_rate_minor) problems.push({ field: `${at}.category`, message: `No mileage rate is active for grade ${gradeOf(e) ?? '—'}: ask HR to set it` });
        else { row.km = l.km; row.amountMinor = l.km * pol.mileage_rate_minor; if (l.amount != null && minor(l.amount) !== row.amountMinor) problems.push({ field: `${at}.amount`, message: `The mileage is ${money(row.amountMinor)} (${l.km} km at ${money(pol.mileage_rate_minor)}): the amount is computed by the system` }); }
      } else {
        if (l.amount == null) problems.push({ field: `${at}.amount`, message: 'Give the amount' }); else row.amountMinor = minor(l.amount);
      }
      if (row.amountMinor == null) { rows.push(row); return; }
      if (row.amountMinor <= 0) problems.push({ field: `${at}.amount`, message: 'The amount must be more than zero' });
      if (on > t) problems.push({ field: `${at}.date`, message: 'The date of a bill cannot be in the future' });
      if (row.gstMinor > row.amountMinor) problems.push({ field: `${at}.gst`, message: 'The GST cannot be more than the amount' });
      if (row.gstMinor > 0 && !(row.vendorGstin && row.invoiceNo)) problems.push({ field: `${at}.vendorGstin`, message: 'A line with GST needs the vendor GSTIN and the invoice number (for the input tax credit)' });
      if (row.vendorGstin && !GSTIN.test(row.vendorGstin)) problems.push({ field: `${at}.vendorGstin`, message: 'The GSTIN is not valid (15 characters, for example 27ABCDE1234F1Z5)' });
      if (row.fileId && !db.prepare('SELECT 1 FROM core_files WHERE id = ? AND company_id = ?').get(row.fileId, actor.companyId)) problems.push({ field: `${at}.fileId`, message: 'That bill photo does not exist' });
      if (row.costCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND (company_id = ? OR company_id IS NULL)').get(row.costCodeId, actor.companyId)) problems.push({ field: `${at}.costCodeId`, message: 'That cost code does not exist' });
      if (row.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(row.projectId, actor.companyId)) problems.push({ field: `${at}.projectId`, message: 'That project does not exist' });
      row.limitMinor = pol?.limit_minor || null;
      if (pol?.limit_minor && !['PER_DIEM', 'MILEAGE'].includes(l.category) && row.amountMinor > pol.limit_minor) row.flags.push(['OVER_LIMIT', `Over the limit of ${money(pol.limit_minor)} for grade ${gradeOf(e) ?? '—'}`]);
      const receiptAt = pol?.receipt_above_minor ?? receiptDefault;
      if (!['PER_DIEM', 'MILEAGE'].includes(l.category) && row.amountMinor > receiptAt && !row.fileId) row.flags.push(['NO_RECEIPT', `A bill above ${money(receiptAt)} needs its photo`]);
      if (on < addDays(t, -maxAge)) row.flags.push(['OLD', `The bill is older than ${maxAge} days`]);
      const key = `${(row.vendorGstin ?? row.vendorName ?? '').toLowerCase()}|${(row.invoiceNo ?? '').toLowerCase()}|${row.amountMinor}`;
      const dup = row.invoiceNo ? duplicateOf(actor.companyId, claimId ?? 0, { ...row, amountMinor: row.amountMinor }) : null;
      if (dup || (row.invoiceNo && seen.has(key))) row.flags.push(['DUPLICATE', dup ? `The same bill is in claim ${dup.doc_no}` : 'The same bill is twice in this claim']);
      if (row.invoiceNo) seen.add(key);
      rows.push(row);
    });
    let deviation = false;
    for (const r of rows) {
      r.policyFlag = r.flags[0]?.[0] ?? 'NONE'; r.flagText = r.flags.map((f) => f[1]).join('; ') || null;
      for (const [f, text] of r.flags) {
        if (f === 'NO_RECEIPT') submitProblems.push({ field: `lines.${r.lineNo - 1}.fileId`, message: text });
        else if (f === 'DUPLICATE' && dupMode !== 'WARN') submitProblems.push({ field: `lines.${r.lineNo - 1}.invoiceNo`, message: `${text}: a bill is paid once` });
        else { deviation = true; if (!(r.justification && r.justification.trim().length >= 5)) submitProblems.push({ field: `lines.${r.lineNo - 1}.justification`, message: `${text}: write why (at least 5 characters)` }); }
      }
    }
    const total = rows.reduce((s, r) => s + (r.amountMinor ?? 0), 0); const gst = rows.reduce((s, r) => s + r.gstMinor, 0);
    return { rows, total, gst, problems, submitProblems, deviation, flagCount: rows.filter((r) => r.policyFlag !== 'NONE').length };
  }
  const levelOf = (totalMinor, deviation) => Math.min(3, (totalMinor <= 25_000 * 100 ? 1 : totalMinor <= L * 100 ? 2 : 3) + (deviation ? 1 : 0));
  /** FR-05: the advance a claim settles against: the employee's own, paid out, with something outstanding. */
  function settlementOf(actor, e, advanceId, totalMinor) {
    if (!advanceId) return { advance: null, adjusted: 0, recoverable: 0 };
    const a = db.prepare("SELECT * FROM exp_advances WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(advanceId, actor.companyId);
    if (!a || a.employee_id !== e.id) throw badRequest('Some fields are not valid.', [{ field: 'advanceId', message: 'That advance is not yours' }]);
    if (a.status !== 'DISBURSED' || a.balance_minor <= 0) throw badRequest('Some fields are not valid.', [{ field: 'advanceId', message: 'That advance is not paid out, or nothing is outstanding on it' }]);
    if (a.recovery_mode !== 'SETTLEMENT') throw badRequest('Some fields are not valid.', [{ field: 'advanceId', message: 'A salary advance is recovered from salary, not settled against a claim' }]);
    const adjusted = Math.min(totalMinor, a.balance_minor);
    return { advance: a, adjusted, recoverable: a.balance_minor - adjusted };
  }
  function claimView(actor, c, { detail = false } = {}) {
    const e = emp(c.employee_id); const mine = myEmployee(actor) === c.employee_id; const editable = ['DRAFT', 'RETURNED'].includes(c.status) && maker(actor, c);
    const out = {
      id: c.id, docNo: c.doc_no, status: c.status, statusLabel: CLAIM_STATUS[c.status], rowVersion: c.version, employeeId: c.employee_id, employee: e?.full_name, employeeCode: e?.emp_code, grade: gradeOf(e), periodFrom: c.period_from, periodTo: c.period_to, purpose: c.purpose, cityTier: c.city_tier,
      travelRequestId: c.travel_request_id, advanceId: c.advance_id, total: money(c.total_minor), gst: money(c.gst_minor), advanceAdjusted: money(c.advance_adjusted_minor), netPayable: money(c.net_payable_minor), recoverable: money(c.recoverable_minor), flagCount: c.flag_count, level: c.level, workflowInstanceId: c.workflow_instance_id, requestedBy: c.requested_by,
      approvedAt: c.approved_at, passedAt: c.passed_at, paidAt: c.paid_at, paidRef: c.paid_ref, mine,
      can: { edit: editable, submit: editable && may(actor, 'hr.claim.submit'), delete: c.status === 'DRAFT' && maker(actor, c) && may(actor, 'hr.claim.delete'), withdraw: c.status === 'SUBMITTED' && same(c.requested_by, actor.user), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(c.status) && (maker(actor, c) || may(actor, 'hr.claim.pass')) && may(actor, 'hr.claim.cancel'), pass: c.status === 'APPROVED' && may(actor, 'hr.claim.pass') && !mine, paid: c.status === 'PASSED' && may(actor, 'hr.claim.pass'), print: may(actor, 'hr.claim.print') },
    };
    if (detail) { out.lines = claimLines(c.id).map(lineView); out.openAdvances = db.prepare("SELECT id, doc_no, balance_minor, advance_type FROM exp_advances WHERE employee_id = ? AND status = 'DISBURSED' AND balance_minor > 0 AND recovery_mode = 'SETTLEMENT' AND deleted_at IS NULL").all(c.employee_id).map((a) => ({ id: a.id, docNo: a.doc_no, outstanding: money(a.balance_minor), type: a.advance_type })); }
    return out;
  }
  const headerCheck = (actor, e, b) => {
    const p = [];
    if (b.periodTo < b.periodFrom) p.push({ field: 'periodTo', message: 'The period cannot end before it starts' });
    if (b.travelRequestId) { const t = db.prepare('SELECT * FROM exp_travel_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.travelRequestId, actor.companyId); if (!t || t.employee_id !== e.id) p.push({ field: 'travelRequestId', message: 'That travel request is not yours' }); else if (!['APPROVED', 'CLOSED'].includes(t.status)) p.push({ field: 'travelRequestId', message: 'That travel request is not approved' }); }
    return p;
  };
  const claims = {
    list(actor, query) {
      need(actor, 'hr.claim.view', 'see claims');
      return runList(db, claimList, parseListRequest(claimList, query), { select: 'c.*', scopeSql: scopeSql(actor, 'claim', 'c'), params: { c: actor.companyId }, tieBreaker: 'c.id', map: (c) => claimView(actor, c) });
    },
    exportSource(actor, req) {
      need(actor, 'hr.claim.export', 'export claims');
      const opts = { select: 'c.*', scopeSql: scopeSql(actor, 'claim', 'c'), params: { c: actor.companyId }, tieBreaker: 'c.id' };
      return { title: claimList.label, permission: 'hr.claim.export', personal: false, columns: Object.entries(claimList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, claimList, req, opts), rows: () => runList(db, claimList, req, { ...opts, limit: null, map: (c) => { const v = claimView(actor, c); return { docNo: v.docNo, employee: v.employee, code: v.employeeCode, purpose: v.purpose, periodFrom: v.periodFrom, periodTo: v.periodTo, total: v.total, net: v.netPayable, flags: v.flagCount, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${claimList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { return claimView(actor, rowOf(actor, 'claim', id), { detail: true }); },
    /** The preview of a claim as typed (policy checks, flags, totals, settlement) without saving it: the form shows the same figures the server will keep. */
    preview(actor, b) {
      need(actor, 'hr.claim.create', 'prepare claims'); const e = meOf(actor);
      const header = headerCheck(actor, e, b); const prep = prepare(actor, e, b, b.lines, b.id ?? 0);
      const st = (() => { try { return settlementOf(actor, e, b.advanceId, prep.total); } catch { return { adjusted: 0, recoverable: 0 }; } })();
      return { lines: prep.rows.map((r) => ({ lineNo: r.lineNo, amount: money(r.amountMinor), flag: r.policyFlag, flagText: r.flagText, limit: money(r.limitMinor) })), total: money(prep.total), gst: money(prep.gst), advanceAdjusted: money(st.adjusted), netPayable: money(prep.total - st.adjusted), recoverable: money(st.recoverable), level: levelOf(prep.total, prep.deviation), problems: [...header, ...prep.problems], submitProblems: prep.submitProblems };
    },
    create(actor, b) {
      need(actor, 'hr.claim.create', 'raise claims'); const e = meOf(actor);
      const problems = [...headerCheck(actor, e, b)]; const prep = prepare(actor, e, b, b.lines ?? [], 0); problems.push(...prep.problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      settlementOf(actor, e, b.advanceId, prep.total);
      return transaction(db, () => {
        const no = nextDoc(actor, CLAIM_DOC, 'exp_claims', 'CLM');
        const id = Number(db.prepare("INSERT INTO exp_claims (company_id, doc_no, doc_date, employee_id, period_from, period_to, purpose, city_tier, travel_request_id, advance_id, total_minor, gst_minor, flag_count, level, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'exp_claim')")
          .run(actor.companyId, no, today(), e.id, b.periodFrom, b.periodTo, b.purpose, b.cityTier, b.travelRequestId ?? null, b.advanceId ?? null, prep.total, prep.gst, prep.flagCount, levelOf(prep.total, prep.deviation), e.project_id ?? null, e.site_id ?? null, actor.user).lastInsertRowid);
        writeLines(actor, id, prep.rows);
        writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'create', newValues: { docNo: no, total: money(prep.total), lines: prep.rows.length }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? claims.submit(actor, id, {}) : claims.get(actor, id);
      });
    },
    update(actor, id, b) {
      const c = rowOf(actor, 'claim', id);
      if (!['DRAFT', 'RETURNED'].includes(c.status)) throw conflict(`A claim that is ${CLAIM_STATUS[c.status].toLowerCase()} is not changed.`);
      if (!maker(actor, c)) throw forbidden(`Only ${c.created_by}, who raised it, changes it.`);
      if (c.version !== b.version) throw conflict('This claim was changed by someone else. Reload it and try again.');
      const e = emp(c.employee_id); const problems = [...headerCheck(actor, e, b)]; const prep = prepare(actor, e, b, b.lines ?? [], id); problems.push(...prep.problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      settlementOf(actor, e, b.advanceId, prep.total);
      return transaction(db, () => {
        db.prepare('UPDATE exp_claims SET period_from = ?, period_to = ?, purpose = ?, city_tier = ?, travel_request_id = ?, advance_id = ?, total_minor = ?, gst_minor = ?, flag_count = ?, level = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(b.periodFrom, b.periodTo, b.purpose, b.cityTier, b.travelRequestId ?? null, b.advanceId ?? null, prep.total, prep.gst, prep.flagCount, levelOf(prep.total, prep.deviation), actor.user, nowIso(), id);
        writeLines(actor, id, prep.rows);
        writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'update', oldValues: { total: money(c.total_minor) }, newValues: { total: money(prep.total), lines: prep.rows.length }, actor: actor.user, companyId: actor.companyId });
        return claims.get(actor, id);
      });
    },
    remove(actor, id) {
      const c = rowOf(actor, 'claim', id);
      if (c.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, c)) throw forbidden(`Only ${c.created_by} deletes this draft.`);
      db.prepare('UPDATE exp_claims SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    /** The checks of FR-04 once more on the server, the settlement and the level, and the chain: the manager, the accounts manager above ₹25,000, the CFO above ₹1 lakh; a deviation moves the claim one level up (BR-01, BR-03). */
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const c = rowOf(actor, 'claim', id); need(actor, 'hr.claim.submit', 'submit claims');
      if (!['DRAFT', 'RETURNED'].includes(c.status)) throw conflict(`This claim is ${CLAIM_STATUS[c.status].toLowerCase()}.`);
      if (!maker(actor, c)) throw forbidden(`Only ${c.created_by}, who raised it, submits it.`);
      const e = emp(c.employee_id); const lines = claimLines(id).map((l) => ({ category: l.category, date: l.spend_date, description: l.description, amount: l.category === 'PER_DIEM' || l.category === 'MILEAGE' ? null : money(l.amount_minor), gst: money(l.gst_minor), vendorName: l.vendor_name, vendorGstin: l.vendor_gstin, invoiceNo: l.invoice_no, fileId: l.file_id, costCodeId: l.cost_code_id, projectId: l.project_id, km: l.km, days: l.days, justification: l.justification }));
      if (!lines.length) throw badRequest('Some fields are not valid.', [{ field: 'lines', message: 'Add at least one line' }]);
      const prep = prepare(actor, e, { cityTier: c.city_tier }, lines, id);
      if (prep.problems.length || prep.submitProblems.length) throw badRequest('The claim cannot be sent yet.', [...prep.problems, ...prep.submitProblems]);
      const st = settlementOf(actor, e, c.advance_id, prep.total); const level = levelOf(prep.total, prep.deviation);
      return transaction(db, () => {
        writeLines(actor, id, prep.rows);
        db.prepare("UPDATE exp_claims SET total_minor = ?, gst_minor = ?, flag_count = ?, level = ?, advance_adjusted_minor = ?, net_payable_minor = ?, recoverable_minor = ?, requested_by = ?, status = 'SUBMITTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(prep.total, prep.gst, prep.flagCount, level, st.adjusted, prep.total - st.adjusted, st.recoverable, actor.user, actor.user, nowIso(), id);
        const ctx = { level, amount: prep.total / 100, deviation: prep.deviation, employeeId: c.employee_id };
        if (c.status === 'RETURNED') workflowOf(db).resubmit(actor, c.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: CLAIM_DOC, docId: id, comment: comment ?? 'Expense claim', context: ctx }); db.prepare('UPDATE exp_claims SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'submit', reason: comment ?? null, newValues: { total: money(prep.total), level, flags: prep.flagCount }, actor: actor.user, companyId: actor.companyId });
        return claims.get(actor, id);
      });
    },
    withdraw(actor, id, { reason }) {
      const c = rowOf(actor, 'claim', id);
      if (c.status !== 'SUBMITTED') throw unprocessable('Only a claim in approval is withdrawn.');
      if (!same(c.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, c.workflow_instance_id, { comment: reason });
      return claims.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const c = rowOf(actor, 'claim', id); need(actor, 'hr.claim.cancel', 'cancel claims');
      if (!['SUBMITTED', 'RETURNED', 'APPROVED'].includes(c.status)) throw unprocessable('Only a claim in approval, returned or approved (not yet passed) is cancelled; delete a draft.');
      if (!(maker(actor, c) || may(actor, 'hr.claim.pass'))) throw forbidden('You may not cancel this claim.');
      return transaction(db, () => {
        if (c.status === 'SUBMITTED') { if (maker(actor, c)) { workflowOf(db).abandon(actor.companyId, c.workflow_instance_id, actor.user, 'CANCELLED', reason); decide(CLAIM_DOC, { docId: c.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); } else workflowOf(db).cancel(actor, c.workflow_instance_id, { reason }); return claims.get(actor, id); }
        if (c.status === 'APPROVED') reverseSettlement(actor, c);
        db.prepare("UPDATE exp_claims SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        return claims.get(actor, id);
      });
    },
    history(actor, id) { return history(actor, 'claim', id); },
    print(actor, id) {
      need(actor, 'hr.claim.print', 'print claims'); const v = claimView(actor, rowOf(actor, 'claim', id), { detail: true }); const esc = escHtml;
      writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>Expense claim ${esc(v.docNo)}</h1><p>${esc(v.employee)} (${esc(v.employeeCode)}) · ${esc(v.periodFrom)} to ${esc(v.periodTo)} · ${esc(v.statusLabel)}</p><p>${esc(v.purpose)}</p><table><tr><th>#</th><th>Date</th><th>Category</th><th>Description</th><th>Invoice</th><th>Amount</th><th>GST</th><th>Flag</th></tr>${v.lines.map((l) => `<tr><td>${l.lineNo}</td><td>${esc(l.date)}</td><td>${esc(l.categoryLabel)}</td><td>${esc(l.description)}</td><td>${esc(l.invoiceNo ?? '')}</td><td>${l.amount}</td><td>${l.gst}</td><td>${esc(l.flagText ?? '')}</td></tr>`).join('')}</table><p>Total ${v.total} · Advance adjusted ${v.advanceAdjusted} · Net payable ${v.netPayable} · Recoverable ${v.recoverable}</p></body></html>`;
    },
    /** The accounts manager verifies the approved claim and passes it for payment: the event goes to payment (23.04) and the settlement stands. */
    pass(actor, id) {
      need(actor, 'hr.claim.pass', 'pass claims for payment'); const c = rowOf(actor, 'claim', id);
      if (c.status !== 'APPROVED') throw unprocessable(c.status === 'PASSED' ? 'This claim was passed already.' : 'Only an approved claim is passed for payment.');
      if (myEmployee(actor) === c.employee_id) throw forbidden('You cannot pass your own claim for payment.');
      db.prepare("UPDATE exp_claims SET status = 'PASSED', passed_by = ?, passed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'pass', newValues: { netPayable: money(c.net_payable_minor) }, actor: actor.user, companyId: actor.companyId });
      event('exp.claim.passed', actor, 'exp_claim', id, c.company_id, { docNo: c.doc_no, employeeId: c.employee_id, netPayable: money(c.net_payable_minor), total: money(c.total_minor) }, c.project_id, c.site_id);
      return claims.get(actor, id);
    },
    paid(actor, id, { reference }) {
      need(actor, 'hr.claim.pass', 'record payment of claims'); const c = rowOf(actor, 'claim', id);
      if (c.status !== 'PASSED') throw unprocessable('Only a claim passed for payment is marked paid.');
      db.prepare("UPDATE exp_claims SET status = 'PAID', paid_at = ?, paid_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), reference, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'exp_claims', entityId: id, action: 'paid', newValues: { reference }, actor: actor.user, companyId: actor.companyId });
      event('exp.claim.paid', actor, 'exp_claim', id, c.company_id, { docNo: c.doc_no, employeeId: c.employee_id, reference, netPayable: money(c.net_payable_minor) }, c.project_id, c.site_id);
      tell(actor.companyId, usernameOf(emp(c.employee_id)?.user_id), 'claim', c.doc_no, emp(c.employee_id)?.full_name ?? '', `paid (${reference})`, null);
      return claims.get(actor, id);
    },
  };
  const escHtml = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  function writeLines(actor, claimId, rows) {
    db.prepare('DELETE FROM exp_claim_lines WHERE claim_id = ?').run(claimId);
    for (const r of rows) {
      if (r.amountMinor == null) continue;
      db.prepare('INSERT INTO exp_claim_lines (company_id, claim_id, line_no, category, spend_date, description, amount_minor, gst_minor, vendor_name, vendor_gstin, invoice_no, file_id, cost_code_id, km, days, limit_minor, policy_flag, flag_text, justification, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(actor.companyId, claimId, r.lineNo, r.category, r.spendDate, r.description, r.amountMinor, r.gstMinor, r.vendorName, r.vendorGstin, r.invoiceNo, r.fileId, r.costCodeId, r.km, r.days, r.limitMinor, r.policyFlag, r.flagText, r.justification, r.projectId, actor.user, 'exp_claim');
    }
  }
  /** The settlement of a claim against the advance happens at approval, with what is outstanding then; cancelling the approved claim puts it back. */
  function applySettlement(c, actor) {
    if (!c.advance_id) return { adjusted: 0, recoverable: 0 };
    const a = db.prepare('SELECT * FROM exp_advances WHERE id = ?').get(c.advance_id);
    if (!a || a.status !== 'DISBURSED' || a.balance_minor <= 0) return { adjusted: 0, recoverable: 0 };
    const adjusted = Math.min(c.total_minor, a.balance_minor);
    db.prepare("INSERT INTO exp_advance_recoveries (company_id, advance_id, claim_id, kind, rec_status, amount_minor, done_on, reference, created_by, source_type) VALUES (?, ?, ?, 'SETTLEMENT', 'DONE', ?, ?, ?, ?, 'exp_claim')").run(c.company_id, a.id, c.id, adjusted, today(), c.doc_no, actor.user);
    const left = a.balance_minor - adjusted;
    db.prepare("UPDATE exp_advances SET balance_minor = ?, status = CASE WHEN ? = 0 THEN 'CLOSED' ELSE status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(left, left, actor.user, nowIso(), a.id);
    if (left === 0) event('exp.advance.closed', actor, 'exp_advance', a.id, c.company_id, { docNo: a.doc_no, employeeId: a.employee_id }, null, null);
    return { adjusted, recoverable: left };
  }
  function reverseSettlement(actor, c) {
    const rec = db.prepare("SELECT * FROM exp_advance_recoveries WHERE claim_id = ? AND kind = 'SETTLEMENT' AND rec_status = 'DONE'").get(c.id);
    if (!rec) return;
    db.prepare("UPDATE exp_advance_recoveries SET rec_status = 'REVERSED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), rec.id);
    db.prepare("UPDATE exp_advances SET balance_minor = balance_minor + ?, status = 'DISBURSED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(rec.amount_minor, actor.user, nowIso(), rec.advance_id);
  }

  // ------------------------------------------------------------------ advances (FR-02)
  const recoveriesOf = (advanceId) => db.prepare("SELECT * FROM exp_advance_recoveries WHERE advance_id = ? AND deleted_at IS NULL AND rec_status != 'REVERSED' ORDER BY COALESCE(due_month, done_on), id").all(advanceId).map((r) => ({ id: r.id, kind: r.kind, status: r.rec_status, dueMonth: r.due_month, amount: money(r.amount_minor), doneOn: r.done_on, reference: r.reference, claimId: r.claim_id }));
  function advanceView(actor, a, { detail = false } = {}) {
    const e = emp(a.employee_id); const editable = ['DRAFT', 'RETURNED'].includes(a.status) && maker(actor, a);
    const out = {
      id: a.id, docNo: a.doc_no, status: a.status, statusLabel: ADVANCE_STATUS[a.status], rowVersion: a.version, employeeId: a.employee_id, employee: e?.full_name, employeeCode: e?.emp_code, type: a.advance_type, typeLabel: ADVANCE_TYPES[a.advance_type], amount: money(a.amount_minor), purpose: a.purpose,
      recoveryMode: a.recovery_mode, instalments: a.instalments, instalment: money(Math.floor(a.amount_minor / a.instalments)), outstanding: money(a.balance_minor), travelRequestId: a.travel_request_id, workflowInstanceId: a.workflow_instance_id, requestedBy: a.requested_by, disbursedAt: a.disbursed_at, disbursedRef: a.disbursed_ref,
      can: { edit: editable, submit: editable && may(actor, 'hr.advance.submit'), delete: a.status === 'DRAFT' && maker(actor, a) && may(actor, 'hr.advance.delete'), withdraw: a.status === 'SUBMITTED' && same(a.requested_by, actor.user), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(a.status) && (maker(actor, a) || may(actor, 'hr.advance.disburse')) && may(actor, 'hr.advance.cancel'), disburse: a.status === 'APPROVED' && may(actor, 'hr.advance.disburse'), print: may(actor, 'hr.advance.print') },
    };
    if (detail) out.recoveries = recoveriesOf(a.id);
    return out;
  }
  const advanceChecks = (actor, e, b, exceptId = 0) => {
    const p = [];
    if (b.type === 'SALARY') {
      if (minor(b.amount) > Number(param(actor.companyId, 'exp.advance.salary_max_minor'))) p.push({ field: 'amount', message: `A salary advance is at most ${money(Number(param(actor.companyId, 'exp.advance.salary_max_minor')))}` });
      const max = Number(param(actor.companyId, 'exp.advance.max_instalments')) || 24; if (b.instalments > max) p.push({ field: 'instalments', message: `At most ${max} instalments` });
      if (db.prepare("SELECT 1 FROM exp_advances WHERE employee_id = ? AND advance_type = 'SALARY' AND status IN ('SUBMITTED', 'APPROVED', 'DISBURSED') AND deleted_at IS NULL AND id != ?").get(e.id, exceptId)) p.push({ field: 'type', message: 'You have a salary advance in approval or not yet recovered: one at a time' });
    } else if (b.instalments !== 1) p.push({ field: 'instalments', message: 'A travel or imprest advance is settled against a claim, not in instalments' });
    if (b.travelRequestId) { const t = db.prepare('SELECT * FROM exp_travel_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.travelRequestId, actor.companyId); if (!t || t.employee_id !== e.id) p.push({ field: 'travelRequestId', message: 'That travel request is not yours' }); else if (t.status !== 'APPROVED') p.push({ field: 'travelRequestId', message: 'That travel request is not approved' }); else if (minor(b.amount) > t.advance_minor) p.push({ field: 'amount', message: `The travel request asked for an advance of ${money(t.advance_minor)}` }); }
    return p;
  };
  const advances = {
    list(actor, query) { need(actor, 'hr.advance.view', 'see advances'); return runList(db, advanceList, parseListRequest(advanceList, query), { select: 'a.*', scopeSql: scopeSql(actor, 'advance', 'a'), params: { c: actor.companyId }, tieBreaker: 'a.id', map: (a) => advanceView(actor, a) }); },
    exportSource(actor, req) {
      need(actor, 'hr.advance.export', 'export advances');
      const opts = { select: 'a.*', scopeSql: scopeSql(actor, 'advance', 'a'), params: { c: actor.companyId }, tieBreaker: 'a.id' };
      return { title: advanceList.label, permission: 'hr.advance.export', personal: false, columns: Object.entries(advanceList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, advanceList, req, opts), rows: () => runList(db, advanceList, req, { ...opts, limit: null, map: (a) => { const v = advanceView(actor, a); return { docNo: v.docNo, employee: v.employee, code: v.employeeCode, type: v.typeLabel, purpose: v.purpose, amount: v.amount, balance: v.outstanding, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${advanceList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { return advanceView(actor, rowOf(actor, 'advance', id), { detail: true }); },
    create(actor, b) {
      need(actor, 'hr.advance.create', 'ask for an advance'); const e = meOf(actor);
      const problems = advanceChecks(actor, e, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, ADVANCE_DOC, 'exp_advances', 'ADV');
        const id = Number(db.prepare("INSERT INTO exp_advances (company_id, doc_no, doc_date, employee_id, advance_type, amount_minor, purpose, recovery_mode, instalments, travel_request_id, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'exp_advance')")
          .run(actor.companyId, no, today(), e.id, b.type, minor(b.amount), b.purpose, b.type === 'SALARY' ? 'PAYROLL' : 'SETTLEMENT', b.instalments, b.travelRequestId ?? null, e.project_id ?? null, e.site_id ?? null, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'exp_advances', entityId: id, action: 'create', newValues: { docNo: no, type: b.type, amount: b.amount }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? advances.submit(actor, id, {}) : advances.get(actor, id);
      });
    },
    update(actor, id, b) {
      const a = rowOf(actor, 'advance', id);
      if (!['DRAFT', 'RETURNED'].includes(a.status)) throw conflict(`An advance that is ${ADVANCE_STATUS[a.status].toLowerCase()} is not changed.`);
      if (!maker(actor, a)) throw forbidden(`Only ${a.created_by}, who asked for it, changes it.`);
      if (a.version !== b.version) throw conflict('This advance was changed by someone else. Reload it and try again.');
      const problems = advanceChecks(actor, emp(a.employee_id), b, id); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE exp_advances SET advance_type = ?, amount_minor = ?, purpose = ?, recovery_mode = ?, instalments = ?, travel_request_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.type, minor(b.amount), b.purpose, b.type === 'SALARY' ? 'PAYROLL' : 'SETTLEMENT', b.instalments, b.travelRequestId ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'exp_advances', entityId: id, action: 'update', oldValues: { amount: money(a.amount_minor) }, newValues: { amount: b.amount }, actor: actor.user, companyId: actor.companyId });
      return advances.get(actor, id);
    },
    remove(actor, id) {
      const a = rowOf(actor, 'advance', id);
      if (a.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, a)) throw forbidden(`Only ${a.created_by} deletes this draft.`);
      db.prepare('UPDATE exp_advances SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'exp_advances', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const a = rowOf(actor, 'advance', id); need(actor, 'hr.advance.submit', 'submit advances');
      if (!['DRAFT', 'RETURNED'].includes(a.status)) throw conflict(`This advance is ${ADVANCE_STATUS[a.status].toLowerCase()}.`);
      if (!maker(actor, a)) throw forbidden(`Only ${a.created_by}, who asked for it, submits it.`);
      const problems = advanceChecks(actor, emp(a.employee_id), { type: a.advance_type, amount: money(a.amount_minor), instalments: a.instalments, travelRequestId: a.travel_request_id }, id); if (problems.length) throw badRequest('The advance cannot be sent yet.', problems);
      // D-366: "above one month salary" is the employee's monthly gross in force (payroll, 24.01); the parameter only when no pay is recorded
      const monthPay = db.prepare('SELECT COALESCE(SUM(monthly_paise), 0) AS p FROM hr_employee_pay WHERE employee_id = ? AND deleted_at IS NULL AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)').get(a.employee_id, today(), today()).p;
      const big = a.advance_type === 'SALARY' ? a.amount_minor > (monthPay > 0 ? monthPay : Number(param(actor.companyId, 'exp.advance.salary_cfo_above_minor'))) : a.amount_minor > L * 100;
      return transaction(db, () => {
        const ctx = { kind: a.advance_type, big, amount: a.amount_minor / 100, employeeId: a.employee_id };
        if (a.status === 'RETURNED') workflowOf(db).resubmit(actor, a.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: ADVANCE_DOC, docId: id, comment: comment ?? 'Advance', context: ctx }); db.prepare('UPDATE exp_advances SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE exp_advances SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'exp_advances', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return advances.get(actor, id);
      });
    },
    withdraw(actor, id, { reason }) {
      const a = rowOf(actor, 'advance', id);
      if (a.status !== 'SUBMITTED') throw unprocessable('Only an advance in approval is withdrawn.');
      if (!same(a.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, a.workflow_instance_id, { comment: reason });
      return advances.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const a = rowOf(actor, 'advance', id); need(actor, 'hr.advance.cancel', 'cancel advances');
      if (!['SUBMITTED', 'RETURNED', 'APPROVED'].includes(a.status)) throw unprocessable('Only an advance in approval, returned or approved (not yet paid) is cancelled; delete a draft.');
      if (!(maker(actor, a) || may(actor, 'hr.advance.disburse'))) throw forbidden('You may not cancel this advance.');
      return transaction(db, () => {
        if (a.status === 'SUBMITTED') { if (maker(actor, a)) { workflowOf(db).abandon(actor.companyId, a.workflow_instance_id, actor.user, 'CANCELLED', reason); decide(ADVANCE_DOC, { docId: a.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); } else workflowOf(db).cancel(actor, a.workflow_instance_id, { reason }); return advances.get(actor, id); }
        db.prepare("UPDATE exp_advances SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'exp_advances', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        return advances.get(actor, id);
      });
    },
    history(actor, id) { return history(actor, 'advance', id); },
    print(actor, id) {
      need(actor, 'hr.advance.print', 'print advances'); const v = advanceView(actor, rowOf(actor, 'advance', id), { detail: true });
      writeAudit(db, { entity: 'exp_advances', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>${escHtml(v.typeLabel)} ${escHtml(v.docNo)}</h1><p>${escHtml(v.employee)} (${escHtml(v.employeeCode)}) · ${escHtml(v.statusLabel)}</p><p>${escHtml(v.purpose)}</p><p>Amount ${v.amount} · Instalments ${v.instalments} · Outstanding ${v.outstanding}</p><table><tr><th>Kind</th><th>Month</th><th>Amount</th><th>Status</th></tr>${(v.recoveries ?? []).map((r) => `<tr><td>${escHtml(r.kind)}</td><td>${escHtml(r.dueMonth ?? r.doneOn ?? '')}</td><td>${r.amount}</td><td>${escHtml(r.status)}</td></tr>`).join('')}</table></body></html>`;
    },
    /** Accounts pay the approved advance and record it; from then on it is outstanding. A salary advance gets its instalments for payroll (24.02) from the next month. */
    disburse(actor, id, { reference, date }) {
      need(actor, 'hr.advance.disburse', 'record the payment of advances'); const a = rowOf(actor, 'advance', id);
      if (a.status !== 'APPROVED') throw unprocessable(a.status === 'DISBURSED' ? 'This advance was paid out already.' : 'Only an approved advance is paid out.');
      if (myEmployee(actor) === a.employee_id) throw forbidden('You cannot record the payment of your own advance.');
      return transaction(db, () => {
        const on = date ?? today();
        db.prepare("UPDATE exp_advances SET status = 'DISBURSED', balance_minor = amount_minor, disbursed_at = ?, disbursed_by = ?, disbursed_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(on, actor.user, reference, actor.user, nowIso(), id);
        if (a.recovery_mode === 'PAYROLL') {
          const base = Math.floor(a.amount_minor / a.instalments); let [y, m] = on.slice(0, 7).split('-').map(Number);
          for (let i = 1; i <= a.instalments; i += 1) {
            m += 1; if (m > 12) { m = 1; y += 1; }
            const amt = i === a.instalments ? a.amount_minor - base * (a.instalments - 1) : base;
            db.prepare("INSERT INTO exp_advance_recoveries (company_id, advance_id, kind, rec_status, due_month, amount_minor, created_by, source_type) VALUES (?, ?, 'PAYROLL', 'PLANNED', ?, ?, ?, 'exp_advance')").run(a.company_id, id, `${y}-${String(m).padStart(2, '0')}`, amt, actor.user);
          }
        }
        writeAudit(db, { entity: 'exp_advances', entityId: id, action: 'disburse', newValues: { reference, date: on }, actor: actor.user, companyId: actor.companyId });
        event('exp.advance.disbursed', actor, 'exp_advance', id, a.company_id, { docNo: a.doc_no, employeeId: a.employee_id, type: a.advance_type, amount: money(a.amount_minor), recoveryMode: a.recovery_mode, instalments: a.instalments }, a.project_id, a.site_id);
        const first = db.prepare("SELECT * FROM exp_advance_recoveries WHERE advance_id = ? AND rec_status = 'PLANNED' ORDER BY due_month LIMIT 1").get(id);
        if (first) notif.notify({ companyId: a.company_id, templateCode: 'exp.recovery', recipients: [`user:${usernameOf(emp(a.employee_id)?.user_id)}`], data: { ref: a.doc_no, amount: `Rs ${money(first.amount_minor)}`, month: first.due_month }, link: '/expenses', sourceType: 'exp_advance', sourceId: a.doc_no, eventKey: `exp.recovery:${a.doc_no}` });
        return advances.get(actor, id);
      });
    },
    /** For payroll (24.02): the instalments due in a month, and the recording of what was recovered. */
    recoveries: {
      due(actor, { month }) {
        need(actor, 'hr.advance.recover', 'see the advance instalments due');
        return db.prepare("SELECT r.*, a.doc_no, a.employee_id, e.full_name, e.emp_code FROM exp_advance_recoveries r JOIN exp_advances a ON a.id = r.advance_id JOIN hr_employees e ON e.id = a.employee_id WHERE r.company_id = ? AND r.kind = 'PAYROLL' AND r.rec_status = 'PLANNED' AND r.due_month <= ? AND r.deleted_at IS NULL ORDER BY r.due_month, e.full_name").all(actor.companyId, month)
          .map((r) => ({ id: r.id, advanceId: r.advance_id, advance: r.doc_no, employeeId: r.employee_id, employee: r.full_name, code: r.emp_code, dueMonth: r.due_month, amount: money(r.amount_minor) }));
      },
      recover(actor, id, { amount, reference }) {
        need(actor, 'hr.advance.recover', 'record advance recoveries');
        const r = db.prepare("SELECT r.*, a.balance_minor, a.doc_no, a.employee_id FROM exp_advance_recoveries r JOIN exp_advances a ON a.id = r.advance_id WHERE r.id = ? AND r.company_id = ? AND r.deleted_at IS NULL").get(id, actor.companyId);
        if (!r) throw notFound('That instalment does not exist.');
        if (r.rec_status !== 'PLANNED') throw conflict('This instalment was recovered already.');
        const got = amount == null ? r.amount_minor : minor(amount);
        if (got <= 0 || got > r.balance_minor) throw badRequest('Some fields are not valid.', [{ field: 'amount', message: `The recovery must be more than zero and at most the outstanding ${money(r.balance_minor)}` }]);
        return transaction(db, () => {
          db.prepare("UPDATE exp_advance_recoveries SET rec_status = 'DONE', amount_minor = ?, done_on = ?, reference = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(got, today(), reference ?? null, actor.user, nowIso(), id);
          const left = r.balance_minor - got;
          db.prepare("UPDATE exp_advances SET balance_minor = ?, status = CASE WHEN ? = 0 THEN 'CLOSED' ELSE status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(left, left, actor.user, nowIso(), r.advance_id);
          writeAudit(db, { entity: 'exp_advance_recoveries', entityId: id, action: 'recover', newValues: { amount: money(got), outstanding: money(left) }, actor: actor.user, companyId: actor.companyId });
          event('exp.advance.recovered', actor, 'exp_advance_recovery', id, actor.companyId, { advance: r.doc_no, employeeId: r.employee_id, amount: money(got), outstanding: money(left) }, null, null);
          if (left === 0) event('exp.advance.closed', actor, 'exp_advance', r.advance_id, actor.companyId, { docNo: r.doc_no, employeeId: r.employee_id }, null, null);
          return { id, status: 'DONE', amount: money(got), outstanding: money(left) };
        });
      },
    },
  };

  // ------------------------------------------------------------------ travel requests (FR-01)
  function travelView(actor, t) {
    const e = emp(t.employee_id); const editable = ['DRAFT', 'RETURNED'].includes(t.status) && maker(actor, t);
    return {
      id: t.id, docNo: t.doc_no, status: t.status, statusLabel: TRAVEL_STATUS[t.status], rowVersion: t.version, employeeId: t.employee_id, employee: e?.full_name, employeeCode: e?.emp_code, purpose: t.purpose, projectId: t.project_id, project: t.project_id ? db.prepare('SELECT name FROM org_projects WHERE id = ?').get(t.project_id)?.name ?? null : null,
      fromPlace: t.from_place, toPlace: t.to_place, startDate: t.start_date, endDate: t.end_date, mode: t.mode, estCost: money(t.est_cost_minor), advance: money(t.advance_minor), workflowInstanceId: t.workflow_instance_id, requestedBy: t.requested_by,
      can: { edit: editable, submit: editable && may(actor, 'hr.travel_request.submit'), delete: t.status === 'DRAFT' && maker(actor, t) && may(actor, 'hr.travel_request.delete'), withdraw: t.status === 'SUBMITTED' && same(t.requested_by, actor.user), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(t.status) && maker(actor, t) && may(actor, 'hr.travel_request.cancel'), print: may(actor, 'hr.travel_request.print'), claim: t.status === 'APPROVED' && myEmployee(actor) === t.employee_id, advance: t.status === 'APPROVED' && t.advance_minor > 0 && myEmployee(actor) === t.employee_id },
    };
  }
  const travelChecks = (actor, b) => {
    const p = [];
    if (b.endDate < b.startDate) p.push({ field: 'endDate', message: 'The trip cannot end before it starts' });
    if (b.advance > b.estCost) p.push({ field: 'advance', message: 'The advance cannot be more than the estimated cost' });
    if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(b.projectId, actor.companyId)) p.push({ field: 'projectId', message: 'That project does not exist' });
    return p;
  };
  const travel = {
    list(actor, query) { need(actor, 'hr.travel_request.view', 'see travel requests'); return runList(db, travelList, parseListRequest(travelList, query), { select: 't.*', scopeSql: scopeSql(actor, 'travel', 't'), params: { c: actor.companyId }, tieBreaker: 't.id', map: (t) => travelView(actor, t) }); },
    exportSource(actor, req) {
      need(actor, 'hr.travel_request.export', 'export travel requests');
      const opts = { select: 't.*', scopeSql: scopeSql(actor, 'travel', 't'), params: { c: actor.companyId }, tieBreaker: 't.id' };
      return { title: travelList.label, permission: 'hr.travel_request.export', personal: false, columns: Object.entries(travelList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, travelList, req, opts), rows: () => runList(db, travelList, req, { ...opts, limit: null, map: (t) => { const v = travelView(actor, t); return { docNo: v.docNo, employee: v.employee, purpose: v.purpose, project: v.project, from: v.fromPlace, to: v.toPlace, startDate: v.startDate, endDate: v.endDate, estCost: v.estCost, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${travelList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { return travelView(actor, rowOf(actor, 'travel', id)); },
    create(actor, b) {
      need(actor, 'hr.travel_request.create', 'ask for a trip'); const e = meOf(actor);
      const problems = travelChecks(actor, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, TRAVEL_DOC, 'exp_travel_requests', 'TRV');
        const id = Number(db.prepare("INSERT INTO exp_travel_requests (company_id, doc_no, doc_date, employee_id, purpose, from_place, to_place, start_date, end_date, mode, est_cost_minor, advance_minor, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'exp_travel')")
          .run(actor.companyId, no, today(), e.id, b.purpose, b.fromPlace, b.toPlace, b.startDate, b.endDate, b.mode, minor(b.estCost), minor(b.advance ?? 0), b.projectId ?? e.project_id ?? null, e.site_id ?? null, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'exp_travel_requests', entityId: id, action: 'create', newValues: { docNo: no, to: b.toPlace }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? travel.submit(actor, id, {}) : travel.get(actor, id);
      });
    },
    update(actor, id, b) {
      const t = rowOf(actor, 'travel', id);
      if (!['DRAFT', 'RETURNED'].includes(t.status)) throw conflict(`A request that is ${TRAVEL_STATUS[t.status].toLowerCase()} is not changed.`);
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by}, who asked for it, changes it.`);
      if (t.version !== b.version) throw conflict('This request was changed by someone else. Reload it and try again.');
      const problems = travelChecks(actor, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE exp_travel_requests SET purpose = ?, from_place = ?, to_place = ?, start_date = ?, end_date = ?, mode = ?, est_cost_minor = ?, advance_minor = ?, project_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.purpose, b.fromPlace, b.toPlace, b.startDate, b.endDate, b.mode, minor(b.estCost), minor(b.advance ?? 0), b.projectId ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'exp_travel_requests', entityId: id, action: 'update', actor: actor.user, companyId: actor.companyId });
      return travel.get(actor, id);
    },
    remove(actor, id) {
      const t = rowOf(actor, 'travel', id);
      if (t.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by} deletes this draft.`);
      db.prepare('UPDATE exp_travel_requests SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'exp_travel_requests', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const t = rowOf(actor, 'travel', id); need(actor, 'hr.travel_request.submit', 'submit travel requests');
      if (!['DRAFT', 'RETURNED'].includes(t.status)) throw conflict(`This request is ${TRAVEL_STATUS[t.status].toLowerCase()}.`);
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by}, who asked for it, submits it.`);
      return transaction(db, () => {
        const ctx = { hasProject: Boolean(t.project_id), amount: t.est_cost_minor / 100, employeeId: t.employee_id };
        if (t.status === 'RETURNED') workflowOf(db).resubmit(actor, t.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: TRAVEL_DOC, docId: id, comment: comment ?? 'Travel request', context: ctx }); db.prepare('UPDATE exp_travel_requests SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE exp_travel_requests SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'exp_travel_requests', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return travel.get(actor, id);
      });
    },
    withdraw(actor, id, { reason }) {
      const t = rowOf(actor, 'travel', id);
      if (t.status !== 'SUBMITTED') throw unprocessable('Only a request in approval is withdrawn.');
      if (!same(t.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, t.workflow_instance_id, { comment: reason });
      return travel.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const t = rowOf(actor, 'travel', id); need(actor, 'hr.travel_request.cancel', 'cancel travel requests');
      if (!['SUBMITTED', 'RETURNED', 'APPROVED'].includes(t.status)) throw unprocessable('Only a request in approval, returned or approved is cancelled; delete a draft.');
      if (!maker(actor, t)) throw forbidden('Only the person who asked for it cancels it.');
      return transaction(db, () => {
        if (t.status === 'SUBMITTED') { workflowOf(db).abandon(actor.companyId, t.workflow_instance_id, actor.user, 'CANCELLED', reason); decide(TRAVEL_DOC, { docId: t.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); return travel.get(actor, id); }
        db.prepare("UPDATE exp_travel_requests SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'exp_travel_requests', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        return travel.get(actor, id);
      });
    },
    history(actor, id) { return history(actor, 'travel', id); },
    print(actor, id) {
      need(actor, 'hr.travel_request.print', 'print travel requests'); const v = travelView(actor, rowOf(actor, 'travel', id));
      writeAudit(db, { entity: 'exp_travel_requests', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}</style></head><body><h1>Travel request ${escHtml(v.docNo)}</h1><p>${escHtml(v.employee)} (${escHtml(v.employeeCode)}) · ${escHtml(v.statusLabel)}</p><p>${escHtml(v.purpose)}</p><p>${escHtml(v.fromPlace)} to ${escHtml(v.toPlace)} · ${escHtml(v.startDate)} to ${escHtml(v.endDate)} · ${escHtml(v.mode)}</p><p>Estimated cost ${v.estCost} · Advance ${v.advance}${v.project ? ` · Project ${escHtml(v.project)}` : ''}</p></body></html>`;
    },
  };
  function history(actor, kind, id) {
    const r = rowOf(actor, kind, id);
    return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all(KINDS[kind].table, String(id)).map((x) => ({ action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }

  // ------------------------------------------------------------------ the worklist of approvals, the analysis and the widget
  const approvals = {
    list(actor) {
      const tasks = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 });
      const mine = (tasks.rows ?? []).filter((t) => [CLAIM_DOC, ADVANCE_DOC, TRAVEL_DOC].includes(t.instance?.docType));
      const items = mine.map((t) => {
        const kind = t.instance.docType === CLAIM_DOC ? 'claim' : t.instance.docType === ADVANCE_DOC ? 'advance' : 'travel';
        const r = db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ? AND company_id = ?`).get(Number(t.instance.docId), actor.companyId); if (!r) return null;
        const e = emp(r.employee_id); const base = { taskId: t.id, kind, docId: r.id, docNo: r.doc_no, employee: e?.full_name, employeeCode: e?.emp_code, step: t.stepCode ?? t.step_code ?? null, requestedBy: r.requested_by };
        if (kind === 'claim') return { ...base, title: r.purpose, amount: money(r.total_minor), netPayable: money(r.net_payable_minor), advanceAdjusted: money(r.advance_adjusted_minor), level: r.level, flags: claimLines(r.id).filter((l) => l.policy_flag !== 'NONE').map((l) => ({ lineNo: l.line_no, flag: l.policy_flag, text: l.flag_text, amount: money(l.amount_minor), justification: l.justification })), lines: claimLines(r.id).length };
        if (kind === 'advance') return { ...base, title: `${ADVANCE_TYPES[r.advance_type]}: ${r.purpose}`, amount: money(r.amount_minor), instalments: r.instalments, flags: [] };
        return { ...base, title: `${r.from_place} to ${r.to_place}: ${r.purpose}`, amount: money(r.est_cost_minor), advance: money(r.advance_minor), flags: [] };
      }).filter(Boolean);
      const toPass = may(actor, 'hr.claim.pass') ? db.prepare("SELECT * FROM exp_claims WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id").all(actor.companyId).map((c) => claimView(actor, c)) : [];
      const toPay = may(actor, 'hr.claim.pass') ? db.prepare("SELECT * FROM exp_claims WHERE company_id = ? AND status = 'PASSED' AND deleted_at IS NULL ORDER BY id").all(actor.companyId).map((c) => claimView(actor, c)) : [];
      const toDisburse = may(actor, 'hr.advance.disburse') ? db.prepare("SELECT * FROM exp_advances WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id").all(actor.companyId).map((a) => advanceView(actor, a)) : [];
      return { items, toPass, toPay, toDisburse };
    },
    bulk(actor, { taskIds, decision, comment }) {
      const action = { APPROVE: 'approve', REJECT: 'reject', RETURN: 'return' }[decision];
      const out = taskIds.map((taskId) => { try { workflowOf(db).act(actor, taskId, { action, comment }); return { taskId, ok: true }; } catch (e) { return { taskId, ok: false, error: e.message }; } });
      return { decision, done: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, results: out };
    },
  };
  /** FR report: what was claimed, by project, by category and by employee, from approved, passed and paid claims. */
  function analysis(actor, { from = null, to = null, projectId = null } = /** @type {any} */ ({})) {
    need(actor, 'hr.expense.report', 'see the expense analysis');
    const ids = scopeIds(actor, 'claim');
    const rows = db.prepare(`SELECT l.category, l.amount_minor, l.gst_minor, l.policy_flag, l.project_id, c.employee_id, c.id AS claim_id FROM exp_claim_lines l JOIN exp_claims c ON c.id = l.claim_id WHERE c.company_id = ? AND c.deleted_at IS NULL AND l.deleted_at IS NULL AND c.status IN ('APPROVED', 'PASSED', 'PAID') AND (? IS NULL OR l.spend_date >= ?) AND (? IS NULL OR l.spend_date <= ?) AND (? IS NULL OR l.project_id = ?)`).all(actor.companyId, from, from, to, to, projectId, projectId).filter((r) => !ids || ids.includes(r.employee_id));
    const group = (keyFn, nameFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); const g = m.get(k) ?? { key: k, name: nameFn(k), amount: 0, gst: 0, lines: 0, flagged: 0, claims: new Set() }; g.amount += r.amount_minor; g.gst += r.gst_minor; g.lines += 1; if (r.policy_flag !== 'NONE') g.flagged += 1; g.claims.add(r.claim_id); m.set(k, g); } return [...m.values()].map((g) => ({ key: g.key, name: g.name, amount: money(g.amount), gst: money(g.gst), lines: g.lines, flagged: g.flagged, claims: g.claims.size })).sort((a, b) => b.amount - a.amount).slice(0, 50); };
    return {
      total: money(rows.reduce((s, r) => s + r.amount_minor, 0)), gst: money(rows.reduce((s, r) => s + r.gst_minor, 0)), lines: rows.length, flagged: rows.filter((r) => r.policy_flag !== 'NONE').length,
      byProject: group((r) => r.project_id ?? 0, (k) => (k ? db.prepare('SELECT name FROM org_projects WHERE id = ?').get(k)?.name ?? `#${k}` : 'Not allocated')),
      byCategory: group((r) => r.category, (k) => CATEGORIES[k] ?? k), byEmployee: group((r) => r.employee_id, (k) => emp(k)?.full_name ?? `#${k}`),
    };
  }
  const widget = (actor) => (may(actor, 'hr.claim.pass') ? { value: db.prepare("SELECT COUNT(*) AS n FROM exp_claims WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(actor.companyId).n } : { value: 0 });

  // ------------------------------------------------------------------ the decision of the approval workflow
  function decide(docType, instance, actor, outcome, comment) {
    const kind = docType === CLAIM_DOC ? 'claim' : docType === ADVANCE_DOC ? 'advance' : 'travel'; const k = KINDS[kind];
    const r = db.prepare(`SELECT * FROM ${k.table} WHERE id = ?`).get(Number(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      if (kind === 'claim') {
        const s = applySettlement(r, actor);
        db.prepare("UPDATE exp_claims SET status = 'APPROVED', approved_at = ?, advance_adjusted_minor = ?, net_payable_minor = total_minor - ?, recoverable_minor = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, s.adjusted, s.adjusted, s.recoverable, actor.user, now, r.id);
        const fresh = db.prepare('SELECT * FROM exp_claims WHERE id = ?').get(r.id);
        event('exp.claim.approved', actor, 'exp_claim', r.id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, total: money(r.total_minor), gst: money(r.gst_minor), advanceAdjusted: money(fresh.advance_adjusted_minor), netPayable: money(fresh.net_payable_minor), lines: claimLines(r.id).map((l) => ({ category: l.category, amount: money(l.amount_minor), gst: money(l.gst_minor), costCodeId: l.cost_code_id, projectId: l.project_id, vendorGstin: l.vendor_gstin, invoiceNo: l.invoice_no })) }, r.project_id, r.site_id);
        if (r.travel_request_id) db.prepare("UPDATE exp_travel_requests SET status = 'CLOSED', version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(r.travel_request_id);
      } else if (kind === 'advance') {
        db.prepare("UPDATE exp_advances SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
        event('exp.advance.approved', actor, 'exp_advance', r.id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, type: r.advance_type, amount: money(r.amount_minor), recoveryMode: r.recovery_mode }, r.project_id, r.site_id);
      } else {
        db.prepare("UPDATE exp_travel_requests SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
        event('exp.travel.approved', actor, 'exp_travel_request', r.id, r.company_id, { docNo: r.doc_no, employeeId: r.employee_id, toPlace: r.to_place, startDate: r.start_date, endDate: r.end_date }, r.project_id, r.site_id);
      }
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare(`UPDATE ${k.table} SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
      if (withdrawn) db.prepare(`UPDATE ${k.table} SET workflow_instance_id = NULL WHERE id = ?`).run(r.id);
    }
    writeAudit(db, { entity: k.table, entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    tell(r.company_id, r.requested_by ?? r.created_by, kind, r.doc_no, emp(r.employee_id)?.full_name ?? '', outcome, comment);
  }
  return { policies, claims, advances, travel, approvals, analysis, widget, decisions: { [CLAIM_DOC]: (i, a, o, c) => decide(CLAIM_DOC, i, a, o, c), [ADVANCE_DOC]: (i, a, o, c) => decide(ADVANCE_DOC, i, a, o, c), [TRAVEL_DOC]: (i, a, o, c) => decide(TRAVEL_DOC, i, a, o, c) }, canSee };
}

const services = new WeakMap();
export const bindExpenses = (db, s) => services.set(db, s);
export const expensesOf = (db) => services.get(db) ?? null;

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const role = (r) => ({ kind: 'role', role: r });
const TABLE_OF = { [CLAIM_DOC]: 'exp_claims', [ADVANCE_DOC]: 'exp_advances', [TRAVEL_DOC]: 'exp_travel_requests' };
/** The reporting manager of the person the record is for; the HR manager when there is none or the manager is the one who sent it. */
const managerResolver = ({ db, instance }) => {
  const r = db.prepare(`SELECT employee_id FROM ${TABLE_OF[instance.docType]} WHERE id = ?`).get(Number(instance.docId));
  const m = r && db.prepare('SELECT m.user_id FROM hr_employees e JOIN hr_employees m ON m.id = e.manager_id WHERE e.id = ?').get(r.employee_id);
  const u = m?.user_id ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(m.user_id)?.username : null;
  return u && !same(u, instance.submittedBy) ? [{ user: u }] : [{ role: 'HRMGR' }];
};
if (!workflowResolvers.get('exp.manager')) workflowResolvers.register('exp.manager', managerResolver);
const hooks = (docType) => ({
  onApproved: (db, { instance, actor }) => expensesOf(db)?.decisions[docType](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => expensesOf(db)?.decisions[docType](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => expensesOf(db)?.decisions[docType](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => expensesOf(db)?.decisions[docType](instance, actor, 'CANCELLED', comment),
});
const MGR = step('MANAGER', 'Reporting manager', [{ kind: 'resolver', resolver: 'exp.manager' }]);
workflowTypes.register({
  docType: CLAIM_DOC, label: 'Expense claim', processOwner: 'ACCMGR', route: (id) => `/expenses/claim?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.purpose, x.requested_by, e.full_name FROM exp_claims x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.full_name}: ${r.purpose}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, e.emp_code FROM exp_claims x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Claim', value: r.doc_no }, { label: 'Employee', value: `${r.full_name} (${r.emp_code})` }, { label: 'Period', value: `${r.period_from} to ${r.period_to}` }, { label: 'Purpose', value: r.purpose }, { label: 'Total', value: `Rs ${(r.total_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }, { label: 'Advance adjusted', value: `Rs ${(r.advance_adjusted_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }, { label: 'Net payable', value: `Rs ${(r.net_payable_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }, { label: 'Policy flags', value: String(r.flag_count) }] }; },
  defaultDefinition: { name: 'Expense claim: manager, accounts manager above ₹25,000, CFO above ₹1 lakh (a policy deviation moves it one level up)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [MGR, step('ACCMGR', 'Accounts manager', [role('ACCMGR')], { field: 'level', op: 'gte', value: 2 }), step('CFO', 'CFO', [role('CFO')], { field: 'level', op: 'gte', value: 3 })] },
  hooks: hooks(CLAIM_DOC),
});
workflowTypes.register({
  docType: ADVANCE_DOC, label: 'Employee advance', processOwner: 'HRMGR', route: (id) => `/expenses/advance?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.advance_type, x.requested_by, e.full_name FROM exp_advances x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.full_name}: ${ADVANCE_TYPES[r.advance_type]}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, e.emp_code FROM exp_advances x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ?').get(Number(id)); if (!r) return null; const open = db.prepare("SELECT COALESCE(SUM(balance_minor), 0) AS n FROM exp_advances WHERE employee_id = ? AND status = 'DISBURSED' AND id != ?").get(r.employee_id, r.id).n; return { fields: [{ label: 'Advance', value: r.doc_no }, { label: 'Employee', value: `${r.full_name} (${r.emp_code})` }, { label: 'Kind', value: ADVANCE_TYPES[r.advance_type] }, { label: 'Amount', value: `Rs ${(r.amount_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }, { label: 'Instalments', value: String(r.instalments) }, { label: 'Other advances outstanding', value: `Rs ${(open / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }, { label: 'Purpose', value: r.purpose }] }; },
  defaultDefinition: { name: 'Advance: manager, HR manager (salary) or accounts manager, CFO above the limit', settings: { resubmit: 'first', distinctApprovers: true }, steps: [MGR, step('HRMGR', 'HR manager', [role('HRMGR')], { field: 'kind', op: 'eq', value: 'SALARY' }), step('ACCMGR', 'Accounts manager', [role('ACCMGR')], { field: 'kind', op: 'ne', value: 'SALARY' }), step('CFO', 'CFO', [role('CFO')], { field: 'big', op: 'eq', value: true })] },
  hooks: hooks(ADVANCE_DOC),
});
workflowTypes.register({
  docType: TRAVEL_DOC, label: 'Travel request', processOwner: 'HRMGR', route: (id) => `/expenses/travel?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.to_place, x.requested_by, e.full_name FROM exp_travel_requests x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ? AND x.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.full_name}: ${r.to_place}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, e.full_name, e.emp_code FROM exp_travel_requests x JOIN hr_employees e ON e.id = x.employee_id WHERE x.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Request', value: r.doc_no }, { label: 'Employee', value: `${r.full_name} (${r.emp_code})` }, { label: 'Trip', value: `${r.from_place} to ${r.to_place}, ${r.start_date} to ${r.end_date}` }, { label: 'Purpose', value: r.purpose }, { label: 'Estimated cost', value: `Rs ${(r.est_cost_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }, { label: 'Advance asked', value: `Rs ${(r.advance_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }] }; },
  defaultDefinition: { name: 'Travel: manager, then the project manager (or the department head when there is no project)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [MGR, step('PM', 'Project manager', [role('PM')], { field: 'hasProject', op: 'eq', value: true }), step('DEPT', 'Department head', [{ kind: 'manager' }], { field: 'hasProject', op: 'eq', value: false })] },
  hooks: hooks(TRAVEL_DOC),
});
evidenceProviders.register(CLAIM_DOC, ({ db, instance }) => {
  const c = db.prepare('SELECT * FROM exp_claims WHERE id = ?').get(Number(instance.docId)); if (!c) return { sections: [] };
  const flags = db.prepare("SELECT line_no, policy_flag, flag_text, amount_minor, justification FROM exp_claim_lines WHERE claim_id = ? AND policy_flag != 'NONE' AND deleted_at IS NULL ORDER BY line_no").all(c.id);
  const history = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_minor), 0) AS s FROM exp_claims WHERE employee_id = ? AND id != ? AND status IN ('APPROVED', 'PASSED', 'PAID') AND doc_date >= date('now', '-90 days') AND deleted_at IS NULL").get(c.employee_id, c.id);
  const inr = (m) => `Rs ${(m / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  return { sections: [{ code: 'exp-claim', title: 'Before approving', kind: 'metrics', items: [{ label: 'Policy flags', value: flags.length ? flags.map((f) => `Line ${f.line_no}: ${f.flag_text}${f.justification ? ` (they say: ${f.justification})` : ''}`).join(' | ') : 'None', format: 'text', tone: flags.length ? 'warn' : undefined }, { label: 'Claims of this person in the last 90 days', value: `${history.n} for ${inr(history.s)}`, format: 'text' }, { label: 'Advance adjusted', value: inr(c.advance_adjusted_minor), format: 'text' }, { label: 'Net payable', value: inr(c.net_payable_minor), format: 'text' }] }] };
});
evidenceProviders.register(ADVANCE_DOC, ({ db, instance }) => {
  const a = db.prepare('SELECT * FROM exp_advances WHERE id = ?').get(Number(instance.docId)); if (!a) return { sections: [] };
  const open = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(balance_minor), 0) AS s FROM exp_advances WHERE employee_id = ? AND status = 'DISBURSED' AND id != ? AND deleted_at IS NULL").get(a.employee_id, a.id);
  return { sections: [{ code: 'exp-advance', title: 'Before approving', kind: 'metrics', items: [{ label: 'Other advances outstanding', value: `${open.n} for Rs ${(open.s / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, format: 'text', tone: open.n ? 'warn' : undefined }, { label: 'Recovery', value: a.recovery_mode === 'PAYROLL' ? `${a.instalments} instalment(s) from salary` : 'Settled against a claim', format: 'text' }] }] };
});
fileEntities.register({
  entity: 'exp_claim', label: 'Expense claim (bill photos)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, employee_id, created_by, status FROM exp_claims WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!r) return null;
    const a = authzOf(db);
    return { companyId: r.company_id, projectId: null, siteId: null, canView: same(r.created_by, actor.user) || a.check(actor, 'hr.claim.view_all').allowed || Boolean(expensesOf(db)?.canSee(actor, 'claim', r.employee_id)), canEdit: same(r.created_by, actor.user) && ['DRAFT', 'RETURNED'].includes(r.status), locked: false };
  },
});
