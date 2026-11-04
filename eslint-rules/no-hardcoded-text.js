// Part 03.09, BR-01: no user-visible string is written into a component. The rule reads the text of JSX (between tags) and the attributes people
// hear or read (aria-label, title, placeholder, alt, label) and refuses a literal with words in it; text comes from useT('area') and the catalogue in
// src/shared/i18n/locales. It runs on the files that have been moved to the catalogue (eslint.config.js lists them); the others are tracked in
// docs/erp/DEFECTS.md and are added to the list as they are moved.
const ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'aria-description', 'aria-placeholder']);
const ALLOWED_TAGS = new Set(['code', 'kbd', 'pre', 'style', 'script']);
const hasWords = (s) => /\p{L}{2,}/u.test(s.replace(/\bERP\b/g, ''));

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: { type: 'problem', schema: [], messages: { text: 'User-visible text "{{text}}" must come from the catalogue: use t(\'key\') from useT(\'area\') and add the English and Hindi to src/shared/i18n/locales.' } },
  create(context) {
    const inAllowedTag = (node) => {
      for (let p = node.parent; p; p = p.parent) if (p.type === 'JSXElement' && p.openingElement.name.type === 'JSXIdentifier' && ALLOWED_TAGS.has(p.openingElement.name.name)) return true;
      return false;
    };
    return {
      JSXText(node) {
        const text = node.value.replace(/\s+/g, ' ').trim();
        if (text && hasWords(text) && !inAllowedTag(node)) context.report({ node, messageId: 'text', data: { text: text.slice(0, 40) } });
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !ATTRIBUTES.has(node.name.name)) return;
        const v = node.value;
        if (v?.type === 'Literal' && typeof v.value === 'string' && hasWords(v.value)) context.report({ node: v, messageId: 'text', data: { text: v.value.slice(0, 40) } });
      },
      // a string literal inside a JSX expression that is shown as text: {'...'} or {cond ? '...' : '...'} directly as a child
      JSXExpressionContainer(node) {
        if (node.parent.type !== 'JSXElement') return;
        const strings = [];
        const walk = (e) => {
          if (!e) return;
          if (e.type === 'Literal' && typeof e.value === 'string') strings.push(e);
          else if (e.type === 'ConditionalExpression') { walk(e.consequent); walk(e.alternate); }
          else if (e.type === 'LogicalExpression') walk(e.right);
          else if (e.type === 'TemplateLiteral' && e.expressions.length === 0) strings.push({ value: e.quasis[0].value.cooked, ...e });
        };
        walk(node.expression);
        for (const s of strings) if (hasWords(String(s.value)) && !inAllowedTag(node)) context.report({ node: s, messageId: 'text', data: { text: String(s.value).slice(0, 40) } });
      },
    };
  },
};
