import { ROLE_CODES, assertPermission, hasPermission } from '../../../platform/auth/index.js';
import { sodOf } from '../../../platform/sod/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { inTransaction, transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { HttpError, badRequest, conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { hashToken, newToken, passwordProblems, userBlockers } from '../../../platform/identity/index.js';
import { authzOf } from '../../../platform/authz/index.js';
import { assignmentChain } from '../access/chains.js';
import { toCsv } from '../../../platform/security/csv.js';
import { normaliseEmail, normaliseMobile } from './validators.js';
import { parseImportCsv } from './import.js';

export const INVITATION_DAYS = 7;
const RESEND_LIMIT = 5;
const RESEND_PAUSE_MS = 30_000;
const iso = (ms) => new Date(ms).toISOString();
const PHOTO_TYPES = ['png', 'jpg', 'jpeg', 'webp'];
const SIGNATURE_TYPES = ['png', 'jpg', 'jpeg'];

// A person who predates this part has no profile row: the sign-in status says Active or (disabled) Suspended.
const LC = "COALESCE(p.lifecycle, CASE u.status WHEN 'ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END)";
const COLS = `u.id, u.company_id, u.username, u.email, u.mobile, u.display_name, u.roles_json, u.last_login_at, u.created_at, u.created_by, u.updated_at, u.version,
  ${LC} AS lifecycle, COALESCE(p.user_type, 'INTERNAL') AS user_type, COALESCE(p.language, 'en') AS language, p.employee_id, p.employee_code, p.department_id, p.home_project_id,
  p.photo_file_id, p.signature_file_id, COALESCE(p.preferences_json, '{}') AS preferences_json, p.lifecycle_at, p.lifecycle_reason, d.name AS department_name, pr.name AS project_name`;
const FROM = 'FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id LEFT JOIN org_departments d ON d.id = p.department_id LEFT JOIN org_projects pr ON pr.id = p.home_project_id';
const LIVE = 'u.is_active = 1 AND u.deleted_at IS NULL';
const SORT = { displayName: 'u.display_name', username: 'u.username', status: LC, lastLoginAt: 'u.last_login_at', createdAt: 'u.created_at' };

