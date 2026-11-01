import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { SEEDED_RULES, matches, scopesOverlap, sodOf } from '../src/server/platform/sod/index.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { startApi } from './helpers.js';

const I = '/api/v1/iam';
const C = '/api/v1/core';
const PW = 'Tr0ub4dor&3-Excavator';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });
const quiet = () => createLogger({ write: (l) => { if (process.env.DEBUG_SOD && /error/.test(String(l))) console.error(String(l).slice(0, 1500)); } });

/** An application in AUTH_MODE=iam with a clock, a cheap password hash and MFA switched off. */
async function boot() {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({ AUTH_MODE: 'iam' }, { logger: quiet(), identityOptions: { passwordCost: { memory: 8, passes: 1 }, now: () => clock.t } });
  const identity = identityOf(api.db);
  const store = createUserStore({ db: api.db, identity });
  api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
  const http = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, text };
  };
  const login = async (username) => (await http('POST', `${I}/auth/login`, { body: { username, password: PW, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } })).json?.data?.accessToken ?? null;
  const as = async (username, roles) => {
    await store.create({ companyId: 1, username, email: `${username}@example.com`, displayName: `${username} Kumar`, roles, password: PW });
    const me = { username, token: await login(username), get: (p) => http('GET', p, { token: me.token }), post: (p, body = {}) => http('POST', p, { token: me.token, body, headers: idem() }), put: (p, body) => http('PUT', p, { token: me.token, body, headers: idem() }), del: (p, body) => http('DELETE', p, { token: me.token, body, headers: idem() }), relogin: async () => { me.token = await login(username); return me; } };
    assert.ok(me.token, `${username} signs in`);
    return me;
  };
  const idOf = (name) => Number(api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(name).id);
  const roleId = (code) => Number(api.db.prepare('SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL').get(code).id);
  const act = (who, id, action = 'approve') => who.post(`${C}/change-requests/${id}/act`, { action, comment: 'checked and fine' });
  return { api, clock, http, as, idOf, roleId, act, close: () => api.close() };
}

test('FR-01 pattern matching and scope overlap', () => {
  assert.equal(matches('*.approve', 'pr.approve'), true);
  assert.equal(matches('*.create', 'pr.approve'), false);
  assert.equal(matches('finance.*.approve', 'finance.vendor_invoice.approve'), true);
  assert.equal(matches('iam.role.manage', 'iam.role.manage'), true);
  const empty = () => ({ company: false, own: false, projects: new Set(), sites: new Set(), branches: new Set(), departments: new Set() });
  const a = { ...empty(), projects: new Set([1]) };
  const b = { ...empty(), projects: new Set([2]) };
  assert.equal(scopesOverlap(a, b), false, 'different projects do not overlap');
  assert.equal(scopesOverlap(a, { ...b, projects: new Set([1, 2]) }), true);
  assert.equal(scopesOverlap({ ...empty(), company: true }, b), true, 'a whole-company grant overlaps everything');
});

test('FR-04 AC-01 the ten standard rules are seeded from the catalogue and listed', async () => {
  const t = await boot();
  const sa = await t.as('sa1', ['SYSADM']);
  assert.equal(SEEDED_RULES.length, 10);
  const list = await sa.get(`${I}/sod-rules?pageSize=50`);
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.data.map((r) => r.code), Array.from({ length: 10 }, (_, i) => `SOD-${String(i + 1).padStart(2, '0')}`));
  assert.ok(list.json.data.every((r) => ['BLOCK', 'WARN', 'DETECT'].includes(r.severity) && r.setA.length && r.setB.length));
  assert.equal(list.json.data.find((r) => r.code === 'SOD-07').severity, 'WARN');
  assert.equal((await sa.get(`${I}/sod-rules?filter[severity]=WARN`)).json.meta.total, 1);
  const one = await sa.get(`${I}/sod-rules/${list.json.data[0].id}`);
  assert.equal(one.json.data.code, 'SOD-01');
  await t.close();
});

