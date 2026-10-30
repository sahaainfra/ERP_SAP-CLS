import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fromUnits, lineAmount, toUnits } from '../../src/shared/money.js';

// Performance test data (FR-07): realistic volumes with referential integrity, deterministic for a seed, and
// completely separate from the demo seeds and from the application's own schema. The tables follow the
// standards exactly (standard columns, FKs, (company_id, doc_no) key, integer minor units), so the integrity
// checks and the list-query timings run against something that looks like a real business module.

const STD = `
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_by TEXT, updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, deleted_by TEXT,
  source_type TEXT, source_id TEXT, remarks TEXT`;

export const PERF_SCHEMA = `
CREATE TABLE perf_companies (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL, ${STD});
CREATE TABLE perf_projects (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES perf_companies(id), code TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT', ${STD});
CREATE UNIQUE INDEX ux_perf_projects_code ON perf_projects (company_id, code);
CREATE INDEX ix_perf_projects_company ON perf_projects (company_id);
CREATE TABLE perf_documents (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES perf_companies(id), project_id INTEGER REFERENCES perf_projects(id),
  doc_no TEXT NOT NULL, doc_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0), ${STD});
CREATE UNIQUE INDEX ux_perf_documents_doc_no ON perf_documents (company_id, doc_no);
CREATE INDEX ix_perf_documents_company_status_date ON perf_documents (company_id, status, doc_date);
CREATE INDEX ix_perf_documents_project_date ON perf_documents (project_id, doc_date);
CREATE TABLE perf_document_lines (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, document_id INTEGER NOT NULL REFERENCES perf_documents(id), line_no INTEGER NOT NULL,
  item_code TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity >= 0), rate INTEGER NOT NULL CHECK (rate >= 0),
  amount INTEGER NOT NULL CHECK (amount >= 0), ${STD});
CREATE INDEX ix_perf_document_lines_document ON perf_document_lines (document_id);
CREATE INDEX ix_perf_document_lines_company ON perf_document_lines (company_id);
`;

/** Small deterministic random generator (mulberry32): the same seed always produces the same data. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'APPROVED', 'APPROVED', 'REJECTED', 'RETURNED', 'CLOSED'];
const ITEMS = ['CEM-OPC53', 'STL-TMT12', 'STL-TMT16', 'AGG-20MM', 'SND-RIVER', 'BRK-FLY', 'PIP-GI25', 'CBL-4C16', 'PNT-EMUL', 'RMC-M30'];

/** Rules to register so the integrity checks know how the perf tables relate. */
export const PERF_RULES = { headerLines: [{ header: 'perf_documents', line: 'perf_document_lines', lineKey: 'document_id', headerTotal: 'total_amount', lineAmount: 'amount' }] };

/**
 * Build a performance database: `companies` companies, `projects` projects, `documents` documents with 1..maxLines
 * lines each. Header totals are exactly the sum of their lines. Returns the row counts and the time taken.
 */
