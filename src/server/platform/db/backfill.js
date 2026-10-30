import { transaction } from './index.js';
import { writeAudit } from '../audit/index.js';

/**
 * Back-fill framework (FR-02). A back-fill fixes data in batches after a schema change:
 *   { name, description, run(db, { cursor, batchSize }) -> { nextCursor, processed, done } }
 * `run` does one batch of work and says where to continue. Each batch and its ledger update (core_backfill_runs)
 * happen in one transaction, so a crash leaves the ledger exactly in step with the data and the next call resumes
 * from the saved cursor instead of starting over. Every batch is also written to the audit log. A completed
 * back-fill is skipped, so running it twice is harmless.
 */
export function runBackfill(db, backfill, { actor = 'system', batchSize = 500, maxBatches = Infinity, now = () => new Date() } = {}) {
  if (!backfill?.name || typeof backfill.run !== 'function') throw new Error('A back-fill needs a name and a run() function');
  let row = db.prepare('SELECT * FROM core_backfill_runs WHERE name = ?').get(backfill.name);
  if (row?.status === 'completed') return { name: backfill.name, status: 'completed', skipped: true, processed: row.processed, batches: row.batches };
  if (!row) {
    db.prepare("INSERT INTO core_backfill_runs (name, status, started_at, created_by, source_type) VALUES (?, 'running', ?, ?, 'backfill')").run(backfill.name, now().toISOString(), actor);
    row = db.prepare('SELECT * FROM core_backfill_runs WHERE name = ?').get(backfill.name);
  } else {
    db.prepare("UPDATE core_backfill_runs SET status = 'running', last_error = NULL, updated_by = ?, updated_at = ? WHERE id = ?").run(actor, now().toISOString(), row.id);
  }

  let { cursor } = row;
  let processed = row.processed;
  let batches = row.batches;
  let thisRun = 0;
  try {
    while (thisRun < maxBatches) {
      const out = transaction(db, () => {
        const r = backfill.run(db, { cursor, batchSize });
        const at = now().toISOString();
        const done = r.done === true;
        db.prepare(
          `UPDATE core_backfill_runs SET cursor = ?, processed = processed + ?, batches = batches + 1, updated_by = ?, updated_at = ?,
             status = ?, finished_at = ?, version = version + 1 WHERE id = ?`,
        ).run(r.nextCursor ?? null, r.processed, actor, at, done ? 'completed' : 'running', done ? at : null, row.id);
        writeAudit(db, { entity: 'core_backfill_runs', entityId: row.id, action: done ? 'completed' : 'batch', newValues: { name: backfill.name, cursor: r.nextCursor ?? null, processed: r.processed }, actor });
        return r;
      });
      cursor = out.nextCursor ?? null;
      processed += out.processed;
      batches += 1;
      thisRun += 1;
      if (out.done) return { name: backfill.name, status: 'completed', skipped: false, processed, batches };
    }
    return { name: backfill.name, status: 'running', skipped: false, processed, batches, paused: true };
  } catch (err) {
    db.prepare("UPDATE core_backfill_runs SET status = 'failed', last_error = ?, updated_by = ?, updated_at = ? WHERE id = ?").run(String(err.message).slice(0, 500), actor, now().toISOString(), row.id);
    return { name: backfill.name, status: 'failed', skipped: false, processed, batches, error: err.message };
  }
}

/** The ledger: every back-fill that has been started, with its state. */
export function listBackfillRuns(db) {
  return db.prepare('SELECT name, status, cursor, processed, batches, started_at, finished_at, last_error FROM core_backfill_runs ORDER BY name').all();
}
