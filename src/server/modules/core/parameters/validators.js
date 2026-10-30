import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parseBusinessDate } from '../../../../shared/dates.js';

const realDate = z.string().refine((d) => {
  try {
    parseBusinessDate(d);
    return true;
  } catch {
    return false;
  }
}, 'must be a real date written YYYY-MM-DD');
const key = z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Use a key such as core.session.timeout_minutes');

export const parseParameterList = (q) => parseListQuery(q, { filterable: ['key'] });
export const parseResolve = (q) =>
  parse(z.object({ key, date: realDate.optional(), projectId: z.coerce.number().int().positive().optional(), siteId: z.coerce.number().int().positive().optional() }), q);
export const parseSet = (b) =>
  parse(
    z.object({
      key,
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.any()), z.record(z.string(), z.any())]),
      scopeType: z.enum(['system', 'company', 'project', 'site']),
      scopeId: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
      effectiveFrom: realDate,
      reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
    }),
    b,
  );
