import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { gstinCheckChar } from '../src/shared/gst.js';
import { depFor, wdvRate } from '../src/server/modules/fin/assets.js';

// Part 23.09: fixed assets and depreciation.
//  T-01 SLM and WDV computations match worked examples; the disposal's gain or loss is right.
//  and: capitalisation from an AP bill and from CWIP (settled, posted), drafts from the equipment register and small assets; the monthly run once a period (BR-01)
//  posted by project; transfer; disposal with depreciation to the day before (BR-01), through the accounts manager, the CFO and a director above ₹10 lakh, the sale
//  becoming a receivable to invoice; physical verification by QR tag; the fixed asset schedule and the tax depreciation by block; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), dir: as('DIR', 'dir1'), pm: as('PM', 'pm1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';
const g = (first14) => `${first14}${gstinCheckChar(first14)}`;

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  d.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', ?) ON CONFLICT(company_id) DO UPDATE SET gstins_json = excluded.gstins_json").run(JSON.stringify([{ gstin: g('36AAACM1234F1Z'), stateCode: '36' }]));
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, constitution, pan, partner_status, steward_role, created_by) VALUES (1, 'V1', 'Deccan Earthmovers', 'PRIVATE_LIMITED', 'AABCD1111A', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  let n = 0; const bill = (account, gross, date = '2026-04-01') => { n += 1; return fill(d, 'ap_bills', { company_id: 1, doc_no: `AP/${n}`, bill_source: 'DIRECT', partner_id: vendor, payee_name: 'Deccan Earthmovers', bill_no: `DE-${n}`, bill_date: date, due_date: date, org_project_id: r.A, expense_account_id: acct(account), gross_paise: gross * 100, gst_input_paise: Math.round(gross * 18), total_paise: Math.round(gross * 118), net_payable_paise: Math.round(gross * 118), status: 'APPROVED' }); };
  /** Capitalised: made by the accounts manager, approved by the CFO. */
  const capitalise = async (body) => { const c = await call(U.acc, 'POST', '/assets', { projectId: r.A, ...body }); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal((await call(U.acc, 'POST', `/assets/${c.json.data.id}/submit`)).status, 202); assert.equal((await r.act(U.cfo, r.wf('fa_assets', c.json.data.id))).status, 200); return (await call(U.acc, 'GET', `/assets/${c.json.data.id}`)).json.data; };
  return { ...r, call, acct, vendor, bill, capitalise };
}

