import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { landed } from '../src/server/modules/proc/rfq.js';

// Part 15.03: RFQ and vendor quotations.
// T-01 a tokenised vendor link expires and cannot be used again once the quotation is submitted; T-02 the landed rate is right with GST left out when recoverable.
// Worked example (T-02): 10 units at ₹ 100 less 10 % = ₹ 90 a unit = ₹ 900, plus ₹ 50 freight = ₹ 950 (₹ 95.00 a unit) with GST of 18 % recoverable; ₹ 1,121 (₹ 112.10 a unit) when it is not.
const P = '/api/v1/proc'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `rfq-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const ic = as('PROCIC', 'rfic1'); const mgr = as('PROCMGR', 'rfmgr1'); const pd = as('PD', 'rfpd1'); const pm = as('PM', 'rfpm1'); const se = as('SE', 'rfse1'); const dir = as('DIR', 'rfdir1'); const other = as('PROCIC', 'rficx', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test('T-02 FR-05 the landed rate: the discount, the charges, GST left out when recoverable and brought back when not, a rate that includes GST', () => {
  const base = { rate: 10000, discountPct: 100000, gstRate: 180000, freight: 5000, qty: 10000 };
  assert.deepEqual(landed({ ...base, recoverable: true }), { landedAmount: 95000, landedRate: 9500 });
  assert.deepEqual(landed({ ...base, recoverable: false }), { landedAmount: 112100, landedRate: 11210 });
  assert.deepEqual(landed({ rate: 11800, gstRate: 180000, inclusive: true, qty: 10000, recoverable: true }), { landedAmount: 100000, landedRate: 10000 }, 'a rate that includes GST is brought back to its basic value');
  assert.deepEqual(landed({ rate: 11800, gstRate: 180000, inclusive: true, qty: 10000, recoverable: false }), { landedAmount: 118000, landedRate: 11800 });
  assert.deepEqual(landed({ rate: 10000, loading: 1000, other: 2500, qty: 5000, recoverable: true }), { landedAmount: 53500, landedRate: 10700 }, 'loading and other charges are line totals');
  assert.deepEqual(landed({ rate: 0, qty: 0 }), { landedAmount: 0, landedRate: 0 });
});

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['rfic1', ['PROCIC']], ['rfmgr1', ['PROCMGR']], ['rfmgr2', ['PROCMGR']], ['rfpd1', ['PD']], ['rfpm1', ['PM']], ['rfse1', ['SE']], ['rfdir1', ['DIR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'RFQ1', 'RFQ tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'RFQ2', 'RFQ other', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const s1 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'R-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'CEMENT', 'Cement', 'CMT', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, uom) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (1, ?, ?, 'MATERIAL', ?, ?, '2026-01-01', 'ACTIVE', 38000)").run(code, name, cat, uom).lastInsertRowid);
  const cement = item('RF-CEM', 'Cement OPC 53', 'bag'); const steel = item('RF-STL', 'TMT 12 mm', 'kg');
  const partner = (code, name, status = 'ACTIVE', cats = '["CEMENT"]', email = `${code.toLowerCase()}@vendor.example`) => { const id = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'PROCMGR', 'test')").run(code, name, name, status).lastInsertRowid); d.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, created_by) VALUES (1, ?, 'VENDOR', ?, 'test')").run(id, cats); d.prepare('INSERT INTO mdm_partner_contacts (company_id, partner_id, name, email, mobile, is_primary, created_by) VALUES (1, ?, ?, ?, ?, 1, ?)').run(id, name, email, '9812345678', 'test'); return id; };
  const v1 = partner('V-ONE', 'Ambuja Traders'); const v2 = partner('V-TWO', 'Birla Dealers'); const v3 = partner('V-THREE', 'Core Suppliers'); const v4 = partner('V-FOUR', 'Dalmia Stockists'); const hold = partner('V-HOLD', 'On Hold Ltd', 'ON_HOLD'); const black = partner('V-BLK', 'Blacklisted Ltd', 'BLACKLISTED'); const steelOnly = partner('V-STEEL', 'Steel Only Ltd', 'ACTIVE', '["STEEL"]');
  /** An approved requisition: 1000 bags of cement at ₹ 380 (₹ 3.8 lakh) and 500 kg of steel at ₹ 65, or a small one. */
  const pr = (over = {}, status = 'APPROVED', projectId = pid) => {
    const id = Number(d.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (1, ?, ?, ?, ?, 'DIRECT', 'rfse1', ?, ?, ?, 'test')").run(over.docNo ?? `PR/T/${(seq += 1)}`, TODAY, projectId, s1, plus(30), status, over.total ?? 38_000_000 + 3_250_00).lastInsertRowid);
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
const quoteBody = (r, lines, over = {}) => ({ rfqId: r.id, vendorId: r.v1, quoteRef: 'AMB/26/01', validUntil: plus(30), deliveryDays: 7, paymentTerms: '30 days', lines, ...over });

test('FR-01 FR-02 an RFQ is made from approved requisition lines of one or many requisitions; only active vendors of the master are chosen; draft requisitions and other projects are refused', async () => {
  const r = await ready(); const o = (await r.call(ic, 'GET', `/rfqs/options?projectId=${r.pid}`)).json.data; assert.equal(o.minVendors, 3); assert.equal(o.requisitionLines.length, 0);
  const a = r.pr({ small: false }); const b = r.pr({ small: true }); r.pr({ small: true }, 'DRAFT'); r.pr({ small: true }, 'APPROVED', r.pid2);
  const o2 = (await r.call(ic, 'GET', `/rfqs/options?projectId=${r.pid}&prLineIds=${a.l1}`)).json.data; assert.deepEqual(o2.requisitionLines.map((l) => l.id).sort(), [a.l1, a.l2, b.l1].sort(), 'only approved requisitions of the project');
  const byName = Object.fromEntries(o2.vendors.map((v) => [v.code, v])); assert.equal(byName['V-ONE'].match, 'CATEGORY'); assert.equal(byName['V-STEEL'].match, null, 'a steel vendor does not match a cement line'); assert.equal(byName['V-HOLD'].eligible, false); assert.match(byName['V-BLK'].excludedReason, /Blacklisted/);
  const made = await r.rfq({}, [r.v1, r.v2, r.v3], [a.l1, a.l2, b.l1]); assert.equal(made.status, 'DRAFT'); assert.equal(made.lines.length, 3); assert.deepEqual([...new Set(made.lines.map((l) => l.prNo))].length, 2, 'two requisitions on one RFQ'); assert.equal(made.estTotal, 380000 + 32500 + 1000, 'the estimate is from the requisition lines');
  assert.equal(made.needsJustification, false); assert.deepEqual([made.vendorCount, made.minVendors], [3, 3]);
  const draftPr = r.d.prepare("SELECT l.id FROM proc_pr_lines l JOIN proc_requisitions q ON q.id = l.pr_id WHERE q.status = 'DRAFT'").get().id; const bad = await r.call(ic, 'POST', '/rfqs', { projectId: r.pid, title: 'Not approved', dueDate: plus(5), lines: [{ prLineId: draftPr }], vendors: [] }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /not approved|not a line/);
  const foreign = r.d.prepare("SELECT l.id FROM proc_pr_lines l JOIN proc_requisitions q ON q.id = l.pr_id WHERE q.org_project_id = ?").get(r.pid2).id; assert.equal((await r.call(ic, 'POST', '/rfqs', { projectId: r.pid, title: 'Wrong project', dueDate: plus(5), lines: [{ prLineId: foreign }], vendors: [] })).status, 400);
  assert.equal((await r.call(ic, 'POST', '/rfqs', { projectId: r.pid, title: 'Too much', dueDate: plus(5), lines: [{ prLineId: b.l1, qty: 11 }], vendors: [] })).status, 400, 'no more than the balance of the line');
  const hv = await r.call(ic, 'POST', '/rfqs', { projectId: r.pid, title: 'Held vendor', dueDate: plus(5), lines: [{ prLineId: b.l1 }], vendors: [{ vendorId: r.hold }, { vendorId: r.black }] }); assert.equal(hv.status, 400); assert.match(JSON.stringify(hv.json), /On hold/); assert.match(JSON.stringify(hv.json), /Blacklisted/);
  assert.equal((await r.call(se, 'POST', '/rfqs', { projectId: r.pid, title: 'Site engineer', dueDate: plus(5), lines: [{ prLineId: b.l1 }], vendors: [] })).status, 403); assert.equal((await r.call(se, 'GET', '/rfqs')).status, 403);
  assert.ok([403, 404].includes((await r.call(other, 'GET', `/rfqs/${made.id}`)).status), 'another company sees nothing');
});

test('BR-01 CP-PROC-03 above the threshold fewer than three vendors cannot be issued; the single-source justification goes to the procurement manager and then the project director; below the threshold it needs none', async () => {
  const r = await ready(); const m = await r.rfq({}, [r.v1]); assert.equal(m.needsJustification, true); assert.equal(m.can.submit, true);
  const iss = await r.call(ic, 'POST', `/rfqs/${m.id}/issue`); assert.ok([403, 409, 422].includes(iss.status), `blocked: ${iss.status} ${JSON.stringify(iss.json)}`); assert.equal(r.d.prepare('SELECT status FROM proc_rfqs WHERE id = ?').get(m.id).status, 'DRAFT');
  const noReason = await r.call(ic, 'POST', `/rfqs/${m.id}/submit`); assert.equal(noReason.status, 400, JSON.stringify(noReason.json));
  assert.equal((await r.call(ic, 'PATCH', `/rfqs/${m.id}`, { justification: 'Only one approved maker supplies the OPC 53 grade the design asks for' })).status, 200);
  const sub = await r.call(ic, 'POST', `/rfqs/${m.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); assert.equal(sub.json.data.status, 'SUBMITTED'); const inst = sub.json.data.workflowInstanceId;
  assert.equal((await r.call(ic, 'PATCH', `/rfqs/${m.id}`, { title: 'Changed while waiting' })).status, 409);
  assert.equal((await r.act(mgr, inst)).status, 200); assert.equal(r.d.prepare('SELECT status FROM proc_rfqs WHERE id = ?').get(m.id).status, 'SUBMITTED', 'the project director is still to decide');
  assert.equal((await r.act(pd, inst)).status, 200); const g = (await r.call(ic, 'GET', `/rfqs/${m.id}`)).json.data; assert.deepEqual([g.status, g.justified, g.needsJustification], ['DRAFT', true, false]);
  const ok = await r.call(ic, 'POST', `/rfqs/${m.id}/issue`); assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.data.rfq.status, 'ISSUED');
  // a rejection returns it; changing the vendors afterwards drops the approval
  const m2 = await r.rfq({}, [r.v1, r.v2]); await r.call(ic, 'PATCH', `/rfqs/${m2.id}`, { justification: 'Two vendors only: the others do not stock this grade' }); const s2 = await r.call(ic, 'POST', `/rfqs/${m2.id}/submit`); assert.equal((await r.act(mgr, s2.json.data.workflowInstanceId, 'reject')).status, 200); assert.equal(r.d.prepare('SELECT status FROM proc_rfqs WHERE id = ?').get(m2.id).status, 'RETURNED');
  // below the threshold: no minimum, and a justification is refused as unnecessary
  const small = await r.rfq({ pr: { small: true } }, [r.v1]); assert.equal(small.needsJustification, false); assert.equal((await r.call(ic, 'POST', `/rfqs/${small.id}/submit`)).status, 422); assert.equal((await r.call(ic, 'POST', `/rfqs/${small.id}/issue`)).status, 200);
});

