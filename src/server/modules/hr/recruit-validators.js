import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { BLOOD_GROUPS, GENDERS, MARITAL } from './validators.js';

// Inputs of the recruitment API (part 07.02). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v ?? null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const rupees = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), 'An amount in rupees, with up to two decimals');
export const SOURCES = ['REFERRAL', 'PORTAL', 'AGENCY', 'WALK_IN'];
export const STAGES = ['APPLIED', 'SCREENED', 'INTERVIEW', 'SELECTED', 'OFFERED', 'ACCEPTED', 'JOINED', 'REJECTED'];
const empType = z.enum(['PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT']);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});

const reqBody = {
  departmentId: id, designationId: id, projectId: optId, positions: z.number().int().min(1).max(500), reason: z.enum(['NEW', 'REPLACEMENT']), replacesEmployeeId: optId, employmentType: empType.default('PERMANENT'),
  locationType: z.enum(['HO', 'SITE']).default('HO'), siteId: optId, managerId: optId, ctcMin: rupees, ctcMax: rupees, requiredBy: day, justification: optText(1000),
};
export const parseReqCreate = (b) => parse(z.object({ ...reqBody, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseReqUpdate = (b) => parse(z.object({ ...reqBody, version: z.number().int().min(1) }).strict(), b);
export const parseReqPlanCheck = (q) => parse(z.object({ departmentId: id, designationId: id, projectId: id.optional(), positions: z.coerce.number().int().min(1).max(500).default(1), requisitionId: id.optional() }).strict(), q);
export const parseReqAmend = (b) => parse(z.object({ reason }).strict(), b);
export const parseReqList = (q) => parse(z.object({ q: text(80).optional() }).passthrough(), q);
export const parsePlanSet = (b) => parse(z.object({ departmentId: id, designationId: optId, projectId: optId, approvedPositions: z.number().int().min(0).max(10000), validFrom: day, validTo: day.nullish().transform((v) => v || null), reason }).strict(), b);

export const parseCandCreate = (b) => parse(z.object({
  fullName: text(120).min(2, 'Enter the name'), mobile: z.string().trim().min(1, 'Enter the mobile number'), email: z.string().trim().max(160).nullish().transform((v) => (v ? v.toLowerCase() : null)), source: z.enum(SOURCES), sourceDetail: optText(120),
  requisitionId: id, resumeFileId: optId, currentCtc: rupees.nullish().transform((v) => v ?? null), expectedCtc: rupees.nullish().transform((v) => v ?? null), noticeDays: z.number().int().min(0).max(365).nullish().transform((v) => v ?? null), acknowledgeDuplicates: z.boolean().default(false),
}).strict(), b);
export const parseCandList = (q) => parse(z.object({ q: text(80).optional(), requisitionId: id.optional(), stage: z.enum(STAGES).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseBoard = (q) => parse(z.object({ requisitionId: id.optional(), q: text(80).optional() }).strict(), q);
export const parseStage = (b) => parse(z.object({ stage: z.enum(STAGES), reason: text(300).optional(), version: z.number().int().min(1), undo: z.boolean().default(false) }).strict(), b);
export const parseCheckStatus = (b) => parse(z.object({ bgvStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'CLEAR', 'ADVERSE']).optional(), medicalStatus: z.enum(['PENDING', 'FIT', 'UNFIT']).optional(), note: text(300).optional() }).strict(), b);
export const parseJoin = (b) => parse(z.object({ doj: day.optional(), comment: text(300).optional() }).strict(), b ?? {});
export const parseDocument = (b) => parse(z.object({ fileId: id, label: text(80).min(1) }).strict(), b);

const address = z.object({ line: text(200).min(1), city: optText(60), stateCode: optText(3).transform((v) => (v ? v.toUpperCase() : v)), pin: optText(6) }).strict();
const contact = z.object({ type: z.enum(['EMERGENCY', 'FAMILY', 'NOMINEE']), name: text(100).min(1), relation: text(40).min(1), phone: optText(16), dob: optText(10), sharePct: z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined || v === '' ? null : String(v))) }).strict();
export const parsePrejoining = (b) => parse(z.object({
  firstName: text(60).min(1), lastName: optText(60), gender: z.enum(GENDERS), dob: day, bloodGroup: z.enum(BLOOD_GROUPS).nullish().transform((v) => v ?? null), maritalStatus: z.enum(MARITAL).nullish().transform((v) => v ?? null),
  permanentAddress: address.nullish().transform((v) => v ?? null), currentAddress: address.nullish().transform((v) => v ?? null), contacts: z.array(contact).max(20).default([]),
  education: z.array(z.object({ qualification: text(100).min(1), institute: optText(120), year: z.number().int().min(1950).max(2100).nullish().transform((v) => v ?? null), grade: optText(30) }).strict()).max(15).default([]),
  experience: z.array(z.object({ employer: text(120).min(1), jobTitle: text(100).min(1), fromDate: day, toDate: day.nullish().transform((v) => v || null), leavingReason: optText(200) }).strict()).max(20).default([]),
  statutory: z.object({ pan: text(10).toUpperCase().nullish().transform((v) => v || null), aadhaar: z.string().trim().regex(/^(\d{4}|\d{12})$/).nullish().transform((v) => v || null), uan: z.string().trim().regex(/^\d{12}$/).nullish().transform((v) => v || null), esicIp: z.string().trim().regex(/^(\d{10}|\d{17})$/).nullish().transform((v) => v || null), pfApplicable: z.boolean().default(false), esiApplicable: z.boolean().default(false), ptState: optText(3).transform((v) => (v ? v.toUpperCase() : v)), lwfState: optText(3).transform((v) => (v ? v.toUpperCase() : v)) }).strict().nullish().transform((v) => v ?? null),
  bank: z.object({ accountNo: text(20).min(1), ifsc: text(11).toUpperCase(), accountName: text(120).min(1) }).strict().nullish().transform((v) => v ?? null),
}).strict(), b);

export const parseInterviewCreate = (b) => parse(z.object({ round: z.number().int().min(1).max(10).optional(), scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use a date and time such as 2026-12-01T10:30'), mode: z.enum(['IN_PERSON', 'PHONE', 'VIDEO']).default('IN_PERSON'), panel: z.array(text(60).min(1)).min(1, 'Name at least one panel member').max(8) }).strict(), b);
export const parseFeedback = (b) => parse(z.object({ scores: z.record(text(40), z.number().int().min(1).max(5)).refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 12, 'Score at least one criterion from 1 to 5'), comments: text(1000).optional(), recommendation: z.enum(['PASS', 'HOLD', 'FAIL']) }).strict(), b);

const offerBody = { candidateId: id, designationId: id, grade: optText(20), employmentType: empType.default('PERMANENT'), ctcAnnual: rupees, dojProposed: day, validDays: z.number().int().min(1).max(60).default(7) };
export const parseOfferCreate = (b) => parse(z.object({ ...offerBody, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseOfferUpdate = (b) => parse(z.object({ ...Object.fromEntries(Object.entries(offerBody).filter(([k]) => k !== 'candidateId')), version: z.number().int().min(1) }).strict(), b);
export const parseOfferPreview = (b) => parse(z.object({ ctcAnnual: rupees, candidateId: id.optional(), designationId: id.optional() }).strict(), b);
export const parseOfferAccept = (b) => parse(z.object({ note: text(300).min(5, 'Say how the acceptance was received') }).strict(), b);
export const parseToken = (v) => parse(z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/, 'Not an offer link'), v);
export const parseRespond = (b) => parse(z.object({ action: z.enum(['ACCEPT', 'DECLINE']), comment: text(300).optional() }).strict(), b);
export const parseTaskDone = (b) => parse(z.object({ note: text(300).optional(), waive: z.boolean().default(false) }).strict(), b ?? {});
export const parseTaskList = (q) => parse(z.object({ status: z.enum(['OPEN', 'DONE', 'WAIVED']).optional(), candidateId: id.optional(), mine: z.enum(['true', 'false']).optional() }).strict(), q);
