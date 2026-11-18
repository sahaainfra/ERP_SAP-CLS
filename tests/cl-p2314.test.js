import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, key, U as QU } from './qa-helpers.js';
import { glOf } from '../src/server/modules/fin/index.js';
import { cashFlowOf, frameOf } from '../src/server/modules/fin/periodclose.js';

// Part 23.14: period close, financial statements and the finance dashboard.
//  T-01 the balance sheet balances (and ties to the trial balance); the checklist blocks the close while a mandatory task is open.
//  and: the indirect cash flow equals the change in cash; the frames and comparatives; the checklist's checks, evidence, dependencies and configuration; the module
//  locks, the GL soft close at submission and the hard close at the CFO's approval (a posting into the month refused); the reopen ACCMGR → CFO → DIR; the year-end
//  steps; the dashboard reconciled to the ledger; rights and isolation.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), dir: as('DIR', 'dir1'), finex: as('FINEX', 'fx1'), se: as('SE', 'se9'), aud: as('AUD', 'aud1') };
const F = '/api/v1/fin';

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  let n = 0; const post = (date, lines, kind) => { n += 1; return glOf(d).postEngine(1, { date, narration: `test ${n}`, sourceType: 'test', sourceId: n, ...(kind ? { kind } : {}), lines: lines.map(([code, dr, cr, project]) => ({ accountId: acct(code), ...(dr ? { debit: String(dr) } : { credit: String(cr) }), ...(project ? { projectId: project } : {}) })) }).journal.id; };
  return { ...r, call, acct, post };
}

test('T-01 the cash flow (indirect) equals the change in cash; the frames of a basis', () => {
  const open = { BS_CASH: 100, BS_TRADE_RECEIVABLES: 50, BS_PPE: 200, BS_SHARE_CAPITAL: 300, BS_TRADE_PAYABLES: 50, BS_OTHER_EQUITY: 0 };
  const close = { BS_CASH: 180, BS_TRADE_RECEIVABLES: 90, BS_PPE: 230, BS_SHARE_CAPITAL: 300, BS_TRADE_PAYABLES: 70, BS_OTHER_EQUITY: 70, BS_LT_BORROWINGS: 60 };
  const pl = { pbt: 80, pat: 70, lines: { PL_DEPRECIATION: 10, PL_FINANCE_COSTS: 5, PL_TAX_EXPENSE: 10 } };
  const cf = cashFlowOf(open, close, pl); assert.equal(cf.net, 80); assert.equal(cf.reconciled, true); assert.equal(cf.totals.investing, -40, 'PPE bought = change + depreciation');
  assert.deepEqual(frameOf('2026-10', 'MONTH', '2026-04-01'), { from: '2026-10-01', to: '2026-10-31', previous: { from: '2026-09-01', to: '2026-09-30' }, lastYear: { from: '2025-10-01', to: '2025-10-31' } });
  assert.deepEqual(frameOf('2026-11', 'QUARTER', '2026-04-01').from, '2026-10-01'); assert.deepEqual(frameOf('2026-10', 'YTD', '2026-04-01').from, '2026-04-01'); assert.deepEqual(frameOf('2027-02', 'YEAR', '2026-04-01').to, '2027-03-31');
});

