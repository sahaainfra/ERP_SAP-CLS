import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { projectsOf } from '../src/server/modules/proj/project.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.01: the project master, the lifecycle and the setup wizard. T-01 the wizard makes the project, its sites, its numbering series, its document folders and its key dates in one transaction (and nothing when any part is refused);
// the transition rules are enforced (only the allowed moves, the checklist ticked, the blockers cleared, suspension and closure by the chain). Also: the activation by the project director and the director (never by the maker, and not
// by the plain activation of the organisation master), the organisation project and its sites following the lifecycle, the contract terms of a live project changing only by an approved amendment, the milestones register, the portfolio with
// health, roles, project isolation, another company, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `prj-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pcm = as('PCMGR', 'ppcm1'); const pd1 = as('PD', 'ppd1'); const pd2 = as('PD', 'ppd2'); const pm1 = as('PM', 'ppm1'); const pm2 = as('PM', 'ppm2'); const dir = as('DIR', 'pdir1'); const dir2 = as('DIR', 'pdir2'); const qs = as('QS', 'pqs1'); const se = as('SE', 'pse1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['ppcm1', ['PCMGR']], ['ppd1', ['PD']], ['ppd2', ['PD']], ['ppm1', ['PM']], ['ppm2', ['PM']], ['pdir1', ['DIR']], ['pdir2', ['DIR']], ['pqs1', ['QS']], ['pse1', ['SE']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const tasks = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await tasks(who)).find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked against the contract' } }); assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const partner = (code, name, role, status = 'ACTIVE', company = 1) => { const id = Number(api.db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'COMMGR', 't', 'test')").run(company, code, name, name.toLowerCase(), status).lastInsertRowid); api.db.prepare('INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, ?)').run(company, id, role); return id; };
  const ids = { client: partner('CL100', 'National Highways Authority', 'CLIENT'), consultant: partner('CN100', 'Mott Engineers', 'CONSULTANT'), vendor: partner('VN100', 'Steel Traders', 'VENDOR'), blocked: partner('CL101', 'Blacklisted Client', 'CLIENT', 'BLACKLISTED'), funder: partner('VN101', 'Infra Bank', 'SERVICE_PROVIDER') };
  const wizard = (over = {}) => ({
    basics: { code: 'NH48-P3', name: 'Four-laning of NH-48, package 3', type: 'ROAD', sector: 'ROADS', location: 'Pune', ...(over.basics ?? {}) },
    contract: { clientPartnerId: ids.client, consultantPartnerId: ids.consultant, funderPartnerId: ids.funder, contractType: 'ITEM_RATE', contractNo: 'NHAI/2027/118', contractValue: '972000000', startDate: '2026-12-01', scheduledCompletion: '2028-11-30', dlpMonths: 24, retentionPct: '5', mobAdvancePct: '10', ldSummary: '0.05 % per day up to 10 % of the contract value', ...(over.contract ?? {}) },
    sites: over.sites ?? [{ code: 'NH48-S1', name: 'Pune main camp', siteType: 'SITE', address: 'Km 12, Pune', latitude: 18.52, longitude: 73.85, geofenceType: 'CIRCLE', geofenceRadiusM: 400 }, { code: 'NH48-S2', name: 'Batching plant', siteType: 'PLANT', latitude: 18.55, longitude: 73.9, geofenceType: 'CIRCLE', geofenceRadiusM: 250 }],
    team: { pmUser: 'ppm1', directorUser: 'ppd1', ...(over.team ?? {}) },
    setup: over.setup ?? {}, milestones: over.milestones ?? [{ code: 'M1', name: 'Mobilisation complete', plannedDate: '2027-01-31', contractual: true, paymentLinked: true }, { code: 'M2', name: 'Earthwork 50 %', plannedDate: '2027-09-30', contractual: false, paymentLinked: false }],
    ...(over.top ?? {}),
  });
  return { api, call, act, tasks, ids, wizard };
}
const ALL = [0, 1, 2, 3];
const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;
const activate = async (t, who, id) => {
  const s = await t.call(who, 'POST', `/projects/${id}/submit`, { ticked: ALL }); assert.equal(s.status, 202, JSON.stringify(s.json));
  const inst = s.json.data.workflowInstanceId;
  await t.act(pd1, inst); await t.act(dir, inst);
  return (await t.call(who, 'GET', `/projects/${id}`)).json.data;
};

