import { LEGACY_ROLE_PERMISSIONS } from './legacy.js';

// The system role templates (part 02.04): the 23 owner roles and the supporting and external roles of docs 06_ROLE_CATALOGUE.md.
// They are seeded as locked system roles (administrators clone them into editable copies). The permissions of the nine roles that
// existed before the engine are exactly their old access plus the new role and assignment permissions below; every other role starts
// with the ability to see the organisation context and grows as modules register permissions and add them to their templates here.

/** What this part adds. Everything else a role holds is from LEGACY_ROLE_PERMISSIONS (see legacy.js). */
export const PERMISSIONS_02_04 = ['iam.role.view', 'iam.role.manage', 'iam.assignment.view', 'iam.assignment.manage'];

/** What part 02.05 adds: segregation of duties, privileged access and access reviews. */
export const PERMISSIONS_02_05 = ['iam.sod.view', 'iam.sod.manage', 'iam.sod.resolve', 'iam.elevation.request', 'iam.elevation.view', 'iam.elevation.revoke', 'iam.review.view', 'iam.review.manage', 'iam.review.decide'];

/** Permissions a role has now that it did not have before the role engine: the legacy comparison counts these as expected, not as gained access. */
export const PERMISSIONS_02_06 = ['core.audit.view', 'core.audit.verify', 'core.security.view'];
export const PERMISSIONS_02_07 = ['core.routes.view', 'core.security.configure', 'iam.user.export'];
export const PERMISSIONS_03_01 = ['ui.styleguide.view'];
export const PERMISSIONS_03_03 = ['ui.view.share'];
export const PERMISSIONS_03_05 = ['ui.nav.manage', 'ui.console.view'];
export const PERMISSIONS_03_07 = ['ui.dashboard.manage'];
export const PERMISSIONS_SINCE_LEGACY = Object.freeze([...PERMISSIONS_02_04, ...PERMISSIONS_02_05, ...PERMISSIONS_02_06, ...PERMISSIONS_02_07, ...PERMISSIONS_03_01, ...PERMISSIONS_03_03, ...PERMISSIONS_03_05, ...PERMISSIONS_03_07]);

/** Permission keys that are privileged: a role holding any of them is a privileged role (its changes need the extra approver). */
export const SENSITIVE_ACTIONS = ['manage', 'configure', 'configure_system', 'redrive', 'replay', 'issue', 'post_soft_closed'];

/** Roles whose assignment needs the director as the last approver (finance approvers and the platform's break-glass role). */
export const DIRECTOR_APPROVED_ROLES = ['CFO', 'ACCMGR', 'FINEX', 'SUPADM'];

export const CONFIDENTIALITY_LEVELS = ['public', 'internal', 'confidential', 'restricted'];

const HO = 'HEAD_OFFICE';
const SITE = 'SITE_OFFICE';
const SUP = 'SUPPORTING';
const EXT = 'EXTERNAL';

