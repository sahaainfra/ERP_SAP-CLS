import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { computeLine, supplyOf } from '../src/server/modules/proc/po.js';

// Part 15.05: purchase orders, amendments, short-close.
// T-01 a tokenised vendor link expires and cannot be used again once the quotation is submitted; T-02 the landed rate is right with GST left out when recoverable.
// Worked example (T-02): 10 units at ₹ 100 less 10 % = ₹ 90 a unit = ₹ 900, plus ₹ 50 freight = ₹ 950 (₹ 95.00 a unit) with GST of 18 % recoverable; ₹ 1,121 (₹ 112.10 a unit) when it is not.
const P = '/api/v1/proc'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `rfq-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const ic = as('PROCIC', 'csic1'); const mgr = as('PROCMGR', 'csmgr1'); const sysu = as('SYSADM', 'cssys1'); const pm = as('PM', 'cspm1'); const se = as('SE', 'csse1'); const com = as('COMMGR', 'cscom1'); const cfo = as('CFO', 'cscfo1'); const sk = as('SK', 'cssk1'); const other = as('PROCIC', 'csicx', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['csic1', ['PROCIC']], ['csmgr1', ['PROCMGR']], ['csmgr2', ['PROCMGR']], ['cspd1', ['PD']], ['cspm1', ['PM']], ['csse1', ['SE']], ['csdir1', ['DIR']], ['cscom1', ['COMMGR']], ['cscfo1', ['CFO']], ['cssk1', ['SK']], ['cssys1', ['SYSADM']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CS1', 'RFQ tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CS2', 'RFQ other', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const s1 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'C-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'CEMENT', 'Cement', 'CST', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, uom) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (1, ?, ?, 'MATERIAL', ?, ?, '2026-01-01', 'ACTIVE', 38000)").run(code, name, cat, uom).lastInsertRowid);
  const cement = item('RF-CEM', 'Cement OPC 53', 'bag'); const steel = item('RF-STL', 'TMT 12 mm', 'kg');
  const partner = (code, name, status = 'ACTIVE', cats = '["CEMENT"]', email = `${code.toLowerCase()}@vendor.example`) => { const id = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'PROCMGR', 'test')").run(code, name, name, status).lastInsertRowid); d.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, created_by) VALUES (1, ?, 'VENDOR', ?, 'test')").run(id, cats); d.prepare('INSERT INTO mdm_partner_contacts (company_id, partner_id, name, email, mobile, is_primary, created_by) VALUES (1, ?, ?, ?, ?, 1, ?)').run(id, name, email, '9812345678', 'test'); return id; };
  const v1 = partner('V-ONE', 'Ambuja Traders'); const v2 = partner('V-TWO', 'Birla Dealers'); const v3 = partner('V-THREE', 'Core Suppliers'); const v4 = partner('V-FOUR', 'Dalmia Stockists'); const hold = partner('V-HOLD', 'On Hold Ltd', 'ON_HOLD'); const black = partner('V-BLK', 'Blacklisted Ltd', 'BLACKLISTED'); const steelOnly = partner('V-STEEL', 'Steel Only Ltd', 'ACTIVE', '["STEEL"]');
  /** An approved requisition: 1000 bags of cement at ₹ 380 (₹ 3.8 lakh) and 500 kg of steel at ₹ 65, or a small one. */
  const pr = (over = {}, status = 'APPROVED', projectId = pid) => {
    const id = Number(d.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (1, ?, ?, ?, ?, 'DIRECT', 'csse1', ?, ?, ?, 'test')").run(over.docNo ?? `PR/T/${(seq += 1)}`, TODAY, projectId, s1, plus(30), status, over.total ?? 38_000_000 + 3_250_00).lastInsertRowid);
    const line = (no, it, qty, uom, rate) => Number(d.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, 'test')").run(id, no, it, qty, uom, rate, Math.round(qty * rate / 1000), plus(30), s1, qty).lastInsertRowid);
    const small = over.small; return { id, l1: line(1, cement, small ? 10_000 : 1_000_000, 'bag', small ? 10_000 : 38_000), l2: small ? null : line(2, steel, 500_000, 'kg', 6_500) };
  };
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => { const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: action === 'approve' ? 'Fine, approved' : 'Not convincing enough to justify the choice' } }); };
  const rfq = async (over = {}, vendors = [v1, v2, v3], lineIds = null, who = ic) => { const p = lineIds ? null : pr(over.pr ?? {}); const b = { projectId: pid, title: 'Cement and steel for the slab', dueDate: plus(7), terms: { delivery: 'Within 10 days at site', payment: '30 days', validityDays: 30 }, lines: (lineIds ?? [p.l1, p.l2].filter(Boolean)).map((x) => ({ prLineId: x })), vendors: vendors.map((v) => ({ vendorId: v, channel: 'EMAIL' })), ...over.body }; const c = await call(who, 'POST', '/rfqs', b); assert.equal(c.status, 201, JSON.stringify(c.json)); return { ...c.json.data, p }; };
  const pub = async (method, token, path = '', body) => { const res = await fetch(`${api.base}/api/v1/proc/vendor-quote/${token}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => ({})) }; };
  const tokenOf = (links, vendorId) => links.find((l) => l.vendorId === vendorId).url.split('token=')[1];
  return { api, d, pid, pid2, s1, cement, steel, v1, v2, v3, v4, hold, black, steelOnly, pr, call, act, rfq, pub, tokenOf };
}


