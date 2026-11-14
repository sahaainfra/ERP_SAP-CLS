import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { todayIST } from '../src/shared/dates.js';
import { groupVerdict, requiredMean, sdOf } from '../src/server/modules/qa/pour.js';
import { U, ready } from './qa-helpers.js';

// Part 18.05: pour cards (BR-01), delivery tickets, cube samples with QR labels, results by IS 456 (T-01), failure to NCR, traceability.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const sd = { low: 35, mid: 40, high: 50 };

test('T-01 IS 456: the required mean is the greater of fck + 0.825 s and fck + the margin; a group of four passes on its mean and on its lowest result', () => {
  assert.equal(requiredMean(25, 4, 3), 28.3, 'M25: 25 + 0.825 x 4.0'); assert.equal(requiredMean(15, 3.5, 3), 18, 'M15: fck + 3 is greater than 15 + 0.825 x 3.5'); assert.equal(requiredMean(30, 5, 3), 34.125); assert.equal(requiredMean(25, 4.2, 3), 28.3, 's is rounded to the nearest 0.5 first');
  assert.deepEqual([sdOf(15, sd), sdOf(25, sd), sdOf(40, sd)], [3.5, 4, 5]);
  const ok = groupVerdict({ fck: 25, means: [29, 30, 28.5, 27], sd: 4 }); assert.deepEqual([ok.accepted, ok.mean, ok.required, ok.lowest], [true, 28.6, 28.3, 27]);
  const lowMean = groupVerdict({ fck: 25, means: [26, 27, 26, 27], sd: 4 }); assert.deepEqual([lowMean.accepted, lowMean.meanOk, lowMean.individualOk], [false, false, true], 'the mean is short');
  const lowOne = groupVerdict({ fck: 25, means: [34, 33, 33, 21.5], sd: 4 }); assert.deepEqual([lowOne.meanOk, lowOne.individualOk, lowOne.accepted], [true, false, false], 'one result below fck - 3 fails the group');
  assert.equal(groupVerdict({ fck: 25, means: [28.3, 28.3, 28.3, 28.3], sd: 4 }).accepted, true, 'exactly the required mean is enough');
});

async function approvedIrs(r, n = 3) {
  const out = []; for (let i = 0; i < n; i += 1) { const c = await r.call(U.se, 'POST', '/inspection-requests', { projectId: r.A, activityId: r.a1, pointType: 'HOLD', description: `Pre-pour inspection ${i + 1}`, requestedFor: plus(1), submit: true }); assert.equal(c.status, 201, JSON.stringify(c.json)); await r.call(U.qce, 'POST', `/inspection-requests/${c.json.data.id}/assess`, {}); assert.equal((await r.act(U.qce, r.wf('qa_inspection_requests', c.json.data.id))).status, 200); out.push(c.json.data.id); }
  return out;
}
const allYes = ['REBAR', 'COVER', 'SHUTTERING', 'CLEANING', 'EMBEDMENTS', 'EQUIPMENT', 'CURING'].map((code) => ({ code, result: 'YES' }));
async function clearedCard(r, o = {}) {
  const c = await r.call(U.se, 'POST', '/pour-cards', { projectId: r.A, siteId: r.site, activityId: r.a1, element: 'Footing F1', grade: 'M25', fck: 25, plannedVolume: 12.5, plannedOn: plus(1), ...o }); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id; const irs = await approvedIrs(r);
  const up = await r.call(U.se, 'PATCH', `/pour-cards/${id}`, { irLinks: [{ kind: 'REINFORCEMENT', irId: irs[0] }, { kind: 'SHUTTERING', irId: irs[1] }, { kind: 'EMBEDMENT', irId: irs[2] }], checks: allYes }); assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal((await r.call(U.se, 'POST', `/pour-cards/${id}/submit`)).status, 202); const w = r.wf('qa_pour_cards', id); assert.equal((await r.act(U.qce, w)).status, 200); assert.equal((await r.act(U.cm, w)).status, 200); return id;
}
const cubesOf = async (r, id, castDate = TODAY, o = {}) => { const s = await r.call(U.se, 'POST', `/pour-cards/${id}/samples`, { cubes: 6, castDate, ...o }); assert.equal(s.status, 201, JSON.stringify(s.json)); return s.json.data; };

