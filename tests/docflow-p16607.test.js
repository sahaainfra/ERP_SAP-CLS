import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { fill, ready } from './qa-helpers.js';

// Part 166.7, FR-03 / T-02: the document flow of a purchase order: the material request, the requisition, the RFQ and comparative statement,
// the order, the gate entry, the goods receipt and its test, the vendor invoice, in the order of the chain with their statuses and amounts; the same
// flow from any document of it; a document the person may not open shown without its number; the payment listed as not yet available.
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const as = (roles, user) => ({ roles, user, company: '1' });

async function chain() {
  const r = await ready(opened);
  const d = r.api.db;
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'VFL1', 'Flow Cement Ltd', 'Flow', 'PUBLIC_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const item = fill(d, 'mdm_items', { company_id: 1, code: 'FLW53', name: 'Cement 53 grade' });
  const mr = fill(d, 'proc_material_requests', { company_id: 1, org_project_id: r.A, doc_no: 'MR/T/0001', doc_date: '2026-11-01', status: 'APPROVED' });
  const mrl = fill(d, 'proc_mr_lines', { company_id: 1, mr_id: mr, line_no: 1, item_id: item, qty: 100_000 });
  const pr = fill(d, 'proc_requisitions', { company_id: 1, org_project_id: r.A, doc_no: 'PR/T/0001', doc_date: '2026-11-02', status: 'APPROVED', total_amount: 4_000_000 });
  const prl = fill(d, 'proc_pr_lines', { company_id: 1, pr_id: pr, line_no: 1, item_id: item, qty: 100_000 });
  fill(d, 'proc_pr_sources', { company_id: 1, pr_line_id: prl, mr_line_id: mrl, qty: 100_000 });
  const rfq = fill(d, 'proc_rfqs', { company_id: 1, org_project_id: r.A, doc_no: 'RFQ/T/0001', doc_date: '2026-11-03', status: 'CLOSED' });
  const rfql = fill(d, 'proc_rfq_lines', { company_id: 1, rfq_id: rfq, line_no: 1, pr_line_id: prl, item_id: item, qty: 100_000 });
  const cs = fill(d, 'proc_comparative_statements', { company_id: 1, org_project_id: r.A, rfq_id: rfq, doc_no: 'CS/T/0001', doc_date: '2026-11-04', status: 'APPROVED', total_value: 4_000_000 });
  assert.ok(rfql && cs);
  const po = fill(d, 'proc_purchase_orders', { company_id: 1, org_project_id: r.A, cs_id: cs, vendor_id: vendor, doc_no: 'PO/T/0001', doc_date: '2026-11-05', status: 'APPROVED', total_amount: 4_720_000 });
  fill(d, 'proc_po_lines', { company_id: 1, po_id: po, line_no: 1, pr_line_id: prl, item_id: item, qty: 100_000, uom: 'bag', rate: 40_000 });
  const gate = fill(d, 'inv_gate_inward', { company_id: 1, org_project_id: r.A, po_id: po, vendor_id: vendor, doc_no: 'GI/T/0001', entry_date: '2026-11-08T10:00:00Z', status: 'HANDED_OVER' });
  const grn = fill(d, 'inv_grns', { company_id: 1, org_project_id: r.A, po_id: po, gate_inward_id: gate, vendor_id: vendor, doc_no: 'GRN/T/0001', received_date: '2026-11-08', status: 'APPROVED', total_value: 4_000_000 });
  const vi = fill(d, 'bill_vendor_invoices', { company_id: 1, org_project_id: r.A, vendor_id: vendor, po_id: po, doc_no: 'VI/T/0001', invoice_no: 'FC/889', invoice_date: '2026-11-10', status: 'SUBMITTED', total_paise: 4_720_000 });
  return { r, d, mr, pr, rfq, cs, po, gate, grn, vi };
}

