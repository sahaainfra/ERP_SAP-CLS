import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join } from 'node:path';

const hex = (h) => h.digest('hex');
const sha256File = (file) => hex(createHash('sha256').update(readFileSync(file)));
const ms = (t) => Number((process.hrtime.bigint() - t) / 1_000_000n);

/** A consistent copy of a database file (VACUUM INTO): safe while the application is running. */
export function backupDatabase(dbPath, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { force: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

/** Put a backup file in place of the database (the application must be stopped). */
export function restoreDatabase(backup, dbPath) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  mkdirSync(dirname(dbPath), { recursive: true });
  copyFileSync(backup, dbPath);
}

/**
 * Row count and SHA-256 of the contents of every table, plus a hash of the schema. Two databases with the same
 * checksums hold identical data: this is how a restore is proved correct (T-04).
 */
export function databaseChecksums(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const tables = {};
  for (const name of names) {
    const h = createHash('sha256');
    let rows = 0;
    for (const row of db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).iterate()) {
      h.update(JSON.stringify(Object.values(row)));
      h.update('\n');
      rows++;
    }
    tables[name] = { rows, sha256: hex(h) };
  }
  const schema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  return { tables, schemaSha256: hex(createHash('sha256').update(JSON.stringify(schema))) };
}

function integrityOk(db) {
  return db.prepare('PRAGMA integrity_check').all().every((r) => r.integrity_check === 'ok');
}

function withDb(file, fn) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Take a verified backup: the database file plus a manifest with file hash, integrity result and per-table
 * checksums. Returns { file, manifest, manifestPath, timings }.
 */
export function createBackup(dbPath, dir, name) {
  const t0 = process.hrtime.bigint();
  const file = join(dir, `${name}.sqlite`);
  backupDatabase(dbPath, file);
  const copyMs = ms(t0);
  const t1 = process.hrtime.bigint();
  const { sums, integrity } = withDb(file, (db) => ({ sums: databaseChecksums(db), integrity: integrityOk(db) }));
  if (!integrity) throw new Error(`The backup ${file} failed SQLite's integrity check and was not kept.`);
  const manifest = {
    format: 1,
    name,
    createdAt: new Date().toISOString(),
    source: basename(dbPath),
    file: basename(file),
    bytes: statSync(file).size,
    fileSha256: sha256File(file),
    integrity: 'ok',
    schemaSha256: sums.schemaSha256,
    tables: sums.tables,
  };
  const manifestPath = join(dir, `${name}.manifest.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { file, manifest, manifestPath, timings: { copyMs, verifyMs: ms(t1), totalMs: ms(t0) } };
}

/** Compare a database with a manifest; returns a list of differences (empty means identical). */
export function compareWithManifest(db, manifest) {
  const problems = [];
  if (!integrityOk(db)) problems.push('SQLite integrity check failed');
  const sums = databaseChecksums(db);
  if (sums.schemaSha256 !== manifest.schemaSha256) problems.push('schema differs');
  for (const [name, expected] of Object.entries(manifest.tables)) {
    const got = sums.tables[name];
    if (!got) problems.push(`table ${name} is missing`);
    else if (got.rows !== expected.rows) problems.push(`table ${name}: ${got.rows} rows, expected ${expected.rows}`);
    else if (got.sha256 !== expected.sha256) problems.push(`table ${name}: contents differ`);
  }
  for (const name of Object.keys(sums.tables)) if (!manifest.tables[name]) problems.push(`unexpected table ${name}`);
  return problems;
}

/** Check a backup file against its manifest without restoring it. */
export function verifyBackup(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const file = join(dirname(manifestPath), manifest.file);
  if (!existsSync(file)) return { ok: false, problems: [`backup file ${manifest.file} is missing`], manifest };
  const problems = [];
  if (sha256File(file) !== manifest.fileSha256) problems.push('the backup file was changed after it was taken (checksum mismatch)');
  if (problems.length === 0) problems.push(...withDb(file, (db) => compareWithManifest(db, manifest)));
  return { ok: problems.length === 0, problems, manifest };
}

/**
 * Restore a backup over `targetDb` and prove the result: the file is verified first, copied into place, and
 * the restored database must match the manifest table by table. Returns { ok, problems, timings }.
 */
export function restoreBackup(manifestPath, targetDb) {
  const t0 = process.hrtime.bigint();
  const pre = verifyBackup(manifestPath);
  const verifyMs = ms(t0);
  if (!pre.ok) return { ok: false, problems: pre.problems, timings: { verifyMs, totalMs: ms(t0) } };
  const t1 = process.hrtime.bigint();
  restoreDatabase(join(dirname(manifestPath), pre.manifest.file), targetDb);
  const copyMs = ms(t1);
  const t2 = process.hrtime.bigint();
  const problems = withDb(targetDb, (db) => compareWithManifest(db, pre.manifest));
  return { ok: problems.length === 0, problems, manifest: pre.manifest, timings: { verifyMs, copyMs, checkMs: ms(t2), totalMs: ms(t0) } };
}
