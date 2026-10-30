import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OUTBOX_MAX_BACKLOG = 1000;
export const OUTBOX_MAX_AGE_MS = 15 * 60 * 1000;

const timed = (fn) => {
  const t = process.hrtime.bigint();
  try {
    return { ...fn(), ms: Number((process.hrtime.bigint() - t) / 1_000_000n) };
  } catch (err) {
    return { status: 'fail', detail: `${err.code ?? err.name}: check failed`, ms: Number((process.hrtime.bigint() - t) / 1_000_000n) };
  }
};

/** Database: can we run a query and read the migration ledger? */
export function checkDatabase(db) {
  return timed(() => {
    db.prepare('SELECT 1').get();
    const n = db.prepare('SELECT COUNT(*) AS n FROM core_schema_migrations').get().n;
    return { status: 'ok', detail: `${n} migrations applied` };
  });
}

/**
 * Queue: the transactional outbox must be readable and not backed up. A large or old backlog means events
 * are not being delivered: "degraded" (still serving) rather than "fail".
 */
export function checkQueue(db, { now = Date.now(), maxBacklog = OUTBOX_MAX_BACKLOG, maxAgeMs = OUTBOX_MAX_AGE_MS } = {}) {
  return timed(() => {
    const r = db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM core_outbox WHERE published_at IS NULL').get();
    const ageMs = r.oldest ? now - Date.parse(r.oldest) : 0;
    const degraded = r.n > maxBacklog || ageMs > maxAgeMs;
    return { status: degraded ? 'degraded' : 'ok', detail: `${r.n} unpublished event(s), oldest ${Math.round(ageMs / 1000)} s` };
  });
}

/** Storage: the data directory must accept a write. */
export function checkStorage(storagePath) {
  return timed(() => {
    const file = join(storagePath, `.health-${process.pid}-${randomUUID()}`);
    writeFileSync(file, 'ok');
    unlinkSync(file);
    return { status: 'ok', detail: 'writable' };
  });
}

const RANK = { ok: 0, degraded: 1, fail: 2 };

/** Run all dependency checks; the overall status is the worst one. */
export function runReadiness({ db, storagePath, now = Date.now() }) {
  const checks = { database: checkDatabase(db), queue: checkQueue(db, { now }), storage: checkStorage(storagePath) };
  const status = Object.values(checks).reduce((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), 'ok');
  return { status, checks };
}
