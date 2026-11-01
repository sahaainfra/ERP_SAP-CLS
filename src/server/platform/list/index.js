import { z } from 'zod';
import { badRequest } from '../http/errors.js';
import { likePattern } from '../pagination/index.js';
import { parse } from '../validation/index.js';

/**
 * The List Report contract (part 03.03, FR-01, FR-02, FR-09, BR-01). A register declares its columns once:
 *
 *   defineList({ code, label, from, where?, searchable: ['r.title', ...], defaultSort: '-createdAt',
 *                columns: { key: { sql, type: 'text'|'number'|'money'|'date'|'datetime'|'enum'|'id', label, sortable?, filterable?, total?, options? } } })
 *
 * and the same definition turns a request into SQL for the page, the total count and the totals of numeric columns over the whole
 * filtered set, and into the query an export runs (BR-02: the export is the screen's own query). Filters:
 *
 *   filter[status]=DRAFT                     equals (a comma list means "in")
 *   filter[total][gte]=1000                  operators eq ne in gte lte between contains empty notempty
 *   filter[docDate][between]=2026-04-01,2027-03-31
 *   q=text                                    free text over the searchable columns
 *   sort=-docDate,docNo                       any sortable column, several, "-" for descending
 *   page, pageSize (25, 50, 100, 200)
 *
 * Every column and operator is checked against the definition; values are bound as parameters, never written into the SQL.
 */
export const PAGE_SIZES = [10, 25, 50, 100, 200];
const OPS = ['eq', 'ne', 'in', 'gte', 'lte', 'between', 'contains', 'empty', 'notempty'];
const NUMERIC = new Set(['number', 'money', 'id']);
const OPS_BY_TYPE = {
  text: ['eq', 'ne', 'in', 'contains', 'empty', 'notempty'],
  enum: ['eq', 'ne', 'in', 'empty', 'notempty'],
  id: ['eq', 'ne', 'in', 'empty', 'notempty'],
  number: ['eq', 'ne', 'gte', 'lte', 'between', 'empty', 'notempty'],
  money: ['eq', 'ne', 'gte', 'lte', 'between', 'empty', 'notempty'],
  date: ['eq', 'gte', 'lte', 'between', 'empty', 'notempty'],
  datetime: ['gte', 'lte', 'between', 'empty', 'notempty'],
};
export const operatorsFor = (type) => OPS_BY_TYPE[type] ?? OPS_BY_TYPE.text;

const lists = new Map();

/** Declare a list. Returns the definition; `listRegistry.get(code)` finds it again (saved views check their list exists). */
export function defineList(def) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(def.code)) throw new Error(`Bad list code ${def.code}`);
  for (const [key, c] of Object.entries(def.columns)) {
    if (!c.sql || !OPS_BY_TYPE[c.type]) throw new Error(`Column ${def.code}.${key} needs sql and a known type`);
  }
  const full = { searchable: [], where: '1 = 1', ...def };
  lists.set(def.code, full);
  return full;
}
export const listRegistry = { get: (code) => lists.get(code), codes: () => [...lists.keys()].sort() };

/** The columns as the browser needs them (label, type, what can be sorted, filtered and totalled, the operators). */
export const describeList = (def) => ({
  code: def.code,
  label: def.label,
  defaultSort: def.defaultSort,
  columns: Object.entries(def.columns).map(([key, c]) => ({ key, label: c.label ?? key, type: c.type, sortable: c.sortable !== false, filterable: c.filterable !== false, total: Boolean(c.total), operators: c.filterable === false ? [] : operatorsFor(c.type), ...(c.options ? { options: c.options } : {}), ...(c.sensitive ? { sensitive: true } : {}) })),
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const valueOf = (col, key, raw) => {
  const text = String(raw).trim();
  if (NUMERIC.has(col.type)) {
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw badRequest('Some filters are invalid.', [{ field: `filter[${key}]`, message: `"${text}" is not a number` }]);
    return col.toDb ? col.toDb(text) : Number(text);
  }
  if (col.type === 'date' || col.type === 'datetime') {
    if (!DATE.test(text)) throw badRequest('Some filters are invalid.', [{ field: `filter[${key}]`, message: `"${text}" is not a date (YYYY-MM-DD)` }]);
    return text;
  }
  if (col.type === 'enum' && col.options && !col.options.some(([v]) => v === text)) throw badRequest('Some filters are invalid.', [{ field: `filter[${key}]`, message: `"${text}" is not one of ${col.options.map(([v]) => v).join(', ')}` }]);
  return text;
};

const baseQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => PAGE_SIZES.includes(n), `Use one of ${PAGE_SIZES.join(', ')} rows a page`).default(25),
  q: z.string().max(100).default(''),
  sort: z.string().max(200).optional(),
});

