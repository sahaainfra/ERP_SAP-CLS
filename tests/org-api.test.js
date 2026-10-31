import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { createOrgService } from '../src/server/modules/iam/org/service.js';
import { orgBlockers } from '../src/server/platform/org/index.js';
import { startApi } from './helpers.js';

const O = '/api/v1/iam/org';
const C = '/api/v1/core';
const sys = { roles: 'SYSADM', user: 'sysadmin', company: '1' };
const hr = { roles: 'HRMGR', user: 'hema', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };
const pd = { roles: 'PD', user: 'pradeep', company: '1' };
const pcm = { roles: 'PCMGR', user: 'pc', company: '1' };
const acc = { roles: 'ACCMGR', user: 'asha', company: '1' };
const cfo = { roles: 'CFO', user: 'chitra', company: '1' };
const quiet = () => createLogger({ write: () => {} });
const key = (n) => ({ 'idempotency-key': `org-${n}-${Math.random().toString(36).slice(2, 10)}` });

const square = [[19.076, 72.8777], [19.0778, 72.8777], [19.0778, 72.8796], [19.076, 72.8796], [19.076, 72.8777]];

async function setup(overrides = {}) {
  const api = await startApi({}, { logger: quiet(), ...overrides });
  const orgService = createOrgService({ db: api.db, approvals: null, clock: () => (overrides.identityOptions?.now ?? Date.now)() });
  const post = (path, who, body, n = 'p') => api.call('POST', O + path, { ...who, headers: key(n), body });
  const patch = (path, who, body) => api.call('PATCH', O + path, { ...who, body });
  const get = (path, who = sys) => api.call('GET', O + path, who);
  const user = (name, company = 1, site = null) => Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, site_id) VALUES (?, ?, ?, ?, ?)').run(company, name, `${name} Kumar`, '[]', site).lastInsertRowid);
  const decide = (id, who, action = 'approve') => api.call('POST', `${C}/change-requests/${id}/act`, { ...who, headers: key('d'), body: { action, comment: 'checked and fine' } });
  const project = async (code = 'P1', extra = {}) => (await post('/projects', pm, { code, name: `Project ${code}`, type: 'BUILDING', ...extra })).json.data;
  const activateProject = async (id) => {
    const r = await post(`/projects/${id}/activation-requests`, pm, { reason: 'Contract signed and mobilised' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal((await decide(r.json.data.id, pd)).status, 200);
    assert.equal((await decide(r.json.data.id, pcm)).status, 200);
  };
  return { api, post, patch, get, user, decide, project, activateProject, orgService };
}

test('AC-05 who may read and change each part of the organisation, and nobody anonymous', async () => {
  const { api, post, get } = await setup();
  for (const who of [sys, hr, pm, pd, pcm, acc, cfo]) assert.equal((await get('/projects', who)).status, 200, `${who.roles} can read`);
  assert.equal((await get('/projects', { user: null })).status, 401);
  assert.equal((await get('/projects', { roles: 'SUPPLIER', user: 'x', company: '1' })).status, 403, 'a role with no permission');
  assert.equal((await get('/context', { roles: 'SUPPLIER', user: 'x', company: '1' })).status, 200, 'everyone signed in reads their context');

  const dept = { code: 'ENG', name: 'Engineering' };
  assert.equal((await post('/departments', hr, dept)).status, 201, 'HRMGR maintains departments');
  assert.equal((await post('/departments', sys, { code: 'FIN', name: 'Finance' })).status, 201, 'SYSADM maintains departments');
  assert.equal((await post('/departments', pm, { code: 'X', name: 'X' })).status, 403);
  assert.equal((await post('/designations', hr, { code: 'ENGR', name: 'Engineer', level: 3 })).status, 201);
  assert.equal((await post('/designations', acc, { code: 'ZZ', name: 'No' })).status, 403);
  assert.equal((await post('/projects', pm, { code: 'P1', name: 'Tower', type: 'BUILDING' })).status, 201, 'PM creates a project');
  assert.equal((await post('/projects', hr, { code: 'P2', name: 'Tower', type: 'BUILDING' })).status, 403, 'HRMGR cannot create projects');
  assert.equal((await post('/projects', acc, { code: 'P2', name: 'Tower', type: 'BUILDING' })).status, 403);
  assert.equal((await post('/cost-centres', acc, { code: 'CC1', name: 'Overheads' })).status, 201, 'ACCMGR maintains cost centres');
  assert.equal((await post('/cost-centres', pm, { code: 'CC2', name: 'No' })).status, 403);
  assert.equal((await post('/branches', sys, { code: 'MUM', name: 'Mumbai', stateCode: '27' })).status, 201);
  assert.equal((await post('/branches', hr, { code: 'DEL', name: 'Delhi' })).status, 403);
  assert.equal((await post('/locations', sys, { code: 'HO', name: 'Head office', type: 'OFFICE' })).status, 201);
  assert.equal((await post('/locations', pm, { code: 'HO2', name: 'Head office', type: 'OFFICE' })).status, 403);
  assert.equal((await post('/departments', hr, { code: 'NOKEY', name: 'x' }, undefined)).status, 201);
  assert.equal((await api.call('POST', `${O}/departments`, { ...hr, body: dept })).status, 400, 'Idempotency-Key is required');
  assert.equal((await get('/nothings')).status, 404);
  await api.close();
});

test('a company without a company record gets a clear refusal, not a database error', async () => {
  const { api, post } = await setup();
  const res = await post('/departments', { ...hr, company: '77' }, { code: 'X', name: 'X' });
  assert.equal(res.status, 422);
  assert.match(res.json.error.message, /no company record/);
  await api.close();
});

test('FR-01 / BR-01 master data: codes are unique within the parent, a company is a master of its own', async () => {
  const { api, post, patch, get } = await setup();
  const co = await post('/companies', sys, { code: 'sahaa', legalName: 'Sahaa Infra Pvt Ltd', shortName: 'Sahaa', pan: 'abcde1234f', gstinPrimary: '27ABCDE1234F1Z5' });
  assert.equal(co.status, 400, 'a GSTIN with a wrong check character is refused');
  assert.match(JSON.stringify(co.json.error.details), /check character|PAN/);
  const ok = await post('/companies', sys, { code: 'sahaa', legalName: 'Sahaa Infra Pvt Ltd', shortName: 'Sahaa', pan: 'ABCDE1234F' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.data.code, 'SAHAA', 'codes are upper-cased');
  assert.equal(ok.json.data.companyId, ok.json.data.id);
  assert.equal((await post('/companies', sys, { code: 'SAHAA', legalName: 'Other', shortName: 'O' })).status, 409, 'company codes are unique system-wide');
  assert.equal((await get('/companies', hr)).json.data.length, 1, 'a company user sees only their own company');
  const own = { ...hr, company: String(ok.json.data.id) };
  assert.equal((await get('/companies', sys)).json.data.find((c) => c.id === ok.json.data.id).pan, 'ABCDE1234F', 'the system administrator sees the PAN');
  assert.equal((await get('/companies', own)).json.data[0].pan, 'AB******4F', 'everyone else sees it masked');
  assert.equal((await get('/companies', sys)).json.data.length, 2, 'the system administrator sees every company');

  const a = (await post('/departments', hr, { code: 'OPS', name: 'Operations', kind: 'DIVISION' })).json.data;
  const b = (await post('/departments', hr, { code: 'QA', name: 'Quality', parentId: a.id })).json.data;
  assert.equal((await post('/departments', hr, { code: 'QA', name: 'Quality 2', parentId: a.id })).status, 409, 'same code under the same parent');
  const c = await post('/departments', hr, { code: 'QA', name: 'Quality at root' });
  assert.equal(c.status, 201, 'the same code under another parent is allowed');
  assert.equal((await post('/departments', hr, { code: 'Q9', name: 'Bad parent', parentId: 9999 })).status, 400);
  assert.equal((await patch(`/departments/${b.id}`, hr, { name: 'Quality Assurance', version: b.version })).status, 200);
  assert.equal((await patch(`/departments/${b.id}`, hr, { name: 'Again', version: b.version })).status, 409, 'optimistic locking');
  assert.equal((await patch(`/departments/${b.id}`, hr, { version: b.version + 1 })).status, 400, 'nothing to change');
  assert.equal((await patch(`/departments/${b.id}`, hr, { headUserId: 1, version: b.version + 1 })).status, 400, 'the head changes through assignments');

  const region = (await post('/branches', sys, { code: 'WEST', name: 'West region', kind: 'REGION' })).json.data;
  const branch = await post('/branches', sys, { code: 'MUM', name: 'Mumbai', parentId: region.id, stateCode: '27', gstin: '27AAPFU0939F1ZV' });
  assert.equal(branch.status, 201, JSON.stringify(branch.json));
  assert.equal((await post('/branches', sys, { code: 'PNQ', name: 'Pune', parentId: branch.json.data.id })).status, 400, 'only a region has branches under it');
  assert.equal((await post('/branches', sys, { code: 'GOA', name: 'Goa', stateCode: '30', gstin: '27AAPFU0939F1ZV' })).status, 400, 'GSTIN state must match the branch state');
  await api.close();
});

test('T-02 a five-level department hierarchy returns the right descendants and cannot loop', async () => {
  const { api, post, patch, get } = await setup();
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await post('/departments', hr, { code: `L${i + 1}`, name: `Level ${i + 1}`, parentId: ids[i - 1] ?? undefined })).json.data.id);
  const side = (await post('/departments', hr, { code: 'SIDE', name: 'Side branch', parentId: ids[1] })).json.data.id;
  const other = (await post('/departments', hr, { code: 'OTHER', name: 'Another tree' })).json.data.id;

  const all = (await get(`/departments/${ids[0]}/descendants`, hr)).json.data;
  assert.deepEqual(all.map((d) => [d.code, d.depth]), [['L1', 0], ['L2', 1], ['L3', 2], ['SIDE', 2], ['L4', 3], ['L5', 4]]);
  const part = (await get(`/departments/${ids[2]}/descendants`, hr)).json.data;
  assert.deepEqual(part.map((d) => d.code), ['L3', 'L4', 'L5']);
  assert.deepEqual((await get(`/departments/${other}/descendants`, hr)).json.data.map((d) => d.code), ['OTHER']);
  assert.deepEqual((await get(`/departments/${side}/descendants`, hr)).json.data.map((d) => d.code), ['SIDE']);

  const l1 = (await get(`/departments/${ids[0]}`, hr)).json.data;
  const loop = await patch(`/departments/${ids[0]}`, hr, { parentId: ids[4], version: l1.version });
  assert.equal(loop.status, 400, 'a unit cannot move under its own descendant');
  assert.match(JSON.stringify(loop.json.error.details), /own descendants/);
  assert.equal((await patch(`/departments/${ids[0]}`, hr, { parentId: ids[0], version: l1.version })).status, 400);
  const l5 = (await get(`/departments/${ids[4]}`, hr)).json.data;
  const moved = await patch(`/departments/${ids[4]}`, hr, { parentId: other, version: l5.version });
  assert.equal(moved.status, 200, 'moving to another tree is fine (the org chart drag and drop)');
  assert.deepEqual((await get(`/departments/${ids[0]}/descendants`, hr)).json.data.map((d) => d.code), ['L1', 'L2', 'L3', 'SIDE', 'L4']);

  const tree = (await get('/tree', hr)).json.data;
  assert.equal(tree.departments.length, 2, 'two roots');
  assert.equal(tree.departments[0].children[0].children[0].code, 'L3');
  assert.equal((await get('/projects/1/descendants', hr)).status, 404, 'a project has no hierarchy');
  await api.close();
});

