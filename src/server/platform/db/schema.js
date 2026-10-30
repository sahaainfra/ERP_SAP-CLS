// A description of the live schema, used by the integrity checks and the schema lint (standards section 4).
// SQLite is the engine today; this is the one place that reads its catalogue.

export const IDENT = /^[a-z][a-z0-9_]*$/;

/** Throws unless `name` is a plain lower-case SQL identifier; the only names ever put into SQL text. */
export function ident(name) {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new Error(`Unsafe SQL identifier "${name}"`);
  return name;
}

/**
 * Tables with their columns, foreign keys and indexes. `core_schema_migrations` (the migration ledger) and
 * SQLite internals are left out.
 */
export function describeSchema(db) {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'core_schema_migrations' ORDER BY name")
    .all()
    .map((r) => r.name);
  return names.map((name) => {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => ({ name: c.name, type: c.type, notnull: c.notnull === 1, pk: c.pk > 0, dflt: c.dflt_value }));
    const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all().map((f) => ({ from: f.from, table: f.table, to: f.to }));
    const indexes = db
      .prepare(`PRAGMA index_list("${name}")`)
      .all()
      .map((i) => ({
        name: i.name,
        unique: i.unique === 1,
        columns: db.prepare(`PRAGMA index_info("${i.name}")`).all().sort((a, b) => a.seqno - b.seqno).map((c) => c.name),
      }));
    return { name, columns, fks, indexes, has: (col) => columns.some((c) => c.name === col) };
  });
}

/** WHERE conditions that leave out soft-deleted rows, using only the columns the table really has. */
export function activeConditions(table, alias = '') {
  const p = alias ? `${alias}.` : '';
  const out = [];
  if (table.has('is_active')) out.push(`${p}is_active = 1`);
  if (table.has('deleted_at')) out.push(`${p}deleted_at IS NULL`);
  return out;
}
