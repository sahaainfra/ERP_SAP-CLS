import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { objectTypes } from '../src/server/platform/objects/index.js';
import { tasksOf } from '../src/server/platform/tasks/index.js';
import { collabOf, mentionsOf, toMs } from '../src/server/modules/eng/collab.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.14: comments, mentions, activity timeline and record trace links.
// T-01 the timeline merges events of every source in the right order; T-02 the trace of a purchase order shows its requisition upstream and its goods receipt downstream.
const C = '/api/v1/col';
const json = { 'content-type': 'application/json' };
const key = (k = 'c') => ({ ...json, 'idempotency-key': `col-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const se = as('SE', 'se1');
const acc = as('ACCMGR', 'acc1');
const sys = as('SYSADM', 'sys1');
const emp = as('EMP', 'emp1');
const aud = as('AUD', 'aud1');
const all = as('SYSADM,DOC,ITADM', 'sys1'); // the system administrator who also keeps the documents and reads the communication log

// records of other modules that do not exist yet: a requisition, an order and a receipt, known to the object type registry
const records = new Map([['PR-1', { project: 1, status: 'APPROVED', amount: '100000.00' }], ['PO-1', { project: 1, status: 'ISSUED', amount: '98000.00' }], ['GRN-1', { project: 1, status: 'POSTED', amount: '49000.00' }], ['GRN-2', { project: 1, status: 'POSTED', amount: '49000.00' }], ['SECRET-1', { project: 2, status: 'DRAFT', amount: '5.00', hidden: true }]]);
for (const [type, label] of [['test_pr', 'Purchase requisition'], ['test_po', 'Purchase order'], ['test_grn', 'Goods receipt']]) {
  objectTypes.register({
    type, label, permission: 'eng.sample.use',
    access: (_db, actor, id) => { const r = records.get(String(id)); return r && !r.hidden ? { companyId: actor.companyId, projectId: r.project, siteId: null, status: r.status } : null; },
    auditEntities: () => [],
    summary: (_db, _actor, id) => { const r = records.get(String(id)); return r ? { label: `${label} ${id}`, status: r.status, amount: r.amount } : null; },
    route: (id) => `/test/${type}/${id}`,
  });
}

const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Kumar`, JSON.stringify(roles), `${name}@example.com`);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['pd1', ['PD']], ['pm1', ['PM']], ['se1', ['SE']], ['acc1', ['ACCMGR']], ['sys1', ['SYSADM']], ['emp1', ['EMP']], ['aud1', ['AUD']]]) user(api, n, r);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const drain = async () => { for (let i = 0; i < 4; i += 1) { runtimeOf(api.db).bus.drain(); await runtimeOf(api.db).jobs.drain(); } };
  const doc = (await api.call('POST', '/api/v1/eng/sample-docs', { ...pd, headers: key('d'), body: { title: 'Shuttering', amount: '12000.00', projectId: project } })).json.data;
  return { api, project, doc, drain, collab: collabOf(api.db) };
};
const post = (api, who, body, k = 'p') => api.call('POST', `${C}/comments`, { ...who, headers: key(k), body });
const rec = (doc) => ({ entity: 'sample_doc', id: String(doc.id) });

test('mentions are read from the text without picking up e-mail addresses or trailing punctuation', () => {
  assert.deepEqual(mentionsOf('Hi @pm1, please check with @acc1. Mail me at x@example.com or @pm1 again; @a is too short'), ['pm1', 'acc1']);
  assert.equal(toMs('2026-11-01 10:00:00'), Date.parse('2026-11-01T10:00:00Z'));
});