async function withQuotes() {
  const r = await ready(); const m = await r.rfq({}, [r.v1, r.v2, r.v3]); await r.call(ic, 'POST', `/rfqs/${m.id}/issue`); const [l1, l2] = m.lines.map((l) => l.id);
  const q = async (vendor, cement, cq, steel, days) => { const c = await r.call(ic, 'POST', '/quotations', { rfqId: m.id, vendorId: vendor, validUntil: plus(30), deliveryDays: days, lines: [{ rfqLineId: l1, rate: cement, offeredQty: cq, gstRate: 18 }, { rfqLineId: l2, rate: steel, gstRate: 18 }] }); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal((await r.call(ic, 'POST', `/quotations/${c.json.data.id}/submit`)).status, 200); return c.json.data.id; };
  const qs = { v1: await q(r.v1, 400, 1000, 70, 7), v2: await q(r.v2, 390, 600, 72, 5), v3: await q(r.v3, 400, 1000, 68, 3) };
  const create = (over = {}, who = ic) => r.call(who, 'POST', '/comparative-statements', { rfqId: m.id, ...over });
  return { ...r, m, l1, l2, qs, create };
}
const approveAll = async (r, inst, who = [mgr, pm]) => { for (const w of who) { const res = await r.act(w, inst); assert.equal(res.status, 200, JSON.stringify(res.json)); } };


test('T-03 BR-03 CGST and SGST inside a state, IGST across states; the line figures balance', () => {
  assert.equal(supplyOf('27', '27'), 'INTRA'); assert.equal(supplyOf('29', '27'), 'INTER'); assert.equal(supplyOf(null, '27'), 'NONE');
  assert.deepEqual(computeLine({ qty: 600000, rate: 39000, gstPct: 180000, supply: 'INTRA' }), { basic: 23_400_000, freight: 0, cgst: 2_106_000, sgst: 2_106_000, igst: 0, tax: 4_212_000, line: 27_612_000 });
  assert.deepEqual(computeLine({ qty: 400000, rate: 40000, discountPct: 50000, gstPct: 180000, supply: 'INTER', freight: 10000 }), { basic: 15_200_000, freight: 10000, cgst: 0, sgst: 0, igst: 2_736_000, tax: 2_736_000, line: 17_946_000 });
  assert.equal(computeLine({ qty: 1000, rate: 101, gstPct: 50000, supply: 'INTRA' }).cgst, computeLine({ qty: 1000, rate: 101, gstPct: 50000, supply: 'INTRA' }).sgst, 'the pair is equal');
});

