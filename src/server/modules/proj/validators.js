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

// ---- Part 10.03: the project structure ----
const optPct = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Give a percentage')]).transform((x) => String(x));
const wbsFields = { code: optText(40).optional(), name: text(200).min(1, 'Give the name'), weight: optPct.optional(), discipline: optText(30).optional(), responsibleUser: optText(60).optional(), isControlAccount: z.boolean().optional(), description: optText(2000).optional() };
export const parseWbsCreate = (b) => parse(z.object({ parentId: optId, ...wbsFields }).strict(), b);
export const parseWbsUpdate = (b) => parse(z.object({ code: text(40).min(1).optional(), name: text(200).min(1).optional(), weight: optPct.optional(), discipline: optText(30).optional(), responsibleUser: optText(60).optional(), isControlAccount: z.boolean().optional(), description: optText(2000).optional(), version: version.optional() }).strict(), b);
export const parseWbsMove = (b) => parse(z.object({ parentId: optId, beforeId: optId }).strict(), b);
export const parseWbsBulk = (b) => parse(z.object({ ids: z.array(id).min(1).max(500), set: z.object({ discipline: optText(30).optional(), responsibleUser: optText(60).optional(), isControlAccount: z.boolean().optional() }).strict().refine((o) => Object.keys(o).length > 0, 'Give at least one field') }).strict(), b);
export const parseWbsNormalise = (b) => parse(z.object({ parentId: optId.optional() }).strict(), b ?? {});
export const parseWbsTemplate = (b) => parse(z.object({ template: text(40).min(1, 'Choose a template'), parentId: optId }).strict(), b);
export const parseWbsCopy = (b) => parse(z.object({ sourceProjectId: id, includeLocations: z.boolean().default(false), includeWorkPackages: z.boolean().default(false) }).strict(), b);
export const parseWbsBaseline = (b) => parse(z.object({ reason: optText(1000) }).strict(), b ?? {});
export const parseWbsFormat = (q) => parse(z.object({ projectId: id, format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx') }).strict(), q);
const op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), parentId: z.union([id, text(40)]).nullish(), ...wbsFields }).strict(),
  z.object({ op: z.literal('update'), id: z.union([id, text(40)]), fields: z.object({ code: text(40).min(1).optional(), name: text(200).min(1).optional(), weight: optPct.optional(), discipline: optText(30).optional(), responsibleUser: optText(60).optional(), isControlAccount: z.boolean().optional(), description: optText(2000).optional() }).strict() }).strict(),
  z.object({ op: z.literal('move'), id: z.union([id, text(40)]), parentId: z.union([id, text(40)]).nullish(), beforeId: optId }).strict(),
  z.object({ op: z.literal('deactivate'), id: id }).strict(), z.object({ op: z.literal('activate'), id: id }).strict(), z.object({ op: z.literal('delete'), id: id }).strict(),
  z.object({ op: z.literal('weights'), weights: z.array(z.object({ id: z.union([id, text(40)]), weight: optPct }).strict()).min(1).max(200) }).strict(),
]);
export const parseWbsChange = (b) => parse(z.object({ reason, ops: z.array(op).min(1, 'Give at least one operation').max(200) }).strict(), b);
const locFields = { type: z.enum(['BLOCK', 'BUILDING', 'FLOOR', 'ZONE', 'ROOM', 'CHAINAGE', 'STRUCTURE']), code: text(40).min(1, 'Give the code'), name: text(200).min(1, 'Give the name'), chainageFrom: z.number().int().min(0).nullish(), chainageTo: z.number().int().min(0).nullish(), lat: z.number().nullish(), lng: z.number().nullish(), description: optText(2000).optional() };
export const parseLocCreate = (b) => parse(z.object({ parentId: optId, ...locFields }).strict(), b);
export const parseLocUpdate = (b) => parse(z.object({ type: locFields.type.optional(), code: text(40).min(1).optional(), name: text(200).min(1).optional(), chainageFrom: locFields.chainageFrom, chainageTo: locFields.chainageTo, lat: locFields.lat, lng: locFields.lng, description: locFields.description, version: version.optional() }).strict(), b);
export const parseLocMove = (b) => parse(z.object({ parentId: optId }).strict(), b);
export const parseMatrix = (b) => parse(z.object({ cells: z.array(z.object({ wbsId: id, locationId: id, on: z.boolean() }).strict()).min(1).max(2000) }).strict(), b);
export const parseWp = (b) => parse(z.object({ code: text(40).min(1, 'Give the code'), name: text(200).min(1, 'Give the name'), type: z.enum(['SELF', 'SUBCONTRACT', 'PROCUREMENT']), wbsIds: z.array(id).max(500).default([]), ownerUser: optText(60), description: optText(2000).optional() }).strict(), b);
export const parseWpUpdate = (b) => parse(z.object({ code: text(40).min(1).optional(), name: text(200).min(1).optional(), type: z.enum(['SELF', 'SUBCONTRACT', 'PROCUREMENT']).optional(), wbsIds: z.array(id).max(500).optional(), ownerUser: optText(60).optional(), description: optText(2000).optional(), status: z.enum(['ACTIVE', 'INACTIVE', 'CLOSED']).optional(), version: version.optional() }).strict(), b);
export const parseWpCreate = (b) => parse(z.object({ projectId: id, code: text(40).min(1, 'Give the code'), name: text(200).min(1, 'Give the name'), type: z.enum(['SELF', 'SUBCONTRACT', 'PROCUREMENT']), wbsIds: z.array(id).max(500).default([]), ownerUser: optText(60), description: optText(2000).optional() }).strict(), b);

