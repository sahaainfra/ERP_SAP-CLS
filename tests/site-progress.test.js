import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';
import { metrics, plannedFraction, rollup } from '../src/server/modules/site/evm.js';

// Part 14.05: progress measurement, earned value and S-curves.
// T-01 the weighted roll-up and the earned-value formulas reproduce a worked example (pure formulas, and the same numbers through the whole chain: budget shares, baseline, approved DPR quantities).
// Worked example: A10 100 m3 with a budget of Rs 6,00,000, planned 50 %, 50 m3 done; A20 50 m3 with Rs 4,00,000, planned 50 %, 10 m3 done; AC Rs 4,20,000.
//   physical = (600 x 50 % + 400 x 20 %) / 1000 = 38 %; PV = 5,00,000; EV = 3,80,000; SPI 0.76; CPI 0.9048; EAC = 10,00,000 / 0.9048 = 11,05,263.16; TCPI = 6,20,000 / 5,80,000 = 1.0690.
const S = '/api/v1/site'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `prg-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'gplan1'); const plan2 = as('PLAN', 'gplan2'); const pm = as('PM', 'gpm1'); const pd = as('PD', 'gpd1'); const cm = as('CM', 'gcm1'); const qs = as('QS', 'gqs1'); const sk = as('SK', 'gsk1'); const aud = as('AUD', 'gaud1'); const pcm = as('PCMGR', 'gpcm1'); const other = as('PLAN', 'gplan9', '2'); const sys = as('SYSADM', 'sysadmin');
const day = (n) => isoOf(ordOf(todayIST()) - n); const TODAY = todayIST();

test('T-01 FR-04 the formulas: weighted roll-up, planned fraction, PV, EV, SV, CV, SPI, CPI, EAC and TCPI reproduce the worked example', () => {
  assert.equal(rollup([{ weight: 600, pct: 0.5 }, { weight: 400, pct: 0.2 }]), 0.38); assert.equal(rollup([{ weight: 0, pct: 1 }, { weight: 0, pct: 0 }]), 0.5, 'no weights: the activities count alike'); assert.equal(rollup([]), 0);
  assert.equal(plannedFraction(ordOf, '2026-05-01', '2026-05-20', '2026-04-30'), 0); assert.equal(plannedFraction(ordOf, '2026-05-01', '2026-05-20', '2026-05-10'), 0.5); assert.equal(plannedFraction(ordOf, '2026-05-01', '2026-05-20', '2026-05-20'), 1); assert.equal(plannedFraction(ordOf, '2026-05-01', '2026-05-01', '2026-05-01'), 1);
  const m = metrics({ bac: 100_000_000, pv: 50_000_000, ev: 38_000_000, ac: 42_000_000 });
  assert.deepEqual([m.sv, m.cv, m.spi, m.cpi, m.eac, m.tcpi], [-12_000_000, -4_000_000, 7600, 9048, 110_526_316, 10690]);
  const none = metrics({ bac: 100, pv: 0, ev: 0, ac: null }); assert.deepEqual([none.spi, none.cpi, none.eac, none.tcpi, none.cv], [null, null, null, null, null], 'no meaning, so no number'); assert.equal(metrics({ bac: 100, pv: 10, ev: 10, ac: 100 }).tcpi, null, 'no money left to spend');
});

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['gplan1', ['PLAN']], ['gplan2', ['PLAN']], ['gpm1', ['PM']], ['gpd1', ['PD']], ['gcm1', ['CM']], ['gqs1', ['QS']], ['gsk1', ['SK']], ['gaud1', ['AUD']], ['gpcm1', ['PCMGR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run('sysadmin', 'sysadmin', JSON.stringify(['SYSADM']), 'sysadmin@example.com');
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'PRG', 'Progress Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'PRG-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const w1 = Number(d.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '1', 'Substructure', 1, 't')").run(pid).lastInsertRowid);
  const w2 = Number(d.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '2', 'Superstructure', 1, 't')").run(pid).lastInsertRowid);
  const pcall = (who, method, path, body) => api.call(method, `/api/v1/plan${path}`, { ...who, headers: key(), body });
  const cal = await pcall(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const sch = await pcall(plan1, 'POST', '/schedules', { projectId: pid, name: 'Tower schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' }); const sid = sch.json.data.id;
  const imp = await pcall(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 20 }, { code: 'A20', name: 'Raft concrete', duration: 10, predecessors: 'A10' }, { code: 'M1', name: 'Raft complete', duration: 1, predecessors: 'A20' }] }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); await pcall(plan1, 'POST', `/schedules/${sid}/calculate`);
  const a = Object.fromEntries(d.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ?').all(sid).map((x) => [x.code, x.id]));
  d.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3', wbs_id = ? WHERE id = ?").run(w1, a.A10); d.prepare("UPDATE plan_activities SET qty = 50000, uom = 'm3', wbs_id = ? WHERE id = ?").run(w2, a.A20); d.prepare("UPDATE plan_activities SET act_type = 'MILESTONE', duration_days = 0, wbs_id = ? WHERE id = ?").run(w2, a.M1);
  d.prepare("UPDATE plan_schedules SET status = 'APPROVED', start_date = ? WHERE id = ?").run(day(9), sid);
  // the budget: Rs 6,00,000 on the substructure and Rs 4,00,000 on the superstructure (approved)
  const bud = Number(d.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, name, status, created_by, source_type) VALUES (1, 'BUD/1', ?, ?, 'Budget', 'APPROVED', 't', 'test')").run(day(30), pid).lastInsertRowid);
  for (const [w, amt] of [[w1, 60_000_000], [w2, 40_000_000]]) d.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, resource_type, resource_name, amount, created_by, source_type) VALUES (1, ?, 'DIRECT', ?, 'OTHER', 'Work', ?, 't', 'test')").run(bud, w, amt);
  // the current baseline (approved): A10 over 20 days to today + 10, A20 over 10 days to today + 5, the milestone at today - 3
  const snap = { v: 1, activities: [{ code: 'A10', start: day(9), finish: isoOf(ordOf(TODAY) + 10) }, { code: 'A20', start: day(4), finish: isoOf(ordOf(TODAY) + 5) }, { code: 'M1', start: day(3), finish: day(3) }] };
  d.prepare("INSERT INTO plan_baselines (company_id, doc_no, doc_date, org_project_id, schedule_id, baseline_no, name, reason, snapshot_json, snapshot_hash, status, is_current, created_by, source_type) VALUES (1, 'BL/1', ?, ?, ?, 0, 'Baseline', 'Original', ?, 'h', 'APPROVED', 1, 't', 'test')").run(day(20), pid, sid, JSON.stringify(snap));
  const call = (who, method, path, body, k = key()) => api.call(method, `${S}${path}`, { ...who, headers: k, body });
  const taskOf = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  const act = async (who, instanceId, action = 'approve') => { const task = await taskOf(who, instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); };
  const drain = () => runtimeOf(api.db).bus.drain();
  let dprSeq = 0;
  /** An approved DPR as the event the report publishes: the quantities of its work lines against activities. */
  const dpr = ({ date = TODAY, work, scope = 'SITE', supersedes = null, dprId = null }) => { const id = dprId ?? (900000 + (dprSeq += 1)); if (!d.prepare('SELECT 1 FROM site_dprs WHERE id = ?').get(id)) d.prepare("INSERT INTO site_dprs (id, company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, status, requested_by, project_id, site_id, created_by) VALUES (?, 1, ?, ?, ?, ?, 'x', ?, 'SUPERSEDED', 'x', ?, ?, 't')").run(id, `DPR/${id}`, pid, site, date, scope, pid, site); publishEvent(api.db, { type: 'site.dpr.approved', entity: 'site_dpr', entityId: id, actorId: 'cm', companyId: 1, projectId: pid, siteId: site, data: { dprId: id, docNo: `DPR/${id}`, projectId: pid, siteId: site, date, scope, supersedes, work: work.map(([code, qty]) => ({ activityId: a[code], qty, uom: 'm3' })) } }); drain(); return id; };
  const forecast = () => { d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(isoOf(ordOf(TODAY) + 12), a.A10); d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(isoOf(ordOf(TODAY) + 9), a.A20); d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(isoOf(ordOf(TODAY) + 4), a.M1); };
  const setParam = async (k, value) => assert.equal((await api.call('POST', '/api/v1/core/parameters', { ...sys, headers: key(), body: { key: k, scopeType: 'company', scopeId: 1, value, effectiveFrom: todayIST(), reason: 'Measured quantities decide the financial progress' } })).status, 201);
  return { api, d, call, act, taskOf, drain, dpr, forecast, setParam, pid, site, w1, w2, a, sid, bud };
}

test('FR-01 FR-03 FR-04 the approved DPR quantities, the baseline and the budget give the worked example through the whole chain', async () => {
  const t = await boot(); t.dpr({ work: [['A10', 50]] }); t.dpr({ work: [['A20', 10]] }); t.forecast();
  assert.equal(t.d.prepare("SELECT pct_complete FROM plan_activities WHERE id = ?").get(t.a.A10).pct_complete, 5000, 'the schedule keeps the percent complete through its own service (13.01)');
  const r = (await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}`)).json.data; const p = r.project;
  assert.deepEqual([p.planned, p.physical, p.financial, p.bac, p.pv, p.ev, p.sv, p.spi], [50, 38, 38, 1_000_000, 500_000, 380_000, -120_000, 0.76]); assert.deepEqual([p.cpi, p.eac], [null, null], 'no actual cost yet');
  assert.deepEqual([r.baseline.docNo, r.baselineMissing, r.budget.docNo], ['BL/1', false, 'BUD/1']); const a10 = r.activities.find((x) => x.code === 'A10'); assert.deepEqual([a10.qty, a10.cumQty, a10.planned, a10.physical, a10.weightBasis, a10.bac, a10.variance], [100, 50, 50, 50, 'BUDGET', 600_000, 0]);
  assert.deepEqual(r.wbs.map((n) => [n.code, n.planned, n.physical, n.bac, n.behind]), [['1', 50, 50, 600_000, false], ['2', 50, 20, 400_000, true]]);
  assert.deepEqual(r.milestones.map((m) => [m.code, m.baselineFinish, m.slipDays]), [['M1', day(3), 7]]);
  // BR-01: only approved DPR quantities count (nothing is counted before the event); an amendment replaces the report it amends; a site report is the authority of its day
  const D1 = day(1); const first = t.dpr({ work: [['A20', 5]], scope: 'SUPERVISOR', dprId: 777001, date: D1 }); assert.equal((await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}`)).json.data.activities.find((x) => x.code === 'A20').cumQty, 15, 'the supervisor report adds to the 10 of the site report of another day');
  t.dpr({ work: [['A20', 8]], scope: 'SUPERVISOR', supersedes: first, dprId: 777002, date: D1 }); assert.equal((await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}`)).json.data.activities.find((x) => x.code === 'A20').cumQty, 18, 'the amendment replaces 5 with 8');
  t.dpr({ work: [['A20', 10]], scope: 'SITE', dprId: 777003, date: D1 }); assert.equal((await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}`)).json.data.activities.find((x) => x.code === 'A20').cumQty, 20, 'the site report replaces the supervisors\' for its day: 10 + 10');
  t.dpr({ work: [['A20', 99]], scope: 'SUPERVISOR', dprId: 777004, date: D1 }); assert.equal((await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}`)).json.data.activities.find((x) => x.code === 'A20').cumQty, 20, 'a supervisor report after the site report adds nothing'); t.dpr({ work: [['A20', 10]], scope: 'SITE', dprId: 777003, date: D1 });
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM prs_activity_progress WHERE dpr_id = 777003 AND deleted_at IS NULL").get().n, 1, 'a replay of the event changes nothing');
  assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'site.progress.updated'").get());
});

