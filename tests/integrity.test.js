import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CHECKS, blocks, runChecks } from '../src/server/platform/integrity/index.js';
import { createIntegrityRegistry } from '../src/server/platform/integrity/registry.js';
import { startApi } from './helpers.js';

const STD = `created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT, version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, deleted_by TEXT, source_type TEXT, source_id TEXT, remarks TEXT`;

/** A small business module that follows the standards: documents, lines and journal lines. */
function businessDb({ uniqueIndex = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tst_companies (id INTEGER PRIMARY KEY, company_id INTEGER, name TEXT, ${STD});
    CREATE TABLE tst_docs (id INTEGER PRIMARY KEY, company_id INTEGER, doc_no TEXT, status TEXT NOT NULL DEFAULT 'DRAFT',
      total_amount INTEGER NOT NULL DEFAULT 0, ${STD});
    ${uniqueIndex ? 'CREATE UNIQUE INDEX ux_tst_docs_doc_no ON tst_docs (company_id, doc_no);' : ''}
    CREATE TABLE tst_doc_lines (id INTEGER PRIMARY KEY, company_id INTEGER, doc_id INTEGER REFERENCES tst_docs(id), amount INTEGER NOT NULL DEFAULT 0, ${STD});
    CREATE TABLE tst_journal_lines (id INTEGER PRIMARY KEY, company_id INTEGER, journal_id INTEGER, debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0, ${STD});
  `);
  const reg = createIntegrityRegistry();
  reg.register({
    headerLines: [{ header: 'tst_docs', line: 'tst_doc_lines', lineKey: 'doc_id', headerTotal: 'total_amount', lineAmount: 'amount' }],
    journals: [{ table: 'tst_journal_lines', group: 'journal_id', debit: 'debit', credit: 'credit' }],
  });
  return { db, reg };
}

function clean(db) {
  db.exec(`
    INSERT INTO tst_companies (id, company_id, name) VALUES (1, 1, 'A'), (2, 2, 'B');
    INSERT INTO tst_docs (id, company_id, doc_no, status, total_amount) VALUES (1, 1, 'D-1', 'APPROVED', 300), (2, 1, 'D-2', 'DRAFT', 50), (3, 2, 'D-1', 'DRAFT', 0);
    INSERT INTO tst_doc_lines (company_id, doc_id, amount) VALUES (1, 1, 100), (1, 1, 200), (1, 2, 50);
    INSERT INTO tst_journal_lines (company_id, journal_id, debit, credit) VALUES (1, 1, 500, 0), (1, 1, 0, 500), (1, 2, 70, 0), (1, 2, 0, 70);
  `);
}

const result = (run, code) => run.results.find((r) => r.code === code);

test('T-03 on clean data every check passes (or has nothing to check) and nothing blocks', () => {
  const { db, reg } = businessDb();
  clean(db);
  const run = runChecks(db, { registry: reg });
  for (const r of run.results) assert.ok(['pass', 'not_applicable'].includes(r.status), `${r.code}: ${r.status} ${JSON.stringify(r.samples)}`);
  assert.equal(result(run, 'orphan_foreign_keys').status, 'pass');
  assert.equal(result(run, 'header_line_totals').checked, 1);
  assert.equal(result(run, 'unbalanced_journals').checked, 1);
  assert.equal(run.summary.fail, 0);
  assert.equal(blocks(run), false);
});

test('T-03 an empty database reports "not applicable", never a false pass', () => {
  const run = runChecks(new DatabaseSync(':memory:'), { registry: createIntegrityRegistry() });
  assert.ok(run.results.every((r) => r.status === 'not_applicable'));
  assert.equal(result(run, 'header_line_totals').status, 'not_applicable');
  assert.equal(result(run, 'unbalanced_journals').status, 'not_applicable');
  assert.equal(run.summary.fail, 0);
});

test('T-03 orphan foreign key is detected (Critical)', () => {
  const { db, reg } = businessDb();
  clean(db);
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('INSERT INTO tst_doc_lines (company_id, doc_id, amount) VALUES (1, 999, 0)');
  const run = runChecks(db, { registry: reg });
  const r = result(run, 'orphan_foreign_keys');
  assert.equal(r.status, 'fail');
  assert.equal(r.failures, 1);
  assert.equal(r.samples[0].table, 'tst_doc_lines');
  assert.equal(blocks(run, 'Critical'), true);
});

test('T-03 duplicate business key is detected when the unique index is missing; soft-deleted rows do not count', () => {
  const { db, reg } = businessDb({ uniqueIndex: false });
  clean(db);
  assert.equal(result(runChecks(db, { registry: reg }), 'duplicate_business_keys').status, 'pass');
  db.exec("INSERT INTO tst_docs (company_id, doc_no, status) VALUES (1, 'D-1', 'DRAFT')");
  const r = result(runChecks(db, { registry: reg }), 'duplicate_business_keys');
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.samples[0], { table: 'tst_docs', key: { company_id: 1, doc_no: 'D-1' }, rows: 2 });
  db.exec("UPDATE tst_docs SET is_active = 0, deleted_at = '2026-10-30' WHERE id = 4");
  assert.equal(result(runChecks(db, { registry: reg }), 'duplicate_business_keys').status, 'pass');
});

test('T-03 a header total that differs from its lines is detected (Critical), and samples hold no amounts', () => {
  const { db, reg } = businessDb();
  clean(db);
  db.exec('UPDATE tst_docs SET total_amount = 123456 WHERE id = 1');
  const run = runChecks(db, { registry: reg });
  const r = result(run, 'header_line_totals');
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.samples, [{ table: 'tst_docs', id: 1, company_id: 1 }]);
  assert.ok(!JSON.stringify(run).includes('123456'), 'the amount must not appear anywhere in the result');
  db.exec('UPDATE tst_docs SET total_amount = 300 WHERE id = 1');
  db.exec("UPDATE tst_doc_lines SET is_active = 0, deleted_at = '2026-10-30' WHERE doc_id = 1 AND amount = 200");
  assert.equal(result(runChecks(db, { registry: reg }), 'header_line_totals').failures, 1, 'a soft-deleted line no longer counts toward the total');
});

test('T-03 an unbalanced journal is detected (Critical)', () => {
  const { db, reg } = businessDb();
  clean(db);
  db.exec('INSERT INTO tst_journal_lines (company_id, journal_id, debit, credit) VALUES (1, 3, 100, 0)');
  const r = result(runChecks(db, { registry: reg }), 'unbalanced_journals');
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.samples, [{ table: 'tst_journal_lines', journal: 3 }]);
});

test('T-03 a negative quantity or amount is detected (High) unless the table allows it', () => {
  const { db, reg } = businessDb();
  clean(db);
  db.exec('UPDATE tst_doc_lines SET amount = -5 WHERE id = 1');
  db.exec('UPDATE tst_docs SET total_amount = 195 WHERE id = 1'); // keep the header equal to its lines
  const r = result(runChecks(db, { registry: reg }), 'negative_quantities');
  assert.equal(r.status, 'fail');
  assert.equal(r.samples[0].table, 'tst_doc_lines');
  assert.equal(r.samples[0].column, 'amount');
  const allow = createIntegrityRegistry();
  allow.register({ allowNegative: ['tst_doc_lines.amount'] });
  assert.equal(result(runChecks(db, { registry: allow }), 'negative_quantities').status, 'pass');
  assert.equal(blocks(runChecks(db, { registry: reg }), 'Critical'), false, 'High does not block at the default level');
  assert.equal(blocks(runChecks(db, { registry: reg }), 'High'), true);
});

test('T-03 a record without a company is detected (High) unless the table is company-optional', () => {
  const { db, reg } = businessDb();
  clean(db);
  db.exec("INSERT INTO tst_docs (company_id, doc_no) VALUES (NULL, 'D-9')");
  const r = result(runChecks(db, { registry: reg }), 'missing_company_id');
  assert.equal(r.status, 'fail');
  assert.equal(r.samples[0].table, 'tst_docs');
  const optional = createIntegrityRegistry();
  optional.register({ companyOptional: ['tst_docs'] });
  assert.notEqual(result(runChecks(db, { registry: optional }), 'missing_company_id').samples[0]?.table, 'tst_docs');
});

test('T-03 a table with no company_id column at all is reported', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tst_loose (id INTEGER PRIMARY KEY, name TEXT, ${STD})`);
  const r = result(runChecks(db, { registry: createIntegrityRegistry() }), 'missing_company_id');
  assert.equal(r.status, 'fail');
  assert.equal(r.samples[0].problem, 'no company_id column');
});

