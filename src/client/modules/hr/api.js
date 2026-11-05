import { api } from '../../platform/api/index.js';

// The data calls of the HR pages (part 07.01): the employee master.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const RECORD_STATUS = { DRAFT: ['DRAFT', 'Draft'], SUBMITTED: ['IN_REVIEW', 'Waiting for approval'], APPROVED: ['APPROVED', 'Approved'], RETURNED: ['RETURNED', 'Returned for correction'], REJECTED: ['REJECTED', 'Rejected'], CANCELLED: ['CANCELLED', 'Cancelled'] };
export const EMPLOYMENT_STATUS = { ACTIVE: ['ACTIVE', 'Active'], NOTICE: ['AT_RISK', 'On notice'], SEPARATED: ['CLOSED', 'Separated'], ABSCONDING: ['OVERDUE', 'Absconding'] };
export const CHANGE_STATUS = { PENDING: ['IN_REVIEW', 'Waiting for approval'], SCHEDULED: ['AT_RISK', 'Approved, waiting for its date'], APPLIED: ['COMPLETED', 'Applied'], REJECTED: ['REJECTED', 'Rejected'], RETURNED: ['RETURNED', 'Returned for correction'], CANCELLED: ['CANCELLED', 'Cancelled'] };
export const GENDERS = [['MALE', 'Male'], ['FEMALE', 'Female'], ['OTHER', 'Other']];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const MARITAL = [['SINGLE', 'Single'], ['MARRIED', 'Married'], ['DIVORCED', 'Divorced'], ['WIDOWED', 'Widowed'], ['OTHER', 'Other']];
export const EMPLOYMENT_TYPES = [['PERMANENT', 'Permanent'], ['CONTRACT', 'Contract'], ['TRAINEE', 'Trainee'], ['CONSULTANT', 'Consultant']];
export const PAYMENT_MODES = [['BANK_TRANSFER', 'Bank transfer'], ['CASH', 'Cash'], ['CHEQUE', 'Cheque']];
export const DOC_TYPES = [['ID_PROOF', 'ID proof'], ['ADDRESS_PROOF', 'Address proof'], ['OFFER_LETTER', 'Offer letter'], ['APPOINTMENT_LETTER', 'Appointment letter'], ['CERTIFICATE', 'Certificate'], ['DRIVING_LICENCE', 'Driving licence'], ['MEDICAL', 'Medical fitness'], ['OTHER', 'Other']];
export const CONTACT_TYPES = [['EMERGENCY', 'Emergency contact'], ['FAMILY', 'Family member'], ['NOMINEE', 'Nominee']];
export const EVENT_TYPES = [['PROMOTION', 'Promotion'], ['TRANSFER', 'Transfer'], ['INCREMENT', 'Increment'], ['DESIGNATION_CHANGE', 'Designation change'], ['GRADE_CHANGE', 'Grade change'], ['MANAGER_CHANGE', 'Change of manager'], ['CONFIRMED', 'Confirmation'], ['OTHER', 'Other']];
export const EVENT_LABELS = { JOINED: 'Joined', CONFIRMED: 'Confirmed', PROMOTION: 'Promotion', TRANSFER: 'Transfer', INCREMENT: 'Increment', DESIGNATION_CHANGE: 'Designation change', GRADE_CHANGE: 'Grade change', MANAGER_CHANGE: 'Change of manager', STATUS_CHANGE: 'Status change', SEPARATION: 'Separation', OTHER: 'Other' };
export const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const dayIST = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

export const employees = {
  overview: async (f) => (await api.get(`/hr/employees/overview?${q(f)}`)).data,
  queue: async (kind) => (await api.get(`/hr/employees/queue${kind ? `?kind=${kind}` : ''}`)).data,
  get: async (id) => (await api.get(`/hr/employees/${id}`)).data,
  me: async () => (await api.get('/hr/employees/me')).data,
  check: async (b) => (await api.post('/hr/employees/check', b)).data,
  create: async (b) => (await api.post('/hr/employees', b, idem())).data,
  update: async (id, b) => (await api.patch(`/hr/employees/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/hr/employees/${id}`)).data,
  submit: async (id, comment) => (await api.post(`/hr/employees/${id}/submit`, comment ? { comment } : {}, idem())).data,
  withdraw: async (id, reason) => (await api.post(`/hr/employees/${id}/withdraw`, { reason }, idem())).data,
  cancel: async (id, reason) => (await api.post(`/hr/employees/${id}/cancel`, { reason }, idem())).data,
  amend: async (id, b) => (await api.post(`/hr/employees/${id}/amend`, b, idem())).data,
  amendMine: async (b) => (await api.post('/hr/employees/me/changes', b, idem())).data,
  cancelChange: async (changeId, reason) => (await api.post(`/hr/employees/changes/${changeId}/cancel`, { reason }, idem())).data,
  details: async (id, b) => (await api.put(`/hr/employees/${id}/details`, b, idem())).data,
  history: async (id) => (await api.get(`/hr/employees/${id}/history`)).data,
  addDocument: async (id, b) => (await api.post(`/hr/employees/${id}/documents`, b, idem())).data,
  verifyDocument: async (id, docId) => (await api.post(`/hr/employees/${id}/documents/${docId}/verify`, {}, idem())).data,
  verifyBank: async (id, bankId, b) => (await api.post(`/hr/employees/${id}/banks/${bankId}/verify`, b, idem())).data,
  revealBank: async (id, bankId) => (await api.get(`/hr/employees/${id}/banks/${bankId}/reveal`)).data,
  createUser: async (id, b) => (await api.post(`/hr/employees/${id}/user`, b, idem())).data,
  linkUser: async (id, userId) => (await api.post(`/hr/employees/${id}/link-user`, { userId }, idem())).data,
};
