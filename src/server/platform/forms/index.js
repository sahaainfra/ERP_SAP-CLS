import { notFound } from '../http/errors.js';

/**
 * Two hooks of the data-entry framework (part 03.02) that the owning modules fill in:
 *
 * Duplicate checks (FR-08): register({ name, label, permission?, check(db, actor, fields) -> [{ id, label, reason, link? }] }).
 * A form asks POST /api/v1/ui/duplicate-check/<name> with what has been typed so far and warns about similar records; it never
 * blocks on its own (the person decides; unique keys in the database still refuse a true duplicate).
 *
 * Create from (FR-09): register({ target, source, label, permission?, prefill(db, actor, sourceId) -> { values, note } }). A form
 * asks GET /api/v1/ui/create-from/<target>?source=<source>&id=<id> and starts pre-filled; the saved record keeps
 * source_type and source_id so the trace shows where it came from.
 */
const duplicates = new Map();
const creators = new Map();

export const duplicateChecks = {
  register(def) {
    if (duplicates.has(def.name)) throw new Error(`Duplicate check ${def.name} is already registered`);
    duplicates.set(def.name, def);
  },
  get(name) {
    const d = duplicates.get(name);
    if (!d) throw notFound(`There is no duplicate check called ${name}.`);
    return d;
  },
  names: () => [...duplicates.keys()],
};

export const createFrom = {
  register(def) {
    const key = `${def.target}<${def.source}`;
    if (creators.has(key)) throw new Error(`Create-from ${key} is already registered`);
    creators.set(key, def);
  },
  get(target, source) {
    const c = creators.get(`${target}<${source}`);
    if (!c) throw notFound(`A ${target} cannot be started from a ${source}.`);
    return c;
  },
  sourcesFor: (target) => [...creators.values()].filter((c) => c.target === target).map((c) => ({ source: c.source, label: c.label })),
};
