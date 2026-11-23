import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fill } from './qa-helpers.js';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { detectFormat, parseFile, parseMsp, parseP6Xml, parseXer, parseXml, xerCalendarData } from '../src/server/modules/plan/exchange.js';
import { qualityOf, varianceOf } from '../src/server/modules/plan/analysis.js';

// Part 13.03: baselines, programme revisions and the exchange with MS Project and Primavera. T-01 a schedule written as MS Project XML and read back into another schedule keeps its activities, logic and
// calendars (and the same through Primavera P6 XML; an XER file is read too); T-02 the quality check flags the defects seeded in a schedule. Also: the baseline with its number and its approval by the
// project manager and then the project director (the one who prepares never approves), the frozen picture that nothing changes, one current baseline, a revision with its reason and change summary,
// the variance against the current programme, the baseline bars of the Gantt, files never read into an approved schedule, roles, isolation, 409, the idempotent replay and the flag.
const P = '/api/v1/plan'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `pb-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'bplan1'); const pm = as('PM', 'bpm1'); const pd = as('PD', 'bpd1'); const pcm = as('PCMGR', 'bpcm1'); const se = as('SE', 'bse1'); const aud = as('AUD', 'baud1'); const both = as('PLAN,PM', 'bboth1'); const other = as('PLAN', 'bplan9', '2');

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['bplan1', ['PLAN']], ['bpm1', ['PM']], ['bpd1', ['PD']], ['bpcm1', ['PCMGR']], ['bse1', ['SE']], ['baud1', ['AUD']], ['bboth1', ['PLAN', 'PM']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const project = (code, name) => {
    const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(code, name).lastInsertRowid);
    const wbs = (c, n, parent = null) => Number(d.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (1, ?, ?, ?, ?, ?, ?)').run(pid, parent, c, n, parent ? 2 : 1, 't').lastInsertRowid);
    const w1 = wbs('1', 'Substructure'); wbs('1.1', 'Footings', w1); wbs('2', 'Superstructure'); return pid;
  };
  const pid = project('BTW', 'Baseline Tower'); const pid2 = project('BT2', 'Second Tower');
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const calendar = async (body) => { const c = await call(plan1, 'POST', '/calendars', { reason: 'The calendar of the site', ...body }); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal((await call(pcm, 'POST', `/calendars/${c.json.data.id}/activate`)).status, 200); return c.json.data.id; };
  const six = await calendar({ code: 'SIX', name: 'Six-day week', workWeek: '1111110' });
  const five = await calendar({ code: 'FIVE', name: 'Five-day week', workWeek: '1111100', exceptions: [{ date: '2026-04-18', working: true, note: 'Saturday pour' }, { date: '2026-04-14', working: false, note: 'Local holiday' }] });
  const schedule = async (projectId, name = 'Working schedule', who = plan1) => { const s = await call(who, 'POST', '/schedules', { projectId, name, calendarId: six, startDate: '2026-04-06' }); assert.equal(s.status, 201, JSON.stringify(s.json)); return s.json.data.id; };
  const rows = async (sid, list, who = plan1) => { const r = await call(who, 'POST', `/schedules/${sid}/import`, { rows: list }); assert.equal(r.status, 201, JSON.stringify(r.json)); assert.deepEqual(r.json.data.errors, []); };
  const calc = async (sid, who = plan1) => { const r = await call(who, 'POST', `/schedules/${sid}/calculate`); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.data; };
  const acts = async (sid) => Object.fromEntries((await call(plan1, 'GET', `/schedules/${sid}/activities?pageSize=1000`)).json.data.rows.map((a) => [a.code, a]));
  const upload = (who, sid, buffer, fileName = 'programme.xml', format = '') => api.raw('POST', `${P}/imports?scheduleId=${sid}&fileName=${encodeURIComponent(fileName)}${format ? `&format=${format}` : ''}`, { ...who, body: buffer, headers: { 'content-type': 'application/octet-stream' } });
  const download = (who, path) => api.raw('GET', `${P}${path}`, who);
  return { api, d, call, act, hasTask, pid, pid2, six, five, schedule, rows, calc, acts, upload, download };
}
/** A10 (5 d) → A20 (3 d, not before the 13th) → A30 (2 d, starts a day after A20 starts) → A40 (4 d on the five-day calendar, finishes two days after A30) → M50, with labour and plant on A10. */
async function programme(t, sid) {
  await t.rows(sid, [
    { code: 'A10', name: 'Excavation', wbsCode: '1.1', duration: 5 }, { code: 'A20', name: 'PCC bed', wbsCode: '1.1', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Footing concrete', wbsCode: '1.1', duration: 2, predecessors: 'A20SS+1' },
    { code: 'A40', name: 'Columns & walls <level 1>', wbsCode: '2', duration: 4, predecessors: 'A30FF+2;A10' }, { code: 'M50', name: 'Structure handed over', type: 'MILESTONE', duration: 0, predecessors: 'A40' }]);
  const a = await t.acts(sid);
  assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.A40.id}`, { calendarId: t.five })).status, 200);
  assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.A20.id}`, { constraintType: 'SNET', constraintDate: '2026-04-13' })).status, 200);
  const res = await t.call(plan1, 'PUT', `/activities/${a.A10.id}/resources`, { rows: [{ type: 'LABOUR', trade: 'Mason', qty: 12.5, basis: 'TOTAL' }, { type: 'PLANT', trade: 'Excavator', qty: 40, basis: 'TOTAL' }] }); assert.equal(res.status, 200, JSON.stringify(res.json));
  return t.calc(sid);
}
/** What must survive a round trip, read from a file: the activities by code, the links by codes, the calendars by name. */
const pictureOf = (fm, codeOf) => {
  const code = new Map(fm.activities.map((a) => [a.key, codeOf(a)])); const cal = new Map(fm.calendars.map((c) => [c.key, c.name])); const wbs = new Map(fm.wbs.map((w) => [w.key, w.code]));
  return {
    activities: fm.activities.map((a) => [codeOf(a), a.name, a.type, a.durationDays, cal.get(a.calendarKey ?? fm.defaultCalendarKey), wbs.get(a.wbsKey) ?? null, a.constraintType, a.constraintDate, a.start, a.finish]).sort((x, y) => x[0].localeCompare(y[0])),
    links: fm.links.map((l) => `${code.get(l.predKey)}>${code.get(l.succKey)} ${l.type} ${l.lagDays}`).sort(),
    calendars: fm.calendars.map((c) => [c.name, c.workWeek, c.hoursPerDay, c.holidays, c.exceptions]).sort((x, y) => x[0].localeCompare(y[0])),
    assignments: fm.assignments.map((x) => `${code.get(x.activityKey)} ${fm.resources.find((r) => r.key === x.resourceKey).name} ${x.qty} ${x.unit}`).sort(),
  };
};
const XER = ['ERMHDR\t8.3\t2026-04-01\tProject\tadmin\tdbxDatabaseNoName\tProject Management\tINR',
  '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date\tclndr_id', '%R\t7\tXER-TOWER\t2026-04-06 00:00\t2026-04-06 00:00\t31',
  '%T\tCALENDAR', '%F\tclndr_id\tdefault_flag\tclndr_name\tproj_id\tday_hr_cnt\tclndr_data',
  '%R\t31\tY\tSIX Six-day week\t\t8\t(0||CalendarData()( (0||DaysOfWeek()( (0||1()()) (0||2()( (0||0(s|08:00|f|16:00)()) )) (0||3()( (0||0(s|08:00|f|16:00)()) )) (0||4()( (0||0(s|08:00|f|16:00)()) )) (0||5()( (0||0(s|08:00|f|16:00)()) )) (0||6()( (0||0(s|08:00|f|16:00)()) )) (0||7()( (0||0(s|08:00|f|16:00)()) )) )) (0||VIEW(ShowTotal|Y)()) (0||Exceptions()( (0||0(d|46126)()) (0||1(d|46131)( (0||0(s|08:00|f|16:00)()) )) )) ))',
  '%T\tPROJWBS', '%F\twbs_id\tproj_id\tparent_wbs_id\twbs_short_name\twbs_name\tproj_node_flag', '%R\t100\t7\t\tXER-TOWER\tTower\tY', '%R\t101\t7\t100\t1\tSubstructure\tN', '%R\t102\t7\t101\t1.1\tFootings\tN',
  '%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tphys_complete_pct\tact_start_date\tact_end_date\ttarget_start_date\ttarget_end_date\tcstr_type\tcstr_date',
  '%R\t501\t7\t102\t31\tX100\tSite clearance\tTT_Task\t40\t40\t0\t\t\t2026-04-06 08:00\t2026-04-10 16:00\t\t', '%R\t502\t7\t102\t31\tX110\tSetting out\tTT_Task\t20\t20\t0\t\t\t2026-04-11 08:00\t2026-04-14 16:00\tCS_MSOA\t2026-04-11 08:00',
  '%R\t503\t7\t101\t31\tX900\tReady for footings\tTT_FinMile\t0\t0\t0\t\t\t2026-04-14 16:00\t2026-04-14 16:00\tCS_MANDFIN\t2026-04-30 16:00', '%R\t504\t7\t101\t31\tX-SUM\tSubstructure summary\tTT_WBS\t0\t0\t0\t\t\t\t\t\t',
  '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_type\tlag_hr_cnt', '%R\t1\t502\t501\t7\tPR_FS\t0', '%R\t2\t503\t502\t7\tPR_FF\t8',
  '%T\tRSRC', '%F\trsrc_id\trsrc_name\trsrc_short_name\trsrc_type', '%R\t9\tSurveyor\tSURV\tRT_Labor', '%T\tTASKRSRC', '%F\ttaskrsrc_id\ttask_id\tproj_id\trsrc_id\ttarget_qty', '%R\t1\t502\t7\t9\t16', '%E', ''].join('\r\n');

test('T-01 a schedule written as MS Project XML and read into another schedule keeps its activities, logic and calendars; the same through Primavera P6 XML', async () => {
  const t = await boot(); const s1 = await t.schedule(t.pid); const c1 = await programme(t, s1); assert.equal(c1.finishDate, '2026-04-17', 'A40 works Monday to Friday, not on the holiday of the 14th');
  // FR-05: the working schedule as an MS Project file
  const x1 = await t.download(plan1, `/schedules/${s1}/exchange?format=msp`); assert.equal(x1.status, 200); assert.match(x1.headers.get('content-type'), /application\/xml/); assert.match(x1.headers.get('content-disposition'), /-msp\.xml"/);
  const text1 = x1.buffer.toString('utf8'); assert.equal(detectFormat(text1), 'MSP_XML'); assert.match(text1, /Columns &amp; walls &lt;level 1&gt;/, 'names are escaped'); const m1 = parseMsp(text1);
  assert.equal(m1.activities.length, 5); assert.equal(m1.links.length, 5); assert.equal(m1.calendars.length, 2); assert.equal(m1.codeField, 'TEXT1'); assert.deepEqual(m1.wbs.map((w) => w.code), ['1', '1.1', '2']);
  // FR-04 step 1: the file is read and checked for the blank schedule of another project; nothing of that schedule changes yet
  const s2 = await t.schedule(t.pid2, 'Second tower from the file'); const up = await t.upload(plan1, s2, x1.buffer, 'tower.xml'); assert.equal(up.status, 201, up.buffer.toString()); const imp = up.json.data;
  assert.deepEqual([imp.status, imp.format, imp.errors, imp.activities, imp.links, imp.mode], ['ANALYSED', 'MSP_XML', 0, 5, 5, 'REPLACE']); assert.equal(imp.mapping.codeFrom, 'TEXT1'); assert.equal(imp.can.apply, true);
  assert.deepEqual(Object.values(imp.mapping.calendars).sort(), [t.six, t.five].sort(), 'the calendars are matched by their code and name'); assert.equal(Object.values(imp.mapping.wbs).filter(Boolean).length, 3, 'the WBS nodes are matched by their code');
  assert.deepEqual(imp.result.report.errors, []); assert.equal(imp.result.report.warnings.some((w) => w.code === 'CALENDAR_DIFFERS'), false); assert.equal(imp.options.fileCalendars.length, 2); assert.equal((await t.acts(s2)).A10, undefined);
  // step 3: applied in one transaction, the schedule calculated; the dates worked out here are the dates of the file
  const ap = await t.call(plan1, 'POST', `/imports/${imp.id}/apply`, { rowVersion: imp.rowVersion }); assert.equal(ap.status, 200, JSON.stringify(ap.json)); const done = ap.json.data;
  assert.equal(done.status, 'IMPORTED'); assert.deepEqual([done.result.applied.created, done.result.applied.updated, done.result.applied.links, done.result.applied.resources, done.result.applied.datesDiffer], [5, 0, 5, 2, 0]); assert.equal(done.result.applied.finish, '2026-04-17');
  assert.equal((await t.call(plan1, 'POST', `/imports/${imp.id}/apply`, {})).status, 409, 'a file is applied once');
  // the round trip: the second schedule written again is the first one
  const x2 = await t.download(plan1, `/schedules/${s2}/exchange?format=msp`); const m2 = parseMsp(x2.buffer.toString('utf8')); const p1 = pictureOf(m1, (a) => a.text1); const p2 = pictureOf(m2, (a) => a.text1);
  assert.deepEqual(p2.activities, p1.activities, 'activities: code, name, type, duration, calendar, WBS node, constraint and dates'); assert.deepEqual(p2.links, p1.links, 'logic: every link with its type and lag'); assert.deepEqual(p2.calendars, p1.calendars, 'calendars: week, hours, holidays and worked exceptions');
  assert.deepEqual(p2.assignments, p1.assignments, 'resources'); assert.deepEqual(p1.links, ['A10>A20 FS 0', 'A10>A40 FS 0', 'A20>A30 SS 1', 'A30>A40 FF 2', 'A40>M50 FS 0']);
  assert.deepEqual(p1.calendars.find((c) => c[0] === 'FIVE Five-day week'), ['FIVE Five-day week', '1111100', 8, ['2026-04-14'], ['2026-04-18']]); assert.deepEqual(p1.assignments, ['A10 Excavator 40 hour', 'A10 Mason 100 hour']);
  const b2 = await t.acts(s2); assert.deepEqual([b2.A40.calendar, b2.A20.constraintType, b2.A20.constraintDate, b2.M50.type, b2.A40.ef], ['FIVE', 'SNET', '2026-04-13', 'MILESTONE', '2026-04-17']);
  const r2 = (await t.call(plan1, 'GET', `/activities/${b2.A10.id}/resources`)).json.data.rows; assert.deepEqual(r2.map((r) => [r.type, r.label, r.qtyTotal, r.uom]), [['LABOUR', 'Mason', 12.5, 'man-day'], ['PLANT', 'Excavator', 40, 'hour']]);
  // the same through Primavera P6 XML, replacing what the schedule holds
  const y1 = await t.download(plan1, `/schedules/${s1}/exchange?format=p6`); assert.equal(y1.status, 200); const q1 = parseP6Xml(y1.buffer.toString('utf8')); assert.equal(detectFormat(y1.buffer.toString('utf8')), 'P6_XML');
  const up2 = await t.upload(plan1, s2, y1.buffer, 'tower-p6.xml'); assert.equal(up2.status, 201, up2.buffer.toString()); assert.equal(up2.json.data.mode, 'MERGE', 'a schedule that has activities is merged by default'); assert.equal(up2.json.data.result.report.summary.toUpdate, 5);
  const ch = await t.call(plan1, 'PATCH', `/imports/${up2.json.data.id}`, { mapping: { mode: 'REPLACE' }, rowVersion: up2.json.data.rowVersion }); assert.equal(ch.status, 200, JSON.stringify(ch.json)); assert.equal(ch.json.data.result.report.warnings.some((w) => w.code === 'REPLACE_REMOVES'), true);
  assert.equal((await t.call(plan1, 'PATCH', `/imports/${up2.json.data.id}`, { mapping: { mode: 'MERGE' }, rowVersion: up2.json.data.rowVersion })).status, 409, 'a stale row version is refused');
  const ap2 = await t.call(plan1, 'POST', `/imports/${up2.json.data.id}/apply`, {}); assert.equal(ap2.status, 200, JSON.stringify(ap2.json)); assert.deepEqual([ap2.json.data.result.applied.removed, ap2.json.data.result.applied.created, ap2.json.data.result.applied.datesDiffer], [5, 5, 0]);
  const q2 = parseP6Xml((await t.download(plan1, `/schedules/${s2}/exchange?format=p6`)).buffer.toString('utf8')); assert.deepEqual(pictureOf(q2, (a) => a.code), pictureOf(q1, (a) => a.code), 'the P6 round trip keeps activities, logic, calendars and resources');
  // an XER file is read, checked and reported: a hard constraint is carried as the nearest one, a WBS summary is left out
  const up3 = await t.upload(plan1, s2, Buffer.from(XER, 'latin1'), 'tower.xer'); assert.equal(up3.status, 201, up3.buffer.toString()); const xr = up3.json.data;
  assert.deepEqual([xr.format, xr.activities, xr.links, xr.errors], ['P6_XER', 3, 2, 0]); assert.ok(xr.result.report.warnings.some((w) => w.code === 'CONSTRAINT_CHANGED' && /mandatory finish/.test(w.message))); assert.ok(xr.result.report.warnings.some((w) => w.code === 'SUMMARY_ACTIVITY'));
  assert.equal(xr.mapping.calendars['31'], t.six); assert.equal((await t.call(plan1, 'POST', `/imports/${xr.id}/discard`, {})).json.data.status, 'DISCARDED');
  // what is refused: a file with a document type, a file that is no schedule, a file of another kind than said, an empty one
  for (const [body, why] of [['<?xml version="1.0"?><!DOCTYPE Project [<!ENTITY a "aaaa">]><Project xmlns="http://schemas.microsoft.com/project"><Name>&a;</Name></Project>', /document type/], ['just some text', /not MS Project XML/], ['', /empty/]]) {
    const r = await t.upload(plan1, s2, Buffer.from(body), 'bad.xml'); assert.equal(r.status, 400, r.buffer.toString()); assert.match(r.json.error.details[0].message, why);
  }
  assert.equal((await t.upload(plan1, s2, x1.buffer, 'tower.xml', 'P6_XER')).status, 400, 'the kind said is checked against the file');
  // BR-02: a file is read into the working schedule only
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s2}/submit`)).status, 202); const locked = await t.upload(plan1, s2, x1.buffer, 'tower.xml'); assert.equal(locked.status, 409); assert.match(locked.json.error.message, /working schedule only/);
  // roles and isolation of the import
  assert.equal((await t.upload(se, s1, x1.buffer)).status, 403); assert.equal((await t.upload(other, s1, x1.buffer)).status, 404); assert.equal((await t.call(se, 'GET', `/imports?scheduleId=${s1}`)).status, 403); assert.equal((await t.call(plan1, 'GET', `/imports?scheduleId=${s2}`)).json.data.rows.length, 3);
  assert.equal((await t.download(se, `/schedules/${s1}/exchange`)).status, 403, 'a site engineer does not export'); assert.equal((await t.download(other, `/schedules/${s1}/exchange`)).status, 404);
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'plan_schedules' AND action = 'import' AND entity_id = ?").get(String(s2)).n >= 2); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'plan.schedule.imported'").get().n, 2);
});

