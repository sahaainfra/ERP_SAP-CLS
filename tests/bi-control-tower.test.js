import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { readDomainMetric } from '../src/server/modules/bi/domain-metrics.js';
import { towerOf, healthOf, currentSettings, RULES } from '../src/server/modules/bi/control-tower.js';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 27.04: the enterprise control tower, the executive dashboard and the executive alerts. T-01 every tile reconciles to the certified
// metric catalogue (27.03); BR-01 an uncertified metric shows no figure; FR-02 the health matrix and its filters; FR-03 the early-warning rules
// raise one alert per breach with an owner, a task and a notification, clear themselves and never repeat the same evidence; FR-04 the drill
// from the company to the project and its source records; roles and scope; 403, 409, idempotent replay; maker-checker on the thresholds.
const B = '/api/v1/bi';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `ct-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const dir = as('DIR', 'ct-dir1'); const dir2 = as('DIR', 'ct-dir2'); const cfo = as('CFO', 'ct-cfo'); const pcm = as('PCMGR', 'ct-pcm');
const pd = as('PD', 'ct-pd'); const qs = as('QS', 'ct-qs'); const reviewer = as('CFO', 'ct-reviewer');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shift = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  const { db } = api;
  for (const [n, r] of [['ct-dir1', 'DIR'], ['ct-dir2', 'DIR'], ['ct-cfo', 'CFO'], ['ct-pcm', 'PCMGR'], ['ct-pd', 'PD'], ['ct-qs', 'QS'], ['ct-reviewer', 'CFO'], ['ct-pm', 'PM']]) {
    db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  }
  const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Control tower fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.site.p1405', 'ff.fin.p2311', 'ff.fin.p2312', 'ff.hse.p1908', 'ff.fin.p2313']) flag.run(code);
  db.exec(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)`);
  const region = Number(db.prepare("INSERT INTO org_branches (company_id, kind, code, name) VALUES (1, 'REGION', 'SOUTH', 'South region')").run().lastInsertRowid);
  const project = (code, sector, branch) => {
    const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, branch_id) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', ?)").run(code, `${code} highway`, branch).lastInsertRowid);
    db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, sector, pm_user, director_user) VALUES (1, ?, 'APPROVED', 'EXECUTION', ?, 'ct-pm', 'ct-pd')").run(id, sector);
    return id;
  };
  const A = project('CT-A', 'ROADS', region);
  const Bp = project('CT-B', 'BUILDINGS', null);
  const today = todayIST();
  const current = today.slice(0, 7);
  const last = shift(current, -1);
  const prior = shift(current, -2);
  const period = db.prepare("INSERT INTO prs_periods (company_id, doc_no, org_project_id, period_type, period_start, period_end, status) VALUES (1, ?, ?, 'MONTH', ?, ?, 'APPROVED')");
  const evm = db.prepare('INSERT INTO prs_evm (company_id, org_project_id, period_id, period_end, spi, cpi) VALUES (1, ?, ?, ?, ?, ?)');
  const addPeriod = (doc, id, ym, spi, cpi, end = monthEnd(ym)) => { const row = period.run(doc, id, `${ym}-01`, end); evm.run(id, row.lastInsertRowid, end, spi, cpi); return Number(row.lastInsertRowid); };
  const periodA = addPeriod('CT-PR-A', A, last, 8000, 9500);
  addPeriod('CT-PR-B', Bp, last, 9700, 8800);
  const forecast = db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, eac_total_paise, status) VALUES (1, ?, ?, ?, 1, ?, 'APPROVED')");
  forecast.run('CT-FC-A', A, last, 1_100_000_000);
  forecast.run('CT-FC-B', Bp, last, 500_000_000);
  const pl = db.prepare("INSERT INTO pl_snapshots (company_id, doc_no, org_project_id, period, revenue_paise, gross_profit_paise, revenue_cum_paise, status, frozen_at) VALUES (1, ?, ?, ?, ?, ?, ?, 'APPROVED', ?)");
  pl.run('CT-PL-A', A, last, 10_000_000, 2_000_000, 200_000_000, `${today}T00:00:00Z`);
  pl.run('CT-PL-B', Bp, last, 10_000_000, 1_000_000, 50_000_000, `${today}T00:00:00Z`);
  // last month's capture (27.03): SPI 0.85 and EAC ₹1 crore for project A, from an earlier source period
  const refresh = db.prepare("INSERT INTO bi_domain_refreshes (company_id, metric_code, dataset_version, period, captured_at, row_count, created_by) VALUES (1, ?, 1, ?, ?, 1, 'fixture')");
  const observe = db.prepare("INSERT INTO bi_domain_observations (company_id, refresh_id, project_id, value_scaled, source_period, source_version, created_by, source_type, source_id) VALUES (1, ?, ?, ?, ?, 1, 'fixture', ?, '0')");
  observe.run(refresh.run('spi', last, `${last}-02T00:00:00Z`).lastInsertRowid, A, 8500, monthEnd(prior), 'prs_periods');
  observe.run(refresh.run('eac', last, `${last}-02T00:00:00Z`).lastInsertRowid, A, 1_000_000_000, prior, 'fc_forecasts');
  // a lost-time injury on project A
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'CT-A-S1', 'Camp', 'ACTIVE')").run(A).lastInsertRowid);
  db.prepare("INSERT INTO att_daily (company_id, person_id, work_date, daily_site_id, status, worked_minutes, computed_at) VALUES (1, 1, ?, ?, 'PRESENT', 60000, CURRENT_TIMESTAMP)").run(today, site);
  db.prepare("INSERT INTO hse_incidents (company_id, doc_no, org_project_id, org_site_id, incident_type, classification, severity, occurred_at, description, reported_by, incident_status) VALUES (1, 'CT-LTI', ?, ?, 'INJURY', 'LTI', 'HIGH', ?, 'Fixture injury', 'fixture', 'REPORTED')").run(A, site, `${today}T09:00`);
  const get = (who, path) => api.call('GET', B + path, who);
  const post = (who, path, body, k = key()) => api.call('POST', B + path, { ...who, body, headers: k });
  const certify = async (code) => {
    const request = await post(pcm, '/metrics/certifications', { code, certify: true, reason: 'Checked against the approved source' });
    assert.equal(request.status, 201, JSON.stringify(request.json));
    const decided = await post(reviewer, `/metrics/certifications/${request.json.data.id}/act`, { action: 'approve', version: request.json.data.version });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
  };
  const drain = async () => { const rt = runtimeOf(db); for (let i = 0; i < 10; i += 1) { rt.bus.relayOnce(500); rt.bus.deliverOnce(500); } };
  const runJob = async (id) => { const { jobs } = runtimeOf(db); for (let i = 0; i < 20 && jobs.get(id).status === 'QUEUED'; i += 1) await jobs.runNext(); assert.equal(jobs.get(id).status, 'SUCCEEDED', JSON.stringify(jobs.get(id))); return jobs.get(id); };
  return { api, db, A, Bp, region, periodA, last, current, today, get, post, certify, drain, runJob, addPeriod };
}

