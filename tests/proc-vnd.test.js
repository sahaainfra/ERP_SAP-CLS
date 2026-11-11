import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { compose, metricsFromEvidence, periodRange, previousQuarter, questionnaireScore, ratingOf, resultOf } from '../src/server/modules/proc/vnd.js';

// Part 15.08: vendor prequalification, approved vendor list, scorecards.
// T-01 a scorecard value can be reproduced from the evidence records kept with it.
const P = '/api/v1/proc'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `vnd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const ic = as('PROCIC', 'vic1'); const mgr = as('PROCMGR', 'vmgr1'); const qcm = as('QCMGR', 'vqcm1'); const dir = as('DIR', 'vdir1'); const pm = as('PM', 'vpm1'); const sk = as('SK', 'vsk1'); const hse = as('HSEO', 'vhse1'); const other = as('PROCMGR', 'vmgrx', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ANS = (n) => ['FINANCIALS', 'EXPERIENCE', 'CAPACITY', 'CERTIFICATIONS', 'REFERENCES'].map((section) => ({ section, score: n }));

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['vic1', ['PROCIC']], ['vmgr1', ['PROCMGR']], ['vmgr2', ['PROCMGR']], ['vqcm1', ['QCMGR']], ['vdir1', ['DIR']], ['vcom1', ['COMMGR']], ['vpm1', ['PM']], ['vsk1', ['SK']], ['vhse1', ['HSEO']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const cat = (code, name) => Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, ?, ?, ?, '[]', '[]', 'PROCMGR', 'ACTIVE')").run(code, name, code.slice(0, 3)).lastInsertRowid);
  const cement = cat('CEMENT', 'Cement'); const steel = cat('STEEL', 'Steel'); const item = (code, c) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE')").run(code, code, c).lastInsertRowid);
  const iCement = item('V-CEM', cement); const iSteel = item('V-STL', steel);
  const vendor = (code, name, status = 'ACTIVE') => { const id = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'PROCMGR', 'test')").run(code, name, name, status).lastInsertRowid); d.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, regions_json, created_by) VALUES (1, ?, 'VENDOR', '[]', '[]', 'test')").run(id); return id; };
  const v1 = vendor('VN-1', 'Ambuja Traders'); const v2 = vendor('VN-2', 'Birla Dealers'); const v3 = vendor('VN-3', 'Core Suppliers');
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'VN1', 'Vendor tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid); const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'VN-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => { const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: action === 'approve' ? 'Fine, approved' : 'Please correct this and send again' } }); };
  /** A requisition line and an RFQ on it for an item with the estimate given (rupees). */
  const rfq = (itemId, est) => { const prId = Number(d.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (1, ?, ?, ?, ?, 'DIRECT', 'vic1', ?, 'APPROVED', 0, 'test')").run(`PR/V/${(seq += 1)}`, TODAY, pid, site, plus(30)).lastInsertRowid);
    const pl = Number(d.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (1, ?, 1, ?, 1000000, 'bag', 100, 100, 'MANUAL', ?, ?, 1000000, 'test')").run(prId, itemId, plus(30), site).lastInsertRowid);
    const id = Number(d.prepare("INSERT INTO proc_rfqs (company_id, doc_no, doc_date, org_project_id, title, due_date, requested_by, status, est_total, created_by) VALUES (1, ?, ?, ?, 'T', ?, 'vic1', 'DRAFT', ?, 'test')").run(`RFQ/V/${(seq += 1)}`, TODAY, pid, plus(10), est * 100).lastInsertRowid); d.prepare("INSERT INTO proc_rfq_lines (company_id, rfq_id, line_no, pr_line_id, item_id, qty, uom, created_by) VALUES (1, ?, 1, ?, ?, 1000, 'bag', 'test')").run(id, pl, itemId); return d.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(id); };
  const gate = async (vendorId, rfqRow) => { const { procOf } = await import('../src/server/modules/proc/index.js'); const b = procOf(d).base; return b.gates.map((g) => g(1, vendorId, rfqRow)).find(Boolean) ?? null; };
  const preq = async (partnerId, over = {}, who = ic) => call(who, 'POST', '/prequalifications', { partnerId, categoryIds: [cement], answers: ANS(80), validUntil: plus(365), ...over });
  const approvedPreq = async (partnerId, over = {}, chain = [mgr, qcm]) => { const c = await preq(partnerId, over); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await call(ic, 'POST', `/prequalifications/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); for (const w of chain) assert.equal((await act(w, s.json.data.workflowInstanceId)).status, 200); return (await call(ic, 'GET', `/prequalifications/${c.json.data.id}`)).json.data; };
  const drain = () => runtimeOf(d).bus.drain(); const events = (type) => d.prepare('SELECT payload FROM core_outbox WHERE event_type = ? ORDER BY id').all(type).map((x) => { const j = JSON.parse(x.payload); return j.data ?? j; });
  return { api, d, pid, site, cement, steel, iCement, iSteel, v1, v2, v3, call, act, rfq, gate, preq, approvedPreq, drain, events };
}

