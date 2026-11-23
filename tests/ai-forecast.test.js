import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { backtest, forecastSeries, predict, robustZ } from '../src/server/modules/ai/forecast.js';
import { setupCompany, startApi } from './helpers.js';

// Part 28.03: forecasting, anomaly detection and rate intelligence.
// T-01 back-test error metrics are computed and anomaly flags are raised on seeded outliers; FR-01 ranges and drivers; FR-02 rate forecasts from
// the 15.09 observations and the price index; FR-03 outliers on rates, payments, attendance, issues and paid staff without attendance (D-780);
// FR-04 the model registry with versions, back-test before approval, model owner → CFO/PCMGR; BR-01 forecasts never overwrite actuals and every
// point is labelled; section 8 roles and the source permissions of each forecast and flag.
const A = '/api/v1/ai';
const W = '/api/v1/workflow';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `fc-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const it = as('ITADM', 'fc-it'); const cfo = as('CFO', 'fc-cfo'); const pcm = as('PCMGR', 'fc-pcm'); const proc = as('PROCMGR', 'fc-proc'); const se = as('SE', 'fc-se'); const aud = as('AUD', 'fc-aud');
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const monthsAgo = (k) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 10); };
const mondayAgo = (w) => { const d = new Date(Date.now() - w * 7 * 86_400_000); const wd = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - wd * 86_400_000).toISOString().slice(0, 10); };

test('the statistics: robust z-score, the three methods, ranges that widen, and the back-test metrics', () => {
  assert.ok(Math.abs(robustZ([10, 11, 9, 10, 10, 11, 9, 10], 30)) > 10);
  assert.ok(Math.abs(robustZ([10, 11, 9, 10, 10, 11, 9, 10], 10.5)) < 1);
  assert.equal(robustZ([5, 5, 5, 5], 5), 0);
  const line = Array.from({ length: 20 }, (_, i) => 100 + 5 * i);
  assert.ok(Math.abs(predict('REGRESSION', line, { lookback: 12 }, 1).values[0] - 200) < 1e-6);
  assert.ok(Math.abs(predict('HOLT', line, { alpha: 0.8, beta: 0.5 }, 2).values[1] - 205) < 0.5);
  assert.equal(predict('MOVING_AVERAGE', [1, 2, 3, 4], { window: 2 }, 3).values.join(), '3.5,3.5,3.5');
  // a driver: y follows the index; the regression uses it and says so
  const idx = Array.from({ length: 16 }, (_, i) => 100 + (i % 4) * 3 + i);
  const y = idx.map((v, i) => 2 * v + i);
  const withX = predict('REGRESSION', y, { lookback: 12 }, 1, idx);
  assert.equal(withX.usedDriver, true); assert.ok(withX.drivers.some((d) => /price index/.test(d.name)));
  const noisy = line.map((v, i) => v + (i % 3) - 1);
  const f = forecastSeries('HOLT', noisy, { alpha: 0.5, beta: 0.2 }, 4);
  assert.ok(f.points.every((p) => p.low <= p.value && p.value <= p.high));
  assert.ok(f.points[3].high - f.points[3].low > f.points[0].high - f.points[0].low, 'the range widens with the horizon');
  const bt = backtest('REGRESSION', noisy, { lookback: 8 }, { holdout: 6 });
  assert.equal(bt.n, 6); assert.ok(bt.mae > 0 && bt.mae < 2); assert.ok(bt.mape < 2); assert.ok(bt.rmse >= bt.mae); assert.equal(typeof bt.bias, 'number');
  assert.equal(backtest('HOLT', [1, 2, 3], {}), null, 'too short to back-test');
});

async function setup() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const { db } = api;
  for (const [n, r] of [['fc-it', 'ITADM'], ['fc-cfo', 'CFO'], ['fc-pcm', 'PCMGR'], ['fc-proc', 'PROCMGR'], ['fc-se', 'SE'], ['fc-aud', 'AUD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.ai.p2803', 1, 'Forecast fixture', 0, 1)").run();
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'FC-01', 'Forecast Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'FC-S1', 'Forecast site')").run(project).lastInsertRowid);
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    // FR-02: 24 months of cement observations in Telangana rising ₹ 5 a month with a little noise, and the CEMENT price index
    const cat = db.prepare("SELECT id FROM mdm_item_categories WHERE code = 'CEMENT'").get()?.id ?? Number(db.prepare("INSERT INTO mdm_item_categories (code, name, code_prefix, steward_role) VALUES ('CEMENT', 'Cement', 'CEM', 'PROCMGR')").run().lastInsertRowid);
    const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from) VALUES (1, 'CEM-OPC', 'OPC cement 53', 'MATERIAL', ?, 'bag', '2024-01-01')").run(cat).lastInsertRowid);
    const obs = db.prepare("INSERT INTO rti_observations (company_id, item_id, region_code, obs_date, rate, uom, landed_rate, base_uom, base_landed_rate, source_type, source_id) VALUES (1, ?, 'TS', ?, ?, 'bag', ?, 'bag', ?, 'SURVEY', ?)");
    const ix = db.prepare("INSERT INTO rti_indices (company_id, index_group, region_code, period, index_value) VALUES (1, 'CEMENT', 'TS', ?, ?)");
    for (let k = 23; k >= 1; k -= 1) { const m = 23 - k; const r = 30_000 + 500 * m + (m % 4) * 60 + ((m % 3) - 1) * 40; obs.run(item, monthsAgo(k), r, r, r, `s-${k}`); ix.run(monthsAgo(k).slice(0, 7), Math.round((100 + m * 1.6 + (m % 4) * 0.7) * 10000)); }
    // collections: 18 months of approved receipts of the project
    const rc = db.prepare("INSERT INTO ar_receipts (company_id, doc_no, partner_id, receipt_date, bank_account_id, amount_paise, org_project_id, status) VALUES (1, ?, 1, ?, 1, ?, ?, 'APPROVED')");
    for (let k = 18; k >= 1; k -= 1) rc.run(`RCP-${k}`, monthsAgo(k), 1_000_000_000 + (18 - k) * 20_000_000 + (k % 2) * 5_000_000, project);
    // the schedule: three activities, weekly progress for 12 weeks (A1 about 50 m3 a week)
    const sch = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, calendar_id, start_date) VALUES (1, 'SCH-FC', ?, ?, 'Working schedule', 1, ?)").run(day(120), project, day(120)).lastInsertRowid);
    const act = db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, duration_days, qty, uom, ef) VALUES (1, ?, ?, ?, ?, ?, 'm3', ?)");
    const a1 = Number(act.run(sch, 'A1', 'Raft concrete', 30, 1000, day(-60)).lastInsertRowid); const a2 = Number(act.run(sch, 'A2', 'Columns', 20, 400, day(-90)).lastInsertRowid); const a3 = Number(act.run(sch, 'A3', 'Slabs', 10, 600, day(-100)).lastInsertRowid);
    const pg = db.prepare("INSERT INTO prs_activity_progress (company_id, org_project_id, activity_id, activity_code, work_date, qty, cum_qty, pct_complete, source) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'DPR')");
    let cum = 0;
    for (let w = 12; w >= 1; w -= 1) {
      const n = 12 - w + 1; const q = 50 + ((n % 3) - 1) * 4; cum += q; const d = mondayAgo(w);
      pg.run(project, a1, 'A1', d, q, cum, Math.min(100, (cum / 1000) * 100)); pg.run(project, a2, 'A2', d, 10, n * 10, Math.min(100, n * 2.5)); pg.run(project, a3, 'A3', d, 0, 0, Math.min(100, n * 1.5));
    }
    // FR-03 outliers. Rates: 12 order lines of a steel item near ₹ 60 a kg and one at ₹ 95
    const po = db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by) VALUES (1, ?, ?, ?, 7001, 'APPROVED', 'buyer')");
    const line = db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, rate) VALUES (1, ?, 1, 4242, 'TMT steel', 1000, 'kg', ?)");
    for (let k = 0; k < 12; k += 1) line.run(Number(po.run(`PO-R${k}`, day(100 - k * 5), project).lastInsertRowid), 6000 + ((k % 5) - 2) * 40);
    const badPo = Number(po.run('PO-R-OUT', day(3), project).lastInsertRowid); const badLine = Number(line.run(badPo, 9500).lastInsertRowid);
    // payments: ten of about ₹ 1 lakh to one payee, then ₹ 9 lakh
    const pay = db.prepare("INSERT INTO pmt_payments (company_id, doc_no, proposal_id, line_id, partner_id, payee_name, pay_mode, bank_account_id, amount_paise, released_on, paid_on, pay_status, project_id) VALUES (1, ?, 1, ?, 9001, 'Shree Traders', 'NEFT', 1, ?, ?, ?, 'PAID', ?)");
    for (let k = 0; k < 10; k += 1) pay.run(`PAY-${k}`, 100 + k, 10_000_000 + ((k % 4) - 1) * 300_000, day(60 - k * 5), day(60 - k * 5), project);
    const badPay = Number(pay.run('PAY-OUT', 199, 90_000_000, day(2), day(2), project).lastInsertRowid);
    // attendance: about 20 workers a day at the site for 15 days, then 60 on one day
    const att = db.prepare("INSERT INTO att_daily (company_id, person_type, person_id, work_date, status, computed_at, daily_site_id, site_id, project_id) VALUES (1, 'WORKER', ?, ?, 'PRESENT', ?, ?, ?, ?)");
    for (let d = 20; d >= 6; d -= 1) { const n = 20 + ((d % 3) - 1); for (let p = 1; p <= n; p += 1) att.run(p, day(d), day(d), site, site, project); }
    for (let p = 1; p <= 60; p += 1) att.run(p, day(4), day(4), site, site, project);
    // material issues: about 100 bags a day of one item for 12 days, then 900 in a day
    const iss = db.prepare("INSERT INTO inv_stock_ledger (company_id, doc_no, store_id, bin_id, item_id, txn_type, txn_date, qty_out, balance_qty, balance_value, posted_by, project_id) VALUES (1, ?, 1, 1, 4343, 'ISSUE', ?, ?, 0, 0, 'stores', ?)");
    for (let d = 30; d >= 19; d -= 1) iss.run(`ISS-${d}`, day(d), 100 + ((d % 5) - 2) * 3, project);
    const badIssue = Number(iss.run('ISS-OUT', day(5), 900, project).lastInsertRowid);
    // D-780: last month's payroll pays two employees; one of them has no attendance record in that month
    const period = monthsAgo(1).slice(0, 7);
    db.prepare("INSERT INTO att_daily (company_id, person_type, person_id, work_date, status, computed_at) VALUES (1, 'EMPLOYEE', 501, ?, 'PRESENT', ?)").run(`${period}-10`, `${period}-10`);
    const run = Number(db.prepare("INSERT INTO pay_runs (company_id, doc_no, period, status) VALUES (1, 'PR-FC', ?, 'APPROVED')").run(period).lastInsertRowid);
    const pl = db.prepare("INSERT INTO pay_run_lines (company_id, run_id, employee_id, days_in_month, paid_days, project_id) VALUES (1, ?, ?, 30, 26, ?)");
    pl.run(run, 501, project); const ghost = Number(pl.run(run, 502, project).lastInsertRowid);
    db.exec('PRAGMA foreign_keys = ON');
    const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
    return { api, db, call, project, site, item, a1, badLine, badPay, ghost, badIssue };
  } catch (e) { db.exec('PRAGMA foreign_keys = ON'); throw e; }
}
/** The model owner (here the procurement manager, who may see rates) prepares, back-tests and sends; the project controls manager approves. */
async function approve(t, body, subject, owner = proc) {
  const m = await t.call(owner, 'POST', `${A}/models`, body); assert.equal(m.status, 201, JSON.stringify(m.json));
  const refused = await t.call(owner, 'POST', `${A}/models/${m.json.data.id}/submit`); assert.equal(refused.status, 422, 'the back-test comes first');
  // IT configures models but may not read rates: its back-test is refused, never run with someone else's rights
  assert.equal((await t.call(it, 'POST', `${A}/models/${m.json.data.id}/backtest`, subject)).status, 403);
  const bt = await t.call(owner, 'POST', `${A}/models/${m.json.data.id}/backtest`, subject); assert.equal(bt.status, 200, JSON.stringify(bt.json));
  assert.equal((await t.call(owner, 'POST', `${A}/models/${m.json.data.id}/submit`)).status, 200);
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, pcm)).json.data.rows.find((x) => x.instance?.docId === String(m.json.data.id));
  assert.ok(task, 'the CFO/PCMGR step has a task');
  assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...pcm, headers: key(), body: { action: 'approve', comment: 'Back-test is good' } })).status, 200);
  return { model: m.json.data, backtest: bt.json.data.backtest };
}

test('T-01 FR-01 FR-02 FR-04 BR-01 back-tested models approved CFO/PCMGR feed official forecasts with ranges, drivers and labels', async () => {
  const t = await setup();
  // without an approved model a forecast is a preview, labelled and not stored
  const pre = await t.call(proc, 'GET', `${A}/forecasts?useCase=RATE&itemId=${t.item}&region=TS`);
  assert.equal(pre.status, 200, JSON.stringify(pre.json)); assert.equal(pre.json.data.official, false); assert.match(pre.json.data.label, /preview/);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM aif_forecasts').get().n, 0);

  // T-01: the back-test of the rate model computes MAE, MAPE, RMSE, bias and range coverage against the naive forecast
  const { model, backtest: bt } = await approve(t, { code: 'RATE_REG', name: 'Cement rate regression', useCase: 'RATE', method: 'REGRESSION', params: { lookback: 12 }, horizon: 6 }, { itemId: t.item, region: 'TS' });
  assert.ok(bt.n >= 3 && bt.mae > 0 && bt.mape > 0 && bt.mape < 5, JSON.stringify(bt)); assert.ok(bt.rmse >= bt.mae); assert.equal(typeof bt.bias, 'number'); assert.ok(bt.naive.mae > 0); assert.ok(bt.skill > 0, 'better than the last value');
  assert.equal(bt.rows.length, bt.n); assert.ok(bt.rows.every((r) => /^\d{4}-\d{2}$/.test(r.period)));
  const got = (await t.call(it, 'GET', `${A}/models/${model.id}`)).json.data; assert.equal(got.status, 'APPROVED'); assert.equal(got.official, true);
  const hist = (await t.call(it, 'GET', `${A}/models/${model.id}/history`)).json.data; assert.ok(hist.approvals.some((h) => h.actor === 'fc-pcm'));
  const xl = await t.api.raw('GET', `${A}/models/${model.id}/backtest/export?format=csv`, cfo); assert.equal(xl.status, 200); assert.match(xl.buffer.toString('utf8'), /Range low/);

  // FR-01, FR-02: the official forecast: ranges widen, drivers include the price index, labels separate actual/calculated from forecast
  const f = (await t.call(proc, 'GET', `${A}/forecasts?useCase=RATE&itemId=${t.item}&region=TS`)).json.data;
  assert.equal(f.official, true); assert.equal(f.label, 'Forecast — statistical, verify'); assert.equal(f.model.code, 'RATE_REG');
  const fc = f.points.filter((p) => p.kind === 'FORECAST'); assert.equal(fc.length, 6);
  assert.ok(f.points.filter((p) => p.kind === 'CALCULATED').length >= 20); assert.ok(fc.every((p) => p.low <= p.value && p.value <= p.high));
  assert.ok(fc[5].high - fc[5].low > fc[0].high - fc[0].low);
  assert.ok(fc[0].value > f.history.at(-1).value - 20, 'the rising trend continues');
  assert.ok(f.drivers.some((d) => /price index/i.test(d.name)), JSON.stringify(f.drivers));
  assert.ok(f.backtest.mape != null); assert.match(f.sources[0].route, /rate-intelligence/);
  // BR-01: the observations are untouched and the forecast is kept apart
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM rti_observations').get().n, 23);
  const kept = t.db.prepare('SELECT * FROM aif_forecasts').all(); assert.equal(kept.length, 1); assert.equal(kept[0].use_case, 'RATE');
  await t.call(proc, 'GET', `${A}/forecasts?useCase=RATE&itemId=${t.item}&region=TS`); assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM aif_forecasts').get().n, 1, 'one a day per model and subject');
  const latest = (await t.call(proc, 'GET', `${A}/forecasts/latest`)).json.data; assert.equal(latest[0].model, 'RATE_REG v1');

  // completion and productivity (previews with the default method): a completion date with its range; the remaining quantity's finish
  const done = (await t.call(pcm, 'GET', `${A}/forecasts?useCase=COMPLETION&projectId=${t.project}`)).json.data;
  assert.equal(done.official, false); assert.ok(done.points.filter((p) => p.kind === 'CALCULATED').length >= 10);
  assert.ok(done.completion.date && done.completion.early <= done.completion.date && (!done.completion.late || done.completion.late >= done.completion.date), JSON.stringify(done.completion));
  const prod = (await t.call(pcm, 'GET', `${A}/forecasts?useCase=PRODUCTIVITY&projectId=${t.project}&activityId=${t.a1}`)).json.data;
  assert.ok(Math.abs(prod.next.value - 50) < 6, JSON.stringify(prod.next)); assert.ok(prod.completion.remainingQty > 300 && prod.completion.date);
  const col = (await t.call(cfo, 'GET', `${A}/forecasts?useCase=COLLECTIONS&projectId=${t.project}`)).json.data;
  assert.ok(col.points.filter((p) => p.kind === 'ACTUAL').length >= 17); assert.ok(col.next.value > 1_000_000);

  // section 8: roles and the source permissions behind each forecast
  assert.equal((await t.call(se, 'GET', `${A}/forecasts?useCase=RATE&itemId=${t.item}`)).status, 403);
  assert.equal((await t.call(proc, 'POST', `${A}/models/${model.id}/submit`)).status, 422, 'an approved version is not sent again');
  assert.equal((await t.call(se, 'POST', `${A}/models`, { code: 'X_MA', name: 'Not mine', useCase: 'RATE', method: 'MOVING_AVERAGE' })).status, 403);
  assert.equal((await t.call(it, 'POST', `${A}/models`, { code: 'BAD', name: 'Bad window', useCase: 'RATE', method: 'MOVING_AVERAGE', params: { window: 99 } })).status, 422);
  assert.equal((await t.call(proc, 'GET', `${A}/forecasts?useCase=RATE&itemId=${t.item}&modelId=${model.id}`)).status, 200, 'the official model by id');
  // a second version: drafted from the approved one, back-tested, approved by the CFO; the first is superseded
  const v2 = await t.call(proc, 'POST', `${A}/models/${model.id}/amend`, { reason: 'Shorter lookback after the review' }); assert.equal(v2.status, 201); assert.equal(v2.json.data.version, 2);
  const patched = await t.call(proc, 'PATCH', `${A}/models/${v2.json.data.id}`, { params: { lookback: 8 }, rowVersion: v2.json.data.rowVersion }); assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal((await t.call(proc, 'POST', `${A}/models/${v2.json.data.id}/backtest`, { itemId: t.item, region: 'TS' })).status, 200);
  assert.equal((await t.call(proc, 'POST', `${A}/models/${v2.json.data.id}/submit`)).status, 200);
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, cfo)).json.data.rows.find((x) => x.instance?.docId === String(v2.json.data.id));
  assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...cfo, headers: key(), body: { action: 'approve', comment: 'ok' } })).status, 200);
  assert.equal((await t.call(it, 'GET', `${A}/models/${model.id}`)).json.data.status, 'SUPERSEDED');
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'aif_models' AND action = 'backtest'").get(), 'audited');
  // retire: immediate, back to previews
  assert.equal((await t.call(proc, 'POST', `${A}/models/${v2.json.data.id}/retire`, { reason: 'Rates broke trend after the levy' })).status, 200);
  assert.equal((await t.call(proc, 'GET', `${A}/forecasts?useCase=RATE&itemId=${t.item}&region=TS`)).json.data.official, false);
});

test('T-01 FR-03 anomaly flags on seeded outliers (rates, payments, attendance, paid without attendance), visible by source permission, reviewed by a person', async () => {
  const t = await setup();
  assert.equal((await t.call(proc, 'POST', `${A}/anomalies/run`)).status, 403, 'the procurement manager reviews but does not run the detection');
  const run = await t.call(pcm, 'POST', `${A}/anomalies/run`); assert.equal(run.status, 200, JSON.stringify(run.json));
  const all = t.db.prepare('SELECT kind, source_type, source_id FROM aif_anomalies').all();
  const flagged = (kind, id) => all.some((a) => a.kind === kind && a.source_id === String(id));
  assert.ok(flagged('RATE', t.badLine), JSON.stringify(all)); assert.ok(flagged('PAYMENT', t.badPay)); assert.ok(flagged('PAYROLL_NO_ATTENDANCE', t.ghost)); assert.ok(flagged('CONSUMPTION', t.badIssue));
  assert.ok(all.some((a) => a.kind === 'ATTENDANCE')); assert.equal(all.filter((a) => a.kind === 'PAYROLL_NO_ATTENDANCE').length, 1, 'the employee with attendance is not flagged');
  assert.equal(all.filter((a) => a.kind === 'RATE').length, 1, 'ordinary rates are not flagged');
  // a second run adds nothing (one flag per source record)
  assert.equal((await t.call(pcm, 'POST', `${A}/anomalies/run`)).json.data.flagged, 0);
  // the procurement manager sees the rate flag (purchase orders) but not the payroll one (no payroll right)
  const mine = (await t.call(proc, 'GET', `${A}/anomalies`)).json.data;
  assert.ok(mine.rows.some((r) => r.kind === 'RATE')); assert.ok(!mine.rows.some((r) => r.kind === 'PAYROLL_NO_ATTENDANCE'));
  const rate = mine.rows.find((r) => r.kind === 'RATE'); assert.match(rate.route, /purchase-orders/); assert.ok(rate.score > 3.5); assert.ok(rate.expected < rate.observed);
  assert.equal((await t.call(se, 'GET', `${A}/anomalies`)).status, 403);
  // review: a person confirms or dismisses, with a note; audited, an event, and it stays reviewed
  const rev = await t.call(proc, 'POST', `${A}/anomalies/${rate.id}/review`, { outcome: 'CONFIRMED', note: 'Vendor billed the wrong grade; recovering' });
  assert.equal(rev.status, 200); assert.equal(rev.json.data.status, 'CONFIRMED'); assert.equal(rev.json.data.reviewedBy, 'fc-proc');
  assert.equal((await t.call(proc, 'POST', `${A}/anomalies/${rate.id}/review`, { outcome: 'DISMISSED', note: 'second time' })).status, 422);
  assert.ok(t.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'ai.anomaly.reviewed'").get() || t.db.prepare("SELECT 1 FROM core_events WHERE type = 'ai.anomaly.reviewed'").get());
  const ghostRow = t.db.prepare("SELECT id FROM aif_anomalies WHERE kind = 'PAYROLL_NO_ATTENDANCE'").get();
  assert.equal((await t.call(proc, 'POST', `${A}/anomalies/${ghostRow.id}/review`, { outcome: 'DISMISSED', note: 'not mine to judge' })).status, 404, 'a flag behind a source the person may not see');
  const audView = (await t.call(aud, 'GET', `${A}/anomalies?status=ALL`)).json.data; assert.ok(audView.total >= 1);
  assert.equal((await t.call(aud, 'POST', `${A}/anomalies/${ghostRow.id}/review`, { outcome: 'DISMISSED', note: 'auditor may not review' })).status, 403);
});

test('volume: 100,000 anomaly flags list in well under 500 ms with an index', async () => {
  const t = await setup();
  const ins = t.db.prepare("INSERT INTO aif_anomalies (company_id, kind, source_type, source_id, project_id, subject, observed, expected, score, detail, status, detected_at) VALUES (1, ?, 'x', ?, ?, 's', 1, 1, ?, 'd', ?, '2026-11-01')");
  t.db.exec('BEGIN'); for (let i = 0; i < 100_000; i += 1) ins.run(['RATE', 'PAYMENT', 'ATTENDANCE', 'CONSUMPTION'][i % 4], String(i), t.project, (i % 50) / 10, i % 3 ? 'OPEN' : 'DISMISSED'); t.db.exec('COMMIT');
  const t0 = performance.now(); const r = await t.call(proc, 'GET', `${A}/anomalies?kind=RATE&pageSize=25`); const ms = performance.now() - t0;
  assert.equal(r.status, 200); assert.equal(r.json.data.rows.length, 25); assert.ok(ms < 500, `${ms} ms`);
  const plan = t.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM aif_anomalies a WHERE a.company_id = 1 AND a.status = 'OPEN' AND a.kind = 'RATE'").all().map((x) => x.detail).join(' ');
  assert.match(plan, /ix_aif_anomalies_status/);
});
