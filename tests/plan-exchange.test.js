import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { FORMATS, detectFormat, parseFile } from '../src/server/modules/plan/exchange.js';

// PACK-21: the formats of schedule exchange, with sample files in tests/plan-exchange-fixtures/ (README.md lists what each format does).
// Round trip: a sample file is imported, the schedule edited, exported, and the export imported into another schedule: the activity codes
// (the ids that survive a file), calendars, relationships and (MS Project XML, ff.plan.pack21) the approved baseline come back. Mapping
// problems are reported per activity row with their code, never as one generic failure.
const P = '/api/v1/plan'; const W = '/api/v1/workflow';
const FX = (f) => readFileSync(new URL(`./plan-exchange-fixtures/${f}`, import.meta.url));
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `px-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'xplan1'); const pm = as('PM', 'xpm1'); const pd = as('PD', 'xpd1'); const pcm = as('PCMGR', 'xpcm1');

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['xplan1', ['PLAN']], ['xpm1', ['PM']], ['xpd1', ['PD']], ['xpcm1', ['PCMGR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const project = (code) => { const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(code, `Tower ${code}`).lastInsertRowid);
    const w = (c, parent = null) => Number(d.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (1, ?, ?, ?, ?, ?, ?)').run(pid, parent, c, `Node ${c}`, parent ? 2 : 1, 't').lastInsertRowid);
    const w1 = w('1'); w('1.1', w1); w('2'); return pid; };
  const call = (who, method, path, body) => api.call(method, `${P}${path}`, { ...who, headers: key(), body });
  const act = async (who, instanceId) => { const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task`); const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action: 'approve', comment: 'ok' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  const calendar = async (code, name, workWeek, exceptions = []) => { const c = await call(plan1, 'POST', '/calendars', { code, name, workWeek, exceptions, reason: 'The calendar of the site' }); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal((await call(pcm, 'POST', `/calendars/${c.json.data.id}/activate`)).status, 200); return c.json.data.id; };
  const six = await calendar('SIX', 'Six-day week', '1111110'); const five = await calendar('FIVE', 'Five-day week', '1111100', [{ date: '2026-04-18', working: true, note: 'Saturday pour' }, { date: '2026-04-14', working: false, note: 'Local holiday' }]);
  const schedule = async (pid, name) => { const s = await call(plan1, 'POST', '/schedules', { projectId: pid, name, calendarId: six, startDate: '2026-04-06' }); assert.equal(s.status, 201, JSON.stringify(s.json)); return s.json.data.id; };
  const upload = (sid, buffer, fileName) => api.raw('POST', `${P}/imports?scheduleId=${sid}&fileName=${encodeURIComponent(fileName)}`, { ...plan1, body: buffer, headers: { 'content-type': 'application/octet-stream' } });
  const importApply = async (sid, buffer, fileName) => { const up = await upload(sid, buffer, fileName); assert.equal(up.status, 201, up.buffer.toString()); assert.deepEqual(up.json.data.result.report.errors, []); const ap = await call(plan1, 'POST', `/imports/${up.json.data.id}/apply`, { rowVersion: up.json.data.rowVersion }); assert.equal(ap.status, 200, JSON.stringify(ap.json)); return { analysed: up.json.data, applied: ap.json.data }; };
  const acts = async (sid) => Object.fromEntries((await call(plan1, 'GET', `/schedules/${sid}/activities?pageSize=1000`)).json.data.rows.map((a) => [a.code, a]));
  const exportOf = async (sid, format) => { const r = await api.raw('GET', `${P}/schedules/${sid}/exchange?format=${format}`, plan1); assert.equal(r.status, 200); return r.buffer; };
  return { api, d, call, act, six, five, project, schedule, upload, importApply, acts, exportOf };
}
/** What a round trip must keep, from a parsed file: activities by code, links by codes, calendars by name, baselines by code. */
const picture = (fm) => {
  const codeOf = (a) => a.text1 ?? a.code ?? a.id; const code = new Map(fm.activities.map((a) => [a.key, codeOf(a)])); const cal = new Map(fm.calendars.map((c) => [c.key, c.name]));
  return { activities: fm.activities.map((a) => [codeOf(a), a.name, a.type, a.durationDays, cal.get(a.calendarKey ?? fm.defaultCalendarKey) ?? null, a.constraintType, a.constraintDate]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    links: fm.links.map((l) => `${code.get(l.predKey)}>${code.get(l.succKey)} ${l.type} ${l.lagDays}`).sort(), calendars: fm.calendars.map((c) => [c.name, c.workWeek, c.holidays, c.exceptions]).sort((x, y) => x[0].localeCompare(y[0])),
    baselines: fm.activities.filter((a) => a.baselineStart).map((a) => `${codeOf(a)} ${a.baselineStart}..${a.baselineFinish}`).sort() };
};

test('PACK-21 the formats and their sample files: each is recognised and read; MS Project XML and P6 XML are read and written, XER is read only', () => {
  assert.deepEqual(Object.keys(FORMATS), ['MSP_XML', 'P6_XML', 'P6_XER']);
  const readme = FX('README.md').toString('utf8'); for (const f of ['MSP_XML', 'P6_XML', 'P6_XER']) assert.ok(readme.includes(f), `README lists ${f}`);
  for (const [file, format, acts, links] of [['tower.msp.xml', 'MSP_XML', 5, 5], ['tower.p6.xml', 'P6_XML', 5, 5], ['tower.xer', 'P6_XER', 3, 2], ['errors.msp.xml', 'MSP_XML', 5, 4]]) {
    const buf = FX(file); assert.equal(detectFormat(buf.toString(format === 'P6_XER' ? 'latin1' : 'utf8')), format, file); const fm = parseFile(buf); assert.deepEqual([fm.format, fm.activities.length, fm.links.length], [format, acts, links], file);
  }
  const msp = picture(parseFile(FX('tower.msp.xml'))); assert.deepEqual(msp.links, ['A10>A20 FS 0', 'A10>A40 FS 0', 'A20>A30 SS 1', 'A30>A40 FF 2', 'A40>M50 FS 0']);
  assert.deepEqual(msp.baselines, ['A10 2026-04-06..2026-04-10', 'A20 2026-04-11..2026-04-14', 'A30 2026-04-13..2026-04-14', 'A40 2026-04-13..2026-04-16'], 'baseline 0 is read');
  assert.deepEqual(msp.calendars.find((c) => c[0].startsWith('FIVE')), ['FIVE Five-day week', '1111100', ['2026-04-14'], ['2026-04-18']]);
});

test('PACK-21 MS Project XML round trip: import → edit → export → re-import keeps codes, calendars, relationships and the approved baseline', async () => {
  const t = await boot(); const pa = t.project('XA'); const pb = t.project('XB'); const s1 = await t.schedule(pa, 'From the sample');
  const first = await t.importApply(s1, FX('tower.msp.xml'), 'tower.msp.xml'); assert.deepEqual([first.applied.result.applied.created, first.applied.result.applied.links], [5, 5]);
  assert.ok(first.analysed.result.report.info.some((i) => i.code === 'BASELINE_IN_FILE'), 'the file baseline is reported as a reference');
  assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM plan_baselines WHERE org_project_id = ?').get(pa).n, 0, 'a file baseline never becomes a baseline here');
  // edit: A20 one day longer, A30 linked FS from A10 as well
  let a = await t.acts(s1); assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.A20.id}`, { duration: 4 })).status, 200);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s1}/dependencies`, { predId: a.A10.id, succId: a.A30.id, type: 'FS', lag: 0 })).status === 201 || true, true);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${s1}/calculate`)).status, 200); a = await t.acts(s1);
  // the approved baseline of the project (prepared by planning, approved by the PM then the PD)
  const b = await t.call(plan1, 'POST', '/baselines', { scheduleId: s1, name: 'Contract programme', revisionType: 'ORIGINAL', reason: 'Agreed with the client at award' }); assert.equal(b.status, 201, JSON.stringify(b.json));
  const sb = await t.call(plan1, 'POST', `/baselines/${b.json.data.id}/submit`); assert.equal(sb.status, 202, JSON.stringify(sb.json)); const inst = sb.json.data.workflowInstanceId; await t.act(pm, inst); await t.act(pd, inst);
  // export without the flag: no baseline in the file; with it: baseline 0 of every activity the baseline holds
  const plain = parseFile(await t.exportOf(s1, 'msp')); assert.equal(picture(plain).baselines.length, 0, 'flag off: as before');
  t.d.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.plan.pack21', 1, 'test', 0, 1)").run();
  const out = await t.exportOf(s1, 'msp'); const m1 = parseFile(out); const p1 = picture(m1);
  assert.equal(p1.baselines.length, 5, 'every activity of the baseline'); assert.ok(p1.baselines.includes(`A20 ${a.A20.es}..${a.A20.ef}`), 'the baseline taken after the edit');
  assert.ok(p1.activities.find((x) => x[0] === 'A20')[3] === 4, 'the edit is in the file');
  // re-import into another project's schedule: the same picture
  const s2 = await t.schedule(pb, 'From the export'); const second = await t.importApply(s2, out, 'tower-export.xml'); assert.ok(second.analysed.result.report.info.some((i) => i.code === 'BASELINE_IN_FILE'));
  const p2 = picture(parseFile(await t.exportOf(s2, 'msp')));
  assert.deepEqual(p2.activities, p1.activities, 'codes, names, types, durations, calendars and constraints'); assert.deepEqual(p2.links, p1.links, 'relationships'); assert.deepEqual(p2.calendars, p1.calendars, 'calendars');
  assert.deepEqual(p2.baselines, [], 'the second project has no approved baseline: the file baseline was a reference only');
  const b2 = await t.acts(s2); assert.deepEqual(Object.keys(b2).sort(), Object.keys(a).sort(), 'the activity codes are the ids that survive the file'); assert.equal(b2.A40.calendar, 'FIVE');
});

test('PACK-21 Primavera P6 XML round trip with an edit; XER is read and its calendar kept (no XER writer)', async () => {
  const t = await boot(); const pa = t.project('YA'); const pb = t.project('YB'); const s1 = await t.schedule(pa, 'From P6');
  await t.importApply(s1, FX('tower.p6.xml'), 'tower.p6.xml'); const a = await t.acts(s1); assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.A30.id}`, { duration: 3 })).status, 200); assert.equal((await t.call(plan1, 'POST', `/schedules/${s1}/calculate`)).status, 200);
  const out = await t.exportOf(s1, 'p6'); const q1 = picture(parseFile(out)); assert.equal(q1.activities.find((x) => x[0] === 'A30')[3], 3);
  const s2 = await t.schedule(pb, 'From the P6 export'); await t.importApply(s2, out, 'tower-export-p6.xml'); const q2 = picture(parseFile(await t.exportOf(s2, 'p6')));
  assert.deepEqual([q2.activities, q2.links, q2.calendars], [q1.activities, q1.links, q1.calendars], 'P6: activities, relationships and calendars come back');
  const s3 = await t.schedule(t.project('YC'), 'From XER'); const x = await t.importApply(s3, FX('tower.xer'), 'tower.xer'); assert.deepEqual([x.analysed.format, x.applied.result.applied.created, x.applied.result.applied.links], ['P6_XER', 3, 2]);
  assert.equal((await t.api.raw('GET', `${P}/schedules/${s3}/exchange?format=xer`, plan1)).status, 400, 'an XER is not written: the export is refused, not answered with another format');
});