test('FR-03 issuing sends to each vendor with a link of its own; only the hash is kept; a channel that is not set up is recorded and the buyer gets the link', async () => {
  const r = await ready(); const m = await r.rfq({}, [r.v1, r.v2, r.v3]); const ir = await r.call(ic, 'POST', `/rfqs/${m.id}/issue`); assert.equal(ir.status, 200, JSON.stringify(ir.json)); const iss = ir.json.data;
  assert.equal(iss.rfq.status, 'ISSUED'); assert.equal(iss.links.length, 3); const toks = iss.links.map((l) => l.url.split('token=')[1]); assert.equal(new Set(toks).size, 3); assert.ok(toks.every((t) => t.length >= 30));
  assert.deepEqual([...new Set(iss.links.map((l) => l.sendStatus))], ['QUEUED'], 'sent through the gateway'); const stored = r.d.prepare('SELECT token_hash FROM proc_rfq_vendors WHERE rfq_id = ?').all(m.id); assert.ok(stored.every((s) => s.token_hash && !toks.includes(s.token_hash)), 'the token itself is not stored');
  assert.equal(JSON.stringify((await r.call(ic, 'GET', `/rfqs/${m.id}`)).json).includes(toks[0]), false, 'the link is not in the RFQ any more');
  assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rfq.issued'").get()); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM comm_messages WHERE related_entity = 'proc_rfq' AND channel = 'EMAIL'").get().n, 3, 'one e-mail to each vendor');
  assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM comm_messages WHERE body_redacted LIKE ?").get(`%${toks[0]}%`).n, 0, 'the stored message does not keep the token');
  assert.equal((await r.call(ic, 'PATCH', `/rfqs/${m.id}`, { title: 'Changed title' })).status, 409, 'an issued RFQ is amended, not edited');
  const pdf = await r.api.raw('GET', `${P}/rfqs/${m.id}/print`, { ...ic }); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
});