test('T-01 the wizard makes the project, its sites, numbering series, folders and key dates in one transaction, and nothing when a part is refused', async () => {
  const t = await setup();
  const c = await t.call(pcm, 'POST', '/projects', t.wizard());
  assert.equal(c.status, 201, JSON.stringify(c.json)); const p = c.json.data;
  assert.deepEqual([p.code, p.status, p.state, p.orgStatus, p.client.name, p.consultant.name, p.funder.name, p.contractValue, p.retentionPct, p.mobAdvancePct, p.dlpMonths], ['NH48-P3', 'DRAFT', 'SETUP', 'DRAFT', 'National Highways Authority', 'Mott Engineers', 'Infra Bank', '972000000.00', '5', '10', 24]);
  const org = t.api.db.prepare("SELECT * FROM org_projects WHERE code = 'NH48-P3'").get();
  assert.deepEqual([org.id, org.client_name, org.start_date, org.end_date, org.pm_user_id != null], [p.projectId, 'National Highways Authority', '2026-12-01', '2028-11-30', true], 'the organisation master follows');
  assert.deepEqual(p.sites.map((s) => [s.code, s.status, s.geofence, s.radiusM]), [['NH48-S1', 'DRAFT', 'CIRCLE', 400], ['NH48-S2', 'DRAFT', 'CIRCLE', 250]]);
  assert.equal(count(t.api.db, "SELECT COUNT(*) AS n FROM core_number_series WHERE project_id = ?", org.id), 1, 'the numbering series from the template');
  assert.equal(p.setup.series.length, 1); assert.ok(p.setup.folders >= 5, 'the folders of the template');
  assert.equal(count(t.api.db, 'SELECT COUNT(*) AS n FROM doc_folders WHERE project_id = ? AND is_active = 1', org.id), p.setup.folders);
  assert.deepEqual(p.milestones.map((m) => [m.code, m.contractual, m.paymentLinked, m.status]), [['M1', true, true, 'PLANNED'], ['M2', false, false, 'PLANNED']]);
  assert.deepEqual(p.log.map((l) => [l.kind, l.to, l.status]), [['TRANSITION', 'SETUP', 'EFFECTIVE']]);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.project.created'").get());
  // nothing is made when a part is refused: a vendor as client, a blacklisted client, a duplicate code, a site that cannot be made (a circle with no radius), a folder template that does not exist, a milestone twice
  const snapshot = () => [count(t.api.db, 'SELECT COUNT(*) AS n FROM org_projects'), count(t.api.db, 'SELECT COUNT(*) AS n FROM org_sites'), count(t.api.db, 'SELECT COUNT(*) AS n FROM core_number_series'), count(t.api.db, 'SELECT COUNT(*) AS n FROM doc_folders'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_projects'), count(t.api.db, 'SELECT COUNT(*) AS n FROM proj_milestones')];
  const before = snapshot();
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X1' }, contract: { clientPartnerId: t.ids.vendor } }))).status, 400, 'a vendor is not a client');
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X2' }, contract: { clientPartnerId: t.ids.blocked } }))).status, 400);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X3' }, contract: { scheduledCompletion: '2026-01-01' } }))).status, 400, 'completion before the start');
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X4' }, setup: { folderTemplate: 'NOPE' } }))).status, 400);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X5' }, team: { pmUser: 'nobody' } }))).status, 400);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X6' }, milestones: [{ code: 'A', name: 'a', plannedDate: '2027-01-01' }, { code: 'a', name: 'b', plannedDate: '2027-02-01' }] }))).status, 400);
  const dup = await t.call(pcm, 'POST', '/projects', t.wizard()); assert.ok([400, 409, 422].includes(dup.status), `a duplicate code: ${dup.status}`);
  const badSite = await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'X7' }, sites: [{ code: 'OK1', name: 'Fine', siteType: 'SITE' }, { code: 'BAD', name: 'No radius', siteType: 'SITE', latitude: 18.5, longitude: 73.8, geofenceType: 'CIRCLE' }] }));
  assert.ok(badSite.status >= 400 && badSite.status < 500, `a site that cannot be made refuses the whole wizard: ${badSite.status} ${JSON.stringify(badSite.json).slice(0, 200)}`);
  assert.deepEqual(snapshot(), before, 'nothing of the refused wizards is left');
  // a choice of numbering templates and no folders
  const light = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'LIGHT1' }, setup: { numbering: [], folderTemplate: null } }))).json.data;
  assert.deepEqual([light.setup.series.length, light.setup.folders], [0, 0]);
  assert.equal((await t.call(se, 'POST', '/projects', t.wizard({ basics: { code: 'X8' } }))).status, 403); assert.equal((await t.call(pm1, 'POST', '/projects', t.wizard({ basics: { code: 'X9' } }))).status, 403, 'a project manager does not set projects up');
  // the options of the wizard
  const o = (await t.call(pcm, 'GET', '/project-options')).json.data;
  assert.deepEqual([o.numbering.map((x) => x.code), o.folderTemplates.some((x) => x.code === 'PROJECT_STANDARD'), o.checklists.ACTIVATE.length], [['DMS'], true, 4]);
});

