// ESLint rule erp/kpi-in-form-grid (part 166.2, FR-03 / U-02): a key figure is a KpiTile inside a KpiRow (src/client/platform/design/Kpi.jsx),
// never a <strong> in an "mdm-panel" box laid out by a "form-grid" (the input-form grid). The form grid is for fields; figures need the tile's
// abbreviation (₹ 2.43 Cr with the exact value in the tooltip), icon, unit and trend, and they must read the same on every page.
const classOf = (el) => {
  const a = el.openingElement.attributes.find((x) => x.type === 'JSXAttribute' && x.name?.name === 'className');
  if (!a?.value) return '';
  if (a.value.type === 'Literal') return String(a.value.value);
  const e = a.value.expression;
  if (e?.type === 'Literal') return String(e.value);
  if (e?.type === 'TemplateLiteral') return e.quasis.map((q) => q.value.cooked).join(' ');
  return '';
};
const hasClass = (el, name) => classOf(el).split(/\s+/).includes(name);
const SKIP = new Set(['parent', 'loc', 'range']);

/** Every JSX element below a node, whatever lies between (expressions, .map callbacks, conditionals). */
function* elementsBelow(node) {
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue;
    const v = node[key];
    const kids = Array.isArray(v) ? v : [v];
    for (const k of kids) {
      if (!k || typeof k.type !== 'string') continue;
      if (k.type === 'JSXElement') yield k;
      yield* elementsBelow(k);
    }
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Key figures are KpiTile/KpiRow, not <strong> in an mdm-panel inside a form-grid.' },
    messages: { tileInGrid: 'A KpiTile/KpiRow is inside a "form-grid": the form grid is for fields; put the tiles in their own <KpiRow> (part 166.2, U-02).', kpi: 'A key figure is drawn as <strong> in an "mdm-panel" inside a "form-grid": use <KpiRow><KpiTile …/></KpiRow> from platform/design/Kpi.jsx (part 166.2, U-02).' },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        if (!hasClass(node, 'form-grid')) return;
        for (const el of elementsBelow(node)) {
          const tag = el.openingElement.name.type === 'JSXIdentifier' ? el.openingElement.name.name : '';
          if (tag === 'KpiTile' || tag === 'KpiRow') { context.report({ node: el, messageId: 'tileInGrid' }); continue; }
          if (!hasClass(el, 'mdm-panel')) continue;
          const strong = [...elementsBelow(el)].some((x) => x.openingElement.name.type === 'JSXIdentifier' && x.openingElement.name.name === 'strong');
          if (strong) { context.report({ node: el, messageId: 'kpi' }); }
        }
      },
    };
  },
};
export default { rules: { 'kpi-in-form-grid': rule } };
