import { z } from 'zod';
import { isPan } from '../../../../shared/gst.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { notFound } from '../../../platform/http/errors.js';
import { parse } from '../../../platform/validation/index.js';
import { ENTITIES, ENTITY_KEYS } from './entities.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const version = z.number().int().positive('Send the version you are changing');
const blank = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** The zod type of one field, from its description in entities.js. */
function typeOf(spec) {
  const text = (max) => z.string().trim().max(max);
  switch (spec.kind) {
    case 'code': return z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/, 'Use letters, digits, dot, dash or underscore (1 to 30 characters)').transform((v) => v.toUpperCase());
    case 'text': return spec.required ? text(spec.max ?? 200).min(1, 'This is required') : z.preprocess(blank, text(spec.max ?? 200).nullable());
    case 'gstin': return z.preprocess(blank, z.string().trim().toUpperCase().length(15, 'A GSTIN has 15 characters').nullable());
    case 'pan': return z.preprocess(blank, z.string().trim().toUpperCase().refine(isPan, 'A PAN looks like ABCDE1234F').nullable());
    case 'state': return z.preprocess(blank, z.string().regex(/^\d{2}$/, 'Use the 2-digit GST state code').nullable());
    case 'enum': return z.enum(spec.values);
    case 'int': return z.number().int().min(spec.min ?? -2147483648).max(spec.max ?? 2147483647);
    case 'num': return z.number().finite().min(spec.min ?? -1e9).max(spec.max ?? 1e9);
    case 'date': return z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real date').nullable());
    case 'time': return z.preprocess(blank, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)').nullable());
    case 'json': return z.array(z.array(z.number())).max(400);
    case 'ref':
    case 'user': return z.number().int().positive();
    default: throw new Error(`Unknown field kind ${spec.kind}`);
  }
}

const optional = (spec) => (spec.required ? typeOf(spec) : typeOf(spec).nullish());
const shapes = {};
for (const key of ENTITY_KEYS) {
  const fields = Object.entries(ENTITIES[key].fields);
  const create = Object.fromEntries(fields.map(([name, spec]) => [name, spec.required ? typeOf(spec) : optional(spec)]));
  const patch = Object.fromEntries(fields.filter(([, spec]) => !spec.immutable && !spec.assigned).map(([name, spec]) => [name, optional(spec).optional()]));
  shapes[key] = {
    create: z.object(create).strict(),
    patch: z.object({ ...patch, version, reason: reason.optional() }).strict(),
  };
}

export const parseEntity = (v) => {
  if (!ENTITY_KEYS.includes(v)) throw notFound('There is no such organisation list.');
  return v;
};
export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseCreate = (key, b) => parse(shapes[key].create, b);
export const parsePatch = (key, b) => parse(shapes[key].patch, b);
export const parseReasonVersion = (b) => parse(z.object({ reason, version }).strict(), b);
export const parseReasonOnly = (b) => parse(z.object({ reason }).strict(), b);
export const parseStatusChange = (b) => parse(z.object({ status: z.enum(['ON_HOLD', 'ACTIVE', 'COMPLETED', 'CLOSED']), reason, version }).strict(), b);
export const parseAssign = (b) => parse(z.object({ userId: z.number().int().positive().nullable(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), reason, role: z.enum(['HEAD', 'PROJECT_MANAGER', 'IN_CHARGE']).optional() }).strict(), b);

const geofence = z.object({
  type: z.enum(['NONE', 'CIRCLE', 'POLYGON']),
  latitude: z.number().finite().min(-90).max(90).nullish(),
  longitude: z.number().finite().min(-180).max(180).nullish(),
  radiusM: z.number().int().nullish(),
  polygon: z.array(z.array(z.number())).max(400).nullish(),
}).strict();
export const parseGeofenceRequest = (b) => parse(z.object({ geofence, reason }).strict(), b);
const point = { latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), toleranceM: z.number().min(0).max(100).optional() };
export const parseSiteTest = (b) => parse(z.object(point).strict(), b);
export const parseShapeTest = (b) => parse(z.object({ geofence, ...point }).strict(), b);
export const parseRequestReason = (b) => parse(z.object({ reason }).strict(), b);
export const parseUserLookup = (q) => parseListQuery(q, { sortable: [], filterable: [], defaultSort: [] });

export const parseOrgList = (key, q) => {
  const e = ENTITIES[key];
  return parseListQuery(q, { sortable: Object.keys(e.sortable), filterable: Object.keys(e.filterable), defaultSort: [{ column: 'code', dir: 'asc' }] });
};
