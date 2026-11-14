import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { plantOf } from '../src/server/modules/plant/index.js';

// Part 17.04: fuel issues, tanks, reconciliation, consumption against the norm and the anti-leakage rules.
const P = '/api/v1/plant'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `plf-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const sup = as('PMSUP', 'fsu1'); const se = as('SE', 'fse1'); const pm = as('PM', 'fpm1'); const pmgr = as('PLANTMGR', 'fpl1'); const sk = as('SK', 'fsk1'); const other = as('PMSUP', 'fsux', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function fill(d, table, vals) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all(); const sql = d.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name === 'doc_no' && !('doc_no' in vals)) { names.push('doc_no'); params.push(`T/${table}/${(seq += 1)}`); continue; } if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${(seq += 1)}`)); } }
  return Number(d.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
const aud = as('AUD', 'fau1');
async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db; d.exec('PRAGMA foreign_keys = OFF');
  for (const [n, r] of [['fsu1', ['PMSUP']], ['fsu2', ['PMSUP']], ['fse1', ['SE']], ['fpm1', ['PM']], ['fpl1', ['PLANTMGR']], ['fac1', ['ACCMGR']], ['fsk1', ['SK']], ['fau1', ['AUD']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const A = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'FA1', 'Tower FA1', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const sA = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'FA-S1', 'Site A', 'ACTIVE')").run(A).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run().lastInsertRowid);
  const cls = Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (1, 'EXC', 'Excavator', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(cat).lastInsertRowid);
  const fuelItem = Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (1, 'HSD', 'High speed diesel', 'MATERIAL', ?, 'L', '2026-01-01', 'ACTIVE', 1)").run(cat).lastInsertRowid);
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'FV', 'Fuel Co', 'FuelCo', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const machine = (code, o = {}, since = 8) => { const id = fill(d, 'plt_equipment', { company_id: 1, asset_code: code, class_item_id: cls, ownership: 'OWNED', purchase_value: 100000, meter_type: 'HOURS', fuel_type: 'DIESEL', fuel_norm: 12000, fuel_norm_unit: 'L_PER_HOUR', tank_capacity: 200000, road_vehicle: 0, status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'DEPLOYED', org_project_id: A, org_site_id: sA, ...o });
    const a = fill(d, 'plt_allocations', { company_id: 1, equipment_id: id, org_project_id: A, org_site_id: sA, from_date: plus(-since), to_date: plus(60), internal_rate: 150000, charge_basis: 'DAY', status: 'APPROVED', phase: 'ON_SITE', arrived_on: plus(-since), arrival_meter: 1000000, source: 'OWN', requested_by: 'x' }); return { id, a, code }; };
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const tasksOf = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act = async (who, instanceId, action = 'approve') => { const task = (await tasksOf(who)).find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, ...(action === 'approve' ? {} : { comment: 'Please check the reading' }) } }); };
  const events = (type) => d.prepare('SELECT payload FROM core_outbox WHERE event_type = ? ORDER BY id').all(type).map((x) => { const j = JSON.parse(x.payload); return j.data ?? j; });
  const tank = async (code = 'T1', o = {}) => { const c = await call(pmgr, 'POST', '/fuel/tanks', { code, name: `Tank ${code}`, type: 'TANK', fuelType: 'DIESEL', projectId: A, siteId: sA, capacity: 5000, openingLitres: 1000, openingDate: plus(-10), openingRate: 90, ...o }); assert.equal(c.status, 201, JSON.stringify(c.json)); return c.json.data; };
  const issue = async (t, m, o = {}, who = sk) => call(who, 'POST', '/issues', { tankId: t.id, equipmentId: m.id, issueAt: `${TODAY}T08:00`, meterReading: 1000, litres: 100, receivedBy: 'Op Ram', issuedBy: 'fsk1', ...o });
  const wf = (id) => d.prepare('SELECT workflow_instance_id AS w FROM plt_fuel_issues WHERE id = ?').get(id).w;
  const send = async (id, who = sk) => { const f = fill(d, 'core_files', { company_id: 1, linked_entity: 'plt_fuel_issues', linked_id: id, original_name: 'meter.jpg', mime: 'image/jpeg' }); const at = await call(who, 'POST', `/issues/${id}/files`, { fileId: f }); assert.equal(at.status, 200, JSON.stringify(at.json)); return call(who, 'POST', `/issues/${id}/submit`); };
  const sent = async (t, m, o = {}) => { const c = await issue(t, m, o); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await send(c.json.data.id); assert.equal(s.status, 202, JSON.stringify(s.json)); return s.json.data; };
  const rules = (issueId) => d.prepare("SELECT rule_code FROM plt_fuel_anomalies WHERE issue_id = ? AND anomaly_status <> 'VOID' ORDER BY rule_code").all(issueId).map((x) => x.rule_code);
  return { api, d, A, sA, cls, fuelItem, vendor, machine, call, act, events, tank, issue, send, sent, rules, wf, tasksOf, drain: () => runtimeOf(d).bus.drain() };
}

