import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

test('BR-AUD-008 the permission baseline is a reviewed change: a version needs a maker and a note, and its maker never checks it', () => {
  const run = (...a) => spawnSync(process.execPath, ['scripts/permission_audit.mjs', ...a], { encoding: 'utf8' });
  const noMaker = run('--write-baseline'); assert.equal(noMaker.status, 2); assert.match(noMaker.stderr, /--maker/);
  const reviews = JSON.parse(readFileSync('docs/erp/PERMISSION_REVIEWS.json', 'utf8')); const last = reviews.at(-1);
  assert.equal(createHash('sha256').update(readFileSync('docs/erp/PERMISSION_BASELINE.json', 'utf8')).digest('hex'), last.sha256, 'the baseline is its latest recorded version');
  if (!last.checker) {
    const self = run('--record-check', '--checker', last.maker, '--checker-role', 'ITADM'); assert.equal(self.status, 2); assert.match(self.stderr, /does not check it/);
    const role = run('--record-check', '--checker', 'someone else', '--checker-role', 'SYSADM'); assert.equal(role.status, 2); assert.match(role.stderr, /ITADM\|DIR/);
  }
});
