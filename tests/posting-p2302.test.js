import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { postingOf } from '../src/server/modules/fin/index.js';

// Part 23.02: the posting engine.
//  T-01 a duplicate event creates one journal; the replay's dry run equals its commit; the sub-ledgers reconcile with the ledger with no difference on the test data.
//  and: the default rules (FR-06: GRN, vendor invoice with the GST split by the state of supply), a rule change in force from its date only (BR-01), approved by the
//  CFO; the failed postings (a closed period, re-posted when it opens; no rule, ignored with a reason); rights; the posting status back to the source document.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, acc: as('ACCMGR', 'acc1'), acc2: as('ACCMGR', 'acc2'), cfo: as('CFO', 'cfo1'), it: as('ITADM', 'it1'), fin: as('FINEX', 'fin1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200); // the company's chart
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  d.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', ?) ON CONFLICT(company_id) DO UPDATE SET gstins_json = excluded.gstins_json").run(JSON.stringify([{ gstin: '36AAACM1234F1Z5', stateCode: '36' }]));
  const store = fill(d, 'inv_stores', { company_id: 1, code: 'ST-QA1', name: 'Site store', store_type: 'SITE_STORE', org_project_id: r.A, org_site_id: r.site, requested_by: 'test', store_status: 'ACTIVE' });
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'V1', 'Deccan Cement Ltd', 'Deccan', 'PUBLIC_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  let n = 0;
  const grn = (date, rupees, o = {}) => { n += 1; const id = fill(d, 'inv_grns', { company_id: 1, doc_no: `GRN/T/${n}`, received_date: date, org_project_id: r.A, store_id: store, vendor_id: vendor, total_value: rupees * 100, status: 'APPROVED', emergency: 1, emergency_why: 'test fixture', requested_by: 'test' }); fill(d, 'inv_stock_ledger', { company_id: 1, doc_no: `GRN/T/${n}`, store_id: store, item_id: 1, txn_type: 'RECEIPT', txn_date: date, qty_in: 1000, qty_out: 0, rate: rupees * 100, value: rupees * 100, balance_qty: 1000, balance_value: rupees * 100 }); return { id, data: { grnId: id, docNo: `GRN/T/${n}`, receivedOn: date, storeId: store, storeCode: 'ST-QA1', vendorId: vendor, totalValue: rupees * 100, lines: [] }, ...o }; };
  const vinv = (date, taxable, gstin = '36AABCD1234E1Z2') => { n += 1; const tax = Math.round(taxable * 18) / 100; const id = fill(d, 'bill_vendor_invoices', { company_id: 1, doc_no: `VI/T/${n}`, org_project_id: r.A, vendor_id: vendor, invoice_kind: 'PO', invoice_no: `DC/${n}`, invoice_date: date, taxable_paise: taxable * 100, tax_paise: Math.round(tax * 100), total_paise: Math.round((taxable + tax) * 100), status: 'APPROVED', requested_by: 'test' }); return { id, data: { invoiceId: id, invoiceNo: `DC/${n}`, invoiceDate: date, fy: '2026-27', kind: 'PO', projectId: r.A, vendorId: vendor, vendorGstin: gstin, taxable, tax, total: taxable + tax, debit: 0, payable: taxable + tax, matchStatus: 'MATCHED', itc: [] } }; };
  const emit = (type, entity, x) => publishEvent(d, { type, entity, entityId: x.id, actorId: 'test', companyId: 1, data: x.data });
  const drain = () => r.drain();
  const pe = postingOf(d);
  return { ...r, call, acct, store, vendor, grn, vinv, emit, drain, pe };
}

