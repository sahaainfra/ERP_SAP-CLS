// PACK-W0-01: the "verify" gate of CI fails when any needed job fails, and the workflow cannot drift away from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALWAYS, EXPECTED, FULL_ONLY, evaluateGate } from '../scripts/ci_gate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = (result, over = {}) => ({ ...Object.fromEntries(EXPECTED.map((j) => [j, { result }])), ...over });
const run = (needs, full) => spawnSync(process.execPath, [join(root, 'scripts/ci_gate.mjs')], {
  encoding: 'utf8', env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), FULL_RUN: String(full) },
});

test('every job green passes, on a full run and on a pull request', () => {
  assert.equal(evaluateGate(all('success'), { full: true }).ok, true);
  assert.equal(evaluateGate(all('success'), { full: false }).ok, true);
});

test('a failed unit job fails the gate even when it is not the last check (the bash `&&` bug of PR run #150)', () => {
  const needs = all('success', { unit: { result: 'failure' } });
  assert.equal(evaluateGate(needs, { full: false }).ok, false);
  assert.equal(evaluateGate(needs, { full: true }).ok, false);
  const r = run(needs, false);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL\s+unit\s+failure/);
});

test('each needed job alone, failed or cancelled, fails a full run', () => {
  for (const job of EXPECTED) {
    for (const bad of ['failure', 'cancelled', '']) {
      assert.equal(evaluateGate(all('success', { [job]: { result: bad } }), { full: true }).ok, false, `${job}=${bad || '(empty)'}`);
    }
  }
});

test('long jobs may be skipped on an ordinary pull request, never on main or with full-ci', () => {
  const skipped = all('success', Object.fromEntries(FULL_ONLY.map((j) => [j, { result: 'skipped' }])));
  assert.equal(evaluateGate(skipped, { full: false }).ok, true);
  assert.equal(evaluateGate(skipped, { full: true }).ok, false);
  // the quick jobs may never be skipped
  for (const job of ALWAYS) assert.equal(evaluateGate(all('success', { [job]: { result: 'skipped' } }), { full: false }).ok, false, job);
  // a long job that started on a pull request and failed still fails it
  assert.equal(evaluateGate({ ...skipped, dast: { result: 'failure' } }, { full: false }).ok, false);
});

test('fails closed: a job missing from needs, an unknown job that failed, bad input', () => {
  const missing = all('success'); delete missing['container-scan'];
  assert.equal(evaluateGate(missing, { full: true }).ok, false);
  assert.equal(evaluateGate(all('success', { 'new-job': { result: 'failure' } }), { full: true }).ok, false);
  assert.equal(evaluateGate({}, { full: false }).ok, false);
  assert.equal(run(all('success'), 'maybe').status, 1, 'FULL_RUN must be true or false');
  const r = spawnSync(process.execPath, [join(root, 'scripts/ci_gate.mjs')], { encoding: 'utf8', env: { ...process.env, NEEDS_JSON: 'not json', FULL_RUN: 'true' } });
  assert.equal(r.status, 1);
  assert.equal(run(all('success'), true).status, 0);
});

test('the workflow: verify needs every gated job, runs the script and no job it needs is missing from the workflow', () => {
  const yml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const block = yml.split(/\n {2}verify:\n/)[1]?.split(/\n {2}[a-z][a-z-]*:\n/)[0];
  assert.ok(block, 'the verify job exists');
  const needs = block.match(/needs:\s*\[([^\]]*)\]/)?.[1].split(',').map((s) => s.trim()) ?? [];
  assert.deepEqual([...needs].sort(), [...EXPECTED].sort(), 'verify needs exactly the jobs the gate checks');
  assert.match(block, /if:\s*always\(\)/, 'verify runs when a needed job failed');
  assert.match(block, /run:\s*node scripts\/ci_gate\.mjs/);
  assert.match(block, /NEEDS_JSON:\s*\$\{\{\s*toJSON\(needs\)\s*\}\}/);
  assert.doesNotMatch(block, /test "\$\{\{ needs\.[a-z-]+\.result \}\}" = success &&/, 'no shell `&&` chain decides the gate');
  for (const job of EXPECTED) assert.match(yml, new RegExp(`\\n {2}${job}:\\n`), `job ${job} is defined`);
  // every gated job other than the quick ones carries the same "long job" condition, so FULL_RUN describes them truthfully
  const cond = "github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'full-ci')";
  for (const job of FULL_ONLY) {
    const body = yml.split(new RegExp(`\\n {2}${job}:\\n`))[1].split(/\n {2}[a-z][a-z-]*:\n/)[0];
    assert.ok(body.includes(`if: ${cond}`), `${job} runs on main, on a manual run and with full-ci`);
  }
  assert.ok(block.includes(`FULL_RUN: \${{ ${cond} }}`));
});