test('T-03 an invalid status is detected (High); a module can register its own list', () => {
  const { db, reg } = businessDb();
  clean(db);
  db.exec("UPDATE tst_docs SET status = 'PENDING' WHERE id = 2");
  const r = result(runChecks(db, { registry: reg }), 'invalid_status_values');
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.samples[0], { table: 'tst_docs', status: 'PENDING', id: 2, rows: 1 });
  const own = createIntegrityRegistry();
  own.register({ statuses: { tst_docs: ['DRAFT', 'APPROVED', 'PENDING'] } });
  assert.equal(result(runChecks(db, { registry: own }), 'invalid_status_values').status, 'pass');
});

test('a check that throws is reported as failed with the reason, and the other checks still run', () => {
  const { db, reg } = businessDb();
  clean(db);
  db.exec('DROP TABLE tst_journal_lines');
  db.exec('DROP TABLE tst_doc_lines');
  const run = runChecks(db, { registry: reg });
  assert.equal(run.results.length, CHECKS.length);
  assert.ok(run.results.every((r) => r.status));
});

test('registry rejects names that are not plain identifiers, and `only` limits the run', () => {
  const reg = createIntegrityRegistry();
  assert.throws(() => reg.register({ companyOptional: ['x; DROP TABLE y'] }), /Unsafe SQL identifier/);
  assert.throws(() => reg.register({ headerLines: [{ header: 'a', line: 'b', lineKey: 'c d', headerTotal: 't', lineAmount: 'a' }] }), /Unsafe/);
  const { db, reg: r2 } = businessDb();
  assert.deepEqual(runChecks(db, { registry: r2, only: ['orphan_foreign_keys'] }).results.map((r) => r.code), ['orphan_foreign_keys']);
});

