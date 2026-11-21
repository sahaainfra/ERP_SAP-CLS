import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { glOf } from '../src/server/modules/fin/index.js';
import { lineOfAccount, plLines } from '../src/server/modules/fin/projectpl.js';
import { readCloseoutSnapshotEvidence } from '../src/server/modules/close/financials.js';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { authzOf } from '../src/server/platform/authz/index.js';

// Part 23.12: the project P&L.
//  T-01 the P&L equals the ledger's totals; a frozen snapshot is not changed (and is frozen only as it was worked out).
//  and: the structure (account over group, the longest group, the catch-all) and its configuration; actual, budget and forecast; margins and drill-down;
//  ACCMGR → CFO freeze; the PM's view with the corporate overhead masked; the portfolio by project, sector, region and client; rights and isolation.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), pm: as('PM', 'pm1'), pd: as('PD', 'pd1'), se: as('SE', 'se9'), aud: as('AUD', 'aud1') };
const F = '/api/v1/fin';

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  let n = 0; const post = (date, project, lines) => { n += 1; return glOf(d).postEngine(1, { date, narration: `test ${n}`, sourceType: 'test', sourceId: n, lines: lines.map(([code, dr, cr]) => ({ accountId: acct(code), ...(dr ? { debit: String(dr) } : { credit: String(cr) }), projectId: project })) }).journal.id; };
  return { ...r, call, acct, post };
}

test('T-01 the structure maps every account once; the lines and subtotals add up', () => {
  const s = [{ line_code: 'REVENUE', line_type: 'REVENUE', map: { groups: ['41'] } }, { line_code: 'SITE', line_type: 'COST', map: { accounts: ['560004'] } }, { line_code: 'OTHERS', line_type: 'COST', map: { groups: ['5'] }, catch_all: 1 }, { line_code: 'MAT', line_type: 'COST', map: { groups: ['5100'] } }];
  assert.equal(lineOfAccount(s, { code: '560004', grp: '5600' }), 'SITE', 'an account named wins');
  assert.equal(lineOfAccount(s, { code: '510001', grp: '5100' }), 'MAT', 'the longest group wins');
  assert.equal(lineOfAccount(s, { code: '560010', grp: '5600' }), 'OTHERS'); assert.equal(lineOfAccount(s, { code: '420001', grp: '4200' }), 'OTHERS', 'the catch-all takes what no line names');
  const l = plLines([...s.slice(0, 2), { line_code: 'GP', line_type: 'GROSS_PROFIT' }, s[2], { line_code: 'OP', line_type: 'OPERATING_PROFIT' }], { REVENUE: 500000, SITE: 100000, OTHERS: 50000 });
  assert.deepEqual(l.map((x) => [x.code, x.amount, x.pct]), [['REVENUE', 500000, 100], ['SITE', 100000, 20], ['GP', 400000, 80], ['OTHERS', 50000, 10], ['OP', 350000, 70]]);
});

