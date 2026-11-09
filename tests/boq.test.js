import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { boqOf, quantityProviders, variationProviders } from '../src/server/modules/proj/boq.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.04: BOQ management. T-01 the import of a client BOQ of 2,000 items with errors reports the exact rows and creates nothing; the corrected file gives totals equal to the source. T-02 the splits over WBS nodes and locations must sum to the item
// quantity, and a frozen version cannot be edited. Also: the tender version from the award, the contract version frozen by QS, the commercial manager and the project manager, the change of mapping and norms after the freeze (QS, project manager),
// a revised version only from an approved variation, the comparison, the norms from a rate analysis, the reports, rates masked for site roles, roles, isolation, another company, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `bq-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const qs1 = as('QS', 'bqs1'); const qs2 = as('QS', 'bqs2'); const est = as('EST', 'best1'); const com = as('COMMGR', 'bcom1'); const pm = as('PM', 'bpm1'); const pcm = as('PCMGR', 'bpcm1'); const se = as('SE', 'bse1'); const bd = as('BD', 'bbd1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['bqs1', ['QS']], ['bqs2', ['QS']], ['best1', ['EST']], ['bcom1', ['COMMGR']], ['bpm1', ['PM']], ['bpcm1', ['PCMGR']], ['bse1', ['SE']], ['bbd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'ROAD').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (1, ?, 'test')").run(id); return id; };
  const a = mk('BQA', 'Alpha road'); const b = mk('BQB', 'Beta bridge');
  const wbs = (code, name, parent = null, level = 1) => Number(api.db.prepare("INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, weight, created_by) VALUES (1, ?, ?, ?, ?, ?, 0, 'test')").run(a, parent, code, name, level).lastInsertRowid);
  const w1 = wbs('1', 'Earthwork'); const w11 = wbs('1.1', 'Excavation', w1, 2); const w12 = wbs('1.2', 'Embankment', w1, 2); const w2 = wbs('2', 'Pavement'); const wOther = Number(api.db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, weight, created_by) VALUES (1, ?, '1', 'Other project node', 1, 0, 'test')").run(b).lastInsertRowid);
  const loc = (code, name, type = 'BUILDING') => Number(api.db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (1, ?, ?, ?, ?, 'test')").run(a, type, code, name).lastInsertRowid);
  const l1 = loc('CH-0-5', 'km 0 to 5'); const l2 = loc('CH-5-9', 'km 5 to 9');
  const cat = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'BQ', 'BOQ test', 'BQT', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, type, uom) => Number(api.db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE')").run(code, name, type, cat, uom).lastInsertRowid);
  const it = { work: item('WRK-EXC', 'Excavation work', 'SERVICE', 'CUM'), cement: item('MAT-CEM', 'Cement', 'MATERIAL', 'MT'), mason: item('LAB-MSN', 'Mason', 'LABOUR', 'DAY') };
  const an = Number(api.db.prepare("INSERT INTO ra_analyses (company_id, analysis_no, version_no, work_item_id, title, basis_qty, basis_uom, effective_from, requested_by, analysis_status) VALUES (1, 'RA-1', 1, ?, 'Excavation in soil', 1000, 'CUM', '2026-01-01', 'test', 'APPROVED')").run(it.work).lastInsertRowid);
  api.db.prepare("INSERT INTO ra_analysis_lines (company_id, analysis_id, line_no, component_type, component_item_id, description, uom, qty_per_basis, wastage_pct, rate, amount) VALUES (1, ?, 1, 'MATERIAL', ?, 'Cement', 'MT', 400, 20000, 700000, 0)").run(an, it.cement);
  api.db.prepare("INSERT INTO ra_analysis_lines (company_id, analysis_id, line_no, component_type, component_item_id, description, uom, qty_per_basis, wastage_pct, rate, amount) VALUES (1, ?, 2, 'LABOUR', ?, 'Mason', 'DAY', 170, 0, 95000, 0)").run(an, it.mason);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  return { api, call, act, hasTask, a, b, w: { w1, w11, w12, w2, wOther }, l: { l1, l2 }, it, an };
}
const byCode = (lines, code) => lines.find((l) => l.code === code);
const row = (n, over = {}) => ({ row: n + 1, bill: `Bill ${1 + (n % 4)}`, section: `Section ${1 + (n % 4)}.${1 + (n % 5)}`, itemCode: `I-${n}`, description: `Work item ${n}`, uom: 'CUM', qty: String(10 + (n % 7)), rate: `${100 + (n % 13)}.50`, ...over });
const dec3 = (s) => Math.round(Number(s) * 1000);

