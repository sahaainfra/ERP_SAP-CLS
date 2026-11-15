import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, approvedContract, as, contractBody, fill, key, ready } from './ctr-helpers.js';
import { billOf } from '../src/server/modules/bill/index.js';
import { fyOf } from '../src/server/modules/bill/invoice.js';

// Part 22.03: the client RA bill from the certified measurements: previous + this = cumulative (T-01), the deductions of the contract terms and the statutory ones with their worked example, GST, the approvals, the marking of the billed measurements and the advance ledger, milestone and escalation bills, and the sending to the client.
const U = { ...BASE, mse: as('SE', 'mse1'), qs2: as('QS', 'qs2') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const B = '/api/v1/bill';
async function world(o = {}) {
  const r = await ready(opened, { baseline: true }); const d = r.d; const bc = (who, method, path, body) => r.api.call(method, `${B}${path}`, { ...who, headers: key(), body });
  d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run('qs2', 'qs2', JSON.stringify(['QS']), 'qs2@example.com');
  const copts = { original: o.original ?? 1_000_000, contractType: o.type ?? 'ITEM_RATE', pvcApplicable: o.pvc ?? true }; let k;
  if (o.milestones) { const c = await r.call(U.com, 'POST', '/contracts', contractBody(r, copts)); assert.equal(c.status, 201, JSON.stringify(c.json)); const cid = c.json.data.id; for (const m of o.milestones) { const mr = await r.call(U.com, 'POST', `/contracts/${cid}/milestones`, m); assert.equal(mr.status, 201, JSON.stringify(mr.json)); } assert.equal((await r.call(U.com, 'POST', `/contracts/${cid}/submit`)).status, 202); const wf0 = r.wf('ctr_contracts', cid); for (const who of [U.com2, U.pd, U.dir]) assert.equal((await r.act(who, wf0)).status, 200); k = (await r.call(U.com, 'GET', `/contracts/${cid}`)).json.data; } else k = await approvedContract(r, copts);
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: r.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  const item = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 500_000, rate: 60_000_000, amount: 0 }); const item2 = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.2', description: 'Reinforcement steel', uom: 'MT', qty: 500_000, rate: 600_000_000, amount: 0 });
  const loc = fill(d, 'proj_locations', { company_id: 1, project_id: r.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' });
  const own = [{ stateCode: '27', gstin: '27AAACC1234A1Z5', tradeName: 'CLS Mumbai' }, { stateCode: '29', gstin: '29AAACC1234A1Z3', tradeName: 'CLS Bengaluru' }];
  if (d.prepare('SELECT 1 FROM core_company_settings WHERE company_id = 1').get()) d.prepare('UPDATE core_company_settings SET gstins_json = ? WHERE company_id = 1').run(JSON.stringify(own)); else fill(d, 'core_company_settings', { company_id: 1, legal_name: 'CLS', gstins_json: JSON.stringify(own) });
  for (const [st, g] of [['27', '27AAAGS9999B1ZX'], ['29', '29AAAGS9999B1ZV']]) fill(d, 'mdm_partner_gstins', { company_id: 1, partner_id: r.client, state_code: st, gstin: g, gstin_status: 'ACTIVE' });
  const w = { ...r, bc, k, ver, item, item2, loc, sc: billOf(d).svc };
  w.cert = async (line, qty) => { const m = (await bc(U.mse, 'POST', '/mb-entries', { projectId: r.A, boqLineId: line, locationId: loc, description: 'Measured', template: 'QTY', qty, measuredOn: day(-1) })).json.data; assert.equal((await bc(U.mse, 'POST', `/mb-entries/${m.id}/submit`)).status, 202); const wf = r.wf('bill_mb_entries', m.id); for (const who of [U.qs, U.pm]) assert.equal((await r.act(who, wf)).status, 200); return m.id; };
  w.approve = async (id) => { assert.equal((await bc(U.qs, 'POST', `/client-bills/${id}/submit`)).status, 202); const wf = r.wf('bill_client_bills', id); for (const who of [U.qs2, U.pm, U.com]) { const a = await r.act(who, wf); assert.equal(a.status, 200, JSON.stringify(a.json)); } return (await bc(U.qs, 'GET', `/client-bills/${id}`)).json.data; };
  w.sendBill = async (id) => { const s = await bc(U.com, 'POST', `/client-bills/${id}/send`, { sentOn: day(0), clientRef: 'RA/1' }); assert.equal(s.status, 200, JSON.stringify(s.json)); };
  w.fullBill = async () => { await w.cert(item, 20); await w.cert(item2, 5); const b = (await bc(U.qs, 'POST', '/client-bills', { projectId: r.A, contractId: k.id, billType: 'RA', periodFrom: day(-30), periodTo: day(0), supply: 'intra', manual: [{ kind: 'WATER_ELECTRICITY', amount: 1500, reason: 'Water used by the contractor' }] })).json.data; await w.approve(b.id); await w.sendBill(b.id); return b; };
  w.certify = async (billId, items, extra = {}) => bc(U.qs, 'POST', '/certifications', { billId, certNo: extra.certNo ?? `CERT/${Math.random().toString(36).slice(2, 6)}`, certDate: day(0), items, ...extra });
  w.approveCert = async (id, who = [U.qs2]) => { assert.equal((await bc(U.qs, 'POST', `/certifications/${id}/submit`)).status, 202); const wf = r.wf('bill_certifications', id); for (const u of who) assert.equal((await r.act(u, wf)).status, 200); return (await bc(U.qs, 'GET', `/certifications/${id}`)).json.data; };
  return w;
}

const fy = fyOf(day(0));
test('FR-01 T-01 the client certifies less than was submitted: the differences with reasons, the certified deductions and GST, the disputed quantity carried forward', async () => {
  const w = await world(); const b = await w.fullBill();
  assert.equal((await w.bc(U.mse, 'GET', `/certifications/submitted?billId=${b.id}`)).status, 403);
  const sub = (await w.bc(U.qs, 'GET', `/certifications/submitted?billId=${b.id}`)).json.data; assert.deepEqual([sub.items.length, sub.bill.gross, sub.deductions.map((d) => d.kind).sort()], [2, 420_000, ['CESS', 'GST_TDS', 'RETENTION', 'TDS', 'WATER_ELECTRICITY']]);
  assert.equal((await w.certify(b.id, [{ lineNo: 1, certifiedQty: 25 }])).status, 400, 'more than submitted'); assert.equal((await w.certify(b.id, [{ lineNo: 1, certifiedQty: 18 }])).status, 400, 'a difference needs its reason'); assert.equal((await w.bc(U.mse, 'POST', '/certifications', { billId: b.id, certNo: 'X', certDate: day(0) })).status, 403);
  assert.equal((await w.bc(U.qs, 'POST', '/certifications', { billId: b.id, certNo: 'X', certDate: day(-60) })).status, 400, 'not before it was sent');
  const items = [{ lineNo: sub.items.find((i) => i.code === '2.1').lineNo, certifiedQty: 18, reason: 'Two cubic metres rejected for honeycombing', carryForward: true }];
  const c = await w.certify(b.id, items, { certNo: 'CERT/RA1' }); assert.equal(c.status, 201, JSON.stringify(c.json)); const x = c.json.data;
  assert.deepEqual([x.submittedGross, x.certifiedGross, x.diffGross, x.diffPct, x.bigDiff, x.disputed], [420_000, 408_000, 12_000, 2.87, false, 12_000]);
  const d = (k) => x.deductions.find((y) => y.kind === k); assert.deepEqual([d('RETENTION').certified, d('CESS').certified, d('TDS').certified, d('GST_TDS').certified, d('WATER_ELECTRICITY').certified], [20_400, 4_080, 8_160, 8_160, 1_500], 'the percentages follow the certified value'); assert.deepEqual([d('RETENTION').submitted], [21_000]);
  assert.deepEqual([x.certifiedTaxable, x.cgst, x.sgst, x.certifiedGst, x.certifiedDeductions, x.certifiedNet], [408_000, 36_720, 36_720, 73_440, 42_300, 439_140]); assert.equal(x.items.find((i) => i.code === '2.1').carryForward, true);
  assert.equal((await w.certify(b.id, [])).status, 409, 'one certification for a bill'); assert.equal((await w.certify(b.id, [], { certNo: 'CERT/RA1' })).status, 409);
  // the client made one more deduction and changed one: each with its reason
  const up = await w.bc(U.qs, 'PATCH', `/certifications/${x.id}`, { deductions: [{ kind: 'TDS', certified: 8_000, reason: 'TDS at the lower rate certificate' }, { kind: 'OTHER', label: 'Test charges', certified: 2_000, reason: 'Third-party cube tests charged' }], rowVersion: x.version }); assert.equal(up.status, 200, JSON.stringify(up.json)); const u = up.json.data; assert.deepEqual([u.deductions.find((y) => y.kind === 'TDS').certified, u.deductions.find((y) => y.kind === 'OTHER').added, u.certifiedDeductions, u.items.length], [8_000, true, 44_140, 2], 'a partial update keeps the items');
  assert.equal((await w.bc(U.qs, 'PATCH', `/certifications/${x.id}`, { deductions: [{ kind: 'CESS', certified: 1 }] })).status, 400, 'a changed deduction needs its reason');
  const ap = await w.approveCert(x.id); assert.deepEqual([ap.status, ap.bigDiff], ['APPROVED', false]); await w.drain(); const ev = w.events('bill.client.certified'); assert.deepEqual([ev.length, ev[0].certNo, ev[0].certifiedNet, ev[0].retention, ev[0].disputed, ev[0].dueDate], [1, 'CERT/RA1', ap.certifiedNet, 20_400, 12_000, ev[0].dueDate]);
  assert.equal((await w.bc(U.qs, 'PATCH', `/certifications/${x.id}`, { notes: 'late' })).status, 409); assert.equal((await w.bc(U.qs, 'POST', `/certifications/${x.id}/amend`, { reason: 'Change the quantities' })).status, 422); assert.equal((await w.bc(U.qs, 'GET', `/certifications/${x.id}/print`)).status, 200);
});

test('workflow a difference beyond 5% needs the commercial manager as well as the QS', async () => {
  const w = await world(); const b = await w.fullBill(); const c = (await w.certify(b.id, [{ lineNo: 1, certifiedQty: 10, reason: 'Only half the footings were accepted' }])).json.data; assert.deepEqual([c.diffPct, c.bigDiff], [14.33, true]);
  assert.equal((await w.bc(U.qs, 'POST', `/certifications/${c.id}/submit`)).status, 202); const wf = w.wf('bill_certifications', c.id); assert.equal((await w.act(U.qs2, wf)).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/certifications/${c.id}`)).json.data.status, 'SUBMITTED', 'waits for the commercial manager'); assert.equal((await w.act(U.com, wf)).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/certifications/${c.id}`)).json.data.status, 'APPROVED');
});

