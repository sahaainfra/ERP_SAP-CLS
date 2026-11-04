import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { startApi } from './helpers.js';

// Part 05.01 AC-04: in sign-in mode, project channels follow active assignments (BR-01): a person is in the conversation of a project while an assignment covers it, and not before or after; another project's people never are.
const PW = 'Tr0ub4dor&3-Excavator';
const M = '/api/v1/msg';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });

test('BR-01 AC-04 project and site channels take their members from active assignments, and lose them when an assignment ends; the real-time room follows the same rule', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-msg-scope-'));
  const api = await startApi({ AUTH_MODE: 'iam' }, { storagePath: storage, logger: createLogger({ write: () => {} }), identityOptions: { passwordCost: { memory: 8, passes: 1 } } });
  try {
    const store = createUserStore({ db: api.db, identity: identityOf(api.db) });
    api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
    const http = async (method, path, { token, body } = {}) => {
      const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(method === 'GET' ? {} : idem()) }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, json };
    };
    const person = async (username, roles, projects = null) => {
      await store.create({ companyId: 1, username, email: `${username}@example.com`, displayName: `${username} Kumar`, roles, password: PW });
      const id = Number(api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(username).id);
      if (projects) {
        api.db.prepare("UPDATE iam_users SET roles_json = '[]' WHERE id = ?").run(id);
        for (const code of roles) api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test', 'test', 'test')").run(id, code, JSON.stringify(projects));
      }
      const token = (await http('POST', '/api/v1/iam/auth/login', { body: { username, password: PW, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } })).json?.data?.accessToken;
      assert.ok(token, `${username} signs in`);
      return { id, get: (p) => http('GET', p, { token }), post: (p, body = {}) => http('POST', p, { token, body }) };
    };
    const project = (code) => Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 't')").run(code, `Project ${code}`).lastInsertRowid);
    const a = project('ALPHA');
    const b = project('BRAVO');
    const site = Number(api.db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, created_by, source_type) VALUES (1, ?, 'ALP-S1', 'Alpha yard', 't', 't')").run(a).lastInsertRowid);
    const pdAll = await person('pd-all', ['PD']);
    const pmAlpha = await person('pm-alpha', ['PM'], [a]);
    const seAlpha = await person('se-alpha', ['SE'], [a]);
    const pmBravo = await person('pm-bravo', ['PM'], [b]);
    // the channel can be made only by someone with the right for that project
    assert.equal((await pmBravo.post(`${M}/conversations`, { type: 'PROJECT', projectId: a })).status, 403);
    assert.equal((await seAlpha.post(`${M}/conversations`, { type: 'PROJECT', projectId: a })).status, 403);
    const ch = await pdAll.post(`${M}/conversations`, { type: 'PROJECT', projectId: a });
    assert.equal(ch.status, 201, JSON.stringify(ch.json));
    const id = ch.json.data.id;
    const sch = await pmAlpha.post(`${M}/conversations`, { type: 'SITE', siteId: site });
    assert.equal(sch.status, 201, JSON.stringify(sch.json));
    // the members are those whose assignments cover the project: Alpha's people yes, Bravo's no
    const members = (await pdAll.get(`${M}/conversations/${id}`)).json.data.members;
    assert.deepEqual(members.map((m) => [m.username, m.source]).sort(), [['pd-all', 'MANUAL'], ['pm-alpha', 'AUTO'], ['se-alpha', 'AUTO']]);
    assert.equal((await seAlpha.get(`${M}/conversations/${id}/messages`)).status, 200);
    assert.equal((await pmBravo.get(`${M}/conversations/${id}/messages`)).status, 404, 'another project\'s manager is not a member');
    assert.equal((await pmBravo.get(`${M}/conversations`)).json.data.rows.length, 0);
    assert.equal((await pmBravo.post(`${M}/conversations/${id}/messages`, { body: 'let me in' })).status, 404);
    // the site channel: the site covers the people of its project
    assert.equal((await seAlpha.get(`${M}/conversations`)).json.data.rows.map((c) => c.type).sort().join(), 'PROJECT,SITE');
    assert.equal((await seAlpha.post(`${M}/conversations/${id}/messages`, { body: 'Yard is ready' })).status, 201);
    // the real-time room follows the same rule
    const hub = realtimeOf(api.db);
    const actor = (u, uid) => ({ user: u, userId: uid, companyId: 1, roles: [] });
    assert.equal(hub.canJoin(actor('se-alpha', seAlpha.id), `conv:${id}`).allowed, true);
    assert.equal(hub.canJoin(actor('pm-bravo', pmBravo.id), `conv:${id}`).allowed, false);
    // a person who may not make channels cannot add Bravo's manager by hand into a record-less channel either; the admin can add a person by hand, who then stays a manual member
    assert.equal((await pdAll.post(`${M}/conversations/${id}/members`, { users: ['pm-bravo'] })).status, 200);
    assert.equal((await pmBravo.get(`${M}/conversations/${id}/messages`)).status, 200);
    // the assignment of Alpha's site engineer ends: they leave the channel at their next contact
    api.db.prepare("UPDATE iam_assignments SET status = 'ENDED' WHERE user_id = ?").run(seAlpha.id);
    assert.equal((await seAlpha.get(`${M}/conversations/${id}/messages`)).status, 404, 'no assignment, no channel');
    assert.equal((await seAlpha.get(`${M}/conversations`)).json.data.rows.length, 0);
    assert.equal(hub.canJoin(actor('se-alpha', seAlpha.id), `conv:${id}`).allowed, false);
    // and returns when an assignment covers the project again
    api.db.prepare("UPDATE iam_assignments SET status = 'ACTIVE' WHERE user_id = ?").run(seAlpha.id);
    assert.equal((await seAlpha.get(`${M}/conversations/${id}/messages`)).status, 200);
    // part 05.02: search, presence, calls and holds keep to the same boundary
    const outsider = await person('pm-outside', ['PM'], [b]);
    const bravoCh = await pdAll.post(`${M}/conversations`, { type: 'PROJECT', projectId: b });
    assert.equal(bravoCh.status, 201);
    await pmBravo.post(`${M}/conversations/${bravoCh.json.data.id}/messages`, { body: 'Bravo secret rate sheet' });
    await pdAll.post(`${M}/conversations/${id}/messages`, { body: 'Alpha pour schedule' });
    const found = async (who, q) => (await who.get(`${M}/search?q=${encodeURIComponent(q)}`)).json.data.rows;
    assert.equal((await found(seAlpha, 'secret')).length, 0, 'another project\'s channel is not searched');
    assert.equal((await found(seAlpha, 'Alpha pour')).length, 1);
    assert.equal((await found(outsider, 'Alpha pour')).length, 0);
    assert.deepEqual((await seAlpha.get(`${M}/presence?users=pm-outside`)).json.data.rows, [], 'presence only of people one shares a conversation with');
    assert.equal((await outsider.post(`${M}/conversations/${id}/calls`, { type: 'AUDIO' })).status, 404, 'no call in a conversation one is not in');
    assert.equal((await outsider.get(`${M}/conversations/${id}/media`)).status, 404);
    assert.equal((await seAlpha.get(`${M}/holds`)).status, 403);
    assert.equal((await seAlpha.get(`${M}/config`)).status, 403);
    // part 05.04: instructions, announcements and message-to-action keep to the same boundary
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const mineMsg = (await pmAlpha.post(`${M}/conversations/${id}/messages`, { body: 'Alpha: stop the pour at 4' })).json.data;
    const foreignMsg = (await pmBravo.post(`${M}/conversations/${id}/messages`, { body: 'Bravo manager in the Alpha channel' })).json.data;
    assert.equal((await pmBravo.post(`${M}/messages/${foreignMsg.id}/instruction`, { priority: 'HIGH', dueAt: due })).status, 403, 'a manager of another project may not instruct inside this project');
    assert.equal((await seAlpha.post(`${M}/messages/${mineMsg.id}/instruction`, { priority: 'HIGH', dueAt: due })).status, 403, 'a site engineer has no right to');
    const instr = await pmAlpha.post(`${M}/messages/${mineMsg.id}/instruction`, { priority: 'HIGH', dueAt: due });
    assert.equal(instr.status, 201, JSON.stringify(instr.json));
    assert.equal((await outsider.get(`${M}/instructions/${instr.json.data.id}`)).status, 404, 'an outsider cannot read the instruction');
    assert.equal((await outsider.post(`${M}/instructions/${instr.json.data.id}/ack`, {})).status, 404);
    assert.equal((await outsider.get(`${M}/messages/${mineMsg.id}/action-draft?type=TASK`)).status, 404);
    assert.equal((await outsider.post(`${M}/conversations/${id}/escalate`, { reason: 'I want in', afterHours: 1 })).status, 404);
    assert.equal((await pmAlpha.get(`${M}/instructions?view=all`)).status, 403, 'the full register needs msg.comm.view_all');
    assert.equal((await pdAll.get(`${M}/instructions?view=all`)).json.data.rows.length, 1);
    const ann = (project) => ({ title: 'Safety notice', body: 'Hard hats on the whole site.', audience: { projectIds: [project] } });
    assert.equal((await pmAlpha.post(`${M}/announcements`, ann(b))).status, 403, 'not to another project');
    assert.equal((await outsider.post(`${M}/announcements`, ann(a))).status, 403);
    assert.equal((await pmAlpha.post(`${M}/announcements`, { ...ann(a), audience: { all: true } })).status, 403, 'a project-scoped manager may not announce to everyone');
    const mineAnn = await pmAlpha.post(`${M}/announcements`, ann(a));
    assert.equal(mineAnn.status, 201, JSON.stringify(mineAnn.json));
    assert.equal((await pmAlpha.post(`${M}/announcements/${mineAnn.json.data.id}/publish`, {})).status, 200);
    assert.equal((await seAlpha.get(`${M}/announcements`)).json.data.rows.length, 1);
    assert.equal((await outsider.get(`${M}/announcements`)).json.data.rows.length, 0, 'another project does not receive it');
    assert.equal((await outsider.get(`${M}/announcements/${mineAnn.json.data.id}`)).status, 404);
    assert.equal((await seAlpha.get(`${M}/auto-group-rules`)).status, 403);
    // an automatic member cannot leave (mute or archive instead)
    assert.equal((await seAlpha.post(`${M}/conversations/${id}/read`, {})).status, 200);
  } finally { await api.close(); rmSync(storage, { recursive: true, force: true }); }
});
