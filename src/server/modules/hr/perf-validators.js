import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the performance API (part 07.11). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-12');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, 'Use 2 to 30 letters, digits, - or _');
const rating = z.number().int().min(1, 'Rate from 1 to 5').max(5, 'Rate from 1 to 5');
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
export const parseCycleQuery = (q) => parse(z.object({ cycleId: id.optional(), employeeId: id.optional() }).strict(), clean(q));
export const parseLaunch = (b) => parse(z.object({ cycleId: id }).strict(), b);
export const parseSelf = (b) => parse(z.object({ rating, comments: text(2000).min(5, 'Say what you did this cycle (at least 5 characters)') }).strict(), b);
export const parseManager = (b) => parse(z.object({ rating, comments: text(2000).min(5, 'Give your reasons (at least 5 characters)') }).strict(), b);
export const parseCalibrate = (b) => parse(z.object({ rating, reason: optText(500), developmentPlan: text(2000).min(5, 'Write the development plan (at least 5 characters)') }).strict(), b);
export const parseCompute = (b) => parse(z.object({ employeeId: id.optional(), month: month.optional() }).strict(), b ?? {});
export const parseManual = (b) => parse(z.object({ employeeId: id, kpiCode: code, period: month, value: z.number().min(0).max(1_000_000), note: text(500).min(5, 'Say where the figure comes from (at least 5 characters)') }).strict(), b);
export const parseDispute = (b) => parse(z.object({ reason }).strict(), b);
export const parseResolve = (b) => parse(z.object({ outcome: z.enum(['UPHELD', 'REJECTED']), resolution: reason, adjustedValue: z.number().min(0).max(1_000_000).optional() }).strict(), b);
export const parseDisputeQuery = (q) => parse(z.object({ status: z.enum(['OPEN', 'UPHELD', 'REJECTED']).optional() }).strict(), clean(q));
export const parseKpi = (b) => parse(z.object({
  id: id.optional(), code, name: text(120).min(2), nameHi: optText(120), formulaRef: code, direction: z.enum(['HIGHER', 'LOWER']), target: z.number().min(0).max(1_000_000), weight: z.number().int().min(1).max(100),
  appliesTo: z.object({ all: z.boolean().optional(), designationCodes: z.array(text(30)).max(50).optional(), departmentCodes: z.array(text(30)).max(50).optional() }).strict().default({}), effectiveFrom: day, effectiveTo: day.nullish().transform((v) => v || null), version: z.number().int().min(1).optional(),
}).strict(), b);
export const parseCycle = (b) => parse(z.object({ id: id.optional(), code, name: text(120).min(2), kind: z.enum(['ANNUAL', 'HALF_YEARLY', 'QUARTERLY']), startDate: day, endDate: day, selfDue: day.nullish().transform((v) => v || null), seniorFromLevel: z.number().int().min(1).max(20).default(7), version: z.number().int().min(1).optional() }).strict(), b);
const goal = { title: text(150).min(3), measure: optText(200), target: optText(200), weight: z.number().int().min(1).max(100) };
export const parseGoalCreate = (b) => parse(z.object({ cycleId: id, employeeId: id.optional(), ...goal }).strict(), b);
export const parseGoalUpdate = (b) => parse(z.object({ ...goal, version: z.number().int().min(1) }).strict(), b);
export const parseProgress = (b) => parse(z.object({ progress: z.number().int().min(0).max(100) }).strict(), b);
export const parseFeedback = (b) => parse(z.object({ employeeId: id, kind: z.enum(['FEEDBACK', 'RECOGNITION', 'ONE_TO_ONE']), body: text(1000).min(3, 'Write something (at least 3 characters)'), shared: z.boolean().optional(), meetingDate: day.nullish().transform((v) => v || null) }).strict(), b);
export const parseFeedbackQuery = (q) => parse(z.object({ employeeId: id.optional() }).strict(), clean(q));
