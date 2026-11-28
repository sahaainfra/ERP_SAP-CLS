import { transaction } from '../db/index.js';
import { codeKey, hasIndic, normalise, phoneticText, transliterate } from '../../../shared/search/text.js';
import { searchEntities } from './registry.js';

export { commandRegistry, searchEntities } from './registry.js';

const matches = (pattern, type) => (pattern.endsWith('.*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type);
const BATCH = 500;
const MAX_BODY = 4000;
const MAX_PHON = 2000;

/**
 * The search index service (FR-01): writes the index row of a record from the document its module's `load` returns, keeps the index current
 * after domain events, finds what a missed event left behind, and rebuilds a type (BR-02). Everything is synchronous so a handler's writes
 * commit with its inbox row.
 */
export function createSearchIndex({ db, now = () => new Date() }) {
  const stamp = () => now().toISOString();

  /** The values stored for a document (also what is compared to skip a write that would change nothing). */
  function rowOf(def, id, doc) {
    const title = String(doc.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const subtitle = doc.subtitle ? String(doc.subtitle).replace(/\s+/g, ' ').trim().slice(0, 300) : null;
    const body = [...(doc.body ?? [])].filter(Boolean).map(String).join(' · ').slice(0, MAX_BODY);
    const readable = [title, subtitle ?? '', body, doc.code ?? ''].join(' ');
    const extra = hasIndic(readable) ? ` ${transliterate(readable).replace(/[\p{Script=Devanagari}\p{Script=Telugu}]/gu, '')}` : '';
    return {
      company_id: doc.companyId, entity: def.type, entity_id: id, project_id: doc.projectId ?? null, site_id: doc.siteId ?? null, branch_id: doc.branchId ?? null,
      department_id: doc.departmentId ?? null, owner_user_id: doc.ownerUserId ?? null, code: doc.code ? String(doc.code) : null, code_key: codeKey(doc.code) || null,
      title: title || `${def.label} ${id}`, title_lc: normalise(title), subtitle, body: (body + extra).slice(0, MAX_BODY + 500), phon: phoneticText(readable).slice(0, MAX_PHON),
      record_status: doc.status ?? null, doc_date: doc.docDate ?? null, permission_key: doc.permissionKey ?? (typeof def.permission === 'string' ? def.permission : ''), route: doc.route ?? def.route(id),
    };
  }
  const COLUMNS = ['project_id', 'site_id', 'branch_id', 'department_id', 'owner_user_id', 'code', 'code_key', 'title', 'title_lc', 'subtitle', 'body', 'phon', 'record_status', 'doc_date', 'permission_key', 'route'];

  function removeRow(id) {
    db.prepare('DELETE FROM core_search_secret WHERE index_id = ?').run(id);
    db.prepare('DELETE FROM core_search_index WHERE id = ?').run(id);
  }

  /** Write one record's row and its sensitive values. Returns 'added', 'changed' or 'same'. */
  function write(def, id, doc) {
    const r = rowOf(def, id, doc);
    const at = stamp();
    const existing = db.prepare('SELECT * FROM core_search_index WHERE company_id = ? AND entity = ? AND entity_id = ?').get(r.company_id, r.entity, id);
    let rowId;
    let result;
    if (!existing) {
      const res = db.prepare(`INSERT INTO core_search_index (company_id, entity, entity_id, ${COLUMNS.join(', ')}, indexed_at, created_by, source_type) VALUES (?, ?, ?, ${COLUMNS.map(() => '?').join(', ')}, ?, 'system', 'search_index')`)
        .run(r.company_id, r.entity, id, ...COLUMNS.map((c) => r[c]), at);
      rowId = Number(res.lastInsertRowid);
      result = 'added';
    } else {
      rowId = existing.id;
      if (COLUMNS.every((c) => (existing[c] ?? null) === (r[c] ?? null))) {
        db.prepare('UPDATE core_search_index SET indexed_at = ? WHERE id = ?').run(at, rowId);
        result = 'same';
      } else {
        db.prepare(`UPDATE core_search_index SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, indexed_at = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?`).run(...COLUMNS.map((c) => r[c]), at, at, rowId);
        result = 'changed';
      }
    }
    const secrets = (doc.secrets ?? []).filter((s) => s.value !== null && s.value !== undefined && String(s.value) !== '');
    const key = (s) => `${s.entity}.${s.field}`;
    const stored = db.prepare('SELECT value, field_key FROM core_search_secret WHERE index_id = ?').all(rowId).map((x) => `${x.field_key}=${x.value}`).sort().join('|');
    const wanted = secrets.map((s) => `${key(s)}=${String(s.value)}`).sort().join('|');
    if (stored !== wanted) {
      db.prepare('DELETE FROM core_search_secret WHERE index_id = ?').run(rowId);
      for (const s of secrets) db.prepare('INSERT INTO core_search_secret (value, index_id, field_key) VALUES (?, ?, ?)').run(String(s.value), rowId, key(s));
      if (result === 'same') result = 'changed';
    }
    return result;
  }

  /** Index one record again from its module, or take it out when it is gone or no longer active. */
  function upsert(type, id) {
    const def = searchEntities.get(type);
    if (!def) return 'unknown';
    const doc = def.load(db, id);
    if (!doc) {
      remove(type, id);
      return 'removed';
    }
    return write(def, id, doc);
  }

  function remove(type, id) {
    for (const r of db.prepare('SELECT id FROM core_search_index WHERE entity = ? AND entity_id = ?').all(type, id)) removeRow(r.id);
  }

  /** After a domain event: index again the records it names (FR-01). */
  function onEvent(event) {
    let done = 0;
    for (const def of searchEntities.list()) {
      if (!def.events.some((p) => matches(p, event.type))) continue;
      const id = def.idFromEvent ? def.idFromEvent(db, event) : event.entity === def.eventEntity ? Number(event.entityId) : null;
      if (!Number.isInteger(id) || id <= 0) continue;
      upsert(def.type, id);
      done += 1;
    }
    return done;
  }

  /** Records whose source changed after they were indexed, or that were never indexed (an event that never came, or an import). */
  function stale(type, limit = 5000) {
    const def = searchEntities.get(type);
    return db.prepare(`SELECT s.id FROM ${def.table} s LEFT JOIN core_search_index i ON i.entity = ? AND i.entity_id = s.id
      WHERE i.id IS NULL OR COALESCE(s.updated_at, s.created_at) > i.indexed_at ORDER BY s.id LIMIT ?`).all(type, limit).map((r) => r.id);
  }

  /** Index rows whose record no longer exists. */
  function orphans(type) {
    const def = searchEntities.get(type);
    return db.prepare(`SELECT i.id FROM core_search_index i WHERE i.entity = ? AND NOT EXISTS (SELECT 1 FROM ${def.table} s WHERE s.id = i.entity_id)`).all(type).map((r) => r.id);
  }

  /** The cheap repair run on a schedule (and at start): index what changed without an event, drop what is gone. */
  function reconcile() {
    const out = { checked: 0, indexed: 0, removed: 0 };
    for (const def of searchEntities.list()) {
      const ids = stale(def.type);
      out.checked += ids.length;
      transaction(db, () => { for (const id of ids) { const r = upsert(def.type, id); if (r === 'added' || r === 'changed') out.indexed += 1; if (r === 'removed') out.removed += 1; } });
      const gone = orphans(def.type);
      transaction(db, () => { for (const id of gone) removeRow(id); });
      out.removed += gone.length;
    }
    return out;
  }

  /** Rebuild the index of one type from its source (BR-02): every record is read again; rows of records that are gone are dropped. */
  /** @param {string} type @param {{ onProgress?: (percent: number, message: string) => void, isCancelled?: () => boolean }} [options] */
  function reindex(type, { onProgress = () => {}, isCancelled = () => false } = {}) {
    const def = searchEntities.get(type);
    if (!def) throw new Error(`There is no searchable type ${type}`);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${def.table}`).get().n || 1;
    let last = 0;
    let seen = 0;
    const out = { type, indexed: 0, unchanged: 0, removed: 0 };
    for (;;) {
      const ids = db.prepare(`SELECT id FROM ${def.table} WHERE id > ? ORDER BY id LIMIT ?`).all(last, BATCH).map((r) => r.id);
      if (ids.length === 0) break;
      transaction(db, () => {
        for (const id of ids) {
          const r = upsert(type, id);
          if (r === 'added' || r === 'changed') out.indexed += 1; else if (r === 'same') out.unchanged += 1; else if (r === 'removed') out.removed += 1;
        }
      });
      last = ids.at(-1);
      seen += ids.length;
      onProgress(Math.min(99, Math.round((seen / total) * 100)), `${def.label}: ${seen} of ${total}`);
      if (isCancelled()) return { ...out, cancelled: true };
    }
    const gone = orphans(type);
    transaction(db, () => { for (const id of gone) removeRow(id); });
    out.removed += gone.length;
    return out;
  }

  /** How the index stands, per type (for the administrator). */
  function status(companyId) {
    return searchEntities.list().map((def) => {
      const indexed = db.prepare('SELECT COUNT(*) AS n, MAX(indexed_at) AS last FROM core_search_index WHERE company_id = ? AND entity = ?').get(companyId, def.type);
      const source = db.prepare(`SELECT COUNT(*) AS n FROM ${def.table} WHERE company_id = ?`).get(companyId).n;
      return { type: def.type, label: def.label, labelHi: def.labelHi ?? null, source, indexed: indexed.n, behind: stale(def.type, 1000).length, lastIndexedAt: indexed.last };
    });
  }

  /** Remove searches older than the retention period (DPDP: queries can hold personal data). */
  function purgeQueries(days) {
    const cutoff = new Date(now().getTime() - days * 86_400_000).toISOString();
    return db.prepare('DELETE FROM core_search_queries WHERE created_at < ?').run(cutoff).changes;
  }

  /** Empty the whole index (the replay hook of the event consumer): it is rebuilt from the source afterwards. */
  function clear() {
    db.exec('DELETE FROM core_search_secret');
    db.exec('DELETE FROM core_search_index');
  }

  return { upsert, remove, onEvent, stale, reconcile, reindex, status, purgeQueries, clear };
}
