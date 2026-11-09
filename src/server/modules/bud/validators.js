import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the budget API (part 12.01). The service checks the rules again.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
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

// Part 12.03: the budget check and the ledger.
const nonNeg = z.number().finite().min(0);
const stage = z.enum(['PR', 'PO', 'WO', 'OTHER']);
const lline = z.object({ lineId: z.union([z.string().max(60), z.number()]).nullish().transform((v) => (v == null ? '' : String(v))), wbsId: optId, costCodeId: optId, resourceType: TYPE.default('OTHER'), qty: nonNeg.default(0), amount: nonNeg, description: optText(200) }).strict();
const ref = z.object({ sourceType: text(40).min(1), sourceId: z.union([z.string().max(60), z.number()]).transform(String), lineId: z.union([z.string().max(60), z.number()]).nullish().transform((v) => (v == null ? '' : String(v))) }).strict();
export const parseCheck = (b) => parse(z.object({ projectId: id, stage: stage.default('PO'), lines: z.array(lline.extend({ sourceType: optText(40), sourceId: z.union([z.string().max(60), z.number()]).nullish().transform((v) => (v == null ? null : String(v))) }).strict()).min(1, 'Give at least one line').max(100) }).strict(), b);
export const parseAvailability = (q) => parse(z.object({ projectId: id, wbsId: optId, costCodeId: optId, stage: stage.optional(), amount: z.coerce.number().min(0).optional() }).strict(), q ?? {});
export const parseLedger = (q) => parse(z.object({ projectId: id, by: z.enum(['wbs', 'cost_code', 'cost_head', 'vendor']).default('wbs') }).strict(), q ?? {});
export const parseLedgerDocs = (q) => parse(z.object({ projectId: id, wbsId: optId, costCodeId: optId, vendorRef: optText(60) }).strict(), q ?? {});
export const parseIngestCommitment = (b) => parse(z.object({ action: z.enum(['UPSERT', 'SHORT_CLOSE', 'CANCEL']), projectId: id, stage, sourceType: text(40).min(1), sourceId: z.union([z.string().max(60), z.number()]).transform(String), docRef: optText(80), vendorRef: optText(60), vendorName: optText(160), replaces: ref.pick({ sourceType: true, sourceId: true }).nullish().transform((v) => v ?? null), lines: z.array(lline).max(300).default([]), reason: optText(500) }).strict(), b);
export const parseIngestActual = (b) => parse(z.object({ action: z.enum(['POST', 'REVERSE']), projectId: id, sourceType: text(40).min(1), sourceId: z.union([z.string().max(60), z.number()]).transform(String), docRef: optText(80), vendorRef: optText(60), vendorName: optText(160), date: day.nullish().transform((v) => v || null), lines: z.array(lline.extend({ commitment: ref.nullish().transform((v) => v ?? null) }).strict()).max(300).default([]) }).strict(), b);
export const parseConfigPropose = (b) => parse(z.object({ costHeadId: optId, stage: stage.nullish().transform((v) => v || null), mode: z.enum(['OFF', 'WARN', 'BLOCK']), tolerancePct: z.number().finite().min(0).max(100).default(0), effectiveFrom: day, reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000) }).strict(), b);
export const parseConfigImport = (b) => parse(z.object({ rows: z.array(z.object({ costHeadId: optId, stage: stage.nullish().transform((v) => v || null), mode: z.enum(['OFF', 'WARN', 'BLOCK']), tolerancePct: z.number().finite().min(0).max(100).default(0), effectiveFrom: day, reason: z.string().trim().min(5).max(1000) }).strict()).min(1).max(100) }).strict(), b);

