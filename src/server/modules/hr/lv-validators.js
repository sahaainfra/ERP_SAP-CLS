import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the leave API (part 07.07). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
const half = z.enum(['NONE', 'FIRST', 'SECOND']).default('NONE');
const optId = id.nullish().transform((v) => v ?? null);
const optText = (n) => z.string().trim().max(n).nullish().transform((v) => v || null);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
const body = { employeeId: id, leaveTypeId: id, fromDate: day, toDate: day, halfDay: half, reason, attachmentFileId: optId, delegateUser: optText(60) };
export const parseAppCreate = (b) => parse(z.object({ ...body, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseAppUpdate = (b) => parse(z.object({ ...body, version: z.number().int().min(1) }).omit({ employeeId: true }).strict(), b);
export const parseCheck = (q) => parse(z.object({ employeeId: id, leaveTypeId: id, fromDate: day, toDate: day, halfDay: half, attachmentFileId: optId }).strict(), clean(q));
export const parseBalanceQuery = (q) => parse(z.object({ employeeId: id.optional(), year: z.coerce.number().int().min(2000).max(2100).optional(), typeId: id.optional() }).strict(), clean(q));
export const parseTypeOptions = (q) => parse(z.object({ employeeId: id.optional() }).strict(), clean(q));
const rules = z.object({
  quota: z.number().min(0).max(366), accrual: z.enum(['NONE', 'ANNUAL', 'QUARTERLY', 'MONTHLY']), proRata: z.boolean().default(true), carryForwardMax: z.number().min(0).max(366).default(0), encashable: z.boolean().default(false),
  encashMax: z.number().min(0).max(366).nullish().transform((v) => v ?? null), minServiceDays: z.number().int().min(0).max(3650).default(0), maxConsecutive: z.number().min(0.5).max(366).nullish().transform((v) => v ?? null),
  documentAfterDays: z.number().min(0).max(366).nullish().transform((v) => v ?? null), sandwich: z.boolean().default(false), allowHalfDay: z.boolean().default(true), advanceMax: z.number().min(0).max(366).default(0), special: z.boolean().default(false),
  genders: z.array(z.enum(['MALE', 'FEMALE', 'OTHER'])).default([]), categories: z.array(z.enum(['PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT'])).default([]), expiryDays: z.number().int().min(1).max(3650).nullish().transform((v) => v ?? null),
}).strict();
export const parseTypeCreate = (b) => parse(z.object({ code: z.string().trim().min(2).max(10).regex(/^[A-Za-z0-9_]+$/, 'Letters, digits and underscores'), name: text(80).min(2), paid: z.boolean().default(true), rules, status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'), sortOrder: z.number().int().min(0).max(1000).optional() }).strict(), b);
export const parseTypeUpdate = (b) => parse(z.object({ name: text(80).min(2), paid: z.boolean(), rules, status: z.enum(['ACTIVE', 'INACTIVE']), sortOrder: z.number().int().min(0).max(1000).optional(), version: z.number().int().min(1) }).strict(), b);
export const parseAdjust = (b) => parse(z.object({ employeeId: id, leaveTypeId: id, year: z.number().int().min(2000).max(2100), days: z.number().min(-366).max(366).refine((v) => v !== 0, 'Not zero'), reason, submit: z.boolean().default(false) }).strict(), b);
export const parseCalendar = (q) => parse(z.object({ from: day, to: day, siteId: id.optional(), departmentId: id.optional() }).strict(), clean(q));
export const parseAccrual = (b) => parse(z.object({ from: day, to: day }).strict(), b);
export const parseYear = (q) => parse(z.object({ year: z.coerce.number().int().min(2000).max(2100) }).strict(), clean(q));
export const parseYearRun = (b) => parse(z.object({ year: z.number().int().min(2000).max(2100) }).strict(), b);
export const parseBulk = (b) => parse(z.object({ taskIds: z.array(id).min(1).max(100), decision: z.enum(['APPROVE', 'REJECT', 'RETURN']), comment: text(500).optional() }).strict().refine((v) => v.decision === 'APPROVE' || (v.comment && v.comment.length >= 5), { message: 'Say why (at least 5 characters)', path: ['comment'] }), b);
