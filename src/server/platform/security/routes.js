import express from 'express';

// Route inventory (part 02.07, FR-01). Express keeps no record of where a router was mounted, so `use` is wrapped once, here, to
// remember the prefix of each mounted router; `collectRoutes` then walks the finished application and lists every route with its
// full path. Import this module before any router is built.
const mounts = new WeakMap();
const proto = express.Router.prototype;
if (!proto.__erpTracked) {
  const original = proto.use;
  proto.use = function tracked(...args) {
    const before = this.stack.length;
    const out = original.apply(this, args);
    const first = args[0];
    const prefixes = typeof first === 'string' ? [first] : Array.isArray(first) ? first.filter((p) => typeof p === 'string') : [''];
    for (const layer of this.stack.slice(before)) mounts.set(layer, prefixes);
    return out;
  };
  Object.defineProperty(proto, '__erpTracked', { value: true });
}

const join = (a, b) => `${a}${b === '/' ? '' : b}` || '/';

/** Every route of the application: [{ method, path }], full paths, parameters written as :name. */
export function collectRoutes(app) {
  const found = [];
  const walk = (router, prefix) => {
    for (const layer of router.stack ?? []) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) for (const method of Object.keys(layer.route.methods)) if (typeof p === 'string') found.push({ method: method.toUpperCase(), path: join(prefix, p) });
      } else if (layer.handle?.stack) {
        for (const p of mounts.get(layer) ?? ['']) walk(layer.handle, join(prefix, p === '/' ? '' : p));
      }
    }
  };
  walk(app.router ?? app._router, '');
  const seen = new Set();
  return found.filter((r) => (seen.has(`${r.method} ${r.path}`) ? false : seen.add(`${r.method} ${r.path}`))).sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

/** A pattern like "/api/v1/iam/users/:id" as a matcher for real request paths. */
export function patternRegex(pattern) {
  const BACKSLASH = String.fromCharCode(92);
  const literal = [...pattern].map((c) => ('.+?^${}()|[]'.includes(c) || c === BACKSLASH ? `${BACKSLASH}${c}` : c)).join('');
  return new RegExp(`^${literal.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}/?$`);
}
