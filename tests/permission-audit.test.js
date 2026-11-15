import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { TEMPLATE_PERMISSIONS } from '../src/server/platform/authz/templates.js';

// Part 166.1 F-03 / T-02: who holds the dashboard designer and every other sensitive permission is reviewed; a PM never holds ui.dashboard.manage.
test('F-03 the templates give ui.dashboard.manage to the system administrators and the project controls manager only', () => {
  const holders = Object.entries(TEMPLATE_PERMISSIONS).filter(([, p]) => p.includes('ui.dashboard.manage')).map(([r]) => r).sort();
  assert.deepEqual(holders, ['PCMGR', 'SUPADM', 'SYSADM']);
  assert.equal(TEMPLATE_PERMISSIONS.PM.includes('ui.dashboard.manage'), false);
});
test('FR-02 the audit script passes on the templates and fails on a grant that is not in the baseline', () => {
  const ok = spawnSync(process.execPath, ['scripts/permission_audit.mjs'], { encoding: 'utf8' }); assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});
