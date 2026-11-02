import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { startApi } from './helpers.js';

// Part 04.01 AC-04: in sign-in mode, where roles are held for a project, tasks and instances are isolated by project: an approver of one project is not
// given, cannot decide and cannot read the approvals of another; a reader scoped to one project sees only its approvals; a step with nobody holding the
// role for the project goes to the administrators.
const PW = 'Tr0ub4dor&3-Excavator';
const W = '/api/v1/workflow';
const E = '/api/v1/eng';
const idem = () => ({ 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });

async function boot() {
  const api = await startApi({ AUTH_MODE: 'iam' }, { logger: createLogger({ write: () => {} }), identityOptions: { passwordCost: { memory: 8, passes: 1 } } });
  const store = createUserStore({ db: api.db, identity: identityOf(api.db) });
  api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
  const http = async (method, path, { token, body } = {}) => {
    const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(method === 'GET' ? {} : idem()) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  /** A person with a role; `projects` limits the role to those projects (an assignment for them instead of the whole company). */
  const person = async (username, roles, projects = null) => {
    const u = await store.create({ companyId: 1, username, email: `${username}@example.com`, displayName: `${username} Kumar`, roles, password: PW });
    const id = Number(api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(username).id);
    if (projects) {
      // the role is held for those projects only: an assignment instead of the role on the account
      api.db.prepare("UPDATE iam_users SET roles_json = '[]' WHERE id = ?").run(id);
      for (const code of roles) api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test', 'test', 'test')").run(id, code, JSON.stringify(projects));
    }
    const token = (await http('POST', '/api/v1/iam/auth/login', { body: { username, password: PW, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } })).json?.data?.accessToken;
    assert.ok(token, `${username} signs in ${JSON.stringify(u).slice(0, 0)}`);
    return { username, get: (p) => http('GET', p, { token }), post: (p, body = {}) => http('POST', p, { token, body }) };
  };
  return { api, person };
}

test('AC-04 cross-project isolation: tasks, reading and lists follow the project; a project with nobody holding the role sends the step to the administrators', async () => {
  const { api, person } = await boot();
  const project = (code) => Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 't')").run(code, `Project ${code}`).lastInsertRowid);
  const a = project('ALPHA');
  const b = project('BRAVO');
  const c = project('CHARLIE');
  const pd = await person('pdee', ['PD']);
  const pmA = await person('pm-alpha', ['PM'], [a]);
  const pmB = await person('pm-bravo', ['PM'], [b]);
  const audA = await person('aud-alpha', ['AUD'], [a]);
  const mk = async (projectId, title) => { const r = await pd.post(`${E}/sample-docs`, { title, amount: '100000.00', projectId }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  const docA = await mk(a, 'Alpha formwork');
  const docB = await mk(b, 'Bravo formwork');
  const docC = await mk(c, 'Charlie formwork');
  const wfA = (await pd.post(`${E}/sample-docs/${docA.id}/submit`)).json.data.workflow;
  const wfB = (await pd.post(`${E}/sample-docs/${docB.id}/submit`)).json.data.workflow;
  const wfC = (await pd.post(`${E}/sample-docs/${docC.id}/submit`)).json.data.workflow;
  // the task is for the holders of the role in that project
  assert.equal(wfA.tasks[0].status, 'OPEN');
  assert.equal(wfB.tasks[0].status, 'OPEN');
  assert.equal(wfC.tasks[0].status, 'ADMIN_QUEUE', 'nobody holds PM for Charlie, so the step waits for an administrator and is not given to the holders for other projects');
  assert.equal(wfC.needsAdmin, true);
  // an approver sees and decides only the tasks of their project
  const mineA = (await pmA.get(`${W}/tasks?mine=assigned`)).json.data;
  assert.deepEqual(mineA.rows.map((t) => t.instance.id), [wfA.id]);
  assert.deepEqual((await pmB.get(`${W}/tasks?mine=assigned`)).json.data.rows.map((t) => t.instance.id), [wfB.id]);
  assert.equal((await pmA.post(`${W}/tasks/${wfB.tasks[0].id}/act`, { action: 'approve' })).status, 403, 'the project manager of Alpha cannot decide a task of Bravo');
  assert.equal((await pmA.post(`${W}/tasks/${wfC.tasks[0].id}/act`, { action: 'approve' })).status, 409);
  assert.equal((await pmA.get(`${W}/instances/${wfB.id}`)).status, 404, 'nor read it');
  assert.equal((await pmA.get(`${W}/instances/${wfA.id}`)).status, 200);
  assert.equal((await pmA.post(`${W}/tasks/${wfA.tasks[0].id}/act`, { action: 'approve' })).status, 200);
  // a reader scoped to one project sees that project's approvals only: the list, the monitor and one instance
  const list = (await audA.get(`${W}/instances`)).json.data;
  assert.deepEqual(list.rows.map((r) => r.id), [wfA.id]);
  assert.equal((await audA.get(`${W}/monitor`)).json.data.totals.running, 1);
  assert.equal((await audA.get(`${W}/instances/${wfA.id}`)).status, 200);
  assert.equal((await audA.get(`${W}/instances/${wfB.id}`)).status, 404);
  assert.equal((await audA.get(`${W}/documents/ENG_SAMPLE_DOC/${docB.id}`)).status, 404, 'the by-document door answers like the instance door');
  assert.equal((await audA.get(`${W}/documents/ENG_SAMPLE_DOC/${docA.id}`)).json.data.id, wfA.id);
  // the sample documents themselves are scoped the same way
  assert.deepEqual((await audA.get(`${E}/sample-docs`)).status, 403, 'the auditor has no right to the sample documents at all');
  assert.equal((await pmB.get(`${E}/sample-docs/${docA.id}`)).status, 404, 'a project manager does not read another project\'s document');
  await api.close();
});

test('FR-01 BR-01 the reporting manager step goes to the head of the originator\'s department; if the originator is the head, to the administrators', async () => {
  const { api, person } = await boot();
  const dept = Number(api.db.prepare("INSERT INTO org_departments (company_id, kind, code, name, created_by, source_type) VALUES (1, 'DEPARTMENT', 'CIV', 'Civil works', 't', 't')").run().lastInsertRowid);
  const pd = await person('pd-civil', ['PD']);
  const head = await person('head-civil', ['PM']);
  const sys = await person('sys-one', ['SYSADM']);
  const id = (name) => Number(api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(name).id);
  for (const name of ['pd-civil', 'head-civil']) api.db.prepare('UPDATE iam_user_profiles SET department_id = ? WHERE user_id = ?').run(dept, id(name));
  api.db.prepare("INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, created_by, source_type) VALUES (1, 'DEPARTMENT', ?, 'HEAD', ?, '2026-01-01', 't', 't')").run(dept, id('head-civil'));
  // a definition whose only step is the reporting manager (activated by direct insert: the chain that activates definitions is tested elsewhere)
  const steps = { settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'MGR', name: 'Reporting manager', type: 'approval', mode: 'single', approvers: [{ kind: 'manager' }], slaHours: 24, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] };
  api.db.prepare("INSERT INTO wf_definitions (company_id, doc_type, version, name, status, steps_json, activated_at, activated_by, created_by, source_type) VALUES (1, 'ENG_SAMPLE_DOC', 1, 'Manager only', 'ACTIVE', ?, '2026-01-01T00:00:00Z', 'test', 'test', 'test')").run(JSON.stringify(steps));
  const mk = async (who, title) => (await who.post(`${E}/sample-docs`, { title, amount: '1000.00' })).json.data;
  const d1 = await mk(pd, 'Civil request');
  const wf1 = (await pd.post(`${E}/sample-docs/${d1.id}/submit`)).json.data.workflow;
  assert.equal(wf1.tasks[0].assigneeUser, 'head-civil');
  assert.equal(wf1.needsAdmin, false);
  assert.equal((await head.get(`${W}/tasks?mine=assigned`)).json.data.total, 1);
  assert.equal((await head.post(`${W}/tasks/${wf1.tasks[0].id}/act`, { action: 'approve' })).json.data.status, 'APPROVED');
  // the head raises one: nobody else manages them, so it waits for an administrator
  const sysDoc = await head.post(`${E}/sample-docs`, { title: 'Head request', amount: '1000.00' });
  const wf2 = (await head.post(`${E}/sample-docs/${sysDoc.json.data.id}/submit`)).json.data.workflow;
  assert.equal(wf2.tasks[0].status, 'ADMIN_QUEUE');
  assert.equal((await sys.get(`${W}/tasks?mine=admin`)).json.data.total, 1);
  await api.close();
});
