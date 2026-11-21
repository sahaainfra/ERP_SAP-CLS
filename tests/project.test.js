import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { domainHistoryCode, readDomainMetric } from '../src/server/modules/bi/domain-metrics.js';
import { readProjectStatusReport } from '../src/server/modules/bi/project-status.js';
import { readProjectStatusDataset } from '../src/server/modules/bi/project-status-dataset.js';
import { readProjectCountMetric } from '../src/server/modules/bi/project-count-metric.js';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { projectsOf } from '../src/server/modules/proj/project.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { listExportsOf } from '../src/server/platform/list/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.01: the project master, the lifecycle and the setup wizard. T-01 the wizard makes the project, its sites, its numbering series, its document folders and its key dates in one transaction (and nothing when any part is refused);
// the transition rules are enforced (only the allowed moves, the checklist ticked, the blockers cleared, suspension and closure by the chain). Also: the activation by the project director and the director (never by the maker, and not
// by the plain activation of the organisation master), the organisation project and its sites following the lifecycle, the contract terms of a live project changing only by an approved amendment, the milestones register, the portfolio with
// health, roles, project isolation, another company, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `prj-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pcm = as('PCMGR', 'ppcm1'); const pd1 = as('PD', 'ppd1'); const pd2 = as('PD', 'ppd2'); const pm1 = as('PM', 'ppm1'); const pm2 = as('PM', 'ppm2'); const dir = as('DIR', 'pdir1'); const dir2 = as('DIR', 'pdir2'); const qs = as('QS', 'pqs1'); const se = as('SE', 'pse1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['ppcm1', ['PCMGR']], ['ppd1', ['PD']], ['ppd2', ['PD']], ['ppm1', ['PM']], ['ppm2', ['PM']], ['pdir1', ['DIR']], ['pdir2', ['DIR']], ['pqs1', ['QS']], ['pse1', ['SE']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const tasks = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await tasks(who)).find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked against the contract' } }); assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const partner = (code, name, role, status = 'ACTIVE', company = 1) => { const id = Number(api.db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'COMMGR', 't', 'test')").run(company, code, name, name.toLowerCase(), status).lastInsertRowid); api.db.prepare('INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, ?)').run(company, id, role); return id; };
  const ids = { client: partner('CL100', 'National Highways Authority', 'CLIENT'), consultant: partner('CN100', 'Mott Engineers', 'CONSULTANT'), vendor: partner('VN100', 'Steel Traders', 'VENDOR'), blocked: partner('CL101', 'Blacklisted Client', 'CLIENT', 'BLACKLISTED'), funder: partner('VN101', 'Infra Bank', 'SERVICE_PROVIDER') };
  const wizard = (over = {}) => ({
    basics: { code: 'NH48-P3', name: 'Four-laning of NH-48, package 3', type: 'ROAD', sector: 'ROADS', location: 'Pune', ...(over.basics ?? {}) },
    contract: { clientPartnerId: ids.client, consultantPartnerId: ids.consultant, funderPartnerId: ids.funder, contractType: 'ITEM_RATE', contractNo: 'NHAI/2027/118', contractValue: '972000000', startDate: '2026-12-01', scheduledCompletion: '2028-11-30', dlpMonths: 24, retentionPct: '5', mobAdvancePct: '10', ldSummary: '0.05 % per day up to 10 % of the contract value', ...(over.contract ?? {}) },
    sites: over.sites ?? [{ code: 'NH48-S1', name: 'Pune main camp', siteType: 'SITE', address: 'Km 12, Pune', latitude: 18.52, longitude: 73.85, geofenceType: 'CIRCLE', geofenceRadiusM: 400 }, { code: 'NH48-S2', name: 'Batching plant', siteType: 'PLANT', latitude: 18.55, longitude: 73.9, geofenceType: 'CIRCLE', geofenceRadiusM: 250 }],
    team: { pmUser: 'ppm1', directorUser: 'ppd1', ...(over.team ?? {}) },
    setup: over.setup ?? {}, milestones: over.milestones ?? [{ code: 'M1', name: 'Mobilisation complete', plannedDate: '2027-01-31', contractual: true, paymentLinked: true }, { code: 'M2', name: 'Earthwork 50 %', plannedDate: '2027-09-30', contractual: false, paymentLinked: false }],
    ...(over.top ?? {}),
  });
  return { api, call, act, tasks, ids, wizard };
}
const ALL = [0, 1, 2, 3];

test('27.01 project status uses the project register and exposes only scoped status data', async () => {
  const t = await setup();
  const { db } = t.api;
  const response = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const project = response.json.data;
  const other = await t.call(pcm, 'POST', '/projects', t.wizard({
    basics: { code: 'OTHER-01' }, contract: { contractNo: 'OTHER-01' },
    sites: [{ code: 'OTHER-S1', name: 'Other camp', siteType: 'SITE' }],
  }));
  assert.equal(other.status, 201, JSON.stringify(other.json));
  const flags = createFlagService({ db, environment: 'test' });
  const actor = { companyId: 1, user: pcm.user, roles: [pcm.roles] };
  const read = (query, user = actor) => readProjectStatusReport({ db, flags }, { ...user }, query);
  const sign = db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  const setFlag = db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES (?, ?, 'Test override', 0, ?)`);
  const secondCompany = Number(db.prepare("INSERT INTO org_companies (code, legal_name, short_name) VALUES ('BI2','Other Co','Other')").run().lastInsertRowid);

  assert.equal(flags.isOn(actor, 'ff.bi.p2701'), false);
  assert.throws(read, { status: 404 });
  const biOverride = setFlag.run('ff.bi.p2701', 1, 1).lastInsertRowid;
  sign.run(1, 'G1', 'Platform Gate');
  sign.run(secondCompany, 'G2', 'Workforce Gate');
  assert.throws(read, { status: 404 });
  sign.run(1, 'G2', 'Workforce Gate');

  const report = read({ pageSize: '10', 'filter[state]': 'SETUP' });
  assert.deepEqual(report.meta, { page: 1, pageSize: 10, total: 2, totalPages: 1 });
  assert.deepEqual(report.data.map((r) => r.code), ['NH48-P3', 'OTHER-01']);
  assert.deepEqual(read({ page: '2', pageSize: '10' }).data, []);
  const original = await t.call(pcm, 'GET', '/projects?pageSize=10&filter[state]=SETUP');
  assert.equal(original.status, 200);
  assert.deepEqual(report.data, original.json.data.map(({ projectId, code, name, state, stateLabel, status, statusLabel, health }) => ({
    projectId, code, name, state, stateLabel, status, statusLabel, health,
  })));
  for (const query of [null, [], 'page=1']) {
    assert.throws(() => read(query), { status: 400 });
  }
  assert.throws(() => read({ 'filter[contractValue]': '972000000' }), { status: 400 });
  assert.throws(() => read({ sort: 'contractValue' }), { status: 400 });
  assert.throws(() => read({ 'filter[state]': 'INVALID' }), { status: 400 });
  assert.throws(() => read({ pageSize: '1000' }), { status: 400 });
  assert.throws(() => read({}, { companyId: 1, user: se.user, roles: [se.roles] }), { status: 403 });

  authzOf(db).seed();
  const scopedId = Number(db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1,'bi-pm','BI PM','[]','bi-pm@example.com')").run().lastInsertRowid);
  const addScope = db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), ?, ?, 'ACTIVE', 'test')`);
  const siteId = db.prepare('SELECT id FROM org_sites WHERE org_project_id = ? ORDER BY id LIMIT 1').get(project.projectId).id;
  addScope.run(scopedId, 'SITE', JSON.stringify([siteId]));
  const scopedPm = { companyId: 1, userId: scopedId, user: 'bi-pm', roles: [] };
  authzOf(db).invalidate();
  assert.deepEqual(read({}, scopedPm).data, []);
  addScope.run(scopedId, 'PROJECT', JSON.stringify([project.projectId]));
  authzOf(db).invalidate();
  const scoped = read({}, scopedPm);
  assert.deepEqual(scoped.data.map((r) => r.projectId), [project.projectId]);
  assert.equal(scoped.meta.total, 1);

  setFlag.run('ff.bi.p2701', secondCompany, 1);
  setFlag.run('ff.proj.p1001', secondCompany, 1);
  sign.run(secondCompany, 'G1', 'Platform Gate');
  assert.deepEqual(read({}, { ...actor, companyId: secondCompany }).data, []);
  setFlag.run('ff.proj.p1001', 1, 0);
  assert.throws(read, { status: 404 });
  db.prepare("DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1001' AND company_id = 1").run();
  db.prepare('UPDATE core_feature_flags SET enabled = 0 WHERE id = ?').run(biOverride);
  assert.throws(read, { status: 404 });
});
test('27.02 project status dataset preserves source access and rejects unavailable fields', async () => {
  const t = await setup();
  const { db } = t.api;
  const response = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const other = await t.call(pcm, 'POST', '/projects', t.wizard({
    basics: { code: 'BI-OTHER' }, contract: { contractNo: 'BI-OTHER' },
    sites: [{ code: 'BI-OTHER-S1', name: 'Other camp', siteType: 'SITE' }],
  }));
  assert.equal(other.status, 201, JSON.stringify(other.json));
  const flags = createFlagService({ db, environment: 'test' });
  const actor = { companyId: 1, user: pcm.user, roles: [pcm.roles] };
  const context = { db, flags };
  const read = (input, user = actor) => readProjectStatusDataset(context, { ...user }, input);
  const seedFlag = db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES (?, 1, 'Test company override', 0, 1)`);
  assert.equal(flags.isOn(actor, 'ff.bi.p2702'), false);
  assert.throws(read, { status: 404 });
  seedFlag.run('ff.bi.p2702');
  assert.throws(read, { status: 404 }, 'the source report flag is required');
  seedFlag.run('ff.bi.p2701');
  assert.throws(read, { status: 404 }, 'the source report requires its company sign-offs');
  const sign = db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  sign.run('G1', 'Platform Gate');
  sign.run('G2', 'Workforce Gate');
  assert.throws(() => read({}, { ...actor, companyId: 0 }), { status: 404 });
  assert.throws(() => read({}, { ...actor, user: se.user, roles: [se.roles] }), { status: 403 });

  authzOf(db).seed();
  const userId = Number(db.prepare("SELECT id FROM iam_users WHERE company_id = 1 AND username = ?").get(pm1.user).id);
  const assign = db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), ?, ?, 'ACTIVE', 'test')`);
  const site = db.prepare('SELECT id FROM org_sites WHERE org_project_id = ? ORDER BY id LIMIT 1').get(response.json.data.projectId);
  const scopedPm = { companyId: 1, user: pm1.user, userId, roles: [] };
  assign.run(userId, 'SITE', JSON.stringify([site.id]));
  authzOf(db).invalidate();
  assert.deepEqual(read({ fields: ['projectId'] }, scopedPm).data, []);
  assign.run(userId, 'PROJECT', JSON.stringify([response.json.data.projectId]));
  authzOf(db).invalidate();

  const selected = read({ fields: ['name', 'projectId', 'state'], pageSize: '10', 'filter[state]': 'SETUP' }, scopedPm);
  assert.deepEqual(selected, {
    fields: ['name', 'projectId', 'state'],
    data: [{ name: response.json.data.name, projectId: response.json.data.projectId, state: 'SETUP' }],
    meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
  });
  assert.equal(authzOf(db).check({ ...actor }, 'pay.salary.view').allowed, false);
  assert.deepEqual(read({ fields: ['code'], groupBy: 'state', page: 2 }, scopedPm).summary, {
    groupBy: 'state', rows: [{ code: 'SETUP', label: 'Setup', count: 1 }],
  });
  assert.deepEqual(read().data, readProjectStatusReport(context, { ...actor }).data);
  for (const fields of [[], ['code', 'code'], ['contractValue'], ['salary'], ['constructor'], new Array(1), 'code']) {
    assert.throws(() => read({ fields }), { status: 400 });
  }
  for (const input of [null, [], 'code']) assert.throws(() => read(input), { status: 400 });
  assert.throws(() => read({ fields: ['code'], 'filter[salary]': '1' }), { status: 400 });
  assert.throws(() => read({ fields: ['code'], sql: 'SELECT 1' }), { status: 400 });
  assert.throws(() => read({ groupBy: 'salary' }), { status: 400 });
  assert.throws(() => read({ pageSize: '5000' }), { status: 400 });
});