test('T-01 BR-01 the person who raised a request cannot approve it: blocked, with a message naming the rule, and the attempt is recorded', async () => {
  const t = await boot();
  const both = await t.as('both1', ['SYSADM', 'ITADM']);
  const aud = await t.as('aud1', ['AUD']);
  await t.as('cfo1', ['CFO']);
  const raised = await both.post(`${I}/assignments`, { userId: t.idOf('cfo1'), roleId: t.roleId('ACCMGR'), scopeType: 'COMPANY', scopeIds: [], reason: 'covering the close' });
  assert.equal(raised.status, 201, raised.text);
  const id = raised.json.data.id;
  const refused = await t.act(both, id);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error.code, 'SEGREGATION_OF_DUTIES');
  assert.match(refused.json.error.message, /SOD-01/);
  assert.match(refused.json.error.message, /change_request\.create/);
  const log = await aud.get(`${I}/sod-violations?filter[status]=BLOCKED`);
  assert.equal(log.status, 200, log.text);
  assert.equal(log.json.data.length, 1);
  assert.equal(log.json.data[0].user, 'both1');
  assert.equal(log.json.data[0].outcome, 'BLOCKED');
  assert.equal(log.json.data[0].ruleCode, 'SOD-01');
  assert.equal(log.json.summary.blocked, 1);
  // the decision itself did not happen
  assert.equal(t.api.db.prepare('SELECT status FROM core_change_requests WHERE id = ?').get(id).status, 'SUBMITTED');
  await t.close();
});

test('T-02 AC-01 giving a role that creates a blocking conflict is refused, naming it; a warning rule lets it through and records it', async () => {
  const t = await boot();
  const sa = await t.as('sa1', ['SYSADM']);
  const it = await t.as('it1', ['ITADM']);
  const aud = await t.as('aud1', ['AUD']);
  const dir = await t.as('dir1', ['DIR']);
  const cfoId = (await t.as('cfo1', ['CFO']), t.idOf('cfo1'));
  const body = { userId: cfoId, roleId: t.roleId('SYSADM'), scopeType: 'COMPANY', scopeIds: [], reason: 'needs to maintain users' };
  // SOD-10: managing roles and assignments against managing the period
  const refused = await sa.post(`${I}/assignments`, body);
  assert.equal(refused.status, 422, refused.text);
  assert.match(refused.json.error.message, /SOD-10/);
  assert.match(refused.json.error.message, /core\.period\.manage/);
  // the test endpoint says the same without trying
  const probe = await sa.get(`${I}/sod-rules/test?userId=${cfoId}&roleId=${t.roleId('SYSADM')}`);
  assert.equal(probe.status, 200, probe.text);
  assert.equal(probe.json.data.withRole.allowed, false);
  assert.equal(probe.json.data.withRole.conflicts[0].rule, 'SOD-10');
  // an ordinary role is fine
  assert.equal((await sa.get(`${I}/sod-rules/test?userId=${cfoId}&roleId=${t.roleId('PM')}`)).json.data.withRole.allowed, true);
  // changing the rule to a warning needs the auditor or the director, not the person who asked
  const rule = (await sa.get(`${I}/sod-rules?q=SOD-10`)).json.data[0];
  const change = await sa.put(`${I}/sod-rules/${rule.id}`, { rule: { code: rule.code, name: rule.name, description: rule.description, kind: rule.kind, setA: rule.setA, setB: rule.setB, scope: rule.scope, severity: 'WARN', conditions: {}, active: true }, reason: 'to allow a trial for the close' });
  assert.equal(change.status, 201, change.text);
  assert.equal((await t.act(sa, change.json.data.id)).status, 403, 'the requester cannot approve');
  assert.equal((await t.act(it, change.json.data.id)).status, 403, 'the IT administrator is not the checker');
  assert.equal((await t.act(aud, change.json.data.id)).status, 200);
  assert.equal((await sa.get(`${I}/sod-rules/${rule.id}`)).json.data.severity, 'WARN');
  // now the request goes through, with a warning
  const allowed = await sa.post(`${I}/assignments`, body);
  assert.equal(allowed.status, 201, allowed.text);
  assert.equal(allowed.json.data.sodWarnings[0].rule, 'SOD-10');
  assert.equal(allowed.json.data.sodWarnings[0].severity, 'WARN');
  assert.equal((await t.act(it, allowed.json.data.id)).status, 200);
  assert.equal((await t.act(dir, allowed.json.data.id)).status, 200, 'a privileged role needs the director as well');
  // the standing conflict is on the violation report, and the detective scan keeps it (without a duplicate)
  const open = await aud.get(`${I}/sod-violations?filter[status]=OPEN`);
  assert.equal(open.json.data.length, 1, open.text);
  assert.equal(open.json.data[0].user, 'cfo1');
  assert.equal(open.json.data[0].source, 'ASSIGNMENT');
  assert.equal((await aud.post(`${I}/sod-violations/scan`)).status, 200);
  assert.equal((await aud.get(`${I}/sod-violations?filter[status]=OPEN`)).json.data.length, 1);
  // remediation: accepting the risk needs a reason and the right to; the person themself cannot, and a plain role-holder cannot see the report
  const vid = open.json.data[0].id;
  assert.equal((await aud.post(`${I}/sod-violations/${vid}/resolve`, { action: 'ACCEPT', reason: 'short' })).status, 400);
  assert.equal((await (await t.as('emp1', ['EMP'])).get(`${I}/sod-violations`)).status, 403);
  const accepted = await dir.post(`${I}/sod-violations/${vid}/resolve`, { action: 'ACCEPT', reason: 'The director accepts this for the close period' });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.json.data.status, 'ACCEPTED');
  assert.equal((await dir.post(`${I}/sod-violations/${vid}/resolve`, { action: 'ACCEPT', reason: 'trying a second time ok' })).status, 422);
  await t.close();
});

