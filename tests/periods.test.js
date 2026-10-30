import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/server/platform/integrity/index.js';
import '../src/server/modules/registry.js';
import { assertPeriodOpen } from '../src/server/modules/core/financial-years/service.js';
import { fiscalYearFrom, postingAllowed } from '../src/shared/fiscal.js';
import { admin, setupCompany, startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `period-${n}-${Math.random().toString(36).slice(2, 10)}` });
const acc = (user = 'asha') => ({ roles: 'ACCMGR', user, company: '1' });
const cfo = (user = 'chetan') => ({ roles: 'CFO', user, company: '1' });
const pm = { roles: 'PM', user: 'pooja', company: '1' };

const periodOf = async (api, date) => {
  const fy = (await api.call('GET', `${C}/financial-years/1`, acc())).json.data;
  return fy.periods.find((p) => p.startDate <= date && date <= p.endDate);
};
const setStatus = async (api, period, who, body) => api.call('POST', `${C}/periods/${period.id}/status`, { ...who, body: { reason: 'month-end close', version: period.version, ...body } });
const createDoc = (api, who, docDate = '2026-10-15', title = 'Test voucher') => api.call('POST', `${C}/sample-documents`, { ...who, headers: key('c'), body: { title, docDate } });

// ---- shared fiscal-year arithmetic ----
test('a financial year has twelve monthly periods with the right end dates, including a leap February', () => {
  const fy = fiscalYearFrom('2027-04-01');
  assert.deepEqual([fy.code, fy.startDate, fy.endDate, fy.periods.length], ['2027-28', '2027-04-01', '2028-03-31', 12]);
  assert.deepEqual(fy.periods[10], { periodNo: 11, name: 'Feb 2028', startDate: '2028-02-01', endDate: '2028-02-29' });
  assert.equal(fiscalYearFrom('2026-04-01').periods[10].endDate, '2027-02-28');
  assert.equal(fiscalYearFrom('2026-01-01').code, '2026', 'a calendar-year company');
  assert.equal(fiscalYearFrom('2026-10-01').periods[0].name, 'Oct 2026');
  assert.throws(() => fiscalYearFrom('2026-04-02'), /first day of a month/);
  assert.equal(postingAllowed('Open'), true);
  assert.equal(postingAllowed('Soft-closed'), false);
  assert.equal(postingAllowed('Soft-closed', { privileged: true }), true);
  assert.equal(postingAllowed('Closed', { privileged: true }), false);
});

