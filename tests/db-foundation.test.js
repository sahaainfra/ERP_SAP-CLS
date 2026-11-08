import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_DIR, ROOT, appliedMigrations, migrateDown, migrateUp, listMigrations } from '../src/server/platform/db/index.js';
import { companyScope, findScoped, listScoped } from '../src/server/platform/db/scope.js';
import { listBackfillRuns, runBackfill } from '../src/server/platform/db/backfill.js';
import { integrityRegistry } from '../src/server/platform/integrity/index.js';
import { createIntegrityRegistry } from '../src/server/platform/integrity/registry.js';
import '../src/server/modules/registry.js';
import { checkMigrations } from '../scripts/lib/migration_check.mjs';
import { lintMigrationRegistry, lintSchema, migratedDatabase, renderBaseline } from '../scripts/lib/schema_lint.mjs';
import { nextMigrationId, scaffoldMigration, tableTemplate } from '../scripts/lib/scaffold.mjs';
import { databaseChecksums } from '../scripts/lib/backup.mjs';
import { fromUnits, toUnits } from '../src/shared/money.js';
import { memoryDb } from './helpers.js';

const scratch = (p) => mkdtempSync(join(tmpdir(), p));
const STD = `created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT, version INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT, deleted_by TEXT, source_type TEXT, source_id TEXT, remarks TEXT`;

// ---- T-01: up, down, up on a database that holds data ----
test('T-01 migration up, down, up on a populated database leaves schema and row counts identical', () => {
  const db = memoryDb();
  db.prepare("INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, project_id, enabled) VALUES ('ff.t.x', 't', 0, NULL, 5, NULL, 1)").run();
  db.prepare("INSERT INTO core_audit_log (entity, entity_id, action, actor) VALUES ('t', '1', 'create', 'a')").run();
  db.prepare("INSERT INTO core_outbox (event_type, aggregate_id, payload) VALUES ('x.y.z', '1', '{}')").run();
  const before = databaseChecksums(db);
  const all = appliedMigrations(db);
  const reverted = migrateDown(db, 172); // seed bud p1202, bud changes, seed bud p1201, bud budgets, seed engg p1105, engg letters, seed engg p1104, engg deliverables, seed engg p1103, engg submittals, seed engg p1102, engg rfis, seed engg p1101, engg drawings, seed proj p1008, proj 360, ui nav permission fix, seed proj p1007, gis, seed proj p1006, proj risks, seed proj p1005, proj team meetings, seed proj p1004, proj boq, seed proj p1003, proj structure, seed proj p1002, proj baseline, seed proj p1001, proj projects, seed est p0903, est reviews, seed est p0902, mto takeoffs, seed est p0901, est estimates, seed bd p0803, tdr awards, seed bd p0802, tdr tenders, seed bd p0801, bd crm, seed hr p0713, hr exit relations, seed hr p0712, exp expenses, seed hr p0711, perf performance, seed hr p0710, trn training, seed hr p0709, ess requests, seed hr p0708, lab contract labour, seed hr p0707, lv leave, seed hr p0706, att register, seed hr p0705, att punches, seed hr p0704, att config, seed hr p0703, hr deployments, seed hr p0702, hr recruitment, seed hr p0701, hr employees, seed mdm p0606, mdm rate analysis, seed fin p0605, fin chart of accounts, seed mdm p0604, mdm partners, seed mdm p0603, mdm items, seed mdm p0602, mdm common masters, seed mdm p0601, mdm governance, seed pol p0505, pol policies, seed msg p0504, msg comcenter, seed msg p0503, sec messaging, seed msg p0502, msg features, seed msg p0501, msg conversations, seed eng p0415, eng offline, seed eng p0414, eng collaboration, seed eng p0413, eng excel engine, seed eng p0412, eng signatures, seed eng p0411, eng templates, seed eng p0410, eng documents, seed eng p0409, eng alerts, seed eng p0408, eng tasks, seed eng p0407, eng communication, seed eng p0406, eng notifications, seed eng p0405, eng accountability, seed eng p0404, eng protocol control, seed eng p0403, eng approval inbox, seed eng p0402, eng approval matrix, seed eng p0401, eng workflow, seed ui p0310, ui page migration, seed ui p0309, ui translations, seed ui p0308, core search index, seed ui p0307, ui dashboards, seed ui p0306, ui device, seed ui p0305, ui shell, seed ui p0304, ui object page, seed ui p0303, ui saved views and exports, seed ui p0302, ui forms and drafts, seed ui p0301, ui preferences, seed iam p0207, route registry and security settings, seed iam p0206, audit chain and security event tables, seed iam p0205, segregation of duties and access review tables, seed iam p0204, role engine tables, seed iam p0203, user management tables, seed iam p0202, organisation tables, seed iam p0201, iam tables, seed p0108, integration hub tables, seed p0107, observability tables, seed p0106, calculation engine, seed p0105, files, request types, seed p0104, events and jobs, seed p0103, numbering, configuration, seed p0102, the foundation tables, seed p0101
  assert.equal(reverted.length, 172);
  assert.ok(!appliedMigrations(db).includes(all.at(-1)));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'core_idempotency_keys'").get().n, 0, 'the down migration removed what the up migration added');
  migrateUp(db);
  const after = databaseChecksums(db);
  assert.equal(after.schemaSha256, before.schemaSha256, 'schema identical');
  assert.deepEqual(Object.keys(after.tables), Object.keys(before.tables));
  for (const [name, t] of Object.entries(before.tables)) assert.equal(after.tables[name].rows, t.rows, `table ${name}: same row count`);
  // Re-applied seed rows get new ids and timestamps, so the flags are compared by what they mean, not byte for byte.
  const meaning = (d) =>
    d.prepare("SELECT key, environment, company_id, project_id, enabled FROM core_feature_flags WHERE key <> 'ff.t.x' ORDER BY key, environment, company_id").all();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_feature_flags WHERE key = 'ff.t.x'").get().n, 1, 'data that is not seed data survives the down and up');
  const fresh = memoryDb();
  assert.deepEqual(meaning(db), meaning(fresh));
  for (const t of ['core_audit_log', 'core_outbox']) assert.deepEqual(after.tables[t], before.tables[t], `${t}: contents identical`);
});

