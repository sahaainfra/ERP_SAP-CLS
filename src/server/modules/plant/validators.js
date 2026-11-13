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
