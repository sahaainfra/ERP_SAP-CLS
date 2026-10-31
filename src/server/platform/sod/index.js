import { authzOf } from '../authz/index.js';
import { publishEvent } from '../events/index.js';
import { HttpError, unprocessable } from '../http/errors.js';
import { SEEDED_RULES, matches, matchesAny } from './rules.js';

export { SEEDED_RULES, matches, matchesAny } from './rules.js';

const SEVERITY_RANK = { BLOCK: 3, WARN: 2, DETECT: 1 };
const iso = (ms) => new Date(ms).toISOString();

/** Do two grants cover any of the same part of the company? A whole-company grant overlaps everything. */
export function scopesOverlap(a, b) {
  if (a.company || b.company) return true;
  if (a.own && b.own) return true;
  for (const k of ['projects', 'sites', 'branches', 'departments']) for (const v of a[k]) if (b[k].has(v)) return true;
  return false;
}

/**
 * Segregation of duties (part 02.05). Rules say which duties must not meet in one person. Preventive checks run when a role is about to be
 * given (permission rules) and when a person is about to act on a document (action rules, against a ledger of what each person already
 * did); detective checks scan what people hold now. A BLOCK rule stops the thing and names the conflict, a WARN rule lets it through and
 * records it, a DETECT rule only records it.
 */
