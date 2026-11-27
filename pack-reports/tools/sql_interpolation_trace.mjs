#!/usr/bin/env node
// PACK-03: traces every `${...}` interpolation inside a SQL template literal passed to `.prepare(` or `.exec(` under src/server,
// and gives each a verdict. Output: pack-reports/sql-interpolations.csv (file, line, expression, verdict, evidence) and a summary.
//
//   node pack-reports/tools/sql_interpolation_trace.mjs [--out pack-reports]
//
// Verdicts (safe means: no request value can reach the SQL text; values travel as `?` parameters):
//   PLACEHOLDERS      a list of `?` marks built from a count (`ids.map(() => '?').join(',')`, `'?'.repeat`, a `marks`/`qs` helper)
//   CONSTANT          an identifier whose definition in the same file is a string/array literal, or an UPPER_CASE module constant
//   LITERAL_CHOICE    a ternary or logical expression whose branches are string literals (or empty)
//   NUMERIC           a number: Number(), Math.*, parseInt, an integer literal, a .length
//   SCOPE_FILTER      the SQL fragment of the authorisation engine (`scopeFilter(...).sql`, `scope.sql`, `scope`), built from column
//                     names given in code and `?` parameters (src/server/platform/authz)
//   COLUMN_MAP        an ORDER BY / column chosen from a map in code (`orderBySql`, `cols`, `COLS[...]`, `sortSql`)
//   IDENT_CHECKED     a table or column name passed through the identifier check (`assertIdent`/`ident`/`safeIdent`) or taken from
//                     the code's registry (`spec.table`, `def.table`, `t.table`)
//   FRAGMENT_BUILT    a WHERE/SET fragment assembled in the same function from string literals and `?` (`where`, `conds.join`, `sets`)
//   REVIEW            none of the above: needs a person to read it (listed first in the CSV)
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const OUT = resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'pack-reports');
mkdirSync(OUT, { recursive: true });

const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(f)) files.push(p); } })(join(ROOT, 'src/server'));

/** Reads a template literal starting at the backtick at `i`; returns { end, exprs: [{ text, offset }] }. Handles nested `${ }`, strings and templates. */
function readTemplate(src, i) {
  const exprs = []; let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return { end: j, exprs };
    if (c === '$' && src[j + 1] === '{') {
      let depth = 1; let k = j + 2; const start = k;
      while (k < src.length && depth > 0) {
        const d = src[k];
        if (d === '`') { k = readTemplate(src, k).end + 1; continue; }
        if (d === "'" || d === '"') { const q = d; k += 1; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k += 1; k += 1; } k += 1; continue; }
        if (d === '{') depth += 1; else if (d === '}') depth -= 1;
        k += 1;
      }
      exprs.push({ text: src.slice(start, k - 1).trim(), offset: start });
      j = k; continue;
    }
    j += 1;
  }
  return { end: j, exprs };
}

const lineOf = (src, off) => src.slice(0, off).split('\n').length;
const STR = String.raw`(?:'[^'\n]*'|"[^"\n]*"|\x60[^\x60$]*\x60)`;
const reLiteralChoice = new RegExp(String.raw`^[^?:]*\?\s*${STR}\s*:\s*(?:${STR}|[^?:]*\?\s*${STR}\s*:\s*${STR})$`, 's');
const reLogicalLiteral = new RegExp(String.raw`^[\w.!()\s=<>&|]+&&\s*${STR}$|^[\w.]+\s*\?\?\s*${STR}$|^${STR}$`, 's');

function definitionOf(src, name, uptoOffset) {
  // the nearest `const|let|var name = ...;` before the use (same file)
  const re = new RegExp(String.raw`(?:const|let|var)\s+${name.replace(/[$]/g, '\\$')}\s*=\s*([^;]{0,600})`, 'g');
  let m; let last = null;
  while ((m = re.exec(src)) && m.index < uptoOffset) last = m[1].trim();
  if (!last) { re.lastIndex = 0; m = re.exec(src); last = m ? m[1].trim() : null; } // module-level constant defined below
  return last;
}

