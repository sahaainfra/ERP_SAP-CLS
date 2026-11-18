import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.13: cash flow forecast and treasury.
//  FR-01 the lines of the forecast come from their modules (BR-01): open receivables at the date each client pays (its due date plus the client's own average
//  delay), client bills sent and not yet certified, revenue recognised and not billed (23.10), retention held; AP bills due (the MSME date first), open PO / WO
//  commitments (12.03), payroll (the average posted wages and salaries of the last three months until 24.x runs it), statutory dues (TDS, TCS, GST net),
//  loan instalments, department overheads (12.04). A manual adjustment is a line with its reason.
//  FR-02 13 weeks from this Monday, with scenarios (collections delayed, payments brought forward) on the same lines; the cash curve of a project month by
//  month (actual from the ledger, then the forecast, then the rest of the contract spread to its completion).
//  FR-03 actual against forecast week by week (bank and cash movements of the ledger, contras left out).
//  FR-04 treasury: bank-wise balances, what is available and what is blocked (deposits, margin money on guarantees given), OD / CC limits, guarantee limits used
//  (21.02), other facilities.
//  FR-05 payment priority: statutory, MSME, critical suppliers, then the due date; the payment proposals (23.04) rank their bills the same way.
//  Weekly publication: ACCMGR → CFO.

export const CF_DOC = 'FIN_CASH_FORECAST';
export const CATEGORIES = { AR_OPEN: 'Receivables (by client behaviour)', BILLS_PENDING: 'Client bills awaiting certification', UNBILLED: 'Revenue recognised, not billed', RETENTION: 'Retention release', ADVANCE_IN: 'Advances to receive', OTHER_IN: 'Other receipts', AP_DUE: 'Payables due', COMMITMENTS: 'PO / WO commitments', PAYROLL: 'Payroll', STATUTORY: 'Statutory dues', LOAN_EMI: 'Loan instalments', CAPEX: 'Capex', OVERHEADS: 'Overheads', OTHER_OUT: 'Other payments' };
export const INFLOWS = ['AR_OPEN', 'BILLS_PENDING', 'UNBILLED', 'RETENTION', 'ADVANCE_IN', 'OTHER_IN'];
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
/** The Monday of the week of a date. */
export const weekOf = (d) => { const x = new Date(`${d}T00:00:00Z`); const wd = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - wd); return x.toISOString().slice(0, 10); };
/**
 * The weeks of a forecast from its lines (FR-02): inflow, outflow, net and the running balance from the opening; a scenario shifts the collections later or the
 * payments earlier by `shift` weeks (never before the first week).
 */
export function weekly(lines, { weekStart, weeks, opening, scenario = 'BASE', shift = 2 }) {
  const idx = (w) => Math.round(daysBetween(weekStart, w) / 7); const rows = Array.from({ length: weeks }, (_, k) => (/** @type {{ week: string, inflow: number, outflow: number, net: number, opening: number, closing: number, byCategory: Record<string, number> }} */ ({ week: addDays(weekStart, 7 * k), inflow: 0, outflow: 0, net: 0, opening: 0, closing: 0, byCategory: {} })));
  for (const l of lines) {
    let k = Math.max(0, idx(l.week_start)); const delayed = INFLOWS.includes(l.category) && ['DELAYED_COLLECTIONS', 'BOTH'].includes(scenario); const early = ['AP_DUE', 'COMMITMENTS'].includes(l.category) && ['ACCELERATED_PAYMENTS', 'BOTH'].includes(scenario);
    if (delayed) k += shift; if (early) k = Math.max(0, k - shift); if (k >= weeks) continue;
    rows[k].inflow += l.inflow_paise; rows[k].outflow += l.outflow_paise; rows[k].byCategory[l.category] = (rows[k].byCategory[l.category] ?? 0) + l.inflow_paise - l.outflow_paise;
  }
  let bal = opening; let lowest = opening; let lowWeek = weekStart; for (const r of rows) { r.net = r.inflow - r.outflow; r.opening = bal; bal += r.net; r.closing = bal; if (bal < lowest) { lowest = bal; lowWeek = r.week; } }
  return { rows, closing: bal, lowest, lowWeek, inflow: rows.reduce((a, r) => a + r.inflow, 0), outflow: rows.reduce((a, r) => a + r.outflow, 0) };
}

export const cfList = defineList({
  code: 'fin.cash_forecasts', label: 'Cash forecasts', permission: 'fin.cash_forecast.view', from: 'cf_forecasts x', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no'], defaultSort: '-weekStart',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Forecast' }, weekStart: { sql: 'x.week_start', type: 'date', label: 'From week' }, versionNo: { sql: 'x.version_no', type: 'number', label: 'Version' }, opening: { sql: '(x.opening_paise / 100.0)', type: 'money', label: 'Opening' }, inflow: { sql: '(x.inflow_paise / 100.0)', type: 'money', label: 'Inflow' }, outflow: { sql: '(x.outflow_paise / 100.0)', type: 'money', label: 'Outflow' }, closing: { sql: '(x.closing_paise / 100.0)', type: 'money', label: 'Closing' }, lowest: { sql: '(x.lowest_paise / 100.0)', type: 'money', label: 'Lowest' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) } },
});

