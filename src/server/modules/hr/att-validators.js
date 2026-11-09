import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { parseHhmm } from './att-calc.js';

// Inputs of the attendance configuration API (part 07.04). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const dt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a date and time such as 2026-12-01T09:30');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v ?? null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const time = z.string().refine((v) => parseHhmm(v) != null, 'A time such as 09:30').transform((v) => parseHhmm(v));
const mins = (max) => z.number().int().min(0).max(max);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});

const shiftBody = {
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dots, dashes and underscores'), name: text(80).min(2), startTime: time, endTime: time, breakMinutes: mins(480).default(0), graceMinutes: mins(120).default(0),
  halfDayHours: z.number().min(0.5).max(24), fullDayHours: z.number().min(0.5).max(24), otAfterHours: z.number().min(0.5).max(24).nullish().transform((v) => v ?? null), roundingMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).default(0),
  roundingMode: z.enum(['NEAREST', 'UP', 'DOWN']).default('NEAREST'), nightShift: z.boolean().default(false),
};
const shiftOut = (b) => ({ code: b.code, name: b.name, startMinute: b.startTime, endMinute: b.endTime, breakMinutes: b.breakMinutes, graceMinutes: b.graceMinutes, halfDayMinutes: Math.round(b.halfDayHours * 60), fullDayMinutes: Math.round(b.fullDayHours * 60), otAfterMinutes: b.otAfterHours == null ? null : Math.round(b.otAfterHours * 60), roundingMinutes: b.roundingMinutes, roundingMode: b.roundingMode, nightShift: b.nightShift });
export const parseShiftCreate = (b) => shiftOut(parse(z.object(shiftBody).strict(), b));
export const parseShiftUpdate = (b) => { const o = parse(z.object({ ...shiftBody, status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'), version: z.number().int().min(1) }).strict(), b); return { ...shiftOut(o), status: o.status, version: o.version }; };

export const rulesSchema = z.object({
  late: z.object({ enabled: z.boolean(), countPerHalfDay: z.number().int().min(0).max(31) }).strict(),
  earlyGoing: z.object({ enabled: z.boolean(), graceMinutes: mins(240), countPerHalfDay: z.number().int().min(0).max(31) }).strict(),
  missingPunch: z.object({ mode: z.enum(['REGULARISE', 'HALF_DAY', 'ABSENT', 'ASSUME_SHIFT']) }).strict(),
  compOff: z.object({ enabled: z.boolean(), minMinutes: z.number().int().min(30).max(1440), expiryDays: z.number().int().min(1).max(365) }).strict(),
  ot: z.object({ enabled: z.boolean(), multiplier: z.number().min(1).max(5), holidayMultiplier: z.number().min(1).max(5).nullish().transform((v) => v ?? null), maxPerDayMinutes: z.number().int().min(0).max(720), maxPerWeekMinutes: z.number().int().min(0).max(5000), eligibleGrades: z.array(text(20)).max(40), eligibleCategories: z.array(z.enum(['PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT'])).max(4) }).strict(),
}).strict().partial();
export const parseRules = (r) => parse(rulesSchema, r ?? {});
const polBody = { name: text(80).min(2), effectiveFrom: day, rules: rulesSchema, changeNote: optText(500) };
export const parsePolicyCreate = (b) => parse(z.object({ code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dots, dashes and underscores'), ...polBody, submit: z.boolean().default(false) }).strict(), b);
export const parsePolicyUpdate = (b) => parse(z.object({ ...polBody, version: z.number().int().min(1) }).strict(), b);
export const parsePolicyAmend = (b) => parse(z.object({ effectiveFrom: day, reason }).strict(), b);
export const parseEvaluate = (b) => parse(z.object({ employeeId: optId.optional(), shiftId: optId.optional(), rules: rulesSchema.optional(), date: day, day: z.enum(['WORKING', 'WEEKLY_OFF', 'HOLIDAY']).optional(), punchIn: dt.nullish().transform((v) => v ?? null), punchOut: dt.nullish().transform((v) => v ?? null),
  person: z.object({ grade: text(20).nullish(), category: z.enum(['PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT']).nullish() }).strict().optional(), lateMarksBefore: mins(60).optional(), earlyMarksBefore: mins(60).optional(), weekOtMinutes: mins(5000).optional() }).strict()
  .refine((v) => v.employeeId || v.shiftId, { message: 'Name an employee, or a shift with rules', path: ['shiftId'] }), b);

const weeklyOff = z.union([
  z.object({ type: z.literal('FIXED'), days: z.array(z.number().int().min(0).max(6)).max(7), nthSaturdayOff: z.array(z.number().int().min(1).max(5)).max(5).optional() }).strict(),
  z.object({ type: z.literal('ROTATIONAL'), anchor: day, cycle: z.array(z.union([z.literal(0), z.literal(1)])).min(2).max(28) }).strict(),
]);
export const parseAssignmentCreate = (b) => parse(z.object({ scopeType: z.enum(['COMPANY', 'SITE', 'CREW', 'EMPLOYEE']), scopeId: z.number().int().min(0), policyCode: optText(20), shiftId: optId, weeklyOff: weeklyOff.nullish().transform((v) => v ?? null), holidayCalendarId: optId, effectiveFrom: day, effectiveTo: day.nullish().transform((v) => v || null), reason: optText(300) }).strict(), b);
export const parseAssignmentEnd = (b) => parse(z.object({ effectiveTo: day, reason: optText(300) }).strict(), b);
export const parseAssignmentList = (q) => parse(z.object({ scopeType: z.enum(['COMPANY', 'SITE', 'CREW', 'EMPLOYEE']).optional(), scopeId: z.coerce.number().int().min(0).optional(), includeEnded: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
export const parseResolve = (q) => parse(z.object({ employeeId: id, date: day }).strict(), q);

export const parseRosterCreate = (b) => parse(z.object({ siteId: id, crewId: optId, name: text(80).min(2), cycle: z.array(id.nullable()).min(1).max(56), fromDate: day, toDate: day.nullish().transform((v) => v || null) }).strict(), b);
export const parseRosterEnd = (b) => parse(z.object({ toDate: day }).strict(), b);
export const parseRosterList = (q) => parse(z.object({ siteId: id.optional(), crewId: id.optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
export const parseBoard = (q) => parse(z.object({ siteId: id, crewId: id.optional(), from: day.optional(), days: z.coerce.number().int().min(1).max(31).optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
export const parseChangeCreate = (b) => parse(z.object({ siteId: id, kind: z.enum(['CHANGE', 'SWAP']), employeeId: id, swapEmployeeId: optId, workDate: day, shiftId: optId, isOff: z.boolean().default(false), reason, submit: z.boolean().default(false) }).strict(), b);
export const parseChangeList = (q) => parse(z.object({ siteId: id.optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED']).optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
export const parseMine = (q) => parse(z.object({ from: day.optional(), days: z.coerce.number().int().min(1).max(31).optional() }).strict(), q ?? {});
export const parsePeriodDef = (b) => parse(z.object({ startDay: z.number().int().min(1).max(28), effectiveFrom: day }).strict(), b);
export const parsePeriodList = (q) => parse(z.object({ from: day.optional(), to: day.optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
