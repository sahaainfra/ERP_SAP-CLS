import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { morningOf } from '../src/server/modules/bi/morning-report.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 27.05: the daily morning management report. T-01 a report regenerated for the same date gives identical figures (snapshot and hash),
// and delivery happens at the scheduled time, once per recipient and day; FR-01 sections and cut-off per configuration; FR-02 the rule-based
// summary; FR-04 the exceptions (DPR missing, stock-out, collection due today, lost-time incident); scope per recipient; maker-checker settings.
const B = '/api/v1/bi';
let seq = 0;
const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `mr-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const dir = as('DIR', 'mr-dir1'); const dir2 = as('DIR', 'mr-dir2'); const cfo = as('CFO', 'mr-cfo'); const qs = as('QS', 'mr-qs'); const pm = as('PM', 'mr-pm');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  const { db } = api;
  for (const [n, r] of [['mr-dir1', 'DIR'], ['mr-dir2', 'DIR'], ['mr-cfo', 'CFO'], ['mr-qs', 'QS'], ['mr-pm', 'PM'], ['mr-proc', 'PROCMGR']]) {
    db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  }
  const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Morning report fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2704']) flag.run(code);
  db.exec(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)`);
  const reportDate = addDays(todayIST(), -1); // a date whose 06:00 cut-off has passed
  const dataDate = addDays(reportDate, -1);
  const project = (code) => Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'ROAD', 'ACTIVE')").run(code, `${code} works`).lastInsertRowid);
  const site = (pid, code) => Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, ?, 'ACTIVE')").run(pid, code, `${code} site`).lastInsertRowid);
  const A = project('MR-A'); const Bp = project('MR-B');
  const sA = site(A, 'MR-A-S1'); const sB = site(Bp, 'MR-B-S1');
  // site A reported its DPR before the cut-off; site B did not
  db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status, submitted_at) VALUES (1, 'DPR-A', ?, ?, ?, 'sup', 'SUBMITTED', ?)").run(A, sA, dataDate, `${dataDate}T12:00:00Z`);
  db.prepare("INSERT INTO att_daily (company_id, person_id, work_date, daily_site_id, status, worked_minutes, computed_at) VALUES (1, 1, ?, ?, 'PRESENT', 480, CURRENT_TIMESTAMP)").run(dataDate, sA);
  db.prepare("INSERT INTO att_daily (company_id, person_id, work_date, daily_site_id, status, worked_minutes, computed_at) VALUES (1, 2, ?, ?, 'ABSENT', 0, CURRENT_TIMESTAMP)").run(dataDate, sB);
  // a stock-out on project B's store
  const store = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, store_status, requested_by) VALUES (1, 'MR-ST', 'MR store', 'SITE_STORE', ?, ?, 'ACTIVE', 'fixture')").run(Bp, sB).lastInsertRowid);
  const category = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'MR-C', 'Cement', 'MRC', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (1, 'MR-CEM', 'OPC 53 cement', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(category).lastInsertRowid);
  db.prepare("INSERT INTO inv_reorder_params (company_id, store_id, item_id, min_qty, reorder_level, reorder_qty, effective_from) VALUES (1, ?, ?, 50000, 100000, 200000, '2026-01-01')").run(store, item);
  // a client invoice due on the report date (project A) and a lost-time injury on the data date (project B)
  const client = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, 'MR-CL', 'Metro Rail Corp', 'metro rail corp', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'fixture', 'fixture')").run().lastInsertRowid);
  db.prepare("INSERT INTO ar_invoices (company_id, doc_no, inv_source, org_project_id, partner_id, invoice_date, due_date, amount_paise, received_paise, status) VALUES (1, 'AR-MR1', 'OTHER_INCOME', ?, ?, ?, ?, 25000000, 5000000, 'APPROVED')").run(A, client, addDays(reportDate, -30), reportDate);
  db.prepare("INSERT INTO hse_incidents (company_id, doc_no, org_project_id, org_site_id, incident_type, classification, severity, occurred_at, description, reported_by, incident_status) VALUES (1, 'INC-MR', ?, ?, 'INJURY', 'LTI', 'HIGH', ?, 'Fall from scaffold', 'fixture', 'REPORTED')").run(Bp, sB, `${dataDate}T10:00`);
  const get = (who, path) => api.call('GET', B + path, who);
  const post = (who, path, body, k = key()) => api.call('POST', B + path, { ...who, body, headers: k });
  return { api, db, A, Bp, sA, sB, store, item, client, reportDate, dataDate, get, post };
}

