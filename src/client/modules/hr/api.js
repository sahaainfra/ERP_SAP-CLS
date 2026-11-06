import { api } from '../../platform/api/index.js';

// The data calls of the HR pages (part 07.01): the employee master.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const RECORD_STATUS = { DRAFT: ['DRAFT', 'Draft'], SUBMITTED: ['IN_REVIEW', 'Waiting for approval'], APPROVED: ['APPROVED', 'Approved'], RETURNED: ['RETURNED', 'Returned for correction'], REJECTED: ['REJECTED', 'Rejected'], CANCELLED: ['CANCELLED', 'Cancelled'] };
export const EMPLOYMENT_STATUS = { ACTIVE: ['ACTIVE', 'Active'], NOTICE: ['AT_RISK', 'On notice'], SEPARATED: ['CLOSED', 'Separated'], ABSCONDING: ['OVERDUE', 'Absconding'] };
export const CHANGE_STATUS = { PENDING: ['IN_REVIEW', 'Waiting for approval'], SCHEDULED: ['AT_RISK', 'Approved, waiting for its date'], APPLIED: ['COMPLETED', 'Applied'], REJECTED: ['REJECTED', 'Rejected'], RETURNED: ['RETURNED', 'Returned for correction'], CANCELLED: ['CANCELLED', 'Cancelled'] };
export const GENDERS = [['MALE', 'Male'], ['FEMALE', 'Female'], ['OTHER', 'Other']];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const MARITAL = [['SINGLE', 'Single'], ['MARRIED', 'Married'], ['DIVORCED', 'Divorced'], ['WIDOWED', 'Widowed'], ['OTHER', 'Other']];
export const EMPLOYMENT_TYPES = [['PERMANENT', 'Permanent'], ['CONTRACT', 'Contract'], ['TRAINEE', 'Trainee'], ['CONSULTANT', 'Consultant']];
export const PAYMENT_MODES = [['BANK_TRANSFER', 'Bank transfer'], ['CASH', 'Cash'], ['CHEQUE', 'Cheque']];
export const DOC_TYPES = [['ID_PROOF', 'ID proof'], ['ADDRESS_PROOF', 'Address proof'], ['OFFER_LETTER', 'Offer letter'], ['APPOINTMENT_LETTER', 'Appointment letter'], ['CERTIFICATE', 'Certificate'], ['DRIVING_LICENCE', 'Driving licence'], ['MEDICAL', 'Medical fitness'], ['OTHER', 'Other']];
export const CONTACT_TYPES = [['EMERGENCY', 'Emergency contact'], ['FAMILY', 'Family member'], ['NOMINEE', 'Nominee']];
export const EVENT_TYPES = [['PROMOTION', 'Promotion'], ['TRANSFER', 'Transfer'], ['INCREMENT', 'Increment'], ['DESIGNATION_CHANGE', 'Designation change'], ['GRADE_CHANGE', 'Grade change'], ['MANAGER_CHANGE', 'Change of manager'], ['CONFIRMED', 'Confirmation'], ['OTHER', 'Other']];
export const EVENT_LABELS = { JOINED: 'Joined', CONFIRMED: 'Confirmed', PROMOTION: 'Promotion', TRANSFER: 'Transfer', INCREMENT: 'Increment', DESIGNATION_CHANGE: 'Designation change', GRADE_CHANGE: 'Grade change', MANAGER_CHANGE: 'Change of manager', STATUS_CHANGE: 'Status change', SEPARATION: 'Separation', OTHER: 'Other' };
export const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const dayIST = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

