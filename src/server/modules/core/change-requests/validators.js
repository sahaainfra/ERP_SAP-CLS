import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';

export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseRequestList = (q) => parseListQuery(q, { filterable: ['type', 'status'] });
export const parseAct = (b) =>
  parse(
    z.object({
      action: z.enum(['approve', 'reject', 'return']),
      comment: z.string().trim().max(500).optional(),
      version: z.number().int().positive().optional(),
    }),
    b,
  );
export const parseResubmit = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500) }), b);
