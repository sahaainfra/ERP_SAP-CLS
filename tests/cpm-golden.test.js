import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, makeCalendar } from '../src/server/modules/plan/cpm.js';

// PACK-20: CPM golden cases on the edges, each worked out by hand on the calendar (December 2026: Monday 7th; Sundays 13th, 20th, 27th).
// The expected dates and floats are written here from the precedence-diagramming rules in plan/cpm.js's header, not copied from a run.
const SIX = makeCalendar({ workWeek: '1111110' }); // Monday to Saturday, Sunday off
const run = (o) => { const r = calculate({ start: '2026-12-07', calendar: SIX, ...o }); assert.ok(r.ok, JSON.stringify(r)); return r; };
const row = (r, id) => { const x = r.results.get(id); return [x.es, x.ef, x.totalFloat, x.freeFloat, x.critical]; };
const A = (id, duration, o = {}) => ({ id, duration, ...o });
const FS = (pred, succ, lag = 0) => ({ pred, succ, type: 'FS', lag });

test('PACK-20 CPM 1: a finish-to-start chain over a Sunday; the project finish', () => {
  const r = run({ activities: [A('A', 3), A('B', 2), A('C', 4)], links: [FS('A', 'B'), FS('B', 'C')] });
  assert.deepEqual(row(r, 'A'), ['2026-12-07', '2026-12-09', 0, 0, true]);
  assert.deepEqual(row(r, 'B'), ['2026-12-10', '2026-12-11', 0, 0, true]);
  assert.deepEqual(row(r, 'C'), ['2026-12-12', '2026-12-16', 0, 0, true], 'Sat 12, (Sun 13 off), Mon 14 to Wed 16');
  assert.deepEqual([r.finish, r.finishUnits], ['2026-12-16', 9]);
});

test('PACK-20 CPM 2: a holiday and a worked Sunday (exception)', () => {
  const cal = makeCalendar({ workWeek: '1111110', holidays: ['2026-12-10'], exceptions: [{ date: '2026-12-13', working: true }] });
  const r = run({ calendar: cal, activities: [A('A', 3), A('B', 2), A('C', 4)], links: [FS('A', 'B'), FS('B', 'C')] });
  assert.deepEqual(row(r, 'B').slice(0, 2), ['2026-12-11', '2026-12-12'], 'Thu 10 is a holiday');
  assert.deepEqual(row(r, 'C').slice(0, 2), ['2026-12-13', '2026-12-16'], 'Sunday 13 is worked by exception: Sun 13 to Wed 16');
  const five = run({ calendar: makeCalendar({ workWeek: '1111100' }), activities: [A('A', 5), A('B', 1)], links: [FS('A', 'B')] });
  assert.deepEqual([row(five, 'A').slice(0, 2), row(five, 'B').slice(0, 2)], [['2026-12-07', '2026-12-11'], ['2026-12-14', '2026-12-14']], 'a five-day week: Monday after Friday');
});

test('PACK-20 CPM 3: total and free float on a parallel path; start-to-start and finish-to-finish lags', () => {
  const r = run({ activities: [A('A', 3), A('B', 1), A('C', 2)], links: [FS('A', 'C'), FS('B', 'C')] });
  assert.deepEqual(row(r, 'B'), ['2026-12-07', '2026-12-07', 2, 2, false], 'B can slip two days before it delays C');
  const s = run({ activities: [A('A', 5), A('B', 3), A('C', 4)], links: [{ pred: 'A', succ: 'B', type: 'SS', lag: 2 }, { pred: 'A', succ: 'C', type: 'FF', lag: 1 }] });
  assert.deepEqual(row(s, 'B').slice(0, 2), ['2026-12-09', '2026-12-11'], 'SS +2: B starts two days after A starts');
  assert.deepEqual(row(s, 'C').slice(0, 2), ['2026-12-09', '2026-12-12'], 'FF +1: C finishes a day after A (A ends Fri 11): Wed 9 to Sat 12');
  assert.deepEqual([s.finish, row(s, 'C')[2], row(s, 'A')[2], row(s, 'B')[2]], ['2026-12-12', 0, 0, 1], 'A drives C through FF; B has a day');
});

