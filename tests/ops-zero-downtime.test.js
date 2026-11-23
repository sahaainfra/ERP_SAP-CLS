import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rehearseZeroDowntime } from '../scripts/lib/zero_downtime.mjs';

// Part 30.08 T-01: zero-downtime deploy and rollback rehearsal. Build A, then B with an additive migration, deployed blue-green behind the
// switching proxy under steady traffic; rolled back to A under traffic; a failing migration and a build that does not start leave A serving.
// Not one request may fail.
test('T-01 FR-02 zero-downtime deploy and rollback under traffic, with the two failure drills', async () => {
  const r = await rehearseZeroDowntime({ root: process.cwd(), workDir: join(process.cwd(), '.deploy-zero-downtime-test'), basePort: 3396 });
  assert.equal(r.ok, true, JSON.stringify(r.steps.filter((s) => !s.ok)));
  assert.equal(r.failed, 0); assert.ok(r.requests > 500, `${r.requests} requests`);
  const sw = r.steps.find((s) => s.name.startsWith('deploy build B')); assert.deepEqual(sw.traffic.builds, ['zd-A', 'zd-B']);
  const rb = r.steps.find((s) => s.name.startsWith('roll back')); assert.deepEqual(rb.traffic.builds, ['zd-B', 'zd-A']);
});
