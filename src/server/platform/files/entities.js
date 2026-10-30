/**
 * The records files can be attached to. A module registers each record type once; the file service then asks the module
 * whether the caller may view or edit that record (BR-02: download needs view permission on the linked record) and whether
 * the record is locked (BR-03: files of an approved record can only be superseded, never removed).
 *
 *   fileEntities.register({
 *     entity: 'sample_document', label: 'Sample document',
 *     resolve(db, actor, id) -> null | { companyId, projectId, siteId, canView, canEdit, locked }
 *   })
 */
export function createFileEntityRegistry() {
  const entities = new Map();
  return {
    register({ entity, label, resolve }) {
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(entity ?? '')) throw new Error(`File entity "${entity}" must be lower-case letters, digits and underscores`);
      if (entities.has(entity)) throw new Error(`File entity ${entity} is already registered`);
      if (typeof resolve !== 'function') throw new Error(`File entity ${entity} needs a resolve function`);
      entities.set(entity, { entity, label: label ?? entity, resolve });
    },
    get: (entity) => entities.get(entity) ?? null,
    list: () => [...entities.values()].map(({ entity, label }) => ({ entity, label })),
  };
}

export const fileEntities = createFileEntityRegistry();
