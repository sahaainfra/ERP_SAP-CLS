import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_FORMULAS, createCalcEngine, definitionOf, definitionHash, runTests } from '../src/server/platform/calc/index.js';
import { ensureReferenceUnits } from '../src/server/platform/calc/reference.js';
import { ROOT } from '../src/server/platform/db/index.js';
import { runDefinition } from '../src/shared/calc.js';
import { CASES, GOLDEN_IDS } from '../golden/calc_cases.mjs';
import { LEGACY } from './helpers/legacy_calcs.js';
import { memoryDb } from './helpers.js';

function setup() {
  const db = memoryDb();
  const engine = createCalcEngine({ db });
  engine.ensureBuiltins();
  ensureReferenceUnits(db);
  return { db, engine };
}
const conv = (db, item, from, to, factor) => db.prepare('INSERT INTO core_uom_conversions (item_code, from_uom, to_uom, factor) VALUES (?, ?, ?, ?)').run(item, from, to, factor);

// ---- T-04 golden outputs ----
test('T-04 the engine reproduces the original code and the captured golden outputs exactly', () => {
  for (const [code, id] of Object.entries(GOLDEN_IDS)) {
    const f = BUILTIN_FORMULAS.find((b) => b.code === code);
    const definition = { expression: f.expression, inputs: f.inputs, outputs: f.outputs, rounding_policy: f.roundingPolicy };
    const golden = JSON.parse(readFileSync(join(ROOT, 'golden', 'outputs', `${id}.json`), 'utf8'));
    assert.equal(golden.length, CASES[code].length, id);
    for (const [i, inputs] of CASES[code].entries()) {
      assert.deepEqual(runDefinition(definition, inputs).outputs, LEGACY[code](inputs), `${code} case ${i}: the engine against the original code`);
      assert.deepEqual(golden[i], { inputs, outputs: LEGACY[code](inputs) }, `${id} case ${i}: the golden file`);
    }
  }
});

test('T-04 on 3000 pseudo-random cases the engine and the original code never differ by a single paisa', () => {
  let seed = 20261030;
  const next = (max) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % max;
  };
  const num = (whole, places) => `${next(whole)}.${String(next(10 ** places)).padStart(places, '0')}`;
  const defs = Object.fromEntries(BUILTIN_FORMULAS.map((f) => [f.code, { expression: f.expression, inputs: f.inputs, outputs: f.outputs, rounding_policy: f.roundingPolicy }]));
  const gen = {
    'boq.line_amount': () => ({ quantity: num(100000, 3), rate: num(100000, 4) }),
    'tax.gst_split': () => ({ taxable: num(10_000_000, 2), gst_percent: [num(30, 4), '18', '5', '12'][next(4)], supply: next(2) ? 'intra' : 'inter' }),
    'stock.weighted_average': () => ({ opening_qty: num(5000, 3), opening_value: num(1_000_000, 2), receipt_qty: num(5000, 3), receipt_rate: num(1000, 4) }),
    'billing.net_payable': () => ({ gross: num(100_000_000, 2), retention_percent: num(15, 4), tds_percent: num(15, 4) }),
  };
  for (const [code, make] of Object.entries(gen)) {
    for (let i = 0; i < 750; i += 1) {
      const inputs = make();
      assert.deepEqual(runDefinition(defs[code], inputs).outputs, LEGACY[code](inputs), `${code} ${JSON.stringify(inputs)}`);
    }
  }
});

