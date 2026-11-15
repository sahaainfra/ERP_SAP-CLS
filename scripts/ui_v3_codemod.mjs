// Part 166.2 codemod: moves the pages onto the shared UI v3 components, once, so no module keeps a copy of the pattern.
//  1. U-01  <h1 …>T</h1> (+ a StatusBadge after it, + <p className="muted">intro</p>, + a plain <p> link row) -> <PageHeader id title status subtitle meta />;
//           a <div className="page-head"> row with the heading and its buttons -> <PageHeader … actions={…} />.
//  2. U-02  <div className="tiles"> -> <KpiRow>;  <div className="mdm-panel"><div className="muted">L</div><strong>V</strong>…</div> inside a
//           "form-grid" -> <KpiTile label value kind amount …/>, and a form grid that holds only such tiles -> <KpiRow>.
// The heading keeps its id and every data-testid stays where a test looks for it. Re-runnable: a file already moved is left alone.
// Usage: node scripts/ui_v3_codemod.mjs [--check] [files…]   (no files: every .jsx under src/client)
import * as espree from 'espree';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const SKIP = new Set(['src/client/platform/design/PageHeader.jsx', 'src/client/platform/feedback/states.jsx', 'src/client/platform/design/Kpi.jsx', 'src/client/platform/design/Card.jsx']);
const files = (args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : execSync('git ls-files "src/client/*.jsx"', { cwd: root }).toString().trim().split('\n')).filter((f) => !SKIP.has(f));

