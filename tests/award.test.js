import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { awardsOf, ageingOf, rankBids } from '../src/server/modules/bd/award.js';
import { setupCompany, startApi } from './helpers.js';

// Part 08.03 (built on the tender register of 08.02). T-01 the bid capacity formula (A x N x 2 - B) reproduces the worked example, by the calculation engine. T-02 the deadline reminders fire at the configured offsets, once each. Also: the registration (checked by a colleague
// of the estimation team), the eligibility checklist with computed and manual results, the bid or no-bid score and the chain (a colleague of the estimation team, then the director), readiness blocked until the decision is approved and eligibility is complete
// (BR-01), addenda that move dates and send a ready tender back to preparation, pre-bid queries, team tasks, the documents, the calendar, the conversion of an opportunity, roles and scope.
const B = '/api/v1/bd';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const bd1 = as('BD', 'bd1'); const bd2 = as('BD', 'bd2'); const est1 = as('EST', 'est1'); const est2 = as('EST', 'est2'); const dir1 = as('DIR', 'dir1'); const dir2 = as('DIR', 'dir2'); const com1 = as('COMMGR', 'com1'); const emp1 = as('EMP', 'emp1'); const acc1 = as('ACCMGR', 'acc1'); const cfo1 = as('CFO', 'cfo1');
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
  for (const [n, r] of [['bd1', ['BD']], ['bd2', ['BD']], ['est1', ['EST']], ['est2', ['EST']], ['dir1', ['DIR']], ['dir2', ['DIR']], ['com1', ['COMMGR']], ['emp1', ['EMP']], ['acc1', ['ACCMGR']], ['cfo1', ['CFO']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, n, JSON.stringify(r), `${n}@example.com`);
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

/** A tender that is ready for submission: registered, the decision to bid approved, the eligibility complete. */
const ready = async (t, o = {}) => {
  const tn = await registered(t, o, est1);
  await t.post(est1, `${B}/tenders/${tn.id}/track`, { bcTurnover: 400 * CR, bcCommitments: 100 * CR, version: tn.rowVersion });
  const d = (await t.post(est1, `${B}/bid-decisions`, { tenderId: tn.id, scores: scores(4), decision: 'BID' })).json.data; const ds = (await t.post(est1, `${B}/bid-decisions/${d.id}/submit`, {})).json.data; await t.act(est2, ds.workflowInstanceId); await t.act(dir1, ds.workflowInstanceId);
  const cur = (await t.call(est1, 'GET', `${B}/tenders/${tn.id}`)).json.data;
  for (const e of cur.eligibility.rows.filter((r) => r.result !== 'PASS')) await (t.patch(est1, `${B}/eligibility/${e.id}`, e.auto ? { requirement: 10 * CR, our: 20 * CR, version: e.rowVersion } : { result: 'PASS', version: e.rowVersion }));
  const r = await t.post(est1, `${B}/tenders/${tn.id}/ready`, {}); assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
/** The EMD or fee asked for, approved by estimation, accounts and the CFO, and its instrument recorded by accounts. */
const security = async (t, tn, kind, mode, issue = true) => {
  const c = await t.post(est1, `${B}/emd`, { tenderId: tn.id, kind, mode, payee: 'NHAI Pune', submit: true }); assert.equal(c.status, 201, JSON.stringify(c.json));
  await t.act(est2, c.json.data.workflowInstanceId); await t.act(acc1, c.json.data.workflowInstanceId); await t.act(cfo1, c.json.data.workflowInstanceId);
  if (issue) { const i = await t.post(acc1, `${B}/emd/${c.json.data.id}/issue`, { instrumentNo: mode === 'ONLINE' ? 'UTR778812345' : 'BG/SBI/2027/0091', bank: 'State Bank of India', issueDate: ist(0), ...(mode === 'BG' ? { validUntil: ist(200) } : {}) }); assert.equal(i.status, 200, JSON.stringify(i.json)); return i.json.data; }
  return (await t.call(acc1, 'GET', `${B}/emd/${c.json.data.id}`)).json.data;
};
/** The final bid prepared, approved (estimation, then the director) and recorded as uploaded on the portal. */
const submitted = async (t, tn, bid = 98 * CR) => {
  const s = (await t.post(est1, `${B}/submissions`, { tenderId: tn.id, estimate: bid, estimateRef: 'EST-0007', bidAmount: bid })).json.data;
  const u = (await t.patch(est1, `${B}/submissions/${s.id}`, { items: s.items.map((i) => ({ code: i.code, done: true })), version: s.rowVersion })).json.data;
  const sent = await t.post(est1, `${B}/submissions/${u.id}/submit`, {}); assert.equal(sent.status, 202, JSON.stringify(sent.json));
  await t.act(est2, sent.json.data.workflowInstanceId); await t.act(dir1, sent.json.data.workflowInstanceId);
  const rec = await t.post(est1, `${B}/submissions/${u.id}/record`, { submittedAt: `${ist(0)}T11:30`, portalRef: 'CPPP/ACK/2027/55102' }); assert.equal(rec.status, 200, JSON.stringify(rec.json));
  return rec.json.data;
};

test('T-01 the ranks of the opening are worked out by the server; the refund ageing of an EMD is right', () => {
  const r = rankBids([{ name: 'Us', quoted: 98, qualified: true }, { name: 'A', quoted: 95, qualified: true }, { name: 'B', quoted: 98, qualified: true }, { name: 'C', quoted: 90, qualified: false }, { name: 'D', quoted: 105, qualified: true }, { name: 'E', quoted: null, qualified: true }]);
  assert.deepEqual(r.bids.map((b) => [b.name, b.rank]), [['Us', 2], ['A', 1], ['B', 2], ['C', null], ['D', 4], ['E', null]], 'L1 is the lowest qualified price; equal prices share the rank; a disqualified bid has none');
  assert.equal(r.l1, 95); assert.equal(r.bids.find((b) => b.name === 'Us').diffBp, 316, '(98 - 95) / 95 = 3.16 %'); assert.equal(r.bids.find((b) => b.name === 'D').diffBp, 1053);
  assert.deepEqual(ageingOf('2027-01-01', '2027-01-31'), { days: 30, bucket: '0-30' }); assert.deepEqual(ageingOf('2027-01-01', '2027-02-01'), { days: 31, bucket: '31-60' });
  assert.deepEqual(ageingOf('2027-01-01', '2027-04-01'), { days: 90, bucket: '61-90' }); assert.deepEqual(ageingOf('2027-01-01', '2027-04-02'), { days: 91, bucket: '90+' }); assert.deepEqual(ageingOf(null, '2027-01-01'), { days: null, bucket: null });
});

test('FR-02 FR-03 BR-01 the EMD and the fee go through estimation, accounts and the CFO; the final bid needs the checklist, the security and the estimate (the director approves a difference)', async () => {
  const t = await setup();
  const tn = await ready(t, { emd: 2 * CR, tenderFee: 25_000 });
  // the EMD: the amount of the tender; a fee is not guaranteed; an exemption needs its reason
  assert.equal((await t.post(est1, `${B}/emd`, { tenderId: tn.id, kind: 'EMD', mode: 'BG', amount: 1 })).status, 400, 'the tender asks for 2 crore');
  assert.equal((await t.post(est1, `${B}/emd`, { tenderId: tn.id, kind: 'FEE', mode: 'BG' })).status, 400);
  assert.equal((await t.post(est1, `${B}/emd`, { tenderId: tn.id, kind: 'EMD', mode: 'EXEMPT' })).status, 400);
  assert.equal((await t.post(acc1, `${B}/emd`, { tenderId: tn.id, kind: 'EMD', mode: 'BG' })).status, 403, 'accounts records instruments, it does not ask for them');
  const c = (await t.post(est1, `${B}/emd`, { tenderId: tn.id, kind: 'EMD', mode: 'BG', payee: 'NHAI Pune', neededBy: ist(10) })).json.data; assert.equal(c.amount, 2 * CR); assert.match(c.docNo, /^EMD-/); assert.equal(c.refundStatus, 'NOT_DUE');
  assert.equal((await t.post(est1, `${B}/emd`, { tenderId: tn.id, kind: 'EMD', mode: 'DD' })).status, 409, 'one EMD for a tender');
  const s = (await t.post(est1, `${B}/emd/${c.id}/submit`, {})).json.data; assert.equal(s.status, 'SUBMITTED');
  assert.equal(await t.hasTask(est1, s.workflowInstanceId), false); assert.equal(await t.hasTask(acc1, s.workflowInstanceId), false, 'accounts comes second');
  await t.act(est2, s.workflowInstanceId); assert.equal(await t.hasTask(cfo1, s.workflowInstanceId), false, 'the CFO comes third'); await t.act(acc1, s.workflowInstanceId); await t.act(cfo1, s.workflowInstanceId);
  const ap = (await t.call(acc1, 'GET', `${B}/emd/${c.id}`)).json.data; assert.equal(ap.status, 'APPROVED'); assert.equal(ap.can.issue, true);
  const ev = events(t, 'bd.emd.requested'); assert.equal(ev.length, 1); assert.equal(ev[0].data.bankGuarantee, true); assert.equal(ev[0].data.amount, 2 * CR);
  assert.equal((await t.call(acc1, 'GET', `${B}/tenders/${tn.id}`)).status, 403, 'accounts sees the EMD, not the tender');
  assert.equal((await t.post(est1, `${B}/emd/${c.id}/issue`, { instrumentNo: 'BG1', bank: 'SBI', issueDate: ist(0), validUntil: ist(200) })).status, 403);
  assert.equal((await t.post(acc1, `${B}/emd/${c.id}/issue`, { instrumentNo: 'BG/SBI/2027/0091', bank: 'State Bank of India', issueDate: ist(0), validUntil: ist(5) })).status, 400, 'a guarantee runs at least to the opening');
  const iss = (await t.post(acc1, `${B}/emd/${c.id}/issue`, { instrumentNo: 'BG/SBI/2027/0091', bank: 'State Bank of India', issueDate: ist(0), validUntil: ist(200) })).json.data; assert.equal(iss.issued, true);
  assert.equal((await t.call(est1, 'GET', `${B}/emd/${c.id}`)).json.data.instrumentNo, 'BG/SBI/2027/0091', 'the maker sees the number');
  assert.equal((await t.call(cfo1, 'GET', `${B}/emd/${c.id}`)).json.data.instrumentNo, '••••0091', 'others see it masked');
  // the final bid: the checklist, the security (the fee is not yet paid) and the estimate
  const sub = (await t.post(est1, `${B}/submissions`, { tenderId: tn.id, estimate: 98 * CR, estimateRef: 'EST-0007' })).json.data; assert.equal(sub.items.length, 6); assert.equal(sub.estimateSource, 'MANUAL');
  assert.equal((await t.post(est1, `${B}/submissions`, { tenderId: tn.id })).status, 409);
  let x = await t.post(est1, `${B}/submissions/${sub.id}/submit`, {}); assert.equal(x.status, 400); assert.match(JSON.stringify(x.json), /checklist is not complete/); assert.match(JSON.stringify(x.json), /tender fee is not approved/); assert.match(JSON.stringify(x.json), /final bid amount/);
  assert.equal((await t.patch(est1, `${B}/submissions/${sub.id}`, { bidAmount: 96 * CR, version: sub.rowVersion })).status, 400, 'BR-01: a bid below the estimate needs a reason');
  let u = (await t.patch(est1, `${B}/submissions/${sub.id}`, { bidAmount: 96 * CR, adjustmentReason: 'Sharper price for steel agreed with the supplier', items: sub.items.map((i) => ({ code: i.code, done: true })), version: sub.rowVersion })).json.data;
  assert.equal(u.adjustment, -2 * CR); assert.equal(u.adjustmentPct, -2.04); assert.equal(u.complete, true);
  x = await t.post(est1, `${B}/submissions/${sub.id}/submit`, {}); assert.equal(x.status, 400); assert.match(JSON.stringify(x.json), /tender fee/);
  await security(t, tn, 'FEE', 'ONLINE');
  const sent = (await t.post(est1, `${B}/submissions/${sub.id}/submit`, {})).json.data; assert.equal(sent.status, 'SUBMITTED');
  assert.equal(await t.hasTask(dir1, sent.workflowInstanceId), false); await t.act(est2, sent.workflowInstanceId); await t.act(dir1, sent.workflowInstanceId);
  u = (await t.call(est1, 'GET', `${B}/submissions/${sub.id}`)).json.data; assert.equal(u.status, 'APPROVED'); assert.equal(events(t, 'bd.submission.approved')[0].data.adjustment, -2 * CR);
  assert.equal((await t.patch(est1, `${B}/submissions/${sub.id}`, { bidAmount: 1, version: u.rowVersion })).status, 409, 'an approved bid is locked');
  assert.equal((await t.post(est1, `${B}/submissions/${sub.id}/record`, { submittedAt: `${ist(40)}T11:30`, portalRef: 'ACK-1' })).status, 400, 'after the deadline');
  const rec = (await t.post(est1, `${B}/submissions/${sub.id}/record`, { submittedAt: `${ist(0)}T11:30`, portalRef: 'CPPP/ACK/2027/55102' })).json.data; assert.equal(rec.portalRef, 'CPPP/ACK/2027/55102'); assert.equal(rec.tenderStage, 'SUBMITTED');
  assert.equal(events(t, 'bd.tender.submitted').length, 1);
  assert.equal((await t.post(est1, `${B}/submissions/${sub.id}/record`, { submittedAt: `${ist(0)}T11:30`, portalRef: 'again' })).status, 422, 'once');
  // the register and its export
  const list = (await t.call(acc1, 'GET', `${B}/emd`)).json.data; assert.equal(list.length, 2); assert.equal((await t.api.raw('GET', `${B}/emd/export?format=csv`, acc1)).status, 200);
  assert.equal((await t.call(emp1, 'GET', `${B}/emd`)).status, 403); assert.equal((await t.call(as('ACCMGR', 'acc9', '2'), 'GET', `${B}/emd/${c.id}`)).status, 404);
});

test('FR-04 FR-05 FR-06 FR-07 the opening is ranked; the award is accepted by the director, wins the opportunity and tells project set-up; the loss closes it; the competitors are analysed; EMD refunds are followed up (BR-02)', async () => {
  const t = await setup();
  // an opportunity converted to a tender, then made ready and submitted
  const o = (await t.post(bd1, `${B}/opportunities`, { clientPartnerId: t.ids.nhai, name: 'Ring road package 9', sector: 'ROADS', region: 'WEST', estValue: 5 * CR })).json.data;
  const os = (await t.post(bd1, `${B}/opportunities/${o.id}/submit`, {})).json.data; await t.act(bd2, os.workflowInstanceId);
  const oc = (await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data; await t.post(bd1, `${B}/opportunities/${o.id}/convert`, { version: oc.rowVersion });
  const draft = t.api.db.prepare('SELECT * FROM tdr_tenders WHERE opportunity_id = ?').get(o.id);
  // business development made the draft; it completes and sends it; estimation registers it
  const dv = (await t.call(bd1, 'GET', `${B}/tenders/${draft.id}`)).json.data;
  await t.patch(bd1, `${B}/tenders/${draft.id}`, { referenceNo: 'NHAI/RR9', submissionAt: `${ist(20)}T15:00`, openingAt: `${ist(20)}T16:00`, prebidDate: ist(5), emd: 10_00_000, tenderFee: 5000, periodMonths: 18, version: dv.rowVersion });
  const ds = (await t.post(bd1, `${B}/tenders/${draft.id}/submit`, {})).json.data; await t.act(est1, ds.workflowInstanceId);
  let tn = (await t.call(est1, 'GET', `${B}/tenders/${draft.id}`)).json.data;
  await t.post(est1, `${B}/tenders/${tn.id}/track`, { bcTurnover: 40 * CR, bcCommitments: 10 * CR, version: tn.rowVersion });
  const d = (await t.post(est1, `${B}/bid-decisions`, { tenderId: tn.id, scores: scores(4), decision: 'BID' })).json.data; const dd = (await t.post(est1, `${B}/bid-decisions/${d.id}/submit`, {})).json.data; await t.act(est2, dd.workflowInstanceId); await t.act(dir1, dd.workflowInstanceId);
  tn = (await t.call(est1, 'GET', `${B}/tenders/${tn.id}`)).json.data; for (const e of tn.eligibility.rows.filter((r) => r.result !== 'PASS')) tn = (await t.patch(est1, `${B}/eligibility/${e.id}`, e.auto ? { requirement: 1 * CR, our: 2 * CR, version: e.rowVersion } : { result: 'PASS', version: e.rowVersion })).json.data;
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/ready`, {})).status, 200);
  const emdRec = await security(t, tn, 'EMD', 'DD'); await security(t, tn, 'FEE', 'ONLINE');
  // the credentials library and the package of the tender
  const cr = (await t.post(est1, `${B}/credentials`, { type: 'COMPLETION_CERTIFICATE', title: 'NH-48 widening, 42 km, completed', clientName: 'NHAI', sector: 'ROADS', value: 180 * CR, completionDate: '2025-03-31', tags: ['NH', 'road'] })).json.data; assert.match(cr.docNo, /^CRD-/);
  const old = (await t.post(est1, `${B}/credentials`, { type: 'FINANCIALS', title: 'Audited accounts 2019-20', validUntil: '2021-03-31' })).json.data;
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/credentials`, { credentialId: old.id })).status, 422, 'an expired credential is renewed first');
  const pk = await t.post(est1, `${B}/tenders/${tn.id}/credentials`, { credentialId: cr.id, purpose: 'Similar work' }); assert.equal(pk.status, 201); assert.equal(pk.json.data.length, 1);
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/credentials`, { credentialId: cr.id })).status, 409);
  assert.equal((await t.call(est1, 'GET', `${B}/credentials/${cr.id}`)).json.data.tenders.length, 1, 'the library knows where it was used');
  await submitted(t, tn, 98 * CR);
  // the opening: the server ranks; one line is ours
  assert.equal((await t.call(bd1, 'PUT', `${B}/tenders/${tn.id}/results`, { openedOn: ist(0), bidders: [{ name: 'Us', isUs: true, quoted: 98 * CR }] }, uid())).status, 403);
  assert.equal((await t.call(est1, 'PUT', `${B}/tenders/${tn.id}/results`, { openedOn: ist(0), bidders: [{ name: 'Rival', quoted: 95 * CR }] }, uid())).status, 400, 'our line is marked');
  const res = await t.call(est1, 'PUT', `${B}/tenders/${tn.id}/results`, { openedOn: ist(0), bidders: [{ name: 'Our company', isUs: true, quoted: 98 * CR }, { name: 'Rival Constructions Pvt Ltd', quoted: 95 * CR }, { name: 'Bharat Infra', quoted: 98 * CR }, { name: 'Shaky Builders', quoted: 90 * CR, qualified: false }, { name: 'Costly Corp', quoted: 105 * CR }] }, uid());
  assert.equal(res.status, 200, JSON.stringify(res.json)); const op = res.json.data;
  assert.equal(op.ourRank, 2); assert.equal(op.l1, 95 * CR); assert.equal(op.ourDiffPct, 3.16); assert.deepEqual(op.rows.map((r) => r.label), ['L1', 'L2', 'L2', 'L4', null]);
  assert.equal(events(t, 'bd.tender.opened')[0].data.ourRank, 2);
  // negotiation, then the award (the director accepts it)
  assert.equal((await t.post(est1, `${B}/tenders/${tn.id}/negotiations`, { heldOn: ist(0), ourOffer: 95 * CR, clientCounter: 94 * CR, notes: 'Client asked us to match L1 as the L1 bidder failed the site visit' })).status, 201);
  assert.equal((await t.post(est1, `${B}/awards`, { tenderId: tn.id, outcome: 'WON' })).status, 400, 'a win has its letter of acceptance');
  const aw = (await t.post(est1, `${B}/awards`, { tenderId: tn.id, outcome: 'WON', loaNo: 'NHAI/LOA/2027/88', loaDate: ist(-45), awardedValue: 94.5 * CR, submit: true })).json.data; assert.equal(aw.status, 'SUBMITTED'); assert.match(aw.docNo, /^AWD-/);
  assert.equal(await t.hasTask(dir1, aw.workflowInstanceId), false, 'the director comes after estimation'); await t.act(est2, aw.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `${B}/awards/${aw.id}`)).json.data.status, 'SUBMITTED'); await t.act(dir2, aw.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `${B}/awards/${aw.id}`)).json.data.status, 'APPROVED');
  assert.equal((await t.call(est1, 'GET', `${B}/tenders/${tn.id}`)).json.data.stage, 'AWARDED');
  const won = (await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data; assert.equal(won.stage, 'WON'); assert.equal(won.wonVia, 'TENDER_AWARD'); assert.equal(won.wonValue, 94.5 * CR);
  const ae = events(t, 'tdr.tender.awarded'); assert.equal(ae.length, 1); assert.equal(ae[0].data.loaNo, 'NHAI/LOA/2027/88'); assert.equal(ae[0].data.awardedValue, 94.5 * CR); assert.equal(ae[0].data.opportunityId, o.id);
  // the EMD is due back from the result; the fee never was
  const due = (await t.call(acc1, 'GET', `${B}/emd/${emdRec.id}`)).json.data; assert.equal(due.refundStatus, 'DUE'); assert.equal(due.ageDays, 45); assert.equal(due.ageBucket, '31-60');
  const fee = (await t.call(acc1, 'GET', `${B}/tenders/${tn.id}/emd`)); assert.equal(fee.status, 404, 'accounts reads the register, not the tender');
  const ag = (await t.call(acc1, 'GET', `${B}/emd/ageing`)).json.data; assert.equal(ag.buckets.find((b) => b.bucket === '31-60').count, 1); assert.equal(ag.due.amount, 10_00_000 / 1);
  // BR-02: followed up once when 30 days have passed (and again every 30 days)
  const svc = awardsOf(t.api.db); const n0 = t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'bd.tender.reminder' AND user_ref = 'acc1'").get().n;
  assert.ok(svc.cycle(1).followUps >= 2, 'the owner and accounts'); svc.cycle(1);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'bd.tender.reminder' AND user_ref = 'acc1'").get().n, n0 + 1, 'once in the same 30 days');
  svc.cycle(1, { today: ist(16) }); assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'bd.tender.reminder' AND user_ref = 'acc1'").get().n, n0 + 2, 'and again 30 days later');
  assert.equal((await t.post(acc1, `${B}/emd/${emdRec.id}/refund`, { action: 'REFUNDED' })).status, 400, 'the reference of the refund');
  assert.equal((await t.post(est1, `${B}/emd/${emdRec.id}/refund`, { action: 'REFUNDED', reference: 'DD returned' })).status, 403);
  const rf = (await t.post(acc1, `${B}/emd/${emdRec.id}/refund`, { action: 'REFUNDED', reference: 'DD 448812 returned by NHAI', date: ist(0) })).json.data; assert.equal(rf.refundStatus, 'REFUNDED'); assert.equal(rf.ageDays, null);
  // a second tender is lost to the same rival: the opportunity is lost with the reason
  const o2 = (await t.post(bd1, `${B}/opportunities`, { clientPartnerId: t.ids.nhai, name: 'Bypass package 2', sector: 'ROADS', region: 'WEST', estValue: 3 * CR })).json.data;
  const o2s = (await t.post(bd1, `${B}/opportunities/${o2.id}/submit`, {})).json.data; await t.act(bd2, o2s.workflowInstanceId);
  const tn2 = await ready(t, { emd: 0, tenderFee: 0, nameOfWork: 'Bypass package 2' });
  t.api.db.prepare('UPDATE tdr_tenders SET opportunity_id = ? WHERE id = ?').run(o2.id, tn2.id);
  await submitted(t, tn2, 50 * CR);
  await t.call(est1, 'PUT', `${B}/tenders/${tn2.id}/results`, { openedOn: ist(0), bidders: [{ name: 'Our company', isUs: true, quoted: 50 * CR }, { name: 'Rival Constructions Ltd', quoted: 48 * CR }] }, uid());
  const lo = (await t.post(est1, `${B}/awards`, { tenderId: tn2.id, outcome: 'LOST', lossReasonCode: 'PRICE', lossReason: 'L2 by 4 percent', submit: true })).json.data; assert.equal(lo.awardedTo, 'Rival Constructions Ltd', 'the L1 bidder');
  await t.act(est2, lo.workflowInstanceId);
  assert.equal((await t.call(est1, 'GET', `${B}/awards/${lo.id}`)).json.data.status, 'APPROVED', 'a loss needs no director');
  assert.equal((await t.call(est1, 'GET', `${B}/tenders/${tn2.id}`)).json.data.stage, 'LOST'); assert.equal((await t.call(bd1, 'GET', `${B}/opportunities/${o2.id}`)).json.data.stage, 'LOST'); assert.equal(events(t, 'tdr.tender.lost').length, 1);
  // the competitor analysis: one rival under two spellings, seen twice, L1 twice
  const an = (await t.call(bd1, 'GET', `${B}/competitor-reports`)).json.data;
  const rival = an.competitors.find((c) => c.name.startsWith('Rival')); assert.equal(rival.bids, 2); assert.equal(rival.l1, 2); assert.equal(rival.winRate, 100); assert.ok(rival.vsUsPct < 0, 'cheaper than us');
  assert.equal(an.bySector.find((s) => s.key === 'ROADS').tenders >= 1, true); assert.equal((await t.call(bd1, 'GET', `${B}/competitors/${rival.id}`)).json.data.bids.length, 2);
  assert.equal((await t.call(emp1, 'GET', `${B}/competitor-reports`)).status, 403);
  // roles: the commercial manager reads, cannot record; business development reads the award
  assert.equal((await t.call(com1, 'GET', `${B}/awards`)).status, 200); assert.equal((await t.post(com1, `${B}/awards`, { tenderId: tn.id, outcome: 'LOST', lossReasonCode: 'PRICE' })).status, 403);
  assert.equal((await t.call(bd1, 'GET', `${B}/awards/${aw.id}`)).status, 200);
  assert.equal((await t.call(est1, 'GET', `${B}/awards/${aw.id}/print`)).status, 200); assert.equal((await t.api.raw('GET', `${B}/awards/export?format=csv`, est1)).status, 200);
  assert.equal((await t.post(est1, `${B}/awards`, { tenderId: tn.id, outcome: 'LOST', lossReasonCode: 'PRICE' })).status, 422, 'an awarded tender has its result');
});