/**
 * Turn a request's query string into a validated list request: { page, pageSize, offset, q, sort: [{ key, dir }], filters: [{ key, op, value }] }.
 * `extra` names other query parameters a register accepts (for example `format` on an export).
 */
export function parseListRequest(def, query, { extra = [] } = {}) {
  const known = new Set(['page', 'pageSize', 'q', 'sort', ...extra]);
  const base = parse(baseQuery, Object.fromEntries(Object.entries(query).filter(([k]) => known.has(k))));
  const problems = [];
  const sort = [];
  for (const part of (base.sort ?? def.defaultSort ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const key = part.replace(/^[-+]/, '');
    const col = def.columns[key];
    if (!col || col.sortable === false) problems.push({ field: 'sort', message: `Cannot sort by "${key}"` });
    else sort.push({ key, dir: part.startsWith('-') ? 'desc' : 'asc' });
  }
  const filters = [];
  for (const [name, raw] of Object.entries(query)) {
    if (known.has(name)) continue;
    const m = /^filter\[([A-Za-z0-9_]+)\](?:\[([a-z]+)\])?$/.exec(name);
    if (!m) { problems.push({ field: name, message: `Unknown parameter "${name}"` }); continue; }
    const [, key, op = 'eq'] = m;
    const col = def.columns[key];
    if (!col || col.filterable === false) { problems.push({ field: name, message: `Cannot filter by "${key}"` }); continue; }
    if (!OPS.includes(op) || !operatorsFor(col.type).includes(op)) { problems.push({ field: name, message: `"${op}" does not apply to ${col.label ?? key}; use ${operatorsFor(col.type).join(', ')}` }); continue; }
    if (typeof raw !== 'string' || raw.length > 500) { problems.push({ field: name, message: 'Use one value of at most 500 characters' }); continue; }
    filters.push({ key, op, raw });
  }
  if (problems.length) throw badRequest('Some list parameters are invalid.', problems);
  return { page: base.page, pageSize: base.pageSize, offset: (base.page - 1) * base.pageSize, q: base.q.trim(), sort, filters, ...Object.fromEntries(extra.filter((k) => query[k] !== undefined).map((k) => [k, query[k]])) };
}

/** The WHERE clause and parameters of a list request (search, filters, the register's own condition and the caller's scope). */
export function whereOf(def, req, { scopeSql = '1 = 1', params = {} } = {}) {
  const parts = [`(${def.where})`, `(${scopeSql})`];
  const p = { ...params };
  let n = 0;
  const bind = (v) => { n += 1; p[`f${n}`] = v; return `:f${n}`; };
  if (req.q && def.searchable.length) parts.push(`(${def.searchable.map((s) => `COALESCE(${s}, '') LIKE ${bind(likePattern(req.q))} ESCAPE '\\'`).join(' OR ')})`);
  for (const f of req.filters) {
    const col = def.columns[f.key];
    const sql = col.sql;
    const one = (raw) => valueOf(col, f.key, raw);
    const list = () => f.raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50).map(one);
    if (f.op === 'eq' && f.raw.includes(',')) parts.push(`${sql} IN (${list().map(bind).join(', ')})`);
    else if (f.op === 'eq') parts.push(`${sql} = ${bind(one(f.raw))}`);
    else if (f.op === 'ne') parts.push(`(${sql} IS NULL OR ${sql} != ${bind(one(f.raw))})`);
    else if (f.op === 'in') parts.push(`${sql} IN (${list().map(bind).join(', ')})`);
    else if (f.op === 'gte') parts.push(`${sql} >= ${bind(one(f.raw))}`);
    else if (f.op === 'lte') parts.push(`${col.type === 'datetime' ? `substr(${sql}, 1, 10)` : sql} <= ${bind(one(f.raw))}`);
    else if (f.op === 'between') {
      const [a, b] = f.raw.split(',');
      if (a === undefined || b === undefined) throw badRequest('Some filters are invalid.', [{ field: `filter[${f.key}][between]`, message: 'Give two values: from,to' }]);
      const lhs = col.type === 'datetime' ? `substr(${sql}, 1, 10)` : sql;
      parts.push(`${lhs} BETWEEN ${bind(one(a))} AND ${bind(one(b))}`);
    } else if (f.op === 'contains') parts.push(`COALESCE(${sql}, '') LIKE ${bind(likePattern(f.raw))} ESCAPE '\\'`);
    else if (f.op === 'empty') parts.push(`(${sql} IS NULL OR ${sql} = '')`);
    else if (f.op === 'notempty') parts.push(`(${sql} IS NOT NULL AND ${sql} != '')`);
  }
  return { sql: parts.join(' AND '), params: p };
}

