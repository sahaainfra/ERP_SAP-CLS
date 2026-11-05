import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the employee master API (part 07.01). The service checks the rules again (formats, duplicates, rights, links to the organisation); these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const upper = (max) => z.string().trim().toUpperCase().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optDay = day.nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v ?? null);

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const MARITAL = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER'];
export const EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT'];
export const PAYMENT_MODES = ['BANK_TRANSFER', 'CASH', 'CHEQUE'];
export const EMPLOYMENT_STATUSES = ['ACTIVE', 'NOTICE', 'SEPARATED', 'ABSCONDING'];
export const RECORD_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'];
export const CONTACT_TYPES = ['EMERGENCY', 'FAMILY', 'NOMINEE'];
export const DOC_TYPES = ['ID_PROOF', 'ADDRESS_PROOF', 'OFFER_LETTER', 'APPOINTMENT_LETTER', 'CERTIFICATE', 'DRIVING_LICENCE', 'MEDICAL', 'OTHER'];
export const EVENT_TYPES = ['PROMOTION', 'TRANSFER', 'INCREMENT', 'DESIGNATION_CHANGE', 'GRADE_CHANGE', 'MANAGER_CHANGE', 'CONFIRMED', 'OTHER'];

export const parseId = (v) => parse(id, v);

const address = z.object({ line: text(200).min(1, 'Enter the address'), city: optText(60), stateCode: optText(3).transform((v) => (v ? v.toUpperCase() : v)), pin: optText(6) }).strict();
const contact = z.object({ type: z.enum(CONTACT_TYPES), name: text(100).min(1, 'Enter the name'), relation: text(40).min(1, 'Enter the relation'), phone: optText(16), dob: optDay, sharePct: z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined || v === '' ? null : String(v))) }).strict();
const education = z.object({ qualification: text(100).min(1, 'Enter the qualification'), institute: optText(120), year: z.number().int().min(1950).max(2100).nullish().transform((v) => v ?? null), grade: optText(30) }).strict();
const experience = z.object({ employer: text(120).min(1, 'Enter the employer'), jobTitle: text(100).min(1, 'Enter the job title'), fromDate: day, toDate: optDay, leavingReason: optText(200) }).strict();
const statutory = z.object({
  pan: upper(10).nullish().transform((v) => v || null), aadhaar: z.string().trim().regex(/^(\d{4}|\d{12})$/, 'Give the 12 digits (only the last four are kept) or just the last four').nullish().transform((v) => v || null),
  uan: z.string().trim().regex(/^\d{12}$/, 'A UAN has 12 digits').nullish().transform((v) => v || null), esicIp: z.string().trim().regex(/^(\d{10}|\d{17})$/, 'An ESIC insurance number has 10 or 17 digits').nullish().transform((v) => v || null),
  pfApplicable: z.boolean().default(false), esiApplicable: z.boolean().default(false), ptState: optText(3).transform((v) => (v ? v.toUpperCase() : v)), lwfState: optText(3).transform((v) => (v ? v.toUpperCase() : v)),
}).strict();
const bank = z.object({ accountNo: z.string().trim().min(1, 'Enter the account number'), ifsc: upper(11), accountName: text(120).min(1, 'Enter the name on the account') }).strict();

