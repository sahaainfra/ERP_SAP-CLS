import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the plant pages (part 17.01). Compliance, status rules and what a person may do come from the server; the pages never work them out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export { fmtDate, fmtQty, fmtRs } from '../inv/api.js';
export const EQUIP_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const STATE_TONE = { AVAILABLE: 'APPROVED', DEPLOYED: 'IN_REVIEW', UNDER_MAINTENANCE: 'RETURNED', BREAKDOWN: 'REJECTED', IDLE: 'DRAFT', DEMOBILISED: 'CANCELLED', DISPOSED: 'CANCELLED' };
export const CERT_TONE = { VALID: 'APPROVED', NO_EXPIRY: 'APPROVED', EXPIRING: 'RETURNED', EXPIRED: 'REJECTED', MISSING: 'REJECTED' };
const get = async (p) => (await api.get(`/plant${p}`)).data; const post = async (p, b) => (await api.post(`/plant${p}`, b ?? {}, idem())).data; const patch = async (p, b) => (await api.patch(`/plant${p}`, b, idem())).data;
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o ?? {})) if (v !== '' && v != null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
export const pl = {
  dashboard: (q) => get(`/dashboard${qs(q)}`), drill: (q) => get(`/dashboard/drill${qs(q)}`), options: () => get('/equipment/options'),
  equipment: (id) => get(`/equipment/${id}`), create: (b) => post('/equipment', b), update: (id, b) => patch(`/equipment/${id}`, b), act: (id, action, b) => post(`/equipment/${id}/${action}`, b), history: (id) => get(`/equipment/${id}/history`), tag: (id) => get(`/equipment/${id}/tag`), allocatable: (id) => get(`/equipment/${id}/allocatable`),
  docAdd: (id, b) => post(`/equipment/${id}/documents`, b), docAttach: (id, fileId) => post(`/documents/${id}/file`, { fileId }), docRemove: async (id, reason) => (await api.delete(`/plant/documents/${id}`, undefined, { reason })).data,
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
  myTasks: async () => ((await api.get('/workflow/tasks?mine=assigned')).data?.rows ?? []).filter((t) => String(t.instance?.docType ?? t.instance?.doc_type ?? '').startsWith('PLANT_')).length,
  exportFile: async (q, name, path = '/dashboard/export') => { const res = await fetch(`/api/v1/plant${path}${qs(q)}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); },
};
