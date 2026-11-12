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
