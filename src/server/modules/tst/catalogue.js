import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { ROLE_TEMPLATES } from '../../platform/authz/templates.js';
import { transaction } from '../../platform/db/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { ROUTE_POLICY } from '../../platform/security/route-policy.js';
import { workflowTypes } from '../../platform/workflow/registry.js';
import { SANDBOX_FLAG } from './sandbox.js';

/**
 * Part 30.04 FR-01, FR-02: the test catalogue and the coverage of the regression programme.
 *
 * The catalogue is read from the repository itself: every `test(...)` of tests/*.test.js and e2e/*.spec.js is one entry (tst_test_catalogue)
 * with a stable test ID, the part it belongs to, the requirement references its name carries (FR-, BR-, T-, AC-, IT-, D-…), its type and
 * whether it is automated (all of them are; a manual UAT case is recorded with automated = 0). A sync adds new tests, renames nothing and
 * retires tests that are gone. Each run of a suite (CI, a developer, the sandbox) is posted as a run (tst_test_runs, from the JUnit output
 * of node --test or Playwright, scripts/test_results.mjs) and sets the last result of every test it ran.
 *
 * Coverage: by part (every part of PROGRESS.csv, its tests, its requirement references, its last results; a delivered part without a test
 * is a gap), by workflow document type (every registered type is exercised by tests/tst-workflow-coverage.test.js and, where named, by its
 * module's tests) and by permission (every role against the key endpoint of each module: tests/tst-permission-matrix.test.js; every route
 * against every role: the 30.05 authorisation matrix).
 */
export const TYPES = ['UNIT', 'API', 'WORKFLOW', 'PERMISSION', 'E2E', 'VISUAL', 'ACCESSIBILITY', 'PERFORMANCE', 'SECURITY', 'INTEGRATION', 'DATA'];
const REF = /\b(?:T-UI-\d+|FR-\d+[a-z]?|BR-\d+|T-\d+|AC-\d+|IT-\d+(?:\.\d+)?|D-\d+|NFR-\d+|Section \d+)\b/g;
const iso = (d = new Date()) => d.toISOString();
/** A part of the programme: 30.04, or one of the 166.x verification parts. */
export const PART = /^(?:\d{2}\.\d{2}|166\.\d)$/;
const sha = (s) => createHash('sha1').update(s).digest('hex');

integrityRegistry.register({ statuses: { tst_test_runs: ['DONE', 'FAILED'], tst_test_catalogue: ['ACTIVE', 'RETIRED'] } });

