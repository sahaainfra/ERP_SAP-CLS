import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { structureOf, usageProviders } from '../src/server/modules/proj/structure.js';
import { WBS_TEMPLATES } from '../src/server/modules/proj/constants.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.03: the WBS, work packages and the location breakdown. T-01 a template makes the full tree (codes, levels, weights that sum to 100 % in every group) and the move of a node that is in use keeps every link; also: the codes, the weights and
// their normalising (BR-02), the node in use that is deactivated and not deleted (BR-01), copying another project, the baseline and the versions after it (a change request approved by planning, the project manager and the project controls manager;
// nothing changes the structure around it), work packages, the location tree with chainage rules, the WBS x location matrix, roles, project isolation, another company, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `st-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'splan1'); const plan2 = as('PLAN', 'splan2'); const pm1 = as('PM', 'spm1'); const pcm = as('PCMGR', 'spcm1'); const pcm2 = as('PCMGR', 'spcm2'); const se = as('SE', 'sse1'); const dir = as('DIR', 'sdir1'); const bd = as('BD', 'sbd1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['splan1', ['PLAN']], ['splan2', ['PLAN']], ['spm1', ['PM']], ['spm2', ['PM']], ['spcm1', ['PCMGR']], ['spcm2', ['PCMGR']], ['sse1', ['SE']], ['sdir1', ['DIR']], ['sbd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name, type = 'BUILDING') => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, type).lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (1, ?, 'test')").run(id); return id; };
  const a = mk('STA', 'Alpha towers'); const b = mk('STB', 'Beta mall'); const roadId = mk('STR', 'Ring road', 'ROAD');
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  return { api, call, act, hasTask, a, b, roadId };
}
const count = (db, sql, ...x) => db.prepare(sql).get(...x).n;
const countNodes = (list) => { let n = 0; const walk = (l) => { for (const x of l) { n += 1; if (x.children) walk(x.children); } }; walk(list); return n; };
const byCode = (tree, code) => tree.nodes.find((n) => n.code === code);

