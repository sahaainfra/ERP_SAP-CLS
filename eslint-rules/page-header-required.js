// ESLint rule erp/page-header-required (part 166.2, FR-03 / U-01): a page names itself with the shared <PageHeader> (platform/design/PageHeader.jsx),
// never with an <h1> of its own, so every page has the same header (title, subtitle, status, key facts, actions, "…" menu) and a later part changes
// it in one place. The level-1 heading is drawn by PageHeader alone; the standard states (states.jsx) choose their heading level at run time.
// The end-to-end check that each registered page really shows one is e2e/ui-v3.spec.js.
/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'A page renders PageHeader; no <h1> outside platform/design/PageHeader.jsx.' },
    messages: { h1: 'Use <PageHeader id=… title=… subtitle=… actions=… /> from platform/design/PageHeader.jsx instead of an <h1> of the page\'s own (part 166.2, U-01). scripts/ui_v3_codemod.mjs does it for you.' },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'h1') context.report({ node, messageId: 'h1' });
      },
    };
  },
};
export default { rules: { 'page-header-required': rule } };
