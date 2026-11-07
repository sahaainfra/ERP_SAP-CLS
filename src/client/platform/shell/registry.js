// Module route registration (FR-07). A module calls registerModule once; the shell builds navigation and
// routing from the registry. Pure JavaScript (no JSX) so it is unit-tested in Node.
const modules = new Map();

/**
 * registerModule({ code, label, routes: [{ path, label, permission, flag?, menu?, Page }] })
 * `menu: false` marks a record page (opened from its list with an id): it is routed but listed in no menu.
 * `permission` hides the navigation entry from users who lack it (the page still shows a no-permission
 * state if reached by URL); `flag` shows the entry only while that feature flag is ON.
 */
export function registerModule({ code, label, routes }) {
  if (!code || !Array.isArray(routes) || routes.length === 0) throw new Error('A module needs a code and at least one route');
  if (modules.has(code)) throw new Error(`Module "${code}" is already registered`);
  for (const r of routes) {
    if (!r.path?.startsWith('/') || !r.label || !r.Page) throw new Error(`Route ${JSON.stringify(r.path)} in module "${code}" needs a path, a label and a Page`);
    for (const other of modules.values()) {
      if (other.routes.some((x) => x.path === r.path)) throw new Error(`Path ${r.path} is already taken by module "${other.code}"`);
    }
  }
  modules.set(code, { code, label, routes: routes.map((r) => ({ ...r, module: code })) });
}

export const allRoutes = () => [...modules.values()].flatMap((m) => m.routes);

export const findRoute = (path) => allRoutes().find((r) => r.path === path);

export const defaultRoute = () => allRoutes()[0]?.path ?? '/';

/** Routes whose permission the user holds (the flag is checked per entry in the UI, as it needs a query). */
export const routesFor = (permissions) => allRoutes().filter((r) => !r.permission || permissions.includes(r.permission));

/** Test helper: forget every registration. */
export const resetRegistry = () => modules.clear();
