import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the stores and stock pages (part 16.01). Balances, values, availability, valuation and what a person may do come from the server; the pages never work them out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const fmtRs = (paise) => (paise == null ? '—' : `₹ ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
export const STORE_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', ACTIVE: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', INACTIVE: 'CANCELLED' };
export const ADJ_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const get = async (p) => (await api.get(`/inv${p}`)).data; const post = async (p, b) => (await api.post(`/inv${p}`, b ?? {}, idem())).data; const patch = async (p, b) => (await api.patch(`/inv${p}`, b, idem())).data;
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o ?? {})) if (v !== '' && v != null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
export const iv = {
  projects: () => get('/projects'), items: (q) => get(`/items${qs({ q })}`), dashboard: (q) => get(`/dashboard${qs(q)}`), integrity: () => get('/integrity'),
  storeOptions: () => get('/stores/options'), store: (id) => get(`/stores/${id}`), storeCreate: (b) => post('/stores', b), storeUpdate: (id, b) => patch(`/stores/${id}`, b), storeAct: (id, action, b) => post(`/stores/${id}/${action}`, b), storeHistory: (id) => get(`/stores/${id}/history`),
  binAdd: (id, b) => post(`/stores/${id}/bins`, b), binRemove: async (id) => (await api.delete(`/inv/bins/${id}`)).data,
  stores: () => api.get('/inv/stores?pageSize=100').then((r) => r.data),
  card: (q) => get(`/ledger${qs(q)}`), valuation: (q) => get(`/valuation${qs(q)}`), reverse: (id, reason) => post(`/ledger/${id}/reverse`, { reason }),
  move: (b) => post('/movements', b), transfer: (b) => post('/transfers', b), inspection: (b) => post('/inspection', b), opening: (rows) => post('/opening-stock', { rows }),
  reservations: (q) => get(`/reservations${qs(q)}`), reserve: (b) => post('/reservations', b), release: (id, reason) => post(`/reservations/${id}/release`, { reason }),
  adj: (id) => get(`/adjustments/${id}`), adjCreate: (b) => post('/adjustments', b), adjUpdate: (id, b) => patch(`/adjustments/${id}`, b), adjAct: (id, action, b) => post(`/adjustments/${id}/${action}`, b), adjHistory: (id) => get(`/adjustments/${id}/history`),
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
};
export const GATE_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', AT_GATE: 'IN_REVIEW', UNLOADING: 'IN_REVIEW', HANDED_OVER: 'APPROVED', EXITED: 'APPROVED', APPROVED: 'APPROVED', OUT: 'IN_REVIEW', CLOSED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—');
/** Gate control (part 16.02): the server decides every flag, variance and what a person may do. */
export const gt = {
  options: () => get('/gate/options'), dashboard: (q) => get(`/gate/dashboard${qs(q)}`), vendors: (q) => get(`/gate/vendors${qs({ q })}`), pos: (q) => get(`/gate/purchase-orders${qs(q)}`), check: (b) => post('/gate/check', b),
  appointments: () => get('/appointments?pageSize=50&filter[status]=SCHEDULED'),
  inward: (id) => get(`/inward/${id}`), inCreate: (b) => post('/inward', b), inUpdate: (id, b) => patch(`/inward/${id}`, b), inAct: (id, action, b) => post(`/inward/${id}/${action}`, b), inHistory: (id) => get(`/inward/${id}/history`),
  pass: (id) => get(`/passes/${id}`), passCreate: (b) => post('/passes', b), passUpdate: (id, b) => patch(`/passes/${id}`, b), passAct: (id, action, b) => post(`/passes/${id}/${action}`, b), passHistory: (id) => get(`/passes/${id}/history`), verify: (b) => post('/passes/verify', b),
  passDelete: async (id) => (await api.delete(`/inv/passes/${id}`)).data,
  waiting: () => get('/inward?pageSize=50&filter[status]=HANDED_OVER&sort=-date'),
};
export const GRN_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
/** Goods receipts and returns to vendor (part 16.03): the server works out rejected quantities, excess, values, what may go back and what a person may do. */
export const gr = {
  summary: () => get('/grns/summary'), ready: () => get('/grns/ready'), prefill: (q) => get(`/grns/prefill${qs(q)}`),
  grn: (id) => get(`/grns/${id}`), create: (b) => post('/grns', b), update: (id, b) => patch(`/grns/${id}`, b), act: (id, action, b) => post(`/grns/${id}/${action}`, b), history: (id) => get(`/grns/${id}/history`),
  rtv: (id) => get(`/rtvs/${id}`), rtvCreate: (b) => post('/rtvs', b), rtvUpdate: (id, b) => patch(`/rtvs/${id}`, b), rtvAct: (id, action, b) => post(`/rtvs/${id}/${action}`, b), rtvHistory: (id) => get(`/rtvs/${id}/history`),
};
export const ISSUE_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'IN_REVIEW', POSTED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
/** Material issue, site returns and the free-issue ledger (part 16.04): authorised quantities, excess, values and what a person may do come from the server. */
export const is = {
  summary: () => get('/issues/summary'), was: () => get('/issues/work-authorisations'), targets: (q) => get(`/issues/targets${qs({ q })}`), prefill: (q) => get(`/issues/prefill${qs(q)}`),
  issue: (id) => get(`/issues/${id}`), create: (b) => post('/issues', b), update: (id, b) => patch(`/issues/${id}`, b), act: (id, action, b) => post(`/issues/${id}/${action}`, b), history: (id) => get(`/issues/${id}/history`),
  ret: (id) => get(`/site-returns/${id}`), retCreate: (b) => post('/site-returns', b), retAct: (id, action, b) => post(`/site-returns/${id}/${action}`, b), retHistory: (id) => get(`/site-returns/${id}/history`),
  freeProjects: () => get('/free-issue/projects'), free: (q) => get(`/free-issue${qs(q)}`), drill: (q) => get(`/free-issue/drill${qs(q)}`), reconcile: (b) => post('/free-issue/reconcile', b), certify: (rows) => post('/free-issue/certified', { rows }),
};
export const TRANSFER_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'IN_REVIEW', IN_TRANSIT: 'IN_REVIEW', RECEIVED: 'APPROVED', DISCREPANCY: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
/** Stock transfers and in-transit stock (part 16.05): quantities in transit, values, what is held and what a person may do come from the server. */
export const tr = {
  summary: () => get('/transfers/summary'), options: () => get('/transfers/options'), prefill: (q) => get(`/transfers/prefill${qs(q)}`),
  transfer: (id) => get(`/transfers/${id}`), create: (b) => post('/transfers', b), update: (id, b) => patch(`/transfers/${id}`, b), act: (id, action, b) => post(`/transfers/${id}/${action}`, b), history: (id) => get(`/transfers/${id}/history`),
  resolve: (id, did, b) => post(`/transfers/${id}/discrepancies/${did}/resolve`, b), inTransit: (q) => get(`/in-transit${qs(q)}`), incoming: () => get('/transfers?pageSize=50&filter[status]=IN_TRANSIT'),
};
export const COUNT_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'IN_REVIEW', COUNTING: 'IN_REVIEW', REVIEW: 'IN_REVIEW', ADJUSTED: 'IN_REVIEW', CLOSED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', HELD: 'IN_REVIEW', DISPOSED: 'APPROVED' };
/** Physical verification, scrap and expiry (part 16.06): book quantities are never sent to a counter, and variance values, bands and what a person may do come from the server. */
export const cn = {
  due: () => get('/count-plans/due'), queue: () => get('/count-plans/queue'), plan: (id) => get(`/count-plans/${id}`), sheet: (id) => get(`/count-plans/${id}/sheet`), create: (b) => post('/count-plans', b), update: (id, b) => patch(`/count-plans/${id}`, b),
  act: (id, action, b) => post(`/count-plans/${id}/${action}`, b), history: (id) => get(`/count-plans/${id}/history`), counts: (id, b) => post(`/count-plans/${id}/counts`, b), review: (id, reasons) => post(`/count-plans/${id}/review`, { reasons }), adjust: (id) => post(`/count-plans/${id}/adjustment`),
  variance: (q) => get(`/count-variance${qs(q)}`), entries: (q) => get(`/scrap-entries${qs(q)}`), entryCreate: (b) => post('/scrap-entries', b), entryCancel: (id, reason) => post(`/scrap-entries/${id}/cancel`, { reason }),
  disposal: (id) => get(`/scrap-disposals/${id}`), disposalCreate: (b) => post('/scrap-disposals', b), disposalUpdate: (id, b) => patch(`/scrap-disposals/${id}`, b), disposalAct: (id, action, b) => post(`/scrap-disposals/${id}/${action}`, b), disposalHistory: (id) => get(`/scrap-disposals/${id}/history`),
  expiry: (q) => get(`/expiry${qs(q)}`), dealers: (q) => get(`/gate/vendors${qs({ q })}`),
};
/** Reorder control, stock ageing, labels and scanning (part 16.07): projections, ageing, redeployment and label codes come from the server. */
export const ro = {
  options: () => get('/reorder-params/options'), params: (storeId) => get(`/reorder-params${qs({ storeId })}`), change: (id) => get(`/reorder-changes/${id}`), changeCreate: (b) => post('/reorder-changes', b), changeUpdate: (id, b) => patch(`/reorder-changes/${id}`, b),
  changeAct: (id, action, b) => post(`/reorder-changes/${id}/${action}`, b), changeHistory: (id) => get(`/reorder-changes/${id}/history`), recalc: (storeId) => post('/reorder-changes/recalc', { storeId }), importRows: (rows) => post('/reorder-changes/import', { rows }),
  summary: () => get('/reorder-suggestions/summary'), suggestions: (status) => get(`/reorder-suggestions?pageSize=100${status ? `&filter[status]=${status}` : ''}`), run: () => post('/reorder-suggestions/run'), convert: (ids) => post('/reorder-suggestions/convert', { ids }), dismiss: (id, reason) => post(`/reorder-suggestions/${id}/dismiss`, { reason }),
  ageing: (q) => get(`/ageing${qs(q)}`), redeploy: () => get('/redeployment'), targets: (q) => get(`/labels/targets${qs(q)}`), print: (b) => post('/labels', b), labelLog: () => get('/labels/log'), scan: (code) => get(`/scan${qs({ code })}`),
};
/** Returnable site assets (part 16.08): quantities by location, hire charges, recoveries and what a person may do come from the server. */
export const ra = {
  dashboard: () => get('/rta/dashboard'), reconciliation: () => get('/rta/reconciliation'), options: () => get('/rta/options'), holdings: (itemId) => get(`/rta/holdings${qs({ itemId })}`),
  catalogue: () => get('/rta/catalogue'), candidates: () => get('/rta/catalogue/candidates'), assetCreate: (b) => post('/rta/catalogue', b), assetUpdate: (id, b) => patch(`/rta/catalogue/${id}`, b),
  movement: (id) => get(`/rta/movements/${id}`), create: (b) => post('/rta/movements', b), update: (id, b) => patch(`/rta/movements/${id}`, b), act: (id, action, b) => post(`/rta/movements/${id}/${action}`, b), history: (id) => get(`/rta/movements/${id}/history`),
  hire: (q) => get(`/rta/hire${qs(q)}`), bill: (id, b) => post(`/rta/hire/${id}/bill`, b), recoveries: (q) => get(`/rta/recoveries${qs(q)}`), recUpdate: (id, b) => patch(`/rta/recoveries/${id}`, b), recAct: (id, action, b) => post(`/rta/recoveries/${id}/${action}`, b),
};
/** Tools and small-asset custody (part 16.09): conditions, calibration state, what a person may do and the custody history come from the server. */
export const at = {
  options: () => get('/small-assets/options'), mine: () => get('/small-assets/mine'), asset: (id) => get(`/small-assets/${id}`), create: (b) => post('/small-assets', b), update: (id, b) => patch(`/small-assets/${id}`, b), act: (id, action, b) => post(`/small-assets/${id}/${action}`, b), history: (id) => get(`/small-assets/${id}/history`), tag: (id) => get(`/small-assets/${id}/tag`),
  loss: (id) => get(`/loss-reports/${id}`), lossCreate: (b) => post('/loss-reports', b), lossUpdate: (id, b) => patch(`/loss-reports/${id}`, b), lossAct: (id, action, b) => post(`/loss-reports/${id}/${action}`, b), lossHistory: (id) => get(`/loss-reports/${id}/history`),
  statement: (employeeId) => get(`/custody-statement${qs({ employeeId })}`), calibration: (days) => get(`/calibration-due${qs({ days })}`),
};
/** A file the server makes (print), saved by the browser. */
export async function download(path, name) {
  const res = await fetch(`/api/v1/inv${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** A CSV the browser saves, with cells that start like a formula neutralised. */
export function saveCsv(name, rows) {
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { authHeaders };
