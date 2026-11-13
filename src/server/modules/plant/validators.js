import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the plant API (part 17.01). The service checks every rule again.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const opt = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const num3 = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const money = z.number().finite().min(0).max(1e11).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');
const STATES = ['AVAILABLE', 'DEPLOYED', 'UNDER_MAINTENANCE', 'BREAKDOWN', 'IDLE', 'DEMOBILISED', 'DISPOSED'];
const DOC_TYPES = ['RC', 'INSURANCE', 'FITNESS', 'PUC', 'ROAD_PERMIT', 'LOAD_TEST', 'THIRD_PARTY_INSPECTION', 'OTHER'];
const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
const body = {
  assetCode: opt(40), classItemId: id, make: opt(80), model: opt(80), year: z.number().int().min(1950).max(2100).nullish().transform((v) => v ?? null), serialNo: opt(80), chassisNo: opt(80), engineNo: opt(80), regNo: opt(20), capacity: opt(80),
  ownership: z.enum(['OWNED', 'HIRED', 'SUBCONTRACTOR']), ownerPartnerId: id.nullish().transform((v) => v ?? null), purchaseValue: money, purchaseDate: day.nullish().transform((v) => v ?? null),
  meterType: z.enum(['HOURS', 'KM']), fuelType: z.enum(['DIESEL', 'PETROL', 'CNG', 'ELECTRIC', 'NONE']), tankCapacity: num3, fuelNorm: num3, fuelNormUnit: z.enum(['L_PER_HOUR', 'KM_PER_L']), gpsDeviceId: opt(60),
  roadVehicle: z.boolean(), lifting: z.boolean(), operatorRequired: z.boolean(), operatorLicenceClass: opt(40), projectId: id.nullish().transform((v) => v ?? null), siteId: id.nullish().transform((v) => v ?? null), state: z.enum(STATES),
};
export const parseId = (v) => parse(id, v);
export const parseEquipCreate = (b) => parse(z.object({ ...body, ownership: body.ownership.default('OWNED'), purchaseValue: body.purchaseValue.default(0), meterType: body.meterType.default('HOURS'), fuelType: body.fuelType.default('DIESEL'), tankCapacity: body.tankCapacity.default(0), fuelNorm: body.fuelNorm.default(0), roadVehicle: body.roadVehicle.default(false), lifting: body.lifting.default(false), operatorRequired: body.operatorRequired.default(false), state: body.state.default('AVAILABLE') }).strict(), b ?? {});
export const parseEquipUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseReason = (b) => parse(z.object({ reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const parseState = (b) => parse(z.object({ state: z.enum(STATES), projectId: id.nullish().transform((v) => v ?? null), siteId: id.nullish().transform((v) => v ?? null), note: opt(500), rowVersion: z.number().int().optional() }).strict(), b ?? {});
const docBody = { docType: z.enum(DOC_TYPES), number: opt(60), issuer: opt(120), validFrom: day.nullish().transform((v) => v ?? null), validUntil: day.nullish().transform((v) => v ?? null), mandatory: z.boolean().optional() };
export const parseDocCreate = (b) => parse(z.object(docBody).strict(), b ?? {});
export const parseDocUpdate = (b) => defined(parse(z.object({ number: docBody.number.optional(), issuer: docBody.issuer.optional(), validFrom: docBody.validFrom.optional(), validUntil: docBody.validUntil.optional(), mandatory: z.boolean().optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseDocAttach = (b) => parse(z.object({ fileId: id }).strict(), b ?? {});
const importRow = z.object({ classCode: text(60), assetCode: opt(40), make: opt(80), model: opt(80), year: z.number().int().nullish().transform((v) => v ?? null), serialNo: opt(80), chassisNo: opt(80), engineNo: opt(80), regNo: opt(20), capacity: opt(80), ownership: z.enum(['OWNED', 'HIRED', 'SUBCONTRACTOR']).optional(), ownerCode: opt(60), purchaseValue: money.optional(), purchaseDate: day.nullish().transform((v) => v ?? null),
  meterType: z.enum(['HOURS', 'KM']).optional(), fuelType: z.enum(['DIESEL', 'PETROL', 'CNG', 'ELECTRIC', 'NONE']).optional(), tankCapacity: num3.optional(), fuelNorm: num3.optional(), gpsDeviceId: opt(60), roadVehicle: z.boolean().optional(), lifting: z.boolean().optional(), operatorRequired: z.boolean().optional(), projectCode: opt(60), siteCode: opt(60), state: z.enum(STATES).optional(),
  documents: z.array(z.object(docBody).strict()).max(20).optional() }).strict();
export const parseEquipImport = (b) => parse(z.object({ rows: z.array(importRow).min(1).max(2000), submit: z.boolean().optional() }).strict(), b ?? {});
const q = { projectId: id.optional(), siteId: id.optional() };
export const parseDashQ = (v) => parse(z.object(q).strict(), v ?? {});
const KINDS = ['fleet', 'expired', 'expiring', 'nonCompliant', 'pending', ...STATES];
export const parseDrillQ = (v) => parse(z.object({ ...q, kind: z.enum(KINDS) }).strict(), v ?? {});
export const parseExportQ = (v) => parse(z.object({ ...q, kind: z.enum(['register', ...KINDS]).optional() }).strict(), v ?? {});
export const parseScanQ = (v) => parse(z.object({ code: text(80).min(1) }).strict(), v ?? {});

// Requisitions, allocations, operators and the availability calendar (part 17.02).
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']; const BASES = ['HOUR', 'DAY', 'MONTH']; const meter = z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const reqBody = { projectId: id, siteId: id.nullish().transform((v) => v ?? null), classItemId: id, capacity: opt(80), qty: z.number().int().min(1).max(1000), fromDate: day, toDate: day, purpose: text(300).min(3, 'Say what the equipment is for'), activityId: id.nullish().transform((v) => v ?? null), priority: z.enum(PRIORITIES) };
export const parseReqCreate = (b) => parse(z.object({ ...reqBody, qty: reqBody.qty.default(1), priority: reqBody.priority.default('NORMAL') }).strict(), b ?? {});
export const parseReqUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(reqBody).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseHire = (b) => parse(z.object({ qty: z.number().int().min(0).max(1000), reason: text(500).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
const allocBody = { equipmentId: id, projectId: id, siteId: id.nullish().transform((v) => v ?? null), requisitionId: id.nullish().transform((v) => v ?? null), fromDate: day, toDate: day, internalRate: money, rateBasis: z.enum(BASES) };
export const parseAllocCreate = (b) => parse(z.object({ ...allocBody, internalRate: allocBody.internalRate.default(0), rateBasis: allocBody.rateBasis.default('DAY') }).strict(), b ?? {});
export const parseAllocUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(allocBody).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseDates = (b) => parse(z.object({ fromDate: day, toDate: day, rowVersion: z.number().int().optional() }).strict(), b ?? {});
export const parseMobilise = (b) => parse(z.object({ vehicleNo: opt(20), trailerNo: opt(20), driverName: opt(80), gatePassNo: opt(40), dispatchMeter: meter.nullish().transform((v) => v ?? null), dispatchedOn: day.optional(), note: opt(300) }).strict(), b ?? {});
export const parseArrive = (b) => parse(z.object({ arrivalMeter: meter, arrivedOn: day.optional(), checklist: z.array(z.object({ code: text(30), result: z.enum(['PASS', 'FAIL', 'NA']), note: opt(300) }).strict()).max(30) }).strict(), b ?? {});
export const parseDemobilise = (b) => parse(z.object({ departureMeter: meter, departedOn: day.optional(), note: opt(300) }).strict(), b ?? {});
export const parseTransfer = (b) => parse(z.object({ toProjectId: id, toSiteId: id.nullish().transform((v) => v ?? null), onDate: day.optional(), toDate: day.optional(), reason: text(300).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const parseAllocImport = (b) => parse(z.object({ rows: z.array(z.object({ assetCode: text(40), projectCode: text(60), siteCode: opt(60), requisitionNo: opt(40), fromDate: day, toDate: day, internalRate: money.optional(), rateBasis: z.enum(BASES).optional() }).strict()).min(1).max(2000) }).strict(), b ?? {});
export const parseReqImport = (b) => parse(z.object({ rows: z.array(z.object({ projectCode: text(60), siteCode: opt(60), classCode: text(60), capacity: opt(80), qty: z.number().int().min(1).max(1000).optional(), fromDate: day, toDate: day, purpose: text(300).min(3), priority: z.enum(PRIORITIES).optional() }).strict()).min(1).max(2000) }).strict(), b ?? {});
export const parseAvailQ = (v) => parse(z.object({ classItemId: id.optional(), fromDate: day.optional(), toDate: day.optional(), excludeAllocationId: id.optional() }).strict(), v ?? {});
export const parseGanttQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), projectId: id.optional(), classItemId: id.optional() }).strict(), v ?? {});
export const parseAssign = (b) => parse(z.object({ equipmentId: id, allocationId: id.nullish().transform((v) => v ?? null), personType: z.enum(['EMPLOYEE', 'WORKER']), personId: id, shift: z.enum(['GENERAL', 'DAY', 'NIGHT']).default('GENERAL'), fromDate: day, toDate: day }).strict(), b ?? {});
export const parseCandidatesQ = (v) => parse(z.object({ q: text(60).optional() }).strict(), v ?? {});
export const parseOpsQ = (v) => parse(z.object({ on: day.optional() }).strict(), v ?? {});

// Log books, breakdowns and the utilisation report (part 17.03).
const IDLE = ['NO_WORK', 'NO_OPERATOR', 'WEATHER', 'WAITING', 'OTHER']; const SHIFTS = ['GENERAL', 'DAY', 'NIGHT']; const BD = ['MECHANICAL', 'HYDRAULIC', 'ELECTRICAL', 'TYRE', 'ACCIDENT', 'OTHER']; const hrs = z.number().finite().min(0).max(100000).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const optId2 = id.nullish().transform((v) => v ?? null);
const logBody = { equipmentId: id, logDate: day, shift: z.enum(SHIFTS), operator: z.object({ personType: z.enum(['EMPLOYEE', 'WORKER']), personId: id }).strict().nullish().transform((v) => v ?? null), startMeter: hrs, endMeter: hrs, workingHrs: hrs, idleHrs: hrs, idleReason: z.enum(IDLE).nullish().transform((v) => v ?? null), breakdownHrs: hrs, breakdownId: optId2, waId: optId2, activityId: optId2, workQty: hrs, workUom: opt(20), fuelLitres: hrs, fuelRef: opt(60), anomalyNote: opt(300), remarks: opt(300) };
export const parseLogCreate = (b) => parse(z.object({ ...logBody, shift: logBody.shift.default('GENERAL'), workingHrs: logBody.workingHrs.default(0), idleHrs: logBody.idleHrs.default(0), breakdownHrs: logBody.breakdownHrs.default(0), workQty: logBody.workQty.default(0), fuelLitres: logBody.fuelLitres.default(0) }).strict(), b ?? {});
export const parseLogUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(logBody).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseLogAttach = (b) => parse(z.object({ kind: z.enum(['METER', 'VENDOR_SIGNATURE']), fileId: id, vendorRep: opt(80) }).strict(), b ?? {});
export const parseLogImport = (b) => parse(z.object({ rows: z.array(z.object({ assetCode: text(40), logDate: day, shift: z.enum(SHIFTS).optional(), startMeter: hrs, endMeter: hrs, workingHrs: hrs.optional(), idleHrs: hrs.optional(), idleReason: z.enum(IDLE).nullish().transform((v) => v ?? null), breakdownHrs: hrs.optional(), workQty: hrs.optional(), workUom: opt(20), fuelLitres: hrs.optional(), remarks: opt(300) }).strict()).min(1).max(2000) }).strict(), b ?? {});
export const parseLogOptionsQ = (v) => parse(z.object({ equipmentId: id.optional(), date: day.optional() }).strict(), v ?? {});
export const parseBdReport = (b) => parse(z.object({ equipmentId: id, category: z.enum(BD), description: text(500).min(5, 'Say what happened (at least 5 characters)'), reportedOn: day.optional() }).strict(), b ?? {});
export const parseBdResolve = (b) => parse(z.object({ resolution: text(500).min(5, 'Say what was done (at least 5 characters)'), resolvedOn: day.optional() }).strict(), b ?? {});
export const parseUtilQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), groupBy: z.enum(['equipment', 'class', 'site']).optional(), projectId: id.optional(), siteId: id.optional(), classItemId: id.optional(), kind: z.enum(['utilisation', 'logs']).optional() }).strict(), v ?? {});
export const parseUtilDrillQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), projectId: id.optional(), siteId: id.optional(), classItemId: id.optional(), equipmentId: id.optional() }).strict(), v ?? {});

// Fuel: tanks, receipts, issues, dips, the reports and the anomalies (part 17.04).
const FUEL = ['DIESEL', 'PETROL', 'CNG']; const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Use a date and time such as 2026-12-01T09:30');
const litres = z.number().finite().min(0).max(1e7).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'At most three decimals');
const tankBody = { code: text(30).min(1), name: text(120).min(1), type: z.enum(['TANK', 'BOWSER', 'CARD']), fuelType: z.enum(FUEL), projectId: id.nullish().transform((v) => v ?? null), siteId: id.nullish().transform((v) => v ?? null), capacity: litres, openingLitres: litres, openingDate: day, openingRate: money, cardNo: opt(40) };
export const parseTankCreate = (b) => parse(z.object({ ...tankBody, capacity: tankBody.capacity.default(0), openingLitres: tankBody.openingLitres.default(0), openingRate: tankBody.openingRate.default(0), openingDate: tankBody.openingDate.optional() }).strict(), b ?? {});
export const parseTankUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(tankBody).map(([k, v]) => [k, v.optional()])), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseFuelReceive = (b) => parse(z.object({ source: z.enum(['GRN', 'PUMP']), grnNo: opt(40), billNo: opt(60), pettyRef: opt(60), litres: litres.refine((n) => n > 0, 'Give the litres'), rate: money.nullish().transform((v) => v ?? null), vendorId: id.nullish().transform((v) => v ?? null), receiptDate: day.optional(), receivedBy: opt(80) }).strict(), b ?? {});
export const parseReceiptsQ = (v) => parse(z.object({ tankId: id.optional(), from: day.optional(), to: day.optional() }).strict(), v ?? {});
const issueBody = { tankId: id, equipmentId: id, issueAt: stamp, meterReading: litres, litres: litres.refine((n) => n > 0, 'Give the litres'), fullTank: z.boolean(), noAdvanceReason: opt(200), issuedBy: opt(80), receivedBy: text(80) };
export const parseFuelIssueCreate = (b) => parse(z.object({ ...issueBody, issueAt: issueBody.issueAt.optional(), fullTank: issueBody.fullTank.default(true), receivedBy: opt(80) }).strict(), b ?? {});
export const parseFuelIssueUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(issueBody).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseFuelIssueAttach = (b) => parse(z.object({ fileId: id }).strict(), b ?? {});
export const parseFuelIssueImport = (b) => parse(z.object({ rows: z.array(z.object({ assetCode: text(40), tankCode: text(30), issueAt: stamp, meterReading: litres, litres: litres.refine((n) => n > 0, 'Give the litres'), receivedBy: text(80), issuedBy: opt(80), fullTank: z.boolean().optional(), noAdvanceReason: opt(200) }).strict()).min(1).max(2000) }).strict(), b ?? {});
export const parseDipRecord = (b) => parse(z.object({ tankId: id, dipDate: day.optional(), dipLitres: litres, note: opt(300) }).strict(), b ?? {});
export const parseFuelReconQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), tankId: id.optional(), projectId: id.optional() }).strict(), v ?? {});
export const parseFuelConsQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), groupBy: z.enum(['equipment', 'class', 'project']).optional(), projectId: id.optional(), classItemId: id.optional() }).strict(), v ?? {});
export const parseFuelDrillQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), projectId: id.optional(), classItemId: id.optional(), equipmentId: id.optional() }).strict(), v ?? {});
export const parseFuelExportQ = (v) => parse(z.object({ kind: z.enum(['consumption', 'issues', 'reconciliation']).optional(), from: day.optional(), to: day.optional(), groupBy: z.enum(['equipment', 'class', 'project']).optional(), tankId: id.optional(), projectId: id.optional(), classItemId: id.optional() }).strict(), v ?? {});
export const parseAnomExplain = (b) => parse(z.object({ reasonCode: z.enum(['METER_FAULT', 'HEAVY_DUTY', 'SPARE_CAN', 'LEAK_FIXED', 'MEASUREMENT', 'LOG_LATE', 'OTHER']), explanation: text(500).min(5, 'Explain it in a few words') }).strict(), b ?? {});
export const parseAnomConfirm = (b) => parse(z.object({ note: text(500).min(5, 'Say what was found (at least 5 characters)') }).strict(), b ?? {});