test('T-01 SLM and WDV match worked examples; the monthly run (BR-01) posted by project; disposal gain or loss; approvals by amount', async () => {
  // worked examples (Schedule II): SLM ₹12,00,000, residual 5 %, 12 years → ₹7,916.67 a month; WDV ₹10,00,000, residual 5 %, 8 years → 31.23 % a year
  assert.equal(depFor({ cost: 120000000, residual: 6000000, lifeMonths: 144, method: 'SLM', accumulated: 0, fyBase: 120000000 }, '2026-04-01', '2026-04-30'), 791667);
  assert.equal(depFor({ cost: 120000000, residual: 6000000, lifeMonths: 144, method: 'SLM', accumulated: 0, fyBase: 120000000 }, '2026-04-16', '2026-04-30'), 395833, 'half of April by days');
  const r = wdvRate(100000000, 5000000, 96); assert.equal(Math.round(r * 10000), 3123);
  assert.equal(depFor({ cost: 100000000, residual: 5000000, lifeMonths: 96, method: 'WDV', accumulated: 0, fyBase: 100000000 }, '2026-04-01', '2027-03-31'), Math.round(100000000 * r), 'a full year is the rate on the opening value');
  assert.equal(depFor({ cost: 100000000, residual: 5000000, lifeMonths: 96, method: 'WDV', accumulated: 99000000, fyBase: 1000000 }, '2026-04-01', '2027-03-31'), 0, 'never below the residual value');
  // the API: an excavator from an AP bill (SLM), a tipper (WDV), both in project A
  const w = await world(); const d = w.d;
  const b1 = w.bill('110001', 1200000); const b2 = w.bill('110002', 1000000);
  assert.equal((await w.call(U.se, 'POST', '/assets', { source: 'AP_BILL', billId: b1, classCode: 'EARTHMOVING' })).status, 403);
  const exp = (await w.call(U.acc, 'POST', '/assets', { source: 'AP_BILL', billId: w.bill('510001', 1000), classCode: 'EARTHMOVING' })); assert.equal(exp.status, 400, 'a bill booked to an expense is not capitalised');
  const ex = await w.capitalise({ source: 'AP_BILL', billId: b1, classCode: 'PM_CONSTRUCTION', usefulLifeMonths: 144, custodian: 'pm1' }); assert.equal(ex.status, 'APPROVED'); assert.equal(ex.state, 'IN_USE'); assert.equal(ex.residual, 60000); assert.equal(ex.cost, 1200000);
  const tp = await w.capitalise({ source: 'AP_BILL', billId: b2, classCode: 'VEHICLE', description: 'Tipper TS09UB4455' }); assert.equal(tp.method, 'WDV'); assert.equal(tp.wdvRatePct, 31.2344, '1 − 0.05 ^ (1 ÷ 8)');
  assert.equal((await w.call(U.acc, 'POST', '/assets', { source: 'AP_BILL', billId: b1, classCode: 'PM_CONSTRUCTION', cost: 1 })).status, 400, 'the bill is fully capitalised');
  // the monthly runs April to October; BR-01 once a period, never an earlier month after a later one
  assert.equal((await w.call(U.fin, 'POST', '/depreciation/run', { period: '2026-04' })).status, 403);
  for (const p of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) { const x = await w.call(U.acc, 'POST', '/depreciation/run', { period: p }); assert.equal(x.status, 201, `${p}: ${JSON.stringify(x.json)}`); }
  assert.equal((await w.call(U.acc, 'POST', '/depreciation/run', { period: '2026-10' })).status, 409); assert.equal((await w.call(U.acc, 'POST', '/depreciation/run', { period: '2026-03' })).status, 409);
  const apr = (await w.call(U.acc, 'GET', '/depreciation?period=2026-04')).json.data; assert.equal(apr.lines.find((l) => l.assetId === ex.id).dep, 7916.67); assert.equal(apr.lines.find((l) => l.assetId === tp.id).dep, Math.round(100000000 * r * 30 / 365) / 100);
  const jl = d.prepare('SELECT a.code, l.debit_paise, l.credit_paise, l.project_id FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = (SELECT journal_id FROM fa_dep_runs WHERE period = ?) ORDER BY a.code').all('2026-04');
  assert.deepEqual(jl.map((x) => x.code), ['119001', '119002', '550001']); assert.equal(jl[2].debit_paise, jl[0].credit_paise + jl[1].credit_paise);
  const ex2 = (await w.call(U.acc, 'GET', `/assets/${ex.id}`)).json.data; assert.equal(ex2.accumulated, 55416.69); assert.equal(ex2.depreciation.filter((x) => x.posted).length, 7); assert.ok(ex2.depreciation.some((x) => !x.posted), 'the schedule ahead is shown');
  // transfer to project B
  const tr = await w.call(U.acc, 'POST', `/assets/${ex.id}/transfer`, { date: '2026-11-02', toProjectId: w.B, toCustodian: 'pm2', reason: 'Mobilised to Tower B foundations', version: ex2.version }); assert.equal(tr.status, 200, JSON.stringify(tr.json)); assert.equal(tr.json.data.projectId, w.B);
  // disposal on 16-11: depreciation 1 to 15 November, WDV, loss; above ₹10 lakh a director approves after the CFO
  const buyer = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, constitution, pan, partner_status, steward_role, created_by) VALUES (1, 'B1', 'Sai Equipment Resale', 'PRIVATE_LIMITED', 'AABCS9999K', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  fill(d, 'mdm_partner_gstins', { company_id: 1, partner_id: buyer, gstin: g('36AABCS9999K1Z'), state_code: '36', gstin_status: 'ACTIVE' });
  assert.equal((await w.call(U.acc, 'POST', '/disposals', { assetId: ex.id, date: '2026-10-20', method: 'SALE', buyerPartnerId: buyer, proceeds: '1100000', reason: 'Replaced by a larger machine' })).status, 422, 'not dated within a month already depreciated');
  const dp = await w.call(U.acc, 'POST', '/disposals', { assetId: ex.id, date: '2026-11-16', method: 'SALE', buyerPartnerId: buyer, proceeds: '1100000', hsn: '7308', reason: 'Replaced by a larger machine' }); assert.equal(dp.status, 201, JSON.stringify(dp.json));
  assert.equal(dp.json.data.depToDate, 3958.33); assert.equal(dp.json.data.wdv, 1140624.98); assert.equal(dp.json.data.gainLoss, -40624.98); assert.equal(dp.json.data.gst, 198000);
  assert.equal((await w.call(U.acc, 'POST', `/disposals/${dp.json.data.id}/submit`)).status, 202); const inst = w.wf('fa_disposals', dp.json.data.id);
  assert.equal((await w.act(U.cfo, inst)).status, 200); assert.equal((await w.call(U.acc, 'GET', `/disposals/${dp.json.data.id}`)).json.data.status, 'SUBMITTED', 'a director still to approve');
  assert.equal((await w.act(U.dir, inst)).status, 200); const done = (await w.call(U.acc, 'GET', `/disposals/${dp.json.data.id}`)).json.data; assert.equal(done.status, 'APPROVED'); assert.equal(done.asset.state, 'DISPOSED');
  const dj = d.prepare('SELECT a.code, l.debit_paise, l.credit_paise FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY a.code').all(done.journalId);
  assert.deepEqual(dj.map((x) => [x.code, x.debit_paise, x.credit_paise]), [['110001', 0, 120000000], ['119001', 5541669, 0], ['160010', 110000000, 0], ['550001', 395833, 0], ['560013', 4062498, 0]]);
  await w.drain(); const ar = d.prepare("SELECT * FROM ar_invoices WHERE source_type = 'fa_disposals' AND source_id = ?").get(String(done.id)); assert.ok(ar, 'the sale is a receivable to invoice'); assert.equal(ar.status, 'DRAFT'); assert.equal(ar.taxable_paise, 110000000); assert.equal(ar.gst_paise, 19800000);
  assert.equal(d.prepare('SELECT ar_invoice_ref FROM fa_disposals WHERE id = ?').get(done.id).ar_invoice_ref, ar.doc_no);
  // a small scrap below ₹10 lakh: the CFO alone; a write-off has no proceeds and a loss of the WDV
  const sc = await w.call(U.acc, 'POST', '/disposals', { assetId: tp.id, date: '2026-11-10', method: 'WRITE_OFF', reason: 'Burnt in a fire at the yard' }); assert.equal(sc.status, 201); assert.ok(sc.json.data.gainLoss < 0); assert.equal(sc.json.data.proceeds, 0);
  assert.equal((await w.call(U.acc, 'POST', `/disposals/${sc.json.data.id}/submit`)).status, 202); assert.equal((await w.act(U.cfo, w.wf('fa_disposals', sc.json.data.id))).status, 200);
  assert.equal((await w.call(U.acc, 'GET', `/disposals/${sc.json.data.id}`)).json.data.status, 'APPROVED');
  assert.equal(w.events('fin.depreciation.posted').length, 7); assert.equal(w.events('fin.asset.disposed').length, 2);
});

