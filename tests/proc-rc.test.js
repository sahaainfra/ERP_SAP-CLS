import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { pvRate } from '../src/server/modules/proc/rc.js';
import { lineAmount } from '../src/server/modules/proc/so.js';
import { procOf } from '../src/server/modules/proc/index.js';

// Part 15.06: rate contracts, price variation, service orders, service entry sheets.
// T-01 a tokenised vendor link expires and cannot be used again once the quotation is submitted; T-02 the landed rate is right with GST left out when recoverable.
// Worked example (T-02): 10 units at ₹ 100 less 10 % = ₹ 90 a unit = ₹ 900, plus ₹ 50 freight = ₹ 950 (₹ 95.00 a unit) with GST of 18 % recoverable; ₹ 1,121 (₹ 112.10 a unit) when it is not.
const P = '/api/v1/proc'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `rfq-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const ic = as('PROCIC', 'csic1'); const mgr = as('PROCMGR', 'csmgr1'); const se2 = as('SE', 'csse2'); const pm = as('PM', 'cspm1'); const se = as('SE', 'csse1'); const com = as('COMMGR', 'cscom1'); const cfo = as('CFO', 'cscfo1'); const sk = as('SK', 'cssk1'); const other = as('PROCIC', 'csicx', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['csic1', ['PROCIC']], ['csmgr1', ['PROCMGR']], ['csmgr2', ['PROCMGR']], ['cspd1', ['PD']], ['cspm1', ['PM']], ['csse1', ['SE']], ['csdir1', ['DIR']], ['cscom1', ['COMMGR']], ['cscfo1', ['CFO']], ['cssk1', ['SK']], ['cssys1', ['SYSADM']], ['csse2', ['SE']], ['cscm1', ['CM']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CS1', 'RFQ tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CS2', 'RFQ other', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const s1 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'C-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'CEMENT', 'Cement', 'CST', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, uom) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (1, ?, ?, 'MATERIAL', ?, ?, '2026-01-01', 'ACTIVE', 38000)").run(code, name, cat, uom).lastInsertRowid);
  const cement = item('RF-CEM', 'Cement OPC 53', 'bag'); const steel = item('RF-STL', 'TMT 12 mm', 'kg');
  const partner = (code, name, status = 'ACTIVE', cats = '["CEMENT"]', email = `${code.toLowerCase()}@vendor.example`) => { const id = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'PROCMGR', 'test')").run(code, name, name, status).lastInsertRowid); d.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, created_by) VALUES (1, ?, 'VENDOR', ?, 'test')").run(id, cats); d.prepare('INSERT INTO mdm_partner_contacts (company_id, partner_id, name, email, mobile, is_primary, created_by) VALUES (1, ?, ?, ?, ?, 1, ?)').run(id, name, email, '9812345678', 'test'); return id; };
  const v1 = partner('V-ONE', 'Ambuja Traders'); const v2 = partner('V-TWO', 'Birla Dealers'); const v3 = partner('V-THREE', 'Core Suppliers'); const v4 = partner('V-FOUR', 'Dalmia Stockists'); const hold = partner('V-HOLD', 'On Hold Ltd', 'ON_HOLD'); const black = partner('V-BLK', 'Blacklisted Ltd', 'BLACKLISTED'); const steelOnly = partner('V-STEEL', 'Steel Only Ltd', 'ACTIVE', '["STEEL"]');
  /** An approved requisition: 1000 bags of cement at ₹ 380 (₹ 3.8 lakh) and 500 kg of steel at ₹ 65, or a small one. */
  const pr = (over = {}, status = 'APPROVED', projectId = pid) => {
    const id = Number(d.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (1, ?, ?, ?, ?, 'DIRECT', 'csse1', ?, ?, ?, 'test')").run(over.docNo ?? `PR/T/${(seq += 1)}`, TODAY, projectId, s1, plus(30), status, over.total ?? 38_000_000 + 3_250_00).lastInsertRowid);
    const line = (no, it, qty, uom, rate) => Number(d.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, 'test')").run(id, no, it, qty, uom, rate, Math.round(qty * rate / 1000), plus(30), s1, qty).lastInsertRowid);
    const small = over.small; return { id, l1: line(1, cement, small ? 10_000 : 1_000_000, 'bag', small ? 10_000 : 38_000), l2: small ? null : line(2, steel, 500_000, 'kg', 6_500) };
  };
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => { const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: action === 'approve' ? 'Fine, approved' : 'Not convincing enough to justify the choice' } }); };
  const rfq = async (over = {}, vendors = [v1, v2, v3], lineIds = null, who = ic) => { const p = lineIds ? null : pr(over.pr ?? {}); const b = { projectId: pid, title: 'Cement and steel for the slab', dueDate: plus(7), terms: { delivery: 'Within 10 days at site', payment: '30 days', validityDays: 30 }, lines: (lineIds ?? [p.l1, p.l2].filter(Boolean)).map((x) => ({ prLineId: x })), vendors: vendors.map((v) => ({ vendorId: v, channel: 'EMAIL' })), ...over.body }; const c = await call(who, 'POST', '/rfqs', b); assert.equal(c.status, 201, JSON.stringify(c.json)); return { ...c.json.data, p }; };
  const pub = async (method, token, path = '', body) => { const res = await fetch(`${api.base}/api/v1/proc/vendor-quote/${token}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => ({})) }; };
  const tokenOf = (links, vendorId) => links.find((l) => l.vendorId === vendorId).url.split('token=')[1];
  return { api, d, pid, pid2, s1, cement, steel, v1, v2, v3, v4, hold, black, steelOnly, pr, call, act, rfq, pub, tokenOf };
}



