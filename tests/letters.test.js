import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 11.05: correspondence register. T-01 a time-bar countdown alert fires before the deadline (7, 3 and 1 days), once at each step, and the bar lapses with an alert when the deadline passes without a notice (BR-02). Also: inward registration and numbering per
// project series, outward letters approved before they are numbered and put on letterhead (BR-01), a contractual notice approved by the commercial manager, issue by mode with the acknowledgement as proof, threads and response tracking with the overdue alert,
// links, confidential letters, search and tags, templates, roles, isolation and the flag.
const E = '/api/v1/engg';
const W = '/api/v1/workflow';
const C = '/api/v1/core';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `lt-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const doc = as('DOC', 'ldoc1'); const pm = as('PM', 'lpm1'); const pm2 = as('PM', 'lpm2'); const com = as('COMMGR', 'lcom1'); const se = as('SE', 'lse1'); const cm = as('CM', 'lcm1'); const bd = as('BD', 'lbd1'); const qs = as('QS', 'lqs1'); const pd = as('PD', 'lpd1');
const opened = []; const dirs = [];
after(async () => { for (const a of opened) await a.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function setup() {
  const storage = mkdtempSync(join(tmpdir(), 'erp-lt-')); dirs.push(storage);
  const api = await startApi({}, { storagePath: storage }); opened.push(api); await setupCompany(api);
  for (const [n, r] of [['ldoc1', ['DOC']], ['lpm1', ['PM']], ['lpm2', ['PM']], ['lcom1', ['COMMGR']], ['lse1', ['SE']], ['lcm1', ['CM']], ['lbd1', ['BD']], ['lqs1', ['QS']], ['lpd1', ['PD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'BUILDING').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'lpm1', 'test')").run(id); return id; };
  const a = mk('LTA', 'Alpha towers'); const b = mk('LTB', 'Beta bridge');
  const call = (who, method, path, body, k = key()) => api.call(method, `${E}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const jobs = runtimeOf(api.db).jobs;
  const attach = async (who, id) => { const fd = new FormData(); fd.append('entity', 'engg_letter'); fd.append('entityId', String(id)); fd.append('file', new Blob([PNG]), 'scan.png'); const r = await api.raw('POST', `${C}/files`, { ...who, body: fd }); assert.equal(r.status, 201, JSON.stringify(r.json)); await jobs.drain(); };
  return { api, call, act, hasTask, attach, a, b };
}
const inward = (t, over = {}) => ({ projectId: t.a, direction: 'IN', theirRef: 'CL/ENG/2026/041', letterDate: plus(-2), party: 'Mehta Associates (engineer)', subject: 'Instruction to change the pier 4 foundation level', category: 'INSTRUCTION', clauseRef: '13.1', responseDue: plus(5), assignedTo: 'lse1', tags: 'foundation, pier4', ...over });
const outward = (t, over = {}) => ({ projectId: t.a, direction: 'OUT', letterDate: plus(0), party: 'Mehta Associates (engineer)', subject: 'Re: instruction on the pier 4 foundation level', category: 'INSTRUCTION', clauseRef: '13.1', bodyText: 'Dear Sir,\n\nWe acknowledge your instruction and confirm it will be carried out.\n\nYours faithfully,', ...over });
const approvedOut = async (t, over = {}, approver = pm) => { const c = await t.call(doc, 'POST', '/letters', outward(t, over)); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await t.call(doc, 'POST', `/letters/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); await t.act(approver, s.json.data.workflowInstanceId); return (await t.call(doc, 'GET', `/letters/${c.json.data.id}`)).json.data; };

test('T-01 the time-bar countdown: alerts at 7, 3 and 1 days once each, a lapse alert, and the serving letter closes the bar', async () => {
  const t = await setup();
  assert.equal((await t.call(se, 'POST', '/time-bars', { projectId: t.a, description: 'Notice of claim for the delayed site handover', eventDate: plus(-23), limitDays: 28 })).status, 403);
  for (const bad of [{ limitDays: 0 }, { eventDate: plus(3) }, { description: 'x' }, { ownerUser: 'ghost' }, { triggerLetterId: 99999 }, { extra: 1 }]) assert.equal((await t.call(doc, 'POST', '/time-bars', { projectId: t.a, description: 'Notice of claim for the delayed site handover', clauseRef: '20.1', eventDate: plus(-23), limitDays: 28, ...bad })).status, 400, JSON.stringify(bad));
  const b = (await t.call(doc, 'POST', '/time-bars', { projectId: t.a, description: 'Notice of claim for the delayed site handover', clauseRef: '20.1', eventDate: plus(-23), limitDays: 28, claimRef: 'CLM-01', ownerUser: 'lse1' })).json.data;
  assert.deepEqual([b.barNo, b.deadline, b.daysLeft, b.status, b.urgency], ['TB-00001', plus(5), 5, 'OPEN', 'WARNING']);
  assert.equal((await t.call(se, 'POST', '/letters/alerts')).status, 403);
  const alerts = async () => (await t.call(pm, 'POST', '/letters/alerts')).json.data;
  const told = (u) => t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'engg.timebar.alert' AND user_ref = ?").get(u).n;
  const r1 = await alerts(); assert.deepEqual(r1.timeBarAlerts, [{ barNo: 'TB-00001', daysLeft: 5 }]); assert.deepEqual([told('lse1'), told('lpm1')], [1, 1], 'the owner and the project manager are told 5 days before the deadline');
  assert.deepEqual((await alerts()).timeBarAlerts, [], 'once at the 7-day step');
  const move = (days) => t.api.db.prepare('UPDATE engg_time_bars SET deadline = ? WHERE id = ?').run(plus(days), b.id);
  move(3); assert.equal((await alerts()).timeBarAlerts[0].daysLeft, 3); assert.deepEqual((await alerts()).timeBarAlerts, []); move(1); assert.equal((await alerts()).timeBarAlerts[0].daysLeft, 1); assert.equal(told('lse1'), 3, 'one alert at each step');
  assert.equal(JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'engg.timebar.alert' ORDER BY id DESC").get().payload).data.step, 1);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.timebar.opened'").get());
  // a second bar is served in time by an outward notice that names it
  const b2 = (await t.call(doc, 'POST', '/time-bars', { projectId: t.a, description: 'Notice of delay under the EOT clause', clauseRef: '8.4', eventDate: plus(-10), limitDays: 28, ownerUser: 'ldoc1' })).json.data;
  const n = await approvedOut(t, { category: 'NOTICE', contractual: true, clauseRef: '8.4', subject: 'Notice of delay', timeBarId: b2.id }, com);
  assert.equal(n.status, 'APPROVED'); const iss = await t.call(doc, 'POST', `/letters/${n.id}/issue`, { issueMode: 'COURIER', deliveryRef: 'DTDC 4491' }); assert.equal(iss.status, 200, JSON.stringify(iss.json));
  const sb = (await t.call(doc, 'GET', `/time-bars/${b2.id}`)).json.data; assert.deepEqual([sb.status, sb.servedOn, sb.servedLetterId], ['SERVED', plus(0), n.id]); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.timebar.served'").get());
  assert.equal((await alerts()).timeBarAlerts.length, 0, 'a served bar is not alerted');
  // the first bar lapses
  move(-1); const r4 = await alerts(); assert.deepEqual(r4.lapsed, ['TB-00001']); assert.equal((await t.call(doc, 'GET', `/time-bars/${b.id}`)).json.data.status, 'LAPSED'); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.timebar.lapsed'").get()); assert.equal(told('lse1'), 4, 'told that it lapsed');
  const list = (await t.call(pm, 'GET', `/time-bars?projectId=${t.a}`)).json.data; assert.deepEqual([list.counts.lapsed, list.counts.served, list.counts.open], [1, 1, 0]);
  // waive
  const b3 = (await t.call(doc, 'POST', '/time-bars', { projectId: t.a, description: 'Notice that was not needed after all', eventDate: plus(-1), limitDays: 28 })).json.data; assert.equal((await t.call(doc, 'POST', `/time-bars/${b3.id}/waive`, { reason: 'The client waived it in writing' })).status, 403); assert.equal((await t.call(pm, 'POST', `/time-bars/${b3.id}/waive`, { reason: 'The client waived it in writing' })).json.data.status, 'WAIVED');
});

test('FR-01 FR-02 BR-01 inward registration, the outward approval, numbering on approval, letterhead, issue and acknowledgement', async () => {
  const t = await setup();
  assert.equal((await t.call(bd, 'POST', '/letters', inward(t))).status, 403); assert.equal((await t.call(qs, 'POST', '/letters', inward(t))).status, 403);
  for (const bad of [{ category: 'GOSSIP' }, { subject: 'x' }, { party: 'x' }, { responseDue: plus(-9) }, { assignedTo: 'ghost' }, { parentLetterId: 99999 }, { documentId: 99999 }, { receivedOn: plus(3) }, { links: [{ entity: 'RFI', entityId: 99999, ref: 'RFI-1' }] }, { extra: 1 }]) assert.equal((await t.call(doc, 'POST', '/letters', inward(t, bad))).status, 400, JSON.stringify(bad));
  const i1 = (await t.call(doc, 'POST', '/letters', inward(t, { links: [{ entity: 'VARIATION', ref: 'VO-12' }, { entity: 'SITE_INSTRUCTION', ref: 'SI-5' }] }))).json.data;
  assert.deepEqual([i1.letterNo, i1.status, i1.direction, i1.responseStatus, i1.daysToReply, i1.links.length, i1.receivedOn], ['LTA/IN/0001', 'REGISTERED', 'IN', 'AWAITING', 5, 2, plus(0)]);
  const i2 = (await t.call(doc, 'POST', '/letters', inward(t, { theirRef: 'CL/ENG/2026/042', subject: 'Query on the rebar schedule' }))).json.data; assert.equal(i2.letterNo, 'LTA/IN/0002'); assert.equal((await t.call(doc, 'POST', '/letters', inward(t, { projectId: t.b }))).json.data.letterNo, 'LTB/IN/0001', 'each project has its own series');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.letter.registered'").get());
  // the outward letter
  const o = (await t.call(doc, 'POST', '/letters', outward(t, { parentLetterId: i1.id }))).json.data; assert.deepEqual([o.letterNo, o.status, o.onLetterhead], [null, 'DRAFT', false]);
  assert.match((await t.api.raw('GET', `${E}/letters/${o.id}/print`, doc)).buffer.toString(), /NOT ON LETTERHEAD/); assert.doesNotMatch((await t.api.raw('GET', `${E}/letters/${o.id}/print`, doc)).buffer.toString(), /Main Infra/);
  assert.equal((await t.call(doc, 'POST', '/letters', outward(t, { bodyText: 'short' }))).status, 201); const short = (await t.call(doc, 'POST', '/letters', outward(t, { bodyText: 'short' }))).json.data; assert.equal((await t.call(doc, 'POST', `/letters/${short.id}/submit`)).status, 422, 'the letter is written first');
  assert.equal((await t.call(se, 'POST', `/letters/${o.id}/submit`)).status, 403); const s = await t.call(doc, 'POST', `/letters/${o.id}/submit`); const wf = s.json.data.workflowInstanceId; assert.equal(s.json.data.status, 'SUBMITTED');
  assert.equal(await t.hasTask(doc, wf), false, 'the author does not approve'); assert.equal(await t.hasTask(pm, wf), true, 'the project manager approves an ordinary letter'); assert.equal(await t.hasTask(com, wf), false); assert.equal(await t.hasTask(pm2, wf), false);
  assert.equal((await t.call(doc, 'PATCH', `/letters/${o.id}`, { subject: 'Changed after sending' })).status, 409);
  await t.act(pm, wf, 'return'); assert.equal((await t.call(doc, 'GET', `/letters/${o.id}`)).json.data.status, 'RETURNED'); assert.equal((await t.call(doc, 'PATCH', `/letters/${o.id}`, { bodyText: 'Dear Sir,\n\nWe acknowledge your instruction and will carry it out as stated.\n\nYours faithfully,' })).status, 200);
  const s2 = await t.call(doc, 'POST', `/letters/${o.id}/submit`); assert.equal(s2.json.data.workflowInstanceId, wf); await t.act(pm, wf);
  const ap = (await t.call(doc, 'GET', `/letters/${o.id}`)).json.data; assert.deepEqual([ap.status, ap.letterNo, ap.onLetterhead], ['APPROVED', 'LTA/OUT/0001', true], 'numbered on approval');
  const pr = (await t.api.raw('GET', `${E}/letters/${o.id}/print`, doc)).buffer.toString(); assert.match(pr, /<h1>Main Company/); assert.match(pr, /LTA\/OUT\/0001/); assert.doesNotMatch(pr, /NOT ON LETTERHEAD/);
  // issue and acknowledgement
  assert.equal((await t.call(se, 'POST', `/letters/${o.id}/issue`, { issueMode: 'EMAIL' })).status, 403); assert.equal((await t.call(doc, 'POST', `/letters/${o.id}/issue`, { issueMode: 'FAX' })).status, 400); assert.equal((await t.call(doc, 'POST', `/letters/${o.id}/acknowledge`, { ackBy: 'Mehta' })).status, 422, 'issued first');
  const is = await t.call(doc, 'POST', `/letters/${o.id}/issue`, { issueMode: 'EMAIL', deliveryRef: 'msg-8812@example.com' }); assert.deepEqual([is.json.data.status, is.json.data.issueModeLabel, is.json.data.issuedOn], ['ISSUED', 'E-mail', plus(0)]); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.letter.issued'").get());
  assert.equal((await t.call(doc, 'PATCH', `/letters/${o.id}`, { subject: 'Changed after issue' })).status, 409); assert.equal((await t.call(doc, 'POST', `/letters/${o.id}/cancel`, { reason: 'Cancel an issued letter please' })).status, 422);
  await t.attach(doc, o.id); assert.equal((await t.call(doc, 'GET', `/letters/${o.id}`)).json.data.files.length, 1);
  const ak = await t.call(doc, 'POST', `/letters/${o.id}/acknowledge`, { ackBy: 'Mehta Associates, site office', ackNote: 'Signed copy received' }); assert.deepEqual([ak.json.data.status, ak.json.data.ackBy], ['ACKNOWLEDGED', 'Mehta Associates, site office']); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.letter.acknowledged'").get());
  // the reply answered the inward letter
  assert.equal((await t.call(doc, 'GET', `/letters/${i1.id}`)).json.data.responseStatus, 'ANSWERED'); assert.equal((await t.call(doc, 'GET', `/letters/${i2.id}`)).json.data.responseStatus, 'AWAITING');
  // amend: a corrigendum
  assert.equal((await t.call(se, 'POST', `/letters/${o.id}/amend`, { reason: 'Wrong level quoted' })).status, 403); const am = await t.call(doc, 'POST', `/letters/${o.id}/amend`, { reason: 'The foundation level quoted was wrong' }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.deepEqual([am.json.data.status, am.json.data.subject.startsWith('Corrigendum'), am.json.data.parentLetterId], ['DRAFT', true, o.id]);
  // close and reopen an inward letter
  assert.equal((await t.call(doc, 'POST', `/letters/${i2.id}/close`)).json.data.status, 'CLOSED'); assert.equal((await t.call(doc, 'POST', `/letters/${i2.id}/amend`, { reason: 'The client wrote again about it' })).json.data.status, 'REGISTERED');
});

test('BR-01 a contractual notice is approved by the commercial manager; reject and withdraw; a draft is cancelled', async () => {
  const t = await setup();
  const c = (await t.call(doc, 'POST', '/letters', outward(t, { category: 'NOTICE', contractual: true, clauseRef: '20.1', subject: 'Notice of claim', bodyText: 'Dear Sir,\n\nWe give notice of claim under clause 20.1 for the delay in handover.\n\nYours faithfully,' }))).json.data;
  const s = await t.call(doc, 'POST', `/letters/${c.id}/submit`); const wf = s.json.data.workflowInstanceId; assert.equal(await t.hasTask(com, wf), true, 'the commercial manager approves a contractual notice'); assert.equal(await t.hasTask(pm, wf), false);
  assert.equal((await t.call(pm, 'POST', `/letters/${c.id}/withdraw`, { reason: 'Not the sender of it' })).status, 403); assert.equal((await t.call(doc, 'POST', `/letters/${c.id}/withdraw`, { reason: 'One more check of the clause' })).json.data.status, 'DRAFT');
  const s2 = await t.call(doc, 'POST', `/letters/${c.id}/submit`); await t.act(com, s2.json.data.workflowInstanceId, 'reject'); assert.equal((await t.call(doc, 'GET', `/letters/${c.id}`)).json.data.status, 'REJECTED'); assert.equal((await t.call(doc, 'GET', `/letters/${c.id}`)).json.data.letterNo, null, 'a rejected letter takes no number');
  const d = (await t.call(doc, 'POST', '/letters', outward(t, { subject: 'To be cancelled' }))).json.data; assert.equal((await t.call(doc, 'POST', `/letters/${d.id}/cancel`, { reason: 'x' })).status, 400); assert.equal((await t.call(doc, 'POST', `/letters/${d.id}/cancel`, { reason: 'Superseded by a telephone call' })).json.data.status, 'CANCELLED');
  const e = (await t.call(doc, 'POST', '/letters', outward(t, { subject: 'To be deleted' }))).json.data; assert.equal((await t.call(doc, 'DELETE', `/letters/${e.id}`)).json.data.deleted, true); assert.equal((await t.call(doc, 'GET', `/letters/${e.id}`)).status, 404);
});

test('FR-03 FR-05 threads, the overdue reply alert, links, confidentiality, search, templates, import, export; isolation and the flag', async () => {
  const t = await setup();
  const i1 = (await t.call(doc, 'POST', '/letters', inward(t, { responseDue: plus(-3), letterDate: plus(-10), subject: 'Request to confirm the concrete grade' }))).json.data; assert.deepEqual([i1.overdue, i1.responseStatus, i1.daysToReply], [true, 'OVERDUE', -3]);
  assert.equal((await t.call(doc, 'GET', `/letters?filter[overdue]=1&filter[projectId]=${t.a}`)).json.data.length, 1);
  const al = await t.call(pm, 'POST', '/letters/alerts'); assert.deepEqual(al.json.data.replyOverdue, ['LTA/IN/0001']); assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'engg.letter.overdue' AND user_ref = 'lse1'").get().n, 1, 'the assignee is told'); assert.deepEqual((await t.call(pm, 'POST', '/letters/alerts')).json.data.replyOverdue, [], 'once');
  // a reply ends the overdue state, a thread links them
  const r1 = await approvedOut(t, { parentLetterId: i1.id, subject: 'Re: concrete grade' }); await t.call(doc, 'POST', `/letters/${r1.id}/issue`, { issueMode: 'HAND' });
  assert.deepEqual([(await t.call(doc, 'GET', `/letters/${i1.id}`)).json.data.overdue, (await t.call(doc, 'GET', `/letters/${i1.id}`)).json.data.responseStatus], [false, 'ANSWERED']);
  const i2 = (await t.call(doc, 'POST', '/letters', inward(t, { parentLetterId: r1.id, subject: 'Re: Re: concrete grade, thank you', responseDue: null }))).json.data;
  const th = (await t.call(se, 'GET', `/letters/${i2.id}/thread`)).json.data; assert.deepEqual(th.letters.map((x) => [x.direction, x.depth]), [['IN', 0], ['OUT', 1], ['IN', 2]]); assert.equal(th.rootId, i1.id);
  // links and the tags / search
  const dwg = await t.call(doc, 'POST', '/drawings', { projectId: t.a, drawingNo: 'LTA-STR-001', title: 'Layout', discipline: 'STRUCTURAL', links: [], revision: { label: 'A', statusCode: 'IFR', changeNote: 'First' } });
  const ln = await t.call(doc, 'POST', '/letters', inward(t, { subject: 'Comments on drawing LTA-STR-001', tags: 'drawing, comments', links: [{ entity: 'DRAWING', entityId: dwg.json.data.id, ref: 'LTA-STR-001' }, { entity: 'CLAIM', ref: 'CLM-01' }] })); assert.equal(ln.status, 201, JSON.stringify(ln.json)); assert.deepEqual(ln.json.data.links.map((l) => l.entityLabel), ['Drawing', 'Claim']);
  assert.equal((await t.call(doc, 'GET', '/letters?q=comments')).json.data.length, 1); assert.ok((await t.call(doc, 'GET', '/letters?q=pier4')).json.data.length >= 2, 'tags are searched'); assert.deepEqual((await t.call(doc, 'GET', `/letters/${ln.json.data.id}`)).json.data.tagList, ['drawing', 'comments']);
  // confidential
  assert.equal((await t.call(cm, 'POST', '/letters', inward(t, { confidentiality: 'CONFIDENTIAL' }))).status, 403, 'only those who see confidential letters register them');
  const cf = (await t.call(doc, 'POST', '/letters', inward(t, { subject: 'Without prejudice offer', confidentiality: 'CONFIDENTIAL' }))).json.data;
  assert.equal((await t.call(se, 'GET', `/letters/${cf.id}`)).status, 404); assert.equal((await t.call(pm, 'GET', `/letters/${cf.id}`)).status, 200); assert.equal((await t.call(se, 'GET', '/letters?q=prejudice')).json.data.length, 0); assert.equal((await t.call(pd, 'GET', '/letters?q=prejudice')).json.data.length, 1);
  assert.equal((await t.api.raw('GET', `${E}/letters/export?format=csv`, se)).status, 403); assert.doesNotMatch((await t.api.raw('GET', `${E}/letters/export?format=csv`, pm)).buffer.toString().replace(/Without prejudice offer/, 'X'), /nothing/); assert.match((await t.api.raw('GET', `${E}/letters/export?format=csv`, pm)).buffer.toString(), /LTA\/IN\/0001/);
  // templates
  const tp = (await t.call(doc, 'GET', '/letter-templates')).json.data; assert.ok(tp.length >= 5 && tp.some((x) => x.code === 'NOTICE_CLAIM'));
  const rd = (await t.call(doc, 'POST', '/letter-templates/render', { projectId: t.a, templateCode: 'REPLY_INSTRUCTION', parentLetterId: i1.id })).json.data; assert.match(rd.body, /CL\/ENG\/2026\/041/); assert.match(rd.body, /LTA Alpha towers/); assert.equal(rd.party, i1.party); assert.equal((await t.call(doc, 'POST', '/letter-templates/render', { projectId: t.a, templateCode: 'NOPE' })).status, 404);
  // import: a bad row is reported
  const imp = await t.call(doc, 'POST', '/letters/import', { projectId: t.a, rows: [{ theirRef: 'X/1', letterDate: plus(-1), party: 'Client office', subject: 'Imported letter one', category: 'QUERY' }, { theirRef: 'X/2', letterDate: plus(-1), party: 'Client office', subject: 'Bad row', category: 'QUERY', assignedTo: 'ghost' }] }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.deepEqual([imp.json.data.created, imp.json.data.errors[0].row], [1, 2]);
  // isolation, rights and the flag
  t.api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'OTH', 'Other Pvt Ltd', 'Other', 't', 'test')").run(); assert.equal((await t.api.call('GET', `${E}/letters/${i1.id}`, as('DOC', 'ldoc1', '2'))).status, 404);
  assert.equal((await t.call(bd, 'GET', '/letters')).status, 403); assert.equal((await t.call(qs, 'GET', '/letters')).status, 200); assert.equal((await t.call(se, 'POST', `/letters/${i1.id}/close`)).status, 403);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.engg.p1105'").run(); assert.equal((await t.call(doc, 'GET', '/letters')).status, 404, 'flag off'); assert.equal((await t.call(doc, 'GET', '/drawings')).status, 200); t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.engg.p1105'").run();
});
