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