/** The test names of a file: test('…'), test("…"), test(`…`) and test.skip/only, at any depth. */
export function testNames(src) {
  const out = [];
  const re = /\btest(?:\.(?:skip|only|todo))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const m of src.matchAll(re)) out.push(m[2].replace(/\\(['"`\\])/g, '$1').replace(/\s+/g, ' ').trim());
  return out;
}

/** The part of a test file: a part number in its name (p2403), a "Part xx.yy" header, the flag it uses most, or the first completion report naming it. */
export function partOf(file, src, mentions) {
  const byName = /p(\d{2})(\d{2})\b/.exec(basename(file)) ?? /p(166)0(\d)\b/.exec(basename(file));
  if (byName) return `${byName[1]}.${byName[2]}`;
  const header = /^\/\/\s*Parts?\s+(\d{2}\.\d{2}|166\.\d)\b/m.exec(src.split('\n').slice(0, 30).join('\n'));
  if (header) return header[1];
  const counts = new Map();
  for (const m of src.matchAll(/ff\.[a-z0-9]+\.p(?:(\d{2})(\d{2})|(166)0(\d))\b/g)) { const k = m[1] ? `${m[1]}.${m[2]}` : `${m[3]}.${m[4]}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
  if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return mentions.get(file) ?? null;
}

export function typeOf(file, name, src) {
  const n = name.toLowerCase(); const f = file.toLowerCase();
  if (f.startsWith('e2e/')) {
    if (/a11y|accessib|axe/.test(f + n)) return 'ACCESSIBILITY';
    if (/visual|baseline|screenshot/.test(f + n)) return 'VISUAL';
    if (/perf|load/.test(f)) return 'PERFORMANCE';
    return 'E2E';
  }
  if (/perf|load|p95|burst|volume|\d+k\b/.test(f + ' ' + n)) return 'PERFORMANCE';
  if (/secur|secret|csrf|xss|inject|sast|dast|authz-matrix|pentest|dpdp/.test(f + ' ' + n)) return 'SECURITY';
  if (/permission|\broles?\b|403|ac-03|segregation|maker-checker/.test(n) || /authz|permission/.test(f)) return 'PERMISSION';
  if (/workflow|approv|submit|reject|return/.test(n)) return 'WORKFLOW';
  if (/integration|event|thread|hand-off|propagat|outbox/.test(n) || /integration|events/.test(f)) return 'INTEGRATION';
  if (/migration|schema|integrity|baseline|seed|backfill|reconcil/.test(f + ' ' + n)) return 'DATA';
  return /startApi|call\(/.test(src) ? 'API' : 'UNIT';
}

/** The catalogue as the repository has it now. */
export function scanCatalogue(root = process.cwd()) {
  const mentions = new Map();
  const comp = join(root, 'docs', 'erp', 'COMPLETION');
  if (existsSync(comp)) {
    for (const f of readdirSync(comp).filter((x) => /^\d{2}\.\d{2}\.md$/.test(x)).sort()) {
      const text = readFileSync(join(comp, f), 'utf8');
      for (const m of text.matchAll(/\b((?:tests\/[\w.-]+\.test\.js)|(?:e2e\/[\w.-]+\.spec\.js))/g)) if (!mentions.has(m[1])) mentions.set(m[1], f.slice(0, 5));
    }
  }
  const out = [];
  for (const [dir, suffix] of [['tests', '.test.js'], ['e2e', '.spec.js']]) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((x) => x.endsWith(suffix)).sort()) {
      const file = `${dir}/${f}`;
      const src = readFileSync(join(abs, f), 'utf8');
      const part = partOf(file, src, mentions);
      const seen = new Map();
      for (const name of testNames(src)) {
        const n = (seen.get(name) ?? 0) + 1; seen.set(name, n);
        const testId = `${f.replace(suffix, '')}#${sha(name).slice(0, 8)}${n > 1 ? `-${n}` : ''}`;
        const refs = [...new Set(name.match(REF) ?? [])];
        out.push({ testId, file, name: name.slice(0, 500), partId: part, requirementRef: refs.length ? refs.join(' ') : null, type: typeOf(file, name, src), automated: true });
      }
    }
  }
  return out;
}

/** The parts of the programme (docs/erp/PROGRESS.csv): id, title, module and status. */
export function programmeParts(root = process.cwd()) {
  const file = join(root, 'docs', 'erp', 'PROGRESS.csv');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n').slice(1).filter(Boolean);
  const cells = (line) => { const out = []; let cur = ''; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const parts = new Map();
  for (const c of lines.map(cells)) if (PART.test(c[1])) parts.set(c[1], { partId: c[1], title: c[2], module: c[3], status: c[7] });
  return [...parts.values()];
}

export function createCatalogueService(context, { root = process.cwd() } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, SANDBOX_FLAG)) throw notFound('The test programme and sandbox are not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const view = (r) => ({ id: r.id, testId: r.test_id, partId: r.part_id, requirementRef: r.requirement_ref, type: r.test_type, automated: Boolean(r.automated), file: r.file, name: r.name, lastResult: r.last_result, lastRunAt: r.last_run_at, lastRunId: r.last_run_id, lastDurationMs: r.last_duration_ms, status: r.status });

  /** FR-01: the catalogue is brought in line with the repository (new tests added, changed ones updated, gone ones retired). */
  function sync(actor) {
    guard(actor, 'tst.catalogue.sync');
    const found = scanCatalogue(root);
    return transaction(db, () => {
      const existing = new Map(db.prepare('SELECT * FROM tst_test_catalogue WHERE company_id = ?').all(actor.companyId).map((r) => [r.test_id, r]));
      let added = 0; let updated = 0; let retired = 0;
      const ins = db.prepare("INSERT INTO tst_test_catalogue (company_id, test_id, part_id, requirement_ref, test_type, automated, file, name, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 'repository')");
      const upd = db.prepare("UPDATE tst_test_catalogue SET part_id = ?, requirement_ref = ?, test_type = ?, file = ?, name = ?, status = 'ACTIVE', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?");
      const ids = new Set();
      for (const t of found) {
        ids.add(t.testId);
        const cur = existing.get(t.testId);
        if (!cur) { ins.run(actor.companyId, t.testId, t.partId, t.requirementRef, t.type, 1, t.file, t.name, actor.user); added += 1; continue; }
        if (cur.part_id !== t.partId || cur.requirement_ref !== t.requirementRef || cur.test_type !== t.type || cur.file !== t.file || cur.name !== t.name || cur.status !== 'ACTIVE') { upd.run(t.partId, t.requirementRef, t.type, t.file, t.name, iso(), actor.user, cur.id); updated += 1; }
      }
      for (const [tid, r] of existing) if (!ids.has(tid) && r.status === 'ACTIVE' && r.automated) { db.prepare("UPDATE tst_test_catalogue SET status = 'RETIRED', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(iso(), actor.user, r.id); retired += 1; }
      const out = { tests: found.length, added, updated, retired, files: new Set(found.map((t) => t.file)).size };
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_test_catalogue', entityId: 'sync', action: 'sync', newValues: out, actor: actor.user });
      return out;
    });
  }

  /** A run of a suite and its results (from the JUnit output). Results are matched to the catalogue by file and name. */
  function recordRun(actor, { source, suite, commitRef = null, startedAt = null, runId = null, results }) {
    guard(actor, 'tst.catalogue.sync');
    return transaction(db, () => {
      const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
      for (const r of results) counts[r.result] += 1;
      const now = iso();
      let id; let runNo;
      if (runId) {
        // a large run is posted in batches: each further batch names the run it adds to
        const cur = db.prepare('SELECT * FROM tst_test_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(runId, actor.companyId);
        if (!cur) throw notFound('That test run does not exist.');
        if (cur.suite !== suite || cur.run_source !== source || cur.requested_by !== actor.user) throw badRequest('The batch belongs to another run.', [{ field: 'runId', message: `Run ${cur.run_no} is ${cur.run_source} ${cur.suite} by ${cur.requested_by}` }]);
        db.prepare("UPDATE tst_test_runs SET total_count = total_count + ?, passed_count = passed_count + ?, failed_count = failed_count + ?, skipped_count = skipped_count + ?, status = CASE WHEN failed_count + ? > 0 THEN 'FAILED' ELSE 'DONE' END, finished_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(results.length, counts.PASS, counts.FAIL, counts.SKIP, counts.FAIL, now, now, cur.id);
        id = cur.id; runNo = cur.run_no;
      } else {
        const n = (db.prepare('SELECT COUNT(*) AS n FROM tst_test_runs WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
        runNo = `TRN-${String(n).padStart(6, '0')}`;
        id = Number(db.prepare("INSERT INTO tst_test_runs (company_id, run_no, run_source, suite, commit_ref, started_at, finished_at, total_count, passed_count, failed_count, skipped_count, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'junit')")
          .run(actor.companyId, runNo, source, suite, commitRef, startedAt ?? now, now, results.length, counts.PASS, counts.FAIL, counts.SKIP, counts.FAIL ? 'FAILED' : 'DONE', actor.user, actor.user).lastInsertRowid);
      }
      const find = db.prepare("SELECT id FROM tst_test_catalogue WHERE company_id = ? AND file = ? AND name = ? AND status = 'ACTIVE' ORDER BY id LIMIT 1");
      const set = db.prepare('UPDATE tst_test_catalogue SET last_result = ?, last_run_id = ?, last_run_at = ?, last_duration_ms = ?, updated_at = ?, version = version + 1 WHERE id = ?');
      const unmatched = [];
      for (const r of results) {
        const name = r.name.replace(/\s+/g, ' ').trim();
        const row = find.get(actor.companyId, r.file, name.slice(0, 500));
        if (!row) { unmatched.push(`${r.file}: ${name.slice(0, 120)}`); continue; }
        set.run(r.result, id, now, r.durationMs ?? null, now, row.id);
      }
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_test_runs', entityId: id, action: 'record', newValues: { runNo, source, suite, total: results.length, failed: counts.FAIL, unmatched: unmatched.length }, actor: actor.user });
      return { id, runNo, source, suite, total: results.length, passed: counts.PASS, failed: counts.FAIL, skipped: counts.SKIP, matched: results.length - unmatched.length, unmatched: unmatched.length, unmatchedSample: unmatched.slice(0, 20) };
    });
  }

  const filters = (q) => {
    const where = ['company_id = ?']; const p = [];
    if (q.status !== 'ALL') { where.push('status = ?'); p.push(q.status ?? 'ACTIVE'); }
    if (q.part) { where.push('part_id = ?'); p.push(q.part); }
    if (q.type) { where.push('test_type = ?'); p.push(q.type); }
    if (q.result === 'NOT_RUN') where.push('last_result IS NULL'); else if (q.result) { where.push('last_result = ?'); p.push(q.result); }
    if (q.q) { where.push("(name LIKE ? ESCAPE '\\' OR file LIKE ? ESCAPE '\\' OR test_id LIKE ? ESCAPE '\\' OR requirement_ref LIKE ? ESCAPE '\\')"); const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; p.push(like, like, like, like); }
    return { where: where.join(' AND '), p };
  };

  /** FR-01 the coverage report: totals, by type, by part (with the gaps), workflow and permission coverage, recent runs, and a page of tests. */
  function coverage(actor, q = {}) {
    guard(actor, 'tst.catalogue.view');
    const c = actor.companyId;
    const totals = db.prepare("SELECT COUNT(*) AS tests, SUM(automated) AS automated, SUM(last_result = 'PASS') AS passed, SUM(last_result = 'FAIL') AS failed, SUM(last_result = 'SKIP') AS skipped, SUM(last_result IS NULL) AS notRun, SUM(requirement_ref IS NOT NULL) AS traced, COUNT(DISTINCT file) AS files FROM tst_test_catalogue WHERE company_id = ? AND status = 'ACTIVE'").get(c);
    const byType = db.prepare("SELECT test_type AS type, COUNT(*) AS tests, SUM(last_result = 'PASS') AS passed, SUM(last_result = 'FAIL') AS failed FROM tst_test_catalogue WHERE company_id = ? AND status = 'ACTIVE' GROUP BY test_type ORDER BY tests DESC").all(c);
    const perPart = new Map(db.prepare("SELECT part_id AS partId, COUNT(*) AS tests, SUM(last_result = 'PASS') AS passed, SUM(last_result = 'FAIL') AS failed, SUM(last_result IS NULL) AS notRun, GROUP_CONCAT(requirement_ref, ' ') AS refs FROM tst_test_catalogue WHERE company_id = ? AND status = 'ACTIVE' AND part_id IS NOT NULL GROUP BY part_id").all(c).map((r) => [r.partId, r]));
    const parts = programmeParts(root).map((p) => {
      const t = perPart.get(p.partId);
      const refs = t?.refs ? [...new Set(t.refs.split(/\s+/).filter(Boolean))] : [];
      const delivered = /ready|done|complete|accepted/i.test(p.status ?? '');
      return { ...p, tests: t?.tests ?? 0, passed: t?.passed ?? 0, failed: t?.failed ?? 0, notRun: t?.notRun ?? 0, requirements: refs.length, requirementRefs: refs.slice(0, 40), delivered, gap: delivered && !(t?.tests > 0), status: p.status };
    });
    const delivered = parts.filter((p) => p.delivered);
    const covered = delivered.filter((p) => p.tests > 0).length;
    const unassigned = db.prepare("SELECT COUNT(*) AS n FROM tst_test_catalogue WHERE company_id = ? AND status = 'ACTIVE' AND part_id IS NULL").get(c).n;
    // FR-02 workflow coverage: every registered document type, and whether a module test names it as well as the contract test
    const wfFile = join(root, 'tests', 'tst-workflow-coverage.test.js');
    const contract = existsSync(wfFile);
    const corpus = contract ? readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.js') && f !== 'tst-workflow-coverage.test.js').map((f) => readFileSync(join(root, 'tests', f), 'utf8')).join('\n') : '';
    const wfTypes = workflowTypes.list().map((w) => ({ docType: w.docType, label: w.label ?? w.docType, processOwner: w.processOwner, contract, named: corpus.includes(w.docType) }));
    const workflow = { types: wfTypes.length, contract: wfTypes.filter((w) => w.contract).length, named: wfTypes.filter((w) => w.named).length, pct: wfTypes.length ? Math.round((wfTypes.filter((w) => w.contract).length / wfTypes.length) * 1000) / 10 : 100, rows: wfTypes };
    // FR-02 permission coverage: the role × key-endpoint matrix and the route × role matrix (30.05)
    const guarded = ROUTE_POLICY.filter((r) => r.g === 'permission').length;
    const roles = ROLE_TEMPLATES.length;
    const keyEndpoints = keyEndpointsOf().length;
    const matrixTest = existsSync(join(root, 'tests', 'tst-permission-matrix.test.js'));
    const authzTest = existsSync(join(root, 'tests', 'sct-authz-matrix.test.js'));
    const lastOf = (file) => db.prepare("SELECT MIN(last_result = 'PASS') AS ok, MAX(last_run_at) AS at, COUNT(*) AS n FROM tst_test_catalogue WHERE company_id = ? AND file = ? AND status = 'ACTIVE'").get(c, file);
    const permission = { roles, keyEndpoints, roleMatrixCells: roles * keyEndpoints, matrixTest, guardedRoutes: guarded, routes: ROUTE_POLICY.length, authzTest, roleMatrix: lastOf('tests/tst-permission-matrix.test.js'), authzMatrix: lastOf('tests/sct-authz-matrix.test.js') };
    const runs = db.prepare('SELECT * FROM tst_test_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 12').all(c).map((r) => ({ id: r.id, runNo: r.run_no, source: r.run_source, suite: r.suite, commitRef: r.commit_ref, startedAt: r.started_at, total: r.total_count, passed: r.passed_count, failed: r.failed_count, skipped: r.skipped_count, status: r.status }));
    const { where, p } = filters(q);
    const pageSize = q.pageSize ?? 25; const pg = q.page ?? 1;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM tst_test_catalogue WHERE ${where}`).get(c, ...p).n;
    const rows = db.prepare(`SELECT * FROM tst_test_catalogue WHERE ${where} ORDER BY part_id IS NULL, part_id, file, id LIMIT ? OFFSET ?`).all(c, ...p, pageSize, (pg - 1) * pageSize).map(view);
    return {
      totals: { ...totals, automated: totals.automated ?? 0, passed: totals.passed ?? 0, failed: totals.failed ?? 0, skipped: totals.skipped ?? 0, notRun: totals.notRun ?? 0, traced: totals.traced ?? 0, unassigned, parts: parts.length, delivered: delivered.length, partsCovered: covered, partCoveragePct: delivered.length ? Math.round((covered / delivered.length) * 1000) / 10 : 100, suiteGreen: totals.tests > 0 && !(totals.failed > 0) && !(totals.notRun > 0) },
      byType, parts: q.gaps ? parts.filter((x) => x.gap) : parts, workflow, permission, runs,
      can: { sync: hasPermissionAnywhere(actor, 'tst.catalogue.sync'), sandbox: hasPermissionAnywhere(actor, 'tst.sandbox.view'), manage: hasPermissionAnywhere(actor, 'tst.sandbox.manage') },
      tests: { rows, total, page: pg, pageSize },
    };
  }

  function test(actor, testId) {
    guard(actor, 'tst.catalogue.view');
    const r = db.prepare('SELECT * FROM tst_test_catalogue WHERE company_id = ? AND test_id = ?').get(actor.companyId, testId);
    if (!r) throw notFound('That test is not in the catalogue.');
    const run = r.last_run_id ? db.prepare('SELECT run_no, run_source, suite, commit_ref, started_at FROM tst_test_runs WHERE id = ?').get(r.last_run_id) : null;
    return { ...view(r), lastRun: run ? { runNo: run.run_no, source: run.run_source, suite: run.suite, commitRef: run.commit_ref, startedAt: run.started_at } : null };
  }

  /** A manual test case (UAT, exploratory) catalogued next to the automated ones. */
  function addManual(actor, b) {
    guard(actor, 'tst.catalogue.sync');
    if (!PART.test(b.partId)) throw badRequest('The part must look like 30.04.', [{ field: 'partId', message: 'Like 30.04' }]);
    const testId = `manual#${sha(`${b.partId}:${b.name}`).slice(0, 8)}`;
    if (db.prepare('SELECT 1 FROM tst_test_catalogue WHERE company_id = ? AND test_id = ?').get(actor.companyId, testId)) throw badRequest('That manual test is already in the catalogue.', [{ field: 'name', message: 'Already catalogued' }]);
    const id = Number(db.prepare("INSERT INTO tst_test_catalogue (company_id, test_id, part_id, requirement_ref, test_type, automated, file, name, last_result, last_run_at, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, 0, 'manual', ?, ?, ?, 'ACTIVE', ?, 'manual')")
      .run(actor.companyId, testId, b.partId, b.requirementRef ?? null, b.type, b.name, b.result ?? null, b.result ? iso() : null, actor.user).lastInsertRowid);
    writeAudit(db, { companyId: actor.companyId, entity: 'tst_test_catalogue', entityId: id, action: 'create', newValues: b, actor: actor.user });
    return test(actor, testId);
  }

  function exportCatalogue(actor, q, format) {
    guard(actor, 'tst.catalogue.view');
    const { where, p } = filters(q);
    const rows = db.prepare(`SELECT * FROM tst_test_catalogue WHERE ${where} ORDER BY part_id IS NULL, part_id, file, id`).all(actor.companyId, ...p).map(view).map((t) => ({ testId: t.testId, part: t.partId ?? '', refs: t.requirementRef ?? '', type: t.type, automated: t.automated ? 'yes' : 'no', file: t.file, name: t.name, result: t.lastResult ?? 'not run', at: t.lastRunAt ?? '' }));
    const columns = [['testId', 'Test ID'], ['part', 'Part'], ['refs', 'Requirements'], ['type', 'Type'], ['automated', 'Automated'], ['file', 'File'], ['name', 'Test'], ['result', 'Last result'], ['at', 'Last run']].map(([key, label]) => ({ key, label }));
    const buffer = writeExport(format, { columns, rows, title: 'Test catalogue and results', sheetName: 'Tests', footer: [`${rows.length} tests · ${rows.filter((r) => r.result === 'PASS').length} pass · ${rows.filter((r) => r.result === 'FAIL').length} fail · ${rows.filter((r) => r.result === 'not run').length} not run`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'tst.catalogue', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `test-catalogue.${format}` };
  }

  return { sync, recordRun, coverage, test, addManual, exportCatalogue };
}

/** The key endpoint of each module for the role × endpoint matrix: its first permission-guarded list (a GET without a path parameter). */
export function keyEndpointsOf(policy = ROUTE_POLICY) {
  const seen = new Map();
  for (const r of policy) {
    if (r.m !== 'GET' || r.g !== 'permission' || r.p.includes(':') || /export|download|pdf|xlsx|csv/.test(r.p)) continue;
    const mod = r.p.split('/')[3];
    if (!seen.has(mod)) seen.set(mod, r);
  }
  return [...seen.values()];
}

/** The results of a JUnit report (node --test --test-reporter=junit, Playwright's junit reporter) as catalogue results. */
export function parseJunit(xml, root = process.cwd()) {
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
  const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unescape(m[1]) : null; };
  const out = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const tag = m[1]; const body = m[3] ?? '';
    let file = attr(tag, 'file') ?? attr(tag, 'classname') ?? '';
    file = file.replace(/\\/g, '/'); const at = file.indexOf(root.replace(/\\/g, '/')); if (at >= 0) file = file.slice(at + root.length + 1);
    const rel = /(?:^|\/)((?:tests|e2e)\/[\w.-]+\.(?:test|spec)\.js)/.exec(file)?.[1];
    if (!rel) continue;
    const result = /<(failure|error)\b/.test(body) ? 'FAIL' : /<skipped\b/.test(body) ? 'SKIP' : 'PASS';
    let name = attr(tag, 'name') ?? '';
    name = name.replace(/^.* › /, '').replace(/\s+/g, ' ').trim();
    out.push({ file: rel, name, result, durationMs: Math.round(Number(attr(tag, 'time') ?? 0) * 1000) });
  }
  return out;
}