test('FR-01 AC-01 threaded comments with replies, an edit inside the window, reactions and deletion; the discussion is the record\'s own', async () => {
  const { api, doc } = await setup();
  const first = await post(api, pd, { ...rec(doc), body: 'Please confirm the quantity.' });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const reply = await post(api, se, { ...rec(doc), body: 'Confirmed: 40 sheets.', parentId: first.json.data.id });
  assert.equal(reply.status, 201);
  const list = (await api.call('GET', `${C}/comments?entity=sample_doc&id=${doc.id}`, pd)).json.data;
  assert.equal(list.total, 2);
  assert.equal(list.comments.length, 1, 'one thread');
  assert.equal(list.comments[0].replies[0].body, 'Confirmed: 40 sheets.');
  assert.equal(list.comments[0].canEdit, true);
  assert.equal(list.comments[0].replies[0].canEdit, false, 'the reply is the other person\'s');
  assert.equal(list.settings.editWindowMinutes, 15);
  // a reply to a comment of another record is refused
  const other = (await api.call('POST', '/api/v1/eng/sample-docs', { ...pd, headers: key('d2'), body: { title: 'Other', amount: '5000.00', projectId: doc.projectId } })).json.data;
  assert.equal((await post(api, pd, { ...rec(other), body: 'x', parentId: first.json.data.id })).status, 404);
  // edit: only the author, only inside the window, version checked
  const edit = (who, id, body) => api.call('PATCH', `${C}/comments/${id}`, { ...who, headers: key('e'), body });
  assert.equal((await edit(se, first.json.data.id, { body: 'Hijacked' })).status, 403);
  assert.equal((await edit(pd, first.json.data.id, { body: 'Please confirm the quantity today.', version: 9 })).status, 409);
  assert.equal((await edit(pd, first.json.data.id, { body: 'Please confirm the quantity today.' })).status, 200);
  api.db.prepare("UPDATE col_comments SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 20 * 60_000).toISOString(), first.json.data.id);
  const late = await edit(pd, first.json.data.id, { body: 'Too late' });
  assert.equal(late.status, 422);
  assert.match(late.json.error.message, /15 minute/);
  // reactions toggle, one per person and kind
  const react = (who, id, body) => api.call('POST', `${C}/comments/${id}/reactions`, { ...who, headers: key('r'), body });
  assert.equal((await react(se, first.json.data.id, { reaction: 'ack' })).json.data.count, 1);
  assert.equal((await react(se, first.json.data.id, { reaction: 'ack' })).json.data.count, 1, 'again changes nothing');
  assert.equal((await react(pm, first.json.data.id, { reaction: 'ack' })).json.data.count, 2);
  assert.equal((await react(se, first.json.data.id, { reaction: 'ack', on: false })).json.data.count, 1);
  assert.equal((await react(se, first.json.data.id, { reaction: 'party' })).status, 400);
  // the edit is in the audit trail with the old text
  const audit = api.db.prepare("SELECT old_values, new_values FROM core_audit_log WHERE entity = 'col_comments' AND entity_id = ? AND action = 'update'").get(String(first.json.data.id));
  assert.match(audit.old_values, /Please confirm the quantity\./);
  // too long
  assert.equal((await post(api, pd, { ...rec(doc), body: 'x'.repeat(2001) })).status, 422);
  // delete: the author may; the thread keeps its place
  const del = (who, id, body = {}) => api.call('DELETE', `${C}/comments/${id}`, { ...who, headers: key('x'), body });
  assert.equal((await del(se, reply.json.data.id)).status, 200);
  const gone = (await api.call('GET', `${C}/comments?entity=sample_doc&id=${doc.id}`, acc)).json.data;
  assert.equal(gone.total, 1);
  assert.equal(gone.comments[0].replies[0].status, 'DELETED');
  assert.equal(gone.comments[0].replies[0].body, '', 'the text of a deleted comment is not shown');
});

test('BR-01 FR-01 FR-05 a mention notifies the person who can see the record; a person who cannot is refused with a message and nothing is posted', async () => {
  const { api, doc, drain } = await setup();
  const blocked = await post(api, pd, { ...rec(doc), body: 'Over to you @emp1 please' });
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error.message, /@emp1 cannot see this record/);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM col_comments').get().n, 0, 'nothing was posted');
  const ok = await post(api, pd, { ...rec(doc), body: 'Over to you @pm1 and @ghost99 please' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.data.mentions, ['pm1']);
  assert.deepEqual(ok.json.data.ignored, ['ghost99']);
  await drain();
  const n = api.db.prepare("SELECT user_ref, link FROM ntf_notifications WHERE template_code = 'col.mention'").all();
  assert.deepEqual(n.map((x) => x.user_ref), ['pm1']);
  assert.match(n[0].link, /sample-docs\?open=/);
  // a mention of oneself notifies nobody; a reply notifies the author of the comment
  await post(api, pd, { ...rec(doc), body: 'Note to self @pd1' });
  const reply = await post(api, se, { ...rec(doc), body: 'Done', parentId: ok.json.data.id });
  assert.equal(reply.status, 201);
  await drain();
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'col.mention'").get().n, 1);
  assert.deepEqual(api.db.prepare("SELECT user_ref FROM ntf_notifications WHERE template_code = 'col.reply'").all().map((x) => x.user_ref), ['pd1']);
  // the mentions inbox of the person mentioned
  const inbox = (await api.call('GET', `${C}/mentions`, pm)).json.data;
  assert.equal(inbox.total, 1);
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.rows[0].author.username, 'pd1');
  assert.equal(inbox.rows[0].record.type, 'sample_doc');
  assert.match(inbox.rows[0].excerpt, /Over to you/);
  assert.equal((await api.call('GET', `${C}/mentions`, se)).json.data.total, 0, 'only the person named sees it');
  assert.equal((await api.call('POST', `${C}/mentions/read`, { ...pm, headers: key('m'), body: { ids: [inbox.rows[0].id] } })).json.data.marked, 1);
  assert.equal((await api.call('GET', `${C}/mentions?unread=true`, pm)).json.data.total, 0);
  // editing in a new mention checks it too
  const edit = await api.call('PATCH', `${C}/comments/${reply.json.data.id}`, { ...se, headers: key('e'), body: { body: 'Done @emp1' } });
  assert.equal(edit.status, 422);
});

