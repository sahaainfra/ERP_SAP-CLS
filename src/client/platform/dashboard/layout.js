// The pure rules of a dashboard's layout (part 03.07, FR-03): an ordered list of places { id, widget, w, h, params } on a twelve-column grid.
// The browser flows the places in order (CSS grid, dense), so moving a place is changing its position in the list, by drag-and-drop or by
// the keyboard buttons, and a phone shows the same list in one column. No React here, so Node tests drive the same code the browser runs.

export const COLUMNS = 12;
export const MAX_ITEMS = 40;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));

/** A place with its size held inside the grid. */
export const fit = (item) => ({ ...item, w: clamp(item.w, 1, COLUMNS), h: clamp(item.h, 1, 4), params: item.params ?? {} });

/** The next free id ("w14"): ids stay short and never repeat within one dashboard. */
export function nextId(layout) {
  const used = new Set(layout.map((i) => i.id));
  let n = layout.length + 1;
  while (used.has(`w${n}`)) n += 1;
  return `w${n}`;
}

/** Add a widget from the catalogue at its default size, at the end. Returns the same layout when full. */
export function addWidget(layout, widget, params = {}) {
  if (layout.length >= MAX_ITEMS) return layout;
  return [...layout, fit({ id: nextId(layout), widget: widget.code, w: widget.defaultW, h: widget.defaultH, params })];
}

export const removeItem = (layout, id) => layout.filter((i) => i.id !== id);

/** Move a place to a position in the list (drag-and-drop drops one place onto another). */
export function moveTo(layout, id, index) {
  const from = layout.findIndex((i) => i.id === id);
  if (from < 0) return layout;
  const to = clamp(index, 0, layout.length - 1);
  if (to === from) return layout;
  const next = [...layout];
  const [one] = next.splice(from, 1);
  next.splice(to, 0, one);
  return next;
}

/** Move a place one step earlier (-1) or later (+1): the keyboard way to the same result. */
export function moveBy(layout, id, step) {
  const from = layout.findIndex((i) => i.id === id);
  return from < 0 ? layout : moveTo(layout, id, from + step);
}

/** Change the width and/or height of a place, kept inside the grid. */
export const resizeItem = (layout, id, { w, h }) => layout.map((i) => (i.id === id ? fit({ ...i, ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) }) : i));

export const setParams = (layout, id, params) => layout.map((i) => (i.id === id ? { ...i, params } : i));

/** True when two layouts put the same widgets, sizes and settings in the same order (the editor's "unsaved changes"). */
export const sameLayout = (a, b) => JSON.stringify(a.map(fit)) === JSON.stringify(b.map(fit));

/** How many grid columns a place spans at a given container width: phones show one column, tablets six, desktops twelve. */
export function spanAt(item, width) {
  if (width < 600) return COLUMNS;
  if (width < 1000) return Math.min(COLUMNS, Math.max(6, Math.ceil(item.w / 2) * 2));
  return item.w;
}

/** The seconds between refreshes of a widget: the widget's own, never faster than 15 seconds, and 0 (off) while the page is hidden. */
export const refreshMs = (refreshSec, hidden = false) => (hidden || !refreshSec ? false : Math.max(15, refreshSec) * 1000);

/** The text of "Updated hh:mm" for a data time, in the person's own clock. */
export function updatedText(asOf, now = Date.now()) {
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return '';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return 'Updated just now';
  if (secs < 3600) return `Updated ${Math.floor(secs / 60)} min ago`;
  return `Updated ${new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

/** The filters a dashboard's period preset means today: a preset id from the list's date presets, else the dates given. */
export function periodOf(filters, presets) {
  const p = presets.find((x) => x.id === filters.preset);
  return p ? { from: p.from, to: p.to } : { from: filters.from, to: filters.to };
}

/** The query string of one widget's data request: the global filters and the place's own settings. */
export function widgetQuery(filters, presets, params = {}) {
  const q = new URLSearchParams();
  const { from, to } = periodOf(filters, presets);
  if (from && to) { q.set('from', from); q.set('to', to); }
  if (filters.projectId) q.set('projectId', String(filters.projectId));
  if (filters.siteId && filters.projectId) q.set('siteId', String(filters.siteId));
  if (params && Object.keys(params).length) q.set('params', JSON.stringify(params));
  return q.toString();
}

/** The address behind a widget with the dashboard's project and site added, unless the address names them already (part 166.2, U-03). */
export function withDashFilters(route, filters) {
  const [path, search = ''] = String(route).split('?');
  const sp = new URLSearchParams(search);
  if (filters?.projectId && !sp.has('projectId')) sp.set('projectId', String(filters.projectId));
  if (filters?.siteId && !sp.has('siteId')) sp.set('siteId', String(filters.siteId));
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}
