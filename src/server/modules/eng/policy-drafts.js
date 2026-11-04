import { z } from 'zod';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { checkRule, OPS } from '../../platform/alerts/index.js';
import { ROLE_CODES } from '../../platform/auth/index.js';
import { policyDrafts } from '../../platform/protocol/drafts.js';
import { parse } from '../../platform/validation/index.js';
import { parseControlCreate } from './validators.js';

// How a requirement of a company policy (part 05.05) becomes a DRAFT in the three engines of this module. Every draft is inactive by construction: a control point is made OFF, an approval matrix is made as a DRAFT
// version, an alert rule is made switched off. The administrator reviews and activates it on the engine's own screen and through its own approval; nothing here switches anything on (BR-02).
const services = new WeakMap();
/** The matrix and alert services of a database (they need the workflow engine and so are made when the module mounts). */
export const bindDraftServices = (db, s) => services.set(db, s);
const system = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] }); // the system drafting on behalf of the policy owner: the draft is OFF, and the owner is recorded as its source
const problemsOf = (fn) => { try { fn(); return []; } catch (e) { if (e instanceof HttpError) return (e.details ?? [{ field: 'config', message: e.message }]); throw e; } };

// ---- a control point (04.04) ----
policyDrafts.register({
  type: 'CONTROL_POINT', label: 'Control point', part: '04.04', permission: 'eng.pcs.manage',
  validate: (config) => problemsOf(() => parseControlCreate(config)),
  create(db, ctx, config) {
    const b = parseControlCreate(config);
    if (db.prepare('SELECT 1 FROM pcs_control_points WHERE company_id = ? AND code = ?').get(ctx.companyId, b.code)) throw conflict(`The control point ${b.code} already exists. Choose another code.`);
    const id = Number(db.prepare(`INSERT INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, thresholds_json, evidence_required, escalation_level, mode, owner_role, emergency_allowed, created_by, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFF', ?, ?, ?, 'pol_requirement', ?)`)
      .run(ctx.companyId, b.code, b.module, b.stage, b.description, `expr:${JSON.stringify(b.rule)}`, b.enforcement, JSON.stringify(b.thresholds ?? {}), b.evidenceRequired ? 1 : 0, b.escalationLevel ?? 1, b.ownerRole, b.emergencyAllowed ? 1 : 0, ctx.owner, String(ctx.requirementId)).lastInsertRowid);
    writeAudit(db, { entity: 'pcs_control_points', entityId: id, action: 'create', newValues: { code: b.code, mode: 'OFF', from: `policy ${ctx.policyNo} clause ${ctx.clauseRef}` }, actor: ctx.owner, companyId: ctx.companyId });
    publishEvent(db, { type: 'pcs.control.created', entity: 'pcs_control', entityId: id, actorId: ctx.owner, companyId: ctx.companyId, data: { control: b.code } });
    return { entity: 'pcs_control_points', id: b.code, label: b.code, route: `/admin/controls?code=${b.code}` };
  },
  status(db, companyId, code) {
    const c = db.prepare('SELECT mode, pending_change_id FROM pcs_control_points WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL').get(companyId, code);
    if (!c) return { state: 'GONE', label: 'No longer exists' };
    if (c.pending_change_id) return { state: 'PENDING', label: `Waiting for approval (now ${c.mode})` };
    return c.mode === 'OFF' ? { state: 'DRAFT', label: 'Draft: the control is OFF' } : { state: 'ACTIVE', label: `In ${c.mode}` };
  },
});