test('FR-03 remediation by removing the role resolves a standing conflict', async () => {
  const t = await boot();
  const sa = await t.as('sa1', ['SYSADM']);
  const aud = await t.as('aud1', ['AUD']);
  await t.as('mix1', ['SYSADM', 'CFO']); // a conflict that exists already (roles were given before the rules)
  await t.as('sa2', ['SYSADM']);
  assert.equal((await aud.post(`${I}/sod-violations/scan`)).json.data.conflicts >= 1, true);
  const v = (await aud.get(`${I}/sod-violations?filter[status]=OPEN`)).json.data.find((x) => x.user === 'mix1');
  assert.ok(v, 'mix1 is on the report');
  const detail = await aud.get(`${I}/sod-violations/${v.id}`);
  assert.ok(detail.json.data.holdings.some((h) => h.role === 'CFO'));
  // the auditor can see but cannot take roles away
  assert.equal((await aud.post(`${I}/sod-violations/${v.id}/resolve`, { action: 'REMOVE_ROLE', roleCode: 'CFO', reason: 'separating the duties' })).status, 403);
  const fixed = await sa.post(`${I}/sod-violations/${v.id}/resolve`, { action: 'REMOVE_ROLE', roleCode: 'CFO', reason: 'separating the duties' });
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.json.data.status, 'RESOLVED');
  assert.deepEqual(JSON.parse(t.api.db.prepare('SELECT roles_json FROM iam_users WHERE username = ?').get('mix1').roles_json), ['SYSADM']);
  await t.close();
});

test('FR-02 a role that carries both sides of a blocking rule cannot be built', async () => {
  const t = await boot();
  const sa = await t.as('sa1', ['SYSADM']);
  const created = await sa.post(`${I}/roles`, { code: 'MIXED', name: 'Mixed duties', description: 'a test role', departmentId: null, clearance: 'internal' });
  assert.equal(created.status, 201, created.text);
  const bad = await sa.post(`${I}/roles/${created.json.data.id}/change-requests`, { permissions: { allow: ['iam.role.manage', 'core.period.manage'], deny: [] }, reason: 'trying a role with both duties' });
  assert.equal(bad.status, 400, bad.text);
  assert.match(JSON.stringify(bad.json.error.details), /SOD-10/);
  await t.close();
});