test('PACK-20 CPM 4: negative float when a finish-no-later-than constraint cannot be met; every activity behind it is critical', () => {
  const r = run({ activities: [A('A', 3), A('B', 2), A('C', 4, { constraintType: 'FNLT', constraintDate: '2026-12-14' })], links: [FS('A', 'B'), FS('B', 'C')] });
  assert.deepEqual(row(r, 'C'), ['2026-12-12', '2026-12-16', -2, 0, true], 'C must finish by Mon 14 but can only finish Wed 16: -2 days');
  assert.deepEqual([row(r, 'A')[2], row(r, 'B')[2], row(r, 'A')[4], row(r, 'B')[4]], [-2, -2, true, true]);
  assert.equal(r.results.get('C').lf, '2026-12-14');
  assert.equal(r.results.get('A').ls, '2026-12-04', 'A should have started two working days earlier: Fri 4 (Sat 5 is worked)');
});

test('PACK-20 CPM 5: start-no-earlier-than pushes an activity and gives float to the path before it', () => {
  const r = run({ activities: [A('A', 3), A('B', 2), A('C', 4, { constraintType: 'SNET', constraintDate: '2026-12-21' })], links: [FS('A', 'B'), FS('B', 'C')] });
  assert.deepEqual(row(r, 'C'), ['2026-12-21', '2026-12-24', 0, 0, true]);
  assert.deepEqual(row(r, 'B'), ['2026-12-10', '2026-12-11', 7, 7, false], 'B ends Fri 11; C may not start before Mon 21: Sat 12, Mon 14 to Sat 19 = 7 working days');
  assert.equal(row(r, 'A')[2], 7);
});

test('PACK-20 CPM 6: an activity on a seven-day curing calendar; a milestone; a cycle is refused', () => {
  const cure = makeCalendar({ workWeek: '1111111' });
  const r = run({ calendars: new Map([['7D', cure]]), activities: [A('POUR', 3), A('CURE', 7, { calendarId: '7D' }), A('STRIP', 1), A('M', 0, { type: 'MILESTONE' })], links: [FS('POUR', 'CURE'), FS('CURE', 'STRIP'), FS('STRIP', 'M')] });
  assert.deepEqual(row(r, 'CURE').slice(0, 2), ['2026-12-10', '2026-12-16'], 'Thu 10 to Wed 16 counting Sunday 13');
  assert.deepEqual(row(r, 'STRIP').slice(0, 2), ['2026-12-17', '2026-12-17']);
  assert.deepEqual(row(r, 'M').slice(0, 2), ['2026-12-18', '2026-12-18'], 'a milestone takes no time: at the start of the next working day');
  const c = calculate({ start: '2026-12-07', calendar: SIX, activities: [A('A', 1), A('B', 1), A('C', 1)], links: [FS('A', 'B'), FS('B', 'C'), FS('C', 'A')] });
  assert.equal(c.ok, false); assert.deepEqual([c.cycle[0], c.cycle.at(-1), c.cycle.length], [c.cycle[0], c.cycle[0], 4]);
});

test('PACK-20 CPM 7: progress at a data date: a finished activity keeps its actuals, a started one runs its remaining duration from the data date', () => {
  const r = run({ dataDate: '2026-12-14', activities: [A('A', 3, { actualStart: '2026-12-07', actualFinish: '2026-12-10' }), A('B', 4, { actualStart: '2026-12-11', remaining: 2 }), A('C', 2)], links: [FS('A', 'B'), FS('B', 'C')] });
  assert.deepEqual(row(r, 'A').slice(0, 3), ['2026-12-07', '2026-12-10', null], 'done: actual dates, no float');
  assert.deepEqual(row(r, 'B').slice(0, 2), ['2026-12-11', '2026-12-15'], 'two days left from Mon 14: Mon 14 and Tue 15');
  assert.deepEqual(row(r, 'C').slice(0, 2), ['2026-12-16', '2026-12-17']);
  assert.equal(r.finish, '2026-12-17');
});
