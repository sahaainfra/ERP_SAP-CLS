import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the planning pages (part 13.01). Every date and float comes from the server (BR-01): the pages never work one out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const STATUS_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const CAL_TONE = { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' };
export const TYPES = ['TASK', 'MILESTONE', 'LOE', 'SUMMARY'];
export const DEPS = ['FS', 'SS', 'FF', 'SF'];
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const pl = {
  projects: async () => (await api.get('/plan/projects')).data,
  options: async (projectId) => (await api.get(`/plan/options?projectId=${projectId}`)).data,
  schedule: async (id) => (await api.get(`/plan/schedules/${id}`)).data,
  createSchedule: async (b) => (await api.post('/plan/schedules', b, idem())).data,
  updateSchedule: async (id, b) => (await api.patch(`/plan/schedules/${id}`, b, idem())).data,
  act: async (id, action, b = {}) => (await api.post(`/plan/schedules/${id}/${action}`, b, idem())).data,
  calculate: async (id) => (await api.post(`/plan/schedules/${id}/calculate`, {}, idem())).data,
  progress: async (id, b) => (await api.post(`/plan/schedules/${id}/update-progress`, b, idem())).data,
  history: async (id) => (await api.get(`/plan/schedules/${id}/history`)).data,
  activities: async (id, q) => (await api.get(`/plan/schedules/${id}/activities?${q}`)).data,
  addActivity: async (id, b) => (await api.post(`/plan/schedules/${id}/activities`, b, idem())).data,
  bulk: async (id, b) => (await api.patch(`/plan/schedules/${id}/activities`, b, idem())).data,
  updateActivity: async (id, b) => (await api.patch(`/plan/activities/${id}`, b, idem())).data,
  removeActivity: async (id) => (await api.delete(`/plan/activities/${id}`)).data,
  link: async (id, b) => (await api.post(`/plan/schedules/${id}/dependencies`, b, idem())).data,
  unlink: async (id) => (await api.delete(`/plan/dependencies/${id}`)).data,
  preview: async (id, b) => (await api.post(`/plan/schedules/${id}/generate/preview`, b)).data,
  generate: async (id, b) => (await api.post(`/plan/schedules/${id}/generate`, b, idem())).data,
  critical: async (id, near) => (await api.get(`/plan/schedules/${id}/critical?near=${near}`)).data,
  calendars: async () => (await api.get('/plan/calendars')).data,
  createCalendar: async (b) => (await api.post('/plan/calendars', b, idem())).data,
  calendarAct: async (id, action, b = {}) => (await api.post(`/plan/calendars/${id}/${action}`, b, idem())).data,
  calendarDays: async (id, from, to) => (await api.get(`/plan/calendars/${id}/days?from=${from}&to=${to}`)).data,
  // part 13.02: the Gantt, its edits, resources, availability, histograms and the programme
  gantt: async (id) => (await api.get(`/plan/schedules/${id}/gantt`)).data,
  ganttCheck: async (id, b) => (await api.post(`/plan/schedules/${id}/gantt/check`, b)).data,
  ganttEdit: async (id, b) => (await api.post(`/plan/schedules/${id}/gantt/edits`, b, idem())).data,
  ganttUndo: async (id, b = {}) => (await api.post(`/plan/schedules/${id}/gantt/undo`, b, idem())).data,
  histogram: async (id, q) => (await api.get(`/plan/schedules/${id}/histogram?${q}`)).data,
  drill: async (id, q) => (await api.get(`/plan/schedules/${id}/histogram/drill?${q}`)).data,
  resourceOptions: async (projectId, type, q = '') => (await api.get(`/plan/resource-options?projectId=${projectId ?? ''}&type=${type ?? ''}&q=${encodeURIComponent(q)}`)).data,
  resources: async (activityId) => (await api.get(`/plan/activities/${activityId}/resources`)).data,
  saveResources: async (activityId, b) => (await api.put(`/plan/activities/${activityId}/resources`, b, idem())).data,
  norms: async (activityId) => (await api.get(`/plan/activities/${activityId}/resources/norms`)).data,
  capacity: async (projectId) => (await api.get(`/plan/capacity?projectId=${projectId ?? ''}`)).data,
  createCapacity: async (b) => (await api.post('/plan/capacity', b, idem())).data,
  capacityAct: async (id, action, b = {}) => (await api.post(`/plan/capacity/${id}/${action}`, b, idem())).data,
};
/** The programme as text (the SVG image) for the preview and the PNG. */
export async function programmeSvg(id, q) {
  const res = await fetch(`/api/v1/plan/schedules/${id}/programme?format=svg&${q}`, { headers: authHeaders() }); if (!res.ok) { const e = await res.json().catch(() => null); throw Object.assign(new Error(e?.error?.message ?? String(res.status)), { status: res.status, correlationId: e?.error?.correlationId }); }
  return res.text();
}
/** An SVG drawn on a canvas and saved as a PNG (twice the size). */
export async function svgToPng(svg, name) {
  const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  const c = document.createElement('canvas'); c.width = img.width * 2; c.height = img.height * 2; const g = c.getContext('2d'); g.scale(2, 2); // the image has its own white page g.drawImage(img, 0, 0); URL.revokeObjectURL(url);
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = name; a.click();
}
export const RES_TYPES = ['LABOUR', 'PLANT', 'MATERIAL'];
export const ordOf = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
export const isoOf = (ord) => new Date(ord * 86_400_000).toISOString().slice(0, 10);
export const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export async function download(path, name) {
  const res = await fetch(`/api/v1/plan${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click();
}
export async function openPrint(path) {
  const w = window.open('', '_blank');
  const res = await fetch(`/api/v1/plan${path}`, { headers: authHeaders() }); if (!res.ok) { w?.close(); throw new Error(String(res.status)); }
  const url = URL.createObjectURL(await res.blob()); if (w) w.location.href = url; else window.location.href = url;
}
