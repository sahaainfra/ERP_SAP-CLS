// PACK-W0-01: the "verify" gate of .github/workflows/ci.yml, as a script that can be tested.
//
// The gate used to be two shell lines under `bash -e`: `test unit = success && test client = success`. Bash does not stop on a
// failed command that is not the last of an `&&` list, so a failed unit job still let the gate pass (PR run #150: unit=failure,
// verify=success). The decision is now made here, one job at a time, and tests/ci-gate.test.js proves that any failed, cancelled
// or missing job fails it.
//
// Usage in CI:  NEEDS_JSON='${{ toJSON(needs) }}' FULL_RUN=true|false node scripts/ci_gate.mjs
//   FULL_RUN=true on a push to main, a manual run and a pull request with the full-ci label: every job must succeed.
//   FULL_RUN=false on an ordinary pull request: the long jobs may be "skipped" (they do not start), never failed or cancelled.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Jobs that run on every pull request and must always succeed. */
export const ALWAYS = ['unit', 'client'];
/** Jobs that run on main, on a manual run and with the full-ci label; skipped on an ordinary pull request. */
export const FULL_ONLY = ['e2e', 'clock', 'dast', 'perf-smoke', 'container-scan', 'deploy-rehearsal'];
export const EXPECTED = [...ALWAYS, ...FULL_ONLY];

/**
 * Decides the gate. `needs` is GitHub's `needs` context ({ job: { result } }); `full` says whether the long jobs had to run.
 * Fails closed: a job missing from `needs`, an unknown job, an empty result or anything other than success/skipped fails.
 * @returns {{ ok: boolean, rows: { job: string, result: string, required: string, ok: boolean }[] }}
 */
export function evaluateGate(needs, { full }) {
  const rows = [];
  const seen = new Set(Object.keys(needs ?? {}));
  for (const job of EXPECTED) {
    const result = needs?.[job]?.result ?? 'missing';
    const required = ALWAYS.includes(job) || full ? 'success' : 'success or skipped';
    const ok = result === 'success' || (required === 'success or skipped' && result === 'skipped');
    rows.push({ job, result, required, ok });
    seen.delete(job);
  }
  // a job added to `needs` but not to this list is held to "success" until it is classified here
  for (const job of seen) {
    const result = needs[job]?.result ?? 'missing';
    rows.push({ job, result, required: 'success (unclassified)', ok: result === 'success' });
  }
  return { ok: rows.length > 0 && rows.every((r) => r.ok), rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let needs;
  try { needs = JSON.parse(process.env.NEEDS_JSON ?? ''); } catch { console.error('ci_gate: NEEDS_JSON is missing or not JSON'); process.exit(1); }
  const flag = String(process.env.FULL_RUN ?? '').trim();
  if (flag !== 'true' && flag !== 'false') { console.error(`ci_gate: FULL_RUN must be "true" or "false", got "${flag}"`); process.exit(1); }
  const { ok, rows } = evaluateGate(needs, { full: flag === 'true' });
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.job.padEnd(18)} ${r.result.padEnd(10)} (needs ${r.required})`);
  console.log(ok ? 'verify: every needed job passed' : 'verify: FAILED, see the rows marked FAIL');
  process.exit(ok ? 0 : 1);
}
