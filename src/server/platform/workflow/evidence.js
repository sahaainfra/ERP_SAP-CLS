/**
 * The evidence panel framework (part 04.03, FR-03). A module registers, for a document type, a function that reads what an approver needs to see before deciding:
 * the budget against what is committed, the last rates paid, the vendor's score, the stock on hand, the cash forecast, the contract consumed, the previous decisions
 * on similar items, the risk flags. Evidence is read when the panel is opened and never stored (BR-01), it is read-only, and nothing in it decides.
 *
 *   evidenceProviders.register('PO', ({ db, actor, instance, task, document }) => ({
 *     sections: [{ code: 'budget', title: 'Budget', kind: 'metrics', items: [{ label: 'Budget', value: 1250000, format: 'inr', mask: ['project_budget', 'amount'] }] }],
 *     flags: [{ code: 'single_source', label: 'Single source', severity: 'high' }],
 *   }))
 *
 * kinds: `metrics` (items: label, value, format inr|number|percent|text, tone, note), `table` (columns [{key,label,format}], rows) and `list` (items: label, detail).
 * A value with `mask: [entity, field]` is hidden or partly shown by the field masks of the permission engine. Providers of a document type run in the order registered;
 * one that fails is reported as unavailable and never stops the others.
 */
const providers = new Map();

export const evidenceProviders = {
  register(docType, fn) {
    if (typeof fn !== 'function') throw new Error(`Evidence provider for ${docType} must be a function`);
    providers.set(docType, [...(providers.get(docType) ?? []), fn]);
  },
  /** The providers of a document type (also the ones registered for every type, under "*"). */
  of: (docType) => [...(providers.get('*') ?? []), ...(providers.get(docType) ?? [])],
  hasFor: (docType) => (providers.get(docType) ?? []).length > 0,
  docTypes: () => [...providers.keys()].filter((k) => k !== '*').sort(),
};
