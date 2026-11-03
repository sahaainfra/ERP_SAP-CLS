import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { ACTION_TYPES, CONTROL_CODE, ENFORCEMENTS, MODES, STAGES, controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { ROLE_TEMPLATES } from '../../platform/authz/templates.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { formatINR, fromUnits, toUnits } from '../../../shared/money.js';

// The Protocol & Control Engine's module side (part 04.04): the registry of control points a company runs, the exceptions that let an action through a failing control,
// the reason codes, and the dashboard. The check itself (platform/protocol) runs inside the transaction of the action; what is here decides who may change a control,
// how a deviation is approved, and what the people who watch the business see.
export const EXCEPTION_DOC = 'PCS_EXCEPTION';
export const CONTROL_DOC = 'PCS_CONTROL';
export const BIG_RISK_RUPEES = 1_000_000;
export const LEVEL_ROLE = { 1: 'PM', 2: 'PD', 3: 'DIR' };
const iso = () => new Date().toISOString();
const event = (db, type, entity, id, actor, companyId, data, extra = {}) => publishEvent(db, { type, entity, entityId: id, actorId: actor?.user ?? 'system', companyId, data, ...extra });
const rupees = (paise) => fromUnits(paise, 'money');

const step = (code, name, approvers, when = null, slaHours = 24) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const setStatus = (db, id, status, actor, extra = '', ...params) => db.prepare(`UPDATE pcs_exceptions SET status = ?, ${extra} updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(status, ...params, actor?.user ?? 'system', iso(), Number(id));

// who approves a change of a control: the owner of the process the control protects, then the auditor or the director
workflowResolvers.register('pcs_control_owner', ({ db, instance }) => {
  const c = db.prepare('SELECT c.owner_role FROM pcs_control_changes ch JOIN pcs_control_points c ON c.id = ch.control_id WHERE ch.id = ?').get(Number(instance.docId));
  return [{ role: c?.owner_role ?? 'SYSADM' }];
});

workflowTypes.register({
  docType: EXCEPTION_DOC,
  label: 'Control exception',
  processOwner: 'SYSADM',
  route: (id) => `/controls/exceptions?open=${id}`,
  describe(db, companyId, id) {
    const e = db.prepare('SELECT * FROM pcs_exceptions WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return e ? { ref: e.exception_no, title: `${e.control_code}: ${e.entity_ref ?? `${e.entity} ${e.entity_id}`}`, originator: e.raised_by, projectId: e.project_id, siteId: e.site_id } : null;
  },
  summarise(db, actor, id) {
    const e = db.prepare('SELECT * FROM pcs_exceptions WHERE id = ?').get(Number(id));
    if (!e) return null;
    const c = db.prepare('SELECT description FROM pcs_control_points WHERE id = ?').get(e.control_id);
    return { fields: [
      { label: 'Exception', value: e.exception_no }, { label: 'Control', value: `${e.control_code}: ${c?.description ?? ''}` }, { label: 'For', value: e.entity_ref ?? `${e.entity} ${e.entity_id}` },
      { label: 'Reason', value: e.reason_code }, { label: 'Justification', value: e.justification }, { label: 'Value at risk', value: rupees(e.value_at_risk), format: 'inr' },
      { label: 'Raised by', value: e.raised_by }, ...(e.emergency ? [{ label: 'Emergency: regularise by', value: e.regularise_by }] : []),
    ] };
  },
  defaultDefinition: {
    name: 'Control exception approval',
    settings: { resubmit: 'first', distinctApprovers: true, matrix: true },
    steps: [
      step('L1', 'Project manager (level 1 control)', [{ kind: 'role', role: 'PM' }], { field: 'level', op: 'eq', value: 1 }),
      step('L2', 'Project director (level 2 control)', [{ kind: 'role', role: 'PD' }], { field: 'level', op: 'eq', value: 2 }),
      step('L3', 'Director (level 3 control)', [{ kind: 'role', role: 'DIR' }], { field: 'level', op: 'eq', value: 3 }),
      step('BIG', 'Director (₹10 L or more at risk)', [{ kind: 'role', role: 'DIR' }], { field: 'bigOnly', op: 'eq', value: 1 }, 48),
    ],
  },
  hooks: {
    onSubmitted(db, { instance, actor }) { setStatus(db, instance.docId, 'PENDING', actor, 'workflow_instance_id = ?,', instance.id); },
    onResubmitted(db, { instance, actor }) { setStatus(db, instance.docId, 'PENDING', actor); },
    onApproved(db, { instance, actor }) {
      const e = db.prepare('SELECT * FROM pcs_exceptions WHERE id = ?').get(Number(instance.docId));
      setStatus(db, e.id, e.used_at ? 'USED' : 'APPROVED', actor, 'decided_at = ?, regularised_at = CASE WHEN emergency = 1 THEN ? ELSE NULL END,', iso(), iso());
      event(db, 'pcs.exception.approved', 'pcs_exception', e.id, actor, e.company_id, { exceptionNo: e.exception_no, control: e.control_code, emergency: e.emergency === 1, used: Boolean(e.used_at) }, { projectId: e.project_id, siteId: e.site_id });
    },
    onRejected(db, { instance, actor }) {
      const e = db.prepare('SELECT * FROM pcs_exceptions WHERE id = ?').get(Number(instance.docId));
      setStatus(db, e.id, 'REJECTED', actor, 'decided_at = ?,', iso());
      event(db, 'pcs.exception.rejected', 'pcs_exception', e.id, actor, e.company_id, { exceptionNo: e.exception_no, control: e.control_code, usedBeforeDecision: Boolean(e.used_at) }, { projectId: e.project_id, siteId: e.site_id });
    },
    onReturned(db, { instance, actor }) { setStatus(db, instance.docId, 'RETURNED', actor); },
    onCancelled(db, { instance, actor }) { setStatus(db, instance.docId, 'CANCELLED', actor); },
  },
});

workflowTypes.register({
  docType: CONTROL_DOC,
  label: 'Control mode or setting change',
  processOwner: 'SYSADM',
  route: () => '/admin/controls',
  describe(db, companyId, id) {
    const c = db.prepare('SELECT * FROM pcs_control_changes WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return c ? { ref: `${c.control_code} ${c.from_mode} to ${c.to_mode}`, title: 'Change of a control point', originator: c.requested_by } : null;
  },
  summarise(db, actor, id) {
    const c = db.prepare('SELECT * FROM pcs_control_changes WHERE id = ?').get(Number(id));
    if (!c) return null;
    const ch = JSON.parse(c.change_json);
    return { fields: [{ label: 'Control', value: c.control_code }, { label: 'Mode', value: `${c.from_mode} to ${c.to_mode}` }, { label: 'Days observed', value: c.observed_days }, ...Object.entries(ch).filter(([k]) => k !== 'mode').map(([k, v]) => ({ label: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) })), { label: 'Reason', value: c.reason ?? '' }] };
  },
  defaultDefinition: {
    name: 'Control change approval',
    settings: { resubmit: 'first', distinctApprovers: true },
    steps: [step('OWNER', 'Process owner', [{ kind: 'resolver', resolver: 'pcs_control_owner' }]), step('AUDIT', 'Internal auditor or director', [{ kind: 'role', role: 'AUD|DIR' }])],
  },
  hooks: {
    onApproved(db, { instance, actor }) { applyChange(db, Number(instance.docId), actor); },
    onRejected: (db, { instance, actor }) => closeChange(db, Number(instance.docId), actor, 'REJECTED'),
    onReturned: (db, { instance, actor }) => closeChange(db, Number(instance.docId), actor, 'REJECTED'),
    onCancelled: (db, { instance, actor }) => closeChange(db, Number(instance.docId), actor, 'REJECTED'),
  },
});

/** Put a change of a control into effect: the settings of the change replace those of the control, and the mode moves with its dates. */
function writeControl(db, row, ch, actor) {
  const mode = ch.mode ?? row.mode;
  const today = iso().slice(0, 10);
  const observeSince = mode === 'OFF' ? null : mode === 'OBSERVE' ? (row.observe_since ?? today) : row.observe_since;
  db.prepare(`UPDATE pcs_control_points SET mode = ?, enforcement = ?, thresholds_json = ?, evidence_required = ?, escalation_level = ?, owner_role = ?, emergency_allowed = ?, description = ?,
    observe_since = ?, mode_changed_at = CASE WHEN mode != ? THEN ? ELSE mode_changed_at END, pending_change_id = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
    .run(mode, ch.enforcement ?? row.enforcement, JSON.stringify(ch.thresholds ?? JSON.parse(row.thresholds_json)), (ch.evidenceRequired ?? row.evidence_required === 1) ? 1 : 0, ch.escalationLevel ?? row.escalation_level, ch.ownerRole ?? row.owner_role,
      (ch.emergencyAllowed ?? row.emergency_allowed === 1) ? 1 : 0, ch.description ?? row.description, observeSince, mode, iso(), actor.user, iso(), row.id);
  writeAudit(db, { entity: 'pcs_control_points', entityId: row.id, action: 'update', oldValues: { mode: row.mode, enforcement: row.enforcement, thresholds: JSON.parse(row.thresholds_json) }, newValues: { ...ch, mode }, actor: actor.user, companyId: row.company_id, reason: ch.reason });
  event(db, 'pcs.control.changed', 'pcs_control', row.id, actor, row.company_id, { control: row.code, from: row.mode, to: mode });
}
function applyChange(db, changeId, actor) {
  const c = db.prepare('SELECT * FROM pcs_control_changes WHERE id = ?').get(changeId);
  const row = db.prepare('SELECT * FROM pcs_control_points WHERE id = ?').get(c.control_id);
  writeControl(db, row, { ...JSON.parse(c.change_json), reason: c.reason }, actor);
  db.prepare("UPDATE pcs_control_changes SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), changeId);
}
function closeChange(db, changeId, actor, to) {
  const c = db.prepare('SELECT * FROM pcs_control_changes WHERE id = ?').get(changeId);
  db.prepare('UPDATE pcs_control_changes SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, actor.user, iso(), changeId);
  db.prepare('UPDATE pcs_control_points SET pending_change_id = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND pending_change_id = ?').run(actor.user, iso(), c.control_id, changeId);
}

export function createProtocolService({ db, engine }) {
  const authz = authzOf(db);
  const protocol = protocolOf(db);
  const may = (actor, key, scope = {}) => authz.check(actor, key, { companyId: actor.companyId, ...scope }).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const day = () => protocol.today();

  // ---- reason codes (FR-04) ----
  const reasonRow = (r) => ({ id: r.id, actionType: r.action_type, code: r.code, label: r.label, requiresEvidence: r.requires_evidence === 1, needsText: r.needs_text === 1, sortOrder: r.sort_order, active: r.is_active === 1, scope: r.company_id == null ? 'system' : 'company', version: r.version });
  const reasons = {
    /** The codes of one action type (or all) as a company sees them: its own rows replace the shared ones with the same code. */
    list(actor, { actionType, all = false } = {}) {
      const rows = db.prepare(`SELECT * FROM pcs_reason_codes WHERE (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL ${actionType ? 'AND action_type = ?' : ''} ORDER BY action_type, sort_order, code`).all(...[actor.companyId, ...(actionType ? [actionType] : [])]);
      const merged = new Map();
      for (const r of rows) { const k = `${r.action_type}|${r.code}`; if (r.company_id != null || !merged.has(k)) merged.set(k, r); }
      return [...merged.values()].filter((r) => all || r.is_active === 1).map(reasonRow).sort((a, b) => a.actionType.localeCompare(b.actionType) || a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    },
    /** @param {any} actor @param {any} b */
    save(actor, b) {
      need(actor, 'eng.pcs.manage', 'change reason codes');
      return transaction(db, () => {
        const old = db.prepare('SELECT * FROM pcs_reason_codes WHERE company_id = ? AND action_type = ? AND code = ?').get(actor.companyId, b.actionType, b.code);
        const base = db.prepare('SELECT * FROM pcs_reason_codes WHERE company_id IS NULL AND action_type = ? AND code = ?').get(b.actionType, b.code);
        if (old) {
          if (b.version !== undefined && b.version !== old.version) throw conflict('This reason code was changed by someone else. Refresh and try again.');
          db.prepare('UPDATE pcs_reason_codes SET label = ?, requires_evidence = ?, needs_text = ?, sort_order = ?, is_active = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
            .run(b.label, b.requiresEvidence ? 1 : 0, b.needsText ? 1 : 0, b.sortOrder ?? old.sort_order, b.active === false ? 0 : 1, actor.user, iso(), old.id);
        } else {
          db.prepare("INSERT INTO pcs_reason_codes (company_id, action_type, code, label, requires_evidence, needs_text, sort_order, is_active, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reason_code')")
            .run(actor.companyId, b.actionType, b.code, b.label, b.requiresEvidence ? 1 : 0, b.needsText ? 1 : 0, b.sortOrder ?? base?.sort_order ?? 100, b.active === false ? 0 : 1, actor.user);
        }
        const saved = db.prepare('SELECT * FROM pcs_reason_codes WHERE company_id = ? AND action_type = ? AND code = ?').get(actor.companyId, b.actionType, b.code);
        writeAudit(db, { entity: 'pcs_reason_codes', entityId: saved.id, action: old ? 'update' : 'create', oldValues: old ? reasonRow(old) : base ? reasonRow(base) : undefined, newValues: reasonRow(saved), actor: actor.user, companyId: actor.companyId });
        event(db, 'pcs.reason_code.changed', 'pcs_reason_code', saved.id, actor, actor.companyId, { actionType: b.actionType, code: b.code, active: saved.is_active === 1 });
        return reasonRow(saved);
      });
    },
  };

  // ---- control points (FR-01, FR-06, BR-01) ----
  const present = (c) => ({
    id: c.id, code: c.code, module: c.module, stage: c.stage, description: c.description, rule: c.rule_ref.startsWith('hook:') ? { kind: 'service', ref: c.rule_ref.slice(5) } : { kind: 'expression', condition: JSON.parse(c.rule_ref.slice(5)) },
    enforcement: c.enforcement, thresholds: protocol.thresholdsOf(c), evidenceRequired: c.evidence_required === 1, escalationLevel: c.escalation_level, mode: c.mode, ownerRole: c.owner_role,
    emergencyAllowed: c.emergency_allowed === 1, observeSince: c.observe_since, pendingChangeId: c.pending_change_id, version: c.version,
  });
  function observeStats(c) {
    const since = c.observe_since ? `${c.observe_since}T00:00:00.000Z` : null;
    const rows = since ? db.prepare("SELECT result, COUNT(*) AS n, COALESCE(SUM(value_at_risk), 0) AS value, COUNT(DISTINCT user_id) AS users FROM pcs_check_results WHERE control_id = ? AND at >= ? GROUP BY result").all(c.id, since) : [];
    const by = Object.fromEntries(rows.map((r) => [r.result, r.n]));
    const days = c.observe_since ? Math.max(0, Math.floor((Date.parse(`${day()}T00:00:00Z`) - Date.parse(`${c.observe_since}T00:00:00Z`)) / 86_400_000)) : 0;
    const need = protocol.param('eng.pcs.observe_days', c.company_id);
    const would = (by.WOULD_BLOCK ?? 0) + (by.WOULD_REQUIRE_EXCEPTION ?? 0) + (by.WOULD_WARN ?? 0);
    const total = rows.reduce((n, r) => n + r.n, 0);
    return { days, requiredDays: need, ready: c.mode !== 'OFF' && c.observe_since != null && days >= need, results: total, wouldBlock: by.WOULD_BLOCK ?? 0, wouldRequireException: by.WOULD_REQUIRE_EXCEPTION ?? 0, wouldWarn: by.WOULD_WARN ?? 0, wouldAffect: would, passes: by.PASS ?? 0, blocked: by.BLOCK ?? 0, exceptionRequired: by.EXCEPTION_REQUIRED ?? 0, excepted: by.EXCEPTED ?? 0, warned: by.WARN ?? 0, valueAtRisk: rupees(rows.filter((r) => /WOULD|BLOCK|EXCEPTION_REQUIRED|WARN/.test(r.result)).reduce((n, r) => n + r.value, 0)) };
  }
  const ensureAll = (companyId) => { for (const d of controlRegistry.list()) protocol.ensure(companyId, d.code); };
  const loadControl = (actor, code) => {
    ensureAll(actor.companyId);
    const c = db.prepare('SELECT * FROM pcs_control_points WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL').get(actor.companyId, code);
    if (!c) throw notFound('That control point does not exist.');
    return c;
  };
  const controls = {
    list(actor, { module, mode, stage, q } = {}) {
      need(actor, 'eng.pcs.view', 'see the control points');
      protocol.flush();
      ensureAll(actor.companyId);
      const where = ['company_id = :c', 'is_active = 1', 'deleted_at IS NULL'];
      const p = { c: actor.companyId };
      if (module) { where.push('module = :m'); p.m = module; }
      if (mode) { where.push('mode = :mode'); p.mode = mode; }
      if (stage) { where.push('stage = :s'); p.s = stage; }
      if (q) { where.push('(code LIKE :q OR description LIKE :q)'); p.q = `%${q}%`; }
      const rows = db.prepare(`SELECT * FROM pcs_control_points WHERE ${where.join(' AND ')} ORDER BY code`).all(p);
      return { rows: rows.map((c) => ({ ...present(c), stats: observeStats(c) })), total: rows.length, modules: [...new Set(db.prepare('SELECT module FROM pcs_control_points WHERE company_id = ? AND is_active = 1').all(actor.companyId).map((r) => r.module))].sort() };
    },
    get(actor, code) {
      need(actor, 'eng.pcs.view', 'see the control points');
      protocol.flush();
      const c = loadControl(actor, code);
      const changes = db.prepare('SELECT * FROM pcs_control_changes WHERE control_id = ? ORDER BY id DESC LIMIT 20').all(c.id).map((x) => ({ id: x.id, from: x.from_mode, to: x.to_mode, status: x.status, change: JSON.parse(x.change_json), requestedBy: x.requested_by, reason: x.reason, instanceId: x.instance_id, at: x.created_at }));
      const recent = db.prepare("SELECT id, result, entity, entity_id AS entityId, user_id AS user, at, details_json AS details FROM pcs_check_results WHERE control_id = ? AND result NOT IN ('PASS') ORDER BY id DESC LIMIT 15").all(c.id).map((r) => ({ ...r, details: JSON.parse(r.details) }));
      return { ...present(c), stats: observeStats(c), changes, recent };
    },
    /** A new control written as data: it fails when its condition holds. Created OFF. */
    create(actor, b) {
      need(actor, 'eng.pcs.manage', 'define control points');
      if (!CONTROL_CODE.test(b.code)) throw badRequest('Some fields are invalid.', [{ field: 'code', message: 'Use the form CP-<MODULE>-nn, for example CP-PROC-05.' }]);
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM pcs_control_points WHERE company_id = ? AND code = ?').get(actor.companyId, b.code)) throw conflict(`The control point ${b.code} already exists.`);
        if (controlRegistry.get(b.code)) throw conflict(`The control point ${b.code} belongs to a module and cannot be redefined.`);
        db.prepare(`INSERT INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, thresholds_json, evidence_required, escalation_level, mode, owner_role, emergency_allowed, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFF', ?, ?, ?, 'control_point')`)
          .run(actor.companyId, b.code, b.module, b.stage, b.description, `expr:${JSON.stringify(b.rule)}`, b.enforcement, JSON.stringify(b.thresholds ?? {}), b.evidenceRequired ? 1 : 0, b.escalationLevel ?? 1, b.ownerRole, b.emergencyAllowed ? 1 : 0, actor.user);
        const c = db.prepare('SELECT * FROM pcs_control_points WHERE company_id = ? AND code = ?').get(actor.companyId, b.code);
        writeAudit(db, { entity: 'pcs_control_points', entityId: c.id, action: 'create', newValues: present(c), actor: actor.user, companyId: actor.companyId });
        event(db, 'pcs.control.created', 'pcs_control', c.id, actor, actor.companyId, { control: c.code });
        return present(c);
      });
    },
    /**
     * Change a control. A control that is in ENFORCE, or is going to be, is changed only through the approval of its process owner and then the auditor or director (maker-checker);
     * and going to ENFORCE needs the days of OBSERVE data the company set (14 by default). Any other change takes effect at once and is audited.
     */
    update(actor, code, b) {
      need(actor, 'eng.pcs.manage', 'change control points');
      return transaction(db, () => {
        const c = loadControl(actor, code);
        if (b.version !== undefined && b.version !== c.version) throw conflict('This control was changed by someone else. Refresh it and try again.');
        if (c.pending_change_id) throw conflict('A change of this control is already waiting for its approval.');
        const { version, reason, ...ch } = b;
        const to = ch.mode ?? c.mode;
        const stats = observeStats(c);
        if (to === 'ENFORCE' && c.mode !== 'ENFORCE') {
          if (c.mode === 'OFF') throw unprocessable('A control goes to ENFORCE only after it has been observed. Put it in OBSERVE first and look at what it would have blocked.');
          if (!stats.ready) throw unprocessable(`BR-01: a control needs at least ${stats.requiredDays} days of OBSERVE data before it is enforced; this one has ${stats.days}.`);
        }
        if (!Object.keys(ch).length) throw badRequest('Some fields are invalid.', [{ field: 'mode', message: 'Say what to change.' }]);
        const approval = c.mode === 'ENFORCE' || to === 'ENFORCE';
        if (!approval) { writeControl(db, c, { ...ch, reason }, actor); return { applied: true, control: present(db.prepare('SELECT * FROM pcs_control_points WHERE id = ?').get(c.id)) }; }
        if (!reason || reason.trim().length < 5) throw badRequest('Some fields are invalid.', [{ field: 'reason', message: 'Give the reason for the change (at least 5 characters); the approvers read it.' }]);
        const res = db.prepare(`INSERT INTO pcs_control_changes (company_id, control_id, control_code, change_json, from_mode, to_mode, observed_days, requested_by, reason, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'control_change')`).run(actor.companyId, c.id, c.code, JSON.stringify({ ...ch }), c.mode, to, stats.days, actor.user, reason.trim(), actor.user);
        const changeId = Number(res.lastInsertRowid);
        db.prepare('UPDATE pcs_control_points SET pending_change_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(changeId, actor.user, iso(), c.id);
        const instance = engine.submit(actor, { docType: CONTROL_DOC, docId: changeId, comment: reason.trim(), context: { control: c.code, to, from: c.mode, observedDays: stats.days } });
        db.prepare('UPDATE pcs_control_changes SET instance_id = ? WHERE id = ?').run(instance.id, changeId);
        writeAudit(db, { entity: 'pcs_control_points', entityId: c.id, action: 'change_requested', newValues: { changeId, ...ch }, actor: actor.user, companyId: actor.companyId, reason });
        return { applied: false, changeId, workflow: instance };
      });
    },
    remove(actor, code) {
      need(actor, 'eng.pcs.manage', 'remove control points');
      return transaction(db, () => {
        const c = loadControl(actor, code);
        if (controlRegistry.get(c.code)) throw unprocessable('A control point that belongs to a module cannot be removed; put it OFF instead.');
        if (c.mode !== 'OFF') throw unprocessable('Put the control OFF before it is removed.');
        db.prepare('UPDATE pcs_control_points SET is_active = 0, deleted_at = ?, deleted_by = ?, version = version + 1 WHERE id = ?').run(iso(), actor.user, c.id);
        writeAudit(db, { entity: 'pcs_control_points', entityId: c.id, action: 'delete', oldValues: present(c), actor: actor.user, companyId: actor.companyId });
        return { removed: true };
      });
    },
    options() { return { stages: STAGES, enforcements: ENFORCEMENTS, modes: MODES, actionTypes: ACTION_TYPES, roles: ROLE_TEMPLATES.map((r) => r.code).sort() }; },
  };

  // ---- exceptions (FR-03, BR-02) ----
  const exc = (e) => ({
    id: e.id, no: e.exception_no, control: e.control_code, controlDescription: e.description ?? null, entity: e.entity, entityId: e.entity_id, entityRef: e.entity_ref, reasonCode: e.reason_code, justification: e.justification,
    evidenceFileIds: JSON.parse(e.evidence_file_ids || '[]'), valueAtRisk: rupees(e.value_at_risk).toFixed(2), valueText: formatINR(rupees(e.value_at_risk)), level: e.level, status: e.status, emergency: e.emergency === 1,
    regulariseBy: e.regularise_by, regularisedAt: e.regularised_at, escalatedAt: e.escalated_at, instanceId: e.workflow_instance_id, raisedBy: e.raised_by, usedAt: e.used_at, usedBy: e.used_by, decidedAt: e.decided_at,
    projectId: e.project_id, createdAt: e.created_at, ageDays: Math.floor((protocol.nowIso() ? Date.parse(protocol.nowIso()) - Date.parse(e.created_at) : 0) / 86_400_000), overdue: e.emergency === 1 && e.status === 'PENDING' && e.regularise_by < protocol.nowIso(), version: e.version,
  });
  const scopeSql = (actor, p) => {
    p.me = actor.user;
    const view = authz.scopeFilter(actor, 'eng.pcs.view', { project: 'e.project_id', site: 'e.site_id' }).sql;
    return `(e.raised_by = :me OR ${view})`;
  };
  const loadException = (actor, id) => {
    const p = {};
    const e = db.prepare(`SELECT e.*, c.description FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE e.id = :id AND e.company_id = :c AND e.is_active = 1 AND ${scopeSql(actor, p)}`).get({ id, c: actor.companyId, ...p });
    if (!e) throw notFound('That exception does not exist.');
    return e;
  };
  const evidenceIds = (id) => db.prepare("SELECT id FROM core_files WHERE linked_entity = 'pcs_exception' AND linked_id = ? AND is_active = 1 AND deleted_at IS NULL AND scan_status != 'INFECTED' ORDER BY id").all(id).map((r) => r.id);
  const reasonFor = (actor, code) => reasons.list(actor).find((r) => r.code === code && (r.actionType === 'override' || r.actionType === 'deviate'));
  const exceptions = {
    list(actor, { status, control, projectId, minValue, maxValue, raisedBy, emergency, q, open, sort = 'newest', limit = 25, offset = 0 } = {}) {
      protocol.flush();
      const p = {};
      const where = ['e.company_id = :c', 'e.is_active = 1', scopeSql(actor, p)];
      p.c = actor.companyId;
      if (status === 'OPEN') where.push("e.status IN ('DRAFT', 'PENDING', 'RETURNED', 'APPROVED')");
      else if (status) { where.push('e.status = :st'); p.st = status; }
      if (control) { where.push('e.control_code = :ctl'); p.ctl = control; }
      if (projectId) { where.push('e.project_id = :pr'); p.pr = projectId; }
      if (minValue != null) { where.push('e.value_at_risk >= :mn'); p.mn = toUnits(minValue, 'money'); }
      if (maxValue != null) { where.push('e.value_at_risk <= :mx'); p.mx = toUnits(maxValue, 'money'); }
      if (raisedBy) { where.push('e.raised_by = :rb'); p.rb = raisedBy; }
      if (emergency != null) { where.push('e.emergency = :em'); p.em = emergency ? 1 : 0; }
      if (q) { where.push('(e.exception_no LIKE :q OR e.entity_ref LIKE :q OR e.justification LIKE :q OR e.control_code LIKE :q)'); p.q = `%${q}%`; }
      const order = { newest: 'e.id DESC', oldest: 'e.id ASC', value: 'e.value_at_risk DESC, e.id DESC', status: 'e.status, e.id DESC' }[sort] ?? 'e.id DESC';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM pcs_exceptions e WHERE ${where.join(' AND ')}`).get(p).n;
      const rows = db.prepare(`SELECT e.*, c.description FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit OFFSET :offset`).all({ ...p, limit, offset }).map(exc);
      const sums = db.prepare(`SELECT COALESCE(SUM(e.value_at_risk), 0) AS v FROM pcs_exceptions e WHERE ${where.join(' AND ')}`).get(p).v;
      return { rows, total, valueAtRisk: rupees(sums).toFixed(2), controls: db.prepare('SELECT DISTINCT code FROM pcs_control_points WHERE company_id = ? AND is_active = 1 ORDER BY code').all(actor.companyId).map((r) => r.code), projects: db.prepare('SELECT DISTINCT p.id, p.code, p.name FROM pcs_exceptions e JOIN org_projects p ON p.id = e.project_id WHERE e.company_id = ? ORDER BY p.code').all(actor.companyId) };
    },
    get(actor, id) {
      const e = loadException(actor, id);
      const checks = db.prepare("SELECT id, result, mode, user_id AS user, at, details_json AS details FROM pcs_check_results WHERE company_id = ? AND control_code = ? AND entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 10").all(actor.companyId, e.control_code, e.entity, e.entity_id).map((r) => ({ ...r, details: JSON.parse(r.details) }));
      return { ...exc(e), evidence: evidenceIds(e.id), checks, workflow: e.workflow_instance_id ? engine.get(actor, e.workflow_instance_id) : null, reason: reasonFor(actor, e.reason_code) ?? null };
    },
    /**
     * Start an exception for an action a control stopped. The server finds the check that stopped this very person on this very object (the client cannot claim a failure that
     * did not happen) and takes the value at risk, the project and the level from it. The exception is a draft until the evidence is attached and it is submitted.
     */
    create(actor, b) {
      need(actor, 'eng.pcs.raise', 'raise exceptions');
      protocol.flush();
      return transaction(db, () => {
        const c = loadControl(actor, b.controlCode);
        if (c.enforcement !== 'EXCEPTION') throw unprocessable(c.enforcement === 'BLOCK' ? `${c.code} blocks without exception: the action must be corrected, not excepted.` : `${c.code} only warns, so it does not need an exception.`);
        if (c.mode !== 'ENFORCE') throw unprocessable(`${c.code} is in ${c.mode} mode: it does not stop anyone, so there is nothing to except.`);
        const since = new Date(Date.parse(protocol.nowIso()) - 7 * 86_400_000).toISOString();
        const hit = db.prepare("SELECT * FROM pcs_check_results WHERE company_id = ? AND control_id = ? AND entity = ? AND entity_id = ? AND user_id = ? AND result = 'EXCEPTION_REQUIRED' AND at >= ? ORDER BY id DESC LIMIT 1").get(actor.companyId, c.id, b.entity, String(b.entityId), actor.user, since);
        if (!hit) throw unprocessable('This control has not stopped you on that record, so an exception cannot be raised for it. Try the action first; if the control stops it, you can raise the exception from there.');
        const reason = reasonFor(actor, b.reasonCode);
        if (!reason) throw badRequest('Some fields are invalid.', [{ field: 'reasonCode', message: 'Choose one of the reasons offered.' }]);
        if (b.emergency) {
          if (!may(actor, 'eng.pcs.emergency')) throw forbidden('You may not raise an emergency exception (permission eng.pcs.emergency).');
          if (c.emergency_allowed !== 1) throw unprocessable(`${c.code} does not allow an emergency exception.`);
        }
        const open = db.prepare("SELECT exception_no FROM pcs_exceptions WHERE company_id = ? AND control_code = ? AND entity = ? AND entity_id = ? AND status IN ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED') AND is_active = 1").get(actor.companyId, c.code, b.entity, String(b.entityId));
        if (open) throw conflict(`An exception for this is already open (${open.exception_no}).`);
        const no = `EXC-${String(db.prepare('SELECT COUNT(*) + 1 AS n FROM pcs_exceptions WHERE company_id = ?').get(actor.companyId).n).padStart(5, '0')}`;
        const regulariseBy = b.emergency ? new Date(Date.parse(protocol.nowIso()) + protocol.param('eng.pcs.regularise_hours', actor.companyId) * 3_600_000).toISOString() : null;
        const res = db.prepare(`INSERT INTO pcs_exceptions (company_id, exception_no, control_id, control_code, entity, entity_id, entity_ref, reason_code, justification, value_at_risk, level, emergency, regularise_by, raised_by, project_id, site_id, check_context_json, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'exception')`)
          .run(actor.companyId, no, c.id, c.code, b.entity, String(b.entityId), b.entityRef ?? JSON.parse(hit.details_json).ref ?? null, b.reasonCode, b.justification, hit.value_at_risk ?? 0, c.escalation_level, b.emergency ? 1 : 0, regulariseBy, actor.user, hit.project_id, hit.site_id, hit.details_json, actor.user);
        const e = db.prepare('SELECT e.*, c.description FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE e.id = ?').get(Number(res.lastInsertRowid));
        writeAudit(db, { entity: 'pcs_exceptions', entityId: e.id, action: 'create', newValues: { no, control: c.code, entity: b.entity, entityId: b.entityId, reason: b.reasonCode, emergency: Boolean(b.emergency) }, actor: actor.user, companyId: actor.companyId });
        return exc(e);
      });
    },
    update(actor, id, b) {
      return transaction(db, () => {
        const e = loadException(actor, id);
        if (e.raised_by !== actor.user) throw forbidden(`Only ${e.raised_by}, who raised this exception, can change it.`);
        if (!['DRAFT', 'RETURNED'].includes(e.status)) throw unprocessable(`This exception is ${e.status.toLowerCase()}, so it cannot be changed.`);
        if (b.version !== undefined && b.version !== e.version) throw conflict('This exception was changed by someone else. Refresh it and try again.');
        if (!reasonFor(actor, b.reasonCode)) throw badRequest('Some fields are invalid.', [{ field: 'reasonCode', message: 'Choose one of the reasons offered.' }]);
        db.prepare('UPDATE pcs_exceptions SET reason_code = ?, justification = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.reasonCode, b.justification, actor.user, iso(), e.id);
        writeAudit(db, { entity: 'pcs_exceptions', entityId: e.id, action: 'update', oldValues: { reason: e.reason_code, justification: e.justification }, newValues: { reason: b.reasonCode, justification: b.justification }, actor: actor.user, companyId: actor.companyId });
        return exc(db.prepare('SELECT e.*, c.description FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE e.id = ?').get(e.id));
      });
    },
    /** Send it into approval; the evidence the control or the reason asks for must be attached. After a return it goes into approval again. */
    submit(actor, id, { comment } = {}) {
      return transaction(db, () => {
        const e = loadException(actor, id);
        if (e.raised_by !== actor.user) throw forbidden(`Only ${e.raised_by}, who raised this exception, can submit it.`);
        if (!['DRAFT', 'RETURNED'].includes(e.status)) throw unprocessable(`This exception is ${e.status.toLowerCase()}, so it cannot be submitted.`);
        const c = db.prepare('SELECT * FROM pcs_control_points WHERE id = ?').get(e.control_id);
        const reason = reasonFor(actor, e.reason_code);
        const files = evidenceIds(e.id);
        if ((c.evidence_required === 1 || reason?.requiresEvidence) && files.length === 0) throw unprocessable('Evidence is required: attach at least one file (a photo, a letter or a signed note) before you submit.', [{ field: 'evidence', message: 'Attach at least one file.' }]);
        db.prepare('UPDATE pcs_exceptions SET evidence_file_ids = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(files), actor.user, iso(), e.id);
        const risk = Number(rupees(e.value_at_risk).toFixed(2));
        const context = { level: e.level, amount: risk, valueAtRisk: risk, bigOnly: risk >= BIG_RISK_RUPEES && e.level < 3 ? 1 : 0, control: e.control_code, emergency: e.emergency === 1, reason: e.reason_code };
        const instance = e.workflow_instance_id && e.status === 'RETURNED' ? engine.resubmit(actor, e.workflow_instance_id, { comment }) : engine.submit(actor, { docType: EXCEPTION_DOC, docId: e.id, comment, context });
        event(db, 'pcs.exception.raised', 'pcs_exception', e.id, actor, e.company_id, { exceptionNo: e.exception_no, control: e.control_code, emergency: e.emergency === 1, valueAtRisk: risk }, { projectId: e.project_id, siteId: e.site_id });
        return { ...exc(db.prepare('SELECT e.*, c.description FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE e.id = ?').get(e.id)), workflow: instance };
      });
    },
    /** Withdraw an exception that has not been used; an emergency one that was already used cannot be withdrawn (it must be decided). */
    cancel(actor, id, { reason }) {
      return transaction(db, () => {
        const e = loadException(actor, id);
        if (e.raised_by !== actor.user && !may(actor, 'eng.pcs.manage')) throw forbidden(`Only ${e.raised_by}, who raised this exception, can cancel it.`);
        if (!['DRAFT', 'PENDING', 'RETURNED', 'APPROVED'].includes(e.status)) throw unprocessable(`This exception is ${e.status.toLowerCase()}, so it cannot be cancelled.`);
        if (e.used_at) throw unprocessable('This exception has already been used for the action; it must be decided, not cancelled.');
        if (e.workflow_instance_id && e.status === 'PENDING') engine.withdraw(actor, e.workflow_instance_id, { comment: reason });
        else setStatus(db, e.id, 'CANCELLED', actor, 'decided_at = ?,', iso());
        writeAudit(db, { entity: 'pcs_exceptions', entityId: e.id, action: 'cancel', newValues: { reason }, actor: actor.user, companyId: actor.companyId, reason });
        return exc(db.prepare('SELECT e.*, c.description FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE e.id = ?').get(e.id));
      });
    },
    /** BR-02: emergency exceptions not regularised (approved) within their window climb to the next level and the owner is told. Run by the scheduler. */
    sweepEmergencies() {
      return transaction(db, () => {
        protocol.flush();
        const late = db.prepare("SELECT e.*, c.owner_role FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE e.emergency = 1 AND e.status = 'PENDING' AND e.escalated_at IS NULL AND e.regularise_by < ? AND e.is_active = 1").all(protocol.nowIso());
        for (const e of late) {
          const to = LEVEL_ROLE[Math.min(3, e.level + 1)];
          db.prepare('UPDATE pcs_exceptions SET escalated_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(protocol.nowIso(), 'system', iso(), e.id);
          const climbed = e.workflow_instance_id ? engine.escalateInstance(e.workflow_instance_id) : 0;
          writeAudit(db, { entity: 'pcs_exceptions', entityId: e.id, action: 'escalate', newValues: { to, regulariseBy: e.regularise_by, tasks: climbed }, actor: 'system', companyId: e.company_id });
          event(db, 'pcs.exception.escalated', 'pcs_exception', e.id, null, e.company_id, { exceptionNo: e.exception_no, control: e.control_code, regulariseBy: e.regularise_by, to }, { projectId: e.project_id, siteId: e.site_id });
          if (e.workflow_instance_id) event(db, 'workflow.notification.requested', 'wf_instance', e.workflow_instance_id, null, e.company_id, { instanceId: e.workflow_instance_id, docType: EXCEPTION_DOC, docId: String(e.id), template: 'pcs.exception.escalated', recipients: [`role:${to}`, `role:${e.owner_role}`, `user:${e.raised_by}`] });
        }
        return { escalated: late.length };
      });
    },
  };

  // ---- the dashboard (FR-07) and the register's export ----
  const dashboard = (actor, { projectId, days = 90 } = {}) => {
    protocol.flush();
    const p = {};
    const scope = scopeSql(actor, p);
    const base = ['e.company_id = :c', 'e.is_active = 1', scope];
    Object.assign(p, { c: actor.companyId });
    if (projectId) { base.push('e.project_id = :pr'); p.pr = projectId; }
    const w = base.join(' AND ');
    const open = db.prepare(`SELECT e.*, c.owner_role FROM pcs_exceptions e JOIN pcs_control_points c ON c.id = e.control_id WHERE ${w} AND e.status IN ('PENDING', 'APPROVED', 'RETURNED')`).all(p);
    const nowMs = Date.parse(protocol.nowIso());
    const age = (e) => Math.floor((nowMs - Date.parse(e.created_at)) / 86_400_000);
    const buckets = [['0 to 7 days', 0, 7], ['8 to 30 days', 8, 30], ['31 to 90 days', 31, 90], ['Over 90 days', 91, 1e9]].map(([label, lo, hi]) => { const m = open.filter((e) => age(e) >= lo && age(e) <= hi); return { label, count: m.length, valueAtRisk: rupees(m.reduce((n, e) => n + e.value_at_risk, 0)).toFixed(2), from: lo, to: hi }; });
    const since = new Date(nowMs - days * 86_400_000).toISOString();
    const trend = db.prepare(`SELECT strftime('%Y-%W', e.created_at) AS week, MIN(substr(e.created_at, 1, 10)) AS from_day, COUNT(*) AS raised, COALESCE(SUM(e.value_at_risk), 0) AS value FROM pcs_exceptions e WHERE ${w} AND e.created_at >= :since GROUP BY week ORDER BY week`).all({ ...p, since }).map((r) => ({ week: r.week, from: r.from_day, raised: r.raised, valueAtRisk: rupees(r.value).toFixed(2) }));
    const failing = db.prepare(`SELECT r.control_code AS control, c.description, c.mode, COUNT(*) AS fails, COALESCE(SUM(r.value_at_risk), 0) AS value FROM pcs_check_results r JOIN pcs_control_points c ON c.id = r.control_id
      WHERE r.company_id = :c AND r.at >= :since AND r.result IN ('BLOCK', 'EXCEPTION_REQUIRED', 'WARN', 'WOULD_BLOCK', 'WOULD_REQUIRE_EXCEPTION', 'WOULD_WARN') ${projectId ? 'AND r.project_id = :pr' : ''} GROUP BY r.control_id ORDER BY fails DESC, r.control_code LIMIT 8`)
      .all({ c: actor.companyId, since, ...(projectId ? { pr: projectId } : {}) }).map((r) => ({ ...r, valueAtRisk: rupees(r.value).toFixed(2) }));
    const byControl = db.prepare(`SELECT e.control_code AS control, COUNT(*) AS n, COALESCE(SUM(e.value_at_risk), 0) AS v FROM pcs_exceptions e WHERE ${w} AND e.status IN ('PENDING', 'APPROVED', 'RETURNED') GROUP BY e.control_code ORDER BY v DESC`).all(p).map((r) => ({ control: r.control, count: r.n, valueAtRisk: rupees(r.v).toFixed(2) }));
    const byUser = db.prepare(`SELECT e.raised_by AS user, COUNT(*) AS n, COALESCE(SUM(e.value_at_risk), 0) AS v FROM pcs_exceptions e WHERE ${w} AND e.created_at >= :since GROUP BY e.raised_by ORDER BY n DESC, v DESC LIMIT 8`).all({ ...p, since }).map((r) => ({ user: r.user, count: r.n, valueAtRisk: rupees(r.v).toFixed(2) }));
    const overdue = open.filter((e) => e.emergency === 1 && e.status === 'PENDING' && e.regularise_by < protocol.nowIso());
    const total = open.reduce((n, e) => n + e.value_at_risk, 0);
    const rollout = db.prepare("SELECT mode, COUNT(*) AS n FROM pcs_control_points WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL GROUP BY mode").all(actor.companyId);
    return {
      tiles: { open: open.length, valueAtRisk: rupees(total).toFixed(2), valueText: formatINR(rupees(total)), emergencyOverdue: overdue.length, awaitingApproval: open.filter((e) => e.status === 'PENDING').length, oldestDays: open.length ? Math.max(...open.map(age)) : 0 },
      trend, topFailing: failing, ageing: buckets, byControl, byUser, rollout: Object.fromEntries(MODES.map((m) => [m, rollout.find((r) => r.mode === m)?.n ?? 0])), projects: db.prepare('SELECT DISTINCT p.id, p.code, p.name FROM pcs_exceptions e JOIN org_projects p ON p.id = e.project_id WHERE e.company_id = ? ORDER BY p.code').all(actor.companyId), days,
    };
  };

  return { controls, reasons, exceptions, dashboard, cycle: (actor, entity, id) => protocol.cycle(actor.companyId, entity, id), protocol, widget: (actor) => { const d = dashboard(actor); return { value: d.tiles.open, valueAtRisk: d.tiles.valueText, overdue: d.tiles.emergencyOverdue }; } };
}

// the evidence files of an exception go through the file service like every other attachment (part 01.05)
fileEntities.register({
  entity: 'pcs_exception', label: 'Control exception',
  resolve(db, actor, id) {
    const e = db.prepare('SELECT * FROM pcs_exceptions WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
    if (!e) return null;
    const authz = authzOf(db);
    let view = e.raised_by === actor.user || authz.check(actor, 'eng.pcs.view', { companyId: e.company_id, projectId: e.project_id, siteId: e.site_id }).allowed;
    if (!view && e.workflow_instance_id) { try { workflowOf(db).get(actor, e.workflow_instance_id); view = true; } catch { /* takes no part in the approval */ } } // an approver sees the evidence
    return { companyId: e.company_id, projectId: e.project_id, siteId: e.site_id, canView: view, canEdit: e.raised_by === actor.user && ['DRAFT', 'RETURNED'].includes(e.status), locked: !['DRAFT', 'RETURNED'].includes(e.status) };
  },
});

evidenceProviders.register(EXCEPTION_DOC, ({ db, instance }) => {
  const e = db.prepare('SELECT * FROM pcs_exceptions WHERE id = ? AND company_id = ?').get(Number(instance.docId), instance.companyId);
  if (!e) return { sections: [] };
  const recent = db.prepare("SELECT exception_no, entity_ref, entity, entity_id, status, value_at_risk FROM pcs_exceptions WHERE company_id = ? AND control_code = ? AND id != ? AND is_active = 1 ORDER BY id DESC LIMIT 5").all(e.company_id, e.control_code, e.id);
  const fails = db.prepare("SELECT COUNT(*) AS n FROM pcs_check_results WHERE company_id = ? AND control_code = ? AND result IN ('EXCEPTION_REQUIRED', 'BLOCK') AND at >= ?").get(e.company_id, e.control_code, new Date(Date.now() - 30 * 86_400_000).toISOString()).n;
  const byUser = db.prepare("SELECT COUNT(*) AS n FROM pcs_exceptions WHERE company_id = ? AND raised_by = ? AND id != ? AND created_at >= ? AND is_active = 1").get(e.company_id, e.raised_by, e.id, new Date(Date.now() - 90 * 86_400_000).toISOString()).n;
  return {
    sections: [
      { code: 'exception', title: 'The exception', kind: 'metrics', items: [
        { label: 'Value at risk', value: rupees(e.value_at_risk), format: 'inr' }, { label: 'Times this control stopped someone in 30 days', value: fails, format: 'number' },
        { label: `Exceptions by ${e.raised_by} in 90 days`, value: byUser, format: 'number', tone: byUser >= 3 ? 'warning' : 'success' }, ...(e.emergency ? [{ label: 'To be regularised by', value: e.regularise_by, format: 'text', tone: 'warning' }] : []),
      ] },
      { code: 'earlier', title: `Earlier exceptions of ${e.control_code}`, kind: 'table', columns: [{ key: 'no', label: 'Number' }, { key: 'for', label: 'For' }, { key: 'status', label: 'Status' }, { key: 'value', label: 'Value at risk', format: 'inr' }],
        rows: recent.map((r) => ({ no: r.exception_no, for: r.entity_ref ?? `${r.entity} ${r.entity_id}`, status: r.status, value: rupees(r.value_at_risk) })) },
    ],
    flags: [...(e.emergency ? [{ code: 'emergency', label: 'Emergency exception: the action has already gone ahead', severity: 'high' }] : []), ...(byUser >= 3 ? [{ code: 'repeat', label: 'The same person raised several exceptions lately', severity: 'medium' }] : [])],
  };
});