/** code, name, category, department, default data scope, main responsibilities, approval authority */
const ROWS = [
  ['SYSADM', 'System Administrator', HO, 'IT and administration', 'Company (configuration only)', 'Users, roles, configuration, workflows, integrations', 'Configuration changes (maker-checker with ITADM); no business approvals'],
  ['ITADM', 'IT Administrator', HO, 'IT and administration', 'Company (technical)', 'Devices, backups, integrations health, security events', 'Technical changes; no business data access by default'],
  ['DIR', 'Director', HO, 'Management', 'All companies / company', 'Strategic decisions, final approvals above limits', 'Highest band on all financial documents'],
  ['CFO', 'Chief Financial Officer', HO, 'Finance', 'Company', 'Finance, treasury, payments, tax, close', 'Payments, budgets, journals above Accounts Manager limit'],
  ['ACCMGR', 'Accounts Manager', HO, 'Finance', 'Company / branch', 'Ledgers, AP/AR, bank, GST/TDS, close tasks', 'Journals, vendor bills, payment proposals within band'],
  ['PROCMGR', 'Procurement & Stores Manager', HO, 'Procurement', 'Company', 'Procurement policy, vendors, POs, central stores', 'PRs/POs within band, comparative statement approval, vendor approval'],
  ['COMMGR', 'Commercial Manager', HO, 'Commercial', 'Company / assigned projects', 'Contracts, variations, claims, billing, CVR', 'Client bills, subcontract work orders and bills, variations within band'],
  ['HRMGR', 'HR & Administration Manager', HO, 'Human resources', 'Company', 'Employees, recruitment, attendance policy, payroll inputs', 'Leave (escalated), regularisation, offers, full and final, HR letters'],
  ['QCMGR', 'Quality Control Manager', HO, 'Quality', 'Company', 'QMS, ITPs, NCR closure policy, lab', 'NCR closure (major), ITP approval, material approval'],
  ['PCMGR', 'Project Controls Manager', HO, 'Project controls', 'Company / assigned projects', 'Budgets, schedules, EVM, forecasts, MIS', 'Budget revisions (recommend), baseline approval, forecast publish'],
  ['PD', 'Project Director', SITE, 'Projects', 'Assigned projects', 'Overall delivery of a group of projects', 'High band on project documents'],
  ['PM', 'Project Manager', SITE, 'Projects', 'Assigned project', 'Project delivery, approvals at project level', 'Mid band PR/PO/WO, DPR approval, work-area approval, measurement book verification'],
  ['CM', 'Construction Manager', SITE, 'Projects', 'Assigned project / sites', 'Execution, work fronts, resources', 'Work-area approval, DPR review, material requests'],
  ['SE', 'Site Engineer', SITE, 'Projects', 'Assigned sites', 'DPR, measurements, material requests, RFIs', 'Raises; approves nothing above own work'],
  ['CSUP', 'Civil Supervisor', SITE, 'Projects', 'Assigned sites / work fronts', 'Daily execution, crew instructions', 'Labour attendance confirmation for own crew'],
  ['WSUP', 'Workforce Supervisor', SITE, 'Projects', 'Assigned crews', 'Crew attendance, deployment, labour issues', 'Crew attendance verification, first-level regularisation'],
  ['PMSUP', 'Plant & Machinery Supervisor', SITE, 'Plant and machinery', 'Assigned sites / equipment', 'Equipment allocation, log books, fuel, maintenance', 'Log book verification, fuel issue approval within band'],
  ['SK', 'Storekeeper', SITE, 'Stores', 'Assigned stores', 'GRN, issues, returns, transfers, stock counts', 'Confirms receipts and issues; no financial approval'],
  ['PROCIC', 'Procurement In-charge (site)', SITE, 'Procurement', 'Assigned project', 'Local purchases, RFQs, follow-ups', 'Local purchase within small band'],
  ['SACC', 'Site Accountant', SITE, 'Finance', 'Assigned project', 'Site cash, imprest, vendor bill intake, payroll inputs', 'Imprest vouchers within band, bill verification'],
  ['QCE', 'Quality Control Engineer', SITE, 'Quality', 'Assigned sites', 'Inspections, tests, NCRs', 'Inspection acceptance, minor NCR closure'],
  ['HSEE', 'HSE Engineer', SITE, 'Health, safety and environment', 'Assigned sites', 'Permits, inspections, incidents, toolbox talks', 'Permit-to-work issue, HSE observation closure'],
  ['SUBCO', 'Subcontractor Coordinator', SITE, 'Projects', 'Assigned project', 'Subcontractor compliance, labour strength, bills intake', 'Verifies subcontractor measurements at first level'],
  ['SUPADM', 'Super Admin', SUP, 'Platform', 'Platform', 'Break-glass administration; every action audited and maker-checked', 'None; assignment needs the system administrator and the director'],
  ['AUD', 'Internal Auditor', SUP, 'Audit', 'Company (read-only)', 'Read-only access to records, audit trail, reports', 'None'],
  ['BD', 'Business Development Executive', SUP, 'Business development', 'Company', 'Leads, opportunities, client relations', 'None'],
  ['EST', 'Estimation & Tender Manager', SUP, 'Estimation', 'Company', 'Tenders, estimates, rate analysis', 'None'],
  ['QS', 'Quantity Surveyor / Billing Engineer', SUP, 'Commercial', 'Assigned projects', 'Measurement, BOQ reconciliation, RA bills, subcontract bills', 'None'],
  ['PLAN', 'Planning Engineer', SUP, 'Project controls', 'Assigned projects', 'Schedules, look-ahead, progress, delay records', 'None'],
  ['DOC', 'Document Controller', SUP, 'Projects', 'Assigned projects', 'Drawing register, transmittals, correspondence', 'None'],
  ['DESIGN', 'Design Coordinator', SUP, 'Projects', 'Assigned projects', 'RFIs, submittals, engineering deliverables', 'None'],
  ['FINEX', 'Accounts Executive', SUP, 'Finance', 'Company / branch', 'Voucher entry, reconciliations, AP/AR processing', 'None'],
  ['PAY', 'Payroll Officer', SUP, 'Human resources', 'Company', 'Payroll processing, statutory returns', 'None'],
  ['HSEO', 'HSE Officer', SUP, 'Health, safety and environment', 'Assigned sites', 'HSE inspections, inductions, PPE', 'None'],
  ['SECMGR', 'Security Manager', SUP, 'Security', 'Company', 'Guard deployment, gate, visitors, patrols', 'None'],
  ['SECSUP', 'Security Supervisor', SUP, 'Security', 'Site', 'Guard deployment, gate, visitors, patrols', 'None'],
  ['GUARD', 'Security Guard', SUP, 'Security', 'Post', 'Gate, visitors, patrols', 'None'],
  ['PLANTMGR', 'Plant & Equipment Manager (HO)', SUP, 'Plant and machinery', 'Company', 'Fleet, hiring, maintenance policy', 'None'],
  ['STOREMGR', 'Store Manager (central warehouse)', SUP, 'Stores', 'Assigned warehouses', 'Central stores operations', 'None'],
  ['EMP', 'Employee (self-service)', SUP, 'All', 'Own records', 'Attendance, leave, payslips, claims, tasks, messages', 'None'],
  ['X-SUP', 'Supplier user', EXT, 'Portal', "Own company's RFQs, quotations, POs, deliveries, invoices, payments", 'Supplier portal', 'None'],
  ['X-SUB', 'Subcontractor user', EXT, 'Portal', 'Own work orders, measurements, bills, compliance, labour', 'Subcontractor portal', 'None'],
  ['X-CLI', 'Client representative', EXT, 'Portal', 'Own projects: progress, bills for certification, approvals, shared documents', 'Client portal', 'None'],
  ['X-CON', 'Consultant / Engineer', EXT, 'Portal', 'Assigned projects: RFIs, submittals, inspections, drawings, bill verification', 'Consultant portal', 'None'],
];

