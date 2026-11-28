import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// PACK-19: bar bending schedule golden outputs, through the API (the shape library of est/mto.js and the calculation mto.bbs_line).
// Each shape code of the library is measured once, plus a straight bar of every common diameter for the unit weight d x d / 162 (kg/m,
// three places, rounded down as in the tables). The expected cut lengths, unit weights and weights come from an independent oracle in
// exact integers (micrometres and grams), written from the rule as documented:
//   cut length = legs + (hooks x hook allowance - bend deductions) x d, with the bend deductions 45° 1d, 90° 2d, 135° 3d (IS 2502 / SP 34 practice)
// and are frozen in tests/fixtures/bbs.golden.json. QS review of that file is PENDING. Two points are for the QS (see the file's notes and
// DEFECTS D-872, D-873): the closed stirrup (51) adds two 10d hooks and deducts three 90° bends but not the two 135° hook bends; laps are
// not part of any shape. GOLDEN_CAPTURE=1 rewrites the file from the oracle.
const FILE = new URL('./fixtures/bbs.golden.json', import.meta.url);
const E = '/api/v1/est';
const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `bbsg-${Math.random().toString(36).slice(2, 12)}` });
const est = { roles: 'EST', user: 'gest1', company: '1' };
const apis = []; after(async () => { for (const a of apis) await a.close(); });

// the shape library as documented (legs coefficients, hooks x allowance in d, bends): written here independently of the module
const RULE = { '00': { legs: { a: 1 }, hooks: 0, hookD: 0, bends: {} }, '11': { legs: { a: 1, b: 1 }, hooks: 0, hookD: 0, bends: { d90: 1 } }, '21': { legs: { a: 1, b: 1, c: 1 }, hooks: 0, hookD: 0, bends: { d90: 2 } },
  '33': { legs: { a: 1 }, hooks: 2, hookD: 9, bends: {} }, '41': { legs: { a: 1, b: 1, c: 1 }, hooks: 0, hookD: 0, bends: { d45: 4 } }, '51': { legs: { a: 2, b: 2 }, hooks: 2, hookD: 10, bends: { d90: 3 } },
  '99': { legs: { a: 1, b: 1, c: 1, d: 1 }, hooks: 0, hookD: 0, bends: {} } };
const DED = { d45: 1, d90: 2, d135: 3 };
const LINES = [
  { barMark: 'S00', dia: 12, shapeCode: '00', a: '6', membersCount: 10, barsEach: 10 },
  { barMark: 'S11', dia: 16, shapeCode: '11', a: '3', b: '0.5', membersCount: 10, barsEach: 4 },
  { barMark: 'S21', dia: 20, shapeCode: '21', a: '0.6', b: '2.4', c: '0.6', membersCount: 6, barsEach: 5 },
  { barMark: 'S33', dia: 10, shapeCode: '33', a: '3.2', membersCount: 4, barsEach: 6 },
  { barMark: 'S41', dia: 25, shapeCode: '41', a: '1.5', b: '0.707', c: '1.5', membersCount: 2, barsEach: 8 },
  { barMark: 'S51', dia: 8, shapeCode: '51', a: '0.3', b: '0.45', membersCount: 30, barsEach: 1 },
  { barMark: 'S99', dia: 12, shapeCode: '99', a: '1.25', b: '0.4', c: '1.25', d: '0.3', membersCount: 1, barsEach: 12 },
  ...[6, 8, 10, 12, 16, 20, 25, 28, 32, 36, 40].map((dia) => ({ barMark: `W${dia}`, dia, shapeCode: '00', a: '12', membersCount: 1, barsEach: 1 })),
];
// the oracle in integers: lengths in micrometres (m x 10^6), unit weight in grams per metre, weight in milligrams; half-up to 3 places
const um = (s) => { const [i, f = ''] = String(s).split('.'); return Number(i) * 1_000_000 + Number(f.padEnd(6, '0').slice(0, 6)); };
const r3 = (x, unit) => Math.floor((x + unit / 2) / unit) * unit; // half up to the unit (x >= 0)
const fmt = (micro) => (micro / 1_000_000).toFixed(3);
function oracle(l) {
  const s = RULE[l.shapeCode]; const legs = Object.entries(s.legs).reduce((n, [k, c]) => n + um(l[k]) * c, 0); const bendD = Object.entries(s.bends).reduce((n, [k, c]) => n + c * DED[k], 0);
  const cut = r3(legs + (s.hooks * s.hookD - bendD) * l.dia * 1000, 1000); const nos = l.membersCount * l.barsEach; const total = cut * nos;
  const gpm = Math.floor((l.dia * l.dia * 1000) / 162); // grams per metre, three places of kg, rounded down
  const weightMg = r3(Math.round((total * gpm) / 1000), 1000); // micrometres x g/m / 1000 = milligrams
  return { barMark: l.barMark, shapeCode: l.shapeCode, dia: l.dia, nos, cutLength: fmt(cut), totalLength: fmt(total), unitWeight: (gpm / 1000).toFixed(3), weightKg: (weightMg / 1_000_000).toFixed(3) };
}
// IS 1786 nominal mass (kg/m, from 7850 kg/m³) for comparison only: d x d / 162 is the field rule the pack asks for, within 0.25 % of it
const IS1786 = { 6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 16: 1.58, 20: 2.47, 25: 3.85, 28: 4.83, 32: 6.31, 36: 7.99, 40: 9.86 };