test('FR-04 the readers on their own: a real-world MS Project file, the XER calendar text, the limits of the XML reader', () => {
  // a file as MS Project writes it: no activity code field, summary tasks, a hard constraint, an elapsed duration, a lag in hours, an inactive task and a cost resource
  const msp = `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>plant.mpp</Name><Title>Plant shutdown</Title><StartDate>2026-06-01T08:00:00</StartDate><StatusDate>2026-06-03T17:00:00</StatusDate><CalendarUID>1</CalendarUID><MinutesPerDay>480</MinutesPerDay>
  <Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays><WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay><WeekDay><DayType>2</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>3</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>4</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>5</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>6</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay></WeekDays>
  <Exceptions><Exception><TimePeriod><FromDate>2026-06-10T00:00:00</FromDate><ToDate>2026-06-11T23:59:00</ToDate></TimePeriod><DayWorking>0</DayWorking></Exception></Exceptions></Calendar><Calendar><UID>3</UID><Name>Ravi</Name><IsBaseCalendar>0</IsBaseCalendar><BaseCalendarUID>1</BaseCalendarUID></Calendar></Calendars>
  <Tasks><Task><UID>0</UID><ID>0</ID><Name>Plant shutdown</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
  <Task><UID>1</UID><ID>1</ID><Name>Preparation</Name><WBS>1</WBS><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
  <Task><UID>2</UID><ID>2</ID><Name>Isolate &amp; drain</Name><WBS>1.1</WBS><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Duration>PT16H0M0S</Duration><DurationFormat>7</DurationFormat><Start>2026-06-01T08:00:00</Start><Finish>2026-06-02T17:00:00</Finish><ConstraintType>2</ConstraintType><ConstraintDate>2026-06-01T08:00:00</ConstraintDate><PercentComplete>100</PercentComplete><ActualStart>2026-06-01T08:00:00</ActualStart><ActualFinish>2026-06-02T17:00:00</ActualFinish></Task>
  <Task><UID>3</UID><ID>3</ID><Name>Cool down</Name><WBS>1.2</WBS><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Duration>PT48H0M0S</Duration><DurationFormat>8</DurationFormat><PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>2400</LinkLag><LagFormat>5</LagFormat></PredecessorLink><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>3</Type></PredecessorLink></Task>
  <Task><UID>4</UID><ID>4</ID><Name>Old step</Name><WBS>1.3</WBS><OutlineLevel>2</OutlineLevel><Active>0</Active><Duration>PT8H0M0S</Duration></Task>
  <Task><UID>5</UID><ID>5</ID><Name>Restart</Name><WBS>2</WBS><OutlineLevel>1</OutlineLevel><Milestone>1</Milestone><Duration>PT0H0M0S</Duration><ConstraintType>5</ConstraintType><ConstraintDate>2026-06-20T17:00:00</ConstraintDate><PredecessorLink><PredecessorUID>3</PredecessorUID><Type>0</Type><LinkLag>4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task></Tasks>
  <Resources><Resource><UID>0</UID></Resource><Resource><UID>1</UID><Name>Fitter</Name><Type>1</Type></Resource><Resource><UID>2</UID><Name>Gasket</Name><Type>0</Type><MaterialLabel>nos</MaterialLabel></Resource><Resource><UID>3</UID><Name>Permit fee</Name><Type>2</Type></Resource></Resources>
  <Assignments><Assignment><UID>1</UID><TaskUID>2</TaskUID><ResourceUID>1</ResourceUID><Work>PT32H0M0S</Work></Assignment><Assignment><UID>2</UID><TaskUID>3</TaskUID><ResourceUID>2</ResourceUID><Units>6</Units></Assignment><Assignment><UID>3</UID><TaskUID>3</TaskUID><ResourceUID>-65535</ResourceUID><Work>PT8H0M0S</Work></Assignment></Assignments></Project>`;
  const fm = parseFile(Buffer.from(msp)); assert.equal(fm.format, 'MSP_XML'); assert.deepEqual([fm.name, fm.start, fm.dataDate, fm.codeField], ['Plant shutdown', '2026-06-01', '2026-06-03', null]);
  assert.deepEqual(fm.calendars.map((c) => [c.name, c.workWeek, c.holidays]), [['Standard', '1111100', ['2026-06-10', '2026-06-11']]], 'the calendar of a resource is not a calendar of the programme');
  assert.deepEqual(fm.wbs.map((w) => [w.code, w.name]), [['1', 'Preparation']]); assert.deepEqual(fm.activities.map((a) => [a.id, a.name, a.type, a.durationDays, a.wbsCode, a.wbsKey, a.constraintType, a.constraintDate, a.pct]), [
    ['2', 'Isolate & drain', 'TASK', 2, '1.1', 'w1', 'SNET', '2026-06-01', 100], ['3', 'Cool down', 'TASK', 2, '1.2', 'w1', 'NONE', null, 0], ['5', 'Restart', 'MILESTONE', 0, '2', null, 'NONE', null, 0]]);
  assert.deepEqual(fm.links, [{ predKey: '2', succKey: '3', type: 'FS', lagDays: 0.5 }, { predKey: '1', succKey: '3', type: 'SS', lagDays: 0 }, { predKey: '3', succKey: '5', type: 'FF', lagDays: 1 }]); assert.deepEqual(fm.summaryKeys, ['1']);
  const codes = fm.notes.map((n) => n.code); for (const c of ['INACTIVE', 'ELAPSED_DURATION', 'CONSTRAINT_CHANGED', 'CONSTRAINT_DROPPED', 'RESOURCE_COST']) assert.ok(codes.includes(c), `${c} is noted`);
  assert.deepEqual(fm.resources.map((r) => [r.name, r.type, r.uom]), [['Fitter', 'LABOUR', null], ['Gasket', 'MATERIAL', 'nos']]); assert.deepEqual(fm.assignments, [{ activityKey: '2', resourceKey: '1', qty: 32, unit: 'hour' }, { activityKey: '3', resourceKey: '2', qty: 6, unit: 'unit' }]);
  // the XER reader and its calendar text (day 1 is Sunday; an exception with hours is a worked day)
  const cal = xerCalendarData('(0||CalendarData()( (0||DaysOfWeek()( (0||1()()) (0||2()( (0||0(s|08:00|f|17:00)()) )) (0||3()( (0||0(s|08:00|f|17:00)()) )) (0||4()()) (0||5()()) (0||6()()) (0||7()()) )) (0||Exceptions()( (0||0(d|46126)()) (0||1(d|46131)( (0||0(s|08:00|f|12:00)()) )) )) ))');
  assert.deepEqual(cal, { workWeek: '1100000', holidays: ['2026-04-14'], exceptions: ['2026-04-19'] });
  const x = parseXer(XER); assert.deepEqual(x.activities.map((a) => [a.code, a.type, a.durationDays, a.constraintType, a.constraintDate]), [['X100', 'TASK', 5, 'NONE', null], ['X110', 'TASK', 2.5, 'SNET', '2026-04-11'], ['X900', 'MILESTONE', 0, 'FNLT', '2026-04-30']]);
  assert.deepEqual(x.links, [{ predKey: '501', succKey: '502', type: 'FS', lagDays: 0 }, { predKey: '502', succKey: '503', type: 'FF', lagDays: 1 }]); assert.deepEqual(x.wbs.map((w) => [w.code, w.parentKey]), [['1', null], ['1.1', '101']]); assert.deepEqual(x.assignments, [{ activityKey: '502', resourceKey: '9', qty: 16, unit: 'hour' }]);
  assert.deepEqual([x.calendars[0].workWeek, x.calendars[0].holidays, x.calendars[0].exceptions], ['1111110', ['2026-04-14'], ['2026-04-19']]);
  // the XML reader: entities it knows, no document type, no entity declaration, well-formed only, not too deep
  assert.equal(parseXml('<a><b>1 &lt; 2 &amp; &#65;&#x42;</b><c/><![CDATA[x]]></a>').children[0].children[0].text, '1 < 2 & AB');
  for (const bad of ['<!DOCTYPE a><a/>', '<a><!ENTITY x "y"></a>', '<a><b></a>', '<a>', `${'<a>'.repeat(70)}${'</a>'.repeat(70)}`]) assert.throws(() => parseXml(bad), { code: 'EXCHANGE_FILE' });
  assert.throws(() => parseFile(Buffer.from('<Project xmlns="http://schemas.microsoft.com/project"></Project>'), 'P6_XML'), /MS Project XML, not Primavera P6 XML/);
});