test('FR-02 / FR-03 / BR-01 projects and sites: a site belongs to one project, codes are unique per project', async () => {
  const { api, post, patch, get, project } = await setup();
  const p = await project('P1', { clientName: 'City Authority', startDate: '2026-04-01', endDate: '2028-03-31' });
  assert.equal(p.status, 'DRAFT');
  assert.equal((await post('/projects', pm, { code: 'P1', name: 'Dup', type: 'ROAD' })).status, 409, 'project codes are unique in the company');
  assert.equal((await post('/projects', pm, { code: 'P3', name: 'Bad dates', type: 'ROAD', startDate: '2026-05-01', endDate: '2026-04-01' })).status, 400);
  assert.equal((await post('/projects', pm, { code: 'P3', name: 'Bad type', type: 'SPACEPORT' })).status, 400);
  assert.equal((await post('/projects', pm, { code: 'P3', name: 'Bad branch', type: 'ROAD', branchId: 77 })).status, 400);

  const s = await post('/sites', pm, { projectId: p.id, code: 'S1', name: 'Tower A', siteType: 'SITE', address: 'Plot 4' });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(s.json.data.status, 'DRAFT');
  assert.equal(s.json.data.projectCode, 'P1');
  assert.equal((await post('/sites', pm, { projectId: p.id, code: 's1', name: 'Dup' })).status, 409, 'unique within the project');
  const p2 = await project('P2');
  assert.equal((await post('/sites', pm, { projectId: p2.id, code: 'S1', name: 'Same code, other project' })).status, 201);
  assert.equal((await post('/sites', pm, { projectId: 999, code: 'S9', name: 'No project' })).status, 400);
  assert.equal((await patch(`/sites/${s.json.data.id}`, pm, { projectId: p2.id, version: 1 })).status, 400, 'a site cannot move to another project');
  assert.equal((await get(`/sites?filter[projectId]=${p.id}`, pm)).json.data.length, 1);
  assert.equal((await get('/sites?filter[bogus]=1', pm)).status, 400);
  assert.equal((await get('/sites?q=tower&sort=-name', pm)).json.data.length, 1);
  await api.close();
});

