import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { CATEGORIES, RETENTION_CLASSES } from '../../../platform/files/types.js';

const id = z.coerce.number().int().positive();
const entity = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Name the kind of record, for example sample_document');
const fileName = z.string().trim().min(1).max(200).refine((n) => !/[\\/\0]/.test(n), 'A file name cannot contain slashes');
const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const flag = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(false);

export const parseId = (v) => parse(id, v);
export const parseUploadId = (v) => parse(z.string().uuid(), v);
export const parseListFiles = (q) => parse(z.object({ entity, entityId: id }), q);
export const parseBegin = (b) =>
  parse(z.object({ fileName, size: z.number().int().positive(), entity, entityId: z.number().int().positive(), supersedesId: z.number().int().positive().optional(), stripExif: flag }), b);
export const parseFields = (f) =>
  parse(z.object({ entity, entityId: id, supersedesId: id.optional(), stripExif: flag }), f);
export const parseOffset = (q) => parse(z.object({ offset: z.coerce.number().int().min(0) }), q);
export const parseUrl = (q) => parse(z.object({ variant: z.enum(['file', 'thumbnail']).default('file'), download: flag }), q);
export const parseReason = (b) => parse(z.object({ reason: reason.optional() }), b ?? {});
export const parseAdminList = (q) => parseListQuery(q, { filterable: ['scan_status'], sortable: ['id'], defaultSort: [{ column: 'id', dir: 'desc' }] });
export const parseSettingsChange = (b) =>
  parse(
    z.object({
      changes: z
        .object({
          allowedExtensions: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,8}$/)).min(1).max(40).optional(),
          maxSizeMb: z.object(Object.fromEntries(CATEGORIES.map((c) => [c, z.number().int().min(1).max(2048).optional()]))).strict().optional(),
          retention: z.object(Object.fromEntries(CATEGORIES.map((c) => [c, z.enum(RETENTION_CLASSES).optional()]))).strict().optional(),
          urlTtlSeconds: z.number().int().min(30).max(3600).optional(),
        })
        .strict()
        .refine((c) => Object.keys(c).length > 0, 'Name at least one thing to change'),
      reason,
    }),
    b,
  );
export const parseContentQuery = (q) => ({ exp: q.exp, v: q.v, d: q.d, sig: q.sig });