test('AC-01 the activation by the project director and the director; the lifecycle with checklists, the chain for a suspension and a closure; transition rules', async () => {
  const t = await setup();
  const p = (await t.call(pcm, 'POST', '/projects', t.wizard())).json.data;
  // the plain activation of the organisation master is not a way round
  const plain = await t.api.call('POST', `/api/v1/iam/org/projects/${p.projectId}/activation-requests`, { ...pcm, headers: key(), body: { reason: 'activate it please' } });
  assert.equal(plain.status, 422); assert.match(JSON.stringify(plain.json), /project master/);
  // the checklist and the blockers
  assert.equal((await t.call(pcm, 'POST', `/projects/${p.id}/submit`, { ticked: [0, 1] })).status, 422, 'every item is ticked');
  const bare = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'BARE1' }, sites: [], team: { pmUser: null, directorUser: null }, contract: { startDate: null, scheduledCompletion: null } }))).json.data;
  const blocked = await t.call(pcm, 'POST', `/projects/${bare.id}/submit`, { ticked: ALL }); assert.equal(blocked.status, 422);
  assert.match(JSON.stringify(blocked.json), /At least one site/); assert.match(JSON.stringify(blocked.json), /project manager and the project director/); assert.match(JSON.stringify(blocked.json), /start date/);
  assert.equal((await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'AUTO1' }, top: { submit: true, ticked: [0] } }))).status, 422, 'a wizard that also submits needs the checklist');
  assert.equal(count(t.api.db, "SELECT COUNT(*) AS n FROM org_projects WHERE code = 'AUTO1'"), 0, 'and makes nothing when it does not');
  const s = await t.call(pcm, 'POST', `/projects/${p.id}/submit`, { ticked: ALL }); assert.equal(s.status, 202);
  const inst = s.json.data.workflowInstanceId;
  assert.deepEqual([(await t.tasks(pcm)).some((x) => x.instance.id === inst), (await t.tasks(dir)).some((x) => x.instance.id === inst)], [false, false], 'the maker is no approver and the director waits for the project director');
  assert.equal((await t.call(pcm, 'PATCH', `/projects/${p.id}`, { location: 'Mumbai', version: s.json.data.rowVersion })).status, 409, 'locked while with the approvers');
  await t.act(pd1, inst, 'return');
  const back = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.equal(back.status, 'RETURNED');
  const fix = await t.call(pcm, 'PATCH', `/projects/${p.id}`, { contractNo: 'NHAI/2027/118-R', version: back.rowVersion }); assert.equal(fix.status, 200, JSON.stringify(fix.json));
  assert.equal((await t.call(pcm, 'POST', `/projects/${p.id}/submit`, { ticked: ALL })).status, 202);
  await t.act(pd1, inst); await t.act(dir, inst);
  const a = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data;
  assert.deepEqual([a.status, a.state, a.orgStatus, a.sites.map((x) => x.status), a.activatedAt != null], ['APPROVED', 'MOBILISATION', 'ACTIVE', ['ACTIVE', 'ACTIVE'], true], 'the organisation project and its sites follow');
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'proj.project.activated'").all().map((r) => JSON.parse(r.payload).data ?? JSON.parse(r.payload));
  assert.equal(ev.length, 1); assert.deepEqual([ev[0].code, ev[0].sites, ev[0].setup.series.length], ['NH48-P3', ['NH48-S1', 'NH48-S2'], 1]);
  // T-01 the transition rules: only the allowed moves, the checklist, the readiness; the PM moves it to execution (warnings: budget and baseline are not live yet)
  const opts = a.transitions; assert.deepEqual(opts.map((x) => [x.to, x.approval]), [['EXECUTION', false]]);
  assert.deepEqual(opts[0].readiness.filter((r) => !r.blocking).map((r) => r.code), ['BUDGET', 'BASELINE']);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'DLP', ticked: ALL })).status, 422, 'not an allowed move');
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: [0, 1] })).status, 422, 'the checklist');
  assert.equal((await t.call(qs, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: ALL })).status, 403);
  const ex = await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: ALL, reason: 'Site established' }); assert.equal(ex.status, 202, JSON.stringify(ex.json));
  assert.deepEqual([ex.json.data.state, ex.json.data.log[0].status, ex.json.data.log[0].warnings.length, ex.json.data.log[0].checklist.every((x) => x.ticked)], ['EXECUTION', 'EFFECTIVE', 2, true], 'warnings are kept with the move');
  // a suspension goes through the chain: the project manager (not the requester: another PM), the project director, the director
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUSPENDED', ticked: ALL })).status, 422, 'a reason for a move that needs approval');
  const su = await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUSPENDED', ticked: ALL, reason: 'Client has not handed over the land at Km 20' }); assert.equal(su.status, 202, JSON.stringify(su.json));
  const open = su.json.data.openRequest; assert.deepEqual([su.json.data.state, open.status, open.to], ['EXECUTION', 'REQUESTED', 'SUSPENDED']);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUSPENDED', ticked: ALL, reason: 'a second request at once' })).status, 409);
  assert.ok(!(await t.tasks(pm1)).some((x) => x.instance.id === open.workflowInstanceId), 'the requester is not the project manager step');
  await t.act(pm2, open.workflowInstanceId); await t.act(pd1, open.workflowInstanceId); await t.act(dir, open.workflowInstanceId);
  const sus = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.deepEqual([sus.state, sus.orgStatus, sus.openRequest], ['SUSPENDED', 'ON_HOLD', null]);
  // resume, complete, defect liability, closure by the chain, archive
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: [0, 1, 2] })).status, 202);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'SUBSTANTIALLY_COMPLETE', ticked: [0, 1, 2] })).json.data.state, 'SUBSTANTIALLY_COMPLETE');
  assert.equal((await t.call(pd1, 'POST', `/projects/${p.id}/transitions`, { to: 'DLP', ticked: [0, 1, 2] })).json.data.state, 'DLP');
  const cl = await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'CLOSED', ticked: ALL, reason: 'Defect liability period over, final account settled' }); assert.equal(cl.status, 202, JSON.stringify(cl.json));
  const wi = cl.json.data.openRequest.workflowInstanceId;
  const rj = await t.act(pm2, wi, 'return'); void rj;
  const ret = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.deepEqual([ret.state, ret.log[0].status], ['DLP', 'RETURNED'], 'a returned request ends; a new one is raised');
  const cl2 = (await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'CLOSED', ticked: ALL, reason: 'Corrected: the final account is attached' })).json.data.openRequest.workflowInstanceId;
  await t.act(pm2, cl2); await t.act(pd2, cl2); await t.act(dir2, cl2);
  const closed = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data; assert.deepEqual([closed.state, closed.orgStatus, closed.can.editLive], ['CLOSED', 'CLOSED', false]);
  assert.equal((await t.call(pcm, 'PATCH', `/projects/${p.id}`, { location: 'Delhi', version: closed.rowVersion })).status, 409, 'a closed project is not changed');
  assert.equal((await t.call(dir, 'POST', `/projects/${p.id}/transitions`, { to: 'ARCHIVED', ticked: [0, 1] })).json.data.state, 'ARCHIVED');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'proj.project.state_changed'").get().n >= 7);
  const h = (await t.call(pcm, 'GET', `/projects/${p.id}/history`)).json.data; assert.ok(h.approvals.length > 6 && h.audit.length > 6);
});