test('T-01 FR-02 FR-06 a duplicate event makes one journal; the GRN and the vendor invoice post by the default rules; the sub-ledgers reconcile with no difference', async () => {
  const w = await world();
  const g = w.grn('2026-06-10', 100000); const e1 = w.emit('inv.grn.posted', 'inv_grns', g); await w.drain();
  let log = w.d.prepare('SELECT * FROM fin_posting_log WHERE event_id = ?').get(e1.eventId); assert.equal(log.log_status, 'POSTED', log.error ?? '');
  const j = (await w.call(U.aud, 'GET', `/journals/${log.journal_id}`)).json.data;
  assert.equal(j.kind, 'ENGINE'); assert.equal(j.voucherType, 'PJ'); assert.equal(j.source.type, 'inv_grns'); assert.equal(j.total, 100000);
  assert.equal(j.lines.find((l) => l.accountId === w.acct('130001')).debit, 100000); assert.equal(j.lines.find((l) => l.accountId === w.acct('130001')).projectId, w.A, 'the project and site of the store');
  assert.equal(j.lines.find((l) => l.accountId === w.acct('240002')).credit, 100000);
  // the same event again (the bus redelivers, a handler is called twice): one journal
  w.pe.handle({ ...e1, type: 'inv.grn.posted' }); w.pe.handle({ ...e1, type: 'inv.grn.posted' });
  // a second event for the same document: the journal of the source is not made twice
  const e2 = w.emit('inv.grn.posted', 'inv_grns', g); await w.drain();
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM fin_journals WHERE source_type = 'inv_grns' AND source_id = ?").get(String(g.id)).n, 1);
  assert.equal(w.d.prepare('SELECT error_code FROM fin_posting_log WHERE event_id = ?').get(e2.eventId).error_code, 'DUPLICATE_SOURCE');
  assert.equal(w.events('fin.document.posted').length, 1); assert.equal(w.events('fin.document.posted')[0].docId, String(g.id));

  const v = w.vinv('2026-06-20', 100000); const e3 = w.emit('ap.invoice.matched', 'bill_vendor_invoices', v); await w.drain();
  log = w.d.prepare('SELECT * FROM fin_posting_log WHERE event_id = ?').get(e3.eventId); assert.equal(log.log_status, 'POSTED', log.error ?? '');
  const vj = (await w.call(U.aud, 'GET', `/journals/${log.journal_id}`)).json.data; const at = (code) => vj.lines.find((l) => l.accountId === w.acct(code));
  assert.equal(at('240002').debit, 100000); assert.equal(at('170001').debit, 9000); assert.equal(at('170002').debit, 9000); assert.equal(at('170003'), undefined, 'within the state: CGST and SGST'); assert.equal(at('220001').credit, 118000);

  const rec = (await w.call(U.acc, 'GET', '/reconciliation?asOf=2026-06-30')).json.data;
  assert.equal(rec.clean, true, JSON.stringify(rec.rows)); const row = (c) => rec.rows.find((x) => x.code === c);
  assert.equal(row('AP').subledger, 118000); assert.equal(row('AP').gl, 118000); assert.equal(row('GRNI').subledger, 0); assert.equal(row('GRNI').gl, 0); assert.equal(row('INVENTORY').gl, 100000); assert.equal(row('INVENTORY').difference, 0);
  // the rule test shows what a sample event would post, nothing written
  const before = w.d.prepare('SELECT COUNT(*) AS n FROM fin_journals').get().n;
  const t = (await w.call(U.acc, 'POST', '/posting-rules/test', { eventType: 'ap.invoice.matched', data: { ...v.data, invoiceId: 999, vendorGstin: '29AABCD1234E1Z2' } })).json.data;
  assert.equal(t.ok, true, JSON.stringify(t)); assert.equal(t.lines.find((l) => l.account.startsWith('170003')).debit, '18000.00', 'between states: IGST');
  assert.equal(w.d.prepare('SELECT COUNT(*) AS n FROM fin_journals').get().n, before);
  assert.equal((await w.call(U.aud, 'GET', '/gl/integrity')).json.data.ok, true);
});