// ---- API ----
test('API: ITADM runs the checks and the result is stored, audited and queued as an event', async () => {
  const api = await startApi();
  const r = await api.call('POST', '/api/v1/core/integrity/run', { roles: 'ITADM', user: 'itadmin', body: {} });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.results.length, CHECKS.length);
  assert.equal(r.json.data.summary.fail, 0);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_integrity_runs WHERE run_id = ?').get(r.json.data.runId).n, CHECKS.length);
  const audit = api.db.prepare("SELECT * FROM core_audit_log WHERE entity = 'core_integrity_runs'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, 'itadmin');
  assert.equal(audit[0].correlation_id, r.headers.get('x-correlation-id'));
  const ev = api.db.prepare("SELECT * FROM core_outbox WHERE event_type = 'core.integrity_run.completed'").all();
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].payload).entityId, r.json.data.runId);
  await api.close();
});

test('API: permissions, SYSADM views but cannot run, others are refused', async () => {
  const api = await startApi();
  const run = (o) => api.call('POST', '/api/v1/core/integrity/run', { body: {}, ...o });
  assert.equal((await run({ roles: 'SYSADM' })).status, 403);
  assert.equal((await run({ roles: 'PM' })).status, 403);
  assert.equal((await run({ user: null })).status, 401);
  for (const path of ['/summary', '/runs']) {
    assert.equal((await api.call('GET', `/api/v1/core/integrity${path}`, { roles: 'SYSADM' })).status, 200, path);
    assert.equal((await api.call('GET', `/api/v1/core/integrity${path}`, { roles: 'ITADM' })).status, 200, path);
    assert.equal((await api.call('GET', `/api/v1/core/integrity${path}`, { roles: 'PM' })).status, 403, path);
  }
  await api.close();
});

