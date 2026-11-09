import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { riskExposureOf } from '../src/server/modules/proj/risks.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.06: the register of risks, opportunities and issues of a project. T-01 the heat map and the EMV totals are right and a trigger that passes its threshold raises an alert. Also: the assessment is worked out on the server (score, level, EMV with
// the thresholds of the project, BR-01), closing a high or critical risk needs the owner's justification and the approval of the project manager (BR-02), the response actions are tasks, contingency is allocated out of the pool and drawn down by a request,
// the monthly review is approved by the project manager and then the project director and keeps its snapshot, the issue log, roles, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `rk-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pm1 = as('PM', 'rpm1'); const pm2 = as('PM', 'rpm2'); const pd1 = as('PD', 'rpd1'); const plan1 = as('PLAN', 'rplan1'); const se1 = as('SE', 'rse1'); const se2 = as('SE', 'rse2'); const pcm = as('PCMGR', 'rpcm1'); const dir = as('DIR', 'rdir1'); const bd = as('BD', 'rbd1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['rpm1', ['PM']], ['rpm2', ['PM']], ['rpd1', ['PD']], ['rplan1', ['PLAN']], ['rse1', ['SE']], ['rse2', ['SE']], ['rpcm1', ['PCMGR']], ['rdir1', ['DIR']], ['rbd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'BUILDING').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (1, ?, 'test')").run(id); return id; };
  const a = mk('RKA', 'Alpha towers');
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  return { api, call, act, hasTask, a };
}
const risk = (t, over = {}) => ({ projectId: t.a, rtype: 'RISK', title: 'Monsoon delays the foundation concreting', cause: 'Heavy rainfall in July', effect: 'Concreting stops for weeks', category: 'TECHNICAL', ownerUser: 'rse1', probability: 4, impactCost: 5, impactTime: 3,
  strategy: 'MITIGATE', exposureCost: { min: '2000000', mostLikely: '5000000', max: '9000000' }, exposureDays: { min: 5, mostLikely: 20, max: 40 }, actions: [{ description: 'Order rain covers and a dewatering pump', ownerUser: 'rplan1', dueDate: plus(10) }], ...over });