test('FR-03 / BR-02 a draft site takes its geofence directly; the editor rules apply', async () => {
  const { api, post, patch, get, project } = await setup();
  const p = await project();
  const s = (await post('/sites', pm, { projectId: p.id, code: 'S1', name: 'Tower A' })).json.data;
  assert.equal((await patch(`/sites/${s.id}`, pm, { geofenceType: 'CIRCLE', latitude: 19.076, longitude: 72.8777, geofenceRadiusM: 10, version: 1 })).status, 400, 'radius below 25 m');
  assert.equal((await patch(`/sites/${s.id}`, pm, { geofenceType: 'CIRCLE', latitude: 19.076, longitude: 72.8777, geofenceRadiusM: 6000, version: 1 })).status, 400, 'radius above 5 km');
  assert.equal((await patch(`/sites/${s.id}`, pm, { geofenceType: 'CIRCLE', geofenceRadiusM: 100, version: 1 })).status, 400, 'a circle needs a centre');
  assert.equal((await patch(`/sites/${s.id}`, pm, { geofenceType: 'POLYGON', geofencePolygon: square.slice(0, 4), version: 1 })).status, 400, 'an open polygon');
  const bow = [[19.076, 72.8777], [19.0778, 72.8796], [19.0778, 72.8777], [19.076, 72.8796], [19.076, 72.8777]];
  assert.equal((await patch(`/sites/${s.id}`, pm, { geofenceType: 'POLYGON', geofencePolygon: bow, version: 1 })).status, 400, 'a self-crossing polygon');
  const set = await patch(`/sites/${s.id}`, pm, { geofenceType: 'CIRCLE', latitude: 19.076, longitude: 72.8777, geofenceRadiusM: 100, workingStart: '08:00', workingEnd: '17:30', version: 1 });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.deepEqual(set.json.data.geofence, { type: 'CIRCLE', latitude: 19.076, longitude: 72.8777, radiusM: 100, polygon: null });
  assert.equal((await patch(`/sites/${s.id}`, pm, { workingStart: '18:00', workingEnd: '17:30', version: 2 })).status, 400, 'hours end after they start');
  const poly = await patch(`/sites/${s.id}`, pm, { geofenceType: 'POLYGON', geofencePolygon: square, version: 2 });
  assert.equal(poly.status, 200, JSON.stringify(poly.json));
  assert.equal(poly.json.data.geofence.type, 'POLYGON');
  assert.equal(poly.json.data.geofence.radiusM, null);
  assert.ok(Math.abs(poly.json.data.latitude - 19.0769) < 1e-6, 'the centre of a polygon is its centroid');

  // the test endpoints
  const t = (lat, lng, extra = {}) => api.call('POST', `${O}/sites/${s.id}/geofence/test`, { ...pm, body: { latitude: lat, longitude: lng, ...extra } });
  assert.equal((await t(19.0769, 72.8786)).json.data.inside, true);
  assert.equal((await t(19.079, 72.8786)).json.data.inside, false);
  const edge = (await t(19.075955, 72.8786, { toleranceM: 10 })).json.data;
  assert.deepEqual([edge.inside, edge.strictlyInside, edge.method], [true, false, 'POLYGON']);
  assert.equal((await t(19.075955, 72.8786, { toleranceM: 2 })).json.data.inside, false);
  assert.equal((await t(100, 72)).status, 400, 'latitude out of range');
  const shape = await api.call('POST', `${O}/geofence/test`, { ...pm, body: { geofence: { type: 'CIRCLE', latitude: 19.076, longitude: 72.8777, radiusM: 100 }, latitude: 19.0765, longitude: 72.8777 } });
  assert.equal(shape.json.data.inside, true, 'an unsaved shape from the editor can be tested');
  const noFence = (await post('/sites', pm, { projectId: p.id, code: 'S2', name: 'No fence' })).json.data;
  assert.equal((await api.call('POST', `${O}/sites/${noFence.id}/geofence/test`, { ...pm, body: { latitude: 19, longitude: 72 } })).status, 422);
  assert.equal((await get(`/sites/${s.id}`, acc)).json.data.geofence.type, 'POLYGON');
  await api.close();
});

