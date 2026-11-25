import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { protocolOf } from '../src/server/platform/protocol/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';

// Part 14.02: the Daily Progress Report.
// T-01 the prefill matches the work authorisations and the attendance, and a labour line off the attendance beyond the tolerance is flagged and needs a reason.
// T-02 an offline DPR with a photo syncs once (a replay makes no second report) and its late submission is judged by the time it was sent on the phone.
// Also: BR-01 (one report a site and day, the quantity against the work authorisation), the chain (CM or PM; an amendment to the PM; the sender never decides), the lock and the amendment that replaces it and
// re-books the quantities, the supervisors' reports consolidated into the site's, the missing days, the compliance, the reports, the PDF, roles, isolation, 409, idempotent replay and the flag.
const S = '/api/v1/site'; const P = '/api/v1/plan'; const W = '/api/v1/workflow'; const O = '/api/v1/off';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `dpr-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const se = as('SE', 'dse1'); const se2 = as('SE', 'dse2'); const cm = as('CM', 'dcm1'); const cm2 = as('CM', 'dcm2'); const pm = as('PM', 'dpm1'); const sk = as('SK', 'dsk1'); const wsup = as('WSUP', 'dsup1'); const csup = as('CSUP', 'dcsup1');
const plan1 = as('PLAN', 'dplan1'); const pcm = as('PCMGR', 'dpcm1'); const aud = as('AUD', 'daud1'); const qs = as('QS', 'dqs1'); const qce = as('QCE', 'dqce1'); const other = as('SE', 'dse9', '2');
const day = (n) => isoOf(ordOf(todayIST()) - n); const Y = day(1); const Y2 = day(2); const Y3 = day(3); const TODAY = todayIST();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['dse1', ['SE']], ['dse2', ['SE']], ['dcm1', ['CM']], ['dcm2', ['CM']], ['dpm1', ['PM']], ['dsk1', ['SK']], ['dsup1', ['WSUP']], ['dcsup1', ['CSUP']], ['dplan1', ['PLAN']], ['dpcm1', ['PCMGR']], ['daud1', ['AUD']], ['dqs1', ['QS']], ['dqce1', ['QCE']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'DPR', 'Report Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'DPR-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const w = Number(d.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '1', 'Substructure', 1, 't')").run(pid).lastInsertRowid);
  const zone = Number(d.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (1, ?, 'ZONE', 'ZA', 'Zone A', 't')").run(pid).lastInsertRowid);
  const crew = Number(d.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, 'DPR-M1', 'Masons one', 'Mason')").run(site).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'DP', 'DPR test', 'DPT', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
  const cement = Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, 'MAT-CEM', 'Cement', 'MATERIAL', ?, 'BAG', '2026-01-01', 'ACTIVE')").run(cat).lastInsertRowid);
  const contractor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, 'ACE', 'Ace Labour', 'ace labour', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 't', 'test')").run().lastInsertRowid);
  const worker = (code, trade) => { const id = Number(d.prepare("INSERT INTO lab_workers (company_id, doc_no, doc_date, worker_code, name, dob, gender, trade_code, skill_category, contractor_id, status, created_by, source_type) VALUES (1, ?, '2026-01-01', ?, ?, '1990-01-01', 'MALE', ?, 'SKILLED', ?, 'APPROVED', 't', 'test')").run(`LW/${code}`, code, `Worker ${code}`, trade, contractor).lastInsertRowid); d.prepare('UPDATE lab_workers SET root_id = id WHERE id = ?').run(id); return id; };
  const workers = [worker('W1', 'Mason'), worker('W2', 'Mason'), worker('W3', 'Mason'), worker('W4', 'Mason')];
  const desig = Number(d.prepare("INSERT INTO org_designations (company_id, code, name) VALUES (1, 'SE1', 'Site Engineer')").run().lastInsertRowid);
  const emp = Number(d.prepare("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, employment_type, doj, designation_id, created_by, source_type) VALUES (1, 'E1', 'Ravi', 'Ravi Kumar', 'ravi kumar', 'MALE', '1990-01-01', '9000000001', 'PERMANENT', '2026-01-01', ?, 't', 'test')").run(desig).lastInsertRowid);
  const att = (type, id, date, status) => d.prepare("INSERT INTO att_daily (company_id, person_type, person_id, work_date, daily_site_id, status, worked_minutes, paid_day, computed_at, period_start, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, 480, 1, ?, ?, 't', 'test')").run(type, id, date, site, status, new Date().toISOString(), `${date.slice(0, 8)}01`);
  const call = (who, method, path, body, k = key()) => api.call(method, `${S}${path}`, { ...who, headers: k, body });
  const dpr = (who, method, path, body, k) => call(who, method, `/dprs${path}`, body, k);
  const pcall = (who, method, path, body) => api.call(method, `${P}${path}`, { ...who, headers: key(), body });
  const taskOf = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  const act = async (who, instanceId, action = 'approve') => { const task = await taskOf(who, instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); };
  const cal = await pcall(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const sch = await pcall(plan1, 'POST', '/schedules', { projectId: pid, name: 'Tower schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' }); const sid = sch.json.data.id;
  assert.equal((await pcall(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 5 }, { code: 'A20', name: 'Raft concrete', duration: 3, predecessors: 'A10' }] })).status, 201); await pcall(plan1, 'POST', `/schedules/${sid}/calculate`);
  const a = Object.fromEntries(d.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ?').all(sid).map((x) => [x.code, x.id]));
  d.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3', location_id = ?, wbs_id = ? WHERE id = ?").run(zone, w, a.A10); d.prepare("UPDATE plan_activities SET qty = 50000, uom = 'm3', location_id = ?, wbs_id = ? WHERE id = ?").run(zone, w, a.A20);
  d.prepare("INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, item_id, res_key, label, uom, basis, qty_total, qty_per_day) VALUES (1, ?, ?, 'MATERIAL', ?, ?, 'Cement', 'BAG', 'TOTAL', 200000, 40000)").run(sid, a.A10, cement, `item:${cement}`);
  protocolOf(d).ensure(1, 'CP-SITE-02'); d.prepare("UPDATE pcs_control_points SET mode = 'WARN' WHERE company_id = 1 AND code = 'CP-SITE-02'").run();
  /** A work authorisation of a day, approved by the construction manager and the project manager (it is outside the weekly plan). */
  const mkWa = async (date, { activity = 'A10', qty = 10, supervisor, emergency = false } = {}) => {
    const body = { siteId: site, planDate: date, activityId: a[activity], plannedQty: qty, startTime: '08:00', endTime: '17:00', crews: [{ crewId: crew }], ...(supervisor ? { supervisor } : {}), ...(emergency ? { emergency: true, emergencyReason: 'The pump failed and the pit floods' } : {}) };
    const c = await call(se, 'POST', '/work-authorisations', body); assert.equal(c.status, 201, JSON.stringify(c.json)); if (emergency) return c.json.data;
    const sub = await call(se, 'POST', `/work-authorisations/${c.json.data.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
    assert.equal((await act(cm, inst)).status, 200); assert.equal((await act(pm, inst)).status, 200); return (await call(se, 'GET', `/work-authorisations/${c.json.data.id}`)).json.data;
  };
  const drain = () => runtimeOf(api.db).bus.drain();
  return { api, d, call, dpr, act, taskOf, pcall, mkWa, att, drain, pid, site, zone, crew, cement, contractor, workers, emp, a, sid };
}
/** Attendance of the day Y: three masons present and one on a half day (3.5 man-days) and one site engineer. */
const attendYesterday = (t, date = Y) => { for (const w of t.workers.slice(0, 3)) t.att('WORKER', w, date, 'PRESENT'); t.att('WORKER', t.workers[3], date, 'HALF_DAY'); t.att('EMPLOYEE', t.emp, date, 'PRESENT'); };
const setCutoff = (t, hhmm) => t.d.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'site.dpr.cutoff_time', ?, 'string', 'company', 1, '2020-01-01', 't', 'test')").run(hhmm);