export const employees = {
  overview: async (f) => (await api.get(`/hr/employees/overview?${q(f)}`)).data,
  queue: async (kind) => (await api.get(`/hr/employees/queue${kind ? `?kind=${kind}` : ''}`)).data,
  get: async (id) => (await api.get(`/hr/employees/${id}`)).data,
  me: async () => (await api.get('/hr/employees/me')).data,
  check: async (b) => (await api.post('/hr/employees/check', b)).data,
  create: async (b) => (await api.post('/hr/employees', b, idem())).data,
  update: async (id, b) => (await api.patch(`/hr/employees/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/hr/employees/${id}`)).data,
  submit: async (id, comment) => (await api.post(`/hr/employees/${id}/submit`, comment ? { comment } : {}, idem())).data,
  withdraw: async (id, reason) => (await api.post(`/hr/employees/${id}/withdraw`, { reason }, idem())).data,
  cancel: async (id, reason) => (await api.post(`/hr/employees/${id}/cancel`, { reason }, idem())).data,
  amend: async (id, b) => (await api.post(`/hr/employees/${id}/amend`, b, idem())).data,
  amendMine: async (b) => (await api.post('/hr/employees/me/changes', b, idem())).data,
  cancelChange: async (changeId, reason) => (await api.post(`/hr/employees/changes/${changeId}/cancel`, { reason }, idem())).data,
  details: async (id, b) => (await api.put(`/hr/employees/${id}/details`, b, idem())).data,
  history: async (id) => (await api.get(`/hr/employees/${id}/history`)).data,
  addDocument: async (id, b) => (await api.post(`/hr/employees/${id}/documents`, b, idem())).data,
  verifyDocument: async (id, docId) => (await api.post(`/hr/employees/${id}/documents/${docId}/verify`, {}, idem())).data,
  verifyBank: async (id, bankId, b) => (await api.post(`/hr/employees/${id}/banks/${bankId}/verify`, b, idem())).data,
  revealBank: async (id, bankId) => (await api.get(`/hr/employees/${id}/banks/${bankId}/reveal`)).data,
  createUser: async (id, b) => (await api.post(`/hr/employees/${id}/user`, b, idem())).data,
  linkUser: async (id, userId) => (await api.post(`/hr/employees/${id}/link-user`, { userId }, idem())).data,
};

