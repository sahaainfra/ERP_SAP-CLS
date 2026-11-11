import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';
import { netWeeks } from '../src/server/modules/proc/mrp.js';

// Part 15.02: material demand planning and MRP.
// T-01 netting with stock, an open PO, safety stock, the minimum order and the pack size reproduces the proposal (pure function, then through the whole chain: schedule, BOQ norms, stock, orders, parameters).
// Worked example: 840 bags of cement (100 units x 8 bags x 1.05) are needed over the two weeks from next Monday, 420 a week; free stock 200, an open PO of 100 arrives in the second week, safety stock 50, minimum order 100, packs of 50:
//   week 1: 420 + 50 - 200 = 270 short, rounded up to packs of 50: 300, ending with 80; week 2: 420 + 50 - (80 + 100) = 290 short: 300, ending with 60.
const P = '/api/v1/proc'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `mrp-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan = as('PLAN', 'mplan1'); const ic = as('PROCIC', 'mic1'); const mgr = as('PROCMGR', 'mmgr1'); const pm = as('PM', 'mpm1'); const se = as('SE', 'mse1'); const pcm = as('PCMGR', 'mpcm1'); const sys = as('SYSADM', 'msys1'); const other = as('PLAN', 'mplanx', '2'); const pd = as('PD', 'mpd1');
const TODAY = todayIST(); const monday = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return isoOf(ordOf(iso) - ((d.getUTCDay() + 6) % 7)); }; const NEXT = isoOf(ordOf(monday(TODAY)) + 7); const day = (iso, n) => isoOf(ordOf(iso) + n);

test('T-01 FR-02 the netting reproduces the worked example: stock, an open order, safety stock, the minimum order and whole packs', () => {
  const r = netWeeks({ gross: [0, 420, 420, 0], receipts: [0, 0, 100, 0], freeStock: 200, safety: 50, moq: 100, pack: 50 });
  assert.deepEqual(r.map((x) => [x.gross, x.available, x.net, x.proposed, x.end]), [[0, 200, 0, 0, 200], [420, 200, 270, 300, 80], [420, 180, 290, 300, 60], [0, 60, 0, 0, 60]]);
  assert.equal(netWeeks({ gross: [10], freeStock: 0, safety: 0, moq: 100, pack: 0 })[0].proposed, 100, 'the minimum order lifts a small need'); assert.equal(netWeeks({ gross: [10], freeStock: 50, safety: 0 })[0].proposed, 0, 'stock covers it'); assert.equal(netWeeks({ gross: [0], freeStock: 20, safety: 50, pack: 10 })[0].proposed, 30, 'the safety stock is restored');
});

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['mplan1', ['PLAN']], ['mic1', ['PROCIC']], ['mmgr1', ['PROCMGR']], ['mmgr2', ['PROCMGR']], ['mpm1', ['PM']], ['mse1', ['SE']], ['mpcm1', ['PCMGR']], ['msys1', ['SYSADM']], ['mpd1', ['PD']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'MRP1', 'MRP tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid); d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'mpm1', 'test')").run(pid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'MRP2', 'MRP other', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const s1 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'M-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'MR', 'MRP test', 'MRT', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, uom, last = 38000) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (1, ?, ?, 'MATERIAL', ?, ?, '2026-01-01', 'ACTIVE', ?)").run(code, name, cat, uom, last).lastInsertRowid);
  const cement = item('CEM-53', 'Cement OPC 53', 'bag'); const cement43 = item('CEM-43', 'Cement OPC 43', 'bag'); const steel = item('STL-12', 'TMT 12 mm', 'kg', 6500);
  d.prepare('INSERT INTO mdm_item_alternates (company_id, item_id, alternate_item_id, created_by) VALUES (1, ?, ?, ?)').run(cement, cement43, 'test');
  // the BOQ line: 100 units, 8 bags of cement a unit with 5 % wastage, 40 kg of steel a unit
  const ver = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (1, 'BQ/M', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 'test')").run(pid).lastInsertRowid);
  const line = Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, created_by) VALUES (1, ?, 'ITEM', '1.1', 'Concrete', 'cum', 100000, 0, 0, 'test')").run(ver).lastInsertRowid);
  d.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (1, ?, ?, 'MATERIAL', 'Cement', 'bag', 8000, 50000, 'test')").run(line, cement); d.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (1, ?, ?, 'MATERIAL', 'Steel', 'kg', 40000, 0, 'test')").run(line, steel);
  const pcall = (who, method, path, body) => api.call(method, `/api/v1/plan${path}`, { ...who, headers: key(), body });
  const cal = await pcall(plan, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const sch = await pcall(plan, 'POST', '/schedules', { projectId: pid, name: 'Schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' }); assert.equal((await pcall(plan, 'POST', `/schedules/${sch.json.data.id}/import`, { rows: [{ code: 'A10', name: 'Slab concrete', duration: 14 }] })).status, 201);
  const act = d.prepare('SELECT id FROM plan_activities WHERE schedule_id = ?').get(sch.json.data.id).id; d.prepare('UPDATE plan_activities SET es = ?, ef = ?, qty = 100000, uom = ? WHERE id = ?').run(NEXT, day(NEXT, 13), 'cum', act); d.prepare("UPDATE plan_schedules SET status = 'APPROVED' WHERE id = ?").run(sch.json.data.id);
  d.prepare('INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty, created_by) VALUES (1, ?, ?, 100000, ?)').run(act, line, 'test');
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act_ = async (who, instanceId, action = 'approve') => { const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); };
  const stock = (levels) => call(sys, 'POST', '/stock/ingest', { levels }); const supply = (supplies) => call(sys, 'POST', '/supply/ingest', { supplies });
  /** An approved parameter row: proposed by one person, approved by the procurement manager. */
  const params = async (body) => { const c = await call(ic, 'POST', '/item-params', body); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await call(ic, 'POST', `/item-params/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await act_(mgr, s.json.data.workflowInstanceId)).status, 200); return c.json.data; };
  const run = async (who = plan, over = {}) => { const c = await call(who, 'POST', '/runs', { projectId: pid, horizonWeeks: 6, bufferDays: 3, ...over }); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await call(who, 'POST', `/runs/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); return s.json.data; };
  return { api, d, pid, pid2, s1, cement, cement43, steel, call, act: act_, stock, supply, params, run, line, actId: act, sch: sch.json.data.id };
}
const setup = async () => { const r = await ready(); await r.stock([{ itemId: r.cement, storeCode: 'S1ST', storeName: 'Tower store', kind: 'SITE', siteId: r.s1, freeQty: 200 }]); assert.equal((await r.supply([{ projectId: r.pid, itemId: r.cement, kind: 'PO', docRef: 'PO/1', balanceQty: 100, expectedOn: day(NEXT, 7) }])).status, 201);
  await r.params({ itemId: r.cement, leadTimeDays: 14, moq: 100, packSize: 50, safetyStock: 50, effectiveFrom: '2026-01-01' }); return r; };

test('T-01 FR-01 FR-02 FR-03 an MRP run phases the requirement by the schedule, nets it against stock, orders and requisitions, and proposes to the minimum order and the pack with its dates', async () => {
  const r = await setup(); const res = await r.run(); const cem = res.lines.filter((l) => l.itemCode === 'CEM-53');
  assert.deepEqual(res.warnings, []); assert.deepEqual([res.status, res.itemCount, res.proposalCount], ['COMPLETED', 2, 4]);
  const w = (iso) => cem.find((l) => l.weekStart === iso); assert.equal(w(monday(TODAY)).grossReq, 0);
  assert.deepEqual([w(NEXT).grossReq, w(NEXT).freeStock, w(NEXT).netReq, w(NEXT).proposedQty, w(NEXT).projectedEnd], [420, 0, 270, 300, 80], 'week 1: 420 + 50 - 200 = 270, in packs of 50: 300');
  const w2 = w(day(NEXT, 7)); assert.deepEqual([w2.grossReq, w2.openPo, w2.netReq, w2.proposedQty, w2.projectedEnd], [420, 100, 290, 300, 60], 'week 2: the open order of 100 counts');
  const first = cem.find((l) => l.weekStart === monday(TODAY)); assert.equal(first.freeStock, 200, 'the stock on hand is shown in the first week'); assert.deepEqual(first.activities, []);
  assert.deepEqual([w(NEXT).requiredBy, w(NEXT).orderBy, w2.requiredBy, w2.orderBy], [day(NEXT, -3), day(NEXT, -17), day(NEXT, 4), day(NEXT, -10)], 'required-by is the start less the buffer (3 days); order-by is that less the lead time (14 days)');
  assert.deepEqual(w(NEXT).activities.map((a) => a.code), ['A10']); assert.equal(w(NEXT).late, true, 'the order-by date is already past');
  // the proposals: one for each order week; the steel needs no stock and a minimum of nothing
  const props = (await r.call(plan, 'GET', '/proposals')).json.data; const c = props.filter((p) => p.item === 'CEM-53'); assert.deepEqual(c.map((p) => [p.qty, p.requiredBy, p.orderBy, p.urgency, p.decision]), [['300', day(NEXT, -3), day(NEXT, -17), 'LATE', 'OPEN'], ['300', day(NEXT, 4), day(NEXT, -10), 'LATE', 'OPEN']]);
  const st = res.lines.filter((l) => l.itemCode === 'STL-12'); assert.equal(st.reduce((n, l) => n + l.grossReq, 0), 4000, '100 units x 40 kg of steel'); assert.equal(props.filter((p) => p.item === 'STL-12').reduce((n, p) => n + Number(p.qty), 0), 4000);
  assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.mrp.run_completed'").get() && r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.mrp.shortages_found'").get());
  // BR-01 nothing but proposals: no requisition exists until the planner accepts
  assert.equal(r.d.prepare('SELECT COUNT(*) AS n FROM proc_requisitions').get().n, 0);
});

test('FR-04 BR-01 FR-06 accept makes a DRAFT requisition and nothing more; modify respects the minimum order and the pack; reject needs a reason; an alternate in stock may be chosen; the run closes when all are decided', async () => {
  const r = await setup(); await r.stock([{ itemId: r.cement43, storeCode: 'S1ALT', storeName: 'Tower alt store', kind: 'SITE', siteId: r.s1, freeQty: 60 }]); const res = await r.run(); const props = (await r.call(plan, 'GET', '/proposals?filter[item]=CEM-53')).json.data; assert.equal(props.length, 2);
  const one = (await r.call(plan, 'GET', `/proposals/${props[0].id}`)).json.data; assert.deepEqual(one.alternates.map((a) => [a.code, a.freeQty]), [['CEM-43', 60]], 'the approved alternate with free stock is shown'); assert.ok(one.activities.length && one.leadDays === 14);
  assert.equal((await r.call(se, 'GET', '/proposals')).status, 403); assert.equal((await r.call(mgr, 'POST', `/proposals/${props[0].id}/reject`, { reason: 'Not mine to reject' })).status, 403, 'the procurement manager reads; the planner decides'); assert.equal((await r.call(plan, 'POST', `/proposals/${props[0].id}/reject`, { reason: 'x' })).status, 400, 'a reason');
  assert.equal((await r.call(plan, 'PATCH', `/proposals/${props[0].id}`, { qty: 60 })).status, 400, 'not a whole number of packs of 50'); assert.equal((await r.call(plan, 'PATCH', `/proposals/${props[0].id}`, { qty: 50 })).status, 400, 'below the minimum order of 100'); assert.equal((await r.call(plan, 'PATCH', `/proposals/${props[0].id}`, { substituteItemId: r.steel })).status, 400, 'not an alternate');
  const mod = await r.call(plan, 'PATCH', `/proposals/${props[0].id}`, { qty: 350, requiredBy: day(NEXT, 2), note: 'A little more for the kerb' }); assert.equal(mod.status, 200, JSON.stringify(mod.json)); assert.deepEqual([mod.json.data.qty, mod.json.data.modified, mod.json.data.requiredBy], [350, true, day(NEXT, 2)]);
  const alt = await r.call(plan, 'PATCH', `/proposals/${props[1].id}`, { substituteItemId: r.cement43 }); assert.equal(alt.status, 200, JSON.stringify(alt.json)); assert.equal(alt.json.data.substitute, 'CEM-43 Cement OPC 43');
  const steelIds = (await r.call(plan, 'GET', '/proposals?filter[item]=STL-12')).json.data.map((p) => p.id); assert.ok(steelIds.length >= 1);
  const acc = await r.call(plan, 'POST', '/proposals/accept', { ids: [props[0].id, props[1].id], siteId: r.s1 }); assert.equal(acc.status, 201, JSON.stringify(acc.json)); const q = acc.json.data.requisition;
  assert.deepEqual([q.status, q.source, q.lines.length, q.siteId], ['DRAFT', 'MRP', 2, r.s1], 'a draft: it still has to be sent and approved by value (BR-01)'); assert.deepEqual(q.lines.map((l) => [l.itemCode, l.qty, l.requiredBy]), [['CEM-53', 350, day(NEXT, 2)], ['CEM-43', 300, day(NEXT, 4)]], 'the modified quantity and date, and the alternate in place of the item');
  assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM proc_requisitions WHERE status = 'APPROVED'").get().n, 0); assert.deepEqual(r.d.prepare('SELECT decision, pr_id FROM proc_mrp_proposals WHERE id IN (?, ?)').all(props[0].id, props[1].id).map((x) => ({ ...x })), [{ decision: 'ACCEPTED', pr_id: q.id }, { decision: 'ACCEPTED', pr_id: q.id }]);
  assert.equal((await r.call(plan, 'POST', '/proposals/accept', { ids: [props[0].id] })).status, 409, 'a decided proposal is not decided again'); assert.equal((await r.call(plan, 'PATCH', `/proposals/${props[0].id}`, { qty: 400 })).status, 409);
  assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.mrp.proposals_accepted'").get()); const prl = r.d.prepare("SELECT source_type, source_id FROM proc_pr_lines WHERE pr_id = ?").all(q.id).map((x) => ({ ...x })); assert.deepEqual(prl.map((x) => x.source_type), ['mrp_proposal', 'mrp_proposal']);
  // the rest is rejected with a reason: the run closes when nothing is open
  assert.equal((await r.call(plan, 'GET', `/runs/${res.id}`)).json.data.status, 'COMPLETED'); for (const id of steelIds) assert.equal((await r.call(plan, 'POST', `/proposals/${id}/reject`, { reason: 'The steel is in the rate contract call-off' })).status, 200);
  const done = (await r.call(plan, 'GET', `/runs/${res.id}`)).json.data; assert.deepEqual([done.status, done.openProposals], ['CLOSED', 0]); assert.equal((await r.call(plan, 'GET', `/proposals/${steelIds[0]}`)).json.data.reason, 'The steel is in the rate contract call-off');
  // the requisition made counts as supply: a new run finds the cement covered up to what it asks
  const again = await r.run(); assert.ok(again.lines.filter((l) => l.itemCode === 'CEM-53').some((l) => l.openPr > 0), 'the draft requisition is counted as on its way');
});

test('FR-05 FR-06 the shortage heat-map by item and week, the long-lead list with supplier capacity, parameters changed by a maker and approved by a checker, and the exports', async () => {
  const r = await ready(); await r.stock([{ itemId: r.cement, storeCode: 'S1ST', storeName: 'Tower store', kind: 'SITE', siteId: r.s1, freeQty: 200 }]);
  // parameters: the maker proposes, the checker approves; the one in force changes only on approval
  const pc = await r.call(ic, 'POST', '/item-params', { itemId: r.cement, leadTimeDays: 60, moq: 100, packSize: 50, safetyStock: 50, longLead: true, capacityNote: 'The plant can supply 2,000 bags a week', effectiveFrom: '2026-01-01' }); assert.equal(pc.status, 201, JSON.stringify(pc.json)); const pid_ = pc.json.data.id;
  assert.equal((await r.call(ic, 'POST', '/item-params', { itemId: r.cement, leadTimeDays: 10, effectiveFrom: '2026-01-01' })).status, 400, 'the same item and date'); assert.equal((await r.call(se, 'POST', '/item-params', { itemId: r.cement, leadTimeDays: 10, effectiveFrom: '2026-02-01' })).status, 403); assert.equal((await r.call(ic, 'POST', '/item-params', { itemId: r.cement, leadTimeDays: 10, moq: 75, packSize: 50, effectiveFrom: '2026-02-01' })).status, 400, 'the minimum is a whole number of packs');
  const sub = await r.call(ic, 'POST', `/item-params/${pid_}/submit`); assert.equal(sub.status, 202); const inst = sub.json.data.workflowInstanceId; assert.equal(await (async () => (await r.api.call('GET', `${W}/tasks?mine=assigned`, ic)).json.data.rows.some((x) => x.instance.id === inst))(), false, 'the proposer holds no task');
  assert.equal((await r.call(ic, 'PATCH', `/item-params/${pid_}`, { leadTimeDays: 5 })).status, 409, 'locked while it waits'); const before = (await r.run()).lines; assert.equal(before.every((l) => l.orderBy === null || l.orderBy >= day(NEXT, -20)), true, 'the default lead time of 7 days is used until it is approved');
  assert.equal((await r.act(mgr, inst)).status, 200); await r.params({ itemId: r.steel, leadTimeDays: 0, effectiveFrom: '2026-01-01' }); const res = await r.run(plan, { bufferDays: 0 }); const ll = (await r.call(mgr, 'GET', `/runs/${res.id}/long-lead`)).json.data;
  assert.deepEqual(ll.rows.map((x) => [x.code, x.leadDays, x.capacityNote, x.late]), [['CEM-53', 60, 'The plant can supply 2,000 bags a week', true]]); assert.equal(ll.rows[0].orderBy, day(NEXT, -60), '60 days before the start (no buffer in this run)'); assert.ok(ll.rows[0].daysToOrder < 0);
  const hm = (await r.call(mgr, 'GET', `/runs/${res.id}/heatmap`)).json.data; assert.equal(hm.weeks.length, 6); const cem = hm.items.find((x) => x.code === 'CEM-53'); assert.deepEqual(cem.weeks.map((w) => w.level), ['NONE', 'CRITICAL', 'CRITICAL', 'NONE', 'NONE', 'NONE'], 'short in two weeks, critical because it is long-lead and late'); assert.ok(cem.longLead && cem.totalShort > 0);
  const stl = hm.items.find((x) => x.code === 'STL-12'); assert.equal(stl.weeks[1].level, 'SHORT', 'a shortage that is not yet late or long-lead'); assert.deepEqual([hm.totals.items, hm.totals.critical], [2, 1]);
  for (const [kind, ct] of [['RESULT', 'spreadsheetml'], ['HEATMAP', 'spreadsheetml'], ['LONG_LEAD', 'spreadsheetml']]) { const x = await r.api.raw('GET', `${P}/runs/${res.id}/export?kind=${kind}&format=xlsx`, plan); assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), new RegExp(ct)); }
  const csv = await r.api.raw('GET', `${P}/runs/${res.id}/export?kind=LONG_LEAD&format=csv`, mgr); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /CEM-53/); assert.equal((await r.api.raw('GET', `${P}/runs/${res.id}/print`, plan)).status, 200); assert.equal((await r.call(se, 'GET', `/runs/${res.id}/heatmap`)).status, 403);
  assert.equal((await r.call(plan, 'POST', `/item-params/${pid_}/withdraw`, { reason: 'No longer wanted' })).status, 422);
});

test('FR-01 released take-off quantities replace the norms; hand-entered demand; runs supersede each other; the weekly job; amend, cancel, delete; roles, isolation and the flag', async () => {
  const r = await setup(); const d = r.d;
  // a released take-off names 1,000 bags: the item takes that quantity, phased as the norms say (420 and 420 of 840 become 500 and 500)
  const to = Number(d.prepare("INSERT INTO mto_takeoffs (company_id, doc_no, revision_no, kind, discipline, title, drawing_ref, status, project_id, released_at, created_by) VALUES (1, 'TO/1', 0, 'TAKEOFF', 'CIVIL', 'Slab take-off', 'DWG-1', 'APPROVED', ?, ?, 't')").run(r.pid, TODAY).lastInsertRowid);
  d.prepare("INSERT INTO mto_material_requirements (company_id, source_ref, item_id, description, net_qty, wastage_pct, qty, uom, project_id, created_by, source_type, source_id) VALUES (1, 'TO/1 R0', ?, 'Cement', 900000, 50000, 1000000, 'bag', ?, 't', 'mto_takeoff', ?)").run(r.cement, r.pid, String(to));
  const c = await r.call(plan, 'POST', '/runs', { projectId: r.pid, horizonWeeks: 6, includeMto: false }); const off = (await r.call(plan, 'POST', `/runs/${c.json.data.id}/submit`)).json.data; assert.equal(off.lines.filter((l) => l.itemCode === 'CEM-53').reduce((n, l) => n + l.grossReq, 0), 840, 'with the take-off left out');
  const on = (await r.run()).lines.filter((l) => l.itemCode === 'CEM-53'); assert.deepEqual(on.filter((l) => l.grossReq > 0).map((l) => l.grossReq), [500, 500], 'the take-off quantity, phased by the schedule');
  const first = (await r.call(plan, 'GET', '/runs')).json.data; assert.deepEqual(first.map((x) => x.status), ['COMPLETED', 'SUPERSEDED'], 'a later run supersedes the earlier one'); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM proc_mrp_proposals WHERE run_id = ? AND decision = 'SUPERSEDED'").get(off.id).n, off.proposalCount);
  // hand-entered demand in a draft run
  const m = await r.call(plan, 'POST', '/runs', { projectId: r.pid, horizonWeeks: 6 }); const imp = await r.call(plan, 'POST', `/runs/${m.json.data.id}/import`, { rows: [{ itemCode: 'STL-12', weekStart: day(NEXT, 14), qty: 1000, note: 'Kerb stones job' }] }); assert.equal(imp.status, 200, JSON.stringify(imp.json)); assert.equal((await r.call(plan, 'POST', `/runs/${m.json.data.id}/import`, { rows: [{ itemCode: 'NOPE', weekStart: NEXT, qty: 1 }] })).status, 400);
  assert.equal((await r.call(plan, 'PATCH', `/runs/${m.json.data.id}`, { horizonWeeks: 8 })).status, 200); const made = (await r.call(plan, 'POST', `/runs/${m.json.data.id}/submit`)).json.data; assert.ok(made.lines.some((l) => l.itemCode === 'STL-12' && l.activities.some((a) => a.code === 'MANUAL')), 'the entered demand is a source'); assert.equal((await r.call(plan, 'PATCH', `/runs/${m.json.data.id}`, { horizonWeeks: 9 })).status, 409, 'locked once made');
  assert.equal((await r.call(plan, 'POST', `/runs/${m.json.data.id}/submit`)).status, 422, 'not run twice');
  // amend: a new run to make again; cancel gives the open proposals up; delete only a draft
  const am = await r.call(plan, 'POST', `/runs/${m.json.data.id}/amend`, { reason: 'The schedule was changed this morning' }); assert.equal(am.status, 201); assert.equal(am.json.data.docNo, `${made.docNo}/R1`); assert.equal((await r.call(plan, 'POST', `/runs/${m.json.data.id}/amend`, { reason: 'Again, for no reason' })).status, 409); assert.equal((await r.call(plan, 'DELETE', `/runs/${m.json.data.id}`)).status, 422); assert.equal((await r.call(plan, 'DELETE', `/runs/${am.json.data.id}`)).status, 200);
  const cx = await r.call(plan, 'POST', `/runs/${m.json.data.id}/cancel`, { reason: 'Made by mistake for this project' }); assert.equal(cx.status, 200); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM proc_mrp_proposals WHERE run_id = ? AND decision = 'OPEN'").get(m.json.data.id).n, 0);
  // the weekly job
  const jobs = runtimeOf(d).jobs; const n0 = (await r.call(plan, 'GET', '/runs')).json.data.length; await jobs.enqueue('proc.mrp_weekly', {}); await jobs.drain(); const all = (await r.call(plan, 'GET', '/runs')).json.data; assert.equal(all.length, n0 + 1); assert.equal(all.find((x) => x.kind === 'SCHEDULED').project, 'MRP1', 'only the project with an approved schedule');
  // roles, isolation, idempotency and the flag
  const k = key(); const a1 = await r.call(plan, 'POST', '/runs', { projectId: r.pid }, k); const a2 = await r.call(plan, 'POST', '/runs', { projectId: r.pid }, k); assert.equal(a1.json.data.id, a2.json.data.id, 'an idempotent replay');
  for (const who of [plan, ic, mgr, pm]) assert.equal((await r.call(who, 'GET', '/runs')).status, 200, who.user); assert.equal((await r.call(se, 'GET', '/runs')).status, 403); assert.equal((await r.call(mgr, 'POST', '/runs', { projectId: r.pid })).status, 403, 'the procurement manager reads'); assert.equal((await r.call(pm, 'POST', `/runs/${all[0].id}/submit`)).status, 403); assert.equal((await r.call(plan, 'POST', '/supply/ingest', { supplies: [{ projectId: r.pid, itemId: r.cement, kind: 'PO', docRef: 'X', balanceQty: 1, expectedOn: NEXT }] })).status, 403);
  assert.equal((await r.call(other, 'GET', `/runs/${all[0].id}`)).status, 404); assert.equal((await r.call(other, 'GET', '/runs')).json.data.length, 0); assert.equal((await r.call(other, 'POST', '/runs', { projectId: r.pid })).status, 404); assert.equal((await r.call(pd, 'GET', '/runs')).status, 403);
  assert.equal((await r.call(plan, 'POST', '/runs', { projectId: r.pid2 })).status, 201, 'a project without a schedule can be run: only take-offs are planned'); const none = (await r.call(plan, 'GET', '/runs?filter[project]=MRP2')).json.data[0]; const nr = (await r.call(plan, 'POST', `/runs/${none.id}/submit`)).json.data; assert.match(nr.warnings[0], /no approved schedule/);
  d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1502'").run(); assert.equal((await r.call(plan, 'GET', '/runs')).status, 404); assert.equal((await r.call(plan, 'GET', '/proposals')).status, 404); assert.equal((await r.call(ic, 'GET', '/requisitions')).status, 200, 'the requisitions of 15.01 are not switched off with it');
});
