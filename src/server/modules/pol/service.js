import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { policyDrafts } from '../../platform/protocol/drafts.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createPathService } from '../eng/controls.js';
import { compareHtml, sanitizeHtml, textOf } from './richtext.js';

// Company policies (part 05.05): the register and the lifecycle of a policy (draft, in approval, published, active, under revision, superseded, archived), its versions (a published version is never edited: a revision
// is a new version through the approval again, BR-01), who it applies to, who has acknowledged it (with an optional knowledge check), reminders and escalation, and the requirements of a policy that become DRAFT
// control points, approval rules or alert rules for an administrator to review in the engine that owns them (BR-02).
export const POLICY_DOC = 'POL_VERSION';
const nowIso = () => new Date().toISOString();
const dayIST = (iso) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);
const ACK_REMINDER_DAYS = 3;
const MAX_REMINDERS = 5;
const REVIEW_WARN_DAYS = 30;
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 72, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
export const HEAD_ROLES = 'HRMGR|CFO|QCMGR|PROCMGR|ACCMGR|COMMGR|PCMGR|HSEE';

export function createPolicyService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const core = tasksOf(db);
  const paths = createPathService({ db, engine: workflowOf(db) });
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const nameOf = (companyId, u) => (u ? db.prepare('SELECT display_name FROM iam_users WHERE company_id = ? AND lower(username) = lower(?)').get(companyId, u)?.display_name ?? u : '');
  const parse = (j, d) => { try { return JSON.parse(j ?? ''); } catch { return d; } };

  // ---- who a policy applies to (FR-01, T-01) ----
  /** The people a policy applies to: everyone, or those in the listed departments, holding the listed roles, or assigned to the listed sites and projects (any of them). */
  function recipientsOf(companyId, a) {
    const users = db.prepare("SELECT id, username, roles_json FROM iam_users WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1").all(companyId);
    if (a.all) return users.map((u) => u.username);
    const hit = new Set();
    const byId = new Map(users.map((u) => [u.id, u]));
    const today = todayIST();
    const sitesOfProjects = a.projects?.length ? db.prepare(`SELECT id FROM org_sites WHERE company_id = ? AND org_project_id IN (${a.projects.map(() => '?').join(',')})`).all(companyId, ...a.projects).map((r) => r.id) : [];
    const projectsOfSites = a.sites?.length ? db.prepare(`SELECT DISTINCT org_project_id AS p FROM org_sites WHERE company_id = ? AND id IN (${a.sites.map(() => '?').join(',')})`).all(companyId, ...a.sites).map((r) => r.p) : [];
    for (const r of db.prepare("SELECT a.user_id, a.scope_type, a.scope_ids_json, ro.code FROM iam_assignments a JOIN iam_roles ro ON ro.id = a.role_id WHERE a.company_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND (a.effective_from IS NULL OR a.effective_from <= ?) AND (a.effective_to IS NULL OR a.effective_to >= ?)").all(companyId, today, today)) {
      if (!byId.has(r.user_id)) continue;
      const ids = parse(r.scope_ids_json, []).map(Number);
      if ((a.roles ?? []).includes(r.code)
        || (r.scope_type === 'PROJECT' && ids.some((i) => (a.projects ?? []).includes(i) || projectsOfSites.includes(i)))
        || (r.scope_type === 'SITE' && ids.some((i) => (a.sites ?? []).includes(i) || sitesOfProjects.includes(i)))
        || (r.scope_type === 'DEPARTMENT' && ids.some((i) => (a.departments ?? []).includes(i)))) hit.add(r.user_id);
    }
    for (const u of users) if ((a.roles ?? []).some((r) => parse(u.roles_json, []).includes(r))) hit.add(u.id);
    if (a.departments?.length && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'iam_user_profiles'").get()) {
      for (const r of db.prepare(`SELECT user_id FROM iam_user_profiles WHERE company_id = ? AND department_id IN (${a.departments.map(() => '?').join(',')})`).all(companyId, ...a.departments)) if (byId.has(r.user_id)) hit.add(r.user_id);
    }
    return users.filter((u) => hit.has(u.id)).map((u) => u.username);
  }
  const hasScope = (a) => Boolean(a.all || a.departments?.length || a.roles?.length || a.sites?.length || a.projects?.length);

  // ---- rows and views ----
  const policyRow = (pid, companyId) => db.prepare('SELECT * FROM pol_policies WHERE id = ? AND company_id = ? AND is_active = 1').get(pid, companyId);
  const versionRow = (vid, companyId) => db.prepare('SELECT * FROM pol_versions WHERE id = ? AND company_id = ? AND is_active = 1').get(vid, companyId);
  const versionsOf = (pid) => db.prepare('SELECT * FROM pol_versions WHERE policy_id = ? AND is_active = 1 ORDER BY version_no DESC').all(pid);
  const ackStats = (vid) => {
    const r = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN acknowledged_at IS NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue FROM pol_acknowledgements WHERE policy_version_id = ? AND is_active = 1").get(nowIso(), vid);
    return { recipients: r.total ?? 0, acknowledged: r.done ?? 0, overdue: r.overdue ?? 0, percent: r.total ? Math.round(((r.done ?? 0) * 100) / r.total) : 0 };
  };
  const fileInfo = (companyId, ids) => (ids.length ? db.prepare(`SELECT id, original_name AS name, size_bytes AS size, mime, scan_status FROM core_files WHERE id IN (${ids.map(() => '?').join(',')}) AND company_id = ? AND is_active = 1 AND deleted_at IS NULL`).all(...ids, companyId) : []);
  const versionView = (actor, v, { full = false, forReader = false } = {}) => {
    const quiz = parse(v.quiz_json, []);
    const out = { id: v.id, policyId: v.policy_id, version: v.version_no, status: v.version_status, effectiveFrom: v.effective_from, reviewDue: v.review_due, changeSummary: v.change_summary, passMark: v.pass_mark, ackDueDays: v.ack_due_days, hasQuiz: quiz.length > 0, questions: quiz.length, applicability: parse(v.applicability_json, {}),
      submittedBy: v.submitted_by, submittedAt: v.submitted_at, approvedAt: v.approved_at, publishedAt: v.published_at, supersededAt: v.superseded_at, createdAt: v.created_at, rowVersion: v.version, instanceId: v.instance_id, stats: ['PUBLISHED', 'ACTIVE', 'SUPERSEDED'].includes(v.version_status) ? ackStats(v.id) : null };
    if (full) { out.bodyHtml = v.body_html; out.attachments = fileInfo(actor.companyId, parse(v.attachments_json, [])); out.quiz = forReader ? quiz.map(({ q, options }) => ({ q, options })) : quiz; }
    return out;
  };
  const policyView = (actor, p) => {
    const cur = p.current_version_id ? versionRow(p.current_version_id, actor.companyId) : null;
    const reqs = db.prepare("SELECT COUNT(*) AS n FROM pol_requirements r JOIN pol_versions v ON v.id = r.policy_version_id WHERE v.policy_id = ? AND r.is_active = 1 AND r.req_status != 'DISMISSED'").get(p.id).n;
    const dueSoon = p.review_due && ['ACTIVE', 'UNDER_REVISION', 'PUBLISHED'].includes(p.policy_status) ? (p.review_due < todayIST() ? 'overdue' : Date.parse(p.review_due) - Date.parse(todayIST()) <= REVIEW_WARN_DAYS * 86_400_000 ? 'due' : null) : null;
    return { id: p.id, policyNo: p.policy_no, title: p.title, category: p.category, owner: { username: p.owner_ref, name: nameOf(actor.companyId, p.owner_ref) }, departmentId: p.department_id, department: p.department_id ? db.prepare('SELECT name FROM org_departments WHERE id = ?').get(p.department_id)?.name ?? null : null,
      status: p.policy_status, currentVersion: cur ? cur.version_no : null, currentVersionId: p.current_version_id, versionStatus: cur?.version_status ?? null, effectiveFrom: p.effective_from, reviewDue: p.review_due, reviewState: dueSoon, applicability: parse(p.applicability_json, {}),
      stats: cur && ['PUBLISHED', 'ACTIVE'].includes(cur.version_status) ? ackStats(cur.id) : null, requirements: reqs, rowVersion: p.version, createdAt: p.created_at, archivedAt: p.archived_at, archiveReason: p.archive_reason };
  };
  const isOwner = (actor, p) => p.owner_ref.toLowerCase() === actor.user.toLowerCase();
  const mayAuthor = (actor) => anywhere(actor, 'pol.policy.create');
  const seesRegister = (actor, p) => anywhere(actor, 'pol.policy.view_all') || isOwner(actor, p);
  const loadPolicy = (actor, pid, { need = 'view' } = {}) => {
    const p = policyRow(pid, actor.companyId);
    if (!p) throw notFound('That policy does not exist.');
    if (need === 'view' && !seesRegister(actor, p)) throw notFound('That policy does not exist, or you may not open it.');
    if (need === 'own' && !isOwner(actor, p)) throw (seesRegister(actor, p) ? forbidden('Only the owner of a policy can change it.') : notFound('That policy does not exist, or you may not open it.'));
    return p;
  };
  /** Brings the policy row in line with its versions: its status, the version that counts now, its dates and who it applies to. */
  function refresh(pid) {
    const p = db.prepare('SELECT * FROM pol_policies WHERE id = ?').get(pid);
    const vs = versionsOf(pid);
    const active = vs.find((v) => v.version_status === 'ACTIVE');
    const published = vs.find((v) => v.version_status === 'PUBLISHED');
    const working = vs.find((v) => ['DRAFT', 'IN_APPROVAL'].includes(v.version_status));
    const cur = active ?? published ?? working ?? vs[0] ?? null;
    let status = 'DRAFT';
    if (p.policy_status === 'ARCHIVED') status = 'ARCHIVED';
    else if ((active || published) && working) status = 'UNDER_REVISION';
    else if (active) status = 'ACTIVE';
    else if (published) status = 'PUBLISHED';
    db.prepare('UPDATE pol_policies SET policy_status = ?, current_version_id = ?, effective_from = ?, review_due = ?, applicability_json = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(status, cur?.id ?? null, cur?.effective_from ?? null, cur?.review_due ?? null, cur?.applicability_json ?? '{}', nowIso(), pid);
  }

  // ---- checking what is submitted ----
  function checkContent(v, { forSubmit = false } = {}) {
    const problems = [];
    const a = parse(v.applicability_json, {});
    const text = textOf(v.body_html);
    if (forSubmit) {
      if (text.length < 20) problems.push({ field: 'body', message: 'Write the policy (at least a few sentences).' });
      if (!v.effective_from) problems.push({ field: 'effectiveFrom', message: 'Give the date from which it applies.' });
      else if (v.effective_from < todayIST()) problems.push({ field: 'effectiveFrom', message: 'The effective date cannot be in the past.' });
      if (!v.review_due) problems.push({ field: 'reviewDue', message: 'Give the date by which it is reviewed again.' });
      else if (v.effective_from && v.review_due <= v.effective_from) problems.push({ field: 'reviewDue', message: 'The review date must be after the effective date.' });
      if (!hasScope(a)) problems.push({ field: 'applicability', message: 'Say who the policy applies to.' });
      else if (!recipientsOf(v.company_id, a).length) problems.push({ field: 'applicability', message: 'Nobody matches this applicability, so nobody would have to read the policy.' });
      if (v.version_no > 1 && !String(v.change_summary ?? '').trim()) problems.push({ field: 'changeSummary', message: 'Say what changed in this version: the approvers read it.' });
    }
    const quiz = parse(v.quiz_json, []);
    if (quiz.length && v.pass_mark < 1) problems.push({ field: 'passMark', message: 'Set a pass mark.' });
    return problems;
  }
  const attachmentsOk = (actor, versionId, ids) => {
    for (const id of ids) {
      const f = db.prepare("SELECT linked_entity, linked_id, scan_status FROM core_files WHERE id = ? AND company_id = ? AND is_active = 1 AND deleted_at IS NULL").get(id, actor.companyId);
      if (!f || f.linked_entity !== 'pol_version' || Number(f.linked_id) !== versionId) throw unprocessable('An attachment was not uploaded to this policy version.', [{ field: 'attachments', message: `file ${id} is not an attachment of this version` }]);
    }
  };

  // ---- the register and a policy ----
  const policies = {
    list(actor, f) {
      const all = anywhere(actor, 'pol.policy.view_all');
      if (!all && !mayAuthor(actor)) throw forbidden('You may not see the policy register (permission pol.policy.view_all).');
      const where = ['p.company_id = ?', 'p.is_active = 1']; const args = [actor.companyId];
      if (!all) { where.push('lower(p.owner_ref) = lower(?)'); args.push(actor.user); }
      if (f.category) { where.push('p.category = ?'); args.push(f.category); }
      if (f.status) { where.push('p.policy_status = ?'); args.push(f.status); }
      if (f.owner) { where.push('lower(p.owner_ref) = lower(?)'); args.push(f.owner); }
      if (f.q) { where.push('(p.title LIKE ? OR p.policy_no LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
      let rows = db.prepare(`SELECT p.* FROM pol_policies p WHERE ${where.join(' AND ')} ORDER BY p.policy_no`).all(...args).map((p) => policyView(actor, p));
      if (f.review) rows = rows.filter((r) => (f.review === 'overdue' ? r.reviewState === 'overdue' : Boolean(r.reviewState)));
      const counts = {}; for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length, counts, canCreate: mayAuthor(actor), canSeeAll: all };
    },
    create(actor, b) {
      if (!mayAuthor(actor)) throw forbidden('You may not write policies (permission pol.policy.create).');
      if (b.departmentId && !db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ?').get(b.departmentId, actor.companyId)) throw unprocessable('That department does not exist.', [{ field: 'departmentId', message: 'not a department of your company' }]);
      const dept = b.departmentId ?? (db.prepare("SELECT department_id FROM iam_user_profiles WHERE company_id = ? AND user_id = (SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?))").get(actor.companyId, actor.companyId, actor.user)?.department_id ?? null);
      return transaction(db, () => {
        const n = (db.prepare("SELECT COALESCE(MAX(CAST(substr(policy_no, 5) AS INTEGER)), 0) AS n FROM pol_policies WHERE company_id = ?").get(actor.companyId).n ?? 0) + 1;
        const no = `POL-${String(n).padStart(4, '0')}`;
        const pid = Number(db.prepare("INSERT INTO pol_policies (company_id, policy_no, title, category, owner_ref, department_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'pol_policy')").run(actor.companyId, no, b.title, b.category, actor.user, dept, actor.user).lastInsertRowid);
        const vid = Number(db.prepare("INSERT INTO pol_versions (company_id, policy_id, version_no, body_html, change_summary, quiz_json, pass_mark, applicability_json, effective_from, review_due, ack_due_days, created_by, source_type) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pol_version')")
          .run(actor.companyId, pid, sanitizeHtml(b.body), b.changeSummary, JSON.stringify(b.quiz), b.passMark, JSON.stringify(b.applicability), b.effectiveFrom ?? null, b.reviewDue ?? null, b.ackDueDays, actor.user).lastInsertRowid);
        attachmentsOk(actor, vid, b.attachments);
        db.prepare('UPDATE pol_versions SET attachments_json = ? WHERE id = ?').run(JSON.stringify(b.attachments), vid);
        refresh(pid);
        writeAudit(db, { entity: 'pol_policies', entityId: pid, action: 'create', newValues: { policyNo: no, title: b.title, category: b.category }, actor: actor.user, companyId: actor.companyId });
        return policies.get(actor, pid);
      });
    },
    get(actor, pid) {
      const p = loadPolicy(actor, pid);
      const vs = versionsOf(p.id);
      const working = vs.find((v) => ['DRAFT', 'IN_APPROVAL'].includes(v.version_status));
      const cur = p.current_version_id ? versionRow(p.current_version_id, actor.companyId) : null;
      const mine = isOwner(actor, p);
      return { ...policyView(actor, p), versions: vs.map((v) => versionView(actor, v)), current: cur ? versionView(actor, cur, { full: true }) : null, working: working ? versionView(actor, working, { full: true }) : null,
        can: { edit: mine && Boolean(working) && working.version_status === 'DRAFT', revise: mine && !working && ['ACTIVE', 'PUBLISHED'].includes(p.policy_status) || (mine && !working && vs[0]?.version_status === 'REJECTED'), archive: mine && !working && p.policy_status !== 'ARCHIVED', tag: mine && p.policy_status !== 'ARCHIVED', owner: mine } };
    },
    /** A draft version is edited here; a published one never is (BR-01). */
    updateVersion(actor, vid, b) {
      const v = versionRow(vid, actor.companyId);
      if (!v) throw notFound('That version does not exist.');
      const p = loadPolicy(actor, v.policy_id, { need: 'own' });
      if (v.version_status !== 'DRAFT') throw conflict(v.version_status === 'IN_APPROVAL' ? 'This version is in approval and cannot be edited. Ask an approver to return it for correction.' : 'A published policy cannot be edited. Start a new version.');
      if (v.version !== b.version) throw conflict('This draft was changed elsewhere. Reload it.');
      if (b.departmentId && !db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ?').get(b.departmentId, actor.companyId)) throw unprocessable('That department does not exist.', [{ field: 'departmentId', message: 'not a department of your company' }]);
      attachmentsOk(actor, v.id, b.attachments);
      return transaction(db, () => {
        db.prepare('UPDATE pol_versions SET body_html = ?, change_summary = ?, attachments_json = ?, quiz_json = ?, pass_mark = ?, applicability_json = ?, effective_from = ?, review_due = ?, ack_due_days = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(sanitizeHtml(b.body), b.changeSummary, JSON.stringify(b.attachments), JSON.stringify(b.quiz), b.passMark, JSON.stringify(b.applicability), b.effectiveFrom ?? null, b.reviewDue ?? null, b.ackDueDays, actor.user, nowIso(), v.id);
        db.prepare('UPDATE pol_policies SET title = ?, category = ?, department_id = ?, updated_by = ? WHERE id = ?').run(b.title ?? p.title, b.category ?? p.category, b.departmentId === undefined ? p.department_id : b.departmentId, actor.user, p.id);
        refresh(p.id);
        writeAudit(db, { entity: 'pol_versions', entityId: v.id, action: 'update', oldValues: { version: v.version_no }, newValues: { title: b.title ?? p.title }, actor: actor.user, companyId: actor.companyId });
        return policies.get(actor, p.id);
      });
    },
    /** A new draft version made from the one in force (or from the last one when it was rejected). */
    revise(actor, pid) {
      const p = loadPolicy(actor, pid, { need: 'own' });
      const vs = versionsOf(p.id);
      if (p.policy_status === 'ARCHIVED') throw conflict('An archived policy cannot be revised.');
      if (vs.some((v) => ['DRAFT', 'IN_APPROVAL'].includes(v.version_status))) throw conflict('There is already a version being written or approved. Finish or withdraw it first.');
      const base = vs.find((v) => v.version_status === 'ACTIVE') ?? vs.find((v) => v.version_status === 'PUBLISHED') ?? vs[0];
      return transaction(db, () => {
        const no = (vs[0]?.version_no ?? 0) + 1;
        const vid = Number(db.prepare("INSERT INTO pol_versions (company_id, policy_id, version_no, body_html, quiz_json, pass_mark, applicability_json, effective_from, review_due, ack_due_days, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'pol_version')")
          .run(actor.companyId, p.id, no, base.body_html, base.quiz_json, base.pass_mark, base.applicability_json, base.ack_due_days, actor.user).lastInsertRowid);
        db.prepare('UPDATE pol_versions SET attachments_json = ? WHERE id = ?').run('[]', vid);
        refresh(p.id);
        writeAudit(db, { entity: 'pol_versions', entityId: vid, action: 'revise', newValues: { policy: p.policy_no, version: no, from: base.version_no }, actor: actor.user, companyId: actor.companyId });
        return policies.get(actor, p.id);
      });
    },
    submit(actor, vid, /** @type {{ comment?: string }} */ { comment } = {}) {
      const v = versionRow(vid, actor.companyId);
      if (!v) throw notFound('That version does not exist.');
      const p = loadPolicy(actor, v.policy_id, { need: 'own' });
      if (v.version_status !== 'DRAFT') throw conflict('Only a draft can be sent for approval.');
      const problems = checkContent(v, { forSubmit: true });
      if (problems.length) throw unprocessable('The policy is not ready to be sent for approval.', problems);
      return transaction(db, () => {
        const engine = workflowOf(db);
        const instance = v.instance_id && db.prepare("SELECT status FROM wf_instances WHERE id = ?").get(v.instance_id)?.status === 'RETURNED' ? engine.resubmit(actor, v.instance_id, { comment }) : engine.submit(actor, { docType: POLICY_DOC, docId: v.id, comment: comment ?? v.change_summary ?? 'New policy', context: { category: p.category } });
        db.prepare("UPDATE pol_versions SET version_status = 'IN_APPROVAL', instance_id = ?, submitted_by = ?, submitted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(instance.id, actor.user, nowIso(), actor.user, nowIso(), v.id);
        refresh(p.id);
        writeAudit(db, { entity: 'pol_versions', entityId: v.id, action: 'submit', newValues: { policy: p.policy_no, version: v.version_no }, actor: actor.user, companyId: actor.companyId });
        return { id: v.id, status: 'IN_APPROVAL', workflow: instance };
      });
    },
    compare(actor, pid, { from, to }) {
      const p = loadPolicy(actor, pid);
      const a = versionRow(from, actor.companyId); const b = versionRow(to, actor.companyId);
      if (!a || !b || a.policy_id !== p.id || b.policy_id !== p.id) throw notFound('Those versions are not versions of this policy.');
      return { policyNo: p.policy_no, from: { id: a.id, version: a.version_no, status: a.version_status }, to: { id: b.id, version: b.version_no, status: b.version_status }, ...compareHtml(a.body_html, b.body_html),
        metadata: { applicabilityChanged: a.applicability_json !== b.applicability_json, passMarkChanged: a.pass_mark !== b.pass_mark, quizChanged: a.quiz_json !== b.quiz_json, effectiveFrom: [a.effective_from, b.effective_from], reviewDue: [a.review_due, b.review_due] } };
    },
    archive(actor, pid, { reason }) {
      const p = loadPolicy(actor, pid, { need: 'own' });
      if (p.policy_status === 'ARCHIVED') throw conflict('This policy is already archived.');
      if (versionsOf(p.id).some((v) => ['DRAFT', 'IN_APPROVAL'].includes(v.version_status))) throw conflict('Finish or withdraw the version being written first.');
      return transaction(db, () => {
        db.prepare("UPDATE pol_versions SET version_status = 'ARCHIVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE policy_id = ? AND version_status IN ('ACTIVE', 'PUBLISHED')").run(actor.user, nowIso(), p.id);
        db.prepare("UPDATE pol_policies SET policy_status = 'ARCHIVED', archived_at = ?, archive_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), reason, actor.user, nowIso(), p.id);
        writeAudit(db, { entity: 'pol_policies', entityId: p.id, action: 'archive', actor: actor.user, companyId: actor.companyId, reason });
        publishEvent(db, { type: 'pol.policy.archived', entity: 'pol_policy', entityId: p.id, actorId: actor.user, companyId: actor.companyId, data: { policyNo: p.policy_no } });
        return policies.get(actor, p.id);
      });
    },
    preview(actor, applicability) {
      if (!mayAuthor(actor) && !anywhere(actor, 'pol.policy.view_all')) throw forbidden('You may not write policies (permission pol.policy.create).');
      const users = recipientsOf(actor.companyId, applicability);
      return { recipients: users.length, sample: users.slice(0, 8).map((u) => ({ username: u, name: nameOf(actor.companyId, u) })) };
    },
    /** Who has acknowledged a version and who has not (the owner, and those who may see all policies). */
    ackReport(actor, pid, /** @type {{ versionId?: number, status?: string }} */ { versionId, status } = {}) {
      const p = loadPolicy(actor, pid);
      const v = versionId ? versionRow(versionId, actor.companyId) : (p.current_version_id ? versionRow(p.current_version_id, actor.companyId) : null);
      if (!v || v.policy_id !== p.id) throw notFound('That version does not exist.');
      const now = nowIso();
      let rows = db.prepare('SELECT * FROM pol_acknowledgements WHERE policy_version_id = ? AND is_active = 1 ORDER BY (acknowledged_at IS NULL) DESC, user_ref').all(v.id).map((a) => ({ username: a.user_ref, name: nameOf(actor.companyId, a.user_ref), dueAt: a.due_at, readAt: a.read_at, acknowledgedAt: a.acknowledged_at, quizScore: a.quiz_score, attempts: a.attempts, remindedAt: a.reminded_at, reminders: a.reminder_count, escalatedAt: a.escalated_at,
        status: a.acknowledged_at ? 'ACKNOWLEDGED' : a.due_at && a.due_at < now ? 'OVERDUE' : 'PENDING' }));
      if (status) rows = rows.filter((r) => r.status === status);
      return { policyNo: p.policy_no, title: p.title, version: v.version_no, versionId: v.id, stats: ackStats(v.id), rows };
    },
    ackRows(actor, pid, f) { return policies.ackReport(actor, pid, f).rows.map((r) => ({ person: r.name, user: r.username, status: r.status, due: r.dueAt ?? '', read: r.readAt ?? '', acknowledged: r.acknowledgedAt ?? '', quiz: r.quizScore ?? '', attempts: r.attempts, reminders: r.reminders, escalated: r.escalatedAt ?? '' })); },
  };

  // ---- publication: what an approved version does ----
  function notifyPublished(p, v, users, dueAt) {
    for (const u of users) notif.notify({ companyId: p.company_id, templateCode: 'pol.published', recipients: [`user:${u}`], data: { title: p.title, number: p.policy_no, version: v.version_no, action: parse(v.quiz_json, []).length ? ', answer the short quiz and acknowledge it' : ' and acknowledge it', due: dueAt ? ` by ${dayIST(dueAt)}` : '' }, link: '/collab/my-policies', sourceType: 'pol_version', sourceId: String(v.id), eventKey: `pol.published:${v.id}:${u}` });
  }
  function addRecipients(p, v, users) {
    const due = new Date(Date.parse(v.published_at ?? nowIso()) + v.ack_due_days * 86_400_000).toISOString();
    const fresh = [];
    for (const u of users) if (db.prepare("INSERT OR IGNORE INTO pol_acknowledgements (company_id, policy_version_id, user_ref, due_at, notified_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'system', 'pol_policy')").run(p.company_id, v.id, u, due, nowIso()).changes) fresh.push(u);
    return { fresh, due };
  }
  /** The version becomes the one in force: the one before it is superseded (kept, read-only). */
  function activate(vid) {
    const v = db.prepare('SELECT * FROM pol_versions WHERE id = ?').get(vid);
    const prev = db.prepare("SELECT * FROM pol_versions WHERE policy_id = ? AND id != ? AND version_status = 'ACTIVE'").all(v.policy_id, v.id);
    for (const o of prev) {
      db.prepare("UPDATE pol_versions SET version_status = 'SUPERSEDED', superseded_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), o.id);
      publishEvent(db, { type: 'pol.policy.superseded', entity: 'pol_policy', entityId: v.policy_id, actorId: 'system', companyId: v.company_id, data: { version: o.version_no, by: v.version_no } });
    }
    db.prepare("UPDATE pol_versions SET version_status = 'ACTIVE', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), v.id);
    refresh(v.policy_id);
  }
  const publication = {
    approved(instance, actor) {
      const v = db.prepare('SELECT * FROM pol_versions WHERE id = ?').get(Number(instance.docId));
      if (!v || v.version_status !== 'IN_APPROVAL') return;
      const p = db.prepare('SELECT * FROM pol_policies WHERE id = ?').get(v.policy_id);
      const now = nowIso();
      db.prepare("UPDATE pol_versions SET version_status = 'PUBLISHED', approved_at = ?, published_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, now, actor.user, now, v.id);
      const fresh = db.prepare('SELECT * FROM pol_versions WHERE id = ?').get(v.id);
      refresh(p.id);
      const users = recipientsOf(p.company_id, parse(v.applicability_json, {}));
      const { due } = addRecipients(p, fresh, users);
      notifyPublished(p, fresh, users, due);
      publishEvent(db, { type: 'pol.policy.published', entity: 'pol_policy', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { policyNo: p.policy_no, version: v.version_no, recipients: users.length, effectiveFrom: v.effective_from } });
      writeAudit(db, { entity: 'pol_versions', entityId: v.id, action: 'publish', newValues: { policy: p.policy_no, version: v.version_no, recipients: users.length }, actor: actor.user, companyId: p.company_id });
      if (v.effective_from && v.effective_from <= todayIST()) activate(v.id);
    },
    /** A rejection ends the version; a return gives it back to its owner to correct. */
    rejected(instance, actor, status) {
      const v = db.prepare('SELECT * FROM pol_versions WHERE id = ?').get(Number(instance.docId));
      if (!v || v.version_status !== 'IN_APPROVAL') return;
      db.prepare('UPDATE pol_versions SET version_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, nowIso(), v.id);
      refresh(v.policy_id);
      writeAudit(db, { entity: 'pol_versions', entityId: v.id, action: status === 'REJECTED' ? 'reject' : 'return', actor: actor.user, companyId: v.company_id });
    },
  };

  // ---- the employee side (FR-07, FR-03, FR-04) ----
  const ackRow = (companyId, vid, user) => db.prepare('SELECT * FROM pol_acknowledgements WHERE company_id = ? AND policy_version_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(companyId, vid, user);
  const mine = {
    list(actor) {
      const now = nowIso();
      const rows = db.prepare(`SELECT a.*, v.version_no, v.version_status, v.effective_from, v.pass_mark, v.quiz_json, v.policy_id, p.policy_no, p.title, p.category, p.policy_status FROM pol_acknowledgements a JOIN pol_versions v ON v.id = a.policy_version_id JOIN pol_policies p ON p.id = v.policy_id
        WHERE a.company_id = ? AND lower(a.user_ref) = lower(?) AND a.is_active = 1 AND p.is_active = 1 ORDER BY (a.acknowledged_at IS NULL) DESC, a.due_at`).all(actor.companyId, actor.user);
      const view = (r) => ({ policyId: r.policy_id, policyNo: r.policy_no, title: r.title, category: r.category, versionId: r.policy_version_id, version: r.version_no, versionStatus: r.version_status, effectiveFrom: r.effective_from, dueAt: r.due_at, readAt: r.read_at, acknowledgedAt: r.acknowledged_at, quizScore: r.quiz_score, attempts: r.attempts, hasQuiz: parse(r.quiz_json, []).length > 0, passMark: r.pass_mark,
        status: r.acknowledged_at ? 'ACKNOWLEDGED' : r.due_at && r.due_at < now ? 'OVERDUE' : 'TO_ACKNOWLEDGE' });
      const current = rows.filter((r) => ['PUBLISHED', 'ACTIVE'].includes(r.version_status)).map(view);
      const history = rows.filter((r) => ['SUPERSEDED', 'ARCHIVED'].includes(r.version_status)).map(view);
      return { rows: current, history, counts: { toAcknowledge: current.filter((r) => r.status !== 'ACKNOWLEDGED').length, overdue: current.filter((r) => r.status === 'OVERDUE').length, acknowledged: current.filter((r) => r.status === 'ACKNOWLEDGED').length } };
    },
    /** Opening a policy is reading it: the first time is recorded. A recipient reads the version that applies to them, a superseded one too (read-only). */
    read(actor, vid) {
      const v = versionRow(vid, actor.companyId);
      const a = v && ackRow(actor.companyId, v.id, actor.user);
      const p = v && policyRow(v.policy_id, actor.companyId);
      if (!v || !p || (!a && !seesRegister(actor, p))) throw notFound('That policy does not exist, or it does not apply to you.');
      if (a && !a.read_at) db.prepare('UPDATE pol_acknowledgements SET read_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, nowIso(), a.id);
      const reader = Boolean(a) && !isOwner(actor, p);
      const mineAck = a ? { dueAt: a.due_at, readAt: a.read_at ?? nowIso(), acknowledgedAt: a.acknowledged_at, quizScore: a.quiz_score, attempts: a.attempts } : null;
      return { policy: { id: p.id, policyNo: p.policy_no, title: p.title, category: p.category, owner: nameOf(actor.companyId, p.owner_ref), status: p.policy_status }, version: versionView(actor, v, { full: true, forReader: reader }), mine: mineAck,
        readOnly: !['PUBLISHED', 'ACTIVE'].includes(v.version_status), canAcknowledge: Boolean(a) && !a.acknowledged_at && ['PUBLISHED', 'ACTIVE'].includes(v.version_status) };
    },
    /** The acknowledgement, with the knowledge check when the policy has one: the pass mark must be reached; a failed try can be repeated. */
    acknowledge(actor, { versionId, answers }) {
      const v = versionRow(versionId, actor.companyId);
      const a = v && ackRow(actor.companyId, v.id, actor.user);
      if (!v || !a) throw notFound('That policy does not exist, or it does not apply to you.');
      if (!['PUBLISHED', 'ACTIVE'].includes(v.version_status)) throw conflict('This version is no longer the one in force, so it cannot be acknowledged.');
      if (a.acknowledged_at) return { ...mine.read(actor, v.id), passed: true, replay: true };
      const quiz = parse(v.quiz_json, []);
      if (quiz.length && answers.length !== quiz.length) throw unprocessable(`Answer all ${quiz.length} questions.`, [{ field: 'answers', message: `answer all ${quiz.length} questions` }]);
      const right = quiz.reduce((n, q, k) => n + (answers[k] === q.correct ? 1 : 0), 0);
      const percent = quiz.length ? Math.round((right * 100) / quiz.length) : null;
      const passed = quiz.length ? percent >= v.pass_mark : true;
      transaction(db, () => {
        db.prepare('UPDATE pol_acknowledgements SET read_at = COALESCE(read_at, ?), acknowledged_at = ?, quiz_score = ?, attempts = attempts + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), passed ? nowIso() : null, percent, actor.user, nowIso(), a.id);
        const p = db.prepare('SELECT policy_no FROM pol_policies WHERE id = ?').get(v.policy_id);
        writeAudit(db, { entity: 'pol_acknowledgements', entityId: a.id, action: passed ? 'acknowledge' : 'quiz_failed', newValues: { policy: p.policy_no, version: v.version_no, score: percent }, actor: actor.user, companyId: actor.companyId });
        if (passed) publishEvent(db, { type: 'pol.acknowledgement.recorded', entity: 'pol_acknowledgement', entityId: a.id, actorId: actor.user, companyId: actor.companyId, data: { policyNo: p.policy_no, version: v.version_no, user: actor.user, onTime: !a.due_at || nowIso() <= a.due_at, quizScore: percent } });
      });
      return { ...mine.read(actor, v.id), passed, score: percent, passMark: v.pass_mark, right, of: quiz.length };
    },
  };

  // ---- requirements and policy-to-protocol (FR-05) ----
  const reqView = (actor, r) => {
    const v = db.prepare('SELECT v.version_no, v.version_status, p.id AS pid, p.policy_no, p.title, p.owner_ref FROM pol_versions v JOIN pol_policies p ON p.id = v.policy_id WHERE v.id = ?').get(r.policy_version_id);
    const def = policyDrafts.get(r.proposed_artifact_type);
    const live = r.req_status === 'DRAFTED' && def ? def.status(db, actor.companyId, r.artifact_id) : null;
    const route = r.req_status === 'DRAFTED' && def ? (r.artifact_entity === 'pcs_control_points' ? `/admin/controls?code=${r.artifact_id}` : r.artifact_entity === 'wf_matrix' ? `/admin/approval-matrix/editor?id=${r.artifact_id}` : `/admin/alert-rules?code=${r.artifact_id}`) : null;
    return { id: r.id, versionId: r.policy_version_id, version: v?.version_no, versionStatus: v?.version_status, policyId: v?.pid, policyNo: v?.policy_no, policyTitle: v?.title, owner: { username: v?.owner_ref, name: nameOf(actor.companyId, v?.owner_ref) }, clauseRef: r.clause_ref, requirementText: r.requirement_text, artifactType: r.proposed_artifact_type, artifactLabel: def?.label ?? r.proposed_artifact_type,
      engine: def ? { part: def.part, permission: def.permission } : null, config: parse(r.proposed_config_json, {}), status: r.req_status, artifact: r.artifact_id ? { entity: r.artifact_entity, id: r.artifact_id, label: r.artifact_label, route, state: live?.state ?? null, stateLabel: live?.label ?? null } : null, convertedBy: r.converted_by, convertedAt: r.converted_at, dismissReason: r.dismiss_reason, createdAt: r.created_at, rowVersion: r.version };
  };
  const loadReq = (actor, rid, { own = false } = {}) => {
    const r = db.prepare('SELECT * FROM pol_requirements WHERE id = ? AND company_id = ? AND is_active = 1').get(rid, actor.companyId);
    const v = r && versionRow(r.policy_version_id, actor.companyId);
    const p = v && policyRow(v.policy_id, actor.companyId);
    if (!r || !p || (own ? !isOwner(actor, p) : !seesRegister(actor, p))) throw notFound('That requirement does not exist, or you may not open it.');
    return { r, v, p };
  };
  const mayManageReq = (actor) => anywhere(actor, 'pol.requirement.manage');
  const requirements = {
    list(actor, /** @type {{ versionId?: number, status?: string }} */ { versionId, status } = {}) {
      const where = ['r.company_id = ?', 'r.is_active = 1']; const args = [actor.companyId];
      if (versionId) { where.push('r.policy_version_id = ?'); args.push(versionId); }
      if (status) { where.push('r.req_status = ?'); args.push(status); }
      const rows = db.prepare(`SELECT r.* FROM pol_requirements r WHERE ${where.join(' AND ')} ORDER BY r.id`).all(...args).filter((r) => { const v = versionRow(r.policy_version_id, actor.companyId); const p = v && policyRow(v.policy_id, actor.companyId); return p && seesRegister(actor, p); }).map((r) => reqView(actor, r));
      return { rows, types: policyDrafts.list() };
    },
    create(actor, b) {
      const v = versionRow(b.versionId, actor.companyId);
      if (!v) throw notFound('That version does not exist.');
      const p = loadPolicy(actor, v.policy_id, { need: 'own' });
      if (!mayManageReq(actor)) throw forbidden('You may not tag requirements (permission pol.requirement.manage).');
      if (['REJECTED', 'ARCHIVED', 'SUPERSEDED'].includes(v.version_status)) throw conflict('Requirements are tagged on a version that is being written or is in force.');
      const def = policyDrafts.get(b.artifactType);
      if (!def) throw badRequest('That kind of draft is not known.');
      const problems = def.validate(b.config);
      if (problems.length) throw unprocessable(`The ${def.label.toLowerCase()} is not valid.`, problems.map((x) => ({ field: `config.${x.field}`, message: x.message })));
      const id = Number(db.prepare("INSERT INTO pol_requirements (company_id, policy_version_id, clause_ref, requirement_text, proposed_artifact_type, proposed_config_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'pol_requirement')").run(actor.companyId, v.id, b.clauseRef, b.requirementText, b.artifactType, JSON.stringify(b.config), actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'pol_requirements', entityId: id, action: 'create', newValues: { policy: p.policy_no, clause: b.clauseRef, type: b.artifactType }, actor: actor.user, companyId: actor.companyId });
      return reqView(actor, db.prepare('SELECT * FROM pol_requirements WHERE id = ?').get(id));
    },
    update(actor, rid, b) {
      const { r, p } = loadReq(actor, rid, { own: true });
      void p;
      if (r.req_status !== 'TAGGED') throw conflict('A requirement that was turned into a draft cannot be changed. Dismiss the draft and tag a new requirement.');
      const type = b.artifactType ?? r.proposed_artifact_type;
      const config = b.config ?? parse(r.proposed_config_json, {});
      const def = policyDrafts.get(type);
      const problems = def.validate(config);
      if (problems.length) throw unprocessable(`The ${def.label.toLowerCase()} is not valid.`, problems.map((x) => ({ field: `config.${x.field}`, message: x.message })));
      db.prepare('UPDATE pol_requirements SET clause_ref = ?, requirement_text = ?, proposed_artifact_type = ?, proposed_config_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.clauseRef ?? r.clause_ref, b.requirementText ?? r.requirement_text, type, JSON.stringify(config), actor.user, nowIso(), r.id);
      return reqView(actor, db.prepare('SELECT * FROM pol_requirements WHERE id = ?').get(r.id));
    },
    remove(actor, rid) {
      const { r } = loadReq(actor, rid, { own: true });
      if (r.req_status !== 'TAGGED') throw conflict('A requirement that was turned into a draft cannot be removed.');
      db.prepare('UPDATE pol_requirements SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ?').run(nowIso(), actor.user, r.id);
      writeAudit(db, { entity: 'pol_requirements', entityId: r.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: r.id, deleted: true };
    },
    /** T-02: only a requirement of an approved version is converted, and what it becomes is a draft in the engine that owns it: inactive until an administrator reviews and activates it there (BR-02). */
    convert(actor, rid) {
      const { r, v, p } = loadReq(actor, rid, { own: true });
      if (!mayManageReq(actor)) throw forbidden('You may not convert requirements (permission pol.requirement.manage).');
      if (r.req_status !== 'TAGGED') throw conflict(r.req_status === 'DRAFTED' ? 'This requirement already became a draft.' : 'This requirement was dismissed.');
      if (!['PUBLISHED', 'ACTIVE'].includes(v.version_status)) throw unprocessable('Only a requirement of an approved policy can be turned into a draft. Send the policy for approval first.');
      const def = policyDrafts.get(r.proposed_artifact_type);
      if (!def) throw badRequest('That kind of draft is not known.');
      return transaction(db, () => {
        const made = def.create(db, { companyId: actor.companyId, owner: actor.user, requirementId: r.id, policyNo: p.policy_no, clauseRef: r.clause_ref }, parse(r.proposed_config_json, {}));
        db.prepare("UPDATE pol_requirements SET req_status = 'DRAFTED', artifact_entity = ?, artifact_id = ?, artifact_label = ?, converted_by = ?, converted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(made.entity, String(made.id), made.label, actor.user, nowIso(), actor.user, nowIso(), r.id);
        writeAudit(db, { entity: 'pol_requirements', entityId: r.id, action: 'convert', newValues: { policy: p.policy_no, clause: r.clause_ref, type: r.proposed_artifact_type, artifact: `${made.entity}:${made.id}` }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'pol.requirement.converted', entity: 'pol_requirement', entityId: r.id, actorId: actor.user, companyId: actor.companyId, data: { policyNo: p.policy_no, type: r.proposed_artifact_type, artifact: `${made.entity}:${made.id}` } });
        publishEvent(db, { type: 'col.trace.requested', entity: 'pol_policy', entityId: p.id, actorId: actor.user, companyId: actor.companyId, data: { from: { entity: 'pol_policy', id: String(p.id) }, to: { entity: made.entity === 'pcs_control_points' ? 'pcs_control' : made.entity, id: String(made.id) }, relation: 'DERIVED' } });
        for (const u of core.holders(actor.companyId, ['SYSADM', 'ITADM'])) notif.notify({ companyId: actor.companyId, templateCode: 'pol.requirement.drafted', recipients: [`user:${u}`], data: { owner: nameOf(actor.companyId, actor.user), title: p.title, type: def.label.toLowerCase(), label: made.label }, link: '/admin/policy-drafts', sourceType: 'pol_requirement', sourceId: String(r.id), eventKey: `pol.requirement.drafted:${r.id}:${u}` });
        return reqView(actor, db.prepare('SELECT * FROM pol_requirements WHERE id = ?').get(r.id));
      });
    },
    /** The administrators' worklist: what the policies drafted, with the state it is in now in its own engine. Oldest first. */
    drafts(actor, /** @type {{ type?: string, state?: string, q?: string }} */ { type, state, q } = {}) {
      if (!anywhere(actor, 'pol.draft.view')) throw forbidden('You may not see the drafts made from policies (permission pol.draft.view).');
      let rows = db.prepare("SELECT * FROM pol_requirements WHERE company_id = ? AND req_status IN ('DRAFTED', 'DISMISSED') AND is_active = 1 ORDER BY converted_at, id").all(actor.companyId).map((r) => reqView(actor, r));
      if (type) rows = rows.filter((r) => r.artifactType === type);
      if (state) rows = rows.filter((r) => r.artifact?.state === state);
      if (q) { const n = q.toLowerCase(); rows = rows.filter((r) => `${r.policyNo} ${r.policyTitle} ${r.clauseRef} ${r.requirementText} ${r.artifact?.label ?? ''}`.toLowerCase().includes(n)); }
      rows = rows.map((r) => ({ ...r, ageDays: r.convertedAt ? Math.floor((Date.now() - Date.parse(r.convertedAt)) / 86_400_000) : null, canReview: r.engine ? anywhere(actor, r.engine.permission) : false }));
      const counts = {}; for (const r of rows) { const k = r.status === 'DISMISSED' ? 'DISMISSED' : r.artifact?.state ?? 'DRAFT'; counts[k] = (counts[k] ?? 0) + 1; }
      return { rows, counts, types: policyDrafts.list() };
    },
    dismiss(actor, rid, { reason }) {
      const r = db.prepare('SELECT * FROM pol_requirements WHERE id = ? AND company_id = ? AND is_active = 1').get(rid, actor.companyId);
      if (!r || r.req_status !== 'DRAFTED') throw notFound('That draft does not exist.');
      const def = policyDrafts.get(r.proposed_artifact_type);
      if (!anywhere(actor, 'pol.draft.view') || !(def && anywhere(actor, def.permission))) throw forbidden(`You may not review this draft (permission ${def?.permission ?? 'pol.draft.view'}).`);
      db.prepare("UPDATE pol_requirements SET req_status = 'DISMISSED', dismiss_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'pol_requirements', entityId: r.id, action: 'dismiss', actor: actor.user, companyId: actor.companyId, reason });
      return reqView(actor, db.prepare('SELECT * FROM pol_requirements WHERE id = ?').get(r.id));
    },
  };

  // ---- the minute job: effective dates, new people, reminders, escalation, review dates (FR-03, FR-06) ----
  function managersOf(companyId, users, exclude) {
    const out = new Set();
    for (const u of users) {
      let role = null; try { role = JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND lower(username) = lower(?)').get(companyId, u)?.roles_json ?? '[]')[0] ?? null; } catch { /* no role: the first level above the start of the path */ }
      const next = paths.next({ companyId, projectId: null, fromRole: role, level: 1 });
      if (next) for (const h of core.holders(companyId, [next.role])) if (![...exclude, ...users].some((e) => e.toLowerCase() === h.toLowerCase())) out.add(h);
    }
    return [...out];
  }
  function cycle(companyId) {
    const out = { activated: 0, added: 0, reminded: 0, escalated: 0, reviewNotices: 0 };
    const today = todayIST();
    for (const v of db.prepare("SELECT * FROM pol_versions WHERE company_id = ? AND version_status = 'PUBLISHED' AND effective_from <= ? AND is_active = 1").all(companyId, today)) { transaction(db, () => activate(v.id)); out.activated += 1; }
    // people who came into scope after publication
    for (const v of db.prepare("SELECT v.*, p.title, p.policy_no FROM pol_versions v JOIN pol_policies p ON p.id = v.policy_id WHERE v.company_id = ? AND v.version_status IN ('PUBLISHED', 'ACTIVE') AND p.policy_status != 'ARCHIVED' AND v.is_active = 1").all(companyId)) {
      const p = db.prepare('SELECT * FROM pol_policies WHERE id = ?').get(v.policy_id);
      const users = recipientsOf(companyId, parse(v.applicability_json, {}));
      const { fresh, due } = addRecipients(p, { ...v, published_at: nowIso() }, users);
      if (fresh.length) { notifyPublished(p, v, fresh, due); out.added += fresh.length; }
    }
    // reminders and escalation
    const now = nowIso();
    for (const a of db.prepare("SELECT a.*, v.policy_id, v.version_no, p.title, p.policy_no, p.owner_ref FROM pol_acknowledgements a JOIN pol_versions v ON v.id = a.policy_version_id JOIN pol_policies p ON p.id = v.policy_id WHERE a.company_id = ? AND a.acknowledged_at IS NULL AND a.is_active = 1 AND v.version_status IN ('PUBLISHED', 'ACTIVE')").all(companyId)) {
      const since = Date.parse(a.reminded_at ?? a.notified_at ?? a.created_at);
      if (a.reminder_count < MAX_REMINDERS && now >= new Date(since + ACK_REMINDER_DAYS * 86_400_000).toISOString()) {
        notif.notify({ companyId, templateCode: 'pol.ack.reminder', recipients: [`user:${a.user_ref}`], data: { title: a.title, number: a.policy_no, due: a.due_at ? dayIST(a.due_at) : 'soon' }, link: '/collab/my-policies', priority: a.due_at && a.due_at < now ? 'HIGH' : undefined, sourceType: 'pol_acknowledgement', sourceId: String(a.id), eventKey: `pol.ack.reminder:${a.id}:${a.reminder_count + 1}` });
        db.prepare('UPDATE pol_acknowledgements SET reminded_at = ?, reminder_count = reminder_count + 1, updated_at = ?, version = version + 1 WHERE id = ?').run(now, now, a.id);
        out.reminded += 1;
      }
    }
    const overdue = db.prepare("SELECT a.*, v.policy_id, p.title, p.policy_no, p.owner_ref FROM pol_acknowledgements a JOIN pol_versions v ON v.id = a.policy_version_id JOIN pol_policies p ON p.id = v.policy_id WHERE a.company_id = ? AND a.acknowledged_at IS NULL AND a.escalated_at IS NULL AND a.due_at < ? AND a.is_active = 1 AND v.version_status IN ('PUBLISHED', 'ACTIVE')").all(companyId, now);
    const byPolicy = new Map();
    for (const a of overdue) { const l = byPolicy.get(a.policy_version_id) ?? []; l.push(a); byPolicy.set(a.policy_version_id, l); }
    for (const list of byPolicy.values()) {
      const users = list.map((a) => a.user_ref);
      const managers = managersOf(companyId, users, [list[0].owner_ref]);
      transaction(db, () => {
        const names = users.slice(0, 10).map((u) => nameOf(companyId, u)).join(', ') + (users.length > 10 ? ` and ${users.length - 10} more` : '');
        for (const m of [...new Set([list[0].owner_ref, ...managers])]) notif.notify({ companyId, templateCode: 'pol.ack.overdue', recipients: [`user:${m}`], data: { title: list[0].title, number: list[0].policy_no, people: names }, link: `/collab/policies?id=${list[0].policy_id}`, priority: 'HIGH', sourceType: 'pol_policy', sourceId: String(list[0].policy_id), eventKey: `pol.ack.overdue:${list[0].policy_version_id}:${m}:${dayIST(now)}` });
        for (const a of list) db.prepare('UPDATE pol_acknowledgements SET escalated_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(now, now, a.id);
        publishEvent(db, { type: 'pol.acknowledgement.overdue', entity: 'pol_policy', entityId: list[0].policy_id, actorId: 'system', companyId, data: { policyNo: list[0].policy_no, people: users, managers } });
      });
      out.escalated += users.length;
    }
    // review dates
    for (const p of db.prepare("SELECT * FROM pol_policies WHERE company_id = ? AND policy_status IN ('ACTIVE', 'PUBLISHED') AND review_due IS NOT NULL AND is_active = 1").all(companyId)) {
      const left = Math.floor((Date.parse(p.review_due) - Date.parse(today)) / 86_400_000);
      const stage = left < 0 ? 'overdue' : left <= REVIEW_WARN_DAYS ? 'upcoming' : null;
      if (!stage) continue;
      const key = `pol.review.due:${p.id}:${p.review_due}:${stage}`;
      if (db.prepare('SELECT 1 FROM ntf_notifications WHERE event_key = ? AND company_id = ?').get(key, companyId)) continue;
      notif.notify({ companyId, templateCode: 'pol.review.due', recipients: [`user:${p.owner_ref}`], data: { title: p.title, number: p.policy_no, date: p.review_due }, link: `/collab/policies?id=${p.id}`, priority: stage === 'overdue' ? 'HIGH' : undefined, sourceType: 'pol_policy', sourceId: String(p.id), eventKey: key });
      out.reviewNotices += 1;
    }
    return out;
  }

  /** The files of a policy version belong to it: its owner adds them while it is a draft; whoever may read the policy downloads them. */
  try {
    fileEntities.register({
      entity: 'pol_version', label: 'Policy version',
      resolve(d, actor, id) {
        const v = d.prepare('SELECT * FROM pol_versions WHERE id = ? AND is_active = 1').get(Number(id));
        if (!v || v.company_id !== actor.companyId) return null;
        const p = d.prepare('SELECT * FROM pol_policies WHERE id = ?').get(v.policy_id);
        const owner = p.owner_ref.toLowerCase() === actor.user.toLowerCase();
        const reads = Boolean(d.prepare('SELECT 1 FROM pol_acknowledgements WHERE policy_version_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(v.id, actor.user));
        if (!owner && !reads && !authzOf(d).check(actor, 'pol.policy.view_all').allowed) return null;
        return { companyId: v.company_id, projectId: null, siteId: null, canView: true, canEdit: owner && v.version_status === 'DRAFT', locked: v.version_status !== 'DRAFT' };
      },
    });
  } catch { /* registered once per process */ }

  return { policies, mine, requirements, publication, cycle, recipientsOf };
}

const services = new WeakMap();
export const bindPolicies = (db, s) => services.set(db, s);
export const policiesOf = (db) => services.get(db);
const bound = (db) => services.get(db);
workflowTypes.register({
  docType: POLICY_DOC,
  label: 'Company policy version',
  processOwner: 'DIR',
  route: () => '/collab/policies',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT v.version_no, p.policy_no, p.title, v.created_by FROM pol_versions v JOIN pol_policies p ON p.id = v.policy_id WHERE v.id = ? AND v.company_id = ?').get(Number(id), companyId);
    return r ? { ref: `${r.policy_no} version ${r.version_no}`, title: r.title, originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const r = db.prepare('SELECT v.*, p.policy_no, p.title, p.category FROM pol_versions v JOIN pol_policies p ON p.id = v.policy_id WHERE v.id = ?').get(Number(id));
    if (!r) return null;
    const a = JSON.parse(r.applicability_json || '{}');
    return { fields: [{ label: 'Policy', value: `${r.policy_no} ${r.title}` }, { label: 'Category', value: r.category }, { label: 'Version', value: r.version_no }, { label: 'Effective from', value: r.effective_from }, { label: 'Review by', value: r.review_due }, { label: 'Applies to', value: a.all ? 'Everyone' : [a.departments?.length && `${a.departments.length} department(s)`, a.roles?.length && `roles ${a.roles.join(', ')}`, a.sites?.length && `${a.sites.length} site(s)`, a.projects?.length && `${a.projects.length} project(s)`].filter(Boolean).join('; ') }, { label: 'What changed', value: r.change_summary || 'First version' }] };
  },
  defaultDefinition: { name: 'Policy approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('HEAD', 'Department head', HEAD_ROLES), step('DIR', 'Director', 'DIR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.publication.approved(instance, actor),
    onRejected: (db, { instance, actor }) => bound(db)?.publication.rejected(instance, actor, 'REJECTED'),
    onReturned: (db, { instance, actor }) => bound(db)?.publication.rejected(instance, actor, 'DRAFT'),
    onCancelled: (db, { instance, actor }) => bound(db)?.publication.rejected(instance, actor, 'DRAFT'),
  },
});
evidenceProviders.register(POLICY_DOC, ({ db, instance }) => {
  const v = db.prepare('SELECT * FROM pol_versions WHERE id = ?').get(Number(instance.docId));
  if (!v) return { sections: [] };
  const prev = db.prepare('SELECT * FROM pol_versions WHERE policy_id = ? AND version_no < ? ORDER BY version_no DESC LIMIT 1').get(v.policy_id, v.version_no);
  const s = bound(db);
  const recipients = s ? s.recipientsOf(v.company_id, JSON.parse(v.applicability_json || '{}')).length : 0;
  const cmp = prev ? compareHtml(prev.body_html, v.body_html).summary : null;
  const reqs = db.prepare("SELECT COUNT(*) AS n FROM pol_requirements WHERE policy_version_id = ? AND is_active = 1 AND req_status != 'DISMISSED'").get(v.id).n;
  return { sections: [{ code: 'policy', title: 'What the approvers decide', kind: 'metrics', items: [{ label: 'People it applies to', value: recipients, format: 'number' }, { label: 'Paragraphs changed, added, removed', value: cmp ? `${cmp.changed}, ${cmp.added}, ${cmp.removed}` : 'First version', format: 'text' }, { label: 'Knowledge check', value: JSON.parse(v.quiz_json || '[]').length ? `${JSON.parse(v.quiz_json).length} questions, pass mark ${v.pass_mark}%` : 'None', format: 'text' }, { label: 'Requirements tagged for controls', value: reqs, format: 'number' }] }] };
});
