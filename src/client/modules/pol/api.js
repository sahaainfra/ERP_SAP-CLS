import { api } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { authHeaders } from '../../platform/api/index.js';

// The data calls of the policy pages (part 05.05).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const CATEGORIES = [['HR', 'HR'], ['FINANCE', 'Finance'], ['PROCUREMENT', 'Procurement'], ['HSE', 'HSE'], ['QUALITY', 'Quality'], ['IT', 'IT'], ['CONDUCT', 'Code of conduct'], ['OTHER', 'Other']];
export const STATUS = { DRAFT: ['DRAFT', 'Draft'], IN_APPROVAL: ['IN_REVIEW', 'In approval'], REJECTED: ['REJECTED', 'Rejected'], PUBLISHED: ['IN_REVIEW', 'Published, not yet in force'], ACTIVE: ['COMPLETED', 'Active'], UNDER_REVISION: ['IN_REVIEW', 'Under revision'], SUPERSEDED: ['DRAFT', 'Superseded'], ARCHIVED: ['DRAFT', 'Archived'] };
export const pol = {
  list: async (f) => (await api.get(`/pol/policies?${q(f)}`)).data,
  get: async (id) => (await api.get(`/pol/policies/${id}`)).data,
  create: async (b) => (await api.post('/pol/policies', b, idem())).data,
  update: async (vid, b) => (await api.put(`/pol/versions/${vid}`, b, idem())).data,
  revise: async (id) => (await api.post(`/pol/policies/${id}/versions`, {}, idem())).data,
  submit: async (vid, comment) => (await api.post(`/pol/versions/${vid}/submit`, comment ? { comment } : {}, idem())).data,
  compare: async (id, from, to) => (await api.get(`/pol/policies/${id}/compare?from=${from}&to=${to}`)).data,
  archive: async (id, reason) => (await api.post(`/pol/policies/${id}/archive`, { reason }, idem())).data,
  preview: async (applicability) => (await api.post('/pol/policies/preview', { applicability })).data,
  acks: async (id, f = {}) => (await api.get(`/pol/policies/${id}/acknowledgements?${q(f)}`)).data,
  my: async () => (await api.get('/pol/my')).data,
  read: async (vid) => (await api.post(`/pol/versions/${vid}/read`, {})).data,
  acknowledge: async (versionId, answers) => (await api.post('/pol/acknowledge', { versionId, answers }, idem())).data,
  requirements: async (versionId) => (await api.get(`/pol/requirements?${q({ versionId })}`)).data,
  addRequirement: async (b) => (await api.post('/pol/requirements', b, idem())).data,
  removeRequirement: async (id) => (await api.delete(`/pol/requirements/${id}`, idem())).data,
  convert: async (id) => (await api.post(`/pol/requirements/${id}/convert`, {}, idem())).data,
  drafts: async (f) => (await api.get(`/pol/drafts?${q(f)}`)).data,
  dismiss: async (id, reason) => (await api.post(`/pol/requirements/${id}/dismiss`, { reason }, idem())).data,
  upload: (file, versionId) => uploadFile(file, { transport: browserTransport(authHeaders), entity: 'pol_version', entityId: versionId }),
};
