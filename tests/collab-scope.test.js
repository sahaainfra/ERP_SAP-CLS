import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { startApi } from './helpers.js';

// Part 04.14 AC-03: in sign-in mode, where a role is held for one project, comments, the timeline, the trace, the mentions inbox and the project feed are isolated by project exactly as the record is.
const PW = 'Tr0ub4dor&3-Excavator';
const C = '/api/v1/col';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });

test('AC-03 BR-01 cross-project isolation: a person scoped to one project cannot read, write, mention into, trace or see the feed of another project\'s records', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-col-scope-'));
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
      return { get: (p) => http('GET', p, { token }), post: (p, body = {}) => http('POST', p, { token, body }), del: (p, body = {}) => http('DELETE', p, { token, body }) };
    };
    const project = (code) => Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 't')").run(code, `Project ${code}`).lastInsertRowid);
    const a = project('ALPHA');
    const b = project('BRAVO');
    const pdAll = await person('pd-all', ['PD']);
    const pdAlpha = await person('pd-alpha', ['PD'], [a]);
    const pmAlpha = await person('pm-alpha', ['PM'], [a]);
    const pmBravo = await person('pm-bravo', ['PM'], [b]);
    const docAlpha = (await pdAll.post('/api/v1/eng/sample-docs', { title: 'Alpha shuttering', amount: '12000.00', projectId: a })).json.data;
    const docBravo = (await pdAll.post('/api/v1/eng/sample-docs', { title: 'Bravo shuttering', amount: '9000.00', projectId: b })).json.data;
    assert.ok(docAlpha?.id && docBravo?.id);
    const q = (d) => `entity=sample_doc&id=${d.id}`;

    // the person with the company-wide right comments on both records
    assert.equal((await pdAll.post(`${C}/comments`, { entity: 'sample_doc', id: String(docAlpha.id), body: 'Alpha note' })).status, 201);
    assert.equal((await pdAll.post(`${C}/comments`, { entity: 'sample_doc', id: String(docBravo.id), body: 'Bravo note' })).status, 201);
    // the person scoped to Alpha reads and writes Alpha only, in every API
    assert.equal((await pdAlpha.get(`${C}/comments?${q(docAlpha)}`)).json.data.total, 1);
    assert.equal((await pdAlpha.post(`${C}/comments`, { entity: 'sample_doc', id: String(docAlpha.id), body: 'Alpha reply' })).status, 201);
    for (const path of [`${C}/comments?${q(docBravo)}`, `${C}/timeline?${q(docBravo)}`, `${C}/trace?${q(docBravo)}`]) assert.equal((await pdAlpha.get(path)).status, 404, `${path} is another project's record`);
    assert.equal((await pdAlpha.post(`${C}/comments`, { entity: 'sample_doc', id: String(docBravo.id), body: 'Sneaking in' })).status, 404);
    // a comment of another project is neither edited, deleted nor reacted to through its number
    const bravoComment = api.db.prepare("SELECT id FROM col_comments WHERE entity_id = ?").get(String(docBravo.id)).id;
    assert.equal((await pdAlpha.del(`${C}/comments/${bravoComment}`, { reason: 'not mine' })).status, 404);
    assert.equal((await pdAlpha.post(`${C}/comments/${bravoComment}/reactions`, { reaction: 'like' })).status, 404);
    // BR-01: a mention of a person who cannot see the record is refused: Bravo's manager cannot see Alpha's record, and the reverse
    const blocked = await pdAll.post(`${C}/comments`, { entity: 'sample_doc', id: String(docAlpha.id), body: 'Please look @pm-bravo' });
    assert.equal(blocked.status, 422);
    assert.match(blocked.json.error.message, /@pm-bravo cannot see this record/);
    assert.equal((await pdAll.post(`${C}/comments`, { entity: 'sample_doc', id: String(docAlpha.id), body: 'Please look @pm-alpha' })).status, 201);
    assert.equal((await pdAll.post(`${C}/comments`, { entity: 'sample_doc', id: String(docBravo.id), body: 'Please look @pm-alpha' })).status, 422);
    // the mentions inbox: the mention of Alpha's manager is there; if their scope later shrinks to Bravo it is no longer shown
    const inbox = (await pmAlpha.get(`${C}/mentions`)).json.data;
    assert.equal(inbox.total, 1);
    assert.equal(inbox.rows[0].record.id, String(docAlpha.id));
    // trace links never name a record the person cannot open
    runtimeOf(api.db);
    const link = await pdAll.post(`${C}/trace/links`, { from: { entity: 'sample_doc', id: String(docAlpha.id) }, to: { entity: 'sample_doc', id: String(docBravo.id) }, relation: 'REFERS', reason: 'Alpha shuttering reused from Bravo' });
    assert.equal(link.status, 201, JSON.stringify(link.json));
    const seen = (await pdAlpha.get(`${C}/trace?${q(docAlpha)}`)).json.data;
    assert.deepEqual(seen.downstream.map((n) => [n.restricted, n.label, n.id, n.route]), [[true, 'Restricted record', null, null]]);
    assert.equal(JSON.stringify(seen).includes('Bravo'), false, 'nothing of the other project leaks');
    assert.equal((await pdAlpha.post(`${C}/trace/links`, { from: { entity: 'sample_doc', id: String(docAlpha.id) }, to: { entity: 'sample_doc', id: String(docBravo.id) }, relation: 'REFERS', reason: 'Trying across projects' })).status, 404, 'the other record is not found');
    // the feed: the right is held per project
    assert.equal((await pmAlpha.get(`${C}/feed?projectId=${a}`)).status, 200);
    assert.equal((await pmAlpha.get(`${C}/feed?projectId=${b}`)).status, 403);
    assert.equal((await pmBravo.get(`${C}/feed?projectId=${b}`)).status, 200);
    const feedA = (await pmAlpha.get(`${C}/feed?projectId=${a}&limit=200`)).json.data;
    assert.ok(feedA.rows.length > 0 && feedA.rows.every((r) => !r.record || r.record.label.includes('Alpha')), 'only Alpha records');
    // moderation is per project too: Bravo's manager cannot delete a note on Alpha's record
    const alphaComment = api.db.prepare("SELECT id FROM col_comments WHERE entity_id = ? ORDER BY id LIMIT 1").get(String(docAlpha.id)).id;
    assert.equal((await pmBravo.del(`${C}/comments/${alphaComment}`, { reason: 'Not my project' })).status, 404);
    assert.equal((await pmAlpha.del(`${C}/comments/${alphaComment}`, { reason: 'Contains a supplier rate' })).status, 200);
  } finally { await api.close(); rmSync(storage, { recursive: true, force: true }); }
});