test('27.03 project count matches the transactional register and inherits dataset access', async () => {
  const t = await setup();
  const { api } = t;
  const { db } = api;
  const endpoint = '/api/v1/bi/metrics/project-count';
  const flags = createFlagService({ db, environment: 'test' });
  const metric = (actor) => readProjectCountMetric({ db, flags }, { ...actor });
  const setFlag = db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES (?, ?, 'Metric fixture', 0, 1)`);
  const signGate = db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);

  assert.equal((await api.call('GET', endpoint, pcm)).status, 404, 'metric defaults off');
  setFlag.run('ff.bi.p2703', 1);
  assert.equal((await api.call('GET', endpoint, pcm)).status, 404, 'dataset defaults off');
  setFlag.run('ff.bi.p2702', 1);
  setFlag.run('ff.bi.p2701', 1);
  signGate.run(1, 'G1', 'Platform Gate');
  assert.equal((await api.call('GET', endpoint, pcm)).status, 404, 'G2 remains required');
  signGate.run(1, 'G2', 'Workforce Gate');
  const first = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(first.status, 201);
  const second = await t.call(pcm, 'POST', '/projects', t.wizard({
    basics: { code: 'METRIC-2' }, contract: { contractNo: 'METRIC-2' },
    sites: [{ code: 'METRIC-S2', name: 'Metric test site', siteType: 'SITE' }],
  }));
  assert.equal(second.status, 201);
  const firstProject = first.json.data.projectId;
  // Give the two transactional rows different lifecycle states in this isolated fixture.
  db.prepare("UPDATE proj_projects SET lifecycle_state = 'ARCHIVED' WHERE project_id = ?").run(second.json.data.projectId);

  const res = await api.call('GET', endpoint, pcm);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const { evaluatedAt, ...result } = res.json.data;
  const owner = await t.call(pcm, 'GET', '/projects');
  assert.ok(Number.isFinite(Date.parse(evaluatedAt)));
  assert.deepEqual(result, {
    code: 'project-count', name: 'Project count', certified: false, unit: 'projects',
    definition: 'Count of projects visible to the requester in the Project Status dataset.',
    lineage: { dataset: 'project-status', datasetVersion: 1, source: 'proj.projects', groupedBy: 'lifecycle_state' },
    value: owner.json.meta.total,
    byLifecycle: ['SETUP', 'ARCHIVED'].map((code) => ({
      code, label: owner.json.data.find((row) => row.state === code).stateLabel, count: owner.json.data.filter((row) => row.state === code).length,
    })),
  });
  assert.equal((await api.call('GET', endpoint, se)).status, 403);
  assert.equal((await api.call('GET', `${endpoint}?asOf=2024-01-01`, pcm)).status, 400);
  assert.throws(() => metric({ companyId: 0, user: pcm.user, roles: [pcm.roles] }), { status: 404 });

  const authz = authzOf(db);
  authz.seed();
  const userId = db.prepare('SELECT id FROM iam_users WHERE username = ?').get(pm1.user).id;
  const assign = db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), ?, ?, 'ACTIVE', 'test')`);
  const site = db.prepare('SELECT id FROM org_sites WHERE org_project_id = ? ORDER BY id LIMIT 1').get(firstProject).id;
  const actor = { companyId: 1, user: pm1.user, userId, roles: [] };
  assign.run(userId, 'SITE', JSON.stringify([site]));
  authz.invalidate();
  assert.equal(metric(actor).value, 0);
  assign.run(userId, 'PROJECT', JSON.stringify([firstProject]));
  authz.invalidate();
  assert.deepEqual(metric(actor).byLifecycle, [{ code: 'SETUP', label: 'Setup', count: 1 }]);

  const otherCompany = Number(db.prepare("INSERT INTO org_companies (code, legal_name, short_name) VALUES ('METRIC', 'Other metric company', 'Other')").run().lastInsertRowid);
  for (const key of ['ff.bi.p2703', 'ff.bi.p2702', 'ff.bi.p2701', 'ff.proj.p1001']) setFlag.run(key, otherCompany);
  signGate.run(otherCompany, 'G1', 'Platform Gate');
  signGate.run(otherCompany, 'G2', 'Workforce Gate');
  const isolated = await api.call('GET', endpoint, { ...pcm, company: String(otherCompany) });
  assert.equal(isolated.status, 200);
  assert.equal(isolated.json.data.value, 0);
  assert.deepEqual(isolated.json.data.byLifecycle, []);
});