test('27.04 control tower: certified tiles reconcile to the metric catalogue, the health matrix and the drill path', async () => {
  const t = await setup();
  const { db, A, Bp } = t;
  assert.equal((await t.get(dir, '/control-tower')).status, 404, 'the part is behind ff.bi.p2704');
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2704', 1, 'Control tower fixture', 0, 1)").run();
  assert.equal((await t.get(qs, '/control-tower')).status, 403, 'a quantity surveyor has no control tower');

  // BR-01: before certification no tile shows a figure
  const before = await t.get(dir, '/control-tower');
  assert.equal(before.status, 200, JSON.stringify(before.json));
  assert.ok(before.json.data.tiles.filter((tile) => tile.state !== 'UNAVAILABLE').every((tile) => tile.state === 'UNCERTIFIED' && tile.value === null));
  assert.deepEqual(before.json.data.matrix.rows.map((row) => row.code), ['CT-A', 'CT-B']);
  assert.ok(before.json.data.matrix.rows.every((row) => row.metrics.spi === null), 'no uncertified values reach the matrix');

  for (const code of ['spi', 'cpi', 'eac', 'gross-margin', 'revenue-to-date', 'ltifr']) await t.certify(code);
  const res = await t.get(dir, '/control-tower');
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const d = res.json.data;
  assert.ok(Date.parse(d.evaluatedAt) && d.lastCapturedAt, 'BR-01: the time of the last refresh is shown');

  // T-01: each tile equals the catalogue's own values for the projects in the matrix
  const context = { db, flags: createFlagService({ db, environment: 'test' }) };
  const actor = authzOf(db).enrich({ companyId: 1, user: 'ct-dir1', roles: ['DIR'] });
  for (const tile of d.tiles.filter((x) => x.state === 'OK')) {
    const values = [A, Bp].map((id) => readDomainMetric(context, actor, tile.metric, { projectId: id, includeHistory: false }).live?.value).filter((v) => v != null);
    const expected = tile.aggregate === 'sum' ? values.reduce((a, b) => a + b, 0) : values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(Math.abs(tile.value - expected) < 1e-6, `${tile.key}: tile ${tile.value} equals catalogue ${expected}`);
    assert.equal(tile.certified, true);
  }
  const tile = (k) => d.tiles.find((x) => x.key === k);
  assert.equal(tile('eac').value, 16_000_000);
  assert.equal(tile('revenue').value, 2_500_000);
  assert.equal(tile('spi').value, 0.885);
  assert.equal(tile('spi').tone, 'error', 'mean SPI 0.885 is below the 0.9 threshold');
  assert.equal(tile('spi').target, 0.9);
  assert.equal(tile('margin').value, 15);
  assert.equal(tile('dso').state, 'UNCERTIFIED', 'DSO is not certified in this fixture');
  assert.equal(tile('dso').value, null);

  // FR-02: the RAG of each project
  const rowA = d.matrix.rows.find((row) => row.code === 'CT-A');
  const rowB = d.matrix.rows.find((row) => row.code === 'CT-B');
  assert.deepEqual({ ...rowA.health, eacGrowth: undefined }, { time: 'RED', cost: 'RED', quality: 'NONE', safety: 'RED', cash: 'NONE', overall: 'RED', eacGrowth: undefined });
  assert.equal(rowA.health.eacGrowth, 10);
  assert.deepEqual([rowB.health.time, rowB.health.cost, rowB.health.safety], ['GREEN', 'RED', 'NONE']);
  assert.equal(rowA.metrics.spi.sourceRoute, `/site/periods?id=${t.periodA}`);
  assert.equal(d.distribution.RED, 2);
  // filters: region, sector, PM and RAG
  assert.deepEqual((await t.get(dir, `/control-tower?regionId=${t.region}`)).json.data.matrix.rows.map((row) => row.code), ['CT-A']);
  assert.deepEqual((await t.get(dir, '/control-tower?sector=BUILDINGS')).json.data.matrix.rows.map((row) => row.code), ['CT-B']);
  assert.equal((await t.get(dir, '/control-tower?pm=nobody')).json.data.matrix.total, 0);
  assert.deepEqual((await t.get(dir, '/control-tower?dimension=time&dimensionRag=GREEN')).json.data.matrix.rows.map((row) => row.code), ['CT-B']);
  const filtered = (await t.get(dir, '/control-tower?sector=BUILDINGS')).json.data;
  assert.equal(filtered.tiles.find((x) => x.key === 'eac').value, 5_000_000, 'tiles follow the filters');
  assert.equal((await t.get(dir, '/control-tower?rag=PURPLE')).status, 400);

  // FR-04: company → project → source record
  const drill = await t.get(dir, `/control-tower/projects/${A}`);
  assert.equal(drill.status, 200, JSON.stringify(drill.json));
  assert.equal(drill.json.data.metrics.find((m) => m.code === 'spi').sourceRoute, `/site/periods?id=${t.periodA}`);
  assert.equal(drill.json.data.metrics.find((m) => m.code === 'spi').history[0].value, 0.85);
  assert.equal(drill.json.data.wbs.periodId, t.periodA, 'the WBS level comes from the progress period behind the SPI');
  assert.equal(drill.json.data.project360, `/proj/project-360?projectId=${A}`);

  // masking: the director has no stock values; the CFO sees cash, the PD does not see the company cash
  assert.equal(d.cashMasked, false);

  // export honours the same figures and is audited; formula injection is neutralised by the shared writer
  const csv = await t.api.raw('GET', `${B}/control-tower/export?format=csv`, dir);
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString('utf8'), /CT-A/);
  assert.equal(csv.headers.get('x-export-rows'), '2');
  assert.ok(db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'report' AND entity_id = 'bi.control_tower' AND action = 'export'").get());
  assert.equal((await t.api.raw('GET', `${B}/control-tower/export?format=csv`, qs)).status, 403);
  assert.equal((await t.api.raw('GET', `${B}/control-tower/export?format=xlsx`, pcm)).status, 200);
});

