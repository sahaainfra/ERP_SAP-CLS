import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { BUILTIN_FORMULAS } from '../src/server/platform/calc/index.js';
import { ROOT } from '../src/server/platform/db/index.js';
import { runDefinition } from '../src/shared/calc.js';
import { ratesOf } from '../src/server/modules/mdm/rates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 06.06: the rate analysis engine and the schedule of rates library. T-01 the M25 concrete analysis reproduces the hand calculation exactly; T-02 a resource rate change lists every affected analysis
// with its delta; T-03 a released version cannot be edited (a change is a new version that supersedes it). Also: the resource library by region, project and date; schedules of rates in editions and the
// comparison with an SOR item; templates and the bill of resources as a start; approvals (director for the standard library, project manager for a project, commercial manager for a variation), return,
// withdraw, the maker never approves; roles and project isolation; FR-07 the component amount reproduces the golden BOQ line amounts.
const M = '/api/v1/mdm';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'r') => ({ ...json, 'idempotency-key': `ra-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const est = as('EST', 'rest1');
const est2 = as('EST', 'rest2');
const dir = as('DIR', 'rdir1');
const pm = as('PM', 'rpm1');
const com = as('COMMGR', 'rcom1');
const qs = as('QS', 'rqs1');
const se = as('SE', 'rse1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const act = async (api, who, instanceId, action = 'approve', comment = 'checked the components and the add-ons') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['rest1', ['EST']], ['rest2', ['EST']], ['rdir1', ['DIR']], ['rpm1', ['PM']], ['rcom1', ['COMMGR']], ['rqs1', ['QS']], ['rse1', ['SE']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, `${n} Iyer`, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body) => api.call(method, `${M}${path}`, { ...who, headers: key(), body });
  const cat = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'RA', 'Rate analysis test', 'RAT', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, type, uom) => Number(api.db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE')").run(code, name, type, cat, uom).lastInsertRowid);
  const it = {
    cement: item('MAT-CEM-1', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('MAT-SND-1', 'Coarse sand', 'MATERIAL', 'CUM'), agg: item('MAT-AGG-1', 'Coarse aggregate 20 mm', 'MATERIAL', 'CUM'),
    mason: item('LAB-MSN-1', 'Mason', 'LABOUR', 'DAY'), beldar: item('LAB-BLD-1', 'Beldar', 'LABOUR', 'DAY'), mixer: item('EQP-MIX-1', 'Concrete mixer with operator', 'EQUIPMENT', 'DAY'), vib: item('EQP-VIB-1', 'Needle vibrator', 'EQUIPMENT', 'DAY'),
    m25: item('WI-M25-1', 'RCC M25 in superstructure', 'WORK_ITEM', 'CUM'), brick: item('WI-BRK-1', 'Brickwork 1:6', 'WORK_ITEM', 'CUM'),
  };
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'RPA', 'Alpha towers', 'BUILDING')").run().lastInsertRowid);
  const other = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'RPB', 'Beta mall', 'BUILDING')").run().lastInsertRowid);
  const rate = async (itemId, value, uom, extra = {}) => { const r = await call(est, 'POST', '/resource-rates', { itemId, rate: value, uom, basis: 'MARKET_SURVEY', effectiveFrom: '2026-04-01', ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  // the library of the hand-calculated example (Maharashtra, from 1 April 2026)
  for (const [i, v, u] of [[it.cement, '7200', 'MT'], [it.sand, '1850', 'CUM'], [it.agg, '1650', 'CUM'], [it.mason, '950', 'DAY'], [it.beldar, '650', 'DAY'], [it.mixer, '2400', 'DAY'], [it.vib, '600', 'DAY']]) await rate(i, v, u, { region: 'MH' });
  /** The M25 analysis of the hand calculation: components priced from the library. */
  const m25 = (over = {}) => ({ workItemId: it.m25, title: 'RCC M25 per cum', scope: 'STANDARD', region: 'MH', basisQty: '1', basisUom: 'CUM', effectiveFrom: '2026-05-01', addons: { water: '1', overhead: '7.5', profit: '7.5' },
    lines: [{ itemId: it.cement, uom: 'MT', qty: '0.4', wastagePct: '2' }, { itemId: it.sand, uom: 'CUM', qty: '0.42', wastagePct: '5' }, { itemId: it.agg, uom: 'CUM', qty: '0.84', wastagePct: '5' }, { itemId: it.mason, uom: 'DAY', qty: '0.17' }, { itemId: it.beldar, uom: 'DAY', qty: '2.5' }, { itemId: it.mixer, uom: 'DAY', qty: '0.07' }, { itemId: it.vib, uom: 'DAY', qty: '0.07' }], ...over });
  return { api, call, it, project, other, rate, m25 };
}

test('T-01 the M25 concrete analysis reproduces the hand calculation exactly, through the calculation engine, with the trace stored', async () => {
  const { api, call, m25 } = await setup();
  const r = await call(est, 'POST', '/analyses', m25());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const a = r.json.data;
  // by hand: cement 0.4 x 1.02 x 7200 = 2937.60; sand 0.42 x 1.05 x 1850 = 815.85; aggregate 0.84 x 1.05 x 1650 = 1455.30; mason 161.50; beldar 1625.00; mixer 168.00; vibrator 42.00
  assert.deepEqual(a.lines.map((l) => l.amount), ['2937.6', '815.85', '1455.3', '161.5', '1625', '168', '42']);
  assert.ok(a.lines.every((l) => l.priceOrigin === 'LIBRARY'), 'every rate comes from the library');
  assert.equal(a.directCost, '7205.25');
  // water 1% = 72.05; cost 7277.30; overhead 7.5% = 545.80; profit 7.5% of 7823.10 = 586.73; total 8409.83 per cum
  assert.deepEqual([a.breakdown.water, a.breakdown.overhead, a.breakdown.profit, a.breakdown.total], ['72.05', '545.80', '586.73', '8409.83']);
  assert.equal(a.unitRate, '8409.83');
  assert.deepEqual(a.breakdown.byType, { MATERIAL: '5208.75', LABOUR: '1786.50', EQUIPMENT: '210.00' });
  assert.deepEqual(a.formulas, { 'ra.line_amount': 1, 'ra.unit_rate': 1 });
  assert.equal(a.ref, 'RA-00001/v1');
  const traces = api.db.prepare("SELECT formula_code, field, result_json FROM core_calc_traces WHERE entity = 'ra_analysis' AND entity_id = ? ORDER BY id").all(a.id);
  assert.equal(traces.filter((t) => t.formula_code === 'ra.line_amount').length, 7);
  assert.equal(JSON.parse(traces.find((t) => t.field === 'unit_rate').result_json).unit_rate, '8409.83');
  // a client total that differs from the server's is refused; one that agrees is accepted
  assert.equal((await call(est, 'POST', '/analyses', m25({ unitRate: '8400.00' }))).status, 422);
  assert.equal((await call(est, 'POST', '/analyses', m25({ unitRate: '8409.83' }))).status, 201);
  // per 10 cum with GST added: the same total divided by the basis, GST on the unit rate
  const ten = (await call(est, 'POST', '/analyses', m25({ basisQty: '10', gstTreatment: 'ADDED', addons: { water: '1', overhead: '7.5', profit: '7.5', gst: '18' } }))).json.data;
  assert.deepEqual([ten.unitRate, ten.unitRateGross], ['840.98', '992.36']);
  // FR-07: with no wastage the component amount is the BOQ line amount of the golden outputs (00.01), case by case
  const golden = JSON.parse(readFileSync(join(ROOT, 'golden', 'outputs', 'calc.boq_line_amount.json'), 'utf8'));
  const f = BUILTIN_FORMULAS.find((b) => b.code === 'ra.line_amount');
  for (const g of golden) assert.equal(runDefinition({ expression: f.expression, inputs: f.inputs, outputs: f.outputs, rounding_policy: f.roundingPolicy }, { quantity: g.inputs.quantity, wastage_percent: '0', rate: g.inputs.rate }).outputs.amount, g.outputs.amount, JSON.stringify(g.inputs));
});

test('approvals: the director releases a standard analysis, the project manager a project one, the commercial manager a variation; return, withdraw, reject; the maker never approves', async () => {
  const { api, call, m25, project } = await setup();
  const std = (await call(est, 'POST', '/analyses', m25())).json.data;
  assert.equal((await call(qs, 'POST', `/analyses/${std.id}/submit`, {})).status, 403, 'QS only reads');
  assert.equal((await call(est2, 'POST', `/analyses/${std.id}/submit`, {})).status, 403, 'another estimator does not submit it');
  const s = await call(est, 'POST', `/analyses/${std.id}/submit`, { comment: 'standard library rate' });
  assert.equal(s.status, 202, JSON.stringify(s.json));
  assert.equal(s.json.data.status, 'SUBMITTED');
  assert.equal((await call(est, 'PUT', `/analyses/${std.id}`, { ...m25(), version: s.json.data.rowVersion })).status, 409, 'locked while in approval');
  await act(api, dir, s.json.data.instanceId, 'return', 'add the scaffolding');
  const ret = (await call(est, 'GET', `/analyses/${std.id}`)).json.data;
  assert.equal(ret.status, 'RETURNED');
  assert.equal((await call(est, 'PUT', `/analyses/${std.id}`, { ...m25({ addons: { water: '1', overhead: '7.5', profit: '7.5', contingency: '1' } }), version: ret.rowVersion })).status, 200, 'a returned analysis is corrected');
  assert.equal((await call(est, 'POST', `/analyses/${std.id}/submit`, {})).status, 202);
  await act(api, dir, s.json.data.instanceId);
  const rel = (await call(qs, 'GET', `/analyses/${std.id}`)).json.data;
  assert.equal(rel.status, 'APPROVED');
  assert.equal(rel.releasedBy, 'rdir1');
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'mdm.analysis.released'").get(), 'the release is published for estimation and BOQ pricing');
  assert.equal(ratesOf(api.db).analyses.releasedRate(1, rel.workItem.id, { region: 'MH', date: '2026-06-01' }).unitRate, rel.unitRate);
  // a project-specific analysis goes to the project manager; a variation to the commercial manager
  const prj = (await call(est, 'POST', '/analyses', m25({ scope: 'PROJECT', projectId: project, submit: true }))).json.data;
  assert.equal(prj.status, 'SUBMITTED');
  assert.equal((await api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.some((t) => t.instance.id === prj.instanceId), false, 'not the director');
  await act(api, pm, prj.instanceId);
  assert.equal((await call(est, 'GET', `/analyses/${prj.id}`)).json.data.status, 'APPROVED');
  const vr = (await call(est, 'POST', '/analyses', m25({ scope: 'VARIATION', projectId: project, submit: true }))).json.data;
  await act(api, com, vr.instanceId, 'reject', 'the variation is priced from the contract rates');
  assert.equal((await call(est, 'GET', `/analyses/${vr.id}`)).json.data.status, 'REJECTED');
  assert.equal((await call(est, 'POST', '/analyses', m25({ scope: 'PROJECT' }))).status, 400, 'a project analysis names its project');
  // withdraw before anyone acted: back to a draft, which can be deleted
  const wd = (await call(est, 'POST', '/analyses', m25({ submit: true }))).json.data;
  const w = await call(est, 'POST', `/analyses/${wd.id}/withdraw`, { reason: 'wrong region' });
  assert.equal(w.json.data.status, 'DRAFT', JSON.stringify(w.json));
  assert.equal((await call(est, 'DELETE', `/analyses/${wd.id}`, { reason: 'started again' })).status, 200);
  assert.equal((await call(est, 'GET', `/analyses/${wd.id}`)).status, 404);
  assert.equal((await call(est, 'DELETE', `/analyses/${std.id}`, { reason: 'try to delete a released one' })).status, 409);
});

test('T-03 a released version cannot be edited or recalculated; an amendment is a new version that supersedes it from its date; versions compare', async () => {
  const { api, call, m25, it, rate } = await setup();
  const a = (await call(est, 'POST', '/analyses', m25({ submit: true }))).json.data;
  await act(api, dir, a.instanceId);
  const rel = (await call(est, 'GET', `/analyses/${a.id}`)).json.data;
  const edit = await call(est, 'PUT', `/analyses/${a.id}`, { ...m25(), version: rel.rowVersion });
  assert.equal(edit.status, 409);
  assert.match(edit.json.error.message, /released and cannot be changed/);
  assert.equal((await call(est, 'POST', `/analyses/${a.id}/recalculate`, {})).status, 409);
  assert.equal(rel.can.edit, false);
  assert.equal(rel.can.amend, true);
  // cement goes up from July; the amendment picks it up when recalculated
  await rate(it.cement, '7600', 'MT', { region: 'MH', effectiveFrom: '2026-07-01' });
  assert.equal((await call(est, 'POST', `/analyses/${a.id}/amend`, { reason: 'cement price revision', effectiveFrom: '2026-05-01' })).status, 400, 'the new version starts after the old one');
  const am = await call(est, 'POST', `/analyses/${a.id}/amend`, { reason: 'cement price revision', effectiveFrom: '2026-07-01' });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  assert.equal(am.json.data.ref, 'RA-00001/v2');
  assert.equal(am.json.data.unitRate, '8409.83', 'copied as it was');
  assert.equal((await call(est, 'POST', `/analyses/${a.id}/amend`, { reason: 'a second amendment', effectiveFrom: '2026-08-01' })).status, 409, 'one open amendment at a time');
  const rc = await call(est, 'POST', `/analyses/${am.json.data.id}/recalculate`, {});
  assert.equal(rc.status, 200, JSON.stringify(rc.json));
  assert.equal(rc.json.data.lines[0].rate, '7600');
  // cement 0.4 x 1.02 x 7600 = 3100.80 (+163.20): direct 7368.45, water 73.68, cost 7442.13, overhead 558.16, profit 600.02, total 8600.31
  assert.equal(rc.json.data.unitRate, '8600.31');
  const cmp = (await call(qs, 'GET', `/analyses/${a.id}/compare?with=${am.json.data.id}`)).json.data;
  assert.equal(cmp.unitRateDelta, '190.48');
  assert.deepEqual(cmp.lines.filter((l) => l.change !== 'same').map((l) => [l.description, l.change, l.amountDelta]), [['Cement OPC 53', 'changed', '163.20']]);
  const sub = await call(est, 'POST', `/analyses/${am.json.data.id}/submit`, {});
  assert.equal(sub.status, 202, JSON.stringify(sub.json));
  await act(api, dir, sub.json.data.instanceId);
  const v1 = (await call(est, 'GET', `/analyses/${a.id}`)).json.data;
  assert.deepEqual([v1.status, v1.effectiveTo], ['SUPERSEDED', '2026-06-30']);
  assert.equal((await call(est, 'PUT', `/analyses/${a.id}`, { ...m25(), version: v1.rowVersion })).status, 409, 'a superseded version is locked too');
  const s = ratesOf(api.db).analyses;
  assert.equal(s.releasedRate(1, v1.workItem.id, { region: 'MH', date: '2026-06-15' }).unitRate, '8409.83');
  assert.equal(s.releasedRate(1, v1.workItem.id, { region: 'MH', date: '2026-07-15' }).unitRate, '8600.31');
  const h = (await call(est, 'GET', `/analyses/${a.id}/history`)).json.data;
  assert.deepEqual(h.versions.map((v) => [v.versionNo, v.status]), [[2, 'APPROVED'], [1, 'SUPERSEDED']]);
  assert.ok(h.audit.some((x) => x.action === 'amend'));
});

test('T-02 a resource rate change lists every affected analysis with its delta; the library picks the project, then the region, then the general rate', async () => {
  const { call, m25, it, rate, project } = await setup();
  const a1 = (await call(est, 'POST', '/analyses', m25())).json.data;
  const a2 = (await call(est, 'POST', '/analyses', m25({ basisQty: '10', title: 'RCC M25 per 10 cum' }))).json.data;
  const brick = (await call(est, 'POST', '/analyses', { workItemId: it.brick, scope: 'STANDARD', region: 'MH', basisQty: '1', effectiveFrom: '2026-05-01', addons: { overhead: '15' }, lines: [{ itemId: it.mason, uom: 'DAY', qty: '0.7' }, { description: 'Bricks (typed)', uom: 'NOS', qty: '500', rate: '8.5', type: 'MATERIAL' }] })).json.data;
  assert.equal(brick.lines[1].priceOrigin, 'MANUAL');
  const imp = (await call(qs, 'GET', `/analyses/impact?itemId=${it.cement}&newRate=8000`)).json.data;
  assert.equal(imp.count, 2, 'both M25 analyses use cement; the brickwork does not');
  const r1 = imp.rows.find((r) => r.id === a1.id);
  // cement 0.4 x 1.02 x 8000 = 3264.00 (+326.40): direct 7531.65, water 75.32, cost 7606.97, overhead 570.52, profit 613.31, total 8790.80
  assert.deepEqual([r1.oldUnitRate, r1.newUnitRate, r1.delta, r1.percent, r1.oldItemRate, r1.newItemRate], ['8409.83', '8790.80', '380.97', '4.53', '7200', '8000']);
  const r2 = imp.rows.find((r) => r.id === a2.id);
  assert.deepEqual([r2.oldUnitRate, r2.newUnitRate, r2.delta], ['840.98', '879.08', '38.10']);
  assert.equal(imp.totalDelta, '419.07');
  // the mason is used by all three
  assert.equal((await call(qs, 'GET', `/analyses/impact?itemId=${it.mason}&newRate=1000`)).json.data.count, 3);
  // nothing was saved
  assert.equal((await call(est, 'GET', `/analyses/${a1.id}`)).json.data.unitRate, '8409.83');
  // the library: a project rate wins over the region's, the region's over the general one; a new rate from a date ends the old one the day before
  await rate(it.cement, '7000', 'MT');
  await rate(it.cement, '7400', 'MT', { projectId: project });
  const look = async (q) => (await call(qs, 'GET', `/resource-rates/lookup?itemId=${it.cement}&${q}`)).json.data;
  assert.equal((await look(`region=MH&projectId=${project}&date=2026-06-01`)).rate, '7400');
  assert.equal((await look('region=MH&date=2026-06-01')).rate, '7200');
  assert.equal((await look('region=GJ&date=2026-06-01')).rate, '7000');
  await rate(it.cement, '7300', 'MT', { region: 'MH', effectiveFrom: '2026-09-01' });
  assert.equal((await look('region=MH&date=2026-08-31')).rate, '7200');
  assert.equal((await look('region=MH&date=2026-09-01')).rate, '7300');
  const lib = (await call(qs, 'GET', `/resource-rates?itemId=${it.cement}&region=MH`)).json.data.rows;
  assert.deepEqual(lib.map((r) => [r.rate, r.effectiveFrom, r.effectiveTo]), [['7300', '2026-09-01', null], ['7200', '2026-04-01', '2026-08-31']]);
  assert.equal((await call(est, 'POST', '/resource-rates', { itemId: it.cement, rate: '1', uom: 'MT', basis: 'DSR', region: 'MH', effectiveFrom: '2026-09-01' })).status, 409, 'two rates from the same date');
  assert.equal((await call(est, 'POST', '/resource-rates', { itemId: it.cement, rate: '1', uom: 'CUM', basis: 'DSR', effectiveFrom: '2026-10-01' })).status, 400, 'cement is not counted in cum');
  assert.equal((await call(est, 'POST', '/resource-rates', { itemId: it.m25, rate: '1', uom: 'CUM', basis: 'DSR', effectiveFrom: '2026-10-01' })).status, 400, 'a work item is priced by analysis');
  // a rate used by an analysis is not corrected, only replaced
  const used = lib.find((r) => r.rate === '7200');
  assert.equal((await call(est, 'PUT', `/resource-rates/${used.id}`, { rate: '7250', reason: 'typing mistake', version: used.rowVersion })).status, 422);
});

test('FR-02 FR-06 schedules of rates in editions; an analysis is compared with its SOR item; templates and the bill of resources start an analysis', async () => {
  const { api, call, m25, it } = await setup();
  const b = await call(est, 'POST', '/sor-books', { code: 'DSR-DL', name: 'CPWD Delhi Schedule of Rates', authority: 'CPWD', year: 2025, region: 'DL' });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  const items = [{ itemCode: '5', description: 'Concrete work', uom: null, rate: null }, { itemCode: '5.1.2', parentCode: '5', description: 'Providing and laying RCC M25 (1:1:2)', uom: 'CUM', rate: '8000.00' }, { itemCode: '6.1.1', description: 'Brickwork 1:6', uom: 'CUM', rate: '7100.50' }];
  assert.equal((await call(est, 'PUT', `/sor-books/${b.json.data.id}/items`, { items: [items[0], items[0]] })).status, 400, 'an item code twice');
  const put = await call(est, 'PUT', `/sor-books/${b.json.data.id}/items`, { items });
  assert.deepEqual([put.json.data.added, put.json.data.items], [3, 3]);
  assert.equal((await call(qs, 'GET', '/sor-items?q=5.1')).json.data.rows.length, 0, 'a draft edition is not offered');
  await call(est, 'POST', `/sor-books/${b.json.data.id}/activate`, { reason: 'DSR 2025 in use' });
  const found = (await call(qs, 'GET', '/sor-items?q=5.1')).json.data.rows;
  assert.equal(found[0].itemCode, '5.1.2');
  assert.equal((await call(est, 'PUT', `/sor-books/${b.json.data.id}/items`, { items })).status, 422, 'an active edition is fixed');
  // the analysis against the SOR: 8409.83 vs 8000.00 is 5.12% above
  const a = (await call(est, 'POST', '/analyses', m25({ sorItemId: found[0].id }))).json.data;
  assert.deepEqual([a.sor.sorRate, a.sor.difference, a.sor.percent, a.sor.position, a.sor.uomMatches], ['8000.00', '409.83', '5.12', 'above', true]);
  // a new edition: a draft copy with the items, then in use; the old one superseded
  const ed = await call(est, 'POST', `/sor-books/${b.json.data.id}/editions`, { year: 2026 });
  assert.equal(ed.status, 201, JSON.stringify(ed.json));
  assert.deepEqual([ed.json.data.edition, ed.json.data.items, ed.json.data.status], [2, 3, 'DRAFT']);
  await call(est, 'PUT', `/sor-books/${ed.json.data.id}/items`, { items: [{ itemCode: '5.1.2', parentCode: '5', description: 'Providing and laying RCC M25 (1:1:2)', uom: 'CUM', rate: '8650.00' }] });
  await call(est, 'POST', `/sor-books/${ed.json.data.id}/activate`, { reason: 'DSR 2026 notified' });
  const books = (await call(qs, 'GET', '/sor-books')).json.data.rows;
  assert.deepEqual(books.map((x) => [x.edition, x.status]), [[2, 'ACTIVE'], [1, 'SUPERSEDED']]);
  assert.equal((await call(qs, 'GET', '/sor-items?q=5.1.2')).json.data.rows[0].rate, '8650');
  // FR-04: the M25 template matches the company's items by name and prices them from the library
  const t = (await call(est, 'POST', '/analyses/start', { templateCode: 'CONCRETE_M25', region: 'MH', effectiveFrom: '2026-05-01' })).json.data;
  assert.equal(t.lines.length, 7);
  assert.deepEqual(t.lines.slice(0, 2).map((l) => [l.itemId, l.rate, l.priceOrigin]), [[it.cement, '7200', 'LIBRARY'], [it.sand, '1850', 'LIBRARY']]);
  // the bill of resources of the work item (06.03) is the other start
  api.db.prepare("INSERT INTO mdm_item_resources (company_id, parent_item_id, component_item_id, qty_per_unit, uom, wastage_pct, sort_order) VALUES (1, ?, ?, 700, 'DAY', 0, 1)").run(it.brick, it.mason);
  const bor = (await call(est, 'POST', '/analyses/start', { workItemId: it.brick, region: 'MH', effectiveFrom: '2026-05-01' })).json.data;
  assert.deepEqual(bor.lines.map((l) => [l.itemId, l.qty, l.rate]), [[it.mason, '0.7', '950']]);
  // the print and the export are audited
  assert.match((await api.raw('GET', `${M}/analyses/${a.id}/print`, est)).buffer.toString('utf8'), /Rate analysis RA-00001\/v1[\s\S]*8409\.83/);
  const ex = await api.raw('GET', `${M}/analyses/export`, qs);
  assert.match(ex.buffer.toString('utf8'), /Analysis,Title,Work item[\s\S]*RA-00001\/v1/);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'ra_analyses' AND action = 'print'").get());
});

test('roles and isolation: QS and project controls read, a site engineer sees nothing, a project manager of another project does not see its analyses, another company gets 404, the flag hides it all', async () => {
  const { api, call, m25, project, other } = await setup();
  const std = (await call(est, 'POST', '/analyses', m25())).json.data;
  const prj = (await call(est, 'POST', '/analyses', m25({ scope: 'PROJECT', projectId: project }))).json.data;
  assert.equal((await call(as('PCMGR', 'rpc1'), 'GET', `/analyses/${std.id}`)).status, 200);
  assert.equal((await call(qs, 'POST', '/analyses', m25())).status, 403, 'QS does not create');
  assert.equal((await call(qs, 'POST', '/resource-rates', { itemId: 1, rate: '1', uom: 'MT', basis: 'DSR', effectiveFrom: '2026-10-01' })).status, 403);
  assert.equal((await call(se, 'GET', '/analyses')).status, 403, 'a site engineer does not see rates');
  assert.equal((await call(se, 'GET', '/resource-rates')).status, 403);
  // a project manager assigned to the other project only
  const uid = Number(api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'rpm2', 'rpm2', '[]', 'rpm2@example.com')").run().lastInsertRowid);
  api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([other]));
  // the service with the person's real assignments (the development-header mode of the API does not read assignments): a PM of project B lists the standard library and B's analyses, not A's
  const s = ratesOf(api.db).analyses;
  const pm2 = () => ({ user: 'rpm2', userId: uid, companyId: 1, roles: [] });
  const seen = s.list(pm2(), {}).rows.map((r) => r.id);
  assert.ok(seen.includes(std.id), 'the standard library is seen');
  assert.ok(!seen.includes(prj.id), 'the analysis of another project is not listed');
  assert.throws(() => s.get(pm2(), prj.id), /does not exist/, 'nor opened');
  const own = (await call(est, 'POST', '/analyses', m25({ scope: 'PROJECT', projectId: other }))).json.data;
  assert.ok(s.list(pm2(), {}).rows.some((r) => r.id === own.id), 'the analysis of their own project is seen');
  assert.equal(s.get(pm2(), own.id).id, own.id);
  assert.equal(s.impact(pm2(), { itemId: own.lines[0].itemId, newRate: '9000' }).rows.every((r) => r.id !== prj.id), true, 'the impact report does not show it either');
  assert.equal((await call(as('EST', 'rest1', '2'), 'GET', `/analyses/${std.id}`)).status, 404, 'another company');
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.mdm.p0606'").run();
  assert.equal((await call(est, 'GET', '/analyses')).status, 404, 'flag off');
  api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.mdm.p0606'").run();
});