test('T-01 the import of a 2,000-item client BOQ reports the exact rows of the errors and creates nothing; the corrected file totals what the source says', async () => {
  const t = await setup();
  const rows = Array.from({ length: 2000 }, (_, i) => row(i));
  // the errors: missing code (row 18), a quantity that is not a number (row 1501), a duplicate code (row 1999 repeats I-5), a missing unit (row 250), a negative rate (row 3), a sub-item whose parent is not in the file
  const bad = rows.map((r) => ({ ...r })); bad[16].itemCode = ''; bad[1499].qty = 'ten'; bad[1998].itemCode = 'I-5'; bad[248].uom = ''; bad[2].rate = '-5'; bad[10].parentCode = 'NO-SUCH';
  const before = t.api.db.prepare('SELECT COUNT(*) AS n FROM proj_boq_versions').get().n;
  const stage = async (rs) => { let sid; for (let i = 0; i < rs.length; i += 150) { const r = await t.call(qs1, 'POST', '/versions/import/rows', { projectId: t.a, ...(sid ? { stageId: sid } : {}), rows: rs.slice(i, i + 150) }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 200)); sid = r.json.data.stageId; } return sid; };
  const sBad = await stage(bad);
  const pre = await t.call(qs1, 'POST', '/versions/import', { projectId: t.a, vtype: 'TENDER', stageId: sBad, commit: false }); assert.equal(pre.status, 200, JSON.stringify(pre.json).slice(0, 300));
  assert.deepEqual(pre.json.data.errors.map((e) => [e.row, e.field]).sort((x, y) => x[0] - y[0]), [[3, 'rate'], [11, 'parentCode'], [17, 'itemCode'], [249, 'uom'], [1500, 'qty'], [1999, 'itemCode']], 'the exact rows (the row numbers of the source sheet)');
  assert.match(pre.json.data.errors.find((e) => e.row === 1999).message, /on row 6 already/); assert.equal(pre.json.data.committed, false);
  const com1 = await t.call(qs1, 'POST', '/versions/import', { projectId: t.a, vtype: 'TENDER', stageId: sBad, commit: true }); assert.equal(com1.status, 200, JSON.stringify(com1.json).slice(0, 200)); assert.equal(com1.json.data.committed, false, 'nothing is made while a row is wrong');
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM proj_boq_versions').get().n, before); assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM proj_boq_lines').get().n, 0);
  // the corrected file: the total equals the source (qty x rate per row, rounded to the paisa, summed)
  const want = rows.reduce((s, r) => s + Math.round((dec3(r.qty) * Math.round(Number(r.rate) * 10000)) / 100000), 0);
  const sOk = await stage(rows); assert.equal((await t.call(qs1, 'POST', '/versions/import/rows', { projectId: t.a, stageId: sOk, rows: [] })).status, 400);
  const t0 = Date.now(); const ok = await t.call(qs1, 'POST', '/versions/import', { projectId: t.a, vtype: 'TENDER', name: 'Client BOQ 2,000 items', stageId: sOk, columns: [{ key: 'itemCode', header: 'Item No' }, { key: 'description', header: 'Description of work' }, { key: 'uom', header: 'Unit' }, { key: 'qty', header: 'Qty' }, { key: 'rate', header: 'Rate (Rs)' }], commit: true }); const ms = Date.now() - t0;
  assert.equal(ok.status, 201, JSON.stringify(ok.json).slice(0, 300)); assert.equal(ok.json.data.committed, true); assert.equal(ok.json.data.total, (want / 100).toFixed(2), 'the version total equals the source');
  const v = ok.json.data.version; assert.deepEqual([v.items, v.type, v.status, v.total], [2000, 'TENDER', 'DRAFT', (want / 100).toFixed(2)]); assert.ok(ms < 20000, `imported in ${ms} ms`);
  const l = (await t.call(qs1, 'GET', `/versions/${v.id}/lines`)).json.data; assert.equal(l.lines.filter((x) => x.leaf).length, 2000); assert.equal(l.lines.filter((x) => x.kind === 'BILL').length, 4); assert.equal(l.lines.filter((x) => x.kind === 'SECTION').length, 20);
  assert.equal(l.lines.filter((x) => x.depth === 0).reduce((s, x) => s + Number(x.amount), 0).toFixed(2), (want / 100).toFixed(2), 'the bills add up to the total'); assert.equal(byCode(l.lines, 'I-7').amount, (Math.round((dec3(rows[7].qty) * Math.round(Number(rows[7].rate) * 10000)) / 100000) / 100).toFixed(2));
  // the export in the same columns as the sheet
  const ex = await t.api.call('GET', `${P}/versions/${v.id}/document?format=csv`, qs1); assert.equal(ex.status, 200); assert.match(String(ex.headers.get('content-type')), /csv/);
  const file = boqOf(t.api.db).document({ user: 'bqs1', userId: null, companyId: 1, roles: ['QS'] }, v.id, 'csv'); assert.match(file.buffer.toString('utf8').split('\n')[0], /Item No.*Description of work.*Unit.*Qty.*Rate \(Rs\)/, 'the same columns as the client sheet'); assert.equal(file.buffer.toString('utf8').trim().split('\n').length >= 2000, true);
  assert.equal((await t.api.call('GET', `${P}/versions/${v.id}/document?format=csv`, se)).status, 403);
});