test('T-02 the quality check flags the defects seeded in a schedule, each with what it found; the limits are parameters; a clean programme passes', async () => {
  const t = await boot(); const sid = await t.schedule(t.pid);
  // the sound core A10 → A20 → A30 → A90, and around it one defect for each check
  await t.rows(sid, [
    { code: 'A10', name: 'Mobilise', duration: 5 }, { code: 'A20', name: 'Excavate', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Concrete', duration: 2, predecessors: 'A20' },
    { code: 'X10', name: 'Left alone (no logic at all)', duration: 4 },
    { code: 'L10', name: 'Starts on a lead', duration: 3, predecessors: 'A20FS-2' }, { code: 'G10', name: 'Waits on a lag', duration: 2, predecessors: 'A10FS+5' },
    { code: 'S10', name: 'Start to start', duration: 2, predecessors: 'A10SS' }, { code: 'S20', name: 'Finish to finish', duration: 2, predecessors: 'A20FF' },
    { code: 'H10', name: 'Held by a hard date', duration: 3, predecessors: 'A30' }, { code: 'D10', name: 'Much too long', duration: 60, predecessors: 'A10' },
    { code: 'A90', name: 'Finish', type: 'MILESTONE', duration: 0, predecessors: 'A30;L10;G10;S10;S20;H10;D10' }]);
  const a = await t.acts(sid); assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.H10.id}`, { constraintType: 'FNLT', constraintDate: '2026-04-10' })).status, 200);
  assert.equal((await t.call(plan1, 'PUT', `/activities/${a.A10.id}/resources`, { rows: [{ type: 'LABOUR', trade: 'Helper', qty: 10, basis: 'TOTAL' }] })).status, 200);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${sid}/update-progress`, { dataDate: '2026-04-08', rows: [{ activityId: a.A10.id, actualStart: '2026-04-06', pctComplete: 40 }] })).status, 200);
  t.d.prepare("UPDATE plan_activities SET actual_start = '2026-05-02' WHERE id = ?").run(a.X10.id); // a date entered after the data date: what the check is for
  const q = await t.call(plan1, 'GET', `/schedules/${sid}/quality`); assert.equal(q.status, 200, JSON.stringify(q.json)); const r = q.json.data; const c = Object.fromEntries(r.checks.map((x) => [x.code, x]));
  assert.equal(r.checks.length, 14); assert.deepEqual([r.summary.activities, r.summary.links, r.summary.dataDate, r.params.highFloat], [11, 15, '2026-04-08', 44]);
  assert.deepEqual([c.LOGIC.status, c.LOGIC.count, c.LOGIC.sample[0].code, c.LOGIC.sample[0].detail], ['FAIL', 1, 'X10', 'no predecessor, no successor'], 'the start and the finish of the programme are not counted');
  assert.deepEqual([c.LEADS.status, c.LEADS.count, c.LEADS.sample[0].code, c.LEADS.sample[0].name], ['FAIL', 1, 'A20 → L10', 'FS-2']);
  assert.deepEqual([c.LAGS.status, c.LAGS.count, c.LAGS.sample[0].code], ['FAIL', 1, 'A10 → G10']); assert.deepEqual([c.RELATIONSHIPS.status, c.RELATIONSHIPS.count, c.RELATIONSHIPS.total], ['FAIL', 2, 15]);
  assert.deepEqual([c.HARD_CONSTRAINTS.status, c.HARD_CONSTRAINTS.count, c.HARD_CONSTRAINTS.sample[0].code], ['FAIL', 1, 'H10']); assert.deepEqual([c.NEGATIVE_FLOAT.status, c.NEGATIVE_FLOAT.sample.some((x) => x.code === 'H10')], ['FAIL', true]);
  assert.deepEqual([c.HIGH_DURATION.status, c.HIGH_DURATION.count, c.HIGH_DURATION.sample[0].code], ['FAIL', 1, 'D10']); assert.equal(c.HIGH_FLOAT.status, 'FAIL'); assert.ok(c.HIGH_FLOAT.sample.some((x) => x.code === 'X10' || x.code === 'A30'));
  assert.equal(c.INVALID_DATES.status, 'FAIL'); assert.ok(c.INVALID_DATES.sample.some((x) => x.code === 'X10' && /after the data date/.test(x.detail)));
  assert.deepEqual([c.RESOURCES.status, c.RESOURCES.count, c.RESOURCES.total], ['FAIL', 9, 10], 'every activity with a duration but the one loaded'); assert.deepEqual([c.MISSED.status, c.BEI.status, c.MISSED.valueLabel], ['NA', 'NA', 'no current baseline']);
  assert.ok(['PASS', 'FAIL'].includes(c.CRITICAL_PATH.status)); assert.equal(typeof c.CPLI.value, 'number'); assert.ok(r.summary.failed >= 10); assert.equal(r.summary.passed + r.summary.failed + r.summary.notApplicable, 14);
  // the drill-down of one check, the limits as parameters, the export with its totals
  const dr = (await t.call(plan1, 'GET', `/schedules/${sid}/quality?check=RESOURCES&pageSize=25`)).json.data.drill; assert.deepEqual([dr.total, dr.rows.length, dr.rows.every((x) => x.activityId > 0)], [9, 9, true]);
  const lim = Object.fromEntries((await t.call(plan1, 'GET', `/schedules/${sid}/quality?longDuration=100&highFloat=500&tolerance=10`)).json.data.checks.map((x) => [x.code, x.status])); assert.deepEqual([lim.HIGH_DURATION, lim.HIGH_FLOAT, lim.LOGIC, lim.LEADS], ['PASS', 'PASS', 'PASS', 'FAIL']);
  assert.equal((await t.call(plan1, 'GET', `/schedules/${sid}/quality?check=NOPE`)).status, 400); assert.equal((await t.call(plan1, 'GET', `/schedules/${sid}/quality?highFloat=0`)).status, 400);
  for (const f of ['xlsx', 'pdf', 'csv']) { const x = await t.download(plan1, `/schedules/${sid}/quality/export?format=${f}`); assert.equal(x.status, 200, f); assert.equal(x.headers.get('x-export-rows'), '14'); if (f === 'csv') { const s = x.buffer.toString('utf8'); assert.match(s, /Leads,Links with a negative lag,1 of 15/); assert.match(s, /Total,"11 activities, 15 links"/); assert.match(s, /A20 → L10/); } }
  assert.equal((await t.download(se, `/schedules/${sid}/quality/export`)).status, 403); assert.equal((await t.call(se, 'GET', `/schedules/${sid}/quality`)).status, 200, 'who sees the schedule sees its check'); assert.equal((await t.call(other, 'GET', `/schedules/${sid}/quality`)).status, 404);
  // a clean programme: a finish-to-start chain, loaded, calculated: nothing fails
  const s2 = await t.schedule(t.pid2); await t.rows(s2, [{ code: 'B10', name: 'First', duration: 5 }, { code: 'B20', name: 'Second', duration: 4, predecessors: 'B10' }, { code: 'B30', name: 'Third', duration: 3, predecessors: 'B20' }, { code: 'B90', name: 'Done', type: 'MILESTONE', duration: 0, predecessors: 'B30' }]);
  const b = await t.acts(s2); for (const k of ['B10', 'B20', 'B30']) assert.equal((await t.call(plan1, 'PUT', `/activities/${b[k].id}/resources`, { rows: [{ type: 'LABOUR', trade: 'Crew', qty: 4, basis: 'PER_DAY' }] })).status, 200); await t.calc(s2);
  const clean = (await t.call(plan1, 'GET', `/schedules/${s2}/quality`)).json.data; assert.deepEqual(clean.checks.filter((x) => x.status === 'FAIL').map((x) => x.code), []); assert.deepEqual([clean.summary.failed, clean.summary.score], [0, 100]);
  const cc = Object.fromEntries(clean.checks.map((x) => [x.code, x])); assert.deepEqual([cc.CRITICAL_PATH.status, cc.CPLI.status, cc.CPLI.value, cc.RESOURCES.status, cc.INVALID_DATES.status], ['PASS', 'PASS', 1, 'PASS', 'NA']);
  // the checks on their own: a broken critical path, a schedule that is not calculated
  const model = { schedule: { start: '2026-04-06', finish: '2026-04-20', dataDate: null, calendarKey: '1' }, calendars: [{ key: '1', workWeek: '1111110', holidays: [], exceptions: [] }], wbs: [], resources: [], links: [{ pred: '1', succ: '2', type: 'FS', lag: 0 }],
    activities: [{ key: '1', code: 'P', name: 'P', type: 'TASK', duration: 5, start: '2026-04-06', finish: '2026-04-10', totalFloat: 6, critical: false, constraintType: 'NONE' }, { key: '2', code: 'Q', name: 'Q', type: 'TASK', duration: 3, start: '2026-04-17', finish: '2026-04-20', totalFloat: 0, critical: true, constraintType: 'NONE' }] };
  const br = Object.fromEntries(qualityOf(model).checks.map((x) => [x.code, x])); assert.deepEqual([br.CRITICAL_PATH.status, br.CRITICAL_PATH.items[0].code], ['FAIL', 'Q']);
  const raw = Object.fromEntries(qualityOf({ ...model, activities: model.activities.map((x) => ({ ...x, start: null, finish: null, totalFloat: null })) }).checks.map((x) => [x.code, x.status])); assert.deepEqual([raw.CRITICAL_PATH, raw.CPLI, raw.HIGH_FLOAT, raw.NEGATIVE_FLOAT], ['NA', 'NA', 'NA', 'NA']);
});