test('AC-06 a project and its sites become active only through PD then PCMGR; the requester cannot approve; nothing bypasses it', async () => {
  const { api, post, patch, get, project, decide, activateProject } = await setup();
  const p = await project('P1');
  const s = (await post('/sites', pm, { projectId: p.id, code: 'S1', name: 'Tower A' })).json.data;
  assert.equal((await post(`/projects/${p.id}/status`, pm, { status: 'ACTIVE', reason: 'just do it please', version: 1 })).status, 422, 'no direct activation of a project');
  assert.equal((await post(`/projects/${p.id}/activate`, pm, { reason: 'just do it please', version: 1 })).status, 422, 'no activate shortcut');
  assert.equal((await post(`/sites/${s.id}/activation-requests`, pm, { reason: 'Mobilise the site now' })).status, 422, 'the project must be active first');
  assert.equal((await post(`/projects/${p.id}/activation-requests`, acc, { reason: 'I would like this' })).status, 403);
  assert.equal((await post(`/projects/${p.id}/activation-requests`, pm, { reason: 'no' })).status, 400, 'reason of at least 5 characters');

  const req = await post(`/projects/${p.id}/activation-requests`, pm, { reason: 'Contract signed and mobilised' });
  assert.equal(req.status, 201);
  assert.deepEqual(req.json.data.chain, ['PD', 'PCMGR']);
  assert.equal((await post(`/projects/${p.id}/activation-requests`, pm, { reason: 'Again please sir' })).status, 409, 'one open request at a time');
  assert.equal((await decide(req.json.data.id, pm)).status, 403, 'the requester cannot decide');
  assert.equal((await decide(req.json.data.id, pcm)).status, 403, 'the second step cannot go first');
  assert.equal((await get(`/projects/${p.id}`)).json.data.status, 'DRAFT', 'still a draft');
  assert.equal((await decide(req.json.data.id, pd)).status, 200);
  assert.equal((await get(`/projects/${p.id}`)).json.data.status, 'DRAFT', 'one step is not enough');
  assert.equal((await decide(req.json.data.id, pcm)).status, 200);
  assert.equal((await get(`/projects/${p.id}`)).json.data.status, 'ACTIVE');
  const rows = (await get(`/projects/${p.id}/requests`)).json.data;
  assert.equal(rows[0].status, 'APPROVED');
  assert.equal(rows[0].steps.length, 2, 'the approval history is on the record');

  assert.equal((await post(`/sites/${s.id}/activation-requests`, pm, { reason: 'Mobilise the site now' })).status, 201);
  const siteReq = (await get(`/sites/${s.id}/requests`)).json.data[0];
  assert.equal((await decide(siteReq.id, pd, 'reject')).status, 200, 'a rejection stops it');
  assert.equal((await get(`/sites/${s.id}`)).json.data.status, 'DRAFT');
  const again = await post(`/sites/${s.id}/activation-requests`, pm, { reason: 'Resubmitted with the survey' });
  await decide(again.json.data.id, pd);
  await decide(again.json.data.id, pcm);
  assert.equal((await get(`/sites/${s.id}`)).json.data.status, 'ACTIVE');
  assert.equal((await post(`/sites/${s.id}/activation-requests`, pm, { reason: 'Already active, really' })).status, 422);

  // status moves of the project
  assert.equal((await post(`/projects/${p.id}/status`, pm, { status: 'ON_HOLD', reason: 'Monsoon pause', version: (await get(`/projects/${p.id}`)).json.data.version })).status, 200);
  assert.equal((await post(`/projects/${p.id}/status`, pm, { status: 'ACTIVE', reason: 'Monsoon is over', version: (await get(`/projects/${p.id}`)).json.data.version })).status, 200, 'a resume needs no approval');
  assert.equal((await post(`/projects/${p.id}/status`, pm, { status: 'CLOSED', reason: 'Wrapping up', version: (await get(`/projects/${p.id}`)).json.data.version })).status, 422, 'must be completed first');
  const done = await post(`/projects/${p.id}/status`, pm, { status: 'COMPLETED', reason: 'Handed over', version: (await get(`/projects/${p.id}`)).json.data.version });
  assert.equal(done.status, 422, 'an active site blocks completion');
  assert.match(done.json.error.message, /1 active sites/);
  void activateProject; void patch;
  await api.close();
});

