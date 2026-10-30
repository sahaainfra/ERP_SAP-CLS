import { DatabaseSync } from 'node:sqlite';
import { listMigrations, transaction } from '../../src/server/platform/db/index.js';
import { snapshot } from './schema.mjs';

function rowCounts(db) {
  const out = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const { name } of tables) {
    if (name === 'core_schema_migrations') continue;
    out[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  }
  return out;
}

const state = (db) => JSON.stringify({ schema: snapshot(db), rows: rowCounts(db) });

/**
 * Verify every migration on a throw-away in-memory copy (FR-03, T-02): it has a down script,
 * the down script restores the exact previous schema and row counts, and re-applying works.
 * Returns a list of problems; empty means every migration is safely reversible.
 */
export function checkMigrations(dir) {
  const problems = [];
  const db = new DatabaseSync(':memory:');
  const exec = (sql) => transaction(db, () => db.exec(sql));
  db.exec('CREATE TABLE core_schema_migrations (id TEXT PRIMARY KEY)');
  for (const m of listMigrations(dir)) {
    if (!m.up) {
      problems.push(`${m.id}: missing .up.sql`);
      break;
    }
    if (!m.down) {
      problems.push(`${m.id}: missing .down.sql (a migration without a down-migration cannot be rolled back)`);
      exec(m.up); // keep going with later migrations on a consistent state
      continue;
    }
    const before = state(db);
    try {
      exec(m.up);
    } catch (err) {
      problems.push(`${m.id}: up failed: ${err.message}`);
      break;
    }
    const afterUp = state(db);
    try {
      exec(m.down);
    } catch (err) {
      problems.push(`${m.id}: down failed: ${err.message}`);
      break;
    }
    if (state(db) !== before) problems.push(`${m.id}: down does not restore the previous schema and data`);
    try {
      exec(m.up);
    } catch (err) {
      problems.push(`${m.id}: up cannot be re-applied after down: ${err.message}`);
      break;
    }
    if (state(db) !== afterUp) problems.push(`${m.id}: up gives a different result the second time`);
    try {
      exec(m.up);
    } catch (err) {
      problems.push(`${m.id}: up is not idempotent (second run failed): ${err.message}`);
      break;
    }
  }
  db.close();
  return problems;
}