// Maintenance: plans, job cards, spares, reports (part 17.05).
const PM_INT = ['HOURS', 'KM', 'DAYS']; const JOB_T = ['PREVENTIVE', 'BREAKDOWN']; const posNum = z.number().finite().positive().max(1e7);
const planBody = { code: text(30).min(1), task: text(200).min(3), classItemId: id.nullish().transform((v) => v ?? null), equipmentId: id.nullish().transform((v) => v ?? null), intervalType: z.enum(PM_INT), interval: posNum, warnBefore: z.number().finite().min(0).max(1e7), critical: z.boolean(), checklist: z.array(text(120).min(1)).max(30) };
export const parsePlanCreate = (b) => parse(z.object({ ...planBody, warnBefore: planBody.warnBefore.default(0), critical: planBody.critical.default(false), checklist: planBody.checklist.default([]), lastDoneMeter: litres.optional(), lastDoneDate: day.optional() }).strict(), b ?? {});
export const parsePlanUpdate = (b) => defined(parse(z.object({ task: planBody.task.optional(), interval: posNum.optional(), warnBefore: planBody.warnBefore.optional(), critical: z.boolean().optional(), checklist: planBody.checklist.optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
const jobBody = { equipmentId: id, pmStatusIds: z.array(id).max(20), breakdownId: optId2, complaint: text(500).min(3), diagnosis: opt(500), mechanic: opt(80), vendorId: optId2, externalRef: opt(60), externalCost: money, labourHrs: hrs, downtimeStart: stamp.nullish().transform((v) => v ?? null), downtimeEnd: stamp.nullish().transform((v) => v ?? null), openedAt: stamp };
export const parseJobCreate = (b) => parse(z.object({ ...jobBody, type: z.enum(JOB_T), pmStatusIds: jobBody.pmStatusIds.default([]), complaint: jobBody.complaint.optional(), externalCost: money.default(0), labourHrs: hrs.default(0), openedAt: stamp.optional() }).strict(), b ?? {});
export const parseJobUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(jobBody).filter(([k]) => k !== 'equipmentId').map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseJobImport = (b) => parse(z.object({ rows: z.array(z.object({ assetCode: text(40), complaint: text(500).min(3), diagnosis: opt(500), mechanic: opt(80), labourHrs: hrs.optional() }).strict()).min(1).max(1000) }).strict(), b ?? {});
export const parseJobComplete = (b) => parse(z.object({ workDone: text(1000).min(5, 'Say what was done (at least 5 characters)'), diagnosis: opt(500), meterAtService: hrs.nullish().transform((v) => v ?? null), mechanic: opt(80), labourHrs: hrs.optional(), closedAt: stamp.optional(), downtimeStart: stamp.optional(), downtimeEnd: stamp.optional() }).strict(), b ?? {});
export const parseWarranty = (b) => parse(z.object({ claimRef: text(60).min(2), claimAmount: money, status: z.enum(['CLAIMED', 'RECOVERED', 'REJECTED']) }).strict(), b ?? {});
export const parseSpareAdd = (b) => parse(z.object({ itemId: id, storeId: id, qty: posNum }).strict(), b ?? {});
export const parseSpareReturn = (b) => parse(z.object({ qty: posNum, reason: text(200).min(3, 'Say why it is returned') }).strict(), b ?? {});
export const parseSpareCancel = (b) => parse(z.object({ reason: opt(200) }).strict(), b ?? {});
export const parseMaintQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), groupBy: z.enum(['equipment', 'class']).optional(), projectId: id.optional(), classItemId: id.optional() }).strict(), v ?? {});
export const parseMaintExportQ = (v) => parse(z.object({ kind: z.enum(['jobs', 'due', 'metrics']).optional(), from: day.optional(), to: day.optional(), groupBy: z.enum(['equipment', 'class']).optional(), projectId: id.optional(), classItemId: id.optional() }).strict(), v ?? {});
export const parseDashMaintQ = (v) => parse(z.object({ projectId: id.optional() }).strict(), v ?? {});
export const parseHistQ = (v) => parse(z.object({ equipmentId: id }).strict(), v ?? {});