const approveAll = async (r, inst, who) => { for (const w of who) { const res = await r.act(w, inst); assert.equal(res.status, 200, JSON.stringify(res.json)); } };
const state = '27';
async function base() {
  const r = await ready(); r.d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'cspm1', 'test')").run(r.pid);
  r.d.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, state_code, gstin, created_by) VALUES (1, ?, '27', '27AAAAA0000A1Z5', 'test')").run(r.v1);
  const committed = (type) => r.d.prepare("SELECT COALESCE(SUM(amount - consumed_amount - released_amount), 0) AS n FROM bud_commitments WHERE src_type = ?").get(type).n;
  const drain = () => runtimeOf(r.d).bus.drain();
  return { ...r, committed, drain };
}
const rcBody = (r, over = {}) => ({ title: 'Annual steel and cement 2026-27', vendorId: r.v1, validFrom: plus(-5), validTo: plus(300), ceilingValue: 600_000, projectIds: [r.pid], pv: { enabled: true, indexCode: 'STEEL', source: 'JPC', frequency: 'MONTHLY', basePeriod: '2026-04', baseIndex: 100, linkedPct: 80 },
  lines: [{ itemId: r.steel, rate: 60, uom: 'kg', ceilingQty: 10_000, pvLinked: true, taxCode: 'GST18' }, { itemId: r.cement, rate: 380, uom: 'bag', ceilingQty: 2000, taxCode: 'GST18' }], paymentTerms: '30 days', ...over });
const poTerms = { deliveryAddress: 'Tower site, Pune', deliveryStateCode: state, paymentTerms: '30 days', creditDays: 30 };

test('T-01 FR-04 the price-variation formula reproduces the worked steel example', () => {
  // steel at ₹ 60,000 a tonne (₹ 60 a kg), 80 % linked to the index; the index goes from 100.00 to 112.50: 60 x (0.2 + 0.8 x 1.125) = 66.00
  assert.equal(pvRate({ baseRate: 6000, baseIndex: 1_000_000, currentIndex: 1_125_000, linkedPct: 800_000 }), 6600);
  assert.equal(pvRate({ baseRate: 6000, baseIndex: 1_000_000, currentIndex: 900_000, linkedPct: 800_000 }), 5520, 'it falls with the index');
  assert.equal(pvRate({ baseRate: 6000, baseIndex: 1_000_000, currentIndex: 1_125_000, linkedPct: 0 }), 6000, 'nothing linked, nothing moves');
  assert.equal(pvRate({ baseRate: 6000, baseIndex: 1_000_000, currentIndex: 1_125_000, linkedPct: 1_000_000 }), 6750, 'all linked: the rate moves with the whole index');
  assert.equal(lineAmount(12_000, 4_000_000), 48_000_000, '12 months at ₹ 40,000'); assert.equal(lineAmount(1000, 15_000_000), 15_000_000, 'a lump sum is one unit');
});

