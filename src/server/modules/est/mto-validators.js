import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { DISCIPLINES } from './mto.js';

// Inputs of the take-off and BBS API (part 09.02). The service measures, bends and weighs every line again on the server; a quantity sent for a measured line is ignored.
const keys = (o) => /** @type {[string, ...string[]]} */ (Object.keys(o));
const id = z.coerce.number().int().min(1);
const dec = (max = 1e9) => z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/, 'Give a number of zero or more')]).transform((v) => String(v)).refine((v) => Number(v) >= 0 && Number(v) <= max, 'The number is too large');
const optDec = (max) => dec(max).nullish().or(z.literal('').transform(() => null));
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const version = z.number().int().min(1);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const optId = id.nullish().transform((v) => v || null);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseRevise = (b) => parse(z.object({ reason: optText(1000), drawingRev: optText(20) }).strict(), b ?? {});
export const parseAmendRevise = (b) => parse(z.object({ reason, drawingRev: optText(20) }).strict(), b ?? {});
export const parseTakeoffCreate = (b) => parse(z.object({ kind: z.enum(['TAKEOFF', 'ENGINEERING']).default('TAKEOFF'), discipline: z.enum(keys(DISCIPLINES)).default('CIVIL'), title: text(200).min(3, 'Give a title'), projectId: optId, tenderId: optId, estimateId: optId, drawingRef: text(60).min(1, 'Give the drawing number'), drawingRev: optText(20) }).strict(), b);
export const parseTakeoffUpdate = (b) => parse(z.object({ title: text(200).min(3).optional(), discipline: z.enum(keys(DISCIPLINES)).optional(), drawingRef: text(60).min(1).optional(), drawingRev: optText(20).optional(), estimateId: optId.optional(), version }).strict(), b);
const tline = z.object({ id: id.optional(), boqItemRef: optText(40), description: text(1000).min(1, 'Describe the line'), location: optText(200), template: text(30).min(1, 'Choose the template'), workItemId: optId, materialItemId: optId, spec: optText(500), nos: dec(1e6).default('1'), length: optDec(1e6), breadth: optDec(1e6), height: optDec(1e6), deduction: dec(1e9).default('0'), quantity: optDec(1e9), uom: optText(20) }).strict();
export const parseTakeoffLines = (b) => parse(z.object({ lines: z.array(tline).max(5000), version }).strict(), b);
export const parseApply = (b) => parse(z.object({ estimateId: optId }).strict(), b ?? {});
export const parseDelta = (q) => parse(z.object({ with: id.optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
export const parseBbsCreate = (b) => parse(z.object({ title: text(200).min(3, 'Give a title'), projectId: optId, drawingRef: text(60).min(1, 'Give the drawing number'), drawingRev: optText(20), member: text(120).min(1, 'Give the member') }).strict(), b);
export const parseBbsUpdate = (b) => parse(z.object({ title: text(200).min(3).optional(), member: text(120).min(1).optional(), drawingRef: text(60).min(1).optional(), drawingRev: optText(20).optional(), version }).strict(), b);
const bline = z.object({ id: id.optional(), member: optText(120), barMark: text(20).min(1, 'Give the bar mark'), dia: z.coerce.number().int(), shapeCode: text(10).min(1, 'Choose the shape'), a: optDec(100), b: optDec(100), c: optDec(100), d: optDec(100), membersCount: z.coerce.number().int().min(1).default(1), barsEach: z.coerce.number().int().min(1, 'At least one bar') }).strict();
export const parseBbsLines = (b) => parse(z.object({ lines: z.array(bline).max(5000), version }).strict(), b);
export const parseSummary = (q) => parse(z.object({ projectId: id.optional(), bbsId: id.optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
