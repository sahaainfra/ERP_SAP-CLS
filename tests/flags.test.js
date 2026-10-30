import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { appliedMigrations, listMigrations, migrateDown, migrateUp } from '../src/server/platform/db/index.js';
import { isEnabled, resolveFlag, setFlag } from '../src/server/modules/core/feature-flags/service.js';
import { memoryDb } from './helpers.js';

function seededDb() {
  const db = memoryDb();
  const ins = db.prepare(
    `INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, project_id, enabled)
     VALUES ('ff.t.x', 'test', 0, ?, ?, ?, ?)`,
  );
  ins.run(null, null, null, 0);
  ins.run('production', null, null, 1);
  ins.run(null, 1, null, 0);
  ins.run(null, 1, 11, 1);
  return db;
}

test('T-01 project override beats company override beats environment default beats flag default', () => {
  const db = seededDb();
  const r = (ctx) => resolveFlag(db, 'ff.t.x', ctx);
  assert.deepEqual(r({ environment: 'development' }), { enabled: false, source: 'default' });
  assert.deepEqual(r({ environment: 'production' }), { enabled: true, source: 'environment' });
  assert.deepEqual(r({ environment: 'production', companyId: 1 }), { enabled: false, source: 'company' });
  assert.deepEqual(r({ environment: 'production', companyId: 1, projectId: 11 }), { enabled: true, source: 'project' });
  assert.deepEqual(r({ environment: 'production', companyId: 1, projectId: 12 }), { enabled: false, source: 'company' });
  assert.deepEqual(r({ environment: 'production', companyId: 2, projectId: 11 }), { enabled: true, source: 'environment' });
});

test('an undefined flag is OFF', () => {
  const db = seededDb();
  assert.equal(isEnabled(db, 'ff.nope', { environment: 'production' }), false);
});

test('setFlag creates an override, audits it and queues an outbox event in one transaction', () => {
  const db = seededDb();
  const saved = setFlag(db, {
    key: 'ff.t.x',
    scope: { level: 'company', companyId: 5 },
    enabled: true,
    reason: 'enable for pilot',
    actor: 'alice',
    correlationId: 'c-1',
  });
  assert.equal(saved.version, 1);
  assert.equal(isEnabled(db, 'ff.t.x', { environment: 'development', companyId: 5 }), true);
  const audit = db.prepare('SELECT * FROM core_audit_log').all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, 'alice');
  assert.equal(audit[0].reason, 'enable for pilot');
  assert.equal(JSON.parse(audit[0].new_values).enabled, true);
  const events = db.prepare('SELECT * FROM core_outbox').all();
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'core.feature_flag.changed');
});

test('setFlag rejects a stale version and changes nothing', () => {
  const db = seededDb();
  const scope = { level: 'company', companyId: 1 };
  assert.throws(() => setFlag(db, { key: 'ff.t.x', scope, enabled: true, reason: 'valid reason', version: 99, actor: 'a' }), {
    status: 409,
  });
  assert.throws(() => setFlag(db, { key: 'ff.t.x', scope, enabled: true, reason: 'valid reason', actor: 'a' }), { status: 409 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_audit_log').get().n, 0);
  const current = db.prepare('SELECT version FROM core_feature_flags WHERE company_id = 1 AND project_id IS NULL').get().version;
  const updated = setFlag(db, { key: 'ff.t.x', scope, enabled: true, reason: 'valid reason', version: current, actor: 'a' });
  assert.equal(updated.version, current + 1);
});

test('setFlag on an undefined flag is 404', () => {
  const db = seededDb();
  assert.throws(() => setFlag(db, { key: 'ff.nope', scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'valid reason', actor: 'a' }), {
    status: 404,
  });
});

test('a failure after the write rolls the whole change back', () => {
  const db = seededDb();
  db.exec('DROP TABLE core_outbox');
  assert.throws(() => setFlag(db, { key: 'ff.t.x', scope: { level: 'company', companyId: 9 }, enabled: true, reason: 'valid reason', actor: 'a' }));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_feature_flags WHERE company_id = 9').get().n, 0);
});

test('migrations apply idempotently and revert cleanly', () => {
  const db = new DatabaseSync(':memory:');
  const all = listMigrations().map((m) => m.id);
  assert.deepEqual(migrateUp(db), all);
  assert.deepEqual(migrateUp(db), []);
  assert.deepEqual(appliedMigrations(db), all);
  migrateDown(db, all.length);
  assert.deepEqual(appliedMigrations(db), []);
  const left = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'core_%' AND name <> 'core_schema_migrations'").all();
  assert.deepEqual(left, []);
});

test('the reference seed defines the baseline flags OFF by default', () => {
  const db = memoryDb();
  assert.equal(isEnabled(db, 'ff.prog.p0002', { environment: 'production' }), false);
  assert.equal(isEnabled(db, 'ff.prog.p0002', { environment: 'development' }), true);
});