test('T-01 a template makes the full tree with codes and weights; moving a node that is in use keeps its links; a used node is deactivated, not deleted', async () => {
  const t = await setup(); const q = `?projectId=${t.a}`;
  assert.deepEqual((await t.call(plan1, 'GET', '/wbs-projects')).json.data.map((x) => x.code), ['STA', 'STB', 'STR']); assert.equal((await t.call(bd, 'GET', '/wbs-projects')).status, 403);
  // the view of an empty WBS
  const e = (await t.call(plan1, 'GET', `/wbs${q}`)).json.data; assert.deepEqual([e.nodes.length, e.baselined, e.can.template], [0, false, true]);
  assert.deepEqual(e.templates.map((x) => x.code).sort(), ['BRIDGE', 'BUILDING', 'INDUSTRIAL_PLANT', 'ROAD', 'WATER_PIPELINE']);
  // the template: the whole tree, codes 1, 1.1 ..., levels, weights summing to 100 % in every group, control accounts, disciplines
  const r = await t.call(plan1, 'POST', `/wbs/template${q}`, { template: 'BUILDING' }); assert.equal(r.status, 201, JSON.stringify(r.json));
  const want = countNodes(WBS_TEMPLATES.BUILDING.tree); assert.equal(r.json.data.created, want); const tr = r.json.data.tree;
  assert.equal(tr.nodes.length, want); assert.deepEqual(tr.validation.groups.filter((g) => !g.ok), [], 'every group sums to 100 %'); assert.equal(tr.validation.ok, true);
  assert.deepEqual([byCode(tr, '2').name, byCode(tr, '2').level, byCode(tr, '2.1').name, byCode(tr, '2.1').level, byCode(tr, '2.1').parentId, byCode(tr, '2').isControlAccount, byCode(tr, '2').discipline], ['Substructure', 1, 'Excavation and earthwork', 2, byCode(tr, '2').id, true, 'CIVIL']);
  assert.equal(byCode(tr, '2.1').discipline, 'CIVIL', 'a child takes the discipline of its parent');
  assert.equal(tr.nodes.filter((n) => n.parentId === byCode(tr, '2').id).reduce((s, n) => s + Number(n.weight), 0), 100);
  assert.equal((await t.call(plan1, 'POST', `/wbs/template${q}`, { template: 'ROAD' })).status, 409, 'not into a filled WBS');
  assert.equal((await t.call(plan1, 'POST', `/wbs/template${q}`, { template: 'NOPE' })).status, 400);
  // the work package and the matrix point at 2.1: its usage
  const wp = await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-EARTH', name: 'Earthwork by subcontract', type: 'SUBCONTRACT', wbsIds: [byCode(tr, '2.1').id, byCode(tr, '2.2').id] }); assert.equal(wp.status, 201, JSON.stringify(wp.json));
  assert.equal(byCode((await t.call(plan1, 'GET', `/wbs${q}`)).json.data, '2.1').usage, 1);
  // a later part registers its own usage: the BOQ of 10.04
  const onItem = new Set(); usageProviders.push((_db, c) => (onItem.has(c.wbsId) ? 3 : 0));
  onItem.add(byCode(tr, '2.3').id); assert.equal(byCode((await t.call(plan1, 'GET', `/wbs${q}`)).json.data, '2.3').usage, 3);
  // BR-01: a node in use is not deleted (409) but deactivated; one with nodes under it is not deleted at all
  const del = await t.call(plan1, 'DELETE', `/wbs/${byCode(tr, '2.3').id}${q}`); assert.equal(del.status, 409); assert.match(del.json.error.message, /deactivated, not deleted/);
  assert.equal((await t.call(plan1, 'DELETE', `/wbs/${byCode(tr, '2').id}${q}`)).status, 422);
  const dea = await t.call(plan1, 'POST', `/wbs/${byCode(tr, '2.3').id}/deactivate${q}`, {}); assert.equal(dea.status, 200); assert.equal(byCode(dea.json.data, '2.3').status, 'INACTIVE');
  assert.equal((await t.call(plan1, 'POST', `/wbs/${byCode(tr, '2.3').id}/activate${q}`, {})).status, 200);
  // T-01: the move of a node in use keeps its links (the links are by id) and its code; the levels of the subtree follow
  const two1 = byCode(tr, '2.1'); const fin = byCode(tr, '4');
  const mv = await t.call(plan1, 'POST', `/wbs/${two1.id}/move${q}`, { parentId: fin.id }); assert.equal(mv.status, 200, JSON.stringify(mv.json)); const after = mv.json.data;
  assert.deepEqual([byCode(after, '2.1').parentId, byCode(after, '2.1').level, byCode(after, '2.1').code, byCode(after, '2.1').usage], [fin.id, 2, '2.1', 1]);
  assert.deepEqual(JSON.parse(t.api.db.prepare('SELECT wbs_ids_json FROM proj_work_packages WHERE code = ?').get('WP-EARTH').wbs_ids_json), [two1.id, byCode(tr, '2.2').id], 'the work package still points at the node');
  const mv2 = (await t.call(plan1, 'POST', `/wbs/${byCode(tr, '2.3').id}/move${q}`, { parentId: fin.id })).json.data; assert.equal(byCode(mv2, '2.3').usage, 3, 'the usage of another part stays');
  // a node is not moved under itself or its descendants; the order is kept with beforeId
  assert.equal((await t.call(plan1, 'POST', `/wbs/${fin.id}/move${q}`, { parentId: two1.id })).status, 422);
  assert.equal((await t.call(plan1, 'POST', `/wbs/${byCode(tr, '1').id}/move${q}`, { parentId: byCode(tr, '1').id })).status, 422);
  const order = (await t.call(plan1, 'POST', `/wbs/${byCode(tr, '7').id}/move${q}`, { parentId: null, beforeId: byCode(tr, '1').id })).json.data; assert.deepEqual(order.nodes.filter((n) => n.parentId === null).slice(0, 2).map((n) => n.code), ['7', '1']);
  assert.deepEqual(count(t.api.db, "SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'proj.wbs.updated'") > 0, true);
  usageProviders.pop();
});

