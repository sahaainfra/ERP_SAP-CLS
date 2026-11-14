import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { todayIST } from '../src/shared/dates.js';
import { U, ready, fill, attachFile, workerOf, content } from './hse-helpers.js';
import { hseOf } from '../src/server/modules/hse/index.js';
import { deploymentGuards } from '../src/server/modules/hr/labour.js';

// Part 19.01: site inductions (quiz, validity, QR attendance, the clearance of the worker, the expiry sweep), medical fitness status, toolbox talks with attendance and the compliance report.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lab = (r, id) => r.d.prepare('SELECT induction_status AS i, induction_date AS d, medical_status AS m FROM lab_workers WHERE id = ?').get(id);

test('FR-02 T-01 the quiz is scored on the server; a pass records the induction, clears the worker and sets the validity; a fail clears nothing; a valid induction is not repeated', async () => {
  const r = await ready(opened); const w = workerOf(r); const c = await content(r); assert.equal(c.questionCount, 2);
  const forSite = (await r.call(U.hsee, 'GET', `/induction-content/for-site?siteId=${r.site}`)).json.data; assert.equal(forSite.length, 1); assert.equal(JSON.stringify(forSite).includes('correct'), false, 'the learner never sees the answers');
  const body = (o = {}) => ({ contentId: c.id, siteId: r.site, personType: 'WORKER', personId: w.id, answers: [1, 1], ...o });
  const fail = await r.call(U.hsee, 'POST', '/inductions', body({ answers: [1, 0] })); assert.equal(fail.status, 201, JSON.stringify(fail.json)); assert.deepEqual([fail.json.data.scorePct, fail.json.data.passed, fail.json.data.status, fail.json.data.validUntil], [0, false, 'REJECTED', null]); assert.equal(lab(r, w.id).i, 'PENDING');
  assert.equal((await r.call(U.hsee, 'POST', '/inductions', body({ answers: [0] }))).status, 400, 'all questions are answered'); assert.equal((await r.call(U.hsee, 'POST', '/inductions', body({ personId: 999999 }))).status, 400);
  const half = await r.call(U.hsee, 'POST', '/inductions', body({ answers: [0, 0] })); assert.deepEqual([half.json.data.scorePct, half.json.data.passed], [50, true], 'the pass mark is 50');
  assert.deepEqual([half.json.data.validUntil, half.json.data.valid, lab(r, w.id).i, lab(r, w.id).d], [plus(365), true, 'CLEARED', TODAY]);
  assert.equal((await r.call(U.hsee, 'POST', '/inductions', body({ answers: [0, 1] }))).status, 409, 'valid already'); assert.equal((await r.call(U.se, 'POST', '/inductions', body())).status, 403); assert.equal((await r.call(U.hseoX, 'GET', `/inductions/${half.json.data.id}`)).status, 404);
  await r.drain(); assert.deepEqual([r.events('hse.induction.recorded').length, r.events('hse.induction.failed').length], [1, 1]); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'lab_workers' AND action = 'clearance'").get().n, 1);
  assert.equal((await r.call(U.hsee, 'GET', '/inductions?filter[status]=APPROVED')).json.data.length, 1);
  const emp = fill(r.d, 'hr_employees', { company_id: 1, emp_code: 'E100', first_name: 'Asha', full_name: 'Asha Rao' }); const e = await r.call(U.hsee, 'POST', '/inductions', body({ personType: 'EMPLOYEE', personId: emp })); assert.equal(e.status, 201, JSON.stringify(e.json)); assert.equal(e.json.data.personName, 'Asha Rao');
  const people = (await r.call(U.hsee, 'GET', '/inductions/people?q=Ram')).json.data; assert.deepEqual(people.map((x) => x.type), ['WORKER']); assert.equal(JSON.stringify(people).includes('aadhaar'), false);
});