test('FR-02 FR-04 BR-02 a period is closed by PLAN then the PM: adjustments with reasons, snapshot, earned value, immutability, amendment, events', async () => {
  const t = await boot(); t.dpr({ work: [['A10', 50]] }); t.dpr({ work: [['A20', 5]] }); t.forecast();
  const o = (await t.call(plan1, 'GET', `/periods/options?projectId=${t.pid}`)).json.data; assert.deepEqual([o.nextStart, o.activities.map((x) => x.code)], [day(9), ['A10', 'A20']]);
  const bad = async (body) => (await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY, ...body }));
  assert.equal((await bad({ periodType: 'WEEK' })).status, 400, 'ten days is not a week'); assert.equal((await bad({ periodEnd: isoOf(ordOf(TODAY) + 1) })).status, 400, 'not a day to come'); assert.equal((await bad({ periodEnd: day(20) })).status, 400, 'not before the first day');
  assert.equal((await bad({ adjustments: [{ activityCode: 'A20', qty: 60, reason: 'Too much' }] })).status, 400, 'above the total'); assert.equal((await bad({ adjustments: [{ activityCode: 'A20', qty: -9, reason: 'Too little' }] })).status, 400, 'below nothing'); assert.equal((await bad({ adjustments: [{ activityCode: 'ZZ', qty: 1, reason: 'No such one' }] })).status, 400); assert.equal((await bad({ adjustments: [{ activityCode: 'M1', qty: 1, reason: 'A milestone' }] })).status, 400, 'an activity with no quantity'); assert.equal((await bad({ adjustments: [{ activityCode: 'A20', qty: 5, reason: 'x' }] })).status, 400, 'a reason of five characters');
  const k = key(); const mk = await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY, actualCost: 420000, adjustments: [{ activityCode: 'A20', qty: 5, reason: 'The measured sheet shows five cubic metres more' }] }, k); assert.equal(mk.status, 201, JSON.stringify(mk.json)); const per = mk.json.data;
  assert.equal((await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY, actualCost: 420000, adjustments: [{ activityCode: 'A20', qty: 5, reason: 'The measured sheet shows five cubic metres more' }] }, k)).json.data.id, per.id, 'idempotent replay'); assert.equal((await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY })).status, 409, 'one open period a project');
  assert.deepEqual([per.status, per.periodStart, per.docNo.startsWith('PRD/'), per.actualCost], ['DRAFT', day(9), true, 420000]); assert.equal((await t.call(plan1, 'PATCH', `/periods/${per.id}`, { periodEnd: TODAY, rowVersion: 99 })).status, 409);
  const sent = await t.call(plan1, 'POST', `/periods/${per.id}/submit`, undefined, key()); assert.equal(sent.status, 202, JSON.stringify(sent.json)); const s = sent.json.data; assert.deepEqual([s.status, s.physical, s.planned, s.preview, s.snapshot.project.spi], ['SUBMITTED', 38, 50, true, 0.76]); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM prs_activity_progress WHERE period_id IS NOT NULL').get().n, 0, 'nothing is written before the close');
  assert.equal((await t.call(plan1, 'PATCH', `/periods/${per.id}`, { actualCost: 1 })).status, 409); const inst = s.workflowInstanceId; assert.equal(await t.taskOf(plan1, inst), undefined, 'the sender never decides'); assert.equal((await t.act(plan2, inst).catch(() => ({ status: 0 }))).status, 0, 'planning holds no task');
  assert.equal((await t.act(pm, inst, 'return')).status, 200); assert.equal((await t.call(plan1, 'GET', `/periods/${per.id}`)).json.data.status, 'RETURNED'); assert.equal((await t.call(plan1, 'PATCH', `/periods/${per.id}`, { actualCost: 430000 })).json.data.actualCost, 430000); assert.equal((await t.call(plan1, 'PATCH', `/periods/${per.id}`, { actualCost: 420000 })).status, 200);
  assert.equal((await t.call(plan1, 'POST', `/periods/${per.id}/submit`)).status, 202); assert.equal((await t.act(pm, inst)).status, 200);
  const closed = (await t.call(pm, 'GET', `/periods/${per.id}`)).json.data; assert.deepEqual([closed.status, closed.closedBy, closed.preview, closed.physical, closed.snapshot.summary.physical, closed.snapshot.project.cpi, closed.snapshot.project.eac, closed.snapshot.project.tcpi], ['APPROVED', 'gpm1', false, 38, 38, 0.9048, 1_105_263.16, 1.069]);
  const evm = t.d.prepare('SELECT * FROM prs_evm WHERE period_id = ? AND deleted_at IS NULL ORDER BY wbs_id IS NOT NULL, wbs_id').all(per.id); assert.deepEqual([evm.length, evm[0].wbs_id, evm[0].bac, evm[0].pv, evm[0].ev, evm[0].ac, evm[0].spi, evm[0].cpi, evm[0].eac, evm[0].tcpi], [3, null, 100_000_000, 50_000_000, 38_000_000, 42_000_000, 7600, 9048, 110_526_316, 10690]); assert.deepEqual(evm.slice(1).map((x) => [x.wbs_id, x.ev]), [[t.w1, 30_000_000], [t.w2, 8_000_000]]);
  const adjRows = t.d.prepare("SELECT activity_code, qty, source, reason FROM prs_activity_progress WHERE period_id = ?").all(per.id); assert.deepEqual(adjRows.map((x) => [x.activity_code, x.qty, x.source]), [['A20', 5000, 'MANUAL']]); assert.match(adjRows[0].reason, /measured sheet/);
  t.drain(); const ev = t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'site.period.closed'").all().map((x) => JSON.parse(x.payload).data); assert.equal(ev.length, 1); assert.deepEqual([ev[0].docNo, ev[0].periodEnd, ev[0].physical, ev[0].planned, ev[0].ev, ev[0].ac, ev[0].spi, ev[0].cpi, ev[0].eac], [per.docNo, TODAY, 38, 50, 380_000, 420_000, 0.76, 0.9048, 1_105_263.16]);
  // BR-02: closed means immutable; later quantities change the live figures, not the snapshot
  assert.equal((await t.call(plan1, 'PATCH', `/periods/${per.id}`, { actualCost: 1 })).status, 409); assert.equal((await t.call(plan1, 'POST', `/periods/${per.id}/cancel`, { reason: 'Not any more' })).status, 422); assert.equal((await t.call(plan1, 'DELETE', `/periods/${per.id}`)).status, 422);
  const hash = t.d.prepare('SELECT snapshot_hash FROM prs_periods WHERE id = ?').get(per.id).snapshot_hash; t.dpr({ work: [['A10', 10]], date: day(2) }); assert.equal(t.d.prepare('SELECT snapshot_hash FROM prs_periods WHERE id = ?').get(per.id).snapshot_hash, hash); assert.equal((await t.call(pm, 'GET', `/periods/${per.id}`)).json.data.snapshot.summary.physical, 38); assert.ok((await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}`)).json.data.project.physical > 38);
  // the next period starts the day after; the latest closed period is amended by a copy that replaces it with its figures
  assert.equal((await t.call(plan1, 'GET', `/periods/options?projectId=${t.pid}`)).json.data.nextStart, isoOf(ordOf(TODAY) + 1)); assert.equal((await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'WEEK', periodEnd: TODAY })).status, 400, 'nothing left to close today');
  const am = await t.call(plan1, 'POST', `/periods/${per.id}/amend`, { reason: 'The cost of the month was corrected' }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.deepEqual([am.json.data.status, am.json.data.revisionNo, am.json.data.previous.id, am.json.data.periodStart], ['DRAFT', 2, per.id, day(9)]); assert.equal((await t.call(plan1, 'POST', `/periods/${per.id}/amend`, { reason: 'Twice at once' })).status, 409);
  await t.call(plan1, 'PATCH', `/periods/${am.json.data.id}`, { actualCost: 400000 }); const s2 = await t.call(plan1, 'POST', `/periods/${am.json.data.id}/submit`); assert.equal((await t.act(pm, s2.json.data.workflowInstanceId)).status, 200);
  assert.equal((await t.call(plan1, 'GET', `/periods/${per.id}`)).json.data.status, 'SUPERSEDED'); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM prs_evm WHERE period_id = ? AND deleted_at IS NULL').get(per.id).n, 0); assert.equal(t.d.prepare('SELECT ac FROM prs_evm WHERE period_id = ? AND wbs_id IS NULL').get(am.json.data.id).ac, 40_000_000); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM prs_activity_progress WHERE source = 'MANUAL' AND deleted_at IS NULL").get().n, 1, 'one adjustment, not two');
  const h = (await t.call(plan1, 'GET', `/periods/${per.id}/history`)).json.data; assert.ok(h.approvals.length >= 4 && h.audit.some((x) => x.action === 'close')); const pr = await t.api.raw('GET', `${S}/periods/${am.json.data.id}/print`, plan1); assert.equal(pr.status, 200); assert.match(pr.buffer.toString(), /Progress period/);
  assert.equal((await t.call(plan1, 'GET', '/periods?filter[status]=APPROVED')).json.data.length, 1); assert.equal((await t.api.raw('GET', `${S}/periods/export?format=csv`, plan1)).status, 200);
});

test('FR-05 FR-06 the dashboard, the S-curves, the client report, the weights and the measured quantities', async () => {
  const t = await boot(); t.dpr({ work: [['A10', 50]] }); t.dpr({ work: [['A20', 10]] }); t.forecast();
  const dash = (await t.call(plan1, 'GET', `/progress/dashboard?projectId=${t.pid}`)).json.data; assert.deepEqual([dash.project.physical, dash.project.planned, dash.project.spi, dash.canSeeCost, dash.spiLimit], [38, 50, 0.76, true, 0.9]);
  assert.deepEqual(dash.exceptions.map((x) => x.kind), ['PROJECT_BEHIND', 'WBS_BEHIND', 'MILESTONE_LATE']); assert.deepEqual(dash.pending, [], 'no period is open yet');
  const c = dash.curve; assert.ok(c.dates.length > 3 && c.dates.includes(TODAY)); const i = c.dates.indexOf(TODAY); assert.deepEqual([c.planned.physical[i], c.actual.physical[i], c.forecast.physical[i], c.planned.physical.at(-1), c.forecast.physical.at(-1)], [50, 38, 38, 100, 100]);
  assert.ok(c.actual.physical.slice(i + 1).every((x) => x === null) && c.forecast.physical.slice(0, i).every((x) => x === null), 'actual stops at the data date, the forecast starts there'); assert.deepEqual([c.planned.financial[i], c.actual.financial[i]], [500_000, 380_000]); assert.ok(c.planned.physical.every((x, k, a) => k === 0 || x >= a[k - 1]), 'the plan only rises');
  assert.ok((await t.call(plan1, 'GET', `/progress/scurve?projectId=${t.pid}&asOf=${day(3)}`)).json.data.dates.length > 3);
  // money is for those who may see it: planning with cost does; the construction manager sees the percentages only
  const cmDash = (await t.call(cm, 'GET', `/progress/dashboard?projectId=${t.pid}`)).json.data; assert.deepEqual([cmDash.canSeeCost, cmDash.project.spi, cmDash.project.pv, cmDash.project.bac, cmDash.curve.planned.financial], [false, 0.76, undefined, undefined, undefined]); assert.equal(JSON.stringify(cmDash).includes('"bac"'), false);
  // the client report: percentages, no money, and a closed period's is its snapshot
  const live = (await t.call(plan1, 'GET', `/progress/client-report?projectId=${t.pid}`)).json.data; assert.deepEqual([live.live, live.summary.planned, live.summary.physical, live.wbs.map((x) => x.code)], [true, 50, 38, ['1', '2']]); assert.equal(/"(bac|pv|ev|ac)"/.test(JSON.stringify(live)), false);
  const per = (await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY })).json.data; const sub = (await t.call(plan1, 'POST', `/periods/${per.id}/submit`)).json.data; assert.deepEqual([(await t.call(plan1, 'GET', `/progress/dashboard?projectId=${t.pid}`)).json.data.pending.map((x) => x.action), (await t.call(pm, 'GET', `/progress/dashboard?projectId=${t.pid}`)).json.data.pending.map((x) => x.action)], [[], ['APPROVE']]); await t.act(pm, sub.workflowInstanceId);
  const cr = (await t.call(plan1, 'GET', `/progress/client-report?projectId=${t.pid}`)).json.data; assert.deepEqual([cr.live, cr.period.docNo, cr.summary.physical], [false, per.docNo, 38]); t.dpr({ work: [['A10', 20]], date: day(1) }); assert.equal((await t.call(plan1, 'GET', `/progress/client-report?projectId=${t.pid}&periodId=${per.id}`)).json.data.summary.physical, 38, 'a closed period\'s report never changes');
  for (const f of ['pdf', 'xlsx']) { const x = await t.api.raw('GET', `${S}/progress/client-report/export?projectId=${t.pid}&format=${f}`, plan1); assert.equal(x.status, 200); } assert.equal((await t.api.raw('GET', `${S}/progress/client-report/export?projectId=${t.pid}&format=pdf`, plan1)).buffer.subarray(0, 4).toString(), '%PDF');
  const csv = await t.api.raw('GET', `${S}/progress/report/export?projectId=${t.pid}&format=csv`, plan1); assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /Excavation/); assert.equal((await t.api.raw('GET', `${S}/progress/report/export?projectId=${t.pid}&format=csv`, pm)).status, 200); assert.equal((await t.api.raw('GET', `${S}/progress/report/export?projectId=${t.pid}&format=csv`, cm)).status, 403);
  // a manual weight replaces the budget share; the report says so
  assert.equal((await t.call(cm, 'PUT', '/progress/weights', { projectId: t.pid, weights: [{ activityCode: 'A10', amount: 100000 }] })).status, 403); assert.equal((await t.call(plan1, 'PUT', '/progress/weights', { projectId: t.pid, weights: [{ activityCode: 'ZZ', amount: 1 }] })).status, 400);
  assert.equal((await t.call(plan1, 'PUT', '/progress/weights', { projectId: t.pid, weights: [{ activityCode: 'A10', amount: 100000 }] })).status, 200); const w = (await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}`)).json.data; assert.deepEqual([w.activities.find((x) => x.code === 'A10').weightBasis, w.activities.find((x) => x.code === 'A10').bac, w.project.bac], ['MANUAL', 100_000, 500_000]); assert.deepEqual((await t.call(plan1, 'GET', `/progress/weights?projectId=${t.pid}`)).json.data, [{ activityCode: 'A10', amount: 100000 }]);
  assert.equal((await t.call(plan1, 'PUT', '/progress/weights', { projectId: t.pid, weights: [{ activityCode: 'A10', amount: null }] })).status, 200);
  // BR-01: a measured quantity decides the financial progress only where configured
  const svc = (await import('../src/server/modules/site/index.js')).siteOf(t.d).progressSvc; svc.recordMeasured({ companyId: 1, user: 'mb' }, { projectId: t.pid, activityCode: 'A10', date: TODAY, cumQty: 80, ref: 'MB-1' });
  let r0 = (await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}&asOf=${TODAY}`)).json.data.project; const base = r0.ev; await t.setParam('site.progress.mb_override', true); const r1 = (await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}&asOf=${TODAY}`)).json.data; assert.ok(r1.project.ev > base, `EV ${r1.project.ev} above ${base}`); assert.equal(r1.activities.find((x) => x.code === 'A10').financial, 80); assert.ok(r1.activities.find((x) => x.code === 'A10').physical < 80 + 1e-9 && r1.mbOverride === true);
});

