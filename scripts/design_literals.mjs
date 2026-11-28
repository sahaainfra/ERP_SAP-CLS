#!/usr/bin/env node
// PACK-05: counts the literal colours and lengths in the client outside the token files, per file, against a baseline that can only go down.
//   node scripts/design_literals.mjs            prints the totals and the 30 files with the most literals
//   node scripts/design_literals.mjs --check    exit 1 when a file has more literals than in docs/erp/design/literals-baseline.json
//                                              (or a new file has any); fewer is fine and is reported so the baseline can be lowered
//   node scripts/design_literals.mjs --update   writes the current counts as the baseline (after a reviewed reduction)
// Counted: CSS literal colours and px values (eslint-rules/design-literals.js scanCss), and JS/JSX lengths in style objects and strings
// (rule erp/no-literal-length). JS/JSX colours are already an ESLint error (erp/no-hardcoded-color). 0 and 1 px are not counted.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import plugin, { scanCss } from '../eslint-rules/design-literals.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'docs/erp/design/literals-baseline.json');
// the token files themselves and generated code
const SKIP = new Set(['src/client/design-tokens.css', 'src/client/platform/design/icon-map.js']);

export function countLiterals() {
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(css|jsx?)$/.test(f)) files.push(p); } })(join(root, 'src/client'));
  const linter = new Linter();
  /** @type {import('eslint').Linter.Config[]} */
  const config = [{ files: ['**/*.js', '**/*.jsx'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { erp: plugin }, rules: { 'erp/no-literal-length': 'error' } }];
  const counts = {};
  for (const f of files.sort()) {
    const rel = relative(root, f).split('\\').join('/');
    if (SKIP.has(rel)) continue;
    const text = readFileSync(f, 'utf8');
    let c;
    if (rel.endsWith('.css')) { const s = scanCss(text); c = { colours: s.colours.length, lengths: s.px.length }; }
    else { const msgs = linter.verify(text, config, { filename: rel }); c = { colours: 0, lengths: msgs.filter((m) => m.ruleId === 'erp/no-literal-length').length }; }
    if (c.colours + c.lengths > 0) counts[rel] = c;
  }
  return counts;
}

export function compare(current, baseline) {
  const worse = []; const better = [];
  for (const [f, c] of Object.entries(current)) {
    const b = baseline[f] ?? { colours: 0, lengths: 0 };
    if (c.colours > b.colours || c.lengths > b.lengths) worse.push({ file: f, now: c, baseline: b });
    else if (c.colours < b.colours || c.lengths < b.lengths) better.push({ file: f, now: c, baseline: b });
  }
  for (const f of Object.keys(baseline)) if (!current[f]) better.push({ file: f, now: { colours: 0, lengths: 0 }, baseline: baseline[f] });
  return { worse, better };
}

const total = (m) => Object.values(m).reduce((a, c) => ({ colours: a.colours + c.colours, lengths: a.lengths + c.lengths }), { colours: 0, lengths: 0 });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const current = countLiterals();
  const t = total(current);
  if (args.includes('--update')) {
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(current).sort()), null, 1)}\n`);
    console.log(`Baseline written: ${Object.keys(current).length} files, ${t.colours} colours, ${t.lengths} lengths.`);
    process.exit(0);
  }
  if (args.includes('--check')) {
    const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const { worse, better } = compare(current, baseline);
    const tb = total(baseline);
    for (const w of worse) console.error(`  MORE literals in ${w.file}: colours ${w.baseline.colours} → ${w.now.colours}, lengths ${w.baseline.lengths} → ${w.now.lengths}`);
    console.log(`Design literals: ${t.colours} colours and ${t.lengths} lengths now (baseline ${tb.colours} and ${tb.lengths}); ${worse.length} file(s) worse, ${better.length} better.${better.length ? ' Lower the baseline with --update after review.' : ''}`);
    process.exit(worse.length ? 1 : 0);
  }
  console.log(JSON.stringify({ files: Object.keys(current).length, ...t }));
  for (const [f, c] of Object.entries(current).sort((a, b) => (b[1].colours + b[1].lengths) - (a[1].colours + a[1].lengths)).slice(0, 30)) console.log(`${String(c.colours).padStart(4)} ${String(c.lengths).padStart(5)}  ${f}`);
}
