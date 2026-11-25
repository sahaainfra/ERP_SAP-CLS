import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Part 30.07: the results of a sweep (e2e/tst-a11y-sweep.spec.js, docs/erp/a11y/a11y-<width>.json) posted to the validation results — by the
// sweep itself and by the page test, which loads the committed sweeps into its own company.
/** The results into one run of the validation results, in batches under the API's 50 kB body limit (null when the part is not mounted). */
export async function postSweep(request, headers, head, results) {
  const slim = results.map(({ route, loadMs, violations, overflowPx, smallTargetCount, tinyInputs, error }) => ({ route, loadMs, overflowPx, smallTargets: smallTargetCount ?? 0, tinyInputs: tinyInputs ?? 0, ...(error ? { error } : {}),
    violations: violations.slice(0, 60).map((v) => ({ rule: v.rule, impact: v.impact, help: v.help.slice(0, 120), nodes: v.nodes, targets: v.targets.slice(0, 1).map((t) => t.slice(0, 100)) })) }));
  const batches = []; let cur = []; let size = 0;
  for (const r of slim) { const n = JSON.stringify(r).length; if (cur.length && (size + n > 38_000 || cur.length >= 150)) { batches.push(cur); cur = []; size = 0; } cur.push(r); size += n; }
  if (cur.length) batches.push(cur);
  let runId = null; let out = null;
  for (const [i, b] of batches.entries()) {
    const res = await request.post('/api/v1/tst/a11y/runs', { headers: { ...headers, 'idempotency-key': randomUUID() }, data: { ...head, ...(runId ? { runId } : {}), final: i === batches.length - 1, results: b } });
    if (res.status() === 404) return null;
    expect(res.status(), await res.text()).toBe(201);
    out = (await res.json()).data; runId = out.id;
  }
  return out;
}
