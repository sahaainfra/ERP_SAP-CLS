// PACK-05: literal design values outside the token files, counted so they can only go down (the ratchet in tests/design-literals.test.js).
//
// - erp/no-literal-length (ESLint, JS/JSX): a length written as a value in a style object or a style string, such as
//   `{ minHeight: 48 }`, `{ padding: '12px 8px' }` or `style="margin: 4px"`, instead of a token (var(--erp-space-3), var(--erp-size-...)).
//   0 and 1 px (hairlines) are allowed. Not switched on in eslint.config.js: the existing literals would flood the lint output;
//   the ratchet test runs it per file and compares the counts with docs/erp/design/literals-baseline.json.
// - scanCss(text): literal colours (hex, rgb/hsl/...) and px values in a stylesheet, outside comments; 0 and 1 px are allowed.
// Colours in JS/JSX are already an error (erp/no-hardcoded-color, part 03.01).
const LENGTH_PROPS = /^(margin|padding|gap|rowGap|columnGap|top|right|bottom|left|inset|width|height|minWidth|minHeight|maxWidth|maxHeight|fontSize|lineHeight|borderRadius|flexBasis|letterSpacing|outlineOffset)(Top|Right|Bottom|Left|Block|Inline|BlockStart|BlockEnd|InlineStart|InlineEnd)?$/;
const PX = /(?<![\w.-])(\d*\.?\d+)px\b/g;
const significant = (n) => Number(n) !== 0 && Number(n) !== 1;

export const pxValues = (text) => [...String(text).matchAll(PX)].map((m) => m[1]).filter(significant);

const HEX = /(^|[^\w&/?=-])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z_-])/g;
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/gi;

/** Literal colours and px values of a stylesheet: { colours: [{ line, value }], px: [{ line, value }] }. */
export function scanCss(text) {
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')); // keep line numbers
  const out = { colours: [], px: [] };
  src.split('\n').forEach((line, i) => {
    if (!line.includes(':')) return; // selectors and braces
    const value = line.slice(line.indexOf(':') + 1);
    if (/^\s*--erp-/.test(line)) return; // a token defined in place (none outside the token files today, but never counted)
    for (const m of value.matchAll(HEX)) out.colours.push({ line: i + 1, value: m[0].trim() });
    for (const m of value.matchAll(FUNC)) out.colours.push({ line: i + 1, value: m[0] });
    for (const v of pxValues(value)) out.px.push({ line: i + 1, value: `${v}px` });
  });
  return out;
}

const keyName = (k) => (k?.type === 'Identifier' ? k.name : k?.type === 'Literal' ? String(k.value) : null);

/** @type {import('eslint').Rule.RuleModule} */
const noLiteralLength = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Lengths in style objects and strings come from the design tokens (spacing, size, type scale).' },
    messages: { literal: 'Literal length "{{value}}" for {{prop}}: use a design token, for example var(--erp-space-3) or var(--erp-size-touch-min).' },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const prop = keyName(node.key);
        if (!prop || !LENGTH_PROPS.test(prop)) return;
        const v = node.value;
        if (v.type === 'Literal' && typeof v.value === 'number' && significant(v.value)) context.report({ node: v, messageId: 'literal', data: { value: String(v.value), prop } });
        else if (v.type === 'Literal' && typeof v.value === 'string') for (const px of pxValues(v.value)) context.report({ node: v, messageId: 'literal', data: { value: `${px}px`, prop } });
        else if (v.type === 'TemplateLiteral') for (const q of v.quasis) for (const px of pxValues(q.value.cooked ?? q.value.raw)) context.report({ node: v, messageId: 'literal', data: { value: `${px}px`, prop } });
      },
      // style="..." strings in markup built as text (print views, e-mails)
      JSXAttribute(node) {
        if (node.name?.name === 'style' && node.value?.type === 'Literal') for (const px of pxValues(node.value.value)) context.report({ node, messageId: 'literal', data: { value: `${px}px`, prop: 'style' } });
      },
    };
  },
};

export default { rules: { 'no-literal-length': noLiteralLength } };
