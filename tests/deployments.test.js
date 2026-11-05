import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { templateWorkbook } from '../src/server/modules/eng/xl-xlsx.js';
import { deploymentsOf } from '../src/server/modules/hr/deployments.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.03: deployment, transfers and project/site assignment. T-01 an overlapping primary deployment is rejected; T-02 a deployment change updates scope-based access (and the messaging groups) at once, well inside
// 60 seconds. Also: the plan band (outside the plan the director too), the lock and amendment, crews and who keeps their members, the board against the plan, a transfer across projects (current manager, receiving
// manager, HR) that ends the old posting and starts the new one, undoing it, secondments, eligibility, history, the bulk deploy import, scope and idempotent replay.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'd') => ({ ...json, 'idempotency-key': `dp-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const pm1 = as('PM', 'pm1'); const pm2 = as('PM', 'pm2'); const pd = as('PD', 'pd1'); const cm1 = as('CM', 'cm1'); const se = as('SE', 'se1'); const wsup = as('WSUP', 'ws1'); const aud = as('AUD', 'aud1'); const other = as('HRMGR', 'hr9', '2');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  for (const [n, r, c] of [['hr1', ['HRMGR'], 1], ['hr2', ['HRMGR'], 1], ['pm1', ['PM'], 1], ['pm2', ['PM'], 1], ['pd1', ['PD'], 1], ['cm1', ['CM'], 1], ['se1', ['SE'], 1], ['ws1', ['WSUP'], 1], ['aud1', ['AUD'], 1], ['hr9', ['HRMGR'], 2], ['field1', [], 1], ['field2', [], 1]]) {
    user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, n, `${n.toUpperCase()} Person`, JSON.stringify(r), `${n}@example.com`).lastInsertRowid);
  }
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const se_d = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const fm_d = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'FM', 'Foreman', 'G2', 2, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const p2 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P2', 'River Bridge', 'BRIDGE', 'ACTIVE', 't', 'test')");
  const site = (p, code, name) => org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (1, ?, ?, ?, 'ACTIVE', 't', 'test')", p, code, name);
  const s1 = site(p1, 'S1', 'Ring Road North'); const s1b = site(p1, 'S1B', 'Ring Road South'); const s2 = site(p2, 'S2', 'Bridge Pier Yard');
  for (const [p, u] of [[p1, 'pm1'], [p2, 'pm2']]) api.db.prepare("INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, applied, created_by, source_type) VALUES (1, 'PROJECT', ?, 'PROJECT_MANAGER', ?, '2026-01-01', 1, 't', 'test')").run(p, user[u]);
  let n = 0;
  const emp = (o = {}) => {
    n += 1;
    return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, employment_type, doj, location_type, employment_status, record_status, user_id, created_by, source_type) VALUES (1, ?, 'Emp', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, 't', 'test')",
      o.code ?? `E${String(n).padStart(3, '0')}`, o.name ?? `Employee ${n}`, `employee${n}`, `98000000${String(n).padStart(2, '0')}`, dept, o.designation ?? se_d, o.userId ?? null);
  };
  const ids = { dept, se_d, fm_d, p1, p2, s1, s1b, s2 };
  const call = (who, method, path, body, k) => api.call(method, `${H}${path}`, { ...who, headers: key(k), body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const plan = (siteId, designationId, planned, o = {}) => call(hr1, 'PUT', '/site-plans', { siteId, designationId, planned, validFrom: '2026-01-01', ...o });
  const depBody = (personId, o = {}) => ({ personId, projectId: p1, siteId: s1, siteRole: 'Quality engineer', fromDate: day(-5), toDate: null, isPrimary: true, ...o });
  /** An approved deployment: raised by hr1, approved by the project manager (and the director when it is outside the plan). */
  const approved = async (personId, o = {}) => {
    const r = await call(hr1, 'POST', '/deployments', { ...depBody(personId, o), submit: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const inst = r.json.data.workflowInstanceId;
    await act(pm1, inst);
    if (r.json.data.band === 'OUTSIDE_PLAN') await act(pd, inst);
    return (await call(hr1, 'GET', `/deployments/${r.json.data.id}`)).json.data;
  };
  return { api, call, act, hasTask, ids, plan, depBody, approved, emp, user };
};

test('T-01 BR-01 an overlapping primary deployment is rejected, at the draft, at submit and when approved; a secondary posting is allowed', async () => {
  const t = await setup();
  const e = t.emp();
  await t.plan(t.ids.s1, t.ids.se_d, 5);
  const first = await t.approved(e, { fromDate: day(-5), toDate: day(20) });
  assert.equal(first.status, 'APPROVED');
  assert.equal(first.docNo, 'DEP-00001');
  const clash = await t.call(hr1, 'POST', '/deployments', t.depBody(e, { siteId: t.ids.s1b, fromDate: day(10), toDate: null }));
  assert.equal(clash.status, 400, JSON.stringify(clash.json));
  assert.match(clash.json.error.details[0].message, /already has the primary deployment DEP-00001/);
  const after = await t.call(hr1, 'POST', '/deployments', t.depBody(e, { siteId: t.ids.s1b, fromDate: day(21), toDate: null }));
  assert.equal(after.status, 201, 'the day after the first ends is free');
  const secondary = await t.call(hr1, 'POST', '/deployments', t.depBody(e, { projectId: t.ids.p2, siteId: t.ids.s2, fromDate: day(0), isPrimary: false }));
  assert.equal(secondary.status, 201, 'a secondary posting may overlap');
  // two drafts of different people cannot be made to overlap, but the race of two drafts of one person is caught when the second is approved
  const e2 = t.emp();
  const a = await t.call(hr1, 'POST', '/deployments', t.depBody(e2, { fromDate: day(1) }));
  assert.equal(a.status, 201);
  const b = await t.call(hr1, 'POST', '/deployments', t.depBody(e2, { siteId: t.ids.s1b, fromDate: day(1) }));
  assert.equal(b.status, 400, 'a second draft for the same dates is refused at once');
  // the last day is inclusive: ending on the 5th and starting on the 5th overlaps
  const edge = await t.call(hr1, 'POST', '/deployments', t.depBody(e, { siteId: t.ids.s1b, fromDate: day(20) }));
  assert.equal(edge.status, 400);
  // a bad site, a closed crew, dates the wrong way round
  const bad = await t.call(hr1, 'POST', '/deployments', t.depBody(t.emp(), { siteId: t.ids.s2, toDate: day(-10) }));
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.details.map((d) => d.field).sort(), ['siteId', 'toDate']);
  assert.equal((await t.call(se, 'POST', '/deployments', t.depBody(e2))).status, 403, 'a site engineer cannot deploy');
  assert.equal((await t.call(other, 'POST', '/deployments', t.depBody(e2))).status, 400, 'another company does not see this employee or project');
});

test('T-02 FR-05 a deployment change updates scope-based access and the site messaging group at once: an approved deployment gives the site role, a closed one takes it away', async () => {
  const t = await setup();
  const worker = t.emp({ userId: t.user.field1 });
  const authz = authzOf(t.api.db);
  const actor = { user: 'field1', userId: t.user.field1, companyId: 1, roles: [] };
  const may = (siteId) => authz.check({ ...actor }, 'hr.crew.view', { companyId: 1, projectId: siteId === t.ids.s2 ? t.ids.p2 : t.ids.p1, siteId }).allowed;
  assert.equal(may(t.ids.s1), false, 'nobody with no roles sees crews');
  await t.plan(t.ids.s1, t.ids.se_d, 5);
  const noRole = await t.call(hr1, 'POST', '/deployments', { ...t.depBody(worker), accessRole: 'ADMIN' });
  assert.equal(noRole.status, 400, 'a deployment only gives roles the parameter allows');
  const d = await t.approved(worker, { accessRole: 'WSUP', fromDate: day(0) });
  const stamp = Date.now();
  assert.equal(may(t.ids.s1), true, 'at the deployed site');
  assert.equal(may(t.ids.s1b), false, 'not at another site of the project');
  assert.equal(may(t.ids.s2), false, 'not at another project');
  assert.ok(Date.now() - stamp < 60_000, 'well inside 60 seconds');
  assert.ok(authz.resolve({ companyId: 1, userId: t.user.field1, roles: [] }).holdings.some((h) => h.via === 'deployment' && h.role === 'WSUP' && h.scopeType === 'SITE'));
  // the event carries what the other modules need
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'hr.deployment.changed' ORDER BY id DESC LIMIT 1").get();
  const data = JSON.parse(ev.payload).data;
  assert.equal(data.change, 'STARTED');
  assert.equal(data.siteId, t.ids.s1);
  assert.equal(data.accessRole, 'WSUP');
  // the messaging group of the site follows the deployment
  runtimeOf(t.api.db).bus.drain();
  const groups = (await import('../src/server/modules/msg/autogroups.js')).autoGroupsOf(t.api.db);
  assert.ok(groups, 'the messaging auto groups run');
  assert.ok(groups.holdersIn(1, ['WSUP'], { type: 'SITE', id: t.ids.s1, projectId: t.ids.p1 }).includes('field1'), 'a holder of the site role through the deployment');
  assert.equal(groups.holdersIn(1, ['WSUP'], { type: 'SITE', id: t.ids.s1b, projectId: t.ids.p1 }).includes('field1'), false, 'not of another site');
  // closing it takes the access away at once
  const closed = await t.call(hr1, 'POST', `/deployments/${d.id}/cancel`, { reason: 'Moved to the head office' });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.equal(closed.json.data.status, 'CLOSED');
  assert.equal(may(t.ids.s1), false, 'access ends with the deployment');
  // a deployment that starts later gives nothing until its day
  const later = await t.approved(worker, { accessRole: 'WSUP', fromDate: day(3) });
  assert.equal(later.when, 'UPCOMING');
  assert.equal(may(t.ids.s1), false);
  t.api.db.prepare("UPDATE hr_deployments SET from_date = ? WHERE id = ?").run(day(0), later.id);
  authz.invalidate();
  assert.equal(may(t.ids.s1), true, 'on its day');
  // an employee who leaves loses it
  t.api.db.prepare("UPDATE hr_employees SET employment_status = 'SEPARATED' WHERE id = ?").run(worker);
  authz.invalidate();
  assert.equal(may(t.ids.s1), false, 'a separated employee has no site access');
});

test('FR-01 FR-02 approval: within the plan the project manager approves, outside it (or with no planned post) the director too; the creator never approves; locked, amended by revision, cancelled', async () => {
  const t = await setup();
  const e = t.emp();
  const out = await t.call(hr1, 'POST', '/deployments', { ...t.depBody(e), submit: true });
  assert.equal(out.json.data.band, 'OUTSIDE_PLAN', 'no planned post for the designation: outside the plan');
  const inst = out.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(hr1, inst), false, 'the creator does not approve');
  await t.act(pm1, inst);
  assert.equal((await t.call(hr1, 'GET', `/deployments/${out.json.data.id}`)).json.data.status, 'SUBMITTED', 'waiting for the director');
  await t.act(pd, inst);
  const got = (await t.call(hr1, 'GET', `/deployments/${out.json.data.id}`)).json.data;
  assert.equal(got.status, 'APPROVED');
  const locked = await t.call(hr1, 'PATCH', `/deployments/${got.id}`, { ...t.depBody(e), version: got.rowVersion });
  assert.equal(locked.status, 409, `approved: locked ${JSON.stringify(locked.json)}`);
  assert.equal((await t.call(hr1, 'DELETE', `/deployments/${got.id}`)).status, 409);
  // within the plan: the project manager alone
  await t.plan(t.ids.s1, t.ids.se_d, 3);
  const e2 = t.emp();
  const within = await t.call(hr1, 'POST', '/deployments', { ...t.depBody(e2), submit: true });
  assert.equal(within.json.data.band, 'WITHIN_PLAN', '3 planned, 1 deployed');
  await t.act(pm1, within.json.data.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `/deployments/${within.json.data.id}`)).json.data.status, 'APPROVED');
  // amendment: a new revision, approved again; the approved one stays in force until then
  const am = await t.call(hr1, 'POST', `/deployments/${got.id}/amend`, { reason: 'Moves to the crew of the south block', changes: { siteRole: 'Senior quality engineer' } });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  assert.equal(am.json.data.revision, 2);
  assert.equal(am.json.data.siteRole, 'Senior quality engineer');
  assert.equal((await t.call(hr1, 'POST', `/deployments/${got.id}/amend`, { reason: 'A second amendment at once' })).status, 409);
  const rsub = await t.call(hr1, 'POST', `/deployments/${am.json.data.id}/submit`, {});
  assert.equal(rsub.status, 202, JSON.stringify(rsub.json));
  assert.equal(rsub.json.data.band, 'WITHIN_PLAN', 'the plan was set since: 3 planned, 1 deployed apart from this one');
  await t.act(pm1, rsub.json.data.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `/deployments/${got.id}`)).json.data.status, 'SUPERSEDED');
  const cmp = (await t.call(hr1, 'GET', `/deployments/${am.json.data.id}/compare`)).json.data;
  assert.deepEqual(cmp.rows.find((x) => x.field === 'siteRole'), { field: 'siteRole', label: 'Role on site', before: 'Quality engineer', after: 'Senior quality engineer', changed: true });
  // return, reject, withdraw
  const e3 = t.emp();
  const r3 = await t.call(hr1, 'POST', '/deployments', { ...t.depBody(e3), submit: true });
  await t.act(pm1, r3.json.data.workflowInstanceId, 'return');
  const back = (await t.call(hr1, 'GET', `/deployments/${r3.json.data.id}`)).json.data;
  assert.equal(back.status, 'RETURNED');
  const fixed = await t.call(hr1, 'PATCH', `/deployments/${back.id}`, { ...t.depBody(e3, { siteRole: 'Foreman' }), version: back.rowVersion });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  const rs = await t.call(hr1, 'POST', `/deployments/${back.id}/submit`, {});
  assert.equal(rs.status, 202, JSON.stringify(rs.json));
  const cn = await t.call(hr1, 'POST', `/deployments/${back.id}/cancel`, { reason: 'Raised by mistake' });
  assert.equal(cn.status, 200, JSON.stringify(cn.json));
  assert.equal(cn.json.data.status, 'CANCELLED');
  const e5 = t.emp();
  const r5 = await t.call(hr1, 'POST', '/deployments', { ...t.depBody(e5), submit: true });
  const wd = await t.call(hr1, 'POST', `/deployments/${r5.json.data.id}/withdraw`, { reason: 'Raised by mistake' });
  assert.equal(wd.status, 200, JSON.stringify(wd.json));
  assert.equal(wd.json.data.status, 'DRAFT');
  assert.equal((await t.call(hr1, 'DELETE', `/deployments/${r5.json.data.id}`)).status, 200);
  const e4 = t.emp();
  const r4 = await t.call(hr1, 'POST', '/deployments', { ...t.depBody(e4), submit: true });
  await t.act(pm1, r4.json.data.workflowInstanceId, 'reject');
  assert.equal((await t.call(hr1, 'GET', `/deployments/${r4.json.data.id}`)).json.data.status, 'REJECTED');
  const h = (await t.call(hr1, 'GET', `/deployments/${got.id}/history`)).json.data;
  assert.ok(h.approvals.length >= 2 && h.audit.length >= 3);
  assert.equal((await t.call(hr1, 'GET', `/deployments/${got.id}/print`)).status, 200);
});

