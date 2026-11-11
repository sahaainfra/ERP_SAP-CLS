import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the procurement pages (part 15.01). Checks, availability, rates, totals, bands and statuses come from the server; the pages never work them out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const addDays = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
export const STATUS_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', EMERGENCY: 'AT_RISK', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CLOSED: 'COMPLETED', SUPERSEDED: 'CANCELLED' };
export const CHECK_TONE = { OK: 'APPROVED', WARNING: 'RETURNED', BLOCK: 'REJECTED', NOT_CHECKED: 'DRAFT', COVERED: 'REJECTED', PARTIAL: 'RETURNED', NONE: 'APPROVED', NA: 'DRAFT' };
export const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const fmtRs = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

/** A file the server makes (print), saved by the browser. */
export async function download(path, name) {
  const res = await fetch(`/api/v1/proc${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const get = async (p) => (await api.get(`/proc${p}`)).data; const post = async (p, b, ok) => (await api.post(`/proc${p}`, b ?? {}, ok ?? idem())).data;
export const pc = {
  projects: () => get('/projects'),
  mrOptions: (projectId) => get(`/material-requests/options?projectId=${projectId}`),
  availability: (projectId, siteId, itemId) => get(`/material-requests/availability?projectId=${projectId}${siteId ? `&siteId=${siteId}` : ''}&itemId=${itemId}`),
  mr: (id) => get(`/material-requests/${id}`),
  mrCreate: (b) => post('/material-requests', b),
  mrUpdate: async (id, b) => (await api.patch(`/proc/material-requests/${id}`, b, idem())).data,
  mrDelete: async (id) => (await api.delete(`/proc/material-requests/${id}`)).data,
  mrAct: (id, action, b) => post(`/material-requests/${id}/${action}`, b),
  mrHistory: (id) => get(`/material-requests/${id}/history`),
  prOptions: (projectId) => get(`/requisitions/options?projectId=${projectId}`),
  rate: (projectId, itemId, wbsId, costCodeId) => get(`/requisitions/rate?projectId=${projectId}&itemId=${itemId}${wbsId ? `&wbsId=${wbsId}` : ''}${costCodeId ? `&costCodeId=${costCodeId}` : ''}`),
  pr: (id) => get(`/requisitions/${id}`),
  prChecks: (id) => get(`/requisitions/${id}/checks`),
  prCreate: (b) => post('/requisitions', b),
  prUpdate: async (id, b) => (await api.patch(`/proc/requisitions/${id}`, b, idem())).data,
  prDelete: async (id) => (await api.delete(`/proc/requisitions/${id}`)).data,
  prAct: (id, action, b) => post(`/requisitions/${id}/${action}`, b),
  prHistory: (id) => get(`/requisitions/${id}/history`),
  preview: (b) => post('/requisitions/consolidate/preview', b, {}),
  consolidate: (b) => post('/requisitions/consolidate', b),
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
  approvedMrs: async (projectId) => (await api.get(`/proc/material-requests?filter[status]=APPROVED&filter[projectId]=${projectId}&pageSize=100`)).data,
};
