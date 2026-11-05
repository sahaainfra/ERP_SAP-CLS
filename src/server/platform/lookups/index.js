import { Router } from 'express';
import { z } from 'zod';
import { assertPermission, assertPermissionAnywhere } from '../auth/index.js';
import { notFound } from '../http/errors.js';
import { likePattern, pageMeta } from '../pagination/index.js';
import { parse } from '../validation/index.js';

/**
 * The generic lookup contract (part 03.02, FR-01, FR-05): GET /api/v1/<module>/lookups/<name>?q=&page=&pageSize=&parent=&id=
 * answers { data: [{ id, code, name, extra }], meta: { page, pageSize, total, totalPages, columns } }. A module registers what it
 * can look up; the search runs on the server, paginated, inside the person's data scope. `id=` fetches chosen rows by id (so a
 * form can show the name of a saved value), `parent=` narrows a dependent lookup (project -> site -> cost centre).
 *
 * register({ module, name, label, permission, anywhere?, columns: [{ key, label }], search(db, actor, { like, parent, ids, limit, offset }) -> { rows, total } })
 */
const lookups = new Map();
const families = new Map();

export const lookupRegistry = {
  register(def) {
    if (!/^[a-z]+$/.test(def.module) || !/^[a-z][a-z-]*$/.test(def.name)) throw new Error(`Bad lookup name ${def.module}/${def.name}`);
    const key = `${def.module}/${def.name}`;
    if (lookups.has(key)) throw new Error(`Lookup ${key} is already registered`);
    lookups.set(key, { columns: [], anywhere: true, ...def });
  },
  /** A family of lookups served under one module by name (the lookup lists of 06.02): `resolve(name)` returns a definition or null. */
  registerFamily(module, resolve) { families.set(module, resolve); },
  get: (module, name) => lookups.get(`${module}/${name}`) ?? families.get(module)?.(name) ?? undefined,
  modules: () => [...new Set([...[...lookups.values()].map((l) => l.module), ...families.keys()])],
  list: () => [...lookups.values()].map((l) => ({ module: l.module, name: l.name, label: l.label, permission: l.permission, columns: l.columns })),
};

const query = z.object({
  q: z.string().max(100).optional().default(''),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  parent: z.coerce.number().int().positive().optional(),
  id: z.string().regex(/^\d+(,\d+){0,49}$/, 'A list of ids such as 3,7').optional(),
}).strict();

/** Run one lookup for an actor (used by the route and by tests). */
export function runLookup(db, actor, module, name, input) {
  const def = lookupRegistry.get(module, name);
  if (!def) throw notFound(`There is no lookup called ${module}/${name}.`);
  if (def.permission) (def.anywhere ? assertPermissionAnywhere : assertPermission)(actor, def.permission);
  const q = parse(query, input ?? {});
  const ids = q.id ? q.id.split(',').map(Number) : null;
  const { rows, total } = def.search(db, actor, { like: likePattern(q.q.trim()), text: q.q.trim(), parent: q.parent ?? null, ids, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return { data: rows, meta: { ...pageMeta(total, { page: q.page, pageSize: q.pageSize }), columns: def.columns, label: def.label } };
}

/** The router a module mounts at /api/v1/<module>/lookups. */
export function lookupRoutes(db, module) {
  const r = Router();
  r.get('/', (req, res) => res.json({ data: lookupRegistry.list().filter((l) => l.module === module) }));
  r.get('/:name', (req, res) => res.json(runLookup(db, req.actor, module, req.params.name, req.query)));
  return r;
}
