import { z } from 'zod';
import { parse } from '../validation/index.js';
import { badRequest } from '../http/errors.js';

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Parse and validate the standard list query (FR-04, standards section 5.3):
 *   ?page=1&pageSize=25&sort=-changed_at,key&q=text&filter[status]=APPROVED&from=2026-04-01&to=2026-04-30
 * `sortable` and `filterable` are allow-lists; anything else is a 400 so a caller cannot probe columns.
 * Every list is bounded: pageSize is capped at MAX_PAGE_SIZE (BR-02).
 */
export function parseListQuery(query, { sortable = [], filterable = [], defaultSort = [], maxPageSize = MAX_PAGE_SIZE } = {}) {
  const base = parse(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(DEFAULT_PAGE_SIZE),
      q: z.string().max(100).default(''),
      sort: z.string().max(200).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
    }),
    query,
  );

  const problems = [];
  const sort = [];
  for (const part of (base.sort ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const dir = part.startsWith('-') ? 'desc' : 'asc';
    const column = part.replace(/^[-+]/, '');
    if (!sortable.includes(column)) problems.push({ field: 'sort', message: `Cannot sort by "${column}". Allowed: ${sortable.join(', ') || 'none'}` });
    else sort.push({ column, dir });
  }

  const filters = {};
  for (const [key, value] of Object.entries(query)) {
    const m = /^filter\[([A-Za-z0-9_]+)\]$/.exec(key);
    if (!m) continue;
    if (!filterable.includes(m[1])) problems.push({ field: key, message: `Cannot filter by "${m[1]}". Allowed: ${filterable.join(', ') || 'none'}` });
    else if (typeof value !== 'string' || value.length > 100) problems.push({ field: key, message: 'Use a single value of at most 100 characters' });
    else filters[m[1]] = value;
  }
  if (base.from && base.to && base.from > base.to) problems.push({ field: 'from', message: '"from" must not be after "to"' });
  if (problems.length) throw badRequest('Some fields are invalid. Fix them and try again.', problems);

  return {
    page: base.page,
    pageSize: base.pageSize,
    limit: base.pageSize,
    offset: (base.page - 1) * base.pageSize,
    q: base.q,
    sort: sort.length ? sort : defaultSort,
    filters,
    from: base.from ?? null,
    to: base.to ?? null,
  };
}

/** Build a safe ORDER BY from validated sort entries and a column map (public name -> SQL expression). */
export function orderBySql(sort, columnMap, tieBreaker = '') {
  const parts = sort.map(({ column, dir }) => {
    const expr = columnMap[column];
    if (!expr) throw new Error(`No SQL column mapped for sort "${column}"`);
    return `${expr} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  });
  if (tieBreaker) parts.push(tieBreaker);
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
}

export function pageMeta(total, { page, pageSize }) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** The standard list response: { data, meta }. */
export function pageResponse(data, total, query) {
  return { data, meta: pageMeta(total, query) };
}

/** Escape user text for a SQL LIKE pattern used with ESCAPE '\'. */
export const likePattern = (text) => `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
