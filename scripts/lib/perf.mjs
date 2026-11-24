// The performance baseline (FR-08): the critical journeys that exist today, driven over HTTP against the real application on a
// database with realistic volumes, with latency percentiles and throughput recorded so a later run (part 30.06) can be compared.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/platform/config/index.js';
import { migrateUp, openDatabase } from '../../src/server/platform/db/index.js';
import { silentLogger } from '../../src/server/platform/http/logger.js';
import { securityOf } from '../../src/server/platform/security/index.js';

/** The targets of standards section 11, in milliseconds at p95. */
export const STANDARDS = Object.freeze({ list: 500, record: 300, save: 800 });

export const percentileOf = (sorted, q) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]);
const round = (n) => Math.round(n * 100) / 100;

export function summarize(latencies) {
  const s = [...latencies].sort((a, b) => a - b);
  return { count: s.length, meanMs: s.length ? round(s.reduce((a, b) => a + b, 0) / s.length) : null, p50Ms: round(percentileOf(s, 0.5) ?? 0), p95Ms: round(percentileOf(s, 0.95) ?? 0), p99Ms: round(percentileOf(s, 0.99) ?? 0), maxMs: round(s.at(-1) ?? 0) };
}

/** Which journeys got slower than the baseline by more than `tolerance` (and by more than 20 ms, so noise on fast journeys is ignored). */
export function compareBaselines(base, current, { tolerance = 0.25, minDeltaMs = 20 } = {}) {
  return current.journeys.map((j) => {
    const b = base.journeys.find((x) => x.id === j.id);
    if (!b) return { id: j.id, status: 'new', currentP95Ms: j.p95Ms };
    const change = b.p95Ms > 0 ? (j.p95Ms - b.p95Ms) / b.p95Ms : 0;
    const regression = change > tolerance && j.p95Ms - b.p95Ms > minDeltaMs;
    return { id: j.id, status: regression ? 'regression' : change < -tolerance ? 'faster' : 'same', baselineP95Ms: b.p95Ms, currentP95Ms: j.p95Ms, changePct: Math.round(change * 1000) / 10, newErrors: j.errors > b.errors };
  });
}

const pdf = (n) => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${n}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);

/** Bulk data through SQL in one transaction: the lists the journeys read have to be big enough for the numbers to mean something. */
function seed(db, { documents, bills, events }) {
  db.exec('BEGIN');
  const series = (n) => `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${n})`;
  db.exec(`${series(documents)} INSERT INTO core_sample_documents (company_id, doc_date, title, status, created_by, source_type) SELECT 1, '2026-10-15', 'Baseline document ' || i, 'DRAFT', 'seed', 'perf_baseline' FROM s`);
  db.exec(`${series(bills)} INSERT INTO core_sample_bills (company_id, title, quantity, unit_rate, gst_percent, supply, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, formula_pins_json, created_by, source_type)
           SELECT 1, 'Baseline bill ' || i, 12500, 1012345, 180000, 'intra', 126543, 11389, 11389, 0, 149321, '{}', 'seed', 'perf_baseline' FROM s`);
  db.exec(`${series(events)} INSERT INTO core_outbox (event_type, aggregate_id, payload, published_at) SELECT 'core.parameter.changed', CAST(i AS TEXT), json_object('eventId', 'seed-' || i, 'companyId', CASE WHEN i % 7 = 0 THEN NULL ELSE 1 END, 'occurredAt', '2026-10-01T00:00:00.000Z', 'data', json_object()), '2026-10-01T00:00:00.000Z' FROM s`);
  db.exec('COMMIT');
}

/**
 * Run every journey for `durationMs` with `concurrency` clients and return the report. `size` sets the volumes. The application
 * runs in this process on a temporary database file, which is deleted afterwards.
 */
