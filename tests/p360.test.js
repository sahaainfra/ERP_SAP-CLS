import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { project360Providers, registerProject360Widget } from '../src/server/modules/proj/p360.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.08: Project 360 and the portfolio overview. T-01 each live widget shows the figures of the module that owns them (counted again from the source), and no slot shows sample data: a slot whose module is not live says which part will supply it.
// Also: a live widget of a module the person has no right to is not shown (BR-02), the health follows the company's thresholds (BR-01), the period selector, the export, the portfolio and its scope, roles, another company, the flag.
const P = '/api/v1/proj';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `p3-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pm1 = as('PM', 'p3pm1'); const se1 = as('SE', 'p3se1'); const qs1 = as('QS', 'p3qs1'); const dir = as('DIR', 'p3dir1'); const bd = as('BD', 'p3bd1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['p3pm1', ['PM']], ['p3se1', ['SE']], ['p3qs1', ['QS']], ['p3dir1', ['DIR']], ['p3bd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name, extra = {}) => {
    const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'ROAD').lastInsertRowid);
    api.db.prepare("INSERT INTO proj_projects (company_id, project_id, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, ?, 'p3pm1', ?, ?, ?, 'test')").run(id, extra.state ?? 'EXECUTION', extra.value ?? 2_500_000_000, plus(-200), plus(300));
    return id;
  };
  const a = mk('P3A', 'Ring road package 1'); const b = mk('P3B', 'Flyover', { state: 'MOBILISATION' });
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  return { api, call, a, b };
}
const slot = (d, code) => d.tabs.flatMap((t) => t.widgets).find((w) => w.code === code);
const figure = (w, k) => w.figures.find((f) => f.key === k)?.value;

test('T-01 every live widget equals its source; no slot shows sample data; BR-02 a live widget of a module the person has no right to is not shown', async () => {
  const t = await setup();
  const ms = t.api.db.prepare("INSERT INTO proj_milestones (company_id, project_id, code, name, planned_date, milestone_status, created_by) VALUES (1, ?, ?, ?, ?, ?, 'test')");
  ms.run(t.a, 'M1', 'Mobilisation complete', plus(-20), 'PLANNED'); ms.run(t.a, 'M2', 'Earthwork complete', plus(60), 'PLANNED'); t.api.db.prepare("INSERT INTO proj_milestones (company_id, project_id, code, name, planned_date, actual_date, milestone_status, created_by) VALUES (1, ?, 'M3', 'Site handed over', ?, ?, 'ACHIEVED', 'test')").run(t.a, plus(-100), plus(-100));
  const risk = (over) => ({ projectId: t.a, rtype: 'RISK', title: 'Monsoon delays concreting', category: 'TECHNICAL', ownerUser: 'p3se1', probability: 4, impactCost: 5, impactTime: 3, strategy: 'MITIGATE', exposureCost: { min: '2000000', mostLikely: '5000000', max: '9000000' }, actions: [{ description: 'Order rain covers', ownerUser: 'p3se1', dueDate: plus(10) }], ...over });
  assert.equal((await t.call(pm1, 'POST', '/risks', risk())).status, 201);
  assert.equal((await t.call(pm1, 'POST', '/risks', risk({ title: 'Cement price', probability: 2, impactCost: 2, impactTime: 3, strategy: 'ACCEPT', actions: [], exposureCost: { min: '500000', mostLikely: '1000000', max: '1500000' } }))).status, 201);
  assert.equal((await t.call(pm1, 'POST', '/issues', { projectId: t.a, title: 'Crane breakdown', priority: 'HIGH', ownerUser: 'p3se1', dueDate: plus(-2) })).status, 201);
  t.api.db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, chainage_from, chainage_to, lat, lng, created_by) VALUES (1, ?, 'CHAINAGE', 'CH0', 'Chainage 0', 0, 1000, 18.52, 73.85, 'test')").run(t.a);
  t.api.db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (1, ?, 'BLOCK', 'BLK', 'A block', 'test')").run(t.a);
  const d = (await t.call(pm1, 'GET', `/project-360?projectId=${t.a}`)).json.data;
  // the header
  assert.deepEqual([d.code, d.lifecycleState, d.lifecycleLabel, d.pm, d.contractValue, d.valueHidden, d.health], ['P3A', 'EXECUTION', 'Execution', 'p3pm1', '25000000.00', false, 'RED']);
  assert.deepEqual(d.tabs.map((x) => x.key), ['overview', 'time', 'cost', 'resources', 'quality_hse', 'commercial', 'documents', 'activity']);
  // T-01: each live figure equals the source, counted again
  const m = slot(d, 'milestones'); assert.equal(m.status, 'LIVE');
  assert.deepEqual([figure(m, 'total'), figure(m, 'achieved'), figure(m, 'overdue')], [3, 1, t.api.db.prepare("SELECT COUNT(*) AS n FROM proj_milestones WHERE project_id = ? AND milestone_status = 'PLANNED' AND planned_date < ?").get(t.a, today()).n]);
  const rk = slot(d, 'risks'); const reg = (await t.call(pm1, 'GET', `/risks?filter[projectId]=${t.a}&filter[status]=OPEN&filter[type]=RISK`)).json; const dash = (await t.call(pm1, 'GET', `/risk-dashboard?projectId=${t.a}`)).json.data;
  assert.deepEqual([figure(rk, 'open'), figure(rk, 'critical'), figure(rk, 'emv')], [reg.meta.total, 1, dash.riskEmv]); assert.equal(figure(rk, 'emv'), '3800000.00');
  const is = slot(d, 'issues'); const iss = (await t.call(pm1, 'GET', `/issues?filter[projectId]=${t.a}&filter[status]=OPEN`)).json; assert.deepEqual([figure(is, 'open'), figure(is, 'overdue')], [iss.meta.total, 1]);
  const mp = slot(d, 'map'); assert.deepEqual([figure(mp, 'located'), figure(mp, 'locations')], [1, 2]); assert.equal(figure(mp, 'progress'), null, 'no progress has been recorded: no number'); assert.ok(mp.note);
  assert.deepEqual([figure(slot(d, 'team'), 'members'), figure(slot(d, 'actions'), 'open'), figure(slot(d, 'wbs'), 'nodes'), figure(slot(d, 'boq'), 'versions')], [0, 0, 0, 0]);
  // FR-06: the slots of modules that are not live name the part, show no figure
  for (const [code, part] of [['progress', '14.05'], ['schedule', '13.x'], ['budget', '12.x and 14.07'], ['hse', '19.x'], ['billing', '22.x and 23.x'], ['documents', '11.x']]) {
    const w = slot(d, code); assert.deepEqual([w.status, w.figures.length, w.ownerPart], ['NOT_LIVE', 0, part], code); assert.ok(w.emptyText.includes(part.split(' ')[0]) || w.emptyText.includes('not live'), `${code}: ${w.emptyText}`);
  }
  { const w = slot(d, 'quality'); assert.equal(w.status, 'LIVE', 'part 18.07 supplies the quality slot'); assert.deepEqual(w.figures.map((f) => f.key), ['firstTimeIr', 'openNcr', 'cubeFail', 'snagClosure']); }
  { const w = slot(d, 'plant'); assert.equal(w.status, 'LIVE', 'part 17.01 supplies the plant slot'); assert.ok(w.figures.length === 0 || w.figures.every((f) => f.value === 0), 'no equipment in this project'); }
  { const w = slot(d, 'stores'); assert.equal(w.status, 'LIVE', 'part 16.11 supplies the stores slot'); assert.deepEqual(w.figures.map((f) => f.key), ['value', 'reorder', 'inspection', 'mrs', 'transit']); assert.ok(w.figures.every((f) => f.value === 0), 'no stock in this project'); }
  { const w = slot(d, 'procurement'); assert.equal(w.status, 'LIVE', 'part 15.10 supplies the procurement slot'); assert.deepEqual(w.figures.map((f) => f.key), ['openPrs', 'posPending', 'overdue', 'spendFy']); assert.ok(w.figures.every((f) => f.value === 0), 'no procurement data in this project'); }
  assert.deepEqual(d.healthItems.filter((h) => h.level === 'NONE').map((h) => h.code), ['COST', 'QUALITY', 'SAFETY', 'CASH'], 'no data is not green');
  // BR-02: a quantity surveyor holds no right to risks or issues: those widgets are not there, the empty slots still are
  const q = (await t.call(qs1, 'GET', `/project-360?projectId=${t.a}`)).json.data;
  assert.equal(slot(q, 'risks'), undefined); assert.equal(slot(q, 'issues'), undefined); assert.equal(slot(q, 'schedule').status, 'NOT_LIVE'); assert.equal(slot(q, 'boq').status, 'LIVE'); assert.equal(q.valueHidden, false);
  const s = (await t.call(se1, 'GET', `/project-360?projectId=${t.a}`)).json.data; assert.equal(slot(s, 'risks').status, 'LIVE'); assert.equal(slot(s, 'boq'), undefined, 'rates and amounts are for those who hold the right'); assert.deepEqual([s.contractValue, s.valueHidden], [null, true]);
  // a module that goes live fills its slot without touching the page
  assert.ok(!project360Providers.has('progress')); registerProject360Widget('progress', () => ({ figures: [{ key: 'pct', label: 'Physical progress (%)', value: 42.5 }] }));
  try { assert.deepEqual([slot((await t.call(pm1, 'GET', `/project-360?projectId=${t.a}`)).json.data, 'progress').status, figure(slot((await t.call(pm1, 'GET', `/project-360?projectId=${t.a}`)).json.data, 'progress'), 'pct')], ['LIVE', 42.5]); } finally { project360Providers.delete('progress'); }
  // access
  assert.equal((await t.call(bd, 'GET', `/project-360?projectId=${t.a}`)).status, 403); assert.equal((await t.call(pm1, 'GET', '/project-360?projectId=99999')).status, 404); assert.equal((await t.call(pm1, 'GET', '/project-360')).status, 400);
  assert.equal((await t.api.call('GET', `${P}/project-360?projectId=${t.a}`, as('PM', 'p3pm9', '2'))).status, 404, 'another company');
});

test('BR-01 the health follows the company thresholds; the period selector; the snapshot export; FR-05 the portfolio and its scope; the flag', async () => {
  const t = await setup();
  t.api.db.prepare("INSERT INTO proj_milestones (company_id, project_id, code, name, planned_date, milestone_status, created_by) VALUES (1, ?, 'M1', 'Mobilisation complete', ?, 'PLANNED', 'test')").run(t.a, plus(-20));
  t.api.db.prepare("INSERT INTO proj_milestones (company_id, project_id, code, name, planned_date, milestone_status, created_by) VALUES (1, ?, 'M2', 'Earthwork complete', ?, 'PLANNED', 'test')").run(t.b, plus(40));
  const time = async (id) => (await t.call(pm1, 'GET', `/project-360?projectId=${id}`)).json.data.healthItems.find((h) => h.code === 'TIME').level;
  assert.equal(await time(t.a), 'RED', '20 days late against the default of 14'); assert.equal(await time(t.b), 'GREEN');
  const sys = as('SYSADM', 'p3sys1'); t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'p3sys1', 'p3sys1', '[\"SYSADM\"]', 'p3sys1@example.com')").run();
  const set = await t.api.call('POST', '/api/v1/core/parameters', { ...sys, headers: key(), body: { key: 'proj.rag_thresholds', value: { milestoneLateDaysAmber: 1, milestoneLateDaysRed: 30, riskCriticalRed: 1, riskHighAmber: 1, spiAmber: 0.95, spiRed: 0.9, cpiAmber: 0.95, cpiRed: 0.9 }, scopeType: 'company', scopeId: 1, effectiveFrom: today(), reason: 'a looser limit for this company' } });
  assert.ok(set.status < 300, JSON.stringify(set.json));
  assert.equal(await time(t.a), 'AMBER', 'the company limit is 30 days: 20 days late is amber'); assert.equal((await t.call(pm1, 'GET', `/project-360?projectId=${t.a}`)).json.data.thresholds.milestoneLateDaysRed, 30);
  // the period selector
  const nov = (await t.call(pm1, 'GET', `/project-360?projectId=${t.b}&period=${plus(40).slice(0, 7)}`)).json.data; assert.deepEqual([nov.period.period, nov.period.from.slice(8), figure(slot(nov, 'milestones'), 'due')], [plus(40).slice(0, 7), '01', 1]);
  const other = (await t.call(pm1, 'GET', `/project-360?projectId=${t.b}&period=2020-01`)).json.data; assert.equal(figure(slot(other, 'milestones'), 'due'), 0); assert.equal((await t.call(pm1, 'GET', `/project-360?projectId=${t.b}&period=2020-13x`)).status, 400);
  // the snapshot
  for (const f of ['pdf', 'xlsx', 'csv']) { const r = await t.api.raw('GET', `${P}/project-360/export?projectId=${t.a}&format=${f}`, { user: 'p3pm1', roles: 'PM' }); assert.equal(r.status, 200, f); assert.ok(r.buffer.length > 200); }
  assert.ok((await t.api.raw('GET', `${P}/project-360/export?projectId=${t.a}&format=csv`, { user: 'p3pm1', roles: 'PM' })).buffer.toString().includes('Not live'), 'the snapshot states what is not live');
  assert.equal((await t.api.raw('GET', `${P}/project-360/export?projectId=${t.a}&format=pdf`, { user: 'p3se1', roles: 'SE' })).status, 403);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'proj_projects' AND action = 'export'").get(), 'the export is audited');
  // the portfolio
  const pf = (await t.call(dir, 'GET', '/portfolio-overview')).json.data; assert.deepEqual(pf.projects.map((p) => p.code).sort(), ['P3A', 'P3B']); assert.equal(pf.summary.total, 2); assert.equal(pf.projects[0].code, 'P3A', 'the worst health first');
  assert.deepEqual([pf.projects.find((p) => p.code === 'P3A').overdueMilestones, pf.projects.find((p) => p.code === 'P3B').overdueMilestones], [1, 0]);
  assert.deepEqual((await t.call(dir, 'GET', '/portfolio-overview?health=GREEN')).json.data.projects.map((p) => p.code), ['P3B']); assert.deepEqual((await t.call(dir, 'GET', '/portfolio-overview?q=flyover')).json.data.projects.map((p) => p.code), ['P3B']);
  assert.equal((await t.call(bd, 'GET', '/portfolio-overview')).status, 403); assert.deepEqual((await t.api.call('GET', `${P}/portfolio-overview`, as('PM', 'p3pm9', '2'))).json.data.projects, [], 'another company sees nothing');
  assert.equal(pf.projects.find((p) => p.code === 'P3A').criticalRisks, 0);
  assert.equal((await t.call(qs1, 'GET', '/portfolio-overview')).json.data.projects[0].criticalRisks, null, 'a person without the right to risks sees no risk figure');
  // the dashboard framework (03.07): the three KPI widgets of this part
  const kpi = await t.api.call('GET', '/api/v1/ui/widgets/proj.milestones.late/data', { ...pm1 }); assert.equal(kpi.status, 200, JSON.stringify(kpi.json)); assert.equal(kpi.json.data.data.value, 1); assert.equal(kpi.json.data.data.status, 'amber');
  // the flag
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1008'").run(); assert.equal((await t.call(pm1, 'GET', `/project-360?projectId=${t.a}`)).status, 404, 'flag off'); assert.equal((await t.call(pm1, 'GET', '/projects')).status, 200);
});