// part 07.02: recruitment
export const REQ_STATUS = { DRAFT: ['DRAFT', 'Draft'], SUBMITTED: ['IN_REVIEW', 'Waiting for approval'], APPROVED: ['APPROVED', 'Approved'], RETURNED: ['RETURNED', 'Returned for correction'], REJECTED: ['REJECTED', 'Rejected'], CANCELLED: ['CANCELLED', 'Cancelled'], CLOSED: ['CLOSED', 'Closed'], SUPERSEDED: ['CLOSED', 'Superseded'] };
export const STAGES = [['APPLIED', 'Applied'], ['SCREENED', 'Screened'], ['INTERVIEW', 'Interview'], ['SELECTED', 'Selected'], ['OFFERED', 'Offered'], ['ACCEPTED', 'Accepted'], ['JOINED', 'Joined'], ['REJECTED', 'Rejected']];
export const SOURCES = [['REFERRAL', 'Referral'], ['PORTAL', 'Job portal'], ['AGENCY', 'Agency'], ['WALK_IN', 'Walk-in']];
export const rupees = (v) => (v == null || v === '' ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v)));
const rq = (path) => `/hr/${path}`;
export const recruit = {
  plans: async () => (await api.get(rq('plans'))).data,
  setPlan: async (b) => (await api.put(rq('plans'), b, idem())).data,
  planCheck: async (f) => (await api.get(`${rq('requisitions/plan-check')}?${q(f)}`)).data,
  req: async (id) => (await api.get(rq(`requisitions/${id}`))).data,
  reqCreate: async (b) => (await api.post(rq('requisitions'), b, idem())).data,
  reqUpdate: async (id, b) => (await api.patch(rq(`requisitions/${id}`), b, idem())).data,
  reqRemove: async (id) => (await api.delete(rq(`requisitions/${id}`))).data,
  reqSubmit: async (id, comment) => (await api.post(rq(`requisitions/${id}/submit`), comment ? { comment } : {}, idem())).data,
  reqWithdraw: async (id, reason) => (await api.post(rq(`requisitions/${id}/withdraw`), { reason }, idem())).data,
  reqCancel: async (id, reason) => (await api.post(rq(`requisitions/${id}/cancel`), { reason }, idem())).data,
  reqAmend: async (id, reason) => (await api.post(rq(`requisitions/${id}/amend`), { reason }, idem())).data,
  reqCompare: async (id) => (await api.get(rq(`requisitions/${id}/compare`))).data,
  board: async (f) => (await api.get(`${rq('candidates/board')}?${q(f)}`)).data,
  candidate: async (id) => (await api.get(rq(`candidates/${id}`))).data,
  candCreate: async (b) => (await api.post(rq('candidates'), b, idem())).data,
  stage: async (id, b) => (await api.post(rq(`candidates/${id}/stage`), b, idem())).data,
  checks: async (id, b) => (await api.put(rq(`candidates/${id}/checks`), b, idem())).data,
  prejoining: async (id, b) => (await api.put(rq(`candidates/${id}/prejoining`), b, idem())).data,
  join: async (id, b) => (await api.post(rq(`candidates/${id}/join`), b ?? {}, idem())).data,
  schedule: async (id, b) => (await api.post(rq(`candidates/${id}/interviews`), b, idem())).data,
  feedback: async (id, b) => (await api.post(rq(`interviews/${id}/feedback`), b, idem())).data,
  cancelInterview: async (id, reason) => (await api.post(rq(`interviews/${id}/cancel`), { reason }, idem())).data,
  myInterviews: async () => (await api.get(rq('interviews/mine'))).data,
  offer: async (id) => (await api.get(rq(`offers/${id}`))).data,
  preview: async (b) => (await api.post(rq('offers/preview'), b)).data,
  offerCreate: async (b) => (await api.post(rq('offers'), b, idem())).data,
  offerUpdate: async (id, b) => (await api.patch(rq(`offers/${id}`), b, idem())).data,
  offerRemove: async (id) => (await api.delete(rq(`offers/${id}`))).data,
  offerSubmit: async (id, comment) => (await api.post(rq(`offers/${id}/submit`), comment ? { comment } : {}, idem())).data,
  offerWithdraw: async (id, reason) => (await api.post(rq(`offers/${id}/withdraw`), { reason }, idem())).data,
  offerCancel: async (id, reason) => (await api.post(rq(`offers/${id}/cancel`), { reason }, idem())).data,
  offerAmend: async (id, reason) => (await api.post(rq(`offers/${id}/amend`), { reason }, idem())).data,
  offerSend: async (id) => (await api.post(rq(`offers/${id}/send`), {}, idem())).data,
  offerAccept: async (id, note) => (await api.post(rq(`offers/${id}/accept`), { note }, idem())).data,
  tasks: async (f) => (await api.get(`${rq('onboarding')}?${q(f)}`)).data,
  complete: async (id, b) => (await api.post(rq(`onboarding/${id}/complete`), b ?? {}, idem())).data,
  link: async (token) => (await api.get(`/hr/offer-link/${token}`)).data,
  respond: async (token, b) => (await api.post(`/hr/offer-link/${token}/respond`, b)).data,
  linkDetails: async (token, b) => (await api.put(`/hr/offer-link/${token}/prejoining`, b)).data,
};

