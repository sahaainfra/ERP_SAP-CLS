import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { buildThreads } from './tst-fixtures.js';

// The integration threads (part 30.01) are also built in the shared E2E database (e2e/tst-golive.spec.js), whose data-health check runs
// the integrity suite: the fixture must leave no dangling reference. It once pointed at a calendar, a bank account, a store, a work-order
// item and an employee (id 9001) it never made, and the data-health E2E test failed after it (audit E2E triage).
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

test('the integration threads leave no dangling reference', async () => {
  const api = await startApi(); opened.push(api); await setupCompany(api);
  buildThreads(api.db, 1);
  const orphans = api.db.prepare('PRAGMA foreign_key_check').all();
  assert.deepEqual(orphans.map((r) => `${r.table} -> ${r.parent}`), []);
});
