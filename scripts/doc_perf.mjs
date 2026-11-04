// npm run erp:doc-perf -- [--rows 100000] [--queries 100]
// Part 04.10: fills the register (default 100 000 documents over 60 projects, a folder tree and four confidentiality levels) and times what the screens ask: the register page (plain, by
// project, by folder with sub-folders, by type and status, searched, sorted by expiry), one document, the expiring list and the visibility check of a restricted reader. Prints query plans.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { createDocumentService } from '../src/server/modules/eng/documents.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
for (let p = 1; p <= 60; p += 1) db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`);
const svc = createDocumentService({ db, engine: workflowOf(db) });
const folders = [];
for (let p = 1; p <= 60; p += 1) {
  const top = Number(db.prepare("INSERT INTO doc_folders (company_id, project_id, parent_id, name, path, created_by, source_type) VALUES (1, ?, NULL, 'Drawings', '/Drawings', 'perf', 'perf')").run(p).lastInsertRowid);
  folders.push([p, top]);
  for (const n of ['Structural', 'MEP', 'Roads']) db.prepare("INSERT INTO doc_folders (company_id, project_id, parent_id, name, path, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'perf', 'perf')").run(p, top, n, `/Drawings/${n}`);
}
console.log(`Filling ${rows} documents...`);
const types = ['DRAWING', 'SPECIFICATION', 'CONTRACT', 'METHOD_STATEMENT', 'CORRESPONDENCE', 'QA_RECORD', 'LICENCE', 'CERTIFICATE'];
const level = ['PUBLIC', 'INTERNAL', 'INTERNAL', 'INTERNAL', 'INTERNAL', 'CONFIDENTIAL', 'CONFIDENTIAL', 'RESTRICTED'];
const status = ['ISSUED', 'ISSUED', 'ISSUED', 'ISSUED', 'DRAFT', 'IN_REVIEW', 'ARCHIVED', 'ISSUED'];
db.exec('BEGIN');
const ins = db.prepare("INSERT INTO doc_documents (company_id, doc_no, title, doc_type, discipline, folder_id, current_revision, status, confidentiality, owner_user_ref, retention_class, valid_until, project_id, created_by, source_type) VALUES (1, ?, ?, ?, 'Structural', ?, 'A', ?, ?, ?, 'standard', ?, ?, 'perf', 'perf')");
for (let i = 1; i <= rows; i += 1) {
  const [project, folder] = folders[i % 60];
  ins.run(`DOC-${String(i).padStart(6, '0')}`, `Pier ${i % 500} reinforcement layout ${i}`, types[i % 8], folder, status[i % 8], level[i % 8], `user${i % 400}`, i % 8 >= 6 ? new Date(Date.UTC(2026, 10, 4) + ((i % 120) - 20) * 86_400_000).toISOString().slice(0, 10) : null, project);
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
const doc = { user: 'doc1', roles: ['DOC'], companyId: 1 };
const eng = (i) => ({ user: `user${i % 400}`, roles: ['SE'], companyId: 1 });
const worst = [];
worst.push(time('register, page 1', () => svc.documents.list(doc, { sort: 'newest', limit: 25, offset: 0 })));
worst.push(time('register, page 400', () => svc.documents.list(doc, { sort: 'newest', limit: 25, offset: 9_975 })));
worst.push(time('register of a project', (i) => svc.documents.list(doc, { projectId: 1 + (i % 60), sort: 'number', limit: 25, offset: 0 })));
worst.push(time('register of a folder with sub-folders', (i) => svc.documents.list(doc, { folderId: folders[i % 60][1], includeSub: true, sort: 'newest', limit: 25, offset: 0 })));
worst.push(time('register by type and status', () => svc.documents.list(doc, { docType: 'DRAWING', status: 'ISSUED', sort: 'newest', limit: 25, offset: 0 })));
worst.push(time('register searched by words', (i) => svc.documents.list(doc, { q: `Pier ${i % 500}`, sort: 'newest', limit: 25, offset: 0 })));
worst.push(time('register expiring in 30 days', () => svc.documents.list(doc, { expiring: 30, sort: 'expiry', limit: 25, offset: 0 })));
worst.push(time('register of an engineer (visibility check)', (i) => svc.documents.list(eng(i), { sort: 'newest', limit: 25, offset: 0 })));
worst.push(time('one document', (i) => svc.documents.get(doc, 1 + ((i * 97) % rows)), queries));
for (const [label, sql, params] of [
  ['register by type and status', "SELECT id FROM doc_documents WHERE company_id = 1 AND is_active = 1 AND doc_type = 'DRAWING' AND status = 'ISSUED' ORDER BY id DESC LIMIT 25", []],
  ['register of a project', 'SELECT id FROM doc_documents WHERE company_id = 1 AND is_active = 1 AND project_id = 7 ORDER BY doc_no LIMIT 25', []],
]) console.log(`\nPlan: ${label}\n${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => `  ${r.detail}`).join('\n')}`);
const bad = worst.filter((x) => x > 500).length;
console.log(`\n${bad === 0 ? 'All within the standard (p95 <= 500 ms).' : `${bad} measure(s) above 500 ms.`}`);
process.exit(bad === 0 ? 0 : 1);
