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

// ---- 24.02 ----
export const runs = {
  readiness: (f) => get(`/runs/readiness?${q(f)}`),
  list: (f) => get(`/runs?${q(f)}`),
  get: (id) => get(`/runs/${id}`),
  create: (b) => post('/runs', b),
  compute: (id) => post(`/runs/${id}/compute`),
  hold: (id, lineId, b) => post(`/runs/${id}/lines/${lineId}/hold`, b),
  act: (id, action, b) => post(`/runs/${id}/${action}`, b),
  remove: (id) => del(`/runs/${id}`),
  variance: (id) => get(`/runs/${id}/variance`),
  inputs: (f) => get(`/inputs?${q(f)}`),
  addInput: (b) => post('/inputs', b),
  myDeclaration: (f) => get(`/declarations/mine?${q(f)}`),
  saveDeclaration: (b) => post('/declarations/mine', b),
  declarations: (f) => get(`/declarations?${q(f)}`),
  verify: (id, b) => post(`/declarations/${id}/verify`, b),
};

// ---- 24.03 ----
const put = async (p, b) => (await api.put(`/pay${p}`, b, idem())).data;
export const wages = {
  options: () => get('/wage-runs/options'),
  list: (f) => get(`/wage-runs?${q(f)}`),
  get: (id) => get(`/wage-runs/${id}`),
  create: (b) => post('/wage-runs', b),
  compute: (id) => post(`/wage-runs/${id}/compute`),
  line: (id, lineId, b) => patch(`/wage-runs/${id}/lines/${lineId}`, b),
  act: (id, action, b) => post(`/wage-runs/${id}/${action}`, b),
  remove: (id) => del(`/wage-runs/${id}`),
  pay: (id, b) => post(`/wage-runs/${id}/pay`, b),
  ack: (id, lineId, b) => post(`/wage-runs/${id}/lines/${lineId}/acknowledge`, b),
  register: (f) => get(`/wage-register?${q(f)}`),
  worklist: () => get('/wage-checks/worklist'),
  check: (id) => get(`/wage-checks/${id}`),
  createCheck: (b) => post('/wage-checks', b),
  sheet: (id, b) => put(`/wage-checks/${id}/sheet`, b),
  attach: (id, b) => post(`/wage-checks/${id}/attach`, b),
  submitCheck: (id) => post(`/wage-checks/${id}/submit`),
  decide: (id, b) => post(`/wage-checks/${id}/decide`, b),
};
/** Opens the wage slips (an HTML page the browser prints) in a new tab. */
export const openSlips = async (id, lang) => { const res = await fetch(`/api/v1/pay/wage-runs/${id}/slips?lang=${lang}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' })); globalThis.open?.(url, '_blank', 'noopener'); };