test('27.03 certification governs dashboard use and monthly captures preserve the original observation', async () => {
  const t = await setup();
  const { api } = t;
  const { db } = api;
  const cfo = as('CFO', 'metric-reviewer');
  const ops = as('ITADM', 'metric-operator');
  db.prepare("INSERT INTO iam_users (company_id,username,display_name,roles_json) VALUES (1,'metric-operator','Metric operator','[\"ITADM\"]')").run();
  const root = '/api/v1/bi/metrics';
  const call = (who, method, path = '', body, headers = key()) => api.call(method, root + path, { ...who, headers, body });
  db.exec(`
    INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.bi.p2701',1,'fixture',0,1), ('ff.bi.p2702',1,'fixture',0,1), ('ff.bi.p2703',1,'fixture',0,1);
    INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),
           (1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP);
  `);
  const project = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(project.status, 201, JSON.stringify(project.json));
  const projectId = project.json.data.projectId;
  const catalogue = await call(pcm, 'GET');
  assert.equal(catalogue.status, 200, JSON.stringify(catalogue.json));
  assert.equal(catalogue.json.data.freshness, 'MISSING');
  const widget = (who) => api.call('GET', '/api/v1/ui/widgets/bi.project_count/data', who);
  assert.equal((await widget(pcm)).status, 404);

  const headers = key();
  const request = await call(pcm, 'POST', '/certifications', { certify: true, reason: 'Checked against the project register' }, headers);
  assert.equal(request.status, 201, JSON.stringify(request.json));
  const { id, version } = request.json.data;
  assert.equal((await call(pcm, 'POST', '/certifications', { certify: true, reason: 'Checked against the project register' }, headers)).json.data.id, id);
  assert.equal((await call(pcm, 'POST', `/certifications/${id}/act`, { action: 'approve', version })).status, 403);
  assert.equal((await call(cfo, 'POST', `/certifications/${id}/act`, { action: 'approve', version: version + 1 })).status, 409);
  const approved = await call(cfo, 'POST', `/certifications/${id}/act`, { action: 'approve', version });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(approved.json.data.status, 'APPROVED');
  const published = await widget(pcm);
  assert.equal(published.status, 200, JSON.stringify(published.json));
  assert.equal(published.json.data.data.value, 1);

  assert.equal((await call(pcm, 'POST', '/snapshots', {})).status, 403);
  const rt = runtimeOf(db);
  for (let run = 0; run < 2; run += 1) {
    const capture = await call(ops, 'POST', '/snapshots', {});
    assert.equal(capture.status, 202, JSON.stringify(capture.json));
    const job = capture.json.data.id;
    for (let i = 0; i < 25 && rt.jobs.get(job).status === 'QUEUED'; i += 1) await rt.jobs.runNext();
    assert.equal(rt.jobs.get(job).status, 'SUCCEEDED', JSON.stringify(rt.jobs.get(job)));
    // The second run sees changed source data but must preserve the first capture.
    db.prepare("UPDATE proj_projects SET lifecycle_state = 'ARCHIVED' WHERE project_id = ?").run(projectId);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bi_refresh_log').get().n, 1);
  assert.deepEqual([...db.prepare('SELECT lifecycle_state FROM bi_project_snapshots').all()].map((row) => row.lifecycle_state), ['SETUP']);
  const history = (await call(pcm, 'GET')).json.data;
  assert.equal(history.periods[0].value, 1);
  assert.equal(history.periods[0].completeness, 'COMPLETE');
  assert.equal(history.freshness, 'CURRENT');
  assert.equal(history.metric.byLifecycle[0].code, 'ARCHIVED');
  const historyPath = `${root}/history/export`;
  const csv = await api.raw('GET', `${historyPath}?format=csv`, pcm);
  assert.equal(csv.status, 200, csv.buffer.toString());
  assert.match(csv.buffer.toString(), /Month,Captured at,Visible projects,Completeness/);
  assert.equal((await api.raw('GET', `${historyPath}?format=pdf`, pcm)).buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal((await api.raw('GET', `${historyPath}?format=xlsx`, pcm)).buffer.subarray(0, 2).toString(), 'PK');
  const operator = (await call(ops, 'GET')).json.data;
  if (operator.metric.value === undefined) assert.equal(operator.periods[0].value, undefined);

  const revoke = await call(cfo, 'POST', '/certifications', { certify: false, reason: 'Source changes require another review' });
  assert.equal(revoke.status, 201, JSON.stringify(revoke.json));
  assert.equal((await call(pcm, 'POST', `/certifications/${revoke.json.data.id}/act`,
    { action: 'approve', version: revoke.json.data.version })).status, 200);
  assert.equal((await widget(pcm)).status, 404);
  assert.equal((await api.call('GET', historyPath, pcm)).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bi_metrics').get().n, 2);
  while (rt.bus.relayOnce(100)) { /* drain fixture outbox */ }
  rt.bus.deliverOnce(500);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code='bi.metric.decided' AND company_id=1").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code='bi.snapshot.ready' AND user_ref='metric-operator'").get().n, 1);
});

test('27.03 approved project metrics keep distinct certificates, scoped values and monthly evidence', async () => {
  const t = await setup();
  const { api } = t;
  const { db } = api;
  const root = '/api/v1/bi/metrics';
  const get = (who, path) => api.call('GET', root + path, who);
  const post = (who, path, body) => api.call('POST', root + path, { ...who, body, headers: key() });
  const ops = as('ITADM', 'domain-operator');
  const reviewer = as('CFO', 'domain-reviewer');
  const cm = as('CM', 'domain-viewer');
  const flags = db.prepare('INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, ?, 0, 1)');
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.site.p1405', 'ff.fin.p2311', 'ff.fin.p2312', 'ff.proj.p1008']) flags.run(code, 'Domain fixture');
  for (const code of ['ff.fin.p2305', 'ff.inv.p1611', 'ff.hse.p1908']) {
    flags.run(code, 'Out of scope for this fixture');
    db.prepare('UPDATE core_feature_flags SET enabled = 0 WHERE company_id = 1 AND key = ?').run(code);
  }
  db.exec(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)`);
  const created = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const other = await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'OTHER-P27' }, contract: { contractNo: 'OTHER-P27' },
    sites: [{ code: 'M27-S2', name: 'Other site', siteType: 'SITE' }] }));
  assert.equal(other.status, 201, JSON.stringify(other.json));
  const project = created.json.data.projectId;
  const otherProject = other.json.data.projectId;
  const period = db.prepare(`INSERT INTO prs_periods
    (company_id, doc_no, org_project_id, period_type, period_start, period_end, status)
    VALUES (1, ?, ?, 'MONTH', ?, ?, ?)`);
  const evm = db.prepare('INSERT INTO prs_evm (company_id, org_project_id, period_id, period_end, spi, cpi) VALUES (1, ?, ?, ?, ?, ?)');
  for (const [id, doc, date, status, spi, cpi] of [
    [project, 'PR-OLD', '2025-01-31', 'APPROVED', 9100, 9600],
    [project, 'PR-CLOSED', '2025-02-28', 'APPROVED', 8750, 9500],
    [project, 'PR-DRAFT', '2025-03-31', 'DRAFT', 9999, 9999],
    [otherProject, 'PR-OTHER', '2025-02-28', 'APPROVED', 8800, null],
  ]) {
    const row = period.run(doc, id, date.slice(0, 8) + '01', date, status);
    evm.run(id, row.lastInsertRowid, date, spi, cpi);
  }
  const forecast = db.prepare(`INSERT INTO fc_forecasts
    (company_id, doc_no, org_project_id, period, version_no, eac_total_paise, status)
    VALUES (1, ?, ?, ?, ?, ?, ?)`);
  forecast.run('FC-APPROVED', project, '2025-02', 2, 123456789, 'APPROVED');
  forecast.run('FC-DRAFT', project, '2025-03', 1, 999999999, 'DRAFT');
  const plSnapshot = db.prepare(`INSERT INTO pl_snapshots
    (company_id, doc_no, org_project_id, period, revenue_paise, gross_profit_paise, status, frozen_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)`);
  const locked = plSnapshot.run('PL-FROZEN', project, '2025-02', 25000000, 6500000, 'APPROVED', '2025-03-01T00:00:00Z');
  plSnapshot.run('PL-DRAFT', project, '2025-03', 10000000, 9999999, 'DRAFT', null);
  plSnapshot.run('PL-ZERO', otherProject, '2025-02', 0, 0, 'APPROVED', '2025-03-01T00:00:00Z');
  const detail = (who, code, id = project) => get(who, `/domains/${code}?projectId=${id}`);
  const spi = await detail(cm, 'spi');
  assert.equal(spi.status, 200, JSON.stringify(spi.json));
  assert.equal(spi.json.data.live.value, 0.875);
  assert.equal(spi.json.data.live.sourcePeriod, '2025-02-28');
  assert.equal((await detail(cm, 'cpi')).status, 403);
  assert.equal((await detail(cm, 'eac')).status, 403);
  assert.equal((await detail(cm, 'gross-margin')).status, 403);
  assert.equal((await detail(pcm, 'cpi')).json.data.live.value, 0.95);
  assert.equal((await detail(pcm, 'eac')).json.data.live.value, 1234567.89);
  assert.equal((await detail(pcm, 'eac', otherProject)).json.data.live, null);
  const margin = await detail(reviewer, 'gross-margin');
  assert.equal(margin.status, 200, JSON.stringify(margin.json));
  assert.equal(margin.json.data.live.value, 26);
  assert.equal(margin.json.data.live.sourceRoute, `/finance/project-pl?snapshot=${locked.lastInsertRowid}`);
  assert.equal((await detail(reviewer, 'gross-margin', otherProject)).json.data.live.value, null);
  period.run('PR-NO-EVM', otherProject, '2025-03-01', '2025-03-31', 'APPROVED');
  const incomplete = await detail(pcm, 'spi', otherProject);
  assert.equal(incomplete.json.data.live.sourcePeriod, '2025-03-31');
  assert.equal(incomplete.json.data.live.value, null);
  assert.deepEqual((await get(cm, '/domains')).json.data.map((item) => item.code), ['spi']);
  assert.deepEqual((await get(pcm, '/domains/spi?search=OTHER-P27')).json.data.projects.map((item) => item.id), [otherProject]);
  const widget = (who, code, scope = `?projectId=${project}`) => api.call('GET', `/api/v1/ui/widgets/bi.${code}/data${scope}`, who);
  const exportHistory = (who, code, format = 'csv', id = project) => api.raw('GET',
    `${root}/domains/${code}/export?filter[projectId]=${id}&format=${format}`, who);
  const project360 = async (period = '') => {
    const response = await t.call(pcm, 'GET', `/project-360?projectId=${project}${period}`);
    assert.equal(response.status, 200, JSON.stringify(response.json));
    return response.json.data.tabs.flatMap((tab) => tab.widgets).filter((entry) => entry.code.startsWith('bi.'));
  };
  assert.equal((await widget(pcm, 'spi')).status, 404);
  assert.equal((await exportHistory(pcm, 'spi')).status, 404);
  assert.deepEqual(await project360(), []);

  authzOf(db).seed();
  const userId = db.prepare("SELECT id FROM iam_users WHERE username = 'ppm1'").get().id;
  db.prepare(`INSERT INTO iam_assignments (company_id,user_id,role_id,scope_type,scope_ids_json,status,created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`)
    .run(userId, JSON.stringify([project]));
  authzOf(db).invalidate();
  const actor = { companyId: 1, userId, user: 'ppm1', roles: [] };
  authzOf(db).enrich(actor);
  const direct = (code, id) => readDomainMetric({ db, flags: createFlagService({ db, environment: 'test' }) },
    actor, code, { projectId: id });
  assert.throws(() => direct('spi', otherProject), { status: 404 });
  assert.deepEqual(direct('cpi').projects.map((record) => record.id), [project]);

  const jobs = runtimeOf(db).jobs;
  const capture = async () => {
    const queued = await post(ops, '/snapshots', {});
    assert.equal(queued.status, 202, JSON.stringify(queued.json));
    for (let i = 0; i < 20 && jobs.get(queued.json.data.id).status === 'QUEUED'; i += 1) await jobs.runNext();
    assert.equal(jobs.get(queued.json.data.id).status, 'SUCCEEDED', JSON.stringify(jobs.get(queued.json.data.id)));
  };
  await capture();
  db.prepare("UPDATE prs_periods SET status = 'SUPERSEDED' WHERE doc_no = 'PR-CLOSED'").run();
  const amendment = period.run('PR-REVISED', project, '2025-02-01', '2025-02-28', 'APPROVED');
  evm.run(project, amendment.lastInsertRowid, '2025-02-28', 7000, 7500);
  await capture();
  const observed = await detail(pcm, 'spi');
  assert.equal(observed.json.data.live.value, 0.7);
  assert.equal(observed.json.data.periods[0].value, 0.875);
  assert.equal(observed.json.data.periods.length, 1);
  assert.equal(direct('eac', project).periods[0].value, 1234567.89);
  const quality = await get(ops, '/domain-quality');
  assert.equal(quality.status, 200, JSON.stringify(quality.json));
  assert.deepEqual(quality.json.data.map(({ code, completeness, rows, missing }) => ({ code, completeness, rows, missing })), [
    { code: 'spi', completeness: 'INCOMPLETE', rows: 2, missing: 1 },
    { code: 'cpi', completeness: 'INCOMPLETE', rows: 2, missing: 1 },
    { code: 'eac', completeness: 'COMPLETE', rows: 1, missing: 0 },
    { code: 'gross-margin', completeness: 'INCOMPLETE', rows: 2, missing: 1 },
  ]);
  assert.equal((await get(pcm, '/domain-quality')).status, 403);

  const submit = (code) => post(pcm, '/certifications', { code, certify: true, reason: 'Verified with approved source' });
  const spiRequest = await submit('spi');
  const eacRequest = await submit('eac');
  assert.equal(spiRequest.status, 201, JSON.stringify(spiRequest.json));
  assert.equal(eacRequest.status, 201, JSON.stringify(eacRequest.json));
  assert.deepEqual((await get(pcm, '/certifications?code=spi')).json.data.map((entry) => entry.id), [spiRequest.json.data.id]);
  const { id, version } = spiRequest.json.data;
  assert.equal((await post(pcm, `/certifications/${id}/act`, { action: 'approve', version })).status, 403);
  assert.equal((await post(reviewer, `/certifications/${id}/act`, { action: 'approve', version })).status, 200);
  assert.equal((await detail(pcm, 'spi')).json.data.certified, true);
  assert.equal((await detail(pcm, 'eac')).json.data.certified, false);
  assert.equal((await get(pcm, '/project-count')).json.data.certified, false);
  const published = await widget(cm, 'spi');
  assert.equal(published.status, 200, JSON.stringify(published.json));
  assert.equal(published.json.data.data.value, 0.7);
  assert.match(published.json.data.data.drill, /^\/site\/periods\?id=\d+$/);
  assert.equal((await widget(cm, 'spi', '')).json.data.data.empty, true);
  assert.equal((await widget(pcm, 'eac')).status, 404);
  assert.deepEqual((await project360()).map((entry) => [entry.code, entry.figures[0].value]), [['bi.spi', 0.7]]);
  assert.equal((await project360('&period=2025-02'))[0].figures[0].value, null);
  assert.equal((await detail(pcm, 'spi')).json.data.canExport, true);
  assert.equal((await exportHistory(cm, 'spi')).status, 403);
  assert.equal((await exportHistory(pcm, 'spi', 'csv', 99999)).status, 404);
  for (const format of ['csv', 'xlsx', 'pdf']) {
    const file = await exportHistory(pcm, 'spi', format);
    assert.equal(file.status, 200, file.buffer.toString());
    const written = file.buffer.toString();
    if (format === 'csv') assert.match(written, /0\.875.*2025-02-28/);
    if (format === 'xlsx') assert.ok(written.startsWith('PK'));
    if (format === 'pdf') assert.ok(written.startsWith('%PDF'));
  }
  const eacApproval = eacRequest.json.data;
  assert.equal((await post(reviewer, `/certifications/${eacApproval.id}/act`, { action: 'approve', version: eacApproval.version })).status, 200);
  assert.equal((await detail(dir, 'eac')).json.data.canExport, false);
  assert.equal((await exportHistory(dir, 'eac')).status, 403);
  assert.equal((await exportHistory(reviewer, 'eac')).status, 200);
  const export360 = (who) => api.raw('GET', `${P}/project-360/export?projectId=${project}&format=csv`, who);
  const restrictedFile = await export360(dir);
  assert.equal(restrictedFile.status, 200, restrictedFile.buffer.toString());
  assert.doesNotMatch(restrictedFile.buffer.toString(), /Certified estimate at completion/);
  assert.match((await export360(pd1)).buffer.toString(), /Certified estimate at completion/);
  const revoke = await post(pcm, '/certifications', { code: 'spi', certify: false, reason: 'Approved revision requires review' });
  assert.equal(revoke.status, 201, JSON.stringify(revoke.json));
  assert.equal((await post(reviewer, `/certifications/${revoke.json.data.id}/act`, { action: 'approve', version: revoke.json.data.version })).status, 200);
  assert.equal((await widget(cm, 'spi')).status, 404);
  assert.equal((await exportHistory(pcm, 'spi')).status, 404);
  assert.deepEqual((await project360()).map((entry) => entry.code), ['bi.eac']);
  db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1405' AND company_id = 1").run();
  assert.equal((await detail(pcm, 'spi')).status, 404);
  assert.equal((await detail(pcm, 'eac')).json.data.periods.length, 1);
});

test('27.03 operational metric captures agree with their owners and exclude projects with denied sites', async () => {
  const t = await setup();
  const { api } = t;
  const { db } = api;
  const created = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const projectId = created.json.data.projectId;
  const sites = db.prepare('SELECT id FROM org_sites WHERE org_project_id = ? ORDER BY id').all(projectId);
  const [site] = sites;
  const date = todayIST();
  const old = new Date(Date.parse(date) - 100 * 86_400_000).toISOString().slice(0, 10);
  const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?,1,'Operational KPI fixture',0,1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.fin.p2305', 'ff.inv.p1611', 'ff.hse.p1908']) flag.run(code);
  db.exec(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)`);
  const invoice = db.prepare(`INSERT INTO ar_invoices (company_id,doc_no,inv_source,org_project_id,partner_id,invoice_date,due_date,amount_paise,received_paise,status)
    VALUES (1,?,'OTHER_INCOME',?,?,?,?,?,?,?)`);
  invoice.run('AR-POSTED', projectId, t.ids.client, date, date, 100000, 40000, 'APPROVED');
  invoice.run('AR-DRAFT', projectId, t.ids.client, date, date, 999999, 0, 'DRAFT');
  const store = db.prepare(`INSERT INTO inv_stores (company_id,code,name,store_type,org_project_id,org_site_id,store_status,requested_by)
    VALUES (1,'BI-S','BI store','SITE_STORE',?,?,'ACTIVE','fixture')`).run(projectId, site.id).lastInsertRowid;
  const bin = db.prepare("INSERT INTO inv_bins (company_id,store_id,code) VALUES (1,?,'BI-B')").run(store).lastInsertRowid;
  const category = db.prepare(`INSERT INTO mdm_item_categories (company_id,code,name,code_prefix,item_types_json,attribute_template_json,steward_role,category_status)
    VALUES (1,'BI-C','BI Category','BIC','[]','[]','PROCMGR','ACTIVE')`).run().lastInsertRowid;
  const item = db.prepare(`INSERT INTO mdm_items (company_id,code,name,item_type,category_id,base_uom,effective_from,item_status,stock_tracked)
    VALUES (1,'BI-I','BI item','MATERIAL',?,'bag',?,'ACTIVE',1)`).run(category, old).lastInsertRowid;
  const ledger = db.prepare(`INSERT INTO inv_stock_ledger (company_id, doc_no, store_id, bin_id, item_id, txn_type, txn_date, value, balance_qty, balance_value, posted_by)
    VALUES (1,?,?,?,?,?,?,?,0,?,'fixture')`);
  ledger.run('OPEN', store, bin, item, 'OPENING', old, 10000, 10000);
  ledger.run('ISSUE', store, bin, item, 'ISSUE', date, -2000, 8000);
  db.prepare(`INSERT INTO att_daily (company_id, person_id, work_date,daily_site_id,status,worked_minutes,computed_at)
    VALUES (1,1,?,?,'PRESENT',60000,CURRENT_TIMESTAMP)`).run(date, site.id);
  const incident = db.prepare(`INSERT INTO hse_incidents (company_id,doc_no,org_project_id,org_site_id,incident_type,classification,severity,occurred_at,description,reported_by,incident_status)
    VALUES (1,?,?,?,'INJURY','LTI','HIGH',?,'Fixture injury','fixture',?)`);
  incident.run('LTI-REPORTED', projectId, site.id, `${date}T09:00`, 'REPORTED');
  incident.run('LTI-CANCELLED', projectId, site.id, `${date}T10:00`, 'CANCELLED');

  const root = '/api/v1/bi/metrics';
  const buyer = as('STOREMGR', 'kpi-stores');
  const buyerWithoutValues = as('DIR', 'kpi-director');
  const finance = as('CFO', 'kpi-finance');
  const safety = as('HSEO', 'kpi-safety');
  const view = (who, code) => api.call('GET', `${root}/domains/${code}?projectId=${projectId}`, who);
  const post = (who, path, body) => api.call('POST', root + path, { ...who, body, headers: key() });
  const compare = async (who, code, path, expected, extract) => {
    const source = await api.call('GET', `${path}?projectId=${projectId}`, who);
    const derived = await view(who, code);
    assert.equal(source.status, 200, JSON.stringify(source.json));
    assert.equal(derived.status, 200, JSON.stringify(derived.json));
    assert.equal(derived.json.data.live.value, expected);
    assert.equal(derived.json.data.live.value, extract(source.json.data));
    assert.equal(derived.json.data.lineage.aggregate, true);
  };
  await compare(finance, 'dso', '/api/v1/fin/receivables/ageing', 54, (data) => data.dso);
  await compare(buyer, 'stock-turns', '/api/v1/inv/materials/dashboard', 0.9, (data) => data.kpis.stockTurns.turns);
  await compare(safety, 'ltifr', '/api/v1/hse/dashboard', 1000, (data) => data.tiles.find((tile) => tile.key === 'ltifr').value);
  assert.equal((await view(buyerWithoutValues, 'stock-turns')).status, 403);

  const jobs = runtimeOf(db).jobs;
  const queued = await post(as('ITADM', 'kpi-operator'), '/snapshots', {});
  assert.equal(queued.status, 202, JSON.stringify(queued.json));
  for (let i = 0; i < 20 && jobs.get(queued.json.data.id).status === 'QUEUED'; i += 1) await jobs.runNext();
  assert.equal(jobs.get(queued.json.data.id).status, 'SUCCEEDED');
  db.prepare("UPDATE ar_invoices SET received_paise = 80000 WHERE doc_no = 'AR-POSTED'").run();
  const dso = (await view(finance, 'dso')).json.data;
  assert.equal(dso.live.value, 18);
  assert.equal(dso.periods[0].value, 54);
  assert.match(dso.live.sourceRoute, /receivables\?tab=ageing&projectId=/);
  assert.equal((await view(buyer, 'stock-turns')).json.data.periods[0].value, 0.9);
  assert.equal((await view(safety, 'ltifr')).json.data.periods[0].value, 1000);
  const certification = await post(pcm, '/certifications', { code: 'ltifr', certify: true, reason: 'Compared source report with attendance ledger' });
  assert.equal(certification.status, 201, JSON.stringify(certification.json));
  const { id, version } = certification.json.data;
  assert.equal((await post(finance, `/certifications/${id}/act`, { action: 'approve', version })).status, 200);
  const exported = await api.raw('GET', `${root}/domains/ltifr/export?filter[projectId]=${projectId}`, safety);
  assert.equal(exported.status, 200, exported.buffer.toString());
  assert.match(exported.buffer.toString(), /Source calculation version/);

  const authz = authzOf(db);
  authz.seed();
  const safetyId = db.prepare(`INSERT INTO iam_users (company_id, username, display_name, roles_json)
    VALUES (1, ?, 'KPI safety reviewer', '["HSEO"]')`).run(safety.user).lastInsertRowid;
  const safetyActor = () => authz.enrich({ companyId: 1, userId: Number(safetyId), user: safety.user, roles: ['HSEO'] });
  const exports = listExportsOf(db);
  const exportJob = exports.start(safetyActor(), domainHistoryCode('ltifr'),
    { 'filter[projectId]': String(projectId), format: 'csv' }, { queued: true });
  assert.equal(exportJob.kind, 'job');
  for (let i = 0; i < 20 && exports.mine(safetyActor()).find((row) => row.id === exportJob.id).status === 'QUEUED'; i += 1) await jobs.runNext();
  assert.match(exports.download(safetyActor(), exportJob.id).buffer.toString(), /Source calculation version/);
  const userId = db.prepare("SELECT id FROM iam_users WHERE username = 'ppm1'").get().id;
  const roleId = db.prepare("INSERT INTO iam_roles (company_id,code,name,status) VALUES (1,'LIMIT-BI','BI site restriction','ACTIVE')").run().lastInsertRowid;
  db.prepare("INSERT INTO iam_role_permissions (role_id,perm_key,effect) VALUES (?,'hse.dashboard.view','deny')").run(roleId);
  const assign = db.prepare(`INSERT INTO iam_assignments (company_id,user_id,role_id,scope_type,scope_ids_json,status,created_by)
    VALUES (1,?,?,?,?,'ACTIVE','fixture')`);
  const pmRoleId = db.prepare("SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL").get().id;
  assign.run(userId, pmRoleId, 'PROJECT', JSON.stringify([projectId]));
  assign.run(userId, roleId, 'SITE', JSON.stringify([sites[1].id]));
  const hseRoleId = db.prepare("SELECT id FROM iam_roles WHERE code = 'HSEO' AND company_id IS NULL").get().id;
  assign.run(safetyId, hseRoleId, 'COMPANY', '[]');
  assign.run(safetyId, roleId, 'SITE', JSON.stringify([sites[1].id]));
  authz.invalidate();
  const actor = authz.enrich({ companyId: 1, userId, user: 'ppm1', roles: [] });
  const context = { db, flags: createFlagService({ db, environment: 'test' }) };
  assert.equal(authz.check(actor, 'hse.dashboard.view', { companyId: 1, projectId }).allowed, true);
  assert.throws(() => readDomainMetric(context, actor, 'ltifr', { projectId }), { status: 404 });
  assert.deepEqual(readDomainMetric(context, actor, 'ltifr', {}).projects, []);
  assert.throws(() => exports.download(safetyActor(), exportJob.id), { status: 404 });
});

test('27 reporting routes enforce the flags and support filtered files and saved reports', async () => {
  const t = await setup();
  const { api } = t;
  const prefix = '/api/v1/bi';
  const call = (who, method, path, body, headers = key()) => api.call(method, prefix + path, { ...who, headers, body });
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard())).status, 201);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({
    basics: { code: 'BI-SECOND' }, contract: { contractNo: 'BI-SECOND' },
    sites: [{ code: 'BI-SECOND-S1', name: 'Other camp', siteType: 'SITE' }],
  }))).status, 201);
  assert.equal((await call(pcm, 'GET', '/reports')).status, 404);
  api.db.exec(`
    INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.bi.p2701', 1, 'Run report route tests', 0, 1), ('ff.bi.p2702', 1, 'Run builder route tests', 0, 1);
    INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1, 'G1', 'Platform Gate', 'PASSED', 'test', CURRENT_TIMESTAMP),
           (1, 'G2', 'Workforce Gate', 'PASSED', 'test', CURRENT_TIMESTAMP);
  `);
  const listed = (await call(se, 'GET', '/reports')).json.data.map(({ code }) => code);
  assert.ok(!listed.includes('project-status') && !listed.includes('payroll'));
  assert.equal((await call(se, 'GET', '/reports/project-status')).status, 403);
  assert.equal((await call(pcm, 'GET', '/reports')).json.data[0].code, 'project-status');
  const path = '/reports/project-status';
  const state = 'filter[state]=SETUP';
  const run = await call(pcm, 'GET', `${path}?${state}`);
  assert.equal(run.json.data.meta.total, 2);
  for (const [format, signature] of [['csv', /NH48-P3/], ['xlsx', /^PK/], ['pdf', /^%PDF/]]) {
    const file = await api.raw('GET', `${prefix}${path}/export?format=${format}&${state}`, dir2);
    assert.equal(file.status, 200, file.buffer.toString());
    assert.equal(file.headers.get('x-export-rows'), '2');
    assert.match(file.buffer.toString('utf8'), signature);
    if (format === 'csv') assert.doesNotMatch(file.buffer.toString(), /972000000|Contract Value/);
  }
  assert.equal((await api.raw('GET', `${prefix}${path}/export?format=csv&filter[salary]=1`, dir2)).status, 400);
  const authz = authzOf(api.db);
  authz.seed();
  const projectScope = run.json.data.data.find(({ code }) => code === 'NH48-P3').projectId;
  const userId = api.db.prepare('SELECT id FROM iam_users WHERE company_id = 1 AND username = ?').get(pm1.user).id;
  api.db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PD' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`)
    .run(userId, JSON.stringify([projectScope]));
  authz.invalidate();
  const scopedExporter = authz.enrich({ companyId: 1, userId, user: pm1.user, roles: ['PM'] });
  const actual = listExportsOf(api.db).start(scopedExporter, 'bi.project_status', { format: 'csv' });
  assert.equal(actual.kind, 'file');
  assert.equal(actual.rows, 1);
  assert.match(actual.buffer.toString(), /NH48-P3/);
  assert.doesNotMatch(actual.buffer.toString(), /BI-SECOND/);
  const dataset = '/datasets/project-status';
  assert.equal((await call(pcm, 'GET', dataset)).json.data.version, 1);
  const preview = await call(pcm, 'POST', `${dataset}/preview`, { fields: ['code'], 'filter[state]': 'SETUP' });
  assert.deepEqual(preview.json.data.data, [{ code: 'BI-SECOND' }, { code: 'NH48-P3' }]);
  assert.equal((await call(pcm, 'POST', `${dataset}/preview`, { fields: ['salary'] })).status, 400);
  const customCsv = await api.raw('GET', `${prefix}${dataset}/export?format=csv&fields=status,code&${state}`, dir);
  assert.equal(customCsv.status, 200, customCsv.buffer.toString());
  assert.match(customCsv.buffer.toString(), /Approval code,Code/);
  assert.doesNotMatch(customCsv.buffer.toString(), /Contract Value|Health/);
  assert.equal((await call(dir, 'GET', `${dataset}/export?fields=salary`)).status, 400);

  const saved = '/custom-reports';
  const input = { name: 'My Project Report', fields: ['code', 'stateLabel'], state: 'SETUP', groupBy: 'status' };
  const requestKey = key();
  const created = await call(dir, 'POST', saved, input, requestKey);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.config.groupBy, 'status');
  const { id, version } = created.json.data;
  assert.equal((await call(dir, 'POST', saved, input, requestKey)).json.data.id, id);
  const otherCompany = Number(api.db.prepare("INSERT INTO org_companies (code, legal_name, short_name) VALUES ('BI-IDEM', 'BI Other Company', 'Other')").run().lastInsertRowid);
  const companyFlag = api.db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Test override', 0, 1)");
  for (const flag of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.proj.p1001']) companyFlag.run(flag, otherCompany);
  api.db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    SELECT ?, code, name, status, catalogue_version, passed_at FROM hr_gates WHERE company_id = 1 AND code IN ('G1', 'G2')`).run(otherCompany);
  const otherSaved = await call({ ...dir, company: String(otherCompany) }, 'POST', saved, input, requestKey);
  assert.equal(otherSaved.status, 201, JSON.stringify(otherSaved.json));
  assert.notEqual(otherSaved.json.data.id, id);
  assert.deepEqual((await call(pd1, 'GET', saved)).json.data, []);
  assert.equal((await call(pd1, 'PUT', `${saved}/${id}`, { ...input, version })).status, 404);
  const share = await call(dir, 'PUT', `${saved}/${id}`, { ...input, shared: true, roles: ['PD'], version });
  assert.equal(share.status, 200, JSON.stringify(share.json));
  assert.equal((await call(pd1, 'GET', saved)).json.data[0].id, id);
  assert.equal((await call(dir, 'PUT', `${saved}/${id}`, { ...input, version })).status, 409);
  assert.equal((await api.call('GET', '/api/v1/ui/saved-views?list=bi.project_status', dir)).status, 400);
  assert.equal((await api.call('PATCH', `/api/v1/ui/saved-views/${id}`, { ...dir, body: { name: 'Changed', version: share.json.data.version } })).status, 404);
  assert.equal((await call(dir, 'DELETE', `${saved}/${id}?version=${share.json.data.version}`)).status, 200);
  assert.deepEqual((await call(pd1, 'GET', saved)).json.data, []);

  api.db.prepare(`INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type)
    VALUES (1, 'core.export.max_rows', '1', 'integer', 'company', 1, '2020-01-01', 't', 'test')`).run();
  const queued = await call(dir, 'GET', `${path}/export?format=csv&${state}`);
  const customJob = await call(dir, 'GET', `${dataset}/export?format=csv&fields=code&${state}`);
  assert.equal(queued.status, 202, JSON.stringify(queued.json));
  assert.equal(customJob.status, 202, JSON.stringify(customJob.json));
  const download = `/api/v1/ui/exports/${queued.json.data.id}/download`;
  const customDownload = `/api/v1/ui/exports/${customJob.json.data.id}/download`;
  for (let i = 0; i < 5; i += 1) await runtimeOf(api.db).jobs.runNext();
  assert.equal((await api.raw('GET', download, dir)).status, 200);
  const customResult = await api.raw('GET', customDownload, dir);
  assert.equal(customResult.status, 200, customResult.buffer.toString());
  assert.match(customResult.buffer.toString(), /Code\r\nBI-SECOND/);
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bi.p2702' AND company_id = 1").run();
  assert.equal((await api.raw('GET', customDownload, dir)).status, 404);
  assert.equal((await api.raw('GET', download, dir)).status, 200);
  assert.equal((await api.raw('GET', download, dir2)).status, 404);
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bi.p2701' AND company_id = 1").run();
  assert.equal((await api.raw('GET', download, dir)).status, 404);
  assert.equal((await call(dir, 'POST', saved, input, requestKey)).status, 404);
});

const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;
const activate = async (t, who, id) => {
  const s = await t.call(who, 'POST', `/projects/${id}/submit`, { ticked: ALL }); assert.equal(s.status, 202, JSON.stringify(s.json));
  const inst = s.json.data.workflowInstanceId;
  await t.act(pd1, inst); await t.act(dir, inst);
  return (await t.call(who, 'GET', `/projects/${id}`)).json.data;
};

test('27 subscriptions schedule scoped exports and track notification delivery with current access', async () => {
  const t = await setup();
  const { api } = t;
  const { db } = api;
  const root = '/api/v1/bi';
  const call = (who, method, path, body, headers = key()) => api.call(method, root + path, { ...who, headers, body });
  const input = { name: 'Daily project report', state: 'SETUP', frequency: 'DAILY', format: 'csv', channel: 'EMAIL' };
  assert.equal((await call(pd1, 'POST', '/subscriptions', input)).status, 404);
  db.exec(`
    INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.bi.p2701', 1, 'Test reporting', 0, 1), ('ff.bi.p2702', 1, 'Test builder', 0, 1);
    INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1, 'G1', 'Platform Gate', 'PASSED', 'test', CURRENT_TIMESTAMP),
           (1, 'G2', 'Workforce Gate', 'PASSED', 'test', CURRENT_TIMESTAMP);
    INSERT INTO ntf_preferences (company_id, user_ref, category, channels_json)
    VALUES (1, 'ppd1', 'system', '{"EMAIL":true}');
  `);
  const project = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(project.status, 201, JSON.stringify(project.json));

  const request = key();
  const created = await call(pd1, 'POST', '/subscriptions', input, request);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const sub = created.json.data;
  assert.equal((await call(pd1, 'POST', '/subscriptions', input, request)).json.data.id, sub.id);
  assert.equal((await call(pd1, 'POST', '/subscriptions', input)).status, 409);
  assert.equal((await call(pd2, 'PATCH', `/subscriptions/${sub.id}`, { status: 'PAUSED', version: sub.version })).status, 404);
  assert.deepEqual((await call(pd2, 'GET', '/subscriptions')).json.data.subscriptions, []);

  const saved = await call(pd1, 'POST', '/custom-reports', { name: 'Project codes', fields: ['code'], state: 'SETUP' });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  const builderInput = { ...input, name: 'Code list', state: undefined, savedReportId: saved.json.data.id, channel: 'IN_APP' };
  assert.equal((await call(pd2, 'POST', '/subscriptions', builderInput)).status, 404);
  const custom = await call(pd1, 'POST', '/subscriptions', builderInput);
  assert.equal(custom.status, 201, JSON.stringify(custom.json));

  const rt = runtimeOf(db);
  const makeDue = () => db.prepare("UPDATE rpt_subscriptions SET next_run_at = '2000-01-01T02:30:00.000Z' WHERE company_id = 1").run();
  makeDue();
  db.prepare("UPDATE core_schedules SET next_run_at = '2000-01-01T02:30:00.000Z' WHERE code = 'bi.subscriptions'").run();
  assert.ok(rt.scheduler.tick() >= 1);
  const drain = async () => { for (let i = 0; i < 20; i += 1) if (!await rt.jobs.runNext()) break; };
  await drain();
  rt.jobs.enqueue('bi.subscriptions');
  await drain();
  const status = await call(pd1, 'GET', '/subscriptions');
  assert.equal(status.status, 200, JSON.stringify(status.json));
  assert.equal(status.json.data.runs.length, 2);
  assert.ok(status.json.data.runs.every(({ status }) => status === 'READY'));
  assert.equal(status.json.data.runs.find(({ subscriptionId }) => subscriptionId === sub.id).deliveryStatus, 'PENDING');
  assert.equal(db.prepare("SELECT count(*) AS n FROM ntf_deliveries WHERE channel = 'EMAIL' AND user_ref = 'ppd1' AND subject = 'Scheduled report ready'").get().n, 1);
  const customRun = status.json.data.runs.find(({ subscriptionId }) => subscriptionId === custom.json.data.id);
  const userId = db.prepare("SELECT id FROM iam_users WHERE username = 'ppd1'").get().id;
  const actor = authzOf(db).enrich({ user: 'ppd1', companyId: 1, userId, roles: ['PD'] });
  const file = listExportsOf(db).download(actor, customRun.exportId);
  assert.equal((await api.call('GET', `/api/v1/ui/exports/${customRun.exportId}/download`, pd1)).status, 200);
  assert.match(file.buffer.toString(), /Code\r\nNH48-P3/);
  assert.doesNotMatch(file.buffer.toString(), /Contract Value|Health/);
  assert.throws(() => listExportsOf(db).download({ ...actor, user: 'ppd2' }, customRun.exportId), { status: 404 });
  assert.equal((await call(pd1, 'PATCH', `/subscriptions/${sub.id}`, { status: 'PAUSED', version: sub.version })).json.data.status, 'PAUSED');
  assert.equal((await call(pd1, 'PATCH', `/subscriptions/${sub.id}`, { status: 'ACTIVE', version: sub.version })).status, 409);
  const edited = await call(pd1, 'PUT', `/subscriptions/${sub.id}`, {
    ...input, name: 'Monthly project report', frequency: 'MONTHLY', channel: 'WHATSAPP', version: sub.version + 1,
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.data.status, 'PAUSED');
  assert.equal(edited.json.data.channel, 'WHATSAPP');
  assert.equal((await call(pd1, 'GET', '/subscriptions')).json.data.runs.find(({ subscriptionId }) => subscriptionId === sub.id).deliveryStatus, 'PENDING');
  assert.equal((await call(pd1, 'DELETE', `/subscriptions/${sub.id}?version=${edited.json.data.version}`)).status, 200);

  const active = custom.json.data;
  db.prepare("UPDATE iam_users SET mobile = '+919999999990' WHERE id = ?").run(userId);
  db.prepare(`UPDATE ntf_preferences SET channels_json = '{"EMAIL":true,"WHATSAPP":true}'
    WHERE company_id = 1 AND user_ref = 'ppd1' AND category = 'system'`).run();
  const whatsapp = await call(pd1, 'POST', '/subscriptions', { ...input, name: 'WhatsApp project report', channel: 'WHATSAPP' });
  assert.equal(whatsapp.status, 201, JSON.stringify(whatsapp.json));
  db.prepare("UPDATE rpt_subscriptions SET next_run_at = '2002-01-01T02:30:00.000Z' WHERE id = ?").run(whatsapp.json.data.id);
  rt.jobs.enqueue('bi.subscriptions');
  await drain();
  rt.jobs.enqueue('bi.subscriptions');
  await drain();
  const delivery = db.prepare(`SELECT d.status, d.address FROM ntf_deliveries d JOIN rpt_runs r ON r.notification_id = d.notification_id
    WHERE d.channel = 'WHATSAPP' AND r.subscription_id = ?`).get(whatsapp.json.data.id);
  assert.equal(delivery.status, 'PENDING');
  assert.equal(delivery.address, '+919999999990');
  db.prepare("UPDATE iam_users SET roles_json = '[]' WHERE id = ?").run(userId);
  authzOf(db).invalidate();
  db.prepare("UPDATE rpt_subscriptions SET next_run_at = '2001-01-01T02:30:00.000Z' WHERE id = ?").run(active.id);
  rt.jobs.enqueue('bi.subscriptions');
  await drain();
  assert.equal(db.prepare('SELECT status FROM rpt_runs WHERE subscription_id = ? ORDER BY id DESC LIMIT 1').get(active.id).status, 'SKIPPED');
  assert.equal(db.prepare('SELECT count(*) AS n FROM rpt_runs').get().n, 4);
  assert.equal((await call(pd2, 'GET', '/usage')).status, 403);
  const auditor = as('AUD', 'audit-reporting');
  const usage = await call(auditor, 'GET', '/usage?days=30');
  assert.equal(usage.status, 200, JSON.stringify(usage.json));
  assert.deepEqual(usage.json.data.exports, [
    { report: 'bi.project_status', format: 'csv', total: 2 },
    { report: 'bi.project_status_builder', format: 'csv', total: 1 },
  ]);
  assert.equal((await call(auditor, 'GET', '/usage?days=365')).status, 400);
  const otherCompany = Number(db.prepare("INSERT INTO org_companies (code, legal_name, short_name) VALUES ('BI-USAGE', 'Separate Company', 'Separate')").run().lastInsertRowid);
  db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    SELECT ?, code, name, status, catalogue_version, passed_at FROM hr_gates WHERE company_id = 1 AND code IN ('G1', 'G2')`).run(otherCompany);
  db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.bi.p2701', ?, 'Company BI flag', 0, 1)`).run(otherCompany);
  const otherUsage = await call({ ...auditor, company: String(otherCompany) }, 'GET', '/usage');
  assert.equal(otherUsage.status, 200, JSON.stringify(otherUsage.json));
  assert.deepEqual(otherUsage.json.data.exports, []);
});

