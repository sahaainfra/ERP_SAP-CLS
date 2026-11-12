import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { plantOf } from '../src/server/modules/plant/index.js';

// Part 17.01: the equipment register: approval chain, certificates and expiry, BR-01 (an expired or missing mandatory certificate blocks allocation), status, dashboard, import, scope.
const P = '/api/v1/plant'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `plt-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pmgr = as('PLANTMGR', 'epm1'); const pmgr2 = as('PLANTMGR', 'epm2'); const sup = as('PMSUP', 'esup1'); const acc = as('ACCMGR', 'eacc1'); const sk = as('SK', 'esk1'); const other = as('PLANTMGR', 'epmx', '2');
const TODAY = todayIST(); const ago = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db; d.exec('PRAGMA foreign_keys = OFF');
  for (const [n, r] of [['epm1', ['PLANTMGR']], ['epm2', ['PLANTMGR']], ['esup1', ['PMSUP']], ['esup2', ['PMSUP']], ['eacc1', ['ACCMGR']], ['eacc2', ['ACCMGR']], ['esk1', ['SK']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const proj = (code) => Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(code, `Tower ${code}`).lastInsertRowid);
  const A = proj('PA1'); const B = proj('PB1'); const siteA = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'PA-S1', 'Site A', 'ACTIVE')").run(A).lastInsertRowid); const siteB = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'PB-S1', 'Site B', 'ACTIVE')").run(B).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run().lastInsertRowid);
  const cls = (code, type = 'EQUIPMENT') => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (1, ?, ?, ?, ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(code, `Class ${code}`, type, cat).lastInsertRowid);
  const truck = cls('TIPPER'); const crane = cls('CRANE'); const mixer = cls('MIXER'); const mat = cls('CEMENT-X', 'MATERIAL');
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'EQV', 'Hire Co', 'HireCo', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const tasksOf = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act = async (who, instanceId, action = 'approve') => { const task = (await tasksOf(who)).find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, ...(action === 'approve' ? {} : { comment: 'Please correct the particulars' }) } }); };
  const base = (o = {}) => ({ classItemId: truck, make: 'Tata', model: 'Prima', year: 2022, regNo: `MH12-${(seq += 1)}`, ownership: 'OWNED', purchaseValue: 2_500_000, meterType: 'KM', fuelType: 'DIESEL', fuelNorm: 3.5, fuelNormUnit: 'KM_PER_L', tankCapacity: 300, roadVehicle: true, projectId: A, siteId: siteA, ...o });
  const doc = (who, id, o) => call(who, 'POST', `/equipment/${id}/documents`, { number: `N${(seq += 1)}`, issuer: 'RTO', validFrom: ago(300), validUntil: ago(-300), ...o });
  const register = async (o = {}, docs = ['RC', 'INSURANCE', 'FITNESS', 'PUC']) => {
    const c = await call(sup, 'POST', '/equipment', base(o)); assert.equal(c.status, 201, JSON.stringify(c.json)); const e = c.json.data; for (const t of docs) assert.equal((await doc(sup, e.id, { docType: t })).status, 201);
    const s = await call(sup, 'POST', `/equipment/${e.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const inst = (await call(sup, 'GET', `/equipment/${e.id}`)).json.data;
    const wf = d.prepare('SELECT workflow_instance_id AS w FROM plt_equipment WHERE id = ?').get(e.id).w; assert.equal((await act(pmgr, wf)).status, 200); if (e.ownership === 'OWNED' || o.ownership === undefined) { if (d.prepare('SELECT status FROM plt_equipment WHERE id = ?').get(e.id).status !== 'APPROVED') assert.equal((await act(acc, wf)).status, 200); }
    void inst; return (await call(pmgr, 'GET', `/equipment/${e.id}`)).json.data;
  };
  return { api, d, A, B, siteA, siteB, truck, crane, mixer, mat, vendor, call, act, base, doc, register, tasksOf, drain: () => runtimeOf(d).bus.drain() };
}

