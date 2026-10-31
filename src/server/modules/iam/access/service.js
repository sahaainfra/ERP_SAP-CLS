import { assertPermission } from '../../../platform/auth/index.js';
import { authzOf, LEGACY_ROLE_PERMISSIONS, PERMISSIONS_SINCE_LEGACY, permissionRegistry, fieldRegistry, recordResolvers, isSensitiveKey } from '../../../platform/authz/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { inTransaction, transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { badRequest, conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { sodOf } from '../../../platform/sod/index.js';
import { setLifecycle } from '../usermgmt/service.js';
import { assignmentChain, roleChangeChain } from './chains.js';

const istDate = (ms) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
const NEW_PERMISSIONS = new Set(PERMISSIONS_SINCE_LEGACY);
const unique = (list) => [...new Set(list)].sort();
const SCOPE_TABLE = { BRANCH: ['org_branches', 'branch'], DEPARTMENT: ['org_departments', 'department'], PROJECT: ['org_projects', 'project'], SITE: ['org_sites', 'site'] };

function insertGrants(db, roleId, allow, deny, by) {
  db.prepare('DELETE FROM iam_role_permissions WHERE role_id = ?').run(roleId);
  for (const k of allow) db.prepare("INSERT INTO iam_role_permissions (role_id, perm_key, effect, created_by, source_type) VALUES (?, ?, 'allow', ?, 'role_grant')").run(roleId, k, by);
  for (const k of deny) db.prepare("INSERT INTO iam_role_permissions (role_id, perm_key, effect, created_by, source_type) VALUES (?, ?, 'deny', ?, 'role_grant')").run(roleId, k, by);
}
function insertMasks(db, roleId, masks, by) {
  db.prepare('DELETE FROM iam_field_masks WHERE role_id = ?').run(roleId);
  for (const m of masks) db.prepare("INSERT INTO iam_field_masks (role_id, entity, field, rule, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'role_grant')").run(roleId, m.entity, m.field, m.rule, by);
}
const grantsOfRole = (db, roleId) => {
  const rows = db.prepare('SELECT perm_key, effect FROM iam_role_permissions WHERE role_id = ? AND is_active = 1 ORDER BY perm_key').all(roleId);
  return { allow: rows.filter((r) => r.effect === 'allow').map((r) => r.perm_key), deny: rows.filter((r) => r.effect === 'deny').map((r) => r.perm_key) };
};
const masksOfRole = (db, roleId) => db.prepare('SELECT entity, field, rule FROM iam_field_masks WHERE role_id = ? AND is_active = 1 ORDER BY entity, field').all(roleId).map((m) => ({ ...m }));