test('CWIP settled into an asset; drafts from the equipment register and small assets; verification by QR; the schedules; rights', async () => {
  const w = await world(); const d = w.d;
  const c1 = w.bill('115001', 3000000, '2026-05-10'); const c2 = w.bill('115001', 2000000, '2026-06-15');
  const cw = await w.call(U.acc, 'POST', '/cwip', { title: 'Site office building, Tower A', projectId: w.A, billIds: [c1, c2] }); assert.equal(cw.status, 201, JSON.stringify(cw.json)); assert.equal(cw.json.data.cost, 5000000);
  assert.equal((await w.call(U.acc, 'POST', '/cwip', { title: 'again', billIds: [c1] })).status, 409);
  // prepared by the finance executive: the accounts manager, then the CFO
  const a = await w.call(U.fin, 'POST', '/assets', { source: 'CWIP', cwipId: cw.json.data.id, classCode: 'BUILDING', capDate: '2026-07-01', projectId: w.A }); assert.equal(a.status, 201, JSON.stringify(a.json)); assert.equal(a.json.data.cost, 5000000);
  assert.equal((await w.call(U.fin, 'POST', `/assets/${a.json.data.id}/submit`)).status, 202); const inst = w.wf('fa_assets', a.json.data.id);
  assert.equal((await w.act(U.acc, inst)).status, 200); assert.equal((await w.act(U.cfo, inst)).status, 200);
  const bld = (await w.call(U.acc, 'GET', `/assets/${a.json.data.id}`)).json.data; assert.equal(bld.state, 'IN_USE'); assert.ok(bld.journalId);
  const jl = d.prepare('SELECT a.code, l.debit_paise, l.credit_paise FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY a.code').all(bld.journalId); assert.deepEqual(jl.map((x) => [x.code, x.debit_paise, x.credit_paise]), [['110006', 500000000, 0], ['115001', 0, 500000000]]);
  assert.equal(d.prepare('SELECT cwip_status FROM fa_cwip WHERE id = ?').get(cw.json.data.id).cwip_status, 'SETTLED');
  // a machine registered as owned (17.01) and a small asset to capitalise (16.09): drafts for the accounts manager
  const eq = fill(d, 'plt_equipment', { company_id: 1, asset_code: 'EX-210', make: 'Tata Hitachi', model: 'EX210', ownership: 'OWNED', purchase_value: 450000000, purchase_date: '2026-08-01', org_project_id: w.A, status: 'APPROVED' });
  publishEvent(d, { type: 'plant.equipment.registered', entity: 'plt_equipment', entityId: eq, actorId: 'test', companyId: 1, data: { equipmentId: eq, docNo: 'EQ/1', assetCode: 'EX-210', ownership: 'OWNED', purchaseValue: 450000000, capitalise: true, projectId: w.A } });
  const sa = fill(d, 'ast_small_assets', { company_id: 1, tag_code: 'TS-001', asset_value: 2500000, purchase_date: '2026-08-05', org_project_id: w.A, status: 'APPROVED' });
  publishEvent(d, { type: 'inv.asset.registered', entity: 'ast_small_assets', entityId: sa, actorId: 'test', companyId: 1, data: { assetId: sa, tag: 'TS-001', value: 25000, capitalise: true } }); await w.drain();
  const drafts = d.prepare("SELECT * FROM fa_assets WHERE status = 'DRAFT' AND cap_source IN ('EQUIPMENT', 'SMALL_ASSET') ORDER BY id").all(); assert.equal(drafts.length, 2); assert.equal(drafts[0].cost_paise, 450000000); assert.equal(drafts[0].class_code, 'PM_CONSTRUCTION');
  const up = await w.call(U.acc, 'PATCH', `/assets/${drafts[0].id}`, { classCode: 'EARTHMOVING', version: drafts[0].version }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.lifeMonths, 108);
  assert.equal((await w.call(U.acc, 'POST', `/assets/${drafts[0].id}/submit`)).status, 202); assert.equal((await w.act(U.cfo, w.wf('fa_assets', drafts[0].id))).status, 200);
  // physical verification on the phone: the project manager scans the tags of project A
  const v = await w.call(U.pm, 'POST', '/asset-verifications', { projectId: w.A, date: '2026-11-18' }); assert.equal(v.status, 201, JSON.stringify(v.json)); assert.equal(v.json.data.expected, 2);
  const s = await w.call(U.pm, 'POST', `/asset-verifications/${v.json.data.id}/scan`, { code: `FA:${bld.docNo}`, condition: 'GOOD' }); assert.equal(s.status, 200); assert.equal(s.json.data.found, 1);
  assert.equal((await w.call(U.pm, 'POST', `/asset-verifications/${v.json.data.id}/scan`, { code: 'FA:NOPE' })).status, 404);
  const cl = await w.call(U.pm, 'POST', `/asset-verifications/${v.json.data.id}/close`); assert.equal(cl.json.data.status, 'CLOSED'); assert.equal(cl.json.data.lines.filter((l) => l.status === 'MISSING').length, 1);
  assert.equal((await w.call(U.pm, 'POST', '/depreciation/run', { period: '2026-07' })).status, 403);
  // the schedules for 2026-27
  for (const p of ['2026-07', '2026-08', '2026-09', '2026-10']) assert.equal((await w.call(U.acc, 'POST', '/depreciation/run', { period: p })).status, 201);
  const sch = (await w.call(U.cfo, 'GET', '/asset-reports/schedule?fy=2026-27')).json.data; const bRow = sch.rows.find((r) => r.classCode === 'BUILDING'); const eRow = sch.rows.find((r) => r.classCode === 'EARTHMOVING');
  assert.equal(bRow.additions, 5000000); assert.equal(bRow.grossClose, 5000000); assert.equal(bRow.netClose, Math.round((5000000 - bRow.depYear) * 100) / 100); assert.equal(eRow.additions, 4500000);
  const tb = (await w.call(U.cfo, 'GET', '/asset-reports/tax-blocks?fy=2026-27')).json.data; const pm = tb.blocks.find((x) => x.block === 'PM_GENERAL'); const bl = tb.blocks.find((x) => x.block === 'BUILDING');
  assert.equal(pm.additionsFull, 4500000, 'put to use 1 August: 180 days or more in the year'); assert.equal(pm.depreciation, 675000); assert.equal(bl.depreciation, 500000);
  // D-740: laptops taken over at go-live (put to use 2024): without an opening the block starts from their cost in 2024-25; with the block's opening WDV of 2026-27 it starts there
  const lp = await w.capitalise({ source: 'OPENING', classCode: 'COMPUTER', description: 'Laptops taken over', cost: '300000', capDate: '2024-06-01', openingAccum: '150000' }); assert.equal(lp.status, 'APPROVED');
  const tax = async () => (await w.call(U.cfo, 'GET', '/asset-reports/tax-blocks?fy=2026-27')).json.data; const cmp0 = (await tax()).blocks.find((x) => x.block === 'COMPUTERS'); assert.equal(cmp0.opening, 300000 * 0.6 * 0.6, 'carried from the cost at 40% a year');
  assert.equal((await w.call(U.cfo, 'PUT', '/asset-reports/tax-openings', { block: 'NOPE', fy: '2026-27', openingWdv: 1 })).status, 403, 'the CFO sees, the accounts manager enters');
  assert.equal((await w.call(U.acc, 'PUT', '/asset-reports/tax-openings', { block: 'NOPE', fy: '2026-27', openingWdv: 1 })).status, 400);
  const op = await w.call(U.acc, 'PUT', '/asset-reports/tax-openings', { block: 'COMPUTERS', fy: '2026-27', openingWdv: 90000 }); assert.equal(op.status, 200, JSON.stringify(op.json)); assert.equal(op.json.data[0].openingWdv, 90000);
  const t2 = await tax(); const cmp = t2.blocks.find((x) => x.block === 'COMPUTERS'); assert.equal(cmp.opening, 90000); assert.equal(cmp.additionsFull + cmp.additionsHalf, 0, 'the laptops are inside the opening'); assert.equal(cmp.depreciation, 36000); assert.equal(cmp.closing, 54000);
  assert.equal(t2.openings[0].block, 'COMPUTERS'); assert.equal((await w.call(U.cfo, 'GET', '/asset-reports/tax-blocks?fy=2025-26')).json.data.blocks.find((x) => x.block === 'COMPUTERS'), undefined, 'not computed before its opening year');
  assert.equal((await w.call(U.acc, 'DELETE', `/asset-reports/tax-openings/${op.json.data[0].id}`)).status, 200); assert.equal((await tax()).blocks.find((x) => x.block === 'COMPUTERS').opening, cmp0.opening);
  assert.equal((await w.call(U.aud, 'GET', '/assets')).status, 200); assert.equal((await w.call(U.se, 'GET', '/assets')).status, 403); assert.equal((await w.call(U.acc, 'GET', '/assets/export')).status, 200);
  assert.equal((await w.call(U.acc, 'GET', `/assets/${bld.id}/print`)).status, 200);
  // D-741: a disposal in finance of the asset of a registered machine makes the machine disposed of in the register (17.01), a deployed one released first
  d.prepare("UPDATE plt_equipment SET approved_at = '2026-08-01', equip_state = 'DEPLOYED' WHERE id = ?").run(eq);
  publishEvent(d, { type: 'fin.asset.disposed', entity: 'fa_disposals', entityId: 999, actorId: 'test', companyId: 1, data: { disposalId: 999, docNo: 'FAD/1', assetNo: drafts[0].doc_no, equipmentId: eq, method: 'SALE' } }); await w.drain();
  const me = d.prepare('SELECT equip_state, state_note FROM plt_equipment WHERE id = ?').get(eq); assert.equal(me.equip_state, 'DISPOSED'); assert.match(me.state_note, /FAD\/1/);
  assert.deepEqual(d.prepare("SELECT to_state FROM plt_timeline WHERE equipment_id = ? AND event = 'STATE' ORDER BY id").all(eq).map((x) => x.to_state), ['AVAILABLE', 'DISPOSED']);
});