test('FR-02 FR-04 FR-05 T-02 tender from the award, hierarchy, the splits must sum to the quantity, bulk mapping, norms from the rate analysis; a frozen version cannot be edited', async () => {
  const t = await setup(); const { w, l } = t;
  assert.equal((await t.call(qs1, 'POST', '/versions', { projectId: t.a, vtype: 'TENDER', name: 'Tender BOQ', from: 'AWARD' })).status, 422, 'no award copy yet');
  const ins = t.api.db.prepare("INSERT INTO proj_boq_items (company_id, project_id, section_code, section_name, item_no, sort_order, description, uom, qty, client_rate, cost_rate, markup_pct, selling_rate, cost_amount, amount, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?, 'test')");
  ins.run(t.a, 'A', 'Earthwork', 'A.1', 1, 'Excavation in soil', 'CUM', 120000, 1855000, 18550, 2226000000); ins.run(t.a, 'A', 'Earthwork', 'A.2', 2, 'Embankment', 'CUM', 85000, 3102500, 31025, 2636000000); ins.run(t.a, 'B', 'Pavement', 'B.1', 3, 'DBM 50 mm', 'CUM', 9500, 92507500, 925075, 8788000000);
  const tv = (await t.call(qs1, 'POST', '/versions', { projectId: t.a, vtype: 'TENDER', name: 'Tender BOQ', from: 'AWARD' })); assert.equal(tv.status, 201, JSON.stringify(tv.json)); const tender = tv.json.data;
  const tl = (await t.call(qs1, 'GET', `/versions/${tender.id}/lines`)).json.data.lines; assert.deepEqual(tl.map((x) => [x.kind, x.code, x.depth]), [['SECTION', 'A', 0], ['ITEM', 'A.1', 1], ['ITEM', 'A.2', 1], ['SECTION', 'B', 0], ['ITEM', 'B.1', 1]]);
  assert.deepEqual([byCode(tl, 'A.1').qty, byCode(tl, 'A.1').rate, byCode(tl, 'A.1').amount, byCode(tl, 'A').amount], ['120', '185.5', '22260.00', '48631.25']); assert.equal(tv.json.data.total, '136513.38');
  // lines: the hierarchy rules, the amount is worked out on the server
  const bill = await t.call(qs1, 'POST', `/versions/${tender.id}/lines`, { kind: 'BILL', itemCode: 'BILL-X', description: 'Extras' }); assert.equal(bill.status, 201);
  const bid = byCode(bill.json.data.lines, 'BILL-X').id;
  assert.equal((await t.call(qs1, 'POST', `/versions/${tender.id}/lines`, { kind: 'SUBITEM', parentId: bid, itemCode: 'X.1', description: 'x', uom: 'NOS', qty: '1', rate: '1' })).status, 400, 'a sub-item sits under an item');
  assert.equal((await t.call(qs1, 'POST', `/versions/${tender.id}/lines`, { kind: 'ITEM', itemCode: 'A.1', description: 'dup', uom: 'CUM', qty: '1', rate: '1' })).status, 400, 'codes are unique');
  assert.equal((await t.call(qs1, 'POST', `/versions/${tender.id}/lines`, { kind: 'SECTION', itemCode: 'S-Q', description: 'a section with a quantity', qty: '5' })).status, 400);
  const extra = await t.call(qs1, 'POST', `/versions/${tender.id}/lines`, { kind: 'ITEM', parentId: bid, itemCode: 'NS-1', description: 'Non-schedule item: dewatering', uom: 'LS', qty: '1', rate: '50000', isExtra: true }); assert.equal(extra.status, 201, JSON.stringify(extra.json)); assert.equal(byCode(extra.json.data.lines, 'NS-1').isExtra, true); assert.equal(byCode(extra.json.data.lines, 'NS-1').amount, '50000.00');
  const a1 = byCode(extra.json.data.lines, 'A.1'); const a2 = byCode(extra.json.data.lines, 'A.2');
  // T-02: the splits sum to the quantity
  const set = (id, splits) => t.call(qs1, 'PUT', `/boq-lines/${id}/mapping`, { splits });
  assert.equal((await set(a1.id, [{ wbsId: w.w11, qty: '70' }, { wbsId: w.w12, qty: '40' }])).status, 400, 'the splits sum to 110, not 120');
  assert.equal((await set(a1.id, [{ wbsId: w.w1, qty: '120' }])).status, 400, 'a node with nodes under it is not mapped');
  assert.equal((await set(a1.id, [{ wbsId: w.wOther, qty: '120' }])).status, 400, 'a node of another project');
  assert.equal((await set(a1.id, [{ wbsId: w.w11, qty: '60' }, { wbsId: w.w11, qty: '60' }])).status, 400, 'the same node and location twice');
  assert.equal((await set(a1.id, [{ wbsId: w.w11, qty: '0' }, { wbsId: w.w12, qty: '120' }])).status, 400, 'a split above zero');
  const ok = await set(a1.id, [{ wbsId: w.w11, locationId: l.l1, qty: '70' }, { wbsId: w.w11, locationId: l.l2, qty: '50' }]); assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.data.mappedQty, '120'); assert.equal(ok.json.data.splits.length, 2);
  assert.equal(byCode((await t.call(qs1, 'GET', `/versions/${tender.id}/lines`)).json.data.lines, 'A.1').mapped, 'MAPPED');
  assert.equal((await t.call(qs1, 'PATCH', `/boq-lines/${a1.id}`, { qty: '130' })).status, 422, 'a mapped quantity is changed with its mapping');
  assert.equal((await set(a1.id, [])).status, 200, 'the splits are cleared');
  assert.equal((await t.call(qs1, 'PATCH', `/boq-lines/${a1.id}`, { qty: '130', version: a1.rowVersion })).status, 200);
  assert.equal((await t.call(qs1, 'PATCH', `/boq-lines/${a1.id}`, { qty: '120', version: a1.rowVersion })).status, 409, 'stale');
  // bulk assignment: the whole quantity of each chosen item to one node
  const bm = await t.call(qs1, 'POST', `/versions/${tender.id}/mapping/bulk`, { lineIds: [a2.id, byCode(tl, 'B.1').id], wbsId: w.w2 }); assert.equal(bm.status, 200, JSON.stringify(bm.json)); assert.equal(bm.json.data.mapped, 2);
  assert.equal(byCode(bm.json.data.lines, 'B.1').mapped, 'MAPPED'); assert.equal(byCode(bm.json.data.lines, 'A.2').mapped, 'MAPPED');
  const un = (await t.call(qs1, 'GET', `/versions/${tender.id}/unmapped`)).json.data; assert.deepEqual(un.rows.map((x) => x.code).sort(), ['A.1', 'NS-1']);
  // norms: typed, then from the rate analysis (400 kg of cement per 1,000 cum = 0.4 per cum; 20 % wastage)
  const nm = await t.call(qs1, 'PUT', `/boq-lines/${a2.id}/norms`, { norms: [{ type: 'MATERIAL', resourceItemId: t.it.cement, description: 'Cement', uom: 'MT', qtyPerUnit: '0.05', wastagePct: '2' }, { type: 'LABOUR', description: 'Beldar', uom: 'HR', qtyPerUnit: '0.8' }] }); assert.equal(nm.status, 200, JSON.stringify(nm.json)); assert.equal(nm.json.data.norms.length, 2);
  assert.equal((await t.call(qs1, 'PUT', `/boq-lines/${a2.id}/norms`, { norms: [{ type: 'MATERIAL', resourceItemId: 999999, description: 'x', uom: 'MT', qtyPerUnit: '1' }] })).status, 400);
  assert.equal((await t.call(qs1, 'POST', `/boq-lines/${a2.id}/norms/from-analysis`, {})).status, 422, 'no analysis chosen');
  await t.call(qs1, 'PATCH', `/boq-lines/${a2.id}`, { analysisId: t.an, workItemId: t.it.work, version: (await t.call(qs1, 'GET', `/boq-lines/${a2.id}/norms`)).json.data.line.id ? byCode((await t.call(qs1, 'GET', `/versions/${tender.id}/lines`)).json.data.lines, 'A.2').rowVersion : 1 });
  const fa = await t.call(qs1, 'POST', `/boq-lines/${a2.id}/norms/from-analysis`, {}); assert.equal(fa.status, 200, JSON.stringify(fa.json)); assert.deepEqual(fa.json.data.norms.map((n) => [n.type, n.description, n.qtyPerUnit, n.wastagePct]), [['MATERIAL', 'Cement', '0.4', '2'], ['LABOUR', 'Mason', '0.17', '0']]);
  // the contract version: a copy of the tender with its mapping and norms; one contract only
  const cv = await t.call(qs1, 'POST', '/versions', { projectId: t.a, vtype: 'CONTRACT', name: 'Contract BOQ', from: 'VERSION', sourceVersionId: tender.id }); assert.equal(cv.status, 201, JSON.stringify(cv.json)); const contract = cv.json.data;
  assert.equal(cv.json.data.total, (await t.call(qs1, 'GET', `/versions/${tender.id}`)).json.data.total); const cl = (await t.call(qs1, 'GET', `/versions/${contract.id}/lines`)).json.data.lines; assert.equal(byCode(cl, 'A.2').mapped, 'MAPPED'); assert.equal(byCode(cl, 'A.2').norms, 2);
  assert.equal((await t.call(qs1, 'POST', '/versions', { projectId: t.a, vtype: 'CONTRACT', name: 'Second contract', from: 'EMPTY' })).status, 409, 'one contract BOQ');
  assert.equal((await t.call(qs1, 'POST', `/versions/${tender.id}/submit`, {})).status, 422, 'a tender version is not frozen');
  // the freeze: the maker (EST) sends it; QS, the commercial manager, the project manager approve; the sender never signs
  assert.equal((await t.call(se, 'POST', `/versions/${contract.id}/submit`, {})).status, 403);
  const sub = await t.call(est, 'POST', `/versions/${contract.id}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId; assert.ok(sub.json.data.warnings.some((x) => x.code === 'UNMAPPED'), 'unmapped items are a warning');
  assert.equal((await t.call(qs1, 'PATCH', `/boq-lines/${byCode(cl, 'A.2').id}`, { description: 'Changed while waiting' })).status, 409); assert.equal(await t.hasTask(est, inst), false); assert.equal(await t.hasTask(com, inst), false);
  await t.act(qs1, inst); await t.act(com, inst); assert.equal((await t.call(qs1, 'GET', `/versions/${contract.id}`)).json.data.status, 'SUBMITTED'); await t.act(pm, inst);
  const fz = (await t.call(qs1, 'GET', `/versions/${contract.id}`)).json.data; assert.deepEqual([fz.status, fz.statusLabel, Boolean(fz.frozenAt), fz.can.edit], ['APPROVED', 'Frozen', true, false]);
  const evd = JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'boq.version.frozen'").get().payload); assert.equal((evd.data ?? evd).items, 4);
  // BR-02: nothing in a frozen version changes
  const fa2 = byCode((await t.call(qs1, 'GET', `/versions/${contract.id}/lines`)).json.data.lines, 'A.2');
  for (const [m, p, b] of [['PATCH', `/boq-lines/${fa2.id}`, { qty: '1' }], ['DELETE', `/boq-lines/${fa2.id}`, undefined], ['POST', `/versions/${contract.id}/lines`, { kind: 'ITEM', itemCode: 'Z', description: 'z', uom: 'NOS', qty: '1', rate: '1' }], ['PUT', `/boq-lines/${fa2.id}/mapping`, { splits: [] }], ['PUT', `/boq-lines/${fa2.id}/norms`, { norms: [] }], ['POST', `/versions/${contract.id}/mapping/bulk`, { lineIds: [fa2.id], wbsId: w.w2 }], ['PATCH', `/versions/${contract.id}`, { name: 'x' }], ['DELETE', `/versions/${contract.id}`, undefined], ['POST', `/versions/import`, { projectId: t.a, vtype: 'CONTRACT', intoVersionId: contract.id, rows: [row(1)], commit: true }]]) {
    const r = await t.call(qs1, m, p, b); assert.ok([409, 422].includes(r.status), `${m} ${p}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  assert.equal((await t.call(qs1, 'GET', `/versions/${contract.id}/lines`)).json.data.lines.length, 7);
  // after the freeze: mapping and norms change by a request approved by QS and the project manager
  const ch = await t.call(qs1, 'POST', `/versions/${contract.id}/amend`, { reason: 'Embankment is built from both sections', ops: [{ lineId: fa2.id, splits: [{ wbsId: w.w11, qty: '50' }, { wbsId: w.w12, qty: '35' }] }] }); assert.equal(ch.status, 202, JSON.stringify(ch.json)); assert.equal(ch.json.data.diff[0].kind, 'MAPPING');
  assert.equal((await t.call(qs1, 'POST', `/versions/${contract.id}/amend`, { reason: 'A second at the same time', ops: [{ lineId: fa2.id, norms: [] }] })).status, 409);
  assert.equal(byCode((await t.call(qs1, 'GET', `/versions/${contract.id}/lines`)).json.data.lines, 'A.2').splits, 1, 'nothing changes until approved');
  assert.equal(await t.hasTask(qs1, ch.json.data.workflowInstanceId), false, 'the sender does not sign'); await t.act(qs2, ch.json.data.workflowInstanceId); await t.act(pm, ch.json.data.workflowInstanceId);
  assert.equal(byCode((await t.call(qs1, 'GET', `/versions/${contract.id}/lines`)).json.data.lines, 'A.2').splits, 2); assert.equal((await t.call(qs1, 'GET', `/boq-changes?versionId=${contract.id}`)).json.data[0].status, 'APPROVED');
  const bad = await t.call(qs1, 'POST', `/versions/${contract.id}/amend`, { reason: 'Splits that do not add up', ops: [{ lineId: fa2.id, splits: [{ wbsId: w.w11, qty: '1' }] }] }); assert.equal(bad.status, 400, 'checked before it is sent');
  assert.equal((await t.call(qs1, 'POST', `/versions/${contract.id}/amend`, { reason: 'Norms of the embankment', ops: [{ lineId: fa2.id, norms: [{ type: 'LABOUR', description: 'Beldar', uom: 'HR', qtyPerUnit: '1' }] }] })).status, 202);
});