test('BR-02 weights sum to 100 % (validated, normalised); codes unique; fields validated; copy from another project; bulk edit; Excel export and import', async () => {
  const t = await setup(); const q = `?projectId=${t.a}`;
  const top = (await t.call(plan1, 'POST', `/wbs${q}`, { name: 'Civil works', weight: '60', discipline: 'CIVIL' })).json.data; assert.equal(top.code, '1');
  assert.equal((await t.call(plan1, 'POST', `/wbs${q}`, { name: 'Too much', weight: '50' })).status, 422, 'the weights of a group sum to 100 % at most');
  const two = (await t.call(plan1, 'POST', `/wbs${q}`, { name: 'MEP works', weight: '40' })).json.data; assert.equal(two.code, '2');
  const c1 = (await t.call(plan1, 'POST', `/wbs${q}`, { parentId: top.id, name: 'Foundations', weight: '30' })).json.data; assert.equal(c1.code, '1.1'); assert.equal(c1.level, 2);
  assert.equal((await t.call(plan1, 'POST', `/wbs${q}`, { parentId: top.id, code: '1.1', name: 'Dup' })).status, 400, 'codes are unique within the project');
  assert.equal((await t.call(plan1, 'POST', `/wbs${q}`, { parentId: top.id, code: 'bad code!', name: 'x' })).status, 400);
  assert.equal((await t.call(plan1, 'POST', `/wbs${q}`, { parentId: top.id, name: 'x', responsibleUser: 'nobody' })).status, 400);
  assert.equal((await t.call(plan1, 'POST', `/wbs${q}`, { parentId: top.id, name: 'x', discipline: 'MAGIC' })).status, 400);
  assert.equal((await t.call(plan1, 'POST', `/wbs${q}`, { parentId: top.id, code: 'MANUAL-1', name: 'Typed code', weight: '30' })).json.data.code, 'MANUAL-1');
  // a code may repeat in another project
  assert.equal((await t.call(plan1, 'POST', `/wbs?projectId=${t.b}`, { name: 'Other', code: '1' })).status, 201);
  // validation: 1.x sums to 60 %
  const v = (await t.call(plan1, 'GET', `/wbs/validate${q}`)).json.data; assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /Under 1 /.test(p.message) && /60/.test(p.message)));
  assert.equal((await t.call(pcm, 'POST', `/wbs/baseline${q}`, {})).status, 422, 'not baselined while a group does not sum to 100 %');
  const n = (await t.call(plan1, 'POST', `/wbs/normalise${q}`, {})).json.data; assert.equal(n.validation.ok, true, JSON.stringify(n.validation.problems));
  assert.equal(n.nodes.filter((x) => x.parentId === top.id).reduce((s, x) => s + Number(x.weight), 0), 100); assert.deepEqual(n.nodes.filter((x) => x.parentId === null).map((x) => x.weight), ['60', '40'], 'proportions kept at the top');
  assert.deepEqual(n.nodes.filter((x) => x.parentId === top.id).map((x) => x.weight), ['50', '50'], 'the children 30 and 30 became 50 and 50');
  // the odd case: three equal shares leave a remainder to the first
  for (const nm of ['a', 'b', 'c']) await t.call(plan1, 'POST', `/wbs${q}`, { parentId: two.id, name: nm });
  const n3 = (await t.call(plan1, 'POST', `/wbs/normalise${q}`, { parentId: two.id })).json.data; assert.deepEqual(n3.nodes.filter((x) => x.parentId === two.id).map((x) => x.weight), ['33.3334', '33.3333', '33.3333']);
  // update with a stale version; the discipline and responsible person; bulk edit
  const up = await t.call(plan1, 'PATCH', `/wbs/${top.id}${q}`, { responsibleUser: 'spm1', discipline: 'STRUCTURAL', version: n.nodes.find((x) => x.id === top.id).rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.responsibleUser, 'spm1');
  assert.equal((await t.call(plan1, 'PATCH', `/wbs/${top.id}${q}`, { name: 'Stale', version: 1 })).status, 409);
  const kids = n3.nodes.filter((x) => x.parentId === two.id).map((x) => x.id);
  const bk = (await t.call(plan1, 'POST', `/wbs/bulk${q}`, { ids: kids, set: { discipline: 'MEP', responsibleUser: 'splan2', isControlAccount: true } })).json.data; assert.deepEqual(bk.nodes.filter((x) => kids.includes(x.id)).map((x) => [x.discipline, x.responsibleUser, x.isControlAccount]), kids.map(() => ['MEP', 'splan2', true]));
  assert.equal((await t.call(plan1, 'POST', `/wbs/bulk${q}`, { ids: [999999], set: { discipline: 'MEP' } })).status, 404);
  // copy into an empty WBS of another project, with the work packages and locations
  await t.call(plan1, 'POST', `/locations${q}`, { type: 'BUILDING', code: 'TW-A', name: 'Tower A' });
  const wp = await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-1', name: 'Foundations', type: 'SELF', wbsIds: [c1.id] }); assert.equal(wp.status, 201);
  assert.equal((await t.call(plan1, 'POST', `/wbs/copy?projectId=${t.b}`, { sourceProjectId: t.a })).status, 409, 'not into a filled WBS');
  const cp = await t.call(plan1, 'POST', `/wbs/copy?projectId=${t.roadId}`, { sourceProjectId: t.a, includeLocations: true, includeWorkPackages: true }); assert.equal(cp.status, 201, JSON.stringify(cp.json));
  assert.deepEqual([cp.json.data.created, cp.json.data.locations, cp.json.data.workPackages], [n3.nodes.length, 1, 1]); assert.equal(cp.json.data.tree.validation.ok, true);
  const copied = JSON.parse(t.api.db.prepare("SELECT wbs_ids_json FROM proj_work_packages WHERE project_id = ? AND code = 'WP-1'").get(t.roadId).wbs_ids_json); assert.equal(copied.length, 1); assert.equal(t.api.db.prepare('SELECT project_id FROM proj_wbs WHERE id = ?').get(copied[0]).project_id, t.roadId, 'the copy points at its own nodes');
  assert.equal((await t.call(plan1, 'POST', `/wbs/copy?projectId=${t.roadId}`, { sourceProjectId: t.roadId })).status, 422);
  // the export
  assert.equal((await t.api.call('GET', `${P}/wbs/export?projectId=${t.a}&format=xlsx`, plan1)).status, 200); assert.equal((await t.api.call('GET', `${P}/wbs/export?projectId=${t.a}&format=csv`, plan1)).status, 200); assert.equal((await t.api.call('GET', `${P}/wbs/export?projectId=${t.a}&format=csv`, se)).status, 403);
  // the import rows (the engine of 04.13 calls the same service): parents before children; refused after the baseline
  const s = structureOf(t.api.db); const actor = { user: 'splan1', userId: null, companyId: 1, roles: ['PLAN'] };
  const imp = s.wbs.importRow(actor, { projectCode: 'STB', row: { code: '9', name: 'Imported root', weight: '100' } }); assert.equal(imp.ref, 'STB 9');
  assert.throws(() => s.wbs.importRow(actor, { projectCode: 'STB', row: { code: '9.1', parentCode: 'NOPE', name: 'x' } }), /not in the project/);
  assert.equal(s.wbs.importRow(actor, { projectCode: 'STB', row: { code: '9.1', parentCode: '9', name: 'Imported child', weight: '100' } }).ref, 'STB 9.1');
  assert.throws(() => s.wbs.importRow({ user: 'sse1', userId: null, companyId: 1, roles: ['SE'] }, { projectCode: 'STB', row: { code: '9.2', name: 'x' } }), /permission/);
});

