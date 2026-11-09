import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { REVIEW_ITEMS } from '../src/server/modules/est/constants.js';
import { estimatesOf } from '../src/server/modules/est/estimate.js';
import { reviewOf } from '../src/server/modules/est/review.js';
import { setupCompany, startApi } from './helpers.js';

// Part 09.03: estimate review, approval, bid price summary and priced BOQ. T-01 +10 % on the steel rate moves the bid price consistently (the sensitivity equals the estimate priced again at the higher rate). Also: the bid
// price is the sum of its parts (BR-01); a discount above 2 % waits for the director before the estimate is sent; the commercial manager reviews against the checklist (on the panel or in the inbox, never without ticking
// every item) and the director approves (EST -> COMMGR -> DIR); the approved estimate is locked and carries its bid summary (BR-02); the assumptions register; the unbalanced items; the priced BOQ in Excel, PDF and print with
// rates in words; roles and masking, another company, the flag.
const E = '/api/v1/est';
const M = '/api/v1/mdm';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `rev-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const est1 = as('EST', 'rest1'); const dir = as('DIR', 'rdir1'); const com = as('COMMGR', 'rcom1'); const qs = as('QS', 'rqs1'); const pm = as('PM', 'rpm1'); const bd = as('BD', 'rbd1');
const ALL = REVIEW_ITEMS.map(([c]) => c);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['rest1', ['EST']], ['rdir1', ['DIR']], ['rcom1', ['COMMGR']], ['rqs1', ['QS']], ['rpm1', ['PM']], ['rbd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body, k = key()) => api.call(method, path, { ...who, headers: k, body });
  const taskOf = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  const act = async (who, instanceId, action = 'approve', extra = {}) => {
    const task = await taskOf(who, instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked', ...extra } });
  };
  const cat = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'RV', 'Review test', 'RVT', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, name, type, uom) => Number(api.db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE')").run(code, name, type, cat, uom).lastInsertRowid);
  const it = { cement: item('MAT-CEM-3', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('MAT-SND-3', 'Coarse sand', 'MATERIAL', 'CUM'), agg: item('MAT-AGG-3', 'Coarse aggregate 20 mm', 'MATERIAL', 'CUM'), mason: item('LAB-MSN-3', 'Mason', 'LABOUR', 'DAY'), beldar: item('LAB-BLD-3', 'Beldar', 'LABOUR', 'DAY'), mixer: item('EQP-MIX-3', 'Concrete mixer with operator', 'EQUIPMENT', 'DAY'), vib: item('EQP-VIB-3', 'Needle vibrator', 'EQUIPMENT', 'DAY'), steel: item('MAT-STL-3', 'TMT steel Fe 500D', 'MATERIAL', 'MT'), m25: item('WI-M25-3', 'RCC M25', 'WORK_ITEM', 'CUM') };
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'RVA', 'Alpha towers', 'BUILDING')").run().lastInsertRowid);
  const other = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'RVB', 'Beta mall', 'BUILDING')").run().lastInsertRowid);
  for (const [i, v, u] of [[it.cement, '7200', 'MT'], [it.sand, '1850', 'CUM'], [it.agg, '1650', 'CUM'], [it.mason, '950', 'DAY'], [it.beldar, '650', 'DAY'], [it.mixer, '2400', 'DAY'], [it.vib, '600', 'DAY'], [it.steel, '60000', 'MT']]) {
    const r = await call(est1, 'POST', `${M}/resource-rates`, { itemId: i, rate: v, uom: u, basis: 'MARKET_SURVEY', effectiveFrom: '2026-04-01', region: 'MH' }); assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  const lines = [[it.cement, 'MT', '0.4', '2'], [it.sand, 'CUM', '0.42', '5'], [it.agg, 'CUM', '0.84', '5'], [it.mason, 'DAY', '0.17'], [it.beldar, 'DAY', '2.5'], [it.mixer, 'DAY', '0.07'], [it.vib, 'DAY', '0.07']].map(([itemId, uom, qty, w]) => ({ itemId, uom, qty, ...(w ? { wastagePct: w } : {}) }));
  const a = (await call(est1, 'POST', `${M}/analyses`, { workItemId: it.m25, title: 'RCC M25 per cum', scope: 'STANDARD', region: 'MH', basisQty: '1', basisUom: 'CUM', effectiveFrom: '2026-05-01', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines, submit: true })).json.data;
  assert.equal((await act(dir, a.instanceId)).status, 200);
  return { api, call, act, taskOf, it, project, other, analysisId: a.id };
}
/** A: typed 5000 +20 % x 100; R: reinforcement built up (1 MT of steel from the library at 60,000 + 4,000 of bending labour) +10 % x 20 MT; B: M25 from the analysis +25 % x 250; C: a typed item at cost x 10. */
const items = (t, steelRate = null) => [
  { sectionCode: 'A', sectionName: 'Earthwork and PCC', itemNo: 'A.1', description: 'PCC 1:4:8', uom: 'CUM', qty: '100', clientRate: '5600', mode: 'RATE', costRate: '5000', markupPct: '20' },
  { sectionCode: 'B', sectionName: 'Reinforced concrete', itemNo: 'R.1', description: 'Reinforcement Fe 500D, cut, bent and placed', uom: 'MT', qty: '20', mode: 'MANUAL', markupPct: '10', components: [{ type: 'MATERIAL', itemId: t.it.steel, uom: 'MT', qty: '1', ...(steelRate ? { rate: steelRate } : {}) }, { type: 'LABOUR', description: 'Bar bending gang', uom: 'MT', qty: '1', rate: '4000' }] },
  { sectionCode: 'B', sectionName: 'Reinforced concrete', itemNo: 'B.1', description: 'RCC M25 in columns, beams and slabs', uom: 'CUM', qty: '250', mode: 'ANALYSIS', analysisId: t.analysisId, markupPct: '25' },
  { sectionCode: 'C', sectionName: 'Sundries', itemNo: 'C.1', description: 'Cleaning on completion', uom: 'LS', qty: '10', mode: 'RATE', costRate: '100', markupPct: '0' },
];
async function built(t, projectId = t.project) {
  const c = (await t.call(est1, 'POST', `${E}/estimates`, { projectId, title: 'Alpha towers, structure', basisDate: '2026-10-01', region: 'MH', gstPct: '18' })).json.data;
  const r = await t.call(est1, 'PUT', `${E}/estimates/${c.id}/items`, { items: items(t), version: c.rowVersion }); assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}

test('T-01 +10 % on the steel rate moves the bid price consistently; the bid price is the sum of its parts', async () => {
  const t = await setup();
  const e = await built(t);
  // selling 6,00,000 + 20 x 70,400 + 250 x 9,006.56 + 10 x 100 = 42,60,640.00; cost 35,82,312.50; GST 18 %: bid 50,27,555.20
  const s = (await t.call(est1, 'GET', `${E}/estimates/${e.id}/bid-summary`)).json.data;
  assert.deepEqual([s.selling, s.totalCost, s.profit, s.discount, s.gst, s.bidPrice], ['4260640.00', '3582312.50', '678327.50', '0.00', '766915.20', '5027555.20']);
  assert.deepEqual(s.check, { sumOfParts: '5027555.20', equals: true }, 'BR-01: cost + profit - discount + GST');
  assert.match(s.bidPriceInWords, /^Rupees Fifty Lakh Twenty-Seven Thousand Five Hundred Fifty-Five and Twenty Paise Only$/);
  // T-01: steel +10 % = 6,000 more per MT of R.1; its cost rate 70,000, +10 % = 77,000; 20 MT: +1,32,000 selling, x 1.18 = +1,55,760 on the bid
  const sv = (await t.call(est1, 'GET', `${E}/estimates/${e.id}/sensitivity?pct=10`)).json.data;
  const steel = sv.rows.find((r) => r.label.startsWith('MAT-STL-3'));
  assert.deepEqual([steel.baseAmount, steel.costDelta, steel.selling, steel.bidPrice, steel.bidDelta, steel.marginAtSamePrice], ['1200000.00', '120000.00', '4392640.00', '5183315.20', '155760.00', '558327.50']);
  assert.ok(sv.rows.some((r) => r.kind === 'type' && r.label === 'Material') && sv.rows.some((r) => r.label.startsWith('MAT-CEM-3')), 'cement and each kind of resource too');
  // consistency: the same estimate priced again with steel at 66,000 gives exactly that bid price
  const v2 = (await t.call(est1, 'POST', `${E}/estimates/${e.id}/versions`, {})).json.data;
  const p2 = (await t.call(est1, 'PUT', `${E}/estimates/${v2.id}/items`, { items: items(t, '66000'), version: v2.rowVersion })).json.data;
  assert.equal((await t.call(est1, 'GET', `${E}/estimates/${p2.id}/bid-summary`)).json.data.bidPrice, steel.bidPrice);
  const minus = (await t.call(est1, 'GET', `${E}/estimates/${e.id}/sensitivity?pct=-10`)).json.data.rows.find((r) => r.label.startsWith('MAT-STL-3'));
  assert.equal(minus.bidDelta, '-155760.00', 'and -10 % the other way');
  assert.equal((await t.call(est1, 'GET', `${E}/estimates/${e.id}/sensitivity?pct=0`)).status, 400);
});

test('FR-01 FR-04 BR-01 BR-02 a discount above 2 % needs the director; the commercial manager reviews against the checklist, the director approves; the approved estimate is locked and carries its bid price', async () => {
  const t = await setup();
  const e = await built(t);
  // a discount within the threshold needs no approval, but a reason
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/bid-summary`, { discountPct: '1.5' })).status, 400, 'a discount says why');
  const d1 = (await t.call(est1, 'PUT', `${E}/estimates/${e.id}/bid-summary`, { discountPct: '1.5', discountReason: 'repeat client, early mobilisation possible' })).json.data;
  assert.deepEqual([d1.discountStatus, d1.discount], ['NOT_REQUIRED', '63909.60']);
  // 3 %: 1,27,819.20 off 42,60,640.00 = 41,32,820.80; GST 7,43,907.74; bid 48,76,728.54; the director approves it first
  const d3 = (await t.call(est1, 'PUT', `${E}/estimates/${e.id}/bid-summary`, { discountPct: '3', discountReason: 'to beat the expected L1 by a small margin', version: d1.rowVersion })).json.data;
  assert.deepEqual([d3.discountStatus, d3.discount, d3.net, d3.gst, d3.bidPrice, d3.check.equals], ['DRAFT', '127819.20', '4132820.80', '743907.74', '4876728.54', true]);
  const blocked = await t.call(est1, 'POST', `${E}/estimates/${e.id}/submit`, {});
  assert.equal(blocked.status, 422); assert.match(JSON.stringify(blocked.json), /director approves it/);
  const ds = await t.call(est1, 'POST', `${E}/estimates/${e.id}/bid-summary/submit`, {}); assert.equal(ds.status, 202, JSON.stringify(ds.json));
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/bid-summary`, { discountPct: '2.5', discountReason: 'changing my mind on it' })).status, 409, 'not while it is with the director');
  assert.ok(!(await t.taskOf(com, ds.json.data.workflowInstanceId)), 'only the director');
  assert.equal((await t.act(dir, ds.json.data.workflowInstanceId)).status, 200);
  assert.equal((await t.call(est1, 'GET', `${E}/estimates/${e.id}/bid-summary`)).json.data.discountStatus, 'APPROVED');
  // FR-03 the register goes with it
  const reg = (await t.call(est1, 'PUT', `${E}/estimates/${e.id}/assumptions`, { lines: [{ kind: 'ASSUMPTION', text: 'Water and power at the site boundary by the client' }, { kind: 'EXCLUSION', text: 'Dewatering beyond 1.5 m depth' }, { kind: 'QUALIFICATION', text: 'Steel price variation by the RBI WPI clause' }] })).json.data;
  assert.deepEqual(reg.map((a) => a.kind), ['ASSUMPTION', 'EXCLUSION', 'QUALIFICATION']);
  // sent: EST -> COMMGR (review against the checklist) -> DIR
  const sub = await t.call(est1, 'POST', `${E}/estimates/${e.id}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json));
  const inst = sub.json.data.workflowInstanceId;
  assert.equal((await t.call(est1, 'POST', `${E}/estimates/${e.id}/reviews`, { checked: ALL, verdict: 'APPROVE' })).status, 403, 'the estimator does not review');
  assert.equal((await t.act(com, inst, 'approve')).status, 422, 'the inbox does not approve the review without the checklist');
  const half = await t.call(com, 'POST', `${E}/estimates/${e.id}/reviews`, { checked: ALL.slice(0, 3), verdict: 'APPROVE' });
  assert.equal(half.status, 422); assert.match(JSON.stringify(half.json), /Risks priced/);
  // returned from the panel, corrected, sent again
  const ret = await t.call(com, 'POST', `${E}/estimates/${e.id}/reviews`, { checked: ALL.slice(0, 4), verdict: 'RETURN', comments: 'List the exclusion of rock excavation' });
  assert.equal(ret.status, 201, JSON.stringify(ret.json)); assert.equal(ret.json.data.status, 'ACTED');
  const back = (await t.call(est1, 'GET', `${E}/estimates/${e.id}`)).json.data; assert.equal(back.status, 'RETURNED');
  await t.call(est1, 'PUT', `${E}/estimates/${e.id}/assumptions`, { lines: [...reg.map(({ kind, text }) => ({ kind, text })), { kind: 'EXCLUSION', text: 'Rock excavation' }] });
  assert.equal((await t.call(est1, 'POST', `${E}/estimates/${e.id}/submit`, {})).status, 202);
  const ok = await t.call(com, 'POST', `${E}/estimates/${e.id}/reviews`, { checked: ALL, verdict: 'APPROVE', comments: 'Checked against the take-off and the analyses' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal((await t.call(est1, 'GET', `${E}/estimates/${e.id}`)).json.data.status, 'SUBMITTED', 'with the director now');
  assert.equal((await t.act(dir, inst)).status, 200);
  const x = (await t.call(est1, 'GET', `${E}/estimates/${e.id}/review`)).json.data;
  assert.deepEqual([x.estimate.status, x.reviews.map((r) => r.verdict), x.can.forBid], ['APPROVED', ['APPROVE', 'RETURN'], true]);
  // locked: the bid price and the register change only in a new version
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/bid-summary`, { discountPct: '0' })).status, 409);
  assert.equal((await t.call(est1, 'PUT', `${E}/estimates/${e.id}/assumptions`, { lines: [] })).status, 409);
  const v2 = (await t.call(est1, 'POST', `${E}/estimates/${e.id}/amend`, { reason: 'revised offer after negotiation' })).json.data;
  assert.equal((await t.call(est1, 'GET', `${E}/estimates/${v2.id}/assumptions`)).json.data.length, 4, 'the register is copied to the new version');
  // BR-02: the approval carries the bid summary to the bid (08.03) and the baseline (10.02)
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'est.estimate.approved'").all().map((r) => JSON.parse(r.payload).data ?? JSON.parse(r.payload));
  assert.deepEqual(ev[0].bidSummary, { discountPct: '3', discount: '127819.20', net: '4132820.80', gst: '743907.74', bidPrice: '4876728.54' });
  const row = t.api.db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id);
  assert.equal(estimatesOf(t.api.db).estimates.netOf(row), 413282080, 'the bid submission starts from the price after the discount');
});

test('FR-05 FR-06 the priced BOQ in the client format with rates in words; unbalanced items; roles, masking, isolation, another company, the flag', async () => {
  const t = await setup();
  const e = await built(t);
  // FR-06 the average markup is 6,78,327.50 on 35,82,312.50 = 18.94 %; C.1 at cost is flagged below the average and at cost
  const u = (await t.call(com, 'GET', `${E}/estimates/${e.id}/unbalanced`)).json.data;
  const fl = Object.fromEntries(u.rows.map((r) => [r.itemNo, r.flags]));
  assert.equal(u.averageMarkupPct, '18.94'); assert.deepEqual(fl['C.1'], ['BELOW_AVERAGE', 'AT_OR_BELOW_COST']); assert.deepEqual(fl['B.1'], []); assert.equal(u.flagged, 1);
  assert.equal(u.rows.find((r) => r.itemNo === 'A.1').vsClientPct, '7.14');
  // FR-05: print with the rates in words; a draft says so
  const html = await t.api.call('GET', `${E}/estimates/${e.id}/priced-boq?format=html`, est1);
  assert.equal(html.status, 200);
  const page = reviewOf(t.api.db).pricedBoq({ user: 'rest1', companyId: 1, roles: ['EST'] }, e.id, { format: 'html' }).body;
  assert.match(page, /Rupees Six Thousand Only/); assert.match(page, /Rupees Nine Thousand Six and Fifty-Six Paise Only/); assert.match(page, /DRAFT/); assert.match(page, /REINFORCED CONCRETE/);
  const xl = reviewOf(t.api.db).pricedBoq({ user: 'rest1', companyId: 1, roles: ['EST'] }, e.id, { format: 'xlsx' });
  assert.deepEqual([xl.fileName.endsWith('-DRAFT.xlsx'), xl.buffer.subarray(0, 2).toString()], [true, 'PK']);
  const pdf = reviewOf(t.api.db).pricedBoq({ user: 'rest1', companyId: 1, roles: ['EST'] }, e.id, { format: 'pdf' });
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'est_estimates' AND action = 'priced_boq'").get(), 'every output is audited');
  // roles: QS sees the panel without costs; PM and BD do not see it; no sensitivity without the cost right
  const q = (await t.call(qs, 'GET', `${E}/estimates/${e.id}/review`)).json.data;
  assert.deepEqual([q.summary.parts, q.summary.totalCost, q.summary.bidPrice, q.unbalanced, q.can.review], [null, null, '5027555.20', null, false]);
  assert.equal((await t.call(qs, 'GET', `${E}/estimates/${e.id}/sensitivity`)).status, 403);
  assert.equal((await t.call(qs, 'GET', `${E}/estimates/${e.id}/priced-boq?format=xlsx`)).status, 403);
  assert.equal((await t.call(pm, 'GET', `${E}/estimates/${e.id}/review`)).status, 403);
  assert.equal((await t.call(bd, 'GET', `${E}/estimates/${e.id}/bid-summary`)).status, 403);
  assert.equal((await t.call(com, 'PUT', `${E}/estimates/${e.id}/bid-summary`, { discountPct: '1', discountReason: 'not the estimator here' })).status, 403);
  assert.equal((await t.call(com, 'GET', `${E}/estimates/${e.id}/priced-boq?format=pdf`)).status, 200);
  assert.equal((await t.call(com, 'POST', `${E}/estimates/${e.id}/reviews`, { checked: ALL, verdict: 'APPROVE' })).status, 422, 'no review task before it is sent');
  assert.equal((await t.call(com, 'POST', `${E}/estimates/${e.id}/reviews`, { checked: ALL.slice(0, 2), verdict: 'NOTE', comments: 'Early look: quantities fine so far' })).status, 201, 'a note any time');
  // isolation: a director assigned to the other project only; another company; the flag
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'rdir2', 'rdir2', '[]', 'rdir2@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'DIR'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([t.other]));
  assert.throws(() => reviewOf(t.api.db).panel({ user: 'rdir2', userId: uid, companyId: 1, roles: [] }, e.id), /does not exist/);
  assert.equal((await t.call(as('COMMGR', 'rcom1', '2'), 'GET', `${E}/estimates/${e.id}/review`)).status, 404);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.est.p0903'").run();
  assert.equal((await t.call(com, 'GET', `${E}/estimates/${e.id}/review`)).status, 404, 'flag off');
  assert.equal((await t.call(com, 'GET', `${E}/estimates/${e.id}`)).status, 200, 'the estimate of 09.01 stays');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.est.p0903'").run();
});
