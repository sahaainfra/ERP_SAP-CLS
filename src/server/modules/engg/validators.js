import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the drawing control API (part 11.01). The service checks the rules again (the project, the links, the revisions, the rank of a status code).
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v || null);
const optDay = day.nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const version = z.number().int().min(1);
const user60 = text(60).min(1, 'Choose a person');
const given = (out, b) => Object.fromEntries(Object.entries(out).filter(([k]) => b && Object.hasOwn(b, k)));
const CODE = z.enum(['IFR', 'IFA', 'IFC', 'ASBUILT']);
const link = z.object({ type: z.enum(['WBS', 'LOCATION', 'BOQ', 'ACTIVITY']), targetId: optId, ref: text(120).min(1, 'Name the target') }).strict();
const rev = z.object({ label: text(10).min(1, 'Give the revision, such as A or 0'), statusCode: CODE, issuePurpose: optText(200), changeNote: optText(2000), cloudSummary: optText(2000), receivedOn: optDay, fileId: optId }).strict();
const dfields = {
  drawingNo: text(60).min(2, 'Give the drawing number'), title: text(200).min(3, 'Give the title'), discipline: z.enum(['ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE']), packageName: optText(80), wbsId: optId, locationId: optId, scale: optText(20),
  sheetSize: z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'OTHER']).nullish().transform((v) => v || null), originatorType: z.enum(['CONSULTANT', 'IN_HOUSE', 'VENDOR']).default('CONSULTANT'), originator: optText(120), documentId: optId, plannedReceipt: optDay, links: z.array(link).max(40).default([]),
};
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseDrawingCreate = (b) => parse(z.object({ projectId: id, ...dfields, revision: rev }).strict(), b);
export const parseDrawingUpdate = (b) => given(parse(z.object({ title: dfields.title.optional(), discipline: dfields.discipline.optional(), packageName: dfields.packageName.optional(), wbsId: dfields.wbsId.optional(), locationId: dfields.locationId.optional(), scale: dfields.scale.optional(), sheetSize: dfields.sheetSize.optional(), originatorType: dfields.originatorType.optional(), originator: dfields.originator.optional(), documentId: dfields.documentId.optional(), plannedReceipt: dfields.plannedReceipt.optional(), links: dfields.links.optional(), rowVersion: version.optional() }).strict(), b), b);
export const parseRevisionUpdate = (b) => given(parse(z.object({ label: rev.shape.label.optional(), statusCode: CODE.optional(), issuePurpose: rev.shape.issuePurpose.optional(), changeNote: rev.shape.changeNote.optional(), cloudSummary: rev.shape.cloudSummary.optional(), receivedOn: rev.shape.receivedOn.optional(), fileId: rev.shape.fileId.optional(), rowVersion: version.optional() }).strict(), b), b);
export const parseAmend = (b) => parse(z.object({ label: text(10).min(1, 'Give the new revision, such as B or 1'), statusCode: CODE, changeNote: text(2000).min(5, 'Say what changed'), cloudSummary: optText(2000), issuePurpose: optText(200), receivedOn: optDay }).strict(), b);
export const parseImport = (b) => parse(z.object({ projectId: id, rows: z.array(z.object({ ...dfields, revision: rev }).strict()).min(1, 'Give at least one row').max(150) }).strict(), b);
export const parseDistribute = (b) => parse(z.object({ revisionId: id, holders: z.array(z.object({ user: user60, siteId: optId, copies: z.number().int().min(1).max(20).default(1) }).strict()).min(1, 'Name at least one holder').max(60) }).strict(), b);
export const parseCompare = (q) => parse(z.object({ from: id, to: id }).strict(), q ?? {});
export const parseCheck = (q) => parse(z.object({ projectId: id, drawingNo: text(60).min(1), revision: text(10).min(1) }).strict(), q ?? {});
export const parseProject = (q) => parse(z.object({ projectId: id.optional(), format: z.string().optional() }).passthrough(), q ?? {});
const item = z.object({ drawingId: id, revisionId: id, copies: z.number().int().min(1).max(99).default(1) }).strict();
const tfields = { direction: z.enum(['OUT', 'IN']), party: text(160).min(2, 'Name the recipient or the sender'), contact: optText(160), purpose: z.enum(['FOR_APPROVAL', 'FOR_CONSTRUCTION', 'FOR_INFORMATION']), coverNote: optText(2000), dueOn: optDay, items: z.array(item).min(1, 'Pick at least one drawing').max(100) };
export const parseTransmittalCreate = (b) => parse(z.object({ projectId: id, ...tfields }).strict(), b);
export const parseTransmittalUpdate = (b) => given(parse(z.object({ party: tfields.party.optional(), contact: tfields.contact.optional(), purpose: tfields.purpose.optional(), coverNote: tfields.coverNote.optional(), dueOn: tfields.dueOn.optional(), items: tfields.items.optional(), rowVersion: version.optional() }).strict(), b), b);
export const parseResponses = (b) => parse(z.object({ responses: z.array(z.object({ itemId: id, code: z.enum(['A', 'B', 'C', 'D']), comments: optText(1000), date: optDay }).strict()).min(1, 'Give at least one response').max(100) }).strict(), b);

