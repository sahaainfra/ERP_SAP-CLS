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

// Part 15.03: RFQs, vendor quotations and the vendor's page.
const terms = z.object({ delivery: optText(300), payment: optText(300), validityDays: z.number().int().min(1).max(365).nullish().transform((x) => x ?? null), technicalSpecs: optText(2000), approvedMakes: optText(500), documents: z.array(text(200)).max(20).optional() }).strict();
const rfqLine = z.object({ prLineId: id, qty: qty.optional(), spec: optText(500) }).strict();
const rfqVendor = z.object({ vendorId: id, channel: z.enum(['EMAIL', 'WHATSAPP', 'LINK']).default('EMAIL'), contactTo: optText(120) }).strict();
export const parseRfqCreate = (b) => parse(z.object({ projectId: id, title: text(200).min(3, 'Give the RFQ a title'), dueDate: day, terms: terms.optional(), justification: optText(1000), lines: z.array(rfqLine).min(1, 'Choose at least one requisition line').max(300), vendors: z.array(rfqVendor).max(50).default([]) }).strict(), b ?? {});
export const parseRfqUpdate = (b) => defined(parse(z.object({ title: text(200).min(3).optional(), dueDate: day.optional(), terms: terms.optional(), justification: optText(1000).optional(), lines: z.array(rfqLine).min(1).max(300).optional(), vendors: z.array(rfqVendor).max(50).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseRfqAmend = (b) => defined(parse(z.object({ reason, dueDate: day.optional(), terms: terms.optional() }).strict(), b ?? {}));
export const parseRfqOptionsQ = (q) => { const v = parse(z.object({ projectId: id, prLineIds: z.string().regex(/^\d+(,\d+)*$/).max(2000).optional() }).strict(), q ?? {}); return { projectId: v.projectId, prLineIds: v.prLineIds ? v.prLineIds.split(',').map(Number) : [] }; };
export const parseVendorsQ = (q) => { const v = parse(z.object({ projectId: id, prLineIds: z.string().regex(/^\d+(,\d+)*$/).max(2000).optional(), q: z.string().trim().max(60).optional() }).strict(), q ?? {}); return { projectId: v.projectId, prLineIds: v.prLineIds ? v.prLineIds.split(',').map(Number) : [], q: v.q ?? '' }; };
export const parseReissue = (b) => parse(z.object({ vendorId: id }).strict(), b ?? {});
export const parseRegret = (b) => parse(z.object({ vendorIds: z.array(id).min(1, 'Choose the vendors').max(50), message: optText(1000) }).strict(), b ?? {});
export const parseAsk = (b) => parse(z.object({ vendorId: optId, question: text(1000).min(5, 'Write the question') }).strict(), b ?? {});
export const parseAnswer = (b) => parse(z.object({ answer: text(2000).min(2, 'Write the answer'), shareAll: z.boolean().default(false) }).strict(), b ?? {});
const pct = z.number().finite().min(0).max(100).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
const moneyOpt = money.optional();
const qLine = z.object({ rfqLineId: id, offeredQty: z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals').optional(), rate: money, discountPct: pct.optional(), gstRate: pct.optional(), freight: moneyOpt, loading: moneyOpt, otherCharges: moneyOpt, make: optText(120), deviation: optText(500) }).strict();
const qHead = { quoteRef: optText(60), quoteDate: day.optional(), validUntil: day, deliveryDays: z.number().int().min(0).max(1000).default(0), paymentTerms: optText(300), freightTerms: optText(300), gstInclusive: z.boolean().default(false), deviations: optText(1000) };
export const parseQuoteCreate = (b) => parse(z.object({ rfqId: id, vendorId: id, ...qHead, lines: z.array(qLine).min(1, 'Quote at least one line').max(300) }).strict(), b ?? {});
export const parseQuoteUpdate = (b) => defined(parse(z.object({ quoteRef: optText(60).optional(), quoteDate: day.optional(), validUntil: day.optional(), deliveryDays: z.number().int().min(0).max(1000).optional(), paymentTerms: optText(300).optional(), freightTerms: optText(300).optional(), gstInclusive: z.boolean().optional(), deviations: optText(1000).optional(), lines: z.array(qLine).min(1).max(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseQuoteImport = (b) => parse(z.object({ rows: z.array(z.object({ lineNo: z.number().int().min(1), offeredQty: qLine.shape.offeredQty, rate: money, discountPct: pct.optional(), gstRate: pct.optional(), freight: moneyOpt, loading: moneyOpt, otherCharges: moneyOpt, make: optText(120), deviation: optText(500) }).strict()).min(1).max(300) }).strict(), b ?? {});
export const parseToken = (t) => parse(z.string().regex(/^[A-Za-z0-9_-]{20,80}$/, 'This link is not valid'), t);
export const parseVendorQuote = (b) => parse(z.object({ quoteRef: optText(60), validUntil: day, deliveryDays: z.number().int().min(0).max(1000).default(0), paymentTerms: optText(300), freightTerms: optText(300), gstInclusive: z.boolean().default(false), deviations: optText(1000), lines: z.array(qLine).min(1, 'Quote at least one line').max(300) }).strict(), b ?? {});
export const parseVendorDecline = (b) => parse(z.object({ reason: optText(500) }).strict(), b ?? {});
export const parseVendorAsk = (b) => parse(z.object({ question: text(1000).min(5, 'Write the question') }).strict(), b ?? {});

// Part 15.04: comparative statements.
const csPick = z.object({ rfqLineId: id, vendorId: id, qty: z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals') }).strict();
const csReason = z.enum(['TECHNICAL', 'DELIVERY', 'QUALITY', 'OTHER']);
export const parseCsCreate = (b) => parse(z.object({ rfqId: id, recommendationType: z.enum(['OVERALL_L1', 'SPLIT_L1', 'CUSTOM']).default('OVERALL_L1'), selections: z.array(csPick).max(600).optional(), reasonCode: csReason.nullish().transform((x) => x ?? null), justification: optText(2000) }).strict().refine((x) => x.recommendationType !== 'CUSTOM' || (x.selections?.length ?? 0) > 0, { message: 'Give the selection', path: ['selections'] }), b ?? {});
export const parseCsUpdate = (b) => defined(parse(z.object({ recommendationType: z.enum(['OVERALL_L1', 'SPLIT_L1', 'CUSTOM']).optional(), selections: z.array(csPick).max(600).optional(), reasonCode: csReason.nullish().optional(), justification: optText(2000).optional(), refresh: z.boolean().optional(), compliance: z.array(z.object({ rfqLineId: id, vendorId: id, value: z.enum(['YES', 'NO', 'DEVIATION']) }).strict()).max(600).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseCsImport = (b) => parse(z.object({ rows: z.array(z.object({ lineNo: z.number().int().min(1), vendorId: id, qty: csPick.shape.qty }).strict()).min(1).max(600) }).strict(), b ?? {});
export const parseCsNegotiate = (b) => parse(z.object({ vendorId: id, note: text(1000).min(5, 'Write what was asked and agreed') }).strict(), b ?? {});

// Part 15.05: purchase orders.
const pct100 = z.number().finite().min(0).max(100).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
const poTerms = z.object({ deliveryAddress: optText(500), deliveryStateCode: z.string().trim().regex(/^\d{2}$/, 'Two-digit GST state code, for example 27').optional(), paymentTerms: optText(500), advancePct: pct100.optional(), creditDays: z.number().int().min(0).max(365).optional(), milestoneTerms: optText(1000), priceBasis: z.enum(['EX_WORKS', 'FOR_SITE', 'FOR_DESTINATION']).optional(), freightTerms: optText(500), insuranceTerms: optText(500), warrantyTerms: optText(500), ldTerms: optText(1000), ldPctPerWeek: pct100.optional(), ldCapPct: pct100.optional(), tcText: optText(5000), documentsRequired: optText(1000), approvedMakes: optText(500) }).strict();
const poSched = z.object({ dueDate: day, qty }).strict();
const poLine = z.object({ rcLineId: optId, csLineId: optId, prLineId: optId, itemId: optId, description: optText(300), qty, uom: optText(20), rate: money.optional(), discountPct: pct100.optional(), taxCode: optText(20), wbsId: optId, costCodeId: optId, deliverySiteId: optId, requiredBy: day.optional(), schedule: z.array(poSched).max(24).optional() }).strict();
export const parsePoCreate = (b) => parse(z.object({ projectId: id, source: z.enum(['CS', 'DIRECT', 'RATE_CONTRACT']).default('CS'), csId: optId, rcId: optId, vendorId: optId, vendorGstinId: optId, siteId: optId, isEmergency: z.boolean().default(false), directReason: optText(500), deliveryDate: day.optional(), terms: poTerms.default({}), lines: z.array(poLine).max(300).optional() }).strict().refine((x) => x.source !== 'CS' || x.csId, { message: 'Choose the comparative statement', path: ['csId'] }).refine((x) => x.source === 'RATE_CONTRACT' || x.vendorId, { message: 'Choose the vendor', path: ['vendorId'] }), b ?? {});
export const parsePoUpdate = (b) => defined(parse(z.object({ vendorGstinId: optId.optional(), siteId: optId.optional(), isEmergency: z.boolean().optional(), directReason: optText(500).optional(), terms: poTerms.optional(), lines: z.array(poLine).min(1).max(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parsePoImport = (b) => parse(z.object({ rows: z.array(z.object({ itemCode: text(60).min(1), qty, rate: money, uom: optText(20), dueDate: day.optional() }).strict()).min(1).max(300) }).strict(), b ?? {});
export const parsePoOptionsQ = (q) => parse(z.object({ projectId: id }).strict(), q ?? {});
export const parseAmendCreate = (b) => parse(z.object({ reason, lines: z.array(z.object({ lineId: id, qty: qty.optional(), rate: money.optional(), discountPct: pct100.optional(), schedule: z.array(poSched).max(24).optional() }).strict()).max(300).optional(), terms: poTerms.optional() }).strict(), b ?? {});
export const parseAmendId = (v) => parse(id, v);
export const parseDispatch = (b) => parse(z.object({ vendorInvoiceNo: optText(60), lrNo: optText(60), vehicleNo: optText(30), ewayBillNo: optText(30), dispatchDate: day, expectedArrival: day.optional(), lines: z.array(z.object({ poLineId: id, qty }).strict()).min(1, 'Name the lines sent').max(300) }).strict(), b ?? {});
export const parseReceipts = (b) => parse(z.object({ receipts: z.array(z.object({ poLineId: id, grnRef: text(60).min(1), receivedOn: day, qty, acceptedQty: z.number().finite().min(0).max(1e9).optional() }).strict()).min(1).max(1000) }).strict(), b ?? {});
export const parseAdvance = (b) => parse(z.object({ amount: money.refine((n) => n > 0, 'Give an amount above zero'), neededBy: day.optional(), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500) }).strict(), b ?? {});
export const parseTrackerQ = (q) => { const v = parse(z.object({ projectId: id.optional(), vendorId: id.optional(), overdueOnly: z.enum(['true', 'false']).optional() }).strict(), q ?? {}); return { projectId: v.projectId, vendorId: v.vendorId, overdueOnly: v.overdueOnly === 'true' }; };
export const parsePerfQ = (q) => parse(z.object({ vendorId: id.optional() }).strict(), q ?? {});
export const parseVendorAck = (b) => parse(z.object({ note: optText(500) }).strict(), b ?? {});

// Part 15.06: rate contracts, price variation, service orders, service entry sheets.
const idxPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-11');
const rcPv = z.object({ enabled: z.boolean().default(false), indexCode: z.string().trim().min(2).max(30).optional(), source: z.enum(['MANUAL', 'RBI', 'JPC', 'IMPORT']).optional(), frequency: z.enum(['MONTHLY', 'QUARTERLY']).optional(), basePeriod: idxPeriod.optional(), baseIndex: z.number().finite().positive().max(1e7).optional(), linkedPct: z.number().finite().min(0).max(100).optional() }).strict().refine((x) => !x.enabled || (x.indexCode && x.basePeriod && x.baseIndex && x.linkedPct != null), { message: 'Give the index, its base period and value, and the share of the rate that varies' });
const rcLine = z.object({ itemId: optId, description: optText(300), uom: optText(20), rate: money, taxCode: optText(20), ceilingQty: qtyOpt.optional(), pvLinked: z.boolean().optional() }).strict();
const rcBody = { title: text(200).min(3, 'Give the contract a title'), vendorId: id, validFrom: day, validTo: day, ceilingValue: money.optional(), projectIds: z.array(id).max(100).optional(), regions: z.array(text(60)).max(30).optional(), pv: rcPv.nullish(), terms: optText(5000), paymentTerms: optText(500) };
export const parseRcCreate = (b) => parse(z.object({ ...rcBody, lines: z.array(rcLine).min(1, 'Add at least one line').max(300) }).strict(), b ?? {});
export const parseRcUpdate = (b) => defined(parse(z.object({ title: rcBody.title.optional(), validFrom: day.optional(), validTo: day.optional(), ceilingValue: money.optional(), projectIds: rcBody.projectIds, regions: rcBody.regions, pv: rcPv.nullish(), terms: optText(5000).optional(), paymentTerms: optText(500).optional(), lines: z.array(rcLine).min(1).max(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseRcImport = (b) => parse(z.object({ rows: z.array(z.object({ itemCode: text(60).min(1), rate: money, uom: optText(20), ceilingQty: qtyOpt.optional(), pvLinked: z.boolean().optional() }).strict()).min(1).max(300) }).strict(), b ?? {});
export const parseIndexSet = (b) => parse(z.object({ indexCode: z.string().trim().min(2).max(30), period: idxPeriod, value: z.number().finite().positive().max(1e7), source: z.enum(['MANUAL', 'RBI', 'JPC', 'IMPORT']).default('MANUAL') }).strict(), b ?? {});
export const parseIndexQ = (q) => parse(z.object({ code: z.string().trim().min(2).max(30).optional() }).strict(), q ?? {});
export const parsePvRequest = (b) => parse(z.object({ period: idxPeriod, effectiveFrom: day.optional() }).strict(), b ?? {});
const soLine = z.object({ description: text(300).min(2), pricingKind: z.enum(['LUMP_SUM', 'PER_UNIT', 'PER_MONTH']).default('PER_UNIT'), uom: optText(20), qty: z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals').default(1), rate: money, taxCode: optText(20), wbsId: optId, costCodeId: optId }).strict();
const soBody = { siteId: optId, vendorId: id, title: text(200).min(3, 'Give the order a title'), scope: text(3000).min(10, 'Describe the scope (at least 10 characters)'), deliverables: optText(2000), startDate: day, endDate: day, paymentTerms: optText(500), terms: optText(5000) };
export const parseSoCreate = (b) => parse(z.object({ projectId: id, ...soBody, lines: z.array(soLine).min(1, 'Add at least one line').max(300) }).strict(), b ?? {});
export const parseSoUpdate = (b) => defined(parse(z.object({ siteId: optId.optional(), title: soBody.title.optional(), scope: soBody.scope.optional(), deliverables: optText(2000).optional(), startDate: day.optional(), endDate: day.optional(), paymentTerms: optText(500).optional(), terms: optText(5000).optional(), lines: z.array(soLine).min(1).max(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseSoImport = (b) => parse(z.object({ rows: z.array(z.object({ description: text(300).min(2), pricingKind: z.enum(['LUMP_SUM', 'PER_UNIT', 'PER_MONTH']).optional(), uom: optText(20), qty: soLine.shape.qty, rate: money }).strict()).min(1).max(300) }).strict(), b ?? {});
const seLine = z.object({ soLineId: id, qty, note: optText(300) }).strict();
export const parseSeCreate = (b) => parse(z.object({ soId: id, periodFrom: day, periodTo: day, lines: z.array(seLine).min(1, 'Certify at least one line').max(300) }).strict(), b ?? {});
export const parseSeUpdate = (b) => defined(parse(z.object({ periodFrom: day.optional(), periodTo: day.optional(), lines: z.array(seLine).min(1).max(300).optional(), rowVersion: z.number().int().min(1).optional() }).strict(), b ?? {}));
export const parseSeImport = (b) => parse(z.object({ rows: z.array(z.object({ lineNo: z.number().int().min(1), qty, note: optText(300) }).strict()).min(1).max(300) }).strict(), b ?? {});

// ---- expediting, inspections and shipments (part 15.07) ----------------------------------------------------------------------------------------------------------------------------------------------
const KIND = z.enum(['DRAWING_APPROVAL', 'RAW_MATERIAL', 'MANUFACTURING', 'TESTING', 'DISPATCH', 'OTHER']);
const msRow = z.object({ name: text(120).min(2), kind: KIND.optional(), plannedDate: day, forecastDate: day.nullish().transform((v) => v || null) }).strict();
const xpdFields = { requiredOnSite: day.optional(), transitDays: z.number().int().min(0).max(365).optional(), longLead: z.boolean().optional(), inspectionRequired: z.boolean().optional(), expediter: optText(60), milestones: z.array(msRow).min(1).max(40).optional() };
export const parseXpdCreate = (b) => parse(z.object({ poId: id, ...xpdFields }).strict(), b ?? {});
export const parseXpdUpdate = (b) => parse(z.object({ ...xpdFields, rowVersion: z.number().int().optional() }).strict().transform(defined), b ?? {});
export const parseXpdImport = (b) => parse(z.object({ rows: z.array(msRow).min(1).max(40) }).strict(), b ?? {});
export const parseMilestoneProgress = (b) => parse(z.object({ forecastDate: day.nullish().transform((v) => v || null).optional(), actualDate: day.nullish().transform((v) => v || null).optional(), status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'DELAYED']).optional(), remarks: optText(500).optional() }).strict().transform(defined), b ?? {});
export const parseVendorMilestone = (b) => parse(z.object({ forecastDate: day.nullish().transform((v) => v || null).optional(), actualDate: day.nullish().transform((v) => v || null).optional(), remarks: optText(500).optional() }).strict().transform(defined), b ?? {});
const iLine = z.object({ poLineId: id, qty }).strict();
const inspFields = { itype: z.enum(['STAGE', 'FINAL', 'TPI']), mandatory: z.boolean().optional(), callDate: day, inspector: optText(80), agency: optText(120), location: optText(160), scope: optText(1000), lines: z.array(iLine).max(300).optional() };
export const parseInspCreate = (b) => parse(z.object({ poId: id, ...inspFields }).strict(), b ?? {});
export const parseInspUpdate = (b) => parse(z.object({ ...inspFields, rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
const punch = z.object({ point: text(300).min(3), severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']).optional(), status: z.enum(['OPEN', 'CLOSED']).optional() }).strict();
export const parseInspResult = (b) => parse(z.object({ inspectionDate: day, result: z.enum(['PASSED', 'PASSED_WITH_PUNCH', 'FAILED']), inspector: optText(80), punchPoints: z.array(punch).max(200).optional() }).strict(), b ?? {});
export const parsePunchImport = (b) => parse(z.object({ rows: z.array(punch).min(1).max(200) }).strict(), b ?? {});
const shipFields = { transporter: optText(120), vehicleNo: optText(30), lrNo: optText(60), blNo: optText(60), ewayBillNo: optText(30), packingList: optText(1000), packages: z.number().int().min(0).max(100000).optional(), isOdc: z.boolean().optional(), odcPermitNo: optText(60), odcValidTo: day.nullish().transform((v) => v || null), odcDimensions: optText(200), eta: day.nullish().transform((v) => v || null), lines: z.array(iLine).max(300).optional() };
export const parseShipCreate = (b) => parse(z.object({ poId: id, ...shipFields }).strict(), b ?? {});
export const parseShipUpdate = (b) => parse(z.object({ ...shipFields, rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseShipDispatch = (b) => parse(z.object({ dispatchedOn: day.optional(), eta: day.optional(), location: optText(120) }).strict().transform(defined), b ?? {});
export const parseShipTrack = (b) => parse(z.object({ location: optText(120), note: optText(300), eta: day.optional() }).strict().transform(defined), b ?? {});
export const parseShipDeliver = (b) => parse(z.object({ deliveredOn: day.optional() }).strict().transform(defined), b ?? {});
export const parseDashQ = (q) => parse(z.object({ projectId: id.optional() }).strict(), q ?? {});

// ---- vendor prequalification, the approved vendor list and scorecards (part 15.08) -----------------------------------------------------------------------------------------------------------------------------
const answer = z.object({ section: z.enum(['FINANCIALS', 'EXPERIENCE', 'CAPACITY', 'CERTIFICATIONS', 'REFERENCES']), score: z.number().min(0).max(100), note: optText(500) }).strict();
const preqFields = { categoryIds: z.array(id).min(1).max(30), regions: z.array(text(30).min(1)).max(20).optional(), strategic: z.boolean().optional(), answers: z.array(answer).max(5).optional(), visitDate: day.nullish().transform((v) => v || null), visitNotes: optText(2000), validUntil: day.nullish().transform((v) => v || null), conditions: optText(1000) };
export const parsePreqCreate = (b) => parse(z.object({ partnerId: id, ...preqFields }).strict(), b ?? {});
export const parsePreqUpdate = (b) => parse(z.object({ ...preqFields, rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parsePreqImport = (b) => parse(z.object({ rows: z.array(answer).min(1).max(5) }).strict(), b ?? {});
export const parseVisitReport = (b) => parse(z.object({ fileId: id }).strict(), b ?? {});
export const parseSuspCreate = (b) => parse(z.object({ partnerId: id, avlIds: z.array(id).max(200).optional(), reason }).strict(), b ?? {});
const period = z.string().regex(/^\d{4}-(Q[1-4]|0[1-9]|1[0-2])$/, 'Use a period such as 2026-Q3 or 2026-09');
export const parseScoreCompute = (b) => parse(z.object({ partnerId: id, period }).strict(), b ?? {});
export const parseScoreInput = (b) => parse(z.object({ partnerId: id, period, kind: z.enum(['SAFETY', 'INVOICE_ACCURACY', 'QUALITY']), value: z.number().min(0).max(100), note: optText(500) }).strict(), b ?? {});
export const parseRankQ = (q) => parse(z.object({ categoryId: id.optional(), period: period.optional() }).strict(), q ?? {});
export const parseAvlCheckQ = (q) => parse(z.object({ partnerId: id, categoryId: id, region: text(30).optional() }).strict(), q ?? {});
export const parseActionCreate = (b) => parse(z.object({ partnerId: id, scorecardId: id.optional(), kind: z.enum(['REVIEW', 'CAR', 'DEVELOPMENT']), title: text(200).min(3), detail: optText(2000), owner: optText(60), dueDate: day.nullish().transform((v) => v || null) }).strict().transform(defined), b ?? {});
export const parseActionRespond = (b) => parse(z.object({ response: text(2000).min(3, 'Say what was done') }).strict(), b ?? {});
export const parseActionClose = (b) => parse(z.object({ note: optText(500) }).strict(), b ?? {});

// ---- material rate intelligence (part 15.09) ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const rateNum = z.number().finite().min(0.0001).max(1e9).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
export const parseSurvey = (b) => parse(z.object({ itemId: id, region: text(30).min(1).optional(), spec: optText(80), vendorId: id.optional(), date: day, rate: rateNum, uom: text(20).min(1), note: optText(500) }).strict().transform(defined), b ?? {});
export const parseCorrection = (b) => parse(z.object({ rate: rateNum, reason }).strict(), b ?? {});
const rtiIndexRow = z.object({ group: text(40).min(2), region: text(30).min(1).optional(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-09'), value: z.number().finite().min(0.0001).max(1e7) }).strict();
export const parseRtiIndex = (b) => parse(rtiIndexRow.transform(defined), b ?? {});
export const parseRtiIndexImport = (b) => parse(z.object({ rows: z.array(rtiIndexRow.transform(defined)).min(1).max(500) }).strict(), b ?? {});
export const parseIntelQ = (q) => parse(z.object({ region: text(30).optional(), itemId: id.optional(), months: z.coerce.number().int().min(1).max(36).optional(), group: text(40).optional(), q: text(60).optional() }).strict(), q ?? {});

// ---- procurement dashboard and analytics (part 15.10) ------------------------------------------------------------------------------------------------------------------------------------------------------
export const parseAnaQ = (q) => parse(z.object({ projectId: id.optional(), from: day.optional(), to: day.optional(), groupBy: z.enum(['category', 'vendor', 'project', 'month']).optional(), key: text(60).optional() }).strict(), q ?? {});