test('27.05 the morning report: sections, rule-based summary, exceptions, reproducible snapshot, archive and export', async () => {
  const t = await setup();
  const { db } = t;
  assert.equal((await t.get(dir, `/morning-reports/current?date=${t.reportDate}`)).status, 404, 'behind ff.bi.p2705');
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2705', 1, 'Morning report fixture', 0, 1)").run();
  assert.equal((await t.get(qs, `/morning-reports/current?date=${t.reportDate}`)).status, 403, 'a QS has no morning report');
  assert.equal((await t.get(dir, `/morning-reports/current?date=${addDays(todayIST(), 2)}`)).status, 400, 'a cut-off still in the future');

  const res = await t.get(dir, `/morning-reports/current?date=${t.reportDate}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const r = res.json.data;
  const s = r.snapshot;
  assert.equal(s.dataDate, t.dataDate);
  assert.equal(s.cutoff, '06:00');
  assert.equal(s.cutoffAt, new Date(Date.parse(`${t.reportDate}T06:00:00+05:30`)).toISOString());
  assert.deepEqual([s.sections.progress.sites, s.sections.progress.submitted, s.sections.progress.missing.length], [2, 1, 1]);
  assert.equal(s.sections.progress.missing[0].project, 'MR-B');
  assert.deepEqual([s.sections.attendance.present, s.sections.attendance.absent], [1, 1]);
  assert.equal(s.sections.stock, undefined, 'a director does not hold inv.stock.view: no stock section');
  const proc = await t.get(as('PROCMGR', 'mr-proc'), `/morning-reports/current?date=${t.reportDate}`);
  assert.equal(proc.status, 200, JSON.stringify(proc.json));
  assert.deepEqual([proc.json.data.snapshot.sections.stock.stockOuts, proc.json.data.snapshot.sections.stock.belowMinimum], [1, 1]);
  assert.deepEqual(Object.keys(proc.json.data.snapshot.sections), ['approvals', 'stock', 'tasks'], 'only what the procurement manager may see');
  assert.equal(proc.json.data.snapshot.exceptions[0].kind, 'STOCK_OUT');
  assert.deepEqual([s.sections.receivables.outstanding, s.sections.receivables.dueToday], [200000, 200000]);
  assert.deepEqual([s.sections.incidents.count, s.sections.incidents.lostTime], [1, 1]);
  assert.ok(s.sections.tower, 'the control tower section (27.04) is included');
  assert.deepEqual(s.exceptions.map((e) => e.kind).sort(), ['COLLECTION_DUE', 'DPR_MISSING', 'LOST_TIME_INCIDENT']);
  assert.equal(s.exceptions[0].severity, 'CRITICAL', 'the worst exceptions come first');
  assert.equal(s.summary.kind, 'RULE_BASED');
  assert.ok(s.summary.lines.some((l) => /1 missing/.test(l)), JSON.stringify(s.summary.lines));
  assert.ok(s.summary.lines.some((l) => /₹2,00,000.00 due today/.test(l)), JSON.stringify(s.summary.lines));

  // T-01 BR-01: later data does not change the report of that date; reopening and verifying give identical figures
  db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status, submitted_at) VALUES (1, 'DPR-B-LATE', ?, ?, ?, 'sup', 'SUBMITTED', ?)").run(t.Bp, t.sB, t.dataDate, new Date().toISOString());
  db.prepare('UPDATE ar_invoices SET received_paise = amount_paise').run();
  const again = await t.get(dir, `/morning-reports/current?date=${t.reportDate}`);
  assert.equal(again.json.data.id, r.id);
  assert.deepEqual(again.json.data.snapshot, s);
  assert.equal(again.json.data.hash, r.hash);
  const verify = await t.get(dir, `/morning-reports/${r.id}/verify`);
  assert.equal(verify.json.data.identical, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mr_reports WHERE recipient_user = 'mr-dir1'").get().n, 1);

  // the report is personal: another director cannot open it
  assert.equal((await t.get(dir2, `/morning-reports/${r.id}`)).status, 404);
  const archive = await t.get(dir, '/morning-reports');
  assert.deepEqual(archive.json.data.rows.map((x) => x.id), [r.id]);
  assert.equal((await t.get(dir2, '/morning-reports')).json.data.total, 0);
  const pdf = await t.api.raw('GET', `${B}/morning-reports/${r.id}/export?format=pdf`, dir);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const csv = await t.api.raw('GET', `${B}/morning-reports/${r.id}/export?format=csv`, dir);
  assert.match(csv.buffer.toString('utf8'), /No DPR for .* from MR-B-S1/);
  assert.ok(db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'mr_reports' AND action = 'print'").get());

  // scope: a project manager assigned to project A sees only A's sites and none of B's stock or incidents
  authzOf(db).seed();
  const userId = db.prepare("SELECT id FROM iam_users WHERE username = 'mr-pm'").get().id;
  db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`).run(userId, JSON.stringify([t.A]));
  db.prepare("UPDATE iam_users SET roles_json = '[]' WHERE username = 'mr-pm'").run();
  authzOf(db).invalidate();
  db.prepare('UPDATE ar_invoices SET received_paise = 5000000').run();
  const scoped = authzOf(db).enrich({ companyId: 1, userId, user: 'mr-pm', roles: [] });
  const pmReport = morningOf(db).open(scoped, { date: t.reportDate });
  const ps = pmReport.snapshot.sections;
  assert.deepEqual([ps.progress.sites, ps.progress.missing.length], [1, 0], 'only project A sites');
  assert.equal(ps.attendance.absent, 0, 'no project B attendance');
  assert.equal(ps.stock?.stockOuts ?? 0, 0, 'no project B store');
  assert.equal(ps.incidents?.count ?? 0, 0, 'no project B incident');
  assert.equal(ps.receivables.dueToday, 200000, 'project A collection due');
  assert.ok(!pmReport.snapshot.exceptions.some((e) => ['STOCK_OUT', 'DPR_MISSING', 'LOST_TIME_INCIDENT'].includes(e.kind)));
  assert.ok(pmReport.snapshot.exceptions.some((e) => e.kind === 'COLLECTION_DUE'));
});