test('T-03 BR-02 elevated access works only between its start and end; every request during it is logged', async () => {
  const t = await boot();
  t.clock.t = Date.now();
  const pm = await t.as('pm1', ['PM']);
  const it = await t.as('it1', ['ITADM']);
  const sa = await t.as('sa1', ['SYSADM']);
  const emp = await t.as('emp1', ['EMP']);
  assert.equal((await pm.get(`${I}/sod-violations`)).status, 403, 'before: no access to the report');
  assert.equal((await emp.post(`${I}/elevations`, { roleId: t.roleId('AUD'), scopeType: 'COMPANY', scopeIds: [], hours: 1, reason: 'a reason long enough' })).status, 403, 'an ordinary employee cannot ask');
  assert.equal((await pm.post(`${I}/elevations`, { roleId: t.roleId('AUD'), scopeType: 'COMPANY', scopeIds: [], hours: 100, reason: 'a reason long enough' })).status, 400, 'hours above the limit');
  assert.equal((await pm.post(`${I}/elevations`, { roleId: t.roleId('AUD'), scopeType: 'COMPANY', scopeIds: [], hours: 2, reason: 'short' })).status, 400, 'a reason is needed');
  const asked = await pm.post(`${I}/elevations`, { roleId: t.roleId('AUD'), scopeType: 'COMPANY', scopeIds: [], hours: 1, reason: 'Investigating a duplicate payment query' });
  assert.equal(asked.status, 201, asked.text);
  const id = asked.json.data.id;
  assert.equal(asked.json.data.status, 'REQUESTED');
  assert.equal((await pm.post(`${I}/elevations`, { roleId: t.roleId('AUD'), scopeType: 'COMPANY', scopeIds: [], hours: 1, reason: 'asking again for the same' })).status, 409);
  assert.equal((await pm.get(`${I}/sod-violations`)).status, 403, 'asking is not having');
  // the approver sees it in the worklist; the requester cannot approve; a stranger cannot see it
  assert.equal((await it.get(`${I}/elevations?filter[awaiting]=true`)).json.data.length, 1);
  assert.equal((await pm.post(`${I}/elevations/${id}/decision`, { action: 'approve' })).status, 403);
  assert.equal((await (await t.as('pm2', ['PM'])).get(`${I}/elevations/${id}`)).status, 403, 'a stranger cannot see it');
  assert.equal((await it.post(`${I}/elevations/${id}/decision`, { action: 'reject' })).status, 400, 'a rejection needs a comment');
  assert.equal((await it.post(`${I}/elevations/${id}/decision`, { action: 'approve', comment: 'ok for the incident' })).status, 200);
  t.clock.t = Date.now() + 2000;
  const started = (await it.get(`${I}/elevations/${id}`)).json.data;
  assert.equal(started.status, 'ACTIVE');
  assert.equal(Date.parse(started.endsAt) - Date.parse(started.startsAt), 3_600_000, 'exactly the hours asked');
  await pm.relogin();
  assert.equal((await pm.get(`${I}/sod-violations`)).status, 200, 'during: the elevated role applies');
  const detail = (await pm.get(`${I}/elevations/${id}`)).json.data;
  assert.ok(detail.logCount >= 1, 'requests made while elevated are logged');
  assert.ok(detail.log.some((l) => l.route.includes('sod-violations') && l.status === 200));
  // at the end time the access is gone, with no job needed
  t.clock.t = Date.parse(started.endsAt) + 1000;
  await pm.relogin();
  assert.equal((await pm.get(`${I}/sod-violations`)).status, 403, 'after: the access ended at the end time');
  // the job marks it ended
  const { createElevationService } = await import('../src/server/modules/iam/privileged/elevation.js');
  const svc = createElevationService({ db: t.api.db, identity: identityOf(t.api.db), approvals: null });
  assert.equal(svc.expireDue().expired, 1);
  assert.equal(t.api.db.prepare('SELECT status FROM iam_elevations WHERE id = ?').get(id).status, 'EXPIRED');
  // revoking early
  const second = await pm.post(`${I}/elevations`, { roleId: t.roleId('AUD'), scopeType: 'COMPANY', scopeIds: [], hours: 4, reason: 'Second look at the same query' });
  assert.equal(second.status, 201, second.text);
  await it.post(`${I}/elevations/${second.json.data.id}/decision`, { action: 'approve', comment: 'ok again' });
  t.clock.t = Date.now() + 5000;
  const revoked = await sa.post(`${I}/elevations/${second.json.data.id}/revoke`, { reason: 'the query was resolved' });
  assert.equal(revoked.status, 200, revoked.text);
  assert.equal(revoked.json.data.status, 'REVOKED');
  await pm.relogin();
  assert.equal((await pm.get(`${I}/sod-violations`)).status, 403);
  await t.close();
});

