import { api, authHeaders } from '../../platform/api/index.js';

// The data calls of the finance master pages (part 06.05): chart of accounts, account, cost heads and cost codes, item category mapping, changes, import.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const CHANGE_STATUS = { PENDING: ['IN_REVIEW', 'Waiting for approval'], RETURNED: ['RETURNED', 'Returned for correction'], APPLIED: ['COMPLETED', 'Approved and applied'], REJECTED: ['REJECTED', 'Rejected'], CANCELLED: ['CANCELLED', 'Withdrawn'] };
export const NATURE = { ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expenses' };
export const TYPES = [['GENERAL', 'General'], ['BANK', 'Bank'], ['CASH', 'Cash'], ['RECEIVABLE', 'Receivable'], ['PAYABLE', 'Payable'], ['TAX', 'Tax'], ['INVENTORY', 'Inventory'], ['WIP', 'Work-in-progress'], ['RETENTION', 'Retention'], ['FIXED_ASSET', 'Fixed asset'], ['REVENUE', 'Revenue'], ['EXPENSE', 'Expense'], ['EQUITY', 'Equity']];
export const TYPE_LABEL = Object.fromEntries(TYPES);
export const CONTROLS = [['AP', 'Accounts payable'], ['AR', 'Accounts receivable'], ['GST_INPUT', 'GST input'], ['GST_OUTPUT', 'GST output'], ['TDS_PAYABLE', 'TDS payable'], ['TDS_RECEIVABLE', 'TDS receivable'], ['RETENTION_PAYABLE', 'Retention payable'], ['RETENTION_RECEIVABLE', 'Retention receivable'], ['INVENTORY', 'Inventory'], ['WIP', 'Work-in-progress']];
export const REQ = [['MANDATORY', 'Mandatory'], ['OPTIONAL', 'Optional'], ['NOT_ALLOWED', 'Not allowed']];
export const fin = {
  chart: async (f) => (await api.get(`/fin/accounts?${q(f)}`)).data,
  account: async (id) => (await api.get(`/fin/accounts/${id}`)).data,
  createAccount: async (b) => (await api.post('/fin/accounts', b, idem())).data,
  updateAccount: async (id, b) => (await api.put(`/fin/accounts/${id}`, b, idem())).data,
  block: async (id, b) => (await api.post(`/fin/accounts/${id}/block`, b, idem())).data,
  remove: async (id, reason) => (await api.delete(`/fin/accounts/${id}`, idem(), { reason })).data,
  dimensions: async (id, b) => (await api.put(`/fin/accounts/${id}/dimension-rules`, b, idem())).data,
  checkPosting: async (b) => (await api.post('/fin/postings/check', b)).data,
  createGroup: async (b) => (await api.post('/fin/account-groups', b, idem())).data,
  updateGroup: async (id, b) => (await api.put(`/fin/account-groups/${id}`, b, idem())).data,
  schedule3: async () => (await api.get('/fin/schedule-iii')).data,
  costs: async () => (await api.get('/fin/cost-heads')).data,
  createHead: async (b) => (await api.post('/fin/cost-heads', b, idem())).data,
  updateHead: async (id, b) => (await api.put(`/fin/cost-heads/${id}`, b, idem())).data,
  createCode: async (b) => (await api.post('/fin/cost-codes', b, idem())).data,
  updateCode: async (id, b) => (await api.put(`/fin/cost-codes/${id}`, b, idem())).data,
  mappings: async () => (await api.get('/fin/category-mappings')).data,
  saveMappings: async (b) => (await api.post('/fin/category-mappings', b, idem())).data,
  changes: async (f) => (await api.get(`/fin/changes?${q(f)}`)).data,
  withdraw: async (id, reason) => (await api.post(`/fin/changes/${id}/withdraw`, { reason }, idem())).data,
  resubmit: async (id, reason) => (await api.post(`/fin/changes/${id}/resubmit`, { reason }, idem())).data,
  importPreview: async (b) => (await api.post('/fin/import/preview', b)).data,
  importSubmit: async (b) => (await api.post('/fin/import', b, idem())).data,
  /** The chart as CSV (the server writes the export to the audit trail). */
  exportCsv: async () => { const r = await fetch('/api/v1/fin/accounts/export', { headers: { ...authHeaders() } }); if (!r.ok) throw new Error('The export failed'); return r.text(); },
};
/** A CSV of ledgers (a Tally "List of Ledgers" export or any file with a name and a group column) as rows { name, parent, code }. */
export function parseLedgers(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim());
  const cells = (l) => { const out = []; let cur = ''; let quoted = false; for (const ch of l) { if (ch === '"') quoted = !quoted; else if ((ch === ',' || ch === '\t') && !quoted) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  if (!lines.length) return [];
  const head = cells(lines[0]).map((h) => h.toLowerCase());
  const col = (names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const hasHead = col(['name', 'ledger', 'particulars']) >= 0;
  const ni = hasHead ? col(['name', 'ledger', 'particulars']) : 0;
  const pi = hasHead ? col(['under', 'parent', 'group']) : 1;
  const ci = hasHead ? col(['code', 'alias', 'account code']) : -1;
  return lines.slice(hasHead ? 1 : 0).map(cells).filter((c) => c[ni]).map((c) => ({ name: c[ni], parent: pi >= 0 ? c[pi] ?? '' : '', ...(ci >= 0 && c[ci] ? { code: c[ci] } : {}) })).slice(0, 2000);
}
