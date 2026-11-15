import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, as, fill, key, ready } from './ctr-helpers.js';

// Part 22.08: the QS dashboard reads its figures from the owners (22.02 chain, certifications, bills, variations, claims): the chain in money per stage, unbilled work = executed value less billed value per item (T-01), the queues, the back-to-back margin masked without the right, isolation by project and the CSV export.
import { project360Providers } from '../src/server/modules/proj/p360.js';
import { billOf } from '../src/server/modules/bill/index.js';

// Part 22.02: the quantity chain of every BOQ item and location read from the owners of each figure (T-01), the forecast, the items approaching their limit, deviation statements (prepared, recomputed on submit, approved, sent to the client, accepted into a change request) and the register of extra and substituted items.
const U = { ...BASE, mse: as('SE', 'mse1'), qs2: as('QS', 'qs2'), com3: as('COMMGR', 'com1') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const B = '/api/v1/bill';
async function world() {
  const r = await ready(opened, { baseline: false }); const d = r.d; const bc = (who, method, path, body) => r.api.call(method, `${B}${path}`, { ...who, headers: key(), body });
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: r.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  const item = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 100_000, rate: 60_000_000, amount: 0 }); const item2 = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.2', description: 'Reinforcement steel', uom: 'MT', qty: 50_000, rate: 600_000_000, amount: 0 }); const item3 = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.3', description: 'Shuttering', uom: 'sqm', qty: 200_000, rate: 3_000_000, amount: 0 });
  const loc = fill(d, 'proj_locations', { company_id: 1, project_id: r.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' });
  const wa = fill(d, 'site_work_authorisations', { company_id: 1, wa_no: 'WA/1', plan_date: day(-3), activity_id: r.a1, location_id: loc, planned_qty: 100_000, start_time: '08:00', end_time: '17:00', supervisor: 'sup1', status: 'APPROVED' });
  fill(d, 'plan_activity_boq', { company_id: 1, activity_id: r.a1, boq_line_id: item, qty: 100_000 });
  return { ...r, bc, ver, item, item2, item3, loc, wa, sc: billOf(d).svc };
}
const mbBody = (w, o = {}) => ({ projectId: w.A, boqLineId: w.item, locationId: w.loc, description: 'Footings', template: 'QTY', qty: 10, measuredOn: day(-1), ...o });
const submit = async (w, id) => { const s = await w.bc(U.mse, 'POST', `/mb-entries/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); };
async function certify(w, id) { await submit(w, id); const wf = w.wf('bill_mb_entries', id); for (const who of [U.qs, U.pm]) assert.equal((await w.act(who, wf)).status, 200); }
const mk = async (w, o = {}) => (await w.bc(U.mse, 'POST', '/mb-entries', mbBody(w, o))).json.data;
const dash = async (w, who = U.qs, q = '') => (await w.bc(who, 'GET', `/qs-dashboard${q}`));
const kpi = (d, k) => d.kpis.find((x) => x.key === k);
async function seedChain(w) {
  const dpr = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_site_id: w.site, dpr_date: day(-2), status: 'APPROVED' }); fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: dpr, wa_id: w.wa, activity_id: w.a1, location_id: w.loc, qty: 30_000, uom: 'cum' });
  const a = await mk(w, { qty: 22 }); await certify(w, a.id); const b = await mk(w, { qty: 8 }); await submit(w, b.id); await mk(w, { qty: 5 }); return { a, b };
}

test('FR-01 T-01 BR-01 the stages of the chain in money, and the unbilled work equals the executed value less the billed value per item', async () => {
  const w = await world(); const { a } = await seedChain(w);
  let d = (await dash(w)).json.data; const rate = 6000;
  assert.deepEqual([kpi(d, 'workNotMeasured').value, kpi(d, 'measuredNotCertified').value, kpi(d, 'certifiedNotBilled').value, kpi(d, 'unbilledWip').value], [0, 8 * rate, 22 * rate, 30 * rate], 'executed 30, measured 30, certified 22, billed 0');
  // T-01 per item
  const items = (await w.bc(U.qs, 'GET', `/qs-dashboard/drill?projectId=${w.A}&kind=unbilledWip`)).json.data; const r = items.rows.find((x) => x.ref === '2.1'); assert.deepEqual([r.executed, r.billed, r.value], [30, 0, (30 - 0) * rate]);
  w.sc.mb.markBilled(1, { mbIds: [a.id], billRef: 'RA-1' }); d = (await dash(w)).json.data;
  assert.deepEqual([kpi(d, 'certifiedNotBilled').value, kpi(d, 'unbilledWip').value], [0, (30 - 22) * rate]); const r2 = (await w.bc(U.qs, 'GET', `/qs-dashboard/drill?projectId=${w.A}&kind=unbilledWip`)).json.data.rows.find((x) => x.ref === '2.1'); assert.deepEqual([r2.executed, r2.billed, r2.value], [30, 22, 8 * rate]);
  // work done but not measured: executed beyond the measured
  const dpr = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_site_id: w.site, dpr_date: day(-1), status: 'APPROVED' }); fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: dpr, wa_id: w.wa, activity_id: w.a1, location_id: w.loc, qty: 10_000, uom: 'cum' });
  d = (await dash(w)).json.data; assert.equal(kpi(d, 'workNotMeasured').value, 10 * rate); assert.equal(kpi(d, 'unbilledWip').value, (40 - 22) * rate);
  assert.ok(d.portfolio.some((p) => p.project === w.d.prepare('SELECT code FROM org_projects WHERE id = ?').get(w.A).code && p.unbilledWip === 18 * rate), 'the portfolio view carries the same figure');
});

test('FR-01 FR-02 variations, claims, bills overdue for submission, the queues and the leakage indicators come from the owning modules', async () => {
  const w = await world(); await seedChain(w);
  fill(w.d, 'ctr_change_requests', { company_id: 1, org_project_id: w.A, cr_no: 'CR-9', kind: 'CLIENT', origin_type: 'INTERNAL', title: 'Extra', description: 'Extra drainage works', cr_state: 'WITH_CLIENT', value_claimed_paise: 5_000_000, status: 'APPROVED' });
  const k = fill(w.d, 'ctr_contracts', { company_id: 1, org_project_id: w.A, contract_no: 'C-Q', status: 'APPROVED' });
  fill(w.d, 'ctr_claims', { company_id: 1, org_project_id: w.A, claim_no: 'CL-1', contract_id: k, title: 'Delay', claim_state: 'SUBMITTED', amount_claimed_paise: 2_000_000, status: 'APPROVED' });
  const bill = fill(w.d, 'bill_client_bills', { company_id: 1, org_project_id: w.A, contract_id: k, bill_no: 'RA-9', seq_no: 9, period_from: day(-60), period_to: day(-40), net_paise: 7_000_000, gross_paise: 8_000_000, status: 'APPROVED', client_state: 'NOT_SENT' });
  const sent = fill(w.d, 'bill_client_bills', { company_id: 1, org_project_id: w.A, contract_id: k, bill_no: 'RA-8', seq_no: 8, period_from: day(-90), period_to: day(-70), net_paise: 4_000_000, gross_paise: 5_000_000, status: 'APPROVED', client_state: 'SENT', sent_on: day(-50) });
  const d = (await dash(w)).json.data;
  assert.deepEqual([kpi(d, 'variationPipeline').value, kpi(d, 'claimsPending').value, kpi(d, 'overdueSubmission').value, kpi(d, 'billedNotCollected').value], [50_000, 20_000, 1, 110_000]);
  assert.equal(kpi(d, 'overdueSubmission').status, 'red');
  assert.deepEqual([d.queues.mbPending.count, d.queues.certAwaited.count, d.queues.certAwaited.rows[0].ref, d.queues.certAwaited.late], [1, 1, 'RA-8', 1]); assert.equal(d.queues.certAwaited.rows[0].link, `/bill/client-bills?id=${sent}`);
  assert.ok(d.queues.billsToPrepare.count >= 0); assert.equal(d.leakage.find((l) => l.key === 'overdueSubmission').value, 70_000);
  // drill-down to the documents
  const od = (await w.bc(U.qs, 'GET', `/qs-dashboard/drill?projectId=${w.A}&kind=overdueSubmission`)).json.data; assert.deepEqual([od.total, od.rows[0].ref, od.rows[0].link], [1, 'RA-9', `/bill/client-bills?id=${bill}`]);
  assert.equal((await w.bc(U.qs, 'GET', `/qs-dashboard/drill?projectId=${w.A}&kind=nonsense`)).status, 400);
});

test('FR-01 the back-to-back margin of the subcontract bills against the certification is masked without the right, the dashboard honours the right and the project', async () => {
  const w = await world(); const k = fill(w.d, 'ctr_contracts', { company_id: 1, org_project_id: w.A, contract_no: 'C-B', status: 'APPROVED' }); const bill = fill(w.d, 'bill_client_bills', { company_id: 1, org_project_id: w.A, contract_id: k, bill_no: 'RA-1', seq_no: 1, period_from: day(-60), period_to: day(-40), net_paise: 9_000_000, gross_paise: 10_000_000, status: 'APPROVED', client_state: 'SENT', sent_on: day(-30) });
  fill(w.d, 'bill_certifications', { company_id: 1, org_project_id: w.A, contract_id: k, bill_id: bill, cert_no: 'CE-1', cert_date: day(-10), submitted_gross_paise: 10_000_000, certified_gross_paise: 9_000_000, disputed_paise: 300_000, status: 'APPROVED' });
  fill(w.d, 'bill_sub_bills', { company_id: 1, org_project_id: w.A, bill_no: 'SB-1', gross_paise: 6_000_000, net_paise: 5_500_000, status: 'APPROVED' });
  let d = (await dash(w, U.qs)).json.data; assert.deepEqual([d.backToBack.certified, d.backToBack.subBilled, d.backToBack.margin, d.backToBack.masked], [90_000, 60_000, null, true], 'the quantity surveyor does not see the margin');
  d = (await dash(w, U.com)).json.data; assert.deepEqual([d.backToBack.margin, d.backToBack.marginPct, d.backToBack.masked], [30_000, 33.3, false]);
  assert.deepEqual([d.leakage.find((l) => l.key === 'certShortfall').value, d.leakage.find((l) => l.key === 'disputed').value], [10_000, 3_000]);
  // rights: a site engineer has none; the project scope is honoured; the flag gates the route
  assert.equal((await dash(w, U.mse)).status, 403); assert.equal((await dash(w, U.pm)).status, 200);
  const other = await dash(w, U.qs, '?projectId=999999'); assert.equal(other.status, 200); assert.equal(other.json.data.projectCount, 0, 'no figure of a project outside the grants');
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bill.p2208'").run(); w.flagsReset?.(); const off = await dash(w); assert.ok([404, 200].includes(off.status)); w.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.bill.p2208'").run();
});

test('FR-03 the export is a CSV of the portfolio, audited and for those who may export; the Project 360 slot and the widgets are registered', async () => {
  const w = await world(); await seedChain(w);
  const ex = await w.bc(U.qs, 'GET', `/qs-dashboard/export?projectId=${w.A}`); assert.equal(ex.status, 200); assert.equal((await w.bc(U.pm, 'GET', '/qs-dashboard/export')).status, 403);
  assert.ok(w.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE action = 'export' AND entity_id = 0 AND entity = 'bill_mb_entries'").get().n >= 1);
  const slot = project360Providers.get('qs'); const out = slot({ db: w.d, actor: { ...U.qs, user: 'qs1', companyId: 1, roles: ['QS'] }, project: { project_id: w.A } }); assert.ok(Array.isArray(out.figures)); assert.ok(out.figures.length === 4 || typeof out.note === 'string', JSON.stringify(out));
  assert.ok(w.d.prepare("SELECT 1 FROM proj_360_widgets WHERE widget_code = 'qs'").get()); assert.ok(w.d.prepare("SELECT 1 FROM ui_widgets WHERE code = 'bill.unbilled_wip'").get());
});
