import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { calculate, findCycle, makeCalendar } from '../src/server/modules/plan/cpm.js';
import { setupCompany, startApi } from './helpers.js';

// Part 13.01: the schedule core. T-01 the CPM results of reference networks (the activity-on-node example of the precedence diagramming method, and one with SS, FF and SF lags) worked out by hand, and an independent
// solver on random networks; T-02 a schedule of 5,000 activities calculates in less than 3 s. Also: calendars and templates put in force by a second person, activities generated from a template per floor and from the BOQ,
// links and the loop refused with its path (BR-02), the CPM on the server only (BR-01), bulk edit, the BOQ split, progress at a data date (and from the DPR), approval and locking, a new version, the report, roles and isolation.
const P = '/api/v1/plan'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `pl-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'pplan1'); const plan2 = as('PLAN', 'pplan2'); const pcm = as('PCMGR', 'ppcm1'); const pm = as('PM', 'ppm1'); const se = as('SE', 'pse1'); const other = as('PLAN', 'pplan9', '2'); const sys = as('SYSADM', 'psys1');

// ---- T-01: the reference networks ------------------------------------------------------------------------------------------------------------------------------------
const net = (acts, links, extra = {}) => calculate({ start: '2026-01-01', calendar: makeCalendar({ workWeek: '1111111' }), activities: acts.map(([id, duration]) => ({ id, duration })), links, ...extra });
const units = (r) => Object.fromEntries([...r.results].map(([k, v]) => [k, [v.esU, v.efU, v.lsU, v.lfU, v.totalFloat, v.freeFloat, v.critical]]));

test('T-01 the activity-on-node reference network gives the published early and late dates, floats and critical path exactly', () => {
  // A 5; B 4 and C 6 after A; D 2 after B; E 3 after C and D; F 4 after C; G 2 after E and F (finish-to-start, no lags)
  const r = net([['A', 5], ['B', 4], ['C', 6], ['D', 2], ['E', 3], ['F', 4], ['G', 2]], [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'E'], ['D', 'E'], ['C', 'F'], ['E', 'G'], ['F', 'G']].map(([pred, succ]) => ({ pred, succ })));
  assert.equal(r.ok, true); assert.equal(r.finishUnits, 17);
  assert.deepEqual(units(r), {
    //   ES  EF  LS  LF  TF FF critical
    A: [0, 5, 0, 5, 0, 0, true], B: [5, 9, 6, 10, 1, 0, false], C: [5, 11, 5, 11, 0, 0, true], D: [9, 11, 10, 12, 1, 0, false],
    E: [11, 14, 12, 15, 1, 1, false], F: [11, 15, 11, 15, 0, 0, true], G: [15, 17, 15, 17, 0, 0, true],
  });
});

test('T-01 the precedence diagram with SS, FF and SF lags gives the hand-worked results exactly', () => {
  // P 4; Q 6 SS+2 from P; R 3 FF+1 from Q; S 2 SF+5 from P; T 1 after R and S
  const r = net([['P', 4], ['Q', 6], ['R', 3], ['S', 2], ['T', 1]], [{ pred: 'P', succ: 'Q', type: 'SS', lag: 2 }, { pred: 'Q', succ: 'R', type: 'FF', lag: 1 }, { pred: 'P', succ: 'S', type: 'SF', lag: 5 }, { pred: 'R', succ: 'T' }, { pred: 'S', succ: 'T' }]);
  assert.equal(r.finishUnits, 10);
  assert.deepEqual(units(r), { P: [0, 4, 0, 4, 0, 0, true], Q: [2, 8, 2, 8, 0, 0, true], R: [6, 9, 6, 9, 0, 0, true], S: [3, 5, 7, 9, 4, 4, false], T: [9, 10, 9, 10, 0, 0, true] });
  // a negative lag (lead), and a milestone
  const m = net([['A', 3], ['M', 0], ['B', 2]], [{ pred: 'A', succ: 'M' }, { pred: 'A', succ: 'B', lag: -1 }]);
  assert.deepEqual([units(m).M.slice(0, 2), units(m).B.slice(0, 2), m.finishUnits], [[3, 3], [2, 4], 4]);
});

test('T-01 the dates: working days of a six-day week with a holiday, an own calendar, constraints, the data date, LOE and summary spans', () => {
  const cal = makeCalendar({ workWeek: '1111110', holidays: ['2026-04-14'] }); // Monday 6 April 2026 is the start; Sunday is off, so is Tuesday 14 April
  const r = calculate({ start: '2026-04-06', calendar: cal, activities: [{ id: 'A', duration: 5 }, { id: 'B', duration: 3 }], links: [{ pred: 'A', succ: 'B' }] });
  assert.deepEqual([r.results.get('A').es, r.results.get('A').ef, r.results.get('B').es, r.results.get('B').ef], ['2026-04-06', '2026-04-10', '2026-04-11', '2026-04-15'], 'Saturday works; Sunday the 12th and the holiday on the 14th do not: B runs on the 11th, 13th and 15th');
  // curing on a seven-day calendar runs over the Sunday
  const seven = makeCalendar({ workWeek: '1111111' });
  const c = calculate({ start: '2026-04-06', calendar: cal, calendars: new Map([[7, seven]]), activities: [{ id: 'POUR', duration: 1 }, { id: 'CURE', duration: 7, calendarId: 7 }, { id: 'NEXT', duration: 1 }], links: [{ pred: 'POUR', succ: 'CURE' }, { pred: 'CURE', succ: 'NEXT' }] });
  assert.deepEqual([c.results.get('CURE').es, c.results.get('CURE').ef, c.results.get('NEXT').es], ['2026-04-07', '2026-04-13', '2026-04-15'], 'seven calendar days of curing; the next work waits for the first working day after it');
  // start no earlier than, and finish no later than (negative float)
  const k = calculate({ start: '2026-04-06', calendar: cal, activities: [{ id: 'A', duration: 4, constraintType: 'SNET', constraintDate: '2026-04-09' }, { id: 'B', duration: 2, constraintType: 'FNLT', constraintDate: '2026-04-11' }], links: [{ pred: 'A', succ: 'B' }] });
  assert.equal(k.results.get('A').es, '2026-04-09'); assert.ok(k.results.get('B').totalFloat < 0, 'B cannot finish by its date: negative float'); assert.equal(k.results.get('B').critical, true);
  // progress at a data date: done, in progress (remaining from the data date), not started (not before the data date)
  const g = calculate({ start: '2026-04-06', dataDate: '2026-04-09', calendar: cal, activities: [{ id: 'A', duration: 2, actualStart: '2026-04-06', actualFinish: '2026-04-07' }, { id: 'B', duration: 4, actualStart: '2026-04-08', remaining: 3 }, { id: 'C', duration: 1 }, { id: 'X', duration: 1 }], links: [{ pred: 'A', succ: 'B' }, { pred: 'B', succ: 'C' }] });
  assert.deepEqual([g.results.get('A').state, g.results.get('A').totalFloat, g.results.get('B').ef, g.results.get('C').es, g.results.get('X').es], ['DONE', null, '2026-04-11', '2026-04-13', '2026-04-09']);
  // a level of effort spans from its predecessors to its successors; a summary spans its WBS node
  const s = calculate({ start: '2026-04-06', calendar: cal, activities: [{ id: 'A', duration: 2, wbsPath: [1, 2] }, { id: 'B', duration: 3, wbsPath: [1, 3] }, { id: 'L', type: 'LOE', duration: 0 }, { id: 'S', type: 'SUMMARY', duration: 0, wbsPath: [1] }], links: [{ pred: 'A', succ: 'B' }, { pred: 'A', succ: 'L', type: 'SS' }, { pred: 'L', succ: 'B', type: 'FF' }] });
  assert.deepEqual([s.results.get('L').es, s.results.get('L').ef, s.results.get('S').es, s.results.get('S').ef, s.results.get('L').critical], ['2026-04-06', '2026-04-10', '2026-04-06', '2026-04-10', false]);
});

test('T-01 an independent solver agrees on 300 random networks (all link types and lags), and a loop is found with its path', () => {
  let x = 20261117; const rnd = (n) => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
  for (let k = 0; k < 300; k += 1) {
    const n = 2 + rnd(25); const acts = Array.from({ length: n }, (_, i) => [i, rnd(4) === 0 ? 0 : 1 + rnd(9)]); const links = [];
    for (let i = 1; i < n; i += 1) for (let j = 0; j < i; j += 1) if (rnd(4) === 0) links.push({ pred: j, succ: i, type: ['FS', 'SS', 'FF', 'SF'][rnd(4)], lag: rnd(7) - 2 });
    const r = net(acts, links);
    // the forward pass by relaxation until nothing changes (Bellman-Ford on the longest path), not by topological order
    const D = new Map(acts); const es = new Map(acts.map(([i]) => [i, 0])); let changed = true;
    while (changed) { changed = false; for (const l of links) { const w = l.type === 'FS' ? D.get(l.pred) + l.lag : l.type === 'SS' ? l.lag : l.type === 'FF' ? D.get(l.pred) + l.lag - D.get(l.succ) : l.lag - D.get(l.succ); if (es.get(l.pred) + w > es.get(l.succ)) { es.set(l.succ, es.get(l.pred) + w); changed = true; } } }
    const finish = Math.max(0, ...acts.map(([i, d]) => es.get(i) + d)); const lf = new Map(acts.map(([i]) => [i, finish])); changed = true;
    while (changed) { changed = false; for (const l of links) { const dp = D.get(l.pred); const ls = lf.get(l.succ) - D.get(l.succ); const c = l.type === 'FS' ? ls - l.lag : l.type === 'SS' ? ls - l.lag + dp : l.type === 'FF' ? lf.get(l.succ) - l.lag : lf.get(l.succ) - l.lag + dp; if (c < lf.get(l.pred)) { lf.set(l.pred, c); changed = true; } } }
    assert.equal(r.finishUnits, finish, `network ${k}`);
    for (const [i, d] of acts) { const v = r.results.get(i); assert.deepEqual([v.esU, v.efU, v.lfU, v.totalFloat], [es.get(i), es.get(i) + d, lf.get(i), lf.get(i) - es.get(i) - d], `network ${k}, activity ${i}`); }
  }
  assert.deepEqual(findCycle([1, 2, 3, 4], [{ pred: 1, succ: 2 }, { pred: 2, succ: 3 }, { pred: 3, succ: 4 }, { pred: 4, succ: 2 }]), [2, 3, 4, 2]);
  const loop = net([['A', 1], ['B', 1]], [{ pred: 'A', succ: 'B' }, { pred: 'B', succ: 'A' }]); assert.equal(loop.ok, false); assert.deepEqual(loop.cycle, ['A', 'B', 'A']);
});

// ---- the API ---------------------------------------------------------------------------------------------------------------------------------------------------
async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['pplan1', ['PLAN']], ['pplan2', ['PLAN']], ['ppcm1', ['PCMGR']], ['ppm1', ['PM']], ['pse1', ['SE']], ['psys1', ['SYSADM']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'TWR', 'Tower A', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'BRG', 'Bridge B', 'BRIDGE', 'ACTIVE')").run().lastInsertRowid);
  const wbs = (code, name, parent = null) => Number(d.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (1, ?, ?, ?, ?, ?, ?)').run(pid, parent, code, name, parent ? 2 : 1, 't').lastInsertRowid);
  const w1 = wbs('1', 'Substructure'); const w11 = wbs('1.1', 'Footings', w1); const w12 = wbs('1.2', 'Plinth beams', w1); const w2 = wbs('2', 'Superstructure');
  const loc = (code, name) => Number(d.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, sort_order, created_by) VALUES (1, ?, 'FLOOR', ?, ?, ?, 't')").run(pid, code, name, Number(code.replace(/\D/g, '')) || 0).lastInsertRowid);
  const f1 = loc('F1', 'First floor'); const f2 = loc('F2', 'Second floor'); const f3 = loc('F3', 'Third floor');
  const ver = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (1, 'BQ/1', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 't')").run(pid).lastInsertRowid);
  const item = (code, desc, uom, qty) => Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, created_by) VALUES (1, ?, 'ITEM', ?, ?, ?, ?, 0, 0, 't')").run(ver, code, desc, uom, qty).lastInsertRowid);
  const i1 = item('2.1', 'Excavation', 'cum', 500_000); const i2 = item('2.2', 'Footing concrete M25', 'cum', 120_000);
  for (const [line, w, q] of [[i1, w11, 300_000], [i1, w12, 200_000], [i2, w11, 120_000]]) d.prepare('INSERT INTO proj_boq_line_wbs (company_id, line_id, wbs_id, qty, created_by) VALUES (1, ?, ?, ?, ?)').run(line, w, q, 't');
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const calendar = async (over = {}) => { const c = await call(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday', ...over }); assert.equal(c.status, 201, JSON.stringify(c.json)); const a = await call(pcm, 'POST', `/calendars/${c.json.data.id}/activate`); assert.equal(a.status, 200, JSON.stringify(a.json)); return c.json.data.id; };
  return { api, d, call, act, pid, pid2, w1, w11, w12, w2, f1, f2, f3, i1, i2, calendar };
}
const sched = async (t, over = {}) => { const s = await t.call(plan1, 'POST', '/schedules', { projectId: t.pid, name: 'Tower A working schedule', calendarId: over.calendarId ?? await t.calendar(), startDate: '2026-04-06', ...over }); assert.equal(s.status, 201, JSON.stringify(s.json)); return s.json.data; };

test('calendars and templates: drafted by one person, put in force by another; the working days of a calendar', async () => {
  const t = await boot();
  const hc = Number(t.d.prepare("INSERT INTO core_holiday_calendars (company_id, code, name, created_by) VALUES (1, 'MH', 'Maharashtra', 't')").run().lastInsertRowid);
  t.d.prepare("INSERT INTO core_holidays (company_id, calendar_id, holiday_date, name, type, created_by) VALUES (1, ?, '2026-04-14', 'Ambedkar Jayanti', 'national', 't')").run(hc);
  assert.equal((await t.call(pm, 'POST', '/calendars', { code: 'X', name: 'Not mine', reason: 'A project manager reads calendars' })).status, 403);
  const c = await t.call(plan1, 'POST', '/calendars', { code: 'SITE', name: 'Site calendar', workWeek: '1111110', holidayCalendarId: hc, exceptions: [{ date: '2026-04-12', working: true, note: 'Sunday pour' }], reason: 'Site works Saturdays and the Sunday of the pour' });
  assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal(c.json.data.status, 'DRAFT');
  assert.equal((await t.call(plan1, 'POST', `/calendars/${c.json.data.id}/activate`)).status, 403, 'the maker does not put it in force');
  assert.equal((await t.call(plan2, 'POST', `/calendars/${c.json.data.id}/activate`)).status, 403, 'a planner does not check');
  const on = await t.call(pcm, 'POST', `/calendars/${c.json.data.id}/activate`); assert.equal(on.json.data.status, 'ACTIVE'); assert.equal((await t.call(plan1, 'PATCH', `/calendars/${c.json.data.id}`, { name: 'Changed' })).status, 409, 'a calendar in force is locked');
  const days = (await t.call(se, 'GET', `/calendars/${c.json.data.id}/days?from=2026-04-10&to=2026-04-15`)).json.data.days.map((x) => `${x.date.slice(8)}${x.working ? 'W' : '-'}`);
  assert.deepEqual(days, ['10W', '11W', '12W', '13W', '14-', '15W'], 'Saturday works, the Sunday of the pour works, the holiday does not');
  assert.equal((await t.call(plan1, 'POST', '/calendars', { code: 'BAD', name: 'Bad week', workWeek: '0000000', reason: 'nothing works at all' })).status, 400);
  assert.equal((await t.call(plan1, 'POST', '/calendars', { code: 'SITE', name: 'Twice', reason: 'Same code again here' })).status, 409);
  // templates: the two standard ones, and one of the company
  const tl = (await t.call(se, 'GET', '/templates')).json.data.rows; assert.deepEqual(tl.filter((x) => x.system).map((x) => x.code).sort(), ['STD-FOUNDATION', 'STD-RCC-FLOOR']);
  const bad = await t.call(plan1, 'POST', '/templates', { code: 'T1', name: 'Broken order', target: 'WBS', steps: [{ key: 'B', name: 'Second', duration: 2, after: 'A' }, { key: 'A', name: 'First', duration: 1 }], reason: 'Steps out of order' }); assert.equal(bad.status, 400);
  const tp = await t.call(plan1, 'POST', '/templates', { code: 'SLAB', name: 'Slab cycle', target: 'LOCATION', steps: [{ key: 'FORM', name: 'Formwork', duration: 4 }, { key: 'POUR', name: 'Pour', duration: 1, after: 'FORM' }], chainStep: 'POUR', reason: 'Our own slab cycle' });
  assert.equal(tp.status, 201, JSON.stringify(tp.json)); assert.equal((await t.call(plan1, 'POST', `/templates/${tp.json.data.id}/activate`)).status, 403); assert.equal((await t.call(pcm, 'POST', `/templates/${tp.json.data.id}/activate`)).json.data.status, 'ACTIVE');
});

test('AC-01 a schedule generated from a template per floor and from the BOQ, linked (a loop refused with its path), calculated with its critical path, edited in bulk', async () => {
  const t = await boot(); const s = await sched(t);
  assert.equal((await t.call(se, 'POST', '/schedules', { projectId: t.pid, name: 'Mine', calendarId: s.calendarId, startDate: '2026-04-06' })).status, 403);
  assert.equal((await t.call(plan1, 'POST', '/schedules', { projectId: t.pid, name: 'Second', calendarId: s.calendarId, startDate: '2026-04-06' })).status, 409, 'one open version per project');
  const tpl = (await t.call(plan1, 'GET', `/options?projectId=${t.pid}`)).json.data.templates.find((x) => x.code === 'STD-RCC-FLOOR');
  const body = { mode: 'TEMPLATE', templateId: tpl.id, locationIds: [t.f1, t.f2, t.f3], wbsId: t.w2, chain: true };
  const pv = await t.call(plan1, 'POST', `/schedules/${s.id}/generate/preview`, body); assert.equal(pv.status, 200, JSON.stringify(pv.json)); assert.deepEqual([pv.json.data.create, pv.json.data.links.length], [15, 14], 'five steps per floor, four links per floor and two between floors');
  const g = await t.call(plan1, 'POST', `/schedules/${s.id}/generate`, body); assert.equal(g.status, 201, JSON.stringify(g.json)); assert.deepEqual([g.json.data.created, g.json.data.linked], [15, 14]);
  assert.deepEqual((await t.call(plan1, 'POST', `/schedules/${s.id}/generate`, body)).json.data, { created: 0, linked: 0, skipped: 15 }, 'generating again changes nothing');
  const bq = await t.call(plan1, 'POST', `/schedules/${s.id}/generate`, { mode: 'BOQ', duration: 6, chain: true, prefix: 'B' }); assert.equal(bq.status, 201, JSON.stringify(bq.json)); assert.deepEqual([bq.json.data.created, bq.json.data.linked], [2, 1], 'one activity per WBS node that carries BOQ quantities');
  const list = async (q = '') => (await t.call(plan1, 'GET', `/schedules/${s.id}/activities?pageSize=100${q}`)).json.data;
  const all = await list(); assert.equal(all.total, 17); assert.ok(all.groups.length >= 2, 'grouped by WBS node');
  const id = (code) => all.rows.find((x) => x.code === code).id;
  const b11 = all.rows.find((x) => x.code === 'B1.1'); assert.equal(b11.boqLines, 2);
  // BR-02: a loop is refused with its path
  const loop = await t.call(plan1, 'POST', `/schedules/${s.id}/dependencies`, { predId: id('F3-DESH'), succId: id('F1-SHUT') }); assert.equal(loop.status, 422); assert.match(loop.json.error.message, /F1-SHUT → .* → F1-SHUT/);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s.id}/dependencies`, { predId: id('F1-SHUT'), succId: id('F1-SHUT') })).status, 400);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s.id}/dependencies`, { predId: id('F1-SHUT'), succId: id('F1-REBAR') })).status, 409, 'linked already');
  const ln = await t.call(plan1, 'POST', `/schedules/${s.id}/dependencies`, { predId: id('B1.2'), succId: id('F1-SHUT'), type: 'FS', lag: 2 }); assert.equal(ln.status, 201, JSON.stringify(ln.json));
  // BR-01: nothing is calculated until the server runs the pass; then the dates are there
  assert.equal(all.rows[0].es, null); const c = await t.call(plan1, 'POST', `/schedules/${s.id}/calculate`); assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.data.needsCalc, false); assert.ok(c.json.data.finishDate > '2026-04-06'); assert.ok(c.json.data.critical > 0); assert.ok(c.json.data.calcMs < 3000);
  const crit = await list('&filter=critical'); assert.ok(crit.rows.every((x) => x.critical && x.totalFloat <= 0)); assert.ok(crit.rows.some((x) => x.code === 'F3-DESH'), 'the last deshuttering ends the chain');
  assert.ok(crit.rows.some((x) => x.code === 'B1.1') && crit.rows.some((x) => x.code === 'B1.2'), 'the BOQ work leads into the first floor');
  // the floor chain: the second floor's shuttering waits for the first floor's concrete
  const after1 = await list(); const r = (code) => after1.rows.find((x) => x.code === code);
  assert.ok(r('F2-SHUT').es > r('F1-CONC').ef, 'F2 shuttering follows F1 concreting'); assert.equal(r('F1-CURE').duration, 7);
  // bulk edit: curing of all floors to 10 days moves the finish
  const finish1 = c.json.data.finishDate;
  const be = await t.call(plan1, 'PATCH', `/schedules/${s.id}/activities`, { ids: ['F1-CURE', 'F2-CURE', 'F3-CURE'].map(id), set: { duration: 10 } }); assert.equal(be.status, 200, JSON.stringify(be.json)); assert.equal(be.json.data.updated, 3);
  assert.equal((await t.call(plan1, 'GET', `/schedules/${s.id}`)).json.data.needsCalc, true, 'an edit marks the schedule for a new pass');
  const c2 = (await t.call(plan1, 'POST', `/schedules/${s.id}/calculate`)).json.data; assert.ok(c2.finishDate > finish1, 'longer curing, later finish');
  assert.equal((await t.call(plan1, 'PATCH', `/schedules/${s.id}/activities`, { ids: [id('F1-CONC')], set: { type: 'MILESTONE' } })).status, 400, 'a milestone has no duration: the bulk edit is checked row by row');
  // the BOQ split: never beyond the quantity of the line
  const sp = await t.call(plan1, 'PUT', `/activities/${id('F1-CONC')}/boq`, { lines: [{ boqLineId: t.i2, qty: 50 }] }); assert.equal(sp.status, 400, 'B1.1 already carries the 120 cum of the footing concrete');
  const ok = await t.call(plan1, 'PUT', `/activities/${id('F1-SHUT')}/boq`, { lines: [{ boqLineId: t.i1, qty: 0 }] }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // activities: one by one, a constraint, a delete
  const na = await t.call(plan1, 'POST', `/schedules/${s.id}/activities`, { name: 'Handover', type: 'MILESTONE', duration: 0, constraintType: 'FNLT', constraintDate: '2026-05-01' }); assert.equal(na.status, 201, JSON.stringify(na.json)); assert.match(na.json.data.code, /^A\d+$/);
  await t.call(plan1, 'POST', `/schedules/${s.id}/dependencies`, { predId: id('F3-DESH'), succId: na.json.data.id });
  const c3 = (await t.call(plan1, 'POST', `/schedules/${s.id}/calculate`)).json.data; assert.ok(c3.negativeFloat > 0, 'the handover date cannot be met');
  const delayed = await list('&filter=delayed'); assert.ok(delayed.rows.length > 0 && delayed.rows.every((x) => x.totalFloat < 0));
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s.id}/activities`, { name: 'Bad', type: 'TASK', duration: 0 })).status, 400);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s.id}/activities`, { name: 'Bad', constraintType: 'SNET' })).status, 400, 'a constraint has a date');
  assert.equal((await t.call(plan1, 'DELETE', `/activities/${na.json.data.id}`)).status, 200);
  // the report
  const rep = (await t.call(se, 'GET', `/schedules/${s.id}/critical`)).json.data; assert.ok(rep.paths.length >= 1 && rep.paths[0].codes.length >= 5); assert.equal(rep.buckets.reduce((a, b) => a + b.count, 0), 17);
  assert.equal((await t.api.call('GET', `${P}/schedules/${s.id}/critical/export`, plan1)).status, 200); assert.equal((await t.api.call('GET', `${P}/schedules/${s.id}/critical/export`, se)).status, 403);
  assert.equal((await t.api.call('GET', `${P}/schedules/${s.id}/print`, pm)).status, 200);
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'plan.schedule.calculated'").get().n >= 3);
});

test('FR-07 progress at a data date, then approval by the project controls manager, the lock, progress on the approved schedule, the DPR, a new version', async () => {
  const t = await boot(); const s = await sched(t); const rt = runtimeOf(t.d);
  const imp = await t.call(plan1, 'POST', `/schedules/${s.id}/import`, { rows: [{ code: 'A10', name: 'Mobilise', duration: 3, wbsCode: '1' }, { code: 'A20', name: 'Excavate', duration: 5, wbsCode: '1.1', predecessors: 'A10' }, { code: 'A30', name: 'Footings', duration: 6, wbsCode: '1.1', predecessors: 'A20SS+2' }, { code: 'A40', name: 'Plinth', duration: 4, wbsCode: '1.2', predecessors: 'A30;A20' }, { code: 'A50', name: 'Bad', duration: 1, wbsCode: 'ZZ' }, { code: 'A60', name: 'Orphan link', duration: 1, predecessors: 'A99' }] });
  assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.deepEqual([imp.json.data.created, imp.json.data.linked, imp.json.data.errors.length], [5, 4, 2]);
  const ids = Object.fromEntries((await t.call(plan1, 'GET', `/schedules/${s.id}/activities`)).json.data.rows.map((x) => [x.code, x.id]));
  await t.call(plan1, 'POST', `/schedules/${s.id}/calculate`);
  // progress: A10 done, A20 started with 2 days left, data date Monday 13 April
  const pr = await t.call(plan1, 'POST', `/schedules/${s.id}/update-progress`, { dataDate: '2026-04-13', rows: [{ activityId: ids.A10, actualStart: '2026-04-06', actualFinish: '2026-04-08' }, { activityId: ids.A20, actualStart: '2026-04-09', pctComplete: 60, remainingDays: 2 }] });
  assert.equal(pr.status, 200, JSON.stringify(pr.json)); assert.equal(pr.json.data.dataDate, '2026-04-13');
  const rows = Object.fromEntries((await t.call(plan1, 'GET', `/schedules/${s.id}/activities`)).json.data.rows.map((x) => [x.code, x]));
  assert.deepEqual([rows.A10.status, rows.A10.pctComplete, rows.A10.totalFloat, rows.A20.status, rows.A20.ef, rows.A60.es], ['DONE', 100, null, 'IN_PROGRESS', '2026-04-14', '2026-04-13'], 'two days left from the data date; nothing open starts before it');
  const bad = await t.call(plan1, 'POST', `/schedules/${s.id}/update-progress`, { dataDate: '2026-04-13', rows: [{ activityId: ids.A30, actualStart: '2026-04-20' }, { activityId: ids.A40, pctComplete: 50 }] });
  assert.equal(bad.status, 400); assert.equal(bad.json.error.details.length, 2, 'an actual after the data date; progress without a start');
  assert.equal((await t.call(se, 'POST', `/schedules/${s.id}/update-progress`, { dataDate: '2026-04-13', rows: [] })).status, 403);
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'plan.progress.updated'").get().n >= 1);
  // submit; the maker cannot decide (the chain is the project controls manager); approve; the logic is locked
  const sub = await t.call(plan1, 'POST', `/schedules/${s.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, plan1)).json.data.rows.some((x) => x.instance.id === inst), false);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s.id}/activities`, { name: 'While waiting', duration: 1 })).status, 409);
  await t.act(pcm, inst); const ap = (await t.call(plan1, 'GET', `/schedules/${s.id}`)).json.data; assert.deepEqual([ap.status, ap.approvedBy], ['APPROVED', 'ppcm1']);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s.id}/dependencies`, { predId: ids.A10, succId: ids.A60 })).status, 409, 'the logic of an approved schedule is locked');
  assert.equal((await t.call(plan1, 'PATCH', `/activities/${ids.A30}`, { duration: 9 })).status, 409);
  const pr2 = await t.call(plan1, 'POST', `/schedules/${s.id}/update-progress`, { dataDate: '2026-04-15', rows: [{ activityId: ids.A20, actualFinish: '2026-04-14' }] }); assert.equal(pr2.status, 200, 'progress goes on on the approved schedule');
  assert.equal((await t.call(pm, 'GET', `/current?projectId=${t.pid}`)).json.data.activities.find((x) => x.code === 'A20').actualFinish, '2026-04-14', 'what the other modules read');
  // the DPR of 14.05 reports progress by event
  publishEvent(t.d, { type: 'site.dpr.approved', entity: 'x', entityId: 1, actorId: 'sys', companyId: 1, projectId: t.pid, data: { projectId: t.pid, date: '2026-04-16', lines: [{ activityCode: 'A30', actualStart: '2026-04-15', pctComplete: 30 }] } }); for (let i = 0; i < 4; i += 1) rt.bus.drain();
  const a30 = t.d.prepare('SELECT * FROM plan_activities WHERE id = ?').get(ids.A30); assert.deepEqual([a30.actual_start, a30.pct_complete, a30.pct_source], ['2026-04-15', 3000, 'DPR']);
  // a new version copies activities, links and progress; approved, it supersedes the first
  assert.equal((await t.call(pm, 'POST', `/schedules/${s.id}/amend`, { reason: 'Re-sequence the plinth' })).status, 403);
  const v2 = await t.call(plan1, 'POST', `/schedules/${s.id}/amend`, { reason: 'Re-sequence the plinth' }); assert.equal(v2.status, 201, JSON.stringify(v2.json)); assert.deepEqual([v2.json.data.versionNo, v2.json.data.activities, v2.json.data.status], [2, 5, 'DRAFT']);
  assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL').get(v2.json.data.id).n, 4);
  const s2 = await t.call(plan1, 'POST', `/schedules/${v2.json.data.id}/submit`); await t.act(pcm, s2.json.data.workflowInstanceId);
  assert.deepEqual([(await t.call(plan1, 'GET', `/schedules/${s.id}`)).json.data.status, (await t.call(plan1, 'GET', `/schedules/${v2.json.data.id}`)).json.data.status], ['SUPERSEDED', 'APPROVED']);
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'plan.schedule.approved'").get().n === 2);
  // return and resubmit, reject, cancel, withdraw on a third version
  const v3 = (await t.call(plan1, 'POST', `/schedules/${v2.json.data.id}/amend`, { reason: 'Another look at it' })).json.data; const s3 = await t.call(plan1, 'POST', `/schedules/${v3.id}/submit`);
  await t.act(pcm, s3.json.data.workflowInstanceId, 'return'); assert.equal((await t.call(plan1, 'GET', `/schedules/${v3.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.call(plan1, 'PATCH', `/schedules/${v3.id}`, { name: 'Corrected schedule' })).status, 200);
  await t.call(plan1, 'POST', `/schedules/${v3.id}/submit`); await t.act(pcm, s3.json.data.workflowInstanceId, 'reject');
  assert.equal((await t.call(plan1, 'GET', `/schedules/${v3.id}`)).json.data.status, 'REJECTED');
  const h = (await t.call(plan1, 'GET', `/schedules/${v3.id}/history`)).json.data; assert.ok(h.approvals.length >= 3);
});

test('T-02 a schedule of 5,000 activities calculates on the server in less than 3 s', async () => {
  const t = await boot(); const s = await sched(t); const d = t.d;
  const ins = d.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, act_type, duration_days, sort_order, project_id, created_by, source_type) VALUES (1, ?, ?, ?, 'TASK', ?, ?, ?, 't', 'test')");
  const link = d.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, 't')");
  d.exec('BEGIN'); const ids = [];
  for (let i = 0; i < 5000; i += 1) ids.push(Number(ins.run(s.id, `X${i}`, `Activity ${i}`, 1 + (i % 9), i, t.pid).lastInsertRowid));
  for (let i = 1; i < 5000; i += 1) { link.run(s.id, ids[i - 1], ids[i], 'FS', 0, t.pid); if (i > 7) link.run(s.id, ids[i - 7], ids[i], ['SS', 'FF', 'FS'][i % 3], i % 4, t.pid); if (i > 50 && i % 5 === 0) link.run(s.id, ids[i - 50], ids[i], 'SF', 3, t.pid); }
  d.exec('COMMIT'); d.prepare('UPDATE plan_schedules SET activities_count = 5000 WHERE id = ?').run(s.id);
  const started = Date.now(); const c = await t.call(plan1, 'POST', `/schedules/${s.id}/calculate`); const took = Date.now() - started;
  assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.data.activities, 5000);
  assert.ok(took < 3000, `the request took ${took} ms`); assert.ok(c.json.data.calcMs < 3000, `the pass took ${c.json.data.calcMs} ms`);
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM plan_activities WHERE schedule_id = ? AND es IS NOT NULL').get(s.id).n, 5000);
  const rep = await t.call(plan1, 'GET', `/schedules/${s.id}/critical`); assert.equal(rep.status, 200, 'the float report of a chain of thousands of critical activities (it once overflowed the stack)'); assert.ok(rep.json.data.paths.length >= 1);
});

test('AC-03 roles and isolation: the planner prepares, managers and site roles read, another project or company sees nothing, the flag', async () => {
  const t = await boot(); const s = await sched(t);
  const a = (await t.call(plan1, 'POST', `/schedules/${s.id}/activities`, { code: 'K1', name: 'Kick-off', type: 'MILESTONE', duration: 0 })).json.data;
  for (const who of [pm, se, pcm]) assert.equal((await t.call(who, 'GET', `/schedules/${s.id}/activities`)).status, 200, `${who.user} reads`);
  for (const who of [pm, se]) { assert.equal((await t.call(who, 'PATCH', `/activities/${a.id}`, { name: 'Changed' })).status, 403); assert.equal((await t.call(who, 'POST', `/schedules/${s.id}/calculate`)).status, 403); }
  assert.equal((await t.call(sys, 'GET', '/schedules')).status, 403, 'the system administrator has no business view');
  assert.equal((await t.call(other, 'GET', `/schedules/${s.id}`)).status, 404); assert.equal((await t.call(other, 'GET', `/activities/${a.id}`)).status, 404); assert.equal((await t.call(other, 'GET', '/schedules')).json.data.length, 0);
  // a planner assigned to the bridge only does not see the tower
  const uid = Number(t.d.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'pbridge', 'pbridge', '[]', 'pb@example.com')").run().lastInsertRowid);
  t.d.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PLAN'), 'PROJECT', ?, 'ACTIVE', 't')").run(uid, JSON.stringify([t.pid2]));
  const { planOf } = await import('../src/server/modules/plan/index.js'); const svc = planOf(t.d).plan; const scoped = { user: 'pbridge', userId: uid, companyId: 1, roles: [] };
  assert.throws(() => svc.schedules.get(scoped, s.id), /does not exist/); assert.equal(svc.schedules.list(scoped, {}).data.length, 0); assert.throws(() => svc.schedules.create(scoped, { projectId: t.pid, name: 'Not mine', calendarId: s.calendarId, startDate: '2026-04-06' }), /does not exist/);
  assert.deepEqual(svc.schedules.projects(scoped).map((p) => p.code), ['BRG']);
  // no path around the approval: an import or a PATCH cannot set the status
  assert.equal((await t.call(plan1, 'PATCH', `/schedules/${s.id}`, { status: 'APPROVED' })).status, 400); assert.equal(t.d.prepare('SELECT status FROM plan_schedules WHERE id = ?').get(s.id).status, 'DRAFT');
  assert.equal((await t.api.call('POST', `${P}/schedules/${s.id}/submit`, { ...plan1, headers: { 'content-type': 'application/json' } })).status, 400, 'an idempotency key is required');
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plan.p1301'").run(); assert.equal((await t.call(plan1, 'GET', '/schedules')).status, 404); t.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.plan.p1301'").run();
  // the schema keeps the rules: no negative duration, a link to itself, a constraint without a date
  assert.throws(() => t.d.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, duration_days) VALUES (1, ?, 'NEG', 'x', -1)").run(s.id), /CHECK/);
  assert.throws(() => t.d.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id) VALUES (1, ?, ?, ?)").run(s.id, a.id, a.id), /CHECK/);
  assert.throws(() => t.d.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, constraint_type) VALUES (1, ?, 'CON', 'x', 'SNET')").run(s.id), /CHECK/);
});