test('FR-01 BR-01 a person without the right to the record cannot read or write its discussion, timeline or trace; deleting another person\'s comment needs a moderator and a reason', async () => {
  const { api, doc } = await setup();
  const c = (await post(api, se, { ...rec(doc), body: 'A site note' })).json.data;
  for (const who of [emp, aud]) {
    assert.equal((await api.call('GET', `${C}/comments?entity=sample_doc&id=${doc.id}`, who)).status, 403, `${who.user} reads`);
    assert.equal((await post(api, who, { ...rec(doc), body: 'hello' })).status, 403, `${who.user} writes`);
    assert.equal((await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}`, who)).status, 403);
    assert.equal((await api.call('GET', `${C}/trace?entity=sample_doc&id=${doc.id}`, who)).status, 403);
  }
  assert.equal((await api.call('GET', `${C}/comments?entity=sample_doc&id=999999`, pd)).status, 404);
  assert.equal((await api.call('GET', `${C}/comments?entity=nothing_here&id=1`, pd)).status, 404);
  assert.equal((await api.call('GET', `${C}/comments?entity=Bad-Type&id=1`, pd)).status, 400);
  // a colleague without the moderator right cannot delete it; with it, a reason is needed; the text stays in the audit trail
  const del = (who, body = {}) => api.call('DELETE', `${C}/comments/${c.id}`, { ...who, headers: key('x'), body });
  assert.equal((await del(acc, { reason: 'Not mine to delete' })).status, 403);
  const noReason = await del(pm);
  assert.equal(noReason.status, 422);
  assert.match(noReason.json.error.message, /why/);
  assert.equal((await del(pm, { reason: 'Contains a supplier rate' })).status, 200);
  const trail = api.db.prepare("SELECT old_values, reason FROM core_audit_log WHERE entity = 'col_comments' AND entity_id = ? AND action = 'delete'").get(String(c.id));
  assert.match(trail.old_values, /A site note/);
  assert.equal(trail.reason, 'Contains a supplier rate');
  const seen = (await api.call('GET', `${C}/comments?entity=sample_doc&id=${doc.id}`, pm)).json.data;
  assert.equal(seen.comments[0].deletedReason, 'Contains a supplier rate', 'a moderator sees why');
  assert.equal((await api.call('GET', `${C}/comments?entity=sample_doc&id=${doc.id}`, acc)).json.data.comments[0].deletedReason, null);
  assert.equal((await del(pm, { reason: 'again' })).status, 422, 'already deleted');
});

test('T-01 FR-02 AC-01 the timeline merges audit, approval workflow, comments, document versions, tasks and messages in the right order, with filters', async () => {
  const { api, doc, project, drain } = await setup();
  // an approval cycle puts workflow history and audit on the record
  assert.equal((await api.call('POST', `/api/v1/eng/sample-docs/${doc.id}/submit`, { ...pd, headers: key('s'), body: {} })).status, 201);
  await post(api, pd, { ...rec(doc), body: 'Submitted for approval @pm1' });
  const task = tasksOf(api.db).create({ companyId: 1, title: 'Check the sheets', assignees: ['se1'], assigner: 'pd1', actor: 'pd1', entity: 'sample_doc', entityId: String(doc.id), projectId: project });
  const docRow = Number(api.db.prepare("INSERT INTO doc_documents (company_id, doc_no, title, doc_type, owner_user_ref, project_id, created_by, source_type) VALUES (1, 'DWG-1', 'Shuttering drawing', 'DRAWING', 'pd1', ?, 'pd1', 'test')").run(project).lastInsertRowid);
  const ver = Number(api.db.prepare("INSERT INTO doc_versions (company_id, document_id, revision, revision_no, created_by, source_type) VALUES (1, ?, 'A', 1, 'pd1', 'test')").run(docRow).lastInsertRowid);
  api.db.prepare("INSERT INTO doc_links (company_id, document_id, entity, entity_id, created_by, source_type) VALUES (1, ?, 'sample_doc', ?, 'pd1', 'test')").run(docRow, String(doc.id));
  const msg = Number(api.db.prepare("INSERT INTO comm_messages (company_id, channel, to_address, subject, related_entity, related_id, status, created_by, source_type) VALUES (1, 'EMAIL', 'vendor@example.com', 'Order copy', 'sample_doc', ?, 'SENT', 'pd1', 'test')").run(String(doc.id)).lastInsertRowid);
  await drain();
  // known times, one source after the other (the audit trail and the workflow history cannot be changed, so the others are placed after their real time): comment +10, message +15, task +20, document +25 minutes
  const at = (m) => new Date(Date.now() + 3_600_000 + m * 60_000).toISOString();
  api.db.prepare("UPDATE col_comments SET created_at = ?").run(at(10));
  api.db.prepare("UPDATE comm_messages SET created_at = ? WHERE id = ?").run(at(15).replace('T', ' ').slice(0, 19), msg);
  api.db.prepare("UPDATE tsk_tasks SET created_at = ? WHERE id = ?").run(at(20), task.id);
  api.db.prepare("UPDATE doc_versions SET created_at = ? WHERE id = ?").run(at(25), ver);
  const tl = (await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&limit=200`, all)).json.data;
  const order = tl.rows.map((r) => r.kind).filter((k, i, a) => a[i - 1] !== k);
  assert.deepEqual(order.slice(0, 4), ['document', 'task', 'message', 'comment'], JSON.stringify(tl.rows.map((r) => [r.kind, r.at])));
  assert.ok(order.slice(4).every((k) => k === 'workflow' || k === 'audit'));
  const times = tl.rows.map((r) => toMs(r.at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  for (const k of ['audit', 'workflow', 'comment', 'document', 'task', 'message']) assert.ok(tl.counts[k] >= 1, `${k} present`);
  assert.equal(tl.rows.find((r) => r.kind === 'comment').actorName, 'PD1 Kumar');
  // filters: by kind, by date range, by text, paging
  const only = (await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&kinds=comment,task`, all)).json.data;
  assert.deepEqual([...new Set(only.rows.map((r) => r.kind))].sort(), ['comment', 'task']);
  const range = (await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&from=${encodeURIComponent(at(12))}&to=${encodeURIComponent(at(22))}`, all)).json.data;
  assert.deepEqual(range.rows.map((r) => r.kind), ['task', 'message']);
  assert.ok(tl.rows.some((r) => r.kind === 'workflow'), 'the approval workflow is on the timeline');
  assert.equal((await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&q=drawing`, all)).json.data.rows.length, 1);
  const page = (await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&limit=2&offset=1`, all)).json.data;
  assert.deepEqual(page.rows.map((r) => r.kind), ['task', 'message']);
  assert.equal(page.total, tl.total);
  // a person who may not see messages or confidential documents does not see them in the timeline
  const noLog = (await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&limit=200`, pd)).json.data;
  assert.equal(noLog.counts.message, 0, 'pd1 has no right to the communication log');
  api.db.prepare("UPDATE doc_documents SET confidentiality = 'RESTRICTED' WHERE id = ?").run(docRow);
  assert.equal((await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&limit=200`, se)).json.data.counts.document, 0, 'a restricted document is not listed to someone without the right');
  assert.equal((await api.call('GET', `${C}/timeline?entity=sample_doc&id=${doc.id}&kinds=nonsense`, all)).status, 400);
});