test('FR-07 the baseline locks the structure; every change is a request approved by planning, the project manager and the project controls manager, kept as a version with its diff', async () => {
  const t = await setup(); const q = `?projectId=${t.a}`;
  await t.call(plan1, 'POST', `/wbs/template${q}`, { template: 'BUILDING' });
  assert.equal((await t.call(plan1, 'POST', `/wbs/baseline${q}`, {})).status, 403, 'planning does not baseline'); assert.equal((await t.call(se, 'POST', `/wbs/baseline${q}`, {})).status, 403);
  const bl = await t.call(pm1, 'POST', `/wbs/baseline${q}`, { reason: 'Baseline agreed with the client' }); assert.equal(bl.status, 201, JSON.stringify(bl.json)); const tr = bl.json.data;
  assert.deepEqual([tr.baselined, tr.versionNo, tr.can.manage, tr.can.change], [true, 1, false, true]); assert.equal((await t.call(pm1, 'POST', `/wbs/baseline${q}`, {})).status, 409);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.wbs.baselined'").get());
  const v1 = (await t.call(se, 'GET', `/wbs-versions${q}`)).json.data; assert.deepEqual(v1.map((x) => [x.versionNo, x.kind, x.status]), [[1, 'BASELINE', 'APPROVED']]); assert.equal((await t.call(se, 'GET', `/wbs-versions/${v1[0].id}${q}`)).json.data.snapshot.length, tr.nodes.length);
  // after the baseline the structure is locked against every direct path
  const n21 = byCode(tr, '2.1');
  for (const [m, p, b] of [['POST', `/wbs${q}`, { name: 'New' }], ['POST', `/wbs/${n21.id}/move${q}`, { parentId: null }], ['DELETE', `/wbs/${n21.id}${q}`, undefined], ['POST', `/wbs/${n21.id}/deactivate${q}`, {}], ['POST', `/wbs/normalise${q}`, {}], ['POST', `/wbs/template${q}`, { template: 'ROAD' }], ['PATCH', `/wbs/${n21.id}${q}`, { weight: '10' }], ['PATCH', `/wbs/${n21.id}${q}`, { code: 'Z9' }], ['POST', `/wbs/bulk${q}`, { ids: [n21.id], set: { isControlAccount: true } }]]) {
    const r = await t.call(plan1, m, p, b); assert.equal(r.status, 409, `${m} ${p}: ${JSON.stringify(r.json)}`); assert.equal(r.json.error.code, 'WBS_BASELINED');
  }
  assert.throws(() => structureOf(t.api.db).wbs.importRow({ user: 'splan1', userId: null, companyId: 1, roles: ['PLAN'] }, { projectCode: 'STA', row: { code: '99', name: 'Imported after the baseline' } }), /baselined/);
  // what stays direct: the name, the discipline, the responsible person
  assert.equal((await t.call(plan1, 'PATCH', `/wbs/${n21.id}${q}`, { name: 'Excavation and earth moving', responsibleUser: 'spm1' })).status, 200);
  // a change request: a dry run refuses what would leave the WBS invalid and what changes nothing
  const bad = await t.call(plan1, 'POST', `/wbs-changes${q}`, { reason: 'Add a node without weights', ops: [{ op: 'add', parentId: byCode(tr, '2').id, name: 'Piling', weight: '10' }] }); assert.equal(bad.status, 422, JSON.stringify(bad.json)); assert.ok(bad.json.error.details.some((d) => /sum to/.test(d.message)));
  assert.equal((await t.call(plan1, 'POST', `/wbs-changes${q}`, { reason: 'Nothing at all really', ops: [{ op: 'update', id: n21.id, fields: { name: 'Excavation and earth moving' } }] })).status, 422);
  assert.equal((await t.call(se, 'POST', `/wbs-changes${q}`, { reason: 'Not allowed to ask', ops: [{ op: 'deactivate', id: n21.id }] })).status, 403);
  const ch = await t.call(plan1, 'POST', `/wbs-changes${q}`, { reason: 'Piling added to the substructure, weights re-shared', ops: [
    { op: 'add', code: 'PILING', parentId: byCode(tr, '2').id, name: 'Piling', weight: '20' },
    { op: 'weights', weights: [{ id: byCode(tr, '2.1').id, weight: '30' }, { id: byCode(tr, '2.2').id, weight: '30' }, { id: byCode(tr, '2.3').id, weight: '20' }] },
    { op: 'move', id: byCode(tr, '6').id, parentId: byCode(tr, '2').id }, { op: 'update', id: byCode(tr, '6').id, fields: { weight: '0' } },
  ] }); assert.equal(ch.status, 422, 'moving node 6 under 2 pushes the weights over 100 % and leaves 6 outside its group: refused');
  const ok = await t.call(plan1, 'POST', `/wbs-changes${q}`, { reason: 'Piling added to the substructure, weights re-shared', ops: [
    { op: 'add', code: 'PILING', parentId: byCode(tr, '2').id, name: 'Piling', weight: '20' },
    { op: 'weights', weights: [{ id: byCode(tr, '2.1').id, weight: '30' }, { id: byCode(tr, '2.2').id, weight: '30' }, { id: byCode(tr, '2.3').id, weight: '20' }] },
  ] }); assert.equal(ok.status, 201, JSON.stringify(ok.json)); const cr = ok.json.data;
  assert.deepEqual([cr.status, cr.versionNo, cr.diff.map((d) => `${d.kind}:${d.code}`).sort()], ['DRAFT', 2, ['ADDED:PILING', 'CHANGED:2.1', 'CHANGED:2.2', 'CHANGED:2.3'].sort()].map((x) => x));
  assert.equal(byCode((await t.call(plan1, 'GET', `/wbs${q}`)).json.data, 'PILING'), undefined, 'a dry run changes nothing');
  assert.equal((await t.call(plan1, 'POST', `/wbs-changes${q}`, { reason: 'A second change at the same time', ops: [{ op: 'deactivate', id: n21.id }] })).status, 409, 'one open change per project');
  // sent: the chain planning (another person), the project manager, the project controls manager; the sender never signs
  const sub = await t.call(plan1, 'POST', `/wbs-changes/${cr.id}/submit${q}`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(plan1, inst), false, 'the sender does not sign'); assert.equal(await t.hasTask(pm1, inst), false, 'the project manager waits for planning'); assert.equal((await t.call(plan1, 'PATCH', `/wbs/${n21.id}${q}`, { weight: '5' })).status, 409);
  await t.act(plan2, inst); await t.act(pm1, inst); assert.equal(await t.hasTask(pcm, inst), true);
  assert.equal(byCode((await t.call(plan1, 'GET', `/wbs${q}`)).json.data, 'PILING'), undefined, 'nothing changes until the last approval');
  await t.act(pcm, inst);
  const after = (await t.call(plan1, 'GET', `/wbs${q}`)).json.data; assert.deepEqual([after.versionNo, byCode(after, 'PILING').name, byCode(after, '2.1').weight, byCode(after, 'PILING').weight, after.validation.ok], [2, 'Piling', '30', '20', true]);
  const vs = (await t.call(se, 'GET', `/wbs-versions${q}`)).json.data; assert.deepEqual(vs.map((x) => [x.versionNo, x.status]), [[2, 'APPROVED'], [1, 'APPROVED']]);
  const v2 = (await t.call(se, 'GET', `/wbs-versions/${vs[0].id}${q}`)).json.data; assert.equal(v2.reason, 'Piling added to the substructure, weights re-shared'); assert.equal(v2.diff.length, 4); assert.equal(v2.snapshot.find((x) => x.code === 'PILING').name, 'Piling');
  const evd = JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'proj.wbs.changed'").get().payload); assert.equal((evd.data ?? evd).versionNo, 2);
  assert.ok((await t.call(pm1, 'GET', `/wbs-changes/${cr.id}/history${q}`)).json.data.approvals.length >= 3);
  // return and resubmit; reject; withdraw; cancel
  const c2 = (await t.call(plan1, 'POST', `/wbs-changes${q}`, { reason: 'Retire the external works node', ops: [{ op: 'deactivate', id: byCode(tr, '6').id }, { op: 'weights', weights: [{ id: byCode(tr, '1').id, weight: '20' }, { id: byCode(tr, '2').id, weight: '20' }, { id: byCode(tr, '3').id, weight: '15' }, { id: byCode(tr, '4').id, weight: '25' }, { id: byCode(tr, '5').id, weight: '10' }, { id: byCode(tr, '7').id, weight: '10' }] }] })).json.data;
  assert.ok(c2.id, JSON.stringify(c2));
  const s2 = await t.call(plan1, 'POST', `/wbs-changes/${c2.id}/submit${q}`, {}); const i2 = s2.json.data.workflowInstanceId; await t.act(plan2, i2, 'return');
  assert.equal((await t.call(plan1, 'GET', `/wbs-changes/${c2.id}${q}`)).json.data.status, 'RETURNED');
  const s3 = await t.call(plan1, 'POST', `/wbs-changes/${c2.id}/submit${q}`, {}); assert.equal(s3.status, 202, JSON.stringify(s3.json)); await t.act(plan2, i2, 'reject');
  assert.equal((await t.call(plan1, 'GET', `/wbs-changes/${c2.id}${q}`)).json.data.status, 'REJECTED'); assert.equal(byCode((await t.call(plan1, 'GET', `/wbs${q}`)).json.data, '6').status, 'ACTIVE');
  const c3 = (await t.call(plan1, 'POST', `/wbs-changes${q}`, { reason: 'Try again with a different note', ops: [{ op: 'update', id: byCode(tr, '6').id, fields: { isControlAccount: false } }] })).json.data;
  const s4 = await t.call(plan1, 'POST', `/wbs-changes/${c3.id}/submit${q}`, {}); const w = await t.call(plan1, 'POST', `/wbs-changes/${c3.id}/withdraw${q}`, { reason: 'wrong node picked' }); assert.equal(w.status, 200, JSON.stringify(w.json)); assert.equal(w.json.data.status, 'DRAFT'); assert.ok(s4.json.data.workflowInstanceId);
  assert.equal((await t.call(plan1, 'POST', `/wbs-changes/${c3.id}/cancel${q}`, { reason: 'not needed after all' })).json.data.status, 'CANCELLED');
  const loc = (await t.call(pm1, 'GET', `/wbs-changes/${c3.id}/locate`)).json.data; assert.equal(loc.projectId, t.a);
});

