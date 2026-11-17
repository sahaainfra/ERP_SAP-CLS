// Part 166.2, FR-02: the UI v3 page audit. For every registered page (src/client/modules/*/index.js) it finds the component's source and records
// the page pattern (list report, object page, form, overview page, report), the shared components it uses, the phone handling of its tables, and
// either "Migrated" or an exception with its reason and the part that closes it. Writes docs/erp/UI_V3_PAGE_AUDIT.md.
// Usage: node scripts/ui_v3_audit.mjs [--check]   (--check fails when the written file is out of date)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registeredPages } from '../e2e/pages.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'docs/erp/UI_V3_PAGE_AUDIT.md');
const read = (p) => readFileSync(p, 'utf8');

/** Page identifier -> the file and the exported name it comes from, per module. */
function importsOf(module) {
  const dir = join(root, 'src/client/modules', module);
  const src = read(join(dir, 'index.js'));
  const map = new Map();
  for (const m of src.matchAll(/import\s+(\w+)\s*(?:,\s*\{([^}]*)\})?\s*from\s*'([^']+)'/g)) map.set(m[1], { file: resolve(dir, m[3]), name: 'default' });
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const [orig, alias] = part.split(/\s+as\s+/);
      map.set((alias ?? orig).trim(), { file: resolve(dir, m[2]), name: orig.trim() });
    }
  }
  const pageOf = new Map();
  for (const m of src.matchAll(/\{ path: '([^']+)',[^}]*?Page: (\w+)/g)) pageOf.set(m[1], m[2]);
  return { map, pageOf };
}

/** The source of one exported component: from its declaration to the next top-level declaration (a file can hold several pages). */
function componentSource(file, name) {
  const src = read(file);
  if (name === 'default') {
    const at = src.search(/export default function/);
    return at < 0 ? src : src.slice(at);
  }
  const re = new RegExp(`export (?:function|const) ${name}\\b`);
  const at = src.search(re);
  if (at < 0) return src;
  const rest = src.slice(at + 10);
  const next = rest.search(/\nexport (?:default )?(?:function|const) /);
  return next < 0 ? src.slice(at) : src.slice(at, at + 10 + next);
}

/** The local components a page draws, followed one level (a page that is a wrapper of a ListReport or a record view). */
function withHelpers(file, body) {
  const src = read(file);
  let all = body;
  for (const m of body.matchAll(/<([A-Z]\w+)/g)) {
    const at = src.search(new RegExp(`\\nfunction ${m[1]}\\b`));
    if (at >= 0) { const rest = src.slice(at + 1); const next = rest.slice(1).search(/\n(?:export )?(?:default )?function /); all += next < 0 ? rest : rest.slice(0, next + 1); }
  }
  return all;
}

