// The pure rules of the List Report (part 03.03): the query string a list state asks for (the server's filter contract), date presets
// for quick filters (this month, last financial year, ...), what a saved view holds, and how column choices combine. No React here,
// so Node tests drive the same code the browser runs.

export const PAGE_SIZES = [25, 50, 100, 200];
export const OPERATOR_LABELS = { eq: 'is', ne: 'is not', in: 'is one of', gte: 'from / at least', lte: 'up to / at most', between: 'between', contains: 'contains', empty: 'is empty', notempty: 'is not empty' };
export const NO_VALUE = new Set(['empty', 'notempty']);

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Date ranges for quick filters, from today in India. The financial year runs April to March. */
export function datePresets(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const fyStart = m >= 3 ? y : y - 1;
  const prevMonth = m === 0 ? [y - 1, 11] : [y, m - 1];
  const q = Math.floor(m / 3);
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'this-month', label: 'This month', from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) },
    { id: 'last-month', label: 'Last month', from: iso(prevMonth[0], prevMonth[1], 1), to: iso(prevMonth[0], prevMonth[1], lastDay(prevMonth[0], prevMonth[1])) },
    { id: 'this-quarter', label: 'This quarter', from: iso(y, q * 3, 1), to: iso(y, q * 3 + 2, lastDay(y, q * 3 + 2)) },
    { id: 'this-fy', label: `This FY (${fyStart}-${pad((fyStart + 1) % 100)})`, from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` },
    { id: 'last-fy', label: `Last FY (${fyStart - 1}-${pad(fyStart % 100)})`, from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` },
  ];
}

/** The query string for a list state: q, sort, page, pageSize and filter[key][op]=value. */
export function toQuery({ q = '', sort = '', page = 1, pageSize = 25, filters = [] } = {}, extra = {}) {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (sort) p.set('sort', sort);
  p.set('page', String(page));
  p.set('pageSize', String(pageSize));
  for (const f of filters) {
    if (!f.key || !f.op) continue;
    if (!NO_VALUE.has(f.op) && (f.value === '' || f.value === undefined || f.value === null)) continue;
    p.set(f.op === 'eq' ? `filter[${f.key}]` : `filter[${f.key}][${f.op}]`, NO_VALUE.has(f.op) ? '1' : String(f.value));
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

/** One filter per key and operator: setting one replaces the earlier one with the same key and operator. */
export function setFilter(filters, next) {
  const rest = filters.filter((f) => !(f.key === next.key && f.op === next.op));
  return next.value === '' || next.value === null || next.value === undefined ? rest : [...rest, next];
}
export const removeFilter = (filters, key, op) => filters.filter((f) => !(f.key === key && (!op || f.op === op)));

/**
 * The filters an address carries (part 03.07, FR-05): `?filter[status][in]=DRAFT,SUBMITTED&filter[projectCode]=ALP` becomes
 * [{ key, op, value }], the form a list state holds, so a widget's drill-down opens the list with the same filters it counted.
 */
export function filtersFromSearch(search) {
  const out = [];
  for (const [name, value] of new URLSearchParams(search ?? '')) {
    const m = /^filter\[([A-Za-z][A-Za-z0-9_]*)\](?:\[([a-z]+)\])?$/.exec(name);
    if (!m) continue;
    const op = m[2] ?? 'eq';
    if (!(op in OPERATOR_LABELS) || (value === '' && !NO_VALUE.has(op))) continue;
    out.push({ key: m[1], op, value: NO_VALUE.has(op) ? '' : value });
  }
  return out.filter((f, i) => !out.slice(i + 1).some((g) => g.key === f.key && g.op === f.op)); // the later one of a key and operator wins
}

/** Cycle a column's sort: none -> ascending -> descending -> none, keeping it as the only sort. */
export function nextSort(current, key) {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return '';
  return key;
}

/** What a saved view stores (FR-03): columns (order and hidden), widths, filters, sort, page size, search. */
export const viewConfig = (state) => ({ columns: state.columns, hidden: state.hidden, widths: state.widths, filters: state.filters, sort: state.sort, pageSize: state.pageSize, q: state.q, ...(state.groupBy ? { groupBy: state.groupBy } : {}) }); // part 166.7: a view keeps its group-by

/** The visible columns in order: saved order first (unknown keys dropped), new columns appended, hidden ones left out. */
export function visibleColumns(all, { columns = [], hidden = [] } = {}) {
  const byKey = new Map(all.map((c) => [c.key, c]));
  const order = [...columns.filter((k) => byKey.has(k)), ...all.map((c) => c.key).filter((k) => !columns.includes(k))];
  return order.filter((k) => !hidden.includes(k)).map((k) => byKey.get(k));
}

/** Move a column one place left or right in the saved order. */
export function moveColumn(order, key, by) {
  const list = order.slice();
  const i = list.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/** The rows to draw for a scroll position when a page is long (virtual scrolling, FR-01). */
export function windowOf({ count, rowHeight, viewport, scrollTop, overscan = 8 }) {
  if (count <= 0) return { start: 0, end: 0, before: 0, after: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}

/** Plain words for the active filters ("Status is Draft; Total from 1000"), for chips and for the export footer. */
export function describeFilters(filters, columns) {
  const label = (k) => columns.find((c) => c.key === k)?.label ?? k;
  const value = (f) => {
    const col = columns.find((c) => c.key === f.key);
    const opt = (v) => col?.options?.find(([o]) => o === v)?.[1] ?? v;
    return String(f.value).split(',').map(opt).join(', ');
  };
  return filters.map((f) => `${label(f.key)} ${OPERATOR_LABELS[f.op] ?? f.op}${NO_VALUE.has(f.op) ? '' : ` ${value(f)}`}`);
}
