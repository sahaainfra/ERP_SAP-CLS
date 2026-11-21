import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { monthlyClosesOf } from '../src/server/modules/bi/monthly-close.js';
import { siteOf } from '../src/server/modules/site/index.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 27.07: the monthly closing protocol. T-01 the close is blocked while the material reconciliation is missing, and the lock rejects a
// back-dated DPR edit; FR-01 the checklist with owners and dependencies; FR-02/FR-03 the MIS and the Budget Master frozen when sent; the chain
// QS → PM → PD through the workflow engine (self-approval blocked, return and resubmit); BR-01 lock only when every mandatory step passes;
// amendment; roles and project scope; exports; volume.
const B = '/api/v1/bi';
const W = '/api/v1/workflow';
let seq = 0;
const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `mc-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pcm = as('PCMGR', 'mc-pcm'); const qs = as('QS', 'mc-qs'); const pm = as('PM', 'mc-pm'); const pd = as('PD', 'mc-pd'); const dir = as('DIR', 'mc-dir'); const se = as('SE', 'mc-se');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const prevMonth = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  const { db } = api;
  for (const [n, r] of [['mc-pcm', 'PCMGR'], ['mc-qs', 'QS'], ['mc-pm', 'PM'], ['mc-pd', 'PD'], ['mc-dir', 'DIR'], ['mc-se', 'SE']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Monthly close fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703']) flag.run(code);
  db.exec(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)`);
  const period = prevMonth(todayIST().slice(0, 7));
  const from = `${period}-01`; const to = monthEnd(period);
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'MC-P', 'Metro viaduct', 'ROAD', 'ACTIVE')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'MC-Q', 'Ring road', 'ROAD', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'MC-S1', 'Viaduct site', 'ACTIVE')").run(project).lastInsertRowid);
  db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (1, 'DPR-MC1', ?, ?, ?, 'sup', 'APPROVED')").run(project, site, `${period}-10`);
  db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, store_status, requested_by) VALUES (1, 'MC-ST', 'Viaduct store', 'SITE_STORE', ?, ?, 'ACTIVE', 'fixture')").run(project, site);
  const get = (who, path) => api.call('GET', B + path, who);
  const post = (who, path, body, k = key()) => api.call('POST', B + path, { ...who, body, headers: k });
  /** Everything the checklist needs except the material reconciliation (T-01 first half). */
  const fulfil = () => {
    db.prepare("INSERT INTO att_period_locks (company_id, period_start, period_end, status, locked_at, locked_by) VALUES (1, ?, ?, 'LOCKED', CURRENT_TIMESTAMP, 'hr')").run(from, to);
    db.prepare("INSERT INTO bill_cvr_reports (company_id, doc_no, org_project_id, period, as_of, status, margin_paise, margin_bp) VALUES (1, 'CVR-MC', ?, ?, ?, 'APPROVED', 1500000000, 1250)").run(project, period, to);
    const head = Number(db.prepare("INSERT INTO fin_cost_heads (company_id, code, name) VALUES (1, 'MAT', 'Materials')").run().lastInsertRowid);
    const head2 = Number(db.prepare("INSERT INTO fin_cost_heads (company_id, code, name) VALUES (1, 'LAB', 'Labour')").run().lastInsertRowid);
    const code = Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id) VALUES (1, 'MAT-01', 'Cement and steel', ?)").run(head).lastInsertRowid);
    const code2 = Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id) VALUES (1, 'LAB-01', 'Labour gangs', ?)").run(head2).lastInsertRowid);
    const code3 = Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id) VALUES (1, 'MAT-02', 'Reinforcement', ?)").run(head).lastInsertRowid);
    const fc = Number(db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, eac_total_paise, status) VALUES (1, 'FC-MC', ?, ?, 1, 0, 'APPROVED')").run(project, period).lastInsertRowid);
    const line = db.prepare('INSERT INTO fc_forecast_lines (company_id, forecast_id, cost_code_id, line_label, budget_paise, committed_paise, actual_paise, eac_paise) VALUES (1, ?, ?, ?, ?, ?, ?, ?)');
    line.run(fc, code, 'Cement', 1_000_000_00, 600_000_00, 450_000_00, 1_080_000_00);
    line.run(fc, code3, 'Steel', 500_000_00, 200_000_00, 150_000_00, 480_000_00);
    line.run(fc, code2, 'Gangs', 300_000_00, 0, 120_000_00, 310_000_00);
    const cp = db.prepare('SELECT id FROM core_periods WHERE company_id = 1 AND start_date = ?').get(from);
    db.prepare("INSERT INTO close_periods (company_id, doc_no, period_id, period, status, close_state) VALUES (1, 'CL-MC', ?, ?, 'APPROVED', 'CLOSED')").run(cp.id, period);
  };
  const reconcile = () => db.prepare("INSERT INTO mrc_reconciliations (company_id, doc_no, org_project_id, org_site_id, period, period_start, period_end, requested_by, status) VALUES (1, 'MRC-MC', ?, ?, ?, ?, ?, 'stores', 'APPROVED')").run(project, site, period, from, to);
  const tasks = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act = async (who, instanceId, action = 'approve', comment = 'Checked against the source records') => {
    const task = (await tasks(who)).find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  return { api, db, project, other, site, period, from, to, get, post, fulfil, reconcile, tasks, act };
}

