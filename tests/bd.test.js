import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { crmOf } from '../src/server/modules/bd/crm.js';
import { setupCompany, startApi } from './helpers.js';

// Part 08.01: CRM, leads, clients, contacts, interactions and the opportunity pipeline. T-01 the weighted forecast equals the sum of value times probability for the filter. Also: the lead qualification (BANT-like score, reviewed by a colleague,
// never by its maker), the conversion to an opportunity, the go-ahead for tendering (a business development review, the director above ₹10 crore), the stages that need the go-ahead, the probability that follows the stage unless a reason is given (BR-02),
// a win only by a tender award or an approved direct award (BR-01), the conversion to a tender with its event, loss analysis, interactions with their follow-up tasks, the contacts with the influence map, Client 360, amendments and scope.
const B = '/api/v1/bd';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const bd1 = as('BD', 'bd1'); const bd2 = as('BD', 'bd2'); const bd3 = as('BD', 'bd3'); const dir1 = as('DIR', 'dir1'); const dir2 = as('DIR', 'dir2');
const est1 = as('EST', 'est1'); const com1 = as('COMMGR', 'com1'); const emp1 = as('EMP', 'emp1'); const sys1 = as('SYSADM', 'sys1');
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
  for (const [n, r] of [['bd1', ['BD']], ['bd2', ['BD']], ['bd3', ['BD']], ['dir1', ['DIR']], ['dir2', ['DIR']], ['est1', ['EST']], ['com1', ['COMMGR']], ['emp1', ['EMP']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, n, JSON.stringify(r), `${n}@example.com`);
  const partner = (code, name, role, status = 'ACTIVE', company = 1) => {
    const id = Number(api.db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'COMMGR', 't', 'test')").run(company, code, name, name.toLowerCase(), status).lastInsertRowid);
    api.db.prepare('INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, ?)').run(company, id, role);
    return id;
  };
  const ids = { nhai: partner('CL001', 'National Highways Authority', 'CLIENT'), pwd: partner('CL002', 'State PWD Maharashtra', 'CLIENT', 'PROSPECT'), vendor: partner('VN001', 'Steel Traders', 'VENDOR'), black: partner('CL003', 'Blacklisted Builders', 'CLIENT', 'BLACKLISTED'), other: partner('CL900', 'Other Company Client', 'CLIENT', 'ACTIVE', 2) };
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
const good = { rating: 'YES', note: 'confirmed' };
const lead = (t, o = {}) => ({ source: 'CLIENT_ENQUIRY', title: 'Bridge over the Godavari', clientPartnerId: t.ids.nhai, sector: 'BRIDGES', location: 'Nashik', region: 'WEST', estValue: 12 * CR, qualification: { budget: good, authority: good, need: good, timeline: { rating: 'PARTIAL', note: 'next financial year' } }, ...o });
const opp = (t, o = {}) => ({ clientPartnerId: t.ids.nhai, name: 'Ring road package 3', sector: 'ROADS', location: 'Pune', region: 'WEST', estValue: 2 * CR, ...o });
const events = (t, type) => t.api.db.prepare('SELECT payload FROM core_outbox WHERE event_type = ?').all(type).map((r) => JSON.parse(r.payload));

test('T-01 the weighted forecast equals the sum of value times probability for the filter, by month, sector, region and stage', async () => {
  const t = await setup();
  // value (rupees), sector, region, award date, stage, probability asked (with a reason when it is not the default of the stage)
  const rows = [
    [1_234_567.89, 'ROADS', 'WEST', '2027-01-15', 'IDENTIFIED', undefined], [8 * CR + 0.35, 'BRIDGES', 'WEST', '2027-01-28', 'QUALIFIED', undefined], [3 * CR, 'WATER', 'SOUTH', '2027-02-10', 'QUALIFIED', 30],
    [555_555.55, 'ROADS', 'NORTH', '2027-02-20', 'IDENTIFIED', 20], [4 * CR, 'BUILDING', 'WEST', '2027-03-05', 'QUALIFIED', undefined], [999_999.99, 'EPC', 'EAST', null, 'IDENTIFIED', undefined],
  ];
  const made = [];
  for (const [estValue, sector, region, expectedAwardDate, stage, probability] of rows) {
    const r = await t.post(bd1, `${B}/opportunities`, opp(t, { name: `P ${made.length}`, estValue, sector, region, expectedAwardDate, stage, ...(probability ? { probability, probabilityReason: 'Sole bidder so far' } : {}) }));
    assert.equal(r.status, 201, JSON.stringify(r.json)); made.push(r.json.data);
  }
  const prob = { IDENTIFIED: 5, QUALIFIED: 15 };
  const expected = rows.map(([v, s, r, d, st, p]) => ({ s, r, d, st, value: Math.round(v * 100), w: Math.round((Math.round(v * 100) * (p ?? prob[st])) / 100) }));
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const f = (await t.call(bd1, 'GET', `${B}/reports/forecast`)).json.data;
  assert.equal(Math.round(f.total.weighted * 100), sum(expected, 'w'), 'Σ value × probability for no filter'); assert.equal(Math.round(f.total.value * 100), sum(expected, 'value')); assert.equal(f.total.count, 6);
  assert.equal(Math.round(f.rows.reduce((a, r) => a + r.weighted * 100, 0)), sum(expected, 'w'), 'the months add up to the total');
  const west = (await t.call(bd1, 'GET', `${B}/reports/forecast?region=WEST&groupBy=sector`)).json.data;
  const w = expected.filter((x) => x.r === 'WEST'); assert.equal(Math.round(west.total.weighted * 100), sum(w, 'w')); assert.equal(west.rows.find((r) => r.key === 'BRIDGES').weighted, Math.round(w.find((x) => x.s === 'BRIDGES').w) / 100);
  const jan = (await t.call(bd1, 'GET', `${B}/reports/forecast?from=2027-01-01&to=2027-01-31&groupBy=month`)).json.data; const j = expected.filter((x) => x.d?.startsWith('2027-01'));
  assert.equal(Math.round(jan.total.weighted * 100), sum(j, 'w')); assert.deepEqual(jan.rows.map((r) => r.key), ['2027-01']);
  assert.equal((await t.call(bd1, 'GET', `${B}/reports/forecast?sector=ROADS&region=NORTH`)).json.data.total.weighted, Math.round(expected[3].w) / 100);
  // closed and cancelled opportunities are not in the forecast; a colleague's pipeline is not in mine
  await t.post(bd1, `${B}/opportunities/${made[0].id}/cancel`, { reason: 'Client dropped the package' });
  assert.equal(Math.round((await t.call(bd1, 'GET', `${B}/reports/forecast`)).json.data.total.weighted * 100), sum(expected, 'w') - expected[0].w);
  assert.equal((await t.call(bd2, 'GET', `${B}/reports/forecast`)).json.data.total.count, 0, 'bd2 sees no pipeline of bd1');
  assert.equal(Math.round((await t.call(est1, 'GET', `${B}/reports/forecast`)).json.data.total.weighted * 100), sum(expected, 'w') - expected[0].w, 'EST sees the whole pipeline');
  assert.equal((await t.call(emp1, 'GET', `${B}/reports/forecast`)).status, 403);
  assert.equal((await t.call(bd1, 'GET', `${B}/reports/forecast?groupBy=nonsense`)).status, 400);
});

test('FR-01 a lead is rated, reviewed by a colleague (never its maker) and converted to an opportunity; the client comes from the partner master', async () => {
  const t = await setup();
  assert.equal((await t.post(emp1, `${B}/leads`, lead(t))).status, 403);
  assert.equal((await t.post(bd1, `${B}/leads`, lead(t, { clientPartnerId: t.ids.vendor }))).status, 400, 'a vendor is not a client');
  assert.equal((await t.post(bd1, `${B}/leads`, lead(t, { clientPartnerId: t.ids.black }))).status, 400, 'a blacklisted client');
  assert.equal((await t.post(bd1, `${B}/leads`, lead(t, { clientPartnerId: t.ids.other }))).status, 400, 'a client of another company');
  assert.equal((await t.post(bd1, `${B}/leads`, lead(t, { clientPartnerId: null }))).status, 400, 'a client or a name');
  assert.equal((await t.post(bd1, `${B}/leads`, lead(t, { region: 'MARS' }))).status, 400);
  const l = (await t.post(bd1, `${B}/leads`, lead(t, { sourceRef: 'GEM-4471' }))).json.data;
  assert.equal(l.status, 'DRAFT'); assert.equal(l.qualScore, 83, '3+3+3+1 of 12'); assert.match(l.docNo, /^LEAD-/); assert.equal(l.estValue, 12 * CR);
  assert.equal((await t.post(bd1, `${B}/leads`, lead(t, { sourceRef: 'GEM-4471' }))).status, 409, 'the same tender portal reference twice');
  // too weak, or not rated: cannot be sent
  const weak = (await t.post(bd1, `${B}/leads`, lead(t, { title: 'Weak lead', qualification: { budget: { rating: 'NO' }, authority: { rating: 'NO' }, need: { rating: 'PARTIAL' }, timeline: { rating: 'NO' } } }))).json.data;
  assert.equal((await t.post(bd1, `${B}/leads/${weak.id}/submit`, {})).status, 400); assert.equal(weak.qualScore, 8);
  const unrated = (await t.post(bd1, `${B}/leads`, lead(t, { title: 'Unrated lead', qualification: { budget: good } }))).json.data;
  assert.equal((await t.post(bd1, `${B}/leads/${unrated.id}/submit`, {})).status, 400);
  // scope: a colleague does not see it; the managers do
  assert.equal((await t.call(bd2, 'GET', `${B}/leads/${l.id}`)).status, 404); assert.equal((await t.call(est1, 'GET', `${B}/leads/${l.id}`)).status, 200);
  assert.equal((await t.patch(bd2, `${B}/leads/${l.id}`, { title: 'Hijacked', version: l.rowVersion })).status, 404);
  assert.equal((await t.patch(est1, `${B}/leads/${l.id}`, { title: 'Hijacked', version: l.rowVersion })).status, 403);
  // an edit, then the review
  const edited = (await t.patch(bd1, `${B}/leads/${l.id}`, { contactName: 'R. Deshmukh', phone: '+91 98220 12345', version: l.rowVersion })).json.data;
  assert.equal((await t.patch(bd1, `${B}/leads/${l.id}`, { title: 'Stale', version: l.rowVersion })).status, 409);
  const s = (await t.post(bd1, `${B}/leads/${l.id}/submit`, {})).json.data;
  assert.equal(s.status, 'SUBMITTED'); assert.equal(edited.contactName, 'R. Deshmukh');
  assert.equal(await t.hasTask(bd1, s.workflowInstanceId), false, 'the maker never reviews');
  assert.equal((await t.patch(bd1, `${B}/leads/${l.id}`, { title: 'Locked', version: s.rowVersion })).status, 409, 'in review the lead is locked');
  assert.equal((await t.call(bd2, 'GET', `${B}/leads/${l.id}`)).status, 200, 'the reviewer can open what they review');
  assert.equal((await t.post(bd1, `${B}/leads/${l.id}/convert`, {})).status, 422, 'not qualified yet');
  // returned, corrected and sent again
  await t.act(bd2, s.workflowInstanceId, 'return');
  const back = (await t.call(bd1, 'GET', `${B}/leads/${l.id}`)).json.data; assert.equal(back.status, 'RETURNED');
  await t.patch(bd1, `${B}/leads/${l.id}`, { location: 'Nashik district', version: back.rowVersion });
  const again = (await t.post(bd1, `${B}/leads/${l.id}/submit`, { comment: 'Corrected' })).json.data; assert.equal(again.status, 'SUBMITTED');
  await t.act(bd2, again.workflowInstanceId);
  const q = (await t.call(bd1, 'GET', `${B}/leads/${l.id}`)).json.data; assert.equal(q.status, 'APPROVED'); assert.equal(q.statusLabel, 'Qualified');
  assert.equal((await t.patch(bd1, `${B}/leads/${l.id}`, { title: 'Quiet change', version: q.rowVersion })).status, 409, 'a qualified lead is amended, not edited');
  // amendment keeps the old version and needs the review again
  const am = await t.post(bd1, `${B}/leads/${l.id}/amend`, { estValue: 15 * CR, reason: 'The client enlarged the scope', version: q.rowVersion });
  assert.equal(am.status, 200, JSON.stringify(am.json)); assert.equal(am.json.data.status, 'DRAFT'); assert.equal(am.json.data.amendmentNo, 1); assert.equal(am.json.data.amendments[0].before.estValue, 12 * CR);
  const s2r = await t.post(bd1, `${B}/leads/${l.id}/submit`, {}); assert.equal(s2r.status, 202, JSON.stringify(s2r.json)); const s2 = s2r.json.data; await t.act(bd2, s2.workflowInstanceId);
  // converted: the client is carried over, the lead is marked, the opportunity is a draft at Qualified with its source
  const cv = await t.post(bd1, `${B}/leads/${l.id}/convert`, { expectedAwardDate: '2027-06-30' });
  assert.equal(cv.status, 201, JSON.stringify(cv.json)); const o = cv.json.data.opportunity;
  assert.equal(o.stage, 'QUALIFIED'); assert.equal(o.probability, 15); assert.equal(o.status, 'DRAFT'); assert.equal(o.estValue, 15 * CR); assert.equal(o.clientPartnerId, t.ids.nhai); assert.equal(o.leadId, l.id);
  assert.equal(cv.json.data.lead.status, 'CONVERTED'); assert.equal(cv.json.data.lead.opportunityId, o.id);
  assert.equal((await t.post(bd1, `${B}/leads/${l.id}/convert`, {})).status, 422, 'once');
  assert.equal(events(t, 'bd.lead.converted').length, 1);
  // a lead without a client in the master cannot become an opportunity until it has one
  const raw = (await t.post(bd1, `${B}/leads`, lead(t, { title: 'Prospect from the website', source: 'WEBSITE', clientPartnerId: null, clientName: 'Konkan Infra Ltd' }))).json.data;
  const rs = (await t.post(bd1, `${B}/leads/${raw.id}/submit`, {})).json.data; await t.act(bd2, rs.workflowInstanceId);
  const noClient = await t.post(bd1, `${B}/leads/${raw.id}/convert`, {}); assert.equal(noClient.status, 422); assert.match(noClient.json.error.message, /partner master/);
  // a lead cancelled; a draft deleted; the history
  const d = (await t.post(bd1, `${B}/leads`, lead(t, { title: 'To delete' }))).json.data; assert.equal((await t.call(bd1, 'DELETE', `${B}/leads/${d.id}`)).status, 200); assert.equal((await t.call(bd1, 'GET', `${B}/leads/${d.id}`)).status, 404);
  const h = (await t.call(bd1, 'GET', `${B}/leads/${l.id}/history`)).json.data; assert.ok(h.approvals.length >= 3); assert.ok(h.audit.some((a) => a.action === 'convert'));
  assert.equal((await t.call(bd1, 'GET', `${B}/leads/${l.id}/print`)).status, 200);
  assert.equal((await t.api.raw('GET', `${B}/leads/export?format=csv`, bd1)).status, 200);
  assert.equal((await t.api.raw('GET', `${B}/leads/export?format=csv`, est1)).status, 403, 'EST views but does not export');
});

test('FR-04 BR-01 BR-02 the go-ahead for tendering (the director above ₹10 crore), stages that need it, probabilities, direct award, conversion to a tender, loss', async () => {
  const t = await setup();
  const o = (await t.post(bd1, `${B}/opportunities`, opp(t, { name: 'Ganga bridge EPC', sector: 'BRIDGES', estValue: 14 * CR, expectedAwardDate: '2027-09-30', competitors: [{ name: 'L&T', strength: 'STRONG', incumbent: true }] }))).json.data;
  assert.equal(o.stage, 'IDENTIFIED'); assert.equal(o.probability, 5); assert.equal(o.status, 'DRAFT'); assert.equal(o.directorNeeded, true);
  // BR-02: the probability follows the stage; another one needs a reason
  const q = await t.post(bd1, `${B}/opportunities/${o.id}/track`, { stage: 'QUALIFIED', version: o.rowVersion });
  assert.equal(q.status, 200); assert.equal(q.json.data.probability, 15);
  const noWhy = await t.post(bd1, `${B}/opportunities/${o.id}/track`, { probability: 40, version: q.json.data.rowVersion }); assert.equal(noWhy.status, 400); assert.equal(noWhy.json.error.details?.[0]?.field ?? noWhy.json.error.fields?.[0]?.field, 'probabilityReason');
  const why = (await t.post(bd1, `${B}/opportunities/${o.id}/track`, { probability: 40, probabilityReason: 'The client asked us for a presentation', version: q.json.data.rowVersion })).json.data; assert.equal(why.probability, 40); assert.equal(why.probabilityDefault, 15);
  // a stage that pursues a tender needs the go-ahead; a win cannot be set by tracking
  const early = await t.post(bd1, `${B}/opportunities/${o.id}/track`, { stage: 'PRE_BID', version: why.rowVersion }); assert.equal(early.status, 422); assert.match(early.json.error.message, /go-ahead/);
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/track`, { stage: 'WON', version: why.rowVersion })).status, 400, 'BR-01: no win by tracking');
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/track`, { stage: 'LOST', version: why.rowVersion })).status, 400);
  // the go-ahead: business development review, then the director because the value is above ₹10 crore
  const sub = (await t.post(bd1, `${B}/opportunities/${o.id}/submit`, {})).json.data; assert.equal(sub.status, 'SUBMITTED');
  assert.equal(await t.hasTask(bd1, sub.workflowInstanceId), false); assert.equal(await t.hasTask(dir1, sub.workflowInstanceId), false, 'the director comes second');
  await t.act(bd2, sub.workflowInstanceId); assert.equal((await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data.status, 'SUBMITTED');
  await t.act(dir1, sub.workflowInstanceId);
  const ok = (await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data; assert.equal(ok.status, 'APPROVED'); assert.equal(events(t, 'bd.opportunity.approved').length, 1);
  assert.equal((await t.patch(bd1, `${B}/opportunities/${o.id}`, { estValue: 1, version: ok.rowVersion })).status, 409, 'the value is locked by the go-ahead');
  // the stages now; the pipeline keeps its log
  let cur = ok;
  for (const stage of ['PRE_BID', 'TENDER_EXPECTED', 'BID_SUBMITTED', 'NEGOTIATION']) { const r = await t.post(bd1, `${B}/opportunities/${o.id}/track`, { stage, version: cur.rowVersion }); assert.equal(r.status, 200, JSON.stringify(r.json)); cur = r.json.data; assert.equal(cur.probability, { PRE_BID: 25, TENDER_EXPECTED: 35, BID_SUBMITTED: 50, NEGOTIATION: 75 }[stage]); }
  assert.equal(cur.weighted, 14 * CR * 0.75);
  assert.deepEqual((await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data.stages.map((s) => s.toStage), ['IDENTIFIED', 'QUALIFIED', 'QUALIFIED', 'PRE_BID', 'TENDER_EXPECTED', 'BID_SUBMITTED', 'NEGOTIATION']);
  // the conversion to a tender: the event carries what 08.02 needs; once
  const cv = await t.post(bd1, `${B}/opportunities/${o.id}/convert`, { notes: 'Tender floated on the NHAI portal', version: cur.rowVersion }); assert.equal(cv.status, 200, JSON.stringify(cv.json)); assert.ok(cv.json.data.convertedAt);
  const ev = events(t, 'bd.opportunity.converted'); assert.equal(ev.length, 1); assert.equal(ev[0].data.opportunityId, o.id); assert.equal(ev[0].data.clientPartnerId, t.ids.nhai); assert.equal(ev[0].data.estValue, 14 * CR); assert.equal(ev[0].data.competitors[0].name, 'L&T');
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/convert`, {})).status, 422);
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/cancel`, { reason: 'Changed my mind' })).status, 422, 'a converted opportunity is not cancelled');
  // BR-01: a win by the director-approved direct award only
  const cur2 = (await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data;
  assert.equal((await t.post(est1, `${B}/opportunities/${o.id}/direct-award`, { reason: 'Nominated by the client', awardValue: 14 * CR, version: cur2.rowVersion })).status, 403);
  const da = await t.post(bd1, `${B}/opportunities/${o.id}/direct-award`, { reason: 'Nominated by the client under the emergency clause', awardValue: 13.5 * CR, version: cur2.rowVersion }); assert.equal(da.status, 202, JSON.stringify(da.json)); assert.equal(da.json.data.awardStatus, 'REQUESTED');
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/direct-award`, { reason: 'Again please', awardValue: 1, version: da.json.data.rowVersion })).status, 422);
  assert.equal(await t.hasTask(bd1, da.json.data.awardInstanceId), false); assert.equal(await t.hasTask(bd2, da.json.data.awardInstanceId), false, 'only the director decides a direct award');
  await t.act(dir2, da.json.data.awardInstanceId);
  const won = (await t.call(bd1, 'GET', `${B}/opportunities/${o.id}`)).json.data; assert.equal(won.stage, 'WON'); assert.equal(won.wonVia, 'DIRECT_AWARD'); assert.equal(won.wonValue, 13.5 * CR); assert.equal(won.probability, 100);
  const wev = events(t, 'bd.opportunity.won'); assert.equal(wev.length, 1); assert.equal(wev[0].data.via, 'DIRECT_AWARD');
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/track`, { stage: 'NEGOTIATION', version: won.rowVersion })).status, 422, 'closed');
  // the other way to a win: the tender award of 08.03 calls the service (there is no route to it)
  const o2 = (await t.post(bd1, `${B}/opportunities`, opp(t, { name: 'Kolhapur water supply', sector: 'WATER', estValue: 3 * CR }))).json.data;
  const s2 = (await t.post(bd1, `${B}/opportunities/${o2.id}/submit`, {})).json.data; await t.act(bd2, s2.workflowInstanceId);
  assert.equal((await t.call(bd1, 'GET', `${B}/opportunities/${o2.id}`)).json.data.status, 'APPROVED', 'below ₹10 crore the director is not needed');
  const sysActor = { user: 'system', userId: null, companyId: 1, roles: ['SYSADM'] };
  const a2 = crmOf(t.api.db).opportunities.awardFromTender(sysActor, o2.id, { tenderRef: 'TND-0007', awardValue: 2.9 * CR }); assert.equal(a2.stage, 'WON'); assert.equal(a2.won_via, 'TENDER_AWARD'); assert.equal(a2.tender_ref, 'TND-0007');
  assert.equal(events(t, 'bd.opportunity.won').length, 2);
  // loss: the reason is from the list, with who won
  const o3 = (await t.post(bd1, `${B}/opportunities`, opp(t, { name: 'Satara road', estValue: 5 * CR, sector: 'ROADS' }))).json.data;
  assert.equal((await t.post(bd1, `${B}/opportunities/${o3.id}/lose`, { reasonCode: 'ASTROLOGY', version: o3.rowVersion })).status, 400);
  const lost = await t.post(bd1, `${B}/opportunities/${o3.id}/lose`, { reasonCode: 'PRICE', reason: 'L1 was 6% lower', lostTo: 'Rival Constructions', version: o3.rowVersion }); assert.equal(lost.status, 200); assert.equal(lost.json.data.stage, 'LOST'); assert.equal(lost.json.data.probability, 0);
  const wl = (await t.call(bd1, 'GET', `${B}/reports/win-loss`)).json.data;
  assert.equal(wl.won.count, 2); assert.equal(wl.lost.count, 1); assert.equal(wl.winRate, 67); assert.equal(wl.won.value, 13.5 * CR + 2.9 * CR); assert.equal(wl.reasons[0].code, 'PRICE'); assert.equal(wl.lostTo[0].competitor, 'rival constructions');
  assert.equal((await t.call(bd1, 'GET', `${B}/reports/win-loss?from=2099-01-01`)).json.data.winRate, null, 'no closed opportunity in that period');
  const dash = (await t.call(bd1, 'GET', `${B}/reports/dashboard`)).json.data; assert.equal(dash.tiles.winRate, 67); assert.equal(dash.byStage.length, 6);
  // the amendment of an approved opportunity: back to the go-ahead
  const o4 = (await t.post(bd1, `${B}/opportunities`, opp(t, { name: 'Amend me', estValue: 2 * CR }))).json.data; const s4 = (await t.post(bd1, `${B}/opportunities/${o4.id}/submit`, {})).json.data; await t.act(bd2, s4.workflowInstanceId);
  const ap = (await t.call(bd1, 'GET', `${B}/opportunities/${o4.id}`)).json.data;
  const am = await t.post(bd1, `${B}/opportunities/${o4.id}/amend`, { estValue: 20 * CR, reason: 'Scope grew with the bypass', version: ap.rowVersion }); assert.equal(am.status, 200, JSON.stringify(am.json)); assert.equal(am.json.data.status, 'DRAFT'); assert.equal(am.json.data.directorNeeded, true); assert.equal(am.json.data.amendments[0].before.estValue, 2 * CR);
  // nobody but the maker works it; EST cannot track
  assert.equal((await t.post(est1, `${B}/opportunities/${o4.id}/track`, { stage: 'QUALIFIED', version: am.json.data.rowVersion })).status, 403);
  assert.equal((await t.post(bd3, `${B}/opportunities/${o4.id}/track`, { stage: 'QUALIFIED', version: am.json.data.rowVersion })).status, 404);
});

