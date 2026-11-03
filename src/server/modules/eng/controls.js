import { inTransaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf, ROLE_TEMPLATES } from '../../platform/authz/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { isWorkingDay } from '../core/holidays/service.js';
import { toUnits } from '../../../shared/money.js';
import { AUTHORITY_DOC, BIG_LIMIT_RUPEES, CONFIG_DOC, DELEGATION_DOC } from './changes.js';
import { DEFAULT_LIMITS, DEFAULT_MATRICES } from './matrix-defaults.js';

// Authority limits, the escalation hierarchy, SLA settings with the working-hours calendar, and delegations (part 04.02).
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));
const iso = () => new Date().toISOString();
const day = () => iso().slice(0, 10);
const SCOPES = ['COMPANY', 'DEPARTMENT', 'PROJECT'];

/** The management hierarchy of the reference (FR-07): Site, Project, Regional, Head Office, Director. Each level lists the roles that answer there. */
export const DEFAULT_LEVELS = [
  { level: 'Site', roles: ['CM', 'SE'] },
  { level: 'Project', roles: ['PM'] },
  { level: 'Regional', roles: ['PD'] },
  { level: 'Head office', roles: ['PCMGR', 'COMMGR'] },
  { level: 'Director', roles: ['DIR'] },
];
/** The time allowed for a step by kind of document, in working hours (reference A: 24 h; payments 8 h; site safety 2 h). */
export const DEFAULT_SLA = { sla: 24, remind: 50, escalate: 100, second: 200 };
const SLA_BY_DOC = { PAY: 8, PTW: 2 };
const asBatch = (db, table, ids) => { const batch = Math.min(...ids); for (const id of ids) db.prepare(`UPDATE ${table} SET batch_id = ? WHERE id = ?`).run(batch, id); return batch; };

