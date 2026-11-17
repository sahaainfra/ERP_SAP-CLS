import { authzOf } from '../../platform/authz/index.js';
import { forbidden, notFound } from '../../platform/http/errors.js';

// Part 166.7, FR-03: the document flow. From one document, the documents it came from and those that followed it, read from the link columns the
// modules already store (no table of its own). Each node: its type, number, status, amount, date and the page that opens it; a document the person
// may not see is shown as "a document you may not open" without its number. Steps that later parts own (payment, receipt) are listed as "not yet
// available", never invented. Three chains: procurement (MR → PR → RFQ → CS → PO → gate entry → GRN → test → issue, vendor invoice → payment),
// billing (client bill → certification → tax invoice → receipt; the measurement book reaches a bill through BOQ lines, not a document: D-695),
// subcontract (measurement → sub bill).

const rs = (p) => (p === null || p === undefined ? null : Math.round(Number(p)) / 100); // amounts are kept in paise

/** The kinds of document: where they are, who may see them, their key facts (FR-02 objectFacts) and the page that opens them. */
export const TYPES = {
  MR: { label: 'Material request', table: 'proc_material_requests', permission: 'proc.material_request.view', route: (id) => `/proc/material-requests?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.doc_date, amount: null }) },
  PR: { label: 'Purchase requisition', table: 'proc_requisitions', permission: 'proc.requisition.view', route: (id) => `/proc/requisitions?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.doc_date, amount: rs(r.total_amount) }) },
  RFQ: { label: 'Request for quotation', table: 'proc_rfqs', permission: 'proc.rfq.view', route: (id) => `/proc/rfqs?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.doc_date, amount: rs(r.est_total) }) },
  CS: { label: 'Comparative statement', table: 'proc_comparative_statements', permission: 'proc.comparative_statement.view', route: (id) => `/proc/comparative-statements?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.doc_date, amount: rs(r.total_value) }) },
  PO: { label: 'Purchase order', table: 'proc_purchase_orders', permission: 'proc.purchase_order.view', route: (id) => `/proc/purchase-orders?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.doc_date, amount: rs(r.total_amount) }) },
  GATE: { label: 'Gate entry', table: 'inv_gate_inward', permission: 'inv.inward.view', route: (id) => `/inv/gate-register?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: String(r.entry_date ?? '').slice(0, 10), amount: null }) },
  GRN: { label: 'Goods receipt', table: 'inv_grns', permission: 'inv.grn.view', route: (id) => `/inv/grns?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.received_date, amount: rs(r.total_value) }) },
  QC: { label: 'Material test', table: 'qa_test_requests', permission: 'qa.test_request.view', route: (id) => `/qa/test-requests?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.requested_on, amount: null }) },
  ISSUE: { label: 'Material issue', table: 'inv_issues', permission: 'inv.issue.view', route: (id) => `/inv/issues?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.issue_date, amount: rs(r.total_value) }) },
  VINV: { label: 'Vendor invoice', table: 'bill_vendor_invoices', permission: 'bill.vendor_invoice.view', route: (id) => `/bill/vendor-invoices?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.status, date: r.invoice_date, amount: rs(r.total_paise), party: r.invoice_no ? `invoice ${r.invoice_no}` : null }) },
  CBILL: { label: 'Client bill', table: 'bill_client_bills', permission: 'bill.client_bill.view', route: (id) => `/bill/client-bills?id=${id}`, facts: (r) => ({ ref: r.bill_no ?? r.doc_no, status: r.status, date: r.period_to, amount: rs(r.net_paise) }) },
  CERT: { label: 'Certification', table: 'bill_certifications', permission: 'bill.certification.view', route: (id) => `/bill/certifications?id=${id}`, facts: (r) => ({ ref: r.cert_no ?? r.doc_no, status: r.status, date: r.cert_date, amount: rs(r.certified_net_paise) }) },
  TINV: { label: 'Tax invoice', table: 'bill_tax_invoices', permission: 'bill.tax_invoice.view', route: (id) => `/bill/tax-invoices?id=${id}`, facts: (r) => ({ ref: r.invoice_no ?? r.doc_no, status: r.status, date: r.invoice_date, amount: rs(r.total_paise) }) },
  SMEAS: { label: 'Subcontract measurement', table: 'bill_sub_measurements', permission: 'bill.sub_measure.view', route: (id) => `/bill/sub-measure?id=${id}`, facts: (r) => ({ ref: r.doc_no, status: r.verified_on ? 'VERIFIED' : r.sub_signed_on ? 'SIGNED' : 'RECORDED', date: r.measured_on, amount: null }) },
  SBILL: { label: 'Subcontractor bill', table: 'bill_sub_bills', permission: 'bill.sub_bill.view', route: (id) => `/bill/sub-bills?id=${id}`, facts: (r) => ({ ref: r.bill_no ?? r.doc_no, status: r.status, date: r.period_to, amount: rs(r.net_paise) }) },
};

