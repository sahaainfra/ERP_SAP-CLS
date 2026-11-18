import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { PERIOD_MODULES, periodReopenHandler } from '../core/financial-years/service.js';
import { createFinancialYearRepository } from '../core/financial-years/repository.js';
import { SCHEDULE3 } from './service.js';

// Part 23.14: period close, financial statements and the finance dashboard.
//  FR-01 the close of a month (approval-controlled, ACCMGR → CFO) with its checklist: stores, payroll, depreciation, revenue recognition, accruals, bank
//  reconciliation, GST reconciliation, sub-ledgers, module locks, trial balance; owners, due dates, dependencies, evidence and the automatic check of each. A
//  mandatory task still open blocks the submission (T-01); the checklist of a close is configured on the close (owner, due date, extra tasks, optional tasks).
//  FR-02 the periods of the other modules are locked first (soft-closed), the GL is soft-closed when the close is sent and every module is closed (hard) when
//  the CFO approves; a closed month is reopened only by approval ACCMGR → CFO → DIR (the reopen of 01.03 applied for each module).
//  FR-03 statements from posted journals only (BR-01): trial balance, Schedule III balance sheet and P&L, cash flow (indirect), comparatives (previous period,
//  previous year), the accounts of each line (notes), month / quarter / year to date / year.
//  FR-04 year end: every month closed, the closing entries (the year's profit to retained earnings with the balances carried forward, 23.01), the year closed.
//  FR-05 dashboard: revenue, gross margin, EBITDA, cash, receivables and payables with ageing, working capital, DSO / DPO, debt, all from the ledger.

export const CLOSE_DOC = 'FIN_PERIOD_CLOSE';
export const REOPEN_DOC = 'FIN_PERIOD_REOPEN';
const rs = (p) => (p == null ? null : Math.round(p) / 100);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const POSTED = "j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL";

/** The default checklist (FR-01): code, name, module, owner role, days after the month end, mandatory, the tasks it waits for. */
export const TASKS = [
  { code: 'STORES', name: 'Stores closed: the inventory period locked', module: 'inventory', role: 'SK', days: 2, deps: [] },
  { code: 'PAYROLL', name: 'Payroll of the month posted', module: 'payroll', role: 'PAY', days: 3, deps: [] },
  { code: 'DEPRECIATION', name: 'Depreciation of the month run', module: 'assets', role: 'ACCMGR', days: 3, deps: [] },
  { code: 'REVREC', name: 'Revenue recognised for every project', module: 'projects', role: 'ACCMGR', days: 4, deps: [] },
  { code: 'ACCRUALS', name: 'Accruals and provisions posted', module: 'finance', role: 'FINEX', days: 5, deps: ['PAYROLL', 'DEPRECIATION', 'REVREC'], manual: true },
  { code: 'BANK_RECON', name: 'Bank reconciliation signed to the month end', module: 'finance', role: 'FINEX', days: 5, deps: [] },
  { code: 'GST_RECON', name: 'GST reconciliation: the ITC review approved', module: 'finance', role: 'FINEX', days: 10, deps: [] },
  { code: 'SUBLEDGER', name: 'Receivables and payables agree with their control accounts', module: 'finance', role: 'ACCMGR', days: 6, deps: ['BANK_RECON'] },
  { code: 'MODULE_LOCKS', name: 'Periods of the other modules locked', module: 'finance', role: 'ACCMGR', days: 6, deps: ['STORES', 'PAYROLL'], hard: true },
  { code: 'TB_REVIEW', name: 'Trial balance balanced and the ledger whole', module: 'finance', role: 'ACCMGR', days: 7, deps: ['ACCRUALS', 'BANK_RECON', 'GST_RECON', 'SUBLEDGER', 'MODULE_LOCKS'], hard: true },
];
const FALLBACK = { ASSET: 'BS_OTHER_CURRENT_ASSETS', LIABILITY: 'BS_OTHER_CURRENT_LIABILITIES', EQUITY: 'BS_OTHER_EQUITY', INCOME: 'PL_OTHER_INCOME', EXPENSE: 'PL_OTHER_EXPENSES' };
const CURRENT_ASSETS = ['BS_INVENTORIES', 'BS_TRADE_RECEIVABLES', 'BS_CASH', 'BS_ST_LOANS_ADVANCES', 'BS_OTHER_CURRENT_ASSETS'];
const CURRENT_LIABS = ['BS_ST_BORROWINGS', 'BS_TRADE_PAYABLES', 'BS_OTHER_CURRENT_LIABILITIES', 'BS_ST_PROVISIONS'];

export const closeList = defineList({
  code: 'fin.period_closes', label: 'Period closes', permission: 'fin.period.view', from: 'close_periods x', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.period'], defaultSort: '-period',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Close' }, period: { sql: 'x.period', type: 'text', label: 'Month', filter: 'eq' }, versionNo: { sql: 'x.version_no', type: 'number', label: 'Version' }, closeState: { sql: 'x.close_state', type: 'enum', label: 'State', options: ['IN_PROGRESS', 'SOFT_CLOSED', 'CLOSED', 'REOPENED'] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.keys(STATUS) }, lockedAt: { sql: 'x.locked_at', type: 'date', label: 'Closed on' } },
});

/** Pure: the indirect cash flow from the Schedule III lines at the start and the end, and the P&L of the period (FR-03). Sums to the change in cash. */
export function cashFlowOf(open, close, pl) {
  const d = (k) => (close[k] ?? 0) - (open[k] ?? 0); const pbt = pl.pbt; const dep = pl.lines.PL_DEPRECIATION ?? 0; const fc = pl.lines.PL_FINANCE_COSTS ?? 0; const tax = pl.lines.PL_TAX_EXPENSE ?? 0;
  const wc = [['Trade receivables', -d('BS_TRADE_RECEIVABLES')], ['Inventories', -d('BS_INVENTORIES')], ['Short-term loans and advances', -d('BS_ST_LOANS_ADVANCES')], ['Other current assets', -d('BS_OTHER_CURRENT_ASSETS')], ['Trade payables', d('BS_TRADE_PAYABLES')], ['Other current liabilities', d('BS_OTHER_CURRENT_LIABILITIES')], ['Short-term provisions', d('BS_ST_PROVISIONS')]];
  const operating = [['Profit before tax', pbt], ['Depreciation and amortisation', dep], ['Finance costs', fc], ...wc.map(([l, v]) => [`Change in ${String(l).toLowerCase()}`, v]), ['Income tax', -tax]];
  const investing = [['Property, plant and equipment', -(d('BS_PPE') + dep)], ['Capital work-in-progress', -d('BS_CWIP')], ['Non-current investments', -d('BS_NC_INVESTMENTS')], ['Long-term loans and advances', -d('BS_LT_LOANS_ADVANCES')]];
  const financing = [['Long-term borrowings', d('BS_LT_BORROWINGS')], ['Short-term borrowings', d('BS_ST_BORROWINGS')], ['Share capital', d('BS_SHARE_CAPITAL')], ['Finance costs paid', -fc], ['Other equity movements', d('BS_OTHER_EQUITY') - pl.pat]];
  const sum = (a) => a.reduce((s, [, v]) => s + v, 0); const net = sum(operating) + sum(investing) + sum(financing);
  return { operating, investing, financing, totals: { operating: sum(operating), investing: sum(investing), financing: sum(financing) }, net, openingCash: open.BS_CASH ?? 0, closingCash: close.BS_CASH ?? 0, reconciled: net === d('BS_CASH') };
}