test('AC-03 AC-04 roles and isolation: who sees and does what; another company gets nothing; the flag gates the routes; no path around the approval', async () => {
  const t = await boot(); t.dpr({ work: [['A10', 50]] });
  for (const [who, view, create] of [[plan1, 200, 201], [pcm, 200, 201], [pm, 200, 403], [pd, 200, 403], [cm, 200, 403], [qs, 200, 403], [aud, 200, 403], [sk, 403, 403]]) {
    assert.equal((await t.call(who, 'GET', '/periods')).status, view, `${who.roles} lists`); assert.equal((await t.call(who, 'GET', `/progress/dashboard?projectId=${t.pid}`)).status, view, `${who.roles} dashboard`);
    if (create === 201) { const mk = await t.call(who, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY }); assert.equal(mk.status, 201); assert.equal((await t.call(who, 'DELETE', `/periods/${mk.json.data.id}`)).status, 200); } else assert.equal((await t.call(who, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY })).status, 403, `${who.roles} cannot create`);
  }
  const per = (await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY, actualCost: 300000 })).json.data; assert.equal((await t.call(pm, 'GET', `/periods/${per.id}`)).json.data.actualCost, 300000); assert.deepEqual([(await t.call(cm, 'GET', `/periods/${per.id}`)).json.data.actualCost, (await t.call(cm, 'GET', `/periods/${per.id}`)).json.data.costMasked], [null, true]);
  assert.equal((await t.call(pm, 'PATCH', `/periods/${per.id}`, { actualCost: 1 })).status, 403); assert.equal((await t.call(pm, 'POST', `/periods/${per.id}/submit`)).status, 403); assert.equal((await t.call(plan1, 'PATCH', `/periods/${per.id}`, { status: 'APPROVED' })).status, 400, 'the status is set by the workflow only'); assert.equal((await t.call(pm, 'POST', `/periods/${per.id}/amend`, { reason: 'Not closed yet' })).status, 403);
  assert.equal((await t.call(other, 'GET', `/periods/${per.id}`)).status, 404); assert.equal((await t.call(other, 'GET', '/periods')).json.data.length, 0); assert.equal((await t.call(other, 'GET', `/progress/dashboard?projectId=${t.pid}`)).status, 404); assert.equal((await t.call(other, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY })).status, 404);
  assert.deepEqual((await t.call(plan1, 'GET', '/progress/projects')).json.data.map((x) => x.code), ['PRG']); assert.equal((await t.call(plan1, 'GET', `/progress/report?projectId=${t.pid}&asOf=${isoOf(ordOf(TODAY) + 3)}`)).status, 400);
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1405'").run(); assert.equal((await t.call(plan1, 'GET', '/periods')).status, 404); assert.equal((await t.call(plan1, 'GET', `/progress/dashboard?projectId=${t.pid}`)).status, 404); assert.notEqual((await t.api.call('GET', `${S}/weather`, { ...cm })).status, 404);
});

