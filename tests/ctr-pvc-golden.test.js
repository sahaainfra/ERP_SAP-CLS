import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { escalationOf } from '../src/server/modules/ctr/pvc.js';

// PACK-17: price variation formulas checked against standard Indian clause shapes, with golden outputs.
//  - CPWD clause 10CC style: V = W x X/100 x (Pi - Po)/Po per component, W being the value of work done less the materials issued at fixed
//    rates and the secured advance (the exclusions); materials on the WPI, labour on the CPI-IW, POL on the WPI fuel group.
//  - MoRTH / NHAI item-rate style: Va = 0.85 x Pa/100 x R x (Ai - Ao)/Ao per component, the 15 % non-adjustable part carried by the factor
//    0.85; cement, steel, bitumen, POL, plant and other materials, some indices falling.
//  - a deflation month, every index below its base, the escalation recovered (negative).
// The expected amounts come from an independent exact-rational oracle (BigInt, the paisa rounded once per component, half up as the
// application does) and are frozen in tests/fixtures/pvc-clauses.golden.json. The index values are illustrative, not published figures.
// QS review of the golden file is PENDING (pack acceptance "PVC golden outputs"). GOLDEN_CAPTURE=1 rewrites the file from the oracle.
const FILE = new URL('./fixtures/pvc-clauses.golden.json', import.meta.url);
const ix = (v) => Math.round(v * 10000); // the index master stores x10000
const k = (pa, factor = 1) => Math.round(pa * factor * 100); // percent to basis points, exactly representable for these cases

const CASES = [
  { id: 'CPWD-10CC', clause: 'CPWD GCC clause 10CC style (component percentages of the value of work done)', rPaise: 2_374_567_890, excludedPaise: 182_500_000,
    components: [
      { code: 'X', label: 'Materials (excluding cement and steel)', indexCode: 'WPI-ALL', kBp: k(30), base: ix(138.4), current: ix(152.9) },
      { code: 'Y', label: 'Labour', indexCode: 'CPI-IW', kBp: k(25), base: ix(118.5), current: ix(131.2) },
      { code: 'Z', label: 'POL', indexCode: 'WPI-FUEL', kBp: k(5), base: ix(141.7), current: ix(157.3) },
    ] },
  { id: 'MORTH-0.85', clause: 'MoRTH / NHAI item-rate style (0.85 x Pa per component)', rPaise: 5_123_456_789, excludedPaise: 0,
    components: [
      { code: 'L', label: 'Labour', indexCode: 'CPI-IW', kBp: k(15, 0.85), base: ix(124.2), current: ix(133.0) },
      { code: 'C', label: 'Cement', indexCode: 'WPI-CEMENT', kBp: k(10, 0.85), base: ix(132.9), current: ix(128.4) },
      { code: 'S', label: 'Steel', indexCode: 'WPI-STEEL', kBp: k(12, 0.85), base: ix(151.3), current: ix(162.8) },
      { code: 'B', label: 'Bitumen (refinery price per tonne)', indexCode: 'BITUMEN-VG30', kBp: k(8, 0.85), base: ix(48250), current: ix(52610) },
      { code: 'F', label: 'POL (HSD price per litre)', indexCode: 'HSD', kBp: k(10, 0.85), base: ix(89.62), current: ix(92.15) },
      { code: 'P', label: 'Plant and machinery', indexCode: 'WPI-MACH', kBp: k(10, 0.85), base: ix(125.4), current: ix(131.7) },
      { code: 'M', label: 'Other materials', indexCode: 'WPI-ALL', kBp: k(35, 0.85), base: ix(141.0), current: ix(149.6) },
    ] },
  { id: 'DEFLATION', clause: 'Either clause in a month when every index falls (recovery)', rPaise: 987_654_321, excludedPaise: 12_345_678,
    components: [
      { code: 'X', label: 'Materials', indexCode: 'WPI-ALL', kBp: k(40), base: ix(150.2), current: ix(147.9) },
      { code: 'Y', label: 'Labour', indexCode: 'CPI-IW', kBp: k(20), base: ix(131.4), current: ix(130.8) },
      { code: 'Z', label: 'POL', indexCode: 'WPI-FUEL', kBp: k(15), base: ix(160.0), current: ix(151.3) },
    ] },
];