export function createSod({ db, now = () => Date.now(), authz = authzOf(db) }) {
  const cache = new Map();
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const parse = (r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, kind: r.kind, setA: JSON.parse(r.set_a_json), setB: JSON.parse(r.set_b_json), scope: r.scope, severity: r.severity, conditions: JSON.parse(r.conditions_json || '{}'), active: Boolean(r.active), catalogueRef: r.catalogue_ref, version: r.version });

  /** The standard rules exist for the company (written once, then the company owns them: changes go through approval). */
  function ensureRules(companyId) {
    if (!has('iam_sod_rules') || companyId == null) return;
    if (db.prepare('SELECT 1 FROM iam_sod_rules WHERE company_id = ? LIMIT 1').get(companyId)) return;
    if (!db.prepare('SELECT 1 FROM org_companies WHERE id = ?').get(companyId)) return;
    for (const r of SEEDED_RULES) {
      db.prepare("INSERT OR IGNORE INTO iam_sod_rules (company_id, code, name, description, kind, set_a_json, set_b_json, scope, severity, conditions_json, active, catalogue_ref, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'system', 'sod_rule')")
        .run(companyId, r.code, r.name, r.description, r.kind, JSON.stringify(r.setA), JSON.stringify(r.setB), r.scope, r.severity, JSON.stringify(r.conditions ?? {}), r.code);
    }
  }
  function rules(companyId, { onlyActive = true } = {}) {
    ensureRules(companyId);
    const key = `${companyId}|${onlyActive}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < 30_000) return hit.rules;
    const rows = has('iam_sod_rules') ? db.prepare(`SELECT * FROM iam_sod_rules WHERE company_id = ? AND is_active = 1 ${onlyActive ? 'AND active = 1' : ''} ORDER BY code`).all(companyId).map(parse) : [];
    cache.set(key, { at: now(), rules: rows });
    return rows;
  }
  const invalidate = () => cache.clear();

  // ---- permission rules: who holds both sides ----
  /** The conflicts in a person's grants (a map of permission to scope, from the permission engine). */
  function permissionConflicts(companyId, grants) {
    const found = [];
    const held = [...grants.entries()].filter(([, g]) => !g.deny.company);
    for (const rule of rules(companyId).filter((r) => r.kind === 'PERMISSION')) {
      const a = held.filter(([k]) => matchesAny(rule.setA, k));
      const b = held.filter(([k]) => matchesAny(rule.setB, k));
      const pairs = [];
      for (const [ka, ga] of a) for (const [kb, gb] of b) if (ka !== kb && scopesOverlap(ga.allow, gb.allow)) pairs.push([ka, kb]);
      if (pairs.length) {
        const via = (keys) => [...new Set(keys.flatMap((k) => (grants.get(k)?.sources ?? []).filter((s) => s.effect === 'allow').map((s) => s.role)))];
        found.push({ rule, a: [...new Set(pairs.map((p) => p[0]))], b: [...new Set(pairs.map((p) => p[1]))], rolesA: via(pairs.map((p) => p[0])), rolesB: via(pairs.map((p) => p[1])) });
      }
    }
    return found;
  }
  /** What a person holds now, and, with `extra`, what they would hold if they were also given that role. */
  function conflictsOf({ companyId, userId = null, roles = [], extra = [] }) {
    return permissionConflicts(companyId, authz.resolve({ companyId, userId, roles, extra }).grants);
  }

  /**
   * Is it allowed to give this role? Throws a 422 naming every blocking conflict; returns the warnings otherwise. Conflicts the person
   * already had are not charged to the new role.
   */
  function assertAssignable({ companyId, userId, roles = [], extra }) {
    const before = new Set(conflictsOf({ companyId, userId, roles }).map((c) => c.rule.code));
    const after = conflictsOf({ companyId, userId, roles, extra }).filter((c) => !before.has(c.rule.code));
    const blocks = after.filter((c) => c.rule.severity === 'BLOCK');
    if (blocks.length) {
      const text = blocks.map((c) => `${c.rule.code} ${c.rule.name}: ${c.a.join(', ')} (${c.rolesA.join(', ')}) together with ${c.b.join(', ')} (${c.rolesB.join(', ')})`).join('; ');
      throw unprocessable(`This would break a segregation-of-duties rule: ${text}. Give the person only one side of the conflict, or ask the auditor or director to change the rule.`, blocks.map((c) => ({ field: 'roleId', message: `${c.rule.code} ${c.rule.name}`, rule: c.rule.code })));
    }
    return after.filter((c) => c.rule.severity !== 'BLOCK').map((c) => ({ rule: c.rule.code, severity: c.rule.severity, name: c.rule.name, a: c.a, b: c.b }));
  }
  /** The permissions a role would add are checked against each other too: a role may not carry both sides of a blocking rule itself. */
  function conflictsWithinPermissions(companyId, keys) {
    const grants = new Map(keys.map((k) => [k, { allow: { company: true, own: false, projects: new Set(), sites: new Set(), branches: new Set(), departments: new Set() }, deny: { company: false }, sources: [{ effect: 'allow', role: 'this role' }] }]));
    return permissionConflicts(companyId, grants);
  }

  // ---- violations ----
  function recordViolation(v) {
    const dup = v.source === 'ASSIGNMENT' ? db.prepare("SELECT id FROM iam_sod_violations WHERE rule_id = ? AND user_id = ? AND source = 'ASSIGNMENT' AND status = 'OPEN'").get(v.ruleId, v.userId) : null;
    if (dup) {
      db.prepare('UPDATE iam_sod_violations SET detail_json = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(v.detail ?? {}), iso(now()), dup.id);
      return { id: dup.id, created: false };
    }
    const res = db.prepare("INSERT INTO iam_sod_violations (company_id, rule_id, user_id, user_ref, source, outcome, severity, document_type, document_id, detail_json, detected_at, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'sod_violation')")
      .run(v.companyId, v.ruleId, v.userId ?? null, v.userRef, v.source, v.outcome, v.severity, v.documentType ?? null, v.documentId ?? null, JSON.stringify(v.detail ?? {}), iso(now()), v.outcome === 'BLOCKED' ? 'BLOCKED' : 'OPEN');
    const id = Number(res.lastInsertRowid);
    publishEvent(db, { type: 'iam.sod.violation_detected', entity: 'sod_violation', entityId: id, actorId: v.userRef, companyId: v.companyId, data: { rule: v.ruleCode, outcome: v.outcome, source: v.source, user: v.userRef } });
    return { id, created: true };
  }

  /**
   * The detective check of one person: every conflict in what they hold now becomes (or stays) an open violation; one that is no longer
   * present is closed. Returns what was found.
   */
  function scanUser(companyId, userId) {
    const u = db.prepare('SELECT id, username, roles_json FROM iam_users WHERE id = ? AND company_id = ?').get(userId, companyId);
    if (!u) return [];
    const found = conflictsOf({ companyId, userId, roles: JSON.parse(u.roles_json) });
    const open = db.prepare("SELECT v.id, v.rule_id, r.code FROM iam_sod_violations v JOIN iam_sod_rules r ON r.id = v.rule_id WHERE v.user_id = ? AND v.source = 'ASSIGNMENT' AND v.status = 'OPEN'").all(userId);
    const keep = new Set();
    for (const c of found) {
      const r = recordViolation({ companyId, ruleId: c.rule.id, ruleCode: c.rule.code, userId, userRef: u.username, source: 'ASSIGNMENT', outcome: 'STANDING', severity: c.rule.severity, detail: { a: c.a, b: c.b, rolesA: c.rolesA, rolesB: c.rolesB } });
      keep.add(c.rule.id);
      void r;
    }
    for (const o of open) {
      if (!keep.has(o.rule_id)) db.prepare("UPDATE iam_sod_violations SET status = 'RESOLVED', resolved_at = ?, resolved_by = 'system', resolution = 'The conflict is no longer present.', updated_at = ?, version = version + 1 WHERE id = ?").run(iso(now()), iso(now()), o.id);
    }
    return found;
  }
  function scanCompany(companyId) {
    ensureRules(companyId);
    authz.invalidate();
    let users = 0;
    let conflicts = 0;
    for (const u of db.prepare("SELECT u.id FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.company_id = ? AND u.is_active = 1 AND COALESCE(p.lifecycle, 'ACTIVE') IN ('ONBOARDING', 'ACTIVE', 'SUSPENDED')").all(companyId)) {
      users += 1;
      conflicts += scanUser(companyId, u.id).length;
    }
    return { users, conflicts };
  }

  // ---- action rules: what the person already did ----
  const scopeKey = (rule, subject) => {
    if (rule.scope === 'DOCUMENT') return { sql: 'subject_type = ? AND subject_id = ?', args: [subject.type, String(subject.id)] };
    if (rule.scope === 'VENDOR') return subject.vendor ? { sql: 'vendor_ref = ?', args: [String(subject.vendor)] } : null;
    if (rule.scope === 'PERIOD') return subject.period ? { sql: 'period = ?', args: [String(subject.period)] } : null;
    if (rule.scope === 'PROJECT') return subject.projectId != null ? { sql: 'project_id = ?', args: [subject.projectId] } : null;
    return { sql: '1 = 1', args: [] };
  };

  /**
   * May this person do `action` to this subject, given what they did before? Returns { blocks, warnings }; a blocking conflict does not
   * throw here, the caller decides (see guard). `subject`: { type, id, projectId?, period?, vendor?, amountPaise? }.
   */
  function checkAction({ companyId, actor, action, subject }) {
    const out = { blocks: [], warnings: [], detected: [] };
    if (!has('iam_sod_actions')) return out;
    for (const rule of rules(companyId).filter((r) => r.kind === 'ACTION')) {
      const inA = matchesAny(rule.setA, action);
      const inB = matchesAny(rule.setB, action);
      if (!inA && !inB) continue;
      if (rule.conditions.minAmountPaise != null && !(Number(subject.amountPaise) >= rule.conditions.minAmountPaise)) continue;
      const key = scopeKey(rule, subject);
      if (!key) continue;
      const prior = db.prepare(`SELECT action_key, at FROM iam_sod_actions WHERE company_id = ? AND user_ref = ? AND ${key.sql} ORDER BY id DESC LIMIT 200`).all(companyId, actor.user, ...key.args)
        .find((p) => (inB && matchesAny(rule.setA, p.action_key)) || (inA && matchesAny(rule.setB, p.action_key)));
      if (!prior) continue;
      const hit = { rule, did: prior.action_key, at: prior.at, doing: action, subject };
      (rule.severity === 'BLOCK' ? out.blocks : rule.severity === 'WARN' ? out.warnings : out.detected).push(hit);
    }
    return out;
  }
  const messageOf = (h) => `Segregation of duties (${h.rule.code} ${h.rule.name}): you already did ${h.did} on ${h.subject.type} ${h.subject.id}, so you cannot do ${h.doing}. Ask someone else to do it.`;

  /**
   * The preventive check before a person acts. A blocking conflict throws a 403 that names it (carrying `sod` so the caller can record
   * the attempt after its transaction rolls back, see attempt); a warning or a detective hit is recorded and returned.
   */
  function guardAction({ companyId, actor, action, subject }) {
    const r = checkAction({ companyId, actor, action, subject });
    if (r.blocks.length) {
      const err = new HttpError(403, 'SEGREGATION_OF_DUTIES', r.blocks.map(messageOf).join(' '), r.blocks.map((h) => ({ field: 'action', message: `${h.rule.code} ${h.rule.name}` })));
      /** @type {any} */ (err).sod = { companyId, actor, blocks: r.blocks };
      throw err;
    }
    for (const [list, outcome] of [[r.warnings, 'WARNED'], [r.detected, 'DETECTED']]) {
      for (const h of list) recordViolation({ companyId, ruleId: h.rule.id, ruleCode: h.rule.code, userId: actor.userId ?? null, userRef: actor.user, source: 'TRANSACTION', outcome, severity: h.rule.severity, documentType: subject.type, documentId: String(subject.id), detail: { did: h.did, doing: h.doing, at: h.at } });
    }
    return { warnings: r.warnings.map((h) => ({ rule: h.rule.code, message: messageOf(h) })) };
  }
  /** Write the ledger row: this person did this to this subject. Runs inside the caller's transaction. */
  function record({ companyId, actor, action, subject }) {
    if (!has('iam_sod_actions')) return;
    db.prepare('INSERT INTO iam_sod_actions (company_id, user_ref, action_key, subject_type, subject_id, project_id, period, vendor_ref, amount_paise, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, actor.user, action, subject.type, String(subject.id), subject.projectId ?? null, subject.period ?? null, subject.vendor ?? null, subject.amountPaise ?? null, iso(now()));
  }
  /** Record the blocked attempts of a refused request (after its transaction was rolled back, so they are not lost). */
  function logBlocked(sod) {
    for (const h of sod.blocks) {
      recordViolation({ companyId: sod.companyId, ruleId: h.rule.id, ruleCode: h.rule.code, userId: sod.actor.userId ?? null, userRef: sod.actor.user, source: 'TRANSACTION', outcome: 'BLOCKED', severity: 'BLOCK', documentType: h.subject.type, documentId: String(h.subject.id), detail: { did: h.did, doing: h.doing, at: h.at } });
    }
  }
  /** Run `fn` (usually a transaction); if a segregation-of-duties block refuses it, keep a record of the attempt and let the refusal through. */
  function attempt(fn) {
    try {
      return fn();
    } catch (err) {
      if (err?.sod) {
        try { logBlocked(err.sod); } catch { /* the refusal matters more than its log */ }
      }
      throw err;
    }
  }

  return { rules, ensureRules, invalidate, permissionConflicts, conflictsOf, assertAssignable, conflictsWithinPermissions, scanUser, scanCompany, checkAction, guardAction, record, logBlocked, attempt, recordViolation, severityRank: SEVERITY_RANK, matches };
}

const instances = new WeakMap();
/** The segregation-of-duties service of a database, created once. */
export function sodOf(db, options = {}) {
  let s = instances.get(db);
  if (!s) {
    s = createSod({ db, ...options });
    instances.set(db, s);
  }
  return s;
}
