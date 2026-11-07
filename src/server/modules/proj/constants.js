import { fromUnits, toUnits } from '../../../shared/money.js';

// Shared constants of the project master (part 10.01). Money in paise (x 100), percentages x 10 000, as in the other parts.
export const ACTIVATION_DOC = 'PROJ_ACTIVATION';
export const TRANSITION_DOC = 'PROJ_TRANSITION';
export const CHANGE_DOC = 'PROJ_CHANGE';
export const STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
/** FR-02: the lifecycle states, in order. */
export const STATES = { SETUP: 'Setup', MOBILISATION: 'Mobilisation', EXECUTION: 'Execution', SUSPENDED: 'Suspended', SUBSTANTIALLY_COMPLETE: 'Substantially complete', DLP: 'Defect liability period', CLOSED: 'Closed', ARCHIVED: 'Archived' };
/** What the project of the organisation master shows for each state (02.02). */
export const ORG_STATUS = { SETUP: 'DRAFT', MOBILISATION: 'ACTIVE', EXECUTION: 'ACTIVE', SUSPENDED: 'ON_HOLD', SUBSTANTIALLY_COMPLETE: 'COMPLETED', DLP: 'COMPLETED', CLOSED: 'CLOSED', ARCHIVED: 'CLOSED' };
/** FR-02: the allowed moves; `approval` moves go through the chain (PM, PD, DIR), the others are made by those who hold the right, with their checklist. SETUP to MOBILISATION is the activation (its own approval). */
export const TRANSITIONS = [
  { from: 'MOBILISATION', to: 'EXECUTION', approval: false }, { from: 'EXECUTION', to: 'SUSPENDED', approval: true }, { from: 'SUSPENDED', to: 'EXECUTION', approval: false },
  { from: 'EXECUTION', to: 'SUBSTANTIALLY_COMPLETE', approval: false }, { from: 'SUBSTANTIALLY_COMPLETE', to: 'DLP', approval: false }, { from: 'SUBSTANTIALLY_COMPLETE', to: 'CLOSED', approval: true },
  { from: 'DLP', to: 'CLOSED', approval: true }, { from: 'SUSPENDED', to: 'CLOSED', approval: true }, { from: 'CLOSED', to: 'ARCHIVED', approval: false },
];
export const CONTRACT_TYPES = { ITEM_RATE: 'Item rate', LUMP_SUM: 'Lump sum', EPC: 'EPC', HAM: 'Hybrid annuity (HAM)', COST_PLUS: 'Cost plus' };
export const SECTORS = ['BUILDING', 'ROADS', 'BRIDGES', 'WATER', 'INDUSTRIAL', 'EPC', 'RAIL', 'OTHER'];
export const MILESTONE_STATUS = { PLANNED: 'Planned', ACHIEVED: 'Achieved', WAIVED: 'Waived' };
/** FR-03: the settings of a project and their defaults; a company sets its own defaults in the parameter `proj.settings_defaults`. */
export const SETTINGS_DEFAULTS = { units: 'METRIC', currency: 'INR', calendar: 'STANDARD_6DAY', workingDays: [1, 2, 3, 4, 5, 6], holidaysFrom: 'COMPANY', costCodeTemplate: 'STANDARD', wbsTemplate: 'BUILDING', approvalOverrides: [], enabledModules: ['PLANNING', 'BUDGET', 'PROCUREMENT', 'STORES', 'SITE', 'BILLING', 'HR', 'QHSE'], budgetRequired: true, planningRequired: true };
/** FR-02: the checklist of each move (every item is ticked before the move; the log keeps what was ticked). */
export const CHECKLISTS = {
  ACTIVATE: ['Contract summary and key dates checked against the contract', 'Client, consultant and funding agency are the ones of the contract', 'Sites and their geofences checked', 'Project manager and project director named'],
  'MOBILISATION>EXECUTION': ['Site established and access agreed with the client', 'Approved budget in place', 'Baseline schedule in place', 'Key people mobilised'],
  'EXECUTION>SUSPENDED': ['Written instruction or reason for the suspension recorded', 'Client or consultant informed', 'Site safe and secured', 'Labour and plant demobilisation plan agreed'],
  'SUSPENDED>EXECUTION': ['Written instruction to resume recorded', 'Schedule impact assessed', 'Site, labour and plant ready to restart'],
  'EXECUTION>SUBSTANTIALLY_COMPLETE': ['Completion certificate or taking-over certificate received', 'Punch list agreed with the client', 'Revised completion date recorded if it moved'],
  'SUBSTANTIALLY_COMPLETE>DLP': ['Start of the defect liability period agreed in writing', 'Retention and guarantee position checked', 'Defect liability team named'],
  'SUBSTANTIALLY_COMPLETE>CLOSED': ['All contractual milestones achieved or waived', 'Final account and retention release settled', 'Handover documents and as-built drawings delivered'],
  'DLP>CLOSED': ['Defect liability period ended or waived in writing', 'All defects rectified and accepted', 'Final account and retention release settled', 'Handover documents and as-built drawings delivered'],
  'SUSPENDED>CLOSED': ['Termination or closure instruction recorded', 'Final account position known', 'Handover documents and records secured'],
  'CLOSED>ARCHIVED': ['Records handed to the archive', 'No open transaction on the project'],
};
const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
export const num = (u, kind) => (u == null ? null : trim(fromUnits(u, kind).toFixed()));
export const money = (u) => (u == null ? null : fromUnits(u, 'money').toFixed(2));
export const units = (v, kind) => toUnits(String(v ?? '0'), kind);
export const nowIso = () => new Date().toISOString();
export const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
export const same = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const rid = (v) => parseInt(String(v), 10);
export const keyOf = (from, to) => `${from}>${to}`;