// part 07.03: deployment, crews and transfers
export const ACCESS_ROLES = [['', 'No site access'], ['SE', 'Site Engineer (SE)'], ['WSUP', 'Workforce Supervisor (WSUP)'], ['QCE', 'Quality Control Engineer (QCE)'], ['QS', 'Quantity Surveyor (QS)'], ['PLAN', 'Planning Engineer (PLAN)'], ['HSEE', 'HSE Engineer (HSEE)'], ['HSEO', 'HSE Officer (HSEO)']];
export const KINDS = [['TRANSFER', 'Transfer'], ['SECONDMENT', 'Secondment']];
const dq = (path) => `/hr/${path}`;
export const deploy = {
  board: async (f) => (await api.get(`${dq('deployment-board')}?${q(f)}`)).data,
  get: async (id) => (await api.get(dq(`deployments/${id}`))).data,
  create: async (b) => (await api.post(dq('deployments'), b, idem())).data,
  update: async (id, b) => (await api.patch(dq(`deployments/${id}`), b, idem())).data,
  remove: async (id) => (await api.delete(dq(`deployments/${id}`))).data,
  submit: async (id, comment) => (await api.post(dq(`deployments/${id}/submit`), comment ? { comment } : {}, idem())).data,
  withdraw: async (id, reason) => (await api.post(dq(`deployments/${id}/withdraw`), { reason }, idem())).data,
  cancel: async (id, reason) => (await api.post(dq(`deployments/${id}/cancel`), { reason }, idem())).data,
  amend: async (id, reason, changes) => (await api.post(dq(`deployments/${id}/amend`), changes ? { reason, changes } : { reason }, idem())).data,
  move: async (id, crewId, comment) => (await api.post(dq(`deployments/${id}/move`), { crewId, comment }, idem())).data,
  compare: async (id) => (await api.get(dq(`deployments/${id}/compare`))).data,
  planCheck: async (f) => (await api.get(`${dq('deployments/plan-check')}?${q(f)}`)).data,
  crews: {
    get: async (id) => (await api.get(dq(`crews/${id}`))).data,
    create: async (b) => (await api.post(dq('crews'), b, idem())).data,
    update: async (id, b) => (await api.patch(dq(`crews/${id}`), b, idem())).data,
    addMember: async (id, b) => (await api.post(dq(`crews/${id}/members`), b, idem())).data,
    endMember: async (id, memberId, toDate) => (await api.post(dq(`crews/${id}/members/${memberId}/end`), { toDate }, idem())).data,
  },
  transfers: {
    get: async (id) => (await api.get(dq(`transfers/${id}`))).data,
    create: async (b) => (await api.post(dq('transfers'), b, idem())).data,
    update: async (id, b) => (await api.patch(dq(`transfers/${id}`), b, idem())).data,
    remove: async (id) => (await api.delete(dq(`transfers/${id}`))).data,
    submit: async (id, comment) => (await api.post(dq(`transfers/${id}/submit`), comment ? { comment } : {}, idem())).data,
    withdraw: async (id, reason) => (await api.post(dq(`transfers/${id}/withdraw`), { reason }, idem())).data,
    cancel: async (id, reason) => (await api.post(dq(`transfers/${id}/cancel`), { reason }, idem())).data,
    amend: async (id, reason) => (await api.post(dq(`transfers/${id}/amend`), { reason }, idem())).data,
    handover: async (id, items) => (await api.put(dq(`transfers/${id}/handover`), { items }, idem())).data,
    compare: async (id) => (await api.get(dq(`transfers/${id}/compare`))).data,
  },
};

