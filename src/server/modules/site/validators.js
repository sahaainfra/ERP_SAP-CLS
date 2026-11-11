import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the site execution API (part 14.01). The service checks every rule again; quantities have at most three decimals, money two; times are HH:MM.
const id = z.coerce.number().int().min(1);
const optId = id.nullish().transform((v) => v || null);
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 08:00');
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const given = (out, b) => Object.fromEntries(Object.entries(out).filter(([k]) => b && Object.hasOwn(b, k)));
const qty = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const posQty = qty.refine((n) => n > 0, 'Give a quantity above zero');
const money = z.number().finite().min(0).max(1e12).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
const RES = z.enum(['LABOUR', 'MATERIAL', 'PLANT']);
const crews = z.array(z.object({ crewId: id, headcount: z.number().int().min(0).max(2000).nullish().transform((v) => v ?? undefined) }).strict()).max(20);
const resources = z.array(z.object({ type: RES, itemId: optId, trade: optText(60), label: text(200).min(1), uom: text(20).min(1), qty }).strict().refine((x) => x.itemId || x.trade, { message: 'Name the item or the trade', path: ['itemId'] })).max(100);

export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSiteQ = (q) => parse(z.object({ siteId: id, date: day.optional() }).strict(), q ?? {});
export const parseDateQ = (q) => parse(z.object({ date: day.optional() }).strict(), q ?? {});
// work fronts
export const parseFrontCreate = (b) => parse(z.object({ siteId: id, code: text(30).min(1, 'Give a code'), name: text(120).min(2, 'Name the front'), locationId: optId, sortOrder: z.number().int().min(0).max(9999).optional() }).strict(), b ?? {});
export const parseFrontUpdate = (b) => given(parse(z.object({ name: text(120).min(2).optional(), locationId: optId, sortOrder: z.number().int().min(0).max(9999).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
// work authorisations
const wa = {
  siteId: id, planDate: day, activityId: id, workFrontId: optId, wbsId: optId, locationId: optId, plannedQty: posQty, uom: optText(20), drawingId: optId, drawingRevision: optText(20), costCodeId: optId, budgetAmount: money.optional(), budgetLineRef: optText(80),
  permitRequired: z.boolean().optional(), permitRef: optText(60), holdPoints: optText(500), startTime: time, endTime: time, supervisor: optText(80), crews: crews.optional(), resources: resources.optional(),
};
export const parseWaCreate = (b) => parse(z.object({ ...wa, emergency: z.boolean().optional(), emergencyReason: optText(1000) }).strict().refine((x) => !x.emergency || (x.emergencyReason && x.emergencyReason.length >= 5), { message: 'Say why the work cannot wait for the plan (at least 5 characters)', path: ['emergencyReason'] }).refine((x) => x.startTime < x.endTime, { message: 'The end is after the start', path: ['endTime'] }), b ?? {});
export const parseWaUpdate = (b) => given(parse(z.object({ planDate: day.optional(), activityId: id.optional(), workFrontId: optId, wbsId: optId, locationId: optId, plannedQty: posQty.optional(), uom: optText(20), drawingId: optId, drawingRevision: optText(20), costCodeId: optId, budgetAmount: money.optional(), budgetLineRef: optText(80), permitRequired: z.boolean().optional(), permitRef: optText(60), holdPoints: optText(500), startTime: time.optional(), endTime: time.optional(), supervisor: optText(80), crews: crews.optional(), resources: resources.optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
export const parseMove = (b) => parse(z.object({ workFrontId: optId }).strict(), b ?? {});
export const parseClose = (b) => parse(z.object({ actualQty: qty.nullish().transform((v) => v ?? null), closureNotes: optText(2000), varianceReason: optText(1000), resources: z.array(z.object({ id, actualQty: qty }).strict()).max(200).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {});
// daily plans
const line = z.object({ activityId: id, workFrontId: optId, crewId: optId, plannedQty: posQty, uom: optText(20) }).strict();
export const parseDailyCreate = (b) => parse(z.object({ siteId: id, planDate: day, supervisor: optText(80), from: z.enum(['WEEKLY', 'YESTERDAY', 'EMPTY']).default('WEEKLY'), lines: z.array(line).max(200).optional(), note: optText(1000) }).strict(), b ?? {});
export const parseDailyUpdate = (b) => given(parse(z.object({ lines: z.array(line).max(200).optional(), note: optText(1000), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
export const parseIssue = (b) => parse(z.object({ startTime: time.default('08:00'), endTime: time.default('17:00') }).strict().refine((x) => x.startTime < x.endTime, { message: 'The end is after the start', path: ['endTime'] }), b ?? {});
// uses (FR-07)
export const parseUse = (b) => parse(z.object({
  projectId: id, siteId: optId, waId: optId, kind: z.enum(['ATTENDANCE', 'MATERIAL_ISSUE', 'PLANT_LOG', 'DPR', 'MEASUREMENT']), srcEntity: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, 'A source such as inv_issue'), srcId: text(60).min(1),
  resourceType: RES.optional(), itemId: optId, trade: optText(60), crewId: optId, resKey: optText(80), label: optText(200), qty: qty.default(0), uom: optText(20), date: day.optional(),
}).strict(), b ?? {});

// ---- the daily progress report (part 14.02) ----
const WEATHER = z.enum(['CLEAR', 'CLOUDY', 'RAIN', 'HEAVY_RAIN', 'STORM', 'FOG', 'HOT', 'COLD']);
const optWeather = WEATHER.nullish().transform((v) => v ?? null);
const workLine = z.object({ waId: id, qty, remarks: optText(500), reason: optText(500) }).strict();
const labourLine = z.object({ category: z.enum(['STAFF', 'CONTRACT']), contractorId: optId, trade: text(60).min(2, 'Name the trade'), headcount: z.number().int().min(0).max(5000), manDays: qty.max(100000), otHours: qty.max(100000).optional(), reason: optText(500) }).strict()
  .refine((x) => x.category !== 'CONTRACT' || x.contractorId, { message: 'Choose the contractor', path: ['contractorId'] });
const materialLine = z.object({ itemId: id, qty, waId: optId, issueRef: optText(80), reason: optText(500) }).strict();
const equipmentLine = z.object({ label: text(120).min(2, 'Name the equipment'), equipmentKey: optText(80), hoursWorked: qty.max(24).optional(), hoursIdle: qty.max(24).optional(), hoursBreakdown: qty.max(24).optional(), logRef: optText(80), reason: optText(500) }).strict();
const noteLine = z.object({ type: z.enum(['HINDRANCE', 'VISITOR', 'INSTRUCTION', 'QUALITY', 'SAFETY', 'NEXT_DAY']), text: text(2000).min(2, 'Write the note'), linkedEntity: optText(60), linkedId: optText(60) }).strict();
const sections = { work: z.array(workLine).max(200), labour: z.array(labourLine).max(200), materials: z.array(materialLine).max(300), equipment: z.array(equipmentLine).max(100), notes: z.array(noteLine).max(200) };
const dprHeader = { weatherCode: optWeather, rainMm: z.number().int().min(0).max(2000).nullish().transform((v) => v ?? null), weatherRef: optText(80), summary: optText(4000), workFrontId: optId };
export const parseDprCreate = (b) => parse(z.object({ siteId: id, dprDate: day, supervisor: optText(80), scope: z.enum(['SITE', 'SUPERVISOR']).optional(), usePrefill: z.boolean().optional(), ...dprHeader, ...Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.optional()])) }).strict(), b ?? {});
export const parseDprUpdate = (b) => given(parse(z.object({ supervisor: optText(80), ...dprHeader, ...Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
export const parsePrefillQ = (q) => parse(z.object({ siteId: id, date: day, scope: z.enum(['SITE', 'SUPERVISOR']).optional(), supervisor: optText(80) }).strict(), q ?? {});
export const parseDprRangeQ = (q) => parse(z.object({ from: day.optional(), to: day.optional(), projectId: id.optional(), siteId: id.optional() }).strict(), q ?? {});
const reportQ = { period: z.enum(['DAY', 'WEEK', 'MONTH', 'RANGE']).optional(), date: day.optional(), from: day.optional(), to: day.optional(), projectId: id.optional(), siteId: id.optional() };
export const parseDprReportQ = (q) => parse(z.object(reportQ).strict(), q ?? {});
export const parseDprReportExportQ = (q) => parse(z.object({ ...reportQ, format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx') }).strict(), q ?? {});
const mark = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100), text: text(200).min(1) }).strict();
export const parsePhoto = (b) => given(parse(z.object({ caption: optText(300), lat: z.number().min(-90).max(90).nullish().transform((v) => v ?? null), lng: z.number().min(-180).max(180).nullish().transform((v) => v ?? null), takenAt: z.string().datetime({ offset: true }).nullish().transform((v) => v ?? null), locationId: optId, markup: z.array(mark).max(30).optional() }).strict(), b ?? {}), b);
export const parseDprSiteQ = (q) => parse(z.object({ siteId: id }).strict(), q ?? {});

// ---- site diary, weather, hindrances and site conditions (part 14.03) ----
const temp = z.number().finite().min(-80).max(70).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const optNum = (schema) => schema.nullish().transform((v) => v ?? null);
const hhmm = time.nullish().transform((v) => v ?? null);
const HIN_TYPE = z.enum(['SITE_NOT_HANDED_OVER', 'DRAWINGS_PENDING', 'UTILITY_SHIFTING', 'LOCAL_ISSUES', 'APPROVALS', 'OTHER']);
const PARTY = z.enum(['CLIENT', 'CONSULTANT', 'THIRD_PARTY', 'AUTHORITY', 'CONTRACTOR']);
const affected = z.object({ activityIds: z.array(id).max(50).optional(), locationIds: z.array(id).max(50).optional(), text: optText(500).optional() }).strict();
const weatherFields = {
  rainfallMm: optNum(qty.max(2000)), tempMin: optNum(temp), tempMax: optNum(temp), humidityPct: optNum(z.number().int().min(0).max(100)), windKmh: optNum(qty.max(500)),
  hoursLost: qty.max(24).optional(), shutdown: z.boolean().optional(), shutdownReason: optText(500), notes: optText(1000),
};
const weatherRefine = (x) => x.tempMin == null || x.tempMax == null || x.tempMin <= x.tempMax;
const weatherMsg = { message: 'The lowest temperature is not above the highest', path: ['tempMin'] };
export const parseWeatherCreate = (b) => parse(z.object({ siteId: id, date: day, ...weatherFields }).strict().refine(weatherRefine, weatherMsg), b ?? {});
export const parseWeatherUpdate = (b) => given(parse(z.object({ ...weatherFields, rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
export const parseWeatherFetch = (b) => parse(z.object({ siteId: id, date: day }).strict(), b ?? {});
export const parseWeatherQ = (q) => parse(z.object({ siteId: id.optional(), projectId: id.optional(), from: day.optional(), to: day.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() }).strict(), q ?? {});
export const parseWeatherSiteQ = (q) => parse(z.object({ siteId: id, date: day }).strict(), q ?? {});
const hin = { title: text(200).min(3, 'Give a title'), description: optText(4000), type: HIN_TYPE, startDate: day, endDate: day.nullish().transform((v) => v || null), affected: affected.optional(), responsibleParty: PARTY, responsibleName: optText(120), letterId: optId };
export const parseHindranceCreate = (b) => parse(z.object({ siteId: id, ...hin }).strict().refine((x) => !x.endDate || x.endDate >= x.startDate, { message: 'The end is not before the start', path: ['endDate'] }), b ?? {});
export const parseHindranceUpdate = (b) => given(parse(z.object({ title: hin.title.optional(), description: hin.description, type: HIN_TYPE.optional(), startDate: day.optional(), endDate: hin.endDate, affected: affected.optional(), responsibleParty: PARTY.optional(), responsibleName: hin.responsibleName, letterId: optId, rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
export const parseHindranceClose = (b) => parse(z.object({ endDate: day, closureNotes: text(2000).min(5, 'Say how it was resolved (at least 5 characters)') }).strict(), b ?? {});
export const parseHindranceQ = (q) => parse(z.object({ siteId: id.optional(), projectId: id.optional() }).strict(), q ?? {});
const diaryFields = { category: z.enum(['GENERAL', 'PROGRESS', 'INSTRUCTION', 'HINDRANCE', 'QUALITY', 'SAFETY', 'MATERIAL', 'VISITOR']), text: text(4000).min(3, 'Write the note') };
export const parseDiaryCreate = (b) => parse(z.object({ siteId: id, date: day, ...diaryFields }).strict(), b ?? {});
export const parseDiaryUpdate = (b) => given(parse(z.object({ category: diaryFields.category.optional(), text: diaryFields.text.optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
const visitor = { visitorName: text(120).min(2, 'Give the name'), organisation: optText(160), visitorType: z.enum(['OFFICIAL', 'CLIENT', 'CONSULTANT', 'AUTHORITY', 'OTHER']).default('OFFICIAL'), purpose: text(500).min(3, 'Give the purpose'), instructions: optText(2000), timeIn: hhmm, timeOut: hhmm, linkedLetterId: optId };
const visitTimes = (x) => !x.timeIn || !x.timeOut || x.timeOut >= x.timeIn;
export const parseVisitorCreate = (b) => parse(z.object({ siteId: id, date: day, ...visitor }).strict().refine(visitTimes, { message: 'The time out is not before the time in', path: ['timeOut'] }), b ?? {});
export const parseVisitorUpdate = (b) => given(parse(z.object({ visitorName: visitor.visitorName.optional(), organisation: visitor.organisation, visitorType: z.enum(['OFFICIAL', 'CLIENT', 'CONSULTANT', 'AUTHORITY', 'OTHER']).optional(), purpose: visitor.purpose.optional(), instructions: visitor.instructions, timeIn: hhmm, timeOut: hhmm, linkedLetterId: optId, rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
export const parseSiteDayQ = (q) => parse(z.object({ siteId: id.optional(), projectId: id.optional(), from: day.optional(), to: day.optional() }).strict(), q ?? {});

// ---- site instructions and memos (part 14.04) ----
const INS_TYPE = z.enum(['EI', 'CI', 'ISI', 'MEMO']);
const party = z.object({ type: z.enum(['SUBCONTRACTOR', 'CREW', 'PERSON']), id: optId, name: optText(160) }).strict()
  .refine((x) => x.type === 'PERSON' ? x.name : x.id, { message: 'Choose the subcontractor or crew, or name the person', path: ['id'] });
const ins = {
  type: INS_TYPE, date: day, theirRef: optText(80), fromParty: text(160).min(2, 'Say who it is from'), toParty: optText(160), subject: text(200).min(3, 'Give a subject'), description: optText(4000),
  locationId: optId, activityId: optId, dueDate: day.nullish().transform((v) => v || null), costImplication: z.boolean().optional(), timeImplication: z.boolean().optional(),
  backcharge: z.boolean().optional(), backchargeAmount: money.nullish().transform((v) => v ?? null), backchargePartnerId: optId, letterId: optId, parties: z.array(party).max(30).optional(),
};
export const parseInstructionCreate = (b) => parse(z.object({ siteId: id, ...ins }).strict(), b ?? {});
export const parseInstructionUpdate = (b) => given(parse(z.object({ ...Object.fromEntries(Object.entries(ins).filter(([k]) => k !== 'type').map(([k, v]) => [k, v.optional ? v.optional() : v])), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}), b);
export const parseInstructionQ = (q) => parse(z.object({ siteId: id.optional(), projectId: id.optional() }).strict(), q ?? {});
export const parseAckAdd = (b) => parse(z.object({ parties: z.array(party).min(1).max(30) }).strict(), b ?? {});
export const parseAckAct = (b) => parse(z.object({ note: optText(2000) }).strict(), b ?? {});
export const parseComply = (b) => parse(z.object({ note: text(2000).min(5, 'Say what was done (at least 5 characters)') }).strict(), b ?? {});
export const parseInstructionClose = (b) => parse(z.object({ closureNotes: text(2000).min(5, 'Say how it was closed (at least 5 characters)') }).strict(), b ?? {});
export const parseVariationDecision = (b) => parse(z.object({ decision: z.enum(['ACCEPTED', 'REJECTED', 'WITHDRAWN']), ref: optText(80), note: optText(1000) }).strict(), b ?? {});
