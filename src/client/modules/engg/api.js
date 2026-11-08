import { api } from '../../platform/api/index.js';

// The data calls of the drawing control pages (part 11.01).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const DISCIPLINES = ['ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE'];
export const STATUS_CODES = ['IFR', 'IFA', 'IFC', 'ASBUILT'];
export const SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'OTHER'];
export const ORIGINATORS = ['CONSULTANT', 'IN_HOUSE', 'VENDOR'];
export const PURPOSES = ['FOR_APPROVAL', 'FOR_CONSTRUCTION', 'FOR_INFORMATION'];
export const RESPONSES = ['A', 'B', 'C', 'D'];
export const LINK_TYPES = ['WBS', 'LOCATION', 'BOQ', 'ACTIVITY'];
export const REV_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', ISSUED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const TX_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', ISSUED: 'ACTIVE', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CLOSED: 'COMPLETED' };
export const dayIST = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const pq = (projectId) => (projectId ? `?projectId=${projectId}` : '');
export const eg = {
  projects: async () => (await api.get('/engg/project-options')).data,
  structure: async (projectId) => (await api.get(`/engg/structure-options?projectId=${projectId}`)).data,
  dashboard: async (projectId) => (await api.get(`/engg/dashboard${pq(projectId)}`)).data,
  schedule: async (projectId) => (await api.get(`/engg/schedule${pq(projectId)}`)).data,
  site: async (q = '') => (await api.get(`/engg/site-drawings${q}`)).data,
  drawings: async (projectId) => (await api.get(`/engg/drawings?pageSize=200&filter[projectId][eq]=${projectId}`)).data,
  drawing: async (id) => (await api.get(`/engg/drawings/${id}`)).data,
  createDrawing: async (b) => (await api.post('/engg/drawings', b, idem())).data,
  updateDrawing: async (id, b) => (await api.patch(`/engg/drawings/${id}`, b, idem())).data,
  removeDrawing: async (id) => (await api.delete(`/engg/drawings/${id}`)).data,
  drawingAct: async (id, action, b = {}) => (await api.post(`/engg/drawings/${id}/${action}`, b, idem())).data,
  drawingHistory: async (id) => (await api.get(`/engg/drawings/${id}/history`)).data,
  revision: async (id) => (await api.get(`/engg/revisions/${id}`)).data,
  updateRevision: async (id, b) => (await api.patch(`/engg/revisions/${id}`, b, idem())).data,
  removeRevision: async (id) => (await api.delete(`/engg/revisions/${id}`)).data,
  revisionAct: async (id, action, b = {}) => (await api.post(`/engg/revisions/${id}/${action}`, b, idem())).data,
  compare: async (from, to) => (await api.get(`/engg/drawings/compare?from=${from}&to=${to}`)).data,
  ack: async (copyId) => (await api.post(`/engg/copies/${copyId}/acknowledge`, {}, idem())).data,
  transmittal: async (id) => (await api.get(`/engg/transmittals/${id}`)).data,
  createTransmittal: async (b) => (await api.post('/engg/transmittals', b, idem())).data,
  updateTransmittal: async (id, b) => (await api.patch(`/engg/transmittals/${id}`, b, idem())).data,
  removeTransmittal: async (id) => (await api.delete(`/engg/transmittals/${id}`)).data,
  transmittalAct: async (id, action, b = {}) => (await api.post(`/engg/transmittals/${id}/${action}`, b, idem())).data,
  transmittalHistory: async (id) => (await api.get(`/engg/transmittals/${id}/history`)).data,
  fileUrl: async (fileId) => (await api.get(`/core/files/${fileId}/url`)).data,
};
/** Opens a printable page (or downloads a file) with the sign-in of this session. */
export async function openPrint(path, name) {
  const { authHeaders } = await import('../../platform/api/index.js');
  const w = window.open('', '_blank');
  try { const res = await fetch(`/api/v1/engg${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); } } catch { w?.close(); }
}