test('FR-03 interactions are logged against leads, opportunities and clients; a next action makes a task and a reminder', async () => {
  const t = await setup();
  const l = (await t.post(bd1, `${B}/leads`, lead(t))).json.data; const o = (await t.post(bd1, `${B}/opportunities`, opp(t))).json.data;
  const log = (who, b) => t.post(who, `${B}/interactions`, { type: 'MEETING', date: ist(-1), notes: 'Met the chief engineer at the site office', participants: ['R. Deshmukh'], ...b });
  assert.equal((await log(est1, { entity: 'LEAD', entityId: l.id })).status, 403, 'EST reads, does not log');
  assert.equal((await log(bd2, { entity: 'LEAD', entityId: l.id })).status, 404, 'a colleague has no access to the lead');
  assert.equal((await log(bd1, { entity: 'LEAD', entityId: l.id, date: ist(3) })).status, 400, 'not in the future');
  assert.equal((await log(bd1, { entity: 'LEAD', entityId: l.id, nextAction: 'Send the profile' })).status, 400, 'a next action has a date');
  const i1 = await log(bd1, { entity: 'LEAD', entityId: l.id, nextAction: 'Send the company profile and credentials', nextActionDate: ist(0) }); assert.equal(i1.status, 201, JSON.stringify(i1.json)); assert.ok(i1.json.data.taskId, 'a reminder task was made');
  const task = t.api.db.prepare('SELECT * FROM tsk_tasks WHERE id = ?').get(i1.json.data.taskId); assert.match(task.title, /Send the company profile/); assert.equal(task.due_date, ist(0));
  assert.equal(i1.json.data.clientPartnerId, t.ids.nhai);
  const mine = (await t.call(bd1, 'GET', `${B}/interactions/mine`)).json.data; assert.equal(mine.length, 1); assert.equal(mine[0].overdue, false);
  // the daily reminder tells the owner once
  assert.equal(crmOf(t.api.db).cycle(1).reminded, 1); crmOf(t.api.db).cycle(1);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'bd.followup'").get().n, 1, 'once, however often the job runs');
  // a call on the opportunity; the opportunity shows the interactions of its lead
  const conv = await (async () => { const s = (await t.post(bd1, `${B}/leads/${l.id}/submit`, {})).json.data; await t.act(bd2, s.workflowInstanceId); return (await t.post(bd1, `${B}/leads/${l.id}/convert`, {})).json.data.opportunity; })();
  await log(bd1, { entity: 'OPPORTUNITY', entityId: conv.id, type: 'CALL', notes: 'Called the tender cell about the date' });
  const list = (await t.call(bd1, 'GET', `${B}/interactions?entity=OPPORTUNITY&entityId=${conv.id}`)).json.data; assert.equal(list.rows.length, 2); assert.equal(list.rows.filter((x) => x.fromLead).length, 1);
  assert.equal((await t.call(bd1, 'GET', `${B}/interactions?entity=OPPORTUNITY&entityId=${o.id}`)).json.data.rows.length, 0);
  // done; a note on the client; the client's log shows the interactions of its leads and opportunities
  assert.equal((await t.post(bd2, `${B}/interactions/${i1.json.data.id}/done`, {})).status, 403, 'bd2 reviewed the lead and can read it, but the next action is not theirs');
  const done = (await t.post(bd1, `${B}/interactions/${i1.json.data.id}/done`, {})).json.data; assert.equal(done.nextDone, true); assert.equal((await t.call(bd1, 'GET', `${B}/interactions/mine`)).json.data.length, 0);
  await log(bd2, { entity: 'CLIENT', entityId: t.ids.nhai, type: 'NOTE', notes: 'Annual review meeting scheduled for April' });
  const c360 = (await t.call(bd1, 'GET', `${B}/clients/${t.ids.nhai}`)).json.data; assert.ok(c360.interactions.length >= 3, 'the client log has the lead, the opportunity and the client entries'); assert.equal(c360.interactions.some((x) => x.createdBy === 'bd2'), true);
  const ev = events(t, 'bd.interaction.logged'); assert.ok(ev.length >= 3);
  // an interaction can be removed by the person who logged it only
  assert.equal((await t.call(bd2, 'DELETE', `${B}/interactions/${i1.json.data.id}`)).status, 403); assert.equal((await t.call(bd1, 'DELETE', `${B}/interactions/${i1.json.data.id}`)).status, 200);
});

