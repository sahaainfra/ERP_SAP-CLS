import { api, authHeaders } from '../../platform/api/index.js';

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
  catalogue: async () => (await api.get('/mdm/common')).data,
  common: async (m, f) => (await api.get(`/mdm/common/${m}?${q(f)}`)).data,
  // part 166.8
  statutoryLookup: async (f) => (await api.get(`/mdm/statutory/lookup?${q(f)}`)).data,
  statutoryCalendar: async (f) => (await api.get(`/mdm/statutory/calendar?${q(f)}`)).data,
  migrationReport: async () => (await api.get('/mdm/statutory/migration-report')).data,
  wages: async (id, month) => (await api.get(`/mdm/statutory/employees/${id}/wages?${q({ month })}`)).data,
  setPay: async (id, b) => (await api.put(`/mdm/statutory/employees/${id}/pay`, b, idem())).data,
  commonRow: async (m, id) => (await api.get(`/mdm/common/${m}/${id}`)).data,
  commonCreate: async (m, b) => (await api.post(`/mdm/common/${m}`, b, idem())).data,
  commonUpdate: async (m, id, b) => (await api.put(`/mdm/common/${m}/${id}`, b, idem())).data,
  commonRetire: async (m, id, b) => (await api.post(`/mdm/common/${m}/${id}/retire`, b, idem())).data,
  lists: async () => (await api.get('/mdm/lookup-lists')).data,
  listValues: async (code, f) => (await api.get(`/mdm/lookup-lists/${code}?${q(f)}`)).data,
  saveList: async (code, b) => (await api.put(`/mdm/lookup-lists/${code}`, b, idem())).data,
  config: async () => (await api.get('/mdm/config')).data,
  propose: async (b) => (await api.post('/mdm/config', b, idem())).data,
};

// ---- part 06.03: the item master ----
export const ITEM_STATUS = { SUBMITTED: ['SUBMITTED', 'Waiting for approval'], ACTIVE: ['ACTIVE', 'Active'], INACTIVE: ['DEACTIVATED', 'Inactive'], SUPERSEDED: ['ARCHIVED', 'Superseded'], REJECTED: ['REJECTED', 'Rejected'] };
export const items = {
  categories: async () => (await api.get('/mdm/item-categories')).data,
  saveCategory: async (id, b) => (await (id ? api.put(`/mdm/item-categories/${id}`, b, idem()) : api.post('/mdm/item-categories', b, idem()))).data,
  categoryHistory: async (id) => (await api.get(`/mdm/item-categories/${id}/history`)).data,
  get: async (id) => (await api.get(`/mdm/items/${id}`)).data,
  check: async (b) => (await api.post('/mdm/items/check', b)).data,
  create: async (b) => (await api.post('/mdm/items', b, idem())).data,
  update: async (id, b) => (await api.put(`/mdm/items/${id}`, b, idem())).data,
  resubmit: async (id, b) => (await api.post(`/mdm/items/${id}/resubmit`, b, idem())).data,
  newVersion: async (id, b) => (await api.post(`/mdm/items/${id}/versions`, b, idem())).data,
  setStatus: async (id, b) => (await api.post(`/mdm/items/${id}/status`, b, idem())).data,
  saveUoms: async (id, b) => (await api.put(`/mdm/items/${id}/uoms`, b, idem())).data,
  convert: async (id, f) => (await api.get(`/mdm/items/${id}/convert?${q(f)}`)).data,
  saveResources: async (id, b) => (await api.put(`/mdm/items/${id}/resources`, b, idem())).data,
  addMake: async (id, b) => (await api.post(`/mdm/items/${id}/makes`, b, idem())).data,
  decideMake: async (id, makeId, b) => (await api.post(`/mdm/items/${id}/makes/${makeId}`, b, idem())).data,
  alternate: async (id, b) => (await api.post(`/mdm/items/${id}/alternates`, b, idem())).data,
  migration: async () => (await api.get('/mdm/items/migration')).data,
  map: async (b) => (await api.post('/mdm/items/migration/map', b, idem())).data,
};