function verdict(expr, src, offset, depth = 0) {
  const e = expr.replace(/\s+/g, ' ').trim();
  if (/(\.map\(\s*\(\)\s*=>\s*'\?'\s*\)|'\?'\.repeat|Array\(.*\)\.fill\('\?'\)|\bmarks\b|\bplaceholders?\b|\bqs\b|\bph\b|\binList\b|\bin\(|\?, \?)/.test(e)) return ['PLACEHOLDERS', ''];
  if (/^\d+$/.test(e) || /^(Number|Math\.\w+|parseInt|Math\.trunc)\(/.test(e) || /\.length$/.test(e) || /^(limit|offset|pageSize|days|n|size|LIMIT|MAX_\w+)$/.test(e)) return ['NUMERIC', ''];
  if (reLiteralChoice.test(e) || reLogicalLiteral.test(e)) return ['LITERAL_CHOICE', ''];
  if (/scopeFilter\(|\bscope(Sql|Where|Clause)?\b(\.sql)?$|\.scope\.sql$|^scope\.\w+$|Scope\b|scopeOf\(|\bsc\.sql$|\bvis(ible)?(Sql)?\b/.test(e)) return ['SCOPE_FILTER', ''];
  if (/orderBySql\(|\border(By)?(Sql)?\b|\bsort(Sql|Col|Key)?\b|\bCOLS?\[|\bcols?\b(\.join)?|\bcolumns?\b(\.join)?|\bfields\b(\.join)?|\bselect(Sql|Cols)?\b/.test(e)) return ['COLUMN_MAP', ''];
  if (/assertIdent|safeIdent|\bident\(|quoteIdent|\b(spec|def|t|tbl|entity|reg|cfg|meta)\.(table|column|col|pk|key)\b|\btable(Name)?\b$|\bTABLES?\b/.test(e)) return ['IDENT_CHECKED', ''];
  if (/\b(where|wh|conds?|conditions|clauses?|filters?|filt|sets?|assign|parts|extra|and|andSql|frag|sqlWhere|having|joins?)\b(\.join\([^)]*\))?$/.test(e) || /\.join\(' (AND|OR) '\)$/.test(e) || /\.join\(', '\)$/.test(e)) return ['FRAGMENT_BUILT', ''];
  if (/^[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_]+)*$/.test(e)) return ['CONSTANT', 'UPPER_CASE name'];
  // a fragment object or string returned by a helper (`const w = expiredWhere(...)`, then `${w.sql}`): reviewed once per helper
  const objMatch = /^([A-Za-z_$][\w$]*)(?:\.(sql|where|clause|text|from|on|join))?$/.exec(e);
  if (objMatch && depth < 2) {
    const def = definitionOf(src, objMatch[1], offset);
    const call = def && /^(?:await\s+)?([A-Za-z_$][\w$.]*)\s*\(/.exec(def);
    if (call) {
      const fn = call[1];
      if (/(^|\.)(scopeOf|scope|scopeSql|scopeFilter|projectScope|siteScope|scopeWhere|visibleScope|dataScope)$/i.test(fn)) return ['SCOPE_FILTER', `${objMatch[1]} = ${fn}(…)`];
      if (/^(Number|Math\.|parseInt|String\(Number)/.test(fn)) return ['NUMERIC', `${objMatch[1]} = ${fn}(…)`];
      return [`HELPER:${fn}`, `${objMatch[1]} = ${def.slice(0, 100)}`];
    }
  }
  if (/^[A-Za-z_$][\w$]*$/.test(e) && depth < 2) {
    const def = definitionOf(src, e, offset);
    if (def) {
      if (new RegExp(`^${STR}`).test(def) || /^\[\s*'/.test(def) || /^Object\.freeze\(\s*[\['{]/.test(def)) return ['CONSTANT', `const ${e} = ${def.slice(0, 80)}`];
      const [v, why] = verdict(def, src, offset, depth + 1);
      if (v !== 'REVIEW') return [v, `${e} = ${def.slice(0, 80)}${why ? ` (${why})` : ''}`];
      return ['REVIEW', `${e} = ${def.slice(0, 120)}`];
    }
  }
  return ['REVIEW', ''];
}

const rows = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /\.(prepare|exec)\(\s*`/g; let m;
  while ((m = re.exec(src))) {
    const tick = m.index + m[0].length - 1;
    const { exprs } = readTemplate(src, tick);
    for (const x of exprs) {
      const [v, why] = verdict(x.text, src, x.offset);
      rows.push({ file: relative(ROOT, f), line: lineOf(src, x.offset), call: m[1], expr: x.text.replace(/\s+/g, ' ').slice(0, 200), verdict: v, evidence: why });
    }
  }
}
const rank = (v) => (v === 'REVIEW' ? 0 : v.startsWith('HELPER:') ? 1 : 2);
rows.sort((a, b) => rank(a.verdict) - rank(b.verdict) || a.file.localeCompare(b.file) || a.line - b.line);
const csv = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync(join(OUT, 'sql-interpolations.csv'), ['file,line,call,expression,verdict,evidence', ...rows.map((r) => [r.file, r.line, r.call, r.expr, r.verdict, r.evidence].map(csv).join(','))].join('\n') + '\n');
const by = rows.reduce((a, r) => { const k = r.verdict.startsWith('HELPER:') ? 'HELPER (review the helper once)' : r.verdict; return { ...a, [k]: (a[k] ?? 0) + 1 }; }, {});
const helpers = rows.filter((r) => r.verdict.startsWith('HELPER:')).reduce((a, r) => { const k = `${r.file} ${r.verdict.slice(7)}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
writeFileSync(join(OUT, 'sql-interpolation-helpers.csv'), ['file_and_helper,uses', ...Object.entries(helpers).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${csv(k)},${n}`)].join('\n') + '\n');
console.log(JSON.stringify({ files: new Set(rows.map((r) => r.file)).size, interpolations: rows.length, byVerdict: by, distinctHelpers: Object.keys(helpers).length }, null, 1));
