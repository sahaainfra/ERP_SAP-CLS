import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the master data governance API (part 06.01). The service checks the rules again (formats, duplicates, rights); these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const type = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'Name a master, for example PARTNER');
const why = z.string().trim().min(10, 'Say why (at least 10 characters)').max(500);
const data = z.record(z.string().max(40), z.union([z.string().max(400), z.null()])).refine((d) => Object.keys(d).length <= 40, 'Too many fields');
export const parseId = (v) => parse(id, v);
export const parseType = (v) => parse(type, v);
export const parseRecordList = (q) => parse(z.object({ q: text(80).optional(), status: z.enum(['SUBMITTED', 'ACTIVE', 'INACTIVE', 'MERGED', 'REJECTED']).optional(), maxScore: z.coerce.number().int().min(0).max(100).optional(), asOf: date.optional(), sort: z.enum(['code', 'name', 'score', 'changed']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseAsOf = (q) => parse(z.object({ asOf: date.optional() }).strict(), q);
export const parseLookup = (q) => parse(z.object({ q: text(80).optional() }).strict(), q);
export const parseCheck = (b) => parse(z.object({ data, recordId: id.optional() }).strict(), b);
export const parseCreate = (b) => parse(z.object({ data, justification: why, effectiveFrom: date.optional(), acknowledgeDuplicates: z.boolean().default(false) }).strict(), b);
export const parseUpdate = (b) => parse(z.object({ data, justification: z.string().trim().max(500).optional().transform((v) => v || undefined), effectiveFrom: date.optional(), version: z.number().int().min(1) }).strict(), b);
export const parseStatus = (b) => parse(z.object({ action: z.enum(['INACTIVATE', 'REACTIVATE']), justification: why, effectiveFrom: date.optional() }).strict(), b);
export const parseRequestList = (q) => parse(z.object({ view: z.enum(['mine', 'review', 'all']).default('mine'), status: z.enum(['PENDING', 'RETURNED', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED']).optional(), type: type.optional() }).strict(), q);
export const parseCancel = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parseResubmit = (b) => parse(z.object({ data: data.optional(), justification: why.optional() }).strict(), b ?? {});
export const parseDuplicateList = (q) => parse(z.object({ type: type.optional(), status: z.enum(['OPEN', 'NOT_DUPLICATE', 'MERGE_PENDING', 'MERGED']).optional(), minScore: z.coerce.number().int().min(0).max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseDismiss = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why they are different (at least 5 characters)').max(300) }).strict(), b);
export const parseMerge = (b) => parse(z.object({ type, fromId: id, toId: id, justification: why }).strict(), b);
export const parseScan = (b) => parse(z.object({ type }).strict(), b);
export const parseQuality = (q) => parse(z.object({ type: type.optional() }).strict(), q);
const rule = z.object({ masterType: type, field: z.string().trim().max(40).min(1), rule: z.enum(['REQUIRED', 'FORMAT', 'STALE']), param: z.string().trim().max(40).nullable().optional(), severity: z.enum(['ERROR', 'WARNING', 'INFO']), active: z.boolean().default(true) }).strict();
const steward = z.object({ masterType: type, username: z.string().trim().min(1).max(60), role: z.enum(['PRIMARY', 'BACKUP']).default('PRIMARY') }).strict();
export const parseConfig = (b) => parse(z.object({ rules: z.array(rule).max(300), stewards: z.array(steward).min(1, 'Name at least one steward').max(100), reason: why }).strict(), b);

// ---- part 06.02: the common masters ----
const master = z.enum(['uom', 'gst-rates', 'hsn-sac', 'tds-sections', 'states', 'districts', 'currencies', 'exchange-rates', 'banks', 'payment-terms', 'lookup-lists', 'lookups']);
const value = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.object({ label: z.string().max(80), pct: z.union([z.number(), z.string().max(12)]), days: z.union([z.number(), z.string().max(6)]) })).max(20)]);
const cdata = z.record(z.string().max(40), value).refine((d) => Object.keys(d).length <= 20, 'Too many fields');
export const parseMaster = (v) => parse(master, v);
export const parseCommonList = (q) => parse(z.object({ q: text(80).optional(), asOf: date.optional(), status: z.enum(['current', 'all', 'pending']).optional(), key: text(40).optional(),
  category: z.string().max(10).optional(), codeType: z.enum(['HSN', 'SAC']).optional(), taxKind: z.enum(['TDS', 'TCS']).optional(), stateCode: z.string().max(3).optional(), currencyCode: z.string().max(3).optional(), termKind: z.enum(['PAYMENT', 'DELIVERY', 'INCOTERM']).optional(), listCode: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseCommonCreate = (b) => parse(z.object({ data: cdata, effectiveFrom: date.optional(), justification: z.string().trim().max(500).optional() }).strict(), b);
export const parseCommonUpdate = (b) => parse(z.object({ data: cdata, effectiveFrom: date.optional(), justification: z.string().trim().max(500).optional(), version: z.number().int().min(1) }).strict(), b);
export const parseCommonRetire = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300), version: z.number().int().min(1) }).strict(), b);
export const parseGstQuery = (q) => parse(z.object({ code: z.string().trim().toUpperCase().max(12).optional(), hsn: z.string().trim().max(8).optional(), date: date.optional() }).strict().refine((v) => v.code || v.hsn, 'Give a GST rate code or an HSN/SAC code'), q);
export const parseTdsQuery = (q) => parse(z.object({ section: z.string().trim().max(12), date: date.optional() }).strict(), q);
export const parseFxQuery = (q) => parse(z.object({ currency: z.string().trim().toUpperCase().length(3), date: date.optional() }).strict(), q);
export const parseConvert = (q) => parse(z.object({ quantity: z.string().trim().regex(/^\d+(\.\d+)?$/, 'A quantity such as 12.5'), from: z.string().trim().toUpperCase().max(10), to: z.string().trim().toUpperCase().max(10) }).strict(), q);
export const parseListCode = (v) => parse(z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{1,29}$/, 'A list code such as PRIORITY'), v);
export const parseListValues = (q) => parse(z.object({ all: z.enum(['true', 'false']).optional(), lang: z.enum(['en', 'hi']).optional() }).strict(), q);
export const parseListSave = (b) => parse(z.object({ values: z.array(z.object({ code: z.string().trim().min(1).max(30), labelEn: z.string().trim().min(1).max(80), labelHi: z.string().trim().max(80).nullable().optional(), sortOrder: z.number().int().min(0).max(9999).optional(), active: z.boolean().optional() }).strict()).max(300), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