test('FR-03 to FR-05 work packages, the location tree (building or chainage), the matrix; roles, project isolation, another company, the flag', async () => {
  const t = await setup(); const q = `?projectId=${t.a}`; const rq = `?projectId=${t.roadId}`;
  const tr = (await t.call(plan1, 'POST', `/wbs/template${q}`, { template: 'BUILDING' })).json.data.tree;
  // work packages: types, the same node not twice in a type, a node of another project, inactive nodes, an owner who is not a user
  const w1 = await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-SUB1', name: 'Finishes by subcontract', type: 'SUBCONTRACT', ownerUser: 'spm1', wbsIds: [byCode(tr, '4.1').id, byCode(tr, '4.2').id] }); assert.equal(w1.status, 201, JSON.stringify(w1.json)); assert.equal(w1.json.data.nodes.length, 2);
  assert.equal((await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-SUB2', name: 'Overlap', type: 'SUBCONTRACT', wbsIds: [byCode(tr, '4.2').id] })).status, 400, 'a node is in one work package of a type');
  assert.equal((await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-PRO1', name: 'Tiles procurement', type: 'PROCUREMENT', wbsIds: [byCode(tr, '4.2').id] })).status, 201, 'but in one of each type');
  assert.equal((await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-SUB1', name: 'Dup', type: 'SELF' })).status, 400, 'codes are unique');
  assert.equal((await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-X', name: 'Elsewhere', type: 'SELF', wbsIds: [999999] })).status, 400);
  assert.equal((await t.call(plan1, 'POST', '/work-packages', { projectId: t.a, code: 'WP-Y', name: 'Owner', type: 'SELF', ownerUser: 'ghost' })).status, 400);
  const up = await t.call(plan1, 'PATCH', `/work-packages/${w1.json.data.id}`, { name: 'Finishes and flooring by subcontract', wbsIds: [byCode(tr, '4.1').id, byCode(tr, '4.2').id, byCode(tr, '4.3').id], version: w1.json.data.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.nodes.length, 3);
  assert.equal((await t.call(plan1, 'PATCH', `/work-packages/${w1.json.data.id}`, { name: 'Stale', version: w1.json.data.rowVersion })).status, 409);
  const cl = await t.call(plan1, 'PATCH', `/work-packages/${w1.json.data.id}`, { status: 'CLOSED' }); assert.equal(cl.json.data.status, 'CLOSED'); assert.equal((await t.call(plan1, 'PATCH', `/work-packages/${w1.json.data.id}`, { name: 'Changed after close' })).status, 409);
  const list = (await t.call(se, 'GET', '/work-packages')).json; assert.equal(list.data.length, 2); assert.equal(list.data[0].projectCode, 'STA');
  assert.equal((await t.call(plan1, 'DELETE', `/work-packages/${list.data.find((x) => x.code === 'WP-PRO1').id}`)).status, 200);
  assert.equal((await t.api.call('GET', `${P}/work-packages/export?format=csv`, plan1)).status, 200); assert.equal((await t.api.call('GET', `${P}/work-packages/export?format=csv`, bd)).status, 403);
  // the location tree of a building
  const L = (b, p = q) => t.call(plan1, 'POST', `/locations${p}`, b);
  const blk = (await L({ type: 'BUILDING', code: 'TW-A', name: 'Tower A', lat: 18.52, lng: 73.85 })).json.data; const fl = (await L({ parentId: blk.id, type: 'FLOOR', code: 'TW-A-F1', name: 'First floor' })).json.data; const z1 = (await L({ parentId: fl.id, type: 'ZONE', code: 'TW-A-F1-Z1', name: 'Flat 101' })).json.data; const rm = (await L({ parentId: z1.id, type: 'ROOM', code: 'TW-A-F1-Z1-R1', name: 'Living room' })).json.data;
  const z2 = (await L({ parentId: fl.id, type: 'ZONE', code: 'TW-A-F1-Z2', name: 'Flat 102' })).json.data;
  assert.equal((await L({ parentId: blk.id, type: 'ROOM', code: 'BAD1', name: 'A room under a building' })).status, 400); assert.equal((await L({ type: 'FLOOR', code: 'BAD2', name: 'A floor at the top' })).status, 400);
  assert.equal((await L({ type: 'BUILDING', code: 'TW-B', name: 'Tower B', lat: 18.5 })).status, 400, 'both the latitude and the longitude'); assert.equal((await L({ type: 'BUILDING', code: 'TW-A', name: 'Dup' })).status, 400);
  assert.equal((await L({ type: 'BUILDING', code: 'TW-C', name: 'Tower C', chainageFrom: 0, chainageTo: 100 })).status, 400, 'a building has no chainage');
  // the matrix: the lowest nodes and locations only; the usage of a location
  const m = (await t.call(se, 'GET', `/wbs-matrix${q}`)).json.data; assert.ok(m.rows.every((r) => !tr.nodes.some((n) => n.parentId === r.id))); assert.deepEqual(m.columns.map((c) => c.code).sort(), ['TW-A-F1-Z1-R1', 'TW-A-F1-Z2']);
  assert.equal((await t.call(plan1, 'PUT', `/wbs-matrix${q}`, { cells: [{ wbsId: byCode(tr, '2').id, locationId: rm.id, on: true }] })).status, 422, 'a parent node is not in the matrix'); assert.equal((await t.call(plan1, 'PUT', `/wbs-matrix${q}`, { cells: [{ wbsId: byCode(tr, '2.1').id, locationId: fl.id, on: true }] })).status, 422);
  const set = await t.call(plan1, 'PUT', `/wbs-matrix${q}`, { cells: [{ wbsId: byCode(tr, '2.1').id, locationId: rm.id, on: true }, { wbsId: byCode(tr, '2.1').id, locationId: z2.id, on: true }, { wbsId: byCode(tr, '4.1').id, locationId: rm.id, on: true }] }); assert.equal(set.status, 200, JSON.stringify(set.json)); assert.equal(set.json.data.cells.length, 3);
  assert.equal(JSON.stringify((await t.call(plan1, 'PUT', `/wbs-matrix${q}`, { cells: [{ wbsId: byCode(tr, '4.1').id, locationId: rm.id, on: false }] })).json.data.cells.length), '2');
  assert.equal((await t.call(se, 'PUT', `/wbs-matrix${q}`, { cells: [{ wbsId: byCode(tr, '2.1').id, locationId: rm.id, on: true }] })).status, 403);
  const dl = await t.call(plan1, 'DELETE', `/locations/${rm.id}${q}`); assert.equal(dl.status, 409, 'a location in the matrix is deactivated, not deleted'); assert.equal((await t.call(plan1, 'DELETE', `/locations/${fl.id}${q}`)).status, 422);
  assert.equal((await t.call(plan1, 'POST', `/locations/${rm.id}/deactivate${q}`, {})).status, 200);
  // moving a location keeps its ids (and so the matrix); a move into itself is refused
  const mvz = await t.call(plan1, 'POST', `/locations/${z2.id}/move${q}`, { parentId: blk.id }); assert.equal(mvz.status, 200, JSON.stringify(mvz.json)); assert.equal(count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_wbs_locations WHERE location_id = ?', z2.id), 1);
  assert.equal((await t.call(plan1, 'POST', `/locations/${blk.id}/move${q}`, { parentId: fl.id })).status, 422);
  // a linear project: chainage segments (no overlap), structures inside a segment, map reference
  const seg1 = (await L({ type: 'CHAINAGE', code: 'CH-0-5', name: 'km 0 to 5', chainageFrom: 0, chainageTo: 5000 }, rq)); assert.equal(seg1.status, 201, JSON.stringify(seg1.json)); const s1 = seg1.json.data;
  assert.equal((await L({ type: 'CHAINAGE', code: 'CH-4-8', name: 'overlap', chainageFrom: 4000, chainageTo: 8000 }, rq)).status, 400, 'segments do not overlap'); assert.equal((await L({ type: 'CHAINAGE', code: 'CH-5-9', name: 'km 5 to 9', chainageFrom: 5000, chainageTo: 9000 }, rq)).status, 201);
  assert.equal((await L({ type: 'CHAINAGE', code: 'CH-BAD', name: 'backwards', chainageFrom: 10000, chainageTo: 9500 }, rq)).status, 400); assert.equal((await L({ type: 'CHAINAGE', code: 'CH-NONE', name: 'no end', chainageFrom: 10000 }, rq)).status, 400);
  const cul = await L({ parentId: s1.id, type: 'STRUCTURE', code: 'CUL-2', name: 'Culvert at km 2.4', chainageFrom: 2400, lat: 18.6, lng: 73.9 }, rq); assert.equal(cul.status, 201, JSON.stringify(cul.json)); assert.equal(cul.json.data.chainageTo, 2400);
  assert.equal((await L({ parentId: s1.id, type: 'STRUCTURE', code: 'CUL-9', name: 'Outside the segment', chainageFrom: 7000 }, rq)).status, 400);
  const lt = (await t.call(se, 'GET', `/locations${rq}`)).json.data; assert.equal(lt.linear, true); assert.deepEqual(lt.nodes.filter((x) => x.parentId === null).map((x) => x.code), ['CH-0-5', 'CH-5-9']);
  assert.equal((await t.call(plan1, 'PATCH', `/locations/${s1.id}${rq}`, { chainageTo: 2000 })).status, 400, 'a segment is not shrunk below the structure inside it');

  // roles and isolation: a director and an engineer read; a business developer sees nothing; a project manager assigned to another project only, another company, the flag
  assert.equal((await t.call(dir, 'GET', `/wbs${q}`)).status, 200); assert.equal((await t.call(se, 'POST', `/wbs${q}`, { name: 'x' })).status, 403); assert.equal((await t.call(bd, 'GET', `/wbs${q}`)).status, 403); assert.equal((await t.call(pm1, 'POST', `/locations${q}`, { type: 'BUILDING', code: 'PM-X', name: 'x' })).status, 403);
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'spm3', 'spm3', '[]', 'spm3@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([t.b]));
  const pm3 = { user: 'spm3', userId: uid, companyId: 1, roles: [] }; const s = structureOf(t.api.db);
  assert.throws(() => s.wbs.tree(pm3, t.a), /does not exist/); assert.doesNotThrow(() => s.wbs.tree(pm3, t.b)); assert.ok(!s.packages.list(pm3, {}).data.some((x) => x.projectId === t.a)); assert.throws(() => s.locations.tree(pm3, t.a), /does not exist/);
  assert.equal((await t.call(as('PLAN', 'splan1', '2'), 'GET', `/wbs${q}`)).status, 404, 'another company'); assert.equal((await t.call(pcm2, 'GET', '/work-packages')).status, 200);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1003'").run(); assert.equal((await t.call(plan1, 'GET', `/wbs${q}`)).status, 404, 'flag off'); assert.equal((await t.call(pcm, 'GET', '/projects')).status, 200, 'the project master is unaffected');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1003'").run();
});
