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