// ---- part 06.04: the business partner master ----
export const PARTNER_STATUS = { PROSPECT: ['DRAFT', 'Prospect'], PENDING: ['IN_REVIEW', 'Pending approval'], ACTIVE: ['ACTIVE', 'Active'], ON_HOLD: ['ON_HOLD', 'On hold'], BLACKLISTED: ['BLOCKED', 'Blacklisted'], INACTIVE: ['DEACTIVATED', 'Inactive'], REJECTED: ['REJECTED', 'Rejected'] };
export const PARTNER_ROLES = [['VENDOR', 'Vendor or supplier'], ['SUBCONTRACTOR', 'Subcontractor'], ['LABOUR_CONTRACTOR', 'Labour contractor'], ['SERVICE_PROVIDER', 'Service provider'], ['CLIENT', 'Client'], ['CONSULTANT', 'Consultant'], ['TRANSPORTER', 'Transporter']];
export const CONSTITUTIONS = [['PROPRIETORSHIP', 'Proprietorship'], ['PARTNERSHIP', 'Partnership firm'], ['LLP', 'LLP'], ['PRIVATE_LIMITED', 'Private limited company'], ['PUBLIC_LIMITED', 'Public limited company'], ['TRUST', 'Trust'], ['SOCIETY', 'Society'], ['GOVERNMENT', 'Government body'], ['HUF', 'HUF'], ['INDIVIDUAL', 'Individual'], ['OTHER', 'Other']];
export const DOC_TYPES = [['GST_CERTIFICATE', 'GST certificate'], ['PAN_CARD', 'PAN card'], ['MSME_CERTIFICATE', 'MSME (Udyam) certificate'], ['CLRA_LICENCE', 'Labour licence (CLRA)'], ['PF_REGISTRATION', 'PF registration'], ['ESI_REGISTRATION', 'ESI registration'], ['INSURANCE', 'Insurance'], ['ISO_CERTIFICATE', 'ISO certificate'], ['CANCELLED_CHEQUE', 'Cancelled cheque'], ['INCORPORATION', 'Certificate of incorporation'], ['OTHER', 'Other']];
export const partners = {
  get: async (id) => (await api.get(`/mdm/partners/${id}`)).data,
  check: async (b) => (await api.post('/mdm/partners/check', b)).data,
  create: async (b) => (await api.post('/mdm/partners', b, idem())).data,
  update: async (id, b) => (await api.put(`/mdm/partners/${id}`, b, idem())).data,
  submit: async (id, comment) => (await api.post(`/mdm/partners/${id}/submit`, comment ? { comment } : {}, idem())).data,
  details: async (id, b) => (await api.put(`/mdm/partners/${id}/details`, b, idem())).data,
  summary: async (id) => (await api.get(`/mdm/partners/${id}/summary`)).data,
  addGstin: async (id, b) => (await api.post(`/mdm/partners/${id}/gstins`, b, idem())).data,
  verifyGstin: async (id, b) => (await api.post(`/mdm/partners/${id}/gstins/verify`, b, idem())).data,
  addDocument: async (id, b) => (await api.post(`/mdm/partners/${id}/documents`, b, idem())).data,
  verifyDocument: async (id, docId) => (await api.post(`/mdm/partners/${id}/documents/${docId}/verify`, {}, idem())).data,
  setTds: async (id, b) => (await api.put(`/mdm/partners/${id}/tds`, b, idem())).data,
  requestBank: async (id, b) => (await api.post(`/mdm/partners/${id}/banks`, b, idem())).data,
  confirmBank: async (id, bankId, b) => (await api.post(`/mdm/partners/${id}/banks/${bankId}/confirm`, b, idem())).data,
  verifyBank: async (id, bankId, b) => (await api.post(`/mdm/partners/${id}/banks/${bankId}/verify`, b, idem())).data,
  revealBank: async (id, bankId) => (await api.get(`/mdm/partners/${id}/banks/${bankId}/reveal`)).data,
  setStatus: async (id, b) => (await api.post(`/mdm/partners/${id}/status`, b, idem())).data,
  blacklist: async (id, b) => (await api.post(`/mdm/partners/${id}/blacklist`, b, idem())).data,
  queue: async (kind) => (await api.get(`/mdm/partners/queue${kind ? `?kind=${kind}` : ''}`)).data,
};