test('T-01 BR-01 an expired insurance blocks allocation and deployment when configured; a renewal frees it; the block can be switched off', async () => {
  const r = await ready(); const e = await r.register(); assert.equal(e.status, 'APPROVED'); assert.equal(e.state, 'AVAILABLE');
  let a = (await r.call(pmgr, 'GET', `/equipment/${e.id}/allocatable`)).json.data; assert.equal(a.allowed, true);
  const ins = e.documents.find((x) => x.docType === 'INSURANCE'); r.d.prepare('UPDATE plt_documents SET valid_until = ? WHERE id = ?').run(ago(2), ins.id);
  a = (await r.call(pmgr, 'GET', `/equipment/${e.id}/allocatable`)).json.data; assert.equal(a.allowed, false); assert.equal(a.blockedByCertificate, true); assert.equal(a.problems[0].code, 'CERT_EXPIRED'); assert.equal(a.problems[0].docType, 'INSURANCE');
  const dep = await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'DEPLOYED', projectId: r.A, siteId: r.siteA }); assert.equal(dep.status, 422); assert.match(dep.json.error.message, /Insurance/);
  assert.throws(() => plantOf(r.d).svc.equipment.assertAllocatable({ user: 'epm1', companyId: 1, roles: ['PLANTMGR'] }, e.id), /cannot be put to work/);
  // renewal: the new certificate replaces the expired one (kept as history)
  assert.equal((await r.doc(pmgr, e.id, { docType: 'INSURANCE', validUntil: ago(-365) })).status, 201); a = (await r.call(pmgr, 'GET', `/equipment/${e.id}/allocatable`)).json.data; assert.equal(a.allowed, true);
  const g = (await r.call(pmgr, 'GET', `/equipment/${e.id}`)).json.data; assert.equal(g.superseded.length, 1); assert.ok(g.timeline.some((t) => t.event === 'CERTIFICATE_RENEWED'));
  assert.equal((await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'DEPLOYED', projectId: r.A, siteId: r.siteA })).json.data.state, 'DEPLOYED');
  // a missing mandatory certificate blocks too; a switch off only warns
  const m = await r.register({}, ['RC', 'INSURANCE', 'FITNESS']); a = (await r.call(pmgr, 'GET', `/equipment/${m.id}/allocatable`)).json.data; assert.equal(a.allowed, false); assert.equal(a.problems[0].code, 'CERT_MISSING'); assert.equal(a.problems[0].docType, 'PUC');
  r.d.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'plant.cert.block_on_expiry', '0', 'integer', 'company', 1, '2020-01-01', 't', 'test')").run();
  a = (await r.call(pmgr, 'GET', `/equipment/${m.id}/allocatable`)).json.data; assert.equal(a.allowed, true); assert.equal(a.warnings.length, 1);
  // a crane needs a load test; a third-party inspection counts
  const c = await r.register({ classItemId: r.crane, roadVehicle: false, lifting: true, capacity: '50 t', meterType: 'HOURS', fuelNormUnit: 'L_PER_HOUR', fuelNorm: 12 }, []); r.d.prepare("UPDATE core_parameters SET value = '1' WHERE key = 'plant.cert.block_on_expiry'").run();
  assert.equal((await r.call(pmgr, 'GET', `/equipment/${c.id}/allocatable`)).json.data.allowed, false); await r.doc(pmgr, c.id, { docType: 'THIRD_PARTY_INSPECTION' }); assert.equal((await r.call(pmgr, 'GET', `/equipment/${c.id}/allocatable`)).json.data.allowed, true);
});