test('FR-04 the project activity feed lists what happened across the project\'s records, and needs the right for that project', async () => {
  const { api, doc, project } = await setup();
  await post(api, pd, { ...rec(doc), body: 'Feed comment' });
  tasksOf(api.db).create({ companyId: 1, title: 'Feed task', assignees: ['se1'], assigner: 'pd1', actor: 'pd1', projectId: project });
  const feed = (await api.call('GET', `${C}/feed?projectId=${project}&limit=100`, pm)).json.data;
  const kinds = new Set(feed.rows.map((r) => r.kind));
  for (const k of ['audit', 'comment', 'task']) assert.ok(kinds.has(k), `${k} in the feed: ${[...kinds]}`);
  assert.equal(feed.rows.find((r) => r.kind === 'comment').record.type, 'sample_doc');
  assert.equal((await api.call('GET', `${C}/feed?projectId=${project}&kinds=comment`, pm)).json.data.rows.every((r) => r.kind === 'comment'), true);
  assert.equal((await api.call('GET', `${C}/feed?projectId=${project}`, se)).status, 403, 'the site engineer does not hold the feed right');
  const picker = (await api.call('GET', `${C}/feed`, pm)).json.data;
  assert.deepEqual(picker.projects.map((p) => p.code), ['P1'], 'the projects the person may pick');
  assert.equal(picker.rows.length, 0);
});