test('AC-06 a geofence change on an active site goes HRMGR or PM then SYSADM, with a reason; direct edits are refused', async () => {
  const { api, post, patch, get, project, decide, activateProject } = await setup();
  const p = await project();
  await activateProject(p.id);
  const s = (await post('/sites', pm, { projectId: p.id, code: 'S1', name: 'Tower A', geofenceType: 'CIRCLE', latitude: 19.076, longitude: 72.8777, geofenceRadiusM: 100 })).json.data;
  const r = await post(`/sites/${s.id}/activation-requests`, pm, { reason: 'Mobilise the site now' });
  await decide(r.json.data.id, pd);
  await decide(r.json.data.id, pcm);
  const live = (await get(`/sites/${s.id}`)).json.data;
  assert.equal(live.status, 'ACTIVE');

  const direct = await patch(`/sites/${s.id}`, pm, { geofenceRadiusM: 250, geofenceType: 'CIRCLE', latitude: 19.076, longitude: 72.8777, version: live.version });
  assert.equal(direct.status, 422, 'a direct geofence edit on an active site is refused');
  assert.match(direct.json.error.message, /geofence change request/);
  assert.equal((await patch(`/sites/${s.id}`, pm, { address: 'Plot 4, Andheri', version: live.version })).status, 200, 'other fields are still edited directly');

  const body = { geofence: { type: 'CIRCLE', latitude: 19.076, longitude: 72.8777, radiusM: 250 }, reason: 'Site boundary widened for the new yard' };
  assert.equal((await post(`/sites/${s.id}/geofence/change-requests`, acc, body)).status, 403);
  assert.equal((await post(`/sites/${s.id}/geofence/change-requests`, pm, { ...body, reason: '' })).status, 400, 'a reason is mandatory');
  assert.equal((await post(`/sites/${s.id}/geofence/change-requests`, pm, { ...body, geofence: { ...body.geofence, radiusM: 10 } })).status, 400, 'the rules apply to the request too');
  assert.equal((await post(`/sites/${s.id}/geofence/change-requests`, pm, { ...body, geofence: { type: 'CIRCLE', latitude: 19.076, longitude: 72.8777, radiusM: 100 } })).status, 422, 'no change');
  const req = await post(`/sites/${s.id}/geofence/change-requests`, hr, body);
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.deepEqual(req.json.data.chain, ['SYSADM']);
  assert.equal((await post(`/sites/${s.id}/geofence/change-requests`, pm, body)).status, 409, 'one open request at a time');
  assert.equal((await decide(req.json.data.id, hr)).status, 403, 'the requester cannot approve (and has no SYSADM role)');
  assert.equal((await decide(req.json.data.id, { ...sys, user: 'hema' })).status, 403, 'even as SYSADM the requester cannot approve their own request');
  assert.equal((await get(`/sites/${s.id}`)).json.data.geofence.radiusM, 100, 'unchanged before approval');
  assert.equal((await decide(req.json.data.id, sys)).status, 200);
  const after = (await get(`/sites/${s.id}`)).json.data;
  assert.equal(after.geofence.radiusM, 250);
  const history = (await get(`/sites/${s.id}/history`)).json.data;
  const row = history.audit.find((a) => a.action === 'geofence_change_approved');
  assert.equal(row.before.radiusM, 100);
  assert.equal(row.after.radiusM, 250);
  assert.equal(row.reason, body.reason);
  const events = api.db.prepare("SELECT event_type AS type FROM core_outbox WHERE event_type = 'iam.site.geofence_changed'").all();
  assert.equal(events.length, 1);

  const draft = (await post('/sites', pm, { projectId: p.id, code: 'S2', name: 'Draft' })).json.data;
  assert.equal((await post(`/sites/${draft.id}/geofence/change-requests`, pm, body)).status, 422, 'a draft is edited directly');
  await api.close();
});