test('T-01 the wizard makes the project, its sites, numbering series, folders and key dates in one transaction, and nothing when a part is refused', async () => {
  const t = await setup();
  const c = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(c.status, 201, JSON.stringify(c.json)); const p = c.json.data;
  assert.deepEqual([p.code, p.status, p.state, p.orgStatus, p.client.name, p.consultant.name, p.funder.name, p.contractValue, p.retentionPct, p.mobAdvancePct, p.dlpMonths], ['NH48-P3', 'DRAFT', 'SETUP', 'DRAFT', 'National Highways Authority', 'Mott Engineers', 'Infra Bank', '972000000.00', '5', '10', 24]);
  const org = t.api.db.prepare("SELECT * FROM org_projects WHERE code = 'NH48-P3'").get();
  assert.deepEqual([org.id, org.client_name, org.start_date, org.end_date, org.pm_user_id != null], [p.projectId, 'National Highways Authority', '2026-12-01', '2028-11-30', true], 'the organisation master follows');
  assert.deepEqual(p.sites.map((s) => [s.code, s.status, s.geofence, s.radiusM]), [['NH48-S1', 'DRAFT', 'CIRCLE', 400], ['NH48-S2', 'DRAFT', 'CIRCLE', 250]]);
  assert.equal(count(t.api.db, "SELECT COUNT(*) AS n FROM core_number_series WHERE project_id = ?", org.id), 1, 'the numbering series from the template');
  assert.equal(p.setup.series.length, 1); assert.ok(p.setup.folders >= 5, 'the folders of the template');
  assert.equal(count(t.api.db, 'SELECT COUNT(*) AS n FROM doc_folders WHERE project_id = ? AND is_active = 1', org.id), p.setup.folders);
  assert.deepEqual(p.milestones.map((m) => [m.code, m.contractual, m.paymentLinked, m.status]), [['M1', true, true, 'PLANNED'], ['M2', false, false, 'PLANNED']]);
  assert.deepEqual(p.log.map((l) => [l.kind, l.to, l.status]), [['TRANSITION', 'SETUP', 'EFFECTIVE']]);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.project.created'").get());
  // nothing is made when a part is refused: a vendor as client, a blacklisted client, a duplicate code, a site that cannot be made (a circle with no radius), a folder template that does not exist, a milestone twice
  const snapshot = () => [count(t.api.db, 'SELECT COUNT(*) AS n FROM org_projects'), count(t.api.db, 'SELECT COUNT(*) AS n FROM org_sites'), count(t.api.db, 'SELECT COUNT(*) AS n FROM core_number_series'), count(t.api.db, 'SELECT COUNT(*) AS n FROM doc_folders'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_projects'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_milestones')];
  const before = snapshot();
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X1' }, contract: { clientPartnerId: t.ids.vendor } }))).status, 400, 'a vendor is not a client');
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X2' }, contract: { clientPartnerId: t.ids.blocked } }))).status, 400);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X3' }, contract: { scheduledCompletion: '2026-01-01' } }))).status, 400, 'completion before the start');
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X4' }, setup: { folderTemplate: 'NOPE' } }))).status, 400);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X5' }, team: { pmUser: 'nobody' } }))).status, 400);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X6' }, milestones: [{ code: 'A', name: 'a', plannedDate: '2027-01-01' }, { code: 'a', name: 'b', plannedDate: '2027-02-01' }] }))).status, 400);
  const dup = await t.call(pcm, 'POST', '/projects', t.wizard()); assert.ok([400, 409, 422].includes(dup.status), `a duplicate code: ${dup.status}`);
  const badSite = await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X7' }, sites: [{ code: 'OK1', name: 'Fine', siteType: 'SITE' }, { code: 'BAD', name: 'No radius', siteType: 'SITE', latitude: 18.5, longitude: 73.8, geofenceType: 'CIRCLE' }] }));
  assert.ok(badSite.status >= 400 && badSite.status < 500, `a site that cannot be made refuses the whole wizard: ${badSite.status} ${JSON.stringify(badSite.json).slice(0, 200)}`);
  assert.deepEqual(snapshot(), before, 'nothing of the refused wizards is left');
  // a choice of numbering templates and no folders
  const light = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'LIGHT1' }, setup: { numbering: [], folderTemplate: null } }))).json.data;
  assert.deepEqual([light.setup.series.length, light.setup.folders], [0, 0]);
  assert.equal((await t.call(se, 'POST', '/projects', t.wizard({ basics: { code: 'X8' } }))).status, 403); assert.equal((await t.call(pm1, 'POST', '/projects', t.wizard({ basics: { code: 'X9' } }))).status, 403, 'a project manager does not set projects up');
  // the options of the wizard
  const o = (await t.call(pcm, 'GET', '/project-options')).json.data;
  assert.deepEqual([o.numbering.map((x) => x.code), o.folderTemplates.some((x) => x.code === 'PROJECT_STANDARD'), o.checklists.ACTIVATE.length], [['DMS'], true, 4]);
});

