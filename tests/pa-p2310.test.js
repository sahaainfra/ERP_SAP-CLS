import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { recognise } from '../src/server/modules/fin/projacct.js';
import { glOf } from '../src/server/modules/fin/index.js';

// Part 23.10: project accounting.
//  T-01 the percentage of completion and the provision for a foreseeable loss match worked examples (cost to cost and output).
//  and: a month recognised by the project controls manager, approved by the accounts manager and the CFO, posted as the movement of the contract asset, the
//  contract liability and the provision; the next month posts only the change; amendment; the overhead pools of 12.04 posted to the projects and reversed;
//  the project trial balance and the WIP report; rights and isolation.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), pcm: as('PCMGR', 'pcm1'), pm: as('PM', 'pm1'), se: as('SE', 'se9'), aud: as('AUD', 'aud1') };
const F = '/api/v1/fin';

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  const contract = (project, value) => fill(d, 'ctr_contracts', { company_id: 1, org_project_id: project, contract_no: `K-${project}`, title: 'Main works', contract_type: 'ITEM_RATE', original_paise: value * 100, revised_paise: value * 100, status: 'APPROVED', contract_state: 'ACTIVE' });
  const budget = (project, total) => fill(d, 'bud_budgets', { company_id: 1, org_project_id: project, version_no: 1, status: 'APPROVED', total_amount: total * 100, direct_total: total * 100 });
  let n = 0; const post = (date, project, lines) => { n += 1; return glOf(d).postEngine(1, { date, narration: `test ${n}`, sourceType: 'test', sourceId: n, lines: lines.map(([code, dr, cr]) => ({ accountId: acct(code), ...(dr ? { debit: String(dr) } : { credit: String(cr) }), projectId: project })) }).journal.id; };
  const cost = (date, project, amount, code = '510001') => post(date, project, [[code, amount, 0], ['220001', 0, amount]]);
  const bill = (date, project, amount) => post(date, project, [['140001', amount, 0], ['410001', 0, amount]]);
  return { ...r, call, acct, contract, budget, cost, bill };
}
const lines = (d, jid) => d.prepare('SELECT a.code, l.debit_paise AS dr, l.credit_paise AS cr FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY a.code').all(jid).map((x) => [x.code, x.dr / 100, x.cr / 100]);

test('T-01 POC and the foreseeable loss match worked examples', () => {
  // cost to cost: ₹2,00,000 of ₹8,00,000 = 25 %; 25 % of ₹10,00,000 = ₹2,50,000 recognised; ₹3,00,000 billed → ₹50,000 billed in excess
  let r = recognise({ method: 'COST_TO_COST', costToDate: 20000000, eac: 80000000, contractRevenue: 100000000, billedCum: 30000000 });
  assert.deepEqual([r.poc, r.recognisedCum, r.unbilled, r.excess, r.expectedLoss, r.lossProvision], [250000, 25000000, 0, 5000000, 0, 0]);
  // a loss-making contract: EAC ₹12,00,000 against ₹10,00,000; at 25 % the books carry ₹50,000 of the ₹2,00,000 loss; ₹1,50,000 is provided now (BR-01)
  r = recognise({ method: 'COST_TO_COST', costToDate: 30000000, eac: 120000000, contractRevenue: 100000000, billedCum: 20000000 });
  assert.deepEqual([r.poc, r.recognisedCum, r.unbilled, r.expectedLoss, r.lossProvision], [250000, 25000000, 5000000, 20000000, 15000000]);
  assert.equal(r.lossProvision + (30000000 - r.recognisedCum), r.expectedLoss, 'provision + loss already in the books = the whole expected loss');
  // output: ₹4,00,000 certified of ₹10,00,000 = 40 %; never above 100 %
  r = recognise({ method: 'OUTPUT', costToDate: 0, eac: 0, contractRevenue: 100000000, output: 40000000, billedCum: 40000000 }); assert.deepEqual([r.poc, r.recognisedCum, r.unbilled, r.excess], [400000, 40000000, 0, 0]);
  assert.equal(recognise({ method: 'OUTPUT', costToDate: 0, eac: 0, contractRevenue: 100, output: 500, billedCum: 0 }).poc, 1000000);
});

