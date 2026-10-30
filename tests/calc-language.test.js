import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalcError, DIV_SCALE, ROUNDING_POLICIES, coerceInput, definitionProblems, parseProgram, runDefinition } from '../src/shared/calc.js';

const def = (expression, extra = {}) => ({
  expression,
  inputs: [{ name: 'x', type: 'decimal', required: false }, { name: 'y', type: 'decimal', required: false }],
  outputs: [{ name: 'r', type: 'decimal' }],
  rounding_policy: 'half_up',
  ...extra,
});
const run = (expression, inputs = {}, extra = {}) => runDefinition(def(expression, extra), inputs).outputs.r;
const money = (policy, x) => runDefinition({ expression: 'r = x', inputs: [{ name: 'x', type: 'decimal' }], outputs: [{ name: 'r', type: 'money' }], rounding_policy: policy }, { x }).outputs.r;

test('T-01 rounding at the x.xx5 boundaries for every policy', () => {
  const table = {
    half_up: { '2.345': '2.35', '2.355': '2.36', '2.365': '2.37', '-2.345': '-2.35', '0.005': '0.01', '1.005': '1.01', '2.344': '2.34', '2.3449': '2.34' },
    bankers: { '2.345': '2.34', '2.355': '2.36', '2.365': '2.36', '-2.345': '-2.34', '0.005': '0.00', '0.015': '0.02', '1.005': '1.00', '2.3451': '2.35', '2.3449': '2.34' },
    down: { '2.349': '2.34', '2.341': '2.34', '-2.349': '-2.34', '0.009': '0.00', '2.34': '2.34' },
    up: { '2.341': '2.35', '2.349': '2.35', '-2.341': '-2.35', '0.001': '0.01', '2.34': '2.34' },
  };
  for (const [policy, cases] of Object.entries(table)) {
    for (const [input, expected] of Object.entries(cases)) assert.equal(money(policy, input), expected, `${policy}: ${input}`);
  }
  assert.deepEqual(Object.keys(ROUNDING_POLICIES), ['half_up', 'bankers', 'down', 'up']);
});

test('round() inside a formula follows the policy, and can name a mode for one call', () => {
  assert.equal(run('r = round(x, 2)', { x: '2.345' }), '2.35');
  assert.equal(run('r = round(x, 2)', { x: '2.345' }, { rounding_policy: 'bankers' }), '2.34');
  assert.equal(run("r = round(x, 2, 'HALF_EVEN')", { x: '2.345' }), '2.34');
  assert.equal(run("r = round(x, 0, 'DOWN')", { x: '2.9' }), '2', 'a mode named in the call beats the policy');
  assert.throws(() => run("r = round(x, 2, 'SIDEWAYS')", { x: '1' }), /mode must be one of/);
  assert.throws(() => run('r = round(x, 9)', { x: '1' }), /0 to 8/);
  assert.throws(() => run('r = round(x, 1.5)', { x: '1' }), /whole number/);
});

test('arithmetic is exact: no floating-point error and only one rounding, at the output', () => {
  assert.equal(run('r = x + y', { x: '0.1', y: '0.2' }), '0.3');
  assert.equal(run('r = x * y', { x: '1.1', y: '1.1' }), '1.21');
  assert.equal(runDefinition({ expression: 'r = x / y', inputs: def('').inputs, outputs: [{ name: 'r', type: 'money' }], rounding_policy: 'half_up' }, { x: '10', y: '3' }).outputs.r, '3.33');
  assert.equal(runDefinition({ expression: 'a = x / y\nr = a * y', inputs: def('').inputs, outputs: [{ name: 'r', type: 'decimal' }], rounding_policy: 'half_up' }, { x: '10', y: '3' }).outputs.r, '9.999999999999', `division keeps ${DIV_SCALE} places`);
  assert.equal(run('r = 0.1 + 0.2 - 0.3'), '0');
  assert.equal(run('r = 7 % 3'), '1');
  assert.equal(run('r = -7 % 3'), '2', 'the remainder takes the sign of the divisor');
  assert.equal(run('r = 7.5 % 2'), '1.5');
});

test('operators have their usual precedence, and parentheses override it', () => {
  assert.equal(run('r = 2 + 3 * 4'), '14');
  assert.equal(run('r = (2 + 3) * 4'), '20');
  assert.equal(run('r = 10 - 2 - 3'), '5');
  assert.equal(run('r = -2 * -3'), '6');
  assert.equal(run('r = 100 / 4 / 5'), '5');
  assert.equal(run('r = if(1 + 1 == 2 && 3 > 2 || false, 1, 0)'), '1');
});