test('FR-02 FR-03 BR-01 the tax invoice: GSTIN, place of supply, SAC, tax breakup; the number is issued without a gap for each GSTIN and financial year, also when approved at once; a cancelled number is not used again; the IRN; the receivable is handed on', async () => {
  const w = await world(); const b = await w.fullBill(); const c = (await w.certify(b.id, [])).json.data; await w.approveCert(c.id);
  const inv = (o = {}) => w.bc(U.qs, 'POST', '/tax-invoices', { certificationId: c.id, gstinFrom: '27AAACC1234A1Z5', gstinTo: '27AAAGS9999B1ZX', ...o });
  assert.equal((await w.bc(U.mse, 'POST', '/tax-invoices', { certificationId: c.id, gstinFrom: '27AAACC1234A1Z5', gstinTo: '27AAAGS9999B1ZX' })).status, 403); assert.equal((await inv({ gstinFrom: 'BAD' })).status, 400); assert.equal((await inv({ gstinFrom: '33AAACC1234A1Z4' })).status, 400, 'not a GSTIN of the company'); assert.equal((await inv({ gstinTo: '27AAAGS0000B1Z1' })).status, 400, 'not a GSTIN of the client'); assert.equal((await inv({ total: 1 })).status, 400);
  const o = (await w.bc(U.qs, 'GET', '/tax-invoices/options')).json.data; assert.deepEqual([o.basis, o.sources.length, o.ownGstins.length, o.sac], ['CERTIFICATION', 1, 2, '9954']);
  const pv = (await w.bc(U.qs, 'POST', '/tax-invoices/preview', { certificationId: c.id, gstinFrom: '27AAACC1234A1Z5', gstinTo: '29AAAGS9999B1ZV' })).json.data; assert.deepEqual([pv.supply, pv.placeState, pv.igst, pv.cgst, pv.total], ['inter', '29', 75_600, 0, 495_600], 'between states: IGST on 420,000');
  const i = (await inv()).json.data; assert.deepEqual([i.status, i.supply, i.taxable, i.cgst, i.sgst, i.igst, i.total, i.sacCode, i.invoiceNo, i.irnState], ['DRAFT', 'intra', 420_000, 37_800, 37_800, 0, 495_600, '9954', null, 'NONE']); assert.equal((await inv()).status, 409, 'one invoice for a bill');
  assert.equal((await w.bc(U.qs, 'POST', `/tax-invoices/${i.id}/submit`)).status, 202); const wf = w.wf('bill_tax_invoices', i.id); assert.equal((await w.act(U.acc, wf)).status, 200); const x = (await w.bc(U.acc, 'GET', `/tax-invoices/${i.id}`)).json.data;
  assert.deepEqual([x.status, x.invoiceNo, x.fy, x.irnState, x.arState, x.invoiceDate], ['APPROVED', `27/${fy}/00001`, fy, 'PENDING', 'HANDED', day(0)]); assert.ok(x.invoiceNo.length <= 16, 'an invoice number has at most 16 characters');
  await w.drain(); const ev = w.events('bill.invoice.issued'); assert.deepEqual([ev.length, ev[0].invoiceNo, ev[0].total, ev[0].irnRequired, ev[0].dueDate], [1, x.invoiceNo, 495_600, true, x.dueDate]);
  assert.equal((await w.bc(U.qs, 'PATCH', `/tax-invoices/${i.id}`, { description: 'x' })).status, 409); assert.equal((await w.bc(U.qs, 'POST', `/tax-invoices/${i.id}/amend`, { reason: 'Change the value' })).status, 422);
  // the IRN
  assert.equal((await w.bc(U.qs, 'POST', `/tax-invoices/${i.id}/irn`, { irn: 'a'.repeat(64), ackNo: '1', ackDate: day(0) })).status, 403); assert.equal((await w.bc(U.acc, 'POST', `/tax-invoices/${i.id}/irn`, { irn: 'zz', ackNo: '1', ackDate: day(0) })).status, 400); const irn = 'ab'.repeat(32); const r2 = await w.bc(U.acc, 'POST', `/tax-invoices/${i.id}/irn`, { irn, ackNo: '112200334455', ackDate: day(0) }); assert.deepEqual([r2.status, r2.json.data.irnState, r2.json.data.can.cancel], [200, 'GENERATED', false]);
  assert.equal((await w.bc(U.acc, 'POST', `/tax-invoices/${i.id}/cancel`, { reason: 'Wrong value shown' })).status, 422, 'after the IRN only a credit note'); assert.equal((await w.bc(U.acc, 'POST', `/tax-invoices/${i.id}/irn`, { irn, ackNo: '1', ackDate: day(0) })).status, 422);
  // the receivable of 23.05 links itself once
  assert.deepEqual(w.sc.taxInvoices.linkReceivable(1, { invoiceId: i.id, arRef: 'AR/1' }), { replay: false }); assert.deepEqual(w.sc.taxInvoices.linkReceivable(1, { invoiceId: i.id, arRef: 'AR/1' }), { replay: true });
  assert.equal((await w.bc(U.acc, 'GET', `/tax-invoices/${i.id}/print`)).status, 200); assert.equal((await w.bc(U.acc, 'GET', '/tax-invoices/export')).status, 200);
});

