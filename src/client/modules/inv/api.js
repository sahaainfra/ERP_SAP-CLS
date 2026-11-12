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
/** A CSV the browser saves, with cells that start like a formula neutralised. */
export function saveCsv(name, rows) {
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { authHeaders };
