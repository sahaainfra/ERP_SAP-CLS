// npm run erp:regression [-- --skip-e2e]
// Runs lint, typecheck, unit/API tests, schema-diff, golden comparison and (unless skipped) the
// Playwright E2E suite; writes reports/regression/report.json and report.html (FR-05).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipE2e = process.argv.includes('--skip-e2e');
const node = process.execPath;
const bin = (pkg, file) => join(root, 'node_modules', pkg, file);

const steps = [
  { id: 'lint', title: 'ESLint', cmd: [node, bin('eslint', 'bin/eslint.js'), '.'] },
  { id: 'typecheck', title: 'TypeScript check (incremental, non-strict)', cmd: [node, bin('typescript', 'bin/tsc'), '-p', 'tsconfig.json', '--noEmit'] },
  { id: 'unit-api', title: 'Unit and API tests', cmd: [node, '--test', '--test-reporter=spec', ...['tests/*.test.js']] },
  { id: 'schema-diff', title: 'Schema-diff against locked baseline', cmd: [node, 'scripts/schema_diff.mjs'] },
  { id: 'golden', title: 'Golden-output comparison', cmd: [node, 'scripts/golden.mjs'] },
];
if (!skipE2e) {
  steps.push({ id: 'build', title: 'Client build', cmd: [node, bin('vite', 'bin/vite.js'), 'build'] });
  steps.push({ id: 'e2e', title: 'Playwright E2E', cmd: [node, bin('@playwright/test', 'cli.js'), 'test'] });
}

const results = [];
for (const s of steps) {
  const started = Date.now();
  // The test glob is expanded by node itself on v22+, so no shell is needed.
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const passed = r.status === 0;
  results.push({ id: s.id, title: s.title, passed, durationMs: Date.now() - started, output: output.slice(-6000) });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${s.title} (${Date.now() - started} ms)`);
  if (!passed) console.log(output.split('\n').slice(-25).join('\n'));
}
if (skipE2e) console.log('SKIP  Playwright E2E (--skip-e2e)');

const ok = results.every((r) => r.passed);
const dir = join(root, 'reports', 'regression');
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
console.log(`\nRegression ${ok ? 'PASSED' : 'FAILED'}. Report: reports/regression/report.html`);
process.exit(ok ? 0 : 1);
