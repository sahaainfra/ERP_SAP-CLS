import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 12.01: project budget. T-01 the budget generated from the signed-off baseline pack and the BOQ norms has, by cost code, exactly the sums of BOQ quantity x norm (with its wastage) x rate. Also: the preview with what is missing, adjustments with a reason beside the
// generated values (FR-01), views by WBS, cost head, resource, work package and control account that reconcile (FR-02), overheads, contingency and management reserve not on a WBS (FR-03, FR-04), S-curve and manual phasing that add up (FR-05), the margin against the
// contract value with its warning (FR-06, BR-01), quantity and amount on material, labour and plant lines (BR-02), versions with a locked original (FR-07), the approval chain, roles, isolation and the flag.
const B = '/api/v1/bud';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `bd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const qs = as('QS', 'bqs1'); const pcm = as('PCMGR', 'bpcm1'); const pm = as('PM', 'bpm1'); const pd = as('PD', 'bpd1'); const dir = as('DIR', 'bdir1'); const se = as('SE', 'bse1'); const qs2 = as('QS', 'bqs1', '2');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const R = (paise) => (paise / 100).toFixed(2);

async function setup({ contract = 1_000_000_000 } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api);
  for (const [n, r] of [['bqs1', ['QS']], ['bpcm1', ['PCMGR']], ['bpm1', ['PM']], ['bpd1', ['PD']], ['bdir1', ['DIR']], ['bse1', ['SE']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  const d = api.db;
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'BDA', 'Alpha towers', 'BUILDING')").run().lastInsertRowid);
  d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'bpm1', ?, '2026-01-01', '2026-12-31', 'test')").run(pid, contract);
  const wbs = (code, name, parent, ca) => Number(d.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, is_control_account, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(pid, parent, code, name, parent ? 2 : 1, ca, 'test').lastInsertRowid);
  const w1 = wbs('W1', 'Superstructure', null, 1); const w11 = wbs('W1.1', 'Columns', w1, 0); const w2 = wbs('W2', 'Foundations', null, 1);
  const wp = Number(d.prepare("INSERT INTO proj_work_packages (company_id, project_id, code, name, wbs_ids_json, created_by) VALUES (1, ?, 'WP1', 'Concrete works', ?, 'test')").run(pid, JSON.stringify([w11, w2])).lastInsertRowid);
  const snapshot = {
    boq: [
      { itemNo: '1.1', description: 'M25 concrete', uom: 'cum', qty: '100', costRate: '4842', norms: { lines: [{ type: 'MATERIAL', description: 'Cement', uom: 'bag', rate: '380' }, { type: 'LABOUR', description: 'Mason', uom: 'day', rate: '900' }] } },
      { itemNo: '1.2', description: 'Excavation in soil', uom: 'cum', qty: '200', costRate: '150', norms: { lines: [] } },
    ],
    boqCost: '484200.00', indirects: [{ category: 'Site overhead', description: 'Site office and staff', basis: 'LS', amount: '100000.00' }], commercials: { contingency: '50000.00', risk: '30000.00' },
  };
  d.prepare("INSERT INTO proj_baseline_packs (company_id, doc_no, doc_date, pack_no, project_id, contract_value, snapshot_json, status, created_by) VALUES (1, 'BP/1', '2026-01-02', 1, ?, ?, ?, 'APPROVED', 'test')").run(pid, contract, JSON.stringify(snapshot));
  const ver = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (1, 'BQ/1', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 'test')").run(pid).lastInsertRowid);
  const item = (code, desc, uom, qty) => Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, created_by) VALUES (1, ?, 'ITEM', ?, ?, ?, ?, 0, 0, 'test')").run(ver, code, desc, uom, qty).lastInsertRowid);
  const i1 = item('1.1', 'M25 concrete', 'cum', 100_000); const i2 = item('1.2', 'Excavation in soil', 'cum', 200_000);
  const split = (line, w, qty) => d.prepare('INSERT INTO proj_boq_line_wbs (company_id, line_id, wbs_id, qty, created_by) VALUES (1, ?, ?, ?, ?)').run(line, w, qty, 'test');
  split(i1, w11, 60_000); split(i1, w2, 40_000); split(i2, w11, 200_000);
  const norm = (type, desc, uom, q, wst) => d.prepare('INSERT INTO proj_boq_line_norms (company_id, line_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(i1, type, desc, uom, q, wst, 'test');
  norm('MATERIAL', 'Cement', 'bag', 8000, 50_000); norm('LABOUR', 'Mason', 'day', 1500, 0);
  const call = (who, method, path, body, k = key()) => api.call(method, `${B}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  return { api, call, act, pid, w1, w11, w2, wp };
}
const generate = async (t, over = {}) => { const g = await t.call(qs, 'POST', '/generate', { projectId: t.pid, ...over }); assert.equal(g.status, 201, JSON.stringify(g.json)); return g.json.data; };
const phased = async (t, id) => { const p = await t.call(qs, 'POST', `/budgets/${id}/phasing/generate`, { method: 'SCURVE', profile: 'SCURVE' }); assert.equal(p.status, 200, JSON.stringify(p.json)); return p.json.data; };
const approve = async (t, id, { director = false } = {}) => {
  const s = await t.call(qs, 'POST', `/budgets/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const inst = s.json.data.workflowInstanceId;
  await t.act(pcm, inst); await t.act(pm, inst); await t.act(pd, inst); if (director) await t.act(dir, inst);
  return (await t.call(qs, 'GET', `/budgets/${id}`)).json.data;
};

test('T-01 the generated lines equal BOQ quantity x norm (with wastage) x rate, by cost code, and the totals reconcile to the baseline', async () => {
  const t = await setup();
  const pv = (await t.call(qs, 'GET', `/generate/preview?projectId=${t.pid}`)).json.data;
  assert.deepEqual([pv.pack.docNo, pv.boqVersion.docNo, pv.canGenerate, pv.unratedCount, pv.issues.length], ['BP/1', 'BQ/1', true, 0, 0]);
  assert.deepEqual([pv.totals.direct, pv.totals.baselineCost, pv.totals.differenceToBaseline, pv.totals.overhead, pv.totals.contingency, pv.totals.reserve], ['484200.00', '484200.00', '0.00', '100000.00', '50000.00', '30000.00']);
  assert.equal((await t.api.db.prepare('SELECT COUNT(*) AS n FROM bud_budgets').get()).n, 0, 'the preview saves nothing');
  const g = await generate(t);
  assert.deepEqual([g.status, g.vtype, g.versionNo, g.docNo.startsWith('BUD') || g.docNo.includes('BUD'), g.linesCount], ['DRAFT', 'ORIGINAL', 1, true, 8]);
  const sums = Object.fromEntries(t.api.db.prepare("SELECT c.code, SUM(l.amount) AS a FROM bud_lines l JOIN fin_cost_codes c ON c.id = l.cost_code_id WHERE l.budget_id = ? AND l.line_kind = 'DIRECT' GROUP BY c.code").all(g.id).map((x) => [x.code, x.a]));
  // cement: (60 + 40) cum x 8 bags x 1.05 x 380 = 319 200; mason: 100 cum x 1.5 days x 900 = 135 000; excavation 200 cum x 150 = 30 000 (no norms: the cost rate of the baseline)
  assert.deepEqual(sums, { 'LAB-SKL': 13_500_000, 'MAT-OTH': 31_920_000 + 3_000_000 }, 'by cost code');
  assert.deepEqual([g.directTotal, g.overheadTotal, g.contingencyTotal, g.reserveTotal, g.totalAmount, g.baselineCost], ['484200.00', '100000.00', '50000.00', '30000.00', '664200.00', '484200.00']);
  const cement = g.lines.filter((l) => l.resourceName === 'Cement'); assert.deepEqual(cement.map((l) => [l.wbsCode, l.qty, l.rate, l.amount]), [['W1.1', 504, 380, '191520.00'], ['W2', 336, 380, '127680.00']]);
  assert.ok(g.lines.every((l) => l.genAmount === l.amount), 'the generated values are kept beside the lines');
  assert.deepEqual(g.lines.filter((l) => ['OVERHEAD', 'CONTINGENCY', 'RESERVE'].includes(l.lineKind)).map((l) => [l.lineKind, l.wbsId, l.amount]), [['OVERHEAD', null, '100000.00'], ['CONTINGENCY', null, '50000.00'], ['RESERVE', null, '30000.00']]);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bud.budget.generated'").get());
  assert.equal((await t.call(qs, 'POST', '/generate', { projectId: t.pid })).status, 409, 'one budget in preparation at a time');
});

test('preview shows what is missing: unrated norms, an unsigned baseline and unmapped items; rates can be given', async () => {
  const t = await setup();
  t.api.db.prepare("UPDATE proj_baseline_packs SET snapshot_json = REPLACE(snapshot_json, '\"Mason\"', '\"Carpenter\"')").run();
  const pv = (await t.call(qs, 'GET', `/generate/preview?projectId=${t.pid}`)).json.data;
  assert.deepEqual([pv.unratedCount > 0, pv.canGenerate, pv.unrated.map((u) => u.description)], [true, false, ['Mason']]);
  assert.equal((await t.call(qs, 'POST', '/generate', { projectId: t.pid })).status, 201, 'a budget with unrated lines is created as a draft');
  const t2 = await setup(); t2.api.db.prepare("UPDATE proj_baseline_packs SET status = 'DRAFT'").run();
  const p2 = (await t2.call(qs, 'GET', `/generate/preview?projectId=${t2.pid}`)).json.data; assert.deepEqual([p2.canGenerate, p2.issues.map((i) => i.code)], [false, ['PACK']]);
  assert.equal((await t2.call(qs, 'POST', '/generate', { projectId: t2.pid })).status, 422);
  const t3 = await setup(); t3.api.db.prepare('DELETE FROM proj_boq_line_wbs WHERE line_id = (SELECT id FROM proj_boq_lines WHERE item_code = \'1.2\')').run();
  assert.ok((await t3.call(qs, 'GET', `/generate/preview?projectId=${t3.pid}`)).json.data.issues.some((i) => i.code === 'UNMAPPED'));
  const t4 = await setup(); t4.api.db.prepare("UPDATE proj_baseline_packs SET snapshot_json = REPLACE(snapshot_json, '\"Mason\"', '\"Carpenter\"')").run();
  const fixed = (await t4.call(qs, 'POST', '/generate/preview', { projectId: t4.pid, rates: [{ type: 'LABOUR', description: 'Mason', rate: 1000 }] })).json.data; assert.deepEqual([fixed.unratedCount, fixed.totals.direct], [0, '499200.00']);
});

test('adjustments keep the generated values and need a reason; BR-02 quantity on material, labour and plant lines; overhead, contingency and reserve lines', async () => {
  const t = await setup(); const g = await generate(t); const cement = g.lines.find((l) => l.resourceName === 'Cement' && l.wbsCode === 'W2');
  assert.equal((await t.call(qs, 'PATCH', `/lines/${cement.id}`, { rate: 400 })).status, 400, 'a reason is needed');
  const a = (await t.call(qs, 'PATCH', `/lines/${cement.id}`, { rate: 400, reason: 'Supplier quote of March' })).json.data;
  assert.deepEqual([a.rate, a.amount, a.genRate, a.genAmount, a.adjusted, a.adjustReason, a.adjustedBy], [400, '134400.00', 380, '127680.00', true, 'Supplier quote of March', 'bqs1']);
  assert.equal((await t.call(qs, 'GET', `/budgets/${g.id}`)).json.data.directTotal, '490920.00', 'the totals follow');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'bud_lines' AND action = 'adjust' AND reason = 'Supplier quote of March'").get(), 'audited with the reason');
  // BR-02
  const base = { lineKind: 'DIRECT', wbsId: t.w2, costCodeId: t.api.db.prepare("SELECT id FROM fin_cost_codes WHERE code = 'PLT-HIRE'").get().id, resourceType: 'EQUIPMENT', resourceName: 'Excavator hire', uom: 'hr', reason: 'Not in the norms' };
  const noQty = await t.call(qs, 'POST', `/budgets/${g.id}/lines`, { ...base, amount: 50000 }); assert.equal(noQty.status, 400); assert.ok(noQty.json.error.details.some((d) => d.field === 'qty'));
  const eq = await t.call(qs, 'POST', `/budgets/${g.id}/lines`, { ...base, qty: 100, amount: 50000 }); assert.equal(eq.status, 201, JSON.stringify(eq.json)); assert.deepEqual([eq.json.data.qty, eq.json.data.rate, eq.json.data.amount, eq.json.data.origin], [100, 500, '50000.00', 'MANUAL']);
  assert.equal((await t.call(qs, 'POST', `/budgets/${g.id}/lines`, { ...base, resourceType: 'SUBCONTRACT', resourceName: 'Waterproofing', wbsId: null, amount: 1000 })).status, 400, 'a direct line sits on a WBS node');
  const rs = await t.call(qs, 'POST', `/budgets/${g.id}/lines`, { lineKind: 'RESERVE', wbsId: t.w2, resourceName: 'Reserve', amount: 100, reason: 'x reserve' }); assert.equal(rs.status, 400, 'a reserve is not on a WBS node');
  const oh = await t.call(qs, 'POST', `/budgets/${g.id}/lines`, { lineKind: 'OVERHEAD', costCodeId: t.api.db.prepare("SELECT id FROM fin_cost_codes WHERE code = 'HOH-ADMIN'").get().id, resourceName: 'Head office charge', amount: 20000, reason: 'HO allocation' }); assert.equal(oh.status, 201, JSON.stringify(oh.json));
  assert.equal((await t.call(qs, 'GET', `/budgets/${g.id}`)).json.data.overheadTotal, '120000.00');
  assert.equal((await t.call(qs, 'DELETE', `/lines/${oh.json.data.id}?reason=Not%20needed`)).status, 200);
  assert.equal((await t.call(se, 'PATCH', `/lines/${cement.id}`, { rate: 1, reason: 'no rights here' })).status, 403);
  const imp = await t.call(qs, 'POST', `/budgets/${g.id}/import`, { rows: [{ lineKind: 'DIRECT', wbsId: t.w2, costCodeId: base.costCodeId, resourceType: 'TRANSPORT', resourceName: 'Cartage', amount: 3000 }, { lineKind: 'DIRECT', resourceName: 'Broken row', amount: 10 }] });
  assert.deepEqual([imp.json.data.created, imp.json.data.errors.length], [1, 1]);
});

test('views by WBS, cost head, resource, work package and control account reconcile to the total (FR-02)', async () => {
  const t = await setup(); const g = await generate(t);
  for (const by of ['wbs', 'cost_head', 'resource', 'work_package', 'control_account']) {
    const v = (await t.call(qs, 'GET', `/budgets/${g.id}/views?by=${by}`)).json.data; assert.equal(v.reconciled, true, by); assert.equal(R(v.rows.reduce((a, x) => a + x.amountPaise, 0)), g.totalAmount, by);
  }
  const wbs = (await t.call(qs, 'GET', `/budgets/${g.id}/views?by=wbs`)).json.data.rows; assert.deepEqual(wbs.find((x) => x.label.startsWith('W2')).amount, '181680.00'); assert.ok(wbs.some((x) => x.label.startsWith('Not allocated: Contingency')), 'contingency is not on a WBS node');
  const ca = (await t.call(qs, 'GET', `/budgets/${g.id}/views?by=control_account`)).json.data.rows; assert.equal(ca.find((x) => x.label.startsWith('W1 ')).amount, '302520.00', 'W1.1 rolls up into its control account W1');
  const wp = (await t.call(qs, 'GET', `/budgets/${g.id}/views?by=work_package`)).json.data.rows; assert.equal(wp.find((x) => x.label.startsWith('WP1')).amount, '484200.00');
  assert.equal((await t.call(qs, 'GET', `/budgets/${g.id}/views?by=nonsense`)).status, 400);
});

test('phasing: an S-curve spreads every line over the contract period and adds up; manual phasing of a line must add up; a changed amount drops its phasing', async () => {
  const t = await setup(); const g = await generate(t);
  assert.equal((await t.call(qs, 'POST', `/budgets/${g.id}/phasing/generate`, { method: 'SCHEDULE' })).status, 422, 'the schedule (13.02) is not built yet');
  const p = await phased(t, g.id); assert.deepEqual([p.method, p.periods.length, p.reconciled, p.phasedTotal, p.unphasedLines], ['SCURVE', 12, true, '664200.00', 0]);
  assert.equal(p.periods.at(-1).cumulativePct, 100); const first = Number(p.periods[0].amount); const mid = Number(p.periods[5].amount); assert.ok(mid > first, 'slow start, fast middle');
  const line = g.lines[0]; const lp = (await t.call(qs, 'GET', `/lines/${line.id}/phasing`)).json.data; assert.equal(R(lp.rows.reduce((a, x) => a + Number(x.amount) * 100, 0)), line.amount);
  assert.equal((await t.call(qs, 'PUT', `/lines/${line.id}/phasing`, { rows: [{ period: '2026-01', amount: 1 }] })).status, 422, 'the months must add up');
  const set = await t.call(qs, 'PUT', `/lines/${line.id}/phasing`, { rows: [{ period: '2026-03', amount: Number(line.amount) / 2 }, { period: '2026-04', amount: Number(line.amount) / 2 }] }); assert.equal(set.status, 200, JSON.stringify(set.json)); assert.equal(set.json.data.rows.length, 2);
  assert.equal((await t.call(qs, 'PATCH', `/lines/${line.id}`, { amount: Number(line.amount) + 100, reason: 'Quantity rechecked' })).status, 200);
  const after = (await t.call(qs, 'GET', `/budgets/${g.id}/phasing`)).json.data; assert.deepEqual([after.reconciled, after.unphasedLines], [false, 1], 'the changed line must be phased again');
  const lin = await t.call(qs, 'POST', `/budgets/${g.id}/phasing/generate`, { method: 'SCURVE', profile: 'LINEAR', from: '2026-01', to: '2026-04' }); assert.deepEqual([lin.json.data.periods.length, lin.json.data.reconciled], [4, true]);
});

test('the margin against the contract value warns when direct cost, overheads and contingency pass contract value less the target margin (BR-01)', async () => {
  const t = await setup(); const g = await generate(t);
  const m = (await t.call(qs, 'GET', `/budgets/${g.id}/margin`)).json.data; assert.deepEqual([m.contractValue, m.costBasis, m.margin, m.marginPct, m.reserve, m.warning, m.targetMarginPct], ['10000000.00', '634200.00', '9365800.00', 93.66, '30000.00', false, 5]);
  const hi = (await t.call(qs, 'PATCH', `/budgets/${g.id}`, { targetMarginPct: 95 })).json.data; assert.deepEqual([hi.margin.warning, hi.margin.limit, hi.margin.over], [true, '500000.00', '134200.00']);
  await phased(t, g.id); const s = await t.call(qs, 'POST', `/budgets/${g.id}/submit`); assert.equal(s.status, 202, 'a warning does not stop the budget');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'bud.budget.margin_warning' AND user_ref = 'bpm1'").get().n, 1, 'the project manager is told');
});

test('submit needs a complete budget; the chain PCMGR, PM, PD signs; approval locks the original; the event carries the totals', async () => {
  const t = await setup(); const g = await generate(t);
  const early = await t.call(qs, 'POST', `/budgets/${g.id}/submit`); assert.equal(early.status, 422); assert.match(early.json.error.message, /phased/);
  await phased(t, g.id);
  assert.equal((await t.call(se, 'POST', `/budgets/${g.id}/submit`)).status, 403);
  const s = await t.call(qs, 'POST', `/budgets/${g.id}/submit`); assert.equal(s.status, 202); const inst = s.json.data.workflowInstanceId; assert.equal(s.json.data.status, 'SUBMITTED');
  assert.equal((await t.call(qs, 'PATCH', `/lines/${g.lines[0].id}`, { rate: 1, reason: 'while waiting' })).status, 409, 'locked while waiting');
  assert.ok(!(await t.api.call('GET', `${W}/tasks?mine=assigned`, qs)).json.data.rows.some((x) => x.instance.id === inst), 'the preparer never signs');
  await t.act(pcm, inst); await t.act(pm, inst); const after = await t.act(pd, inst); void after;
  const done = (await t.call(qs, 'GET', `/budgets/${g.id}`)).json.data; assert.deepEqual([done.status, done.locked, done.approvedBy, done.directorRequired], ['APPROVED', true, 'bpd1', false]);
  assert.equal((await t.call(qs, 'PATCH', `/lines/${g.lines[0].id}`, { rate: 1, reason: 'after approval' })).status, 409, 'an approved budget is locked');
  const ev = JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'bud.budget.approved'").get().payload).data; assert.deepEqual([ev.total, ev.versionNo, ev.contractValue, ev.byCostHead.length > 0], ['664200.00', 1, '10000000.00', true]);
  assert.equal((await t.call(qs, 'POST', '/generate', { projectId: t.pid })).status, 409);
  const h = (await t.call(qs, 'GET', `/budgets/${g.id}/history`)).json.data; assert.ok(h.approvals.length >= 3 && h.audit.some((a) => a.action === 'approve'));
});

test('a revision copies the lines, replaces the original when approved, and the original stays locked until then (FR-07)', async () => {
  const t = await setup(); const g = await generate(t); await phased(t, g.id); await approve(t, g.id);
  assert.equal((await t.call(se, 'POST', `/budgets/${g.id}/amend`, { reason: 'Client variation' })).status, 403);
  assert.equal((await t.call(pm, 'POST', `/budgets/${g.id}/amend`, { reason: 'Client variation' })).status, 403, 'the project manager reviews, not revises');
  assert.equal((await t.call(qs, 'POST', `/budgets/${g.id}/amend`, { reason: 'x' })).status, 400);
  const r = await t.call(qs, 'POST', `/budgets/${g.id}/amend`, { reason: 'Client variation VO-3 adds a basement' }); assert.equal(r.status, 201, JSON.stringify(r.json));
  const rev = r.json.data; assert.deepEqual([rev.vtype, rev.versionNo, rev.status, rev.parentBudgetId, rev.linesCount, rev.totalAmount], ['REVISED', 2, 'DRAFT', g.id, 8, '664200.00']);
  assert.equal((await t.call(qs, 'POST', `/budgets/${g.id}/amend`, { reason: 'Second try at the same time' })).status, 409);
  assert.equal((await t.call(qs, 'GET', `/budgets/${g.id}`)).json.data.status, 'APPROVED', 'the original stays in force and locked');
  const cement = rev.lines.find((l) => l.resourceName === 'Cement' && l.wbsCode === 'W2'); assert.equal((await t.call(qs, 'PATCH', `/lines/${cement.id}`, { rate: 420, reason: 'Price rise' })).status, 200);
  assert.equal((await t.call(qs, 'GET', `/budgets/${g.id}`)).json.data.totalAmount, '664200.00', 'the original did not move');
  await phased(t, rev.id); const done = await approve(t, rev.id); assert.equal(done.status, 'APPROVED'); const old = (await t.call(qs, 'GET', `/budgets/${g.id}`)).json.data;
  assert.deepEqual([old.status, done.versions.map((v) => [v.versionNo, v.status])], ['SUPERSEDED', [[1, 'SUPERSEDED'], [2, 'APPROVED']]]);
});

test('above ₹ 50 crore the director signs too; withdraw, cancel, delete, return and resubmit', async () => {
  const t = await setup({ contract: 80_000_000_000 }); t.api.db.prepare("UPDATE proj_baseline_packs SET snapshot_json = REPLACE(snapshot_json, '\"amount\":\"100000.00\"', '\"amount\":\"5000000000.00\"')").run();
  const g = await generate(t); assert.equal(g.directorRequired, true); assert.deepEqual(g.chain, ['PCMGR', 'PM', 'PD', 'DIR']); await phased(t, g.id);
  const done = await approve(t, g.id, { director: true }); assert.equal(done.status, 'APPROVED');
  const t2 = await setup(); const g2 = await generate(t2); await phased(t2, g2.id);
  const s = await t2.call(qs, 'POST', `/budgets/${g2.id}/submit`); assert.equal((await t2.call(pcm, 'POST', `/budgets/${g2.id}/withdraw`, { reason: 'not mine to withdraw' })).status, 403);
  const w = await t2.call(qs, 'POST', `/budgets/${g2.id}/withdraw`, { reason: 'Need to correct a rate' }); assert.equal(w.status, 200, JSON.stringify(w.json)); assert.equal(w.json.data.status, 'DRAFT');
  void s; const s2 = await t2.call(qs, 'POST', `/budgets/${g2.id}/submit`); await t2.act(pcm, s2.json.data.workflowInstanceId, 'return');
  assert.equal((await t2.call(qs, 'GET', `/budgets/${g2.id}`)).json.data.status, 'RETURNED');
  const c = await t2.call(qs, 'POST', `/budgets/${g2.id}/cancel`, { reason: 'Replaced by a new plan' }); assert.equal(c.json.data.status, 'CANCELLED');
  const g3 = await generate(t2); assert.equal(g3.versionNo, 1, 'a cancelled budget does not block version 1'); assert.equal((await t2.call(qs, 'DELETE', `/budgets/${g3.id}`)).status, 200); assert.equal((await t2.call(qs, 'GET', `/budgets/${g3.id}`)).status, 404);
});

test('list, export, print, roles, company isolation and the flag', async () => {
  const t = await setup(); const g = await generate(t);
  const l = (await t.call(qs, 'GET', '/budgets')).json.data; assert.deepEqual(l.map((x) => [x.docNo, x.status, x.total]), [[g.docNo, 'DRAFT', '664200.00']]);
  assert.equal((await t.call(se, 'GET', '/budgets')).status, 403);
  assert.equal((await t.call(qs2, 'GET', `/budgets/${g.id}`)).status, 404, 'another company sees nothing');
  assert.equal((await t.call(pm, 'POST', `/budgets/${g.id}/lines`, { lineKind: 'OVERHEAD', resourceName: 'x', amount: 1, reason: 'not the preparer' })).status, 403, 'the project manager reviews, not prepares');
  assert.equal((await t.call(pm, 'GET', `/budgets/${g.id}`)).status, 200);
  const ex = await t.api.raw('GET', `${B}/budgets/export?format=csv`, qs); assert.equal(ex.status, 200);
  const pr = await t.api.raw('GET', `${B}/budgets/${g.id}/print`, qs); assert.equal(pr.status, 200); assert.match(pr.buffer.toString(), /NOT AN APPROVED BUDGET/);
  assert.equal((await t.call(qs, 'PATCH', `/budgets/${g.id}`, { name: 'Alpha towers budget v1' })).json.data.name, 'Alpha towers budget v1');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bud.p1201'").run();
  assert.equal((await t.call(qs, 'GET', '/budgets')).status, 404, 'the flag is off');
});
