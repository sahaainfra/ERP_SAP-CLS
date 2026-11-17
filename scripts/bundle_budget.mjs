#!/usr/bin/env node
// The performance budget of the client build (part 166.4, P-04 / T-01). Run after `npm run build`; a stage of `npm run erp:regression`.
//
// - The first download is the entry script of dist/index.html and the scripts it preloads (Vite lists every static import as a modulepreload):
//   at most 350 KB gzip together.
// - Every other script (a page, a module's shared code, a library) is fetched only when needed: at most 250 KB gzip each. The PDF viewer
//   (pdfjs-dist, split since 04.10) is measured and reported but has its own limit, as it is one library that cannot be cut.
// - The report per chunk is written to reports/bundle-budget.json and reports/bundle-budget.md.
//
// Usage: node scripts/bundle_budget.mjs [--dist dist] [--out reports] [--quiet]
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUDGET = Object.freeze({ initialGzip: 350 * 1024, chunkGzip: 250 * 1024, libraryGzip: { 'pdf.min': 400 * 1024 } });

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** The scripts of the first download: the module entry and its modulepreload links, as they appear in index.html. */
export function initialScripts(html) {
  const src = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  const pre = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set([...src, ...pre])].map((u) => u.replace(/^\//, ''));
}

/** The budget verdict for a list of { file, bytes, gzip } and the names of the first-download files. */
export function check(chunks, initial, budget = BUDGET) {
  const first = chunks.filter((c) => initial.includes(c.file));
  const initialGzip = first.reduce((s, c) => s + c.gzip, 0);
  const problems = [];
  if (initialGzip > budget.initialGzip) problems.push(`first download ${kb(initialGzip)} gzip is above ${kb(budget.initialGzip)} (${first.map((c) => c.file).join(', ')})`);
  for (const c of chunks) {
    if (initial.includes(c.file)) continue;
    const lib = Object.keys(budget.libraryGzip).find((k) => c.file.includes(`/${k}-`) || c.file.startsWith(`assets/${k}-`));
    const limit = lib ? budget.libraryGzip[lib] : budget.chunkGzip;
    if (c.gzip > limit) problems.push(`${c.file} ${kb(c.gzip)} gzip is above ${kb(limit)}`);
  }
  return { initialGzip, initialFiles: first.map((c) => c.file), problems, ok: problems.length === 0 };
}

function main() {
  const dist = arg('--dist', 'dist');
  const out = arg('--out', 'reports');
  if (!existsSync(join(dist, 'index.html'))) { console.error(`No build in ${dist}: run npm run build first.`); process.exit(2); }
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initial = initialScripts(html);
  const chunks = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js')).map((f) => {
    const buf = readFileSync(join(dist, 'assets', f));
    return { file: `assets/${f}`, bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
  }).sort((a, b) => b.gzip - a.gzip);
  const verdict = check(chunks, initial);
  const total = chunks.reduce((s, c) => ({ bytes: s.bytes + c.bytes, gzip: s.gzip + c.gzip }), { bytes: 0, gzip: 0 });
  const report = { budget: BUDGET, chunks: chunks.length, total, ...verdict, largest: chunks.slice(0, 25).map((c) => ({ ...c, initial: initial.includes(c.file) })) };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'bundle-budget.json'), `${JSON.stringify({ ...report, all: chunks }, null, 2)}\n`);
  const md = [
    '# Bundle budget (part 166.4)', '',
    `First download: **${kb(verdict.initialGzip)} gzip** (budget ${kb(BUDGET.initialGzip)}): ${verdict.initialFiles.join(', ')}`,
    `Scripts: ${chunks.length}, together ${kb(total.bytes)} (${kb(total.gzip)} gzip). Budget per chunk ${kb(BUDGET.chunkGzip)} gzip.`, '',
    `Result: **${verdict.ok ? 'PASS' : 'FAIL'}**`, ...verdict.problems.map((p) => `- ${p}`), '',
    '| Chunk | Size | Gzip | First download |', '|---|---:|---:|---|',
    ...report.largest.map((c) => `| ${c.file} | ${kb(c.bytes)} | ${kb(c.gzip)} | ${c.initial ? 'yes' : ''} |`), '',
  ].join('\n');
  writeFileSync(join(out, 'bundle-budget.md'), md);
  if (!process.argv.includes('--quiet')) console.log(`Bundle budget ${verdict.ok ? 'OK' : 'FAILED'}: first download ${kb(verdict.initialGzip)} gzip, ${chunks.length} scripts, largest ${chunks[0]?.file} ${kb(chunks[0]?.gzip ?? 0)} gzip.`);
  for (const p of verdict.problems) console.log(`- ${p}`);
  process.exit(verdict.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