/** What an approved request changes: a custom role's grants, masks, clearance or status, and a scoped assignment. Applied in the approver's transaction. */
export const accessHandlers = {
  iam_role_change: {
    apply(db, request, actor) {
      const p = request.payload;
      const role = db.prepare('SELECT * FROM iam_roles WHERE id = ? AND kind = ? AND is_active = 1').get(p.roleId, 'CUSTOM');
      if (!role || (role.company_id !== request.companyId)) throw unprocessable('The role no longer exists, so the change cannot be applied.');
      const known = new Set(db.prepare('SELECT perm_key FROM iam_permissions').all().map((r) => r.perm_key));
      for (const k of [...(p.permissions?.allow ?? []), ...(p.permissions?.deny ?? [])]) if (!known.has(k)) throw unprocessable(`Permission ${k} is no longer in the registry.`);
      const before = { ...grantsOfRole(db, role.id), masks: masksOfRole(db, role.id), clearance: role.clearance, status: role.status };
      if (p.permissions) insertGrants(db, role.id, p.permissions.allow, p.permissions.deny, actor.user);
      if (p.masks) insertMasks(db, role.id, p.masks, actor.user);
      const status = p.activate ? 'ACTIVE' : p.retire ? 'RETIRED' : role.status;
      db.prepare('UPDATE iam_roles SET clearance = ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(p.clearance ?? role.clearance, status, actor.user, new Date().toISOString(), role.id);
      writeAudit(db, { entity: 'iam_roles', entityId: role.id, action: 'change_approved', oldValues: before, newValues: { ...(p.permissions ?? {}), masks: p.masks, clearance: p.clearance, status }, reason: request.reason, actor: actor.user });
      publishEvent(db, { type: 'iam.role.changed', entity: 'role', entityId: role.id, actorId: actor.user, companyId: request.companyId, data: { code: role.code, status, requestId: request.id } });
      authzOf(db).invalidate();
    },
  },
  iam_assignment: {
    apply(db, request, actor) {
      const p = request.payload;
      const user = db.prepare('SELECT u.*, COALESCE(pr.lifecycle, CASE u.status WHEN \'ACTIVE\' THEN \'ACTIVE\' ELSE \'SUSPENDED\' END) AS lifecycle FROM iam_users u LEFT JOIN iam_user_profiles pr ON pr.user_id = u.id WHERE u.id = ? AND u.company_id = ? AND u.is_active = 1').get(p.userId, request.companyId);
      if (!user || ['SUSPENDED', 'DEACTIVATED'].includes(user.lifecycle)) throw unprocessable(`${p.username} is ${(user?.lifecycle ?? 'not available').toLowerCase()}, so the role cannot be assigned. Reactivate the account and ask again.`);
      const role = db.prepare("SELECT * FROM iam_roles WHERE id = ? AND is_active = 1 AND status = 'ACTIVE' AND (company_id IS NULL OR company_id = ?)").get(p.roleId, request.companyId);
      if (!role) throw unprocessable(`The role ${p.roleCode} is no longer active, so it cannot be assigned.`);
      // the check is made again at approval: what the person holds may have changed since the request (part 02.05)
      sodOf(db).assertAssignable({ companyId: request.companyId, userId: user.id, roles: JSON.parse(user.roles_json), extra: [{ roleId: role.id, scopeType: p.scopeType, scopeIds: p.scopeIds }] });
      const res = db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, effective_from, effective_to, status, reason, request_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 'role_assignment')")
        .run(request.companyId, user.id, role.id, p.scopeType, JSON.stringify(p.scopeIds), p.effectiveFrom, p.effectiveTo, request.reason, request.id, request.requestedBy);
      db.prepare("INSERT INTO iam_role_grants (company_id, user_id, role_code, action, request_id, reason, granted_by, created_by, source_type) VALUES (?, ?, ?, 'GRANTED', ?, ?, ?, ?, 'role_grant')").run(request.companyId, user.id, role.code, request.id, request.reason, actor.user, actor.user);
      if (user.lifecycle === 'ONBOARDING' && (!p.effectiveFrom || p.effectiveFrom <= istDate(Date.now()))) setLifecycle(db, user.id, 'ACTIVE', { by: actor.user, reason: 'A role was approved' });
      writeAudit(db, { entity: 'iam_users', entityId: user.id, action: 'assignment_approved', newValues: { role: role.code, scopeType: p.scopeType, scopeIds: p.scopeIds, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo }, reason: request.reason, actor: actor.user });
      publishEvent(db, { type: 'iam.assignment.created', entity: 'assignment', entityId: Number(res.lastInsertRowid), actorId: actor.user, companyId: request.companyId, data: { username: user.username, role: role.code, scopeType: p.scopeType, requestId: request.id } });
      authzOf(db).invalidate();
      sodOf(db).scanUser(request.companyId, user.id);
    },
  },
};

