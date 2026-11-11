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
  // part 14.02: the daily progress report
  dprSites: async () => (await api.get('/site/dprs/sites')).data,
  dprOptions: async (siteId) => (await api.get(`/site/dprs/options?siteId=${siteId}`)).data,
  dprPrefill: async (siteId, date, scope, supervisor) => (await api.get(`/site/dprs/prefill?siteId=${siteId}&date=${date}${scope ? `&scope=${scope}` : ''}${supervisor ? `&supervisor=${encodeURIComponent(supervisor)}` : ''}`)).data,
  dpr: async (id) => (await api.get(`/site/dprs/${id}`)).data,
  createDpr: async (b) => (await api.post('/site/dprs', b, idem())).data,
  updateDpr: async (id, b) => (await api.patch(`/site/dprs/${id}`, b, idem())).data,
  removeDpr: async (id) => (await api.delete(`/site/dprs/${id}`)).data,
  dprAct: async (id, action, b = {}) => (await api.post(`/site/dprs/${id}/${action}`, b, idem())).data,
  dprHistory: async (id) => (await api.get(`/site/dprs/${id}/history`)).data,
  dprPhoto: async (id, fileId, b) => (await api.patch(`/site/dprs/${id}/photos/${fileId}`, b, idem())).data,
  dprMissing: async (q = '') => (await api.get(`/site/dprs/missing?${q}`)).data,
  dprCompliance: async (q = '') => (await api.get(`/site/dprs/compliance?${q}`)).data,
  dprReport: async (q) => (await api.get(`/site/dprs/report?${q}`)).data,
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
};
export const DPR_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const WEATHER_CODES = ['CLEAR', 'CLOUDY', 'RAIN', 'HEAVY_RAIN', 'STORM', 'FOG', 'HOT', 'COLD'];
export const NOTE_TYPES = ['HINDRANCE', 'VISITOR', 'INSTRUCTION', 'QUALITY', 'SAFETY', 'NEXT_DAY'];
export async function download(path, name) {
  const res = await fetch(`/api/v1/site${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click();
}
export const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export async function openPrint(path) {
  const w = window.open('', '_blank');
  const res = await fetch(`/api/v1/site${path}`, { headers: authHeaders() }); if (!res.ok) { w?.close(); throw new Error(String(res.status)); }
  const url = URL.createObjectURL(await res.blob()); if (w) w.location.href = url; else window.location.href = url;
}