// ---- part 11.02: RFI management ----
const money = z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Write an amount in rupees such as 25000 or 25000.50');
const flag = z.boolean().default(false);
const rfiFields = {
  subject: text(200).min(3, 'Give the subject'), question: text(4000).min(10, 'Write the question (at least 10 characters)'), discipline: z.enum(['ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE']),
  siteId: optId, wbsId: optId, locationId: optId, activityRef: optText(120), activityCritical: flag, holdActivity: flag, boqItemId: optId, drawingId: optId, drawingRevisionId: optId, specRef: optText(200), proposedSolution: optText(2000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'), requiredBy: day, costImpactFlag: flag, timeImpactFlag: flag, consultant: optText(160),
};
export const parseRfiCreate = (b) => parse(z.object({ projectId: id, ...rfiFields }).strict(), b);
export const parseRfiUpdate = (b) => {
  const s = z.object(Object.fromEntries([...Object.entries(rfiFields).map(([k, v]) => [k, v.optional()]), ['rowVersion', version.optional()]])).strict();
  return given(parse(s, b), b);
};
export const parseRfiImport = (b) => parse(z.object({ projectId: id, rows: z.array(z.object(rfiFields).strict()).min(1, 'Give at least one row').max(150) }).strict(), b);
export const parseRfiRespond = (b) => parse(z.object({ responseType: z.enum(['CLARIFICATION', 'DESIGN_CHANGE', 'INSTRUCTION']), text: text(4000).min(5, 'Write the response'), costImpact: money.default('0'), timeImpactDays: z.number().int().min(0).max(3650).default(0), drawingRevisionId: optId, instructionRef: optText(120), variationRef: optText(120) }).strict(), b);
export const parseRfiClose = (b) => parse(z.object({ note: optText(1000) }).strict(), b ?? {});

// ---- part 11.03: submittals ----
const subFields = {
  type: z.enum(['MAR', 'METHOD_STATEMENT', 'SHOP_DRAWING', 'SAMPLE', 'MOCK_UP', 'PRODUCT_DATA', 'QUALITY_PLAN']), title: text(200).min(3, 'Give the title'), specSection: optText(120), activityRef: optText(120), wbsId: optId, itemId: optId, materialRef: optText(160), make: optText(120), model: optText(120), supplier: optText(160),
  drawingId: optId, hseRef: optText(120), consultant: optText(160), needDate: optDay, leadTimeDays: z.number().int().min(0).max(1000).default(0), reviewDays: z.number().int().min(0).max(365).default(14), requiredBy: optDay,
};
export const parseSubmittalCreate = (b) => parse(z.object({ projectId: id, ...subFields }).strict(), b);
export const parseSubmittalUpdate = (b) => given(parse(z.object(Object.fromEntries([...Object.entries(subFields).map(([k, v]) => [k, v.optional()]), ['rowVersion', version.optional()]])).strict(), b), b);
export const parseSubmittalImport = (b) => parse(z.object({ projectId: id, rows: z.array(z.object(subFields).strict()).min(1, 'Give at least one row').max(150) }).strict(), b);
export const parseSubmittalRespond = (b) => parse(z.object({ code: z.enum(['A', 'B', 'C', 'D']), text: optText(2000), responseOn: optDay }).strict(), b);
export const parsePoCheck = (q) => parse(z.object({ projectId: id, itemId: id.optional(), material: z.string().trim().max(160).optional(), make: z.string().trim().max(120).optional() }).strict(), q ?? {});
export const parseResubmit = (b) => parse(z.object({ changeNote: text(2000).min(5, 'Say what changed') }).strict(), b);

// ---- part 11.04: EPC deliverables and vendor document review ----
const DISC = z.enum(['ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE', 'PROCESS', 'PIPING', 'ELECTRICAL', 'INSTRUMENTATION', 'MECHANICAL']);
const delFields = {
  deliverableNo: text(60).min(2, 'Give the deliverable number'), title: text(200).min(3, 'Give the title'), discipline: DISC, type: z.enum(['DRAWING', 'CALCULATION', 'SPECIFICATION', 'DATA_SHEET', 'MTO', 'REPORT', 'OTHER']), packageName: optText(80),
  weight: z.number().int().min(1).max(1_000_000).default(100), planIfr: optDay, planIfa: optDay, planIfc: optDay, planAsbuilt: optDay, drawingId: optId, documentId: optId, ownerUser: optText(60),
};
export const parseDeliverableCreate = (b) => parse(z.object({ projectId: id, ...delFields }).strict(), b);
export const parseDeliverableUpdate = (b) => given(parse(z.object(Object.fromEntries([...Object.entries(delFields).map(([k, v]) => [k, v.optional()]), ['rowVersion', version.optional()]])).strict(), b), b);
export const parseDeliverableImport = (b) => parse(z.object({ projectId: id, rows: z.array(z.object(delFields).strict()).min(1, 'Give at least one row').max(300) }).strict(), b);
export const parseMilestone = (b) => parse(z.object({ milestone: z.enum(['IFR', 'IFA', 'ASBUILT']), date: optDay }).strict(), b);
export const parseRelease = (b) => parse(z.object({ note: optText(1000) }).strict(), b ?? {});
export const parseCommentAdd = (b) => parse(z.object({ revision: text(10).min(1, 'Name the revision'), comment: text(2000).min(5, 'Write the comment') }).strict(), b);
export const parseCommentRespond = (b) => parse(z.object({ response: text(2000).min(3, 'Write the response') }).strict(), b);
export const parseHoldRaise = (b) => parse(z.object({ deliverableId: id, description: text(2000).min(5, 'Say what the hold waits for'), impactProcurement: z.boolean().default(false), impactConstruction: z.boolean().default(false), poRef: optText(80), activityRef: optText(120) }).strict(), b);
export const parseHoldClear = (b) => parse(z.object({ note: text(1000).min(3, 'Say how the hold was cleared') }).strict(), b);
const vdrFields = { poRef: text(80).min(1, 'Name the purchase order'), vendor: text(160).min(2, 'Name the vendor'), docType: z.enum(['GA_DRAWING', 'DATA_SHEET', 'TEST_PROCEDURE', 'MANUAL', 'CALCULATION', 'CERTIFICATE', 'OTHER']), title: text(200).min(3, 'Give the title'), dueDate: day };
export const parseVdrCreate = (b) => parse(z.object({ projectId: id, ...vdrFields }).strict(), b);
export const parseVdrUpdate = (b) => given(parse(z.object(Object.fromEntries([...Object.entries(vdrFields).map(([k, v]) => [k, v.optional()]), ['rowVersion', version.optional()]])).strict(), b), b);
export const parseVdrImport = (b) => parse(z.object({ projectId: id, rows: z.array(z.object(vdrFields).strict()).min(1, 'Give at least one row').max(300) }).strict(), b);
export const parseVdrReceive = (b) => parse(z.object({ submittedOn: optDay }).strict(), b ?? {});
export const parseVdrReview = (b) => parse(z.object({ code: z.enum(['A', 'B', 'C', 'D']), text: optText(2000) }).strict(), b);