/** @param {{ db: any, base: any, flags: any }} o */
export function createCashForecastService({ db, base, flags }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2313');
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };
  const projOf = (id) => db.prepare('SELECT id, company_id, code, name FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(Number(id)) ?? null;
  const POSTED = "j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL";
  const acctBal = (companyId, codes, to, projectId = null) => db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise), 0) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date <= ? AND a.code IN (${codes.map(() => '?').join(',')})${projectId ? ' AND l.project_id = ?' : ''}`).get(companyId, to, ...codes, ...(projectId ? [projectId] : [])).v;
  /** The bank and cash accounts of the ledger and the kind of each bank (deposit and escrow are not cash at hand). */
  const cashAccounts = (companyId) => { const banks = has('fin_bank_accounts') ? db.prepare('SELECT b.id, b.name, b.bank_name, b.account_last4, b.gl_account_id, p.account_kind, p.od_limit_paise FROM fin_bank_accounts b LEFT JOIN fin_bank_account_profiles p ON p.bank_account_id = b.id AND p.deleted_at IS NULL WHERE b.company_id = ? AND b.deleted_at IS NULL ORDER BY b.code').all(companyId) : []; const cash = db.prepare("SELECT id FROM fin_accounts WHERE company_id = ? AND account_type = 'CASH' AND deleted_at IS NULL").all(companyId).map((r) => r.id); return { banks, cash }; };
  const glBalById = (companyId, accountId, to) => db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise), 0) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date <= ? AND l.account_id = ?`).get(companyId, to, accountId).v;
  /** Cash at hand today: the current, CC and OD accounts and the cash accounts (deposits and escrow are blocked). */
  const openingOf = (companyId, date) => { const { banks, cash } = cashAccounts(companyId); return banks.filter((b) => !['DEPOSIT', 'ESCROW'].includes(b.account_kind ?? 'CURRENT')).reduce((a, b) => a + glBalById(companyId, b.gl_account_id, date), 0) + cash.reduce((a, id) => a + glBalById(companyId, id, date), 0); };

  // ---- FR-01: the lines from the source modules ----
  function sourceLines(companyId, weekStart, weeks) {
    // the lines start in the first week; balances (statutory dues, retention held) are taken as of today
    const end = addDays(weekStart, 7 * weeks - 1); const today = weekStart; const now = todayIST() > weekStart ? todayIST() : weekStart; const L = []; const used = [];
    const add = (o) => { if ((o.inflow ?? 0) + (o.outflow ?? 0) <= 0) return; const d = o.date < today ? today : o.date; if (d > end) return; L.push({ category: o.category, week_start: weekOf(d), due_date: o.date, org_project_id: o.projectId ?? null, inflow_paise: Math.max(0, Math.round(o.inflow ?? 0)), outflow_paise: Math.max(0, Math.round(o.outflow ?? 0)), source_doc: o.doc ?? null, counterparty: o.party ?? null, confidence: o.confidence ?? 'MEDIUM' }); };
    const note = (code, available, n, text) => used.push({ code, label: CATEGORIES[code], available, lines: n, note: text });
    const count = (c) => L.filter((l) => l.category === c).length;
    if (has('ar_invoices')) {
      // collection behaviour: the average days after the due date each client paid its settled invoices
      const delay = new Map(has('ar_allocations') ? db.prepare("SELECT i.partner_id AS p, AVG(MAX(0, julianday(r.receipt_date) - julianday(i.due_date))) AS d FROM ar_allocations a JOIN ar_invoices i ON i.id = a.invoice_id JOIN ar_receipts r ON r.id = a.receipt_id WHERE i.company_id = ? AND a.deleted_at IS NULL AND r.status = 'APPROVED' GROUP BY i.partner_id").all(companyId).map((r) => [r.p, Math.round(r.d ?? 0)]) : []);
      for (const i of db.prepare("SELECT i.*, m.legal_name FROM ar_invoices i LEFT JOIN mdm_partners m ON m.id = i.partner_id WHERE i.company_id = ? AND i.status = 'APPROVED' AND i.deleted_at IS NULL AND i.amount_paise - i.received_paise - i.credited_paise - i.written_off_paise > 0").all(companyId)) {
        const late = delay.get(i.partner_id) ?? 0; const exp = addDays(i.due_date, late); const age = daysBetween(i.due_date, now);
        add({ category: 'AR_OPEN', date: exp, projectId: i.org_project_id, inflow: i.amount_paise - i.received_paise - i.credited_paise - i.written_off_paise, doc: i.invoice_no ?? i.doc_no, party: i.legal_name, confidence: age > 90 ? 'LOW' : age > 0 ? 'MEDIUM' : 'HIGH' });
      }
      note('AR_OPEN', true, count('AR_OPEN'), 'open receivables at the due date plus the client\'s average delay');
    } else note('AR_OPEN', false, 0, 'receivables (23.05) not set up');
    if (has('bill_client_bills')) {
      const days = 45; for (const b of db.prepare("SELECT b.* FROM bill_client_bills b WHERE b.company_id = ? AND b.status = 'APPROVED' AND b.client_state = 'SENT' AND b.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM bill_certifications c WHERE c.bill_id = b.id AND c.status = 'APPROVED' AND c.deleted_at IS NULL)").all(companyId)) add({ category: 'BILLS_PENDING', date: addDays(b.sent_on ?? b.period_to, days), projectId: b.org_project_id, inflow: b.net_paise, doc: b.bill_no ?? b.doc_no, confidence: 'MEDIUM' });
      note('BILLS_PENDING', true, count('BILLS_PENDING'), `client bills sent and not certified, ${days} days after they were sent`);
    } else note('BILLS_PENDING', false, 0, 'client bills (22.03) not set up');
    if (has('pa_revenue_recognition')) {
      for (const r of db.prepare("SELECT x.* FROM pa_revenue_recognition x WHERE x.company_id = ? AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.unbilled_paise > 0 AND x.period = (SELECT MAX(y.period) FROM pa_revenue_recognition y WHERE y.org_project_id = x.org_project_id AND y.status = 'APPROVED' AND y.deleted_at IS NULL)").all(companyId)) add({ category: 'UNBILLED', date: addDays(monthEnd(addMonths(r.period, 1)), 30), projectId: r.org_project_id, inflow: r.unbilled_paise, doc: r.doc_no, confidence: 'LOW' });
      note('UNBILLED', true, count('UNBILLED'), 'unbilled revenue of the last recognition, billed next month and collected 30 days later');
    } else note('UNBILLED', false, 0, 'revenue recognition (23.10) not set up');
    if (has('ctr_contracts')) {
      for (const k of db.prepare("SELECT k.org_project_id, k.contract_no, COALESCE(k.revised_completion, k.completion_date) AS done, k.dlp_months FROM ctr_contracts k WHERE k.company_id = ? AND k.status = 'APPROVED' AND k.deleted_at IS NULL AND COALESCE(k.revised_completion, k.completion_date) IS NOT NULL").all(companyId)) {
        const held = acctBal(companyId, ['140002'], now, k.org_project_id); if (held <= 0) continue; const [y, m] = k.done.slice(0, 7).split('-').map(Number); const rel = `${addMonths(`${y}-${String(m).padStart(2, '0')}`, k.dlp_months ?? 0)}-${k.done.slice(8, 10)}`;
        add({ category: 'RETENTION', date: rel, projectId: k.org_project_id, inflow: held, doc: k.contract_no, confidence: 'LOW' });
      }
      note('RETENTION', true, count('RETENTION'), 'retention held, released after completion and the defects liability period');
    }
    if (has('ap_bills')) {
      for (const b of db.prepare("SELECT * FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND net_payable_paise - adjusted_paise - paid_paise > 0").all(companyId)) add({ category: 'AP_DUE', date: b.msme && b.msme_due_date ? b.msme_due_date : b.due_date, projectId: b.org_project_id, outflow: b.net_payable_paise - b.adjusted_paise - b.paid_paise, doc: b.bill_no ?? b.doc_no, party: b.payee_name, confidence: 'HIGH' });
      note('AP_DUE', true, count('AP_DUE'), 'approved payables at the MSME date, else the due date');
    }
    if (has('bud_commitments')) {
      // an open commitment is billed and paid over the coming weeks: half within four weeks, the rest within eight
      for (const c of db.prepare("SELECT org_project_id, doc_ref, SUM(amount - consumed_amount - released_amount) AS open FROM bud_commitments WHERE company_id = ? AND status IN ('OPEN', 'PARTIAL') AND deleted_at IS NULL GROUP BY org_project_id, doc_ref HAVING open > 0").all(companyId)) { const h = Math.round(c.open / 2); add({ category: 'COMMITMENTS', date: addDays(today, 28), projectId: c.org_project_id, outflow: h, doc: c.doc_ref, confidence: 'MEDIUM' }); add({ category: 'COMMITMENTS', date: addDays(today, 56), projectId: c.org_project_id, outflow: c.open - h, doc: c.doc_ref, confidence: 'LOW' }); }
      note('COMMITMENTS', true, count('COMMITMENTS'), 'open PO / WO commitments (12.03), half in four weeks and half in eight');
    }
    {
      // payroll: until 24.x runs payroll, the average posted salaries and wages of the last three months, paid on the last day of each month
      const from = addMonths(today.slice(0, 7), -3); const avg = Math.round(db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise), 0) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id WHERE j.company_id = ? AND ${POSTED} AND g.code = '5300' AND j.voucher_date BETWEEN ? AND ?`).get(companyId, `${from}-01`, monthEnd(addMonths(today.slice(0, 7), -1))).v / 3);
      for (let k = 0; k <= Math.ceil(weeks / 4) + 1; k += 1) add({ category: 'PAYROLL', date: monthEnd(addMonths(today.slice(0, 7), k)), outflow: avg, doc: 'average of the last three months', confidence: 'MEDIUM' });
      note('PAYROLL', true, count('PAYROLL'), 'average posted salaries and wages of the last three months (payroll 24.x not yet live)');
    }
    {
      const nextDay = (day) => { const d = `${addMonths(today.slice(0, 7), 1)}-${String(day).padStart(2, '0')}`; return d; };
      const tds = -acctBal(companyId, ['230004', '230007'], now); if (tds > 0) add({ category: 'STATUTORY', date: nextDay(7), outflow: tds, doc: 'TDS / TCS payable', party: 'Income-tax department', confidence: 'HIGH' });
      const gst = -acctBal(companyId, ['230001', '230002', '230003'], now) - acctBal(companyId, ['170001', '170002', '170003'], now); if (gst > 0) add({ category: 'STATUTORY', date: nextDay(20), outflow: gst, doc: 'GST net payable (estimate)', party: 'GST', confidence: 'MEDIUM' });
      note('STATUTORY', true, count('STATUTORY'), 'TDS and TCS payable by the 7th; GST output less input by the 20th');
    }
    if (has('cf_bank_limits')) {
      for (const f of db.prepare("SELECT * FROM cf_bank_limits WHERE company_id = ? AND limit_type = 'TERM_LOAN' AND limit_status = 'ACTIVE' AND emi_paise > 0 AND emi_day IS NOT NULL AND deleted_at IS NULL").all(companyId)) for (let k = 0; k <= Math.ceil(weeks / 4) + 1; k += 1) { const d = `${addMonths(today.slice(0, 7), k)}-${String(f.emi_day).padStart(2, '0')}`; if (d >= today && (!f.end_date || d <= f.end_date)) add({ category: 'LOAN_EMI', date: d, outflow: f.emi_paise, doc: f.bank_name, party: f.bank_name, confidence: 'HIGH' }); }
      note('LOAN_EMI', true, count('LOAN_EMI'), 'instalments of the term loans entered in the treasury');
    }
    if (has('bud_dept_lines')) {
      for (const r of db.prepare("SELECT p.end_date, SUM(l.amount) AS a FROM bud_dept_lines l JOIN bud_dept_budgets b ON b.id = l.budget_id JOIN core_periods p ON p.id = l.period_id WHERE b.company_id = ? AND b.status = 'APPROVED' AND b.deleted_at IS NULL AND l.deleted_at IS NULL AND p.end_date BETWEEN ? AND ? GROUP BY p.end_date").all(companyId, today, addDays(end, 31))) add({ category: 'OVERHEADS', date: r.end_date, outflow: r.a, doc: 'department budgets (12.04)', confidence: 'MEDIUM' });
      note('OVERHEADS', true, count('OVERHEADS'), 'approved department budgets of the months, paid at month end');
    }
    note('CAPEX', true, 0, 'capital purchases are in the PO commitments and payables');
    return { lines: L, sources: used };
  }

  // ---- the forecast (approval-controlled) ----
  const linesOf = (id) => db.prepare('SELECT * FROM cf_lines WHERE forecast_id = ? AND deleted_at IS NULL ORDER BY week_start, category, id').all(id);
  function recompute(f, keepManual = true) {
    const manual = keepManual ? linesOf(f.id).filter((l) => l.source === 'MANUAL') : []; db.prepare("UPDATE cf_lines SET deleted_at = ? WHERE forecast_id = ? AND source = 'SOURCE' AND deleted_at IS NULL").run(nowIso(), f.id);
    const { lines, sources } = sourceLines(f.company_id, f.week_start, f.weeks); const ins = db.prepare("INSERT INTO cf_lines (company_id, forecast_id, org_project_id, category, week_start, due_date, inflow_paise, outflow_paise, source, source_doc, counterparty, confidence, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SOURCE', ?, ?, ?, 'system', 'cf_sources')");
    for (const l of lines) ins.run(f.company_id, f.id, l.org_project_id, l.category, l.week_start, l.due_date, l.inflow_paise, l.outflow_paise, l.source_doc, l.counterparty, l.confidence);
    const opening = openingOf(f.company_id, f.week_start); const w = weekly([...lines, ...manual], { weekStart: f.week_start, weeks: f.weeks, opening });
    db.prepare('UPDATE cf_forecasts SET opening_paise = ?, inflow_paise = ?, outflow_paise = ?, closing_paise = ?, lowest_paise = ?, lowest_week = ?, sources_json = ? WHERE id = ?').run(opening, w.inflow, w.outflow, w.closing, w.lowest, w.lowWeek, JSON.stringify(sources), f.id);
    return db.prepare('SELECT * FROM cf_forecasts WHERE id = ?').get(f.id);
  }
  const totals = (f) => { const w = weekly(linesOf(f.id), { weekStart: f.week_start, weeks: f.weeks, opening: f.opening_paise }); db.prepare('UPDATE cf_forecasts SET inflow_paise = ?, outflow_paise = ?, closing_paise = ?, lowest_paise = ?, lowest_week = ? WHERE id = ?').run(w.inflow, w.outflow, w.closing, w.lowest, w.lowWeek, f.id); };
  const flow = createFlow({ db, base, docType: CF_DOC, table: 'cf_forecasts', perm: 'fin.cash_forecast', label: 'cash forecast', route: '/finance/treasury?forecast=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.closing_paise), lowest: rs(r.lowest_paise), makerRole: rolesOf(r.company_id, r.requested_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER' }), title: (r) => `Cash forecast ${r.week_start} (${r.weeks} weeks): closing ₹${rs(r.closing_paise)}, lowest ₹${rs(r.lowest_paise)}`, notifyCode: 'fin.cf.decided', prefix: 'CF',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('Cash forecasting is off for the company (ff.fin.p2313).'); totals(r); },
    onApproved: (actor, r) => { const x = db.prepare('SELECT * FROM cf_forecasts WHERE id = ?').get(r.id); db.prepare("UPDATE cf_forecasts SET status = 'SUPERSEDED', updated_at = ? WHERE company_id = ? AND status = 'APPROVED' AND id <> ? AND week_start <= ?").run(nowIso(), x.company_id, x.id, x.week_start);
      evt('fin.cash_forecast.published', actor, x.company_id, 'cf_forecasts', x.id, { forecastId: x.id, docNo: x.doc_no, weekStart: x.week_start, weeks: x.weeks, opening: rs(x.opening_paise), inflow: rs(x.inflow_paise), outflow: rs(x.outflow_paise), closing: rs(x.closing_paise), lowest: rs(x.lowest_paise), lowestWeek: x.lowest_week });
      if (x.lowest_paise < 0) notify(x.company_id, 'fin.cf.alert', ['permission:fin.cash_forecast.approve'], x.doc_no, 'cash short', `The published cash forecast goes below zero in the week of ${x.lowest_week} (₹${rs(x.lowest_paise)}).`, `/finance/treasury?forecast=${x.id}`, `${x.id}-low`); },
  });
  const lineView = (l) => ({ id: l.id, projectId: l.org_project_id, project: l.org_project_id ? projOf(l.org_project_id)?.code ?? null : null, category: l.category, categoryLabel: CATEGORIES[l.category], week: l.week_start, dueDate: l.due_date, inflow: rs(l.inflow_paise), outflow: rs(l.outflow_paise), source: l.source, sourceDoc: l.source_doc, counterparty: l.counterparty, confidence: l.confidence, reason: l.reason });
  const view = (actor, r, detail = false, scenario = 'BASE', shift = 2) => {
    const o = { id: r.id, docNo: r.doc_no, versionNo: r.version_no, weekStart: r.week_start, weeks: r.weeks, opening: rs(r.opening_paise), inflow: rs(r.inflow_paise), outflow: rs(r.outflow_paise), closing: rs(r.closing_paise), lowest: rs(r.lowest_paise), lowestWeek: r.lowest_week, commentary: r.commentary, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version,
      can: { ...flow.can(actor, r), adjust: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'fin.cash_forecast.edit') } };
    if (detail) { const lines = linesOf(r.id); const w = weekly(lines, { weekStart: r.week_start, weeks: r.weeks, opening: r.opening_paise, scenario, shift }); Object.assign(o.can, flow.approveInfo(actor, r)); o.scenario = { code: scenario, shift, closing: rs(w.closing), lowest: rs(w.lowest), lowestWeek: w.lowWeek };
      o.weeksTable = w.rows.map((x) => ({ week: x.week, opening: rs(x.opening), inflow: rs(x.inflow), outflow: rs(x.outflow), net: rs(x.net), closing: rs(x.closing), byCategory: Object.fromEntries(Object.entries(x.byCategory).map(([k, v]) => [k, rs(v)])) }));
      o.lines = lines.map(lineView); try { o.sources = JSON.parse(r.sources_json); } catch { o.sources = []; } o.history = flow.history(actor, r.id); }
    return o;
  };
  const editable = (actor, id) => { const r = flow.row(actor, id, 'fin.cash_forecast.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned forecast is changed.'); return r; };
  const forecasts = {
    flow,
    list(actor, query) { need(actor, 'fin.cash_forecast.view', 'see cash forecasts'); return runList(db, cfList, parseListRequest(cfList, query), { select: 'x.*', scopeSql: 'x.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id, q = {}) { return view(actor, flow.row(actor, id), true, q.scenario ?? 'BASE', Number(q.shift ?? 2)); },
    /** FR-01, FR-02: the forecast of the 13 weeks from this Monday, from the source modules. */
    create(actor, b = {}) {
      need(actor, 'fin.cash_forecast.create', 'prepare cash forecasts'); const c = actor.companyId; const ws = weekOf(b.weekStart ?? todayIST()); const weeks = b.weeks ?? 13;
      if (ws < weekOf(todayIST())) throw badRequest('Correct the highlighted fields', [{ field: 'weekStart', message: 'A forecast starts this week or later.' }]);
      const version = (db.prepare('SELECT MAX(version_no) AS v FROM cf_forecasts WHERE company_id = ? AND week_start = ?').get(c, ws).v ?? 0) + 1;
      return transaction(db, () => { let id; try { id = Number(db.prepare("INSERT INTO cf_forecasts (company_id, doc_no, version_no, week_start, weeks, commentary, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, flow.next(actor), version, ws, weeks, b.commentary ?? null, actor.user, actor.user).lastInsertRowid); } catch (e) { if (/UNIQUE/.test(String(e.message))) throw conflict('A forecast of this week is already open.'); throw e; }
        const x = recompute(db.prepare('SELECT * FROM cf_forecasts WHERE id = ?').get(id)); audit(actor, 'cf_forecasts', id, 'create', c, { newValues: { weekStart: ws, weeks, closing: rs(x.closing_paise) } }); return forecasts.get(actor, id); });
    },
    refresh(actor, id) { const r = editable(actor, id); recompute(r); audit(actor, 'cf_forecasts', r.id, 'refresh', r.company_id); return forecasts.get(actor, r.id); },
    /** BR-01: a manual adjustment is a line with its reason. */
    adjust(actor, id, b) {
      const r = editable(actor, id); if (!(b.reason ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'reason', message: 'Say why the forecast is adjusted.' }]);
      const inflow = INFLOWS.includes(b.category); const amt = paise(b.amount); if (!(amt > 0)) throw badRequest('Correct the highlighted fields', [{ field: 'amount', message: 'Give the amount.' }]);
      const wk = weekOf(b.date); if (wk < r.week_start || wk > addDays(r.week_start, 7 * (r.weeks - 1))) throw badRequest('Correct the highlighted fields', [{ field: 'date', message: 'The date is outside the weeks of the forecast.' }]);
      if (b.projectId) { const p = projOf(b.projectId); if (!p || p.company_id !== r.company_id) throw badRequest('Correct the highlighted fields', [{ field: 'projectId', message: 'Not a project of the company.' }]); }
      const lid = Number(db.prepare("INSERT INTO cf_lines (company_id, forecast_id, org_project_id, category, week_start, due_date, inflow_paise, outflow_paise, source, source_doc, counterparty, confidence, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, 'cf_adjustment')").run(r.company_id, r.id, b.projectId ?? null, b.category, wk, b.date, inflow ? amt : 0, inflow ? 0 : amt, b.reference ?? null, b.counterparty ?? null, b.confidence ?? 'MEDIUM', b.reason, actor.user).lastInsertRowid);
      totals(r); audit(actor, 'cf_lines', lid, 'create', r.company_id, { reason: b.reason, newValues: { category: b.category, amount: rs(amt), date: b.date } }); return forecasts.get(actor, r.id);
    },
    removeAdjustment(actor, id, lineId, { reason }) { const r = editable(actor, id); const l = db.prepare("SELECT * FROM cf_lines WHERE id = ? AND forecast_id = ? AND source = 'MANUAL' AND deleted_at IS NULL").get(Number(lineId), r.id); if (!l) throw notFound('Only an adjustment entered by hand is removed.'); db.prepare('UPDATE cf_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, l.id); totals(r); audit(actor, 'cf_lines', l.id, 'delete', r.company_id, { reason }); return forecasts.get(actor, r.id); },
    update(actor, id, b) { const r = editable(actor, id); db.prepare('UPDATE cf_forecasts SET commentary = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.commentary ?? null, actor.user, nowIso(), r.id); audit(actor, 'cf_forecasts', r.id, 'update', r.company_id); return forecasts.get(actor, r.id); },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return forecasts.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return forecasts.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return forecasts.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    print(actor, id, q = {}) { const r = flow.row(actor, id, 'fin.cash_forecast.print'); const v = forecasts.get(actor, id, q); audit(actor, 'cf_forecasts', r.id, 'print', r.company_id); const m = (x) => (x ?? 0).toFixed(2);
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Cash forecast ${r.doc_no} · ${r.week_start} · ${v.weeks} weeks (${v.scenario.code})`, columns: [{ key: 'w', label: 'Week', type: 'text' }, { key: 'o', label: 'Opening' }, { key: 'i', label: 'Inflow' }, { key: 'u', label: 'Outflow' }, { key: 'c', label: 'Closing' }], rows: v.weeksTable.map((x) => ({ w: x.week, o: m(x.opening), i: m(x.inflow), u: m(x.outflow), c: m(x.closing) })), footer: [`Lowest ${m(v.scenario.lowest)} in the week of ${v.scenario.lowestWeek}. ${v.commentary ?? ''}`] }) }; },
    exportCsv(actor, id) { const r = flow.row(actor, id, 'fin.cash_forecast.export'); audit(actor, 'cf_forecasts', r.id, 'export', r.company_id); return { contentType: 'text/csv; charset=utf-8', fileName: `${r.doc_no.replaceAll('/', '-')}-lines.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Week', 'Due', 'Category', 'Project', 'Inflow', 'Outflow', 'Source', 'Document', 'Party', 'Confidence', 'Reason'], linesOf(r.id).map((l) => { const x = lineView(l); return [x.week, x.dueDate ?? '', x.categoryLabel, x.project ?? '', x.inflow, x.outflow, x.source, x.sourceDoc ?? '', x.counterparty ?? '', x.confidence, x.reason ?? '']; }))}`, 'utf8') }; },
  };

  // ---- FR-03: actual against forecast ----
  /** Bank and cash movements of a week from the ledger: in and out of the cash accounts, journals moving only between them (contras) left out. */
  function actualWeek(companyId, weekStart) {
    const { banks, cash } = cashAccounts(companyId); const ids = [...banks.map((b) => b.gl_account_id), ...cash]; if (!ids.length) return { inflow: 0, outflow: 0 };
    const rows = db.prepare(`SELECT l.journal_id, SUM(CASE WHEN l.account_id IN (${ids.join(',')}) THEN l.debit_paise - l.credit_paise ELSE 0 END) AS cashNet, SUM(CASE WHEN l.account_id IN (${ids.join(',')}) THEN 0 ELSE 1 END) AS others FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? GROUP BY l.journal_id`).all(companyId, weekStart, addDays(weekStart, 6));
    return rows.filter((r) => r.others > 0).reduce((a, r) => (r.cashNet > 0 ? { ...a, inflow: a.inflow + r.cashNet } : { ...a, outflow: a.outflow - r.cashNet }), { inflow: 0, outflow: 0 });
  }
  function variance(actor, { forecastId }) {
    const r = forecastId ? flow.row(actor, forecastId) : db.prepare("SELECT * FROM cf_forecasts WHERE company_id = ? AND status IN ('APPROVED', 'SUPERSEDED') AND deleted_at IS NULL ORDER BY week_start DESC, version_no DESC LIMIT 1").get(actor.companyId); need(actor, 'fin.cash_forecast.view', 'see cash forecasts'); if (!r) return { forecast: null, rows: [] };
    const w = weekly(linesOf(r.id), { weekStart: r.week_start, weeks: r.weeks, opening: r.opening_paise }); const today = todayIST();
    const rows = w.rows.filter((x) => x.week <= weekOf(today)).map((x) => { const a = actualWeek(r.company_id, x.week); return { week: x.week, forecastIn: rs(x.inflow), actualIn: rs(a.inflow), varianceIn: rs(a.inflow - x.inflow), forecastOut: rs(x.outflow), actualOut: rs(a.outflow), varianceOut: rs(a.outflow - x.outflow), forecastNet: rs(x.net), actualNet: rs(a.inflow - a.outflow), varianceNet: rs(a.inflow - a.outflow - x.net), complete: addDays(x.week, 6) < today }; });
    return { forecast: { id: r.id, docNo: r.doc_no, weekStart: r.week_start, status: r.status }, rows };
  }

  // ---- FR-02: the cash curve of a project ----
  function projectCurve(actor, { projectId }) {
    const p = projOf(projectId); if (!p || p.company_id !== actor.companyId) throw notFound('That project does not exist.'); if (!may(actor, 'fin.cash_forecast.view') && !may(actor, 'fin.cash_curve.view', p.id)) throw forbidden('You may not see the cash curve of this project (permission fin.cash_curve.view).'); const c = actor.companyId; const today = todayIST(); const cur = today.slice(0, 7);
    const act = db.prepare(`SELECT substr(j.voucher_date, 1, 7) AS m, SUM(CASE WHEN a.code IN ('140001', '140002') THEN l.credit_paise ELSE 0 END) AS cin, SUM(CASE WHEN a.code IN ('220001', '220002') THEN l.debit_paise ELSE 0 END) AS cout FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = ? AND l.project_id = ? AND ${POSTED} AND a.code IN ('140001', '140002', '220001', '220002') AND j.voucher_date <= ? GROUP BY m ORDER BY m`).all(c, p.id, today);
    const months = new Map(act.map((r) => [r.m, { month: r.m, actualIn: r.cin, actualOut: r.cout, forecastIn: 0, forecastOut: 0 }])); const get = (m) => { if (!months.has(m)) months.set(m, { month: m, actualIn: 0, actualOut: 0, forecastIn: 0, forecastOut: 0 }); return months.get(m); };
    const f = db.prepare("SELECT * FROM cf_forecasts WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY week_start DESC, version_no DESC LIMIT 1").get(c); let horizon = cur;
    if (f) { for (const l of db.prepare('SELECT * FROM cf_lines WHERE forecast_id = ? AND org_project_id = ? AND deleted_at IS NULL').all(f.id, p.id)) { const g = get(l.week_start.slice(0, 7)); g.forecastIn += l.inflow_paise; g.forecastOut += l.outflow_paise; } horizon = addDays(f.week_start, 7 * f.weeks).slice(0, 7); }
    // beyond the horizon: the contract revenue not yet billed and the EAC not yet spent, spread evenly to the contract's completion
    const k = has('ctr_contracts') ? db.prepare("SELECT SUM(CASE WHEN revised_paise > 0 THEN revised_paise ELSE original_paise + amended_paise + variation_paise END) AS rev, MAX(COALESCE(revised_completion, completion_date)) AS done FROM ctr_contracts WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(p.id) : null;
    const eac = has('fc_forecasts') ? db.prepare("SELECT eac_total_paise FROM fc_forecasts WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period DESC, version_no DESC LIMIT 1").get(p.id)?.eac_total_paise : null;
    if (k?.done && k.done.slice(0, 7) > horizon) {
      const billed = -acctBal(c, ['410001'], today, p.id) || 0; const spent = db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise), 0) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id WHERE j.company_id = ? AND l.project_id = ? AND ${POSTED} AND g.code LIKE '5%'`).get(c, p.id).v;
      const n = Math.max(1, Math.round(daysBetween(`${horizon}-01`, `${k.done.slice(0, 7)}-01`) / 30)); const restIn = Math.max(0, (k.rev ?? 0) - billed); const restOut = Math.max(0, (eac ?? 0) - spent);
      for (let i = 1; i <= n; i += 1) { const g = get(addMonths(horizon, i)); g.forecastIn += Math.round(restIn / n); g.forecastOut += Math.round(restOut / n); }
    }
    let cum = 0; const rows = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => { const net = r.month <= cur ? r.actualIn - r.actualOut : r.forecastIn - r.forecastOut; cum += net; return { month: r.month, actualIn: rs(r.actualIn), actualOut: rs(r.actualOut), forecastIn: rs(r.forecastIn), forecastOut: rs(r.forecastOut), net: rs(net), cumulative: rs(cum), actual: r.month <= cur }; });
    return { projectId: p.id, project: `${p.code} ${p.name}`, completion: k?.done ?? null, contractRevenue: rs(k?.rev ?? 0), eac: eac != null ? rs(eac) : null, rows, peakNeed: rs(Math.min(0, ...rows.map((r) => Math.round(r.cumulative * 100)))) };
  }

  // ---- FR-04: treasury ----
  function treasury(actor) {
    need(actor, 'fin.cash_forecast.view', 'see the treasury position'); const c = actor.companyId; const today = todayIST(); const { banks, cash } = cashAccounts(c);
    const bankRows = banks.map((b) => { const bal = glBalById(c, b.gl_account_id, today); const kind = b.account_kind ?? 'CURRENT'; const od = b.od_limit_paise ?? 0; return { id: b.id, name: b.name, bank: b.bank_name, account: `••••${b.account_last4}`, kind, balance: rs(bal), odLimit: rs(od), available: ['DEPOSIT', 'ESCROW'].includes(kind) ? 0 : rs(bal + od), blocked: ['DEPOSIT', 'ESCROW'].includes(kind) ? rs(Math.max(0, bal)) : 0, odUsed: ['CASH_CREDIT', 'OVERDRAFT'].includes(kind) ? rs(Math.max(0, -bal)) : 0 }; });
    const cashOnHand = cash.reduce((a, id) => a + glBalById(c, id, today), 0);
    const bgs = has('ctr_bank_guarantees') ? db.prepare("SELECT bank_name, SUM(current_paise) AS amt, SUM(current_paise * margin_bp / 10000) AS margin, COUNT(*) AS n FROM ctr_bank_guarantees WHERE company_id = ? AND direction = 'GIVEN' AND status = 'APPROVED' AND released_on IS NULL AND expiry_date >= ? AND deleted_at IS NULL GROUP BY bank_name").all(c, today) : [];
    const limits = has('ctr_bank_limits') ? db.prepare("SELECT * FROM ctr_bank_limits WHERE company_id = ? AND limit_status = 'ACTIVE' AND deleted_at IS NULL").all(c) : [];
    const bgLimits = limits.filter((l) => l.limit_kind === 'BG').map((l) => { const u = bgs.find((b) => b.bank_name === l.bank_name); return { bank: l.bank_name, limit: rs(l.limit_paise), used: rs(u?.amt ?? 0), free: rs(l.limit_paise - (u?.amt ?? 0)), usedPct: Math.round(((u?.amt ?? 0) * 10000) / l.limit_paise) / 100, guarantees: u?.n ?? 0, validTo: l.valid_to }; });
    const facilities = has('cf_bank_limits') ? db.prepare("SELECT * FROM cf_bank_limits WHERE company_id = ? AND deleted_at IS NULL ORDER BY limit_status, bank_name").all(c).map((f) => ({ id: f.id, bank: f.bank_name, type: f.limit_type, limit: rs(f.limit_paise), utilised: rs(f.utilised_paise), free: rs(f.limit_paise - f.utilised_paise), emi: rs(f.emi_paise), emiDay: f.emi_day, endDate: f.end_date, status: f.limit_status, version: f.version })) : [];
    const margin = bgs.reduce((a, b) => a + Math.round(b.margin ?? 0), 0); const s = (k) => Math.round(bankRows.reduce((a, b) => a + Math.round((b[k] ?? 0) * 100), 0));
    const latest = db.prepare("SELECT * FROM cf_forecasts WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY week_start DESC, version_no DESC LIMIT 1").get(c); const open = db.prepare("SELECT * FROM cf_forecasts WHERE company_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(c);
    return { date: today, banks: bankRows, cashOnHand: rs(cashOnHand), totals: { balance: rs(s('balance') + cashOnHand), available: rs(s('available') + cashOnHand - margin), blocked: rs(s('blocked') + margin), marginMoney: rs(margin), odLimit: rs(s('odLimit')), odUsed: rs(s('odUsed')) }, bgLimits, facilities,
      forecast: latest ? { id: latest.id, docNo: latest.doc_no, weekStart: latest.week_start, closing: rs(latest.closing_paise), lowest: rs(latest.lowest_paise), lowestWeek: latest.lowest_week } : null, open: open ? { id: open.id, docNo: open.doc_no, status: open.status } : null,
      can: { create: may(actor, 'fin.cash_forecast.create'), manage: may(actor, 'fin.cash_forecast.manage') } };
  }
  const facilities = {
    save(actor, b) { need(actor, 'fin.cash_forecast.manage', 'keep bank facilities'); const c = actor.companyId; if (b.limitType === 'TERM_LOAN' && b.emi > 0 && !b.emiDay) throw badRequest('Correct the highlighted fields', [{ field: 'emiDay', message: 'Give the day of the month the instalment is paid.' }]);
      if (b.id) { const f = db.prepare('SELECT * FROM cf_bank_limits WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(b.id), c); if (!f) throw notFound('That facility does not exist.'); if (b.version != null && b.version !== f.version) throw conflict('Someone changed this facility: reload it.');
        db.prepare('UPDATE cf_bank_limits SET bank_name = ?, limit_type = ?, limit_paise = ?, utilised_paise = ?, emi_paise = ?, emi_day = ?, start_date = ?, end_date = ?, limit_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.bankName, b.limitType, paise(b.limit), paise(b.utilised ?? 0), paise(b.emi ?? 0), b.emiDay ?? null, b.startDate ?? null, b.endDate ?? null, b.status ?? 'ACTIVE', actor.user, nowIso(), f.id); audit(actor, 'cf_bank_limits', f.id, 'update', c, { oldValues: { limit: rs(f.limit_paise), utilised: rs(f.utilised_paise) }, newValues: { limit: b.limit, utilised: b.utilised } }); }
      else { const id = Number(db.prepare("INSERT INTO cf_bank_limits (company_id, bank_account_id, bank_name, limit_type, limit_paise, utilised_paise, emi_paise, emi_day, start_date, end_date, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, b.bankAccountId ?? null, b.bankName, b.limitType, paise(b.limit), paise(b.utilised ?? 0), paise(b.emi ?? 0), b.emiDay ?? null, b.startDate ?? null, b.endDate ?? null, actor.user).lastInsertRowid); audit(actor, 'cf_bank_limits', id, 'create', c, { newValues: { bank: b.bankName, type: b.limitType, limit: b.limit } }); }
      return treasury(actor); },
  };

  // ---- FR-05: payment priority ----
  const priority = {
    /** @param {any} actor @param {{ dueBy?: string }} q */
    list(actor, { dueBy } = {}) {
      need(actor, 'fin.cash_forecast.view', 'see payment priorities'); const c = actor.companyId; const today = todayIST(); const due = dueBy ?? addDays(today, 7); const critical = new Set(db.prepare('SELECT partner_id FROM cf_priority_partners WHERE company_id = ? AND deleted_at IS NULL').all(c).map((r) => r.partner_id));
      const rows = []; const tds = -acctBal(c, ['230004', '230007'], today); const gst = -acctBal(c, ['230001', '230002', '230003'], today) - acctBal(c, ['170001', '170002', '170003'], today);
      if (tds > 0) rows.push({ rank: 1, class: 'STATUTORY', label: 'TDS / TCS payable', due: `${addMonths(today.slice(0, 7), 1)}-07`, amount: tds }); if (gst > 0) rows.push({ rank: 1, class: 'STATUTORY', label: 'GST net payable (estimate)', due: `${addMonths(today.slice(0, 7), 1)}-20`, amount: gst });
      if (has('ap_bills')) for (const b of db.prepare("SELECT * FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND net_payable_paise - adjusted_paise - paid_paise > 0 AND COALESCE(msme_due_date, due_date) <= ? ORDER BY COALESCE(msme_due_date, due_date), id LIMIT 500").all(c, due)) { const cls = b.msme ? 'MSME' : critical.has(b.partner_id) ? 'CRITICAL' : 'OTHER'; rows.push({ rank: cls === 'MSME' ? 2 : cls === 'CRITICAL' ? 3 : 4, class: cls, label: `${b.payee_name} · ${b.bill_no ?? b.doc_no}`, billId: b.id, projectId: b.org_project_id, due: b.msme && b.msme_due_date ? b.msme_due_date : b.due_date, amount: b.net_payable_paise - b.adjusted_paise - b.paid_paise }); }
      rows.sort((a, b) => a.rank - b.rank || String(a.due).localeCompare(String(b.due)));
      const avail = Math.round(treasury(actor).totals.available * 100); let run = 0; return { dueBy: due, available: rs(avail), rows: rows.map((r) => { run += r.amount; return { ...r, amount: rs(r.amount), cumulative: rs(run), covered: run <= avail }; }), critical: db.prepare('SELECT c.id, c.partner_id, c.reason, m.legal_name FROM cf_priority_partners c JOIN mdm_partners m ON m.id = c.partner_id WHERE c.company_id = ? AND c.deleted_at IS NULL ORDER BY m.legal_name').all(c).map((r) => ({ id: r.id, partnerId: r.partner_id, partner: r.legal_name, reason: r.reason })) };
    },
    mark(actor, { partnerId, reason }) { need(actor, 'fin.cash_forecast.manage', 'mark critical suppliers'); const p = db.prepare('SELECT id, legal_name FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(partnerId), actor.companyId); if (!p) throw badRequest('Correct the highlighted fields', [{ field: 'partnerId', message: 'Choose a supplier of the company.' }]);
      try { const id = Number(db.prepare("INSERT INTO cf_priority_partners (company_id, partner_id, reason, created_by, source_type) VALUES (?, ?, ?, ?, 'api')").run(actor.companyId, p.id, reason, actor.user).lastInsertRowid); audit(actor, 'cf_priority_partners', id, 'create', actor.companyId, { reason: `${p.legal_name}: ${reason}` }); } catch (e) { if (/UNIQUE/.test(String(e.message))) throw conflict('That supplier is already marked critical.'); throw e; }
      return priority.list(actor, {}); },
    unmark(actor, id, { reason }) { need(actor, 'fin.cash_forecast.manage', 'mark critical suppliers'); const r = db.prepare('SELECT * FROM cf_priority_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That supplier is not marked critical.'); db.prepare('UPDATE cf_priority_partners SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'cf_priority_partners', r.id, 'delete', actor.companyId, { reason }); return priority.list(actor, {}); },
  };
  const jobs = {
    /** On Monday: a company with the flag on and no forecast of this week is told to prepare it. */
    remind() { const today = todayIST(); if (new Date(`${today}T00:00:00Z`).getUTCDay() !== 1) return { reminded: 0 }; let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!on(c.id) || db.prepare('SELECT 1 FROM cf_forecasts WHERE company_id = ? AND week_start = ? AND deleted_at IS NULL').get(c.id, today)) continue; n += 1; notify(c.id, 'fin.cf.alert', ['permission:fin.cash_forecast.create'], today, 'weekly cash forecast', `The cash forecast of the week of ${today} is not prepared.`, '/finance/treasury', `${c.id}-${today}`); } return { reminded: n }; },
  };
  return { forecasts, variance, projectCurve, treasury, facilities, priority, sourceLines, jobs };
}