test('T-01 BR-01: an issue cannot exceed the tank of the machine, the meter must advance, the tank must hold the fuel, the fuel must match the tank', async () => {
  const r = await ready(); const t = await r.tank(); const m = r.machine('EX-1');
  assert.equal((await r.issue(t, m, { litres: 250 })).status, 400, 'above the 200 l tank of the machine'); assert.equal((await r.issue(t, m, { litres: 0 })).status, 400);
  const first = await r.sent(t, m, { issueAt: `${plus(-3)}T08:00` }); assert.equal(first.status, 'SUBMITTED'); assert.equal(first.previousMeter, null);
  const back = await r.issue(t, m, { issueAt: `${plus(-3)}T16:00`, meterReading: 995 }); assert.equal(back.status, 400); assert.match(JSON.stringify(back.json), /cannot go back/);
  const same = await r.issue(t, m, { issueAt: `${plus(-3)}T16:00`, meterReading: 1000 }); assert.equal(same.status, 400); assert.match(JSON.stringify(same.json), /not advanced/);
  const big = await r.issue(t, r.machine('EX-9'), { litres: 150, tankId: (await r.tank('T9', { openingLitres: 100 })).id }); assert.equal(big.status, 400); assert.match(JSON.stringify(big.json), /holds 100 litres/, 'the tank holds less than asked');
  const petrol = await r.tank('TP', { fuelType: 'PETROL' }); assert.equal((await r.issue(petrol, r.machine('EX-8'))).status, 400, 'a diesel machine from a petrol tank');
  const noPhoto = await r.issue(t, m, { issueAt: `${plus(-2)}T08:00`, meterReading: 1008, litres: 96 }); assert.equal(noPhoto.status, 201); const ns = await r.call(sk, 'POST', `/issues/${noPhoto.json.data.id}/submit`); assert.equal(ns.status, 400); assert.ok(ns.json.error.details.some((x) => x.field === 'photo'), 'the photograph of the meter and pump is asked for');
  assert.equal((await r.call(se, 'POST', '/issues', { tankId: t.id, equipmentId: m.id, meterReading: 1, litres: 1, receivedBy: 'x' })).status, 403, 'the site engineer does not issue fuel');
});