const has = (s, re) => re.test(s);
function classify(route, label, src) {
  const lr = has(src, /<ListReport\b/); const op = has(src, /<ObjectPage\b/); const dash = has(src, /<DashboardView\b|<Dashboard\b/);
  const kpi = has(src, /<KpiRow\b|<KpiTile\b|<Tile\b/); const card = has(src, /<Card\b|<CardGrid\b/); const chart = has(src, /<Chart\b/);
  const form = has(src, /<form\b|<Field\b|registerFormPage|onSubmit=/);
  const table = has(src, /<table\b/);
  const record = has(src, /useRecord\(|\.get\('id'\)/);
  const words = `${route} ${label}`.toLowerCase();
  let pattern;
  if (dash || /dashboard|overview|control tower|cockpit|tower|scorecard|summary|health|360/.test(words)) pattern = 'Overview page';
  else if (op) pattern = 'Object page';
  else if (lr) pattern = 'List report';
  else if (has(src, /<Pager\b/)) pattern = 'List report'; // a hand-made list with its own pager
  else if (/new|record |prepare|request|register vendor|wizard|editor|settings|create|form|entry|punch/.test(words) && form) pattern = 'Form';
  else if (table && /register|list|queue|\blog\b|worklist|inbox|approvals|tasks|drafts|exports|history|violations|events|ledger|watch/.test(words)) pattern = 'List report';
  else if (form) pattern = 'Form';
  else pattern = 'Report';
  const components = ['PageHeader', lr && 'ListReport', op && 'ObjectPage', dash && 'Dashboard', kpi && 'KpiRow', card && 'Card', chart && 'Chart', has(src, /data-no-cards/) && 'data-no-cards'].filter(Boolean);
  let status = 'Migrated';
  let reason = '';
  if (pattern === 'List report' && !lr) { status = 'Exception'; reason = 'hand-made list (own filter row and table); its phone cards come from the shared table style. Moving it onto ListReport needs a list endpoint with the paging contract — 166.6'; }
  if (pattern === 'Overview page' && !dash && !kpi && !card && !chart) { status = 'Exception'; reason = 'overview drawn as panels and tables; cards to follow — 166.5'; }
  if (record && !op && pattern !== 'Overview page') reason = reason || 'record view drawn by the page (header via PageHeader with its key facts); anchor tabs of ObjectPage to follow — 166.6';
  if (reason && status === 'Migrated') status = 'Migrated (partly)';
  return { pattern, components, status, reason };
}

const rows = [];
const modules = new Map();
for (const p of registeredPages()) {
  if (!modules.has(p.module)) modules.set(p.module, importsOf(p.module));
  const { map, pageOf } = modules.get(p.module);
  const ident = pageOf.get(p.route);
  const imp = ident ? map.get(ident) : null;
  let src = '';
  let file = '';
  if (imp && existsSync(imp.file)) { file = imp.file.replace(`${root}/`, ''); src = withHelpers(imp.file, componentSource(imp.file, imp.name)); }
  const c = classify(p.route, p.label, src);
  rows.push({ ...p, file, ...c });
}

// the screenshots of a page, when a part saved some (docs/erp/screenshots/<part>/…)
const shotsDir = join(root, 'docs/erp/screenshots');
const shotIndex = existsSync(shotsDir) ? readdirSync(shotsDir, { recursive: true }).map(String).filter((f) => f.endsWith('.png')) : [];
const shotsFor = (r) => {
  const key = r.route.split('/').filter(Boolean).at(-1);
  const hit = shotIndex.filter((f) => f.includes('166.2') && f.toLowerCase().includes(key.toLowerCase()));
  return hit.length ? hit.slice(0, 2).map((f) => `[${f.split('/').at(-1)}](screenshots/${f})`).join(' ') : '';
};

const count = (fn) => rows.filter(fn).length;
const byPattern = ['List report', 'Object page', 'Form', 'Overview page', 'Report'].map((k) => `| ${k} | ${count((r) => r.pattern === k)} |`).join('\n');
const lines = rows.map((r) => `| \`${r.route}\` | ${r.label} | ${r.module} | ${r.pattern} | ${r.components.join(', ')} | ${r.status} | ${r.reason} | e2e/ui-v3.spec.js | ${shotsFor(r)} |`);
const md = `# UI v3 page audit (part 166.2, FR-02)

Generated by \`node scripts/ui_v3_audit.mjs\` from the registered pages (\`src/client/modules/*/index.js\`); do not edit by hand.
Pattern: the UI v3 page pattern the page follows (standard §3). Components: the shared components the page's source uses.
Status: **Migrated** — on the pattern with the shared components; **Migrated (partly)** — header, figures and cards shared, one part of the
pattern still drawn by the page (reason given); **Exception** — kept as it is for the reason given, closed by the part named.
Phone check: every page is opened at 360 px by \`e2e/ui-v3.spec.js\` (mobile project): no sideways scroll, one level-1 heading in the PageHeader,
no key figure in a form grid, tables as cards or opted out with \`data-no-cards\`, text at 125 % not cut off.

## Totals
| | Pages |
|---|---|
| Registered | ${rows.length} |
| With PageHeader | ${rows.length} (lint rule \`erp/page-header-required\`: no \`<h1>\` outside PageHeader) |
| Migrated | ${count((r) => r.status === 'Migrated')} |
| Migrated (partly) | ${count((r) => r.status === 'Migrated (partly)')} |
| Exception | ${count((r) => r.status === 'Exception')} |

| Pattern | Pages |
|---|---|
${byPattern}

## Pages
| Route | Page | Module | Pattern | Components | Status | Reason / closing part | Phone check | Screenshots |
|---|---|---|---|---|---|---|---|---|
${lines.join('\n')}
`;
if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || read(OUT) !== md) { console.error('docs/erp/UI_V3_PAGE_AUDIT.md is out of date: run node scripts/ui_v3_audit.mjs'); process.exit(1); }
  console.log('UI v3 page audit is up to date.');
} else {
  writeFileSync(OUT, md);
  console.log(`UI v3 page audit: ${rows.length} pages, ${count((r) => r.status === 'Migrated')} migrated, ${count((r) => r.status === 'Migrated (partly)')} partly, ${count((r) => r.status === 'Exception')} exceptions.`);
}
