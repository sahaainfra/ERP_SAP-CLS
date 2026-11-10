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

// ---- part 13.02: the Gantt edits, resources, availability, histogram and programme ----------------------------------------------------------------------------
const OP = z.enum(['MOVE', 'RESIZE', 'EDIT', 'LINK', 'UNLINK', 'ADD', 'DELETE']);
const RES_TYPE = z.enum(['LABOUR', 'PLANT', 'MATERIAL']);
export const parseGanttEdit = (b) => parse(z.object({
  op: OP, activityId: optId, start: optDay, finish: optDay, duration: z.number().int().min(0).max(5000).nullish(), name: optText(200),
  predId: optId, succId: optId, type: DEP.default('FS'), lag: z.number().int().min(-999).max(999).default(0), linkId: optId,
  actType: TYPE.default('TASK'), wbsId: optId, afterId: optId, confirm: z.boolean().default(false),
}).strict(), b ?? {});
export const parseUndo = (b) => parse(z.object({ editId: optId }).strict(), b ?? {});
const resRow = z.object({ type: RES_TYPE, itemId: optId, trade: optText(80), uom: optText(20), basis: z.enum(['TOTAL', 'PER_DAY']).default('TOTAL'), qty: qty.refine((n) => n > 0, 'Give a quantity above zero'), sourceType: z.enum(['MANUAL', 'BOQ_NORM']).default('MANUAL') }).strict()
  .refine((r) => r.itemId || r.trade, { message: 'Choose an item or name a trade', path: ['itemId'] });
export const parseResources = (b) => parse(z.object({ rows: z.array(resRow).max(100), rowVersion: z.number().int().min(1).nullish() }).strict(), b ?? {});
export const parseCapacity = (b) => parse(z.object({ projectId: id, type: RES_TYPE, itemId: optId, trade: optText(80), uom: optText(20), qtyPerDay: qty.refine((n) => n > 0, 'Give a quantity above zero'), from: day, to: day, reason }).strict()
  .refine((r) => r.itemId || r.trade, { message: 'Choose an item or name a trade', path: ['itemId'] }).refine((r) => r.to >= r.from, { message: 'The end is on or after the start', path: ['to'] }), b ?? {});
const HISTOGRAM_Q = { type: RES_TYPE.nullish().transform((v) => v || null), bucket: z.enum(['day', 'week', 'month']).default('week'), dates: z.enum(['early', 'late']).default('early'), from: optDay, to: optDay, key: optText(120) };
export const parseHistogramQ = (q) => parse(z.object(HISTOGRAM_Q).strict(), q ?? {});
export const parseHistogramExportQ = (q) => parse(z.object({ ...HISTOGRAM_Q, format: z.enum(['csv', 'xlsx', 'pdf']).default('csv') }).strict(), q ?? {});
export const parseDrillQ = (q) => parse(z.object({ type: RES_TYPE, key: text(120).min(1), from: day, to: day, dates: z.enum(['early', 'late']).default('early') }).strict(), q ?? {});
export const parseResourceOptionsQ = (q) => parse(z.object({ projectId: optId, type: RES_TYPE.nullish().transform((v) => v || null), q: optText(60) }).strict(), q ?? {});
export const parseProgrammeQ = (q) => parse(z.object({
  format: z.enum(['pdf', 'svg', 'json']).default('pdf'), paper: z.enum(['A3', 'A1']).default('A3'), scale: z.enum(['day', 'week', 'month', 'quarter']).default('week'),
  filter: z.enum(['all', 'critical', 'open']).default('all'), wbsId: optId, from: optDay, to: optDay, links: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
}).strict(), q ?? {});

