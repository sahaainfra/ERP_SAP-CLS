import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the stock API (part 16.01). The services check every rule again; quantities have at most three decimals, rates two.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const qty = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals').refine((n) => n > 0, 'Give a quantity above zero');
const money = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
const TYPES = ['CENTRAL_WAREHOUSE', 'SITE_STORE', 'YARD', 'BATCHING_PLANT', 'TRANSIT'];

export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
const storeFields = { name: text(120).min(2), type: z.enum(TYPES), projectId: id.nullish().transform((v) => v || null), siteId: id.nullish().transform((v) => v || null), address: optText(300), keepers: z.array(text(60).min(1)).max(10), valuation: z.enum(['WAVG', 'FIFO']).optional(), allowNegative: z.boolean().optional() };
export const parseStoreCreate = (b) => parse(z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,19}$/, 'Use 2 to 20 letters, digits, - or _'), ...storeFields }).strict(), b ?? {});
export const parseStoreUpdate = (b) => parse(z.object({ ...storeFields, storeType: z.enum(TYPES).optional(), valuationMethod: z.enum(['WAVG', 'FIFO']).optional(), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseStoreChange = (b) => parse(z.object({ reason, storeType: z.enum(TYPES).optional(), valuationMethod: z.enum(['WAVG', 'FIFO']).optional(), allowNegative: z.boolean().optional(), projectId: id.nullish().transform((v) => v || null).optional(), siteId: id.nullish().transform((v) => v || null).optional() }).strict().transform(defined), b ?? {});
export const parseBin = (b) => parse(z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/, 'Use letters, digits, - or _'), zone: optText(30), rack: optText(30), shelf: optText(30), capacity: z.number().finite().min(0).max(1e9).nullish(), isDefault: z.boolean().optional() }).strict(), b ?? {});
export const parseBinUpdate = (b) => parse(z.object({ zone: optText(30), rack: optText(30), shelf: optText(30), capacity: z.number().finite().min(0).max(1e9).nullish(), isDefault: z.boolean().optional() }).partial().strict().transform(defined), b ?? {});
const owner = { ownerProjectId: id.optional(), pool: z.boolean().optional() };
export const parseMovement = (b) => parse(z.object({ storeId: id, binId: id.optional(), itemId: id, batchNo: optText(40), serialNo: optText(60), type: z.enum(['RECEIPT', 'RETURN', 'ISSUE', 'SCRAP']), qty, uom: text(20).min(1).optional(), rate: money.optional(), date: day.optional(), ...owner, reservationId: id.optional(), reason, sourceType: text(40).optional(), sourceId: text(60).optional(), wbsId: id.optional() }).strict().transform(defined), b ?? {});
export const parseTransfer = (b) => parse(z.object({ fromStoreId: id, toStoreId: id, itemId: id, binId: id.optional(), toBinId: id.optional(), batchNo: optText(40), serialNo: optText(60), qty, uom: text(20).min(1).optional(), date: day.optional(), ...owner, toOwnerProjectId: id.optional(), toPool: z.boolean().optional(), reservationId: id.optional(), reason, sourceType: text(40).optional(), sourceId: text(60).optional() }).strict().transform(defined), b ?? {});
export const parseInspection = (b) => parse(z.object({ balanceId: id, action: z.enum(['HOLD', 'RELEASE']), qty, note: optText(300) }).strict(), b ?? {});
const openRow = z.object({ storeCode: text(20).min(2), binCode: optText(20), itemCode: text(40).min(1), batchNo: optText(40), serialNo: optText(60), qty, rate: money, projectCode: optText(30), date: day.optional() }).strict().transform(defined);
export const parseOpening = (b) => parse(z.object({ rows: z.array(openRow).min(1).max(2000) }).strict(), b ?? {});
export const parseReservation = (b) => parse(z.object({ storeId: id, itemId: id, qty, uom: text(20).min(1).optional(), neededBy: day.nullish().transform((v) => v || null), sourceType: z.enum(['WORK_AUTHORISATION', 'MATERIAL_REQUEST', 'TRANSFER', 'OTHER']), sourceId: text(60).min(1), ...owner }).strict().transform(defined), b ?? {});
const adjLine = z.object({ itemId: id, qtyDelta: z.number().finite().refine((n) => n !== 0 && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'A quantity with at most three decimals, not zero').optional(), rate: money.optional(), newRate: money.optional(), binId: id.optional(), batchNo: optText(40), serialNo: optText(60), ownerProjectId: id.optional() }).strict().transform(defined);
export const parseAdjCreate = (b) => parse(z.object({ storeId: id, type: z.enum(['QUANTITY', 'REVALUATION']), reason, lines: z.array(adjLine).min(1).max(200) }).strict(), b ?? {});
export const parseAdjUpdate = (b) => parse(z.object({ type: z.enum(['QUANTITY', 'REVALUATION']), reason, lines: z.array(adjLine).min(1).max(200), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseCardQ = (q) => parse(z.object({ itemId: id, storeId: id.optional(), from: day.optional(), to: day.optional() }).strict(), q ?? {});
export const parseValuationQ = (q) => parse(z.object({ groupBy: z.enum(['store', 'project', 'category']).optional(), storeId: id.optional(), projectId: id.optional(), categoryId: id.optional() }).strict(), q ?? {});
export const parseDashQ = (q) => parse(z.object({ projectId: id.optional() }).strict(), q ?? {});
export const parseResQ = (q) => parse(z.object({ storeId: id.optional(), itemId: id.optional(), status: z.enum(['ACTIVE', 'CONSUMED', 'RELEASED']).optional() }).strict(), q ?? {});
export const parseItemsQ = (q) => parse(z.object({ q: text(60).optional(), ids: z.string().regex(/^\d+(,\d+)*$/).optional() }).strict(), q ?? {});

// ---- gate control (part 16.02) ----
const vehicle = z.string().trim().min(4, 'Give the vehicle number').max(20).regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, 'Use letters, digits, spaces or -');
const phone = optText(15).refine((v) => v == null || /^\+?\d{7,14}$/.test(v), 'Give 7 to 14 digits');
const wt = z.number().finite().min(0.001).max(1e6).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const inwardFields = { vehicleNo: vehicle, driverName: text(80).min(2), driverPhone: phone, transporter: optText(120), vendorId: id.nullish().transform((v) => v || null), poId: id.nullish().transform((v) => v || null), shipmentId: id.nullish().transform((v) => v || null), appointmentId: id.nullish().transform((v) => v || null), challanNo: optText(40), challanDate: day.nullish().transform((v) => v || null), challanKg: wt.nullish(), ewayBillNo: optText(20), materialDesc: text(300).min(3) };
export const parseInwardCreate = (b) => parse(z.object({ siteId: id, ...inwardFields, itemIds: z.array(id).max(50).optional() }).strict().transform(defined), b ?? {});
export const parseInwardUpdate = (b) => parse(z.object({ ...inwardFields, rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseGateCheck = (b) => parse(z.object({ siteId: id, poId: id.nullish().transform((v) => v || null), vendorId: id.nullish().transform((v) => v || null), challanNo: optText(40), itemIds: z.array(id).max(50).optional() }).strict().transform(defined), b ?? {});
export const parseWeigh = (b) => parse(z.object({ grossKg: wt.optional(), tareKg: wt.optional(), source: z.enum(['MANUAL', 'DEVICE']).optional(), deviceRef: optText(60), slipFileId: id.optional() }).strict().refine((v) => v.grossKg != null || v.tareKg != null, { message: 'Give the gross or the tare weight' }).transform(defined), b ?? {});
export const parseUnload = (b) => parse(z.object({ storeId: id, note: optText(300) }).strict(), b ?? {});
export const parsePhoto = (b) => parse(z.object({ fileId: id, kind: z.enum(['VEHICLE', 'CHALLAN', 'SLIP', 'OTHER']) }).strict(), b ?? {});
const inRow = z.object({ siteCode: text(30).min(1), projectCode: optText(30), vehicleNo: vehicle, driverName: text(80).min(2), driverPhone: phone, transporter: optText(120), materialDesc: text(300).min(3), challanNo: optText(40), ewayBillNo: optText(20), poNo: optText(40) }).strict().transform(defined);
export const parseInwardImport = (b) => parse(z.object({ rows: z.array(inRow).min(1).max(200) }).strict(), b ?? {});
export const parsePoQ = (q) => parse(z.object({ q: text(40).optional(), vendorId: id.optional() }).strict(), q ?? {});
export const parseGateQ = (q) => parse(z.object({ siteId: id.optional() }).strict(), q ?? {});
export const parseVendorQ = (q) => parse(z.object({ q: text(60).optional() }).strict(), q ?? {});
const PTYPES = ['RETURNABLE', 'NON_RETURNABLE', 'SCRAP', 'VENDOR_RETURN'];
const passItem = z.object({ description: text(200).min(2), qty: qty, uom: text(20).min(1), itemId: id.nullish().transform((v) => v || null), assetRef: optText(60), remarks: optText(200) }).strict();
const passFields = { type: z.enum(PTYPES), expectedReturn: day.nullish().transform((v) => v || null), items: z.array(passItem).min(1).max(100), referenceType: optText(30), referenceId: optText(60), vendorId: id.nullish().transform((v) => v || null), vehicleNo: vehicle.nullish().transform((v) => v || null), driverName: optText(80), destination: text(200).min(2), purpose: text(300).min(3) };
export const parsePassCreate = (b) => parse(z.object({ siteId: id, ...passFields }).strict().transform(defined), b ?? {});
export const parsePassUpdate = (b) => parse(z.object({ ...passFields, rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseVerify = (b) => parse(z.object({ code: z.string().trim().min(6).max(60), vehicleNo: vehicle.nullish().transform((v) => v || null) }).strict().transform(defined), b ?? {});
export const parseReturn = (b) => parse(z.object({ note: optText(300) }).strict(), b ?? {});
const pRow = z.object({ siteCode: text(30).min(1), projectCode: optText(30), type: z.enum(PTYPES), expectedReturn: day.nullish().transform((v) => v || null), destination: text(200).min(2), purpose: text(300).min(3), vehicleNo: vehicle.nullish().transform((v) => v || null), driverName: optText(80), description: text(200).min(2), qty, uom: text(20).min(1) }).strict().transform(defined);
export const parsePassImport = (b) => parse(z.object({ rows: z.array(pRow).min(1).max(200) }).strict(), b ?? {});
export const parseApptCreate = (b) => parse(z.object({ siteId: id, expectedOn: day, slot: optText(30), vendorId: id.nullish().transform((v) => v || null), poId: id.nullish().transform((v) => v || null), vehicleNo: vehicle.nullish().transform((v) => v || null), driverName: optText(80), driverPhone: phone, materialDesc: optText(300) }).strict().transform(defined), b ?? {});

// ---- goods receipt and returns to vendor (part 16.03) ----
const rqty = z.number().finite().min(0.001).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const zqty = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const grnLine = z.object({ poLineId: id.nullish().transform((v) => v || undefined), itemId: id.optional(), uom: text(20).min(1).optional(), rate: money.optional(), challanQty: zqty.optional(), receivedQty: rqty, acceptedQty: zqty.optional(), batchNo: optText(40), heatNo: optText(40), mfgDate: day.nullish().transform((v) => v || null), certFileId: id.nullish().transform((v) => v || null), inspectionRequired: z.boolean().optional(), wbsId: id.nullish().transform((v) => v || null), costCodeId: id.nullish().transform((v) => v || null) }).strict().transform(defined);
const grnHead = { challanNo: optText(40), challanDate: day.nullish().transform((v) => v || null), invoiceNo: optText(40), receivedDate: day.optional() };
export const parseGrnCreate = (b) => parse(z.object({ storeId: id.optional(), gateInwardId: id.optional(), poId: id.optional(), vendorId: id.optional(), emergency: z.boolean().optional(), emergencyWhy: optText(500), ...grnHead, lines: z.array(grnLine).min(1).max(200) }).strict().transform(defined), b ?? {});
export const parseGrnUpdate = (b) => parse(z.object({ ...grnHead, lines: z.array(grnLine).min(1).max(200), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parsePrefillQ = (q) => parse(z.object({ gateInwardId: id.optional(), poId: id.optional() }).strict(), q ?? {});
export const parseGrnPhoto = (b) => parse(z.object({ fileId: id, kind: z.enum(['MATERIAL', 'CHALLAN', 'DAMAGE', 'OTHER']) }).strict(), b ?? {});
export const parseGrnCert = (b) => parse(z.object({ lineId: id, fileId: id }).strict(), b ?? {});
export const parseGrnAmend = (b) => parse(z.object({ reason, ...grnHead }).strict().transform(defined), b ?? {});
export const parseInspect = (b) => parse(z.object({ results: z.array(z.object({ lineId: id, passedQty: zqty.optional(), failedQty: zqty.optional(), note: optText(300) }).strict()).min(1).max(200) }).strict(), b ?? {});
const gImp = z.object({ storeCode: text(20).min(2), poNo: text(40).min(1), itemCode: text(40).min(1), challanNo: optText(40), receivedQty: rqty, acceptedQty: zqty.optional(), batchNo: optText(40) }).strict().transform(defined);
export const parseGrnImport = (b) => parse(z.object({ rows: z.array(gImp).min(1).max(500) }).strict(), b ?? {});
const rtvLine = z.object({ grnLineId: id, qty: rqty, note: optText(200) }).strict();
export const parseRtvCreate = (b) => parse(z.object({ grnId: id, reason, lines: z.array(rtvLine).min(1).max(100) }).strict(), b ?? {});
export const parseRtvUpdate = (b) => parse(z.object({ reason, lines: z.array(rtvLine).min(1).max(100), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
const rImp = z.object({ grnNo: text(40).min(1), itemCode: text(40).min(1), qty: rqty, reason }).strict();
export const parseRtvImport = (b) => parse(z.object({ rows: z.array(rImp).min(1).max(500) }).strict(), b ?? {});

// ---- material issue, site returns and the free-issue ledger (part 16.04) ----
const issueLine = z.object({ itemId: id, qty: rqty, uom: text(20).min(1).optional(), batchNo: optText(40), chargeRate: z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals').optional() }).strict().transform(defined);
const issuedTo = z.object({ type: z.enum(['CREW', 'SUBCONTRACTOR', 'EQUIPMENT', 'PERSON']), id: id.nullish().transform((v) => v || undefined), name: optText(120) }).strict().transform(defined);
const ITYPES = ['OWN_CREW', 'SUBCO_FREE', 'SUBCO_CHARGEABLE', 'EQUIPMENT'];
const issueHead = { waId: id.nullish().transform((v) => v || undefined), mrId: id.nullish().transform((v) => v || undefined), activityId: id.nullish().transform((v) => v || undefined), wbsId: id.nullish().transform((v) => v || undefined), costCodeId: id.nullish().transform((v) => v || undefined), projectId: id.optional(), receiverUser: optText(60), reason: optText(500) };
export const parseIssueCreate = (b) => parse(z.object({ storeId: id, type: z.enum(ITYPES), issuedTo, ...issueHead, lines: z.array(issueLine).min(1).max(100) }).strict().transform(defined), b ?? {});
export const parseIssueUpdate = (b) => parse(z.object({ type: z.enum(ITYPES), issuedTo, wbsId: id.nullish().transform((v) => v || undefined), costCodeId: id.nullish().transform((v) => v || undefined), receiverUser: optText(60), reason: optText(500), lines: z.array(issueLine).min(1).max(100), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseIssuePrefillQ = (q) => parse(z.object({ waId: id.optional(), mrId: id.optional() }).strict(), q ?? {});
export const parseTargetQ = (q) => parse(z.object({ q: text(60).optional() }).strict(), q ?? {});
export const parseAck = (b) => parse(z.object({ method: z.enum(['OTP', 'SIGNATURE']), otp: z.string().trim().regex(/^\d{6}$/, 'The code has six digits').optional(), receiverName: optText(120), signatureFileId: id.optional() }).strict().transform(defined).superRefine((v, c) => { if (v.method === 'OTP' && !v.otp) c.addIssue({ code: 'custom', path: ['otp'], message: 'Type the code the receiver reads out' }); }), b ?? {});
const iImp = z.object({ storeCode: text(20).min(2), waNo: text(40).min(1), crewName: text(120).min(2), itemCode: text(40).min(1), qty: rqty, batchNo: optText(40) }).strict().transform(defined);
export const parseIssueImport = (b) => parse(z.object({ rows: z.array(iImp).min(1).max(500) }).strict(), b ?? {});
const CONDS = ['GOOD', 'DAMAGED', 'SCRAP'];
const retLine = z.object({ issueLineId: id, qty: rqty }).strict();
export const parseReturnCreate = (b) => parse(z.object({ issueId: id, condition: z.enum(CONDS), reason, lines: z.array(retLine).min(1).max(100) }).strict(), b ?? {});
export const parseReturnUpdate = (b) => parse(z.object({ condition: z.enum(CONDS), reason, lines: z.array(retLine).min(1).max(100), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
const rImp2 = z.object({ issueNo: text(40).min(1), itemCode: text(40).min(1), qty: rqty, condition: z.enum(CONDS), reason }).strict();
export const parseReturnImport = (b) => parse(z.object({ rows: z.array(rImp2).min(1).max(500) }).strict(), b ?? {});
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-12');
export const parseFreeIssueQ = (q) => parse(z.object({ projectId: id.optional(), period: period.optional(), subcontractorId: id.optional() }).strict(), q ?? {});
export const parseReconcile = (b) => parse(z.object({ projectId: id, period }).strict(), b ?? {});
export const parseDrillQ = (q) => parse(z.object({ projectId: id, subcontractorId: id, itemId: id }).strict(), q ?? {});
export const parseCertify = (b) => parse(z.object({ rows: z.array(z.object({ projectId: id, subcontractorId: id, boqLineId: id, period, certifiedQty: zqty, certificateRef: optText(60) }).strict()).min(1).max(500) }).strict(), b ?? {});

// ---- inter-store transfers (part 16.05) ----
const trLine = z.object({ itemId: id, qty: rqty, uom: text(20).min(1).optional(), batchNo: optText(40) }).strict().transform(defined);
export const parseTransferCreate = (b) => parse(z.object({ fromStoreId: id, toStoreId: id, requiredBy: day.nullish().transform((v) => v || null), mrId: id.nullish().transform((v) => v || undefined), interState: z.boolean().optional(), reason: optText(500), lines: z.array(trLine).min(1).max(200) }).strict().transform(defined), b ?? {});
export const parseTransferUpdate = (b) => parse(z.object({ requiredBy: day.nullish().transform((v) => v || null), interState: z.boolean(), reason: optText(500), lines: z.array(trLine).min(1).max(200), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseTransferPrefillQ = (q) => parse(z.object({ mrId: id }).strict(), q ?? {});
export const parseDispatch = (b) => parse(z.object({ vehicleNo: vehicle.nullish().transform((v) => v || null), driverName: optText(80), ewayBillNo: optText(20), interState: z.boolean().optional(), lines: z.array(z.object({ lineId: id, qty: rqty }).strict()).max(200).optional() }).strict().transform(defined), b ?? {});
export const parseReceive = (b) => parse(z.object({ final: z.boolean().optional(), lines: z.array(z.object({ lineId: id, receivedQty: zqty.optional(), damagedQty: zqty.optional(), note: optText(300) }).strict()).min(1).max(200) }).strict().transform(defined), b ?? {});
export const parseTransferPhoto = (b) => parse(z.object({ fileId: id, kind: z.enum(['MATERIAL', 'DAMAGE', 'CHALLAN', 'OTHER']) }).strict(), b ?? {});
export const parseResolve = (b) => parse(z.object({ action: z.enum(['WRITE_OFF', 'RETURN_TO_SOURCE', 'ACCEPT']), note: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500) }).strict(), b ?? {});
const tImp = z.object({ fromStore: text(20).min(2), toStore: text(20).min(2), itemCode: text(40).min(1), qty: rqty }).strict();
export const parseTransferImport = (b) => parse(z.object({ rows: z.array(tImp).min(1).max(500) }).strict(), b ?? {});
export const parseTransitQ = (q) => parse(z.object({ storeId: id.optional(), projectId: id.optional() }).strict(), q ?? {});

// ---- physical verification and scrap (part 16.06) ----
export const parseCountCreate = (b) => parse(z.object({ storeId: id, type: z.enum(['FULL', 'CYCLE']), abcClass: z.enum(['A', 'B', 'C']).optional(), scheduledDate: day, freeze: z.boolean().optional(), itemIds: z.array(id).max(500).optional() }).strict().transform(defined), b ?? {});
export const parseCountUpdate = (b) => parse(z.object({ scheduledDate: day, abcClass: z.enum(['A', 'B', 'C']), freeze: z.boolean(), itemIds: z.array(id).max(500), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseCounts = (b) => parse(z.object({ recount: z.boolean().optional(), lines: z.array(z.object({ lineId: id, qty: zqty }).strict()).min(1).max(500) }).strict().transform(defined), b ?? {});
export const parseReasons = (b) => parse(z.object({ reasons: z.array(z.object({ lineId: id, reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300) }).strict()).min(1).max(500) }).strict(), b ?? {});
export const parseCountImport = (b) => parse(z.object({ planId: id, rows: z.array(z.object({ itemCode: text(40).min(1), bin: optText(20), batchNo: optText(40), qty: zqty }).strict().transform(defined)).min(1).max(1000) }).strict(), b ?? {});
export const parseVarianceQ = (q) => parse(z.object({ planId: id.optional(), storeId: id.optional() }).strict(), q ?? {});
const SRC = ['CUT_PIECES', 'DAMAGED', 'EXPIRED', 'COUNT_LOSS', 'OTHER'];
export const parseScrapEntry = (b) => parse(z.object({ storeId: id, source: z.enum(SRC), description: text(200).min(2), itemId: id.optional(), batchNo: optText(40), qty: rqty, uom: text(20).min(1).optional(), weightKg: zqty.optional(), fromStock: z.boolean().optional() }).strict().transform(defined), b ?? {});
const DM = ['SALE', 'AUCTION', 'WRITE_OFF'];
export const parseDisposalCreate = (b) => parse(z.object({ storeId: id, method: z.enum(DM), buyerPartnerId: id.optional(), invoiceNo: optText(40), amount: money.optional(), reason: optText(500), entryIds: z.array(id).min(1).max(200) }).strict().transform(defined), b ?? {});
export const parseDisposalUpdate = (b) => parse(z.object({ method: z.enum(DM), buyerPartnerId: id, invoiceNo: optText(40), amount: money, reason: optText(500), rowVersion: z.number().int().optional() }).partial().strict().transform(defined), b ?? {});
export const parseScrapImport = (b) => parse(z.object({ rows: z.array(z.object({ storeCode: text(20).min(2), source: z.enum(SRC), description: text(200).min(2), qty: rqty, uom: text(20).min(1), weightKg: zqty.optional() }).strict().transform(defined)).min(1).max(500) }).strict(), b ?? {});
export const parseExpiryQ = (q) => parse(z.object({ storeId: id.optional(), all: z.enum(['1']).optional() }).strict().transform((v) => ({ ...v, all: v.all === '1' })), q ?? {});

// ---- part 16.07: reorder control, ageing and labels ----
const rq0 = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const reorderLine = z.object({ itemId: id, minQty: rq0, maxQty: rq0, reorderLevel: rq0, reorderQty: rq0, leadDays: z.number().int().min(0).max(365).default(0), autoCalc: z.boolean().default(false) }).strict();
export const parseReorderChange = (b) => parse(z.object({ storeId: id, effectiveFrom: day.optional(), reason: optText(500), lines: z.array(reorderLine).min(1).max(500) }).strict().transform(defined), b ?? {});
export const parseReorderChangeUpdate = (b) => parse(z.object({ effectiveFrom: day, reason: optText(500), lines: z.array(reorderLine).min(1).max(500), rowVersion: z.number().int() }).partial().strict().transform(defined), b ?? {});
export const parseReorderRecalc = (b) => parse(z.object({ storeId: id }).strict(), b ?? {});
export const parseReorderImport = (b) => parse(z.object({ rows: z.array(z.object({ storeCode: text(20).min(2), itemCode: text(40).min(1), minQty: rq0, maxQty: rq0, reorderLevel: rq0, reorderQty: rq0, leadDays: z.number().int().min(0).max(365).optional(), autoCalc: z.boolean().optional() }).strict().transform(defined)).min(1).max(1000) }).strict(), b ?? {});
export const parseReorderParamsQ = (q) => parse(z.object({ storeId: id.optional() }).strict().transform(defined), q ?? {});
export const parseSuggestionConvert = (b) => parse(z.object({ ids: z.array(id).min(1).max(200) }).strict(), b ?? {});
export const parseAgeingQ = (q) => parse(z.object({ storeId: id.optional(), itemId: id.optional(), class: z.enum(['ACTIVE', 'SLOW', 'NON_MOVING']).optional() }).strict().transform(defined), q ?? {});
export const parseLabelTargetsQ = (q) => parse(z.object({ q: text(60).optional(), storeId: id.optional() }).strict().transform(defined), q ?? {});
export const parseLabelPrint = (b) => parse(z.object({ type: z.enum(['ITEM', 'BIN', 'BATCH']), format: z.enum(['THERMAL', 'A4']), copies: z.number().int().min(1).max(100).default(1), storeId: id.optional(), refs: z.array(z.object({ itemId: id.optional(), binId: id.optional(), batchNo: text(40).optional() }).strict().transform(defined)).min(1).max(200) }).strict().transform(defined), b ?? {});
export const parseScanQ = (q) => parse(z.object({ code: text(120).min(1) }).strict(), q ?? {});

// ---- part 16.08: returnable site assets ----
const rtaQty = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const moveFields = { type: z.enum(['RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER', 'HIRE_IN', 'HIRE_OUT', 'REPAIR_OUT', 'REPAIR_IN']), itemId: id, qty: rtaQty.optional(), movementDate: day.optional(), fromStoreId: id.optional(), toStoreId: id.optional(), partyId: id.optional(), vendorId: id.optional(), holdingId: id.optional(), projectId: id.optional(), siteId: id.optional(), workFront: optText(80), waId: id.optional(), ownership: z.enum(['OWNED', 'HIRED']).optional(), hireId: id.optional(), expectedReturn: day.optional(), hireRate: z.number().finite().min(0).max(1e8).optional(), hireBasis: z.enum(['DAY', 'MONTH']).optional(), orderRef: optText(60), reason: optText(500), qtyGood: rtaQty.optional(), qtyRepairable: rtaQty.optional(), qtyScrap: rtaQty.optional(), qtyLost: rtaQty.optional() };
export const parseRtaMovement = (b) => parse(z.object(moveFields).strict().transform(defined), b ?? {});
export const parseRtaMovementUpdate = (b) => parse(z.object({ ...moveFields, rowVersion: z.number().int() }).omit({ type: true }).partial().strict().transform(defined), b ?? {});
export const parseRtaImport = (b) => parse(z.object({ rows: z.array(z.object({ storeCode: text(20).min(2), itemCode: text(40).min(1), qty: rtaQty.refine((n) => n > 0, 'Give a quantity above zero'), date: day.optional() }).strict().transform(defined)).min(1).max(1000) }).strict(), b ?? {});
export const parseRtaAsset = (b) => parse(z.object({ itemId: id, group: z.enum(['FORMWORK', 'SCAFFOLDING', 'OTHER']), unitWeight: rtaQty.optional(), internalRate: money, rateBasis: z.enum(['DAY', 'MONTH']), replacementValue: money, lifeMonths: z.number().int().min(0).max(600).optional() }).strict().transform(defined), b ?? {});
export const parseRtaAssetUpdate = (b) => parse(z.object({ group: z.enum(['FORMWORK', 'SCAFFOLDING', 'OTHER']), unitWeight: rtaQty, internalRate: money, rateBasis: z.enum(['DAY', 'MONTH']), replacementValue: money, lifeMonths: z.number().int().min(0).max(600), rowVersion: z.number().int() }).partial().strict().transform(defined), b ?? {});
export const parseRtaHireQ = (q) => parse(z.object({ kind: z.enum(['HIRE_IN', 'INTERNAL']).optional(), status: z.enum(['OPEN', 'CLOSED']).optional() }).strict().transform(defined), q ?? {});
export const parseRtaBill = (b) => parse(z.object({ billNo: text(40).min(1), billAmount: money }).strict(), b ?? {});
export const parseRtaRecQ = (q) => parse(z.object({ status: z.enum(['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED']).optional() }).strict().transform(defined), q ?? {});
export const parseRtaRecUpdate = (b) => parse(z.object({ disposition: z.enum(['RECOVER', 'WRITE_OFF']), reason: optText(500), rowVersion: z.number().int() }).partial().strict().transform(defined), b ?? {});
export const parseRtaHoldingQ = (q) => parse(z.object({ itemId: id.optional() }).strict().transform(defined), q ?? {});

// ---- part 16.09: tools and small-asset custody ----
const COND = ['NEW', 'GOOD', 'FAIR', 'REPAIRABLE', 'DAMAGED', 'SCRAP'];
const assetFields = { itemId: id, storeId: id, tagCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, 'Use 2 to 40 letters, digits, . _ or -').optional(), serialNo: optText(60), make: optText(60), model: optText(60), purchaseRef: optText(60), purchaseDate: day.nullish().transform((v) => v || null), value: money, condition: z.enum(COND), calibrationRequired: z.boolean(), calibrationDue: day.nullish().transform((v) => v || null), inspectionDays: z.number().int().min(0).max(3650) };
export const parseAssetCreate = (b) => parse(z.object(assetFields).partial({ tagCode: true, serialNo: true, make: true, model: true, purchaseRef: true, purchaseDate: true, value: true, condition: true, calibrationRequired: true, calibrationDue: true, inspectionDays: true }).strict().transform(defined), b ?? {});
export const parseAssetUpdate = (b) => parse(z.object({ ...assetFields, rowVersion: z.number().int() }).partial().strict().transform(defined), b ?? {});
export const parseAssetImport = (b) => parse(z.object({ rows: z.array(z.object({ storeCode: text(20).min(2), itemCode: text(40).min(1), tagCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/).optional(), serialNo: text(60).optional(), make: text(60).optional(), model: text(60).optional(), value: money.optional(), purchaseRef: text(60).optional(), calibrationDue: day.optional() }).strict().transform(defined)).min(1).max(1000) }).strict(), b ?? {});
export const parseAstHandover = (b) => parse(z.object({ custodianType: z.enum(['EMPLOYEE', 'PARTY']), custodianId: id, note: optText(300) }).strict().transform(defined), b ?? {});
export const parseAssetAck = (b) => parse(z.object({ method: z.enum(['OTP', 'SIGNATURE']).default('OTP'), otp: z.string().trim().regex(/^\d{6}$/, 'The code has 6 digits').optional(), signedBy: optText(80) }).strict().transform(defined), b ?? {});
export const parseAstAssetReturn = (b) => parse(z.object({ condition: z.enum(COND), storeId: id.optional(), note: optText(300) }).strict().transform(defined), b ?? {});
export const parseAstInspect = (b) => parse(z.object({ date: day.optional(), passed: z.boolean(), condition: z.enum(COND).optional(), nextDays: z.number().int().min(0).max(3650).optional(), note: optText(300) }).strict().transform(defined), b ?? {});
export const parseAstCalibrate = (b) => parse(z.object({ date: day.optional(), certificateNo: text(60).min(2), lab: optText(120), dueDate: day, note: optText(300) }).strict().transform(defined), b ?? {});
export const parseAstRepairOut = (b) => parse(z.object({ reference: optText(80), note: optText(300) }).strict().transform(defined), b ?? {});
export const parseAstRepairIn = (b) => parse(z.object({ condition: z.enum(COND), cost: money.optional(), reference: optText(80), note: optText(300) }).strict().transform(defined), b ?? {});
export const parseAstDispose = (b) => parse(z.object({ method: z.enum(['SCRAP', 'SALE', 'WRITE_OFF']), amount: money.optional(), reason }).strict().transform(defined), b ?? {});
const lossFieldsZ = { assetId: id, kind: z.enum(['LOSS', 'DAMAGE', 'THEFT']), reportDate: day, description: text(1000).min(5, 'Say what happened'), investigation: optText(2000), recoveryFrom: z.enum(['SALARY', 'SUBCONTRACTOR', 'WRITE_OFF', 'NONE']), recoveryPartyId: id, recoveryAmount: money };
export const parseAstLossCreate = (b) => parse(z.object(lossFieldsZ).partial({ reportDate: true, investigation: true, recoveryFrom: true, recoveryPartyId: true, recoveryAmount: true }).strict().transform(defined), b ?? {});
export const parseAstLossUpdate = (b) => parse(z.object({ ...lossFieldsZ, rowVersion: z.number().int() }).omit({ assetId: true }).partial().strict().transform(defined), b ?? {});
export const parseAstStatementQ = (q) => parse(z.object({ employeeId: id }).strict(), q ?? {});
export const parseAstCalDueQ = (q) => parse(z.object({ days: z.coerce.number().int().min(0).max(365).optional() }).strict().transform(defined), q ?? {});
