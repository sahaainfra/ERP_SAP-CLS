import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { punchesOf } from '../src/server/modules/hr/punches.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.05: geo-fenced mobile attendance. T-01 spoofed, stale, low-accuracy and out-of-fence payloads are rejected or flagged exactly as specified; T-02 the same punch replayed five times is one record and an offline sync in
// any order is ordered by device time with the skew flags; T-03 a morning burst of 2,000 punches is processed without errors. Also: selfie rules and who may see a selfie, a visit punch approved by the manager and the site's
// project manager, the crew punch, the kiosk, the device interface, anomalies and their review (repeated cases go to the HR manager as well), the report of the day, retention, scope and the event.
const A = '/api/v1/att';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const pm1 = as('PM', 'pm1'); const se1 = as('SE', 'se1'); const ws1 = as('WSUP', 'ws1'); const it1 = as('ITADM', 'it1'); const other = as('HRMGR', 'hr9', '2');
const emp = (n) => as('EMP', `emp${n}`);
const LAT = 18.5204; const LNG = 73.8567; // the centre of the fence of the site: a circle of 200 m
const north = (m) => LAT + m / 111_000;
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'p') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const setup = async (nEmployees = 4) => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  const mkUser = (n, roles) => { user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${n}@example.com`).lastInsertRowid); return user[n]; };
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['pm1', ['PM']], ['se1', ['SE']], ['ws1', ['WSUP']], ['it1', ['ITADM']], ['dir1', ['DIR']], ['mgr1', []]]) mkUser(n, r);
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'hr9', 'HR9', '[\"HRMGR\"]', 'hr9@example.com')").run();
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const des = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', ?, ?, 'CIRCLE', 200, 't', 'test')", p1, LAT, LNG);
  const s2 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S2', 'Far Site', 'ACTIVE', ?, ?, 'CIRCLE', 200, 't', 'test')", p1, LAT + 0.2, LNG);
  api.db.prepare("INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, applied, created_by, source_type) VALUES (1, 'PROJECT', ?, 'PROJECT_MANAGER', ?, '2026-01-01', 1, 't', 'test')").run(p1, user.pm1);
  let n = 0;
  const mkEmp = (o = {}) => { n += 1; return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, created_by, source_type) VALUES (1, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'G3', 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, ?, 't', 'test')", o.code ?? `E${n}`, o.name ?? `Employee ${n}`, `e${n}`, `91000${String(n).padStart(5, '0')}`, dept, des, o.userId ?? null, o.managerId ?? null); };
  const deploy = (e, siteId = s1) => org("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (1, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', ?, 'APPROVED', ?, ?, 't', 'test')", `D-${e}-${siteId}-${Math.random().toString(36).slice(2, 6)}`, e, p1, siteId, siteId === s1 ? 1 : 0, p1, siteId);
  const manager = mkEmp({ name: 'Manager', userId: user.mgr1 });
  const emps = [];
  for (let i = 1; i <= nEmployees; i += 1) { const u = mkUser(`emp${i}`, []); const e = mkEmp({ userId: u, managerId: manager, code: `W${i}` }); deploy(e); emps.push(e); }
  const supervisor = mkEmp({ name: 'Supervisor', userId: user.ws1, code: 'SUP1' }); deploy(supervisor);
  const crew = org("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade, supervisor_id, project_id, site_id, created_by, source_type) VALUES (1, ?, 'C1', 'Crew One', 'Fitter', ?, ?, ?, 't', 'test')", s1, supervisor, p1, s1);
  const workers = [];
  for (let i = 0; i < 3; i += 1) { const w = mkEmp({ name: `Worker ${i}`, code: `K${i}` }); deploy(w); org("INSERT INTO hr_crew_members (company_id, crew_id, person_type, person_id, from_date, project_id, site_id, created_by, source_type) VALUES (1, ?, 'EMPLOYEE', ?, '2026-01-01', ?, ?, 't', 'test')", crew, w, p1, s1); workers.push(w); }
  const call = (who, method, path, body, key) => api.call(method, `${A}${path}`, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const punch = (who, o = {}, key = uid()) => call(who, 'POST', '/punches', { siteId: s1, punchType: 'IN', deviceTime: ago(0), lat: north(0), lng: LNG, accuracyM: 10, deviceId: `dev-${who.user}`, ...o }, key);
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  return { api, call, punch, act, ids: { p1, s1, s2, crew, manager, supervisor }, emps, workers, user, mkEmp, deploy };
};

test('T-01 FR-02 BR-01 BR-03 spoofed, stale, low-accuracy and out-of-fence payloads are rejected or flagged exactly as specified; a rejected punch is kept with its reason and never counts', async () => {
  const t = await setup();
  const p = async (who, o) => { const r = await t.punch(who, o); assert.ok([200, 201].includes(r.status), JSON.stringify(r.json)); return r.json.data; };
  // inside the fence, good accuracy, clock right: accepted
  const ok = await p(emp(1), { punchType: 'IN' });
  assert.deepEqual([ok.result, ok.insideFence, ok.reason, ok.method, ok.flags], ['ACCEPTED', true, null, 'MOBILE', []]);
  // accuracy: flagged above 50 m, rejected above 200 m
  const flag = await p(emp(2), { accuracyM: 80 });
  assert.deepEqual([flag.result, flag.flags.includes('LOW_ACCURACY')], ['FLAGGED', true]);
  const low = await p(emp(3), { accuracyM: 300 });
  assert.deepEqual([low.result, low.reason], ['REJECTED', 'LOW_ACCURACY']);
  // outside the fence: 500 m outside the edge is rejected; a few metres outside with an accuracy that explains it is flagged, not rejected
  const away = await p(emp(4), { lat: north(711), accuracyM: 20 });
  assert.deepEqual([away.result, away.reason, away.insideFence], ['REJECTED', 'OUTSIDE_FENCE', false]);
  assert.ok(away.distanceM > 400);
  const edge = await p(emp(1), { punchType: 'OUT', lat: north(215), accuracyM: 30, deviceTime: ago(-0.0) });
  assert.deepEqual([edge.result, edge.flags.includes('EDGE_UNCERTAIN')], ['FLAGGED', true]);
  // the clock: ten minutes stale or five minutes ahead is rejected for an online punch
  const stale = await p(emp(2), { punchType: 'OUT', deviceTime: ago(10) });
  assert.deepEqual([stale.result, stale.reason], ['REJECTED', 'CLOCK_SKEW']);
  const future = await p(emp(3), { punchType: 'OUT', deviceTime: ago(-10) });
  assert.deepEqual([future.result, future.reason], ['REJECTED', 'CLOCK_SKEW']);
  // a mock location (declared, or an accuracy of zero) is rejected and is a high anomaly
  const mock = await p(emp(4), { punchType: 'OUT', mockLocation: true });
  assert.deepEqual([mock.result, mock.reason], ['REJECTED', 'MOCK_LOCATION']);
  const zero = await p(emp(3), { punchType: 'IN', accuracyM: 0 });
  assert.equal(zero.reason, 'MOCK_LOCATION');
  // no location at all
  const none = await t.punch(emp(4), { lat: null, lng: null, punchType: 'IN', deviceTime: ago(0) });
  assert.equal(none.json.data.reason, 'NO_LOCATION');
  // BR-03: the rejected ones are kept, listed with their reasons, and do not count
  const list = (await t.call(hr1, 'GET', `/punches?siteId=${t.ids.s1}&result=REJECTED`)).json;
  assert.ok(list.data.length >= 6);
  assert.ok(list.data.every((x) => x.reasonText));
  const rep = (await t.call(hr1, 'GET', '/report/today')).json.data.rows.find((r) => r.siteId === t.ids.s1);
  assert.equal(rep.present, 2, 'only the accepted and flagged punches count: persons 1 and 2');
  assert.ok(rep.rejected >= 6);
  const an = (await t.call(hr1, 'GET', '/anomalies')).json.data;
  const types = new Set(an.map((x) => x.type));
  for (const x of ['OUTSIDE_FENCE', 'MOCK_LOCATION', 'LOW_ACCURACY', 'CLOCK_SKEW']) assert.ok(types.has(x), x);
  assert.equal(an.find((x) => x.type === 'MOCK_LOCATION').severity, 'HIGH');
  // the event for the register of 07.06
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'att.punch.recorded' ORDER BY id").all().map((r) => JSON.parse(r.payload).data);
  assert.ok(ev.length >= 10 && ev.some((e) => e.result === 'ACCEPTED' && e.method === 'MOBILE') && ev.some((e) => e.result === 'REJECTED'));
  // a person with no employee record, and one who is not deployed there
  assert.equal((await t.punch(hr1, {})).status, 422);
  assert.equal((await t.punch(se1, {})).status, 422);
});

test('T-02 BR-02 FR-06 the same punch replayed five times is one record; the same kind within the window is the same punch; an offline sync in any order is ordered by device time with the skew flags', async () => {
  const t = await setup();
  const key = uid('same');
  const body = { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(0), lat: north(0), lng: LNG, accuracyM: 10, deviceId: 'dev-a' };
  const replies = [];
  for (let i = 0; i < 5; i += 1) replies.push(await t.call(emp(1), 'POST', '/punches', body, key));
  assert.deepEqual(replies.map((r) => r.status), [201, 200, 200, 200, 200]);
  assert.equal(new Set(replies.map((r) => r.json.data.id)).size, 1);
  assert.equal(replies[1].json.data.replayed, true);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM att_punches').get().n, 1);
  // another key, same person and kind within five minutes: the same punch
  const near = await t.call(emp(1), 'POST', '/punches', { ...body, deviceTime: ago(-1) }, uid());
  assert.equal(near.json.data.duplicate, true);
  assert.equal(near.json.data.id, replies[0].json.data.id);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM att_punches').get().n, 1);
  assert.equal((await t.call(emp(1), 'POST', '/punches', body)).status, 400, 'a key is needed');
  // offline: the out punch is synced before the in punch; both are made hours ago, so both are late syncs; the order is by device time and nothing is missing
  const sinceMidnight = Math.floor(((Date.now() + 19_800_000) % 86_400_000) / 60_000);
  const inMin = Math.max(35, Math.min(100, sinceMidnight - 5)); const outMin = Math.max(31, Math.floor(inMin / 2));
  const outFirst = await t.call(emp(2), 'POST', '/punches', { ...body, punchType: 'OUT', deviceTime: ago(outMin), offline: true }, uid());
  assert.equal(outFirst.status, 201, JSON.stringify(outFirst.json));
  assert.ok(outFirst.json.data.flags.includes('LATE_SYNC') && outFirst.json.data.flags.includes('NO_PRIOR_IN'));
  const inLater = await t.call(emp(2), 'POST', '/punches', { ...body, punchType: 'IN', deviceTime: ago(inMin), offline: true }, uid());
  assert.equal(inLater.status, 201, JSON.stringify(inLater.json));
  const day = (await t.call(hr1, 'GET', `/punches?personId=${t.emps[1]}&limit=10`)).json.data;
  assert.deepEqual(day.map((x) => x.type), ['OUT', 'IN'], 'newest first by device time, not by arrival');
  assert.ok(day[0].effectiveTime > day[1].effectiveTime);
  const out = day.find((x) => x.type === 'OUT');
  assert.equal(out.flags.includes('NO_PRIOR_IN'), false, 'the in punch arrived later: nothing is missing');
  assert.equal(out.result, 'FLAGGED', 'still flagged for the late sync');
  assert.equal((await t.call(hr1, 'GET', '/anomalies?type=NO_PRIOR_IN&status=ACCEPTED')).json.data.length, 1, 'the anomaly was settled by the system');
  // too old, or in the future, offline
  const old = await t.call(emp(3), 'POST', '/punches', { ...body, deviceTime: ago(60 * 24 * 7), offline: true }, uid());
  assert.deepEqual([old.json.data.result, old.json.data.reason], ['REJECTED', 'TOO_OLD']);
  const fut = await t.call(emp(3), 'POST', '/punches', { ...body, deviceTime: ago(-120), offline: true }, uid());
  assert.deepEqual([fut.json.data.result, fut.json.data.reason], ['REJECTED', 'FUTURE_TIME']);
  // through the offline engine of 04.15: the form is registered and a command becomes a punch
  const offline = (await import('../src/server/modules/eng/offline.js')).offlineForms.get('attendance_punch');
  assert.ok(offline, 'the attendance punch is a form of the offline engine');
  assert.deepEqual(offline.validate({ siteId: 1, punchType: 'X', deviceTime: 'no' }).map((e) => e.field), ['punchType', 'deviceTime']);
  const made = offline.create(t.api.db, { user: 'emp4', userId: t.user.emp4, companyId: 1, roles: ['EMP'] }, { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(40), lat: north(0), lng: LNG, accuracyM: 10, deviceId: 'dev-4' }, { commandId: 'cmd-offline-1', effectiveAt: ago(40), gps: null });
  assert.ok(made.entityId);
  const again = offline.create(t.api.db, { user: 'emp4', userId: t.user.emp4, companyId: 1, roles: ['EMP'] }, { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(40), lat: north(0), lng: LNG, accuracyM: 10 }, { commandId: 'cmd-offline-1', effectiveAt: ago(40), gps: null });
  assert.equal(again.entityId, made.entityId, 'the same command is the same punch');
});

test('FR-08 anomalies: impossible travel, repeated low accuracy, a phone used by two people, a new phone; review: accept makes an outside-fence punch count, reject takes it out, repeated acceptance goes to the HR manager too, nobody reviews their own', async () => {
  const t = await setup();
  const far = t.ids.s2;
  for (const e of t.emps) t.deploy(e, far);
  // impossible travel: 20 km from the first site in ten minutes
  const a = await t.call(emp(1), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(120), lat: north(0), lng: LNG, accuracyM: 10, deviceId: 'dev-1', offline: true }, uid());
  const b = await t.call(emp(1), 'POST', '/punches', { siteId: far, punchType: 'OUT', deviceTime: ago(115), lat: LAT + 0.2, lng: LNG, accuracyM: 10, deviceId: 'dev-1', offline: true }, uid());
  assert.equal(a.json.data.flags.includes('IMPOSSIBLE_TRAVEL'), false);
  assert.ok(b.json.data.flags.includes('IMPOSSIBLE_TRAVEL'), JSON.stringify(b.json.data));
  assert.equal(b.json.data.result, 'FLAGGED');
  // a phone used by two people the same day
  await t.call(emp(2), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(0), lat: north(0), lng: LNG, accuracyM: 10, deviceId: 'dev-shared' }, uid());
  const shared = await t.call(emp(3), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(0), lat: north(0), lng: LNG, accuracyM: 10, deviceId: 'dev-shared' }, uid());
  assert.ok(shared.json.data.flags.includes('SHARED_DEVICE'));
  // a second phone for the same person
  const nd = await t.call(emp(2), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'OUT', deviceTime: ago(-0.0), lat: north(0), lng: LNG, accuracyM: 10, deviceId: 'dev-other' }, uid());
  assert.ok(nd.json.data.flags.includes('NEW_DEVICE'));
  // three poor accuracies in a row (offline, an hour apart)
  for (const [i, m] of [[0, 300], [1, 200], [2, 100]]) await t.call(emp(4), 'POST', '/punches', { siteId: t.ids.s1, punchType: i % 2 ? 'OUT' : 'IN', deviceTime: ago(m), lat: north(0), lng: LNG, accuracyM: 80, deviceId: 'dev-4', offline: true }, uid());
  const all = (await t.call(hr1, 'GET', '/anomalies?limit=200')).json.data;
  const types = all.map((x) => x.type);
  for (const x of ['IMPOSSIBLE_TRAVEL', 'SHARED_DEVICE', 'NEW_DEVICE', 'REPEATED_LOW_ACCURACY']) assert.ok(types.includes(x), x);
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  assert.ok(all.every((x, i) => i === 0 || rank[all[i - 1].severity] <= rank[x.severity]), 'the queue is sorted by severity first');
  // review: an outside-fence punch accepted as present
  const out1 = (await t.call(emp(1), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(30), lat: north(700), lng: LNG, accuracyM: 15, offline: true }, uid())).json.data;
  assert.equal(out1.result, 'REJECTED');
  const an1 = (await t.call(hr1, 'GET', '/anomalies?type=OUTSIDE_FENCE')).json.data.find((x) => x.punchId === out1.id);
  assert.equal((await t.call(se1, 'POST', `/anomalies/${an1.id}/review`, { decision: 'ACCEPT', note: 'Accepted by the engineer' })).status, 403, 'a site engineer reads but does not review');
  assert.equal((await t.call(hr1, 'POST', `/anomalies/${an1.id}/review`, { decision: 'ACCEPT', note: 'x' })).status, 400, 'a note is needed');
  const acc = await t.call(hr1, 'POST', `/anomalies/${an1.id}/review`, { decision: 'ACCEPT', note: 'The fence is drawn too tight at the gate' });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  assert.equal(acc.json.data.status, 'ACCEPTED');
  const after = (await t.call(hr1, 'GET', `/punches?personId=${t.emps[0]}&result=FLAGGED`)).json.data.find((x) => x.id === out1.id);
  assert.ok(after && after.flags.includes('REVIEW_ACCEPTED'), 'now it counts');
  assert.equal((await t.call(hr1, 'POST', `/anomalies/${an1.id}/review`, { decision: 'REJECT', note: 'Changed my mind' })).status, 409, 'settled once');
  // reject: a flagged punch is taken out of attendance
  const sh = all.find((x) => x.type === 'SHARED_DEVICE');
  const rej = await t.call(hr1, 'POST', `/anomalies/${sh.id}/review`, { decision: 'REJECT', note: 'Two people on one phone' });
  assert.equal(rej.json.data.status, 'REJECTED');
  assert.equal(t.api.db.prepare('SELECT result, reason_code FROM att_punches WHERE id = ?').get(sh.punchId).reason_code, 'ANOMALY_REJECTED');
  // repeated: this person already has accepted outside-fence punches (threshold 3): the next acceptance needs the supervisor or project manager and the HR manager
  for (let i = 0; i < 3; i += 1) {
    const o = (await t.call(emp(2), 'POST', '/punches', { siteId: t.ids.s1, punchType: i % 2 ? 'OUT' : 'IN', deviceTime: ago(900 - i * 60), lat: north(700), lng: LNG, accuracyM: 15, offline: true }, uid())).json.data;
    const a2 = (await t.call(hr1, 'GET', '/anomalies?type=OUTSIDE_FENCE')).json.data.find((x) => x.punchId === o.id);
    assert.equal((await t.call(hr1, 'POST', `/anomalies/${a2.id}/review`, { decision: 'ACCEPT', note: 'Accepted for the gate' })).json.data.status, i < 3 ? 'ACCEPTED' : 'PENDING_APPROVAL');
  }
  const o4 = (await t.call(emp(2), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(300), lat: north(700), lng: LNG, accuracyM: 15, offline: true }, uid())).json.data;
  const a4 = (await t.call(hr1, 'GET', '/anomalies?type=OUTSIDE_FENCE')).json.data.find((x) => x.punchId === o4.id);
  const rev = await t.call(hr1, 'POST', `/anomalies/${a4.id}/review`, { decision: 'ACCEPT', note: 'Again at the gate' });
  assert.equal(rev.json.data.status, 'PENDING_APPROVAL');
  const inst = t.api.db.prepare('SELECT workflow_instance_id AS w FROM att_anomalies WHERE id = ?').get(a4.id).w;
  await t.act(pm1, inst); await t.act(hr2, inst);
  assert.equal((await t.call(hr1, 'GET', `/anomalies/${a4.id}`)).json.data.status, 'ACCEPTED');
  // nobody reviews their own punch
  const mine = (await t.call(emp(1), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'OUT', deviceTime: ago(20), lat: north(700), lng: LNG, accuracyM: 15, offline: true }, uid())).json.data;
  const own = (await t.call(hr1, 'GET', '/anomalies?type=OUTSIDE_FENCE')).json.data.find((x) => x.punchId === mine.id);
  t.api.db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(t.user.hr1, t.emps[0]);
  assert.equal((await t.call(hr1, 'POST', `/anomalies/${own.id}/review`, { decision: 'ACCEPT', note: 'My own punch' })).status, 403);
  // bulk
  const bulk = await t.call(hr2, 'POST', '/anomalies/bulk-review', { ids: [own.id, 999999], decision: 'REJECT', note: 'Rejected in bulk' });
  assert.equal(bulk.status, 200);
  assert.deepEqual([bulk.json.data.done, bulk.json.data.failed], [1, 1]);
  assert.equal((await t.call(other, 'GET', '/anomalies')).json.data.length, 0, 'another company sees nothing');
});

test('FR-01 FR-03 FR-04 FR-05 the selfie rules, the crew punch with a group photo, the kiosk and the device interface', async () => {
  const t = await setup();
  // a site that wants a selfie
  const set = await t.call(hr1, 'PUT', `/site-settings/${t.ids.s1}`, { selfieMode: 'REQUIRED', flagAccuracyM: 40, rejectAccuracyM: 150, toleranceM: 5, kioskEnabled: true, version: 0 });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal((await t.call(se1, 'PUT', `/site-settings/${t.ids.s1}`, { selfieMode: 'NONE', version: 1 })).status, 403);
  const without = await t.punch(emp(1), {});
  assert.deepEqual([without.json.data.result, without.json.data.reason], ['REJECTED', 'SELFIE_REQUIRED']);
  const withSelfie = await t.punch(emp(2), { selfie: PIXEL });
  assert.equal(withSelfie.json.data.result, 'ACCEPTED', JSON.stringify(withSelfie.json));
  assert.equal(withSelfie.json.data.hasSelfie, true);
  assert.equal((await t.punch(emp(3), { selfie: 'data:text/html;base64,PGI+' })).status, 400, 'only images');
  const dbg = await t.punch(emp(4), { accuracyM: 45, selfie: PIXEL }); assert.ok(dbg.json.data, JSON.stringify(dbg.json));
  // the selfie is for the person and the reviewers
  const id = withSelfie.json.data.id;
  const mine = await t.api.raw('GET', `${A}/punches/${id}/selfie`, emp(2));
  assert.equal(mine.status, 200); assert.equal(mine.buffer.subarray(1, 4).toString(), 'PNG');
  assert.equal((await t.api.raw('GET', `${A}/punches/${id}/selfie`, hr1)).status, 200);
  assert.equal((await t.api.raw('GET', `${A}/punches/${id}/selfie`, emp(3))).status, 404);
  assert.equal((await t.api.raw('GET', `${A}/punches/${id}/selfie`, se1)).status, 404, 'a site engineer sees the site but not selfies');
  // the settings change the thresholds: accuracy 45 m is now flagged (40) and 160 rejected (150)
  assert.equal((await t.punch(emp(4), { accuracyM: 45, selfie: PIXEL })).json.data.result, 'FLAGGED');
  // crew punch: the supervisor of the crew, a group photo, each punch names the supervisor as the recorder
  const gid = uid('grp');
  const body = { crewId: t.ids.crew, punchType: 'IN', deviceTime: ago(0), personIds: t.workers, photo: PIXEL, groupUuid: gid, lat: north(0), lng: LNG, accuracyM: 10 };
  assert.equal((await t.call(hr2, 'POST', '/punches/crew', body)).status, 403, 'only the supervisor of the crew');
  assert.equal((await t.call(ws1, 'POST', '/punches/crew', { ...body, photo: null })).status, 400, 'a group photo is required');
  assert.equal((await t.call(ws1, 'POST', '/punches/crew', { ...body, personIds: [t.emps[0]] })).status, 400, 'a person who is not in the crew');
  const crew = await t.call(ws1, 'POST', '/punches/crew', body);
  assert.equal(crew.status, 201, JSON.stringify(crew.json));
  assert.deepEqual([crew.json.data.count, crew.json.data.accepted], [3, 3]);
  assert.ok(crew.json.data.punches.every((x) => x.method === 'SUPERVISOR' && x.recordedBy === 'ws1' && x.hasSelfie));
  const replay = await t.call(ws1, 'POST', '/punches/crew', body);
  assert.equal(replay.json.data.replayed, 3, 'the same group is the same punches');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM att_punches WHERE method = 'SUPERVISOR'").get().n, 3);
  // kiosk: the worker scans the badge (the employee code)
  const k = await t.call(se1, 'POST', '/punches/kiosk', { siteId: t.ids.s1, badge: 'W1', punchType: 'IN', deviceTime: ago(-0.0), selfie: PIXEL }, uid());
  assert.equal(k.status, 201, JSON.stringify(k.json));
  assert.deepEqual([k.json.data.method, k.json.data.result, k.json.data.recordedBy], ['KIOSK', 'ACCEPTED', 'se1']);
  assert.equal((await t.call(se1, 'POST', '/punches/kiosk', { siteId: t.ids.s1, badge: 'NOBODY', punchType: 'IN', deviceTime: ago(0), selfie: PIXEL }, uid())).status, 404);
  assert.equal((await t.call(emp(1), 'POST', '/punches/kiosk', { siteId: t.ids.s1, badge: 'W2', punchType: 'IN', deviceTime: ago(0), selfie: PIXEL }, uid())).status, 403, 'a worker does not run the kiosk');
  const nosf = await t.call(se1, 'POST', '/punches/kiosk', { siteId: t.ids.s1, badge: 'W3', punchType: 'IN', deviceTime: ago(0) }, uid());
  assert.equal(nosf.json.data.reason, 'SELFIE_REQUIRED', 'the site asks for a photo at the kiosk too');
  // the interface of a biometric device (29.02): the same checks, no phone
  const dv = await t.call(it1, 'POST', '/punches/device', { siteId: t.ids.s1, employeeCode: 'W2', punchType: 'OUT', deviceTime: ago(0), deviceSerial: 'BIO-7', clientUuid: uid('bio') });
  assert.equal(dv.status, 201, JSON.stringify(dv.json));
  assert.deepEqual([dv.json.data.method, dv.json.data.result], ['DEVICE', 'ACCEPTED']);
  assert.equal((await t.call(emp(1), 'POST', '/punches/device', { siteId: t.ids.s1, employeeCode: 'W2', punchType: 'OUT', deviceTime: ago(0), deviceSerial: 'BIO-7', clientUuid: uid('bio') })).status, 403);
  // the screen's context: the sites with their fences, the next punch, the notice
  const ctx = (await t.call(emp(2), 'GET', '/punches/context')).json.data;
  assert.equal(ctx.sites.length, 1); assert.equal(ctx.sites[0].geofence.type, 'CIRCLE'); assert.equal(ctx.sites[0].selfieMode, 'REQUIRED');
  assert.equal(ctx.nextType, 'IN', 'the last punch of the day was the device out'); assert.match(ctx.notice, /not tracked in the background/);
  const today = (await t.call(emp(2), 'GET', `/punches/today?siteId=${t.ids.s1}`)).json.data;
  assert.ok(today.every((x) => x.personId === t.emps[1]), 'a worker sees only their own punches');
  assert.ok((await t.call(se1, 'GET', `/punches/today?siteId=${t.ids.s1}`)).json.data.length > 3, 'a site engineer sees the site');
});

test('FR-07 a punch at a site where the person is not deployed asks for a visit, approved by the reporting manager and the site project manager; until then it does not count', async () => {
  const t = await setup();
  const body = { siteId: t.ids.s2, punchType: 'IN', deviceTime: ago(0), lat: LAT + 0.2, lng: LNG, accuracyM: 10, deviceId: 'dev-v' };
  const no = await t.call(emp(1), 'POST', '/punches', body, uid());
  assert.equal(no.status, 422); assert.equal(no.json.error.code, 'NOT_DEPLOYED');
  const v = await t.call(emp(1), 'POST', '/punches', { ...body, reason: 'Inspecting the pipe delivery' }, uid());
  assert.equal(v.status, 201, JSON.stringify(v.json));
  assert.deepEqual([v.json.data.result, v.json.data.visit.status], ['PENDING', 'SUBMITTED']);
  assert.equal((await t.call(hr1, 'GET', '/report/today')).json.data.totals.pending, 1);
  const inst = t.api.db.prepare('SELECT workflow_instance_id AS w FROM att_visits WHERE id = ?').get(v.json.data.visit.id).w;
  await t.act(as('EMP', 'mgr1'), inst);
  await t.act(pm1, inst);
  const done = (await t.call(hr1, 'GET', `/punches?personId=${t.emps[0]}&siteId=${t.ids.s2}`)).json.data[0];
  assert.equal(done.result, 'ACCEPTED'); assert.ok(done.flags.includes('VISIT_APPROVED'));
  // a second punch the same day at the same site follows the approved visit
  const out = await t.call(emp(1), 'POST', '/punches', { ...body, punchType: 'OUT', deviceTime: ago(-0.0) }, uid());
  assert.equal(out.json.data.result, 'ACCEPTED');
  // a rejected visit rejects the punch
  const w = await t.call(emp(2), 'POST', '/punches', { ...body, reason: 'A look at the other site' }, uid());
  const inst2 = t.api.db.prepare('SELECT workflow_instance_id AS w FROM att_visits WHERE id = ?').get(w.json.data.visit.id).w;
  await t.act(as('EMP', 'mgr1'), inst2, 'reject');
  const rj = (await t.call(hr1, 'GET', `/punches?personId=${t.emps[1]}&siteId=${t.ids.s2}`)).json.data[0];
  assert.deepEqual([rj.result, rj.reason], ['REJECTED', 'VISIT_REJECTED']);
});

test('T-03 FR-02 a morning burst: 2,000 punches in a minute are processed without error and each is a record', async () => {
  const t = await setup(1);
  const svc = punchesOf(t.api.db);
  const people = [];
  for (let i = 0; i < 2000; i += 1) { const e = t.mkEmp({ code: `B${i}` }); t.deploy(e); people.push(e); }
  const actor = { user: 'hr1', userId: t.user.hr1, companyId: 1, roles: ['HRMGR'] };
  const started = Date.now();
  let failed = 0;
  const results = [];
  for (let i = 0; i < people.length; i += 100) {
    const batch = await Promise.allSettled(people.slice(i, i + 100).map((id, k) => svc.record(actor, { personId: id, siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(0), lat: north(k), lng: LNG, accuracyM: 12, deviceId: `burst-${id}`, clientUuid: `burst-${i + k}-${id}` }, { method: 'MOBILE' })));
    for (const b of batch) { if (b.status === 'rejected') failed += 1; else results.push(b.value.result); }
  }
  const took = Date.now() - started;
  assert.equal(failed, 0);
  assert.equal(results.filter((r) => r === 'ACCEPTED').length, 2000);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM att_punches').get().n, 2000);
  assert.ok(took < 60_000, `2,000 punches took ${took} ms`);
  // and one over HTTP, from a person with an account
  const burst = await Promise.all(t.emps.slice(0, 1).concat([]).map(() => t.punch(emp(1), {})));
  assert.ok(burst.every((r) => [200, 201].includes(r.status)));
  const runtime = runtimeOf(t.api.db); runtime.bus.drain();
  const list = (await t.call(hr1, 'GET', `/punches?siteId=${t.ids.s1}&limit=50`)).json;
  assert.equal(list.data.length, 50); assert.ok(list.meta.total >= 2000);
});

test('FR-09 AC-03 the report of the day, the retention of locations and selfies, scope and the site settings', async () => {
  const t = await setup();
  for (const [i, o] of [[1, {}], [2, { punchType: 'IN' }]]) await t.punch(emp(i), o);
  await t.punch(emp(3), { lat: north(900), accuracyM: 10 });
  const rep = (await t.call(pm1, 'GET', '/report/today')).json.data;
  const row = rep.rows.find((r) => r.siteId === t.ids.s1);
  assert.equal(row.deployed, 8, 'four employees, the supervisor and three crew members');
  assert.deepEqual([row.present, row.outsideFence, row.rejected], [2, 1, 1]);
  assert.equal(row.absent, row.expected - 2);
  assert.equal(rep.totals.present, 2);
  assert.equal((await t.call(se1, 'GET', '/report/today')).status, 200);
  assert.equal((await t.call(emp(1), 'GET', '/report/today')).status, 403, 'a worker does not see the report');
  assert.equal((await t.call(other, 'GET', '/report/today')).json.data.rows.length, 0);
  const csv = await t.api.raw('GET', `${A}/report/today/export`, hr1);
  assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /Ring Road North/);
  assert.equal((await t.call(emp(1), 'GET', '/anomalies')).status, 403);
  assert.equal((await t.call(emp(1), 'GET', `/punches?siteId=${t.ids.s1}`)).status, 403, 'the list of the site is for those who see the site');
  // retention: old coordinates and selfies go, the punch stays
  const old = await t.call(emp(4), 'POST', '/punches', { siteId: t.ids.s1, punchType: 'IN', deviceTime: ago(60 * 24 * 7), lat: north(0), lng: LNG, accuracyM: 10, offline: true, selfie: PIXEL }, uid());
  assert.equal(old.json.data.reason, 'TOO_OLD');
  t.api.db.prepare("UPDATE att_punches SET effective_time = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.json.data.id);
  assert.equal(punchesOf(t.api.db).retention(1).removed, 1);
  const kept = t.api.db.prepare('SELECT lat, lng, selfie_file_id AS s, flags_json AS f FROM att_punches WHERE id = ?').get(old.json.data.id);
  assert.deepEqual([kept.lat, kept.lng, kept.s], [null, null, null]);
  assert.match(kept.f, /LOCATION_REMOVED/);
  assert.equal(punchesOf(t.api.db).retention(1).removed, 0, 'only once');
  // settings
  const st = (await t.call(hr1, 'GET', `/site-settings/${t.ids.s1}`)).json.data;
  assert.deepEqual([st.selfieMode, st.flagAccuracy, st.rejectAccuracy, st.customised], ['OPTIONAL', 50, 200, false]);
  const bad = await t.call(hr1, 'PUT', `/site-settings/${t.ids.s1}`, { selfieMode: 'OPTIONAL', flagAccuracyM: 300, rejectAccuracyM: 100, version: 0 });
  assert.equal(bad.status, 400);
});