test('T-02 the flow of a purchase order: MR, PR, RFQ, CS, PO, gate entry, GRN and vendor invoice in order, with statuses and amounts; the payment is not yet available', async () => {
  const w = await chain();
  const res = await w.r.api.call('GET', `/api/v1/ui/doc-flow?type=PO&id=${w.po}`, as('PROCMGR', 'flow-proc'));
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const f = res.json.data;
  assert.deepEqual(f.nodes.map((n) => n.type), ['MR', 'PR', 'RFQ', 'CS', 'PO', 'GATE', 'GRN', 'VINV']);
  assert.deepEqual(f.nodes.map((n) => [n.ref, n.status]), [['MR/T/0001', 'APPROVED'], ['PR/T/0001', 'APPROVED'], ['RFQ/T/0001', 'CLOSED'], ['CS/T/0001', 'APPROVED'], ['PO/T/0001', 'APPROVED'], ['GI/T/0001', 'HANDED_OVER'], ['GRN/T/0001', 'APPROVED'], ['VI/T/0001', 'SUBMITTED']]);
  const po = f.nodes.find((n) => n.type === 'PO');
  assert.equal(po.current, true);
  assert.equal(po.amount, 47_200, 'the amount in rupees (kept in paise)');
  // the same figure as the purchase order's own page
  const own = await w.r.api.call('GET', `/api/v1/proc/purchase-orders/${w.po}`, as('PROCMGR', 'flow-proc'));
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal(Number(String(own.json.data.totalAmount).replace(/,/g, '')), po.amount);
  assert.equal(po.route, `/proc/purchase-orders?id=${w.po}`);
  assert.deepEqual(f.later.map((l) => [l.after, l.label]), [['VINV', 'Payment to the vendor']]);
  assert.match(f.later[0].note, /Not yet available/);
  // links run both ways: the same flow from the material request and from the vendor invoice
  for (const [type, id, role] of [['MR', w.mr, 'PROCMGR'], ['VINV', w.vi, 'ACCMGR']]) {
    const res2 = await w.r.api.call('GET', `/api/v1/ui/doc-flow?type=${type}&id=${id}`, as(role, `flow-${role.toLowerCase()}`));
    assert.equal(res2.status, 200, `${type}: ${JSON.stringify(res2.json)}`);
    const other = res2.json.data;
    assert.deepEqual(other.nodes.map((n) => n.key).sort(), f.nodes.map((n) => n.key).sort(), `from ${type}`);
  }
});

test('rights: a document the person may not open is shown without its number; a start document they may not see is refused; another company sees nothing', async () => {
  const w = await chain();
  // a storekeeper sees the goods receipt but not the order chain upstream
  const sk = await w.r.api.call('GET', `/api/v1/ui/doc-flow?type=GRN&id=${w.grn}`, as('SK', 'flow-sk'));
  assert.equal(sk.status, 200, JSON.stringify(sk.json));
  const hidden = sk.json.data.nodes.filter((n) => !n.visible);
  assert.ok(hidden.length > 0, 'some documents are hidden for the storekeeper');
  for (const n of hidden) { assert.equal(n.ref, null); assert.equal(n.route, null); assert.equal(n.note, 'A document you may not open'); }
  assert.ok(sk.json.data.nodes.find((n) => n.type === 'GRN').visible);
  // a site engineer may not see the purchase order itself
  assert.equal((await w.r.api.call('GET', `/api/v1/ui/doc-flow?type=VINV&id=${w.vi}`, as('SE', 'flow-se'))).status, 403);
  // another company: the document does not exist for it
  assert.equal((await w.r.api.call('GET', `/api/v1/ui/doc-flow?type=PO&id=${w.po}`, { roles: 'PROCMGR', user: 'flow-x', company: '2' })).status, 404);
  // an unknown kind is refused by the validator
  assert.equal((await w.r.api.call('GET', `/api/v1/ui/doc-flow?type=XX&id=${w.po}`, as('PROCMGR', 'flow-proc'))).status, 400);
});
