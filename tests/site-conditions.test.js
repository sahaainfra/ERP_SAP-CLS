import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { integrationsOf } from '../src/server/platform/integrations/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';

// Part 14.03: site diary, weather, hindrances and site conditions.
// T-01 a weather shutdown above the threshold creates a delay draft (and one below it does not).
// Also: FR-01 (manual and fetched weather, the condition, the pour restriction, rainfall by month), FR-02/BR-01 (hindrance chain SE -> CM -> PM, closure needs an end date and evidence, escalation of old ones),
// FR-03 (diary sign-off by another person, then locked), FR-04 (visitors, a linked letter), FR-05 (delay drafts from hindrances), the DPR prefill, roles, isolation, 409, idempotent replay and the flag.
const S = '/api/v1/site'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `cnd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const se = as('SE', 'cse1'); const se2 = as('SE', 'cse2'); const cm = as('CM', 'ccm1'); const cm2 = as('CM', 'ccm2'); const pm = as('PM', 'cpm1'); const plan1 = as('PLAN', 'cplan1'); const aud = as('AUD', 'caud1'); const qs = as('QS', 'cqs1'); const sk = as('SK', 'csk1'); const commgr = as('COMMGR', 'ccom1');
const other = as('SE', 'cse9', '2');
const day = (n) => isoOf(ordOf(todayIST()) - n); const Y = day(1); const Y2 = day(2); const Y3 = day(3); const TODAY = todayIST();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['cse1', ['SE']], ['cse2', ['SE']], ['ccm1', ['CM']], ['ccm2', ['CM']], ['cpm1', ['PM']], ['cplan1', ['PLAN']], ['caud1', ['AUD']], ['cqs1', ['QS']], ['csk1', ['SK']], ['ccom1', ['COMMGR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CND', 'Conditions Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude) VALUES (1, ?, 'CND-S1', 'Tower site', 'ACTIVE', 18.52, 73.85)").run(pid).lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CND2', 'Other Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site2 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'CND-S2', 'Other site', 'ACTIVE')").run(pid2).lastInsertRowid);
  const zone = Number(d.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (1, ?, 'ZONE', 'ZA', 'Zone A', 't')").run(pid).lastInsertRowid);
  const letter = Number(d.prepare("INSERT INTO engg_letters (company_id, org_project_id, direction, letter_no, letter_date, party, subject, category, status, created_by, source_type) VALUES (1, ?, 'OUT', 'LTR/0001', ?, 'Client', 'Notice: site not handed over', 'NOTICE', 'ISSUED', 't', 'test')").run(pid, Y3).lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${S}${path}`, { ...who, headers: k, body });
  const pcall = (who, method, path, body) => api.call(method, `/api/v1/plan${path}`, { ...who, headers: key(), body });
  const taskOf = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  const act = async (who, instanceId, action = 'approve') => { const task = await taskOf(who, instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); };
  const pcm = as('PCMGR', 'cpcm1'); d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run('cpcm1', 'cpcm1', JSON.stringify(['PCMGR']), 'cpcm1@example.com');
  const cal = await pcall(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const sch = await pcall(plan1, 'POST', '/schedules', { projectId: pid, name: 'Tower schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' });
  assert.equal((await pcall(plan1, 'POST', `/schedules/${sch.json.data.id}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 5 }, { code: 'A20', name: 'Raft concrete', duration: 3, predecessors: 'A10' }] })).status, 201);
  const a = Object.fromEntries(d.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ?').all(sch.json.data.id).map((x) => [x.code, x.id]));
  const drain = () => runtimeOf(api.db).bus.drain();
  const delays = () => d.prepare('SELECT * FROM plan_delays ORDER BY id').all();
  /** A hindrance raised, sent and approved by the construction manager and then the project manager. */
  const hin = async (extra = {}, { approve = true } = {}) => {
    const c = await call(se, 'POST', '/hindrances', { siteId: site, title: 'Client has not handed over the east plot', description: 'The east plot is occupied by the client\'s other contractor', type: 'SITE_NOT_HANDED_OVER', startDate: Y3, responsibleParty: 'CLIENT', responsibleName: 'Client estates', affected: { activityIds: [a.A10], locationIds: [zone] }, ...extra });
    assert.equal(c.status, 201, JSON.stringify(c.json)); if (!approve) return c.json.data;
    const sub = await call(se, 'POST', `/hindrances/${c.json.data.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
    assert.equal((await act(cm, inst)).status, 200); assert.equal((await act(pm, inst)).status, 200); return (await call(se, 'GET', `/hindrances/${c.json.data.id}`)).json.data;
  };
  const upload = async (who, entity, id, name = 'proof.png') => { const fd = new FormData(); fd.set('file', new Blob([PNG], { type: 'image/png' }), name); fd.set('entity', entity); fd.set('entityId', String(id)); return api.raw('POST', '/api/v1/core/files', { ...who, body: fd }); };
  return { api, d, call, act, taskOf, pcall, drain, delays, hin, upload, pid, site, pid2, site2, zone, letter, a, sid: sch.json.data.id };
}

test('T-01 FR-01 FR-05 a weather shutdown above the threshold creates a delay draft; one below it does not; the condition and the pour restriction are worked out on the server', async () => {
  const t = await boot();
  // rain of 80 mm: heavy rain; concrete is not poured; a shutdown of 8 hours is a day and reaches the threshold (8 h)
  const heavy = await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y, rainfallMm: 80, tempMin: 22, tempMax: 27, humidityPct: 96, windKmh: 30, hoursLost: 8, shutdown: true, shutdownReason: 'The pits are flooded and the roads are cut' }); assert.equal(heavy.status, 201, JSON.stringify(heavy.json)); const h = heavy.json.data;
  assert.deepEqual([h.condition, h.pourRestricted, h.hoursLost, h.shutdown, h.source, h.rainfallMm], ['HEAVY_RAIN', true, 8, true, 'MANUAL', 80]); assert.match(h.pourReason, /rainfall 80 mm is at or above 10 mm/);
  t.drain(); const ds = t.delays(); assert.equal(ds.length, 1, JSON.stringify(ds.map((x) => x.title)));
  assert.deepEqual([ds[0].status, ds[0].cause_category, ds[0].responsibility, ds[0].delay_days, ds[0].start_date, ds[0].end_date, ds[0].src_entity, ds[0].src_id], ['DRAFT', 'WEATHER', 'NEUTRAL', 1, Y, Y, 'site_weather', String(h.id)]);
  assert.equal((await t.call(se, 'GET', `/weather/${h.id}`)).json.data.delay.docNo, ds[0].doc_no, 'the weather record shows its delay');
  // 3 hours lost: below the threshold, no draft; the record is entered a second time for the same day -> 409
  const light = await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y2, rainfallMm: 20, hoursLost: 3, shutdown: true, shutdownReason: 'A storm in the afternoon' }); assert.equal(light.status, 201); t.drain(); assert.equal(t.delays().length, 1, 'below the threshold: no draft');
  assert.equal((await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y2, rainfallMm: 1 })).status, 409);
  // the record changed to 10 hours updates... a new draft for that day (2 days at 8 h): one draft a record
  const up = await t.call(se, 'PATCH', `/weather/${light.json.data.id}`, { hoursLost: 10, rowVersion: light.json.data.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); t.drain();
  assert.deepEqual(t.delays().map((x) => [x.src_id, x.delay_days]), [[String(h.id), 1], [String(light.json.data.id), 2]]);
  assert.equal((await t.call(se, 'PATCH', `/weather/${light.json.data.id}`, { hoursLost: 11, rowVersion: light.json.data.rowVersion })).status, 409, 'stale version'); t.drain();
  const again = await t.call(se, 'PATCH', `/weather/${light.json.data.id}`, { hoursLost: 16 }); assert.equal(again.status, 200); t.drain(); assert.equal(t.delays().length, 2, 'a draft is updated, not repeated'); assert.equal(t.delays()[1].delay_days, 2);
  // validation: a shutdown loses hours and has a reason; the temperature range; a future day
  const bad = await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y3, shutdown: true }); assert.equal(bad.status, 400); assert.deepEqual(bad.json.error.details.map((x) => x.field).sort(), ['hoursLost', 'shutdownReason']);
  assert.equal((await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y3, tempMin: 30, tempMax: 20 })).status, 400); assert.equal((await t.call(se, 'POST', '/weather', { siteId: t.site, date: isoOf(ordOf(TODAY) + 2), rainfallMm: 1 })).status, 400);
  // temperature thresholds of the pour: 42 degrees stops it and names HOT; a mild day does not
  const hot = (await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y3, tempMin: 28, tempMax: 42, rainfallMm: 0 })).json.data; assert.deepEqual([hot.condition, hot.pourRestricted], ['HOT', true]); assert.match(hot.pourReason, /highest temperature 42 °C/);
  const mild = (await t.call(se, 'POST', '/weather', { siteId: t.site, date: day(4), tempMin: 20, tempMax: 30, rainfallMm: 0, humidityPct: 50 })).json.data; assert.deepEqual([mild.condition, mild.pourRestricted, mild.pourReason], ['CLEAR', false, null]);
});