test('T-01 FR-04 FR-05 each detection rule fires on seeded data: above the norm, two issues close together, more than a tank in 24 hours, a meter not advancing', async () => {
  const r = await ready(); const t = await r.tank();
  // above the norm: 10 hours on 150 l is 15 l/h against 12 l/h: 25% over
  const a = r.machine('EX-A', { tank_capacity: 400000 }); await r.sent(t, a, { issueAt: `${plus(-3)}T08:00`, meterReading: 1000, litres: 100 }); const over = await r.sent(t, a, { issueAt: `${plus(-3)}T18:00`, meterReading: 1010, litres: 150 });
  assert.equal(over.consumption, 15, 'litres per hour of the meter run'); assert.equal(over.norm, 12); assert.equal(over.deviationPct, 25); assert.deepEqual(r.rules(over.id), ['OVER_NORM']);
  const ok = await r.sent(t, a, { issueAt: `${plus(-2)}T18:00`, meterReading: 1020, litres: 120 }); assert.equal(ok.consumption, 12); assert.deepEqual(r.rules(ok.id), [], 'on the norm: nothing');
  // two issues close together
  const b = r.machine('EX-B'); await r.sent(t, b, { issueAt: `${plus(-2)}T09:00`, meterReading: 1000, litres: 20 }); const dup = await r.sent(t, b, { issueAt: `${plus(-2)}T09:30`, meterReading: 1001, litres: 20, fullTank: false }); assert.deepEqual(r.rules(dup.id), ['DUPLICATE_ISSUE']);
  // more than a tank in 24 hours
  const c = r.machine('EX-C'); await r.sent(t, c, { issueAt: `${plus(-2)}T06:00`, meterReading: 1000, litres: 120 }); const cap = await r.sent(t, c, { issueAt: `${plus(-2)}T14:00`, meterReading: 1010, litres: 120 }); assert.deepEqual(r.rules(cap.id), ['OVER_CAPACITY']);
  // a meter that did not advance, with the reason
  const e = r.machine('EX-D'); await r.sent(t, e, { issueAt: `${plus(-2)}T06:00`, meterReading: 1000, litres: 50 }); const same = await r.sent(t, e, { issueAt: `${plus(-2)}T16:00`, meterReading: 1000, litres: 50, noAdvanceReason: 'Hour meter jammed' }); assert.deepEqual(r.rules(same.id), ['METER_NOT_ADVANCING']);
  const list = (await r.call(pmgr, 'GET', '/fuel/anomalies')).json; assert.equal(list.data.length, 4); assert.deepEqual(list.data.map((x) => x.rule).sort(), ['DUPLICATE_ISSUE', 'METER_NOT_ADVANCING', 'OVER_CAPACITY', 'OVER_NORM']); const sum = (await r.call(pmgr, 'GET', '/fuel/anomalies/summary')).json.data; assert.equal(sum.open, 4);
  await r.drain(); assert.equal(r.events('plant.fuel.anomaly_raised').length, 4);
  const again = await r.sent(t, a, { issueAt: `${plus(-1)}T18:00`, meterReading: 1030, litres: 100 }); assert.equal(again.consumption, 10, 'a better run than the norm raises nothing'); assert.deepEqual(r.rules(again.id), []);
});

test('T-01 FR-05 the nightly sweep: fuel to a machine that did not work, fuel in the log against fuel issued', async () => {
  const r = await ready(); const t = await r.tank(); const idle = r.machine('EX-I'); const worked = r.machine('EX-W'); const day = plus(-1);
  const i1 = await r.sent(t, idle, { issueAt: `${day}T10:00`, meterReading: 1000, litres: 80 }); const i2 = await r.sent(t, worked, { issueAt: `${day}T10:00`, meterReading: 1000, litres: 100 });
  fill(r.d, 'plt_logs', { company_id: 1, equipment_id: worked.id, allocation_id: worked.a, org_project_id: r.A, org_site_id: r.sA, log_date: day, shift: 'GENERAL', start_meter: 1000000, end_meter: 1008000, working_hrs: 8000, fuel_litres: 50000, status: 'APPROVED', doc_no: 'LG/T/1', requested_by: 'x' });
  const out = plantOf(r.d).fuelsvc.sweep(1); assert.equal(out.raised, 2, 'one not working, one log that differs'); assert.deepEqual(r.rules(i1.id), ['NOT_WORKING']); assert.deepEqual(r.rules(i2.id), []);
  const all = (await r.call(pmgr, 'GET', '/fuel/anomalies')).json.data; assert.deepEqual(all.map((x) => x.rule).sort(), ['LOG_MISMATCH', 'NOT_WORKING']); assert.deepEqual(plantOf(r.d).fuelsvc.sweep(1).raised, 0, 'a second sweep raises nothing again'); assert.equal((await r.call(pmgr, 'GET', '/fuel/anomalies')).json.data.length, 2);
});