/** The frame of a basis (FR-03): MONTH, QUARTER (of the financial year), YTD or YEAR around a month; with the previous period and the same frame a year before. */
export function frameOf(period, basis, fyStart) {
  const fyM = fyStart.slice(0, 7); const idx = (12 + Number(period.slice(5, 7)) - Number(fyM.slice(5, 7))) % 12;
  const f = (p) => { if (basis === 'MONTH') return { from: `${p}-01`, to: monthEnd(p) }; if (basis === 'QUARTER') { const q0 = addMonths(p, -((12 + Number(p.slice(5, 7)) - Number(fyM.slice(5, 7))) % 12 % 3)); return { from: `${q0}-01`, to: monthEnd(addMonths(q0, 2)) }; }
    const s = addMonths(p, -((12 + Number(p.slice(5, 7)) - Number(fyM.slice(5, 7))) % 12)); return basis === 'YTD' ? { from: `${s}-01`, to: monthEnd(p) } : { from: `${s}-01`, to: monthEnd(addMonths(s, 11)) }; };
  const cur = f(period); const len = basis === 'MONTH' ? 1 : basis === 'QUARTER' ? 3 : 12; void idx;
  const previous = basis === 'YTD' || basis === 'YEAR' ? f(addMonths(period, -12)) : f(addMonths(period, -len));
  return { ...cur, previous, lastYear: f(addMonths(period, -12)) };
}

