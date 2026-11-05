/**
 * Policy-to-protocol (part 05.05): a company policy names requirements that can be enforced by the system. A module that owns an engine registers how a requirement becomes a DRAFT in that engine; the policy module
 * calls it and never writes into the engine's tables. A draft is inactive by construction (a control point that is OFF, an approval matrix version that is a DRAFT, an alert rule that is switched off) and is
 * reviewed and activated only through the engine's own screen and approval (BR-02).
 *
 *   policyDrafts.register({ type: 'CONTROL_POINT', label, part, permission, validate(config) -> problems[],
 *                           create(db, { companyId, owner, requirementId, policyNo, clauseRef }, config) -> { entity, id, label, route },
 *                           status(db, companyId, id) -> { state: 'DRAFT' | 'PENDING' | 'ACTIVE' | 'GONE', label } })
 */
const types = new Map();
export const policyDrafts = {
  register(def) { types.set(def.type, def); },
  get: (type) => types.get(type) ?? null,
  list: () => [...types.values()].map(({ type, label, part, permission }) => ({ type, label, part, permission })),
};