test('FR-02 clients come from the partner master; contacts carry an influence map; Client 360 shows only what the person may see', async () => {
  const t = await setup();
  const o1 = (await t.post(bd1, `${B}/opportunities`, opp(t, { name: 'Mine for NHAI', estValue: 4 * CR }))).json.data; await t.post(bd2, `${B}/opportunities`, opp(t, { name: 'Bd2 for NHAI', estValue: 6 * CR }));
  const lk = (await t.call(bd1, 'GET', `${B}/lookups/clients?q=Nat`)).json.data; assert.deepEqual(lk.map((r) => r.code), ['CL001']);
  assert.deepEqual((await t.call(bd1, 'GET', `${B}/lookups/clients`)).json.data.map((r) => r.code).sort(), ['CL001', 'CL002'], 'clients and prospects only, not vendors, the blacklisted or another company');
  assert.equal((await t.call(emp1, 'GET', `${B}/lookups/clients`)).status, 403);
  const list = (await t.call(bd1, 'GET', `${B}/clients`)).json; const nh = list.data.find((r) => r.code === 'CL001'); assert.equal(nh.open, 1, 'bd1 counts only their own pipeline'); assert.equal(nh.pipeline, 4 * CR);
  assert.equal((await t.call(est1, 'GET', `${B}/clients`)).json.data.find((r) => r.code === 'CL001').pipeline, 10 * CR, 'EST sees both');
  // contacts: only a client can have them; the map warns
  assert.equal((await t.post(bd1, `${B}/clients/${t.ids.vendor}/contacts`, { name: 'Somebody' })).status, 400);
  assert.equal((await t.post(est1, `${B}/clients/${t.ids.nhai}/contacts`, { name: 'Somebody' })).status, 403, 'EST views the map, bd keeps it');
  const eng = (await t.post(bd1, `${B}/clients/${t.ids.nhai}/contacts`, { name: 'R. Deshmukh', designation: 'Chief Engineer', mobile: '9822012345', influenceRole: 'TECHNICAL', influenceLevel: 4, stance: 'SUPPORTER' })).json.data;
  const gk = (await t.post(bd1, `${B}/clients/${t.ids.nhai}/contacts`, { name: 'P. Kulkarni', designation: 'PA to the Member', influenceRole: 'GATEKEEPER', influenceLevel: 2, stance: 'BLOCKER', reportsToId: eng.id })).json.data;
  let m = (await t.call(est1, 'GET', `${B}/clients/${t.ids.nhai}/contacts`)).json.data; assert.equal(m.rows.length, 2); assert.equal(m.canManage, false);
  assert.ok(m.map.warnings.includes('No decision maker is known')); assert.ok(m.map.warnings.includes('A blocker is on the map')); assert.equal(m.map.byStance.BLOCKER, 1);
  const dm = (await t.post(bd1, `${B}/clients/${t.ids.nhai}/contacts`, { name: 'S. Rao', designation: 'Member (Projects)', influenceRole: 'DECISION_MAKER', influenceLevel: 5, stance: 'NEUTRAL' })).json.data;
  m = (await t.call(bd1, 'GET', `${B}/clients/${t.ids.nhai}/contacts`)).json.data; assert.equal(m.rows[0].name, 'S. Rao', 'the most influential first'); assert.ok(m.map.warnings.includes('A decision maker is not yet a supporter'));
  const up = await t.patch(bd1, `${B}/contacts/${dm.id}`, { stance: 'CHAMPION', version: dm.rowVersion }); assert.equal(up.status, 200); assert.equal(up.json.data.stance, 'CHAMPION');
  assert.equal((await t.patch(bd1, `${B}/contacts/${dm.id}`, { stance: 'NEUTRAL', version: dm.rowVersion })).status, 409);
  assert.equal((await t.patch(bd1, `${B}/contacts/${eng.id}`, { reportsToId: gk.id, version: eng.rowVersion })).status, 400, 'a reporting loop');
  assert.equal((await t.patch(bd1, `${B}/contacts/${gk.id}`, { reportsToId: 99999, version: gk.rowVersion })).status, 400);
  // Client 360
  const c = (await t.call(bd1, 'GET', `${B}/clients/${t.ids.nhai}`)).json.data;
  assert.equal(c.legalName, 'National Highways Authority'); assert.equal(c.opportunities.length, 1); assert.equal(c.opportunities[0].id, o1.id); assert.equal(c.stats.open, 1); assert.equal(c.contacts.length, 3); assert.deepEqual(c.later.map((x) => x.part), ['08.02', '10.01', '23.x']);
  assert.equal((await t.call(bd1, 'GET', `${B}/clients/${t.ids.vendor}`)).status, 404, 'a vendor is not a client'); assert.equal((await t.call(bd1, 'GET', `${B}/clients/${t.ids.other}`)).status, 404, 'nor is another company');
  assert.equal((await t.call(bd1, 'DELETE', `${B}/contacts/${gk.id}`)).status, 200);
  assert.equal((await t.call(bd1, 'GET', `${B}/clients/${t.ids.nhai}/contacts`)).json.data.rows.length, 2);
});

