import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { mtoOf } from '../src/server/modules/est/mto.js';
import { setupCompany, startApi } from './helpers.js';

// Part 09.02: quantity take-off, material take-off and bar bending schedules. T-01 the weight of 100 bars of 12 mm x 6 m is 100 x 6 x 0.888 = 532.8 kg (and a stirrup and a hooked bar by their IS 2502 shape codes);
// T-02 the delta report between two revisions (take-off by BOQ item, BBS by bar mark and by diameter). Also: the formula templates of the take-off, the explosion into materials through the bill of resources with wastage, the
// release by a checker (QS or the design lead; never the preparer), released revisions locked, the quantities fed into a draft estimate (09.01), an engineering MTO, conflicts and replays, roles and project isolation.
const E = '/api/v1/est';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `mto-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const est1 = as('EST', 'mest1'); const qs1 = as('QS', 'mqs1'); const des1 = as('DESIGN', 'mdes1'); const pm1 = as('PM', 'mpm1'); const se1 = as('SE', 'mse1'); const dir1 = as('DIR', 'mdir1'); const com1 = as('COMMGR', 'mcom1'); const bd1 = as('BD', 'mbd1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['mest1', ['EST']], ['mqs1', ['QS']], ['mdes1', ['DESIGN']], ['mpm1', ['PM']], ['mse1', ['SE']], ['mdir1', ['DIR']], ['mcom1', ['COMMGR']], ['mbd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body, k = key()) => api.call(method, `${E}${path}`, { ...who, headers: k, body });
  const tasks = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await tasks(who)).find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked against the drawing' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const cat = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'MT', 'MTO test', 'MTO', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, type, uom) => Number(api.db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE')").run(code, name, type, cat, uom).lastInsertRowid);
  const it = { cement: item('MAT-CEM-7', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('MAT-SND-7', 'Coarse sand', 'MATERIAL', 'CUM'), pipe: item('MAT-PIP-7', 'MS pipe 100 NB', 'MATERIAL', 'RM'), m25: item('WI-M25-7', 'RCC M25', 'WORK_ITEM', 'CUM') };
  // the bill of resources of M25 (06.03): 0.4 MT of cement with 2% wastage, 0.42 cum of sand with 5%
  for (const [c, q, u, w, n] of [[it.cement, 400, 'MT', 20000, 1], [it.sand, 420, 'CUM', 50000, 2]]) api.db.prepare('INSERT INTO mdm_item_resources (company_id, parent_item_id, component_item_id, qty_per_unit, uom, wastage_pct, sort_order) VALUES (1, ?, ?, ?, ?, ?, ?)').run(it.m25, c, q, u, w, n);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'MPA', 'Alpha towers', 'BUILDING')").run().lastInsertRowid);
  const other = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'MPB', 'Beta mall', 'BUILDING')").run().lastInsertRowid);
  return { api, call, act, tasks, it, project, other };
}
const BBS_R0 = [
  { member: 'C1', barMark: 'B1', dia: 12, shapeCode: '00', a: '6', membersCount: 10, barsEach: 10 },
  { member: 'C1', barMark: 'S1', dia: 8, shapeCode: '51', a: '0.3', b: '0.45', membersCount: 30, barsEach: 1 },
  { member: 'C1', barMark: 'B3', dia: 10, shapeCode: '33', a: '3.2', membersCount: 4, barsEach: 6 },
];
async function released(t, who, path, id) {
  const s = await t.call(who, 'POST', `${path}/${id}/submit`, {}); assert.equal(s.status, 202, JSON.stringify(s.json));
  const inst = s.json.data.workflowInstanceId;
  assert.ok(!(await t.tasks(who)).some((x) => x.instance.id === inst), 'the preparer is not the checker');
  await t.act(who === qs1 ? des1 : qs1, inst);
  return (await t.call(who, 'GET', `${path}/${id}`)).json.data;
}

test('T-01 the weight of a bar mark: 100 bars of 12 mm x 6 m = 532.8 kg; stirrups and hooked bars by their shape codes; the summary by diameter; T-02 the BBS delta between revisions', async () => {
  const t = await setup();
  const c = await t.call(est1, 'POST', '/bbs', { title: 'Columns C1, ground floor', projectId: t.project, drawingRef: 'STR-GF-101', drawingRev: 'A', member: 'C1' });
  assert.equal(c.status, 201, JSON.stringify(c.json)); assert.match(c.json.data.ref, /^BBS-\d{5} R0$/);
  // validation: a shape that needs a length without it, a bar mark twice
  assert.equal((await t.call(est1, 'PUT', `/bbs/${c.json.data.id}/lines`, { lines: [{ ...BBS_R0[1], b: null }], version: c.json.data.rowVersion })).status, 400);
  assert.equal((await t.call(est1, 'PUT', `/bbs/${c.json.data.id}/lines`, { lines: [BBS_R0[0], BBS_R0[0]], version: c.json.data.rowVersion })).status, 400);
  const b = (await t.call(est1, 'PUT', `/bbs/${c.json.data.id}/lines`, { lines: BBS_R0, version: c.json.data.rowVersion })).json.data;
  const m = Object.fromEntries(b.lines.map((l) => [l.barMark, l]));
  // T-01: straight, 6 m, 10 columns x 10 bars: 600 m x 0.888 kg/m (12 x 12 / 162) = 532.8 kg
  assert.deepEqual([m.B1.nos, m.B1.cutLength, m.B1.totalLength, m.B1.unitWeight, m.B1.weightKg], [100, '6', '600', '0.888', '532.8']);
  // a closed stirrup (51): 2 x (0.3 + 0.45) = 1.5 m, two 135° hooks of 10d, three 90° bends of 2d: 1.5 + (20 - 6) x 8 mm = 1.612 m; 30 x 1.612 = 48.36 m x 0.395 = 19.102 kg
  assert.deepEqual([m.S1.cutLength, m.S1.totalLength, m.S1.unitWeight, m.S1.weightKg], ['1.612', '48.36', '0.395', '19.102']);
  // two 180° hooks of 9d (33): 3.2 + 18 x 10 mm = 3.38 m; 24 bars = 81.12 m x 0.617 = 50.051 kg
  assert.deepEqual([m.B3.cutLength, m.B3.weightKg], ['3.38', '50.051']);
  assert.deepEqual(b.byDia.map((d) => [d.dia, d.weightKg]), [[8, '19.102'], [10, '50.051'], [12, '532.800']]);
  assert.equal(b.weightKg, '601.953');
  assert.ok(b.shapes.some((s) => s.code === '51') && b.deductions.d90 === 2, 'the shape code library and the deductions');
  // released by a checker (QS or the design lead), never the preparer
  const r0 = await released(t, est1, '/bbs', b.id);
  assert.equal(r0.status, 'APPROVED');
  assert.equal((await t.call(est1, 'PUT', `/bbs/${b.id}/lines`, { lines: BBS_R0, version: r0.rowVersion })).status, 409, 'a released revision never changes (BR-02)');
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'est.bbs.released'").all().map((x) => JSON.parse(x.payload).data ?? JSON.parse(x.payload));
  assert.equal(ev.length, 1); assert.equal(ev[0].totalKg, '601.953'); assert.deepEqual(ev[0].requirements.map((x) => [x.description, x.qty]), [['Reinforcement steel 8 mm', '19.102'], ['Reinforcement steel 10 mm', '50.051'], ['Reinforcement steel 12 mm', '532.800']]);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM mto_material_requirements WHERE source_type = 'mto_bbs' AND source_id = ?").get(String(b.id)).n, 3, 'stored for procurement and MRP');
  // FR-05 a new drawing revision: 12 bars per column, B3 dropped, 16 mm added; the delta against the released R0 (T-02)
  assert.equal((await t.call(est1, 'POST', `/bbs/${b.id}/amend`, {})).status, 400, 'a released schedule is revised with a reason');
  const r1 = (await t.call(est1, 'POST', `/bbs/${b.id}/amend`, { reason: 'drawing revision B: more bars in the columns', drawingRev: 'B' })).json.data;
  assert.deepEqual([r1.ref.endsWith(' R1'), r1.status, r1.drawingRev, r1.weightKg], [true, 'DRAFT', 'B', '601.953']);
  const u1 = (await t.call(est1, 'PUT', `/bbs/${r1.id}/lines`, { lines: [{ ...BBS_R0[0], barsEach: 12 }, BBS_R0[1], { member: 'C1', barMark: 'B4', dia: 16, shapeCode: '11', a: '3', b: '0.5', membersCount: 10, barsEach: 4 }], version: r1.rowVersion })).json.data;
  const d = (await t.call(est1, 'GET', `/bbs/${u1.id}/delta`)).json.data;
  const row = (ref) => d.rows.find((x) => x.ref === ref);
  assert.equal(d.base.id, b.id, 'against the previous released revision');
  assert.deepEqual(d.counts, { added: 1, removed: 1, changed: 1, same: 1 });
  // B1: 120 bars = 720 m x 0.888 = 639.36 kg (+106.56); B3 removed; B4: 3 + 0.5 - 2 x 16 mm = 3.468 m x 40 = 138.72 m x 1.580 = 219.178 kg
  assert.deepEqual([row('C1 B1').change, row('C1 B1').delta, row('C1 B3').change, row('C1 B3').delta, row('C1 B4').change, row('C1 B4').to], ['CHANGED', '106.560', 'REMOVED', '-50.051', 'ADDED', '219.178']);
  assert.deepEqual(d.byDia.map((x) => [x.dia, x.delta]), [[8, '0.000'], [10, '-50.051'], [12, '106.560'], [16, '219.178']]);
  await released(t, est1, '/bbs', u1.id);
  assert.equal((await t.call(est1, 'GET', `/bbs/${b.id}`)).json.data.status, 'SUPERSEDED');
  // the summary of the project: the released schedules only (R1)
  const s = (await t.call(qs1, 'GET', `/bbs-summary?projectId=${t.project}`)).json.data;
  assert.deepEqual([s.schedules.length, s.totalKg, s.rows.map((x) => x.dia)], [1, '877.640', [8, 12, 16]]);
});

test('T-02 the take-off delta by BOQ item between revisions; formula templates; the explosion through the bill of resources with wastage; the quantities into a draft estimate; an engineering MTO', async () => {
  const t = await setup();
  const c = (await t.call(qs1, 'POST', '/takeoffs', { title: 'Tower A superstructure', projectId: t.project, drawingRef: 'STR-A-201', drawingRev: 'A' })).json.data;
  const L0 = [
    { boqItemRef: 'B.1', description: 'Columns C1 (4 nos)', template: 'CONCRETE_VOLUME', workItemId: t.it.m25, nos: '4', length: '0.45', breadth: '0.3', height: '3.2' },
    { boqItemRef: 'B.1', description: 'Beams B1', template: 'CONCRETE_VOLUME', workItemId: t.it.m25, nos: '6', length: '5', breadth: '0.3', height: '0.45' },
    { boqItemRef: 'A.1', description: 'Plaster to walls, less openings', template: 'PLASTER_AREA', nos: '2', length: '12.5', height: '3', deduction: '4.2' },
  ];
  assert.equal((await t.call(qs1, 'PUT', `/takeoffs/${c.id}/lines`, { lines: [{ ...L0[0], height: null }], version: c.rowVersion })).status, 400, 'the template needs its dimensions');
  assert.equal((await t.call(qs1, 'PUT', `/takeoffs/${c.id}/lines`, { lines: [{ ...L0[2], deduction: '80' }], version: c.rowVersion })).status, 400, 'deductions above the measure');
  assert.equal((await t.call(qs1, 'PUT', `/takeoffs/${c.id}/lines`, { lines: [{ description: 'Something', template: 'DIRECT', quantity: '5', uom: 'NOS' }], version: c.rowVersion })).status, 400, 'a take-off line is measured');
  const v0 = (await t.call(qs1, 'PUT', `/takeoffs/${c.id}/lines`, { lines: L0, version: c.rowVersion })).json.data;
  // 4 x 0.45 x 0.3 x 3.2 = 1.728 cum; 6 x 5 x 0.3 x 0.45 = 4.05 cum; 2 x 12.5 x 3 - 4.2 = 70.8 sqm
  assert.deepEqual(v0.lines.map((l) => [l.quantity, l.uom]), [['1.728', 'CUM'], ['4.05', 'CUM'], ['70.8', 'SQM']]);
  assert.deepEqual(v0.items.map((i) => [i.ref, i.qty]), [['B.1', '5.778'], ['A.1', '70.800']]);
  // FR-04 explosion (live before the release): 5.778 cum of M25: cement 5.778 x 0.4 = 2.311 MT, +2% = 2.357; sand 5.778 x 0.42 = 2.427 cum, +5% = 2.548; the plaster has no work item
  const ex0 = (await t.call(qs1, 'GET', `/takeoffs/${c.id}/explosion`)).json.data;
  assert.deepEqual(ex0.rows.map((r) => [r.description, r.net, r.qty, r.uom]), [['Cement OPC 53', '2.311', '2.357', 'MT'], ['Coarse sand', '2.427', '2.548', 'CUM']]);
  assert.deepEqual([ex0.stored, ex0.unexploded.map((u) => u.ref)], [false, ['A.1']]);
  const r0 = await released(t, qs1, '/takeoffs', c.id);
  assert.equal(r0.status, 'APPROVED');
  assert.equal((await t.call(qs1, 'GET', `/takeoffs/${c.id}/explosion`)).json.data.stored, true, 'the requirements of a released revision are stored');
  // R1 from drawing revision B: 8 beams instead of 6, the plaster dropped, skirting added; the delta against R0 (T-02)
  const r1 = (await t.call(qs1, 'POST', `/takeoffs/${c.id}/amend`, { reason: 'drawing revision B', drawingRev: 'B' })).json.data;
  const L1 = [L0[0], { ...L0[1], nos: '8' }, { boqItemRef: 'C.1', description: 'Skirting', template: 'RUNNING_LENGTH', length: '40' }];
  const v1 = (await t.call(qs1, 'PUT', `/takeoffs/${r1.id}/lines`, { lines: L1, version: r1.rowVersion })).json.data;
  const d = (await t.call(qs1, 'GET', `/takeoffs/${v1.id}/delta`)).json.data;
  const row = (ref) => d.rows.find((x) => x.ref === ref);
  assert.equal(d.base.id, c.id); assert.deepEqual(d.counts, { added: 1, removed: 1, changed: 1, same: 0 });
  // B.1: 1.728 + 8 x 0.675 = 7.128 (+1.350); A.1 -70.800; C.1 +40.000 RM
  assert.deepEqual([row('B.1').from, row('B.1').to, row('B.1').delta, row('A.1').change, row('A.1').delta, row('C.1').change, row('C.1').uom], ['5.778', '7.128', '1.350', 'REMOVED', '-70.800', 'ADDED', 'RM']);
  // FR-06 the released quantities into a draft estimate of the project: B.1 matched, C.1 not in the estimate
  const e = (await t.call(est1, 'POST', '/estimates', { projectId: t.project, basisDate: '2026-10-01' })).json.data;
  const ei = (await t.call(est1, 'PUT', `/estimates/${e.id}/items`, { items: [{ sectionCode: 'B', itemNo: 'B.1', description: 'RCC M25', uom: 'CUM', qty: '0', mode: 'RATE', costRate: '9000', markupPct: '10' }], version: e.rowVersion })).json.data;
  assert.equal((await t.call(est1, 'POST', `/takeoffs/${v1.id}/apply`, { estimateId: e.id })).status, 422, 'only a released take-off feeds an estimate');
  await released(t, qs1, '/takeoffs', v1.id);
  const ap = (await t.call(est1, 'POST', `/takeoffs/${v1.id}/apply`, { estimateId: ei.id })).json.data;
  assert.deepEqual([ap.matched.map((x) => [x.itemNo, x.to]), ap.unmatched], [[['B.1', '7.128']], ['C.1']]);
  assert.deepEqual([ap.estimate.items[0].qty, ap.estimate.items[0].amount], ['7.128', '70567.20'], '7.128 x 9900.00');
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'est.takeoff.released'").all().map((x) => JSON.parse(x.payload).data ?? JSON.parse(x.payload));
  assert.equal(ev.length, 2); assert.deepEqual(ev[1].delta, { added: 1, removed: 1, changed: 1, same: 0 }); assert.ok(ev[1].requirements.some((r) => r.description === 'Cement OPC 53' && r.qty === '2.908'), '7.128 x 0.4 = 2.851 MT + 2%');
  // FR-03 an engineering MTO: line items with specs, quantities as given, material items exploded as they are
  const en = (await t.call(qs1, 'POST', '/takeoffs', { kind: 'ENGINEERING', discipline: 'PIPING', title: 'Fire water ring main', projectId: t.project, drawingRef: 'PIP-FW-001' })).json.data;
  const enl = (await t.call(qs1, 'PUT', `/takeoffs/${en.id}/lines`, { lines: [{ boqItemRef: 'FW-01', description: 'MS pipe 100 NB, ERW', spec: 'IS 1239 heavy, black', template: 'DIRECT', materialItemId: t.it.pipe, quantity: '240.5', uom: 'RM' }], version: en.rowVersion })).json.data;
  assert.deepEqual([enl.lines[0].quantity, enl.lines[0].spec], ['240.5', 'IS 1239 heavy, black']);
  assert.deepEqual((await t.call(qs1, 'GET', `/takeoffs/${en.id}/explosion`)).json.data.rows.map((r) => [r.itemCode, r.qty]), [['MAT-PIP-7', '240.500']]);
  assert.equal((await t.call(qs1, 'GET', '/takeoff-templates')).json.data.length, 9);
});

test('roles, conflicts, replays and isolation: EST, QS and SE prepare, PM and DESIGN release, the director and commercial read; a project manager of another project sees nothing; another company; the flag', async () => {
  const t = await setup();
  const mk = (who, extra = {}) => t.call(who, 'POST', '/takeoffs', { title: 'Tower A footings', projectId: t.project, drawingRef: 'STR-A-101', ...extra });
  for (const who of [est1, qs1, se1]) assert.equal((await mk(who)).status, 201, `${who.roles} prepares`);
  for (const who of [pm1, des1, dir1, com1]) assert.equal((await mk(who)).status, 403, `${who.roles} does not prepare`);
  assert.equal((await t.call(bd1, 'GET', '/takeoffs')).status, 403);
  assert.equal((await t.call(dir1, 'GET', '/takeoffs')).status, 200);
  const x = (await mk(se1)).json.data;
  const y = (await t.call(se1, 'PUT', `/takeoffs/${x.id}/lines`, { lines: [{ boqItemRef: 'A.1', description: 'Footing F1', template: 'CONCRETE_VOLUME', nos: '6', length: '1.8', breadth: '1.8', height: '0.6' }], version: x.rowVersion })).json.data;
  assert.equal(y.lines[0].quantity, '11.664');
  assert.equal((await t.call(se1, 'PUT', `/takeoffs/${x.id}/lines`, { lines: [], version: x.rowVersion })).status, 409, 'a stale version');
  assert.equal((await t.call(qs1, 'PUT', `/takeoffs/${x.id}/lines`, { lines: [], version: y.rowVersion })).status, 403, 'another preparer makes a revision');
  assert.equal((await t.call(se1, 'POST', `/takeoffs/${x.id}/submit`, {})).status, 202);
  // a replayed submit answers the same
  const z = (await mk(est1)).json.data;
  await t.call(est1, 'PUT', `/takeoffs/${z.id}/lines`, { lines: [{ boqItemRef: 'A.2', description: 'Pedestal', template: 'COUNT', nos: '6' }], version: z.rowVersion });
  const k = key(); const s1 = await t.call(est1, 'POST', `/takeoffs/${z.id}/submit`, {}, k); const s2 = await t.call(est1, 'POST', `/takeoffs/${z.id}/submit`, {}, k);
  assert.deepEqual([s1.status, s2.status, s2.json.data.workflowInstanceId], [202, 202, s1.json.data.workflowInstanceId]);
  // a checker returns it; corrected and sent again; the design lead releases it
  await t.act(qs1, s1.json.data.workflowInstanceId, 'return');
  const ret = (await t.call(est1, 'GET', `/takeoffs/${z.id}`)).json.data; assert.equal(ret.status, 'RETURNED');
  await t.call(est1, 'PUT', `/takeoffs/${z.id}/lines`, { lines: [{ boqItemRef: 'A.2', description: 'Pedestal', template: 'COUNT', nos: '8' }], version: ret.rowVersion });
  assert.equal((await t.call(est1, 'POST', `/takeoffs/${z.id}/submit`, {})).status, 202);
  await t.act(des1, s1.json.data.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `/takeoffs/${z.id}`)).json.data.status, 'APPROVED');
  // isolation: a project manager assigned to the other project only
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'mpm2', 'mpm2', '[]', 'mpm2@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([t.other]));
  const s = mtoOf(t.api.db); const pm2 = { user: 'mpm2', userId: uid, companyId: 1, roles: [] };
  assert.ok(!s.takeoffs.list(pm2, {}).data.some((r) => r.id === z.id)); assert.throws(() => s.takeoffs.get(pm2, z.id), /does not exist/);
  const bb = (await t.call(qs1, 'POST', '/bbs', { title: 'Slab S1', projectId: t.project, drawingRef: 'STR-S-1', member: 'S1' })).json.data;
  assert.throws(() => s.bbs.get(pm2, bb.id), /does not exist/);
  assert.equal((await t.call(qs1, 'POST', '/bbs', { title: 'No project', drawingRef: 'X', member: 'S1' })).status, 400);
  assert.equal((await t.call(as('QS', 'mqs1', '2'), 'GET', `/takeoffs/${z.id}`)).status, 404, 'another company');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.est.p0902'").run();
  assert.equal((await t.call(qs1, 'GET', '/takeoffs')).status, 404, 'flag off');
  assert.equal((await t.call(qs1, 'GET', '/estimates')).status, 200, 'the estimates of 09.01 stay');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.est.p0902'").run();
  assert.equal((await t.api.call('GET', `${E}/takeoffs/${z.id}/print`, qs1)).status, 200);
});