test('T-01 FR-03 the replay of history: the dry run equals the commit; approved by the accounts manager and the CFO; the maker does not approve', async () => {
  const w = await world();
  // events emitted before the finance module was live: in the outbox, already delivered to the other consumers, never seen by the engine
  const old = [w.grn('2026-05-05', 25000), w.grn('2026-05-15', 40000.5), w.grn('2026-05-25', 1000)];
  for (const g of old) { publishEvent(w.d, { type: 'inv.grn.posted', entity: 'inv_grns', entityId: g.id, actorId: 'test', companyId: 1, data: g.data }); }
  w.d.prepare("UPDATE core_outbox SET published_at = '2026-05-31T00:00:00Z' WHERE event_type = 'inv.grn.posted'").run();
  const bad = w.vinv('2026-05-20', 5000, null); publishEvent(w.d, { type: 'ap.invoice.matched', entity: 'bill_vendor_invoices', entityId: bad.id, actorId: 'test', companyId: 1, data: bad.data });
  w.d.prepare("UPDATE core_outbox SET published_at = '2026-05-31T00:00:00Z' WHERE published_at IS NULL").run();
  const c = await w.call(U.it, 'POST', '/replays', { eventTypes: ['inv.grn.posted', 'ap.invoice.matched'], from: '2026-05-01', to: '2026-05-31' }); assert.equal(c.status, 201, JSON.stringify(c.json));
  const run = c.json.data; assert.equal(run.dryRun.events, 4); assert.equal(run.dryRun.wouldPost, 3); assert.equal(run.dryRun.total, 66000.5); assert.equal(run.dryRun.failures.SUPPLY_UNKNOWN, 1, 'tax and no GSTIN: the state of supply cannot be told');
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM fin_journals WHERE kind = 'ENGINE'").get().n, 0, 'a dry run writes nothing');
  assert.equal((await w.call(U.fin, 'POST', '/replays', { eventTypes: ['inv.grn.posted'], from: '2026-05-01', to: '2026-05-31' })).status, 403);
  assert.equal((await w.call(U.it, 'POST', `/replays/${run.id}/submit`)).status, 202);
  const wf = w.wf('fin_replay_runs', run.id);
  assert.equal((await w.act(U.acc, wf)).status, 200);
  assert.equal((await w.call(U.it, 'GET', `/replays/${run.id}`)).json.data.status, 'SUBMITTED', 'the CFO approves after the accounts manager');
  assert.equal((await w.act(U.cfo, wf)).status, 200);
  const done = (await w.call(U.it, 'GET', `/replays/${run.id}`)).json.data;
  assert.equal(done.status, 'APPROVED'); assert.deepEqual(done.result, { posted: 3, failed: 1, total: 66000.5 }, 'the commit is what the dry run said');
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM fin_journals WHERE kind = 'ENGINE'").get().n, 3);
  const again = await w.call(U.it, 'POST', '/replays', { eventTypes: ['inv.grn.posted'], from: '2026-05-01', to: '2026-05-31' }); assert.equal(again.json.data.dryRun.events, 0, 'replayed events are not replayed again');
  // the failed one waits in the queue; it is ignored with a reason
  const q = (await w.call(U.acc, 'GET', '/postings?filter[status]=FAILED')).json; assert.equal(q.data.length, 1); assert.equal(q.data[0].errorCode, 'SUPPLY_UNKNOWN');
  assert.equal((await w.call(U.fin, 'POST', `/postings/${q.data[0].id}/resolve`, { outcome: 'IGNORED', note: 'Unregistered vendor, booked by hand' })).status, 403);
  const ig = await w.call(U.acc, 'POST', `/postings/${q.data[0].id}/resolve`, { outcome: 'IGNORED', note: 'Unregistered vendor, booked by hand' }); assert.equal(ig.status, 200); assert.equal(ig.json.data.status, 'IGNORED');
});

test('FR-01 BR-01 a rule change is a new version, approved by the CFO, in force from its date only; FR-04 a closed period fails and re-posts when it opens; rights', async () => {
  const w = await world();
  const list = (await w.call(U.aud, 'GET', '/posting-rules')).json; assert.ok(list.data.length >= 9); const grnRule = list.data.find((r) => r.ruleCode === 'GRN'); assert.equal(grnRule.standard, true);
  // the company's version 2 of GRN: the inventory of a store goes to work-in-progress directly, from 01-07-2026
  const lines = [{ side: 'DR', account: '130002', amount: 'totalValue', dims: { projectId: 'storeProjectId' } }, { side: 'CR', account: '240002', amount: 'totalValue', dims: { partnerId: 'vendorId' } }];
  assert.equal((await w.call(U.cfo, 'POST', '/posting-rules', { ruleCode: 'GRN', name: 'Goods receipt straight to work-in-progress', eventType: 'inv.grn.posted', lines, effectiveFrom: '2026-07-01', reason: 'Site stores are consumed at once', backdate: true })).status, 403, 'the CFO approves, the accounts manager proposes');
  const bad = await w.call(U.acc, 'POST', '/posting-rules', { ruleCode: 'GRN', name: 'Wrong', eventType: 'inv.grn.posted', lines: [{ side: 'DR', account: '999999', amount: 'totalValue' }, { side: 'CR', account: '240002', amount: 'totalValue *' }], effectiveFrom: '2026-07-01', reason: 'Bad one for the test', backdate: true });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.details.some((p) => p.field === 'lines.0.account')); assert.ok(bad.json.error.details.some((p) => p.field === 'lines.1.amount'));
  const v2 = await w.call(U.acc, 'POST', '/posting-rules', { ruleCode: 'GRN', name: 'Goods receipt straight to work-in-progress', eventType: 'inv.grn.posted', lines, narration: 'GRN {docNo} to WIP', voucherType: 'PJ', effectiveFrom: '2026-07-01', reason: 'Site stores are consumed at once', backdate: true });
  assert.equal(v2.status, 201, JSON.stringify(v2.json)); assert.equal(v2.json.data.version, 2); assert.equal(v2.json.data.status, 'DRAFT');
  assert.equal((await w.call(U.acc, 'POST', `/posting-rules/${v2.json.data.id}/submit`)).status, 202);
  assert.equal((await w.act(U.cfo, w.wf('fin_posting_rules', v2.json.data.id))).status, 200);
  assert.equal((await w.call(U.acc, 'GET', `/posting-rules/${v2.json.data.id}`)).json.data.status, 'APPROVED');
  const june = w.grn('2026-06-28', 500); const july = w.grn('2026-07-02', 700);
  w.emit('inv.grn.posted', 'inv_grns', june); w.emit('inv.grn.posted', 'inv_grns', july); await w.drain();
  const jOf = (g) => w.d.prepare("SELECT * FROM fin_journal_lines WHERE journal_id = (SELECT id FROM fin_journals WHERE source_type = 'inv_grns' AND source_id = ?) AND debit_paise > 0").get(String(g.id));
  assert.equal(jOf(june).account_id, w.acct('130001'), 'an event before the new version keeps the old rule');
  assert.equal(jOf(july).account_id, w.acct('130002'), 'from its date the new version');
  // a closed period: the posting fails, waits, and posts once the period is open again
  w.d.prepare("UPDATE core_periods SET module_status_json = '{\"finance\":\"Closed\"}' WHERE company_id = 1 AND '2026-08-05' BETWEEN start_date AND end_date").run();
  const aug = w.grn('2026-08-05', 300); const ea = w.emit('inv.grn.posted', 'inv_grns', aug); await w.drain();
  const failed = w.d.prepare('SELECT * FROM fin_posting_log WHERE event_id = ?').get(ea.eventId); assert.equal(failed.log_status, 'FAILED'); assert.equal(failed.error_code, 'PERIOD_CLOSED');
  const sum = (await w.call(U.acc, 'GET', '/postings/summary')).json.data; assert.equal(sum.counts.FAILED, 1);
  assert.equal((await w.call(U.fin, 'POST', `/postings/${failed.id}/repost`)).status, 403);
  assert.equal((await w.call(U.acc, 'POST', `/postings/${failed.id}/repost`)).json.data.status, 'FAILED', 'still closed');
  w.d.prepare("UPDATE core_periods SET module_status_json = '{}' WHERE company_id = 1 AND '2026-08-05' BETWEEN start_date AND end_date").run();
  const re = (await w.call(U.acc, 'POST', `/postings/${failed.id}/repost`)).json.data; assert.equal(re.status, 'POSTED'); assert.equal(re.attempts, 3); assert.ok(re.journalId);
  // rights
  assert.equal((await w.call(U.se, 'GET', '/postings')).status, 403); assert.equal((await w.call(U.se, 'GET', '/posting-rules')).status, 403); assert.equal((await w.call(U.fin, 'GET', '/reconciliation')).status, 200);
  assert.equal((await w.call(U.aud, 'GET', '/gl/integrity')).json.data.ok, true);
});

