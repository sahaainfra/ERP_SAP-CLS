import { z } from 'zod';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parse } from '../../../platform/validation/index.js';

// Plain query names from the specification (entity, id, user, action) are accepted next to the filter[...] form.
const withPlain = (q) => {
  const out = { ...q };
  for (const [plain, filter] of [['entity', 'entity'], ['id', 'entityId'], ['user', 'user'], ['action', 'action'], ['correlationId', 'correlationId'], ['severity', 'severity'], ['type', 'type']]) {
    if (typeof q[plain] === 'string' && q[plain] !== '' && out[`filter[${filter}]`] === undefined) out[`filter[${filter}]`] = q[plain];
  }
  return out;
};

export const parseAuditList = (q) => parseListQuery(withPlain(q), { sortable: ['at'], filterable: ['entity', 'entityId', 'user', 'action', 'correlationId'], defaultSort: [{ column: 'at', dir: 'desc' }] });
export const parseSecurityList = (q) => parseListQuery(withPlain(q), { sortable: ['at', 'severity'], filterable: ['severity', 'type', 'user'], defaultSort: [{ column: 'at', dir: 'desc' }] });
export const parseHistory = (q) => parse(z.object({ entity: z.string().trim().min(1).max(80), id: z.string().trim().min(1).max(80), limit: z.coerce.number().int().min(1).max(200).default(100) }), q);
export const parsePeriod = (v) => parse(z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'), v);
export const parseExportLog = (b) =>
  parse(
    z.object({
      report: z.string().trim().min(1).max(120),
      format: z.enum(['csv', 'xlsx', 'pdf', 'print']).default('csv'),
      rows: z.number().int().min(0).max(10_000_000).default(0),
      filters: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
      sensitive: z.boolean().default(false),
    }).strict(),
    b,
  );
