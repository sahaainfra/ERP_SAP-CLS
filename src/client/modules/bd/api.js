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

export const PORTALS = ['CPPP', 'GEM', 'STATE_PORTAL', 'CLIENT_SITE', 'OTHER'];
export const BID_TYPES = ['ITEM_RATE', 'PERCENTAGE', 'LUMP_SUM', 'EPC', 'HAM'];
export const TENDER_STAGES = ['OPEN', 'BID', 'READY', 'SUBMITTED', 'AWARDED', 'LOST', 'NO_BID', 'CLOSED'];
export const CRITERIA = ['TURNOVER', 'SIMILAR_WORK', 'NET_WORTH', 'BID_CAPACITY', 'REGISTRATION_CLASS', 'JV', 'OTHER'];
export const IMPACTS = ['NONE', 'DATES', 'SCOPE', 'VALUE', 'DOCUMENTS'];
export const TEAM_KINDS = ['ESTIMATION', 'TECHNICAL_DOCS', 'FINANCIAL_DOCS', 'SITE_VISIT', 'OTHER'];
export const SCORE_KEYS = ['STRATEGIC_FIT', 'MARGIN', 'RISK', 'CAPACITY', 'COMPETITION'];
export const DOC_KINDS = ['NIT', 'BOQ', 'CONDITIONS', 'DRAWINGS', 'ADDENDUM', 'OTHER'];

export const tdr = {
  tender: async (id) => (await api.get(`/bd/tenders/${id}`)).data,
  createTender: async (b) => (await api.post('/bd/tenders', b, idem())).data,
  updateTender: async (id, b) => (await api.patch(`/bd/tenders/${id}`, b, idem())).data,
  tenderAct: async (id, action, b = {}) => (await api.post(`/bd/tenders/${id}/${action}`, b, idem())).data,
  deleteTender: async (id) => (await api.delete(`/bd/tenders/${id}`)).data,
  tenderHistory: async (id) => (await api.get(`/bd/tenders/${id}/history`)).data,
  addEligibility: async (id, b) => (await api.post(`/bd/tenders/${id}/eligibility`, b, idem())).data,
  updateEligibility: async (id, b) => (await api.patch(`/bd/eligibility/${id}`, b, idem())).data,
  deleteEligibility: async (id) => (await api.delete(`/bd/eligibility/${id}`)).data,
  addAddendum: async (id, b) => (await api.post(`/bd/tenders/${id}/addenda`, b, idem())).data,
  ackAddendum: async (id) => (await api.post(`/bd/addenda/${id}/acknowledge`, {}, idem())).data,
  addQuery: async (id, b) => (await api.post(`/bd/tenders/${id}/queries`, b, idem())).data,
  queryAct: async (id, action, b = {}) => (await api.post(`/bd/queries/${id}/${action}`, b, idem())).data,
  addTask: async (id, b) => (await api.post(`/bd/tenders/${id}/team-tasks`, b, idem())).data,
  taskAct: async (id, action) => (await api.post(`/bd/team-tasks/${id}/${action}`, {}, idem())).data,
  documents: async (id) => (await api.get(`/bd/tenders/${id}/documents`)).data,
  registerDocument: async (id, b) => (await api.post(`/bd/tenders/${id}/documents`, b, idem())).data,
  decision: async (id) => (await api.get(`/bd/bid-decisions/${id}`)).data,
  createDecision: async (b) => (await api.post('/bd/bid-decisions', b, idem())).data,
  updateDecision: async (id, b) => (await api.patch(`/bd/bid-decisions/${id}`, b, idem())).data,
  decisionAct: async (id, action, b = {}) => (await api.post(`/bd/bid-decisions/${id}/${action}`, b, idem())).data,
  decisionHistory: async (id) => (await api.get(`/bd/bid-decisions/${id}/history`)).data,
  dashboard: async () => (await api.get('/bd/tender-reports/dashboard')).data,
  calendar: async (f) => (await api.get(`/bd/tender-reports/calendar?${q(f)}`)).data,
};