test('27.04 early warnings raise owned alerts with tasks, clear themselves, respect scope and settle with locking and replay', async () => {
  const t = await setup();
  const { db, A, Bp } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2704', 1, 'Control tower fixture', 0, 1)").run();
  for (const code of ['spi', 'cpi', 'eac', 'ltifr']) await t.certify(code);
  assert.equal((await t.post(pd, '/exec-alerts/evaluations', {})).status, 403, 'the PD does not run the checks');
  const queued = await t.post(dir, '/exec-alerts/evaluations', {});
  assert.equal(queued.status, 202, JSON.stringify(queued.json));
  const job = await t.runJob(queued.json.data.id);
  assert.equal(job.result.raised, 3, JSON.stringify(job.result));
  assert.deepEqual(job.result.skipped.map((s) => s.rule).sort(), ['CASH_NEGATIVE', 'COLLECTIONS_OVERDUE'], 'uncertified or unpublished sources are skipped, not guessed');
  const list = await t.get(dir, '/exec-alerts?status=ACTIVE');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const codes = list.json.data.rows.map((row) => `${row.ruleCode}:${row.projectId}`).sort();
  assert.deepEqual(codes, [`EAC_GROWTH:${A}`, `LTI:${A}`, `SPI_LOW:${A}`], 'SPI 0.80 then 0.85 for two periods, EAC +10 %, an LTI; CPI of B needs two periods');
  const spi = list.json.data.rows.find((row) => row.ruleCode === 'SPI_LOW');
  assert.equal(spi.severity, 'CRITICAL');
  assert.equal(spi.owner, 'ct-pm', 'the project manager owns the alert');
  assert.ok(spi.taskId, 'a task was made');
  const task = db.prepare('SELECT * FROM tsk_tasks WHERE id = ?').get(spi.taskId);
  assert.equal(task.source_type, 'exec_alert');
  assert.equal(db.prepare("SELECT user_ref FROM tsk_assignees WHERE task_id = ? AND role = 'ASSIGNEE'").get(spi.taskId).user_ref, 'ct-pm');
  assert.ok(db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bi.exec_alert.raised'").get(), 'the event is published through the outbox');
  assert.ok(db.prepare("SELECT 1 FROM ntf_notifications WHERE source_type = 'exec_alert' AND source_id = ?").get(String(spi.id)), 'the owner is notified');

  // the same breach is not raised twice
  const tower = towerOf(db);
  const again = tower.evaluate(1, 'test');
  assert.deepEqual([again.raised, again.refreshed], [0, 3]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM exec_alerts').get().n, 3);

  // acknowledge: 409 on a stale version, idempotent replay with the same key
  assert.equal((await t.post(dir, `/exec-alerts/${spi.id}/act`, { action: 'acknowledge', version: spi.version + 5 })).status, 409);
  const k = key();
  const ack = await t.post(dir, `/exec-alerts/${spi.id}/act`, { action: 'acknowledge', version: spi.version }, k);
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  const replay = await t.post(dir, `/exec-alerts/${spi.id}/act`, { action: 'acknowledge', version: spi.version }, k);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.json.data, ack.json.data, 'the replay returns the first answer');
  assert.equal(db.prepare('SELECT version FROM exec_alerts WHERE id = ?').get(spi.id).version, spi.version + 1);

  // the condition clears: a new approved period with SPI 0.95 resolves the alert by itself and completes the task
  t.addPeriod('CT-PR-A2', A, t.current, 9500, 9600, t.today);
  const cleared = tower.evaluate(1, 'test');
  assert.equal(cleared.resolved, 1);
  const resolved = db.prepare('SELECT * FROM exec_alerts WHERE id = ?').get(spi.id);
  assert.deepEqual([resolved.status, resolved.resolved_by], ['RESOLVED', 'system']);
  assert.ok(['DONE', 'CLOSED'].includes(db.prepare('SELECT status FROM tsk_tasks WHERE id = ?').get(spi.taskId).status));

  // a person resolves the EAC alert; the same evidence never raises it again
  const eac = (await t.get(dir, '/exec-alerts?ruleCode=EAC_GROWTH')).json.data.rows[0];
  assert.equal((await t.post(dir, `/exec-alerts/${eac.id}/act`, { action: 'resolve', version: eac.version })).status, 400, 'a resolution needs a note');
  const done = await t.post(dir, `/exec-alerts/${eac.id}/act`, { action: 'resolve', note: 'Variation order VO-7 approved by the client', version: eac.version });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.status, 'RESOLVED');
  assert.equal((await t.post(dir, `/exec-alerts/${eac.id}/act`, { action: 'acknowledge', version: done.json.data.version })).status, 422);
  const after = tower.evaluate(1, 'test');
  assert.equal(after.suppressed, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM exec_alerts WHERE rule_code = 'EAC_GROWTH'").get().n, 1);
  assert.ok(db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'exec_alerts' AND action = 'resolve'").get(), 'the decision is audited');

  // a published cash forecast that goes negative raises a company-level alert at once; MRP late shortages raise and clear
  publishEvent(db, { type: 'fin.cash_forecast.published', entity: 'cf_forecasts', entityId: 77, actorId: 'ct-cfo', companyId: 1,
    data: { forecastId: 77, docNo: 'CF/26-27/0007', weekStart: '2026-11-16', weeks: 13, opening: 100000, inflow: 1, outflow: 2, closing: -50000, lowest: -250000, lowestWeek: '2026-12-21' } });
  publishEvent(db, { type: 'proc.mrp.shortages_found', entity: 'proc_mrp_run', entityId: 9, actorId: 'ct-pcm', companyId: 1, projectId: Bp,
    data: { runId: 9, docNo: 'MRP-9', projectId: Bp, shortages: [{ itemId: 1, weekStart: '2026-12-07', shortQty: 10, late: true }, { itemId: 2, weekStart: '2026-12-14', shortQty: 5, late: false }] } });
  await t.drain();
  const cash = db.prepare("SELECT * FROM exec_alerts WHERE rule_code = 'CASH_NEGATIVE'").get();
  assert.ok(cash, 'cash alert raised');
  assert.equal(cash.project_id, null);
  assert.equal(cash.owner_user, 'ct-cfo', 'the CFO owns a company-level cash alert');
  const shortage = db.prepare("SELECT * FROM exec_alerts WHERE rule_code = 'MATERIAL_SHORTAGE'").get();
  assert.equal(shortage.project_id, Bp);
  assert.equal(Number(shortage.observed_value), 1);
  publishEvent(db, { type: 'proc.mrp.run_completed', entity: 'proc_mrp_run', entityId: 10, actorId: 'ct-pcm', companyId: 1, projectId: Bp, data: { runId: 10, docNo: 'MRP-10', projectId: Bp, late: 0 } });
  await t.drain();
  assert.equal(db.prepare('SELECT status FROM exec_alerts WHERE id = ?').get(shortage.id).status, 'RESOLVED');

  // scope: a PD assigned to project B sees only B, never the company cash alert, and cannot act on A
  authzOf(db).seed();
  const userId = db.prepare("SELECT id FROM iam_users WHERE username = 'ct-pd'").get().id;
  db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PD' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`).run(userId, JSON.stringify([Bp]));
  authzOf(db).invalidate();
  const scoped = authzOf(db).enrich({ companyId: 1, userId, user: 'ct-pd', roles: [] });
  assert.deepEqual(tower.portfolio(scoped).matrix.rows.map((row) => row.code), ['CT-B']);
  assert.equal(tower.portfolio(scoped).cash, null, 'the company cash position is not shown to a project-scoped PD');
  const seen = tower.alertsList(scoped, {}).rows;
  assert.ok(seen.every((row) => row.projectId === Bp), JSON.stringify(seen));
  const lti = db.prepare("SELECT * FROM exec_alerts WHERE rule_code = 'LTI'").get();
  assert.throws(() => tower.actOnAlert(scoped, lti.id, { action: 'acknowledge', version: lti.version }), { status: 404 });
  assert.throws(() => tower.project(scoped, A), { status: 404 });
  assert.throws(() => tower.getAlert(scoped, cash.id), { status: 404 });

  // the dashboard widget counts the open alerts in scope
  const widget = await t.api.call('GET', '/api/v1/ui/widgets/bi.exec_alerts/data', dir);
  assert.equal(widget.status, 200, JSON.stringify(widget.json));
  assert.equal(widget.json.data.data.value, db.prepare("SELECT COUNT(*) AS n FROM exec_alerts WHERE status IN ('OPEN','ACKNOWLEDGED')").get().n);
});

test('27.04 thresholds change only by maker-checker, audited, and drive the RAG', async () => {
  const t = await setup();
  const { db } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2704', 1, 'Control tower fixture', 0, 1)").run();
  const view = await t.get(pd, '/exec-alert-settings');
  assert.equal(view.status, 200);
  assert.equal(view.json.data.rules.length, RULES.length);
  assert.equal(view.json.data.can.configure, false);
  const body = { ruleCode: 'SPI_LOW', enabled: true, threshold: 0.8, periods: 2, severity: 'CRITICAL', reason: 'Monsoon months: board accepted lower SPI' };
  assert.equal((await t.post(pd, '/exec-alert-settings/requests', body)).status, 403, 'the PD cannot propose a threshold');
  assert.equal((await t.post(dir, '/exec-alert-settings/requests', { ...body, threshold: 9 })).status, 400, 'out of range');
  assert.equal((await t.post(dir, '/exec-alert-settings/requests', { ...body, threshold: 0.9 })).status, 409, 'already in force');
  const request = await t.post(dir, '/exec-alert-settings/requests', body);
  assert.equal(request.status, 201, JSON.stringify(request.json));
  assert.equal((await t.post(dir2, '/exec-alert-settings/requests', { ...body, threshold: 0.7 })).status, 409, 'one open change per rule');
  const { id, version } = request.json.data;
  const self = await t.post(dir, `/exec-alert-settings/requests/${id}/act`, { action: 'approve', version });
  assert.equal(self.status, 403, 'the maker cannot approve');
  assert.equal(currentSettings(db, 1).find((row) => row.code === 'SPI_LOW').threshold, 0.9, 'nothing changes before approval');
  assert.equal((await t.post(pcm, `/exec-alert-settings/requests/${id}/act`, { action: 'approve', version })).status, 403, 'PCMGR is not a checker');
  const approved = await t.post(cfo, `/exec-alert-settings/requests/${id}/act`, { action: 'approve', version });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(approved.json.data.status, 'APPROVED');
  const spi = currentSettings(db, 1).find((row) => row.code === 'SPI_LOW');
  assert.deepEqual([spi.threshold, spi.version, spi.approvedBy], [0.8, 1, 'ct-cfo']);
  const audit = db.prepare("SELECT old_values, new_values FROM core_audit_log WHERE entity = 'exec_alert_settings' AND action = 'settings_change'").get();
  assert.equal(JSON.parse(audit.old_values).threshold, 0.9);
  assert.equal(JSON.parse(audit.new_values).threshold, 0.8);
  // the new threshold drives the RAG: SPI 0.85 is amber against 0.8
  assert.equal(healthOf({ spi: { value: 0.82 } }, currentSettings(db, 1)).time, 'AMBER');
  assert.equal(healthOf({ spi: { value: 0.79 } }, currentSettings(db, 1)).time, 'RED');
  await t.drain();
  assert.ok(db.prepare("SELECT 1 FROM ntf_notifications WHERE source_type = 'bi_exec_alert_settings'").get(), 'the requester is told');
});

test('27.04 volume: 60 projects and 100,000 executive alerts stay within the list and record targets and use indexes', async () => {
  const t = await setup();
  const { db } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2704', 1, 'Control tower fixture', 0, 1)").run();
  for (const code of ['spi', 'eac']) await t.certify(code);
  const projects = [];
  const addProject = db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'ROAD', 'ACTIVE')");
  for (let i = 0; i < 58; i += 1) projects.push(Number(addProject.run(`VOL-${i}`, `Volume project ${i}`).lastInsertRowid));
  const rules = RULES.filter((rule) => !rule.companyLevel).map((rule) => rule.code);
  const insert = db.prepare(`INSERT INTO exec_alerts (company_id, alert_no, rule_code, dimension, project_id, severity, message, evidence_key, raised_at, last_seen_at, status, resolved_at, created_by, source_type)
    VALUES (1, ?, ?, 'time', ?, ?, 'Volume fixture', ?, ?, ?, 'RESOLVED', ?, 'fixture', 'fixture')`);
  db.exec('BEGIN');
  for (let i = 0; i < 100_000; i += 1) {
    const at = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
    insert.run(`EXA-V${String(i).padStart(6, '0')}`, rules[i % rules.length], projects[i % projects.length], i % 3 ? 'WARNING' : 'CRITICAL', `vol:${i}`, at, at, at);
  }
  db.exec('COMMIT');
  const timed = async (path, limit) => {
    let worst = 0;
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      const res = await t.get(dir, path);
      worst = Math.max(worst, performance.now() - started);
      assert.equal(res.status, 200, JSON.stringify(res.json));
    }
    assert.ok(worst < limit, `${path} took ${Math.round(worst)} ms (limit ${limit} ms)`);
    return worst;
  };
  await timed('/exec-alerts?status=RESOLVED&severity=CRITICAL&page=40', 500);
  await timed('/exec-alerts?status=ACTIVE', 500);
  await timed(`/exec-alerts?projectId=${projects[7]}`, 500);
  await timed('/control-tower', 800);
  await timed(`/control-tower/projects/${t.A}`, 300);
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail).join(' | ');
  assert.match(plan("SELECT * FROM exec_alerts a WHERE a.company_id = 1 AND a.status = 'OPEN' AND a.deleted_at IS NULL"), /USING INDEX (ix_exec_alerts_company_status|ux_exec_alerts_open)/);
  assert.match(plan('SELECT * FROM exec_alerts a WHERE a.project_id = 9'), /USING INDEX ix_exec_alerts_project/);
  assert.match(plan("SELECT 1 FROM exec_alerts WHERE company_id = 1 AND rule_code = 'SPI_LOW' AND project_id IS 3 AND evidence_key = 'x'"), /USING INDEX/);
});
