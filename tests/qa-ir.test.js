import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { waCheckHooks } from '../src/server/modules/site/service.js';
import { todayIST } from '../src/shared/dates.js';
import { U, ready, plannedPoints } from './qa-helpers.js';

// Part 18.02: inspection requests, the hold-point gate of work authorisations and measurement lines, the decision chain (quality engineer, consultant), rejection and re-inspection, ageing and the rejection analysis.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const raise = (r, who, point, o = {}) => r.call(who, 'POST', '/inspection-requests', { projectId: r.A, plannedPointId: point.id, requestedFor: plus(1), submit: true, ...o });

test('T-01 BR-01 AC-01 the hold point blocks the next activity until its request is approved: the work authorisation check fails, the measurement-line check says ineligible, then both clear', async () => {
  const r = await ready(opened); const pts = await plannedPoints(r); const hold = pts.find((p) => p.stepCode === 'S1');
  const g0 = (await r.call(U.se, 'GET', `/hold-points/check?activityId=${r.a2}`)).json.data; assert.deepEqual([g0.eligible, g0.blocking.length, g0.blocking[0].stepCode], [false, 1, 'S1']); assert.match(g0.reason, /not released/);
  const hook = waCheckHooks.find((h) => h(r.d, { activity_id: r.a2, location_id: null })?.code === 'HOLD_POINT'); assert.ok(hook, 'the work authorisation check is registered'); assert.equal(hook(r.d, { activity_id: r.a2 }).result, 'FAIL'); assert.equal(hook(r.d, { activity_id: r.a1 }), null, 'the first activity has nothing before it');
  const c = await raise(r, U.se, hold); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id; assert.equal(c.json.data.status, 'SUBMITTED'); assert.equal(c.json.data.ageDays, 0);
  assert.equal((await r.call(U.se, 'GET', `/hold-points/check?activityId=${r.a2}`)).json.data.eligible, false, 'a request is not a release');
  assert.equal((await raise(r, U.se, hold)).status, 409, 'one request for a point at a time'); const w = r.wf('qa_inspection_requests', id);
  assert.equal((await r.tasksOf(U.se)).some((t) => t.instance.id === w), false, 'the engineer who raised it has no task'); assert.equal((await r.call(U.se, 'POST', `/inspection-requests/${id}/assess`, { assessment: 'ok' })).status, 403);
  const as1 = await r.call(U.qce, 'POST', `/inspection-requests/${id}/assess`, { assessment: null }); assert.equal(as1.status, 200, JSON.stringify(as1.json)); assert.equal((await r.act(U.qce, w)).status, 200);
  const done = (await r.call(U.pm, 'GET', `/inspection-requests/${id}`)).json.data; assert.deepEqual([done.status, done.result, done.approvedBy], ['APPROVED', 'APPROVED', 'qce1']);
  assert.equal(r.d.prepare('SELECT point_status FROM qa_planned_points WHERE id = ?').get(hold.id).point_status, 'DONE'); const g1 = (await r.call(U.se, 'GET', `/hold-points/check?activityId=${r.a2}`)).json.data; assert.equal(g1.eligible, true); assert.equal(hook(r.d, { activity_id: r.a2 }), null);
  await r.drain(); const ev = r.events('qa.ir.approved'); assert.equal(ev.length, 1); assert.deepEqual([ev[0].holdPoint, ev[0].result], [true, 'APPROVED']); assert.equal(r.events('qa.ir.raised').length, 1);
});

