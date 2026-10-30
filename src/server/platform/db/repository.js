import { conflict, notFound, unprocessable } from '../http/errors.js';

// Base repository helpers (FR-05). Table and column names are interpolated into SQL, so they are checked
// against a strict identifier pattern first; values are always bound parameters.
const IDENT = /^[a-z][a-z0-9_]*$/;
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier "${name}"`);
  return name;
};

/** Standard columns filled on insert: company, creator and timestamps; version starts at 1. */
export function standardInsertColumns({ companyId = null, actor, now = new Date() }) {
  const at = now.toISOString();
  return { company_id: companyId, created_by: actor, created_at: at, updated_by: actor, updated_at: at, version: 1, is_active: 1 };
}

/** Insert a row of values plus the standard columns; returns the new row id. */
export function insertRow(db, table, values, ctx) {
  const row = { ...standardInsertColumns(ctx), ...values };
  const cols = Object.keys(row).map(ident);
  const res = db.prepare(`INSERT INTO ${ident(table)} (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`).run(row);
  return Number(res.lastInsertRowid);
}

/**
 * Optimistic update: the row changes only if its version still equals `expectedVersion`; version goes up by 1
 * and updated_by/updated_at are filled. Returns true on success, false when the row moved on (caller decides
 * how to explain it), so no change is ever silently overwritten.
 */
export function updateVersioned(db, table, id, expectedVersion, fields, { actor, now = new Date() }) {
  const cols = Object.keys(fields).map(ident);
  const set = [...cols.map((c) => `${c} = :${c}`), 'updated_by = :_actor', 'updated_at = :_at', 'version = version + 1'].join(', ');
  const res = db
    .prepare(`UPDATE ${ident(table)} SET ${set} WHERE id = :_id AND version = :_version AND is_active = 1 AND deleted_at IS NULL`)
    .run({ ...fields, _actor: actor, _at: now.toISOString(), _id: id, _version: expectedVersion });
  return Number(res.changes) === 1;
}

/** Throws the standard 409 when the version a caller holds is not the current one. */
export function assertVersion(currentVersion, heldVersion, what = 'The record', advice = 'Refresh and try again.') {
  if (heldVersion === undefined || heldVersion !== currentVersion) {
    throw conflict(
      `${what} was changed by someone else (you have version ${heldVersion ?? 'none'}, current is ${currentVersion}). ${advice}`,
      [{ field: 'version', message: `current version is ${currentVersion}` }],
    );
  }
}

/**
 * Soft delete (standards 4.7): only while the row is in `draftStatus`, never in place for approved records.
 * Sets is_active = 0 and records who and when; the version check stops a stale delete.
 */
export function softDelete(db, table, id, expectedVersion, { actor, draftStatus = 'DRAFT', now = new Date() }) {
  const t = ident(table);
  const row = db.prepare(`SELECT id, status, version, is_active, deleted_at FROM ${t} WHERE id = ?`).get(id);
  if (!row || row.deleted_at) throw notFound('That record does not exist.');
  if (row.status !== draftStatus) {
    throw unprocessable(`Only ${draftStatus} records can be deleted; this one is ${row.status}. Cancel or reverse it instead.`);
  }
  assertVersion(row.version, expectedVersion);
  const at = now.toISOString();
  const res = db
    .prepare(`UPDATE ${t} SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
    .run(at, actor, actor, at, id, expectedVersion);
  if (Number(res.changes) !== 1) assertVersion(row.version + 1, expectedVersion);
}
