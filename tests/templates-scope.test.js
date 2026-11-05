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

// Part 04.11 AC-03: in sign-in mode, where a role is held for one project, generated documents and the records they are made from are isolated by project: a person scoped to one project sees, generates,
// bulk-generates, opens and sends only that project's documents; another project's are not even said to exist.
const PW = 'Tr0ub4dor&3-Excavator';
const T = '/api/v1/tpl';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });

test('AC-03 cross-project isolation of generated documents: a person scoped to one project cannot see, generate, open or send another project\'s documents', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-tpl-scope-'));
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
    const accAlpha = await person('acc-alpha', ['ACCMGR'], [a]);
    const accAll = await person('acc-all', ['ACCMGR']);
    const po = (n) => ({ docNo: `PO/${n}`, party: { name: 'Vendor', stateCode: '27' }, supply: { stateCode: '27' }, lines: [{ description: 'Cement', qty: '10', rate: '400', gstRate: '28' }] });
    for (const [n, p] of [['A1', a], ['A2', a], ['B1', b]]) {
      const r = await sys.put(`${T}/records`, { docType: 'PO', entityId: n, data: po(n), approved: true, projectId: p });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    // the records: only the project's own
    const rr = await accAlpha.get(`${T}/records?docType=PO`);
    assert.equal(rr.status, 200, JSON.stringify(rr.json));
    assert.deepEqual(rr.json.data.rows.map((r) => r.entityId).sort(), ['A1', 'A2']);
    assert.equal((await accAll.get(`${T}/records?docType=PO`)).json.data.rows.length, 3);
    // generating: the project's own works, the other project's is refused
    const own = await accAlpha.post(`${T}/generate`, { docType: 'PO', entityId: 'A1' });
    assert.equal(own.status, 201, JSON.stringify(own.json));
    assert.equal((await accAlpha.post(`${T}/generate`, { docType: 'PO', entityId: 'B1' })).status, 403);
    // bulk: one record of another project stops the whole job before anything starts
    const bulk = await accAlpha.post(`${T}/generate/bulk`, { docType: 'PO', entityIds: ['A2', 'B1'] });
    assert.equal(bulk.status, 422);
    assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM tpl_bulk_jobs').get().n, 0);
    const other = await accAll.post(`${T}/generate`, { docType: 'PO', entityId: 'B1' });
    assert.equal(other.status, 201);
    // the log, the detail, the PDF, the verification-by-scanner and the delivery follow the project
    const log = (await accAlpha.get(`${T}/generated`)).json.data;
    assert.deepEqual(log.rows.map((r) => r.docNo), ['PO/A1']);
    assert.equal(log.summary.total, 1);
    assert.equal((await accAll.get(`${T}/generated`)).json.data.total, 2);
    assert.equal((await accAlpha.get(`${T}/generated/${own.json.data.id}`)).status, 200);
    assert.equal((await accAlpha.get(`${T}/generated/${other.json.data.id}`)).status, 404);
    assert.equal((await accAlpha.get(`${T}/generated/${other.json.data.id}/content`)).status, 404);
    assert.equal((await accAlpha.post(`${T}/generated/${other.json.data.id}/deliver`, { channel: 'PORTAL', recipients: ['x-portal'] })).status, 404);
    assert.equal((await accAlpha.get(`${T}/generated/${own.json.data.id}/content`)).status, 200);
    assert.equal((await accAlpha.get(`${T}/generated/export?format=csv`)).buffer.toString().includes('PO/B1'), false, 'the export is limited too');
    const scan = (d) => accAlpha.get('/api/v1/ui/qr/resolve?code=' + encodeURIComponent('ERP:DOCVERIFY:' + d.verifyCode));
    assert.equal((await scan(other.json.data)).status, 404, 'the scanner does not open another project\'s document');
    const found = await scan(own.json.data);
    assert.equal(found.status, 200);
    assert.deepEqual([found.json.data.status, found.json.data.type, found.json.data.route], ['found', 'DOCVERIFY', `/documents/generated?id=${own.json.data.id}`]);
  } finally { await api.close(); rmSync(storage, { recursive: true, force: true }); }
});