test('FR-02 every migration passes the up/down check, including the new foundation migrations', () => {
  assert.deepEqual(checkMigrations(MIGRATIONS_DIR), []);
  assert.ok(listMigrations().some((m) => m.id.endsWith('core_database_foundation')));
});

// ---- scope (FR-06) ----
function scopedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tst_items (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT, ${STD});`);
  const ins = db.prepare('INSERT INTO tst_items (id, company_id, name) VALUES (?, ?, ?)');
  for (let i = 1; i <= 30; i++) ins.run(i, i % 2 === 0 ? 1 : 2, `item ${i}`);
  db.exec("UPDATE tst_items SET is_active = 0, deleted_at = '2026-10-30' WHERE id = 2");
  return db;
}

test('FR-06 company scope: an actor without a company is denied, never given every company', () => {
  assert.throws(() => companyScope({ user: 'x', companyId: null }), { status: 403 });
  assert.throws(() => companyScope(undefined), { status: 403 });
  assert.deepEqual(companyScope({ companyId: 4 }), { sql: 'company_id = :_company_scope', params: { _company_scope: 4 } });
  assert.equal(companyScope({ companyId: 4 }, { alias: 'h' }).sql, 'h.company_id = :_company_scope');
  assert.throws(() => companyScope({ companyId: 4 }, { alias: 'h; DROP' }), /Unsafe SQL identifier/);
});

test('FR-06 findScoped and listScoped only ever return the actor\'s own company, and skip soft-deleted rows', () => {
  const db = scopedDb();
  const meera = { user: 'm', companyId: 1 };
  assert.equal(findScoped(db, 'tst_items', meera, 4).name, 'item 4');
  assert.equal(findScoped(db, 'tst_items', meera, 3), undefined, 'a row of another company is "not found"');
  assert.equal(findScoped(db, 'tst_items', meera, 2), undefined, 'a soft-deleted row is not found');
  const page = listScoped(db, 'tst_items', meera, { limit: 5, orderBy: 'id DESC' });
  assert.equal(page.total, 14);
  assert.ok(page.rows.every((r) => r.company_id === 1));
  assert.deepEqual(page.rows.map((r) => r.id), [30, 28, 26, 24, 22]);
  const filtered = listScoped(db, 'tst_items', meera, { where: 'name LIKE :n', params: { n: '%2%' }, limit: 50 });
  assert.ok(filtered.rows.every((r) => r.company_id === 1 && r.name.includes('2')));
  assert.throws(() => findScoped(db, 'tst_items', { companyId: null }, 1), { status: 403 });
});

test('FR-06 a scoped list must be bounded, and table and order names are checked', () => {
  const db = scopedDb();
  const a = { companyId: 1 };
  assert.throws(() => listScoped(db, 'tst_items', a, {}), RangeError);
  assert.throws(() => listScoped(db, 'tst_items', a, { limit: 201 }), RangeError);
  assert.throws(() => listScoped(db, 'tst_items; DROP TABLE tst_items', a, { limit: 5 }), /Unsafe/);
  assert.throws(() => listScoped(db, 'tst_items', a, { limit: 5, orderBy: 'id; DROP TABLE tst_items' }), /Unsafe/);
});

// ---- back-fill (FR-02) ----
function fillTable() {
  const db = memoryDb();
  db.exec('CREATE TABLE tst_people (id INTEGER PRIMARY KEY, name TEXT, name_upper TEXT)');
  const ins = db.prepare('INSERT INTO tst_people (id, name) VALUES (?, ?)');
  for (let i = 1; i <= 25; i++) ins.run(i, `person ${i}`);
  return db;
}

/** Fills name_upper in batches by primary key; `failAt` makes one batch throw after it has written. */
function upperBackfill({ failAt = null } = {}) {
  let calls = 0;
  return {
    name: 'tst_people_name_upper',
    description: 'fill name_upper',
    run(db, { cursor, batchSize }) {
      calls += 1;
      const rows = db.prepare('SELECT id, name FROM tst_people WHERE id > ? ORDER BY id LIMIT ?').all(Number(cursor ?? 0), batchSize);
      for (const r of rows) db.prepare('UPDATE tst_people SET name_upper = ? WHERE id = ?').run(r.name.toUpperCase(), r.id);
      if (failAt === calls) throw new Error('disk full (simulated)');
      return { nextCursor: rows.length ? String(rows.at(-1).id) : cursor, processed: rows.length, done: rows.length < batchSize };
    },
  };
}

test('back-fill runs in batches, logs each one, and finishes with a completed ledger row', () => {
  const db = fillTable();
  const r = runBackfill(db, upperBackfill(), { batchSize: 10 });
  assert.deepEqual([r.status, r.processed, r.batches], ['completed', 25, 3]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tst_people WHERE name_upper IS NULL').get().n, 0);
  const [row] = listBackfillRuns(db);
  assert.deepEqual([row.name, row.status, row.processed, row.batches], ['tst_people_name_upper', 'completed', 25, 3]);
  assert.ok(row.finished_at);
  const log = db.prepare("SELECT action FROM core_audit_log WHERE entity = 'core_backfill_runs' ORDER BY id").all().map((x) => x.action);
  assert.deepEqual(log, ['batch', 'batch', 'completed']);
});

test('back-fill is resumable: a failed batch rolls back, the next run continues from the saved cursor', () => {
  const db = fillTable();
  const failed = runBackfill(db, upperBackfill({ failAt: 2 }), { batchSize: 10 });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /disk full/);
  const [row] = listBackfillRuns(db);
  assert.deepEqual([row.status, row.processed, row.batches, row.cursor], ['failed', 10, 1, '10']);
  assert.match(row.last_error, /disk full/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tst_people WHERE name_upper IS NOT NULL').get().n, 10, 'the failed batch wrote nothing');
  const resumed = runBackfill(db, upperBackfill(), { batchSize: 10 });
  assert.deepEqual([resumed.status, resumed.processed, resumed.batches], ['completed', 25, 3]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tst_people WHERE name_upper IS NULL').get().n, 0);
});

test('a completed back-fill is skipped, and maxBatches pauses it so it can be run in slices', () => {
  const db = fillTable();
  const paused = runBackfill(db, upperBackfill(), { batchSize: 10, maxBatches: 1 });
  assert.deepEqual([paused.status, paused.paused, paused.processed], ['running', true, 10]);
  assert.equal(runBackfill(db, upperBackfill(), { batchSize: 10 }).status, 'completed');
  const again = runBackfill(db, upperBackfill(), { batchSize: 10 });
  assert.equal(again.skipped, true);
  assert.equal(listBackfillRuns(db)[0].processed, 25, 'nothing was processed twice');
  assert.throws(() => runBackfill(db, { name: 'x' }), /needs a name and a run/);
});

// ---- scaffold, lint, baseline (FR-01, FR-02, FR-05) ----
test('migration ids are timestamps that always come after the existing ones', () => {
  const dir = scratch('erp-scaf-');
  writeFileSync(join(dir, '20261030000009_a.up.sql'), '');
  assert.equal(nextMigrationId(dir, new Date('2026-10-30T00:00:00Z')), '20261030000010', 'never earlier than the last id');
  assert.equal(nextMigrationId(dir, new Date('2027-01-02T03:04:05Z')), '20270102030405');
});

test('FR-05 the scaffolded table follows the standard: it passes migration check and schema lint with no errors', () => {
  const dir = scratch('erp-scaf-');
  for (const f of readdirSync(MIGRATIONS_DIR)) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
  scaffoldMigration(dir, 'proc_orders_table', { table: 'proc_orders', numbered: true, money: ['total_amount'], now: new Date('2027-01-02T03:04:05Z') });
  scaffoldMigration(dir, 'proc_order_lines_table', {
    table: 'proc_order_lines',
    money: ['amount'],
    fks: [{ column: 'order_id', references: 'proc_orders' }],
    now: new Date('2027-01-02T03:05:00Z'),
  });
  assert.deepEqual(checkMigrations(dir), []);
  const { errors } = lintSchema(migratedDatabase(dir), integrityRegistry);
  assert.deepEqual(errors, []);
  const up = tableTemplate('proc_orders', { numbered: true, money: ['total_amount'] }).up;
  assert.match(up, /CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_orders_doc_no ON proc_orders \(company_id, doc_no\)/);
  assert.match(up, /CHECK \(total_amount >= 0\)/);
});

test('the scaffold refuses bad names', () => {
  assert.throws(() => tableTemplate('Orders'), /module prefix/);
  assert.throws(() => tableTemplate('orders'), /module prefix/);
  assert.throws(() => tableTemplate('proc_orders', { money: ['bad col'] }), /Bad column/);
  assert.throws(() => scaffoldMigration(scratch('x-'), 'Bad Name'), /lower-case/);
});

test('FR-05 schema lint catches missing standard columns, unindexed foreign keys, float money, missing doc_no key and bad names', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE bad_parent (id INTEGER PRIMARY KEY, company_id INTEGER);
    CREATE TABLE bad_child (id INTEGER PRIMARY KEY, company_id INTEGER, parent_id INTEGER REFERENCES bad_parent(id), total_amount REAL, qty TEXT, doc_no TEXT, ${STD});
    CREATE TABLE BadName (id INTEGER PRIMARY KEY);
  `);
  const { errors } = lintSchema(db, createIntegrityRegistry());
  const text = errors.join('\n');
  assert.match(text, /bad_parent: missing standard column\(s\) .*created_by/);
  assert.match(text, /bad_child\.parent_id: foreign key to bad_parent has no index/);
  assert.match(text, /bad_child\.total_amount: .*INTEGER minor units.*REAL/);
  assert.match(text, /bad_child\.qty: .*TEXT/);
  assert.match(text, /bad_child: has doc_no but no UNIQUE index on \(company_id, doc_no\)/);
  assert.match(text, /BadName: table names are lower-case snake_case/);
  const reg = createIntegrityRegistry();
  reg.register({ technicalTables: ['bad_parent'] });
  assert.ok(!lintSchema(db, reg).errors.join('\n').includes('bad_parent: missing standard'), 'a technical table is exempt from the business-table rules');
});

