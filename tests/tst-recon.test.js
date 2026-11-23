import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';
import { fill } from './qa-helpers.js';
import { buildThreads, enableFlags } from './tst-fixtures.js';
import { chainFor } from '../src/server/modules/admin/control.js';

// Part 30.02 — data traceability and the reconciliation suite.
//  T-01  a seeded discrepancy is detected by each reconciliation job: quantity billed beyond measurement, double-counted actual and a
//        commitment that disagrees with its actuals, AR and inventory not in the ledger, a stock balance off its ledger, an approved payroll
//        not posted and a posted one with another net pay, a bank balance the book does not explain; a clean company is GREEN.
//  FR-01 trace completeness: every hand-off of the threads finds its source (100 %); a derived record pointing at a missing source is found.
//  BR-01 differences above tolerance are Critical and alert the CFO, AUD and QA lead; within tolerance they pass. Tolerances are changed
//        only through the maker-checker of 29.01 (ITADM then CFO or a director).
//  Standard set: roles (CFO sees amounts, the QA lead sees them masked, SE 403, AUD cannot run), another company, idempotent replay, export.
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const CFO = { roles: 'CFO', user: 'cfo1', company: '1' };
const QA = { roles: 'ITADM', user: 'qa-lead', company: '1' };
const R = '/api/v1/tst/reconciliation';
const key = (k = `rc-${Math.random().toString(36).slice(2)}`) => ({ 'idempotency-key': k });
async function world({ threads = false } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api); enableFlags(api.db, 1);
  const ids = threads ? buildThreads(api.db) : null;
  return { api, d: api.db, ids };
}
async function reconcile(w, who = CFO, query = '') {
  const r = await w.api.call('POST', `${R}/runs`, { ...who, headers: key(), body: {} });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await runtimeOf(w.d).jobs.drain(5);
  const h = await w.api.call('GET', `${R}?run=${r.json.data.id}${query}`, who);
  assert.equal(h.status, 200, JSON.stringify(h.json));
  return h.json.data;
}
const status = (h, code) => h.summary.find((s) => s.code === code).status;

