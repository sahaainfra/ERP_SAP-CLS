import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the billing pages (part 22.01 on). What a person may do and every quantity come from the server; the pages never work them out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export { fmtDate } from '../inv/api.js';
export const BILL_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o ?? {})) if (v !== '' && v != null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
const get = async (p) => (await api.get(`/bill${p}`)).data; const post = async (p, b) => (await api.post(`/bill${p}`, b ?? {}, idem())).data; const patch = async (p, b) => (await api.patch(`/bill${p}`, b, idem())).data;
const put = async (p, b) => (await api.put(`/bill${p}`, b, idem())).data;
const del = async (p) => { const res = await fetch(`/api/v1/bill${p}`, { method: 'DELETE', headers: authHeaders() }); if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(e?.error?.message ?? String(res.status)), { status: res.status }); } return (await res.json()).data; };
export const bill = {
  get, post, patch, put, del, one: (kind, id) => get(`${kind}/${id}`), act: (kind, id, action, b) => post(`${kind}/${id}/${action}`, b), history: (kind, id) => get(`${kind}/${id}/history`),
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
  exportFile: async (path, name) => { const res = await fetch(`/api/v1/bill${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); },
};
