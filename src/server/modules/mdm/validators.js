import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the master data governance API (part 06.01). The service checks the rules again (formats, duplicates, rights); these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const type = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'Name a master, for example PARTNER');
const why = z.string().trim().min(10, 'Say why (at least 10 characters)').max(500);
const data = z.record(z.string().max(40), z.union([z.string().max(400), z.null()])).refine((d) => Object.keys(d).length <= 40, 'Too many fields');
export const parseId = (v) => parse(id, v);
export const parseType = (v) => parse(type, v);
export const parseRecordList = (q) => parse(z.object({ q: text(80).optional(), status: z.enum(['SUBMITTED', 'ACTIVE', 'INACTIVE', 'MERGED', 'REJECTED']).optional(), maxScore: z.coerce.number().int().min(0).max(100).optional(), asOf: date.optional(), sort: z.enum(['code', 'name', 'score', 'changed']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseAsOf = (q) => parse(z.object({ asOf: date.optional() }).strict(), q);
export const parseLookup = (q) => parse(z.object({ q: text(80).optional() }).strict(), q);
export const parseCheck = (b) => parse(z.object({ data, recordId: id.optional() }).strict(), b);
export const parseCreate = (b) => parse(z.object({ data, justification: why, effectiveFrom: date.optional(), acknowledgeDuplicates: z.boolean().default(false) }).strict(), b);
export const parseUpdate = (b) => parse(z.object({ data, justification: z.string().trim().max(500).optional().transform((v) => v || undefined), effectiveFrom: date.optional(), version: z.number().int().min(1) }).strict(), b);
export const parseStatus = (b) => parse(z.object({ action: z.enum(['INACTIVATE', 'REACTIVATE']), justification: why, effectiveFrom: date.optional() }).strict(), b);
export const parseRequestList = (q) => parse(z.object({ view: z.enum(['mine', 'review', 'all']).default('mine'), status: z.enum(['PENDING', 'RETURNED', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED']).optional(), type: type.optional() }).strict(), q);
export const parseCancel = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parseResubmit = (b) => parse(z.object({ data: data.optional(), justification: why.optional() }).strict(), b ?? {});
export const parseDuplicateList = (q) => parse(z.object({ type: type.optional(), status: z.enum(['OPEN', 'NOT_DUPLICATE', 'MERGE_PENDING', 'MERGED']).optional(), minScore: z.coerce.number().int().min(0).max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseDismiss = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why they are different (at least 5 characters)').max(300) }).strict(), b);
export const parseMerge = (b) => parse(z.object({ type, fromId: id, toId: id, justification: why }).strict(), b);
export const parseScan = (b) => parse(z.object({ type }).strict(), b);
export const parseQuality = (q) => parse(z.object({ type: type.optional() }).strict(), q);
const rule = z.object({ masterType: type, field: z.string().trim().max(40).min(1), rule: z.enum(['REQUIRED', 'FORMAT', 'STALE']), param: z.string().trim().max(40).nullable().optional(), severity: z.enum(['ERROR', 'WARNING', 'INFO']), active: z.boolean().default(true) }).strict();
const steward = z.object({ masterType: type, username: z.string().trim().min(1).max(60), role: z.enum(['PRIMARY', 'BACKUP']).default('PRIMARY') }).strict();
export const parseConfig = (b) => parse(z.object({ rules: z.array(rule).max(300), stewards: z.array(steward).min(1, 'Name at least one steward').max(100), reason: why }).strict(), b);

// ---- part 06.02: the common masters ----
const master = z.enum(['uom', 'gst-rates', 'hsn-sac', 'tds-sections', 'states', 'districts', 'currencies', 'exchange-rates', 'banks', 'payment-terms', 'lookup-lists', 'lookups']);
const value = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.object({ label: z.string().max(80), pct: z.union([z.number(), z.string().max(12)]), days: z.union([z.number(), z.string().max(6)]) })).max(20)]);
const cdata = z.record(z.string().max(40), value).refine((d) => Object.keys(d).length <= 20, 'Too many fields');
export const parseMaster = (v) => parse(master, v);
export const parseCommonList = (q) => parse(z.object({ q: text(80).optional(), asOf: date.optional(), status: z.enum(['current', 'all', 'pending']).optional(), key: text(40).optional(),
  category: z.string().max(10).optional(), codeType: z.enum(['HSN', 'SAC']).optional(), taxKind: z.enum(['TDS', 'TCS']).optional(), stateCode: z.string().max(3).optional(), currencyCode: z.string().max(3).optional(), termKind: z.enum(['PAYMENT', 'DELIVERY', 'INCOTERM']).optional(), listCode: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseCommonCreate = (b) => parse(z.object({ data: cdata, effectiveFrom: date.optional(), justification: z.string().trim().max(500).optional() }).strict(), b);
export const parseCommonUpdate = (b) => parse(z.object({ data: cdata, effectiveFrom: date.optional(), justification: z.string().trim().max(500).optional(), version: z.number().int().min(1) }).strict(), b);
export const parseCommonRetire = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300), version: z.number().int().min(1) }).strict(), b);
export const parseGstQuery = (q) => parse(z.object({ code: z.string().trim().toUpperCase().max(12).optional(), hsn: z.string().trim().max(8).optional(), date: date.optional() }).strict().refine((v) => v.code || v.hsn, 'Give a GST rate code or an HSN/SAC code'), q);
export const parseTdsQuery = (q) => parse(z.object({ section: z.string().trim().max(12), date: date.optional() }).strict(), q);
export const parseFxQuery = (q) => parse(z.object({ currency: z.string().trim().toUpperCase().length(3), date: date.optional() }).strict(), q);
export const parseConvert = (q) => parse(z.object({ quantity: z.string().trim().regex(/^\d+(\.\d+)?$/, 'A quantity such as 12.5'), from: z.string().trim().toUpperCase().max(10), to: z.string().trim().toUpperCase().max(10) }).strict(), q);
export const parseListCode = (v) => parse(z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{1,29}$/, 'A list code such as PRIORITY'), v);
export const parseListValues = (q) => parse(z.object({ all: z.enum(['true', 'false']).optional(), lang: z.enum(['en', 'hi']).optional() }).strict(), q);
export const parseListSave = (b) => parse(z.object({ values: z.array(z.object({ code: z.string().trim().min(1).max(30), labelEn: z.string().trim().min(1).max(80), labelHi: z.string().trim().max(80).nullable().optional(), sortOrder: z.number().int().min(0).max(9999).optional(), active: z.boolean().optional() }).strict()).max(300), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);

// ---- part 06.03: the item master ----
const itemType = z.enum(['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE', 'LABOUR', 'EQUIPMENT', 'SERVICE', 'SUBCONTRACT', 'WORK_ITEM', 'COMPOSITE']);
const num = (max = 12) => z.union([z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'A number, not negative'), z.number().nonnegative()]).transform(String).refine((v) => v.length <= max + 5, 'Too large');
const uomCode = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,9}$/, 'A unit code such as KG');
const itemBody = {
  name: z.string().trim().min(3, 'Give the item a name (at least 3 characters)').max(160), nameHi: z.string().trim().max(160).nullable().optional(), description: z.string().trim().max(1000).nullable().optional(),
  spec: z.record(z.string().max(30), z.union([z.string().max(120), z.number()])).default({}), baseUom: uomCode, hsnSac: z.string().trim().regex(/^[0-9]{4,8}$/, 'HSN or SAC digits').nullable().optional(), gstRate: z.string().trim().toUpperCase().max(12).nullable().optional(),
  stockTracked: z.boolean().default(false), batchTracked: z.boolean().default(false), serialTracked: z.boolean().default(false), shelfLifeDays: z.number().int().min(1).max(36500).nullable().optional(),
  reorderLevel: num().optional(), reorderQuantity: num().optional(), standardRate: num().optional(), preferredBrands: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
};
/** The item fields without their defaults: a change carries only what it changes. */
const itemChange = () => Object.fromEntries(Object.entries(itemBody).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()]));
const itemUom = z.object({ uom: uomCode, factorToBase: z.union([z.string().trim(), z.number()]).transform(String), purpose: z.enum(['ANY', 'PURCHASE', 'ISSUE', 'SALE']).default('ANY') }).strict();
export const parseItemCreate = (b) => parse(z.object({ ...itemBody, categoryId: id, itemType, effectiveFrom: date.optional(), justification: z.string().trim().max(500).optional(), acknowledgeDuplicates: z.boolean().default(false), uoms: z.array(itemUom).max(10).default([]),
  legacy: z.object({ source: z.enum(['conversion', 'sample-request-line']), key: z.string().trim().min(1).max(300), code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$/, 'A code of letters, digits, dot, dash or slash').optional() }).strict().optional() }).strict(), b);
export const parseItemCheck = (b) => parse(z.object({ ...itemBody, name: z.string().trim().max(160).default(''), baseUom: uomCode.optional().default('NOS'), categoryId: id, itemType }), b);
export const parseItemUpdate = (b) => parse(z.object(itemChange()).extend({ version: z.number().int().min(1), reason: z.string().trim().max(300).optional() }).strict(), b);
export const parseItemResubmit = (b) => parse(z.object({ ...itemBody, justification: z.string().trim().max(500).optional(), itemType }).strict(), b);
export const parseItemVersion = (b) => parse(z.object(itemChange()).extend({ effectiveFrom: date, justification: z.string().trim().min(10, 'Say why a new version is needed (at least 10 characters)').max(500) }).strict(), b);
export const parseItemStatus = (b) => parse(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']), reason: z.string().trim().min(5).max(300), version: z.number().int().min(1) }).strict(), b);
export const parseItemList = (q) => parse(z.object({ q: text(80).optional(), type: itemType.optional(), category: z.coerce.number().int().min(1).optional(), status: z.enum(['SUBMITTED', 'ACTIVE', 'INACTIVE', 'SUPERSEDED', 'REJECTED']).optional(), sort: z.enum(['code', 'name', 'changed', 'rate']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseItemSearch = (q) => parse(z.object({ q: text(80).optional(), type: z.string().regex(/^[A-Z_]+(,[A-Z_]+)*$/).optional(), category: z.coerce.number().int().min(1).optional(), only: z.enum(['favourites', 'recent']).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict(), q);
export const parseItemMark = (b) => parse(z.object({ mark: z.enum(['FAVOURITE', 'RECENT']), on: z.boolean().default(true) }).strict(), b);
export const parseItemUoms = (b) => parse(z.object({ uoms: z.array(itemUom).max(10), version: z.number().int().min(1) }).strict(), b);
export const parseItemConvert = (q) => parse(z.object({ quantity: z.string().trim().regex(/^\d+(\.\d+)?$/, 'A quantity such as 12.5'), from: uomCode, to: uomCode }).strict(), q);
export const parseItemResources = (b) => parse(z.object({ lines: z.array(z.object({ componentId: id, quantity: num(), uom: uomCode, wastagePct: num(3).optional() }).strict().refine((l) => Number(l.quantity) > 0, { message: 'A quantity more than 0', path: ['quantity'] }).refine((l) => !l.wastagePct || Number(l.wastagePct) <= 100, { message: 'Wastage at most 100%', path: ['wastagePct'] })).max(100), version: z.number().int().min(1), reason: z.string().trim().max(300).optional() }).strict(), b);
export const parseMakeAdd = (b) => parse(z.object({ make: z.string().trim().min(1).max(60), model: z.string().trim().max(60).nullable().optional() }).strict(), b);
export const parseMakeDecide = (b) => parse(z.object({ approved: z.boolean(), reason: z.string().trim().max(300).optional() }).strict(), b);
export const parseAlternate = (b) => parse(z.object({ alternateId: id, on: z.boolean().default(true) }).strict(), b);
const attr = z.object({ key: z.string().trim().regex(/^[a-z][a-zA-Z0-9]{0,29}$/, 'A key such as grade'), label: z.string().trim().min(1).max(60), type: z.enum(['text', 'number', 'enum']), options: z.array(z.string().trim().min(1).max(60)).max(40).optional(), unit: z.string().trim().max(10).optional(), required: z.boolean().default(false) }).strict();
export const parseCategory = (b) => parse(z.object({ parentId: id.nullable().optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'A code such as CEMENT'), name: z.string().trim().min(2).max(80), nameHi: z.string().trim().max(80).nullable().optional(), codePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'Two to six letters'),
  itemTypes: z.array(itemType).min(1, 'Choose the item types of the category').max(11), attributes: z.array(attr).max(20).default([]), defaultHsn: z.string().trim().regex(/^[0-9]{4,8}$/).nullable().optional(), glCode: z.string().trim().max(20).nullable().optional(), stewardRole: z.enum(['PROCMGR', 'STOREMGR', 'EST', 'PLANTMGR']),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(), version: z.number().int().min(1).optional(), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parseLegacyMap = (b) => parse(z.object({ source: z.enum(['conversion', 'sample-request-line']), key: z.string().trim().min(1).max(300), itemId: id }).strict(), b);

// ---- part 06.04: the business partner master ----
const prole = z.enum(['VENDOR', 'SUBCONTRACTOR', 'LABOUR_CONTRACTOR', 'SERVICE_PROVIDER', 'CLIENT', 'CONSULTANT', 'TRANSPORTER']);
const upper = (max) => z.string().trim().toUpperCase().max(max);
const gstinIn = z.object({ stateCode: upper(3), gstin: upper(15) }).strict();
const addressIn = z.object({ addressType: z.enum(['REGISTERED', 'BILLING', 'SHIPPING', 'SITE', 'OTHER']), address: z.string().trim().min(5, 'Write the address').max(300), city: z.string().trim().max(60).nullable().optional(), stateCode: upper(3), pin: z.string().trim().max(6).nullable().optional(), isDefault: z.boolean().optional() }).strict();
const mobileIn = z.string().trim().transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0091|0)/, ''));
const contactIn = z.object({ name: z.string().trim().min(2).max(80), designation: z.string().trim().max(60).nullable().optional(), email: z.string().trim().toLowerCase().max(120).nullable().optional(), mobile: mobileIn.nullable().optional(), isPrimary: z.boolean().optional() }).strict();
const bankIn = z.object({ accountNo: z.string().trim().transform((v) => v.replace(/\s/g, '')), ifsc: upper(11), accountName: z.string().trim().min(2).max(120), chequeFileId: id.nullable().optional() }).strict();
const tdsIn = z.object({ section: z.string().trim().max(12), ldcNo: z.string().trim().max(30).nullable().optional(), ldcRate: z.union([z.string().trim().regex(/^\d+(\.\d{1,4})?$/), z.number().nonnegative()]).transform(String).nullable().optional(), ldcLimit: z.union([z.string().trim().regex(/^\d+(\.\d{1,2})?$/), z.number().nonnegative()]).transform(String).nullable().optional(), validFrom: date.nullable().optional(), validUntil: date.nullable().optional() }).strict();
const partnerBody = {
  legalName: z.string().trim().min(3, 'Give the legal name').max(160), tradeName: z.string().trim().max(160).nullable().optional(), constitution: z.enum(['PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'TRUST', 'SOCIETY', 'GOVERNMENT', 'HUF', 'INDIVIDUAL', 'OTHER']),
  pan: upper(10).nullable().optional().transform((v) => v || null), msmeNo: upper(19).nullable().optional().transform((v) => v || null), msmeCategory: z.enum(['MICRO', 'SMALL', 'MEDIUM']).nullable().optional(), cin: upper(21).nullable().optional().transform((v) => v || null),
  roles: z.array(prole).max(7), categories: z.array(z.string().trim().max(30)).max(50).default([]), regions: z.array(upper(3)).max(40).default([]),
  gstins: z.array(gstinIn).max(37).default([]), addresses: z.array(addressIn).max(20).default([]), contacts: z.array(contactIn).max(20).default([]), bank: bankIn.nullable().optional(), tds: z.array(tdsIn).max(5).default([]),
};
export const parsePartnerCreate = (b) => parse(z.object({ ...partnerBody, acknowledgeDuplicates: z.boolean().default(false), submit: z.boolean().default(false), comment: z.string().trim().max(500).optional() }).strict(), b);
export const parsePartnerCheck = (b) => parse(z.object({ ...partnerBody, legalName: z.string().trim().max(160).default(''), constitution: partnerBody.constitution.default('OTHER'), roles: z.array(prole).max(7).default([]), partnerId: id.optional() }).strip(), b);
export const parsePartnerUpdate = (b) => parse(z.object({ ...partnerBody, version: z.number().int().min(1), comment: z.string().trim().max(500).optional() }).strict(), b);
export const parsePartnerSubmit = (b) => parse(z.object({ comment: z.string().trim().max(500).optional() }).strict(), b ?? {});
export const parsePartnerDetails = (b) => parse(z.object({ tradeName: z.string().trim().max(160).nullable().optional(), categories: z.array(z.string().trim().max(30)).max(50).optional(), regions: z.array(upper(3)).max(40).optional(), contacts: z.array(contactIn).min(1).max(20).optional(), addresses: z.array(addressIn).min(1).max(20).optional(), version: z.number().int().min(1), reason: z.string().trim().max(300).optional() }).strict(), b);
export const parseGstinAdd = (b) => parse(gstinIn, b);
export const parseGstinVerify = (b) => parse(z.object({ gstinId: id, checkedOnPortal: z.boolean().default(false), status: z.enum(['ACTIVE', 'CANCELLED', 'SUSPENDED']).optional() }).strict(), b);
export const parseBankRequest = (b) => parse(bankIn.extend({ reason: z.string().trim().min(10, 'Say why the bank changes (at least 10 characters)').max(300) }).strict(), b);
export const parseBankConfirm = (b) => parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The six-digit code').optional(), callback: z.object({ spokeTo: z.string().trim().min(2).max(80), number: mobileIn, note: z.string().trim().min(5).max(300) }).strict().optional() }).strict().refine((v) => v.code || v.callback, 'Give the code the partner received, or note the call-back'), b);
export const parseBankVerify = (b) => parse(z.object({ result: z.enum(['VERIFIED', 'FAILED']), note: z.string().trim().min(5).max(300) }).strict(), b);
export const parseDocumentAdd = (b) => parse(z.object({ docType: z.enum(['GST_CERTIFICATE', 'PAN_CARD', 'MSME_CERTIFICATE', 'CLRA_LICENCE', 'PF_REGISTRATION', 'ESI_REGISTRATION', 'INSURANCE', 'ISO_CERTIFICATE', 'CANCELLED_CHEQUE', 'INCORPORATION', 'OTHER']), docNo: z.string().trim().max(60).nullable().optional(), fileId: id.nullable().optional(), validFrom: date.nullable().optional(), validUntil: date.nullable().optional() }).strict(), b);
export const parseTdsSet = (b) => parse(z.object({ tds: z.array(tdsIn).max(5) }).strict(), b);
export const parsePartnerStatus = (b) => parse(z.object({ action: z.enum(['HOLD', 'RELEASE', 'INACTIVATE', 'REACTIVATE']), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300), version: z.number().int().min(1) }).strict(), b);
export const parseBlacklist = (b) => parse(z.object({ action: z.enum(['BLACKLIST', 'LIFT_BLACKLIST']).default('BLACKLIST'), reason: z.string().trim().min(10, 'Say why (at least 10 characters)').max(500), until: date.nullable().optional() }).strict(), b);
export const parseSelectable = (q) => parse(z.object({ purpose: z.enum(['PO', 'WO', 'RFQ', 'PAYMENT', 'OTHER']).default('PO'), role: prole.optional() }).strict(), q);
export const parseQueue = (q) => parse(z.object({ kind: z.enum(['REGISTRATION', 'BANK', 'STATUS', 'DOCUMENT']).optional() }).strict(), q);
