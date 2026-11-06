import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the training API (part 07.10). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const when = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a date and time such as 2026-12-01T10:00');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, 'Use 2 to 30 letters, digits, - or _');
const person = z.enum(['EMPLOYEE', 'WORKER']);
const optId = id.nullish().transform((v) => v ?? null);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
const session = { courseId: id, startAt: when, endAt: when, trainer: optText(100), venue: optText(150), projectId: optId, siteId: optId, departmentId: optId, capacity: z.number().int().min(1).max(1000), cost: z.number().min(0).max(100_000_000).default(0) };
export const parseSessionCreate = (b) => parse(z.object({ ...session, submit: z.boolean().default(false) }).strict(), b);
export const parseSessionUpdate = (b) => parse(z.object({ ...session, version: z.number().int().min(1) }).strict(), b);
export const parseReschedule = (b) => parse(z.object({ startAt: when, endAt: when }).strict(), b);
export const parseCalendar = (q) => parse(z.object({ from: day, to: day }).strict(), clean(q));
export const parseNominate = (b) => parse(z.object({ people: z.array(z.object({ personType: person, personId: id }).strict()).min(1).max(200) }).strict(), b);
export const parseMark = (b) => parse(z.object({ rows: z.array(z.object({ attendanceId: id.optional(), personType: person.optional(), personId: id.optional(), attendance: z.enum(['ATTENDED', 'ABSENT', 'NOMINATED']).optional(), score: z.number().int().min(0).max(100).optional() }).strict()).min(1).max(500) }).strict(), b);
export const parseSignIn = (b) => parse(z.object({ token: z.string().trim().min(8).max(64) }).strict(), b);
export const parseFeedback = (b) => parse(z.object({ rating: z.number().int().min(1).max(5), comment: optText(500) }).strict(), b);
export const parseCourse = (b) => parse(z.object({
  id: id.optional(), code, title: text(150).min(2), titleHi: optText(150), category: z.enum(['SAFETY', 'TECHNICAL', 'STATUTORY', 'SOFT', 'OTHER']), mode: z.enum(['INTERNAL', 'EXTERNAL']),
  mandatoryFor: z.object({ all: z.boolean().optional(), designationCodes: z.array(text(30)).max(50).optional(), departmentCodes: z.array(text(30)).max(50).optional(), tradeCodes: z.array(text(30)).max(50).optional(), workers: z.boolean().optional() }).strict().default({}),
  validityMonths: z.number().int().min(1).max(600).nullish().transform((v) => v ?? null), passScore: z.number().int().min(0).max(100).nullish().transform((v) => v ?? null), certTypeCode: optText(30), active: z.boolean().optional(), version: z.number().int().min(1).optional(),
}).strict(), b);
export const parseCertType = (b) => parse(z.object({
  id: id.optional(), code, name: text(100).min(2), nameHi: optText(100), validityMonths: z.number().int().min(1).max(600).nullish().transform((v) => v ?? null), alertDays: z.number().int().min(0).max(365).default(30),
  requiredFor: z.object({ designationCodes: z.array(text(30)).max(50).optional(), tradeCodes: z.array(text(30)).max(50).optional() }).strict().default({}), mandatory: z.boolean().default(true), version: z.number().int().min(1).optional(),
}).strict(), b);
export const parseSkillDef = (b) => parse(z.object({ id: id.optional(), code, name: text(100).min(2), nameHi: optText(100), trade: optText(40), version: z.number().int().min(1).optional() }).strict(), b);
const cert = { validFrom: day, validUntil: day.nullish().transform((v) => v || null), number: optText(60), issuer: optText(100), fileId: optId };
export const parseCertCreate = (b) => parse(z.object({ personType: person, personId: id, certType: code, ...cert }).strict(), b);
export const parseCertUpdate = (b) => parse(z.object({ ...cert, version: z.number().int().min(1) }).strict(), b);
export const parseVerify = (b) => parse(z.object({ note: optText(300) }).strict(), b ?? {});
export const parseCheck = (b) => parse(z.object({ personType: person, personId: id, certTypes: z.array(code).min(1).max(20), on: day.optional() }).strict(), b);
export const parseAssess = (b) => parse(z.object({ personType: person, personId: id, skillCode: code, level: z.number().int().min(0).max(4), assessedOn: day.optional(), notes: optText(300) }).strict(), b);
export const parseSkillHistory = (q) => parse(z.object({ personType: person, personId: id, skillCode: code }).strict(), clean(q));
export const parseMatrix = (q) => parse(z.object({ siteId: id.optional(), trade: z.string().trim().max(40).optional(), kind: person.optional() }).strict(), clean(q));
export const parseCompliance = (q) => parse(z.object({ siteId: id.optional(), courseId: id.optional(), status: z.enum(['COMPLIANT', 'DUE_SOON', 'OVERDUE', 'NOT_DONE']).optional(), kind: person.optional(), limit: id.max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).strict(), clean(q));
export const parseCosts = (q) => parse(z.object({ from: day.optional(), to: day.optional() }).strict(), clean(q));