test('T-01 the heat map and the EMV totals are right; a trigger that passes its threshold raises an alert; BR-01 the thresholds are the project\'s', async () => {
  const t = await setup();
  assert.equal((await t.call(se1, 'PUT', '/risk-settings', { projectId: t.a, contingencyPool: '10000000' })).status, 403, 'only the project manager sets the pool');
  assert.equal((await t.call(pm1, 'PUT', '/risk-settings', { projectId: t.a, thresholds: { medium: 8, high: 6, critical: 15 } })).status, 400, 'the thresholds rise');
  const st = await t.call(pm1, 'PUT', '/risk-settings', { projectId: t.a, contingencyPool: '10000000' }); assert.equal(st.status, 200, JSON.stringify(st.json)); assert.equal(st.json.data.contingencyPool, '10000000.00'); assert.deepEqual([st.json.data.medium, st.json.data.high, st.json.data.critical], [5, 10, 15]);
  // validation
  assert.equal((await t.call(bd, 'POST', '/risks', risk(t))).status, 403);
  assert.equal((await t.call(se1, 'POST', '/risks', risk(t, { exposureCost: { min: '6000000', mostLikely: '5000000', max: '9000000' } }))).status, 400, 'minimum above most likely');
  assert.equal((await t.call(se1, 'POST', '/risks', risk(t, { ownerUser: 'ghost' }))).status, 400);
  assert.equal((await t.call(se1, 'POST', '/risks', risk(t, { actions: [] }))).status, 400, 'a critical risk needs a response action');
  assert.equal((await t.call(se1, 'POST', '/risks', risk(t, { rtype: 'OPPORTUNITY' }))).status, 400, 'an opportunity is not mitigated');
  assert.equal((await t.call(se1, 'POST', '/risks', risk(t, { probability: 6 }))).status, 400);
  // R1 critical (4 x 5 = 20), R2 medium (2 x 3 = 6), R3 high (3 x 4 = 12), O1 opportunity (5 x 2 = 10)
  const r1 = (await t.call(se1, 'POST', '/risks', risk(t, { triggers: [{ name: 'Rainfall', indicator: 'mm in 24 hours', comparator: 'GTE', threshold: 100, unit: 'mm' }] }))).json.data;
  assert.deepEqual([r1.docNo.startsWith('RSK-'), r1.score, r1.level, r1.probabilityPct, r1.emv, r1.status, r1.actions.length, r1.triggers.length], [true, 20, 'CRITICAL', 70, '3500000.00', 'OPEN', 1, 1]);
  const r2 = (await t.call(se1, 'POST', '/risks', risk(t, { title: 'Cement price rises', category: 'COMMERCIAL', probability: 2, impactCost: 2, impactTime: 3, strategy: 'ACCEPT', actions: [], exposureCost: { min: '500000', mostLikely: '1000000', max: '1500000' } }))).json.data;
  assert.deepEqual([r2.score, r2.level, r2.emv], [6, 'MEDIUM', '300000.00']);
  const r3 = (await t.call(se1, 'POST', '/risks', risk(t, { title: 'Scaffold collapse', category: 'SAFETY', ownerUser: 'rse2', probability: 3, impactCost: 1, impactSafety: 4, exposureCost: { min: '500000', mostLikely: '2000000', max: '3000000' }, residualProbability: 1, residualImpact: 4 }))).json.data;
  assert.deepEqual([r3.score, r3.level, r3.emv, r3.residualScore, r3.residualLevel], [12, 'HIGH', '1000000.00', 4, 'LOW']);
  const o1 = await t.call(se1, 'POST', '/risks', risk(t, { rtype: 'OPPORTUNITY', title: 'Early handover of the podium', category: 'COMMERCIAL', probability: 5, impactCost: 2, impactTime: 1, strategy: 'EXPLOIT', actions: [], exposureCost: { min: '200000', mostLikely: '400000', max: '600000' } })); assert.equal(o1.status, 201, JSON.stringify(o1.json)); assert.ok(o1.json.data.docNo.startsWith('OPP-')); assert.equal(o1.json.data.emv, '360000.00');
  // the dashboard: the heat map (probability row x impact column), the totals, the tiles
  const d = (await t.call(plan1, 'GET', `/risk-dashboard?projectId=${t.a}`)).json.data;
  assert.equal(d.heat[3][4], 1, 'R1: probability 4, impact 5'); assert.equal(d.heat[1][2], 1, 'R2: probability 2, impact 3'); assert.equal(d.heat[2][3], 1, 'R3: probability 3, impact 4'); assert.equal(d.heat.flat().reduce((n, x) => n + x, 0), 3, 'opportunities are not on the risk heat map');
  assert.deepEqual([d.riskEmv, d.opportunityEmv, d.exposureCostMl, d.exposureDaysMl], ['4800000.00', '360000.00', '8000000.00', 60]); assert.deepEqual([d.counts.risks, d.counts.opportunities, d.counts.critical, d.counts.high], [3, 1, 1, 1]);
  assert.deepEqual(d.top.map((x) => x.docNo), [r1.docNo, r3.docNo, r2.docNo]); assert.deepEqual(d.byLevel, { LOW: 0, MEDIUM: 1, HIGH: 1, CRITICAL: 1 });
  assert.equal(d.tiles.find((x) => x.key === 'critical').value, 1);
  assert.equal(d.emvVsContingency.covered, false);
  // the EMV is the server's: a posted EMV is refused as an unknown field
  assert.equal((await t.call(se1, 'POST', '/risks', { ...risk(t), emv: '1' })).status, 400);
  // the exposure that 12.02, 23.11 and 21.06 read
  assert.deepEqual([riskExposureOf(t.api.db, t.a).riskEmv, riskExposureOf(t.api.db, t.a).opportunityEmv], [480000000, 36000000]);
  // BR-01: higher thresholds move the level; the register follows
  assert.equal((await t.call(pm1, 'PUT', '/risk-settings', { projectId: t.a, thresholds: { medium: 6, high: 13, critical: 20 } })).status, 200);
  assert.deepEqual([(await t.call(se1, 'GET', `/risks/${r3.id}`)).json.data.level, (await t.call(se1, 'GET', `/risks/${r2.id}`)).json.data.level, (await t.call(se1, 'GET', `/risks/${r1.id}`)).json.data.level], ['MEDIUM', 'MEDIUM', 'CRITICAL']);
  assert.equal((await t.call(pm1, 'PUT', '/risk-settings', { projectId: t.a, thresholds: { medium: 5, high: 10, critical: 15 } })).status, 200);
  // an edit reassesses the item; the history keeps the old score
  const up = await t.call(se1, 'PATCH', `/risks/${r2.id}`, { probability: 4, rowVersion: r2.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.deepEqual([up.json.data.score, up.json.data.level, up.json.data.emv], [12, 'HIGH', '700000.00']);
  assert.equal((await t.call(se1, 'PATCH', `/risks/${r2.id}`, { title: 'Stale', rowVersion: r2.rowVersion })).status, 409);
  assert.equal((await t.call(se1, 'PATCH', `/risks/${r2.id}`, { probability: 2 })).json.data.level, 'MEDIUM');
  const hist = (await t.call(se1, 'GET', `/risks/${r2.id}/history`)).json.data; assert.ok(hist.audit.some((x) => x.action === 'update' && x.from?.score === 6 && x.to?.score === 12));
  // the actions are tasks of their owners
  const tasks = t.api.db.prepare("SELECT t.* FROM tsk_tasks t WHERE t.entity = 'proj_risk' AND t.entity_id = ?").all(String(r1.id)); assert.equal(tasks.length, 1); assert.equal(tasks[0].due_date, plus(10));
  // FR-04: the trigger. A reading below the threshold arms nothing; one above fires and raises the alert.
  const trg = r1.triggers[0];
  const low = await t.call(se1, 'POST', `/risks/${r1.id}/triggers/${trg.id}/reading`, { value: 80 }); assert.equal(low.status, 200, JSON.stringify(low.json)); assert.deepEqual([low.json.data.fired, low.json.data.trigger.status], [false, 'ARMED']);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM alr_alerts WHERE rule_code = 'risk.trigger_fired'").get().n, 0, 'no alert below the threshold');
  assert.equal((await t.call(bd, 'POST', `/risks/${r1.id}/triggers/${trg.id}/reading`, { value: 1 })).status, 403);
  const hit = await t.call(se1, 'POST', `/risks/${r1.id}/triggers/${trg.id}/reading`, { value: 120, note: 'Gauge at the site office' }); assert.equal(hit.status, 200, JSON.stringify(hit.json)); assert.deepEqual([hit.json.data.fired, hit.json.data.alerted, hit.json.data.trigger.status], [true, true, 'FIRED']);
  const al = t.api.db.prepare("SELECT * FROM alr_alerts WHERE rule_code = 'risk.trigger_fired'").all(); assert.equal(al.length, 1); assert.equal(al[0].entity_id, String(trg.id)); assert.ok(al[0].message.includes('Rainfall') && al[0].message.includes('120'), al[0].message);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.risk.trigger_fired'").get(), 'the event went out');
  const again = await t.call(se1, 'POST', `/risks/${r1.id}/triggers/${trg.id}/reading`, { value: 130 }); assert.equal(again.json.data.fired, false, 'fired once'); assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM alr_alerts WHERE rule_code = 'risk.trigger_fired'").get().n, 1);
  assert.equal((await t.call(pm1, 'GET', `/risk-dashboard?projectId=${t.a}`)).json.data.counts.triggersFired, 1);
  assert.equal((await t.call(se1, 'POST', `/risks/${r1.id}/triggers/${trg.id}/rearm`)).json.data.triggers[0].status, 'ARMED');
});

test('FR-05 contingency is allocated out of the pool and drawn down; BR-02 closing a high or critical risk needs the owner\'s justification and the project manager', async () => {
  const t = await setup();
  await t.call(pm1, 'PUT', '/risk-settings', { projectId: t.a, contingencyPool: '3000000' });
  const r1 = (await t.call(se1, 'POST', '/risks', risk(t))).json.data;
  const r3 = (await t.call(se1, 'POST', '/risks', risk(t, { title: 'Scaffold collapse', category: 'SAFETY', ownerUser: 'rse2', probability: 3, impactCost: 1, impactSafety: 4, exposureCost: { min: '500000', mostLikely: '2000000', max: '3000000' } }))).json.data;
  const o1 = (await t.call(se1, 'POST', '/risks', risk(t, { rtype: 'OPPORTUNITY', title: 'Early handover', category: 'COMMERCIAL', probability: 3, impactCost: 2, strategy: 'EXPLOIT', actions: [] }))).json.data;
  // contingency
  assert.equal((await t.call(se1, 'POST', `/risks/${r1.id}/contingency`, { kind: 'ALLOCATION', amount: '1000000', reason: 'Monsoon reserve' })).status, 403);
  assert.equal((await t.call(pm1, 'POST', `/risks/${r1.id}/contingency`, { kind: 'ALLOCATION', amount: '4000000', reason: 'Too much' })).status, 400, 'more than the pool');
  assert.equal((await t.call(pm1, 'POST', `/risks/${o1.id}/contingency`, { kind: 'ALLOCATION', amount: '100', reason: 'Opportunity' })).status, 422, 'not for an opportunity');
  const al = await t.call(pm1, 'POST', `/risks/${r1.id}/contingency`, { kind: 'ALLOCATION', amount: '2000000', reason: 'Monsoon reserve' }); assert.equal(al.status, 201, JSON.stringify(al.json)); assert.equal(al.json.data.contingencyAllocated, '2000000.00');
  assert.equal((await t.call(pm1, 'POST', `/risks/${r3.id}/contingency`, { kind: 'ALLOCATION', amount: '1500000', reason: 'Safety' })).status, 400, 'only one million is left');
  assert.equal((await t.call(pm1, 'POST', `/risks/${r1.id}/contingency`, { kind: 'DRAWDOWN', amount: '2500000', reason: 'Too much' })).status, 400, 'more than allocated');
  const dd = await t.call(pm1, 'POST', `/risks/${r1.id}/contingency`, { kind: 'DRAWDOWN', amount: '500000', reason: 'Dewatering pumps hired' }); assert.equal(dd.status, 201, JSON.stringify(dd.json)); assert.equal(dd.json.data.contingencyDrawn, '500000.00'); assert.equal(dd.json.data.contingency.find((x) => x.kind === 'DRAWDOWN').status, 'REQUESTED');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.risk.drawdown_requested'").get(), '12.02 reads the request');
  const d = (await t.call(pm1, 'GET', `/risk-dashboard?projectId=${t.a}`)).json.data; assert.deepEqual([d.contingency.pool, d.contingency.allocated, d.contingency.drawn, d.contingency.left], ['3000000.00', '2000000.00', '500000.00', '1000000.00']);
  assert.equal((await t.call(pm1, 'POST', `/risks/${r1.id}/contingency/${al.json.data.contingency[0].id}/release`)).status, 422, 'part of it is drawn');
  // BR-02: the owner closes; a critical risk waits for the project manager
  assert.equal((await t.call(se2, 'POST', `/risks/${r1.id}/submit`, { reason: 'The monsoon is over for the year' })).status, 403, 'only the owner asks');
  assert.equal((await t.call(se1, 'POST', `/risks/${r1.id}/submit`, { reason: 'short' })).status, 400, 'a justification');
  const sub = await t.call(se1, 'POST', `/risks/${r1.id}/submit`, { reason: 'The foundations are cast; the monsoon exposure has passed' }); assert.equal(sub.status, 202, JSON.stringify(sub.json)); assert.equal(sub.json.data.status, 'CLOSE_REQUESTED'); const inst = sub.json.data.workflowInstanceId;
  assert.equal((await t.call(se1, 'PATCH', `/risks/${r1.id}`, { title: 'Changed while waiting' })).status, 409);
  assert.equal(await t.hasTask(se1, inst), false, 'the owner does not approve'); assert.equal(await t.hasTask(pd1, inst), false); assert.equal(await t.hasTask(pm1, inst), true);
  assert.equal((await t.call(se1, 'POST', `/risks/${r1.id}/withdraw`, { reason: 'Not yet, one more week of data' })).json.data.status, 'OPEN', 'withdrawn before anyone acted');
  const sub2 = await t.call(se1, 'POST', `/risks/${r1.id}/submit`, { reason: 'The foundations are cast; the monsoon exposure has passed' }); const inst2 = sub2.json.data.workflowInstanceId;
  await t.act(pm1, inst2);
  const closed = (await t.call(pm1, 'GET', `/risks/${r1.id}`)).json.data; assert.deepEqual([closed.status, closed.closedBy], ['CLOSED', 'rpm1']); assert.equal(closed.contingencyAllocated, '500000.00', 'the unused contingency went back to the pool; the draw stays');
  assert.equal(t.api.db.prepare("SELECT status FROM tsk_tasks WHERE entity = 'proj_risk' AND entity_id = ?").get(String(r1.id)).status, 'CANCELLED', 'its actions ended');
  assert.equal((await t.call(se1, 'PATCH', `/risks/${r1.id}`, { title: 'After closure' })).status, 409);
  // a returned/rejected closure leaves the risk open; a risk that occurred becomes an issue
  const s3 = await t.call(se2, 'POST', `/risks/${r3.id}/submit`, { reason: 'The scaffold collapsed on level 3; no one was hurt', occurred: true }); const i3 = s3.json.data.workflowInstanceId;
  await t.act(pm2, i3, 'reject'); assert.equal((await t.call(se2, 'GET', `/risks/${r3.id}`)).json.data.status, 'OPEN');
  const s3b = await t.call(se2, 'POST', `/risks/${r3.id}/submit`, { reason: 'The scaffold collapsed on level 3; no one was hurt', occurred: true }); await t.act(pm2, s3b.json.data.workflowInstanceId);
  const occ = (await t.call(se2, 'GET', `/risks/${r3.id}`)).json.data; assert.equal(occ.status, 'OCCURRED'); assert.ok(occ.occurredIssueId); assert.equal(occ.issues.length, 1);
  const iss = (await t.call(se2, 'GET', `/issues/${occ.occurredIssueId}`)).json.data; assert.deepEqual([iss.priority, iss.riskId, iss.title.startsWith('Occurred')], ['HIGH', r3.id, true]);
  // a medium risk closes at once; the amendment reopens
  const m = (await t.call(se1, 'POST', '/risks', risk(t, { title: 'Minor delay', probability: 2, impactCost: 1, impactTime: 2, strategy: 'ACCEPT', actions: [] }))).json.data;
  assert.equal((await t.call(se1, 'POST', `/risks/${m.id}/submit`, { reason: 'It did not happen' })).json.data.status, 'CLOSED');
  assert.equal((await t.call(pm1, 'POST', `/risks/${m.id}/amend`, { reason: 'It came back' })).json.data.status, 'OPEN'); assert.equal((await t.call(se1, 'POST', `/risks/${m.id}/amend`, { reason: 'No right' })).status, 403);
  assert.equal((await t.call(pm1, 'POST', `/risks/${m.id}/cancel`, { reason: 'Duplicate of another' })).json.data.status, 'CANCELLED');
  // the document and the export
  const pr = await t.api.call('GET', `${P}/risks/${r1.id}/print`, plan1); assert.equal(pr.status, 200); assert.equal((await t.api.call('GET', `${P}/risks/export?format=csv`, plan1)).status, 403); assert.equal((await t.api.call('GET', `${P}/risks/export?format=xlsx`, pm1)).status, 200);
});

test('FR-06 the monthly review is approved by the project manager, then the project director, and keeps its snapshot; FR-03 the issue log; roles and the flag', async () => {
  const t = await setup();
  const r1 = (await t.call(se1, 'POST', '/risks', risk(t))).json.data; void r1;
  assert.equal((await t.call(se1, 'POST', '/risk-reviews', { projectId: t.a, period: '2026-11' })).status, 201); // anyone who raises risks may prepare the review
  const rv = (await t.call(pcm, 'POST', '/risk-reviews', { projectId: t.a, period: '2026-10', notes: 'October review' })).json.data; assert.deepEqual([rv.status, rv.data.counts.risks, rv.data.riskEmv], ['DRAFT', 1, '3500000.00']);
  assert.equal((await t.call(pcm, 'POST', '/risk-reviews', { projectId: t.a, period: '2026-10' })).status, 409, 'one review a month');
  assert.equal((await t.call(dir, 'POST', '/risk-reviews', { projectId: t.a, period: '2026-09' })).status, 403, 'the director only views');
  // the register changes after the snapshot was taken; submitting freezes the current figures
  await t.call(se1, 'POST', '/risks', risk(t, { title: 'Second risk', probability: 1, impactCost: 1, impactTime: 1, strategy: 'ACCEPT', actions: [], exposureCost: { min: '0', mostLikely: '100000', max: '200000' } }));
  const sub = await t.call(pcm, 'POST', `/risk-reviews/${rv.id}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json)); assert.equal(sub.json.data.data.counts.risks, 2); const inst = sub.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(pcm, inst), false, 'the sender does not approve'); assert.equal(await t.hasTask(pd1, inst), false, 'the director is second'); assert.equal(await t.hasTask(pm1, inst), true);
  assert.equal((await t.call(pcm, 'PATCH', `/risk-reviews/${rv.id}`, { notes: 'Late' })).status, 409);
  await t.act(pm1, inst); assert.equal((await t.call(pcm, 'GET', `/risk-reviews/${rv.id}`)).json.data.status, 'SUBMITTED'); assert.equal(await t.hasTask(pd1, inst), true); await t.act(pd1, inst);
  const done = (await t.call(pcm, 'GET', `/risk-reviews/${rv.id}`)).json.data; assert.equal(done.status, 'APPROVED'); assert.ok(done.approvedAt);
  await t.call(se1, 'POST', '/risks', risk(t, { title: 'Third risk', actions: [{ description: 'Do something', ownerUser: 'rse1', dueDate: plus(2) }] }));
  assert.equal((await t.call(pcm, 'GET', `/risk-reviews/${rv.id}`)).json.data.data.counts.risks, 2, 'the approved snapshot is frozen');
  const trend = (await t.call(plan1, 'GET', `/risk-dashboard?projectId=${t.a}`)).json.data.trend; assert.deepEqual(trend.map((x) => x.period), ['2026-10', 'live']); assert.equal(trend[0].risks, 2);
  assert.equal((await t.call(pcm, 'GET', `/risk-reviews?projectId=${t.a}`)).json.data.length, 2);
  // the issue log
  assert.equal((await t.call(bd, 'POST', '/issues', { projectId: t.a, title: 'Crane breakdown', ownerUser: 'rse1' })).status, 403);
  assert.equal((await t.call(se1, 'POST', '/issues', { projectId: t.a, title: 'Crane breakdown', ownerUser: 'ghost' })).status, 400);
  const i1 = await t.call(se1, 'POST', '/issues', { projectId: t.a, title: 'Tower crane breakdown', description: 'Gearbox failed', priority: 'HIGH', ownerUser: 'rse1', dueDate: plus(-2), impactCost: '250000', impactTime: 4 }); assert.equal(i1.status, 201, JSON.stringify(i1.json)); const iss = i1.json.data;
  assert.deepEqual([iss.docNo.startsWith('ISS-'), iss.status, iss.overdue, iss.impactCost], [true, 'OPEN', true, '250000.00']);
  const i2 = (await t.call(se1, 'POST', '/issues', { projectId: t.a, title: 'Drawing clash on level 2', ownerUser: 'rplan1', priority: 'LOW' })).json.data;
  assert.equal((await t.call(se2, 'POST', `/issues/${iss.id}/submit`, { resolution: 'Repaired the gearbox' })).status, 403, 'only the owner resolves'); assert.equal((await t.call(se1, 'POST', `/issues/${iss.id}/submit`, { resolution: 'short' })).status, 400);
  assert.equal((await t.call(se1, 'PATCH', `/issues/${iss.id}`, { status: 'IN_PROGRESS' })).json.data.status, 'IN_PROGRESS');
  const res = await t.call(se1, 'POST', `/issues/${iss.id}/submit`, { resolution: 'The gearbox was replaced and the crane recommissioned' }); assert.equal(res.json.data.status, 'RESOLVED');
  assert.equal((await t.call(se1, 'PATCH', `/issues/${iss.id}`, { title: 'After resolution' })).status, 409);
  assert.equal((await t.call(se1, 'POST', `/issues/${iss.id}/withdraw`, { reason: 'Failed again within the hour' })).json.data.status, 'IN_PROGRESS');
  await t.call(se1, 'POST', `/issues/${iss.id}/submit`, { resolution: 'Replaced again with an upgraded gearbox' });
  assert.equal((await t.call(pm1, 'POST', `/issues/${iss.id}/amend`, { reason: 'Reopened by the PM' })).json.data.status, 'IN_PROGRESS');
  const list = (await t.call(pm1, 'GET', `/issues?filter[projectId]=${t.a}`)).json; assert.equal(list.data.length, 2); assert.equal(list.data[0].docNo, iss.docNo, 'highest priority first');
  assert.equal((await t.call(pcm, 'DELETE', `/issues/${i2.id}`)).status, 200); assert.equal((await t.call(se1, 'POST', `/issues/${iss.id}/cancel`, { reason: 'Raised twice' })).status, 403);
  assert.equal((await t.api.call('GET', `${P}/issues/${iss.id}/print`, se1)).status, 200); assert.equal((await t.api.call('GET', `${P}/issues/export?format=xlsx`, pm1)).status, 200); assert.equal((await t.api.call('GET', `${P}/issues/export?format=xlsx`, se1)).status, 403);
  const hi = (await t.call(se1, 'GET', `/issues/${iss.id}/history`)).json.data; assert.ok(hi.audit.some((x) => x.action === 'resolve'));
  // import
  const imp = await t.call(pm1, 'POST', '/risks/import', { projectId: t.a, rows: [risk(t, { title: 'Imported A', probability: 1, impactCost: 1, impactTime: 1, strategy: 'ACCEPT', actions: [] }), risk(t, { title: 'Imported B', probability: 2, impactCost: 2, impactTime: 1, strategy: 'ACCEPT', actions: [] })] }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.equal(imp.json.data.created, 2);
  assert.equal((await t.call(pm1, 'POST', '/risks/import', { projectId: t.a, rows: [risk(t, { title: 'Fine', probability: 1, impactCost: 1, impactTime: 1, strategy: 'ACCEPT', actions: [] }), risk(t, { ownerUser: 'ghost' })] })).status, 400, 'all or none');
  assert.equal((await t.call(pm1, 'GET', `/risks?filter[projectId]=${t.a}&q=Imported`)).json.data.length, 2);
  // roles: the director views, the business developer sees nothing; the flag
  assert.equal((await t.call(dir, 'GET', `/risks?filter[projectId]=${t.a}`)).status, 200); assert.equal((await t.call(dir, 'POST', '/risks', risk(t))).status, 403); assert.equal((await t.call(bd, 'GET', `/risks?filter[projectId]=${t.a}`)).status, 403); assert.equal((await t.call(bd, 'GET', `/risk-dashboard?projectId=${t.a}`)).status, 403);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1006'").run(); assert.equal((await t.call(pm1, 'GET', `/risks?filter[projectId]=${t.a}`)).status, 404, 'flag off'); assert.equal((await t.call(pm1, 'GET', '/projects')).status, 200);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1006'").run();
  void pm2;
});