// the oracle: exact rationals; Math.round semantics (floor of x + 1/2) applied once per component
const roundHalfUp = (num, den) => { const n = 2n * num + den; const d = 2n * den; const q = n / d; return (n % d !== 0n && (n < 0n) !== (d < 0n)) ? q - 1n : q; };
const oracle = (c) => {
  const eligible = BigInt(Math.max(0, c.rPaise - c.excludedPaise));
  const lines = c.components.map((x) => Number(roundHalfUp(eligible * BigInt(x.kBp) * BigInt(x.current - x.base), BigInt(x.base) * 10000n)));
  const gross = lines.reduce((a, b) => a + b, 0);
  return { eligiblePaise: Number(eligible), lines, grossPaise: gross, amountPaise: gross };
};

test('PACK-17 PVC golden: CPWD 10CC, MoRTH 0.85 and a deflation month match the frozen golden file and the exact oracle to the paisa', () => {
  const computed = Object.fromEntries(CASES.map((c) => [c.id, { clause: c.clause, ...oracle(c) }]));
  if (process.env.GOLDEN_CAPTURE === '1') writeFileSync(FILE, `${JSON.stringify({ reviewedByQs: 'PENDING', note: 'Index values illustrative; amounts in paise', cases: computed }, null, 1)}\n`);
  const golden = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const c of CASES) {
    const g = golden.cases[c.id];
    assert.deepEqual({ clause: c.clause, ...oracle(c) }, g, `${c.id}: the oracle agrees with the golden file`);
    const e = escalationOf({ rPaise: c.rPaise, excludedPaise: c.excludedPaise, components: c.components });
    assert.equal(e.eligiblePaise, g.eligiblePaise, `${c.id} eligible`);
    assert.deepEqual(e.lines.map((l) => l.amountPaise), g.lines, `${c.id} per component`);
    assert.equal(e.grossPaise, g.grossPaise, `${c.id} gross`);
    assert.equal(e.amountPaise, g.amountPaise, `${c.id} payable`);
    assert.equal(e.trace.length, c.components.length + 3, `${c.id}: the workings show every component`);
  }
  assert.ok(golden.cases.DEFLATION.amountPaise < 0, 'falling indices recover money');
  assert.ok(golden.cases['MORTH-0.85'].lines[1] < 0, 'the cement index fell: that component is negative while the total is positive');
  // the 0.85 factor is carried in the coefficient: 15 % of Pa is never adjusted
  assert.equal(CASES[1].components.reduce((a, x) => a + x.kBp, 0), 8500);
});

test('PACK-17 PVC golden: the coefficient resolution is 0.01 % — 0.85 x 17.5 % (14.875 %) is not representable (D-866)', () => {
  // the API turns coefficientPct into basis points with Math.round(pct x 100) (ctr/pvc.js formulas.set); 14.875 % becomes 14.88 %
  const exact = 0.85 * 17.5 * 100; const stored = Math.round(exact);
  assert.equal(exact, 1487.5); assert.equal(stored, 1488);
  const comp = (kBp) => [{ code: 'L', label: 'Labour', indexCode: 'CPI-IW', kBp, base: ix(124.2), current: ix(133.0) }];
  const a = escalationOf({ rPaise: 5_123_456_789, components: comp(stored) }).amountPaise; const b = escalationOf({ rPaise: 5_123_456_789, components: comp(exact) }).amountPaise;
  assert.equal(a - b, 18_151, 'Rs 181.51 too much on a Rs 5.12 crore bill in one month — recorded as D-866, not fixed here');
});