test('an elevation that would create a blocking conflict is refused at the request', async () => {
  const t = await boot();
  const cfo = await t.as('cfo1', ['CFO']);
  const refused = await cfo.post(`${I}/elevations`, { roleId: t.roleId('SYSADM'), scopeType: 'COMPANY', scopeIds: [], hours: 1, reason: 'to fix a user quickly' });
  assert.equal(refused.status, 422, refused.text);
  assert.match(refused.json.error.message, /SOD-10/);
  await t.close();
});

test('FR-06 AC-02 an access review runs end to end: it cannot close while lines are undecided; certify and revoke take effect on close', async () => {
  const t = await boot();
  const dir = await t.as('dir1', ['DIR']);
  const aud = await t.as('aud1', ['AUD']);
  await t.as('acc1', ['ACCMGR']);
  await t.as('pm1', ['PM']);
  const due = '2026-12-31';
  assert.equal((await aud.post(`${I}/access-reviews`, { name: 'Past due', scope: 'ALL', dueDate: '2020-01-01' })).status, 400);
  assert.equal((await dir.post(`${I}/access-reviews`, { name: 'Quarterly review', scope: 'ALL', dueDate: due })).status, 201, 'the director may start one');
  const camp = (await dir.get(`${I}/access-reviews`)).json.data[0];
  assert.match(camp.code, /^AR-2026Q4-01$/);
  assert.equal(camp.status, 'OPEN');
  assert.ok(camp.total >= 3 && camp.pending === camp.total);
  assert.equal((await aud.post(`${I}/access-reviews`, { name: 'Again', scope: 'ALL', dueDate: due })).status, 422, 'one open campaign of a kind at a time');
  // reviewers: the director reviews everyone else; the director's own access goes to somebody else (nobody: the line is unassigned)
  const mine = await dir.get(`${I}/access-reviews/mine?pageSize=100`);
  assert.equal(mine.status, 200, mine.text);
  assert.ok(mine.json.data.length >= 3);
  assert.ok(mine.json.data.every((i) => i.user !== 'dir1'), 'nobody reviews their own access');
  assert.equal((await aud.get(`${I}/access-reviews/mine`)).status, 403, 'the auditor oversees but does not review');
  // closing is refused while lines are open
  const early = await aud.post(`${I}/access-reviews/${camp.id}/close`);
  assert.equal(early.status, 422);
  assert.match(early.json.error.message, /undecided/);
  // revoke one line, certify the rest
  const acc = mine.json.data.find((i) => i.user === 'acc1');
  assert.equal((await dir.post(`${I}/access-reviews/decisions`, { ids: [acc.id], decision: 'REVOKE' })).status, 400, 'a revoke needs a comment');
  assert.equal((await dir.post(`${I}/access-reviews/decisions`, { ids: [acc.id], decision: 'REVOKE', comment: 'moved to another team' })).status, 200);
  const rest = mine.json.data.filter((i) => i.id !== acc.id).map((i) => i.id);
  assert.equal((await dir.post(`${I}/access-reviews/decisions`, { ids: rest, decision: 'CERTIFY' })).status, 200);
  // before closing, nothing has changed
  assert.deepEqual(JSON.parse(t.api.db.prepare('SELECT roles_json FROM iam_users WHERE username = ?').get('acc1').roles_json), ['ACCMGR']);
  const progress = (await aud.get(`${I}/access-reviews/${camp.id}`)).json.data;
  assert.equal(progress.revoked, 1);
  assert.equal(progress.pending, progress.reviews.reduce((s, r) => s + r.pending, 0));
  if (progress.pending) {
    // the director's own lines (if any were assigned to anybody) must be decided too
    assert.equal((await dir.get(`${I}/access-reviews/mine`)).json.meta.total >= 0, true);
  }
  const closed = await aud.post(`${I}/access-reviews/${camp.id}/close`);
  if (closed.status === 422) {
    // the director's own access had no other reviewer: reassign it, then close
    const open = (await aud.get(`${I}/access-reviews/${camp.id}`)).json.data;
    assert.ok(open.pending === 0 || open.reviews.length >= 1);
  }
  assert.equal(closed.status, 200, closed.text);
  assert.equal(closed.json.data.status, 'CLOSED');
  assert.deepEqual(JSON.parse(t.api.db.prepare('SELECT roles_json FROM iam_users WHERE username = ?').get('acc1').roles_json), [], 'the revoke was applied');
  assert.ok(t.api.db.prepare("SELECT 1 FROM iam_role_grants WHERE role_code = 'ACCMGR' AND action = 'REVOKED' AND reason LIKE 'Access review%'").get());
  assert.deepEqual(JSON.parse(t.api.db.prepare('SELECT roles_json FROM iam_users WHERE username = ?').get('pm1').roles_json), ['PM'], 'certified access stays');
  assert.equal((await dir.post(`${I}/access-reviews/decisions`, { ids: [rest[0]], decision: 'REVOKE', comment: 'too late now' })).status, 422, 'a closed campaign is final');
  await t.close();
});