// Hire: agreements, bills and the comparison (part 17.06).
const agrBody = { equipmentId: id, direction: z.enum(['IN', 'OUT', 'INTERNAL']), partnerId: optId2, projectId: optId2, siteId: optId2, rateBasis: z.enum(['HOUR', 'DAY', 'MONTH']), rate: money, minGuarantee: hrs, fuelIncluded: z.boolean(), operatorIncluded: z.boolean(), idleRule: z.enum(['BILL_IDLE', 'NO_IDLE']), breakdownRule: z.enum(['DEDUCT', 'NO_DEDUCT']), mobCharge: money, demobCharge: money, gstPct: z.number().min(0).max(100), from: day, to: day };
export const parseAgrCreate = (b) => parse(z.object({ ...agrBody, minGuarantee: hrs.default(0), fuelIncluded: z.boolean().default(false), operatorIncluded: z.boolean().default(false), idleRule: agrBody.idleRule.default('NO_IDLE'), breakdownRule: agrBody.breakdownRule.default('DEDUCT'), mobCharge: money.default(0), demobCharge: money.default(0), gstPct: agrBody.gstPct.default(0) }).strict(), b ?? {});
export const parseAgrUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(agrBody).filter(([k]) => !['equipmentId', 'direction'].includes(k)).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseAgrImport = (b) => parse(z.object({ rows: z.array(z.object({ assetCode: text(40), direction: z.enum(['IN', 'OUT', 'INTERNAL']), partnerCode: opt(40), projectCode: opt(40), rateBasis: z.enum(['HOUR', 'DAY', 'MONTH']), rate: money, minGuarantee: hrs.optional(), from: day, to: day }).strict()).min(1).max(500) }).strict(), b ?? {});
export const parseBillCreate = (b) => parse(z.object({ agreementId: id, periodFrom: day, periodTo: day, disputeHrs: z.number().finite().min(-100000).max(100000).optional(), disputeReason: opt(300) }).strict(), b ?? {});
export const parseBillUpdate = (b) => defined(parse(z.object({ disputeHrs: z.number().finite().min(-100000).max(100000).optional(), disputeReason: opt(300), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseHireQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), kind: z.enum(['agreements', 'bills', 'comparison']).optional() }).strict(), v ?? {});

