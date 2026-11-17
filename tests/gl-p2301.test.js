import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, key, U as QU } from './qa-helpers.js';
import { glOf } from '../src/server/modules/fin/index.js';

// Part 23.01: the general ledger core.
//  T-01 an unbalanced journal is rejected; the trial balance balances; a reversal is linked both ways and nets the accounts to zero.
//  and the standard set: control accounts and dimension rules (06.05), closed periods, approval by band (ACCMGR, then CFO above ₹5 lakh), the maker never approves,
//  rights (403, another company 404), idempotent replay, accrual auto-reversal, recurring journals, carry-forward to the next year, the projection (BR-02), the events.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), fin2: as('FINEX', 'fin2'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9'), finX: as('FINEX', 'finx', '2') };
const F = '/api/v1/fin';

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  const o = await call(U.fin, 'GET', '/journals/options'); assert.equal(o.status, 200, JSON.stringify(o.json));
  const acct = (code) => o.json.data.accounts.find((a) => a.code === code).id;
  const ac = { bank: acct('150002'), cash: acct('150001'), overheads: acct('560004'), hoOverheads: acct('560005'), provision: acct('240001'), revenue: acct('410001'), ap: o.json.data.accounts.find((a) => a.code === '220001')?.id ?? Number(d.prepare("SELECT id FROM fin_accounts WHERE company_id = 1 AND code = '220001'").get().id), equity: acct('310001'), retained: acct('320001'), interest: acct('420001') };
  const cc = Number(d.prepare("INSERT INTO org_cost_centres (company_id, code, name, type, status) VALUES (1, 'CC-HO', 'Head office', 'COST', 'ACTIVE')").run().lastInsertRowid);
  const jn = (lines, o2 = {}) => ({ voucherType: 'JV', voucherDate: '2026-06-15', narration: 'Site overheads for June', lines, ...o2 });
  const post = async (body, approvers = [U.acc]) => {
    const c = await call(U.fin, 'POST', '/journals', body); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id;
    const s = await call(U.fin, 'POST', `/journals/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json));
    for (const who of approvers) { const a = await r.act(who, r.wf('fin_journals', id)); assert.equal(a.status, 200, JSON.stringify(a.json)); }
    return (await call(U.fin, 'GET', `/journals/${id}`)).json.data;
  };
  return { ...r, call, ac, cc, jn, post };
}

test('T-01 an unbalanced journal is rejected; a balanced one is approved and posted with its voucher number; the trial balance balances; a reversal links both ways and nets to zero', async () => {
  const w = await world(); const { ac: A } = w;
  const un = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 1000, projectId: w.A }, { accountId: A.bank, credit: 999.5 }]));
  assert.equal(un.status, 400); assert.match(un.json.error.message, /does not balance.*0\.50/);
  const both = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 10, credit: 10, projectId: w.A }, { accountId: A.bank, credit: 10 }]));
  assert.equal(both.status, 400); assert.ok(both.json.error.details.some((p) => p.field === 'lines.0.debit'));
  const tamper = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 1000, projectId: w.A }, { accountId: A.bank, credit: 1000 }], { total: 900 }));
  assert.equal(tamper.status, 400, 'a client total that differs from the lines is refused');

  const j = await w.post(w.jn([{ accountId: A.overheads, debit: 25000.75, projectId: w.A, siteId: w.site, narration: 'Diesel generator hire' }, { accountId: A.bank, credit: 25000.75 }]));
  assert.equal(j.status, 'APPROVED'); assert.equal(j.statusLabel, 'Posted'); assert.equal(j.voucherNo, 'JV/2026-27/000001'); assert.equal(j.total, 25000.75); assert.equal(j.period, w.d.prepare("SELECT name FROM core_periods WHERE company_id = 1 AND '2026-06-15' BETWEEN start_date AND end_date").get().name);
  const tb = (await w.call(U.aud, 'GET', '/trial-balance?asOf=2026-06-30')).json.data;
  assert.equal(tb.balanced, true); assert.equal(tb.totals.closingDebit, 25000.75); assert.equal(tb.totals.closingCredit, 25000.75);
  assert.equal(tb.rows.find((x) => x.accountId === A.overheads).closingDebit, 25000.75);
  const byProject = (await w.call(U.aud, 'GET', `/trial-balance?asOf=2026-06-30&projectId=${w.B}`)).json.data; assert.equal(byProject.rows.length, 0, 'the trial balance of another project has none of it');

  // BR-01: a posted journal is not changed; it is reversed
  assert.equal((await w.call(U.fin, 'PATCH', `/journals/${j.id}`, { narration: 'changed', version: j.version })).status, 409);
  const rv = await w.call(U.fin, 'POST', `/journals/${j.id}/reverse`, { date: '2026-06-20', reason: 'Charged to the wrong site' }); assert.equal(rv.status, 202, JSON.stringify(rv.json));
  assert.equal(rv.json.data.status, 'SUBMITTED'); assert.equal(rv.json.data.reversalOfId, j.id); assert.equal(rv.json.data.lines[0].credit, 25000.75, 'debits and credits swapped');
  assert.equal((await w.call(U.fin, 'POST', `/journals/${j.id}/reverse`, { reason: 'twice over' })).status, 409, 'one reversal waiting at a time');
  assert.equal((await w.act(U.acc, w.wf('fin_journals', rv.json.data.id))).status, 200);
  const orig = (await w.call(U.fin, 'GET', `/journals/${j.id}`)).json.data; const rev = (await w.call(U.fin, 'GET', `/journals/${rv.json.data.id}`)).json.data;
  assert.equal(orig.reversedById, rev.id); assert.equal(rev.reversalOfId, orig.id); assert.equal(rev.status, 'APPROVED'); assert.equal(orig.can.reverse, false);
  const tb2 = (await w.call(U.aud, 'GET', '/trial-balance?asOf=2026-06-30')).json.data;
  assert.equal(tb2.balanced, true); const oh = tb2.rows.find((x) => x.accountId === A.overheads); assert.equal(oh.closingDebit, 0); assert.equal(oh.closingCredit, 0); assert.equal(oh.debit, 25000.75); assert.equal(oh.credit, 25000.75);

  // FR-05: the ledger of the account with its running balance, drilling to the journal
  const ledR = await w.call(U.aud, 'GET', `/ledger?accountId=${A.overheads}&from=2026-04-01&to=2026-06-30`); assert.equal(ledR.status, 200, JSON.stringify(ledR.json)); const led = ledR.json.data;
  assert.equal(led.rows.length, 2); assert.equal(led.rows[0].balance.amount, 25000.75); assert.equal(led.rows[0].balance.side, 'Dr'); assert.equal(led.rows[1].balance.amount, 0); assert.equal(led.rows[0].voucherNo, 'JV/2026-27/000001');
  const ledJune20 = (await w.call(U.aud, 'GET', `/ledger?accountId=${A.overheads}&from=2026-06-16&to=2026-06-30`)).json.data; assert.equal(ledJune20.opening.amount, 25000.75, 'the opening balance carries what came before the first date');
  const integ = (await w.call(U.aud, 'GET', '/gl/integrity')).json.data; assert.equal(integ.ok, true, JSON.stringify(integ));
  const posted = w.events('fin.journal.posted'); assert.equal(posted.length, 2); assert.equal(posted[0].voucherNo, 'JV/2026-27/000001');
});

test('FR-02 the account rules of 06.05: no control account by hand, mandatory and not-allowed dimensions, the site of the project; the period must be open; FR-07 branch', async () => {
  const w = await world(); const { ac: A } = w;
  const ctl = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.ap, credit: 500, projectId: w.A }, { accountId: A.overheads, debit: 500, projectId: w.A }]));
  assert.equal(ctl.status, 400); assert.match(JSON.stringify(ctl.json), /control account/);
  const noProj = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 500 }, { accountId: A.bank, credit: 500 }]));
  assert.equal(noProj.status, 400); assert.ok(noProj.json.error.details.some((p) => p.field === 'lines.0.projectId'), JSON.stringify(noProj.json));
  const notAllowed = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.hoOverheads, debit: 500, projectId: w.A, costCentreId: w.cc }, { accountId: A.bank, credit: 500 }]));
  assert.equal(notAllowed.status, 400); assert.ok(notAllowed.json.error.details.some((p) => p.field === 'lines.0.projectId'));
  const siteB = Number(w.d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'QB-S1', 'Site of B')").run(w.B).lastInsertRowid);
  const wrongSite = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 500, projectId: w.A, siteId: siteB }, { accountId: A.bank, credit: 500 }]));
  assert.equal(wrongSite.status, 400); assert.match(JSON.stringify(wrongSite.json), /does not belong to the project/);
  // a closed finance period refuses a journal
  w.d.prepare("UPDATE core_periods SET module_status_json = '{\"finance\":\"Closed\"}' WHERE company_id = 1 AND '2026-05-10' BETWEEN start_date AND end_date").run();
  const closed = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 500, projectId: w.A }, { accountId: A.bank, credit: 500 }], { voucherDate: '2026-05-10' }));
  assert.equal(closed.status, 422); assert.equal(closed.json.error.code, 'PERIOD_CLOSED');
  // FR-07: a branch on the line, filtered in the trial balance
  const br = Number(w.d.prepare("INSERT INTO org_branches (company_id, code, name, status) VALUES (1, 'BR-TS', 'Telangana branch', 'ACTIVE')").run().lastInsertRowid);
  await w.post(w.jn([{ accountId: A.hoOverheads, debit: 1200, costCentreId: w.cc, branchId: br }, { accountId: A.bank, credit: 1200, branchId: br }]));
  const tbBr = (await w.call(U.aud, 'GET', `/trial-balance?asOf=2026-06-30&branchId=${br}`)).json.data; assert.equal(tbBr.totals.closingDebit, 1200); assert.equal(tbBr.balanced, true);
  // the cost-centre lines go to the department budgets (fin.gl.posted, contract of bud/constants.js)
  const gl = w.events('fin.gl.posted'); assert.equal(gl.length, 1); assert.equal(gl[0].lines.length, 1); assert.equal(gl[0].lines[0].costCentreId, w.cc); assert.equal(gl[0].lines[0].amount, 1200);
});

test('§9 approval: the accounts manager up to ₹5 lakh, then the CFO; the maker never approves; return and resubmit; rights and isolation; idempotent replay', async () => {
  const w = await world(); const { ac: A } = w;
  const small = await w.post(w.jn([{ accountId: A.overheads, debit: 500000, projectId: w.A }, { accountId: A.bank, credit: 500000 }]));
  assert.equal(small.status, 'APPROVED', 'exactly ₹5 lakh: the accounts manager alone');
  const big = await w.call(U.fin, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 600000, projectId: w.A }, { accountId: A.bank, credit: 600000 }])); const id = big.json.data.id;
  assert.equal((await w.call(U.fin, 'POST', `/journals/${id}/submit`)).status, 202);
  assert.equal((await w.tasksOf(U.fin)).filter((t) => t.instance.id === w.wf('fin_journals', id)).length, 0, 'the maker has no task on it');
  assert.equal((await w.act(U.acc, w.wf('fin_journals', id), 'return')).status, 200);
  let x = (await w.call(U.fin, 'GET', `/journals/${id}`)).json.data; assert.equal(x.status, 'RETURNED');
  const upd = await w.call(U.fin, 'PATCH', `/journals/${id}`, { narration: 'Site overheads for June (corrected)', version: x.version }); assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal((await w.call(U.fin, 'POST', `/journals/${id}/submit`)).status, 202);
  assert.equal((await w.act(U.acc, w.wf('fin_journals', id))).status, 200);
  x = (await w.call(U.fin, 'GET', `/journals/${id}`)).json.data; assert.equal(x.status, 'SUBMITTED', 'above ₹5 lakh it waits for the CFO');
  assert.equal((await w.act(U.cfo, w.wf('fin_journals', id))).status, 200);
  x = (await w.call(U.fin, 'GET', `/journals/${id}`)).json.data; assert.equal(x.status, 'APPROVED'); assert.equal(x.voucherNo, 'JV/2026-27/000002');
  // rights: the auditor reads, does not make; a site engineer does not see; another company does not find it
  assert.equal((await w.call(U.aud, 'GET', `/journals/${id}`)).status, 200);
  assert.equal((await w.call(U.aud, 'POST', '/journals', w.jn([{ accountId: A.overheads, debit: 1, projectId: w.A }, { accountId: A.bank, credit: 1 }]))).status, 403);
  assert.equal((await w.call(U.se, 'GET', '/journals')).status, 403);
  assert.equal((await w.call(U.se, 'GET', '/trial-balance')).status, 403);
  assert.equal((await w.call(U.finX, 'GET', `/journals/${id}`)).status, 404);
  assert.equal((await w.call(U.fin, 'DELETE', `/journals/${id}`)).status, 409, 'a posted journal is not deleted');
  // the same request twice with one idempotency key makes one journal
  const k = key(); const body = w.jn([{ accountId: A.overheads, debit: 77, projectId: w.A }, { accountId: A.bank, credit: 77 }]);
  const a1 = await w.call(U.fin, 'POST', '/journals', body, k); const a2 = await w.call(U.fin, 'POST', '/journals', body, k);
  assert.equal(a1.status, 201); assert.equal(a2.json.data.id, a1.json.data.id);
  // a draft is changed with its version; a stale version is a conflict
  const v1 = a1.json.data.version; assert.equal((await w.call(U.fin, 'PATCH', `/journals/${a1.json.data.id}`, { narration: 'first change', version: v1 })).status, 200);
  assert.equal((await w.call(U.fin, 'PATCH', `/journals/${a1.json.data.id}`, { narration: 'second change', version: v1 })).status, 409);
  assert.equal((await w.call(U.fin, 'DELETE', `/journals/${a1.json.data.id}`)).status, 200);
});

test('FR-03 an accrual reverses itself on its date; a recurring template makes a journal sent for approval; FR-06 the balances carry to the next year as an opening journal', async () => {
  const w = await world(); const { ac: A } = w; const gl = glOf(w.d);
  const acc = await w.post(w.jn([{ accountId: A.overheads, debit: 40000, projectId: w.A }, { accountId: A.provision, credit: 40000 }], { kind: 'ACCRUAL', voucherDate: '2026-06-30', autoReverseOn: '2026-07-01', narration: 'Electricity of June, bill not yet received' }));
  assert.equal(acc.kind, 'ACCRUAL'); assert.equal(acc.status, 'APPROVED');
  assert.equal(gl.jobs.autoReverse('2026-06-30').reversed, 0, 'not before its date');
  assert.equal(gl.jobs.autoReverse('2026-07-01').reversed, 1); assert.equal(gl.jobs.autoReverse('2026-07-02').reversed, 0, 'once');
  const after1 = (await w.call(U.fin, 'GET', `/journals/${acc.id}`)).json.data; assert.ok(after1.reversedById);
  const tbJul = (await w.call(U.aud, 'GET', '/trial-balance?asOf=2026-07-31')).json.data; assert.equal(tbJul.rows.find((x) => x.accountId === A.provision).closingCredit, 0);
  const tbJun = (await w.call(U.aud, 'GET', '/trial-balance?asOf=2026-06-30')).json.data; assert.equal(tbJun.rows.find((x) => x.accountId === A.provision).closingCredit, 40000, 'June still shows the accrual');

  const rc = await w.call(U.fin, 'POST', '/recurring-journals', { name: 'Site office rent', voucherType: 'JV', frequency: 'MONTHLY', nextRunOn: '2026-07-05', narration: 'Rent of the site office', lines: [{ accountId: A.overheads, debit: 18000, projectId: w.A }, { accountId: A.bank, credit: 18000 }] });
  assert.equal(rc.status, 201, JSON.stringify(rc.json));
  assert.equal(gl.jobs.recurring('2026-07-04').made, 0); assert.equal(gl.jobs.recurring('2026-07-05').made, 1);
  const t1 = (await w.call(U.fin, 'GET', `/recurring-journals/${rc.json.data.id}`)).json.data; assert.equal(t1.nextRunOn, '2026-08-05'); assert.equal(t1.runs, 1); assert.equal(t1.journals.length, 1); assert.equal(t1.journals[0].status, 'SUBMITTED', 'sent for approval, not posted by the job');
  const made = (await w.call(U.fin, 'GET', `/journals/${t1.journals[0].id}`)).json.data; assert.equal(made.requestedBy, 'fin1'); assert.equal(made.kind, 'RECURRING');
  assert.equal((await w.act(U.acc, w.wf('fin_journals', made.id))).status, 200);
  assert.equal((await w.call(U.aud, 'POST', '/recurring-journals', { name: 'Audit rent', frequency: 'MONTHLY', nextRunOn: '2026-07-05', narration: 'Rent', lines: [{ accountId: A.overheads, debit: 1, projectId: w.A }, { accountId: A.bank, credit: 1 }] })).status, 403, 'the auditor sets up no recurring journal');

  // a revenue entry so the year has a profit, then the carry-forward
  await w.post(w.jn([{ accountId: A.bank, debit: 100000 }, { accountId: A.revenue, credit: 100000, projectId: w.A }], { narration: 'Advance billing received' }));
  const ny = await w.api.call('POST', '/api/v1/core/financial-years', { ...as('SYSADM', 'sys9'), headers: key(), body: { startDate: '2027-04-01' } }); assert.ok(ny.status < 300, JSON.stringify(ny.json));
  const fy = w.d.prepare("SELECT id FROM core_financial_years WHERE company_id = 1 AND start_date = '2026-04-01'").get().id;
  const cf = await w.call(U.fin, 'POST', '/gl/carry-forward', { fyId: fy }); assert.equal(cf.status, 201, JSON.stringify(cf.json));
  const ob = cf.json.data; assert.equal(ob.voucherType, 'OB'); assert.equal(ob.voucherDate, '2027-04-01'); assert.equal(ob.status, 'DRAFT');
  const bank = ob.lines.find((l) => l.accountId === A.bank); assert.equal(bank.debit, 100000 - 18000);
  const re = ob.lines.find((l) => l.accountId === A.retained); assert.ok(re, 'the profit goes to retained earnings'); assert.equal(re.credit, 100000 - 18000 - 40000 + 40000);
  assert.equal(ob.debit, ob.credit);
  assert.equal((await w.call(U.fin, 'POST', '/gl/carry-forward', { fyId: fy })).status, 409, 'not twice');
  assert.equal((await w.call(U.fin, 'POST', `/journals/${ob.id}/submit`)).status, 202); assert.equal((await w.act(U.acc, w.wf('fin_journals', ob.id))).status, 200);
  const tbNext = (await w.call(U.aud, 'GET', '/trial-balance?asOf=2027-04-30')).json.data;
  assert.equal(tbNext.fy.startDate, '2027-04-01'); assert.equal(tbNext.balanced, true); assert.equal(tbNext.rows.find((x) => x.accountId === A.bank).closingDebit, 82000); assert.equal(tbNext.rows.find((x) => x.accountId === A.revenue), undefined, 'income starts the new year at nil');
  assert.equal((await w.call(U.aud, 'GET', '/gl/integrity')).json.data.ok, true);
});

test('the posting engine entry: one journal per source document, control accounts allowed, dimension rules still checked', async () => {
  const w = await world(); const { ac: A } = w; const gl = glOf(w.d);
  const a = gl.postEngine(1, { date: '2026-06-10', narration: 'GRN 17', sourceType: 'inv_grns', sourceId: 17, lines: [{ accountId: A.overheads, debit: 900, projectId: w.A }, { accountId: A.ap, credit: 900, projectId: w.A }] });
  assert.equal(a.duplicate, false); assert.equal(a.journal.status, 'APPROVED'); assert.ok(a.journal.voucher_no);
  const b = gl.postEngine(1, { date: '2026-06-10', narration: 'GRN 17', sourceType: 'inv_grns', sourceId: 17, lines: [{ accountId: A.overheads, debit: 900, projectId: w.A }, { accountId: A.ap, credit: 900, projectId: w.A }] });
  assert.equal(b.duplicate, true); assert.equal(b.journal.id, a.journal.id);
  assert.throws(() => gl.postEngine(1, { date: '2026-06-10', narration: 'bad', sourceType: 'inv_grns', sourceId: 18, lines: [{ accountId: A.overheads, debit: 900 }, { accountId: A.ap, credit: 900 }] }), /needs a project/);
  const eng = (await w.call(U.fin, 'GET', `/journals/${a.journal.id}`)).json.data; assert.equal(eng.can.reverse, false, 'an engine journal is reversed through its source');
  assert.equal((await w.call(U.aud, 'GET', '/gl/integrity')).json.data.ok, true);
});