export const CRED_TYPES = ['WORK_ORDER', 'COMPLETION_CERTIFICATE', 'FINANCIALS', 'MACHINERY', 'KEY_PERSON', 'REGISTRATION', 'OTHER'];
export const EMD_MODES = ['BG', 'DD', 'ONLINE', 'EXEMPT'];
export const aw = {
  credentials: async (q2 = {}) => (await api.get(`/bd/credentials?${q(q2)}`)),
  credential: async (id) => (await api.get(`/bd/credentials/${id}`)).data,
  createCredential: async (b) => (await api.post('/bd/credentials', b, idem())).data,
  updateCredential: async (id, b) => (await api.patch(`/bd/credentials/${id}`, b, idem())).data,
  tenderCredentials: async (id) => (await api.get(`/bd/tenders/${id}/credentials`)).data,
  linkCredential: async (id, b) => (await api.post(`/bd/tenders/${id}/credentials`, b, idem())).data,
  unlinkCredential: async (linkId) => (await api.delete(`/bd/tender-credentials/${linkId}`)).data,
  emd: async (id) => (await api.get(`/bd/emd/${id}`)).data,
  tenderEmd: async (id) => (await api.get(`/bd/tenders/${id}/emd`)).data,
  createEmd: async (b) => (await api.post('/bd/emd', b, idem())).data,
  updateEmd: async (id, b) => (await api.patch(`/bd/emd/${id}`, b, idem())).data,
  emdAct: async (id, action, b = {}) => (await api.post(`/bd/emd/${id}/${action}`, b, idem())).data,
  ageing: async () => (await api.get('/bd/emd/ageing')).data,
  submission: async (tenderId) => (await api.get(`/bd/tenders/${tenderId}/submission`)).data,
  createSubmission: async (b) => (await api.post('/bd/submissions', b, idem())).data,
  updateSubmission: async (id, b) => (await api.patch(`/bd/submissions/${id}`, b, idem())).data,
  submissionAct: async (id, action, b = {}) => (await api.post(`/bd/submissions/${id}/${action}`, b, idem())).data,
  results: async (tenderId) => (await api.get(`/bd/tenders/${tenderId}/results`)).data,
  saveResults: async (tenderId, b) => (await api.put(`/bd/tenders/${tenderId}/results`, b, idem())).data,
  analysis: async (f) => (await api.get(`/bd/competitor-reports?${q(f)}`)).data,
  competitor: async (id) => (await api.get(`/bd/competitors/${id}`)).data,
  negotiations: async (tenderId) => (await api.get(`/bd/tenders/${tenderId}/negotiations`)).data,
  addNegotiation: async (tenderId, b) => (await api.post(`/bd/tenders/${tenderId}/negotiations`, b, idem())).data,
  award: async (id) => (await api.get(`/bd/awards/${id}`)).data,
  tenderAward: async (tenderId) => (await api.get(`/bd/tenders/${tenderId}/award`)).data,
  createAward: async (b) => (await api.post('/bd/awards', b, idem())).data,
  updateAward: async (id, b) => (await api.patch(`/bd/awards/${id}`, b, idem())).data,
  awardAct: async (id, action, b = {}) => (await api.post(`/bd/awards/${id}/${action}`, b, idem())).data,
};
/** The ranks of an opening as the server works them out (shown while typing; the server decides): lowest qualified price is L1, equal prices share the rank. */
export function rankPreview(rows) {
  const priced = rows.map((r, i) => ({ i, q: r.qualified && r.quoted !== '' ? Number(r.quoted) : null })).filter((x) => x.q != null).sort((a, b) => a.q - b.q);
  const out = rows.map(() => ({ rank: null, diff: null })); const l1 = priced[0]?.q ?? null; let rank = 0; let last = null;
  priced.forEach((x, k) => { if (x.q !== last) { rank = k + 1; last = x.q; } out[x.i] = { rank, diff: l1 ? Math.round(((x.q - l1) / l1) * 10000) / 100 : 0 }; });
  return out;
}