function ensureProfile(db, user, by) {
  db.prepare("INSERT INTO iam_user_profiles (company_id, user_id, lifecycle, created_by, source_type) VALUES (?, ?, ?, ?, 'user_profile') ON CONFLICT (user_id) DO NOTHING")
    .run(user.company_id, user.id, user.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED', by);
}

/**
 * The one place where the lifecycle of a person changes. It keeps iam_users.status ("may sign in") in step: Onboarding and Active
 * people can sign in; Invited, Suspended and Deactivated people cannot.
 */
export function setLifecycle(db, userId, lifecycle, { by, reason = null, at = new Date() }) {
  const u = db.prepare('SELECT id, company_id, status FROM iam_users WHERE id = ?').get(userId);
  ensureProfile(db, u, by);
  const stamp = at.toISOString();
  db.prepare('UPDATE iam_user_profiles SET lifecycle = ?, lifecycle_at = ?, lifecycle_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE user_id = ?').run(lifecycle, stamp, reason, by, stamp, userId);
  db.prepare('UPDATE iam_users SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(lifecycle === 'ONBOARDING' || lifecycle === 'ACTIVE' ? 'ACTIVE' : 'DISABLED', by, stamp, userId);
}

const writeGrant = (db, user, role, action, { requestId = null, reason = null, by }) =>
  db.prepare("INSERT INTO iam_role_grants (company_id, user_id, role_code, action, request_id, reason, granted_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'role_grant')").run(user.company_id, user.id, role, action, requestId, reason, by, by);

/** An approved role request is applied in the approver's transaction; the roles take effect on the person's very next request. */
export const userHandlers = {
  user_role_assignment: {
    apply(db, request, actor) {
      const { userId, username, add } = request.payload;
      const u = db.prepare(`SELECT u.*, ${LC} AS lifecycle FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.company_id = ?`).get(userId, request.companyId);
      if (!u || u.lifecycle === 'SUSPENDED' || u.lifecycle === 'DEACTIVATED') {
        throw unprocessable(`${username} is ${(u?.lifecycle ?? 'not available').toLowerCase()}, so the roles cannot be granted. Reactivate the account and ask again.`);
      }
      const before = JSON.parse(u.roles_json);
      const granted = add.filter((r) => !before.includes(r));
      // the check is made again at approval (part 02.05)
      sodOf(db).assertAssignable({ companyId: request.companyId, userId: u.id, roles: before, extra: granted.map((code) => ({ code, scopeType: 'COMPANY', scopeIds: [] })) });
      const after = [...before, ...granted];
      db.prepare('UPDATE iam_users SET roles_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(after), actor.user, iso(Date.now()), u.id);
      for (const role of granted) writeGrant(db, u, role, 'GRANTED', { requestId: request.id, reason: request.reason, by: actor.user });
      if (u.lifecycle === 'ONBOARDING' && after.length > 0) setLifecycle(db, u.id, 'ACTIVE', { by: actor.user, reason: 'A role was approved' });
      sodOf(db).scanUser(request.companyId, u.id);
      writeAudit(db, { entity: 'iam_users', entityId: u.id, action: 'roles_granted', oldValues: { roles: before }, newValues: { roles: after }, reason: request.reason, actor: actor.user });
      publishEvent(db, { type: 'iam.user.roles_changed', entity: 'user', entityId: u.id, actorId: actor.user, companyId: u.company_id, data: { username: u.username, granted, revoked: [], requestId: request.id } });
    },
  },
};

/**
 * User management (part 02.03): accounts, invitations, lifecycle, role requests, the deactivation wizard, bulk import and the
 * person's own profile. `identity`, `users` and `auth` are the services of part 02.01; sign-in itself is never reimplemented here.
 */
export function createUserAdminService({ db, identity, auth, approvals, orgService, notifier, config, exportGuard = null }) {
  const authz = authzOf(db);
  const now = () => identity.now();
  const cid = (actor) => companyScope(actor).params._company_scope;
  const canManage = (actor) => hasPermission(actor, 'iam.user.manage');
  const exposeLinks = ['development', 'test'].includes(config?.environment);
  const baseUrl = () => config?.appUrl ?? `http://localhost:${config?.port ?? 3000}`;

  // ---- reading ----
  const rowOf = (actor, id) => {
    const r = db.prepare(`SELECT ${COLS} ${FROM} WHERE u.id = :id AND u.company_id = :c AND ${LIVE}`).get({ id, c: cid(actor) });
    if (!r) throw notFound('That user does not exist.');
    return r;
  };
  const roleHolders = (companyId, role, exceptId) =>
    db.prepare(`SELECT COUNT(*) AS n FROM (SELECT u.id ${FROM} WHERE u.company_id = ? AND ${LIVE} AND ${LC} = 'ACTIVE' AND u.id != ? AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = ?) UNION SELECT u.id ${FROM} JOIN iam_assignments a ON a.user_id = u.id JOIN iam_roles ar ON ar.id = a.role_id WHERE u.company_id = ? AND ${LIVE} AND ${LC} = 'ACTIVE' AND u.id != ? AND ar.code = ? AND a.status = 'ACTIVE' AND a.scope_type = 'COMPANY' AND a.is_active = 1)`).get(companyId, exceptId, role, companyId, exceptId, role).n;
  const credentialOf = (id) => db.prepare('SELECT 1 FROM iam_credentials WHERE user_id = ? AND is_active = 1').get(id);
  const invitationOf = (id) => db.prepare("SELECT * FROM iam_invitations WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(id);
  const invitationView = (i) => {
    if (!i) return null;
    const expired = i.status === 'PENDING' && i.expires_at <= iso(now());
    return { id: i.id, status: expired ? 'EXPIRED' : i.status, channel: i.channel, sentTo: i.sent_to, expiresAt: i.expires_at, sentAt: i.created_at, resendCount: i.resend_count, delivered: Boolean(i.delivered), note: i.delivery_note };
  };

  function present(actor, r, { invitation = undefined } = {}) {
    const manage = canManage(actor);
    return authz.mask(actor, 'iam_user', {
      id: r.id, username: r.username, displayName: r.display_name, email: r.email, mobile: r.mobile, language: r.language, userType: r.user_type,
      status: r.lifecycle, roles: JSON.parse(r.roles_json), employeeCode: r.employee_code, employeeId: r.employee_id, departmentId: r.department_id, departmentName: r.department_name,
      projectId: r.home_project_id, projectName: r.project_name, lastLoginAt: r.last_login_at, createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at, version: r.version,
      statusChangedAt: r.lifecycle_at, statusReason: r.lifecycle_reason, ...(invitation === undefined ? {} : { invitation }),
      canManage: manage, canSuspend: hasPermission(actor, 'iam.user.suspend'),
    });
  }

  // ---- duplicates (FR-07, BR-01) ----
  /** People that already use this email, mobile number, username or employee link, in any state (a deactivated person keeps their account: reactivate it). */
  function duplicates(companyId, { email = null, mobile = null, employeeCode = null, username = null }, exceptId = null) {
    const found = [];
    const add = (field, rows) => { for (const r of rows) if (r.id !== exceptId) found.push({ field, id: r.company_id === companyId ? r.id : null, username: r.company_id === companyId ? r.username : null, displayName: r.company_id === companyId ? r.display_name : null, status: r.company_id === companyId ? r.lifecycle : null, otherCompany: r.company_id !== companyId }); };
    const base = `SELECT u.id, u.company_id, u.username, u.display_name, ${LC} AS lifecycle ${FROM} WHERE ${LIVE}`;
    if (email) add('email', db.prepare(`${base} AND u.email = ?`).all(email));
    if (mobile) add('mobile', db.prepare(`${base} AND u.mobile = ?`).all(mobile));
    if (username) add('username', db.prepare(`${base} AND u.username = ?`).all(username));
    // from the profile side, so the unique index on the employee code is used
    if (employeeCode) add('employeeCode', db.prepare(`SELECT u.id, u.company_id, u.username, u.display_name, p.lifecycle FROM iam_user_profiles p JOIN iam_users u ON u.id = p.user_id WHERE p.company_id = ? AND p.employee_code = ? AND ${LIVE}`).all(companyId, employeeCode));
    return found;
  }
  const duplicateError = (found) =>
    new HttpError(409, 'DUPLICATE_USER', `A person with the same ${[...new Set(found.map((f) => f.field))].join(' and ')} already has an account${found.some((f) => f.status === 'DEACTIVATED') ? ' (deactivated: reactivate it instead of creating another)' : ''}.`,
      found.map((f) => ({ field: f.field, message: f.otherCompany ? 'Already used by an account of another company.' : `Already used by ${f.displayName} (${f.username}, ${f.status.toLowerCase()}).`, userId: f.id })));

  // ---- organisation links ----
  function checkLinks(companyId, { departmentId, projectId }) {
    const bad = [];
    if (departmentId && !db.prepare("SELECT 1 FROM org_departments WHERE id = ? AND company_id = ? AND is_active = 1 AND status = 'ACTIVE'").get(departmentId, companyId)) bad.push({ field: 'departmentId', message: 'That department does not exist, is inactive or belongs to another company.' });
    if (projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND is_active = 1').get(projectId, companyId)) bad.push({ field: 'projectId', message: 'That project does not exist or belongs to another company.' });
    if (bad.length) throw badRequest('Some fields are invalid. Fix them and try again.', bad);
  }

  function deriveUsername(input) {
    const seed = (input.username ?? (input.email ? input.email.split('@')[0] : null) ?? (input.mobile ? `u${input.mobile.replace(/\D/g, '').slice(-10)}` : 'user')).toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+/, '').slice(0, 56).padEnd(3, '0');
    if (input.username) return seed;
    for (let n = 1; n < 100; n += 1) {
      const candidate = n === 1 ? seed : `${seed}${n}`;
      if (!db.prepare('SELECT 1 FROM iam_users WHERE username = ?').get(candidate)) return candidate;
    }
    throw conflict('Could not derive a free username. Type one.');
  }

  /** Create the account and its profile in an Invited state (no password, cannot sign in). Runs inside the caller's transaction. */
  function insertUser(actor, input, username) {
    const res = db.prepare("INSERT INTO iam_users (company_id, username, email, mobile, display_name, roles_json, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, '[]', 'DISABLED', ?, 'iam_user')")
      .run(actor.companyId, username, input.email, input.mobile, input.displayName, actor.user);
    const id = Number(res.lastInsertRowid);
    db.prepare("INSERT INTO iam_user_profiles (company_id, user_id, lifecycle, user_type, language, employee_code, department_id, home_project_id, lifecycle_at, created_by, source_type) VALUES (?, ?, 'INVITED', ?, ?, ?, ?, ?, ?, ?, 'user_profile')")
      .run(actor.companyId, id, input.userType, input.language, input.employeeCode, input.departmentId, input.projectId, iso(now()), actor.user);
    writeAudit(db, { entity: 'iam_users', entityId: id, action: 'create', newValues: { username, email: input.email, userType: input.userType, departmentId: input.departmentId, projectId: input.projectId }, actor: actor.user });
    publishEvent(db, { type: 'iam.user.created', entity: 'user', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { username, userType: input.userType } });
    return id;
  }

  // ---- invitations (FR-02) ----
  async function deliver(companyId, inv, user, token) {
    const link = `${baseUrl()}/accept-invite?token=${token}`;
    const text = `Hello ${user.display_name},\n\nYou have been invited to the construction ERP. Open this link to choose your password:\n${link}\n\nThe link works until ${inv.expires_at.slice(0, 10)}. If you were not expecting this, ignore it.`;
    const out = inv.channel === 'email' ? await notifier.email(companyId, inv.sent_to, 'You are invited to the ERP', text) : await notifier.phone(companyId, inv.channel, inv.sent_to, text);
    db.prepare('UPDATE iam_invitations SET delivered = ?, delivery_note = ? WHERE id = ?').run(out.delivered ? 1 : 0, out.delivered ? null : `Not delivered (${out.reason}). Check the connector, then resend.`, inv.id);
    return { out, link };
  }

  async function sendInvitation(actor, id, { channel }) {
    const r = rowOf(actor, id);
    if (r.user_type === 'SERVICE_ACCOUNT') throw unprocessable('A service account does not sign in with a password, so it is not invited.');
    if (r.lifecycle !== 'INVITED') throw unprocessable(`${r.display_name} is ${r.lifecycle.toLowerCase()}, so there is nothing to invite them to. Only people in the Invited state receive an invitation.`);
    const chosen = channel ?? (r.email ? 'email' : 'sms');
    const to = chosen === 'email' ? r.email : r.mobile;
    if (!to) throw badRequest('Some fields are invalid.', [{ field: 'channel', message: chosen === 'email' ? 'This person has no email address. Add one or invite by text message.' : 'This person has no mobile number. Add one or invite by email.' }]);
    const token = newToken();
    const created = transaction(db, () => {
      const prior = db.prepare('SELECT * FROM iam_invitations WHERE user_id = ? ORDER BY id DESC').all(id);
      const pending = prior.find((i) => i.status === 'PENDING');
      if (pending && now() - Date.parse(pending.created_at) < RESEND_PAUSE_MS) throw new HttpError(429, 'RATE_LIMITED', 'An invitation was sent a moment ago. Wait half a minute before sending another.');
      if (prior.filter((i) => Date.parse(i.created_at) > now() - 86_400_000).length >= RESEND_LIMIT) throw new HttpError(429, 'RATE_LIMITED', `This person already had ${RESEND_LIMIT} invitations in the last 24 hours. Try again tomorrow, or check the address.`);
      if (pending) db.prepare("UPDATE iam_invitations SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(now()), pending.id);
      const res = db.prepare('INSERT INTO iam_invitations (company_id, user_id, token_hash, channel, sent_to, expires_at, sent_by, resend_count, created_by, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(r.company_id, id, hashToken(token), chosen, to, iso(now() + INVITATION_DAYS * 86_400_000), actor.user, prior.length, actor.user, 'invitation', iso(now()));
      const inv = db.prepare('SELECT * FROM iam_invitations WHERE id = ?').get(Number(res.lastInsertRowid));
      writeAudit(db, { entity: 'iam_users', entityId: id, action: prior.length ? 'invitation_resent' : 'invited', newValues: { channel: chosen, expiresAt: inv.expires_at }, actor: actor.user });
      publishEvent(db, { type: 'iam.user.invited', entity: 'user', entityId: id, actorId: actor.user, companyId: r.company_id, data: { username: r.username, channel: chosen, resend: prior.length > 0 } });
      return inv;
    });
    const { out, link } = await deliver(r.company_id, created, { display_name: r.display_name }, token);
    const view = invitationView(db.prepare('SELECT * FROM iam_invitations WHERE id = ?').get(created.id));
    return { invitation: view, delivered: out.delivered, ...(exposeLinks ? { devLink: link } : {}) };
  }

  const service = {
    present,
    duplicates,

    /** The role codes a request may name, and which need the extra approval of a privileged role. */
    roles(actor) {
      assertPermission(actor, 'iam.user.view');
      const required = identity.policies.for(cid(actor)).mfa.requiredRoles;
      return ROLE_CODES.map((code) => ({ code, privileged: required.includes(code) }));
    },

    // ---- the list and one person ----
    list(actor, query) {
      assertPermission(actor, 'iam.user.view');
      const where = ['u.company_id = :c', LIVE];
      const params = { c: cid(actor) };
      const f = query.filters;
      if (query.q) { where.push("(u.username LIKE :q ESCAPE '\\' OR u.display_name LIKE :q ESCAPE '\\' OR COALESCE(u.email, '') LIKE :q ESCAPE '\\' OR COALESCE(p.employee_code, '') LIKE :q ESCAPE '\\')"); params.q = likePattern(query.q); }
      if (f.status) { where.push(`${LC} = :status`); params.status = f.status; }
      if (f.type) { where.push("COALESCE(p.user_type, 'INTERNAL') = :type"); params.type = f.type; }
      if (f.departmentId) { where.push('p.department_id = :dept'); params.dept = Number(f.departmentId); }
      if (f.projectId) { where.push('p.home_project_id = :proj'); params.proj = Number(f.projectId); }
      if (f.role) { where.push('EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = :role)'); params.role = f.role; }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n ${FROM} WHERE ${w}`).get(params).n;
      const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE ${w} ${orderBySql(query.sort, SORT, 'u.id')} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      const invited = rows.filter((r) => r.lifecycle === 'INVITED').map((r) => r.id);
      const invitations = new Map();
      if (invited.length) for (const i of db.prepare(`SELECT * FROM iam_invitations WHERE user_id IN (${invited.map(() => '?').join(',')}) ORDER BY id`).all(...invited)) invitations.set(i.user_id, i);
      return pageResponse(rows.map((r) => present(actor, r, { invitation: invitationView(invitations.get(r.id) ?? null) })), total, query);
    },

    get(actor, id) {
      assertPermission(actor, 'iam.user.view');
      const r = rowOf(actor, id);
      const grants = db.prepare('SELECT role_code, action, request_id, reason, granted_by, created_at FROM iam_role_grants WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(id)
        .map((g) => ({ role: g.role_code, action: g.action, requestId: g.request_id, reason: g.reason, by: g.granted_by, at: g.created_at }));
      const requests = db.prepare("SELECT id FROM core_change_requests WHERE company_id = ? AND target_type = 'iam_user' AND target_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 30").all(r.company_id, id).map((q) => approvals.get(actor, q.id));
      const mfaFactors = db.prepare("SELECT COUNT(*) AS n FROM iam_mfa_factors WHERE user_id = ? AND type != 'backup' AND verified_at IS NOT NULL AND is_active = 1").get(id).n;
      const live = db.prepare('SELECT COUNT(*) AS n FROM iam_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?').get(id, iso(now())).n;
      const assignments = db.prepare('SELECT a.id, a.scope_type, a.scope_ids_json, a.effective_from, a.effective_to, a.status, a.reason, a.created_at, ro.code, ro.name FROM iam_assignments a JOIN iam_roles ro ON ro.id = a.role_id WHERE a.user_id = ? AND a.is_active = 1 ORDER BY a.id DESC LIMIT 50').all(id)
        .map((a) => ({ id: a.id, roleCode: a.code, roleName: a.name, scopeType: a.scope_type, scopeIds: JSON.parse(a.scope_ids_json), effectiveFrom: a.effective_from, effectiveTo: a.effective_to, status: a.status, reason: a.reason, at: a.created_at }));
      return { ...present(actor, r, { invitation: invitationView(invitationOf(id)) }), assignments, grants, requests, mfaEnrolled: mfaFactors > 0, liveSessions: live, holdings: orgService.holdingsOf(r.company_id, id), hasPassword: Boolean(credentialOf(id)) };
    },

    sessions(actor, id) {
      assertPermission(actor, 'iam.user.view');
      rowOf(actor, id);
      return db.prepare('SELECT s.public_id, s.ip, s.user_agent, s.auth_method, s.created_at, s.last_seen_at, s.expires_at, d.name AS device_name FROM iam_sessions s LEFT JOIN iam_devices d ON d.id = s.device_id WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC')
        .all(id, iso(now())).map((s) => ({ id: s.public_id, ip: s.ip, device: s.device_name, userAgent: s.user_agent, method: s.auth_method, createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at }));
    },

    loginEvents(actor, id, query) {
      assertPermission(actor, 'iam.user.view');
      rowOf(actor, id);
      const where = 'e.user_id = :u AND (:result IS NULL OR e.result = :result)';
      const params = { u: id, result: query.filters.result ?? null };
      const total = db.prepare(`SELECT COUNT(*) AS n FROM iam_login_events e WHERE ${where}`).get(params).n;
      const rows = db.prepare(`SELECT e.* FROM iam_login_events e WHERE ${where} ORDER BY e.id ${query.sort[0]?.dir === 'asc' ? 'ASC' : 'DESC'} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((e) => ({ id: e.id, at: e.at, result: e.result, ip: e.ip, country: e.geo_country, device: e.device_label, reason: e.reason })), total, query);
    },

    timeline(actor, id) {
      assertPermission(actor, 'iam.user.view');
      rowOf(actor, id);
      return db.prepare("SELECT action, actor, reason, old_values, new_values, created_at FROM core_audit_log WHERE entity = 'iam_users' AND entity_id = ? ORDER BY id DESC LIMIT 100").all(String(id))
        .map((a) => ({ action: a.action, actor: a.actor, reason: a.reason, at: a.created_at, before: a.old_values ? JSON.parse(a.old_values) : null, after: a.new_values ? JSON.parse(a.new_values) : null }));
    },

    findDuplicates(actor, q) {
      assertPermission(actor, 'iam.user.view');
      const mobile = q.mobile ? normaliseMobile(q.mobile) ?? null : null;
      return duplicates(cid(actor), { email: normaliseEmail(q.email), mobile, employeeCode: q.employeeCode?.trim() || null }, q.excludeId ?? null);
    },

    // ---- create, change ----
    async create(actor, input) {
      assertPermission(actor, 'iam.user.manage');
      cid(actor);
      checkLinks(actor.companyId, input);
      const username = deriveUsername(input);
      const dupes = duplicates(actor.companyId, { email: input.email, mobile: input.mobile, employeeCode: input.employeeCode, username });
      if (dupes.length) throw duplicateError(dupes);
      const id = transaction(db, () => insertUser(actor, input, username));
      const created = service.get(actor, id);
      if (!input.invite || input.userType === 'SERVICE_ACCOUNT') return { ...created, inviteResult: null };
      try {
        return { ...service.get(actor, id), inviteResult: await sendInvitation(actor, id, { channel: input.channel }) };
      } catch (err) {
        // The account exists; only the invitation failed. Say so rather than hiding the account.
        return { ...created, inviteResult: { error: err.message } };
      }
    },

    update(actor, id, body) {
      assertPermission(actor, 'iam.user.manage');
      const { version, reason, ...input } = body;
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (r.version !== version) throw conflict(`${r.display_name} was changed by someone else. Refresh the page and try again.`);
        if (r.lifecycle === 'DEACTIVATED') throw unprocessable('A deactivated account cannot be edited. Reactivate it first.');
        const next = {
          displayName: input.displayName ?? r.display_name, email: 'email' in input ? input.email : r.email, mobile: 'mobile' in input ? input.mobile : r.mobile, language: input.language ?? r.language,
          userType: input.userType ?? r.user_type, employeeCode: 'employeeCode' in input ? input.employeeCode : r.employee_code, departmentId: 'departmentId' in input ? input.departmentId : r.department_id,
          projectId: 'projectId' in input ? input.projectId : r.home_project_id,
        };
        if (!next.email && !next.mobile) throw badRequest('Some fields are invalid.', [{ field: 'email', message: 'Keep an email address or a mobile number: the person needs one to sign in and to be reached.' }]);
        if (input.userType && input.userType !== r.user_type && r.lifecycle !== 'INVITED') throw unprocessable('The type of an account can be changed only while the person is still Invited.');
        checkLinks(r.company_id, next);
        const dupes = duplicates(r.company_id, { email: next.email !== r.email ? next.email : null, mobile: next.mobile !== r.mobile ? next.mobile : null, employeeCode: next.employeeCode !== r.employee_code ? next.employeeCode : null }, id);
        if (dupes.length) throw duplicateError(dupes);
        ensureProfile(db, { id, company_id: r.company_id, status: 'ACTIVE' }, actor.user);
        const stamp = iso(now());
        db.prepare('UPDATE iam_users SET display_name = ?, email = ?, mobile = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next.displayName, next.email, next.mobile, actor.user, stamp, id);
        db.prepare('UPDATE iam_user_profiles SET language = ?, user_type = ?, employee_code = ?, department_id = ?, home_project_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE user_id = ?')
          .run(next.language, next.userType, next.employeeCode, next.departmentId, next.projectId, actor.user, stamp, id);
        const keys = Object.keys(input);
        const was = { displayName: r.display_name, email: r.email, mobile: r.mobile, language: r.language, userType: r.user_type, employeeCode: r.employee_code, departmentId: r.department_id, projectId: r.home_project_id };
        const changed = keys.filter((k) => JSON.stringify(was[k]) !== JSON.stringify(next[k]));
        if (changed.length === 0) throw unprocessable('Nothing changed: the values sent are the current ones.');
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'update', oldValues: Object.fromEntries(changed.map((k) => [k, was[k]])), newValues: Object.fromEntries(changed.map((k) => [k, next[k]])), reason: reason ?? null, actor: actor.user });
        publishEvent(db, { type: 'iam.user.updated', entity: 'user', entityId: id, actorId: actor.user, companyId: r.company_id, data: { username: r.username, fields: changed } });
        return service.get(actor, id);
      });
    },

    invite: (actor, id, /** @type {{ channel?: 'email' | 'sms' | 'whatsapp' }} */ { channel } = {}) => {
      assertPermission(actor, 'iam.user.manage');
      return sendInvitation(actor, id, { channel });
    },

    revokeInvitation(actor, id) {
      assertPermission(actor, 'iam.user.manage');
      return transaction(db, () => {
        const r = rowOf(actor, id);
        const pending = db.prepare("SELECT id FROM iam_invitations WHERE user_id = ? AND status = 'PENDING'").get(id);
        if (!pending) throw unprocessable(`${r.display_name} has no pending invitation.`);
        db.prepare("UPDATE iam_invitations SET status = 'REVOKED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(now()), pending.id);
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'invitation_revoked', actor: actor.user });
        return { revoked: true };
      });
    },

    /** The public side of the invitation link: is it still good, and for whom? Nothing about the account is shown beyond the name. */
    invitationInfo(token) {
      const inv = db.prepare('SELECT i.*, u.display_name, u.username FROM iam_invitations i JOIN iam_users u ON u.id = i.user_id WHERE i.token_hash = ?').get(hashToken(token));
      if (!inv || inv.status !== 'PENDING' || inv.expires_at <= iso(now())) {
        throw new HttpError(410, 'INVITATION_EXPIRED', 'This invitation link has expired, was replaced by a newer one or was already used. Ask your administrator to send a new invitation.');
      }
      const policy = identity.policies.for(inv.company_id);
      return { displayName: inv.display_name, username: inv.username, expiresAt: inv.expires_at, minPasswordLength: policy.password.minLength };
    },

    /** The person sets a password: the invitation is used up and the account becomes Onboarding (no role yet) or Active (a role was already approved). */
    async accept(token, { password }, ctx) {
      const inv = db.prepare('SELECT * FROM iam_invitations WHERE token_hash = ?').get(hashToken(token));
      if (!inv || inv.status !== 'PENDING' || inv.expires_at <= iso(now())) {
        if (inv?.status === 'PENDING') db.prepare("UPDATE iam_invitations SET status = 'EXPIRED' WHERE id = ?").run(inv.id);
        throw new HttpError(410, 'INVITATION_EXPIRED', 'This invitation link has expired, was replaced by a newer one or was already used. Ask your administrator to send a new invitation.');
      }
      const u = db.prepare(`SELECT u.*, ${LC} AS lifecycle ${FROM} WHERE u.id = ?`).get(inv.user_id);
      const policy = identity.policies.for(u.company_id);
      const problems = passwordProblems(password, policy, { username: u.username, email: u.email ?? '' });
      if (problems.length) throw unprocessable(`The password is not acceptable: ${problems.join(' ')}`, problems.map((message) => ({ field: 'password', message })));
      const hash = await identity.hasher.hash(password);
      const expires = policy.password.expiryDays ? iso(now() + policy.password.expiryDays * 86_400_000) : null;
      return transaction(db, () => {
        const fresh = db.prepare('SELECT status FROM iam_invitations WHERE id = ?').get(inv.id);
        if (fresh.status !== 'PENDING' || u.lifecycle !== 'INVITED') throw new HttpError(410, 'INVITATION_EXPIRED', 'This invitation was already used. Sign in with the password you chose.');
        db.prepare('INSERT INTO iam_credentials (company_id, user_id, password_hash, algo, expires_at, must_change, history_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)')
          .run(u.company_id, u.id, hash, 'argon2id', expires, JSON.stringify([hash]), u.username, 'invitation');
        db.prepare("UPDATE iam_invitations SET status = 'ACCEPTED', accepted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(now()), u.username, iso(now()), inv.id);
        const next = JSON.parse(u.roles_json).length > 0 ? 'ACTIVE' : 'ONBOARDING';
        setLifecycle(db, u.id, next, { by: u.username, reason: 'Invitation accepted', at: new Date(now()) });
        writeAudit(db, { entity: 'iam_users', entityId: u.id, action: 'invitation_accepted', newValues: { lifecycle: next }, actor: u.username, correlationId: ctx?.correlationId });
        publishEvent(db, { type: 'iam.user.activated', entity: 'user', entityId: u.id, actorId: u.username, companyId: u.company_id, data: { username: u.username, lifecycle: next } });
        return { accepted: true, status: next, username: u.username };
      });
    },

    // ---- lifecycle ----
    suspend(actor, id, /** @type {{ reason: string, version?: number }} */ { reason, version }) {
      assertPermission(actor, 'iam.user.suspend');
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (version !== undefined && r.version !== version) throw conflict(`${r.display_name} was changed by someone else. Refresh the page and try again.`);
        if (!['ACTIVE', 'ONBOARDING'].includes(r.lifecycle)) throw unprocessable(`${r.display_name} is ${r.lifecycle.toLowerCase()}; only an Active or Onboarding account can be suspended.`);
        if (r.id === actor.userId) throw unprocessable('You cannot suspend your own account.');
        if (JSON.parse(r.roles_json).includes('SYSADM') && roleHolders(r.company_id, 'SYSADM', r.id) === 0) throw unprocessable(`${r.display_name} is the only active system administrator. Give another person the role first, or nobody could manage users.`);
        setLifecycle(db, id, 'SUSPENDED', { by: actor.user, reason, at: new Date(now()) });
        const ended = auth.revokeSessions(id, { reason: 'suspended', by: actor.user });
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'suspend', oldValues: { lifecycle: r.lifecycle }, newValues: { lifecycle: 'SUSPENDED', sessionsEnded: ended }, reason, actor: actor.user });
        publishEvent(db, { type: 'iam.user.suspended', entity: 'user', entityId: id, actorId: actor.user, companyId: r.company_id, data: { username: r.username, sessionsEnded: ended } });
        return service.get(actor, id);
      });
    },

    reactivate(actor, id, /** @type {{ reason: string, version?: number }} */ { reason, version }) {
      assertPermission(actor, 'iam.user.suspend');
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (version !== undefined && r.version !== version) throw conflict(`${r.display_name} was changed by someone else. Refresh the page and try again.`);
        if (!['SUSPENDED', 'DEACTIVATED'].includes(r.lifecycle)) throw unprocessable(`${r.display_name} is ${r.lifecycle.toLowerCase()}; only a Suspended or Deactivated account is reactivated.`);
        if (r.lifecycle === 'DEACTIVATED') assertPermission(actor, 'iam.user.manage');
        // A deactivated person returns with no role (it was taken away); a suspended one keeps theirs.
        const next = !credentialOf(id) ? 'INVITED' : JSON.parse(r.roles_json).length > 0 ? 'ACTIVE' : 'ONBOARDING';
        setLifecycle(db, id, next, { by: actor.user, reason, at: new Date(now()) });
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'reactivate', oldValues: { lifecycle: r.lifecycle }, newValues: { lifecycle: next }, reason, actor: actor.user });
        publishEvent(db, { type: 'iam.user.reactivated', entity: 'user', entityId: id, actorId: actor.user, companyId: r.company_id, data: { username: r.username, lifecycle: next } });
        return service.get(actor, id);
      });
    },

    /** What stops this person from being deactivated, and what can be handed to a successor (BR-02, FR-05). */
    deactivationCheck(actor, id) {
      assertPermission(actor, 'iam.user.manage');
      const r = rowOf(actor, id);
      return { user: { id: r.id, username: r.username, displayName: r.display_name }, ...blockersOf(r) };
    },

    deactivate(actor, id, { reason, version, successorId }) {
      assertPermission(actor, 'iam.user.manage');
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (version !== undefined && r.version !== version) throw conflict(`${r.display_name} was changed by someone else. Refresh the page and try again.`);
        if (r.lifecycle === 'DEACTIVATED') throw unprocessable(`${r.display_name} is already deactivated.`);
        if (r.id === actor.userId) throw unprocessable('You cannot deactivate your own account.');
        const roles = JSON.parse(r.roles_json);
        if (roles.includes('SYSADM') && roleHolders(r.company_id, 'SYSADM', r.id) === 0) throw unprocessable(`${r.display_name} is the only active system administrator. Give another person the role first.`);
        const check = blockersOf(r);
        const hard = check.blockers.filter((b) => !b.reassignable);
        if (hard.length) throw blockedError(r, hard, 'These cannot be handed over from here: clear them first.');
        const soft = check.blockers.filter((b) => b.reassignable);
        /** @type {Record<string, any>} */
        let moved = {};
        if (soft.length) {
          if (!successorId) throw blockedError(r, soft, 'Choose a person to take them over, then deactivate.');
          const s = db.prepare(`SELECT u.id, u.username, ${LC} AS lifecycle ${FROM} WHERE u.id = ? AND u.company_id = ? AND ${LIVE}`).get(successorId, r.company_id);
          if (!s || s.lifecycle !== 'ACTIVE' || s.id === r.id) throw badRequest('Some fields are invalid.', [{ field: 'successorId', message: 'Choose a different person whose account is Active and in this company.' }]);
          const aboutSuccessor = approvals.openRequests(r.company_id).filter((q) => q.requestedBy === r.username && q.targetType === 'iam_user' && q.targetId === s.id);
          if (aboutSuccessor.length) throw badRequest('Some fields are invalid.', [{ field: 'successorId', message: `${s.username} is the subject of a request raised by ${r.username}, so cannot take it over. Choose someone else.` }]);
          moved = {
            requests: approvals.reassignRequester(actor, { from: r.username, to: s.username, reason: `${r.username} was deactivated: ${reason}` }),
            organisationRoles: orgService.reassignHoldings(actor.user, r.company_id, r.id, s.id, `${r.username} was deactivated: ${reason}`),
            ...userBlockers.reassign(db, { companyId: r.company_id, from: r.id, to: s.id, actor: actor.user }),
          };
          moved.successor = s.username;
        }
        for (const role of roles) writeGrant(db, r, role, 'REVOKED', { reason: `Deactivated: ${reason}`, by: actor.user });
        for (const a of db.prepare("SELECT a.id, ro.code FROM iam_assignments a JOIN iam_roles ro ON ro.id = a.role_id WHERE a.user_id = ? AND a.status = 'ACTIVE'").all(id)) {
          db.prepare("UPDATE iam_assignments SET status = 'ENDED', ended_at = ?, ended_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(now()), actor.user, actor.user, iso(now()), a.id);
          writeGrant(db, r, a.code, 'REVOKED', { reason: `Deactivated: ${reason}`, by: actor.user });
        }
        db.prepare("UPDATE iam_users SET roles_json = '[]', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(now()), id);
        db.prepare("UPDATE iam_invitations SET status = 'REVOKED', updated_by = ?, updated_at = ?, version = version + 1 WHERE user_id = ? AND status = 'PENDING'").run(actor.user, iso(now()), id);
        setLifecycle(db, id, 'DEACTIVATED', { by: actor.user, reason, at: new Date(now()) });
        const ended = auth.revokeSessions(id, { reason: 'deactivated', by: actor.user });
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'deactivate', oldValues: { lifecycle: r.lifecycle, roles }, newValues: { lifecycle: 'DEACTIVATED', sessionsEnded: ended, handedOver: moved }, reason, actor: actor.user });
        publishEvent(db, { type: 'iam.user.deactivated', entity: 'user', entityId: id, actorId: actor.user, companyId: r.company_id, data: { username: r.username, sessionsEnded: ended, successor: moved.successor ?? '' } });
        return { ...service.get(actor, id), handedOver: moved };
      });
    },

    // ---- roles (until the assignments of 02.04) ----
    requestRoles(actor, id, { roles, reason }) {
      assertPermission(actor, 'iam.user.manage');
      const r = rowOf(actor, id);
      if (['SUSPENDED', 'DEACTIVATED'].includes(r.lifecycle)) throw unprocessable(`${r.display_name} is ${r.lifecycle.toLowerCase()}. Reactivate the account before asking for a role.`);
      const held = JSON.parse(r.roles_json);
      const add = [...new Set(roles)].filter((x) => !held.includes(x));
      if (add.length === 0) throw unprocessable(`${r.display_name} already holds ${roles.join(', ')}.`);
      if (approvals.hasOpen(r.company_id, 'user_role_assignment', 'iam_user', id)) throw conflict(`There is already an open role request for ${r.display_name}. Decide or withdraw it first.`);
      const policy = identity.policies.for(r.company_id);
      const privileged = add.some((x) => policy.mfa.requiredRoles.includes(x));
      const chain = assignmentChain({ codes: add, privilegedCodes: policy.mfa.requiredRoles, bySysadm: actor.roles.includes('SYSADM') });
      const sodWarnings = sodOf(db).assertAssignable({ companyId: r.company_id, userId: id, roles: held, extra: add.map((code) => ({ code, scopeType: 'COMPANY', scopeIds: [] })) });
      return { sodWarnings, ...approvals.submit(actor, { type: 'user_role_assignment', title: `Give ${add.join(', ')} to ${r.username}`, targetType: 'iam_user', targetId: id, payload: { userId: id, username: r.username, add, privileged }, reason, chain }) };
    },

    /** Taking a role away only lowers access, so it is direct (audited) rather than approved. */
    revokeRoles(actor, id, { roles, reason, version }) {
      assertPermission(actor, 'iam.user.manage');
      return inTransaction(db, () => {
        const r = rowOf(actor, id);
        if (version !== undefined && r.version !== version) throw conflict(`${r.display_name} was changed by someone else. Refresh the page and try again.`);
        if (r.id === actor.userId) throw unprocessable('You cannot take roles away from your own account.');
        const held = JSON.parse(r.roles_json);
        const gone = roles.filter((x) => held.includes(x));
        if (gone.length === 0) throw unprocessable(`${r.display_name} does not hold ${roles.join(', ')}.`);
        if (gone.includes('SYSADM') && roleHolders(r.company_id, 'SYSADM', r.id) === 0) throw unprocessable(`${r.display_name} is the only active system administrator. Give another person the role first.`);
        const left = held.filter((x) => !gone.includes(x));
        db.prepare('UPDATE iam_users SET roles_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(left), actor.user, iso(now()), id);
        for (const role of gone) writeGrant(db, r, role, 'REVOKED', { reason, by: actor.user });
        authz.invalidate();
        if (left.length === 0 && r.lifecycle === 'ACTIVE') setLifecycle(db, id, 'ONBOARDING', { by: actor.user, reason: 'The last role was taken away', at: new Date(now()) });
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'roles_revoked', oldValues: { roles: held }, newValues: { roles: left }, reason, actor: actor.user });
        publishEvent(db, { type: 'iam.user.roles_changed', entity: 'user', entityId: id, actorId: actor.user, companyId: r.company_id, data: { username: r.username, granted: [], revoked: gone, requestId: 0 } });
        return service.get(actor, id);
      });
    },

    /**
     * A CSV of the people the list shows (FR-08 of part 02.07). Above the threshold in the security settings the export waits for an
     * approved request; the CSV leaves only after the permission, size and approval checks, and the export is logged.
     */
    exportUsers(actor, { list, approvalId, filters, q }) {
      assertPermission(actor, 'iam.user.view');
      const total = service.list(actor, { ...list, limit: 1, offset: 0 }).meta.total;
      const decision = exportGuard.authorize(actor, { report: 'users.csv', permission: 'iam.user.export', rows: total, personal: true, filters: { q, ...filters }, approvalId });
      if (decision.status === 'APPROVAL_REQUIRED') return { status: 'APPROVAL_REQUIRED', rows: total, threshold: exportGuard.threshold(), request: decision.request };
      const rows = [];
      for (let offset = 0; offset < total; offset += 200) rows.push(...service.list(actor, { ...list, limit: 200, offset }).data);
      const csv = toCsv(['Username', 'Name', 'Employee code', 'Department', 'Status', 'Type', 'Roles', 'Last sign-in'], rows.map((u) => [u.username, u.displayName, u.employeeCode ?? '', u.departmentName ?? '', u.status, u.userType, u.roles.join(' '), u.lastLoginAt ?? '']));
      transaction(db, () => exportGuard.complete(actor, { report: 'users.csv', format: 'csv', rows: total, filters: { q, ...filters }, personal: true, approvalId: decision.approvalId ?? null }));
      return { status: 'OK', rows: total, csv };
    },

    // ---- bulk actions ----
    async bulk(actor, { action, ids, reason }) {
      assertPermission(actor, action === 'invite' ? 'iam.user.manage' : 'iam.user.suspend');
      const results = [];
      for (const id of ids) {
        try {
          if (action === 'invite') await service.invite(actor, id, {});
          else service.suspend(actor, id, { reason });
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, code: err.code ?? 'ERROR', error: err.message });
        }
      }
      return { action, requested: ids.length, succeeded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
    },

    // ---- bulk import (FR-04): CSV until the Excel engine of 04.13 exists ----
    async importUsers(actor, text, { mode, skipInvalid, invite, channel }) {
      assertPermission(actor, 'iam.user.manage');
      const companyId = cid(actor);
      const parsed = parseImportCsv(text);
      const departments = new Map();
      for (const d of db.prepare("SELECT id, code FROM org_departments WHERE company_id = ? AND is_active = 1 AND status = 'ACTIVE'").all(companyId)) departments.set(d.code.toLowerCase(), [...(departments.get(d.code.toLowerCase()) ?? []), d.id]);
      const projects = new Map(db.prepare('SELECT id, code FROM org_projects WHERE company_id = ? AND is_active = 1').all(companyId).map((p) => [p.code.toLowerCase(), p.id]));
      const seen = { username: new Map(), email: new Map(), mobile: new Map(), employeeCode: new Map() };
      const rows = parsed.rows.map(({ row, data, errors }) => {
        const problems = [...errors];
        let input = null;
        if (problems.length === 0) {
          input = { ...data.values, departmentId: null, projectId: null };
          if (data.department) {
            const ids = departments.get(data.department.toLowerCase());
            if (!ids) problems.push({ field: 'department', message: `No active department with the code "${data.department}".` });
            else if (ids.length > 1) problems.push({ field: 'department', message: `The code "${data.department}" is used by more than one department. Make the codes unique or leave it blank.` });
            else input.departmentId = ids[0];
          }
          if (data.project) {
            const pid = projects.get(data.project.toLowerCase());
            if (!pid) problems.push({ field: 'project', message: `No project with the code "${data.project}".` });
            else input.projectId = pid;
          }
          input.username = input.username ?? null;
          if (input.userType === 'SERVICE_ACCOUNT') problems.push({ field: 'userType', message: 'Service accounts are not imported.' });
          for (const [field, key] of [['username', input.username], ['email', input.email], ['mobile', input.mobile], ['employeeCode', input.employeeCode]]) {
            if (!key) continue;
            if (seen[field].has(key)) problems.push({ field, message: `The same ${field} appears in row ${seen[field].get(key)}.` });
            else seen[field].set(key, row);
          }
          if (problems.length === 0) {
            const dupes = duplicates(companyId, { email: input.email, mobile: input.mobile, employeeCode: input.employeeCode, username: input.username });
            for (const d of dupes) problems.push({ field: d.field, message: d.otherCompany ? `The ${d.field} is already used by an account of another company.` : `The ${d.field} is already used by ${d.displayName} (${d.username}, ${d.status.toLowerCase()}).` });
          }
        }
        return { row, input, errors: problems };
      });
      const errors = rows.flatMap((r) => r.errors.map((e) => ({ row: r.row, ...e })));
      const valid = rows.filter((r) => r.errors.length === 0);
      const summary = { total: rows.length, valid: valid.length, invalid: rows.length - valid.length, errors };
      if (mode === 'validate') return { mode, ...summary, created: 0 };
      if (errors.length && !skipInvalid) {
        throw unprocessable(`The file was not imported: ${rows.length - valid.length} of ${rows.length} rows have problems. Fix them, or import only the valid rows.`, errors.map((e) => ({ field: `row ${e.row}: ${e.field}`, message: e.message })));
      }
      if (valid.length === 0) throw unprocessable('There are no valid rows to import.');
      const created = transaction(db, () => {
        const ids = valid.map((v) => insertUser(actor, v.input, deriveUsername(v.input)));
        writeAudit(db, { entity: 'iam_users', entityId: 'import', action: 'import', newValues: { created: ids.length, skipped: rows.length - valid.length }, actor: actor.user });
        publishEvent(db, { type: 'iam.user.imported', entity: 'user', entityId: 'import', actorId: actor.user, companyId, data: { created: ids.length, skipped: rows.length - valid.length } });
        return ids;
      });
      let invited = 0;
      const inviteFailed = [];
      if (invite) {
        for (const id of created) {
          try {
            await sendInvitation(actor, id, { channel });
            invited += 1;
          } catch (err) {
            inviteFailed.push({ id, error: err.message });
          }
        }
      }
      return { mode, ...summary, created: created.length, ids: created, invited, inviteFailed };
    },

    // ---- the signed-in person's own profile (FR-06) ----
    profileExtras(actor) {
      const u = actor?.userId ? db.prepare(`SELECT ${COLS} ${FROM} WHERE u.id = ?`).get(actor.userId) : null;
      if (!u) return {};
      const prefs = JSON.parse(u.preferences_json);
      return {
        language: u.language, userType: u.user_type, lifecycle: u.lifecycle, employeeCode: u.employee_code, departmentId: u.department_id ?? null, departmentName: u.department_name, projectName: u.project_name, mobile: u.mobile,
        photoFileId: u.photo_file_id, signatureFileId: u.signature_file_id, version: u.version, onboarding: JSON.parse(u.roles_json).length === 0,
        preferences: { theme: prefs.theme ?? 'light', notifications: { email: true, sms: false, whatsapp: false, inApp: true, ...(prefs.notifications ?? {}) } },
      };
    },

    updateMe(actor, body) {
      if (!actor?.userId) throw badRequest('This needs a signed-in user. It is not available with development headers.');
      const { version, ...input } = body;
      return transaction(db, () => {
        const r = db.prepare(`SELECT ${COLS} ${FROM} WHERE u.id = ?`).get(actor.userId);
        if (r.version !== version) throw conflict('Your profile was changed in another window. Refresh the page and try again.');
        const checkFile = (fileId, types, label) => {
          const f = db.prepare('SELECT id, company_id, extension, scan_status, linked_entity, linked_id FROM core_files WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(fileId);
          if (!f || f.company_id !== r.company_id || f.linked_entity !== 'iam_user_profile' || String(f.linked_id) !== String(r.id)) throw badRequest('Some fields are invalid.', [{ field: label, message: 'Upload the image from your profile page first.' }]);
          if (!types.includes(f.extension)) throw badRequest('Some fields are invalid.', [{ field: label, message: `Use a ${types.join(', ').toUpperCase()} image.` }]);
          if (f.scan_status !== 'CLEAN') throw new HttpError(409, 'FILE_NOT_AVAILABLE', f.scan_status === 'PENDING' ? 'The image is still being scanned for viruses. Try again in a moment.' : 'That image did not pass the virus scan.');
        };
        if (input.photoFileId) checkFile(input.photoFileId, PHOTO_TYPES, 'photoFileId');
        if (input.signatureFileId) checkFile(input.signatureFileId, SIGNATURE_TYPES, 'signatureFileId');
        const prefs = JSON.parse(r.preferences_json);
        if (input.preferences) {
          if (input.preferences.theme) prefs.theme = input.preferences.theme;
          if (input.preferences.notifications) prefs.notifications = { ...(prefs.notifications ?? {}), ...input.preferences.notifications };
        }
        ensureProfile(db, { id: r.id, company_id: r.company_id, status: 'ACTIVE' }, actor.user);
        const stamp = iso(now());
        db.prepare('UPDATE iam_users SET display_name = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(input.displayName ?? r.display_name, actor.user, stamp, r.id);
        db.prepare('UPDATE iam_user_profiles SET language = ?, photo_file_id = ?, signature_file_id = ?, preferences_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE user_id = ?')
          .run(input.language ?? r.language, 'photoFileId' in input ? input.photoFileId : r.photo_file_id, 'signatureFileId' in input ? input.signatureFileId : r.signature_file_id, JSON.stringify(prefs), actor.user, stamp, r.id);
        const names = Object.keys(input);
        writeAudit(db, { entity: 'iam_users', entityId: r.id, action: 'profile_update', newValues: Object.fromEntries(names.map((n) => [n, input[n]])), actor: actor.user });
        publishEvent(db, { type: 'iam.user.profile_updated', entity: 'user', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { username: r.username, fields: names } });
        return service.profileExtras(actor);
      });
    },

    /** The job: invitations whose time has passed are marked Expired (the person stays Invited and can be invited again). */
    expireInvitations() {
      const res = db.prepare("UPDATE iam_invitations SET status = 'EXPIRED', updated_by = 'system', updated_at = ?, version = version + 1 WHERE status = 'PENDING' AND expires_at <= ?").run(iso(now()), iso(now()));
      return { expired: Number(res.changes) };
    },
  };

  /** Open items of one person: approval requests they raised (reassignable), steps only they can decide, organisation roles, and what other modules registered. */
  function blockersOf(r) {
    const blockers = [];
    const open = approvals.openRequests(r.company_id);
    const raised = open.filter((q) => q.requestedBy === r.username);
    if (raised.length) blockers.push({ type: 'approval requests raised by this person', count: raised.length, hint: 'Someone else takes them over so they can still be decided.', reassignable: true, items: raised.map((q) => ({ id: q.id, title: q.title })) });
    const roles = JSON.parse(r.roles_json);
    const stuck = open.filter((q) => q.stepRole && q.requestedBy !== r.username && !q.stepRole.startsWith('@') && q.stepRole.split('|').some((x) => roles.includes(x)) && q.stepRole.split('|').every((x) => roleHolders(r.company_id, x, r.id) === 0));
    if (stuck.length) blockers.push({ type: 'approval steps only this person can decide', count: stuck.length, hint: 'Give the role to another person first (a role request), then deactivate.', reassignable: false, items: stuck.map((q) => ({ id: q.id, title: q.title, role: q.stepRole })) });
    const holdings = orgService.holdingsOf(r.company_id, r.id);
    if (holdings.length) blockers.push({ type: 'organisation roles (department head, project manager, site in-charge)', count: holdings.length, hint: 'They pass to the person you choose, from today.', reassignable: true, items: holdings.map((h) => ({ kind: h.kind, code: h.code, name: h.name, pending: h.pending })) });
    for (const b of userBlockers.collect(db, { companyId: r.company_id, userId: r.id, username: r.username })) blockers.push({ type: b.type, count: b.count, hint: b.hint ?? '', reassignable: b.reassignable, source: b.source });
    return { blockers, canDeactivate: blockers.length === 0, successorNeeded: blockers.some((b) => b.reassignable) };
  }
  const blockedError = (r, list, tail) =>
    unprocessable(`${r.display_name} cannot be deactivated yet: ${list.map((b) => `${b.count} ${b.type}${b.hint ? ` (${b.hint})` : ''}`).join('; ')}. ${tail}`, list.map((b) => ({ field: 'blockers', message: `${b.count} ${b.type}. ${b.hint}`.trim(), type: b.type, count: b.count, reassignable: b.reassignable })));

  return service;
}