async function approvedCs() {
  const r = await withQuotes(); const c = (await r.create({ recommendationType: 'SPLIT_L1' })).json.data; const sub = await r.call(ic, 'POST', `/comparative-statements/${c.id}/submit`); await approveAll(r, sub.json.data.workflowInstanceId);
  r.d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'cspm1', 'test')").run(r.pid);
  for (const [v, st, g] of [[r.v1, '27', '27AAAAA0000A1Z5'], [r.v2, '27', '27BBBBB0000B1Z5'], [r.v3, '29', '29CCCCC0000C1Z5']]) r.d.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, state_code, gstin, created_by) VALUES (1, ?, ?, ?, 'test')").run(v, st, g);
  const terms = { deliveryAddress: 'Tower site, Pune', deliveryStateCode: '27', paymentTerms: '30 days from receipt', advancePct: 20, creditDays: 30, priceBasis: 'FOR_SITE', warrantyTerms: '12 months', ldTerms: '0.5% a week up to 5%' };
  const po = async (vendor, over = {}, who = ic) => { const x = await r.call(who, 'POST', '/purchase-orders', { projectId: r.pid, source: 'CS', csId: c.id, vendorId: vendor, terms, ...over }); return x; };
  const approvePo = async (id, who = [mgr]) => { const s = await r.call(ic, 'POST', `/purchase-orders/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); for (const w of who) assert.equal((await r.act(w, s.json.data.workflowInstanceId)).status, 200); return s.json.data; };
  const committed = () => r.d.prepare("SELECT COALESCE(SUM(amount - consumed_amount - released_amount), 0) AS n FROM bud_commitments WHERE src_type = 'proc_po'").get().n;
  const link = async (id) => { const x = await r.call(ic, 'POST', `/purchase-orders/${id}/resend`); assert.equal(x.status, 200, JSON.stringify(x.json)); return x.json.data.url.split('token=')[1]; };
  const pub = async (method, token, path = '', body) => { const res = await fetch(`${r.api.base}/api/v1/proc/vendor-po/${token}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => ({})) }; };
  const drain = () => runtimeOf(r.d).bus.drain();
  return { ...r, drain, cs: c, terms, po, approvePo, committed, link, pub };
}

