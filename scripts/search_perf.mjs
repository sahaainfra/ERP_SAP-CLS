// npm run erp:search-perf -- [--rows 100000] [--queries 300] [--save]
// Part 03.08: fills the search index with synthetic records (default 100 000 over 50 projects) and times the search API (the palette's
// grouped query and the Advanced Search page) for the shapes of query people type: a whole document number, part of a number, a word,
// two words, a Hindi name, a typing mistake and a word that matches nothing. Also prints the query plan of the index lookups.
// The standard is p95 <= 400 ms for the palette (AC-01).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/server/modules/registry.js';
import { codeKey, normalise, phoneticText } from '../src/shared/search/text.js';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateUp } from '../src/server/platform/db/index.js';
import { silentLogger } from '../src/server/platform/http/logger.js';

/** The application on a random port over an in-memory database, called with the development identity headers. */
async function startApi() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrateUp(db);
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', AUTH_MODE: 'dev-headers' }), db, logger: silentLogger });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, roles, company } = /** @type {any} */ ({})) => {
    const res = await fetch(base + path, { method, headers: { 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': company } });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { db, call, close: () => new Promise((resolve) => server.close(resolve)) };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 300));

const api = await startApi();
const db = api.db;
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const projects = [];
for (let p = 1; p <= 50; p += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 'perf', 'perf')").run(`P${String(p).padStart(2, '0')}`, `Project ${p}`).lastInsertRowid));
const words = ['cement', 'steel', 'tmt bar', 'shuttering', 'excavator', 'aggregate', 'bitumen', 'formwork', 'footing', 'girder', 'culvert', 'hume pipe', 'binding wire', 'curing', 'anchor bolt', 'diesel', 'sand', 'plywood'];
const names = ['Rajesh Sharma', 'Suresh Kumar', 'Anil Verma', 'सुरेश कुमार', 'Mohan Das', 'Priya Nair', 'Vikas Singh', 'Deepak Gupta'];
const insert = db.prepare("INSERT INTO core_search_index (company_id, entity, entity_id, project_id, code, code_key, title, title_lc, subtitle, body, phon, record_status, doc_date, permission_key, route, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'perf', 'perf')");
const t0 = Date.now();
db.exec('BEGIN');
for (let i = 1; i <= rows; i += 1) {
  const w = words[i % words.length];
  const isPerson = i % 10 === 0;
  const project = projects[i % projects.length];
  const code = isPerson ? `E${String(i).padStart(6, '0')}` : `MR/2026-27/${String(i).padStart(6, '0')}`;
  const title = isPerson ? names[i % names.length] : `${w[0].toUpperCase()}${w.slice(1)} lot ${i}`;
  const subtitle = isPerson ? 'Site engineer' : `Project P${String((i % 50) + 1).padStart(2, '0')} · ${names[i % names.length]}`;
  insert.run(isPerson ? 'user' : 'sample_request', i, isPerson ? null : project, code, codeKey(code), title, normalise(title), subtitle, `${w} delivery note ${i % 97}`, phoneticText(`${title} ${subtitle}`), 'SUBMITTED', '2026-10-31', isPerson ? 'iam.user.view' : 'core.sample.use', '/x');
}
db.exec('COMMIT');
console.log(`Indexed ${rows} synthetic records in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

/** @type {any} */
const who = { roles: 'SYSADM,PM', user: 'perf', company: '1' };
const mid = Math.floor(rows / 2) + 1;
const shapes = {
  'whole document number': () => `MR/2026-27/${String(mid + (Math.floor(Math.random() * 1000) * 10 + 1)).padStart(6, '0')}`,
  'part of a number': () => String(Math.floor(Math.random() * 90000) + 1000).padStart(5, '0'),
  'one word': () => words[Math.floor(Math.random() * words.length)].split(' ')[0],
  'two words': () => `${words[Math.floor(Math.random() * words.length)].split(' ')[0]} lot`,
  'a Hindi name': () => 'सुरेश',
  'a Latin name by sound': () => 'Sarma',
  'a typing mistake': () => 'shutering',
  'matches nothing': () => `zzq${Math.floor(Math.random() * 1000)}x`,
};
const report = { generatedAt: new Date().toISOString(), rows, queries: {}, plans: {} };
const p = (arr, f) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil(arr.length * f) - 1)];
for (const [name, make] of Object.entries(shapes)) {
  const times = [];
  for (let i = 0; i < queries / Object.keys(shapes).length + 5; i += 1) {
    const t = performance.now();
    const res = await api.call('GET', `/api/v1/ui/search?${new URLSearchParams({ q: make(), log: '0' })}`, who);
    times.push(performance.now() - t);
    if (res.status !== 200) throw new Error(`${name}: ${res.status} ${JSON.stringify(res.json)}`);
  }
  report.queries[name] = { n: times.length, p50Ms: Math.round(p(times, 0.5)), p95Ms: Math.round(p(times, 0.95)), maxMs: Math.round(Math.max(...times)) };
  console.log(`${name.padEnd(24)} p50 ${String(report.queries[name].p50Ms).padStart(4)} ms   p95 ${String(report.queries[name].p95Ms).padStart(4)} ms   max ${String(report.queries[name].maxMs).padStart(4)} ms`);
}
const plan = (sql, ...a) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...a).map((r) => r.detail);
report.plans.exactNumber = plan("SELECT i.* FROM core_search_index i WHERE i.company_id = 1 AND i.code_key = 'mr2026270000100'");
report.plans.titlePrefix = plan("SELECT i.* FROM core_search_index i WHERE i.company_id = 1 AND i.title_lc >= 'cem' AND i.title_lc < 'cem￿'");
report.plans.fulltext = plan("SELECT i.* FROM core_search_fts JOIN core_search_index i ON i.id = core_search_fts.rowid WHERE core_search_fts MATCH '{code title subtitle body} : (\"cement\")' AND i.company_id = 1");
for (const [k, v] of Object.entries(report.plans)) console.log(`plan ${k}: ${v.join(' | ')}`);
const worst = Math.max(...Object.values(report.queries).map((q) => q.p95Ms));
report.worstP95Ms = worst;
report.meetsStandard = worst <= 400;
console.log(`\nWorst p95 ${worst} ms (standard 400 ms): ${report.meetsStandard ? 'OK' : 'TOO SLOW'}`);
mkdirSync(resolve(root, 'reports'), { recursive: true });
writeFileSync(resolve(root, 'reports', 'search-perf.json'), `${JSON.stringify(report, null, 2)}\n`);
if (args.includes('--save')) { mkdirSync(resolve(root, 'docs', 'erp', 'perf'), { recursive: true }); writeFileSync(resolve(root, 'docs', 'erp', 'perf', 'search.json'), `${JSON.stringify(report, null, 2)}\n`); }
await api.close();
process.exit(report.meetsStandard ? 0 : 1);