test('PACK-19 BBS golden: every shape code and the unit weights of 6 to 40 mm match the oracle and the frozen golden file to the gram', async () => {
  const api = await startApi(); apis.push(api); await setupCompany(api);
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'gest1', 'gest1', '[\"EST\"]', 'gest1@example.com')").run();
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'BBG', 'Golden towers', 'BUILDING')").run().lastInsertRowid);
  const call = (method, path, body) => api.call(method, `${E}${path}`, { ...est, headers: key(), body });
  const c = await call('POST', '/bbs', { title: 'Golden schedule', projectId: project, drawingRef: 'STR-G-1', drawingRev: 'A', member: 'G1' }); assert.equal(c.status, 201, JSON.stringify(c.json));
  const put = await call('PUT', `/bbs/${c.json.data.id}/lines`, { lines: LINES.map((l) => ({ member: 'G1', ...l })), version: c.json.data.rowVersion }); assert.equal(put.status, 200, JSON.stringify(put.json));
  const lib = put.json.data.shapes; for (const [code, s] of Object.entries(RULE)) { const m = lib.find((x) => x.code === code); assert.ok(m, `shape ${code} in the library`); assert.deepEqual([m.legs, m.hooks, m.hookD, m.bends], [s.legs, s.hooks, s.hookD, s.bends], `shape ${code} is as documented`); }
  assert.deepEqual(put.json.data.deductions, DED, 'bend deductions 45° 1d, 90° 2d, 135° 3d');
  const expected = LINES.map(oracle);
  if (process.env.GOLDEN_CAPTURE === '1') writeFileSync(FILE, `${JSON.stringify({ reviewedByQs: 'PENDING', notes: ['Unit weight is d x d / 162 rounded down to 3 places; it is within 0.25 % of the IS 1786 nominal mass (e.g. 20 mm 2.469 against 2.47, 25 mm 3.858 against 3.85).', 'Shape 51 (closed stirrup): 2(a+b) + 2 x 10d - 3 x 2d = 2(a+b) + 14d; practice that also deducts the two 135° hook bends (2 x 3d) gives 2(a+b) + 8d (D-872).', 'Laps are not part of any shape (D-873).'], lines: expected }, null, 1)}\n`);
  const golden = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.deepEqual(expected, golden.lines, 'the oracle agrees with the golden file');
  const got = Object.fromEntries(put.json.data.lines.map((l) => [l.barMark, l]));
  const norm = (v) => Number(v).toFixed(3);
  for (const g of golden.lines) { const l = got[g.barMark]; assert.ok(l, g.barMark); assert.deepEqual([l.nos, norm(l.cutLength), norm(l.totalLength), norm(l.unitWeight), norm(l.weightKg)], [g.nos, g.cutLength, g.totalLength, g.unitWeight, g.weightKg], `${g.barMark} (shape ${g.shapeCode}, ${g.dia} mm)`); }
  // the unit weights against the IS 1786 table: within 0.25 % (d x d / 162 is a little heavier; the rounding down can make it 0.001 lighter)
  for (const [dia, is] of Object.entries(IS1786)) { const uw = Number(got[`W${dia}`].unitWeight); assert.ok(Math.abs(uw - is) / is <= 0.0025, `${dia} mm: ${uw} against ${is}`); }
  const total = golden.lines.reduce((n, l) => n + Math.round(Number(l.weightKg) * 1000), 0); assert.equal(Math.round(Number(put.json.data.weightKg) * 1000), total, 'the schedule total is the sum of the bar marks');
});