test('PACK-23 stock ledger = GL inventory: a receipt and an issue post by the default rules and the inventory row reconciles to the paisa (an outgoing value is negative in the stock ledger)', async () => {
  const w = await world(); const d = w.d;
  const g = w.grn('2026-06-10', 100000); w.emit('inv.grn.posted', 'inv_grns', g); await w.drain();
  // an issue of ₹ 30,000.50 to the project out of the store: the stock ledger keeps it as a negative value
  const issue = fill(d, 'inv_issues', { company_id: 1, doc_no: 'ISS/T/1', issue_date: '2026-06-15', org_project_id: w.A, store_id: w.store, issue_type: 'OWN_CREW', issued_to_type: 'CREW', issued_to_name: 'Masons gang', requested_by: 'test', status: 'APPROVED', total_value: 3_000_050 });
  fill(d, 'inv_stock_ledger', { company_id: 1, doc_no: 'ISS/T/1', store_id: w.store, item_id: 1, txn_type: 'ISSUE', txn_date: '2026-06-15', qty_in: 0, qty_out: 300, rate: 10_000_17, value: -3_000_050, balance_qty: 700, balance_value: 6_999_950, source_type: 'inv_issue', source_id: String(issue) });
  const e = w.emit('inv.issue.posted', 'inv_issues', { id: issue, data: { issueId: issue, docNo: 'ISS/T/1', issueDate: '2026-06-15', type: 'OWN_CREW', storeId: w.store, projectId: w.A, totalValue: 3_000_050, recoverableValue: 0 } }); await w.drain();
  assert.equal(d.prepare('SELECT log_status FROM fin_posting_log WHERE event_id = ?').get(e.eventId).log_status, 'POSTED');
  const rec = (await w.call(U.acc, 'GET', '/reconciliation?asOf=2026-06-30')).json.data; const inv = rec.rows.find((x) => x.code === 'INVENTORY');
  assert.deepEqual([inv.subledger, inv.gl, inv.difference], [69_999.5, 69_999.5, 0], '₹ 1,00,000 received less ₹ 30,000.50 issued, in both');
  const stockValue = d.prepare('SELECT SUM(value) AS v FROM inv_stock_ledger WHERE company_id = 1').get().v; assert.equal(stockValue, 6_999_950, 'the stock ledger running value');
});
