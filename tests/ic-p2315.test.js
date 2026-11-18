import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { setupCompany } from './helpers.js';
import { glOf } from '../src/server/modules/fin/index.js';
import { balanced } from '../src/server/modules/fin/intercompany.js';

// Part 23.15: multi-company, inter-company and consolidation.
//  T-01 the eliminations net to zero; the mirror entries balance (one company's due-from equals the other's due-to).
//  and: the relationship and its accounts; a charge and a transfer raised, approved by another accounts manager, accepted by the counterpart with the account of
//  its side, posted in both companies at once; dispute and drop; reversal in both companies; the reconciliation with a one-sided line; the consolidation of the
//  parent and an 80 % subsidiary (charges and balances eliminated, investment against share capital, non-controlling interest), finalised only when nothing is
//  unmatched; JV shares and the partner statement; rights and isolation.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, acc: as('ACCMGR', 'acc1'), acc1b: as('ACCMGR', 'acc1b'), cfo: as('CFO', 'cfo1'), dir: as('DIR', 'dir1'), se: as('SE', 'se9'), acc2: as('ACCMGR', 'acc2', '2'), cfo2: as('CFO', 'cfo2', '2'), acc3: as('ACCMGR', 'acc3', '3') };
const F = '/api/v1/fin';

test('T-01 elimination entries balance', () => {
  assert.equal(balanced([{ debit: 100 }, { credit: 60 }, { credit: 40 }]), true); assert.equal(balanced([{ debit: 100 }, { credit: 90 }]), false);
});

