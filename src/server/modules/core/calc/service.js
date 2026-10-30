import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { fileEntities } from '../../../platform/files/entities.js';
import { definitionOf, runTests } from '../../../platform/calc/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, pageResponse } from '../../../platform/pagination/index.js';
import { CalcError, definitionProblems, runDefinition } from '../../../../shared/calc.js';
import { dec } from '../../../../shared/decimal.js';
import { todayIST } from '../../../../shared/dates.js';

/** Who must approve a new version of a formula: the manager of the owning module, then the CFO for financial formulas. */
export const OWNER_MANAGER = Object.freeze({ boq: 'PCMGR', estimation: 'PCMGR', projects: 'PCMGR', stores: 'ACCMGR', tax: 'ACCMGR', billing: 'ACCMGR', finance: 'ACCMGR', payroll: 'ACCMGR' });
export const activationChain = (ownerModule, financial) => [OWNER_MANAGER[ownerModule] ?? 'ITADM', ...(financial ? ['CFO'] : [])];

const dayBefore = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const FIELDS = ['description', 'expression', 'inputs', 'outputs', 'roundingPolicy', 'effectiveFrom', 'tests'];

export const presentVersion = (r, today = todayIST()) => {
  const state = r.status === 'DRAFT' ? 'draft' : r.status === 'SHADOW' ? 'shadow' : r.status === 'RETIRED' ? 'retired' : r.effective_from > today ? 'future' : r.effective_to && r.effective_to < today ? 'past' : 'current';
  return {
    id: r.id,
    code: r.code,
    version: r.formula_version,
    description: r.description,
    ownerModule: r.owner_module,
    financial: r.financial === 1,
    expression: r.expression,
    inputs: JSON.parse(r.inputs_json),
    outputs: JSON.parse(r.outputs_json),
    roundingPolicy: r.rounding_policy,
    tests: JSON.parse(r.tests_json),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    status: r.status,
    state,
    editable: r.status === 'DRAFT',
    activatedAt: r.activated_at,
    activatedBy: r.activated_by,
    createdBy: r.created_by,
    rowVersion: r.version,
  };
};

/** Every formula-level problem as a 400 with a field per problem. */
const problemsToError = (problems) => badRequest(problems[0], problems.map((message) => ({ field: 'formula', message })));

