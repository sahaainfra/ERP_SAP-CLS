import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../../src/server/platform/db/index.js';

const INTERNAL = new Set(['core_schema_migrations']);
const norm = (sql) => (sql ?? '').replace(/\s+/g, ' ').trim();

/**
 * Structural snapshot of a database: columns and foreign keys for tables,
 * normalised SQL for indexes, views and triggers.
 */
export function snapshot(db) {
  const out = {};
  const objects = db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  for (const o of objects) {
    if (INTERNAL.has(o.name) || INTERNAL.has(o.tbl_name)) continue;
    if (o.type === 'table') {
      const columns = db
        .prepare(`PRAGMA table_info("${o.name}")`)
        .all()
        .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, dflt: c.dflt_value, pk: c.pk }));
      const fks = db
        .prepare(`PRAGMA foreign_key_list("${o.name}")`)
        .all()
        .map((f) => `${f.from}->${f.table}.${f.to}:${f.on_update}/${f.on_delete}`)
        .sort();
      out[`table:${o.name}`] = { columns, fks };
    } else {
      out[`${o.type}:${o.name}`] = { sql: norm(o.sql) };
    }
  }
  return out;
}

/**
 * Compare a locked baseline with the current snapshot. Existing objects must be unchanged.
 * Allowed additions: new objects, and new columns that are nullable or have a default.
 */
export function diffSchema(baseline, current) {
  const problems = [];
  for (const [name, base] of Object.entries(baseline)) {
    const cur = current[name];
    if (!cur) {
      problems.push(`DROPPED ${name}`);
      continue;
    }
    if (name.startsWith('table:')) {
      const curCols = new Map(cur.columns.map((c) => [c.name, c]));
      for (const b of base.columns) {
        const c = curCols.get(b.name);
        if (!c) problems.push(`DROPPED column ${name}.${b.name}`);
        else if (JSON.stringify(c) !== JSON.stringify(b)) {
          problems.push(`ALTERED column ${name}.${b.name}: ${JSON.stringify(b)} -> ${JSON.stringify(c)}`);
        }
      }
      const baseNames = new Set(base.columns.map((c) => c.name));
      for (const c of cur.columns) {
        if (!baseNames.has(c.name) && c.notnull && c.dflt == null && !c.pk) {
          problems.push(`UNSAFE new column ${name}.${c.name}: NOT NULL without default`);
        }
      }
      if (JSON.stringify(base.fks) !== JSON.stringify(cur.fks)) problems.push(`ALTERED foreign keys of ${name}`);
    } else if (base.sql !== cur.sql) {
      problems.push(`ALTERED ${name}`);
    }
  }
  return problems;
}

/** Build a fresh in-memory database from a migrations directory and snapshot it. */
export function snapshotFromMigrations(dir) {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, dir);
  const snap = snapshot(db);
  db.close();
  return snap;
}
