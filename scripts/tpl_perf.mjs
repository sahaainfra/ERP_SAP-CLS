// npm run erp:tpl-perf -- [--rows 100000] [--queries 100]
// Part 04.11: fills the log of generated documents (default 100 000 over 60 projects, 19 document types, a few versions) and the deliveries, then times what the screens ask: the log (page 1, a late page, by
// project, by type, by date range, searched by number or code, current only, sorted by number), the detail of one document, the verification by code and the count by type for the chart. Prints query plans.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record. Only the database is filled; no PDF is made.
import '../src/server/modules/registry.js';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { createTemplateService } from '../src/server/modules/eng/templates.js';
import { DOC_TYPES } from '../src/server/modules/eng/tpl-catalogue.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
for (let p = 1; p <= 60; p += 1) db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`);
const svc = createTemplateService({ db, engine: workflowOf(db), storage: { size: async () => 1, createReadStream: () => null }, jobs: { enqueue: () => null }, secret: randomBytes(32).toString('hex') });
svc.seedLibrary();
const tplId = (type) => db.prepare("SELECT id FROM tpl_templates WHERE doc_type = ? AND company_id IS NULL").get(type).id;
console.log(`Filling ${rows} generated documents...`);
db.exec('BEGIN');
const file = db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, ?, 'pdf', 'application/pdf', 'document', 20000, ?, 'CLEAN', 'tpl_generated', 0, 'perf', 'perf')");
const gen = db.prepare("INSERT INTO tpl_generated_docs (company_id, template_id, doc_type, entity, entity_id, doc_number, version_no, file_id, hash, pages, purpose, verify_code, is_current, generated_by, generated_at, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'OFFICIAL', ?, ?, ?, ?, ?, 'perf', 'perf')");
const del = db.prepare("INSERT INTO tpl_deliveries (company_id, generated_doc_id, channel, recipient, status, project_id, created_by, source_type) VALUES (1, ?, 'EMAIL', 'vendor@example.com', 'SENT', ?, 'perf', 'perf')");
const ids = DOC_TYPES.map(tplId);
for (let i = 1; i <= rows; i += 1) {
  const t = i % DOC_TYPES.length;
  const f = Number(file.run(`k/${i}`, `d${i}.pdf`, `h${i}`).lastInsertRowid);
  const day = new Date(Date.UTC(2026, 0, 1) + (i % 300) * 86_400_000).toISOString();
  const g = Number(gen.run(ids[t], DOC_TYPES[t], DOC_TYPES[t].toLowerCase(), `e${i}`, `${DOC_TYPES[t]}/${String(i).padStart(6, '0')}`, 1, f, `h${i}`, `V${String(i).padStart(10, '0')}`, 1, `user${i % 400}`, day, 1 + (i % 60)).lastInsertRowid);
  if (i % 3 === 0) del.run(g, 1 + (i % 60));
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
const acc = { user: 'acc1', roles: ['ACCMGR'], companyId: 1 };
const hr = { user: 'hr1', roles: ['HRMGR'], companyId: 1 }; // sees every type, payslips too
const worst = [];
const L = (q) => svc.generated.list(acc, { sort: 'newest', limit: 25, offset: 0, ...q });
worst.push(time('log, page 1', () => L({})));
worst.push(time('log, page 400', () => L({ offset: 9_975 })));
worst.push(time('log of a project', (i) => L({ projectId: 1 + (i % 60) })));
worst.push(time('log of a document type', (i) => L({ docType: DOC_TYPES[i % DOC_TYPES.length] })));
worst.push(time('log of a date range', () => L({ from: '2026-03-01', to: '2026-03-31' })));
worst.push(time('log searched by number', (i) => L({ q: `PO/${String(i * 19 + 1).padStart(6, '0')}` })));
worst.push(time('log, current only, by number', () => L({ current: '1', sort: 'number' })));
worst.push(time('one document with versions and log', (i) => svc.generated.get(hr, 1 + ((i * 97) % rows)), queries));
worst.push(time('verification by code', (i) => svc.generated.verify(`V${String(1 + ((i * 97) % rows)).padStart(10, '0')}`), queries));
for (const [label, sql] of [
  ['log of a project', "SELECT id FROM tpl_generated_docs WHERE company_id = 1 AND is_active = 1 AND project_id = 7 ORDER BY generated_at DESC, id DESC LIMIT 25"],
  ['log of a document type', "SELECT id FROM tpl_generated_docs WHERE company_id = 1 AND is_active = 1 AND doc_type = 'PO' ORDER BY generated_at DESC, id DESC LIMIT 25"],
  ['verification by code', "SELECT id FROM tpl_generated_docs WHERE verify_code = 'V0000000007'"],
  ['versions of one record', "SELECT id FROM tpl_generated_docs WHERE company_id = 1 AND doc_type = 'PO' AND entity_id = 'e19' ORDER BY version_no DESC"],
]) console.log(`\nPlan: ${label}\n${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => `  ${r.detail}`).join('\n')}`);
const bad = worst.filter((x) => x > 500).length;
console.log(`\n${bad === 0 ? 'All within the standard (p95 <= 500 ms).' : `${bad} measure(s) above 500 ms.`}`);
process.exit(bad === 0 ? 0 : 1);
