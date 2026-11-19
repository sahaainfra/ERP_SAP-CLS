import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the payroll API (module pay). The services check the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month such as 2026-10');
const money = z.coerce.number().nonnegative().max(1e10);
const code = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'A code of capital letters, digits and _ (2 to 20)');
const why = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: why }).strict(), b);

// ---- 24.01 ----
export const parseComponent = (b) => parse(z.object({ id: id.optional(), code: code.optional(), name: z.string().trim().min(2).max(120).optional(), type: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER', 'REIMBURSEMENT']).optional(), method: z.enum(['FIXED', 'PERCENT', 'FORMULA', 'BALANCE', 'STATUTORY', 'INPUT']).optional(),
  formula: z.string().trim().max(500).nullable().optional(), percent: z.number().min(0).max(1000).nullable().optional(), baseCodes: z.array(code).max(20).optional(), statutoryCode: z.enum(['PF_EE', 'ESI_EE', 'PT', 'LWF_EE', 'TDS', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN', 'ESI_ER', 'LWF_ER', 'GRATUITY']).nullable().optional(),
  taxable: z.boolean().optional(), pf: z.boolean().optional(), esi: z.boolean().optional(), pt: z.boolean().optional(), wageClass: z.enum(['WAGES', 'EXCLUDED', 'NOT_REMUNERATION']).optional(), prorate: z.boolean().optional(), sequence: z.number().int().min(1).max(999).optional(), glAccountCode: z.string().trim().max(20).nullable().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), version: z.number().int().optional() }).strict()
  .refine((x) => x.id || (x.code && x.name && x.type && x.method), { message: 'A new component needs its code, name, type and method' }), b);
export const parseFormulaTest = (b) => parse(z.object({ code, formula: z.string().trim().min(1).max(500), values: z.record(z.string(), z.number()).optional() }).strict(), b);
export const parseStructure = (b) => parse(z.object({ id: id.optional(), code: code.optional(), name: z.string().trim().min(2).max(120).optional(), grade: z.string().trim().max(40).nullable().optional(), senior: z.boolean().optional(), components: z.array(z.object({ code, value: money.nullable().optional() }).strict()).min(1).max(60), version: z.number().int().optional() }).strict()
  .refine((x) => x.id || (x.code && x.name), { message: 'A new structure needs its code and name' }), b);
export const parsePreview = (b) => parse(z.object({ structureId: id, ctcAnnual: money, employeeId: id.optional(), date: date.optional(), pf: z.boolean().optional(), esi: z.boolean().optional(), ptState: z.string().trim().max(5).nullable().optional(), gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(), overrides: z.record(z.string(), z.number()).optional() }).strict(), b);
export const parseAssignment = (b) => parse(z.object({ employeeId: id, structureId: id, ctcAnnual: money.refine((v) => v > 0, 'Give the CTC'), effectiveFrom: date, kind: z.enum(['NEW', 'REVISION', 'PROMOTION', 'CORRECTION']).optional(), reason: z.string().trim().min(3, 'Give the reason').max(500), overrides: z.record(z.string(), z.number().nonnegative()).optional(), rating: z.string().trim().max(10).nullable().optional() }).strict(), b);
export const parseAssignmentUpdate = (b) => parse(z.object({ structureId: id.optional(), ctcAnnual: money.optional(), effectiveFrom: date.optional(), reason: z.string().trim().min(3).max(500).optional(), overrides: z.record(z.string(), z.number().nonnegative()).optional(), version: z.number().int().optional() }).strict(), b);
export const parseArrears = (q) => parse(z.object({ employeeId: id.optional(), status: z.enum(['PENDING', 'PAID', 'CANCELLED']).optional() }).strict(), q ?? {});
export const parseStatParam = (b) => parse(z.object({ code: z.enum(['PF', 'ESI', 'PT', 'LWF', 'GRATUITY', 'BONUS', 'TDS_NEW', 'TDS_OLD', 'OT', 'MIN_WAGE']), state: z.string().trim().toUpperCase().max(5).optional(), params: z.record(z.string(), z.any()), effectiveFrom: date, legalRef: z.string().trim().min(5, 'Cite the notification').max(500) }).strict(), b);
export const parseStatParamUpdate = (b) => parse(z.object({ params: z.record(z.string(), z.any()).optional(), effectiveFrom: date.optional(), legalRef: z.string().trim().min(5).max(500).optional() }).strict(), b);
export const parseStatQuery = (q) => parse(z.object({ code: z.string().trim().max(10).optional(), state: z.string().trim().max(5).optional() }).strict(), q ?? {});
export const parseCalendarGen = (b) => parse(z.object({ fyStart: date, payDay: z.number().int().min(1).max(28).optional(), attendanceCutoffDay: z.number().int().min(1).max(31).optional(), inputsCutoffDay: z.number().int().min(1).max(31).optional() }).strict(), b);
export const parseCalendarUpdate = (b) => parse(z.object({ attendanceCutoff: date.optional(), inputsCutoff: date.optional(), payDate: date.optional(), version: z.number().int().optional() }).strict(), b);
export const parseCalendarQuery = (q) => parse(z.object({ fy: z.string().regex(/^\d{4}/).optional() }).strict(), q ?? {});
export const parseEmpQuery = (q) => parse(z.object({ q: z.string().trim().max(60).optional() }).strict(), q ?? {});
export const parsePeriod = period;

// ---- 24.02 ----
export const parseRunCreate = (b) => parse(z.object({ period, type: z.enum(['REGULAR', 'SUPPLEMENTARY']).optional(), branchId: id.nullable().optional(), employeeIds: z.array(id).max(5000).optional() }).strict(), b);
export const parseReadiness = (q) => parse(z.object({ period, branchId: id.optional() }).strict(), q);
export const parseHold = (b) => parse(z.object({ hold: z.boolean(), reason: z.string().trim().max(500).optional() }).strict(), b);
export const parseInput = (b) => parse(z.object({ employeeId: id, period, code, amount: money.refine((v) => v > 0, 'Give the amount'), note: z.string().trim().min(3, 'Say what it is').max(300) }).strict(), b);
export const parseInputQuery = (q) => parse(z.object({ period: period.optional(), status: z.enum(['PENDING', 'APPLIED', 'CANCELLED']).optional() }).strict(), q ?? {});
const fy = z.string().regex(/^\d{4}-\d{2}$/, 'A financial year such as 2026-27');
const amounts = z.object({ sec80C: money.optional(), sec80CCD1B: money.optional(), sec80D: money.optional(), sec24b: money.optional(), hraRent: money.optional(), other: money.optional() }).strict();
export const parseDeclaration = (b) => parse(z.object({ fy, regime: z.enum(['NEW', 'OLD']), declarations: amounts.optional(), proofs: z.array(z.object({ section: z.string().trim().max(20), amount: money, fileId: id.nullable().optional(), note: z.string().trim().max(200).optional() }).strict()).max(50).optional(), submit: z.boolean().optional() }).strict(), b);
export const parseDeclQuery = (q) => parse(z.object({ fy: fy.optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'VERIFIED', 'RETURNED']).optional() }).strict(), q ?? {});
export const parseVerify = (b) => parse(z.object({ action: z.enum(['verify', 'return']), verified: amounts.optional(), note: z.string().trim().max(300).optional() }).strict(), b);
export const parseFy = (q) => parse(z.object({ fy }).strict(), q);
