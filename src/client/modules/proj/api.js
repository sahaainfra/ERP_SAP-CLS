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
