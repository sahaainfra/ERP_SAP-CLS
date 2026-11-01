// Writes the design tokens' CSS variables and Tailwind preset from the single source (part 03.01, FR-01).
// Usage: node scripts/build_tokens.mjs          write src/client/design-tokens.css and src/shared/design/tailwind.preset.js
//        node scripts/build_tokens.mjs --check  fail if either file is not what the source produces (regression and CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssFromTokens, presetSource } from '../src/shared/design/build.js';
import { contrastReport } from '../src/shared/design/contrast.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'src/shared/design/design-tokens.json'), 'utf8'));
const outputs = [[join(root, 'src/client/design-tokens.css'), cssFromTokens(tokens)], [join(root, 'src/shared/design/tailwind.preset.js'), presetSource(tokens)]];
const report = contrastReport(tokens);
if (report.failures.length) {
  console.error(`Design tokens FAILED the contrast check: ${report.failures.length} pair(s) below WCAG AA.`);
  for (const f of report.failures) console.error(`  - ${f.theme}: ${f.fg} on ${f.bg} = ${f.ratio}:1`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  const stale = outputs.filter(([file, text]) => { try { return readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text; } catch { return true; } });
  if (stale.length) {
    console.error(`Design tokens FAILED: ${stale.map(([f]) => f.replace(root, '.')).join(', ')} not generated from the JSON. Run node scripts/build_tokens.mjs.`);
    process.exit(1);
  }
  console.log(`Design tokens OK: generated files match the source; ${report.rows.length} text pairs pass WCAG AA.`);
} else {
  for (const [file, text] of outputs) writeFileSync(file, text);
  console.log(`Wrote ${outputs.length} files; ${report.rows.length} text pairs pass WCAG AA.`);
}