test('T-02 FR-03 AC-01 the trace of a test purchase order shows its requisition upstream and its goods receipts downstream, with status and amount; hidden records are not named', async () => {
  const { api, project, drain, collab } = await setup();
  // services write the links: one directly, the others by the event a module publishes when it connects two records
  collab.trace.add('system', { companyId: 1, from: { entity: 'test_pr', id: 'PR-1' }, to: { entity: 'test_po', id: 'PO-1' }, relation: 'DERIVED', projectId: project });
  collab.trace.add('system', { companyId: 1, from: { entity: 'test_pr', id: 'PR-1' }, to: { entity: 'test_po', id: 'PO-1' }, relation: 'DERIVED', projectId: project });
  for (const g of ['GRN-1', 'GRN-2']) publishEvent(api.db, { type: 'col.trace.requested', entity: 'test_grn', entityId: g, actorId: 'store1', companyId: 1, projectId: project, data: { from: { entity: 'test_po', id: 'PO-1' }, to: { entity: 'test_grn', id: g }, relation: 'FULFILS' } });
  publishEvent(api.db, { type: 'col.trace.requested', entity: 'test_po', entityId: 'PO-1', actorId: 'store1', companyId: 1, data: { from: { entity: 'test_pr', id: 'SECRET-1' }, to: { entity: 'test_po', id: 'PO-1' }, relation: 'REFERS' } });
  await drain();
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM col_trace_links WHERE from_id = 'PR-1'").get().n, 1, 'the same link twice is one link');
  const t = (await api.call('GET', `${C}/trace?entity=test_po&id=PO-1&depth=3`, pm)).json.data;
  assert.equal(t.root.label, 'Purchase order PO-1');
  const up = t.upstream.filter((n) => !n.restricted);
  assert.deepEqual(up.map((n) => [n.type, n.id, n.status, n.amount, n.relation]), [['test_pr', 'PR-1', 'APPROVED', '100000.00', 'DERIVED']]);
  assert.deepEqual(t.downstream.map((n) => [n.type, n.id, n.status, n.amount, n.relation]), [['test_grn', 'GRN-1', 'POSTED', '49000.00', 'FULFILS'], ['test_grn', 'GRN-2', 'POSTED', '49000.00', 'FULFILS']]);
  assert.equal(t.totals.downstream, '98000.00');
  assert.equal(t.upstream.filter((n) => n.restricted).length, 1, 'a record the person cannot open is shown as restricted');
  const hidden = t.upstream.find((n) => n.restricted);
  assert.deepEqual([hidden.id, hidden.label, hidden.route], [null, 'Restricted record', null], 'nothing about it leaks');
  assert.equal(JSON.stringify(t).includes('SECRET-1'), false);
  // seen from the receipt: the chain goes up through the order to the requisition (depth), and a depth of 1 stops at the order
  const g = (await api.call('GET', `${C}/trace?entity=test_grn&id=GRN-1&depth=3`, pm)).json.data;
  assert.deepEqual(g.upstream.map((n) => [n.id, n.level]).filter(([id]) => id), [['PO-1', 1], ['PR-1', 2]]);
  assert.deepEqual((await api.call('GET', `${C}/trace?entity=test_grn&id=GRN-1&depth=1`, pm)).json.data.upstream.map((n) => n.id), ['PO-1']);
  assert.equal((await api.call('GET', `${C}/trace?entity=test_po&id=PO-1&depth=99`, pm)).status, 400);
  // a loop between records does not run for ever
  collab.trace.add('system', { companyId: 1, from: { entity: 'test_grn', id: 'GRN-1' }, to: { entity: 'test_pr', id: 'PR-1' }, relation: 'REFERS' });
  const loop = await api.call('GET', `${C}/trace?entity=test_pr&id=PR-1&depth=8`, pm);
  assert.ok(loop.json.data.downstream.length >= 2, JSON.stringify(loop.json));
  // the record itself must be open to the person
  assert.equal((await api.call('GET', `${C}/trace?entity=test_pr&id=SECRET-1`, pm)).status, 404);
});

