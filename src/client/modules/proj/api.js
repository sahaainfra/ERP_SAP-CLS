import { api } from '../../platform/api/index.js';

// The data calls of the project master pages (part 10.01).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const CONTRACT_TYPES = ['ITEM_RATE', 'LUMP_SUM', 'EPC', 'HAM', 'COST_PLUS'];
export const PROJECT_TYPES = ['BUILDING', 'ROAD', 'BRIDGE', 'INDUSTRIAL', 'EPC', 'WATER', 'RAIL', 'OTHER'];
export const SECTORS = ['BUILDING', 'ROADS', 'BRIDGES', 'WATER', 'INDUSTRIAL', 'EPC', 'RAIL', 'OTHER'];
export const SITE_TYPES = ['SITE', 'CAMP', 'STORE', 'PLANT', 'OFFICE'];
export const dayIST = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
export const inr = (n) => (n == null || n === '' ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const proj = {
  get: async (id) => (await api.get(`/proj/projects/${id}`)).data,
  options: async () => (await api.get('/proj/project-options')).data,
  prefill: async (tenderId) => (await api.get(`/proj/project-prefill?tenderId=${tenderId}`)).data,
  create: async (b) => (await api.post('/proj/projects', b, idem())).data,
  update: async (id, b) => (await api.patch(`/proj/projects/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/proj/projects/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/proj/projects/${id}/${action}`, b, idem())).data,
  move: async (id, b) => (await api.post(`/proj/projects/${id}/transitions`, b, idem())).data,
  withdrawMove: async (id, b) => (await api.post(`/proj/projects/${id}/transitions/withdraw`, b, idem())).data,
  history: async (id) => (await api.get(`/proj/projects/${id}/history`)).data,
  addMilestone: async (id, b) => (await api.post(`/proj/projects/${id}/milestones`, b, idem())).data,
  updateMilestone: async (id, b) => (await api.patch(`/proj/milestones/${id}`, b, idem())).data,
  removeMilestone: async (id) => (await api.delete(`/proj/milestones/${id}`)).data,
};

// Part 10.02: the project from an award, the commercial baseline pack, the handover meetings and the baseline report.
export const PACK_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const bl = {
  candidates: async () => (await api.get('/proj/award-candidates')).data,
  preview: async (tenderId) => (await api.get(`/proj/award-preview?tenderId=${tenderId}`)).data,
  createFromAward: async (b) => (await api.post('/proj/projects/from-award', b, idem())).data,
  get: async (id) => (await api.get(`/proj/baseline-packs/${id}`)).data,
  update: async (id, b) => (await api.patch(`/proj/baseline-packs/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/proj/baseline-packs/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/proj/baseline-packs/${id}/${action}`, b, idem())).data,
  history: async (id) => (await api.get(`/proj/baseline-packs/${id}/history`)).data,
  verify: async (id) => (await api.get(`/proj/baseline-packs/${id}/verify`)).data,
  compare: async (id) => (await api.get(`/proj/baseline-packs/${id}/compare`)).data,
  addMeeting: async (id, b) => (await api.post(`/proj/baseline-packs/${id}/meetings`, b, idem())).data,
  updateMeeting: async (id, b) => (await api.patch(`/proj/handover-meetings/${id}`, b, idem())).data,
  removeMeeting: async (id) => (await api.delete(`/proj/handover-meetings/${id}`)).data,
  report: async (projectId) => (await api.get(`/proj/baseline-report?projectId=${projectId}`)).data,
  boq: async (projectId) => (await api.get(`/proj/boq?projectId=${projectId}`)).data,
  packs: async (projectId) => (await api.get(`/proj/baseline-packs?pageSize=20&filter[projectId][eq]=${projectId}`)).data,
};
/** Opens a document of a pack (print or export) in a new tab with the sign-in of this session. */
export async function openDocument(id, format = 'html') {
  const w = format === 'html' ? window.open('', '_blank') : null;
  try {
    const { authHeaders } = await import('../../platform/api/index.js');
    const res = await fetch(`/api/v1/proj/baseline-packs/${id}/document?format=${format}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(String(res.status));
    const b = await res.blob(); const url = URL.createObjectURL(b);
    if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = `baseline-${id}.${format}`; a.click(); }
  } catch { w?.close(); }
}
