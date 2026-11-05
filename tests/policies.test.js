import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { sanitizeHtml, compareHtml } from '../src/server/modules/pol/richtext.js';
import { policiesOf } from '../src/server/modules/pol/service.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 05.05: company policies. T-01 the applicability resolves the right recipients and the acknowledgement percentage is exact; T-02 a converted requirement is a draft control point that is OFF until an administrator
// activates it in the engine that owns it. Also: a published version is never edited (BR-01), a revision goes through the approval again, versions are compared, reminders, escalation and review dates.
const P = '/api/v1/pol';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'p') => ({ ...json, 'idempotency-key': `pol-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const hr = as('HRMGR', 'hr1');
const cfo = as('CFO', 'cfo1');
const dir = as('DIR', 'dir1');
const aud = as('AUD', 'aud1');
const sys = as('SYSADM', 'sys1');
const it = as('ITADM', 'it1');
const se = as('SE', 'se1');
const emp = as('EMP', 'emp1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const user = (api, name, roles) => Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Kumar`, JSON.stringify(roles), `${name}@example.com`).lastInsertRowid);
const act = async (api, who, instanceId, action = 'approve', comment = 'checked and fine') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task`);
  assert.equal((await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } })).status, 200);
};
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  const ids = {};
  for (const [n, r] of [['hr1', ['HRMGR']], ['cfo1', ['CFO']], ['dir1', ['DIR']], ['aud1', ['AUD']], ['sys1', ['SYSADM']], ['it1', ['ITADM']], ['pm1', ['PM']], ['se1', ['SE']], ['se2', ['SE']], ['emp1', ['EMP']], ['emp2', ['EMP']], ['pd1', ['PD']]]) ids[n] = user(api, n, r);
  const events = [];
  realtimeOf(api.db).setEmitter(async ({ room, event }) => { events.push({ room, ...event }); });
  const call = (who, method, path, body, k) => api.call(method, `${P}${path}`, { ...who, headers: key(k), body });
  const dept = Number(api.db.prepare("INSERT INTO org_departments (company_id, code, name, status, created_by, source_type) VALUES (1, 'OPS', 'Operations', 'ACTIVE', 't', 't')").run().lastInsertRowid);
  for (const u of ['emp1', 'emp2']) api.db.prepare("INSERT INTO iam_user_profiles (company_id, user_id, department_id, created_by, source_type) VALUES (1, ?, ?, 't', 't')").run(ids[u], dept);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'ALPHA', 'Alpha', 'ROAD', 'ACTIVE', 't', 't')").run().lastInsertRowid);
  const site = Number(api.db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (1, ?, 'ALP-S1', 'Alpha yard', 'ACTIVE', 't', 't')").run(project).lastInsertRowid);
  const assign = (username, roleCode, scopeType, scopeIds) => api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL), ?, ?, 'ACTIVE', 'test', 'test', 'test')").run(ids[username], roleCode, scopeType, JSON.stringify(scopeIds));
  const runtime = runtimeOf(api.db);
  const body = (over = {}) => ({ title: 'Leave policy', category: 'HR', body: '<h1>Leave</h1><p>Employees get 24 days of leave a year.</p><p>Leave is applied for in advance.</p>', changeSummary: '', applicability: { departments: [dept] }, effectiveFrom: day(0), reviewDue: day(365), quiz: [], passMark: 100, ackDueDays: 14, ...over });
  /** A policy through the whole approval: the department head (CFO) and then the director; the owner cannot approve. */
  const publish = async (who, over = {}) => {
    const made = await call(who, 'POST', '/policies', body(over));
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const vid = made.json.data.working.id;
    const sub = await call(who, 'POST', `/versions/${vid}/submit`, {});
    assert.equal(sub.status, 202, JSON.stringify(sub.json));
    await act(api, cfo, sub.json.data.workflow.id);
    await act(api, dir, sub.json.data.workflow.id);
    return { id: made.json.data.id, versionId: vid };
  };
  return { api, call, events, ids, dept, project, site, assign, runtime, body, publish };
};
const cycle = (t) => policiesOf(t.api.db).cycle(1);

test('T-01 FR-01 FR-03 BR-01 a policy through its approval: the owner writes, the department head and the director approve, publication tells exactly the people it applies to, a published version cannot be edited', async () => {
  const t = await setup();
  t.assign('se1', 'SE', 'PROJECT', [t.project]);
  assert.equal((await t.call(se, 'POST', '/policies', t.body())).status, 403, 'only the owners of policies write them');
  assert.equal((await t.call(hr, 'POST', '/policies', t.body({ title: 'x' }))).status, 400, 'a title is needed');
  assert.equal((await t.call(hr, 'POST', '/policies', t.body({ departmentId: 999 }))).status, 422);
  const made = await t.call(hr, 'POST', '/policies', t.body({ body: '<p>Leave</p><script>alert(1)</script><p onclick="x()">Apply in advance, <a href="javascript:evil()">link</a> and <a href="https://example.com/hr">the form</a>.</p>' }));
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const p = made.json.data;
  assert.match(p.policyNo, /^POL-0001$/);
  assert.deepEqual([p.status, p.currentVersion, p.versionStatus], ['DRAFT', 1, 'DRAFT']);
  assert.doesNotMatch(p.working.bodyHtml, /script|onclick|javascript:/, 'the rich text is cleaned on the server');
  assert.match(p.working.bodyHtml, /<a href="https:\/\/example.com\/hr"/);
  // nobody else sees a draft; the register is for those who may see it
  assert.equal((await t.call(se, 'GET', `/policies/${p.id}`)).status, 404);
  assert.equal((await t.call(se, 'GET', '/policies')).status, 403);
  assert.equal((await t.call(cfo, 'GET', `/policies/${p.id}`)).status, 200, 'another owner of policies sees the register');
  assert.equal((await t.call(cfo, 'PUT', `/versions/${p.working.id}`, { ...t.body(), version: p.working.rowVersion })).status, 403, 'but only the owner changes it');
  // what must be there before it is sent
  const empty = await t.call(hr, 'POST', '/policies', t.body({ title: 'Empty policy', body: '<p>x</p>', applicability: {}, effectiveFrom: null }));
  assert.equal((await t.call(hr, 'POST', `/versions/${empty.json.data.working.id}/submit`, {})).status, 422);
  assert.equal((await t.call(hr, 'POST', `/versions/${p.working.id}/submit`, {})).status, 202);
  // the chain: the owner cannot approve; the department head, then the director
  const inst = (await t.call(hr, 'GET', `/policies/${p.id}`)).json.data.working.instanceId;
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, hr)).json.data.rows.find((x) => x.instance.id === inst), undefined, 'the owner cannot approve their own policy');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.find((x) => x.instance.id === inst), undefined, 'the director comes after the department head');
  assert.equal((await t.call(hr, 'PUT', `/versions/${p.working.id}`, { ...t.body(), version: p.working.rowVersion })).status, 409, 'in approval it cannot be edited');
  await act(t.api, cfo, inst);
  assert.equal((await t.call(hr, 'GET', `/policies/${p.id}`)).json.data.status, 'DRAFT', 'half approved is not published');
  await act(t.api, dir, inst);
  const pub = (await t.call(hr, 'GET', `/policies/${p.id}`)).json.data;
  assert.deepEqual([pub.status, pub.versionStatus], ['ACTIVE', 'ACTIVE'], 'effective today: in force');
  // T-01: the applicability is the Operations department: emp1 and emp2, nobody else
  const rep = (await t.call(hr, 'GET', `/policies/${p.id}/acknowledgements`)).json.data;
  assert.deepEqual(rep.rows.map((r) => r.username).sort(), ['emp1', 'emp2']);
  assert.deepEqual([rep.stats.recipients, rep.stats.acknowledged, rep.stats.percent], [2, 0, 0]);
  for (const u of ['emp1', 'emp2']) assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'pol.published' AND user_ref = ?").get(u), `${u} was told`);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'pol.published'").get().n, 2, 'and nobody else');
  const published = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'pol.policy.published'").get();
  assert.ok(published, 'the publication is an event');
  assert.equal(JSON.parse(published.payload).data.recipients, 2);
  // BR-01: a published version is never edited
  const e = await t.call(hr, 'PUT', `/versions/${pub.current.id}`, { ...t.body(), version: pub.current.rowVersion });
  assert.equal(e.status, 409);
  assert.match(e.json.error.message, /new version/);
  // the acknowledgement percentage follows the people who acknowledged
  assert.equal((await t.call(emp, 'POST', '/acknowledge', { versionId: pub.current.id })).status, 200);
  const r2 = (await t.call(hr, 'GET', `/policies/${p.id}/acknowledgements`)).json.data;
  assert.deepEqual([r2.stats.acknowledged, r2.stats.percent], [1, 50]);
  assert.equal((await t.call(se, 'POST', '/acknowledge', { versionId: pub.current.id })).status, 404, 'it does not apply to a site engineer');
  assert.equal((await t.call(emp, 'POST', '/acknowledge', { versionId: pub.current.id })).json.data.replay, true, 'twice is once');
  // the register shows the percentage
  const reg = (await t.call(dir, 'GET', '/policies')).json.data;
  assert.equal(reg.rows.find((r) => r.policyNo === 'POL-0001').stats.percent, 50);
  assert.equal(reg.total, 2, 'the published policy and the draft written above');
  // other kinds of applicability: a role, a project, a site, everyone; the union of them
  const rec = (a) => policiesOf(t.api.db).recipientsOf(1, a).sort();
  assert.deepEqual(rec({ roles: ['SE'] }), ['se1', 'se2'].sort());
  assert.deepEqual(rec({ projects: [t.project] }), ['se1']);
  assert.deepEqual(rec({ sites: [t.site] }), ['se1'], 'an assignment to the site\'s project covers the site');
  assert.deepEqual(rec({ departments: [t.dept], roles: ['PM'] }), ['emp1', 'emp2', 'pm1']);
  assert.equal(rec({ all: true }).length, 12);
  assert.deepEqual(rec({}), []);
  assert.equal((await t.call(hr, 'POST', '/policies/preview', { applicability: { roles: ['SE'] } })).json.data.recipients, 2);
});

test('FR-02 FR-06 a revision is a new version through the approval again; the old one is superseded and kept read-only; versions are compared', async () => {
  const t = await setup();
  const pol = await t.publish(hr);
  const rev = await t.call(hr, 'POST', `/policies/${pol.id}/versions`);
  assert.equal(rev.status, 201, JSON.stringify(rev.json));
  const d = rev.json.data;
  assert.equal(d.status, 'UNDER_REVISION');
  assert.equal(d.working.version, 2);
  assert.equal((await t.call(hr, 'POST', `/policies/${pol.id}/versions`)).status, 409, 'one revision at a time');
  assert.equal((await t.call(cfo, 'POST', `/policies/${pol.id}/versions`)).status, 403, 'only the owner revises');
  // the version in force stays in force while the revision is written
  assert.equal(d.current.version, 1);
  assert.equal(d.current.status, 'ACTIVE');
  // a change summary is required for a revision
  const edit = (over) => t.call(hr, 'PUT', `/versions/${d.working.id}`, { ...t.body({ body: '<h1>Leave</h1><p>Employees get 30 days of leave a year.</p><p>Leave is applied for in advance.</p><p>Unused leave is paid out.</p>', ...over }), version: d.working.rowVersion });
  const saved = await edit({ changeSummary: '' });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await t.call(hr, 'POST', `/versions/${d.working.id}/submit`, {})).status, 422, 'the approvers must be told what changed');
  const saved2 = await t.call(hr, 'PUT', `/versions/${d.working.id}`, { ...t.body({ body: saved.json.data.working.bodyHtml, changeSummary: 'Leave raised from 24 to 30 days; unused leave is paid out' }), version: saved.json.data.working.rowVersion });
  assert.equal(saved2.status, 200, JSON.stringify(saved2.json));
  const stale = await t.call(hr, 'PUT', `/versions/${d.working.id}`, { ...t.body(), version: d.working.rowVersion });
  assert.equal(stale.status, 409, 'a stale draft is refused');
  const sub = await t.call(hr, 'POST', `/versions/${d.working.id}/submit`, {});
  assert.equal(sub.status, 202, JSON.stringify(sub.json));
  await act(t.api, cfo, sub.json.data.workflow.id);
  await act(t.api, dir, sub.json.data.workflow.id);
  const after2 = (await t.call(hr, 'GET', `/policies/${pol.id}`)).json.data;
  assert.deepEqual([after2.status, after2.currentVersion], ['ACTIVE', 2]);
  assert.deepEqual(after2.versions.map((v) => [v.version, v.status]), [[2, 'ACTIVE'], [1, 'SUPERSEDED']]);
  // superseded: kept, readable by the people who had it, not acknowledgeable any more
  const old = (await t.call(emp, 'POST', `/versions/${d.working.id - 1}/read`)).json.data;
  assert.equal(old.readOnly, true);
  assert.match(old.version.bodyHtml, /24 days/);
  assert.equal((await t.call(emp, 'POST', '/acknowledge', { versionId: d.working.id - 1 })).status, 409);
  const mine = (await t.call(emp, 'GET', '/my')).json.data;
  assert.deepEqual(mine.rows.map((r) => r.version), [2]);
  assert.deepEqual(mine.history.map((r) => r.version), [1]);
  assert.equal(mine.counts.toAcknowledge, 1);
  // the comparison: one paragraph changed, one added
  const cmp = (await t.call(hr, 'GET', `/policies/${pol.id}/compare?from=${d.working.id - 1}&to=${d.working.id}`)).json.data;
  assert.deepEqual([cmp.summary.changed, cmp.summary.added, cmp.summary.removed], [1, 1, 0]);
  const change = cmp.rows.find((r) => r.type === 'change');
  assert.ok(change.words.some((w) => w.t === 'del' && w.text === '24') && change.words.some((w) => w.t === 'add' && w.text === '30'));
  assert.equal((await t.call(se, 'GET', `/policies/${pol.id}/compare?from=1&to=2`)).status, 404);
  assert.deepEqual(compareHtml('<p>a</p>', '<p>a</p>').summary, { added: 0, removed: 0, changed: 0, same: 1 });
  // a rejected version ends; the owner can revise again
  const rev3 = await t.call(hr, 'POST', `/policies/${pol.id}/versions`);
  const v3 = rev3.json.data.working;
  await t.call(hr, 'PUT', `/versions/${v3.id}`, { ...t.body({ changeSummary: 'Another change' }), version: v3.rowVersion });
  const sub3 = await t.call(hr, 'POST', `/versions/${v3.id}/submit`, {});
  await act(t.api, cfo, sub3.json.data.workflow.id, 'reject', 'This does not match the labour code');
  const rejected = (await t.call(hr, 'GET', `/policies/${pol.id}`)).json.data;
  assert.equal(rejected.versions[0].status, 'REJECTED');
  assert.equal(rejected.status, 'ACTIVE', 'version 2 stays in force');
  assert.equal((await t.call(hr, 'POST', `/policies/${pol.id}/versions`)).status, 201);
  // archive
  assert.equal((await t.call(hr, 'POST', `/policies/${pol.id}/archive`, { reason: 'x' })).status, 400);
  assert.equal((await t.call(hr, 'POST', `/policies/${pol.id}/archive`, { reason: 'Replaced by the HR handbook' })).status, 409, 'finish the draft first');
});

test('FR-04 the knowledge check: a pass mark, wrong answers can be tried again, the score and the tries are kept', async () => {
  const t = await setup();
  const quiz = [{ q: 'How many days of leave a year?', options: ['20', '24', '30'], correct: 1 }, { q: 'When is leave applied for?', options: ['After', 'In advance'], correct: 1 }, { q: 'Who approves leave?', options: ['The manager', 'Nobody'], correct: 0 }];
  assert.equal((await t.call(hr, 'POST', '/policies', t.body({ quiz: [{ q: 'Which?', options: ['a', 'b'], correct: 4 }] }))).status, 400);
  const pol = await t.publish(hr, { quiz, passMark: 67 });
  const vid = (await t.call(hr, 'GET', `/policies/${pol.id}`)).json.data.current.id;
  const read = (await t.call(emp, 'POST', `/versions/${vid}/read`)).json.data;
  assert.equal(read.version.quiz[0].correct, undefined, 'the answers are not sent to a reader');
  assert.equal(read.canAcknowledge, true);
  assert.equal((await t.call(emp, 'POST', '/acknowledge', { versionId: vid, answers: [1] })).status, 422, 'all questions');
  const bad = (await t.call(emp, 'POST', '/acknowledge', { versionId: vid, answers: [0, 0, 1] })).json.data;
  assert.deepEqual([bad.passed, bad.score, bad.right], [false, 0, 0]);
  assert.equal((await t.call(hr, 'GET', `/policies/${pol.id}/acknowledgements`)).json.data.stats.acknowledged, 0);
  const ok = (await t.call(emp, 'POST', '/acknowledge', { versionId: vid, answers: [1, 1, 1] })).json.data;
  assert.deepEqual([ok.passed, ok.score, ok.right], [true, 67, 2], '2 of 3 reaches the pass mark of 67');
  const row = (await t.call(hr, 'GET', `/policies/${pol.id}/acknowledgements`)).json.data.rows.find((r) => r.username === 'emp1');
  assert.deepEqual([row.status, row.quizScore, row.attempts], ['ACKNOWLEDGED', 67, 2]);
  const recorded = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'pol.acknowledgement.recorded'").all().map((r) => JSON.parse(r.payload).data);
  assert.deepEqual(recorded.map((d) => [d.user, d.quizScore, d.onTime]), [['emp1', 67, true]], 'one event, for the pass (HR and performance read it)');
  // the owner and the register see the author's view with the answers
  assert.equal((await t.call(hr, 'GET', `/policies/${pol.id}`)).json.data.current.quiz[0].correct, 1);
  const csv = await t.api.raw('GET', `${P}/policies/${pol.id}/acknowledgements/export`, hr);
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString('utf8'), /Person,User,Status,Due/);
});

test('FR-03 FR-06 the job: a future effective date, new people, reminders, escalation to managers, review dates', async () => {
  const t = await setup();
  const pol = await t.publish(hr, { effectiveFrom: day(3), reviewDue: day(20), ackDueDays: 2 });
  const view = (await t.call(hr, 'GET', `/policies/${pol.id}`)).json.data;
  assert.deepEqual([view.status, view.versionStatus], ['PUBLISHED', 'PUBLISHED'], 'approved, not yet in force');
  assert.equal(view.stats.recipients, 2, 'but already sent to the people it applies to');
  assert.equal((await t.call(emp, 'POST', '/acknowledge', { versionId: pol.versionId })).status, 200, 'it can be acknowledged before it takes effect');
  // a person who comes into scope later is added by the job and told
  t.api.db.prepare("UPDATE pol_versions SET applicability_json = ? WHERE id = ?").run(JSON.stringify({ departments: [t.dept], roles: ['PM'] }), pol.versionId);
  let out = cycle(t);
  assert.equal(out.added, 1, 'pm1 now applies: added and told');
  assert.ok(t.api.db.prepare("SELECT 1 FROM pol_acknowledgements WHERE user_ref = 'pm1'").get());
  assert.equal(cycle(t).added, 0);
  // reminders every three days, at most five; none for who acknowledged
  assert.equal(out.reminded, 0);
  t.api.db.prepare("UPDATE pol_acknowledgements SET notified_at = ?, created_at = ?").run(new Date(Date.now() - 4 * 86_400_000).toISOString(), new Date(Date.now() - 4 * 86_400_000).toISOString());
  out = cycle(t);
  assert.equal(out.reminded, 2, 'emp2 and pm1 (emp1 acknowledged)');
  assert.equal(cycle(t).reminded, 0, 'not again the same day');
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'pol.ack.reminder' AND user_ref = 'emp2'").get());
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'pol.ack.reminder' AND user_ref = 'emp1'").get().n, 0);
  // the effective date arrives: the version is in force
  t.api.db.prepare("UPDATE pol_versions SET effective_from = ? WHERE id = ?").run(day(0), pol.versionId);
  assert.equal(cycle(t).activated, 1);
  assert.equal((await t.call(hr, 'GET', `/policies/${pol.id}`)).json.data.status, 'ACTIVE');
  // past the due date: escalated once, to the owner and the managers above on the escalation path
  t.api.db.prepare("UPDATE pol_acknowledgements SET due_at = ? WHERE acknowledged_at IS NULL").run(new Date(Date.now() - 3600_000).toISOString());
  out = cycle(t);
  assert.equal(out.escalated, 2);
  assert.equal(cycle(t).escalated, 0, 'once');
  const told = t.api.db.prepare("SELECT user_ref FROM ntf_notifications WHERE template_code = 'pol.ack.overdue'").all().map((r) => r.user_ref);
  assert.ok(told.includes('hr1'), 'the owner is told');
  assert.ok(told.includes('pd1'), `the manager above on the escalation path is told too: ${told.join(',')}`);
  const report = (await t.call(hr, 'GET', `/policies/${pol.id}/acknowledgements?status=OVERDUE`)).json.data.rows;
  assert.deepEqual(report.map((r) => r.username).sort(), ['emp2', 'pm1']);
  // the review date: a notice when it is near, and the register flags it
  t.api.db.prepare("UPDATE pol_policies SET review_due = ? WHERE id = ?").run(day(10), pol.id);
  assert.equal(cycle(t).reviewNotices, 1);
  assert.equal(cycle(t).reviewNotices, 0, 'one notice');
  assert.equal((await t.call(hr, 'GET', '/policies?review=due')).json.data.total, 1);
  t.api.db.prepare("UPDATE pol_policies SET review_due = ? WHERE id = ?").run(day(-2), pol.id);
  assert.equal(cycle(t).reviewNotices, 1, 'and another when it is overdue');
  assert.equal((await t.call(hr, 'GET', '/policies?review=overdue')).json.data.total, 1);
});

test('T-02 FR-05 BR-02 policy-to-protocol: a requirement becomes a draft that is inactive until an administrator activates it in its own engine', async () => {
  const t = await setup();
  const made = await t.call(hr, 'POST', '/policies', t.body({ title: 'Purchase policy', category: 'PROCUREMENT' }));
  const v = made.json.data.working;
  const control = { code: 'CP-PROC-90', module: 'proc', stage: 'APPROVE', description: 'A purchase above the limit needs the procurement manager', enforcement: 'EXCEPTION', rule: { field: 'amount', op: 'gt', value: 500000 }, ownerRole: 'PROCMGR' };
  const req = async (body, who = hr) => t.call(who, 'POST', '/requirements', { versionId: v.id, ...body });
  assert.equal((await req({ clauseRef: '4.2', requirementText: 'A purchase above 5 lakh needs the procurement manager', artifactType: 'CONTROL_POINT', config: { code: 'bad' } })).status, 422, 'the control is validated by the control engine');
  assert.equal((await req({ clauseRef: '4.2', requirementText: 'A purchase above 5 lakh needs the procurement manager', artifactType: 'CONTROL_POINT', config: control }, se)).status, 404, 'not theirs');
  assert.equal((await req({ clauseRef: '4.2', requirementText: 'A purchase above 5 lakh needs the procurement manager', artifactType: 'CONTROL_POINT', config: control }, cfo)).status, 403, 'another owner of policies may not tag this one');
  const ok = await req({ clauseRef: '4.2', requirementText: 'A purchase above 5 lakh needs the procurement manager', artifactType: 'CONTROL_POINT', config: control });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const rid = ok.json.data.id;
  // not before the policy is approved
  const early = await t.call(hr, 'POST', `/requirements/${rid}/convert`, {});
  assert.equal(early.status, 422);
  assert.match(early.json.error.message, /approved policy/);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM pcs_control_points WHERE code = ?').get('CP-PROC-90').n, 0);
  const sub = await t.call(hr, 'POST', `/versions/${v.id}/submit`, {});
  await act(t.api, cfo, sub.json.data.workflow.id);
  await act(t.api, dir, sub.json.data.workflow.id);
  assert.equal((await t.call(se, 'POST', `/requirements/${rid}/convert`, {})).status, 404);
  const done = await t.call(hr, 'POST', `/requirements/${rid}/convert`, {});
  assert.equal(done.status, 201, JSON.stringify(done.json));
  assert.deepEqual([done.json.data.status, done.json.data.artifact.entity, done.json.data.artifact.state], ['DRAFTED', 'pcs_control_points', 'DRAFT']);
  // T-02: the control exists, OFF, and nothing is enforced
  const cp = t.api.db.prepare('SELECT * FROM pcs_control_points WHERE code = ?').get('CP-PROC-90');
  assert.deepEqual([cp.mode, cp.source_type, cp.source_id, cp.created_by], ['OFF', 'pol_requirement', String(rid), 'hr1']);
  const { protocolOf } = await import('../src/server/platform/protocol/index.js');
  const checked = protocolOf(t.api.db).check({ user: 'x', companyId: 1, roles: ['PM'] }, 'CP-PROC-90', { entity: 'sample_po', entityId: 1, amount: 900000 });
  assert.equal(checked.outcome === 'pass' || checked.mode === 'OFF', true, 'a control that is OFF never blocks');
  assert.equal((await t.call(hr, 'POST', `/requirements/${rid}/convert`, {})).status, 409, 'once');
  assert.equal((await t.call(hr, 'PUT', `/requirements/${rid}`, { clauseRef: '4.3' })).status, 409, 'a drafted requirement is not edited');
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'pol.requirement.drafted' AND user_ref = 'sys1'").get(), 'the administrators are told');
  // the administrators' worklist: not for others; the state is the engine's own
  assert.equal((await t.call(hr, 'GET', '/drafts')).status, 403);
  const list = (await t.call(sys, 'GET', '/drafts')).json.data;
  assert.equal(list.rows.length, 1);
  assert.deepEqual([list.rows[0].artifact.state, list.rows[0].policyNo, list.rows[0].canReview], ['DRAFT', 'POL-0001', true]);
  assert.equal((await t.call(it, 'GET', '/drafts')).json.data.rows[0].canReview, false, 'the IT administrator sees it but does not manage control points');
  // the administrator activates it in the control engine: OBSERVE first (never auto-activated by the policy)
  t.api.db.prepare("UPDATE pcs_control_points SET mode = 'OBSERVE' WHERE code = 'CP-PROC-90'").run();
  assert.equal((await t.call(sys, 'GET', '/drafts?state=ACTIVE')).json.data.rows.length, 1);
  assert.equal((await t.call(sys, 'GET', '/drafts?state=DRAFT')).json.data.rows.length, 0);
  // an approval rule becomes a DRAFT matrix version; an alert rule a rule that is switched off
  const v2 = (await t.call(hr, 'GET', `/policies/${made.json.data.id}`)).json.data.current;
  const matrixReq = await t.call(hr, 'POST', '/requirements', { versionId: v2.id, clauseRef: '5.1', requirementText: 'A purchase order above 10 lakh needs the director', artifactType: 'APPROVAL_RULE', config: { docType: 'PO', name: 'Above ten lakh: director', conditions: [{ field: 'amount', op: 'gt', value: 1000000 }], steps: [{ role: 'PROCMGR' }, { role: 'DIR' }] } });
  assert.equal(matrixReq.status, 201, JSON.stringify(matrixReq.json));
  assert.equal((await t.call(hr, 'POST', '/requirements', { versionId: v2.id, clauseRef: '5.2', requirementText: 'A step with a role nobody holds', artifactType: 'APPROVAL_RULE', config: { docType: 'PO', name: 'Bad', steps: [{ role: 'NOBODY' }] } })).status, 422);
  const m = await t.call(hr, 'POST', `/requirements/${matrixReq.json.data.id}/convert`, {});
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const draftMatrix = t.api.db.prepare("SELECT * FROM wf_matrix WHERE source_type = 'pol_requirement'").get();
  assert.deepEqual([draftMatrix.status, draftMatrix.doc_type], ['DRAFT', 'PO']);
  assert.equal(t.api.db.prepare('SELECT name FROM wf_matrix_rules WHERE matrix_id = ? AND priority = 1').get(draftMatrix.id).name, 'Above ten lakh: director', 'the new rule is first in the draft');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM wf_matrix WHERE doc_type = 'PO' AND status = 'ACTIVE'").get().n, 1, 'the matrix in force is unchanged');
  const alertReq = await t.call(hr, 'POST', '/requirements', { versionId: v2.id, clauseRef: '6.1', requirementText: 'Tell the procurement manager when a PO is created above 10 lakh', artifactType: 'ALERT_RULE', config: { code: 'pol.po_large', name: 'Large purchase order', triggerType: 'EVENT', eventType: 'eng.sample_doc.created', condition: { all: [] }, actions: [{ type: 'notify', to: ['role:PROCMGR'] }], messageTemplate: 'A large purchase order was created', severity: 'WARNING' } });
  assert.equal(alertReq.status, 201, JSON.stringify(alertReq.json));
  const a = await t.call(hr, 'POST', `/requirements/${alertReq.json.data.id}/convert`, {});
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const alertRow = t.api.db.prepare("SELECT enabled, source_type FROM alr_rules WHERE code = 'pol.po_large'").get();
  assert.deepEqual([alertRow.enabled, alertRow.source_type], [0, 'pol_requirement'], 'switched off');
  const states = (await t.call(sys, 'GET', '/drafts')).json.data.rows.map((r) => [r.artifactType, r.artifact.state]).sort();
  assert.deepEqual(states, [['ALERT_RULE', 'DRAFT'], ['APPROVAL_RULE', 'DRAFT'], ['CONTROL_POINT', 'ACTIVE']]);
  // dismiss: only by someone who manages that engine
  assert.equal((await t.call(it, 'POST', `/requirements/${a.json.data.id}/dismiss`, { reason: 'Not needed any more' })).status, 403);
  assert.equal((await t.call(sys, 'POST', `/requirements/${a.json.data.id}/dismiss`, { reason: 'Not needed any more' })).json.data.status, 'DISMISSED');
  // the trace link back to the policy is requested by event
  for (let i = 0; i < 6; i += 1) t.runtime.bus.drain();
  assert.ok(t.api.db.prepare("SELECT 1 FROM col_trace_links WHERE from_entity = 'pol_policy' AND from_id = ?").get(String(made.json.data.id)), 'linked back in the trace');
});

test('AC-03 isolation and rights: employees see only what applies to them, no register, other companies nothing; the flag switches the API off', async () => {
  const t = await setup();
  const pol = await t.publish(hr);
  assert.equal((await t.call(emp, 'GET', '/policies')).status, 403);
  assert.equal((await t.call(emp, 'GET', `/policies/${pol.id}`)).status, 404);
  assert.equal((await t.call(se, 'POST', `/versions/${pol.versionId}/read`)).status, 404, 'a policy that does not apply to someone is not theirs to read');
  assert.equal((await t.call(se, 'GET', '/my')).json.data.rows.length, 0);
  assert.equal((await t.call(emp, 'GET', '/my')).json.data.rows.length, 1);
  assert.equal((await t.call(aud, 'GET', `/policies/${pol.id}`)).status, 200, 'the auditor reads the register');
  assert.equal((await t.call(aud, 'POST', '/policies', t.body())).status, 403);
  assert.equal((await t.call(emp, 'GET', '/requirements')).json.data.rows.length, 0);
  assert.equal((await t.call(emp, 'POST', '/requirements', { versionId: pol.versionId, clauseRef: '1', requirementText: 'something', artifactType: 'ALERT_RULE', config: {} })).status, 404);
  t.api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'OTHER', 'Other Pvt Ltd', 'Other', 't', 'test')").run();
  t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'otherhr', 'Other HR', '[\"HRMGR\"]', 'o@example.com')").run();
  const foreign = { roles: 'HRMGR', user: 'otherhr', company: '2' };
  assert.equal((await t.call(foreign, 'GET', `/policies/${pol.id}`)).status, 404);
  assert.equal((await t.call(foreign, 'GET', '/policies')).json.data.total, 0);
  assert.equal((await t.call(foreign, 'POST', `/versions/${pol.versionId}/read`)).status, 404);
  // the employee-facing read marks it read; a recipient's own acknowledgement is theirs only
  const r = (await t.call(emp, 'POST', `/versions/${pol.versionId}/read`)).json.data;
  assert.ok(r.mine.readAt);
  assert.equal((await t.call(as('EMP', 'emp2'), 'GET', '/my')).json.data.rows[0].status, 'TO_ACKNOWLEDGE', 'emp2 has not acknowledged just because emp1 did');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.msg.p0505'").run();
  assert.equal((await t.call(emp, 'GET', '/my')).status, 404);
});

test('FR-02 the rich text is cleaned: an allow-list of tags, safe links, no scripts or handlers', () => {
  assert.equal(sanitizeHtml('<p>Hello <b>world</b></p>'), '<p>Hello <b>world</b></p>');
  assert.equal(sanitizeHtml('<script>alert(1)</script><p>x</p>'), '<p>x</p>');
  assert.equal(sanitizeHtml('<p onclick="x()" style="color:red">x</p>'), '<p>x</p>');
  assert.equal(sanitizeHtml('<a href="javascript:evil()">a</a>'), '<a>a</a>');
  assert.equal(sanitizeHtml('<a href="https://example.com/a?b=1">a</a>'), '<a href="https://example.com/a?b=1" rel="noopener noreferrer" target="_blank">a</a>');
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)><p>y</p>'), '<p>y</p>');
  assert.equal(sanitizeHtml('1 < 2 & 3 > 2'), '1 &lt; 2 &amp; 3 &gt; 2');
  assert.equal(sanitizeHtml('<iframe src="x">inner</iframe>ok'), 'ok');
  assert.equal(todayIST().length, 10);
});