test('AC-03 AC-04 roles and scope: each role sees and does what is specified; nothing bypasses the chain; other companies see nothing', async () => {
  const t = await setup();
  const l = (await t.post(bd1, `${B}/leads`, lead(t))).json.data; const o = (await t.post(bd1, `${B}/opportunities`, opp(t))).json.data;
  const can = async (who, method, path, body) => (await t.call(who, method, path, body, method === 'GET' ? undefined : uid())).status;
  // view: BD (own), EST, COMMGR, DIR (all); not an employee, not the system administrator without the right
  for (const [who, expect] of [[bd1, 200], [bd2, 404], [est1, 200], [com1, 200], [dir1, 200], [emp1, 403]]) { assert.equal(await can(who, 'GET', `${B}/leads/${l.id}`), expect, `${who.user} reads the lead`); assert.equal(await can(who, 'GET', `${B}/opportunities/${o.id}`), expect, `${who.user} reads the opportunity`); }
  assert.equal(await can(emp1, 'GET', `${B}/leads`), 403); assert.equal((await t.call(bd2, 'GET', `${B}/leads`)).json.data.length, 0); assert.equal((await t.call(dir1, 'GET', `${B}/leads`)).json.data.length, 1);
  // EST and COMMGR read only
  for (const who of [est1, com1]) { assert.equal(await can(who, 'POST', `${B}/leads`, lead(t)), 403); assert.equal(await can(who, 'POST', `${B}/opportunities`, opp(t)), 403); assert.equal((await t.call(who, 'GET', `${B}/reports/forecast`)).status, 200); assert.equal((await t.call(who, 'GET', `${B}/reports/board`)).status, 200); }
  // the director has the whole module
  assert.equal((await t.post(dir1, `${B}/leads`, lead(t, { title: 'Director lead' }))).status, 201);
  // another company sees nothing
  const other = as('DIR', 'dir9', '2'); t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'dir9', 'dir9', '[\"DIR\"]', 'd9@example.com')").run();
  assert.equal(await can(other, 'GET', `${B}/leads/${l.id}`), 404); assert.equal(await can(other, 'GET', `${B}/opportunities/${o.id}`), 404); assert.equal((await t.call(other, 'GET', `${B}/opportunities`)).json.data.length, 0);
  assert.equal(await can(other, 'POST', `${B}/opportunities`, opp(t)), 400, 'the client of company 1 is not a client of company 2');
  // no bypass: an opportunity at the go-ahead stage cannot be moved to a tender stage by any route; an import never approves
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/track`, { stage: 'BID_SUBMITTED', version: o.rowVersion })).status, 422);
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/convert`, {})).status, 422, 'no conversion without the go-ahead');
  assert.equal((await t.post(bd1, `${B}/opportunities`, opp(t, { stage: 'PRE_BID' }))).status, 400, 'a new opportunity cannot start at a tender stage');
  assert.equal((await t.post(bd1, `${B}/opportunities`, opp(t, { stage: 'WON' }))).status, 400);
  const s = (await t.post(bd1, `${B}/opportunities/${o.id}/submit`, {})).json.data;
  assert.equal((await t.post(bd1, `${B}/opportunities/${o.id}/submit`, {})).status, 409, 'not twice');
  assert.equal((await t.call(bd1, 'POST', `${W}/tasks/1/act`, { action: 'approve' }, uid())).status >= 400, true);
  const wd = await t.post(bd1, `${B}/opportunities/${o.id}/withdraw`, { reason: 'Need to add competitors first' }); assert.equal(wd.status, 200, JSON.stringify(wd.json)); assert.equal(wd.json.data.status, 'DRAFT'); assert.equal(s.status, 'SUBMITTED');
  // an idempotent replay returns the same record; a missing key is refused
  const key = uid('k'); const a = await t.call(bd1, 'POST', `${B}/leads`, lead(t, { title: 'Replay lead' }), key); const b = await t.call(bd1, 'POST', `${B}/leads`, lead(t, { title: 'Replay lead' }), key);
  assert.equal(a.json.data.id, b.json.data.id); assert.equal((await t.call(bd1, 'POST', `${B}/leads`, lead(t, { title: 'No key' }))).status, 400);
  // the board lists the stages; a closed one shows only recent; the module's audit trail names the actions
  const bo = (await t.call(bd1, 'GET', `${B}/reports/board`)).json.data; assert.deepEqual(bo.columns.map((c) => c.stage), ['IDENTIFIED', 'QUALIFIED', 'PRE_BID', 'TENDER_EXPECTED', 'BID_SUBMITTED', 'NEGOTIATION', 'WON', 'LOST']); assert.equal(bo.columns[0].count, 1); assert.equal(bo.canMove, true);
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity IN ('bd_leads', 'bd_opportunities')").get().n >= 6);
  assert.equal((await t.call(sys1, 'GET', `${B}/leads`)).status, 403, 'the system administrator configures, and does not read the pipeline');
});
