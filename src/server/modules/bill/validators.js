import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the billing API (part 22.01 on). The services check every rule again.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const opt = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const oid = id.nullish().transform((v) => v ?? null);
const nd = (f) => (f instanceof z.ZodDefault ? f.unwrap() : f);
const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
const dim = z.number().min(0).max(1e7).nullish().transform((v) => v ?? null);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-12');
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const TEMPLATES = ['QTY', 'NOS', 'LENGTH', 'AREA', 'VOLUME'];
const mbBase = { boqLineId: id, locationId: oid, waId: oid, activityId: oid, irId: oid, dprWorkId: oid, drawingId: oid, drawingRef: opt(120), description: text(1000).min(3, 'Describe what was measured'), template: z.enum(TEMPLATES).default('VOLUME'), nos: dim, length: dim, breadth: dim, depth: dim, deduction: z.number().min(0).max(1e10).default(0), qty: z.number().min(0).max(1e10).nullish().transform((v) => v ?? null), uom: opt(20), measuredOn: day, clientCheckRequired: z.boolean().nullish().transform((v) => v ?? null), value: z.number().optional() };
export const parseMbCreate = (b) => parse(z.object({ projectId: id, siteId: oid, ...mbBase }).strict(), b ?? {});
export const parseMbUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(mbBase).map(([k, v]) => [k, nd(v).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseMbCheck = (b) => parse(z.object({ checkedQty: z.number().min(0).max(1e10), checkPct: z.number().min(0).max(100).default(100), checkerName: text(120).min(2), checkerOrg: opt(160), checkedOn: day, signatureRef: opt(160), note: opt(500) }).strict(), b ?? {});
export const parseSuggestQ = (q) => parse(z.object({ projectId: id, boqLineId: id.optional(), activityId: id.optional() }).passthrough(), q ?? {});
export const parseAbstractQ = (q) => parse(z.object({ projectId: id, period: period.optional(), pageSize: z.coerce.number().int().min(1).max(500).optional() }).passthrough(), q ?? {});
export const parsePdfQ = (q) => parse(z.object({ projectId: id, book: id.optional(), from: day.optional(), to: day.optional() }).passthrough(), q ?? {});

// ---- part 22.02: quantity reconciliation, deviation statements, extra items ----
const pct = z.number().min(0).max(100);
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((x) => x === 'true')]).optional();
export const parseReconQ = (q) => parse(z.object({ projectId: id, by: z.enum(['item', 'location']).optional(), locationId: id.optional(), code: text(60).optional(), level: z.enum(['OK', 'APPROACHING', 'OVER', 'FORECAST_OVER']).optional(), deviatingOnly: bool }).passthrough(), q ?? {});
export const parseDetailQ = (q) => parse(z.object({ projectId: id, code: text(60).min(1) }).passthrough(), q ?? {});
export const parseForecast = (b) => parse(z.object({ projectId: id, boqLineId: id, forecastQty: z.number().min(0).max(1e10), basis: text(500).min(5, 'Say on what the forecast is based (at least 5 characters)') }).strict(), b ?? {});
export const parseCandQ = (q) => parse(z.object({ projectId: id, thresholdPct: z.coerce.number().min(0).max(100).optional() }).passthrough(), q ?? {});
const dsItem = z.object({ boqLineId: id, reason: text(500).min(5, 'Give the reason for the deviation (at least 5 characters)') }).strict();
const dsBase = { siteId: oid, contractId: oid, period, thresholdPct: pct.nullish().transform((v) => v ?? null), notes: opt(2000), items: z.array(dsItem).min(1, 'List at least one item').max(200) };
export const parseDsCreate = (b) => parse(z.object({ projectId: id, ...dsBase }).strict(), b ?? {});
export const parseDsUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(dsBase).filter(([k]) => k !== 'siteId').map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseDsSend = (b) => parse(z.object({ sentOn: day, clientRef: opt(120) }).strict(), b ?? {});
export const parseDsRespond = (b) => parse(z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']), respondedOn: day, clientRef: opt(120), outcome: z.enum(['VARIATION', 'RATE_REVISION']).optional() }).strict().refine((v) => v.decision !== 'ACCEPTED' || v.outcome, { message: 'Say whether the accepted deviation leads to a variation order or to a rate revision', path: ['outcome'] }), b ?? {});
const xiBase = { siteId: oid, kind: z.enum(['EXTRA', 'SUBSTITUTE']), description: text(500).min(3, 'Describe the item'), uom: text(20).min(1, 'Give the unit'), qty: z.number().gt(0).max(1e10), rate: z.number().min(0).max(1e9).default(0), substitutesBoqLineId: oid, reason: text(1000).min(5, 'Give the reason (at least 5 characters)'), instructionRef: opt(120), dsId: oid };
export const parseXiCreate = (b) => parse(z.object({ projectId: id, ...xiBase }).strict(), b ?? {});
export const parseXiUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(xiBase).filter(([k]) => k !== 'siteId').map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseXiDecide = (b) => parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), decidedOn: day, decisionRef: opt(120), note: opt(500) }).strict(), b ?? {});
export const parseImport = (b) => parse(z.object({ rows: z.array(z.record(z.string(), z.any())).max(500) }).passthrough(), b ?? {});

