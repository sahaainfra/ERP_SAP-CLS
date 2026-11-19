import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the payroll pages (module pay).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const get = async (p) => (await api.get(`/pay${p}`)).data;
const post = async (p, b) => (await api.post(`/pay${p}`, b ?? {}, idem())).data;
const patch = async (p, b) => (await api.patch(`/pay${p}`, b, idem())).data;
const del = async (p, b) => (await api.delete(`/pay${p}`, idem(), b)).data;
export const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const file = async (path, name) => { const res = await fetch(`/api/v1/pay${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
export const decide = async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data;

// ---- 24.01 ----
export const setup = {
  components: () => get('/components'),
  saveComponent: (b) => post('/components', b),
  testFormula: (b) => post('/components/test', b),
  structures: (f) => get(`/structures?${q(f)}`),
  structure: (id) => get(`/structures/${id}`),
  saveStructure: (b) => post('/structures', b),
  preview: (b) => post('/structures/preview', b),
  employees: (f) => get(`/employees?${q(f)}`),
  assignments: (f) => get(`/assignments?${q(f)}`),
  assignment: (id) => get(`/assignments/${id}`),
  createAssignment: (b) => post('/assignments', b),
  updateAssignment: (id, b) => patch(`/assignments/${id}`, b),
  removeAssignment: (id) => del(`/assignments/${id}`),
  act: (id, action, b) => post(`/assignments/${id}/${action}`, b),
  arrears: (f) => get(`/arrears?${q(f)}`),
  params: (f) => get(`/statutory-params?${q(f)}`),
  param: (id) => get(`/statutory-params/${id}`),
  createParam: (b) => post('/statutory-params', b),
  paramAct: (id, action, b) => post(`/statutory-params/${id}/${action}`, b),
  calendar: (f) => get(`/calendar?${q(f)}`),
  generateCalendar: (b) => post('/calendar/generate', b),
  updatePeriod: (id, b) => patch(`/calendar/${id}`, b),
};
