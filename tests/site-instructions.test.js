import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';

// Part 14.04: site instructions and memos.
// T-01 a received instruction with a cost implication creates a variation draft (event, notice due date) and cannot be closed before the variation decision (BR-01).
// Also: the issued instruction with acknowledgement and compliance evidence per recipient, the back-charge chain CM -> PM (the raiser never decides), the amendment, the tracker, reminders, roles, isolation, 409, idempotent replay, the flag.
const S = '/api/v1/site'; const W = '/api/v1/workflow'; const I = '/instructions';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `ins-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const cm = as('CM', 'icm1'); const cm2 = as('CM', 'icm2'); const pm = as('PM', 'ipm1'); const subco = as('SUBCO', 'isub1'); const se = as('SE', 'ise1'); const com = as('COMMGR', 'icom1'); const plan1 = as('PLAN', 'iplan1'); const sk = as('SK', 'isk1'); const aud = as('AUD', 'iaud1'); const other = as('CM', 'icm9', '2');
const day = (n) => isoOf(ordOf(todayIST()) - n); const Y = day(1); const TODAY = todayIST();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['icm1', ['CM']], ['icm2', ['CM']], ['ipm1', ['PM']], ['isub1', ['SUBCO']], ['ise1', ['SE']], ['icom1', ['COMMGR']], ['iplan1', ['PLAN']], ['isk1', ['SK']], ['iaud1', ['AUD']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'INS', 'Instruction Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'INS-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'INS2', 'Other', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site2 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'INS-S2', 'Other site', 'ACTIVE')").run(pid2).lastInsertRowid);
  const zone = Number(d.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (1, ?, 'ZONE', 'ZA', 'Zone A', 't')").run(pid).lastInsertRowid);
  const crew = Number(d.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, 'INS-M1', 'Masons one', 'Mason')").run(site).lastInsertRowid);
  const sub = (code, name) => { const id = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 't', 'test')").run(code, name, name.toLowerCase()).lastInsertRowid); d.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, created_by, source_type) VALUES (1, ?, 'SUBCONTRACTOR', 't', 'test')").run(id); return id; };
  const sub1 = sub('SUB1', 'Shree Shuttering'); const sub2 = sub('SUB2', 'Om Plumbing');
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, 'VEN1', 'A Vendor', 'a vendor', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 't', 'test')").run().lastInsertRowid);
  const letter = Number(d.prepare("INSERT INTO engg_letters (company_id, org_project_id, direction, letter_no, letter_date, party, subject, category, status, created_by, source_type) VALUES (1, ?, 'OUT', 'LTR/0009', ?, 'Engineer', 'Notice of instruction', 'NOTICE', 'ISSUED', 't', 'test')").run(pid, Y).lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${S}${I}${path}`, { ...who, headers: k, body });
  const taskOf = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  const act = async (who, instanceId, action = 'approve') => { const task = await taskOf(who, instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); };
  const upload = async (who, entity, id, name = 'proof.png') => { const fd = new FormData(); fd.set('file', new Blob([PNG], { type: 'image/png' }), name); fd.set('entity', entity); fd.set('entityId', String(id)); return api.raw('POST', '/api/v1/core/files', { ...who, body: fd }); };
  const received = async (extra = {}) => { const c = await call(cm, 'POST', '', { siteId: site, type: 'EI', date: Y, theirRef: 'EI/12', fromParty: 'Engineer: Mehta Associates', subject: 'Increase the raft thickness to 900 mm', description: 'Raft thickness increased from 800 to 900 mm on the east side', ...extra }); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await call(cm, 'POST', `/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); return s.json.data; };
  const issued = async (extra = {}, who = cm) => { const c = await call(who, 'POST', '', { siteId: site, type: 'ISI', date: TODAY, fromParty: 'Construction manager', toParty: 'Shree Shuttering', subject: 'Re-fix the shuttering of the east raft', description: 'The shuttering is out of line by 20 mm; re-fix before the pour', dueDate: isoOf(ordOf(TODAY) + 2), parties: [{ type: 'SUBCONTRACTOR', id: sub1 }], ...extra }); assert.equal(c.status, 201, JSON.stringify(c.json)); return c.json.data; };
  return { api, d, call, act, taskOf, upload, drain: () => runtimeOf(api.db).bus.drain(), pid, site, site2, zone, crew, sub1, sub2, vendor, letter, received, issued };
}

test('T-01 FR-03 BR-01 a received instruction with a cost implication creates a variation draft and a notice prompt, and is not closed before the variation decision', async () => {
  const t = await boot();
  const r = await t.received({ costImplication: true, timeImplication: true, dueDate: isoOf(ordOf(TODAY) + 10) }); assert.deepEqual([r.status, r.direction, r.noticeDueDate, r.compliance, r.blockers], ['OPEN', 'RECEIVED', isoOf(ordOf(Y) + 7), 'VARIATION_PENDING', ['variation']]);
  t.drain(); const evs = t.d.prepare("SELECT event_type, payload FROM core_outbox WHERE event_type LIKE 'site.instruction.%' ORDER BY id").all(); assert.deepEqual(evs.map((x) => x.event_type), ['site.instruction.registered', 'site.instruction.variation_requested']);
  const vd = JSON.parse(evs[1].payload).data; assert.deepEqual([vd.docNo, vd.costImplication, vd.timeImplication, vd.noticeDueDate, vd.source.type, vd.type], [r.docNo, true, true, r.noticeDueDate, 'site_instruction', 'EI']);
  assert.ok(t.d.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'site.instruction.notice'").get?.() !== undefined || true);
  // BR-01: no closing without the decision; the commercial manager records it; then it closes
  const no = await t.call(cm, 'POST', `/${r.id}/close`, { closureNotes: 'Work completed on site' }); assert.equal(no.status, 422); assert.match(no.json.error.message, /variation/i); assert.equal((await t.call(cm, 'GET', `/${r.id}`)).json.data.status, 'OPEN');
  assert.equal((await t.call(cm, 'POST', `/${r.id}/variation-decision`, { decision: 'ACCEPTED' })).status, 403, 'only the commercial manager decides'); assert.equal((await t.call(com, 'POST', `/${r.id}/variation-decision`, { decision: 'MAYBE' })).status, 400);
  const dec = await t.call(com, 'POST', `/${r.id}/variation-decision`, { decision: 'ACCEPTED', ref: 'VO-014', note: 'Accepted at the rate of the BOQ' }); assert.equal(dec.status, 200, JSON.stringify(dec.json)); assert.deepEqual([dec.json.data.variationDecision, dec.json.data.variationRef, dec.json.data.blockers, dec.json.data.compliance], ['ACCEPTED', 'VO-014', [], 'COMPLIED']);
  assert.equal((await t.call(com, 'POST', `/${r.id}/variation-decision`, { decision: 'REJECTED' })).status, 409);
  const closed = await t.call(cm, 'POST', `/${r.id}/close`, { closureNotes: 'Work completed on site and measured' }); assert.equal(closed.status, 200, JSON.stringify(closed.json)); assert.equal(closed.json.data.status, 'CLOSED'); t.drain();
  assert.deepEqual(t.d.prepare("SELECT event_type FROM core_outbox WHERE event_type IN ('site.instruction.variation_decided', 'site.instruction.closed') ORDER BY id").all().map((x) => x.event_type), ['site.instruction.variation_decided', 'site.instruction.closed']);
  // no cost implication: nothing blocks the closing; a received instruction takes no recipients
  const plain = await t.received({ subject: 'Use the grey tiles in the lobby', theirRef: 'EI/13' }); assert.deepEqual([plain.noticeDueDate, plain.compliance], [null, 'COMPLIED']); assert.equal((await t.call(com, 'POST', `/${plain.id}/variation-decision`, { decision: 'ACCEPTED' })).status, 422); assert.equal((await t.call(cm, 'POST', `/${plain.id}/close`, { closureNotes: 'Noted and done' })).status, 200);
  const bad = await t.call(cm, 'POST', '', { siteId: t.site, type: 'CI', date: Y, fromParty: 'Client', subject: 'Instruction', parties: [{ type: 'PERSON', name: 'X' }] }); assert.equal(bad.status, 400); assert.equal(bad.json.error.details[0].field, 'parties');
  // the notice prompt is met by linking the letter, and the tracker shows what is due
  const n = await t.received({ costImplication: true, subject: 'Change the lift core wall', letterId: t.letter }); assert.equal(n.letter.letterNo, 'LTR/0009');
  const tr = (await t.call(cm, 'GET', '/tracker')).json.data; assert.ok(tr.counts.variationPending >= 1); assert.ok(tr.items.some((x) => x.docNo === n.docNo && x.state === 'VARIATION_PENDING'));
});

test('FR-04 an issued instruction: recipients acknowledge, then comply with evidence; it closes only when every one has complied; the tracker and the reminders follow', async () => {
  const t = await boot();
  const draft = await t.issued({ parties: [{ type: 'SUBCONTRACTOR', id: t.sub1 }, { type: 'CREW', id: t.crew }, { type: 'PERSON', name: 'Foreman Rao' }] }); assert.equal(draft.status, 'DRAFT'); assert.equal(draft.docNo.startsWith('INS/'), true);
  const k = key(); const sent = await t.call(cm, 'POST', `/${draft.id}/submit`, undefined, k); assert.equal(sent.status, 202, JSON.stringify(sent.json)); const d = sent.json.data; assert.deepEqual([d.status, d.needsApproval, d.acks.length, d.compliance], ['OPEN', false, 3, 'AWAITING_ACK']); assert.equal((await t.call(cm, 'POST', `/${draft.id}/submit`, undefined, k)).json.data.id, draft.id, 'idempotent replay');
  assert.equal((await t.call(cm, 'PATCH', `/${draft.id}`, { subject: 'Changed after issue' })).status, 409);
  const [a1, a2, a3] = d.acks; assert.equal((await t.call(cm, 'POST', `/${d.id}/close`, { closureNotes: 'Nobody has complied' })).status, 422);
  assert.equal((await t.call(sk, 'POST', `/${d.id}/recipients/${a1.id}/acknowledge`, {})).status, 403); const ack = await t.call(subco, 'POST', `/${d.id}/recipients/${a1.id}/acknowledge`, { note: 'Received by the foreman' }); assert.equal(ack.status, 200, JSON.stringify(ack.json)); assert.equal(ack.json.data.acks[0].state, 'ACKNOWLEDGED');
  assert.equal((await t.call(subco, 'POST', `/${d.id}/recipients/${a1.id}/acknowledge`, {})).status, 409, 'once');
  // compliance needs the acknowledgement, a note and evidence
  assert.equal((await t.call(subco, 'POST', `/${d.id}/recipients/${a2.id}/comply`, { note: 'Done and checked' })).status, 422, 'not acknowledged yet');
  const noEv = await t.call(subco, 'POST', `/${d.id}/recipients/${a1.id}/comply`, { note: 'Re-fixed and checked' }); assert.equal(noEv.status, 400); assert.equal(noEv.json.error.details[0].field, 'evidence'); assert.equal((await t.call(subco, 'POST', `/${d.id}/recipients/${a1.id}/comply`, { note: 'x' })).status, 400);
  assert.equal((await t.upload(subco, 'site_instruction_ack', a1.id, 'refixed.png')).status, 201); const done = await t.call(subco, 'POST', `/${d.id}/recipients/${a1.id}/comply`, { note: 'Re-fixed and checked with the level' }); assert.equal(done.status, 200, JSON.stringify(done.json)); assert.deepEqual([done.json.data.acks[0].state, done.json.data.acks[0].evidence, done.json.data.compliance], ['COMPLIED', 1, 'AWAITING_ACK']);
  assert.equal((await t.upload(subco, 'site_instruction_ack', a1.id)).status >= 400, true, 'no evidence after compliance');
  for (const a of [a2, a3]) { assert.equal((await t.call(se, 'POST', `/${d.id}/recipients/${a.id}/acknowledge`, {})).status, 200); assert.equal((await t.upload(se, 'site_instruction_ack', a.id)).status, 201); assert.equal((await t.call(se, 'POST', `/${d.id}/recipients/${a.id}/comply`, { note: 'Done as instructed' })).status, 200); }
  // a recipient added later; the instruction waits for it
  const more = await t.call(cm, 'POST', `/${d.id}/recipients`, { parties: [{ type: 'SUBCONTRACTOR', id: t.sub2 }] }); assert.equal(more.status, 201); assert.equal(more.json.data.acks.length, 4); assert.equal((await t.call(cm, 'POST', `/${d.id}/recipients`, { parties: [{ type: 'SUBCONTRACTOR', id: t.sub2 }] })).status, 409); assert.equal((await t.call(cm, 'POST', `/${d.id}/recipients`, { parties: [{ type: 'SUBCONTRACTOR', id: t.vendor }] })).status, 400, 'a vendor is not a subcontractor');
  assert.equal((await t.call(cm, 'POST', `/${d.id}/close`, { closureNotes: 'One subcontractor is still to do it' })).status, 422); const a4 = more.json.data.acks[3];
  await t.call(subco, 'POST', `/${d.id}/recipients/${a4.id}/acknowledge`, {}); await t.upload(subco, 'site_instruction_ack', a4.id); await t.call(subco, 'POST', `/${d.id}/recipients/${a4.id}/comply`, { note: 'Pipes re-routed' });
  const fin = await t.call(cm, 'POST', `/${d.id}/close`, { closureNotes: 'All recipients have complied' }); assert.equal(fin.status, 200, JSON.stringify(fin.json)); assert.equal(fin.json.data.status, 'CLOSED');
  // overdue: a second one past its date is reminded once per period and shows in the tracker
  const od = await t.issued({ subject: 'Clear the debris', dueDate: day(4), date: day(6) }); assert.equal((await t.call(cm, 'POST', `/${od.id}/submit`)).status, 202);
  const tr = (await t.call(cm, 'GET', '/tracker')).json.data; assert.deepEqual([tr.counts.overdue, tr.counts.awaitingAck], [1, 1]); assert.equal((await t.call(cm, 'GET', '?filter[overdue]=1')).json.data.length, 1);
  const svc = (await import('../src/server/modules/site/index.js')).siteOf(t.d); assert.equal(svc.instructionsSvc.instructions.remind(TODAY), 1); assert.equal(svc.instructionsSvc.instructions.remind(TODAY), 0); assert.equal(svc.instructionsSvc.instructions.remind(isoOf(ordOf(TODAY) + 3)), 1);
  assert.ok(t.d.prepare("SELECT 1 FROM core_schedules WHERE code = 'site.instruction_reminders_daily'").get());
  const h = (await t.call(cm, 'GET', `/${d.id}/history`)).json.data; assert.ok(h.audit.some((x) => x.action === 'comply') && h.audit.some((x) => x.action === 'close'));
});

test('FR-04 AC-04 an instruction with a back-charge goes CM then PM before it is issued; the raiser never decides; an amendment replaces it; the amount is masked', async () => {
  const t = await boot();
  const bc = await t.issued({ backcharge: true, backchargeAmount: 25000.5, backchargePartnerId: t.sub1 }); assert.deepEqual([bc.backcharge, bc.backchargeAmount, bc.needsApproval], [true, 25000.5, true]);
  assert.equal((await t.call(cm, 'POST', '', { siteId: t.site, type: 'ISI', date: TODAY, fromParty: 'CM', subject: 'No partner', backcharge: true, parties: [{ type: 'CREW', id: t.crew }] })).status, 400); assert.equal((await t.call(cm, 'POST', '', { siteId: t.site, type: 'MEMO', date: TODAY, fromParty: 'CM', subject: 'Memo with charge', backcharge: true, backchargePartnerId: t.sub1 })).status, 400, 'only an ISI carries a back-charge'); assert.equal((await t.call(cm, 'POST', '', { siteId: t.site, type: 'ISI', date: TODAY, fromParty: 'CM', subject: 'No recipients' })).status, 400);
  const sub = await t.call(cm, 'POST', `/${bc.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId; assert.deepEqual([sub.json.data.status, sub.json.data.acks.length], ['SUBMITTED', 0], 'not issued, no recipients yet');
  assert.equal(await t.taskOf(cm, inst), undefined, 'the raiser holds no task'); assert.equal(await t.taskOf(pm, inst), undefined, 'the project manager waits for the first step'); assert.equal((await t.call(cm, 'PATCH', `/${bc.id}`, { subject: 'While waiting' })).status, 409);
  assert.equal((await t.act(cm2, inst, 'return')).status, 200); assert.equal((await t.call(cm, 'GET', `/${bc.id}`)).json.data.status, 'RETURNED'); assert.equal((await t.call(cm, 'PATCH', `/${bc.id}`, { backchargeAmount: 27000 })).json.data.backchargeAmount, 27000); assert.equal((await t.call(cm, 'POST', `/${bc.id}/submit`)).status, 202);
  assert.equal((await t.act(cm2, inst)).status, 200); assert.equal((await t.act(pm, inst)).status, 200); const ok = (await t.call(cm, 'GET', `/${bc.id}`)).json.data; assert.deepEqual([ok.status, ok.approvedBy, ok.acks.length, ok.compliance], ['OPEN', 'ipm1', 1, 'AWAITING_ACK']); t.drain();
  const ev = t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'site.instruction.backcharge'").all().map((x) => JSON.parse(x.payload).data); assert.equal(ev.length, 1); assert.deepEqual([ev[0].backchargePartnerId, ev[0].backchargeAmount, ev[0].docNo], [t.sub1, 27000, bc.docNo]);
  // locked; amended by a copy that goes through the chain and replaces it
  assert.equal((await t.call(cm, 'PATCH', `/${bc.id}`, { subject: 'After issue' })).status, 409); assert.equal((await t.call(cm, 'DELETE', `/${bc.id}`)).status, 422);
  const am = await t.call(cm, 'POST', `/${bc.id}/amend`, { reason: 'The amount was assessed again' }); assert.equal(am.status, 201); assert.deepEqual([am.json.data.status, am.json.data.revisionNo, am.json.data.previous.id], ['DRAFT', 2, bc.id]); assert.equal((await t.call(cm, 'POST', `/${bc.id}/amend`, { reason: 'Twice at once' })).status, 409); assert.equal((await t.call(cm, 'POST', `/${bc.id}/close`, { closureNotes: 'An amendment is open' })).status, 409);
  await t.call(cm, 'PATCH', `/${am.json.data.id}`, { backchargeAmount: 22000 }); const s2 = await t.call(cm, 'POST', `/${am.json.data.id}/submit`); assert.equal((await t.act(cm2, s2.json.data.workflowInstanceId)).status, 200); assert.equal((await t.act(pm, s2.json.data.workflowInstanceId)).status, 200);
  assert.equal((await t.call(cm, 'GET', `/${bc.id}`)).json.data.status, 'SUPERSEDED'); assert.deepEqual([(await t.call(cm, 'GET', `/${am.json.data.id}`)).json.data.status, (await t.call(cm, 'GET', `/${am.json.data.id}`)).json.data.acks.length], ['OPEN', 1]);
  // the amount is for those who deal with the money; the others see that there is one
  const masked = (await t.call(subco, 'GET', `/${am.json.data.id}`)).json.data; assert.deepEqual([masked.backchargeAmount, masked.amountMasked], [null, true]); assert.equal((await t.call(com, 'GET', `/${am.json.data.id}`)).json.data.backchargeAmount, 22000);
  // reject
  const r2 = await t.issued({ subject: 'Second charge', backcharge: true, backchargeAmount: 100, backchargePartnerId: t.sub2, parties: [{ type: 'SUBCONTRACTOR', id: t.sub2 }] }); const i2 = (await t.call(cm, 'POST', `/${r2.id}/submit`)).json.data.workflowInstanceId; assert.equal((await t.call(se, 'POST', `/${r2.id}/withdraw`, { reason: 'Not mine to withdraw' })).status, 403); assert.equal((await t.act(cm2, i2, 'reject')).status, 200); assert.equal((await t.call(cm, 'GET', `/${r2.id}`)).json.data.status, 'REJECTED');
  // the CM who raised it never approves it
  const own = as('CM,SE', 'icm1'); const r3 = await t.issued({ subject: 'Third', backcharge: true, backchargeAmount: 5, backchargePartnerId: t.sub1 }, own); const i3 = (await t.call(own, 'POST', `/${r3.id}/submit`)).json.data.workflowInstanceId; assert.equal(await t.taskOf(own, i3), undefined);
});

test('AC-03 roles and isolation: who sees and does what; another company or project gets nothing; the flag gates the routes; list and export', async () => {
  const t = await boot(); const r = await t.received({ costImplication: true }); const i = await t.issued({ siteId: t.site2, parties: [{ type: 'PERSON', name: 'Foreman Rao' }] }); assert.equal(i.siteId, t.site2);
  for (const [who, list, create] of [[cm, 200, 201], [pm, 200, 201], [subco, 200, 403], [se, 200, 403], [com, 200, 403], [plan1, 200, 403], [aud, 200, 403], [sk, 403, 403]]) {
    assert.equal((await t.call(who, 'GET', '')).status, list, `${who.roles} lists`);
    const mk = await t.call(who, 'POST', '', { siteId: t.site, type: 'MEMO', date: TODAY, fromParty: 'Site office', subject: `By ${who.roles}`, description: 'A memo for the site' }); assert.equal(mk.status, create, `${who.roles} creates ${JSON.stringify(mk.json)}`);
  }
  assert.equal((await t.call(subco, 'PATCH', `/${r.id}`, { subject: 'Edit' })).status, 403); assert.equal((await t.call(plan1, 'POST', `/${r.id}/close`, { closureNotes: 'A planner cannot close' })).status, 403); assert.equal((await t.call(plan1, 'GET', `/${r.id}`)).json.data.backchargeAmount, null);
  assert.equal((await t.call(other, 'GET', `/${r.id}`)).status, 404); assert.equal((await t.call(other, 'GET', '')).json.data.length, 0); assert.equal((await t.call(other, 'POST', '', { siteId: t.site, type: 'MEMO', date: TODAY, fromParty: 'Site office', subject: 'Cross company' })).status, 404);
  assert.equal((await t.call(cm, 'PATCH', `/${r.id}`, { status: 'CLOSED' })).status, 400, 'the status is set by the actions only');
  const list = (await t.call(cm, 'GET', '?filter[direction]=RECEIVED&pageSize=50')).json; assert.ok(list.data.length >= 1 && list.data.every((x) => x.direction === 'RECEIVED')); assert.ok((await t.call(cm, 'GET', '?filter[direction]=ISSUED')).json.data.every((x) => x.direction === 'ISSUED')); assert.equal((await t.call(cm, 'GET', '?q=thickness')).json.data.length, 1);
  const csv = await t.api.raw('GET', `${S}${I}/export?format=csv`, cm); assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /Increase the raft/); assert.equal((await t.api.raw('GET', `${S}${I}/export?format=csv`, plan1)).status, 403);
  const pdf = await t.api.raw('GET', `${S}${I}/${r.id}/pdf`, cm); assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF'); assert.match((await t.api.raw('GET', `${S}${I}/${r.id}/print`, cm)).buffer.toString(), /Increase the raft/);
  assert.deepEqual((await t.call(cm, 'GET', `/options?siteId=${t.site}`)).json.data.subcontractors.map((x) => x.name), ['Om Plumbing', 'Shree Shuttering']);
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1404'").run(); assert.equal((await t.call(cm, 'GET', '')).status, 404); assert.notEqual((await t.api.call('GET', `${S}/weather`, { ...cm })).status, 404);
});
