import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { startApi } from './helpers.js';

// Part 04.12 AC-03: in sign-in mode, where a role is held for one project, signatures are isolated by project: a person scoped to one project signs, sees and lists the signatures of that project's documents only.
const PW = 'Tr0ub4dor&3-Excavator';
const T = '/api/v1/tpl';
const S = '/api/v1/sig';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });

test('AC-03 cross-project isolation of signatures: a person scoped to one project cannot sign, see or list another project\'s signatures', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-sig-scope-'));
  const api = await startApi({ AUTH_MODE: 'iam' }, { storagePath: storage, logger: createLogger({ write: () => {} }), identityOptions: { passwordCost: { memory: 8, passes: 1 } } });
  try {
    const store = createUserStore({ db: api.db, identity: identityOf(api.db) });
    api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
    const http = async (method, path, { token, body } = {}) => {
      const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(method === 'GET' ? {} : idem()) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const buffer = Buffer.from(await res.arrayBuffer());
      let json = null;
      try { json = JSON.parse(buffer.toString()); } catch { /* a file */ }
      return { status: res.status, json, buffer };
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
      return { get: (p) => http('GET', p, { token }), post: (p, body = {}) => http('POST', p, { token, body }), put: (p, body = {}) => http('PUT', p, { token, body }) };
    };
    const project = (code) => Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 't')").run(code, `Project ${code}`).lastInsertRowid);
    const a = project('ALPHA');
    const b = project('BRAVO');
    const sys = await person('sysadm1', ['SYSADM']);
    const accAll = await person('acc-all', ['ACCMGR']);
    const accAlpha = await person('acc-alpha', ['ACCMGR'], [a]);
    const audAlpha = await person('aud-alpha', ['AUD'], [a]);
    const audAll = await person('aud-all', ['AUD']);
    const po = (n) => ({ docNo: `PO/${n}`, party: { name: 'Vendor', stateCode: '27' }, supply: { stateCode: '27' }, lines: [{ description: 'Cement', qty: '10', rate: '400', gstRate: '28' }] });
    const ids = {};
    for (const [n, p] of [['A1', a], ['B1', b]]) {
      assert.equal((await sys.put(`${T}/records`, { docType: 'PO', entityId: n, data: po(n), approved: true, projectId: p })).status, 200);
      ids[n] = (await accAll.post(`${T}/generate`, { docType: 'PO', entityId: n })).json.data;
    }
    assert.equal((await accAlpha.post(`${S}/documents/${ids.A1.id}/sign`, { method: 'APPROVAL' })).status, 201);
    assert.equal((await accAlpha.post(`${S}/documents/${ids.B1.id}/sign`, { method: 'APPROVAL' })).status, 404, 'another project\'s document is not even there');
    assert.equal((await accAll.post(`${S}/documents/${ids.B1.id}/sign`, { method: 'APPROVAL' })).status, 201);
    assert.equal((await accAlpha.get(`${S}/documents/${ids.B1.id}`)).status, 404);
    assert.equal((await accAlpha.get(`${S}/documents/${ids.B1.id}/signed`)).status, 404);
    assert.equal((await accAlpha.get(`${S}/verify/${ids.B1.verifyCode}`)).status, 404);
    assert.equal((await accAlpha.post(`${S}/documents/${ids.B1.id}/cancel`, { reason: 'Not my project' })).status, 404);
    assert.equal((await audAlpha.get(`${S}/register`)).json.data.rows.map((r) => r.docNo).join(), 'PO/A1');
    assert.equal((await audAll.get(`${S}/register`)).json.data.total, 2);
    assert.equal((await audAlpha.get(`${S}/register?projectId=${b}`)).json.data.total, 0);
    assert.equal((await audAlpha.post(`${S}/signatures/1/revoke`, { reason: 'Not allowed' })).status, 403);
  } finally { await api.close(); rmSync(storage, { recursive: true, force: true }); }
});
