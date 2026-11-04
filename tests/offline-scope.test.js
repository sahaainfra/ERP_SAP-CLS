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

// Part 04.15 AC-03: in sign-in mode, where a role is held for one project, offline commands, masters, devices and the confirmation of old commands are isolated by project.
const PW = 'Tr0ub4dor&3-Excavator';
const O = '/api/v1/off';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });

test('AC-03 cross-project isolation of the offline engine: commands, masters, files and confirmations stay inside the person\'s projects', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-off-scope-'));
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
      return { get: (p) => http('GET', p, { token }), post: (p, body = {}) => http('POST', p, { token, body }) };
    };
    const project = (code) => Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 't')").run(code, `Project ${code}`).lastInsertRowid);
    const a = project('ALPHA');
    const b = project('BRAVO');
    const seAlpha = await person('se-alpha', ['SE'], [a]);
    const pmAlpha = await person('pm-alpha', ['PM'], [a]);
    const pmBravo = await person('pm-bravo', ['PM'], [b]);
    const pdAll = await person('pd-all', ['PD']);
    const DEV = 'device-alpha-0001';
    assert.equal((await seAlpha.post(`${O}/devices`, { deviceId: DEV, name: 'Phone' })).status, 201);
    const cmd = (over) => ({ id: `cmd-${Math.random().toString(36).slice(2, 12)}`, seq: 1, type: 'sample_doc', op: 'create', values: { title: 'Kerb stones', amount: '5000.00', projectId: a }, createdAt: new Date().toISOString(), ...over });
    const send = (who, commands, deviceId = DEV) => who.post(`${O}/sync`, { deviceId, commands });
    // a command for the person's own project is saved; one for another project is refused and nothing is made
    const ok = (await send(seAlpha, [cmd()])).json.data.results[0];
    assert.equal(ok.status, 'APPLIED', JSON.stringify(ok));
    const other = (await send(seAlpha, [cmd({ values: { title: 'Kerb stones', amount: '5000.00', projectId: b } })])).json.data.results[0];
    assert.equal(other.status, 'REJECTED');
    assert.match(other.error, /not do this for that project|may not/);
    assert.deepEqual(api.db.prepare('SELECT project_id FROM eng_sample_docs').all().map((r) => r.project_id), [a]);
    // a change to a record of another project is refused too (it does not exist for this person)
    const docB = (await pdAll.post('/api/v1/eng/sample-docs', { title: 'Bravo work', amount: '9000.00', projectId: b })).json.data;
    const upd = (await send(seAlpha, [cmd({ op: 'update', entityId: String(docB.id), baseVersion: docB.version, values: { title: 'Changed by alpha' } })])).json.data.results[0];
    assert.equal(upd.status, 'REJECTED');
    assert.equal(api.db.prepare('SELECT title FROM eng_sample_docs WHERE id = ?').get(docB.id).title, 'Bravo work');
    // masters: only Alpha
    const m = (await seAlpha.get(`${O}/masters`)).json.data.masters;
    assert.deepEqual(m.projects.rows.map((p) => p.code), ['ALPHA']);
    assert.deepEqual((await pdAll.get(`${O}/masters`)).json.data.masters.projects.rows.map((p) => p.code).sort(), ['ALPHA', 'BRAVO']);
    // devices belong to their person; the IT-less project manager sees none of them and cannot revoke
    const devs = (await seAlpha.get(`${O}/devices`)).json.data;
    assert.equal(devs.total, 1);
    assert.equal((await pmBravo.get(`${O}/devices?all=true`)).json.data.total, 0);
    assert.equal((await pmBravo.post(`${O}/devices/${devs.rows[0].id}/revoke`, { reason: 'Not my device' })).status, 404);
    // an old command waits for a supervisor of its own project only
    const old = (await send(seAlpha, [cmd({ createdAt: new Date(Date.now() - 12 * 86_400_000).toISOString() })])).json.data.results[0];
    assert.equal(old.status, 'NEEDS_CONFIRMATION');
    const row = api.db.prepare('SELECT id FROM off_sync_log WHERE command_id = ?').get(old.commandId).id;
    assert.equal((await pmBravo.get(`${O}/confirmations`)).json.data.rows.length, 0, 'the manager of another project does not see it');
    assert.equal((await pmBravo.post(`${O}/commands/${row}/confirm`, { decision: 'CONFIRM' })).status, 403);
    assert.equal((await pmAlpha.get(`${O}/confirmations`)).json.data.rows.length, 1);
    assert.equal((await pmAlpha.post(`${O}/commands/${row}/confirm`, { decision: 'CONFIRM' })).json.data.status, 'APPLIED');
    // the sync log of one person is not another's
    assert.equal((await pmBravo.get(`${O}/commands/${row}`)).status, 404);
    // a device of someone else cannot be used
    assert.equal((await pdAll.post(`${O}/sync`, { deviceId: DEV, commands: [cmd()] })).json.error.code, 'DEVICE_UNKNOWN');
  } finally { await api.close(); rmSync(storage, { recursive: true, force: true }); }
});
