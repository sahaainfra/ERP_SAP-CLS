import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createArtifact, writeSums } from '../scripts/lib/package.mjs';
import { deploy, environmentPaths, rollback, stopEnvironment } from '../scripts/lib/deploy.mjs';
import { ROLLBACK_TARGET_MS, rehearse } from '../scripts/lib/rehearsal.mjs';
import { ROOT } from '../src/server/db.js';

// Deployments must live under the repository so the release finds node_modules (a real host runs npm ci).
const WORK = join(ROOT, '.deploy-test');

test('T-03 rollback rehearsal: deploy, migrate, roll back within target, data kept, failure drills roll back', { timeout: 120000 }, async () => {
  const result = await rehearse({ root: ROOT, workDir: join(WORK, 'rehearsal'), port: 3391 });
  const failed = result.steps.filter((s) => !s.ok);
  assert.deepEqual(failed, [], JSON.stringify(failed));
  assert.equal(result.steps.length, 8);
  const rollbackStep = result.steps.find((s) => s.name.startsWith('roll back'));
  assert.ok(rollbackStep.ms <= ROLLBACK_TARGET_MS, `rollback took ${rollbackStep.ms} ms`);
  assert.ok(result.ok);
});

test('rollback falls back to the restore point when the down-migration fails', { timeout: 120000 }, async () => {
  const work = join(WORK, 'restore-point');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const outRoot = join(work, 'artifacts');
  const deployRoot = join(work, 'env');
  const common = { envName: 'staging', deployRoot, port: 3392, nodeEnv: 'test', environment: 'staging' };
  const { dir: a } = createArtifact({ root: ROOT, outRoot, buildId: 'rp-A', version: '1.0.0', commit: 'x', requireClient: false });
  const b = join(outRoot, 'rp-B');
  cpSync(a, b, { recursive: true });
  writeFileSync(join(b, 'build-info.json'), JSON.stringify({ version: '1.1.0', buildId: 'rp-B', commit: 'x', builtAt: null }));
  writeFileSync(join(b, 'migrations', '20261231000009_fragile.up.sql'), 'CREATE TABLE IF NOT EXISTS fragile (id INTEGER);\n');
  writeFileSync(join(b, 'migrations', '20261231000009_fragile.down.sql'), 'DROP TABLE this_table_does_not_exist;\n');
  writeSums(b);
  try {
    assert.ok((await deploy({ ...common, artifactDir: a })).ok);
    assert.ok((await deploy({ ...common, artifactDir: b })).ok);
    const r = await rollback(common);
    assert.equal(r.method, 'restore-point');
    assert.equal(r.restored, 'rp-A');
    const db = new DatabaseSync(environmentPaths(deployRoot, 'staging').db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'fragile'").all();
    db.close();
    assert.deepEqual(tables, [], 'the restore point removed the table added by B');
  } finally {
    await stopEnvironment({ envName: 'staging', deployRoot });
  }
});

test('deploy refuses a tampered artefact and a build that is already deployed', { timeout: 60000 }, async () => {
  const work = join(WORK, 'refusals');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const { dir } = createArtifact({ root: ROOT, outRoot: join(work, 'artifacts'), buildId: 'ref-A', version: '1.0.0', commit: 'x', requireClient: false });
  const common = { envName: 'staging', deployRoot: join(work, 'env'), port: 3393, nodeEnv: 'test' };
  try {
    appendFileSync(join(dir, 'src', 'server', 'flags.js'), '\n// tampered after packaging\n');
    await assert.rejects(deploy({ ...common, artifactDir: dir }), /failed verification/);
    writeSums(dir);
    assert.ok((await deploy({ ...common, artifactDir: dir })).ok);
    await assert.rejects(deploy({ ...common, artifactDir: dir }), /already deployed/);
    await assert.rejects(rollback(common), /no previous build/);
  } finally {
    await stopEnvironment({ envName: 'staging', deployRoot: common.deployRoot });
  }
});