// ---- an approval rule (04.02) ----
const approvalConfig = z.object({
  docType: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/, 'A document type such as SAMPLE_PO'), name: z.string().trim().min(3).max(120),
  conditions: z.array(z.object({ field: z.string().trim().min(1).max(60), op: z.enum(OPS), value: z.any().optional() }).strict()).max(10).default([]),
  steps: z.array(z.object({ role: z.string().trim().min(2).max(60), slaHours: z.number().int().min(1).max(720).optional() }).strict()).min(1).max(8),
}).strict().superRefine((c, ctx) => c.steps.forEach((s, i) => { if (!String(s.role).split('|').every((r) => r === 'MANAGER' || ROLE_CODES.includes(r))) ctx.addIssue({ code: 'custom', path: ['steps', i, 'role'], message: `${s.role} is not a role of the catalogue` }); }));
policyDrafts.register({
  type: 'APPROVAL_RULE', label: 'Approval matrix rule', part: '04.02', permission: 'eng.matrix.manage',
  validate: (config) => problemsOf(() => parse(approvalConfig, config)),
  create(db, ctx, config) {
    const c = parse(approvalConfig, config);
    const { matrix } = services.get(db) ?? {};
    if (!matrix) throw unprocessable('The approval matrix is not available.');
    matrix.ensureDefaults(ctx.companyId);
    const base = db.prepare("SELECT id FROM wf_matrix WHERE company_id = ? AND doc_type = ? AND scope_type = 'COMPANY' AND scope_id = 0 AND status = 'ACTIVE' AND is_active = 1 ORDER BY matrix_version DESC LIMIT 1").get(ctx.companyId, c.docType);
    const current = base ? db.prepare('SELECT priority, name, condition_json, steps_json FROM wf_matrix_rules WHERE matrix_id = ? AND deleted_at IS NULL ORDER BY priority').all(base.id).map((r) => ({ priority: r.priority + 1, name: r.name, conditions: JSON.parse(r.condition_json), steps: JSON.parse(r.steps_json) })) : [];
    const rules = [{ priority: 1, name: c.name, conditions: c.conditions, steps: c.steps.map((s) => ({ role: s.role, ...(s.slaHours ? { slaHours: s.slaHours } : {}) })) }, ...current];
    const made = matrix.create(system(ctx.companyId), { docType: c.docType, scopeType: 'COMPANY', scopeId: 0, name: `${c.docType}: ${c.name} (policy ${ctx.policyNo})`, rules });
    db.prepare("UPDATE wf_matrix SET created_by = ?, source_type = 'pol_requirement', source_id = ? WHERE id = ?").run(ctx.owner, String(ctx.requirementId), made.id);
    return { entity: 'wf_matrix', id: String(made.id), label: `${c.docType} matrix version ${made.version ?? ''}`.trim(), route: `/admin/approval-matrix/editor?id=${made.id}` };
  },
  status(db, companyId, id) {
    const m = db.prepare('SELECT status FROM wf_matrix WHERE id = ? AND company_id = ? AND is_active = 1').get(Number(id), companyId);
    if (!m) return { state: 'GONE', label: 'No longer exists' };
    return m.status === 'DRAFT' ? { state: 'DRAFT', label: 'Draft: not submitted' } : m.status === 'PENDING' ? { state: 'PENDING', label: 'Waiting for approval' } : m.status === 'ACTIVE' ? { state: 'ACTIVE', label: 'In force' } : { state: 'GONE', label: m.status === 'REJECTED' ? 'Rejected' : 'Replaced' };
  },
});

// ---- an alert rule (04.09) ----
const alertConfig = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_.]{2,60}$/, 'Lower-case letters, digits, dots and underscores, such as pol.leave_policy_breach'), name: z.string().trim().min(3).max(120), description: z.string().trim().max(300).optional(),
  triggerType: z.enum(['EVENT', 'SCHEDULE']), eventType: z.string().optional(), schedule: z.string().optional(), dataset: z.string().optional(), condition: z.object({ all: z.array(z.any()).optional(), any: z.array(z.any()).optional() }).default({}),
  actions: z.array(z.any()).min(1), messageTemplate: z.string().trim().min(5).max(500), severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('WARNING'), throttleMinutes: z.number().int().min(0).max(525_600).default(1440), ownerRole: z.string().default('SYSADM'),
}).strict();
policyDrafts.register({
  type: 'ALERT_RULE', label: 'Alert rule', part: '04.09', permission: 'alr.rule.edit',
  validate(config) {
    const parsed = alertConfig.safeParse(config);
    if (!parsed.success) return parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'config', message: i.message }));
    return checkRule(parsed.data, { roles: new Set(ROLE_CODES) });
  },
  create(db, ctx, config) {
    const c = parse(alertConfig, config);
    const problems = checkRule(c, { roles: new Set(ROLE_CODES) });
    if (problems.length) throw unprocessable('The alert rule is not valid.', problems);
    const { alerts } = services.get(db) ?? {};
    if (!alerts) throw unprocessable('The alert rules are not available.');
    const out = alerts.rules.propose(system(ctx.companyId), { ...c, ownerModule: 'pol', enabled: false, reason: `Drafted from policy ${ctx.policyNo}, clause ${ctx.clauseRef}` });
    db.prepare("UPDATE alr_rules SET created_by = ?, source_type = 'pol_requirement', source_id = ? WHERE company_id = ? AND code = ? AND rule_version = ?").run(ctx.owner, String(ctx.requirementId), ctx.companyId, c.code, out.version);
    return { entity: 'alr_rules', id: c.code, label: c.code, route: `/admin/alert-rules?code=${c.code}` };
  },
  status(db, companyId, code) {
    const r = db.prepare("SELECT status, enabled FROM alr_rules WHERE company_id = ? AND code = ? AND status IN ('PENDING', 'ACTIVE') AND is_active = 1 ORDER BY rule_version DESC LIMIT 1").get(companyId, code);
    if (!r) return { state: 'GONE', label: 'No longer exists' };
    if (r.status === 'PENDING') return { state: 'PENDING', label: 'Waiting for approval' };
    return r.enabled ? { state: 'ACTIVE', label: 'Switched on' } : { state: 'DRAFT', label: 'Draft: the rule is switched off' };
  },
});
void notFound;