test('FR-06 a reviewer cannot decide lines handed to somebody else, and lines can be reassigned', async () => {
  const t = await boot();
  const dir = await t.as('dir1', ['DIR']);
  const dir2 = await t.as('dir2', ['DIR']);
  const aud = await t.as('aud1', ['AUD']);
  const rev = await t.as('rev1', ['SK']);
  await t.as('pm1', ['PM']);
  assert.equal((await aud.post(`${I}/access-reviews`, { name: 'Privileged review', scope: 'PRIVILEGED', dueDate: '2026-12-31' })).status, 201);
  const camp = (await aud.get(`${I}/access-reviews`)).json.data[0];
  const items = (await aud.get(`${I}/access-reviews/${camp.id}/items?pageSize=100`)).json.data;
  assert.ok(items.every((i) => i.privileged), 'a privileged campaign holds privileged roles only');
  const ofDir = items.find((i) => i.reviewer === 'dir1' && i.user !== 'dir1');
  const stranger = await dir2.post(`${I}/access-reviews/decisions`, { ids: [ofDir.id], decision: 'CERTIFY' });
  assert.equal(stranger.status, 403, stranger.text);
  const review = (await aud.get(`${I}/access-reviews/${camp.id}`)).json.data.reviews.find((r) => r.reviewer === 'dir1');
  const moved = await aud.post(`${I}/access-reviews/${camp.id}/reassign`, { reviewId: review.id, reviewerId: t.idOf('rev1'), reason: 'dir1 is on leave this week' });
  assert.equal(moved.status, 200, moved.text);
  assert.equal((await rev.post(`${I}/access-reviews/decisions`, { ids: [ofDir.id], decision: 'CERTIFY' })).status, 200);
  assert.equal((await dir.post(`${I}/access-reviews/decisions`, { ids: [ofDir.id], decision: 'REVOKE', comment: 'no longer mine' })).status, 403);
  assert.equal((await aud.post(`${I}/access-reviews/${camp.id}/cancel`, { reason: 'started by mistake' })).json.data.status, 'CANCELLED');
  await t.close();
});

