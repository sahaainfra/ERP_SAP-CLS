import { api } from '../../platform/api/index.js';

// The data calls of the project budget pages (part 12.01).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const STATUS_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const KINDS = ['DIRECT', 'OVERHEAD', 'CONTINGENCY', 'RESERVE'];
export const TYPES = ['MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER'];
export const DIMENSIONS = ['wbs', 'cost_head', 'resource', 'work_package', 'control_account'];
export const PROFILES = ['SCURVE', 'LINEAR', 'FRONT', 'BACK'];
export const inr = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const CHANGE_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const CHANGE_TYPES = ['REVISION', 'TRANSFER', 'DRAWDOWN'];
export const REASONS = { REVISION: ['RATE_ESCALATION', 'SCOPE_CHANGE', 'RE_ESTIMATE', 'VARIATION'], TRANSFER: ['TRANSFER'], DRAWDOWN: ['RISK_REALISED'], VARIATION: ['VARIATION'] };
export const bc = {
  options: async (projectId) => (await api.get(`/bud/change-options?projectId=${projectId}`)).data,
  preview: async (b) => (await api.post('/bud/changes/preview', b)).data,
  create: async (b) => (await api.post('/bud/changes', b, idem())).data,
  get: async (id) => (await api.get(`/bud/changes/${id}`)).data,
  update: async (id, b) => (await api.patch(`/bud/changes/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/bud/changes/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/bud/changes/${id}/${action}`, b, idem())).data,
  history: async (id) => (await api.get(`/bud/changes/${id}/history`)).data,
  compare: async (q) => (await api.get(`/bud/compare?${q}`)).data,
};
export const bd = {
  projects: async () => (await api.get('/bud/project-options')).data,
  preview: async (projectId) => (await api.get(`/bud/generate/preview?projectId=${projectId}`)).data,
  previewWith: async (b) => (await api.post('/bud/generate/preview', b)).data,
  generate: async (b) => (await api.post('/bud/generate', b, idem())).data,
  create: async (b) => (await api.post('/bud/budgets', b, idem())).data,
  get: async (id) => (await api.get(`/bud/budgets/${id}`)).data,
  update: async (id, b) => (await api.patch(`/bud/budgets/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/bud/budgets/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/bud/budgets/${id}/${action}`, b, idem())).data,
  views: async (id, by) => (await api.get(`/bud/budgets/${id}/views?by=${by}`)).data,
  margin: async (id) => (await api.get(`/bud/budgets/${id}/margin`)).data,
  history: async (id) => (await api.get(`/bud/budgets/${id}/history`)).data,
  phasing: async (id) => (await api.get(`/bud/budgets/${id}/phasing`)).data,
  phase: async (id, b) => (await api.post(`/bud/budgets/${id}/phasing/generate`, b, idem())).data,
  addLine: async (id, b) => (await api.post(`/bud/budgets/${id}/lines`, b, idem())).data,
  updateLine: async (lineId, b) => (await api.patch(`/bud/lines/${lineId}`, b, idem())).data,
  removeLine: async (lineId, reason) => (await api.delete(`/bud/lines/${lineId}?reason=${encodeURIComponent(reason)}`)).data,
  wbs: async (projectId) => (await api.get(`/bud/structure-options?projectId=${projectId}`)).data,
};
export async function openPrint(path, name) {
  const { authHeaders } = await import('../../platform/api/index.js');
  const w = window.open('', '_blank');
  try { const res = await fetch(`/api/v1/bud${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); } } catch (e) { if (w) w.close(); throw e; }
}
