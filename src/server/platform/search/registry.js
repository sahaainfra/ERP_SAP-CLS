import { authzOf } from '../authz/index.js';

/**
 * The registries of global search (part 03.08). A module declares once what in it can be searched and what can be run from the palette:
 *
 *   searchEntities.register({
 *     type: 'project', label: 'Projects', labelHi, icon: 'erp.group.projects', order: 10,
 *     permission: 'org.view',                          the right needed to see a record of this type (a function of the document for types whose right varies)
 *     table: 'org_projects',                           the source table (company_id, id, updated_at, created_at): used to find what changed and to rebuild
 *     statuses: ['ACTIVE', ...],                       the values of the status filter of the advanced search
 *     events: ['iam.project.*'], eventEntity: 'project'   the domain events after which a record is indexed again (event.entity must equal eventEntity)
 *     load(db, id) -> doc | null                        reads the record as it is now; null (or inactive) removes it from the index
 *     route(id) -> '/admin/...'                         where a result opens
 *   })
 *
 * A document is { companyId, projectId, siteId, branchId, departmentId, ownerUserId, code, title, subtitle, body: [text...], status, docDate,
 * permissionKey, secrets: [{ entity, field, value }] }. Sensitive values (those with a mask rule) go in `secrets`, never in title, subtitle or body:
 * they are searched only by people whose roles show that field unmasked (BR-01).
 */
const entities = new Map();
const commands = new Map();

const KEY = /^[a-z][a-z0-9_]*$/;

export const searchEntities = {
  register(def) {
    if (!KEY.test(def.type)) throw new Error(`Searchable type "${def.type}" must be lower case with underscores`);
    if (entities.has(def.type)) throw new Error(`Searchable type ${def.type} is already registered`);
    for (const f of ['label', 'permission', 'table', 'load', 'route']) if (def[f] === undefined) throw new Error(`Searchable type ${def.type} needs ${f}`);
    /** Whether the actor may open this record now: the record is read again and the right is checked against its own place (used by recent records and favourites too). */
    const access = (db, actor, id) => {
      const doc = def.load(db, id);
      if (!doc || doc.companyId !== actor.companyId) return null;
      const key = doc.permissionKey ?? def.permission;
      const ok = authzOf(db).check(actor, key, { companyId: doc.companyId, projectId: doc.projectId ?? undefined, siteId: doc.siteId ?? undefined, branchId: doc.branchId ?? undefined, departmentId: doc.departmentId ?? undefined, ownerUserId: doc.ownerUserId ?? undefined }).allowed;
      return ok ? { companyId: doc.companyId, projectId: doc.projectId ?? null, siteId: doc.siteId ?? null, status: doc.status ?? null } : null;
    };
    entities.set(def.type, Object.freeze({ order: 100, access, icon: 'erp.action.search', statuses: [], events: [], eventEntity: def.type, permissionKeys: null, dateLabel: 'Updated', ...def }));
  },
  get: (type) => entities.get(type),
  list: () => [...entities.values()].sort((a, b) => a.order - b.order || a.type.localeCompare(b.type)),
  /** Every permission key a type of record may need (a type whose right varies by record declares them all in `permissionKeys`). */
  permissionKeys: () => [...new Set([...entities.values()].flatMap((d) => d.permissionKeys?.() ?? [typeof d.permission === 'string' ? d.permission : null]).filter(Boolean))],
  eventPatterns: () => [...new Set([...entities.values()].flatMap((d) => d.events))],
};

/**
 * commandRegistry.register({ code, label, labelHi, keywords, icon, group, permission, flag, route | clientAction, contexts: ['/admin/sample-requests'], requiresContext })
 *   permission  a right held anywhere (the page the command opens applies the scope), or 'self'
 *   route       a page of the application to open; clientAction one of the actions the shell itself performs (theme, language, help, sign out)
 *   contexts    page address prefixes where the command is offered first (context-aware quick actions)
 */
export const commandRegistry = {
  register(def) {
    if (!/^[a-z][a-z0-9_.-]*$/.test(def.code)) throw new Error(`Command code "${def.code}" is not valid`);
    if (commands.has(def.code)) throw new Error(`Command ${def.code} is already registered`);
    if (!def.route && !def.clientAction) throw new Error(`Command ${def.code} needs a route or a clientAction`);
    commands.set(def.code, Object.freeze({ keywords: '', icon: 'erp.action.create', group: 'Actions', permission: 'self', flag: null, contexts: [], requiresContext: null, ...def }));
  },
  get: (code) => commands.get(code),
  list: () => [...commands.values()],
};