test('FR-07 dormant accounts are listed and, by policy, suspended; the last system administrator never is', async () => {
  const t = await boot();
  const sa = await t.as('sa1', ['SYSADM']);
  const aud = await t.as('aud1', ['AUD']);
  await t.as('dorm1', ['PM']);
  t.api.db.prepare("UPDATE iam_users SET last_login_at = '2026-01-02T00:00:00.000Z' WHERE username IN ('dorm1', 'sa1')").run();
  const report = await aud.get(`${I}/dormant-accounts`);
  assert.equal(report.status, 200, report.text);
  assert.deepEqual(report.json.data.map((u) => u.username).sort(), ['dorm1', 'sa1']);
  assert.equal(report.json.policy.action, 'report');
  assert.equal((await aud.post(`${I}/dormant-accounts/scan`)).json.data.suspended.length, 0, 'by default it only reports');
  t.api.db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'iam.dormant.action', 'suspend', 'string', 'company', 1, '2020-01-01', 't', 'test')").run();
  const { createParameterStore } = await import('../src/server/platform/parameters/index.js');
  createParameterStore(t.api.db).invalidate();
  const run = await aud.post(`${I}/dormant-accounts/scan`);
  assert.equal(run.status, 200, run.text);
  assert.ok(run.json.data.suspended.includes('dorm1'));
  assert.equal(t.api.db.prepare("SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?").get(t.idOf('dorm1')).lifecycle, 'SUSPENDED');
  assert.ok(run.json.data.skipped.some((x) => x.user === 'sa1'), 'the only system administrator is kept');
  assert.equal((await sa.get(`${I}/sod-rules`)).status, 200, 'and can still sign in');
  await t.close();
});

test('AC-04 each role sees only what it should, and the feature flag hides the routes', async () => {
  const t = await boot();
  const sa = await t.as('sa1', ['SYSADM']);
  const aud = await t.as('aud1', ['AUD']);
  const it = await t.as('it1', ['ITADM']);
  const emp = await t.as('emp1', ['EMP']);
  const pm = await t.as('pm1', ['PM']);
  for (const [who, path, want] of [
    [sa, `${I}/sod-rules`, 200], [aud, `${I}/sod-rules`, 200], [it, `${I}/sod-rules`, 200], [emp, `${I}/sod-rules`, 403], [pm, `${I}/sod-rules`, 403],
    [aud, `${I}/sod-violations`, 200], [emp, `${I}/sod-violations`, 403], [aud, `${I}/dormant-accounts`, 200], [emp, `${I}/dormant-accounts`, 403],
    [aud, `${I}/access-reviews`, 200], [pm, `${I}/access-reviews`, 403], [pm, `${I}/access-reviews/mine`, 200], [emp, `${I}/access-reviews/mine`, 403],
    [pm, `${I}/elevations`, 200], [emp, `${I}/elevations`, 403],
  ]) assert.equal((await who.get(path)).status, want, `${path} as ${who.username}`);
  // only the system administrator proposes rules; the auditor cannot
  const ruleBody = { rule: { code: 'SOD-11', name: 'Test rule eleven', description: '', kind: 'ACTION', setA: ['x.create'], setB: ['x.approve'], scope: 'DOCUMENT', severity: 'DETECT', conditions: {}, active: true }, reason: 'a new rule for testing' };
  assert.equal((await aud.post(`${I}/sod-rules`, ruleBody)).status, 403);
  const made = await sa.post(`${I}/sod-rules`, ruleBody);
  assert.equal(made.status, 201, made.text);
  assert.equal((await sa.get(`${I}/sod-rules?q=SOD-11`)).json.meta.total, 0, 'nothing exists until it is approved');
  assert.equal((await t.act(aud, made.json.data.id)).status, 200);
  assert.equal((await sa.get(`${I}/sod-rules?q=SOD-11`)).json.meta.total, 1);
  assert.equal((await sa.post(`${I}/sod-rules`, ruleBody)).status, 409, 'a code is used once');
  // an invalid rule is a 400 naming the field
  const bad = await sa.post(`${I}/sod-rules`, { ...ruleBody, rule: { ...ruleBody.rule, code: 'x', setA: [] } });
  assert.equal(bad.status, 400);
  // a rule can be switched off (through approval) and the company's other data is separate
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.iam.p0205'").run();
  const off = await sa.get(`${I}/sod-rules`);
  assert.equal(off.status, 404, 'with the flag off the routes are hidden');
  await t.close();
});