test('T-03 / BR-03 a site with open records cannot be deactivated; every blocker is listed', async () => {
  const { api, post, get, user, project, decide, activateProject } = await setup();
  const p = await project();
  await activateProject(p.id);
  const s = (await post('/sites', pm, { projectId: p.id, code: 'S1', name: 'Tower A' })).json.data;
  const r = await post(`/sites/${s.id}/activation-requests`, pm, { reason: 'Mobilise the site now' });
  await decide(r.json.data.id, pd);
  await decide(r.json.data.id, pcm);
  user('worker1', 1, s.id);
  user('worker2', 1, s.id);
  const cc = await post('/cost-centres', acc, { code: 'CC-S1', name: 'Tower A cost', linkedType: 'SITE', linkedId: s.id });
  assert.equal(cc.status, 201, JSON.stringify(cc.json));
  const calls = [];
  orgBlockers.register('site', 'test.attendance', (_db, ctx) => { calls.push(ctx); return [{ type: 'open attendance days', count: 4, hint: 'Close the attendance.' }]; });

  const version = (await get(`/sites/${s.id}`)).json.data.version;
  const blocked = await post(`/sites/${s.id}/deactivate`, pm, { reason: 'Site demobilised', version });
  assert.equal(blocked.status, 422);
  const msg = blocked.json.error.message;
  assert.match(msg, /2 active users assigned to the site/);
  assert.match(msg, /1 active cost centres linked to it/);
  assert.match(msg, /4 open attendance days/);
  assert.equal(blocked.json.error.details.length, 3, 'every blocker is listed');
  assert.deepEqual(calls[0], { companyId: 1, id: s.id });
  assert.equal((await get(`/sites/${s.id}`)).json.data.status, 'ACTIVE', 'still active');
  const listed = (await get(`/sites/${s.id}/blockers`)).json.data;
  assert.equal(listed.length, 3);

  orgBlockers.unregister('site', 'test.attendance');
  api.db.prepare('UPDATE iam_users SET site_id = NULL WHERE site_id = ?').run(s.id);
  const ccRow = (await get(`/cost-centres/${cc.json.data.id}`)).json.data;
  assert.equal((await post(`/cost-centres/${ccRow.id}/deactivate`, acc, { reason: 'No longer needed', version: ccRow.version })).status, 200);
  const ok = await post(`/sites/${s.id}/deactivate`, pm, { reason: 'Site demobilised', version });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.status, 'INACTIVE');
  assert.equal((await post(`/sites/${s.id}/deactivate`, pm, { reason: 'Site demobilised', version: ok.json.data.version })).status, 422, 'already inactive');
  assert.equal((await post(`/sites/${s.id}/activate`, pm, { reason: 'Back again', version: ok.json.data.version })).status, 422, 'reactivation needs approval');
  const back = await post(`/sites/${s.id}/activation-requests`, pm, { reason: 'Work resumes next month' });
  assert.equal(back.status, 201, 'an inactive site is re-activated through the same approval');

  // a department with a sub-department, and a project with an active site, are blocked the same way
  const d = (await post('/departments', hr, { code: 'D1', name: 'D1' })).json.data;
  await post('/departments', hr, { code: 'D2', name: 'D2', parentId: d.id });
  const bd = await post(`/departments/${d.id}/deactivate`, hr, { reason: 'Reorganised away', version: d.version });
  assert.equal(bd.status, 422);
  assert.match(bd.json.error.message, /1 active sub-departments/);
  await api.close();
});