test('T-01 FR-03 the vendor link: opens the RFQ without sign-in, shows no estimate, takes one quotation, then stops working until the buyer issues a new link; it expires; a closed RFQ refuses it', async () => {
  const r = await ready(); const m = await r.rfq({}, [r.v1, r.v2, r.v3]); const { links } = (await r.call(ic, 'POST', `/rfqs/${m.id}/issue`)).json.data; const t1 = r.tokenOf(links, r.v1); const t2 = r.tokenOf(links, r.v2); const t3 = r.tokenOf(links, r.v3);
  assert.equal((await r.pub('GET', 'x'.repeat(5))).status, 404); assert.equal((await r.pub('GET', 'A'.repeat(32))).status, 404, 'an unknown link');
  const info = await r.pub('GET', t1); assert.equal(info.status, 200, JSON.stringify(info.json)); assert.equal(info.json.data.vendor, 'Ambuja Traders'); assert.equal(info.json.data.lines.length, 2); assert.equal(JSON.stringify(info.json).includes('estRate'), false, 'the vendor sees no estimate'); assert.equal(JSON.stringify(info.json).includes('Birla'), false, 'no other vendor is named');
  assert.equal(r.d.prepare('SELECT response_status FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ?').get(m.id, r.v1).response_status, 'VIEWED');
  const lineIds = info.json.data.lines.map((l) => l.id); const body = { quoteRef: 'AMB/1', validUntil: plus(30), deliveryDays: 5, paymentTerms: '45 days', lines: lineIds.map((id) => ({ rfqLineId: id, rate: 380, gstRate: 18, freight: 2000 })) };
  const bad = await r.pub('POST', t1, '/submit', { ...body, lines: [{ rfqLineId: 999999, rate: 1 }] }); assert.equal(bad.status, 400); assert.equal((await r.pub('POST', t1, '/submit', { ...body, validUntil: plus(-1) })).status, 400);
  const done = await r.pub('POST', t1, '/submit', body); assert.equal(done.status, 201, JSON.stringify(done.json)); assert.equal(done.json.data.versionNo, 1);
  const again = await r.pub('GET', t1); assert.equal(again.status, 410); assert.match(again.json.error?.message ?? JSON.stringify(again.json), /already sent/); assert.equal((await r.pub('POST', t1, '/submit', body)).status, 410, 'the link cannot be used twice');
  const q = r.d.prepare('SELECT * FROM proc_quotations WHERE rfq_id = ?').get(m.id); assert.deepEqual([q.status, q.entered_via, q.entered_by, q.version_no], ['RECEIVED', 'PORTAL', 'vendor:V-ONE', 1]); assert.equal(r.d.prepare('SELECT response_status FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ?').get(m.id, r.v1).response_status, 'RESPONDED');
  // a vendor revises: the buyer issues a new link; the old one stays dead; the new quotation supersedes the first
  const re = await r.call(ic, 'POST', `/rfqs/${m.id}/reissue`, { vendorId: r.v1 }); assert.equal(re.status, 200, JSON.stringify(re.json)); const t1b = re.json.data.url.split('token=')[1]; assert.equal((await r.pub('GET', t1)).status, 404, 'the old link is gone'); assert.equal((await r.pub('GET', t1b)).json.data.revising, true);
  assert.equal((await r.pub('POST', t1b, '/submit', { ...body, lines: lineIds.map((id) => ({ rfqLineId: id, rate: 370, gstRate: 18, freight: 2000 })) })).json.data.versionNo, 2); assert.deepEqual(r.d.prepare('SELECT version_no, status FROM proc_quotations WHERE rfq_id = ? ORDER BY version_no').all(m.id).map((x) => [x.version_no, x.status]), [[1, 'SUPERSEDED'], [2, 'RECEIVED']]);
  // expiry: the link works until the due date plus the grace days; after that it is gone
  r.d.prepare('UPDATE proc_rfq_vendors SET token_expires = ? WHERE rfq_id = ? AND vendor_id = ?').run(new Date(Date.now() - 1000).toISOString(), m.id, r.v2); const exp = await r.pub('GET', t2); assert.equal(exp.status, 410); assert.match(JSON.stringify(exp.json), /expired/); assert.equal((await r.pub('POST', t2, '/submit', body)).status, 410);
  // a vendor declines; a question is asked and answered to all
  assert.equal((await r.pub('POST', t3, '/decline', { reason: 'Out of stock' })).status, 200); assert.equal(r.d.prepare('SELECT response_status FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ?').get(m.id, r.v3).response_status, 'DECLINED');
  // a closed RFQ refuses every link
  assert.equal((await r.call(ic, 'POST', `/rfqs/${m.id}/close`, { reason: 'Quotations are in' })).status, 200); assert.equal((await r.pub('GET', t1b)).status, 410);
  assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.quotation.received'").get() && r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rate.observed'").get() && r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rfq.closed'").get());
});