test('AC-04 FR-03 the approval chain: the maker never approves; an owned asset also goes to accounts; hired equipment does not; return, reject, amend', async () => {
  const r = await ready(); const c = await r.call(sup, 'POST', '/equipment', r.base()); const id = c.json.data.id; assert.equal(c.json.data.status, 'DRAFT'); for (const t of ['RC', 'INSURANCE', 'FITNESS', 'PUC']) await r.doc(sup, id, { docType: t });
  assert.equal((await r.call(sup, 'POST', `/equipment/${id}/status`, { state: 'IDLE' })).status, 422, 'a draft has no status to change'); assert.equal((await r.call(pmgr, 'POST', `/equipment/${id}/approve`, {})).status, 404, 'no approve endpoint outside the workflow');
  assert.equal((await r.call(sup, 'POST', `/equipment/${id}/submit`)).status, 202); const wf = r.d.prepare('SELECT workflow_instance_id AS w FROM plt_equipment WHERE id = ?').get(id).w;
  assert.equal((await r.call(sup, 'PATCH', `/equipment/${id}`, { make: 'X' })).status, 409, 'locked while waiting'); assert.equal((await r.tasksOf(sup)).some((t) => t.instance.id === wf), false, 'the maker has no task');
  assert.equal((await r.act(pmgr, wf, 'return')).status, 200); let g = (await r.call(sup, 'GET', `/equipment/${id}`)).json.data; assert.equal(g.status, 'RETURNED');
  assert.equal((await r.call(sup, 'PATCH', `/equipment/${id}`, { make: 'Ashok Leyland', rowVersion: 1 })).status, 409, 'optimistic lock'); assert.equal((await r.call(sup, 'PATCH', `/equipment/${id}`, { make: 'Ashok Leyland', rowVersion: g.version })).status, 200);
  assert.equal((await r.call(sup, 'POST', `/equipment/${id}/submit`)).status, 202); assert.equal((await r.act(pmgr, wf)).status, 200); g = (await r.call(sup, 'GET', `/equipment/${id}`)).json.data; assert.equal(g.status, 'SUBMITTED', 'an owned asset waits for accounts');
  assert.equal((await r.act(acc, wf)).status, 200); g = (await r.call(sup, 'GET', `/equipment/${id}`)).json.data; assert.equal(g.status, 'APPROVED'); assert.equal(g.approvedBy, 'eacc1'); assert.equal(g.purchaseValue, null, 'the supervisor does not see the financial fields');
  assert.equal((await r.call(acc, 'GET', `/equipment/${id}`)).json.data.purchaseValue, 2_500_000 * 100, 'accounts does'); assert.equal((await r.call(sup, 'PATCH', `/equipment/${id}`, { make: 'Z' })).status, 409, 'approved is locked');
  await r.drain(); const ev = r.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'plant.equipment.registered'").all().map((x) => { const j = JSON.parse(x.payload); return j.data ?? j; }); assert.equal(ev.length, 1); assert.equal(ev[0].capitalise, true); assert.equal(ev[0].assetCode, g.assetCode);
  // amendment: back for correction, approved again; the machine stays in service
  assert.equal((await r.call(pmgr, 'POST', `/equipment/${id}/amend`, { reason: 'Wrong chassis number' })).status, 200); assert.equal((await r.call(sup, 'GET', `/equipment/${id}/allocatable`)).json.data.allowed, true, 'still in service during amendment');
  // hired equipment: the plant manager alone
  const h = await r.register({ ownership: 'HIRED', ownerPartnerId: r.vendor, purchaseValue: 0 }); assert.equal(h.status, 'APPROVED'); assert.equal(h.owner, 'Hire Co');
  // reject; the same person who made it cannot approve even with the role
  const x = await r.call(pmgr, 'POST', '/equipment', r.base()); await r.call(pmgr, 'POST', `/equipment/${x.json.data.id}/submit`); const wx = r.d.prepare('SELECT workflow_instance_id AS w FROM plt_equipment WHERE id = ?').get(x.json.data.id).w; assert.equal((await r.tasksOf(pmgr)).some((t) => t.instance.id === wx), false);
  assert.equal((await r.act(pmgr2, wx, 'reject')).status, 200); assert.equal((await r.call(pmgr, 'GET', `/equipment/${x.json.data.id}`)).json.data.status, 'REJECTED');
  // delete a draft only; idempotent replay returns the same record
  const k = key(); const body = r.base(); const a1 = await r.call(sup, 'POST', '/equipment', body, k); const a2 = await r.call(sup, 'POST', '/equipment', body, k); assert.equal(a1.json.data.id, a2.json.data.id, 'idempotent replay');
  assert.equal((await r.call(sup, 'DELETE', `/equipment/${a1.json.data.id}`)).status, 200); assert.equal((await r.call(sup, 'DELETE', `/equipment/${id}`)).status, 409);
});