test('FR-07 effective-dated assignments keep a history, and a future change waits for its date', async () => {
  let now = Date.parse('2026-10-31T06:00:00Z');
  const { api, post, get, user, project, orgService } = await setup({ identityOptions: { now: () => now } });
  const p = await project();
  const s = (await post('/sites', pm, { projectId: p.id, code: 'S1', name: 'Tower A' })).json.data;
  const a = user('anil');
  const b = user('bina');
  const c = user('chetan');
  const other = user('outsider', 2);
  assert.equal((await post(`/sites/${s.id}/assignments`, pm, { userId: other, effectiveFrom: '2026-10-31', reason: 'Wrong company' })).status, 400, 'a user of another company');
  assert.equal((await post(`/sites/${s.id}/assignments`, pm, { userId: a, effectiveFrom: '2026-10-01', reason: 'First in-charge' })).status, 201);
  assert.equal((await get(`/sites/${s.id}`)).json.data.inChargeUsername, 'anil');
  assert.equal((await post(`/sites/${s.id}/assignments`, pm, { userId: a, effectiveFrom: '2026-10-31', reason: 'Same person again' })).status, 422);
  assert.equal((await post(`/sites/${s.id}/assignments`, pm, { userId: b, effectiveFrom: '2026-09-01', reason: 'Before the current start' })).status, 422);
  const immediate = await post(`/sites/${s.id}/assignments`, pm, { userId: b, effectiveFrom: '2026-10-31', reason: 'Anil moved to head office' });
  assert.equal(immediate.json.data.applied, true);
  assert.equal((await get(`/sites/${s.id}`)).json.data.inChargeUsername, 'bina');

  const future = await post(`/sites/${s.id}/assignments`, pm, { userId: c, effectiveFrom: '2026-11-15', reason: 'Bina goes on leave' });
  assert.equal(future.json.data.applied, false);
  assert.equal((await get(`/sites/${s.id}`)).json.data.inChargeUsername, 'bina', 'not yet');
  assert.equal((await post(`/sites/${s.id}/assignments`, pm, { userId: a, effectiveFrom: '2026-11-20', reason: 'Another waiting change' })).status, 409);
  const h = (await get(`/sites/${s.id}/history`)).json.data.assignments;
  assert.deepEqual(h.map((x) => [x.user, x.effectiveFrom, x.effectiveTo, x.pending]), [['chetan', '2026-11-15', null, true], ['bina', '2026-10-31', null, false], ['anil', '2026-10-01', '2026-10-31', false]]);

  const svc = orgService;
  assert.equal(svc.applyDueAssignments().applied, 0, 'its date has not come');
  now = Date.parse('2026-11-15T06:00:00Z');
  assert.equal(svc.applyDueAssignments().applied, 1);
  assert.equal((await get(`/sites/${s.id}`)).json.data.inChargeUsername, 'chetan');
  const h2 = (await get(`/sites/${s.id}/history`)).json.data.assignments;
  assert.deepEqual(h2.map((x) => [x.user, x.effectiveTo]), [['chetan', null], ['bina', '2026-11-15'], ['anil', '2026-10-31']]);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'iam.site.in_charge_changed'").get().n, 3);

  const waiting = await post(`/sites/${s.id}/assignments`, pm, { userId: a, effectiveFrom: '2026-12-01', reason: 'Plan changed later' });
  assert.equal(waiting.status, 201);
  const aid = (await get(`/sites/${s.id}/history`)).json.data.assignments.find((x) => x.pending).id;
  assert.equal((await api.call('DELETE', `${O}/sites/${s.id}/assignments/${aid}`, { ...pm })).status, 200, 'a waiting change can be cancelled');
  assert.equal((await api.call('DELETE', `${O}/sites/${s.id}/assignments/${aid}`, { ...pm })).status, 404);
  assert.equal((await post(`/projects/${p.id}/assignments`, pm, { userId: a, effectiveFrom: '2026-10-31', reason: 'First manager' })).status, 201);
  assert.equal((await get(`/projects/${p.id}`)).json.data.pmUsername, 'anil');
  assert.equal((await post('/cost-centres/1/assignments', acc, { userId: a, effectiveFrom: '2026-10-31', reason: 'No such thing' })).status, 404);
  await api.close();
});

test('AC-05 cross-company isolation: another company sees and changes nothing here', async () => {
  const { api, post, patch, get, project } = await setup();
  assert.equal((await post('/companies', sys, { code: 'TWO', legalName: 'Two Ltd', shortName: 'Two' })).status, 201);
  const p = await project('P1');
  const s = (await post('/sites', pm, { projectId: p.id, code: 'S1', name: 'Tower A' })).json.data;
  const d = (await post('/departments', hr, { code: 'ENG', name: 'Engineering' })).json.data;
  const pm2 = { ...pm, company: '2' };
  const hr2 = { ...hr, company: '2' };
  assert.equal((await get('/projects', pm2)).json.data.length, 0);
  assert.equal((await get(`/projects/${p.id}`, pm2)).status, 404);
  assert.equal((await get(`/sites/${s.id}`, pm2)).status, 404);
  assert.equal((await patch(`/sites/${s.id}`, pm2, { name: 'Hacked', version: 1 })).status, 404);
  assert.equal((await post(`/sites/${s.id}/deactivate`, pm2, { reason: 'Not mine at all', version: 1 })).status, 404);
  assert.equal((await post(`/projects/${p.id}/activation-requests`, pm2, { reason: 'Not mine at all' })).status, 404);
  assert.equal((await get(`/departments/${d.id}/descendants`, hr2)).status, 404);
  assert.equal((await post('/sites', pm2, { projectId: p.id, code: 'X1', name: 'Into their project' })).status, 400, 'cannot add a site to another company project');
  assert.equal((await post('/departments', hr2, { code: 'X', name: 'X', parentId: d.id })).status, 400, 'cannot hang a department under another company');
  assert.equal((await post('/projects', pm2, { code: 'P1', name: 'Same code, own company', type: 'ROAD' })).status, 201, 'codes are per company');
  assert.equal((await get('/tree', pm2)).json.data.projects.length, 1, 'their tree holds only their own project');
  const ctx = (await get('/context', pm2)).json.data;
  assert.equal(ctx.projects.length, 1);
  assert.equal(ctx.companies[0].id, 2);
  assert.equal((await get('/projects', { user: 'x', roles: 'PM', company: '' })).status, 403, 'no company scope: deny by default');
  await api.close();
});