// ---- Part 10.04: BOQ versions, lines, mapping, norms, import ----
const decStr = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/, 'Give a number')]).transform((v) => String(v));
const lineBase = { kind: z.enum(['BILL', 'SECTION', 'ITEM', 'SUBITEM']), itemCode: text(60).min(1, 'Give the item code'), description: text(4000).min(1, 'Give the description'), uom: optText(20), qty: decStr.optional(), rate: decStr.optional(), isExtra: z.boolean().optional(), workItemId: optId.optional(), analysisId: optId.optional(), costCodeId: optId.optional() };
export const parseVersionCreate = (b) => parse(z.object({ projectId: id, vtype: z.enum(['TENDER', 'CONTRACT']), name: text(200).min(1, 'Give the name'), from: z.enum(['AWARD', 'VERSION', 'EMPTY']).default('EMPTY'), sourceVersionId: optId.optional(), sourceRef: optText(200).optional() }).strict(), b);
export const parseRevised = (b) => parse(z.object({ projectId: id, variationRef: text(60).min(1, 'Give the approved variation'), name: text(200).optional() }).strict(), b);
export const parseVersionUpdate = (b) => parse(z.object({ name: text(200).min(1).optional(), sourceRef: optText(200).optional(), version: version.optional() }).strict(), b);
export const parseLineCreate = (b) => parse(z.object({ parentId: optId.optional(), ...lineBase }).strict(), b);
export const parseLineUpdate = (b) => parse(z.object({ itemCode: lineBase.itemCode.optional(), description: lineBase.description.optional(), uom: lineBase.uom.optional(), qty: decStr.optional(), rate: decStr.optional(), isExtra: z.boolean().optional(), workItemId: optId.optional(), analysisId: optId.optional(), costCodeId: optId.optional(), version: version.optional() }).strict(), b);
export const parseSplits = (b) => parse(z.object({ splits: z.array(z.object({ wbsId: id, locationId: optId.optional(), qty: decStr }).strict()).max(200) }).strict(), b);
export const parseBulkMap = (b) => parse(z.object({ lineIds: z.array(id).min(1).max(2000), wbsId: id, locationId: optId.optional() }).strict(), b);
const norm = z.object({ type: z.enum(['MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER']), resourceItemId: optId.optional(), description: text(300).min(1, 'Describe the resource'), uom: text(20).min(1, 'Give the unit'), qtyPerUnit: decStr, wastagePct: decStr.optional() }).strict();
export const parseNorms = (b) => parse(z.object({ norms: z.array(norm).max(100) }).strict(), b);
export const parseBoqAmend = (b) => parse(z.object({ reason, ops: z.array(z.union([z.object({ lineId: id, splits: z.array(z.object({ wbsId: id, locationId: optId.optional(), qty: decStr }).strict()).max(200) }).strict(), z.object({ lineId: id, norms: z.array(norm).max(100) }).strict()])).min(1).max(500) }).strict(), b);
const importRow = z.object({ row: z.number().int().min(1).optional(), bill: z.any().optional(), section: z.any().optional(), itemCode: z.any(), description: z.any(), uom: z.any().optional(), qty: z.any().optional(), rate: z.any().optional(), parentCode: z.any().optional(), extra: z.any().optional() }).strict();
export const parseBoqImport = (b) => parse(z.object({ projectId: id, vtype: z.enum(['TENDER', 'CONTRACT']).default('TENDER'), name: text(200).optional(), rows: z.array(importRow).max(300).default([]), stageId: text(40).optional(), columns: z.array(z.object({ key: text(30), header: text(120) }).strict()).max(30).optional(), commit: z.boolean().default(false), intoVersionId: optId.optional() }).strict(), b);
export const parseCompare = (q) => parse(z.object({ a: id, b: id }).strict(), q);
export const parseUnmapped = (q) => parse(z.object({ unmapped: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') }).strict(), q ?? {});
export const parseVersionQuery = (q) => parse(z.object({ versionId: id }).strict(), q);
export const parseBoqStage = (b) => parse(z.object({ projectId: id, stageId: text(40).optional(), rows: z.array(importRow).min(1, 'Give at least one row').max(300) }).strict(), b);

// ---- Part 10.05: team, stakeholders, communication matrix, meetings, actions ----
const user60 = text(60).min(1, 'Choose a person');
const level = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const parseTeamAdd = (b) => parse(z.object({ projectId: id, username: user60, projectRole: text(40).min(1, 'Choose the project role'), fromDate: day, toDate: optDay.optional(), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000) }).strict(), b);
export const parseTeamEnd = (b) => parse(z.object({ reason, toDate: optDay.optional() }).strict(), b);
export const parseProjectIdQuery = (q) => parse(z.object({ projectId: id, format: z.enum(['xlsx', 'csv', 'pdf']).optional() }).strict(), q);
const stk = { skind: z.enum(['CLIENT', 'CONSULTANT', 'AUTHORITY', 'FUNDER', 'SUBCONTRACTOR', 'SUPPLIER', 'COMMUNITY', 'OTHER']), organisation: text(200).min(1, 'Give the organisation'), name: text(160).min(1, 'Give the name'), roleTitle: optText(120), influence: level.default('MEDIUM'), interest: level.default('MEDIUM'), email: z.string().trim().email('Give a valid e-mail').max(160).nullish().transform((v) => v || null), phone: optText(30), partnerId: optId, notes: optText(2000) };
export const parseStakeholder = (b) => parse(z.object({ projectId: id, ...stk }).strict(), b);
export const parseStakeholderUpdate = (b) => parse(z.object({ skind: stk.skind.optional(), organisation: stk.organisation.optional(), name: stk.name.optional(), roleTitle: stk.roleTitle.optional(), influence: level.optional(), interest: level.optional(), email: stk.email.optional(), phone: stk.phone.optional(), notes: stk.notes.optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), version: version.optional() }).strict(), b);
const comm = { info: text(300).min(1, 'Say what is reported'), stakeholderId: optId, audience: optText(160), frequency: z.enum(['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ON_EVENT']), channel: z.enum(['EMAIL', 'MEETING', 'PORTAL', 'REPORT', 'LETTER', 'PHONE']), ownerUser: optText(60), notes: optText(1000) };
export const parseComm = (b) => parse(z.object({ projectId: id, ...comm }).strict(), b);
export const parseCommUpdate = (b) => parse(z.object({ info: comm.info.optional(), stakeholderId: optId.optional(), audience: comm.audience.optional(), frequency: comm.frequency.optional(), channel: comm.channel.optional(), ownerUser: comm.ownerUser.optional(), notes: comm.notes.optional(), version: version.optional() }).strict(), b);
const attendee = z.object({ kind: z.enum(['INTERNAL', 'EXTERNAL']), user: optText(60), stakeholderId: optId, name: text(160).min(1, 'Give the name'), organisation: optText(200), present: z.boolean().default(true) }).strict();
const agendaItem = z.object({ title: text(300).min(1, 'Give the item'), notes: optText(2000) }).strict();
const decision = z.object({ text: text(1000).min(1, 'Give the decision') }).strict();
const maction = z.object({ description: text(1000).min(1, 'Describe the action'), ownerUser: user60, dueDate: day, priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM') }).strict();
const mfields = { mtype: z.enum(['KICKOFF', 'WEEKLY_PROGRESS', 'COORDINATION', 'SAFETY', 'CLIENT_REVIEW', 'OTHER']), title: text(200).min(1, 'Give the title'), meetingDate: day, startTime: optText(5), location: optText(200), chairUser: user60, minuteTaker: user60, attendees: z.array(attendee).max(80).default([]), agenda: z.array(agendaItem).max(60).default([]), minutes: optText(20000), decisions: z.array(decision).max(100).default([]), actions: z.array(maction).max(100).default([]) };
export const parseMtgCreate = (b) => parse(z.object({ projectId: id, ...mfields }).strict(), b);
export const parseMtgUpdate = (b) => parse(z.object({ mtype: mfields.mtype.optional(), title: mfields.title.optional(), meetingDate: day.optional(), startTime: mfields.startTime.optional(), location: mfields.location.optional(), chairUser: user60.optional(), minuteTaker: user60.optional(), attendees: z.array(attendee).max(80).optional(), agenda: z.array(agendaItem).max(60).optional(), minutes: mfields.minutes.optional(), decisions: z.array(decision).max(100).optional(), actions: z.array(maction).max(100).optional(), version: version.optional() }).strict(), b);
export const parseMtgRevise = (b) => parse(z.object({ reason }).strict(), b);
export const parseActionUpdate = (b) => parse(z.object({ status: z.enum(['IN_PROGRESS', 'BLOCKED', 'DONE']), note: optText(500) }).strict(), b);
export const parseActionQuery = (q) => parse(z.object({ projectId: id.optional(), mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') }).strict(), q ?? {});

// ---- Part 10.06: risks, opportunities and issues ----
const score15 = z.number().int().min(1, 'Choose 1 to 5').max(5, 'Choose 1 to 5');
const raction = z.object({ description: text(1000).min(1, 'Describe the action'), ownerUser: user60, dueDate: day }).strict();
const rtrigger = z.object({ name: text(160).min(1, 'Name the indicator'), indicator: optText(300), comparator: z.enum(['GTE', 'GT', 'LTE', 'LT']), threshold: z.number().int().min(-1e12).max(1e12), unit: optText(30) }).strict();
const rfields = {
  rtype: z.enum(['RISK', 'OPPORTUNITY']).default('RISK'), title: text(200).min(3, 'Give the title'), description: optText(3000), cause: optText(2000), effect: optText(2000),
  category: z.enum(['TECHNICAL', 'COMMERCIAL', 'CONTRACTUAL', 'SAFETY', 'ENVIRONMENTAL', 'FINANCIAL', 'STATUTORY']), wbsId: optId, costCodeId: optId, activityRef: optText(120), clauseRef: optText(120), ownerUser: user60,
  probability: score15, impactCost: score15.default(1), impactTime: score15.default(1), impactQuality: score15.default(1), impactSafety: score15.default(1),
  strategy: z.enum(['AVOID', 'MITIGATE', 'TRANSFER', 'ACCEPT', 'EXPLOIT', 'ENHANCE', 'SHARE']).default('MITIGATE'), residualProbability: score15.nullish().transform((v) => v ?? null), residualImpact: score15.nullish().transform((v) => v ?? null),
  exposureCost: z.object({ min: money, mostLikely: money, max: money }).strict().default({ min: '0', mostLikely: '0', max: '0' }), exposureDays: z.object({ min: z.number().int().min(0).max(36500), mostLikely: z.number().int().min(0).max(36500), max: z.number().int().min(0).max(36500) }).strict().default({ min: 0, mostLikely: 0, max: 0 }),
  actions: z.array(raction).max(30).default([]), triggers: z.array(rtrigger).max(20).default([]), remarks: optText(1000),
};
export const parseRiskCreate = (b) => parse(z.object({ projectId: id, ...rfields }).strict(), b);
const given = (out, b) => Object.fromEntries(Object.entries(out).filter(([k]) => b && Object.hasOwn(b, k)));
export const parseRiskUpdate = (b) => given(parse(z.object({ ...Object.fromEntries(Object.entries(rfields).filter(([k]) => !['rtype', 'actions', 'triggers'].includes(k)).map(([k, v]) => [k, v.optional()])), actions: rfields.actions.optional(), triggers: rfields.triggers.optional(), rowVersion: version.optional() }).strict(), b), b);
export const parseRiskClose = (b) => parse(z.object({ reason: z.string().trim().min(10, 'Give the justification (at least 10 characters)').max(1000), occurred: z.boolean().default(false) }).strict(), b ?? {});
export const parseReading = (b) => parse(z.object({ value: z.number().int().min(-1e12).max(1e12), note: optText(300) }).strict(), b);
export const parseContingency = (b) => parse(z.object({ kind: z.enum(['ALLOCATION', 'DRAWDOWN']), amount: money, reason }).strict(), b);
export const parseRiskSettings = (b) => parse(z.object({ projectId: id, contingencyPool: money.optional(), thresholds: z.object({ medium: z.number().int().min(2).max(24), high: z.number().int().min(3).max(25), critical: z.number().int().min(4).max(25), probabilityPct: z.array(z.number().min(0).max(100)).length(5).optional() }).strict().optional() }).strict(), b);
const ifields = { title: text(200).min(3, 'Give the title'), description: optText(3000), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'), ownerUser: user60, dueDate: optDay, wbsId: optId, riskId: optId, impactCost: money.default('0'), impactTime: z.number().int().min(0).max(36500).default(0), impactText: optText(1000) };
export const parseIssueCreate = (b) => parse(z.object({ projectId: id, ...ifields }).strict(), b);
export const parseIssueUpdate = (b) => given(parse(z.object({ ...Object.fromEntries(Object.entries(ifields).map(([k, v]) => [k, v.optional()])), status: z.enum(['OPEN', 'IN_PROGRESS']).optional() }).strict(), b), b);
export const parseIssueResolve = (b) => parse(z.object({ resolution: z.string().trim().min(10, 'Say how it was resolved (at least 10 characters)').max(2000) }).strict(), b);
export const parseReviewCreate = (b) => parse(z.object({ projectId: id, period: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-11'), notes: optText(3000) }).strict(), b);
export const parseReviewUpdate = (b) => parse(z.object({ notes: optText(3000) }).strict(), b);

// ---- Part 10.07: GIS ----
const styleSchema = z.object({ color: text(20).optional(), weight: z.number().min(1).max(12).optional(), fillOpacity: z.number().min(0).max(1).optional(), dashArray: text(20).optional() }).strict();
const geo = z.object({}).passthrough();
const layerFields = { name: text(120).min(2, 'Give the name'), ltype: z.enum(['BOUNDARY', 'ALIGNMENT', 'WORK_FRONT', 'STORE', 'CAMP', 'EQUIPMENT', 'CUSTOM']), geojson: geo, style: styleSchema.default({}), visibleRoles: z.array(text(20)).max(40).default([]) };
export const parseLayerCreate = (b) => parse(z.object({ projectId: id, ...layerFields }).strict(), b);
export const parseLayerUpdate = (b) => given(parse(z.object({ name: layerFields.name.optional(), ltype: layerFields.ltype.optional(), geojson: geo.optional(), style: styleSchema.optional(), visibleRoles: layerFields.visibleRoles.optional(), rowVersion: version.optional() }).strict(), b), b);
export const parseLayerImport = (b) => parse(z.object({ projectId: id, name: layerFields.name, ltype: layerFields.ltype, format: z.enum(['geojson', 'kml']), content: z.string().min(2).max(45000), style: styleSchema.default({}), visibleRoles: layerFields.visibleRoles }).strict(), b);
const bounds = z.tuple([z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]), z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])]);
const imageUrl = z.string().trim().max(45000).regex(/^(https?:\/\/|\/api\/|data:image\/(png|jpeg|webp|gif);base64,)/i, 'Use an https address, an /api/ path or a small embedded image');
const ovFields = { name: text(120).min(2, 'Give the name'), imageUrl, fileId: optId, bounds, opacity: z.number().int().min(5).max(100).default(70) };
export const parseOverlayCreate = (b) => parse(z.object({ projectId: id, ...ovFields }).strict(), b);
export const parseOverlayUpdate = (b) => given(parse(z.object({ name: ovFields.name.optional(), imageUrl: imageUrl.optional(), fileId: optId.optional(), bounds: bounds.optional(), opacity: ovFields.opacity.optional(), rowVersion: version.optional() }).strict(), b), b);
export const parseGisProject = (q) => parse(z.object({ projectId: id, activity: text(80).optional(), format: z.string().optional(), days: z.coerce.number().int().min(1).max(90).optional() }).strict(), q ?? {});
export const parseProgress = (b) => parse(z.object({ projectId: id, locationId: id, activity: text(80).min(2, 'Name the activity'), pct: z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/, 'Give a percentage')]).transform((v) => String(v)).refine((v) => Number(v) >= 0 && Number(v) <= 100, 'A percentage from 0 to 100'), asOf: day }).strict(), b);

// ---- Part 10.08: Project 360 ----
export const parseP360 = (q) => parse(z.object({ projectId: id, period: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-11').optional(), format: z.string().optional() }).strict(), q ?? {});
export const parsePortfolio = (q) => parse(z.object({ q: z.string().trim().max(80).optional(), health: z.enum(['RED', 'AMBER', 'GREEN', 'NONE']).optional() }).strict(), q ?? {});