test('AC-01 the activation by the project director and the director; the lifecycle with checklists, the chain for a suspension and a closure; transition rules', async () => {
  const t = await setup();
  const p = (await t.call(pcm, 'POST', '/projects', t.wizard())).json.data;
  // the plain activation of the organisation master is not a way round
  const plain = await t.api.call('POST', `/api/v1/iam/org/projects/${p.projectId}/activation-requests`, { ...pcm, headers: key(), body: { reason: 'activate it please' } });
  assert.equal(plain.status, 422); assert.match(JSON.stringify(plain.json), /project master/);
  // the checklist and the blockers
  assert.equal((await t.call(pcm, 'POST', `/projects/${p.id}/submit`, { ticked: [0, 1] })).status, 422, 'every item is ticked');
  const bare = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'BARE1' }, sites: [], team: { pmUser: null, directorUser: null }, contract: { startDate: null, scheduledCompletion: null } }))).json.data;
  const blocked = await t.call(pcm, 'POST', `/projects/${bare.id}/submit`, { ticked: ALL }); assert.equal(blocked.status, 422);
  assert.match(JSON.stringify(blocked.json), /At least one site/); assert.match(JSON.stringify(blocked.json), /project manager and the project director/); assert.match(JSON.stringify(blocked.json), /start date/);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'AUTO1' }, top: { submit: true, ticked: [0] } }))).status, 422, 'a wizard that also submits needs the checklist');
  assert.equal(count(t.api.db, "SELECT COUNT(*) AS n FROM org_projects WHERE code = 'AUTO1'"), 0, 'and makes nothing when it does not');
  const s = await t.call(pcm, 'POST', `/projects/${p.id}/submit`, { ticked: ALL }); assert.equal(s.status, 202);
  const inst = s.json.data.workflowInstanceId;
  assert.deepEqual([(await t.tasks(pcm)).some((x) => x.instance.id === inst), (await t.tasks(dir)).some((x) => x.instance.id === inst)], [false, false], 'the maker is no approver and the director waits for the project director');
  assert.equal((await t.call(pcm, 'PATCH', `/projects/${p.id}`, { location: 'Mumbai', version: s.json.data.rowVersion })).status, 409, 'locked while with the approvers');
  await t.act(pd1, inst, 'return');
  const back = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.equal(back.status, 'RETURNED');
  const fix = await t.call(pcm, 'PATCH', `/projects/${p.id}`, { contractNo: 'NHAI/2027/118-R', version: back.rowVersion }); assert.equal(fix.status, 200, JSON.stringify(fix.json));
  assert.equal((await t.call(pcm, 'POST', `/projects/${p.id}/submit`, { ticked: ALL })).status, 202);
  await t.act(pd1, inst); await t.act(dir, inst);
  const a = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data;
  assert.deepEqual([a.status, a.state, a.orgStatus, a.sites.map((x) => x.status), a.activatedAt != null], ['APPROVED', 'MOBILISATION', 'ACTIVE', ['ACTIVE', 'ACTIVE'], true], 'the organisation project and its sites follow');
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'proj.project.activated'").all().map((r) => JSON.parse(r.payload).data ?? JSON.parse(r.payload));
  assert.equal(ev.length, 1); assert.deepEqual([ev[0].code, ev[0].sites, ev[0].setup.series.length], ['NH48-P3', ['NH48-S1', 'NH48-S2'], 1]);
  // T-01 the transition rules: only the allowed moves, the checklist, the readiness; the PM moves it to execution (warnings: budget and baseline are not live yet)
  const opts = a.transitions; assert.deepEqual(opts.map((x) => [x.to, x.approval]), [['EXECUTION', false]]);
  assert.deepEqual(opts[0].readiness.filter((r) => !r.blocking).map((r) => r.code), ['BUDGET', 'BASELINE']);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'DLP', ticked: ALL })).status, 422, 'not an allowed move');
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: [0, 1] })).status, 422, 'the checklist');
  assert.equal((await t.call(qs, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: ALL })).status, 403);
  const ex = await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: ALL, reason: 'Site established' }); assert.equal(ex.status, 202, JSON.stringify(ex.json));
  assert.deepEqual([ex.json.data.state, ex.json.data.log[0].status, ex.json.data.log[0].warnings.length, ex.json.data.log[0].checklist.every((x) => x.ticked)], ['EXECUTION', 'EFFECTIVE', 2, true], 'warnings are kept with the move');
  // a suspension goes through the chain: the project manager (not the requester: another PM), the project director, the director
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUSPENDED', ticked: ALL })).status, 422, 'a reason for a move that needs approval');
  const su = await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUSPENDED', ticked: ALL, reason: 'Client has not handed over the land at Km 20' }); assert.equal(su.status, 202, JSON.stringify(su.json));
  const open = su.json.data.openRequest; assert.deepEqual([su.json.data.state, open.status, open.to], ['EXECUTION', 'REQUESTED', 'SUSPENDED']);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUSPENDED', ticked: ALL, reason: 'a second request at once' })).status, 409);
  assert.ok(!(await t.tasks(pm1)).some((x) => x.instance.id === open.workflowInstanceId), 'the requester is not the project manager step');
  await t.act(pm2, open.workflowInstanceId); await t.act(pd1, open.workflowInstanceId); await t.act(dir, open.workflowInstanceId);
  const sus = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.deepEqual([sus.state, sus.orgStatus, sus.openRequest], ['SUSPENDED', 'ON_HOLD', null]);
  // resume, complete, defect liability, closure by the chain, archive
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: [0, 1, 2] })).status, 202);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUBSTANTIALLY_COMPLETE', ticked: [0, 1, 2] })).json.data.state, 'SUBSTANTIALLY_COMPLETE');
  assert.equal((await t.call(pd1, 'POST', `/projects/${p.id}/transitions`, { to: 'DLP', ticked: [0, 1, 2] })).json.data.state, 'DLP');
  const cl = await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'CLOSED', ticked: ALL, reason: 'Defect liability period over, final account settled' }); assert.equal(cl.status, 202, JSON.stringify(cl.json));
  const wi = cl.json.data.openRequest.workflowInstanceId;
  const rj = await t.act(pm2, wi, 'return'); void rj;
  const ret = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.deepEqual([ret.state, ret.log[0].status], ['DLP', 'RETURNED'], 'a returned request ends; a new one is raised');
  const cl2 = (await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'CLOSED', ticked: ALL, reason: 'Corrected: the final account is attached' })).json.data.openRequest.workflowInstanceId;
  await t.act(pm2, cl2); await t.act(pd2, cl2); await t.act(dir2, cl2);
  const closed = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.deepEqual([closed.state, closed.orgStatus, closed.can.editLive], ['CLOSED', 'CLOSED', false]);
  assert.equal((await t.call(pcm, 'PATCH', `/projects/${p.id}`, { location: 'Delhi', version: closed.rowVersion })).status, 409, 'a closed project is not changed');
  assert.equal((await t.call(dir, 'POST', `/projects/${p.id}/transitions`, { to: 'ARCHIVED', ticked: [0, 1] })).json.data.state, 'ARCHIVED');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'proj.project.state_changed'").get().n >= 7);
  const h = (await t.call(pcm, 'GET', `/projects/${p.id}/history`)).json.data; assert.ok(h.approvals.length > 6 && h.audit.length > 6);
});

