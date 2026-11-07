import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { ASSUMPTION_KINDS, REVIEW_ITEMS } from './constants.js';

// Inputs of the review, bid price and priced BOQ API (part 09.03). The service works out every figure again; a price sent by a client is never taken.
const keys = (o) => /** @type {[string, ...string[]]} */ (Object.keys(o));
const id = z.coerce.number().int().min(1);
const pct = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/, 'Give a percentage')]).transform((v) => String(v)).refine((v) => Number(v) >= 0 && Number(v) <= 100, 'A percentage from 0 to 100');
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000) }).strict(), b ?? {});
export const parseDiscount = (b) => parse(z.object({ discountPct: pct, discountReason: z.string().trim().max(1000).nullish(), version: z.number().int().min(1).optional() }).strict(), b);
export const parseReview = (b) => parse(z.object({ checked: z.array(z.enum(/** @type {[string, ...string[]]} */ (REVIEW_ITEMS.map(([c]) => c)))).max(20).default([]), comments: z.string().trim().max(2000).nullish(), verdict: z.enum(['APPROVE', 'RETURN', 'NOTE']) }).strict(), b);
export const parseAssumptions = (b) => parse(z.object({ lines: z.array(z.object({ kind: z.enum(keys(ASSUMPTION_KINDS)), text: z.string().trim().min(3, 'Write at least 3 characters').max(1000) }).strict()).max(200), version: z.number().int().min(1).optional() }).strict(), b);
export const parseSensitivity = (q) => parse(z.object({ pct: z.coerce.number().min(-50).max(100).refine((v) => v !== 0, 'Give a change other than zero').default(10) }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
export const parseBoq = (q) => parse(z.object({ format: z.enum(['xlsx', 'pdf', 'csv', 'html']).default('xlsx'), words: z.enum(['true', 'false']).default('true').transform((v) => v === 'true') }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '')));