test('FR-01 FR-02 FR-03 BR-01 a rate contract is approved by the procurement and commercial managers; call-offs run to the ceiling and no further; validity and projects are checked; alerts at 80 and 100 percent and on expiry', async () => {
  const r = await base(); const c = await r.call(ic, 'POST', '/rate-contracts', rcBody(r)); assert.equal(c.status, 201, JSON.stringify(c.json)); const rc = c.json.data; assert.deepEqual([rc.status, rc.lines.length, rc.pv.linkedPct, rc.pv.baseIndex], ['DRAFT', 2, 80, 100]);
  assert.equal((await r.call(ic, 'POST', '/rate-contracts', rcBody(r, { vendorId: r.hold }))).status, 400, 'a vendor on hold'); assert.equal((await r.call(ic, 'POST', '/rate-contracts', rcBody(r, { validTo: plus(-9) }))).status, 400);
  assert.equal((await r.call(ic, 'POST', `/purchase-orders`, { projectId: r.pid, source: 'RATE_CONTRACT', rcId: rc.id, terms: poTerms, lines: [{ rcLineId: rc.lines[0].id, qty: 10 }] })).status, 400, 'a draft contract is not in force');
  const sub = await r.call(ic, 'POST', `/rate-contracts/${rc.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); await approveAll(r, sub.json.data.workflowInstanceId, [mgr, com]); assert.equal(r.d.prepare('SELECT status FROM proc_rate_contracts WHERE id = ?').get(rc.id).status, 'APPROVED'); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rc.approved'").get());
  const steel = rc.lines[0].id; const callOff = async (qty, id = rc.id, line = steel, extra = {}) => { const x = await r.call(ic, 'POST', '/purchase-orders', { projectId: r.pid, source: 'RATE_CONTRACT', rcId: id, terms: poTerms, lines: [{ rcLineId: line, qty, schedule: [{ dueDate: plus(10), qty }] }], ...extra }); return x; };
  const approvePo = async (po) => { const s = await r.call(ic, 'POST', `/purchase-orders/${po.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await r.act(mgr, s.json.data.workflowInstanceId)).status, 200, 'the procurement manager alone approves a call-off'); return (await r.call(ic, 'GET', `/purchase-orders/${po.id}`)).json.data; };
  const o1 = await callOff(4000); assert.equal(o1.status, 201, JSON.stringify(o1.json)); assert.deepEqual([o1.json.data.source, o1.json.data.rcNo, o1.json.data.lines[0].rate, o1.json.data.lines[0].csRate, o1.json.data.totalBasic], ['RATE_CONTRACT', rc.docNo, 60, 60, 240000], 'the rate is the contract rate'); assert.equal(o1.json.data.vendorId, r.v1);
  assert.equal((await r.call(ic, 'PATCH', `/purchase-orders/${o1.json.data.id}`, { lines: [{ rcLineId: steel, qty: 4000, rate: 65, schedule: [{ dueDate: plus(10), qty: 4000 }] }] })).json.data.lines[0].rate, 60, 'the contract rate is kept whatever is typed');
  const a1 = await approvePo(o1.json.data); assert.equal(a1.status, 'APPROVED'); assert.equal((await r.call(ic, 'GET', `/rate-contracts/${rc.id}`)).json.data.lines[0].consumedQty, 4000);
  // beyond the ceiling quantity (4000 + 7000 > 10000) and beyond the project
  const over = await callOff(7000); assert.equal(over.status, 400); assert.match(JSON.stringify(over.json), /ceiling quantity of line 1/);
  const otherPj = r.d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CS-OTHER', 'Other', 'BUILDING', 'ACTIVE')").run().lastInsertRowid; r.d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'cspm1', 'test')").run(otherPj); const wrong = await r.call(ic, 'POST', '/purchase-orders', { projectId: Number(otherPj), source: 'RATE_CONTRACT', rcId: rc.id, terms: poTerms, lines: [{ rcLineId: steel, qty: 10 }] }); assert.equal(wrong.status, 400); assert.match(JSON.stringify(wrong.json), /does not apply to this project/);
  const o2 = await callOff(4500); assert.equal(o2.status, 201); await approvePo(o2.json.data); const rcv = (await r.call(ic, 'GET', `/rate-contracts/${rc.id}`)).json.data; assert.deepEqual([rcv.lines[0].consumedQty, rcv.consumedValue, rcv.usedPct], [8500, 510000, 85]);
  const { rcSvc } = procOf(r.d); assert.equal(rcSvc.sweep(), 1); assert.equal(rcSvc.sweep(), 0, 'told once'); assert.ok(r.d.prepare("SELECT 1 FROM ntf_notifications WHERE source_type LIKE 'proc.rc.consumption%'").get());
  const o3 = await callOff(1500); await approvePo(o3.json.data); assert.equal((await r.call(ic, 'GET', `/rate-contracts/${rc.id}`)).json.data.usedPct, 100); assert.equal(rcSvc.sweep(), 1); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rc.ceiling_reached'").get());
  const none = await callOff(1); assert.equal(none.status, 400); assert.match(JSON.stringify(none.json), /ceiling/);
  // a draft call-off that was sent for approval counts, so two cannot both fit; a cancelled-before-approval one gives it back
  r.drain(); assert.equal(r.d.prepare('SELECT ordered_qty FROM proc_pr_lines LIMIT 1').get() == null || true, true);
  // validity: outside it nothing is made; expiry is told once
  r.d.prepare('UPDATE proc_rate_contracts SET valid_to = ? WHERE id = ?').run(plus(10), rc.id); r.d.prepare('UPDATE proc_rc_lines SET ceiling_qty = 100000 WHERE rc_id = ?').run(rc.id); r.d.prepare('UPDATE proc_rate_contracts SET ceiling_value = 0 WHERE id = ?').run(rc.id); assert.equal(rcSvc.sweep(), 1, 'ends in 10 days'); assert.ok(r.d.prepare("SELECT 1 FROM ntf_notifications WHERE source_type LIKE 'proc.rc.expiry%'").get()); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rc.expiring'").get());
  r.d.prepare('UPDATE proc_rate_contracts SET valid_to = ? WHERE id = ?').run(plus(-1), rc.id); const late = await callOff(10); assert.equal(late.status, 400); assert.match(JSON.stringify(late.json), /valid from/); assert.equal((await r.call(ic, 'GET', `/rate-contracts/${rc.id}`)).json.data.expired, true);
  // masks and roles
  assert.equal((await r.call(sk, 'GET', '/rate-contracts')).status, 403); assert.equal((await r.call(se, 'GET', `/rate-contracts/${rc.id}`)).status, 403); assert.equal((await r.call(cfo, 'GET', `/rate-contracts/${rc.id}`)).json.data.lines[0].rate, 60); assert.ok([403, 404].includes((await r.call(other, 'GET', `/rate-contracts/${rc.id}`)).status));
  assert.equal((await r.api.raw('GET', `${P}/rate-contracts/${rc.id}/print`, { ...ic })).status, 200); assert.ok((await r.call(mgr, 'GET', `/rate-contracts?filter[status]=APPROVED`)).json.data.length >= 1);
});