test('FR-05 the application\'s own schema lints clean, and every migration is registered in DB_CHANGES.md', () => {
  const { errors } = lintSchema(migratedDatabase(MIGRATIONS_DIR), integrityRegistry);
  assert.deepEqual(errors, []);
  const changes = readFileSync(join(ROOT, 'docs', 'erp', 'DB_CHANGES.md'), 'utf8');
  assert.deepEqual(lintMigrationRegistry(MIGRATIONS_DIR, changes), []);
  assert.deepEqual(lintMigrationRegistry(MIGRATIONS_DIR, 'nothing here'), listMigrations().map((m) => `${m.id}: not registered in docs/erp/DB_CHANGES.md`));
});

test('FR-01 DB_BASELINE.md is deterministic and matches the migrations', () => {
  const rendered = renderBaseline(migratedDatabase(MIGRATIONS_DIR));
  assert.equal(rendered, renderBaseline(migratedDatabase(MIGRATIONS_DIR)));
  assert.equal(readFileSync(join(ROOT, 'docs', 'erp', 'DB_BASELINE.md'), 'utf8').replace(/\r\n/g, '\n'), rendered, 'run npm run erp:db-baseline');
  assert.match(rendered, /## core_idempotency_keys/);
  assert.match(rendered, /migration zero/);
});

// ---- command-line tools ----
const run = (script, args = [], env = {}) =>
  spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_PATH: ':memory:', ...env } });