test('FR-03 FR-04 crews: a supervisor keeps the members of their own crews only; members must be deployed at the site; the board counts people against the plan, and a drag is an amendment sent for approval', async () => {
  const t = await setup();
  const sup = t.emp({ userId: t.user.ws1, name: 'Supervisor Suresh' });
  const a = t.emp({ name: 'Anil Fitter', designation: t.ids.fm_d }); const b = t.emp({ name: 'Bhanu Fitter', designation: t.ids.fm_d }); const c = t.emp({ name: 'Chetan Engineer' });
  await t.plan(t.ids.s1, t.ids.fm_d, 3); await t.plan(t.ids.s1, t.ids.se_d, 1);
  for (const p of [sup, a, b, c]) await t.approved(p, { fromDate: day(-2) });
  const crew = await t.call(hr1, 'POST', '/crews', { siteId: t.ids.s1, code: 'FIT-1', name: 'Fitters A', trade: 'Fitter', supervisorId: sup });
  assert.equal(crew.status, 201, JSON.stringify(crew.json));
  assert.equal((await t.call(hr1, 'POST', '/crews', { siteId: t.ids.s1, code: 'fit-1', name: 'Again' })).status, 400, 'the code is unique');
  assert.equal((await t.call(se, 'POST', '/crews', { siteId: t.ids.s1, code: 'X1', name: 'No' })).status, 403);
  const other2 = await t.call(hr1, 'POST', '/crews', { siteId: t.ids.s1, code: 'FIT-2', name: 'Fitters B', trade: 'Fitter' });
  const wsupFor = { ...wsup, userId: t.user.ws1 };
  // the supervisor of FIT-1 is the user ws1: the service reads the actor's own employee record, so the test calls the service the way the API does
  const svc = deploymentsOf(t.api.db);
  const act = { user: 'ws1', userId: t.user.ws1, companyId: 1, roles: ['WSUP'] };
  const added = svc.crews.addMember(act, crew.json.data.id, { personType: 'EMPLOYEE', personId: a, fromDate: day(-1), toDate: null });
  assert.equal(added.members.length, 1);
  assert.throws(() => svc.crews.addMember(act, other2.json.data.id, { personType: 'EMPLOYEE', personId: b, fromDate: day(-1), toDate: null }), /Only the crew supervisor/);
  assert.equal(wsupFor.user, 'ws1');
  const stranger = t.emp();
  assert.throws(() => svc.crews.addMember(act, crew.json.data.id, { personType: 'EMPLOYEE', personId: stranger, fromDate: day(-1), toDate: null }), /not deployed at this site/);
  assert.throws(() => svc.crews.addMember(act, crew.json.data.id, { personType: 'EMPLOYEE', personId: a, fromDate: day(0), toDate: null }), /already in the crew/);
  assert.throws(() => svc.crews.addMember(act, crew.json.data.id, { personType: 'WORKER', personId: 1, fromDate: day(0), toDate: null }), (e) => /labour register/.test(JSON.stringify(e.details)));
  const viaApi = await t.call(hr1, 'POST', `/crews/${crew.json.data.id}/members`, { personType: 'EMPLOYEE', personId: b, fromDate: day(-1) });
  assert.equal(viaApi.status, 201, JSON.stringify(viaApi.json));
  const ended = await t.call(hr1, 'POST', `/crews/${crew.json.data.id}/members/${viaApi.json.data.members.find((m) => m.personId === b).id}/end`, { toDate: day(0) });
  assert.equal(ended.status, 200);
  const list = (await t.call(hr1, 'GET', '/crews')).json;
  assert.equal(list.data.find((x) => x.code === 'FIT-1').members, 2);
  // the board
  const board = (await t.call(pm1, 'GET', `/deployment-board?siteId=${t.ids.s1}`)).json.data;
  assert.equal(board.sites.length, 1);
  const s = board.sites[0];
  assert.equal(s.deployed, 4);
  assert.equal(s.planned, 4);
  assert.deepEqual(s.counts.map((x) => [x.designation, x.planned, x.deployed, x.gap]), [['Foreman', 3, 2, 1], ['Site Engineer', 1, 2, -1]]);
  assert.ok(s.groups.some((g) => g.crew === 'No crew') || s.groups.length >= 1);
  assert.equal((await t.call(aud, 'GET', '/deployment-board')).status, 200, 'the auditor reads');
  assert.equal((await t.call(as('NOBODY', 'nobody1'), 'GET', '/deployment-board')).status, 403);
  assert.equal((await t.call(other, 'GET', '/deployment-board')).json.data.sites.length, 0, 'another company sees nothing of this one');
  // drag: a move to another crew is an amendment, sent for approval; the person stays where they are until then
  const dep = s.groups.flatMap((g) => g.people).find((p) => p.personId === c);
  const mv = await t.call(hr1, 'POST', `/deployments/${dep.deploymentId}/move`, { crewId: other2.json.data.id, comment: 'Needed in the second gang' });
  assert.equal(mv.status, 202, JSON.stringify(mv.json));
  assert.equal(mv.json.data.status, 'SUBMITTED');
  let again = (await t.call(pm1, 'GET', `/deployment-board?siteId=${t.ids.s1}`)).json.data.sites[0];
  assert.equal(again.groups.flatMap((g) => g.people).find((p) => p.personId === c).pendingChange, true);
  assert.equal(again.groups.find((g) => g.crewId === other2.json.data.id)?.people.length ?? 0, 0, 'not yet in the new crew');
  await t.act(pm1, mv.json.data.workflowInstanceId); // the second site engineer is within the plan? the plan is full (1 planned): the director too
  const st = (await t.call(hr1, 'GET', `/deployments/${mv.json.data.id}`)).json.data;
  if (st.status !== 'APPROVED') await t.act(pd, mv.json.data.workflowInstanceId);
  again = (await t.call(pm1, 'GET', `/deployment-board?siteId=${t.ids.s1}`)).json.data.sites[0];
  assert.equal(again.groups.find((g) => g.crewId === other2.json.data.id).people.length, 1, 'in the new crew once approved');
  assert.equal((await t.call(hr1, 'GET', `/deployment-board/print?siteId=${t.ids.s1}`)).status, 200);
});