export const orderOf = (def, req, tieBreaker) => {
  const parts = req.sort.map(({ key, dir }) => `${def.columns[key].sql} ${dir === 'desc' ? 'DESC' : 'ASC'}`);
  if (tieBreaker) parts.push(tieBreaker);
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
};

/**
 * Run a list request: the page of rows, the total count and the totals of the numeric columns over the whole filtered set (FR-09).
 * `select` is the SELECT list; `map(row)` presents a row; `totalsOf(rawTotals)` presents the totals (so masks apply to them too).
 * `limit: null` returns every row (exports), after the caller checked the count.
 */
export function runList(db, def, req, { select, scopeSql, params, map = (r) => r, tieBreaker, limit = undefined, presentTotals = (t) => t }) {
  const where = whereOf(def, req, { scopeSql, params });
  const totalCols = Object.entries(def.columns).filter(([, c]) => c.total);
  const agg = db.prepare(`SELECT COUNT(*) AS n${totalCols.map(([k, c]) => `, COALESCE(SUM(${c.sql}), 0) AS t_${k}`).join('')} FROM ${def.from} WHERE ${where.sql}`).get(where.params);
  const order = orderOf(def, req, tieBreaker);
  const pageSql = limit === null ? '' : ' LIMIT :limit OFFSET :offset';
  const rows = db.prepare(`SELECT ${select} FROM ${def.from} WHERE ${where.sql} ${order}${pageSql}`).all(limit === null ? where.params : { ...where.params, limit: limit ?? req.pageSize, offset: req.offset });
  const totals = Object.fromEntries(totalCols.map(([k]) => [k, agg[`t_${k}`]]));
  return {
    data: rows.map(map),
    meta: { page: req.page, pageSize: req.pageSize, total: agg.n, totalPages: Math.max(1, Math.ceil(agg.n / req.pageSize)), totals: presentTotals(totals) },
  };
}

/** How many rows a request would export (to choose between a direct download and a background job). */
export function countList(db, def, req, { scopeSql, params }) {
  const where = whereOf(def, req, { scopeSql, params });
  return db.prepare(`SELECT COUNT(*) AS n FROM ${def.from} WHERE ${where.sql}`).get(where.params).n;
}

/** The filters of a request as plain data (for saved views, export jobs and the audit trail). */
export const filtersOf = (req) => ({ q: req.q || undefined, sort: req.sort.map((s) => `${s.dir === 'desc' ? '-' : ''}${s.key}`).join(',') || undefined, filters: req.filters.map((f) => ({ key: f.key, op: f.op, value: f.raw })) });

/** The query-string parameters that reproduce a request (an export job replays the screen's query exactly). */
export function queryOf(req) {
  const q = {};
  if (req.q) q.q = req.q;
  if (req.sort.length) q.sort = req.sort.map((s) => `${s.dir === 'desc' ? '-' : ''}${s.key}`).join(',');
  for (const f of req.filters) q[f.op === 'eq' ? `filter[${f.key}]` : `filter[${f.key}][${f.op}]`] = f.raw;
  return q;
}
