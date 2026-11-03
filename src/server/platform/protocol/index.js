import { writeAudit } from '../audit/index.js';
import { HttpError, unprocessable } from '../http/errors.js';
import { createParameterStore } from '../parameters/index.js';
import { workflowOf } from '../workflow/index.js';
import { toUnits } from '../../../shared/money.js';

/**
 * The Protocol & Control Engine (part 04.04): every controllable activity follows Plan, Verify, Approve, Execute, Record, Monitor, Reconcile, Close. A module
 * defines its control points once, in code, and calls protocol.check() or protocol.enforce() on every path that does the thing (screen, API, import, job, offline
 * sync, AI draft): the check runs inside the caller's transaction, so a blocked action leaves nothing behind.
 *
 *   controlRegistry.define({ code: 'CP-ENG-01', module: 'eng', stage: 'APPROVE', description, enforcement: 'EXCEPTION', thresholds: { maxAmount: 500000 },
 *                            evidenceRequired: true, escalationLevel: 1, ownerRole: 'PROCMGR', emergencyAllowed: true, mode: 'OBSERVE',
 *                            evaluate({ context, thresholds }) -> { pass: boolean, message?, details? } })
 *   protocolOf(db).enforce(actor, 'CP-ENG-01', { entity: 'sample_doc', entityId: 7, amount: 750000, projectId })   // throws when it blocks or needs an exception
 *
 * What a control does depends on its enforcement (BLOCK, EXCEPTION, WARN, MONITOR) and on the mode a company has put it in: OFF does nothing; OBSERVE writes down what
 * would have happened and never affects anyone; WARN lets everything through with a warning; ENFORCE blocks, or asks for an exception that an approval chain decides.
 */
export const STAGES = Object.freeze(['PLAN', 'VERIFY', 'APPROVE', 'EXECUTE', 'RECORD', 'MONITOR', 'RECONCILE', 'CLOSE']);
export const ENFORCEMENTS = Object.freeze(['BLOCK', 'EXCEPTION', 'WARN', 'MONITOR']);
export const MODES = Object.freeze(['OFF', 'OBSERVE', 'WARN', 'ENFORCE']);
export const ACTION_TYPES = Object.freeze(['cancel', 'reject', 'return', 'reverse', 'deviate', 'override']);
export const CONTROL_CODE = /^CP-[A-Z]{2,8}-\d{2,3}$/;
const iso = () => new Date().toISOString();

const defs = new Map();
export const controlRegistry = {
  define(def) {
    if (!CONTROL_CODE.test(def.code ?? '')) throw new Error(`Control point code "${def.code}" must look like CP-ENG-01`);
    if (defs.has(def.code)) throw new Error(`Control point ${def.code} is already defined`);
    if (!STAGES.includes(def.stage)) throw new Error(`Control point ${def.code}: unknown stage ${def.stage}`);
    if (!ENFORCEMENTS.includes(def.enforcement)) throw new Error(`Control point ${def.code}: unknown enforcement ${def.enforcement}`);
    if (typeof def.evaluate !== 'function') throw new Error(`Control point ${def.code} needs an evaluate function`);
    defs.set(def.code, { mode: 'OFF', thresholds: {}, evidenceRequired: false, escalationLevel: 1, emergencyAllowed: false, ...def });
  },
  get: (code) => defs.get(code) ?? null,
  list: () => [...defs.values()].sort((a, b) => a.code.localeCompare(b.code)),
};

const lookup = (obj, path) => String(path).split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);
/** A control written as data: it fails when the condition is true. `threshold` names a value of the control's thresholds to compare with. */
export function violates(cond, context, thresholds) {
  const v = lookup(context, cond.field);
  const t = cond.threshold ? thresholds[cond.threshold] : cond.value;
  if (v === undefined || v === null) return false;
  switch (cond.op) {
    case 'gt': return Number(v) > Number(t);
    case 'gte': return Number(v) >= Number(t);
    case 'lt': return Number(v) < Number(t);
    case 'lte': return Number(v) <= Number(t);
    case 'eq': return v === t || String(v) === String(t);
    case 'ne': return String(v) !== String(t);
    case 'in': return Array.isArray(t) && t.map(String).includes(String(v));
    default: return false;
  }
}

const protocols = new WeakMap();
export function protocolOf(db) {
  let p = protocols.get(db);
  if (!p) { p = createProtocol(db); protocols.set(db, p); }
  return p;
}

