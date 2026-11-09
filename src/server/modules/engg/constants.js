// Constants and helpers of drawing control (part 11.01).
export const DRAWING_DOC = 'ENGG_DRAWING_IFC';
export const TRANSMITTAL_DOC = 'ENGG_TRANSMITTAL';
export const DISCIPLINES = { ARCHITECTURAL: 'Architectural', STRUCTURAL: 'Structural', MEP: 'MEP', CIVIL: 'Civil', LANDSCAPE: 'Landscape' };
export const SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'OTHER'];
export const ORIGINATORS = { CONSULTANT: 'Consultant', IN_HOUSE: 'In-house', VENDOR: 'Vendor' };
/** The status code of a revision and its rank: a newly issued revision supersedes the issued ones of equal or lower rank (BR-02). Only IFC may be used for execution (BR-01). */
export const STATUS_CODES = { IFR: 'Issued for review', IFA: 'Issued for approval', IFC: 'Issued for construction', ASBUILT: 'As-built' };
export const RANK = { IFR: 1, IFA: 2, IFC: 3, ASBUILT: 4 };
export const REV_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', ISSUED: 'Issued', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'SUPERSEDED, DO NOT USE' };
export const TX_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', ISSUED: 'Issued', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed (all responses in)' };
export const TX_PURPOSE = { FOR_APPROVAL: 'For approval', FOR_CONSTRUCTION: 'For construction', FOR_INFORMATION: 'For information' };
export const DIRECTIONS = { OUT: 'Outgoing', IN: 'Incoming' };
export const RESPONSES = { A: 'Approved', B: 'Approved with comments', C: 'Revise and resubmit', D: 'Rejected' };
export const LINK_TYPES = { WBS: 'WBS node', LOCATION: 'Location', BOQ: 'BOQ item', ACTIVITY: 'Activity' };
export const COPY_STATUS = { ISSUED: 'Issued, not yet acknowledged', ACKNOWLEDGED: 'Acknowledged', SUPERSEDED: 'SUPERSEDED, DO NOT USE', WITHDRAWN: 'Withdrawn' };
export const nowIso = () => new Date().toISOString();
export const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
export const rid = (v) => parseInt(String(v), 10);
export const same = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// ---- part 11.02: RFI management ----
export const RFI_ISSUE_DOC = 'ENGG_RFI_ISSUE';
export const RFI_CLOSE_DOC = 'ENGG_RFI_CLOSE';
export const RFI_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for the design coordinator', ISSUED: 'With the consultant', RESPONDED: 'Responded, to be verified', CLOSE_REQUESTED: 'Closure waiting for approval', CLOSED: 'Closed', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const RFI_OPEN = ['SUBMITTED', 'ISSUED', 'RESPONDED', 'CLOSE_REQUESTED'];
export const RFI_PRIORITY = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };
/** Days the consultant has to answer, by priority, counted from the day the RFI is issued (FR-04). */
export const RFI_SLA_DAYS = { CRITICAL: 2, HIGH: 5, MEDIUM: 7, LOW: 14 };
export const BALL = { RAISER: 'Raiser', DESIGN: 'Design coordinator', CONSULTANT: 'Consultant', VERIFIER: 'Raiser\'s lead', NONE: 'Nobody' };
export const RESPONSE_TYPES = { CLARIFICATION: 'Clarification', DESIGN_CHANGE: 'Design change', INSTRUCTION: 'Instruction' };
export const toPaise = (v) => Math.round(Number(v ?? 0) * 100);
export const rupees = (n) => (Number(n ?? 0) / 100).toFixed(2);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
// ---- part 11.03: submittals ----
export const SUBMITTAL_DOC = 'ENGG_SUBMITTAL';
export const SUB_TYPES = { MAR: 'Material approval', METHOD_STATEMENT: 'Method statement', SHOP_DRAWING: 'Shop drawing', SAMPLE: 'Sample', MOCK_UP: 'Mock-up', PRODUCT_DATA: 'Product data', QUALITY_PLAN: 'Quality plan' };
/** Method statements and shop drawings are checked internally by the construction manager; the material types by the quality control manager. */
export const SUB_CM_TYPES = ['METHOD_STATEMENT', 'SHOP_DRAWING'];
export const SUB_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for internal approval', WITH_CONSULTANT: 'With the consultant', APPROVED: 'Approved', REVISE: 'Revise and resubmit', REJECTED: 'Rejected', RETURNED: 'Returned for correction', CANCELLED: 'Cancelled' };
export const SUB_OPEN = ['DRAFT', 'SUBMITTED', 'WITH_CONSULTANT', 'REVISE', 'RETURNED'];
export const SUB_RESPONSE = { A: 'Approved', B: 'Approved as noted', C: 'Revise and resubmit', D: 'Rejected' };
// ---- part 11.04: EPC deliverables and vendor document review ----
export const DELIVERABLE_DOC = 'ENGG_DELIVERABLE_IFC';
export const VDR_DOC = 'ENGG_VDR_REVIEW';
export const DELIV_DISCIPLINES = { ARCHITECTURAL: 'Architectural', STRUCTURAL: 'Structural', MEP: 'MEP', CIVIL: 'Civil', LANDSCAPE: 'Landscape', PROCESS: 'Process', PIPING: 'Piping', ELECTRICAL: 'Electrical', INSTRUMENTATION: 'Instrumentation', MECHANICAL: 'Mechanical' };
export const DELIV_TYPES = { DRAWING: 'Drawing', CALCULATION: 'Calculation', SPECIFICATION: 'Specification', DATA_SHEET: 'Data sheet', MTO: 'Material take-off', REPORT: 'Report', OTHER: 'Other' };
export const MILESTONES = ['IFR', 'IFA', 'IFC', 'ASBUILT'];
export const MILESTONE_RANK = { NOT_STARTED: 0, IFR: 1, IFA: 2, IFC: 3, ASBUILT: 4 };
/** The share of a deliverable that is done when it reaches a milestone, in basis points (10000 = 100 %); the company can change it with the parameter engg.progress_weights. */
export const DEFAULT_WEIGHTS = { IFR: 5000, IFA: 7000, IFC: 10000, ASBUILT: 10000 };
export const VDR_TYPES = { GA_DRAWING: 'GA drawing', DATA_SHEET: 'Data sheet', TEST_PROCEDURE: 'Test procedure', MANUAL: 'Manual', CALCULATION: 'Calculation', CERTIFICATE: 'Certificate', OTHER: 'Other' };
export const VDR_STATUS = { REQUIRED: 'Required', RECEIVED: 'Received, to be reviewed', IN_REVIEW: 'Review waiting for approval', ACCEPTED: 'Accepted', RESUBMIT: 'Vendor to resubmit', RETURNED: 'Returned for correction', CANCELLED: 'Cancelled' };
export const CRS_STATUS = { OPEN: 'Open', RESPONDED: 'Responded', CLOSED: 'Closed' };
export const pct = (bp) => (Number(bp ?? 0) / 100).toFixed(2);
// ---- part 11.05: correspondence register ----
export const LETTER_DOC = 'ENGG_LETTER';
export const LETTER_CATS = { INSTRUCTION: 'Instruction', NOTICE: 'Notice', APPROVAL: 'Approval', QUERY: 'Query', PAYMENT: 'Payment', OTHER: 'Other' };
export const LETTER_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved, to be issued', ISSUED: 'Issued', ACKNOWLEDGED: 'Acknowledged', REGISTERED: 'Registered', CLOSED: 'Closed', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const ISSUE_MODES = { EMAIL: 'E-mail', COURIER: 'Courier', PORTAL: 'Portal', HAND: 'Hand delivery' };
export const LINK_ENTITIES = { RFI: 'RFI', VARIATION: 'Variation', CLAIM: 'Claim', SITE_INSTRUCTION: 'Site instruction', DRAWING: 'Drawing', SUBMITTAL: 'Submittal', TRANSMITTAL: 'Transmittal', OTHER: 'Other' };
export const TB_STATUS = { OPEN: 'Open', SERVED: 'Served in time', LAPSED: 'Lapsed', WAIVED: 'Waived' };
/** The standard texts for drafting an outward letter ({project}, {their_ref}, {their_date}, {clause}, {date} are filled in); the print templates (04.11) will replace them. */
export const LETTER_TEMPLATES = [
  { code: 'ACKNOWLEDGE', label: 'Acknowledgement of a letter', category: 'OTHER', subject: 'Acknowledgement of your letter {their_ref}', body: 'Dear Sir,\n\nWe acknowledge receipt of your letter {their_ref} dated {their_date} on {project}. The matter is under examination and we will revert shortly.\n\nYours faithfully,' },
  { code: 'REPLY_INSTRUCTION', label: 'Reply to an instruction', category: 'INSTRUCTION', subject: 'Re: {their_ref}: instruction', body: 'Dear Sir,\n\nWith reference to your instruction {their_ref} dated {their_date} on {project}, we confirm that it will be carried out. Any effect on cost or time will be notified under clause {clause}.\n\nYours faithfully,' },
  { code: 'NOTICE_CLAIM', label: 'Notice of claim', category: 'NOTICE', subject: 'Notice of claim under clause {clause}', body: 'Dear Sir,\n\nWe give notice under clause {clause} of the contract that an event has occurred on {project} which entitles us to extension of time and additional cost. Particulars follow within the time allowed by the contract.\n\nYours faithfully,' },
  { code: 'NOTICE_DELAY', label: 'Notice of delay', category: 'NOTICE', subject: 'Notice of delay on {project}', body: 'Dear Sir,\n\nWe notify you under clause {clause} that the progress of the works on {project} is being delayed by the matter referred to in {their_ref}. We request an extension of time.\n\nYours faithfully,' },
  { code: 'PAYMENT_REMINDER', label: 'Payment reminder', category: 'PAYMENT', subject: 'Payment due: {their_ref}', body: 'Dear Sir,\n\nThe payment certified in {their_ref} on {project} is overdue under clause {clause}. Please release it without further delay.\n\nYours faithfully,' },
  { code: 'CORRIGENDUM', label: 'Corrigendum to an issued letter', category: 'OTHER', subject: 'Corrigendum to our letter {their_ref}', body: 'Dear Sir,\n\nPlease note the following correction to our letter {their_ref} on {project}:\n\nYours faithfully,' },
];
export const ALERT_DAYS_DEFAULT = [7, 3, 1];