/** The approved activation is applied in the approver's transaction (maker-checker). */
export const formulaActivationHandler = {
  apply(db, request, actor) {
    const row = db.prepare('SELECT * FROM core_formulas WHERE id = ? AND deleted_at IS NULL').get(request.targetId);
    if (!row || !['DRAFT', 'SHADOW'].includes(row.status)) throw unprocessable('This formula version is no longer waiting for activation.');
    const def = definitionOf(row);
    const problems = definitionProblems(def);
    if (problems.length) throw unprocessable(`The version is no longer valid: ${problems[0]}`);
    const failing = runTests(def, JSON.parse(row.tests_json)).filter((t) => !t.ok);
    if (failing.length) throw unprocessable(`The version's own tests fail: ${failing[0].error}`);
    const today = todayIST();
    if (row.effective_from < today) throw unprocessable(`The effective date ${row.effective_from} has passed. Create a new version with a later date.`);
    const clash = db.prepare("SELECT formula_version FROM core_formulas WHERE code = ? AND status = 'ACTIVE' AND effective_from >= ? AND id <> ? AND deleted_at IS NULL").get(row.code, row.effective_from, row.id);
    if (clash) throw unprocessable(`Version ${clash.formula_version} already starts on or after ${row.effective_from}.`);
    const stamp = new Date().toISOString();
    const closes = db.prepare("SELECT * FROM core_formulas WHERE code = ? AND status = 'ACTIVE' AND (effective_to IS NULL OR effective_to >= ?) AND id <> ? AND deleted_at IS NULL").all(row.code, row.effective_from, row.id);
    for (const prev of closes) {
      db.prepare('UPDATE core_formulas SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(dayBefore(row.effective_from), actor.user, stamp, prev.id);
    }
    db.prepare("UPDATE core_formulas SET status = 'ACTIVE', activated_at = ?, activated_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, actor.user, actor.user, stamp, row.id);
    writeAudit(db, { entity: 'core_formulas', entityId: row.id, action: 'activate', oldValues: { status: row.status }, newValues: { status: 'ACTIVE', effectiveFrom: row.effective_from, closes: closes.map((c) => c.formula_version) }, reason: request.reason, actor: actor.user });
    publishEvent(db, { type: 'core.formula.activated', entity: 'formula', entityId: row.id, actorId: actor.user, companyId: request.companyId, data: { code: row.code, version: row.formula_version, effectiveFrom: row.effective_from, requestId: request.id } });
  },
};

/** Formula registry, test bench, shadow reports, traces and units of measure. */
export function createCalcService({ db, engine, approvals }) {
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const rows = (code) => db.prepare('SELECT * FROM core_formulas WHERE code = ? AND deleted_at IS NULL ORDER BY formula_version').all(code);
  const rowOrThrow = (code, version) => {
    const r = db.prepare('SELECT * FROM core_formulas WHERE code = ? AND formula_version = ? AND deleted_at IS NULL').get(code, version);
    if (!r) throw notFound(`There is no version ${version} of the formula ${code}.`);
    return r;
  };
  const view = (actor) => {
    assertPermission(actor, 'core.calc.view');
    companyOf(actor);
  };
  const manage = (actor) => {
    assertPermission(actor, 'core.calc.manage');
    companyOf(actor);
  };

  const merge = (base, b) => ({
    description: b.description ?? base.description,
    expression: b.expression ?? base.expression,
    inputs: b.inputs ?? JSON.parse(base.inputs_json),
    outputs: b.outputs ?? JSON.parse(base.outputs_json),
    roundingPolicy: b.roundingPolicy ?? base.rounding_policy,
    effectiveFrom: b.effectiveFrom ?? base.effective_from,
    tests: b.tests ?? JSON.parse(base.tests_json),
  });
  const soundOrThrow = (m) => {
    const problems = definitionProblems({ expression: m.expression, inputs: m.inputs, outputs: m.outputs, rounding_policy: m.roundingPolicy });
    if (problems.length) throw problemsToError(problems);
  };
  const insertVersion = (actor, { code, version, ownerModule, financial }, m) =>
    Number(
      db
        .prepare(
          `INSERT INTO core_formulas (company_id, code, formula_version, description, owner_module, financial, expression, inputs_json, outputs_json, rounding_policy, tests_json, effective_from, status, created_by, source_type)
           VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'formula')`,
        )
        .run(code, version, m.description, ownerModule, financial ? 1 : 0, m.expression, JSON.stringify(m.inputs), JSON.stringify(m.outputs), m.roundingPolicy, JSON.stringify(m.tests), m.effectiveFrom, actor.user).lastInsertRowid,
    );
  const created = (actor, id, code, version, reason, correlationId) => {
    writeAudit(db, { entity: 'core_formulas', entityId: id, action: 'create', newValues: { code, version }, reason, actor: actor.user, correlationId });
    publishEvent(db, { type: 'core.formula.version_created', entity: 'formula', entityId: id, actorId: actor.user, companyId: actor.companyId, correlationId, data: { code, version } });
  };

  return {
    list(actor, query) {
      view(actor);
      const params = { q: likePattern(query.q), owner: query.filters.owner_module ?? null };
      const all = db
        .prepare("SELECT * FROM core_formulas WHERE deleted_at IS NULL AND (code LIKE :q ESCAPE '\\' OR description LIKE :q ESCAPE '\\') AND (:owner IS NULL OR owner_module = :owner) ORDER BY code, formula_version")
        .all(params);
      const today = todayIST();
      const byCode = new Map();
      for (const r of all) {
        const g = byCode.get(r.code) ?? { code: r.code, description: r.description, ownerModule: r.owner_module, financial: r.financial === 1, versions: [] };
        g.versions.push(presentVersion(r, today));
        g.description = r.description;
        byCode.set(r.code, g);
      }
      let list = [...byCode.values()].map((g) => {
        const current = g.versions.find((v) => v.state === 'current');
        const latest = g.versions.at(-1);
        return { code: g.code, description: g.description, ownerModule: g.ownerModule, financial: g.financial, currentVersion: current?.version ?? null, latestVersion: latest.version, latestStatus: latest.status, versionCount: g.versions.length, hasShadow: g.versions.some((v) => v.state === 'shadow'), hasDraft: g.versions.some((v) => v.state === 'draft'), roundingPolicy: (current ?? latest).roundingPolicy };
      });
      if (query.filters.status) list = list.filter((f) => (query.filters.status === 'DRAFT' ? f.hasDraft : query.filters.status === 'SHADOW' ? f.hasShadow : f.latestStatus === query.filters.status));
      const total = list.length;
      return pageResponse(list.slice(query.offset, query.offset + query.limit), total, query);
    },

    get(actor, code) {
      view(actor);
      const all = rows(code);
      if (all.length === 0) throw notFound(`There is no formula ${code}.`);
      const today = todayIST();
      const open = db.prepare("SELECT id, target_id FROM core_change_requests WHERE type = 'formula_activation' AND status IN ('SUBMITTED', 'RETURNED') AND is_active = 1").all();
      return {
        code,
        description: all.at(-1).description,
        ownerModule: all[0].owner_module,
        financial: all[0].financial === 1,
        approvalChain: activationChain(all[0].owner_module, all[0].financial === 1),
        versions: all.map((r) => ({ ...presentVersion(r, today), activationRequestId: open.find((o) => o.target_id === r.id)?.id ?? null })).reverse(),
      };
    },

    createFormula(actor, b, correlationId) {
      manage(actor);
      if (rows(b.code).length) throw conflict(`There is already a formula ${b.code}. Create a new version of it instead.`);
      const m = merge({ description: '', expression: '', inputs_json: '[]', outputs_json: '[]', rounding_policy: 'half_up', effective_from: todayIST(), tests_json: '[]' }, b);
      soundOrThrow(m);
      return transaction(db, () => {
        const id = insertVersion(actor, { code: b.code, version: 1, ownerModule: b.ownerModule, financial: b.financial }, m);
        created(actor, id, b.code, 1, b.reason, correlationId);
        return presentVersion(db.prepare('SELECT * FROM core_formulas WHERE id = ?').get(id));
      });
    },

    createVersion(actor, code, b, correlationId) {
      manage(actor);
      const all = rows(code);
      if (all.length === 0) throw notFound(`There is no formula ${code}.`);
      if (all.some((r) => r.status === 'DRAFT')) throw conflict('There is already a draft of this formula. Finish or activate it before starting another.');
      const base = b.baseVersion ? rowOrThrow(code, b.baseVersion) : all.at(-1);
      const m = merge(base, b);
      soundOrThrow(m);
      return transaction(db, () => {
        const version = all.at(-1).formula_version + 1;
        const id = insertVersion(actor, { code, version, ownerModule: base.owner_module, financial: base.financial === 1 }, m);
        created(actor, id, code, version, b.reason, correlationId);
        return presentVersion(db.prepare('SELECT * FROM core_formulas WHERE id = ?').get(id));
      });
    },

    /** Only a draft can be edited (BR-02); anything else is changed by making a new version. */
    updateVersion(actor, code, version, b, correlationId) {
      manage(actor);
      const row = rowOrThrow(code, version);
      if (row.status !== 'DRAFT') throw conflict(`Version ${version} is ${row.status.toLowerCase()} and can no longer be changed. Create a new version instead.`);
      if (row.version !== b.version) throw conflict('This draft was changed by someone else. Reload it and apply your change again.');
      const m = merge(row, b);
      soundOrThrow(m);
      return transaction(db, () => {
        const stamp = new Date().toISOString();
        db.prepare('UPDATE core_formulas SET description = ?, expression = ?, inputs_json = ?, outputs_json = ?, rounding_policy = ?, effective_from = ?, tests_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(
          m.description, m.expression, JSON.stringify(m.inputs), JSON.stringify(m.outputs), m.roundingPolicy, m.effectiveFrom, JSON.stringify(m.tests), actor.user, stamp, row.id);
        writeAudit(db, { entity: 'core_formulas', entityId: row.id, action: 'update', oldValues: Object.fromEntries(FIELDS.map((f) => [f, presentVersion(row)[f]])), newValues: m, reason: b.reason, actor: actor.user, correlationId });
        return presentVersion(db.prepare('SELECT * FROM core_formulas WHERE id = ?').get(row.id));
      });
    },

    checkVersion(actor, code, version) {
      view(actor);
      const row = rowOrThrow(code, version);
      const def = definitionOf(row);
      const problems = definitionProblems(def);
      return { problems, tests: problems.length ? [] : runTests(def, JSON.parse(row.tests_json)) };
    },

    /** The test bench: evaluate a stored version, the version in force on a date, or an unsaved draft definition. Records nothing. */
    test(actor, code, b) {
      view(actor);
      if (b.draft) {
        const def = { expression: b.draft.expression, inputs: b.draft.inputs, outputs: b.draft.outputs, rounding_policy: b.draft.roundingPolicy };
        const problems = definitionProblems(def);
        if (problems.length) throw problemsToError(problems);
        try {
          const out = runDefinition(def, b.inputs);
          return { result: out.outputs, trace: { formula: { code, version: 'unsaved draft', expression: b.draft.expression, roundingPolicy: b.draft.roundingPolicy }, ...out.trace, outputs: out.outputs }, formula: { code, version: null } };
        } catch (err) {
          if (err instanceof CalcError) throw new HttpError(422, 'BUSINESS_RULE', `Calculation failed: ${err.message}`, [{ field: err.step ?? 'inputs', message: err.message }]);
          throw err;
        }
      }
      return engine.evaluate(code, b.inputs, { date: b.date, version: b.version ?? null, shadow: false });
    },

    /** Run a draft alongside the active version on every calculation from now on (FR-05); results are collected for the report. */
    startShadow(actor, code, version, { reason }, correlationId) {
      manage(actor);
      const row = rowOrThrow(code, version);
      if (row.status !== 'DRAFT') throw conflict(`Only a draft can be put in shadow mode; version ${version} is ${row.status.toLowerCase()}.`);
      const checked = this.checkVersion(actor, code, version);
      if (checked.problems.length) throw problemsToError(checked.problems);
      if (checked.tests.length === 0) throw unprocessable('Add at least one test case first: a version is only compared when it passes its own tests.');
      const failing = checked.tests.find((t) => !t.ok);
      if (failing) throw unprocessable(`The version's own tests fail: ${failing.error}`);
      try {
        engine.resolve(code);
      } catch {
        throw unprocessable('There is no active version to compare with.');
      }
      return transaction(db, () => {
        const stamp = new Date().toISOString();
        db.prepare("UPDATE core_formulas SET status = 'SHADOW', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, stamp, row.id);
        writeAudit(db, { entity: 'core_formulas', entityId: row.id, action: 'shadow_start', oldValues: { status: 'DRAFT' }, newValues: { status: 'SHADOW' }, reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.formula.shadow_started', entity: 'formula', entityId: row.id, actorId: actor.user, companyId: actor.companyId, correlationId, data: { code, version } });
        return presentVersion(db.prepare('SELECT * FROM core_formulas WHERE id = ?').get(row.id));
      });
    },

    stopShadow(actor, code, version, { reason }, correlationId) {
      manage(actor);
      const row = rowOrThrow(code, version);
      if (row.status !== 'SHADOW') throw conflict(`Version ${version} is not in shadow mode.`);
      return transaction(db, () => {
        const stamp = new Date().toISOString();
        db.prepare("UPDATE core_formulas SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, stamp, row.id);
        writeAudit(db, { entity: 'core_formulas', entityId: row.id, action: 'shadow_stop', oldValues: { status: 'SHADOW' }, newValues: { status: 'RETIRED' }, reason, actor: actor.user, correlationId });
        return presentVersion(db.prepare('SELECT * FROM core_formulas WHERE id = ?').get(row.id));
      });
    },

    /** Ask for a draft or shadow version to become active: tests must pass, the date must be today or later, and the owner chain decides. */
    requestActivation(actor, code, version, { reason }) {
      manage(actor);
      const companyId = companyOf(actor);
      const row = rowOrThrow(code, version);
      if (!['DRAFT', 'SHADOW'].includes(row.status)) throw conflict(`Version ${version} is already ${row.status.toLowerCase()}.`);
      const checked = this.checkVersion(actor, code, version);
      if (checked.problems.length) throw problemsToError(checked.problems);
      if (checked.tests.length === 0) throw unprocessable('Add at least one test case: a version cannot be activated without tests.');
      const failing = checked.tests.find((t) => !t.ok);
      if (failing) throw unprocessable(`The version's own tests fail: ${failing.error}`);
      if (row.effective_from < todayIST()) throw unprocessable(`The effective date ${row.effective_from} is in the past. Set today or a later date.`);
      if (approvals.hasOpen(companyId, 'formula_activation', 'formula', row.id)) throw conflict('There is already an open activation request for this version.');
      const shadow = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(differs), 0) AS d FROM core_calc_shadow_results WHERE formula_code = ? AND candidate_version = ?').get(code, version);
      return approvals.submit(actor, {
        type: 'formula_activation',
        title: `Activate ${code} version ${version}`,
        targetType: 'formula',
        targetId: row.id,
        payload: { code, version, effectiveFrom: row.effective_from, expression: row.expression, ownerModule: row.owner_module, financial: row.financial === 1, tests: checked.tests.length, shadow: { runs: shadow.n, differing: shadow.d } },
        reason,
        chain: activationChain(row.owner_module, row.financial === 1),
      });
    },

    /**
     * Compare two versions on sample inputs (FR-05): the cases you give plus the inputs of recent real calculations. Reports each
     * case, the fields that differ and the size of the difference. Reads only.
     */
    compare(actor, code, { baselineVersion, candidateVersion, cases, useRecent }) {
      view(actor);
      if (baselineVersion === candidateVersion) throw badRequest('Pick two different versions to compare.');
      const base = rowOrThrow(code, baselineVersion);
      const cand = rowOrThrow(code, candidateVersion);
      const inputs = [...cases];
      if (useRecent > 0) {
        const recent = db.prepare('SELECT DISTINCT inputs_json FROM core_calc_traces WHERE company_id = ? AND formula_code = ? ORDER BY id DESC LIMIT ?').all(companyOf(actor), code, useRecent);
        for (const r of recent) inputs.push(JSON.parse(r.inputs_json));
      }
      if (inputs.length === 0) throw badRequest('Give at least one case, or ask for recent calculations.');
      const run = (def, i) => {
        try {
          return { outputs: runDefinition(def, i).outputs, error: null };
        } catch (err) {
          if (!(err instanceof CalcError)) throw err;
          return { outputs: null, error: err.message };
        }
      };
      const baseDef = definitionOf(base);
      const candDef = definitionOf(cand);
      let maxDiff = dec(0);
      const results = inputs.map((i, index) => {
        const a = run(baseDef, i);
        const b = run(candDef, i);
        const differences = [];
        if (a.outputs && b.outputs) {
          for (const k of new Set([...Object.keys(a.outputs), ...Object.keys(b.outputs)])) {
            if (a.outputs[k] !== b.outputs[k]) {
              let delta;
              try {
                delta = dec(b.outputs[k]).sub(a.outputs[k]).abs();
                if (delta.gt(maxDiff)) maxDiff = delta;
              } catch {
                delta = null; // a field that is not a number (text output) has no size of difference
              }
              differences.push({ field: k, baseline: a.outputs[k] ?? null, candidate: b.outputs[k] ?? null, difference: delta ? delta.toString() : null });
            }
          }
        }
        return { index: index + 1, inputs: i, baseline: a.outputs, candidate: b.outputs, baselineError: a.error, candidateError: b.error, differs: differences.length > 0 || a.error !== b.error, differences };
      });
      return {
        code,
        baselineVersion,
        candidateVersion,
        summary: { cases: results.length, differing: results.filter((r) => r.differs).length, identical: results.filter((r) => !r.differs).length, errors: results.filter((r) => r.baselineError || r.candidateError).length, maxDifference: maxDiff.toString() },
        results,
      };
    },

    /** What the live shadow run has found so far for a version in SHADOW mode. */
    shadowSummary(actor, code, { candidate }) {
      view(actor);
      const company = companyOf(actor);
      const where = '(company_id IS NULL OR company_id = :c) AND formula_code = :code AND (:cand IS NULL OR candidate_version = :cand)';
      const params = { c: company, code, cand: candidate ?? null };
      const s = db.prepare(`SELECT COUNT(*) AS runs, COALESCE(SUM(differs), 0) AS differing, COALESCE(SUM(candidate_error IS NOT NULL), 0) AS errors FROM core_calc_shadow_results WHERE ${where}`).get(params);
      const latest = db
        .prepare(`SELECT * FROM core_calc_shadow_results WHERE ${where} AND differs = 1 ORDER BY id DESC LIMIT 20`)
        .all(params)
        .map((r) => ({ id: r.id, baselineVersion: r.baseline_version, candidateVersion: r.candidate_version, inputs: JSON.parse(r.inputs_json), baseline: JSON.parse(r.baseline_json), candidate: JSON.parse(r.candidate_json), candidateError: r.candidate_error, computedAt: r.computed_at }));
      return { code, runs: s.runs, differing: s.differing, errors: s.errors, latestDifferences: latest };
    },

    /** The trace of each calculation behind a record's computed fields (needs view permission on the record). */
    traces(actor, { entity, entityId }) {
      const company = companyOf(actor);
      const def = fileEntities.get(entity);
      if (!def) throw unprocessable(`"${entity}" has no calculations to show.`);
      const record = def.resolve(db, actor, entityId);
      if (!record || record.companyId !== company) throw notFound('That record does not exist.');
      if (!record.canView) throw forbidden('You may not view this record, so you may not see how it was calculated.');
      const latest = db
        .prepare('SELECT * FROM core_calc_traces WHERE id IN (SELECT MAX(id) FROM core_calc_traces WHERE company_id = ? AND entity = ? AND entity_id = ? GROUP BY formula_code) ORDER BY id')
        .all(company, entity, entityId);
      return latest.map((t) => ({ ...JSON.parse(t.steps_json), computedAt: t.computed_at, computedBy: t.computed_by }));
    },

    // ---- units of measure ----
    listUoms(actor) {
      view(actor);
      return db.prepare('SELECT code, name, dimension FROM core_uoms WHERE deleted_at IS NULL ORDER BY dimension, code').all().map((u) => ({ ...u }));
    },
    createUom(actor, b, correlationId) {
      manage(actor);
      if (db.prepare('SELECT 1 FROM core_uoms WHERE code = ? AND deleted_at IS NULL').get(b.code)) throw conflict(`The unit ${b.code} already exists.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO core_uoms (code, name, dimension, created_by, source_type) VALUES (?, ?, ?, ?, 'uom')").run(b.code, b.name, b.dimension, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'core_uoms', entityId: id, action: 'create', newValues: b, reason: b.reason, actor: actor.user, correlationId });
        return { code: b.code, name: b.name, dimension: b.dimension };
      });
    },
    listConversions(actor, { itemCode }) {
      view(actor);
      return db
        .prepare('SELECT id, item_code, from_uom, to_uom, factor FROM core_uom_conversions WHERE deleted_at IS NULL AND (:item IS NULL OR item_code = :item OR item_code IS NULL) ORDER BY item_code IS NOT NULL, item_code, from_uom, to_uom')
        .all({ item: itemCode ?? null })
        .map((c) => ({ id: c.id, itemCode: c.item_code, from: c.from_uom, to: c.to_uom, factor: c.factor, scope: c.item_code ? 'item' : 'generic' }));
    },
    createConversion(actor, b, correlationId) {
      manage(actor);
      for (const u of [b.from, b.to]) if (!engine.uom.known(u)) throw notFound(`"${u}" is not a unit of measure. Add it first.`);
      if (b.from === b.to) throw badRequest('A unit cannot be converted to itself.');
      if (db.prepare("SELECT 1 FROM core_uom_conversions WHERE COALESCE(item_code, '') = ? AND from_uom = ? AND to_uom = ? AND deleted_at IS NULL").get(b.itemCode ?? '', b.from, b.to)) {
        throw conflict(`There is already a conversion from ${b.from} to ${b.to}${b.itemCode ? ` for ${b.itemCode}` : ''}.`);
      }
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO core_uom_conversions (item_code, from_uom, to_uom, factor, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'uom')").run(b.itemCode ?? null, b.from, b.to, b.factor, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'core_uom_conversions', entityId: id, action: 'create', newValues: b, reason: b.reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.uom_conversion.changed', entity: 'uom_conversion', entityId: id, actorId: actor.user, companyId: actor.companyId, correlationId, data: { from: b.from, to: b.to, itemCode: b.itemCode ?? null } });
        return { id, itemCode: b.itemCode ?? null, from: b.from, to: b.to, factor: b.factor, scope: b.itemCode ? 'item' : 'generic' };
      });
    },
    removeConversion(actor, id, correlationId) {
      manage(actor);
      const r = db.prepare('SELECT * FROM core_uom_conversions WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!r) throw notFound('That conversion does not exist.');
      return transaction(db, () => {
        const stamp = new Date().toISOString();
        db.prepare('UPDATE core_uom_conversions SET deleted_at = ?, deleted_by = ?, is_active = 0, updated_at = ? WHERE id = ?').run(stamp, actor.user, stamp, id);
        writeAudit(db, { entity: 'core_uom_conversions', entityId: id, action: 'delete', oldValues: { from: r.from_uom, to: r.to_uom, factor: r.factor, itemCode: r.item_code }, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.uom_conversion.changed', entity: 'uom_conversion', entityId: id, actorId: actor.user, companyId: actor.companyId, correlationId, data: { from: r.from_uom, to: r.to_uom, itemCode: r.item_code } });
        return { id, deleted: true };
      });
    },
    convert(actor, b) {
      view(actor);
      return engine.convert(b.quantity, b.from, b.to, { itemCode: b.itemCode ?? null });
    },
  };
}
