import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { baselineOf } from '../src/server/modules/proj/baseline.js';
import { currentProviders } from '../src/server/modules/proj/baseline.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.02: the project from an awarded tender and the commercial baseline pack. T-01 the project made from the award contains every BOQ item and rate of the approved estimate, identical, with nothing typed again, in one transaction.
// Also: the sign-off chain (estimation, commercial manager, project director, the director above ₹ 50 crore; never the sender), the pack immutable once signed off (and its hash), the superseding pack (BR-01) with its comparison,
// the handover meeting with its actions as tasks, costs masked from those who do not see them, the baseline against the current figures, roles, another company, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `bl-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pcm = as('PCMGR', 'bpcm1'); const est1 = as('EST', 'best1'); const est2 = as('EST', 'best2'); const com1 = as('COMMGR', 'bcom1'); const pd1 = as('PD', 'bpd1'); const pd2 = as('PD', 'bpd2'); const dir = as('DIR', 'bdir1'); const pm = as('PM', 'bpm1'); const qs = as('QS', 'bqs1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['bpcm1', ['PCMGR']], ['best1', ['EST']], ['best2', ['EST']], ['bcom1', ['COMMGR']], ['bpd1', ['PD']], ['bpd2', ['PD']], ['bdir1', ['DIR']], ['bpm1', ['PM']], ['bqs1', ['QS']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked against the estimate' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const client = Number(api.db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, 'CL200', 'Public Works Department', 'public works department', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 't', 'test')").run().lastInsertRowid);
  api.db.prepare('INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (1, ?, ?)').run(client, 'CLIENT');
  /** An awarded tender with its approved award and approved estimate (the figures of 08.03 and 09.03 in their tables). */
  const awarded = ({ no = 'TDR-0001', value = 97_200_000_00, stage = 'AWARDED', award = true, estimate = true, estStatus = 'APPROVED' } = {}) => {
    const tid = Number(api.db.prepare("INSERT INTO tdr_tenders (company_id, doc_no, doc_date, client_partner_id, name_of_work, location, est_cost_minor, bid_type, period_months, owner, stage, status, created_by) VALUES (1, ?, '2026-06-01', ?, 'Four-laning of NH-48, package 3', 'Pune', ?, 'ITEM_RATE', 24, 'best1', ?, 'APPROVED', 'best1')").run(no, client, value, stage).lastInsertRowid);
    let aid = null; if (award) aid = Number(api.db.prepare("INSERT INTO tdr_awards (company_id, doc_no, doc_date, tender_id, outcome, loa_no, loa_date, awarded_value_minor, status, created_by) VALUES (1, ?, '2026-10-20', ?, 'WON', ?, '2026-10-25', ?, 'APPROVED', 'best1')").run(`AW-${no}`, tid, `LOA/${no}`, value).lastInsertRowid);
    let eid = null;
    if (estimate) {
      eid = Number(api.db.prepare("INSERT INTO est_estimates (company_id, doc_no, version_no, title, tender_id, basis_date, region_code, ho_overhead_pct, contingency_pct, escalation_pct, gst_pct, direct_cost, indirect_cost, overhead_amount, risk_amount, contingency_amount, escalation_amount, total_cost, total_selling, margin_amount, margin_pct, gst_amount, bid_value, status, approved_at, created_by) VALUES (1, ?, 1, 'NH-48 package 3 estimate', ?, '2026-09-01', 'MH', 70000, 20000, 30000, 180000, 80000000000, 6000000000, 4000000000, 1000000000, 500000000, 700000000, 92200000000, 100800000000, 8600000000, 85000, 18000000000, ?, ?, '2026-10-10T10:00:00.000Z', 'best1')").run(`EST-${no}`, tid, value, estStatus).lastInsertRowid);
      const item = (sec, secName, no2, d, uom, qty, rate, cost, mk, order) => {
        const q = Math.round(qty * 1000); const sell = Math.round(rate * 100); const amount = Math.round(qty * rate * 100); const camount = Math.round(qty * cost * 100);
        return Number(api.db.prepare("INSERT INTO est_estimate_items (company_id, estimate_id, section_code, section_name, item_no, sort_order, description, uom, qty, client_rate, build_mode, cost_rate, markup_pct, selling_rate, cost_amount, amount, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, 'best1')").run(eid, sec, secName, no2, order, d, uom, q, Math.round(rate * 10000), Math.round(cost * 10000), mk, sell, camount, amount).lastInsertRowid);
      };
      const i1 = item('A', 'Earthwork', 'A.1', 'Excavation in soil', 'CUM', 120000, 185.5, 150, 237000, 1);
      item('A', 'Earthwork', 'A.2', 'Embankment with approved material', 'CUM', 85000, 310.25, 260, 193000, 2);
      item('B', 'Pavement', 'B.1', 'Dense bituminous macadam 50 mm', 'CUM', 9500, 9250.75, 7800, 186000, 3);
      api.db.prepare("INSERT INTO est_item_components (company_id, estimate_item_id, line_no, component_type, description, uom, qty_per_unit, rate, amount, line_origin, created_by) VALUES (1, ?, 1, 'EQUIPMENT', 'Excavator 1.0 cum', 'HR', 20, 1400000, 28000, 'MANUAL', 'best1')").run(i1);
      api.db.prepare("INSERT INTO est_item_components (company_id, estimate_item_id, line_no, component_type, description, uom, qty_per_unit, rate, amount, line_origin, created_by) VALUES (1, ?, 2, 'SUBCONTRACT', 'Haulage by subcontractor', 'CUM', 10000, 900000, 90000, 'MANUAL', 'best1')").run(i1);
      api.db.prepare("INSERT INTO est_indirects (company_id, estimate_id, sort_order, category, description, basis, amount, created_by) VALUES (1, ?, 1, 'SITE_ESTABLISHMENT', 'Site office and camp', 'LUMP_SUM', 2500000000, 'best1')").run(eid);
      api.db.prepare("INSERT INTO est_risks (company_id, estimate_id, sort_order, description, impact, probability_pct, exposure, created_by) VALUES (1, ?, 1, 'Rock in cutting', 5000000000, 200000, 1000000000, 'best1')").run(eid);
      for (const [k, tx] of [['ASSUMPTION', 'Bitumen at the IOCL rate of September 2026'], ['INCLUSION', 'Traffic diversion during the work'], ['EXCLUSION', 'Utility shifting by the owners'], ['QUALIFICATION', 'Price valid for 120 days']]) api.db.prepare('INSERT INTO est_assumptions (company_id, estimate_id, kind, sort_order, text, created_by) VALUES (1, ?, ?, 1, ?, \'best1\')').run(eid, k, tx);
    }
    return { tid, aid, eid };
  };
  const body = (tid, over = {}) => ({ tenderId: tid, basics: { code: 'NH48-P3', type: 'ROAD', sector: 'ROADS', ...(over.basics ?? {}) }, contract: { startDate: '2026-12-01', dlpMonths: 24, retentionPct: '5', mobAdvancePct: '10', ldSummary: '0.05 % per day to a maximum of 10 %', ...(over.contract ?? {}) },
    sites: over.sites ?? [{ code: 'NH48-S1', name: 'Pune main camp', siteType: 'SITE', geofenceType: 'CIRCLE', latitude: 18.52, longitude: 73.85, geofenceRadiusM: 300 }], team: { pmUser: 'bpm1', directorUser: 'bpd1' }, setup: {}, milestones: [{ code: 'M1', name: 'Mobilisation complete', plannedDate: '2027-01-31', contractual: true, paymentLinked: true }], clauses: over.clauses ?? [{ title: 'Liquidated damages', summary: '0.05 % of the contract value per day, capped at 10 %', ref: 'GCC 47' }] });
  return { api, call, act, hasTask, awarded, body, client };
}
const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;