// ================================================================ authority limits
export function createLimitService({ db, engine }) {
  const authz = authzOf(db);
  const mustManage = (actor) => { if (!authz.check(actor, 'eng.matrix.manage').allowed) throw forbidden('Only someone who maintains the approval matrix (eng.matrix.manage) can do this.'); };
  const asOf = (companyId, role, docType, date) => db.prepare(`SELECT * FROM wf_authority_limits WHERE company_id = ? AND role_code = ? AND doc_type = ? AND status IN ('ACTIVE', 'RETIRED') AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY effective_from DESC, id DESC LIMIT 1`).get(companyId, role, docType, date, date);
  const seeded = new Set();
  return {
    ensureDefaults(companyId) {
      if (seeded.has(companyId)) return;
      if (!db.prepare('SELECT 1 FROM wf_authority_limits WHERE company_id = ? LIMIT 1').get(companyId)) {
        for (const l of DEFAULT_LIMITS) db.prepare("INSERT INTO wf_authority_limits (company_id, role_code, doc_type, max_amount, status, effective_from, created_by, source_type) VALUES (?, ?, ?, ?, 'ACTIVE', '2000-01-01', 'system', 'default_limit')").run(companyId, l.role, l.docType, l.max == null ? null : l.max * 100);
      }
      seeded.add(companyId);
    },
    /** What a role may approve for a document type on a date, in paise; null when it has no limit (none is set, or it is set to unlimited). */
    limitFor({ companyId, role, docType, date = day() }) {
      this.ensureDefaults(companyId);
      const r = asOf(companyId, role, docType, date);
      return r ? r.max_amount : null;
    },
    /** Has the role been given authority for this document type at all (a limit row, however high)? A role without one is never chosen to take over a step. */
    hasAuthority({ companyId, role, docType, date = day() }) {
      this.ensureDefaults(companyId);
      return Boolean(asOf(companyId, role, docType, date));
    },
    /** The grid: every role with a limit, by document type, with what is waiting for approval. */
    grid(actor) {
      this.ensureDefaults(actor.companyId);
      const rows = db.prepare("SELECT * FROM wf_authority_limits WHERE company_id = ? AND is_active = 1 AND status IN ('ACTIVE', 'PENDING') ORDER BY doc_type, role_code, effective_from DESC").all(actor.companyId);
      const date = day();
      const cells = new Map();
      for (const r of rows) {
        const key = `${r.role_code}|${r.doc_type}`;
        const cell = cells.get(key) ?? { role: r.role_code, docType: r.doc_type, current: null, hasLimit: false, pending: null };
        if (r.status === 'ACTIVE' && r.effective_from <= date && (!r.effective_to || r.effective_to >= date) && !cell.hasLimit) { cell.current = r.max_amount == null ? null : r.max_amount / 100; cell.hasLimit = true; cell.effectiveFrom = r.effective_from; }
        if (r.status === 'PENDING') cell.pending = { maxAmount: r.max_amount == null ? null : r.max_amount / 100, effectiveFrom: r.effective_from, batchId: r.batch_id };
        cells.set(key, cell);
      }
      const docTypes = [...new Set([...DEFAULT_MATRICES.map((d) => d.docType), ...workflowTypes.list().map((t) => t.docType)])].filter((d) => !d.startsWith('WF_') && !d.startsWith('LEGACY_'));
      return { cells: [...cells.values()], roles: [...new Set([...cells.values()].map((c) => c.role))].sort(), docTypes: docTypes.sort(), allRoles: ROLE_TEMPLATES.map((r) => r.code).sort() };
    },
    /** @param {any} actor @param {any} [o] */
    history(actor, { docType, role, limit = 50, offset = 0 } = {}) {
      this.ensureDefaults(actor.companyId);
      const where = ['company_id = :c', 'is_active = 1'];
      const p = { c: actor.companyId };
      if (docType) { where.push('doc_type = :d'); p.d = docType; }
      if (role) { where.push('role_code = :r'); p.r = role; }
      const rows = db.prepare(`SELECT * FROM wf_authority_limits WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all({ ...p, limit, offset });
      return rows.map((r) => ({ id: r.id, role: r.role_code, docType: r.doc_type, maxAmount: r.max_amount == null ? null : r.max_amount / 100, status: r.status, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, batchId: r.batch_id, reason: r.reason, createdBy: r.created_by, createdAt: r.created_at }));
    },
    /** Ask for a set of changes at once; they take effect together, from a date, when the chain has approved them. */
    propose(actor, { changes, effectiveFrom, reason }) {
      mustManage(actor);
      this.ensureDefaults(actor.companyId);
      return inTransaction(db, () => {
        if (effectiveFrom < day()) throw unprocessable('A change takes effect from today or a later date.');
        if (db.prepare("SELECT 1 FROM wf_authority_limits WHERE company_id = ? AND status = 'PENDING'").get(actor.companyId)) throw conflict('Another change of authority limits is waiting for approval. Ask for it to be decided first.');
        const seen = new Set();
        const ids = [];
        let top = 0;
        for (const [i, c] of changes.entries()) {
          if (!ROLE_CODES.has(c.role)) throw badRequest('Some changes are not valid.', [{ field: `changes.${i}.role`, message: `${c.role} is not a role of the catalogue` }]);
          const key = `${c.role}|${c.docType}`;
          if (seen.has(key)) throw badRequest('Some changes are not valid.', [{ field: `changes.${i}.docType`, message: 'the same role and document type appear twice' }]);
          seen.add(key);
          const paise = c.maxAmount == null ? null : toUnits(c.maxAmount, 'money');
          const current = asOf(actor.companyId, c.role, c.docType, day());
          if (current && current.max_amount === paise) throw unprocessable(`${c.role} already has that limit for ${c.docType}.`, [{ field: `changes.${i}.maxAmount`, message: 'is the limit in force' }]);
          top = Math.max(top, paise == null ? BIG_LIMIT_RUPEES * 10 : paise / 100);
          ids.push(Number(db.prepare("INSERT INTO wf_authority_limits (company_id, role_code, doc_type, max_amount, status, effective_from, reason, created_by, source_type) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, 'limit_editor')").run(actor.companyId, c.role, c.docType, paise, effectiveFrom, reason, actor.user).lastInsertRowid));
        }
        const batch = asBatch(db, 'wf_authority_limits', ids);
        const instance = engine.submit(actor, { docType: AUTHORITY_DOC, docId: String(batch), comment: reason, context: { owner: 'CFO', maxAmount: top, effectiveFrom, changes: changes.length } });
        writeAudit(db, { entity: 'wf_authority_limits', entityId: batch, action: 'propose', newValues: { changes: changes.length, effectiveFrom }, reason, actor: actor.user });
        return { batchId: batch, instance };
      });
    },
  };
}

// ================================================================ escalation paths and the working-hours calendar
export function createPathService({ db, engine }) {
  const authz = authzOf(db);
  const mustManage = (actor) => { if (!authz.check(actor, 'eng.matrix.manage').allowed) throw forbidden('Only someone who maintains the approval matrix (eng.matrix.manage) can do this.'); };
  const seeded = new Set();
  const pathFor = (companyId, projectId, date = day()) => {
    const find = (type, id) => db.prepare(`SELECT * FROM wf_escalation_paths WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND status IN ('ACTIVE', 'RETIRED') AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY effective_from DESC, id DESC LIMIT 1`).get(companyId, type, id, date, date);
    return (projectId ? find('PROJECT', projectId) : null) ?? find('COMPANY', 0);
  };
  const levelsOf = (companyId, projectId) => { const p = pathFor(companyId, projectId); return p ? JSON.parse(p.levels_json) : DEFAULT_LEVELS; };
  const indexOf = (levels, role) => levels.findIndex((l) => l.roles.includes(role));
  return {
    ensureDefaults(companyId) {
      if (seeded.has(companyId)) return;
      if (!db.prepare('SELECT 1 FROM wf_escalation_paths WHERE company_id = ? LIMIT 1').get(companyId)) {
        db.prepare("INSERT INTO wf_escalation_paths (company_id, scope_type, scope_id, levels_json, status, effective_from, created_by, source_type) VALUES (?, 'COMPANY', 0, ?, 'ACTIVE', '2000-01-01', 'system', 'default_path')").run(companyId, JSON.stringify(DEFAULT_LEVELS));
      }
      seeded.add(companyId);
    },
    /** The first role above `fromRole` in the hierarchy for which `enough` holds (used when a role's authority limit is below the amount). */
    climb({ companyId, projectId, fromRole, enough }) {
      this.ensureDefaults(companyId);
      const levels = levelsOf(companyId, projectId);
      const from = indexOf(levels, fromRole);
      for (let i = from + 1; i < levels.length; i += 1) for (const r of levels[i].roles) if (enough(r)) return r;
      return null;
    },
    /** Who a late task climbs to: level 1 is the next level above where it is, level 2 the top of the hierarchy (the director). */
    next({ companyId, projectId, fromRole, level }) {
      this.ensureDefaults(companyId);
      const levels = levelsOf(companyId, projectId);
      if (level >= 2) { const top = levels[levels.length - 1]; return { role: top.roles[0], levelName: top.level }; }
      const from = fromRole ? indexOf(levels, String(fromRole).split('|')[0]) : 0;
      const target = levels[Math.min(from + 1, levels.length - 1)];
      return target ? { role: target.roles[0], levelName: target.level } : null;
    },
    list(actor) {
      this.ensureDefaults(actor.companyId);
      return db.prepare("SELECT * FROM wf_escalation_paths WHERE company_id = ? AND is_active = 1 AND status IN ('ACTIVE', 'PENDING') ORDER BY scope_type, scope_id, effective_from DESC").all(actor.companyId)
        .map((p) => ({ id: p.id, scopeType: p.scope_type, scopeId: p.scope_id || null, levels: JSON.parse(p.levels_json), status: p.status, effectiveFrom: p.effective_from, effectiveTo: p.effective_to, batchId: p.batch_id, createdBy: p.created_by }));
    },
    propose(actor, { scopeType = 'COMPANY', scopeId = 0, levels, effectiveFrom, reason }) {
      mustManage(actor);
      this.ensureDefaults(actor.companyId);
      return inTransaction(db, () => {
        if (effectiveFrom < day()) throw unprocessable('A change takes effect from today or a later date.');
        if (!SCOPES.includes(scopeType)) throw badRequest('Choose the company, a department or a project.', [{ field: 'scopeType', message: 'is not valid' }]);
        if (scopeType !== 'COMPANY') { const t = scopeType === 'PROJECT' ? 'org_projects' : 'org_departments'; if (!db.prepare(`SELECT 1 FROM ${t} WHERE id = ? AND company_id = ?`).get(scopeId, actor.companyId)) throw unprocessable(`That ${scopeType.toLowerCase()} does not exist in your company.`); }
        const problems = [];
        levels.forEach((l, i) => l.roles.forEach((r) => { if (!ROLE_CODES.has(r)) problems.push({ field: `levels.${i}.roles`, message: `${r} is not a role of the catalogue` }); }));
        const all = levels.flatMap((l) => l.roles);
        if (new Set(all).size !== all.length) problems.push({ field: 'levels', message: 'a role can stand at one level only' });
        if (problems.length) throw badRequest('The hierarchy is not valid.', problems);
        if (db.prepare("SELECT 1 FROM wf_escalation_paths WHERE company_id = ? AND status = 'PENDING'").get(actor.companyId) || db.prepare("SELECT 1 FROM wf_sla_settings WHERE company_id = ? AND status = 'PENDING'").get(actor.companyId)) throw conflict('Another change of escalation or SLA settings is waiting for approval. Ask for it to be decided first.');
        const id = Number(db.prepare("INSERT INTO wf_escalation_paths (company_id, scope_type, scope_id, levels_json, status, effective_from, reason, created_by, source_type) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, 'path_editor')").run(actor.companyId, scopeType, scopeType === 'COMPANY' ? 0 : scopeId, JSON.stringify(levels), effectiveFrom, reason, actor.user).lastInsertRowid);
        const batch = asBatch(db, 'wf_escalation_paths', [id]);
        const instance = engine.submit(actor, { docType: CONFIG_DOC, docId: String(batch), comment: reason, context: { owner: 'CFO', maxAmount: 0, effectiveFrom } });
        writeAudit(db, { entity: 'wf_escalation_paths', entityId: batch, action: 'propose', newValues: { scopeType, levels: levels.length }, reason, actor: actor.user });
        return { batchId: batch, instance };
      });
    },
  };
}

// ================================================================ SLA settings and the calendar
export function createSlaService({ db, engine }) {
  const authz = authzOf(db);
  const store = createParameterStore(db);
  const mustManage = (actor) => { if (!authz.check(actor, 'eng.matrix.manage').allowed) throw forbidden('Only someone who maintains the approval matrix (eng.matrix.manage) can do this.'); };
  const seeded = new Set();
  const asOf = (companyId, docType, date) => db.prepare(`SELECT * FROM wf_sla_settings WHERE company_id = ? AND doc_type = ? AND status IN ('ACTIVE', 'RETIRED') AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY effective_from DESC, id DESC LIMIT 1`).get(companyId, docType, date, date);
  const param = (key, companyId, fallback) => { try { return Number(store.get(key, { companyId, date: day() })); } catch { return fallback; } };
  const IST = 330 * 60_000;

  /**
   * Add working time to an instant: only the hours between the start and the end of the working day (IST), on days that are neither a weekly off nor a holiday of the
   * company (calendar of part 01.03). Returns an ISO instant.
   */
  function addWorkingMinutes(companyId, fromDate, minutes, siteId = null) {
    const startH = param('eng.workflow.working_day_start_hour', companyId, 9);
    const endH = param('eng.workflow.working_day_end_hour', companyId, 18);
    let t = new Date(fromDate.getTime() + IST); // clock time in IST, read with the UTC getters
    let left = Math.round(minutes);
    for (let guard = 0; guard < 400 && left > 0; guard += 1) {
      const dateStr = t.toISOString().slice(0, 10);
      const working = isWorkingDay(db, store, { companyId, date: dateStr, siteId });
      const startMs = Date.parse(`${dateStr}T${String(startH).padStart(2, '0')}:00:00Z`);
      const endMs = Date.parse(`${dateStr}T${String(endH).padStart(2, '0')}:00:00Z`);
      if (!working || t.getTime() >= endMs) { t = new Date(Date.parse(`${dateStr}T${String(startH).padStart(2, '0')}:00:00Z`) + 86_400_000); continue; }
      if (t.getTime() < startMs) t = new Date(startMs);
      const room = Math.floor((endMs - t.getTime()) / 60_000);
      const use = Math.min(room, left);
      t = new Date(t.getTime() + use * 60_000);
      left -= use;
    }
    return new Date(t.getTime() - IST).toISOString();
  }
  return {
    addWorkingMinutes,
    ensureDefaults(companyId) {
      if (seeded.has(companyId)) return;
      if (!db.prepare('SELECT 1 FROM wf_sla_settings WHERE company_id = ? LIMIT 1').get(companyId)) {
        db.prepare("INSERT INTO wf_sla_settings (company_id, doc_type, sla_hours, remind_pct, escalate_pct, second_pct, status, effective_from, created_by, source_type) VALUES (?, '*', ?, ?, ?, ?, 'ACTIVE', '2000-01-01', 'system', 'default_sla')").run(companyId, DEFAULT_SLA.sla, DEFAULT_SLA.remind, DEFAULT_SLA.escalate, DEFAULT_SLA.second);
        for (const [docType, hours] of Object.entries(SLA_BY_DOC)) db.prepare("INSERT INTO wf_sla_settings (company_id, doc_type, sla_hours, remind_pct, escalate_pct, second_pct, status, effective_from, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', '2000-01-01', 'system', 'default_sla')").run(companyId, docType, hours, DEFAULT_SLA.remind, DEFAULT_SLA.escalate, DEFAULT_SLA.second);
      }
      seeded.add(companyId);
    },
    settingsFor(companyId, docType, date = day()) {
      this.ensureDefaults(companyId);
      const s = asOf(companyId, docType, date) ?? asOf(companyId, '*', date);
      return s ? { hours: s.sla_hours, remind: s.remind_pct, escalate: s.escalate_pct, second: s.second_pct } : { hours: DEFAULT_SLA.sla, remind: 50, escalate: 100, second: 200 };
    },
    /** The points in a task's time (engine hook): the reminder, the due time and the second escalation, in working hours from the moment it is made. */
    forTask({ companyId, docType, step, from }) {
      const s = this.settingsFor(companyId, docType);
      const hours = step.slaHours ?? s.hours;
      const at = (pct) => addWorkingMinutes(companyId, from, hours * 60 * (pct / 100));
      return { hours, dueAt: at(s.escalate), remindAt: at(s.remind), secondAt: at(s.second) };
    },
    list(actor) {
      this.ensureDefaults(actor.companyId);
      return db.prepare("SELECT * FROM wf_sla_settings WHERE company_id = ? AND is_active = 1 AND status IN ('ACTIVE', 'PENDING') ORDER BY doc_type, effective_from DESC").all(actor.companyId)
        .map((s) => ({ id: s.id, docType: s.doc_type, hours: s.sla_hours, remindPct: s.remind_pct, escalatePct: s.escalate_pct, secondPct: s.second_pct, status: s.status, effectiveFrom: s.effective_from, batchId: s.batch_id }));
    },
    propose(actor, { settings, effectiveFrom, reason }) {
      mustManage(actor);
      this.ensureDefaults(actor.companyId);
      return inTransaction(db, () => {
        if (effectiveFrom < day()) throw unprocessable('A change takes effect from today or a later date.');
        if (db.prepare("SELECT 1 FROM wf_escalation_paths WHERE company_id = ? AND status = 'PENDING'").get(actor.companyId) || db.prepare("SELECT 1 FROM wf_sla_settings WHERE company_id = ? AND status = 'PENDING'").get(actor.companyId)) throw conflict('Another change of escalation or SLA settings is waiting for approval. Ask for it to be decided first.');
        const ids = [];
        settings.forEach((s, i) => {
          if (!(s.docType === '*' || DEFAULT_MATRICES.some((d) => d.docType === s.docType) || workflowTypes.get(s.docType))) throw badRequest('Some settings are not valid.', [{ field: `settings.${i}.docType`, message: `${s.docType} is not a document type` }]);
          if (!(s.remindPct < s.escalatePct && s.escalatePct <= s.secondPct)) throw badRequest('Some settings are not valid.', [{ field: `settings.${i}.remindPct`, message: 'the reminder comes before the escalation, and the second escalation is not before the first' }]);
          ids.push(Number(db.prepare("INSERT INTO wf_sla_settings (company_id, doc_type, sla_hours, remind_pct, escalate_pct, second_pct, status, effective_from, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'sla_editor')").run(actor.companyId, s.docType, s.hours, s.remindPct, s.escalatePct, s.secondPct, effectiveFrom, reason, actor.user).lastInsertRowid));
        });
        const batch = asBatch(db, 'wf_sla_settings', ids);
        const instance = engine.submit(actor, { docType: CONFIG_DOC, docId: String(batch), comment: reason, context: { owner: 'CFO', maxAmount: 0, effectiveFrom } });
        writeAudit(db, { entity: 'wf_sla_settings', entityId: batch, action: 'propose', newValues: { settings: settings.length }, reason, actor: actor.user });
        return { batchId: batch, instance };
      });
    },
  };
}

// ================================================================ delegations
const CLEARANCE = ['public', 'internal', 'confidential', 'restricted'];
export function createDelegationService({ db, engine, limits }) {
  const authz = authzOf(db);
  const store = createParameterStore(db);
  const present = (d) => ({ id: d.id, delegator: d.delegator, delegate: d.delegate, docTypes: JSON.parse(d.doc_types_json), maxAmount: d.max_amount == null ? null : d.max_amount / 100, from: d.from_date, to: d.to_date, reason: d.reason, status: d.status, instanceId: d.instance_id, days: Math.round((Date.parse(d.to_date) - Date.parse(d.from_date)) / 86_400_000) + 1, createdAt: d.created_at, revokedBy: d.revoked_by, version: d.version });
  const load = (actor, id) => { const d = db.prepare('SELECT * FROM wf_delegations WHERE id = ? AND is_active = 1').get(id); if (!d || d.company_id !== actor.companyId) throw notFound('That delegation does not exist.'); return d; };
  const isAdmin = (actor) => authz.check(actor, 'eng.delegation.admin').allowed;
  const mayUse = (actor) => { if (!authz.check(actor, 'eng.delegation.use').allowed) throw forbidden('You may not delegate approvals (eng.delegation.use).'); };
  const approvalDays = (companyId) => { try { return Number(store.get('eng.delegation.approval_days', { companyId, date: day() })); } catch { return 15; } };
  const rank = (actor, companyId, userId) => { try { return CLEARANCE.indexOf(authz.resolve({ companyId, userId, roles: [] }).clearance ?? 'internal'); } catch { return 1; } };

  return {
    present,
    /** The delegations in force on a date that make this person the delegate (engine hook). docType null: for any document type. */
    activeFor({ companyId, delegate, docType, date = day() }) {
      return db.prepare("SELECT * FROM wf_delegations WHERE company_id = ? AND delegate = ? AND status = 'ACTIVE' AND is_active = 1 AND from_date <= ? AND to_date >= ?").all(companyId, delegate, date, date)
        .map((d) => ({ id: d.id, delegator: d.delegator, delegate: d.delegate, delegatorRoles: JSON.parse(d.delegator_roles_json), maxAmount: d.max_amount, docTypes: JSON.parse(d.doc_types_json) }))
        .filter((d) => docType == null || d.docTypes.length === 0 || d.docTypes.includes(docType));
    },
    /** The delegation that moves this person's tasks to someone else on a date (engine hook). */
    forUser({ companyId, user, docType, date = day(), amount = null }) {
      const d = db.prepare("SELECT * FROM wf_delegations WHERE company_id = ? AND delegator = ? AND status = 'ACTIVE' AND is_active = 1 AND from_date <= ? AND to_date >= ? ORDER BY id DESC").all(companyId, user, date, date)
        .find((x) => { const t = JSON.parse(x.doc_types_json); return (t.length === 0 || t.includes(docType)) && (x.max_amount == null || amount == null || amount <= x.max_amount); });
      return d ? { delegate: d.delegate, id: d.id } : null;
    },
    /** @param {any} actor @param {any} [o] */
    list(actor, { scope = 'mine', status, limit = 25, offset = 0 } = {}) {
      const where = ['company_id = :c', 'is_active = 1'];
      const p = { c: actor.companyId };
      if (scope === 'all') { if (!isAdmin(actor)) throw forbidden('Only an administrator of delegations (eng.delegation.admin) sees everyone\'s delegations.'); } else { where.push('(delegator = :u OR delegate = :u)'); p.u = actor.user; }
      if (status) { where.push('status = :s'); p.s = status; }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM wf_delegations WHERE ${where.join(' AND ')}`).get(p).n;
      const rows = db.prepare(`SELECT * FROM wf_delegations WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all({ ...p, limit, offset });
      return { rows: rows.map(present), total, canSeeAll: isAdmin(actor) };
    },
    get(actor, id) {
      const d = load(actor, id);
      if (d.delegator !== actor.user && d.delegate !== actor.user && !isAdmin(actor)) throw notFound('That delegation does not exist.');
      return present(d);
    },
    create(actor, { delegate, docTypes = [], from, to, reason, maxAmount, onBehalfOf }) {
      mayUse(actor);
      return inTransaction(db, () => {
        const delegator = onBehalfOf && onBehalfOf !== actor.user ? onBehalfOf : actor.user;
        if (delegator !== actor.user && !isAdmin(actor)) throw forbidden('Only an administrator of delegations can delegate for someone else.');
        if (delegate === delegator) throw unprocessable('You cannot delegate to yourself.');
        if (from < day()) throw unprocessable('A delegation starts today or later.');
        if (to < from) throw badRequest('The delegation must end on or after the day it starts.', [{ field: 'to', message: 'is before the start' }]);
        if (engine.iamMode(actor.companyId)) {
          const person = db.prepare("SELECT id FROM iam_users WHERE company_id = ? AND username = ? AND status = 'ACTIVE' AND is_active = 1").get(actor.companyId, delegate);
          const mine = db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(actor.companyId, delegator);
          if (!person) throw unprocessable(`${delegate} is not an active person of this company.`, [{ field: 'delegate', message: 'is not an active person' }]);
          // BR-03: not to someone who may not read what the delegator reads
          if (mine && rank(actor, actor.companyId, person.id) < rank(actor, actor.companyId, mine.id)) throw unprocessable(`${delegate} has a lower clearance than you, so they could not read the confidential documents you decide. Choose someone with the same clearance or higher.`, [{ field: 'delegate', message: 'has a lower clearance' }]);
        }
        // BR-03: not to someone who raised a document the delegator is about to decide (the engine would refuse them at the task, and the segregation of duties would be broken)
        const clash = db.prepare("SELECT i.doc_ref, i.doc_id FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE t.company_id = ? AND t.status = 'OPEN' AND t.superseded = 0 AND (t.assignee_user_id = ?) AND i.submitted_by = ? LIMIT 1").get(actor.companyId, delegator, delegate);
        if (clash) throw unprocessable(`${delegate} raised ${clash.doc_ref ?? clash.doc_id}, which waits for ${delegator}; they cannot decide on their own document. Choose someone else.`, [{ field: 'delegate', message: 'raised a document waiting for the delegator' }]);
        // the delegate cannot be given more than the delegator may approve
        const roles = [...(actor.roles ?? [])];
        let cap = maxAmount == null ? null : toUnits(maxAmount, 'money');
        const types = docTypes.length ? docTypes : null;
        if (types) for (const t of types) { const own = roles.map((r) => limits.limitFor({ companyId: actor.companyId, role: r, docType: t })).filter((x) => x != null); if (own.length === roles.length && own.length > 0) { const top = Math.max(...own); if (cap != null && cap > top) throw unprocessable(`You may approve up to ${top / 100} for ${t}, so you cannot delegate more.`, [{ field: 'maxAmount', message: 'is above your own limit' }]); if (cap == null) cap = cap ?? null; } }
        const long = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > approvalDays(actor.companyId);
        const id = Number(db.prepare("INSERT INTO wf_delegations (company_id, delegator, delegate, doc_types_json, delegator_roles_json, max_amount, from_date, to_date, reason, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delegation')")
          .run(actor.companyId, delegator, delegate, JSON.stringify(docTypes), JSON.stringify(roles), cap, from, to, reason, long ? 'PENDING' : 'ACTIVE', actor.user).lastInsertRowid);
        let instance = null;
        if (long) {
          instance = engine.submit({ ...actor, user: delegator }, { docType: DELEGATION_DOC, docId: String(id), comment: reason, context: { days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 } });
          db.prepare('UPDATE wf_delegations SET instance_id = ? WHERE id = ?').run(instance.id, id);
        }
        writeAudit(db, { entity: 'wf_delegations', entityId: id, action: 'create', newValues: { delegator, delegate, from, to, docTypes, status: long ? 'PENDING' : 'ACTIVE' }, reason, actor: actor.user });
        return { delegation: present(db.prepare('SELECT * FROM wf_delegations WHERE id = ?').get(id)), instance };
      });
    },
    revoke(actor, id, { reason }) {
      return inTransaction(db, () => {
        const d = load(actor, id);
        if (d.delegator !== actor.user && !isAdmin(actor)) throw forbidden('Only the person who delegated, or an administrator of delegations, can end a delegation.');
        if (!['PENDING', 'ACTIVE'].includes(d.status)) throw unprocessable(`This delegation is ${d.status.toLowerCase()}.`);
        if (d.instance_id && d.status === 'PENDING') engine.abandon(actor.companyId, d.instance_id, actor.user, 'CANCELLED', reason);
        db.prepare("UPDATE wf_delegations SET status = 'REVOKED', revoked_by = ?, revoked_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), actor.user, iso(), id);
        writeAudit(db, { entity: 'wf_delegations', entityId: id, action: 'revoke', reason, actor: actor.user });
        return present(db.prepare('SELECT * FROM wf_delegations WHERE id = ?').get(id));
      });
    },
  };
}