const employeeBody = {
  firstName: text(60).min(1, 'Enter the first name'), lastName: optText(60), gender: z.enum(GENDERS), dob: day, bloodGroup: z.enum(BLOOD_GROUPS).nullish().transform((v) => v ?? null), maritalStatus: z.enum(MARITAL).nullish().transform((v) => v ?? null),
  mobile: z.string().trim().min(1, 'Enter the mobile number'), email: z.string().trim().max(160).nullish().transform((v) => (v ? v.toLowerCase() : null)),
  permanentAddress: address.nullish().transform((v) => v ?? null), currentAddress: address.nullish().transform((v) => v ?? null),
  branchId: optId, departmentId: id, designationId: id, grade: optText(20), employmentType: z.enum(EMPLOYMENT_TYPES), doj: day, confirmationDate: optDay, managerId: optId, costCentreId: optId,
  locationType: z.enum(['HO', 'SITE']).default('HO'), projectId: optId, siteId: optId, salaryPaymentMode: z.enum(PAYMENT_MODES).default('BANK_TRANSFER'),
  languages: z.array(text(30).min(1)).max(15).default([]), skills: z.array(text(60).min(1)).max(40).default([]),
  contacts: z.array(contact).max(20).default([]), education: z.array(education).max(15).default([]), experience: z.array(experience).max(20).default([]),
  statutory: statutory.nullish().transform((v) => v ?? null), bank: bank.nullish().transform((v) => v ?? null),
};
export const parseEmployeeCreate = (b) => parse(z.object({ ...employeeBody, acknowledgeDuplicates: z.boolean().default(false), submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
// the duplicate check runs as the form is typed, so most of the form is still empty: only the fields that identify a person are read, and none is required
export const parseEmployeeCheck = (b) => parse(z.object({
  firstName: text(60).default(''), lastName: optText(60), dob: z.string().max(10).default(''), mobile: z.string().trim().max(20).default(''), email: z.string().trim().max(160).nullish().transform((v) => v || null),
  gender: z.enum(GENDERS).catch('MALE'), statutory: z.object({ pan: upper(10).nullish().transform((v) => v || null), aadhaar: z.string().trim().max(12).nullish().transform((v) => v || null) }).passthrough().nullish().transform((v) => v ?? null),
  employeeId: id.optional(), contacts: z.array(contact).max(20).default([]),
}).strip(), b);
export const parseEmployeeUpdate = (b) => parse(z.object({ ...employeeBody, version: z.number().int().min(1), acknowledgeDuplicates: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseDelete = (b) => parse(z.object({ reason: reason.optional() }).strict(), b ?? {});

export const parseList = (q) => parse(z.object({ q: text(80).optional() }).passthrough(), q);
export const parseLookup = (q) => parse(z.object({ q: text(80).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict(), q);
export const parseOverview = (q) => parse(z.object({ from: day.optional(), to: day.optional(), branchId: id.optional(), departmentId: id.optional(), locationType: z.enum(['HO', 'SITE']).optional() }).strict(), q);
export const parseQueue = (q) => parse(z.object({ kind: z.enum(['ACTIVATION', 'CHANGE', 'DOCUMENT', 'ACCESS']).optional() }).strict(), q);

// ---- details of an approved employee that need no approval: education, experience, skills, languages, the photo ----
export const parseDetails = (b) => parse(z.object({
  education: z.array(education).max(15).optional(), experience: z.array(experience).max(20).optional(), skills: z.array(text(60).min(1)).max(40).optional(), languages: z.array(text(30).min(1)).max(15).optional(),
  photoFileId: id.nullish().optional(), version: z.number().int().min(1), reason: text(300).optional(),
}).strict(), b);

// ---- changes of an approved employee (amendments): each is a request approved through the workflow ----
const profileChange = z.object({
  firstName: text(60).min(1).optional(), lastName: optText(60).optional(), gender: z.enum(GENDERS).optional(), dob: day.optional(), bloodGroup: z.enum(BLOOD_GROUPS).nullable().optional(), maritalStatus: z.enum(MARITAL).nullable().optional(),
  mobile: z.string().trim().min(1).optional(), email: z.string().trim().max(160).nullable().optional().transform((v) => (v ? v.toLowerCase() : v)),
  permanentAddress: address.nullable().optional(), currentAddress: address.nullable().optional(), contacts: z.array(contact).max(20).optional(),
}).strict();
const employmentChange = z.object({
  branchId: optId.optional(), departmentId: id.optional(), designationId: id.optional(), grade: optText(20).optional(), employmentType: z.enum(EMPLOYMENT_TYPES).optional(), confirmationDate: optDay.optional(), managerId: optId.optional(),
  costCentreId: optId.optional(), locationType: z.enum(['HO', 'SITE']).optional(), projectId: optId.optional(), siteId: optId.optional(), salaryPaymentMode: z.enum(PAYMENT_MODES).optional(),
}).strict();
const separationChange = z.object({ status: z.enum(['NOTICE', 'SEPARATED', 'ABSCONDING', 'ACTIVE']), lastWorkingDate: optDay, separationReason: text(300).min(5, 'Say why (at least 5 characters)') }).strict();
export const parseAmend = (b) => parse(z.discriminatedUnion('type', [
  z.object({ type: z.literal('PROFILE'), changes: profileChange, reason, effectiveDate: day.optional() }).strict(),
  z.object({ type: z.literal('STATUTORY'), changes: statutory.partial().strict(), reason, effectiveDate: day.optional() }).strict(),
  z.object({ type: z.literal('BANK'), changes: bank, reason, effectiveDate: day.optional() }).strict(),
  z.object({ type: z.literal('EMPLOYMENT'), changes: employmentChange, reason, effectiveDate: day.optional(), eventType: z.enum(EVENT_TYPES).optional(), referenceDoc: optText(80) }).strict(),
  z.object({ type: z.literal('SEPARATION'), changes: separationChange, reason, effectiveDate: day }).strict(),
]), b);
export const parseChangeList = (q) => parse(z.object({ status: z.enum(['PENDING', 'SCHEDULED', 'APPLIED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional(), type: z.enum(['PROFILE', 'STATUTORY', 'BANK', 'EMPLOYMENT', 'SEPARATION']).optional() }).strict(), q);
export const parseBankVerify = (b) => parse(z.object({ result: z.enum(['VERIFIED', 'FAILED']), note: z.string().trim().min(5, 'Say how it was verified (at least 5 characters)').max(300) }).strict(), b);
export const parseDocumentAdd = (b) => parse(z.object({ docType: z.enum(DOC_TYPES), docNo: optText(60), fileId: optId, validFrom: optDay, validUntil: optDay }).strict(), b);
export const parseCreateUser = (b) => parse(z.object({ username: z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9][a-z0-9._-]*$/, 'Letters, digits, dot, dash and underscore').optional(), invite: z.boolean().default(true), channel: z.enum(['email', 'sms', 'whatsapp']).optional() }).strict(), b ?? {});
export const parseLinkUser = (b) => parse(z.object({ userId: id }).strict(), b);