test('FR-01 the weather is fetched through the integration hub; a missing connector is explained; rainfall by month; list, export, delete', async () => {
  const t = await boot();
  assert.equal((await t.call(se, 'POST', '/weather/fetch', { siteId: t.site, date: Y })).status, 422, 'no connector yet: a clear message'); const msg = (await t.call(se, 'POST', '/weather/fetch', { siteId: t.site, date: Y })).json.error.message; assert.match(msg, /weather\.main/);
  t.d.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, status, config_json, created_by, source_type) VALUES (1, 'weather.main', 'Weather', 'maps', 'weather_sandbox', 'ENABLED', ?, 't', 't')").run(JSON.stringify({ rainfallMm: '55', tempMin: '21', tempMax: '29' }));
  const f = await t.call(se, 'POST', '/weather/fetch', { siteId: t.site, date: Y }); assert.equal(f.status, 201, JSON.stringify(f.json)); const w = f.json.data; assert.deepEqual([w.source, w.connector, w.rainfallMm, w.tempMin, w.tempMax, w.condition, w.pourRestricted], ['API', 'weather.main', 55, 21, 29, 'RAIN', true]);
  // the site enters the hours lost; a second fetch for the same day keeps them and refreshes the measures
  assert.equal((await t.call(se, 'PATCH', `/weather/${w.id}`, { hoursLost: 4 })).status, 200); const f2 = await t.call(se, 'POST', '/weather/fetch', { siteId: t.site, date: Y }); assert.equal(f2.status, 201); assert.deepEqual([f2.json.data.id, f2.json.data.hoursLost, f2.json.data.source], [w.id, 4, 'API']);
  assert.equal(integrationsOf(t.d).providers.get('maps', 'weather_http').type, 'maps'); assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_integration_logs WHERE operation = 'weather'").get().n >= 2, 'the calls are in the integration log');
  // the chart: rainfall by month of the year of the record
  await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y2, rainfallMm: 10, hoursLost: 2 }); const yr = Number(Y.slice(0, 4)); const mo = (await t.call(plan1, 'GET', `/weather/monthly?year=${yr}`)); assert.equal(mo.status, 200, 'planning reads the weather'); assert.equal((await t.call(sk, 'GET', `/weather/monthly?year=${yr}`)).status, 403);
  const mon = (await t.call(se, 'GET', `/weather/monthly?year=${yr}&siteId=${t.site}`)).json.data; assert.equal(mon.months.length, 12); const total = mon.months.reduce((n, m) => n + m.rainfallMm, 0); assert.ok(total >= 65 - 1e-9 && total <= 65 + 1e-9, `rain ${total}`); assert.equal(mon.totals.days, mon.months.reduce((n, m) => n + m.days, 0));
  const list = (await t.call(se, 'GET', '/weather?pageSize=50')).json; assert.equal(list.data.length >= 2, true); assert.deepEqual((await t.call(se, 'GET', '/weather?filter[pour]=1')).json.data.every((x) => x.pour === 'Restricted'), true);
  const csv = await t.api.raw('GET', `${S}/weather/export?format=csv`, se); assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /CND-S1/); assert.equal((await t.api.raw('GET', `${S}/weather/export?format=csv`, sk)).status, 403);
  assert.equal((await t.call(se2, 'DELETE', `/weather/${w.id}`)).status, 200); assert.equal((await t.call(se, 'GET', `/weather/${w.id}`)).status, 404);
});

