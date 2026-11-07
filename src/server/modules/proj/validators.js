import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { CONTRACT_TYPES, SECTORS, STATES } from './constants.js';

// Inputs of the project master API (part 10.01). The service checks the rules again (the partners, the dates, the people, the checklist) and works out everything else on the server.
const keys = (o) => /** @type {[string, ...string[]]} */ (Object.keys(o));
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v || null);
const optDay = day.nullish().transform((v) => v || null);
const pct = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/, 'Give a percentage')]).transform((v) => String(v)).refine((v) => Number(v) >= 0 && Number(v) <= 100, 'A percentage from 0 to 100');
const money = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/, 'Give an amount')]).transform((v) => String(v)).refine((v) => Number(v) >= 0 && Number(v) <= 1e12, 'An amount of zero or more');
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const version = z.number().int().min(1);
const ticked = z.array(z.number().int().min(0).max(50)).max(50).default([]);
const settings = z.object({ units: z.enum(['METRIC', 'IMPERIAL']).optional(), currency: z.enum(['INR']).optional(), calendar: text(40).optional(), workingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(), holidaysFrom: text(20).optional(), costCodeTemplate: text(40).optional(), wbsTemplate: text(40).optional(), approvalOverrides: z.array(text(200)).max(20).optional(), enabledModules: z.array(text(30)).max(40).optional(), budgetRequired: z.boolean().optional(), planningRequired: z.boolean().optional() }).strict();
const site = z.object({ code: text(30).min(1, 'Give the site code'), name: text(160).min(1, 'Give the site name'), siteType: z.enum(['SITE', 'CAMP', 'STORE', 'PLANT', 'OFFICE']).default('SITE'), address: optText(400), latitude: z.number().min(-90).max(90).nullish(), longitude: z.number().min(-180).max(180).nullish(), geofenceType: z.enum(['NONE', 'CIRCLE', 'POLYGON']).default('NONE'), geofenceRadiusM: z.number().int().min(10).max(50000).nullish(), geofencePolygon: z.array(z.object({ lat: z.number(), lng: z.number() })).max(100).nullish() }).strict();
const milestone = z.object({ code: text(30).min(1, 'Give the code'), name: text(200).min(1, 'Give the name'), plannedDate: day, contractual: z.boolean().default(false), paymentLinked: z.boolean().default(false) }).strict();
const contract = z.object({ clientPartnerId: id, consultantPartnerId: optId, funderPartnerId: optId, contractType: z.enum(keys(CONTRACT_TYPES)).default('ITEM_RATE'), contractNo: optText(60), contractValue: money.default('0'), startDate: optDay, scheduledCompletion: optDay, dlpMonths: z.number().int().min(0).max(120).default(0), retentionPct: pct.default('0'), mobAdvancePct: pct.default('0'), ldSummary: optText(2000) }).strict();
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseWizard = (b) => parse(z.object({
  tenderId: optId,
  basics: z.object({ code: text(30).min(2, 'Give the project code'), name: text(160).min(3, 'Give the project name'), type: z.enum(['BUILDING', 'ROAD', 'BRIDGE', 'INDUSTRIAL', 'EPC', 'WATER', 'RAIL', 'OTHER']), sector: z.enum(keys(Object.fromEntries(SECTORS.map((s) => [s, 1])))).nullish().transform((v) => v || null), location: optText(200), branchId: optId }).strict(),
  contract, sites: z.array(site).max(30).default([]), team: z.object({ pmUser: optText(60), directorUser: optText(60) }).strict().default({ pmUser: null, directorUser: null }),
  setup: z.object({ numbering: z.array(text(30)).max(40).optional(), folderTemplate: optText(40).optional(), settings: settings.optional() }).strict().default({}), milestones: z.array(milestone).max(100).default([]), submit: z.boolean().default(false), ticked,
}).strict(), b);
export const parseUpdate = (b) => parse(z.object({ name: text(160).min(3).optional(), sector: z.enum(keys(Object.fromEntries(SECTORS.map((s) => [s, 1])))).nullish().optional(), location: optText(200).optional(), clientPartnerId: id.optional(), consultantPartnerId: optId.optional(), funderPartnerId: optId.optional(), contractType: z.enum(keys(CONTRACT_TYPES)).optional(), contractNo: optText(60).optional(), contractValue: money.optional(), startDate: optDay.optional(), scheduledCompletion: optDay.optional(), revisedCompletion: optDay.optional(), dlpMonths: z.number().int().min(0).max(120).optional(), retentionPct: pct.optional(), mobAdvancePct: pct.optional(), ldSummary: optText(2000).optional(), pmUser: optText(60).optional(), directorUser: optText(60).optional(), settings: settings.optional(), version }).strict(), b);
export const parseSubmit = (b) => parse(z.object({ ticked }).strict(), b ?? {});
export const parseTransition = (b) => parse(z.object({ to: z.enum(keys(STATES)), ticked, reason: optText(1000), version: version.optional() }).strict(), b);
export const parseAmend = (b) => parse(z.object({ reason, changes: z.object({ contractValue: money.optional(), contractType: z.enum(keys(CONTRACT_TYPES)).optional(), contractNo: optText(60).optional(), startDate: day.optional(), scheduledCompletion: day.optional(), revisedCompletion: day.optional(), dlpMonths: z.number().int().min(0).max(120).optional(), retentionPct: pct.optional(), mobAdvancePct: pct.optional(), clientPartnerId: id.optional() }).strict() }).strict(), b);
export const parseMilestone = (b) => parse(milestone, b);
export const parseMilestoneUpdate = (b) => parse(z.object({ name: text(200).min(1).optional(), plannedDate: day.optional(), contractual: z.boolean().optional(), paymentLinked: z.boolean().optional(), status: z.enum(['PLANNED', 'ACHIEVED', 'WAIVED']).optional(), actualDate: optDay.optional(), version }).strict(), b);
export const parsePrefill = (q) => parse(z.object({ tenderId: id }).strict(), q);