test('AC-01 the project P&L (actual, budget, forecast) equal to the ledger, frozen by the CFO; masked for the PM; the portfolio; rights', async () => {
  const w = await world(); const d = w.d;
  w.post('2026-10-05', w.A, [['140001', 500000, 0], ['410001', 0, 500000]]);
  w.post('2026-10-06', w.A, [['510001', 200000, 0], ['560001', 100000, 0], ['560004', 20000, 0], ['560030', 30000, 0], ['560010', 5000, 0], ['220001', 0, 355000]]);
  w.post('2026-09-20', w.A, [['510001', 50000, 0], ['220001', 0, 50000]]);
  w.post('2026-10-10', w.B, [['510001', 80000, 0], ['220001', 0, 80000]]); w.post('2026-10-11', w.B, [['140001', 60000, 0], ['410001', 0, 60000]]);
  // budget: a cost code under the materials head; the contract revenue
  const head = fill(d, 'fin_cost_heads', { company_id: 1, code: 'MAT-H', name: 'Materials', default_account_code: '510001' }); const cc = fill(d, 'fin_cost_codes', { company_id: 1, code: 'CONC', name: 'Concrete', cost_head_id: head });
  fill(d, 'ctr_contracts', { company_id: 1, org_project_id: w.A, contract_no: 'K-A', title: 'Main works', contract_type: 'ITEM_RATE', original_paise: 200000000, revised_paise: 200000000, status: 'APPROVED', contract_state: 'ACTIVE' });
  const b = fill(d, 'bud_budgets', { company_id: 1, org_project_id: w.A, version_no: 1, status: 'APPROVED', total_amount: 150000000 }); fill(d, 'bud_lines', { company_id: 1, budget_id: b, line_kind: 'DIRECT', cost_code_id: cc, amount: 120000000 }); fill(d, 'bud_lines', { company_id: 1, budget_id: b, line_kind: 'OVERHEAD', amount: 30000000 });
  const v = await w.call(U.cfo, 'GET', `/project-pl?projectId=${w.A}&period=2026-10`); assert.equal(v.status, 200, JSON.stringify(v.json)); const x = v.json.data; const line = (lines, c) => lines.find((l) => l.code === c);
  assert.deepEqual(['REVENUE', 'MATERIAL', 'SUBCONTRACT', 'SITE_OVERHEAD', 'GROSS_PROFIT', 'CORPORATE_OVERHEAD', 'OTHER', 'OPERATING_PROFIT'].map((c) => line(x.month, c).amount), [500000, 200000, 100000, 20000, 180000, 30000, 5000, 145000]);
  assert.equal(line(x.month, 'GROSS_PROFIT').pct, 36); assert.equal(line(x.cumulative, 'MATERIAL').amount, 250000, 'to date includes September');
  assert.deepEqual(x.reconciled, { gl: 95000, pl: 95000, equal: true }, 'T-01: the P&L equals the ledger to date');
  assert.equal(line(x.budget.lines, 'REVENUE').amount, 2000000); assert.equal(line(x.budget.lines, 'MATERIAL').amount, 1200000, 'cost code → head → account → line'); assert.equal(line(x.budget.lines, 'SITE_OVERHEAD').amount, 300000);
  // drill-down from a line to the journal lines
  const dr = (await w.call(U.cfo, 'GET', `/project-pl/drill?projectId=${w.A}&line=MATERIAL&from=2026-10-01&to=2026-10-31`)).json.data; assert.equal(dr.rows.length, 1); assert.equal(dr.rows[0].debit, 200000);
  // the PM sees his project without the corporate overhead and the operating profit
  const pm = (await w.call(U.pm, 'GET', `/project-pl?projectId=${w.A}&period=2026-10`)).json.data; assert.equal(line(pm.month, 'CORPORATE_OVERHEAD').amount, null); assert.equal(line(pm.month, 'OPERATING_PROFIT').amount, null); assert.equal(line(pm.month, 'GROSS_PROFIT').amount, 180000); assert.equal(pm.overheadsMasked, true);
  assert.equal((await w.call(U.pm, 'GET', `/project-pl/drill?projectId=${w.A}&line=CORPORATE_OVERHEAD&from=2026-10-01&to=2026-10-31`)).status, 403);
  // the structure: 560010 moved to site overhead; an account named by two lines is refused
  assert.equal((await w.call(U.pm, 'PUT', '/pl-structure/SITE_OVERHEAD', { accounts: ['560004', '560010'] })).status, 403);
  assert.equal((await w.call(U.acc, 'PUT', '/pl-structure/SUBCONTRACT', { accounts: ['560001', '560004'] })).status, 400, 'named by another line');
  const st = await w.call(U.acc, 'PUT', '/pl-structure/SITE_OVERHEAD', { accounts: ['560004', '560010'] }); assert.equal(st.status, 200, JSON.stringify(st.json)); assert.equal(st.json.data.own, true);
  assert.equal(line((await w.call(U.cfo, 'GET', `/project-pl?projectId=${w.A}&period=2026-10`)).json.data.month, 'SITE_OVERHEAD').amount, 25000);
  // the snapshot of October: made by the accounts manager, frozen by the CFO; the ledger changing in between stops the freeze (BR-01)
  assert.equal((await w.call(U.acc, 'POST', '/pl-snapshots', { projectId: w.A, period: '2026-11' })).status, 400, 'a month that has ended');
  const s = await w.call(U.acc, 'POST', '/pl-snapshots', { projectId: w.A, period: '2026-10' }); assert.equal(s.status, 201, JSON.stringify(s.json)); let snap = s.json.data;
  assert.deepEqual([snap.revenue, snap.grossProfit, snap.operatingProfit, snap.reconciled], [500000, 175000, 145000, true]);
  assert.equal((await w.call(U.acc, 'POST', `/pl-snapshots/${snap.id}/submit`)).status, 202); const inst = w.wf('pl_snapshots', snap.id);
  w.post('2026-10-30', w.A, [['560004', 1000, 0], ['220001', 0, 1000]]);
  assert.notEqual((await w.act(U.cfo, inst)).status, 200, 'the ledger changed after it was worked out');
  assert.equal((await w.act(U.cfo, inst, 'return')).status, 200); assert.equal((await w.call(U.acc, 'POST', `/pl-snapshots/${snap.id}/recompute`)).json.data.operatingProfit, 144000);
  assert.equal((await w.call(U.acc, 'POST', `/pl-snapshots/${snap.id}/submit`)).status, 202); assert.equal((await w.act(U.cfo, w.wf('pl_snapshots', snap.id))).status, 200);
  snap = (await w.call(U.cfo, 'GET', `/pl-snapshots/${snap.id}`)).json.data; assert.equal(snap.status, 'APPROVED'); assert.ok(snap.frozenAt); assert.equal(w.events('fin.pl_snapshot.frozen').at(-1).operatingProfit, 144000);
  assert.equal((await w.call(U.acc, 'POST', '/pl-snapshots', { projectId: w.A, period: '2026-10' })).status, 409, 'T-01: a frozen snapshot is not changed');
  assert.equal((await w.call(U.acc, 'POST', `/pl-snapshots/${snap.id}/recompute`)).status, 409);
  // the portfolio: A profitable, B loss-making; by sector, region, client
  const pf = (await w.call(U.cfo, 'GET', '/profitability?from=2026-10-01&to=2026-10-31')).json.data; assert.equal(pf.kpis.projects, 2); assert.equal(pf.kpis.lossMaking, 1); assert.equal(pf.rows[0].projectId, w.A); assert.equal(pf.exceptions[0].projectId, w.B);
  assert.equal(pf.segments.sector[0].name, 'BUILDING'); assert.equal(pf.segments.sector[0].projects, 2); assert.ok(pf.segments.client.some((c) => c.name === 'No client'));
  const pfPm = (await w.call(U.pm, 'GET', '/profitability?from=2026-10-01&to=2026-10-31')).json.data; assert.equal(pfPm.kpis.operatingProfit, null, 'masked for the PM');
  // rights and isolation
  assert.equal((await w.call(U.se, 'GET', `/project-pl?projectId=${w.A}&period=2026-10`)).status, 403); assert.equal((await w.call(U.aud, 'GET', '/pl-snapshots')).status, 200);
  assert.equal((await w.call(U.cfo, 'GET', `/pl-snapshots/${snap.id}/print`)).status, 200); assert.equal((await w.call(as('CFO', 'cfo9', '2'), 'GET', `/pl-snapshots/${snap.id}`)).status, 404);
});