test('AC-01 monthly recognition prepared, approved by ACCMGR and CFO, posted as movements; amendment; overhead pools posted; reports; rights', async () => {
  const w = await world(); const d = w.d;
  w.contract(w.A, 1000000); w.budget(w.A, 800000);
  w.cost('2026-10-10', w.A, 200000); w.bill('2026-10-20', w.A, 300000);
  // rights: the site engineer and the PM do not prepare; without a contract there is nothing to recognise
  assert.equal((await w.call(U.se, 'POST', '/revenue-recognition', { projectId: w.A, period: '2026-10' })).status, 403);
  assert.equal((await w.call(U.pm, 'POST', '/revenue-recognition', { projectId: w.A, period: '2026-10' })).status, 403);
  assert.equal((await w.call(U.pcm, 'POST', '/revenue-recognition', { projectId: w.B, period: '2026-10' })).status, 400, 'project B has no contract');
  assert.equal((await w.call(U.pcm, 'POST', '/revenue-recognition', { projectId: w.A, period: '2027-01' })).status, 400, 'not a month to come');
  const pv = await w.call(U.pcm, 'POST', '/revenue-recognition/preview', { projectId: w.A, period: '2026-10' }); assert.equal(pv.status, 200, JSON.stringify(pv.json)); assert.equal(w.d.prepare('SELECT COUNT(*) AS n FROM pa_revenue_recognition').get().n, 0, 'a preview saves nothing');
  const c = await w.call(U.pcm, 'POST', '/revenue-recognition', { projectId: w.A, period: '2026-10' }); assert.equal(c.status, 201, JSON.stringify(c.json)); let x = c.json.data;
  assert.deepEqual([x.costToDate, x.eac, x.eacSource, x.pocPct, x.contractRevenue, x.recognisedCum, x.recognisedPeriod, x.billed, x.unbilled, x.excess, x.lossProvision], [200000, 800000, 'BUDGET', 25, 1000000, 250000, 250000, 300000, 0, 50000, 0]);
  assert.deepEqual(x.journal.map((l) => [l.code, l.debit, l.credit]), [['230020', 0, 50000], ['410090', 50000, 0]], 'the projected journal');
  assert.equal((await w.call(U.pcm, 'POST', '/revenue-recognition', { projectId: w.A, period: '2026-10' })).status, 409, 'one open record a project and month');
  // approval: the PCMGR prepared it, so the accounts manager then the CFO; the maker has no task
  assert.equal((await w.call(U.pcm, 'POST', `/revenue-recognition/${x.id}/submit`)).status, 202); const inst = w.wf('pa_revenue_recognition', x.id);
  assert.equal((await w.tasksOf(U.pcm)).filter((t) => t.instance.id === inst).length, 0);
  assert.equal((await w.act(U.acc, inst)).status, 200); assert.equal((await w.call(U.acc, 'GET', `/revenue-recognition/${x.id}`)).json.data.status, 'SUBMITTED', 'the CFO still to approve');
  assert.equal((await w.act(U.cfo, inst)).status, 200); x = (await w.call(U.cfo, 'GET', `/revenue-recognition/${x.id}`)).json.data; assert.equal(x.status, 'APPROVED'); assert.ok(x.journalId);
  assert.deepEqual(lines(d, x.journalId), [['230020', 0, 50000], ['410090', 50000, 0]]);
  assert.equal(w.events('fin.revenue.recognised').at(-1).recognisedCum, 250000);
  assert.equal((await w.call(U.pcm, 'POST', '/revenue-recognition', { projectId: w.A, period: '2026-10' })).status, 409, 'the month is recognised: amend it');
  // November: more cost (₹4,00,000 to date = 50 %), nothing billed: ₹5,00,000 recognised, ₹2,00,000 unbilled; the journal moves from ₹50,000 in excess to ₹2,00,000 unbilled
  w.cost('2026-11-05', w.A, 200000);
  const n2 = await w.call(U.acc, 'POST', '/revenue-recognition', { projectId: w.A, period: '2026-11' }); assert.equal(n2.status, 201); let y = n2.json.data;
  assert.deepEqual([y.pocPct, y.recognisedCum, y.recognisedPeriod, y.unbilled, y.excess, y.prevExcess], [50, 500000, 250000, 200000, 0, 50000]);
  assert.equal((await w.call(U.acc, 'POST', `/revenue-recognition/${y.id}/submit`)).status, 202); const i2 = w.wf('pa_revenue_recognition', y.id);
  assert.equal((await w.tasksOf(U.acc)).filter((t) => t.instance.id === i2).length, 0, 'the accounts manager prepared it: no ACCMGR step for them');
  assert.equal((await w.act(U.cfo, i2)).status, 200); y = (await w.call(U.cfo, 'GET', `/revenue-recognition/${y.id}`)).json.data;
  assert.deepEqual(lines(d, y.journalId), [['170010', 200000, 0], ['230020', 50000, 0], ['410090', 0, 250000]]);
  // the project trial balance: revenue = billed ₹3,00,000 + adjustment ₹2,00,000 = ₹5,00,000 = recognised
  const tb = (await w.call(U.acc, 'GET', `/project-accounts/trial-balance?projectId=${w.A}&from=2026-04-01&to=2026-11-30`)).json.data; assert.equal(tb.heads.revenue, 500000); assert.equal(tb.heads.directCost, 400000); assert.equal(tb.totals.debit, tb.totals.credit);
  const wip = (await w.call(U.cfo, 'GET', '/project-accounts/wip?period=2026-11')).json.data; assert.equal(wip.rows.length, 1); assert.equal(wip.totals.unbilled, 200000);
  // amendment of the latest month (a cost booked late to November): only the difference is posted, the old record superseded
  assert.equal((await w.call(U.acc, 'POST', `/revenue-recognition/${x.id}/amend`, { reason: 'October corrected' })).status, 409, 'a later month is approved');
  w.cost('2026-11-28', w.A, 80000);
  const am = await w.call(U.pcm, 'POST', `/revenue-recognition/${y.id}/amend`, { reason: 'Steel invoice booked late' }); assert.equal(am.status, 201, JSON.stringify(am.json)); const a = am.json.data;
  assert.deepEqual([a.pocPct, a.recognisedCum, a.unbilled, a.prevUnbilled], [60, 600000, 300000, 200000]);
  assert.equal((await w.call(U.pcm, 'POST', `/revenue-recognition/${a.id}/submit`)).status, 202); const i3 = w.wf('pa_revenue_recognition', a.id); assert.equal((await w.act(U.acc, i3)).status, 200); assert.equal((await w.act(U.cfo, i3)).status, 200);
  const a2 = (await w.call(U.cfo, 'GET', `/revenue-recognition/${a.id}`)).json.data; assert.deepEqual(lines(d, a2.journalId), [['170010', 100000, 0], ['410090', 0, 100000]]);
  assert.equal((await w.call(U.cfo, 'GET', `/revenue-recognition/${y.id}`)).json.data.status, 'SUPERSEDED');
  // the overhead pool of 12.04 (posted run): posted to the projects by its event, once; reversed with the run
  const fy = fill(d, 'core_financial_years', { company_id: 1, code: 'FY26-27', name: '2026-27', start_date: '2026-04-01', end_date: '2027-03-31' });
  const per = fill(d, 'core_periods', { company_id: 1, fy_id: fy, period_no: 7, name: 'Oct 2026', start_date: '2026-10-01', end_date: '2026-10-31' });
  const rule = fill(d, 'bud_alloc_rules', { company_id: 1, fy_id: fy, name: 'HO pool', basis: 'FIXED_PCT' });
  const run = fill(d, 'bud_alloc_runs', { company_id: 1, doc_no: 'OAR/00001', fy_id: fy, rule_id: rule, basis: 'FIXED_PCT', from_period_id: per, to_period_id: per, pool_source: 'ACTUAL', pool_amount: 9000000, allocated_amount: 9000000, projects_count: 2, status: 'POSTED' });
  fill(d, 'bud_alloc_lines', { company_id: 1, run_id: run, org_project_id: w.A, share: 6667, amount: 6000000, basis_value: 0 }); fill(d, 'bud_alloc_lines', { company_id: 1, run_id: run, org_project_id: w.B, share: 3333, amount: 3000000, basis_value: 0 });
  for (let k = 0; k < 2; k += 1) publishEvent(d, { type: 'bud.overhead.allocated', entity: 'bud_alloc_runs', entityId: run, actorId: 'test', companyId: 1, data: { runId: run, docNo: 'OAR/00001' } }); await w.drain();
  const oh = (await w.call(U.acc, 'GET', '/project-accounts/overheads?from=2026-10&to=2026-10')).json.data; assert.equal(oh.rows.length, 2, 'posted once'); assert.equal(oh.total, 90000); assert.equal(oh.unposted.length, 0);
  assert.deepEqual(lines(d, oh.rows[0].journalId), [['560030', 60000, 0], ['560030', 30000, 0], ['560031', 0, 90000]]);
  assert.equal((await w.call(U.acc, 'GET', `/project-accounts/trial-balance?projectId=${w.A}&from=2026-04-01&to=2026-11-30`)).json.data.heads.overhead, 60000);
  assert.equal(w.events('fin.overhead.posted').length, 1);
  publishEvent(d, { type: 'bud.overhead.allocation_reversed', entity: 'bud_alloc_runs', entityId: run, actorId: 'test', companyId: 1, data: { runId: run } }); await w.drain();
  assert.deepEqual(d.prepare('SELECT alloc_status FROM pa_overhead_allocations WHERE run_id = ? ORDER BY id').all(run).map((r) => r.alloc_status), ['REVERSED', 'REVERSED']);
  // reads, exports and isolation
  assert.equal((await w.call(U.aud, 'GET', '/revenue-recognition')).status, 200); assert.equal((await w.call(U.se, 'GET', '/revenue-recognition')).status, 403);
  assert.equal((await w.call(U.acc, 'GET', `/revenue-recognition/${x.id}/print`)).status, 200); assert.equal((await w.call(U.acc, 'GET', '/revenue-recognition/export')).status, 200); assert.equal((await w.call(U.acc, 'GET', '/project-accounts/export?kind=wip&period=2026-11')).status, 200);
  assert.equal((await w.call(as('ACCMGR', 'acc9', '2'), 'GET', `/revenue-recognition/${x.id}`)).status, 404, 'another company sees nothing');
});