// part 07.04: shifts, attendance policies, assignments, rosters and periods
const aq = (path) => `/hr/att/${path}`;
export const POLICY_STATUS = REQ_STATUS;
export const WEEKDAYS = [[0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday']];
export const MISSING_MODES = [['REGULARISE', 'Wait for the person to regularise it'], ['HALF_DAY', 'Count half a day'], ['ABSENT', 'Count as absent'], ['ASSUME_SHIFT', 'Assume the whole shift']];
export const DAY_TYPES = { WORKING: 'Working day', WEEKLY_OFF: 'Weekly off', HOLIDAY: 'Holiday', ROSTER_OFF: 'Off in the roster' };
export const hoursText = (m) => (m == null ? '—' : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
export const att = {
  shifts: {
    get: async (id) => (await api.get(aq(`shifts/${id}`))).data,
    active: async () => (await api.get(aq('shifts/active'))).data,
    create: async (b) => (await api.post(aq('shifts'), b, idem())).data,
    update: async (id, b) => (await api.patch(aq(`shifts/${id}`), b, idem())).data,
  },
  policies: {
    get: async (id) => (await api.get(aq(`policies/${id}`))).data,
    codes: async () => (await api.get(aq('policies/codes'))).data,
    create: async (b) => (await api.post(aq('policies'), b, idem())).data,
    update: async (id, b) => (await api.patch(aq(`policies/${id}`), b, idem())).data,
    remove: async (id) => (await api.delete(aq(`policies/${id}`))).data,
    submit: async (id, comment) => (await api.post(aq(`policies/${id}/submit`), comment ? { comment } : {}, idem())).data,
    withdraw: async (id, reason) => (await api.post(aq(`policies/${id}/withdraw`), { reason }, idem())).data,
    cancel: async (id, reason) => (await api.post(aq(`policies/${id}/cancel`), { reason }, idem())).data,
    amend: async (id, effectiveFrom, reason) => (await api.post(aq(`policies/${id}/amend`), { effectiveFrom, reason }, idem())).data,
    compare: async (id) => (await api.get(aq(`policies/${id}/compare`))).data,
  },
  evaluate: async (b) => (await api.post(aq('evaluate'), b)).data,
  assignments: {
    list: async (f) => (await api.get(`${aq('assignments')}?${q(f)}`)).data,
    create: async (b) => (await api.post(aq('assignments'), b, idem())).data,
    end: async (id, effectiveTo, reason) => (await api.post(aq(`assignments/${id}/end`), { effectiveTo, reason }, idem())).data,
  },
  resolve: async (employeeId, date) => (await api.get(`${aq('resolve')}?employeeId=${employeeId}&date=${date}`)).data,
  myShift: async (f) => (await api.get(`${aq('my-shift')}?${q(f)}`)).data,
  rosters: {
    board: async (f) => (await api.get(`${aq('roster-board')}?${q(f)}`)).data,
    create: async (b) => (await api.post(aq('rosters'), b, idem())).data,
    end: async (id, toDate) => (await api.post(aq(`rosters/${id}/end`), { toDate }, idem())).data,
    list: async (f) => (await api.get(`${aq('rosters')}?${q(f)}`)).data,
    changes: async (f) => (await api.get(`${aq('roster-changes')}?${q(f)}`)).data,
    change: async (b) => (await api.post(aq('roster-changes'), b, idem())).data,
    cancelChange: async (id, reason) => (await api.post(aq(`roster-changes/${id}/cancel`), { reason }, idem())).data,
  },
  period: { get: async () => (await api.get(aq('period'))).data, set: async (b) => (await api.put(aq('period'), b, idem())).data, list: async (f) => (await api.get(`${aq('periods')}?${q(f)}`)).data, close: async (id) => (await api.post(aq(`periods/${id}/close`), {}, idem())).data },
  calendars: async () => (await api.get('/core/holiday-calendars')).data,
};

// part 07.05: geo-fenced attendance (under /api/v1/att)
export const RESULT = { ACCEPTED: ['APPROVED', 'Accepted'], FLAGGED: ['AT_RISK', 'Accepted, flagged'], PENDING: ['IN_REVIEW', 'Waiting for approval'], REJECTED: ['REJECTED', 'Rejected'] };
export const SEVERITY = { HIGH: ['OVERDUE', 'High'], MEDIUM: ['AT_RISK', 'Medium'], LOW: ['ACTIVE', 'Low'] };
export const attp = {
  context: async () => (await api.get('/att/punches/context')).data,
  punch: async (b, key) => (await api.post('/att/punches', b, { headers: { 'idempotency-key': key } })).data,
  crew: async (b) => (await api.post('/att/punches/crew', b)).data,
  kiosk: async (b, key) => (await api.post('/att/punches/kiosk', b, { headers: { 'idempotency-key': key } })).data,
  today: async (f) => (await api.get(`/att/punches/today?${q(f)}`)).data,
  list: async (f) => (await api.get(`/att/punches?${q(f)}`)),
  anomalies: async (f) => (await api.get(`/att/anomalies?${q(f)}`)),
  review: async (id, b) => (await api.post(`/att/anomalies/${id}/review`, b, idem())).data,
  bulk: async (b) => (await api.post('/att/anomalies/bulk-review', b, idem())).data,
  report: async (f) => (await api.get(`/att/report/today?${q(f)}`)).data,
  settings: async (siteId) => (await api.get(`/att/site-settings/${siteId}`)).data,
  setSettings: async (siteId, b) => (await api.put(`/att/site-settings/${siteId}`, b, idem())).data,
};
/** A stable id for this browser, so a phone used by two people can be seen (only an id, never read from the device). */
export const deviceId = () => { try { let d = localStorage.getItem('erp.att.device'); if (!d) { d = globalThis.crypto.randomUUID(); localStorage.setItem('erp.att.device', d); } return d; } catch { return null; } };
/** The position at this moment (read only when a person punches, never in the background): { lat, lng, accuracyM } or an error message. */
export const readPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject(new Error('This browser cannot give a location.')); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)), accuracyM: Math.round(p.coords.accuracy) }), (e) => reject(new Error(e.code === 1 ? 'Location is switched off for this page: allow it in the browser to punch.' : 'The location could not be read. Move to open sky and try again.')), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
});
/** A photo made small (at most 480 px) and returned as a data URL, so it travels with the punch. */
export const smallPhoto = (file) => new Promise((resolve, reject) => {
  const img = new Image(); const url = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, 480 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.7)); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be read.')); };
  img.src = url;
});

