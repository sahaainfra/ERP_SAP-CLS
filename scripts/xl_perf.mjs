// npm run erp:xl-perf -- [--rows 100000] [--queries 100]
// Part 04.13: fills 100 000 import jobs (400 people, 8 import types, every status) and 100 000 row errors, then times what the Import Center and the job page ask: the history (page 1, a late page, by type, by
// status, by person, searched by file name, a date range), one job and a page of its errors; prints query plans. Standard: p95 <= 500 ms for a list, <= 300 ms for one record.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { createExcelService } from '../src/server/modules/eng/excel.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const svc = createExcelService({ db, engine: workflowOf(db), storage: { putBuffer: async () => {}, createReadStream: () => null }, jobs: { enqueue: () => null } });
console.log(`Filling ${rows} import jobs and as many errors...`);
const types = ['ORG_DESIGNATION', 'ENG_SAMPLE_DOC', 'MASTER_VENDOR', 'MASTER_ITEM', 'HR_EMPLOYEE', 'BOQ_ITEM', 'OPENING_BALANCE', 'MASTER_UOM'];
const statuses = ['COMMITTED', 'COMMITTED', 'COMMITTED', 'PREVIEW', 'FAILED', 'CANCELLED', 'PARTIAL', 'COMMITTING'];
db.exec('BEGIN');
const f = db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, ?, 'xlsx', 'application/octet-stream', 'document', 20000, ?, 'CLEAN', 'xl_job', 0, 'perf', 'perf')");
const j = db.prepare("INSERT INTO xl_jobs (company_id, import_type, template_version, file_id, file_name, file_hash, status, total_rows, valid_rows, error_rows, started_by, started_at, created_by, source_type) VALUES (1, ?, 1, ?, ?, ?, ?, 100, 90, 10, ?, ?, 'perf', 'perf')");
const e = db.prepare("INSERT INTO xl_job_errors (company_id, job_id, sheet, row_no, column_key, column_label, value, message, code, created_by, source_type) VALUES (1, ?, 'Data', ?, 'code', 'Code', 'x', 'Code is required.', 'REQUIRED', 'perf', 'perf')");
for (let i = 1; i <= rows; i += 1) {
  const fid = Number(f.run(`k/${i}`, `file${i}.xlsx`, `h${i}`).lastInsertRowid);
  const jid = Number(j.run(types[i % 8], fid, `file${i}.xlsx`, `h${i}`, statuses[i % 8], `user${i % 400}`, new Date(Date.UTC(2026, 0, 1) + (i % 300) * 86_400_000).toISOString()).lastInsertRowid);
  e.run(jid, 2 + (i % 100));
}
db.exec('COMMIT');
db.exec('ANALYZE');
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn, n = queries) => {
  const ms = [];
  for (let i = 0; i < n; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p95(ms).toFixed(1).padStart(8)} ms`);
  return p95(ms);
};
const aud = { user: 'aud1', roles: ['AUD'], companyId: 1 };
const me = (i) => ({ user: `user${i % 400}`, roles: ['AUD'], companyId: 1 });
const L = (q, who = aud) => svc.job.list(who, { sort: 'newest', limit: 25, offset: 0, ...q });
const worst = [];
worst.push(time('history, page 1 (all jobs)', () => L({})));
worst.push(time('history, page 400', () => L({ offset: 9_975 })));
worst.push(time('history of one import type', (i) => L({ importType: types[i % 8] })));
worst.push(time('history by status', () => L({ status: 'PREVIEW' })));
worst.push(time('my history', (i) => L({}, me(i))));
worst.push(time('history searched by file', (i) => L({ q: `file${i * 7 + 1}.xlsx` })));
worst.push(time('history of a date range', () => L({ from: '2026-03-01', to: '2026-03-31' })));
worst.push(time('one job', (i) => svc.job.get(aud, 1 + ((i * 97) % rows)), queries));
worst.push(time('a page of the errors of a job', (i) => svc.job.errors(aud, 1 + ((i * 97) % rows), { limit: 100, offset: 0 }), queries));
for (const [label, sql] of [
  ['history of a type and status', "SELECT id FROM xl_jobs WHERE company_id = 1 AND is_active = 1 AND import_type = 'BOQ_ITEM' AND status = 'PREVIEW' ORDER BY started_at DESC, id DESC LIMIT 25"],
  ['my history', "SELECT id FROM xl_jobs WHERE company_id = 1 AND is_active = 1 AND started_by = 'user7' ORDER BY started_at DESC, id DESC LIMIT 25"],
  ['errors of a job', 'SELECT id FROM xl_job_errors WHERE job_id = 77 ORDER BY row_no, id LIMIT 100'],
]) console.log(`\nPlan: ${label}\n${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => `  ${r.detail}`).join('\n')}`);
const bad = worst.filter((x) => x > 500).length;
console.log(`\n${bad === 0 ? 'All within the standard (p95 <= 500 ms).' : `${bad} measure(s) above 500 ms.`}`);
process.exit(bad === 0 ? 0 : 1);
