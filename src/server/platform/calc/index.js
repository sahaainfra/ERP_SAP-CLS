import { createHash } from 'node:crypto';
import { CalcError, definitionProblems, runDefinition } from '../../../shared/calc.js';
import { todayIST } from '../../../shared/dates.js';
import { HttpError, notFound, unprocessable } from '../http/errors.js';
import { BUILTIN_FORMULAS } from './builtins.js';
import { createUomService } from './uom.js';

export { BUILTIN_FORMULAS } from './builtins.js';
export { createUomService } from './uom.js';

const iso = () => new Date().toISOString();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A formula row as the evaluator takes it. */
export const definitionOf = (row) => ({
  code: row.code,
  version: row.formula_version,
  expression: row.expression,
  inputs: JSON.parse(row.inputs_json),
  outputs: JSON.parse(row.outputs_json),
  rounding_policy: row.rounding_policy,
});

/** Run a formula's own test cases. Returns [{ index, ok, expected, actual, error }]. */
export function runTests(def, tests) {
  return tests.map((tc, index) => {
    try {
      const { outputs } = runDefinition(def, tc.inputs);
      const wrong = Object.entries(tc.expect).filter(([k, v]) => outputs[k] !== v);
      return { index, ok: wrong.length === 0, expected: tc.expect, actual: outputs, error: wrong.length ? `Expected ${wrong.map(([k, v]) => `${k} ${v}`).join(', ')} but got ${wrong.map(([k]) => `${k} ${outputs[k]}`).join(', ')}` : null };
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      return { index, ok: false, expected: tc.expect, actual: null, error: err.message };
    }
  });
}

export const definitionHash = (b) =>
  createHash('sha256').update(JSON.stringify([b.expression, b.inputs, b.outputs, b.roundingPolicy ?? b.rounding_policy])).digest('hex');

/**
 * The calculation engine: the one place business calculations run. It resolves the formula version in force on a date,
 * evaluates it with exact decimals, keeps a trace for audited values (FR-04) and runs any version in SHADOW alongside
 * the active one, recording the differences (FR-05). Other modules call evaluate()/convert(), never their own arithmetic.
 */