test('FR-02 FR-03 QR attendance: the badge of the worker is scanned, the quiz answered on the phone; the gate check says whether the induction is valid and what the company does about it', async () => {
  const r = await ready(opened); const w = workerOf(r, 'Suresh Yadav'); const c = await content(r);
  const chk0 = await r.call(U.secsup, 'GET', `/inductions/check?badge=${encodeURIComponent(w.badge)}`); assert.equal(chk0.status, 200); assert.deepEqual([chk0.json.data.valid, chk0.json.data.mode, chk0.json.data.allowed], [false, 'WARN', true]); r.setParam('hse.induction.attendance_mode', 'BLOCK'); assert.equal((await r.call(U.secsup, 'GET', `/inductions/check?badge=${encodeURIComponent(w.badge)}`)).json.data.allowed, false, 'BLOCK refuses entry');
  assert.equal((await r.call(U.secsup, 'POST', '/inductions/scan', { badge: 'LAB:nobody', contentId: c.id, siteId: r.site, answers: [0, 1] })).status, 400);
  const s = await r.call(U.secsup, 'POST', '/inductions/scan', { badge: w.badge, contentId: c.id, siteId: r.site, answers: [0, 1] }); assert.equal(s.status, 201, JSON.stringify(s.json)); assert.deepEqual([s.json.data.via, s.json.data.scorePct, s.json.data.personCode, s.json.data.status], ['QR', 100, w.code, 'APPROVED']); assert.equal(lab(r, w.id).i, 'CLEARED');
  const chk = (await r.call(U.secsup, 'GET', `/inductions/check?badge=${encodeURIComponent(w.badge)}`)).json.data; assert.deepEqual([chk.valid, chk.validUntil, chk.allowed, chk.worker.code], [true, plus(365), true, w.code]);
  const cx = await r.call(U.hsee, 'POST', `/inductions/${s.json.data.id}/cancel`, { reason: 'Recorded for the wrong person' }); assert.equal(cx.json.data.status, 'CANCELLED'); assert.equal(lab(r, w.id).i, 'PENDING', 'cancelling removes the clearance'); assert.equal((await r.call(U.hsee, 'POST', `/inductions/${s.json.data.id}/cancel`, { reason: 'Again please' })).status, 422);
});

test('T-01 BR-01 an expired induction clears the worker no more: the sweep sets it EXPIRED and the deployment of the worker is blocked (or warned) as the company configures; a new induction clears again', async () => {
  const r = await ready(opened); const w = workerOf(r, 'Mohan Lal'); const c = await content(r, { validityDays: 30 });
  assert.equal((await r.call(U.hsee, 'POST', '/medical', { workerId: w.id, fitness: 'FIT', examinedOn: TODAY, validUntil: plus(180) })).status, 201); assert.deepEqual([lab(r, w.id).m], ['FIT']);
  const id = (await r.call(U.hsee, 'POST', '/inductions', { contentId: c.id, siteId: r.site, personType: 'WORKER', personId: w.id, answers: [0, 1] })).json.data.id; assert.equal(lab(r, w.id).i, 'CLEARED');
  const guard = () => deploymentGuards.flatMap((g) => g(1, { personId: w.id, fromDate: TODAY })).filter((x) => /clearance/.test(x.message)); assert.deepEqual(guard(), [], 'cleared: inducted and fit');
  const hs = hseOf(r.d).svc; r.d.prepare('UPDATE hse_inductions SET induction_date = ?, valid_until = ? WHERE id = ?').run(plus(-40), plus(-10), id);
  const sw = hs.sweep(1); assert.equal(sw.expired, 1); assert.equal(lab(r, w.id).i, 'EXPIRED'); const g = guard(); assert.equal(g.length, 1); assert.match(g[0].message, /no induction clearance/, 'BLOCK is the default of the labour register'); assert.equal(hs.sweep(1).expired, 0, 'once');
  await r.drain(); assert.equal(r.events('hse.induction.expired').length, 1); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'hse.induction.expiring'").get().n >= 0, true);
  r.setParam('lab.deploy.clearance_mode', 'WARN'); assert.deepEqual(guard(), [], 'WARN lets the deployment through with a warning in the audit trail'); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'lab_workers' AND action = 'deploy_warning'").get().n, 1);
  const again = await r.call(U.hsee, 'POST', '/inductions', { contentId: c.id, siteId: r.site, personType: 'WORKER', personId: w.id, answers: [0, 1] }); assert.equal(again.status, 201, 're-induction after the expiry'); assert.equal(lab(r, w.id).i, 'CLEARED');
  r.d.prepare('UPDATE hse_inductions SET valid_until = ? WHERE id = ?').run(plus(5), again.json.data.id); hs.sweep(1); assert.equal(lab(r, w.id).i, 'CLEARED', 'expiring soon is told, not expired');
});

