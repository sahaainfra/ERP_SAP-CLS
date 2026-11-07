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

// Part 10.03: the WBS, the location breakdown, the matrix, the changes after the baseline and the work packages.
const pq = (projectId) => `projectId=${projectId}`;
export const st = {
  projects: async () => (await api.get('/proj/wbs-projects')).data,
  tree: async (p) => (await api.get(`/proj/wbs?${pq(p)}`)).data,
  create: async (p, b) => (await api.post(`/proj/wbs?${pq(p)}`, b, idem())).data,
  update: async (p, id, b) => (await api.patch(`/proj/wbs/${id}?${pq(p)}`, b, idem())).data,
  remove: async (p, id) => (await api.delete(`/proj/wbs/${id}?${pq(p)}`)).data,
  move: async (p, id, b) => (await api.post(`/proj/wbs/${id}/move?${pq(p)}`, b, idem())).data,
  setStatus: async (p, id, on) => (await api.post(`/proj/wbs/${id}/${on ? 'activate' : 'deactivate'}?${pq(p)}`, {}, idem())).data,
  bulk: async (p, b) => (await api.post(`/proj/wbs/bulk?${pq(p)}`, b, idem())).data,
  normalise: async (p, b = {}) => (await api.post(`/proj/wbs/normalise?${pq(p)}`, b, idem())).data,
  template: async (p, b) => (await api.post(`/proj/wbs/template?${pq(p)}`, b, idem())).data,
  copy: async (p, b) => (await api.post(`/proj/wbs/copy?${pq(p)}`, b, idem())).data,
  baseline: async (p, b = {}) => (await api.post(`/proj/wbs/baseline?${pq(p)}`, b, idem())).data,
  versions: async (p) => (await api.get(`/proj/wbs-versions?${pq(p)}`)).data,
  version: async (p, id) => (await api.get(`/proj/wbs-versions/${id}?${pq(p)}`)).data,
  changes: async (p) => (await api.get(`/proj/wbs-changes?${pq(p)}`)).data,
  change: async (p, id) => (await api.get(`/proj/wbs-changes/${id}?${pq(p)}`)).data,
  locate: async (id) => (await api.get(`/proj/wbs-changes/${id}/locate`)).data,
  createChange: async (p, b) => (await api.post(`/proj/wbs-changes?${pq(p)}`, b, idem())).data,
  actChange: async (p, id, action, b = {}) => (await api.post(`/proj/wbs-changes/${id}/${action}?${pq(p)}`, b, idem())).data,
  locations: async (p) => (await api.get(`/proj/locations?${pq(p)}`)).data,
  createLoc: async (p, b) => (await api.post(`/proj/locations?${pq(p)}`, b, idem())).data,
  updateLoc: async (p, id, b) => (await api.patch(`/proj/locations/${id}?${pq(p)}`, b, idem())).data,
  removeLoc: async (p, id) => (await api.delete(`/proj/locations/${id}?${pq(p)}`)).data,
  moveLoc: async (p, id, b) => (await api.post(`/proj/locations/${id}/move?${pq(p)}`, b, idem())).data,
  setLocStatus: async (p, id, on) => (await api.post(`/proj/locations/${id}/${on ? 'activate' : 'deactivate'}?${pq(p)}`, {}, idem())).data,
  matrix: async (p) => (await api.get(`/proj/wbs-matrix?${pq(p)}`)).data,
  setMatrix: async (p, cells) => (await api.put(`/proj/wbs-matrix?${pq(p)}`, { cells }, idem())).data,
  wp: async (id) => (await api.get(`/proj/work-packages/${id}`)).data,
  createWp: async (b) => (await api.post('/proj/work-packages', b, idem())).data,
  updateWp: async (id, b) => (await api.patch(`/proj/work-packages/${id}`, b, idem())).data,
  removeWp: async (id) => (await api.delete(`/proj/work-packages/${id}`)).data,
};
/** Downloads the WBS as a file with the sign-in of this session. */
export async function downloadWbs(projectId, format) {
  const { authHeaders } = await import('../../platform/api/index.js');
  const res = await fetch(`/api/v1/proj/wbs/export?projectId=${projectId}&format=${format}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = `wbs-${projectId}.${format}`; a.click();
}
export const WP_TYPES = ['SELF', 'SUBCONTRACT', 'PROCUREMENT'];
export const LOC_TYPES = ['BLOCK', 'BUILDING', 'FLOOR', 'ZONE', 'ROOM', 'CHAINAGE', 'STRUCTURE'];
/** The nodes of a flat tree in the order of the tree (depth first, by sort order). */
export function ordered(nodes) {
  const kids = new Map(); for (const n of nodes) { const k = n.parentId ?? 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); }
  const out = []; const walk = (pid) => { for (const n of (kids.get(pid) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) { out.push(n); walk(n.id); } }; walk(0); return out;
}
