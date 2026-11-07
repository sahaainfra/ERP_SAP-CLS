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

// Part 10.04: BOQ versions, lines, mapping, norms, import, changes after the freeze and the reports.
export const BOQ_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const MAP_TONE = { MAPPED: 'APPROVED', PARTIAL: 'AT_RISK', UNMAPPED: 'REJECTED', NONE: 'DRAFT' };
export const NORM_TYPES = ['MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER'];
export const bq = {
  projects: async () => (await api.get('/proj/boq-projects')).data,
  versions: async (q = '') => (await api.get(`/proj/versions?pageSize=100${q}`)).data,
  get: async (id) => (await api.get(`/proj/versions/${id}`)).data,
  create: async (b) => (await api.post('/proj/versions', b, idem())).data,
  update: async (id, b) => (await api.patch(`/proj/versions/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/proj/versions/${id}`)).data,
  act: async (id, action, b = {}) => (await api.post(`/proj/versions/${id}/${action}`, b, idem())).data,
  history: async (id) => (await api.get(`/proj/versions/${id}/history`)).data,
  lines: async (id, unmapped = false) => (await api.get(`/proj/versions/${id}/lines${unmapped ? '?unmapped=true' : ''}`)).data,
  addLine: async (id, b) => (await api.post(`/proj/versions/${id}/lines`, b, idem())).data,
  updateLine: async (id, b) => (await api.patch(`/proj/boq-lines/${id}`, b, idem())).data,
  removeLine: async (id) => (await api.delete(`/proj/boq-lines/${id}`)).data,
  mapping: async (id) => (await api.get(`/proj/boq-lines/${id}/mapping`)).data,
  setMapping: async (id, splits) => (await api.put(`/proj/boq-lines/${id}/mapping`, { splits }, idem())).data,
  bulkMap: async (versionId, b) => (await api.post(`/proj/versions/${versionId}/mapping/bulk`, b, idem())).data,
  norms: async (id) => (await api.get(`/proj/boq-lines/${id}/norms`)).data,
  setNorms: async (id, norms) => (await api.put(`/proj/boq-lines/${id}/norms`, { norms }, idem())).data,
  normsFromAnalysis: async (id) => (await api.post(`/proj/boq-lines/${id}/norms/from-analysis`, {}, idem())).data,
  amend: async (id, b) => (await api.post(`/proj/versions/${id}/amend`, b, idem())).data,
  changes: async (versionId) => (await api.get(`/proj/boq-changes?versionId=${versionId}`)).data,
  actChange: async (id, action, b = {}) => (await api.post(`/proj/boq-changes/${id}/${action}`, b, idem())).data,
  stage: async (b) => (await api.post('/proj/versions/import/rows', b, idem())).data,
  importRun: async (b) => (await api.post('/proj/versions/import', b, idem())).data,
  abstract: async (id) => (await api.get(`/proj/versions/${id}/abstract`)).data,
  unmapped: async (id) => (await api.get(`/proj/versions/${id}/unmapped`)).data,
  compare: async (a, b) => (await api.get(`/proj/versions/compare?a=${a}&b=${b}`)).data,
};
export async function downloadBoq(id, format) {
  const { authHeaders } = await import('../../platform/api/index.js');
  const w = format === 'html' ? window.open('', '_blank') : null;
  try {
    const res = await fetch(`/api/v1/proj/versions/${id}/document?format=${format}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob()); if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = `boq-${id}.${format}`; a.click(); }
  } catch { w?.close(); }
}
/** The rows of text pasted from Excel (tab separated, or comma separated) as a table of cells. */
export function parseTable(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== ''); if (!lines.length) return { headers: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ','; const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
  return { headers: cells[0], rows: cells.slice(1) };
}
export const IMPORT_FIELDS = ['bill', 'section', 'itemCode', 'description', 'uom', 'qty', 'rate', 'parentCode', 'extra'];
export const guessField = (h) => { const x = h.toLowerCase(); if (/bill/.test(x)) return 'bill'; if (/section|group/.test(x)) return 'section'; if (/(item|sl|s\.?no|code|ref)/.test(x) && !/desc/.test(x)) return 'itemCode'; if (/desc|particular|work/.test(x)) return 'description'; if (/unit|uom/.test(x)) return 'uom'; if (/qty|quant/.test(x)) return 'qty'; if (/rate/.test(x)) return 'rate'; if (/parent/.test(x)) return 'parentCode'; if (/extra|nsi|non/.test(x)) return 'extra'; return ''; };

// Part 10.05: the project team, stakeholders, communication matrix, meetings, minutes and action items.
export const TEAM_TONE = { REQUESTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', ENDED: 'CANCELLED' };
export const MEET_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export const ACTION_TONE = { OPEN: 'DRAFT', IN_PROGRESS: 'IN_REVIEW', BLOCKED: 'REJECTED', DONE: 'APPROVED', CANCELLED: 'CANCELLED' };
export const SKINDS = ['CLIENT', 'CONSULTANT', 'AUTHORITY', 'FUNDER', 'SUBCONTRACTOR', 'SUPPLIER', 'COMMUNITY', 'OTHER'];
export const FREQS = ['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ON_EVENT'];
export const CHANNELS = ['EMAIL', 'MEETING', 'PORTAL', 'REPORT', 'LETTER', 'PHONE'];
export const MTYPES = ['KICKOFF', 'WEEKLY_PROGRESS', 'COORDINATION', 'SAFETY', 'CLIENT_REVIEW', 'OTHER'];
export const tm = {
  team: async (p) => (await api.get(`/proj/team?projectId=${p}`)).data,
  addMember: async (b) => (await api.post('/proj/team', b, idem())).data,
  teamAct: async (id, action, b = {}) => (await api.post(`/proj/team/${id}/${action}`, b, idem())).data,
  stakeholders: async (p) => (await api.get(`/proj/stakeholders?projectId=${p}`)).data,
  addStakeholder: async (b) => (await api.post('/proj/stakeholders', b, idem())).data,
  updateStakeholder: async (id, b) => (await api.patch(`/proj/stakeholders/${id}`, b, idem())).data,
  removeStakeholder: async (id) => (await api.delete(`/proj/stakeholders/${id}`)).data,
  matrix: async (p) => (await api.get(`/proj/comm-matrix?projectId=${p}`)).data,
  addComm: async (b) => (await api.post('/proj/comm-matrix', b, idem())).data,
  removeComm: async (id) => (await api.delete(`/proj/comm-matrix/${id}`)).data,
  meeting: async (id) => (await api.get(`/proj/meetings/${id}`)).data,
  createMeeting: async (b) => (await api.post('/proj/meetings', b, idem())).data,
  updateMeeting: async (id, b) => (await api.patch(`/proj/meetings/${id}`, b, idem())).data,
  removeMeeting: async (id) => (await api.delete(`/proj/meetings/${id}`)).data,
  meetingAct: async (id, action, b = {}) => (await api.post(`/proj/meetings/${id}/${action}`, b, idem())).data,
  meetingHistory: async (id) => (await api.get(`/proj/meetings/${id}/history`)).data,
  actionSummary: async (p) => (await api.get(`/proj/meeting-actions/summary${p ? `?projectId=${p}` : ''}`)).data,
  updateAction: async (id, b) => (await api.patch(`/proj/meeting-actions/${id}`, b, idem())).data,
};
// ---- Part 10.06: risks, opportunities and issues ----
export const RISK_TONE = { OPEN: 'ACTIVE', CLOSE_REQUESTED: 'IN_REVIEW', CLOSED: 'COMPLETED', OCCURRED: 'REJECTED', CANCELLED: 'CANCELLED' };
export const LEVEL_TONE = { LOW: 'ACTIVE', MEDIUM: 'AT_RISK', HIGH: 'AT_RISK', CRITICAL: 'REJECTED' };
export const ISSUE_TONE = { OPEN: 'DRAFT', IN_PROGRESS: 'IN_REVIEW', RESOLVED: 'APPROVED', CANCELLED: 'CANCELLED' };
export const RISK_CATEGORIES = ['TECHNICAL', 'COMMERCIAL', 'CONTRACTUAL', 'SAFETY', 'ENVIRONMENTAL', 'FINANCIAL', 'STATUTORY'];
export const RISK_STRATEGIES = { RISK: ['AVOID', 'MITIGATE', 'TRANSFER', 'ACCEPT'], OPPORTUNITY: ['EXPLOIT', 'ENHANCE', 'SHARE', 'ACCEPT'] };
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const dl = (p) => (p ? `?projectId=${p}` : '');
export const rk = {
  dashboard: async (p) => (await api.get(`/proj/risk-dashboard${dl(p)}`)).data,
  settings: async (p) => (await api.get(`/proj/risk-settings${dl(p)}`)).data,
  putSettings: async (b) => (await api.put('/proj/risk-settings', b, idem())).data,
  risk: async (id) => (await api.get(`/proj/risks/${id}`)).data,
  createRisk: async (b) => (await api.post('/proj/risks', b, idem())).data,
  updateRisk: async (id, b) => (await api.patch(`/proj/risks/${id}`, b, idem())).data,
  removeRisk: async (id) => (await api.delete(`/proj/risks/${id}`)).data,
  riskAct: async (id, action, b = {}) => (await api.post(`/proj/risks/${id}/${action}`, b, idem())).data,
  riskHistory: async (id) => (await api.get(`/proj/risks/${id}/history`)).data,
  reading: async (id, tid, b) => (await api.post(`/proj/risks/${id}/triggers/${tid}/reading`, b, idem())).data,
  rearm: async (id, tid) => (await api.post(`/proj/risks/${id}/triggers/${tid}/rearm`, {}, idem())).data,
  contingency: async (id, b) => (await api.post(`/proj/risks/${id}/contingency`, b, idem())).data,
  release: async (id, cid) => (await api.post(`/proj/risks/${id}/contingency/${cid}/release`, {}, idem())).data,
  issue: async (id) => (await api.get(`/proj/issues/${id}`)).data,
  createIssue: async (b) => (await api.post('/proj/issues', b, idem())).data,
  updateIssue: async (id, b) => (await api.patch(`/proj/issues/${id}`, b, idem())).data,
  removeIssue: async (id) => (await api.delete(`/proj/issues/${id}`)).data,
  issueAct: async (id, action, b = {}) => (await api.post(`/proj/issues/${id}/${action}`, b, idem())).data,
  issueHistory: async (id) => (await api.get(`/proj/issues/${id}/history`)).data,
  reviews: async (p) => (await api.get(`/proj/risk-reviews${dl(p)}`)).data,
  createReview: async (b) => (await api.post('/proj/risk-reviews', b, idem())).data,
  updateReview: async (id, b) => (await api.patch(`/proj/risk-reviews/${id}`, b, idem())).data,
  reviewAct: async (id, action, b = {}) => (await api.post(`/proj/risk-reviews/${id}/${action}`, b, idem())).data,
};
export async function downloadFile(path, name) {
  const { authHeaders } = await import('../../platform/api/index.js');
  const w = /format=html|\/print/.test(path) ? window.open('', '_blank') : null;
  try { const res = await fetch(`/api/v1/proj${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); } } catch { w?.close(); }
}
