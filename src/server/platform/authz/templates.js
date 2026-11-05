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
export const PERMISSIONS_03_08 = ['ui.search.reindex', 'ui.search.analytics'];
export const PERMISSIONS_03_09 = ['ui.translation.manage'];
export const PERMISSIONS_03_10 = ['ui.migration.view', 'ui.migration.signoff'];
export const PERMISSIONS_04_01 = ['eng.workflow.view', 'eng.workflow.define', 'eng.workflow.cancel', 'eng.workflow.admin', 'eng.sample.use'];
export const PERMISSIONS_04_02 = ['eng.matrix.view', 'eng.matrix.manage', 'eng.delegation.use', 'eng.delegation.admin'];
export const PERMISSIONS_04_04 = ['eng.pcs.view', 'eng.pcs.manage', 'eng.pcs.raise', 'eng.pcs.emergency'];
export const PERMISSIONS_04_05 = ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'];
export const PERMISSIONS_04_06 = ['ntf.template.view', 'ntf.template.edit', 'ntf.delivery.view', 'ntf.delivery.retry'];
export const PERMISSIONS_04_07 = ['comm.channel.view', 'comm.channel.edit', 'comm.log.view', 'comm.consent.view', 'comm.consent.edit'];
export const PERMISSIONS_04_10 = ['doc.document.view', 'doc.document.view_confidential', 'doc.document.view_restricted', 'doc.document.create', 'doc.document.manage', 'doc.config.view', 'doc.config.edit'];
export const PERMISSIONS_04_11 = ['tpl.template.view', 'tpl.template.edit', 'tpl.rule.edit', 'tpl.record.publish', 'tpl.document.view', 'tpl.document.generate', 'tpl.document.generate_sensitive', 'tpl.document.deliver'];
export const PERMISSIONS_04_12 = ['sig.register.view', 'sig.signature.revoke', 'sig.document.view', 'sig.document.sign', 'sig.document.cancel', 'sig.config.view', 'sig.config.edit'];
export const PERMISSIONS_05_05 = ['pol.policy.create', 'pol.policy.view_all', 'pol.requirement.manage', 'pol.draft.view'];
export const PERMISSIONS_06_02 = ['mdm.uom.edit', 'mdm.tax.edit', 'mdm.finance.edit', 'mdm.lookup.edit'];
export const PERMISSIONS_06_01 = ['mdm.record.view', 'mdm.record.edit', 'mdm.record.import', 'mdm.sensitive.view', 'mdm.governance.view', 'mdm.config.edit'];
export const PERMISSIONS_05_04 = ['msg.instruction.send', 'msg.announcement.send', 'msg.comm.view_all', 'msg.autogroup.view', 'msg.autogroup.edit'];
export const PERMISSIONS_05_03 = ['sec.policy.view', 'sec.policy.edit', 'sec.device.manage', 'sec.licence.view', 'sec.licence.edit'];
export const PERMISSIONS_05_01 = ['msg.channel.manage', 'msg.admin.view', 'msg.compliance.export', 'msg.settings.view', 'msg.settings.edit', 'msg.legal_hold.manage'];
export const PERMISSIONS_04_15 = ['off.device.manage', 'off.sync.confirm', 'off.sync.view_all'];
export const PERMISSIONS_04_14 = ['col.comment.moderate', 'col.trace.link', 'col.activity.view'];
export const PERMISSIONS_04_13 = ['xl.import.use', 'xl.template.view', 'xl.template.edit', 'xl.job.view_all', 'org.designation.import', 'eng.sample.import'];
export const PERMISSIONS_04_09 = ['alr.rule.view', 'alr.rule.edit', 'alr.alert.view', 'alr.alert.manage'];
export const PERMISSIONS_04_08 = ['tsk.team.view', 'tsk.task.assign', 'tsk.instruction.create', 'tsk.routing.view', 'tsk.routing.edit'];
export const PERMISSIONS_SINCE_LEGACY = Object.freeze([...PERMISSIONS_02_04, ...PERMISSIONS_02_05, ...PERMISSIONS_02_06, ...PERMISSIONS_02_07, ...PERMISSIONS_03_01, ...PERMISSIONS_03_03, ...PERMISSIONS_03_05, ...PERMISSIONS_03_07, ...PERMISSIONS_03_08, ...PERMISSIONS_03_09, ...PERMISSIONS_03_10, ...PERMISSIONS_04_01, ...PERMISSIONS_04_02, ...PERMISSIONS_04_04, ...PERMISSIONS_04_05, ...PERMISSIONS_04_06, ...PERMISSIONS_04_07, ...PERMISSIONS_04_08, ...PERMISSIONS_04_09, ...PERMISSIONS_04_10, ...PERMISSIONS_04_11, ...PERMISSIONS_04_12, ...PERMISSIONS_04_13, ...PERMISSIONS_04_14, ...PERMISSIONS_04_15, ...PERMISSIONS_05_01, ...PERMISSIONS_05_03, ...PERMISSIONS_05_04, ...PERMISSIONS_05_05, ...PERMISSIONS_06_01, ...PERMISSIONS_06_02]);

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
  SYSADM: ['iam.sod.view', 'iam.sod.manage', 'iam.elevation.view', 'iam.elevation.revoke', 'iam.review.view', 'iam.review.manage', 'core.security.view', 'core.routes.view', 'iam.user.export', 'ui.styleguide.view', 'ui.nav.manage', 'ui.console.view', 'ui.dashboard.manage', 'ui.search.analytics', 'ui.translation.manage', 'ui.migration.view', 'ui.migration.signoff'],
  ITADM: ['iam.sod.view', 'iam.elevation.view', 'iam.elevation.revoke', 'core.security.view', 'core.routes.view', 'core.security.configure', 'iam.user.export', 'ui.console.view', 'ui.search.reindex', 'ui.search.analytics', 'ui.migration.view', 'ui.migration.signoff'], // part 03.08: the IT administrator rebuilds the search index and reads its analytics
  DIR: ['iam.sod.view', 'iam.sod.resolve', 'iam.elevation.view', 'iam.review.view', 'iam.review.manage'],
  AUD: ['iam.sod.view', 'iam.sod.resolve', 'iam.elevation.view', 'iam.review.view', 'iam.review.manage', 'core.audit.view', 'core.audit.verify', 'core.security.view', 'core.routes.view'],
  HRMGR: ['iam.user.export'],
  PCMGR: ['ui.dashboard.manage', 'ui.migration.view', 'ui.migration.signoff'], // part 03.07: the project controls manager sets the default dashboards of roles
};
// Part 04.02. The system administrator maintains the matrix, limits, escalation and SLA settings (the maker; the chain of the change is CFO or the process owner,
// then the director for large limits); the roles that approve or audit read them and run the simulator; everyone inside the company delegates their own approvals.
const ADDED_04_02 = {
  SYSADM: ['eng.matrix.view', 'eng.matrix.manage', 'eng.delegation.admin'],
  ITADM: ['eng.matrix.view', 'eng.delegation.admin'],
  DIR: ['eng.matrix.view'], CFO: ['eng.matrix.view'], AUD: ['eng.matrix.view'], ACCMGR: ['eng.matrix.view'], PROCMGR: ['eng.matrix.view'], PCMGR: ['eng.matrix.view'], HRMGR: ['eng.matrix.view', 'eng.delegation.admin'],
};
// Part 04.07. The IT administrator sets up the channels (a change is approved by the system administrator or a director); the system administrator, the auditor and the IT administrator read
// the communication log; those who deal with vendors, clients and staff keep the consent of the contacts they write to.
// Part 04.08. Everyone has their own tasks and may give themselves tasks; seniors give tasks to others and raise instructions; managers see the tasks of their team within their projects; the
// department heads (HR manager) and the system administrator keep the responsibility matrix, and a change of it is approved by the system administrator or a director.
const SENIORS_04_08 = ['tsk.team.view', 'tsk.task.assign', 'tsk.instruction.create'];
const ADDED_04_08 = {
  DIR: [...SENIORS_04_08, 'tsk.routing.view'], PD: SENIORS_04_08, PM: SENIORS_04_08, CFO: SENIORS_04_08, PROCMGR: SENIORS_04_08, COMMGR: SENIORS_04_08, HRMGR: [...SENIORS_04_08, 'tsk.routing.view', 'tsk.routing.edit'],
  SYSADM: ['tsk.team.view', 'tsk.routing.view', 'tsk.routing.edit'], ITADM: ['tsk.routing.view'], AUD: ['tsk.team.view', 'tsk.routing.view'],
};
// Part 04.09. The system administrator and the process owners keep the rules (one that sends messages outside is approved by the process owner and the system administrator); everybody has their own
// alerts; those who manage a project see and settle the alerts of it.
const OWNERS_04_09 = ['alr.rule.view', 'alr.rule.edit', 'alr.alert.view', 'alr.alert.manage'];
// Part 04.10. Everyone inside the company sees the documents of their projects, up to the level of confidentiality their role is trusted with; the authors add and revise; the document controller (DOC)
// keeps the register, the folders and the types; the system administrator keeps the configuration (a change is approved by the system administrator or a director).
const VIEW_04_10 = ['doc.document.view'];
const AUTHOR_04_10 = ['doc.document.view', 'doc.document.create'];
const SENIOR_04_10 = ['doc.document.view', 'doc.document.create', 'doc.document.view_confidential'];
const ADDED_04_10 = {
  DOC: ['doc.document.view', 'doc.document.view_confidential', 'doc.document.view_restricted', 'doc.document.create', 'doc.document.manage', 'doc.config.view', 'doc.config.edit'],
  DIR: ['doc.document.view', 'doc.document.view_confidential', 'doc.document.view_restricted', 'doc.config.view'], PD: [...SENIOR_04_10, 'doc.document.view_restricted'], PM: [...SENIOR_04_10, 'doc.config.view'], QCMGR: [...SENIOR_04_10, 'doc.config.view'],
  CFO: SENIOR_04_10, COMMGR: SENIOR_04_10, HRMGR: SENIOR_04_10, PCMGR: SENIOR_04_10, CM: SENIOR_04_10, PROCMGR: AUTHOR_04_10, ACCMGR: VIEW_04_10, FINEX: VIEW_04_10,
  SE: AUTHOR_04_10, QCE: AUTHOR_04_10, DESIGN: AUTHOR_04_10, PLAN: AUTHOR_04_10, QS: AUTHOR_04_10, EST: AUTHOR_04_10, BD: VIEW_04_10, HSEE: AUTHOR_04_10, HSEO: AUTHOR_04_10, CSUP: VIEW_04_10, WSUP: VIEW_04_10, PMSUP: VIEW_04_10,
  PROCIC: VIEW_04_10, SACC: VIEW_04_10, PLANTMGR: VIEW_04_10, STOREMGR: VIEW_04_10, AUD: ['doc.document.view', 'doc.document.view_confidential', 'doc.config.view'], SYSADM: ['doc.config.view', 'doc.config.edit'], ITADM: ['doc.config.view'],
};
// Part 04.11. The system administrator keeps the templates (the maker; a change is approved by the process owner of the document type) and the records published to the generator; the process owners see the
// templates they approve; whoever may print a document type generates and delivers it (a payslip or an offer letter needs the extra right of the HR manager and the director).
const PRINT_04_11 = ['tpl.document.view', 'tpl.document.generate', 'tpl.document.deliver'];
const OWNER_04_11 = ['tpl.template.view', 'tpl.document.view'];
const ADDED_04_11 = {
  SYSADM: ['tpl.template.view', 'tpl.template.edit', 'tpl.rule.edit', 'tpl.record.publish', 'tpl.document.view'], ITADM: ['tpl.template.view', 'tpl.document.view'], AUD: ['tpl.template.view', 'tpl.document.view'],
  DIR: [...OWNER_04_11, 'tpl.document.generate_sensitive'], CFO: [...OWNER_04_11, ...PRINT_04_11], PROCMGR: [...OWNER_04_11, ...PRINT_04_11], COMMGR: [...OWNER_04_11, ...PRINT_04_11], HRMGR: [...OWNER_04_11, ...PRINT_04_11, 'tpl.document.generate_sensitive'],
  PM: [...OWNER_04_11, ...PRINT_04_11], PD: PRINT_04_11, QCMGR: [...OWNER_04_11, ...PRINT_04_11], STOREMGR: [...OWNER_04_11, ...PRINT_04_11], HSEO: [...OWNER_04_11, ...PRINT_04_11], DOC: [...OWNER_04_11, ...PRINT_04_11],
  PCMGR: PRINT_04_11, ACCMGR: PRINT_04_11, FINEX: PRINT_04_11, SACC: PRINT_04_11, PROCIC: PRINT_04_11, CM: PRINT_04_11, QS: PRINT_04_11, SE: PRINT_04_11, QCE: PRINT_04_11, HSEE: PRINT_04_11, PLAN: PRINT_04_11,
};
// Part 04.12. The auditor and the system administrator keep the register (the administrator also revokes and changes the settings); whoever may see a generated document sees its signatures; whoever may print one
// signs it; the process owners and the document controller cancel a document.
const SEE_04_12 = ['sig.document.view'];
const SIGN_04_12 = ['sig.document.view', 'sig.document.sign'];
const OWN_04_12 = [...SIGN_04_12, 'sig.document.cancel'];
const ADDED_04_12 = {
  SYSADM: ['sig.register.view', 'sig.signature.revoke', 'sig.document.view', 'sig.document.cancel', 'sig.config.view', 'sig.config.edit'], ITADM: ['sig.register.view', 'sig.config.view'], AUD: ['sig.register.view', 'sig.document.view', 'sig.config.view'],
  DIR: [...SEE_04_12, 'sig.document.cancel'], CFO: OWN_04_12, PROCMGR: OWN_04_12, COMMGR: OWN_04_12, HRMGR: OWN_04_12, PM: OWN_04_12, DOC: OWN_04_12, PD: SIGN_04_12, QCMGR: OWN_04_12, STOREMGR: SIGN_04_12, HSEO: SIGN_04_12,
  PCMGR: SIGN_04_12, ACCMGR: SIGN_04_12, FINEX: SIGN_04_12, SACC: SIGN_04_12, PROCIC: SIGN_04_12, CM: SIGN_04_12, QS: SIGN_04_12, SE: SIGN_04_12, QCE: SIGN_04_12, HSEE: SIGN_04_12, PLAN: SIGN_04_12,
};
// Part 04.13. Anybody who may import something may open the Import Center; each import has its own right (<module>.<entity>.import) and the module's service still checks the right to create the record. The
// system administrator keeps the templates (a change is approved by a second person) and, with the auditor, sees every job.
const SAMPLE_04_13 = ['xl.import.use', 'eng.sample.import'];
const ADDED_04_13 = {
  SYSADM: ['xl.import.use', 'xl.template.view', 'xl.template.edit', 'xl.job.view_all', 'org.designation.import'], ITADM: ['xl.import.use', 'xl.template.view', 'xl.job.view_all'], AUD: ['xl.import.use', 'xl.template.view', 'xl.job.view_all'], DIR: ['xl.template.view'],
  HRMGR: ['xl.import.use', 'org.designation.import'], PD: SAMPLE_04_13, PM: SAMPLE_04_13, ACCMGR: SAMPLE_04_13, CFO: SAMPLE_04_13, PROCMGR: SAMPLE_04_13,
};
// Part 04.14. Whoever may open a record may comment on it, read its timeline and trace; a moderator (the system administrator, directors and project managers, in their scope) may delete another person's comment with a reason;
// the people who run a project or watch the business read the project activity feed; a trace link is added by hand only by those who run projects and finance, with a reason.
const ADDED_04_14 = {
  SYSADM: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'], DIR: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'], PD: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'], PM: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'],
  CFO: ['col.trace.link', 'col.activity.view'], AUD: ['col.activity.view'], PROCMGR: ['col.activity.view'], COMMGR: ['col.activity.view'], ACCMGR: ['col.activity.view'],
};
// Part 04.15. Field users use their own device without a permission (each command is checked against the right of its form); the IT administrator manages every device; the people who run a project confirm
// offline work that is older than the configured age; the auditor reads the whole sync log.
const ADDED_04_15 = {
  SYSADM: ['off.device.manage', 'off.sync.view_all'], ITADM: ['off.device.manage', 'off.sync.view_all'], AUD: ['off.sync.view_all'], DIR: ['off.sync.confirm'], PD: ['off.sync.confirm'], PM: ['off.sync.confirm'],
};
// Part 05.01. Every internal person writes direct and group messages with no permission (membership decides what they see); the people who run a project, a site or a department make its channel; the system
// administrator and the IT administrator see the migration check; the auditor exports a conversation for compliance.
const ADDED_05_01 = {
  SYSADM: ['msg.channel.manage', 'msg.admin.view', 'msg.settings.view', 'msg.settings.edit'], ITADM: ['msg.admin.view', 'msg.settings.view'], AUD: ['msg.admin.view', 'msg.compliance.export', 'msg.settings.view', 'msg.legal_hold.manage'], DIR: ['msg.channel.manage', 'msg.legal_hold.manage'], PD: ['msg.channel.manage'], PM: ['msg.channel.manage'], HRMGR: ['msg.channel.manage'],
};
// Part 05.03. Secure conversations themselves need no permission key (the policy names the roles that may start one); the system administrator keeps the policy and the licence register and sends the review,
// the IT administrator revokes lost devices and approves the licence review first, the director approves it last, the auditor reads both.
const ADDED_05_03 = {
  SYSADM: ['sec.policy.view', 'sec.policy.edit', 'sec.device.manage', 'sec.licence.view', 'sec.licence.edit'], ITADM: ['sec.policy.view', 'sec.device.manage', 'sec.licence.view'], AUD: ['sec.policy.view', 'sec.licence.view'], DIR: ['sec.policy.view', 'sec.licence.view'],
};
// Part 05.04. Project and department heads (PM, PD, DIR, HODs) send instructions and announcements within their scope; everybody acknowledges what is sent to them (no permission needed); the auditor, system administrator and
// director see every register; the system administrator keeps the auto group rules and the IT administrator or director approve them.
const SENDERS_05_04 = ['msg.instruction.send', 'msg.announcement.send'];
const ADDED_05_04 = {
  SYSADM: ['msg.comm.view_all', 'msg.autogroup.view', 'msg.autogroup.edit'], ITADM: ['msg.autogroup.view'], AUD: ['msg.comm.view_all', 'msg.autogroup.view'], DIR: [...SENDERS_05_04, 'msg.comm.view_all', 'msg.autogroup.view'], PD: [...SENDERS_05_04, 'msg.comm.view_all'], PM: SENDERS_05_04,
  HRMGR: SENDERS_05_04, CFO: SENDERS_05_04, PROCMGR: SENDERS_05_04, COMMGR: SENDERS_05_04, ACCMGR: SENDERS_05_04, PCMGR: SENDERS_05_04,
};
// Part 05.05. The owners of policies (HR, finance, quality, procurement, HSE, accounts, commercial, project controls) write them and tag their requirements; the director, the auditor and the system administrator see the whole
// register; the administrators (system, IT) and the director see the drafts made from policies, which they activate on the screen of the engine that owns them. Everyone reads and acknowledges what applies to them (no permission).
const AUTHORS_05_05 = ['pol.policy.create', 'pol.policy.view_all', 'pol.requirement.manage'];
const ADDED_05_05 = {
  HRMGR: AUTHORS_05_05, CFO: AUTHORS_05_05, QCMGR: AUTHORS_05_05, PROCMGR: AUTHORS_05_05, HSEE: AUTHORS_05_05, ACCMGR: AUTHORS_05_05, COMMGR: AUTHORS_05_05, PCMGR: AUTHORS_05_05,
  DIR: ['pol.policy.view_all', 'pol.draft.view'], AUD: ['pol.policy.view_all'], SYSADM: ['pol.policy.view_all', 'pol.draft.view'], ITADM: ['pol.draft.view'],
};
// Part 06.01. Everyone in the company (internal roles) sees the governed masters and may ask for a new record or a change (it goes to the stewards). The masters' owners (procurement, commercial, accounts, finance) may edit
// them directly where a field is not sensitive, merge duplicates and import; the accounts and finance heads, the auditor and the director see the sensitive fields (PAN, GSTIN, bank). The administrators and the heads see
// the governance pages; the system administrator proposes the quality rules and the stewards (approved by the IT administrator or the director). A steward is named per master, not by a role.
const EDITORS_06_01 = ['mdm.record.edit', 'mdm.record.import', 'mdm.governance.view'];
const ADDED_06_01 = {
  PROCMGR: EDITORS_06_01, COMMGR: EDITORS_06_01, ACCMGR: [...EDITORS_06_01, 'mdm.sensitive.view'], CFO: [...EDITORS_06_01, 'mdm.sensitive.view'],
  DIR: ['mdm.governance.view', 'mdm.sensitive.view'], AUD: ['mdm.governance.view', 'mdm.sensitive.view'], SYSADM: ['mdm.governance.view', 'mdm.config.edit'], ITADM: ['mdm.governance.view'],
};
// Part 06.02. Everyone reads the common masters (mdm.record.view of 06.01). Their stewards keep them: the accounts manager the taxes (a change approved by another accounts manager and the CFO), banks, payment terms,
// states, currencies and rates; the procurement manager the units of measure; the system administrator the lookup lists.
const ADDED_06_02 = { ACCMGR: ['mdm.tax.edit', 'mdm.finance.edit'], PROCMGR: ['mdm.uom.edit'], SYSADM: ['mdm.lookup.edit'] };
const ADDED_04_09 = {
  SYSADM: OWNERS_04_09, ITADM: ['alr.rule.view', 'alr.alert.view'], AUD: ['alr.rule.view', 'alr.alert.view'], DIR: OWNERS_04_09, PD: OWNERS_04_09, PM: OWNERS_04_09, CFO: OWNERS_04_09, PROCMGR: OWNERS_04_09, COMMGR: OWNERS_04_09, HRMGR: OWNERS_04_09,
};
const ADDED_04_07 = {
  ITADM: ['comm.channel.view', 'comm.channel.edit', 'comm.log.view', 'comm.consent.view', 'comm.consent.edit'],
  SYSADM: ['comm.channel.view', 'comm.log.view', 'comm.consent.view', 'comm.consent.edit'],
  AUD: ['comm.channel.view', 'comm.log.view', 'comm.consent.view'], DIR: ['comm.consent.view'],
  PROCMGR: ['comm.consent.view', 'comm.consent.edit'], COMMGR: ['comm.consent.view', 'comm.consent.edit'], HRMGR: ['comm.consent.view', 'comm.consent.edit'],
};
// Part 04.06. The system administrator writes the templates of notifications (a new version is approved by the IT administrator); the IT administrator reads the templates and the
// delivery log and may retry a failed delivery; everyone has their own notifications and preferences without a permission.
const ADDED_04_06 = { SYSADM: ['ntf.template.view', 'ntf.template.edit'], ITADM: ['ntf.template.view', 'ntf.delivery.view', 'ntf.delivery.retry'], AUD: ['ntf.delivery.view'] };
// Part 04.05. Project managers and directors, the HR manager and the system administrator keep the RACI of the scopes they hold (a change of a live project is approved by the
// project manager and then the project director); the people who watch the business read the ledger and the report; everyone has their own view without a permission.
const ADDED_04_05 = {
  SYSADM: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'],
  PD: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'], PM: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'],
  HRMGR: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'],
  DIR: ['acc.raci.view', 'acc.ledger.view', 'acc.report.view'], AUD: ['acc.raci.view', 'acc.ledger.view', 'acc.report.view'],
  PCMGR: ['acc.raci.view', 'acc.report.view'], CFO: ['acc.raci.view', 'acc.report.view'],
};
// Part 04.04. The system administrator and the process owners configure controls and reason codes (changes of a control in ENFORCE mode go through an approval chain);
// the roles that watch the business read the register and the dashboard; every internal role may raise an exception where a control blocks it, and the roles that
// run the site and the company may raise an emergency exception that is regularised afterwards.
const ADDED_04_04 = {
  SYSADM: ['eng.pcs.view', 'eng.pcs.manage', 'eng.pcs.emergency'],
  ITADM: ['eng.pcs.view'],
  DIR: ['eng.pcs.view', 'eng.pcs.emergency'], CFO: ['eng.pcs.view'], AUD: ['eng.pcs.view'], PCMGR: ['eng.pcs.view'], PD: ['eng.pcs.view', 'eng.pcs.emergency'], PM: ['eng.pcs.view', 'eng.pcs.emergency'],
  ACCMGR: ['eng.pcs.view'], PROCMGR: ['eng.pcs.view'], HRMGR: ['eng.pcs.view'], QCMGR: ['eng.pcs.view'], STOREMGR: ['eng.pcs.view'], COMMGR: ['eng.pcs.view'], HSEMGR: ['eng.pcs.view'],
};
// Part 04.01. The system administrator defines workflows (the maker; activation needs the process owner and the IT administrator), cancels instances
// and resolves tasks nobody could be found for; the IT administrator validates and resolves tasks; the auditor and the director read every instance.
const ADDED_04_01 = {
  SYSADM: ['eng.workflow.view', 'eng.workflow.define', 'eng.workflow.cancel', 'eng.workflow.admin'],
  ITADM: ['eng.workflow.view', 'eng.workflow.admin'],
  DIR: ['eng.workflow.view', 'eng.workflow.cancel'],
  AUD: ['eng.workflow.view'],
  PROCMGR: ['eng.workflow.view'],
  PCMGR: ['eng.workflow.view'],
};
const USES_SAMPLE_DOCS = new Set(['SYSADM', 'ITADM', 'DIR', 'CFO', 'ACCMGR', 'PROCMGR', 'PCMGR', 'PD', 'PM', 'CM', 'SE', 'SK', 'QS', 'EST', 'PLAN', 'DOC']);
// Part 03.03. Managers may share saved list views with a role or a project; everyone keeps personal views.
const SHARES_VIEWS = new Set(['SYSADM', 'PM', 'PD', 'PCMGR', 'ACCMGR', 'CFO', 'HRMGR', 'DIR']);
const internalRole = (code, category) => category !== EXT && code !== 'EMP' && code !== 'GUARD';

