import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';

// Part 17.07: owning and operating cost, KPIs, telematics and its alerts, replacement candidates and the disposal recommendation.
const P = '/api/v1/plant'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `plf7-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const sup = as('PMSUP', 'fsu1'); const acc = as('ACCMGR', 'fac1'); const pm = as('PM', 'fpm1'); const pmgr = as('PLANTMGR', 'fpl1'); const sk = as('SK', 'fsk1'); const se = as('SE', 'fse1'); const cfo = as('CFO', 'fcf1'); const dir = as('DIR', 'fdi1');  const other = as('PMSUP', 'fsux', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function fill(d, table, vals) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all(); const sql = d.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name === 'doc_no' && !('doc_no' in vals)) { names.push('doc_no'); params.push(`T/${table}/${(seq += 1)}`); continue; } if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${(seq += 1)}`)); } }
  return Number(d.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}



async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db; d.exec('PRAGMA foreign_keys = OFF');
  for (const [n, r] of [['fsu1', ['PMSUP']], ['fpm1', ['PM']], ['fpl1', ['PLANTMGR']], ['fac1', ['ACCMGR']], ['fsk1', ['SK']], ['fau1', ['AUD']], ['fcf1', ['CFO']], ['fdi1', ['DIR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const A = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'FA1', 'Tower FA1', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const sA = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'FA-S1', 'Site A', 'ACTIVE')").run(A).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run().lastInsertRowid);
  const cls = Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (1, 'EXC', 'Excavator', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(cat).lastInsertRowid);
  const machine = (code, o = {}, since = 40) => { const id = fill(d, 'plt_equipment', { company_id: 1, asset_code: code, class_item_id: cls, ownership: 'OWNED', purchase_value: 100000000, meter_type: 'HOURS', fuel_type: 'DIESEL', road_vehicle: 0, status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'DEPLOYED', org_project_id: A, org_site_id: sA, ...o });
    const a = fill(d, 'plt_allocations', { company_id: 1, equipment_id: id, org_project_id: A, org_site_id: sA, from_date: plus(-since), to_date: plus(60), internal_rate: 150000, charge_basis: 'DAY', status: 'APPROVED', phase: 'ON_SITE', arrived_on: plus(-since), arrival_meter: 1000000, source: 'OWN', requested_by: 'x' }); return { id, a, code }; };
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const tasksOf = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act = async (who, instanceId, action = 'approve') => { const task = (await tasksOf(who)).find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, ...(action === 'approve' ? {} : { comment: 'Please check this again' }) } }); };
  const events = (type) => d.prepare('SELECT payload FROM core_outbox WHERE event_type = ? ORDER BY id').all(type).map((x) => { const j = JSON.parse(x.payload); return j.data ?? j; });
  const log = (m, date, o = {}) => fill(d, 'plt_logs', { company_id: 1, equipment_id: m.id, allocation_id: m.a, org_project_id: A, org_site_id: sA, log_date: date, shift: 'GENERAL', start_meter: 1000000, end_meter: 1008000, working_hrs: 8000, idle_hrs: 0, breakdown_hrs: 0, status: 'APPROVED', requested_by: 'x', ...o });
  const wf = (id) => d.prepare('SELECT workflow_instance_id AS w FROM plt_disposal_recs WHERE id = ?').get(id).w;
  return { api, d, A, sA, cls, machine, call, act, events, log, wf, tasksOf, drain: () => runtimeOf(d).bus.drain() };
}

