import { api } from '../../platform/api/index.js';

// The data calls of the master data governance pages (part 06.01).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const RECORD_STATUS = { SUBMITTED: ['SUBMITTED', 'Waiting for approval'], ACTIVE: ['ACTIVE', 'Active'], INACTIVE: ['DEACTIVATED', 'Inactive'], MERGED: ['ARCHIVED', 'Merged'], REJECTED: ['REJECTED', 'Rejected'] };
export const REQUEST_STATUS = { PENDING: ['IN_REVIEW', 'Waiting for approval'], RETURNED: ['RETURNED', 'Returned for correction'], APPROVED: ['APPROVED', 'Approved'], APPLIED: ['COMPLETED', 'Applied'], REJECTED: ['REJECTED', 'Rejected'], CANCELLED: ['CANCELLED', 'Withdrawn'] };
export const CHANGE = { CREATE: 'New record', UPDATE: 'Change', INACTIVATE: 'Make inactive', REACTIVATE: 'Make active again', MERGE: 'Merge' };
export const DUP_STATUS = { OPEN: ['OPEN', 'To check'], NOT_DUPLICATE: ['CLOSED', 'Not a duplicate'], MERGE_PENDING: ['IN_REVIEW', 'Merge waiting for approval'], MERGED: ['COMPLETED', 'Merged'] };
export const scoreTone = (s) => (s == null ? 'neutral' : s >= 90 ? 'success' : s >= 70 ? 'warning' : 'error');
export const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const mdm = {
  dashboard: async () => (await api.get('/mdm/dashboard')).data,
  masters: async () => (await api.get('/mdm/masters')).data,
  records: async (type, f) => (await api.get(`/mdm/masters/${type}/records?${q(f)}`)).data,
  record: async (type, id, asOf) => (await api.get(`/mdm/masters/${type}/records/${id}?${q({ asOf })}`)).data,
  references: async (type, id) => (await api.get(`/mdm/masters/${type}/records/${id}/references`)).data,
  check: async (type, data, recordId) => (await api.post(`/mdm/masters/${type}/check`, recordId ? { data, recordId } : { data })).data,
  create: async (type, b) => (await api.post(`/mdm/masters/${type}/records`, b, idem())).data,
  update: async (type, id, b) => (await api.put(`/mdm/masters/${type}/records/${id}`, b, idem())).data,
  setStatus: async (type, id, b) => (await api.post(`/mdm/masters/${type}/records/${id}/status`, b, idem())).data,
  review: async (type, id) => (await api.post(`/mdm/masters/${type}/records/${id}/review`, {}, idem())).data,
  requests: async (f) => (await api.get(`/mdm/change-requests?${q(f)}`)).data,
  request: async (id) => (await api.get(`/mdm/change-requests/${id}`)).data,
  cancel: async (id, reason) => (await api.post(`/mdm/change-requests/${id}/cancel`, { reason }, idem())).data,
  resubmit: async (id, b) => (await api.post(`/mdm/change-requests/${id}/resubmit`, b, idem())).data,
  duplicates: async (f) => (await api.get(`/mdm/duplicates?${q(f)}`)).data,
  scan: async (type) => (await api.post('/mdm/duplicates/scan', { type }, idem())).data,
  dismiss: async (id, reason) => (await api.post(`/mdm/duplicates/${id}/dismiss`, { reason }, idem())).data,
  merge: async (b) => (await api.post('/mdm/merge', b, idem())).data,
  quality: async (type) => (await api.get(`/mdm/quality?${q({ type })}`)).data,
  config: async () => (await api.get('/mdm/config')).data,
  propose: async (b) => (await api.post('/mdm/config', b, idem())).data,
};
