import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { estimatesOf } from '../src/server/modules/est/estimate.js';
import { setupCompany, startApi } from './helpers.js';

// Part 09.01: the estimate workspace. T-01 the selling rate of each item and the totals of the estimate reproduce the hand calculation (an item priced from the M25 rate analysis of 06.06, a manual build-up priced from the
// resource library, a typed cost rate; the indirects sheet; contingency by risk; HO overhead, escalation and GST), and the comparison of two versions shows the changes. Also: the client BOQ pasted (checked, then added),
// the resource summary, re-pricing when the analysis gets a newer released version (BR-01), masking of costs and margins (BR-02), the approval chain (an estimation colleague, then the director; the maker never approves),
// conflicts, idempotent replay, roles, project isolation, another company, the flag, and a tender estimate.
const E = '/api/v1/est';
const M = '/api/v1/mdm';
const B = '/api/v1/bd';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `est-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const est1 = as('EST', 'eest1'); const est2 = as('EST', 'eest2'); const dir = as('DIR', 'edir1'); const qs = as('QS', 'eqs1'); const com = as('COMMGR', 'ecom1'); const se = as('SE', 'ese1'); const pm = as('PM', 'epm1'); const bd1 = as('BD', 'ebd1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['eest1', ['EST']], ['eest2', ['EST']], ['edir1', ['DIR']], ['eqs1', ['QS']], ['ecom1', ['COMMGR']], ['ese1', ['SE']], ['epm1', ['PM']], ['ebd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked the estimate' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const cat = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'ES', 'Estimate test', 'EST', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, type, uom) => Number(api.db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE')").run(code, name, type, cat, uom).lastInsertRowid);
  const it = {
    cement: item('MAT-CEM-9', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('MAT-SND-9', 'Coarse sand', 'MATERIAL', 'CUM'), agg: item('MAT-AGG-9', 'Coarse aggregate 20 mm', 'MATERIAL', 'CUM'),
    mason: item('LAB-MSN-9', 'Mason', 'LABOUR', 'DAY'), beldar: item('LAB-BLD-9', 'Beldar', 'LABOUR', 'DAY'), mixer: item('EQP-MIX-9', 'Concrete mixer with operator', 'EQUIPMENT', 'DAY'), vib: item('EQP-VIB-9', 'Needle vibrator', 'EQUIPMENT', 'DAY'),
    m25: item('WI-M25-9', 'RCC M25 in superstructure', 'WORK_ITEM', 'CUM'),
  };
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'EPA', 'Alpha towers', 'BUILDING')").run().lastInsertRowid);
  const other = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'EPB', 'Beta mall', 'BUILDING')").run().lastInsertRowid);
  const rate = async (itemId, value, uom, extra = {}) => { const r = await call(est1, 'POST', `${M}/resource-rates`, { itemId, rate: value, uom, basis: 'MARKET_SURVEY', effectiveFrom: '2026-04-01', region: 'MH', ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  for (const [i, v, u] of [[it.cement, '7200', 'MT'], [it.sand, '1850', 'CUM'], [it.agg, '1650', 'CUM'], [it.mason, '950', 'DAY'], [it.beldar, '650', 'DAY'], [it.mixer, '2400', 'DAY'], [it.vib, '600', 'DAY']]) await rate(i, v, u);
  // the M25 analysis of 06.06 (direct cost 7205.25 per cum), released by the director
  const m25 = { workItemId: it.m25, title: 'RCC M25 per cum', scope: 'STANDARD', region: 'MH', basisQty: '1', basisUom: 'CUM', effectiveFrom: '2026-05-01', addons: { water: '1', overhead: '7.5', profit: '7.5' },
    lines: [{ itemId: it.cement, uom: 'MT', qty: '0.4', wastagePct: '2' }, { itemId: it.sand, uom: 'CUM', qty: '0.42', wastagePct: '5' }, { itemId: it.agg, uom: 'CUM', qty: '0.84', wastagePct: '5' }, { itemId: it.mason, uom: 'DAY', qty: '0.17' }, { itemId: it.beldar, uom: 'DAY', qty: '2.5' }, { itemId: it.mixer, uom: 'DAY', qty: '0.07' }, { itemId: it.vib, uom: 'DAY', qty: '0.07' }], submit: true };
  const a = (await call(est1, 'POST', `${M}/analyses`, m25)).json.data;
  await act(dir, a.instanceId);
  const analysis = (await call(est1, 'GET', `${M}/analyses/${a.id}`)).json.data;
  assert.deepEqual([analysis.status, analysis.directCost], ['APPROVED', '7205.25']);
  return { api, call, act, hasTask, it, project, other, analysis, rate };
}
const BOQ = [
  { sectionCode: 'A', sectionName: 'Earthwork and PCC', itemNo: 'A.1', description: 'Plain cement concrete 1:4:8 below foundations', uom: 'CUM', qty: '100', clientRate: '5600' },
  { sectionCode: 'B', sectionName: 'Reinforced concrete', itemNo: 'B.1', description: 'RCC M25 in columns, beams and slabs', uom: 'CUM', qty: '250', clientRate: '9100' },
  { sectionCode: 'B', sectionName: 'Reinforced concrete', itemNo: 'B.2', description: 'Brick masonry in cement mortar 1:6', uom: 'CUM', qty: '40', clientRate: '' },
];
/** The three items priced: a typed cost rate, the M25 analysis, a manual build-up from the library (cement and a mason) and a typed line (scaffolding). */
const priced = (t, over = {}) => [
  { ...BOQ[0], mode: 'RATE', costRate: '5000', markupPct: '20', ...(over['A.1'] ?? {}) },
  { ...BOQ[1], mode: 'ANALYSIS', analysisId: t.analysis.id, markupPct: '25', ...(over['B.1'] ?? {}) },
  { ...BOQ[2], mode: 'MANUAL', markupPct: '15', components: [{ type: 'MATERIAL', itemId: t.it.cement, uom: 'MT', qty: '0.06' }, { type: 'LABOUR', itemId: t.it.mason, uom: 'DAY', qty: '0.7' }, { type: 'OTHER', description: 'Scaffolding hire', uom: 'NOS', qty: '1', rate: '85.5' }], ...(over['B.2'] ?? {}) },
];
const INDIRECTS = [{ category: 'SITE_ESTABLISHMENT', description: 'Site office, stores and yard', basis: 'LUMP_SUM', amount: '50000' }, { category: 'STAFF', description: 'Site engineer, 12 months', basis: 'QTY_RATE', qty: '12', rate: '15000' }, { category: 'BG_CHARGES', description: 'Performance guarantee commission', basis: 'PERCENT', percent: '1' }];
const RISKS = [{ description: 'Rock in excavation', impact: '100000', probabilityPct: '25' }, { description: 'Monsoon delay', impact: '40000', probabilityPct: '50' }];

/** A project estimate with the BOQ, the prices, the indirects, the risks and the percentages of the hand calculation. */
async function built(t) {
  const c = await t.call(est1, 'POST', `${E}/estimates`, { projectId: t.project, title: 'Alpha towers, civil works', basisDate: '2026-10-01', region: 'MH', hoOverheadPct: '2', contingencyPct: '1', escalationPct: '1.5', gstPct: '18' });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  let e = c.json.data;
  const imp = await t.call(est1, 'POST', `${E}/estimates/${e.id}/boq`, { rows: BOQ, commit: true, version: e.rowVersion });
  assert.equal(imp.status, 200, JSON.stringify(imp.json)); e = imp.json.data.estimate;
  e = (await t.call(est1, 'PUT', `${E}/estimates/${e.id}/items`, { items: priced(t), version: e.rowVersion })).json.data;
  e = (await t.call(est1, 'PUT', `${E}/estimates/${e.id}/indirects`, { lines: INDIRECTS, version: e.rowVersion })).json.data;
  const r = await t.call(est1, 'PUT', `${E}/estimates/${e.id}/risks`, { lines: RISKS, version: e.rowVersion }); assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}

test('T-01 the item selling rates and the totals reproduce the hand calculation; the BOQ is pasted and checked; sections, resources and the comparison of versions', async () => {
  const t = await setup();
  const c = (await t.call(est1, 'POST', `${E}/estimates`, { projectId: t.project, basisDate: '2026-10-01', region: 'MH' })).json.data;
  assert.match(c.ref, /^EST-\d{5}\/v1$/); assert.equal(c.status, 'DRAFT'); assert.equal(c.gstPct, '18', 'GST on works contract by default');
  // FR-02 a pasted BOQ is checked first: a row without a unit and a duplicate item number are shown, nothing is added
  const bad = (await t.call(est1, 'POST', `${E}/estimates/${c.id}/boq`, { rows: [...BOQ, { ...BOQ[0], uom: '' }], commit: true, version: c.rowVersion })).json.data;
  assert.equal(bad.committed, false); assert.deepEqual(bad.problems.map((p) => p.field), ['rows.3.itemNo', 'rows.3.uom']);
  const prev = (await t.call(est1, 'POST', `${E}/estimates/${c.id}/boq`, { rows: BOQ, version: c.rowVersion })).json.data;
  assert.deepEqual([prev.committed, prev.rows, prev.sections, prev.problems.length], [false, 3, 2, 0], 'a preview adds nothing');
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM est_estimate_items WHERE estimate_id = ?').get(c.id).n, 0);

  const e = await built(t);
  const by = Object.fromEntries(e.items.map((i) => [i.itemNo, i]));
  // A.1 typed: 5000 x 1.20 = 6000.00; 100 cum: cost 5,00,000.00, selling 6,00,000.00
  assert.deepEqual([by['A.1'].costRate, by['A.1'].sellingRate, by['A.1'].costAmount, by['A.1'].amount, by['A.1'].clientRate], ['5000', '6000.00', '500000.00', '600000.00', '5600']);
  // B.1 from the analysis: its direct cost 7205.25 per cum (without its own add-ons), x 1.25 = 9006.5625 -> 9006.56; 250 cum
  assert.deepEqual([by['B.1'].mode, by['B.1'].analysis.ref, by['B.1'].costRate, by['B.1'].sellingRate, by['B.1'].costAmount, by['B.1'].amount, by['B.1'].workItemId], ['ANALYSIS', t.analysis.ref, '7205.25', '9006.56', '1801312.50', '2251640.00', t.it.m25]);
  // B.2 built up: cement 0.06 x 7200 = 432.00 (library), mason 0.7 x 950 = 665.00 (library), scaffolding 85.50 (typed) = 1182.50; x 1.15 = 1359.875 -> 1359.88; 40 cum
  assert.deepEqual(by['B.2'].components.map((x) => [x.description, x.rate, x.amount, x.origin]), [['Cement OPC 53', '7200', '432.00', 'LIBRARY'], ['Mason', '950', '665.00', 'LIBRARY'], ['Scaffolding hire', '85.5', '85.50', 'MANUAL']]);
  assert.deepEqual([by['B.2'].costRate, by['B.2'].sellingRate, by['B.2'].costAmount, by['B.2'].amount], ['1182.5', '1359.88', '47300.00', '54395.20']);
  // the indirects: 50,000 + 12 x 15,000 + 1% of the direct cost 23,48,612.50 = 23,486.13 -> 2,53,486.13; the risks 25% of 1,00,000 + 50% of 40,000 = 45,000
  assert.deepEqual(e.indirects.map((x) => x.amount), ['50000.00', '180000.00', '23486.13']);
  assert.deepEqual(e.risks.map((x) => x.exposure), ['25000.00', '20000.00']);
  // HO overhead 2% of 26,02,098.63 = 52,041.97; base 26,54,140.60; contingency 45,000 + 1% = 71,541.41; escalation 1.5% = 39,812.11; total cost 27,65,494.12
  // selling 29,06,035.20; margin 1,40,541.08 = 4.84%; GST 18% 5,23,086.34; bid value 34,29,121.54
  assert.deepEqual(e.totals, { directCost: '2348612.50', indirectCost: '253486.13', overhead: '52041.97', risk: '45000.00', contingency: '71541.41', escalation: '39812.11', totalCost: '2765494.12', selling: '2906035.20', margin: '140541.08', marginPct: '4.84', gst: '523086.34', bidValue: '3429121.54' });
  // FR-08 the margin of each section, through the engine: A 1,00,000 on 6,00,000 = 16.67%; B (22,51,640 + 54,395.20) - (18,01,312.50 + 47,300) = 4,57,422.70 on 23,06,035.20 = 19.84%
  assert.deepEqual(e.sections.map((s) => [s.code, s.items, s.selling, s.cost, s.margin, s.marginPct]), [['A', 1, '600000.00', '500000.00', '100000.00', '16.67'], ['B', 2, '2306035.20', '1848612.50', '457422.70', '19.84']]);
  // the totals are traced to the formula
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_calc_traces WHERE entity = 'est_estimate' AND entity_id = ? AND formula_code = 'est.estimate_total'").get(String(e.id)), 'the calculation trace is kept');

  // FR-06 resources: cement 0.4 x 1.02 x 250 = 102 MT plus 0.06 x 40 = 2.4 MT; masons 0.17 x 250 + 0.7 x 40 = 70.5 days; beldars 625 days; plant 0.07 x 250 days of the mixer and of the vibrator
  const res = (await t.call(est1, 'GET', `${E}/estimates/${e.id}/resources`)).json.data;
  const line = (d) => res.rows.find((r) => r.description === d);
  assert.deepEqual([line('Cement OPC 53').qty, line('Mason').qty, line('Beldar').qty, line('Concrete mixer with operator').qty, line('Scaffolding hire').qty], ['104.400', '70.500', '625.000', '17.500', '40.000']);
  assert.deepEqual(res.headline, { cementMt: '104.400', steelMt: '0.000', labourManDays: '695.500', plantHours: '0.000', plantDays: '35.000' });
  assert.equal(line('Cement OPC 53').amount, '751680.00', '104.4 MT x 7200');
  assert.deepEqual((await t.call(est1, 'GET', `${E}/estimates/${e.id}/resources?type=LABOUR`)).json.data.rows.map((r) => r.description), ['Beldar', 'Mason']);

  // FR-07 a second version: B.1 down to 240 cum, A.1 markup to 22%, a new item C.1, B.2 dropped; the comparison shows each change
  const v2 = (await t.call(est1, 'POST', `${E}/estimates/${e.id}/versions`, { reason: 'revised quantities after the pre-bid' })).json.data;
  assert.deepEqual([v2.ref.endsWith('/v2'), v2.status, v2.items.length, v2.totals.selling], [true, 'DRAFT', 3, '2906035.20'], 'copied as it was');
  const items2 = [...priced(t, { 'A.1': { markupPct: '22' }, 'B.1': { qty: '240' } }).slice(0, 2), { sectionCode: 'C', sectionName: 'Finishes', itemNo: 'C.1', description: '12 mm cement plaster', uom: 'SQM', qty: '500', mode: 'RATE', costRate: '210', markupPct: '10' }];
  const u2 = (await t.call(est1, 'PUT', `${E}/estimates/${v2.id}/items`, { items: items2, version: v2.rowVersion })).json.data;
  const cmp = (await t.call(est1, 'GET', `${E}/estimates/${e.id}/compare?with=${u2.id}`)).json.data;
  const row = (no) => cmp.rows.find((r) => r.itemNo === no);
  assert.deepEqual(cmp.counts, { added: 1, removed: 1, changed: 2, same: 0 });
  assert.deepEqual([row('A.1').change, row('A.1').delta.markupPct, row('A.1').delta.sellingRate, row('A.1').delta.amount], ['CHANGED', '2', '100.00', '10000.00'], 'A.1: 6100 - 6000 per cum, x 100');
  assert.deepEqual([row('B.1').change, row('B.1').delta.qty, row('B.1').delta.amount], ['CHANGED', '-10', '-90065.60'], 'B.1: 10 cum less at 9006.56');
  assert.deepEqual([row('B.2').change, row('B.2').delta.amount], ['REMOVED', '-54395.20']);
  assert.deepEqual([row('C.1').change, row('C.1').to.sellingRate, row('C.1').delta.amount], ['ADDED', '231.00', '115500.00']);
  assert.equal(cmp.totals.delta.selling, '-18960.80', '+10,000 - 90,065.60 - 54,395.20 + 1,15,500');
  assert.equal((await t.call(est1, 'GET', `${E}/estimates/${e.id}/compare?with=${c.id}`)).status, 422, 'only versions of one estimate');
  // the list shows both versions
  const list = (await t.call(est1, 'GET', `${E}/estimates?q=${encodeURIComponent(e.docNo)}`)).json;
  assert.deepEqual(list.data.map((r) => r.versionNo).sort(), [1, 2]);
});

test('BR-01 an item priced from an analysis that gets a newer released version is flagged and re-priced; the chain approves (a colleague, then the director); conflicts and replays', async () => {
  const t = await setup();
  const e = await built(t);
  // 409 on a stale version, and a client total is never trusted (it is not accepted at all)
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/items`, { items: priced(t), version: e.rowVersion - 1 })).status, 409);
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/items`, { items: priced(t).map((i) => ({ ...i, amount: '1' })), version: e.rowVersion })).status, 400, 'amounts are the server\'s');
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/items`, { items: [...priced(t), { ...BOQ[0] }], version: e.rowVersion })).status, 400, 'an item number twice');
  assert.equal((await t.call(est2, 'PUT', `${E}/estimates/${e.id}/items`, { items: priced(t), version: e.rowVersion })).status, 403, 'another estimator makes a new version');
  // cement goes up: the analysis gets version 2, released by the director
  await t.rate(t.it.cement, '7600', 'MT', { effectiveFrom: '2026-07-01' });
  const am = (await t.call(est1, 'POST', `${M}/analyses/${t.analysis.id}/amend`, { reason: 'cement price revision', effectiveFrom: '2026-07-01' })).json.data;
  await t.call(est1, 'POST', `${M}/analyses/${am.id}/recalculate`, {});
  const sub = (await t.call(est1, 'POST', `${M}/analyses/${am.id}/submit`, {})).json.data; await t.act(dir, sub.instanceId);
  const st = (await t.call(est1, 'GET', `${E}/estimates/${e.id}`)).json.data;
  const b1 = st.items.find((i) => i.itemNo === 'B.1');
  assert.deepEqual([st.stale, b1.stale, b1.newerAnalysis.ref], [1, true, `${t.analysis.analysisNo}/v2`]);
  const blocked = await t.call(est1, 'POST', `${E}/estimates/${e.id}/submit`, {});
  assert.equal(blocked.status, 422); assert.match(JSON.stringify(blocked.json), /re-price/);
  const rp = (await t.call(est1, 'POST', `${E}/estimates/${e.id}/reprice`, { version: st.rowVersion })).json.data;
  const nb1 = rp.estimate.items.find((i) => i.itemNo === 'B.1');
  // cement 0.4 x 1.02 x 7600 = 3100.80: the direct cost per cum is 7368.45; x 1.25 = 9210.5625 -> 9210.56
  assert.deepEqual([rp.changed, nb1.stale, nb1.costRate, nb1.sellingRate, nb1.analysis.ref], [1, false, '7368.45', '9210.56', `${t.analysis.analysisNo}/v2`]);
  // only the items of the analysis are re-priced
  assert.equal(rp.estimate.items.find((i) => i.itemNo === 'B.2').components[0].rate, '7200', 'a build-up keeps its rates until it is priced again');
  // submit (replayed with the same key: one instance), the maker never approves
  const k = key();
  const s1 = await t.api.call('POST', `${E}/estimates/${e.id}/submit`, { ...est1, headers: k, body: {} });
  assert.equal(s1.status, 202, JSON.stringify(s1.json));
  const s2 = await t.api.call('POST', `${E}/estimates/${e.id}/submit`, { ...est1, headers: k, body: {} });
  assert.equal(s2.status, 202); assert.equal(s2.json.data.workflowInstanceId, s1.json.data.workflowInstanceId, 'the replay returns the same answer');
  const inst = s1.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(est1, inst), false, 'the maker is not a reviewer');
  assert.equal((await t.call(est1, 'PATCH', `${E}/estimates/${e.id}`, { title: 'changed', version: s1.json.data.rowVersion })).status, 409, 'locked in approval');
  await t.act(est2, inst, 'return');
  let x = (await t.call(est1, 'GET', `${E}/estimates/${e.id}`)).json.data; assert.equal(x.status, 'RETURNED');
  assert.equal((await t.call(est1, 'PATCH', `${E}/estimates/${e.id}`, { contingencyPct: '1.25', version: x.rowVersion })).json.data.contingencyPct, '1.25');
  assert.equal((await t.call(est1, 'POST', `${E}/estimates/${e.id}/submit`, {})).status, 202);
  await t.act(est2, inst); await t.act(dir, inst);
  x = (await t.call(est1, 'GET', `${E}/estimates/${e.id}`)).json.data;
  assert.deepEqual([x.status, x.can.edit, x.can.amend], ['APPROVED', false, true]);
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'est.estimate.approved'").all().map((r) => JSON.parse(r.payload).data ?? JSON.parse(r.payload));
  assert.equal(ev.length, 1); assert.equal(ev[0].estimateId, e.id); assert.ok(ev[0].resources.some((r) => r.description === 'Cement OPC 53' && r.qty === '104.400'), 'the resources go to the material take-off');
  assert.equal(estimatesOf(t.api.db).estimates.approvedForTender(1, 999), null);
  // an approved version is changed only by an amendment: a new version that supersedes it when approved
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/items`, { items: priced(t), version: x.rowVersion })).status, 409);
  assert.equal((await t.call(est1, 'POST', `${E}/estimates/${e.id}/amend`, {})).status, 400, 'an amendment says why');
  const v2 = (await t.call(est1, 'POST', `${E}/estimates/${e.id}/amend`, { reason: 'client asked for a revised offer' })).json.data;
  const s3 = (await t.call(est1, 'POST', `${E}/estimates/${v2.id}/submit`, {})).json.data; await t.act(est2, s3.workflowInstanceId); await t.act(dir, s3.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `${E}/estimates/${e.id}`)).json.data.status, 'SUPERSEDED');
  // withdraw and cancel
  const v3 = (await t.call(est1, 'POST', `${E}/estimates/${v2.id}/versions`, {})).json.data;
  const s4 = (await t.call(est1, 'POST', `${E}/estimates/${v3.id}/submit`, {})).json.data;
  assert.equal((await t.call(est2, 'POST', `${E}/estimates/${v3.id}/withdraw`, { reason: 'not mine to withdraw' })).status, 403);
  assert.equal((await t.call(est1, 'POST', `${E}/estimates/${v3.id}/withdraw`, { reason: 'one more change' })).json.data.status, 'DRAFT');
  assert.equal(await t.hasTask(est2, s4.workflowInstanceId), false);
  assert.equal((await t.call(est1, 'POST', `${E}/estimates/${v3.id}/cancel`, { reason: 'not needed any more' })).json.data.status, 'CANCELLED');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'est_estimates' AND action = 'reprice'").get());
});

test('BR-02 roles and masking: QS and project managers see quantities and selling rates only; costs and margins for estimation, management and commercial; project isolation, another company, the flag, a tender estimate', async () => {
  const t = await setup();
  const e = await built(t);
  // QS: view, print, export; no costs anywhere
  const q = (await t.call(qs, 'GET', `${E}/estimates/${e.id}`)).json.data;
  assert.deepEqual([q.costsVisible, q.items[0].costRate, q.items[0].markupPct, q.items[0].costAmount, q.items[0].sellingRate, q.totals.totalCost, q.totals.margin, q.totals.selling, q.indirects, q.risks, q.sections[0].margin], [false, null, null, null, '6000.00', null, null, '2906035.20', null, null, null]);
  assert.equal(q.items[2].components[0].rate, null);
  const ql = (await t.call(qs, 'GET', `${E}/estimates`)).json.data[0]; assert.deepEqual([ql.totalCost, ql.marginPct, ql.totalSelling], [null, null, '2906035.20']);
  assert.equal((await t.call(qs, 'GET', `${E}/estimates/${e.id}/resources`)).json.data.rows[0].amount, null);
  const qa = { user: 'eqs1', userId: null, companyId: 1, roles: ['QS'] };
  assert.equal((await t.api.call('GET', `${E}/estimates/${e.id}/print`, qs)).status, 200);
  assert.doesNotMatch(estimatesOf(t.api.db).estimates.print(qa, e.id), /Cost rate|Margin/, 'the print is masked too');
  assert.equal((await t.call(qs, 'POST', `${E}/estimates`, { projectId: t.project })).status, 403);
  // the commercial manager and the director see the costs; the commercial manager does not make estimates
  assert.equal((await t.call(com, 'GET', `${E}/estimates/${e.id}`)).json.data.totals.marginPct, '4.84');
  assert.equal((await t.call(dir, 'GET', `${E}/estimates/${e.id}`)).json.data.items[1].costRate, '7205.25');
  assert.equal((await t.call(com, 'POST', `${E}/estimates`, { projectId: t.project })).status, 403);
  assert.equal((await t.call(se, 'GET', `${E}/estimates`)).status, 403, 'a site engineer does not see estimates');
  assert.equal((await t.call(bd1, 'GET', `${E}/estimates/${e.id}`)).status, 403);
  // a project manager assigned to the other project only (the service with the real assignments)
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'epm2', 'epm2', '[]', 'epm2@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([t.other]));
  const s = estimatesOf(t.api.db).estimates; const pm2 = { user: 'epm2', userId: uid, companyId: 1, roles: [] };
  assert.ok(!s.list(pm2, {}).data.some((r) => r.id === e.id), 'the estimate of another project is not listed');
  assert.throws(() => s.get(pm2, e.id), /does not exist/, 'nor opened');
  const own = (await t.call(est1, 'POST', `${E}/estimates`, { projectId: t.other, basisDate: '2026-10-01' })).json.data;
  assert.ok(s.list(pm2, {}).data.some((r) => r.id === own.id)); assert.equal(s.get(pm2, own.id).costsVisible, false);
  assert.equal((await t.call(pm, 'GET', `${E}/estimates/${e.id}`)).status, 200, 'a company-wide project manager sees it (masked)');
  assert.equal((await t.call(as('EST', 'eest1', '2'), 'GET', `${E}/estimates/${e.id}`)).status, 404, 'another company');
  // an estimate of a registered tender
  const partner = Number(t.api.db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, 'CL009', 'National Highways Authority', 'national highways authority', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 't', 'test')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (1, ?, 'CLIENT')").run(partner);
  const ist = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const tn = (await t.call(est1, 'POST', `${B}/tenders`, { clientPartnerId: partner, referenceNo: 'NHAI/2027/EST', portal: 'CPPP', nameOfWork: 'Four-laning of NH-48 package 3', location: 'Pune', region: 'WEST', estCost: 100000000, emd: 2000000, tenderFee: 25000, bidType: 'ITEM_RATE', periodMonths: 24, publishDate: ist(-5), prebidDate: ist(6), submissionAt: `${ist(20)}T15:00`, openingAt: `${ist(20)}T16:00` })).json.data;
  assert.equal((await t.call(est1, 'POST', `${E}/estimates`, { tenderId: tn.id })).status, 400, 'the registration is approved first');
  const ts = (await t.call(est1, 'POST', `${B}/tenders/${tn.id}/submit`, {})).json.data; await t.act(est2, ts.workflowInstanceId);
  const te = await t.call(est1, 'POST', `${E}/estimates`, { tenderId: tn.id, region: 'MH' });
  assert.equal(te.status, 201, JSON.stringify(te.json)); assert.deepEqual([te.json.data.title, te.json.data.tender.docNo], ['Four-laning of NH-48 package 3', tn.docNo]);
  assert.equal((await t.call(est1, 'POST', `${E}/estimates`, {})).status, 400, 'a tender or a project');
  // approved, it is the estimate the bid submission of 08.03 starts from
  const tp = (await t.call(est1, 'PUT', `${E}/estimates/${te.json.data.id}/items`, { items: [{ ...BOQ[0], mode: 'RATE', costRate: '5000', markupPct: '10' }], version: te.json.data.rowVersion })).json.data;
  const tsub = (await t.call(est1, 'POST', `${E}/estimates/${tp.id}/submit`, {})).json.data; await t.act(est2, tsub.workflowInstanceId); await t.act(dir, tsub.workflowInstanceId);
  const ap = estimatesOf(t.api.db).estimates.approvedForTender(1, tn.id); assert.deepEqual([ap.id, ap.total_selling], [tp.id, 55000000], '5500 x 100 = 5,50,000.00 in paise');
  // draft delete by its maker only; the flag hides everything
  assert.equal((await t.call(est2, 'DELETE', `${E}/estimates/${own.id}`)).status, 422);
  assert.equal((await t.call(est1, 'DELETE', `${E}/estimates/${own.id}`)).status, 200);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.est.p0901'").run();
  assert.equal((await t.call(est1, 'GET', `${E}/estimates`)).status, 404, 'flag off');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.est.p0901'").run();
  // the export leaves the cost columns out for QS
  assert.equal((await t.api.call('GET', `${E}/estimates/export?format=csv`, qs)).status, 200);
  const cols = estimatesOf(t.api.db).estimates.exportSource(qa, { q: '', filters: [], sort: [] }).columns.map((c) => c.key);
  assert.ok(cols.includes('totalSelling') && !cols.includes('totalCost') && !cols.includes('marginPct'));
});
