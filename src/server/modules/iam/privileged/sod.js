import { assertPermission, hasPermission } from '../../../platform/auth/index.js';
import { authzOf } from '../../../platform/authz/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { badRequest, conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { sodOf } from '../../../platform/sod/index.js';
import { createParameterStore } from '../../../platform/parameters/index.js';
import { setLifecycle } from '../usermgmt/service.js';

const iso = (ms) => new Date(ms).toISOString();

/** An approved change to a segregation-of-duties rule (a new one, or an edit or switch-off of one): applied in the approver's transaction. */
export const sodHandlers = {
  iam_sod_rule_change: {
    apply(db, request, actor) {
      const p = request.payload;
      const r = p.rule;
      const sod = sodOf(db);
      let ruleId = p.ruleId ?? null;
      if (ruleId) {
        const row = db.prepare('SELECT * FROM iam_sod_rules WHERE id = ? AND company_id = ? AND is_active = 1').get(ruleId, request.companyId);
        if (!row) throw unprocessable('The rule no longer exists, so the change cannot be applied.');
        db.prepare('UPDATE iam_sod_rules SET name = ?, description = ?, kind = ?, set_a_json = ?, set_b_json = ?, scope = ?, severity = ?, conditions_json = ?, active = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(r.name, r.description, r.kind, JSON.stringify(r.setA), JSON.stringify(r.setB), r.scope, r.severity, JSON.stringify(r.conditions ?? {}), r.active ? 1 : 0, actor.user, iso(Date.now()), ruleId);
      } else {
        if (db.prepare('SELECT 1 FROM iam_sod_rules WHERE company_id = ? AND code = ?').get(request.companyId, r.code)) throw unprocessable(`A rule with the code ${r.code} already exists.`);
        ruleId = Number(db.prepare("INSERT INTO iam_sod_rules (company_id, code, name, description, kind, set_a_json, set_b_json, scope, severity, conditions_json, active, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sod_rule')")
          .run(request.companyId, r.code, r.name, r.description, r.kind, JSON.stringify(r.setA), JSON.stringify(r.setB), r.scope, r.severity, JSON.stringify(r.conditions ?? {}), r.active ? 1 : 0, request.requestedBy).lastInsertRowid);
      }
      writeAudit(db, { entity: 'iam_sod_rules', entityId: ruleId, action: p.ruleId ? 'change_approved' : 'create_approved', oldValues: p.before ?? null, newValues: r, reason: request.reason, actor: actor.user });
      publishEvent(db, { type: 'iam.sod.rule_changed', entity: 'sod_rule', entityId: ruleId, actorId: actor.user, companyId: request.companyId, data: { code: r.code, severity: r.severity, active: r.active, requestId: request.id } });
      sod.invalidate();
    },
  },
};

/** Segregation-of-duties rules, the violations they find and the dormant accounts (part 02.05). */
export function createSodService({ db, identity, auth, approvals, access, userAdmin }) {
  const store = { get: (key, ctx) => createParameterStore(db).get(key, ctx) }; // read afresh: a changed value applies at once
  const sod = sodOf(db);
  const authz = authzOf(db);
  const cid = (actor) => companyScope(actor).params._company_scope;
  const now = () => identity.now();
  const view = (actor) => assertPermission(actor, 'iam.sod.view');
  const present = (r, open = 0) => ({ id: r.id, code: r.code, name: r.name, description: r.description, kind: r.kind, setA: r.setA, setB: r.setB, scope: r.scope, severity: r.severity, conditions: r.conditions, active: r.active, version: r.version, openViolations: open });

  const service = {
    // ---- rules ----
    rules(actor, query) {
      view(actor);
      const c = cid(actor);
      sod.ensureRules(c);
      const where = ['r.company_id = :c', 'r.is_active = 1', "(r.code LIKE :q ESCAPE '\\' OR r.name LIKE :q ESCAPE '\\')"];
      const params = { c, q: likePattern(query.q) };
      for (const [name, col] of [['severity', 'r.severity'], ['kind', 'r.kind']]) if (query.filters[name]) { where.push(`${col} = :f_${name}`); params[`f_${name}`] = query.filters[name]; }
      if (query.filters.active) { where.push('r.active = :f_active'); params.f_active = query.filters.active === 'true' ? 1 : 0; }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM iam_sod_rules r WHERE ${w}`).get(params).n;
      const order = orderBySql(query.sort, { code: 'r.code', severity: 'r.severity', open: 'open' }, 'r.id');
      const rows = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM iam_sod_violations v WHERE v.rule_id = r.id AND v.status = 'OPEN') AS open FROM iam_sod_rules r WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      const parsed = new Map(sod.rules(c, { onlyActive: false }).map((r) => [r.id, r]));
      return pageResponse(rows.map((r) => ({ ...present(parsed.get(r.id), r.open), canManage: hasPermission(actor, 'iam.sod.manage'), requests: undefined })), total, query);
    },

    rule(actor, id) {
      view(actor);
      const c = cid(actor);
      const r = sod.rules(c, { onlyActive: false }).find((x) => x.id === id);
      if (!r) throw notFound('That rule does not exist.');
      const requests = db.prepare("SELECT id FROM core_change_requests WHERE company_id = ? AND target_type = 'iam_sod_rule' AND target_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 20").all(c, id).map((q) => approvals.get(actor, q.id));
      const open = db.prepare("SELECT COUNT(*) AS n FROM iam_sod_violations WHERE rule_id = ? AND status = 'OPEN'").get(id).n;
      return { ...present(r, open), requests, canManage: hasPermission(actor, 'iam.sod.manage') };
    },

    /** Ask for a rule to be added, changed or switched off. Nothing changes until the auditor or the director approves. */
    requestChange(actor, { ruleId, rule, reason }) {
      assertPermission(actor, 'iam.sod.manage');
      const c = cid(actor);
      sod.ensureRules(c);
      let before = null;
      if (ruleId) {
        before = sod.rules(c, { onlyActive: false }).find((x) => x.id === ruleId);
        if (!before) throw notFound('That rule does not exist.');
        if (before.code !== rule.code) throw badRequest('Some fields are invalid.', [{ field: 'code', message: 'The code of a rule cannot be changed.' }]);
        if (approvals.hasOpen(c, 'iam_sod_rule_change', 'iam_sod_rule', ruleId)) throw conflict('There is already an open change for this rule. Decide or withdraw it first.');
        if (JSON.stringify(present(before)) === JSON.stringify({ ...present(before), ...rule, setA: rule.setA, setB: rule.setB, conditions: rule.conditions })) throw unprocessable('Nothing would change: the requested values are the current ones.');
      } else if (db.prepare('SELECT 1 FROM iam_sod_rules WHERE company_id = ? AND code = ?').get(c, rule.code)) throw conflict(`A rule with the code ${rule.code} already exists.`);
      const verb = !ruleId ? 'Add' : rule.active === false && before?.active ? 'Switch off' : 'Change';
      return approvals.submit(actor, {
        type: 'iam_sod_rule_change', title: `${verb} segregation-of-duties rule ${rule.code} (${rule.severity})`, targetType: 'iam_sod_rule', targetId: ruleId ?? 0, reason,
        chain: ['AUD|DIR'], payload: { ruleId: ruleId ?? null, rule, before: before ? present(before) : null },
      });
    },

    /** Try a rule on a person: what they hold now, and what they would hold with one more role; or whether an action would be allowed. */
    test(actor, { userId, roleId, scopeType, action, subjectType, subjectId }) {
      view(actor);
      const c = cid(actor);
      const u = db.prepare('SELECT id, username, display_name, roles_json FROM iam_users WHERE id = ? AND company_id = ? AND is_active = 1').get(userId, c);
      if (!u) throw notFound('That user does not exist.');
      const roles = JSON.parse(u.roles_json);
      const shape = (list) => list.map((x) => ({ rule: x.rule.code, name: x.rule.name, severity: x.rule.severity, a: x.a, b: x.b, rolesA: x.rolesA, rolesB: x.rolesB }));
      const out = { user: { id: u.id, username: u.username, displayName: u.display_name }, now: shape(sod.conflictsOf({ companyId: c, userId, roles })) };
      if (roleId) {
        const role = db.prepare("SELECT id, code, name FROM iam_roles WHERE id = ? AND is_active = 1 AND (company_id IS NULL OR company_id = ?)").get(roleId, c);
        if (!role) throw notFound('That role does not exist.');
        const before = new Set(out.now.map((x) => x.rule));
        out.withRole = { role: role.code, conflicts: shape(sod.conflictsOf({ companyId: c, userId, roles, extra: [{ roleId, scopeType: scopeType ?? 'COMPANY', scopeIds: [] }] })).filter((x) => !before.has(x.rule)) };
        out.withRole.allowed = !out.withRole.conflicts.some((x) => x.severity === 'BLOCK');
      }
      if (action) {
        if (!subjectType || !subjectId) throw badRequest('Some fields are invalid.', [{ field: 'subjectId', message: 'Name the document the action is on.' }]);
        const r = sod.checkAction({ companyId: c, actor: { user: u.username }, action, subject: { type: subjectType, id: subjectId } });
        out.action = { action, blocks: r.blocks.map((h) => ({ rule: h.rule.code, name: h.rule.name, did: h.did, at: h.at })), warnings: r.warnings.map((h) => ({ rule: h.rule.code, name: h.rule.name, did: h.did })), detected: r.detected.map((h) => ({ rule: h.rule.code, did: h.did })) };
        out.action.allowed = r.blocks.length === 0;
      }
      return out;
    },

    // ---- violations ----
    violations(actor, query) {
      view(actor);
      const c = cid(actor);
      const where = ['v.company_id = :c', 'v.is_active = 1', "(v.user_ref LIKE :q ESCAPE '\\' OR r.code LIKE :q ESCAPE '\\' OR r.name LIKE :q ESCAPE '\\' OR COALESCE(v.document_type, '') LIKE :q ESCAPE '\\')"];
      const params = { c, q: likePattern(query.q) };
      for (const [name, col] of [['status', 'v.status'], ['ruleId', 'v.rule_id'], ['severity', 'v.severity'], ['source', 'v.source'], ['outcome', 'v.outcome']]) {
        if (query.filters[name]) { where.push(`${col} = :f_${name}`); params[`f_${name}`] = name === 'ruleId' ? Number(query.filters[name]) : query.filters[name]; }
      }
      if (query.from) { where.push('v.detected_at >= :from'); params.from = `${query.from}T00:00:00.000Z`; }
      if (query.to) { where.push('v.detected_at <= :to'); params.to = `${query.to}T23:59:59.999Z`; }
      const w = where.join(' AND ');
      const from = 'FROM iam_sod_violations v JOIN iam_sod_rules r ON r.id = v.rule_id';
      const total = db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${w}`).get(params).n;
      const order = orderBySql(query.sort, { detectedAt: 'v.detected_at', severity: 'v.severity', user: 'v.user_ref' }, 'v.id DESC');
      const rows = db.prepare(`SELECT v.*, r.code AS rule_code, r.name AS rule_name ${from} WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      const summary = db.prepare(`SELECT COUNT(*) AS total, SUM(v.status = 'OPEN') AS open, SUM(v.status = 'BLOCKED') AS blocked, SUM(v.status = 'RESOLVED') AS resolved, SUM(v.status = 'ACCEPTED') AS accepted, SUM(v.status = 'OPEN' AND v.severity = 'BLOCK') AS open_block FROM iam_sod_violations v WHERE v.company_id = ? AND v.is_active = 1`).get(c);
      return {
        ...pageResponse(rows.map((v) => ({
          id: v.id, ruleId: v.rule_id, ruleCode: v.rule_code, ruleName: v.rule_name, user: v.user_ref, userId: v.user_id, source: v.source, outcome: v.outcome, severity: v.severity, documentType: v.document_type, documentId: v.document_id,
          detail: JSON.parse(v.detail_json), detectedAt: v.detected_at, status: v.status, resolvedAt: v.resolved_at, resolvedBy: v.resolved_by, resolution: v.resolution,
        })), total, query),
        summary: { total: summary.total, open: summary.open ?? 0, blocked: summary.blocked ?? 0, resolved: summary.resolved ?? 0, accepted: summary.accepted ?? 0, openBlocking: summary.open_block ?? 0 },
      };
    },

    /** Look for violations now: every person's standing conflicts. */
    scan(actor) {
      assertPermission(actor, 'iam.sod.resolve');
      const c = cid(actor);
      return transaction(db, () => {
        const r = sod.scanCompany(c);
        writeAudit(db, { entity: 'iam_sod_violations', entityId: 'scan', action: 'scan', newValues: r, actor: actor.user });
        return r;
      });
    },

    /**
     * Deal with a violation. Taking a role away is remediation and needs the right to do that (the system administrator); accepting the
     * risk, with a reason, is for the auditor or the director, who are not the people who gave the access.
     */
    resolve(actor, id, { action, assignmentId, roleCode, reason }) {
      view(actor);
      const c = cid(actor);
      const v = db.prepare('SELECT v.*, r.code AS rule_code FROM iam_sod_violations v JOIN iam_sod_rules r ON r.id = v.rule_id WHERE v.id = ? AND v.company_id = ? AND v.is_active = 1').get(id, c);
      if (!v) throw notFound('That violation does not exist.');
      if (v.status !== 'OPEN') throw unprocessable(`This violation is ${v.status.toLowerCase()}, so it cannot be dealt with again.`);
      if (action === 'ACCEPT') {
        assertPermission(actor, 'iam.sod.resolve');
        if (v.user_id === actor.userId) throw unprocessable('You cannot accept a risk on your own access.');
        return transaction(db, () => {
          db.prepare("UPDATE iam_sod_violations SET status = 'ACCEPTED', resolved_at = ?, resolved_by = ?, resolution = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(now()), actor.user, reason, actor.user, iso(now()), id);
          writeAudit(db, { entity: 'iam_sod_violations', entityId: id, action: 'accept_risk', newValues: { rule: v.rule_code, user: v.user_ref }, reason, actor: actor.user });
          return service.violation(actor, id);
        });
      }
      // REMOVE_ROLE
      if (v.source !== 'ASSIGNMENT' || !v.user_id) throw unprocessable('Only a standing conflict in what a person holds is remedied by taking a role away. For a transaction, accept the risk or follow it up with the people involved.');
      return transaction(db, () => {
        if (assignmentId) access.endAssignment(actor, assignmentId, { reason });
        else if (roleCode) userAdmin.revokeRoles(actor, v.user_id, { roles: [roleCode], reason });
        else throw badRequest('Some fields are invalid.', [{ field: 'roleCode', message: 'Choose which role to take away.' }]);
        authz.invalidate();
        sod.scanUser(c, v.user_id);
        const after = db.prepare('SELECT status FROM iam_sod_violations WHERE id = ?').get(id);
        if (after.status === 'RESOLVED') db.prepare("UPDATE iam_sod_violations SET resolved_by = ?, resolution = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(actor.user, `Removed ${roleCode ?? `assignment ${assignmentId}`}: ${reason}`, actor.user, id);
        writeAudit(db, { entity: 'iam_sod_violations', entityId: id, action: 'remediate', newValues: { removed: roleCode ?? assignmentId, resolved: after.status === 'RESOLVED' }, reason, actor: actor.user });
        return service.violation(actor, id);
      });
    },

    violation(actor, id) {
      view(actor);
      const c = cid(actor);
      const v = db.prepare('SELECT v.*, r.code AS rule_code, r.name AS rule_name FROM iam_sod_violations v JOIN iam_sod_rules r ON r.id = v.rule_id WHERE v.id = ? AND v.company_id = ?').get(id, c);
      if (!v) throw notFound('That violation does not exist.');
      // what the person holds that causes it, so the page can offer the right roles to take away
      const holdings = v.user_id && v.source === 'ASSIGNMENT'
        ? authz.resolve({ companyId: c, userId: v.user_id, roles: JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(v.user_id).roles_json) }).holdings.filter((h) => h.via !== 'elevation')
        : [];
      return { id: v.id, ruleCode: v.rule_code, ruleName: v.rule_name, user: v.user_ref, userId: v.user_id, source: v.source, outcome: v.outcome, severity: v.severity, status: v.status, detail: JSON.parse(v.detail_json), detectedAt: v.detected_at, resolution: v.resolution, resolvedBy: v.resolved_by, holdings };
    },

    // ---- dormant accounts (FR-07) ----
    dormantPolicy(companyId) {
      const date = new Date(now() + 19_800_000).toISOString().slice(0, 10);
      return { days: Number(store.get('iam.dormant.days', { companyId, date })), action: String(store.get('iam.dormant.action', { companyId, date })) };
    },

    dormant(actor, query) {
      view(actor);
      const c = cid(actor);
      const policy = service.dormantPolicy(c);
      const q = likePattern(query.q);
      const all = dormantRows(c, policy).filter((u) => !query.q || u.username.toLowerCase().includes(query.q.toLowerCase()) || u.displayName.toLowerCase().includes(query.q.toLowerCase()));
      void q;
      all.sort((a, b) => (query.sort[0]?.dir === 'asc' ? a.days - b.days : b.days - a.days));
      return { ...pageResponse(all.slice(query.offset, query.offset + query.limit), all.length, query), policy };
    },

    /**
     * The daily job and the "scan now" button. With the policy set to suspend, people with no sign-in for the policy's days are suspended
     * and their sessions end; otherwise they are only reported. The last active system administrator is never suspended.
     */
    scanDormant(companyId, { by = 'system' } = {}) {
      const policy = service.dormantPolicy(companyId);
      const found = dormantRows(companyId, policy);
      const suspended = [];
      const skipped = [];
      if (policy.action === 'suspend') {
        for (const u of found) {
          try {
            transaction(db, () => {
              const holders = db.prepare("SELECT COUNT(*) AS n FROM iam_users x LEFT JOIN iam_user_profiles p ON p.user_id = x.id WHERE x.company_id = ? AND x.is_active = 1 AND x.id != ? AND COALESCE(p.lifecycle, 'ACTIVE') IN ('ONBOARDING', 'ACTIVE') AND EXISTS (SELECT 1 FROM json_each(x.roles_json) WHERE value = 'SYSADM')").get(companyId, u.id).n;
              if (u.roles.includes('SYSADM') && holders === 0) throw unprocessable('the only active system administrator');
              const reason = `Dormant: no sign-in for ${u.days} days (policy: suspend after ${policy.days})`;
              setLifecycle(db, u.id, 'SUSPENDED', { by, reason, at: new Date(now()) });
              const ended = auth.revokeSessions(u.id, { reason: 'suspended', by });
              writeAudit(db, { entity: 'iam_users', entityId: u.id, action: 'suspend_dormant', oldValues: { lifecycle: u.lifecycle }, newValues: { lifecycle: 'SUSPENDED', sessionsEnded: ended }, reason, actor: by });
              publishEvent(db, { type: 'iam.account.dormant_suspended', entity: 'user', entityId: u.id, actorId: by, companyId, data: { username: u.username, days: u.days } });
            });
            suspended.push(u.username);
          } catch (err) {
            skipped.push({ user: u.username, why: err.message });
          }
        }
      }
      return { policy, dormant: found.length, suspended, skipped };
    },
  };

  /** People whose last sign-in (or, if they never signed in, whose account) is older than the policy allows. Service accounts and ended accounts are left out. */
  function dormantRows(companyId, policy) {
    const cut = iso(now() - policy.days * 86_400_000);
    return db.prepare("SELECT u.id, u.username, u.display_name, u.roles_json, u.last_login_at, u.created_at, COALESCE(p.lifecycle, 'ACTIVE') AS lifecycle FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.company_id = ? AND u.is_active = 1 AND COALESCE(p.lifecycle, 'ACTIVE') IN ('ONBOARDING', 'ACTIVE') AND COALESCE(p.user_type, 'INTERNAL') != 'SERVICE_ACCOUNT' AND COALESCE(u.last_login_at, u.created_at) < ? ORDER BY u.username").all(companyId, cut)
      .map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, roles: JSON.parse(u.roles_json), lifecycle: u.lifecycle, lastLoginAt: u.last_login_at, neverSignedIn: !u.last_login_at, days: Math.floor((now() - Date.parse(u.last_login_at ?? u.created_at)) / 86_400_000) }));
  }
  return service;
}