test('T-01 a clean company is GREEN; a seeded discrepancy in each check is found as a Critical difference', async () => {
  const w = await world();
  const clean = await reconcile(w);
  assert.equal(clean.run.result, 'GREEN', JSON.stringify(clean.summary));
  assert.equal(clean.run.critical, 0);
  assert.deepEqual(clean.summary.map((s) => s.code), ['QTY_CHAIN', 'COST_CHAIN', 'SUBLEDGER_GL', 'STOCK_BALANCES', 'PAYROLL_GL', 'BANK_BOOK']);
  const d = w.d; d.exec('PRAGMA foreign_keys = OFF');
  const A = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'RC-1', 'Recon Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  // quantity: 12.5 cum billed of a BOQ line measured at 10 cum
  const BL = fill(d, 'proj_boq_lines', { company_id: 1, line_kind: 'ITEM', item_code: '2.1', description: 'PCC 1:4:8', uom: 'cum', qty: 50 });
  fill(d, 'bill_mb_entries', { company_id: 1, org_project_id: A, boq_line_id: BL, qty_th: 10_000, status: 'APPROVED' });
  const CB = fill(d, 'bill_client_bills', { company_id: 1, org_project_id: A, status: 'APPROVED' });
  fill(d, 'bill_client_bill_items', { company_id: 1, bill_id: CB, line_no: 1, boq_line_id: BL, cum_qty_th: 12_500 });
  // cost chain: the same GRN booked as an actual from the receipt and again from the AP bill; a commitment consumed ₹500 with nothing booked against it
  for (const src of ['inv_grns', 'ap_bills']) fill(d, 'bud_actuals', { company_id: 1, org_project_id: A, src_type: src, src_id: '7', src_line_id: '1', amount: 25_000, status: 'POSTED', doc_ref: 'GRN/RC/7' });
  fill(d, 'bud_commitments', { company_id: 1, org_project_id: A, doc_ref: 'PO/RC/9', amount: 100_000, consumed_amount: 50_000 });
  // sub-ledger: a receivable of ₹1,180 never posted to the ledger
  fill(d, 'ar_invoices', { company_id: 1, org_project_id: A, inv_source: 'OTHER_INCOME', amount_paise: 118_000, status: 'APPROVED', invoice_date: '2026-10-05' });
  // stock: 100 received in the ledger, 90 on hand in the balance
  const store = fill(d, 'inv_stores', { company_id: 1, code: 'ST-RC', name: 'Recon store', org_project_id: A });
  const item = fill(d, 'mdm_items', { company_id: 1, code: 'RC-STL', name: 'TMT 12 mm', base_uom: 'kg' });
  fill(d, 'inv_stock_ledger', { company_id: 1, store_id: store, item_id: item, txn_type: 'RECEIPT', txn_date: '2026-10-05', qty_in: 100, qty_out: 0, value: 0 });
  fill(d, 'inv_balances', { company_id: 1, store_id: store, item_id: item, qty_on_hand: 90 });
  // payroll: one run approved long ago and never posted; one posted with another net pay than the run's
  fill(d, 'pay_runs', { company_id: 1, period: '2026-09', run_type: 'REGULAR', status: 'APPROVED', net_paise: 1_000_000, approved_at: '2026-10-01T00:00:00Z', doc_no: 'PR/2026-09' });
  const run2 = fill(d, 'pay_runs', { company_id: 1, period: '2026-10', run_type: 'REGULAR', status: 'APPROVED', net_paise: 2_000_000, approved_at: '2026-11-01T00:00:00Z', doc_no: 'PR/2026-10' });
  fill(d, 'fin_posting_log', { company_id: 1, event_type: 'pay.run.approved', doc_type: 'pay_runs', doc_id: run2, log_status: 'POSTED', payload_json: JSON.stringify({ netPayable: '19500.00' }) });
  // bank: the statement closes at ₹2,500 that nothing in the books or on the statement explains
  const bank = fill(d, 'fin_bank_accounts', { company_id: 1, code: 'HDFC-RC', name: 'HDFC current', acct_status: 'ACTIVE', account_last4: '4321' });
  const imp = fill(d, 'fin_bank_statement_imports', { company_id: 1, bank_account_id: bank, from_date: '2026-10-01', to_date: '2026-10-31', closing_paise: 250_000 });
  fill(d, 'fin_bank_statements', { company_id: 1, import_id: imp, bank_account_id: bank, line_no: 1, txn_date: '2026-10-31', debit_paise: 0, credit_paise: 250_000, balance_paise: 250_000, match_status: 'AUTO', line_hash: 'rc-1' });
  d.exec('PRAGMA foreign_keys = ON');

  const h = await reconcile(w);
  assert.equal(h.run.result, 'RED');
  for (const code of ['QTY_CHAIN', 'COST_CHAIN', 'SUBLEDGER_GL', 'STOCK_BALANCES', 'PAYROLL_GL', 'BANK_BOOK']) assert.equal(status(h, code), 'FAIL', `${code}: ${JSON.stringify(h.summary.find((s) => s.code === code))}`);
  const rows = (await w.api.call('GET', `${R}?run=${h.run.id}&pageSize=200`, CFO)).json.data.exceptions.rows;
  const find = (check, re) => rows.find((r) => r.check === check && re.test(r.label));
  assert.deepEqual([find('QTY_CHAIN', /2\.1/).expected, find('QTY_CHAIN', /2\.1/).actual, find('QTY_CHAIN', /2\.1/).difference], [10, 12.5, 2.5]);
  assert.equal(find('COST_CHAIN', /counted 2 times/).difference, 250);
  assert.equal(find('COST_CHAIN', /PO\/RC\/9/).difference, 500);
  assert.equal(find('SUBLEDGER_GL', /receivable/i).difference, 1180);
  assert.equal(find('STOCK_BALANCES', /RC-STL/).difference, 10);
  assert.equal(find('PAYROLL_GL', /PR\/2026-09 not posted/).difference, 10_000);
  assert.equal(find('PAYROLL_GL', /^PR\/2026-10$/).difference, 500);
  assert.equal(find('BANK_BOOK', /HDFC/).difference, 2500);
  assert.ok(rows.every((r) => r.severity === 'CRITICAL'), 'every difference above tolerance is Critical (BR-01)');
  // alerts: the CFO (permission holder) and the person who ran it are told; the events are published
  assert.ok(d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE source_type = 'tst_recon_runs' AND source_id = ?").get(String(h.run.id)).n >= 1);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'tst.recon.difference_found'").get().n, 6);
  // the drill-down of a check: its exceptions only
  const qty = await w.api.call('GET', `${R}?run=${h.run.id}&check=QTY_CHAIN`, CFO);
  assert.ok(qty.json.data.exceptions.rows.every((r) => r.check === 'QTY_CHAIN' && r.drill.startsWith('/bill/qty-recon')));
});

test('BR-01 a difference within the tolerance passes; the tolerance is a financial parameter changed through ITADM then the CFO', async () => {
  const w = await world();
  w.d.exec('PRAGMA foreign_keys = OFF');
  fill(w.d, 'bud_commitments', { company_id: 1, org_project_id: 1, doc_ref: 'PO/T/1', amount: 100_000, consumed_amount: 5000 });
  w.d.exec('PRAGMA foreign_keys = ON');
  assert.equal(status(await reconcile(w), 'COST_CHAIN'), 'FAIL', '₹50 consumed with nothing booked is beyond the default ₹1');
  assert.deepEqual(chainFor('PARAMETER', 'tst.recon.tolerance_paise'), ['ITADM', 'CFO|DIR']);
  w.d.prepare("INSERT INTO core_parameters (key, data_type, scope_type, scope_id, company_id, value, effective_from, created_by, source_type) VALUES ('tst.recon.tolerance_paise', 'integer', 'company', 1, 1, '100000', '2026-01-01', 'test', 'test')").run();
  const h = await reconcile(w);
  assert.equal(status(h, 'COST_CHAIN'), 'PASS');
  assert.equal(h.tolerance.money, 1000);
});

