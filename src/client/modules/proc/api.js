import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the procurement pages (part 15.01). Checks, availability, rates, totals, bands and statuses come from the server; the pages never work them out.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const addDays = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
export const STATUS_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', EMERGENCY: 'AT_RISK', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CLOSED: 'COMPLETED', SUPERSEDED: 'CANCELLED' };
export const RUN_TONE = { DRAFT: 'DRAFT', COMPLETED: 'APPROVED', CLOSED: 'COMPLETED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const LEVEL_TONE = { NONE: 'DRAFT', OK: 'APPROVED', SHORT: 'RETURNED', CRITICAL: 'REJECTED' };
export const PARAM_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const CHECK_TONE = { OK: 'APPROVED', WARNING: 'RETURNED', BLOCK: 'REJECTED', NOT_CHECKED: 'DRAFT', COVERED: 'REJECTED', PARTIAL: 'RETURNED', NONE: 'APPROVED', NA: 'DRAFT' };
export const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const fmtRs = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

/** A file the server makes (print), saved by the browser. */
export async function download(path, name) {
  const res = await fetch(`/api/v1/proc${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const get = async (p) => (await api.get(`/proc${p}`)).data; const post = async (p, b, ok) => (await api.post(`/proc${p}`, b ?? {}, ok ?? idem())).data;
export const RFQ_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', ISSUED: 'APPROVED', CLOSED: 'COMPLETED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const QUOTE_TONE = { DRAFT: 'DRAFT', RECEIVED: 'APPROVED', SUPERSEDED: 'CANCELLED', WITHDRAWN: 'RETURNED', CANCELLED: 'CANCELLED' };
export const RESPONSE_TONE = { INVITED: 'DRAFT', SENT: 'IN_REVIEW', VIEWED: 'IN_REVIEW', RESPONDED: 'APPROVED', DECLINED: 'REJECTED' };
/** The vendor's page: no sign-in, the link is the proof (part 15.03). */
const pub = async (method, token, path, body) => {
  const res = await fetch(`/api/v1/proc/vendor-quote/${encodeURIComponent(token)}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j?.error?.message ?? 'Something went wrong'); e.status = res.status; e.details = j?.error?.details ?? []; throw e; } return j.data;
};
export const vq = { info: (t) => pub('GET', t, ''), submit: (t, b) => pub('POST', t, '/submit', b), decline: (t, reason) => pub('POST', t, '/decline', { reason }), ask: (t, question) => pub('POST', t, '/clarify', { question }) };
export const CS_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const pc = {
  projects: () => get('/projects'),
  mrOptions: (projectId) => get(`/material-requests/options?projectId=${projectId}`),
  availability: (projectId, siteId, itemId) => get(`/material-requests/availability?projectId=${projectId}${siteId ? `&siteId=${siteId}` : ''}&itemId=${itemId}`),
  mr: (id) => get(`/material-requests/${id}`),
  mrCreate: (b) => post('/material-requests', b),
  mrUpdate: async (id, b) => (await api.patch(`/proc/material-requests/${id}`, b, idem())).data,
  mrDelete: async (id) => (await api.delete(`/proc/material-requests/${id}`)).data,
  mrAct: (id, action, b) => post(`/material-requests/${id}/${action}`, b),
  mrHistory: (id) => get(`/material-requests/${id}/history`),
  prOptions: (projectId) => get(`/requisitions/options?projectId=${projectId}`),
  rate: (projectId, itemId, wbsId, costCodeId) => get(`/requisitions/rate?projectId=${projectId}&itemId=${itemId}${wbsId ? `&wbsId=${wbsId}` : ''}${costCodeId ? `&costCodeId=${costCodeId}` : ''}`),
  pr: (id) => get(`/requisitions/${id}`),
  prChecks: (id) => get(`/requisitions/${id}/checks`),
  prCreate: (b) => post('/requisitions', b),
  prUpdate: async (id, b) => (await api.patch(`/proc/requisitions/${id}`, b, idem())).data,
  prDelete: async (id) => (await api.delete(`/proc/requisitions/${id}`)).data,
  prAct: (id, action, b) => post(`/requisitions/${id}/${action}`, b),
  prHistory: (id) => get(`/requisitions/${id}/history`),
  preview: (b) => post('/requisitions/consolidate/preview', b, {}),
  consolidate: (b) => post('/requisitions/consolidate', b),
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
  // part 15.02: MRP
  mrpProjects: () => get('/mrp/projects'),
  runOptions: (projectId) => get(`/runs/options?projectId=${projectId}`),
  runs: async (projectId) => (await api.get(`/proc/runs?filter[projectId]=${projectId}&pageSize=25`)).data,
  run: (id) => get(`/runs/${id}`),
  runCreate: (b) => post('/runs', b),
  runMake: (id) => post(`/runs/${id}/submit`),
  runAct: (id, action, b) => post(`/runs/${id}/${action}`, b),
  heatmap: (id) => get(`/runs/${id}/heatmap`),
  longLead: (id) => get(`/runs/${id}/long-lead`),
  proposals: async (q) => (await api.get(`/proc/proposals?${q}`)).data,
  proposalModify: async (id, b) => (await api.patch(`/proc/proposals/${id}`, b, idem())).data,
  proposalReject: (id, reason) => post(`/proposals/${id}/reject`, { reason }),
  proposalGet: (id) => get(`/proposals/${id}`),
  accept: (b) => post('/proposals/accept', b),
  param: (id) => get(`/item-params/${id}`),
  paramCreate: (b) => post('/item-params', b),
  paramUpdate: async (id, b) => (await api.patch(`/proc/item-params/${id}`, b, idem())).data,
  paramDelete: async (id) => (await api.delete(`/proc/item-params/${id}`)).data,
  paramAct: (id, action, b) => post(`/item-params/${id}/${action}`, b),
  paramHistory: (id) => get(`/item-params/${id}/history`),
  approvedMrs: async (projectId) => (await api.get(`/proc/material-requests?filter[status]=APPROVED&filter[projectId]=${projectId}&pageSize=100`)).data,
  // part 15.03: RFQs and quotations
  rfqOptions: (projectId, ids = []) => get(`/rfqs/options?projectId=${projectId}${ids.length ? `&prLineIds=${ids.join(',')}` : ''}`),
  rfqVendors: (projectId, ids = [], q = '') => get(`/rfqs/vendors?projectId=${projectId}${ids.length ? `&prLineIds=${ids.join(',')}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  rfq: (id) => get(`/rfqs/${id}`),
  rfqCreate: (b) => post('/rfqs', b),
  rfqUpdate: async (id, b) => (await api.patch(`/proc/rfqs/${id}`, b, idem())).data,
  rfqDelete: async (id) => (await api.delete(`/proc/rfqs/${id}`)).data,
  rfqAct: (id, action, b) => post(`/rfqs/${id}/${action}`, b),
  rfqAnswer: (id, cid, b) => post(`/rfqs/${id}/clarifications/${cid}/answer`, b),
  rfqHistory: (id) => get(`/rfqs/${id}/history`),
  comparison: (id) => get(`/rfqs/${id}/comparison`),
  issuedRfqs: async () => (await api.get('/proc/rfqs?filter[status]=ISSUED&pageSize=100')).data,
  quote: (id) => get(`/quotations/${id}`),
  quoteCreate: (b) => post('/quotations', b),
  quoteUpdate: async (id, b) => (await api.patch(`/proc/quotations/${id}`, b, idem())).data,
  quoteDelete: async (id) => (await api.delete(`/proc/quotations/${id}`)).data,
  quoteAct: (id, action, b) => post(`/quotations/${id}/${action}`, b),
  quoteHistory: (id) => get(`/quotations/${id}/history`),
  // part 15.04: comparative statements
  csRfqs: () => get('/comparative-statements/rfqs'),
  cs: (id) => get(`/comparative-statements/${id}`),
  csCreate: (b) => post('/comparative-statements', b),
  csUpdate: async (id, b) => (await api.patch(`/proc/comparative-statements/${id}`, b, idem())).data,
  csDelete: async (id) => (await api.delete(`/proc/comparative-statements/${id}`)).data,
  csAct: (id, action, b) => post(`/comparative-statements/${id}/${action}`, b),
  csHistory: (id) => get(`/comparative-statements/${id}/history`),
};