test('FR-01 FR-02 BR-01 a baseline is prepared, approved by the project manager and then the project director, and frozen; a revision replaces it as the current one only when approved', async () => {
  const t = await boot(); const sid = await t.schedule(t.pid); const c0 = await programme(t, sid); const B = (id, tail = '') => `/baselines/${id}${tail}`;
  // validation, rights and scope of the draft
  const body = { scheduleId: sid, name: 'Contract programme', revisionType: 'ORIGINAL', reason: 'The programme agreed with the client at award' };
  assert.equal((await t.call(plan1, 'POST', '/baselines', { ...body, name: 'x' })).status, 400); const wrongKind = await t.call(plan1, 'POST', '/baselines', { ...body, revisionType: 'EOT' }); assert.equal(wrongKind.status, 400); assert.equal(wrongKind.json.error.details[0].field, 'revisionType');
  for (const who of [se, pm, pd, aud]) assert.equal((await t.call(who, 'POST', '/baselines', body)).status, 403, `${who.roles} does not prepare a baseline`); assert.equal((await t.call(other, 'POST', '/baselines', body)).status, 404);
  assert.equal((await api0(t, 'POST', '/baselines', plan1, body)).status, 400, 'a create without an Idempotency-Key is refused');
  const k = key(); const made = await t.call(plan1, 'POST', '/baselines', body, k); assert.equal(made.status, 201, JSON.stringify(made.json)); const b0 = made.json.data;
  const again = await t.call(plan1, 'POST', '/baselines', body, k); assert.deepEqual([again.status, again.json.data.id], [201, b0.id], 'the same key gives the same baseline, not a second one'); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM plan_baselines').get().n, 1);
  assert.deepEqual([b0.status, b0.baselineNo, b0.revisionType, b0.current, b0.activities, b0.links, b0.finishDate, b0.scheduleId], ['DRAFT', 0, 'ORIGINAL', false, 5, 5, c0.finishDate, sid]); assert.match(b0.docNo, /^BL\//); assert.equal(b0.snapshotHash.length, 64);
  assert.equal((await t.call(plan1, 'POST', '/baselines', { ...body, name: 'A second draft' })).status, 409, 'one open baseline for a project');
  // the draft is corrected under its row version; a stale version is refused
  const up = await t.call(plan1, 'PATCH', B(b0.id), { name: 'Contract programme (rev 0)', referenceNo: 'LOA/2026/014', rowVersion: b0.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.referenceNo, 'LOA/2026/014');
  assert.equal((await t.call(plan1, 'PATCH', B(b0.id), { name: 'Stale edit', rowVersion: b0.rowVersion })).status, 409); assert.equal((await t.call(se, 'PATCH', B(b0.id), { name: 'Not mine', rowVersion: up.json.data.rowVersion })).status, 403);
  // the picture is taken again when it is sent: what is approved is what was sent
  const acts = await t.acts(sid); assert.equal((await t.call(plan1, 'PATCH', `/activities/${acts.A10.id}`, { duration: 8 })).status, 200);
  const stale = await t.call(plan1, 'POST', B(b0.id, '/submit')); assert.equal(stale.status, 422); assert.match(stale.json.error.message, /calculate it first/); const cA = await t.calc(sid); assert.ok(cA.finishDate > c0.finishDate);
  assert.equal((await api0(t, 'POST', B(b0.id, '/submit'), plan1)).status, 400, 'a submit without an Idempotency-Key is refused');
  const sub = await t.call(plan1, 'POST', B(b0.id, '/submit')); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId; assert.deepEqual([sub.json.data.status, sub.json.data.finishDate], ['SUBMITTED', cA.finishDate]); assert.notEqual(sub.json.data.snapshotHash, b0.snapshotHash);
  assert.equal((await t.call(plan1, 'PATCH', B(b0.id), { name: 'While it waits', rowVersion: sub.json.data.rowVersion })).status, 409);
  // the chain: the project manager first, then the project director; the planner holds no task
  assert.equal(await t.hasTask(plan1, inst), false); assert.equal(await t.hasTask(pd, inst), false, 'the director waits for the manager'); await t.act(pm, inst);
  assert.equal((await t.call(plan1, 'GET', B(b0.id))).json.data.status, 'SUBMITTED', 'one approval of two is not an approval'); assert.equal(await t.hasTask(pm, inst), false); await t.act(pd, inst);
  const ap = (await t.call(plan1, 'GET', B(b0.id))).json.data; assert.deepEqual([ap.status, ap.current, ap.approvedBy, ap.can.edit, ap.can.cancel, ap.can.delete, ap.can.amend], ['APPROVED', true, 'bpd1', false, false, false, true]);
  const ev = JSON.parse(t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'plan.baseline.approved'").get().payload); assert.deepEqual([ev.data.baselineId, ev.data.baselineNo, ev.data.revisionType, ev.data.previousBaselineId, ev.data.finish, ev.data.activities], [b0.id, 0, 'ORIGINAL', null, cA.finishDate, 5]);
  // BR-01: approved, it is never changed: not by the API, not by any statement on the table
  assert.equal((await t.call(plan1, 'PATCH', B(b0.id), { name: 'After approval', rowVersion: ap.rowVersion })).status, 409); assert.equal((await t.call(plan1, 'DELETE', B(b0.id))).status, 422); assert.equal((await t.call(pd, 'POST', B(b0.id, '/cancel'), { reason: 'No longer wanted' })).status, 422);
  for (const sql of ["UPDATE plan_baselines SET snapshot_json = '{}' WHERE id = ?", "UPDATE plan_baselines SET finish_date = '2027-01-01' WHERE id = ?", "UPDATE plan_baselines SET status = 'DRAFT' WHERE id = ?", "UPDATE plan_baselines SET deleted_at = 'x' WHERE id = ?", 'DELETE FROM plan_baselines WHERE id = ?']) assert.throws(() => t.d.prepare(sql).run(b0.id), /approved baseline cannot be/, sql);
  const frozen = t.d.prepare('SELECT snapshot_hash, snapshot_json FROM plan_baselines WHERE id = ?').get(b0.id);
  // what the other modules read, the print, the file of the baseline
  const cur = (await t.call(se, 'GET', `/baselines/current?projectId=${t.pid}`)).json.data; assert.deepEqual([cur.baseline.id, cur.activities.length, cur.activities.find((x) => x.code === 'A10').duration], [b0.id, 5, 8]);
  const pr = await t.download(pm, B(b0.id, '/print')); assert.equal(pr.status, 200); assert.match(pr.buffer.toString(), /CURRENT BASELINE/); assert.doesNotMatch(pr.buffer.toString(), /NOT AN APPROVED BASELINE/); assert.equal((await t.download(se, B(b0.id, '/print'))).status, 403);
  const bf = await t.download(pm, B(b0.id, '/exchange?format=p6')); assert.equal(bf.status, 200); assert.equal(parseP6Xml(bf.buffer.toString('utf8')).activities.find((x) => x.code === 'A10').durationDays, 8);
  // the working schedule moves on: A20 takes four days more and A40 is dropped for a new activity; the baseline does not move
  const a2 = await t.acts(sid); assert.equal((await t.call(plan1, 'PATCH', `/activities/${a2.A20.id}`, { duration: 7 })).status, 200); assert.equal((await t.call(plan1, 'DELETE', `/activities/${a2.A40.id}`)).status, 200);
  await t.rows(sid, [{ code: 'A45', name: 'Columns in two pours', wbsCode: '2', duration: 6, predecessors: 'A30' }]); const a3 = await t.acts(sid); assert.equal((await t.call(plan1, 'POST', `/schedules/${sid}/dependencies`, { predId: a3.A45.id, succId: a3.M50.id })).status, 201); const c2 = await t.calc(sid);
  assert.deepEqual(t.d.prepare('SELECT snapshot_hash, snapshot_json FROM plan_baselines WHERE id = ?').get(b0.id), frozen);
  // FR-03: the variance of the current programme against the baseline
  const v = await t.call(se, 'GET', B(b0.id, '/variance')); assert.equal(v.status, 200, JSON.stringify(v.json)); const vr = v.json.data; const by = Object.fromEntries(vr.rows.map((x) => [x.code, x]));
  assert.deepEqual([vr.against.kind, vr.against.id, vr.summary.baselineFinish, vr.summary.currentFinish], ['schedule', sid, cA.finishDate, c2.finishDate]); assert.ok(vr.summary.finishVar > 0);
  assert.deepEqual([by.A20.status, by.A20.durationVar, by.A20.bDuration, by.A20.cDuration, by.A20.startVar], ['CHANGED', 4, 3, 7, 0]); assert.ok(by.A20.finishVar >= 4); assert.deepEqual([by.A10.status, by.A10.finishVar], ['SAME', 0]);
  assert.deepEqual([by.A40.status, by.A40.cFinish, by.A45.status, by.A45.bFinish], ['REMOVED', null, 'ADDED', null]); assert.deepEqual([by.M50.milestone, by.M50.slipped, by.M50.criticalSlip], [true, true, true]);
  assert.deepEqual([vr.summary.added, vr.summary.removed, vr.summary.milestonesSlipped, vr.summary.buckets.reduce((n, x) => n + x.n, 0)], [1, 1, 1, vr.summary.matched]); assert.equal(vr.rows[0].finishVar, vr.summary.maxSlip, 'the latest first'); assert.ok(vr.chart.length >= 4);
  const only = (await t.call(se, 'GET', B(b0.id, '/variance?only=critical&sort=code'))).json.data; assert.ok(only.rows.length >= 1 && only.rows.every((x) => x.criticalSlip)); assert.equal(only.total, only.filtered.criticalSlipped);
  assert.deepEqual((await t.call(se, 'GET', B(b0.id, '/variance?only=milestones'))).json.data.rows.map((x) => x.code), ['M50']); assert.deepEqual((await t.call(se, 'GET', B(b0.id, '/variance?wbs=1&q=pcc'))).json.data.rows.map((x) => x.code), ['A20']);
  assert.equal((await t.call(se, 'GET', B(b0.id, '/variance?only=nope'))).status, 400); assert.equal((await t.call(se, 'GET', B(b0.id, '/variance?pageSize=7'))).status, 400);
  for (const f of ['xlsx', 'pdf', 'csv']) { const x = await t.download(pm, B(b0.id, `/variance/export?format=${f}`)); assert.equal(x.status, 200, f); assert.equal(x.headers.get('x-export-rows'), '6'); if (f === 'csv') { assert.match(x.buffer.toString(), /A20,PCC bed/); assert.match(x.buffer.toString(), /Total,6 activities/); } if (f === 'pdf') assert.equal(x.buffer.subarray(0, 5).toString(), '%PDF-'); }
  assert.equal((await t.download(se, B(b0.id, '/variance/export'))).status, 403, 'a site engineer reads the variance but does not export it');
  // the Gantt of 13.02 now carries the bars of the current baseline, by activity
  const g = (await t.call(plan1, 'GET', `/schedules/${sid}/gantt`)).json.data; assert.deepEqual([g.baseline.id, g.baseline.finish, g.baseline.dates[a3.A20.id], g.baseline.dates[a3.A45.id]], [b0.id, cA.finishDate, [by.A20.bStart, by.A20.bFinish], undefined]);
  // the quality check now has a baseline: at a data date after the baseline finish, nothing is finished: missed activities and the execution index fail
  assert.equal((await t.call(plan1, 'POST', `/schedules/${sid}/update-progress`, { dataDate: '2026-04-27', rows: [{ activityId: a3.A10.id, actualStart: '2026-04-06', pctComplete: 50 }] })).status, 200);
  const qc = Object.fromEntries((await t.call(plan1, 'GET', `/schedules/${sid}/quality`)).json.data.checks.map((x) => [x.code, x])); assert.deepEqual([qc.MISSED.status, qc.MISSED.count, qc.MISSED.total, qc.BEI.status, qc.BEI.value], ['FAIL', 4, 5, 'FAIL', 0]);
  assert.equal((await t.call(plan1, 'GET', B(b0.id, '/quality'))).json.data.subject.kind, 'baseline');
  // FR-02: a revision: its kind and reason, the change against the current baseline worked out, a summary before it is sent
  assert.equal((await t.call(plan1, 'POST', '/baselines', { ...body, name: 'Another original' })).status, 400, 'a project has one original'); assert.equal((await t.call(plan1, 'POST', B(b0.id, '/amend'), { revisionType: 'ORIGINAL', reason: 'Not a revision' })).status, 400);
  assert.equal((await t.call(pm, 'POST', B(b0.id, '/amend'), { revisionType: 'EOT', reason: 'The manager does not prepare' })).status, 403);
  const am = await t.call(plan1, 'POST', B(b0.id, '/amend'), { revisionType: 'EOT', reason: 'Extension of time 1 granted for the late drawings', referenceNo: 'EOT-01' }); assert.equal(am.status, 201, JSON.stringify(am.json)); const b1 = am.json.data;
  assert.deepEqual([b1.status, b1.baselineNo, b1.revisionType, b1.previousBaselineId, b1.previousDocNo, b1.current, b1.change.added, b1.change.removed, b1.change.linksAdded > 0], ['DRAFT', 1, 'EOT', b0.id, b0.docNo, false, 1, 1, true]); assert.ok(b1.change.finishVar > 0); assert.ok(b1.change.top.some((x) => x.code === 'M50'));
  const noSum = await t.call(plan1, 'POST', B(b1.id, '/submit')); assert.equal(noSum.status, 400); assert.equal(noSum.json.error.details[0].field, 'changeSummary');
  const u1 = await t.call(plan1, 'PATCH', B(b1.id), { changeSummary: 'PCC bed four days longer; the columns in two pours instead of one', rowVersion: b1.rowVersion }); assert.equal(u1.status, 200);
  const s1 = await t.call(plan1, 'POST', B(b1.id, '/submit')); assert.equal(s1.status, 202, JSON.stringify(s1.json)); const i1 = s1.json.data.workflowInstanceId;
  assert.equal((await t.call(se, 'GET', `/baselines/current?projectId=${t.pid}`)).json.data.baseline.id, b0.id, 'a revision that waits changes nothing');
  // returned by the manager, corrected and sent again; then both approve
  await t.act(pm, i1, 'return'); const ret = (await t.call(plan1, 'GET', B(b1.id))).json.data; assert.deepEqual([ret.status, ret.can.edit], ['RETURNED', true]);
  assert.equal((await t.call(plan1, 'PATCH', B(b1.id), { changeSummary: 'PCC bed four days longer (late drawings); the columns in two pours instead of one', refresh: true, rowVersion: ret.rowVersion })).status, 200);
  assert.equal((await t.call(plan1, 'POST', B(b1.id, '/submit'))).status, 202); await t.act(pm, i1); await t.act(pd, i1);
  const list = (await t.call(se, 'GET', `/baselines/project?projectId=${t.pid}`)).json.data; assert.deepEqual(list.rows.map((x) => [x.baselineNo, x.status, x.current]), [[0, 'APPROVED', false], [1, 'APPROVED', true]], 'both stay approved; one is current'); assert.equal(list.currentId, b1.id);
  assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM plan_baselines WHERE org_project_id = ? AND is_current = 1').get(t.pid).n, 1); assert.deepEqual(t.d.prepare('SELECT snapshot_hash, snapshot_json FROM plan_baselines WHERE id = ?').get(b0.id), frozen, 'the earlier baseline is as it was approved');
  assert.throws(() => t.d.prepare('UPDATE plan_baselines SET is_current = 1 WHERE id = ?').run(b0.id), /UNIQUE/, 'two current baselines cannot exist');
  const ev2 = t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'plan.baseline.approved' ORDER BY id").all().map((x) => JSON.parse(x.payload).data); assert.deepEqual([ev2.length, ev2[1].previousBaselineId, ev2[1].revisionType, ev2[1].finishVar > 0], [2, b0.id, 'EOT', true]);
  // one baseline against another; the list, its filter and its export
  const bb = (await t.call(se, 'GET', B(b0.id, `/variance?withBaselineId=${b1.id}`))).json.data; assert.deepEqual([bb.against.kind, bb.against.id, bb.summary.added, bb.summary.removed], ['baseline', b1.id, 1, 1]);
  const ls = (await t.call(se, 'GET', '/baselines?filter[status]=APPROVED&sort=baselineNo')).json; assert.deepEqual(ls.data.map((x) => x.baselineNo), [0, 1]); assert.equal((await t.call(other, 'GET', '/baselines')).json.data.length, 0);
  const ex = await t.download(pm, '/baselines/export?format=csv'); assert.equal(ex.status, 200); assert.match(ex.buffer.toString(), /Extension of time/); assert.equal((await t.download(se, '/baselines/export?format=csv')).status, 403);
  // rejected: a third one, sent and refused by the director after the manager; withdrawn and cancelled ones
  const b2 = (await t.call(plan1, 'POST', B(b1.id, '/amend'), { revisionType: 'RESEQUENCE', reason: 'A re-sequencing nobody asked for', changeSummary: 'Nothing changed' })).json.data; assert.equal(b2.baselineNo, 2);
  const s2 = await t.call(plan1, 'POST', B(b2.id, '/submit')); const i2 = s2.json.data.workflowInstanceId; assert.equal((await t.call(se, 'POST', B(b2.id, '/withdraw'), { reason: 'Not mine to take back' })).status, 403);
  const wd = await t.call(plan1, 'POST', B(b2.id, '/withdraw'), { reason: 'Sent too early' }); assert.equal(wd.status, 200, JSON.stringify(wd.json)); assert.deepEqual([wd.json.data.status, wd.json.data.workflowInstanceId], ['DRAFT', null]);
  const s3 = await t.call(plan1, 'POST', B(b2.id, '/submit')); const i3 = s3.json.data.workflowInstanceId; assert.notEqual(i3, i2); await t.act(pm, i3); await t.act(pd, i3, 'reject');
  const rj = (await t.call(plan1, 'GET', B(b2.id))).json.data; assert.deepEqual([rj.status, rj.current], ['REJECTED', false]); assert.equal((await t.call(se, 'GET', `/baselines/current?projectId=${t.pid}`)).json.data.baseline.id, b1.id);
  const b3 = (await t.call(plan1, 'POST', B(b1.id, '/amend'), { revisionType: 'OTHER', reason: 'A draft to be cancelled' })).json.data; assert.equal((await t.call(se, 'POST', B(b3.id, '/cancel'), { reason: 'Not allowed here' })).status, 403);
  assert.equal((await t.call(plan1, 'POST', B(b3.id, '/cancel'), { reason: 'Raised by mistake' })).json.data.status, 'CANCELLED'); const b4 = (await t.call(plan1, 'POST', B(b1.id, '/amend'), { revisionType: 'OTHER', reason: 'A draft to be deleted' })).json.data;
  assert.equal((await t.call(plan1, 'DELETE', B(b4.id))).status, 200); assert.equal((await t.call(plan1, 'GET', B(b4.id))).status, 404);
  const h = (await t.call(se, 'GET', B(b1.id, '/history'))).json.data; assert.ok(h.approvals.length >= 4); assert.deepEqual(h.audit.map((x) => x.action).filter((x) => ['create', 'amend', 'submit', 'returned', 'approve'].includes(x)), ['create', 'amend', 'submit', 'returned', 'submit', 'approve']);
  // BR-02: a file never reaches a baseline: read into the working schedule, the baselines keep their pictures
  const file = await t.download(plan1, `/schedules/${sid}/exchange?format=msp`); const up2 = await t.upload(plan1, sid, file.buffer, 'again.xml'); assert.equal(up2.status, 201, up2.buffer.toString()); assert.equal((await t.call(plan1, 'POST', `/imports/${up2.json.data.id}/apply`, {})).status, 200);
  assert.deepEqual(t.d.prepare('SELECT snapshot_hash, snapshot_json FROM plan_baselines WHERE id = ?').get(b0.id), frozen); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM plan_baselines WHERE status = 'APPROVED'").get().n, 2);
});

test('AC-03 the one who prepares never approves; roles, isolation and the flag', async () => {
  const t = await boot(); const sid = await t.schedule(t.pid, 'Working schedule', both); await t.rows(sid, [{ code: 'A10', name: 'Only activity', duration: 5 }, { code: 'A20', name: 'Second activity', duration: 2, predecessors: 'A10' }], both); await t.calc(sid, both);
  // a planner who is also a project manager prepares and sends: the review goes to the other manager, never back to them
  const made = await t.call(both, 'POST', '/baselines', { scheduleId: sid, name: 'Programme of the small job', reason: 'The first programme of the job' }); assert.equal(made.status, 201, JSON.stringify(made.json)); const b = made.json.data; assert.equal(b.revisionType, 'ORIGINAL');
  assert.equal((await t.call(plan1, 'POST', `/baselines/${b.id}/submit`)).status, 403, 'only the one who raised it sends it');
  const sub = await t.call(both, 'POST', `/baselines/${b.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(both, inst), false, 'the maker is a project manager and still gets no task'); assert.equal(await t.hasTask(pm, inst), true);
  const tasks = (await t.api.call('GET', `${W}/tasks?mine=assigned`, pm)).json.data.rows.find((x) => x.instance.id === inst); const self = await t.api.call('POST', `${W}/tasks/${tasks.id}/act`, { ...both, headers: key(), body: { action: 'approve', comment: 'my own' } }); assert.ok([403, 404, 409, 422].includes(self.status), `self-approval is refused (${self.status})`);
  assert.equal((await t.call(both, 'GET', `/baselines/${b.id}`)).json.data.status, 'SUBMITTED'); await t.act(pm, inst); await t.act(pd, inst); assert.equal((await t.call(both, 'GET', `/baselines/${b.id}`)).json.data.status, 'APPROVED');
  // who reads what
  for (const who of [se, aud, pcm, pm, pd]) { assert.equal((await t.call(who, 'GET', `/baselines/${b.id}`)).status, 200, who.roles); assert.equal((await t.call(who, 'GET', `/baselines/${b.id}/variance`)).status, 200, who.roles); }
  assert.equal((await t.call(aud, 'GET', `/baselines/${b.id}`)).json.data.can.export, true); assert.equal((await t.download(aud, `/baselines/${b.id}/variance/export?format=csv`)).status, 200); assert.equal((await t.download(aud, `/baselines/${b.id}/print`)).status, 403);
  for (const who of [se, aud, pcm]) assert.equal((await t.call(who, 'POST', `/baselines/${b.id}/amend`, { revisionType: 'EOT', reason: 'Not theirs to revise' })).status, 403, who.roles);
  // another company sees nothing of it; another project of the company does not mix
  for (const path of [`/baselines/${b.id}`, `/baselines/${b.id}/variance`, `/baselines/${b.id}/history`, `/baselines/${b.id}/quality`, `/baselines/project?projectId=${t.pid}`, `/baselines/current?projectId=${t.pid}`]) assert.equal((await t.call(other, 'GET', path)).status, 404, path);
  assert.equal((await t.download(other, `/baselines/${b.id}/exchange`)).status, 404); assert.equal((await t.call(other, 'POST', `/baselines/${b.id}/amend`, { revisionType: 'EOT', reason: 'From another company' })).status, 404);
  const s2 = await t.schedule(t.pid2); await t.rows(s2, [{ code: 'Z10', name: 'Other project', duration: 3 }]); await t.calc(s2); assert.equal((await t.call(se, 'GET', `/baselines/${b.id}/variance?scheduleId=${s2}`)).status, 400, 'a schedule of another project is not compared');
  assert.equal((await t.call(se, 'GET', `/baselines/current?projectId=${t.pid2}`)).json.data.baseline, null); assert.equal((await t.call(plan1, 'GET', `/schedules/${s2}/gantt`)).json.data.baseline, null);
  // the flag: off, the routes of 13.03 are not there and the Gantt carries no baseline; 13.01 and 13.02 go on
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plan.p1303'").run();
  for (const path of ['/baselines', `/baselines/${b.id}`, `/schedules/${sid}/quality`, `/schedules/${sid}/exchange`, `/imports?scheduleId=${sid}`]) assert.equal((await t.call(both, 'GET', path)).status, 404, path);
  const g = await t.call(both, 'GET', `/schedules/${sid}/gantt`); assert.equal(g.status, 200); assert.equal(g.json.data.baseline, null); assert.equal((await t.call(both, 'GET', `/schedules/${sid}`)).status, 200);
  t.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.plan.p1303'").run(); assert.equal((await t.call(both, 'GET', `/schedules/${sid}/gantt`)).json.data.baseline.id, b.id);
});

test('FR-03 the variance on its own: matching by code, actual dates, milestones and the buckets', () => {
  const pic = (finish, acts) => ({ schedule: { start: '2026-04-06', finish, dataDate: null }, wbs: [{ key: 'w', code: '1', name: 'Works' }], links: [], activities: acts.map(([code, type, duration, start, fin, extra = {}]) => ({ key: code, code, name: code, type, duration, start, finish: fin, wbsKey: 'w', critical: false, ...extra })) });
  const base = pic('2026-05-10', [['A', 'TASK', 5, '2026-04-06', '2026-04-10'], ['B', 'TASK', 5, '2026-04-11', '2026-04-16'], ['C', 'TASK', 3, '2026-04-17', '2026-04-20'], ['M', 'MILESTONE', 0, '2026-05-10', '2026-05-10'], ['OLD', 'TASK', 2, '2026-04-06', '2026-04-07']]);
  const cur = pic('2026-06-14', [['a', 'TASK', 5, '2026-04-06', '2026-04-10', { actualStart: '2026-04-04', actualFinish: '2026-04-08' }], ['B', 'TASK', 9, '2026-04-11', '2026-04-21', { critical: true }], ['C', 'TASK', 3, '2026-04-17', '2026-04-20'], ['M', 'MILESTONE', 0, '2026-06-14', '2026-06-14', { critical: true }], ['NEW', 'TASK', 1, '2026-04-06', '2026-04-06']]);
  const v = varianceOf(base, cur); const by = Object.fromEntries(v.rows.map((r) => [r.code, r]));
  assert.deepEqual([by.a.startVar, by.a.finishVar, by.a.status, by.a.done], [-2, -2, 'CHANGED', true], 'codes match whatever their case; actual dates count'); assert.deepEqual([by.B.finishVar, by.B.durationVar, by.B.criticalSlip], [5, 4, true]); assert.deepEqual([by.C.status, by.M.finishVar, by.M.milestone], ['SAME', 35, true]);
  assert.deepEqual([by.NEW.status, by.OLD.status, by.OLD.wbs], ['ADDED', 'REMOVED', '1 Works']); assert.deepEqual(v.summary.buckets.map((b) => b.n), [1, 1, 1, 0, 1]);
  assert.deepEqual([v.summary.finishVar, v.summary.slipped, v.summary.criticalSlipped, v.summary.milestonesSlipped, v.summary.ahead, v.summary.maxSlip, v.summary.added, v.summary.removed, v.summary.longer], [35, 2, 2, 1, 1, 35, 1, 1, 1]);
});

/** A call without an Idempotency-Key. */
function api0(t, method, path, who, body) { return t.api.call(method, `${P}${path}`, { ...who, headers: { 'content-type': 'application/json' }, body }); }

test('30.01 BR-01 an extension-of-time revision takes the awarded EOT, not a typed reference: the claim number and the link come from the award', async () => {
  const t = await boot(); const sid = await t.schedule(t.pid, 'Working schedule', both); await t.rows(sid, [{ code: 'A10', name: 'Only activity', duration: 5 }], both); await t.calc(sid, both);
  const b = (await t.call(both, 'POST', '/baselines', { scheduleId: sid, name: 'Programme of the job', reason: 'The first programme of the job' })).json.data;
  const inst = (await t.call(both, 'POST', `/baselines/${b.id}/submit`)).json.data.workflowInstanceId; await t.act(pm, inst); await t.act(pd, inst);
  t.d.exec('PRAGMA foreign_keys = OFF');
  const claim = (pid, no) => fill(t.d, 'ctr_claims', { company_id: 1, doc_no: `CLM/${no}`, claim_no: no, org_project_id: pid, contract_id: 1, title: 'Late drawings', event_date: '2026-05-01', time_bar_date: '2026-05-29', status: 'APPROVED' });
  const award = (c) => fill(t.d, 'ctr_eot_awards', { company_id: 1, claim_id: c, contract_id: 1, days: 12, completion_before: '2026-06-01', completion_after: '2026-06-13' });
  const mine = award(claim(t.pid, 'CLM-07')); const other = award(claim(t.pid2, 'CLM-99'));
  t.d.exec('PRAGMA foreign_keys = ON');
  const view = (await t.call(both, 'GET', `/baselines/${b.id}`)).json.data;
  assert.deepEqual(view.eotAwards.map((a) => [a.id, a.claimNo, a.days]), [[mine, 'CLM-07', 12]], 'only the awards of the project');
  assert.equal((await t.call(both, 'POST', `/baselines/${b.id}/amend`, { revisionType: 'RESEQUENCE', reason: 'Not an extension of time', eotAwardId: mine })).status, 400);
  assert.equal((await t.call(both, 'POST', `/baselines/${b.id}/amend`, { revisionType: 'EOT', reason: 'Award of another project', eotAwardId: other })).status, 400);
  const am = await t.call(both, 'POST', `/baselines/${b.id}/amend`, { revisionType: 'EOT', reason: 'Extension of time 7 awarded for the late drawings', eotAwardId: mine, referenceNo: 'typed by hand' });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  assert.equal(am.json.data.referenceNo, 'CLM-07', 'the reference is the claim number, whatever was typed');
  const row = t.d.prepare('SELECT source_type, source_id, reference_no FROM plan_baselines WHERE id = ?').get(am.json.data.id);
  assert.deepEqual([row.source_type, row.source_id, row.reference_no], ['ctr_eot_awards', String(mine), 'CLM-07']);
  const rev = (await t.call(both, 'GET', `/baselines/${am.json.data.id}`)).json.data;
  assert.equal(rev.eotAward.claimNo, 'CLM-07');
});
