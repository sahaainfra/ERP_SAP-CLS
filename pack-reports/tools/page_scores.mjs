#!/usr/bin/env node
// PACK-02: scores every page of the PACK-00 denominator 0–3 on clarity, density, mobile usability and consistency with the UI v3
// patterns, from evidence the repository already produces, and lists the 50 worst pages.
//
//   node pack-reports/tools/page_scores.mjs [--a11y pack-reports/a11y] [--out pack-reports]
//
// Inputs (read-only): pack-reports/coverage-denominator.csv (PACK-00), the a11y sweep results at 360 and 1280 px
// (e2e/tst-a11y-sweep.spec.js with A11Y_OUT=pack-reports/a11y), and docs/erp/UI_V3_PAGE_AUDIT.md (part 166.2).
// These are automated proxies for the human judgement the pack asks for; the top-50 list is the queue for that review.
//   clarity      3 one h1, no axe violation; −1 for each serious/critical rule; −1 for a moderate one; 0 if the page failed to load
//   density      from the touch targets under 44 px and the inputs under 24 px at 1280 px: 0 → 3, ≤5 → 2, ≤20 → 1, more → 0
//   mobile       at 360 px: 0 if it scrolls sideways or failed to load; else 3 minus small-target and tiny-input steps (as density)
//   consistency  UI v3 audit: Migrated 3, Migrated (partly) 2, Exception 1, not in the audit 0
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const A11Y = resolve(ROOT, opt('a11y', 'pack-reports/a11y'));
const OUT = resolve(ROOT, opt('out', 'pack-reports'));

function csvRows(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows; return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const denom = csvRows(readFileSync(join(ROOT, 'pack-reports/coverage-denominator.csv'), 'utf8'));
const pages = new Map();
for (const r of denom) {
  if (!pages.has(r.route)) pages.set(r.route, { route: r.route, module: r.module, label: r.label, kind: r.kind, permission: r.permission, flag: r.flag, roles: new Set(), file: r.page_file });
  if (r.access === 'ALL' || r.access === 'SOME' || r.access === 'ADMIN') r.roles_with_access.split(' ').filter(Boolean).forEach((x) => pages.get(r.route).roles.add(x));
}
const sweep = (w) => { const f = join(A11Y, `a11y-${w}.json`); if (!existsSync(f)) return { at: null, by: new Map() }; const d = JSON.parse(readFileSync(f, 'utf8')); return { at: d.at, by: new Map(d.results.map((x) => [x.route, x])) }; };
const s360 = sweep(360); const s1280 = sweep(1280);
const audit = new Map();
for (const line of readFileSync(join(ROOT, 'docs/erp/UI_V3_PAGE_AUDIT.md'), 'utf8').split('\n')) {
  const m = /^\| `([^`]+)` \| ([^|]*)\| ([^|]*)\| ([^|]*)\| ([^|]*)\| ([^|]*)\| ([^|]*)\|/.exec(line);
  if (m) audit.set(m[1], { pattern: m[4].trim(), status: m[6].trim(), reason: m[7].trim() });
}
const steps = (n) => (n === 0 ? 3 : n <= 5 ? 2 : n <= 20 ? 1 : 0);
const rows = [];
for (const p of pages.values()) {
  const a = s360.by.get(p.route); const b = s1280.by.get(p.route); const u = audit.get(p.route);
  const sev = (x) => (x?.violations ?? []).filter((v) => v.impact === 'serious' || v.impact === 'critical').length;
  const mod = (x) => (x?.violations ?? []).filter((v) => v.impact === 'moderate').length;
  const anyRun = a || b;
  const clarity = !anyRun ? null : (a?.error && b?.error) ? 0 : Math.max(0, 3 - Math.max(sev(a), sev(b)) - (Math.max(mod(a), mod(b)) ? 1 : 0) - ((a && a.h1 !== 1) || (b && b.h1 !== 1) ? 1 : 0));
  const density = !b ? null : b.error ? 0 : steps((b.smallTargetCount ?? 0) + (b.tinyInputs ?? 0));
  const mobile = !a ? null : (a.error || a.overflowPx > 0) ? 0 : steps((a.smallTargetCount ?? 0) + (a.tinyInputs ?? 0));
  const consistency = !u ? 0 : /^Migrated$/.test(u.status) ? 3 : /partly/.test(u.status) ? 2 : /Exception/.test(u.status) ? 1 : 0;
  const scored = [clarity, density, mobile, consistency].filter((x) => x != null);
  const total = scored.length === 4 ? scored.reduce((s, x) => s + x, 0) : null;
  const role = [...p.roles][0] ?? (p.permission === '(open by design)' ? 'EMP' : '');
  rows.push({ ...p, roles: p.roles.size, role, ui: u?.status ?? 'not in audit', pattern: u?.pattern ?? '', clarity, density, mobile, consistency, total,
    small360: a?.smallTargetCount ?? '', small1280: b?.smallTargetCount ?? '', overflow360: a?.overflowPx ?? '', serious: Math.max(sev(a), sev(b)), load360: a?.loadMs ?? '',
    blocked: !a && !b ? (p.module === 'close' ? 'BLOCKED: not in the sweep list (D-841)' : 'BLOCKED: not swept (onboarding-only or not reachable by the sweep user)') : '' });
}
const csv = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const HEAD = ['route', 'module', 'label', 'kind', 'role', 'roles_with_access', 'permission', 'flag', 'ui_v3_status', 'pattern', 'clarity', 'density', 'mobile', 'consistency', 'total_of_12', 'small_targets_360', 'small_targets_1280', 'overflow_px_360', 'serious_axe_rules', 'load_ms_360', 'blocked', 'page_file'];
const line = (r) => [r.route, r.module, r.label, r.kind, r.role, r.roles, r.permission, r.flag, r.ui, r.pattern, r.clarity, r.density, r.mobile, r.consistency, r.total, r.small360, r.small1280, r.overflow360, r.serious, r.load360, r.blocked, r.file].map(csv).join(',');
writeFileSync(join(OUT, 'page-scores.csv'), [HEAD.join(','), ...rows.map(line)].join('\n') + '\n');
// worst first: lowest total, then most serious findings, then most small targets on a phone; record pages last among equals
const ranked = rows.filter((r) => r.total != null).sort((x, y) => x.total - y.total || y.serious - x.serious || (Number(y.small360) || 0) - (Number(x.small360) || 0) || (x.kind === 'record') - (y.kind === 'record') || x.route.localeCompare(y.route));
const top = ranked.slice(0, 50);
writeFileSync(join(OUT, 'top50-worst-pages.csv'), [['rank', ...HEAD, 'repro_url_360', 'repro_url_1280'].join(','), ...top.map((r, i) => `${i + 1},${line(r)},${csv(`http://localhost:3100${r.route} (role ${r.role}, 360x740)`)},${csv(`http://localhost:3100${r.route} (role ${r.role}, 1280x800)`)}`)].join('\n') + '\n');
const dist = (k) => rows.reduce((a, r) => ({ ...a, [r[k] ?? 'n/a']: (a[r[k] ?? 'n/a'] ?? 0) + 1 }), {});
console.log(JSON.stringify({ pages: rows.length, scored: ranked.length, blocked: rows.filter((r) => r.blocked).length, sweep360: s360.at, sweep1280: s1280.at,
  clarity: dist('clarity'), density: dist('density'), mobile: dist('mobile'), consistency: dist('consistency'), worstTotals: top.map((r) => r.total) }, null, 1));