// ---- creating financial years ----
test('FR-02 an administrator creates a financial year with twelve open periods for every module', async () => {
  const api = await startApi();
  const r = await api.call('POST', `${C}/financial-years`, { ...admin(), body: { startDate: '2026-04-01' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.code, '2026-27');
  assert.equal(r.json.data.periods.length, 12);
  assert.ok(r.json.data.periods.every((p) => Object.values(p.statuses).every((s) => s === 'Open')));
  assert.deepEqual(Object.keys(r.json.data.periods[0].statuses), ['finance', 'payroll', 'procurement', 'inventory', 'plant', 'projects']);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_financial_years'").get().n, 1);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.financial_year.created'").get().n, 1);
  await api.close();
});

test('creating a financial year refuses a wrong start, an overlap and a duplicate, and explains why', async () => {
  const api = await startApi();
  await setupCompany(api);
  const make = (startDate) => api.call('POST', `${C}/financial-years`, { ...admin(), body: { startDate } });
  const midMonth = await make('2027-04-15');
  assert.equal(midMonth.status, 422);
  assert.match(midMonth.json.error.message, /first day of a month/);
  const wrongMonth = await make('2027-01-01');
  assert.match(wrongMonth.json.error.message, /starts in month 4/);
  const dupe = await make('2026-04-01');
  assert.equal(dupe.status, 409);
  assert.match(dupe.json.error.message, /overlaps the financial year 2026-27/);
  assert.equal((await make('2026-04-31')).status, 400, 'not a real date');
  assert.equal((await make('2027-04-01')).status, 201, 'the next year is fine');
  await api.close();
});

test('the start month follows the company settings, and cannot change once years exist', async () => {
  const api = await startApi();
  const sys = admin();
  await api.call('PUT', `${C}/company-settings`, { ...sys, body: { legalName: 'Calendar Co', fyStartMonth: 1, reason: 'calendar year company' } });
  const fy = await api.call('POST', `${C}/financial-years`, { ...sys, body: { startDate: '2027-01-01' } });
  assert.equal(fy.json.data.code, '2027');
  const change = await api.call('PUT', `${C}/company-settings`, { ...sys, body: { legalName: 'Calendar Co', fyStartMonth: 4, version: 1, reason: 'try to move the year' } });
  assert.equal(change.status, 422);
  assert.match(change.json.error.message, /cannot change once financial years exist/);
  await api.close();
});

// ---- period status ----
test('closing and soft-closing a period for one module leaves the other modules open', async () => {
  const api = await startApi();
  await setupCompany(api);
  let p = await periodOf(api, '2026-10-15');
  const soft = await setStatus(api, p, acc(), { module: 'finance', status: 'Soft-closed' });
  assert.equal(soft.status, 200);
  assert.deepEqual([soft.json.data.statuses.finance, soft.json.data.statuses.payroll], ['Soft-closed', 'Open']);
  p = soft.json.data;
  const closed = await setStatus(api, p, cfo(), { module: 'finance', status: 'Closed' });
  assert.equal(closed.json.data.statuses.finance, 'Closed');
  const audit = api.db.prepare("SELECT * FROM core_audit_log WHERE entity = 'core_periods' ORDER BY id").all();
  assert.equal(audit.length, 2);
  assert.deepEqual(JSON.parse(audit[1].old_values), { module: 'finance', status: 'Soft-closed' });
  assert.equal(audit[1].reason, 'month-end close');
  await api.close();
});

test('status changes follow the rules: no reopening a closed period directly, stale versions conflict, reasons are required', async () => {
  const api = await startApi();
  await setupCompany(api);
  const p0 = await periodOf(api, '2026-10-15');
  const closed = (await setStatus(api, p0, acc(), { module: 'finance', status: 'Closed' })).json.data;
  const back = await setStatus(api, closed, acc(), { module: 'finance', status: 'Open' });
  assert.equal(back.status, 422);
  assert.match(back.json.error.message, /can only be reopened through a reopen request that the Accounts Manager and the CFO approve/);
  assert.equal((await setStatus(api, closed, acc(), { module: 'finance', status: 'Closed' })).status, 422, 'already closed');
  const stale = await setStatus(api, { ...p0 }, acc(), { module: 'payroll', status: 'Closed' });
  assert.equal(stale.status, 409, 'p0 holds an old version');
  assert.equal((await setStatus(api, closed, acc(), { module: 'nonsense', status: 'Closed' })).status, 400);
  assert.equal((await setStatus(api, closed, acc(), { module: 'payroll', status: 'Closed', reason: 'x' })).status, 400);
  const soft = await periodOf(api, '2026-11-15');
  await setStatus(api, soft, acc(), { module: 'finance', status: 'Soft-closed' }).then(async (r) => {
    const again = await setStatus(api, r.json.data, acc(), { module: 'finance', status: 'Soft-closed' });
    assert.equal(again.status, 422);
    const reopened = await setStatus(api, r.json.data, acc(), { module: 'finance', status: 'Open' });
    assert.equal(reopened.status, 200, 'a soft-close can be undone directly');
  });
  await api.close();
});

test('only finance managers manage periods; everyone else is refused', async () => {
  const api = await startApi();
  await setupCompany(api);
  const p = await periodOf(api, '2026-10-15');
  assert.equal((await setStatus(api, p, pm, { module: 'finance', status: 'Closed' })).status, 403);
  assert.equal((await setStatus(api, p, admin(), { module: 'finance', status: 'Closed' })).status, 403, 'the System Administrator configures but does not close the books');
  assert.equal((await api.call('GET', `${C}/financial-years`, pm)).status, 403);
  assert.equal((await api.call('GET', `${C}/financial-years`, acc())).status, 200);
  assert.equal((await api.call('POST', `${C}/financial-years`, { ...acc(), body: { startDate: '2027-04-01' } })).status, 403, 'creating a year is configuration');
  await api.close();
});

test('a financial year can be closed only when every period is closed for every module, and then it is locked', async () => {
  const api = await startApi();
  await setupCompany(api);
  const fy = () => api.call('GET', `${C}/financial-years/1`, acc()).then((r) => r.json.data);
  const early = await api.call('POST', `${C}/financial-years/1/close`, { ...acc(), headers: key(1), body: { reason: 'year end', version: 1 } });
  assert.equal(early.status, 422);
  assert.match(early.json.error.message, /Every period must be closed for every module/);
  for (const p of (await fy()).periods) {
    let cur = p;
    for (const m of ['finance', 'payroll', 'procurement', 'inventory', 'plant', 'projects']) {
      const r = await setStatus(api, cur, acc(), { module: m, status: 'Closed' });
      assert.equal(r.status, 200, r.json?.error?.message);
      cur = r.json.data;
    }
  }
  const done = await api.call('POST', `${C}/financial-years/1/close`, { ...acc(), headers: key(2), body: { reason: 'year end', version: 1 } });
  assert.equal(done.status, 200);
  assert.equal(done.json.data.status, 'Closed');
  const locked = await setStatus(api, (await fy()).periods[0], acc(), { module: 'finance', status: 'Open' });
  assert.equal(locked.status, 422);
  assert.match(locked.json.error.message, /financial year 2026-27 is closed/);
  await api.close();
});

// ---- T-03: enforcement by a sample transactional module ----
test('T-03 / AC-03 posting into a closed period is rejected with a clear message; after an approved reopen it succeeds', async () => {
  const api = await startApi();
  await setupCompany(api);
  assert.equal((await createDoc(api, pm)).status, 201, 'an open period accepts the posting');

  const p = await periodOf(api, '2026-10-15');
  await setStatus(api, p, acc(), { module: 'finance', status: 'Closed' });
  const refused = await createDoc(api, acc());
  assert.equal(refused.status, 422);
  assert.equal(refused.json.error.code, 'PERIOD_CLOSED');
  assert.match(refused.json.error.message, /period Oct 2026 is closed for finance/);
  assert.match(refused.json.error.message, /15-Oct-2026/);
  assert.match(refused.json.error.message, /reopen request/);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_sample_documents').get().n, 1, 'nothing was saved');
  assert.equal((await createDoc(api, pm, '2026-11-15')).status, 201, 'another period is unaffected');

  // The reopen request goes through the chain ACCMGR -> CFO.
  const req = await api.call('POST', `${C}/period-reopen-requests`, { ...admin(), headers: key(3), body: { periodId: p.id, module: 'finance', targetStatus: 'Open', reason: 'late vendor invoice must be posted' } });
  assert.equal(req.status, 201);
  assert.deepEqual([req.json.data.status, req.json.data.chain, req.json.data.currentStep], ['SUBMITTED', ['ACCMGR', 'CFO'], 1]);
  assert.equal((await createDoc(api, acc())).status, 422, 'asking is not enough: still closed');
  const id = req.json.data.id;
  const step1 = await api.call('POST', `${C}/change-requests/${id}/act`, { ...acc('asha'), headers: key(4), body: { action: 'approve' } });
  assert.equal(step1.json.data.currentStep, 2);
  assert.equal((await createDoc(api, acc())).status, 422, 'one approval of two is not enough');
  const step2 = await api.call('POST', `${C}/change-requests/${id}/act`, { ...cfo('chetan'), headers: key(5), body: { action: 'approve' } });
  assert.equal(step2.json.data.status, 'APPROVED');
  assert.equal(await periodOf(api, '2026-10-15').then((x) => x.statuses.finance), 'Open');
  assert.equal((await createDoc(api, pm)).status, 201, 'after the approved reopen the posting succeeds');
  const events = api.db.prepare("SELECT event_type FROM core_outbox WHERE event_type LIKE 'core.period.%' OR event_type LIKE 'core.change_request.%' ORDER BY id").all().map((e) => e.event_type);
  assert.ok(events.includes('core.period.reopened') && events.includes('core.change_request.approved'));
  await api.close();
});

test('a soft-closed period accepts postings only from the Accounts Manager and the CFO', async () => {
  const api = await startApi();
  await setupCompany(api);
  const p = await periodOf(api, '2026-10-15');
  await setStatus(api, p, acc(), { module: 'finance', status: 'Soft-closed' });
  const refused = await createDoc(api, pm);
  assert.equal(refused.status, 422);
  assert.equal(refused.json.error.code, 'PERIOD_SOFT_CLOSED');
  assert.match(refused.json.error.message, /only the Accounts Manager or the CFO/);
  assert.equal((await createDoc(api, acc())).status, 201);
  assert.equal((await createDoc(api, cfo())).status, 201);
  await api.close();
});

test('a date that no period covers is refused with a message that says to create the year', async () => {
  const api = await startApi();
  await setupCompany(api);
  const r = await createDoc(api, pm, '2031-01-10');
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'PERIOD_NOT_FOUND');
  assert.match(r.json.error.message, /10-Jan-2031/);
  assert.throws(() => assertPeriodOpen(api.db, { companyId: 1, module: 'bogus', date: '2026-10-15' }), /Unknown period module/);
  assert.equal(assertPeriodOpen(api.db, { companyId: 1, module: 'finance', date: '2026-10-15' }).name, 'Oct 2026');
  assert.throws(() => assertPeriodOpen(api.db, { companyId: 2, module: 'finance', date: '2026-10-15' }), (e) => e.code === 'PERIOD_NOT_FOUND', 'another company has no such period');
  await api.close();
});

test('period control applies to every posting step: submit and cancel of an existing draft are blocked once the period closes', async () => {
  const api = await startApi();
  await setupCompany(api);
  const doc = (await createDoc(api, pm)).json.data;
  const p = await periodOf(api, '2026-10-15');
  await setStatus(api, p, acc(), { module: 'finance', status: 'Closed' });
  const submit = await api.call('POST', `${C}/sample-documents/${doc.id}/submit`, { ...pm, headers: key(6), body: { version: doc.version } });
  assert.equal(submit.status, 422);
  assert.equal(submit.json.error.code, 'PERIOD_CLOSED');
  const cancel = await api.call('POST', `${C}/sample-documents/${doc.id}/cancel`, { ...pm, headers: key(7), body: { version: doc.version, reason: 'duplicate voucher' } });
  assert.equal(cancel.status, 422);
  assert.equal(api.db.prepare('SELECT status FROM core_sample_documents WHERE id = ?').get(doc.id).status, 'DRAFT');
  await api.close();
});

// ---- the approval chain ----
async function closedPeriodWithRequest(api) {
  const p = await periodOf(api, '2026-10-15');
  await setStatus(api, p, acc(), { module: 'finance', status: 'Closed' });
  const req = await api.call('POST', `${C}/period-reopen-requests`, { ...admin('1', 'ravi'), headers: key('r'), body: { periodId: p.id, module: 'finance', targetStatus: 'Open', reason: 'late invoice must be posted' } });
  return { period: p, id: req.json.data.id };
}
const act = (api, id, who, body) => api.call('POST', `${C}/change-requests/${id}/act`, { ...who, headers: key('a'), body });

test('AC-06 nobody can approve their own request, approve twice in one chain, or approve without the role of the step', async () => {
  const api = await startApi();
  await setupCompany(api);
  const { id } = await closedPeriodWithRequest(api);
  const own = await act(api, id, { roles: 'SYSADM,ACCMGR', user: 'ravi', company: '1' }, { action: 'approve' });
  assert.equal(own.status, 403);
  assert.equal(own.json.error.code, 'SEGREGATION_OF_DUTIES');
  assert.match(own.json.error.message, /someone else must approve/);
  const wrongRole = await act(api, id, cfo(), { action: 'approve' });
  assert.equal(wrongRole.status, 403);
  assert.match(wrongRole.json.error.message, /Step 1 .* needs the ACCMGR role/);
  assert.equal((await act(api, id, pm, { action: 'approve' })).status, 403);
  await act(api, id, acc('asha'), { action: 'approve' });
  const twice = await act(api, id, { roles: 'ACCMGR,CFO', user: 'asha', company: '1' }, { action: 'approve' });
  assert.equal(twice.status, 403);
  assert.match(twice.json.error.message, /already approved an earlier step/);
  assert.equal((await act(api, id, cfo('chetan'), { action: 'approve' })).json.data.status, 'APPROVED');
  const late = await act(api, id, cfo('dev'), { action: 'approve' });
  assert.equal(late.status, 422, 'a decided request cannot be decided again');
  await api.close();
});

test('a rejection needs a comment and leaves the period closed; a return can be resubmitted; the requester can withdraw', async () => {
  const api = await startApi();
  await setupCompany(api);
  let { period, id } = await closedPeriodWithRequest(api);
  const noComment = await act(api, id, acc('asha'), { action: 'reject' });
  assert.equal(noComment.status, 400);
  assert.deepEqual(noComment.json.error.details.map((d) => d.field), ['comment']);
  const rejected = await act(api, id, acc('asha'), { action: 'reject', comment: 'the period must stay closed' });
  assert.equal(rejected.json.data.status, 'REJECTED');
  assert.deepEqual(rejected.json.data.steps.map((s) => [s.role, s.decision, s.decidedBy]), [['ACCMGR', 'REJECTED', 'asha']]);
  assert.equal((await periodOf(api, '2026-10-15')).statuses.finance, 'Closed');

  // a new request: returned, resubmitted by its owner, then withdrawn
  const again = await api.call('POST', `${C}/period-reopen-requests`, { ...admin('1', 'ravi'), headers: key('r2'), body: { periodId: period.id, module: 'finance', targetStatus: 'Soft-closed', reason: 'second attempt, narrower' } });
  id = again.json.data.id;
  const returned = await act(api, id, acc('asha'), { action: 'return', comment: 'say which invoice' });
  assert.equal(returned.json.data.status, 'RETURNED');
  const stranger = await api.call('POST', `${C}/change-requests/${id}/resubmit`, { ...acc('asha'), headers: key('s'), body: { reason: 'not mine to resubmit' } });
  assert.equal(stranger.status, 403);
  const resub = await api.call('POST', `${C}/change-requests/${id}/resubmit`, { ...admin('1', 'ravi'), headers: key('s2'), body: { reason: 'invoice INV-114 from 14 October' } });
  assert.deepEqual([resub.json.data.status, resub.json.data.currentStep], ['SUBMITTED', 1]);
  assert.equal(resub.json.data.steps.length, 1, 'the earlier decision stays in the history');
  const withdrawn = await api.call('POST', `${C}/change-requests/${id}/withdraw`, { ...admin('1', 'ravi'), headers: key('w'), body: {} });
  assert.equal(withdrawn.json.data.status, 'CANCELLED');
  await api.close();
});

test('a reopen request is validated: only closed periods, one open request per period, a known module and target', async () => {
  const api = await startApi();
  await setupCompany(api);
  const open = await periodOf(api, '2026-11-15');
  const ask = (body, who = admin()) => api.call('POST', `${C}/period-reopen-requests`, { ...who, headers: key('v'), body: { reason: 'a good reason', ...body } });
  const notClosed = await ask({ periodId: open.id, module: 'finance', targetStatus: 'Open' });
  assert.equal(notClosed.status, 422);
  assert.match(notClosed.json.error.message, /only a closed period needs a reopen request/);
  const { period } = await closedPeriodWithRequest(api);
  const dupe = await ask({ periodId: period.id, module: 'finance', targetStatus: 'Open' });
  assert.equal(dupe.status, 409);
  assert.equal((await ask({ periodId: period.id, module: 'finance', targetStatus: 'Closed' })).status, 400);
  assert.equal((await ask({ periodId: 9999, module: 'finance', targetStatus: 'Open' })).status, 404);
  assert.equal((await ask({ periodId: period.id, module: 'finance', targetStatus: 'Open' }, pm)).status, 403);
  const noKey = await api.call('POST', `${C}/period-reopen-requests`, { ...admin(), body: { periodId: period.id, module: 'finance', targetStatus: 'Open', reason: 'a good reason' } });
  assert.equal(noKey.status, 400, 'this is an approval-controlled action: an Idempotency-Key is required');
  await api.close();
});

test('requests of one company are invisible to another, and decisions are written to the audit trail with the actor', async () => {
  const api = await startApi();
  await setupCompany(api);
  const { id } = await closedPeriodWithRequest(api);
  const other = { roles: 'ACCMGR', user: 'otto', company: '2' };
  assert.equal((await api.call('GET', `${C}/change-requests/${id}`, other)).status, 404);
  assert.equal((await api.call('GET', `${C}/change-requests`, other)).json.meta.total, 0);
  assert.equal((await act(api, id, other, { action: 'approve' })).status, 404);
  await act(api, id, acc('asha'), { action: 'approve' });
  const audit = api.db.prepare("SELECT actor, action FROM core_audit_log WHERE entity = 'core_change_requests' ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(audit, [{ actor: 'ravi', action: 'submit' }, { actor: 'asha', action: 'approved' }]);
  const list = await api.call('GET', `${C}/change-requests?filter[status]=SUBMITTED&filter[type]=period_reopen`, acc());
  assert.equal(list.json.meta.total, 1);
  assert.equal((await api.call('GET', `${C}/change-requests?filter[type]=bogus`, acc())).json.meta.total, 0);
  assert.equal((await api.call('GET', `${C}/change-requests?filter[nonsense]=x`, acc())).status, 400);
  await api.close();
});

test('period and request tables pass the integrity suite', async () => {
  const api = await startApi();
  await setupCompany(api);
  await closedPeriodWithRequest(api);
  const run = runChecks(api.db);
  assert.deepEqual(run.results.filter((r) => r.status === 'fail'), []);
  await api.close();
});
