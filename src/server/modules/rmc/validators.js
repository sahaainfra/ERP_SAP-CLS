import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the batching plant and ready-mix API (parts 20.01 on). The services check every rule again.
export const id = z.coerce.number().int().min(1);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
export const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Use a date and time such as 2026-12-01T09:30');
export const text = (max) => z.string().trim().max(max);
export const opt = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
export const oid = id.nullish().transform((v) => v ?? null);
export const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
export { z, parse };
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const parseProjectQ = (q) => parse(z.object({ projectId: id.optional(), siteId: id.optional(), plantId: id.optional(), from: day.optional(), to: day.optional(), period: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-12').optional() }).passthrough(), q ?? {});
const qty = z.number().min(0).max(1_000_000_000);
// plants (20.01)
const crew = z.object({ name: text(120).min(1), role: text(80).default(''), phone: text(30).default('') }).strict();
export const GRADES = ['M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60'];
export const parsePlantCreate = (b) => parse(z.object({ code: text(30).min(2), name: text(120).min(2), projectId: id, siteId: id, locationId: oid, equipmentId: oid, makeModel: opt(120), capacityM3h: qty, ownership: z.enum(['OWN', 'HIRED']).default('OWN'), costCentre: opt(40), budgetHead: opt(40), projectIds: z.array(id).max(30).default([]), crew: z.array(crew).max(60).default([]), plantStatus: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']).default('ACTIVE') }).strict(), b ?? {});
export const parsePlantUpdate = (b) => defined(parse(z.object({ name: text(120).min(2).optional(), projectId: id.optional(), siteId: id.optional(), locationId: oid.optional(), equipmentId: oid.optional(), makeModel: opt(120).optional(), capacityM3h: qty.optional(), ownership: z.enum(['OWN', 'HIRED']).optional(), costCentre: opt(40).optional(), budgetHead: opt(40).optional(), projectIds: z.array(id).max(30).optional(), crew: z.array(crew).max(60).optional(), plantStatus: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseSiloCreate = (b) => parse(z.object({ code: text(30).min(1), itemId: id, kind: z.enum(['SILO', 'BIN', 'TANK']).default('SILO'), capacity: qty, level: qty.default(0), uom: text(10).default('KG') }).strict(), b ?? {});
export const parseSiloUpdate = (b) => defined(parse(z.object({ itemId: id.optional(), capacity: qty.optional(), siloStatus: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict(), b ?? {}));
export const parseSiloLevel = (b) => parse(z.object({ level: qty, reason: text(500).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const parseScaleCreate = (b) => parse(z.object({ code: text(30).min(1), scaleType: z.enum(['CEMENT', 'AGGREGATE', 'WATER', 'ADMIXTURE', 'OTHER']), capacity: qty.default(0), calibratedOn: day.nullish().transform((v) => v || null), calibrationDue: day.nullish().transform((v) => v || null), certificateRef: opt(120) }).strict(), b ?? {});
export const parseScaleUpdate = (b) => defined(parse(z.object({ capacity: qty.optional(), calibratedOn: day.nullish().transform((v) => v || null).optional(), calibrationDue: day.nullish().transform((v) => v || null).optional(), certificateRef: opt(120).optional(), scaleStatus: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict(), b ?? {}));
// mix designs (20.01)
export const COMPONENTS = ['CEMENT', 'FLY_ASH', 'GGBS', 'SAND', 'AGG_10', 'AGG_20', 'WATER', 'ADMIXTURE'];
const comp = z.object({ component: z.enum(COMPONENTS), itemId: oid, qty, sg: z.number().min(0.5).max(8).optional() }).strict();
const trial = z.object({ date: day, slumpMm: z.number().min(0).max(300).optional(), cube7: z.number().min(0).max(120).optional(), cube28: z.number().min(0).max(150).optional(), note: text(300).default('') }).strict();
export const parseMixCreate = (b) => parse(z.object({ plantId: id, code: text(30).min(2).optional(), grade: z.enum(GRADES), slumpMm: z.number().int().min(0).max(250), proportions: z.array(comp).min(1).max(12), trials: z.array(trial).max(30).default([]), effectiveFrom: day.nullish().transform((v) => v || null), effectiveTo: day.nullish().transform((v) => v || null) }).strict(), b ?? {});
export const parseMixUpdate = (b) => defined(parse(z.object({ grade: z.enum(GRADES).optional(), slumpMm: z.number().int().min(0).max(250).optional(), proportions: z.array(comp).min(1).max(12).optional(), trials: z.array(trial).max(30).optional(), effectiveFrom: day.nullish().transform((v) => v || null).optional(), effectiveTo: day.nullish().transform((v) => v || null).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseMixCheck = (b) => parse(z.object({ proportions: z.array(comp).min(1).max(12), grade: z.enum(GRADES).optional() }).strict(), b ?? {});
// requisitions, batches and delivery tickets (20.02)
const m3 = z.number().positive().max(10_000);
export const parseReqCreate = (b) => parse(z.object({ projectId: id, siteId: id, pourCardId: oid, locationId: oid, locationText: opt(200), grade: z.enum(GRADES), qty: m3, requiredAt: stamp, pumpRequired: z.boolean().default(false), slumpMm: z.number().int().min(0).max(300).nullish().transform((v) => v ?? null) }).strict(), b ?? {});
export const parseReqUpdate = (b) => defined(parse(z.object({ pourCardId: oid.optional(), locationId: oid.optional(), locationText: opt(200).optional(), grade: z.enum(GRADES).optional(), qty: m3.optional(), requiredAt: stamp.optional(), pumpRequired: z.boolean().optional(), slumpMm: z.number().int().min(0).max(300).nullish().transform((v) => v ?? null).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseSchedule = (b) => parse(z.object({ plantId: oid, mixDesignId: oid, supplierId: oid, slotFrom: stamp, slotTo: stamp }).strict().refine((v) => v.plantId || v.supplierId, 'Choose a plant or an external supplier').refine((v) => !(v.plantId && v.supplierId), 'Choose a plant or an external supplier, not both').refine((v) => v.slotTo > v.slotFrom, 'The slot ends before it starts'), b ?? {});
export const parseBoardQ = (q) => parse(z.object({ date: day.optional(), plantId: id.optional(), projectId: id.optional() }).passthrough(), q ?? {});
const weight = z.object({ component: z.enum(COMPONENTS), kg: z.number().min(0).max(100_000) }).strict();
export const parseBatch = (b) => parse(z.object({ plantId: id, requisitionId: oid, mixDesignId: id, batchTime: stamp, qty: m3, weights: z.array(weight).min(1).max(12), batchRef: opt(60) }).strict(), b ?? {});
export const parseBatchImport = (b) => parse(z.object({ rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(500) }).strict(), b ?? {});
export const parseTicketCreate = (b) => parse(z.object({ requisitionId: id, plantId: oid, supplierId: oid, batchId: oid, truckNo: text(30).min(3), driver: opt(80), driverPhone: opt(20), qty: m3.max(15), batchedAt: stamp.nullish().transform((v) => v || null), departedAt: stamp.nullish().transform((v) => v || null), outsidePremises: z.boolean().default(false), ewayNo: opt(20) }).strict().refine((v) => v.plantId || v.supplierId, 'Choose the plant or the external supplier').refine((v) => !(v.plantId && v.supplierId), 'Choose the plant or the external supplier, not both'), b ?? {});
export const parseTicketUpdate = (b) => defined(parse(z.object({ truckNo: text(30).min(3).optional(), driver: opt(80).optional(), driverPhone: opt(20).optional(), qty: m3.max(15).optional(), outsidePremises: z.boolean().optional(), ewayNo: opt(20).optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseArrive = (b) => parse(z.object({ arrivedAt: stamp.nullish().transform((v) => v || null) }).strict(), b ?? {});
export const parseReceive = (b) => parse(z.object({ arrivedAt: stamp.nullish().transform((v) => v || null), unloadStart: stamp, unloadEnd: stamp, slumpMm: z.number().int().min(0).max(300), temperatureC: z.number().int().min(-5).max(60).nullish().transform((v) => v ?? null), returnedM3: z.number().min(0).max(15).default(0), wastedM3: z.number().min(0).max(15).default(0), returnReason: opt(300) }).strict(), b ?? {});
export const parseCodeQ = (q) => parse(z.object({ code: text(80).min(3) }).passthrough(), q ?? {});
export const parseConsumptionQ = (q) => parse(z.object({ plantId: id.optional(), projectId: id.optional(), grade: z.enum(GRADES).optional(), from: day.optional(), to: day.optional() }).passthrough(), q ?? {});
// costing (20.03)
const rupees = z.number().min(0).max(1_000_000_000);
export const CATEGORIES = ['MATERIAL', 'POWER', 'FUEL', 'LABOUR', 'MAINTENANCE', 'DEPRECIATION', 'OVERHEAD'];
const periodS = z.string().regex(/^\d{4}-\d{2}$/, 'Use a month such as 2026-12');
export const parsePeriodCreate = (b) => parse(z.object({ plantId: id, period: periodS }).strict(), b ?? {});
export const parseCostLine = (b) => parse(z.object({ category: z.enum(['POWER', 'FUEL', 'LABOUR', 'MAINTENANCE', 'DEPRECIATION', 'OVERHEAD']), amount: rupees.refine((n) => n > 0, 'Enter an amount'), basis: text(300).min(3, 'Say what the amount is for') }).strict(), b ?? {});
export const parseBudget = (b) => parse(z.object({ plantId: id, period: periodS, volume: z.number().min(0).max(1_000_000).default(0), lines: z.array(z.object({ category: z.enum(CATEGORIES), amount: rupees }).strict()).min(1).max(7) }).strict(), b ?? {});
export const parseRateCreate = (b) => parse(z.object({ plantId: id, grade: z.enum(GRADES), rate: z.number().positive().max(1_000_000), effectiveFrom: day }).strict(), b ?? {});
export const parseRateUpdate = (b) => defined(parse(z.object({ rate: z.number().positive().max(1_000_000).optional(), effectiveFrom: day.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseCostQ = (q) => parse(z.object({ plantId: id.optional(), from: periodS.optional(), to: periodS.optional(), period: periodS.optional() }).passthrough(), q ?? {});
export const parseCostLineId = (v) => parse(id, v);
