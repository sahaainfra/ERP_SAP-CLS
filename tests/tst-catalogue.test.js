import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';
import { parseJunit, partOf, scanCatalogue, testNames, typeOf } from '../src/server/modules/tst/catalogue.js';

// Part 30.04 FR-01 FR-02: the test catalogue mapped to parts and requirements, the runs and their results, the coverage report (parts,
// workflow document types, the permission matrices), manual cases, export and roles.
const T = '/api/v1/tst';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'idempotency-key': `cat-${Date.now().toString(36)}-${(seq += 1)}` });
const qa = { roles: 'ITADM', user: 'qa1' }; const aud = { roles: 'AUD', user: 'aud1' }; const pm = { roles: 'PM', user: 'pm1' }; const sys = { roles: 'SYSADM', user: 'sys1' };
async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); enableFlags(api.db, 1, ['ff.qa.p3004']);
  return { api, d: api.db, call: (who, method, path, body) => api.call(method, `${T}${path}`, { ...who, headers: key(), body }) };
}

test('FR-01 the scanner reads names, parts, requirement references and types from the repository', () => {
  assert.deepEqual(testNames("test('FR-01 a', () => {}); test(\"BR-02 b\", x); test(`T-01 ${'c'}`, y);\n  test.skip('d it\\'s', z);"), ['FR-01 a', 'BR-02 b', "T-01 ${'c'}", "d it's"]);
  assert.equal(partOf('tests/pay-p2403.test.js', '', new Map()), '24.03');
  assert.equal(partOf('e2e/field-p16603.spec.js', '', new Map()), '166.3');
  assert.equal(partOf('tests/x.test.js', "// Part 14.05: progress\nimport x from 'y';", new Map()), '14.05');
  assert.equal(partOf('tests/x.test.js', "flags('ff.site.p1405'); flags('ff.site.p1405'); flags('ff.inv.p1610')", new Map()), '14.05', 'the flag it uses most');
  assert.equal(partOf('tests/x.test.js', '', new Map([['tests/x.test.js', '02.07']])), '02.07', 'the first completion report naming it');
  assert.equal(typeOf('e2e/a11y.spec.js', 'x', ''), 'ACCESSIBILITY'); assert.equal(typeOf('tests/x.test.js', 'AC-03 roles: SE gets 403', 'startApi'), 'PERMISSION'); assert.equal(typeOf('tests/x.test.js', 'submit and approve the order', 'startApi'), 'WORKFLOW');
  const all = scanCatalogue();
  assert.ok(all.length > 2000, `${all.length} tests`); assert.equal(new Set(all.map((t) => t.testId)).size, all.length, 'stable unique IDs');
  assert.ok(all.filter((t) => t.partId).length / all.length > 0.9, 'nine in ten tests belong to a part');
  assert.ok(all.filter((t) => t.requirementRef).length / all.length > 0.6, 'most name the requirements they prove');
  const mine = all.filter((t) => t.file === 'tests/tst-catalogue.test.js'); assert.ok(mine.every((t) => t.partId === '30.04' && t.type !== 'E2E'));
  const xml = '<testsuites><testcase name="FR-01 a &amp; b" time="1.5" classname="test" file="/x/tests/a.test.js"/><testcase name="BR-01 c" time="0.1" classname="test" file="/x/tests/a.test.js"><failure message="no"/></testcase><testcase name="desktop › e2e/b.spec.js › t" classname="e2e/b.spec.js"><skipped/></testcase></testsuites>';
  assert.deepEqual(parseJunit(xml, '/x'), [{ file: 'tests/a.test.js', name: 'FR-01 a & b', result: 'PASS', durationMs: 1500 }, { file: 'tests/a.test.js', name: 'BR-01 c', result: 'FAIL', durationMs: 100 }, { file: 'e2e/b.spec.js', name: 't', result: 'SKIP', durationMs: 0 }]);
});