test('FR-02 BR-01 rejection: the reason is kept, the point goes back, a new request needs the re-inspection link, and the second request is approved after the consultant when required', async () => {
  const r = await ready(opened); const pts = await plannedPoints(r); const wit = pts.find((p) => p.stepCode === 'S2');
  const id = (await raise(r, U.se, wit, { consultantRequired: true })).json.data.id; const w = r.wf('qa_inspection_requests', id);
  assert.equal((await r.call(U.qce, 'POST', `/inspection-requests/${id}/assess`, { reasonCode: 'WORKMANSHIP', assessment: 'Honeycombing at the corner' })).status, 200); assert.equal((await r.act(U.qce, w, 'reject')).status, 200);
  const rej = (await r.call(U.qce, 'GET', `/inspection-requests/${id}`)).json.data; assert.deepEqual([rej.status, rej.result, rej.reasonCode, rej.needsReinspection], ['REJECTED', 'REJECTED', 'WORKMANSHIP', true]); assert.equal(r.d.prepare('SELECT point_status FROM qa_planned_points WHERE id = ?').get(wit.id).point_status, 'PLANNED');
  const bare = await raise(r, U.se, wit); assert.equal(bare.status, 400, 'BR-01 a rejected point needs a linked re-inspection'); assert.match(JSON.stringify(bare.json), /re-inspection/);
  const re = await r.call(U.se, 'POST', '/inspection-requests', { projectId: r.A, reinspectionOfId: id, requestedFor: plus(2), consultantRequired: true, submit: true }); assert.equal(re.status, 201, JSON.stringify(re.json)); const id2 = re.json.data.id; assert.deepEqual([re.json.data.plannedPointId, re.json.data.reinspectionOfId], [wit.id, id]);
  assert.equal((await r.call(U.se, 'POST', '/inspection-requests', { projectId: r.A, reinspectionOfId: id, requestedFor: plus(2) })).status, 409, 'a rejection is inspected again once');
  const w2 = r.wf('qa_inspection_requests', id2); assert.equal((await r.tasksOf(U.xcon)).some((t) => t.instance.id === w2), false, 'the consultant waits for the quality engineer'); assert.equal((await r.call(U.qce, 'POST', `/inspection-requests/${id2}/assess`, { assessment: 'Corrected; minor finishing to note' })).status, 200); assert.equal((await r.act(U.qce, w2)).status, 200);
  assert.equal((await r.call(U.qce, 'GET', `/inspection-requests/${id2}`)).json.data.status, 'SUBMITTED', 'then the consultant'); assert.equal((await r.act(U.xcon, w2)).status, 200);
  const ok = (await r.call(U.qce, 'GET', `/inspection-requests/${id2}`)).json.data; assert.deepEqual([ok.status, ok.result], ['APPROVED', 'APPROVED_WITH_COMMENTS']); assert.equal((await r.call(U.qce, 'GET', `/inspection-requests/${id}`)).json.data.needsReinspection, false);
  await r.drain(); assert.equal(r.events('qa.ir.rejected').length, 1); assert.equal(r.events('qa.ir.rejected')[0].reasonCode, 'WORKMANSHIP');
  const an = (await r.call(U.qcm, 'GET', '/ir-analysis')).json.data; assert.deepEqual([an.total, an.rejected, an.approved, an.reinspections, an.firstTimeApprovalPct], [2, 1, 1, 1, 0], 'the only first request was rejected'); assert.equal(an.byReason[0].code, 'WORKMANSHIP');
});

test('FR-01 the request: ad hoc for an activity, validated, ageing and overdue, withdrawn, cancelled, printed, exported and isolated', async () => {
  const r = await ready(opened); await plannedPoints(r);
  const bad = await r.call(U.se, 'POST', '/inspection-requests', { projectId: r.A, activityId: r.a1, pointType: 'WITNESS', description: 'Check the rebar', requestedFor: plus(-1) }); assert.equal(bad.status, 400, 'not in the past');
  assert.equal((await r.call(U.se, 'POST', '/inspection-requests', { projectId: r.A, pointType: 'WITNESS', description: 'Nothing named', requestedFor: plus(1) })).status, 400, 'an activity or a location'); assert.equal((await r.call(U.sk, 'POST', '/inspection-requests', { projectId: r.A, activityId: r.a1, description: 'x y z', requestedFor: plus(1) })).status, 403);
  const c = await r.call(U.se, 'POST', '/inspection-requests', { projectId: r.A, activityId: r.a1, pointType: 'WITNESS', description: 'Check the rebar', requestedFor: plus(1) }); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id; assert.equal(c.json.data.status, 'DRAFT');
  assert.equal((await r.call(U.se, 'PATCH', `/inspection-requests/${id}`, { description: 'Check the rebar and covers' })).status, 200); assert.equal((await r.call(U.se, 'POST', `/inspection-requests/${id}/submit`)).status, 202);
  r.d.prepare("UPDATE qa_inspection_requests SET requested_at = ?, requested_for = ? WHERE id = ?").run(new Date(Date.now() - 10 * 86_400_000).toISOString(), plus(-3), id); const v = (await r.call(U.qce, 'GET', `/inspection-requests/${id}`)).json.data; assert.equal(v.ageDays, 10); assert.equal(v.overdue, true);
  const an = (await r.call(U.qcm, 'GET', '/ir-analysis')).json.data; assert.deepEqual([an.open, an.overdue, an.ageing.find((x) => x.label === '8-14').count], [1, 1, 1]);
  assert.equal((await r.call(U.se, 'POST', `/inspection-requests/${id}/withdraw`, { reason: 'Not ready yet' })).status, 200); assert.equal((await r.call(U.se, 'GET', `/inspection-requests/${id}`)).json.data.status, 'DRAFT');
  assert.equal((await r.call(U.pm, 'POST', `/inspection-requests/${id}/cancel`, { reason: 'Raised twice by mistake' })).status, 403, 'a reader cannot cancel'); assert.equal((await r.call(U.qce, 'POST', `/inspection-requests/${id}/cancel`, { reason: 'Raised twice by mistake' })).status, 200, 'an approver may'); assert.equal((await r.call(U.se, 'GET', `/inspection-requests/${id}`)).json.data.status, 'CANCELLED');
  const pdf = await r.api.raw('GET', `/api/v1/qa/inspection-requests/${id}/print`, { ...U.qcm }); assert.equal(pdf.status, 200); const csv = await r.api.raw('GET', '/api/v1/qa/inspection-requests/export', { ...U.qcm }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /IR/);
  assert.equal((await r.call(U.other, 'GET', `/inspection-requests/${id}`)).status, 404, 'another company sees nothing'); assert.equal((await r.call(U.se, 'GET', '/inspection-requests/options')).json.data.points.length >= 0, true);
});