test('FR-04 FR-05 FR-06 BR-02 a quotation is keyed in by procurement with the landed rate worked out; revised versions supersede; rates are hidden from roles without the right; the comparison marks the lowest', async () => {
  const r = await ready(); const m = await r.rfq({}, [r.v1, r.v2, r.v3]); await r.call(ic, 'POST', `/rfqs/${m.id}/issue`); const [l1, l2] = m.lines.map((l) => l.id); const env = { id: m.id, v1: r.v1 };
  assert.equal((await r.call(ic, 'POST', '/quotations', { rfqId: m.id, vendorId: r.v4, validUntil: plus(20), lines: [{ rfqLineId: l1, rate: 1 }] })).status, 400, 'a vendor not on the RFQ');
  const c1 = await r.call(ic, 'POST', '/quotations', quoteBody(env, [{ rfqLineId: l1, rate: 400, discountPct: 5, gstRate: 28, freight: 10000, loading: 1000, otherCharges: 500, make: 'Ambuja' }, { rfqLineId: l2, rate: 70, gstRate: 18, offeredQty: 400 }]));
  assert.equal(c1.status, 201, JSON.stringify(c1.json)); const q = c1.json.data; assert.equal(q.status, 'DRAFT'); const a = q.lines.find((l) => l.rfqLineId === l1);
  // 1000 bags at ₹ 400 less 5 % = ₹ 380 → ₹ 3,80,000 + 10,000 + 1,000 + 500 = ₹ 3,91,500 (GST recoverable): ₹ 391.50 a bag
  assert.deepEqual([a.landedAmount, a.landedRate, a.discountPct, a.gstRate], [391500, 391.5, 5, 28]); const b = q.lines.find((l) => l.rfqLineId === l2); assert.deepEqual([b.offeredQty, b.landedAmount, b.landedRate], [400, 28000, 70], 'a partial quantity');
  assert.equal(q.totalLanded, 419500); assert.equal(q.gstRecoverable, true);
  assert.equal((await r.call(ic, 'PATCH', `/quotations/${q.id}`, { lines: [{ rfqLineId: l1, rate: 390, gstRate: 28, freight: 10000 }, { rfqLineId: l2, rate: 70, gstRate: 18 }] })).json.data.lines.find((l) => l.rfqLineId === l1).landedRate, 390 + 10, 'a change recomputes');
  const sub = await r.call(ic, 'POST', `/quotations/${q.id}/submit`); assert.equal(sub.status, 200, JSON.stringify(sub.json)); assert.equal(sub.json.data.status, 'RECEIVED'); assert.equal((await r.call(ic, 'GET', `/rfqs/${m.id}`)).json.data.respondedCount, 1);
  assert.equal((await r.call(ic, 'PATCH', `/quotations/${q.id}`, { deliveryDays: 3 })).status, 409, 'a received quotation is revised, not edited');
  // a revision: a new draft version; recording it supersedes the first
  const am = await r.call(ic, 'POST', `/quotations/${q.id}/amend`, { reason: 'The vendor lowered the rate' }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.equal(am.json.data.versionNo, 2); assert.equal(am.json.data.lines.length, 2);
  await r.call(ic, 'PATCH', `/quotations/${am.json.data.id}`, { lines: [{ rfqLineId: l1, rate: 380, gstRate: 28, freight: 10000 }, { rfqLineId: l2, rate: 70, gstRate: 18 }] }); assert.equal((await r.call(ic, 'POST', `/quotations/${am.json.data.id}/submit`)).status, 200); assert.deepEqual(r.d.prepare('SELECT version_no, status FROM proc_quotations WHERE rfq_id = ? ORDER BY version_no').all(m.id).map((x) => [x.version_no, x.status]), [[1, 'SUPERSEDED'], [2, 'RECEIVED']]);
  const hist = (await r.call(ic, 'GET', `/quotations/${am.json.data.id}/history`)).json.data; assert.equal(hist.versions.length, 2);
  // the second vendor quotes lower on the cement and higher on the steel; the third offers a make with a deviation
  const q2 = await r.call(ic, 'POST', '/quotations', { rfqId: m.id, vendorId: r.v2, validUntil: plus(20), deliveryDays: 4, gstInclusive: true, lines: [{ rfqLineId: l1, rate: 442.4, gstRate: 18 }, { rfqLineId: l2, rate: 85, gstRate: 18, deviation: 'Supplied in 50 kg coils only' }] }); assert.equal(q2.status, 201, JSON.stringify(q2.json)); assert.equal(q2.json.data.lines.find((l) => l.rfqLineId === l1).landedRate, 374.92, '₹ 442.40 with 18 % GST included is ₹ 374.92 before GST'); await r.call(ic, 'POST', `/quotations/${q2.json.data.id}/submit`);
  const cmp = (await r.call(ic, 'GET', `/rfqs/${m.id}/comparison`)).json.data; assert.equal(cmp.vendors.length, 2); const cl1 = cmp.lines.find((l) => l.rfqLineId === l1); assert.deepEqual(cl1.cells.map((c) => [c.vendorId, c.lowest]), [[r.v1, false], [r.v2, true]], 'the second vendor is lowest on the cement'); assert.equal(cmp.lines.find((l) => l.rfqLineId === l2).cells.find((c) => c.lowest).vendorId, r.v1);
  // BR-02: the project manager reads the RFQ and the quotations but no rate; the site engineer reads none; the director reads the rates
  const pq = (await r.call(pm, 'GET', `/quotations/${am.json.data.id}`)); assert.equal(pq.status, 403, 'the project manager has no right to the quotations'); const pr_ = (await r.call(pm, 'GET', `/rfqs/${m.id}`)).json.data; assert.equal(pr_.estTotal, null); assert.equal(pr_.canSeeRates, false); assert.equal(pr_.lines[0].estRate, null); assert.equal((await r.call(pm, 'GET', `/rfqs/${m.id}/comparison`)).status, 403);
  assert.equal((await r.call(se, 'GET', `/quotations/${am.json.data.id}`)).status, 403); const dq = (await r.call(dir, 'GET', `/quotations/${am.json.data.id}`)).json.data; assert.equal(dq.canSeeRates, true); assert.equal(dq.lines[0].rate, 380);
  const nolist = (await r.call(pm, 'GET', '/quotations')); assert.equal(nolist.status, 403);
  // withdraw and cancel
  assert.equal((await r.call(ic, 'POST', `/quotations/${q2.json.data.id}/withdraw`, { reason: 'The vendor withdrew the offer' })).json.data.status, 'WITHDRAWN'); assert.equal((await r.call(ic, 'GET', `/rfqs/${m.id}/comparison`)).json.data.vendors.length, 1);
  const imp = await r.call(ic, 'POST', '/quotations', quoteBody(env, [{ rfqLineId: l1, rate: 1 }], { vendorId: r.v3 })); const loaded = await r.call(ic, 'POST', `/quotations/${imp.json.data.id}/import`, { rows: [{ lineNo: 1, rate: 399 }, { lineNo: 2, rate: 66 }] }); assert.equal(loaded.status, 200, JSON.stringify(loaded.json)); assert.equal(loaded.json.data.lines.length, 2); assert.equal((await r.call(ic, 'POST', `/quotations/${imp.json.data.id}/import`, { rows: [{ lineNo: 9, rate: 1 }] })).status, 400);
  assert.equal((await r.call(ic, 'GET', `/quotations?q=${loaded.json.data.docNo}`)).json.data.length, 1);
  const qp = await r.api.raw('GET', `${P}/quotations/${am.json.data.id}/print`, { ...ic }); assert.equal(qp.status, 200);
});

test('FR-06 FR-07 clarifications, reminders to vendors who have not answered, amending the due date, regret letters, cancel and close', async () => {
  const r = await ready(); const m = await r.rfq({}, [r.v1, r.v2, r.v3]); const { links } = (await r.call(ic, 'POST', `/rfqs/${m.id}/issue`)).json.data; const t1 = r.tokenOf(links, r.v1);
  // a question from the vendor's page, answered to all
  assert.equal((await r.pub('POST', t1, '/clarify', { question: 'Is OPC 43 acceptable instead of 53?' })).status, 201); const cl = (await r.call(ic, 'GET', `/rfqs/${m.id}`)).json.data.clarifications; assert.equal(cl.length, 1); assert.equal(cl[0].answer, null);
  assert.equal((await r.call(ic, 'POST', `/rfqs/${m.id}/clarifications/${cl[0].id}/answer`, { answer: 'No: OPC 53 only', shareAll: true })).status, 200); assert.equal((await r.pub('GET', t1)).json.data.clarifications[0].answer, 'No: OPC 53 only');
  assert.equal((await r.call(ic, 'POST', `/rfqs/${m.id}/clarifications`, { vendorId: r.v3, question: 'Vendor 3 asked by phone about delivery' })).status, 201);
  // reminders: only vendors who have not answered, each with a fresh link; at most three
  const rem = await r.call(ic, 'POST', `/rfqs/${m.id}/remind`); assert.equal(rem.status, 200, JSON.stringify(rem.json)); assert.equal(rem.json.data.vendors.length, 3); assert.equal(rem.json.data.reminded, 3); assert.equal((await r.pub('GET', t1)).status, 404, 'a reminder carries a fresh link; the old one stops working'); const n1 = rem.json.data.vendors.find((v) => v.vendorId === r.v1).url.split('token=')[1]; assert.equal((await r.pub('GET', n1)).status, 200); const n2 = rem.json.data.vendors.find((v) => v.vendorId === r.v2).url.split('token=')[1]; assert.equal((await r.pub('GET', n2)).json.data.clarifications.length, 1, 'the answer is shared with every vendor');
    r.d.prepare('UPDATE proc_rfq_vendors SET reminder_count = 3 WHERE rfq_id = ? AND vendor_id = ?').run(m.id, r.v3); const rem3 = (await r.call(ic, 'POST', `/rfqs/${m.id}/remind`)).json.data; assert.match(JSON.stringify(rem3.vendors.find((v) => v.vendorId === r.v3)), /most reminders/); const n1b = rem3.vendors.find((v) => v.vendorId === r.v1).url.split('token=')[1];
  // the daily job: an RFQ due in two days tells the buyer and reminds
  r.d.prepare('UPDATE proc_rfqs SET due_date = ? WHERE id = ?').run(plus(1), m.id); const { procOf } = await import('../src/server/modules/proc/index.js'); const n = procOf(r.d).rfqSvc.rfqs.sweep(); assert.equal(n, 1); assert.ok(r.d.prepare("SELECT 1 FROM ntf_notifications WHERE source_type LIKE 'proc.rfq.due_soon%'").get()); assert.equal(procOf(r.d).rfqSvc.rfqs.sweep(), 0, 'told once a day');
  // amend: the due date is extended; the vendors' links last longer; the revision number counts
  const am = await r.call(ic, 'POST', `/rfqs/${m.id}/amend`, { reason: 'More time for the vendors', dueDate: plus(10) }); assert.equal(am.status, 200, JSON.stringify(am.json)); assert.deepEqual([am.json.data.dueDate, am.json.data.revisionNo], [plus(10), 1]); assert.ok(r.d.prepare('SELECT token_expires FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ?').get(m.id, r.v1).token_expires > new Date(Date.parse(`${plus(10)}T00:00:00Z`)).toISOString());
  // regret
  const rg = await r.call(ic, 'POST', `/rfqs/${m.id}/regret`, { vendorIds: [r.v3] }); assert.equal(rg.status, 200, JSON.stringify(rg.json)); assert.equal(rg.json.data.vendors[0].vendorId, r.v3); assert.match(JSON.stringify((await r.call(ic, 'POST', `/rfqs/${m.id}/regret`, { vendorIds: [r.v3] })).json.data.vendors), /already/);
  assert.equal((await r.call(ic, 'POST', `/rfqs/${m.id}/regret`, { vendorIds: [r.v4] })).status, 404, 'a vendor not on the RFQ');
  // cancel kills the links
  const c = await r.call(ic, 'POST', `/rfqs/${m.id}/cancel`, { reason: 'The requirement was dropped' }); assert.equal(c.json.data.status, 'CANCELLED'); assert.equal((await r.pub('GET', n1b)).status, 410); assert.equal((await r.call(ic, 'POST', `/rfqs/${m.id}/issue`)).status, 422);
  assert.ok(r.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proc.rfq.cancelled'").get());
  // a draft is deleted; an issued one is not
  const dr = await r.rfq({ pr: { small: true } }, [r.v1]); assert.equal((await r.call(ic, 'DELETE', `/rfqs/${dr.id}`)).status, 200); assert.equal((await r.call(ic, 'GET', `/rfqs/${dr.id}`)).status, 404);
});

test('standard: the list, filters, export, the audit trail, idempotency, validation and the feature flag', async () => {
  const r = await ready(); const m = await r.rfq({}, [r.v1, r.v2, r.v3]); const l = await r.call(ic, 'GET', '/rfqs'); assert.equal(l.status, 200); assert.equal(l.json.data.length, 1); assert.equal(l.json.data[0].vendors, 3); assert.equal((await r.call(ic, 'GET', '/rfqs?filter[status]=ISSUED')).json.data.length, 0);
  const k = key(); const iss = await r.call(ic, 'POST', `/rfqs/${m.id}/issue`, undefined, k); assert.equal(iss.status, 200); const again = await r.call(ic, 'POST', `/rfqs/${m.id}/issue`, undefined, k); assert.equal(again.status, 200, 'the same key returns the same answer'); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'proc_rfqs' AND action = 'issue'").get().n, 1);
  assert.equal((await r.call(ic, 'GET', '/rfqs?filter[status]=ISSUED')).json.data.length, 1); const h = (await r.call(ic, 'GET', `/rfqs/${m.id}/history`)).json.data; assert.ok(h.audit.some((a) => a.action === 'issue') && h.audit.some((a) => a.action === 'create'));
  assert.equal((await r.call(ic, 'POST', '/rfqs', { projectId: r.pid, title: '', dueDate: 'tomorrow', lines: [], vendors: [] })).status, 400); assert.equal((await r.call(ic, 'POST', '/rfqs', { projectId: r.pid, title: 'No key', dueDate: plus(3), lines: [] }, { 'content-type': 'application/json' })).status, 400);
  assert.equal((await r.call(ic, 'POST', '/quotations', quoteBody({ id: m.id, v1: r.v1 }, [{ rfqLineId: m.lines[0].id, rate: -5 }]))).status, 400); assert.equal((await r.call(ic, 'POST', '/quotations', quoteBody({ id: m.id, v1: r.v1 }, [{ rfqLineId: m.lines[0].id, rate: 5 }], { validUntil: plus(-3) }))).status, 400);
  const exp = await r.api.raw('GET', `${P}/rfqs?export=csv`, { ...ic }); assert.ok([200, 400].includes(exp.status));
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1503'").run(); const off = await r.call(ic, 'GET', '/rfqs'); assert.equal(off.status, 404); r.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proc.p1503'").run();
});
