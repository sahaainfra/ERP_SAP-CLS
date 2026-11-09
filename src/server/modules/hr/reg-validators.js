import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the attendance register API (part 07.06). The services check the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a date and time such as 2026-12-01T09:00');
const text = (max) => z.string().trim().max(max);
const optLocal = local.nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});

const common = { employeeId: id, workDate: day, arrears: z.boolean().default(false) };
export const parseRegCreate = (b) => parse(z.object({ ...common, requestedIn: optLocal, requestedOut: optLocal, reason, evidenceFileId: id.nullish().transform((v) => v ?? null), submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseRegUpdate = (b) => parse(z.object({ ...common, requestedIn: optLocal, requestedOut: optLocal, reason, evidenceFileId: id.nullish().transform((v) => v ?? null), version: z.number().int().min(1) }).strict(), b);
export const parseOtCreate = (b) => parse(z.object({ ...common, otType: z.enum(['PRE', 'POST']), minutes: z.number().int().min(15).max(720), reason, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseOtUpdate = (b) => parse(z.object({ ...common, otType: z.enum(['PRE', 'POST']), minutes: z.number().int().min(15).max(720), reason, version: z.number().int().min(1) }).strict(), b);
const entry = z.enum(['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_DUTY', 'COMP_OFF']);
export const parseManualCreate = (b) => parse(z.object({ ...common, entryStatus: entry, inTime: optLocal, outTime: optLocal, reason, evidenceFileId: id.nullish().transform((v) => v ?? null), submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseManualUpdate = (b) => parse(z.object({ ...common, entryStatus: entry, inTime: optLocal, outTime: optLocal, reason, evidenceFileId: id.nullish().transform((v) => v ?? null), version: z.number().int().min(1) }).strict(), b);

export const parseRegisterQuery = (q) => parse(z.object({ period: day.optional(), siteId: id.optional(), departmentId: id.optional(), crewId: id.optional() }).strict(), clean(q));
export const parseMusterQuery = (q) => parse(z.object({ period: day.optional(), siteId: id.optional(), crewId: id.optional() }).strict(), clean(q));
export const parseDayQuery = (q) => parse(z.object({ employeeId: id, date: day }).strict(), clean(q));
export const parseRecompute = (b) => parse(z.object({ from: day, to: day, siteId: id.optional(), employeeId: id.optional(), cascade: z.boolean().default(true) }).strict().refine((v) => v.siteId || v.employeeId, { message: 'Name a site or an employee', path: ['siteId'] }), b);
export const parseLockStatus = (q) => parse(z.object({ period: day.optional(), siteId: id.optional() }).strict(), clean(q));
export const parseLock = (b) => parse(z.object({ period: day.optional(), siteId: id.optional() }).strict(), b ?? {});
export const parsePeriodLock = (b) => parse(z.object({ siteId: id.optional() }).strict(), b ?? {});
export const parsePeriodReopen = (b) => parse(z.object({ siteId: id.optional(), reason, comment: text(500).optional() }).strict(), b);
export const parseReopen = (b) => parse(z.object({ reason, comment: text(500).optional() }).strict(), b);
export const parseArrearsQuery = (q) => parse(z.object({ periodStart: day.optional(), status: z.enum(['OPEN', 'FOLDED']).optional() }).strict(), clean(q));
export const parseBulk = (b) => parse(z.object({ taskIds: z.array(id).min(1).max(100), decision: z.enum(['APPROVE', 'REJECT', 'RETURN']), comment: text(500).optional() }).strict().refine((v) => v.decision === 'APPROVE' || (v.comment && v.comment.length >= 5), { message: 'Say why (at least 5 characters)', path: ['comment'] }), b);