test('BR-02 FR-03 a trace link is made by hand only with a reason, by someone who holds the right and can open both records; only a hand-made link can be removed by hand', async () => {
  const { api, drain, collab, doc } = await setup();
  const link = (who, body, k = 'l') => api.call('POST', `${C}/trace/links`, { ...who, headers: key(k), body });
  const body = { from: { entity: 'test_pr', id: 'PR-1' }, to: { entity: 'test_po', id: 'PO-1' }, relation: 'DERIVED', reason: 'The order was raised by phone from this requisition' };
  assert.equal((await link(se, body)).status, 403, 'no right to link');
  assert.equal((await link(pm, { ...body, reason: 'short' })).status, 400, 'a reason of some length');
  assert.equal((await link(pm, { ...body, reason: undefined })).status, 400);
  assert.equal((await link(pm, { ...body, to: { entity: 'test_po', id: 'SECRET-1' } })).status, 404, 'both records must be open to the person');
  assert.equal((await link(pm, { ...body, to: body.from })).status, 422, 'not to itself');
  const made = await link(pm, body);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal((await link(pm, body, 'l2')).status, 409, 'already linked');
  const row = api.db.prepare('SELECT link_kind, reason FROM col_trace_links WHERE id = ?').get(made.json.data.id);
  assert.deepEqual([row.link_kind, row.reason], ['MANUAL', body.reason]);
  const shown = (await api.call('GET', `${C}/trace?entity=test_po&id=PO-1`, pm)).json.data;
  assert.equal(shown.upstream[0].manual, true);
  assert.equal(shown.canLink, true);
  assert.equal((await api.call('GET', `${C}/trace?entity=test_po&id=PO-1`, se)).json.data.canLink, false);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'col_trace_links' AND action = 'link' AND reason = ?").get(body.reason), 'audited with the reason');
  // the database itself refuses a hand-made link without a reason
  assert.throws(() => api.db.prepare("INSERT INTO col_trace_links (company_id, from_entity, from_id, to_entity, to_id, relation, link_kind) VALUES (1, 'a', '1', 'b', '2', 'REFERS', 'MANUAL')").run());
  // removal
  const un = (who, id, b = {}) => api.call('DELETE', `${C}/trace/links/${id}`, { ...who, headers: key('u'), body: b });
  assert.equal((await un(se, made.json.data.id, { reason: 'x' })).status, 403);
  assert.equal((await un(pm, made.json.data.id, { reason: 'Linked by mistake' })).status, 200);
  assert.equal((await api.call('GET', `${C}/trace?entity=test_po&id=PO-1`, pm)).json.data.upstream.length, 0);
  const svc = collab.trace.add('system', { companyId: 1, from: { entity: 'test_pr', id: 'PR-1' }, to: { entity: 'test_po', id: 'PO-1' } });
  assert.equal((await un(pm, svc.id, { reason: 'trying to hide it' })).status, 422, 'a link a service wrote stays');
  // the amendment of a sample document links itself to the document it amends
  const doc2 = (await api.call('POST', '/api/v1/eng/sample-docs', { ...pd, headers: key('d3'), body: { title: 'Approved one', amount: '1000.00', projectId: doc.projectId } })).json.data;
  api.db.prepare("UPDATE eng_sample_docs SET status = 'APPROVED', locked = 1 WHERE id = ?").run(doc2.id);
  const am = await api.call('POST', `/api/v1/eng/sample-docs/${doc2.id}/amend`, { ...pd, headers: key('a'), body: {} });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  const amended = am.json.data;
  await drain();
  const tr = await api.call('GET', `${C}/trace?entity=sample_doc&id=${amended.id}`, pd);
  assert.equal(tr.status, 200, JSON.stringify(tr.json));
  const t = tr.json.data;
  assert.deepEqual(t.upstream.map((n) => [n.type, n.id, n.relation, n.status]), [['sample_doc', String(doc2.id), 'AMENDS', 'APPROVED']]);
  assert.match(t.upstream[0].label, new RegExp(doc2.docNo));
  assert.equal((await api.call('GET', `${C}/trace?entity=sample_doc&id=${doc2.id}`, pd)).json.data.downstream[0].id, String(amended.id));
});

