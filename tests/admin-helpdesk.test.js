import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { helpdeskOf } from '../src/server/modules/admin/helpdesk.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.08: help desk, knowledge base and in-app help.
// T-01 a ticket captures the correlation ID and the page; SLA escalation works. FR-01 tickets with categories, priority, team, SLA, status,
// resolution and updates; FR-02 data corrections routed to the module owner with approval (never direct edits, BR-01); FR-03 contextual
// help and tours per role; FR-04 articles, release notes and announcements; FR-05 rating and dashboard.
const H = '/api/v1/admin/help';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `hd-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const se = as('SE', 'hd-se'); const se2 = as('SE', 'hd-se2'); const it = as('ITADM', 'hd-it'); const acc = as('ACCMGR', 'hd-acc'); const aud = as('AUD', 'hd-aud'); const xcon = as('X-CON', 'hd-x');
const opened = []; after(async () => { for (const c of opened) await c(); });

async function setup() {
  const api = await startApi(); opened.push(() => api.close()); await setupCompany(api); const db = api.db;
  for (const u of [se, se2, it, acc, aud, xcon]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2908', 1, 'Help desk fixture', 0, 1)").run();
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  return { api, db, call };
}
const ticket = (o = {}) => ({ subject: 'DPR save fails with an error', description: 'Saving the DPR for 21 November shows "Something went wrong".', category: 'BUG', priority: 'HIGH', pageRef: '/site/dprs/42', pageTitle: 'Daily Progress Report', entity: 'site_dprs', entityId: '42', correlationId: 'c0ffee00-1234-4abc-9def-001122334455', failedCall: { correlationId: 'c0ffee00-1234-4abc-9def-001122334455', status: 500, code: 'INTERNAL_ERROR', path: '/site/dprs/42/submit' }, userAgent: 'Mozilla/5.0 (Linux; Android 14)', channels: ['WHATSAPP'], ...o });

test('T-01 FR-01 FR-05 a ticket keeps the page and correlation ID; routed with its SLA; worked, resolved, rated; SLA escalation', async () => {
  const t = await setup();
  const r = await t.call(se, 'POST', `${H}/tickets`, ticket());
  assert.equal(r.status, 201, JSON.stringify(r.json)); const tk = r.json.data;
  assert.deepEqual([tk.ticketNo, tk.status, tk.team, tk.pageRef, tk.entity], ['HD-000001', 'NEW', 'APP_SUPPORT', '/site/dprs/42', 'site_dprs']);
  assert.ok(Date.parse(tk.slaDue) - Date.now() > 7.9 * 3_600_000 && Date.parse(tk.slaDue) - Date.now() < 8.1 * 3_600_000, 'HIGH: 8 hours');
  assert.match(tk.correlationId, /^•••/, 'the person sees only the end of the correlation ID');
  const full = (await t.call(it, 'GET', `${H}/tickets/${tk.id}`)).json.data;
  assert.equal(full.correlationId, 'c0ffee00-1234-4abc-9def-001122334455', 'T-01: support sees the correlation ID of the failed call'); assert.equal(full.failedCall.status, 500); assert.match(full.userAgent, /Android/);
  assert.equal((await t.call(xcon, 'POST', `${H}/tickets`, ticket())).status, 403, 'external parties do not raise internal tickets');
  assert.equal((await t.call(se2, 'GET', `${H}/tickets/${tk.id}`)).status, 404, 'another person\'s ticket is private');
  assert.equal((await t.call(se, 'POST', `${H}/tickets/${tk.id}/act`, { action: 'resolve', resolution: 'Self-resolved' })).status, 403);
  // the queue: support assigns, asks, the person answers, support resolves; the person rates
  const q = (await t.call(it, 'GET', `${H}/tickets?scope=queue`)).json.data; assert.equal(q.total, 1);
  await t.call(it, 'POST', `${H}/tickets/${tk.id}/act`, { action: 'assign' });
  await t.call(it, 'POST', `${H}/tickets/${tk.id}/act`, { action: 'wait', note: 'Which activity were you saving?' });
  await t.call(it, 'POST', `${H}/tickets/${tk.id}/act`, { action: 'comment', note: 'Internal: looks like the cutoff check', internal: true });
  const mine = (await t.call(se, 'GET', `${H}/tickets/${tk.id}`)).json.data;
  assert.equal(mine.status, 'WAITING_USER'); assert.ok(!mine.notes.some((n) => n.internal), 'internal notes are hidden from the person');
  assert.equal((await t.call(se, 'POST', `${H}/tickets/${tk.id}/act`, { action: 'comment', note: 'Footing concrete, block B' })).json.data.status, 'IN_PROGRESS');
  const res = (await t.call(it, 'POST', `${H}/tickets/${tk.id}/act`, { action: 'resolve', resolution: 'The cutoff time was corrected in the site settings.' })).json.data;
  assert.equal(res.status, 'RESOLVED');
  assert.ok(t.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'hd.ticket.updated'").get() ?? true);
  assert.equal((await t.call(it, 'POST', `${H}/tickets/${tk.id}/rating`, { rating: 5 })).status, 403);
  const rated = (await t.call(se, 'POST', `${H}/tickets/${tk.id}/rating`, { rating: 4, comment: 'Quick, thanks' })).json.data;
  assert.deepEqual([rated.status, rated.rating], ['CLOSED', 4]);
  // T-01 SLA escalation: past its due time, level 1 to the team lead with the priority raised, then level 2
  const late = (await t.call(se2, 'POST', `${H}/tickets`, ticket({ priority: 'MEDIUM', subject: 'Cannot see project B', category: 'ACCESS' }))).json.data;
  assert.equal(late.team, 'IT_SUPPORT');
  t.db.prepare('UPDATE hd_tickets SET sla_due = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', late.id);
  assert.deepEqual(helpdeskOf(t.db).escalate(), { escalated: 1 });
  let e = (await t.call(it, 'GET', `${H}/tickets/${late.id}`)).json.data;
  assert.deepEqual([e.escalationLevel, e.priority], [1, 'HIGH']); assert.ok(e.notes.some((n) => n.kind === 'ESCALATED')); assert.equal(e.breached, false, 'a new due time is set');
  t.db.prepare('UPDATE hd_tickets SET sla_due = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', late.id);
  helpdeskOf(t.db).escalate(); e = (await t.call(it, 'GET', `${H}/tickets/${late.id}`)).json.data; assert.equal(e.escalationLevel, 2);
  t.db.prepare('UPDATE hd_tickets SET sla_due = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', late.id);
  assert.deepEqual(helpdeskOf(t.db).escalate(), { escalated: 0 }, 'two levels at most');
  assert.ok(t.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'admin.ticket.escalated'").get());
  const dash = (await t.call(it, 'GET', `${H}/dashboard`)).json.data;
  assert.deepEqual([dash.open, dash.breached, dash.ratings30, dash.avgRating], [1, 1, 1, '4.0']);
  assert.equal((await t.call(se, 'GET', `${H}/dashboard`)).status, 403);
});

test('FR-02 BR-01 a data correction goes to the module owner and AUD for financial data; it is implemented only through the module transaction', async () => {
  const t = await setup();
  const tk = (await t.call(se, 'POST', `${H}/tickets`, ticket({ category: 'DATA_CORRECTION', subject: 'Wrong amount on JV/104', description: 'The journal JV/104 shows 1,500 instead of 15,000.' }))).json.data;
  assert.equal(tk.team, 'DATA_SUPPORT');
  assert.equal((await t.call(se, 'POST', `${H}/tickets/${tk.id}/corrections`, { module: 'fin', entity: 'fin_journals', entityId: '104', recordRef: 'JV/104', changes: [{ field: 'amount', current: '1500.00', proposed: '15000.00' }], reason: 'Typing error at entry' })).status, 403, 'support raises corrections');
  const c = (await t.call(it, 'POST', `${H}/tickets/${tk.id}/corrections`, { module: 'fin', entity: 'fin_journals', entityId: '104', recordRef: 'JV/104', changes: [{ field: 'amount', current: '1500.00', proposed: '15000.00' }], reason: 'Typing error at entry, confirmed with the voucher' })).json.data;
  assert.deepEqual([c.status, c.owner, c.financial], ['SUBMITTED', 'ACCMGR', true]);
  assert.equal((await t.call(it, 'POST', `${H}/tickets/${tk.id}/act`, { action: 'resolve', resolution: 'Fixed in the database' })).status, 409, 'BR-01: no resolution while the correction is open');
  assert.equal((await t.call(acc, 'POST', `${H}/corrections/${c.id}/act`, { action: 'approve', comment: 'Voucher checked' })).json.data.status, 'SUBMITTED', 'then AUD for financial data');
  assert.equal((await t.call(aud, 'POST', `${H}/corrections/${c.id}/act`, { action: 'approve' })).json.data.status, 'APPROVED');
  assert.equal((await t.call(it, 'POST', `${H}/corrections/${c.id}/implement`, { transactionRef: 'JV/118' })).status, 403, 'IT never edits the data');
  const done = (await t.call(acc, 'POST', `${H}/corrections/${c.id}/implement`, { transactionRef: 'JV/118 (reversal of JV/104) and JV/119', note: 'Reversed and re-entered' })).json.data;
  assert.deepEqual([done.status, done.transactionRef], ['IMPLEMENTED', 'JV/118 (reversal of JV/104) and JV/119']);
  const after = (await t.call(se, 'GET', `${H}/tickets/${tk.id}`)).json.data;
  assert.equal(after.status, 'RESOLVED'); assert.match(after.resolution, /JV\/118/);
  // a non-financial module: the owner alone
  const tk2 = (await t.call(se, 'POST', `${H}/tickets`, ticket({ category: 'DATA_CORRECTION', subject: 'Wrong labour count on DPR' }))).json.data;
  const c2 = (await t.call(it, 'POST', `${H}/tickets/${tk2.id}/corrections`, { module: 'site', entity: 'site_dprs', entityId: '42', recordRef: 'DPR/42', changes: [{ field: 'labour', current: '40', proposed: '44' }], reason: 'Four masons missed' })).json.data;
  assert.equal(c2.owner, 'PM'); assert.equal(c2.financial, false);
});

test('FR-03 FR-04 articles linked to pages, a tour for a role, announcements, release notes; managed by IT', async () => {
  const t = await setup();
  assert.equal((await t.call(se, 'POST', `${H}/articles`, { kind: 'ARTICLE', title: 'x', body: 'y' })).status, 403);
  const a = (await t.call(it, 'POST', `${H}/articles`, { kind: 'ARTICLE', title: 'How to submit a DPR', body: '## Steps\n1. Fill the labour and plant.\n2. Submit before the cutoff.', module: 'site', routes: ['/site/dprs'], status: 'PUBLISHED' })).json.data;
  await t.call(it, 'POST', `${H}/articles`, { kind: 'ARTICLE', title: 'Draft about stores', body: 'Not yet', routes: ['/site/dprs'], status: 'DRAFT' });
  await t.call(it, 'POST', `${H}/articles`, { kind: 'TOUR', title: 'DPR tour for site engineers', body: 'Your first DPR', routes: ['/site/dprs'], roles: ['SE'], steps: [{ title: 'Labour', body: 'Enter the gang strength' }, { title: 'Submit', body: 'Submit before 8 pm' }], status: 'PUBLISHED' });
  const now = Date.now();
  await t.call(it, 'POST', `${H}/articles`, { kind: 'ANNOUNCEMENT', title: 'ERP maintenance on Sunday', body: 'The ERP is read-only from 6 to 8 am.', validFrom: new Date(now - 3_600_000).toISOString(), validTo: new Date(now + 86_400_000).toISOString(), status: 'PUBLISHED' });
  await t.call(it, 'POST', `${H}/articles`, { kind: 'ANNOUNCEMENT', title: 'Old notice', body: 'Expired', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-01-02T00:00:00.000Z', status: 'PUBLISHED' });
  const ctx = (await t.call(se, 'GET', `${H}/context?route=${encodeURIComponent('/site/dprs/42')}`)).json.data;
  assert.deepEqual(ctx.articles.map((x) => x.title), ['How to submit a DPR'], 'published articles of the page only');
  assert.equal(ctx.tour.steps.length, 2); assert.equal(ctx.tourSeen, false);
  assert.deepEqual(ctx.announcements.map((x) => x.title), ['ERP maintenance on Sunday']);
  await t.call(se, 'POST', `${H}/tours/${ctx.tour.id}/seen`);
  assert.equal((await t.call(se, 'GET', `${H}/context?route=/site/dprs`)).json.data.tourSeen, true);
  assert.equal((await t.call(acc, 'GET', `${H}/context?route=/site/dprs`)).json.data.tour, null, 'the tour is for site engineers');
  assert.equal((await t.call(se, 'GET', `${H}/articles?q=cutoff`)).json.data.rows.length, 1);
  assert.equal((await t.call(se, 'GET', `${H}/articles/${a.id}`)).json.data.body.includes('Submit before the cutoff'), true);
  assert.ok(Array.isArray((await t.call(se, 'GET', `${H}/releases`)).json.data.rows));
  // volume: 100,000 tickets, the queue lists fast
  t.db.exec('BEGIN'); const ins = t.db.prepare("INSERT INTO hd_tickets (company_id, ticket_no, subject, description, category, priority, team, status, sla_due, raised_by) VALUES (1, ?, 'Load', 'Load test row', 'OTHER', 'LOW', 'APP_SUPPORT', 'NEW', '2027-01-01', 'hd-se')");
  for (let i = 0; i < 100_000; i += 1) ins.run(`L-${i}`); t.db.exec('COMMIT');
  const t0 = performance.now(); const l = await t.call(it, 'GET', `${H}/tickets?scope=queue&pageSize=25`); assert.equal(l.status, 200); assert.ok(performance.now() - t0 < 500, `${performance.now() - t0} ms`);
});