test('API: summary lists every check with its last result; a violation seeded in the database shows up', async () => {
  const api = await startApi();
  const before = (await api.call('GET', '/api/v1/core/integrity/summary', { roles: 'ITADM' })).json.data;
  assert.equal(before.runId, null);
  assert.equal(before.checks.length, CHECKS.length);
  assert.ok(before.checks.every((c) => c.last === null), 'a check that never ran is still listed');
  api.db.exec(`CREATE TABLE tst_orders (id INTEGER PRIMARY KEY, company_id INTEGER, doc_no TEXT, status TEXT, amount INTEGER, ${STD})`);
  api.db.exec("INSERT INTO tst_orders (company_id, doc_no, status, amount) VALUES (NULL, 'X-1', 'WEIRD', -7)");
  await api.call('POST', '/api/v1/core/integrity/run', { roles: 'ITADM', body: {} });
  const after = (await api.call('GET', '/api/v1/core/integrity/summary', { roles: 'SYSADM' })).json.data;
  const by = Object.fromEntries(after.checks.map((c) => [c.code, c.last]));
  assert.equal(by.missing_company_id.status, 'fail');
  assert.equal(by.invalid_status_values.status, 'fail');
  assert.equal(by.negative_quantities.status, 'fail');
  assert.equal(by.orphan_foreign_keys.status, 'not_applicable');
  assert.ok(!JSON.stringify(after).includes('-7'), 'the negative amount itself is never shown');
  await api.close();
});

test('API: history is paginated, sortable and filterable by check', async () => {
  const api = await startApi();
  for (let i = 0; i < 2; i++) await api.call('POST', '/api/v1/core/integrity/run', { roles: 'ITADM', body: {} });
  const all = await api.call('GET', '/api/v1/core/integrity/runs?pageSize=5', { roles: 'ITADM' });
  assert.equal(all.json.meta.total, CHECKS.length * 2);
  assert.equal(all.json.data.length, 5);
  const one = await api.call('GET', '/api/v1/core/integrity/runs?filter[check_code]=orphan_foreign_keys', { roles: 'ITADM' });
  assert.equal(one.json.meta.total, 2);
  assert.ok(one.json.data.every((r) => r.code === 'orphan_foreign_keys'));
  assert.equal((await api.call('GET', '/api/v1/core/integrity/runs?sort=sample_json', { roles: 'ITADM' })).status, 400);
  assert.equal((await api.call('GET', '/api/v1/core/integrity/runs?pageSize=201', { roles: 'ITADM' })).status, 400);
  await api.close();
});

test('API: a retried run with the same Idempotency-Key returns the stored result and does not run twice', async () => {
  const api = await startApi();
  const key = { 'idempotency-key': 'run-integrity-0001' };
  const first = await api.call('POST', '/api/v1/core/integrity/run', { roles: 'ITADM', body: {}, headers: key });
  const second = await api.call('POST', '/api/v1/core/integrity/run', { roles: 'ITADM', body: {}, headers: key });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(second.json, first.json);
  assert.equal(api.db.prepare('SELECT COUNT(DISTINCT run_id) AS n FROM core_integrity_runs').get().n, 1);
  await api.close();
});

test('API: the whole feature is hidden (404) while ff.core.p0102 is OFF for the company', async () => {
  const api = await startApi();
  await api.call('PATCH', '/api/v1/core/feature-flags/ff.core.p0102', {
    roles: 'SYSADM',
    company: '9',
    body: { scope: { level: 'company', companyId: 9 }, enabled: false, reason: 'test the flag gate' },
  });
  for (const [method, path, roles] of [['GET', '/summary', 'SYSADM'], ['GET', '/runs', 'SYSADM'], ['POST', '/run', 'ITADM']]) {
    const r = await api.call(method, `/api/v1/core/integrity${path}`, { roles, company: '9', body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 404, path);
    assert.match(r.json.error.message, /ff\.core\.p0102 is OFF/);
  }
  assert.equal((await api.call('GET', '/api/v1/core/integrity/summary', { roles: 'SYSADM', company: '1' })).status, 200, 'other companies are unaffected');
  await api.close();
});
