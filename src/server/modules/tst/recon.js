import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { conflict, notFound } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { cashOf, postingOf } from '../fin/index.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { HANDOFFS } from './threads.js';

/**
 * Part 30.02 — data traceability and the reconciliation suite.
 *
 * FR-02 the reconciliation jobs. Each check compares two figures that must agree across modules and reports every difference beyond its
 * tolerance (parameters, changed through the maker-checker of 29.01):
 *   QTY_CHAIN      BOQ → measurement → billed quantities: a client bill never bills more of a BOQ line than is measured and approved;
 *   COST_CHAIN     budget → commitment → actual, no double counting: one actual per source line, a commitment's consumed amount equals the
 *                  actuals booked against it, no commitment consumed beyond its amount;
 *   SUBLEDGER_GL   AP, AR, inventory, GRNI, retention and advances against their control accounts (the posting engine's own reconciliation, 23.02);
 *   STOCK_BALANCES the stock ledger against the stock balances (16.02);
 *   PAYROLL_GL     approved payroll runs posted to the ledger, with the run's own net pay;
 *   BANK_BOOK      the bank reconciliation statement of each account (23.06): bank less the computed book.
 * The checks read the owners' services where they publish one (posting engine, bank reconciliation) and the owners' tables read-only
 * otherwise; nothing is written into another module's tables. They run as the reconciliation service account (CFO and AUD read rights):
 * a run started by the QA lead sees the same figures as the nightly run; amounts are shown only to holders of `tst.recon.amounts`.
 * FR-01 trace completeness: every derived record whose `source_type` names a table must point at a record that exists, and every hand-off
 * of 30.01 that requires a source must have one; the share of linked records is the trace completeness (target 99.9 %).
 * BR-01 a difference above tolerance is a Critical finding; the run is RED until it is cleared, and the alert goes to the CFO, AUD and QA lead.
 */
export const RECON_FLAG = 'ff.qa.p3002';
export const RECON_JOB = 'tst.recon.run';
const TOL_MONEY = 'tst.recon.tolerance_paise';
const TOL_QTY = 'tst.recon.qty_tolerance_milli';
const TRACE_TARGET = 'tst.recon.trace_target_bp';
const PAYROLL_DAYS = 'tst.recon.payroll_post_days';
for (const [key, def, min, max, description] of /** @type {[string, number, number, number, string][]} */ ([
  [TOL_MONEY, 100, 0, 10_000_000, 'Part 30.02 BR-01: the money difference (paise) a reconciliation tolerates before it is a Critical finding (100 = ₹1 of rounding).'],
  [TOL_QTY, 1, 0, 1_000_000, 'Part 30.02 BR-01: the quantity difference (thousandths of a unit) a quantity reconciliation tolerates.'],
  [TRACE_TARGET, 9990, 0, 10000, 'Part 30.02 AC-01: the trace completeness to reach, in hundredths of a per cent (9990 = 99.9 %).'],
  [PAYROLL_DAYS, 3, 0, 60, 'Part 30.02: days after its approval within which a payroll run must be posted to the ledger.'],
])) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });

