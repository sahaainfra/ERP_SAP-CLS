import { assertPermission, hasPermission } from '../../../platform/auth/index.js';
import { authzOf, isSensitiveKey } from '../../../platform/authz/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { badRequest, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { sodOf } from '../../../platform/sod/index.js';
import { setLifecycle } from '../usermgmt/service.js';

const iso = (ms) => new Date(ms).toISOString();
const istDate = (ms) => new Date(ms + 19_800_000).toISOString().slice(0, 10);

/** Access review campaigns (part 02.05): each reviewer certifies or revokes what the people in their care hold; closing applies the revokes. */
export function createReviewService({ db, identity }) {
  const authz = authzOf(db);
  const sod = sodOf(db);
  const cid = (actor) => companyScope(actor).params._company_scope;
  const now = () => identity.now();

  const campaignRow = (actor, id) => {
    const c = db.prepare('SELECT * FROM iam_access_campaigns WHERE id = ? AND company_id = ? AND is_active = 1').get(id, cid(actor));
    if (!c) throw notFound('That campaign does not exist.');
    return c;
  };
  const progress = (campaignId) => {
    const r = db.prepare("SELECT COUNT(*) AS total, SUM(i.decision = 'PENDING') AS pending, SUM(i.decision = 'CERTIFY') AS certified, SUM(i.decision = 'REVOKE') AS revoked, SUM(i.applied_at IS NOT NULL) AS applied FROM iam_access_review_items i JOIN iam_access_reviews v ON v.id = i.review_id WHERE v.campaign_id = ? AND v.status != 'CANCELLED'").get(campaignId);
    return { total: r.total, pending: r.pending ?? 0, certified: r.certified ?? 0, revoked: r.revoked ?? 0, applied: r.applied ?? 0 };
  };
  const present = (c) => ({ id: c.id, code: c.campaign_code, name: c.name, scope: c.scope, departmentId: c.department_id, dueDate: c.due_date, status: c.status, closedAt: c.closed_at, closedBy: c.closed_by, summary: JSON.parse(c.summary_json), createdBy: c.created_by, createdAt: c.created_at, overdue: c.status === 'OPEN' && c.due_date < istDate(now()), ...progress(c.id) });
  const itemView = (i) => ({ id: i.id, reviewId: i.review_id, campaignId: i.campaign_id, campaignCode: i.campaign_code, user: i.username, displayName: i.display_name, userId: i.user_id, source: i.source, assignmentId: i.assignment_id, roleCode: i.role_code, roleName: i.role_name, scope: i.scope_text, privileged: Boolean(i.privileged), lastLoginAt: i.last_login_at, decision: i.decision, comment: i.comment, decidedAt: i.decided_at, decidedBy: i.decided_by, appliedAt: i.applied_at, appliedNote: i.applied_note, reviewer: i.reviewer, dueDate: i.due_date });
  const ITEM_FROM = 'FROM iam_access_review_items i JOIN iam_access_reviews v ON v.id = i.review_id JOIN iam_access_campaigns c ON c.id = v.campaign_id JOIN iam_users u ON u.id = i.user_id JOIN iam_users rv ON rv.id = v.reviewer_id';
  const ITEM_COLS = 'i.*, v.campaign_id, v.campaign_code, v.due_date, u.username, u.display_name, rv.username AS reviewer';

  const privilegedRole = (companyId, code, mfaRoles) => {
    if (mfaRoles.includes(code)) return true;
    const role = db.prepare('SELECT id FROM iam_roles WHERE code = ? AND (company_id IS NULL OR company_id = ?) AND is_active = 1').get(code, companyId);
    if (!role) return false;
    return db.prepare("SELECT perm_key FROM iam_role_permissions WHERE role_id = ? AND effect = 'allow' AND is_active = 1").all(role.id).some((p) => isSensitiveKey(p.perm_key));
  };
  const fallbackReviewer = (companyId, exceptId) =>
    db.prepare("SELECT u.id FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.company_id = ? AND u.is_active = 1 AND u.id != ? AND COALESCE(p.lifecycle, 'ACTIVE') = 'ACTIVE' AND (EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = 'DIR') OR EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = 'SUPADM')) ORDER BY u.id LIMIT 1").get(companyId, exceptId)?.id ?? null;

  const service = {
    campaigns(actor, query) {
      assertPermission(actor, 'iam.review.view');
      const c = cid(actor);
      const where = ['company_id = :c', 'is_active = 1', "(campaign_code LIKE :q ESCAPE '\\' OR name LIKE :q ESCAPE '\\')"];
      const params = { c, q: likePattern(query.q) };
      if (query.filters.status) { where.push('status = :status'); params.status = query.filters.status; }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM iam_access_campaigns WHERE ${w}`).get(params).n;
      const order = orderBySql(query.sort, { code: 'campaign_code', dueDate: 'due_date' }, 'id DESC');
      const rows = db.prepare(`SELECT * FROM iam_access_campaigns WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((r) => ({ ...present(r), canManage: hasPermission(actor, 'iam.review.manage') })), total, query);
    },

    campaign(actor, id) {
      assertPermission(actor, 'iam.review.view');
      const c = campaignRow(actor, id);
      const reviews = db.prepare("SELECT v.id, v.status, v.due_date, rv.username, rv.display_name, (SELECT COUNT(*) FROM iam_access_review_items i WHERE i.review_id = v.id) AS total, (SELECT COUNT(*) FROM iam_access_review_items i WHERE i.review_id = v.id AND i.decision = 'PENDING') AS pending, (SELECT COUNT(*) FROM iam_access_review_items i WHERE i.review_id = v.id AND i.decision = 'REVOKE') AS revoked FROM iam_access_reviews v JOIN iam_users rv ON rv.id = v.reviewer_id WHERE v.campaign_id = ? AND v.status != 'CANCELLED' ORDER BY rv.username").all(id)
        .map((v) => ({ id: v.id, reviewer: v.username, reviewerName: v.display_name, status: v.status, total: v.total, pending: v.pending, revoked: v.revoked }));
      return { ...present(c), reviews, canManage: hasPermission(actor, 'iam.review.manage') };
    },

    /** Start a campaign: one line for every role every person in scope holds, handed to the person who answers for them. */
    create(actor, input) {
      assertPermission(actor, 'iam.review.manage');
      const c = cid(actor);
      if (input.dueDate <= istDate(now())) throw badRequest('Some fields are invalid.', [{ field: 'dueDate', message: 'The due date must be after today.' }]);
      if (input.scope === 'DEPARTMENT' && !db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ? AND is_active = 1').get(input.departmentId, c)) throw badRequest('Some fields are invalid.', [{ field: 'departmentId', message: 'That department does not exist in this company.' }]);
      if (db.prepare("SELECT 1 FROM iam_access_campaigns WHERE company_id = ? AND status = 'OPEN' AND scope = ? AND COALESCE(department_id, 0) = ? AND is_active = 1").get(c, input.scope, input.departmentId ?? 0)) throw unprocessable('A campaign of this kind is already open. Close or cancel it before starting another.');
      const mfaRoles = identity.policies.for(c).mfa.requiredRoles;
      return transaction(db, () => {
        const d = new Date(now() + 19_800_000);
        const prefix = `AR-${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
        const n = db.prepare('SELECT COUNT(*) AS n FROM iam_access_campaigns WHERE company_id = ? AND campaign_code LIKE ?').get(c, `${prefix}-%`).n + 1;
        const code = `${prefix}-${String(n).padStart(2, '0')}`;
        const res = db.prepare("INSERT INTO iam_access_campaigns (company_id, campaign_code, name, scope, department_id, due_date, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, 'access_campaign')").run(c, code, input.name, input.scope, input.scope === 'DEPARTMENT' ? input.departmentId : null, input.dueDate, actor.user);
        const campaignId = Number(res.lastInsertRowid);
        const people = db.prepare("SELECT u.id, u.username, u.roles_json, u.last_login_at, p.department_id, d.head_user_id FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id LEFT JOIN org_departments d ON d.id = p.department_id WHERE u.company_id = ? AND u.is_active = 1 AND COALESCE(p.lifecycle, 'ACTIVE') IN ('ONBOARDING', 'ACTIVE') AND COALESCE(p.user_type, 'INTERNAL') != 'SERVICE_ACCOUNT' ORDER BY u.username").all(c);
        const reviews = new Map();
        let lines = 0;
        let unassigned = 0;
        const reviewFor = (reviewerId) => {
          if (!reviews.has(reviewerId)) reviews.set(reviewerId, Number(db.prepare("INSERT INTO iam_access_reviews (company_id, campaign_id, campaign_code, scope, reviewer_id, status, due_date, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, 'access_review')").run(c, campaignId, code, input.scope, reviewerId, input.dueDate, actor.user).lastInsertRowid));
          return reviews.get(reviewerId);
        };
        const add = (reviewId, u, item) => {
          db.prepare('INSERT INTO iam_access_review_items (company_id, review_id, assignment_id, user_id, source, role_code, role_name, scope_text, privileged, last_login_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(c, reviewId, item.assignmentId ?? null, u.id, item.source, item.roleCode, item.roleName, item.scopeText, item.privileged ? 1 : 0, u.last_login_at, actor.user, 'access_review_item');
          lines += 1;
        };
        for (const u of people) {
          if (input.scope === 'DEPARTMENT' && u.department_id !== input.departmentId) continue;
          const items = [];
          for (const code2 of JSON.parse(u.roles_json)) {
            const role = db.prepare('SELECT name FROM iam_roles WHERE code = ? AND (company_id IS NULL OR company_id = ?) AND is_active = 1').get(code2, c);
            items.push({ source: 'ROLE_LIST', roleCode: code2, roleName: role?.name ?? code2, scopeText: 'Whole company', privileged: privilegedRole(c, code2, mfaRoles) });
          }
          for (const a of db.prepare("SELECT a.id, a.scope_type, a.scope_ids_json, a.effective_to, r.code, r.name FROM iam_assignments a JOIN iam_roles r ON r.id = a.role_id WHERE a.user_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND (a.effective_to IS NULL OR a.effective_to >= ?)").all(u.id, istDate(now()))) {
            const ids = JSON.parse(a.scope_ids_json);
            items.push({ source: 'ASSIGNMENT', assignmentId: a.id, roleCode: a.code, roleName: a.name, scopeText: a.scope_type === 'COMPANY' ? 'Whole company' : a.scope_type === 'OWN' ? 'Own records' : `${a.scope_type.toLowerCase()} ${ids.length ? ids.length + ' chosen' : ''}`.trim(), privileged: privilegedRole(c, a.code, mfaRoles) });
          }
          const chosen = input.scope === 'PRIVILEGED' ? items.filter((x) => x.privileged) : items;
          if (!chosen.length) continue;
          // a person never reviews their own access: it goes to the department head, else to the director or the auditor
          const reviewerId = u.head_user_id && u.head_user_id !== u.id ? u.head_user_id : fallbackReviewer(c, u.id);
          if (!reviewerId) { unassigned += chosen.length; continue; }
          const reviewId = reviewFor(reviewerId);
          for (const item of chosen) add(reviewId, u, item);
        }
        if (lines === 0) throw unprocessable('There is nothing to review in this scope: nobody holds a role that matches.');
        writeAudit(db, { entity: 'iam_access_campaigns', entityId: campaignId, action: 'start', newValues: { code, scope: input.scope, lines, reviewers: reviews.size, unassigned }, actor: actor.user });
        publishEvent(db, { type: 'iam.review.started', entity: 'access_campaign', entityId: campaignId, actorId: actor.user, companyId: c, data: { code, scope: input.scope, lines, reviewers: reviews.size } });
        return { ...service.campaign(actor, campaignId), unassigned };
      });
    },

    items(actor, campaignId, query) {
      const c = campaignRow(actor, campaignId);
      const all = hasPermission(actor, 'iam.review.view');
      if (!all) assertPermission(actor, 'iam.review.decide');
      return listItems(actor, { campaignId: c.id, all, query });
    },

    /** The lines waiting for the signed-in reviewer (all open campaigns). */
    mine(actor, query) {
      assertPermission(actor, 'iam.review.decide');
      return { ...listItems(actor, { campaignId: null, all: false, query }), campaigns: db.prepare("SELECT DISTINCT c.campaign_code AS code, c.name, c.due_date FROM iam_access_reviews v JOIN iam_access_campaigns c ON c.id = v.campaign_id WHERE v.reviewer_id = ? AND v.status != 'CANCELLED' AND c.status = 'OPEN' ORDER BY c.due_date").all(actor.userId ?? 0).map((x) => ({ ...x })) };
    },

    /** Certify or revoke lines (one or many). The reviewer must be the one the line was handed to, and never reviews their own access. */
    decide(actor, { ids, decision, comment }) {
      assertPermission(actor, 'iam.review.decide');
      return transaction(db, () => {
        const touched = new Set();
        for (const id of ids) {
          const i = db.prepare(`SELECT ${ITEM_COLS}, c.status AS campaign_status, v.reviewer_id, v.status AS review_status ${ITEM_FROM} WHERE i.id = ? AND i.company_id = ? AND i.is_active = 1`).get(id, cid(actor));
          if (!i) throw notFound(`Line ${id} does not exist.`);
          if (i.reviewer_id !== actor.userId) throw forbidden('That line was handed to another reviewer. Only the assigned reviewer, or someone the campaign was reassigned to, can decide it.');
          if (i.user_id === actor.userId) throw unprocessable('You cannot decide your own access.');
          if (i.campaign_status !== 'OPEN' || i.review_status !== 'OPEN') throw unprocessable(`The campaign ${i.campaign_code} is no longer open, so the line cannot be changed.`);
          if (i.applied_at) throw unprocessable('That decision has already been applied.');
          db.prepare('UPDATE iam_access_review_items SET decision = ?, comment = ?, decided_at = ?, decided_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(decision, comment ?? null, iso(now()), actor.user, actor.user, iso(now()), id);
          touched.add(i.review_id);
        }
        for (const reviewId of touched) {
          const left = db.prepare("SELECT COUNT(*) AS n FROM iam_access_review_items WHERE review_id = ? AND decision = 'PENDING'").get(reviewId).n;
          db.prepare("UPDATE iam_access_reviews SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(left === 0 ? 'COMPLETED' : 'OPEN', actor.user, iso(now()), reviewId);
        }
        writeAudit(db, { entity: 'iam_access_review_items', entityId: ids.join(','), action: decision.toLowerCase(), newValues: { count: ids.length }, reason: comment ?? null, actor: actor.user });
        return { decided: ids.length, decision, reviewsCompleted: [...touched].filter((r) => db.prepare('SELECT status FROM iam_access_reviews WHERE id = ?').get(r).status === 'COMPLETED').length };
      });
    },

    /** Hand a reviewer's lines to somebody else (the reviewer is away or left). */
    reassign(actor, campaignId, { reviewId, reviewerId, reason }) {
      assertPermission(actor, 'iam.review.manage');
      const camp = campaignRow(actor, campaignId);
      if (camp.status !== 'OPEN') throw unprocessable('Only an open campaign can be reassigned.');
      const review = db.prepare("SELECT * FROM iam_access_reviews WHERE id = ? AND campaign_id = ? AND status != 'CANCELLED'").get(reviewId, campaignId);
      if (!review) throw notFound('That review does not exist in this campaign.');
      const target = db.prepare("SELECT u.id, u.username FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.company_id = ? AND u.is_active = 1 AND COALESCE(p.lifecycle, 'ACTIVE') = 'ACTIVE'").get(reviewerId, camp.company_id);
      if (!target) throw badRequest('Some fields are invalid.', [{ field: 'reviewerId', message: 'Choose an active person in this company.' }]);
      if (db.prepare('SELECT 1 FROM iam_access_review_items WHERE review_id = ? AND user_id = ?').get(reviewId, reviewerId)) throw unprocessable(`${target.username} holds some of the access in this review and cannot review it. Choose someone else.`);
      return transaction(db, () => {
        const existing = db.prepare('SELECT id FROM iam_access_reviews WHERE campaign_id = ? AND reviewer_id = ?').get(campaignId, reviewerId);
        if (existing && existing.id !== reviewId) {
          db.prepare('UPDATE iam_access_review_items SET review_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE review_id = ?').run(existing.id, actor.user, iso(now()), reviewId);
          db.prepare("UPDATE iam_access_reviews SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(now()), reviewId);
          db.prepare("UPDATE iam_access_reviews SET status = 'OPEN', version = version + 1 WHERE id = ?").run(existing.id);
        } else {
          db.prepare('UPDATE iam_access_reviews SET reviewer_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(reviewerId, actor.user, iso(now()), reviewId);
        }
        writeAudit(db, { entity: 'iam_access_reviews', entityId: reviewId, action: 'reassign', newValues: { reviewer: target.username }, reason, actor: actor.user });
        return service.campaign(actor, campaignId);
      });
    },

    /** Close the campaign. It cannot close while any line is undecided; the revokes are then applied, and the people affected are checked again for conflicts. */
    close(actor, campaignId) {
      assertPermission(actor, 'iam.review.manage');
      const camp = campaignRow(actor, campaignId);
      if (camp.status !== 'OPEN') throw unprocessable(`The campaign is ${camp.status.toLowerCase()}.`);
      const p = progress(campaignId);
      if (p.pending > 0) {
        const who = db.prepare("SELECT rv.username, COUNT(*) AS n FROM iam_access_review_items i JOIN iam_access_reviews v ON v.id = i.review_id JOIN iam_users rv ON rv.id = v.reviewer_id WHERE v.campaign_id = ? AND v.status != 'CANCELLED' AND i.decision = 'PENDING' GROUP BY rv.username ORDER BY rv.username").all(campaignId);
        throw unprocessable(`The campaign cannot close yet: ${p.pending} line(s) are undecided (${who.map((w) => `${w.username} ${w.n}`).join(', ')}). Ask the reviewers to finish, or reassign their lines.`, who.map((w) => ({ field: 'reviewer', message: `${w.username} has ${w.n} undecided` })));
      }
      return transaction(db, () => {
        const revokes = db.prepare("SELECT i.*, u.username, u.roles_json FROM iam_access_review_items i JOIN iam_access_reviews v ON v.id = i.review_id JOIN iam_users u ON u.id = i.user_id WHERE v.campaign_id = ? AND v.status != 'CANCELLED' AND i.decision = 'REVOKE' AND i.applied_at IS NULL ORDER BY i.id").all(campaignId);
        const affected = new Set();
        let applied = 0;
        let kept = 0;
        for (const i of revokes) {
          let note;
          if (i.source === 'ASSIGNMENT') {
            const a = db.prepare("SELECT status FROM iam_assignments WHERE id = ?").get(i.assignment_id);
            if (!a || a.status !== 'ACTIVE') note = 'Already ended.';
            else {
              db.prepare("UPDATE iam_assignments SET status = 'ENDED', ended_at = ?, ended_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(now()), actor.user, actor.user, iso(now()), i.assignment_id);
              db.prepare("INSERT INTO iam_role_grants (company_id, user_id, role_code, action, reason, granted_by, created_by, source_type) VALUES (?, ?, ?, 'REVOKED', ?, ?, ?, 'role_grant')").run(camp.company_id, i.user_id, i.role_code, `Access review ${camp.campaign_code}: ${i.comment}`, actor.user, actor.user);
              note = 'Assignment ended.';
            }
          } else {
            const held = JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(i.user_id).roles_json);
            if (!held.includes(i.role_code)) note = 'Already taken away.';
            else if (i.role_code === 'SYSADM' && db.prepare("SELECT COUNT(*) AS n FROM iam_users x LEFT JOIN iam_user_profiles p ON p.user_id = x.id WHERE x.company_id = ? AND x.is_active = 1 AND x.id != ? AND COALESCE(p.lifecycle, 'ACTIVE') IN ('ONBOARDING', 'ACTIVE') AND EXISTS (SELECT 1 FROM json_each(x.roles_json) WHERE value = 'SYSADM')").get(camp.company_id, i.user_id).n === 0) {
              note = 'Kept: this is the only active system administrator.';
              kept += 1;
            } else {
              db.prepare('UPDATE iam_users SET roles_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(held.filter((r) => r !== i.role_code)), actor.user, iso(now()), i.user_id);
              db.prepare("INSERT INTO iam_role_grants (company_id, user_id, role_code, action, reason, granted_by, created_by, source_type) VALUES (?, ?, ?, 'REVOKED', ?, ?, ?, 'role_grant')").run(camp.company_id, i.user_id, i.role_code, `Access review ${camp.campaign_code}: ${i.comment}`, actor.user, actor.user);
              note = 'Role taken away.';
            }
          }
          if (!note.startsWith('Kept')) applied += 1;
          db.prepare('UPDATE iam_access_review_items SET applied_at = ?, applied_note = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(iso(now()), note, actor.user, i.id);
          affected.add(i.user_id);
        }
        authz.invalidate();
        // a person left with nothing goes back to onboarding; everyone affected is checked again for conflicts
        for (const userId of affected) {
          const u = db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(userId);
          const lifecycle = db.prepare('SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?').get(userId)?.lifecycle;
          if (lifecycle === 'ACTIVE' && authz.resolve({ companyId: camp.company_id, userId, roles: JSON.parse(u.roles_json) }).assignmentCount === 0) setLifecycle(db, userId, 'ONBOARDING', { by: actor.user, reason: `Access review ${camp.campaign_code} took the last role away`, at: new Date(now()) });
          sod.scanUser(camp.company_id, userId);
        }
        const summary = { ...progress(campaignId), applied, kept, users: affected.size };
        db.prepare("UPDATE iam_access_campaigns SET status = 'CLOSED', closed_at = ?, closed_by = ?, summary_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(now()), actor.user, JSON.stringify(summary), actor.user, iso(now()), campaignId);
        writeAudit(db, { entity: 'iam_access_campaigns', entityId: campaignId, action: 'close', newValues: summary, actor: actor.user });
        publishEvent(db, { type: 'iam.review.closed', entity: 'access_campaign', entityId: campaignId, actorId: actor.user, companyId: camp.company_id, data: { code: camp.campaign_code, certified: summary.certified, revoked: summary.revoked, applied } });
        return service.campaign(actor, campaignId);
      });
    },

    cancel(actor, campaignId, reason) {
      assertPermission(actor, 'iam.review.manage');
      const camp = campaignRow(actor, campaignId);
      if (camp.status !== 'OPEN') throw unprocessable(`The campaign is ${camp.status.toLowerCase()}.`);
      return transaction(db, () => {
        db.prepare("UPDATE iam_access_campaigns SET status = 'CANCELLED', closed_at = ?, closed_by = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(now()), actor.user, reason ?? null, actor.user, iso(now()), campaignId);
        db.prepare("UPDATE iam_access_reviews SET status = 'CANCELLED', version = version + 1 WHERE campaign_id = ? AND status = 'OPEN'").run(campaignId);
        writeAudit(db, { entity: 'iam_access_campaigns', entityId: campaignId, action: 'cancel', reason: reason ?? null, actor: actor.user });
        return service.campaign(actor, campaignId);
      });
    },
  };

  function listItems(actor, { campaignId, all, query }) {
    const where = ['i.company_id = :c', 'i.is_active = 1', "v.status != 'CANCELLED'", "(u.username LIKE :q ESCAPE '\\' OR u.display_name LIKE :q ESCAPE '\\' OR i.role_code LIKE :q ESCAPE '\\')"];
    const params = { c: cid(actor), q: likePattern(query.q) };
    if (campaignId) { where.push('v.campaign_id = :camp'); params.camp = campaignId; } else where.push("c.status = 'OPEN'");
    if (!all) { where.push('v.reviewer_id = :me'); params.me = actor.userId ?? 0; }
    if (query.filters.decision) { where.push('i.decision = :decision'); params.decision = query.filters.decision; }
    if (query.filters.reviewId) { where.push('i.review_id = :review'); params.review = Number(query.filters.reviewId); }
    if (query.filters.privileged) { where.push('i.privileged = :priv'); params.priv = query.filters.privileged === 'true' ? 1 : 0; }
    const w = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n ${ITEM_FROM} WHERE ${w}`).get(params).n;
    const order = orderBySql(query.sort, { user: 'u.username', role: 'i.role_code' }, 'i.id');
    const rows = db.prepare(`SELECT ${ITEM_COLS} ${ITEM_FROM} WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
    return pageResponse(rows.map(itemView), total, query);
  }
  return service;
}
