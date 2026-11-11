import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';

// Part 14.07: the project control engine.
// T-01 the facts equal the sums of the source ledgers after reconciliation, and a material cost is not counted twice (stock receipt against issue, by the company's rule).
// Worked example: a budget of Rs 6,00,000 for 600 units of material on the substructure (rate 1,000); the activity under it is half done (earned 3,00,000); 200 units were bought for 1,30,000 (rate 650).
//   quantity variance = (300 - 200) x 1,000 = 1,00,000; rate variance = (1,000 - 650) x 200 = 70,000; together they are the cost variance 3,00,000 - 1,30,000 = 1,70,000.
const S = '/api/v1/site'; const B = '/api/v1/bud'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `ctl-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'gplan1'); const pm = as('PM', 'gpm1'); const pm2 = as('PM', 'gpm2'); const pd = as('PD', 'gpd1'); const qs = as('QS', 'gqs1'); const qs2 = as('QS', 'gqs2'); const pcm = as('PCMGR', 'gpcm1'); const dir = as('DIR', 'gdir1'); const cfo = as('CFO', 'gcfo1'); const aud = as('AUD', 'gaud1'); const se = as('SE', 'gse1'); const sys = as('SYSADM', 'sysadmin'); const other = as('QS', 'gqsx', '2');
const day = (n) => isoOf(ordOf(todayIST()) - n); const TODAY = todayIST();

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['gplan1', ['PLAN']], ['gplan2', ['PLAN']], ['gpm1', ['PM']], ['gpd1', ['PD']], ['gcm1', ['CM']], ['gqs1', ['QS']], ['gsk1', ['SK']], ['gaud1', ['AUD']], ['gpcm1', ['PCMGR']], ['gpm2', ['PM']], ['gqs2', ['QS']], ['gdir1', ['DIR']], ['gcfo1', ['CFO']], ['gse1', ['SE']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
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

/** The setup of the control tests: the budget of the substructure is 600 units of material (rate 1,000), that of the superstructure labour; A10 is half done. */
async function ready() {
  const t = await boot(); const d = t.d; const codes = d.prepare('SELECT id FROM fin_cost_codes ORDER BY id LIMIT 2').all().map((x) => x.id); const [c1, c2] = codes;
  d.prepare("UPDATE bud_lines SET resource_type = 'MATERIAL', qty = 600000, cost_code_id = ? WHERE wbs_id = ?").run(c1, t.w1); d.prepare("UPDATE bud_lines SET resource_type = 'LABOUR', qty = 400000, cost_code_id = ? WHERE wbs_id = ?").run(c2, t.w2);
  d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'gpm1', 100000000, '2026-01-01', '2026-12-31', 'test')").run(t.pid);
  t.dpr({ work: [['A10', 50], ['A20', 10]] }); t.forecast();
  const ledger = async (who, body) => { const r = await t.api.call('POST', `${B}/ingest/actual`, { ...who, headers: key(), body }); assert.equal(r.status, 201, JSON.stringify(r.json)); t.drain(); return r.json.data; };
  const post = (id, sourceType, lines, date = TODAY) => ledger(sys, { action: 'POST', projectId: t.pid, sourceType, sourceId: id, docRef: id, vendorRef: 'V-1', vendorName: 'Shree Traders', date, lines });
  const facts = async (who, q = '') => (await t.call(who, 'GET', `/control/facts?projectId=${t.pid}${q}`)).json.data;
  return { ...t, c1, c2, post, facts, ledger };
}

test('T-01 FR-01 FR-02 FR-03 BR-01 the facts equal the sums of the source ledgers; a stock receipt and its issue are not both counted; the nightly reconciliation finds and repairs a difference', async () => {
  const t = await ready();
  // budget, planned and earned come from their owners: A10 is 50 % planned and 50 % done, so half of the 6,00,000 is planned and earned; the superstructure is 50 % planned and 20 % done
  let f = await t.facts(pm); assert.deepEqual([f.totals.budget, f.totals.planned, f.totals.earned, f.totals.actual, f.totals.committed], [1_000_000, 500_000, 380_000, 0, 0]); assert.deepEqual([f.totals.billed, f.totals.certified, f.totals.forecast], [0, 0, null], 'billing and forecast have no owner yet');
  const w1 = (x) => x.rows.find((r) => r.id === t.w1);
  // a direct delivery counts at its receipt; a stock item at its issue: the receipt into the store (GRN_STOCK) is not counted, its issue is
  await t.post('GD-1', 'GRN_DIRECT', [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 100, amount: 100000 }]);
  await t.post('GS-1', 'GRN_STOCK', [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 100, amount: 50000 }]);
  await t.post('IS-1', 'ISSUE', [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 100, amount: 30000 }]);
  await t.post('PAY-1', 'PAYROLL', [{ lineId: '1', wbsId: t.w2, costCodeId: t.c2, resourceType: 'LABOUR', qty: 10, amount: 20000 }]);
  f = await t.facts(pm); assert.equal(f.materialRule, 'ISSUE'); assert.deepEqual([w1(f).actual, f.rows.find((r) => r.id === t.w2).actual, f.totals.actual], [130_000, 20_000, 150_000], 'GRN_DIRECT 1,00,000 + ISSUE 30,000; the stock receipt of 50,000 is not counted');
  const ledgerSum = (rule) => t.d.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM bud_actuals WHERE status = 'POSTED' AND (resource_type <> 'MATERIAL' OR (CASE src_type WHEN 'GRN_STOCK' THEN ? = 'GRN' WHEN 'ISSUE' THEN ? = 'ISSUE' ELSE 1 END))").get(rule, rule).n;
  assert.equal(t.d.prepare('SELECT SUM(actual_cost) AS n FROM ctl_facts').get().n, ledgerSum('ISSUE'), 'the facts equal the ledger counted by the rule'); assert.equal(t.d.prepare('SELECT SUM(actual_cost) AS n FROM ctl_facts').get().n, 15_000_000);
  // a commitment is an open amount: a PO of 2,00,000 with a part receipt consumed against it
  const po = await t.api.call('POST', `${B}/ingest/commitment`, { ...sys, headers: key(), body: { action: 'UPSERT', projectId: t.pid, stage: 'PO', sourceType: 'proc_po', sourceId: 'PO-9', docRef: 'PO/9', vendorRef: 'V-1', vendorName: 'Shree Traders', lines: [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 200, amount: 200000 }] } }); assert.equal(po.status, 201, JSON.stringify(po.json)); t.drain();
  f = await t.facts(pm); assert.equal(w1(f).committed, 200_000);
  // BR-02 the reconciliation: clean now; a fact that missed an event (altered behind the engine's back) is found, alerted, and rebuilt
  const run1 = (await t.call(pcm, 'POST', '/control/reconciliation/run', { projectId: t.pid })).json.data; assert.deepEqual([run1.status, run1.differences.length, run1.checked > 0], ['CLEAN', 0, true]);
  t.d.prepare("UPDATE ctl_facts SET actual_cost = actual_cost + 5000000 WHERE wbs_id = ? AND period_key <> ''").run(t.w1); t.d.prepare('UPDATE ctl_facts SET committed_cost = 0 WHERE wbs_id = ?').run(t.w1);
  const run2 = (await t.call(pcm, 'POST', '/control/reconciliation/run', { projectId: t.pid })).json.data; assert.equal(run2.status, 'DIFFERENCES'); assert.ok(run2.differences.some((x) => x.measure === 'Actual cost' && x.difference === 50_000) && run2.differences.some((x) => x.measure === 'Committed cost')); assert.equal(run2.repaired, true);
  assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'site.control.reconciliation_failed'").get()); assert.deepEqual([w1(await t.facts(pm)).actual, w1(await t.facts(pm)).committed], [130_000, 200_000], 'the facts are rebuilt from the ledgers');
  // the nightly job: a difference in the standing figures is found and rebuilt without anyone asking
  t.d.prepare("UPDATE ctl_facts SET planned_cost = 0, budget_cost = budget_cost + 1000000 WHERE wbs_id = ? AND period_key = ''").run(t.w2); const jobs = runtimeOf(t.api.db).jobs; await jobs.enqueue('site.control_reconcile', {}); await jobs.drain();
  const nl = t.d.prepare("SELECT status, diff_count FROM ctl_recon_runs WHERE run_kind = 'NIGHTLY' ORDER BY id DESC LIMIT 1").get(); assert.deepEqual({ ...nl }, { status: 'DIFFERENCES', diff_count: 1 }, 'the nightly run found the altered budget'); assert.equal(t.d.prepare("SELECT budget_cost FROM ctl_facts WHERE wbs_id = ? AND period_key = ''").get(t.w2).budget_cost, 40_000_000, 'and rebuilt it');
  t.d.prepare("UPDATE ctl_facts SET budget_cost = budget_cost + 1000000 WHERE wbs_id = ? AND period_key = ''").run(t.w2); const r3 = (await t.call(pcm, 'POST', '/control/reconciliation/run', { projectId: t.pid })).json.data; assert.equal(r3.status, 'DIFFERENCES'); assert.equal((await t.call(pcm, 'POST', '/control/reconciliation/run', { projectId: t.pid })).json.data.status, 'CLEAN', 'repaired by the run before');
  const runs = (await t.call(pm, 'GET', `/control/reconciliation?projectId=${t.pid}`)).json.data; assert.deepEqual(runs.map((x) => x.status).slice(0, 3), ['CLEAN', 'DIFFERENCES', 'DIFFERENCES']);
  // an event repeated, or a reversal, leaves the facts equal to the ledger
  await t.ledger(sys, { action: 'REVERSE', projectId: t.pid, sourceType: 'GRN_DIRECT', sourceId: 'GD-1', lines: [] }); assert.equal(w1(await t.facts(pm)).actual, 30_000, 'a reversed receipt is out of the facts'); assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'site.control.updated'").get());
  // the company's rule can be the other way: every receipt counts and no issue does
  await t.setParam('site.control.material_cost_at', 'GRN'); assert.equal((await t.call(pcm, 'POST', '/control/refresh', { projectId: t.pid })).status, 200); f = await t.facts(pm);
  assert.deepEqual([f.materialRule, w1(f).actual], ['GRN', 50_000], 'GD-1 is reversed: GRN_STOCK 50,000 counts and the issue does not'); assert.equal(t.d.prepare('SELECT SUM(actual_cost) AS n FROM ctl_facts').get().n, ledgerSum('GRN') + 0);
});

test('FR-05 the variance of a cost is split into a quantity variance and a rate variance that add up to the cost variance; planned against earned; committed against budget; the dashboard shows the exceptions', async () => {
  const t = await ready(); await t.post('GD-2', 'GRN_DIRECT', [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 200, amount: 130000 }]);
  const v = (await t.call(pcm, 'GET', `/control/variance?projectId=${t.pid}&groupBy=WBS`)).json.data; const r1 = v.rows.find((x) => x.id === t.w1);
  assert.deepEqual([r1.budget, r1.budgetQty, r1.budgetRate, r1.earnedQty, r1.actualQty, r1.actualRate], [600_000, 600, 1000, 300, 200, 650]);
  assert.deepEqual([r1.quantityVariance, r1.rateVariance, r1.costVariance], [100_000, 70_000, 170_000]); assert.equal(r1.quantityVariance + r1.rateVariance, r1.costVariance, 'the two add up to the cost variance');
  assert.deepEqual([r1.planned, r1.earned, r1.scheduleVariance], [300_000, 300_000, 0]); const r2 = v.rows.find((x) => x.id === t.w2); assert.deepEqual([r2.planned, r2.earned, r2.scheduleVariance], [200_000, 80_000, -120_000]);
  assert.equal(v.totals.costVariance, v.rows.reduce((n, x) => n + x.costVariance, 0)); assert.equal(v.totals.quantityVariance + v.totals.rateVariance, v.totals.costVariance);
  const byCode = (await t.call(pcm, 'GET', `/control/variance?projectId=${t.pid}&groupBy=COST_CODE`)).json.data; assert.equal(byCode.rows.length, 2); assert.equal(byCode.totals.costVariance, v.totals.costVariance);
  assert.equal((await t.call(pcm, 'GET', `/control/variance?projectId=${t.pid}&groupBy=MONTH`)).status, 400);
  // committed against budget: commitments above the budget of a node are an exception on the dashboard, with the way to the record
  const po = await t.api.call('POST', `${B}/ingest/commitment`, { ...sys, headers: key(), body: { action: 'UPSERT', projectId: t.pid, stage: 'PO', sourceType: 'proc_po', sourceId: 'PO-8', docRef: 'PO/8', vendorRef: 'V-1', lines: [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 600, amount: 600000 }] } }); assert.equal(po.status, 201, JSON.stringify(po.json)); t.drain();
  const dash = (await t.call(pm, 'GET', `/control/dashboard?projectId=${t.pid}`)).json.data; assert.deepEqual([dash.tiles.budget, dash.tiles.committed, dash.tiles.actual, dash.tiles.earned], [1_000_000, 600_000, 130_000, 380_000]);
  const over = dash.exceptions.find((x) => x.kind === 'OVER_BUDGET'); assert.ok(over && over.label.includes('Substructure') && over.amount === 130_000, JSON.stringify(dash.exceptions)); assert.equal(dash.byWbs.find((x) => x.id === t.w1).over, true);
  assert.ok(dash.byCostHead.length >= 1 && dash.trend.length === 1 && dash.trend[0].month === TODAY.slice(0, 7), 'a month of actuals in the trend'); assert.deepEqual(dash.byResource.map((x) => x.label).sort(), ['Labour', 'Material']);
  // FR-04 every figure drills to its source documents
  const dr = async (q) => (await t.call(pm, 'GET', `/control/drill?projectId=${t.pid}&${q}`)).json.data;
  const a = await dr(`measure=ACTUAL&wbsId=${t.w1}`); assert.deepEqual(a.rows.map((x) => [x.docRef, x.amount, x.counted]), [['GD-2', 130_000, true]]); assert.equal((await dr(`measure=COMMITTED&wbsId=${t.w1}`)).rows[0].docRef, 'PO/8'); assert.equal((await dr(`measure=BUDGET&wbsId=${t.w1}`)).total, 600_000);
  const e = await dr(`measure=EARNED&wbsId=${t.w1}`); assert.deepEqual([e.rows.map((x) => x.docRef), e.total], [['A10'], 300_000]); assert.equal((await dr(`measure=PLANNED&keys=${t.w2}::`)).rows[0].docRef, 'A20');
  await t.post('GS-9', 'GRN_STOCK', [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 10, amount: 7000 }]); const ex = await dr(`measure=ACTUAL&wbsId=${t.w1}`); const st = ex.rows.find((x) => x.docRef === 'GS-9'); assert.deepEqual([st.counted, ex.total], [false, 130_000]); assert.match(st.note, /counted at its issue/);
  assert.equal((await t.call(pm, 'GET', `/control/drill?projectId=${t.pid}&measure=NOPE`)).status, 400);
  const x = await t.api.raw('GET', `${S}/control/variance/export?projectId=${t.pid}&format=csv`, pm); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /Quantity variance/);
});

test('FR-06 section 9 a cost without a WBS node or cost code waits in the queue; QS or project controls propose, the project manager approves; the ledger row is not changed; reject and return', async () => {
  const t = await ready(); const un = async (who, q = '') => (await t.call(who, 'GET', `/control/unallocated${q}`)).json;
  await t.post('B-1', 'SUBCONTRACT_BILL', [{ lineId: '1', resourceType: 'SUBCONTRACT', qty: 1, amount: 70000 }]); await t.post('B-2', 'EXPENSE', [{ lineId: '1', wbsId: t.w2, resourceType: 'OTHER', qty: 1, amount: 3000 }]);
  let q = await un(qs); assert.equal(q.data.length, 2); const row = q.data.find((x) => x.doc === 'B-1'); assert.deepEqual([row.status, row.reason, row.amount, row.priority], ['OPEN', 'NO_WBS_NO_COST_CODE', '70000', 'MEDIUM']); assert.equal(q.data.find((x) => x.doc === 'B-2').reason, 'NO_COST_CODE');
  const f0 = (await t.facts(pm)); assert.equal(f0.totals.actual, 73_000, 'the cost is in the totals even before it is placed'); assert.deepEqual(f0.unallocated, { count: 2, amount: 73_000 });
  const orr = await t.call(qs, 'GET', `/control/unallocated/options?projectId=${t.pid}`); assert.equal(orr.status, 200, JSON.stringify(orr.json)); const o = orr.json.data; assert.ok(o.wbs.length === 2 && o.costCodes.length > 1);
  const sub = (who, id, body, k) => t.call(who, 'POST', `/control/unallocated/${id}/submit`, body, k);
  assert.equal((await sub(qs, row.id, {})).status, 400, 'both are needed'); assert.equal((await sub(qs, row.id, { wbsId: 999999, costCodeId: t.c1 })).status, 400, 'a WBS node of this project');
  assert.equal((await sub(se, row.id, { wbsId: t.w1, costCodeId: t.c1 })).status, 403, 'a site engineer does not see the queue'); assert.equal((await sub(pm, row.id, { wbsId: t.w1, costCodeId: t.c1 })).status, 403, 'the checker does not prepare');
  const k = key(); const s1 = await sub(qs, row.id, { wbsId: t.w1, costCodeId: t.c1, note: 'Foundation subcontract bill' }, k); assert.equal(s1.status, 202, JSON.stringify(s1.json)); assert.deepEqual([s1.json.data.status, s1.json.data.can.approve, s1.json.data.can.withdraw], ['SUBMITTED', false, true]);
  const again = await sub(qs, row.id, { wbsId: t.w1, costCodeId: t.c1, note: 'Foundation subcontract bill' }, k); assert.equal(again.status, 202); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM wf_instances WHERE doc_type = 'SITE_CTL_ALLOC'").get().n, 1, 'an idempotent replay');
  assert.equal((await sub(qs, row.id, { wbsId: t.w1, costCodeId: t.c1 })).status, 422, 'not sent twice'); const inst = s1.json.data.workflowInstanceId;
  assert.equal(await (async () => { const task = await t.taskOf(qs, inst); return task; })(), undefined, 'the proposer holds no task'); assert.ok(await t.taskOf(pm, inst), 'the project manager has it');
  const ev = await t.api.call('GET', `${W}/instances/${inst}/evidence`, { ...pm, headers: key() }); assert.ok([200, 404].includes(ev.status));
  // the ledger row is the owner's and does not change; the facts apply the approved allocation
  assert.equal((await t.act(pm, inst)).status, 200); t.drain();
  const done = (await t.call(qs, 'GET', `/control/unallocated/${row.id}`)).json.data; assert.deepEqual([done.status, done.approvedBy, done.allocatedTo.wbs.includes('Substructure')], ['ALLOCATED', 'gpm1', true]);
  const led = t.d.prepare("SELECT wbs_id, cost_code_id FROM bud_actuals WHERE src_id = 'B-1'").get(); assert.deepEqual({ ...led }, { wbs_id: null, cost_code_id: null }, 'the ledger of 12.03 is not changed');
  const f1 = await t.facts(pm); assert.equal(f1.unallocated.count, 1); assert.equal(f1.rows.find((x) => x.id === t.w1).actual, 70_000, 'the cost is now in the substructure'); assert.equal(f1.totals.actual, 73_000);
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM ctl_facts WHERE cost_code_id IS NULL AND actual_cost > 0").get().n, 1, 'only the one still unplaced has no cost code');
  assert.equal((await t.call(pcm, 'POST', '/control/reconciliation/run', { projectId: t.pid })).json.data.status, 'CLEAN', 'the reconciliation honours the allocation');
  // a rejection puts the cost back in the queue; a return lets the proposer correct it
  const b2 = (await un(pcm)).data.find((x) => x.doc === 'B-2'); const s2 = await sub(pcm, b2.id, { costCodeId: t.c2 }); assert.equal(s2.status, 202, JSON.stringify(s2.json)); assert.equal((await t.act(pm, s2.json.data.workflowInstanceId, 'return')).status, 200);
  assert.equal((await t.call(pcm, 'GET', `/control/unallocated/${b2.id}`)).json.data.status, 'RETURNED'); const s3 = await sub(pcm, b2.id, { costCodeId: t.c1 }); assert.equal(s3.status, 202, JSON.stringify(s3.json)); assert.equal((await t.act(pm2, s3.json.data.workflowInstanceId, 'reject')).status, 200);
  const back = (await t.call(pcm, 'GET', `/control/unallocated/${b2.id}`)).json.data; assert.deepEqual([back.status, back.allocWbsId, back.note.startsWith('Not approved')], ['OPEN', null, true]);
  const hist = (await t.call(pm, 'GET', `/control/unallocated/${row.id}/history`)).json.data; assert.ok(hist.approvals.length >= 2 && hist.audit.some((x) => x.action === 'submit') && hist.audit.some((x) => x.action === 'approve'));
  assert.equal((await t.call(qs, 'POST', `/control/unallocated/${b2.id}/withdraw`, { reason: 'Nothing sent' })).status, 422); const s4 = await sub(qs, b2.id, { costCodeId: t.c1 }); assert.equal(s4.status, 403, 'only the one who raised it sends the same cost again'); const s5 = await sub(pcm, b2.id, { costCodeId: t.c1 }); assert.equal(s5.status, 202, JSON.stringify(s5.json)); assert.equal((await t.call(qs, 'POST', `/control/unallocated/${b2.id}/withdraw`, { reason: 'Not mine to withdraw' })).status, 403); assert.equal((await t.call(pcm, 'POST', `/control/unallocated/${b2.id}/withdraw`, { reason: 'Wrong code, will send again' })).status, 200); assert.equal((await t.call(qs, 'GET', `/control/unallocated/${b2.id}`)).json.data.status, 'OPEN');
  // the source is reversed: a line still waiting clears
  await t.ledger(sys, { action: 'REVERSE', projectId: t.pid, sourceType: 'EXPENSE', sourceId: 'B-2', lines: [] }); assert.equal((await t.call(qs, 'GET', `/control/unallocated/${b2.id}`)).json.data.status, 'CLEARED'); assert.equal((await t.facts(pm)).unallocated.count, 0);
  assert.equal((await t.api.call('GET', '/api/v1/ui/lists/site.control_unallocated', { ...qs })).status, 200); assert.equal((await t.api.call('GET', `/api/v1/site/control/unallocated?filter[status]=ALLOCATED`, { ...qs })).json.data.length, 1, 'the list filters');
});

test('AC-03 AC-04 roles and isolation: who sees and does what; another company gets nothing; the flag gates the routes; there is no way to write a fact', async () => {
  const t = await ready(); await t.post('GD-3', 'GRN_DIRECT', [{ lineId: '1', wbsId: t.w1, costCodeId: t.c1, resourceType: 'MATERIAL', qty: 10, amount: 5000 }]);
  for (const who of [pcm, pm, pd, dir, qs, cfo, aud]) { const r = await t.call(who, 'GET', `/control/facts?projectId=${t.pid}`); assert.equal(r.status, 200, `${who.user}: ${JSON.stringify(r.json)}`); assert.equal(r.json.data.totals.actual, 5000); assert.equal((await t.call(who, 'GET', `/control/dashboard?projectId=${t.pid}`)).status, 200); assert.equal((await t.call(who, 'GET', `/control/variance?projectId=${t.pid}`)).status, 200); }
  assert.equal((await t.call(se, 'GET', `/control/facts?projectId=${t.pid}`)).status, 403); assert.equal((await t.call(plan1, 'GET', `/control/dashboard?projectId=${t.pid}`)).status, 403); assert.equal((await t.call(se, 'GET', '/control/unallocated')).status, 403);
  // exports: project controls, project manager, project director and audit; the quantity surveyor and finance read only
  for (const [who, st] of [[pcm, 200], [pm, 200], [pd, 200], [aud, 200], [qs, 403], [cfo, 403], [dir, 403]]) assert.equal((await t.call(who, 'GET', `/control/variance/export?projectId=${t.pid}&format=csv`)).status, st, who.user);
  // reconciliation on request: project controls and the project manager
  assert.equal((await t.call(qs, 'POST', '/control/reconciliation/run', { projectId: t.pid })).status, 403); assert.equal((await t.call(pd, 'POST', '/control/refresh', { projectId: t.pid })).status, 403); assert.equal((await t.call(pm, 'POST', '/control/reconciliation/run', { projectId: t.pid })).status, 201);
  // the facts have no write route: BR-01 the engine never accepts a manual override
  for (const [m, p] of [['POST', '/control/facts'], ['PUT', '/control/facts'], ['PATCH', `/control/facts/1`], ['DELETE', '/control/facts/1'], ['POST', '/control/drill']]) assert.ok([404, 405].includes((await t.call(pm, m, p, { actualCost: 1 })).status), `${m} ${p}`);
  // another company and a bad project
  assert.equal((await t.call(other, 'GET', `/control/facts?projectId=${t.pid}`)).status, 404); assert.equal((await t.call(other, 'GET', `/control/dashboard?projectId=${t.pid}`)).status, 404); assert.equal((await t.call(other, 'GET', '/control/unallocated')).json?.data?.length ?? 0, 0); assert.equal((await t.call(pm, 'GET', '/control/facts?projectId=999999')).status, 404); assert.equal((await t.call(pm, 'GET', '/control/facts')).status, 400);
  assert.equal((await t.call(qs2, 'GET', `/control/projects`)).json.data.length, 1); assert.equal((await t.call(se, 'GET', `/control/projects`)).status, 403);
  // the feature flag
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1407'").run(); assert.equal((await t.call(pm, 'GET', `/control/facts?projectId=${t.pid}`)).status, 404);
});
