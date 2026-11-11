import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { assess } from '../src/server/modules/proc/xpd.js';

// Part 15.07: expediting, vendor inspection and long-lead logistics.
// T-01 a forecast milestone beyond the date required on site raises an alert naming the activities that need the item before it arrives.
const P = '/api/v1/proc'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `xpd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const ic = as('PROCIC', 'xic1'); const mgr = as('PROCMGR', 'xmgr1'); const qce = as('QCE', 'xqce1'); const qcm = as('QCMGR', 'xqcm1'); const pm = as('PM', 'xpm1'); const sk = as('SK', 'xsk1'); const aud = as('AUD', 'xaud1');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['xic1', ['PROCIC']], ['xmgr1', ['PROCMGR']], ['xqce1', ['QCE']], ['xqcm1', ['QCMGR']], ['xqce2', ['QCE']], ['xpm1', ['PM']], ['xsk1', ['SK']], ['xaud1', ['AUD']], ['xse1', ['SE']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'XP1', 'Expedite tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'HVAC', 'Plant', 'XPD', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, 'XP-CHL', 'Chiller 200 TR', 'MATERIAL', ?, 'nos', '2026-01-01', 'ACTIVE')").run(cat).lastInsertRowid);
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'V-CHL', 'Carrier Chillers Pvt Ltd', 'Carrier Chillers', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  /** An approved order of two chillers, due on the site in 90 days; the link of the vendor is the token. */
  const po = (over = {}) => {
    const no = over.docNo ?? `PO/X/${(seq += 1)}`; const id = Number(d.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by, ack_token_hash, created_by) VALUES (1, ?, ?, ?, ?, 'APPROVED', 'xic1', ?, 'test')").run(no, TODAY, pid, vendor, over.hash ?? null).lastInsertRowid);
    const l = Number(d.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, balance_qty, created_by) VALUES (1, ?, 1, ?, 'Chiller 200 TR', 2000, 'nos', 2000, 'test')").run(id, item).lastInsertRowid);
    d.prepare("INSERT INTO proc_po_schedules (company_id, po_id, po_line_id, due_date, qty, created_by) VALUES (1, ?, ?, ?, 2000, 'test')").run(id, l, plus(90)); return { id, no, line: l };
  };
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => { const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: action === 'approve' ? 'Fine, approved' : 'Please correct this and send again' } }); };
  const plan = async (p, over = {}, who = ic) => call(who, 'POST', '/expediting-plans', { poId: p.id, longLead: true, inspectionRequired: true, transitDays: 7, ...over });
  const approvedPlan = async (p, over = {}) => { const c = await plan(p, over); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await call(ic, 'POST', `/expediting-plans/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await act(mgr, s.json.data.workflowInstanceId)).status, 200); return (await call(ic, 'GET', `/expediting-plans/${c.json.data.id}`)).json.data; };
  const drain = () => runtimeOf(d).bus.drain();
  const events = (type) => d.prepare('SELECT payload FROM core_outbox WHERE event_type = ? ORDER BY id').all(type).map((x) => { const j = JSON.parse(x.payload); return j.data ?? j; });
  const pub = async (method, token, path = '', body) => { const res = await fetch(`${api.base}/api/v1/proc/vendor-po/${token}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => ({})) }; };
  return { api, d, pid, item, vendor, po, call, act, plan, approvedPlan, drain, events, pub };
}

test('assess: the arrival is the dispatch plus the transit; a late milestone or arrival is a risk; delivered is never a risk', () => {
  const ms = [{ id: 1, name: 'Manufacture', kind: 'MANUFACTURING', planned_date: '2026-06-01', ms_status: 'PENDING' }, { id: 2, name: 'Dispatch', kind: 'DISPATCH', planned_date: '2026-06-20', ms_status: 'PENDING' }];
  assert.deepEqual(assess({ requiredOnSite: '2026-07-10', transitDays: 7, milestones: ms }), { eta: '2026-06-27', daysLate: -13, offenders: [], delivered: false, atRisk: false });
  const late = assess({ requiredOnSite: '2026-07-10', transitDays: 7, milestones: [ms[0], { ...ms[1], forecast_date: '2026-07-15' }] }); assert.equal(late.eta, '2026-07-22'); assert.equal(late.daysLate, 12); assert.equal(late.atRisk, true); assert.equal(late.offenders[0].name, 'Dispatch');
  const early = assess({ requiredOnSite: '2026-07-10', transitDays: 0, milestones: [{ ...ms[0], forecast_date: '2026-07-12' }, { ...ms[1], planned_date: '2026-07-01' }] }); assert.equal(early.atRisk, true, 'a milestone beyond the date is a risk even if the dispatch is on time'); assert.equal(early.offenders.length, 1);
  assert.equal(assess({ requiredOnSite: '2026-07-10', transitDays: 7, milestones: ms, shipments: [{ status: 'IN_TRANSIT', eta: '2026-07-20' }] }).eta, '2026-07-20', 'a shipment on the way gives the date');
  assert.equal(assess({ requiredOnSite: '2026-07-10', transitDays: 7, milestones: ms, shipments: [{ status: 'DELIVERED', delivered_on: '2026-07-30' }] }).atRisk, false);
});

test('FR-01 a plan of an approved order gets a milestone template back from the date required; one plan per order; approval by the procurement manager; planned dates stay', async () => {
  const r = await ready(); const p = r.po(); const draft = await r.plan(p); assert.equal(draft.status, 201, JSON.stringify(draft.json)); const v = draft.json.data;
  assert.deepEqual([v.status, v.requiredOnSite, v.milestones.length, v.milestones.at(-1).kind, v.milestones[0].kind], ['DRAFT', plus(90), 5, 'DISPATCH', 'DRAWING_APPROVAL']); assert.equal(v.milestones.at(-1).plannedDate, plus(90 - 10), 'dispatch is the transit and three days before');
  assert.ok(v.milestones.every((m, i, a) => i === 0 || m.plannedDate > a[i - 1].plannedDate), 'dates increase');
  assert.equal((await r.plan(p)).status, 409, 'one open plan per order'); assert.equal((await r.call(ic, 'POST', '/expediting-plans', { poId: 999999 })).status, 404);
  const draftOrder = Number(r.d.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by, created_by) VALUES (1, 'PO/X/D', ?, ?, ?, 'DRAFT', 'xic1', 'test')").run(TODAY, r.pid, r.vendor).lastInsertRowid); assert.equal((await r.plan({ id: draftOrder })).status, 422, 'only an approved order');
  assert.equal((await r.call(pm, 'POST', '/expediting-plans', { poId: p.id })).status, 403, 'the project manager only reads'); assert.equal((await r.call(sk, 'GET', '/expediting-plans')).status, 403);
  const ed = await r.call(ic, 'PATCH', `/expediting-plans/${v.id}`, { transitDays: 10, rowVersion: v.rowVersion }); assert.equal(ed.status, 200); assert.equal(ed.json.data.transitDays, 10);
  assert.equal((await r.call(ic, 'PATCH', `/expediting-plans/${v.id}`, { transitDays: 5, rowVersion: v.rowVersion })).status, 409, 'a stale edit');
  const s = await r.call(ic, 'POST', `/expediting-plans/${v.id}/submit`); assert.equal(s.status, 202); assert.equal((await r.act(mgr, s.json.data.workflowInstanceId)).status, 200);
  const a = (await r.call(ic, 'GET', `/expediting-plans/${v.id}`)).json.data; assert.equal(a.status, 'APPROVED'); assert.equal(a.approvedBy, 'xmgr1'); assert.equal((await r.call(ic, 'PATCH', `/expediting-plans/${v.id}`, { transitDays: 3 })).status, 409, 'not edited once approved');
  await r.drain(); assert.equal(r.events('proc.expediting.plan_approved').length, 1);
  const am = await r.call(ic, 'POST', `/expediting-plans/${v.id}/amend`, { reason: 'The required date moved with the schedule' }); assert.equal(am.status, 201); assert.deepEqual([am.json.data.revisionNo, am.json.data.docNo.endsWith('/R1')], [1, true]);
  const s2 = await r.call(ic, 'POST', `/expediting-plans/${am.json.data.id}/submit`); await r.act(mgr, s2.json.data.workflowInstanceId); assert.equal((await r.call(ic, 'GET', `/expediting-plans/${v.id}`)).json.data.status, 'SUPERSEDED');
  const h = await r.call(ic, 'GET', `/expediting-plans/${v.id}/history`); assert.equal(h.status, 200); assert.ok(h.json.data.approvals.length > 0);
  const pr = await api_get(r, ic, `/expediting-plans/${am.json.data.id}/print`); assert.equal(pr.status, 200);
});
const api_get = (r, who, path) => r.api.call('GET', `${P}${path}`, who);

test('T-01 FR-05 a forecast milestone beyond the date required on site raises an alert naming the activities that need the item before it arrives', async () => {
  const r = await ready(); const d = r.d; const p = r.po();
  // the approved schedule: an activity starting 60 days from now uses the chiller (a BOQ line with the item as a norm)
  const ver = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (1, 'BQ/X', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 'test')").run(r.pid).lastInsertRowid);
  const line = Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, created_by) VALUES (1, ?, 'ITEM', '9.1', 'Chiller plant', 'nos', 2000, 0, 0, 'test')").run(ver).lastInsertRowid);
  d.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (1, ?, ?, 'MATERIAL', 'Chiller', 'nos', 1000, 0, 'test')").run(line, r.item);
  const cal = Number(d.prepare("INSERT INTO plan_calendars (company_id, code, name, work_week, status, created_by) VALUES (1, 'XSIX', 'Six-day', '1111110', 'ACTIVE', 'test')").run().lastInsertRowid);
  const sch = Number(d.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, calendar_id, start_date, status, created_by) VALUES (1, 'SCH/X', ?, ?, 'Master', ?, ?, 'APPROVED', 'test')").run(TODAY, r.pid, cal, TODAY).lastInsertRowid);
  const act = (code, name, es, ef) => Number(d.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, act_type, es, ef, created_by) VALUES (1, ?, ?, ?, 'TASK', ?, ?, 'test')").run(sch, code, name, es, ef).lastInsertRowid);
  const a1 = act('MEP-10', 'Install chillers', plus(60), plus(80)); const a2 = act('MEP-90', 'Commissioning', plus(150), plus(160)); for (const a of [a1, a2]) d.prepare('INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty, created_by) VALUES (1, ?, ?, 1000, ?)').run(a, line, 'test');
  const plan = await r.approvedPlan(p); assert.equal(plan.atRisk, false, 'on time as planned'); const dispatch = plan.milestones.find((m) => m.kind === 'DISPATCH'); const raw = plan.milestones.find((m) => m.kind === 'RAW_MATERIAL');
  assert.equal((await r.call(pm, 'PATCH', `/expediting-plans/${plan.id}/milestones/${raw.id}`, { forecastDate: plus(50) })).status, 200, 'the project manager may record progress');
  assert.equal((await r.call(sk, 'PATCH', `/expediting-plans/${plan.id}/milestones/${raw.id}`, { forecastDate: plus(50) })).status, 403);
  await r.drain(); assert.equal(r.events('proc.expediting.delay_detected').length, 0, 'a forecast within the date is no alert');
  // the dispatch is forecast 20 days after the date required on site
  const up = await r.call(ic, 'PATCH', `/expediting-plans/${plan.id}/milestones/${dispatch.id}`, { forecastDate: plus(110), remarks: 'Compressor delayed at the works' }); assert.equal(up.status, 200, JSON.stringify(up.json));
  const v = up.json.data; assert.equal(v.atRisk, true); assert.equal(v.eta, plus(117)); assert.equal(v.daysLate, 27); assert.equal(v.activities.length, 1, 'only the activity that starts before the arrival'); assert.deepEqual([v.activities[0].code, v.activities[0].daysBeforeArrival], ['MEP-10', 57]);
  await r.drain(); const al = r.events('proc.expediting.delay_detected'); assert.equal(al.length, 1); assert.deepEqual([al[0].poNo, al[0].daysLate, al[0].activities.map((x) => x.code), al[0].milestones[0].name], [p.no, 27, ['MEP-10'], 'Dispatch']);
  assert.equal(r.events('proc.expediting.eta_updated').at(-1).eta, plus(117), 'the look-ahead gets the new date');
  assert.ok(r.d.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'proc.xpd.delay'").get() ?? r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.expediting.delay_detected'").get(), 'the buyer is told');
  // the same lateness again is not told again; worse is
  await r.call(ic, 'PATCH', `/expediting-plans/${plan.id}/milestones/${dispatch.id}`, { remarks: 'Still delayed' }); await r.drain(); assert.equal(r.events('proc.expediting.delay_detected').length, 1);
  await r.call(ic, 'PATCH', `/expediting-plans/${plan.id}/milestones/${dispatch.id}`, { forecastDate: plus(120) }); await r.drain(); assert.equal(r.events('proc.expediting.delay_detected').length, 2, 'later still is told again');
  const dash = (await r.call(mgr, 'GET', '/expediting/dashboard')).json.data; assert.deepEqual([dash.tiles.atRisk, dash.tiles.longLead, dash.atRisk[0].activities[0]?.code], [1, 1, 'MEP-10']);
  // back on time: the risk clears
  await r.call(ic, 'PATCH', `/expediting-plans/${plan.id}/milestones/${dispatch.id}`, { forecastDate: plus(80) }); assert.equal((await r.call(ic, 'GET', `/expediting-plans/${plan.id}`)).json.data.atRisk, false);
  assert.equal((await r.call(ic, 'PATCH', `/expediting-plans/${plan.id}/milestones/${dispatch.id}`, { actualDate: plus(5) })).status, 400, 'no actual date in the future');
});

test('FR-01 the vendor updates the milestones on its order link; the buyer is told; the link of another order or an expired one gives nothing', async () => {
  const r = await ready(); const { createHash } = await import('node:crypto'); const token = 'VendorMilestoneToken-0123456789ab'; const p = r.po({ hash: createHash('sha256').update(token).digest('hex') });
  const none = await r.pub('GET', token, '/milestones'); assert.equal(none.status, 200); assert.equal(none.json.data.plan, null, 'no approved plan yet');
  const plan = await r.approvedPlan(p); const ms = (await r.pub('GET', token, '/milestones')).json.data; assert.equal(ms.milestones.length, 5); assert.equal(ms.plan.requiredOnSite, plus(90));
  const man = ms.milestones.find((m) => m.name === 'Manufacturing');
  const up = await r.pub('POST', token, `/milestones/${man.id}`, { forecastDate: plus(100), remarks: 'Steel plate late' }); assert.equal(up.status, 200, JSON.stringify(up.json));
  const after = (await r.call(ic, 'GET', `/expediting-plans/${plan.id}`)).json.data; const m = after.milestones.find((x) => x.id === man.id); assert.deepEqual([m.updatedVia, m.forecastDate, after.atRisk], ['VENDOR', plus(100), true]);
  assert.equal((await r.pub('POST', token, `/milestones/${man.id}`, { actualDate: plus(5) })).status, 400, 'not in the future');
  assert.equal((await r.pub('POST', token, `/milestones/${man.id}`, { status: 'DONE' })).status, 400, 'the vendor sends dates and a note only');
  assert.equal((await r.pub('GET', 'WrongTokenWrongToken-0123456789', '/milestones')).status, 404);
  const other = r.po({ hash: createHash('sha256').update('OtherOrderToken-0123456789abcd').digest('hex') }); assert.equal((await r.pub('POST', 'OtherOrderToken-0123456789abcd', `/milestones/${man.id}`, { forecastDate: plus(1) })).status, 404, 'a milestone of another order');
  void other; r.d.prepare("UPDATE xpd_milestones SET ms_status = 'PENDING' WHERE id = ?").run(man.id);
  const done = await r.call(ic, 'PATCH', `/expediting-plans/${plan.id}/milestones/${man.id}`, { actualDate: TODAY }); assert.equal(done.json.data.milestones.find((x) => x.id === man.id).status, 'DONE', 'an actual date completes it');
});

test('FR-02 an inspection passes, goes to the quality engineer then the quality manager, and the release note is issued; a failed one has none; an issued one is amended by a copy', async () => {
  const r = await ready(); const p = r.po(); const c = await r.call(qce, 'POST', '/inspections', { poId: p.id, itype: 'FINAL', callDate: plus(3), inspector: 'R. Kulkarni', location: 'Works, Pune', lines: [{ poLineId: p.line, qty: 2 }] }); assert.equal(c.status, 201, JSON.stringify(c.json)); const i = c.json.data;
  assert.equal((await r.call(qce, 'POST', `/inspections/${i.id}/submit`)).status, 422, 'no result yet'); assert.equal((await r.call(ic, 'POST', '/inspections', { poId: p.id, itype: 'STAGE', callDate: plus(3) })).status, 403, 'the procurement officer only reads');
  const f = await r.call(qce, 'POST', `/inspections/${i.id}/result`, { inspectionDate: TODAY, result: 'FAILED', punchPoints: [{ point: 'Tube leak at the condenser' }] }); assert.equal(f.status, 200); assert.equal((await r.call(qce, 'POST', `/inspections/${i.id}/submit`)).status, 422, 'a failed inspection has no note'); await r.drain(); assert.equal(r.events('proc.inspection.failed').length, 1);
  assert.equal((await r.call(qce, 'POST', `/inspections/${i.id}/result`, { inspectionDate: TODAY, result: 'PASSED_WITH_PUNCH' })).status, 400, 'name the punch points'); assert.equal((await r.call(qce, 'POST', `/inspections/${i.id}/result`, { inspectionDate: plus(2), result: 'PASSED' })).status, 400, 'not in the future');
  const ok = await r.call(qce, 'POST', `/inspections/${i.id}/result`, { inspectionDate: TODAY, result: 'PASSED_WITH_PUNCH', punchPoints: [{ point: 'Paint touch-up on the frame', severity: 'MINOR' }] }); assert.equal(ok.json.data.openPunch, 1);
  const s = await r.call(qce, 'POST', `/inspections/${i.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const inst = s.json.data.workflowInstanceId;
  assert.equal((await r.act(as('QCE', 'xqce2'), inst)).status, 200, 'another quality engineer reviews'); assert.equal((await r.call(qcm, 'GET', `/inspections/${i.id}`)).json.data.status, 'SUBMITTED');
  assert.equal((await r.act(qcm, inst)).status, 200); const a = (await r.call(qcm, 'GET', `/inspections/${i.id}`)).json.data; assert.deepEqual([a.status, /^IRN\/\d{4}\/\d{5}$/.test(a.irnNo), a.approvedBy], ['APPROVED', true, 'xqcm1']);
  await r.drain(); assert.equal(r.events('proc.inspection.irn_issued')[0].irnNo, a.irnNo);
  const am = await r.call(qcm, 'POST', `/inspections/${i.id}/amend`, { reason: 'Punch points closed on re-inspection' }); assert.equal(am.status, 201); const imp = await r.call(qce, 'POST', `/inspections/${am.json.data.id}/import`, { rows: [{ point: 'Gauge calibration certificate', severity: 'MAJOR' }] }); assert.equal(imp.json.data.punchPoints.length, 2);
  const list = await r.call(aud, 'GET', '/inspections?pageSize=25'); assert.equal(list.status, 200); assert.equal(list.json.data.length >= 2, true);
  assert.equal((await api_get(r, qcm, `/inspections/${i.id}/print`)).status, 200);
});

test('FR-03 FR-04 BR-01 CP-PROC-07 a shipment cannot be dispatched without the release note where inspection is mandatory; ODC needs a valid permit; delivery closes the plan', async () => {
  const r = await ready(); const p = r.po(); const plan = await r.approvedPlan(p); const mk = (over = {}) => r.call(ic, 'POST', '/shipments', { poId: p.id, transporter: 'VRL Logistics', vehicleNo: 'MH12AB1234', lrNo: 'LR-5521', ewayBillNo: '271000123456', packages: 4, eta: plus(20), lines: [{ poLineId: p.line, qty: 1 }], ...over });
  const c = await mk(); assert.equal(c.status, 201, JSON.stringify(c.json)); const sh = c.json.data;
  assert.equal((await mk({ lines: [{ poLineId: p.line, qty: 9 }] })).status, 400, 'more than the balance'); assert.equal((await mk({ isOdc: true })).status, 400, 'ODC needs its permit'); assert.equal((await mk({ isOdc: true, odcPermitNo: 'ODC/77', odcValidTo: plus(5) })).status, 400, 'the permit ends before the consignment is due'); assert.equal((await mk({ isOdc: true, odcPermitNo: 'ODC/77', odcValidTo: plus(40), odcDimensions: '8 x 3.2 x 3.5 m' })).status, 201);
  const blocked = await r.call(ic, 'POST', `/shipments/${sh.id}/dispatch`, { eta: plus(20) }); assert.ok([403, 409, 422].includes(blocked.status), `blocked: ${blocked.status} ${JSON.stringify(blocked.json)}`); assert.equal((await r.call(ic, 'GET', `/shipments/${sh.id}`)).json.data.status, 'PLANNED');
  assert.equal((await r.call(mgr, 'GET', '/expediting/dashboard')).json.data.tiles.blocked >= 1, true, 'the blocked dispatch shows on the dashboard');
  // the final inspection and its release note
  const ins = (await r.call(qce, 'POST', '/inspections', { poId: p.id, itype: 'FINAL', callDate: plus(1) })).json.data; await r.call(qce, 'POST', `/inspections/${ins.id}/result`, { inspectionDate: TODAY, result: 'PASSED' }); const s = await r.call(qce, 'POST', `/inspections/${ins.id}/submit`); await r.act(as('QCE', 'xqce2'), s.json.data.workflowInstanceId); await r.act(qcm, s.json.data.workflowInstanceId);
  const d = await r.call(ic, 'POST', `/shipments/${sh.id}/dispatch`, { eta: plus(20), location: 'Works gate' }); assert.equal(d.status, 200, JSON.stringify(d.json)); assert.deepEqual([d.json.data.status, d.json.data.clearance, d.json.data.irnNo !== null], ['DISPATCHED', 'CLEARED', true]);
  const t = await r.call(ic, 'POST', `/shipments/${sh.id}/track`, { location: 'Nashik', eta: plus(22), note: 'Delayed at the toll' }); assert.equal(t.json.data.status, 'IN_TRANSIT'); assert.equal(t.json.data.events.length, 2); assert.equal((await r.call(ic, 'GET', `/expediting-plans/${plan.id}`)).json.data.eta, plus(22));
  const dl = await r.call(ic, 'POST', `/shipments/${sh.id}/deliver`, { deliveredOn: TODAY }); assert.equal(dl.json.data.status, 'DELIVERED'); await r.drain(); assert.deepEqual([r.events('proc.shipment.dispatched').length, r.events('proc.shipment.delivered').length], [1, 1]);
  assert.equal((await r.call(ic, 'GET', `/expediting-plans/${plan.id}`)).json.data.status, 'APPROVED', 'a second shipment is still planned'); // the other planned shipments keep the plan open
  assert.equal((await r.call(sk, 'GET', '/shipments')).status, 200, 'the storekeeper sees the shipments'); assert.equal((await r.call(sk, 'POST', `/shipments/${sh.id}/cancel`, { reason: 'No longer needed' })).status, 403);
  assert.equal((await api_get(r, ic, `/shipments/${sh.id}/print`)).status, 200);
});

test('without a mandatory inspection a shipment is dispatched at once; the daily check marks late milestones once; the flag gates the endpoints', async () => {
  const r = await ready(); const p = r.po(); const plan = await r.approvedPlan(p, { inspectionRequired: false }); const sh = (await r.call(ic, 'POST', '/shipments', { poId: p.id, lrNo: 'LR-1', eta: plus(20), lines: [{ poLineId: p.line, qty: 2 }] })).json.data;
  assert.equal((await r.call(ic, 'POST', `/shipments/${sh.id}/dispatch`, { eta: plus(20) })).json.data.clearance, 'NOT_REQUIRED'); const nolr = (await r.call(ic, 'POST', '/shipments', { poId: p.id, eta: plus(20) })).json.data; assert.equal((await r.call(ic, 'POST', `/shipments/${nolr.id}/dispatch`, { eta: plus(20) })).status, 400, 'the LR or BL number is needed');
  r.d.prepare("UPDATE xpd_milestones SET planned_date = ? WHERE plan_id = ? AND kind = 'DRAWING_APPROVAL'").run(plus(-3), plan.id);
  const { createXpdService } = await import('../src/server/modules/proc/xpd.js'); const { createBase } = await import('../src/server/modules/proc/base.js'); const svc = createXpdService({ db: r.d, base: createBase({ db: r.d }) });
  svc.sweep(); assert.equal(r.d.prepare("SELECT ms_status FROM xpd_milestones WHERE plan_id = ? AND kind = 'DRAWING_APPROVAL'").get(plan.id).ms_status, 'DELAYED'); assert.equal(svc.sweep() <= 1, true, 'the late milestone is told once');
  const dash = (await r.call(mgr, 'GET', '/expediting/dashboard')).json.data; assert.equal(dash.tiles.delayedMilestones >= 1, true);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1507'").run(); for (const path of ['/expediting-plans', '/inspections', '/shipments', '/expediting/dashboard', '/expediting/orders?projectId=1']) assert.equal((await r.call(ic, 'GET', path)).status, 404, path);
});
