import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const id = z.coerce.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const typePattern = z.string().trim().regex(/^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(\.\*)?)$/, 'Use an event type such as core.period.status_changed, or a prefix such as core.period.*');

export const parseId = (v) => parse(id, v);
export const parseEventList = (q) => parseListQuery(q, { filterable: ['type', 'published'], sortable: ['id', 'type', 'occurredAt'], defaultSort: [{ column: 'id', dir: 'desc' }] });
export const parseDlqList = (q) => parseListQuery(q, { filterable: ['status', 'consumer'], sortable: ['id', 'updatedAt'], defaultSort: [{ column: 'id', dir: 'desc' }] });
export const parseResolution = (b) => parse(z.object({ reason }), b);
export const parseReplay = (b) =>
  parse(
    z
      .object({
        types: z.array(typePattern).min(1).max(20).default(['*']),
        from: day.optional(),
        to: day.optional(),
        consumer: z.string().trim().max(80).optional(),
        reset: z.boolean().default(false),
        reason,
      })
      .refine((v) => !v.from || !v.to || v.from <= v.to, { message: '"from" must not be after "to"', path: ['from'] }),
    b,
  );
