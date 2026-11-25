import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the closeout API (module M26). The services check every rule again.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const opt = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v ?? null);
export const parseId = (v) => parse(id, v);

// 26.01 commissioning
const DISCIPLINES = ['GENERAL', 'CIVIL', 'MECHANICAL', 'ELECTRICAL', 'INSTRUMENTATION', 'PIPING', 'HVAC', 'FIRE', 'PLUMBING'];
const CLASS = z.enum(['A', 'B', 'C']);
const sheet = z.object({ sheetClass: CLASS, title: text(200).min(3) }).strict();
export const parseTncQ = (q) => parse(z.object({ projectId: id.optional(), stage: z.enum(['CONSTRUCTION', 'MC', 'RFC', 'RFSU']).optional(), status: z.string().max(20).optional(), kind: z.enum(['MC', 'RFC', 'RFSU']).optional() }).passthrough(), q ?? {});
export const parseSystemCreate = (b) => parse(z.object({ projectId: id, siteId: optId, parentId: optId, code: text(40).min(1).regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits and . _ / - only'), name: text(200).min(3), discipline: z.enum(DISCIPLINES).default('GENERAL') }).strict(), b ?? {});
export const parseTagCreate = (b) => parse(z.object({ tagNo: text(60).min(1), description: text(300).min(3), sheets: z.array(sheet).max(20).default([]) }).strict(), b ?? {});
export const parseSheetCreate = (b) => parse(sheet, b ?? {});
export const parseSheetRecord = (b) => parse(z.object({ result: z.enum(['PASSED', 'FAILED']), note: opt(1000), inspectionId: optId }).strict().refine((v) => v.result === 'PASSED' || (v.note ?? '').length >= 5, { message: 'Say what failed (at least 5 characters)', path: ['note'] }), b ?? {});
export const parsePackCreate = (b) => parse(z.object({ packType: z.enum(['HYDROTEST', 'PNEUMATIC', 'LOOP_CHECK', 'INSULATION', 'FUNCTION', 'PERFORMANCE', 'OTHER']), procedureRef: text(120).min(2) }).strict(), b ?? {});
export const parsePackRecord = (b) => parse(z.object({ result: z.enum(['PASSED', 'FAILED']), witnessedBy: text(120).min(2), witnessParty: opt(120), testedOn: day, note: opt(1000), evidenceFileId: optId }).strict(), b ?? {});
export const parsePunchLink = (b) => parse(z.object({ snagId: id }).strict(), b ?? {});
export const parseCertRequest = (b) => parse(z.object({ kind: z.enum(['MC', 'RFC', 'RFSU']) }).strict(), b ?? {});
export const parseClientSign = (b) => parse(z.object({ signatory: text(120).min(2), signedOn: day, fileId: id }).strict(), b ?? {});

// 26.02 handover
const CATEGORIES = ['AS_BUILT', 'OM_MANUAL', 'WARRANTY', 'STATUTORY', 'SPARES', 'TRAINING', 'TEST_CERTIFICATE', 'COMMISSIONING', 'SNAGS', 'KEYS', 'OTHER'];
export const parseHoQ = (q) => parse(z.object({ projectId: id.optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED']).optional(), handoverId: id.optional() }).passthrough(), q ?? {});
export const parseHandoverCreate = (b) => parse(z.object({ projectId: id, siteId: optId, locationId: optId, title: text(200).min(3), scopeType: z.enum(['PROJECT', 'AREA']).default('PROJECT'), areaLabel: opt(200), plannedOn: day.nullish().transform((v) => v ?? null), dlpMonths: z.number().int().min(0).max(120).default(12) }).strict(), b ?? {});
export const parseItemCreate = (b) => parse(z.object({ category: z.enum(CATEGORIES), title: text(200).min(3), mandatory: z.boolean().default(true) }).strict(), b ?? {});
export const parseItemRecord = (b) => parse(z.object({ status: z.enum(['OPEN', 'DONE', 'NOT_APPLICABLE']), fileId: optId, docRevisionId: optId, certificateId: optId, note: opt(1000), rowVersion: z.number().int().optional() }).strict(), b ?? {});
export const parseAssetCreate = (b) => parse(z.object({ tagNo: text(60).min(1), description: text(300).min(3), category: z.enum(['EQUIPMENT', 'SYSTEM', 'FIXTURE', 'STRUCTURE', 'OTHER']).default('EQUIPMENT'), systemId: optId, location: opt(200), make: opt(120), model: opt(120), serialNo: opt(120), capacity: opt(120), warrantyUntil: day.nullish().transform((v) => v ?? null), maintenance: opt(1000) }).strict(), b ?? {});
export const parseHandoverSign = (b) => parse(z.object({ signatory: text(120).min(2), signedOn: day, effectiveOn: day.nullish().transform((v) => v ?? null), fileId: id }).strict(), b ?? {});
export const parseReason = (b) => parse(z.object({ reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});

// 26.03 defects liability
export const parseDlpQ = (q) => parse(z.object({ projectId: id.optional(), status: z.string().max(30).optional(), overdue: z.enum(['1', 'true']).optional().transform((v) => (v ? true : null)) }).passthrough(), q ?? {});
export const parsePeriodOpen = (b) => parse(z.object({ handoverId: id }).strict(), b ?? {});
export const parseComplaintCreate = (b) => parse(z.object({ reportedOn: day, reportedBy: text(120).min(2), source: z.enum(['CLIENT', 'INTERNAL']).default('CLIENT'), location: opt(200), description: text(1000).min(5), severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']).default('MINOR'), assetId: optId }).strict(), b ?? {});
export const parseComplaintAssign = (b) => parse(z.object({ responsibleType: z.enum(['OWN_CREW', 'SUBCONTRACTOR', 'SUPPLIER']), partnerId: optId }).strict(), b ?? {});
export const parseComplaintRectify = (b) => parse(z.object({ note: text(1000).min(5), fileId: id }).strict(), b ?? {});
export const parseComplaintVerify = (b) => parse(z.object({ accept: z.boolean(), note: opt(1000), recovery: z.number().min(0).max(1e9).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals').optional() }).strict().refine((v) => v.accept || (v.note ?? '').length >= 5, { message: 'Say what is still wrong (at least 5 characters)', path: ['note'] }), b ?? {});
export const parseClaimCreate = (b) => parse(z.object({ assetId: id, complaintId: optId, partnerId: optId, claimedOn: day, description: text(1000).min(5) }).strict(), b ?? {});
export const parseClaimUpdate = (b) => parse(z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'RESOLVED']), note: opt(1000) }).strict(), b ?? {});

// 26.04 closeout, lessons and benchmarks
const LESSON_CATS = ['DESIGN', 'PROCUREMENT', 'EXECUTION', 'QUALITY', 'SAFETY', 'COMMERCIAL', 'CONTRACT', 'PLANNING', 'OTHER'];
const money = z.number().min(0).max(1e12).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
export const parseClsQ = (q) => parse(z.object({ projectId: id.optional(), status: z.string().max(20).optional() }).passthrough(), q ?? {});
export const parseClosureCreate = (b) => parse(z.object({ projectId: id }).strict(), b ?? {});
export const parseClosureUpdate = (b) => parse(z.object({ finalAccount: money.nullable().optional(), agreedOn: day.nullish(), fileId: optId, snapshotId: id.nullable().optional(), summary: opt(4000).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {});
export const parseClosureItem = (b) => parse(z.object({ status: z.enum(['OPEN', 'DONE', 'NOT_APPLICABLE']), fileId: optId, note: opt(1000) }).strict(), b ?? {});
export const parseBenchmark = (b) => parse(z.object({ metricCode: text(40).min(2).regex(/^[A-Z0-9_]+$/, 'Capital letters, digits and _ only'), label: text(120).min(2), unit: text(20).min(1), value: z.number().finite().min(-1e9).max(1e9), basis: opt(500) }).strict(), b ?? {});
export const parseLessonQ = (q) => parse(z.object({ q: z.string().trim().max(100).optional(), category: z.enum(LESSON_CATS).optional(), projectId: id.optional(), mine: z.enum(['1', 'true']).optional() }).passthrough(), q ?? {});
export const parseLessonCreate = (b) => parse(z.object({ projectId: optId, title: text(200).min(5), category: z.enum(LESSON_CATS), impact: z.enum(['POSITIVE', 'NEGATIVE']).default('NEGATIVE'), whatHappened: text(4000).min(10), recommendation: text(4000).min(10), tags: opt(200) }).strict(), b ?? {});
export const parseBenchmarkQ = (q) => parse(z.object({ metricCode: z.string().max(40).optional() }).passthrough(), q ?? {});
