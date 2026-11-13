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

// Requisitions, allocations, operators and the availability calendar (part 17.02).
export const REQ_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const PHASE_TONE = { PLANNED: 'DRAFT', IN_TRANSIT: 'IN_REVIEW', ON_SITE: 'APPROVED', RELEASED: 'CANCELLED' };
export const pa = {
  options: () => get('/allocations/options'), reqOptions: () => get('/requisitions/options'), availability: (q) => get(`/availability${qs(q)}`), gantt: (q) => get(`/gantt${qs(q)}`),
  req: (id) => get(`/requisitions/${id}`), reqCreate: (b) => post('/requisitions', b), reqUpdate: (id, b) => patch(`/requisitions/${id}`, b), reqAct: (id, action, b) => post(`/requisitions/${id}/${action}`, b), reqHistory: (id) => get(`/requisitions/${id}/history`),
  alloc: (id) => get(`/allocations/${id}`), allocCreate: (b) => post('/allocations', b), allocUpdate: (id, b) => patch(`/allocations/${id}`, b), allocDates: (id, b) => patch(`/allocations/${id}/dates`, b), allocAct: (id, action, b) => post(`/allocations/${id}/${action}`, b), allocHistory: (id) => get(`/allocations/${id}/history`),
  candidates: (q) => get(`/operators/candidates${qs({ q })}`), assign: (b) => post('/operators', b), endOperator: (id, reason) => post(`/operators/${id}/end`, { reason }),
  reqList: async (q) => (await api.get(`/plant/requisitions${qs(q)}`)),
};

// Log books, breakdowns and utilisation (part 17.03).
export const LOG_TONE = REQ_TONE;
export const lg = {
  options: (q) => get(`/logs/options${qs(q)}`), log: (id) => get(`/logs/${id}`), create: (b) => post('/logs', b), update: (id, b) => patch(`/logs/${id}`, b), act: (id, action, b) => post(`/logs/${id}/${action}`, b), attach: (id, b) => post(`/logs/${id}/files`, b), history: (id) => get(`/logs/${id}/history`),
  worklist: async (q) => (await api.get(`/plant/logs/worklist${qs(q)}`)), breakdown: (id) => get(`/breakdowns/${id}`), report: (b) => post('/breakdowns', b), resolve: (id, b) => post(`/breakdowns/${id}/resolve`, b),
  utilisation: (q) => get(`/utilisation${qs(q)}`), records: (q) => get(`/utilisation/records${qs(q)}`),
};