test('BR-03 erp:db-check passes on a fresh database and blocks (exit 1) on a Critical failure', () => {
  const ok = run('scripts/db_check.mjs', ['--fresh']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /Integrity gate OK/);
  const dir = scratch('erp-chk-');
  const file = join(dir, 'broken.sqlite');
  const db = new DatabaseSync(file);
  migrateUp(db);
  db.exec(`CREATE TABLE tst_parent (id INTEGER PRIMARY KEY, company_id INTEGER, ${STD}); CREATE TABLE tst_kid (id INTEGER PRIMARY KEY, company_id INTEGER, parent_id INTEGER REFERENCES tst_parent(id), ${STD});`);
  db.exec('PRAGMA foreign_keys = OFF; INSERT INTO tst_kid (company_id, parent_id) VALUES (1, 77);');
  db.close();
  const bad = run('scripts/db_check.mjs', ['--db', file, '--record']);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL\s+Critical\s+orphan_foreign_keys/);
  assert.match(bad.stdout, /tst_kid/);
  assert.match(bad.stdout, /Integrity gate FAILED/);
  const recorded = new DatabaseSync(file, { readOnly: true }).prepare("SELECT status FROM core_integrity_runs WHERE check_code = 'orphan_foreign_keys'").get();
  assert.equal(recorded.status, 'fail', '--record keeps the result');
  const highOnly = run('scripts/db_check.mjs', ['--db', file, '--fail-on', 'Low']);
  assert.equal(highOnly.status, 1);
});

test('erp:db-lint and the baseline check pass on the repository', () => {
  const r = run('scripts/db_lint.mjs');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Schema lint OK/);
});

test('money, rate, quantity and percent are stored as whole minor units and come back exact (ADR-14)', () => {
  assert.equal(toUnits('1234.565', 'money'), 123457);
  assert.equal(toUnits('0.1', 'money') + toUnits('0.2', 'money'), toUnits('0.3', 'money'));
  assert.equal(toUnits('2.5', 'quantity'), 2500);
  assert.equal(toUnits('12.3456', 'rate'), 123456);
  assert.equal(toUnits('18', 'percent'), 180000);
  assert.equal(fromUnits(123457, 'money').toString(), '1234.57');
  assert.equal(fromUnits(2500, 'quantity').toString(), '2.500');
  assert.throws(() => toUnits('1', 'euro'), RangeError);
  assert.throws(() => toUnits('99999999999999999999', 'money'), /too large/);
});
