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

// ---- part 23.01: the general ledger ----
const glget = async (p) => (await api.get(`/fin${p}`)).data;
export const gl = {
  options: () => glget('/journals/options'),
  journal: (id) => glget(`/journals/${id}`),
  check: async (b) => (await api.post('/fin/journals/check', b)).data,
  create: async (b) => (await api.post('/fin/journals', b, idem())).data,
  update: async (id, b) => (await api.patch(`/fin/journals/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/fin/journals/${id}`, idem())).data,
  act: async (id, action, b) => (await api.post(`/fin/journals/${id}/${action}`, b ?? {}, idem())).data,
  history: (id) => glget(`/journals/${id}/history`),
  decide: async (taskId, action, comment) => (await api.post(`/workflow/tasks/${taskId}/act`, comment ? { action, comment } : { action }, idem())).data,
  ledger: (f) => glget(`/ledger?${q(f)}`),
  trialBalance: (f) => glget(`/trial-balance?${q(f)}`),
  carryForward: async (fyId) => (await api.post('/fin/gl/carry-forward', { fyId }, idem())).data,
  recurring: (id) => glget(`/recurring-journals/${id}`),
  saveRecurring: async (id, b) => (id ? (await api.put(`/fin/recurring-journals/${id}`, b, idem())).data : (await api.post('/fin/recurring-journals', b, idem())).data),
  recurringStatus: async (id, b) => (await api.post(`/fin/recurring-journals/${id}/status`, b, idem())).data,
  /** A file of the general ledger (print, export) saved under its name. */
  file: async (path, name) => { const res = await fetch(`/api/v1/fin${path}`, { headers: authHeaders() }); if (!res.ok) throw new Error(String(res.status)); const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); },
  q,
};
export const DIM_KEYS = ['branchId', 'projectId', 'siteId', 'wbsId', 'costCentreId', 'profitCentreId', 'departmentId', 'costCodeId', 'partnerId', 'employeeId', 'equipmentId'];
/** The account rule of each dimension field (06.05); cost code and partner have no rule and are always open. */
export const DIM_RULE = { branchId: 'BRANCH', projectId: 'PROJECT', siteId: 'SITE', wbsId: 'WBS', costCentreId: 'COST_CENTRE', profitCentreId: 'PROFIT_CENTRE', departmentId: 'DEPARTMENT', employeeId: 'EMPLOYEE', equipmentId: 'EQUIPMENT' };
/** The option list of the journal options for each dimension field. */
export const DIM_LIST = { branchId: 'branches', projectId: 'projects', siteId: 'sites', wbsId: 'wbs', costCentreId: 'costCentres', profitCentreId: 'profitCentres', departmentId: 'departments', costCodeId: 'costCodes', partnerId: 'partners', employeeId: 'employees', equipmentId: 'equipment' };
export const JN_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v) => (v == null || v === '' ? '—' : `₹ ${inr.format(Number(v))}`);

// ---- part 23.02: the posting engine ----
export const pe = {
  catalogue: () => glget('/posting-rules/catalogue'),
  samples: (eventType) => glget(`/posting-rules/samples?eventType=${encodeURIComponent(eventType)}`),
  rule: (id) => glget(`/posting-rules/${id}`),
  propose: async (b) => (await api.post('/fin/posting-rules', b, idem())).data,
  updateRule: async (id, b) => (await api.patch(`/fin/posting-rules/${id}`, b, idem())).data,
  ruleAct: async (id, action, b) => (await api.post(`/fin/posting-rules/${id}/${action}`, b ?? {}, idem())).data,
  ruleHistory: (id) => glget(`/posting-rules/${id}/history`),
  test: async (b) => (await api.post('/fin/posting-rules/test', b)).data,
  posting: (id) => glget(`/postings/${id}`),
  summary: () => glget('/postings/summary'),
  repost: async (id) => (await api.post(`/fin/postings/${id}/repost`, {}, idem())).data,
  repostAll: async (errorCode) => (await api.post('/fin/postings/repost-all', errorCode ? { errorCode } : {}, idem())).data,
  resolve: async (id, b) => (await api.post(`/fin/postings/${id}/resolve`, b, idem())).data,
  replays: () => glget('/replays'),
  replay: (id) => glget(`/replays/${id}`),
  dryRun: async (b) => (await api.post('/fin/replays', b, idem())).data,
  replayAct: async (id, action, b) => (await api.post(`/fin/replays/${id}/${action}`, b ?? {}, idem())).data,
  recon: (asOf) => glget(`/reconciliation${asOf ? `?asOf=${asOf}` : ''}`),
};