// ---- Part 10.02: project from an awarded tender and the commercial baseline pack ----
const clause = z.object({ title: text(160).min(1, 'Give the clause title'), summary: text(2000).min(1, 'Give the summary'), ref: optText(60) }).strict();
const person = z.object({ name: text(120).min(1, 'Give the name'), user: optText(60), role: optText(80), team: z.enum(['ESTIMATION', 'EXECUTION', 'COMMERCIAL', 'OTHER']).default('OTHER') }).strict();
const question = z.object({ text: text(1000).min(1, 'Give the question'), askedBy: optText(120), answer: optText(2000) }).strict();
const action = z.object({ title: text(200).min(1, 'Give the action'), owner: text(60).min(1, 'Choose who does it'), dueDate: day, priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'), taskId: optId, taskStatus: z.string().nullish() }).strict();
const meeting = z.object({ meetingDate: day, venue: optText(200), attendees: z.array(person).min(1, 'Name at least one attendee').max(60), questions: z.array(question).max(100).default([]), minutes: optText(10000), actions: z.array(action).max(100).default([]) }).strict();
const awardContract = z.object({ consultantPartnerId: optId, funderPartnerId: optId, startDate: optDay, scheduledCompletion: optDay, dlpMonths: z.number().int().min(0).max(120).default(0), retentionPct: pct.default('0'), mobAdvancePct: pct.default('0'), ldSummary: optText(2000) }).strict().default({ dlpMonths: 0, retentionPct: '0', mobAdvancePct: '0' });
export const parseFromAward = (b) => parse(z.object({
  tenderId: id,
  basics: z.object({ code: text(30).min(2, 'Give the project code').optional(), name: text(160).min(3).optional(), type: z.enum(['BUILDING', 'ROAD', 'BRIDGE', 'INDUSTRIAL', 'EPC', 'WATER', 'RAIL', 'OTHER']), sector: z.enum(keys(Object.fromEntries(SECTORS.map((s) => [s, 1])))).nullish().transform((v) => v || null), location: optText(200).optional(), branchId: optId }).strict(),
  contract: awardContract, sites: z.array(site).max(30).default([]), team: z.object({ pmUser: optText(60), directorUser: optText(60) }).strict().default({ pmUser: null, directorUser: null }),
  setup: z.object({ numbering: z.array(text(30)).max(40).optional(), folderTemplate: optText(40).optional(), settings: settings.optional() }).strict().default({}), milestones: z.array(milestone).max(100).default([]), clauses: z.array(clause).max(60).default([]),
}).strict(), b);
export const parsePackCreate = (b) => parse(z.object({ projectId: id, clauses: z.array(clause).max(60).default([]) }).strict(), b);
export const parsePackUpdate = (b) => parse(z.object({ clauses: z.array(clause).max(60), version: version.optional() }).strict(), b);
export const parsePackAmend = (b) => parse(z.object({ reason }).strict(), b);
export const parsePackFormat = (q) => parse(z.object({ format: z.enum(['html', 'pdf', 'xlsx', 'csv']).default('html') }).strict(), q ?? {});
export const parseMeeting = (b) => parse(meeting, b);
export const parseMeetingUpdate = (b) => parse(meeting.partial().extend({ version: version.optional() }).strict(), b);
export const parseProjectQuery = (q) => parse(z.object({ projectId: id }).strict(), q);