const parse = (src) => espree.parse(src, { ecmaVersion: 2025, sourceType: 'module', ecmaFeatures: { jsx: true }, range: true });
function walk(n, parent, fn) {
  if (!n || typeof n.type !== 'string') return;
  fn(n, parent);
  for (const k of Object.keys(n)) {
    if (k === 'range' || k === 'loc') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, n, fn)); else if (v && typeof v.type === 'string') walk(v, n, fn);
  }
}
const nameOf = (el) => (el.openingElement.name.type === 'JSXIdentifier' ? el.openingElement.name.name : null);
const attr = (el, name) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name);
const literalClass = (el) => { const a = attr(el, 'className'); return a?.value?.type === 'Literal' ? String(a.value.value) : a ? null : ''; };
const meaningful = (kids) => kids.filter((c) => !(c.type === 'JSXText' && !c.value.trim()) && !(c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression'));
const isEl = (n, name, cls) => n?.type === 'JSXElement' && nameOf(n) === name && (cls === undefined || literalClass(n) === cls);
const onlyAttrs = (el, allowed) => el.openingElement.attributes.every((a) => a.type === 'JSXAttribute' && allowed.includes(a.name.name));

function makeTools(src) {
  const text = (n) => src.slice(n.range[0], n.range[1]);
  /** The children of an element as one expression: a call, a string or a fragment. */
  const childrenExpr = (el) => {
    const kids = meaningful(el.children);
    if (kids.length === 1 && kids[0].type === 'JSXExpressionContainer') return text(kids[0].expression);
    if (kids.length === 1 && kids[0].type === 'JSXText') return JSON.stringify(kids[0].value.replace(/\s+/g, ' ').trim());
    if (kids.length === 1 && kids[0].type === 'JSXElement') return text(kids[0]);
    const inner = src.slice(el.openingElement.range[1], el.closingElement.range[0]).trim();
    return `<>${inner}</>`;
  };
  const attrValue = (a) => (a.value == null ? 'true' : a.value.type === 'Literal' ? a.value.raw : a.value.type === 'JSXExpressionContainer' ? text(a.value.expression) : text(a.value));
  const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
  return { text, childrenExpr, attrValue, key };
}

/** The PageHeader props of an <h1>: id, titleProps, srOnly, className, title. */
function headingProps(h1, t) {
  const props = [];
  const rest = [];
  for (const a of h1.openingElement.attributes) {
    if (a.type === 'JSXSpreadAttribute') { rest.push(`...${t.text(a.argument)}`); continue; }
    const n = a.name.name;
    if (n === 'id') props.push(`id=${a.value.type === 'Literal' ? a.value.raw : `{${t.text(a.value.expression)}}`}`);
    else if (n === 'className' && a.value?.type === 'Literal' && a.value.value === 'sr-only') props.push('srOnly');
    else if (n === 'className' && a.value?.type === 'Literal' && a.value.value === 'no-print') props.push('className="no-print"');
    else rest.push(`${t.key(n)}: ${t.attrValue(a)}`);
  }
  if (rest.length) props.push(`titleProps={{ ${rest.join(', ')} }}`);
  const kids = meaningful(h1.children);
  if (kids.length) props.push(`title={${t.childrenExpr(h1)}}`);
  return props;
}

/** What follows the heading in its parent and belongs to the header: a status badge, the intro, the link row. */
function absorbAfter(siblings, start, t) {
  const props = [];
  let end = null;
  let i = start;
  let gotStatus = false; let gotSub = false; let gotMeta = false;
  for (; i < siblings.length; i++) {
    const n = siblings[i];
    if (!gotStatus && !gotSub && !gotMeta && isEl(n, 'StatusBadge')) { props.push(`status={${t.text(n)}}`); gotStatus = true; end = n.range[1]; continue; }
    if (!gotSub && isEl(n, 'p', 'muted') && onlyAttrs(n, ['className']) && meaningful(n.children).length) { props.push(`subtitle={${t.childrenExpr(n)}}`); gotSub = true; end = n.range[1]; continue; }
    if (!gotMeta && isEl(n, 'p', '') && n.openingElement.attributes.length === 0 && meaningful(n.children).length) { props.push(`meta={${t.childrenExpr(n)}}`); gotMeta = true; end = n.range[1]; continue; }
    break;
  }
  return { props, end };
}

const childList = (parent) => (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment') ? meaningful(parent.children) : null);

// ---- the KPI shape ----
/** @type {Array<[RegExp, string]>} */
const KIND_WORDS = [[/day|late|age|overdue|time|hour|duration|delay/i, 'time'], [/risk|dispute|shortage|exposure|claim|deviation|hold|penalt|\bld\b/i, 'risk'], [/safety|incident|injur|permit/i, 'safety'], [/quality|ncr|inspect|test|reject/i, 'quality'], [/labour|people|staff|head|manpower|worker/i, 'people'], [/capacity|utili/i, 'capacity'], [/pct|percent|margin%|ratio|rate/i, 'percent'], [/qty|quantity|volume|cum|m3/i, 'quantity']];
function kpiOf(panel, t) {
  if (!isEl(panel, 'div') || !(literalClass(panel) ?? '').split(' ').includes('mdm-panel')) return null;
  const kids = meaningful(panel.children);
  const [lab, strong, ...extra] = kids;
  if (!isEl(lab, 'div') || !/^muted( small)?$/.test(literalClass(lab) ?? '') || !onlyAttrs(lab, ['className'])) return null;
  if (!isEl(strong, 'strong') || !onlyAttrs(strong, ['style', 'data-testid'])) return null;
  const value = t.childrenExpr(strong);
  const label = t.childrenExpr(lab);
  const props = [`label={${label}}`, `value={${value}}`];
  const m = /^(?:money|rs|inr|formatINR)\((.+)\)$/s.exec(value);
  const masked = /^(.+?) \? (.+?) : (?:money|rs)\((.+)\)$/s.exec(value);
  let kind;
  if (m) { kind = 'money'; props.push(`amount={${m[1]}}`); }
  else if (masked) { kind = 'money'; props.push(`amount={${masked[1]} ? null : ${masked[3]}}`); }
  else if (/pct|%/i.test(value)) kind = 'percent';
  else if (/fmtQty|qty\(|\bn\(/.test(value)) kind = 'quantity';
  else { const hay = `${label} ${value}`; kind = KIND_WORDS.find(([re]) => re.test(hay))?.[1] ?? 'count'; }
  props.push(`kind="${kind}"`);
  const vt = attr(strong, 'data-testid'); if (vt) props.push(`valueTestid=${vt.value.type === 'Literal' ? vt.value.raw : `{${t.text(vt.value.expression)}}`}`);
  for (const a of panel.openingElement.attributes) {
    if (a.type === 'JSXSpreadAttribute') props.push(`{...${t.text(a.argument)}}`);
    else if (a.name.name !== 'className') props.push(t.text(a));
  }
  const body = extra.map((e) => t.text(e)).join('');
  return extra.length ? `<KpiTile ${props.join(' ')}>${body}</KpiTile>` : `<KpiTile ${props.join(' ')} />`;
}
/** Every element a form grid shows: its children, and what a .map(...) or a && condition in them returns. */
function gridItems(grid) {
  const out = [];
  for (const c of meaningful(grid.children)) {
    if (c.type === 'JSXElement') { out.push(c); continue; }
    if (c.type !== 'JSXExpressionContainer') { out.push(c); continue; }
    let e = c.expression;
    if (e.type === 'LogicalExpression') e = e.right;
    if (e.type === 'CallExpression' && e.callee.property?.name === 'map') { const fn = e.arguments[0]; const b = fn?.body; out.push(b?.type === 'JSXElement' ? b : c); continue; }
    out.push(e.type === 'JSXElement' ? e : c);
  }
  return out;
}

function transform(file) {
  let src = readFileSync(resolve(root, file), 'utf8');
  const before = src;
  const used = new Set();
  for (let pass = 0; pass < 20; pass++) {
    const ast = parse(src);
    const t = makeTools(src);
    const edits = [];
    // the boxes that sit inside a form grid (the only ones the KPI rule is about)
    const inGrid = new Set();
    walk(ast, null, (g) => { if (g.type === 'JSXElement' && (literalClass(g) ?? '').split(' ').includes('form-grid')) walk(g, null, (x) => { if (x !== g && x.type === 'JSXElement') inGrid.add(x); }); });
    const add = (from, to, text, what) => { if (!edits.some((e) => from < e.to && to > e.from)) { edits.push({ from, to, text }); used.add(what); } };
    walk(ast, null, (n, parent) => {
      if (n.type !== 'JSXElement') return;
      // the heading row of a page: <div className="page-head"><h1/>…buttons</div>
      if (isEl(n, 'div', 'page-head') && onlyAttrs(n, ['className'])) {
        const kids = meaningful(n.children);
        const h1 = kids.find((k) => isEl(k, 'h1'));
        if (h1) {
          const props = headingProps(h1, t);
          const after = kids.slice(kids.indexOf(h1) + 1);
          const status = isEl(after[0], 'StatusBadge') ? after.shift() : null;
          if (status) props.push(`status={${t.text(status)}}`);
          const rest = [...kids.slice(0, kids.indexOf(h1)), ...after].filter((k) => !(isEl(k, 'span', 'spacer')));
          if (rest.length) props.push(`actions={<>${rest.map((k) => t.text(k)).join('')}</>}`);
          const sibs = childList(parent);
          let end = n.range[1];
          if (sibs) { const ab = absorbAfter(sibs, sibs.indexOf(n) + 1, t); props.push(...ab.props); if (ab.end) end = ab.end; }
          add(n.range[0], end, `<PageHeader ${props.join(' ')} />`, 'PageHeader');
          return;
        }
      }
      if (isEl(n, 'h1')) {
        if (parent?.type === 'JSXElement' && literalClass(parent) === 'page-head') return; // the row above takes it
        const props = headingProps(n, t);
        const sibs = childList(parent);
        let end = n.range[1];
        if (sibs) { const ab = absorbAfter(sibs, sibs.indexOf(n) + 1, t); props.push(...ab.props); if (ab.end) end = ab.end; }
        add(n.range[0], end, `<PageHeader ${props.join(' ')} />`, 'PageHeader');
        return;
      }
      // a row of tiles
      if (isEl(n, 'div', 'tiles')) {
        const open = n.openingElement; const close = n.closingElement;
        if (close) {
          const attrs = open.attributes.filter((a) => !(a.type === 'JSXAttribute' && a.name.name === 'className')).map((a) => t.text(a)).join(' ');
          add(open.range[0], open.range[1], `<KpiRow${attrs ? ` ${attrs}` : ''}>`, 'KpiRow');
          add(close.range[0], close.range[1], '</KpiRow>', 'KpiRow');
        }
        return;
      }
      // key figures laid out in the form grid
      if (n.type === 'JSXElement' && (literalClass(n) ?? '').split(' ').includes('mdm-panel') && inGrid.has(n)) {
        const kpi = kpiOf(n, t);
        if (kpi) add(n.range[0], n.range[1], kpi, 'KpiTile');
        return;
      }
      if (isEl(n, 'div') && (literalClass(n) ?? '').split(' ')[0] === 'form-grid' && n.closingElement) {
        const items = gridItems(n);
        if (items.length && items.every((i) => i.type === 'JSXElement' && (nameOf(i) === 'KpiTile' || kpiOf(i, t)))) {
          const open = n.openingElement;
          const cls = (literalClass(n) ?? '').split(' ').filter((c) => c !== 'form-grid');
          const attrs = open.attributes.filter((a) => !(a.type === 'JSXAttribute' && a.name.name === 'className')).map((a) => t.text(a));
          if (cls.length) attrs.unshift(`className="${cls.join(' ')}"`);
          add(open.range[0], open.range[1], `<KpiRow${attrs.length ? ` ${attrs.join(' ')}` : ''}>`, 'KpiRow');
          add(n.closingElement.range[0], n.closingElement.range[1], '</KpiRow>', 'KpiRow');
        }
      }
    });
    if (!edits.length) break;
    edits.sort((a, b) => b.from - a.from);
    for (const e of edits) src = src.slice(0, e.from) + e.text + src.slice(e.to);
  }
  if (src === before) return false;
  // the imports the new elements need
  const rel = (p) => { let r = relative(dirname(resolve(root, file)), resolve(root, p)).replace(/\\/g, '/'); if (!r.startsWith('.')) r = `./${r}`; return r; };
  const imports = [];
  if (used.has('PageHeader') && !/import PageHeader\b/.test(src)) imports.push(`import PageHeader from '${rel('src/client/platform/design/PageHeader.jsx')}';`);
  const kpiNames = ['KpiRow', 'KpiTile'].filter((k) => used.has(k) && new RegExp(`<${k}\\b`).test(src));
  if (kpiNames.length) {
    const existing = /import \{([^}]*)\} from '[^']*platform\/design\/Kpi\.jsx';/.exec(src);
    if (existing) { const names = new Set(existing[1].split(',').map((s) => s.trim()).filter(Boolean).concat(kpiNames)); src = src.replace(existing[0], existing[0].replace(existing[1], ` ${[...names].sort().join(', ')} `)); }
    else imports.push(`import { ${kpiNames.join(', ')} } from '${rel('src/client/platform/design/Kpi.jsx')}';`);
  }
  if (imports.length) {
    const ast = parse(src);
    const last = ast.body.filter((s) => s.type === 'ImportDeclaration').at(-1);
    const at = last ? last.range[1] : 0;
    src = `${src.slice(0, at)}${last ? '\n' : ''}${imports.join('\n')}${last ? '' : '\n'}${src.slice(at)}`;
  }
  parse(src); // still valid
  if (!check) writeFileSync(resolve(root, file), src);
  return true;
}

let changed = 0;
const failed = [];
for (const f of files) {
  try { if (transform(f)) { changed++; if (check) console.log(`would change ${f}`); } } catch (e) { failed.push(`${f}: ${e.message}`); }
}
console.log(`${check ? 'Would change' : 'Changed'} ${changed} of ${files.length} files.`);
if (failed.length) { console.error(failed.join('\n')); process.exit(1); }
if (check && changed) process.exit(1);
