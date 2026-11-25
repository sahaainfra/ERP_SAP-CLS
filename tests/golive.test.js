import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';
import { CRITERIA, CUTOVER_STEPS, DECISION_CHAIN } from '../src/server/modules/tst/golive.js';
import { todayIST } from '../src/shared/dates.js';

// Part 30.10: UAT scripts from the build's scenarios, runs, defects and their triage, the module sign-off by its owner; the readiness
// checklist (BR-01: go-live only with every mandatory criterion met and the director's approval); the cut-over runbook and its dry run (T-01);
// the go/no-go decision through PCMGR → CFO → DIR; hypercare with the daily report and the handover; roles.
const T = '/api/v1/tst/golive';
const opened = [];
after(async () => { for (const c of opened) await c(); });
let seq = 0; const key = () => ({ 'idempotency-key': `gl-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user });
const pm = as('PCMGR', 'gl-pm'); const it = as('ITADM', 'gl-it'); const cfo = as('CFO', 'gl-cfo'); const dir = as('DIR', 'gl-dir'); const se = as('SE', 'gl-se'); const aud = as('AUD', 'gl-aud');
const procOwner = as('PROCMGR', 'gl-proc'); const hr = as('HRMGR', 'gl-hr');
async function boot() {
  const storagePath = mkdtempSync(join(tmpdir(), 'gl-'));
  const api = await startApi({}, { storagePath }); opened.push(async () => { await api.close(); rmSync(storagePath, { recursive: true, force: true }); });
  await setupCompany(api); enableFlags(api.db, 1, ['ff.qa.p3010', 'ff.admin.p2906']);
  for (const u of [pm, it, cfo, dir, se, aud, procOwner, hr]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`);
  const call = (who, method, path, body) => api.call(method, `${T}${path}`, { ...who, headers: key(), body });
  return { api, d: api.db, call };
}

test('T-01 FR-03 the cut-over dry run: automatic steps run, the owners complete theirs, the rollback point is a verified backup, finished inside the window', async () => {
  const { call, d } = await boot();
  const plan = await call(pm, 'POST', '/cutover/runs', { kind: 'DRY_RUN', windowMinutes: 60 });
  assert.equal(plan.status, 201, JSON.stringify(plan.json));
  assert.deepEqual(plan.json.data.steps.map((s) => s.code), CUTOVER_STEPS.map((s) => s.code));
  assert.equal((await call(pm, 'POST', '/cutover/runs', { kind: 'DRY_RUN' })).status, 409, 'one run at a time');
  // BR-01 the production run needs an approved GO
  assert.equal((await call(pm, 'POST', '/cutover/runs', { kind: 'PRODUCTION' })).status, 422);
  let run = (await call(pm, 'POST', `/cutover/runs/${plan.json.data.id}/start`, {})).json.data;
  // the run stops at the first manual step (freeze the legacy system, ITADM's)
  const freeze = run.steps.find((s) => s.code === 'FREEZE_LEGACY');
  assert.equal(freeze.status, 'RUNNING');
  assert.deepEqual(run.steps.filter((s) => s.seq < freeze.seq).map((s) => s.status), ['DONE', 'DONE']);
  assert.match(run.rollbackPoint, /^full-/); assert.match(run.steps[1].detail, /verified/);
  assert.equal((await call(se, 'POST', `/cutover/steps/${freeze.id}/complete`, { result: 'DONE', detail: 'not mine' })).status, 403, 'only the owner of the step');
  run = (await call(it, 'POST', `/cutover/steps/${freeze.id}/complete`, { result: 'DONE', detail: 'Legacy frozen at 18:00; final extracts taken.' })).json.data;
  const business = run.steps.find((s) => s.code === 'BUSINESS_CHECK');
  assert.equal(business.status, 'RUNNING', 'the automatic steps in between ran: migration, configuration, smoke test');
  assert.deepEqual(run.steps.filter((s) => ['FINAL_MIGRATION', 'CONFIGURATION', 'SMOKE_TEST'].includes(s.code)).map((s) => s.status), ['DONE', 'DONE', 'DONE']);
  run = (await call(pm, 'POST', `/cutover/steps/${business.id}/complete`, { result: 'DONE', detail: 'Trial balance and stock values agree with the legacy reports.' })).json.data;
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.steps.map((s) => [s.code, s.status, s.detail])));
  assert.equal(run.withinWindow, true); assert.ok(run.elapsedMinutes < 60);
  assert.deepEqual(run.steps.map((s) => s.status), CUTOVER_STEPS.map(() => 'DONE'));
  // the dry run criterion is met; the run is in the audit trail
  const c = (await call(pm, 'POST', '/evaluate', {})).json.data;
  assert.equal(c.items.find((i) => i.criterion === 'DRY_RUN').status, 'MET');
  assert.ok(d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'golive_cutover_runs'").get().n >= 2);
  // a failed manual step fails the run; it is rolled back to its rollback point
  const p2 = (await call(pm, 'POST', '/cutover/runs', { kind: 'DRY_RUN', windowMinutes: 30 })).json.data;
  const r2 = (await call(pm, 'POST', `/cutover/runs/${p2.id}/start`, {})).json.data;
  const f2 = r2.steps.find((s) => s.code === 'FREEZE_LEGACY');
  const failed = (await call(it, 'POST', `/cutover/steps/${f2.id}/complete`, { result: 'FAILED', detail: 'Legacy extracts incomplete: stores ledger missing.' })).json.data;
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.withinWindow, false);
  const rb = (await call(pm, 'POST', `/cutover/runs/${p2.id}/rollback`, { reason: 'Extracts incomplete; repeat next weekend.' })).json.data;
  assert.equal(rb.status, 'ROLLED_BACK'); assert.match(rb.restore, /Backup & Recovery/);
});