/** What each role may read at most: a record marked above this is refused to the role (FR-09). */
const CLEARANCE = {
  DIR: 'restricted', SUPADM: 'restricted', AUD: 'restricted',
  CFO: 'confidential', ACCMGR: 'confidential', PROCMGR: 'confidential', COMMGR: 'confidential', HRMGR: 'confidential', PCMGR: 'confidential', PD: 'confidential', PM: 'confidential', QCMGR: 'confidential', PAY: 'confidential', FINEX: 'confidential',
  'X-SUP': 'public', 'X-SUB': 'public', 'X-CLI': 'public', 'X-CON': 'public',
};

const ADDED = {
  SYSADM: ['iam.role.view', 'iam.role.manage', 'iam.assignment.view', 'iam.assignment.manage'],
  ITADM: ['iam.role.view', 'iam.assignment.view'],
  DIR: ['iam.role.view', 'iam.assignment.view'],
  AUD: ['iam.role.view', 'iam.assignment.view'],
};
// The auditor reads what administrators and approvers can read, and changes nothing.
const AUDITOR_READS = ['org.view', 'iam.user.view', 'iam.security.view', 'core.requests.view', 'core.about.view', 'core.integrity.view', 'core.events.view', 'core.jobs.view', 'core.schedule.view', 'core.ops.view', 'core.connectors.view', 'core.calc.view', 'core.param.view', 'core.settings.view', 'core.fy.view', 'core.numbering.view', 'core.flag.view'];

const unique = (list) => [...new Set(list)].sort();

