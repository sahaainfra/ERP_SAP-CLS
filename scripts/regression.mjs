// npm run erp:regression [-- --skip-e2e] [--only id,id] [--with-audit]
// The local and CI quality gate (FR-01 of 00.02 and 00.03). Stages, in order: lint, type check,
// unit/API/permission tests with coverage, coverage gate for changed files, migration up/down check, schema lint,
// data-integrity suite, schema-diff, golden outputs, secret scan, client build and Playwright E2E (desktop + mobile).
// Dependency audit needs the network: add --with-audit (CI runs `npm run erp:audit` as its own job).
// Writes reports/regression/report.json and report.html; exits 1 if any stage fails.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const skipE2e = args.includes('--skip-e2e');
const onlyFlag = args.indexOf('--only');
const only = onlyFlag >= 0 ? new Set(args[onlyFlag + 1].split(',')) : null;
const node = process.execPath;
const bin = (pkg, file) => join(root, 'node_modules', pkg, file);

const all = [
  { id: 'lint', title: 'ESLint', cmd: [node, bin('eslint', 'bin/eslint.js'), '.'] },
  { id: 'typecheck', title: 'TypeScript check (incremental, non-strict)', cmd: [node, bin('typescript', 'bin/tsc'), '-p', 'tsconfig.json', '--noEmit'] },
  { id: 'unit-api', title: 'Unit, API and permission tests (with coverage)', cmd: [node, 'scripts/test_coverage.mjs'] },
  { id: 'coverage-gate', title: 'Coverage gate for changed files', cmd: [node, 'scripts/coverage_gate.mjs'] },
  { id: 'migration-check', title: 'Migration up/down check on a schema copy', cmd: [node, 'scripts/migration_check.mjs'] },
  { id: 'db-lint', title: 'Schema lint (standard columns, FK indexes, integer money, registry, baseline)', cmd: [node, 'scripts/db_lint.mjs'] },
  { id: 'route-check', title: 'Route registry: every route declared with its permission (part 02.07)', cmd: [node, 'scripts/route_check.mjs'] },
  { id: 'db-check', title: 'Data-integrity suite (Critical failures block)', cmd: [node, 'scripts/db_check.mjs', '--fresh'] },
  { id: 'schema-diff', title: 'Schema-diff against locked baseline', cmd: [node, 'scripts/schema_diff.mjs'] },
  { id: 'golden', title: 'Golden-output comparison', cmd: [node, 'scripts/golden.mjs'] },
  { id: 'secret-scan', title: 'Secret scan', cmd: [node, 'scripts/secret_scan.mjs'] },
];
if (args.includes('--with-audit')) {
  all.push({ id: 'audit', title: 'Dependency audit (high and critical block)', cmd: [process.platform === 'win32' ? 'npm.cmd' : 'npm', 'audit', '--audit-level=high'], shell: true });
}
if (!skipE2e) {
  all.push({ id: 'build', title: 'Client build', cmd: [node, bin('vite', 'bin/vite.js'), 'build'] });
  all.push({ id: 'e2e', title: 'Playwright E2E (desktop and mobile)', cmd: [node, bin('@playwright/test', 'cli.js'), 'test'] });
}
const steps = only ? all.filter((s) => only.has(s.id)) : all;

const results = [];
for (const s of steps) {
  const started = Date.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: root, encoding: 'utf8', shell: Boolean(s.shell), env: { ...process.env, NODE_ENV: 'test' } });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const passed = r.status === 0;
  results.push({ id: s.id, title: s.title, passed, durationMs: Date.now() - started, output: output.slice(-6000) });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${s.title} (${Date.now() - started} ms)`);
  if (!passed) console.log(output.split('\n').slice(-25).join('\n'));
}
if (skipE2e) console.log('SKIP  Playwright E2E (--skip-e2e)');

const ok = results.length > 0 && results.every((r) => r.passed);
const dir = process.env.ERP_REPORT_DIR ? resolve(process.env.ERP_REPORT_DIR) : join(root, 'reports', 'regression');
mkdirSync(dir, { recursive: true });
const summary = { passed: ok, skippedE2e: skipE2e, steps: results.map(({ output: _o, ...rest }) => rest) };
writeFileSync(join(dir, 'report.json'), `${JSON.stringify({ ...summary, details: results }, null, 2)}\n`);
const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
writeFileSync(
  join(dir, 'report.html'),
  `<!doctype html><meta charset="utf-8"><title>ERP regression report</title>
<style>body{font:14px system-ui;margin:2rem;max-width:60rem}.p{color:#17663b}.f{color:#a3241b}pre{background:#eef1f4;padding:.75rem;overflow:auto;max-height:16rem}</style>
<h1>Regression report: <span class="${ok ? 'p' : 'f'}">${ok ? 'PASS' : 'FAIL'}</span></h1>
${skipE2e ? '<p><strong>E2E was skipped.</strong></p>' : ''}
${results.map((r) => `<h2 class="${r.passed ? 'p' : 'f'}">${r.passed ? 'PASS' : 'FAIL'} - ${esc(r.title)} <small>${r.durationMs} ms</small></h2><details><summary>Output</summary><pre>${esc(r.output)}</pre></details>`).join('\n')}`,
);
console.log(`\nRegression ${ok ? 'PASSED' : 'FAILED'}. Report: ${dir}`);
process.exit(ok ? 0 : 1);