test('AC-01 inter-company entries mirrored, reconciled and eliminated in the consolidated statements; JV shares; rights', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; d.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'SUBCO', 'Sub Infra Pvt Ltd', 'Sub', 't', 'test')").run(); await setupCompany(r.api, { company: '2' });
  for (const u of [U.acc2, U.cfo2]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`);
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200); assert.equal((await call(U.acc2, 'GET', '/journals/options')).status, 200);
  const acct = (c, code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ?').get(c, code)?.id;
  const grp = d.prepare("SELECT id FROM fin_account_groups WHERE company_id = 1 AND code = '1200'").get().id; fill(d, 'fin_accounts', { company_id: 1, group_id: grp, code: '120001', name: 'Investment in subsidiary', account_type: 'GENERAL', normal_side: 'DR', currency_code: 'INR', is_control: 0, manual_posting_allowed: 1, account_status: 'ACTIVE' });
  const cc2 = fill(d, 'org_cost_centres', { company_id: 2, code: 'HO2', name: 'Head office', type: 'COST', status: 'ACTIVE' });
  let n = 0; const post = (c, date, lines) => { n += 1; return glOf(d).postEngine(c, { date, narration: `test ${n}`, sourceType: 'test', sourceId: n, lines: lines.map(([code, dr, cr, project]) => ({ accountId: acct(c, code), ...(dr ? { debit: String(dr) } : { credit: String(cr) }), ...(project ? { projectId: project } : {}) })) }).journal.id; };
  // equity: the parent's capital, its 80 % investment in the subsidiary at par
  post(1, '2026-10-01', [['150002', 1000000, 0], ['310001', 0, 1000000]]); post(1, '2026-10-02', [['120001', 400000, 0], ['150002', 0, 400000]]); post(2, '2026-10-02', [['150002', 500000, 0], ['310001', 0, 500000]]);
  // FR-01: the relationship (the CFO of the parent)
  assert.equal((await call(U.acc, 'POST', '/ic-relationships', { counterpartCompanyId: 2 })).status, 403);
  assert.equal((await call(U.cfo, 'POST', '/ic-relationships', { counterpartCompanyId: 2, receivableCode: '999999' })).status, 400);
  const rel = await call(U.cfo, 'POST', '/ic-relationships', { counterpartCompanyId: 2, type: 'SUBSIDIARY', holdingPct: 80 }); assert.equal(rel.status, 200, JSON.stringify(rel.json)); assert.equal(rel.json.data[0].holdingPct, 80);
  assert.equal((await call(U.acc2, 'GET', '/ic-relationships')).json.data[0].side, 'COUNTERPART');
  // FR-02: a charge from the parent; approved by another accounts manager; accepted by the subsidiary
  assert.equal((await call(U.acc, 'POST', '/ic-transactions', { counterpartCompanyId: 2, type: 'CHARGE', date: '2026-10-15', amount: 100000, accountId: acct(1, '160090'), description: 'Head office services October' })).status, 400, 'not the inter-company account');
  const c1 = await call(U.acc, 'POST', '/ic-transactions', { counterpartCompanyId: 2, type: 'CHARGE', date: '2026-10-15', amount: 100000, accountId: acct(1, '420001'), description: 'Head office services October', reference: 'HO/OCT' }); assert.equal(c1.status, 201, JSON.stringify(c1.json)); const ch = c1.json.data;
  assert.equal((await call(U.acc2, 'GET', `/ic-transactions/${ch.id}`)).status, 404, 'the counterpart sees it once approved');
  assert.equal((await call(U.acc, 'POST', `/ic-transactions/${ch.id}/submit`)).status, 202); const inst = r.wf('ic_transactions', ch.id);
  assert.equal((await r.act(U.acc1b, inst)).status, 200); let x = (await call(U.acc, 'GET', `/ic-transactions/${ch.id}`)).json.data; assert.equal(x.state, 'AWAITING_COUNTERPART');
  const inc = await call(U.acc2, 'GET', '/ic-transactions?side=in'); assert.equal(inc.json.data.length, 1); assert.equal(inc.json.data[0].can.accept, true);
  assert.equal((await call(U.acc, 'POST', `/ic-transactions/${ch.id}/accept`, { accountId: acct(1, '560005') })).status, 403, 'the originator cannot accept');
  assert.equal((await call(U.acc2, 'POST', `/ic-transactions/${ch.id}/accept`, { accountId: acct(2, '230090') })).status, 400, 'not the inter-company account');
  assert.equal((await call(U.acc2, 'POST', `/ic-transactions/${ch.id}/accept`, { accountId: acct(2, '560005') })).status, 400, 'its cost centre is needed');
  const ac = await call(U.acc2, 'POST', `/ic-transactions/${ch.id}/accept`, { accountId: acct(2, '560005'), dimensions: { costCentreId: cc2 } }); assert.equal(ac.status, 200, JSON.stringify(ac.json)); x = ac.json.data; assert.equal(x.state, 'POSTED');
  // T-01: the mirror entries balance
  const lines = (c, id) => d.prepare('SELECT a.code, l.debit_paise AS dr, l.credit_paise AS cr FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? AND l.company_id = ? ORDER BY l.id').all(id, c).map((y) => ({ ...y }));
  const j = JSON.parse(d.prepare('SELECT journals_json FROM ic_transactions WHERE id = ?').get(ch.id).journals_json);
  assert.deepEqual(lines(1, j.from), [{ code: '160090', dr: 10000000, cr: 0 }, { code: '420001', dr: 0, cr: 10000000 }]); assert.deepEqual(lines(2, j.to), [{ code: '560005', dr: 10000000, cr: 0 }, { code: '230090', dr: 0, cr: 10000000 }]);
  assert.equal(r.events('fin.ic_transaction.posted').at(-1).amount, 100000);
  assert.equal((await call(U.acc2, 'POST', `/ic-transactions/${ch.id}/accept`, { accountId: acct(2, '560005'), dimensions: { costCentreId: cc2 } })).status, 409, 'accepted once');
  // a transfer accepted, a loan disputed and dropped
  const mk = async (type, amount, accountId, description) => { const t = (await call(U.acc, 'POST', '/ic-transactions', { counterpartCompanyId: 2, type, date: '2026-10-20', amount, accountId, description })).json.data; assert.equal((await call(U.acc, 'POST', `/ic-transactions/${t.id}/submit`)).status, 202); assert.equal((await r.act(U.acc1b, r.wf('ic_transactions', t.id))).status, 200); return t; };
  const tr = await mk('TRANSFER', 200000, acct(1, '150002'), 'Funds for the site'); assert.equal((await call(U.acc2, 'POST', `/ic-transactions/${tr.id}/accept`, { accountId: acct(2, '150002') })).status, 200);
  const ln = await mk('LOAN', 50000, acct(1, '150002'), 'Short loan'); assert.equal((await call(U.acc2, 'POST', `/ic-transactions/${ln.id}/dispute`, { reason: 'Not agreed by our board' })).status, 200);
  // FR-03: reconciliation — matched pair, the disputed loan open
  let rc = (await call(U.acc, 'GET', '/ic-reconciliation?asOf=2026-10-31')).json.data; assert.deepEqual([rc.pairs[0].own, rc.pairs[0].theirs, rc.pairs[0].matched], [300000, -300000, true]); assert.equal(rc.open.length, 1);
  // FR-04: the consolidation cannot be finalised while the loan is disputed
  const prev = await call(U.cfo, 'GET', '/consolidations/preview?period=2026-10&basis=YTD'); assert.equal(prev.status, 200, JSON.stringify(prev.json)); let k = prev.json.data;
  assert.equal(k.eliminations.balanced, true, 'T-01: the eliminations net to zero'); assert.equal(k.balanceSheet.totals.balanced, true); assert.equal(k.canFinalise, false);
  const row = (rows, c) => rows.find((y) => y.code === c)?.amount;
  assert.equal(row(k.profitAndLoss.rows, 'PL_OTHER_INCOME'), 0, 'the charge is eliminated'); assert.equal(row(k.profitAndLoss.rows, 'PL_OTHER_EXPENSES'), 0); assert.equal(k.profitAndLoss.totals.pat, 0); assert.equal(k.profitAndLoss.totals.attributableToNci, -20000);
  assert.equal(row(k.balanceSheet.rows, 'BS_SHARE_CAPITAL'), 1000000, "the subsidiary's capital eliminated"); assert.equal(row(k.balanceSheet.rows, 'BS_NC_INVESTMENTS'), 0); assert.equal(row(k.balanceSheet.rows, 'BS_NCI'), 80000, '20 % of (5,00,000 − 1,00,000)');
  assert.equal(row(k.balanceSheet.rows, 'BS_ST_LOANS_ADVANCES'), 0, 'the inter-company receivable eliminated'); assert.equal(row(k.balanceSheet.rows, 'BS_CASH'), 1100000);
  const run = await call(U.acc, 'POST', '/consolidations', { period: '2026-10', basis: 'YTD' }); assert.equal(run.status, 201); assert.equal((await call(U.acc, 'POST', `/consolidations/${run.json.data.id}/finalise`)).status, 403);
  assert.equal((await call(U.cfo, 'POST', `/consolidations/${run.json.data.id}/finalise`)).status, 422, 'BR-01: the disputed loan blocks the finalisation');
  assert.equal((await call(U.acc, 'POST', `/ic-transactions/${ln.id}/drop`, { reason: 'Disputed, not lent' })).status, 200);
  // a one-sided line on an inter-company account: unmatched, blocks the finalisation
  post(2, '2026-10-25', [['150002', 1000, 0], ['230090', 0, 1000]]); rc = (await call(U.acc2, 'GET', '/ic-reconciliation?asOf=2026-10-31')).json.data; assert.equal(rc.strays.length, 1); assert.equal(rc.strays[0].credit, 1000);
  assert.equal((await call(U.cfo, 'GET', '/consolidations/preview?period=2026-10&basis=YTD')).json.data.unmatched, 1000);
  post(2, '2026-10-26', [['230090', 1000, 0], ['150002', 0, 1000]]);
  const run2 = await call(U.cfo, 'POST', '/consolidations', { period: '2026-10', basis: 'YTD' }); const fin = await call(U.cfo, 'POST', `/consolidations/${run2.json.data.id}/finalise`); assert.equal(fin.status, 200, JSON.stringify(fin.json)); assert.equal(fin.json.data.status, 'FINAL'); assert.equal(r.events('fin.consolidation.finalised').length, 1);
  // a reversal in both companies
  const rv = await call(U.acc, 'POST', `/ic-transactions/${tr.id}/reverse`, { reason: 'Sent to the wrong company' }); assert.equal(rv.status, 200, JSON.stringify(rv.json)); assert.equal(rv.json.data.state, 'REVERSED');
  rc = (await call(U.acc, 'GET', '/ic-reconciliation')).json.data; assert.deepEqual([rc.pairs[0].own, rc.pairs[0].theirs], [100000, -100000]); assert.equal(rc.strays.length, 0, 'the reversal belongs to the transaction');
  // FR-05: JV shares and the partner statement
  post(1, '2026-10-28', [['140001', 600000, 0, r.A], ['410001', 0, 600000, r.A]]); post(1, '2026-10-29', [['510001', 200000, 0, r.A], ['220001', 0, 200000]]);
  assert.equal((await call(U.acc, 'POST', '/jv-shares', { projectId: r.A, partnerName: 'Larsen Infra', sharePct: 26, role: 'MEMBER' })).status, 200);
  assert.equal((await call(U.acc, 'POST', '/jv-shares', { projectId: r.A, partnerName: 'Other Partner', sharePct: 74 })).status, 400, 'the own share stays above 0');
  const st = (await call(U.dir, 'GET', `/jv-statement?projectId=${r.A}&from=2026-10-01&to=2026-10-31`)).json.data; assert.equal(st.revenue, 600000); assert.equal(st.cost, 200000);
  assert.deepEqual(st.shares.map((s) => [s.sharePct, s.revenue, s.cost, s.result]), [[74, 444000, 148000, 296000], [26, 156000, 52000, 104000]]);
  // rights and isolation
  assert.equal((await call(U.se, 'GET', '/ic-transactions')).status, 403); assert.equal((await call(U.dir, 'GET', '/consolidations/preview?period=2026-10')).status, 200); assert.equal((await call(U.dir, 'POST', '/consolidations', { period: '2026-10' })).status, 403);
  assert.equal((await call(U.acc3, 'GET', `/ic-transactions/${ch.id}`)).status, 404); assert.equal((await call(U.cfo, 'GET', `/ic-transactions/${ch.id}/print`)).status, 200);
});