test('T-01 FR-01 owning and operating cost of a machine: depreciation (or the cost items), insurance, fuel, maintenance and hire give the cost an hour; the supervisor sees no costs', async () => {
  const r = await ready(); const m = r.machine('EX-1'); const from = plus(-29); const to = TODAY; for (let i = 0; i < 5; i += 1) r.log(m, plus(-i - 1), { working_hrs: 8000, idle_hrs: 1000 });
  fill(r.d, 'plt_fuel_issues', { company_id: 1, equipment_id: m.id, issue_date: plus(-3), issue_at: `${plus(-3)}T08:00`, litres: 100000, cost_amount: 900000, rate: 9000, status: 'APPROVED', meter_reading: 1000, requested_by: 'x' }); fill(r.d, 'plt_job_cards', { company_id: 1, equipment_id: m.id, job_type: 'BREAKDOWN', complaint: 'x', opened_at: `${plus(-5)}T08:00`, closed_at: `${plus(-4)}T08:00`, job_status: 'CLOSED', status: 'APPROVED', total_cost: 145000, requested_by: 'x' });
  const add = await r.call(pmgr, 'POST', `/fleet/equipment/${m.id}/cost-items`, { type: 'INSURANCE', monthlyAmount: 3000, from: plus(-100) }); assert.equal(add.status, 201, JSON.stringify(add.json)); assert.equal((await r.call(sk, 'POST', `/fleet/equipment/${m.id}/cost-items`, { type: 'PERMIT', monthlyAmount: 100, from: plus(-100) })).status, 403, 'the store keeper enters none');
  const c = (await r.call(pmgr, 'GET', `/fleet/costs?from=${from}&to=${to}`)).json.data; const row = c.rows.find((x) => x.assetCode === 'EX-1'); const dep = Math.round((100000000 * 90) / 100 / (8 * 365)) * 30; const ins = Math.round((300000 * 30) / 30);
  assert.deepEqual([row.owningCost, row.operatingCost, row.fuelCost, row.maintenanceCost, row.hours], [dep + ins, 900000 + 145000, 900000, 145000, 40], 'straight-line depreciation over 8 years less 10 % salvage, plus the insurance of 30 days; fuel and maintenance of the period'); assert.equal(row.costPerHour, Math.round(((dep + ins + 1045000) * 1000) / 40000)); assert.equal(c.total.totalCost, row.totalCost);
  const dep2 = await r.call(pmgr, 'POST', `/fleet/equipment/${m.id}/cost-items`, { type: 'DEPRECIATION', monthlyAmount: 20000, from: plus(-100) }); assert.equal(dep2.status, 201); const c2 = (await r.call(pmgr, 'GET', `/fleet/costs?from=${from}&to=${to}`)).json.data.rows[0]; assert.equal(c2.owningCost, 2_000_000 + ins, 'an entered depreciation replaces the straight line');
  assert.equal((await r.call(sup, 'GET', '/fleet/costs')).status, 403, 'the supervisor has no costs'); const tw = (await r.call(sup, 'GET', '/fleet/tower')).json.data; assert.equal(tw.canCosts, false); assert.equal(tw.figures.costPerHour, null); assert.equal(tw.ranking.length, 0); const cls = (await r.call(acc, 'GET', `/fleet/costs?groupBy=class&from=${from}&to=${to}`)).json.data; assert.equal(cls.rows[0].machines, 1);
  const ex = await r.api.raw('GET', `${P}/fleet/export?kind=costs&from=${from}&to=${to}`, { ...pmgr }); assert.equal(ex.status, 200); assert.match(ex.buffer.toString('utf8'), /EX-1/); assert.equal((await r.call(se, 'GET', '/fleet/export')).status, 403);
  const items = (await r.call(pmgr, 'GET', `/fleet/equipment/${m.id}/cost-items`)).json.data; assert.equal(items.length, 2); assert.equal((await r.call(pmgr, 'DELETE', `/fleet/cost-items/${items[0].id}`)).status, 200);
});

test('FR-01 FR-02 the monthly snapshot closes the cost per machine and announces the rates; KPIs: utilisation, availability, fuel an hour, idle cost, the tower', async () => {
  const r = await ready(); const m = r.machine('EX-K', {}, 90); const month = plus(-35).slice(0, 7); for (let i = 40; i < 44; i += 1) r.log(m, plus(-i), { working_hrs: 8000, idle_hrs: 2000, breakdown_hrs: 0 });
  const bad = await r.call(pmgr, 'POST', '/fleet/snapshots', { month: TODAY.slice(0, 7) }); assert.equal(bad.status, 400, 'a month is taken after it has ended'); assert.equal((await r.call(sup, 'POST', '/fleet/snapshots', { month })).status, 403);
  const s1 = await r.call(pmgr, 'POST', '/fleet/snapshots', { month }); assert.equal(s1.status, 201, JSON.stringify(s1.json)); assert.equal(s1.json.data.machines, 1); const again = await r.call(pmgr, 'POST', '/fleet/snapshots', { month }); assert.equal(again.status, 201); assert.equal(r.d.prepare('SELECT COUNT(*) AS n FROM plt_cost_snapshots').get().n, 1, 'one snapshot per machine and month');
  await r.drain(); const ev = r.events('plant.cost.rate_published'); assert.ok(ev.length >= 1); assert.equal(ev[0].assetCode, 'EX-K'); const sn = (await r.call(pmgr, 'GET', `/fleet/snapshots?equipmentId=${m.id}`)).json.data; assert.equal(sn[0].period, month);
  const k = (await r.call(pmgr, 'GET', `/fleet/kpis?from=${plus(-60)}&to=${plus(-30)}`)).json.data; const row = k.rows[0]; assert.equal(row.hours, 32); assert.ok(row.utilisationPct > 0 && row.availabilityPct === 100); assert.ok(row.idleCost > 0, 'the idle hours cost the owning cost of those hours'); assert.equal(k.total.machines, 1);
  const tw = (await r.call(pmgr, 'GET', '/fleet/tower')).json.data; assert.equal(tw.figures.fleet, 1); assert.equal(tw.figures.deployed, 1); assert.ok(Array.isArray(tw.ranking));
});

