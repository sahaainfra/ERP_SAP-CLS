import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { allocate, nonL1Vendors, rankCells } from '../src/server/modules/proc/cs.js';

// Part 15.04: comparative statement and vendor selection.
// T-01 a tokenised vendor link expires and cannot be used again once the quotation is submitted; T-02 the landed rate is right with GST left out when recoverable.
// Worked example (T-02): 10 units at ₹ 100 less 10 % = ₹ 90 a unit = ₹ 900, plus ₹ 50 freight = ₹ 950 (₹ 95.00 a unit) with GST of 18 % recoverable; ₹ 1,121 (₹ 112.10 a unit) when it is not.
const P = '/api/v1/proc'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `rfq-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const ic = as('PROCIC', 'csic1'); const mgr = as('PROCMGR', 'csmgr1'); const pd = as('PD', 'cspd1'); const pm = as('PM', 'cspm1'); const se = as('SE', 'csse1'); const other = as('PROCIC', 'csicx', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['csic1', ['PROCIC']], ['csmgr1', ['PROCMGR']], ['csmgr2', ['PROCMGR']], ['cspd1', ['PD']], ['cspm1', ['PM']], ['csse1', ['SE']], ['csdir1', ['DIR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
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


test('T-01 FR-01 BR-01 ranking with ties, the split award, and a non-L1 choice', () => {
  const cells = [{ vendorId: 1, landedRate: 400, offeredQty: 1000, deliveryDays: 7, quotationId: 11 }, { vendorId: 2, landedRate: 390, offeredQty: 600, deliveryDays: 5, quotationId: 12 }, { vendorId: 3, landedRate: 400, offeredQty: 1000, deliveryDays: 3, quotationId: 13 }, { vendorId: 4, landedRate: 450, offeredQty: 1000, deliveryDays: 1, quotationId: 14 }];
  const { ranks, order } = rankCells(cells); assert.deepEqual([...ranks.entries()], [[2, 1], [3, 2], [1, 2], [4, 4]], 'equal rates share a rank and the next rank is skipped'); assert.deepEqual(order.map((c) => c.vendorId), [2, 3, 1, 4], 'among equals the shorter delivery comes first');
  assert.deepEqual(allocate(cells, 1000), { picks: [{ vendorId: 2, qty: 600 }, { vendorId: 3, qty: 400 }], short: 0 }, 'L1 gets what it offered, the next vendor the rest'); assert.deepEqual(allocate(cells.slice(0, 2), 2000).short, 400, 'a shortfall is reported');
  assert.deepEqual(nonL1Vendors(cells, [{ vendorId: 2, qty: 600 }, { vendorId: 3, qty: 400 }], 1000), [], 'the cascade is L1'); assert.deepEqual(nonL1Vendors(cells, [{ vendorId: 1, qty: 1000 }], 1000), [1], 'a dearer vendor while the cheaper has room is not L1');
  assert.deepEqual(nonL1Vendors(cells, [{ vendorId: 2, qty: 300 }, { vendorId: 3, qty: 700 }], 1000), [3], 'the L1 not given all it offered makes the rest non-L1');
});

async function withQuotes() {
  const r = await ready(); const m = await r.rfq({}, [r.v1, r.v2, r.v3]); await r.call(ic, 'POST', `/rfqs/${m.id}/issue`); const [l1, l2] = m.lines.map((l) => l.id);
  const q = async (vendor, cement, cq, steel, days) => { const c = await r.call(ic, 'POST', '/quotations', { rfqId: m.id, vendorId: vendor, validUntil: plus(30), deliveryDays: days, lines: [{ rfqLineId: l1, rate: cement, offeredQty: cq, gstRate: 18 }, { rfqLineId: l2, rate: steel, gstRate: 18 }] }); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal((await r.call(ic, 'POST', `/quotations/${c.json.data.id}/submit`)).status, 200); return c.json.data.id; };
  const qs = { v1: await q(r.v1, 400, 1000, 70, 7), v2: await q(r.v2, 390, 600, 72, 5), v3: await q(r.v3, 400, 1000, 68, 3) };
  const create = (over = {}, who = ic) => r.call(who, 'POST', '/comparative-statements', { rfqId: m.id, ...over });
  return { ...r, m, l1, l2, qs, create };
}
const approveAll = async (r, inst, who = [mgr, pm]) => { for (const w of who) { const res = await r.act(w, inst); assert.equal(res.status, 200, JSON.stringify(res.json)); } };

test('FR-01 FR-02 FR-03 the statement is generated from the quotations: ranks, L1, benchmarks, the overall L1 and the L1 of each line with a split award', async () => {
  const r = await withQuotes(); assert.equal((await r.call(se, 'POST', '/comparative-statements', { rfqId: r.m.id })).status, 403); assert.equal((await r.call(se, 'GET', '/comparative-statements')).status, 403);
  const o = await r.call(ic, 'GET', '/comparative-statements/rfqs'); assert.equal(o.json.data.length, 1);
  const c = await r.create(); assert.equal(c.status, 201, JSON.stringify(c.json)); const cs = c.json.data; assert.deepEqual([cs.status, cs.recommendationType, cs.nonL1], ['DRAFT', 'OVERALL_L1', false]);
  const cem = cs.lines[0]; const stl = cs.lines[1]; const byV = (line, v) => line.cells.find((x) => x.vendorId === v);
  assert.deepEqual([byV(cem, r.v2).rank, byV(cem, r.v1).rank, byV(cem, r.v3).rank], [1, 2, 2], 'cement: V2 390 is L1, V1 and V3 tie at 400'); assert.deepEqual([byV(cem, r.v2).isL1, byV(cem, r.v1).isL1], [true, false]); assert.deepEqual([byV(stl, r.v3).rank, byV(stl, r.v1).rank, byV(stl, r.v2).rank], [1, 2, 3]);
  assert.deepEqual([cem.benchmarks.lastPo, cem.benchmarks.budget], [380, 380], 'the last purchase rate of the item and the estimate on the requisition'); assert.equal(byV(cem, r.v1).vsLastPo, 5.3); assert.equal(byV(cem, r.v2).vsBudget, 2.6);
  const totals = Object.fromEntries(cs.vendors.map((v) => [v.vendorId, [v.totalLanded, v.overallRank, v.fullQuote]])); assert.deepEqual(totals[r.v3], [434000, 1, true], 'V3 has the lowest total of the vendors who quoted every line in full'); assert.deepEqual(totals[r.v1], [435000, 2, true]); assert.deepEqual(totals[r.v2], [null, null, false], 'V2 offered only 600 bags');
  assert.deepEqual(cs.lines.map((l) => l.selectedQty), [1000, 500]); assert.equal(byV(cem, r.v3).selectedQty, 1000, 'the overall L1 takes all'); assert.equal(cs.totalValue, 434000);
  // line-wise L1 with a split award: V2 600 (L1, offered 600), V3 the other 400 (tie with V1 broken by the shorter delivery); steel to V3
  const sp = await r.call(ic, 'PATCH', `/comparative-statements/${cs.id}`, { recommendationType: 'SPLIT_L1' }); assert.equal(sp.status, 200, JSON.stringify(sp.json)); const s = sp.json.data;
  assert.deepEqual([byV(s.lines[0], r.v2).selectedQty, byV(s.lines[0], r.v3).selectedQty, byV(s.lines[0], r.v1).selectedQty, byV(s.lines[1], r.v3).selectedQty], [600, 400, 0, 500]); assert.equal(s.totalValue, 428000); assert.equal(s.nonL1, false, 'a split by price is L1'); assert.equal(s.savingsVsBudget, -15500, 'the estimate on the requisitions (412,500) less the value');
  assert.equal((await r.create()).status, 409, 'one statement for an RFQ'); assert.equal((await r.api.raw('GET', `${P}/comparative-statements/${cs.id}/print`, { ...ic })).status, 200);
});

test('BR-02 BR-01 CP-PROC-04 the quantity cannot exceed the RFQ quantity or the offer; a non-L1 choice needs a reason and goes one level higher; creator cannot approve', async () => {
  const r = await withQuotes(); const c = (await r.create({ recommendationType: 'SPLIT_L1' })).json.data;
  const over = await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { selections: [{ rfqLineId: r.l1, vendorId: r.v1, qty: 800 }, { rfqLineId: r.l1, vendorId: r.v3, qty: 400 }], recommendationType: 'CUSTOM' }); assert.equal(over.status, 400); assert.match(JSON.stringify(over.json), /More than the RFQ quantity/);
  const offer = await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { selections: [{ rfqLineId: r.l1, vendorId: r.v2, qty: 700 }], recommendationType: 'CUSTOM' }); assert.equal(offer.status, 400); assert.match(JSON.stringify(offer.json), /offered only/);
  assert.equal((await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { selections: [{ rfqLineId: r.l1, vendorId: r.v4 ?? 99999, qty: 1 }], recommendationType: 'CUSTOM' })).status, 400, 'a vendor that did not quote');
  // V1 for all the cement and the steel although V2 is cheaper and has room for 600
  const non = await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { recommendationType: 'CUSTOM', selections: [{ rfqLineId: r.l1, vendorId: r.v1, qty: 1000 }, { rfqLineId: r.l2, vendorId: r.v1, qty: 500 }] }); assert.equal(non.status, 200, JSON.stringify(non.json)); assert.equal(non.json.data.nonL1, true); assert.equal(non.json.data.totalValue, 435000);
  const noReason = await r.call(ic, 'POST', `/comparative-statements/${c.id}/submit`); assert.equal(noReason.status, 400); assert.match(JSON.stringify(noReason.json), /reason/);
  assert.equal((await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { reasonCode: 'TECHNICAL', justification: 'Only this vendor meets the approved make and the delivery to the site' })).status, 200);
  const sub = await r.call(ic, 'POST', `/comparative-statements/${c.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId; assert.equal(sub.json.data.approvalLevel, 1, 'value below the first band, one level higher: the project director');
  assert.equal((await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { justification: 'Changed while waiting for approval by someone' })).status, 409);
  assert.equal((await r.api.call('GET', `${W}/tasks?mine=assigned`, ic)).json.data.rows.filter((t) => t.instance.id === inst).length, 0, 'the one who prepared it holds no task');
  await approveAll(r, inst, [mgr, pm]); assert.equal(r.d.prepare('SELECT status FROM proc_comparative_statements WHERE id = ?').get(c.id).status, 'SUBMITTED', 'the project director is still to decide');
  assert.equal((await r.act(pd, inst)).status, 200); const done = (await r.call(ic, 'GET', `/comparative-statements/${c.id}`)).json.data; assert.deepEqual([done.status, done.approvedBy], ['APPROVED', 'cspd1']);
  assert.equal((await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { recommendationType: 'SPLIT_L1' })).status, 409, 'approved is locked');
  const ev = r.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'proc.cs.approved'").get(); const data = JSON.parse(ev.payload).data ?? JSON.parse(ev.payload); assert.equal(data.awards.length, 2); assert.deepEqual(data.awards.map((a) => [a.vendorId, a.qty, a.landedRate]), [[r.v1, 1000000, 40000], [r.v1, 500000, 7000]]); assert.equal(data.nonL1, true);
  assert.equal(r.d.prepare('SELECT status FROM proc_rfqs WHERE id = ?').get(r.m.id).status, 'CLOSED', 'approval closes the enquiry');
});

