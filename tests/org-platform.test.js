import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceM, geofenceProblems, orgBlockers, polygonProblems, testPoint } from '../src/server/platform/org/index.js';

const circle = { type: 'CIRCLE', latitude: 19.076, longitude: 72.8777, radiusM: 100 };
// A square of about 200 m x 200 m.
const square = [[19.076, 72.8777], [19.0778, 72.8777], [19.0778, 72.8796], [19.076, 72.8796], [19.076, 72.8777]];
const polygon = { type: 'POLYGON', polygon: square };

test('T-01 a circle: inside, outside and the edge tolerance', () => {
  assert.equal(testPoint(circle, { lat: 19.0765, lng: 72.8777 }).inside, true, '55 m from the centre');
  assert.equal(testPoint(circle, { lat: 19.0765, lng: 72.8777 }).strictlyInside, true);
  const out = testPoint(circle, { lat: 19.077, lng: 72.8777 }, 10); // 111 m: 11 m past the edge
  assert.equal(out.inside, false);
  assert.ok(out.edgeDistanceM > 10 && out.edgeDistanceM < 12, `edge distance ${out.edgeDistanceM}`);
  assert.equal(testPoint(circle, { lat: 19.077, lng: 72.8777 }, 15).inside, true, 'forgiven by a 15 m tolerance');
  assert.equal(testPoint(circle, { lat: 19.077, lng: 72.8777 }, 15).strictlyInside, false, 'but not strictly inside');
  assert.equal(testPoint(circle, { lat: 19.076, lng: 72.8777 }).edgeDistanceM, -100, 'the centre is 100 m inside');
});

test('T-01 a polygon: inside, outside and the edge tolerance', () => {
  assert.equal(testPoint(polygon, { lat: 19.0769, lng: 72.8786 }).inside, true);
  assert.equal(testPoint(polygon, { lat: 19.0769, lng: 72.8786 }).strictlyInside, true);
  assert.equal(testPoint(polygon, { lat: 19.079, lng: 72.8786 }).inside, false, 'about 130 m north');
  const nearEdge = testPoint(polygon, { lat: 19.075955, lng: 72.8786 }, 10); // about 5 m south of the south edge
  assert.equal(nearEdge.strictlyInside, false);
  assert.equal(nearEdge.inside, true, 'within the tolerance');
  assert.ok(nearEdge.edgeDistanceM > 4 && nearEdge.edgeDistanceM < 6, `edge distance ${nearEdge.edgeDistanceM}`);
  assert.equal(testPoint(polygon, { lat: 19.075955, lng: 72.8786 }, 2).inside, false, 'outside a 2 m tolerance');
  const corner = testPoint(polygon, { lat: 19.076, lng: 72.8777 }, 0);
  assert.equal(Math.abs(corner.edgeDistanceM) < 0.01, true, 'a corner is on the boundary');
  assert.equal(testPoint({ type: 'NONE' }, { lat: 1, lng: 1 }).inside, false);
});

test('BR-02 the radius must be 25 m to 5 km', () => {
  assert.deepEqual(geofenceProblems({ ...circle, radiusM: 25 }), []);
  assert.deepEqual(geofenceProblems({ ...circle, radiusM: 5000 }), []);
  assert.equal(geofenceProblems({ ...circle, radiusM: 24 }).length, 1);
  assert.equal(geofenceProblems({ ...circle, radiusM: 5001 }).length, 1);
  assert.equal(geofenceProblems({ ...circle, radiusM: 100.5 }).length, 1);
  assert.equal(geofenceProblems({ ...circle, latitude: 95 }).length, 1);
  assert.deepEqual(geofenceProblems({ type: 'NONE' }), []);
});

test('BR-02 a polygon must be closed and must not cross itself', () => {
  assert.deepEqual(polygonProblems(square), []);
  assert.match(polygonProblems(square.slice(0, 4))[0], /not closed/);
  assert.match(polygonProblems([[19.076, 72.8777], [19.0778, 72.8777], [19.076, 72.8777]])[0], /at least three corners/);
  const bowtie = [[19.076, 72.8777], [19.0778, 72.8796], [19.0778, 72.8777], [19.076, 72.8796], [19.076, 72.8777]];
  assert.match(polygonProblems(bowtie)[0], /crosses itself/);
  const sliver = [[19.076, 72.8777], [19.07605, 72.8777], [19.07605, 72.87775], [19.076, 72.8777]];
  assert.match(polygonProblems(sliver)[0], /smaller than/);
  const huge = [[19, 72], [19.2, 72], [19.2, 72.2], [19, 72.2], [19, 72]];
  assert.match(polygonProblems(huge)[0], /larger than/);
  assert.match(polygonProblems([[19.076, 72.8777], [200, 72.8777], [19.0778, 72.8796], [19.076, 72.8777]])[0], /valid range/);
  assert.match(polygonProblems('x')[0], /list of points/);
});

test('distances are great-circle metres', () => {
  const d = distanceM({ lat: 19.076, lng: 72.8777 }, { lat: 19.077, lng: 72.8777 });
  assert.ok(Math.abs(d - 111.19) < 0.5, String(d));
  assert.equal(distanceM({ lat: 1, lng: 2 }, { lat: 1, lng: 2 }), 0);
});

test('BR-03 blockers register by entity and only a count above zero blocks', () => {
  const calls = [];
  orgBlockers.register('site', 'test.attendance', (_db, ctx) => { calls.push(ctx); return [{ type: 'open attendance days', count: 3, hint: 'Close them.' }, { type: 'nothing', count: 0 }]; });
  const found = orgBlockers.collect(null, 'site', { companyId: 1, id: 9 });
  assert.deepEqual(found, [{ source: 'test.attendance', type: 'open attendance days', count: 3, hint: 'Close them.' }]);
  assert.deepEqual(calls, [{ companyId: 1, id: 9 }]);
  assert.deepEqual(orgBlockers.collect(null, 'project', { companyId: 1, id: 9 }), []);
  orgBlockers.unregister('site', 'test.attendance');
  assert.deepEqual(orgBlockers.collect(null, 'site', { companyId: 1, id: 9 }), []);
});
