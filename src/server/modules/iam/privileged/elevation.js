import { assertPermission, hasPermission } from '../../../platform/auth/index.js';
import { authzOf } from '../../../platform/authz/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { createParameterStore } from '../../../platform/parameters/index.js';
import { sodOf } from '../../../platform/sod/index.js';
import { DIRECTOR_APPROVED_ROLES } from '../../../platform/authz/index.js';

const iso = (ms) => new Date(ms).toISOString();
const HOUR = 3_600_000;

/** Middleware: every request made while a person holds an elevation is written to the elevation's log (BR-02). */
export function elevationLogger(db) {
  const has = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'iam_elevation_log'").get());
  return (req, res, next) => {
    const list = req.actor?.elevated;
    if (!list?.length) return next();
    const started = Date.now();
    res.on('finish', () => {
      try {
        if (!has()) return;
        const route = `${req.baseUrl.replace(/^\/api\/v1/, '')}${req.route?.path ?? req.path}`;
        for (const e of list) {
          db.prepare('INSERT INTO iam_elevation_log (elevation_id, user_id, at, method, route, status, correlation_id, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(e.id, req.actor.userId, iso(Date.now()), req.method, route.slice(0, 200), res.statusCode, req.correlationId ?? null, Date.now() - started);
        }
      } catch { /* a log failure must never break the request */ }
    });
    next();
  };
}

/** An approved elevation starts: active until its end time, and then it ends by itself. */
export const elevationHandlers = {
  iam_elevation: {
    apply(db, request, actor) {
      const e = db.prepare("SELECT * FROM iam_elevations WHERE id = ? AND company_id = ? AND is_active = 1").get(request.payload.elevationId, request.companyId);
      if (!e || e.status !== 'REQUESTED') throw unprocessable('The elevation is no longer waiting for approval, so it cannot be started.');
      const user = db.prepare('SELECT id, username, roles_json FROM iam_users WHERE id = ? AND is_active = 1').get(e.user_id);
      if (!user) throw unprocessable('The person no longer has an account.');
      const role = db.prepare("SELECT id, code FROM iam_roles WHERE id = ? AND is_active = 1 AND status = 'ACTIVE'").get(e.role_id);
      if (!role) throw unprocessable('The role is no longer active, so it cannot be given.');
      // the check is made again at approval: what the person holds may have changed since the request
      sodOf(db).assertAssignable({ companyId: e.company_id, userId: e.user_id, roles: JSON.parse(user.roles_json), extra: [{ roleId: e.role_id, scopeType: e.scope_type, scopeIds: JSON.parse(e.scope_ids_json) }] });
      const nowMs = Date.now();
      const starts = e.requested_start && Date.parse(e.requested_start) > nowMs ? Date.parse(e.requested_start) : nowMs;
      const ends = starts + e.requested_hours * HOUR;
      db.prepare("UPDATE iam_elevations SET status = 'ACTIVE', approved_by = ?, starts_at = ?, ends_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(starts), iso(ends), actor.user, iso(nowMs), e.id);
      writeAudit(db, { entity: 'iam_elevations', entityId: e.id, action: 'start', newValues: { user: user.username, role: role.code, startsAt: iso(starts), endsAt: iso(ends) }, reason: e.reason, actor: actor.user });
      publishEvent(db, { type: 'iam.elevation.started', entity: 'elevation', entityId: e.id, actorId: actor.user, companyId: e.company_id, data: { username: user.username, role: role.code, endsAt: iso(ends) } });
      authzOf(db).invalidate();
    },
  },
};

/** Time-boxed elevated access (break-glass), part 02.05: asked for with a reason, approved by the manager and the IT administrator, ended by the clock. */
export function createElevationService({ db, identity, approvals }) {
  const authz = authzOf(db);
  const sod = sodOf(db);
  const store = { get: (key, ctx) => createParameterStore(db).get(key, ctx) }; // read afresh: a changed value applies at once
  const cid = (actor) => companyScope(actor).params._company_scope;
  const now = () => identity.now();
  const maxHours = (companyId) => Number(store.get('iam.elevation.max_hours', { companyId, date: new Date(now() + 19_800_000).toISOString().slice(0, 10) }));

  const present = (e) => ({
    id: e.id, userId: e.user_id, username: e.username, displayName: e.display_name, roleId: e.role_id, roleCode: e.role_code, roleName: e.role_name, scopeType: e.scope_type, scopeIds: JSON.parse(e.scope_ids_json),
    reason: e.reason, status: e.status, requestedHours: e.requested_hours, requestedStart: e.requested_start, financial: Boolean(e.financial), approvedBy: e.approved_by, startsAt: e.starts_at, endsAt: e.ends_at,
    revokedAt: e.revoked_at, revokedBy: e.revoked_by, revokeReason: e.revoke_reason, requestId: e.request_id, createdAt: e.created_at,
  });
  const SELECT = 'SELECT e.*, u.username, u.display_name, r.code AS role_code, r.name AS role_name FROM iam_elevations e JOIN iam_users u ON u.id = e.user_id JOIN iam_roles r ON r.id = e.role_id';
  const rowOf = (actor, id) => {
    const e = db.prepare(`${SELECT} WHERE e.id = ? AND e.company_id = ? AND e.is_active = 1`).get(id, cid(actor));
    if (!e) throw notFound('That elevation does not exist.');
    return e;
  };
  /** Is the elevation's approval waiting on this person? */
  const waitingOn = (actor, e) => {
    if (e.status !== 'REQUESTED' || !e.request_id) return false;
    const q = db.prepare('SELECT chain_json, current_step, status FROM core_change_requests WHERE id = ?').get(e.request_id);
    if (!q || q.status !== 'SUBMITTED') return false;
    const step = JSON.parse(q.chain_json)[q.current_step - 1];
    return step.startsWith('@') ? step.slice(1) === actor.user : step.split('|').some((x) => actor.roles.includes(x));
  };
  const mayView = (actor, e) => hasPermission(actor, 'iam.elevation.view') || e.user_id === actor.userId || waitingOn(actor, e);
  /** The manager of a person: the head of their department, when that is somebody else. */
  const managerOf = (companyId, userId) =>
    db.prepare('SELECT m.username FROM iam_user_profiles p JOIN org_departments d ON d.id = p.department_id JOIN iam_users m ON m.id = d.head_user_id WHERE p.user_id = ? AND d.company_id = ? AND m.is_active = 1 AND m.id != ?').get(userId, companyId, userId)?.username ?? null;

  /** Close the approval request of an elevation that will not go ahead (nobody is left to decide it). */
  const closeRequest = (requestId, by) => db.prepare("UPDATE core_change_requests SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'SUBMITTED'").run(by, iso(now()), requestId);

  const service = {
    maxHours,

    list(actor, query) {
      assertPermission(actor, 'iam.elevation.request');
      const c = cid(actor);
      const all = hasPermission(actor, 'iam.elevation.view');
      const where = ['e.company_id = :c', 'e.is_active = 1', "(u.username LIKE :q ESCAPE '\\' OR r.code LIKE :q ESCAPE '\\' OR e.reason LIKE :q ESCAPE '\\')"];
      const params = { c, q: likePattern(query.q) };
      if (query.filters.status) { where.push('e.status = :status'); params.status = query.filters.status; }
      if (query.filters.mine === 'true') { where.push('e.user_id = :me'); params.me = actor.userId ?? 0; }
      const w = where.join(' AND ');
      const order = orderBySql(query.sort, { createdAt: 'e.id', endsAt: 'e.ends_at' }, 'e.id DESC');
      // people without the right to see every elevation see their own and those waiting for them
      let rows = db.prepare(`${SELECT} WHERE ${w} ${order}`).all(params);
      if (!all) rows = rows.filter((e) => e.user_id === actor.userId || waitingOn(actor, e));
      if (query.filters.awaiting === 'true') rows = rows.filter((e) => waitingOn(actor, e));
      const total = rows.length;
      return pageResponse(rows.slice(query.offset, query.offset + query.limit).map((e) => ({ ...present(e), awaitingMe: waitingOn(actor, e), mine: e.user_id === actor.userId })), total, query);
    },

    get(actor, id) {
      assertPermission(actor, 'iam.elevation.request');
      const e = rowOf(actor, id);
      if (!mayView(actor, e)) throw forbidden('You can see only your own elevations and those waiting for your approval.');
      const log = db.prepare('SELECT at, method, route, status, correlation_id, duration_ms FROM iam_elevation_log WHERE elevation_id = ? ORDER BY id DESC LIMIT 200').all(id).map((l) => ({ at: l.at, method: l.method, route: l.route, status: l.status, correlationId: l.correlation_id, durationMs: l.duration_ms }));
      const count = db.prepare('SELECT COUNT(*) AS n FROM iam_elevation_log WHERE elevation_id = ?').get(id).n;
      const audit = e.starts_at ? db.prepare("SELECT entity, entity_id, action, actor, created_at FROM core_audit_log WHERE correlation_id IN (SELECT DISTINCT correlation_id FROM iam_elevation_log WHERE elevation_id = ? AND correlation_id IS NOT NULL) ORDER BY id DESC LIMIT 100").all(id).map((a) => ({ entity: a.entity, entityId: a.entity_id, action: a.action, actor: a.actor, at: a.created_at })) : [];
      return { ...present(e), request: e.request_id ? approvals.get(actor, e.request_id) : null, log, logCount: count, audit, awaitingMe: waitingOn(actor, e), canRevoke: ['ACTIVE', 'REQUESTED'].includes(e.status) && hasPermission(actor, 'iam.elevation.revoke'), canCancel: e.status === 'REQUESTED' && e.user_id === actor.userId };
    },

    /** The roles a person may ask to hold for a while (every active role except the break-glass Super Admin, which is a different path). */
    roles(actor) {
      assertPermission(actor, 'iam.elevation.request');
      return db.prepare("SELECT id, code, name, category FROM iam_roles WHERE is_active = 1 AND status = 'ACTIVE' AND (company_id IS NULL OR company_id = ?) ORDER BY name").all(cid(actor)).map((r) => ({ ...r }));
    },

    request(actor, input) {
      assertPermission(actor, 'iam.elevation.request');
      const c = cid(actor);
      if (!actor.userId) throw unprocessable('Only a signed-in person can ask for elevated access.');
      const max = maxHours(c);
      if (input.hours > max) throw badRequest('Some fields are invalid.', [{ field: 'hours', message: `Elevated access is limited to ${max} hours. Ask for ${max} or fewer and ask again if more is needed.` }]);
      const role = db.prepare("SELECT id, code, name FROM iam_roles WHERE id = ? AND is_active = 1 AND (company_id IS NULL OR company_id = ?)").get(input.roleId, c);
      if (!role) throw notFound('That role does not exist.');
      if (db.prepare("SELECT status FROM iam_roles WHERE id = ?").get(role.id).status !== 'ACTIVE') throw unprocessable(`The role ${role.code} is not active.`);
      if (input.scopeType === 'COMPANY' || input.scopeType === 'OWN') { if (input.scopeIds.length) throw badRequest('Some fields are invalid.', [{ field: 'scopeIds', message: 'A whole-company scope names nothing.' }]); }
      else if (input.scopeIds.length === 0) throw badRequest('Some fields are invalid.', [{ field: 'scopeIds', message: 'Choose where the access applies.' }]);
      const start = input.startAt ? Date.parse(input.startAt) : now();
      if (start < now() - 60_000) throw badRequest('Some fields are invalid.', [{ field: 'startAt', message: 'The start time has already passed.' }]);
      if (start > now() + 7 * 86_400_000) throw badRequest('Some fields are invalid.', [{ field: 'startAt', message: 'Elevated access can be planned at most 7 days ahead.' }]);
      if (db.prepare("SELECT 1 FROM iam_elevations WHERE user_id = ? AND role_id = ? AND status IN ('REQUESTED', 'ACTIVE') AND is_active = 1").get(actor.userId, role.id)) throw conflict(`You already have a request or an elevation for ${role.code}. Wait for it to end or cancel it.`);
      const user = db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(actor.userId);
      // the same check as giving the role for good: an elevation must not open a conflict that the rules forbid
      const warnings = sod.assertAssignable({ companyId: c, userId: actor.userId, roles: JSON.parse(user.roles_json), extra: [{ roleId: role.id, scopeType: input.scopeType, scopeIds: input.scopeIds }] });
      const financial = DIRECTOR_APPROVED_ROLES.includes(role.code) || Boolean(db.prepare("SELECT 1 FROM iam_role_permissions WHERE role_id = ? AND effect = 'allow' AND is_active = 1 AND perm_key LIKE 'finance.%' LIMIT 1").get(role.id));
      const manager = managerOf(c, actor.userId);
      const chain = [...(manager ? [`@${manager}`] : []), actor.roles.includes('ITADM') ? 'DIR' : 'ITADM', ...(financial && !actor.roles.includes('CFO') ? ['CFO'] : [])];
      return transaction(db, () => {
        const res = db.prepare("INSERT INTO iam_elevations (company_id, user_id, role_id, scope_type, scope_ids_json, reason, status, requested_hours, requested_start, financial, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?, 'elevation')")
          .run(c, actor.userId, role.id, input.scopeType, JSON.stringify([...input.scopeIds].sort((a, b) => a - b)), input.reason, input.hours, input.startAt ? iso(start) : null, financial ? 1 : 0, actor.user);
        const id = Number(res.lastInsertRowid);
        const request = approvals.submit(actor, {
          type: 'iam_elevation', title: `Elevated access: ${role.code} for ${actor.user}, ${input.hours} hour(s)${financial ? ' (financial)' : ''}`, targetType: 'iam_elevation', targetId: id, reason: input.reason, chain,
          payload: { elevationId: id, roleCode: role.code, hours: input.hours, scopeType: input.scopeType, scopeIds: input.scopeIds, financial },
        });
        db.prepare('UPDATE iam_elevations SET request_id = ? WHERE id = ?').run(request.id, id);
        writeAudit(db, { entity: 'iam_elevations', entityId: id, action: 'request', newValues: { role: role.code, hours: input.hours, scopeType: input.scopeType, financial, chain }, reason: input.reason, actor: actor.user });
        publishEvent(db, { type: 'iam.elevation.requested', entity: 'elevation', entityId: id, actorId: actor.user, companyId: c, data: { username: actor.user, role: role.code, hours: input.hours, financial } });
        return { ...service.get(actor, id), sodWarnings: warnings };
      });
    },

    /** Approve or reject at the current step; the last approval starts the elevation. */
    decide(actor, id, { action, comment }) {
      assertPermission(actor, 'iam.elevation.request');
      const e = rowOf(actor, id);
      if (e.status !== 'REQUESTED') throw unprocessable(`This elevation is ${e.status.toLowerCase()}, so it can no longer be decided.`);
      if (e.user_id === actor.userId) throw forbidden('You asked for this elevation, so someone else must decide it.');
      const done = approvals.act(actor, e.request_id, { action, comment });
      if (['REJECTED', 'RETURNED', 'CANCELLED'].includes(done.status)) {
        db.prepare("UPDATE iam_elevations SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(now()), id);
        writeAudit(db, { entity: 'iam_elevations', entityId: id, action: 'reject', reason: comment ?? null, actor: actor.user });
      }
      return service.get(actor, id);
    },

    /** The requester withdraws a request that is still waiting. */
    cancel(actor, id) {
      assertPermission(actor, 'iam.elevation.request');
      const e = rowOf(actor, id);
      if (e.user_id !== actor.userId) throw forbidden('Only the person who asked can cancel the request.');
      if (e.status !== 'REQUESTED') throw unprocessable(`This elevation is ${e.status.toLowerCase()}, so it cannot be cancelled.`);
      return transaction(db, () => {
        approvals.withdraw(actor, e.request_id);
        db.prepare("UPDATE iam_elevations SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(now()), id);
        writeAudit(db, { entity: 'iam_elevations', entityId: id, action: 'cancel', actor: actor.user });
        return service.get(actor, id);
      });
    },

    /** Take elevated access away at once. It only lowers access, so it needs no approval. */
    revoke(actor, id, { reason }) {
      assertPermission(actor, 'iam.elevation.revoke');
      const e = rowOf(actor, id);
      if (!['ACTIVE', 'REQUESTED'].includes(e.status)) throw unprocessable(`This elevation is ${e.status.toLowerCase()}, so there is nothing to revoke.`);
      return transaction(db, () => {
        if (e.status === 'REQUESTED') closeRequest(e.request_id, actor.user);
        db.prepare("UPDATE iam_elevations SET status = 'REVOKED', revoked_at = ?, revoked_by = ?, revoke_reason = ?, ends_at = CASE WHEN ends_at IS NULL OR ends_at > ? THEN ? ELSE ends_at END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(iso(now()), actor.user, reason, iso(now()), iso(now()), actor.user, iso(now()), id);
        authz.invalidate();
        writeAudit(db, { entity: 'iam_elevations', entityId: id, action: 'revoke', reason, actor: actor.user });
        publishEvent(db, { type: 'iam.elevation.revoked', entity: 'elevation', entityId: id, actorId: actor.user, companyId: e.company_id, data: { username: e.username, role: e.role_code } });
        return service.get(actor, id);
      });
    },

    /** The job: elevations whose end time has come are marked ended (access ended at that moment anyway, since it is checked against the clock). */
    expireDue() {
      const at = iso(now());
      const due = db.prepare("SELECT e.id, e.company_id, u.username, r.code FROM iam_elevations e JOIN iam_users u ON u.id = e.user_id JOIN iam_roles r ON r.id = e.role_id WHERE e.status = 'ACTIVE' AND e.ends_at <= ?").all(at);
      for (const e of due) {
        transaction(db, () => {
          db.prepare("UPDATE iam_elevations SET status = 'EXPIRED', updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(at, e.id);
          writeAudit(db, { entity: 'iam_elevations', entityId: e.id, action: 'expire', actor: 'system' });
          publishEvent(db, { type: 'iam.elevation.ended', entity: 'elevation', entityId: e.id, actorId: 'system', companyId: e.company_id, data: { username: e.username, role: e.code } });
        });
      }
      // requests nobody decided within a day lapse
      const stale = db.prepare("SELECT e.id, e.request_id FROM iam_elevations e WHERE e.status = 'REQUESTED' AND e.created_at < ?").all(iso(now() - 86_400_000));
      for (const e of stale) {
        db.prepare("UPDATE iam_elevations SET status = 'CANCELLED', updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(at, e.id);
        closeRequest(e.request_id, 'system');
      }
      if (due.length) authz.invalidate();
      return { expired: due.length, lapsed: stale.length };
    },
  };
  return service;
}