// part 06.06: the rate analysis engine and the schedule of rates library
export const ANALYSIS_STATUS = { DRAFT: ['DRAFT', 'Draft'], SUBMITTED: ['IN_REVIEW', 'In approval'], RETURNED: ['RETURNED', 'Returned for correction'], APPROVED: ['APPROVED', 'Released'], REJECTED: ['REJECTED', 'Rejected'], CANCELLED: ['CANCELLED', 'Cancelled'], SUPERSEDED: ['ARCHIVED', 'Superseded'] };
export const COMPONENTS = [['MATERIAL', 'Material'], ['LABOUR', 'Labour'], ['EQUIPMENT', 'Equipment'], ['TRANSPORT', 'Transport'], ['SUBCONTRACT', 'Subcontract'], ['OTHER', 'Other']];
export const SCOPE_LABEL = { STANDARD: 'Standard library', PROJECT: 'Project-specific', VARIATION: 'Variation' };
export const ADDON_LABELS = [['water', 'Water and electricity'], ['overhead', 'Contractor\'s overhead'], ['profit', 'Profit'], ['contingency', 'Contingency'], ['insurance', 'Insurance'], ['escalation', 'Escalation']];
export const rates = {
  library: async (f) => (await api.get(`/mdm/resource-rates?${q(f)}`)).data,
  lookup: async (f) => (await api.get(`/mdm/resource-rates/lookup?${q(f)}`)).data,
  addRate: async (b) => (await api.post('/mdm/resource-rates', b, idem())).data,
  retireRate: async (id, reason) => (await api.post(`/mdm/resource-rates/${id}/retire`, { reason }, idem())).data,
  books: async () => (await api.get('/mdm/sor-books')).data,
  book: async (id, f) => (await api.get(`/mdm/sor-books/${id}?${q(f)}`)).data,
  createBook: async (b) => (await api.post('/mdm/sor-books', b, idem())).data,
  putItems: async (id, b) => (await api.put(`/mdm/sor-books/${id}/items`, b, idem())).data,
  activate: async (id, reason) => (await api.post(`/mdm/sor-books/${id}/activate`, { reason }, idem())).data,
  newEdition: async (id, b) => (await api.post(`/mdm/sor-books/${id}/editions`, b, idem())).data,
  sorSearch: async (text) => (await api.get(`/mdm/sor-items?${q({ q: text })}`)).data,
  analyses: async (f) => (await api.get(`/mdm/analyses?${q(f)}`)).data,
  analysis: async (id) => (await api.get(`/mdm/analyses/${id}`)).data,
  start: async (b) => (await api.post('/mdm/analyses/start', b)).data,
  create: async (b) => (await api.post('/mdm/analyses', b, idem())).data,
  update: async (id, b) => (await api.put(`/mdm/analyses/${id}`, b, idem())).data,
  remove: async (id, reason) => (await api.delete(`/mdm/analyses/${id}`, idem(), { reason })).data,
  recalculate: async (id) => (await api.post(`/mdm/analyses/${id}/recalculate`, {}, idem())).data,
  submit: async (id, comment) => (await api.post(`/mdm/analyses/${id}/submit`, comment ? { comment } : {}, idem())).data,
  withdraw: async (id, reason) => (await api.post(`/mdm/analyses/${id}/withdraw`, { reason }, idem())).data,
  cancel: async (id, reason) => (await api.post(`/mdm/analyses/${id}/cancel`, { reason }, idem())).data,
  amend: async (id, b) => (await api.post(`/mdm/analyses/${id}/amend`, b, idem())).data,
  compare: async (id, other) => (await api.get(`/mdm/analyses/${id}/compare?with=${other}`)).data,
  history: async (id) => (await api.get(`/mdm/analyses/${id}/history`)).data,
  impact: async (f) => (await api.get(`/mdm/analyses/impact?${q(f)}`)).data,
  /** A file the server writes (CSV export, printable page); the export and the print are in the audit trail. */
  fetchText: async (path) => { const r = await fetch(`/api/v1${path}`, { headers: { ...authHeaders() } }); if (!r.ok) throw new Error('The server did not return the file'); return r.text(); },
};
/** Rows of a schedule pasted from a spreadsheet (item code, description, unit, rate[, parent code]), tab or comma separated, with or without a header. */
export function parseSorRows(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim());
  const cells = (l) => { const out = []; let cur = ''; let quoted = false; for (const ch of l) { if (ch === '"') quoted = !quoted; else if ((ch === ',' || ch === '\t') && !quoted) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const first = cells(lines[0] ?? '');
  const head = /code/i.test(first[0] ?? '') && /desc/i.test(first[1] ?? '');
  return lines.slice(head ? 1 : 0).map(cells).filter((c) => c[0] && c[1]).map((c) => ({ itemCode: c[0], description: c[1], uom: c[2] ? c[2].toUpperCase() : null, rate: c[3] ? c[3].replace(/,/g, '') : null, ...(c[4] ? { parentCode: c[4] } : {}) }));
}