test('FR-01 UAT: scripts from the workflows and pages of the build, runs, defects and triage, the module signed by its owner', async () => {
  const { call, d } = await boot();
  const g = (await call(pm, 'POST', '/uat/scripts/generate', {})).json.data;
  assert.ok(g.added > 50, `scripts generated: ${g.added}`);
  assert.equal((await call(pm, 'POST', '/uat/scripts/generate', {})).json.data.added, 0, 'generating again adds nothing');
  const wf = d.prepare("SELECT COUNT(*) AS n FROM uat_scripts WHERE scenario_source = 'WORKFLOW'").get().n; assert.ok(wf > 10);
  // the procurement module: run its scripts as the roles named on them
  const scripts = d.prepare("SELECT * FROM uat_scripts WHERE module = 'proc' ORDER BY id").all();
  assert.ok(scripts.length >= 2);
  const [first, ...rest] = scripts;
  const fail = await call(se, 'POST', `/uat/scripts/${first.id}/run`, { result: 'FAIL', defect: { title: 'The approval chain skips the procurement manager above the limit', severity: 'S2' } });
  assert.equal(fail.status, 200, JSON.stringify(fail.json)); const defect = fail.json.data.defect; assert.match(defect.defectNo, /^UAT-/);
  assert.equal((await call(se, 'POST', `/uat/scripts/${first.id}/run`, { result: 'FAIL' })).status, 400, 'a failure names its defect');
  for (const s of rest) assert.equal((await call(se, 'POST', `/uat/scripts/${s.id}/run`, { result: 'PASS' })).status, 200);
  // the sign-off is refused while a script has not passed or an S2 is open
  assert.equal((await call(pm, 'POST', '/uat/signoffs', { module: 'proc', reason: 'UAT of procurement done' })).status, 422);
  // daily triage: owner, fixed in a commit, re-tested and closed by the reporter
  assert.equal((await call(se, 'POST', `/uat/defects/${defect.id}/triage`, { action: 'triage' })).status, 403, 'triage needs uat.triage');
  assert.equal((await call(pm, 'POST', `/uat/defects/${defect.id}/triage`, { action: 'triage', ownerId: 'gl-it', severity: 'S2' })).json.data.status, 'TRIAGED');
  assert.equal((await call(pm, 'POST', `/uat/defects/${defect.id}/triage`, { action: 'defer', reason: 'later' })).status, 422, 'a deferral says why');
  assert.equal((await call(it, 'POST', `/uat/defects/${defect.id}/triage`, { action: 'fix' })).status, 400, 'a fix names its commit');
  assert.equal((await call(it, 'POST', `/uat/defects/${defect.id}/triage`, { action: 'fix', fixedIn: 'b51e960c' })).json.data.status, 'FIXED');
  assert.equal((await call(it, 'POST', `/uat/defects/${defect.id}/triage`, { action: 'close' })).status, 403, 'the reporter re-tests and closes');
  assert.equal((await call(se, 'POST', `/uat/scripts/${first.id}/run`, { result: 'PASS', notes: 'Re-tested after b51e960c' })).status, 200);
  assert.equal((await call(pm, 'POST', `/uat/defects/${defect.id}/triage`, { action: 'close' })).json.data.status, 'CLOSED');
  // now the owner of procurement signs; the programme manager cannot
  const so = await call(pm, 'POST', '/uat/signoffs', { module: 'proc', reason: 'Every procurement script passed; no open S1/S2' });
  assert.equal(so.status, 201, JSON.stringify(so.json)); assert.equal(so.json.data.owner, 'PROCMGR');
  assert.equal((await call(se, 'POST', `/uat/scripts/${first.id}/run`, { result: 'PASS' })).status, 409, 'scripts are locked while the module is being signed');
  assert.equal((await call(pm, 'POST', `/requests/${so.json.data.request.id}/act`, { action: 'approve' })).status, 403);
  assert.equal((await call(procOwner, 'POST', `/requests/${so.json.data.request.id}/act`, { action: 'approve' })).json.data.status, 'APPROVED');
  const o = (await call(pm, 'GET', '')).json.data;
  assert.equal(o.uat.modules.find((m) => m.module === 'proc').signoff.status, 'SIGNED');
  assert.equal(o.checklist.items.find((i) => i.criterion === 'UAT_SIGNED').status, 'NOT_MET', 'the other modules are not signed yet');
  assert.ok(d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'golive.uat.module_signed'").get().n === 1);
});

test('FR-02 BR-01 the readiness checklist from the records; manual criteria with evidence; a GO is refused while a mandatory criterion is not met', async () => {
  const { call, d } = await boot();
  const c = (await call(pm, 'POST', '/evaluate', {})).json.data;
  assert.deepEqual(c.items.map((i) => i.criterion), CRITERIA.map((x) => x.code));
  assert.equal(c.ready, false);
  // gates: G1-G4 are recorded on Programme Gates; G5-G7 have no record in this build
  d.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at, created_by) VALUES (1, 'G1', 'Platform', 'PASSED', 'test', ?, 'test')").run(new Date().toISOString());
  const c2 = (await call(pm, 'POST', '/evaluate', {})).json.data;
  assert.equal(c2.items.find((i) => i.criterion === 'GATE_G1').status, 'MET');
  assert.match(c2.items.find((i) => i.criterion === 'GATE_G6').detail, /no record/);
  // training: 2 of 9 active users trained on the ERP course → not met; the measured percentage is shown
  const course = Number(d.prepare("INSERT INTO trn_courses (company_id, code, title, category, created_by) VALUES (1, 'ERP-USER', 'ERP user training', 'TECHNICAL', 'test')").run().lastInsertRowid);
  const session = Number(d.prepare("INSERT INTO trn_sessions (company_id, doc_no, doc_date, course_id, start_at, end_at, status, created_by) VALUES (1, 'TS-1', '2026-11-20', ?, '2026-11-20T04:00:00Z', '2026-11-20T08:00:00Z', 'COMPLETED', 'test')").run(course).lastInsertRowid);
  for (const u of ['gl-se', 'gl-pm']) {
    const uid = d.prepare('SELECT id FROM iam_users WHERE username = ?').get(u).id;
    const emp = Number(d.prepare("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, gender, dob, mobile, employment_type, doj, user_id, created_by) VALUES (1, ?, ?, ?, 'MALE', '1990-01-01', '9800000000', 'PERMANENT', '2024-04-01', ?, 'test')").run(`E-${u}`, u, u, uid).lastInsertRowid);
    d.prepare("INSERT INTO trn_attendance (company_id, session_id, person_type, person_id, attendance, passed, created_by) VALUES (1, ?, 'EMPLOYEE', ?, 'ATTENDED', 1, 'test')").run(session, emp);
  }
  const tr = (await call(pm, 'POST', '/evaluate', {})).json.data.items.find((i) => i.criterion === 'TRAINING');
  assert.equal(tr.status, 'NOT_MET'); assert.match(tr.detail, /2 of \d+ active users trained/); assert.ok(tr.measured > 0 && tr.measured < 90);
  // a manual criterion: its owner marks it met with evidence; a mandatory one cannot be waived; an optional one can, with a reason
  const support = c.items.find((i) => i.criterion === 'SUPPORT_MODEL'); const comms = c.items.find((i) => i.criterion === 'COMMUNICATION');
  assert.equal((await call(pm, 'POST', `/checklist/${support.id}`, { status: 'MET' })).status, 400, 'evidence is needed');
  assert.equal((await call(se, 'POST', `/checklist/${support.id}`, { status: 'MET', evidence: ['docs/erp/runbooks/support-model.md'] })).status, 403);
  assert.equal((await call(pm, 'POST', `/checklist/${support.id}`, { status: 'MET', evidence: ['docs/erp/runbooks/support-model.md', 'minutes of 20-Nov-2026'] })).json.data.status, 'MET');
  assert.equal((await call(pm, 'POST', `/checklist/${support.id}`, { status: 'WAIVED', note: 'not needed for the pilot' })).status, 422);
  assert.equal((await call(pm, 'POST', `/checklist/${comms.id}`, { status: 'WAIVED', note: 'The pilot company is told in person by the project director.' })).json.data.status, 'WAIVED');
  assert.equal((await call(pm, 'POST', `/checklist/${c.items.find((i) => i.criterion === 'SECURITY').id}`, { status: 'MET', evidence: ['docs/erp/COMPLETION/30.05.md'] })).status, 422, 'an automatic criterion is evaluated, not set');
  // BR-01 a GO is refused, with the criteria not met
  const go = await call(pm, 'POST', '/decisions', { meetingAt: new Date().toISOString(), attendees: ['Programme manager', 'CFO', 'Director'], recommendation: 'GO', goLiveAt: '2026-12-01T00:30:00.000Z', minutes: 'Readiness reviewed criterion by criterion; owners present.' });
  assert.equal(go.status, 422); assert.match(go.json.error.message, /BR-01/); assert.match(go.json.error.message, /GATE_G5/);
});

