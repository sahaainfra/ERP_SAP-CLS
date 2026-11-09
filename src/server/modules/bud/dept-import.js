import { registerImportType } from '../eng/excel.js';
import { budOf } from './budgets.js';

// Part 12.04: department budgets through the Excel data-exchange engine (04.13). One row is one GL account of the budget of a cost centre for a financial year, with its twelve months. Each row goes into the open draft of that cost centre and year
// (made if there is none) through the department budget service, so it meets the same rules and permissions as the Workbench; an import never sends a budget for approval and never touches an approved one (it is changed by a new version).
const MONTHS = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
const svc = (db) => budOf(db)?.dept?.budgets ?? null;
const ccDept = "CASE WHEN linked_type = 'DEPARTMENT' THEN linked_id END";
const openOf = (db, companyId, fyId, ccId) => db.prepare("SELECT id, doc_no, status FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(companyId, fyId, ccId);
const inForce = (db, companyId, fyId, ccId) => db.prepare("SELECT doc_no FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(companyId, fyId, ccId);

registerImportType({
  code: 'BUD_DEPT_BUDGET', label: 'Department budget lines', module: 'bud',
  description: 'One row per GL account of the budget of a cost centre for a financial year, with the twelve months of the year (month 1 is the first month of the year, April for an April year). The rows go into the open draft of that cost centre and year, which is made when there is none; an account already in the draft is replaced. Nothing is sent for approval, and an approved budget is changed only by a new version.',
  permission: 'bud.dept_budget.create', exportPermission: 'bud.dept_budget.export', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'fy', label: 'Financial year', type: 'lookup', required: true, help: 'The code of the financial year, for example 2026-27.', lookup: {
      noun: 'financial year',
      resolve: (ctx, v) => ctx.db.prepare("SELECT id, code FROM core_financial_years WHERE company_id = ? AND deleted_at IS NULL AND code = ? COLLATE NOCASE").all(ctx.companyId, v),
      list: (ctx) => ctx.db.prepare("SELECT code FROM core_financial_years WHERE company_id = ? AND deleted_at IS NULL AND status = 'Open' ORDER BY start_date DESC").all(ctx.companyId).map((r) => r.code),
    } },
    { key: 'costCentre', label: 'Cost centre code', type: 'lookup', required: true, help: 'A cost centre of a department (not of a project or a site).', lookup: {
      noun: 'cost centre',
      resolve: (ctx, v) => ctx.db.prepare("SELECT id, code FROM org_cost_centres WHERE company_id = ? AND deleted_at IS NULL AND type = 'COST' AND status = 'ACTIVE' AND (linked_type IS NULL OR linked_type = 'DEPARTMENT') AND code = ? COLLATE NOCASE").all(ctx.companyId, v),
      list: (ctx) => ctx.db.prepare("SELECT code FROM org_cost_centres WHERE company_id = ? AND deleted_at IS NULL AND type = 'COST' AND status = 'ACTIVE' AND (linked_type IS NULL OR linked_type = 'DEPARTMENT') ORDER BY code LIMIT 1000").all(ctx.companyId).map((r) => r.code),
    } },
    { key: 'account', label: 'GL account code', type: 'lookup', required: true, help: 'An active expense account of the chart of accounts.', lookup: {
      noun: 'expense account',
      resolve: (ctx, v) => ctx.db.prepare("SELECT a.id, a.code FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE (a.company_id IS NULL OR a.company_id = ?) AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE' AND a.is_control = 0 AND g.nature = 'EXPENSE' AND a.code = ? ORDER BY a.company_id IS NULL LIMIT 1").all(ctx.companyId, v),
      list: (ctx) => ctx.db.prepare("SELECT a.code FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE (a.company_id IS NULL OR a.company_id = ?) AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE' AND a.is_control = 0 AND g.nature = 'EXPENSE' ORDER BY a.code").all(ctx.companyId).map((r) => r.code),
    } },
    ...MONTHS.map((k, i) => ({ key: k, label: `Month ${i + 1}`, type: 'money', min: 0, help: i === 0 ? 'Rupees, up to two decimals; empty is zero. Month 1 is the first month of the financial year.' : 'Rupees, up to two decimals; empty is zero.' })),
    { key: 'note', label: 'Note', type: 'text', maxLength: 300 },
  ],
  keys: ['fy', 'costCentre', 'account'],
  findExisting: () => null,
  validateRow(ctx, _row, ids) {
    const out = []; if (!ids.fy || !ids.costCentre) return out;
    const fy = ctx.db.prepare('SELECT code, status FROM core_financial_years WHERE id = ?').get(ids.fy); if (fy?.status !== 'Open') out.push({ column: 'fy', message: `Financial year ${fy?.code ?? ''} is closed.` });
    const dept = ctx.db.prepare(`SELECT ${ccDept} AS d FROM org_cost_centres WHERE id = ?`).get(ids.costCentre)?.d ?? null;
    if (!ctx.can('bud.dept_budget.create', dept != null ? { departmentId: dept } : {})) out.push({ column: 'costCentre', message: 'You may not prepare the budget of this cost centre (permission bud.dept_budget.create for its department).', code: 'PERMISSION' });
    const open = openOf(ctx.db, ctx.companyId, ids.fy, ids.costCentre);
    if (open?.status === 'SUBMITTED') out.push({ column: 'costCentre', message: `${open.doc_no} is waiting for approval: withdraw it before importing into it.` });
    else if (!open) { const a = inForce(ctx.db, ctx.companyId, ids.fy, ids.costCentre); if (a) out.push({ column: 'costCentre', message: `${a.doc_no} is approved: start a new version of it in the Workbench, then import into that draft.` }); }
    return out;
  },
  commitRow(ctx, { row, ids }) {
    const s = svc(ctx.db); if (!s) throw new Error('The department budget service is not running');
    const line = { accountId: ids.account, note: row.note ?? null, months: MONTHS.map((k) => Number(row[k] ?? 0)) };
    const open = openOf(ctx.db, ctx.companyId, ids.fy, ids.costCentre);
    if (!open) { const b = s.create(ctx.actor, { fyId: ids.fy, costCentreId: ids.costCentre, lines: [line], reason: 'Imported from Excel' }); return { id: b.id, ref: `${b.docNo} ${row.account}` }; }
    const cur = s.get(ctx.actor, open.id);
    const lines = [...cur.lines.filter((l) => l.accountId !== ids.account).map((l) => ({ accountId: l.accountId, note: l.note ?? null, months: l.months.map(Number) })), line];
    const b = s.update(ctx.actor, open.id, { lines });
    return { id: b.id, ref: `${b.docNo} ${row.account}` };
  },
  /** One budget per cost centre and year, in the shape of the template: the open draft when there is one (what an import would change), else the budget in force. */
  exportRows(ctx) {
    const pick = new Map();
    for (const b of ctx.db.prepare("SELECT b.id, b.status, b.department_id, f.code AS fy, c.code AS cc FROM bud_dept_budgets b JOIN core_financial_years f ON f.id = b.fy_id JOIN org_cost_centres c ON c.id = b.cost_centre_id WHERE b.company_id = ? AND b.deleted_at IS NULL AND b.status IN ('APPROVED', 'DRAFT', 'RETURNED', 'SUBMITTED') ORDER BY f.code, c.code").all(ctx.companyId)) {
      if (!ctx.can('bud.dept_budget.view', b.department_id != null ? { departmentId: b.department_id } : {})) continue;
      const k = `${b.fy}|${b.cc}`; if (!pick.has(k) || pick.get(k).status === 'APPROVED') pick.set(k, b);
    }
    const out = [];
    for (const b of pick.values()) {
      const by = new Map();
      for (const l of ctx.db.prepare('SELECT a.code, l.note, p.period_no, l.amount FROM bud_dept_lines l JOIN fin_accounts a ON a.id = l.account_id JOIN core_periods p ON p.id = l.period_id WHERE l.budget_id = ? AND l.deleted_at IS NULL ORDER BY a.code, p.period_no').all(b.id)) {
        const r = by.get(l.code) ?? { fy: b.fy, costCentre: b.cc, account: l.code, ...Object.fromEntries(MONTHS.map((m) => [m, '0.00'])), note: l.note ?? '' }; r[`m${l.period_no}`] = (l.amount / 100).toFixed(2); by.set(l.code, r);
      }
      out.push(...by.values());
    }
    return out;
  },
});
