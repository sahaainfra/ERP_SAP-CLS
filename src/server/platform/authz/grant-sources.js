/**
 * Extra sources of role holdings (part 07.03). The engine reads role holdings from the stored role list, the assignment table and
 * elevations; a module whose own records confer access (an approved site deployment) registers a source here instead of writing into
 * the assignment table. A source is `(db, { companyId, userId, today }) => [{ roleCode, scopeType, scopeIds, via, ref }]` and must be
 * cheap: its answer is cached with the rest of the person's resolution and dropped by `authz.invalidate()`.
 */
const sources = new Map();

export const grantSources = {
  register(name, fn) {
    sources.set(name, fn);
  },
  has: (name) => sources.has(name),
  list: () => [...sources.entries()],
};

/**
 * The same holdings seen from the place (part 07.03, FR-05): who holds one of these roles in this scope because of another module's record.
 * A holder source is `(db, { companyId, roles, scope, today }) => username[]`; the messaging auto groups ask them with the assignment table.
 */
const holderSources = new Map();
export const holderSourcesOf = {
  register(name, fn) { holderSources.set(name, fn); },
  list: () => [...holderSources.entries()],
};
