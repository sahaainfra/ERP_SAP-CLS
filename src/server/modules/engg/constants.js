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
