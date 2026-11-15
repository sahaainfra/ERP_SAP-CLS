// ESLint rule erp/no-local-date-format (part 166.1 F-04): dates and times are formatted by the one shared module (src/shared/dates.js:
// fmtDate, fmtDateTime, fmtRelative, all in Asia/Kolkata). A module that defines its own function of that name is reported; re-exporting the shared one is fine.
const NAMES = new Set(['fmtDate', 'fmtDateTime', 'fmtRelative']);
/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: { type: 'problem', docs: { description: 'Dates are formatted by src/shared/dates.js, never by a copy in a module.' }, messages: { local: '"{{name}}" is defined here: import it from src/shared/dates.js (fmtDate, fmtDateTime, fmtRelative) so every page shows the same IST date and time.' }, schema: [] },
  create(context) {
    const report = (node, name) => context.report({ node, messageId: 'local', data: { name } });
    return {
      VariableDeclarator(node) { if (node.id.type === 'Identifier' && NAMES.has(node.id.name) && node.init && /Function/.test(node.init.type)) report(node, node.id.name); },
      FunctionDeclaration(node) { if (node.id && NAMES.has(node.id.name)) report(node, node.id.name); },
    };
  },
};
export default { rules: { 'no-local-date-format': rule } };
