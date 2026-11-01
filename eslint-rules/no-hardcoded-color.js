// ESLint rule erp/no-hardcoded-color (part 03.01, BR-01): component code names colours through the design tokens
// (var(--erp-color-...)), never as a value. A hex colour (#fff, #1D4F91, #1D4F91CC) or an rgb()/hsl() call in a string, a template
// or JSX text is reported. The generated token files are not linted by this rule.
const HEX = /(^|[^\w&/?=-])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z_-])/;
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/i;

export const findColour = (text) => {
  if (typeof text !== 'string') return null;
  const hex = HEX.exec(text);
  if (hex) return hex[0].trim().replace(/^[^#]/, '');
  const fn = FUNC.exec(text);
  return fn ? fn[0] : null;
};

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Colours come from the design tokens, never from a value in component code.' },
    messages: { hardcoded: 'Hard-coded colour "{{value}}": use a design token, for example var(--erp-color-text-primary) or var(--erp-color-status-error-fg).' },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      const value = findColour(text);
      if (value) context.report({ node, messageId: 'hardcoded', data: { value } });
    };
    return {
      Literal(node) { if (typeof node.value === 'string') check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked ?? node.value.raw); },
      JSXText(node) { check(node, node.value); },
    };
  },
};

export default { rules: { 'no-hardcoded-color': rule } };
