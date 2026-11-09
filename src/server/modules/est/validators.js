import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { BASES, COMPONENT_TYPES, INDIRECTS, MODES } from './constants.js';

// Inputs of the estimate API (part 09.01). Numbers travel as decimal text or numbers; the service checks the rules again and works out every amount on the server (a total sent by a client is never stored).
const keys = (o) => /** @type {[string, ...string[]]} */ (Object.keys(o));
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const dec = (max = 1e12) => z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'Give a number')]).transform((v) => String(v)).refine((v) => Number(v) >= 0 && Number(v) <= max, 'Give a number of zero or more');
const pct = dec(1000);
const optDec = (max) => dec(max).nullish().or(z.literal('').transform(() => null));
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const version = z.number().int().min(1);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const head = { title: text(200).min(3).optional(), basisDate: day.optional(), region: optText(10).optional(), currency: z.enum(['INR']).optional(), hoOverheadPct: pct.optional(), contingencyPct: pct.optional(), escalationPct: pct.optional(), gstPct: pct.optional() };
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseOptReason = (b) => parse(z.object({ reason: optText(1000) }).strict(), b ?? {});
export const parseCreate = (b) => parse(z.object({ ...head, tenderId: id.nullish().transform((v) => v || null), projectId: id.nullish().transform((v) => v || null) }).strict(), b);
export const parseUpdate = (b) => parse(z.object({ ...head, version }).strict(), b);
const component = z.object({ type: z.enum(keys(COMPONENT_TYPES)).default('MATERIAL'), itemId: id.nullish().transform((v) => v || null), description: optText(300), uom: optText(20), qty: dec(1e9), rate: optDec(1e12) }).strict();
const item = z.object({
  id: id.optional(), sectionCode: text(40).min(1, 'Give the section'), sectionName: optText(200), itemNo: text(40).min(1, 'Give the item number'), description: text(2000).min(1, 'Describe the item'), uom: text(20).min(1, 'Give the unit'), qty: dec(1e9), clientRate: optDec(1e12),
  workItemId: id.nullish().transform((v) => v || null), mode: z.enum(keys(MODES)).default('RATE'), analysisId: id.nullish().transform((v) => v || null), costRate: optDec(1e12), markupPct: pct.default('0'), notes: optText(1000), components: z.array(component).max(60).default([]),
}).strict();
export const parseItems = (b) => parse(z.object({ items: z.array(item).max(5000), version }).strict(), b);
const boqRow = z.object({ sectionCode: z.any(), sectionName: z.any().optional(), itemNo: z.any(), description: z.any(), uom: z.any(), qty: z.any(), clientRate: z.any().optional() }).passthrough();
export const parseBoq = (b) => parse(z.object({ rows: z.array(boqRow).min(1, 'Paste at least one row').max(5000), commit: z.boolean().default(false), replace: z.boolean().default(false), version }).strict(), b);
const indirect = z.object({ category: z.enum(keys(INDIRECTS)), description: text(300).min(1, 'Describe it'), basis: z.enum(keys(BASES)), qty: optDec(1e9), rate: optDec(1e12), percent: optDec(100), amount: optDec(1e12) }).strict();
export const parseIndirects = (b) => parse(z.object({ lines: z.array(indirect).max(200), version }).strict(), b);
const risk = z.object({ description: text(300).min(1, 'Describe the risk'), impact: dec(1e12), probabilityPct: dec(100) }).strict();
export const parseRisks = (b) => parse(z.object({ lines: z.array(risk).max(200), version }).strict(), b);
export const parseReprice = (b) => parse(z.object({ itemIds: z.array(id).max(5000).optional(), version }).strict(), b);
export const parseCompare = (q) => parse(z.object({ with: id }).strict(), q);
export const parseResources = (q) => parse(z.object({ type: z.enum(keys(COMPONENT_TYPES)).optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
