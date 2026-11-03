/**
 * What the workflow engine (part 04.01) is told by the modules that use it.
 *
 *  workflowTypes.register({ docType, label, processOwner, route(docId), describe(db, companyId, docId), defaultDefinition, hooks })
 *    - docType: the kind of document, as it is written in the definitions (letters, digits and underscores)
 *    - processOwner: the role that owns the process; it is the second approver when a definition of this type is activated
 *    - route(docId): where the document opens, for the links in task lists and the Approvals tab
 *    - describe(db, companyId, docId): { ref, title, projectId?, siteId? } of the document, or null when it is not there
 *    - defaultDefinition: { name, settings?, steps } the chain a company starts with (the approval matrix of part 04.02 will replace it)
 *    - hooks: onSubmitted, onApproved, onRejected, onReturned, onResubmitted, onCancelled (db, { instance, actor, comment }); each runs in the same
 *      transaction as the decision, so a failure undoes the decision, and each is how a module sets its status and locks the record.
 *
 *    summarise(db, actor, docId) -> { fields: [{ label, value, format? }], lines: { columns: [{ key, label, format? }], rows: [] } } | null   (part 04.03: the document at a glance in the task drawer)
 *
 *  workflowResolvers.register(name, (ctx) => [user | { user } | { role }])
 *    ctx = { db, companyId, instance: { docType, docId, submittedBy, context }, step }. An empty list sends the task to the workflow administrators.
 *    The approval matrix of part 04.02 registers its resolver here.
 *
 *  systemActions.register(name, (db, { instance, step, actor }) => void)   what a "system" step does, in the transaction of the step before it.
 */
const types = new Map();
const resolvers = new Map();
const actions = new Map();
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

export const workflowTypes = {
  register(def) {
    if (!NAME.test(def.docType ?? '')) throw new Error(`Workflow document type "${def.docType}" must be letters, digits and underscores`);
    if (types.has(def.docType)) throw new Error(`Workflow document type ${def.docType} is already registered`);
    if (!def.defaultDefinition?.steps?.length) throw new Error(`Workflow document type ${def.docType} needs a default definition`);
    types.set(def.docType, { hooks: {}, processOwner: 'SYSADM', route: () => null, describe: () => null, summarise: () => null, ...def });
  },
  get: (docType) => types.get(docType) ?? null,
  list: () => [...types.values()].sort((a, b) => a.docType.localeCompare(b.docType)),
};

export const workflowResolvers = {
  register(name, fn) {
    if (resolvers.has(name)) throw new Error(`Workflow resolver ${name} is already registered`);
    resolvers.set(name, fn);
  },
  /** Tests replace a resolver to steer who is found. */
  replace(name, fn) { resolvers.set(name, fn); },
  get: (name) => resolvers.get(name) ?? null,
  names: () => [...resolvers.keys()].sort(),
};

export const systemActions = {
  register(name, fn) {
    if (actions.has(name)) throw new Error(`System action ${name} is already registered`);
    actions.set(name, fn);
  },
  get: (name) => actions.get(name) ?? null,
  names: () => [...actions.keys()].sort(),
};