/** The links: [from, to, SQL giving the ids of `to` for one `from` id, SQL giving the ids of `from` for one `to` id]. Both directions, so the flow is the same from any document of it. */
const LINKS = [
  ['MR', 'PR', 'SELECT DISTINCT pl.pr_id AS id FROM proc_pr_sources s JOIN proc_pr_lines pl ON pl.id = s.pr_line_id JOIN proc_mr_lines ml ON ml.id = s.mr_line_id WHERE ml.mr_id = ?', 'SELECT DISTINCT ml.mr_id AS id FROM proc_pr_sources s JOIN proc_pr_lines pl ON pl.id = s.pr_line_id JOIN proc_mr_lines ml ON ml.id = s.mr_line_id WHERE pl.pr_id = ?'],
  ['PR', 'RFQ', 'SELECT DISTINCT rl.rfq_id AS id FROM proc_rfq_lines rl JOIN proc_pr_lines pl ON pl.id = rl.pr_line_id WHERE pl.pr_id = ?', 'SELECT DISTINCT pl.pr_id AS id FROM proc_rfq_lines rl JOIN proc_pr_lines pl ON pl.id = rl.pr_line_id WHERE rl.rfq_id = ?'],
  ['RFQ', 'CS', 'SELECT id FROM proc_comparative_statements WHERE rfq_id = ?', 'SELECT rfq_id AS id FROM proc_comparative_statements WHERE id = ?'],
  ['CS', 'PO', 'SELECT id FROM proc_purchase_orders WHERE cs_id = ?', 'SELECT cs_id AS id FROM proc_purchase_orders WHERE id = ?'],
  ['PR', 'PO', 'SELECT DISTINCT l.po_id AS id FROM proc_po_lines l JOIN proc_pr_lines pl ON pl.id = l.pr_line_id WHERE pl.pr_id = ?', 'SELECT DISTINCT pl.pr_id AS id FROM proc_po_lines l JOIN proc_pr_lines pl ON pl.id = l.pr_line_id WHERE l.po_id = ?'],
  ['PO', 'GATE', 'SELECT id FROM inv_gate_inward WHERE po_id = ?', 'SELECT po_id AS id FROM inv_gate_inward WHERE id = ?'],
  ['PO', 'GRN', 'SELECT id FROM inv_grns WHERE po_id = ?', 'SELECT po_id AS id FROM inv_grns WHERE id = ?'],
  ['GATE', 'GRN', 'SELECT id FROM inv_grns WHERE gate_inward_id = ?', 'SELECT gate_inward_id AS id FROM inv_grns WHERE id = ?'],
  ['GRN', 'QC', 'SELECT id FROM qa_test_requests WHERE grn_id = ?', 'SELECT grn_id AS id FROM qa_test_requests WHERE id = ?'],
  ['MR', 'ISSUE', 'SELECT id FROM inv_issues WHERE mr_id = ?', 'SELECT mr_id AS id FROM inv_issues WHERE id = ?'],
  ['PO', 'VINV', 'SELECT id FROM bill_vendor_invoices WHERE po_id = ?', 'SELECT po_id AS id FROM bill_vendor_invoices WHERE id = ?'],
  ['CBILL', 'CERT', 'SELECT id FROM bill_certifications WHERE bill_id = ?', 'SELECT bill_id AS id FROM bill_certifications WHERE id = ?'],
  ['CBILL', 'TINV', 'SELECT id FROM bill_tax_invoices WHERE bill_id = ?', 'SELECT bill_id AS id FROM bill_tax_invoices WHERE id = ?'],
  ['CERT', 'TINV', 'SELECT id FROM bill_tax_invoices WHERE certification_id = ?', 'SELECT certification_id AS id FROM bill_tax_invoices WHERE id = ?'],
  ['SMEAS', 'SBILL', 'SELECT bill_id AS id FROM bill_sub_measurements WHERE id = ? AND bill_id IS NOT NULL', 'SELECT id FROM bill_sub_measurements WHERE bill_id = ?'],
];

