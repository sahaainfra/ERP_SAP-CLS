import { dec } from '../../../shared/decimal.js';
import { formatINR } from '../../../shared/money.js';
import { formatBusinessDate, formatDateTime } from '../../../shared/dates.js';
import { BUILTINS, CATALOGUE, SYSTEM_SCALARS, get } from './tpl-catalogue.js';
import { amountInHindi, amountInWords } from './tpl-words.js';
import { parseCss, CSS_PROPERTIES } from './tpl-pdf.js';

// The template language (part 04.11, FR-01 and FR-03). A template is HTML with a few controlled tags and no code:
//   {{variable}}  {{variable | filter}}  {{#each lines}} ... {{/each}}  {{#if cond}} ... {{else}} ... {{/if}}
// Inside {{#each group}} a column of the group is named on its own ({{description}}), and {{@no}} is the number of the line. A condition is a variable, !variable, or variable == 'text' (also != > < >= <=).
// Every name is checked against the catalogue of the document type when the template is saved; scripts, links, outside pictures and variables inside a tag are refused.
export const FILTERS = Object.freeze({
  money: 'Rupees with the symbol, Indian grouping (₹1,23,456.00)', inr: 'Indian grouping without the symbol', qty: 'Quantity to 3 places', rate: 'Rate to 4 places', int: 'Whole number', pct: 'Percentage without trailing zeros',
  date: 'Date as 04-Nov-2026', datetime: 'Date and time in IST', upper: 'Capital letters', lower: 'Small letters', words: 'Amount in words, English', wordsHi: 'Amount in words, Hindi', mask: 'Only the last four characters',
});
export const MAX_TEMPLATE_BYTES = 200_000;
export const MAX_LOOP_ROWS = 2000;
const TAGS = new Set(['header', 'footer', 'section', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'b', 'strong', 'i', 'em', 'u', 'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'img', 'col', 'blockquote', 'small', 'sub', 'sup']);
const ATTRS = new Set(['class', 'id', 'style', 'colspan', 'width', 'height', 'align', 'bgcolor', 'border', 'alt']);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** The tree of a template, or its structural problems. */
export function parse(source) {
  const problems = [];
  const root = { type: 'root', body: [] };
  const stack = [{ node: root, list: root.body }];
  const top = () => stack[stack.length - 1];
  let last = 0;
  const text = (to) => { if (to > last) top().list.push({ type: 'text', value: source.slice(last, to) }); };
  for (const m of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    text(m.index);
    last = m.index + m[0].length;
    const line = lineOf(source, m.index);
    const tag = m[1].trim();
    let r;
    if ((r = /^#each\s+([\w.]+)$/.exec(tag))) {
      const node = { type: 'each', group: r[1], body: [], line };
      top().list.push(node);
      stack.push({ node, list: node.body });
    } else if ((r = /^#if\s+(.+)$/.exec(tag))) {
      /** @type {any} */
      const node = { type: 'if', cond: r[1].trim(), then: [], other: [], line };
      top().list.push(node);
      stack.push({ node, list: node.then });
    } else if (tag === 'else') {
      const t = top();
      if (t.node.type !== 'if' || t.list === t.node.other) problems.push({ line, message: '{{else}} must be inside {{#if}}.' }); else t.list = t.node.other;
    } else if (tag === '/each' || tag === '/if') {
      const want = tag === '/each' ? 'each' : 'if';
      if (top().node.type !== want) problems.push({ line, message: `${tag} has no matching {{#${want}}}.` }); else stack.pop();
    } else if ((r = /^([@\w.]+)\s*(?:\|\s*(\w+))?$/.exec(tag))) {
      top().list.push({ type: 'var', path: r[1], filter: r[2] ?? null, line });
    } else problems.push({ line, message: `"{{${tag}}}" is not a variable, a block or a filter.` });
  }
  text(source.length);
  for (const s of stack.slice(1)) problems.push({ line: s.node.line, message: `{{#${s.node.type}}} is never closed.` });
  return { ast: root.body, problems };
}

const COND = /^(!)?\s*([@\w.]+)\s*(?:(==|!=|>=|<=|>|<)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)))?$/;
const parseCond = (c) => { const m = COND.exec(c); return m && (m[1] && m[3] ? null : { not: Boolean(m[1]), path: m[2], op: m[3] ?? null, lit: m[4] ?? m[5] ?? m[6] ?? null, num: m[6] !== undefined }); };

/** Is the HTML inside the controlled subset? */
function htmlProblems(source) {
  const problems = [];
  const body = source.replace(/\{\{[\s\S]*?\}\}/g, (m) => m.replace(/[^\n]/g, ' '));
  for (const m of body.matchAll(/<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const line = lineOf(source, m.index);
    const tag = m[2].toLowerCase();
    if (!TAGS.has(tag)) { problems.push({ line, message: `The tag <${tag}> is not allowed. Allowed: ${[...TAGS].join(', ')}.` }); continue; }
    if (m[1]) continue;
    for (const a of m[3].matchAll(/([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
      const name = a[1].toLowerCase();
      const value = (a[2] ?? '').replace(/^["']|["']$/g, '');
      if (name.startsWith('on')) problems.push({ line, message: `The attribute ${name} (a script) is not allowed.` });
      else if (!ATTRS.has(name) && name !== 'src') problems.push({ line, message: `The attribute ${name} is not allowed on <${tag}>.` });
      else if (name === 'src' && !/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(value)) problems.push({ line, message: 'A picture must be embedded (data:image/png or jpeg); an address outside the system is not allowed. Use {{logo}} or {{qr}}.' });
      else if (name === 'style' && /url\(|expression\(|javascript:|@import/i.test(value)) problems.push({ line, message: 'This style is not allowed.' });
    }
  }
  if (/<\s*(script|iframe|object|embed|link|style|form|input|a)\b/i.test(body)) problems.push({ line: 1, message: 'Scripts, styles, links, frames and forms cannot be used in a template; put styles in the style box.' });
  for (const m of source.matchAll(/<[^>]*\{\{[^>]*>/g)) problems.push({ line: lineOf(source, m.index), message: 'A variable can be used only in the text of the document, not inside a tag.' });
  return problems;
}
function cssProblems(css) {
  const problems = [];
  if (/@import|url\(|expression\(|javascript:|<\s*\/?\s*script/i.test(css ?? '')) problems.push({ line: 1, field: 'css', message: 'The style box cannot load anything from outside (@import, url(), scripts).' });
  const warnings = [];
  const clean = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([a-z-]+)\s*:/gi)) if (!CSS_PROPERTIES.includes(m[1].toLowerCase()) && /\{[^}]*$/.test(clean.slice(0, m.index))) warnings.push(`The property ${m[1]} is not supported in the PDF and is ignored.`);
  void parseCss;
  return { problems, warnings: [...new Set(warnings)] };
}

/** The names a template may use for a document type, with the groups and their columns. */
function scopeOf(docType) {
  const cat = CATALOGUE[docType];
  return { scalars: { ...SYSTEM_SCALARS, ...cat.scalars, ...BUILTINS }, groups: cat.groups };
}

/**
 * Check a template against the catalogue of its document type (T-01): every variable, block and filter must exist, the HTML must be inside the subset.
 * @returns {{ ok: boolean, problems: {line:number, message:string, variable?:string}[], warnings: string[], variables: string[] }}
 */
export function validate(docType, { html, css = '' }) {
  const cat = CATALOGUE[docType];
  if (!cat) return { ok: false, problems: [{ line: 1, message: `${docType} is not a document type of the library.` }], warnings: [], variables: [] };
  const problems = [];
  if (Buffer.byteLength(html ?? '') > MAX_TEMPLATE_BYTES) problems.push({ line: 1, message: 'The template is larger than 200 KB.' });
  const { ast, problems: structural } = parse(html ?? '');
  problems.push(...structural, ...htmlProblems(html ?? ''));
  const c = cssProblems(css);
  problems.push(...c.problems);
  const { scalars, groups } = scopeOf(docType);
  const used = new Set();
  const check = (nodes, group) => {
    for (const n of nodes) {
      if (n.type === 'var' || n.type === 'if') {
        const path = n.type === 'var' ? n.path : parseCond(n.cond)?.path;
        if (n.type === 'if' && !path) { problems.push({ line: n.line, message: `The condition "${n.cond}" is not understood. Use a variable, !variable or variable == 'text'.` }); }
        else if (path === '@no' || path === '@index') { if (!group) problems.push({ line: n.line, variable: path, message: `${path} can be used only inside {{#each}}.` }); }
        else if (path) {
          const known = (group && path in groups[group].columns) || path in scalars;
          if (!known) problems.push({ line: n.line, variable: path, message: `The variable "${path}" is not in the catalogue of ${cat.label}.${group ? ` Columns of ${groups[group].label}: ${Object.keys(groups[group].columns).join(', ')}.` : ''}` });
          else used.add(path);
        }
        if (n.type === 'var' && n.filter && !(n.filter in FILTERS)) problems.push({ line: n.line, variable: n.path, message: `The filter "${n.filter}" does not exist. Filters: ${Object.keys(FILTERS).join(', ')}.` });
        if (n.type === 'var' && BUILTINS[n.path]?.type === 'raw' && n.filter) problems.push({ line: n.line, variable: n.path, message: `${n.path} takes no filter.` });
      }
      if (n.type === 'each') {
        if (group) problems.push({ line: n.line, message: '{{#each}} cannot be nested.' });
        else if (!(n.group in groups)) problems.push({ line: n.line, variable: n.group, message: `"${n.group}" is not a group of ${cat.label}. Groups: ${Object.keys(groups).join(', ')}.` });
        else used.add(n.group);
        check(n.body, n.group in groups ? n.group : null);
      }
      if (n.type === 'if') { check(n.then, group); check(n.other, group); }
    }
  };
  check(ast, null);
  return { ok: problems.length === 0, problems: problems.sort((a, b) => a.line - b.line), warnings: c.warnings, variables: [...used].sort() };
}

// ---- rendering ----
const trimPct = (v) => `${dec(v).round(2).toFixed(2).replace(/\.?0+$/, '')}%`;
function format(value, type, filter) {
  if (value == null || value === '') return '';
  try {
    switch (filter ?? type) {
      case 'money': return formatINR(String(value));
      case 'inr': return formatINR(String(value), { symbol: false });
      case 'qty': return formatINR(String(value), { symbol: false, decimals: /** @type {any} */ (3) });
      case 'rate': return formatINR(String(value), { symbol: false, decimals: /** @type {any} */ (4) });
      case 'percent': case 'pct': return trimPct(String(value));
      case 'int': return String(Math.trunc(Number(value)));
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatBusinessDate(String(value)) : String(value);
      case 'datetime': return formatDateTime(String(value));
      case 'upper': return String(value).toUpperCase();
      case 'lower': return String(value).toLowerCase();
      case 'words': return amountInWords(String(value));
      case 'wordsHi': return amountInHindi(String(value));
      case 'mask': { const s = String(value); return s.length <= 4 ? s : `${'X'.repeat(s.length - 4)}${s.slice(-4)}`; }
      default: return String(value);
    }
  } catch { return String(value); }
}
const truthy = (v) => { if (v == null || v === '' || v === false) return false; if (typeof v === 'number') return v !== 0; if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v) !== 0; return true; };
function test(cond, lookup) {
  const c = parseCond(cond);
  if (!c) return false;
  const v = lookup(c.path);
  let r;
  if (!c.op) r = truthy(v);
  else if (c.op === '==') r = String(v ?? '') === String(c.lit);
  else if (c.op === '!=') r = String(v ?? '') !== String(c.lit);
  else { const a = Number(v); const b = Number(c.lit); r = c.op === '>' ? a > b : c.op === '<' ? a < b : c.op === '>=' ? a >= b : a <= b; }
  return c.not ? !r : r;
}

/**
 * The HTML of the document: the template with the data put in (every value is escaped). `data` is the normalised data of the record; `system` holds the variables the system supplies
 * (company, project, document number, verification); `qr` and `logo` are ready-made picture tags.
 */
export function render(docType, html, { data, system = {}, qr = '', logo = '' }) {
  const cat = CATALOGUE[docType];
  const { scalars, groups } = scopeOf(docType);
  const { ast } = parse(html);
  const value = (path, row, group) => {
    if (group && row && path in groups[group].columns) return { v: row[path], type: groups[group].columns[path].type };
    const type = scalars[path]?.type ?? 'text';
    return { v: path in SYSTEM_SCALARS ? get(system, path) ?? system[path] : get(data, path), type };
  };
  const out = [];
  const emit = (nodes, row, group, index) => {
    for (const n of nodes) {
      if (n.type === 'text') out.push(n.value);
      else if (n.type === 'var') {
        if (n.path === 'qr') out.push(qr);
        else if (n.path === 'logo') out.push(logo);
        else if (n.path === 'page') out.push('[[PAGE]]');
        else if (n.path === 'pages') out.push('[[PAGES]]');
        else if (n.path === '@no' || n.path === '@index') out.push(String(index + 1));
        else { const { v, type } = value(n.path, row, group); out.push(esc(format(v, type, n.filter))); }
      } else if (n.type === 'if') emit(test(n.cond, (p) => (p === '@no' ? index + 1 : value(p, row, group).v)) ? n.then : n.other, row, group, index);
      else if (n.type === 'each') {
        const rows = Array.isArray(data[n.group]) ? data[n.group].slice(0, MAX_LOOP_ROWS) : [];
        rows.forEach((r, i) => emit(n.body, r, n.group, i));
      }
    }
  };
  emit(ast, null, null, 0);
  void cat;
  return out.join('');
}

/** The HTML wrapped for the renderer: the template's own style comes after the base style of the corporate design standard. */
export const documentHtml = (inner) => `<html><body>${inner}</body></html>`;
