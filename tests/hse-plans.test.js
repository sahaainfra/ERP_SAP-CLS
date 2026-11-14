import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { todayIST } from '../src/shared/dates.js';
import { U, ready, attachFile, approvedHira, hiraBody } from './hse-helpers.js';

// Part 19.01: the HSE plan and the HIRA (5 x 5) with their approvals, versions, and the job safety analysis (JSA) with its release, acknowledgement and the work authorisation check.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const TODAY = todayIST();
const plan = (r, o = {}) => r.call(U.hsee, 'POST', '/plans', { projectId: r.A, siteId: r.site, title: 'HSE plan for Tower 1', emergency: { contacts: [{ name: 'Dr Mehta', role: 'Doctor', phone: '9810000001' }], assemblyPoints: ['Gate 1'], hospital: 'City Hospital', procedure: 'Call the site medic' }, ...o });

test('FR-01 the HSE plan carries the emergency contacts and a document; the project manager and then the HSE head approve; the maker cannot', async () => {
  const r = await ready(opened); const c = await plan(r); assert.equal(c.status, 201, JSON.stringify(c.json)); const p = c.json.data; assert.deepEqual([p.status, p.versionNo, p.emergency.contacts.length, p.can.submit], ['DRAFT', 1, 1, true]);
  assert.equal((await r.call(U.se, 'POST', '/plans', { projectId: r.A, title: 'Not mine' })).status, 403); assert.equal((await r.call(U.hseoX, 'GET', `/plans/${p.id}`)).status, 404, 'another company sees nothing');
  assert.equal((await r.call(U.hsee, 'POST', `/plans/${p.id}/file`, { fileId: 999999 })).status, 422, 'a file not attached to the plan'); const f = attachFile(r, 'hse_plans', p.id, 'plan.pdf'); assert.equal((await r.call(U.hsee, 'POST', `/plans/${p.id}/file`, { fileId: f })).json.data.documentFileId, f);
  assert.equal((await r.call(U.hsee, 'PATCH', `/plans/${p.id}`, { title: 'HSE plan for Tower 1 (rev)', rowVersion: 99 })).status, 409);
  const s = await r.call(U.hsee, 'POST', `/plans/${p.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const w = r.wf('hse_plans', p.id);
  assert.equal((await r.tasksOf(U.hsee)).length, 0, 'the maker has no approval task'); assert.equal((await r.act(U.pm, w)).status, 200); assert.equal((await r.call(U.hseo, 'GET', `/plans/${p.id}`)).json.data.status, 'SUBMITTED', 'two steps'); assert.equal((await r.act(U.hseo, w)).status, 200);
  const done = (await r.call(U.pm, 'GET', `/plans/${p.id}`)).json.data; assert.deepEqual([done.status, done.approvedBy], ['APPROVED', 'hseo1']); await r.drain(); assert.equal(r.events('hse.plan.approved').length, 1);
  const pdf = await r.api.raw('GET', `${'/api/v1/hse'}/plans/${p.id}/print`, { ...U.pm }); assert.equal(pdf.status, 200); assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
});

test('FR-01 an approved plan is amended into a new version; the old one is superseded when the new one is approved', async () => {
  const r = await ready(opened); const p = (await plan(r)).json.data; await r.call(U.hsee, 'POST', `/plans/${p.id}/submit`); const w = r.wf('hse_plans', p.id); await r.act(U.pm, w); await r.act(U.hseo, w);
  assert.equal((await r.call(U.se, 'POST', `/plans/${p.id}/amend`, { reason: 'Hospital changed' })).status, 403, 'the amending right is with the HSE team'); const a = await r.call(U.hsee, 'POST', `/plans/${p.id}/amend`, { reason: 'Hospital changed' }); assert.equal(a.status, 200, JSON.stringify(a.json)); assert.deepEqual([a.json.data.versionNo, a.json.data.status, a.json.data.amendedFrom], [2, 'DRAFT', p.id]);
  assert.equal((await r.call(U.hsee, 'POST', `/plans/${p.id}/amend`, { reason: 'Again please' })).status, 409, 'one new version at a time');
  await r.call(U.hsee, 'POST', `/plans/${a.json.data.id}/submit`); const w2 = r.wf('hse_plans', a.json.data.id); assert.equal((await r.act(U.pm, w2)).status, 200); assert.equal((await r.act(U.hseo, w2)).status, 200);
  assert.deepEqual([(await r.call(U.pm, 'GET', `/plans/${p.id}`)).json.data.status, (await r.call(U.pm, 'GET', `/plans/${a.json.data.id}`)).json.data.status], ['SUPERSEDED', 'APPROVED']); assert.equal((await r.call(U.hsee, 'POST', `/plans/${p.id}/amend`, { reason: 'Old version' })).status, 422);
});

test('FR-02 T-01 the HIRA scores every hazard on the 5 x 5 matrix on the server; the residual cannot exceed the risk; the register carries the highest', async () => {
  const r = await ready(opened); const c = await r.call(U.hsee, 'POST', '/hira', hiraBody(r, { hazards: [{ activity: 'Excavation', hazard: 'Collapse', c: 4, l: 3, controls: 'Shoring', rc: 2, rl: 2 }, { activity: 'Lifting', hazard: 'Falling load', c: 5, l: 4, controls: 'Banksman and exclusion zone', rc: 5, rl: 2 }] })); assert.equal(c.status, 201, JSON.stringify(c.json)); const h = c.json.data;
  assert.deepEqual([h.maxScore, h.maxResidual, h.riskLevel, h.hazardCount], [20, 10, 'HIGH', 2]); const d = (await r.call(U.hsee, 'GET', `/hira/${h.id}`)).json.data; assert.deepEqual(d.hazards.map((x) => [x.score, x.residual, x.level, x.residualLevel]), [[12, 4, 'HIGH', 'LOW'], [20, 10, 'EXTREME', 'HIGH']]);
  const bad = await r.call(U.hsee, 'POST', '/hira', hiraBody(r, { hazards: [{ activity: 'Activity', hazard: 'Slip', c: 2, l: 2, controls: 'Mats', rc: 3, rl: 3 }] })); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /residual risk cannot be higher/);
  assert.equal((await r.call(U.hsee, 'POST', '/hira', hiraBody(r, { hazards: [{ activity: 'Activity', hazard: 'Slip', c: 6, l: 2, controls: 'Mats', rc: 1, rl: 1 }] }))).status, 400, 'scores are 1 to 5');
  const ext = await r.call(U.hsee, 'POST', '/hira', hiraBody(r, { title: 'Extreme', hazards: [{ activity: 'Activity', hazard: 'Fall from height', c: 5, l: 5, controls: 'Net', rc: 5, rl: 4 }] })); assert.equal(ext.json.data.riskLevel, 'EXTREME'); const sub = await r.call(U.hsee, 'POST', `/hira/${ext.json.data.id}/submit`); assert.equal(sub.status, 400); assert.match(JSON.stringify(sub.json), /must be reduced/);
  assert.equal((await r.call(U.hsee, 'PATCH', `/hira/${ext.json.data.id}`, { hazards: [{ activity: 'Activity', hazard: 'Fall from height', c: 5, l: 5, controls: 'Net and harness', rc: 3, rl: 3 }] })).json.data.riskLevel, 'MEDIUM');
  assert.equal((await r.call(U.hsee, 'GET', '/hira?filter[risk]=HIGH')).json.data.length, 1);
});

test('FR-02 the approval follows the residual risk: a medium risk by the project manager; a high risk also by the HSE head; the approved assessment is amended', async () => {
  const r = await ready(opened); const low = (await r.call(U.hsee, 'POST', '/hira', hiraBody(r))).json.data; assert.equal(low.riskLevel, 'LOW', 'residual 2 x 2 is low'); await r.call(U.hsee, 'POST', `/hira/${low.id}/submit`); const w = r.wf('hse_hira', low.id);
  assert.equal((await r.act(U.pm, w)).status, 200); assert.equal((await r.call(U.pm, 'GET', `/hira/${low.id}`)).json.data.status, 'APPROVED', 'one step for a low risk');
  const hi = await r.call(U.hsee, 'POST', '/hira', hiraBody(r, { title: 'Lifting', hazards: [{ activity: 'Lifting', hazard: 'Falling load', c: 5, l: 4, controls: 'Exclusion zone', rc: 4, rl: 3 }] })); assert.equal(hi.json.data.riskLevel, 'HIGH'); await r.call(U.hsee, 'POST', `/hira/${hi.json.data.id}/submit`); const w2 = r.wf('hse_hira', hi.json.data.id);
  assert.equal((await r.act(U.pm, w2)).status, 200); assert.equal((await r.call(U.pm, 'GET', `/hira/${hi.json.data.id}`)).json.data.status, 'SUBMITTED'); assert.equal((await r.act(U.hseo, w2)).status, 200); assert.equal((await r.call(U.pm, 'GET', `/hira/${hi.json.data.id}`)).json.data.status, 'APPROVED');
  const am = await r.call(U.hseo, 'POST', `/hira/${low.id}/amend`, { reason: 'Method changed' }); assert.equal(am.status, 200); assert.equal(am.json.data.versionNo, 2); await r.drain(); const ev = r.events('hse.hira.approved'); assert.deepEqual([ev.length, ev[0].riskLevel], [2, 'LOW']);
  const sm = (await r.call(U.pm, 'GET', '/hira/summary')).json.data; assert.deepEqual([sm.approved, sm.byLevel.find((x) => x.level === 'HIGH').approved], [2, 1]); const csv = await r.api.raw('GET', '/api/v1/hse/hira/export', { ...U.hseo }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /HIRA/); assert.equal((await r.api.raw('GET', '/api/v1/hse/hira/export', { ...U.se })).status, 403);
});

const jsaBody = (r, o = {}) => ({ projectId: r.A, siteId: r.site, task: 'Excavate footing F1', activityId: r.a1, steps: [{ step: 'Mark out', hazard: 'Utilities', control: 'Scan with a cable detector', responsible: 'Surveyor' }, { step: 'Excavate', hazard: 'Collapse', control: 'Shoring', responsible: 'Foreman' }], ...o });
test('FR-03 BR-01 the JSA: every step has a control; a linked HIRA must be approved; the person who prepared it does not release it; the crew acknowledges by badge', async () => {
  const r = await ready(opened); const { workerOf } = await import('./hse-helpers.js'); const w = workerOf(r); const hira = await approvedHira(r);
  const c = await r.call(U.se, 'POST', '/jsa', jsaBody(r, { hiraId: hira })); assert.equal(c.status, 201, JSON.stringify(c.json)); const j = c.json.data; assert.deepEqual([j.status, j.stepCount, j.validOn, j.can.release], ['DRAFT', 2, TODAY, false]);
  const noctl = await r.call(U.se, 'POST', '/jsa', jsaBody(r, { steps: [{ step: 'Excavate', hazard: 'Collapse', control: '' }] })); assert.equal(noctl.status, 201); assert.equal((await r.call(U.hsee, 'POST', `/jsa/${noctl.json.data.id}/release`)).status, 400, 'a step needs its control');
  assert.equal((await r.call(U.se, 'POST', `/jsa/${j.id}/release`)).status, 403, 'the maker (or a supervisor) does not release'); const open = (await r.call(U.hsee, 'POST', '/jsa', jsaBody(r, { hiraId: (await r.call(U.hsee, 'POST', '/hira', hiraBody(r))).json.data.id }))).json.data; assert.equal((await r.call(U.hseo, 'POST', `/jsa/${open.id}/release`)).status, 400, 'the linked HIRA is not approved'); 
  assert.equal((await r.call(U.hsee, 'POST', `/jsa/${open.id}/release`)).status, 403, 'the preparer cannot release');
  const rel = await r.call(U.hsee, 'POST', `/jsa/${j.id}/release`); assert.equal(rel.status, 200, JSON.stringify(rel.json)); assert.equal(rel.json.data.status, 'ISSUED'); assert.equal((await r.call(U.se, 'PATCH', `/jsa/${j.id}`, { task: 'Changed' })).status, 409, 'a released JSA is not edited');
  const s1 = await r.call(U.csup, 'POST', `/jsa/${j.id}/sign`, { badge: w.badge }); assert.equal(s1.status, 200, JSON.stringify(s1.json)); assert.equal(s1.json.data.participantCount, 1); assert.equal((await r.call(U.csup, 'POST', `/jsa/${j.id}/sign`, { badge: w.badge })).json.data.participantCount, 1, 'once');
  assert.equal((await r.call(U.csup, 'POST', `/jsa/${j.id}/sign`, { badge: 'LAB:nobody' })).status, 400); assert.equal((await r.call(U.csup, 'POST', `/jsa/${j.id}/sign`, { name: 'Visiting inspector' })).json.data.participantCount, 2);
  const done = await r.call(U.hsee, 'POST', `/jsa/${j.id}/complete`); assert.equal(done.json.data.status, 'COMPLETED'); await r.drain(); assert.equal(r.events('hse.jsa.released').length, 1); assert.equal(r.events('hse.jsa.completed').length, 1);
  const pdf = await r.api.raw('GET', `/api/v1/hse/jsa/${j.id}/print`, { ...U.pm }); assert.equal(pdf.status, 200); assert.equal((await r.call(U.xsub, 'GET', '/jsa')).status, 403);
});

test('BR-01 a work authorisation needs a released JSA when the company asks for it; without the setting nothing changes', async () => {
  const r = await ready(opened); const { hseOf } = await import('../src/server/modules/hse/index.js'); const { waCheckHooks } = await import('../src/server/modules/site/service.js'); const wa = { id: 9001, company_id: 1, org_project_id: r.A, activity_id: r.a1 };
  const run = () => waCheckHooks.map((h) => h(r.d, wa)).filter((x) => x && x.code === 'JSA'); assert.deepEqual(run(), [], 'off by default'); r.setParam('hse.jsa.require_for_wa', 'true', 'boolean'); const [miss] = run(); assert.equal(miss.result, 'FAIL'); assert.match(miss.message, /job safety analysis is needed/);
  const j = (await r.call(U.se, 'POST', '/jsa', jsaBody(r))).json.data; await r.call(U.hsee, 'POST', `/jsa/${j.id}/release`); const [ok] = run(); assert.equal(ok.result, 'PASS'); assert.ok(hseOf(r.d));
  r.d.prepare('UPDATE hse_jsa SET valid_on = ? WHERE id = ?').run('2020-01-01', j.id); assert.equal(run()[0].result, 'FAIL', 'a JSA of another day does not count'); r.d.prepare('UPDATE hse_jsa SET wa_id = 9001 WHERE id = ?').run(j.id); assert.equal(run()[0].result, 'PASS', 'one named on the authorisation does');
});