test('T-01 FR-01 FR-03 receipts, dips and the daily tank reconciliation: opening + receipts - issues = book, against the dip', async () => {
  const r = await ready(); const t = await r.tank('T2', { openingLitres: 1000, openingDate: plus(-5) }); const m = r.machine('EX-R');
  const bad = await r.call(sk, 'POST', `/fuel/tanks/${t.id}/receipts`, { source: 'PUMP', litres: 500, rate: 95 }); assert.equal(bad.status, 400, 'a pump purchase needs the bill number'); assert.equal((await r.call(sk, 'POST', `/fuel/tanks/${t.id}/receipts`, { source: 'PUMP', litres: 9000, rate: 95, billNo: 'B1' })).status, 400, 'the tank holds 5,000 l');
  const rec = await r.call(sk, 'POST', `/fuel/tanks/${t.id}/receipts`, { source: 'PUMP', litres: 500, rate: 95, billNo: 'PB-1', pettyRef: 'PC-1', receiptDate: plus(-2) }); assert.equal(rec.status, 201, JSON.stringify(rec.json)); assert.equal(rec.json.data.amount, null, 'the store keeper does not see the cost');
  const grnId = fill(r.d, 'inv_grns', { company_id: 1, vendor_id: r.vendor, status: 'APPROVED', emergency: 1, emergency_why: 'test', doc_no: 'GRN/T/1' }); fill(r.d, 'inv_grn_lines', { company_id: 1, grn_id: grnId, item_id: r.fuelItem, received_qty: 2000000, accepted_qty: 2000000, rate: 9200 });
  assert.equal((await r.call(pmgr, 'POST', `/fuel/tanks/${t.id}/receipts`, { source: 'GRN', grnNo: 'GRN/NONE', litres: 100 })).status, 400); assert.equal((await r.call(pmgr, 'POST', `/fuel/tanks/${t.id}/receipts`, { source: 'GRN', grnNo: 'GRN/T/1', litres: 2500 })).status, 400, 'more than the goods receipt holds');
  const g = await r.call(pmgr, 'POST', `/fuel/tanks/${t.id}/receipts`, { source: 'GRN', grnNo: 'GRN/T/1', litres: 1000, receiptDate: plus(-2) }); assert.equal(g.status, 201, JSON.stringify(g.json)); assert.equal(g.json.data.rate, 9200, 'the rate of the goods receipt'); assert.equal(g.json.data.grn, 'GRN/T/1');
  assert.equal((await r.call(pmgr, 'POST', `/fuel/tanks/${t.id}/receipts`, { source: 'GRN', grnNo: 'GRN/T/1', litres: 1500 })).status, 400, 'only 1,000 l of the goods receipt are left');
  const i = await r.sent(t, m, { issueAt: `${plus(-2)}T09:00`, meterReading: 1000, litres: 200 });
  const dip1 = await r.call(sk, 'POST', '/fuel/dips', { tankId: t.id, dipDate: plus(-2), dipLitres: 2300 }); assert.equal(dip1.status, 201, JSON.stringify(dip1.json)); assert.deepEqual([dip1.json.data.opening, dip1.json.data.receipts, dip1.json.data.issues, dip1.json.data.book, dip1.json.data.variance, dip1.json.data.within], [1000, 1500, 200, 2300, 0, true]);
  const dip2 = await r.call(sk, 'POST', '/fuel/dips', { tankId: t.id, dipDate: plus(-1), dipLitres: 2100 }); assert.equal(dip2.json.data.book, 2300, 'nothing moved: the book is the dip of the day before'); assert.equal(dip2.json.data.variance, -200); assert.equal(dip2.json.data.within, false);
  assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM plt_fuel_anomalies WHERE rule_code = 'TANK_VARIANCE' AND anomaly_status = 'OPEN'").get().n, 1, 'a loss of 200 l beyond the tolerance'); const dip3 = await r.call(sk, 'POST', '/fuel/dips', { tankId: t.id, dipDate: plus(-1), dipLitres: 2290 }); assert.equal(dip3.json.data.within, true, 'a corrected dip within the tolerance (20 l)');
  assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM plt_fuel_anomalies WHERE rule_code = 'TANK_VARIANCE' AND anomaly_status = 'OPEN'").get().n, 0, 'the anomaly of the wrong dip is withdrawn');
  assert.equal((await r.call(sk, 'POST', '/fuel/dips', { tankId: t.id, dipDate: plus(1), dipLitres: 1 })).status, 400, 'a day that has not come'); assert.equal((await r.call(sk, 'POST', '/fuel/dips', { tankId: t.id, dipDate: plus(-1), dipLitres: 99999 })).status, 400, 'above the capacity');
  const rc = (await r.call(pmgr, 'GET', `/fuel/reconciliation?tankId=${t.id}&from=${plus(-3)}&to=${TODAY}`)).json.data; const d2 = rc.rows.find((x) => x.date === plus(-2)); assert.deepEqual([d2.opening, d2.receipts, d2.issues, d2.book, d2.dip, d2.status], [1000, 1500, 200, 2300, 2300, 'OK']); assert.equal(rc.rows.find((x) => x.date === plus(-1)).status, 'OK');
  await r.drain(); assert.equal(r.events('plant.fuel.received').length, 2); assert.ok(r.events('plant.fuel.reconciled').length >= 3);
  const tk = (await r.call(pmgr, 'GET', `/fuel/tanks/${t.id}`)).json.data; assert.equal(tk.bookLitres, 2290 + 0, 'the book follows the latest dip'); assert.equal((await r.call(pmgr, 'POST', `/fuel/receipts/${rec.json.data.id}/cancel`, { reason: 'Entered twice by mistake' })).status, 200); assert.equal(void i, undefined);
});