function createProtocol(db) {
  const engine = workflowOf(db);
  const params = createParameterStore(db);
  const today = () => engine.clock().toISOString().slice(0, 10);
  const nowIso = () => engine.clock().toISOString();
  const param = (key, companyId) => params.get(key, { companyId, date: today() });
  let queue = [];

  // the control row may have been made inside a transaction that was rolled back (the blocked action), so it is looked up again here
  const insertResult = (r) => db.prepare(`INSERT INTO pcs_check_results (company_id, control_id, control_code, entity, entity_id, result, mode, details_json, check_source, user_id, value_at_risk, at, project_id, site_id, created_by, source_type)
    VALUES (:company, :control, :code, :entity, :entityId, :result, :mode, :details, :source, :user, :value, :at, :project, :site, :user, 'check')`).run({ ...r, control: ensure(r.company, r.code).id });
  /** Results are written when no transaction is open: a blocked action rolls its transaction back, and what the control found must still be on record. */
  function flush() {
    const todo = queue;
    queue = [];
    if (db.isTransaction) { queue = todo; return; }
    for (const r of todo) { try { insertResult(r); } catch { /* the database is closing */ } }
  }
  const record = (r) => {
    if (!db.isTransaction) { insertResult(r); return; }
    queue.push(r);
    queueMicrotask(flush);
  };

  function ensure(companyId, code) {
    let row = db.prepare('SELECT * FROM pcs_control_points WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL').get(companyId, code);
    if (!row) {
      const def = defs.get(code);
      if (!def) return null;
      db.prepare(`INSERT OR IGNORE INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, thresholds_json, evidence_required, escalation_level, mode, owner_role, emergency_allowed, observe_since, mode_changed_at, created_by, source_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'control_definition')`)
        .run(companyId, def.code, def.module, def.stage, def.description, `hook:${def.code}`, def.enforcement, JSON.stringify(def.thresholds), def.evidenceRequired ? 1 : 0, def.escalationLevel, def.mode, def.ownerRole ?? 'SYSADM', def.emergencyAllowed ? 1 : 0, def.mode === 'OBSERVE' ? today() : null, nowIso());
      row = db.prepare('SELECT * FROM pcs_control_points WHERE company_id = ? AND code = ? AND is_active = 1').get(companyId, code);
    }
    return row;
  }
  const thresholdsOf = (row) => ({ ...(defs.get(row.code)?.thresholds ?? {}), ...JSON.parse(row.thresholds_json || '{}') });

  function evaluate(row, actor, context) {
    const thresholds = thresholdsOf(row);
    if (row.rule_ref.startsWith('hook:')) {
      const def = defs.get(row.rule_ref.slice(5));
      if (!def) return { pass: true, message: null, details: { note: 'The rule of this control is not installed' } };
      const out = def.evaluate({ db, actor, context, thresholds, control: row });
      return { pass: out.pass !== false, message: out.message ?? def.description, details: out.details ?? {} };
    }
    const cond = JSON.parse(row.rule_ref.slice(5));
    const bad = violates(cond, context, thresholds);
    return { pass: !bad, message: row.description, details: { field: cond.field, value: lookup(context, cond.field) ?? null, limit: cond.threshold ? thresholds[cond.threshold] : cond.value } };
  }

  /** An approved exception for this very object, not yet used and not too old; or an emergency one still inside its time to be regularised. */
  function usableException(companyId, code, entity, entityId) {
    const days = param('eng.pcs.exception_valid_days', companyId);
    const since = new Date(engine.clock().getTime() - days * 86_400_000).toISOString();
    return db.prepare(`SELECT * FROM pcs_exceptions WHERE company_id = ? AND control_code = ? AND entity = ? AND entity_id = ? AND is_active = 1 AND used_at IS NULL
      AND ((status = 'APPROVED' AND decided_at >= ?) OR (emergency = 1 AND status = 'PENDING' AND regularise_by >= ?)) ORDER BY id DESC LIMIT 1`).get(companyId, code, entity, String(entityId), since, nowIso());
  }

  function markStage(companyId, entity, entityId, stage, controlCode, by) {
    db.prepare("INSERT OR IGNORE INTO pcs_cycle_stages (company_id, entity, entity_id, stage, control_code, done_at, done_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cycle')")
      .run(companyId, entity, String(entityId), stage, controlCode ?? null, nowIso(), by ?? null, by ?? 'system');
  }

  /**
   * Evaluate a control for an action. Returns { outcome: 'pass' | 'warn' | 'block' | 'exception_required', result, mode, message, details, observed, exceptionId }.
   * `consume` marks the exception that lets the action through as used (enforce() does it); a plain check only looks.
   * @param {any} actor @param {string} code @param {any} context @param {any} [opts]
   */
  function check(actor, code, context, { consume = false, source } = {}) {
    if (!actor?.companyId) throw unprocessable('A control is checked for a company.');
    const entity = String(context?.entity ?? '');
    const entityId = String(context?.entityId ?? '');
    if (!entity || !entityId) throw new Error('protocol.check needs context.entity and context.entityId');
    const row = ensure(actor.companyId, code);
    if (!row) throw unprocessable(`The control point ${code} is not defined.`);
    const base = { control: code, mode: row.mode, enforcement: row.enforcement, stage: row.stage };
    if (row.mode === 'OFF') return { ...base, outcome: 'pass', result: 'PASS', message: null, details: {}, logged: false };
    const verdict = evaluate(row, actor, context);
    const value = toUnits(Number(context.valueAtRisk ?? context.amount ?? 0) || 0, 'money');
    const log = (result, extra = {}) => record({ company: actor.companyId, control: row.id, code, entity, entityId, result, mode: row.mode, details: JSON.stringify({ message: verdict.message, ...verdict.details, ref: context.ref ?? verdict.details?.ref ?? null, ...extra }), source: source ?? context.source ?? 'api', user: actor.user ?? null, value, at: nowIso(), project: context.projectId ?? null, site: context.siteId ?? null });
    if (verdict.pass) {
      const pct = param('eng.pcs.pass_sample_percent', actor.companyId);
      if (pct >= 100 || (pct > 0 && Math.random() * 100 < pct)) log('PASS');
      markStage(actor.companyId, entity, entityId, row.stage, code, actor.user);
      return { ...base, outcome: 'pass', result: 'PASS', message: null, details: verdict.details };
    }
    const out = { ...base, message: verdict.message, details: verdict.details, evidenceRequired: row.evidence_required === 1, escalationLevel: row.escalation_level, emergencyAllowed: row.emergency_allowed === 1, valueAtRisk: value };
    const enf = row.enforcement;
    if (enf === 'MONITOR') { log('MONITORED'); return { ...out, outcome: 'pass', result: 'MONITORED' }; }
    if (row.mode === 'OBSERVE') {
      const would = enf === 'BLOCK' ? 'WOULD_BLOCK' : enf === 'EXCEPTION' ? 'WOULD_REQUIRE_EXCEPTION' : 'WOULD_WARN';
      log(would);
      return { ...out, outcome: 'pass', result: would, observed: true };
    }
    if (row.mode === 'WARN' || enf === 'WARN') { log('WARN'); return { ...out, outcome: 'warn', result: 'WARN' }; }
    if (enf === 'BLOCK') { log('BLOCK'); return { ...out, outcome: 'block', result: 'BLOCK' }; }
    // ENFORCE with an exception: look for one that lets this very action through
    const ex = usableException(actor.companyId, code, entity, entityId);
    if (ex) {
      if (consume) {
        db.prepare("UPDATE pcs_exceptions SET used_at = ?, used_by = ?, status = CASE WHEN status = 'APPROVED' THEN 'USED' ELSE status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, actor.user, nowIso(), ex.id);
        writeAudit(db, { entity: 'pcs_exceptions', entityId: ex.id, action: 'use', newValues: { control: code, entity, entityId }, actor: actor.user, companyId: actor.companyId });
      }
      log('EXCEPTED', { exception: ex.exception_no });
      markStage(actor.companyId, entity, entityId, row.stage, code, actor.user);
      return { ...out, outcome: 'pass', result: 'EXCEPTED', exceptionId: ex.id, exceptionNo: ex.exception_no };
    }
    log('EXCEPTION_REQUIRED');
    return { ...out, outcome: 'exception_required', result: 'EXCEPTION_REQUIRED' };
  }

  /** Check and act: a block or a missing exception stops the action with an error the screens know how to turn into a dialog; a warning is returned for the caller to show. */
  function enforce(actor, code, context, opts = {}) {
    const r = check(actor, code, context, { ...opts, consume: true });
    if (r.outcome === 'block') throw new HttpError(422, 'CONTROL_BLOCKED', `${r.message} (control ${code}). This cannot go ahead.`, [{ field: 'control', message: code }]);
    if (r.outcome === 'exception_required') {
      const d = (field, message) => ({ field, message: String(message) });
      throw new HttpError(422, 'EXCEPTION_REQUIRED', `${r.message} (control ${code}). It can go ahead only with an approved exception.`, [d('control', code), d('entity', context.entity), d('entityId', context.entityId), d('evidenceRequired', r.evidenceRequired), d('escalationLevel', r.escalationLevel), d('emergencyAllowed', r.emergencyAllowed)]);
    }
    return r;
  }

  function cycle(companyId, entity, entityId) {
    const done = new Map(db.prepare('SELECT stage, control_code AS code, done_at AS at, done_by AS by FROM pcs_cycle_stages WHERE company_id = ? AND entity = ? AND entity_id = ?').all(companyId, entity, String(entityId)).map((r) => [r.stage, r]));
    const last = db.prepare('SELECT control_code AS code, result, MAX(id) AS id FROM pcs_check_results WHERE company_id = ? AND entity = ? AND entity_id = ? GROUP BY control_code').all(companyId, entity, String(entityId));
    return STAGES.map((stage) => ({ stage, done: done.has(stage), doneAt: done.get(stage)?.at ?? null, doneBy: done.get(stage)?.by ?? null, controls: last.map((l) => ({ ...l, stage: defs.get(l.code)?.stage })).filter((l) => l.stage === stage).map(({ code, result }) => ({ code, result })) }));
  }

  return { check, enforce, ensure, markStage, cycle, flush, thresholdsOf, usableException, param, today, nowIso, flushIfIdle: () => flush() };
}
