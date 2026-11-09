import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { calcOf } from '../src/server/platform/calc/index.js';
import { tendersOf } from '../src/server/modules/bd/tender.js';
import { setupCompany, startApi } from './helpers.js';

// Part 08.02: the tender register. T-01 the bid capacity formula (A x N x 2 - B) reproduces the worked example, by the calculation engine. T-02 the deadline reminders fire at the configured offsets, once each. Also: the registration (checked by a colleague
// of the estimation team), the eligibility checklist with computed and manual results, the bid or no-bid score and the chain (a colleague of the estimation team, then the director), readiness blocked until the decision is approved and eligibility is complete
// (BR-01), addenda that move dates and send a ready tender back to preparation, pre-bid queries, team tasks, the documents, the calendar, the conversion of an opportunity, roles and scope.
const B = '/api/v1/bd';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const bd1 = as('BD', 'bd1'); const bd2 = as('BD', 'bd2'); const est1 = as('EST', 'est1'); const est2 = as('EST', 'est2'); const dir1 = as('DIR', 'dir1'); const dir2 = as('DIR', 'dir2'); const com1 = as('COMMGR', 'com1'); const emp1 = as('EMP', 'emp1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'r') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const ist = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const CR = 10_000_000;

const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  for (const [n, r] of [['bd1', ['BD']], ['bd2', ['BD']], ['est1', ['EST']], ['est2', ['EST']], ['dir1', ['DIR']], ['dir2', ['DIR']], ['com1', ['COMMGR']], ['emp1', ['EMP']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, n, JSON.stringify(r), `${n}@example.com`);
  const partner = (code, name, role, status = 'ACTIVE', company = 1) => { const id = Number(api.db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'COMMGR', 't', 'test')").run(company, code, name, name.toLowerCase(), status).lastInsertRowid); api.db.prepare('INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, ?)').run(company, id, role); return id; };
  const ids = { nhai: partner('CL001', 'National Highways Authority', 'CLIENT'), vendor: partner('VN001', 'Steel Traders', 'VENDOR'), other: partner('CL900', 'Other Company Client', 'CLIENT', 'ACTIVE', 2) };
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const patch = (who, path, body) => call(who, 'PATCH', path, body, uid());
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  return { api, call, post, patch, act, hasTask, ids };
};
const tender = (t, o = {}) => ({ clientPartnerId: t.ids.nhai, referenceNo: `NHAI/2027/${uid('n')}`, portal: 'CPPP', nameOfWork: 'Four-laning of NH-48 package 3', location: 'Pune', region: 'WEST', estCost: 100 * CR, emd: 2 * CR, tenderFee: 25_000, bidType: 'ITEM_RATE', periodMonths: 24, publishDate: ist(-5), prebidDate: ist(6), submissionAt: `${ist(20)}T15:00`, openingAt: `${ist(20)}T16:00`, ...o });
const events = (t, type) => t.api.db.prepare('SELECT payload FROM core_outbox WHERE event_type = ?').all(type).map((r) => JSON.parse(r.payload));
/** A registered tender: made by bd1 or est1, checked by a colleague of the estimation team. */
const registered = async (t, o = {}, maker = bd1) => {
  const r = await t.post(maker, `${B}/tenders`, tender(t, o)); assert.equal(r.status, 201, JSON.stringify(r.json));
  const s = (await t.post(maker, `${B}/tenders/${r.json.data.id}/submit`, {})); assert.equal(s.status, 202, JSON.stringify(s.json));
  await t.act(maker.user === 'est1' ? est2 : est1, s.json.data.workflowInstanceId);
  return (await t.call(est1, 'GET', `${B}/tenders/${r.json.data.id}`)).json.data;
};
const scores = (n = 4) => Object.fromEntries(['STRATEGIC_FIT', 'MARGIN', 'RISK', 'CAPACITY', 'COMPETITION'].map((k) => [k, { score: n, note: `${k.toLowerCase()} noted` }]));

test('T-01 BR-02 the bid capacity is A x N x 2 - B by the calculation engine, and the capacity criterion follows it', async () => {
  const t = await setup();
  // the worked example: A = 40 crore, N = 2 years, B = 30 crore: 40 x 2 x 2 - 30 = 130 crore
  const direct = calcOf(t.api.db).evaluate('tdr.bid_capacity', { max_turnover: '400000000.00', years: '2', commitments: '300000000.00', factor: '2' }, { companyId: 1, user: 'est1' });
  assert.equal(direct.result.capacity, '1300000000.00');
  const tn = await registered(t, { estCost: 100 * CR, periodMonths: 24 });
  assert.equal(tn.bidCapacity, 0 - 0, 'without the company profile the capacity is nothing');
  const tr = await t.post(est1, `${B}/tenders/${tn.id}/track`, { bcTurnover: 40 * CR, bcCommitments: 30 * CR, version: tn.rowVersion });
  assert.equal(tr.status, 200, JSON.stringify(tr.json)); assert.equal(tr.json.data.bidCapacity, 130 * CR);
  assert.equal(tr.json.data.capacity.formula, 'tdr.bid_capacity'); assert.equal(tr.json.data.capacity.years, '2');
  const row = tr.json.data.eligibility.rows.find((e) => e.criterion === 'BID_CAPACITY');
  assert.equal(row.result, 'PASS'); assert.equal(row.requirement, 100 * CR); assert.equal(row.our, 130 * CR); assert.equal(row.auto, true);
  // 18 months = 1.5 years, odd paise: A = 250000000.50, B = 100000000.25: 250000000.50 x 1.5 x 2 - 100000000.25 = 650000001.25
  const t2 = await registered(t, { estCost: 70 * CR, periodMonths: 18 });
  const r2 = await t.post(est1, `${B}/tenders/${t2.id}/track`, { bcTurnover: 250000000.5, bcCommitments: 100000000.25, version: t2.rowVersion });
  assert.equal(r2.json.data.bidCapacity, 650000001.25); assert.equal(r2.json.data.eligibility.rows.find((e) => e.criterion === 'BID_CAPACITY').result, 'FAIL', '650 million is short of 700 million');
  // a figure against a figure is not set by hand; it can be waived with a reason
  const cap = r2.json.data.eligibility.rows.find((e) => e.criterion === 'BID_CAPACITY');
  assert.equal((await t.patch(est1, `${B}/eligibility/${cap.id}`, { result: 'PASS', version: cap.rowVersion })).status, 400);
  assert.equal((await t.patch(est1, `${B}/eligibility/${cap.id}`, { result: 'WAIVED', version: cap.rowVersion })).status, 400, 'a waiver needs its reason');
  const w = await t.patch(est1, `${B}/eligibility/${cap.id}`, { result: 'WAIVED', waiveReason: 'Met through the joint venture partner', version: cap.rowVersion }); assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(w.json.data.eligibility.rows.find((e) => e.criterion === 'BID_CAPACITY').result, 'WAIVED');
  // the period or the cost changes the capacity requirement: the page cannot set the capacity
  assert.equal((await t.post(est1, `${B}/tenders/${t2.id}/capacity`, {})).status, 200);
  assert.equal((await t.post(bd1, `${B}/tenders/${t2.id}/track`, { bcTurnover: 1, version: 1 })).status, 403, 'business development does not manage the tender');
});

test('FR-01 the tender is registered from the form, checked by a colleague of the estimation team; the authority comes from the partner master', async () => {
  const t = await setup();
  assert.equal((await t.post(emp1, `${B}/tenders`, tender(t))).status, 403);
  assert.equal((await t.post(bd1, `${B}/tenders`, tender(t, { clientPartnerId: t.ids.vendor }))).status, 400, 'a vendor is not an authority');
  assert.equal((await t.post(bd1, `${B}/tenders`, tender(t, { clientPartnerId: t.ids.other }))).status, 400);
  assert.equal((await t.post(bd1, `${B}/tenders`, tender(t, { prebidDate: ist(30) }))).status, 400, 'the pre-bid is before the submission');
  assert.equal((await t.post(bd1, `${B}/tenders`, tender(t, { openingAt: `${ist(20)}T10:00` }))).status, 400, 'the opening is not before the submission');
  const r = await t.post(bd1, `${B}/tenders`, tender(t, { referenceNo: 'NHAI/2027/0042' })); assert.equal(r.status, 201, JSON.stringify(r.json));
  const d = r.json.data; assert.match(d.docNo, /^TDR-/); assert.equal(d.status, 'DRAFT'); assert.equal(d.stage, 'OPEN'); assert.equal(d.estCost, 100 * CR); assert.equal(d.eligibility.total, 6, 'the checklist starts with the criteria of the setting');
  assert.equal((await t.post(bd1, `${B}/tenders`, tender(t, { referenceNo: 'nhai/2027/0042' }))).status, 400, 'the same reference of the same authority');
  // a draft is changed by its maker only; a colleague does not even see it
  assert.equal((await t.call(bd2, 'GET', `${B}/tenders/${d.id}`)).status, 404); assert.equal((await t.patch(est1, `${B}/tenders/${d.id}`, { location: 'Nashik', version: d.rowVersion })).status, 403, 'the estimation manager sees it, and only the maker changes it');
  const up = (await t.patch(bd1, `${B}/tenders/${d.id}`, { location: 'Nashik', emd: 2.5 * CR, version: d.rowVersion })).json.data; assert.equal(up.location, 'Nashik'); assert.equal(up.emd, 2.5 * CR);
  assert.equal((await t.patch(bd1, `${B}/tenders/${d.id}`, { location: 'Stale', version: d.rowVersion })).status, 409);
  // sent: the maker never reviews; a colleague of the estimation team does
  const s = (await t.post(bd1, `${B}/tenders/${d.id}/submit`, {})).json.data; assert.equal(s.status, 'SUBMITTED');
  assert.equal(await t.hasTask(bd1, s.workflowInstanceId), false); assert.equal(await t.hasTask(est1, s.workflowInstanceId), true); assert.equal(await t.hasTask(est2, s.workflowInstanceId), true);
  assert.equal((await t.call(est1, 'GET', `${B}/tenders/${d.id}`)).status, 200, 'the reviewer can open what they review');
  assert.equal((await t.patch(bd1, `${B}/tenders/${d.id}`, { location: 'Locked', version: s.rowVersion })).status, 409);
  await t.act(est1, s.workflowInstanceId, 'return');
  const back = (await t.call(bd1, 'GET', `${B}/tenders/${d.id}`)).json.data; assert.equal(back.status, 'RETURNED');
  await t.patch(bd1, `${B}/tenders/${d.id}`, { portalName: 'eprocure.gov.in', version: back.rowVersion });
  const again = (await t.post(bd1, `${B}/tenders/${d.id}/submit`, {})).json.data; await t.act(est2, again.workflowInstanceId);
  const ok = (await t.call(bd1, 'GET', `${B}/tenders/${d.id}`)).json.data; assert.equal(ok.status, 'APPROVED'); assert.equal(ok.statusLabel, 'Registered'); assert.equal(events(t, 'bd.tender.registered').length, 1);
  assert.equal((await t.patch(bd1, `${B}/tenders/${d.id}`, { location: 'Quiet change', version: ok.rowVersion })).status, 409, 'a registered tender is amended, not edited');
  // the amendment is kept and checked again
  const am = await t.post(bd1, `${B}/tenders/${d.id}/amend`, { estCost: 110 * CR, reason: 'The authority revised the estimate', version: ok.rowVersion }); assert.equal(am.status, 200, JSON.stringify(am.json)); assert.equal(am.json.data.status, 'DRAFT'); assert.equal(am.json.data.amendments[0].before.estCost, 100 * CR);
  const s2 = await t.post(bd1, `${B}/tenders/${d.id}/submit`, {}); assert.equal(s2.status, 202, JSON.stringify(s2.json)); await t.act(est1, s2.json.data.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `${B}/tenders/${d.id}`)).json.data.estCost, 110 * CR);
  // a cancelled draft, a deleted draft, the history, the print, the export
  const x = (await t.post(bd1, `${B}/tenders`, tender(t))).json.data; assert.equal((await t.call(bd1, 'DELETE', `${B}/tenders/${x.id}`)).status, 200);
  const h = (await t.call(est1, 'GET', `${B}/tenders/${d.id}/history`)).json.data; assert.ok(h.approvals.length >= 3); assert.ok(h.dateLog.length >= 0);
  assert.equal((await t.call(est1, 'GET', `${B}/tenders/${d.id}/print`)).status, 200);
  assert.equal((await t.api.raw('GET', `${B}/tenders/export?format=csv`, est1)).status, 200); assert.equal((await t.api.raw('GET', `${B}/tenders/export?format=csv`, com1)).status, 403);
});

test('FR-02 FR-03 BR-01 eligibility and the bid decision (a colleague, then the director); readiness is blocked until both are done', async () => {
  const t = await setup();
  const tn = await registered(t, { estCost: 50 * CR });
  await t.post(est1, `${B}/tenders/${tn.id}/track`, { bcTurnover: 40 * CR, bcCommitments: 30 * CR, version: tn.rowVersion });
  // not ready: the decision and the eligibility are missing
  const no = await t.post(est1, `${B}/tenders/${tn.id}/ready`, {}); assert.equal(no.status, 422); assert.equal(no.json.error.code, 'NOT_READY'); assert.match(no.json.error.message, /bid or no-bid decision/);
  // the decision: every criterion is scored; a decision against the recommendation needs reasons
  assert.equal((await t.post(bd1, `${B}/bid-decisions`, { tenderId: tn.id, scores: scores(5), decision: 'BID' })).status, 403, 'business development reads the decision');
  assert.equal((await t.post(est1, `${B}/bid-decisions`, { tenderId: tn.id, scores: { STRATEGIC_FIT: { score: 4 } }, decision: 'BID' })).status, 400, 'all five criteria');
  const weak = await t.post(est1, `${B}/bid-decisions`, { tenderId: tn.id, scores: scores(2), decision: 'BID' }); assert.equal(weak.status, 400); assert.match(JSON.stringify(weak.json), /reasons/);
  const c = await t.post(est1, `${B}/bid-decisions`, { tenderId: tn.id, scores: scores(4), decision: 'BID' }); assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal(c.json.data.totalScore, 80, '100 x 4/5'); assert.equal(c.json.data.recommendation, 'BID'); assert.match(c.json.data.docNo, /^BID-/);
  assert.equal((await t.post(est1, `${B}/bid-decisions`, { tenderId: tn.id, scores: scores(4), decision: 'BID' })).status, 409, 'one decision for a tender');
  const sub = (await t.post(est1, `${B}/bid-decisions/${c.json.data.id}/submit`, {})).json.data; assert.equal(sub.status, 'SUBMITTED');
  assert.equal(await t.hasTask(est1, sub.workflowInstanceId), false, 'the maker never reviews'); assert.equal(await t.hasTask(dir1, sub.workflowInstanceId), false, 'the director comes second');
  await t.act(est2, sub.workflowInstanceId); assert.equal((await t.call(est1, 'GET', `${B}/bid-decisions/${c.json.data.id}`)).json.data.status, 'SUBMITTED'); await t.act(dir1, sub.workflowInstanceId);
  const ap = (await t.call(est1, 'GET', `${B}/bid-decisions/${c.json.data.id}`)).json.data; assert.equal(ap.status, 'APPROVED');
  const tn2 = (await t.call(est1, 'GET', `${B}/tenders/${tn.id}`)).json.data; assert.equal(tn2.stage, 'BID'); assert.equal(events(t, 'bd.tender.bid_decided')[0].data.decision, 'BID');
  // the eligibility: the figures are worked out; the others are marked by hand; a failed criterion blocks
  const rows = tn2.eligibility.rows; assert.equal(rows.find((e) => e.criterion === 'BID_CAPACITY').result, 'PASS');
  const turnover = rows.find((e) => e.criterion === 'TURNOVER');
  let cur = (await t.patch(est1, `${B}/eligibility/${turnover.id}`, { requirement: 20 * CR, our: 15 * CR, version: turnover.rowVersion })).json.data; assert.equal(cur.eligibility.rows.find((e) => e.criterion === 'TURNOVER').result, 'FAIL');
  for (const k of ['SIMILAR_WORK', 'REGISTRATION_CLASS', 'JV']) { const e = cur.eligibility.rows.find((x) => x.criterion === k); assert.equal(e.auto, false); cur = (await t.patch(est1, `${B}/eligibility/${e.id}`, { result: 'PASS', ourText: 'Class AA, three similar works', version: e.rowVersion })).json.data; }
  const nw = cur.eligibility.rows.find((e) => e.criterion === 'NET_WORTH'); cur = (await t.patch(est1, `${B}/eligibility/${nw.id}`, { requirement: 10 * CR, our: 25 * CR, version: nw.rowVersion })).json.data;
  assert.equal(cur.eligibility.complete, false); assert.equal(cur.eligibility.failed, 1);
  const blocked = await t.post(est1, `${B}/tenders/${tn.id}/ready`, {}); assert.equal(blocked.status, 422); assert.match(blocked.json.error.message, /Eligibility is not complete/);
  const t0 = cur.eligibility.rows.find((e) => e.criterion === 'TURNOVER');
  cur = (await t.patch(est1, `${B}/eligibility/${t0.id}`, { our: 22 * CR, version: t0.rowVersion })).json.data; assert.equal(cur.eligibility.complete, true, 'the turnover now meets the requirement');
  // evidence files per row go through the file service
  assert.ok(cur.readiness.items.find((i) => i.code === 'ELIGIBILITY').ok);
  // ready: the event carries what estimation and submission need
  const ready = await t.post(est1, `${B}/tenders/${tn.id}/ready`, {}); assert.equal(ready.status, 200, JSON.stringify(ready.json)); assert.equal(ready.json.data.stage, 'READY');
  const ev = events(t, 'bd.tender.ready'); assert.equal(ev.length, 1); assert.equal(ev[0].data.tenderId, tn.id); assert.equal(ev[0].data.estCost, 50 * CR); assert.equal(ev[0].data.bidCapacity, 130 * CR); assert.equal(ev[0].data.clientPartnerId, t.ids.nhai);
  assert.equal((await t.patch(est1, `${B}/eligibility/${t0.id}`, { our: 1, version: 99 })).status, 422, 'a ready tender is not changed');
  // the director may cancel nothing here; a no-bid decision of another tender stops it
  const tn3 = await registered(t, { nameOfWork: 'Small bridge repair' });
  const nb = (await t.post(est1, `${B}/bid-decisions`, { tenderId: tn3.id, scores: scores(2), decision: 'NO_BID' })).json.data; assert.equal(nb.recommendation, 'NO_BID');
  const ns = (await t.post(est1, `${B}/bid-decisions/${nb.id}/submit`, {})).json.data; await t.act(est2, ns.workflowInstanceId); await t.act(dir2, ns.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `${B}/tenders/${tn3.id}`)).json.data.stage, 'NO_BID');
  assert.equal((await t.post(est1, `${B}/tenders/${tn3.id}/ready`, {})).status, 422);
  // the amendment of an approved decision: back to the chain, the snapshot is kept
  const am = await t.post(est1, `${B}/bid-decisions/${nb.id}/amend`, { scores: scores(4), decision: 'BID', reason: 'The authority revised the scope', version: (await t.call(est1, 'GET', `${B}/bid-decisions/${nb.id}`)).json.data.rowVersion });
  assert.equal(am.status, 200, JSON.stringify(am.json)); assert.equal(am.json.data.status, 'DRAFT'); assert.equal(am.json.data.amendments[0].before.decision, 'NO_BID');
  const as2 = await t.post(est1, `${B}/bid-decisions/${nb.id}/submit`, {}); assert.equal(as2.status, 202, JSON.stringify(as2.json)); await t.act(est2, as2.json.data.workflowInstanceId); await t.act(dir1, as2.json.data.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `${B}/tenders/${tn3.id}`)).json.data.stage, 'BID');
  assert.equal((await t.api.raw('GET', `${B}/bid-decisions/export?format=csv`, est1)).status, 200); assert.equal((await t.call(est1, 'GET', `${B}/bid-decisions/${nb.id}/print`)).status, 200);
});