test('BR-02 the contract terms of a live project change only by an approved amendment; milestones and health; roles, isolation, another company, the flag', async () => {
  const t = await setup();
  const p0 = (await t.call(pcm, 'POST', '/projects', t.wizard())).json.data; const p = await activate(t, pcm, p0.id);
  // a draft is edited freely; a live project keeps its contract terms
  assert.equal((await t.call(pm1, 'PATCH', `/projects/${p.id}`, { contractValue: '999000000', version: p.rowVersion })).status, 422, 'controlled');
  assert.match(JSON.stringify((await t.call(pm1, 'PATCH', `/projects/${p.id}`, { startDate: '2026-12-15', version: p.rowVersion })).json), /Amend/);
  const live = (await t.call(pm1, 'PATCH', `/projects/${p.id}`, { location: 'Pune and Satara', ldSummary: 'As per clause 47', settings: { workingDays: [1, 2, 3, 4, 5], calendar: 'FIVE_DAY' }, version: p.rowVersion })); assert.equal(live.status, 200, JSON.stringify(live.json));
  assert.deepEqual([live.json.data.location, live.json.data.settings.workingDays, live.json.data.settings.units], ['Pune and Satara', [1, 2, 3, 4, 5], 'METRIC']);
  assert.equal((await t.call(qs, 'POST', `/projects/${p.id}/amend`, { reason: 'not mine to ask', changes: { contractValue: '1' } })).status, 403);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'empty', changes: {} })).status, 400);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'dates', changes: { scheduledCompletion: '2026-01-01' } })).status, 400, 'before the start');
  const am = await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'Variation order 3 adds a service road and 4 months', changes: { contractValue: '1020000000', scheduledCompletion: '2029-03-31', revisedCompletion: '2029-03-31' } });
  assert.equal(am.status, 202, JSON.stringify(am.json)); const ai = am.json.data.openRequest.workflowInstanceId;
  assert.equal(am.json.data.openRequest.kind, 'AMENDMENT'); assert.equal(am.json.data.contractValue, '972000000.00', 'not changed until approved');
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'a second at once', changes: { dlpMonths: 12 } })).status, 409);
  await t.act(pd1, ai); await t.act(dir, ai);
  const done = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data;
  assert.deepEqual([done.contractValue, done.scheduledCompletion, done.revisedCompletion, done.pending, done.log[0].status, done.log[0].changes.before.contractValue], ['1020000000.00', '2029-03-31', '2029-03-31', null, 'EFFECTIVE', '972000000.00']);
  const orgNow = t.api.db.prepare('SELECT end_date FROM org_projects WHERE id = ?').get(done.projectId); assert.equal(orgNow.end_date, '2029-03-31', 'the organisation master follows');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.project.amended'").get());
  // FR-04 milestones: kept by the project manager; a contractual date of a live project is not moved by hand
  const m = (await t.call(pm1, 'POST', `/projects/${p.id}/milestones`, { code: 'M3', name: 'Bridge at Km 8 open', plannedDate: '2020-01-31', contractual: true, paymentLinked: true })).json.data;
  assert.equal(m.length, 3); assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/milestones`, { code: 'm3', name: 'dup', plannedDate: '2027-01-01' })).status, 409);
  const m3 = m.find((x) => x.code === 'M3'); assert.deepEqual([m3.overdue, m3.daysLate > 1000], [true, true]);
  assert.equal((await t.call(pm1, 'PATCH', `/milestones/${m3.id}`, { plannedDate: '2027-03-01', version: m3.rowVersion })).status, 422, 'contractual');
  const ach = (await t.call(pm1, 'PATCH', `/milestones/${m3.id}`, { status: 'ACHIEVED', actualDate: '2026-11-01', version: m3.rowVersion })).json.data.find((x) => x.code === 'M3');
  assert.deepEqual([ach.status, ach.actualDate, ach.overdue], ['ACHIEVED', '2026-11-01', false]); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.milestone.achieved'").get());
  assert.equal((await t.call(pm1, 'PATCH', `/milestones/${m3.id}`, { status: 'ACHIEVED', actualDate: '2999-01-01', version: ach.rowVersion })).status, 400);
  assert.equal((await t.call(pm1, 'DELETE', `/milestones/${m3.id}`)).status, 422, 'an achieved milestone stays');
  assert.equal((await t.call(qs, 'POST', `/projects/${p.id}/milestones`, { code: 'M9', name: 'no', plannedDate: '2027-01-01' })).status, 403);
  // FR-06 the portfolio: state, value, health (the schedule from the milestones) and the time elapsed
  const exec = (await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: ALL })).json.data; assert.equal(exec.state, 'EXECUTION');
  const list = (await t.call(dir, 'GET', '/projects')).json.data; const row = list.find((x) => x.code === 'NH48-P3');
  assert.deepEqual([row.state, row.contractValue, row.client, row.status], ['EXECUTION', '1020000000.00', 'National Highways Authority', 'APPROVED']); assert.ok(['GREEN', 'AMBER', 'RED'].includes(row.health));
  assert.equal(row.health, 'GREEN', 'the open milestones are in the future');
  const late = (await t.call(pm1, 'POST', `/projects/${p.id}/milestones`, { code: 'M4', name: 'Late one', plannedDate: '2026-01-15' })).status; assert.equal(late, 201);
  assert.equal((await t.call(dir, 'GET', `/projects/${p.id}`)).json.data.health, 'RED', 'a milestone more than 30 days overdue');
  // roles: DIR approves but does not set up; QS and SE see nothing; the print and the export
  assert.equal((await t.call(dir, 'POST', '/projects', t.wizard({ basics: { code: 'Z1' } }))).status, 403);
  assert.equal((await t.call(qs, 'GET', '/projects')).status, 403); assert.equal((await t.call(se, 'GET', `/projects/${p.id}`)).status, 403);
  assert.equal((await t.api.call('GET', `${P}/projects/${p.id}/print`, pcm)).status, 200);
  assert.equal((await t.api.call('GET', `${P}/projects/export?format=csv`, dir)).status, 200); assert.equal((await t.api.call('GET', `${P}/projects/export?format=csv`, pm1)).status, 403);
  // isolation: a project manager assigned to another project only; another company; the flag
  const other = Number(t.api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'OTHER1', 'Other', 'BUILDING')").run().lastInsertRowid);
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'ppm3', 'ppm3', '[]', 'ppm3@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([other]));
  const s = projectsOf(t.api.db); const pm3 = { user: 'ppm3', userId: uid, companyId: 1, roles: [] };
  assert.ok(!s.projects.list(pm3, {}).data.some((r) => r.id === p.id)); assert.throws(() => s.projects.get(pm3, p.id), /does not exist/); assert.throws(() => s.transitions.move(pm3, p.id, { to: 'SUSPENDED', ticked: ALL, reason: 'not their project at all' }), /does not exist/);
  assert.equal((await t.call(as('PCMGR', 'ppcm1', '2'), 'GET', `/projects/${p.id}`)).status, 404, 'another company');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1001'").run();
  assert.equal((await t.call(pcm, 'GET', '/projects')).status, 404, 'flag off');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1001'").run();
  // a draft that was never sent is deleted; a sent one is cancelled
  const d = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'DEL1' } }))).json.data;
  assert.equal((await t.call(pcm, 'DELETE', `/projects/${d.id}`)).status, 200); assert.equal((await t.call(pcm, 'GET', `/projects/${d.id}`)).status, 404);
  const c = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'CAN1' } }))).json.data; await t.call(pcm, 'POST', `/projects/${c.id}/submit`, { ticked: ALL });
  assert.equal((await t.call(pcm, 'POST', `/projects/${c.id}/cancel`, { reason: 'the client withdrew the order' })).json.data.status, 'CANCELLED');
  assert.equal((await t.call(pcm, 'POST', `/projects/${p.id}/cancel`, { reason: 'a live project is not cancelled' })).status, 422);
});