test('FR-06 every built-in formula is registered as version 1, passes its own tests, and the code cannot drift from the stored version', () => {
  const { db, engine } = setup();
  const rows = db.prepare('SELECT * FROM core_formulas ORDER BY code').all();
  assert.deepEqual(rows.map((r) => [r.code, r.formula_version, r.status, r.owner_module]), [
    ['billing.net_payable', 1, 'ACTIVE', 'billing'], ['boq.line_amount', 1, 'ACTIVE', 'boq'], ['ra.line_amount', 1, 'ACTIVE', 'mdm'], ['ra.unit_rate', 1, 'ACTIVE', 'mdm'], ['stock.weighted_average', 1, 'ACTIVE', 'stores'], ['tax.gst_split', 1, 'ACTIVE', 'tax'], ['tdr.bid_capacity', 1, 'ACTIVE', 'bd'],
  ]);
  for (const r of rows) assert.ok(runTests(definitionOf(r), JSON.parse(r.tests_json)).every((t) => t.ok), `${r.code} tests`);
  assert.deepEqual(engine.ensureBuiltins(), [], 'running it again changes nothing and finds no drift');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_formulas').get().n, 7);
  db.exec("UPDATE core_formulas SET description = 'edited by an administrator' WHERE code = 'boq.line_amount'");
  assert.deepEqual(engine.ensureBuiltins(), [], 'a changed description is not drift; the calculation is');
  assert.equal(definitionHash({ expression: 'a', inputs: [], outputs: [], roundingPolicy: 'half_up' }), definitionHash({ expression: 'a', inputs: [], outputs: [], rounding_policy: 'half_up' }));
});