/** @param {{ durationMs?: number, concurrency?: number, size?: { documents: number, bills: number, events: number }, log?: (line: string) => void }} [options] */
export async function runBaseline({ durationMs = 4000, concurrency = 8, size = { documents: 20_000, bills: 20_000, events: 100_000 }, log = () => {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-perf-'));
  const file = join(dir, 'perf.sqlite');
  mkdirSync(join(dir, 'storage'), { recursive: true });
  const db = openDatabase(file);
  migrateUp(db);
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: file, AUTH_MODE: 'dev-headers' });
  const app = createApp({ config, db, logger: silentLogger, storagePath: join(dir, 'storage') });
  // Audit AUD-DEF-018: the journeys run as one user, far above the per-account rate limit (1,800 reads a minute); without this every
  // journey after the first measured the 429 refusal, not the work. The limiter is tested on its own (tests/security-*.test.js).
  securityOf(db).limiter.suspend(true);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const who = { 'x-erp-user': 'perf', 'x-erp-roles': 'SYSADM,PM', 'x-erp-company': '1' };
  const json = { 'content-type': 'application/json', ...who };

  try {
    seed(db, size);
    // A document to attach files to.
    const doc = db.prepare('SELECT id FROM core_sample_documents ORDER BY id LIMIT 1').get();
    let n = 0;
    const journeys = [
      { id: 'session', label: 'Session check (every page load)', kind: 'record', call: () => fetch(`${base}/api/v1/core/session`, { headers: who }) },
      { id: 'flags_list', label: 'Feature flags list', kind: 'list', call: () => fetch(`${base}/api/v1/core/feature-flags?page=1&pageSize=25`, { headers: who }) },
      { id: 'sample_documents_list', label: `Sample documents list (${size.documents} rows)`, kind: 'list', call: () => fetch(`${base}/api/v1/core/sample-documents?page=1&pageSize=25`, { headers: who }) },
      { id: 'sample_bills_list', label: `Sample bills list (${size.bills} rows)`, kind: 'list', call: () => fetch(`${base}/api/v1/core/sample-bills?page=1&pageSize=10`, { headers: who }) },
      { id: 'events_list', label: `Event log (${size.events} rows)`, kind: 'list', call: () => fetch(`${base}/api/v1/core/events?page=1&pageSize=25`, { headers: who }) },
      { id: 'formula_detail', label: 'Formula with its versions', kind: 'record', call: () => fetch(`${base}/api/v1/core/formulas/tax.gst_split`, { headers: who }) },
      { id: 'calc_bench', label: 'Calculation test bench', kind: 'record', call: () => fetch(`${base}/api/v1/core/formulas/tax.gst_split/test`, { method: 'POST', headers: json, body: JSON.stringify({ inputs: { taxable: '1265.43', gst_percent: '18', supply: 'intra' } }) }) },
      { id: 'bill_create', label: 'Create a bill (engine, trace, audit, event)', kind: 'save', call: () => fetch(`${base}/api/v1/core/sample-bills`, { method: 'POST', headers: { ...json, 'idempotency-key': `perf-bill-${(n += 1)}` }, body: JSON.stringify({ title: 'Perf bill', quantity: '12.5', unitRate: '101.2345', gstPercent: '18', supply: 'intra' }) }) },
      {
        id: 'file_upload',
        label: 'Attach a small PDF',
        kind: 'save',
        call: () => {
          const fd = new FormData();
          fd.append('entity', 'sample_document');
          fd.append('entityId', String(doc.id));
          fd.append('file', new Blob([pdf(`${Date.now()}-${(n += 1)}`)]), 'perf.pdf');
          return fetch(`${base}/api/v1/core/files`, { method: 'POST', headers: who, body: fd });
        },
      },
    ];
    await Promise.all(Array.from({ length: 4 }, () => journeys[0].call().then((r) => r.arrayBuffer()))); // warm up

    const results = [];
    for (const j of journeys) {
      const latencies = [];
      let errors = 0;
      const end = Date.now() + durationMs;
      const started = Date.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (Date.now() < end) {
            const t = process.hrtime.bigint();
            try {
              const res = await j.call();
              await res.arrayBuffer();
              if (res.status >= 400) errors += 1;
            } catch {
              errors += 1;
            }
            latencies.push(Number(process.hrtime.bigint() - t) / 1e6);
          }
        }),
      );
      const seconds = (Date.now() - started) / 1000;
      const s = summarize(latencies);
      const standardMs = STANDARDS[j.kind];
      const row = { id: j.id, label: j.label, kind: j.kind, requests: s.count, errors, requestsPerSecond: round(s.count / seconds), ...s, standardMs, meetsStandard: errors === 0 && s.p95Ms <= standardMs };
      delete row.count;
      results.push(row);
      log(`${j.id.padEnd(24)} ${String(row.requests).padStart(6)} req  ${String(row.requestsPerSecond).padStart(7)} /s  p50 ${row.p50Ms} ms  p95 ${row.p95Ms} ms  p99 ${row.p99Ms} ms  errors ${errors}  ${row.meetsStandard ? 'meets' : 'MISSES'} ${standardMs} ms`);
    }
    return {
      generatedAt: new Date().toISOString(),
      note: 'Baseline for comparison by the performance tests of part 30.06. Numbers depend on the machine: compare runs from the same kind of machine.',
      environment: { node: process.version, platform: `${platform()} ${release()}`, cpus: cpus().length, cpuModel: cpus()[0]?.model ?? 'unknown', memoryGb: Math.round(totalmem() / 1073741824), database: 'SQLite file on local disk, one connection' },
      config: { durationMsPerJourney: durationMs, concurrency, standards: STANDARDS },
      dataset: size,
      journeys: results,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
