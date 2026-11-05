/**
 * The object type registry (part 03.04). A module that has records shown on the Object Page registers its record type once; the shared
 * services (timeline, discussion, documents, related records, versions, print) and the endpoints `/api/v1/ui/objects/:type/:id/...` then
 * work for it without per-module code:
 *
 *   register({
 *     type: 'sample_request', label, permission,
 *     access(db, actor, id) -> { companyId, projectId, siteId, status } | null       whether the record exists for this actor (data scope applied)
 *     auditEntities(id) -> [{ entity, id }]                                          audit entries shown on the timeline
 *     approvalTarget: 'sample_request'                                               target_type of the approval requests that govern it
 *     documentType: 'SAMPLE_MR', attachmentEntity: 'sample_request'                  required documents and the file service record type
 *     related(db, actor, id) -> [{ kind, label, to, direction }]
 *     snapshot(db, actor, id) -> { header, lines }                                   the current copy, for the comparison with a saved version
 *     compare: { header: [{ key, label }], line: [{ key, label }] }
 *     maskSnapshot(db, actor, snapshot) -> snapshot                                  masks sensitive values of a snapshot for this actor
 *     maskEntries(db, actor, values) -> values                                       masks sensitive values of an audit entry's old or new values
 *     print(db, actor, id) -> { buffer, fileName }
 *     summary(db, actor, id) -> { label, status?, amount? }                           one line for trace panels and mention inboxes (part 04.14)
 *     search(db, actor, q, limit) -> [{ id }]                                          records the person may open, found by number or title (the record picker of Messages, part 05.01)
 *     projectRecords(db, companyId, projectId, limit) -> id[]                          the records of a project, for the project activity feed (part 04.14)
 *   })
 */
const types = new Map();

export const objectTypes = {
  register(def) {
    if (!/^[a-z][a-z_]*$/.test(def.type)) throw new Error(`Bad object type ${def.type}`);
    if (types.has(def.type)) throw new Error(`Object type ${def.type} is already registered`);
    types.set(def.type, def);
  },
  get: (type) => types.get(type),
  list: () => [...types.values()].map((t) => ({ type: t.type, label: t.label, permission: t.permission })),
};
