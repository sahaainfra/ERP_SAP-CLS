// Helpers for the application shell (part 03.05): on a phone the menu is closed until its button is pressed, and the theme, language and
// sign-out live in the account menu. Specs go through these so they read the same on desktop and mobile.

/** The main navigation, opened first when the viewport keeps it behind the menu button. */
export async function menu(page) {
  const nav = page.locator('#sh-nav'); // named Main in English; its name follows the language of the screen
  await page.locator('#sh-nav').waitFor({ state: 'attached' }); // the shell has drawn (on a phone it is there but hidden)
  if (!(await nav.isVisible())) await page.locator('.sh-burger, [data-testid="bottom-more"]').filter({ visible: true }).first().click(); // the button is named Open menu in English
  return nav;
}

/** The account menu (language, theme, sign out), opened. */
export async function userMenu(page) {
  const button = page.getByTestId('user-menu');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  return page.locator('.sh-user-pop'); // its name is the account menu in the language of the screen
}

export async function setTheme(page, theme) {
  await (await userMenu(page)).getByLabel('Theme').selectOption(theme);
}

export async function signOut(page) {
  await (await userMenu(page)).getByRole('menuitem', { name: 'Sign out' }).click();
}

// ---- part 166.1 F-02: what a role's menu holds is read from the navigation registry seed and the role templates, never typed into a spec ----
import { DatabaseSync } from 'node:sqlite';
import { TEMPLATE_PERMISSIONS } from '../src/server/platform/authz/templates.js';

/**
 * The groups (by label) and pages (by label) the registry gives to a role: pages of the sidebar whose permission the role holds (or needs none)
 * and whose feature flag is on in the test environment. A page that also needs a project or another condition may still be hidden, so a spec
 * uses the page list as "may appear" and the group list as "these and no others are drawn" only for groups it can prove empty.
 */
export function registryMenu(role, { env = 'test' } = {}) {
  const d = new DatabaseSync('data/e2e.sqlite', { readOnly: true });
  try {
    const perms = new Set(TEMPLATE_PERMISSIONS[role] ?? []); const flagOn = (key) => { if (!key) return true; const rows = d.prepare('SELECT environment, enabled, default_enabled FROM core_feature_flags WHERE key = ?').all(key); if (!rows.length) return true; const own = rows.find((r) => r.environment === env) ?? rows.find((r) => r.environment == null); return Boolean(own ? (own.environment === env ? own.enabled : own.default_enabled || own.enabled) : false); };
    const entries = d.prepare("SELECT code, parent_code, kind, label, permission_key, feature_flag FROM ui_navigation_entries WHERE deleted_at IS NULL AND placement = 'sidebar'").all();
    const byCode = new Map(entries.map((e) => [e.code, e])); const pages = entries.filter((e) => e.kind === 'page' && (!e.permission_key || perms.has(e.permission_key)) && flagOn(e.feature_flag));
    return { pages: new Set(pages.map((p) => p.label)), groups: new Set(pages.map((p) => byCode.get(p.parent_code)?.label).filter(Boolean)), allPages: new Set(entries.filter((e) => e.kind === 'page').map((p) => p.label)) };
  } finally { d.close(); }
}