test('FR-01 trace completeness: every derived record of the threads finds its source; a source that disappears is found', async () => {
  const w = await world({ threads: true });
  const h = await reconcile(w);
  assert.equal(h.trace.pct, 100, JSON.stringify(h.trace.groups.filter((g) => g.missing)));
  assert.ok(h.trace.total >= 30);
  assert.ok(h.trace.groups.some((g) => g.kind === 'SOURCE_LINK' && g.table === 'plan_baselines' && g.source === 'ctr_eot_awards'));
  w.d.exec('PRAGMA foreign_keys = OFF');
  w.d.prepare('UPDATE plan_baselines SET source_id = ? WHERE source_type = ?').run('99999', 'ctr_eot_awards');
  w.d.prepare('UPDATE proc_purchase_orders SET cs_id = 99999 WHERE id = ?').run(w.ids.PO);
  w.d.exec('PRAGMA foreign_keys = ON');
  const h2 = await reconcile(w);
  assert.equal(h2.trace.missing, 2, JSON.stringify(h2.trace.groups.filter((g) => g.missing)));
  assert.ok(h2.trace.pct < 100 && !h2.trace.met);
  assert.equal(h2.run.result, 'RED');
  assert.deepEqual(h2.trace.groups.filter((g) => g.missing).map((g) => g.handoff ?? g.table).sort(), ['IT-02.4', 'plan_baselines']);
});

test('AC-03 roles and safety: the CFO sees amounts, the QA lead the same differences masked, SE 403, AUD cannot run, another company and replay', async () => {
  const w = await world();
  w.d.exec('PRAGMA foreign_keys = OFF');
  fill(w.d, 'bud_commitments', { company_id: 1, org_project_id: 1, doc_ref: 'PO/T/2', amount: 100_000, consumed_amount: 70_000 });
  w.d.exec('PRAGMA foreign_keys = ON');
  const k = key('rc-replay');
  const a = await w.api.call('POST', `${R}/runs`, { ...QA, headers: k, body: {} });
  const b = await w.api.call('POST', `${R}/runs`, { ...QA, headers: k, body: {} });
  assert.equal(a.status, 202); assert.equal(b.json.data.id, a.json.data.id);
  assert.equal((await w.api.call('POST', `${R}/runs`, { ...CFO, headers: key(), body: {} })).status, 409, 'one run at a time');
  await runtimeOf(w.d).jobs.drain(5);
  const cfo = (await w.api.call('GET', R, CFO)).json.data;
  const qa = (await w.api.call('GET', R, QA)).json.data;
  assert.equal(cfo.exceptions.rows[0].difference, 700);
  assert.equal(qa.exceptions.rows[0].difference, null);
  assert.equal(qa.exceptions.rows[0].masked, true);
  assert.equal(qa.amountsVisible, false);
  assert.equal(qa.run.critical, cfo.run.critical);
  assert.equal((await w.api.call('GET', R, { roles: 'SE', user: 'se1', company: '1' })).status, 403);
  assert.equal((await w.api.call('POST', `${R}/runs`, { roles: 'AUD', user: 'aud1', company: '1', headers: key(), body: {} })).status, 403);
  assert.equal((await w.api.call('GET', R, { roles: 'AUD', user: 'aud1', company: '1' })).status, 200);
  assert.equal((await w.api.call('GET', R, { ...CFO, company: '2' })).status, 404, 'the flag is off in company 2');
  enableFlags(w.d, 2, ['ff.qa.p3002']);
  assert.equal((await w.api.call('GET', `${R}/runs/${a.json.data.id}`, { ...CFO, company: '2' })).status, 404);
  assert.equal((await w.api.call('GET', `${R}?check=NOPE`, CFO)).status, 400);
  const x = await w.api.raw('GET', `${R}/export?format=csv`, QA);
  assert.equal(x.status, 200);
  assert.ok(!x.buffer.toString('utf8').includes('700'), 'the export honours the mask');
  assert.ok(x.buffer.toString('utf8').includes('amounts masked'));
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'report' AND entity_id = 'tst.reconciliation'").get().n, 1);
  // the nightly job runs for every company with the part on and alerts
  const job = runtimeOf(w.d).jobs.enqueue('tst.recon.run', {}, { createdBy: 'system' });
  await runtimeOf(w.d).jobs.drain(5);
  assert.ok(job);
  assert.ok(w.d.prepare("SELECT 1 FROM tst_recon_runs WHERE company_id = 1 AND requested_by = 'system' AND status = 'DONE'").get(), 'the nightly run of company 1');
  assert.ok(w.d.prepare("SELECT 1 FROM core_schedules WHERE code = 'tst.recon.run'").get(), 'the nightly schedule exists');
});