test('BR-02 a revised version only from an approved variation; the comparison; quantity status columns; reports; rates masked for site roles; roles, isolation, the flag', async () => {
  const t = await setup(); const { w } = t;
  const rows = [row(1, { bill: 'Bill 1', section: 'Sec 1' }), row(2, { bill: 'Bill 1', section: 'Sec 1' }), row(3, { bill: 'Bill 1', section: 'Sec 2' }), row(4, { bill: 'Bill 2', section: 'Sec 3' })];
  const imp = await t.call(qs1, 'POST', '/versions/import', { projectId: t.a, vtype: 'CONTRACT', name: 'Contract BOQ', rows, commit: true }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); const contract = imp.json.data.version;
  const lines = (await t.call(qs1, 'GET', `/versions/${contract.id}/lines`)).json.data.lines;
  // everything mapped (the whole quantity of each item to one node), then frozen by QS, the commercial manager, the project manager
  const ids = lines.filter((x) => x.leaf).map((x) => x.id); assert.equal((await t.call(qs1, 'POST', `/versions/${contract.id}/mapping/bulk`, { lineIds: ids, wbsId: w.w2 })).status, 200);
  const sub = await t.call(est, 'POST', `/versions/${contract.id}/submit`, {}); assert.equal(sub.status, 202); assert.deepEqual(sub.json.data.warnings, []); const inst = sub.json.data.workflowInstanceId;
  await t.act(qs1, inst); await t.act(com, inst); await t.act(pm, inst); assert.equal((await t.call(qs1, 'GET', `/versions/${contract.id}`)).json.data.status, 'APPROVED');
  assert.equal((await t.call(qs1, 'POST', `/versions/${contract.id}/cancel`, { reason: 'try to cancel a frozen BOQ' })).status, 422);
  // BR-02: a revised version is made only from an approved variation (21.05); until it registers, none is made
  assert.equal((await t.call(qs1, 'POST', '/versions/revised', { projectId: t.a, variationRef: 'VO-001' })).status, 422);
  variationProviders.push((_db, c) => (c.variationRef === 'VO-001' && c.projectId === t.a ? { ref: 'VO-001 (approved)' } : null));
  assert.equal((await t.call(qs1, 'POST', '/versions/revised', { projectId: t.a, variationRef: 'VO-777' })).status, 422, 'a variation that is not approved');
  assert.equal((await t.call(se, 'POST', '/versions/revised', { projectId: t.a, variationRef: 'VO-001' })).status, 403);
  const rv = await t.call(qs1, 'POST', '/versions/revised', { projectId: t.a, variationRef: 'VO-001' }); assert.equal(rv.status, 201, JSON.stringify(rv.json)); const revised = rv.json.data;
  assert.deepEqual([revised.type, revised.versionNo, revised.parentVersionId, revised.variationRef, revised.status, revised.total], ['REVISED', 2, contract.id, 'VO-001', 'DRAFT', contract.total]);
  assert.equal((await t.call(qs1, 'POST', '/versions/revised', { projectId: t.a, variationRef: 'VO-001' })).status, 409, 'one open revised version');
  const rl = (await t.call(qs1, 'GET', `/versions/${revised.id}/lines`)).json.data.lines; assert.equal(byCode(rl, 'I-1').mapped, 'MAPPED', 'the mapping is copied');
  // the variation: I-2 quantity up, I-3 removed, a new item
  const i2 = byCode(rl, 'I-2'); assert.equal((await t.call(qs1, 'PUT', `/boq-lines/${i2.id}/mapping`, { splits: [] })).status, 200); const up = await t.call(qs1, 'PATCH', `/boq-lines/${i2.id}`, { qty: '30' }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.version.total === contract.total, false, 'the total moves');
  await t.call(qs1, 'PUT', `/boq-lines/${i2.id}/mapping`, { splits: [{ wbsId: w.w11, qty: '30' }] });
  assert.equal((await t.call(qs1, 'DELETE', `/boq-lines/${byCode(rl, 'I-3').id}`)).status, 200);
  assert.equal((await t.call(qs1, 'POST', `/versions/${revised.id}/lines`, { kind: 'ITEM', parentId: byCode(rl, 'Sec 3').id, itemCode: 'NEW-1', description: 'New item by variation', uom: 'NOS', qty: '5', rate: '1000', isExtra: true })).status, 201);
  const sub2 = await t.call(qs1, 'POST', `/versions/${revised.id}/submit`, {}); assert.equal(sub2.status, 202); const i2n = sub2.json.data.workflowInstanceId; assert.equal(await t.hasTask(qs1, i2n), false); await t.act(qs2, i2n); await t.act(com, i2n); await t.act(pm, i2n);
  assert.equal((await t.call(qs1, 'GET', `/versions/${revised.id}`)).json.data.status, 'APPROVED'); const fr = boqOf(t.api.db).frozen(1, t.a); assert.deepEqual([fr.type, fr.versionNo], ['REVISED', 2]); assert.equal(fr.items.length, 4);
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'boq.version.frozen'").get().n >= 2);
  // the comparison
  const cmp = (await t.call(qs1, 'GET', `/versions/compare?a=${contract.id}&b=${revised.id}`)).json.data; assert.deepEqual(cmp.counts, { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(cmp.rows.map((r) => `${r.change}:${r.code}`).sort(), ['ADDED:NEW-1', 'CHANGED:I-2', 'REMOVED:I-3']); assert.equal(cmp.rows.find((r) => r.code === 'I-2').before.qty, '12'); assert.equal(cmp.rows.find((r) => r.code === 'I-2').after.qty, '30');
  assert.equal(Number(cmp.delta).toFixed(2), (Number(cmp.b.total) - Number(cmp.a.total)).toFixed(2)); assert.equal((await t.call(qs1, 'GET', `/versions/compare?a=${contract.id}&b=999999`)).status, 404);
  // the abstract and the quantity status columns of the other modules (FR-06)
  const ab = (await t.call(qs1, 'GET', `/versions/${revised.id}/abstract`)).json.data; assert.deepEqual(ab.chart.map((x) => x.code), ['Bill 1', 'Bill 2']); assert.equal(Math.round(ab.rows.filter((r) => r.depth === 0).reduce((s, r) => s + Number(r.share), 0)), 100);
  quantityProviders.push((_db, c) => new Map(c.lineIds.map((id) => [id, { executed: '3', measured: '2', certified: '2', billed: '1' }])));
  const st = byCode((await t.call(qs1, 'GET', `/versions/${revised.id}/lines`)).json.data.lines, 'I-1'); quantityProviders.pop(); assert.deepEqual([st.executed, st.measured, st.certified, st.billed, st.balance], ['3', '2', '2', '1', '9'], 'balance = quantity - certified');
  assert.equal(byCode((await t.call(qs1, 'GET', `/versions/${revised.id}/lines`)).json.data.lines, 'I-1').executed, null, 'empty until those modules are live'); variationProviders.pop();
  // rates masked for site roles and exports refused
  const se1 = (await t.call(se, 'GET', `/versions/${revised.id}/lines`)).json.data; assert.equal(se1.version.ratesVisible, false); assert.equal(se1.version.total, null); assert.ok(se1.lines.every((x) => x.rate === null && x.amount === null)); assert.equal(byCode(se1.lines, 'I-1').qty, '11');
  assert.equal((await t.call(se, 'GET', `/versions/compare?a=${contract.id}&b=${revised.id}`)).json.data.delta, null); assert.equal((await t.call(se, 'POST', '/versions', { projectId: t.a, vtype: 'TENDER', name: 'x', from: 'EMPTY' })).status, 403);
  const pcm1 = (await t.call(pcm, 'GET', `/versions/${revised.id}`)).json.data; assert.equal(pcm1.ratesVisible, true); assert.equal(pcm1.can.edit, false);
  // lists, exports, print; roles; isolation; the flag
  const list = (await t.call(qs1, 'GET', '/versions')).json; assert.deepEqual(list.data.map((x) => x.versionNo).sort(), [1, 2]); assert.equal((await t.api.call('GET', `${P}/versions/export?format=csv`, qs1)).status, 200); assert.equal((await t.api.call('GET', `${P}/versions/export?format=csv`, se)).status, 403);
  assert.equal((await t.api.call('GET', `${P}/versions/${revised.id}/print`, se)).status, 403); assert.equal((await t.api.call('GET', `${P}/versions/${revised.id}/print`, qs1)).status, 200); assert.equal((await t.api.call('GET', `${P}/versions/${revised.id}/document?format=pdf`, qs1)).status, 200);
  assert.equal((await t.call(bd, 'GET', '/versions')).status, 403); assert.equal((await t.call(as('QS', 'bqs1', '2'), 'GET', `/versions/${revised.id}`)).status, 404, 'another company');
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'bqs3', 'bqs3', '[]', 'bqs3@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'QS'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([t.b]));
  const q3 = { user: 'bqs3', userId: uid, companyId: 1, roles: [] }; const s = boqOf(t.api.db); assert.throws(() => s.versions.get(q3, revised.id), /does not exist/); assert.ok(!s.versions.list(q3, {}).data.some((x) => x.projectId === t.a)); assert.throws(() => s.lines.list(q3, revised.id), /does not exist/);
  // the Excel import row of 04.13 into a draft; refused into a frozen version
  const tn = (await t.call(qs1, 'POST', '/versions', { projectId: t.a, vtype: 'TENDER', name: 'Another tender BOQ', from: 'EMPTY' })).json.data; const qa = { user: 'bqs1', userId: null, companyId: 1, roles: ['QS'] };
  assert.equal(s.importer.importRow(qa, { versionNo: tn.docNo, row: { bill: 'B', section: 'S', itemCode: 'X-1', description: 'Imported by workbook', uom: 'cum', qty: '4', rate: '10' } }).ref, `${tn.docNo} X-1`); assert.throws(() => s.importer.importRow(qa, { versionNo: revised.docNo, row: { itemCode: 'X-2', description: 'x', uom: 'NOS', qty: '1', rate: '1' } }), /frozen/);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1004'").run(); assert.equal((await t.call(qs1, 'GET', '/versions')).status, 404, 'flag off'); assert.equal((await t.call(pcm, 'GET', '/projects')).status, 200);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1004'").run();
});
