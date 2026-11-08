import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the budget API (part 12.01). The service checks the rules again.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-12');
const num = z.number().finite().min(0);
const given = (out, b) => Object.fromEntries(Object.entries(out).filter(([k]) => b && Object.hasOwn(b, k)));
const KIND = z.enum(['DIRECT', 'OVERHEAD', 'CONTINGENCY', 'RESERVE']);
const TYPE = z.enum(['MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER']);
const line = {
  lineKind: KIND.default('DIRECT'), wbsId: optId, costCodeId: optId, resourceType: TYPE.default('OTHER'), resourceName: text(200).min(2, 'Name the resource'), uom: optText(20),
  qty: num.nullish().transform((v) => v ?? null), rate: num.nullish().transform((v) => v ?? null), amount: num.nullish().transform((v) => v ?? null), reason: optText(1000),
};
export const parseId = (v) => parse(id, v);
export const parseProject = (q) => parse(z.object({ projectId: id }).strict(), q ?? {});
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseOptReason = (b) => parse(z.object({ reason: optText(1000) }).strict(), b ?? {});
export const parseGenerate = (b) => parse(z.object({ projectId: id, name: optText(200), targetMarginPct: num.max(100).nullish().transform((v) => v ?? null), rates: z.array(z.object({ type: TYPE, description: text(200), rate: num }).strict()).max(500).default([]) }).strict(), b);
export const parseBudgetCreate = (b) => parse(z.object({ projectId: id, name: text(200).min(3, 'Name the budget'), targetMarginPct: num.max(100).nullish().transform((v) => v ?? null) }).strict(), b);
export const parseBudgetUpdate = (b) => given(parse(z.object({ name: text(200).min(3).optional(), targetMarginPct: num.max(100).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b), b);
export const parseAmend = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseLineCreate = (b) => parse(z.object({ ...line, reason: reason }).strict(), b);
export const parseLineUpdate = (b) => given(parse(z.object({ wbsId: optId.optional(), costCodeId: optId.optional(), resourceName: line.resourceName.optional(), uom: line.uom.optional(), qty: num.optional(), rate: num.optional(), amount: num.optional(), reason: reason }).strict(), b), b);
export const parseView = (q) => parse(z.object({ by: z.enum(['wbs', 'cost_head', 'resource', 'work_package', 'control_account']).default('wbs') }).strict(), q ?? {});
export const parsePhasingGenerate = (b) => parse(z.object({ method: z.enum(['SCURVE', 'SCHEDULE']), profile: z.enum(['LINEAR', 'SCURVE', 'FRONT', 'BACK']).default('SCURVE'), from: month.nullish().transform((v) => v || null), to: month.nullish().transform((v) => v || null) }).strict(), b ?? {});
export const parsePhasingSet = (b) => parse(z.object({ rows: z.array(z.object({ period: month, amount: num }).strict()).max(240) }).strict(), b);
export const parseImport = (b) => parse(z.object({ projectId: id.optional(), rows: z.array(z.object({ ...line, reason: optText(1000) }).strict()).min(1, 'Give at least one row').max(500) }).strict(), b);

// Part 12.02: budget changes. Deltas are signed rupees and quantities.
const delta = z.number().finite();
const cline = z.object({
  lineId: optId, lineKind: KIND.optional(), wbsId: optId, costCodeId: optId, resourceType: TYPE.optional(), resourceName: optText(200), uom: optText(20),
  qtyDelta: delta.default(0), amountDelta: delta, note: optText(500),
}).strict();
const change = {
  changeType: z.enum(['REVISION', 'TRANSFER', 'DRAWDOWN']), reasonCode: z.enum(['VARIATION', 'SCOPE_CHANGE', 'RATE_ESCALATION', 'RE_ESTIMATE', 'TRANSFER', 'RISK_REALISED']),
  title: text(200).min(3, 'Give a title'), justification: z.string().trim().min(10, 'Justify the change (at least 10 characters)').max(4000), riskId: optId, variationRef: optText(80), lines: z.array(cline).max(300).default([]),
};
export const parseChangeCreate = (b) => parse(z.object({ projectId: id, ...change }).strict(), b);
export const parseChangePreview = (b) => parse(z.object({ projectId: id, ...change, title: text(200).default('Preview'), justification: z.string().max(4000).default(''), changeId: optId }).strict(), b);
export const parseChangeUpdate = (b) => given(parse(z.object({ reasonCode: change.reasonCode.optional(), title: change.title.optional(), justification: change.justification.optional(), riskId: optId.optional(), variationRef: optText(80).optional(), lines: z.array(cline).max(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b), b);
export const parseChangeImport = (b) => parse(z.object({ rows: z.array(z.object({ projectId: id, ...change }).strict()).min(1, 'Give at least one row').max(100) }).strict(), b);
export const parseCompare = (q) => parse(z.object({ projectId: id, from: optId, to: optId, by: z.enum(['line', 'cost_head', 'wbs']).default('line'), format: z.enum(['csv']).optional() }).strict(), q ?? {});