test('T-01 the invoice numbers are gapless for each GSTIN and year when many are approved together; a cancelled number is kept and not reused; the two GSTINs count separately', async () => {
  const w = await world(); const make = (n, gst) => { const bid = fill(w.d, 'bill_client_bills', { company_id: 1, doc_no: `CB/${n}`, bill_no: `B/${n}`, org_project_id: w.A, contract_id: w.k.id, seq_no: 100 + n, period_from: day(-30), period_to: day(-1), status: 'APPROVED', client_state: 'SENT', sent_on: day(0), taxable_paise: 100_000, gst_pct_bp: 1800, net_paise: 100_000, supply: 'intra' }); const cid = fill(w.d, 'bill_certifications', { company_id: 1, doc_no: `CE/${n}`, cert_no: `C/${n}`, org_project_id: w.A, contract_id: w.k.id, bill_id: bid, cert_date: day(0), certified_taxable_paise: 100_000, status: 'APPROVED', due_date: day(30) }); return { cid, gst }; };
  const ids = []; for (let n = 1; n <= 5; n += 1) { const { cid } = make(n); const r = await w.bc(U.qs, 'POST', '/tax-invoices', { certificationId: cid, gstinFrom: n === 5 ? '29AAACC1234A1Z3' : '27AAACC1234A1Z5', gstinTo: n === 5 ? '29AAAGS9999B1ZV' : '27AAAGS9999B1ZX' }); assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal((await w.bc(U.qs, 'POST', `/tax-invoices/${r.json.data.id}/submit`)).status, 202); ids.push(r.json.data.id); }
  const res = await Promise.all(ids.map((id) => w.act(U.acc, w.wf('bill_tax_invoices', id)))); assert.deepEqual(res.map((x) => x.status), [200, 200, 200, 200, 200]);
  const nos = ids.map((id) => w.d.prepare('SELECT invoice_no, gstin_from, seq_no FROM bill_tax_invoices WHERE id = ?').get(id)); const mum = nos.filter((x) => x.gstin_from.startsWith('27')).map((x) => x.seq_no).sort((a, b) => a - b); assert.deepEqual(mum, [1, 2, 3, 4], 'no gap, no duplicate'); assert.deepEqual(nos.filter((x) => x.gstin_from.startsWith('29')).map((x) => [x.seq_no, x.invoice_no]), [[1, `29/${fy}/00001`]], 'another GSTIN has its own series');
  // a cancelled number stays used; the next one follows
  assert.equal((await w.bc(U.acc, 'POST', `/tax-invoices/${ids[1]}/cancel`, { reason: 'Issued to the wrong site' })).status, 200); const gone = w.d.prepare('SELECT status, invoice_no FROM bill_tax_invoices WHERE id = ?').get(ids[1]); assert.equal(gone.status, 'CANCELLED'); assert.ok(gone.invoice_no, 'the number is kept');
  const { cid } = make(6); const n6 = (await w.bc(U.qs, 'POST', '/tax-invoices', { certificationId: cid, gstinFrom: '27AAACC1234A1Z5', gstinTo: '27AAAGS9999B1ZX' })).json.data; await w.bc(U.qs, 'POST', `/tax-invoices/${n6.id}/submit`); await w.act(U.acc, w.wf('bill_tax_invoices', n6.id)); assert.equal(w.d.prepare('SELECT seq_no FROM bill_tax_invoices WHERE id = ?').get(n6.id).seq_no, 5, 'the cancelled number 2 is not reused'); assert.equal(w.d.prepare("SELECT last_seq FROM bill_invoice_counters WHERE gstin = '27AAACC1234A1Z5'").get().last_seq, 5);
  assert.equal(fyOf('2027-03-31'), '26-27'); assert.equal(fyOf('2027-04-01'), '27-28');
  // one number is never taken twice (unique per GSTIN, year and number)
  assert.throws(() => w.d.prepare("UPDATE bill_tax_invoices SET seq_no = 1 WHERE id = ?").run(ids[2]), /UNIQUE/);
});

