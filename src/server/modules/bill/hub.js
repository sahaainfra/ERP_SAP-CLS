import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { qaHelpers } from '../qa/common.js';

// The invoice management hub (part 22.06 FR-05): the bills the company sends to its clients, the bills it receives from subcontractors and the invoices it receives from vendors in one view, each with the stage it has reached, its age and the way to its source. Only what the person may see in each kind is shown.
export const STAGE = { PREPARED: 'Being prepared', IN_APPROVAL: 'In approval', BLOCKED: 'Blocked by the match', APPROVED: 'Approved', WITH_CLIENT: 'With the client', CERTIFIED: 'Certified by the client', INVOICED: 'Tax invoice issued', PAYABLE: 'Handed to payables or receivables' };
export const TYPE = { CLIENT: 'Client bill', SUBCONTRACTOR: 'Subcontractor bill', VENDOR: 'Vendor invoice' };
const rs = (p) => p / 100; const BUCKETS = [['0-30', 0, 30], ['31-60', 31, 60], ['61-90', 61, 90], ['90+', 91, 100000]];

export function createHubService({ db, base }) {
  const { may } = base; const { gate, pcode } = qaHelpers({ db, base }); const today = () => todayIST(); const days = (d) => Math.max(0, Math.round((new Date(`${today()}T00:00:00Z`) - new Date(`${String(d).slice(0, 10)}T00:00:00Z`)) / 86_400_000));
  function collect(actor, q) {
    const rows = []; const pf = q.projectId ? ' AND x.org_project_id = ?' : ''; const pa = q.projectId ? [q.projectId] : []; const dr = `${q.from ? ' AND COALESCE(x.%D, x.created_at) >= ?' : ''}${q.to ? ' AND COALESCE(x.%D, x.created_at) <= ?' : ''}`; const dp = (col) => dr.replaceAll('%D', col); const da = [...(q.from ? [q.from] : []), ...(q.to ? [q.to] : [])];
    if (!q.type || q.type === 'CLIENT') for (const x of db.prepare(`SELECT x.*, k.contract_no, (SELECT c.status FROM bill_certifications c WHERE c.bill_id = x.id AND c.deleted_at IS NULL AND c.status NOT IN ('CANCELLED', 'REJECTED') LIMIT 1) AS cert_status, (SELECT t.ar_state FROM bill_tax_invoices t WHERE t.bill_id = x.id AND t.deleted_at IS NULL AND t.status = 'APPROVED' LIMIT 1) AS inv_ar, (SELECT 1 FROM bill_tax_invoices t WHERE t.bill_id = x.id AND t.deleted_at IS NULL AND t.status = 'APPROVED' LIMIT 1) AS invoiced FROM bill_client_bills x JOIN ctr_contracts k ON k.id = x.contract_id WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.status NOT IN ('CANCELLED', 'REJECTED')${pf}${dp('period_to')} ORDER BY x.id DESC LIMIT 300`).all(actor.companyId, ...pa, ...da)) {
      if (!may(actor, 'bill.client_bill.view', x.org_project_id, x.org_site_id)) continue;
      const stage = x.status === 'DRAFT' || x.status === 'RETURNED' ? 'PREPARED' : x.status === 'SUBMITTED' ? 'IN_APPROVAL' : x.inv_ar === 'LINKED' || x.inv_ar === 'HANDED' ? 'PAYABLE' : x.invoiced ? 'INVOICED' : x.cert_status === 'APPROVED' ? 'CERTIFIED' : x.client_state === 'SENT' ? 'WITH_CLIENT' : 'APPROVED';
      rows.push({ type: 'CLIENT', id: x.id, ref: x.bill_no, party: x.contract_no, projectId: x.org_project_id, amount: rs(x.net_paise), stage, date: x.sent_on ?? x.period_to, link: `/bill/client-bills?id=${x.id}` });
    }
    if (!q.type || q.type === 'SUBCONTRACTOR') for (const x of db.prepare(`SELECT x.*, s.legal_name FROM bill_sub_bills x JOIN mdm_partners s ON s.id = x.subcontractor_id WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.status NOT IN ('CANCELLED', 'REJECTED')${pf}${dp('period_to')} ORDER BY x.id DESC LIMIT 300`).all(actor.companyId, ...pa, ...da)) {
      if (!may(actor, 'bill.sub_bill.view', x.org_project_id, x.org_site_id)) continue;
      const stage = ['DRAFT', 'RETURNED'].includes(x.status) ? 'PREPARED' : x.status === 'SUBMITTED' ? 'IN_APPROVAL' : x.payable_state === 'POSTED' ? 'PAYABLE' : 'APPROVED';
      rows.push({ type: 'SUBCONTRACTOR', id: x.id, ref: x.bill_no, party: x.legal_name, projectId: x.org_project_id, amount: rs(x.net_paise), stage, date: x.period_to, link: `/bill/sub-bills?id=${x.id}` });
    }
    if (!q.type || q.type === 'VENDOR') for (const x of db.prepare(`SELECT x.*, v.legal_name FROM bill_vendor_invoices x JOIN mdm_partners v ON v.id = x.vendor_id WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.status NOT IN ('CANCELLED', 'REJECTED')${pf}${dp('invoice_date')} ORDER BY x.id DESC LIMIT 300`).all(actor.companyId, ...pa, ...da)) {
      if (!may(actor, 'bill.vendor_invoice.view', x.org_project_id, x.org_site_id)) continue;
      const stage = x.blocked === 1 ? 'BLOCKED' : ['DRAFT', 'RETURNED'].includes(x.status) ? 'PREPARED' : x.status === 'SUBMITTED' ? 'IN_APPROVAL' : x.ap_state === 'LINKED' ? 'PAYABLE' : 'APPROVED';
      rows.push({ type: 'VENDOR', id: x.id, ref: x.invoice_no, party: x.legal_name, projectId: x.org_project_id, amount: rs(x.payable_paise || x.total_paise), stage, date: x.invoice_date, link: `/bill/vendor-invoices?id=${x.id}` });
    }
    return rows.map((r) => ({ ...r, project: pcode(r.projectId), stageLabel: STAGE[r.stage], typeLabel: TYPE[r.type], ageDays: days(r.date), open: r.stage !== 'PAYABLE' })).filter((r) => !q.stage || r.stage === q.stage);
  }
  const hub = {
    dashboard(actor, q = {}) {
      gate(actor, 'bill.invoice_hub.view', 'see the invoice hub'); const rows = collect(actor, q); const sum = (list) => Math.round(list.reduce((n, r) => n + r.amount, 0) * 100) / 100;
      const byType = Object.fromEntries(Object.keys(TYPE).map((t) => { const l = rows.filter((r) => r.type === t); return [t, { count: l.length, amount: sum(l), open: l.filter((r) => r.open).length }]; }));
      const stages = Object.keys(STAGE).map((s) => { const l = rows.filter((r) => r.stage === s); return { stage: s, label: STAGE[s], count: l.length, amount: sum(l) }; });
      const ageing = BUCKETS.map(([b, lo, hi]) => { const l = rows.filter((r) => r.open && r.ageDays >= lo && r.ageDays <= hi); return { bucket: b, count: l.length, amount: sum(l) }; });
      const mine = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.map((t) => ({ id: t.id, inst: t.instance ?? {} })).filter((t) => String(t.inst.docType ?? t.inst.doc_type ?? '').startsWith('BILL_')).map((t) => ({ id: t.id, docType: t.inst.docType ?? t.inst.doc_type, ref: t.inst.ref ?? null, title: t.inst.title ?? t.inst.ref ?? '' }));
      return { totals: { count: rows.length, amount: sum(rows), open: rows.filter((r) => r.open).length, blocked: rows.filter((r) => r.stage === 'BLOCKED').length, inApproval: rows.filter((r) => r.stage === 'IN_APPROVAL').length }, byType, stages, ageing, mine, rows: [...rows].sort((a, b) => b.ageDays - a.ageDays).slice(0, 100), asOf: today() };
    },
  };
  return { invoiceHub: hub };
}
