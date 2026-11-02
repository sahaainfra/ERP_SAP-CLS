import { inTransaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf, ROLE_TEMPLATES } from '../../platform/authz/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { OPS, meets } from '../../platform/workflow/definition.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { formatINR } from '../../../shared/money.js';
import { DEFAULT_MATRICES } from './matrix-defaults.js';
import { MATRIX_DOC } from './changes.js';

/**
 * The approval matrix (part 04.02): for a document type, a company, a department or a project, versions of a decision table. A rule has a priority, the
 * conditions on the context the document is submitted with (all must hold) and the steps (role, authority, parallel group, condition of its own). The first
 * rule that fits, in priority order, decides the chain (BR-01). A version takes effect from a date, only after its approval chain has approved it (BR-02),
 * and an instance in progress keeps the chain it started with. The authority limits then see to it that the one who gives the final approval has the authority.
 */
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));
const roleName = (code) => ROLE_TEMPLATES.find((r) => r.code === code)?.name ?? code;
const SCOPES = ['COMPANY', 'DEPARTMENT', 'PROJECT'];
const iso = () => new Date().toISOString();
const day = () => iso().slice(0, 10);
export const rupees = (paise) => (paise == null ? null : paise / 100);
const money = (rupeesValue) => formatINR(rupeesValue);

/** The role part of a step of a rule: `PM`, `ITADM|DIR` or MANAGER (the reporting manager). */
const approverOf = (s) => (s.role === 'MANAGER' ? { kind: 'manager' } : { kind: 'role', role: s.role });

