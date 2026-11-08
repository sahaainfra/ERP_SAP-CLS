// Constants and helpers of the project budget (part 12.01). Amounts in paise, quantities x 1 000, rates x 10 000, percentages x 10 000.
export const BUDGET_DOC = 'BUD_BUDGET';
export const BUDGET_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved (locked)', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded by a revision' };
export const VTYPES = { ORIGINAL: 'Original budget', REVISED: 'Revised budget' };
export const LINE_KINDS = { DIRECT: 'Direct cost', OVERHEAD: 'Site and indirect overhead', CONTINGENCY: 'Contingency', RESERVE: 'Management reserve' };
export const RESOURCE_TYPES = { MATERIAL: 'Material', LABOUR: 'Labour', EQUIPMENT: 'Plant and equipment', TRANSPORT: 'Transport', SUBCONTRACT: 'Subcontract', OTHER: 'Other' };
/** BR-02: these lines carry a quantity as well as an amount, so that the budget check (12.03) and the cost control (14.07) compare quantities too. */
export const QTY_TYPES = ['MATERIAL', 'LABOUR', 'EQUIPMENT'];
export const METHODS = { MANUAL: 'Manual', SCHEDULE: 'From the schedule', SCURVE: 'S-curve profile' };
export const PROFILES = { LINEAR: 'Even spread', SCURVE: 'S-curve (slow start, fast middle, slow finish)', FRONT: 'Front loaded', BACK: 'Back loaded' };
export const DIMENSIONS = { wbs: 'WBS', cost_head: 'Cost head', resource: 'Resource', work_package: 'Work package', control_account: 'Control account' };
export const TARGET_MARGIN_DEFAULT = '5';
export const DEFAULT_CODES = { MATERIAL: 'MAT-OTH', LABOUR: 'LAB-SKL', EQUIPMENT: 'PLT-HIRE', TRANSPORT: 'PLT-HIRE', SUBCONTRACT: 'SUB-CIV', OTHER: 'MAT-OTH', SITE_OVERHEAD: 'SOH-EST', HEAD_OFFICE: 'HOH-ADMIN' };
export const nowIso = () => new Date().toISOString();
export const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
export const rid = (v) => parseInt(String(v), 10);
export const same = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** amount (paise) of a quantity (x 1 000) at a rate (x 10 000), rounded half up. */
export const lineAmount = (qty, rate) => Number((BigInt(qty) * BigInt(rate) + 50000n) / 100000n);
/** The rate (x 10 000) that a quantity (x 1 000) and an amount (paise) give. */
export const rateOf = (qty, amount) => (qty > 0 ? Number((BigInt(amount) * 100000n + BigInt(qty) / 2n) / BigInt(qty)) : 0);
export const rupees = (paise) => (paise / 100).toFixed(2);
export const paise = (text) => Math.round(Number(text ?? 0) * 100);
export const monthsBetween = (from, to) => { const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number); while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } if (out.length > 240) break; } return out; };
/** The weights of the months of a profile (S-curve: a smooth rise of a cumulative logistic, scaled to 0..1). */
export function profileWeights(profile, n) {
  if (n <= 0) return [];
  const cum = (t) => (profile === 'FRONT' ? 1 - (1 - t) ** 2 : profile === 'BACK' ? t ** 2 : profile === 'SCURVE' ? (1 / (1 + Math.exp(-10 * (t - 0.5))) - 1 / (1 + Math.exp(5))) / (1 / (1 + Math.exp(-5)) - 1 / (1 + Math.exp(5))) : t);
  return Array.from({ length: n }, (_, i) => cum((i + 1) / n) - cum(i / n));
}
/** Splits a total into integer parts by weights so that the parts add up to the total exactly. */
export function splitBy(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1; const out = []; let acc = 0; let given = 0;
  weights.forEach((w, i) => { acc += w; const upto = i === weights.length - 1 ? total : Math.round((total * acc) / sum); out.push(upto - given); given = upto; });
  return out;
}

// Part 12.02: budget changes.
export const CHANGE_DOC = 'BUD_CHANGE';
export const DRAWDOWN_DOC = 'BUD_DRAWDOWN';
export const CHANGE_TYPES = { REVISION: 'Budget revision', TRANSFER: 'Transfer between lines', DRAWDOWN: 'Contingency drawdown', VARIATION: 'Revision from a variation' };
export const REASONS = { VARIATION: 'Variation', SCOPE_CHANGE: 'Scope change', RATE_ESCALATION: 'Rate escalation', RE_ESTIMATE: 'Re-estimate', TRANSFER: 'Transfer between lines', RISK_REALISED: 'Risk realised' };
export const CHANGE_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved (applied)', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
/** BR-02: a revision or transfer above this share of the budget goes to the director as well. */
export const BAND_PCT = 5;
export const signed = (paise) => `${paise < 0 ? '-' : ''}${(Math.abs(paise) / 100).toFixed(2)}`;
/** Neutralises a spreadsheet formula at the start of a cell of an export. */
export const cell = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s; };

// Part 12.03: the budget check and the commitment ledger.
export const CHECK_DOC = 'BUD_CHECK_CONFIG';
export const STAGES = { PR: 'Purchase request', PO: 'Purchase order', WO: 'Work order', OTHER: 'Other commitment' };
export const CHECK_MODES = { OFF: 'Off', WARN: 'Warn', BLOCK: 'Block' };
export const CHECK_RESULTS = { OK: 'Within budget', WARNING: 'Over budget: warning', BLOCK: 'Over budget: blocked' };
export const COMMIT_STATUS = { OPEN: 'Open', PARTIAL: 'Partly consumed', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
export const CONFIG_STATUS = { PENDING: 'Waiting for approval', ACTIVE: 'In force', SUPERSEDED: 'Replaced', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const CONTROL_CODE = 'CP-BUD-01';
/** Event types the ledger listens to (the modules that publish them are built later; the payload is the contract). The stage follows the family. */
export const COMMIT_EVENTS = { 'proc.pr': 'PR', 'proc.po': 'PO', 'proc.hire_order': 'OTHER', 'proc.service_order': 'OTHER', 'ctr.workorder': 'WO' };
export const ACTUAL_EVENTS = ['inv.grn', 'inv.issue', 'ap.bill', 'hr.payroll', 'plant.cost'];
