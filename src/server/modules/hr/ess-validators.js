import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the self-service API (part 07.09).
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
export const parseMonth = (q) => parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-12').optional() }).strict(), clean(q));
export const parseTeamQuery = (q) => parse(z.object({ date: day.optional() }).strict(), clean(q));
const letter = { letterType: z.enum(['EMPLOYMENT', 'SALARY', 'NOC']), purpose: text(300).min(5, 'Say what the letter is for (at least 5 characters)'), addressedTo: z.string().trim().max(150).nullish().transform((v) => v || null) };
export const parseLetterCreate = (b) => parse(z.object({ ...letter, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseLetterUpdate = (b) => parse(z.object({ ...letter, version: z.number().int().min(1) }).strict(), b);
export const parseLetterQuery = (q) => parse(z.object({ scope: z.enum(['mine', 'all']).optional() }).strict(), clean(q));
export const parseIssue = (b) => parse(z.object({ salaryMonthly: z.number().positive().max(100_000_000).optional() }).strict(), b ?? {});
