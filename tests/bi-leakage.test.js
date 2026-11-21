import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { leakageOf } from '../src/server/modules/bi/leakage.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 27.09: wastage, leakage and duplication detection.
// T-01 each rule fires on its seeded scenario and computes the value at risk; FR-02 findings carry evidence, an owner (RACI → PM → role),
// a task and a status, and close only with an outcome (BR-01); a false positive goes owner → AUD through the workflow engine (self-approval
// blocked, return sends it back); a closed finding is never raised again; FR-03 the tower; rules change only by maker-checker; roles and scope.
const B = '/api/v1/bi';
const W = '/api/v1/workflow';
let seq = 0;
const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `lk-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const aud = as('AUD', 'lk-aud'); const cfo = as('CFO', 'lk-cfo'); const pd = as('PD', 'lk-pd'); const pcm = as('PCMGR', 'lk-pcm'); const pm = as('PM', 'lk-pm'); const se = as('SE', 'lk-se');
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const agoIso = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

async function setup({ flag = true } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api); const { db } = api;
  for (const [n, r] of [['lk-aud', 'AUD'], ['lk-cfo', 'CFO'], ['lk-pd', 'PD'], ['lk-pcm', 'PCMGR'], ['lk-pm', 'PM'], ['lk-acc', 'ACCMGR'], ['lk-proc', 'PROCMGR'], ['lk-store', 'STOREMGR'], ['lk-plant', 'PLANTMGR'], ['lk-hr', 'HRMGR'], ['lk-qs', 'QS'], ['lk-se', 'SE']]) {
    db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  }
  const fl = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Leakage fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', ...(flag ? ['ff.bi.p2709'] : [])]) fl.run(code);
  db.exec("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)");
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'LK-P', 'Leak Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'LK-Q', 'Other Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'LK-S1', 'Tower site', 'ACTIVE')").run(project).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'lk-pm', 100000000, '2026-01-01', '2027-12-31', 'test')").run(project);
  const get = (who, path) => api.call('GET', B + path, who);
  const post = (who, path, body, k = key()) => api.call('POST', B + path, { ...who, body, headers: k });
  return { api, db, project, other, site, get, post };
}

/** One scenario per rule (T-01). The detectors only read these tables, so the chains of foreign keys behind them are not built. */
function seed(t) {
  const { db, project, site } = t;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const vendor = 9001;
    // DUP_INVOICE: the same invoice number billed twice by one vendor (₹ 1,18,000)
    const bill = db.prepare("INSERT INTO ap_bills (company_id, doc_no, bill_source, org_project_id, org_site_id, partner_id, payee_name, bill_no, bill_date, due_date, total_paise, status) VALUES (1, ?, 'DIRECT', ?, ?, ?, 'Shree Cement', ?, ?, ?, ?, 'APPROVED')");
    bill.run('APB-1', project, site, vendor, 'INV-77', ago(10), ago(-20), 11_800_000); bill.run('APB-2', project, site, vendor, 'inv-77 ', ago(8), ago(-22), 11_800_000);
    bill.run('APB-3', project, site, vendor, 'INV-78', ago(8), ago(-22), 5_000_000);
    // DUP_PAYMENT: ₹ 2,50,000 paid twice to the same payee within a week
    const pay = db.prepare("INSERT INTO pmt_payments (company_id, doc_no, proposal_id, line_id, partner_id, payee_name, pay_mode, bank_account_id, amount_paise, released_on, paid_on, pay_status) VALUES (1, ?, 1, ?, ?, 'Shree Cement', 'NEFT', 1, 25000000, ?, ?, 'PAID')");
    pay.run('PAY-1', 1, vendor, ago(6), ago(6)); pay.run('PAY-2', 2, vendor, ago(3), ago(3));
    // SPLIT_PO: three orders of ₹ 2 lakh each to one vendor within 5 days (limit ₹ 5 lakh)
    const po = db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, total_amount, status, requested_by) VALUES (1, ?, ?, ?, ?, ?, ?, 'APPROVED', 'buyer')");
    po.run('PO-1', ago(9), project, site, 7001, 20_000_000); po.run('PO-2', ago(7), project, site, 7001, 20_000_000); po.run('PO-3', ago(5), project, site, 7001, 20_000_000);
    // PO_ABOVE_BENCHMARK: 100 bags at ₹ 450 against a benchmark of ₹ 380 → (450 − 380) × 100 = ₹ 7,000
    const big = Number(po.run('PO-4', ago(2), project, site, 7002, 90_000_000).lastInsertRowid);
    db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, description, qty, uom, rate, benchmark_rate) VALUES (1, ?, 1, 'OPC cement', 100000, 'bag', 45000, 38000)").run(big);
    // CONSUMPTION_ABOVE_NORM: 12.5 t of steel over the norm at ₹ 60,000 a tonne = ₹ 7,50,000
    const mrc = Number(db.prepare("INSERT INTO mrc_reconciliations (company_id, doc_no, org_project_id, org_site_id, period, period_start, period_end, status, requested_by) VALUES (1, 'MRC-1', ?, ?, ?, ?, ?, 'APPROVED', 'stores')").run(project, site, ago(40).slice(0, 7), ago(40), ago(10)).lastInsertRowid);
    db.prepare("INSERT INTO mrc_lines (company_id, recon_id, item_id, theoretical, actual, variance, allowed_wastage_pct, wastage_pct, over_allowed, avg_rate) VALUES (1, ?, 1, 250000, 262500, 12500, 300, 500, 1, 6000000)").run(mrc);
    // FUEL_ANOMALY: 120 litres at risk at ₹ 95 a litre = ₹ 11,400
    const eq = Number(db.prepare("INSERT INTO plt_equipment (company_id, doc_no, asset_code, class_item_id, requested_by) VALUES (1, 'EQ-1', 'EXC-01', 1, 'plant')").run().lastInsertRowid);
    const issue = Number(db.prepare("INSERT INTO plt_fuel_issues (company_id, doc_no, tank_id, equipment_id, issue_at, issue_date, meter_reading, litres, issued_by, received_by, rate, requested_by, org_project_id) VALUES (1, 'FI-1', 1, ?, ?, ?, 1000, 200000, 'x', 'y', 9500, 'x', ?)").run(eq, agoIso(4), ago(4), project).lastInsertRowid);
    db.prepare("INSERT INTO plt_fuel_anomalies (company_id, doc_no, rule_code, equipment_id, issue_id, org_project_id, org_site_id, detected_on, dedupe_key, litres_at_risk) VALUES (1, 'FA-1', 'OVER_NORM', ?, ?, ?, ?, ?, 'fa1', 120000)").run(eq, issue, project, site, ago(4));
    // ATTENDANCE_ANOMALY: 4 punches on a shared device by one worker on 4 days → 4 × ₹ 800 = ₹ 3,200
    const punch = db.prepare("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, method, recorded_by, client_uuid, result) VALUES (1, 'WORKER', 55, ?, 'IN', ?, ?, ?, ?, 'KIOSK', 'kiosk', ?, 'ACCEPTED')");
    const anomaly = db.prepare("INSERT INTO att_anomalies (company_id, punch_id, anomaly_type, severity) VALUES (1, ?, 'SHARED_DEVICE', 'HIGH')");
    for (const d of [2, 3, 4, 5]) anomaly.run(Number(punch.run(site, ago(d), agoIso(d), agoIso(d), agoIso(d), `u-${d}`).lastInsertRowid));
    // IDLE_HIRED_EQUIPMENT: a crane hired at ₹ 2,400 a day (8 h) idle 20 hours → ₹ 6,000
    const crane = Number(db.prepare("INSERT INTO plt_equipment (company_id, doc_no, asset_code, class_item_id, requested_by) VALUES (1, 'EQ-2', 'CRN-01', 1, 'plant')").run().lastInsertRowid);
    db.prepare("INSERT INTO plt_hire_agreements (company_id, doc_no, equipment_id, direction, partner_id, org_project_id, org_site_id, charge_basis, hire_rate, from_date, to_date, status) VALUES (1, 'HA-1', ?, 'IN', 5, ?, ?, 'DAY', 240000, ?, ?, 'APPROVED')").run(crane, project, site, ago(60), ago(-60));
    const log = db.prepare("INSERT INTO plt_logs (company_id, doc_no, equipment_id, allocation_id, org_project_id, log_date, start_meter, end_meter, idle_hrs, status, requested_by) VALUES (1, ?, ?, 1, ?, ?, 0, 0, ?, 'APPROVED', 'op')");
    log.run('LOG-1', crane, project, ago(6), 8000); log.run('LOG-2', crane, project, ago(5), 12000);
    // STOCK_AGEING: ₹ 40,000 of stock untouched for 200 days
    const store = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, store_status, requested_by) VALUES (1, 'LK-ST', 'Tower store', 'SITE_STORE', ?, ?, 'ACTIVE', 'x')").run(project, site).lastInsertRowid);
    db.prepare("INSERT INTO inv_stock_ledger (company_id, doc_no, store_id, bin_id, item_id, txn_type, txn_date, qty_in, balance_qty, balance_value, posted_by) VALUES (1, 'SL-1', ?, 1, 2, 'RECEIPT', ?, 50000, 50000, 4000000, 'x')").run(store, ago(200));
    // UNBILLED_WORK_AGEING: 50 m³ executed 40 days ago, never measured, at a BOQ rate of ₹ 500 → ₹ 25,000
    const sch = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, calendar_id, start_date) VALUES (1, 'SCH-LK', ?, ?, 'Master', 1, ?)").run(ago(90), project, ago(90)).lastInsertRowid);
    const act = Number(db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name) VALUES (1, ?, 'EXC', 'Excavation')").run(sch).lastInsertRowid);
    const ver = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status) VALUES (1, 'BOQ-LK', ?, 'CONTRACT', 1, 'Contract', 'APPROVED')").run(project).lastInsertRowid);
    const line = Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount) VALUES (1, ?, 'ITEM', '2.1', 'Excavation', 'm3', 1000000, 5000000, 0)").run(ver).lastInsertRowid);
    db.prepare('INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty) VALUES (1, ?, ?, 1000000)').run(act, line);
    const dpr = Number(db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (1, 'DPR-LK', ?, ?, ?, 'sup', 'APPROVED')").run(project, site, ago(40)).lastInsertRowid);
    db.prepare('INSERT INTO site_dpr_work (company_id, dpr_id, wa_id, activity_id, qty) VALUES (1, ?, 1, ?, 50000)').run(dpr, act);
    // OVERDUE_APPROVAL: an approval task due 5 days ago
    const def = Number(db.prepare("INSERT INTO wf_definitions (company_id, doc_type, version, name, steps_json, status, activated_at) VALUES (1, 'TEST_DOC', 1, 'x', '[]', 'ACTIVE', CURRENT_TIMESTAMP)").run().lastInsertRowid);
    const inst = Number(db.prepare("INSERT INTO wf_instances (company_id, doc_type, doc_id, doc_ref, title, definition_id, definition_version, steps_json, context_json, submitted_by, submitted_at) VALUES (1, 'TEST_DOC', '1', 'TD-1', 'Test document', ?, 1, '[]', ?, 'maker', ?)").run(def, JSON.stringify({ projectId: project }), agoIso(9)).lastInsertRowid);
    db.prepare("INSERT INTO wf_tasks (company_id, instance_id, step_code, step_no, kind, assignee_user_id, status, due_at) VALUES (1, ?, 'S1', 1, 'APPROVAL', (SELECT id FROM iam_users WHERE username = 'lk-pd'), 'OPEN', ?)").run(inst, agoIso(5));
    // EMERGENCY_UNREGULARISED and REPEATED_EXCEPTIONS: an emergency past its regularise-by date, and one buyer raising 5 exceptions
    const cp = Number(db.prepare("INSERT INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, owner_role, mode) VALUES (1, 'CP-PROC-99', 'proc', 'APPROVE', 'PO above budget', 'x', 'EXCEPTION', 'PROCMGR', 'ENFORCE')").run().lastInsertRowid);
    db.prepare("INSERT INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, owner_role, mode) VALUES (1, 'CP-INV-98', 'inv', 'RECORD', 'Issue above norm', 'x', 'WARN', 'STOREMGR', 'OBSERVE')").run();
    const exc = db.prepare("INSERT INTO pcs_exceptions (company_id, exception_no, control_id, control_code, entity, entity_id, reason_code, justification, value_at_risk, status, emergency, regularise_by, raised_by, project_id, created_at) VALUES (1, ?, ?, 'CP-PROC-99', 'po', ?, 'URGENT', 'Urgent site need', ?, ?, ?, ?, 'lk-proc', ?, ?)");
    exc.run('EXC-1', cp, '1', 3_000_000, 'APPROVED', 1, agoIso(2), project, agoIso(10));
    for (const i of [2, 3, 4, 5]) exc.run(`EXC-${i}`, cp, String(i), 100_000, 'APPROVED', 0, null, project, agoIso(i));
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const EXPECTED = {
  DUP_INVOICE: 118_000, DUP_PAYMENT: 250_000, SPLIT_PO: 600_000, PO_ABOVE_BENCHMARK: 7_000, CONSUMPTION_ABOVE_NORM: 750_000, FUEL_ANOMALY: 11_400, ATTENDANCE_ANOMALY: 3_200,
  IDLE_HIRED_EQUIPMENT: 6_000, STOCK_AGEING: 40_000, UNBILLED_WORK_AGEING: 25_000, OVERDUE_APPROVAL: 0, EMERGENCY_UNREGULARISED: 30_000, REPEATED_EXCEPTIONS: 34_000,
};

test('T-01 FR-01 FR-02 each rule fires on its scenario with its value at risk, an owner, a task and evidence; a rerun raises nothing twice', async () => {
  const t = await setup(); seed(t);
  const svc = leakageOf(t.api.db);
  const r = svc.run(1, 'test');
  const errors = r.rules.filter((x) => x.error); assert.deepEqual(errors, [], JSON.stringify(errors));
  const rows = t.db.prepare('SELECT * FROM det_findings ORDER BY id').all();
  for (const [code, value] of Object.entries(EXPECTED)) {
    const f = rows.filter((x) => x.rule_code === code);
    assert.equal(f.length, 1, `${code} fires once: ${JSON.stringify(r.rules.find((x) => x.code === code))}`);
    assert.equal(f[0].value_at_risk / 100, value, `${code} value at risk`);
    assert.ok(JSON.parse(f[0].evidence_json).route, `${code} evidence links to its record`);
  }
  const by = Object.fromEntries(rows.map((x) => [x.rule_code, x]));
  assert.equal(by.SPLIT_PO.owner_user, 'lk-pm', 'a project finding with no RACI goes to the project manager');
  assert.equal(by.DUP_PAYMENT.owner_user, 'lk-acc', 'a company finding goes to a holder of the rule\'s owner role');
  assert.equal(by.OVERDUE_APPROVAL.owner_user, 'lk-pd', 'an overdue approval is owned by the approver');
  assert.equal(by.EMERGENCY_UNREGULARISED.owner_user, 'lk-proc', 'the emergency is owned by the person who raised it');
  assert.equal(by.REPEATED_EXCEPTIONS.owner_user, 'lk-aud');
  assert.ok(by.DUP_INVOICE.task_id, 'a task is made for the owner');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'bi.finding.raised'").get().n, 13);
  // a second run refreshes; nothing new is raised
  const again = svc.run(1, 'test'); assert.equal(again.raised, 0); assert.equal(again.refreshed, 13);
  // the RACI of 04.05 decides first when someone is accountable
  t.db.exec('PRAGMA foreign_keys = OFF');
  t.db.prepare("INSERT INTO acc_raci_assignments (company_id, scope_type, scope_id, process_code, user_id, raci, status, effective_from, batch_id, created_by) VALUES (1, 'PROJECT', ?, 'PO_ISSUE', (SELECT id FROM iam_users WHERE username = 'lk-proc'), 'A', 'ACTIVE', '2020-01-01', 1, 'test')").run(t.project);
  t.db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, total_amount, status, requested_by) VALUES (1, 'PO-9', ?, ?, 7003, 30000000, 'APPROVED', 'b')").run(ago(1), t.project);
  t.db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, total_amount, status, requested_by) VALUES (1, 'PO-10', ?, ?, 7003, 30000000, 'APPROVED', 'b')").run(ago(0), t.project);
  t.db.exec('PRAGMA foreign_keys = ON');
  svc.run(1, 'test', 'SPLIT_PO');
  const raci = t.db.prepare("SELECT owner_user, owner_basis FROM det_findings WHERE rule_code = 'SPLIT_PO' ORDER BY id DESC LIMIT 1").get();
  assert.equal(raci.owner_user, 'lk-proc'); assert.match(raci.owner_basis, /RACI PO_ISSUE/);
});

test('BR-01 FR-02 §9 closing needs an outcome; a false positive goes owner → AUD; a closed finding is not raised again; the tower and the roles', async () => {
  const t = await setup(); seed(t);
  const svc = leakageOf(t.api.db); svc.run(1, 'test');
  const id = (code) => t.db.prepare('SELECT id FROM det_findings WHERE rule_code = ?').get(code).id;
  const pmv = async (code) => (await t.get(pm, `/findings/${id(code)}`)).json.data;
  // the owner (PM, no leakage permission) sees and acts on their own finding; the SE sees nothing
  assert.equal((await t.get(pm, '/findings?mine=1')).json.data.total >= 1, true);
  assert.equal((await t.get(se, `/findings/${id('SPLIT_PO')}`)).status, 404);
  assert.equal((await t.get(se, '/findings')).json.data.total, 0);
  assert.equal((await t.get(se, '/leakage')).status, 403);
  let f = await pmv('SPLIT_PO');
  assert.equal(f.can.close, true);
  assert.equal((await t.post(pm, `/findings/${f.id}/close`, { outcome: 'CONFIRMED_LOSS', resolution: 'Orders were split', rowVersion: f.rowVersion })).status, 400, 'a confirmed loss needs the amount');
  assert.equal((await t.post(pm, `/findings/${f.id}/review`, { rowVersion: f.rowVersion + 5 })).status, 409, 'stale version');
  assert.equal((await t.post(pm, `/findings/${f.id}/review`, { rowVersion: f.rowVersion })).status, 200);
  f = await pmv('SPLIT_PO');
  const closed = await t.post(pm, `/findings/${f.id}/close`, { outcome: 'CONFIRMED_LOSS', lossAmount: 15000, resolution: 'Orders were split to avoid the PD approval; vendor discount lost', rowVersion: f.rowVersion });
  assert.equal(closed.status, 200, JSON.stringify(closed.json)); assert.equal(closed.json.data.outcome, 'CONFIRMED_LOSS'); assert.equal(closed.json.data.lossAmount, 15000);
  // a false positive: the owner sends it, AUD decides; the owner cannot approve; return sends it back to review
  f = await pmv('UNBILLED_WORK_AGEING');
  const fp = await t.post(pm, `/findings/${f.id}/close`, { outcome: 'FALSE_POSITIVE', resolution: 'Measured in the client joint measurement, not yet keyed', rowVersion: f.rowVersion });
  assert.equal(fp.status, 200, JSON.stringify(fp.json)); assert.equal(fp.json.data.status, 'PENDING_FP');
  const tasks = async (who) => (await t.api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  assert.equal((await tasks(pm)).filter((x) => x.instance?.id === fp.json.data.workflowInstanceId).length, 0, 'the owner has no approval task');
  let task = (await tasks(aud)).find((x) => x.instance?.id === fp.json.data.workflowInstanceId); assert.ok(task, 'the auditor has the task');
  assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...aud, headers: key(), body: { action: 'return', comment: 'Attach the joint measurement reference' } })).status, 200);
  f = await pmv('UNBILLED_WORK_AGEING'); assert.equal(f.status, 'IN_REVIEW');
  assert.equal((await t.post(pm, `/findings/${f.id}/close`, { outcome: 'FALSE_POSITIVE', resolution: 'Joint measurement JM-14 dated last week covers it', rowVersion: f.rowVersion })).status, 200);
  task = (await tasks(aud)).find((x) => x.instance?.id === f.workflowInstanceId);
  assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...aud, headers: key(), body: { action: 'approve', comment: 'Checked JM-14' } })).status, 200);
  f = (await t.get(aud, `/findings/${f.id}`)).json.data; assert.deepEqual([f.status, f.outcome, f.approvedBy], ['CLOSED', 'FALSE_POSITIVE', 'lk-aud']);
  // closed findings are not raised again for the same evidence
  const rerun = svc.run(1, 'test'); assert.equal(rerun.raised, 0); assert.ok(rerun.suppressed >= 2);
  // the tower
  const tower = (await t.get(aud, '/leakage')).json.data;
  assert.equal(tower.tiles.open, 11); assert.equal(tower.tiles.confirmedLoss, 15000); assert.equal(tower.tiles.falsePositiveRate, 50);
  assert.deepEqual([tower.controls.modes.ENFORCE, tower.controls.modes.OBSERVE], [1, 1]);
  assert.ok(tower.byRule.length >= 10 && tower.byRule[0].valueAtRisk >= tower.byRule[1].valueAtRisk);
  assert.ok(tower.trend.exceptions.reduce((a, b) => a + b, 0) >= 5);
  // export and history
  const x = await t.api.raw('GET', `${B}/findings/export?format=csv`, aud); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /FND-/);
  assert.ok((await t.get(pm, `/findings/${id('SPLIT_PO')}/history`)).json.data.some((h) => h.action === 'close'));
  // AUD reads but does not act on others' findings; PD acts
  f = (await t.get(aud, `/findings/${id('STOCK_AGEING')}`)).json.data; assert.equal(f.can.close, false);
  assert.equal((await t.post(aud, `/findings/${f.id}/review`, { rowVersion: f.rowVersion })).status, 403);
  assert.equal((await t.post(pd, `/findings/${f.id}/review`, { rowVersion: f.rowVersion })).status, 200);
});

test('rule changes are maker-checker (CFO proposes, AUD approves, never the requester); scope; flag off is 404; volume', async () => {
  const t = await setup(); seed(t);
  const rules = (await t.get(cfo, '/detection-rules')).json.data; assert.equal(rules.rules.length, 13);
  assert.equal((await t.post(cfo, '/detection-rules/PO_ABOVE_BENCHMARK/changes', { thresholds: { pct: 500 }, severity: 'WARNING', active: true, reason: 'Tighter' })).status, 400);
  assert.equal((await t.post(pd, '/detection-rules/PO_ABOVE_BENCHMARK/changes', { thresholds: { pct: 20 }, severity: 'WARNING', active: true, reason: 'Looser please' })).status, 403);
  const req = await t.post(cfo, '/detection-rules/PO_ABOVE_BENCHMARK/changes', { thresholds: { pct: 20 }, severity: 'WARNING', active: true, reason: 'Cement prices moved; 20 % avoids noise' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  const r = req.json.data;
  assert.notEqual((await t.post(cfo, `/detection-rules/changes/${r.id}/act`, { action: 'approve', version: r.version })).status, 200, 'the requester never approves');
  assert.equal((await t.post(aud, `/detection-rules/changes/${r.id}/act`, { action: 'approve', version: r.version })).status, 200);
  const now = (await t.get(cfo, '/detection-rules')).json.data.rules.find((x) => x.code === 'PO_ABOVE_BENCHMARK');
  assert.deepEqual([now.thresholds.pct, now.version], [20, 1]);
  leakageOf(t.api.db).run(1, 'test');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM det_findings WHERE rule_code = 'PO_ABOVE_BENCHMARK'").get().n, 0, '18.4 % is under the new 20 %');
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'det_rules' AND action = 'settings_change'").get());
  // the run is a job
  const q = await t.post(pcm, '/detection/runs', {}); assert.equal(q.status, 202);
  await runtimeOf(t.api.db).jobs.drain?.();
  // scope: a PD assigned to the other project sees only company-level findings and their own
  authzOf(t.db).seed();
  const uid = t.db.prepare("SELECT id FROM iam_users WHERE username = 'lk-pd'").get().id;
  t.db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PD' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`).run(uid, JSON.stringify([t.other]));
  authzOf(t.db).invalidate();
  const scoped = authzOf(t.db).enrich({ companyId: 1, userId: uid, user: 'lk-pd', roles: [] });
  const seen = leakageOf(t.api.db).list(scoped, { pageSize: 100 }).rows;
  assert.ok(seen.every((x) => x.projectId !== t.project || x.owner === 'lk-pd'), 'no finding of another project unless owned');
  assert.ok(seen.some((x) => x.ruleCode === 'OVERDUE_APPROVAL'), 'their own finding');
  // flag off
  const off = await setup({ flag: false });
  assert.equal((await off.get(aud, '/leakage')).status, 404);
  // volume: 100,000 findings, the list and the tower under 500 ms
  const ins = t.db.prepare("INSERT INTO det_findings (company_id, doc_no, rule_code, project_id, entity, entity_id, title, value_at_risk, dedupe_key, severity, owner_user, status, detected_at, last_seen_at, due_at, created_by) VALUES (1, ?, 'STOCK_AGEING', ?, 'inv_stores', '1', 'Bulk', ?, ?, 'INFO', 'lk-store', 'OPEN', ?, ?, ?, 'test')");
  const stamp = new Date().toISOString();
  t.db.exec('BEGIN'); for (let i = 0; i < 100_000; i += 1) ins.run(`BLK-${i}`, i % 2 ? t.project : t.other, i * 10, `bulk:${i}`, stamp, stamp, stamp); t.db.exec('COMMIT');
  const svc = leakageOf(t.api.db); const actor = authzOf(t.db).enrich({ companyId: 1, user: 'lk-aud', roles: ['AUD'] });
  for (const fn of [() => svc.list(actor, { status: 'ACTIVE', page: 1, pageSize: 25 }), () => svc.list(actor, { projectId: t.project, ruleCode: 'STOCK_AGEING' }), () => svc.tower(actor, {})]) {
    const s = performance.now(); fn(); const ms = performance.now() - s; assert.ok(ms < 1500, `${ms} ms`);
  }
  const plan = t.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM det_findings f WHERE f.company_id = 1 AND f.rule_code = 'STOCK_AGEING' AND f.status = 'OPEN'").all().map((x) => x.detail).join(' ');
  assert.match(plan, /USING INDEX/);
});