for (const [type, description] of [
  ['tst.recon.completed', 'A reconciliation run finished (part 30.02): data { runId, status, checks, failed, critical, tracePct }.'],
  ['tst.recon.difference_found', 'A reconciliation found a difference above tolerance (part 30.02 BR-01): data { runId, check, scope, difference }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: { type: 'object' }, owner: 'tst', description });

export const CHECKS = Object.freeze({
  QTY_CHAIN: { label: 'BOQ, measured and billed quantities', owner: '22.02', unit: 'qty', drill: '/bill/qty-recon' },
  COST_CHAIN: { label: 'Budget, commitments and actuals (no double counting)', owner: '15.04', unit: 'money', drill: '/bud/ledger' },
  SUBLEDGER_GL: { label: 'Sub-ledgers against the general ledger', owner: '23.02', unit: 'money', drill: '/finance/posting-reconciliation' },
  STOCK_BALANCES: { label: 'Stock ledger against stock balances', owner: '16.02', unit: 'qty', drill: '/inv/stock' },
  PAYROLL_GL: { label: 'Payroll against the general ledger', owner: '24.05', unit: 'money', drill: '/pay/posting' },
  BANK_BOOK: { label: 'Bank against book', owner: '23.06', unit: 'money', drill: '/finance/bank-reconciliation' },
});
// integrity: the states of this part's tables (the Data Health check)
integrityRegistry.register({ statuses: { tst_recon_runs: ['QUEUED', 'RUNNING', 'DONE', 'FAILED'], tst_recon_results: ['PASS', 'FAIL', 'INFO', 'SKIPPED', 'ERROR'] } });
const iso = (d = new Date()) => d.toISOString();
const rs = (p) => (p == null ? null : Math.round(Number(p)) / 100);
const paise = (r) => (r == null ? null : Math.round(Number(String(r).replace(/,/g, '')) * 100));

/** @param {any} context @param {{ jobs?: any, scheduler?: any }} deps */
export function createReconService(context, { jobs, scheduler } = {}) {
  const { db } = context;
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  // read afresh for each run, so an approved tolerance change applies to the next run
  const param = (companyId, key) => Number(createParameterStore(db).get(key, { companyId, date: todayIST() }));
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, RECON_FLAG)) throw notFound('The reconciliation suite is not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  /** The account the checks run as: read rights of the CFO and the auditor, nothing else. */
  const reconActor = (companyId) => ({ user: 'system:reconciliation', userId: null, companyId, roles: ['CFO', 'AUD'] });
  const projectCode = (id) => (id ? db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? `#${id}` : null);

  // ---------------------------------------------------------------- the checks; each returns rows { scope, label, expected, actual, difference, unit, drill, detail }
  const run = {
    QTY_CHAIN(c, tol) {
      if (!has('bill_client_bill_items') || !has('bill_mb_entries')) return { skipped: 'Billing is not installed.' };
      // the cumulative quantity billed of each BOQ line (latest approved or pending bill) against the measured and approved quantity
      const rows = db.prepare(`
        WITH billed AS (
          SELECT i.boq_line_id AS line, b.org_project_id AS pj, MAX(i.cum_qty_th) AS billed_th, MAX(b.id) AS bill_id
          FROM bill_client_bill_items i JOIN bill_client_bills b ON b.id = i.bill_id
          WHERE b.company_id = :c AND b.deleted_at IS NULL AND i.deleted_at IS NULL AND b.status IN ('SUBMITTED', 'APPROVED') AND i.boq_line_id IS NOT NULL
          GROUP BY i.boq_line_id, b.org_project_id),
        measured AS (
          SELECT e.boq_line_id AS line, SUM(e.qty_th) AS measured_th FROM bill_mb_entries e
          WHERE e.company_id = :c AND e.deleted_at IS NULL AND e.status = 'APPROVED' AND e.boq_line_id IS NOT NULL GROUP BY e.boq_line_id)
        SELECT b.line, b.pj, b.billed_th, COALESCE(m.measured_th, 0) AS measured_th, b.bill_id, l.item_code, l.description
        FROM billed b LEFT JOIN measured m ON m.line = b.line LEFT JOIN proj_boq_lines l ON l.id = b.line`).all({ c });
      return { rows: rows.map((r) => ({ scope: projectCode(r.pj), label: `${r.item_code ?? `BOQ line ${r.line}`} ${r.description ?? ''}`.trim(), expected: r.measured_th / 1000, actual: r.billed_th / 1000,
        difference: Math.max(0, r.billed_th - r.measured_th) / 1000, over: r.billed_th - r.measured_th > tol.qty, unit: 'qty', drill: `/bill/qty-recon?projectId=${r.pj}`, detail: 'Billed beyond the approved measurement' })) };
    },
    COST_CHAIN(c, tol) {
      if (!has('bud_commitments') || !has('bud_actuals')) return { skipped: 'Budgets are not installed.' };
      const out = [];
      // one source line is one actual (the ledger's unique key); the same document booked again under another source is double counting
      for (const r of db.prepare("SELECT org_project_id AS pj, doc_ref AS ref, COUNT(DISTINCT src_type) AS kinds, COUNT(*) AS n, SUM(amount) AS amount, MAX(amount) AS one FROM bud_actuals WHERE company_id = ? AND deleted_at IS NULL AND status = 'POSTED' AND doc_ref IS NOT NULL GROUP BY org_project_id, doc_ref HAVING COUNT(DISTINCT COALESCE(src_type, '')) > 1").all(c)) {
        out.push({ scope: projectCode(r.pj), label: `${r.ref} counted ${r.n} times`, expected: r.one, actual: r.amount, difference: r.amount - r.one, over: r.amount - r.one > tol.money, unit: 'money', drill: `/bud/ledger?projectId=${r.pj}`, detail: 'Double counting: the same document booked as an actual from more than one source' });
      }
      // a commitment's consumed amount against the actuals booked against it
      for (const r of db.prepare("SELECT c.id, c.org_project_id AS pj, c.doc_ref AS ref, c.amount, c.consumed_amount AS consumed, COALESCE((SELECT SUM(a.consumed_amount) FROM bud_actuals a WHERE a.commitment_id = c.id AND a.deleted_at IS NULL AND a.status = 'POSTED'), 0) AS booked FROM bud_commitments c WHERE c.company_id = ? AND c.deleted_at IS NULL").all(c)) {
        const diff = r.consumed - r.booked;
        out.push({ scope: projectCode(r.pj), label: `Commitment ${r.ref ?? r.id}`, expected: r.booked, actual: r.consumed, difference: Math.abs(diff), over: Math.abs(diff) > tol.money, unit: 'money', drill: `/bud/ledger?projectId=${r.pj}`, detail: 'Consumed on the commitment against the actuals booked to it' });
        if (r.consumed - r.amount > tol.money) out.push({ scope: projectCode(r.pj), label: `Commitment ${r.ref ?? r.id} over-consumed`, expected: r.amount, actual: r.consumed, difference: r.consumed - r.amount, over: true, unit: 'money', drill: `/bud/ledger?projectId=${r.pj}`, detail: 'Consumed beyond the committed amount' });
      }
      return { rows: out };
    },
    SUBLEDGER_GL(c, tol) {
      const posting = postingOf(db);
      if (!posting?.reconcile) return { skipped: 'The posting engine is not installed.' };
      const r = posting.reconcile(reconActor(c), { asOf: todayIST() });
      const rows = r.rows.map((x) => { const diff = Math.abs(paise(x.difference) ?? 0); return { scope: x.code, label: x.label, expected: paise(x.gl), actual: paise(x.subledger), difference: diff, over: diff > tol.money, unit: 'money', drill: x.drill ?? '/finance/posting-reconciliation', detail: x.accounts }; });
      for (const [type, n] of Object.entries(r.failed ?? {})) rows.push({ scope: 'POSTING', label: `Failed postings of ${type}`, expected: 0, actual: n, difference: n, over: n > 0, unit: 'count', drill: '/finance/posting-failures', detail: 'Events the posting engine could not post' });
      return { rows };
    },
    STOCK_BALANCES(c, tol) {
      if (!has('inv_balances') || !has('inv_stock_ledger')) return { skipped: 'Stores are not installed.' };
      const rows = db.prepare(`SELECT b.store_id, b.item_id, SUM(b.qty_on_hand) AS bal, COALESCE((SELECT SUM(l.qty_in - l.qty_out) FROM inv_stock_ledger l WHERE l.company_id = b.company_id AND l.store_id = b.store_id AND l.item_id = b.item_id), 0) AS led,
        (SELECT code FROM inv_stores s WHERE s.id = b.store_id) AS store, (SELECT code FROM mdm_items i WHERE i.id = b.item_id) AS item FROM inv_balances b WHERE b.company_id = ? GROUP BY b.store_id, b.item_id`).all(c);
      return { rows: rows.map((r) => { const diff = Math.abs(r.bal - r.led); return { scope: r.store ?? `#${r.store_id}`, label: `${r.item ?? `item ${r.item_id}`}`, expected: r.led, actual: r.bal, difference: diff, over: diff * 1000 > tol.qty, unit: 'qty', drill: `/inv/stock?storeId=${r.store_id}&itemId=${r.item_id}`, detail: 'Balance on hand against the sum of the stock ledger' }; }) };
    },
    PAYROLL_GL(c, tol) {
      if (!has('pay_runs') || !has('fin_posting_log')) return { skipped: 'Payroll is not installed.' };
      const due = iso(new Date(Date.now() - param(c, PAYROLL_DAYS) * 86_400_000));
      const out = [];
      for (const r of db.prepare("SELECT r.id, r.doc_no, r.period, r.net_paise, r.approved_at, (SELECT l.payload_json FROM fin_posting_log l WHERE l.company_id = r.company_id AND l.doc_type = 'pay_runs' AND l.doc_id = r.id AND l.log_status = 'POSTED' ORDER BY l.id DESC LIMIT 1) AS posted FROM pay_runs r WHERE r.company_id = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL").all(c)) {
        if (!r.posted) { if ((r.approved_at ?? '') <= due) out.push({ scope: r.period, label: `${r.doc_no} not posted`, expected: r.net_paise, actual: 0, difference: r.net_paise, over: true, unit: 'money', drill: `/pay/posting?runId=${r.id}`, detail: 'Approved payroll not in the ledger' }); continue; }
        let net = null; try { const p = JSON.parse(r.posted); net = paise(p.netPayable ?? p.data?.netPayable); } catch { /* unreadable payload */ }
        const diff = net == null ? 0 : Math.abs(net - r.net_paise);
        out.push({ scope: r.period, label: r.doc_no, expected: r.net_paise, actual: net ?? r.net_paise, difference: diff, over: diff > tol.money, unit: 'money', drill: `/pay/posting?runId=${r.id}`, detail: 'Net pay of the run against the net pay posted' });
      }
      return { rows: out };
    },
    BANK_BOOK(c, tol) {
      const cash = cashOf(db);
      if (!cash?.brs || !has('fin_bank_accounts')) return { skipped: 'Bank reconciliation is not installed.' };
      const out = [];
      for (const b of db.prepare("SELECT id, code, name FROM fin_bank_accounts WHERE company_id = ? AND deleted_at IS NULL AND acct_status = 'ACTIVE'").all(c)) {
        let r; try { r = cash.brs(reconActor(c), { bankAccountId: b.id, asOf: todayIST() }); } catch (e) { out.push({ scope: b.code, label: b.name, expected: null, actual: null, difference: 0, over: false, unit: 'money', drill: '/finance/bank-reconciliation', detail: String(e?.message ?? e).slice(0, 200), info: true }); continue; }
        if (r.statement == null) { out.push({ scope: b.code, label: b.name, expected: paise(r.book), actual: null, difference: 0, over: false, unit: 'money', drill: `/finance/bank-reconciliation?bankAccountId=${b.id}`, detail: 'No bank statement imported yet', info: true }); continue; }
        const diff = Math.abs(paise(r.difference) ?? 0);
        out.push({ scope: b.code, label: b.name, expected: paise(r.computed), actual: paise(r.statement), difference: diff, over: diff > tol.money, unit: 'money', drill: `/finance/bank-reconciliation?bankAccountId=${b.id}`, detail: 'Bank balance against the book adjusted for items in transit' });
      }
      return { rows: out };
    },
  };

  // ---------------------------------------------------------------- FR-01: trace completeness
  function traceCompleteness(c) {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
    const groups = [];
    for (const t of tables) {
      const cols = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name));
      if (!cols.has('company_id')) continue;
      for (const [st, si] of [['source_type', 'source_id'], ['src_type', 'src_id']]) {
        if (!cols.has(st) || !cols.has(si)) continue;
        const live = cols.has('deleted_at') ? ' AND x.deleted_at IS NULL' : '';
        for (const g of db.prepare(`SELECT x.${st} AS src, COUNT(*) AS n FROM ${t} x WHERE x.company_id = ? AND x.${si} IS NOT NULL AND x.${si} GLOB '[0-9]*'${live} GROUP BY x.${st}`).all(c)) {
          if (!g.src || !tables.has(g.src) || g.src === t) continue;
          const missing = db.prepare(`SELECT x.id, x.${si} AS sid FROM ${t} x WHERE x.company_id = ? AND x.${st} = ? AND x.${si} IS NOT NULL AND x.${si} GLOB '[0-9]*'${live} AND NOT EXISTS (SELECT 1 FROM ${g.src} s WHERE s.id = CAST(x.${si} AS INTEGER)) LIMIT 200`).all(c, g.src);
          groups.push({ kind: 'SOURCE_LINK', table: t, source: g.src, total: g.n, missing: missing.length, samples: missing.slice(0, 5).map((m) => ({ id: m.id, sourceId: String(m.sid) })) });
        }
      }
    }
    // the hand-offs of 30.01 that require a source (the derived documents of the business threads)
    for (const x of HANDOFFS) {
      // a hand-off that links through source_type and source_id is already counted above
      if (x.custom || !x.required || !tables.has(x.to) || !tables.has(x.from) || /source_type/.test(x.on ?? '')) continue;
      try {
        const cols = new Set(db.prepare(`PRAGMA table_info(${x.to})`).all().map((k) => k.name));
        const on = x.on ?? `f.id = t.${x.fk}`;
        const live = `t.company_id = :c${cols.has('deleted_at') ? ' AND t.deleted_at IS NULL' : ''}${x.where ? ` AND (${x.where})` : ''} AND (${x.required})`;
        const n = db.prepare(`SELECT COUNT(*) AS n FROM ${x.to} t LEFT JOIN ${x.from} f ON ${on} WHERE ${live}`).get({ c }).n;
        if (!n) continue;
        const missing = db.prepare(`SELECT t.id FROM ${x.to} t LEFT JOIN ${x.from} f ON ${on} WHERE ${live} AND f.id IS NULL LIMIT 200`).all({ c });
        groups.push({ kind: 'HANDOFF', table: x.to, source: x.from, handoff: x.code, label: x.label, total: n, missing: missing.length, samples: missing.slice(0, 5).map((m) => ({ id: m.id, sourceId: null })) });
      } catch { /* a hand-off of a module not installed */ }
    }
    const total = groups.reduce((n, g) => n + g.total, 0);
    const missing = groups.reduce((n, g) => n + g.missing, 0);
    const pctBp = total ? Math.floor(((total - missing) / total) * 10000) : 10000;
    return { total, linked: total - missing, missing, pctBp, pct: pctBp / 100, targetBp: param(c, TRACE_TARGET), met: pctBp >= param(c, TRACE_TARGET), groups: groups.sort((a, b) => b.missing - a.missing || b.total - a.total) };
  }

  // ---------------------------------------------------------------- the run
  function compute(c) {
    const tol = { money: param(c, TOL_MONEY), qty: param(c, TOL_QTY) };
    const checks = Object.entries(CHECKS).map(([code, d]) => {
      try {
        const out = run[code](c, tol);
        if (out.skipped) return { code, ...d, status: 'SKIPPED', note: out.skipped, rows: [], failed: 0, compared: 0, difference: 0 };
        const failed = out.rows.filter((r) => r.over);
        return { code, ...d, status: failed.length ? 'FAIL' : 'PASS', note: null, rows: out.rows, failed: failed.length, compared: out.rows.filter((r) => !r.info).length, difference: failed.reduce((n, r) => n + (r.difference ?? 0), 0) };
      } catch (e) {
        // the owner's part switched off for the company: nothing to reconcile there
        if (e?.status === 404) return { code, ...d, status: 'SKIPPED', note: String(e.message).slice(0, 300), rows: [], failed: 0, compared: 0, difference: 0 };
        return { code, ...d, status: 'ERROR', note: String(e?.message ?? e).slice(0, 300), rows: [], failed: 0, compared: 0, difference: 0 };
      }
    });
    const trace = traceCompleteness(c);
    const critical = checks.reduce((n, k) => n + k.failed, 0);
    const status = checks.some((k) => k.status === 'FAIL' || k.status === 'ERROR') || !trace.met ? 'RED' : 'GREEN';
    return { status, checks, trace, tolerance: tol, critical };
  }
  const runView = (r) => ({ id: r.id, runNo: r.run_no, status: r.status, result: r.result_status, asOf: r.as_of, checks: r.checks_count, failed: r.failed_count, critical: r.critical_count, tracePct: r.trace_bp == null ? null : r.trace_bp / 100, startedAt: r.started_at, finishedAt: r.finished_at, requestedBy: r.requested_by, error: r.error });
  function execute(runId) {
    const r = db.prepare('SELECT * FROM tst_recon_runs WHERE id = ?').get(runId);
    if (!r || r.status !== 'QUEUED') return null;
    db.prepare("UPDATE tst_recon_runs SET status = 'RUNNING', started_at = ?, updated_at = ? WHERE id = ?").run(iso(), iso(), r.id);
    try {
      const out = compute(r.company_id);
      transaction(db, () => {
        const ins = db.prepare("INSERT INTO tst_recon_results (company_id, run_id, check_code, scope_key, label, expected_value, actual_value, difference_value, unit, status, severity, drill_route, detail, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'tst_recon_runs', ?)");
        for (const k of out.checks) {
          if (!k.rows.length) ins.run(r.company_id, r.id, k.code, null, k.note ?? k.label, null, null, 0, k.unit, k.status === 'FAIL' ? 'FAIL' : k.status, k.status === 'ERROR' ? 'MAJOR' : 'INFO', k.drill, k.note ?? null, String(r.id));
          for (const x of k.rows.slice(0, 2000)) ins.run(r.company_id, r.id, k.code, x.scope ?? null, String(x.label).slice(0, 300), x.expected ?? null, x.actual ?? null, x.difference ?? 0, x.unit, x.info ? 'INFO' : x.over ? 'FAIL' : 'PASS', x.over ? 'CRITICAL' : 'INFO', x.drill ?? k.drill, x.detail ?? null, String(r.id));
        }
        db.prepare("UPDATE tst_recon_runs SET status = 'DONE', result_status = ?, finished_at = ?, checks_count = ?, failed_count = ?, critical_count = ?, trace_bp = ?, trace_json = ?, tolerance_json = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(out.status, iso(), out.checks.length, out.checks.filter((k) => k.status === 'FAIL' || k.status === 'ERROR').length, out.critical, out.trace.pctBp, JSON.stringify(out.trace), JSON.stringify({ ...out.tolerance, checks: out.checks.map((k) => ({ code: k.code, status: k.status, note: k.note ?? null, compared: k.compared, failed: k.failed, difference: k.difference })) }), iso(), r.id);
        publishEvent(db, { type: 'tst.recon.completed', entity: 'tst_recon_runs', entityId: r.id, actorId: r.requested_by, companyId: r.company_id, data: { runId: r.id, status: out.status, checks: out.checks.length, failed: out.checks.filter((k) => k.status === 'FAIL').length, critical: out.critical, tracePct: out.trace.pct } });
        for (const k of out.checks.filter((x) => x.status === 'FAIL')) publishEvent(db, { type: 'tst.recon.difference_found', entity: 'tst_recon_runs', entityId: r.id, actorId: 'system', companyId: r.company_id, data: { runId: r.id, check: k.code, findings: k.failed } });
      });
      if (out.status !== 'GREEN' || r.requested_by !== 'system') {
        const failedChecks = out.checks.filter((k) => k.status !== 'PASS' && k.status !== 'SKIPPED').map((k) => CHECKS[k.code].label).join(', ') || (out.trace.met ? '' : 'trace completeness');
        try { notificationsOf(db).notify({ companyId: r.company_id, templateCode: 'tst.recon.alert', recipients: out.status === 'GREEN' ? [`user:${r.requested_by}`] : ['permission:tst.recon.view', ...(r.requested_by === 'system' ? [] : [`user:${r.requested_by}`])], channels: r.requested_by === 'system' ? ['IN_APP', 'EMAIL'] : ['IN_APP'], priority: out.status === 'GREEN' ? 'LOW' : 'HIGH', category: out.status === 'GREEN' ? 'system' : 'alerts', data: { run: r.run_no, result: out.status, findings: String(out.critical), checks: failedChecks || 'none', trace: String(out.trace.pct) }, link: `/admin/reconciliation-health?run=${r.id}`, sourceType: 'tst_recon_runs', sourceId: r.id }); } catch { /* the run is saved */ }
      }
      return out;
    } catch (e) {
      db.prepare("UPDATE tst_recon_runs SET status = 'FAILED', finished_at = ?, error = ?, updated_at = ? WHERE id = ?").run(iso(), String(e?.message ?? e).slice(0, 500), iso(), r.id);
      throw e;
    }
  }
  function queue(companyId, by) {
    if (db.prepare("SELECT 1 FROM tst_recon_runs WHERE company_id = ? AND status IN ('QUEUED', 'RUNNING') AND created_at > ?").get(companyId, iso(new Date(Date.now() - 10 * 60_000)))) throw conflict('A reconciliation is already running for this company; wait for it to finish.');
    const no = `RCN-${String((db.prepare('SELECT COUNT(*) AS n FROM tst_recon_runs WHERE company_id = ?').get(companyId).n ?? 0) + 1).padStart(6, '0')}`;
    const id = Number(db.prepare("INSERT INTO tst_recon_runs (company_id, run_no, status, as_of, requested_by, created_by, source_type) VALUES (?, ?, 'QUEUED', ?, ?, ?, 'run')").run(companyId, no, todayIST(), by, by).lastInsertRowid);
    if (jobs) jobs.enqueue(RECON_JOB, { runId: id }, { createdBy: by, companyId }); else execute(id);
    return id;
  }

  const amountsVisible = (actor) => hasPermissionAnywhere(actor, 'tst.recon.amounts');
  const mask = (actor, unit, v) => (v == null ? null : unit === 'money' ? (amountsVisible(actor) ? rs(v) : null) : unit === 'qty' ? Math.round(v * 1000) / 1000 : v);
  const resultView = (actor, x) => ({ id: x.id, check: x.check_code, checkLabel: CHECKS[x.check_code]?.label ?? x.check_code, scope: x.scope_key, label: x.label, unit: x.unit, expected: mask(actor, x.unit, x.expected_value), actual: mask(actor, x.unit, x.actual_value),
    difference: mask(actor, x.unit, x.difference_value), status: x.status, severity: x.severity, drill: x.drill_route, detail: x.detail, masked: x.unit === 'money' && !amountsVisible(actor) });

  /** The dashboard: the latest run's checks and trace completeness, the exceptions, the history and my pending actions. */
  function health(actor, q = {}) {
    guard(actor, 'tst.recon.view');
    const runRow = q.run ? db.prepare('SELECT * FROM tst_recon_runs WHERE id = ? AND company_id = ?').get(Number(q.run), actor.companyId) : db.prepare("SELECT * FROM tst_recon_runs WHERE company_id = ? AND status = 'DONE' ORDER BY id DESC LIMIT 1").get(actor.companyId);
    if (q.run && !runRow) throw notFound('That reconciliation run does not exist.');
    const history = db.prepare("SELECT * FROM tst_recon_runs WHERE company_id = ? AND status = 'DONE' ORDER BY id DESC LIMIT 14").all(actor.companyId).reverse().map(runView);
    const pending = db.prepare("SELECT * FROM tst_recon_runs WHERE company_id = ? AND status IN ('QUEUED', 'RUNNING') ORDER BY id DESC LIMIT 1").get(actor.companyId);
    const base = { history, running: pending ? runView(pending) : null, checks: Object.entries(CHECKS).map(([code, d]) => ({ code, ...d })), amountsVisible: amountsVisible(actor),
      can: { run: hasPermissionAnywhere(actor, 'tst.recon.run'), export: hasPermissionAnywhere(actor, 'tst.recon.export'), tolerance: hasPermissionAnywhere(actor, 'adm.change.create') },
      tolerance: { money: rs(param(actor.companyId, TOL_MONEY)), qty: param(actor.companyId, TOL_QTY) / 1000, traceTargetPct: param(actor.companyId, TRACE_TARGET) / 100, keys: [TOL_MONEY, TOL_QTY, TRACE_TARGET, PAYROLL_DAYS] } };
    if (!runRow) return { ...base, run: null, summary: [], trace: null, exceptions: { rows: [], total: 0, page: 1, pageSize: 25 } };
    const meta = JSON.parse(runRow.tolerance_json ?? '{}');
    const summary = Object.entries(CHECKS).map(([code, d]) => { const m = (meta.checks ?? []).find((k) => k.code === code) ?? {}; const diff = db.prepare("SELECT COALESCE(SUM(difference_value), 0) AS d FROM tst_recon_results WHERE run_id = ? AND check_code = ? AND status = 'FAIL'").get(runRow.id, code).d; return { code, label: d.label, owner: d.owner, unit: d.unit, drill: d.drill, status: m.status ?? 'SKIPPED', note: m.note ?? null, compared: m.compared ?? 0, failed: m.failed ?? 0, difference: mask(actor, d.unit, diff) }; });
    const where = ['run_id = :r'];
    const P = { r: runRow.id };
    if (q.check) { where.push('check_code = :k'); P.k = q.check; }
    if (q.status) { where.push('status = :s'); P.s = q.status; } else where.push("status IN ('FAIL', 'ERROR')");
    if (q.q) { where.push("(label LIKE :q OR COALESCE(scope_key, '') LIKE :q)"); P.q = `%${q.q}%`; }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM tst_recon_results WHERE ${where.join(' AND ')}`).get(P).n;
    const page = Math.max(1, q.page ?? 1); const size = Math.min(200, q.pageSize ?? 25);
    const rows = db.prepare(`SELECT * FROM tst_recon_results WHERE ${where.join(' AND ')} ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END, difference_value DESC, id LIMIT :l OFFSET :o`).all({ ...P, l: size, o: (page - 1) * size }).map((x) => resultView(actor, x));
    const trace = JSON.parse(runRow.trace_json ?? 'null');
    return { ...base, run: runView(runRow), summary, trace: trace ? { ...trace, groups: trace.groups.slice(0, 50) } : null, exceptions: { rows, total, page, pageSize: size } };
  }
  const runs = {
    start(actor) {
      guard(actor, 'tst.recon.run');
      const id = queue(actor.companyId, actor.user);
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_recon_runs', entityId: id, action: 'run', actor: actor.user });
      return runView(db.prepare('SELECT * FROM tst_recon_runs WHERE id = ?').get(id));
    },
    get(actor, id) {
      guard(actor, 'tst.recon.view');
      const r = db.prepare('SELECT * FROM tst_recon_runs WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
      if (!r) throw notFound('That reconciliation run does not exist.');
      return runView(r);
    },
  };
  function exportResults(actor, q, format) {
    guard(actor, 'tst.recon.export');
    const h = health(actor, { ...q, page: 1, pageSize: 200 });
    if (!h.run) throw notFound('No reconciliation has run yet.');
    const all = db.prepare(`SELECT * FROM tst_recon_results WHERE run_id = ?${q.check ? ' AND check_code = ?' : ''}${q.status ? ' AND status = ?' : ''} ORDER BY check_code, id`).all(...[h.run.id, ...(q.check ? [q.check] : []), ...(q.status ? [q.status] : [])]).map((x) => resultView(actor, x));
    const columns = [['checkLabel', 'Check'], ['scope', 'Scope'], ['label', 'Record'], ['expected', 'Expected'], ['actual', 'Actual'], ['difference', 'Difference'], ['unit', 'Unit'], ['status', 'Status'], ['severity', 'Severity'], ['detail', 'Detail']].map(([key, label]) => ({ key, label }));
    const buffer = writeExport(format, { columns, rows: all, title: 'Reconciliation results', sheetName: 'Results', footer: [`Run ${h.run.runNo} (${h.run.asOf}): ${h.run.result} · ${h.run.critical} critical difference(s) · trace completeness ${h.run.tracePct} %${h.amountsVisible ? '' : ' · amounts masked'}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'tst.reconciliation', action: 'export', newValues: { format, rows: all.length, run: h.run.id }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `reconciliation-${h.run.runNo}.${format}` };
  }

  if (jobs) {
    jobs.register(RECON_JOB, (ctx) => {
      const runId = Number(ctx.params?.runId);
      if (runId) { const out = execute(runId); return { status: out?.status ?? 'SKIPPED' }; }
      let n = 0;
      for (const c of db.prepare('SELECT id FROM org_companies').all()) if (context.flags.isOn({ companyId: c.id }, RECON_FLAG)) { try { queue(c.id, 'system'); n += 1; } catch { /* one is running */ } }
      return { queued: n };
    }, { maxAttempts: 2, description: 'Reconciliation suite (part 30.02): quantities, cost chain, sub-ledgers, stock, payroll and bank, trace completeness.' });
    scheduler?.define({ code: RECON_JOB, cron: '20 21 * * *', jobType: RECON_JOB, description: 'Nightly reconciliation at 02:50 IST with alerts (part 30.02).' });
  }
  return { compute, traceCompleteness, execute, runs, health, exportResults, checks: run };
}