test('FR-02 AC-01 the verification: another plant supervisor verifies; the cost is the weighted rate; return, reject, amend; cost is shown only to those who may', async () => {
  const r = await ready(); const t = await r.tank(); const m = r.machine('EX-V'); const a = await r.sent(t, m, { litres: 100 }); const id = a.id;
  assert.equal(a.cost, null, 'the store keeper has no cost'); assert.equal((await r.call(sk, 'PATCH', `/issues/${id}`, { litres: 90 })).status, 409, 'locked while waiting'); assert.equal((await r.tasksOf(sk)).some((x) => x.instance.id === r.wf(id)), false, 'the maker has no task');
  assert.equal((await r.act(sup, r.wf(id), 'return')).status, 200); const ret = (await r.call(sk, 'GET', `/issues/${id}`)).json.data; assert.equal(ret.status, 'RETURNED'); assert.equal((await r.call(sk, 'PATCH', `/issues/${id}`, { litres: 90, rowVersion: ret.version })).status, 200); assert.equal((await r.call(sk, 'POST', `/issues/${id}/submit`)).status, 202);
  assert.equal((await r.act(sup, r.wf(id))).status, 200); const done = (await r.call(pmgr, 'GET', `/issues/${id}`)).json.data; assert.equal(done.status, 'APPROVED'); assert.equal(done.cost, 810000, '90 l at Rs 90: paise'); assert.equal(done.rate, 9000);
  await r.drain(); const ev = r.events('plant.fuel.issue_approved'); assert.equal(ev.length, 1); assert.deepEqual([ev[0].litres, ev[0].cost, ev[0].rate, ev[0].assetCode, ev[0].projectId], [90, 8100, 90, 'EX-V', r.A]);
  assert.equal((await r.call(sk, 'POST', `/issues/${id}/amend`, { reason: 'Wrong litres entered' })).status, 403); assert.equal((await r.call(pmgr, 'POST', `/issues/${id}/amend`, { reason: 'Wrong litres entered' })).status, 200); assert.equal((await r.call(pmgr, 'GET', `/issues/${id}`)).json.data.status, 'RETURNED');
  const b = await r.sent(t, m, { issueAt: `${plus(-1)}T08:00`, meterReading: 1010, litres: 60 }); assert.equal((await r.act(sup, r.wf(b.id), 'reject')).status, 200); assert.equal((await r.call(pmgr, 'GET', `/issues/${b.id}`)).json.data.status, 'REJECTED'); assert.equal((await r.call(pmgr, 'GET', `/fuel/tanks/${t.id}`)).json.data.bookLitres, 1000 - 90, 'a rejected issue is not booked');
  const c = await r.issue(t, m, { issueAt: `${plus(-1)}T09:00`, meterReading: 1020, litres: 10 }); assert.equal((await r.call(sk, 'DELETE', `/issues/${c.json.data.id}`)).status, 200); const pr = await r.call(pmgr, 'GET', `/issues/${id}/print`); assert.equal(pr.status, 200);
  const h = (await r.call(pmgr, 'GET', `/issues/${id}/history`)).json.data; assert.ok(h.approvals.length >= 3 && h.audit.some((x) => x.action === 'amend'));
  assert.equal((await r.call(pmgr, 'POST', '/issues/import', { rows: [{ assetCode: 'EX-V', tankCode: 'T1', issueAt: `${plus(-1)}T11:00`, meterReading: 1030, litres: 20, receivedBy: 'Op' }] })).status, 403, 'the plant manager reads and exports; the site enters'); const imp = await r.call(sk, 'POST', '/issues/import', { rows: [{ assetCode: 'EX-V', tankCode: 'T1', issueAt: `${plus(-1)}T11:00`, meterReading: 1030, litres: 20, receivedBy: 'Op' }] }); assert.equal(imp.status, 201, JSON.stringify(imp.json));
});