test('FR-03 BR-01 telematics: readings are stored, never written into a log; engine hours that differ from the log, and ignition on a day with no working log, are flagged; positions and the meter suggestion', async () => {
  const r = await ready(); const m = r.machine('EX-T'); r.log(m, plus(-2), { working_hrs: 8000 }); const lgBefore = r.d.prepare('SELECT working_hrs, end_meter FROM plt_logs WHERE equipment_id = ?').get(m.id);
  const rd = (day, t, hrs, ign, lat = 28.6139, lng = 77.209) => ({ assetCode: 'EX-T', timestamp: `${day}T${t}:00`, lat, lng, engineHours: hrs, ignition: ign, fuelLevel: 150 });
  const body = { source: 'GPSCO', readings: [rd(plus(-2), '08:00', 500, true), rd(plus(-2), '14:00', 504, true), rd(plus(-1), '09:00', 504, true), rd(plus(-1), '10:00', 505, true)] }; const ing = await r.call(pmgr, 'POST', '/telematics/ingest', body); assert.equal(ing.status, 201, JSON.stringify(ing.json)); assert.deepEqual([ing.json.data.stored, ing.json.data.duplicate], [4, 0]); assert.equal((await r.call(pmgr, 'POST', '/telematics/ingest', body)).json.data.duplicate, 4, 'a replay stores nothing again');
  assert.equal((await r.call(sup, 'POST', '/telematics/ingest', body)).status, 403, 'the supervisor does not load readings'); assert.equal((await r.call(pmgr, 'POST', '/telematics/ingest', { source: 'GPSCO', readings: [{ assetCode: 'NOPE', timestamp: `${plus(-1)}T09:00:00` }] })).status, 400);
  const after = r.d.prepare('SELECT working_hrs, end_meter FROM plt_logs WHERE equipment_id = ?').get(m.id); assert.deepEqual(after, lgBefore, 'the verified log is not touched');
  const al = (await r.call(pmgr, 'GET', '/telematics/alerts')).json.data.rows; assert.deepEqual(al.map((x) => x.kind).sort(), ['HOURS_MISMATCH', 'USE_WITHOUT_LOG'], '4 engine hours against 8 logged; ignition on a day with no log'); const mm = al.find((x) => x.kind === 'HOURS_MISMATCH'); assert.deepEqual([mm.telematicsHrs, mm.loggedHrs, mm.diffHrs], [4, 8, 4]);
  const pos = (await r.call(sup, 'GET', '/telematics/positions')).json.data; assert.equal(pos.length, 1); assert.equal(pos[0].lat, 28.6139); const sg = (await r.call(sup, 'GET', `/telematics/suggest?equipmentId=${m.id}&date=${plus(-2)}`)).json.data; assert.equal(sg.engineHours, 504, 'offered as the meter of the day'); assert.equal((await r.call(sk, 'GET', '/telematics/positions')).status, 403);
  const tw = (await r.call(pmgr, 'GET', '/fleet/tower')).json.data; assert.equal(tw.figures.alerts, 2); assert.equal(tw.positions.length, 1);
});

