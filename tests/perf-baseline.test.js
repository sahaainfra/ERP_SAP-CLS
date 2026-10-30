import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareBaselines, runBaseline, summarize } from '../scripts/lib/perf.mjs';

test('FR-08 summarize gives percentiles and compareBaselines flags only real slowdowns', () => {
  const s = summarize([10, 20, 30, 40, 100]);
  assert.deepEqual([s.count, s.p50Ms, s.p95Ms, s.maxMs], [5, 30, 100, 100]);
  assert.deepEqual(summarize([]).count, 0);
  const base = { journeys: [{ id: 'a', p95Ms: 100, errors: 0 }, { id: 'b', p95Ms: 5, errors: 0 }, { id: 'c', p95Ms: 100, errors: 0 }] };
  const now = { journeys: [{ id: 'a', p95Ms: 160, errors: 0 }, { id: 'b', p95Ms: 12, errors: 0 }, { id: 'c', p95Ms: 50, errors: 1 }, { id: 'd', p95Ms: 1, errors: 0 }] };
  assert.deepEqual(compareBaselines(base, now).map((d) => [d.id, d.status]), [['a', 'regression'], ['b', 'same'], ['c', 'faster'], ['d', 'new']]);
});

test('FR-08 a small baseline run drives every journey over HTTP without errors', async () => {
  const lines = [];
  const report = await runBaseline({ durationMs: 150, concurrency: 2, size: { documents: 50, bills: 50, events: 200 }, log: (l) => lines.push(l) });
  assert.equal(report.journeys.length, 9);
  assert.ok(report.journeys.every((j) => j.requests > 0 && j.errors === 0), JSON.stringify(report.journeys.filter((j) => j.errors)));
  assert.equal(lines.length, 9);
  assert.ok(report.environment.node && report.dataset.events === 200);
});