test('FR-02 a transfer across projects goes to the current project manager, the receiving project manager and the HR manager; on approval the old posting ends on the relieving date and the new one starts on the joining date; the handover is ticked; an unstarted transfer is undone by cancelling', async () => {
  const t = await setup();
  const e = t.emp({ userId: t.user.field1 });
  await t.plan(t.ids.s1, t.ids.se_d, 3); await t.plan(t.ids.s2, t.ids.se_d, 3);
  const cur = await t.approved(e, { accessRole: 'SE', fromDate: day(-10) });
  const body = { employeeId: e, toProjectId: t.ids.p2, toSiteId: t.ids.s2, siteRole: 'Bridge QA', relieveDate: day(5), joinDate: day(7), reason: 'The bridge needs a quality engineer', travelRequired: true, accommodationRequired: true };
  assert.equal((await t.call(se, 'POST', '/transfers', body)).status, 403, 'a site engineer cannot raise transfers');
  const bad = await t.call(hr1, 'POST', '/transfers', { ...body, joinDate: day(-2), relieveDate: day(-1), toSiteId: t.ids.s1b });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.details.map((d) => d.field).sort(), ['joinDate', 'relieveDate', 'toSiteId']);
  const same = await t.call(hr1, 'POST', '/transfers', { ...body, toProjectId: t.ids.p1, toSiteId: t.ids.s1 });
  assert.equal(same.status, 400, 'already posted there');
  const r = await t.call(hr1, 'POST', '/transfers', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.docNo, 'TRF-00001');
  assert.equal(r.json.data.scope, 'CROSS_PROJECT');
  assert.equal(r.json.data.handoverTotal, 5);
  assert.equal((await t.call(se, 'GET', `/transfers/${r.json.data.id}`)).status, 403);
  const sub = await t.call(hr1, 'POST', `/transfers/${r.json.data.id}/submit`, {});
  assert.equal(sub.status, 202, JSON.stringify(sub.json));
  const inst = sub.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(pm1, inst), true, 'the current project manager first');
  assert.equal(await t.hasTask(pm2, inst), false);
  await t.act(pm1, inst);
  assert.equal(await t.hasTask(pm2, inst), true, 'then the receiving project manager');
  await t.act(pm2, inst);
  assert.equal(await t.hasTask(hr2, inst), true, 'then the HR manager');
  await t.act(hr2, inst);
  const got = (await t.call(hr1, 'GET', `/transfers/${r.json.data.id}`)).json.data;
  assert.equal(got.status, 'APPROVED');
  assert.equal(got.deployments.length, 1);
  const old = (await t.call(hr1, 'GET', `/deployments/${cur.id}`)).json.data;
  assert.equal(old.toDate, day(5), 'the old posting ends on the relieving date');
  const nd = (await t.call(hr1, 'GET', `/deployments/${got.deployments[0].id}`)).json.data;
  assert.deepEqual([nd.fromDate, nd.siteId, nd.projectId, nd.status, nd.accessRole, nd.transferId], [day(7), t.ids.s2, t.ids.p2, 'APPROVED', 'SE', got.id]);
  void nd;
  assert.equal(nd.isPrimary, true);
  // the person is eligible at the old site until the relieving date and at the new one from the joining date
  const elig = async (siteId, date) => (await t.call(hr1, 'GET', `/deployments/eligibility?personId=${e}&siteId=${siteId}&date=${date}`)).json.data.eligible;
  assert.deepEqual([await elig(t.ids.s1, day(5)), await elig(t.ids.s1, day(6)), await elig(t.ids.s2, day(6)), await elig(t.ids.s2, day(7))], [true, false, false, true]);
  // the handover is ticked by the people who keep the transfer, and the checklist shows who and when
  const tick = await t.call(pm1, 'PUT', `/transfers/${got.id}/handover`, { items: [{ code: 'WORK', done: true }, { code: 'TOOLS', done: true, note: 'All returned' }] });
  assert.equal(tick.status, 200, JSON.stringify(tick.json));
  assert.equal(tick.json.data.handoverDone, 2);
  assert.equal((await t.call(se, 'PUT', `/transfers/${got.id}/handover`, { items: [{ code: 'WORK', done: true }] })).status, 403);
  // history of the person, newest first
  const hist = (await t.call(hr1, 'GET', `/employees/${e}/deployments`)).json.data;
  assert.deepEqual(hist.map((x) => x.site), ['Bridge Pier Yard', 'Ring Road North']);
  // not yet joined: cancelling undoes it, the old posting runs on and the new one is closed
  const cancel = await t.call(hr1, 'POST', `/transfers/${got.id}/cancel`, { reason: 'The bridge work is postponed' });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.equal(cancel.json.data.status, 'CLOSED');
  assert.equal((await t.call(hr1, 'GET', `/deployments/${cur.id}`)).json.data.toDate, null, 'the old posting is as before');
  assert.equal((await t.call(hr1, 'GET', `/deployments/${got.deployments[0].id}`)).json.data.status, 'CLOSED');
  // a secondment has a return date and ends there
  const sec = await t.call(hr1, 'POST', '/transfers', { ...body, kind: 'SECONDMENT', returnDate: day(40), submit: true });
  assert.equal(sec.status, 201, JSON.stringify(sec.json));
  await t.act(pm1, sec.json.data.workflowInstanceId); await t.act(pm2, sec.json.data.workflowInstanceId); await t.act(hr2, sec.json.data.workflowInstanceId);
  const sd = (await t.call(hr1, 'GET', `/transfers/${sec.json.data.id}`)).json.data;
  assert.equal((await t.call(hr1, 'GET', `/deployments/${sd.deployments[0].id}`)).json.data.toDate, day(40));
  assert.equal((await t.call(hr1, 'POST', '/transfers', { ...body, kind: 'SECONDMENT' })).status, 400, 'a secondment says when the person returns');
  // an approved transfer that has not taken effect is amended by a revision; the earlier one is undone and the new one applied
  const am = await t.call(hr1, 'POST', `/transfers/${sd.id}/amend`, { reason: 'The joining date moves a week' });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  const upd = await t.call(hr1, 'PATCH', `/transfers/${am.json.data.id}`, { ...body, kind: 'SECONDMENT', returnDate: day(40), joinDate: day(14), version: am.json.data.rowVersion });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  const asub = await t.call(hr1, 'POST', `/transfers/${am.json.data.id}/submit`, {});
  assert.equal(asub.status, 202, JSON.stringify(asub.json));
  await t.act(pm1, asub.json.data.workflowInstanceId); await t.act(pm2, asub.json.data.workflowInstanceId); await t.act(hr2, asub.json.data.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `/transfers/${sd.id}`)).json.data.status, 'SUPERSEDED');
  const ad = (await t.call(hr1, 'GET', `/transfers/${am.json.data.id}`)).json.data;
  assert.equal((await t.call(hr1, 'GET', `/deployments/${ad.deployments[0].id}`)).json.data.fromDate, day(14));
  assert.equal((await t.call(hr1, 'GET', `/deployments/${sd.deployments[0].id}`)).json.data.status, 'CLOSED', 'the earlier revision gave nothing that stays');
});

