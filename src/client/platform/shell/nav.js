// Pure helpers of the application shell (part 03.05): they work on the payload of GET /api/v1/ui/navigation and are unit-tested in Node.

const pathOf = (route) => route.split('?')[0];

/** Every page entry the person may open, with its group. */
export const flatPages = (nav) => (nav?.groups ?? []).flatMap((g) => g.pages.map((p) => ({ ...p, group: g.code, groupLabel: g.label, placement: g.placement })));

/** The entry for an address (ignoring a query string), or undefined. */
export const entryFor = (nav, path) => flatPages(nav).find((p) => pathOf(p.route) === pathOf(path));

/** The registry line for an address the person may not open (hidden from the menu), with why. */
export const deniedFor = (nav, path) => (nav?.denied ?? []).find((d) => pathOf(d.route) === pathOf(path));

/**
 * The trail above a page (FR-05): Home, the group, the page. Home has no trail of its own; a page of the account menu or the technical
 * console is named under it.
 */
export function breadcrumbs(nav, path) {
  const entry = entryFor(nav, path);
  if (!entry) return [];
  if (entry.code === 'home') return [{ label: entry.label, to: null }];
  const crumbs = [{ label: 'Home', to: '/home' }];
  if (entry.groupLabel && entry.group !== 'g-home') crumbs.push({ label: entry.groupLabel, to: null });
  crumbs.push({ label: entry.label, to: null });
  return crumbs;
}

/** The page title, the same way for every page: "Page - Group - ERP". */
export function titleFor(nav, path, fallback = 'ERP') {
  const entry = entryFor(nav, path);
  if (!entry) return fallback;
  return entry.code === 'home' ? `${entry.label} - ERP` : `${entry.label} - ${entry.groupLabel} - ERP`;
}

/**
 * Whether a page may be drawn (FR-08): the permission and the feature flag are the server's answer (a page not in the person's menu is
 * either denied or unknown), and a page that needs a project or a site needs one in the working context.
 * Returns { ok: true } or { ok: false, reason: 'permission' | 'flag' | 'context', ... }.
 */
export function guard(nav, path, { knownRoute, context = {} } = {}) {
  if (!nav) return { ok: true };
  const entry = entryFor(nav, path);
  if (entry) {
    if (entry.requiresContext === 'project' && !context.projectId) return { ok: false, reason: 'context', need: 'project', entry };
    if (entry.requiresContext === 'site' && !context.siteId) return { ok: false, reason: 'context', need: 'site', entry };
    return { ok: true, entry };
  }
  const denied = deniedFor(nav, path);
  if (denied) return { ok: false, reason: denied.reason, permissionKey: denied.permissionKey, featureFlag: denied.featureFlag, label: denied.label };
  return knownRoute ? { ok: true } : { ok: false, reason: 'unknown' };
}

const norm = (s) => String(s ?? '').toLowerCase();

/** Entries matching a typed phrase, best first: label start, label contains, keyword, group (FR-07 go-to search; 03.08 adds records). */
export function searchEntries(nav, q, limit = 12) {
  const needle = norm(q).trim();
  if (!needle) return [];
  const scored = [];
  for (const p of flatPages(nav)) {
    const label = norm(p.label);
    const words = norm(p.keywords);
    let score = 0;
    if (label.startsWith(needle)) score = 4;
    else if (label.includes(needle)) score = 3;
    else if (needle.split(/\s+/).every((w) => words.includes(w) || label.includes(w))) score = 2;
    else if (norm(p.groupLabel).includes(needle)) score = 1;
    if (score) scored.push({ p, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.p.label.localeCompare(b.p.label)).slice(0, limit).map((x) => x.p);
}

/** letter -> route for the "g then a letter" shortcuts (FR-07). */
export function shortcutMap(nav) {
  const map = {};
  for (const p of flatPages(nav)) if (p.shortcut && !map[p.shortcut]) map[p.shortcut] = p;
  return map;
}

/** The sidebar's groups for the viewport: sidebar placement only, pages hidden on phones left out when `mobile`; empty groups dropped. */
export function sidebarGroups(nav, { mobile = false } = {}) {
  return (nav?.groups ?? [])
    .filter((g) => g.placement === 'sidebar')
    .map((g) => ({ ...g, pages: g.pages.filter((p) => !mobile || p.mobileVisible) }))
    .filter((g) => g.pages.length > 0);
}

export const consoleGroup = (nav) => (nav?.groups ?? []).find((g) => g.placement === 'console') ?? null;
export const accountGroup = (nav) => (nav?.groups ?? []).find((g) => g.placement === 'user_menu') ?? null;

/** Whether a page of the group is the current one (so the group opens by itself). */
export const groupHolds = (group, path) => group.pages.some((p) => pathOf(p.route) === pathOf(path));

/** Menu entries of a person who is still being onboarded: only what the onboarding rules allow. */
export const forOnboarding = (nav, onboarding) => ({
  ...nav,
  groups: (nav?.groups ?? []).map((g) => ({ ...g, pages: g.pages.filter((p) => (onboarding ? p.onboarding !== 'none' : p.onboarding !== 'only')) })).filter((g) => g.pages.length > 0),
});