test('functions: min, max, abs, floor, ceil, percent, sum, if', () => {
  assert.equal(run('r = min(3, 1, 2)'), '1');
  assert.equal(run('r = max(3, 1.5, 2)'), '3');
  assert.equal(run('r = abs(-4.25)'), '4.25');
  assert.equal(run('r = floor(2.7)'), '2');
  assert.equal(run('r = floor(-2.1)'), '-3');
  assert.equal(run('r = ceil(2.1)'), '3');
  assert.equal(run('r = ceil(-2.9)'), '-2');
  assert.equal(run('r = percent(250, 18)'), '45');
  assert.equal(run('r = sum(1, 2, 3.5)'), '6.5');
  assert.equal(run("r = if(x > 5, 'big', 'small')", { x: '9' }, { outputs: [{ name: 'r', type: 'string' }] }), 'big');
  assert.equal(run('r = if(x > 5, 1 / 0, 2)', { x: '1' }), '2', 'if() evaluates only the branch it takes');
});

test('text and yes/no values compare but never mix with numbers', () => {
  const inputs = [{ name: 's', type: 'string', allowed: ['a', 'b'] }, { name: 'flag', type: 'boolean' }];
  const d = (expression) => ({ expression, inputs, outputs: [{ name: 'r', type: 'decimal' }], rounding_policy: 'half_up' });
  assert.equal(runDefinition(d("r = if(s == 'a', 1, 2)"), { s: 'a', flag: true }).outputs.r, '1');
  assert.equal(runDefinition(d("r = if(s != 'a', 1, 2)"), { s: 'a', flag: true }).outputs.r, '2');
  assert.equal(runDefinition(d('r = if(flag && !false, 1, 2)'), { s: 'b', flag: true }).outputs.r, '1');
  assert.throws(() => runDefinition(d("r = s + 1"), { s: 'a', flag: true }), /needs a number, not text/);
  assert.throws(() => runDefinition(d('r = if(1, 1, 2)'), { s: 'a', flag: true }), /yes\/no condition/);
  assert.throws(() => runDefinition(d('r = !1'), { s: 'a', flag: true }), /yes\/no value/);
  assert.throws(() => runDefinition(d('r = 1 && 2'), { s: 'a', flag: true }), /yes\/no/);
  assert.equal(runDefinition(d("r = if('1' == 1, 1, 2)"), { s: 'a', flag: true }).outputs.r, '2', 'text 1 is not number 1');
});

test('errors name the step and say what is wrong', () => {
  assert.throws(() => run('r = x / y', { x: '1', y: '0' }), (e) => e instanceof CalcError && e.step === 'r' && /Division by zero/.test(e.message));
  assert.throws(() => run('a = 1\nr = b + 1'), /"b" has no value/);
  assert.throws(() => run('r = 1 +'), /ends too soon/);
  assert.throws(() => run('r = (1 + 2'), /Expected "\)"/);
  assert.throws(() => run('r = 1 $ 2'), /Unexpected character "\$"/);
  assert.throws(() => run("r = 'open"), /not closed/);
  assert.throws(() => run('r = nope(1)'), /no function "nope"/);
  assert.throws(() => run('r = min()'), /at least|takes 1 to 20/);
  assert.throws(() => run('r = abs(1, 2)'), /takes 1 value/);
  assert.throws(() => run('a = 1\na = 2\nr = a'), /used twice/);
  assert.throws(() => run('1 + 1\nr = 2'), /Only the last step/);
  assert.throws(() => run(''), /empty/);
});

test('safety: a formula cannot loop, reach outside, or grow without limit', () => {
  assert.throws(() => parseProgram('r = ' + '('.repeat(60) + '1' + ')'.repeat(60)), /nested too deeply/);
  assert.throws(() => parseProgram(`r = ${'1 + '.repeat(2000)}1`), /longer than 4000/);
  assert.throws(() => parseProgram(Array.from({ length: 101 }, (_, i) => `s${i} = ${i}`).join('\n')), /at most 100 steps/);
  for (const bad of ['r = process.exit()', 'r = constructor', 'r = this', 'r = eval("1")', 'r = globalThis']) assert.throws(() => run(bad), CalcError, bad);
  assert.equal(run('# a comment\nr = 1 # trailing\n'), '1');
});

