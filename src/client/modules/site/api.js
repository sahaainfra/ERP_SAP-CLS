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
  // part 14.03: weather, hindrances, diary and visitors
  wxSites: async () => (await api.get('/site/weather/sites')).data,
  weather: async (id) => (await api.get(`/site/weather/${id}`)).data,
  wxLookup: async (siteId, date) => (await api.get(`/site/weather/lookup?siteId=${siteId}&date=${date}`)).data,
  wxMonthly: async (q) => (await api.get(`/site/weather/monthly?${q}`)).data,
  createWeather: async (b) => (await api.post('/site/weather', b, idem())).data,
  updateWeather: async (id, b) => (await api.patch(`/site/weather/${id}`, b, idem())).data,
  removeWeather: async (id) => (await api.delete(`/site/weather/${id}`)).data,
  fetchWeather: async (b) => (await api.post('/site/weather/fetch', b, idem())).data,
  hinSites: async () => (await api.get('/site/hindrances/sites')).data,
  hinOptions: async (siteId) => (await api.get(`/site/hindrances/options?siteId=${siteId}`)).data,
  hindrance: async (id) => (await api.get(`/site/hindrances/${id}`)).data,
  createHindrance: async (b) => (await api.post('/site/hindrances', b, idem())).data,
  updateHindrance: async (id, b) => (await api.patch(`/site/hindrances/${id}`, b, idem())).data,
  removeHindrance: async (id) => (await api.delete(`/site/hindrances/${id}`)).data,
  hinAct: async (id, action, b = {}) => (await api.post(`/site/hindrances/${id}/${action}`, b, idem())).data,
  hinHistory: async (id) => (await api.get(`/site/hindrances/${id}/history`)).data,
  diarySites: async () => (await api.get('/site/diary/sites')).data,
  diaryEntry: async (id) => (await api.get(`/site/diary/${id}`)).data,
  createDiary: async (b) => (await api.post('/site/diary', b, idem())).data,
  updateDiary: async (id, b) => (await api.patch(`/site/diary/${id}`, b, idem())).data,
  removeDiary: async (id) => (await api.delete(`/site/diary/${id}`)).data,
  signDiary: async (id) => (await api.post(`/site/diary/${id}/sign`, {}, idem())).data,
  signDay: async (b) => (await api.post('/site/diary/sign-day', b, idem())).data,
  visSites: async () => (await api.get('/site/visitors/sites')).data,
  visitor: async (id) => (await api.get(`/site/visitors/${id}`)).data,
  createVisitor: async (b) => (await api.post('/site/visitors', b, idem())).data,
  updateVisitor: async (id, b) => (await api.patch(`/site/visitors/${id}`, b, idem())).data,
  removeVisitor: async (id) => (await api.delete(`/site/visitors/${id}`)).data,
  // part 14.04: site instructions and memos
  insSites: async () => (await api.get('/site/instructions/sites')).data,
  insOptions: async (siteId) => (await api.get(`/site/instructions/options?siteId=${siteId}`)).data,
  insTracker: async (q = '') => (await api.get(`/site/instructions/tracker?${q}`)).data,
  instruction: async (id) => (await api.get(`/site/instructions/${id}`)).data,
  createInstruction: async (b) => (await api.post('/site/instructions', b, idem())).data,
  updateInstruction: async (id, b) => (await api.patch(`/site/instructions/${id}`, b, idem())).data,
  removeInstruction: async (id) => (await api.delete(`/site/instructions/${id}`)).data,
  insAct: async (id, action, b = {}) => (await api.post(`/site/instructions/${id}/${action}`, b, idem())).data,
  insAck: async (id, ackId, action, b = {}) => (await api.post(`/site/instructions/${id}/recipients/${ackId}/${action}`, b, idem())).data,
  insHistory: async (id) => (await api.get(`/site/instructions/${id}/history`)).data,
  // part 14.05: progress, periods and reports
  prgProjects: async () => (await api.get('/site/progress/projects')).data,
  prgDashboard: async (q) => (await api.get(`/site/progress/dashboard?${q}`)).data,
  prgReport: async (q) => (await api.get(`/site/progress/report?${q}`)).data,
  prgClient: async (q) => (await api.get(`/site/progress/client-report?${q}`)).data,
  periodOptions: async (projectId) => (await api.get(`/site/periods/options?projectId=${projectId}`)).data,
  period: async (id) => (await api.get(`/site/periods/${id}`)).data,
  createPeriod: async (b) => (await api.post('/site/periods', b, idem())).data,
  updatePeriod: async (id, b) => (await api.patch(`/site/periods/${id}`, b, idem())).data,
  removePeriod: async (id) => (await api.delete(`/site/periods/${id}`)).data,
  periodAct: async (id, action, b = {}) => (await api.post(`/site/periods/${id}/${action}`, b, idem())).data,
  periodHistory: async (id) => (await api.get(`/site/periods/${id}/history`)).data,
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
export const HIN_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'AT_RISK', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CLOSED: 'COMPLETED', SUPERSEDED: 'CANCELLED' };
export const HIN_TYPES = ['SITE_NOT_HANDED_OVER', 'DRAWINGS_PENDING', 'UTILITY_SHIFTING', 'LOCAL_ISSUES', 'APPROVALS', 'OTHER'];
export const PARTIES = ['CLIENT', 'CONSULTANT', 'THIRD_PARTY', 'AUTHORITY', 'CONTRACTOR'];
export const DIARY_CATEGORIES = ['GENERAL', 'PROGRESS', 'INSTRUCTION', 'HINDRANCE', 'QUALITY', 'SAFETY', 'MATERIAL', 'VISITOR'];
export const VISITOR_TYPES = ['OFFICIAL', 'CLIENT', 'CONSULTANT', 'AUTHORITY', 'OTHER'];
export const INS_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', OPEN: 'AT_RISK', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CLOSED: 'COMPLETED', SUPERSEDED: 'CANCELLED' };
export const INS_TYPES = ['EI', 'CI', 'ISI', 'MEMO'];
export const PARTY_TYPES = ['SUBCONTRACTOR', 'CREW', 'PERSON'];
export const PRD_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'COMPLETED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const fmtPct = (n) => (n == null ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} %`);
export const fmtRatio = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtRs = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
