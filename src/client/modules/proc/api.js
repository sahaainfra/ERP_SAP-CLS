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
export { fmtDate } from '../../../shared/dates.js';
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
export const PO_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CLOSED: 'COMPLETED', CANCELLED: 'CANCELLED' };
export const DELIVERY_TONE = { NOT_DELIVERED: 'DRAFT', PARTIAL: 'IN_REVIEW', DELIVERED: 'APPROVED' };
const vpoCall = async (method, token, path, body) => {
  const res = await fetch(`/api/v1/proc/vendor-po/${encodeURIComponent(token)}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j?.error?.message ?? 'Something went wrong'); e.status = res.status; e.details = j?.error?.details ?? []; throw e; } return j.data;
};
export const vpo = { info: (t) => vpoCall('GET', t, ''), ack: (t, note) => vpoCall('POST', t, '/acknowledge', { note }), dispatch: (t, b) => vpoCall('POST', t, '/dispatch', b), milestones: (t) => vpoCall('GET', t, '/milestones'), milestone: (t, id, b) => vpoCall('POST', t, `/milestones/${id}`, b) };
export const RC_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CLOSED: 'COMPLETED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
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
  // part 15.05: purchase orders
  poOptions: (projectId) => get(`/purchase-orders/options?projectId=${projectId}`),
  po: (id) => get(`/purchase-orders/${id}`),
  poCreate: (b) => post('/purchase-orders', b),
  poUpdate: async (id, b) => (await api.patch(`/proc/purchase-orders/${id}`, b, idem())).data,
  poDelete: async (id) => (await api.delete(`/proc/purchase-orders/${id}`)).data,
  poAct: (id, action, b) => post(`/purchase-orders/${id}/${action}`, b),
  poHistory: (id) => get(`/purchase-orders/${id}/history`),
  amend: (id, aid) => get(`/purchase-orders/${id}/amendments/${aid}`),
  amendAct: (id, aid, action, b) => post(`/purchase-orders/${id}/amendments/${aid}/${action}`, b),
  tracker: (q) => get(`/purchase-orders/tracker${q ? `?${q}` : ''}`),
  performance: () => get('/purchase-orders/performance'),
  // part 15.06: rate contracts, service orders, service entry sheets
  rc: (id) => get(`/rate-contracts/${id}`),
  rcCreate: (b) => post('/rate-contracts', b),
  rcUpdate: async (id, b) => (await api.patch(`/proc/rate-contracts/${id}`, b, idem())).data,
  rcDelete: async (id) => (await api.delete(`/proc/rate-contracts/${id}`)).data,
  rcAct: (id, action, b) => post(`/rate-contracts/${id}/${action}`, b),
  rcHistory: (id) => get(`/rate-contracts/${id}/history`),
  indices: (code) => get(`/rate-contracts/indices${code ? `?code=${encodeURIComponent(code)}` : ''}`),
  indexSet: (b) => post('/rate-contracts/indices', b),
  soOptions: (projectId) => get(`/service-orders/options?projectId=${projectId}`),
  so: (id) => get(`/service-orders/${id}`),
  soCreate: (b) => post('/service-orders', b),
  soUpdate: async (id, b) => (await api.patch(`/proc/service-orders/${id}`, b, idem())).data,
  soDelete: async (id) => (await api.delete(`/proc/service-orders/${id}`)).data,
  soAct: (id, action, b) => post(`/service-orders/${id}/${action}`, b),
  soHistory: (id) => get(`/service-orders/${id}/history`),
  seOrders: () => get('/service-entries/orders'),
  se: (id) => get(`/service-entries/${id}`),
  seCreate: (b) => post('/service-entries', b),
  seUpdate: async (id, b) => (await api.patch(`/proc/service-entries/${id}`, b, idem())).data,
  seDelete: async (id) => (await api.delete(`/proc/service-entries/${id}`)).data,
  seAct: (id, action, b) => post(`/service-entries/${id}/${action}`, b),
  seHistory: (id) => get(`/service-entries/${id}/history`),
};

export const XPD_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CLOSED: 'COMPLETED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const SHIP_TONE = { PLANNED: 'DRAFT', DISPATCHED: 'IN_REVIEW', IN_TRANSIT: 'IN_REVIEW', DELIVERED: 'COMPLETED', CANCELLED: 'CANCELLED' };
export const MS_TONE = { PENDING: 'DRAFT', IN_PROGRESS: 'IN_REVIEW', DONE: 'APPROVED', DELAYED: 'REJECTED' };
const patch = async (p, b) => (await api.patch(`/proc${p}`, b, idem())).data;
/** Expediting plans, vendor inspections and shipments (part 15.07). The risk, the arrival date, the clearance and the activities affected come from the server. */
export const px = {
  dashboard: (projectId) => get(`/expediting/dashboard${projectId ? `?projectId=${projectId}` : ''}`),
  projects: () => get('/expediting/projects'),
  orders: (projectId) => get(`/expediting/orders?projectId=${projectId}`),
  planOptions: (projectId) => get(`/expediting-plans/options?projectId=${projectId}`),
  plan: (id) => get(`/expediting-plans/${id}`), planCreate: (b) => post('/expediting-plans', b), planUpdate: (id, b) => patch(`/expediting-plans/${id}`, b),
  planDelete: async (id) => (await api.delete(`/proc/expediting-plans/${id}`)).data, planAct: (id, action, b) => post(`/expediting-plans/${id}/${action}`, b), planHistory: (id) => get(`/expediting-plans/${id}/history`),
  progress: (id, mid, b) => patch(`/expediting-plans/${id}/milestones/${mid}`, b),
  insp: (id) => get(`/inspections/${id}`), inspCreate: (b) => post('/inspections', b), inspUpdate: (id, b) => patch(`/inspections/${id}`, b),
  inspDelete: async (id) => (await api.delete(`/proc/inspections/${id}`)).data, inspAct: (id, action, b) => post(`/inspections/${id}/${action}`, b), inspHistory: (id) => get(`/inspections/${id}/history`),
  ship: (id) => get(`/shipments/${id}`), shipCreate: (b) => post('/shipments', b), shipUpdate: (id, b) => patch(`/shipments/${id}`, b),
  shipDelete: async (id) => (await api.delete(`/proc/shipments/${id}`)).data, shipAct: (id, action, b) => post(`/shipments/${id}/${action}`, b),
};

export const AVL_TONE = { APPROVED: 'APPROVED', CONDITIONAL: 'RETURNED', SUSPENDED: 'REJECTED', EXPIRED: 'CANCELLED' };
export const RATING_TONE = { A: 'APPROVED', B: 'APPROVED', C: 'RETURNED', D: 'REJECTED', NA: 'DRAFT' };
export const RESULT_TONE = { PENDING: 'DRAFT', QUALIFIED: 'APPROVED', CONDITIONAL: 'RETURNED', NOT_QUALIFIED: 'REJECTED' };
export const pct = (n) => (n == null ? '—' : `${(n / 10000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`);
/** Vendor prequalification, the approved vendor list, scorecards and actions (part 15.08). The scores, ratings, eligibility and ranks come from the server. */
export const pv8 = {
  options: () => get('/prequalifications/options'),
  preq: (id) => get(`/prequalifications/${id}`), preqCreate: (b) => post('/prequalifications', b), preqUpdate: (id, b) => patch(`/prequalifications/${id}`, b),
  preqDelete: async (id) => (await api.delete(`/proc/prequalifications/${id}`)).data, preqAct: (id, action, b) => post(`/prequalifications/${id}/${action}`, b), preqHistory: (id) => get(`/prequalifications/${id}/history`),
  susp: (id) => get(`/avl-suspensions/${id}`), suspCreate: (b) => post('/avl-suspensions', b), suspAct: (id, action, b) => post(`/avl-suspensions/${id}/${action}`, b), suspHistory: (id) => get(`/avl-suspensions/${id}/history`),
  partner: (id) => get(`/vendor-scorecards/partner/${id}`), compute: (b) => post('/vendor-scorecards/compute', b), input: (b) => post('/vendor-scorecards/inputs', b),
  ranking: (q) => get(`/vendor-ranking${q ? `?${q}` : ''}`),
  actionCreate: (b) => post('/vendor-actions', b), actionAct: (id, action, b) => post(`/vendor-actions/${id}/${action}`, b),
};

/** Material rate intelligence (part 15.09). Benchmarks, trends, volatility and exposures come from the server. */
export const ri = {
  dashboard: (region) => get(`/rate-intelligence/dashboard${region ? `?region=${encodeURIComponent(region)}` : ''}`),
  series: (itemId, region, months = 12) => get(`/rate-intelligence/series?itemId=${itemId}${region ? `&region=${encodeURIComponent(region)}` : ''}&months=${months}`),
  items: (q) => get(`/rate-intelligence/items?q=${encodeURIComponent(q ?? '')}`), projects: () => get('/rate-intelligence/projects'),
  exposure: (projectId) => get(`/rate-exposure?projectId=${projectId}`),
  obs: (id) => get(`/rate-observations/${id}`), survey: (b) => post('/rate-observations', b), correct: (id, b) => post(`/rate-observations/${id}/correct`, b),
  indices: (group) => get(`/rate-indices${group ? `?group=${encodeURIComponent(group)}` : ''}`), indexSet: (b) => post('/rate-indices', b), indexImport: (rows) => post('/rate-indices/import', { rows }),
};
/** A CSV the browser saves, with cells that start like a formula neutralised. */
export function saveCsv(name, rows) {
  const cell = (v) => { let s = v == null ? '' : String(v); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Procurement dashboard and analytics (part 15.10). Every figure, share, ageing bucket, status colour and record comes from the server. */
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o ?? {})) if (v !== '' && v != null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
export const an = {
  dashboard: (q) => get(`/analytics/dashboard${qs(q)}`), projects: () => get('/analytics/projects'), spend: (q) => get(`/analytics/spend${qs(q)}`), spendDetail: (q) => get(`/analytics/spend/detail${qs(q)}`),
  cycle: (q) => get(`/analytics/cycle-time${qs(q)}`), compliance: (q) => get(`/analytics/compliance${qs(q)}`),
  myTasks: async () => { const rows = (await api.get('/workflow/tasks?mine=assigned')).data?.rows ?? []; return rows.filter((t) => String(t.instance?.docType ?? t.instance?.doc_type ?? 'PROC_').startsWith('PROC_')).length; },
};
