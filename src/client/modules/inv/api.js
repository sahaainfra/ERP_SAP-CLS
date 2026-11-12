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