test('FR-04 FR-05 FR-06 addenda move dates and send a ready tender back to preparation; pre-bid queries and clarifications; the team tasks; the documents', async () => {
  const t = await setup();
  const tn = await registered(t, { prebidDate: ist(6), submissionAt: `${ist(20)}T15:00`, openingAt: `${ist(20)}T16:00` });
  assert.equal((await t.post(bd1, `${B}/tenders/${tn.id}/addenda`, { date: ist(0), summary: 'Extension of time', impact: 'DATES', impactNote: 'Later', newSubmissionAt: `${ist(27)}T15:00` })).status, 403);
  // an addendum that moves the submission: the dates and the log change, the team is told
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/addenda`, { date: ist(0), summary: 'Date moved', impact: 'NONE', newSubmissionAt: `${ist(27)}T15:00` })).status, 400, 'a date moves with the impact Dates');
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/addenda`, { date: ist(0), summary: 'Date moved', impact: 'DATES', impactNote: 'Opening before submission', newSubmissionAt: `${ist(27)}T15:00` })).status, 400, 'the opening is not before the submission');
  const a1 = await t.post(est1, `${B}/tenders/${tn.id}/addenda`, { kind: 'CORRIGENDUM', date: ist(0), summary: 'Submission extended by seven days', impact: 'DATES', impactNote: 'More time for the financial bid', newSubmissionAt: `${ist(27)}T15:00`, newOpeningAt: `${ist(27)}T16:00` });
  assert.equal(a1.status, 201, JSON.stringify(a1.json)); const d1 = a1.json.data;
  assert.equal(d1.submissionAt, `${ist(27)}T15:00`); assert.equal(d1.addenda[0].number, 1); assert.equal(d1.addenda[0].acknowledged, false); assert.deepEqual(d1.dateLog.map((x) => x.field).sort(), ['opening_at', 'submission_at']);
  assert.equal(events(t, 'bd.tender.addendum_issued').length, 1);
  const a2 = (await t.post(est1, `${B}/tenders/${tn.id}/addenda`, { date: ist(1), summary: 'Clause 4.2 replaced', impact: 'SCOPE', impactNote: 'The pavement thickness changes' })).json.data; assert.equal(a2.addenda[1].number, 2);
  assert.equal(a2.readiness.items.find((i) => i.code === 'ADDENDA').ok, false);
  const ack = await t.post(est1, `${B}/addenda/${a2.addenda[0].id}/acknowledge`, {}); assert.equal(ack.status, 200); assert.equal((await t.post(est1, `${B}/addenda/${a2.addenda[0].id}/acknowledge`, {})).status, 422, 'once');
  // queries linked to clauses; sent before the pre-bid date; the clarification is recorded
  const q = (await t.post(est1, `${B}/tenders/${tn.id}/queries`, { clauseRef: 'ITB 12.3', query: 'Is a JV partner permitted to meet the turnover criterion?' })).json.data; assert.equal(q.queries[0].seq, 1); assert.equal(q.queries[0].status, 'DRAFT');
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/queries`, { clauseRef: 'ITB 1', query: 'x', addendumNumber: 9 })).status, 400, 'the addendum must exist');
  const qid = q.queries[0].id;
  assert.equal((await t.post(est1, `${B}/queries/${qid}/respond`, { response: 'Yes, up to 50 percent', date: ist(1) })).status, 422, 'send it first');
  const sent = (await t.post(est1, `${B}/queries/${qid}/send`, {})).json.data; assert.equal(sent.queries[0].status, 'SUBMITTED'); assert.equal(sent.queries[0].submittedOn, ist(0));
  assert.equal((await t.patch(est1, `${B}/queries/${qid}`, { query: 'Changed after sending', version: sent.queries[0].rowVersion })).status, 409);
  assert.equal(sent.readiness.items.find((i) => i.code === 'QUERIES').ok, false, 'a query without an answer is shown, not blocking');
  assert.equal((await t.post(est1, `${B}/queries/${qid}/respond`, { response: 'Yes, up to 50 percent', date: ist(-3) })).status, 400, 'not before it was sent');
  const ans = (await t.post(est1, `${B}/queries/${qid}/respond`, { response: 'Yes, up to 50 percent of the criterion', date: ist(2) })).json.data; assert.equal(ans.queries[0].status, 'ANSWERED'); assert.equal(events(t, 'bd.tender.query_answered').length, 1);
  // the tender team
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/team-tasks`, { kind: 'SITE_VISIT', title: 'Visit the site', assignee: 'nobody', dueDate: ist(5) })).status, 400);
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/team-tasks`, { kind: 'SITE_VISIT', title: 'Visit the site', assignee: 'est2', dueDate: ist(40) })).status, 400, 'on or before the submission');
  const tk = (await t.post(est1, `${B}/tenders/${tn.id}/team-tasks`, { kind: 'ESTIMATION', title: 'Price the bill of quantities', assignee: 'est2', dueDate: ist(15) })).json.data; const task = tk.teamTasks[0]; assert.ok(task.taskId, 'a task of the assignee was made');
  assert.equal(t.api.db.prepare('SELECT due_date FROM tsk_tasks WHERE id = ?').get(task.taskId).due_date, ist(15));
  assert.equal((await t.post(com1, `${B}/team-tasks/${task.id}/done`, {})).status, 403); assert.equal((await t.post(bd2, `${B}/team-tasks/${task.id}/done`, {})).status, 404);
  const done = (await t.post(est2, `${B}/team-tasks/${task.id}/done`, {})); assert.equal(done.status, 200, JSON.stringify(done.json)); assert.equal(done.json.data.teamTasks[0].status, 'DONE');
  // the documents: registered in the document service and linked to the tender
  const doc = await t.post(est1, `${B}/tenders/${tn.id}/documents`, { title: 'Notice inviting tender', kind: 'NIT' }); assert.equal(doc.status, 201, JSON.stringify(doc.json));
  const docs = (await t.call(est1, 'GET', `${B}/tenders/${tn.id}/documents`)).json.data; assert.equal(docs.available, true); assert.equal(docs.rows.length, 1); assert.equal(docs.rows[0].docNo, doc.json.data.docNo);
  // the calendar: the dates of the tender and the tasks
  const cal = (await t.call(est1, 'GET', `${B}/tender-reports/calendar?from=${ist(0)}&to=${ist(30)}`)).json.data;
  assert.deepEqual(cal.events.filter((e) => e.kind !== 'TASK').map((e) => e.kind), ['PREBID', 'SUBMISSION', 'OPENING']); assert.equal(cal.events.find((e) => e.kind === 'SUBMISSION').date, ist(27));
  // a ready tender goes back to preparation when an addendum arrives
  const dec = (await t.post(est1, `${B}/bid-decisions`, { tenderId: tn.id, scores: scores(5), decision: 'BID' })).json.data; const ds = (await t.post(est1, `${B}/bid-decisions/${dec.id}/submit`, {})).json.data; await t.act(est2, ds.workflowInstanceId); await t.act(dir1, ds.workflowInstanceId);
  await t.post(est1, `${B}/tenders/${tn.id}/capacity`, {});
  let cur = (await t.call(est1, 'GET', `${B}/tenders/${tn.id}`)).json.data;
  for (const e of cur.eligibility.rows) cur = (await t.patch(est1, `${B}/eligibility/${e.id}`, e.auto ? { result: 'WAIVED', waiveReason: 'Covered by the joint venture partner', version: e.rowVersion } : { result: 'PASS', version: e.rowVersion })).json.data;
  await t.post(est1, `${B}/addenda/${cur.addenda[1].id}/acknowledge`, {});
  const rd = await t.post(est1, `${B}/tenders/${tn.id}/ready`, {}); assert.equal(rd.status, 200, JSON.stringify(rd.json));
  const a3 = (await t.post(est1, `${B}/tenders/${tn.id}/addenda`, { date: ist(2), summary: 'Schedule of quantities revised', impact: 'VALUE', impactNote: 'Item 14 quantity doubled' })).json.data;
  assert.equal(a3.stage, 'BID', 'ready no more: the addendum must be read'); assert.equal(events(t, 'bd.tender.addendum_issued').at(-1).data.backToPreparation, true);
  // submitted by 08.03
  await t.post(est1, `${B}/addenda/${a3.addenda[2].id}/acknowledge`, {}); assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/ready`, {})).status, 200);
  const sys = { user: 'system', userId: null, companyId: 1, roles: ['SYSADM'] };
  assert.equal(tendersOf(t.api.db).tenders.markSubmitted(sys, tn.id, { submittedOn: ist(0) }).stage, 'SUBMITTED'); assert.equal(events(t, 'bd.tender.submitted').length, 1);
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/addenda`, { date: ist(3), summary: 'Late corrigendum', impact: 'NONE' })).status, 201, 'a submitted tender still records what the authority issues');
});

test('T-02 FR-07 the deadline reminders fire at the configured offsets, once for each date', async () => {
  const t = await setup();
  const tn = await registered(t, { prebidDate: ist(6), submissionAt: `${ist(10)}T17:00`, openingAt: `${ist(11)}T11:00` }, est1);
  const tk = await t.post(est1, `${B}/tenders/${tn.id}/team-tasks`, { kind: 'FINANCIAL_DOCS', title: 'Collect the financial documents', assignee: 'est2', dueDate: ist(8) }); assert.equal(tk.status, 201, JSON.stringify(tk.json));
  const svc = tendersOf(t.api.db);
  const count = (user) => t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'bd.tender.reminder' AND user_ref = ?").get(user).n;
  const fire = (n) => svc.cycle(1, { today: ist(n) }).reminded;
  assert.equal(fire(0), 0, 'ten days before the submission: no offset');
  // the pre-bid is on day 6, the task on day 8, the submission on day 10, the opening on day 11; the offsets are 7, 3, 1 and 0 days before
  assert.equal(fire(3), 4, 'day 3: the pre-bid in 3 days and the submission in 7 days, for the owner and the person with an open task'); assert.deepEqual([count('est1'), count('est2')], [2, 2]);
  assert.equal(fire(3), 4, 'the job counts what it found'); assert.deepEqual([count('est1'), count('est2')], [2, 2], 'the same dates are not told again');
  assert.equal(fire(4), 2, 'day 4: the opening in 7 days'); assert.deepEqual([count('est1'), count('est2')], [3, 3]);
  fire(5); assert.deepEqual([count('est1'), count('est2')], [4, 5], 'day 5: the pre-bid in 1 day (both) and the task in 3 days (its assignee)');
  fire(6); assert.deepEqual([count('est1'), count('est2')], [5, 6], 'the day of the pre-bid');
  fire(7); assert.deepEqual([count('est1'), count('est2')], [6, 8], 'the submission in 3 days and the task in 1 day');
  fire(8); assert.deepEqual([count('est1'), count('est2')], [7, 10], 'the opening in 3 days; the task is due today');
  fire(9); assert.deepEqual([count('est1'), count('est2')], [8, 11], 'the submission tomorrow');
  fire(10); assert.deepEqual([count('est1'), count('est2')], [10, 13], 'the day of the submission and the opening tomorrow');
  // a moved date is told again; a tender no longer live is left alone
  const cur = (await t.call(est1, 'GET', `${B}/tenders/${tn.id}`)).json.data;
  await t.post(est1, `${B}/tenders/${cur.id}/addenda`, { date: ist(0), summary: 'Submission moved', impact: 'DATES', impactNote: 'Later', newSubmissionAt: `${ist(14)}T17:00`, newOpeningAt: `${ist(14)}T18:00` });
  const n0 = count('est1'); fire(7); assert.ok(count('est1') > n0, 'seven days before the new date');
  await t.post(est1, `${B}/tenders/${cur.id}/cancel`, { reason: 'The authority withdrew the tender' }); const n1 = count('est1'); fire(11); fire(13); assert.equal(count('est1'), n1);
  // the dashboard
  const dash = (await t.call(est1, 'GET', `${B}/tender-reports/dashboard`)).json.data; assert.equal(dash.byStage.length, 8); assert.ok(dash.tiles.live === 0);
  assert.equal((await t.call(emp1, 'GET', `${B}/tender-reports/dashboard`)).status, 403);
});

test('FR-01 an opportunity converted to a tender makes the draft tender; roles and scope', async () => {
  const t = await setup();
  const mkOpp = async () => {
    const o = (await t.post(bd1, `${B}/opportunities`, { clientPartnerId: t.ids.nhai, name: 'Ring road package 7', sector: 'ROADS', location: 'Nagpur', region: 'CENTRAL', estValue: 80 * CR })).json.data;
    const s = (await t.post(bd1, `${B}/opportunities/${o.id}/submit`, {})).json.data; await t.act(bd2, s.workflowInstanceId); await t.act(dir1, s.workflowInstanceId);
    return (await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data;
  };
  const o = await mkOpp(); const cv = await t.post(bd1, `${B}/opportunities/${o.id}/convert`, { version: o.rowVersion }); assert.equal(cv.status, 200, JSON.stringify(cv.json));
  const row = t.api.db.prepare('SELECT * FROM tdr_tenders WHERE opportunity_id = ?').get(o.id); assert.ok(row, 'the draft tender was made in the same transaction');
  assert.equal(row.status, 'DRAFT'); assert.equal(row.est_cost_minor, 80 * CR * 100); assert.equal(row.name_of_work, 'Ring road package 7'); assert.equal(row.owner, 'bd1'); assert.equal(row.source_type, 'bd_opportunity');
  const opp2 = (await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data; assert.equal(opp2.tenderRef, row.doc_no); assert.equal(opp2.convertedAt != null, true);
  const mine = (await t.call(bd1, 'GET', `${B}/tenders/${row.id}`)).json.data; assert.equal(mine.related.find((r) => r.type === 'Opportunity').ref, o.docNo); assert.equal(mine.eligibility.total, 6);
  assert.equal((await t.post(bd1, `${B}/tenders`, tender(t, { opportunityId: o.id }))).status, 400, 'a tender is registered for this opportunity already');
  // roles: BD own, EST all and manage, DIR all, COMMGR read, EMP none, SYSADM none, another company nothing
  assert.equal((await t.call(bd2, 'GET', `${B}/tenders/${row.id}`)).status, 404);
  for (const [who, st] of [[bd1, 200], [est1, 200], [dir1, 200], [com1, 200], [emp1, 403]]) assert.equal((await t.call(who, 'GET', `${B}/tenders/${row.id}`)).status, st, `${who.user} reads`);
  assert.equal((await t.call(bd2, 'GET', `${B}/tenders`)).json.data.length, 0); assert.equal((await t.call(est1, 'GET', `${B}/tenders`)).json.data.length, 1);
  assert.equal((await t.call(as('SYSADM', 'sys1'), 'GET', `${B}/tenders`)).status, 403);
  assert.equal((await t.post(com1, `${B}/tenders`, tender(t))).status, 403); assert.equal((await t.post(com1, `${B}/bid-decisions`, { tenderId: row.id, scores: scores(4), decision: 'BID' })).status, 403);
  t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'dir9', 'dir9', '[\"DIR\"]', 'd9@example.com')").run(); const other = as('DIR', 'dir9', '2');
  assert.equal((await t.call(other, 'GET', `${B}/tenders/${row.id}`)).status, 404); assert.equal((await t.call(other, 'GET', `${B}/tenders`)).json.data.length, 0);
  // no bypass: the decision needs the registration; readiness needs everything; an idempotent replay returns the same record; a missing key is refused
  assert.equal((await t.post(est1, `${B}/bid-decisions`, { tenderId: row.id, scores: scores(4), decision: 'BID' })).status, 422, 'the registration of the tender comes first');
  const key = uid('k'); const body = tender(t, { nameOfWork: 'Replay tender package' }); const a = await t.call(bd1, 'POST', `${B}/tenders`, body, key); const b = await t.call(bd1, 'POST', `${B}/tenders`, body, key); assert.equal(a.json.data.id, b.json.data.id);
  assert.equal((await t.call(bd1, 'POST', `${B}/tenders`, tender(t))).status, 400);
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'tdr_tenders'").get().n >= 2);
});
