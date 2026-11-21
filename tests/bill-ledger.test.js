import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, approvedContract, as, fill, key, ready } from './ctr-helpers.js';
import { billOf } from '../src/server/modules/bill/index.js';
import { recoveryOf } from '../src/server/modules/bill/ledger.js';
import { readDlpReleaseEvidence } from '../src/server/modules/close/retention.js';
import { publishEvent } from '../src/server/platform/events/index.js';

// Part 22.07: the retention and deposit ledger is filled by the events of the bills (once for each bill), balances are never negative; the advance recovery schedule over several bills follows the rule and never exceeds what is outstanding (T-01); releases need their checklist and the chain; the summary gives the expected dates and the ageing.
const U = { ...BASE, qs2: as('QS', 'qs2'), com: as('COMMGR', 'com1'), pm: as('PM', 'pm1'), cfo2: as('CFO', 'cfo1') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const B = '/api/v1/bill';
async function world() {
  const r = await ready(opened); const d = r.d; const bc = (who, method, path, body) => r.api.call(method, `${B}${path}`, { ...who, headers: key(), body });
  const k = await approvedContract(r, { original: 1_000_000 }); d.prepare('UPDATE ctr_contracts SET dlp_months = 12, revised_completion = ? WHERE id = ?').run(day(-400), k.id);
  const sub = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'SUB1', 'Shree Earthworks', 'Shree', 'PARTNERSHIP', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const wo = fill(d, 'ctr_work_orders', { company_id: 1, wo_no: 'WO-1', org_project_id: r.A, subcontractor_id: sub, wo_type: 'ITEM_RATE', title: 'Earthwork', status: 'APPROVED', wo_state: 'ACCEPTED', value_paise: 10_000_000, end_date: day(-10), start_date: day(-100) });
  const w = { ...r, bc, k, sub, wo, sc: billOf(d).svc };
  w.certified = async (n, o = {}) => { publishEvent(d, { type: 'bill.client.certified', entity: 'bill_certifications', entityId: n, actorId: 'qs1', companyId: 1, projectId: r.A, data: { certId: n, certNo: `C/${n}`, certDate: day(-10 + n), billId: 100 + n, billNo: `SHA/RA-${n}`, projectId: r.A, contractId: k.id, retention: 21_000, advanceRecovery: 0, ...o } }); await r.drain(); };
  w.subApproved = async (n, o = {}) => { publishEvent(d, { type: 'bill.sub.approved', entity: 'bill_sub_bills', entityId: n, actorId: 'qs1', companyId: 1, projectId: r.A, data: { billId: 200 + n, billNo: `WO-1/SB-${n}`, projectId: r.A, woId: wo, subcontractorId: sub, periodTo: day(-10 + n), retention: 4_400, securityDeposit: 2_200, advanceRecovery: 0, ...o } }); await r.drain(); };
  w.advance = async (o = {}) => bc(U.qs, 'POST', '/advances', { projectId: r.A, siteId: null, direction: 'GIVEN', partyType: 'SUBCONTRACTOR', partyId: sub, contractId: null, woId: wo, poId: null, refNo: `ADV-${Math.random().toString(36).slice(2, 6)}`, type: 'MOBILISATION', amount: 100_000, advanceDate: day(-60), ruleMode: 'PCT_OF_BILL', rulePct: 20, ruleFixed: 0, interestPct: 12, bgId: null, notes: null, ...o });
  w.approveAdv = async (id, who = [U.pm, U.com, U.cfo]) => { assert.equal((await bc(U.qs, 'POST', `/advances/${id}/submit`)).status, 202); const f = r.wf('bill_advances', id); for (const u of who) assert.equal((await r.act(u, f)).status, 200); return (await bc(U.qs, 'GET', `/advances/${id}`)).json.data; };
  return w;
}

test('BR-01 the recovery of a bill follows the rule and never exceeds what is outstanding', () => {
  const rule = { mode: 'PCT_OF_BILL', pctBp: 2000, fixedPaise: 0 };
  assert.deepEqual(recoveryOf({ rule, billGross: 4_000_000, outstanding: 10_000_000 }), { principal: 800_000, interest: 0, outstandingAfter: 9_200_000 }); assert.equal(recoveryOf({ rule, billGross: 4_000_000, outstanding: 500_000 }).principal, 500_000, 'capped at the outstanding');
  assert.equal(recoveryOf({ rule: { mode: 'FIXED', fixedPaise: 300_000, pctBp: 0 }, billGross: 1, outstanding: 1_000_000 }).principal, 300_000); assert.equal(recoveryOf({ rule: { mode: 'FIXED', fixedPaise: 300_000, pctBp: 0 }, billGross: 1, outstanding: 100_000 }).outstandingAfter, 0);
  assert.equal(recoveryOf({ rule, billGross: 4_000_000, outstanding: 10_000_000, interestBp: 1200, since: '2026-01-01', asOf: '2026-04-11' }).interest, Math.round((10_000_000 * 100 * 1200) / (10000 * 365)), '12% a year on the outstanding for 100 days');
});

test('Part 26.03 reads scoped DLP-end release evidence through Billing without changing the ledger', async () => {
  const w = await world();
  const { d } = w;
  const flags = billOf(d).flags;
  const actor = { companyId: 1, user: U.qs.user, roles: ['QS'] };
  const otherCompanyId = fill(d, 'org_companies', { code: 'DLP-OTHER', legal_name: 'Other company', short_name: 'Other' });
  const input = { projectId: w.A, partyType: 'SUBCONTRACTOR', woId: w.wo, releaseType: 'RETENTION', basis: 'DLP_END', amount: 600 };
  const read = (request = input, who = actor) => readDlpReleaseEvidence({ db: d, flags }, who, request);
  const seed = d.prepare(`SELECT default_enabled, enabled FROM core_feature_flags
    WHERE key = 'ff.close.p2603' AND company_id IS NULL AND environment IS NULL`).get();
  assert.deepEqual({ ...seed }, { default_enabled: 0, enabled: 0 });
  const sign = d.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  sign.run(1, 'G1', 'Platform Gate');
  sign.run(otherCompanyId, 'G2', 'Workforce Gate');
  assert.throws(read, { status: 404 });
  d.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.close.p2603'").run();
  assert.throws(read, { status: 404 }, 'G2 must be passed in the caller’s company');
  sign.run(1, 'G2', 'Workforce Gate');
  sign.run(otherCompanyId, 'G1', 'Platform Gate');
  await w.subApproved(1, { retention: 1_000, securityDeposit: 0 });

  const ncrId = fill(d, 'qa_ncrs', { company_id: 1, org_project_id: w.A, responsible_type: 'SUBCONTRACTOR',
    responsible_id: w.sub, severity: 'MINOR', status: 'OPEN', description: 'Open concrete defect' });
  const evidence = read();
  assert.equal(evidence.balance, 1000);
  assert.equal(evidence.expectedDate, day(-10));
  assert.equal(evidence.checklist.find(({ code }) => code === 'PERIOD_END').ok, true);
  assert.equal(evidence.checklist.find(({ code }) => code === 'NO_DEFECTS').ok, false);
  d.prepare("UPDATE qa_ncrs SET status = 'CLOSED' WHERE id = ?").run(ncrId);
  assert.equal(read().checklist.find(({ code }) => code === 'NO_DEFECTS').ok, true);
  assert.equal(read({ ...input, amount: 1001 }).checklist.find(({ code }) => code === 'BALANCE').ok, false);

  assert.throws(() => read({ ...input, basis: 'PARTIAL' }), { status: 400 });
  assert.throws(() => read({ ...input, projectId: w.B }), { status: 400 }, 'a work order from another project is refused');
  assert.throws(() => read(input, { companyId: 1, user: U.se.user, roles: ['SE'] }), { status: 404 });
  assert.throws(() => read(input, { companyId: otherCompanyId, user: actor.user, roles: ['QS'] }), { status: 404 });
  const ledgerOverride = d.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.bill.p2207', 1, 'Disable the ledger in this fixture', 0, 0)`).run().lastInsertRowid;
  assert.throws(read, { status: 404 });
  d.prepare('DELETE FROM core_feature_flags WHERE id = ?').run(ledgerOverride);

  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bill_releases').get().n, 0);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bill_retention_ledger WHERE txn_type = 'RELEASED'").get().n, 0);
});

test('FR-01 the retention and deposit ledger follows the bills once each; the summary has the balance, the expected date and the ageing', async () => {
  const w = await world(); await w.certified(1); await w.certified(2, { retention: 9_000 }); await w.certified(1); await w.subApproved(1); await w.subApproved(2, { retention: 1_600, securityDeposit: 0 });
  const cl0 = await w.bc(U.qs, 'GET', '/retention?partyType=CLIENT'); assert.equal(cl0.status, 200, JSON.stringify(cl0.json)); const cl = cl0.json.data; assert.deepEqual([cl.rows.length, cl.rows[0].kind, cl.rows[0].deducted, cl.rows[0].released, cl.rows[0].balance, cl.rows[0].expectedDate], [1, 'RETENTION', 30_000, 0, 30_000, cl.rows[0].expectedDate], 'the first bill counted once (21,000 + 9,000)'); assert.equal(cl.rows[0].bucket, 'OVERDUE'); assert.equal(cl.ageing.find((x) => x.bucket === 'OVERDUE').balance, 30_000);
  const sb = (await w.bc(U.qs, 'GET', '/retention?partyType=SUBCONTRACTOR')).json.data; assert.deepEqual(sb.rows.map((x) => [x.kind, x.deducted, x.balance]), [['RETENTION', 6_000, 6_000], ['SD', 2_200, 2_200]], '4,400 + 1,600 retention and 2,200 deposit'); assert.equal(sb.rows[0].expectedDate, day(-10)); assert.equal(sb.rows[0].party, 'Shree Earthworks');
  const en = (await w.bc(U.qs, 'GET', `/retention/entries?partyType=CLIENT&kind=RETENTION&scopeId=${w.k.id}`)).json.data.rows; assert.deepEqual(en.map((x) => [x.type, x.ref, x.amount, x.balance]), [['DEDUCTED', 'SHA/RA-1', 21_000, 21_000], ['DEDUCTED', 'SHA/RA-2', 9_000, 30_000]]);
  assert.deepEqual(w.sc.retention.expectedCash(1).map((x) => [x.direction, x.kind, x.balance]), [['RECEIVABLE', 'RETENTION', 30_000], ['PAYABLE', 'RETENTION', 6_000], ['PAYABLE', 'SD', 2_200]]);
  assert.equal((await w.bc(U.xcli, 'GET', '/retention')).status, 403); assert.equal((await w.bc(U.pd, 'GET', '/retention/export?partyType=CLIENT')).status, 200); assert.equal((await w.bc(U.se, 'GET', '/retention')).status, 403);
});

test('FR-02 T-01 an advance given to a subcontractor: approved through the chain, recovered over several bills by its rule, never beyond the outstanding, with interest', async () => {
  const w = await world(); assert.equal((await w.bc(U.se, 'POST', '/advances', {})).status, 403); assert.equal((await w.advance({ partyType: 'CLIENT' })).status, 400); assert.equal((await w.advance({ woId: null })).status, 400, 'a work order is chosen'); assert.equal((await w.advance({ rulePct: 0 })).status, 400, 'the rule is given'); const dup = await w.advance({ refNo: 'ADV-X' }); assert.equal(dup.status, 201); assert.equal((await w.advance({ refNo: 'ADV-X' })).status, 409);
  const a = (await w.advance()).json.data; assert.deepEqual([a.status, a.state, a.outstanding, a.recovered, a.direction], ['DRAFT', 'PROPOSED', 100_000, 0, 'GIVEN']); const ap = await w.approveAdv(a.id); assert.deepEqual([ap.status, ap.state], ['APPROVED', 'ACTIVE']);
  // the schedule: 20% of bills of 200,000, 250,000, 300,000, 150,000 and 400,000
  const pv = (await w.bc(U.qs, 'GET', `/advances/${a.id}/recovery-preview?bills=200000,250000,300000,150000,400000&asOf=${day(0)}`)).json.data; assert.deepEqual(pv.rows.map((x) => x.principal), [40_000, 50_000, 10_000, 0, 0], '40,000 + 50,000 + the 10,000 that is left'); assert.deepEqual([pv.fullyRecoveredAfter, pv.rows[2].outstandingAfter], [3, 0]);
  // the same through the bills (the events), once for each bill
  await w.subApproved(1, { advanceRecovery: 40_000, retention: 0, securityDeposit: 0 }); await w.subApproved(1, { advanceRecovery: 40_000, retention: 0, securityDeposit: 0 }); const v1 = (await w.bc(U.qs, 'GET', `/advances/${a.id}`)).json.data; assert.deepEqual([v1.recovered, v1.outstanding, v1.recoveredPct, v1.recoveries.length], [40_000, 60_000, 40, 1], 'the same bill is not recovered twice');
  await w.subApproved(2, { advanceRecovery: 50_000, retention: 0, securityDeposit: 0 }); await w.subApproved(3, { advanceRecovery: 60_000, retention: 0, securityDeposit: 0 }); const v3 = (await w.bc(U.qs, 'GET', `/advances/${a.id}`)).json.data; assert.deepEqual([v3.recovered, v3.outstanding, v3.state, v3.recoveries.map((x) => x.principal), v3.recoveries.at(-1).outstanding], [100_000, 0, 'RECOVERED', [40_000, 50_000, 10_000], 0], 'the third bill takes only the 10,000 that is left');
  assert.ok(v3.interestRecovered > 0, 'interest at 12% was worked out on the days'); assert.equal((await w.bc(U.qs, 'GET', `/advances/${a.id}/print`)).status, 200); assert.equal((await w.bc(U.qs, 'POST', `/advances/${a.id}/amend`, { reason: 'Change the amount' })).status, 422);
  await w.drain(); assert.equal(w.events('bill.advance.approved').length, 1);
});

test('FR-02 an advance received from the client is carried to the securities ledger of 21.02 and recovered from the certified bills', async () => {
  const w = await world(); const a = (await w.bc(U.qs, 'POST', '/advances', { projectId: w.A, siteId: null, direction: 'RECEIVED', partyType: 'CLIENT', partyId: w.k.clientPartnerId ?? w.client, contractId: w.k.id, woId: null, poId: null, refNo: 'MOB-1', type: 'MOBILISATION', amount: 50_000, advanceDate: day(-90), ruleMode: 'PCT_OF_BILL', rulePct: 10, ruleFixed: 0, interestPct: 0, bgId: null, notes: null })).json.data;
  const f = await w.approveAdv(a.id, [U.com, U.cfo]); assert.equal(f.status, 'APPROVED'); assert.equal(w.d.prepare('SELECT advance_paise FROM ctr_advances WHERE ref_no = ?').get('MOB-1').advance_paise, 5_000_000, 'the advance is in the securities ledger of 21.02');
  await w.certified(1, { advanceRecovery: 20_000, retention: 0 }); await w.certified(2, { advanceRecovery: 40_000, retention: 0 }); const v = (await w.bc(U.qs, 'GET', `/advances/${a.id}`)).json.data; assert.deepEqual([v.recovered, v.outstanding, v.state], [50_000, 0, 'RECOVERED'], '20,000 and the 30,000 that is left of the 40,000');
  // a big advance needs the direction as well
  const big = (await w.advance({ refNo: 'BIG-1', amount: 3_000_000 })).json.data; assert.equal((await w.bc(U.qs, 'POST', `/advances/${big.id}/submit`)).status, 202); const wf = w.wf('bill_advances', big.id); for (const u of [U.pm, U.com, U.cfo]) assert.equal((await w.act(u, wf)).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/advances/${big.id}`)).json.data.status, 'SUBMITTED', 'above 25 lakh the direction approves too'); assert.equal((await w.act(U.dir, wf)).status, 200);
});

test('FR-03 a release needs its checklist; failing checks need a reason; the chain approves it; the ledger and the payables follow; it is never more than the balance', async () => {
  const w = await world(); await w.subApproved(1, { retention: 1_000, securityDeposit: 0 }); const rel = (o = {}) => w.bc(U.qs, 'POST', '/releases', { projectId: w.A, siteId: null, releaseType: 'RETENTION', partyType: 'SUBCONTRACTOR', contractId: null, woId: w.wo, basis: 'DLP_END', amount: 600, bgId: null, waiverReason: null, notes: null, ...o });
  assert.equal((await rel({ amount: 2_000 })).status, 400, 'more than the balance of 1,000'); assert.equal((await w.bc(U.se, 'POST', '/releases', {})).status, 403);
  const pv = (await w.bc(U.qs, 'POST', '/releases/preview', { projectId: w.A, releaseType: 'RETENTION', partyType: 'SUBCONTRACTOR', contractId: null, woId: w.wo, basis: 'AGAINST_BG', amount: 600, bgId: null })).json.data; assert.deepEqual([pv.balance, pv.checklist.find((c) => c.code === 'BG_COVER').ok, pv.checklist.find((c) => c.code === 'BALANCE').ok], [1_000, false, true]);
  fill(w.d, 'qa_ncrs', { company_id: 1, org_project_id: w.A, responsible_type: 'SUBCONTRACTOR', responsible_id: w.sub, severity: 'MINOR', status: 'OPEN', description: 'Cracks' }); const r1 = (await rel()).json.data; assert.equal(r1.checksPass, false); assert.equal((await w.bc(U.qs, 'POST', `/releases/${r1.id}/submit`)).status, 400, 'a defect is open');
  w.d.prepare("UPDATE qa_ncrs SET status = 'CLOSED'").run(); const ok = await w.bc(U.qs, 'POST', `/releases/${r1.id}/submit`); assert.equal(ok.status, 202, JSON.stringify(ok.json)); const wf = w.wf('bill_releases', r1.id); for (const u of [U.com, U.pm]) assert.equal((await w.act(u, wf)).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/releases/${r1.id}`)).json.data.status, 'SUBMITTED'); assert.equal((await w.act(U.cfo, wf)).status, 200);
  const done = (await w.bc(U.qs, 'GET', `/releases/${r1.id}`)).json.data; assert.deepEqual([done.status, done.direction, done.releasedOn, done.checksPass], ['APPROVED', 'PAYABLE', day(0), true]); const s = (await w.bc(U.qs, 'GET', '/retention?partyType=SUBCONTRACTOR')).json.data.rows[0]; assert.deepEqual([s.deducted, s.released, s.balance], [1_000, 600, 400]); await w.drain(); const ev = w.events('bill.release.approved'); assert.deepEqual([ev.length, ev[0].amount, ev[0].balanceAfter, ev[0].direction], [1, 600, 400, 'PAYABLE']);
  // a second release is not more than what is left; a release that waives a failing check carries its reason
  assert.equal((await rel({ amount: 500 })).status, 400); const r2 = (await rel({ basis: 'AGAINST_BG', amount: 300 })).json.data; assert.equal((await w.bc(U.qs, 'POST', `/releases/${r2.id}/submit`)).status, 400, 'no guarantee is linked'); assert.equal((await w.bc(U.qs, 'PATCH', `/releases/${r2.id}`, { waiverReason: 'The client accepted a corporate guarantee instead' })).json.data.amount, 300, 'a partial update keeps the amount'); assert.equal((await w.bc(U.qs, 'POST', `/releases/${r2.id}/submit`)).status, 202);
  assert.equal((await w.bc(U.qs, 'POST', `/releases/${r1.id}/amend`, { reason: 'Change the amount' })).status, 422); assert.equal((await w.bc(U.qs, 'GET', `/releases/${r1.id}/print`)).status, 200); assert.equal((await w.bc(U.qs, 'GET', '/releases/export')).status, 200);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bill.p2207'").run(); assert.equal((await w.bc(U.qs, 'GET', '/releases')).status, 404); assert.equal((await w.bc(U.qs, 'GET', '/advances')).status, 404); assert.equal((await w.bc(U.qs, 'GET', '/retention')).status, 404);
});
