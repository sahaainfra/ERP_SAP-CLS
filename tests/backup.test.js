import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from '../src/server/platform/db/index.js';
import { blocks, runChecks } from '../src/server/platform/integrity/index.js';
import { createIntegrityRegistry } from '../src/server/platform/integrity/registry.js';
import { createBackup, databaseChecksums, restoreBackup, verifyBackup } from '../scripts/lib/backup.mjs';
import { PERF_RULES, createPerfDatabase, measureQueries, prng } from '../scripts/lib/testdata.mjs';

const WORK = join(ROOT, '.deploy-test', 'backup');
function fresh(name) {
  const dir = join(WORK, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

const perfRegistry = () => {
  const r = createIntegrityRegistry();
  r.register(PERF_RULES);
  r.register({ companyOptional: ['perf_companies'] });
  return r;
};

// ---- test-data generator (FR-07) ----
test('FR-07 the generator is deterministic: the same seed gives byte-identical data, a different seed does not', () => {
  const a = createPerfDatabase(':memory:', { seed: 5, documents: 300, projects: 10 });
  const b = createPerfDatabase(':memory:', { seed: 5, documents: 300, projects: 10 });
  const c = createPerfDatabase(':memory:', { seed: 6, documents: 300, projects: 10 });
  assert.deepEqual(databaseChecksums(a.db), databaseChecksums(b.db));
  assert.notEqual(databaseChecksums(a.db).tables.perf_documents.sha256, databaseChecksums(c.db).tables.perf_documents.sha256);
  const r = prng(1);
  assert.ok(r() >= 0 && r() < 1);
});

test('FR-07 generated data has the requested volumes and passes every integrity check (referential integrity, totals, keys)', () => {
  const { db, counts } = createPerfDatabase(':memory:', { documents: 2000, projects: 20, companies: 3 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM perf_documents').get().n, 2000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM perf_projects').get().n, 20);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM perf_document_lines').get().n, counts.lines);
  assert.ok(counts.lines >= 2000 && counts.lines <= 8000);
  const run = runChecks(db, { registry: perfRegistry() });
  assert.deepEqual(run.results.filter((r) => r.status === 'fail'), []);
  assert.equal(run.results.find((r) => r.code === 'header_line_totals').status, 'pass');
  assert.equal(run.results.find((r) => r.code === 'duplicate_business_keys').status, 'pass');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('FR-07 the integrity suite catches damage done to generated data', () => {
  const { db } = createPerfDatabase(':memory:', { documents: 500, projects: 10 });
  db.exec('UPDATE perf_documents SET total_amount = total_amount + 1 WHERE id = 7');
  const run = runChecks(db, { registry: perfRegistry() });
  assert.equal(run.results.find((r) => r.code === 'header_line_totals').failures, 1);
  assert.equal(blocks(run), true);
});

test('FR-07 / section 14 list and record queries use indexes (no full scan) and are fast on thousands of rows', () => {
  const { db } = createPerfDatabase(':memory:', { documents: 5000, projects: 30 });
  const t = measureQueries(db, { runs: 50 });
  assert.equal(Object.keys(t).length, 5);
  for (const [name, q] of Object.entries(t)) {
    assert.equal(q.fullScan, false, `${name}: ${q.plan.join(' | ')}`);
    assert.ok(q.p95 < 500, `${name} p95 ${q.p95} ms is over the 500 ms list target`);
  }
});

// ---- backup and restore (FR-08, T-04) ----
test('FR-08 a backup is a verified file plus a manifest with per-table checksums', () => {
  const dir = fresh('manifest');
  const src = join(dir, 'source.sqlite');
  const { db } = createPerfDatabase(src, { documents: 800, projects: 10 });
  db.close();
  const b = createBackup(src, join(dir, 'backups'), 'nightly');
  assert.ok(existsSync(b.file) && existsSync(b.manifestPath));
  const m = JSON.parse(readFileSync(b.manifestPath, 'utf8'));
  assert.equal(m.integrity, 'ok');
  assert.equal(m.tables.perf_documents.rows, 800);
  assert.match(m.fileSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(m.tables).sort(), ['perf_companies', 'perf_document_lines', 'perf_documents', 'perf_projects']);
  assert.equal(verifyBackup(b.manifestPath).ok, true);
});

test('T-04 restoring a backup produces databases with identical checksums, even after the live data changed or was lost', () => {
  const dir = fresh('restore');
  const live = join(dir, 'staging.sqlite');
  const { db } = createPerfDatabase(live, { documents: 1500, projects: 20 });
  const before = databaseChecksums(db);
  db.close();
  const b = createBackup(live, join(dir, 'backups'), 'rehearsal');

  // The live database changes, then is lost.
  const changing = new DatabaseSync(live);
  changing.exec("UPDATE perf_documents SET status = 'CLOSED' WHERE id <= 100; DELETE FROM perf_document_lines WHERE id <= 50");
  changing.close();
  rmSync(live, { force: true });
  for (const s of ['-wal', '-shm']) rmSync(`${live}${s}`, { force: true });

  const r = restoreBackup(b.manifestPath, live);
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.ok(r.timings.totalMs >= 0 && r.timings.copyMs >= 0);
  const restored = new DatabaseSync(live, { readOnly: true });
  const after = databaseChecksums(restored);
  restored.close();
  assert.deepEqual(after, before, 'every table and the schema are byte-for-byte what they were at backup time');
});

test('T-04 restoring over a different database replaces it completely', () => {
  const dir = fresh('overwrite');
  const a = join(dir, 'a.sqlite');
  const other = join(dir, 'other.sqlite');
  createPerfDatabase(a, { documents: 300, projects: 5 }).db.close();
  createPerfDatabase(other, { documents: 900, projects: 9, seed: 99 }).db.close();
  const b = createBackup(a, join(dir, 'backups'), 'a');
  assert.equal(restoreBackup(b.manifestPath, other).ok, true);
  const d = new DatabaseSync(other, { readOnly: true });
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM perf_documents').get().n, 300);
  d.close();
});

test('a tampered backup file or manifest is detected and nothing is restored', () => {
  const dir = fresh('tamper');
  const src = join(dir, 'src.sqlite');
  createPerfDatabase(src, { documents: 200, projects: 5 }).db.close();
  const b = createBackup(src, join(dir, 'backups'), 'good');
  const target = join(dir, 'target.sqlite');
  writeFileSync(target, 'precious existing data');
  appendFileSync(b.file, 'x');
  const r = restoreBackup(b.manifestPath, target);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /changed after it was taken|integrity/);
  assert.equal(readFileSync(target, 'utf8'), 'precious existing data', 'a failed verification leaves the target untouched');

  const b2 = createBackup(src, join(dir, 'backups'), 'good2');
  const manifest = JSON.parse(readFileSync(b2.manifestPath, 'utf8'));
  manifest.tables.perf_documents.rows += 1;
  writeFileSync(b2.manifestPath, JSON.stringify(manifest));
  const v = verifyBackup(b2.manifestPath);
  assert.equal(v.ok, false);
  assert.match(v.problems.join(' '), /perf_documents/);
  rmSync(b2.file);
  assert.match(verifyBackup(b2.manifestPath).problems[0], /is missing/);
});

test('a backup can be taken while the database is open and being written to', () => {
  const dir = fresh('live');
  const live = join(dir, 'live.sqlite');
  const { db } = createPerfDatabase(live, { documents: 400, projects: 5 });
  db.exec("INSERT INTO perf_companies (id, company_id, name) VALUES (50, 50, 'late')");
  const b = createBackup(live, join(dir, 'backups'), 'while-open');
  assert.equal(JSON.parse(readFileSync(b.manifestPath, 'utf8')).tables.perf_companies.rows, 4);
  db.close();
});

test('the backup CLIs: db:backup then db:restore round-trip, and restore refuses to overwrite without --yes', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = fresh('cli');
  const src = join(dir, 'app.sqlite');
  createPerfDatabase(src, { documents: 150, projects: 5 }).db.close();
  const run = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_PATH: src } });
  const bk = run('scripts/db_backup.mjs', ['--db', src, '--dir', join(dir, 'b'), '--name', 'cli']);
  assert.equal(bk.status, 0, bk.stderr);
  assert.match(bk.stdout, /Backup cli: .* 4 tables/);
  const manifest = join(dir, 'b', 'cli.manifest.json');
  const refuse = run('scripts/db_restore.mjs', [manifest, '--to', src]);
  assert.equal(refuse.status, 2);
  assert.match(refuse.stderr, /--yes/);
  const ok = run('scripts/db_restore.mjs', [manifest, '--to', src, '--yes']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /checksums identical/);
});
