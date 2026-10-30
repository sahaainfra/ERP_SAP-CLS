// Usage: node scripts/golden.mjs [--capture]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry } from '../golden/registry.mjs';
import { captureGolden, compareGolden } from './lib/golden.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputsDir = join(root, 'golden', 'outputs');
const decisions = join(root, 'docs', 'erp', 'DECISIONS.md');

if (process.argv.includes('--capture')) {
  captureGolden(registry, outputsDir);
  console.log(`Captured ${registry.length} golden output(s). Record why in docs/erp/DECISIONS.md.`);
  process.exit(0);
}

const results = compareGolden(registry, outputsDir, existsSync(decisions) ? readFileSync(decisions, 'utf8') : '');
let failed = 0;
for (const r of results) {
  const note = r.status === 'approved' ? ` (approved: ${r.reason})` : r.hash ? ` (new sha256 ${r.hash})` : '';
  console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id}${note}`);
  if (r.status === 'changed' || r.status === 'missing') failed++;
}
if (failed) {
  console.error(`Golden comparison FAILED: ${failed} output(s) differ or are missing.`);
  process.exit(1);
}
console.log(`Golden comparison OK: ${results.length} output(s).`);
