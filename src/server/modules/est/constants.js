import { fromUnits, toUnits } from '../../../shared/money.js';

// Shared constants of the estimate workspace (part 09.01). Amounts are fixed-point integers as in the rate analysis engine: money x 100, rates x 10 000, quantities x 1 000, percentages x 10 000.
export const ESTIMATE_DOC = 'EST_ESTIMATE';
export const STATUS = { DRAFT: 'Draft', SUBMITTED: 'In approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const OPEN = ['DRAFT', 'SUBMITTED', 'RETURNED'];
export const MODES = { ANALYSIS: 'Rate analysis', MANUAL: 'Manual build-up', RATE: 'Cost rate typed' };
export const COMPONENT_TYPES = { MATERIAL: 'Material', LABOUR: 'Labour', EQUIPMENT: 'Plant and equipment', TRANSPORT: 'Transport', SUBCONTRACT: 'Subcontract', OTHER: 'Other' };
export const INDIRECTS = { SITE_ESTABLISHMENT: 'Site establishment', STAFF: 'Site staff', CAMP: 'Labour camp', TEMPORARY_WORKS: 'Temporary works', INSURANCE: 'Insurance (CAR, WC)', BG_CHARGES: 'Bank guarantee charges', FINANCE_COST: 'Finance cost', MOBILISATION: 'Mobilisation and demobilisation', OTHER: 'Other' };
export const BASES = { LUMP_SUM: 'Lump sum', QTY_RATE: 'Quantity x rate (months, numbers)', PERCENT: 'Percentage of the direct cost' };
const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
/** A stored integer as the decimal text of its kind (trailing zeros dropped); null stays null. */
export const num = (u, kind) => (u == null ? null : trim(fromUnits(u, kind).toFixed()));
/** A money value with its two places. */
export const money = (u) => (u == null ? null : fromUnits(u, 'money').toFixed(2));
export const units = (v, kind) => toUnits(String(v ?? '0'), kind);
export const nowIso = () => new Date().toISOString();
export const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
export const same = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const rid = (v) => parseInt(String(v), 10);
export const wfDoc = (id) => String(id);