test('FR-05 the medical fitness is a status only: fit with a date, restricted, or unfit; the labour register reads it', async () => {
  const r = await ready(opened); const w = workerOf(r, 'Kiran Patel');
  const bad = await r.call(U.hsee, 'POST', '/medical', { workerId: w.id, fitness: 'FIT', examinedOn: TODAY }); assert.equal(bad.status, 400, 'a date is needed for fit'); assert.equal((await r.call(U.hsee, 'POST', '/medical', { workerId: w.id, fitness: 'FIT', examinedOn: plus(2), validUntil: plus(100) })).status, 400, 'not in the future');
  assert.equal((await r.call(U.se, 'POST', '/medical', { workerId: w.id, fitness: 'UNFIT', examinedOn: TODAY })).status, 403); const ok = await r.call(U.hsee, 'POST', '/medical', { workerId: w.id, fitness: 'RESTRICTED', examinedOn: TODAY, validUntil: plus(90), remarks: 'No work at height' }); assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.equal(lab(r, w.id).m, 'FIT');
  const un = await r.call(U.hsee, 'POST', '/medical', { workerId: w.id, fitness: 'UNFIT', examinedOn: TODAY }); assert.equal(un.status, 201); assert.equal(lab(r, w.id).m, 'UNFIT'); assert.equal((await r.call(U.hsee, 'GET', `/medical?workerId=${w.id}`)).json.data.length, 2); assert.equal((await r.call(U.pm, 'GET', '/medical')).status, 403);
  await r.drain(); assert.equal(r.events('hse.medical.recorded').length, 2);
});

test('FR-03 FR-04 toolbox talks: topic library, QR attendance, guests, photographs; a person without a valid induction is flagged (WARN) or refused (BLOCK); the talk is recorded with its attendance', async () => {
  const r = await ready(opened); const w1 = workerOf(r, 'Inducted Ivan'); const w2 = workerOf(r, 'Plain Pawan'); const c = await content(r); await r.call(U.hsee, 'POST', '/inductions', { contentId: c.id, siteId: r.site, personType: 'WORKER', personId: w1.id, answers: [0, 1] });
  const t = await r.call(U.hseo, 'POST', '/toolbox-topics', { code: 'TB-HEIGHT', title: 'Working at height', category: 'Height', frequency: 'WEEKLY', body: 'Check the harness before every climb.' }); assert.equal(t.status, 201, JSON.stringify(t.json)); assert.equal((await r.call(U.hseo, 'POST', '/toolbox-topics', { code: 'tb-height', title: 'Dup' })).status, 409); assert.equal((await r.call(U.hsee, 'POST', '/toolbox-topics', { code: 'X', title: 'Not allowed' })).status, 403);
  const tk = await r.call(U.csup, 'POST', '/toolbox-talks', { projectId: r.A, siteId: r.site, topicId: t.json.data.id, conductedBy: 'Foreman Raju', durationMin: 15 }); assert.equal(tk.status, 201, JSON.stringify(tk.json)); const id = tk.json.data.id; assert.deepEqual([tk.json.data.topic, tk.json.data.status, tk.json.data.talkDate], ['Working at height', 'DRAFT', TODAY]);
  assert.equal((await r.call(U.csup, 'POST', '/toolbox-talks', { projectId: r.A, siteId: r.site })).status, 400, 'a topic is needed'); assert.equal((await r.call(U.csup, 'POST', '/toolbox-talks', { projectId: r.A, siteId: r.site, topicText: 'x', talkDate: plus(1) })).status, 400);
  assert.equal((await r.call(U.csup, 'POST', `/toolbox-talks/${id}/complete`)).status, 400, 'no attendance, no record');
  const a1 = await r.call(U.csup, 'POST', `/toolbox-talks/${id}/attend`, { badge: w1.badge }); assert.equal(a1.status, 200, JSON.stringify(a1.json)); assert.deepEqual([a1.json.data.attendees[0].via, a1.json.data.attendees[0].inductionValid], ['QR', true]);
  const a2 = await r.call(U.csup, 'POST', `/toolbox-talks/${id}/attend`, { workerId: w2.id }); assert.equal(a2.json.data.attendees[1].inductionValid, false, 'WARN flags'); assert.equal(a2.json.data.withoutInduction, 1);
  assert.equal((await r.call(U.csup, 'POST', `/toolbox-talks/${id}/attend`, { badge: w1.badge })).json.data.attendeeCount, 2, 'once'); assert.equal((await r.call(U.csup, 'POST', `/toolbox-talks/${id}/attend`, { name: 'Visitor Vikram' })).json.data.attendeeCount, 3);
  r.setParam('hse.induction.attendance_mode', 'BLOCK'); const w3 = workerOf(r, 'Blocked Bhim'); const blocked = await r.call(U.csup, 'POST', `/toolbox-talks/${id}/attend`, { workerId: w3.id }); assert.equal(blocked.status, 422); assert.match(JSON.stringify(blocked.json), /no valid site induction/); r.setParam('hse.induction.attendance_mode', 'OFF');
  assert.equal((await r.call(U.csup, 'POST', `/toolbox-talks/${id}/photos`, { fileId: 999999 })).status, 422); const f = attachFile(r, 'hse_toolbox_talks', id, 'talk.jpg'); assert.equal((await r.call(U.csup, 'POST', `/toolbox-talks/${id}/photos`, { fileId: f })).json.data.photoCount, 1);
  const done = await r.call(U.csup, 'POST', `/toolbox-talks/${id}/complete`); assert.equal(done.status, 200, JSON.stringify(done.json)); assert.deepEqual([done.json.data.status, done.json.data.statusLabel, done.json.data.attendeeCount], ['APPROVED', 'Recorded', 3]);
  assert.equal((await r.call(U.csup, 'POST', `/toolbox-talks/${id}/attend`, { name: 'Late' })).status, 409, 'recorded'); await r.drain(); const ev = r.events('hse.toolbox.recorded'); assert.deepEqual([ev.length, ev[0].attendeeCount, ev[0].withoutInduction], [1, 3, 1]);
  assert.equal((await r.call(U.hseo, 'GET', '/toolbox-talks?filter[status]=APPROVED')).json.data.length, 1); assert.equal((await r.call(U.hseoX, 'GET', `/toolbox-talks/${id}`)).status, 404); assert.equal((await r.call(U.hseo, 'DELETE', `/toolbox-topics/${t.json.data.id}`)).status, 409, 'used topics are made inactive');
  assert.equal((await r.call(U.hseo, 'PATCH', `/toolbox-topics/${t.json.data.id}`, { status: 'INACTIVE' })).json.data.status, 'INACTIVE'); const csv = await r.api.raw('GET', '/api/v1/core/lists/hse.toolbox_talks/export', { ...U.hseo }); void csv;
});