test('PACK-20 the S-curve carries planned (PV), earned (EV) and the actual cost (AC) of the closed periods, for those who see cost', async () => {
  const t = await boot(); t.dpr({ work: [['A10', 50]] }); t.dpr({ work: [['A20', 5]] }); t.forecast();
  const per = (await t.call(plan1, 'POST', '/periods', { projectId: t.pid, periodType: 'MONTH', periodEnd: TODAY, actualCost: 420000 }, key())).json.data;
  const s = (await t.call(plan1, 'POST', `/periods/${per.id}/submit`, undefined, key())).json.data; assert.equal((await t.act(pm, s.workflowInstanceId)).status, 200);
  const curve = async (who) => (await t.call(who, 'GET', `/progress/scurve?projectId=${t.pid}`)).json.data;
  const off = await curve(plan1); assert.equal(off.actualCost, undefined, 'flag off: as before'); assert.ok(off.planned.financial, 'planning sees cost');
  t.d.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.plan.pack20', 1, 'test', 0, 1)").run();
  const c = await curve(plan1); const i = c.dates.indexOf(TODAY); assert.ok(i > 0);
  assert.deepEqual(c.earned.financial, c.actual.financial, 'earned is the actual financial line (EV)');
  assert.equal(c.actualCost.financial[i], 420000, 'AC of the period closed today'); assert.ok(c.actualCost.financial.slice(0, i).every((x) => x === null), 'no AC before the first closed period');
  assert.ok(c.actualCost.financial.slice(i + 1).every((x) => x === null), 'nothing after the as-of date');
  const evm = t.d.prepare('SELECT ev, ac FROM prs_evm WHERE period_id = ? AND wbs_id IS NULL').get(per.id); assert.equal(c.earned.financial[i], evm.ev / 100, 'EV on the curve = EV of the closed period'); assert.equal(evm.ac / 100, 420000);
  assert.deepEqual(c.periodsClosed, [{ periodEnd: TODAY, ac: 420000 }]);
  const blind = await curve(cm); assert.equal(blind.actualCost, undefined, 'the construction manager sees no cost'); assert.equal(JSON.stringify(blind).includes('420000'), false);
});