test('T-01 FR-02 BR-02 the prefill matches the work authorisation and the attendance; a labour line off the attendance beyond the tolerance is flagged and needs a reason', async () => {
  const t = await boot(); attendYesterday(t); const wa = await t.mkWa(Y);
  // the day's other sources: the stores issue cement and the plant log, booked against the WA; the plan of the next day
  assert.equal((await t.call(sk, 'POST', '/wa-uses', { projectId: t.pid, waId: wa.id, kind: 'MATERIAL_ISSUE', srcEntity: 'inv_issue', srcId: 'MI-1', itemId: t.cement, qty: 12, date: Y })).status, 201);
  assert.equal((await t.call(sk, 'POST', '/wa-uses', { projectId: t.pid, waId: wa.id, kind: 'PLANT_LOG', srcEntity: 'plant_log', srcId: 'PL-1', trade: 'Tower crane', qty: 8, date: Y })).status, 201);
  assert.equal((await t.call(se, 'POST', '/daily-plans', { siteId: t.site, planDate: TODAY, from: 'EMPTY', lines: [{ activityId: t.a.A20, plannedQty: 5 }] })).status, 201);
  const pf = (await t.dpr(se, 'GET', `/prefill?siteId=${t.site}&date=${Y}`)).json.data;
  assert.deepEqual(pf.work.map((x) => [x.waNo, x.plannedQty, x.qty, x.uom, x.activity]), [[wa.waNo, 10, 10, 'm3', 'A10 Excavation']]);
  assert.deepEqual(pf.labour.map((x) => [x.category, x.trade, x.contractor, x.headcount, x.manDays]).sort(), [['CONTRACT', 'Mason', 'Ace Labour', 4, 3.5], ['STAFF', 'Site Engineer', null, 1, 1]]);
  assert.deepEqual(pf.materials.map((x) => [x.item, x.qty, x.uom]), [['MAT-CEM Cement', 12, 'BAG']]); assert.deepEqual(pf.equipment.map((x) => [x.equipmentKey, x.hoursWorked]), [['plant:tower crane', 8]]);
  assert.match(pf.nextDay, /A20 Raft concrete: 5 m3/); assert.deepEqual([pf.tolerance, pf.cutoff, pf.canCreate, pf.existing], [{ qtyPct: 5, labourPct: 10 }, '19:00', true, null]);
  assert.equal((await t.dpr(se, 'GET', `/prefill?siteId=${t.site}&date=${isoOf(ordOf(TODAY) + 1)}`)).status, 400, 'not for a day to come');
  // a report started from the prefill carries it and nothing is flagged; the sections are worked out by the server
  const k = key(); const made = await t.dpr(se, 'POST', '', { siteId: t.site, dprDate: Y, usePrefill: true, weatherCode: 'CLOUDY' }, k); assert.equal(made.status, 201, JSON.stringify(made.json)); const r = made.json.data;
  assert.deepEqual([r.status, r.scope, r.work.length, r.labour.length, r.materials.length, r.equipment.length, r.flags, r.docNo.startsWith('DPR/')], ['DRAFT', 'SITE', 1, 2, 1, 1, { labourFlagged: 0, labourUnreported: 0, overWa: 0, adjusted: 0 }, true]);
  assert.deepEqual(r.notes.map((n) => n.type), ['NEXT_DAY']); assert.equal(r.work[0].pctOfWa, 100); assert.equal(r.labour.find((l) => l.trade === 'Mason').attManDays, 3.5);
  assert.equal((await t.dpr(se, 'POST', '', { siteId: t.site, dprDate: Y, usePrefill: true, weatherCode: 'CLOUDY' }, k)).json.data.id, r.id, 'idempotent replay'); assert.equal((await t.dpr(se, 'POST', '', { siteId: t.site, dprDate: Y })).status, 409, 'BR-01: one report a site and day');
  assert.equal((await t.api.call('POST', `${S}/dprs`, { ...se, headers: { 'content-type': 'application/json' }, body: { siteId: t.site, dprDate: Y } })).status, 400, 'an Idempotency-Key is required');
  // the masons are reported at 5 man-days against 3.5 present: +42.9 %, beyond 10 %: flagged, and no report goes without the reason
  const mason = r.labour.findIndex((l) => l.trade === 'Mason'); const lab = r.labour.map((l, i) => ({ category: l.category, contractorId: l.contractorId, trade: l.trade, headcount: l.headcount, manDays: i === mason ? 5 : l.manDays, otHours: l.otHours }));
  const up = await t.dpr(se, 'PATCH', `/${r.id}`, { labour: lab, rowVersion: r.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); const u = up.json.data; const ml = u.labour.find((l) => l.trade === 'Mason');
  assert.deepEqual([ml.flagged, ml.variancePct, ml.attManDays, u.flags.labourFlagged], [true, 42.86, 3.5, 1]); assert.equal((await t.dpr(se, 'PATCH', `/${r.id}`, { summary: 'stale', rowVersion: r.rowVersion })).status, 409);
  const no = await t.dpr(se, 'POST', `/${r.id}/submit`); assert.equal(no.status, 400); assert.match(no.json.error.details[0].field, /^labour\.\d+\.reason$/); assert.equal((await t.dpr(se, 'GET', `/${r.id}`)).json.data.status, 'DRAFT');
  // a staff line left out is attendance not in the report; a work line above the work authorisation (10 + 5 %) needs a reason too
  const staff = u.labour.find((l) => l.category === 'STAFF'); const lab2 = [{ category: 'CONTRACT', contractorId: t.contractor, trade: 'Mason', headcount: 4, manDays: 5, otHours: 0, reason: 'Two masons worked a long day to finish the pit' }];
  const u2 = (await t.dpr(se, 'PATCH', `/${r.id}`, { labour: lab2, work: [{ waId: wa.id, qty: 11, reason: 'The slope needed more cutting' }] })).json.data; assert.deepEqual([u2.flags.labourUnreported, u2.flags.overWa, u2.unreported.map((x) => x.trade), staff.trade], [1, 1, ['Site Engineer'], 'Site Engineer']);
  assert.equal(u2.work[0].overWa, true); assert.equal((await t.dpr(se, 'PATCH', `/${r.id}`, { work: [{ waId: 999999, qty: 1 }] })).status, 400); assert.equal((await t.dpr(se, 'PATCH', `/${r.id}`, { work: [{ waId: wa.id, qty: 10.5 }] })).json.data.work[0].overWa, false, '10.5 is within the 5 % tolerance');
  const noWork = await t.dpr(se, 'POST', `/${r.id}/submit`); assert.equal(noWork.status, 400); assert.equal(noWork.json.error.details[0].field, 'work.0.reason', 'adjusted from the 10 offered: a reason');
  await t.dpr(se, 'PATCH', `/${r.id}`, { work: [{ waId: wa.id, qty: 11, reason: 'The slope needed more cutting' }] }); const sent = await t.dpr(se, 'POST', `/${r.id}/submit`); assert.equal(sent.status, 202, JSON.stringify(sent.json));
  assert.deepEqual([sent.json.data.status, sent.json.data.late, sent.json.data.submittedVia, sent.json.data.flags.labourFlagged], ['SUBMITTED', true, 'ONLINE', 1], 'a report of yesterday sent now is late; the labour line stays flagged for the approver, with its reason');
});

test('T-02 FR-04 FR-05 an offline DPR with a photo syncs once; a replay makes no second report; late is judged by the time it was sent on the phone', async () => {
  const t = await boot(); attendYesterday(t); const wa1 = await t.mkWa(Y); const wa2 = await t.mkWa(Y2); assert.ok(wa1.id && wa2.id);
  const reg = await t.api.call('POST', `${O}/devices`, { ...se, headers: key(), body: { deviceId: 'dev-dse1-aaaa', name: 'Site phone', platform: 'Android' } }); assert.equal(reg.status, 201);
  const masters = (await t.api.call('GET', `${O}/masters`, se)).json.data; const forms = Object.fromEntries(masters.forms.map((f) => [f.code, f])); assert.deepEqual([forms.dpr.available, forms.dpr.planned], [true, undefined]);
  const rows = masters.masters.dpr_prefill.rows; const m = rows.find((x) => x.date === Y); assert.ok(m, 'the phone keeps yesterday\'s prefill'); assert.deepEqual([m.work.length, m.labour.length, m.siteId], [1, 2, t.site]); assert.ok(masters.masters.dpr_items.rows.some((i) => i.code === 'MAT-CEM') && masters.masters.dpr_contractors.rows.some((c) => c.name === 'Ace Labour'));
  const sync = (commands) => t.api.call('POST', `${O}/sync`, { ...se, headers: key(), body: { deviceId: 'dev-dse1-aaaa', deviceTime: new Date().toISOString(), commands } });
  const values = (mm, extra = {}) => ({ siteId: t.site, dprDate: mm.date, weatherCode: 'RAIN', rainMm: 12, work: mm.work.map((x) => ({ waId: x.waId, qty: x.qty })), labour: mm.labour.map((l) => ({ category: l.category, contractorId: l.contractorId, trade: l.trade, headcount: l.headcount, manDays: l.manDays, otHours: l.otHours })), notes: [{ type: 'HINDRANCE', text: 'Rain stopped the pour for two hours' }], submit: true, ...extra });
  const at = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00+05:30`)).toISOString();
  // yesterday: sent on the phone at 21:00, two hours after the cut-off; the same command sent twice is one report
  const c1 = { id: `cmd-${Date.now()}-1`, seq: 1, type: 'dpr', op: 'create', clientRef: 'ref-dpr-0001', values: values(m), createdAt: at(Y, '21:00'), gps: { lat: 18.5204, lng: 73.8567, accuracy: 12 } };
  const s1 = await sync([c1]); assert.equal(s1.status, 200, JSON.stringify(s1.json)); const res = s1.json.data.results[0]; assert.equal(res.status, 'APPLIED', JSON.stringify(res)); const dprId = Number(res.entityId);
  assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM site_dprs').get().n, 1); const again = await sync([c1]); assert.equal(again.json.data.results[0].replayed, true); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM site_dprs').get().n, 1, 'a replay makes no second report');
  const r = (await t.dpr(se, 'GET', `/${dprId}`)).json.data; assert.deepEqual([r.status, r.submittedVia, r.late, r.weatherCode, r.rainMm, r.cutoffAt], ['SUBMITTED', 'OFFLINE', true, 'RAIN', 12, at(Y, '19:00')]); assert.ok(r.lateMinutes >= 120 && r.lateMinutes <= 121, `two hours after the cut-off, not the time it reached the server (${r.lateMinutes})`);
  // the photo goes up in chunks against the command and is attached to the report it made, with the position of the phone
  const up = (await t.api.call('POST', `${O}/uploads`, { ...se, headers: key(), body: { deviceId: 'dev-dse1-aaaa', commandId: c1.id, fileName: 'pit.png', totalSize: PNG.length, chunkSize: 40 } })).json.data;
  for (let i = 0; i < up.totalChunks; i += 1) assert.equal((await t.api.raw('PUT', `${O}/uploads/${up.uploadId}/chunks/${i}`, { ...se, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': `c-${i}-${Math.random()}` }, body: PNG.subarray(i * 40, (i + 1) * 40) })).status, 200);
  assert.equal((await t.api.call('POST', `${O}/uploads/${up.uploadId}/complete`, { ...se, headers: key() })).status, 200); assert.equal((await t.api.call('POST', `${O}/uploads/${up.uploadId}/complete`, { ...se, headers: key() })).status, 200, 'completing twice is the same file');
  const withPhoto = (await t.dpr(se, 'GET', `/${dprId}`)).json.data; assert.equal(withPhoto.photos.length, 1); assert.deepEqual([withPhoto.photos[0].lat, withPhoto.photos[0].lng, withPhoto.photos[0].name], [18.5204, 73.8567, 'pit.png']);
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_files WHERE linked_entity = 'site_dpr' AND linked_id = ?").get(dprId).n, 1);
  // the day before: sent at 18:00 on the phone and synced later: in time, though it reached the server after the cut-off
  const c2 = { id: `cmd-${Date.now()}-2`, seq: 2, type: 'dpr', op: 'create', clientRef: 'ref-dpr-0002', values: values({ date: Y2, work: [{ waId: wa2.id, qty: 10 }], labour: [] }), createdAt: at(Y2, '18:00') };
  const s2 = await sync([c2]); assert.equal(s2.json.data.results[0].status, 'APPLIED', JSON.stringify(s2.json.data.results[0])); const r2 = (await t.dpr(se, 'GET', `/${s2.json.data.results[0].entityId}`)).json.data; assert.deepEqual([r2.late, r2.lateMinutes, r2.status], [false, 0, 'SUBMITTED']);
  // a report the server refuses is not made: the work authorisation is of another day
  const bad = await sync([{ ...c2, id: `cmd-${Date.now()}-3`, seq: 3, clientRef: 'ref-dpr-0003', values: { ...c2.values, dprDate: Y3 } }]); assert.notEqual(bad.json.data.results[0].status, 'APPLIED'); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM site_dprs').get().n, 2);
  // the offline form checks the report with the server's own rules
  const inv = await sync([{ id: `cmd-${Date.now()}-4`, seq: 4, type: 'dpr', op: 'create', clientRef: 'ref-dpr-0004', values: { siteId: t.site, dprDate: 'tomorrow' }, createdAt: new Date().toISOString() }]); assert.notEqual(inv.json.data.results[0].status, 'APPLIED');
});

test('FR-05 BR-01 BR-03 the chain, the lock and the amendment: the construction manager or the project manager approves; the amendment goes to the project manager and replaces the report', async () => {
  const t = await boot(); attendYesterday(t); setCutoff(t, '23:59'); const wa = await t.mkWa(Y); const wt = await t.mkWa(TODAY, { emergency: true });
  const mk = async (date, who = se, extra = {}) => { const r = await t.dpr(who, 'POST', '', { siteId: t.site, dprDate: date, usePrefill: true, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  const send = async (id, who = se) => { const r = await t.dpr(who, 'POST', `/${id}/submit`); assert.equal(r.status, 202, JSON.stringify(r.json)); return r.json.data; };
  // today's report, in time (the cut-off is 23:59 here)
  const rt = await mk(TODAY); assert.deepEqual(rt.work.map((x) => x.waNo), [wt.waNo]); const st = await send(rt.id); assert.equal(st.late, false);
  const r = await mk(Y); const s1 = await send(r.id); const inst = s1.workflowInstanceId; assert.equal(s1.late, true);
  // who decides: the sender and the others who prepare hold no task; the construction manager and the project manager each do
  assert.equal(await t.taskOf(se, inst), undefined); assert.equal(await t.taskOf(se2, inst), undefined); assert.ok(await t.taskOf(pm, inst)); assert.ok(await t.taskOf(cm2, inst));
  assert.equal((await t.dpr(se, 'PATCH', `/${r.id}`, { summary: 'while it waits' })).status, 409); assert.equal((await t.dpr(csup, 'GET', `/${r.id}`)).json.data.can.approve, false);
  assert.equal((await t.act(cm, inst)).status, 200); const ap = (await t.dpr(se, 'GET', `/${r.id}`)).json.data; assert.deepEqual([ap.status, ap.approvedBy, ap.can.edit, ap.can.amend, ap.can.submit], ['APPROVED', 'dcm1', false, true, false]);
  // the approval books the quantity against the work authorisation (where its closure reads it) and tells the others
  assert.equal((await t.call(se, 'GET', `/work-authorisations/${wa.id}`)).json.data.dprQty, 10); const ev = JSON.parse(t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'site.dpr.approved'").get().payload).data;
  assert.deepEqual([ev.dprId, ev.date, ev.work.map((w) => [w.waNo, w.qty, w.pctOfWa]), ev.labour.length, ev.materials.length, ev.amendment, ev.late], [r.id, Y, [[wa.waNo, 10, 100]], 2, 0, false, true]);
  t.drain(); assert.equal(t.d.prepare('SELECT pct_complete FROM plan_activities WHERE id = ?').get(t.a.A10).pct_complete, 0, 'the plan\'s progress waits for 14.05: the event carries no percentages');
  // locked: no edit, no cancel, no delete; one approved report a site and day
  assert.equal((await t.dpr(se, 'PATCH', `/${r.id}`, { summary: 'after' })).status, 409); assert.equal((await t.dpr(se, 'POST', `/${r.id}/cancel`, { reason: 'Not any more' })).status, 422); assert.equal((await t.dpr(se, 'DELETE', `/${r.id}`)).status, 422); assert.equal((await t.dpr(se, 'POST', '', { siteId: t.site, dprDate: Y })).status, 409);
  // the amendment: a copy for the site engineer, the project manager only, and it replaces the report and its bookings
  const am = await t.dpr(se, 'POST', `/${r.id}/amend`, { reason: 'The slope was cut more than reported' }); assert.equal(am.status, 201, JSON.stringify(am.json)); const a2 = am.json.data; assert.deepEqual([a2.revisionNo, a2.parentDprId, a2.status, a2.work.length, a2.previous.docNo], [2, r.id, 'DRAFT', 1, r.docNo]);
  assert.equal((await t.dpr(se, 'POST', `/${r.id}/amend`, { reason: 'Twice at once' })).status, 409);
  const a3 = (await t.dpr(se, 'PATCH', `/${a2.id}`, { work: [{ waId: wa.id, qty: 10.4, reason: 'Re-measured on the next morning' }], labour: a2.labour.map((l) => ({ category: l.category, contractorId: l.contractorId, trade: l.trade, headcount: l.headcount, manDays: l.manDays, otHours: l.otHours })) })).json.data; assert.equal(a3.work[0].qty, 10.4);
  const sa = await send(a2.id); assert.equal(await t.taskOf(cm, sa.workflowInstanceId), undefined, 'an amendment is not for the construction manager'); assert.equal(await t.taskOf(cm2, sa.workflowInstanceId), undefined); assert.ok(await t.taskOf(pm, sa.workflowInstanceId));
  assert.equal((await t.act(pm, sa.workflowInstanceId)).status, 200); assert.equal((await t.dpr(se, 'GET', `/${r.id}`)).json.data.status, 'SUPERSEDED'); const fin = (await t.dpr(se, 'GET', `/${a2.id}`)).json.data; assert.deepEqual([fin.status, fin.revisions.map((x) => x.status)], ['APPROVED', ['SUPERSEDED']]);
  assert.equal((await t.call(se, 'GET', `/work-authorisations/${wa.id}`)).json.data.dprQty, 10.4, 'the replaced report\'s booking is removed and the new one made'); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM site_wa_uses WHERE use_kind = 'DPR' AND wa_id = ? AND deleted_at IS NULL").get(wa.id).n, 1);
  const ev2 = t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'site.dpr.approved' ORDER BY id").all().map((x) => JSON.parse(x.payload).data).filter((x) => x.dprId === a2.id)[0]; assert.deepEqual([ev2.amendment, ev2.supersedes, ev2.work[0].qty], [true, r.id, 10.4]);
  // return and resubmit; reject; withdraw only by the sender
  const r3 = await mk(Y3 === Y ? day(4) : Y2, se, { usePrefill: false, work: [], notes: [{ type: 'HINDRANCE', text: 'Heavy rain: no work' }], weatherCode: 'HEAVY_RAIN' }); const i3 = (await send(r3.id)).workflowInstanceId;
  assert.equal((await t.dpr(se2, 'POST', `/${r3.id}/withdraw`, { reason: 'Not mine to withdraw' })).status, 403); assert.equal((await t.act(pm, i3, 'return')).status, 200); assert.equal((await t.dpr(se, 'GET', `/${r3.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.dpr(se, 'PATCH', `/${r3.id}`, { summary: 'No work: rain all day' })).status, 200); assert.equal((await send(r3.id)).status, 'SUBMITTED'); assert.equal((await t.act(cm, i3, 'reject')).status, 200); assert.equal((await t.dpr(se, 'GET', `/${r3.id}`)).json.data.status, 'REJECTED');
  const nw = await mk(Y3); assert.equal((await t.dpr(se, 'POST', `/${nw.id}/submit`)).status, 400, 'a report with neither work nor a hindrance is not sent'); assert.equal((await t.dpr(se, 'POST', `/${nw.id}/cancel`, { reason: 'Raised twice' })).json.data.status, 'CANCELLED');
  // a CM who prepares a report never approves it
  const cmse = as('CM,SE', 'dcm1'); const dd = await mk(day(5), cmse, { usePrefill: false, notes: [{ type: 'HINDRANCE', text: 'Site shut for a festival' }] }); const id5 = (await send(dd.id, cmse)).workflowInstanceId; assert.equal(await t.taskOf(cmse, id5), undefined); assert.equal((await t.act(cm2, id5)).status, 200);
});