test('BR-01 FR-01 the pour card cannot be sent without the approved inspection requests and the pre-pour checks; QCE then CM approve; the pour is recorded with tickets and the volume follows', async () => {
  const r = await ready(opened); const c = await r.call(U.se, 'POST', '/pour-cards', { projectId: r.A, siteId: r.site, activityId: r.a1, element: 'Footing F1', grade: 'M25', fck: 25, plannedVolume: 12.5, plannedOn: plus(1) }); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id;
  const none = await r.call(U.se, 'POST', `/pour-cards/${id}/submit`); assert.equal(none.status, 400); assert.match(JSON.stringify(none.json), /Reinforcement inspection request/); assert.match(JSON.stringify(none.json), /pre-pour checks/);
  const irs = await approvedIrs(r, 2); const open = await r.call(U.se, 'POST', '/inspection-requests', { projectId: r.A, activityId: r.a1, pointType: 'HOLD', description: 'Embedments not yet inspected', requestedFor: plus(1), submit: true });
  assert.equal((await r.call(U.se, 'PATCH', `/pour-cards/${id}`, { irLinks: [{ kind: 'REINFORCEMENT', irId: irs[0] }, { kind: 'SHUTTERING', irId: irs[1] }, { kind: 'EMBEDMENT', irId: open.json.data.id }], checks: allYes })).status, 200);
  const un = await r.call(U.se, 'POST', `/pour-cards/${id}/submit`); assert.equal(un.status, 400, 'an unapproved inspection request does not count'); assert.match(JSON.stringify(un.json), /Embedments inspection request is not approved/);
  const fix = (await approvedIrs(r, 1))[0]; await r.call(U.se, 'PATCH', `/pour-cards/${id}`, { irLinks: [{ kind: 'REINFORCEMENT', irId: irs[0] }, { kind: 'SHUTTERING', irId: irs[1] }, { kind: 'EMBEDMENT', irId: fix }], checks: [...allYes.slice(1), { code: 'REBAR', result: 'NO' }] }); const bad = await r.call(U.se, 'POST', `/pour-cards/${id}/submit`); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /Pre-pour check failed/);
  await r.call(U.se, 'PATCH', `/pour-cards/${id}`, { checks: allYes }); assert.equal((await r.call(U.se, 'POST', `/pour-cards/${id}/submit`)).status, 202); const w = r.wf('qa_pour_cards', id); assert.equal((await r.tasksOf(U.se)).some((t) => t.instance.id === w), false);
  assert.equal((await r.call(U.se, 'POST', `/pour-cards/${id}/record`, { pourStart: new Date().toISOString() })).status, 422, 'not before the approval'); assert.equal((await r.act(U.qce, w)).status, 200); assert.equal((await r.call(U.se, 'GET', `/pour-cards/${id}`)).json.data.status, 'SUBMITTED', 'then the construction manager'); assert.equal((await r.act(U.cm, w)).status, 200);
  await r.drain(); assert.equal(r.events('qa.pour.approved').length, 1); const t1 = await r.call(U.se, 'POST', `/pour-cards/${id}/tickets`, { ticketNo: 'RMC-1001', batchRef: 'B-77', truckNo: 'RJ14-1234', qty: 6, slumpMm: 110 }); assert.equal(t1.status, 201, JSON.stringify(t1.json)); assert.equal((await r.call(U.se, 'POST', `/pour-cards/${id}/tickets`, { ticketNo: 'RMC-1001', qty: 6 })).status, 409, 'a ticket once');
  const t2 = await r.call(U.se, 'POST', `/pour-cards/${id}/tickets`, { ticketNo: 'RMC-1002', batchRef: 'B-78', truckNo: 'RJ14-5678', qty: 6.5, slumpMm: 100 }); assert.deepEqual([t2.json.data.actualVolume, t2.json.data.pourStatus], [12.5, 'IN_PROGRESS'], 'the volume is the sum of the tickets');
  const done = await r.call(U.se, 'POST', `/pour-cards/${id}/record`, { pourEnd: new Date(Date.now() + 3600_000).toISOString(), weather: 'Clear, 31 C' }); assert.equal(done.json.data.pourStatus, 'COMPLETED'); await r.drain(); assert.equal(r.events('qa.pour.completed').length, 1);
  assert.equal((await r.call(U.se, 'POST', `/pour-cards/${id}/amend`, { reason: 'Change after the pour' })).status, 403, 'the site engineer does not amend'); assert.equal((await r.call(U.other, 'GET', `/pour-cards/${id}`)).status, 404);
});