test('T-01 FR-01 FR-03 FR-04 FR-07 the order from the statement keeps the rates; GST by the place of supply; approval commits and sends; an amendment is compared, approved and moves the commitment', async () => {
  const r = await approvedCs(); const bad = await r.po(r.v1); assert.equal(bad.status, 400, 'V1 was not selected in the statement');
  const c = await r.po(r.v2); assert.equal(c.status, 201, JSON.stringify(c.json)); const p = c.json.data; assert.deepEqual([p.source, p.status, p.terms.supplyType, p.terms.vendorStateCode], ['CS', 'DRAFT', 'INTRA', '27']); const l = p.lines[0];
  assert.deepEqual([l.qty, l.rate, l.csRate, l.discountPct, l.gstPct], [600, 390, 390, 0, 18], 'the quoted rate and quantity'); assert.deepEqual([l.basic, l.cgst, l.sgst, l.igst, l.amount], [234000, 21060, 21060, 0, 276120]); assert.equal(p.totalAmount, 276120);
  const c3 = await r.po(r.v3); assert.equal(c3.status, 201); assert.deepEqual([c3.json.data.terms.supplyType, c3.json.data.lines.map((x) => [x.cgst, x.igst > 0])], ['INTER', [[0, true], [0, true]]], 'a vendor in another state is charged IGST');
  assert.equal((await r.po(r.v2)).status, 400, 'nothing is left to order from the statement for V2'); assert.equal((await r.call(ic, 'POST', `/purchase-orders/${p.id}/submit`)).status, 202);
  const inst = r.d.prepare('SELECT workflow_instance_id AS w FROM proc_purchase_orders WHERE id = ?').get(p.id).w; assert.equal((await r.act(mgr, inst)).status, 200);
  const ap = (await r.call(ic, 'GET', `/purchase-orders/${p.id}`)).json.data; assert.deepEqual([ap.status, ap.sentStatus], ['APPROVED', 'QUEUED']); assert.equal(r.committed(), 23_400_000, 'the commitment is the basic value');
  r.drain(); const prl = r.d.prepare('SELECT ordered_qty FROM proc_pr_lines WHERE id = (SELECT pr_line_id FROM proc_po_lines WHERE po_id = ? AND line_no = 1)').get(p.id); assert.equal(prl.ordered_qty, 600_000, 'the requisition balance falls');
  assert.equal((await r.call(ic, 'PATCH', `/purchase-orders/${p.id}`, { terms: { paymentTerms: 'x' } })).status, 409, 'approved is locked');
  // the vendor: acknowledge and tell the dispatch on its own link
  const tk = await r.link(p.id); const info = await r.pub('GET', tk); assert.equal(info.status, 200, JSON.stringify(info.json)); assert.equal(info.json.data.lines.length, 1); assert.equal(JSON.stringify(info.json).includes('benchmark'), false);
  assert.equal((await r.pub('POST', tk, '/acknowledge', { note: 'Will deliver on time' })).status, 200); assert.ok((await r.call(ic, 'GET', `/purchase-orders/${p.id}`)).json.data.acknowledgedAt);
  const asn = await r.pub('POST', tk, '/dispatch', { dispatchDate: plus(2), expectedArrival: plus(4), vehicleNo: 'MH12AB1234', ewayBillNo: '271000000001', vendorInvoiceNo: 'INV/9', lines: [{ poLineId: ap.lines[0].id, qty: 300 }] }); assert.equal(asn.status, 201, JSON.stringify(asn.json)); assert.equal((await r.pub('POST', tk, '/dispatch', { dispatchDate: plus(2), lines: [{ poLineId: ap.lines[0].id, qty: 400 }] })).status, 400, 'more than the balance is on the way');
  assert.equal((await r.pub('GET', 'A'.repeat(32))).status, 404);
  // amendment: the quantity falls to 500 and the date moves; compared, approved by the procurement manager (a small change, no rate increase), the commitment follows
  const am = await r.call(ic, 'POST', `/purchase-orders/${p.id}/amend`, { reason: 'The pour is smaller', lines: [{ lineId: ap.lines[0].id, qty: 500, schedule: [{ dueDate: plus(12), qty: 500 }] }] }); assert.equal(am.status, 201, JSON.stringify(am.json)); const a = am.json.data; assert.equal(a.deltaAmount, -(100 * 390 * 1.18), 'the change in value'); assert.deepEqual(a.changes.map((x) => x.field), ['qty', 'delivery dates']); assert.equal(a.before.lines[0].qty, 600); assert.equal(a.after.lines[0].qty, 500);
  assert.equal((await r.call(ic, 'POST', `/purchase-orders/${p.id}/amend`, { reason: 'again', lines: [{ lineId: ap.lines[0].id, qty: 550 }] })).status, 409, 'one open amendment at a time');
  const sub = await r.call(ic, 'POST', `/purchase-orders/${p.id}/amendments/${a.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); assert.equal((await r.act(mgr, sub.json.data.workflowInstanceId)).status, 200);
  const after = (await r.call(ic, 'GET', `/purchase-orders/${p.id}`)).json.data; assert.deepEqual([after.amendmentNo, after.totalAmount, after.lines[0].qty, after.lines[0].schedule[0].dueDate, after.acknowledgedAt], [1, 230100, 500, plus(12), null], 'the order is the new version and must be acknowledged again'); assert.equal(r.committed(), 19_500_000, 'the commitment fell by the basic value of 100 bags');
  r.drain(); assert.equal(r.d.prepare('SELECT ordered_qty FROM proc_pr_lines WHERE id = (SELECT pr_line_id FROM proc_po_lines WHERE po_id = ? AND line_no = 1)').get(p.id).ordered_qty, 500_000); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.po.amended'").get());
  // a rate increase above the statement needs an exception (CP-PROC-05)
  const up = await r.call(ic, 'POST', `/purchase-orders/${p.id}/amend`, { reason: 'Vendor asks more', lines: [{ lineId: ap.lines[0].id, rate: 395 }] }); assert.equal(up.status, 201); const us = await r.call(ic, 'POST', `/purchase-orders/${p.id}/amendments/${up.json.data.id}/submit`); assert.ok([403, 409, 422].includes(us.status), `blocked: ${us.status} ${JSON.stringify(us.json).slice(0, 200)}`);
  assert.equal((await r.call(ic, 'POST', `/purchase-orders/${p.id}/amendments/${up.json.data.id}/discard`, { reason: 'Not accepted' })).json.data.status, 'CANCELLED');
  assert.ok((await r.call(ic, 'GET', `/purchase-orders/${p.id}/history`)).json.data.audit.some((x) => x.action === 'approve'));
  assert.equal((await r.api.raw('GET', `${P}/purchase-orders/${p.id}/print`, { ...ic })).status, 200);
});

test('T-02 BR-02 FR-08 FR-09 cancel is refused once goods are received; short-close releases the commitment; delivered in full closes; the vendor performance and the delivery tracker', async () => {
  const r = await approvedCs(); const mk = async (v) => { const p = (await r.po(v)).json.data; await r.approvePo(p.id); return (await r.call(ic, 'GET', `/purchase-orders/${p.id}`)).json.data; };
  const a = await mk(r.v2); const b = await mk(r.v3);
  // a cancel with nothing received: asked, approved by the procurement manager and the project manager; the commitment is released and the requisition balance returns
  r.drain(); const before = r.committed(); assert.ok(before > 0);
  assert.equal((await r.call(ic, 'POST', `/purchase-orders/${b.id}/cancel`, { reason: 'Vendor cannot supply in time' })).status, 202); const ib = r.d.prepare("SELECT workflow_instance_id AS w FROM proc_po_amendments WHERE po_id = ?").get(b.id).w; await approveAll(r, ib, [mgr, pm]);
  assert.equal((await r.call(ic, 'GET', `/purchase-orders/${b.id}`)).json.data.status, 'CANCELLED'); assert.equal(before - r.committed(), 16_000_000 + 3_400_000, 'its commitment is released'); r.drain();
  // goods received against the first order
  const ing = await r.call(sysu, 'POST', '/purchase-orders/receipts/ingest', { receipts: [{ poLineId: a.lines[0].id, grnRef: 'GRN/1', receivedOn: plus(0), qty: 200, acceptedQty: 190 }] }); assert.equal(ing.status, 201, JSON.stringify(ing.json)); assert.equal(ing.json.data.posted, 1);
  assert.equal((await r.call(sysu, 'POST', '/purchase-orders/receipts/ingest', { receipts: [{ poLineId: a.lines[0].id, grnRef: 'GRN/1', receivedOn: plus(0), qty: 200 }] })).json.data.duplicates, 1, 'the same GRN twice is counted once'); assert.equal((await r.call(ic, 'POST', '/purchase-orders/receipts/ingest', { receipts: [{ poLineId: a.lines[0].id, grnRef: 'GRN/2', receivedOn: plus(0), qty: 1 }] })).status, 403);
  const got = (await r.call(ic, 'GET', `/purchase-orders/${a.id}`)).json.data; assert.deepEqual([got.deliveryStatus, got.lines[0].receivedQty, got.lines[0].balanceQty, got.lines[0].schedule[0].receivedQty], ['PARTIAL', 200, 400, 200]);
  const cx = await r.call(ic, 'POST', `/purchase-orders/${a.id}/cancel`, { reason: 'Changed our mind' }); assert.equal(cx.status, 409); assert.match(JSON.stringify(cx.json), /short-close/i);
  // short-close: the rest is given up
  assert.equal((await r.call(ic, 'POST', `/purchase-orders/${a.id}/short-close`, { reason: 'The rest is not needed any more' })).status, 202); const ia = r.d.prepare("SELECT workflow_instance_id AS w FROM proc_po_amendments WHERE po_id = ?").get(a.id).w; await approveAll(r, ia, [mgr, pm]);
  const closed = (await r.call(ic, 'GET', `/purchase-orders/${a.id}`)).json.data; assert.deepEqual([closed.status, closed.lines[0].shortClosedQty, closed.lines[0].balanceQty, closed.deliveryStatus], ['CLOSED', 400, 0, 'DELIVERED']); assert.equal(r.committed(), 0, 'the remaining commitment is released'); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.po.closed'").get());
  // delivered in full closes by itself; performance counts receipts on time and accepted
  const c = await mk(r.v3); await r.call(sysu, 'POST', '/purchase-orders/receipts/ingest', { receipts: [{ poLineId: c.lines[0].id, grnRef: 'GRN/3', receivedOn: plus(40), qty: 400, acceptedQty: 400 }, { poLineId: c.lines[1].id, grnRef: 'GRN/3', receivedOn: plus(0), qty: 500 }] });
  assert.equal((await r.call(ic, 'GET', `/purchase-orders/${c.id}`)).json.data.status, 'CLOSED'); const perf = (await r.call(mgr, 'GET', '/purchase-orders/performance')).json.data; const pv2 = perf.find((x) => x.vendorId === r.v2); const pv3 = perf.find((x) => x.vendorId === r.v3); assert.deepEqual([pv2.onTimePct, pv2.qualityPct], [100, 95]); assert.equal(pv3.onTimePct, 50, 'one of two receipts was late'); assert.equal(pv3.qualityPct, 100);
});

test('FR-05 FR-06 advances by the terms and the three approvers; the tracker lists overdue deliveries and tells the buyer; roles and masking', async () => {
  const r = await approvedCs(); const p = (await r.po(r.v3)).json.data; await r.approvePo(p.id); const o = (await r.call(ic, 'GET', `/purchase-orders/${p.id}`)).json.data; assert.equal(o.can.advance, true);
  const big = await r.call(ic, 'POST', `/purchase-orders/${p.id}/advances`, { amount: 1_000_000, reason: 'Advance for the steel mill' }); assert.equal(big.status, 400); assert.match(JSON.stringify(big.json), /advance of the terms/);
  const adv = await r.call(ic, 'POST', `/purchase-orders/${p.id}/advances`, { amount: 30_000, reason: 'Advance for the steel mill' }); assert.equal(adv.status, 202, JSON.stringify(adv.json)); const inst = r.d.prepare('SELECT workflow_instance_id AS w FROM proc_po_advances WHERE po_id = ?').get(p.id).w;
  await approveAll(r, inst, [mgr, com]); assert.equal(r.d.prepare('SELECT status FROM proc_po_advances WHERE po_id = ?').get(p.id).status, 'SUBMITTED', 'the CFO is still to decide'); assert.equal((await r.act(cfo, inst)).status, 200);
  assert.equal(r.d.prepare('SELECT status FROM proc_po_advances WHERE po_id = ?').get(p.id).status, 'APPROVED'); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.po.advance_approved'").get());
  // the tracker and the overdue alert
  r.d.prepare('UPDATE proc_po_schedules SET due_date = ? WHERE po_id = ?').run(plus(-3), p.id); const tr = (await r.call(ic, 'GET', '/purchase-orders/tracker?overdueOnly=true')).json.data; assert.ok(tr.rows.length >= 2); assert.equal(tr.rows[0].daysOverdue, 3); assert.equal(tr.summary.overdue, tr.rows.length);
  const { procOf } = await import('../src/server/modules/proc/index.js'); assert.equal(procOf(r.d).poSvc.extra.sweep(), 1); assert.equal(procOf(r.d).poSvc.extra.sweep(), 0, 'once a day'); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.po.overdue'").get());
  assert.equal((await r.call(ic, 'GET', `/purchase-orders/${p.id}`)).json.data.overdue, true);
  // direct order: a reason is needed; a rate above the benchmark takes the project manager
  const direct = await r.call(ic, 'POST', '/purchase-orders', { projectId: r.pid, source: 'DIRECT', vendorId: r.v1, terms: r.terms, lines: [{ itemId: r.cement, qty: 10, rate: 500, uom: 'bag', taxCode: 'GST18' }] }); assert.equal(direct.status, 400); assert.match(JSON.stringify(direct.json), /reason/i);
  const d2 = await r.call(ic, 'POST', '/purchase-orders', { projectId: r.pid, source: 'DIRECT', directReason: 'Urgent top-up of cement for the slab', vendorId: r.v1, terms: r.terms, lines: [{ itemId: r.cement, qty: 10, rate: 500, uom: 'bag', taxCode: 'GST18' }] }); assert.equal(d2.status, 201, JSON.stringify(d2.json)); assert.equal(d2.json.data.varianceFlag, true, '500 is above 380 + 10%'); assert.equal(d2.json.data.lines[0].gstPct, 18);
  // BR-01 two open orders share the requisition balance: 10 bags (5% tolerance), 8 on a draft order leaves 2.5 for the next
  const small = r.pr({ small: true }); const onPr = (qty) => r.call(ic, 'POST', '/purchase-orders', { projectId: r.pid, source: 'DIRECT', directReason: 'Cement against the requisition', vendorId: r.v1, terms: r.terms, lines: [{ itemId: r.cement, prLineId: small.l1, qty, rate: 380, uom: 'bag', taxCode: 'GST18' }] });
  assert.equal((await onPr(8)).status, 201); const second = await onPr(8); assert.equal(second.status, 400); assert.match(JSON.stringify(second.json), /already on other open orders/);
  const s2 = await r.call(ic, 'POST', `/purchase-orders/${d2.json.data.id}/submit`); assert.equal(s2.status, 202); await r.act(mgr, s2.json.data.workflowInstanceId); assert.equal(r.d.prepare('SELECT status FROM proc_purchase_orders WHERE id = ?').get(d2.json.data.id).status, 'SUBMITTED', 'the project manager also approves a high rate'); await r.act(pm, s2.json.data.workflowInstanceId);
  assert.equal(r.d.prepare('SELECT status FROM proc_purchase_orders WHERE id = ?').get(d2.json.data.id).status, 'APPROVED'); assert.equal((await r.call(ic, 'POST', '/purchase-orders', { projectId: r.pid, source: 'DIRECT', directReason: 'Top-up for a held vendor ok', vendorId: r.hold, terms: r.terms, lines: [{ itemId: r.cement, qty: 1, rate: 1, uom: 'bag' }] })).status, 400, 'a vendor on hold');
  // roles: the storekeeper sees the order without a rate, the site engineer nothing, another company nothing
  const skv = (await r.call(sk, 'GET', `/purchase-orders/${p.id}`)).json.data; assert.deepEqual([skv.canSeeRates, skv.totalAmount, skv.lines[0].rate, skv.lines[0].qty > 0], [false, null, null, true]); assert.equal((await r.call(se, 'GET', `/purchase-orders/${p.id}`)).status, 403); assert.ok([403, 404].includes((await r.call(other, 'GET', `/purchase-orders/${p.id}`)).status));
  const lst = (await r.call(sk, 'GET', '/purchase-orders')).json.data; assert.equal(lst[0].amount, ''); assert.equal((await r.call(sk, 'POST', '/purchase-orders', { projectId: r.pid, source: 'CS', csId: r.cs.id, vendorId: r.v2, terms: r.terms })).status, 403);
  assert.equal((await r.call(mgr, 'GET', '/purchase-orders?filter[status]=APPROVED')).json.data.length, 2); const k = key(); assert.equal((await r.call(ic, 'POST', `/purchase-orders/${p.id}/resend`, undefined, k)).status, 200); assert.equal((await r.call(ic, 'POST', `/purchase-orders/${p.id}/resend`, undefined, k)).status, 200);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1505'").run(); assert.equal((await r.call(ic, 'GET', '/purchase-orders')).status, 404);
});
