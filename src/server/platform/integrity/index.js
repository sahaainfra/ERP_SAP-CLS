import { randomUUID } from 'node:crypto';
import { activeConditions, describeSchema, ident } from '../db/schema.js';
import { STANDARD_STATES, integrityRegistry } from './registry.js';

export { integrityRegistry, STANDARD_STATES };

const SAMPLE_LIMIT = 5;
const MONEY_LIKE = /(^|_)(qty|quantity|amount|total|stock|balance|rate|price|cost|paise)(_|$)/;
const NUMERIC_TYPE = /^(INT|INTEGER|REAL|NUMERIC|DECIMAL|FLOAT|DOUBLE)/i;

const where = (conds) => (conds.length ? `WHERE ${conds.join(' AND ')}` : '');

// ---------------------------------------------------------------------------------------------------------
// A check returns { checked, failures, samples }. `checked` is how many things it looked at (tables, columns,
// rules); zero means the check had nothing to look at yet and is reported as not_applicable, never as a pass.
// Samples hold identifiers only (table, id, company, key): never amounts, rates, salaries or personal data.
// ---------------------------------------------------------------------------------------------------------

export const CHECKS = [
  {
    code: 'orphan_foreign_keys',
    name: 'Orphan foreign keys',
    severity: 'Critical',
    description: 'Every row that points at another row (a foreign key) must point at one that exists.',
    run({ db, tables }) {
      const checked = tables.reduce((n, t) => n + t.fks.length, 0);
      if (checked === 0) return { checked: 0, failures: 0, samples: [] };
      const rows = db.prepare('PRAGMA foreign_key_check').all();
      return { checked, failures: rows.length, samples: rows.slice(0, SAMPLE_LIMIT).map((r) => ({ table: r.table, id: r.rowid, parent: r.parent })) };
    },
  },
  {
    code: 'duplicate_business_keys',
    name: 'Duplicate business keys',
    severity: 'Critical',
    description: 'No two live rows may share a business key, such as (company_id, doc_no).',
    run({ db, tables, rules, business }) {
      const byName = new Map(tables.map((t) => [t.name, t]));
      // the business key of a numbered document is (company_id, doc_no) unless the table's own unique index says more: a table whose revisions keep the number declares (company_id, doc_no, revision) and is checked on that
      const declared = (name) => {
        const sets = db.prepare(`PRAGMA index_list(${ident(name)})`).all().filter((i) => i.unique).map((i) => db.prepare(`PRAGMA index_info(${ident(i.name)})`).all().map((c) => c.name));
        const withDoc = sets.filter((cols) => cols.includes('company_id') && cols.includes('doc_no') && cols.every(Boolean)).sort((a, b) => a.length - b.length);
        return withDoc[0] ?? ['company_id', 'doc_no'];
      };
      const keys = business.filter((t) => t.has('company_id') && t.has('doc_no')).map((t) => ({ table: t.name, columns: declared(t.name) }));
      for (const u of rules.uniqueKeys) if (byName.has(u.table)) keys.push(u);
      let failures = 0;
      const samples = [];
      for (const k of keys) {
        const t = byName.get(k.table);
        const cols = k.columns.map(ident);
        // a key with an empty part (a draft not numbered yet) collides with nothing, as in a SQL unique index
        const sql = `SELECT ${cols.join(', ')}, COUNT(*) AS n FROM ${ident(k.table)} ${where([...activeConditions(t), ...cols.map((c) => `${c} IS NOT NULL`)])} GROUP BY ${cols.join(', ')} HAVING COUNT(*) > 1`;
        const dupes = db.prepare(sql).all();
        failures += dupes.length;
        for (const d of dupes.slice(0, SAMPLE_LIMIT - samples.length)) samples.push({ table: k.table, key: Object.fromEntries(cols.map((c) => [c, d[c]])), rows: d.n });
      }
      return { checked: keys.length, failures, samples };
    },
  },
  {
    code: 'header_line_totals',
    name: 'Header totals equal the sum of their lines',
    severity: 'Critical',
    description: 'A document total must equal the sum of its live lines, exactly (amounts are stored in whole minor units).',
    run({ db, tables, rules }) {
      const byName = new Map(tables.map((t) => [t.name, t]));
      let checked = 0;
      let failures = 0;
      const samples = [];
      for (const r of rules.headerLines) {
        const h = byName.get(r.header);
        const l = byName.get(r.line);
        if (!h || !l) continue;
        checked++;
        const lineActive = activeConditions(l, 'l');
        const sql = `SELECT h.${r.headerKey} AS id${h.has('company_id') ? ', h.company_id AS company_id' : ''}
          FROM ${r.header} h LEFT JOIN ${r.line} l ON l.${r.lineKey} = h.${r.headerKey}${lineActive.length ? ` AND ${lineActive.join(' AND ')}` : ''}
          ${where(activeConditions(h, 'h'))}
          GROUP BY h.${r.headerKey} HAVING h.${r.headerTotal} <> COALESCE(SUM(l.${r.lineAmount}), 0)`;
        const bad = db.prepare(sql).all();
        failures += bad.length;
        for (const b of bad.slice(0, SAMPLE_LIMIT - samples.length)) samples.push({ table: r.header, id: b.id, company_id: b.company_id ?? null });
      }
      return { checked, failures, samples };
    },
  },
  {
    code: 'unbalanced_journals',
    name: 'Journals balance',
    severity: 'Critical',
    description: 'For every journal, total debits must equal total credits.',
    run({ db, tables, rules }) {
      const byName = new Map(tables.map((t) => [t.name, t]));
      let checked = 0;
      let failures = 0;
      const samples = [];
      for (const j of rules.journals) {
        const t = byName.get(j.table);
        if (!t) continue;
        checked++;
        const sql = `SELECT ${j.group} AS grp FROM ${j.table} ${where(activeConditions(t))} GROUP BY ${j.group} HAVING SUM(${j.debit}) <> SUM(${j.credit})`;
        const bad = db.prepare(sql).all();
        failures += bad.length;
        for (const b of bad.slice(0, SAMPLE_LIMIT - samples.length)) samples.push({ table: j.table, journal: b.grp });
      }
      return { checked, failures, samples };
    },
  },
  {
    code: 'sequence_gaps',
    name: 'Gap-free number series have no gaps',
    severity: 'Critical',
    description: 'Statutory document numbers (tax invoices, credit notes) must run 1, 2, 3 with none missing; a cancelled document keeps its number.',
    run({ db, tables, rules }) {
      const byName = new Map(tables.map((t) => [t.name, t]));
      let checked = 0;
      let failures = 0;
      const samples = [];
      for (const q of rules.sequences) {
        const t = byName.get(q.table);
        if (!t) continue;
        checked++;
        const cond = [...activeConditions(t), ...(q.where ? [`(${q.where})`] : [])];
        const cols = q.groupBy.join(', ');
        const sql = `SELECT ${cols}, MIN(${q.seq}) AS lo, MAX(${q.seq}) AS hi, COUNT(*) AS n FROM ${q.table} ${where(cond)} GROUP BY ${cols} HAVING MAX(${q.seq}) - MIN(${q.seq}) + 1 <> COUNT(*)`;
        const bad = db.prepare(sql).all();
        failures += bad.length;
        for (const b of bad.slice(0, SAMPLE_LIMIT - samples.length)) {
          samples.push({ table: q.table, group: Object.fromEntries(q.groupBy.map((c) => [c, b[c]])), from: b.lo, to: b.hi, present: b.n });
        }
      }
      return { checked, failures, samples };
    },
  },
  {
    code: 'negative_quantities',
    name: 'No negative quantities or amounts',
    severity: 'High',
    description: 'Quantity, amount, total, stock, rate, price and cost columns must not be negative unless the table says they may be.',
    run({ db, business, rules }) {
      let checked = 0;
      let failures = 0;
      const samples = [];
      for (const t of business) {
        for (const c of t.columns) {
          if (!MONEY_LIKE.test(c.name) || !NUMERIC_TYPE.test(c.type) || rules.allowNegative.has(`${t.name}.${c.name}`)) continue;
          checked++;
          const bad = db.prepare(`SELECT COUNT(*) AS n, MIN(rowid) AS first FROM ${ident(t.name)} ${where([...activeConditions(t), `${ident(c.name)} < 0`])}`).get();
          failures += bad.n;
          if (bad.n > 0 && samples.length < SAMPLE_LIMIT) samples.push({ table: t.name, column: c.name, id: bad.first, rows: bad.n });
        }
      }
      return { checked, failures, samples };
    },
  },
  {
    code: 'missing_company_id',
    name: 'Every record belongs to a company',
    severity: 'High',
    description: 'Business rows must carry company_id, or tenancy rules cannot protect them. Tables that hold installation-wide data are listed as company-optional.',
    run({ db, business, rules }) {
      let checked = 0;
      let failures = 0;
      const samples = [];
      for (const t of business) {
        if (rules.companyOptional.has(t.name)) continue;
        checked++;
        if (!t.has('company_id')) {
          failures++;
          if (samples.length < SAMPLE_LIMIT) samples.push({ table: t.name, problem: 'no company_id column' });
          continue;
        }
        const bad = db.prepare(`SELECT COUNT(*) AS n, MIN(rowid) AS first FROM ${ident(t.name)} ${where([...activeConditions(t), 'company_id IS NULL'])}`).get();
        failures += bad.n;
        if (bad.n > 0 && samples.length < SAMPLE_LIMIT) samples.push({ table: t.name, id: bad.first, rows: bad.n });
      }
      return { checked, failures, samples };
    },
  },
  {
    code: 'invalid_status_values',
    name: 'Status values are valid',
    severity: 'High',
    description: 'A status column may only hold the standard workflow states, or the list its module registered.',
    run({ db, business, rules }) {
      let checked = 0;
      let failures = 0;
      const samples = [];
      for (const t of business) {
        if (!t.has('status')) continue;
        checked++;
        const allowed = rules.statuses.get(t.name) ?? STANDARD_STATES;
        const marks = allowed.map(() => '?').join(', ');
        const bad = db.prepare(`SELECT status, COUNT(*) AS n, MIN(rowid) AS first FROM ${ident(t.name)} ${where([...activeConditions(t), `(status IS NULL OR status NOT IN (${marks}))`])} GROUP BY status`).all(...allowed);
        for (const b of bad) {
          failures += b.n;
          if (samples.length < SAMPLE_LIMIT) samples.push({ table: t.name, status: b.status, id: b.first, rows: b.n });
        }
      }
      return { checked, failures, samples };
    },
  },
];