// ---- part 22.03: the client RA bill ----
const manualDed = z.object({ kind: z.enum(['SECURED_ADVANCE', 'CLIENT_MATERIAL', 'WATER_ELECTRICITY', 'OTHER']), label: opt(120), amount: z.number().gt(0).max(1e11), reason: text(300).min(3, 'Say what the recovery is for') }).strict();
const cbBase = { siteId: oid, billType: z.enum(['RA', 'FINAL', 'ESCALATION', 'MILESTONE']).default('RA'), periodFrom: day, periodTo: day, supply: z.enum(['intra', 'inter']).default('intra'), gstPct: pct.nullish().transform((v) => v ?? null), manual: z.array(manualDed).max(30).default([]), ldAmount: z.number().min(0).max(1e11).nullish().transform((v) => v ?? 0), notes: opt(2000) };
export const parseCbCreate = (b) => parse(z.object({ projectId: id, contractId: id, ...cbBase, net: z.number().optional() }).strict(), b ?? {});
export const parseCbPreview = (b) => parse(z.object({ projectId: id, contractId: id, ...cbBase }).strict(), b ?? {});
export const parseCbUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(cbBase).filter(([k]) => k !== 'siteId').map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseCbSend = (b) => parse(z.object({ sentOn: day, clientRef: opt(120) }).strict(), b ?? {});