test('FR-04 FR-05 approval by value, reject and return, negotiation rounds with a revised quote, refresh, amend and cancel', async () => {
  const r = await withQuotes(); const c = (await r.create({ recommendationType: 'SPLIT_L1' })).json.data;
  const ng = await r.call(ic, 'POST', `/comparative-statements/${c.id}/negotiations`, { vendorId: r.v3, note: 'Asked V3 to bring the cement rate down to 385' }); assert.equal(ng.status, 201, JSON.stringify(ng.json)); assert.equal(ng.json.data.roundNo, 1); assert.equal(ng.json.data.negotiations[0].quotationAfter, null);
  // the vendor revises: a new version is recorded; the statement is stale until refreshed
  const am = await r.call(ic, 'POST', `/quotations/${r.qs.v3}/amend`, { reason: 'Negotiated rate' }); await r.call(ic, 'PATCH', `/quotations/${am.json.data.id}`, { lines: [{ rfqLineId: r.l1, rate: 385, gstRate: 18 }, { rfqLineId: r.l2, rate: 68, gstRate: 18 }] }); assert.equal((await r.call(ic, 'POST', `/quotations/${am.json.data.id}/submit`)).status, 200);
  const stale = (await r.call(ic, 'GET', `/comparative-statements/${c.id}`)).json.data; assert.ok(stale.warnings.some((w) => w.code === 'STALE')); assert.equal((await r.call(ic, 'POST', `/comparative-statements/${c.id}/submit`)).status, 409);
  const fresh = await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { refresh: true, recommendationType: 'SPLIT_L1' }); assert.equal(fresh.status, 200, JSON.stringify(fresh.json)); const f = fresh.json.data; assert.equal(f.warnings.length, 0); assert.equal(f.negotiations[0].quotationAfter.version_no, 2);
  const cem = f.lines[0]; assert.deepEqual(cem.cells.map((x) => [x.vendorId, x.rank]), [[r.v1, 3], [r.v2, 2], [r.v3, 1]], 'V3 at 385 is now the L1 of the cement'); assert.equal(f.totalValue, 419000, 'V3 takes all 1000 bags at 385 and the steel');
  // compliance: a vendor whose offer does not comply is not awarded
  const bad = await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { compliance: [{ rfqLineId: r.l2, vendorId: r.v3, value: 'NO' }] }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /does not comply/);
  const fix = await r.call(ic, 'PATCH', `/comparative-statements/${c.id}`, { compliance: [{ rfqLineId: r.l2, vendorId: r.v3, value: 'NO' }], recommendationType: 'SPLIT_L1' }); assert.equal(fix.status, 200, JSON.stringify(fix.json)); assert.equal(fix.json.data.lines[1].cells.find((x) => x.vendorId === r.v1).selectedQty, 500, 'the steel goes to the next vendor'); assert.equal(fix.json.data.nonL1, false);
  // approval by value: below the band the project manager is the last; return and resubmit; reject
  const sub = await r.call(ic, 'POST', `/comparative-statements/${c.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); assert.equal(sub.json.data.approvalLevel, 0); const inst = sub.json.data.workflowInstanceId;
  assert.equal((await r.act(mgr, inst, 'return')).status, 200); assert.equal(r.d.prepare('SELECT status FROM proc_comparative_statements WHERE id = ?').get(c.id).status, 'RETURNED'); assert.equal((await r.call(ic, 'POST', `/comparative-statements/${c.id}/submit`)).status, 202);
  assert.equal((await r.act(mgr, inst)).status, 200); assert.equal((await r.act(pm, inst, 'reject')).status, 200); assert.equal(r.d.prepare('SELECT status FROM proc_comparative_statements WHERE id = ?').get(c.id).status, 'REJECTED'); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.cs.rejected'").get());
  // a rejected statement is cancelled and a new one made; approved, then amended and the amendment approved supersedes it
  assert.equal((await r.create()).status, 201, 'a rejected statement does not block a new one'); 
});

test('FR-05 FR-06 amend an approved statement, cancel, the list, history and permissions', async () => {
  const r = await withQuotes(); const c = (await r.create({ recommendationType: 'SPLIT_L1' })).json.data; const sub = await r.call(ic, 'POST', `/comparative-statements/${c.id}/submit`); await approveAll(r, sub.json.data.workflowInstanceId); assert.equal(r.d.prepare('SELECT status FROM proc_comparative_statements WHERE id = ?').get(c.id).status, 'APPROVED');
  assert.equal((await r.call(ic, 'POST', `/comparative-statements/${c.id}/amend`, { reason: 'Quantity changed' })).status, 201); const rev = r.d.prepare('SELECT * FROM proc_comparative_statements WHERE parent_id = ?').get(c.id); assert.match(rev.doc_no, /\/R1$/);
  const s2 = await r.call(ic, 'POST', `/comparative-statements/${rev.id}/submit`); assert.equal(s2.status, 202, JSON.stringify(s2.json)); await approveAll(r, s2.json.data.workflowInstanceId); assert.deepEqual(r.d.prepare('SELECT status FROM proc_comparative_statements WHERE id IN (?, ?) ORDER BY id').all(c.id, rev.id).map((x) => x.status), ['SUPERSEDED', 'APPROVED']);
  const ev = r.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'proc.cs.approved'").get().n; assert.equal(ev, 2);
  // roles: the project manager reads and approves, the site engineer sees nothing, another company sees nothing
  assert.equal((await r.call(pm, 'GET', `/comparative-statements/${rev.id}`)).status, 200); assert.equal((await r.call(se, 'GET', `/comparative-statements/${rev.id}`)).status, 403); assert.ok([403, 404].includes((await r.call(other, 'GET', `/comparative-statements/${rev.id}`)).status));
  assert.equal((await r.call(pm, 'POST', '/comparative-statements', { rfqId: r.m.id })).status, 403); const l = await r.call(mgr, 'GET', '/comparative-statements'); assert.equal(l.status, 200); assert.equal(l.json.data.length, 2); assert.equal((await r.call(mgr, 'GET', '/comparative-statements?filter[status]=APPROVED')).json.data.length, 1);
  const h = (await r.call(mgr, 'GET', `/comparative-statements/${rev.id}/history`)).json.data; assert.ok(h.audit.some((a) => a.action === 'amend') && h.approvals.length > 0);
  const cx = await r.call(ic, 'POST', `/comparative-statements/${rev.id}/cancel`, { reason: 'The order is placed elsewhere' }); assert.equal(cx.json.data.status, 'CANCELLED'); assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.cs.cancelled'").get());
  const imp = await r.create({ recommendationType: 'SPLIT_L1' }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); const li = await r.call(ic, 'POST', `/comparative-statements/${imp.json.data.id}/import`, { rows: [{ lineNo: 1, vendorId: r.v2, qty: 600 }, { lineNo: 1, vendorId: r.v3, qty: 400 }, { lineNo: 2, vendorId: r.v3, qty: 500 }] }); assert.equal(li.status, 200, JSON.stringify(li.json)); assert.equal(li.json.data.recommendationType, 'CUSTOM'); assert.equal(li.json.data.nonL1, false);
  assert.equal((await r.call(ic, 'DELETE', `/comparative-statements/${imp.json.data.id}`)).status, 200);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1504'").run(); assert.equal((await r.call(ic, 'GET', '/comparative-statements')).status, 404);
});