function permissionsOfTemplate(code, category) {
  const extra = [...(ADDED_02_05[code] ?? []), ...(ADDED_04_01[code] ?? []), ...(ADDED_04_02[code] ?? []), ...(ADDED_04_04[code] ?? []), ...(ADDED_04_05[code] ?? []), ...(ADDED_04_06[code] ?? []), ...(ADDED_04_07[code] ?? []), ...(ADDED_04_08[code] ?? []), ...(ADDED_04_09[code] ?? []), ...(ADDED_04_10[code] ?? []), ...(ADDED_04_11[code] ?? []), ...(ADDED_04_12[code] ?? []), ...(ADDED_04_13[code] ?? []), ...(ADDED_04_14[code] ?? []), ...(ADDED_04_15[code] ?? []), ...(ADDED_05_01[code] ?? []), ...(ADDED_05_03[code] ?? []), ...(ADDED_05_04[code] ?? []), ...(ADDED_05_05[code] ?? []), ...(ADDED_06_01[code] ?? []), ...(ADDED_06_02[code] ?? []), ...(internalRole(code, category) ? ['mdm.record.view'] : []), ...(internalRole(code, category) ? ['eng.pcs.raise'] : []), ...(internalRole(code, category) ? ['eng.delegation.use'] : []), ...(USES_SAMPLE_DOCS.has(code) ? ['eng.sample.use'] : []), ...(SHARES_VIEWS.has(code) ? PERMISSIONS_03_03 : []), ...(internalRole(code, category) ? ['iam.elevation.request'] : []), ...((category === HO || category === SITE || code === 'SUPADM') ? ['iam.review.decide'] : [])];
  if (code === 'SUPADM') return unique([...LEGACY_ROLE_PERMISSIONS.SYSADM, ...LEGACY_ROLE_PERMISSIONS.ITADM, ...PERMISSIONS_02_04, ...PERMISSIONS_02_05, ...PERMISSIONS_02_06, ...PERMISSIONS_02_07, ...PERMISSIONS_03_01, ...PERMISSIONS_03_03, ...PERMISSIONS_03_05, ...PERMISSIONS_03_07, ...PERMISSIONS_03_08, ...PERMISSIONS_03_09, ...PERMISSIONS_03_10, ...PERMISSIONS_04_01, ...PERMISSIONS_04_02, ...PERMISSIONS_04_04, ...PERMISSIONS_04_05, ...PERMISSIONS_04_06, ...PERMISSIONS_04_07, ...PERMISSIONS_04_08, ...PERMISSIONS_04_09, ...PERMISSIONS_04_10, ...PERMISSIONS_04_11, ...PERMISSIONS_04_12, ...PERMISSIONS_04_13]);
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