// Part 02.05. Rules are maintained by the system administrator and checked by the auditor or the director; anyone inside the company may ask
// for elevated access for themselves; department heads and other managers certify the access of their people in a review.
const ADDED_02_05 = {
  SYSADM: ['iam.sod.view', 'iam.sod.manage', 'iam.elevation.view', 'iam.elevation.revoke', 'iam.review.view', 'iam.review.manage', 'core.security.view', 'core.routes.view', 'iam.user.export', 'ui.styleguide.view', 'ui.nav.manage', 'ui.console.view', 'ui.dashboard.manage'],
  ITADM: ['iam.sod.view', 'iam.elevation.view', 'iam.elevation.revoke', 'core.security.view', 'core.routes.view', 'core.security.configure', 'iam.user.export', 'ui.console.view'],
  DIR: ['iam.sod.view', 'iam.sod.resolve', 'iam.elevation.view', 'iam.review.view', 'iam.review.manage'],
  AUD: ['iam.sod.view', 'iam.sod.resolve', 'iam.elevation.view', 'iam.review.view', 'iam.review.manage', 'core.audit.view', 'core.audit.verify', 'core.security.view', 'core.routes.view'],
  HRMGR: ['iam.user.export'],
  PCMGR: ['ui.dashboard.manage'], // part 03.07: the project controls manager sets the default dashboards of roles
};
// Part 03.03. Managers may share saved list views with a role or a project; everyone keeps personal views.
const SHARES_VIEWS = new Set(['SYSADM', 'PM', 'PD', 'PCMGR', 'ACCMGR', 'CFO', 'HRMGR', 'DIR']);
const internalRole = (code, category) => category !== EXT && code !== 'EMP' && code !== 'GUARD';

function permissionsOfTemplate(code, category) {
  const extra = [...(ADDED_02_05[code] ?? []), ...(SHARES_VIEWS.has(code) ? PERMISSIONS_03_03 : []), ...(internalRole(code, category) ? ['iam.elevation.request'] : []), ...((category === HO || category === SITE || code === 'SUPADM') ? ['iam.review.decide'] : [])];
  if (code === 'SUPADM') return unique([...LEGACY_ROLE_PERMISSIONS.SYSADM, ...LEGACY_ROLE_PERMISSIONS.ITADM, ...PERMISSIONS_02_04, ...PERMISSIONS_02_05, ...PERMISSIONS_02_06, ...PERMISSIONS_02_07, ...PERMISSIONS_03_01, ...PERMISSIONS_03_03, ...PERMISSIONS_03_05, ...PERMISSIONS_03_07]);
  if (code === 'AUD') return unique([...AUDITOR_READS, ...ADDED.AUD, ...extra]);
  if (LEGACY_ROLE_PERMISSIONS[code]) return unique([...LEGACY_ROLE_PERMISSIONS[code], ...(ADDED[code] ?? []), ...extra]);
  if (category === EXT || code === 'EMP') return [];
  return unique(['org.view', ...extra]);
}

export const ROLE_TEMPLATES = Object.freeze(
  ROWS.map(([code, name, category, department, scope, responsibilities, authority]) =>
    Object.freeze({ code, name, category, department, scope, responsibilities, authority, clearance: CLEARANCE[code] ?? 'internal', owner: category === HO || category === SITE, permissions: Object.freeze(permissionsOfTemplate(code, category)) }),
  ),
);

/** code -> permissions, for an actor that carries no computed grants. */
export const TEMPLATE_PERMISSIONS = Object.freeze(Object.fromEntries(ROLE_TEMPLATES.map((t) => [t.code, t.permissions])));

/** Field masks the system roles carry by default: who sees a sensitive field in full (everyone else sees the field's own default rule). */
export const TEMPLATE_FIELD_MASKS = Object.freeze([
  { entity: 'iam_user', field: 'mobile', roles: ['SYSADM', 'HRMGR', 'SUPADM'], rule: 'show' },
  { entity: 'org_company', field: 'pan', roles: ['SYSADM', 'SUPADM'], rule: 'show' },
  // part 03.03: commercial values of the reference register are for the commercial roles; a system administrator sees them masked
  { entity: 'ui_sample_request', field: 'total', roles: ['PM', 'PD', 'PCMGR', 'ACCMGR', 'CFO', 'DIR', 'SUPADM'], rule: 'show' },
]);
