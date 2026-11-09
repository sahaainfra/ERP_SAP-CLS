import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the schedule API (part 13.01). The service checks every rule again; dates are business dates (YYYY-MM-DD).
const id = z.coerce.number().int().min(1);
const optId = id.nullish().transform((v) => v || null);
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const optDay = day.nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const given = (out, b) => Object.fromEntries(Object.entries(out).filter(([k]) => b && Object.hasOwn(b, k)));
const TYPE = z.enum(['TASK', 'MILESTONE', 'LOE', 'SUMMARY']);
const CONSTRAINT = z.enum(['NONE', 'SNET', 'FNLT']);
const DEP = z.enum(['FS', 'SS', 'FF', 'SF']);
const qty = z.number().finite().min(0).max(1e12).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');

export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseProjectQ = (q) => parse(z.object({ projectId: optId }).strict(), q ?? {});
// calendars
const calendar = { projectId: optId, code: text(30).min(1, 'Give a code'), name: text(120).min(3, 'Name the calendar'), workWeek: z.string().regex(/^[01]{7}$/, 'Seven 1/0 characters from Monday').refine((s) => s !== '0000000', 'At least one working day').default('1111110'), hoursPerDay: z.number().int().min(1).max(24).default(8), holidayCalendarId: optId, exceptions: z.array(z.object({ date: day, working: z.boolean(), note: optText(120) }).strict()).max(500).default([]), reason };
export const parseCalendarCreate = (b) => parse(z.object(calendar).strict(), b);
export const parseCalendarUpdate = (b) => given(parse(z.object({ name: calendar.name.optional(), workWeek: calendar.workWeek.optional(), hoursPerDay: z.number().int().min(1).max(24).optional(), holidayCalendarId: optId.optional(), exceptions: calendar.exceptions.optional(), reason: reason.optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b), b);
export const parseCalendarDays = (q) => parse(z.object({ from: day, to: day }).strict().refine((x) => x.from <= x.to, { message: 'From is not after to', path: ['to'] }), q ?? {});
// templates
const step = z.object({ key: z.string().regex(/^[A-Z0-9_]{1,12}$/, 'A step key is 1 to 12 capitals, digits or _'), name: text(120).min(2), duration: z.number().int().min(0).max(3650), after: z.string().max(12).nullish().transform((v) => v || null), type: z.enum(['FS', 'SS']).default('FS'), lag: z.number().int().min(-365).max(365).default(0) }).strict();
export const parseTemplateCreate = (b) => parse(z.object({ code: text(30).min(2), name: text(120).min(3), target: z.enum(['WBS', 'LOCATION']), steps: z.array(step).min(1, 'Give at least one step').max(50), chainStep: z.string().max(12).nullish().transform((v) => v || null), reason }).strict(), b);
// schedules
export const parseScheduleCreate = (b) => parse(z.object({ projectId: id, name: text(200).min(3, 'Name the schedule'), calendarId: id, startDate: day, dataDate: optDay, reason: optText(1000) }).strict(), b);
export const parseScheduleUpdate = (b) => given(parse(z.object({ name: text(200).min(3).optional(), calendarId: id.optional(), startDate: day.optional(), dataDate: optDay.optional(), reason: optText(1000).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b), b);
export const parseAmend = (b) => parse(z.object({ reason }).strict(), b ?? {});
// activities
const activity = { code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,30}$/, 'A code is 1 to 30 letters, digits, dot, dash or underscore').nullish().transform((v) => v || null), name: text(200).min(2, 'Name the activity'), wbsId: optId, locationId: optId, type: TYPE.default('TASK'), duration: z.number().int().min(0).max(36500).default(1), calendarId: optId, constraintType: CONSTRAINT.default('NONE'), constraintDate: optDay, qty: qty.default(0), uom: optText(20), responsible: optText(60) };
export const parseActivityCreate = (b) => parse(z.object(activity).strict(), b);
export const parseActivityUpdate = (b) => given(parse(z.object({ name: activity.name.optional(), wbsId: optId.optional(), locationId: optId.optional(), type: TYPE.optional(), duration: z.number().int().min(0).max(36500).optional(), calendarId: optId.optional(), constraintType: CONSTRAINT.optional(), constraintDate: optDay.optional(), qty: qty.optional(), uom: optText(20).optional(), responsible: optText(60).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b), b);
export const parseBulk = (b) => parse(z.object({ ids: z.array(id).min(1, 'Choose at least one activity').max(5000), set: z.object({ duration: z.number().int().min(0).max(36500).optional(), calendarId: optId.optional(), responsible: optText(60).optional(), wbsId: optId.optional(), type: TYPE.optional(), constraintType: CONSTRAINT.optional(), constraintDate: optDay.optional() }).strict().refine((x) => Object.keys(x).length > 0, 'Say what to change') }).strict(), b);
export const parseActivityList = (q) => parse(z.object({ filter: z.enum(['all', 'critical', 'delayed', 'open']).default('all'), wbsId: optId, q: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().refine((n) => [25, 50, 100, 200, 1000].includes(n), 'Use 25, 50, 100, 200 or 1000').default(100) }).strict(), q ?? {});
export const parseDepCreate = (b) => parse(z.object({ predId: id, succId: id, type: DEP.default('FS'), lag: z.number().int().min(-3650).max(3650).default(0) }).strict(), b);
export const parseBoqLinks = (b) => parse(z.object({ lines: z.array(z.object({ boqLineId: id, qty }).strict()).max(500) }).strict(), b);
/** Only the fields a row gives are applied: a missing actual start keeps the recorded one. */
export const parseProgress = (b) => { const out = parseProgress0(b); out.rows = out.rows.map((r, i) => given(r, b.rows[i])); return out; };
const parseProgress0 = (b) => parse(z.object({ dataDate: day, rows: z.array(z.object({ activityId: id, actualStart: optDay, actualFinish: optDay, pctComplete: z.number().min(0).max(100).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals').nullish().transform((v) => (v == null ? null : v)), remainingDays: z.number().int().min(0).max(36500).nullish().transform((v) => (v == null ? null : v)) }).strict()).max(5000).default([]) }).strict(), b);
export const parseGenerate = (b) => parse(z.object({ mode: z.enum(['TEMPLATE', 'BOQ']), templateId: optId, wbsIds: z.array(id).max(500).default([]), locationIds: z.array(id).max(500).default([]), wbsId: optId, chain: z.boolean().default(true), duration: z.number().int().min(0).max(3650).default(5), prefix: z.string().regex(/^[A-Za-z0-9._-]{0,10}$/, 'Up to 10 letters or digits').default('') }).strict(), b);
export const parseImport = (b) => parse(z.object({ rows: z.array(z.object({ code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,30}$/), name: text(200).min(2), wbsCode: optText(60), locationCode: optText(60), type: TYPE.default('TASK'), duration: z.number().int().min(0).max(36500).default(1), predecessors: optText(1000), responsible: optText(60) }).strict()).min(1, 'Give at least one row').max(5000) }).strict(), b);