test('FR-04 the go/no-go decision through PCMGR → CFO → DIR (never by its author); FR-05 hypercare, the daily report and the handover', async () => {
  const { call, d } = await boot();
  assert.deepEqual(DECISION_CHAIN, ['PCMGR', 'CFO', 'DIR']);
  // a NO-GO decision (allowed whatever the criteria) goes through the whole chain
  const ng = await call(it, 'POST', '/decisions', { meetingAt: new Date().toISOString(), attendees: ['Programme manager', 'CFO', 'Director', 'IT'], recommendation: 'NO_GO', minutes: 'Gates G5 to G7 are not passed; meet again in two weeks.' });
  assert.equal(ng.status, 403, 'ITADM does not manage the go-live');
  const sub = await call(pm, 'POST', '/decisions', { meetingAt: new Date().toISOString(), attendees: ['Programme manager', 'CFO', 'Director', 'IT'], recommendation: 'NO_GO', minutes: 'Gates G5 to G7 are not passed; meet again in two weeks.' });
  assert.equal(sub.status, 201, JSON.stringify(sub.json)); const req = sub.json.data.requestId;
  assert.equal((await call(pm, 'POST', `/requests/${req}/act`, { action: 'approve' })).status, 403, 'the author does not approve');
  const pm2 = as('PCMGR', 'gl-pm2'); d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, ?, ?, ?)').run(pm2.user, pm2.user, '["PCMGR"]');
  assert.equal((await call(dir, 'POST', `/requests/${req}/act`, { action: 'approve' })).status, 403, 'not the director\'s step yet');
  assert.equal((await call(pm2, 'POST', `/requests/${req}/act`, { action: 'approve' })).json.data.status, 'SUBMITTED');
  assert.equal((await call(cfo, 'POST', `/requests/${req}/act`, { action: 'approve' })).json.data.status, 'SUBMITTED');
  assert.equal((await call(dir, 'POST', `/requests/${req}/act`, { action: 'approve' })).json.data.status, 'APPROVED');
  assert.equal(d.prepare('SELECT status FROM golive_decisions WHERE request_id = ?').get(req).status, 'APPROVED');
  assert.equal((await call(pm, 'POST', '/hypercare', {})).status, 422, 'a NO-GO opens no hypercare');
  // given a GO approved by the director (the readiness of this test company is not met: G5-G7 are not recorded in this build)
  d.prepare("INSERT INTO golive_decisions (company_id, decision_no, meeting_at, attendees_json, recommendation, go_live_at, minutes, status, decided_at, created_by) VALUES (1, 'GNG-FIX', ?, '[]', 'GO', ?, 'fixture: GO approved', 'APPROVED', ?, 'fixture')").run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  const h = await call(pm, 'POST', '/hypercare', { warRoom: ['PCMGR', 'ITADM', 'PROCMGR'] });
  assert.equal(h.status, 201, JSON.stringify(h.json)); assert.equal(h.json.data.status, 'ACTIVE');
  const weeks = (Date.parse(h.json.data.endDate) - Date.parse(h.json.data.startDate)) / (7 * 86_400_000); assert.equal(weeks, 4);
  // a hypercare defect, the day's figures, the war room publishes the report
  const def = (await call(se, 'POST', '/uat/defects', { module: 'site', title: 'DPR photos upload slowly on 2G at the dam site', severity: 'S2' })).json.data;
  assert.match(def.defectNo, /^HC-/); assert.equal(def.phase, 'HYPERCARE');
  const o = (await call(pm, 'GET', '')).json.data;
  const today = o.hypercare.days.find((x) => x.date === todayIST());
  assert.equal(today.opened, 1); assert.equal(today.openBy.S2, 1); assert.ok('ticketsOpened' in today.kpis && 'alerts' in today.kpis);
  assert.equal((await call(se, 'POST', `/hypercare/days/${todayIST()}/publish`, { triageNotes: 'x'.repeat(20) })).status, 403);
  const pub = (await call(it, 'POST', `/hypercare/days/${todayIST()}/publish`, { triageNotes: 'One S2 on DPR photo upload: owner ITADM, fix by tomorrow through the pipeline.' })).json.data;
  assert.equal(pub.status, 'PUBLISHED');
  assert.equal((await call(it, 'POST', `/hypercare/days/${todayIST()}/publish`, { triageNotes: 'again and again' })).status, 409);
  // the handover: not before the end of the period, not with an S2 open; then the director approves
  assert.equal((await call(pm, 'POST', '/hypercare/handover', { notes: 'Steady-state support takes over from Monday.' })).status, 422);
  d.prepare("UPDATE golive_hypercare SET end_date = '2026-01-01' WHERE company_id = 1").run();
  const blocked = await call(pm, 'POST', '/hypercare/handover', { notes: 'Steady-state support takes over from Monday.' });
  assert.equal(blocked.status, 422); assert.match(blocked.json.error.message, /S1\/S2/);
  await call(it, 'POST', `/uat/defects/${def.id}/triage`, { action: 'fix', fixedIn: 'de1c12b7' });
  await call(se, 'POST', `/uat/defects/${def.id}/triage`, { action: 'close' });
  const ho = (await call(pm, 'POST', '/hypercare/handover', { notes: 'Steady-state support (L1 help desk, L2 application team) takes over from Monday.' })).json.data;
  assert.equal(ho.status, 'HANDOVER_REQUESTED');
  assert.equal((await call(dir, 'POST', `/requests/${ho.handoverRequestId}/act`, { action: 'approve' })).json.data.status, 'APPROVED');
  assert.equal(d.prepare('SELECT status FROM golive_hypercare WHERE id = ?').get(ho.id).status, 'HANDED_OVER');
  // the production cut-over can now be planned (a GO is approved)
  assert.equal((await call(pm, 'POST', '/cutover/runs', { kind: 'PRODUCTION', windowMinutes: 720 })).status, 201);
});

test('AC-03 roles and exports: view, execute, triage and manage; others refused; the flag off hides it', async () => {
  const { call, api } = await boot();
  assert.equal((await call(aud, 'GET', '')).status, 200);
  assert.equal((await call(se, 'GET', '')).status, 403, 'a site engineer runs scripts but does not see the console');
  assert.equal((await call(aud, 'POST', '/uat/scripts/generate', {})).status, 403);
  assert.equal((await call(se, 'POST', '/uat/defects', { module: 'site', title: 'A defect raised by a site engineer', severity: 'S3' })).status, 201);
  for (const kind of ['checklist', 'uat', 'hypercare']) { const x = await api.raw('GET', `${T}/export?kind=${kind}&format=csv`, aud); assert.equal(x.status, 200, kind); }
  assert.equal((await api.raw('GET', `${T}/export?kind=uat&format=csv`, se)).status, 403);
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.qa.p3010'").run();
  assert.equal((await call(pm, 'GET', '')).status, 404);
});
