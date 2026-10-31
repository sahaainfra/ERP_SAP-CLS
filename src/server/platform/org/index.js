export { DEFAULT_TOLERANCE_M, MAX_RADIUS_M, MAX_TOLERANCE_M, MIN_RADIUS_M, distanceM, geofenceProblems, polygonProblems, testPoint } from './geo.js';

/**
 * Blockers: later modules (attendance, stock, billing, payroll...) say which open records stop a site, project or other
 * organisation unit from being deactivated (BR-03). A blocker is a function `(db, {companyId, id}) => [{ type, count, hint }]`;
 * deactivation is refused, with every blocker listed, if any returns a count above zero.
 */
const blockers = new Map();

export const orgBlockers = {
  /** Register a blocker for an entity ('company', 'branch', 'department', 'project', 'site', 'location', 'cost_centre', 'designation'). */
  register(entity, name, fn) {
    if (!blockers.has(entity)) blockers.set(entity, new Map());
    blockers.get(entity).set(name, fn);
  },
  unregister(entity, name) {
    blockers.get(entity)?.delete(name);
  },
  collect(db, entity, ctx) {
    const found = [];
    for (const [name, fn] of blockers.get(entity) ?? []) {
      for (const b of fn(db, ctx) ?? []) if (b.count > 0) found.push({ source: name, ...b });
    }
    return found;
  },
};
