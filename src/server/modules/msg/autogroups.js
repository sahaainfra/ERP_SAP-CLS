import { z } from 'zod';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { badRequest, conflict, forbidden } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { parse } from '../../platform/validation/index.js';
import { todayIST } from '../../../shared/dates.js';

// Auto groups (part 05.04, FR-01): the groups of the Messages app that are kept from the organisation and the assignments. Project, site and department groups exist for every active project, site and department;
// team and discipline groups come from rules (a title, the roles that belong, and where). When an assignment is given or ends, the group follows within a minute (the event runs a sync at once, a job every minute
// catches the rest) and the group says so in a system message. People added by hand stay; only members the rules made are added and removed. The rules change only by an approved change (maker-checker).
export const AUTOGROUP_DOC = 'MSG_AUTOGROUPS';
const nowIso = () => new Date().toISOString();
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
export const DEFAULT_RULES = Object.freeze([
  { groupType: 'PROJECT', scopeType: 'COMPANY', scopeId: null, roleFilter: [], title: '', enabled: true },
  { groupType: 'SITE', scopeType: 'COMPANY', scopeId: null, roleFilter: [], title: '', enabled: true },
  { groupType: 'DEPARTMENT', scopeType: 'COMPANY', scopeId: null, roleFilter: [], title: '', enabled: true },
]);
const role = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'A role code such as PM');
const rule = z.object({
  groupType: z.enum(['PROJECT', 'SITE', 'DEPARTMENT', 'TEAM', 'DISCIPLINE']), scopeType: z.enum(['COMPANY', 'PROJECT', 'SITE', 'DEPARTMENT']).default('COMPANY'), scopeId: z.number().int().min(1).nullable().default(null),
  roleFilter: z.array(role).max(20).default([]), title: z.string().trim().max(80).default(''), enabled: z.boolean().default(true),
}).strict().superRefine((r, ctx) => {
  if (r.scopeType !== 'COMPANY' && !r.scopeId) ctx.addIssue({ code: 'custom', path: ['scopeId'], message: 'Say which project, site or department' });
  if (['TEAM', 'DISCIPLINE'].includes(r.groupType)) {
    if (!r.title) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Give the group a name' });
    if (!r.roleFilter.length) ctx.addIssue({ code: 'custom', path: ['roleFilter'], message: 'Name at least one role that belongs to it' });
  } else if (r.scopeType !== 'COMPANY' && r.scopeType !== r.groupType) ctx.addIssue({ code: 'custom', path: ['scopeType'], message: `A ${r.groupType.toLowerCase()} group is for one ${r.groupType.toLowerCase()} or for all of them` });
});
export const parseRules = (b) => parse(z.object({ rules: z.array(rule).min(1, 'Keep at least one rule').max(40), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500) }).strict(), b);