test('FR-05 the submitted against certified analysis by project; roles, scope and the flag', async () => {
  const w = await world(); const b = await w.fullBill(); const c = (await w.certify(b.id, [{ lineNo: 1, certifiedQty: 18, reason: 'Two cubic metres rejected', carryForward: true }])).json.data; await w.approveCert(c.id);
  const a = (await w.bc(U.qs, 'GET', `/cert-analysis?projectId=${w.A}`)).json.data; assert.deepEqual([a.rows.length, a.rows[0].submittedGross, a.rows[0].certifiedGross, a.rows[0].diffGross, a.rows[0].diffPct, a.totals.certified, a.totals.waiting, a.totals.disputed, a.rows[0].daysToCertify], [1, 420_000, 408_000, 12_000, 2.87, 1, 0, 12_000, 0]);
  assert.deepEqual([(await w.bc(U.pd, 'GET', `/cert-analysis?projectId=${w.A}`)).status, (await w.bc(U.xcli, 'GET', `/cert-analysis?projectId=${w.A}`)).status, (await w.bc(U.pd, 'POST', '/certifications', { billId: b.id, certNo: 'N', certDate: day(0) })).status, (await w.bc(U.com, 'GET', '/certifications')).status, (await w.bc(U.acc, 'GET', '/certifications')).status, (await w.bc(U.xcli, 'GET', '/tax-invoices')).status], [200, 403, 403, 200, 200, 403]);
  assert.equal((await w.bc(U.qs, 'GET', '/certifications/export')).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/cert-analysis?projectId=${w.A}&differencesOnly=true`)).json.data.rows.length, 1);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bill.p2204'").run(); assert.equal((await w.bc(U.qs, 'GET', '/certifications')).status, 404); assert.equal((await w.bc(U.qs, 'GET', '/tax-invoices')).status, 404); assert.equal((await w.bc(U.qs, 'GET', '/client-bills')).status, 200, 'the client bills are a flag of their own');
});
