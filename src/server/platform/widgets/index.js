/**
 * The widget provider registry (part 03.07). A widget is a row of `ui_widgets` (what it is, who may use it) plus a provider here under the same
 * code (where its figures come from). The module that owns the data registers the provider, so what a widget may show is decided by the code
 * that decides what the list behind it may show (BR-01), and nothing is ever stored as a figure.
 *
 *   register({ code, provider(ctx) -> data })
 *     ctx = { db, actor, filters: { projectId, siteId, from, to }, params, ... }   what the framework hands every provider
 */
const providers = new Map();
const availability = new Map();

export const widgetRegistry = {
  register({ code, provider, available = undefined }) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(code)) throw new Error(`Bad widget code ${code}`);
    if (providers.has(code)) throw new Error(`Widget ${code} is already registered`);
    providers.set(code, provider);
    if (available) availability.set(code, available);
  },
  get: (code) => providers.get(code),
  available: (code, db, actor) => availability.get(code)?.(db, actor) ?? true,
  codes: () => [...providers.keys()].sort(),
};

/**
 * The sources of "my work" (tasks, approvals, things to acknowledge): each part that has such items registers a source and My Work lists them
 * together, so a new engine shows up in people's workspaces without touching the dashboard.
 *   register({ code, kind: 'task', label, list(db, actor) -> [{ id, title, due, route }] })
 */
const sources = new Map();
export const workSources = {
  register(def) {
    if (sources.has(def.code)) throw new Error(`Work source ${def.code} is already registered`);
    sources.set(def.code, def);
  },
  list: (db, actor, kind) => [...sources.values()].filter((s) => s.kind === kind).flatMap((s) => s.list(db, actor).map((i) => ({ ...i, source: s.label }))),
  kinds: () => [...new Set([...sources.values()].map((s) => s.kind))],
};

/**
 * Role layouts defined in code (part 166.5): a dashboard can name, per role, the layout a person of that role starts from when there is no
 * personal copy and no default saved for the role in `ui_dashboards` (a saved role default, approved in the Dashboard Designer, wins).
 *   register(dash, { ROLE: [{ id, widget, w, h }] })
 */
const roleLayoutMap = new Map();
export const roleLayouts = {
  register(dash, byRole) { roleLayoutMap.set(dash, byRole); },
  /** The first of the person's roles that has a layout, as [role, layout], else null. */
  for(dash, roles = []) {
    const byRole = roleLayoutMap.get(dash);
    if (!byRole) return null;
    for (const r of roles) if (byRole[r]) return [r, byRole[r]];
    return null;
  },
};
