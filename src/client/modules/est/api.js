import { api } from '../../platform/api/index.js';

// The data calls of the estimate workspace (part 09.01).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const MODES = ['RATE', 'ANALYSIS', 'MANUAL'];
export const COMPONENT_TYPES = ['MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER'];
export const INDIRECTS = ['SITE_ESTABLISHMENT', 'STAFF', 'CAMP', 'TEMPORARY_WORKS', 'INSURANCE', 'BG_CHARGES', 'FINANCE_COST', 'MOBILISATION', 'OTHER'];
export const BASES = ['LUMP_SUM', 'QTY_RATE', 'PERCENT'];
export const dayIST = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
export const inr = (n) => (n == null || n === '' ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const qty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const est = {
  list: async (f) => (await api.get(`/est/estimates?${q(f)}`)),
  get: async (id) => (await api.get(`/est/estimates/${id}`)).data,
  create: async (b) => (await api.post('/est/estimates', b, idem())).data,
  update: async (id, b) => (await api.patch(`/est/estimates/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/est/estimates/${id}`)).data,
  items: async (id, b) => (await api.put(`/est/estimates/${id}/items`, b, idem())).data,
  boq: async (id, b) => (await api.post(`/est/estimates/${id}/boq`, b, idem())).data,
  indirects: async (id, b) => (await api.put(`/est/estimates/${id}/indirects`, b, idem())).data,
  risks: async (id, b) => (await api.put(`/est/estimates/${id}/risks`, b, idem())).data,
  reprice: async (id, b) => (await api.post(`/est/estimates/${id}/reprice`, b, idem())).data,
  act: async (id, action, b = {}) => (await api.post(`/est/estimates/${id}/${action}`, b, idem())).data,
  history: async (id) => (await api.get(`/est/estimates/${id}/history`)).data,
  compare: async (id, withId) => (await api.get(`/est/estimates/${id}/compare?with=${withId}`)).data,
  resources: async (id, type) => (await api.get(`/est/estimates/${id}/resources?${q({ type })}`)).data,
  analyses: async () => (await api.get('/mdm/analyses?status=APPROVED&current=true&limit=200')).data,
  tenders: async () => (await api.get('/bd/tenders?filter[status]=APPROVED&pageSize=100')),
};
/** Rows pasted from a spreadsheet (tab-separated; the first row may be the header): section, section name, item no., description, unit, quantity, client rate. */
export function parsePasted(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const rows = lines.map((l) => l.split('\t'));
  if (rows.length && /section/i.test(rows[0][0] ?? '') && /item/i.test(rows[0].join(' '))) rows.shift();
  return rows.map((c) => ({ sectionCode: (c[0] ?? '').trim(), sectionName: (c[1] ?? '').trim() || null, itemNo: (c[2] ?? '').trim(), description: (c[3] ?? '').trim(), uom: (c[4] ?? '').trim(), qty: (c[5] ?? '').trim().replace(/,/g, ''), clientRate: (c[6] ?? '').trim().replace(/,/g, '') }));
}
/** The selling rate and amount while typing (the server works them out again on save). */
export function preview(costRate, markupPct, quantity) {
  const c = Number(costRate); const m = Number(markupPct || 0); const qn = Number(quantity || 0);
  if (!Number.isFinite(c) || costRate === '' || costRate == null) return { rate: null, amount: null };
  const rate = Math.round(c * (1 + m / 100) * 100) / 100; return { rate, amount: Math.round(rate * qn * 100) / 100 };
}

// Part 09.02: take-off sheets, engineering MTOs and bar bending schedules.
export const DISCIPLINES = ['CIVIL', 'STRUCTURAL', 'PIPING', 'ELECTRICAL', 'MECHANICAL', 'OTHER'];
export const DIAS = [6, 8, 10, 12, 16, 20, 25, 28, 32, 36, 40];
export const mto = {
  takeoff: async (id) => (await api.get(`/est/takeoffs/${id}`)).data,
  createTakeoff: async (b) => (await api.post('/est/takeoffs', b, idem())).data,
  updateTakeoff: async (id, b) => (await api.patch(`/est/takeoffs/${id}`, b, idem())).data,
  takeoffLines: async (id, b) => (await api.put(`/est/takeoffs/${id}/lines`, b, idem())).data,
  takeoffAct: async (id, action, b = {}) => (await api.post(`/est/takeoffs/${id}/${action}`, b, idem())).data,
  removeTakeoff: async (id) => (await api.delete(`/est/takeoffs/${id}`)).data,
  templates: async () => (await api.get('/est/takeoff-templates')).data,
  takeoffs: async (f) => (await api.get(`/est/takeoffs?${q(f)}`)),
  bbs: async (id) => (await api.get(`/est/bbs/${id}`)).data,
  bbsList: async (f) => (await api.get(`/est/bbs?${q(f)}`)),
  createBbs: async (b) => (await api.post('/est/bbs', b, idem())).data,
  bbsLines: async (id, b) => (await api.put(`/est/bbs/${id}/lines`, b, idem())).data,
  bbsAct: async (id, action, b = {}) => (await api.post(`/est/bbs/${id}/${action}`, b, idem())).data,
  removeBbs: async (id) => (await api.delete(`/est/bbs/${id}`)).data,
  shapes: async () => (await api.get('/est/bbs-shapes')).data,
  summary: async (f) => (await api.get(`/est/bbs-summary?${q(f)}`)).data,
  delta: async (kind, id, withId) => (await api.get(`/est/${kind === 'bbs' ? 'bbs' : 'takeoffs'}/${id}/delta?${q({ with: withId })}`)).data,
  explosion: async (kind, id) => (await api.get(`/est/${kind === 'bbs' ? 'bbs' : 'takeoffs'}/${id}/explosion`)).data,
  history: async (kind, id) => (await api.get(`/est/${kind === 'bbs' ? 'bbs' : 'takeoffs'}/${id}/history`)).data,
};
const r3 = (n) => Math.round(n * 1000) / 1000;
/** The quantity of a measurement line while typing (mto.measure on the server). */
export function measurePreview(tpl, l) {
  if (!tpl) return null; if (tpl.code === 'DIRECT') return l.quantity === '' ? null : Number(l.quantity);
  const v = (d) => (tpl.dims.includes(d) ? Number(l[d]) : 1); if (tpl.dims.some((d) => l[d] === '' || l[d] == null)) return null;
  return r3(Number(l.nos || 1) * v('length') * v('breadth') * v('height') - Number(l.deduction || 0));
}
/** The cut length, total length and weight of a bar mark while typing (mto.bbs_line on the server). */
export function bendPreview(shape, deductions, l) {
  if (!shape) return null; const legs = Object.entries(shape.legs ?? {}).reduce((s, [k, c]) => (l[k] === '' || l[k] == null || Number.isNaN(s) ? NaN : s + Number(l[k]) * Number(c)), 0);
  const dia = Number(l.dia); const nos = Number(l.membersCount || 1) * Number(l.barsEach || 0); if (Number.isNaN(legs) || !dia || !nos) return null;
  const bendD = Object.entries(shape.bends ?? {}).reduce((s, [k, n]) => s + Number(n) * Number(deductions?.[k] ?? 0), 0);
  const cut = r3(legs + ((shape.hooks ?? 0) * (shape.hookD ?? 0) - bendD) * dia / 1000); const total = r3(cut * nos); const unit = Math.floor((dia * dia / 162) * 1000) / 1000;
  return { nos, cut, total, unit, weight: r3(total * unit) };
}
