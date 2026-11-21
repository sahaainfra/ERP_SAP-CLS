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

// Part 11.02: RFI management.
export const RFI_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const RESPONSE_TYPES = ['CLARIFICATION', 'DESIGN_CHANGE', 'INSTRUCTION'];
export const RFI_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', ISSUED: 'ACTIVE', RESPONDED: 'IN_REVIEW', CLOSE_REQUESTED: 'IN_REVIEW', CLOSED: 'COMPLETED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const PRIORITY_TONE = { LOW: 'DRAFT', MEDIUM: 'ACTIVE', HIGH: 'AT_RISK', CRITICAL: 'REJECTED' };
export const rf = {
  dashboard: async (projectId) => (await api.get(`/engg/rfi-dashboard${pq(projectId)}`)).data,
  rfi: async (id) => (await api.get(`/engg/rfis/${id}`)).data,
  create: async (b) => (await api.post('/engg/rfis', b, idem())).data,
  update: async (id, b) => (await api.patch(`/engg/rfis/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/engg/rfis/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/engg/rfis/${id}/${action}`, b, idem())).data,
  history: async (id) => (await api.get(`/engg/rfis/${id}/history`)).data,
  escalate: async () => (await api.post('/engg/rfis/escalate', {}, idem())).data,
};
/** Uploads a picture or a file to an RFI through the file service. */
export async function uploadToRfi(rfiId, blob, name) {
  const { authHeaders } = await import('../../platform/api/index.js');
  const fd = new FormData(); fd.append('entity', 'engg_rfi'); fd.append('entityId', String(rfiId)); fd.append('file', blob, name);
  const res = await fetch('/api/v1/core/files', { method: 'POST', headers: authHeaders(), body: fd });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()).data;
}

// Part 11.03: submittals.
export const SUB_TYPES = ['MAR', 'METHOD_STATEMENT', 'SHOP_DRAWING', 'SAMPLE', 'MOCK_UP', 'PRODUCT_DATA', 'QUALITY_PLAN'];
export const SUB_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', WITH_CONSULTANT: 'ACTIVE', APPROVED: 'APPROVED', REVISE: 'AT_RISK', REJECTED: 'REJECTED', RETURNED: 'RETURNED', CANCELLED: 'CANCELLED' };
export const sb = {
  get: async (id) => (await api.get(`/engg/submittals/${id}`)).data,
  create: async (b) => (await api.post('/engg/submittals', b, idem())).data,
  update: async (id, b) => (await api.patch(`/engg/submittals/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/engg/submittals/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/engg/submittals/${id}/${action}`, b, idem())).data,
  schedule: async (projectId) => (await api.get(`/engg/submittal-schedule${pq(projectId)}`)).data,
  makes: async (projectId) => (await api.get(`/engg/approved-makes${pq(projectId)}`)).data,
  history: async (id) => (await api.get(`/engg/submittals/${id}/history`)).data,
};

// Part 11.04: EPC engineering deliverables and vendor document review.
export const DELIV_DISCIPLINES = ['ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE', 'PROCESS', 'PIPING', 'ELECTRICAL', 'INSTRUMENTATION', 'MECHANICAL'];
export const DELIV_TYPES = ['DRAWING', 'CALCULATION', 'SPECIFICATION', 'DATA_SHEET', 'MTO', 'REPORT', 'OTHER'];
export const VDR_TYPES = ['GA_DRAWING', 'DATA_SHEET', 'TEST_PROCEDURE', 'MANUAL', 'CALCULATION', 'CERTIFICATE', 'OTHER'];
export const VDR_TONE = { REQUIRED: 'DRAFT', RECEIVED: 'ACTIVE', IN_REVIEW: 'IN_REVIEW', ACCEPTED: 'APPROVED', RESUBMIT: 'AT_RISK', RETURNED: 'RETURNED', CANCELLED: 'CANCELLED' };
export const ep = {
  progress: async (projectId) => (await api.get(`/engg/engineering-progress${pq(projectId)}`)).data,
  deliverable: async (id) => (await api.get(`/engg/deliverables/${id}`)).data,
  createDeliverable: async (b) => (await api.post('/engg/deliverables', b, idem())).data,
  updateDeliverable: async (id, b) => (await api.patch(`/engg/deliverables/${id}`, b, idem())).data,
  removeDeliverable: async (id) => (await api.delete(`/engg/deliverables/${id}`)).data,
  deliverableAct: async (id, action, b = {}) => (await api.post(`/engg/deliverables/${id}/${action}`, b, idem())).data,
  commentAct: async (id, action, b = {}) => (await api.post(`/engg/comments/${id}/${action}`, b, idem())).data,
  raiseHold: async (b) => (await api.post('/engg/holds', b, idem())).data,
  clearHold: async (id, b) => (await api.post(`/engg/holds/${id}/clear`, b, idem())).data,
  vdr: async (id) => (await api.get(`/engg/vdr-items/${id}`)).data,
  updateVdr: async (id, b) => (await api.patch(`/engg/vdr-items/${id}`, b, idem())).data,
  createVdr: async (b) => (await api.post('/engg/vdr-items', b, idem())).data,
  removeVdr: async (id) => (await api.delete(`/engg/vdr-items/${id}`)).data,
  vdrAct: async (id, action, b = {}) => (await api.post(`/engg/vdr-items/${id}/${action}`, b, idem())).data,
  tracker: async (projectId) => (await api.get(`/engg/vdr-items/tracker${pq(projectId)}`)).data,
};

// Part 11.05: correspondence register.
export const LETTER_CATS = ['INSTRUCTION', 'NOTICE', 'APPROVAL', 'QUERY', 'PAYMENT', 'OTHER'];
export const ISSUE_MODES = ['EMAIL', 'COURIER', 'PORTAL', 'HAND'];
export const LINK_ENTITIES = ['RFI', 'VARIATION', 'CLAIM', 'SITE_INSTRUCTION', 'DRAWING', 'SUBMITTAL', 'TRANSMITTAL', 'OTHER'];
export const LETTER_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'ACTIVE', ISSUED: 'ACTIVE', ACKNOWLEDGED: 'APPROVED', REGISTERED: 'ACTIVE', CLOSED: 'COMPLETED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const lt = {
  get: async (id) => (await api.get(`/engg/letters/${id}`)).data,
  create: async (b) => (await api.post('/engg/letters', b, idem())).data,
  update: async (id, b) => (await api.patch(`/engg/letters/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/engg/letters/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/engg/letters/${id}/${action}`, b, idem())).data,
  thread: async (id) => (await api.get(`/engg/letters/${id}/thread`)).data,
  templates: async () => (await api.get('/engg/letter-templates')).data,
  render: async (b) => (await api.post('/engg/letter-templates/render', b, idem())).data,
  bars: async (projectId) => (await api.get(`/engg/time-bars${pq(projectId)}`)).data,
  createBar: async (b) => (await api.post('/engg/time-bars', b, idem())).data,
  barAct: async (id, action, b = {}) => (await api.post(`/engg/time-bars/${id}/${action}`, b, idem())).data,
  alerts: async () => (await api.post('/engg/letters/alerts', {}, idem())).data,
  letters: async (projectId, extra = '') => (await api.get(`/engg/letters?pageSize=100&filter[projectId][eq]=${projectId}${extra}`)).data,
};
