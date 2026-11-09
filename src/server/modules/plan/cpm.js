// The critical path method of part 13.01 (FR-06, BR-01, BR-02). Pure: no database, no clock. The server is the only place dates are worked out.
//
// Time is counted in working days of the schedule's calendar ("units"): unit 0 is the first working day on or after the origin. As in the precedence diagramming
// method of the textbooks, an activity of duration D that starts at ES finishes at EF = ES + D (its last working day is unit EF - 1); a milestone has D = 0.
//   FS lag L: ES(s) >= EF(p) + L      SS lag L: ES(s) >= ES(p) + L      FF lag L: EF(s) >= EF(p) + L      SF lag L: EF(s) >= ES(p) + L
// The backward pass mirrors these; total float = LF - EF, free float = the smallest slack to any successor (to the project finish when there is none); critical = total float <= 0.
// An activity on its own calendar (a 7-day curing calendar, say) takes its duration in its calendar, converted to schedule units where it starts.
// LOE and summary activities take no part in the logic: a LOE runs from the earliest start of its predecessors to the latest finish of its successors; a summary spans the activities of its WBS node and below.

const DAY = 86_400_000;
export const ordOf = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const isoOf = (ord) => new Date(ord * DAY).toISOString().slice(0, 10);
const weekday = (ord) => (ord + 3) % 7; // 1970-01-01 was a Thursday; Monday = 0

/**
 * A working calendar: `workWeek` is seven 1/0 characters from Monday; `holidays` are dates that are not worked; `exceptions` are { date, working } that override both
 * (a site that works a holiday, or stops on a working day).
 */
export function makeCalendar({ workWeek = '1111110', holidays = [], exceptions = [] } = {}) {
  if (!/^[01]{7}$/.test(workWeek) || workWeek === '0000000') throw new RangeError('A work week is seven 1/0 characters with at least one working day');
  const off = new Set(holidays.map(ordOf)); const over = new Map(exceptions.map((e) => [ordOf(e.date), Boolean(e.working)]));
  const isWork = (ord) => (over.has(ord) ? over.get(ord) : !off.has(ord) && workWeek[weekday(ord)] === '1');
  const next = (ord) => { let o = ord; for (let i = 0; i < 4000 && !isWork(o); i += 1) o += 1; return o; };
  const prev = (ord) => { let o = ord; for (let i = 0; i < 4000 && !isWork(o); i += 1) o -= 1; return o; };
  /** The working day n working days after a working day (n >= 0), or before it (n < 0). */
  const add = (ord, n) => { let o = ord; let k = Math.abs(n); const step = n < 0 ? -1 : 1; while (k > 0) { o += step; if (isWork(o)) k -= 1; } return o; };
  return { isWork, next, prev, add, workWeek };
}

/** The units of a calendar from an origin: unit u is the u-th working day on or after the origin (u may be negative). */
function unitsOf(cal, originOrd) {
  const first = cal.next(originOrd); const fwd = [first]; const back = [];
  const ordAt = (u) => {
    if (u >= 0) { while (fwd.length <= u) fwd.push(cal.add(fwd.at(-1), 1)); return fwd[u]; }
    const k = -u - 1; while (back.length <= k) back.push(cal.add(back.length ? back.at(-1) : first, -1)); return back[k];
  };
  /** The unit of the first working day on or after a date. */
  const unitAt = (ord) => {
    if (ord >= first) { let lo = 0; let hi = Math.max(1, fwd.length - 1); while (ordAt(hi) < ord) hi *= 2; while (lo < hi) { const m = (lo + hi) >> 1; if (ordAt(m) >= ord) hi = m; else lo = m + 1; } return lo; }
    let u = -1; while (ordAt(u) >= ord) u -= 1; return u + 1;
  };
  return { ordAt, unitAt };
}

/** BR-02: the first circular path among the links, as a list of activity ids that starts and ends with the same one, or null. */
export function findCycle(ids, links) {
  const out = new Map(ids.map((id) => [id, []])); for (const l of links) if (out.has(l.pred) && out.has(l.succ)) out.get(l.pred).push(l.succ);
  const colour = new Map(); const parent = new Map();
  for (const start of ids) {
    if (colour.get(start)) continue;
    const stack = [[start, 0]]; colour.set(start, 1);
    while (stack.length) {
      const top = stack.at(-1); const [node, i] = top; const next = out.get(node)[i];
      if (next === undefined) { colour.set(node, 2); stack.pop(); continue; }
      top[1] += 1;
      if (colour.get(next) === 1) { const path = [next]; let n = node; while (n !== next) { path.push(n); n = parent.get(n); } path.push(next); return path.reverse(); }
      if (!colour.get(next)) { colour.set(next, 1); parent.set(next, node); stack.push([next, 0]); }
    }
  }
  return null;
}