test('FR-01 FR-03 FR-04 validation, status changes with the history, QR tag, photos entity and print', async () => {
  const r = await ready(); const bad = await r.call(sup, 'POST', '/equipment', r.base({ classItemId: r.mat })); assert.equal(bad.status, 400); assert.ok(bad.json.error.details.some((d) => d.field === 'classItemId'), 'a material is not an equipment class');
  assert.ok((await r.call(sup, 'POST', '/equipment', r.base({ ownership: 'HIRED' }))).json.error.details.some((d) => d.field === 'ownerPartnerId')); assert.ok((await r.call(sup, 'POST', '/equipment', r.base({ meterType: 'HOURS' }))).json.error.details.some((d) => d.field === 'fuelNormUnit'), 'litres per hour for an hour meter');
  const first = await r.call(sup, 'POST', '/equipment', r.base({ assetCode: 'DUP-1', regNo: 'REG-1' })); assert.equal(first.status, 201); const dup = await r.call(sup, 'POST', '/equipment', r.base({ assetCode: 'DUP-1', regNo: 'REG-1' })); assert.deepEqual(dup.json.error.details.map((x) => x.field).sort(), ['assetCode', 'regNo']);
  assert.equal((await r.call(sup, 'POST', `/equipment/${first.json.data.id}/submit`, undefined)).status, 202);
  const ready2 = await r.call(sup, 'POST', '/equipment', r.base({ roadVehicle: true, regNo: null })); assert.equal((await r.call(sup, 'POST', `/equipment/${ready2.json.data.id}/submit`)).status, 400, 'a road vehicle needs its registration number to be submitted');
  const e = await r.register(); assert.match(e.assetCode, /\S/); assert.equal(e.qrCode, `ERP:E:${e.assetCode}`); assert.equal(e.tankCapacity, 300); assert.equal(e.fuelNorm, 3.5);
  assert.equal((await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'BREAKDOWN' })).status, 400, 'a breakdown says what happened'); const bd = await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'BREAKDOWN', note: 'Hydraulic hose burst' }); assert.equal(bd.json.data.state, 'BREAKDOWN');
  assert.equal((await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'DEPLOYED', projectId: r.A })).status, 422, 'not straight from breakdown to deployed'); assert.equal((await r.call(pmgr, 'GET', `/equipment/${e.id}/allocatable`)).json.data.allowed, false, 'a broken machine is not allocatable');
  await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'AVAILABLE' }); const dep = await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'DEPLOYED', projectId: r.B, siteId: r.siteA }); assert.equal(dep.status, 400, 'the site belongs to another project'); const ok = await r.call(pmgr, 'POST', `/equipment/${e.id}/status`, { state: 'DEPLOYED', projectId: r.B, siteId: r.siteB }); assert.equal(ok.json.data.project, 'PB1');
  const hist = (await r.call(pmgr, 'GET', `/equipment/${e.id}/history`)).json.data; assert.deepEqual(hist.timeline.filter((t) => t.event === 'STATE').map((t) => `${t.fromState}>${t.toState}`).reverse(), ['AVAILABLE>BREAKDOWN', 'BREAKDOWN>AVAILABLE', 'AVAILABLE>DEPLOYED']); assert.ok(hist.audit.some((a) => a.action === 'status')); assert.ok(hist.approvals.length >= 2);
  assert.throws(() => r.d.prepare('UPDATE plt_timeline SET note = ? WHERE equipment_id = ?').run('x', e.id), /never changed/);
  const tag = (await r.call(pmgr, 'GET', `/equipment/${e.id}/tag`)).json.data; assert.equal(tag.code, `ERP:E:${e.assetCode}`); assert.match(tag.svg, /<svg/); assert.equal((await r.call(pmgr, 'GET', `/equipment/scan?code=${encodeURIComponent(tag.code)}`)).json.data.id, e.id);
  const pdf = await r.api.raw('GET', `${P}/equipment/${e.id}/print`, { ...pmgr }); assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/);
  const list = (await r.call(pmgr, 'GET', '/equipment?pageSize=100')).json; assert.ok(list.data.length >= 2); assert.ok((await r.call(pmgr, 'GET', `/equipment?q=${e.assetCode}`)).json.data.some((x) => x.id === e.id));
  assert.ok(r.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'plt_equipment' AND action = 'print'").get(), 'print is audited');
  const f = plantOf(r.d); assert.ok(f, 'service registered');
});