// ---- the engine ----
test('FR-04 evaluate resolves the version in force, stores the trace for a record, and the trace can reproduce the value', () => {
  const { db, engine } = setup();
  const r = engine.evaluate('boq.line_amount', { quantity: '12.5', rate: '101.2345' }, { entity: 'sample_bill', entityId: 7, companyId: 1, user: 'asha' });
  assert.deepEqual([r.result.amount, r.formula], ['1265.43', { code: 'boq.line_amount', version: 1 }]);
  assert.equal(r.trace.formula.expression, 'amount = round(quantity * rate, 2)');
  assert.deepEqual(r.trace.steps, [{ name: 'amount', formula: 'round(quantity * rate, 2)', value: '1265.43' }]);
  const row = db.prepare('SELECT * FROM core_calc_traces').get();
  assert.deepEqual([row.formula_code, row.formula_version, row.entity, row.entity_id, row.company_id, row.computed_by], ['boq.line_amount', 1, 'sample_bill', 7, 1, 'asha']);
  const stored = JSON.parse(row.steps_json);
  assert.deepEqual(runDefinition({ ...definitionOf(db.prepare('SELECT * FROM core_formulas WHERE code = ?').get('boq.line_amount')) }, stored.inputs).outputs, stored.outputs, 'the stored inputs give the stored result again');
  engine.evaluate('boq.line_amount', { quantity: '1', rate: '1' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_calc_traces').get().n, 1, 'no trace without a record');
});

test('invalid inputs and unknown formulas are reported, naming the field', () => {
  const { engine } = setup();
  assert.throws(() => engine.evaluate('boq.line_amount', { quantity: '1.2345', rate: '1' }), (e) => e.status === 422 && /at most 3 decimal places/.test(e.message));
  assert.throws(() => engine.evaluate('boq.line_amount', { quantity: '-1', rate: '1' }), /at least 0/);
  assert.throws(() => engine.evaluate('tax.gst_split', { taxable: '1', gst_percent: '18', supply: 'abroad' }), /one of intra, inter/);
  assert.throws(() => engine.evaluate('nope.nothing', {}), (e) => e.status === 404);
  assert.throws(() => engine.evaluate('boq.line_amount', { quantity: '1', rate: '1' }, { version: 9 }), /no version 9/);
});

test('BR-01 a pinned version keeps calculating the same way after a newer version takes over', () => {
  const { db, engine } = setup();
  db.prepare(
    `INSERT INTO core_formulas (code, formula_version, description, owner_module, financial, expression, inputs_json, outputs_json, rounding_policy, tests_json, effective_from, status)
     SELECT code, 2, description, owner_module, financial, 'amount = round(quantity * rate, 0)', inputs_json, outputs_json, rounding_policy, tests_json, '2026-06-01', 'ACTIVE' FROM core_formulas WHERE code = 'boq.line_amount'`,
  ).run();
  db.prepare("UPDATE core_formulas SET effective_to = '2026-05-31' WHERE code = 'boq.line_amount' AND formula_version = 1").run();
  const inputs = { quantity: '12.5', rate: '101.2345' };
  assert.equal(engine.evaluate('boq.line_amount', inputs, { date: '2026-05-31' }).result.amount, '1265.43', 'on the old date the old version applies');
  assert.equal(engine.evaluate('boq.line_amount', inputs, { date: '2026-06-01' }).result.amount, '1265.00', 'from its date the new one');
  assert.equal(engine.evaluate('boq.line_amount', inputs, { date: '2026-06-01', version: 1 }).result.amount, '1265.43', 'a document pinned to version 1 stays on it');
  assert.throws(() => engine.evaluate('boq.line_amount', inputs, { date: '2025-12-31' }), /No version .* is in force/);
});

test('BR-02 a version that is no longer a draft cannot be edited, in the database itself', () => {
  const { db } = setup();
  for (const column of ['expression', 'inputs_json', 'outputs_json', 'rounding_policy', 'tests_json', 'effective_from', 'owner_module', 'financial', 'formula_version', 'code']) {
    const value = column === 'financial' ? 0 : column === 'formula_version' ? 9 : column === 'rounding_policy' ? 'down' : 'x';
    assert.throws(() => db.prepare(`UPDATE core_formulas SET ${column} = ? WHERE code = 'boq.line_amount'`).run(value), /no longer a draft/, column);
  }
  db.prepare("UPDATE core_formulas SET description = 'a clearer description', effective_to = '2030-01-01' WHERE code = 'boq.line_amount'").run();
  db.prepare("INSERT INTO core_formulas (code, formula_version, description, owner_module, expression, inputs_json, outputs_json, effective_from, status) VALUES ('x.y', 1, 'a draft', 'x', 'r = 1', '[]', '[]', '2026-12-01', 'DRAFT')").run();
  db.prepare("UPDATE core_formulas SET expression = 'r = 2' WHERE code = 'x.y'").run(); // a draft may change
  db.prepare("UPDATE core_formulas SET status = 'SHADOW' WHERE code = 'x.y'").run();
  assert.throws(() => db.prepare("UPDATE core_formulas SET expression = 'r = 3' WHERE code = 'x.y'").run(), /no longer a draft/, 'locked once it runs in shadow');
});

// ---- FR-05 shadow mode ----
test('T-03 / FR-05 a version in shadow mode runs beside the active one and every difference is recorded', () => {
  const { db, engine } = setup();
  db.prepare(
    `INSERT INTO core_formulas (code, formula_version, description, owner_module, financial, expression, inputs_json, outputs_json, rounding_policy, tests_json, effective_from, status)
     SELECT code, 2, 'rounds to the nearest rupee', owner_module, financial, 'amount = round(quantity * rate, 0)', inputs_json, outputs_json, rounding_policy, tests_json, '2026-11-01', 'SHADOW' FROM core_formulas WHERE code = 'boq.line_amount'`,
  ).run();
  const cases = [{ quantity: '10', rate: '100' }, { quantity: '12.5', rate: '101.2345' }, { quantity: '3', rate: '0.005' }, { quantity: '1', rate: '2.5' }];
  const answers = cases.map((c) => engine.evaluate('boq.line_amount', c, { companyId: 1 }).result.amount);
  assert.deepEqual(answers, ['1000.00', '1265.43', '0.02', '2.50'], 'the active version still decides every result');
  const rows = db.prepare('SELECT * FROM core_calc_shadow_results ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.baseline_version, r.candidate_version, r.differs]), [[1, 2, 0], [1, 2, 1], [1, 2, 1], [1, 2, 1]]);
  assert.deepEqual([JSON.parse(rows[1].baseline_json), JSON.parse(rows[1].candidate_json)], [{ amount: '1265.43' }, { amount: '1265.00' }]);
  engine.evaluate('boq.line_amount', cases[0], { shadow: false });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_calc_shadow_results').get().n, 4, 'the test bench can run without recording');
  assert.throws(() => engine.evaluate('boq.line_amount', { quantity: '1', rate: '1' }, { version: 2, entity: 'x', entityId: 1 }), /shadow formula version cannot calculate a record/, 'a version still being compared never decides a record');
});

// ---- T-02 UOM conversion ----
test('T-02 / FR-03 an item-specific conversion beats the generic one for the same pair', () => {
  const { db, engine } = setup();
  assert.equal(engine.convert('2', 'MT', 'KG').result, '2000.000', 'generic');
  conv(db, 'ODD_ITEM', 'MT', 'KG', '990');
  assert.equal(engine.convert('2', 'MT', 'KG', { itemCode: 'ODD_ITEM' }).result, '1980.000', 'the item row wins');
  assert.equal(engine.convert('2', 'MT', 'KG', { itemCode: 'ODD_ITEM' }).path[0].source, 'item');
  assert.equal(engine.convert('2', 'MT', 'KG', { itemCode: 'OTHER_ITEM' }).result, '2000.000', 'another item still gets the generic factor');
  assert.equal(engine.convert('2', 'MT', 'KG').result, '2000.000', 'and so does a conversion with no item');
  assert.equal(engine.convert('1980', 'KG', 'MT', { itemCode: 'ODD_ITEM' }).result, '2.000', 'the reverse direction uses the item row too');
});

test('FR-03 cement bags to tonnes and steel bars to kilograms chain item and generic factors exactly', () => {
  const { db, engine } = setup();
  conv(db, 'CEMENT', 'BAG', 'KG', '50');
  conv(db, 'TMT12', 'NOS', 'KG', '10.656');
  const bags = engine.convert('100', 'BAG', 'MT', { itemCode: 'CEMENT' });
  assert.deepEqual([bags.result, bags.path.map((p) => `${p.from}>${p.to}:${p.source}`)], ['5.000', ['BAG>KG:item', 'KG>MT:generic']]);
  assert.equal(engine.convert('1', 'MT', 'BAG', { itemCode: 'CEMENT' }).result, '20.000');
  assert.equal(engine.convert('250', 'NOS', 'KG', { itemCode: 'TMT12' }).result, '2664.000');
  assert.equal(engine.convert('1', 'MT', 'NOS', { itemCode: 'TMT12' }).result, '93.844', '1000 / 10.656 = 93.8438..., rounded once');
  assert.equal(engine.convert('7', 'BAG', 'MT', { itemCode: 'CEMENT' }).result, '0.350');
  assert.equal(engine.convert('0.333', 'M', 'MM').result, '333.000');
  assert.equal(engine.convert('100', 'SQM', 'SQFT').result, '1076.391', 'a long factor is kept whole and rounded once');
  assert.equal(engine.convert('5', 'KG', 'KG').result, '5.000');
  assert.equal(engine.convert('1', 'KG', 'G', { scale: 0 }).result, '1000');
  assert.equal(engine.convert('2.5', 'NOS', 'KG', { itemCode: 'TMT12', scale: 1, mode: 'DOWN' }).result, '26.6');
});

test('conversion refuses what it cannot do: unknown units, no route, and units of another dimension without an item factor', () => {
  const { engine } = setup();
  assert.throws(() => engine.convert('1', 'XYZ', 'KG'), (e) => e.status === 404 && /not a unit of measure/.test(e.message));
  assert.throws(() => engine.convert('1', 'BAG', 'KG'), (e) => e.status === 422 && /no conversion from BAG to KG/i.test(e.message));
  assert.throws(() => engine.convert('1', 'BAG', 'MT', { itemCode: 'NO_FACTOR' }), /for NO_FACTOR/);
  assert.throws(() => engine.convert('abc', 'KG', 'G'), /not a decimal number/);
});