test('BR-01 a loss-making project provides the whole expected loss at once', async () => {
  const w = await world(); const d = w.d;
  w.contract(w.B, 1000000); w.budget(w.B, 1200000); w.cost('2026-10-10', w.B, 300000); w.bill('2026-10-12', w.B, 200000);
  const c = await w.call(U.acc, 'POST', '/revenue-recognition', { projectId: w.B, period: '2026-10' }); assert.equal(c.status, 201); const x = c.json.data;
  assert.deepEqual([x.pocPct, x.recognisedCum, x.unbilled, x.expectedLoss, x.lossProvision], [25, 250000, 50000, 200000, 150000]);
  assert.equal((await w.call(U.acc, 'POST', `/revenue-recognition/${x.id}/submit`)).status, 202); assert.equal((await w.act(U.cfo, w.wf('pa_revenue_recognition', x.id))).status, 200);
  const j = (await w.call(U.cfo, 'GET', `/revenue-recognition/${x.id}`)).json.data.journalId; assert.deepEqual(lines(d, j), [['170010', 50000, 0], ['240010', 0, 150000], ['410090', 0, 50000], ['560020', 150000, 0]]);
  // output method with a surveyed percentage needs its note
  assert.equal((await w.call(U.acc, 'POST', '/revenue-recognition/preview', { projectId: w.B, period: '2026-11', method: 'OUTPUT', surveyPct: 30 })).status, 200);
  assert.equal((await w.call(U.acc, 'POST', '/revenue-recognition', { projectId: w.B, period: '2026-11', method: 'OUTPUT', surveyPct: 30 })).status, 400);
});