test('FR-01 FR-02 T-01 sync, a recorded run, the coverage report by part, workflow type and permission; the suite is green when every test passed', async () => {
  const t = await boot();
  const s = await t.call(qa, 'POST', '/tests/sync', {}); assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.ok(s.json.data.added > 2000); assert.equal(s.json.data.retired, 0);
  const again = (await t.call(qa, 'POST', '/tests/sync', {})).json.data; assert.deepEqual([again.added, again.updated, again.retired], [0, 0, 0], 'a second sync changes nothing');
  // a test that is gone is retired by the next sync
  t.d.prepare("INSERT INTO tst_test_catalogue (company_id, test_id, part_id, test_type, file, name) VALUES (1, 'gone#00000000', '01.01', 'API', 'tests/gone.test.js', 'an old test')").run();
  assert.equal((await t.call(qa, 'POST', '/tests/sync', {})).json.data.retired, 1);
  let c = (await t.call(aud, 'GET', '/tests?pageSize=5')).json.data;
  assert.equal(c.totals.tests, s.json.data.tests); assert.equal(c.totals.notRun, c.totals.tests); assert.equal(c.totals.suiteGreen, false, 'nothing has run');
  assert.ok(c.totals.partCoveragePct > 95, `${c.totals.partCoveragePct} % of the delivered parts have tests`);
  const p2403 = c.parts.find((p) => p.partId === '24.03'); assert.ok(p2403.tests > 0 && p2403.requirements > 0);
  assert.equal(c.workflow.pct, 100); assert.ok(c.workflow.types > 200); assert.ok(c.workflow.named > 0);
  assert.equal(c.permission.matrixTest, true); assert.equal(c.permission.roleMatrixCells, c.permission.roles * c.permission.keyEndpoints);
  // a run from the JUnit output: matched by file and name
  const mine = (await t.call(qa, 'GET', '/tests?q=tst-catalogue&pageSize=50')).json.data.tests.rows; assert.ok(mine.length >= 3);
  const run = await t.call(qa, 'POST', '/test-runs', { source: 'CI', suite: 'UNIT_API', commitRef: 'abcdef1', results: [...mine.slice(0, 50).map((m) => ({ file: m.file, name: m.name, result: 'PASS', durationMs: 120 })), { file: 'tests/nothing.test.js', name: 'not catalogued', result: 'FAIL' }] });
  assert.equal(run.status, 201, JSON.stringify(run.json)); assert.deepEqual([run.json.data.matched, run.json.data.unmatched, run.json.data.failed], [Math.min(mine.length, 50), 1, 1]);
  const one = (await t.call(aud, 'GET', `/tests/${encodeURIComponent(mine[0].testId)}`)).json.data; assert.deepEqual([one.lastResult, one.lastRun.runNo, one.lastRun.commitRef, one.lastDurationMs], ['PASS', run.json.data.runNo, 'abcdef1', 120]);
  c = (await t.call(qa, 'GET', '/tests?part=30.04&result=PASS')).json.data; assert.equal(c.tests.total, mine.length);
  assert.equal(c.runs[0].runNo, run.json.data.runNo); assert.equal(c.runs[0].status, 'FAILED');
  // T-01: the suite is green when every active test passed in its last run
  const all = t.d.prepare("SELECT file, name FROM tst_test_catalogue WHERE company_id = 1 AND status = 'ACTIVE'").all();
  let runId = null; const results = all.map((x) => ({ file: x.file, name: x.name, result: 'PASS' }));
  for (let i = 0; i < results.length; i += 150) { const b = await t.call(qa, 'POST', '/test-runs', { source: 'LOCAL', suite: 'ALL', ...(runId ? { runId } : {}), results: results.slice(i, i + 150) }); assert.equal(b.status, 201, JSON.stringify(b.json)); runId = b.json.data.id; }
  const big = t.d.prepare('SELECT total_count, passed_count FROM tst_test_runs WHERE id = ?').get(runId); assert.deepEqual([big.total_count, big.passed_count], [all.length, all.length], 'the batches make one run');
  assert.equal((await t.call(qa, 'POST', '/test-runs', { source: 'LOCAL', suite: 'E2E', runId, results: results.slice(0, 1) })).status, 400, 'a batch of another suite');
  assert.equal((await t.call(qa, 'GET', '/tests')).json.data.totals.suiteGreen, true);
  // the gaps view: delivered parts with no test
  const gaps = (await t.call(qa, 'GET', '/tests?gaps=1')).json.data.parts; assert.ok(gaps.every((p) => p.gap && p.tests === 0));
});

test('FR-01 manual cases, export with audit; roles: QA syncs and records, the auditor reads, others are refused', async () => {
  const t = await boot();
  await t.call(qa, 'POST', '/tests/sync', {});
  const m = await t.call(qa, 'POST', '/tests/manual', { partId: '30.10', name: 'UAT: a site engineer records a DPR on a phone offline and syncs', type: 'E2E', requirementRef: 'UAT-14', result: 'PASS' });
  assert.equal(m.status, 201, JSON.stringify(m.json)); assert.deepEqual([m.json.data.automated, m.json.data.file, m.json.data.lastResult], [false, 'manual', 'PASS']);
  assert.equal((await t.call(qa, 'POST', '/tests/manual', { partId: '30.10', name: 'UAT: a site engineer records a DPR on a phone offline and syncs', type: 'E2E' })).status, 400, 'once');
  assert.equal((await t.call(qa, 'POST', '/tests/manual', { partId: '3.1', name: 'A manual case with a wrong part', type: 'E2E' })).status, 400);
  assert.equal((await t.call(qa, 'POST', '/tests/sync', {})).json.data.retired, 0, 'a sync never retires a manual case');
  const x = await t.api.raw('GET', `${T}/tests/export?format=csv&part=30.04`, qa); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /tst-catalogue/);
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'report' AND entity_id = 'tst.catalogue' AND action = 'export'").get());
  assert.equal((await t.call(aud, 'GET', '/tests')).status, 200);
  assert.equal((await t.call(aud, 'POST', '/tests/sync', {})).status, 403); assert.equal((await t.call(aud, 'POST', '/test-runs', { source: 'CI', suite: 'ALL', results: [{ file: 'tests/a.test.js', name: 'x', result: 'PASS' }] })).status, 403);
  assert.equal((await t.call(pm, 'GET', '/tests')).status, 403); assert.equal((await t.call(sys, 'POST', '/tests/sync', {})).status, 201);
  assert.equal((await t.call(qa, 'GET', '/tests/nothing%2300000000')).status, 404);
  assert.equal((await t.call({ ...qa, company: '2' }, 'GET', '/tests')).status, 404, 'the flag is per company');
});

test('FR-01 the results script parses a real JUnit report of node --test', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const xml = execFileSync(process.execPath, ['--test', '--test-reporter=junit', 'tests/dates-format.test.js'], { encoding: 'utf8', env });
  const r = parseJunit(xml);
  assert.ok(r.length > 0 && r.every((x) => x.file === 'tests/dates-format.test.js' && x.result === 'PASS'));
  const names = new Set(scanCatalogue().filter((t) => t.file === 'tests/dates-format.test.js').map((t) => t.name));
  assert.ok(r.every((x) => names.has(x.name)), 'every result matches a catalogue entry');
});
