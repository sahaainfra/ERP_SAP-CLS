import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the procurement API (part 15.01). The services check every rule again; quantities have at most three decimals, money two.
const id = z.coerce.number().int().min(1);
const optId = id.nullish().transform((v) => v || null);
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const qty = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals').refine((n) => n > 0, 'Give a quantity above zero');
const money = z.number().finite().min(0).max(1e12).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
const PRI = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));

export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseProjectQ = (q) => parse(z.object({ projectId: id }).strict(), q ?? {});
export const parseAvailQ = (q) => parse(z.object({ projectId: id, siteId: id.optional(), itemId: id }).strict(), q ?? {});
export const parseRateQ = (q) => parse(z.object({ projectId: id, itemId: id, wbsId: id.optional(), costCodeId: id.optional() }).strict(), q ?? {});

const mrLine = z.object({ itemId: id, qty, uom: text(20).min(1, 'Give the unit'), wbsId: optId, costCodeId: optId, remarks: optText(300) }).strict();
const mrBase = { siteId: id, requiredBy: day, waId: optId, priority: PRI.default('NORMAL'), purpose: optText(500), lines: z.array(mrLine).min(1, 'Add at least one line').max(200) };
export const parseMrCreate = (b) => parse(z.object({ projectId: id, ...mrBase }).strict(), b ?? {});
export const parseMrUpdate = (b) => { const v = parse(z.object({ siteId: id.optional(), requiredBy: day.optional(), waId: optId.optional(), priority: PRI.optional(), purpose: optText(500).optional(), lines: z.array(mrLine).min(1).max(200).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}); return defined(v); };
export const parseMrFulfil = (b) => parse(z.object({ lines: z.array(z.object({ lineId: id, mode: z.enum(['ISSUE', 'TRANSFER']), qty, storeCode: optText(40) }).strict()).min(1).max(200) }).strict(), b ?? {});
export const parseMrImport = (b) => parse(z.object({ rows: z.array(z.object({ itemCode: text(60).min(1), qty, uom: text(20).min(1), remarks: optText(300) }).strict()).min(1).max(500) }).strict(), b ?? {});

const prLine = z.object({ itemId: optId, serviceDesc: optText(300), qty, uom: text(20).min(1, 'Give the unit'), estRate: money.nullish().transform((v) => v ?? undefined), requiredBy: day.optional(), deliverySiteId: optId, wbsId: optId, costCodeId: optId, spec: optText(500), preferredVendorId: optId, approvedMakes: optText(300) }).strict();
export const parsePrCreate = (b) => parse(z.object({ projectId: id, siteId: optId, requiredBy: day, priority: PRI.default('NORMAL'), purpose: optText(500), directReason: optText(500), isEmergency: z.boolean().default(false), emergencyReason: optText(500), total: money.optional(), lines: z.array(prLine).min(1, 'Add at least one line').max(300) }).strict(), b ?? {});
export const parsePrUpdate = (b) => { const v = parse(z.object({ siteId: optId.optional(), requiredBy: day.optional(), priority: PRI.optional(), purpose: optText(500).optional(), directReason: optText(500).optional(), isEmergency: z.boolean().optional(), emergencyReason: optText(500).optional(), total: money.optional(), lines: z.array(prLine).min(1).max(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}); return defined(v); };
export const parseConsolidate = (b) => parse(z.object({ mrIds: z.array(id).min(1, 'Choose at least one material request').max(50), mrLineIds: z.array(id).max(500).optional(), requiredBy: day.optional(), priority: PRI.optional(), purpose: optText(500).optional(), total: money.optional() }).strict(), b ?? {});
export const parsePrImport = (b) => parse(z.object({ rows: z.array(z.object({ itemCode: optText(60), serviceDesc: optText(300), qty, uom: text(20).min(1), estRate: money.optional(), requiredBy: day.optional() }).strict().refine((x) => x.itemCode || x.serviceDesc, { message: 'Give the item code or the service' })).min(1).max(500) }).strict(), b ?? {});
export const parseStockIngest = (b) => parse(z.object({ levels: z.array(z.object({ itemId: id, storeCode: text(40).min(1), storeName: text(120).min(1), kind: z.enum(['SITE', 'NEARBY', 'CENTRAL']), siteId: optId, freeQty: z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals') }).strict()).min(1).max(1000) }).strict(), b ?? {});

// Part 15.02: MRP runs, proposals, item planning parameters, open supply.
const qtyOpt = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
export const parseRunCreate = (b) => parse(z.object({ projectId: id, kind: z.enum(['ON_DEMAND', 'SCHEDULED']).optional(), horizonWeeks: z.number().int().min(1).max(52).optional(), bufferDays: z.number().int().min(0).max(60).optional(), includeMto: z.boolean().optional(), note: optText(300) }).strict(), b ?? {});
export const parseRunUpdate = (b) => defined(parse(z.object({ horizonWeeks: z.number().int().min(1).max(52).optional(), bufferDays: z.number().int().min(0).max(60).optional(), includeMto: z.boolean().optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseRunImport = (b) => parse(z.object({ rows: z.array(z.object({ itemCode: text(60).min(1), weekStart: day, qty: qty, note: optText(200) }).strict()).min(1).max(500) }).strict(), b ?? {});
export const parseRunExport = (q) => parse(z.object({ kind: z.enum(['RESULT', 'HEATMAP', 'LONG_LEAD']).default('RESULT'), format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx') }).strict(), q ?? {});
export const parseProposalModify = (b) => defined(parse(z.object({ qty: qty.optional(), requiredBy: day.optional(), substituteItemId: optId.optional(), note: optText(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseProposalAccept = (b) => parse(z.object({ ids: z.array(id).min(1, 'Choose at least one proposal').max(100), siteId: optId, items: z.array(z.object({ id, qty: qty.optional(), requiredBy: day.optional(), estRate: money.optional() }).strict()).max(100).optional() }).strict(), b ?? {});
const paramBody = { leadTimeDays: z.number().int().min(0).max(730), moq: qtyOpt.optional(), packSize: qtyOpt.optional(), safetyStock: qtyOpt.optional(), longLead: z.boolean().optional(), capacityNote: optText(500) };
export const parseParamCreate = (b) => { const v = parse(z.object({ itemId: id, vendorId: optId, effectiveFrom: day, ...paramBody }).strict(), b ?? {}); return { ...v, pack: v.packSize ?? 0 }; };
export const parseParamUpdate = (b) => defined(parse(z.object({ leadTimeDays: paramBody.leadTimeDays.optional(), moq: qtyOpt.optional(), packSize: qtyOpt.optional(), safetyStock: qtyOpt.optional(), longLead: z.boolean().optional(), capacityNote: optText(500).optional(), effectiveFrom: day.optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseSupplyIngest = (b) => parse(z.object({ supplies: z.array(z.object({ projectId: id, itemId: id, kind: z.enum(['PO', 'TRANSIT']), docRef: text(60).min(1), balanceQty: qtyOpt, expectedOn: day }).strict()).min(1).max(2000) }).strict(), b ?? {});