test('FR-05 section 9 anomaly acceptance: explained by the plant manager, accepted by the plant supervisor then the project manager; or confirmed as loss; costs follow the permission', async () => {
  const r = await ready(); const t = await r.tank(); const a = r.machine('EX-N'); await r.sent(t, a, { issueAt: `${plus(-3)}T08:00`, meterReading: 1000, litres: 100 }); const over = await r.sent(t, a, { issueAt: `${plus(-3)}T18:00`, meterReading: 1010, litres: 150 });
  const an = (await r.call(pmgr, 'GET', '/fuel/anomalies')).json.data[0]; assert.equal(an.rule, 'OVER_NORM'); const det = (await r.call(pmgr, 'GET', `/fuel/anomalies/${an.id}`)).json.data; assert.equal(det.details.deviationPct, 25); assert.ok(det.litresAtRisk > 0); assert.equal(det.valueAtRisk > 0, true);
  assert.equal((await r.call(sk, 'GET', '/fuel/anomalies')).status, 403, 'the store keeper does not review anomalies'); assert.equal((await r.call(pm, 'POST', `/fuel/anomalies/${an.id}/explain`, { reasonCode: 'HEAVY_DUTY', explanation: 'Heavy rock breaking' })).status, 403, 'the project manager accepts, does not explain');
  assert.equal((await r.call(pmgr, 'POST', `/fuel/anomalies/${an.id}/explain`, { reasonCode: 'OTHER', explanation: 'short' })).status, 400, 'other needs a real explanation'); const ex = await r.call(pmgr, 'POST', `/fuel/anomalies/${an.id}/explain`, { reasonCode: 'HEAVY_DUTY', explanation: 'Heavy rock breaking for the whole shift' }); assert.equal(ex.status, 202, JSON.stringify(ex.json)); assert.equal(ex.json.data.status, 'SUBMITTED');
  const w = d_wf(r, an.id); assert.equal((await r.tasksOf(pm)).some((x) => x.instance.id === w), false, 'the project manager has no task before the plant supervisor'); assert.equal((await r.tasksOf(pmgr)).some((x) => x.instance.id === w), false, 'nor the person who explained');
  assert.equal((await r.act(sup, w)).status, 200); assert.equal((await r.call(pmgr, 'GET', `/fuel/anomalies/${an.id}`)).json.data.status, 'SUBMITTED', 'then the project manager'); assert.equal((await r.act(pm, w)).status, 200);
  const acc = (await r.call(pmgr, 'GET', `/fuel/anomalies/${an.id}`)).json.data; assert.equal(acc.status, 'ACCEPTED'); assert.equal(acc.reasonCode, 'HEAVY_DUTY'); await r.drain(); assert.equal(r.events('plant.fuel.anomaly_accepted').length, 1);
  assert.equal((await r.call(sup, 'GET', `/fuel/anomalies/${an.id}`)).json.data.valueAtRisk, null, 'the plant supervisor sees litres, not the value');
  // returned explanation goes back to open
  const b = r.machine('EX-M'); await r.sent(t, b, { issueAt: `${plus(-2)}T08:00`, meterReading: 1000, litres: 100 }); await r.sent(t, b, { issueAt: `${plus(-2)}T18:00`, meterReading: 1010, litres: 150 }); const an2 = (await r.call(pmgr, 'GET', '/fuel/anomalies?filter[status]=OPEN')).json.data[0];
  assert.equal((await r.call(pmgr, 'POST', `/fuel/anomalies/${an2.id}/explain`, { reasonCode: 'METER_FAULT', explanation: 'Meter was changed on site' })).status, 202); assert.equal((await r.act(sup, d_wf(r, an2.id), 'return')).status, 200); assert.equal((await r.call(pmgr, 'GET', `/fuel/anomalies/${an2.id}`)).json.data.status, 'OPEN', 'back to open with the comment');
  assert.equal((await r.call(pmgr, 'GET', `/fuel/anomalies/${an2.id}`)).json.data.reviewComment, 'Please check the reading');
  assert.equal((await r.call(sup, 'POST', `/fuel/anomalies/${an2.id}/confirm`, { note: 'Fuel was sold outside' })).status, 403, 'the plant supervisor does not confirm a loss'); const cf = await r.call(pm, 'POST', `/fuel/anomalies/${an2.id}/confirm`, { note: 'Fuel was sold outside the site' }); assert.equal(cf.status, 200, JSON.stringify(cf.json)); assert.equal(cf.json.data.status, 'CONFIRMED');
  await r.drain(); const lk = r.events('plant.fuel.leakage_confirmed'); assert.equal(lk.length, 1); assert.equal(lk[0].rule, 'OVER_NORM'); assert.ok(lk[0].value > 0 && lk[0].litres > 0);
  assert.equal((await r.call(pm, 'POST', `/fuel/anomalies/${an2.id}/confirm`, { note: 'Confirmed again' })).status, 422, 'only an open anomaly is confirmed');
  void over;
});

