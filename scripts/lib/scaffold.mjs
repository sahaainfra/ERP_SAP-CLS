import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z][a-z0-9_]*$/;

/** The next migration id: the current UTC time as YYYYMMDDHHmmss, but always after every existing id. */
export function nextMigrationId(dir, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const ids = existsSync(dir) ? readdirSync(dir).map((f) => /^(\d{14})_/.exec(f)?.[1]).filter(Boolean).sort() : [];
  const last = ids.at(-1);
  return last && last >= stamp ? String(BigInt(last) + 1n) : stamp;
}

/**
 * SQL for a new business table that follows the standard (standards section 4): the standard columns, a
 * (company_id, doc_no) business key when numbered, indexes on every foreign key and on company and status, and
 * non-negative checks on the money columns you pass. Money, rates, quantities and percentages are INTEGER minor
 * units (ADR-14): money in paise, rates x10000, quantities x1000, percentages x10000.
 */
export function tableTemplate(table, { numbered = false, money = [], fks = [] } = {}) {
  if (!NAME.test(table) || !/^[a-z]+_/.test(table)) throw new Error(`"${table}" must be snake_case with a module prefix, for example proc_purchase_orders`);
  for (const c of [...money, ...fks.map((f) => f.column)]) if (!NAME.test(c)) throw new Error(`Bad column name "${c}"`);
  const cols = [
    '  id            INTEGER PRIMARY KEY AUTOINCREMENT',
    '  company_id    INTEGER NOT NULL',
    '  project_id    INTEGER',
    '  site_id       INTEGER',
    ...(numbered ? ['  doc_no        TEXT    NOT NULL', '  doc_date      TEXT    NOT NULL'] : []),
    "  status        TEXT    NOT NULL DEFAULT 'DRAFT'",
    '  workflow_instance_id INTEGER',
    ...money.map((m) => `  ${m.padEnd(13)} INTEGER NOT NULL DEFAULT 0 CHECK (${m} >= 0)`),
    ...fks.map((f) => `  ${f.column.padEnd(13)} INTEGER REFERENCES ${f.references}(id)`),
    '  created_by    TEXT',
    "  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    '  updated_by    TEXT',
    '  updated_at    TEXT',
    '  version       INTEGER NOT NULL DEFAULT 1',
    '  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))',
    '  deleted_at    TEXT',
    '  deleted_by    TEXT',
    '  source_type   TEXT',
    '  source_id     TEXT',
    '  remarks       TEXT',
  ];
  const up = [
    `CREATE TABLE IF NOT EXISTS ${table} (`,
    `${cols.join(',\n')}`,
    ');',
    `CREATE INDEX IF NOT EXISTS ix_${table}_company_status ON ${table} (company_id, status);`,
    ...(numbered ? [`CREATE UNIQUE INDEX IF NOT EXISTS ux_${table}_doc_no ON ${table} (company_id, doc_no);`] : []),
    ...fks.map((f) => `CREATE INDEX IF NOT EXISTS ix_${table}_${f.column} ON ${table} (${f.column});`),
    `CREATE INDEX IF NOT EXISTS ix_${table}_project ON ${table} (project_id);`,
    '',
  ].join('\n');
  const down = [
    ...fks.map((f) => `DROP INDEX IF EXISTS ix_${table}_${f.column};`),
    `DROP INDEX IF EXISTS ix_${table}_project;`,
    ...(numbered ? [`DROP INDEX IF EXISTS ux_${table}_doc_no;`] : []),
    `DROP INDEX IF EXISTS ix_${table}_company_status;`,
    `DROP TABLE IF EXISTS ${table};`,
    '',
  ].join('\n');
  return { up, down };
}

/** Write a new migration pair (and a table template when `table` is given). Returns the file paths. */
export function scaffoldMigration(dir, name, { table = null, numbered = false, money = [], fks = [], now = new Date() } = {}) {
  if (!NAME.test(name)) throw new Error(`The migration name "${name}" must be lower-case letters, digits and underscores`);
  mkdirSync(dir, { recursive: true });
  const id = `${nextMigrationId(dir, now)}_${name}`;
  const t = table ? tableTemplate(table, { numbered, money, fks }) : null;
  const up = t ? t.up : `-- ${name}: additive and idempotent (IF NOT EXISTS, INSERT OR IGNORE). Never alter or drop existing objects.\n`;
  const down = t ? t.down : `-- Undo exactly what ${id}.up.sql added, nothing else.\n`;
  const upPath = join(dir, `${id}.up.sql`);
  const downPath = join(dir, `${id}.down.sql`);
  writeFileSync(upPath, up);
  writeFileSync(downPath, down);
  return { id, upPath, downPath };
}