export function createPerfDatabase(path, { seed = 1, companies = 3, projects = 50, documents = 100_000, maxLines = 4, batch = 5_000 } = {}) {
  const started = Date.now();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
    for (const s of ['', '-wal', '-shm']) rmSync(`${path}${s}`, { force: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;');
  db.exec(PERF_SCHEMA);
  const rnd = prng(seed);
  const pick = (n) => Math.floor(rnd() * n);

  const insCompany = db.prepare("INSERT INTO perf_companies (id, company_id, name, created_by, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z')");
  const insProject = db.prepare("INSERT INTO perf_projects (id, company_id, code, name, status, created_by, created_at) VALUES (?, ?, ?, ?, 'APPROVED', 'generator', '2026-01-01T00:00:00.000Z')");
  const insDoc = db.prepare("INSERT INTO perf_documents (id, company_id, project_id, doc_no, doc_date, status, total_amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z')");
  const insLine = db.prepare("INSERT INTO perf_document_lines (company_id, document_id, line_no, item_code, quantity, rate, amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z')");

  db.exec('BEGIN');
  for (let c = 1; c <= companies; c++) insCompany.run(c, c, `Company ${c}`, 'generator');
  const projectCompany = [];
  for (let p = 1; p <= projects; p++) {
    const company = ((p - 1) % companies) + 1;
    projectCompany[p] = company;
    insProject.run(p, company, `PRJ-${String(p).padStart(4, '0')}`, `Project ${p}`);
  }
  db.exec('COMMIT');

  const seq = new Array(companies + 1).fill(0);
  let lines = 0;
  for (let from = 1; from <= documents; from += batch) {
    db.exec('BEGIN');
    for (let id = from; id < from + batch && id <= documents; id++) {
      const project = 1 + pick(projects);
      const company = projectCompany[project];
      seq[company] += 1;
      const n = 1 + pick(maxLines);
      const rows = [];
      let total = 0n;
      for (let l = 1; l <= n; l++) {
        const quantity = 1000 + pick(500_000); // x1000: 1.000 to 501.000
        const rate = 10_000 + pick(5_000_000); // x10000: 1.0000 to 501.0000 per unit
        const paise = BigInt(toUnits(lineAmount(fromUnits(quantity, 'quantity'), fromUnits(rate, 'rate')), 'money'));
        rows.push([l, ITEMS[pick(ITEMS.length)], quantity, rate, paise]);
        total += paise;
      }
      const day = 1 + pick(365);
      const date = new Date(Date.UTC(2025, 3, 1) + day * 86_400_000).toISOString().slice(0, 10);
      insDoc.run(id, company, project, `DOC-${String(seq[company]).padStart(7, '0')}`, date, STATUSES[pick(STATUSES.length)], Number(total), 'generator');
      for (const [l, item, q, r, a] of rows) {
        insLine.run(company, id, l, item, q, r, Number(a), 'generator');
        lines++;
      }
    }
    db.exec('COMMIT');
  }
  db.exec('ANALYZE');
  return { db, counts: { companies, projects, documents, lines }, ms: Date.now() - started };
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

/**
 * Time the list and record queries a screen would run (a page of 25, its count, one record, one document's
 * lines), `runs` times each, and read the query plan. Returns percentiles in ms and the plans.
 */
export function measureQueries(db, { runs = 200, seed = 7 } = {}) {
  const rnd = prng(seed);
  const maxDoc = db.prepare('SELECT MAX(id) AS m FROM perf_documents').get().m;
  const companies = db.prepare('SELECT COUNT(*) AS n FROM perf_companies').get().n;
  const projects = db.prepare('SELECT COUNT(*) AS n FROM perf_projects').get().n;
  const queries = {
    'list page (company, status, newest first, 25)': {
      sql: "SELECT * FROM perf_documents WHERE company_id = :c AND status = 'APPROVED' AND is_active = 1 AND deleted_at IS NULL ORDER BY doc_date DESC, id DESC LIMIT 25",
      args: () => ({ c: 1 + Math.floor(rnd() * companies) }),
    },
    'list count (same filter)': {
      sql: "SELECT COUNT(*) AS n FROM perf_documents WHERE company_id = :c AND status = 'APPROVED' AND is_active = 1 AND deleted_at IS NULL",
      args: () => ({ c: 1 + Math.floor(rnd() * companies) }),
    },
    'project page (project, newest first, 25)': {
      sql: 'SELECT * FROM perf_documents WHERE project_id = :p AND is_active = 1 ORDER BY doc_date DESC LIMIT 25',
      args: () => ({ p: 1 + Math.floor(rnd() * projects) }),
    },
    'record read by id': { sql: 'SELECT * FROM perf_documents WHERE id = :id', args: () => ({ id: 1 + Math.floor(rnd() * maxDoc) }) },
    "a document's lines": { sql: 'SELECT * FROM perf_document_lines WHERE document_id = :id ORDER BY line_no', args: () => ({ id: 1 + Math.floor(rnd() * maxDoc) }) },
  };
  const out = {};
  for (const [name, q] of Object.entries(queries)) {
    const stmt = db.prepare(q.sql);
    const times = [];
    for (let i = 0; i < runs; i++) {
      const args = q.args();
      const t = process.hrtime.bigint();
      stmt.all(args);
      times.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    times.sort((a, b) => a - b);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(q.args()).map((r) => r.detail);
    out[name] = { p50: +percentile(times, 50).toFixed(3), p95: +percentile(times, 95).toFixed(3), max: +times.at(-1).toFixed(3), plan, fullScan: plan.some((d) => /^SCAN perf_documents(?! USING)/.test(d) || /^SCAN perf_document_lines(?! USING)/.test(d)) };
  }
  return out;
}
