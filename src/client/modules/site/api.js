import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the site execution pages (part 14.01). Checks, remaining quantities, variances and statuses come from the server; the pages never work them out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const WA_TONE = { DRAFT: 'DRAFT', EMERGENCY: 'AT_RISK', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CLOSED: 'COMPLETED', SUPERSEDED: 'CANCELLED' };
export const FRONT_TONE = { OPEN: 'DRAFT', BLOCKED: 'REJECTED', IN_PROGRESS: 'IN_REVIEW', COMPLETED: 'COMPLETED' };
export const DP_TONE = { DRAFT: 'DRAFT', ISSUED: 'APPROVED', CANCELLED: 'CANCELLED' };
export const CHECK_TONE = { PASS: 'APPROVED', WARN: 'RETURNED', FAIL: 'REJECTED', NA: 'DRAFT' };
export const WA_STATUSES = Object.keys(WA_TONE);
export const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const st = {
  sites: async () => (await api.get('/site/sites')).data,
  board: async (siteId, date) => (await api.get(`/site/board?siteId=${siteId}&date=${date}`)).data,
  fronts: async (siteId) => (await api.get(`/site/work-fronts?siteId=${siteId}`)).data,
  createFront: async (b) => (await api.post('/site/work-fronts', b, idem())).data,
  updateFront: async (id, b) => (await api.patch(`/site/work-fronts/${id}`, b, idem())).data,
  removeFront: async (id) => (await api.delete(`/site/work-fronts/${id}`)).data,
  options: async (siteId, date) => (await api.get(`/site/work-authorisations/options?siteId=${siteId}&date=${date}`)).data,
  wa: async (id) => (await api.get(`/site/work-authorisations/${id}`)).data,
  createWa: async (b) => (await api.post('/site/work-authorisations', b, idem())).data,
  updateWa: async (id, b) => (await api.patch(`/site/work-authorisations/${id}`, b, idem())).data,
  removeWa: async (id) => (await api.delete(`/site/work-authorisations/${id}`)).data,
  move: async (id, workFrontId) => (await api.post(`/site/work-authorisations/${id}/move`, { workFrontId }, idem())).data,
  waAct: async (id, action, b = {}) => (await api.post(`/site/work-authorisations/${id}/${action}`, b, idem())).data,
  close: async (id, b) => (await api.post(`/site/work-authorisations/${id}/close`, b, idem())).data,
  history: async (id) => (await api.get(`/site/work-authorisations/${id}/history`)).data,
  daily: async (id) => (await api.get(`/site/daily-plans/${id}`)).data,
  createDaily: async (b) => (await api.post('/site/daily-plans', b, idem())).data,
  updateDaily: async (id, b) => (await api.patch(`/site/daily-plans/${id}`, b, idem())).data,
  dailyAct: async (id, action, b = {}) => (await api.post(`/site/daily-plans/${id}/${action}`, b, idem())).data,
  mobile: async (date) => (await api.get(`/site/wa-mobile?date=${date}`)).data,
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, { action, comment }, idem())).data,
};
export const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export async function openPrint(path) {
  const w = window.open('', '_blank');
  const res = await fetch(`/api/v1/site${path}`, { headers: authHeaders() }); if (!res.ok) { w?.close(); throw new Error(String(res.status)); }
  const url = URL.createObjectURL(await res.blob()); if (w) w.location.href = url; else window.location.href = url;
}