/**
 * Run the integrity checks (FR-03). `registry` defaults to the application's; tests pass their own.
 * A check that throws is reported as a failed check with the reason, so one bad rule cannot hide the others.
 */
export function runChecks(db, { registry = integrityRegistry, only = null, now = new Date() } = {}) {
  const { rules } = registry;
  const tables = describeSchema(db);
  const business = tables.filter((t) => !rules.technicalTables.has(t.name));
  const runId = randomUUID();
  const results = [];
  for (const check of CHECKS) {
    if (only && !only.includes(check.code)) continue;
    const started = process.hrtime.bigint();
    let out;
    try {
      out = check.run(/** @type {any} */ ({ db, tables, business, rules }));
    } catch (err) {
      out = { checked: 1, failures: 1, samples: [{ error: `check could not run: ${err.message}` }] };
    }
    const status = out.failures > 0 ? 'fail' : out.checked === 0 ? 'not_applicable' : 'pass';
    results.push({
      code: check.code,
      name: check.name,
      severity: check.severity,
      description: check.description,
      status,
      checked: out.checked,
      failures: out.failures,
      samples: out.samples,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
    });
  }
  const failed = results.filter((r) => r.status === 'fail');
  return {
    runId,
    runAt: now.toISOString(),
    results,
    summary: {
      pass: results.filter((r) => r.status === 'pass').length,
      fail: failed.length,
      notApplicable: results.filter((r) => r.status === 'not_applicable').length,
      criticalFailures: failed.filter((r) => r.severity === 'Critical').length,
    },
  };
}

const RANK = { Critical: 3, High: 2, Medium: 1, Low: 0 };
/** True when a failed check is at or above `level`: the gate that blocks CI and deployment (BR-03). */
export const blocks = (run, level = 'Critical') => run.results.some((r) => r.status === 'fail' && RANK[r.severity] >= RANK[level]);
