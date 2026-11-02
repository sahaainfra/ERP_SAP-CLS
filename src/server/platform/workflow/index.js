import { createWorkflowEngine } from './engine.js';

export { createDefinitionService, DEFINITION_DOC_TYPE } from './definitions.js';
export { meets, normaliseDefinition, packSteps, unpackSteps } from './definition.js';
export { ADAPTED_TYPES, createLegacyAdapter, legacyAdapterOf, legacyDocType, legacyFlag } from './legacy.js';
export { systemActions, workflowResolvers, workflowTypes } from './registry.js';
import './resolvers.js';
export { createWorkflowEngine } from './engine.js';

const engines = new WeakMap();
/** The one workflow engine of a database, made on first use, so the screens and modules that read tasks share it. */
export function workflowOf(db) {
  let e = engines.get(db);
  if (!e) { e = createWorkflowEngine({ db }); engines.set(db, e); }
  return e;
}