// Part 12.04: department budgets, actuals of the ledger, allocation rules and runs. Money is given in rupees with at most two decimals.
const money = z.number().finite().min(0, 'An amount is not negative').max(100_000_000_000, 'Too large').refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
const dline = z.object({ accountId: id, note: optText(300), months: z.array(money).length(12, 'Give the twelve months of the financial year') }).strict();
const dtotal = money.nullish().transform((v) => (v == null ? null : v));
const dbase = { name: text(200).min(3, 'Name the budget').optional(), reason: optText(1000), lines: z.array(dline).max(300).default([]), total: dtotal };
export const parseDeptCreate = (b) => parse(z.object({ fyId: id, costCentreId: id, ...dbase }).strict(), b);
export const parseDeptUpdate = (b) => given(parse(z.object({ name: dbase.name, reason: dbase.reason.optional(), lines: z.array(dline).max(300).optional(), total: dtotal.optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b), b);
export const parseDeptImport = (b) => parse(z.object({ rows: z.array(z.object({ fyId: id, costCentreId: id, ...dbase }).strict()).min(1, 'Give at least one row').max(100) }).strict(), b);
export const parseDeptSpread = (b) => parse(z.object({ total: money, profile: z.enum(['LINEAR', 'SCURVE', 'FRONT', 'BACK']).default('LINEAR') }).strict(), b);
export const parseDeptCompare = (q) => parse(z.object({ with: optId }).strict(), q ?? {});
const gline = z.object({ lineId: z.union([z.string().max(60), z.number()]).nullish().transform((v) => (v == null ? '' : String(v))), costCentreId: id, accountId: id, amount: z.number().finite().min(-100_000_000_000).max(100_000_000_000).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals'), narration: optText(200) }).strict();
export const parseDeptActual = (b) => parse(z.object({ action: z.enum(['POST', 'REVERSE']), sourceType: text(40).min(1), sourceId: z.union([z.string().max(60), z.number()]).transform(String), docRef: optText(80), date: day.nullish().transform((v) => v || null), lines: z.array(gline).max(500).default([]) }).strict(), b);
export const parseDeptReport = (q) => parse(z.object({ fyId: id, costCentreId: optId, by: z.enum(['cost_centre', 'account', 'month']).default('cost_centre'), upTo: z.coerce.number().int().min(1).max(12).default(12) }).strict(), q ?? {});
export const parseDeptDocs = (q) => parse(z.object({ fyId: id, costCentreId: optId, accountId: optId, periodNo: z.coerce.number().int().min(1).max(12).optional() }).strict(), q ?? {});
const pool = z.object({ costCentreIds: z.array(id).min(1, 'Choose the cost centres of the pool').max(200), accountIds: z.array(id).max(300).default([]) }).strict();
const fixed = z.array(z.object({ projectId: id, pct: z.number().finite().gt(0, 'A percentage is above zero').max(100).refine((n) => Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-6, 'At most four decimals') }).strict()).max(200);
const rule = { fyId: id, name: text(120).min(3, 'Name the rule'), basis: z.enum(['REVENUE', 'DIRECT_COST', 'FIXED_PCT']), pool, projectIds: z.array(id).max(500).default([]), fixed: fixed.default([]), reason };
export const parseRuleCreate = (b) => parse(z.object(rule).strict(), b);
export const parseRuleUpdate = (b) => given(parse(z.object({ name: rule.name.optional(), basis: rule.basis.optional(), pool: pool.optional(), projectIds: rule.projectIds.optional(), fixed: fixed.optional(), reason: reason.optional() }).strict(), b), b);
export const parseRuleList = (q) => parse(z.object({ fyId: optId, status: z.enum(['DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED']).optional() }).strict(), q ?? {});
const run = { ruleId: id, fromPeriodNo: z.number().int().min(1).max(12), toPeriodNo: z.number().int().min(1).max(12), poolSource: z.enum(['BUDGET', 'ACTUAL']).default('BUDGET') };
export const parseRunPreview = (b) => parse(z.object(run).strict().refine((x) => x.fromPeriodNo <= x.toPeriodNo, { message: 'The first month is not after the last', path: ['toPeriodNo'] }), b);
export const parseRunPost = (b) => parse(z.object({ ...run, expectedPool: money.nullish().transform((v) => (v == null ? null : v)) }).strict().refine((x) => x.fromPeriodNo <= x.toPeriodNo, { message: 'The first month is not after the last', path: ['toPeriodNo'] }), b);
export const parseRunList = (q) => parse(z.object({ fyId: optId, ruleId: optId }).strict(), q ?? {});
export const parsePool = (q) => parse(z.object({ projectId: id, fyId: optId }).strict(), q ?? {});