test('27.05 configurations are maker-checker; delivery happens at the scheduled time, once per recipient and day, through the notification engine', async () => {
  const t = await setup();
  const { db } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2705', 1, 'Morning report fixture', 0, 1)").run();
  const assignmentUser = db.prepare("SELECT id FROM iam_users WHERE username = 'mr-dir2'").get().id;
  authzOf(db).seed();
  db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'DIR' AND company_id IS NULL), 'COMPANY', '[]', 'ACTIVE', 'test')`).run(assignmentUser);
  db.prepare("UPDATE iam_users SET roles_json = '[]' WHERE id = ?").run(assignmentUser);
  authzOf(db).invalidate();
  const body = { scopeType: 'ROLE', scopeRef: 'DIR', sections: ['progress', 'stock', 'receivables', 'payables', 'tasks', 'incidents'], cutoff: '06:00', time: '06:30', channels: ['IN_APP', 'EMAIL'], pdf: true, active: true, reason: 'Board wants the digest by 06:30' };
  assert.equal((await t.post(pm, '/morning-report-settings/requests', body)).status, 403, 'a PM cannot configure');
  assert.equal((await t.post(dir, '/morning-report-settings/requests', { ...body, time: '05:00' })).status, 400, 'delivery before the cut-off');
  assert.equal((await t.post(dir, '/morning-report-settings/requests', { ...body, channels: ['EMAIL'] })).status, 400, 'in-app is always on');
  const request = await t.post(dir, '/morning-report-settings/requests', body);
  assert.equal(request.status, 201, JSON.stringify(request.json));
  assert.equal((await t.post(dir2, '/morning-report-settings/requests', body)).status, 409, 'one open change per configuration');
  const { id, version } = request.json.data;
  assert.equal((await t.post(dir, `/morning-report-settings/requests/${id}/act`, { action: 'approve', version })).status, 403, 'the maker cannot approve');
  const approved = await t.post(cfo, `/morning-report-settings/requests/${id}/act`, { action: 'approve', version });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  const settings = (await t.get(dir, '/morning-report-settings')).json.data;
  assert.deepEqual(settings.mine.sections, body.sections);
  assert.equal(settings.mine.version, 1);
  const audit = db.prepare("SELECT new_values FROM core_audit_log WHERE entity = 'mr_configs' AND action = 'config_change'").get();
  assert.equal(JSON.parse(audit.new_values).requestedBy, 'mr-dir1');

  const storeConfig = await t.post(dir, '/morning-report-settings/requests', { ...body, scopeRef: 'PROCMGR' });
  assert.equal(storeConfig.status, 201, JSON.stringify(storeConfig.json));
  assert.equal((await t.post(cfo, `/morning-report-settings/requests/${storeConfig.json.data.id}/act`, {
    action: 'approve', version: storeConfig.json.data.version,
  })).status, 200);

  const bin = db.prepare("INSERT INTO inv_bins (company_id, store_id, code) VALUES (1, ?, 'MR-BIN')").run(t.store).lastInsertRowid;
  db.prepare(`INSERT INTO inv_balances (company_id, store_id, bin_id, item_id, qty_on_hand, qty_reserved, qty_inspection)
    VALUES (1, ?, ?, ?, 120000, 20000, 100000)`).run(t.store, bin, t.item);
  db.prepare(`INSERT INTO ap_bills (company_id, doc_no, bill_source, org_project_id, org_site_id, partner_id, payee_name,
    bill_date, due_date, msme, msme_due_date, net_payable_paise, adjusted_paise, paid_paise, status)
    VALUES (1, 'MR-BILL', 'DIRECT', ?, ?, ?, 'Vendor', ?, ?, 1, ?, 800000, 50000, 150000, 'APPROVED')`)
    .run(t.A, t.sA, t.client, t.dataDate, addDays(t.reportDate, 10), t.reportDate);
  const task = db.prepare("INSERT INTO tsk_tasks (company_id, task_no, title, priority, status, due_date, assigner) VALUES (1, ?, ?, ?, ?, ?, 'fixture')");
  const assign = db.prepare("INSERT INTO tsk_assignees (company_id, task_id, user_ref, role) VALUES (1, ?, ?, 'ASSIGNEE')");
  for (let i = 0; i < 52; i += 1) {
    const id = task.run(`MR-T${i}`, `Assigned review ${i}`, 'HIGH', 'OPEN', i < 51 ? t.dataDate : t.reportDate).lastInsertRowid;
    assign.run(id, 'mr-dir1');
  }
  assign.run(task.run('MR-CLOSED', 'Closed task', 'URGENT', 'CLOSED', t.dataDate).lastInsertRowid, 'mr-dir1');
  assign.run(task.run('MR-OTHER', 'Other recipient', 'URGENT', 'OPEN', t.dataDate).lastInsertRowid, 'mr-dir2');
  db.exec(`CREATE TRIGGER simulate_report_failure BEFORE UPDATE OF delivered_at ON mr_reports
    WHEN NEW.recipient_user = 'mr-dir2' BEGIN SELECT RAISE(ABORT, 'test delivery failure'); END`);

  // delivery: nothing before the configured time; at 06:30 both directors get today's report once
  const { jobs } = runtimeOf(db);
  const run = async (params) => { const job = jobs.enqueue('bi.morning_report.deliver', params, { companyId: 1, createdBy: 'test' }); for (let i = 0; i < 10 && jobs.get(job.id).status === 'QUEUED'; i += 1) await jobs.runNext(); return jobs.get(job.id); };
  const early = await run({ companyId: 1, now: '06:15', date: t.reportDate });
  assert.equal(early.status, 'SUCCEEDED', JSON.stringify(early));
  assert.equal(early.result.delivered, 0, 'not before 06:30');
  const due = await run({ companyId: 1, now: '06:30', date: t.reportDate });
  assert.deepEqual(due.result, { delivered: 2, failed: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mr_reports WHERE recipient_user = 'mr-dir2'").get().n, 0);
  db.exec('DROP TRIGGER simulate_report_failure');
  const retry = await run({ companyId: 1, now: '06:45', date: t.reportDate });
  assert.deepEqual(retry.result, { delivered: 1, failed: 0 });
  const reports = db.prepare('SELECT * FROM mr_reports ORDER BY recipient_user').all();
  assert.deepEqual(reports.map((x) => [x.recipient_user, x.status, x.trigger]), [['mr-dir1', 'DELIVERED', 'schedule'], ['mr-dir2', 'DELIVERED', 'schedule'], ['mr-proc', 'DELIVERED', 'schedule']]);
  assert.deepEqual(JSON.parse(reports[0].channels_json), ['IN_APP', 'EMAIL']);
  assert.deepEqual(Object.keys(JSON.parse(reports[0].snapshot_json).sections).sort(), ['incidents', 'payables', 'progress', 'receivables', 'tasks'], 'only the configured sections the director may see (no stock permission)');
  assert.ok(db.prepare("SELECT 1 FROM ntf_notifications WHERE source_type = 'mr_reports' AND source_id = ?").get(String(reports[0].id)), 'delivered in-app');
  assert.ok(db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bi.morning_report.delivered'").get());
  const twice = await run({ companyId: 1, now: '07:00', date: t.reportDate });
  assert.equal(twice.result.delivered, 0, 'once per recipient and day');
  const director = JSON.parse(reports[0].snapshot_json);
  assert.equal(director.cutoffAt, `${t.reportDate}T00:30:00.000Z`);
  assert.equal(director.sections.receivables.dueToday, 200000);
  assert.deepEqual(director.sections.payables, { outstanding: 6000, overdue: 0, dueToday: 6000, msmeDue: 6000, route: '/finance/payables' });
  assert.deepEqual([director.sections.tasks.critical, director.sections.tasks.overdue, director.sections.tasks.rows.length], [52, 51, 20]);
  assert.equal(JSON.parse(reports[1].snapshot_json).sections.tasks.critical, 1, 'the second director only sees their own task');
  const procurement = JSON.parse(reports[2].snapshot_json).sections;
  assert.deepEqual([procurement.stock.stockOuts, procurement.stock.belowMinimum, procurement.stock.rows[0].available], [1, 1, 0]);
  assert.equal(procurement.receivables, undefined);
  assert.equal(procurement.payables, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE source_type = 'mr_reports'").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'bi.morning_report.delivered'").get().n, 3);
  // the delivered report opens as its recipient's interactive version, with the same figures
  const opened2 = await t.get(dir2, `/morning-reports/${reports[1].id}`);
  assert.equal(opened2.json.data.hash, reports[1].snapshot_hash);
  assert.equal((await t.post(pm, '/morning-reports/deliveries', {})).status, 403);
  assert.equal((await t.post(dir, '/morning-reports/deliveries', {})).status, 202);
});

test('27.05 volume: 100,000 archived reports keep the archive and the record within target and use indexes', async () => {
  const t = await setup();
  const { db } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2705', 1, 'Morning report fixture', 0, 1)").run();
  const insert = db.prepare(`INSERT INTO mr_reports (company_id, report_no, report_date, recipient_user, cutoff_at, snapshot_json, snapshot_hash, data_snapshot_ref, generated_at, trigger, created_by)
    VALUES (1, ?, ?, ?, ?, '{"sections":{},"exceptions":[],"summary":{"lines":[]}}', 'h', 'sha256:h', ?, 'schedule', 'fixture')`);
  db.exec('BEGIN');
  for (let i = 0; i < 100_000; i += 1) {
    const date = addDays('2020-01-01', i % 1500);
    insert.run(`MR-V${String(i).padStart(6, '0')}`, date, i % 1500 === i ? 'mr-dir1' : `vol-${Math.floor(i / 1500)}`, `${date}T00:30:00Z`, `${date}T01:00:00Z`);
  }
  db.exec('COMMIT');
  for (const path of ['/morning-reports?page=30', '/morning-reports?from=2021-01-01&to=2021-12-31']) {
    let worst = 0;
    for (let i = 0; i < 5; i += 1) { const s = performance.now(); const r = await t.get(dir, path); worst = Math.max(worst, performance.now() - s); assert.equal(r.status, 200); }
    assert.ok(worst < 500, `${path} ${Math.round(worst)} ms`);
  }
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM mr_reports WHERE company_id = 1 AND recipient_user = 'mr-dir1' AND deleted_at IS NULL ORDER BY report_date DESC LIMIT 25").all().map((x) => x.detail).join(' | ');
  assert.match(plan, /USING INDEX (ix_mr_reports_recipient|sqlite_autoindex_mr_reports_2)/);
});