export function createCalcEngine({ db, now = iso }) {
  const uom = createUomService({ db });

  /** Make sure the built-in formulas exist as version 1. Returns the codes whose stored definition differs from the code (drift). */
  function ensureBuiltins() {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO core_formulas (company_id, code, formula_version, description, owner_module, financial, expression, inputs_json, outputs_json, rounding_policy, tests_json,
                                           effective_from, status, activated_at, activated_by, created_by, source_type)
       VALUES (NULL, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE', ?, 'system', 'system', 'builtin')`,
    );
    const drift = [];
    for (const b of BUILTIN_FORMULAS) {
      insert.run(b.code, b.description, b.ownerModule, b.financial ? 1 : 0, b.expression, JSON.stringify(b.inputs), JSON.stringify(b.outputs), b.roundingPolicy, JSON.stringify(b.tests), now());
      const row = db.prepare('SELECT * FROM core_formulas WHERE code = ? AND formula_version = 1').get(b.code);
      const stored = { expression: row.expression, inputs: JSON.parse(row.inputs_json), outputs: JSON.parse(row.outputs_json), roundingPolicy: row.rounding_policy };
      if (definitionHash(stored) !== definitionHash(b)) drift.push(b.code);
    }
    return drift;
  }

  /** The version in force on `date` (an ACTIVE or RETIRED row whose dates cover it), or a named version. */
  function resolve(code, { date = todayIST(), version = null } = {}) {
    if (version !== null) {
      const row = db.prepare('SELECT * FROM core_formulas WHERE code = ? AND formula_version = ? AND deleted_at IS NULL').get(code, version);
      if (!row) throw notFound(`There is no version ${version} of the formula ${code}.`);
      return row;
    }
    const row = db
      .prepare("SELECT * FROM core_formulas WHERE code = ? AND status IN ('ACTIVE', 'RETIRED') AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND deleted_at IS NULL ORDER BY effective_from DESC, formula_version DESC LIMIT 1")
      .get(code, date, date);
    if (!row) throw notFound(`No version of the formula ${code} is in force on ${date}.`);
    return row;
  }

  const shadowVersions = (code) => db.prepare("SELECT * FROM core_formulas WHERE code = ? AND status = 'SHADOW' AND deleted_at IS NULL ORDER BY formula_version").all(code);

  function recordShadow(baseline, candidate, inputs, baseOut, companyId) {
    let candOut = null;
    let error = null;
    try {
      candOut = runDefinition(definitionOf(candidate), inputs).outputs;
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      error = err.message;
    }
    const differs = error !== null || !same(baseOut, candOut);
    db.prepare(
      `INSERT INTO core_calc_shadow_results (company_id, formula_code, baseline_version, candidate_version, inputs_json, baseline_json, candidate_json, differs, candidate_error, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(companyId, baseline.code, baseline.formula_version, candidate.formula_version, JSON.stringify(inputs), JSON.stringify(baseOut), JSON.stringify(candOut), differs ? 1 : 0, error, now());
  }

  return {
    uom,
    ensureBuiltins,
    resolve,

    /**
     * Evaluate a formula. `version` pins one (a document keeps the version it was calculated with: BR-01); otherwise the version
     * in force on `date` is used. With `entity` and `entityId` the trace is stored for "Show calculation". Throws a 422 that names the
     * failing step when an input or a step is invalid.
     * @returns {{ result: Record<string, string>, trace: any, formula: { code: string, version: number } }}
     */
    /** @param {string} code @param {Record<string, any>} inputs @param {{ date?: string, version?: number | null, entity?: string | null, entityId?: number | null, field?: string, companyId?: number | null, user?: string | null, shadow?: boolean }} [options] */
    evaluate(code, inputs, { date = undefined, version = null, entity = null, entityId = null, field = '', companyId = null, user = null, shadow = true } = {}) {
      const row = resolve(code, { date, version });
      if (['DRAFT', 'SHADOW'].includes(row.status) && entity) throw unprocessable(`A ${row.status.toLowerCase()} formula version cannot calculate a record. Only an active version can.`);
      let out;
      try {
        out = runDefinition(definitionOf(row), inputs);
      } catch (err) {
        if (err instanceof CalcError) throw new HttpError(422, 'BUSINESS_RULE', `Calculation ${code} v${row.formula_version} failed: ${err.message}`, [{ field: err.step ?? 'inputs', message: err.message }]);
        throw err;
      }
      const trace = { formula: { code, version: row.formula_version, description: row.description, expression: row.expression, roundingPolicy: row.rounding_policy }, ...out.trace, outputs: out.outputs };
      if (entity !== null) {
        db.prepare(
          `INSERT INTO core_calc_traces (company_id, formula_code, formula_version, entity, entity_id, field, inputs_json, result_json, steps_json, computed_by, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(companyId ?? 0, code, row.formula_version, entity, entityId, field, JSON.stringify(out.trace.inputs), JSON.stringify(out.outputs), JSON.stringify(trace), user, now());
      }
      if (shadow && row.status !== 'SHADOW') for (const cand of shadowVersions(code)) recordShadow(row, cand, inputs, out.outputs, companyId);
      return { result: out.outputs, trace, formula: { code, version: row.formula_version } };
    },

    /** Convert a quantity between units (FR-03). */
    convert: (quantity, fromUom, toUom, options) => uom.convert(quantity, fromUom, toUom, options),

    /** Check a definition and its test cases. Returns { problems, tests } (problems empty = sound). */
    check(def, tests = []) {
      const problems = definitionProblems(def);
      return { problems, tests: problems.length ? [] : runTests(def, tests) };
    },
  };
}

const engines = new WeakMap();
/** One engine per database, shared by the module that mounts the routes and by any module that calculates (`calcOf(db).evaluate(...)`). */
export function calcOf(db) {
  let e = engines.get(db);
  if (!e) {
    e = createCalcEngine({ db });
    engines.set(db, e);
  }
  return e;
}