test('FR-04 section 9 replacement candidates (age, repairs against value, low use) and the disposal recommendation: the project manager raises it, the plant manager, the CFO and the director approve', async () => {
  const r = await ready(); const old = r.machine('EX-OLD', { purchase_date: `${Number(TODAY.slice(0, 4)) - 15}-01-01` }); const fine = r.machine('EX-NEW', { purchase_date: `${Number(TODAY.slice(0, 4)) - 1}-01-01` }); for (let i = 1; i <= 60; i += 1) r.log(fine, plus(-i), { working_hrs: 9000 }); r.log(old, plus(-1), { working_hrs: 8000 });
  fill(r.d, 'plt_job_cards', { company_id: 1, equipment_id: old.id, job_type: 'BREAKDOWN', complaint: 'x', opened_at: `${plus(-50)}T08:00`, closed_at: `${plus(-49)}T08:00`, job_status: 'CLOSED', status: 'APPROVED', total_cost: 70000000, requested_by: 'x' });
  const c = (await r.call(pmgr, 'GET', '/fleet/replacement')).json.data; assert.equal(c.rows.length, 1, 'only the old machine'); assert.deepEqual(c.rows[0].flags.sort(), ['AGE', 'LOW_USE', 'REPAIR']); assert.equal(c.rows[0].repairRatioPct, 70); assert.equal(c.rows[0].ageYears, 15); assert.equal((await r.call(sup, 'GET', '/fleet/replacement')).json.data.rows[0].repairCost, null, 'no costs for the supervisor');
  assert.equal((await r.call(pmgr, 'POST', '/disposal-recs', { equipmentId: old.id, reason: 'Repairs exceed value', estValue: 200000 })).status, 403, 'the project manager raises it'); const rec = await r.call(pm, 'POST', '/disposal-recs', { equipmentId: old.id, reason: 'Repairs exceed 70 percent of value', estValue: 200000 }); assert.equal(rec.status, 201, JSON.stringify(rec.json)); const id = rec.json.data.id; assert.deepEqual(rec.json.data.flags.sort(), ['AGE', 'LOW_USE', 'REPAIR']);
  assert.equal((await r.call(pm, 'POST', '/disposal-recs', { equipmentId: old.id, reason: 'Second one for the same', estValue: 1 })).status, 409); assert.equal((await r.call(pm, 'POST', '/disposal-recs', { equipmentId: fine.id, reason: 'Not a candidate really', estValue: 1 })).status, 201, 'a recommendation can be raised for any owned machine');
  assert.equal((await r.call(pm, 'POST', `/disposal-recs/${id}/submit`)).status, 202); const w = r.wf(id); assert.equal((await r.tasksOf(pm)).some((t) => t.instance.id === w), false, 'the maker has no task'); assert.equal((await r.act(pmgr, w)).status, 200); assert.equal((await r.call(cfo, 'GET', `/disposal-recs/${id}`)).json.data.status, 'SUBMITTED'); assert.equal((await r.act(cfo, w)).status, 200); assert.equal((await r.call(cfo, 'GET', `/disposal-recs/${id}`)).json.data.status, 'SUBMITTED', 'then the director'); assert.equal((await r.act(dir, w)).status, 200);
  const done = (await r.call(dir, 'GET', `/disposal-recs/${id}`)).json.data; assert.deepEqual([done.status, done.approvedBy], ['APPROVED', 'fdi1']); await r.drain(); const ev = r.events('plant.equipment.disposal_recommended'); assert.deepEqual([ev.length, ev[0].assetCode, ev[0].estimatedValue], [1, 'EX-OLD', 200000]); assert.equal((await r.call(pm, 'PATCH', `/disposal-recs/${id}`, { reason: 'Changed after approval of it' })).status, 409);
  assert.equal((await r.call(pmgr, 'GET', '/fleet/replacement')).json.data.rows[0].recommendation.docNo, done.docNo); assert.equal((await r.call(pm, 'GET', `/disposal-recs/${id}/print`)).status, 200); assert.ok((await r.call(pm, 'GET', `/disposal-recs/${id}/history`)).json.data.approvals.length >= 3); assert.equal((await r.call(sk, 'GET', '/disposal-recs')).status, 403);
  const rj = await r.call(pm, 'POST', '/disposal-recs', { equipmentId: fine.id, reason: 'x'.repeat(12), estValue: 1 }); void rj;
});

test('AC-03 AC-04 roles, scope, flag: another company sees nothing; the flag hides the part', async () => {
  const r = await ready(); r.machine('EX-S'); const ot = await r.call(other, 'GET', '/fleet/tower'); assert.equal(ot.status, 200, JSON.stringify(ot.json)); assert.equal(ot.json.data.figures.fleet, 0, 'another company sees no machine'); assert.equal((await r.call(sk, 'GET', '/fleet/tower')).status, 403);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plant.p1707'").run(); for (const pth of ['/fleet/tower', '/fleet/costs', '/telematics/positions', '/disposal-recs']) assert.equal((await r.call(pmgr, 'GET', pth)).status, 404, pth);
});