/** @param {{ db: any, base: any, flags: any, gl: any }} o */
export function createPeriodCloseService({ db, base, flags, gl }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2314');
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const repo = createFinancialYearRepository(db);
  const usersOf = (companyId) => db.prepare("SELECT username, roles_json FROM iam_users WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY username").all(companyId).map((u) => { let r = []; try { r = JSON.parse(u.roles_json ?? '[]').flat(); } catch { /* none */ } return { user: u.username, roles: r }; });
  const rolesOf = (companyId, user) => usersOf(companyId).find((u) => u.user === user)?.roles ?? [];
  const fyOf = (companyId, date) => db.prepare('SELECT * FROM core_financial_years WHERE company_id = ? AND start_date <= ? AND end_date >= ?').get(companyId, date, date) ?? null;
  const statusMap = (p) => ({ ...Object.fromEntries(PERIOD_MODULES.map((m) => [m, 'Open'])), ...JSON.parse(p.module_status_json || '{}') });

  // ---- the ledger by Schedule III line (BR-01: posted journals only) ----
  const metaCache = new Map();
  function meta(companyId) {
    const groups = db.prepare('SELECT id, parent_id, schedule3_ref, nature FROM fin_account_groups WHERE company_id = ?').all(companyId); const byId = new Map(groups.map((g) => [g.id, g]));
    const lineOf = (g) => { for (let x = g; x; x = x.parent_id ? byId.get(x.parent_id) : null) if (x.schedule3_ref) return x.schedule3_ref; return null; };
    const known = new Set(SCHEDULE3.map((s) => s.code)); const m = new Map();
    for (const a of db.prepare('SELECT a.id, a.code, a.name, a.group_id, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id = ?').all(companyId)) { const ref = lineOf(byId.get(a.group_id)); m.set(a.id, { ...a, line: ref && known.has(ref) && SCHEDULE3.find((s) => s.code === ref).nature === a.nature ? ref : FALLBACK[a.nature] }); }
    metaCache.set(companyId, m); return m;
  }
  /** Balances (Dr − Cr) of every account at a date: the posted lines of its financial year to the date (the opening balances journal starts the year). */
  function balancesAt(companyId, asOf) {
    const fy = fyOf(companyId, asOf); if (!fy) return new Map();
    return new Map(db.prepare(`SELECT l.account_id AS id, SUM(l.debit_paise - l.credit_paise) AS b FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? GROUP BY l.account_id`).all(companyId, fy.start_date, asOf).map((r) => [r.id, r.b]));
  }
  const movement = (companyId, from, to) => new Map(db.prepare(`SELECT l.account_id AS id, SUM(l.debit_paise - l.credit_paise) AS b FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? AND j.kind <> 'OPENING' GROUP BY l.account_id`).all(companyId, from, to).map((r) => [r.id, r.b]));
  /** The balance sheet at a date by line (normal side positive), with the year's profit in other equity; the TB totals it ties to. */
  function position(companyId, asOf) {
    const m = meta(companyId); const bal = balancesAt(companyId, asOf); const lines = {}; const accounts = {}; let profit = 0; let dr = 0; let cr = 0;
    for (const [id, b] of bal) { const a = m.get(id); if (!a || !b) continue; if (b > 0) dr += b; else cr -= b;
      if (a.nature === 'INCOME' || a.nature === 'EXPENSE') { profit -= b; continue; } const v = a.nature === 'ASSET' ? b : -b; lines[a.line] = (lines[a.line] ?? 0) + v; (accounts[a.line] ??= []).push({ accountId: id, code: a.code, name: a.name, amount: v }); }
    lines.BS_OTHER_EQUITY = (lines.BS_OTHER_EQUITY ?? 0) + profit;
    const assets = SCHEDULE3.filter((s) => s.statement === 'BS' && s.nature === 'ASSET').reduce((s, x) => s + (lines[x.code] ?? 0), 0); const eqLiab = SCHEDULE3.filter((s) => s.statement === 'BS' && s.nature !== 'ASSET').reduce((s, x) => s + (lines[x.code] ?? 0), 0);
    return { lines, accounts, profit, assets, eqLiab, tb: { debit: dr, credit: cr, balanced: dr === cr } };
  }
  /** The P&L of a range by line (income credit-positive, expense debit-positive); PBT, tax, PAT, EBITDA. */
  function pnl(companyId, from, to) {
    const m = meta(companyId); const mv = movement(companyId, from, to); const lines = {}; const accounts = {};
    for (const [id, b] of mv) { const a = m.get(id); if (!a || !b || !['INCOME', 'EXPENSE'].includes(a.nature)) continue; const v = a.nature === 'INCOME' ? -b : b; lines[a.line] = (lines[a.line] ?? 0) + v; (accounts[a.line] ??= []).push({ accountId: id, code: a.code, name: a.name, amount: v }); }
    const income = SCHEDULE3.filter((s) => s.nature === 'INCOME').reduce((s, x) => s + (lines[x.code] ?? 0), 0); const expenses = SCHEDULE3.filter((s) => s.nature === 'EXPENSE' && s.code !== 'PL_TAX_EXPENSE').reduce((s, x) => s + (lines[x.code] ?? 0), 0);
    const pbt = income - expenses; const tax = lines.PL_TAX_EXPENSE ?? 0;
    return { lines, accounts, income, expenses, pbt, tax, pat: pbt - tax, ebitda: pbt + (lines.PL_FINANCE_COSTS ?? 0) + (lines.PL_DEPRECIATION ?? 0) };
  }
  const prevDay = (d) => addDays(d, -1);

  // ---- the automatic checks of the checklist ----
  const periodRow = (id) => db.prepare('SELECT * FROM core_periods WHERE id = ?').get(id);
  function checkOf(close, code) {
    const c = close.company_id; const p = close.period; const from = `${p}-01`; const to = monthEnd(p); const st = statusMap(periodRow(close.period_id));
    const locked = (mod) => (st[mod] === 'Open' ? { ok: false, detail: `${mod} is still open for ${p}.` } : { ok: true, detail: `${mod} is ${st[mod]}.` });
    switch (code) {
      case 'STORES': return locked('inventory');
      case 'PAYROLL': { if (st.payroll !== 'Open') return { ok: true, detail: `payroll is ${st.payroll}.` }; const n = db.prepare(`SELECT COUNT(*) AS n FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? AND g.code LIKE '53%'`).get(c, from, to).n; return n ? { ok: true, detail: `${n} payroll line(s) posted.` } : { ok: false, detail: 'No wages or salaries posted in the month.' }; }
      case 'DEPRECIATION': { if (!has('fa_dep_runs')) return { ok: true, detail: 'Fixed assets are not set up.' }; const r = db.prepare('SELECT doc_no, total_paise FROM fa_dep_runs WHERE company_id = ? AND period = ? AND deleted_at IS NULL').get(c, p); const assets = has('fa_assets') ? db.prepare("SELECT COUNT(*) AS n FROM fa_assets WHERE company_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND cap_date <= ?").get(c, to).n : 0; return r ? { ok: true, detail: `${r.doc_no}: ₹${rs(r.total_paise)}.` } : assets ? { ok: false, detail: `No depreciation run for ${p} (${assets} asset(s) in use).` } : { ok: true, detail: 'No asset in use.' }; }
      case 'REVREC': { if (!has('pa_revenue_recognition')) return { ok: true, detail: 'Project accounting is not set up.' }; const due = db.prepare(`SELECT DISTINCT l.project_id AS id FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? AND l.project_id IS NOT NULL AND g.nature IN ('INCOME', 'EXPENSE')`).all(c, from, to).map((r) => r.id);
        const done = new Set(db.prepare("SELECT org_project_id AS id FROM pa_revenue_recognition WHERE company_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL").all(c, p).map((r) => r.id)); const miss = due.filter((x) => !done.has(x)); return miss.length ? { ok: false, detail: `${miss.length} project(s) with income or cost in the month have no approved recognition.` } : { ok: true, detail: `${due.length} project(s) recognised.` }; }
      case 'BANK_RECON': { if (!has('fin_bank_recons')) return { ok: true, detail: 'Bank reconciliation is not set up.' }; const banks = db.prepare('SELECT id, name FROM fin_bank_accounts WHERE company_id = ? AND deleted_at IS NULL').all(c); const miss = banks.filter((b) => !db.prepare('SELECT 1 FROM fin_bank_recons WHERE company_id = ? AND bank_account_id = ? AND as_of >= ? AND deleted_at IS NULL').get(c, b.id, to)); return miss.length ? { ok: false, detail: `Not reconciled to ${to}: ${miss.map((b) => b.name).join(', ')}.` } : { ok: true, detail: `${banks.length} bank account(s) reconciled.` }; }
      case 'GST_RECON': { if (!has('gst_itc_reviews')) return { ok: true, detail: 'GST is not set up.' }; const r = db.prepare("SELECT doc_no FROM gst_itc_reviews WHERE company_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(c, p); return r ? { ok: true, detail: `${r.doc_no} approved.` } : { ok: false, detail: `No approved ITC review for ${p}.` }; }
      case 'SUBLEDGER': { const ctl = (code) => db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise), 0) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date <= ? AND j.voucher_date >= ? AND a.code = ?`).get(c, to, fyOf(c, to)?.start_date ?? '0000-01-01', code).v;
        const ar = has('ar_invoices') ? db.prepare("SELECT COALESCE(SUM(amount_paise - received_paise - credited_paise - written_off_paise), 0) AS v FROM ar_invoices WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND invoice_date <= ?").get(c, to).v : 0; const ap = has('ap_bills') ? db.prepare("SELECT COALESCE(SUM(net_payable_paise - adjusted_paise - paid_paise), 0) AS v FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(c).v : 0;
        const dAr = ctl('140001') - ar; const dAp = -ctl('220001') - ap; return dAr === 0 && dAp === 0 ? { ok: true, detail: `Receivables ₹${rs(ar)} and payables ₹${rs(ap)} agree with the ledger.` } : { ok: false, detail: `Difference: receivables ₹${rs(dAr)}, payables ₹${rs(dAp)} (ledger less sub-ledger).` }; }
      case 'MODULE_LOCKS': { const open = PERIOD_MODULES.filter((m) => m !== 'finance' && st[m] === 'Open'); return open.length ? { ok: false, detail: `Still open: ${open.join(', ')}.` } : { ok: true, detail: 'Every other module is locked.' }; }
      case 'TB_REVIEW': { const x = position(c, to); return x.tb.balanced && x.assets === x.eqLiab ? { ok: true, detail: `Debit = credit ₹${rs(x.tb.debit)}; the balance sheet balances.` } : { ok: false, detail: `Debit ₹${rs(x.tb.debit)}, credit ₹${rs(x.tb.credit)}; assets ₹${rs(x.assets)} against ₹${rs(x.eqLiab)}.` }; }
      default: return { ok: null, detail: 'Checked by hand: attach the evidence.' };
    }
  }

  // ---- period statuses (01.03): the lock of a module and the close of every module ----
  function setModules(actor, periodId, modules, to) {
    const p = periodRow(periodId); const cur = statusMap(p); const changed = modules.filter((m) => cur[m] !== to && !(cur[m] === 'Closed'));
    if (!changed.length) return; const next = { ...cur, ...Object.fromEntries(changed.map((m) => [m, to])) };
    if (!repo.setPeriodStatuses(p.id, p.version, JSON.stringify(next), actor.user, nowIso())) throw conflict('The period was changed by someone else. Refresh and try again.');
    for (const m of changed) { writeAudit(db, { entity: 'core_periods', entityId: p.id, action: 'status', oldValues: { module: m, status: cur[m] }, newValues: { module: m, status: to }, reason: 'period close (23.14)', actor: actor.user, companyId: p.company_id }); publishEvent(db, { type: 'core.period.status_changed', entity: 'period', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { module: m, from: cur[m], to, period: p.name } }); }
  }

  // ---- the close (approval-controlled) ----
  const tasksOf = (id) => db.prepare('SELECT * FROM close_tasks WHERE close_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(id);
  const isDone = (t) => ['DONE', 'NOT_APPLICABLE'].includes(t.task_status);
  const figures = (c, period) => { const to = monthEnd(period); const fy = fyOf(c, to); const x = position(c, to); const m = pnl(c, `${period}-01`, to); const y = pnl(c, fy?.start_date ?? `${period}-01`, to);
    return { tbDebit: rs(x.tb.debit), tbCredit: rs(x.tb.credit), balanced: x.tb.balanced, assets: rs(x.assets), equityLiabilities: rs(x.eqLiab), revenue: rs(m.lines.PL_REVENUE ?? 0), pbt: rs(m.pbt), pat: rs(m.pat), revenueYtd: rs(y.lines.PL_REVENUE ?? 0), patYtd: rs(y.pat), cash: rs(x.lines.BS_CASH ?? 0) }; };
  const flow = createFlow({ db, base, docType: CLOSE_DOC, table: 'close_periods', perm: 'fin.period', label: 'period close', route: '/finance/close?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ period: r.period, makerRole: rolesOf(r.company_id, r.requested_by ?? r.created_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER' }), title: (r) => `Close of ${r.period}`, notifyCode: 'fin.close.decided', prefix: 'CL',
    beforeSubmit: (actor, r) => {
      if (!on(r.company_id)) throw unprocessable('Period close is off for the company (ff.fin.p2314).');
      const open = tasksOf(r.id).filter((t) => t.mandatory && !isDone(t)); if (open.length) throw unprocessable(`The close cannot be sent while mandatory tasks are open: ${open.map((t) => t.name).join('; ')}.`);
      const f = figures(r.company_id, r.period); if (!f.balanced) throw unprocessable('The trial balance does not balance: debit and credit differ.');
      setModules(actor, r.period_id, ['finance'], 'Soft-closed'); db.prepare("UPDATE close_periods SET close_state = 'SOFT_CLOSED', soft_closed_at = ?, figures_json = ? WHERE id = ?").run(nowIso(), JSON.stringify(f), r.id);
    },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM close_periods WHERE id = ?').get(r.id); const open = tasksOf(x.id).filter((t) => t.mandatory && !isDone(t)); if (open.length) throw unprocessable(`Mandatory tasks reopened since it was sent: ${open.map((t) => t.name).join('; ')}.`);
      const f = figures(x.company_id, x.period); if (!f.balanced) throw unprocessable('The trial balance no longer balances.');
      setModules(actor, x.period_id, [...PERIOD_MODULES], 'Closed'); db.prepare("UPDATE close_periods SET close_state = 'CLOSED', locked_at = ?, figures_json = ? WHERE id = ?").run(nowIso(), JSON.stringify(f), x.id);
      evt('fin.period.closed', actor, x.company_id, 'close_periods', x.id, { closeId: x.id, docNo: x.doc_no, period: x.period, periodId: x.period_id, ...f });
    },
    onOutcome: (actor, r, status) => { if (['RETURNED', 'REJECTED', 'CANCELLED', 'DRAFT'].includes(status)) { const p = periodRow(r.period_id); if (statusMap(p).finance === 'Soft-closed') { const cur = statusMap(p); repo.setPeriodStatuses(p.id, p.version, JSON.stringify({ ...cur, finance: 'Open' }), actor.user, nowIso()); writeAudit(db, { entity: 'core_periods', entityId: p.id, action: 'status', oldValues: { module: 'finance', status: 'Soft-closed' }, newValues: { module: 'finance', status: 'Open' }, reason: `close ${status.toLowerCase()}`, actor: actor.user, companyId: p.company_id }); } db.prepare("UPDATE close_periods SET close_state = 'IN_PROGRESS', soft_closed_at = NULL WHERE id = ?").run(r.id); } },
  });
  const ownerOf = (companyId, role) => usersOf(companyId).find((u) => u.roles.includes(role))?.user ?? null;
  const taskView = (actor, close, t, all) => { const deps = JSON.parse(t.depends_on_json || '[]'); const waiting = deps.filter((d) => { const x = all.find((y) => y.task_code === d); return x && !isDone(x); }); const check = checkOf(close, t.task_code); const mine = t.owner_id === actor.user;
    const editable = ['DRAFT', 'RETURNED'].includes(close.status);
    return { id: t.id, code: t.task_code, name: t.name, module: t.module, mandatory: Boolean(t.mandatory), dependsOn: deps, waitingFor: waiting, ownerRole: t.owner_role, owner: t.owner_id, dueDate: t.due_date, overdue: !isDone(t) && t.due_date && t.due_date < todayIST(), status: t.task_status, check, evidence: t.evidence_note, files: JSON.parse(t.evidence_file_ids || '[]'), doneBy: t.done_by, doneAt: t.done_at, version: t.version,
      can: { complete: editable && !isDone(t) && !waiting.length && (may(actor, 'fin.period.edit') || (mine && may(actor, 'fin.close_task.complete'))), reopen: editable && isDone(t) && may(actor, 'fin.period.edit'), edit: editable && may(actor, 'fin.period.edit') } }; };
  const view = (actor, r, detail = false) => {
    const p = periodRow(r.period_id); const o = { id: r.id, docNo: r.doc_no, versionNo: r.version_no, period: r.period, periodId: r.period_id, periodName: p?.name, closeState: r.close_state, status: r.status, statusLabel: STATUS[r.status], commentary: r.commentary, softClosedAt: r.soft_closed_at, lockedAt: r.locked_at, reopenedAt: r.reopened_at, requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version, can: { ...flow.can(actor, r) } };
    if (detail) { const all = tasksOf(r.id); o.tasks = all.map((t) => taskView(actor, r, t, all)); o.modules = statusMap(p); o.progress = { done: all.filter(isDone).length, total: all.length, mandatoryOpen: all.filter((t) => t.mandatory && !isDone(t)).length };
      o.figures = r.status === 'APPROVED' ? JSON.parse(r.figures_json || '{}') : figures(r.company_id, r.period); Object.assign(o.can, flow.approveInfo(actor, r), { lock: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'fin.period.edit'), addTask: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'fin.period.edit'), reopen: r.status === 'APPROVED' && r.close_state === 'CLOSED' && may(actor, 'fin.period_reopen.create') });
      o.reopens = db.prepare('SELECT id, doc_no, status, reason, target_status, modules_json FROM close_reopens WHERE close_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((x) => ({ id: x.id, docNo: x.doc_no, status: x.status, reason: x.reason, targetStatus: x.target_status, modules: JSON.parse(x.modules_json) }));
      o.history = flow.history(actor, r.id); }
    return o;
  };
  const editable = (actor, id, key = 'fin.period.edit') => { const r = flow.row(actor, id, key); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a close in progress is changed.'); return r; };
  const taskRow = (r, tid) => db.prepare('SELECT * FROM close_tasks WHERE id = ? AND close_id = ? AND deleted_at IS NULL').get(Number(tid), r.id) ?? (() => { throw notFound('That task is not on this close.'); })();
  const closes = {
    flow,
    list(actor, query) { need(actor, 'fin.period.view', 'see period closes'); return runList(db, closeList, parseListRequest(closeList, query), { select: 'x.*', scopeSql: 'x.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { return view(actor, flow.row(actor, id), true); },
    /** FR-01: the close of an ended month with its checklist. */
    create(actor, b) {
      need(actor, 'fin.period.create', 'start a period close'); const c = actor.companyId; const period = b.period; const to = monthEnd(period);
      if (to >= todayIST()) throw badRequest('Correct the highlighted fields', [{ field: 'period', message: 'A month is closed once it has ended.' }]);
      const p = repo.periodByDate(c, `${period}-01`); if (!p) throw unprocessable(`No financial year period covers ${period}; ask the System Administrator to create the year.`);
      if (statusMap(p).finance === 'Closed' && db.prepare("SELECT 1 FROM close_periods WHERE company_id = ? AND period_id = ? AND status = 'APPROVED' AND close_state = 'CLOSED' AND deleted_at IS NULL").get(c, p.id)) throw conflict(`${period} is closed; reopen it first.`);
      const version = (db.prepare('SELECT MAX(version_no) AS v FROM close_periods WHERE company_id = ? AND period_id = ?').get(c, p.id).v ?? 0) + 1;
      return transaction(db, () => { let id; try { id = Number(db.prepare("INSERT INTO close_periods (company_id, doc_no, version_no, period_id, period, commentary, created_by, source_type, checklist_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'api', ?)").run(c, flow.next(actor), version, p.id, period, b.commentary ?? null, actor.user, JSON.stringify(TASKS.map((t) => t.code))).lastInsertRowid); } catch (e) { if (/UNIQUE/.test(String(e.message))) throw conflict(`A close of ${period} is already in progress.`); throw e; }
        const ins = db.prepare("INSERT INTO close_tasks (company_id, close_id, task_code, name, module, sort_order, mandatory, depends_on_json, owner_role, owner_id, due_date, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'close_template')");
        TASKS.forEach((t, k) => ins.run(c, id, t.code, t.name, t.module, (k + 1) * 10, JSON.stringify(t.deps), t.role, ownerOf(c, t.role) ?? ownerOf(c, 'ACCMGR'), addDays(to, t.days), actor.user));
        audit(actor, 'close_periods', id, 'create', c, { newValues: { period, version } }); return closes.get(actor, id); });
    },
    update(actor, id, b) { const r = editable(actor, id); db.prepare('UPDATE close_periods SET commentary = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.commentary ?? null, actor.user, nowIso(), r.id); audit(actor, 'close_periods', r.id, 'update', r.company_id); return closes.get(actor, r.id); },
    /** The configurable checklist: an extra task of this close. */
    addTask(actor, id, b) { const r = editable(actor, id); const code = `X${Date.now().toString(36).toUpperCase()}`.slice(0, 12); const deps = (b.dependsOn ?? []).filter((d) => tasksOf(r.id).some((t) => t.task_code === d));
      if (b.ownerId && !usersOf(r.company_id).some((u) => u.user === b.ownerId)) throw badRequest('Correct the highlighted fields', [{ field: 'ownerId', message: 'Not a user of the company.' }]);
      const tid = Number(db.prepare("INSERT INTO close_tasks (company_id, close_id, task_code, name, module, sort_order, mandatory, depends_on_json, owner_role, owner_id, due_date, created_by, source_type) VALUES (?, ?, ?, ?, 'finance', ?, ?, ?, NULL, ?, ?, ?, 'api')").run(r.company_id, r.id, code, b.name, 95, b.mandatory === false ? 0 : 1, JSON.stringify(deps), b.ownerId ?? actor.user, b.dueDate ?? addDays(monthEnd(r.period), 7), actor.user).lastInsertRowid);
      audit(actor, 'close_tasks', tid, 'create', r.company_id, { newValues: { name: b.name } }); return closes.get(actor, r.id); },
    /** Owner, due date; a mandatory task made optional only by fin.period.configure (with the reason). */
    updateTask(actor, id, tid, b) { const r = editable(actor, id); const t = taskRow(r, tid); if (b.version != null && b.version !== t.version) throw conflict('Someone changed this task: reload it.');
      if (b.mandatory === false && t.mandatory) { need(actor, 'fin.period.configure', 'make a close task optional'); if (!(b.reason ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'reason', message: 'Say why the task is optional for this close.' }]); if (TASKS.find((x) => x.code === t.task_code)?.hard) throw unprocessable('The module locks and the trial balance review are never optional.'); }
      if (b.ownerId && !usersOf(r.company_id).some((u) => u.user === b.ownerId)) throw badRequest('Correct the highlighted fields', [{ field: 'ownerId', message: 'Not a user of the company.' }]);
      db.prepare("UPDATE close_tasks SET owner_id = COALESCE(?, owner_id), due_date = COALESCE(?, due_date), mandatory = COALESCE(?, mandatory), task_status = CASE WHEN ? = 1 AND task_status = 'OPEN' THEN 'IN_PROGRESS' ELSE task_status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.ownerId ?? null, b.dueDate ?? null, b.mandatory == null ? null : b.mandatory ? 1 : 0, b.started ? 1 : 0, actor.user, nowIso(), t.id);
      audit(actor, 'close_tasks', t.id, 'update', r.company_id, { reason: b.reason ?? null, oldValues: { owner: t.owner_id, due: t.due_date, mandatory: t.mandatory }, newValues: { owner: b.ownerId, due: b.dueDate, mandatory: b.mandatory } }); return closes.get(actor, r.id); },
    /** A task done (its check passing, or the evidence explaining the difference) or not applicable (an optional task). */
    completeTask(actor, id, tid, b) {
      const r = flow.row(actor, id); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a close in progress is changed.'); const t = taskRow(r, tid); const all = tasksOf(r.id); const v = taskView(actor, r, t, all);
      if (!may(actor, 'fin.period.edit') && !(t.owner_id === actor.user && may(actor, 'fin.close_task.complete'))) throw forbidden('Only the owner of the task or the accounts manager completes it.');
      if (isDone(t)) throw conflict('The task is already done.'); if (v.waitingFor.length) throw unprocessable(`The task waits for: ${v.waitingFor.join(', ')}.`);
      if (b.notApplicable) { if (t.mandatory) throw unprocessable('A mandatory task is done, not skipped.'); if ((b.note ?? '').trim().length < 5) throw badRequest('Correct the highlighted fields', [{ field: 'note', message: 'Say why it does not apply.' }]); }
      else if (v.check.ok === false) { if (TASKS.find((x) => x.code === t.task_code)?.hard) throw unprocessable(`The check does not pass: ${v.check.detail}`); if ((b.note ?? '').trim().length < 10) throw badRequest('Correct the highlighted fields', [{ field: 'note', message: `The check does not pass (${v.check.detail}); explain it in the evidence (at least 10 characters).` }]); }
      else if (v.check.ok === null && (b.note ?? '').trim().length < 5 && !(b.fileIds ?? []).length) throw badRequest('Correct the highlighted fields', [{ field: 'note', message: 'Attach the evidence or describe it.' }]);
      db.prepare('UPDATE close_tasks SET task_status = ?, evidence_note = ?, evidence_file_ids = ?, check_json = ?, done_by = ?, done_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.notApplicable ? 'NOT_APPLICABLE' : 'DONE', b.note ?? null, JSON.stringify(b.fileIds ?? []), JSON.stringify(v.check), actor.user, nowIso(), actor.user, nowIso(), t.id);
      audit(actor, 'close_tasks', t.id, 'complete', r.company_id, { reason: b.note ?? null, newValues: { status: b.notApplicable ? 'NOT_APPLICABLE' : 'DONE', check: v.check } }); return closes.get(actor, r.id);
    },
    reopenTask(actor, id, tid, { reason }) { const r = editable(actor, id); const t = taskRow(r, tid); if (!isDone(t)) throw conflict('The task is not done.'); db.prepare("UPDATE close_tasks SET task_status = 'OPEN', done_by = NULL, done_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), t.id); audit(actor, 'close_tasks', t.id, 'reopen', r.company_id, { reason }); return closes.get(actor, r.id); },
    /** FR-02: a module's period locked (soft-closed) from the close. Finance itself is soft-closed when the close is sent. */
    lock(actor, id, { modules }) { const r = editable(actor, id); const bad = modules.filter((m) => !PERIOD_MODULES.includes(m) || m === 'finance'); if (bad.length) throw badRequest('Correct the highlighted fields', [{ field: 'modules', message: `Not a module locked here: ${bad.join(', ')}.` }]); setModules(actor, r.period_id, modules, 'Soft-closed'); audit(actor, 'close_periods', r.id, 'lock', r.company_id, { newValues: { modules } }); return closes.get(actor, r.id); },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return closes.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return closes.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return closes.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    print(actor, id) { const r = flow.row(actor, id, 'fin.period.print'); const x = view(actor, r, true); audit(actor, 'close_periods', r.id, 'print', r.company_id);
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Close ${r.doc_no} · ${r.period} · ${STATUS[r.status]}`, columns: [{ key: 't', label: 'Task', type: 'text' }, { key: 'o', label: 'Owner', type: 'text' }, { key: 'd', label: 'Due', type: 'text' }, { key: 's', label: 'Status', type: 'text' }, { key: 'e', label: 'Evidence / check', type: 'text' }], rows: x.tasks.map((t) => ({ t: `${t.name}${t.mandatory ? '' : ' (optional)'}`, o: t.owner ?? '', d: t.dueDate ?? '', s: t.status, e: t.evidence ?? t.check.detail })), footer: [`Trial balance ₹${x.figures.tbDebit} / ₹${x.figures.tbCredit}; revenue ₹${x.figures.revenue}; profit after tax ₹${x.figures.pat}.`] }) }; },
    exportCsv(actor, query = {}) { need(actor, 'fin.period.export', 'export period closes'); const l = closes.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'close_periods', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: 'period-closes.csv', buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Close', 'Month', 'Version', 'State', 'Status', 'Closed on'], l.data.map((x) => [x.docNo, x.period, x.versionNo, x.closeState, x.statusLabel, x.lockedAt ?? '']))}`, 'utf8') }; },
  };

  // ---- the reopen of a closed month: ACCMGR → CFO → DIR ----
  const reopenFlow = createFlow({ db, base, docType: REOPEN_DOC, table: 'close_reopens', perm: 'fin.period_reopen', label: 'period reopen', route: '/finance/close?reopen=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ makerRole: rolesOf(r.company_id, r.requested_by ?? r.created_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER' }), title: (r) => `Reopen ${db.prepare('SELECT period FROM close_periods WHERE id = ?').get(r.close_id)?.period ?? ''}: ${r.reason}`, notifyCode: 'fin.close.decided', prefix: 'RO',
    beforeSubmit: (_a, r) => { const c = db.prepare('SELECT * FROM close_periods WHERE id = ?').get(r.close_id); if (!(c.status === 'APPROVED' && c.close_state === 'CLOSED')) throw unprocessable('Only a closed month is reopened.'); },
    onApproved: (actor, r) => { const c = db.prepare('SELECT * FROM close_periods WHERE id = ?').get(r.close_id); const mods = JSON.parse(r.modules_json); const fy = db.prepare('SELECT f.* FROM core_financial_years f JOIN core_periods p ON p.fy_id = f.id WHERE p.id = ?').get(r.period_id);
      for (const m of mods) { const p = periodRow(r.period_id); if (statusMap(p)[m] !== 'Closed' && fy.status !== 'Closed') continue; periodReopenHandler.apply(db, { id: r.id, companyId: r.company_id, reason: r.reason, payload: { periodId: r.period_id, module: m, targetStatus: r.target_status } }, actor); }
      db.prepare("UPDATE close_periods SET close_state = 'REOPENED', reopened_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), c.id);
      evt('fin.period.reopened', actor, r.company_id, 'close_periods', c.id, { closeId: c.id, reopenId: r.id, period: c.period, periodId: c.period_id, modules: mods, to: r.target_status, reason: r.reason });
      notify(r.company_id, 'fin.close.alert', ['permission:fin.period.approve', `user:${r.requested_by}`], r.doc_no, 'month reopened', `${c.period} is reopened (${mods.join(', ')}) as ${r.target_status}: ${r.reason}`, `/finance/close?id=${c.id}`, `${r.id}-reopened`); },
  });
  const reopenView = (actor, r) => ({ id: r.id, docNo: r.doc_no, closeId: r.close_id, period: db.prepare('SELECT period FROM close_periods WHERE id = ?').get(r.close_id)?.period, modules: JSON.parse(r.modules_json), targetStatus: r.target_status, reason: r.reason, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, can: { ...reopenFlow.can(actor, r), ...reopenFlow.approveInfo(actor, r) }, history: reopenFlow.history(actor, r.id) });
  const reopens = {
    flow: reopenFlow,
    get: (actor, id) => reopenView(actor, reopenFlow.row(actor, id)),
    /** A reopen request, sent at once for approval. */
    request(actor, closeId, b) {
      need(actor, 'fin.period_reopen.create', 'ask for a month to be reopened'); const c = flow.row(actor, closeId); if (!(c.status === 'APPROVED' && c.close_state === 'CLOSED')) throw conflict('Only a closed month is reopened.');
      const mods = (b.modules?.length ? b.modules : [...PERIOD_MODULES]).filter((m) => PERIOD_MODULES.includes(m)); if (!mods.length) throw badRequest('Correct the highlighted fields', [{ field: 'modules', message: 'Choose the modules to reopen.' }]);
      let id; try { id = Number(db.prepare("INSERT INTO close_reopens (company_id, doc_no, close_id, period_id, modules_json, target_status, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c.company_id, reopenFlow.next(actor), c.id, c.period_id, JSON.stringify(mods), b.targetStatus ?? 'Soft-closed', b.reason, actor.user).lastInsertRowid); } catch (e) { if (/UNIQUE/.test(String(e.message))) throw conflict('A reopen of this month is already asked for.'); throw e; }
      audit(actor, 'close_reopens', id, 'create', c.company_id, { reason: b.reason, newValues: { modules: mods, to: b.targetStatus ?? 'Soft-closed' } }); reopenFlow.submit(actor, id); return reopens.get(actor, id);
    },
    withdraw(actor, id, b) { reopenFlow.withdraw(actor, id, b); return reopens.get(actor, id); },
  };

  // ---- FR-03: the statements ----
  const fyFor = (actor, period) => { const fy = fyOf(actor.companyId, `${period}-01`); if (!fy) throw unprocessable(`No financial year covers ${period}.`); return fy; };
  const lineSet = (statement) => SCHEDULE3.filter((s) => s.statement === statement);
  const rowsOf = (set, cur, cmp, accounts) => set.map((s) => ({ code: s.code, section: s.section, label: s.label, amount: rs(cur[s.code] ?? 0), previous: rs(cmp[0]?.[s.code] ?? 0), lastYear: rs(cmp[1]?.[s.code] ?? 0), accounts: (accounts[s.code] ?? []).map((a) => ({ ...a, amount: rs(a.amount) })) }));
  const statements = {
    /** The statements of a month, quarter, year to date or year with the comparatives (BR-01: posted journals only; tied to the trial balance). */
    get(actor, { period, basis = 'MONTH', statement = 'ALL' }) {
      need(actor, 'fin.statements.view', 'see the financial statements'); const c = actor.companyId; const fy = fyFor(actor, period); const fr = frameOf(period, basis, fy.start_date); const out = { period, basis, from: fr.from, to: fr.to, previous: fr.previous, lastYear: fr.lastYear, fy: fy.code };
      const bs = position(c, fr.to); const bsP = position(c, fr.previous.to); const bsY = position(c, fr.lastYear.to);
      const pl = pnl(c, fr.from, fr.to); const plP = pnl(c, fr.previous.from, fr.previous.to); const plY = pnl(c, fr.lastYear.from, fr.lastYear.to);
      out.tieOut = { tbDebit: rs(bs.tb.debit), tbCredit: rs(bs.tb.credit), balanced: bs.tb.balanced, assets: rs(bs.assets), equityLiabilities: rs(bs.eqLiab), balanceSheetBalances: bs.assets === bs.eqLiab, profitInEquity: rs(bs.profit) };
      if (['ALL', 'BS'].includes(statement)) out.balanceSheet = { rows: rowsOf(lineSet('BS'), bs.lines, [bsP.lines, bsY.lines], bs.accounts), totals: { assets: rs(bs.assets), equityLiabilities: rs(bs.eqLiab), previous: { assets: rs(bsP.assets), equityLiabilities: rs(bsP.eqLiab) }, lastYear: { assets: rs(bsY.assets), equityLiabilities: rs(bsY.eqLiab) } } };
      const sumP = (x) => ({ income: rs(x.income), expenses: rs(x.expenses), pbt: rs(x.pbt), tax: rs(x.tax), pat: rs(x.pat), ebitda: rs(x.ebitda) });
      if (['ALL', 'PL'].includes(statement)) out.profitAndLoss = { rows: rowsOf(lineSet('PL'), pl.lines, [plP.lines, plY.lines], pl.accounts), totals: { ...sumP(pl), previous: sumP(plP), lastYear: sumP(plY) } };
      if (['ALL', 'CF'].includes(statement)) { const open = position(c, prevDay(fr.from)); const cf = cashFlowOf(open.lines, bs.lines, pl); const fmt = (a) => a.map(([label, v]) => ({ label, amount: rs(v) })); out.cashFlow = { operating: fmt(cf.operating), investing: fmt(cf.investing), financing: fmt(cf.financing), totals: { operating: rs(cf.totals.operating), investing: rs(cf.totals.investing), financing: rs(cf.totals.financing) }, net: rs(cf.net), openingCash: rs(cf.openingCash), closingCash: rs(cf.closingCash), reconciled: cf.reconciled }; }
      if (['ALL', 'TB'].includes(statement)) { const m = meta(c); const bal = balancesAt(c, fr.to); out.trialBalance = { rows: [...bal.entries()].filter(([, b]) => b).map(([id, b]) => ({ accountId: id, code: m.get(id)?.code, name: m.get(id)?.name, line: m.get(id)?.line, debit: b > 0 ? rs(b) : 0, credit: b < 0 ? rs(-b) : 0 })).sort((a, b) => String(a.code).localeCompare(String(b.code))), totals: { debit: rs(bs.tb.debit), credit: rs(bs.tb.credit) } }; }
      return out;
    },
    exportCsv(actor, q) { need(actor, 'fin.statements.export', 'export the financial statements'); const x = statements.get(actor, q); audit(actor, 'close_periods', 0, 'export', actor.companyId, { reason: `statements ${q.period} ${q.basis ?? 'MONTH'}` });
      const rows = [...(x.balanceSheet?.rows ?? []).map((r) => ['Balance sheet', r.section, r.label, r.amount, r.previous, r.lastYear]), ...(x.profitAndLoss?.rows ?? []).map((r) => ['Profit and loss', r.section, r.label, r.amount, r.previous, r.lastYear]), ...(x.cashFlow ? [...x.cashFlow.operating.map((r) => ['Cash flow', 'Operating', r.label, r.amount, '', '']), ...x.cashFlow.investing.map((r) => ['Cash flow', 'Investing', r.label, r.amount, '', '']), ...x.cashFlow.financing.map((r) => ['Cash flow', 'Financing', r.label, r.amount, '', ''])] : [])];
      return { contentType: 'text/csv; charset=utf-8', fileName: `statements-${q.period}-${(q.basis ?? 'MONTH').toLowerCase()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Statement', 'Section', 'Line', `${x.from}..${x.to}`, 'Previous', 'Last year'], rows)}`, 'utf8') }; },
    print(actor, q) { need(actor, 'fin.statements.view', 'print the financial statements'); const x = statements.get(actor, q);
      const rows = [...x.balanceSheet.rows.map((r) => ({ l: `BS · ${r.section} · ${r.label}`, a: r.amount, p: r.previous, y: r.lastYear })), ...x.profitAndLoss.rows.map((r) => ({ l: `P&L · ${r.label}`, a: r.amount, p: r.previous, y: r.lastYear })), { l: 'Profit after tax', a: x.profitAndLoss.totals.pat, p: x.profitAndLoss.totals.previous.pat, y: x.profitAndLoss.totals.lastYear.pat }];
      return { contentType: 'application/pdf', fileName: `statements-${q.period}.pdf`, buffer: toPdf({ title: `Financial statements (Schedule III) ${x.from} to ${x.to}`, columns: [{ key: 'l', label: 'Line', type: 'text' }, { key: 'a', label: 'This period' }, { key: 'p', label: 'Previous' }, { key: 'y', label: 'Last year' }], rows, footer: [`Trial balance ₹${x.tieOut.tbDebit} = ₹${x.tieOut.tbCredit}; assets ₹${x.tieOut.assets} = equity and liabilities ₹${x.tieOut.equityLiabilities}. Cash flow net ₹${x.cashFlow.net} (opening ₹${x.cashFlow.openingCash}, closing ₹${x.cashFlow.closingCash}).`] }) }; },
  };

  // ---- FR-04: year end ----
  const yearEnd = {
    /** @param {any} actor @param {{ fyId?: number }} q */
    get(actor, { fyId }) {
      need(actor, 'fin.period.view', 'see the year end'); const fy = fyId ? db.prepare('SELECT * FROM core_financial_years WHERE id = ? AND company_id = ?').get(Number(fyId), actor.companyId) : fyOf(actor.companyId, todayIST()); if (!fy) throw notFound('That financial year does not exist.');
      const periods = repo.periods(fy.id).map((p) => { const st = statusMap(p); const cl = db.prepare("SELECT id, doc_no, status, close_state FROM close_periods WHERE period_id = ? AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(p.id); return { id: p.id, name: p.name, from: p.start_date, to: p.end_date, statuses: st, closed: PERIOD_MODULES.every((m) => st[m] === 'Closed'), close: cl ? { id: cl.id, docNo: cl.doc_no, status: cl.status, state: cl.close_state } : null }; });
      const next = db.prepare('SELECT * FROM core_financial_years WHERE company_id = ? AND start_date > ? ORDER BY start_date LIMIT 1').get(actor.companyId, fy.end_date);
      const cf = db.prepare("SELECT id, voucher_no, doc_no, status FROM fin_journals WHERE company_id = ? AND kind = 'OPENING' AND source_type = 'core_financial_years' AND source_id = ? AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(actor.companyId, String(fy.id));
      const pl = pnl(actor.companyId, fy.start_date, fy.end_date); const allClosed = periods.every((p) => p.closed);
      const steps = [{ code: 'PERIODS', done: allClosed, detail: `${periods.filter((p) => p.closed).length} of ${periods.length} months closed` }, { code: 'NEXT_YEAR', done: Boolean(next), detail: next ? next.code : 'The next financial year is not set up.' }, { code: 'CARRY_FORWARD', done: cf?.status === 'APPROVED', detail: cf ? `${cf.voucher_no ?? cf.doc_no} (${cf.status})` : 'Not made' }, { code: 'CLOSE_YEAR', done: fy.status === 'Closed', detail: fy.status }];
      return { years: db.prepare('SELECT id, code, status FROM core_financial_years WHERE company_id = ? ORDER BY start_date DESC').all(actor.companyId), fy: { id: fy.id, code: fy.code, startDate: fy.start_date, endDate: fy.end_date, status: fy.status }, next: next ? { id: next.id, code: next.code } : null, periods, profit: { pbt: rs(pl.pbt), pat: rs(pl.pat) }, carryForward: cf ? { id: cf.id, ref: cf.voucher_no ?? cf.doc_no, status: cf.status } : null, steps,
        can: { carryForward: allClosed && Boolean(next) && !cf && may(actor, 'fin.period.edit') && may(actor, 'fin.journal.create'), close: allClosed && cf?.status === 'APPROVED' && fy.status !== 'Closed' && may(actor, 'fin.period.approve') } };
    },
    /** The closing entries: the year's profit to retained earnings with the balances carried forward to the next year (a journal approved like any other). */
    carryForward(actor, { fyId }) { need(actor, 'fin.period.edit', 'make the closing entries'); const y = yearEnd.get(actor, { fyId }); if (!y.steps[0].done) throw unprocessable('Close every month of the year first.'); if (!gl?.carryForward) throw unprocessable('The general ledger is not set up.'); const j = gl.carryForward(actor, { fyId: Number(fyId) }); audit(actor, 'core_financial_years', Number(fyId), 'carry_forward', actor.companyId, { newValues: { journal: j?.id } }); return { ...yearEnd.get(actor, { fyId }), journal: j }; },
    close(actor, { fyId }, { reason }) { need(actor, 'fin.period.approve', 'close the financial year'); const y = yearEnd.get(actor, { fyId }); if (!y.can.close) throw unprocessable(y.fy.status === 'Closed' ? 'The year is already closed.' : 'Every month closed and the closing entries approved first.');
      transaction(db, () => { repo.setYearStatus(y.fy.id, 'Closed', actor.user, nowIso()); writeAudit(db, { entity: 'core_financial_years', entityId: y.fy.id, action: 'close', newValues: { status: 'Closed' }, reason, actor: actor.user, companyId: actor.companyId }); publishEvent(db, { type: 'core.financial_year.closed', entity: 'financial_year', entityId: y.fy.id, actorId: actor.user, companyId: actor.companyId, data: { code: y.fy.code } }); evt('fin.year.closed', actor, actor.companyId, 'core_financial_years', y.fy.id, { fyId: y.fy.id, code: y.fy.code, pat: y.profit.pat, carryForwardJournalId: y.carryForward.id }); });
      return yearEnd.get(actor, { fyId }); },
  };

  // ---- FR-05: the dashboard ----
  function ageing(companyId, asOf, kind) {
    const rows = kind === 'AR' ? (has('ar_invoices') ? db.prepare("SELECT due_date AS due, amount_paise - received_paise - credited_paise - written_off_paise AS v FROM ar_invoices WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND invoice_date <= ? AND amount_paise - received_paise - credited_paise - written_off_paise > 0").all(companyId, asOf) : [])
      : (has('ap_bills') ? db.prepare("SELECT COALESCE(msme_due_date, due_date) AS due, net_payable_paise - adjusted_paise - paid_paise AS v FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND net_payable_paise - adjusted_paise - paid_paise > 0").all(companyId) : []);
    const b = { NOT_DUE: 0, D0_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0 }; for (const r of rows) { const d = r.due ? daysBetween(r.due, asOf) : 0; b[d <= 0 ? 'NOT_DUE' : d <= 30 ? 'D0_30' : d <= 60 ? 'D31_60' : d <= 90 ? 'D61_90' : 'D90_PLUS'] += r.v; }
    return { buckets: Object.entries(b).map(([k, v]) => ({ bucket: k, amount: rs(v) })), total: rs(rows.reduce((a, r) => a + r.v, 0)), documents: rows.length };
  }
  /** @param {any} actor @param {{ period?: string }} [q] */
  function dashboard(actor, { period } = {}) {
    need(actor, 'fin.dashboard.view', 'see the finance dashboard'); const c = actor.companyId; const p = period ?? addMonths(todayIST().slice(0, 7), -1); const fy = fyFor(actor, p); const to = monthEnd(p);
    const bs = position(c, to); const m = pnl(c, `${p}-01`, to); const ytd = pnl(c, fy.start_date, to); const days = daysBetween(fy.start_date, to) + 1;
    const direct = (from) => db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise), 0) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id WHERE j.company_id = ? AND ${POSTED} AND j.kind <> 'OPENING' AND j.voucher_date BETWEEN ? AND ? AND g.nature = 'EXPENSE' AND l.project_id IS NOT NULL`).get(c, from, to).v;
    const rev = ytd.lines.PL_REVENUE ?? 0; const dYtd = direct(fy.start_date); const dM = direct(`${p}-01`); const recv = bs.lines.BS_TRADE_RECEIVABLES ?? 0; const pay = bs.lines.BS_TRADE_PAYABLES ?? 0;
    const ca = CURRENT_ASSETS.reduce((s, k) => s + (bs.lines[k] ?? 0), 0); const cl = CURRENT_LIABS.reduce((s, k) => s + (bs.lines[k] ?? 0), 0); const debt = (bs.lines.BS_LT_BORROWINGS ?? 0) + (bs.lines.BS_ST_BORROWINGS ?? 0);
    const trend = []; for (let k = 11; k >= 0; k -= 1) { const q = addMonths(p, -k); if (!fyOf(c, `${q}-01`)) continue; const x = pnl(c, `${q}-01`, monthEnd(q)); trend.push({ month: q, revenue: rs(x.lines.PL_REVENUE ?? 0), ebitda: rs(x.ebitda), pat: rs(x.pat) }); }
    const arAge = ageing(c, to, 'AR'); const apAge = ageing(c, to, 'AP');
    const closesOpen = db.prepare("SELECT p.name, p.end_date FROM core_periods p WHERE p.company_id = ? AND p.fy_id = ? AND p.end_date < ? AND p.is_active = 1 ORDER BY p.period_no").all(c, fy.id, todayIST()).filter((x) => !db.prepare("SELECT 1 FROM close_periods WHERE company_id = ? AND period = ? AND status = 'APPROVED' AND close_state = 'CLOSED' AND deleted_at IS NULL").get(c, x.end_date.slice(0, 7)));
    const overdue = db.prepare("SELECT t.name, t.due_date, t.owner_id, x.id AS close_id, x.period FROM close_tasks t JOIN close_periods x ON x.id = t.close_id WHERE t.company_id = ? AND t.deleted_at IS NULL AND x.deleted_at IS NULL AND x.status IN ('DRAFT', 'RETURNED') AND t.task_status IN ('OPEN', 'IN_PROGRESS') AND t.due_date < ? ORDER BY t.due_date LIMIT 20").all(c, todayIST());
    const mine = db.prepare("SELECT t.name, t.due_date, x.id AS close_id, x.period FROM close_tasks t JOIN close_periods x ON x.id = t.close_id WHERE t.company_id = ? AND t.owner_id = ? AND t.deleted_at IS NULL AND x.status IN ('DRAFT', 'RETURNED') AND t.task_status IN ('OPEN', 'IN_PROGRESS') ORDER BY t.due_date LIMIT 20").all(c, actor.user);
    const exceptions = [...(bs.tb.balanced ? [] : [{ kind: 'TB', text: 'The trial balance does not balance.' }]), ...closesOpen.map((x) => ({ kind: 'CLOSE', text: `${x.name} is not closed.`, link: '/finance/close' })), ...overdue.map((t) => ({ kind: 'TASK', text: `${t.period}: ${t.name} was due ${t.due_date} (${t.owner_id ?? 'no owner'}).`, link: `/finance/close?id=${t.close_id}` })), ...(arAge.total !== rs(recv) ? [{ kind: 'SUBLEDGER', text: `Receivables in the ledger ₹${rs(recv)} differ from the open invoices ₹${arAge.total}.` }] : [])];
    return { period: p, asOf: to, fy: fy.code,
      kpis: { revenue: rs(m.lines.PL_REVENUE ?? 0), revenueYtd: rs(rev), grossMargin: rs(rev - dYtd), grossMarginPct: rev ? Math.round(((rev - dYtd) * 10000) / rev) / 100 : null, grossMarginMonth: rs((m.lines.PL_REVENUE ?? 0) - dM), ebitda: rs(m.ebitda), ebitdaYtd: rs(ytd.ebitda), patYtd: rs(ytd.pat), cash: rs(bs.lines.BS_CASH ?? 0), receivables: rs(recv), payables: rs(pay), workingCapital: rs(ca - cl), currentRatio: cl ? Math.round((ca * 100) / cl) / 100 : null, dso: rev ? Math.round((recv * days) / rev) : null, dpo: dYtd ? Math.round((pay * days) / dYtd) : null, debt: rs(debt), debtEquity: (bs.lines.BS_SHARE_CAPITAL ?? 0) + (bs.lines.BS_OTHER_EQUITY ?? 0) ? Math.round((debt * 100) / ((bs.lines.BS_SHARE_CAPITAL ?? 0) + (bs.lines.BS_OTHER_EQUITY ?? 0))) / 100 : null },
      reconciled: { tbBalanced: bs.tb.balanced, balanceSheetBalances: bs.assets === bs.eqLiab, tbDebit: rs(bs.tb.debit), tbCredit: rs(bs.tb.credit), receivablesLedger: rs(recv), receivablesOpen: arAge.total, payablesLedger: rs(pay), payablesOpen: apAge.total },
      trend, receivablesAgeing: arAge, payablesAgeing: apAge, exceptions, pending: mine.map((t) => ({ text: `${t.period}: ${t.name}`, due: t.due_date, link: `/finance/close?id=${t.close_id}` })) };
  }

  const jobs = {
    /** From the 3rd: companies whose last month has no close started; overdue tasks to their owners. */
    remind() { const today = todayIST(); if (Number(today.slice(8, 10)) < 3) return { reminded: 0 }; const last = addMonths(today.slice(0, 7), -1); let n = 0;
      for (const co of db.prepare('SELECT id FROM org_companies').all()) { if (!on(co.id)) continue; if (!db.prepare('SELECT 1 FROM close_periods WHERE company_id = ? AND period = ? AND deleted_at IS NULL').get(co.id, last)) { n += 1; notify(co.id, 'fin.close.alert', ['permission:fin.period.create'], last, 'close not started', `The close of ${last} is not started.`, '/finance/close', `${co.id}-${last}-start`); }
        for (const t of db.prepare("SELECT t.id, t.name, t.owner_id, t.due_date, x.id AS cid, x.period FROM close_tasks t JOIN close_periods x ON x.id = t.close_id WHERE t.company_id = ? AND t.deleted_at IS NULL AND x.status IN ('DRAFT', 'RETURNED') AND t.task_status IN ('OPEN', 'IN_PROGRESS') AND t.due_date < ? AND t.owner_id IS NOT NULL").all(co.id, today)) { n += 1; notify(co.id, 'fin.close.alert', [`user:${t.owner_id}`], t.period, 'close task overdue', `${t.name} (close of ${t.period}) was due ${t.due_date}.`, `/finance/close?id=${t.cid}`, `${t.id}-${today}`); } }
      return { reminded: n }; },
  };
  return { closes, reopens, statements, yearEnd, dashboard, jobs, position, pnl, checkOf };
}