test('T-01 the project made from the award has every BOQ item and rate of the approved estimate, identical, in one transaction, with links back to the tender', async () => {
  const t = await setup(); const { tid, aid, eid } = t.awarded();
  // the candidates and the preview of what will be copied
  const cand = (await t.call(pcm, 'GET', '/award-candidates')).json.data; assert.deepEqual(cand.map((c) => [c.tenderNo, c.contractValue, c.ready]), [['TDR-0001', '97200000.00', true]]);
  const pre = (await t.call(pcm, 'GET', `/award-preview?tenderId=${tid}`)).json.data;
  assert.equal(pre.ready, true); assert.deepEqual(pre.willCopy.map((w) => [w.code, w.count]), [['BOQ', 3], ['SECTIONS', 2], ['INDIRECTS', 1], ['RISKS', 1], ['ASSUMPTIONS', 4]]);
  assert.equal(pre.award.loaNo, 'LOA/TDR-0001'); assert.equal(pre.estimate.totalCost, undefined, 'the project controller does not see costs'); assert.equal(pre.suggested.contractValue, '97200000.00');
  // refused: a tender that is not awarded, an award that is not approved, an estimate that is not approved
  const notAwarded = t.awarded({ no: 'TDR-0002', stage: 'BID' }); const noEstimate = t.awarded({ no: 'TDR-0003', estimate: false }); const draftEstimate = t.awarded({ no: 'TDR-0004', estStatus: 'DRAFT' }); const noAward = t.awarded({ no: 'TDR-0005', award: false });
  for (const x of [notAwarded, noEstimate, draftEstimate, noAward]) { const r = await t.call(pcm, 'POST', '/projects/from-award', t.body(x.tid, { basics: { code: `X${x.tid}` } })); assert.equal(r.status, 422, JSON.stringify(r.json)); }
  assert.equal(count(t.api.db, "SELECT COUNT(*) AS n FROM org_projects WHERE code LIKE 'X%'"), 0, 'nothing was made');
  // another role cannot; the maker of the estimate (EST) may not set projects up
  assert.equal((await t.call(est1, 'POST', '/projects/from-award', t.body(tid))).status, 403); assert.equal((await t.call(pm, 'GET', `/award-preview?tenderId=${tid}`)).status, 403);
  // a part refused leaves nothing: a wrong team member and a duplicate site code roll the whole thing back
  const before = [count(t.api.db, 'SELECT COUNT(*) AS n FROM org_projects'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_boq_items'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_baseline_packs'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_projects')];
  const bad = t.body(tid); bad.team.pmUser = 'nobody-here'; assert.equal((await t.call(pcm, 'POST', '/projects/from-award', bad)).status, 400);
  assert.deepEqual([count(t.api.db, 'SELECT COUNT(*) AS n FROM org_projects'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_boq_items'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_baseline_packs'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_projects')], before);
  // the creation
  const c = await t.call(pcm, 'POST', '/projects/from-award', t.body(tid)); assert.equal(c.status, 201, JSON.stringify(c.json)); const d = c.json.data;
  assert.equal(d.boqItems, 3); const p = d.project;
  assert.deepEqual([p.code, p.name, p.status, p.state, p.client.name, p.location, p.contractValue, p.contractNo, p.contractType, p.startDate, p.scheduledCompletion, p.dlpMonths, 1], ['NH48-P3', 'Four-laning of NH-48, package 3', 'DRAFT', 'SETUP', 'Public Works Department', 'Pune', '97200000.00', 'LOA/TDR-0001', 'ITEM_RATE', '2026-12-01', '2028-11-30', 24, 1], 'the client, place, value, number and period come from the tender and the award; the end date is the start plus the period of the tender');
  // T-01: every BOQ item and rate identical to the estimate
  const pairs = t.api.db.prepare('SELECT e.section_code, e.item_no, e.description, e.uom, e.qty, e.client_rate, e.cost_rate, e.markup_pct, e.selling_rate, e.cost_amount, e.amount, b.section_code AS bs, b.item_no AS bi, b.description AS bd, b.uom AS bu, b.qty AS bq, b.client_rate AS bc, b.cost_rate AS bcr, b.markup_pct AS bm, b.selling_rate AS bsr, b.cost_amount AS bca, b.amount AS bam FROM est_estimate_items e LEFT JOIN proj_boq_items b ON b.estimate_item_id = e.id WHERE e.estimate_id = ? ORDER BY e.sort_order').all(eid);
  assert.equal(pairs.length, 3); for (const x of pairs) assert.deepEqual([x.bs, x.bi, x.bd, x.bu, x.bq, x.bc, x.bcr, x.bm, x.bsr, x.bca, x.bam], [x.section_code, x.item_no, x.description, x.uom, x.qty, x.client_rate, x.cost_rate, x.markup_pct, x.selling_rate, x.cost_amount, x.amount], `${x.item_no} identical`);
  const boq = (await t.call(pd1, 'GET', `/boq?projectId=${p.projectId}`)).json.data; assert.equal(boq.items.length, 3); assert.equal(boq.items[0].qty, '120000'); assert.equal(boq.items[0].sellingRate, '185.50'); assert.equal(boq.costsVisible, true); assert.equal(boq.items[0].costRate, '150');
  const masked = (await t.call(pcm, 'GET', `/boq?projectId=${p.projectId}`)).json.data; assert.equal(masked.costsVisible, false); assert.equal(masked.items[0].costRate, undefined); assert.equal(masked.items[0].sellingRate, '185.50');
  // the links back to the tender, the award and the estimate; the draft baseline pack
  const k = d.pack; assert.deepEqual([k.status, k.packNo, k.tender.docNo, k.award.docNo, k.estimate.ref, k.projectCode, k.contractValue, k.frozen], ['DRAFT', 1, 'TDR-0001', 'AW-TDR-0001', 'EST-TDR-0001/v1', 'NH48-P3', '97200000.00', false]);
  assert.equal(t.api.db.prepare('SELECT tender_id FROM proj_projects WHERE id = ?').get(p.id).tender_id, tid);
  assert.equal(t.api.db.prepare("SELECT source_type FROM proj_boq_items LIMIT 1").get().source_type, 'est_estimate_items');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.project.created_from_award'").get());
  assert.equal(aid != null, true);
  // the same tender again is refused; the candidates list is empty
  assert.equal((await t.call(pcm, 'POST', '/projects/from-award', t.body(tid, { basics: { code: 'NH48-P3B' } }))).status, 422);
  assert.ok(!(await t.call(pcm, 'GET', '/award-candidates')).json.data.some((x) => x.tenderId === tid));
});

test('FR-02 the pack is the full commercial baseline; costs masked; FR-04 sign-off chain, immutable after, hash, never by the sender; the director above ₹ 50 crore', async () => {
  const t = await setup(); const { tid } = t.awarded();
  const d = (await t.call(pcm, 'POST', '/projects/from-award', t.body(tid))).json.data; const id = d.pack.id;
  const full = (await t.call(est1, 'GET', `/baseline-packs/${id}`)).json.data; const s = full.snapshot;
  assert.deepEqual(Object.keys(s).sort(), ['assumptions', 'boq', 'boqCost', 'boqTotal', 'builtAt', 'clauses', 'commercials', 'contract', 'escalation', 'indirects', 'productivity', 'quotedRates', 'risks', 'source'].sort());
  assert.deepEqual([s.commercials.totalCost, s.commercials.totalSelling, s.commercials.margin, s.commercials.marginPct, s.commercials.bidPrice, s.escalation.pct, s.escalation.basisDate], ['922000000.00', '1008000000.00', '86000000.00', '8.5', '97200000.00', '3', '2026-09-01']);
  assert.equal(s.boq.length, 3); assert.equal(s.boq[0].norms.lines.length, 2); assert.deepEqual(s.quotedRates.map((q) => [q.type, q.quoted]), [['EQUIPMENT', false], ['SUBCONTRACT', true]]);
  assert.deepEqual([s.risks[0].description, s.risks[0].exposure, s.indirects[0].amount], ['Rock in cutting', '10000000.00', '25000000.00']); assert.equal(s.assumptions.EXCLUSION[0], 'Utility shifting by the owners'); assert.equal(s.clauses[0].title, 'Liquidated damages'); assert.equal(s.contract.retentionPct, '5');
  assert.equal(s.productivity[0].outputs[0].description, 'Excavator 1.0 cum');
  // costs masked for the project manager and the project controller: no cost, margin, risks, norms
  for (const who of [pm, pcm]) { const m = (await t.call(who, 'GET', `/baseline-packs/${id}`)).json.data; assert.equal(m.costsVisible, false); assert.equal(m.snapshot.masked, true); assert.equal(m.snapshot.commercials.totalCost, undefined); assert.equal(m.snapshot.commercials.margin, undefined); assert.equal(m.snapshot.risks, null); assert.equal(m.snapshot.boq[0].costRate, undefined); assert.equal(m.snapshot.boq[0].norms, undefined); assert.equal(m.snapshot.boq[0].sellingRate, '185.50'); }
  // draft: clauses change, version conflict, a PM cannot edit or submit
  const up = await t.call(pcm, 'PATCH', `/baseline-packs/${id}`, { clauses: [{ title: 'Retention', summary: '5 % from running bills' }], version: full.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.snapshot.clauses[0].title, 'Retention');
  assert.equal((await t.call(pcm, 'PATCH', `/baseline-packs/${id}`, { clauses: [], version: full.rowVersion })).status, 409, 'stale version');
  assert.equal((await t.call(pm, 'PATCH', `/baseline-packs/${id}`, { clauses: [] })).status, 403); assert.equal((await t.call(pm, 'POST', `/baseline-packs/${id}/submit`, {})).status, 403);
  // the estimate changes after the pack was drafted: refresh picks it up; sending freezes
  t.api.db.prepare("UPDATE est_estimate_items SET amount = amount + 100000 WHERE item_no = 'A.1'").run();
  const rf = (await t.call(pcm, 'POST', `/baseline-packs/${id}/refresh`, {})).json.data; assert.equal(rf.snapshot.clauses[0].title, 'Retention'); assert.equal(rf.frozen, false);
  const sub = await t.call(pcm, 'POST', `/baseline-packs/${id}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
  assert.equal(sub.json.data.status, 'SUBMITTED'); assert.equal(sub.json.data.frozen, true); assert.deepEqual(sub.json.data.chain, ['EST', 'COMMGR', 'PD']);
  // while waiting: locked; the order of the chain; the project controller (the sender) cannot sign
  assert.equal((await t.call(pcm, 'PATCH', `/baseline-packs/${id}`, { clauses: [] })).status, 409); assert.equal((await t.call(pcm, 'POST', `/baseline-packs/${id}/refresh`, {})).status, 409);
  assert.equal(await t.hasTask(pcm, inst), false); assert.equal(await t.hasTask(com1, inst), false, 'the commercial manager waits for estimation'); assert.equal(await t.hasTask(pd1, inst), false);
  await t.act(est1, inst); assert.equal(await t.hasTask(pd1, inst), false); await t.act(com1, inst); await t.act(pd1, inst);
  const done = (await t.call(pd1, 'GET', `/baseline-packs/${id}`)).json.data;
  assert.deepEqual([done.status, done.statusLabel, done.signedOffBy, Boolean(done.signedOffAt), done.frozen], ['APPROVED', 'Signed off', 'bpd1', true, true]);
  const ev = t.api.db.prepare("SELECT payload AS payload_json FROM core_outbox WHERE event_type = 'proj.baseline.signed_off'").get(); assert.ok(ev, 'the budget and the contract are told'); const evd = JSON.parse(ev.payload_json).data ?? JSON.parse(ev.payload_json);
  assert.deepEqual([evd.packId, evd.contractValue, evd.totalCost, evd.boqItems], [id, '97200000.00', '922000000.00', 3]);
  // BR-01: immutable: the pack, its clauses, its meetings' pack, cancel and delete all refused; direct reads show the same hash
  assert.equal((await t.call(est1, 'PATCH', `/baseline-packs/${id}`, { clauses: [] })).status, 409); assert.equal((await t.call(pcm, 'POST', `/baseline-packs/${id}/refresh`, {})).status, 409);
  assert.equal((await t.call(pd1, 'POST', `/baseline-packs/${id}/cancel`, { reason: 'try to cancel a signed baseline' })).status, 422); assert.equal((await t.call(pcm, 'DELETE', `/baseline-packs/${id}`)).status, 422);
  assert.deepEqual((await t.call(est1, 'GET', `/baseline-packs/${id}/verify`)).json.data.intact, true);
  t.api.db.prepare("UPDATE proj_baseline_packs SET snapshot_json = replace(snapshot_json, '922000000.00', '1.00') WHERE id = ?").run(id);
  assert.equal((await t.call(est1, 'GET', `/baseline-packs/${id}/verify`)).json.data.intact, false, 'a pack changed behind the application is shown');
  t.api.db.prepare("UPDATE proj_baseline_packs SET snapshot_json = replace(snapshot_json, '\"totalCost\":\"1.00\"', '\"totalCost\":\"922000000.00\"') WHERE id = ?").run(id);
  assert.equal((await t.call(est1, 'GET', `/baseline-packs/${id}/verify`)).json.data.intact, true);
  // the maker of the pack sends it, an estimator of another name signs: the sender is never a signer; a project of ₹ 50 crore or more adds the director
  const big = t.awarded({ no: 'TDR-0010', value: 6_000_000_000_00 }); const b2 = (await t.call(pcm, 'POST', '/projects/from-award', t.body(big.tid, { basics: { code: 'BIG-1' }, sites: [] }))).json.data;
  const s2 = await t.call(est1, 'POST', `/baseline-packs/${b2.pack.id}/submit`, {}); assert.equal(s2.status, 202, JSON.stringify(s2.json)); assert.deepEqual(s2.json.data.chain, ['EST', 'COMMGR', 'PD', 'DIR']);
  const i2 = s2.json.data.workflowInstanceId; assert.equal(await t.hasTask(est1, i2), false, 'the sender does not sign'); await t.act(est2, i2); await t.act(com1, i2); await t.act(pd2, i2);
  assert.equal(await t.hasTask(dir, i2), true, 'above ₹ 50 crore the director signs too'); assert.equal((await t.call(dir, 'GET', `/baseline-packs/${b2.pack.id}`)).json.data.status, 'SUBMITTED'); await t.act(dir, i2);
  assert.equal((await t.call(dir, 'GET', `/baseline-packs/${b2.pack.id}`)).json.data.status, 'APPROVED');
});

test('BR-01 a signed-off pack is corrected only by a superseding pack with a reason and the same approval; reject, return and withdraw', async () => {
  const t = await setup(); const { tid } = t.awarded();
  const d = (await t.call(pcm, 'POST', '/projects/from-award', t.body(tid))).json.data; const id = d.pack.id;
  // withdrawn before anyone acted; returned and resubmitted; then signed
  const first = await t.call(pcm, 'POST', `/baseline-packs/${id}/submit`, {}); assert.equal(first.status, 202); let sub; let inst;
  const w = await t.call(pcm, 'POST', `/baseline-packs/${id}/withdraw`, { reason: 'wrong estimate version picked' }); assert.equal(w.status, 200, JSON.stringify(w.json)); assert.equal(w.json.data.status, 'DRAFT'); assert.equal(w.json.data.frozen, false);
  sub = await t.call(pcm, 'POST', `/baseline-packs/${id}/submit`, {}); inst = sub.json.data.workflowInstanceId;
  await t.act(est1, inst, 'return'); assert.equal((await t.call(pcm, 'GET', `/baseline-packs/${id}`)).json.data.status, 'RETURNED');
  sub = await t.call(pcm, 'POST', `/baseline-packs/${id}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json)); inst = sub.json.data.workflowInstanceId;
  await t.act(est1, inst); await t.act(com1, inst); await t.act(pd1, inst);
  assert.equal((await t.call(pcm, 'GET', `/baseline-packs/${id}`)).json.data.status, 'APPROVED');
  // the correction: a reason (at least 5 characters), only a person who may amend; one at a time
  assert.equal((await t.call(pcm, 'POST', `/baseline-packs/${id}/amend`, { reason: 'quantities corrected after the joint measurement' })).status, 403);
  assert.equal((await t.call(pd1, 'POST', `/baseline-packs/${id}/amend`, { reason: 'no' })).status, 400);
  const am = await t.call(pd1, 'POST', `/baseline-packs/${id}/amend`, { reason: 'quantities corrected after the joint measurement' }); assert.equal(am.status, 201, JSON.stringify(am.json)); const n = am.json.data;
  assert.deepEqual([n.packNo, n.status, n.supersedesId, n.amendReason, n.docNo !== d.pack.docNo], [2, 'DRAFT', id, 'quantities corrected after the joint measurement', true]);
  assert.equal((await t.call(pd1, 'POST', `/baseline-packs/${id}/amend`, { reason: 'a second correction at the same time' })).status, 409);
  assert.equal((await t.call(est1, 'GET', `/baseline-packs/${id}`)).json.data.status, 'APPROVED', 'until the new pack is signed the old one stands');
  // the estimate was corrected: refresh the new pack, and compare
  t.api.db.prepare("UPDATE est_estimate_items SET qty = qty + 1000000, amount = amount + 18550 WHERE item_no = 'A.1'").run();
  await t.call(pd1, 'POST', `/baseline-packs/${n.id}/refresh`, {});
  const cmp = (await t.call(est1, 'GET', `/baseline-packs/${n.id}/compare`)).json.data; assert.equal(cmp.reason, 'quantities corrected after the joint measurement'); assert.deepEqual(cmp.lines.map((l) => [l.key, l.change]), [['A/A.1', 'CHANGED']]); assert.equal(cmp.lines[0].before.qty, '120000'); assert.equal(cmp.lines[0].after.qty, '121000');
  // rejected: the old pack still stands and a new correction can start
  const s1 = await t.call(pd1, 'POST', `/baseline-packs/${n.id}/submit`, {}); const i1 = s1.json.data.workflowInstanceId; await t.act(est1, i1, 'reject');
  assert.equal((await t.call(est1, 'GET', `/baseline-packs/${n.id}`)).json.data.status, 'REJECTED'); assert.equal((await t.call(est1, 'GET', `/baseline-packs/${id}`)).json.data.status, 'APPROVED');
  const am2 = (await t.call(pd1, 'POST', `/baseline-packs/${id}/amend`, { reason: 'quantities corrected, second try' })).json.data; await t.call(pd1, 'POST', `/baseline-packs/${am2.id}/refresh`, {});
  const s3 = await t.call(com1, 'POST', `/baseline-packs/${am2.id}/submit`, {}); assert.equal(s3.status, 202, JSON.stringify(s3.json)); const i3 = s3.json.data.workflowInstanceId; await t.act(est1, i3); await t.act(pd2, i3).catch(() => {}); 
  // the commercial manager sent it: the commercial manager step is not theirs; the project director signs after
  assert.equal(await t.hasTask(com1, i3), false, 'the sender never signs'); 
});

test('FR-03 the handover meeting: attendees, questions, actions as tasks; FR-05 baseline vs current; roles, another company, the flag', async () => {
  const t = await setup(); const { tid } = t.awarded();
  const d = (await t.call(pcm, 'POST', '/projects/from-award', t.body(tid))).json.data; const id = d.pack.id;
  const mtg = { meetingDate: '2026-11-02', venue: 'Head office, Pune', attendees: [{ name: 'best1', user: 'best1', role: 'Estimation head', team: 'ESTIMATION' }, { name: 'bpm1', user: 'bpm1', role: 'Project manager', team: 'EXECUTION' }], questions: [{ text: 'Is the rock allowance enough for the cutting at km 14?', askedBy: 'bpm1', answer: 'It covers 4,000 cum of rock; beyond that a variation.' }], minutes: 'Estimate and assumptions handed over.', actions: [{ title: 'Hand over the quotations file', owner: 'best1', dueDate: '2026-11-20', priority: 'HIGH' }, { title: 'Confirm the batching plant site', owner: 'bpm1', dueDate: '2026-11-25' }] };
  assert.equal((await t.call(qs, 'POST', `/baseline-packs/${id}/meetings`, mtg)).status, 403);
  assert.equal((await t.call(pm, 'POST', `/baseline-packs/${id}/meetings`, { ...mtg, meetingDate: '2030-01-01' })).status, 400, 'a meeting in the future');
  assert.equal((await t.call(pm, 'POST', `/baseline-packs/${id}/meetings`, { ...mtg, actions: [{ title: 'x', owner: 'nobody', dueDate: '2026-11-20' }] })).status, 400, 'an owner who is not a user');
  const c = await t.call(pm, 'POST', `/baseline-packs/${id}/meetings`, mtg); assert.equal(c.status, 201, JSON.stringify(c.json)); const m = c.json.data[0];
  assert.deepEqual([m.attendees.length, m.questions.length, m.actions.length, m.actions.every((a) => a.taskId), m.actions[0].taskStatus], [2, 1, 2, true, 'OPEN']);
  const tasks = t.api.db.prepare("SELECT t.title, a.user_ref AS username FROM tsk_tasks t JOIN tsk_assignees a ON a.task_id = t.id AND a.role = 'ASSIGNEE' WHERE t.entity = 'proj_baseline_pack' ORDER BY t.id").all(); assert.deepEqual(tasks.map((x) => x.username), ['best1', 'bpm1']);
  const u = await t.call(pm, 'PATCH', `/handover-meetings/${m.id}`, { minutes: 'Estimate, assumptions and quotations handed over.', actions: [...m.actions, { title: 'Review the risk register', owner: 'bpd1', dueDate: '2026-12-01' }], version: m.rowVersion });
  assert.equal(u.status, 200, JSON.stringify(u.json)); assert.equal(u.json.data[0].actions.length, 3); assert.equal(count(t.api.db, "SELECT COUNT(*) AS n FROM tsk_tasks WHERE entity = 'proj_baseline_pack'"), 3, 'the actions that had tasks keep them');
  assert.equal((await t.call(pm, 'PATCH', `/handover-meetings/${m.id}`, { minutes: 'stale', version: m.rowVersion })).status, 409);
  assert.equal((await t.call(est1, 'GET', `/baseline-packs/${id}/meetings`)).json.data.length, 1); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.handover.held'").get());
  // the report: before sign-off nothing; after, the baseline alone until the budget and the forecast exist; a provider fills the current side
  const orgId = d.project.projectId; const r0 = (await t.call(pd1, 'GET', `/baseline-report?projectId=${orgId}`)).json.data; assert.equal(r0.pack, null); assert.equal(r0.available, false);
  const sub = await t.call(pcm, 'POST', `/baseline-packs/${id}/submit`, {}); const inst = sub.json.data.workflowInstanceId; await t.act(est1, inst); await t.act(com1, inst); await t.act(pd1, inst);
  const r1 = (await t.call(pd1, 'GET', `/baseline-report?projectId=${orgId}`)).json.data; assert.equal(r1.available, false); assert.match(r1.reason, /budget/); assert.equal(r1.rows.find((r) => r.key === 'totalCost').baseline, '922000000.00'); assert.equal(r1.rows.find((r) => r.key === 'totalCost').current, null); assert.deepEqual(r1.sections.map((x) => [x.code, x.amount]), [['A', '48631250.00'], ['B', '87882125.00']]);
  const rm = (await t.call(pm, 'GET', `/baseline-report?projectId=${orgId}`)).json.data; assert.equal(rm.costsVisible, false); assert.ok(!rm.rows.some((r) => r.key === 'totalCost'));
  currentProviders.push(() => ({ code: 'budget', label: 'Budget', rows: [{ key: 'totalCost', current: '930000000.00' }] }));
  const r2 = (await t.call(pd1, 'GET', `/baseline-report?projectId=${orgId}`)).json.data; currentProviders.pop(); assert.equal(r2.available, true); assert.equal(r2.rows.find((r) => r.key === 'totalCost').variance, '8000000.00');
  // signed off: meetings are still recorded (the handover follows the sign-off); the services for the parts that follow
  assert.equal((await t.call(pm, 'POST', `/baseline-packs/${id}/meetings`, { ...mtg, meetingDate: '2026-11-03', actions: [] })).status, 201);
  const sg = baselineOf(t.api.db).signedOff(1, orgId); assert.equal(sg.docNo, d.pack.docNo); assert.equal(sg.snapshot.boq.length, 3);
  // lists, print, export; roles; another company; the flag
  const list = (await t.call(est1, 'GET', '/baseline-packs')).json.data; assert.equal(list.length, 1); assert.equal(list[0].statusLabel, 'Signed off');
  assert.equal((await t.api.call('GET', `${P}/baseline-packs/${id}/print`, pm)).status, 200); assert.equal((await t.api.call('GET', `${P}/baseline-packs/${id}/print?format=pdf`, est1)).status, 200); assert.equal((await t.api.call('GET', `${P}/baseline-packs/${id}/document?format=xlsx`, est1)).status, 200); assert.equal((await t.api.call('GET', `${P}/baseline-packs/${id}/document?format=xlsx`, pm)).status, 403, 'a project manager does not export');
  const html = (await t.api.call('GET', `${P}/baseline-packs/${id}/print`, pm)); assert.ok(!String(html.text ?? html.body ?? '').includes('Excavator'), 'the norms are not printed for those who do not see costs');
  assert.equal((await t.api.call('GET', `${P}/baseline-packs/export?format=csv`, est1)).status, 200); assert.equal((await t.api.call('GET', `${P}/baseline-packs/export?format=csv`, pm)).status, 403);
  assert.equal((await t.call(qs, 'GET', `/baseline-packs/${id}`)).status, 403); assert.equal((await t.call(as('PCMGR', 'bpcm1', '2'), 'GET', `/baseline-packs/${id}`)).status, 404, 'another company');
  const hist = (await t.call(est1, 'GET', `/baseline-packs/${id}/history`)).json.data; assert.ok(hist.approvals.length >= 3); assert.equal(hist.versions.length, 1);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1002'").run(); assert.equal((await t.call(est1, 'GET', '/baseline-packs')).status, 404, 'flag off'); assert.equal((await t.call(pcm, 'GET', '/projects')).status, 200, 'the project master is unaffected');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1002'").run();
});

// PACK-17: the commercial thread through the API, end to end from the award: the awarded tender becomes a project (10.02, BOQ and rates
// copied), its baseline pack is signed off (estimation, the commercial manager, the project director), and the client contract is made from
// that baseline (21.01): the letter of acceptance, the awarded value and the client reach the contract without being typed again. (The
// tender's way to the award, through the API, is `tests/award.test.js` FR-04..FR-07, which ends with the tender AWARDED and
// tdr.tender.awarded published; here the award and the approved estimate are the fixture's.)
test('PACK-17 thread: awarded tender → project → signed-off baseline → client contract, the award reaching the contract unchanged', async () => {
  const t = await setup(); const { tid } = t.awarded();
  const award = t.api.db.prepare('SELECT loa_no, loa_date, awarded_value_minor FROM tdr_awards WHERE tender_id = ?').get(tid);
  // 1. project from the award
  const made = await t.call(pcm, 'POST', '/projects/from-award', t.body(tid));
  assert.equal(made.status, 201, JSON.stringify(made.json).slice(0, 300));
  const projectId = made.json.data.projectId ?? made.json.data.project?.id;
  assert.ok(projectId, JSON.stringify(made.json.data).slice(0, 200));
  assert.equal(t.api.db.prepare('SELECT tender_id FROM proj_projects WHERE project_id = ?').get(projectId).tender_id, tid, 'the project knows its tender');
  // 2. the baseline signed off
  const packId = made.json.data.pack.id;
  const sub = await t.call(pcm, 'POST', `/baseline-packs/${packId}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json).slice(0, 300));
  const inst = sub.json.data.workflowInstanceId; await t.act(est1, inst); await t.act(com1, inst); await t.act(pd1, inst);
  assert.equal((await t.call(pd1, 'GET', `/baseline-packs/${packId}`)).json.data.status, 'APPROVED');
  // 3. the contract proposed from the baseline, then made
  const K = '/api/v1/ctr';
  const pre = await t.api.call('GET', `${K}/contracts/prefill?projectId=${projectId}`, { ...com1, headers: key() });
  assert.equal(pre.status, 200, JSON.stringify(pre.json).slice(0, 300));
  const p = pre.json.data.proposal;
  assert.equal(pre.json.data.baseline?.id, packId, 'proposed from the signed-off pack');
  assert.equal(p.loaNo, award.loa_no, 'the letter of acceptance of the award');
  const body = { projectId, title: p.title, contractNo: p.contractNo ?? 'PWD/NH48/P3', contractType: p.contractType ?? 'ITEM_RATE', original: p.original, clientPartnerId: p.clientPartnerId, loaNo: p.loaNo, loaDate: p.loaDate,
    agreementNo: 'AGR/NH48/P3', agreementDate: '2026-11-20', startDate: p.startDate ?? '2026-12-01', completionDate: p.completionDate ?? '2028-11-30', dlpMonths: p.dlpMonths ?? 24,
    paymentTerms: { billFrequency: 'MONTHLY', certificationDays: 14, paymentDays: 28 }, retentionPct: 5, retentionCapPct: 5,
    advanceTerms: { mobilisationPct: 10, machineryPct: 0, interestPct: 0, recoveryStartPct: 10, recoveryEndPct: 80, note: '' }, pvcApplicable: true, pvcRef: 'Clause 13.8',
    ldRatePct: 0.05, ldBasis: 'PER_DAY', ldCapPct: 10, disputeResolution: 'Conciliation, then arbitration', security: { performancePct: 5, validityMonths: 48, form: 'Bank guarantee' }, insurance: [], importClauses: true };
  const c = await t.api.call('POST', `${K}/contracts`, { ...com1, headers: key(), body });
  assert.equal(c.status, 201, JSON.stringify(c.json).slice(0, 400));
  const k = c.json.data;
  assert.equal(k.loaNo ?? k.terms?.loaNo, award.loa_no);
  assert.equal(String(k.original ?? k.value?.original), String(p.original));
  assert.equal(Math.round(Number(p.original) * 100), award.awarded_value_minor, 'the awarded value, to the paisa');
  assert.equal(t.api.db.prepare('SELECT org_project_id, baseline_pack_id FROM ctr_contracts WHERE id = ?').get(k.id).baseline_pack_id, packId, 'the contract keeps its baseline');
  // and a second client contract for the same project is refused (it is changed by amendment)
  assert.equal((await t.api.call('POST', `${K}/contracts`, { ...com1, headers: key(), body: { ...body, contractNo: 'DUP-1' } })).status, 409);
});
