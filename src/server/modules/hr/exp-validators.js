import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the expense API (part 07.12). The service computes and checks everything again (per diem, mileage, limits, flags, totals); these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-12');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v ?? null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const rupees = z.number().min(0).max(100_000_000);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
const CATS = ['TRAVEL', 'LODGING', 'FOOD', 'LOCAL_CONVEYANCE', 'SITE_PURCHASE', 'PER_DIEM', 'MILEAGE', 'OTHER'];
const line = z.object({
  category: z.enum(CATS), date: day, description: text(200).min(2), amount: rupees.nullish().transform((v) => v ?? null), gst: rupees.nullish().transform((v) => v ?? 0), vendorName: optText(120), vendorGstin: z.string().trim().toUpperCase().max(15).nullish().transform((v) => v || null),
  invoiceNo: optText(40), fileId: optId, costCodeId: optId, projectId: optId, km: z.number().int().min(1).max(100_000).nullish().transform((v) => v ?? null), days: z.number().int().min(1).max(366).nullish().transform((v) => v ?? null), justification: optText(500),
}).strict();
const claim = { periodFrom: day, periodTo: day, purpose: text(300).min(3), cityTier: z.enum(['T1', 'T2', 'T3']).default('T2'), travelRequestId: optId, advanceId: optId, lines: z.array(line).min(1, 'Add at least one line').max(100) };
export const parseClaimCreate = (b) => parse(z.object({ ...claim, submit: z.boolean().default(false) }).strict(), b);
export const parseClaimUpdate = (b) => parse(z.object({ ...claim, version: z.number().int().min(1) }).strict(), b);
export const parseClaimPreview = (b) => parse(z.object({ ...claim, id: id.optional() }).strict(), b);
export const parsePaid = (b) => parse(z.object({ reference: text(60).min(2, 'Give the payment reference') }).strict(), b);
const advance = { type: z.enum(['SALARY', 'TRAVEL', 'IMPREST']), amount: z.number().positive().max(100_000_000), purpose: text(300).min(3), instalments: z.number().int().min(1).max(36).default(1), travelRequestId: optId };
export const parseAdvanceCreate = (b) => parse(z.object({ ...advance, submit: z.boolean().default(false) }).strict(), b);
export const parseAdvanceUpdate = (b) => parse(z.object({ ...advance, version: z.number().int().min(1) }).strict(), b);
export const parseDisburse = (b) => parse(z.object({ reference: text(60).min(2, 'Give the payment reference'), date: day.optional() }).strict(), b);
export const parseDue = (q) => parse(z.object({ month }).strict(), clean(q));
export const parseRecover = (b) => parse(z.object({ amount: z.number().positive().max(100_000_000).optional(), reference: optText(60) }).strict(), b ?? {});
const travel = { purpose: text(300).min(3), fromPlace: text(80).min(2), toPlace: text(80).min(2), startDate: day, endDate: day, mode: z.enum(['TRAIN', 'BUS', 'FLIGHT', 'CAR', 'BIKE', 'SITE_VEHICLE', 'OTHER']), estCost: rupees, advance: rupees.default(0), projectId: optId };
export const parseTravelCreate = (b) => parse(z.object({ ...travel, submit: z.boolean().default(false) }).strict(), b);
export const parseTravelUpdate = (b) => parse(z.object({ ...travel, version: z.number().int().min(1) }).strict(), b);
export const parsePolicy = (b) => parse(z.object({
  id: id.optional(), grade: text(20).min(1).default('*'), category: z.enum(['*', ...CATS]).default('*'), cityTier: z.enum(['*', 'T1', 'T2', 'T3']).default('*'), limit: rupees.default(0), perDiem: rupees.default(0), mileageRate: rupees.default(0),
  receiptAbove: rupees.nullish().transform((v) => v ?? null), effectiveFrom: day, effectiveTo: day.nullish().transform((v) => v || null), version: z.number().int().min(1).optional(),
}).strict(), b);
export const parseBulk = (b) => parse(z.object({ taskIds: z.array(id).min(1).max(100), decision: z.enum(['APPROVE', 'REJECT', 'RETURN']), comment: text(500).optional() }).strict(), b);
export const parseAnalysis = (q) => parse(z.object({ from: day.optional(), to: day.optional(), projectId: id.optional() }).strict(), clean(q));
