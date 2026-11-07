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

// Part 10.02: the commercial baseline pack.
export const BASELINE_DOC = 'PROJ_BASELINE';
export const BASELINE_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for sign-off', APPROVED: 'Signed off', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
/** The director signs the baseline of a project above this contract value (₹ 50 crore); the chain itself is configurable in the workflow settings. */
export const DIRECTOR_ABOVE_RUPEES = 500_000_000;

// Part 10.03: the project structure (WBS, work packages, location breakdown). Percentages x 10 000 (100 % = 1 000 000), chainage in metres.
export const WBS_CHANGE_DOC = 'PROJ_WBS_CHANGE';
export const HUNDRED = 1_000_000;
export const MAX_LEVEL = 10;
export const DISCIPLINES = { GENERAL: 'General and preliminaries', CIVIL: 'Civil', STRUCTURAL: 'Structural', ARCHITECTURAL: 'Architectural and finishes', MEP: 'Mechanical, electrical and plumbing', ROADS: 'Roads and pavement', BRIDGES: 'Bridges and structures', WATER: 'Water and pipelines', PLANT: 'Plant and equipment', QUALITY: 'Quality and testing' };
export const WP_TYPES = { SELF: 'Self execution', SUBCONTRACT: 'Subcontract', PROCUREMENT: 'Procurement' };
export const WP_STATUS = { ACTIVE: 'Active', INACTIVE: 'Inactive', CLOSED: 'Closed' };
export const LOC_TYPES = { BLOCK: 'Block', BUILDING: 'Building', FLOOR: 'Floor', ZONE: 'Zone or flat', ROOM: 'Room', CHAINAGE: 'Chainage segment', STRUCTURE: 'Structure' };
/** What may sit under what in the location breakdown ('' = the top level). */
export const LOC_RULES = { '': ['BLOCK', 'BUILDING', 'CHAINAGE', 'STRUCTURE'], BLOCK: ['BUILDING'], BUILDING: ['FLOOR', 'ZONE'], FLOOR: ['ZONE', 'ROOM'], ZONE: ['ZONE', 'ROOM'], ROOM: [], CHAINAGE: ['STRUCTURE', 'ZONE'], STRUCTURE: ['ZONE'] };
export const CHAINAGE_TYPES = ['CHAINAGE', 'STRUCTURE'];
export const VERSION_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
/** FR-02: WBS templates by project type (a company may replace them in the parameter `proj.wbs_templates`); `ca` marks a control account. Weights are shared equally among siblings. */
const n = (name, discipline, children, ca = false) => ({ name, ...(discipline ? { discipline } : {}), ...(children ? { children } : {}), ...(ca ? { ca: true } : {}) });
export const WBS_TEMPLATES = {
  BUILDING: { label: 'Building', tree: [n('Preliminaries and site establishment', 'GENERAL', null, true), n('Substructure', 'CIVIL', [n('Excavation and earthwork'), n('Foundations'), n('Plinth and basement')], true), n('Superstructure', 'STRUCTURAL', [n('RCC frame'), n('Masonry')], true), n('Finishes', 'ARCHITECTURAL', [n('Plaster and paint'), n('Flooring and dado'), n('Doors, windows and glazing')], true), n('MEP services', 'MEP', [n('Electrical'), n('Plumbing and drainage'), n('HVAC and fire fighting')], true), n('External development', 'CIVIL', null, true), n('Testing, commissioning and handover', 'QUALITY', null, true)] },
  ROAD: { label: 'Road', tree: [n('Preliminaries and site establishment', 'GENERAL', null, true), n('Earthwork', 'ROADS', [n('Clearing and grubbing'), n('Excavation'), n('Embankment and subgrade')], true), n('Sub-base and base', 'ROADS', [n('Granular sub-base'), n('Wet mix macadam')], true), n('Bituminous pavement', 'ROADS', [n('Dense bituminous macadam'), n('Bituminous concrete')], true), n('Drainage and cross-drainage', 'CIVIL', [n('Culverts'), n('Side drains')], true), n('Road furniture and safety', 'ROADS', [n('Signs and markings'), n('Crash barriers')], true), n('Testing and handover', 'QUALITY', null, true)] },
  BRIDGE: { label: 'Bridge', tree: [n('Preliminaries and site establishment', 'GENERAL', null, true), n('Foundations', 'BRIDGES', [n('Piling'), n('Pile caps and well foundations')], true), n('Substructure', 'BRIDGES', [n('Piers'), n('Abutments'), n('Pier caps and bearings')], true), n('Superstructure', 'BRIDGES', [n('Girders and deck slab'), n('Expansion joints')], true), n('Approaches and protection', 'CIVIL', [n('Approach embankment'), n('River training and protection')], true), n('Finishing and furniture', 'BRIDGES', [n('Wearing coat'), n('Railings and drainage spouts')], true), n('Load testing and handover', 'QUALITY', null, true)] },
  WATER_PIPELINE: { label: 'Water pipeline', tree: [n('Preliminaries and site establishment', 'GENERAL', null, true), n('Survey and trenching', 'WATER', [n('Survey and marking'), n('Trench excavation'), n('Bedding and backfill')], true), n('Pipe supply and laying', 'WATER', [n('Pipe supply'), n('Laying and jointing'), n('Valves and fittings')], true), n('Chambers and structures', 'CIVIL', [n('Valve chambers'), n('Thrust blocks and crossings')], true), n('Pumping and storage', 'PLANT', [n('Pump house'), n('Storage reservoir')], true), n('Testing, disinfection and commissioning', 'QUALITY', null, true)] },
  INDUSTRIAL_PLANT: { label: 'Industrial plant', tree: [n('Preliminaries and site establishment', 'GENERAL', null, true), n('Civil and foundations', 'CIVIL', [n('Earthwork and piling'), n('Equipment foundations'), n('Plant buildings')], true), n('Structural steel', 'STRUCTURAL', [n('Fabrication'), n('Erection')], true), n('Mechanical equipment', 'PLANT', [n('Equipment erection'), n('Piping')], true), n('Electrical and instrumentation', 'MEP', [n('Power and cabling'), n('Instrumentation and control')], true), n('Insulation, painting and fire protection', 'MEP', null, true), n('Pre-commissioning, commissioning and handover', 'QUALITY', null, true)] },
};
