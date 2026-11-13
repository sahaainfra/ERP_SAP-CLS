import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the quality API (part 18.01). The service checks every rule again.
export const id = z.coerce.number().int().min(1);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
export const text = (max) => z.string().trim().max(max);
export const opt = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
export const num = z.number().finite().min(-1e9).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
export const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
export { z, parse };
const MODULES = ['QUALITY', 'HSE', 'PLANT', 'STORES', 'HANDOVER', 'SNAG'];
const ACTS = ['EXCAVATION', 'PCC', 'RCC', 'MASONRY', 'PLASTER', 'WATERPROOFING', 'MEP', 'ROAD', 'OTHER'];
const POINTS = ['HOLD', 'WITNESS', 'REVIEW', 'SURVEILLANCE'];
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const parseFileAttach = (b) => parse(z.object({ fileId: id }).strict(), b ?? {});
export const parseExportQ = (q) => parse(z.object({ kind: z.enum(['inspections', 'itps']).optional() }).passthrough(), q ?? {});
// quality plan
export const parsePlanCreate = (b) => parse(z.object({ projectId: id, title: text(200).min(3), summary: opt(4000) }).strict(), b ?? {});
export const parsePlanUpdate = (b) => defined(parse(z.object({ title: text(200).min(3).optional(), summary: opt(4000).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
// ITP
const step = z.object({ code: text(30).min(1), seq: z.number().int().min(1).max(999), description: text(500).min(3), pointType: z.enum(POINTS), criteria: text(500).default(''), standardRef: text(120).default(''), frequency: text(120).default(''), responsibility: text(60).default('CONTRACTOR'), records: z.array(text(80)).max(10).default([]) }).strict();
export const parseItpCreate = (b) => parse(z.object({ code: text(40).min(2), title: text(200).min(3), activityType: z.enum(ACTS), projectId: id.nullish().transform((v) => v ?? null), standardRef: opt(200), steps: z.array(step).min(1).max(100) }).strict(), b ?? {});
export const parseItpUpdate = (b) => defined(parse(z.object({ title: text(200).min(3).optional(), activityType: z.enum(ACTS).optional(), standardRef: opt(200).optional(), steps: z.array(step).min(1).max(100).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseItpApply = (b) => parse(z.object({ projectId: id, activityIds: z.array(id).min(1).max(200), locationIds: z.array(id).max(50).optional() }).strict(), b ?? {});
export const parseItpImport = (b) => parse(z.object({ rows: z.array(z.object({ itpCode: text(40), title: text(200), activityType: z.enum(ACTS), standardRef: opt(200), stepCode: text(30), seq: z.number().int().optional(), description: text(500), pointType: z.enum(POINTS), criteria: text(500).optional(), stepStandard: text(120).optional(), frequency: text(120).optional(), responsibility: text(60).optional(), records: z.array(text(80)).optional() }).strict()).min(1).max(1000) }).strict(), b ?? {});
export const parsePlannedQ = (q) => parse(z.object({ projectId: id.optional(), itpId: id.optional(), activityId: id.optional() }).passthrough(), q ?? {});
// checklist template
const question = z.object({ code: text(30).min(1), text: text(400).min(2), type: z.enum(['YESNO', 'NUMERIC', 'TEXT', 'PHOTO', 'SIGNATURE']), required: z.boolean().optional(), weight: z.number().int().min(1).max(100).optional(), critical: z.boolean().optional(), autoFail: z.boolean().optional(), photoRequired: z.boolean().optional(), failOn: z.enum(['YES', 'NO']).optional(), unit: opt(20), target: z.number().finite().optional(), tolPlus: z.number().finite().min(0).optional(), tolMinus: z.number().finite().min(0).optional(), min: z.number().finite().optional(), max: z.number().finite().optional(), textHi: opt(400) }).strict();
const section = z.object({ code: text(30).min(1), title: text(200).min(1), questions: z.array(question).max(200) }).strict();
const scoring = z.object({ passPct: z.number().min(0).max(100).optional(), consultantSignature: z.boolean().optional() }).strict();
export const parseTemplateCreate = (b) => parse(z.object({ code: text(40).min(2), name: text(200).min(3), module: z.enum(MODULES), sections: z.array(section).max(50), scoring: scoring.optional() }).strict(), b ?? {});
export const parseTemplateUpdate = (b) => defined(parse(z.object({ name: text(200).min(3).optional(), module: z.enum(MODULES).optional(), sections: z.array(section).max(50).optional(), scoring: scoring.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseTemplatePreview = (b) => parse(z.object({ sections: z.array(section).max(50), scoring: scoring.optional(), answers: z.array(z.object({ questionCode: text(30), answer: z.enum(['YES', 'NO', 'NA']).nullish(), numValue: z.number().finite().nullish(), textValue: opt(2000), photoCount: z.number().int().min(0).max(50).optional() }).strict()).max(500).optional() }).strict(), b ?? {});
export const parseModuleQ = (q) => parse(z.object({ module: z.enum(MODULES).optional() }).passthrough(), q ?? {});
// inspection
const answer = z.object({ questionCode: text(30), answer: z.enum(['YES', 'NO', 'NA']).nullish(), numValue: z.number().finite().nullish(), textValue: opt(2000), photoFileIds: z.array(id).max(20).optional(), remark: opt(500) }).strict();
const signature = z.object({ role: z.enum(['INSPECTOR', 'CONTRACTOR', 'CONSULTANT', 'CLIENT']), name: text(120).min(2), fileId: id.nullish().transform((v) => v ?? null) }).strict();
export const parseInspectionCreate = (b) => parse(z.object({ templateId: id, projectId: id, siteId: id.nullish().transform((v) => v ?? null), locationId: id.nullish().transform((v) => v ?? null), activityId: id.nullish().transform((v) => v ?? null), waId: id.nullish().transform((v) => v ?? null), plannedPointId: id.nullish().transform((v) => v ?? null), itpStepCode: opt(30), entityType: opt(40), entityId: opt(60), subject: opt(300), inspectedAt: z.string().max(40).optional(), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(), clientRef: opt(80), answers: z.array(answer).max(500).default([]), signatures: z.array(signature).max(6).optional(), submit: z.boolean().optional() }).strict(), b ?? {});
export const parseInspectionUpdate = (b) => defined(parse(z.object({ subject: opt(300).optional(), answers: z.array(answer).max(500).optional(), signatures: z.array(signature).max(6).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parsePhoto = (b) => parse(z.object({ questionCode: text(30), fileId: id }).strict(), b ?? {});
export const parseSign = (b) => parse(signature, b ?? {});
export const parseInspectionImport = (b) => ({ rows: parse(z.object({ rows: z.array(z.any()).min(1).max(500) }).strict(), b ?? {}).rows.map((x) => parseInspectionCreate(x)) });
