import { createHash } from 'node:crypto';
import { diffValues } from './diff.js';

// The hash chain of the audit trail (part 02.06, FR-03). Each audit row has a companion row in core_audit_chain with a sequence
// number and a hash over the row's content and the previous row's hash, so changing, removing or inserting a row anywhere breaks
// every hash after it. The triggers of migration 32 refuse such edits; the chain shows them if someone with direct access makes
// them anyway (for example by dropping a trigger first).
export const GENESIS = '0'.repeat(64);
const TRIGGERS = ['trg_core_audit_log_no_update', 'trg_core_audit_log_no_delete', 'trg_core_audit_chain_no_update', 'trg_core_audit_chain_no_delete'];

const ready = new WeakSet();
export function hasChain(db) {
  if (ready.has(db)) return true;
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_audit_chain'").get();
  if (t) ready.add(db);
  return Boolean(t);
}

export function hashOf(prev, row, link) {
  return createHash('sha256').update(JSON.stringify([
    prev, row.id, row.entity, row.entity_id, row.action, row.old_values, row.new_values, row.reason, row.actor, row.correlation_id, row.created_at,
    link.seq, link.company_id, link.occurred_at, link.actor_id, link.on_behalf_of, link.ip, link.device, link.changes_json,
  ])).digest('hex');
}

/** Chain one audit row (just written, in the caller's transaction). */
export function appendChain(db, auditId, extra) {
  const row = db.prepare('SELECT * FROM core_audit_log WHERE id = ?').get(auditId);
  const last = db.prepare('SELECT seq, hash FROM core_audit_chain ORDER BY seq DESC LIMIT 1').get();
  const link = {
    seq: (last?.seq ?? 0) + 1,
    // a company with no organisation record yet (a development header, a job) is stored as none rather than refused
    company_id: extra.companyId != null && db.prepare('SELECT 1 FROM org_companies WHERE id = ?').get(extra.companyId) ? extra.companyId : null,
    occurred_at: extra.occurredAt ?? row.created_at,
    actor_id: extra.actorId ?? null,
    on_behalf_of: extra.onBehalfOf ?? null,
    ip: extra.ip ?? null,
    device: extra.device ?? null,
    changes_json: extra.changesJson ?? '{}',
  };
  const prev = last?.hash ?? GENESIS;
  const hash = hashOf(prev, row, link);
  db.prepare('INSERT INTO core_audit_chain (audit_id, seq, company_id, occurred_at, actor_id, on_behalf_of, ip, device, changes_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(auditId, link.seq, link.company_id, link.occurred_at, link.actor_id, link.on_behalf_of, link.ip, link.device, link.changes_json, prev, hash);
  return { seq: link.seq, hash };
}

/**
 * Chain the rows written before this part existed (FR-08: the old log is kept, and is read through the new viewer). They are
 * chained in their original order, with the company and person looked up from the actor's name where it is a known user.
 */
export function backfillChain(db) {
  if (!hasChain(db)) return { chained: 0 };
  const rows = db.prepare('SELECT a.id, a.actor FROM core_audit_log a WHERE NOT EXISTS (SELECT 1 FROM core_audit_chain c WHERE c.audit_id = a.id) ORDER BY a.id').all();
  const who = db.prepare('SELECT id, company_id FROM iam_users WHERE username = ?');
  const hasUsers = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'iam_users'").get());
  for (const r of rows) {
    const u = hasUsers ? who.get(r.actor) : null;
    const old = db.prepare('SELECT old_values, new_values FROM core_audit_log WHERE id = ?').get(r.id);
    appendChain(db, r.id, { companyId: u?.company_id ?? null, actorId: u?.id ?? null, changesJson: legacyChanges(old) });
  }
  return { chained: rows.length };
}
function legacyChanges({ old_values: o, new_values: n }) {
  try {
    return JSON.stringify(diffValues(o ? JSON.parse(o) : null, n ? JSON.parse(n) : null));
  } catch {
    return '{}';
  }
}
/** Walk the whole chain. Returns { ok, checked, brokenSeq, problem, headHash }. */
export function verifyChain(db) {
  let prev = GENESIS;
  let expected = 1;
  let checked = 0;
  const fail = (seq, problem) => ({ ok: false, checked, brokenSeq: seq, problem, headHash: prev });
  const missing = TRIGGERS.filter((t) => !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(t));
  const audit = db.prepare('SELECT * FROM core_audit_log WHERE id = ?');
  for (const link of db.prepare('SELECT * FROM core_audit_chain ORDER BY seq').iterate()) {
    if (link.seq !== expected) return fail(expected, `Entry ${expected} is missing from the chain (found ${link.seq} next): a row was removed.`);
    const row = audit.get(link.audit_id);
    if (!row) return fail(link.seq, `Entry ${link.seq} points to an audit row that no longer exists.`);
    if (link.prev_hash !== prev) return fail(link.seq, `Entry ${link.seq} does not follow the entry before it.`);
    if (hashOf(prev, row, link) !== link.hash) return fail(link.seq, `Entry ${link.seq} was changed after it was written.`);
    prev = link.hash;
    expected += 1;
    checked += 1;
  }
  const loose = db.prepare('SELECT a.id FROM core_audit_log a WHERE NOT EXISTS (SELECT 1 FROM core_audit_chain c WHERE c.audit_id = a.id) ORDER BY a.id LIMIT 1').get();
  if (loose) return fail(expected, `Audit row ${loose.id} is not part of the chain: a row was inserted outside the audit service.`);
  if (missing.length) return { ok: false, checked, brokenSeq: null, problem: `Protection was removed from the audit tables (${missing.join(', ')}).`, headHash: prev };
  return { ok: true, checked, brokenSeq: null, problem: null, headHash: prev };
}

/** Seal each finished month: a record of its range, size and closing hash. Sealed segments are never removed (FR-07). */
export function sealSegments(db, nowMs) {
  const thisMonth = new Date(nowMs).toISOString().slice(0, 7);
  const sealed = [];
  for (const g of db.prepare('SELECT substr(occurred_at, 1, 7) AS period, MIN(seq) AS first_seq, MAX(seq) AS last_seq, COUNT(*) AS n FROM core_audit_chain GROUP BY substr(occurred_at, 1, 7) HAVING substr(occurred_at, 1, 7) < ? ORDER BY period').all(thisMonth)) {
    if (db.prepare('SELECT 1 FROM core_audit_segments WHERE period = ?').get(g.period)) continue;
    const head = db.prepare('SELECT hash FROM core_audit_chain WHERE seq = ?').get(g.last_seq).hash;
    db.prepare('INSERT INTO core_audit_segments (period, first_seq, last_seq, entry_count, head_hash, sealed_at) VALUES (?, ?, ?, ?, ?, ?)').run(g.period, g.first_seq, g.last_seq, g.n, head, new Date(nowMs).toISOString());
    sealed.push(g.period);
  }
  return sealed;
}