/** Roles, scoped assignments, the effective-permission explainer and the legacy comparison (part 02.04). */
export function createAccessService({ db, identity, approvals }) {
  const authz = authzOf(db);
  const cid = (actor) => companyScope(actor).params._company_scope;
  const now = () => identity.now();
  const view = (actor) => assertPermission(actor, 'iam.role.view');

  const roleRow = (actor, id) => {
    const r = db.prepare('SELECT * FROM iam_roles WHERE id = ? AND is_active = 1 AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').get(id, cid(actor));
    if (!r) throw notFound('That role does not exist.');
    return r;
  };
  const privilegedRole = (roleId) => grantsOfRole(db, roleId).allow.some((k) => isSensitiveKey(k));
  const holdersCount = (companyId, role) =>
    db.prepare('SELECT COUNT(*) AS n FROM (SELECT u.id FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = ?) UNION SELECT a.user_id FROM iam_assignments a WHERE a.company_id = ? AND a.role_id = ? AND a.status = \'ACTIVE\' AND a.is_active = 1)').get(companyId, role.code, companyId, role.id).n;
  const present = (r, extra = {}) => ({
    id: r.id, code: r.code, name: r.name, description: r.description, kind: r.kind, category: r.category, status: r.status, clearance: r.clearance, departmentId: r.department_id, parentTemplateId: r.parent_template_id,
    authority: JSON.parse(r.authority_json || '{}'), version: r.version, locked: r.kind === 'SYSTEM', createdAt: r.created_at, createdBy: r.created_by, ...extra,
  });
  const canManage = (actor) => actor.grants?.perms?.includes('iam.role.manage') ?? false;

  const service = {
    // ---- the registry ----
    permissions(actor) {
      view(actor);
      return db.prepare('SELECT perm_key, module, entity, action, description, sensitive, (SELECT COUNT(DISTINCT p.role_id) FROM iam_role_permissions p WHERE p.perm_key = iam_permissions.perm_key AND p.effect = \'allow\' AND p.is_active = 1) AS roles FROM iam_permissions WHERE is_active = 1 ORDER BY module, entity, action')
        .all().map((p) => ({ key: p.perm_key, module: p.module, entity: p.entity, action: p.action, description: p.description, sensitive: Boolean(p.sensitive), roles: p.roles }));
    },
    maskableFields(actor) {
      view(actor);
      return fieldRegistry.list().map((f) => ({ entity: f.entity, field: f.field, label: f.label, defaultRule: f.defaultRule, description: f.description }));
    },
    recordTypes(actor) {
      view(actor);
      return recordResolvers.types();
    },

    // ---- roles ----
    list(actor, query) {
      view(actor);
      const c = cid(actor);
      const where = ['r.is_active = 1', 'r.deleted_at IS NULL', '(r.company_id IS NULL OR r.company_id = :c)', "(r.code LIKE :q ESCAPE '\\' OR r.name LIKE :q ESCAPE '\\')"];
      const params = { c, q: likePattern(query.q) };
      for (const [name, col] of [['kind', 'r.kind'], ['status', 'r.status'], ['category', 'r.category']]) {
        if (query.filters[name]) { where.push(`${col} = :f_${name}`); params[`f_${name}`] = query.filters[name]; }
      }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM iam_roles r WHERE ${w}`).get(params).n;
      const order = orderBySql(query.sort, { code: 'r.code', name: 'r.name', status: 'r.status', holders: 'holders' }, 'r.id');
      const rows = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM iam_role_permissions p WHERE p.role_id = r.id AND p.effect = 'allow' AND p.is_active = 1) AS allow_count, (SELECT COUNT(*) FROM iam_role_permissions p WHERE p.role_id = r.id AND p.effect = 'deny' AND p.is_active = 1) AS deny_count,
        (SELECT COUNT(*) FROM (SELECT u.id FROM iam_users u WHERE u.company_id = :c AND u.is_active = 1 AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = r.code) UNION SELECT a.user_id FROM iam_assignments a WHERE a.company_id = :c AND a.role_id = r.id AND a.status = 'ACTIVE' AND a.is_active = 1)) AS holders
        FROM iam_roles r WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((r) => present(r, { allowCount: r.allow_count, denyCount: r.deny_count, holders: r.holders, canManage: canManage(actor) })), total, query);
    },

    get(actor, id) {
      view(actor);
      const r = roleRow(actor, id);
      const c = cid(actor);
      const grants = grantsOfRole(db, id);
      const registry = new Map(permissionRegistry.list().map((p) => [p.key, p]));
      const permission = (key, effect) => ({ key, effect, sensitive: registry.get(key)?.sensitive ?? isSensitiveKey(key), description: registry.get(key)?.description ?? '' });
      const viaList = db.prepare('SELECT u.id, u.username, u.display_name FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = ?) ORDER BY u.username LIMIT 100').all(c, r.code)
        .map((u) => ({ userId: u.id, username: u.username, displayName: u.display_name, scopeType: 'COMPANY', scopeIds: [], via: 'role list', assignmentId: null }));
      const viaAssign = db.prepare("SELECT a.id, a.scope_type, a.scope_ids_json, a.effective_from, a.effective_to, u.id AS user_id, u.username, u.display_name FROM iam_assignments a JOIN iam_users u ON u.id = a.user_id WHERE a.company_id = ? AND a.role_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 ORDER BY u.username LIMIT 100").all(c, id)
        .map((a) => ({ userId: a.user_id, username: a.username, displayName: a.display_name, scopeType: a.scope_type, scopeIds: JSON.parse(a.scope_ids_json), via: 'assignment', assignmentId: a.id, effectiveFrom: a.effective_from, effectiveTo: a.effective_to }));
      const requests = r.kind === 'CUSTOM' ? db.prepare("SELECT id FROM core_change_requests WHERE company_id = ? AND target_type = 'iam_role' AND target_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 20").all(c, id).map((q) => approvals.get(actor, q.id)) : [];
      return present(r, {
        permissions: [...grants.allow.map((k) => permission(k, 'allow')), ...grants.deny.map((k) => permission(k, 'deny'))], masks: masksOfRole(db, id), holders: [...viaList, ...viaAssign], requests, privileged: privilegedRole(id), canManage: canManage(actor),
        parent: r.parent_template_id ? db.prepare('SELECT id, code, name FROM iam_roles WHERE id = ?').get(r.parent_template_id) : null,
      });
    },

    create(actor, input) {
      assertPermission(actor, 'iam.role.manage');
      const c = cid(actor);
      if (db.prepare('SELECT 1 FROM iam_roles WHERE code = ? AND (company_id IS NULL OR company_id = ?)').get(input.code, c)) throw conflict(`A role with the code ${input.code} already exists. Choose another code.`);
      if (input.departmentId && !db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ? AND is_active = 1').get(input.departmentId, c)) throw badRequest('Some fields are invalid.', [{ field: 'departmentId', message: 'That department does not exist in this company.' }]);
      return transaction(db, () => {
        const src = input.cloneFromId ? roleRow(actor, input.cloneFromId) : null;
        const res = db.prepare("INSERT INTO iam_roles (company_id, code, name, description, kind, category, is_system, status, department_id, parent_template_id, clearance, authority_json, created_by, source_type) VALUES (?, ?, ?, ?, 'CUSTOM', 'CUSTOM', 0, 'DRAFT', ?, ?, ?, ?, ?, 'role')")
          .run(c, input.code, input.name, input.description, input.departmentId, src?.id ?? null, src ? src.clearance : input.clearance, src?.authority_json ?? '{}', actor.user);
        const id = Number(res.lastInsertRowid);
        if (src) {
          const g = grantsOfRole(db, src.id);
          insertGrants(db, id, g.allow, g.deny, actor.user);
          insertMasks(db, id, masksOfRole(db, src.id), actor.user);
        }
        writeAudit(db, { entity: 'iam_roles', entityId: id, action: 'create', newValues: { code: input.code, name: input.name, clonedFrom: src?.code ?? null }, actor: actor.user });
        publishEvent(db, { type: 'iam.role.created', entity: 'role', entityId: id, actorId: actor.user, companyId: c, data: { code: input.code, clonedFrom: src?.code ?? '' } });
        authz.invalidate();
        return service.get(actor, id);
      });
    },

    update(actor, id, { version, ...input }) {
      assertPermission(actor, 'iam.role.manage');
      return transaction(db, () => {
        const r = roleRow(actor, id);
        if (r.kind === 'SYSTEM') throw unprocessable('A system role is locked. Clone it into a custom role to change it.');
        if (r.version !== version) throw conflict('The role was changed by someone else. Refresh the page and try again.');
        const next = { name: input.name ?? r.name, description: input.description ?? r.description, departmentId: 'departmentId' in input ? input.departmentId : r.department_id };
        if (next.departmentId && !db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ? AND is_active = 1').get(next.departmentId, cid(actor))) throw badRequest('Some fields are invalid.', [{ field: 'departmentId', message: 'That department does not exist in this company.' }]);
        db.prepare('UPDATE iam_roles SET name = ?, description = ?, department_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next.name, next.description, next.departmentId, actor.user, new Date(now()).toISOString(), id);
        writeAudit(db, { entity: 'iam_roles', entityId: id, action: 'update', oldValues: { name: r.name, description: r.description, departmentId: r.department_id }, newValues: next, actor: actor.user });
        return service.get(actor, id);
      });
    },

    /** Ask to change what a custom role grants, its masks or clearance, or to activate or retire it. Nothing changes until it is approved. */
    requestChange(actor, id, input) {
      assertPermission(actor, 'iam.role.manage');
      const r = roleRow(actor, id);
      const c = cid(actor);
      if (r.kind === 'SYSTEM') throw unprocessable('A system role is locked. Clone it into a custom role to change it.');
      if (approvals.hasOpen(c, 'iam_role_change', 'iam_role', id)) throw conflict('There is already an open change for this role. Decide or withdraw it first.');
      const current = grantsOfRole(db, id);
      const problems = [];
      if (input.permissions) {
        const known = new Set(db.prepare('SELECT perm_key FROM iam_permissions').all().map((p) => p.perm_key));
        for (const k of [...input.permissions.allow, ...input.permissions.deny]) if (!known.has(k)) problems.push({ field: 'permissions', message: `${k} is not a registered permission.` });
        for (const k of input.permissions.allow) if (input.permissions.deny.includes(k)) problems.push({ field: 'permissions', message: `${k} is both allowed and denied.` });
      }
      for (const m of input.masks ?? []) if (!fieldRegistry.get(m.entity, m.field)) problems.push({ field: 'masks', message: `${m.entity}.${m.field} is not a declared sensitive field.` });
      if (input.permissions) {
        for (const h of sodOf(db).conflictsWithinPermissions(c, input.permissions.allow).filter((x) => x.rule.severity === 'BLOCK')) problems.push({ field: 'permissions', message: `${h.rule.code} ${h.rule.name}: one role may not carry both ${h.a.join(', ')} and ${h.b.join(', ')}.` });
      }
      if (problems.length) throw badRequest('The change is not valid.', problems);
      if (input.activate && r.status === 'ACTIVE') throw unprocessable('The role is already active.');
      if (input.retire) {
        if (r.status !== 'ACTIVE') throw unprocessable('Only an active role can be retired.');
        const n = holdersCount(c, r);
        if (n > 0) throw unprocessable(`${n} person(s) still hold this role. End their assignments first, then retire the role.`);
      }
      const nextAllow = input.permissions ? input.permissions.allow : current.allow;
      const privileged = [...nextAllow, ...current.allow].some((k) => isSensitiveKey(k)) || input.clearance === 'restricted';
      const changed = (input.permissions && (JSON.stringify(unique(input.permissions.allow)) !== JSON.stringify(current.allow) || JSON.stringify(unique(input.permissions.deny)) !== JSON.stringify(current.deny))) || input.masks || (input.clearance && input.clearance !== r.clearance) || input.activate || input.retire;
      if (!changed) throw unprocessable('Nothing would change: the requested values are the current ones.');
      const title = `${input.activate ? 'Activate' : input.retire ? 'Retire' : 'Change'} role ${r.code}${input.permissions ? ` (${nextAllow.length} allowed)` : ''}`;
      return approvals.submit(actor, {
        type: 'iam_role_change', title, targetType: 'iam_role', targetId: id, reason: input.reason, chain: roleChangeChain({ privileged }),
        payload: { roleId: id, code: r.code, permissions: input.permissions ? { allow: unique(input.permissions.allow), deny: unique(input.permissions.deny) } : undefined, masks: input.masks, clearance: input.clearance, activate: input.activate, retire: input.retire, privileged, before: { ...current, clearance: r.clearance, status: r.status } },
      });
    },

    compare(actor, aId, bId) {
      view(actor);
      const a = roleRow(actor, aId);
      const b = roleRow(actor, bId);
      const ga = grantsOfRole(db, aId);
      const gb = grantsOfRole(db, bId);
      const map = (g) => new Map([...g.allow.map((k) => [k, 'allow']), ...g.deny.map((k) => [k, 'deny'])]);
      const ma = map(ga);
      const mb = map(gb);
      const keys = unique([...ma.keys(), ...mb.keys()]);
      const rows = keys.map((key) => ({ key, a: ma.get(key) ?? null, b: mb.get(key) ?? null, same: (ma.get(key) ?? null) === (mb.get(key) ?? null), sensitive: isSensitiveKey(key) }));
      const mk = (m) => new Map(m.map((x) => [`${x.entity}.${x.field}`, x.rule]));
      const xa = mk(masksOfRole(db, aId));
      const xb = mk(masksOfRole(db, bId));
      const maskRows = unique([...xa.keys(), ...xb.keys()]).map((k) => ({ field: k, a: xa.get(k) ?? 'default', b: xb.get(k) ?? 'default', same: (xa.get(k) ?? 'default') === (xb.get(k) ?? 'default') }));
      return { a: { id: a.id, code: a.code, name: a.name, clearance: a.clearance }, b: { id: b.id, code: b.code, name: b.name, clearance: b.clearance }, permissions: rows, masks: maskRows, onlyA: rows.filter((r) => r.a && !r.b).length, onlyB: rows.filter((r) => r.b && !r.a).length, both: rows.filter((r) => r.a && r.b && r.same).length };
    },

    // ---- assignments ----
    assignments(actor, query) {
      assertPermission(actor, 'iam.assignment.view');
      const c = cid(actor);
      const where = ['a.company_id = :c', 'a.is_active = 1', "(u.username LIKE :q ESCAPE '\\' OR u.display_name LIKE :q ESCAPE '\\' OR r.code LIKE :q ESCAPE '\\')"];
      const params = { c, q: likePattern(query.q) };
      for (const [name, col] of [['userId', 'a.user_id'], ['roleId', 'a.role_id'], ['status', 'a.status'], ['scopeType', 'a.scope_type']]) {
        if (query.filters[name]) { where.push(`${col} = :f_${name}`); params[`f_${name}`] = /^\d+$/.test(query.filters[name]) ? Number(query.filters[name]) : query.filters[name]; }
      }
      const w = where.join(' AND ');
      const from = 'FROM iam_assignments a JOIN iam_users u ON u.id = a.user_id JOIN iam_roles r ON r.id = a.role_id';
      const total = db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${w}`).get(params).n;
      const order = orderBySql(query.sort, { user: 'u.username', role: 'r.code', effectiveFrom: 'a.effective_from' }, 'a.id');
      const rows = db.prepare(`SELECT a.*, u.username, u.display_name, r.code AS role_code, r.name AS role_name ${from} WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      const today = istDate(now());
      return pageResponse(rows.map((a) => ({
        id: a.id, userId: a.user_id, username: a.username, displayName: a.display_name, roleId: a.role_id, roleCode: a.role_code, roleName: a.role_name, scopeType: a.scope_type, scopeIds: JSON.parse(a.scope_ids_json), scopeNames: scopeNames(c, a.scope_type, JSON.parse(a.scope_ids_json)),
        effectiveFrom: a.effective_from, effectiveTo: a.effective_to, status: a.status, inForce: a.status === 'ACTIVE' && (!a.effective_from || a.effective_from <= today) && (!a.effective_to || a.effective_to >= today), reason: a.reason, requestId: a.request_id, createdAt: a.created_at, endedAt: a.ended_at, endedBy: a.ended_by,
      })), total, query);
    },

    /** Ask for a role to be held by a person for a scope and a period. The assignment exists only after approval (BR-03). */
    requestAssignment(actor, input) {
      assertPermission(actor, 'iam.assignment.manage');
      const c = cid(actor);
      const user = db.prepare('SELECT u.id, u.username, u.display_name, u.roles_json, COALESCE(p.lifecycle, \'ACTIVE\') AS lifecycle FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.company_id = ? AND u.is_active = 1').get(input.userId, c);
      if (!user) throw notFound('That user does not exist.');
      if (['SUSPENDED', 'DEACTIVATED'].includes(user.lifecycle)) throw unprocessable(`${user.display_name} is ${user.lifecycle.toLowerCase()}. Reactivate the account before asking for a role.`);
      const role = roleRow(actor, input.roleId);
      if (role.status !== 'ACTIVE') throw unprocessable(`The role ${role.code} is ${role.status.toLowerCase()}, so it cannot be assigned.`);
      const problems = [];
      if (input.scopeType === 'COMPANY' || input.scopeType === 'OWN') {
        if (input.scopeIds.length) problems.push({ field: 'scopeIds', message: `A ${input.scopeType === 'OWN' ? "person's own records" : 'whole-company'} scope names nothing.` });
      } else {
        const [table, noun] = SCOPE_TABLE[input.scopeType];
        if (input.scopeIds.length === 0) problems.push({ field: 'scopeIds', message: `Choose at least one ${noun}.` });
        else {
          const found = db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND is_active = 1 AND id IN (${input.scopeIds.join(',')})`).all(c).map((r) => r.id);
          const missing = input.scopeIds.filter((i) => !found.includes(i));
          if (missing.length) problems.push({ field: 'scopeIds', message: `${missing.length} of the chosen ${noun}s do not exist in this company.` });
        }
      }
      if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) problems.push({ field: 'effectiveTo', message: 'The end date is before the start date.' });
      if (input.effectiveTo && input.effectiveTo < istDate(now())) problems.push({ field: 'effectiveTo', message: 'The end date has already passed.' });
      if (problems.length) throw badRequest('Some fields are invalid. Fix them and try again.', problems);
      const same = db.prepare("SELECT 1 FROM iam_assignments WHERE user_id = ? AND role_id = ? AND scope_type = ? AND scope_ids_json = ? AND status = 'ACTIVE' AND is_active = 1 AND (effective_to IS NULL OR effective_to >= ?)").get(user.id, role.id, input.scopeType, JSON.stringify([...input.scopeIds].sort((x, y) => x - y)), istDate(now()));
      if (same) throw conflict(`${user.display_name} already holds ${role.code} for that scope.`);
      if (approvals.hasOpen(c, 'iam_assignment', 'iam_user', user.id)) throw conflict(`There is already an open assignment request for ${user.display_name}. Decide or withdraw it first.`);
      // a blocking conflict stops the request here, naming it; a warning goes back with the request (part 02.05)
      const sodWarnings = sodOf(db).assertAssignable({ companyId: c, userId: user.id, roles: JSON.parse(user.roles_json), extra: [{ roleId: role.id, scopeType: input.scopeType, scopeIds: input.scopeIds }] });
      const policy = identity.policies.for(c);
      const chain = assignmentChain({ codes: [role.code], privilegedCodes: policy.mfa.requiredRoles, sensitive: privilegedRole(role.id), bySysadm: actor.roles.includes('SYSADM') });
      const where = input.scopeType === 'COMPANY' ? 'company-wide' : input.scopeType === 'OWN' ? 'own records' : `${input.scopeType.toLowerCase()} ${scopeNames(c, input.scopeType, input.scopeIds).join(', ')}`;
      return { sodWarnings, ...approvals.submit(actor, {
        type: 'iam_assignment', title: `Give ${role.code} to ${user.username} (${where})`, targetType: 'iam_user', targetId: user.id, reason: input.reason, chain,
        payload: { userId: user.id, username: user.username, roleId: role.id, roleCode: role.code, scopeType: input.scopeType, scopeIds: [...input.scopeIds].sort((x, y) => x - y), effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo },
      }) };
    },

    /** Taking access away only lowers it, so it is immediate, audited and needs no approval. */
    endAssignment(actor, id, { reason }) {
      assertPermission(actor, 'iam.assignment.manage');
      const c = cid(actor);
      return inTransaction(db, () => {
        const a = db.prepare("SELECT a.*, u.username, r.code AS role_code FROM iam_assignments a JOIN iam_users u ON u.id = a.user_id JOIN iam_roles r ON r.id = a.role_id WHERE a.id = ? AND a.company_id = ? AND a.is_active = 1").get(id, c);
        if (!a) throw notFound('That assignment does not exist.');
        if (a.status !== 'ACTIVE') throw unprocessable('That assignment has already ended.');
        if (a.user_id === actor.userId) throw unprocessable('You cannot end your own assignment.');
        db.prepare("UPDATE iam_assignments SET status = 'ENDED', ended_at = ?, ended_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(new Date(now()).toISOString(), actor.user, actor.user, new Date(now()).toISOString(), id);
        db.prepare("INSERT INTO iam_role_grants (company_id, user_id, role_code, action, reason, granted_by, created_by, source_type) VALUES (?, ?, ?, 'REVOKED', ?, ?, ?, 'role_grant')").run(c, a.user_id, a.role_code, reason, actor.user, actor.user);
        authz.invalidate();
        // a person left with nothing goes back to onboarding
        const left = authz.resolve({ companyId: c, userId: a.user_id, roles: JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(a.user_id).roles_json) });
        const lifecycle = db.prepare("SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?").get(a.user_id)?.lifecycle;
        if (left.assignmentCount === 0 && lifecycle === 'ACTIVE') setLifecycle(db, a.user_id, 'ONBOARDING', { by: actor.user, reason: 'The last role assignment ended' });
        writeAudit(db, { entity: 'iam_users', entityId: a.user_id, action: 'assignment_ended', newValues: { role: a.role_code, scopeType: a.scope_type }, reason, actor: actor.user });
        publishEvent(db, { type: 'iam.assignment.ended', entity: 'assignment', entityId: id, actorId: actor.user, companyId: c, data: { username: a.username, role: a.role_code, scopeType: a.scope_type } });
        return { ended: true };
      });
    },

    // ---- explaining ----
    effective(actor, { userId, recordType, recordId }) {
      view(actor);
      const c = cid(actor);
      const u = db.prepare('SELECT id, username, display_name, roles_json FROM iam_users WHERE id = ? AND company_id = ? AND is_active = 1').get(userId, c);
      if (!u) throw notFound('That user does not exist.');
      if (recordType && recordId == null) throw badRequest('Some fields are invalid.', [{ field: 'recordId', message: 'Give the record number as well as its type.' }]);
      const out = authz.explain({ companyId: c, userId: u.id, roles: JSON.parse(u.roles_json), recordType: recordType ?? null, recordId: recordId ?? null });
      if (out.error) throw out.error.startsWith('Unknown') ? badRequest(out.error, [{ field: 'recordType', message: out.error }]) : notFound(out.error);
      return { user: { id: u.id, username: u.username, displayName: u.display_name }, ...out, recordTypes: recordResolvers.types() };
    },

    /** The signed-in person's own access: for the menu and for `can(permission, record)` in the browser. */
    myAccess(actor) {
      const g = actor.grants ?? authz.enrich(actor).grants;
      return { companyWide: g.perms, anywhere: g.anywhere, holdings: g.holdings, clearance: g.clearance, scopes: Object.fromEntries([...g.grants].filter(([, v]) => !v.allow.company && (v.allow.projects.size || v.allow.sites.size)).map(([k, v]) => [k, { projects: [...v.allow.projects], sites: [...v.allow.sites] }])) };
    },

    /** The daily job: a date-limited assignment starts or ends, so a person may move between Onboarding and Active. */
    syncLifecycle() {
      let moved = 0;
      const rows = db.prepare("SELECT u.id, u.company_id, u.roles_json, p.lifecycle FROM iam_users u JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.is_active = 1 AND p.lifecycle IN ('ONBOARDING', 'ACTIVE')").all();
      authz.invalidate();
      for (const u of rows) {
        const held = authz.resolve({ companyId: u.company_id, userId: u.id, roles: JSON.parse(u.roles_json) }).assignmentCount;
        if (u.lifecycle === 'ONBOARDING' && held > 0) { setLifecycle(db, u.id, 'ACTIVE', { by: 'system', reason: 'An assignment came into force' }); moved += 1; }
        else if (u.lifecycle === 'ACTIVE' && held === 0) { setLifecycle(db, u.id, 'ONBOARDING', { by: 'system', reason: 'No assignment is in force' }); moved += 1; }
      }
      return { moved };
    },

    // ---- the legacy comparison (FR-07) ----
    mapping(actor) {
      view(actor);
      return db.prepare('SELECT m.legacy_role, m.mapping_type, m.notes, r.id AS role_id, r.code, r.name, r.status FROM iam_role_mapping m LEFT JOIN iam_roles r ON r.id = m.new_role_id ORDER BY m.legacy_role').all()
        .map((m) => ({ legacyRole: m.legacy_role, mappingType: m.mapping_type, notes: m.notes, roleId: m.role_id, roleCode: m.code, roleName: m.name, roleStatus: m.status }));
    },

    /**
     * Each user's access before the engine (the frozen table of the nine original roles) and now (what the engine computes from the same
     * role list), with the differences classed: lost (a person lost access they had), gained (new access that is not one of this part's
     * new permissions) or new only (the role and assignment permissions that exist because of this part). Both must be empty for a clean migration.
     */
    legacyComparison(actor, query) {
      view(actor);
      const c = cid(actor);
      const mapped = new Set(db.prepare('SELECT legacy_role FROM iam_role_mapping').all().map((m) => m.legacy_role));
      const users = db.prepare('SELECT u.id, u.username, u.display_name, u.roles_json FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 ORDER BY u.username').all(c);
      const rows = users.map((u) => {
        const roles = JSON.parse(u.roles_json);
        const before = unique(roles.flatMap((r) => LEGACY_ROLE_PERMISSIONS[r] ?? []));
        const after = authz.resolve({ companyId: c, userId: null, roles }).perms;
        const lost = before.filter((k) => !after.includes(k));
        const added = after.filter((k) => !before.includes(k));
        const gained = added.filter((k) => !NEW_PERMISSIONS.has(k));
        const newOnly = added.filter((k) => NEW_PERMISSIONS.has(k));
        const unmapped = roles.filter((r) => !mapped.has(r) && !db.prepare('SELECT 1 FROM iam_roles WHERE company_id IS NULL AND code = ?').get(r));
        const result = lost.length ? 'LOST' : gained.length ? 'GAINED' : unmapped.length ? 'UNMAPPED' : newOnly.length ? 'NEW_ONLY' : 'SAME';
        return { userId: u.id, username: u.username, displayName: u.display_name, roles, before: before.length, after: after.length, lost, gained, newOnly, unmapped, result };
      });
      const summary = { users: rows.length, same: 0, newOnly: 0, lost: 0, gained: 0, unmapped: 0 };
      for (const r of rows) summary[{ SAME: 'same', NEW_ONLY: 'newOnly', LOST: 'lost', GAINED: 'gained', UNMAPPED: 'unmapped' }[r.result]] += 1;
      const q = query.q.toLowerCase();
      let shown = rows.filter((r) => !q || r.username.toLowerCase().includes(q) || r.displayName.toLowerCase().includes(q));
      if (query.filters.result) shown = shown.filter((r) => r.result === query.filters.result);
      const desc = query.sort[0]?.dir === 'desc';
      shown.sort((a, b) => (query.sort[0]?.column === 'result' ? a.result.localeCompare(b.result) : a.username.localeCompare(b.username)) * (desc ? -1 : 1));
      const total = shown.length;
      return { ...pageResponse(shown.slice(query.offset, query.offset + query.limit), total, query), summary, clean: summary.lost === 0 && summary.gained === 0, mapping: service.mapping(actor) };
    },
  };

  /** The names of what a scope picks, for showing it. */
  function scopeNames(companyId, type, scopeIds) {
    if (!SCOPE_TABLE[type] || !scopeIds.length) return [];
    return db.prepare(`SELECT code FROM ${SCOPE_TABLE[type][0]} WHERE company_id = ? AND id IN (${scopeIds.filter(Number.isInteger).join(',') || 0}) ORDER BY code`).all(companyId).map((r) => r.code);
  }
  return service;
}