// part 07.06: the attendance register, regularisation, overtime, manual entries, the period lock and arrears
const docs = (path) => ({
  get: async (id) => (await api.get(`/hr/${path}/${id}`)).data,
  list: async (f) => (await api.get(`/hr/${path}?${q(f)}`)),
  create: async (b) => (await api.post(`/hr/${path}`, b, idem())).data,
  update: async (id, b) => (await api.patch(`/hr/${path}/${id}`, b, idem())).data,
  remove: async (id) => (await api.delete(`/hr/${path}/${id}`)).data,
  submit: async (id, comment) => (await api.post(`/hr/${path}/${id}/submit`, comment ? { comment } : {}, idem())).data,
  withdraw: async (id, reason) => (await api.post(`/hr/${path}/${id}/withdraw`, { reason }, idem())).data,
  cancel: async (id, reason) => (await api.post(`/hr/${path}/${id}/cancel`, { reason }, idem())).data,
  amend: async (id, reason) => (await api.post(`/hr/${path}/${id}/amend`, { reason }, idem())).data,
});
export const regs = {
  regularisation: docs('regularisations'),
  overtime: docs('overtime-requests'),
  manual: docs('manual-entries'),
  register: async (f) => (await api.get(`/att/register?${q(f)}`)).data,
  muster: async (f) => (await api.get(`/att/muster?${q(f)}`)).data,
  day: async (employeeId, date) => (await api.get(`/att/day?${q({ employeeId, date })}`)).data,
  recompute: async (b) => (await api.post('/att/recompute', b, idem())).data,
  approvals: async () => (await api.get('/att/approvals')).data,
  bulk: async (b) => (await api.post('/att/approvals/bulk', b, idem())).data,
  lockStatus: async (f) => (await api.get(`/att/periods/status?${q(f)}`)).data,
  locks: async () => (await api.get('/att/period-locks')).data,
  lock: async (b) => (await api.post('/att/period-locks', b, idem())).data,
  reopen: async (id, b) => (await api.post(`/att/period-locks/${id}/reopen`, b, idem())).data,
  arrears: async (f) => (await api.get(`/att/arrears?${q(f)}`)).data,
};
export const DAY_STATUS = { PRESENT: 'Present', ABSENT: 'Absent', HALF_DAY: 'Half day', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off', ON_DUTY: 'On duty', COMP_OFF: 'Comp-off', MISSING_PUNCH: 'Missing punch', HOLIDAY_WORKED: 'Worked on a holiday', WEEKLY_OFF_WORKED: 'Worked on a weekly off' };
export const BAND_TEXT = { STANDARD: 'The usual approvers', REPEATED: 'The HR manager also approves (fourth in a month)', PM_LEVEL: 'The project manager also approves (over 4 hours a day or 50 hours a month)', POLICY_EXCEPTION: 'The HR manager also approves (outside the policy)' };
export const MANUAL_ENTRIES = [['PRESENT', 'Present'], ['HALF_DAY', 'Half day'], ['ABSENT', 'Absent'], ['ON_DUTY', 'On duty'], ['COMP_OFF', 'Comp-off']];
