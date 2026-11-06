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
  analyses: async () => (await api.get('/mdm/analyses?status=APPROVED&current=1&limit=200')).data,
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