test('AC-01 the plant dashboard: fleet by status, utilisation, breakdowns, expiring certificates, with drill-down and export', async () => {
  const r = await ready(); const a = await r.register({ regNo: 'D-1' }); const b = await r.register({ regNo: 'D-2' }); const c = await r.register({ regNo: 'D-3', projectId: r.B, siteId: r.siteB }); const h = await r.register({ ownership: 'HIRED', ownerPartnerId: r.vendor, purchaseValue: 0, regNo: 'D-4' });
  await r.call(pmgr, 'POST', `/equipment/${a.id}/status`, { state: 'DEPLOYED', projectId: r.A, siteId: r.siteA }); await r.call(pmgr, 'POST', `/equipment/${b.id}/status`, { state: 'DEPLOYED', projectId: r.A, siteId: r.siteA }); await r.call(pmgr, 'POST', `/equipment/${c.id}/status`, { state: 'BREAKDOWN', note: 'Engine seized' });
  const puc = c.documents.find((x) => x.docType === 'PUC'); r.d.prepare('UPDATE plt_documents SET valid_until = ? WHERE id = ?').run(ago(1), puc.id); const fit = h.documents.find((x) => x.docType === 'FITNESS'); r.d.prepare('UPDATE plt_documents SET valid_until = ? WHERE id = ?').run(ago(-10), fit.id);
  const dash = (await r.call(pmgr, 'GET', '/dashboard')).json.data; const k = dash.kpis;
  assert.deepEqual([k.fleet.count, k.fleet.owned, k.fleet.hired], [4, 3, 1]); assert.deepEqual([k.utilisation.deployed, k.utilisation.working, k.utilisation.pct], [2, 4, 50]); assert.equal(k.utilisation.status, 'bad', '50% against a 70% target'); assert.deepEqual([k.breakdown.count, k.available.count], [1, 1]);
  assert.deepEqual([k.expired.count, k.expiring.count, k.nonCompliant.count], [1, 1, 1]); assert.ok(dash.alerts.some((x) => x.code === 'EXPIRED') && dash.alerts.some((x) => x.code === 'BREAKDOWN')); assert.equal(dash.charts.byState.find((s) => s.key === 'DEPLOYED').value, 2);
  for (const [kind, n] of [['fleet', 4], ['DEPLOYED', 2], ['BREAKDOWN', 1], ['expired', 1], ['expiring', 2], ['nonCompliant', 1], ['pending', 0]]) { const x = (await r.call(pmgr, 'GET', `/dashboard/drill?kind=${kind}`)).json.data; assert.equal(x.rows.length, n, kind); assert.ok(x.rows.every((row) => row.docNo && row.link)); }
  const pj = (await r.call(pmgr, 'GET', `/dashboard?projectId=${r.A}`)).json.data; assert.equal(pj.kpis.fleet.count, 3); assert.equal((await r.call(pmgr, 'GET', '/dashboard/drill?kind=nope')).status, 400);
  const ex = await r.api.raw('GET', `${P}/dashboard/export?kind=register`, { ...pmgr }); assert.equal(ex.status, 200); const text = ex.buffer.toString('utf8'); assert.match(text, /Asset code/); assert.equal(text.trim().split(/\r?\n/).length, 5); assert.equal((await r.call(sup, 'GET', '/dashboard/export')).status, 403);
  const accDash = (await r.call(acc, 'GET', '/dashboard')).json.data; assert.equal(accDash.canValues, true); assert.equal((await r.call(sup, 'GET', '/dashboard')).json.data.canValues, false);
  const exSup = (await r.call(acc, 'GET', '/dashboard/export?kind=register')); assert.equal(exSup.status, 200);
});

test('FR-02 the morning sweep tells the plant managers about expired and expiring certificates, once a day, and raises the events', async () => {
  const r = await ready(); const e = await r.register({ regNo: 'S-1' }); const ins = e.documents.find((x) => x.docType === 'INSURANCE'); const rc = e.documents.find((x) => x.docType === 'RC');
  r.d.prepare('UPDATE plt_documents SET valid_until = ? WHERE id = ?').run(ago(1), ins.id); r.d.prepare('UPDATE plt_documents SET valid_until = ? WHERE id = ?').run(ago(-7), rc.id);
  const svc = plantOf(r.d).svc; assert.equal(svc.documents.sweep(), 2); await r.drain(); const types = r.d.prepare("SELECT event_type FROM core_outbox WHERE event_type LIKE 'plant.certificate.%'").all().map((x) => x.event_type).sort(); assert.deepEqual(types, ['plant.certificate.expired', 'plant.certificate.expiring']);
  const n = r.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE source_type LIKE 'plant.certificate.due.%'").get?.(); if (n) assert.ok(n.n >= 1, 'a notification was made');
});