test('the questionnaire, the result, the weighted total and the rating are worked out one way', () => {
  assert.equal(questionnaireScore(ANS(80)), 800000); assert.equal(questionnaireScore([{ section: 'FINANCIALS', score: 100 }, { section: 'EXPERIENCE', score: 0 }]), 500000, 'weights 25 and 25 over the sections scored');
  assert.deepEqual([70, 50, 49].map((n) => resultOf(n * 10000, { qualify: 70, conditional: 50 })), ['QUALIFIED', 'CONDITIONAL', 'NOT_QUALIFIED']);
  const w = { onTime: 25, quality: 25, price: 20, response: 10, safety: 10, invoice: 10 };
  assert.equal(compose({ onTime: 900000, quality: 1000000, price: 500000, response: 800000, safety: 700000, invoice: 600000 }, w), 785000, 'weights 25 25 20 10 10 10');
});

test('a metric with no evidence leaves its weight out; the rating bands; periods; evidence gives back the metrics (T-01 by hand)', () => {
  const w = { onTime: 25, quality: 25, price: 20, response: 10, safety: 10, invoice: 10 }; assert.equal(compose({ onTime: 800000, quality: 1000000, price: null, response: null, safety: null, invoice: null }, w), 900000); assert.equal(compose({ onTime: null, quality: null, price: null, response: null, safety: null, invoice: null }, w), null);
  assert.deepEqual([860000, 700000, 560000, 100000, null].map((t) => ratingOf(t, { a: 85, b: 70, c: 55 })), ['A', 'B', 'C', 'D', 'NA']);
  assert.deepEqual(periodRange('2026-Q3'), { from: '2026-07-01', to: '2026-09-30' }); assert.deepEqual(periodRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' }); assert.equal(periodRange('2026-Q5'), null); assert.equal(previousQuarter('2026-01-15'), '2025-Q4'); assert.equal(previousQuarter('2026-11-12'), '2026-Q3');
  const ev = { delivery: { receipts: [{ onTime: true }, { onTime: true }, { onTime: false }, { onTime: true }] }, quality: { receipts: [{ qty: 100, accepted: 100 }, { qty: 100, accepted: 90 }], input: null }, price: { lines: [{ rank: 1, n: 3 }, { rank: 2, n: 3 }, { rank: 3, n: 3 }, { rank: 1, n: 1 }] }, response: { invited: 4, answered: 3, avgHours: 24 }, safety: { value: 900000 }, invoice: null };
  assert.deepEqual(metricsFromEvidence(ev), { onTime: 750000, quality: 950000, price: 500000, response: 825000, safety: 900000, invoice: null });
  assert.equal(metricsFromEvidence({ ...ev, response: { invited: 4, answered: 4, avgHours: 168 } }).response, 700000, 'a slow answer loses the speed part');
});

test('FR-01 FR-02 a prequalification is scored, approved by procurement and quality (and the direction when strategic) and puts the vendor on the list per category and region', async () => {
  const r = await ready(); const c = await r.preq(r.v1, { regions: ['WEST', 'SOUTH'] }); assert.equal(c.status, 201, JSON.stringify(c.json)); const q = c.json.data;
  assert.deepEqual([q.score, q.result, q.status], [800000, 'QUALIFIED', 'DRAFT']); assert.equal((await r.preq(r.v1)).status, 409, 'one open prequalification per vendor');
  assert.equal((await r.call(pm, 'POST', '/prequalifications', { partnerId: r.v2, categoryIds: [r.cement] })).status, 403); assert.equal((await r.call(sk, 'GET', '/prequalifications')).status, 403); assert.equal((await r.call(other, 'GET', `/prequalifications/${q.id}`)).status, 404, 'another company');
  assert.equal((await r.preq(r.v2, { categoryIds: [999999] })).status, 400); const part = await r.preq(r.v3, { answers: [{ section: 'FINANCIALS', score: 90 }] }); assert.equal((await r.call(ic, 'POST', `/prequalifications/${part.json.data.id}/submit`)).status, 400, 'all sections must be scored');
  const low = await r.preq(r.v2, { answers: ANS(40) }); assert.equal(low.json.data.result, 'NOT_QUALIFIED'); assert.equal((await r.call(ic, 'POST', `/prequalifications/${low.json.data.id}/submit`)).status, 422, 'below the level for approval'); for (const x of [low, part]) assert.equal((await r.call(ic, 'POST', `/prequalifications/${x.json.data.id}/cancel`, { reason: 'Not pursued now' })).status, 200);
  const s = await r.call(ic, 'POST', `/prequalifications/${q.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await r.call(ic, 'PATCH', `/prequalifications/${q.id}`, { validUntil: plus(10) })).status, 409);
  assert.equal((await r.act(mgr, s.json.data.workflowInstanceId)).status, 200); assert.equal((await r.call(ic, 'GET', `/prequalifications/${q.id}`)).json.data.status, 'SUBMITTED'); assert.equal((await r.act(qcm, s.json.data.workflowInstanceId)).status, 200);
  const a = (await r.call(ic, 'GET', `/prequalifications/${q.id}`)).json.data; assert.deepEqual([a.status, a.avl.length, a.avl.map((e) => e.region).sort()], ['APPROVED', 2, ['SOUTH', 'WEST']]); assert.equal(a.avl[0].status, 'APPROVED'); await r.drain(); assert.equal(r.events('proc.vendor.avl_updated').length, 1);
  const list = await r.call(pm, 'GET', '/avl'); assert.equal(list.status, 200); assert.equal(list.json.data.length, 2); assert.equal((await r.call(pm, 'GET', `/avl/check?partnerId=${r.v1}&categoryId=${r.cement}&region=WEST`)).json.data.allowed, true); assert.equal((await r.call(pm, 'GET', `/avl/check?partnerId=${r.v1}&categoryId=${r.cement}&region=NORTH`)).json.data.allowed, false);
  // strategic: the direction too, a visit report is needed, a conditional result gives a conditional entry
  assert.equal((await r.preq(r.v2, { strategic: true })).status, 201); const sid = (await r.d.prepare("SELECT id FROM vnd_prequalifications WHERE partner_id = ? AND status = 'DRAFT'").all(r.v2)).at(-1).id; assert.equal((await r.call(ic, 'POST', `/prequalifications/${sid}/submit`)).status, 400, 'strategic needs the visit');
  assert.equal((await r.call(ic, 'PATCH', `/prequalifications/${sid}`, { visitDate: plus(-2), visitNotes: 'Works visited: capacity confirmed', answers: ANS(60), conditions: 'Third-party testing of each lot' })).status, 200);
  const s2 = await r.call(ic, 'POST', `/prequalifications/${sid}/submit`); assert.equal(s2.status, 202, JSON.stringify(s2.json)); for (const w of [mgr, qcm]) assert.equal((await r.act(w, s2.json.data.workflowInstanceId)).status, 200); assert.equal((await r.call(ic, 'GET', `/prequalifications/${sid}`)).json.data.status, 'SUBMITTED', 'the direction is still to approve'); assert.equal((await r.act(dir, s2.json.data.workflowInstanceId)).status, 200);
  const e2 = (await r.call(ic, 'GET', '/avl?filter[avlStatus]=CONDITIONAL')).json.data; assert.equal(e2.length, 1); assert.equal(e2[0].vendor, 'Birla Dealers');
  const am = await r.call(ic, 'POST', `/prequalifications/${q.id}/amend`, { reason: 'Annual re-evaluation' }); assert.equal(am.status, 201); const s3 = await r.call(ic, 'POST', `/prequalifications/${am.json.data.id}/submit`); for (const w of [mgr, qcm]) await r.act(w, s3.json.data.workflowInstanceId); assert.equal((await r.call(ic, 'GET', `/prequalifications/${q.id}`)).json.data.status, 'SUPERSEDED');
  assert.equal((await r.call(ic, 'GET', `/prequalifications/${q.id}/print`)).status, 200); assert.ok((await r.call(ic, 'GET', `/prequalifications/${q.id}/history`)).json.data.approvals.length > 0);
});

test('BR-01 an RFQ above the threshold goes only to vendors on the list for its category; a suspended vendor is not sent one at all', async () => {
  const r = await ready(); await r.approvedPreq(r.v1); const big = r.rfq(r.iCement, 800000); const small = r.rfq(r.iCement, 100000); const steel = r.rfq(r.iSteel, 800000);
  assert.equal(await r.gate(r.v1, big), null, 'on the list'); assert.match(await r.gate(r.v2, big), /approved vendor list/, 'not on the list above the value'); assert.equal(await r.gate(r.v2, small), null, 'below the value anyone active may be asked'); assert.match(await r.gate(r.v1, steel), /approved vendor list/, 'on the list for another category only');
  r.d.prepare("UPDATE vnd_avl SET valid_until = ? WHERE partner_id = ?").run(plus(-1), r.v1); assert.match(await r.gate(r.v1, big), /approved vendor list/, 'an expired approval does not count');
  r.d.prepare("UPDATE vnd_avl SET valid_until = ?, avl_status = 'SUSPENDED' WHERE partner_id = ?").run(plus(300), r.v1); assert.match(await r.gate(r.v1, small), /Suspended/, 'suspended, whatever the value');
  // through the API: issuing the RFQ refuses the vendor
  r.d.prepare("INSERT INTO proc_rfq_vendors (company_id, rfq_id, vendor_id, created_by) VALUES (1, ?, ?, 'test')").run(big.id, r.v2); r.d.prepare("UPDATE proc_rfqs SET status = 'DRAFT' WHERE id = ?").run(big.id);
  const res = await r.call(ic, 'POST', `/rfqs/${big.id}/issue`); assert.ok([403, 404, 422].includes(res.status), `${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
});

test('T-01 FR-03 the scorecard is worked out from receipts, RFQ answers and inputs, keeps its evidence, and the same figures come back from that evidence', async () => {
  const r = await ready(); const d = r.d; await r.approvedPreq(r.v1);
  const po = Number(d.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by, created_by) VALUES (1, 'PO/V/1', ?, ?, ?, 'APPROVED', 'vic1', 'test')").run(TODAY, r.pid, r.v1).lastInsertRowid); const line = Number(d.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, balance_qty, created_by) VALUES (1, ?, 1, ?, 'Cement', 5000000, 'bag', 5000000, 'test')").run(po, r.iCement).lastInsertRowid);
  const q = previousQuarter(TODAY); const { from } = periodRange(q); const rc = (grn, qty, acc, onTime, day) => d.prepare("INSERT INTO proc_po_receipts (company_id, po_id, po_line_id, grn_ref, received_on, qty, accepted_qty, on_time, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'test')").run(po, line, grn, day, qty, acc, onTime);
  rc('G1', 1000000, 1000000, 1, from); rc('G2', 1000000, 900000, 1, from); rc('G3', 1000000, 1000000, 0, from); rc('G4', 1000000, 1000000, 1, from);
  const rv = (status, hrs) => d.prepare("INSERT INTO proc_rfq_vendors (company_id, rfq_id, vendor_id, response_status, sent_at, responded_at, created_by) VALUES (1, ?, ?, ?, ?, ?, 'test')").run(r.rfq(r.iCement, 100000).id, r.v1, status, `${from}T06:00:00.000Z`, hrs == null ? null : new Date(Date.parse(`${from}T06:00:00.000Z`) + hrs * 3_600_000).toISOString()); rv('RESPONDED', 24); rv('INVITED', null);
  assert.equal((await r.call(hse, 'POST', '/vendor-scorecards/inputs', { partnerId: r.v1, period: q, kind: 'SAFETY', value: 90, note: 'No incident' })).status, 201); assert.equal((await r.call(ic, 'POST', '/vendor-scorecards/inputs', { partnerId: r.v1, period: q, kind: 'SAFETY', value: 90 })).status, 403, 'procurement does not enter safety');
  assert.equal((await r.call(hse, 'POST', '/vendor-scorecards/inputs', { partnerId: r.v1, period: q, kind: 'SAFETY', value: 120 })).status, 400);
  assert.equal((await r.call(sk, 'POST', '/vendor-scorecards/compute', { partnerId: r.v1, period: q })).status, 403); const c = await r.call(mgr, 'POST', '/vendor-scorecards/compute', { partnerId: r.v1, period: q }); assert.equal(c.status, 200, JSON.stringify(c.json)); const s = c.json.data;
  assert.deepEqual(s.metrics, { onTime: 750000, quality: 975000, price: null, response: 650000, safety: 900000, invoice: null });
  // the stored figures equal what the evidence gives, and the total is the weighted composition
  assert.deepEqual(metricsFromEvidence(s.evidence), s.metrics); assert.equal(compose(metricsFromEvidence(s.evidence), s.weights), s.total); assert.equal(ratingOf(s.total, { a: 85, b: 70, c: 55 }), s.rating); assert.equal(s.evidence.delivery.receipts.length, 4, 'every receipt is named'); assert.equal(s.evidence.safety.value, 900000);
  const again = (await r.call(mgr, 'POST', '/vendor-scorecards/compute', { partnerId: r.v1, period: q })).json.data; assert.equal(again.id, s.id, 'one scorecard a period'); const card = (await r.call(pm, 'GET', `/vendor-scorecards/partner/${r.v1}`)).json.data; assert.equal(card.scorecards.length, 1); assert.equal(card.inputs.length, 1);
  const rk = (await r.call(pm, 'GET', `/vendor-ranking?categoryId=${r.cement}&period=${q}`)).json.data; assert.deepEqual([rk.rows.length, rk.rows[0].rank, rk.rows[0].vendor], [1, 1, 'Ambuja Traders']); assert.equal((await r.call(pm, 'GET', '/vendor-ranking')).json.data.categories.length, 2);
  assert.equal((await r.call(pm, 'GET', '/vendor-scorecards')).json.data.length, 1); assert.equal((await r.call(other, 'GET', `/vendor-scorecards/${s.id}`)).status, 404, 'another company');
});

test('FR-05 a low score suggests a suspension; people approve it (procurement, then the direction) and the vendor is then suspended; actions and corrective requests', async () => {
  const r = await ready(); const d = r.d; await r.approvedPreq(r.v1); const q = previousQuarter(TODAY);
  assert.equal((await r.call(hse, 'POST', '/vendor-scorecards/inputs', { partnerId: r.v1, period: q, kind: 'SAFETY', value: 20 })).status, 201); const sc = (await r.call(mgr, 'POST', '/vendor-scorecards/compute', { partnerId: r.v1, period: q })).json.data;
  assert.equal(sc.rating, 'D'); assert.ok(sc.suggestionId, 'a suspension is suggested'); const sg = (await r.call(mgr, 'GET', `/avl-suspensions/${sc.suggestionId}`)).json.data; assert.deepEqual([sg.autoSuggested, sg.status, sg.requestedBy], [true, 'DRAFT', 'system']);
  assert.equal((await r.call(mgr, 'POST', '/avl-suspensions', { partnerId: r.v1, reason: 'Another reason' })).status, 409, 'one open suspension'); assert.equal((await r.call(pm, 'POST', `/avl-suspensions/${sg.id}/submit`)).status, 403);
  const s = await r.call(ic, 'POST', `/avl-suspensions/${sg.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await r.act(mgr, s.json.data.workflowInstanceId)).status, 200); assert.equal((await r.call(mgr, 'GET', '/avl?filter[avlStatus]=SUSPENDED')).json.data.length, 0, 'not yet'); assert.equal((await r.act(dir, s.json.data.workflowInstanceId)).status, 200);
  assert.equal((await r.call(mgr, 'GET', '/avl?filter[avlStatus]=SUSPENDED')).json.data.length, 1); await r.drain(); assert.equal(r.events('proc.vendor.suspended').length, 1); assert.match(await r.gate(r.v1, r.rfq(r.iCement, 100000)), /Suspended/);
  // reinstatement is by a new approved prequalification
  const back = await r.approvedPreq(r.v1); assert.equal(back.avl[0].status, 'APPROVED'); assert.equal(await r.gate(r.v1, r.rfq(r.iCement, 100000)), null);
  // actions
  assert.equal((await r.call(mgr, 'POST', '/vendor-actions', { partnerId: r.v1, kind: 'CAR', title: 'Late deliveries' })).status, 400, 'a request needs a due date'); const car = await r.call(mgr, 'POST', '/vendor-actions', { partnerId: r.v1, scorecardId: sc.id, kind: 'CAR', title: 'Late deliveries in the quarter', owner: 'vic1', dueDate: plus(14) }); assert.equal(car.status, 201, JSON.stringify(car.json));
  assert.equal((await r.call(mgr, 'POST', `/vendor-actions/${car.json.data.id}/close`, {})).status, 422, 'closed after the vendor answered'); assert.equal((await r.call(ic, 'POST', `/vendor-actions/${car.json.data.id}/respond`, { response: 'Dispatch planning changed' })).json.data.status, 'RESPONDED'); assert.equal((await r.call(mgr, 'POST', `/vendor-actions/${car.json.data.id}/close`, { note: 'Accepted' })).json.data.status, 'CLOSED');
  assert.equal((await r.call(sk, 'POST', '/vendor-actions', { partnerId: r.v1, kind: 'REVIEW', title: 'x yz' })).status, 403); void d;
});

test('FR-05 the daily check reminds procurement once of an entry that ends soon and works out last quarter', async () => {
  const r = await ready(); await r.approvedPreq(r.v1, { validUntil: plus(30) }); const { createVndService } = await import('../src/server/modules/proc/vnd.js'); const { createBase } = await import('../src/server/modules/proc/base.js'); const svc = createVndService({ db: r.d, base: createBase({ db: r.d }) });
  const n1 = svc.sweep(); assert.ok(n1 >= 1); assert.ok(r.d.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'proc.vnd.reeval'").get() ?? r.d.prepare("SELECT 1 FROM vnd_avl WHERE reminded_for IS NOT NULL").get()); assert.equal(r.d.prepare('SELECT reminded_for FROM vnd_avl').get().reminded_for, plus(30)); svc.sweep();
  assert.equal(r.d.prepare('SELECT COUNT(*) AS n FROM vnd_scorecards').get().n, 1, 'last quarter once'); r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1508'").run(); for (const path of ['/prequalifications', '/avl', '/vendor-scorecards', '/vendor-ranking']) assert.equal((await r.call(ic, 'GET', path)).status, 404, path);
});
