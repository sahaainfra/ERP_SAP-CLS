import { createHash } from 'node:crypto';
import { grantSources } from './grant-sources.js';
import { createParameterStore } from '../parameters/index.js';
import { CONFIDENTIALITY_LEVELS, ROLE_TEMPLATES, TEMPLATE_FIELD_MASKS, TEMPLATE_PERMISSIONS } from './templates.js';
import { LEGACY_ROLE_PERMISSIONS } from './legacy.js';
import { fieldRegistry, hierarchyRegistry, parseKey, permissionRegistry, recordResolvers } from './registry.js';

const istDate = (ms) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
const RANK = { hide: 0, partial: 1, show: 2 };
const ids = (list) => [...list].filter((n) => Number.isInteger(n) && n > 0);
const emptyScope = () => ({ company: false, projects: new Set(), sites: new Set(), branches: new Set(), departments: new Set(), own: false });
const hierarchyKey = (entity) => `iam.hierarchy.reportees_${entity.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;

/**
 * The permission engine (part 02.04). One place decides what a person may do:
 *   RBAC   a person holds roles, each a set of allow and deny grants;
 *   scope  a role is held for the whole company or only for a branch, department, project, site or the person's own records;
 *   masks  sensitive fields are hidden or partly shown by role;
 *   rules  deny beats allow, nothing is allowed unless a grant says so, a record's confidentiality caps what a role may read.
 * What a request carries (`actor.grants`) is computed here and cached per person for `ttlMs`, so a change reaches every instance
 * within 60 seconds even without the in-process invalidation that makes it immediate on the instance that made it (FR-06).
 */
export function createAuthz({ db, now = () => Date.now(), ttlMs = 30_000 }) {
  const roleTables = new Map(); // companyId -> { at, byCode, byId }
  const effective = new Map(); // key -> { at, value }

  const has = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  const asSet = (json) => { try { return JSON.parse(json ?? '[]'); } catch { return []; } };

  // ---- roles, as stored (falling back to the code templates for a database that has not been seeded) ----
  function roleTable(companyId) {
    const hit = roleTables.get(companyId ?? 0);
    if (hit && now() - hit.at < ttlMs) return hit;
    const byCode = new Map();
    const byId = new Map();
    if (has('iam_roles')) {
      const rows = db.prepare('SELECT id, company_id, code, name, status, clearance, kind FROM iam_roles WHERE is_active = 1 AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').all(companyId ?? -1);
      const grants = new Map();
      for (const g of db.prepare('SELECT g.role_id, g.perm_key, g.effect FROM iam_role_permissions g JOIN iam_roles r ON r.id = g.role_id WHERE g.is_active = 1 AND r.is_active = 1 AND (r.company_id IS NULL OR r.company_id = ?)').all(companyId ?? -1)) {
        if (!grants.has(g.role_id)) grants.set(g.role_id, { allow: new Set(), deny: new Set() });
        grants.get(g.role_id)[g.effect === 'deny' ? 'deny' : 'allow'].add(g.perm_key);
      }
      for (const r of rows) {
        const g = grants.get(r.id) ?? { allow: new Set(), deny: new Set() };
        const role = { id: r.id, code: r.code, name: r.name, status: r.status, clearance: r.clearance, kind: r.kind, allow: g.allow, deny: g.deny, stored: true };
        byCode.set(r.code, role);
        byId.set(r.id, role);
      }
    }
    const table = { at: now(), byCode, byId };
    roleTables.set(companyId ?? 0, table);
    return table;
  }
  /** A system role that is not in the database yet: its template. */
  const templateRole = (code) => {
    const t = ROLE_TEMPLATES.find((x) => x.code === code);
    return t ? { id: null, code, name: t.name, status: 'ACTIVE', clearance: t.clearance, kind: 'SYSTEM', allow: new Set(t.permissions), deny: new Set(), stored: false } : null;
  };

  // ---- scope expansion ----
  function expandScope(type, scopeIds, companyId) {
    const s = emptyScope();
    const list = ids(scopeIds);
    if (type === 'COMPANY') s.company = true;
    else if (type === 'OWN') s.own = true;
    else if (type === 'PROJECT') list.forEach((i) => s.projects.add(i));
    else if (type === 'SITE') list.forEach((i) => s.sites.add(i));
    else if (type === 'BRANCH') list.forEach((i) => s.branches.add(i));
    else if (type === 'DEPARTMENT') {
      if (list.length && has('org_departments')) {
        for (const r of db.prepare(`WITH RECURSIVE d(id) AS (SELECT id FROM org_departments WHERE id IN (${list.join(',')}) AND company_id = ? UNION SELECT t.id FROM org_departments t JOIN d ON t.parent_id = d.id) SELECT id FROM d`).all(companyId)) s.departments.add(r.id);
      }
    }
    if (s.branches.size && has('org_projects')) for (const r of db.prepare(`SELECT id FROM org_projects WHERE company_id = ? AND branch_id IN (${[...s.branches].join(',')})`).all(companyId)) s.projects.add(r.id);
    return s;
  }
  const merge = (into, from) => {
    into.company ||= from.company;
    into.own ||= from.own;
    for (const k of ['projects', 'sites', 'branches', 'departments']) from[k].forEach((v) => into[k].add(v));
  };

  /** The people a manager sees records of: members of the departments they head, and of those departments' sub-departments. */
  function reporteesOf(userId, companyId) {
    if (!userId || !has('org_assignments') || !has('iam_user_profiles')) return new Set();
    const heads = db.prepare("SELECT entity_id FROM org_assignments WHERE company_id = ? AND user_id = ? AND entity_type = 'DEPARTMENT' AND role = 'HEAD' AND applied = 1 AND effective_to IS NULL AND is_active = 1").all(companyId, userId).map((r) => r.entity_id);
    if (!heads.length) return new Set();
    const rows = db.prepare(`WITH RECURSIVE d(id) AS (SELECT id FROM org_departments WHERE id IN (${heads.join(',')}) UNION SELECT t.id FROM org_departments t JOIN d ON t.parent_id = d.id) SELECT p.user_id FROM iam_user_profiles p WHERE p.department_id IN (SELECT id FROM d) AND p.company_id = ? AND p.user_id != ?`).all(companyId, userId);
    return new Set(rows.map((r) => r.user_id));
  }

  function hierarchyOn(entity, companyId) {
    const reg = hierarchyRegistry.get(entity);
    if (!reg) return false;
    const key = hierarchyKey(entity);
    try {
      return createParameterStore(db).get(key, { companyId, date: istDate(now()) }) === true;
    } catch {
      return reg.defaultOn;
    }
  }

  /**
   * Everything the engine knows about one person: the roles they hold (company-wide and scoped), what each grants and where,
   * their masks, clearance and reportees. `roles` are codes the person holds company-wide outside the assignment table (the stored
   * role list of part 02.03, or the roles of a development header).
   */
  function resolve({ companyId, userId = null, roles = [], extra = [] }) {
    const ck = `${companyId}|${userId ?? ''}|${[...roles].sort().join(',')}`;
    const hit = extra.length === 0 ? effective.get(ck) : null;
    // a cached answer is good for ttlMs, and never past the moment an elevation starts or ends
    if (hit && now() - hit.at < ttlMs && now() < hit.value.validUntil) return hit.value;
    const table = roleTable(companyId);
    const today = istDate(now());
    const holdings = [];
    for (const code of roles) {
      const role = table.byCode.get(code) ?? templateRole(code);
      if (role && role.status === 'ACTIVE') holdings.push({ role, scopeType: 'COMPANY', scopeIds: [], assignmentId: null, via: 'role list' });
    }
    if (userId && has('iam_assignments')) {
      for (const a of db.prepare("SELECT id, role_id, scope_type, scope_ids_json, effective_from, effective_to FROM iam_assignments WHERE user_id = ? AND company_id = ? AND status = 'ACTIVE' AND is_active = 1 AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)").all(userId, companyId, today, today)) {
        const role = table.byId.get(a.role_id);
        if (role && role.status === 'ACTIVE') holdings.push({ role, scopeType: a.scope_type, scopeIds: asSet(a.scope_ids_json), assignmentId: a.id, via: 'assignment' });
      }
    }
    // Holdings conferred by other modules' records (part 07.03: an approved site deployment); a failing source gives nothing.
    if (userId) {
      for (const [name, fn] of grantSources.list()) {
        let given = [];
        try { given = fn(db, { companyId, userId, today }) ?? []; } catch { given = []; }
        for (const g of given) {
          const role = table.byCode.get(g.roleCode) ?? templateRole(g.roleCode);
          if (role && role.status === 'ACTIVE') holdings.push({ role, scopeType: g.scopeType, scopeIds: g.scopeIds ?? [], assignmentId: null, via: g.via ?? name, ref: g.ref });
        }
      }
    }
    // Time-boxed elevations (part 02.05): in force between their start and end to the second.
    let validUntil = Infinity;
    const elevations = [];
    if (userId && has('iam_elevations')) {
      const stamp = new Date(now()).toISOString();
      for (const el of db.prepare("SELECT id, role_id, scope_type, scope_ids_json, starts_at, ends_at FROM iam_elevations WHERE user_id = ? AND company_id = ? AND status = 'ACTIVE' AND is_active = 1 AND ends_at > ?").all(userId, companyId, stamp)) {
        const role = table.byId.get(el.role_id);
        if (!role || role.status !== 'ACTIVE') continue;
        if (el.starts_at > stamp) { validUntil = Math.min(validUntil, Date.parse(el.starts_at)); continue; }
        validUntil = Math.min(validUntil, Date.parse(el.ends_at));
        holdings.push({ role, scopeType: el.scope_type, scopeIds: asSet(el.scope_ids_json), assignmentId: null, via: 'elevation', elevationId: el.id });
        elevations.push({ id: el.id, role: role.code, endsAt: el.ends_at });
      }
    }
    // a role being considered (the check before it is given), never cached
    for (const x of extra) {
      const role = x.roleId ? table.byId.get(x.roleId) : table.byCode.get(x.code) ?? templateRole(x.code);
      if (role) holdings.push({ role, scopeType: x.scopeType ?? 'COMPANY', scopeIds: x.scopeIds ?? [], assignmentId: null, via: 'proposed' });
    }
    const grants = new Map(); // key -> { allow: scope, deny: scope, sources: [] }
    const grant = (key) => {
      if (!grants.has(key)) grants.set(key, { allow: emptyScope(), deny: emptyScope(), sources: [] });
      return grants.get(key);
    };
    const companyRoles = new Set();
    let clearance = 0;
    for (const h of holdings) {
      const scope = expandScope(h.scopeType, h.scopeIds, companyId);
      if (h.scopeType === 'COMPANY') companyRoles.add(h.role.code);
      clearance = Math.max(clearance, CONFIDENTIALITY_LEVELS.indexOf(h.role.clearance ?? 'internal'));
      for (const key of h.role.allow) {
        const g = grant(key);
        merge(g.allow, scope);
        g.sources.push({ effect: 'allow', role: h.role.code, roleName: h.role.name, scopeType: h.scopeType, scopeIds: h.scopeIds, assignmentId: h.assignmentId, via: h.via });
      }
      for (const key of h.role.deny) {
        const g = grant(key);
        merge(g.deny, scope);
        g.sources.push({ effect: 'deny', role: h.role.code, roleName: h.role.name, scopeType: h.scopeType, scopeIds: h.scopeIds, assignmentId: h.assignmentId, via: h.via });
      }
    }
    const anyScope = (s) => s.company || s.own || s.projects.size > 0 || s.sites.size > 0 || s.branches.size > 0 || s.departments.size > 0;
    const perms = [];
    const anywhere = [];
    for (const [key, g] of grants) {
      if (!anyScope(g.allow)) continue;
      if (!g.deny.company) anywhere.push(key);
      if (g.allow.company && !g.deny.company) perms.push(key);
    }

    // masks: the most permissive rule among the roles held, else the field's own default
    const heldIds = holdings.map((h) => h.role.id).filter(Boolean);
    const maskRows = heldIds.length && has('iam_field_masks') ? db.prepare(`SELECT entity, field, rule FROM iam_field_masks WHERE is_active = 1 AND role_id IN (${[...new Set(heldIds)].join(',')})`).all() : [];
    const maskRules = new Map();
    for (const f of fieldRegistry.list()) {
      const k = `${f.entity}.${f.field}`;
      let best = -1;
      for (const r of maskRows) if (r.entity === f.entity && r.field === f.field) best = Math.max(best, RANK[r.rule] ?? -1);
      // a role that is only in the templates (database not seeded) carries its template masks
      for (const h of holdings) if (!h.role.stored) for (const t of TEMPLATE_FIELD_MASKS) if (t.entity === f.entity && t.field === f.field && t.roles.includes(h.role.code)) best = Math.max(best, RANK[t.rule]);
      maskRules.set(k, best < 0 ? f.defaultRule : Object.keys(RANK).find((n) => RANK[n] === best));
    }
    const reportees = reporteesOf(userId, companyId);
    const value = {
      companyId,
      userId,
      grants,
      perms: perms.sort(),
      anywhere: anywhere.sort(),
      roles: [...companyRoles].sort(),
      holdings: holdings.map((h) => ({ role: h.role.code, roleName: h.role.name, scopeType: h.scopeType, scopeIds: h.scopeIds, assignmentId: h.assignmentId, via: h.via, elevationId: h.elevationId ?? null })),
      elevations,
      validUntil,
      assignmentCount: holdings.length,
      clearance: CONFIDENTIALITY_LEVELS[clearance],
      maskRules,
      reportees,
    };
    if (extra.length === 0) effective.set(ck, { at: now(), value });
    return value;
  }

  /** The grants the role templates give for the roles held company-wide: used only when the database cannot be read. */
  function fallback(actor) {
    const grants = new Map();
    for (const code of actor.roles ?? []) {
      const t = ROLE_TEMPLATES.find((x) => x.code === code);
      for (const key of t?.permissions ?? []) {
        if (!grants.has(key)) grants.set(key, { allow: { ...emptyScope(), company: true }, deny: emptyScope(), sources: [{ effect: 'allow', role: code, roleName: t.name, scopeType: 'COMPANY', scopeIds: [], assignmentId: null, via: 'role template' }] });
      }
    }
    const keys = [...grants.keys()].sort();
    return { companyId: actor.companyId, userId: actor.userId ?? null, grants, perms: keys, anywhere: keys, roles: [...(actor.roles ?? [])], holdings: [], elevations: [], validUntil: 0, assignmentCount: (actor.roles ?? []).length, clearance: 'internal', maskRules: new Map(), reportees: new Set() };
  }

  // ---- what a request carries ----
  /** Give an actor its computed grants (and, in sign-in mode, its company-wide roles from the engine). */
  function enrich(actor) {
    if (!actor || actor.companyId == null) {
      // no company: nothing can be granted, but the actor still has to be a well-formed one
      if (actor && !actor.grants) actor.grants = { grants: new Map(), perms: [], anywhere: [], roles: [], holdings: [], elevations: [], validUntil: 0, assignmentCount: 0, clearance: 'public', maskRules: new Map(), reportees: new Set() };
      return actor;
    }
    let e;
    try {
      e = resolve({ companyId: actor.companyId, userId: actor.userId ?? null, roles: actor.roles ?? [] });
    } catch {
      // The database cannot answer (it is down, or not migrated). Fall back to what the system roles grant in code, so the routes that
      // report the outage can still say so; custom roles and assignments grant nothing until the database is back.
      e = fallback(actor);
    }
    actor.grants = e;
    actor.elevated = e.elevations ?? [];
    if (actor.userId) {
      actor.roles = [...new Set([...(actor.roles ?? []), ...e.roles])];
      actor.onboarding = e.assignmentCount === 0 && actor.roles.length === 0;
    }
    return actor;
  }
  const grantsOf = (actor) => actor.grants ?? enrich(actor).grants;

  const hasCompanyWide = (actor, key) => grantsOf(actor).perms.includes(key);
  const hasAnywhere = (actor, key) => grantsOf(actor).anywhere.includes(key);

  // ---- decisions ----
  const LEVEL = (name) => Math.max(0, CONFIDENTIALITY_LEVELS.indexOf(name ?? 'internal'));
  const covers = (s, r, e, actorId) =>
    s.company ||
    (r.siteId != null && s.sites.has(r.siteId)) ||
    (r.projectId != null && s.projects.has(r.projectId)) ||
    (r.branchId != null && s.branches.has(r.branchId)) ||
    (r.departmentId != null && s.departments.has(r.departmentId)) ||
    (s.own && r.ownerUserId != null && (r.ownerUserId === actorId || (r.entity && e.reportees.has(r.ownerUserId) && hierarchyOn(r.entity, e.companyId))));

  /**
   * May this actor do `key` on this record? Returns { allowed, reason, sources }. Without a record the answer is whether they hold it
   * anywhere. A record with no project, site, branch or department attribute is company-level: only a company-wide grant reaches it.
   */
  function check(actor, key, resource = null) {
    const e = grantsOf(actor);
    const g = e.grants.get(key);
    const sources = g?.sources ?? [];
    if (!g || !(g.allow.company || g.allow.own || g.allow.projects.size || g.allow.sites.size || g.allow.branches.size || g.allow.departments.size)) {
      return { allowed: false, reason: `None of the roles held grants ${key}.`, sources };
    }
    if (resource?.companyId != null && actor.companyId != null && resource.companyId !== actor.companyId) return { allowed: false, reason: 'The record belongs to another company.', sources };
    if (g.deny.company) return { allowed: false, reason: `${key} is explicitly denied by ${g.sources.filter((s) => s.effect === 'deny').map((s) => s.role).join(', ')}; a deny overrides every allow.`, sources };
    if (resource?.confidentiality && LEVEL(resource.confidentiality) > LEVEL(e.clearance)) {
      return { allowed: false, reason: `The record is ${resource.confidentiality}; the highest level these roles may read is ${e.clearance}.`, sources };
    }
    if (!resource) return { allowed: true, reason: g.allow.company ? 'Granted for the whole company.' : 'Granted for part of the company (a scoped assignment).', sources };
    if (covers(g.deny, resource, e, actor.userId)) return { allowed: false, reason: 'Explicitly denied for this project or site; a deny overrides every allow.', sources };
    if (covers(g.allow, resource, e, actor.userId)) return { allowed: true, reason: g.allow.company ? 'Granted for the whole company.' : 'The record is inside the scope of an assignment.', sources };
    const attrs = ['siteId', 'projectId', 'branchId', 'departmentId', 'ownerUserId'].some((k) => resource[k] != null);
    return { allowed: false, reason: attrs ? 'The record is outside the scope of every assignment that grants this.' : 'The record is company-level and the grant is scoped to part of the company.', sources };
  }

  /**
   * A SQL condition limiting a list to what the actor may see: `cols` names the columns that hold the record's project, site, branch,
   * department and owner. An actor with a company-wide grant gets 1 = 1. Identifiers come from the caller, ids from the engine.
   */
  function scopeFilter(actor, key, cols = {}, entity = null) {
    const e = grantsOf(actor);
    const g = e.grants.get(key);
    if (!g || g.deny.company) return { sql: '1 = 0', unrestricted: false };
    const a = g.allow;
    const parts = [];
    let unrestricted = false;
    if (a.company) { parts.push('1 = 1'); unrestricted = !(g.deny.projects.size || g.deny.sites.size); }
    else {
      if (cols.project && a.projects.size) parts.push(`${cols.project} IN (${ids(a.projects).join(',')})`);
      if (cols.site && a.sites.size) parts.push(`${cols.site} IN (${ids(a.sites).join(',')})`);
      if (cols.branch && a.branches.size) parts.push(`${cols.branch} IN (${ids(a.branches).join(',')})`);
      if (cols.department && a.departments.size) parts.push(`${cols.department} IN (${ids(a.departments).join(',')})`);
      if (cols.owner && a.own && actor.userId) parts.push(`${cols.owner} = ${Number(actor.userId)}`);
      if (cols.owner && entity && e.reportees.size && hierarchyOn(entity, e.companyId)) parts.push(`${cols.owner} IN (${ids(e.reportees).join(',')})`);
    }
    if (parts.length === 0) return { sql: '1 = 0', unrestricted: false };
    let sql = parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
    const d = g.deny;
    const denies = [];
    if (cols.project && d.projects.size) denies.push(`${cols.project} IN (${ids(d.projects).join(',')})`);
    if (cols.site && d.sites.size) denies.push(`${cols.site} IN (${ids(d.sites).join(',')})`);
    if (denies.length) sql = `(${sql} AND NOT (${denies.join(' OR ')}))`;
    return { sql, unrestricted };
  }

  // ---- field masks ----
  function maskRule(actor, entity, field) {
    return grantsOf(actor).maskRules.get(`${entity}.${field}`) ?? fieldRegistry.get(entity, field)?.defaultRule ?? 'show';
  }
  /** A copy of the record with each sensitive field of the entity hidden, partly shown or shown, by the actor's roles (FR-04). */
  function mask(actor, entity, record) {
    if (!record || typeof record !== 'object') return record;
    const fields = fieldRegistry.forEntity(entity);
    if (!fields.length) return record;
    const out = { ...record };
    for (const f of fields) {
      const camel = f.field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      for (const name of new Set([f.field, camel])) {
        if (!(name in out)) continue;
        const rule = maskRule(actor, entity, f.field);
        if (rule === 'hide') delete out[name];
        else if (rule === 'partial') out[name] = fieldRegistry.format(f.format, out[name]);
      }
    }
    return out;
  }
  const maskAll = (actor, entity, list) => list.map((r) => mask(actor, entity, r));

  // ---- explaining ----
  /** "Why can or can't this person do X?" for every known permission, optionally against one record. */
  function explain({ companyId, userId, roles = [], recordType = null, recordId = null }) {
    const e = resolve({ companyId, userId, roles });
    let resource = null;
    let recordLabel = null;
    if (recordType) {
      const resolver = recordResolvers.get(recordType);
      if (!resolver) return { error: `Unknown record type ${recordType}` };
      resource = resolver(db, recordId);
      if (!resource) return { error: 'That record does not exist.' };
      recordLabel = resource.label ?? `${recordType} ${recordId}`;
    }
    const actor = { userId, companyId, roles, grants: e };
    const keys = new Set([...permissionRegistry.list().map((p) => p.key), ...e.grants.keys()]);
    const rows = [...keys].sort().map((key) => {
      const reg = permissionRegistry.get(key) ?? { ...parseKey(key), sensitive: false, description: '' };
      const d = check(actor, key, resource);
      return { key, module: reg.module, entity: reg.entity, action: reg.action, sensitive: reg.sensitive, description: reg.description, allowed: d.allowed, reason: d.reason, sources: d.sources };
    });
    return { holdings: e.holdings, clearance: e.clearance, record: resource ? { type: recordType, id: recordId, label: recordLabel, projectId: resource.projectId ?? null, siteId: resource.siteId ?? null, confidentiality: resource.confidentiality ?? null } : null, permissions: rows };
  }

  // ---- seeding ----
  const insert = (sql, ...args) => db.prepare(sql).run(...args);
  /** Make the stored registry, system roles, their grants and masks, and the legacy mapping match the code templates. Safe to repeat. */
  function seed() {
    if (!has('iam_roles')) return { roles: 0 };
    const stamp = new Date(now()).toISOString();
    const keys = new Set([...permissionRegistry.list().map((p) => p.key), ...Object.values(TEMPLATE_PERMISSIONS).flat(), ...Object.values(LEGACY_ROLE_PERMISSIONS).flat()]);
    for (const k of keys) permissionRegistry.get(k) ?? permissionRegistry.register(k);
    let changed = 0;
    db.exec('BEGIN');
    try {
      for (const p of permissionRegistry.list()) {
        const row = db.prepare('SELECT id, module, entity, action, description, sensitive FROM iam_permissions WHERE perm_key = ?').get(p.key);
        if (!row) insert("INSERT INTO iam_permissions (perm_key, module, entity, action, description, sensitive, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'system', 'permission_registry')", p.key, p.module, p.entity, p.action, p.description, p.sensitive ? 1 : 0);
        else if (row.module !== p.module || row.entity !== p.entity || row.action !== p.action || row.description !== p.description || row.sensitive !== (p.sensitive ? 1 : 0)) insert('UPDATE iam_permissions SET module = ?, entity = ?, action = ?, description = ?, sensitive = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?', p.module, p.entity, p.action, p.description, p.sensitive ? 1 : 0, 'system', stamp, row.id);
      }
      for (const t of ROLE_TEMPLATES) {
        const hash = createHash('sha256').update(JSON.stringify([t.name, t.clearance, t.authority, t.permissions])).digest('hex').slice(0, 16);
        const authority = JSON.stringify({ summary: t.authority, scope: t.scope, responsibilities: t.responsibilities, department: t.department, category: t.category });
        let role = db.prepare('SELECT id, grants_hash FROM iam_roles WHERE company_id IS NULL AND code = ?').get(t.code);
        if (!role) {
          const res = insert("INSERT INTO iam_roles (company_id, code, name, description, kind, category, is_system, status, clearance, authority_json, grants_hash, created_by, source_type) VALUES (NULL, ?, ?, ?, 'SYSTEM', ?, 1, 'ACTIVE', ?, ?, ?, 'system', 'role_template')", t.code, t.name, t.responsibilities, t.category, t.clearance, authority, hash);
          role = { id: Number(res.lastInsertRowid), grants_hash: null };
        }
        if (role.grants_hash !== hash) {
          insert('DELETE FROM iam_role_permissions WHERE role_id = ?', role.id);
          for (const k of t.permissions) insert("INSERT INTO iam_role_permissions (role_id, perm_key, effect, created_by, source_type) VALUES (?, ?, 'allow', 'system', 'role_template')", role.id, k);
          insert('UPDATE iam_roles SET name = ?, description = ?, category = ?, clearance = ?, authority_json = ?, grants_hash = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?', t.name, t.responsibilities, t.category, t.clearance, authority, hash, 'system', stamp, role.id);
          changed += 1;
        }
      }
      for (const m of TEMPLATE_FIELD_MASKS) {
        for (const code of m.roles) {
          const role = db.prepare('SELECT id FROM iam_roles WHERE company_id IS NULL AND code = ?').get(code);
          if (role && !db.prepare('SELECT 1 FROM iam_field_masks WHERE role_id = ? AND entity = ? AND field = ?').get(role.id, m.entity, m.field)) {
            insert("INSERT INTO iam_field_masks (role_id, entity, field, rule, created_by, source_type) VALUES (?, ?, ?, ?, 'system', 'role_template')", role.id, m.entity, m.field, m.rule);
          }
        }
      }
      for (const legacy of Object.keys(LEGACY_ROLE_PERMISSIONS)) {
        const role = db.prepare('SELECT id FROM iam_roles WHERE company_id IS NULL AND code = ?').get(legacy);
        if (role && !db.prepare('SELECT 1 FROM iam_role_mapping WHERE legacy_role = ?').get(legacy)) {
          insert("INSERT INTO iam_role_mapping (legacy_role, new_role_id, mapping_type, notes, created_by, source_type) VALUES (?, ?, 'ALIAS', ?, 'system', 'role_mapping')", legacy, role.id, `The role keeps its code and its access; the system role ${legacy} is the same role under the role engine.`);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    invalidate();
    return { roles: ROLE_TEMPLATES.length, changed };
  }

  function invalidate() {
    roleTables.clear();
    effective.clear();
  }

  return { resolve, enrich, grantsOf, hasCompanyWide, hasAnywhere, check, scopeFilter, mask, maskAll, maskRule, explain, seed, invalidate, hierarchyKey };
}