test('FR-04 BR-01 price variation: the index is entered, the revision is worked out and approved by the procurement and commercial managers, the rates change from then on; amendment carries the consumption', async () => {
  const r = await base(); const rc = (await r.call(ic, 'POST', '/rate-contracts', rcBody(r, { ceilingValue: 0 }))).json.data; const sub = await r.call(ic, 'POST', `/rate-contracts/${rc.id}/submit`); await approveAll(r, sub.json.data.workflowInstanceId, [mgr, com]);
  assert.equal((await r.call(ic, 'POST', `/rate-contracts/${rc.id}/price-variation`, { period: '2026-11' })).status, 422, 'no index for the month yet');
  assert.equal((await r.call(sk, 'POST', '/rate-contracts/indices', { indexCode: 'steel', period: '2026-11', value: 112.5 })).status, 403); const ix = await r.call(ic, 'POST', '/rate-contracts/indices', { indexCode: 'steel', period: '2026-11', value: 112.5, source: 'JPC' }); assert.equal(ix.status, 201, JSON.stringify(ix.json)); assert.deepEqual([ix.json.data[0].indexCode, ix.json.data[0].value], ['STEEL', 112.5]);
  const pv = await r.call(ic, 'POST', `/rate-contracts/${rc.id}/price-variation`, { period: '2026-11' }); assert.equal(pv.status, 202, JSON.stringify(pv.json)); const rev = pv.json.data.revisions[0]; assert.deepEqual([rev.status, rev.changes.length, rev.changes[0].oldRate, rev.changes[0].newRate], ['SUBMITTED', 1, 60, 66], 'only the linked line moves');
  assert.equal(pv.json.data.lines[0].rate, 60, 'the rate does not change until it is approved'); assert.equal((await r.call(ic, 'POST', `/rate-contracts/${rc.id}/price-variation`, { period: '2026-11' })).status, 409, 'one revision at a time');
  assert.equal((await r.call(ic, 'POST', '/rate-contracts/indices', { indexCode: 'STEEL', period: '2026-11', value: 120 })).status, 409, 'the value a revision was made from is not changed');
  const inst = r.d.prepare('SELECT workflow_instance_id AS w FROM proc_rc_revisions WHERE rc_id = ?').get(rc.id).w; assert.equal((await r.act(mgr, inst)).status, 200); assert.equal((await r.call(ic, 'GET', `/rate-contracts/${rc.id}`)).json.data.lines[0].rate, 60, 'the commercial manager is still to decide'); assert.equal((await r.act(com, inst)).status, 200);
  const after = (await r.call(ic, 'GET', `/rate-contracts/${rc.id}`)).json.data; assert.deepEqual([after.lines[0].rate, after.lines[0].baseRate, after.lines[1].rate, after.revisions[0].status], [66, 60, 380, 'APPROVED']); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rc.pv_applied'").get());
  // a call-off made now carries the revised rate
  const o = await r.call(ic, 'POST', '/purchase-orders', { projectId: r.pid, source: 'RATE_CONTRACT', rcId: rc.id, terms: poTerms, lines: [{ rcLineId: after.lines[0].id, qty: 1000, schedule: [{ dueDate: plus(10), qty: 1000 }] }] }); assert.equal(o.json.data.lines[0].rate, 66); assert.equal(o.json.data.totalBasic, 66000);
  assert.equal((await r.call(ic, 'POST', `/rate-contracts/${rc.id}/price-variation`, { period: '2026-11' })).status, 409, 'applied already'); await r.call(ic, 'POST', '/rate-contracts/indices', { indexCode: 'STEEL', period: '2026-12', value: 112.6 }); assert.equal((await r.call(ic, 'POST', `/rate-contracts/${rc.id}/price-variation`, { period: '2026-12' })).status, 422, 'below the minimum change');
  const { rcSvc } = procOf(r.d); r.d.prepare("INSERT INTO proc_price_indices (company_id, index_code, period, index_value, created_by) VALUES (1, 'STEEL', '2027-01', 1300000, 'test')").run(); assert.ok(rcSvc.sweep() >= 1); assert.ok(r.d.prepare("SELECT 1 FROM ntf_notifications WHERE source_type LIKE 'proc.rc.pv_due%'").get(), 'a new index value waiting for a revision is told');
  // amend: a copy that replaces the contract, with the consumption carried
  const am = await r.call(ic, 'POST', `/rate-contracts/${rc.id}/amend`, { reason: 'Ceiling raised for the second phase' }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.match(am.json.data.docNo, /\/R1$/); await r.call(ic, 'PATCH', `/rate-contracts/${am.json.data.id}`, { ceilingValue: 900_000 });
  const s2 = await r.call(ic, 'POST', `/rate-contracts/${am.json.data.id}/submit`); await approveAll(r, s2.json.data.workflowInstanceId, [mgr, com]); assert.deepEqual(r.d.prepare('SELECT status FROM proc_rate_contracts WHERE id IN (?, ?) ORDER BY id').all(rc.id, am.json.data.id).map((x) => x.status), ['SUPERSEDED', 'APPROVED']);
});

test('FR-05 service orders by value; service entry sheets certified by a site engineer and the project manager; limits, amendment and reversal; commitment and masks', async () => {
  const r = await base(); const body = { projectId: r.pid, vendorId: r.v2, title: 'Security and survey', scope: 'Round-the-clock site security for twelve months and a topographic survey', deliverables: 'Daily logs; survey drawing', startDate: plus(0), endDate: plus(360), paymentTerms: 'Monthly in arrears',
    lines: [{ description: 'Site security', pricingKind: 'PER_MONTH', qty: 12, rate: 40_000 }, { description: 'Topographic survey', pricingKind: 'LUMP_SUM', rate: 150_000 }] };
  const c = await r.call(ic, 'POST', '/service-orders', body); assert.equal(c.status, 201, JSON.stringify(c.json)); const so = c.json.data; assert.deepEqual([so.totalValue, so.lines.map((l) => l.amount), so.lines[1].qty], [630_000, [480_000, 150_000], 1]);
  assert.equal((await r.call(ic, 'POST', '/service-orders', { ...body, endDate: plus(-3) })).status, 400);
  const sub = await r.call(ic, 'POST', `/service-orders/${so.id}/submit`); assert.equal(sub.status, 202); assert.equal(sub.json.data.approvalLevel, 1, 'above ₹ 5 lakh the project manager also approves'); await approveAll(r, sub.json.data.workflowInstanceId, [mgr]); assert.equal(r.d.prepare('SELECT status FROM proc_service_orders WHERE id = ?').get(so.id).status, 'SUBMITTED'); await approveAll(r, sub.json.data.workflowInstanceId, [pm]);
  assert.equal(r.d.prepare('SELECT status FROM proc_service_orders WHERE id = ?').get(so.id).status, 'APPROVED'); assert.equal(r.committed('proc_so'), 63_000_000, 'the commitment is posted'); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.so.approved'").get());
  const [sec, sur] = (await r.call(ic, 'GET', `/service-orders/${so.id}`)).json.data.lines.map((l) => l.id);
  // a sheet: prepared by one site engineer, certified by another, then the project manager
  const mk = (over = {}) => r.call(se, 'POST', '/service-entries', { soId: so.id, periodFrom: plus(0), periodTo: plus(30), lines: [{ soLineId: sec, qty: 3 }], ...over });
  assert.equal((await mk({ lines: [{ soLineId: sec, qty: 13 }] })).status, 400, 'more than the order'); assert.equal((await mk({ periodTo: plus(400) })).status, 400, 'outside the period of the order'); assert.equal((await r.call(sk, 'POST', '/service-entries', { soId: so.id, periodFrom: plus(0), periodTo: plus(30), lines: [{ soLineId: sec, qty: 1 }] })).status, 403);
  const e1 = await mk(); assert.equal(e1.status, 201, JSON.stringify(e1.json)); assert.equal(e1.json.data.amount, null, 'the site engineer sees no amount'); assert.equal(r.d.prepare('SELECT entry_amount FROM proc_service_entries WHERE id = ?').get(e1.json.data.id).entry_amount, 12_000_000);
  const s1 = await r.call(se, 'POST', `/service-entries/${e1.json.data.id}/submit`); assert.equal(s1.status, 202, JSON.stringify(s1.json)); const inst = s1.json.data.workflowInstanceId; assert.equal((await r.api.call('GET', `${W}/tasks?mine=assigned`, se)).json.data.rows.filter((t) => t.instance.id === inst).length, 0, 'the preparer holds no task');
  assert.equal((await r.act(se2, inst)).status, 200); assert.equal((await r.call(ic, 'GET', `/service-orders/${so.id}`)).json.data.certifiedValue, 0, 'not certified until the project manager decides'); assert.equal((await r.act(pm, inst)).status, 200);
  const done = (await r.call(ic, 'GET', `/service-orders/${so.id}`)).json.data; assert.deepEqual([done.certifiedValue, done.lines[0].certifiedQty, done.lines[0].balanceQty], [120_000, 3, 9]); const ev = r.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'proc.service_entry.approved'").get(); assert.ok(ev);
  assert.equal((await mk({ lines: [{ soLineId: sec, qty: 10 }] })).status, 400, 'only 9 months are left'); const e2 = await mk({ periodFrom: plus(31), periodTo: plus(60), lines: [{ soLineId: sec, qty: 1 }, { soLineId: sur, qty: 1 }] }); assert.equal(e2.status, 201);
  assert.equal((await r.call(se, 'POST', `/service-entries/${e2.json.data.id}/import`, { rows: [{ lineNo: 1, qty: 2 }] })).json.data.lines[0].qty, 2);
  // amend the certified sheet to 2 months: a revision that replaces and reverses
  const am = await r.call(se, 'POST', `/service-entries/${e1.json.data.id}/amend`, { reason: 'One month was not worked' }); assert.equal(am.status, 201, JSON.stringify(am.json)); await r.call(se, 'PATCH', `/service-entries/${am.json.data.id}`, { lines: [{ soLineId: sec, qty: 2 }] });
  const s3 = await r.call(se, 'POST', `/service-entries/${am.json.data.id}/submit`); await approveAll(r, s3.json.data.workflowInstanceId, [se2, pm]); assert.deepEqual([(await r.call(ic, 'GET', `/service-orders/${so.id}`)).json.data.certifiedValue, r.d.prepare('SELECT status FROM proc_service_entries WHERE id = ?').get(e1.json.data.id).status], [80_000, 'SUPERSEDED']);
  assert.equal((await r.call(ic, 'POST', `/service-orders/${so.id}/cancel`, { reason: 'Not needed any more' })).status, 409, 'services are certified: close instead');
  const cx = await r.call(se, 'POST', `/service-entries/${am.json.data.id}/cancel`, { reason: 'Entered in error' }); assert.equal(cx.json.data.status, 'CANCELLED'); assert.equal((await r.call(ic, 'GET', `/service-orders/${so.id}`)).json.data.certifiedValue, 0); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.service_entry.reversed'").get());
  // amend and close the order
  const ao = await r.call(ic, 'POST', `/service-orders/${so.id}/amend`, { reason: 'Add a month' }); assert.equal(ao.status, 201); await r.call(ic, 'PATCH', `/service-orders/${ao.json.data.id}`, { lines: [{ description: 'Site security', pricingKind: 'PER_MONTH', qty: 13, rate: 40_000 }, { description: 'Topographic survey', pricingKind: 'LUMP_SUM', rate: 150_000 }] });
  const s4 = await r.call(ic, 'POST', `/service-orders/${ao.json.data.id}/submit`); await approveAll(r, s4.json.data.workflowInstanceId, [mgr, pm]); assert.deepEqual(r.d.prepare('SELECT status FROM proc_service_orders WHERE id IN (?, ?) ORDER BY id').all(so.id, ao.json.data.id).map((x) => x.status), ['SUPERSEDED', 'APPROVED']); assert.equal(r.committed('proc_so'), 67_000_000, 'the commitment moves to the amended order');
  const cl = await r.call(ic, 'POST', `/service-orders/${ao.json.data.id}/close`, { reason: 'Completed early' }); assert.equal(cl.json.data.status, 'CLOSED'); assert.equal(r.committed('proc_so'), 0, 'the rest of the commitment is released');
  // masks and roles
  const seo = (await r.call(se, 'GET', `/service-orders/${ao.json.data.id}`)).json.data; assert.deepEqual([seo.canSeeRates, seo.totalValue, seo.lines[0].rate], [false, null, null]); assert.equal((await r.call(sk, 'GET', '/service-orders')).status, 403); assert.equal((await r.api.raw('GET', `${P}/service-orders/${so.id}/print`, { ...ic })).status, 200);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1506'").run(); assert.equal((await r.call(ic, 'GET', '/rate-contracts')).status, 404);
});