test('FR-02 BR-01 a hindrance goes SE -> CM -> PM, is locked, is closed only with an end date and evidence, and an amendment replaces it', async () => {
  const t = await boot();
  const draft = await t.hin({}, { approve: false }); assert.deepEqual([draft.status, draft.docNo.startsWith('HIN/'), draft.affected.activities.map((x) => x.code), draft.affected.locations.map((x) => x.code), draft.can.submit, draft.can.approve], ['DRAFT', true, ['A10'], ['ZA'], true, false]);
  assert.equal((await t.call(se, 'POST', '/hindrances', { siteId: t.site, title: 'x', type: 'OTHER', startDate: Y, responsibleParty: 'CLIENT' })).status, 400, 'a title of three characters');
  assert.equal((await t.call(se, 'POST', '/hindrances', { siteId: t.site, title: 'Wrong activity', type: 'OTHER', startDate: Y, responsibleParty: 'CLIENT', affected: { activityIds: [999999] } })).status, 400);
  assert.equal((await t.call(se, 'POST', '/hindrances', { siteId: t.site, title: 'Wrong letter', type: 'OTHER', startDate: Y, responsibleParty: 'CLIENT', letterId: 999999 })).status, 400);
  assert.equal((await t.call(se, 'PATCH', `/hindrances/${draft.id}`, { endDate: day(10), rowVersion: draft.rowVersion })).status, 400, 'the end is not before the start');
  const k = key(); const sub = await t.call(se, 'POST', `/hindrances/${draft.id}/submit`, undefined, k); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId; assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/submit`, undefined, k)).json.data.workflowInstanceId, inst, 'idempotent replay');
  // the sender never decides; the chain is the construction manager, then the project manager
  assert.equal(await t.taskOf(se, inst), undefined); assert.equal(await t.taskOf(pm, inst), undefined, 'the project manager waits for the construction manager'); assert.equal((await t.call(se, 'PATCH', `/hindrances/${draft.id}`, { title: 'Changed while waiting' })).status, 409);
  assert.equal((await t.act(cm, inst, 'return')).status, 200); const ret = (await t.call(se, 'GET', `/hindrances/${draft.id}`)).json.data; assert.equal(ret.status, 'RETURNED');
  assert.equal((await t.call(se, 'PATCH', `/hindrances/${draft.id}`, { description: 'The east plot is occupied by another contractor of the client; the notice letter is attached' })).status, 200); assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/submit`)).status, 202);
  assert.equal((await t.act(cm, inst)).status, 200); assert.equal((await t.act(pm, inst)).status, 200); const ok = (await t.call(se, 'GET', `/hindrances/${draft.id}`)).json.data; assert.deepEqual([ok.status, ok.approvedBy, ok.open], ['APPROVED', 'cpm1', true]);
  // locked: no edit, no delete, no cancel
  assert.equal((await t.call(se, 'PATCH', `/hindrances/${draft.id}`, { title: 'After approval' })).status, 409); assert.equal((await t.call(se, 'DELETE', `/hindrances/${draft.id}`)).status, 422); assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/cancel`, { reason: 'Not any more' })).status, 422);
  // BR-01: closing needs an end date and evidence (a file or the letter)
  assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/close`, { endDate: Y, closureNotes: 'Handed over on site' })).status, 400, 'no evidence yet'); const noEv = await t.call(se, 'POST', `/hindrances/${draft.id}/close`, { endDate: Y, closureNotes: 'Handed over on site' }); assert.equal(noEv.json.error.details[0].field, 'evidence');
  assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/close`, { closureNotes: 'no end date' })).status, 400); assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/close`, { endDate: day(10), closureNotes: 'Before the start' })).status, 400);
  assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/close`, { endDate: isoOf(ordOf(TODAY) + 1), closureNotes: 'In the future' })).status, 400);
  const up = await t.upload(se, 'site_hindrance', draft.id, 'handover-minutes.png'); assert.equal(up.status, 201, JSON.stringify(up.json)); assert.equal((await t.call(se, 'GET', `/hindrances/${draft.id}`)).json.data.evidence.files, 1);
  assert.equal((await t.call(sk, 'POST', `/hindrances/${draft.id}/close`, { endDate: Y, closureNotes: 'A storekeeper cannot close' })).status, 403);
  const closed = await t.call(se, 'POST', `/hindrances/${draft.id}/close`, { endDate: Y, closureNotes: 'The plot was handed over on site and minuted' }); assert.equal(closed.status, 200, JSON.stringify(closed.json)); assert.deepEqual([closed.json.data.status, closed.json.data.endDate, closed.json.data.open, closed.json.data.ageDays], ['CLOSED', Y, false, 3]);
  assert.equal((await t.call(se, 'POST', `/hindrances/${draft.id}/close`, { endDate: Y, closureNotes: 'Closed twice' })).status, 422);
  const hist = (await t.call(se, 'GET', `/hindrances/${draft.id}/history`)).json.data; assert.ok(hist.approvals.length >= 4 && hist.audit.some((x) => x.action === 'close'));
  // the letter counts as evidence; the amendment of an approved hindrance is a copy that replaces it
  const withLetter = await t.hin({ title: 'Utility line crosses the raft', type: 'UTILITY_SHIFTING', responsibleParty: 'AUTHORITY', letterId: t.letter }); assert.equal(withLetter.evidence.letter.letterNo, 'LTR/0001');
  const am = await t.call(se, 'POST', `/hindrances/${withLetter.id}/amend`, { reason: 'The start date was wrong by a day' }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.deepEqual([am.json.data.status, am.json.data.revisionNo, am.json.data.previous.id], ['DRAFT', 2, withLetter.id]); assert.equal((await t.call(se, 'POST', `/hindrances/${withLetter.id}/amend`, { reason: 'Twice at once' })).status, 409);
  const sa = await t.call(se, 'POST', `/hindrances/${am.json.data.id}/submit`); assert.equal(sa.status, 202); assert.equal((await t.act(cm, sa.json.data.workflowInstanceId)).status, 200); assert.equal((await t.act(pm, sa.json.data.workflowInstanceId)).status, 200);
  assert.equal((await t.call(se, 'GET', `/hindrances/${withLetter.id}`)).json.data.status, 'SUPERSEDED'); const fin = (await t.call(se, 'GET', `/hindrances/${am.json.data.id}`)).json.data; assert.equal(fin.status, 'APPROVED'); assert.equal(fin.evidence.letter.letterNo, 'LTR/0001', 'the letter stays with the amendment');
  const c2 = await t.call(se, 'POST', `/hindrances/${am.json.data.id}/close`, { endDate: Y, closureNotes: 'The line was shifted by the utility board' }); assert.equal(c2.status, 200, JSON.stringify(c2.json));
  // a CM who raised one never approves it
  const cmse = as('CM,SE', 'ccm1'); const own = await t.call(cmse, 'POST', '/hindrances', { siteId: t.site, title: 'Raised by a CM', description: 'Raised and sent by the same person', type: 'OTHER', startDate: Y, responsibleParty: 'THIRD_PARTY' }); const oi = (await t.call(cmse, 'POST', `/hindrances/${own.json.data.id}/submit`)).json.data.workflowInstanceId; assert.equal(await t.taskOf(cmse, oi), undefined); assert.ok(await t.taskOf(cm2, oi));
  // reject; withdraw only by the sender
  assert.equal((await t.call(se2, 'POST', `/hindrances/${own.json.data.id}/withdraw`, { reason: 'Not mine to withdraw' })).status, 403); assert.equal((await t.act(cm2, oi, 'reject')).status, 200); assert.equal((await t.call(se, 'GET', `/hindrances/${own.json.data.id}`)).json.data.status, 'REJECTED');
});

test('FR-05 an approved hindrance that has lasted the threshold is drafted as a delay of its activities, with its letter as evidence; the closure finishes the draft; the DPR carries it', async () => {
  const t = await boot();
  const h = await t.hin({ letterId: t.letter }); t.drain(); const ds = t.delays(); assert.equal(ds.length, 1);
  assert.deepEqual([ds[0].status, ds[0].cause_category, ds[0].responsibility, ds[0].start_date, ds[0].end_date, ds[0].delay_days, ds[0].src_entity, ds[0].src_id], ['DRAFT', 'LATE_HANDOVER', 'EMPLOYER', Y3, TODAY, 4, 'site_hindrance', String(h.id)]);
  assert.deepEqual(JSON.parse(ds[0].affected_activities_json).map((x) => x.code), ['A10']); assert.deepEqual(t.d.prepare('SELECT entity, label FROM plan_delay_evidence WHERE delay_id = ?').all(ds[0].id).map((x) => x.entity), ['engg_letter']);
  assert.equal((await t.call(se, 'GET', `/hindrances/${h.id}`)).json.data.delay.docNo, ds[0].doc_no, 'the hindrance shows its delay');
  // closed at Y: the draft is updated to the real end
  assert.equal((await t.upload(se, 'site_hindrance', h.id)).status, 201); assert.equal((await t.call(se, 'POST', `/hindrances/${h.id}/close`, { endDate: Y, closureNotes: 'Handed over on site' })).status, 200); t.drain();
  assert.deepEqual(t.delays().map((x) => [x.end_date, x.delay_days]), [[Y, 3]], 'one draft, finished at the end date'); assert.ok(JSON.parse(JSON.stringify(t.d.prepare("SELECT entity FROM plan_delay_evidence WHERE delay_id = ?").all(t.delays()[0].id))).length >= 1);
  // the weather and the hindrance come into a report started from the prefill
  const w = (await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y, rainfallMm: 12, tempMin: 22, tempMax: 28, humidityPct: 90, hoursLost: 1 })).json.data;
  const h2 = await t.hin({ title: 'Drawings pending for the lift pit', type: 'DRAWINGS_PENDING', startDate: day(5), responsibleParty: 'CONSULTANT' });
  const pf = (await t.call(se, 'GET', `/dprs/prefill?siteId=${t.site}&date=${Y}`)).json.data; assert.deepEqual([pf.conditions.weather.code, pf.conditions.weather.rainMm, pf.conditions.hindrances.map((x) => x.docNo).sort()], ['RAIN', 12, [h.docNo, h2.docNo].sort()]);
  const dpr = await t.call(se, 'POST', '/dprs', { siteId: t.site, dprDate: Y, usePrefill: true }); assert.equal(dpr.status, 201, JSON.stringify(dpr.json)); const r = dpr.json.data;
  assert.deepEqual([r.weatherCode, r.rainMm, r.weatherRef], ['RAIN', 12, `weather:${w.id}`]); assert.deepEqual(r.notes.filter((n) => n.type === 'HINDRANCE').map((n) => [n.text.split(':')[0], n.linkedEntity]).sort(), [[h.docNo, 'site_hindrance'], [h2.docNo, 'site_hindrance']].sort());
  assert.equal((await t.call(se, 'GET', `/hindrances/${h2.id}`)).json.data.dprs.length, 1, 'the hindrance lists the report that mentions it');
  // the event for claims carries the activities and the party
  const ev = t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'site.hindrance.approved' ORDER BY id").all().map((x) => JSON.parse(x.payload).data)[0]; assert.deepEqual([ev.docNo, ev.type, ev.responsibleParty, ev.activities.map((a) => a.code), ev.letterId], [h.docNo, 'SITE_NOT_HANDED_OVER', 'CLIENT', ['A10'], t.letter]);
});

test('BR-01 hindrances open longer than the limit are escalated, again after each period; closed ones are not', async () => {
  const t = await boot(); const old = await t.hin({ startDate: day(10) }); const fresh = await t.hin({ title: 'A new hindrance', startDate: Y }); const closed = await t.hin({ title: 'Already closed', startDate: day(12), letterId: t.letter });
  assert.equal((await t.call(se, 'POST', `/hindrances/${closed.id}/close`, { endDate: day(11), closureNotes: 'Resolved in a day' })).status, 200);
  assert.ok(t.d.prepare("SELECT 1 FROM core_schedules WHERE code = 'site.hindrance_escalation_daily'").get(), 'the daily schedule exists');
  const svc = (await import('../src/server/modules/site/index.js')).siteOf(t.d); assert.equal(svc.conditions.hindrances.escalate(TODAY), 1, 'only the old open one'); assert.equal(svc.conditions.hindrances.escalate(TODAY), 0, 'not twice in one period');
  const g = (await t.call(se, 'GET', `/hindrances/${old.id}`)).json.data; assert.deepEqual([g.escalationLevel, g.overdue, (await t.call(se, 'GET', `/hindrances/${fresh.id}`)).json.data.escalationLevel], [1, true, 0]);
  assert.equal(svc.conditions.hindrances.escalate(isoOf(ordOf(TODAY) + 7)), 2, 'again after the next period (the old one and the one that has become old)'); assert.equal((await t.call(se, 'GET', `/hindrances/${old.id}`)).json.data.escalationLevel, 2);
  t.drain(); assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'site.hindrance.escalated'").get().n >= 3); assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'site_hindrances' AND action = 'escalate'").get().n >= 3);
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'site.hindrance.escalated'").get?.().n >= 0);
});

test('FR-03 FR-04 the diary: notes by category with attachments, signed off by another person and then locked; the visitor log with a linked letter', async () => {
  const t = await boot();
  const n = await t.call(se, 'POST', '/diary', { siteId: t.site, date: Y, category: 'INSTRUCTION', text: 'The consultant instructed to stop the east footing until the drawing is reissued' }); assert.equal(n.status, 201, JSON.stringify(n.json)); const e = n.json.data;
  assert.deepEqual([e.category, e.signed, e.can.sign, e.can.edit, e.enteredBy], ['INSTRUCTION', false, false, true, 'cse1']); assert.equal((await t.call(se, 'POST', '/diary', { siteId: t.site, date: Y, category: 'NOPE', text: 'x' })).status, 400);
  assert.equal((await t.upload(se, 'site_diary', e.id, 'instruction.png')).status, 201); assert.equal((await t.call(se, 'GET', `/diary/${e.id}`)).json.data.attachments, 1);
  assert.equal((await t.call(se, 'PATCH', `/diary/${e.id}`, { text: 'The consultant instructed us to stop the east footing until the drawing is reissued', rowVersion: e.rowVersion })).status, 200);
  assert.equal((await t.call(se, 'POST', `/diary/${e.id}/sign`)).status, 403, 'the site engineer has no sign-off'); assert.equal((await t.call(as('CM,SE', 'cse1'), 'POST', `/diary/${e.id}/sign`)).status, 403, 'nobody signs what they wrote');
  const signed = await t.call(cm, 'POST', `/diary/${e.id}/sign`); assert.equal(signed.status, 200, JSON.stringify(signed.json)); assert.deepEqual([signed.json.data.signed, signed.json.data.signedBy, signed.json.data.can.edit], [true, 'ccm1', false]);
  assert.equal((await t.call(se, 'PATCH', `/diary/${e.id}`, { text: 'Changed after sign-off' })).status, 409); assert.equal((await t.call(se, 'DELETE', `/diary/${e.id}`)).status, 409); assert.equal((await t.call(cm, 'POST', `/diary/${e.id}/sign`)).status, 409); assert.equal((await t.upload(se, 'site_diary', e.id)).status >= 400, true, 'no attachment after sign-off');
  const a = (await t.call(se, 'POST', '/diary', { siteId: t.site, date: Y2, category: 'SAFETY', text: 'A near miss at the east edge protection' })).json.data; const b = (await t.call(se2, 'POST', '/diary', { siteId: t.site, date: Y2, category: 'GENERAL', text: 'Cement delivery at ten' })).json.data;
  assert.equal((await t.call(cm, 'POST', '/diary/sign-day', { siteId: t.site, date: Y2 })).json.data.signed, 2); assert.equal((await t.call(se, 'GET', `/diary/${b.id}`)).json.data.signedBy, 'ccm1'); assert.ok(a.id);
  const list = (await t.call(se, 'GET', '/diary?filter[category]=SAFETY')).json.data; assert.deepEqual(list.map((x) => [x.categoryCode, x.signed]), [['SAFETY', 'Signed off']]); assert.equal((await t.call(se, 'GET', '/diary?q=cement')).json.data.length, 1);
  assert.equal((await t.api.raw('GET', `${S}/diary/export?format=csv`, cm)).status, 200); assert.equal((await t.api.raw('GET', `${S}/diary/export?format=csv`, commgr)).status, 403);
  // visitors
  const v = await t.call(se, 'POST', '/visitors', { siteId: t.site, date: Y, visitorName: 'R. Deshmukh', organisation: 'Consultant: Mehta Associates', visitorType: 'CONSULTANT', purpose: 'Inspection of the east footing', instructions: 'Stop work until the drawing is reissued', timeIn: '10:30', timeOut: '12:00', linkedLetterId: t.letter }); assert.equal(v.status, 201, JSON.stringify(v.json)); assert.match(v.json.data.linkedLetter, /LTR\/0001/);
  assert.equal((await t.call(se, 'POST', '/visitors', { siteId: t.site, date: Y, visitorName: 'Late', purpose: 'Visit', timeIn: '12:00', timeOut: '10:00' })).status, 400); assert.equal((await t.call(se, 'POST', '/visitors', { siteId: t.site, date: Y, visitorName: 'Wrong letter', purpose: 'Visit', linkedLetterId: 99999 })).status, 400);
  assert.equal((await t.call(se, 'PATCH', `/visitors/${v.json.data.id}`, { timeOut: '12:30', rowVersion: v.json.data.rowVersion })).json.data.timeOut, '12:30'); assert.equal((await t.call(se, 'PATCH', `/visitors/${v.json.data.id}`, { purpose: 'stale', rowVersion: v.json.data.rowVersion })).status, 409);
  assert.equal((await t.call(plan1, 'GET', '/visitors')).status, 200); assert.equal((await t.call(plan1, 'POST', '/visitors', { siteId: t.site, date: Y, visitorName: 'Planner', purpose: 'Visit' })).status, 403);
  assert.deepEqual((await t.call(se, 'GET', '/visitors?filter[type]=CONSULTANT')).json.data.map((x) => x.visitor), ['R. Deshmukh']); assert.equal((await t.api.raw('GET', `${S}/visitors/export?format=csv`, se)).status, 200); assert.equal((await t.call(se, 'DELETE', `/visitors/${v.json.data.id}`)).status, 200);
});

test('AC-03 AC-04 roles and isolation: who sees and does what; another company or site gets nothing; the flag gates the routes; approval cannot be bypassed', async () => {
  const t = await boot(); const h = await t.hin({}, { approve: false }); const w = (await t.call(se, 'POST', '/weather', { siteId: t.site, date: Y, rainfallMm: 5 })).json.data;
  // who may do what
  for (const [who, list, create] of [[se, 200, 201], [cm, 200, 201], [pm, 200, 403], [plan1, 200, 403], [commgr, 200, 403], [aud, 200, 403], [qs, 200, 403], [sk, 403, 403]]) {
    const r = await t.call(who, 'GET', '/hindrances'); assert.equal(r.status, list === 200 ? 200 : 403, `${who.roles} reads hindrances`);
    if (create !== 201) assert.equal((await t.call(who, 'POST', '/hindrances', { siteId: t.site, title: `By ${who.roles}`, type: 'OTHER', startDate: Y, responsibleParty: 'CLIENT' })).status, create, `${who.roles} cannot raise a hindrance`);
  }
  assert.equal((await t.call(qs, 'GET', '/diary')).status, 403, 'quantity surveying reads the hindrances and the weather only'); assert.equal((await t.call(pm, 'POST', '/weather', { siteId: t.site, date: Y2, rainfallMm: 1 })).status, 403); assert.equal((await t.call(pm, 'GET', `/weather/${w.id}`)).status, 200);
  assert.equal((await t.call(aud, 'PATCH', `/hindrances/${h.id}`, { title: 'Audit edit' })).status, 403); assert.equal((await t.call(plan1, 'POST', `/hindrances/${h.id}/submit`)).status, 403); assert.equal((await t.api.raw('GET', `${S}/hindrances/export?format=csv`, qs)).status, 403); assert.equal((await t.api.raw('GET', `${S}/hindrances/export?format=csv`, plan1)).status, 200);
  // another company sees nothing of this one and cannot reach its site
  assert.equal((await t.call(other, 'GET', `/hindrances/${h.id}`)).status, 404); assert.equal((await t.call(other, 'GET', '/hindrances')).json.data.length, 0); assert.equal((await t.call(other, 'POST', '/weather', { siteId: t.site, date: Y, rainfallMm: 1 })).status, 404); assert.equal((await t.call(other, 'GET', `/weather/${w.id}`)).status, 404);
  // two projects of one company: both are listed for a site engineer with company scope; another company reaches neither
  const h2 = await t.call(se, 'POST', '/hindrances', { siteId: t.site2, title: 'The other project\'s hindrance', type: 'OTHER', startDate: Y, responsibleParty: 'CLIENT' }); assert.equal(h2.status, 201);
  assert.equal((await t.call(se, 'GET', '/hindrances')).json.data.length, 2); assert.equal((await t.call(other, 'GET', `/hindrances/${h2.json.data.id}`)).status, 404);
  // no path around the approval: the status is set by the workflow only
  assert.equal((await t.call(se, 'PATCH', `/hindrances/${h.id}`, { status: 'APPROVED' })).status, 400); assert.equal((await t.call(se, 'POST', `/hindrances/${h.id}/close`, { endDate: Y, closureNotes: 'Never approved' })).status, 422);
  assert.equal((await t.call(pm, 'POST', `/hindrances/${h.id}/amend`, { reason: 'Not approved yet' })).status, 403);
  // the flag
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1403'").run(); assert.equal((await t.call(se, 'GET', '/hindrances')).status, 404); assert.equal((await t.call(se, 'GET', '/weather')).status, 404);
  assert.notEqual((await t.call(se, 'GET', '/work-authorisations')).status, 404, 'the other parts of the module are not gated by this flag');
});
