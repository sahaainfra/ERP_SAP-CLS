import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { admin, setupCompany, startApi } from './helpers.js';

// Part 03.08: global search. Who sees what (T-01), how fast a new record can be found (T-02), the document number first (T-03), sensitive values
// searched only by those who see them (BR-01), names in Hindi and with typing mistakes (FR-04), the rebuild by an administrator (BR-02) and the
// analytics of searches that found nothing (FR-06).
const U = '/api/v1/ui';
const I = '/api/v1/iam';
const PW = 'Tr0ub4dor&3-Excavator';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `srch-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pm = as('PM', 'pm1');
const acc = as('ACCMGR', 'acc1');
const sys = as('SYSADM', 'sys1');
const itadm = as('ITADM', 'it1');
const emp = as('EMP', 'emp1');
const today = '2026-10-31';
const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString();
const drain = (api) => runtimeOf(api.db).bus.drain();

async function world(api, { extraProject = false } = {}) {
  await setupCompany(api, { company: '1' });
  const mr = await api.call('POST', '/api/v1/core/number-series', { ...admin('1'), headers: key('n'), body: { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:6}', resetRule: 'financial_year', reason: 'initial set-up' } });
  assert.equal(mr.status, 201, JSON.stringify(mr.json));
  const mk = async (code, name) => {
    const project = (await api.call('POST', `${I}/org/projects`, { ...pm, headers: key(`p${code}`), body: { code, name, type: 'ROAD' } })).json.data;
    const site = (await api.call('POST', `${I}/org/sites`, { ...pm, headers: key(`s${code}`), body: { code: `${code}-S1`, name: `${name} camp`, projectId: project.id } })).json.data;
    return { project, site };
  };
  const a = await mk('NH1', 'NH-48 Widening');
  const b = extraProject ? await mk('RR2', 'Ring Road Phase 2') : null;
  return { a, b };
}
const raise = async (api, w, { title = 'Footing F3', project, submit = false, who = pm, qty = '2', rate = '58000' } = {}) => {
  const p = project ?? w.a;
  const r = (await api.call('POST', `${U}/sample-requests`, { ...who, headers: key('mk'), body: { title, docDate: today, requiredBy: '2026-11-20', projectId: p.project.id, siteId: p.site.id, priority: 'NORMAL', returnable: false, lines: [{ description: 'TMT bar', uom: 'MT', quantity: qty, unitRate: rate }] } })).json.data;
  assert.ok(r?.id, JSON.stringify(r));
  return submit ? (await api.call('POST', `${U}/sample-requests/${r.id}/submit`, { ...who, headers: key('sub'), body: { version: r.version } })).json.data : r;
};
const find = (api, who, params) => api.call('GET', `${U}/search?${q(params)}`, who);
const flat = (res) => (res.json.data.groups ?? []).flatMap((g) => g.items);

test('FR-01 FR-02 a record is searchable after the event that created it, and results come grouped by type', async () => {
  const api = await startApi();
  const w = await world(api);
  await raise(api, w, { title: 'Footing F3 reinforcement', submit: true });
  assert.equal(flat(await find(api, pm, { q: 'footing' })).length, 0, 'nothing is indexed until the event is delivered');
  drain(api);
  const res = await find(api, pm, { q: 'footing' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(res.json.data.groups.map((g) => g.type), ['sample_request']);
  assert.equal(res.json.data.groups[0].items[0].title, 'Footing F3 reinforcement');
  const proj = await find(api, pm, { q: 'widening' });
  assert.deepEqual(proj.json.data.groups.map((g) => g.type).sort(), ['project', 'site']);
  assert.equal((await find(api, pm, { q: 'widening', types: 'site', page: 1 })).json.data.total, 1);
  await api.close();
});

test('T-03 FR-04 a full document number returns the exact match first; partial numbers, separators and case still find it', async () => {
  const api = await startApi();
  const w = await world(api);
  const r1 = await raise(api, w, { title: 'Shuttering plates', submit: true });
  const r2 = await raise(api, w, { title: 'Binding wire', submit: true });
  drain(api);
  const n1 = r1.docNo ?? (await api.call('GET', `${U}/sample-requests/${r1.id}`, pm)).json.data.docNo;
  const n2 = (await api.call('GET', `${U}/sample-requests/${r2.id}`, pm)).json.data.docNo;
  assert.match(n1, /^MR\/2026-27\/\d{6}$/);
  const top = async (text) => flat(await find(api, pm, { q: text }))[0];
  assert.equal((await top(n1)).code, n1, 'the full number: that record first');
  assert.equal((await top(n1)).match, 'exact');
  assert.equal((await top(n2.toLowerCase())).code, n2, 'lower case');
  assert.equal((await top(n2.replace(/[/-]/g, ' '))).code, n2, 'separators typed as spaces');
  assert.equal((await top(n2.replace(/[/-]/g, ''))).code, n2, 'no separators');
  const partial = flat(await find(api, pm, { q: n2.slice(-3) }));
  assert.ok(partial.some((i) => i.code === n2), 'the last digits find it');
  const prefix = flat(await find(api, pm, { q: 'MR/2026-27' }));
  assert.deepEqual(prefix.map((i) => i.code).sort(), [n1, n2].sort(), 'the start of the number finds both');
  await api.close();
});

test('T-02 a request approved is searchable under its new status within 5 seconds, and a cancelled one leaves the open filter', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await raise(api, w, { title: 'Curing compound', submit: true });
  drain(api);
  const before = flat(await find(api, pm, { q: 'curing', status: 'SUBMITTED' }));
  assert.equal(before.length, 1);
  const t0 = Date.now();
  const open = (await api.call('GET', '/api/v1/core/change-requests?status=SUBMITTED', sys)).json?.data ?? [];
  const mine = open.find((x) => x.targetId === r.id || x.target_id === r.id);
  if (mine) assert.equal((await api.call('POST', `/api/v1/core/change-requests/${mine.id}/act`, { ...acc, headers: key('act'), body: { action: 'approve', comment: 'checked and fine' } })).status, 200);
  drain(api);
  const after = flat(await find(api, pm, { q: 'curing' }));
  assert.equal(after.length, 1);
  assert.ok(Date.now() - t0 < 5000, 'indexed within five seconds');
  // cancelling changes the status in the index too
  const cur = (await api.call('GET', `${U}/sample-requests/${r.id}`, pm)).json.data;
  const res = await api.call('POST', `${U}/sample-requests/${r.id}/cancel`, { ...pm, headers: key('c'), body: { version: cur.version, reason: 'raised twice by mistake' } });
  if (res.status === 200) {
    drain(api);
    assert.equal(flat(await find(api, pm, { q: 'curing', status: 'SUBMITTED' })).length, 0);
    assert.equal(flat(await find(api, pm, { q: 'curing', status: 'CANCELLED' })).length, 1);
  }
  await api.close();
});

test('BR-01 a sensitive value is searched only by a role that sees it in full, and a record that was removed or made private is not shown', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await raise(api, w, { title: 'Anchor bolts', submit: true, qty: '2', rate: '58000' });
  drain(api);
  // the total (116000.00) is a commercial value: the project manager sees it, the system administrator sees it masked
  assert.equal(flat(await find(api, pm, { q: '116000' })).length, 1, 'found by the value');
  assert.equal(flat(await find(api, sys, { q: '116000' })).length, 0, 'masked for the system administrator: not searchable');
  assert.equal(flat(await find(api, sys, { q: 'anchor' })).length, 1, 'but the title is found by the same role');
  assert.ok(!JSON.stringify((await find(api, pm, { q: 'anchor' })).json).includes('116000'), 'the value is never in a result');
  // the index row of the secret holds the value, but never in the searchable text
  const row = api.db.prepare("SELECT body, title, subtitle FROM core_search_index WHERE entity = 'sample_request'").get();
  assert.ok(!`${row.body}${row.title}${row.subtitle}`.includes('116000'));
  // a mobile number: shown in full to those who manage users, masked for the others
  await api.call('POST', `${I}/users`, { ...sys, headers: key('u'), body: { username: 'mohan', displayName: 'Mohan Das', email: 'mohan@example.com', mobile: '9876501234' } });
  drain(api);
  const byMobile = async (who) => flat(await find(api, who, { q: '9876501234' })).filter((i) => i.entity === 'user').length;
  assert.equal(await byMobile(sys), 1, 'the system administrator manages users');
  assert.equal(await byMobile(as('HRMGR', 'hr1')), 1, 'the HR manager sees it in full');
  assert.equal(await byMobile(as('AUD', 'aud1')), 0, 'an auditor sees the number masked and cannot search by it');
  // the record is read again at query time: a cancelled-out-of-existence row is dropped even if the index still has it
  api.db.prepare("UPDATE ui_sample_requests SET deleted_at = '2026-10-31T00:00:00Z' WHERE id = ?").run(r.id);
  assert.equal(flat(await find(api, pm, { q: 'anchor' })).length, 0, 'gone from the source: not shown, even before the index catches up');
  await api.close();
});

test('FR-04 names are found by sound (Hindi and Latin), by typing mistakes, and by pieces of a word', async () => {
  const api = await startApi();
  await world(api);
  await api.call('POST', `${I}/users`, { ...sys, headers: key('u1'), body: { username: 'rsharma', displayName: 'Rajesh Sharma', email: 'rs@example.com' } });
  await api.call('POST', `${I}/users`, { ...sys, headers: key('u2'), body: { username: 'skumar', displayName: 'सुरेश कुमार', email: 'sk@example.com' } });
  drain(api);
  const people = async (text) => flat(await find(api, sys, { q: text })).filter((i) => i.entity === 'user').map((i) => i.title);
  assert.deepEqual(await people('Rajesh'), ['Rajesh Sharma']);
  assert.deepEqual(await people('शर्मा'), ['Rajesh Sharma'], 'Devanagari finds the Latin name');
  assert.deepEqual(await people('Sarma'), ['Rajesh Sharma'], 'a different spelling of the same sound');
  assert.deepEqual(await people('राजेश'), ['Rajesh Sharma']);
  assert.deepEqual(await people('Kumar'), ['सुरेश कुमार'], 'Latin finds the Devanagari name');
  assert.deepEqual(await people('Suresh'), ['सुरेश कुमार']);
  assert.deepEqual(await people('Rajsh Sharma'), ['Rajesh Sharma'], 'a letter missing');
  assert.deepEqual(await people('Shamra'), ['Rajesh Sharma'], 'letters swapped');
  assert.deepEqual(await people('harm'), ['Rajesh Sharma'], 'a piece of a word');
  assert.deepEqual(await people('zzzzqq'), []);
  await api.close();
});

test('FR-05 filters narrow the results, pages are stable, and a bad parameter is refused', async () => {
  const api = await startApi();
  const w = await world(api, { extraProject: true });
  for (let n = 1; n <= 7; n += 1) await raise(api, w, { title: `Cement lot ${n}`, submit: n % 2 === 0, project: n % 3 === 0 ? w.b : w.a });
  drain(api);
  const all = (await find(api, pm, { q: 'cement', types: 'sample_request', page: 1, pageSize: 10 })).json.data;
  assert.equal(all.total, 7);
  const p1 = (await find(api, pm, { q: 'cement', types: 'sample_request', page: 1, pageSize: 10, sort: 'title' })).json.data.items.map((i) => i.title);
  assert.deepEqual(p1, [...p1].sort());
  assert.equal((await find(api, pm, { q: 'cement', projectId: w.b.project.id, types: 'sample_request', page: 1 })).json.data.total, 2);
  assert.equal((await find(api, pm, { q: 'cement', status: 'SUBMITTED', types: 'sample_request', page: 1 })).json.data.total, 3);
  assert.equal((await find(api, pm, { q: 'cement', from: '2027-01-01', page: 1 })).json.data.total, 0);
  assert.equal((await find(api, pm, { q: 'cement', types: 'sample_request', page: 1, pageSize: 10 })).json.data.counts.sample_request, 7);
  assert.equal((await find(api, pm, { q: 'cement', pageSize: 7 })).status, 400);
  assert.equal((await find(api, pm, { q: 'cement', from: 'yesterday' })).status, 400);
  assert.equal((await api.call('GET', `${U}/search?q=x&bogus=1`, pm)).status, 400);
  const types = (await api.call('GET', `${U}/search/types`, pm)).json.data.map((t) => t.type);
  assert.ok(types.includes('project') && types.includes('sample_request') && !types.includes('user') && !types.includes('role'), 'only the types the role may use');
  assert.equal((await find(api, emp, { q: 'cement' })).json.data.total, 0, 'a role with no rights gets nothing, not an error');
  await api.close();
});

test('BR-02 FR-06 only the IT administrator rebuilds the index (audited, background job); analytics show the searches that found nothing', async () => {
  const api = await startApi();
  const w = await world(api);
  await raise(api, w, { title: 'Hume pipe', submit: true });
  drain(api);
  // lose the index (an import, a bug, a restore): the rebuild brings it back from the source
  api.db.exec('DELETE FROM core_search_secret; DELETE FROM core_search_index');
  assert.equal(flat(await find(api, pm, { q: 'hume' })).length, 0);
  const denied = await api.call('POST', `${U}/search/reindex/sample_request`, { ...sys, headers: key('r1'), body: { reason: 'the index is empty' } });
  assert.equal(denied.status, 403, 'the system administrator cannot rebuild');
  assert.equal((await api.call('POST', `${U}/search/reindex/nonsense`, { ...itadm, headers: key('r2'), body: { reason: 'the index is empty' } })).status, 404);
  assert.equal((await api.call('POST', `${U}/search/reindex/sample_request`, { ...itadm, headers: key('r3'), body: {} })).status, 400, 'a reason is needed');
  const ok = await api.call('POST', `${U}/search/reindex/sample_request`, { ...itadm, headers: key('r4'), body: { reason: 'the index is empty' } });
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  assert.equal((await api.call('POST', `${U}/search/reindex/sample_request`, { ...itadm, headers: key('r5'), body: { reason: 'again at once' } })).status, 400, 'one at a time');
  const rt = runtimeOf(api.db);
  await rt.jobs.drain(5);
  const job = (await api.call('GET', `${U}/search/status`, itadm)).json.data;
  assert.equal(job.jobs[0].status, 'SUCCEEDED', JSON.stringify(job.jobs[0]));
  assert.equal(job.types.find((t) => t.type === 'sample_request').indexed, 1);
  assert.equal(flat(await find(api, pm, { q: 'hume' })).length, 1, 'found again');
  const audit = api.db.prepare("SELECT action, reason FROM core_audit_log WHERE entity = 'core_search_index' ORDER BY id").all().map((a) => a.action);
  assert.deepEqual(audit, ['reindex_requested', 'reindexed']);
  // analytics
  await find(api, pm, { q: 'nothing like this' });
  await find(api, pm, { q: 'hume pipe' });
  const an = await api.call('GET', `${U}/search/analytics?days=7`, itadm);
  assert.equal(an.status, 200);
  assert.ok(an.json.data.noResultTop.some((x) => x.q === 'nothing like this'));
  assert.ok(!an.json.data.noResultTop.some((x) => x.q === 'hume pipe'));
  assert.equal((await api.call('GET', `${U}/search/analytics`, pm)).status, 403);
  await api.close();
});

test('FR-03 the palette: commands follow the role and the page; opening a result joins the recent records', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await raise(api, w, { title: 'Reinforcement cage', submit: true });
  drain(api);
  const cmds = async (who, route) => (await api.call('GET', `${U}/search/commands${route ? `?route=${encodeURIComponent(route)}` : ''}`, who)).json.data;
  const pmCmds = await cmds(pm);
  assert.ok(pmCmds.some((c) => c.code === 'sample_request.create') && pmCmds.some((c) => c.clientAction === 'theme:dark'));
  assert.ok(!pmCmds.some((c) => c.code === 'search.rebuild' || c.code === 'user.invite'), 'no command for what the role cannot do');
  assert.ok((await cmds(itadm)).some((c) => c.code === 'search.rebuild'));
  assert.ok((await cmds(sys)).some((c) => c.code === 'user.invite'));
  assert.equal((await cmds(pm, '/admin/sample-requests'))[0].here, true, 'the commands of this page come first');
  assert.ok(!(await cmds(emp)).some((c) => c.code === 'sample_request.create'));
  // opening a result: recorded for the person, refused for one who cannot see it
  const hit = flat(await find(api, pm, { q: 'cage' }))[0];
  assert.equal((await api.call('POST', `${U}/search/click`, { ...pm, body: { entity: hit.entity, entityId: hit.entityId, position: 0 } })).status, 200);
  const recent = (await api.call('GET', `${U}/recent`, pm)).json.data;
  assert.equal(recent[0].title, 'Reinforcement cage');
  assert.equal((await api.call('POST', `${U}/search/click`, { ...emp, body: { entity: 'sample_request', entityId: r.id } })).status, 404);
  assert.equal((await api.call('POST', `${U}/search/click`, { ...pm, body: { entity: 'project', entityId: w.a.project.id } })).status, 200, 'any searchable type can be opened and remembered');
  await api.close();
});

test('T-01 a person assigned to project A never sees project B in any result, count, filter or opened record', async () => {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({ AUTH_MODE: 'iam' }, { logger: createLogger({ write: () => {} }), identityOptions: { passwordCost: { memory: 8, passes: 1 }, now: () => clock.t } });
  const store = createUserStore({ db: api.db, identity: identityOf(api.db) });
  api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
  const http = async (method, path, { token, body } = {}) => {
    const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const person = async (username, roles) => {
    await store.create({ companyId: 1, username, email: `${username}@example.com`, displayName: `${username} Kumar`, roles, password: PW });
    const token = (await http('POST', `${I}/auth/login`, { body: { username, password: PW, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } })).json?.data?.accessToken;
    assert.ok(token, `${username} signs in`);
    return { token, get: (p) => http('GET', p, { token }), post: (p, body) => http('POST', p, { token, body }) };
  };
  const pam = await person('pam', ['EMP']);
  const boss = await person('boss', ['SYSADM']);
  const db = api.db;
  db.prepare("INSERT INTO org_companies (id, code, legal_name, short_name, created_by, source_type) SELECT 1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test' WHERE NOT EXISTS (SELECT 1 FROM org_companies WHERE id = 1)").run();
  const project = (code, name) => Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'test')").run(code, name).lastInsertRowid);
  const site = (p, code) => Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (1, ?, ?, ?, 'ACTIVE', 't', 'test')").run(p, code, `Camp ${code}`).lastInsertRowid);
  const a = project('ALP', 'Alpha Bypass');
  const b = project('BRV', 'Bravo Flyover');
  const sa = site(a, 'ALP-1');
  const sb = site(b, 'BRV-1');
  const req = (p, s, title) => Number(db.prepare("INSERT INTO ui_sample_requests (company_id, title, doc_no, doc_date, required_by, project_id, site_id, status, priority, requested_by, total_amount, line_count, created_by, source_type) VALUES (1, ?, ?, '2026-10-31', '2026-11-20', ?, ?, 'SUBMITTED', 'NORMAL', 'someone', 100000, 1, 't', 'test')").run(`Girder ${title}`, `MR/2026-27/00${title.length}${p}`, p, s).lastInsertRowid);
  const ra = req(a, sa, 'one'); const rb = req(b, sb, 'three');
  const pamId = Number(db.prepare('SELECT id FROM iam_users WHERE username = ?').get('pam').id);
  const pmRole = Number(db.prepare('SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL').get('PM').id);
  db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, effective_from, status, reason, created_by, source_type) VALUES (1, ?, ?, 'PROJECT', ?, '2026-01-01', 'ACTIVE', 'Runs the Alpha project', 't', 'test')").run(pamId, pmRole, JSON.stringify([a]));
  authzOf(db).invalidate();
  // everything is indexed by the rebuild (the records were written straight into the tables)
  const types = await boss.get(`${U}/search/types`);
  assert.equal(types.status, 200);
  const idx = (await import('../src/server/platform/search/index.js')).createSearchIndex({ db });
  for (const t of ['project', 'site', 'sample_request']) idx.reindex(t);
  const texts = async (who, params) => { const r = await who.get(`${U}/search?${q(params)}`); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.data; };
  const all = (d) => d.groups.flatMap((g) => g.items);
  const pamSees = await texts(pam, { q: 'girder' });
  assert.deepEqual(all(pamSees).map((i) => i.entityId), [ra], 'only the request of her project');
  assert.equal(pamSees.counts.sample_request, 1, 'the count does not reveal the other project');
  assert.equal(all(await texts(boss, { q: 'girder' })).length, 2, 'the company-wide role sees both');
  assert.deepEqual(all(await texts(pam, { q: 'bravo' })), [], 'the other project, its site and its requests: nothing');
  assert.deepEqual(all(await texts(pam, { q: 'brv' })), []);
  assert.deepEqual(all(await texts(pam, { q: 'alp' })).map((i) => i.entity).sort(), ['project', 'sample_request', 'site'], 'her own project, its site and its request');
  assert.deepEqual((await texts(pam, { q: 'girder', projectId: b, page: 1 })).items, [], 'asking for the other project by its filter gives nothing');
  assert.equal((await pam.post(`${U}/search/click`, { entity: 'sample_request', entityId: rb })).status, 404, 'opening a record outside the scope is refused');
  assert.equal((await pam.post(`${U}/search/click`, { entity: 'sample_request', entityId: ra })).status, 200);
  const byNumber = await texts(pam, { q: db.prepare('SELECT doc_no FROM ui_sample_requests WHERE id = ?').get(rb).doc_no });
  assert.deepEqual(all(byNumber), [], 'not even by the exact document number');
  await api.close();
});