// ---- part 13.03: baselines, the comparison, the quality check, the files of MS Project and Primavera -----------------------------------------------------------------
const REVISION = z.enum(['ORIGINAL', 'EOT', 'RESEQUENCE', 'SCOPE', 'OTHER']);
const baselineName = text(200).min(3, 'Name the baseline');
const rowVersion = z.number().int().min(1);
const pageOf = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().refine((n) => [25, 50, 100, 200].includes(n), 'Use 25, 50, 100 or 200').default(50) };
const FILE_FORMAT = z.enum(['csv', 'xlsx', 'pdf']).default('xlsx');
export const QUALITY_CODES = ['LOGIC', 'LEADS', 'LAGS', 'RELATIONSHIPS', 'HARD_CONSTRAINTS', 'HIGH_FLOAT', 'NEGATIVE_FLOAT', 'HIGH_DURATION', 'INVALID_DATES', 'RESOURCES', 'MISSED', 'CRITICAL_PATH', 'CPLI', 'BEI'];
export const parseBaselineCreate = (b) => parse(z.object({ scheduleId: id, name: baselineName, revisionType: REVISION.default('ORIGINAL'), reason, changeSummary: optText(2000), referenceNo: optText(80) }).strict(), b ?? {});
export const parseBaselineUpdate = (b) => given(parse(z.object({ name: baselineName.optional(), revisionType: REVISION.optional(), reason: reason.optional(), changeSummary: optText(2000), referenceNo: optText(80), refresh: z.boolean().optional(), rowVersion }).strict(), b ?? {}), b);
export const parseBaselineAmend = (b) => parse(z.object({ revisionType: z.enum(['EOT', 'RESEQUENCE', 'SCOPE', 'OTHER'], { message: 'A revision is an extension of time, a re-sequencing, a change of scope or other' }), reason, name: baselineName.nullish().transform((v) => v || null), changeSummary: optText(2000), referenceNo: optText(80), scheduleId: optId }).strict(), b ?? {});
const VARIANCE_Q = {
  scheduleId: optId, withBaselineId: optId, only: z.enum(['all', 'slipped', 'critical', 'milestones', 'changed', 'added', 'removed']).default('all'), wbs: optText(60), q: z.string().trim().max(100).default(''),
  sort: z.enum(['finishVar', '-finishVar', 'startVar', '-startVar', 'durationVar', '-durationVar', 'cFinish', '-cFinish', 'code', '-code']).default('-finishVar'),
};
export const parseVarianceQ = (q) => parse(z.object({ ...VARIANCE_Q, ...pageOf }).strict(), q ?? {});
export const parseVarianceExportQ = (q) => parse(z.object({ ...VARIANCE_Q, format: FILE_FORMAT }).strict(), q ?? {});
const QUALITY_Q = { highFloat: z.coerce.number().int().min(1).max(2000).default(44), longDuration: z.coerce.number().int().min(1).max(2000).default(44), tolerance: z.coerce.number().min(0).max(100).default(5) };
export const parseQualityQ = (q) => parse(z.object({ ...QUALITY_Q, check: z.enum(QUALITY_CODES).nullish().transform((v) => v || null), ...pageOf }).strict(), q ?? {});
export const parseQualityExportQ = (q) => parse(z.object({ ...QUALITY_Q, format: FILE_FORMAT }).strict(), q ?? {});
export const parseExchangeQ = (q) => parse(z.object({ format: z.enum(['msp', 'p6']).default('msp') }).strict(), q ?? {});
export const parseImportFileQ = (q) => parse(z.object({ scheduleId: id, format: z.enum(['MSP_XML', 'P6_XML', 'P6_XER']).nullish().transform((v) => v || null), fileName: text(200).min(1, 'Name the file') }).strict(), q ?? {});
export const parseImportListQ = (q) => parse(z.object({ scheduleId: optId, projectId: optId }).strict().refine((x) => x.scheduleId || x.projectId, { message: 'Choose a project or a schedule', path: ['projectId'] }), q ?? {});
const mapKey = z.string().max(40);
export const parseImportUpdate = (b) => parse(z.object({
  mapping: z.object({
    mode: z.enum(['REPLACE', 'MERGE']).optional(), codeFrom: z.enum(['TEXT1', 'WBS', 'ID', 'UID']).optional(), useFileStart: z.boolean().optional(), progress: z.boolean().optional(), resourcesOn: z.boolean().optional(),
    calendars: z.record(mapKey, z.number().int().min(1).nullable()).optional(), wbs: z.record(mapKey, z.number().int().min(1).nullable()).optional(),
    resources: z.record(mapKey, z.object({ type: RES_TYPE, itemId: z.number().int().min(1).nullish().transform((v) => v || null), trade: optText(80), uom: optText(20), skip: z.boolean().default(false) }).strict()).optional(),
  }).strict(),
  rowVersion,
}).strict(), b ?? {});
export const parseImportApply = (b) => parse(z.object({ rowVersion: rowVersion.nullish().transform((v) => v || null) }).strict(), b ?? {});
