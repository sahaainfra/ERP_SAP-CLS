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