// Fleet control tower: cost items, snapshots, telematics, disposal recommendations (part 17.07).
export const parseFleetQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), groupBy: z.enum(['equipment', 'class']).optional(), projectId: id.optional(), classItemId: id.optional(), kind: z.enum(['costs', 'candidates']).optional() }).strict(), v ?? {});
export const parseCostItem = (b) => parse(z.object({ type: z.enum(['DEPRECIATION', 'EMI', 'INSURANCE', 'PERMIT', 'OPERATOR', 'OTHER']), monthlyAmount: money, from: day, to: day.nullish().transform((v) => v ?? null), note: opt(200) }).strict(), b ?? {});
export const parseSnapshot = (b) => parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-11') }).strict(), b ?? {});
export const parseSnapshotQ = (v) => parse(z.object({ equipmentId: id }).strict(), v ?? {});
export const parseIngest = (b) => parse(z.object({ source: text(40).min(1), readings: z.array(z.object({ assetCode: text(40), timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/, 'Use a date and time such as 2026-12-01T09:30:00'), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(), engineHours: hrs.nullish(), ignition: z.boolean().nullish(), fuelLevel: hrs.nullish() }).strict()).min(1).max(500) }).strict(), b ?? {});
export const parseTelQ = (v) => parse(z.object({ from: day.optional(), to: day.optional(), projectId: id.optional(), classItemId: id.optional() }).strict(), v ?? {});
export const parseSuggestQ = (v) => parse(z.object({ equipmentId: id, date: day.optional() }).strict(), v ?? {});
export const parseDisposalCreate = (b) => parse(z.object({ equipmentId: id, reason: text(500).min(10, 'Say why (at least 10 characters)'), estValue: money }).strict(), b ?? {});
export const parseDisposalUpdate = (b) => defined(parse(z.object({ reason: text(500).min(10).optional(), estValue: money.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