/** Steps that parts not built yet will add after a document (shown as "not yet available"). */
const LATER = {
  VINV: [{ label: 'Payment to the vendor', part: '23.x' }],
  TINV: [{ label: 'Receipt from the client', part: '23.x' }],
};
/** The order of the kinds in a chain (the flow is drawn in this order). */
const ORDER = ['MR', 'PR', 'RFQ', 'CS', 'PO', 'GATE', 'GRN', 'QC', 'ISSUE', 'VINV', 'CBILL', 'CERT', 'TINV', 'SMEAS', 'SBILL'];
const MAX = 60;

export function createDocFlowService({ db }) {
  const authz = authzOf(db);
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const present = new Map(Object.entries(TYPES).filter(([, d]) => has(d.table)));
  const links = LINKS.filter(([a, b]) => present.has(a) && present.has(b)).map(([a, b, down, up]) => ({ a, b, down: db.prepare(down), up: db.prepare(up) }));
  const rowOf = (type, id) => db.prepare(`SELECT * FROM ${TYPES[type].table} WHERE id = ?`).get(id);

  function neighbours(type, id) {
    const out = [];
    for (const l of links) {
      if (l.a === type) for (const r of l.down.all(id)) if (r.id) out.push([l.b, r.id]);
      if (l.b === type) for (const r of l.up.all(id)) if (r.id) out.push([l.a, r.id]);
    }
    return out;
  }

  return {
    types: () => [...present.keys()],
    /** The flow of one document for this person. */
    flow(actor, { type, id }) {
      const def = present.get(type);
      if (!def) throw notFound(`There is no document type ${type}.`);
      const start = rowOf(type, id);
      if (!start || start.company_id !== actor.companyId || start.deleted_at) throw notFound('That document does not exist.');
      if (!authz.check(actor, def.permission).allowed) throw forbidden(`You may not see this document (permission ${def.permission}).`);
      const seen = new Map();
      const edges = [];
      const queue = [[type, id]];
      while (queue.length && seen.size < MAX) {
        const [t, i] = queue.shift();
        const key = `${t}:${i}`;
        if (seen.has(key)) continue;
        const r = rowOf(t, i);
        if (!r || r.company_id !== actor.companyId || r.deleted_at) continue;
        seen.set(key, { t, i, r });
        for (const [nt, ni] of neighbours(t, i)) {
          const nk = `${nt}:${ni}`;
          const [from, to] = ORDER.indexOf(t) <= ORDER.indexOf(nt) ? [key, nk] : [nk, key];
          if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to });
          if (!seen.has(nk)) queue.push([nt, ni]);
        }
      }
      const nodes = [...seen.values()].map(({ t, i, r }) => {
        const d = TYPES[t];
        const visible = authz.check(actor, d.permission).allowed;
        const f = d.facts(r);
        return visible
          ? { key: `${t}:${i}`, type: t, label: d.label, id: i, ref: f.ref, status: f.status, date: f.date ?? null, amount: f.amount ?? null, party: f.party ?? null, route: d.route(i), current: t === type && i === id, visible: true }
          : { key: `${t}:${i}`, type: t, label: d.label, id: null, ref: null, status: null, date: null, amount: null, route: null, current: false, visible: false, note: 'A document you may not open' };
      }).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || String(a.date ?? '').localeCompare(String(b.date ?? '')));
      const keys = new Set(nodes.map((n) => n.key));
      const later = [...new Set(nodes.map((n) => n.type))].flatMap((t) => (LATER[t] ?? []).map((s) => ({ after: t, label: s.label, note: `Not yet available: part ${s.part} adds it` })));
      // FR-02 "Related apps": the list of each kind of document in the flow the person may open
      const related = [...new Set(nodes.filter((n) => n.visible).map((n) => n.type))].map((t) => ({ type: t, label: TYPES[t].label, route: TYPES[t].route(0).replace(/\?id=0$/, '') }));
      return { start: `${type}:${id}`, nodes, edges: edges.filter((e) => keys.has(e.from) && keys.has(e.to)), later, related, truncated: seen.size >= MAX };
    },
  };
}
