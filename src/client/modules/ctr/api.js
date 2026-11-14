import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the contract pages (part 21.01 onward). What a person may do and every result come from the server; the pages never work them out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export { fmtDate } from '../inv/api.js';
export const CTR_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
const get = async (p) => (await api.get(`/ctr${p}`)).data; const post = async (p, b) => (await api.post(`/ctr${p}`, b ?? {}, idem())).data; const patch = async (p, b) => (await api.patch(`/ctr${p}`, b, idem())).data;
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o ?? {})) if (v !== '' && v != null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
export const ctr = {
  one: (kind, id) => get(`${kind}/${id}`), make: (kind, b) => post(kind, b), edit: (kind, id, b) => patch(`${kind}/${id}`, b), act: (kind, id, action, b) => post(`${kind}/${id}/${action}`, b), history: (kind, id) => get(`${kind}/${id}/history`),
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
  get, post, patch, put: async (p, b) => (await api.put(`/ctr${p}`, b, idem())).data,
  remove: async (p) => { const res = await fetch(`/api/v1/ctr${p}`, { method: 'DELETE', headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); return (await res.json()).data; },
  exportFile: async (path, name) => { const res = await fetch(`/api/v1/ctr${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); },
};