test('27.07 the close is blocked without the material reconciliation, freezes MIS and Budget Master, goes QS → PM → PD and locks the month against back-dated DPRs', async () => {
  const t = await setup();
  const { db } = t;
  assert.equal((await t.get(pcm, `/monthly-closes/board?period=${t.period}`)).status, 404, 'behind ff.bi.p2707');
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2707', 1, 'Monthly close fixture', 0, 1)").run();
  assert.equal((await t.get(se, `/monthly-closes/board?period=${t.period}`)).status, 403, 'a site engineer has no monthly close');
  assert.equal((await t.post(dir, '/monthly-closes', { projectId: t.project, period: t.period })).status, 403, 'a director does not prepare a close');
  assert.equal((await t.post(pcm, '/monthly-closes', { projectId: t.project, period: '2099-01' })).status, 400, 'a future month');
  const created = await t.post(pcm, '/monthly-closes', { projectId: t.project, period: t.period });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const close = created.json.data;
  assert.equal((await t.post(pcm, '/monthly-closes', { projectId: t.project, period: t.period })).status, 409, 'one close per project and month');
  assert.deepEqual(close.checklist.map((c) => c.code), ['DPRS', 'ATTENDANCE', 'MATERIAL_RECON', 'MEASUREMENT', 'CVR', 'COSTS_POSTED', 'FORECAST', 'FINANCE_CLOSED']);
  const step = (v, code) => v.checklist.find((c) => c.code === code);
  assert.equal(step(close, 'DPRS').state, 'PASS');
  assert.equal(step(close, 'MATERIAL_RECON').state, 'OPEN');
  assert.equal(step(close, 'FORECAST').state, 'WAITING', 'the forecast waits for the CVR');
  assert.deepEqual(step(close, 'FORECAST').waitingFor, ['CVR']);

  // T-01 first half: everything but the material reconciliation is done; the close cannot be sent (BR-01)
  t.fulfil();
  const blocked = await t.post(pcm, `/monthly-closes/${close.id}/submit`, { rowVersion: close.rowVersion });
  assert.equal(blocked.status, 422, JSON.stringify(blocked.json));
  assert.match(blocked.json.error.message, /Material reconciliation approved/);
  assert.deepEqual(blocked.json.error.details.map((d) => d.field), ['MATERIAL_RECON']);
  const board = (await t.get(pcm, `/monthly-closes/board?period=${t.period}`)).json.data;
  const card = board.cards.find((c) => c.projectId === t.project);
  assert.deepEqual([card.column, card.passed, card.blocking], ['PREPARING', 7, ['Material reconciliation approved']]);
  assert.equal(board.cards.find((c) => c.projectId === t.other).column, 'NOT_STARTED');

  // with the reconciliation the close is sent; the MIS and the Budget Master are frozen
  t.reconcile();
  assert.equal((await t.post(pcm, `/monthly-closes/${close.id}/submit`, { rowVersion: close.rowVersion + 9 })).status, 409, 'a stale version');
  const sent = await t.post(pcm, `/monthly-closes/${close.id}/submit`, { rowVersion: close.rowVersion });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  const s = sent.json.data;
  assert.equal(s.status, 'SUBMITTED');
  assert.equal(s.frozen, true);
  assert.deepEqual(s.budgetMaster.rows.map((r) => [r.head, r.budget, r.eac, r.variance]), [['LAB', 300000, 310000, -10000], ['MAT', 1500000, 1560000, -60000]]);
  assert.deepEqual(s.budgetMaster.totals, { budget: 1800000, committed: 800000, actual: 720000, eac: 1870000, variance: -70000 });
  assert.equal(s.mis.cvr.margin, 15000000);
  assert.equal(s.mis.cvr.marginPct, 12.5);
  assert.equal(s.mis.cost.eac, 1870000);
  // figures frozen: a later forecast line does not change the sent close
  db.prepare("INSERT INTO fc_forecast_lines (company_id, forecast_id, line_label, budget_paise, eac_paise) VALUES (1, (SELECT id FROM fc_forecasts WHERE doc_no = 'FC-MC'), 'Late line', 100, 100)").run();
  assert.equal((await t.get(pcm, `/monthly-closes/${close.id}`)).json.data.budgetMaster.totals.eac, 1870000);
  db.prepare("DELETE FROM fc_forecast_lines WHERE line_label = 'Late line'").run();

  // the chain: QS (someone else prepared it) → PM → PD; the preparer has no approval task; a return goes back and is resubmitted
  const instance = db.prepare('SELECT workflow_instance_id AS id FROM mc_monthly_closes WHERE id = ?').get(close.id).id;
  assert.ok(instance);
  assert.equal((await t.tasks(pcm)).filter((x) => x.instance.id === instance).length, 0, 'the preparer never approves');
  await t.act(qs, instance);
  await t.act(pm, instance, 'return', 'Add the October labour accruals note');
  assert.equal((await t.get(pcm, `/monthly-closes/${close.id}`)).json.data.status, 'RETURNED');
  const back = (await t.get(pcm, `/monthly-closes/${close.id}`)).json.data;
  assert.equal((await t.post(pcm, `/monthly-closes/${close.id}/submit`, { rowVersion: back.rowVersion })).status, 200);
  await t.act(qs, instance);
  await t.act(pm, instance);
  await t.act(pd, instance);
  const approved = (await t.get(pcm, `/monthly-closes/${close.id}`)).json.data;
  assert.deepEqual([approved.status, approved.lockState], ['APPROVED', 'LOCKED']);
  assert.ok(approved.lockedAt);
  assert.ok(db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bi.monthly_close.locked'").get(), 'the lock event reaches the modules');
  assert.equal((await t.get(pcm, `/monthly-closes/board?period=${t.period}`)).json.data.cards.find((c) => c.projectId === t.project).column, 'LOCKED');

  // T-01 second half: the lock rejects a back-dated DPR change; another month stays open
  const draft = Number(db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (1, 'DPR-LATE', ?, ?, ?, 'sup', 'DRAFT')").run(t.project, t.site, `${t.period}-20`).lastInsertRowid);
  const actor = authzOf(db).enrich({ companyId: 1, user: 'mc-se', roles: ['SE'] });
  assert.throws(() => siteOf(db).dpr.dprs.update(actor, draft, { summary: 'late correction' }), (e) => e.status === 422 && e.code === 'PERIOD_LOCKED' && /next open month/.test(e.message));
  assert.throws(() => siteOf(db).dpr.dprs.submit(actor, draft), (e) => e.code === 'PERIOD_LOCKED');
  const current = Number(db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (1, 'DPR-NOW', ?, ?, ?, 'sup', 'DRAFT')").run(t.project, t.site, todayIST()).lastInsertRowid);
  try { siteOf(db).dpr.dprs.update(actor, current, { summary: 'today' }); } catch (e) { assert.notEqual(e.code, 'PERIOD_LOCKED'); }

  // an approved close is changed only by amendment; the month stays locked meanwhile
  assert.equal((await t.post(pcm, `/monthly-closes/${close.id}/cancel`, { reason: 'try to cancel' })).status, 422);
  const amended = await t.post(pd, `/monthly-closes/${close.id}/amend`, { reason: 'Client certified the October variation late' });
  assert.equal(amended.status, 201, JSON.stringify(amended.json));
  assert.deepEqual([amended.json.data.versionNo, amended.json.data.status, amended.json.data.parentId], [2, 'DRAFT', close.id]);
  assert.throws(() => siteOf(db).dpr.dprs.update(actor, draft, { summary: 'still locked' }), (e) => e.code === 'PERIOD_LOCKED');

  // exports and print from the frozen snapshot; history; audit
  const pdf = await t.api.raw('GET', `${B}/monthly-closes/${close.id}/print?part=mis`, pd);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const csv = await t.api.raw('GET', `${B}/monthly-closes/${close.id}/export?part=budget&format=csv`, dir);
  assert.match(csv.buffer.toString('utf8'), /MAT.*Materials/);
  assert.equal((await t.api.raw('GET', `${B}/monthly-closes/${close.id}/export?part=budget&format=csv`, se)).status, 403);
  const history = (await t.get(pd, `/monthly-closes/${close.id}/history`)).json.data;
  assert.ok(history.approvals.length >= 4);
  assert.ok(db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'mc_monthly_closes' AND action = 'lock'").get());
});

test('27.07 project scope: a PM assigned to one project sees and prepares only that one', async () => {
  const t = await setup();
  const { db } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2707', 1, 'Monthly close fixture', 0, 1)").run();
  authzOf(db).seed();
  const userId = db.prepare("SELECT id FROM iam_users WHERE username = 'mc-pm'").get().id;
  db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`).run(userId, JSON.stringify([t.other]));
  authzOf(db).invalidate();
  const scoped = authzOf(db).enrich({ companyId: 1, userId, user: 'mc-pm', roles: [] });
  const svc = monthlyClosesOf(db);
  assert.deepEqual(svc.board(scoped, { period: t.period }).cards.map((c) => c.projectId), [t.other]);
  assert.throws(() => svc.create(scoped, { projectId: t.project, period: t.period }), { status: 404 });
  const mine = svc.create(scoped, { projectId: t.other, period: t.period });
  assert.equal(mine.status, 'DRAFT');
  const theirs = (await t.post(pcm, '/monthly-closes', { projectId: t.project, period: t.period })).json.data;
  assert.throws(() => svc.get(scoped, theirs.id), { status: 404 });
  assert.equal(svc.list(scoped, {}).total, 1);
});

test('27.07 volume: 100,000 closes keep the list and the board within target and use indexes', async () => {
  const t = await setup();
  const { db } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2707', 1, 'Monthly close fixture', 0, 1)").run();
  const projects = [];
  for (let i = 0; i < 50; i += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, 'Volume', 'ROAD', 'ACTIVE')").run(`V-${i}`).lastInsertRowid));
  const ins = db.prepare("INSERT INTO mc_monthly_closes (company_id, doc_no, project_id, period, status, lock_state, locked_at, created_by) VALUES (1, ?, ?, ?, 'APPROVED', 'LOCKED', CURRENT_TIMESTAMP, 'fixture')");
  db.exec('BEGIN');
  let n = 0;
  for (let y = 1900; n < 100_000; y += 1) for (let m = 1; m <= 12 && n < 100_000; m += 1) for (const p of projects) { if (n >= 100_000) break; ins.run(`MC/V${n}`, p, `${y}-${String(m).padStart(2, '0')}`); n += 1; }
  db.exec('COMMIT');
  for (const path of ['/monthly-closes?page=200', `/monthly-closes?period=1950-06`, `/monthly-closes/board?period=${t.period}`]) {
    let worst = 0;
    for (let i = 0; i < 5; i += 1) { const st = performance.now(); const r = await t.get(pcm, path); worst = Math.max(worst, performance.now() - st); assert.equal(r.status, 200, JSON.stringify(r.json)); }
    assert.ok(worst < 500, `${path} ${Math.round(worst)} ms`);
  }
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM mc_monthly_closes WHERE company_id = 1 AND project_id = 5 AND period = '1950-06' AND lock_state = 'LOCKED' AND deleted_at IS NULL").all().map((r) => r.detail).join(' | ');
  assert.match(plan, /USING INDEX/);
});