export function createMatrixService({ db, engine, limits, paths }) {
  const authz = authzOf(db);
  const seeded = new Set();
  const present = (m, { rules = false } = {}) => ({
    id: m.id, docType: m.doc_type, docLabel: workflowTypes.get(m.doc_type)?.label ?? DEFAULT_MATRICES.find((d) => d.docType === m.doc_type)?.label ?? m.doc_type, scopeType: m.scope_type, scopeId: m.scope_id || null,
    version: m.matrix_version, name: m.name, status: m.status, effectiveFrom: m.effective_from, effectiveTo: m.effective_to, activatedBy: m.activated_by, createdBy: m.created_by, createdAt: m.created_at, updatedAt: m.updated_at,
    rowVersion: m.version, instanceId: m.activation_instance_id, ruleCount: db.prepare('SELECT COUNT(*) AS n FROM wf_matrix_rules WHERE matrix_id = ? AND deleted_at IS NULL').get(m.id).n,
    ...(rules ? { rules: rulesOf(m.id) } : {}),
  });
  const presentRule = (r) => ({ id: r.id, priority: r.priority, name: r.name, conditions: JSON.parse(r.condition_json), steps: JSON.parse(r.steps_json), version: r.version });
  const rulesOf = (id) => db.prepare('SELECT * FROM wf_matrix_rules WHERE matrix_id = ? AND deleted_at IS NULL ORDER BY priority').all(id).map(presentRule);
  const load = (actor, id) => {
    const m = db.prepare('SELECT * FROM wf_matrix WHERE id = ? AND is_active = 1').get(id);
    if (!m || m.company_id !== actor.companyId) throw notFound('That approval matrix does not exist.');
    return m;
  };
  const mustManage = (actor) => { if (!authz.check(actor, 'eng.matrix.manage').allowed) throw forbidden('Only someone who maintains the approval matrix (eng.matrix.manage) can do this.'); };

  // ---- the default matrix ----
  function toRuleSteps(def, roles) {
    return roles.map((role, i) => ({ code: def.sample ? ['MANAGER', 'FINANCE', 'CFO'][i] : `L${i + 1}`, name: def.sample ? ['Project manager', 'Accounts manager', 'Chief financial officer (large amounts)'][i] : roleName(role.split('|')[0]), role, ...(def.stepWhen?.[i] ? { when: def.stepWhen[i] } : {}), ...(def.sample ? { slaHours: i === 2 ? 48 : 24 } : {}) }));
  }
  /** A company gets the matrix, the limits, the hierarchy and the SLA settings of the reference the first time they are needed. */
  function ensureDefaults(companyId) {
    if (seeded.has(companyId)) return;
    if (!db.prepare('SELECT 1 FROM wf_matrix WHERE company_id = ? LIMIT 1').get(companyId)) {
      inTransaction(db, () => {
        for (const def of DEFAULT_MATRICES) {
          const m = Number(db.prepare("INSERT INTO wf_matrix (company_id, doc_type, scope_type, scope_id, matrix_version, name, status, effective_from, activated_at, activated_by, created_by, source_type) VALUES (?, ?, 'COMPANY', 0, 1, ?, 'ACTIVE', '2000-01-01', ?, 'system', 'system', 'default_matrix')").run(companyId, def.docType, `${def.label} (reference bands)`, iso()).lastInsertRowid);
          def.rules.forEach((r, i) => db.prepare('INSERT INTO wf_matrix_rules (company_id, matrix_id, priority, name, condition_json, steps_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(companyId, m, (i + 1) * 10, r.name, JSON.stringify(r.when), JSON.stringify(toRuleSteps(def, r.roles)), 'system', 'default_matrix'));
        }
        limits.ensureDefaults(companyId);
        paths.ensureDefaults(companyId);
      });
    }
    seeded.add(companyId);
  }

  // ---- finding the matrix and the rule ----
  /** The version of the matrix in force on a date for a document: the most specific scope that has one (project, then department, then company). */
  function matrixFor({ companyId, docType, projectId, departmentId, date }) {
    const candidates = [['PROJECT', projectId], ['DEPARTMENT', departmentId], ['COMPANY', 0]].filter(([, id]) => id != null);
    for (const [scopeType, scopeId] of candidates) {
      const m = db.prepare(`SELECT * FROM wf_matrix WHERE company_id = ? AND doc_type = ? AND scope_type = ? AND scope_id = ? AND status IN ('ACTIVE', 'RETIRED') AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY matrix_version DESC LIMIT 1`).get(companyId, docType, scopeType, scopeId, date, date);
      if (m) return m;
    }
    return null;
  }
  const holds = (conditions, context) => conditions.every((c) => meets(c, context));

  /** Turn the steps of a rule into the steps of the engine, applying the authority limits and the parallel groups. */
  function chainOf({ companyId, docType, rule, context, date, projectId }) {
    const amountPaise = Number.isFinite(Number(context.amount)) ? Math.round(Number(context.amount) * 100) : null;
    const skipped = [];
    const list = rule.steps.map((s, i) => ({ ...s, authority: s.authority ?? i === rule.steps.length - 1 }));
    const out = [];
    list.forEach((s, i) => {
      if (s.authority && amountPaise != null && s.role !== 'MANAGER') {
        const roles = s.role.split('|');
        const enough = roles.some((r) => { const lim = limits.limitFor({ companyId, role: r, docType, date }); return lim == null || lim >= amountPaise; });
        if (!enough) {
          const climb = paths.climb({ companyId, projectId, fromRole: roles[0], enough: (r) => { if (!limits.hasAuthority({ companyId, role: r, docType, date })) return false; const lim = limits.limitFor({ companyId, role: r, docType, date }); return lim == null || lim >= amountPaise; } });
          skipped.push({ step: s.code ?? `L${i + 1}`, role: s.role, reason: `the limit of ${s.role} for ${docType} is below ${money(amountPaise / 100)}`, takenBy: climb });
          if (climb) out.push({ ...s, role: climb, code: `${s.code ?? `L${i + 1}`}`, name: roleName(climb) });
          else out.push(s); // nobody above has the authority either: the chain keeps the step and the monitor will show the document needs an exception
          return;
        }
      }
      out.push(s);
    });
    // consecutive steps of one group become one parallel step
    const steps = [];
    out.forEach((s, i) => {
      const code = s.code ?? `L${i + 1}`;
      const prev = steps[steps.length - 1];
      if (s.group && prev && prev.__group === s.group) { prev.approvers.push(approverOf(s)); prev.mode = s.groupMode === 'any' ? 'parallel_any' : 'parallel_all'; return; }
      steps.push({ __group: s.group ?? null, code, name: s.name ?? roleName(String(s.role).split('|')[0]), type: 'approval', mode: 'single', approvers: [approverOf(s)], slaHours: s.slaHours ?? null, requireAttachment: Boolean(s.requireAttachment), checklist: s.checklist ?? [], when: s.when ?? null, notify: [], action: null });
    });
    return { steps: steps.map(({ __group, ...rest }) => rest), skipped };
  }

  /** The chain for a document, or null when the document type has no matrix (its definition's own steps stand), or an error when no rule fits. */
  function resolve({ companyId, docType, context = {}, projectId = null, departmentId = null, date = day() }) {
    ensureDefaults(companyId);
    const m = matrixFor({ companyId, docType, projectId, departmentId, date });
    if (!m) return null;
    const rules = rulesOf(m.id);
    const rule = rules.find((r) => holds(r.conditions, context));
    if (!rule) return { error: `No rule of the approval matrix for ${docType} (version ${m.matrix_version}) covers this document. Ask the system administrator to close the gap.` };
    const { steps, skipped } = chainOf({ companyId, docType, rule, context, date, projectId });
    return { steps, trace: { matrixId: m.id, matrixVersion: m.matrix_version, scope: m.scope_type, ruleId: rule.id, rule: rule.name, priority: rule.priority, skipped } };
  }

  // ---- checking a version ----
  function checkRules(rules) {
    const problems = [];
    const seen = new Set();
    rules.forEach((r, i) => {
      const at = `rules.${i}`;
      if (!Number.isInteger(r.priority) || r.priority < 1) problems.push({ field: `${at}.priority`, message: 'is a whole number from 1' });
      if (seen.has(r.priority)) problems.push({ field: `${at}.priority`, message: `the priority ${r.priority} is used twice; the first full match decides, so each rule needs its own place` });
      seen.add(r.priority);
      if (!r.steps?.length) problems.push({ field: `${at}.steps`, message: 'a rule needs at least one step' });
      for (const [j, s] of (r.steps ?? []).entries()) {
        const roles = String(s.role ?? '').split('|');
        if (!roles.every((x) => x === 'MANAGER' || ROLE_CODES.has(x))) problems.push({ field: `${at}.steps.${j}.role`, message: `${s.role} is not a role of the catalogue` });
      }
      for (const [j, c] of (r.conditions ?? []).entries()) if (!OPS.includes(c.op)) problems.push({ field: `${at}.conditions.${j}.op`, message: `${c.op} is not an operator` });
    });
    return problems;
  }
  /**
   * Gaps and shadowed rules. The candidate documents are built from the fields the conditions read: for each, the values on and next to every bound, both
   * truth values, every value named and one other; their combinations (up to a cap) are laid against the rules in priority order.
   */
  function analyse(rules) {
    const sorted = [...rules].sort((a, b) => a.priority - b.priority);
    const fields = new Map();
    for (const r of sorted) for (const c of r.conditions) {
      const set = fields.get(c.field) ?? new Set();
      const vals = Array.isArray(c.value) ? c.value : [c.value];
      for (const v of vals) {
        if (typeof v === 'number') [v - 0.01, v, v + 0.01].forEach((x) => set.add(Number(x.toFixed(2))));
        else if (typeof v === 'boolean') { set.add(true); set.add(false); } else if (typeof v === 'string' && v !== '' && Number.isNaN(Number(v))) set.add(v);
        else if (typeof v === 'string') [Number(v) - 0.01, Number(v), Number(v) + 0.01].forEach((x) => set.add(Number(x.toFixed(2))));
      }
      set.add(c.op === 'eq' && typeof c.value === 'string' ? '__other__' : -1 + 0);
      set.add(1e12);
      fields.set(c.field, set);
    }
    const names = [...fields.keys()];
    const lists = names.map((n) => [...fields.get(n)].filter((v) => v !== undefined));
    const points = [{}];
    for (let i = 0; i < names.length; i += 1) {
      const next = [];
      for (const p of points) for (const v of lists[i]) { next.push({ ...p, [names[i]]: v }); if (next.length >= 4000) break; }
      points.splice(0, points.length, ...next);
    }
    const reached = new Set();
    const gaps = [];
    for (const p of points) {
      const hit = sorted.findIndex((r) => holds(r.conditions, p));
      if (hit < 0) { if (gaps.length < 5) gaps.push(p); } else reached.add(sorted[hit].priority);
    }
    const shadowed = sorted.filter((r) => !reached.has(r.priority)).map((r) => ({ priority: r.priority, name: r.name }));
    return { gaps, shadowed, tested: points.length };
  }
  function validate(actor, id) {
    const m = load(actor, id);
    const rules = rulesOf(m.id);
    const problems = checkRules(rules);
    const a = rules.length ? analyse(rules) : { gaps: [{}], shadowed: [], tested: 0 };
    return { ok: problems.length === 0 && a.gaps.length === 0, problems, gaps: a.gaps, shadowed: a.shadowed, tested: a.tested };
  }

  // ---- writing ----
  const rulesBody = (rules) => {
    const problems = checkRules(rules);
    if (problems.length) throw badRequest('The rules are not valid.', problems);
  };
  const writeRules = (companyId, matrixId, rules, actor) => {
    db.prepare("UPDATE wf_matrix_rules SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE matrix_id = ? AND deleted_at IS NULL").run(iso(), actor.user, matrixId);
    for (const r of rules) db.prepare('INSERT INTO wf_matrix_rules (company_id, matrix_id, priority, name, condition_json, steps_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, matrixId, r.priority, r.name, JSON.stringify(r.conditions ?? []), JSON.stringify(r.steps), actor.user, 'matrix_editor');
  };
  const nextVersion = (companyId, docType, scopeType, scopeId) => db.prepare('SELECT COALESCE(MAX(matrix_version), 0) + 1 AS v FROM wf_matrix WHERE company_id = ? AND doc_type = ? AND scope_type = ? AND scope_id = ?').get(companyId, docType, scopeType, scopeId).v;

  return {
    ensureDefaults,
    resolve,
    present,
    docTypes() {
      const reg = new Map(workflowTypes.list().map((t) => [t.docType, t.label ?? t.docType]));
      for (const d of DEFAULT_MATRICES) if (!reg.has(d.docType)) reg.set(d.docType, d.label);
      return [...reg.entries()].map(([docType, label]) => ({ docType, label })).sort((a, b) => a.label.localeCompare(b.label));
    },
    list(actor, { docType, status, scopeType, q, limit = 25, offset = 0 } = {}) {
      ensureDefaults(actor.companyId);
      const where = ['m.company_id = :c', 'm.is_active = 1'];
      const p = { c: actor.companyId };
      if (docType) { where.push('m.doc_type = :t'); p.t = docType; }
      if (status) { where.push('m.status = :s'); p.s = status; }
      if (scopeType) { where.push('m.scope_type = :st'); p.st = scopeType; }
      if (q) { where.push('(m.name LIKE :q OR m.doc_type LIKE :q)'); p.q = `%${q}%`; }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM wf_matrix m WHERE ${where.join(' AND ')}`).get(p).n;
      const rows = db.prepare(`SELECT m.* FROM wf_matrix m WHERE ${where.join(' AND ')} ORDER BY m.doc_type, m.scope_type, m.scope_id, m.matrix_version DESC LIMIT :limit OFFSET :offset`).all({ ...p, limit, offset });
      return { rows: rows.map((m) => present(m)), total, docTypes: this.docTypes() };
    },
    get(actor, id) { ensureDefaults(actor.companyId); return present(load(actor, id), { rules: true }); },
    /** A new draft: a copy of the version in force for the scope (or of a given version), ready to change. */
    create(actor, { docType, scopeType = 'COMPANY', scopeId = 0, name, copyOf, rules }) {
      mustManage(actor);
      ensureDefaults(actor.companyId);
      return inTransaction(db, () => {
        if (!SCOPES.includes(scopeType)) throw badRequest('The scope must be the company, a department or a project.', [{ field: 'scopeType', message: 'is not valid' }]);
        if (scopeType !== 'COMPANY' && !(scopeId >= 1)) throw badRequest('Choose the department or project this matrix is for.', [{ field: 'scopeId', message: 'is required' }]);
        const table = scopeType === 'PROJECT' ? 'org_projects' : 'org_departments';
        if (scopeType !== 'COMPANY' && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND company_id = ?`).get(scopeId, actor.companyId)) throw unprocessable(`That ${scopeType.toLowerCase()} does not exist in your company.`);
        const sid = scopeType === 'COMPANY' ? 0 : scopeId;
        let source = rules;
        if (!source) {
          const base = copyOf ? db.prepare('SELECT * FROM wf_matrix WHERE id = ? AND company_id = ?').get(copyOf, actor.companyId) : matrixFor({ companyId: actor.companyId, docType, projectId: scopeType === 'PROJECT' ? sid : null, departmentId: scopeType === 'DEPARTMENT' ? sid : null, date: day() })
            ?? matrixFor({ companyId: actor.companyId, docType, date: day() });
          source = base ? rulesOf(base.id).map(({ priority, name: n, conditions, steps }) => ({ priority, name: n, conditions, steps })) : [];
          if (!source.length) throw unprocessable(`There is no matrix for ${docType} to start from; give the first rules.`);
        }
        rulesBody(source);
        const version = nextVersion(actor.companyId, docType, scopeType, sid);
        const id = Number(db.prepare("INSERT INTO wf_matrix (company_id, doc_type, scope_type, scope_id, matrix_version, name, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'matrix_editor')")
          .run(actor.companyId, docType, scopeType, sid, version, name ?? `${docType} version ${version}`, actor.user).lastInsertRowid);
        writeRules(actor.companyId, id, source, actor);
        writeAudit(db, { entity: 'wf_matrix', entityId: id, action: 'create', newValues: { docType, scopeType, version, rules: source.length }, actor: actor.user });
        return present(db.prepare('SELECT * FROM wf_matrix WHERE id = ?').get(id), { rules: true });
      });
    },
    update(actor, id, { name, rules, version }) {
      mustManage(actor);
      return inTransaction(db, () => {
        const m = load(actor, id);
        if (!['DRAFT', 'REJECTED'].includes(m.status)) throw unprocessable(`A ${m.status.toLowerCase()} version cannot be edited. Make a new version from it instead.`);
        if (version !== undefined && version !== m.version) throw conflict('This matrix was changed by someone else. Refresh it and edit again.');
        rulesBody(rules);
        writeRules(m.company_id, id, rules, actor);
        db.prepare("UPDATE wf_matrix SET name = ?, status = 'DRAFT', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(name ?? m.name, actor.user, iso(), id);
        writeAudit(db, { entity: 'wf_matrix', entityId: id, action: 'update', newValues: { rules: rules.length }, actor: actor.user });
        return present(db.prepare('SELECT * FROM wf_matrix WHERE id = ?').get(id), { rules: true });
      });
    },
    remove(actor, id) {
      mustManage(actor);
      return inTransaction(db, () => {
        const m = load(actor, id);
        if (!['DRAFT', 'REJECTED'].includes(m.status)) throw unprocessable('Only a draft or a rejected version can be deleted; the others are the history of the matrix.');
        db.prepare('UPDATE wf_matrix SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ?').run(iso(), actor.user, id);
        writeAudit(db, { entity: 'wf_matrix', entityId: id, action: 'delete', actor: actor.user });
        return { id };
      });
    },
    validate,
    /** Ask for a version to take effect on a date: refused while a document could fall through the rules; then the chain of approval starts. */
    activate(actor, id, { effectiveFrom }) {
      mustManage(actor);
      return inTransaction(db, () => {
        const m = load(actor, id);
        if (!['DRAFT', 'REJECTED'].includes(m.status)) throw unprocessable(m.status === 'ACTIVE' ? 'This version is already active.' : `A ${m.status.toLowerCase()} version cannot be activated.`);
        if (effectiveFrom < day()) throw unprocessable('A matrix takes effect from today or a later date, never in the past, so no document already routed is affected.');
        const v = validate(actor, id);
        if (!v.ok) throw unprocessable(v.gaps.length ? `The rules leave gaps: a document like ${JSON.stringify(v.gaps[0])} would match no rule. Close the gaps (a last rule with no condition covers everything), then ask again.` : 'The rules are not valid.', [...v.problems, ...v.gaps.map((g) => ({ field: 'rules', message: `no rule covers ${JSON.stringify(g)}` }))]);
        if (db.prepare("SELECT 1 FROM wf_matrix WHERE company_id = ? AND doc_type = ? AND scope_type = ? AND scope_id = ? AND status = 'PENDING' AND id != ?").get(m.company_id, m.doc_type, m.scope_type, m.scope_id, id)) throw conflict('Another version of this matrix is already waiting for approval.');
        db.prepare("UPDATE wf_matrix SET status = 'PENDING', effective_from = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(effectiveFrom, actor.user, iso(), id);
        const def = DEFAULT_MATRICES.find((d) => d.docType === m.doc_type);
        const instance = engine.submit(actor, { docType: MATRIX_DOC, docId: String(id), comment: `Matrix for ${m.doc_type}, version ${m.matrix_version}, from ${effectiveFrom}`,
          context: { owner: def && !def.financial ? def.owner : 'CFO', financial: def ? def.financial : true, maxAmount: 0, effectiveFrom, docType: m.doc_type } });
        db.prepare('UPDATE wf_matrix SET activation_instance_id = ? WHERE id = ?').run(instance.id, id);
        return { matrix: present(db.prepare('SELECT * FROM wf_matrix WHERE id = ?').get(id)), instance };
      });
    },
    compare(actor, aId, bId) {
      const a = load(actor, aId);
      const b = load(actor, bId);
      if (a.doc_type !== b.doc_type) throw badRequest('Only two versions of the same document type can be compared.');
      const ra = rulesOf(a.id);
      const rb = rulesOf(b.id);
      const key = (r) => r.priority;
      const keys = [...new Set([...ra.map(key), ...rb.map(key)])].sort((x, y) => x - y);
      return keys.map((k) => {
        const x = ra.find((r) => key(r) === k);
        const y = rb.find((r) => key(r) === k);
        const same = x && y && JSON.stringify([x.name, x.conditions, x.steps]) === JSON.stringify([y.name, y.conditions, y.steps]);
        return { priority: k, change: !x ? 'ADDED' : !y ? 'REMOVED' : same ? 'SAME' : 'CHANGED', from: x ?? null, to: y ?? null };
      });
    },
    history(actor, docType) {
      ensureDefaults(actor.companyId);
      return db.prepare("SELECT m.* FROM wf_matrix m WHERE m.company_id = ? AND m.doc_type = ? AND m.is_active = 1 ORDER BY m.matrix_version DESC").all(actor.companyId, docType).map((m) => present(m));
    },
    /**
     * What would happen to a document like this one: the rule that fits, the chain after the limits, and who would be asked. The same function routes a real
     * document, so the answer is the routing (T-04). A draft can be tried before it is activated.
     */
    simulate(actor, { docType, context = {}, projectId = null, departmentId = null, date = day(), matrixId = null }) {
      ensureDefaults(actor.companyId);
      let result;
      if (matrixId) {
        const m = load(actor, matrixId);
        if (m.doc_type !== docType) throw badRequest('That matrix is for another document type.', [{ field: 'matrixId', message: 'does not match the document type' }]);
        const rules = rulesOf(m.id);
        const rule = rules.find((r) => holds(r.conditions, context));
        result = rule ? { ...chainOf({ companyId: actor.companyId, docType, rule, context, date, projectId }), trace: { matrixId: m.id, matrixVersion: m.matrix_version, scope: m.scope_type, ruleId: rule.id, rule: rule.name, priority: rule.priority } } : { error: `No rule of this version covers a document like this one.` };
        if (result.skipped) result.trace.skipped = result.skipped;
      } else result = resolve({ companyId: actor.companyId, docType, context, projectId, departmentId, date });
      if (!result) return { found: false, message: `There is no approval matrix for ${docType}. The document uses the steps of its workflow definition.` };
      if (result.error) return { found: true, matched: false, message: result.error };
      return {
        found: true, matched: true, trace: result.trace,
        steps: result.steps.map((s) => ({
          code: s.code, name: s.name, mode: s.mode, slaHours: s.slaHours, condition: s.when, applies: meets(s.when, context),
          approvers: s.approvers.map((a) => (a.kind === 'manager' ? { kind: 'manager', label: 'The reporting manager of the person who raises it', holders: [] } : { kind: 'role', label: a.role.replace(/\|/g, ' or '), holders: a.role.split('|').flatMap((r) => (engine.iamMode(actor.companyId) ? engine.holders(actor.companyId, r, { projectId }) : [])) })),
        })),
      };
    },
  };
}
export { roleName };
