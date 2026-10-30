import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = join(ROOT, 'migrations');

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(ROOT, path)), { recursive: true });
  const db = new DatabaseSync(path === ':memory:' ? path : resolve(ROOT, path));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Migration files: <id>_<name>.up.sql / <id>_<name>.down.sql, applied in id order. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  const ids = new Map();
  for (const file of readdirSync(dir).sort()) {
    const m = /^(\d{14}_[a-z0-9_]+)\.(up|down)\.sql$/.exec(file);
    if (!m) continue;
    const entry = ids.get(m[1]) ?? { id: m[1] };
    entry[m[2]] = readFileSync(join(dir, file), 'utf8');
    ids.set(m[1], entry);
  }
  return [...ids.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function ensureLedger(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS core_schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
}

export function appliedMigrations(db) {
  ensureLedger(db);
  return db.prepare('SELECT id FROM core_schema_migrations ORDER BY id').all().map((r) => r.id);
}

/** Apply all pending migrations (idempotent). Returns the ids applied. */
export function migrateUp(db, dir = MIGRATIONS_DIR) {
  const done = new Set(appliedMigrations(db));
  const applied = [];
  for (const m of listMigrations(dir)) {
    if (done.has(m.id)) continue;
    if (!m.up) throw new Error(`Migration ${m.id} has no .up.sql file.`);
    transaction(db, () => {
      db.exec(m.up);
      db.prepare('INSERT INTO core_schema_migrations (id) VALUES (?)').run(m.id);
    });
    applied.push(m.id);
  }
  return applied;
}

/** Revert the most recent `steps` migrations. Returns the ids reverted. */
export function migrateDown(db, steps = 1, dir = MIGRATIONS_DIR) {
  const byId = new Map(listMigrations(dir).map((m) => [m.id, m]));
  const reverted = [];
  for (const id of appliedMigrations(db).reverse().slice(0, steps)) {
    const m = byId.get(id);
    if (!m?.down) throw new Error(`Migration ${id} has no .down.sql file and cannot be reverted.`);
    transaction(db, () => {
      db.exec(m.down);
      db.prepare('DELETE FROM core_schema_migrations WHERE id = ?').run(id);
    });
    reverted.push(id);
  }
  return reverted;
}
