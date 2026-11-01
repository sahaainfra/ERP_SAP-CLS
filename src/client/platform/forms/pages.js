// Where each form lives (part 03.02), so My Drafts can open a draft in its form. A module registers its forms when it loads.
const pages = new Map();

/** registerFormPage('ui.sample_request', (entityKey) => entityKey ? `/admin/sample-requests?open=${entityKey}` : '/admin/sample-requests?new=1') */
export function registerFormPage(formCode, toPath) {
  pages.set(formCode, toPath);
}

/** The address that opens a form (and record) again, or null when no page has registered it. */
export const formPageFor = (formCode, entityKey = '') => pages.get(formCode)?.(entityKey) ?? null;