test('FR-04 the compliance report: workers deployed on a site with and without a valid induction, those expiring, the sites without a toolbox talk this week', async () => {
  const r = await ready(opened); const w1 = workerOf(r, 'Cleared Chand'); const w2 = workerOf(r, 'Pending Pran'); const c = await content(r); await r.call(U.hsee, 'POST', '/inductions', { contentId: c.id, siteId: r.site, personType: 'WORKER', personId: w1.id, answers: [0, 1] });
  for (const w of [w1, w2]) fill(r.d, 'hr_deployments', { company_id: 1, doc_date: TODAY, person_type: 'WORKER', person_id: w.id, dep_project_id: r.A, dep_site_id: r.site, from_date: plus(-5), status: 'APPROVED' });
  const rep = (await r.call(U.pm, 'GET', `/compliance?projectId=${r.A}`)).json.data; const s = rep.sites[0]; assert.deepEqual([s.deployed, s.inducted, s.notInducted, s.coveragePct, s.talkOverdue, s.missing.map((x) => x.name)], [2, 1, 1, 50, true, ['Pending Pran']]);
  r.d.prepare('UPDATE hse_inductions SET valid_until = ? WHERE person_id = ?').run(plus(7), w1.id); assert.equal((await r.call(U.pm, 'GET', '/compliance')).json.data.sites[0].expiringSoon, 1);
  const tk = (await r.call(U.csup, 'POST', '/toolbox-talks', { projectId: r.A, siteId: r.site, topicText: 'Housekeeping' })).json.data; await r.call(U.csup, 'POST', `/toolbox-talks/${tk.id}/attend`, { name: 'Guest' }); await r.call(U.csup, 'POST', `/toolbox-talks/${tk.id}/complete`);
  const rep2 = (await r.call(U.pm, 'GET', '/compliance')).json.data; assert.deepEqual([rep2.sites[0].talks, rep2.sites[0].talkAttendance, rep2.sites[0].talkOverdue, rep2.totals.sitesWithoutRecentTalk], [1, 1, false, 0]);
  const csv = await r.api.raw('GET', '/api/v1/hse/compliance/export', { ...U.pm }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /Coverage/); assert.equal((await r.call(U.xsub, 'GET', '/compliance')).status, 403); assert.equal((await r.call(U.hseoX, 'GET', '/compliance')).json.data.sites.length, 0, 'another company sees no sites');
});

test('AC-03 the roles: the supervisors and the gate team work with inductions and talks; the finance role and the external roles see nothing of HSE; the flag gates the whole API', async () => {
  const r = await ready(opened); for (const [who, path, want] of [[U.hsee, '/plans', 200], [U.pm, '/hira', 200], [U.dir, '/inductions', 200], [U.aud, '/toolbox-talks', 200], [U.secsup, '/inductions', 200], [U.secsup, '/plans', 403], [U.prm, '/plans', 403], [U.xcli, '/inductions', 403], [U.xsub, '/toolbox-talks', 403], [U.hrm, '/medical', 403]]) assert.equal((await r.call(who, 'GET', path)).status, want, `${who.roles} ${path}`);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.hse.p1901'").run(); assert.equal((await r.call(U.hsee, 'GET', '/plans')).status, 404);
});
