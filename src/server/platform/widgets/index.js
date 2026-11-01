/**
 * The widget provider registry (part 03.07). A widget is a row of `ui_widgets` (what it is, who may use it) plus a provider here under the same
 * code (where its figures come from). The module that owns the data registers the provider, so what a widget may show is decided by the code
 * that decides what the list behind it may show (BR-01), and nothing is ever stored as a figure.
 *
 *   register({ code, provider(ctx) -> data })
 *     ctx = { db, actor, filters: { projectId, siteId, from, to }, params, ... }   what the framework hands every provider
 */
const providers = new Map();

export const widgetRegistry = {
  register({ code, provider }) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(code)) throw new Error(`Bad widget code ${code}`);
    if (providers.has(code)) throw new Error(`Widget ${code} is already registered`);
    providers.set(code, provider);
  },
  get: (code) => providers.get(code),
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
