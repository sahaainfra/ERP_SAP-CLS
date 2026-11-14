import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the billing API (part 22.01 on). The services check every rule again.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const opt = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const oid = id.nullish().transform((v) => v ?? null);
const nd = (f) => (f instanceof z.ZodDefault ? f.unwrap() : f);
const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
const dim = z.number().min(0).max(1e7).nullish().transform((v) => v ?? null);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-12');
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const TEMPLATES = ['QTY', 'NOS', 'LENGTH', 'AREA', 'VOLUME'];
const mbBase = { boqLineId: id, locationId: oid, waId: oid, activityId: oid, irId: oid, dprWorkId: oid, drawingId: oid, drawingRef: opt(120), description: text(1000).min(3, 'Describe what was measured'), template: z.enum(TEMPLATES).default('VOLUME'), nos: dim, length: dim, breadth: dim, depth: dim, deduction: z.number().min(0).max(1e10).default(0), qty: z.number().min(0).max(1e10).nullish().transform((v) => v ?? null), uom: opt(20), measuredOn: day, clientCheckRequired: z.boolean().nullish().transform((v) => v ?? null), value: z.number().optional() };
export const parseMbCreate = (b) => parse(z.object({ projectId: id, siteId: oid, ...mbBase }).strict(), b ?? {});
export const parseMbUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(mbBase).map(([k, v]) => [k, nd(v).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseMbCheck = (b) => parse(z.object({ checkedQty: z.number().min(0).max(1e10), checkPct: z.number().min(0).max(100).default(100), checkerName: text(120).min(2), checkerOrg: opt(160), checkedOn: day, signatureRef: opt(160), note: opt(500) }).strict(), b ?? {});
export const parseSuggestQ = (q) => parse(z.object({ projectId: id, boqLineId: id.optional(), activityId: id.optional() }).passthrough(), q ?? {});
export const parseAbstractQ = (q) => parse(z.object({ projectId: id, period: period.optional(), pageSize: z.coerce.number().int().min(1).max(500).optional() }).passthrough(), q ?? {});
export const parsePdfQ = (q) => parse(z.object({ projectId: id, book: id.optional(), from: day.optional(), to: day.optional() }).passthrough(), q ?? {});

// ---- part 22.02: quantity reconciliation, deviation statements, extra items ----
const pct = z.number().min(0).max(100);
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((x) => x === 'true')]).optional();
export const parseReconQ = (q) => parse(z.object({ projectId: id, by: z.enum(['item', 'location']).optional(), locationId: id.optional(), code: text(60).optional(), level: z.enum(['OK', 'APPROACHING', 'OVER', 'FORECAST_OVER']).optional(), deviatingOnly: bool }).passthrough(), q ?? {});
export const parseDetailQ = (q) => parse(z.object({ projectId: id, code: text(60).min(1) }).passthrough(), q ?? {});
export const parseForecast = (b) => parse(z.object({ projectId: id, boqLineId: id, forecastQty: z.number().min(0).max(1e10), basis: text(500).min(5, 'Say on what the forecast is based (at least 5 characters)') }).strict(), b ?? {});
export const parseCandQ = (q) => parse(z.object({ projectId: id, thresholdPct: z.coerce.number().min(0).max(100).optional() }).passthrough(), q ?? {});
const dsItem = z.object({ boqLineId: id, reason: text(500).min(5, 'Give the reason for the deviation (at least 5 characters)') }).strict();
const dsBase = { siteId: oid, contractId: oid, period, thresholdPct: pct.nullish().transform((v) => v ?? null), notes: opt(2000), items: z.array(dsItem).min(1, 'List at least one item').max(200) };
export const parseDsCreate = (b) => parse(z.object({ projectId: id, ...dsBase }).strict(), b ?? {});
export const parseDsUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(dsBase).filter(([k]) => k !== 'siteId').map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseDsSend = (b) => parse(z.object({ sentOn: day, clientRef: opt(120) }).strict(), b ?? {});
export const parseDsRespond = (b) => parse(z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']), respondedOn: day, clientRef: opt(120), outcome: z.enum(['VARIATION', 'RATE_REVISION']).optional() }).strict().refine((v) => v.decision !== 'ACCEPTED' || v.outcome, { message: 'Say whether the accepted deviation leads to a variation order or to a rate revision', path: ['outcome'] }), b ?? {});
const xiBase = { siteId: oid, kind: z.enum(['EXTRA', 'SUBSTITUTE']), description: text(500).min(3, 'Describe the item'), uom: text(20).min(1, 'Give the unit'), qty: z.number().gt(0).max(1e10), rate: z.number().min(0).max(1e9).default(0), substitutesBoqLineId: oid, reason: text(1000).min(5, 'Give the reason (at least 5 characters)'), instructionRef: opt(120), dsId: oid };
export const parseXiCreate = (b) => parse(z.object({ projectId: id, ...xiBase }).strict(), b ?? {});
export const parseXiUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(xiBase).filter(([k]) => k !== 'siteId').map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseXiDecide = (b) => parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), decidedOn: day, decisionRef: opt(120), note: opt(500) }).strict(), b ?? {});
export const parseImport = (b) => parse(z.object({ rows: z.array(z.record(z.string(), z.any())).max(500) }).passthrough(), b ?? {});