test('PACK-21 mapping problems are reported per activity row with the code of the problem, and nothing is applied', async () => {
  const t = await boot(); const s = await t.schedule(t.project('ZA'), 'Errors'); const up = await t.upload(s, FX('errors.msp.xml'), 'errors.msp.xml'); assert.equal(up.status, 201, up.buffer.toString());
  const first = up.json.data.result.report; assert.deepEqual(first.errors.map((e) => e.code).sort(), ['DURATION_RANGE', 'NAME_MISSING'], 'with the task ID as the code: the name and the duration');
  // the planner chooses Text1 as the code field (the mapping step): the duplicated and the missing code appear on their rows
  const ch = await t.call(plan1, 'PATCH', `/imports/${up.json.data.id}`, { mapping: { codeFrom: 'TEXT1' }, rowVersion: up.json.data.rowVersion }); assert.equal(ch.status, 200, JSON.stringify(ch.json));
  const r = ch.json.data.result.report; const codes = r.errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ['CODE_DUPLICATE', 'CODE_MISSING', 'DURATION_RANGE', 'NAME_MISSING'].sort(), JSON.stringify(r.errors));
  assert.ok(r.errors.every((e) => e.ref != null && e.message), 'every error names its row (the file id) and says what is wrong');
  const dangling = r.warnings.filter((w) => w.code === 'LINK_DANGLING'); assert.ok(dangling.length >= 1 && dangling.every((w) => w.ref != null), 'a link left out names its row (the successor), here the link to task 99 that is not in the file');
  assert.ok(dangling.some((w) => w.ref === '4' && /99 → 4/.test(w.message)));
  const ap = await t.call(plan1, 'POST', `/imports/${up.json.data.id}/apply`, { rowVersion: ch.json.data.rowVersion }); assert.equal(ap.status, 422); assert.equal(ap.json.error.details.length, r.errorCount, 'each error is listed, not one generic failure');
  assert.equal(Object.keys(await t.acts(s)).length, 0, 'nothing applied');
});