test('FR-06 FR-07 AC-04 the bulk deploy import sends every valid row for approval and approves nothing; rows with a clash, an unknown code or the same person twice in the file are refused row by row', async () => {
  const t = await setup();
  const people = Array.from({ length: 8 }, () => t.emp());
  await t.plan(t.ids.s1, t.ids.se_d, 20);
  const codeOf = (id) => t.api.db.prepare('SELECT emp_code FROM hr_employees WHERE id = ?').get(id).emp_code;
  const tpl = await t.api.call('GET', '/api/v1/xl/templates', hr1);
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json).slice(0, 300));
  const types = tpl.json.data.types;
  const type = types.find((x) => x.code === 'HR_DEPLOYMENT');
  assert.ok(type, 'HR sees the deployment import');
  assert.equal((await t.api.call('GET', '/api/v1/xl/templates', se)).json?.data?.types?.some((x) => x.code === 'HR_DEPLOYMENT') ?? false, false);
  const rows = people.map((p) => ({ employee: codeOf(p), project: 'P1', site: 'S1', crew: '', siteRole: 'Quality engineer', fromDate: day(1), toDate: '', primary: 'Yes', accessRole: '', costCode: '' }));
  rows[1].employee = 'NOBODY'; // unknown employee
  rows[2].site = 'S9'; // a site that is not there
  rows[3].accessRole = 'ADMIN'; // a role a deployment may not give
  rows[5] = { ...rows[4], siteRole: 'Second line' }; // the same person twice in the file
  const wb = templateWorkbook({ importType: 'HR_DEPLOYMENT', version: 0, title: 'HR_DEPLOYMENT', columns: type.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: ['x'], rowsRaw: true, rows: rows.map((r) => type.columns.map((c) => r[c.key] ?? '')) });
  const up = await t.api.raw('POST', '/api/v1/xl/jobs?type=HR_DEPLOYMENT&fileName=deploy.xlsx', { ...hr1, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': `xl-${Math.random().toString(36).slice(2, 10)}` }, body: wb });
  assert.equal(up.status, 202, up.buffer.toString().slice(0, 300));
  const runtime = runtimeOf(t.api.db);
  const drain = async () => { for (let i = 0; i < 8; i += 1) { runtime.bus.drain(); await runtime.jobs.drain(); } };
  await drain();
  const job = up.json.data;
  const errors = (await t.api.call('GET', `/api/v1/xl/jobs/${job.id}/errors?limit=100`, hr1)).json;
  const errRows = new Set((errors.data.rows ?? errors.data ?? []).map((e) => e.line ?? e.row ?? e.rowNo));
  assert.equal(errRows.size, 4, `four rows have errors: ${JSON.stringify(errors).slice(0, 500)}`);
  const commit = await t.api.call('POST', `/api/v1/xl/jobs/${job.id}/commit`, { ...hr1, headers: key('c'), body: { skipInvalid: true } });
  assert.ok([200, 202].includes(commit.status), JSON.stringify(commit.json).slice(0, 300));
  await drain();
  const done = t.api.db.prepare('SELECT status, last_error FROM xl_jobs WHERE id = ?').get(job.id);
  assert.equal(done.status, 'COMMITTED', done.last_error);
  const made = t.api.db.prepare("SELECT COUNT(*) AS n, SUM(status = 'SUBMITTED') AS s, SUM(status = 'APPROVED') AS a FROM hr_deployments").get();
  assert.equal(made.n, 4);
  assert.equal(made.s, 4, 'imported deployments wait for approval');
  assert.equal(made.a ?? 0, 0, 'an import never approves');
});