/**
 * Runs the forward and backward passes.
 * @param {{ start: string, dataDate?: string|null, calendar: any, calendars?: Map<any, any>,
 *   activities: Array<{ id: any, type?: string, duration: number, calendarId?: any, constraintType?: string, constraintDate?: string|null, actualStart?: string|null, actualFinish?: string|null, remaining?: number|null, pct?: number, wbsPath?: any[] }>,
 *   links: Array<{ pred: any, succ: any, type?: string, lag?: number }> }} input
 */
export function calculate({ start, dataDate = null, calendar, calendars = new Map(), activities, links }) {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const net = activities.filter((a) => !['LOE', 'SUMMARY'].includes(a.type ?? 'TASK'));
  const netIds = new Set(net.map((a) => a.id));
  const ls = links.filter((l) => netIds.has(l.pred) && netIds.has(l.succ));
  const cycle = findCycle(net.map((a) => a.id), ls);
  if (cycle) return { ok: false, cycle };
  // the origin: the project start, or an earlier actual or constraint date
  let origin = ordOf(start);
  for (const a of activities) for (const d of [a.actualStart, a.constraintDate]) if (d) origin = Math.min(origin, ordOf(d));
  if (dataDate) origin = Math.min(origin, ordOf(dataDate));
  const U = unitsOf(calendar, origin); const s0 = U.unitAt(ordOf(start)); const dd = dataDate ? U.unitAt(ordOf(dataDate)) : null;
  const calOf = (a) => (a.calendarId != null && calendars.get(a.calendarId)) || calendar;
  /** The duration of an activity in schedule units when it starts at unit u (its own calendar may count differently). */
  const unitsFrom = (a, u, d) => {
    if (d <= 0) return 0; const c = calOf(a); if (c === calendar) return d;
    const s = c.next(U.ordAt(u)); const f = c.add(s, d - 1); return U.unitAt(f + 1) - u;
  };
  const unitsTo = (a, lf, d) => {
    if (d <= 0) return 0; const c = calOf(a); if (c === calendar) return d;
    const f = c.prev(U.ordAt(lf - 1)); const s = c.add(f, -(d - 1)); return lf - U.unitAt(s);
  };
  const remainingOf = (a) => (a.remaining != null ? a.remaining : Math.max(0, Math.round((a.duration * (10000 - (a.pct ?? 0))) / 10000)));
  // topological order (Kahn)
  const succs = new Map(net.map((a) => [a.id, []])); const preds = new Map(net.map((a) => [a.id, []])); const indeg = new Map(net.map((a) => [a.id, 0]));
  for (const l of ls) { succs.get(l.pred).push(l); preds.get(l.succ).push(l); indeg.set(l.succ, indeg.get(l.succ) + 1); }
  const order = []; const queue = net.filter((a) => indeg.get(a.id) === 0).map((a) => a.id);
  while (queue.length) { const id = queue.shift(); order.push(id); for (const l of succs.get(id)) { indeg.set(l.succ, indeg.get(l.succ) - 1); if (indeg.get(l.succ) === 0) queue.push(l.succ); } }
  const r = new Map();
  // ---- forward pass ----
  for (const id of order) {
    const a = byId.get(id); const lag = (l) => l.lag ?? 0;
    const done = Boolean(a.actualFinish); const started = Boolean(a.actualStart);
    if (done) { const es = U.unitAt(ordOf(a.actualStart)); const ef = Math.max(es, U.unitAt(ordOf(a.actualFinish) + 1)); r.set(id, { es, ef, dur: ef - es, state: 'DONE' }); continue; }
    if (started) {
      const es = U.unitAt(ordOf(a.actualStart)); const rem = remainingOf(a); const from = Math.max(es, dd ?? es);
      r.set(id, { es, ef: from + unitsFrom(a, from, rem), dur: null, rem, state: 'STARTED' }); continue;
    }
    let es = s0; if (dd != null) es = Math.max(es, dd);
    if (a.constraintType === 'SNET' && a.constraintDate) es = Math.max(es, U.unitAt(ordOf(a.constraintDate)));
    let dur = unitsFrom(a, es, a.duration);
    for (const l of preds.get(id)) {
      const p = r.get(l.pred); const t = l.type ?? 'FS';
      const c = t === 'FS' ? p.ef + lag(l) : t === 'SS' ? p.es + lag(l) : t === 'FF' ? p.ef + lag(l) - dur : p.es + lag(l) - dur;
      if (c > es) { es = c; dur = unitsFrom(a, es, a.duration); }
    }
    r.set(id, { es, ef: es + dur, dur, state: 'OPEN' });
  }
  let finish = s0; for (const id of order) finish = Math.max(finish, r.get(id).ef);
  // ---- backward pass ----
  for (const id of [...order].reverse()) {
    const a = byId.get(id); const x = r.get(id); const lag = (l) => l.lag ?? 0;
    if (x.state === 'DONE') { x.ls = x.es; x.lf = x.ef; continue; }
    const span = x.ef - x.es; let lf = finish;
    if (a.constraintType === 'FNLT' && a.constraintDate) lf = Math.min(lf, U.unitAt(ordOf(a.constraintDate) + 1));
    for (const l of succs.get(id)) {
      const s = r.get(l.succ); const t = l.type ?? 'FS';
      const c = t === 'FS' ? s.ls - lag(l) : t === 'SS' ? s.ls - lag(l) + span : t === 'FF' ? s.lf - lag(l) : s.lf - lag(l) + span;
      lf = Math.min(lf, c);
    }
    x.lf = lf; x.ls = x.state === 'STARTED' ? x.es + (lf - x.ef) : lf - unitsTo(a, lf, a.duration);
    if (x.state === 'OPEN' && calOf(a) === calendar) x.ls = lf - span;
  }
  // ---- floats, dates ----
  const out = new Map();
  for (const id of order) {
    const a = byId.get(id); const x = r.get(id);
    let free = finish - x.ef;
    for (const l of succs.get(id)) { const s = r.get(l.succ); const t = l.type ?? 'FS'; const lag = l.lag ?? 0; free = Math.min(free, t === 'FS' ? s.es - lag - x.ef : t === 'SS' ? s.es - lag - x.es : t === 'FF' ? s.ef - lag - x.ef : s.ef - lag - x.es); }
    const total = x.state === 'DONE' ? null : x.lf - x.ef;
    const date = (u) => isoOf(U.ordAt(u)); const c = calOf(a);
    const startIso = (u) => isoOf(c.next(U.ordAt(u)));
    const finishIso = (es, ef) => (ef > es ? isoOf(c.prev(U.ordAt(ef - 1))) : startIso(es));
    out.set(id, {
      es: x.state === 'DONE' || x.state === 'STARTED' ? a.actualStart : startIso(x.es), ef: x.state === 'DONE' ? a.actualFinish : finishIso(x.es, x.ef),
      ls: x.state === 'DONE' ? a.actualStart : (x.state === 'STARTED' ? a.actualStart : startIso(x.ls)), lf: x.state === 'DONE' ? a.actualFinish : finishIso(x.ls, x.lf),
      esU: x.es, efU: x.ef, lsU: x.ls, lfU: x.lf, totalFloat: total, freeFloat: x.state === 'DONE' ? null : free, critical: total != null && total <= 0, state: x.state, remaining: x.state === 'STARTED' ? x.rem : x.state === 'DONE' ? 0 : null,
    });
    void date;
  }
  // ---- LOE and summary activities ----
  for (const a of activities) {
    if (!['LOE', 'SUMMARY'].includes(a.type ?? 'TASK')) continue;
    let from = null; let to = null;
    if (a.type === 'LOE') {
      for (const l of links) { if (l.succ === a.id && out.has(l.pred)) from = from == null ? out.get(l.pred).esU : Math.min(from, out.get(l.pred).esU); if (l.pred === a.id && out.has(l.succ)) to = to == null ? out.get(l.succ).efU : Math.max(to, out.get(l.succ).efU); }
    } else {
      for (const b of activities) if (out.has(b.id) && b.wbsPath && a.wbsPath && a.wbsPath.length && a.wbsPath.every((w, i) => b.wbsPath[i] === w)) { const o = out.get(b.id); from = from == null ? o.esU : Math.min(from, o.esU); to = to == null ? o.efU : Math.max(to, o.efU); }
    }
    if (from == null) from = s0; if (to == null || to < from) to = Math.max(from, finish);
    out.set(a.id, { es: isoOf(calendar.next(U.ordAt(from))), ef: to > from ? isoOf(U.ordAt(to - 1)) : isoOf(U.ordAt(from)), ls: null, lf: null, esU: from, efU: to, lsU: null, lfU: null, totalFloat: null, freeFloat: null, critical: false, state: 'SPAN', duration: to - from });
  }
  return { ok: true, start: isoOf(U.ordAt(s0)), finish: finish > s0 ? isoOf(U.ordAt(finish - 1)) : isoOf(U.ordAt(s0)), finishUnits: finish - s0, results: out, order };
}
