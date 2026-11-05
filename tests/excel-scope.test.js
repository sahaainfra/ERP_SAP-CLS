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
import { templateWorkbook } from '../src/server/modules/eng/xl-xlsx.js';
import { startApi } from './helpers.js';

// Part 04.13 AC-03: in sign-in mode, where a role is held for one project, an import is isolated by project: a person scoped to one project cannot bring in records for another (the row is refused in the preview with the reason, and again at commit), and cannot see the jobs of others.
const PW = 'Tr0ub4dor&3-Excavator';
const X = '/api/v1/xl';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });

test('AC-03 BR-01 cross-project isolation of imports: rows for another project are refused at the preview and never created; jobs belong to their starter', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-xl-scope-'));
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
    project('BRAVO');
    const pdAlpha = await person('pd-alpha', ['PD'], [a]);
    const pdAll = await person('pd-all', ['PD']);
    const aud = await person('aud-all', ['AUD']);
    const send = async (who, rows, token) => {
      const cols = (await who.get(`${X}/templates`)).json.data.types.find((t) => t.code === 'ENG_SAMPLE_DOC').columns;
      const buf = Buffer.from(templateWorkbook({ importType: 'ENG_SAMPLE_DOC', version: 0, title: 'x', columns: cols.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: [], rowsRaw: true, rows: rows.map((r) => cols.map((c) => r[c.key] ?? null)) }));
      const res = await fetch(`${api.base}${X}/jobs?type=ENG_SAMPLE_DOC&fileName=docs.xlsx`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', ...idem() }, body: buf });
      return { status: res.status, json: await res.json() };
    };
    const tokenOf = async (u) => (await http('POST', '/api/v1/iam/auth/login', { body: { username: u, password: PW, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } })).json.data.accessToken;
    const rows = [{ title: 'Shuttering for Alpha', amount: '12000.00', project: 'ALPHA', submit: 'No' }, { title: 'Shuttering for Bravo', amount: '9000.00', project: 'BRAVO', submit: 'No' }];
    const up = await send(pdAlpha, rows, await tokenOf('pd-alpha'));
    assert.equal(up.status, 202, JSON.stringify(up.json));
    const drain = async () => { for (let i = 0; i < 6; i += 1) { runtimeOf(api.db).bus.drain(); await runtimeOf(api.db).jobs.drain(); } };
    await drain();
    const job = (await pdAlpha.get(`${X}/jobs/${up.json.data.id}`)).json.data;
    assert.deepEqual([job.status, job.validRows, job.errorRows], ['PREVIEW', 1, 1]);
    const errs = (await pdAlpha.get(`${X}/jobs/${job.id}/errors`)).json.data.rows;
    assert.deepEqual(errs.map((e) => [e.row, e.column, e.code]), [[3, 'Project', 'PERMISSION']]);
    assert.match(errs[0].message, /You may not raise documents for project BRAVO/);
    assert.equal((await pdAlpha.post(`${X}/jobs/${job.id}/commit`, {})).status, 409, 'not while a row has errors');
    assert.equal((await pdAlpha.post(`${X}/jobs/${job.id}/commit`, { skipInvalid: true })).status, 202);
    await drain();
    assert.deepEqual(api.db.prepare('SELECT title, status FROM eng_sample_docs').all().map((r) => [r.title, r.status]), [['Shuttering for Alpha', 'DRAFT']]);
    assert.equal(api.db.prepare('SELECT project_id FROM eng_sample_docs').get().project_id, a);
    // the person with the company-wide right brings in both; the first person cannot see that job
    const both = await send(pdAll, rows, await tokenOf('pd-all'));
    await drain();
    const j2 = (await pdAll.get(`${X}/jobs/${both.json.data.id}`)).json.data;
    assert.deepEqual([j2.validRows, j2.errorRows], [2, 0]);
    assert.equal((await pdAlpha.get(`${X}/jobs/${j2.id}`)).status, 404);
    assert.equal((await pdAlpha.get(`${X}/jobs`)).json.data.total, 1);
    assert.equal((await aud.get(`${X}/jobs`)).json.data.total, 2, 'the auditor sees every job');
    assert.equal((await aud.post(`${X}/jobs/${j2.id}/cancel`, {})).status, 200, 'and may cancel one that was not committed');
  } finally { await api.close(); rmSync(storage, { recursive: true, force: true }); }
});
