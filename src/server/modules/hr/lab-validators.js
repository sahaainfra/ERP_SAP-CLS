import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the contract labour API (part 07.08). The service checks the rules again (the age of a worker above all); these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
const SKILL = z.enum(['UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED']);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
const body = {
  name: text(100).min(2), photoFileId: id.nullish().transform((v) => v ?? null), aadhaar: z.string().trim().regex(/^\d{12}$/, 'The ID number is 12 digits').nullish().transform((v) => v || null), mobile: z.string().trim().regex(/^\d{10}$/, 'The mobile number is 10 digits').nullish().transform((v) => v || null),
  dob: day, gender: z.enum(['MALE', 'FEMALE', 'OTHER']), homeState: optText(40), tradeCode: text(30).min(2), skillCategory: SKILL, contractorId: id,
  bankAccount: z.string().trim().regex(/^\d{9,18}$/, 'The account number is 9 to 18 digits').nullish().transform((v) => v || null), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Use an IFSC such as SBIN0001234').nullish().transform((v) => v || null),
  uan: z.string().trim().regex(/^\d{12}$/, 'The UAN is 12 digits').nullish().transform((v) => v || null), esicIp: z.string().trim().regex(/^\d{10,17}$/, 'The ESIC number is 10 to 17 digits').nullish().transform((v) => v || null), bocwNo: optText(40),
  emergencyName: optText(100), emergencyMobile: z.string().trim().regex(/^\d{10}$/, 'The mobile number is 10 digits').nullish().transform((v) => v || null),
};
export const parseWorkerCreate = (b) => parse(z.object({ ...body, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseWorkerUpdate = (b) => parse(z.object({ ...body, version: z.number().int().min(1) }).strict(), b);
export const parseClearance = (b) => parse(z.object({ inductionStatus: z.enum(['PENDING', 'CLEARED', 'EXPIRED']), inductionDate: day.nullish().transform((v) => v || null), medicalStatus: z.enum(['PENDING', 'FIT', 'UNFIT', 'EXPIRED']), medicalValidUntil: day.nullish().transform((v) => v || null) }).strict(), b);
export const parsePpe = (b) => parse(z.object({ item: text(60).min(2), issuedOn: day, note: optText(200) }).strict(), b);
export const parseCards = (b) => parse(z.object({ ids: z.array(id).min(1).max(100), reissue: z.boolean().default(false) }).strict(), b);
export const parseContractorQuery = (q) => parse(z.object({ date: day.optional(), siteId: id.optional() }).strict(), clean(q));
export const parseCompliance = (b) => parse(z.object({
  clraLicenceNo: optText(60), licenceValidUntil: day.nullish().transform((v) => v || null), maxWorkers: z.number().int().min(0).max(100000).nullish().transform((v) => v ?? null), pfCode: optText(40), esiCode: optText(40), woReference: optText(80), woValidUntil: day.nullish().transform((v) => v || null),
  version: z.number().int().min(0).default(0),
}).strict(), b);
const wage = { kind: z.enum(['MINIMUM', 'CONTRACT']), contractorId: id.nullish().transform((v) => v ?? null), tradeCode: optText(30), skillCategory: SKILL, stateCode: text(40).min(2), payBasis: z.enum(['DAILY', 'HOURLY', 'PIECE']), rate: z.number().positive().max(1_000_000), minWageRef: optText(120), effectiveFrom: day, reason: optText(300) };
export const parseWageCreate = (b) => parse(z.object({ ...wage, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseWageUpdate = (b) => parse(z.object({ ...wage, version: z.number().int().min(1) }).strict(), b);
export const parseApplicable = (q) => parse(z.object({ contractorId: id, tradeCode: z.string().trim().optional(), skillCategory: SKILL, stateCode: text(40).min(2), payBasis: z.enum(['DAILY', 'HOURLY']).default('DAILY'), date: day.optional() }).strict(), clean(q));
export const parsePhoto = (b) => parse(z.object({ fileId: id }).strict(), b);