test('FR-02 FR-03 FR-04 FR-05 cubes: QR label and due dates, 7 and 28-day results, the individual rule, the group of four, a failure raised as an NCR, and traceability from the batch', async () => {
  const r = await ready(opened); const id = await clearedCard(r); const t = await r.call(U.se, 'POST', `/pour-cards/${id}/tickets`, { ticketNo: 'RMC-2001', batchRef: 'B-900', truckNo: 'RJ14-9000', qty: 8, slumpMm: 105 }); const ticketId = t.json.data.tickets[0].id;
  const s1 = await cubesOf(r, id, plus(-28), { ticketId }); assert.match(s1.sampleNo, /^CUBE/); assert.deepEqual([s1.due7, s1.due28, s1.qrCode], [plus(-21), TODAY, `ERP:CUBE:${s1.sampleNo}`]); assert.match((await r.call(U.se, 'GET', `/cube-samples/${s1.id}/label`)).json.data.svg, /<svg/); assert.equal((await r.call(U.qce, 'GET', `/cube-samples/scan?code=${encodeURIComponent(s1.qrCode)}`)).json.data.id, s1.id);
  assert.equal((await r.call(U.se, 'POST', `/cube-samples/${s1.id}/results`, { ageDays: 7, strengths: [17, 18, 17.5], testedOn: plus(-21) })).status, 403, 'testing is for the quality engineer'); assert.equal((await r.call(U.qce, 'POST', `/cube-samples/${s1.id}/results`, { ageDays: 28, strengths: [31, 32], testedOn: TODAY })).status, 400, 'three cubes at 28 days');
  const eq = await r.call(U.qce, 'POST', '/lab-equipment', { code: 'CTM-1', name: 'Compression testing machine', projectId: r.A, lastCalibrated: plus(-400), intervalDays: 365 }); assert.equal((await r.call(U.qce, 'POST', `/cube-samples/${s1.id}/results`, { ageDays: 7, strengths: [17, 18, 17.5], testedOn: plus(-21), equipmentId: eq.json.data.id })).status, 400, 'the machine is out of calibration');
  const w7 = await r.call(U.qce, 'POST', `/cube-samples/${s1.id}/results`, { ageDays: 7, strengths: [17, 18, 17.5], testedOn: plus(-21) }); assert.equal(w7.status, 201, JSON.stringify(w7.json)); assert.equal(w7.json.data.results[0].acceptance, 'INDICATIVE'); assert.deepEqual([w7.json.data.nextAge, w7.json.data.overdue], [28, false]);
  const low7 = await cubesOf(r, id, plus(-8)); assert.equal((await r.call(U.qce, 'POST', `/cube-samples/${low7.id}/results`, { ageDays: 7, strengths: [10, 11, 12], testedOn: plus(-1) })).json.data.results[0].acceptance, 'WATCH', 'under 60 % of fck at seven days');
  assert.equal((await r.call(U.qce, 'POST', `/cube-samples/${s1.id}/results`, { ageDays: 7, strengths: [17, 18, 17.5], testedOn: plus(-21) })).status, 409, 'once per age');
  const done = [s1]; for (let i = 0; i < 3; i += 1) done.push(await cubesOf(r, id, plus(-28)));
  const add = async (s, st) => r.call(U.qce, 'POST', `/cube-samples/${s.id}/results`, { ageDays: 28, strengths: st, testedOn: TODAY }); const first = await add(s1, [29, 30, 28]); assert.equal(first.json.data.results.find((x) => x.ageDays === 28).acceptance, 'PASS'); await add(done[1], [30, 29, 31]); await add(done[2], [27, 28, 27]);
  let acc = (await r.call(U.qcm, 'GET', '/concrete-acceptance')).json.data; assert.deepEqual([acc.rows[0].groups.length, acc.rows[0].groups[0].complete, acc.rows[0].groups[0].needMore], [1, false, 1], 'three of four results so far'); await r.drain(); assert.equal(r.events('qa.cube.failed').length, 0);
  await add(done[3], [24.5, 25.5, 25]); acc = (await r.call(U.qcm, 'GET', '/concrete-acceptance')).json.data; const g = acc.rows[0].groups[0]; assert.deepEqual([g.complete, g.mean, g.required, g.meanOk, g.individualOk, g.accepted], [true, 27.8, 28.3, false, true, false], 'the individual 25 is above fck - 3 but the mean 27.8 is below 28.3');
  await r.drain(); const fl = r.events('qa.cube.failed'); assert.deepEqual([fl.length, fl[0].reason, fl[0].required], [1, 'GROUP', 28.3]);
  const resId = (await r.call(U.qce, 'GET', `/cube-samples/${done[3].id}`)).json.data.results.find((x) => x.ageDays === 28).id; const nc = await r.call(U.qce, 'POST', `/cube-results/${resId}/raise-ncr`, {}); assert.equal(nc.status, 201, JSON.stringify(nc.json)); assert.match(nc.json.data.ncrNo, /^NCR/); const ncr = (await r.call(U.qce, 'GET', `/ncrs/${nc.json.data.ncrId}`)).json.data; assert.deepEqual([ncr.status, ncr.type], ['OPEN', 'MATERIAL']); assert.match(ncr.description, /core tests/);
  assert.equal((await r.call(U.qce, 'POST', `/cube-results/${resId}/raise-ncr`, {})).status, 409, 'once per result');
  const bad = await add(await cubesOf(r, id, plus(-28)), [19, 20, 21]); const badRes = bad.json.data.results.find((x) => x.ageDays === 28); assert.equal(badRes.acceptance, 'FAIL', 'a mean of 20 is below fck - 3'); await r.drain(); assert.ok(r.events('qa.cube.failed').some((e) => e.reason === 'INDIVIDUAL'));
  const tr = (await r.call(U.pm, 'GET', '/concrete-traceability?q=B-900')).json.data.pours; assert.equal(tr.length, 1); assert.deepEqual([tr[0].tickets[0].truckNo, tr[0].tickets[0].batchRef, tr[0].tickets[0].samples.length], ['RJ14-9000', 'B-900', 1]); assert.equal(tr[0].samples.find((s) => s.ticketId === ticketId).results.length, 2, 'the 7 and 28-day results of the cubes cast from that truck');
  assert.equal((await r.call(U.pm, 'GET', `/concrete-traceability?q=${s1.sampleNo}`)).json.data.pours.length, 1); assert.equal((await r.call(U.pm, 'GET', '/concrete-traceability?q=NOPE-0')).json.data.pours.length, 0);
  const { qaOf } = await import('../src/server/modules/qa/index.js'); const due = await cubesOf(r, id, plus(-9)); assert.ok(due.id && qaOf(r.d).pov.sweep(1).told >= 1, 'a test overdue is told'); const csv = await r.api.raw('GET', '/api/v1/qa/cube-samples/export', { ...U.qcm }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /CUBE/); const csv2 = await r.api.raw('GET', '/api/v1/qa/concrete-acceptance/export', { ...U.qcm }); assert.equal(csv2.status, 200);
});