test('FR-05 import of an existing fleet: drafts with their certificates; nothing is approved by the import; a bad row refuses the whole file', async () => {
  const r = await ready(); const row = (o) => ({ classCode: 'TIPPER', assetCode: `IMP-${(seq += 1)}`, make: 'Volvo', regNo: `IMP-R${seq}`, ownership: 'OWNED', purchaseValue: 1_000_000, meterType: 'KM', fuelType: 'DIESEL', fuelNorm: 3, roadVehicle: true, projectCode: 'PA1', siteCode: 'PA-S1', state: 'DEPLOYED', documents: [{ docType: 'RC', validUntil: ago(-100) }, { docType: 'INSURANCE', validUntil: ago(5) }], ...o });
  const bad = await r.call(pmgr, 'POST', '/equipment/import', { rows: [row(), row({ classCode: 'NOPE' })] }); assert.equal(bad.status, 400); assert.equal(r.d.prepare('SELECT COUNT(*) AS n FROM plt_equipment').get().n, 0);
  const ok = await r.call(pmgr, 'POST', '/equipment/import', { rows: [row(), row()] }); assert.equal(ok.status, 201); assert.equal(ok.json.data.created.length, 2); const rows = r.d.prepare('SELECT status, source_type, approved_at FROM plt_equipment').all(); assert.ok(rows.every((x) => x.status === 'DRAFT' && x.source_type === 'import' && !x.approved_at), 'drafts: the import approves nothing');
  assert.equal(r.d.prepare('SELECT COUNT(*) AS n FROM plt_documents').get().n, 4); assert.equal((await r.call(sup, 'POST', '/equipment/import', { rows: [row()] })).status, 403, 'the supervisor does not import');
  const sub = await r.call(pmgr, 'POST', '/equipment/import', { rows: [row()], submit: true }); assert.equal(sub.status, 201); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM plt_equipment WHERE status = 'SUBMITTED'").get().n, 1, 'submitted rows go through the approval');
});

test('AC-03 who sees what: the roles of the part, cross-project isolation, another company, the flag', async () => {
  const r = await ready(); const a = await r.register({ regNo: 'A-1' }); const b = await r.register({ regNo: 'B-1', projectId: r.B, siteId: r.siteB });
  for (const who of [pmgr, sup, acc]) assert.equal((await r.call(who, 'GET', '/equipment')).status, 200, who.user); assert.equal((await r.call(sk, 'GET', '/equipment')).status, 403); assert.equal((await r.call(sk, 'POST', '/equipment', r.base())).status, 403);
  assert.equal((await r.call(acc, 'POST', '/equipment', r.base())).status, 403, 'accounts does not register'); assert.equal((await r.call(acc, 'POST', `/equipment/${a.id}/status`, { state: 'IDLE' })).status, 403); assert.equal((await r.call(sup, 'POST', `/equipment/${a.id}/cancel`, { reason: 'No longer needed' })).status, 422, 'an approved entry is not cancelled');
  assert.equal((await r.call(sup, 'POST', `/equipment/${a.id}/amend`, { reason: 'Correct the model' })).status, 403, 'only the plant manager amends');
  // a supervisor assigned to project A sees only A (through the service with an assignment)
  const uid = Number(r.d.prepare("SELECT id FROM iam_users WHERE username = 'esup2'").get().id); r.d.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PMSUP' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test', 'test', 'test')").run(uid, JSON.stringify([r.A]));
  const s = plantOf(r.d).svc; const who = { user: 'esup2', userId: uid, companyId: 1, roles: [] }; assert.deepEqual(s.equipment.list(who, {}).data.map((x) => x.id), [a.id]); assert.throws(() => s.equipment.get(who, b.id), /does not exist/); assert.equal(s.dashboard(who, {}).kpis.fleet.count, 1); assert.throws(() => s.dashboard(who, { projectId: r.B }), /does not exist/);
  assert.throws(() => s.equipment.create(who, { classItemId: r.truck, ownership: 'OWNED', meterType: 'KM', fuelNormUnit: 'KM_PER_L', projectId: r.B, siteId: r.siteB }), /may not register/);
  assert.equal((await r.call(other, 'GET', `/equipment/${a.id}`)).status, 404, 'another company'); assert.equal((await r.call(other, 'GET', '/equipment')).json.data.length, 0);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plant.p1701'").run(); for (const p of ['/equipment', '/dashboard', `/equipment/${a.id}`]) assert.equal((await r.call(pmgr, 'GET', p)).status, 404, p);
});