test('26.04 closeout reads the scoped reference to the current Finance-approved snapshot', async () => {
  const w = await world();
  const { d } = w;
  const flags = createFlagService({ db: d, environment: 'test' });
  const actor = { user: U.cfo.user, roles: ['CFO'], companyId: 1 };
  const otherCompany = fill(d, 'org_companies', { code: 'CLOSE-OTHER', legal_name: 'Other company', short_name: 'Other' });
  const sign = d.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  const override = d.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES (?, ?, 'Test company override', 0, ?)`);
  const deny = { status: 404 };
  w.post('2026-10-05', w.A, [['140001', 1000, 0], ['410001', 0, 1000]]);
  const created = await w.call(U.acc, 'POST', '/pl-snapshots', { projectId: w.A, period: '2026-10' });
  assert.equal(created.status, 201);
  const snapshotId = created.json.data.id;
  const input = { projectId: w.A, snapshotId };
  const read = (selection = input, user = actor) => readCloseoutSnapshotEvidence({ db: d, flags }, { ...user }, selection);

  sign.run(1, 'G1', 'Platform Gate');
  sign.run(otherCompany, 'G2', 'Workforce Gate');
  assert.equal(flags.isOn(actor, 'ff.close.p2604'), false);
  assert.throws(read, deny);
  const enabled = override.run('ff.close.p2604', 1, 1).lastInsertRowid;
  assert.throws(read, deny, 'the other company’s sign-off cannot satisfy G2');
  sign.run(1, 'G2', 'Workforce Gate');
  assert.throws(read, deny, 'draft');
  assert.equal((await w.call(U.acc, 'POST', `/pl-snapshots/${snapshotId}/submit`)).status, 202);
  assert.throws(read, deny, 'awaiting approval');
  assert.equal((await w.act(U.cfo, w.wf('pl_snapshots', snapshotId))).status, 200);
  const { json: { data: snapshot } } = await w.call(U.cfo, 'GET', `/pl-snapshots/${snapshotId}`);

  assert.deepEqual(read(), { sourceType: 'pl_snapshots', sourceId: snapshotId, projectId: w.A,
    docNo: snapshot.docNo, period: snapshot.period, frozenAt: snapshot.frozenAt });
  const setOverride = d.prepare('UPDATE core_feature_flags SET enabled = ? WHERE id = ?');
  setOverride.run(0, enabled);
  assert.throws(read, deny, 'the closeout flag is required even for approved evidence');
  setOverride.run(1, enabled);
  assert.throws(() => read({ ...input, projectId: w.B }), deny);
  assert.throws(() => read({ ...input, snapshotId: 'invalid' }), { status: 400 });
  assert.throws(() => read(input, { ...actor, user: U.se.user, roles: ['SE'] }), deny);
  sign.run(otherCompany, 'G1', 'Platform Gate');
  override.run('ff.close.p2604', otherCompany, 1);
  override.run('ff.fin.p2312', otherCompany, 1);
  assert.throws(() => read(input, { ...actor, companyId: otherCompany }), deny);
  authzOf(d).seed();
  const userId = fill(d, 'iam_users', { company_id: 1, username: 'close-pm', display_name: 'Closeout PM', roles_json: '[]', email: 'close-pm@example.com' });
  const roleId = d.prepare("SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL").get().id;
  const addScope = d.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, ?, ?, ?, 'ACTIVE', 'test')`);
  addScope.run(userId, roleId, 'PROJECT', JSON.stringify([w.B]));
  addScope.run(userId, roleId, 'SITE', JSON.stringify([w.site]));
  authzOf(d).invalidate();
  const scopedPm = { companyId: 1, user: 'close-pm', userId, roles: [] };
  assert.throws(() => read(input, scopedPm), deny);
  addScope.run(userId, roleId, 'PROJECT', JSON.stringify([w.A]));
  authzOf(d).invalidate();
  assert.deepEqual(read(input, scopedPm), read());

  const disabled = override.run('ff.fin.p2312', 1, 0).lastInsertRowid;
  assert.throws(read, deny, 'the Finance source flag is required even on internal calls');
  d.prepare('DELETE FROM core_feature_flags WHERE id = ?').run(disabled);
  assert.equal(read().sourceId, snapshotId);
  const amended = await w.call(U.acc, 'POST', `/pl-snapshots/${snapshotId}/amend`, { reason: 'Review after a period adjustment' });
  assert.equal(amended.status, 201);
  const replacementId = amended.json.data.id;
  assert.equal((await w.call(U.acc, 'POST', `/pl-snapshots/${replacementId}/submit`)).status, 202);
  assert.equal((await w.act(U.cfo, w.wf('pl_snapshots', replacementId))).status, 200);
  assert.throws(read, deny, 'a superseded snapshot cannot be selected for closeout');
  assert.equal(read({ projectId: w.A, snapshotId: replacementId }).sourceId, replacementId);
  assert.equal(w.events('fin.pl_snapshot.frozen').length, 2);
  assert.equal(d.prepare('SELECT status FROM org_projects WHERE id = ?').get(w.A).status, 'ACTIVE');
});