// ---- part 22.04: certification and tax invoice ----
const certItem = z.object({ lineNo: z.number().int().min(1), certifiedQty: z.number().min(0).max(1e10), reason: opt(300), carryForward: z.boolean().default(false) }).strict();
const certDed = z.object({ kind: z.enum(['RETENTION', 'ADVANCE_RECOVERY', 'SECURED_ADVANCE', 'CLIENT_MATERIAL', 'WATER_ELECTRICITY', 'CESS', 'TDS', 'GST_TDS', 'LD', 'OTHER']), label: opt(120), certified: z.number().min(0).max(1e11), reason: opt(300) }).strict();
const certBase = { items: z.array(certItem).max(2000).default([]), escalation: z.number().min(-1e11).max(1e11).nullish().transform((v) => v ?? null), escalationReason: opt(300), deductions: z.array(certDed).max(40).default([]), certDate: day, fileRef: opt(200), notes: opt(2000) };
export const parseCertCreate = (b) => parse(z.object({ billId: id, siteId: oid, certNo: text(60).min(1, 'Give the certificate number'), ...certBase, certifiedNet: z.number().optional() }).strict(), b ?? {});
export const parseCertPreview = (b) => parse(z.object({ billId: id, ...certBase }).strict(), b ?? {});
export const parseCertUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(certBase).map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseCertAnalysisQ = (q) => parse(z.object({ projectId: id, from: day.optional(), to: day.optional(), differencesOnly: bool }).passthrough(), q ?? {});
export const parseBillIdQ = (q) => parse(z.object({ billId: id }).passthrough(), q ?? {});
const tiBase = { siteId: oid, certificationId: oid, billId: oid, gstinFrom: text(15), gstinTo: text(15), sacCode: opt(10), description: opt(300) };
export const parseTiCreate = (b) => parse(z.object({ ...tiBase, total: z.number().optional() }).strict(), b ?? {});
export const parseTiPreview = (b) => parse(z.object(tiBase).strict(), b ?? {});
export const parseTiUpdate = (b) => defined(parse(z.object({ gstinFrom: text(15).optional(), gstinTo: text(15).optional(), sacCode: opt(10).optional(), description: opt(300).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseIrn = (b) => parse(z.object({ irn: z.string().regex(/^[0-9a-f]{64}$/i, 'The IRN has 64 hexadecimal characters'), ackNo: text(40).min(1), ackDate: day }).strict(), b ?? {});

// ---- part 22.05: subcontractor measurement and bills ----
const smBase = { woItemId: id, locationId: oid, description: text(500).min(3, 'Describe what was measured'), template: z.enum(TEMPLATES).default('QTY'), nos: dim, length: dim, breadth: dim, depth: dim, deduction: z.number().min(0).max(1e10).default(0), qty: z.number().min(0).max(1e10).nullish().transform((v) => v ?? null), measuredOn: day };
export const parseSmCreate = (b) => parse(z.object({ woId: id, siteId: oid, ...smBase }).strict(), b ?? {});
export const parseSmUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(smBase).filter(([k]) => k !== 'woItemId').map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseSmSign = (b) => parse(z.object({ signer: text(120).min(2, 'Give the name of the person who signed'), signedOn: day, signatureRef: opt(160), method: z.enum(['MANUAL', 'OTP', 'PORTAL']).default('MANUAL') }).strict(), b ?? {});
const sbManual = z.object({ kind: z.literal('OTHER').default('OTHER'), label: opt(120), amount: z.number().gt(0).max(1e11), reason: text(300).min(3, 'Say what the recovery is for') }).strict();
const sbBase = { billType: z.enum(['RA', 'FINAL', 'MILESTONE']).default('RA'), periodFrom: day, periodTo: day, manual: z.array(sbManual).max(30).default([]), notes: opt(2000) };
export const parseSbCreate = (b) => parse(z.object({ woId: id, siteId: oid, ...sbBase, net: z.number().optional() }).strict(), b ?? {});
export const parseSbPreview = (b) => parse(z.object({ woId: id, ...sbBase }).strict(), b ?? {});
export const parseSbUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(sbBase).map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));

// ---- part 22.06: vendor invoices and the invoice hub ----
const viLine = z.object({ poLineId: oid, description: opt(300), uom: opt(20), hsn: opt(12), qty: z.number().gt(0).max(1e10), rate: z.number().min(0).max(1e10), gstPct: z.number().min(0).max(100) }).strict();
const viBase = { projectId: oid, siteId: oid, invoiceKind: z.enum(['PO', 'SERVICE', 'HIRE']).default('PO'), vendorId: id, poId: oid, serviceEntryId: oid, hireBillId: oid, vendorGstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Not a valid GSTIN').nullish().transform((x) => x || null), invoiceNo: text(40).min(1, 'Give the invoice number'), invoiceDate: day, source: z.enum(['MANUAL', 'PORTAL', 'EMAIL', 'OCR']).default('MANUAL'), declaredTotal: z.number().min(0).max(1e12).nullish().transform((x) => x ?? null), irn: z.string().regex(/^[0-9a-fA-F]{64}$/, 'The IRN has 64 hexadecimal characters').nullish().transform((x) => x || null), overrideReason: opt(500), notes: opt(2000), lines: z.array(viLine).min(1, 'Add at least one line').max(500) };
export const parseViCreate = (b) => parse(z.object(viBase).strict(), b ?? {});
export const parseViPreview = (b) => parse(z.object(Object.fromEntries(Object.entries(viBase).filter(([k]) => !['overrideReason', 'notes', 'irn', 'source', 'siteId'].includes(k)))).strict(), b ?? {});
export const parseViUpdate = (b) => defined(parse(z.object({ invoiceNo: text(40).min(1).optional(), invoiceDate: day.optional(), vendorGstin: viBase.vendorGstin.optional(), declaredTotal: viBase.declaredTotal.optional(), irn: viBase.irn.optional(), overrideReason: viBase.overrideReason.optional(), notes: viBase.notes.optional(), lines: viBase.lines.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseViResolve = (b) => parse(z.object({ kind: z.enum(['DEBIT_NOTE', 'PO_AMENDMENT', 'REJECT']), note: text(500).min(5, 'Say what was decided (at least 5 characters)'), ref: opt(120) }).strict(), b ?? {});
export const parseHubQ = (q) => parse(z.object({ projectId: id.optional(), type: z.enum(['CLIENT', 'SUBCONTRACTOR', 'VENDOR']).optional(), stage: z.string().max(30).optional(), from: day.optional(), to: day.optional() }).passthrough(), q ?? {});

// ---- part 22.07: retention, advances and releases ----
const advBase = { projectId: id, siteId: oid, direction: z.enum(['RECEIVED', 'GIVEN']), partyType: z.enum(['CLIENT', 'SUBCONTRACTOR', 'VENDOR']), partyId: id, contractId: oid, woId: oid, poId: oid, refNo: text(60).min(1, 'Give the reference of the advance'), type: z.enum(['MOBILISATION', 'MACHINERY', 'SECURED', 'MATERIAL', 'OTHER']), amount: z.number().gt(0).max(1e12), advanceDate: day, ruleMode: z.enum(['PCT_OF_BILL', 'FIXED']).default('PCT_OF_BILL'), rulePct: pct.default(0), ruleFixed: z.number().min(0).max(1e12).default(0), interestPct: pct.default(0), bgId: oid, notes: opt(2000) };
export const parseAdvCreate = (b) => parse(z.object(advBase).strict(), b ?? {});
export const parseAdvUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(advBase).filter(([k]) => !['projectId', 'siteId', 'direction', 'partyType', 'partyId', 'contractId', 'woId', 'poId', 'refNo'].includes(k)).map(([k, f]) => [k, nd(f).optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseAdvPreviewQ = (q) => parse(z.object({ bills: z.string().regex(/^[\d.,]+$/, 'Give the bill values as numbers separated by commas').transform((s) => s.split(',').map(Number)), asOf: day.optional() }).passthrough(), q ?? {});
const relBase = { projectId: id, siteId: oid, releaseType: z.enum(['RETENTION', 'SD']), partyType: z.enum(['CLIENT', 'SUBCONTRACTOR']), contractId: oid, woId: oid, basis: z.enum(['COMPLETION', 'DLP_END', 'AGAINST_BG', 'PARTIAL']), amount: z.number().gt(0).max(1e12), bgId: oid, waiverReason: opt(500), notes: opt(2000) };
export const parseRelCreate = (b) => parse(z.object(relBase).strict(), b ?? {});
export const parseRelPreview = (b) => parse(z.object(Object.fromEntries(Object.entries(relBase).filter(([k]) => !['siteId', 'waiverReason', 'notes'].includes(k)))).strict(), b ?? {});
export const parseRelUpdate = (b) => defined(parse(z.object({ basis: relBase.basis.optional(), amount: relBase.amount.optional(), bgId: relBase.bgId.optional(), waiverReason: relBase.waiverReason.optional(), notes: relBase.notes.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseRetentionQ = (q) => parse(z.object({ partyType: z.enum(['CLIENT', 'SUBCONTRACTOR']).optional(), projectId: id.optional(), kind: z.enum(['RETENTION', 'SD']).optional(), scopeId: id.optional() }).passthrough(), q ?? {});

export const parseQsQ = (q) => parse(z.object({ projectId: id.optional() }).passthrough(), q ?? {});
export const parseQsDrillQ = (q) => parse(z.object({ projectId: id.optional(), kind: z.enum(['workNotMeasured', 'measuredNotCertified', 'certifiedNotBilled', 'unbilledWip', 'variationPipeline', 'claimsPending', 'overdueSubmission', 'billedNotCollected', 'mbPending', 'billsToPrepare', 'certAwaited', 'deviationDue']) }).passthrough(), q ?? {});

// ---- part 22.09: the CVR and the control tower ----
const cvrPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-11');
const assess = z.object({
  claims: z.array(z.object({ claimId: id, probabilityPct: z.number().min(0).max(100), note: text(500).nullish() }).strict()).max(200).default([]),
  accruals: z.array(z.object({ label: text(200).min(1), amount: z.number().gt(0).max(1e12), note: text(500).nullish() }).strict()).max(100).default([]),
  valueProvisions: z.array(z.object({ label: text(200).min(1), amount: z.number().gt(0).max(1e12), note: text(500).nullish() }).strict()).max(100).default([]),
  costProvisions: z.array(z.object({ kind: z.enum(['RECTIFICATION', 'DLP', 'OTHER']), amount: z.number().gt(0).max(1e12), note: text(500).nullish() }).strict()).max(100).default([]),
}).strict();
export const parseCvrCreate = (b) => parse(z.object({ projectId: id, siteId: oid, period: cvrPeriod, commentaryQs: opt(2000), assessments: assess.default({ claims: [], accruals: [], valueProvisions: [], costProvisions: [] }) }).strict(), b ?? {});
export const parseCvrPreview = (b) => parse(z.object({ projectId: id, period: cvrPeriod, assessments: assess.default({ claims: [], accruals: [], valueProvisions: [], costProvisions: [] }) }).strict(), b ?? {});
export const parseCvrUpdate = (b) => defined(parse(z.object({ commentaryQs: nd(opt(2000)).optional(), assessments: nd(assess).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseCvrComment = (b) => parse(z.object({ commentary: text(2000).min(5, 'Give the commentary') }).strict(), b ?? {});
export const parseTowerQ = (q) => parse(z.object({ projectId: id.optional() }).passthrough(), q ?? {});