// ---- part 23.03: accounts payable ----
export const ap = {
  bill: (id) => glget(`/bills/${id}`),
  tdsPreview: (f) => glget(`/bills/tds-preview?${q(f)}`),
  createBill: async (b) => (await api.post('/fin/bills', b, idem())).data,
  updateBill: async (id, b) => (await api.patch(`/fin/bills/${id}`, b, idem())).data,
  billAct: async (id, action, b) => (await api.post(`/fin/bills/${id}/${action}`, b ?? {}, idem())).data,
  removeBill: async (id) => (await api.delete(`/fin/bills/${id}`, idem())).data,
  note: (id) => glget(`/debit-notes/${id}`),
  createNote: async (b) => (await api.post('/fin/debit-notes', b, idem())).data,
  noteAct: async (id, action, b) => (await api.post(`/fin/debit-notes/${id}/${action}`, b ?? {}, idem())).data,
  partners: () => glget('/payables/partners'),
  ledger: (f) => glget(`/payables/vendor-ledger?${q(f)}`),
  ageing: (asOf) => glget(`/payables/ageing${asOf ? `?asOf=${asOf}` : ''}`),
  msme: (asOf) => glget(`/payables/msme${asOf ? `?asOf=${asOf}` : ''}`),
  tds: (f) => glget(`/payables/tds?${q(f)}`),
};
export const NATURES = ['CONTRACTOR', 'PROFESSIONAL', 'PURCHASE_GOODS', 'RENT_PLANT', 'RENT_LAND', 'COMMISSION'];
// part 23.04: payments (bank accounts, proposals, runs, payments)
export const pm = {
  banks: () => glget('/bank-accounts'),
  bank: (id) => glget(`/bank-accounts/${id}`),
  formats: () => glget('/bank-accounts/formats'),
  saveBank: async (id, b) => (id ? (await api.put(`/fin/bank-accounts/${id}`, b, idem())).data : (await api.post('/fin/bank-accounts', b, idem())).data),
  candidates: (f) => glget(`/proposals/candidates?${q(f)}`),
  proposal: (id) => glget(`/proposals/${id}`),
  create: async (b) => (await api.post('/fin/proposals', b, idem())).data,
  update: async (id, b) => (await api.patch(`/fin/proposals/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/fin/proposals/${id}`, idem())).data,
  act: async (id, action, b) => (await api.post(`/fin/proposals/${id}/${action}`, b ?? {}, idem())).data,
  dropLine: async (id, lineId, reason) => (await api.post(`/fin/proposals/${id}/lines/${lineId}/drop`, { reason }, idem())).data,
  history: (id) => glget(`/proposals/${id}/history`),
  payment: (id) => glget(`/payments/${id}`),
  confirm: async (b) => (await api.post('/fin/payments/confirm', b, idem())).data,
  advice: async (id) => (await api.post(`/fin/payments/${id}/advice`, {}, idem())).data,
  chequeRegister: (bankAccountId) => glget(`/payments/cheque-register?bankAccountId=${bankAccountId}`),
  myTasks: async () => (await api.get('/workflow/tasks?mine=assigned')).data,
};
// part 23.05: receivables
export const ar = {
  invoice: (id) => glget(`/invoices/${id}`),
  openInvoices: (partnerId) => glget(`/invoices/open?partnerId=${partnerId}`),
  createInvoice: async (b) => (await api.post('/fin/invoices', b, idem())).data,
  invoiceAct: async (id, action, b) => (await api.post(`/fin/invoices/${id}/${action}`, b ?? {}, idem())).data,
  followup: async (id, b) => (await api.post(`/fin/invoices/${id}/followups`, b, idem())).data,
  receipt: (id) => glget(`/receipts/${id}`),
  createReceipt: async (b) => (await api.post('/fin/receipts', b, idem())).data,
  receiptAct: async (id, action, b) => (await api.post(`/fin/receipts/${id}/${action}`, b ?? {}, idem())).data,
  creditNotes: () => glget('/credit-notes'),
  creditNote: (id) => glget(`/credit-notes/${id}`),
  createCreditNote: async (b) => (await api.post('/fin/credit-notes', b, idem())).data,
  creditNoteAct: async (id, action, b) => (await api.post(`/fin/credit-notes/${id}/${action}`, b ?? {}, idem())).data,
  writeOff: (id) => glget(`/write-offs/${id}`),
  createWriteOff: async (b) => (await api.post('/fin/write-offs', b, idem())).data,
  writeOffAct: async (id, action, b) => (await api.post(`/fin/write-offs/${id}/${action}`, b ?? {}, idem())).data,
  collections: (f) => glget(`/receivables/collections?${q(f)}`),
  clients: () => glget('/receivables/clients'),
  ageing: (f) => glget(`/receivables/ageing?${q(f)}`),
  statement: (f) => glget(`/receivables/statement?${q(f)}`),
  tds: (f) => glget(`/receivables/tds?${q(f)}`),
};
// part 23.06: cash and bank
export const cb = {
  profile: (id) => glget(`/bank-profiles/${id}`),
  saveProfile: async (id, b) => (await api.put(`/fin/bank-profiles/${id}`, b, idem())).data,
  importStatement: async (b) => (await api.post('/fin/bank-statements/import', b, idem())).data,
  lines: (f) => glget(`/bank-statements?${q(f)}`),
  candidates: (id) => glget(`/bank-statements/${id}/candidates`),
  lineAct: async (id, action, b) => (await api.post(`/fin/bank-statements/${id}/${action}`, b ?? {}, idem())).data,
  rematch: async (bankAccountId) => (await api.post('/fin/bank-statements/rematch', { bankAccountId }, idem())).data,
  brs: (f) => glget(`/brs?${q(f)}`),
  signBrs: async (b) => (await api.post('/fin/brs/sign', b, idem())).data,
  imprests: () => glget('/imprests'),
  imprest: (id) => glget(`/imprests/${id}`),
  createImprest: async (b) => (await api.post('/fin/imprests', b, idem())).data,
  count: async (id, b) => (await api.post(`/fin/imprests/${id}/count`, b, idem())).data,
  voucher: (id) => glget(`/imprest-vouchers/${id}`),
  createVoucher: async (b) => (await api.post('/fin/imprest-vouchers', b, idem())).data,
  voucherAct: async (id, action, b) => (await api.post(`/fin/imprest-vouchers/${id}/${action}`, b ?? {}, idem())).data,
  replenishments: () => glget('/imprest-replenishments'),
  replenishment: (id) => glget(`/imprest-replenishments/${id}`),
  replenish: async (b) => (await api.post('/fin/imprest-replenishments', b, idem())).data,
  contras: () => glget('/contras'),
  contra: (id) => glget(`/contras/${id}`),
  createContra: async (b) => (await api.post('/fin/contras', b, idem())).data,
  contraAct: async (id, action, b) => (await api.post(`/fin/contras/${id}/${action}`, b ?? {}, idem())).data,
  position: (date) => glget(`/cash-position${date ? `?date=${date}` : ''}`),
};