test('BR-02 the contract terms of a live project change only by an approved amendment; milestones and health; roles, isolation, another company, the flag', async () => {
  const t = await setup();
  const p0 = (await t.call(pcm, 'POST', '/projects', t.wizard())).json.data; const p = await activate(t, pcm, p0.id);
  // a draft is edited freely; a live project keeps its contract terms
  assert.equal((await t.call(pm1, 'PATCH', `/projects/${p.id}`, { contractValue: '999000000', version: p.rowVersion })).status, 422, 'controlled');
  assert.match(JSON.stringify((await t.call(pm1, 'PATCH', `/projects/${p.id}`, { startDate: '2026-12-15', version: p.rowVersion })).json), /Amend/);
  const live = (await t.call(pm1, 'PATCH', `/projects/${p.id}`, { location: 'Pune and Satara', ldSummary: 'As per clause 47', settings: { workingDays: [1, 2, 3, 4, 5], calendar: 'FIVE_DAY' }, version: p.rowVersion })); assert.equal(live.status, 200, JSON.stringify(live.json));
  assert.deepEqual([live.json.data.location, live.json.data.settings.workingDays, live.json.data.settings.units], ['Pune and Satara', [1, 2, 3, 4, 5], 'METRIC']);
  assert.equal((await t.call(qs, 'POST', `/projects/${p.id}/amend`, { reason: 'not mine to ask', changes: { contractValue: '1' } })).status, 403);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'empty', changes: {} })).status, 400);
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'dates', changes: { scheduledCompletion: '2026-01-01' } })).status, 400, 'before the start');
  const am = await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'Variation order 3 adds a service road and 4 months', changes: { contractValue: '1020000000', scheduledCompletion: '2029-03-31', revisedCompletion: '2029-03-31' } });
  assert.equal(am.status, 202, JSON.stringify(am.json)); const ai = am.json.data.openRequest.workflowInstanceId;
  assert.equal(am.json.data.openRequest.kind, 'AMENDMENT'); assert.equal(am.json.data.contractValue, '972000000.00', 'not changed until approved');
  assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/amend`, { reason: 'a second at once', changes: { dlpMonths: 12 } })).status, 409);
  await t.act(pd1, ai); await t.act(dir, ai);
  const done = (await t.call(pcm, 'GET', `/projects/${p.id}`)).json.data;
  assert.deepEqual([done.contractValue, done.scheduledCompletion, done.revisedCompletion, done.pending, done.log[0].status, done.log[0].changes.before.contractValue], ['1020000000.00', '2029-03-31', '2029-03-31', null, 'EFFECTIVE', '972000000.00']);
  const orgNow = t.api.db.prepare('SELECT end_date FROM org_projects WHERE id = ?').get(done.projectId); assert.equal(orgNow.end_date, '2029-03-31', 'the organisation master follows');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.project.amended'").get());
  // FR-04 milestones: kept by the project manager; a contractual date of a live project is not moved by hand
  const m = (await t.call(pm1, 'POST', `/projects/${p.id}/milestones`, { code: 'M3', name: 'Bridge at Km 8 open', plannedDate: '2020-01-31', contractual: true, paymentLinked: true })).json.data;
  assert.equal(m.length, 3); assert.equal((await t.call(pm1, 'POST', `/projects/${p.id}/milestones`, { code: 'm3', name: 'dup', plannedDate: '2027-01-01' })).status, 409);
  const m3 = m.find((x) => x.code === 'M3'); assert.deepEqual([m3.overdue, m3.daysLate > 1000], [true, true]);
  assert.equal((await t.call(pm1, 'PATCH', `/milestones/${m3.id}`, { plannedDate: '2027-03-01', version: m3.rowVersion })).status, 422, 'contractual');
  const ach = (await t.call(pm1, 'PATCH', `/milestones/${m3.id}`, { status: 'ACHIEVED', actualDate: '2026-11-01', version: m3.rowVersion })).json.data.find((x) => x.code === 'M3');
  assert.deepEqual([ach.status, ach.actualDate, ach.overdue], ['ACHIEVED', '2026-11-01', false]); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.milestone.achieved'").get());
  assert.equal((await t.call(pm1, 'PATCH', `/milestones/${m3.id}`, { status: 'ACHIEVED', actualDate: '2999-01-01', version: ach.rowVersion })).status, 400);
  assert.equal((await t.call(pm1, 'DELETE', `/milestones/${m3.id}`)).status, 422, 'an achieved milestone stays');
  assert.equal((await t.call(qs, 'POST', `/projects/${p.id}/milestones`, { code: 'M9', name: 'no', plannedDate: '2027-01-01' })).status, 403);
  // FR-06 the portfolio: state, value, health (the schedule from the milestones) and the time elapsed
  const exec = (await t.call(pm1, 'POST', `/projects/${p.id}/transitions`, { to: 'EXECUTION', ticked: ALL })).json.data; assert.equal(exec.state, 'EXECUTION');
  const list = (await t.call(dir, 'GET', '/projects')).json.data; const row = list.find((x) => x.code === 'NH48-P3');
  assert.deepEqual([row.state, row.contractValue, row.client, row.status], ['EXECUTION', '1020000000.00', 'National Highways Authority', 'APPROVED']); assert.ok(['GREEN', 'AMBER', 'RED'].includes(row.health));
  assert.equal(row.health, 'GREEN', 'the open milestones are in the future');
  const late = (await t.call(pm1, 'POST', `/projects/${p.id}/milestones`, { code: 'M4', name: 'Late one', plannedDate: '2026-01-15' })).status; assert.equal(late, 201);
  assert.equal((await t.call(dir, 'GET', `/projects/${p.id}`)).json.data.health, 'RED', 'a milestone more than 30 days overdue');
  // roles: DIR approves but does not set up; QS and SE see nothing; the print and the export
  assert.equal((await t.call(dir, 'POST', '/projects', t.wizard({ basics: { code: 'Z1' } }))).status, 403);
  assert.equal((await t.call(qs, 'GET', '/projects')).status, 403); assert.equal((await t.call(se, 'GET', `/projects/${p.id}`)).status, 403);
  assert.equal((await t.api.call('GET', `${P}/projects/${p.id}/print`, pcm)).status, 200);
  assert.equal((await t.api.call('GET', `${P}/projects/export?format=csv`, dir)).status, 200); assert.equal((await t.api.call('GET', `${P}/projects/export?format=csv`, pm1)).status, 403);
  // isolation: a project manager assigned to another project only; another company; the flag
  const other = Number(t.api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'OTHER1', 'Other', 'BUILDING')").run().lastInsertRowid);
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'ppm3', 'ppm3', '[]', 'ppm3@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([other]));
  const s = projectsOf(t.api.db); const pm3 = { user: 'ppm3', userId: uid, companyId: 1, roles: [] };
  assert.ok(!s.projects.list(pm3, {}).data.some((r) => r.id === p.id)); assert.throws(() => s.projects.get(pm3, p.id), /does not exist/); assert.throws(() => s.transitions.move(pm3, p.id, { to: 'SUSPENDED', ticked: ALL, reason: 'not their project at all' }), /does not exist/);
  assert.equal((await t.call(as('PCMGR', 'ppcm1', '2'), 'GET', `/projects/${p.id}`)).status, 404, 'another company');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1001'").run();
  assert.equal((await t.call(pcm, 'GET', '/projects')).status, 404, 'flag off');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1001'").run();
  // a draft that was never sent is deleted; a sent one is cancelled
  const d = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'DEL1' } }))).json.data;
  assert.equal((await t.call(pcm, 'DELETE', `/projects/${d.id}`)).status, 200); assert.equal((await t.call(pcm, 'GET', `/projects/${d.id}`)).status, 404);
  const c = (await t.call(pcm, 'POST', '/projects', t.wizard({ basics: { code: 'CAN1' } }))).json.data; await t.call(pcm, 'POST', `/projects/${c.id}/submit`, { ticked: ALL });
  assert.equal((await t.call(pcm, 'POST', `/projects/${c.id}/cancel`, { reason: 'the client withdrew the order' })).json.data.status, 'CANCELLED');
  assert.equal((await t.call(pcm, 'POST', `/projects/${p.id}/cancel`, { reason: 'a live project is not cancelled' })).status, 422);
});