export function createAutoGroupService({ db, engine, base }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const x = base.internals;
  const rowView = (r) => ({ id: r.id, version: r.rule_version, groupType: r.group_type, scopeType: r.scope_type, scopeId: r.scope_id, roleFilter: JSON.parse(r.role_filter_json || '[]'), title: r.title, enabled: Boolean(r.enabled), status: r.rule_status, reason: r.reason, by: r.created_by, at: r.created_at, instanceId: r.instance_id });

  function ensureDefaults(companyId) {
    if (db.prepare("SELECT 1 FROM msg_auto_group_rules WHERE company_id = ? AND rule_status IN ('ACTIVE', 'PENDING')").get(companyId)) return;
    const v = (db.prepare('SELECT MAX(rule_version) AS v FROM msg_auto_group_rules WHERE company_id = ?').get(companyId).v ?? 0) + 1;
    for (const r of DEFAULT_RULES) db.prepare("INSERT INTO msg_auto_group_rules (company_id, rule_version, group_type, scope_type, scope_id, role_filter_json, title, enabled, rule_status, reason, created_by, source_type) VALUES (?, ?, ?, 'COMPANY', NULL, '[]', '', 1, 'ACTIVE', 'The standard groups of the Messages app', 'system', 'default_rule')").run(companyId, v, r.groupType);
  }
  const activeRules = (companyId) => { ensureDefaults(companyId); return db.prepare("SELECT * FROM msg_auto_group_rules WHERE company_id = ? AND rule_status = 'ACTIVE' AND is_active = 1 ORDER BY id").all(companyId); };

  const projects = (companyId, id) => db.prepare(`SELECT id, code, name FROM org_projects WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1 ${id ? 'AND id = ' + Number(id) : ''} ORDER BY id`).all(companyId);
  const sites = (companyId, id) => db.prepare(`SELECT id, code, name, org_project_id AS project_id FROM org_sites WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1 ${id ? 'AND id = ' + Number(id) : ''} ORDER BY id`).all(companyId);
  const departments = (companyId, id) => db.prepare(`SELECT id, code, name FROM org_departments WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1 ${id ? 'AND id = ' + Number(id) : ''} ORDER BY id`).all(companyId);

  /** Who a role filter picks out inside a scope: people with an active assignment of one of the roles that covers the scope. */
  function holdersIn(companyId, roles, scope) {
    const today = todayIST();
    const out = [];
    const rows = db.prepare("SELECT u.username, a.scope_type, a.scope_ids_json FROM iam_assignments a JOIN iam_users u ON u.id = a.user_id JOIN iam_roles r ON r.id = a.role_id WHERE a.company_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND u.is_active = 1 AND u.status = 'ACTIVE' AND (a.effective_from IS NULL OR a.effective_from <= ?) AND (a.effective_to IS NULL OR a.effective_to >= ?)" + ` AND r.code IN (${roles.map(() => '?').join(',')})`).all(companyId, today, today, ...roles);
    for (const a of rows) {
      const ids = JSON.parse(a.scope_ids_json || '[]').map(Number);
      const hit = scope.type === 'COMPANY' || (scope.type === 'PROJECT' && ((a.scope_type === 'PROJECT' && ids.includes(scope.id)) || a.scope_type === 'COMPANY'))
        || (scope.type === 'SITE' && ((a.scope_type === 'SITE' && ids.includes(scope.id)) || (a.scope_type === 'PROJECT' && ids.includes(scope.projectId)))) || (scope.type === 'DEPARTMENT' && a.scope_type === 'DEPARTMENT' && ids.includes(scope.id));
      if (hit && !out.includes(a.username)) out.push(a.username);
    }
    return out;
  }

  /** The conversation of a place: an existing one (made by hand in 05.01) is adopted, otherwise it is made. */
  function ensurePlace(companyId, type, place) {
    const col = { PROJECT: 'project_id', SITE: 'site_id', DEPARTMENT: 'department_id' }[type];
    const q = { PROJECT: place.id, SITE: place.id, DEPARTMENT: place.id };
    const ex = db.prepare(`SELECT * FROM msg_conversations WHERE company_id = ? AND conv_type = ? AND ${col} = ? AND is_active = 1`).get(companyId, type, q[type]);
    if (ex) return { conv: ex, created: false };
    const id = Number(db.prepare("INSERT INTO msg_conversations (company_id, conv_type, title, department_id, auto_membership, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, 1, ?, ?, 'system', 'msg_autogroup')")
      .run(companyId, type, `${place.code ?? ''} ${place.name}`.trim(), type === 'DEPARTMENT' ? place.id : null, type === 'PROJECT' ? place.id : type === 'SITE' ? place.project_id : null, type === 'SITE' ? place.id : null).lastInsertRowid);
    writeAudit(db, { entity: 'msg_conversations', entityId: id, action: 'create', newValues: { type, auto: true }, actor: 'system', companyId });
    return { conv: db.prepare('SELECT * FROM msg_conversations WHERE id = ?').get(id), created: true };
  }
  /** A team or discipline group: found through the link of its rule, made when missing. */
  function ensureLinked(companyId, ruleRow, key, title, scope) {
    const link = db.prepare('SELECT * FROM msg_auto_group_links WHERE rule_id = ? AND scope_key = ? AND is_active = 1').get(ruleRow.id, key);
    if (link) { const c = db.prepare('SELECT * FROM msg_conversations WHERE id = ? AND is_active = 1').get(link.conversation_id); if (c) return { conv: c, created: false }; }
    const id = Number(db.prepare("INSERT INTO msg_conversations (company_id, conv_type, title, auto_membership, project_id, site_id, department_id, created_by, source_type) VALUES (?, 'TEAM', ?, 0, ?, ?, ?, 'system', 'msg_autogroup')").run(companyId, title.slice(0, 120), scope.projectId ?? null, scope.siteId ?? null, scope.departmentId ?? null).lastInsertRowid);
    db.prepare("INSERT INTO msg_auto_group_links (company_id, rule_id, scope_key, conversation_id, created_by, source_type) VALUES (?, ?, ?, ?, 'system', 'msg_autogroup')").run(companyId, ruleRow.id, key, id);
    writeAudit(db, { entity: 'msg_conversations', entityId: id, action: 'create', newValues: { type: 'TEAM', auto: true, rule: ruleRow.id }, actor: 'system', companyId });
    return { conv: db.prepare('SELECT * FROM msg_conversations WHERE id = ?').get(id), created: true };
  }

  /** Brings the automatic members of one group to the wanted list; says so in the group. Returns { added, removed }. */
  function reconcile(conv, wanted, why) {
    const want = new Set(wanted.map((u) => u.toLowerCase()));
    const current = db.prepare('SELECT * FROM msg_members WHERE conversation_id = ? AND is_active = 1').all(conv.id);
    const added = []; const removed = [];
    transaction(db, () => {
      for (const u of wanted) {
        const m = current.find((r) => r.user_ref.toLowerCase() === u.toLowerCase());
        if (!m) { db.prepare("INSERT INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, 'MEMBER', 'AUTO', 'system', 'msg_autogroup')").run(conv.company_id, conv.id, u); added.push(u); }
        else if (m.left_at && m.member_source === 'AUTO') { db.prepare('UPDATE msg_members SET left_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), m.id); added.push(u); }
      }
      for (const m of current) if (!m.left_at && m.member_source === 'AUTO' && !want.has(m.user_ref.toLowerCase())) { db.prepare('UPDATE msg_members SET left_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), m.id); removed.push(m.user_ref); }
      const nm = (list) => list.map((u) => x.nameOf(conv.company_id, u)).join(', ');
      if (added.length) x.systemMessage(conv, { user: 'system' }, `${nm(added)} joined: ${why.added}`);
      if (removed.length) x.systemMessage(conv, { user: 'system' }, `${nm(removed)} left: ${why.removed}`);
      if (added.length || removed.length) writeAudit(db, { entity: 'msg_conversations', entityId: conv.id, action: 'autogroup_sync', newValues: { added, removed }, actor: 'system', companyId: conv.company_id });
    });
    for (const u of added) notif.notify({ companyId: conv.company_id, templateCode: 'msg.autogroup.joined', recipients: [`user:${u}`], data: { conversation: conv.title }, link: `/collab/messages?c=${conv.id}`, sourceType: 'msg_conversation', sourceId: String(conv.id), eventKey: `msg.autogroup.joined:${conv.id}:${u}:${nowIso().slice(0, 16)}` });
    if (added.length || removed.length) x.touchUsers(conv.company_id, conv.id, 'members');
    return { added, removed };
  }

  /** One pass over the rules of a company. Safe to run as often as wanted. */
  function sync(companyId) {
    const out = { groups: 0, created: 0, added: 0, removed: 0 };
    for (const r of activeRules(companyId)) {
      if (!r.enabled) continue;
      const roles = JSON.parse(r.role_filter_json || '[]');
      const pick = (conv, wanted, why) => { out.groups += 1; const d = reconcile(conv, wanted, why); out.added += d.added.length; out.removed += d.removed.length; };
      if (['PROJECT', 'SITE', 'DEPARTMENT'].includes(r.group_type)) {
        const places = r.group_type === 'PROJECT' ? projects(companyId, r.scope_id) : r.group_type === 'SITE' ? sites(companyId, r.scope_id) : departments(companyId, r.scope_id);
        for (const p of places) {
          const e = ensurePlace(companyId, r.group_type, p);
          if (e.created) out.created += 1;
          if (!e.conv.auto_membership || e.conv.is_archived) continue;
          pick(e.conv, x.autoMembersOf({ ...e.conv, company_id: companyId }), { added: `assigned to the ${r.group_type.toLowerCase()}`, removed: `the assignment to the ${r.group_type.toLowerCase()} ended` });
        }
      } else {
        const targets = [];
        const ofScope = r.scope_type === 'COMPANY' ? null : { type: r.scope_type, id: r.scope_id };
        if (r.group_type === 'TEAM') {
          if (!ofScope) targets.push({ key: 'company', title: r.title, scope: { type: 'COMPANY' }, place: {} });
          else if (ofScope.type === 'PROJECT') for (const p of projects(companyId, ofScope.id)) targets.push({ key: `project:${p.id}`, title: `${p.code} · ${r.title}`, scope: { type: 'PROJECT', id: p.id }, place: { projectId: p.id } });
          else if (ofScope.type === 'SITE') for (const s of sites(companyId, ofScope.id)) targets.push({ key: `site:${s.id}`, title: `${s.code} · ${r.title}`, scope: { type: 'SITE', id: s.id, projectId: s.project_id }, place: { siteId: s.id, projectId: s.project_id } });
          else for (const d of departments(companyId, ofScope.id)) targets.push({ key: `department:${d.id}`, title: `${d.code} · ${r.title}`, scope: { type: 'DEPARTMENT', id: d.id }, place: { departmentId: d.id } });
        } else { // DISCIPLINE: one group in every project it covers
          const projs = !ofScope ? projects(companyId) : ofScope.type === 'PROJECT' ? projects(companyId, ofScope.id) : ofScope.type === 'SITE' ? projects(companyId, sites(companyId, ofScope.id)[0]?.project_id ?? 0) : [];
          for (const p of projs) targets.push({ key: `project:${p.id}`, title: `${p.code} · ${r.title}`, scope: { type: 'PROJECT', id: p.id }, place: { projectId: p.id } });
        }
        for (const t of targets) {
          const e = ensureLinked(companyId, r, t.key, t.title, t.place);
          if (e.created) out.created += 1;
          if (e.conv.is_archived) continue;
          pick(e.conv, holdersIn(companyId, roles, t.scope), { added: `holds ${roles.join(' or ')} in this group's scope`, removed: 'no longer holds a role of this group in its scope' });
        }
      }
    }
    return out;
  }

  // ---- the rules and their approved changes ----
  const rules = {
    get(actor) {
      if (!authz.check(actor, 'msg.autogroup.view').allowed) throw forbidden('You may not see the auto group rules (permission msg.autogroup.view).');
      const active = activeRules(actor.companyId).map(rowView);
      const pending = db.prepare("SELECT * FROM msg_auto_group_rules WHERE company_id = ? AND rule_status = 'PENDING' AND is_active = 1 ORDER BY id").all(actor.companyId).map(rowView);
      const history = db.prepare('SELECT rule_version AS version, rule_status AS status, MIN(created_at) AS at, MIN(created_by) AS by, MIN(reason) AS reason, COUNT(*) AS rules FROM msg_auto_group_rules WHERE company_id = ? AND is_active = 1 GROUP BY rule_version, rule_status ORDER BY rule_version DESC LIMIT 30').all(actor.companyId);
      const groups = db.prepare('SELECT c.id, c.title, c.conv_type AS type, (SELECT COUNT(*) FROM msg_members m WHERE m.conversation_id = c.id AND m.left_at IS NULL AND m.is_active = 1) AS members FROM msg_conversations c WHERE c.company_id = ? AND c.is_active = 1 AND c.source_type = ? ORDER BY c.title LIMIT 200').all(actor.companyId, 'msg_autogroup');
      return { rules: active, pending, history, groups, canEdit: authz.check(actor, 'msg.autogroup.edit', { companyId: actor.companyId }).allowed, version: active[0]?.version ?? 0 };
    },
    propose(actor, b) {
      if (!authz.check(actor, 'msg.autogroup.edit', { companyId: actor.companyId }).allowed) throw forbidden('You may not change the auto group rules (permission msg.autogroup.edit).');
      ensureDefaults(actor.companyId);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM msg_auto_group_rules WHERE company_id = ? AND rule_status = 'PENDING' AND is_active = 1").get(actor.companyId)) throw conflict('A change of the auto group rules is already waiting for approval.');
        for (const r of b.rules) {
          if (r.scopeType === 'PROJECT' && !projects(actor.companyId, r.scopeId).length) throw badRequest('A rule names a project that is not active.', [{ field: 'scopeId', message: 'not an active project' }]);
          if (r.scopeType === 'SITE' && !sites(actor.companyId, r.scopeId).length) throw badRequest('A rule names a site that is not active.', [{ field: 'scopeId', message: 'not an active site' }]);
          if (r.scopeType === 'DEPARTMENT' && !departments(actor.companyId, r.scopeId).length) throw badRequest('A rule names a department that is not active.', [{ field: 'scopeId', message: 'not an active department' }]);
        }
        const v = (db.prepare('SELECT MAX(rule_version) AS v FROM msg_auto_group_rules WHERE company_id = ?').get(actor.companyId).v ?? 0) + 1;
        for (const r of b.rules) db.prepare("INSERT INTO msg_auto_group_rules (company_id, rule_version, group_type, scope_type, scope_id, role_filter_json, title, enabled, rule_status, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 'msg_rule')").run(actor.companyId, v, r.groupType, r.scopeType, r.scopeId, JSON.stringify(r.roleFilter), r.title, r.enabled ? 1 : 0, b.reason, actor.user);
        writeAudit(db, { entity: 'msg_auto_group_rules', entityId: v, action: 'propose', oldValues: activeRules(actor.companyId).map(rowView), newValues: b.rules, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine.submit(actor, { docType: AUTOGROUP_DOC, docId: v, comment: b.reason, context: {} });
        db.prepare("UPDATE msg_auto_group_rules SET instance_id = ? WHERE company_id = ? AND rule_version = ? AND rule_status = 'PENDING'").run(instance.id, actor.companyId, v);
        return { version: v, workflow: instance };
      });
    },
    activate(instance, actor) {
      const row = db.prepare("SELECT company_id FROM msg_auto_group_rules WHERE rule_version = ? AND instance_id = ? LIMIT 1").get(Number(instance.docId), instance.id);
      if (!row) return;
      const now = nowIso();
      db.prepare("UPDATE msg_auto_group_rules SET rule_status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND rule_status = 'ACTIVE'").run(actor.user, now, row.company_id);
      db.prepare("UPDATE msg_auto_group_rules SET rule_status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND rule_version = ? AND rule_status = 'PENDING'").run(actor.user, now, row.company_id, Number(instance.docId));
      writeAudit(db, { entity: 'msg_auto_group_rules', entityId: Number(instance.docId), action: 'approve', actor: actor.user, companyId: row.company_id });
      sync(row.company_id);
    },
    reject(instance, actor) { db.prepare("UPDATE msg_auto_group_rules SET rule_status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE rule_version = ? AND instance_id = ? AND rule_status = 'PENDING'").run(actor.user, nowIso(), Number(instance.docId), instance.id); },
  };
  return { rules, sync, activeRules, reconcile, holdersIn, ensureDefaults };
}

const services = new WeakMap();
export const bindAutoGroups = (db, s) => services.set(db, s);
export const autoGroupsOf = (db) => services.get(db);
workflowTypes.register({
  docType: AUTOGROUP_DOC,
  label: 'Auto group rules change',
  processOwner: 'SYSADM',
  route: () => '/admin/auto-groups',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM msg_auto_group_rules WHERE company_id = ? AND rule_version = ? LIMIT 1').get(companyId, Number(id));
    return r ? { ref: `Auto group rules version ${r.rule_version}`, title: 'Change of the groups that follow assignments', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const rows = db.prepare('SELECT * FROM msg_auto_group_rules WHERE company_id = ? AND rule_version = ? ORDER BY id').all(actor.companyId, Number(id));
    if (!rows.length) return null;
    return { fields: [{ label: 'Reason', value: rows[0].reason ?? '' }, { label: 'Rules', value: rows.length }, ...rows.map((r) => ({ label: `${r.group_type}${r.title ? ` · ${r.title}` : ''}`, value: `${r.scope_type === 'COMPANY' ? 'whole company' : `${r.scope_type.toLowerCase()} ${r.scope_id}`}${JSON.parse(r.role_filter_json || '[]').length ? `; roles ${JSON.parse(r.role_filter_json).join(', ')}` : ''}${r.enabled ? '' : '; off'}` }))] };
  },
  defaultDefinition: { name: 'Auto group rules approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CHECK', 'IT administrator or director', 'ITADM|DIR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => autoGroupsOf(db)?.rules.activate(instance, actor),
    onRejected: (db, { instance, actor }) => autoGroupsOf(db)?.rules.reject(instance, actor),
    onReturned: (db, { instance, actor }) => autoGroupsOf(db)?.rules.reject(instance, actor),
    onCancelled: (db, { instance, actor }) => autoGroupsOf(db)?.rules.reject(instance, actor),
  },
});
evidenceProviders.register(AUTOGROUP_DOC, ({ db, instance }) => {
  const rows = db.prepare('SELECT * FROM msg_auto_group_rules WHERE rule_version = ? AND instance_id = ? ORDER BY id').all(Number(instance.docId), instance.id);
  if (!rows.length) return { sections: [] };
  return { sections: [{ code: 'rules', title: 'Rules in this change', kind: 'metrics', items: rows.map((r) => ({ label: `${r.group_type}${r.title ? ` · ${r.title}` : ''}`, value: `${r.scope_type === 'COMPANY' ? 'whole company' : `${r.scope_type.toLowerCase()} ${r.scope_id}`}`, format: 'text' })) }] };
});