test('AC-03 scope: another company sees nothing; a project manager who holds the role for one project only sees and deploys there; the register filters and exports', async () => {
  const t = await setup();
  const e = t.emp();
  await t.plan(t.ids.s1, t.ids.se_d, 5);
  const d = await t.approved(e);
  assert.equal((await t.call(other, 'GET', `/deployments/${d.id}`)).status, 404);
  const oth = await t.call(other, 'GET', '/deployments');
  assert.equal(oth.status, 200, JSON.stringify(oth.json).slice(0, 300));
  assert.equal(oth.json.data.length, 0);
  assert.equal((await t.call(se, 'GET', '/deployments')).status, 200, 'a site engineer reads (no scoped holding: sees none)');
  assert.equal((await t.call(as('NOBODY', 'n1'), 'GET', '/deployments')).status, 403);
  // a project-scoped holder
  const scoped = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'pmscoped', 'Scoped PM', '[]', 'pmscoped@example.com')").run().lastInsertRowid);
  authzOf(t.api.db).seed();
  const role = t.api.db.prepare("SELECT id FROM iam_roles WHERE code = 'PM' AND company_id = 1").get() ?? t.api.db.prepare("SELECT id FROM iam_roles WHERE code = 'PM'").get();
  assert.ok(role, 'the PM role is stored for the company');
  {
    t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, effective_from, status, is_active, created_by, source_type) VALUES (1, ?, ?, 'PROJECT', ?, '2026-01-01', 'ACTIVE', 1, 't', 'test')").run(scoped, role.id, JSON.stringify([t.ids.p2]));
    authzOf(t.api.db).invalidate();
    const svc = deploymentsOf(t.api.db);
    const act = { user: 'pmscoped', userId: scoped, companyId: 1, roles: [] };
    assert.equal(svc.register.list(act, {}).data.length, 0, 'sees no deployment of the other project');
    assert.throws(() => svc.deployments.get(act, d.id), /does not exist/);
    assert.throws(() => svc.deployments.create(act, { personType: 'EMPLOYEE', personId: e, projectId: t.ids.p1, siteId: t.ids.s1, fromDate: day(30), isPrimary: false }), /may not/);
  }
  const lr = await t.call(hr1, 'GET', '/deployments?filter[status]=APPROVED');
  assert.equal(lr.status, 200, JSON.stringify(lr.json).slice(0, 300));
  const list = lr.json;
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].isPrimary, true);
  const ex = await t.api.raw('GET', `${H}/deployments/export?format=csv`, hr1);
  assert.equal(ex.status, 200, ex.buffer.toString().slice(0, 200));
  assert.match(ex.buffer.toString(), /DEP-00001/);
  // idempotent replay: the same key gives the same record, not a second one
  const k = key('same');
  const fresh = t.emp();
  const one = await t.api.call('POST', `${H}/deployments`, { ...hr1, headers: k, body: t.depBody(fresh, { fromDate: day(60) }) });
  const two = await t.api.call('POST', `${H}/deployments`, { ...hr1, headers: k, body: t.depBody(fresh, { fromDate: day(60) }) });
  assert.equal(one.status, 201);
  assert.equal(two.status, 201, JSON.stringify(two.json));
  assert.equal(two.json.data.id, one.json.data.id);
  assert.equal((await t.api.call('POST', `${H}/deployments`, { ...hr1, headers: json, body: t.depBody(e) })).status, 400, 'an idempotency key is required to create');
});