test('AC-04 the settings are parameters of the parameter engine: limits apply, a change needs a reason and is audited, and it takes effect at once; the feature flag switches the API off', async () => {
  const { api, doc } = await setup();
  const c = (await post(api, pd, { ...rec(doc), body: 'Settings check' })).json.data;
  api.db.prepare('UPDATE col_comments SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 20 * 60_000).toISOString(), c.id);
  const edit = (b = 'Settings check again') => api.call('PATCH', `${C}/comments/${c.id}`, { ...pd, headers: key('e'), body: { body: b } });
  assert.equal((await edit()).status, 422, 'the window of 15 minutes is over');
  const set = (body, who = sys) => api.call('POST', '/api/v1/core/parameters', { ...who, headers: key('p'), body: { scopeType: 'company', scopeId: 1, effectiveFrom: todayIST(), reason: 'Site engineers need longer to correct a note', ...body } });
  assert.equal((await set({ key: 'col.comment.edit_window_minutes', value: 5000 })).status, 400, 'outside the declared limits');
  assert.equal((await set({ key: 'col.comment.edit_window_minutes', value: 30, reason: undefined })).status, 400, 'a change needs a reason');
  const changed = await set({ key: 'col.comment.edit_window_minutes', value: 30 });
  assert.equal(changed.status, 201, JSON.stringify(changed.json));
  assert.equal((await edit()).status, 200, 'the longer window applies at once');
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity LIKE '%param%' AND new_values LIKE '%col.comment.edit_window_minutes%'").get(), 'the change is in the audit trail');
  // reactions can be switched off for the company
  assert.equal((await set({ key: 'col.reactions.enabled', value: false })).status, 201);
  const r = await api.call('POST', `${C}/comments/${c.id}/reactions`, { ...se, headers: key('r'), body: { reaction: 'like' } });
  assert.equal(r.status, 422);
  assert.equal((await api.call('GET', `${C}/comments?entity=sample_doc&id=${doc.id}`, pd)).json.data.settings.reactionsEnabled, false);
  // the company's flag
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.eng.p0414'").run();
  const off = await api.call('GET', `${C}/comments?entity=sample_doc&id=${doc.id}`, pd);
  assert.equal(off.status, 404, JSON.stringify(off.json));
});