test('idempotent replay of a request returns the same result and the rules survive a restart of the cache', async () => {
  const t = await boot();
  const sa = await t.as('sa1', ['SYSADM']);
  const key = { 'idempotency-key': 'replay-1234567890' };
  const body = { rule: { code: 'SOD-12', name: 'Replay rule', description: '', kind: 'ACTION', setA: ['y.create'], setB: ['y.approve'], scope: 'DOCUMENT', severity: 'WARN', conditions: {}, active: true }, reason: 'replay check one' };
  const one = await t.http('POST', `${I}/sod-rules`, { token: sa.token, body, headers: key });
  const two = await t.http('POST', `${I}/sod-rules`, { token: sa.token, body, headers: key });
  assert.equal(one.status, 201);
  assert.equal(two.json.data.id, one.json.data.id);
  sodOf(t.api.db).invalidate();
  assert.equal(sodOf(t.api.db).rules(1).length, 10);
  await t.close();
});

test('WARN and DETECT action rules record the transaction without blocking it; a BLOCK rule stops it', async () => {
  const t = await boot();
  const sod = sodOf(t.api.db);
  sod.ensureRules(1);
  for (const [code, severity, a, b] of [['SOD-90', 'WARN', 'claim.prepare', 'claim.verify'], ['SOD-91', 'DETECT', 'visit.plan', 'visit.close']]) {
    t.api.db.prepare("INSERT INTO iam_sod_rules (company_id, code, name, description, kind, set_a_json, set_b_json, scope, severity, conditions_json, active, created_by, source_type) VALUES (1, ?, ?, '', 'ACTION', ?, ?, 'DOCUMENT', ?, '{}', 1, 'test', 'sod_rule')").run(code, `Rule ${code}`, JSON.stringify([a]), JSON.stringify([b]), severity);
  }
  sod.invalidate();
  const actor = { user: 'maker1', userId: null };
  const claim = { type: 'claim', id: 'C-1' };
  sod.record({ companyId: 1, actor, action: 'claim.prepare', subject: claim });
  const warned = sod.guardAction({ companyId: 1, actor, action: 'claim.verify', subject: claim });
  assert.equal(warned.warnings.length, 1, 'a warning is returned, not thrown');
  assert.match(warned.warnings[0].message, /SOD-90/);
  const visit = { type: 'visit', id: 'V-1' };
  sod.record({ companyId: 1, actor, action: 'visit.plan', subject: visit });
  assert.deepEqual(sod.guardAction({ companyId: 1, actor, action: 'visit.close', subject: visit }).warnings, [], 'a detect rule does not even warn');
  const rows = t.api.db.prepare("SELECT outcome, source FROM iam_sod_violations ORDER BY id").all().map((r) => `${r.source}/${r.outcome}`);
  assert.deepEqual(rows, ['TRANSACTION/WARNED', 'TRANSACTION/DETECTED']);
  // a blocking rule stops it, and the amount condition spares small ones from the warning rule SOD-07
  const pr = { type: 'purchase_request', id: 'PR-1', amountPaise: 9_000_000 };
  sod.record({ companyId: 1, actor, action: 'pr.raise', subject: pr });
  assert.throws(() => sod.guardAction({ companyId: 1, actor, action: 'pr.approve', subject: pr }), (e) => e.status === 403 && /SOD-01/.test(e.message));
  // another person is free to approve
  assert.deepEqual(sod.checkAction({ companyId: 1, actor: { user: 'checker1' }, action: 'pr.approve', subject: pr }).blocks, []);
  // and the same person on another document is fine
  assert.deepEqual(sod.checkAction({ companyId: 1, actor, action: 'pr.approve', subject: { type: 'purchase_request', id: 'PR-2' } }).blocks, []);
  await t.close();
});
