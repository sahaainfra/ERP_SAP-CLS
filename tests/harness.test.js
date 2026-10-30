import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffSchema, snapshotFromMigrations } from '../scripts/lib/schema.mjs';
import { canonical, captureGolden, compareGolden, sha256 } from '../scripts/lib/golden.mjs';
import { MIGRATIONS_DIR, ROOT } from '../src/server/db.js';

function scratchMigrations(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-mig-'));
  for (const f of readdirSync(MIGRATIONS_DIR)) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
  for (const [name, sql] of Object.entries(extra)) writeFileSync(join(dir, name), sql);
  return dir;
}

const baseline = snapshotFromMigrations(MIGRATIONS_DIR);

test('schema-diff is clean on the unchanged migrations', () => {
  assert.deepEqual(diffSchema(baseline, snapshotFromMigrations(MIGRATIONS_DIR)), []);
});

test('T-03 altering an existing column in a scratch migration makes schema-diff fail', () => {
  const dir = scratchMigrations({
    '20261031000001_bad_alter.up.sql': `
      ALTER TABLE core_feature_flags RENAME COLUMN remarks TO notes;`,
    '20261031000001_bad_alter.down.sql': 'ALTER TABLE core_feature_flags RENAME COLUMN notes TO remarks;',
  });
  const problems = diffSchema(baseline, snapshotFromMigrations(dir));
  assert.ok(problems.some((p) => /DROPPED column table:core_feature_flags.remarks/.test(p)), problems.join('\n'));
});

test('T-03 dropping an existing table and changing an index also fail', () => {
  const dir = scratchMigrations({
    '20261031000002_bad_drop.up.sql': 'DROP TABLE core_outbox; DROP INDEX ix_core_audit_log_entity; CREATE INDEX ix_core_audit_log_entity ON core_audit_log (actor);',
    '20261031000002_bad_drop.down.sql': 'SELECT 1;',
  });
  const problems = diffSchema(baseline, snapshotFromMigrations(dir));
  assert.ok(problems.includes('DROPPED table:core_outbox'));
  assert.ok(problems.includes('ALTERED index:ix_core_audit_log_entity'));
});

test('additive changes pass: new table and a new nullable column', () => {
  const dir = scratchMigrations({
    '20261031000003_additive.up.sql': 'CREATE TABLE core_new_thing (id INTEGER PRIMARY KEY); ALTER TABLE core_audit_log ADD COLUMN note TEXT;',
    '20261031000003_additive.down.sql': 'DROP TABLE core_new_thing;',
  });
  assert.deepEqual(diffSchema(baseline, snapshotFromMigrations(dir)), []);
});

test('a new NOT NULL column without a default is flagged as unsafe', () => {
  const current = structuredClone(baseline);
  current['table:core_outbox'].columns.push({ name: 'x', type: 'TEXT', notnull: 1, dflt: null, pk: 0 });
  assert.ok(diffSchema(baseline, current).some((p) => /UNSAFE new column/.test(p)));
});

test('the locked baseline file matches the current migrations (the CLI exits 0)', () => {
  const r = spawnSync(process.execPath, ['scripts/schema_diff.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the CLI exits non-zero for a scratch migrations directory that alters a locked column', () => {
  const dir = scratchMigrations({
    '20261031000004_bad.up.sql': 'ALTER TABLE core_feature_flags DROP COLUMN source_id;',
    '20261031000004_bad.down.sql': 'SELECT 1;',
  });
  const r = spawnSync(process.execPath, ['scripts/schema_diff.mjs', '--migrations-dir', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Schema-diff FAILED/);
});

test('golden outputs are byte-identical when re-run (T-02 of 00.01)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erp-gold-'));
  const reg = [{ id: 'calc.demo', run: () => ({ b: 2, a: [1, { z: 1, y: 2 }] }) }];
  captureGolden(reg, dir);
  const first = readFileSync(join(dir, 'calc.demo.json'));
  captureGolden(reg, dir);
  assert.ok(first.equals(readFileSync(join(dir, 'calc.demo.json'))));
  assert.deepEqual(compareGolden(reg, dir), [{ id: 'calc.demo', status: 'ok' }]);
});

test('T-04 a deliberately changed calculation makes the golden comparison fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erp-gold-'));
  const amount = (rate) => ({ amount: Math.round(100 * rate) });
  captureGolden([{ id: 'calc.amount', run: () => amount(1.18) }], dir);
  const results = compareGolden([{ id: 'calc.amount', run: () => amount(1.28) }], dir);
  assert.equal(results[0].status, 'changed');
});

test('a golden difference passes only when approved in DECISIONS.md with its hash and a reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erp-gold-'));
  captureGolden([{ id: 'calc.a', run: () => ({ v: 1 }) }], dir);
  const changed = [{ id: 'calc.a', run: () => ({ v: 2 }) }];
  const hash = sha256(canonical({ v: 2 }));
  assert.equal(compareGolden(changed, dir, `GOLDEN-APPROVED: calc.a ${'0'.repeat(64)} wrong hash`)[0].status, 'changed');
  const ok = compareGolden(changed, dir, `GOLDEN-APPROVED: calc.a ${hash} rate change approved by finance`);
  assert.equal(ok[0].status, 'approved');
  assert.equal(compareGolden(changed, dir, `GOLDEN-APPROVED: calc.a ${hash} `)[0].status, 'changed', 'a reason is mandatory');
});

test('a missing golden file is reported, not silently created', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erp-gold-'));
  assert.equal(compareGolden([{ id: 'calc.new', run: () => 1 }], dir)[0].status, 'missing');
});

test('the repository golden outputs match the registry', () => {
  const r = spawnSync(process.execPath, ['scripts/golden.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