test('FR-04 FR-06 consumption against the norm by equipment, class and project; litres and cost; drill-down and export', async () => {
  const r = await ready(); const t = await r.tank(); const m = r.machine('EX-K'); await r.sent(t, m, { issueAt: `${plus(-3)}T08:00`, meterReading: 1000, litres: 100 }); await r.sent(t, m, { issueAt: `${plus(-2)}T08:00`, meterReading: 1010, litres: 150 }); await r.sent(t, m, { issueAt: `${plus(-1)}T08:00`, meterReading: 1020, litres: 120 });
  const c = (await r.call(pmgr, 'GET', `/fuel/consumption?from=${plus(-5)}&to=${TODAY}`)).json.data; const row = c.rows.find((x) => x.assetCode === 'EX-K'); assert.deepEqual([row.issues, row.litres, row.meterRun, row.actual, row.norm], [3, 370, 20, 13.5, 12], '270 l over 20 hours, fill to fill'); assert.equal(row.deviationPct, 12.5); assert.equal(row.status, 'OK'); assert.equal(row.cost, 370 * 9000, 'at the weighted rate'); assert.equal(c.total.litres, 370);
  assert.equal((await r.call(sup, 'GET', `/fuel/consumption?from=${plus(-5)}&to=${TODAY}`)).json.data.rows[0].cost, null, 'no cost for the plant supervisor'); assert.equal((await r.call(sk, 'GET', '/fuel/consumption')).status, 403);
  const byP = (await r.call(pmgr, 'GET', `/fuel/consumption?groupBy=project&from=${plus(-5)}&to=${TODAY}`)).json.data; assert.equal(byP.rows.length, 1); assert.equal(byP.rows[0].litres, 370); assert.equal((await r.call(pmgr, 'GET', `/fuel/consumption?groupBy=class&from=${plus(-5)}&to=${TODAY}`)).json.data.rows[0].machines, 1);
  const dr = (await r.call(pmgr, 'GET', `/fuel/consumption/records?equipmentId=${m.id}&from=${plus(-5)}&to=${TODAY}`)).json.data; assert.equal(dr.rows.length, 3);
  const csv = await r.api.raw('GET', `${P}/fuel/export?kind=consumption&from=${plus(-5)}&to=${TODAY}`, { ...pmgr }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /EX-K/); assert.equal((await r.api.raw('GET', `${P}/fuel/export`, { ...sup })).status, 403, 'export is for those who hold it');
  const il = await r.api.raw('GET', `${P}/issues/export`, { ...pmgr }); assert.equal(il.status, 200); const list = (await r.call(aud, 'GET', '/issues')).json; assert.equal(list.data.length, 3, 'audit reads');
});