test('AC-01 statements tied to the ledger; the month closed through its checklist and locks; reopened ACCMGR → CFO → DIR; dashboard; rights', async () => {
  const w = await world(); const d = w.d;
  w.post('2026-09-10', [['150002', 1000000, 0], ['310001', 0, 1000000]]);
  w.post('2026-10-05', [['140001', 500000, 0, w.A], ['410001', 0, 500000, w.A]]); w.post('2026-10-06', [['510001', 200000, 0, w.A], ['220001', 0, 200000]]);
  w.post('2026-10-20', [['150002', 300000, 0], ['140001', 0, 300000, w.A]]); w.post('2026-10-25', [['220001', 150000, 0], ['150002', 0, 150000]]);
  // statements of October
  const s = await w.call(U.cfo, 'GET', '/statements?period=2026-10&basis=MONTH'); assert.equal(s.status, 200, JSON.stringify(s.json)); const x = s.json.data;
  assert.equal(x.tieOut.balanced, true); assert.equal(x.tieOut.balanceSheetBalances, true, 'T-01: the balance sheet balances'); assert.equal(x.tieOut.assets, 1350000); assert.equal(x.tieOut.tbDebit, x.tieOut.tbCredit);
  const row = (rows, c) => rows.find((r) => r.code === c); assert.equal(row(x.balanceSheet.rows, 'BS_CASH').amount, 1150000); assert.equal(row(x.balanceSheet.rows, 'BS_TRADE_RECEIVABLES').amount, 200000); assert.equal(row(x.balanceSheet.rows, 'BS_OTHER_EQUITY').amount, 300000, "the month's profit in other equity");
  assert.equal(row(x.balanceSheet.rows, 'BS_CASH').previous, 1000000, 'comparative: September'); assert.equal(row(x.profitAndLoss.rows, 'PL_REVENUE').amount, 500000); assert.equal(x.profitAndLoss.totals.pat, 300000); assert.equal(x.profitAndLoss.totals.ebitda, 300000);
  assert.equal(x.cashFlow.net, 150000); assert.equal(x.cashFlow.reconciled, true); assert.equal(x.cashFlow.openingCash, 1000000); assert.equal(row(x.profitAndLoss.rows, 'PL_REVENUE').accounts[0].code, '410001', 'notes: the accounts of a line');
  const ytd = (await w.call(U.cfo, 'GET', '/statements?period=2026-10&basis=YTD&statement=CF')).json.data; assert.equal(ytd.cashFlow.net, 1150000); assert.equal(ytd.cashFlow.reconciled, true);
  assert.equal((await w.call(U.se, 'GET', '/statements?period=2026-10')).status, 403);
  // the close of October: started by the accounts manager; T-01 a mandatory task open blocks it
  assert.equal((await w.call(U.acc, 'POST', '/periods', { period: '2026-12' })).status, 400, 'a month not ended');
  const c = await w.call(U.acc, 'POST', '/periods', { period: '2026-10' }); assert.equal(c.status, 201, JSON.stringify(c.json)); let cl = c.json.data; assert.equal(cl.tasks.length, 10);
  assert.equal((await w.call(U.acc, 'POST', '/periods', { period: '2026-10' })).status, 409);
  const sub = await w.call(U.acc, 'POST', `/periods/${cl.id}/submit`); assert.equal(sub.status, 422, 'T-01: mandatory tasks open'); assert.match(sub.json.error.message, /mandatory tasks are open/);
  const task = (code) => cl.tasks.find((t) => t.code === code); const done = async (code, body = {}, who = U.acc) => { const r = await w.call(who, 'POST', `/periods/${cl.id}/tasks/${task(code).id}/complete`, body); if (r.status === 200) cl = r.json.data; return r; };
  assert.equal((await done('TB_REVIEW')).status, 422, 'waits for its dependencies');
  assert.equal((await done('STORES')).status, 400, 'the check fails and is not explained');
  // the module locks (FR-02)
  const lk = await w.call(U.acc, 'POST', `/periods/${cl.id}/locks`, { modules: ['inventory', 'payroll', 'procurement', 'plant', 'projects'] }); assert.equal(lk.status, 200); cl = lk.json.data; assert.equal(cl.modules.inventory, 'Soft-closed'); assert.equal(cl.modules.finance, 'Open');
  assert.equal(task('STORES').check.ok, true); assert.equal((await done('STORES')).status, 200); assert.equal((await done('PAYROLL')).status, 200); assert.equal((await done('DEPRECIATION')).status, 200, 'no asset in use');
  assert.equal(task('REVREC').check.ok, false); assert.equal((await done('REVREC', { note: 'short' })).status, 400); assert.equal((await done('REVREC', { note: 'Recognised on the bill; percentage of completion not used for project A this month' })).status, 200);
  assert.equal((await done('ACCRUALS')).status, 400, 'a manual task needs its evidence'); assert.equal((await done('ACCRUALS', { note: 'No accruals this month' })).status, 200);
  assert.equal((await done('BANK_RECON')).status, 200, 'no bank account to reconcile'); assert.equal((await done('GST_RECON', { note: 'No GST transactions in October' })).status, 200);
  assert.equal((await w.call(U.finex, 'POST', `/periods/${cl.id}/tasks/${task('SUBLEDGER').id}/complete`, { note: 'Journals posted direct to the control account' })).status, 403, 'not his task');
  assert.equal((await done('SUBLEDGER', { note: 'Opening receivables posted by journal, no invoices yet' })).status, 200); assert.equal((await done('MODULE_LOCKS')).status, 200); assert.equal((await done('TB_REVIEW')).status, 200);
  // configuration: an extra optional task; the CFO alone makes a mandatory task optional
  const xt = await w.call(U.acc, 'POST', `/periods/${cl.id}/tasks`, { name: 'Inter-company confirmations', mandatory: false }); assert.equal(xt.status, 201); cl = xt.json.data; assert.equal(cl.tasks.length, 11);
  // sent: the GL soft-closed; approved by the CFO: every module closed; a posting into October refused
  const sent = await w.call(U.acc, 'POST', `/periods/${cl.id}/submit`); assert.equal(sent.status, 202, JSON.stringify(sent.json)); assert.equal(sent.json.data.modules.finance, 'Soft-closed'); assert.equal(sent.json.data.closeState, 'SOFT_CLOSED');
  assert.equal((await w.act(U.cfo, w.wf('close_periods', cl.id))).status, 200); cl = (await w.call(U.cfo, 'GET', `/periods/${cl.id}`)).json.data;
  assert.equal(cl.status, 'APPROVED'); assert.equal(cl.closeState, 'CLOSED'); assert.ok(Object.values(cl.modules).every((v) => v === 'Closed')); assert.equal(w.events('fin.period.closed').at(-1).revenue, 500000);
  assert.throws(() => w.post('2026-10-30', [['150002', 1000, 0], ['310001', 0, 1000]]), /closed/i, 'the month is closed');
  // the reopen: ACCMGR → CFO → DIR
  assert.equal((await w.call(U.cfo, 'POST', `/periods/${cl.id}/reopen`, { reason: 'Late supplier invoice for October' })).status, 403);
  const ro = await w.call(U.acc, 'POST', `/periods/${cl.id}/reopen`, { modules: ['finance'], reason: 'Late supplier invoice for October' }); assert.equal(ro.status, 202, JSON.stringify(ro.json)); const inst = w.wf('close_reopens', ro.json.data.id);
  assert.equal((await w.act(U.cfo, inst)).status, 200); assert.equal((await w.call(U.cfo, 'GET', `/periods/${cl.id}`)).json.data.modules.finance, 'Closed', 'not yet: the director approves last');
  assert.equal((await w.act(U.dir, inst)).status, 200); cl = (await w.call(U.acc, 'GET', `/periods/${cl.id}`)).json.data; assert.equal(cl.closeState, 'REOPENED'); assert.equal(cl.modules.finance, 'Soft-closed'); assert.equal(cl.modules.inventory, 'Closed');
  assert.equal(w.events('fin.period.reopened').at(-1).reason, 'Late supplier invoice for October');
  // the year end: not every month closed
  const fy = d.prepare("SELECT id FROM core_financial_years WHERE company_id = 1 AND start_date = '2026-04-01'").get().id; const ye = (await w.call(U.cfo, 'GET', `/year-end?fyId=${fy}`)).json.data; assert.equal(ye.steps[0].done, false); assert.equal(ye.can.close, false);
  assert.equal((await w.call(U.cfo, 'POST', `/year-end/${fy}/close`, { reason: 'Year end close' })).status, 422);
  // the dashboard reconciled to the ledger
  const db1 = await w.call(U.dir, 'GET', '/finance-dashboard?period=2026-10'); assert.equal(db1.status, 200, JSON.stringify(db1.json)); const k = db1.json.data;
  assert.equal(k.kpis.revenue, 500000); assert.equal(k.kpis.cash, 1150000); assert.equal(k.kpis.receivables, 200000); assert.equal(k.kpis.payables, 50000); assert.equal(k.kpis.grossMarginPct, 60); assert.equal(k.reconciled.tbBalanced, true); assert.equal(k.reconciled.balanceSheetBalances, true);
  assert.ok(k.trend.some((t) => t.month === '2026-10' && t.revenue === 500000));
  // rights and isolation
  assert.equal((await w.call(U.se, 'GET', '/periods')).status, 403); assert.equal((await w.call(U.aud, 'GET', '/periods')).status, 200); assert.equal((await w.call(U.dir, 'POST', '/periods', { period: '2026-09' })).status, 403);
  assert.equal((await w.call(U.cfo, 'GET', `/periods/${cl.id}/print`)).status, 200); assert.equal((await w.call(as('CFO', 'cfo9', '2'), 'GET', `/periods/${cl.id}`)).status, 404);
});
