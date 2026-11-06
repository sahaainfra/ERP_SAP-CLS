import { api } from '../../platform/api/index.js';

// The data calls of the business development pages (part 08.01).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const SECTORS = ['BUILDING', 'ROADS', 'BRIDGES', 'WATER', 'INDUSTRIAL', 'EPC', 'OTHER'];
export const SOURCES = ['TENDER_PORTAL', 'REFERRAL', 'CLIENT_ENQUIRY', 'WEBSITE', 'EVENT', 'OTHER'];
export const REGIONS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL', 'NORTH_EAST'];
export const STAGES = ['IDENTIFIED', 'QUALIFIED', 'PRE_BID', 'TENDER_EXPECTED', 'BID_SUBMITTED', 'NEGOTIATION', 'WON', 'LOST'];
export const OPEN_STAGES = STAGES.slice(0, 6);
export const BANT = ['budget', 'authority', 'need', 'timeline'];
export const INFLUENCE_ROLES = ['DECISION_MAKER', 'INFLUENCER', 'TECHNICAL', 'FINANCE', 'USER', 'GATEKEEPER'];
export const STANCES = ['CHAMPION', 'SUPPORTER', 'NEUTRAL', 'SKEPTIC', 'BLOCKER'];
export const TYPES = ['CALL', 'MEETING', 'SITE_VISIT', 'EMAIL', 'NOTE'];
export const dayIST = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
export const inr = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
/** A big amount as lakh or crore, for tiles and cards. */
export const inrShort = (n) => { if (n == null) return '—'; const a = Math.abs(n); return a >= 1e7 ? `₹ ${(n / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹ ${(n / 1e5).toFixed(2)} L` : inr(n); };

export const bd = {
  lead: async (id) => (await api.get(`/bd/leads/${id}`)).data,
  createLead: async (b) => (await api.post('/bd/leads', b, idem())).data,
  updateLead: async (id, b) => (await api.patch(`/bd/leads/${id}`, b, idem())).data,
  leadAct: async (id, action, b = {}) => (await api.post(`/bd/leads/${id}/${action}`, b, idem())).data,
  deleteLead: async (id) => (await api.delete(`/bd/leads/${id}`)).data,
  leadHistory: async (id) => (await api.get(`/bd/leads/${id}/history`)).data,
  opp: async (id) => (await api.get(`/bd/opportunities/${id}`)).data,
  createOpp: async (b) => (await api.post('/bd/opportunities', b, idem())).data,
  updateOpp: async (id, b) => (await api.patch(`/bd/opportunities/${id}`, b, idem())).data,
  oppAct: async (id, action, b = {}) => (await api.post(`/bd/opportunities/${id}/${action}`, b, idem())).data,
  deleteOpp: async (id) => (await api.delete(`/bd/opportunities/${id}`)).data,
  oppHistory: async (id) => (await api.get(`/bd/opportunities/${id}/history`)).data,
  interactions: async (entity, entityId) => (await api.get(`/bd/interactions?${q({ entity, entityId })}`)).data,
  logInteraction: async (b) => (await api.post('/bd/interactions', b, idem())).data,
  interactionDone: async (id) => (await api.post(`/bd/interactions/${id}/done`, {}, idem())).data,
  removeInteraction: async (id) => (await api.delete(`/bd/interactions/${id}`)).data,
  client: async (id) => (await api.get(`/bd/clients/${id}`)).data,
  addContact: async (partnerId, b) => (await api.post(`/bd/clients/${partnerId}/contacts`, b, idem())).data,
  updateContact: async (id, b) => (await api.patch(`/bd/contacts/${id}`, b, idem())).data,
  removeContact: async (id) => (await api.delete(`/bd/contacts/${id}`)).data,
  dashboard: async (f) => (await api.get(`/bd/reports/dashboard?${q(f)}`)).data,
  forecast: async (f) => (await api.get(`/bd/reports/forecast?${q(f)}`)).data,
  winLoss: async (f) => (await api.get(`/bd/reports/win-loss?${q(f)}`)).data,
  board: async (f) => (await api.get(`/bd/reports/board?${q(f)}`)).data,
};