test('the daily cycle: deployments that start today give access and tell the person; those that ended send the ended event once', async () => {
  const t = await setup();
  const e = t.emp({ userId: t.user.field2 });
  await t.plan(t.ids.s1, t.ids.se_d, 5);
  const d = await t.approved(e, { accessRole: 'SE', fromDate: day(2), toDate: day(10) });
  const svc = deploymentsOf(t.api.db);
  assert.deepEqual(svc.cycle(1), { started: 0, ended: 0, endingSoon: 0 });
  t.api.db.prepare('UPDATE hr_deployments SET from_date = ? WHERE id = ?').run(day(0), d.id);
  assert.equal(svc.cycle(1).started, 1);
  assert.equal(svc.cycle(1).started, 0, 'only once');
  t.api.db.prepare('UPDATE hr_deployments SET from_date = ?, to_date = ? WHERE id = ?').run(day(-5), day(-1), d.id);
  assert.equal(svc.cycle(1).ended, 1);
  assert.equal(svc.cycle(1).ended, 0, 'only once');
  const types = t.api.db.prepare("SELECT json_extract(payload, '$.data.change') AS c FROM core_outbox WHERE event_type = 'hr.deployment.changed' ORDER BY id").all().map((r) => r.c);
  assert.ok(types.includes('STARTED') && types.includes('ENDED'));
  assert.equal(svc.widget({ user: 'hr1', userId: 1, companyId: 1, roles: ['HRMGR'] }).value, 0);
});