test('FR-05 cost and profit centres: hierarchy, links to a department, project or site', async () => {
  const { api, post, patch, get, project } = await setup();
  const p = await project();
  const root = (await post('/cost-centres', acc, { code: 'ROOT', name: 'Group', type: 'PROFIT' })).json.data;
  const child = (await post('/cost-centres', acc, { code: 'OPS', name: 'Operations', parentId: root.id, linkedType: 'PROJECT', linkedId: p.id })).json.data;
  assert.equal(child.linkedName, 'Project P1');
  assert.equal((await post('/cost-centres', acc, { code: 'BAD', name: 'Bad', linkedType: 'PROJECT' })).status, 400, 'a type without a record');
  assert.equal((await post('/cost-centres', acc, { code: 'BAD', name: 'Bad', linkedType: 'SITE', linkedId: 999 })).status, 400, 'a record that does not exist');
  const grand = (await post('/cost-centres', acc, { code: 'OPS', name: 'Same code, other parent', parentId: root.id })).status;
  assert.equal(grand, 409);
  assert.equal((await patch(`/cost-centres/${root.id}`, acc, { parentId: child.id, version: root.version })).status, 400, 'no loops');
  assert.deepEqual((await get(`/cost-centres/${root.id}/descendants`, acc)).json.data.map((d) => d.code), ['ROOT', 'OPS']);
  assert.equal((await post(`/cost-centres/${root.id}/deactivate`, acc, { reason: 'Closing the group', version: root.version })).status, 422, 'a child blocks it');
  assert.equal((await get('/cost-centres?filter[type]=PROFIT', acc)).json.data.length, 1);
  assert.equal((await get('/tree', acc)).json.data.costCentres[0].children[0].code, 'OPS');
  await api.close();
});

test('FR-04 locations, FR-08 context and the audit trail and events', async () => {
  const { api, post, get, project } = await setup();
  const loc = await post('/locations', sys, { code: 'BP1', name: 'Batching plant 1', type: 'BATCHING_PLANT', latitude: 19.1, longitude: 72.9, stateCode: '27' });
  assert.equal(loc.status, 201);
  assert.equal((await post('/locations', sys, { code: 'BP1', name: 'Dup', type: 'OFFICE' })).status, 409);
  assert.equal((await post('/locations', sys, { code: 'BP2', name: 'Bad', type: 'OFFICE', latitude: 91, longitude: 0 })).status, 400);
  assert.equal((await get('/locations?filter[type]=BATCHING_PLANT', pm)).json.data.length, 1);

  const p = await project('P1');
  await project('P2');
  const ctx = (await get('/context', pm)).json.data;
  assert.deepEqual(ctx.projects.map((x) => x.code), ['P1', 'P2']);
  assert.equal(ctx.companies[0].code, 'MAIN');
  assert.equal(ctx.sites.length, 0);

  const audit = api.db.prepare("SELECT action, actor FROM core_audit_log WHERE entity = 'org_projects' AND entity_id = ?").all(String(p.id));
  assert.deepEqual(audit.map((a) => a.action), ['create']);
  const events = api.db.prepare("SELECT event_type AS type FROM core_outbox WHERE event_type LIKE 'iam.project.%' OR event_type LIKE 'iam.location.%'").all().map((e) => e.type);
  assert.ok(events.includes('iam.project.created') && events.includes('iam.location.created'));
  await api.close();
});

test('the whole organisation master is hidden while ff.iam.p0202 is OFF', async () => {
  const { api, get } = await setup();
  assert.equal((await get('/projects', pm)).status, 200);
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.iam.p0202'").run();
  const res = await get('/projects', pm);
  assert.equal(res.status, 404);
  assert.match(res.json.error.message, /ff\.iam\.p0202/);
  await api.close();
});

test('error handling: validation names the field, a stale version conflicts, an idempotent replay returns the first answer', async () => {
  const { api, post, patch, get } = await setup();
  const bad = await post('/departments', hr, { code: 'bad code!', name: '' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.details.length >= 2);
  assert.equal((await post('/departments', hr, { code: 'X', name: 'Y', nonsense: 1 })).status, 400, 'unknown fields are refused');
  const k = key('replay');
  const first = await api.call('POST', `${O}/designations`, { ...hr, headers: k, body: { code: 'GM', name: 'General Manager', level: 9 } });
  const again = await api.call('POST', `${O}/designations`, { ...hr, headers: k, body: { code: 'GM', name: 'General Manager', level: 9 } });
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.equal(again.json.data.id, first.json.data.id, 'the replay returns the first answer');
  assert.equal((await get('/designations', hr)).json.data.length, 1, 'and creates nothing twice');
  assert.equal((await patch('/designations/' + first.json.data.id, hr, { level: 21, version: 1 })).status, 400);
  assert.equal((await patch('/designations/' + first.json.data.id, hr, { level: 8, version: 1 })).status, 200);
  assert.equal((await patch('/designations/' + first.json.data.id, hr, { level: 7, version: 1 })).status, 409);
  await api.close();
});
