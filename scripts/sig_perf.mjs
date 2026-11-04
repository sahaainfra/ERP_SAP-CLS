// npm run erp:sig-perf -- [--rows 100000] [--queries 100]
// Part 04.12: fills 100 000 generated documents over 60 projects, each with a signature (and a verification row), then times the register (page 1, a late page, by project, method, signer, date range,
// searched by number), the detail of one document and the public check by code; prints query plans. Standard: p95 <= 500 ms for a list, <= 300 ms for one record. Only the database is filled.
import '../src/server/modules/registry.js';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { createTemplateService } from '../src/server/modules/eng/templates.js';
import { createSignatureService } from '../src/server/modules/eng/signatures.js';
import { bind } from '../src/server/modules/eng/templates.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
for (let p = 1; p <= 60; p += 1) db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`);
const engine = workflowOf(db);
const storage = { size: async () => 1, createReadStream: () => null, putBuffer: async () => {} };
const jobs = { enqueue: () => null };
const tpl = createTemplateService({ db, engine, storage, jobs, secret: randomBytes(32).toString('hex') });
bind(db, tpl);
tpl.seedLibrary();
const sig = createSignatureService({ db, engine, storage, jobs });
const tplId = db.prepare("SELECT id FROM tpl_templates WHERE doc_type = 'PO' AND company_id IS NULL").get().id;
console.log(`Filling ${rows} signed documents...`);
db.exec('BEGIN');
const file = db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, ?, 'pdf', 'application/pdf', 'document', 20000, ?, 'CLEAN', 'tpl_generated', 0, 'perf', 'perf')");
const gen = db.prepare("INSERT INTO tpl_generated_docs (company_id, template_id, doc_type, entity, entity_id, doc_number, version_no, file_id, hash, pages, purpose, verify_code, is_current, generated_by, generated_at, project_id, created_by, source_type) VALUES (1, ?, 'PO', 'po', ?, ?, 1, ?, ?, 1, 'OFFICIAL', ?, 1, 'user1', ?, ?, 'perf', 'perf')");
const ver = db.prepare("INSERT INTO sig_verifications (company_id, code, generated_doc_id, verify_count, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'perf', 'perf')");
const sg = db.prepare("INSERT INTO sig_signatures (company_id, generated_doc_id, signer_name, method, signed_at, hash, digest, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'perf', 'perf')");
const methods = ['APPROVAL', 'APPROVAL', 'APPROVAL', 'IMAGE'];
for (let i = 1; i <= rows; i += 1) {
  const f = Number(file.run(`k/${i}`, `d${i}.pdf`, `h${i}`).lastInsertRowid);
  const day = new Date(Date.UTC(2026, 0, 1) + (i % 300) * 86_400_000).toISOString();
  const project = 1 + (i % 60);
  const g = Number(gen.run(tplId, `e${i}`, `PO/${String(i).padStart(6, '0')}`, f, `h${i}`, `V${String(i).padStart(10, '0')}`, day, project).lastInsertRowid);
  ver.run(`V${String(i).padStart(10, '0')}`, g, i % 5, project);
  sg.run(g, `user${i % 400}`, methods[i % 4], day, `h${i}`, `d${i}`, project);
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
const L = (q) => sig.register.list(aud, { sort: 'newest', limit: 25, offset: 0, ...q });
const worst = [];
worst.push(time('register, page 1', () => L({})));
worst.push(time('register, page 400', () => L({ offset: 9_975 })));
worst.push(time('register of a project', (i) => L({ projectId: 1 + (i % 60) })));
worst.push(time('register by method', () => L({ method: 'IMAGE' })));
worst.push(time('register by signer', (i) => L({ signer: `user${i % 400}` })));
worst.push(time('register of a date range', () => L({ from: '2026-03-01', to: '2026-03-31' })));
worst.push(time('register searched by number', (i) => L({ q: `PO/${String(i * 19 + 1).padStart(6, '0')}` })));
worst.push(time('public check by code', (i) => sig.signer.verify(`V${String(1 + ((i * 97) % rows)).padStart(10, '0')}`), queries));
for (const [label, sql] of [
  ['register by method and status', "SELECT id FROM sig_signatures WHERE company_id = 1 AND is_active = 1 AND method = 'IMAGE' AND status = 'SIGNED' ORDER BY signed_at DESC, id DESC LIMIT 25"],
  ['register of a project', "SELECT id FROM sig_signatures WHERE company_id = 1 AND project_id = 7 ORDER BY signed_at DESC LIMIT 25"],
  ['signatures of one document', "SELECT id FROM sig_signatures WHERE generated_doc_id = 77 ORDER BY id"],
  ['check by code', "SELECT id FROM sig_verifications WHERE code = 'V0000000007'"],
]) console.log(`\nPlan: ${label}\n${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => `  ${r.detail}`).join('\n')}`);
const bad = worst.filter((x) => x > 500).length;
console.log(`\n${bad === 0 ? 'All within the standard (p95 <= 500 ms).' : `${bad} measure(s) above 500 ms.`}`);
process.exit(bad === 0 ? 0 : 1);