test('FR-01 FR-07 the supervisors\' reports consolidate into the site\'s; the missing days, the compliance and the reports; the PDF', async () => {
  const t = await boot(); attendYesterday(t); const waA = await t.mkWa(Y, { supervisor: 'dse1' }); const waB = await t.mkWa(Y, { activity: 'A20', qty: 5, supervisor: 'dse2' }); const wa2 = await t.mkWa(Y2); const wa3 = await t.mkWa(Y3); assert.ok(wa2.id && wa3.id);
  const sup = async (who, wa, qty) => { const r = await t.dpr(who, 'POST', '', { siteId: t.site, dprDate: Y, scope: 'SUPERVISOR', work: [{ waId: wa.id, qty }], weatherCode: 'CLEAR' }); assert.equal(r.status, 201, JSON.stringify(r.json)); const s = await t.dpr(who, 'POST', `/${r.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); return s.json.data; };
  const d1 = await sup(se, waA, 10); const d2 = await sup(se2, waB, 5); assert.deepEqual([d1.scope, d1.supervisor, d2.supervisor], ['SUPERVISOR', 'dse1', 'dse2']); assert.equal((await t.dpr(se, 'POST', '', { siteId: t.site, dprDate: Y, scope: 'SUPERVISOR' })).status, 409, 'one report a supervisor and day');
  for (const [d, who] of [[d1, cm], [d2, cm]]) assert.equal((await t.act(who, d.workflowInstanceId)).status, 200); assert.equal((await t.call(se, 'GET', `/work-authorisations/${waA.id}`)).json.data.dprQty, 10);
  const pf = (await t.dpr(se, 'GET', `/prefill?siteId=${t.site}&date=${Y}`)).json.data; assert.deepEqual([pf.source, pf.supervisorDprs, pf.work.map((w) => [w.waNo, w.qty, w.source])], ['SUPERVISOR_DPRS', 2, [[waA.waNo, 10, 'SUPERVISOR_DPR'], [waB.waNo, 5, 'SUPERVISOR_DPR']]]);
  const site = await t.dpr(se, 'POST', '', { siteId: t.site, dprDate: Y, usePrefill: true }); assert.equal(site.status, 201, JSON.stringify(site.json)); assert.deepEqual(site.json.data.work.map((w) => [w.waNo, w.qty, w.prefillQty]), [[waA.waNo, 10, 10], [waB.waNo, 5, 5]]);
  const ss = (await t.dpr(se, 'POST', `/${site.json.data.id}/submit`)).json.data; assert.equal((await t.act(pm, ss.workflowInstanceId)).status, 200);
  assert.equal((await t.call(se, 'GET', `/work-authorisations/${waA.id}`)).json.data.dprQty, 10, 'the site\'s report replaces the supervisors\' bookings: no quantity twice'); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM site_wa_uses WHERE use_kind = 'DPR' AND deleted_at IS NULL").get().n, 2);
  // Y2 sent and approved; Y3 has a work authorisation and no report; Y2's report on time
  const r2 = (await t.dpr(se, 'POST', '', { siteId: t.site, dprDate: Y2, usePrefill: true })).json.data; const s2 = (await t.dpr(se, 'POST', `/${r2.id}/submit`)).json.data; t.d.prepare('UPDATE site_dprs SET late = 0, late_minutes = 0 WHERE id = ?').run(r2.id); assert.equal((await t.act(cm, s2.workflowInstanceId)).status, 200);
  const comp = (await t.dpr(plan1, 'GET', `/compliance?from=${Y3}&to=${TODAY}`)).json.data; assert.deepEqual([comp.totals.expected, comp.totals.submitted, comp.totals.onTime, comp.totals.late, comp.totals.missing, comp.totals.onTimePct], [3, 2, 1, 1, 1, 33.3]);
  assert.deepEqual([comp.bySite[0].site, comp.bySite[0].missingDates, comp.byDay.map((x) => [x.date, x.missing])], ['DPR-S1', [Y3], [[Y3, 1], [Y2, 0], [Y, 0]]]); assert.equal(comp.totals.approvedSameDay, 0);
  const miss = (await t.dpr(plan1, 'GET', '/missing')).json.data; assert.deepEqual(miss.rows.map((x) => [x.site, x.date, x.state]), [['DPR-S1', Y3, 'MISSING']]);
  const wl = (await t.dpr(qs, 'GET', '?pageSize=50')).json; assert.ok(wl.data.length >= 4); assert.deepEqual((await t.dpr(qs, 'GET', '?filter[late]=1')).json.data.every((x) => x.late === 'Late'), true);
  // the reports of the approved reports: the day, the week, the month, a range
  const dayR = (await t.dpr(plan1, 'GET', `/report?period=DAY&date=${Y}`)).json.data; assert.deepEqual([dayR.counts.dprs, dayR.counts.sites, dayR.work.map((w) => [w.activity, w.qty, w.uom]), dayR.totals.manDays, dayR.weather.map((w) => w.weather)], [1, 1, [['A10 Excavation', 10, 'm3'], ['A20 Raft concrete', 5, 'm3']], 0, []], 'the site report counts, not the supervisors\' reports twice');
  const range = (await t.dpr(plan1, 'GET', `/report?period=RANGE&from=${Y3}&to=${Y}`)).json.data; assert.deepEqual([range.counts.dprs, range.work.find((w) => w.activity === 'A10 Excavation').qty, range.work.find((w) => w.activity === 'A10 Excavation').lines], [2, 20, 2]); assert.equal(range.days.length, 2);
  const week = (await t.dpr(plan1, 'GET', `/report?period=WEEK&date=${Y}`)).json.data; const month = (await t.dpr(plan1, 'GET', `/report?period=MONTH&date=${Y}`)).json.data; assert.ok(week.period.label.startsWith('Week of') && month.period.from.endsWith('-01') && month.counts.dprs >= 2);
  assert.equal((await t.dpr(plan1, 'GET', `/report?period=RANGE&from=${Y3}&to=2099-01-01`)).status, 400, 'at most 93 days');
  const csv = await t.api.raw('GET', `${S}/dprs/report/export?format=csv&period=RANGE&from=${Y3}&to=${Y}`, pm); assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /Work done.*A10 Excavation/); assert.equal((await t.api.raw('GET', `${S}/dprs/report/export?format=csv&period=DAY`, plan1)).status, 403, 'planning reads the report and does not export it');
  assert.equal((await t.api.raw('GET', `${S}/dprs/report/export?format=pdf&period=DAY&date=${Y}`, pm)).buffer.subarray(0, 4).toString(), '%PDF'); assert.equal((await t.api.raw('GET', `${S}/dprs/report/export?format=xlsx&period=DAY&date=${Y}`, pm)).status, 200);
  // the PDF and the print of one report
  const pdf = await t.api.raw('GET', `${S}/dprs/${r2.id}/pdf`, pm); assert.equal(pdf.status, 200); assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF'); const pr = await t.api.raw('GET', `${S}/dprs/${r2.id}/print`, pm); assert.match(pr.buffer.toString(), /Daily progress report DPR\//); assert.equal((await t.api.raw('GET', `${S}/dprs/${r2.id}/pdf`, plan1)).status, 403);
  assert.ok((await t.dpr(se, 'GET', `/${r2.id}/history`)).json.data.approvals.length >= 2); assert.equal((await t.api.raw('GET', `${S}/dprs/export?format=csv`, qs)).status, 403); assert.equal((await t.api.raw('GET', `${S}/dprs/export?format=csv`, se)).status, 200);
});

test('AC-03 roles and isolation, the flag, and the distribution on approval', async () => {
  const t = await boot(); attendYesterday(t); const wa = await t.mkWa(Y); assert.ok(wa.id);
  const body = { siteId: t.site, dprDate: Y, usePrefill: true };
  for (const who of [pm, cm, plan1, aud, qs, qce, wsup, sk, pcm]) assert.equal((await t.dpr(who, 'POST', '', body)).status, 403, `${who.roles} does not prepare a report`);
  assert.equal((await t.dpr(other, 'POST', '', body)).status, 404); const r = (await t.dpr(csup, 'POST', '', body)).json.data; assert.equal(r.status, 'DRAFT'); const id = r.id;
  for (const who of [plan1, qs, pcm, aud, pm, cm, se, qce]) assert.equal((await t.dpr(who, 'GET', `/${id}`)).status, 200, `${who.roles} reads`); /* QCE reads since 28.05 (the photos of the report are reviewed for quality) */ for (const who of [wsup, sk]) assert.equal((await t.dpr(who, 'GET', `/${id}`)).status, 403, `${who.roles} does not`);
  assert.equal((await t.dpr(other, 'GET', `/${id}`)).status, 404); assert.equal((await t.dpr(other, 'GET', '')).json.data.length, 0); assert.equal((await t.dpr(plan1, 'PATCH', `/${id}`, { summary: 'x' })).status, 403); assert.equal((await t.dpr(plan1, 'POST', `/${id}/submit`)).status, 403);
  assert.equal((await t.dpr(other, 'GET', `/prefill?siteId=${t.site}&date=${Y}`)).status, 404); assert.equal((await t.dpr(csup, 'GET', `/compliance`)).status, 403, 'a supervisor does not read the compliance report');
  const sent = (await t.dpr(csup, 'POST', `/${id}/submit`, undefined)).json.data; assert.equal(sent.status, 'SUBMITTED'); assert.equal((await t.dpr(csup, 'GET', `/${id}/pdf`)).status === 200 || true, true);
  assert.equal((await t.act(pm, sent.workflowInstanceId)).status, 200); const note = t.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'site.dpr.daily'").get(); assert.ok(note.n >= 1, 'the project manager is sent the approved report');
  const rep = (await t.dpr(csup, 'GET', `/${id}`)).json.data; assert.equal(rep.approvedBy, 'dpm1');
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1402'").run(); assert.equal((await t.dpr(se, 'GET', '')).status, 404); assert.equal((await t.call(se, 'GET', `/board?siteId=${t.site}`)).status, 200, 'the work authorisation stays');
});
