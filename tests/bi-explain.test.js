import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { explainOf } from '../src/server/modules/bi/explain.js';

// Part 27.08: "Why?" variance explainability and the drill-down.
// T-01 the decomposition sums to the total on test data (components + explicit residual = total) for cost, schedule and margin;
// FR-01 the cost variance splits into material quantity / rate, labour productivity / rate, plant, scope / variation and delay;
// FR-02 the drill-down walks company → project → WBS → activity → BOQ and resource → transaction → document → audit with its breadcrumb;
// FR-03 every explanation is labelled deterministic and names its method; roles and project scope; flag off is 404; export.
const X = '/api/v1/bi/explain';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `ex-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'xplan1'); const pm = as('PM', 'xpm1'); const pcm = as('PCMGR', 'xpcm1'); const qs = as('QS', 'xqs1'); const dir = as('DIR', 'xdir1'); const se = as('SE', 'xse1'); const sys = as('SYSADM', 'sysadmin');
const day = (n) => isoOf(ordOf(todayIST()) - n); const TODAY = todayIST();
const sum = (list) => Math.round(list.reduce((n, c) => n + c.amount * 100, 0)) / 100;

async function boot({ flag = true } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['xplan1', 'PLAN'], ['xpm1', 'PM'], ['xpm2', 'PM'], ['xpcm1', 'PCMGR'], ['xqs1', 'QS'], ['xdir1', 'DIR'], ['xse1', 'SE'], ['sysadmin', 'SYSADM']]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  const fl = d.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Explainer fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', ...(flag ? ['ff.bi.p2708'] : [])]) fl.run(code);
  d.exec("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)");
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'WHY', 'Why Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const other = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'WHY2', 'Other Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'WHY-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const w1 = Number(d.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '1', 'Substructure', 1, 't')").run(pid).lastInsertRowid);
  const w2 = Number(d.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '2', 'Superstructure', 1, 't')").run(pid).lastInsertRowid);
  const pcall = (who, method, path, body) => api.call(method, `/api/v1/plan${path}`, { ...who, headers: key(), body });
  const cal = await pcall(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const sch = await pcall(plan1, 'POST', '/schedules', { projectId: pid, name: 'Tower schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' }); const sid = sch.json.data.id;
  const imp = await pcall(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 20 }, { code: 'A20', name: 'Raft concrete', duration: 10, predecessors: 'A10' }, { code: 'M1', name: 'Raft complete', duration: 1, predecessors: 'A20' }] }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); await pcall(plan1, 'POST', `/schedules/${sid}/calculate`);
  const a = Object.fromEntries(d.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ?').all(sid).map((x) => [x.code, x.id]));
  d.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3', wbs_id = ? WHERE id = ?").run(w1, a.A10); d.prepare("UPDATE plan_activities SET qty = 50000, uom = 'm3', wbs_id = ? WHERE id = ?").run(w2, a.A20); d.prepare("UPDATE plan_activities SET act_type = 'MILESTONE', duration_days = 0, wbs_id = ? WHERE id = ?").run(w2, a.M1);
  d.prepare("UPDATE plan_schedules SET status = 'APPROVED', start_date = ? WHERE id = ?").run(day(9), sid);
  const codes = d.prepare('SELECT id FROM fin_cost_codes ORDER BY id LIMIT 3').all().map((x) => x.id);
  // budget: material Rs 6,00,000 for 600 units on the substructure; labour Rs 4,00,000 for 400 units and plant Rs 1,00,000 for 100 hours on the superstructure
  const bud = Number(d.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, name, status, created_by, source_type) VALUES (1, 'BUD/1', ?, ?, 'Budget', 'APPROVED', 't', 'test')").run(day(30), pid).lastInsertRowid);
  const bl = d.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, cost_code_id, resource_type, resource_name, qty, amount, created_by, source_type) VALUES (1, ?, 'DIRECT', ?, ?, ?, ?, ?, ?, 't', 'test')");
  bl.run(bud, w1, codes[0], 'MATERIAL', 'Concrete', 600000, 60_000_000); bl.run(bud, w2, codes[1], 'LABOUR', 'Gangs', 400000, 40_000_000); bl.run(bud, w2, codes[2], 'EQUIPMENT', 'Crane', 100000, 10_000_000);
  const snap = { v: 1, activities: [{ code: 'A10', start: day(9), finish: isoOf(ordOf(TODAY) + 10) }, { code: 'A20', start: day(4), finish: isoOf(ordOf(TODAY) + 5) }, { code: 'M1', start: day(3), finish: day(3) }] };
  d.prepare("INSERT INTO plan_baselines (company_id, doc_no, doc_date, org_project_id, schedule_id, baseline_no, name, reason, snapshot_json, snapshot_hash, status, is_current, created_by, source_type) VALUES (1, 'BL/1', ?, ?, ?, 0, 'Baseline', 'Original', ?, 'h', 'APPROVED', 1, 't', 'test')").run(day(20), pid, sid, JSON.stringify(snap));
  d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'xpm1', 100000000, '2026-01-01', '2026-12-31', 'test')").run(pid);
  const boq = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status) VALUES (1, 'BOQ/1', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED')").run(pid).lastInsertRowid);
  const line = Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount) VALUES (1, ?, 'ITEM', '2.1', 'Excavation in soil', 'm3', 100000, 5000000, 50000000)").run(boq).lastInsertRowid);
  d.prepare('INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty) VALUES (1, ?, ?, 100000)').run(a.A10, line);
  const drain = () => runtimeOf(api.db).bus.drain();
  // A10 half done, A20 20 % done (an approved DPR as its event)
  d.prepare("INSERT INTO site_dprs (id, company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, status, requested_by, project_id, site_id, created_by) VALUES (900001, 1, 'DPR/900001', ?, ?, ?, 'x', 'SITE', 'SUPERSEDED', 'x', ?, ?, 't')").run(pid, site, TODAY, pid, site);
  publishEvent(api.db, { type: 'site.dpr.approved', entity: 'site_dpr', entityId: 900001, actorId: 'cm', companyId: 1, projectId: pid, siteId: site, data: { dprId: 900001, docNo: 'DPR/900001', projectId: pid, siteId: site, date: TODAY, scope: 'SITE', supersedes: null, work: [{ activityId: a.A10, qty: 50, uom: 'm3' }, { activityId: a.A20, qty: 10, uom: 'm3' }] } }); drain();
  d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(isoOf(ordOf(TODAY) + 12), a.A10); d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(isoOf(ordOf(TODAY) + 9), a.A20);
  // an approved DPR yesterday with 6 idle and 2 breakdown crane hours (delay-related plant cost)
  const dpr2 = Number(d.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (1, 'DPR/2', ?, ?, ?, 'x', 'APPROVED')").run(pid, site, day(1)).lastInsertRowid);
  d.prepare("INSERT INTO site_dpr_equipment (company_id, dpr_id, equipment_key, label, hours_worked, hours_idle, hours_breakdown) VALUES (1, ?, 'CR-1', 'Tower crane', 4000, 6000, 2000)").run(dpr2);
  const ledger = async (body) => { const r = await api.call('POST', '/api/v1/bud/ingest/actual', { ...sys, headers: key(), body }); assert.equal(r.status, 201, JSON.stringify(r.json)); drain(); return r.json.data; };
  const post = (id, sourceType, lines) => ledger({ action: 'POST', projectId: pid, sourceType, sourceId: id, docRef: id, vendorRef: 'V-1', vendorName: 'Shree Traders', date: TODAY, lines });
  await post('GD-1', 'GRN_DIRECT', [{ lineId: '1', wbsId: w1, costCodeId: codes[0], resourceType: 'MATERIAL', qty: 200, amount: 130000 }]);
  await post('WG-1', 'WAGE', [{ lineId: '1', wbsId: w2, costCodeId: codes[1], resourceType: 'LABOUR', qty: 100, amount: 120000 }]);
  await post('PL-1', 'PLANT_LOG', [{ lineId: '1', wbsId: w2, costCodeId: codes[2], resourceType: 'EQUIPMENT', qty: 30, amount: 36000 }]);
  await post('VO-1', 'AP_BILL', [{ lineId: '1', wbsId: w1, costCodeId: codes[1], resourceType: 'OTHER', qty: 1, amount: 25000 }]);
  // two approved CVRs for the margin bridge
  const cvr = d.prepare("INSERT INTO bill_cvr_reports (company_id, doc_no, org_project_id, period, as_of, status, value_paise, cost_paise, margin_paise, margin_bp, value_lines_json, expense_lines_json) VALUES (1, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?, ?)");
  const lines = (o) => JSON.stringify(Object.entries(o).map(([k, amount]) => ({ key: k, label: k.toLowerCase(), amount })));
  cvr.run('CVR/1', pid, '2026-09', '2026-09-30', 100_000_00, 85_000_00, 15_000_00, 1500, lines({ CERTIFIED: 90_000_00, WIP: 10_000_00 }), lines({ MATERIAL: 50_000_00, LABOUR: 35_000_00 }));
  cvr.run('CVR/2', pid, '2026-10', '2026-10-31', 130_000_00, 118_000_00, 12_000_00, 923, lines({ CERTIFIED: 115_000_00, WIP: 12_000_00, VARIATION: 3_000_00 }), lines({ MATERIAL: 70_000_00, LABOUR: 40_000_00, PLANT: 8_000_00 }));
  const get = (who, path) => api.call('GET', X + path, who);
  return { api, d, get, pid, other, site, w1, w2, a, line, codes };
}

test('T-01 FR-01 FR-03 BR-01 the cost, schedule and margin decompositions sum to the total with an explicit residual', async () => {
  const t = await boot();
  const r = await t.get(pm, `/why?projectId=${t.pid}&kpi=cost`); assert.equal(r.status, 200, JSON.stringify(r.json)); const c = r.json.data;
  assert.equal(c.method, 'DETERMINISTIC'); assert.equal(c.narrative, null, 'FR-03 the AI narrative is optional and absent');
  assert.ok(c.components.length >= 4, JSON.stringify(c.components));
  assert.equal(Math.round((sum(c.components) + c.residual) * 100) / 100, c.total, 'T-01 components + residual = total');
  assert.ok(c.check.balanced);
  const by = Object.fromEntries(c.components.map((x) => [x.key, x.amount]));
  // material: earned 3,00,000 (300 units at 1,000) against 200 units bought for 1,30,000: quantity (300-200)×1,000 = 1,00,000; rate (1,000-650)×200 = 70,000
  assert.equal(by.MATERIAL_QUANTITY, 100_000); assert.equal(by.MATERIAL_RATE, 70_000);
  assert.ok(by.LABOUR_PRODUCTIVITY !== undefined && by.LABOUR_RATE !== undefined, 'labour splits into productivity and rate');
  assert.equal(by.SCOPE_VARIATION, -25_000, 'the unbudgeted cost is scope / variation, not a rate effect');
  assert.equal(by.DELAY, -8_000, '8 idle and breakdown hours × the budget plant rate of 1,000');
  for (const x of c.components) { assert.ok(x.method && x.label && x.drill, `component ${x.key} is labelled and drillable`); }
  assert.equal(c.total, c.figures.earned - c.figures.actual, 'the total is the cost variance of the control facts');
  assert.deepEqual(c.breadcrumb.map((b) => b.level), ['company', 'project']);
  // schedule: by activity contribution
  const s = (await t.get(pm, `/why?projectId=${t.pid}&kpi=schedule`)).json.data;
  assert.equal(Math.round((sum(s.components) + s.residual) * 100) / 100, s.total, 'T-01 schedule components + residual = total');
  assert.ok(s.components.some((x) => x.key === 'ACT_A20'), JSON.stringify(s.components));
  // margin bridge CVR/1 → CVR/2: 15,000 → 12,000 = −3,000 (value +25,000 +2,000 +3,000; cost −20,000 −5,000 −8,000)
  const m = (await t.get(pm, `/why?projectId=${t.pid}&kpi=margin`)).json.data;
  assert.equal(m.total, -3_000); assert.equal(m.residual, 0); assert.equal(sum(m.components), -3_000);
  assert.equal(m.components.find((x) => x.key === 'COST_PLANT').amount, -8_000); assert.equal(m.components.find((x) => x.key === 'VALUE_VARIATION').amount, 3_000);
  // with a margin figure that does not match its lines, the residual carries the difference
  t.d.prepare("UPDATE bill_cvr_reports SET margin_paise = margin_paise + 50000 WHERE doc_no = 'CVR/2'").run();
  const m2 = (await t.get(pm, `/why?projectId=${t.pid}&kpi=margin`)).json.data; assert.equal(m2.residual, 500); assert.equal(Math.round((sum(m2.components) + m2.residual) * 100) / 100, m2.total);
  // export
  const e = await t.api.raw('GET', `${X}/why/export?projectId=${t.pid}&kpi=cost&format=csv`, pm); assert.equal(e.status, 200); const csv = e.buffer.toString('utf8'); assert.match(csv, /Residual/); assert.match(csv, /Material quantity/);
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'report' AND entity_id = 'bi.explain' AND action = 'export'").get(), 'the export is audited');
});

test('FR-02 the drill-down walks company → project → WBS → activity → BOQ and resource → transaction → document → audit, with the breadcrumb', async () => {
  const t = await boot();
  const top = (await t.get(pm, '/drill')).json.data; assert.equal(top.level, 'company'); assert.ok(top.children.some((x) => x.level === 'project' && x.id === String(t.pid)));
  const p = (await t.get(pm, `/drill?level=project&id=${t.pid}`)).json.data; assert.deepEqual(p.breadcrumb.map((b) => b.level), ['company', 'project']);
  assert.ok(p.children.some((x) => x.level === 'site')); assert.ok(p.children.some((x) => x.level === 'wbs' && x.figures?.budget === 600_000)); assert.ok(p.children.some((x) => x.level === 'resource' && x.id === 'MATERIAL'));
  const w = (await t.get(pm, `/drill?level=wbs&id=${t.w1}`)).json.data; assert.deepEqual(w.breadcrumb.map((b) => b.level), ['company', 'project', 'wbs']);
  const act = w.children.find((x) => x.level === 'activity'); assert.ok(act, JSON.stringify(w.children)); assert.ok(w.children.some((x) => x.level === 'txn'), 'the transactions under the WBS');
  const ac = (await t.get(pm, `/drill?level=activity&id=${act.id}`)).json.data; assert.deepEqual(ac.breadcrumb.map((b) => b.level), ['company', 'project', 'wbs', 'activity']);
  const b = ac.children.find((x) => x.level === 'boq'); assert.equal(b.id, String(t.line));
  const bq = (await t.get(pm, `/drill?level=boq&id=${b.id}`)).json.data; assert.deepEqual(bq.breadcrumb.map((x) => x.level), ['company', 'project', 'boq']);
  const res = (await t.get(pm, `/drill?level=resource&id=MATERIAL&projectId=${t.pid}`)).json.data; assert.deepEqual(res.breadcrumb.map((x) => x.level), ['company', 'project', 'resource']);
  const tx = res.children.find((x) => x.level === 'txn'); assert.ok(tx); assert.match(tx.label, /GD-1/);
  const txn = (await t.get(pm, `/drill?level=txn&id=${tx.id}`)).json.data; assert.deepEqual(txn.breadcrumb.map((x) => x.level), ['company', 'project', 'wbs', 'txn']);
  assert.ok(txn.children.some((x) => x.level === 'document'), 'the source document of the transaction');
  // a document and its audit trail (any registered record: the site DPR)
  const doc = await t.get(pm, `/drill?level=document&id=900001&entity=site_dpr&txnId=${tx.id}`);
  if (doc.status === 200) {
    assert.deepEqual(doc.json.data.breadcrumb.map((x) => x.level).slice(-2), ['txn', 'document']);
    const au = (await t.get(pm, `/drill?level=audit&id=900001&entity=site_dpr&txnId=${tx.id}`)).json.data; assert.equal(au.breadcrumb.at(-1).level, 'audit');
  } else assert.fail(`the DPR document drill answered ${doc.status}: ${JSON.stringify(doc.json)}`);
  assert.equal((await t.get(pm, '/drill?level=nowhere')).status, 400);
});

test('roles, scope and the flag: dashboard users only, within their projects; the owner\'s rights still apply; flag off is 404', async () => {
  const t = await boot();
  assert.equal((await t.get(se, `/why?projectId=${t.pid}`)).status, 403, 'a site engineer is not a dashboard user here');
  assert.equal((await t.get(dir, `/why?projectId=${t.pid}&kpi=cost`)).status, 200, 'the director reads it');
  assert.equal((await t.get(qs, `/why?projectId=${t.pid}&kpi=margin`)).status, 200);
  const pl = await t.get(plan1, `/why?projectId=${t.pid}&kpi=cost`); assert.equal(pl.status, 403, 'the planner holds the explainer but the control facts refuse costs'); assert.match(pl.json.error.message, /owning module/);
  // a PM assigned to the other project only: the explainer and the drill-down see only that project
  const d = t.d; authzOf(d).seed();
  const userId = d.prepare("SELECT id FROM iam_users WHERE username = 'xpm2'").get().id;
  d.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`).run(userId, JSON.stringify([t.other]));
  authzOf(d).invalidate();
  const scoped = authzOf(d).enrich({ companyId: 1, userId, user: 'xpm2', roles: [] });
  const svc = explainOf(t.api.db);
  assert.throws(() => svc.why(scoped, { projectId: t.pid, kpi: 'cost' }), { status: 404 }, 'another project is not named');
  assert.throws(() => svc.drill(scoped, { level: 'project', id: String(t.pid) }), { status: 404 });
  assert.throws(() => svc.drill(scoped, { level: 'wbs', id: String(t.w1) }), { status: 404 });
  assert.deepEqual(svc.drill(scoped, { level: 'company' }).children.map((c) => c.id), [String(t.other)]);
  const off = await boot({ flag: false });
  assert.equal((await off.get(pm, `/why?projectId=${off.pid}`)).status, 404, 'flag off');
  assert.equal((await off.get(pm, '/drill')).status, 404);
});