test('scope, flag, tenant and idempotency: the other company sees nothing; flag off hides the part; a replay does not duplicate', async () => {
  const r = await ready(); const t = await r.tank(); const m = r.machine('EX-S'); const a = await r.sent(t, m, {});
  assert.equal((await r.call(other, 'GET', `/issues/${a.id}`)).status, 404, 'another company'); assert.equal((await r.call(other, 'GET', '/issues')).json.data.length, 0);
  const k = key(); const body = { tankId: t.id, equipmentId: m.id, issueAt: `${plus(-1)}T08:00`, meterReading: 1010, litres: 10, receivedBy: 'Op' }; const q1 = await r.call(sk, 'POST', '/issues', body, k); const q2 = await r.call(sk, 'POST', '/issues', body, k); assert.equal(q1.json.data.id, q2.json.data.id, 'idempotent replay');
  assert.equal((await r.call(sk, 'POST', '/fuel/tanks', { code: 'X', name: 'X', type: 'TANK', fuelType: 'DIESEL', capacity: 10 })).status, 403, 'the store keeper does not set up tanks'); assert.equal((await r.call(pmgr, 'POST', '/fuel/tanks', { code: 'T1', name: 'dup', type: 'TANK', fuelType: 'DIESEL', capacity: 10 })).status, 400, 'code in use');
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plant.p1704'").run(); for (const p of ['/issues', '/fuel/tanks', '/fuel/anomalies', '/fuel/consumption']) assert.equal((await r.call(pmgr, 'GET', p)).status, 404, p); assert.equal((await r.call(pmgr, 'GET', '/equipment')).status, 200, 'the register is unaffected');
});
function d_wf(r, id) { return r.d.prepare('SELECT workflow_instance_id AS w FROM plt_fuel_anomalies WHERE id = ?').get(id).w; }
