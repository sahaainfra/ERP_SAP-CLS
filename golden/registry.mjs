// Golden-output registry (FR-05, AC-04 of 00.01). Every business calculation or report
// registers a deterministic run() here; outputs are stored in golden/outputs/<id>.json
// and compared byte-for-byte by `npm run erp:golden` and `npm run erp:regression`.
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { resolveFlag } from '../src/server/modules/core/feature-flags/service.js';
import { BUILTIN_FORMULAS } from '../src/server/platform/calc/builtins.js';
import { calcOf } from '../src/server/platform/calc/index.js';
import { ensureReferenceUnits } from '../src/server/platform/calc/reference.js';
import { runDefinition } from '../src/shared/calc.js';
import { CASES, GOLDEN_IDS } from './calc_cases.mjs';

function flagEvaluationMatrix() {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  const ins = db.prepare(
    `INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, project_id, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // Fixed fixture: base OFF, production ON, company 1 OFF, project 11 of company 1 ON.
  ins.run('ff.golden.demo', 'golden fixture', 0, null, null, null, 0);
  ins.run('ff.golden.demo', 'golden fixture', 0, 'production', null, null, 1);
  ins.run('ff.golden.demo', 'golden fixture', 0, null, 1, null, 0);
  ins.run('ff.golden.demo', 'golden fixture', 0, null, 1, 11, 1);
  const rows = [];
  for (const environment of ['development', 'production']) {
    for (const [companyId, projectId] of [[null, null], [1, null], [1, 11], [1, 12], [2, 11]]) {
      rows.push({ environment, companyId, projectId, ...resolveFlag(db, 'ff.golden.demo', { environment, companyId, projectId }) });
    }
  }
  rows.push({ environment: 'production', companyId: null, projectId: null, ...resolveFlag(db, 'ff.golden.missing', { environment: 'production' }) });
  db.close();
  return rows;
}

/** One built-in calculation, run through the engine on its fixed cases. The golden file was captured from the code the engine replaced. */
function engineGolden(code) {
  const f = BUILTIN_FORMULAS.find((b) => b.code === code);
  const definition = { expression: f.expression, inputs: f.inputs, outputs: f.outputs, rounding_policy: f.roundingPolicy };
  return CASES[code].map((inputs) => ({ inputs, outputs: runDefinition(definition, inputs).outputs }));
}

function uomConversions() {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  ensureReferenceUnits(db);
  db.prepare("INSERT INTO core_uom_conversions (item_code, from_uom, to_uom, factor) VALUES ('CEMENT_OPC53', 'BAG', 'KG', '50')").run();
  db.prepare("INSERT INTO core_uom_conversions (item_code, from_uom, to_uom, factor) VALUES ('STEEL_TMT12', 'NOS', 'KG', '10.656')").run();
  db.prepare("INSERT INTO core_uom_conversions (item_code, from_uom, to_uom, factor) VALUES ('STEEL_TMT16', 'NOS', 'KG', '18.944')").run();
  const engine = calcOf(db);
  const cases = [
    ['100', 'BAG', 'MT', 'CEMENT_OPC53'], ['1', 'MT', 'BAG', 'CEMENT_OPC53'], ['37', 'BAG', 'KG', 'CEMENT_OPC53'], ['250', 'NOS', 'KG', 'STEEL_TMT12'],
    ['1', 'MT', 'NOS', 'STEEL_TMT12'], ['120', 'NOS', 'MT', 'STEEL_TMT16'], ['2.5', 'MT', 'KG', null], ['1250', 'KG', 'MT', null], ['100', 'SQM', 'SQFT', null],
    ['3', 'CUM', 'L', null], ['0.333', 'M', 'MM', null], ['5', 'KG', 'KG', null],
  ];
  const out = cases.map(([qty, from, to, itemCode]) => ({ qty, from, to, itemCode, ...engine.convert(qty, from, to, { itemCode }) }));
  db.close();
  return out;
}

export const registry = [
  { id: 'prog.flag_evaluation_matrix', description: 'Feature flag precedence over environment x company x project', run: flagEvaluationMatrix },
  ...Object.entries(GOLDEN_IDS).map(([code, id]) => ({ id, description: `Calculation ${code} on its fixed cases, through the engine`, run: () => engineGolden(code) })),
  { id: 'calc.uom_conversions', description: 'Unit conversions with item-specific factors and chains', run: uomConversions },
];