test('multiple outputs, unnamed last step, and the trace of every step', () => {
  const out = runDefinition(
    { expression: 'half = x / 2\nround(half * 3, 2)', inputs: [{ name: 'x', type: 'money' }], outputs: [{ name: 'half', type: 'money' }, { name: 'result', type: 'money' }], rounding_policy: 'half_up' },
    { x: '10.01' },
  );
  assert.deepEqual(out.outputs, { half: '5.01', result: '15.02' });
  assert.deepEqual(out.trace.steps.map((s) => [s.name, s.value]), [['half', '5.005'], ['result', '15.02']]);
  assert.deepEqual(out.trace.rounding, [{ name: 'half', from: '5.005', to: '5.01', mode: 'HALF_UP', places: 2 }]);
  assert.deepEqual(out.trace.inputs, { x: '10.01' });
});

test('inputs are checked against their declaration: type, decimal places, range, allowed values, defaults', () => {
  const m = { name: 'amount', type: 'money' };
  assert.equal(coerceInput(m, '12.34').toString(), '12.34');
  assert.equal(coerceInput(m, 12).toString(), '12');
  assert.equal(coerceInput(m, '12.30').toString(), '12.30', 'a trailing zero is not an extra place');
  assert.throws(() => coerceInput(m, '12.345'), /at most 2 decimal places/);
  assert.throws(() => coerceInput({ name: 'q', type: 'quantity' }, '1.2345'), /at most 3 decimal/);
  assert.throws(() => coerceInput({ name: 'n', type: 'integer' }, '1.5'), /at most 0 decimal/);
  assert.throws(() => coerceInput(m, 'abc'), /must be a number/);
  assert.equal(coerceInput(m, 1.5).toString(), '1.5', 'a JSON number is accepted when it has no more places than the type allows');
  assert.throws(() => coerceInput(m, 0.1 + 0.2), /at most 2 decimal places/, 'floating-point noise is refused, never rounded away');
  assert.throws(() => coerceInput(m, undefined), /is required/);
  assert.equal(coerceInput({ ...m, required: false }, undefined), undefined);
  assert.equal(coerceInput({ ...m, default: '5' }, undefined).toString(), '5');
  assert.throws(() => coerceInput({ ...m, min: '0' }, '-1'), /at least 0/);
  assert.throws(() => coerceInput({ ...m, max: '100' }, '101'), /at most 100/);
  assert.equal(coerceInput({ name: 's', type: 'string', allowed: ['a'] }, 'a'), 'a');
  assert.throws(() => coerceInput({ name: 's', type: 'string', allowed: ['a'] }, 'b'), /one of a/);
  assert.throws(() => coerceInput({ name: 'b', type: 'boolean' }, 'true'), /true or false/);
});

test('a definition is checked before it is saved: syntax, unknown names, outputs, declarations', () => {
  const ok = { expression: 'a = x * 2\nr = a + 1', inputs: [{ name: 'x', type: 'money' }], outputs: [{ name: 'r', type: 'money' }], rounding_policy: 'half_up' };
  assert.deepEqual(definitionProblems(ok), []);
  assert.match(definitionProblems({ ...ok, expression: 'r = x * z' })[0], /Unknown name: z/);
  assert.match(definitionProblems({ ...ok, outputs: [{ name: 'q', type: 'money' }] }).join(), /"q" is not a step/);
  assert.match(definitionProblems({ ...ok, outputs: [] }).join(), /at least one output/);
  assert.match(definitionProblems({ ...ok, inputs: [{ name: 'X', type: 'money' }] }).join(), /lower-case/);
  assert.match(definitionProblems({ ...ok, inputs: [{ name: 'x', type: 'money' }, { name: 'x', type: 'money' }] }).join(), /declared twice/);
  assert.match(definitionProblems({ ...ok, inputs: [{ name: 'x', type: 'weird' }] }).join(), /unknown type/);
  assert.match(definitionProblems({ ...ok, rounding_policy: 'sideways' }).join(), /Unknown rounding policy/);
  assert.match(definitionProblems({ ...ok, expression: 'x = 1\nr = x' })[0], /same name as an input/);
  assert.match(definitionProblems({ ...ok, expression: 'r = (' })[0], /ends too soon|Unexpected/);
});
