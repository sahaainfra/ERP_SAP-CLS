// The calculation language and evaluator (part 01.06). A formula is a short program over named inputs:
//
//     taxable = round(quantity * rate, 2)
//     gst     = if(supply == 'intra', taxable * pct / 100, 0)
//     total   = taxable + gst
//
// Every value is an exact Decimal, a string or a boolean; there is no floating point, no loop, no assignment to inputs
// and no access to anything outside the program, so a formula cannot do harm and always ends. The evaluator returns the
// result AND the steps taken, which is what "Show calculation" displays. Shared by server and browser.
import { Decimal, ROUND, dec } from './decimal.js';

export const DIV_SCALE = 12; // an unrounded division keeps 12 places; results are rounded once, at the output
export const MAX_SOURCE = 4000;
export const MAX_STEPS = 100;
const MAX_DEPTH = 40;

/** Decimal places each kind of value may carry (standards section 4.3). */
export const TYPE_SCALE = Object.freeze({ money: 2, rate: 4, quantity: 3, percent: 4 });
export const INPUT_TYPES = Object.freeze(['money', 'rate', 'quantity', 'percent', 'decimal', 'integer', 'string', 'boolean']);
export const OUTPUT_TYPES = Object.freeze(['money', 'rate', 'quantity', 'percent', 'decimal', 'integer', 'string', 'boolean']);

/** The rounding policies a formula may name. `bankers` is half-even, for statutory rounding. */
export const ROUNDING_POLICIES = Object.freeze({
  half_up: { mode: ROUND.HALF_UP, label: 'Half up (commercial: 2.345 becomes 2.35)' },
  bankers: { mode: ROUND.HALF_EVEN, label: "Banker's (half even: 2.345 becomes 2.34, 2.355 becomes 2.36)" },
  down: { mode: ROUND.DOWN, label: 'Down (towards zero)' },
  up: { mode: ROUND.UP, label: 'Up (away from zero)' },
});

export class CalcError extends Error {
  constructor(message, { step = null, position = null } = {}) {
    super(message);
    this.name = 'CalcError';
    this.step = step;
    this.position = position;
  }
}

// ---- tokens ----
const KEYWORDS = new Set(['true', 'false']);

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
    } else if (c === '\n' || c === ';') {
      tokens.push({ type: 'sep', pos: i });
      i += 1;
    } else if (c === '#') {
      while (i < source.length && source[i] !== '\n') i += 1; // comment to the end of the line
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+/.exec(source.slice(i));
      tokens.push({ type: 'num', value: m[0], pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      tokens.push({ type: KEYWORDS.has(m[0]) ? 'bool' : 'id', value: m[0], pos: i });
      i += m[0].length;
    } else if (c === "'" || c === '"') {
      const end = source.indexOf(c, i + 1);
      if (end < 0 || source.slice(i + 1, end).includes('\n')) throw new CalcError('A text value is not closed', { position: i });
      tokens.push({ type: 'str', value: source.slice(i + 1, end), pos: i });
      i = end + 1;
    } else {
      const two = source.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        tokens.push({ type: 'op', value: two, pos: i });
        i += 2;
      } else if ('+-*/%(),<>!='.includes(c)) {
        tokens.push({ type: 'op', value: c, pos: i });
        i += 1;
      } else {
        throw new CalcError(`Unexpected character "${c}"`, { position: i });
      }
    }
  }
  return tokens;
}

// ---- parser (precedence climbing) ----
const BINARY = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const FUNCTIONS = Object.freeze({
  round: { min: 2, max: 3 }, min: { min: 1, max: 20 }, max: { min: 1, max: 20 }, abs: { min: 1, max: 1 }, floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 }, if: { min: 3, max: 3 }, percent: { min: 2, max: 2 }, sum: { min: 1, max: 20 },
});

function parseExpression(tokens, start, end, text) {
  let p = start;
  const peek = () => (p < end ? tokens[p] : null);
  const take = () => tokens[p++];
  const expectOp = (value) => {
    const t = peek();
    if (!t || t.type !== 'op' || t.value !== value) throw new CalcError(`Expected "${value}"${t ? ` but found "${t.value ?? t.type}"` : ' at the end'}`, { position: t?.pos ?? text.length });
    p += 1;
  };
  const primary = (depth) => {
    if (depth > MAX_DEPTH) throw new CalcError('The expression is nested too deeply');
    const t = take();
    if (!t) throw new CalcError('The expression ends too soon', { position: text.length });
    if (t.type === 'num') return { kind: 'num', value: t.value };
    if (t.type === 'str') return { kind: 'str', value: t.value };
    if (t.type === 'bool') return { kind: 'bool', value: t.value === 'true' };
    if (t.type === 'id') {
      if (peek()?.type === 'op' && peek().value === '(') {
        const spec = FUNCTIONS[t.value];
        if (!spec) throw new CalcError(`There is no function "${t.value}". Available: ${Object.keys(FUNCTIONS).join(', ')}`, { position: t.pos });
        take();
        const args = [];
        if (!(peek()?.type === 'op' && peek().value === ')')) {
          for (;;) {
            args.push(binary(0, depth + 1));
            if (peek()?.type === 'op' && peek().value === ',') take();
            else break;
          }
        }
        expectOp(')');
        if (args.length < spec.min || args.length > spec.max) throw new CalcError(`${t.value}() takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} value(s), not ${args.length}`, { position: t.pos });
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'ref', name: t.value, pos: t.pos };
    }
    if (t.type === 'op' && t.value === '(') {
      const inner = binary(0, depth + 1);
      expectOp(')');
      return inner;
    }
    if (t.type === 'op' && (t.value === '-' || t.value === '+' || t.value === '!')) return { kind: 'unary', op: t.value, arg: primary(depth + 1) };
    throw new CalcError(`Unexpected "${t.value ?? t.type}"`, { position: t.pos });
  };
  const binary = (minPrec, depth) => {
    let left = primary(depth);
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'op' || !(t.value in BINARY) || BINARY[t.value] <= minPrec) break;
      take();
      left = { kind: 'bin', op: t.value, left, right: binary(BINARY[t.value], depth + 1) };
    }
    return left;
  };
  const ast = binary(0, 0);
  if (p < end) throw new CalcError(`Unexpected "${tokens[p].value ?? tokens[p].type}"`, { position: tokens[p].pos });
  return ast;
}

/** Parse a program into statements: [{ name, source, ast }]. The last statement without a name is called "result". */
export function parseProgram(source) {
  if (typeof source !== 'string' || source.trim() === '') throw new CalcError('The formula is empty');
  if (source.length > MAX_SOURCE) throw new CalcError(`The formula is longer than ${MAX_SOURCE} characters`);
  const tokens = tokenize(source);
  const statements = [];
  let from = 0;
  const flush = (to) => {
    if (to > from) {
      const isAssign = tokens[from].type === 'id' && tokens[from + 1]?.type === 'op' && tokens[from + 1].value === '=' && to > from + 2;
      const name = isAssign ? tokens[from].value : null;
      const bodyStart = isAssign ? from + 2 : from;
      const startPos = tokens[bodyStart].pos;
      const endPos = to < tokens.length ? tokens[to].pos : source.length;
      statements.push({ name, source: source.slice(startPos, endPos).trim(), ast: parseExpression(tokens, bodyStart, to, source) });
    }
  };
  tokens.forEach((t, i) => {
    if (t.type === 'sep') {
      flush(i);
      from = i + 1;
    }
  });
  flush(tokens.length);
  if (statements.length === 0) throw new CalcError('The formula is empty');
  if (statements.length > MAX_STEPS) throw new CalcError(`A formula may have at most ${MAX_STEPS} steps`);
  const seen = new Set();
  statements.forEach((s, i) => {
    if (s.name === null) {
      if (i !== statements.length - 1) throw new CalcError('Only the last step may be left without a name');
      s.name = 'result';
    }
    if (seen.has(s.name)) throw new CalcError(`The step name "${s.name}" is used twice`);
    seen.add(s.name);
  });
  return statements;
}

function referencesOf(ast, out = new Set()) {
  if (ast.kind === 'ref') out.add(ast.name);
  else if (ast.kind === 'bin') {
    referencesOf(ast.left, out);
    referencesOf(ast.right, out);
  } else if (ast.kind === 'unary') referencesOf(ast.arg, out);
  else if (ast.kind === 'call') ast.args.forEach((a) => referencesOf(a, out));
  return out;
}

/** Names a formula uses before they exist, in step order: for the editor to say "unknown input". */
export function unknownReferences(statements, inputNames) {
  const known = new Set(inputNames);
  const unknown = [];
  for (const s of statements) {
    for (const r of referencesOf(s.ast)) if (!known.has(r) && !unknown.includes(r)) unknown.push(r);
    known.add(s.name);
  }
  return unknown;
}

// ---- evaluation ----
const isDec = (v) => v instanceof Decimal;
const kindOf = (v) => (isDec(v) ? 'a number' : typeof v === 'string' ? 'text' : 'a yes/no value');
const numeric = (v, what) => {
  if (!isDec(v)) throw new CalcError(`${what} needs a number, not ${kindOf(v)}`);
  return v;
};
const floorDec = (x) => {
  const r = x.round(0, ROUND.DOWN);
  return x.isNegative() && !r.eq(x) ? r.sub(1) : r;
};

function evaluateNode(node, env, policy) {
  switch (node.kind) {
    case 'num': return dec(node.value);
    case 'str': return node.value;
    case 'bool': return node.value;
    case 'ref': {
      if (!env.has(node.name)) throw new CalcError(`"${node.name}" has no value`, { position: node.pos });
      return env.get(node.name);
    }
    case 'unary': {
      const v = evaluateNode(node.arg, env, policy);
      if (node.op === '!') {
        if (typeof v !== 'boolean') throw new CalcError(`! needs a yes/no value, not ${kindOf(v)}`);
        return !v;
      }
      numeric(v, node.op);
      return node.op === '-' ? v.neg() : v;
    }
    case 'bin': {
      if (node.op === '&&' || node.op === '||') {
        const l = evaluateNode(node.left, env, policy);
        if (typeof l !== 'boolean') throw new CalcError(`${node.op} needs yes/no values, not ${kindOf(l)}`);
        if (node.op === '&&' ? !l : l) return l;
        const r = evaluateNode(node.right, env, policy);
        if (typeof r !== 'boolean') throw new CalcError(`${node.op} needs yes/no values, not ${kindOf(r)}`);
        return r;
      }
      const l = evaluateNode(node.left, env, policy);
      const r = evaluateNode(node.right, env, policy);
      if (node.op === '==' || node.op === '!=') {
        if (isDec(l) !== isDec(r)) return node.op === '!=';
        const same = isDec(l) ? l.eq(r) : l === r;
        return node.op === '==' ? same : !same;
      }
      if (['<', '<=', '>', '>='].includes(node.op)) {
        const c = numeric(l, node.op).cmp(numeric(r, node.op));
        return node.op === '<' ? c < 0 : node.op === '<=' ? c <= 0 : node.op === '>' ? c > 0 : c >= 0;
      }
      numeric(l, node.op);
      numeric(r, node.op);
      if (node.op === '+') return l.add(r);
      if (node.op === '-') return l.sub(r);
      if (node.op === '*') return l.mul(r);
      if (r.isZero()) throw new CalcError('Division by zero');
      if (node.op === '/') return l.div(r, DIV_SCALE);
      // remainder: l - r * floor(l / r)
      return l.sub(r.mul(floorDec(l.div(r, DIV_SCALE + 6, ROUND.DOWN))));
    }
    case 'call': {
      if (node.name === 'if') {
        const c = evaluateNode(node.args[0], env, policy);
        if (typeof c !== 'boolean') throw new CalcError(`if() needs a yes/no condition, not ${kindOf(c)}`);
        return evaluateNode(node.args[c ? 1 : 2], env, policy);
      }
      const args = node.args.map((a) => evaluateNode(a, env, policy));
      switch (node.name) {
        case 'round': {
          const places = numeric(args[1], 'round() places');
          if (!places.eq(places.round(0)) || places.isNegative() || places.gt(8)) throw new CalcError('round() places must be a whole number from 0 to 8');
          let mode = policy.mode;
          if (args[2] !== undefined) {
            if (typeof args[2] !== 'string' || !ROUND[args[2]]) throw new CalcError(`round() mode must be one of ${Object.keys(ROUND).map((m) => `'${m}'`).join(', ')}`);
            mode = args[2];
          }
          return numeric(args[0], 'round()').round(Number(places.units / 10n ** BigInt(places.scale)), mode);
        }
        case 'min': return args.map((a) => numeric(a, 'min()')).reduce((a, b) => (b.lt(a) ? b : a));
        case 'max': return args.map((a) => numeric(a, 'max()')).reduce((a, b) => (b.gt(a) ? b : a));
        case 'abs': return numeric(args[0], 'abs()').abs();
        case 'floor': return floorDec(numeric(args[0], 'floor()'));
        case 'ceil': return floorDec(numeric(args[0], 'ceil()').neg()).neg();
        case 'percent': return numeric(args[0], 'percent()').mul(numeric(args[1], 'percent()')).div(100, DIV_SCALE);
        case 'sum': return args.map((a) => numeric(a, 'sum()')).reduce((a, b) => a.add(b), Decimal.zero());
        default: throw new CalcError(`There is no function "${node.name}"`);
      }
    }
    default: throw new CalcError('Unknown expression');
  }
}

/** How a value appears in a trace: trailing zeros of an unrounded intermediate are dropped (227.777400000000 shows as 227.7774). */
const trimZeros = (text) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);
const show = (v) => (isDec(v) ? trimZeros(v.toString()) : typeof v === 'boolean' ? String(v) : v);

/** Check one input value against its declaration. Returns the evaluator's value or throws CalcError. */
export function coerceInput(def, raw) {
  const missing = raw === undefined || raw === null || raw === '';
  if (missing) {
    if (def.default !== undefined) return coerceInput({ ...def, default: undefined, required: false }, def.default);
    if (def.required === false) return undefined;
    throw new CalcError(`${def.name} is required`);
  }
  if (def.type === 'string') {
    if (typeof raw !== 'string') throw new CalcError(`${def.name} must be text`);
    if (def.allowed && !def.allowed.includes(raw)) throw new CalcError(`${def.name} must be one of ${def.allowed.join(', ')}`);
    return raw;
  }
  if (def.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new CalcError(`${def.name} must be true or false`);
    return raw;
  }
  let value;
  try {
    value = dec(typeof raw === 'number' && !Number.isSafeInteger(raw) ? String(raw) : raw);
  } catch {
    throw new CalcError(`${def.name} must be a number`);
  }
  const scale = def.type === 'integer' ? 0 : TYPE_SCALE[def.type];
  const significant = (value.toString().split('.')[1] ?? '').replace(/0+$/, '').length;
  if (scale !== undefined && significant > scale) throw new CalcError(`${def.name} may have at most ${scale} decimal place${scale === 1 ? '' : 's'}`);
  if (def.min !== undefined && value.lt(def.min)) throw new CalcError(`${def.name} must be at least ${def.min}`);
  if (def.max !== undefined && value.gt(def.max)) throw new CalcError(`${def.name} must be at most ${def.max}`);
  return value;
}

/**
 * Run a formula definition against inputs. `definition` = { expression, inputs: [{ name, type, required?, default?, min?, max?, allowed? }],
 * outputs: [{ name, type }], rounding_policy }. Returns { outputs, trace } where outputs are strings (exact decimals) and trace lists
 * every step. Throws CalcError with the step that failed.
 */
export function runDefinition(definition, rawInputs = {}) {
  const policy = ROUNDING_POLICIES[definition.rounding_policy ?? 'half_up'];
  if (!policy) throw new CalcError(`Unknown rounding policy "${definition.rounding_policy}"`);
  const statements = parseProgram(definition.expression);
  const env = new Map();
  const inputsUsed = {};
  for (const def of definition.inputs ?? []) {
    const value = coerceInput(def, rawInputs[def.name]);
    if (value !== undefined) {
      env.set(def.name, value);
      inputsUsed[def.name] = show(value);
    }
  }
  const steps = [];
  for (const s of statements) {
    try {
      const value = evaluateNode(s.ast, env, policy);
      env.set(s.name, value);
      steps.push({ name: s.name, formula: s.source, value: show(value) });
    } catch (err) {
      if (err instanceof CalcError) throw new CalcError(`Step "${s.name}" (${s.source}): ${err.message}`, { step: s.name });
      throw err;
    }
  }
  const outputs = {};
  const rounding = [];
  for (const out of definition.outputs ?? []) {
    if (!env.has(out.name)) throw new CalcError(`The output "${out.name}" is not a step of the formula`, { step: out.name });
    const v = env.get(out.name);
    if (!isDec(v) || !TYPE_SCALE[out.type]) {
      outputs[out.name] = show(v);
      continue;
    }
    const rounded = v.round(TYPE_SCALE[out.type], policy.mode);
    outputs[out.name] = rounded.toFixed(TYPE_SCALE[out.type]);
    if (!rounded.eq(v)) rounding.push({ name: out.name, from: trimZeros(v.toString()), to: outputs[out.name], mode: policy.mode, places: TYPE_SCALE[out.type] });
  }
  return { outputs, trace: { inputs: inputsUsed, steps, rounding, policy: definition.rounding_policy ?? 'half_up', mode: policy.mode } };
}

/** Problems with a formula definition (empty when it is sound): syntax, unknown names, undeclared outputs, bad declarations. */
export function definitionProblems(def) {
  const problems = [];
  const names = new Set();
  for (const i of def.inputs ?? []) {
    if (!/^[a-z][a-z0-9_]*$/.test(i.name ?? '')) problems.push(`Input name "${i.name}" must be lower-case letters, digits and underscores`);
    else if (names.has(i.name)) problems.push(`Input "${i.name}" is declared twice`);
    names.add(i.name);
    if (!INPUT_TYPES.includes(i.type)) problems.push(`Input "${i.name}" has an unknown type "${i.type}"`);
  }
  if (!ROUNDING_POLICIES[def.rounding_policy ?? 'half_up']) problems.push(`Unknown rounding policy "${def.rounding_policy}"`);
  let statements = null;
  try {
    statements = parseProgram(def.expression);
  } catch (err) {
    problems.push(err.message);
  }
  if (statements) {
    const unknown = unknownReferences(statements, [...names]);
    if (unknown.length) problems.push(`Unknown name${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')} (not an input or an earlier step)`);
    for (const s of statements) if (names.has(s.name)) problems.push(`The step "${s.name}" has the same name as an input`);
    const stepNames = new Set(statements.map((s) => s.name));
    if (!def.outputs?.length) problems.push('Declare at least one output');
    for (const o of def.outputs ?? []) {
      if (!OUTPUT_TYPES.includes(o.type)) problems.push(`Output "${o.name}" has an unknown type "${o.type}"`);
      if (!stepNames.has(o.name)) problems.push(`The output "${o.name}" is not a step of the formula`);
    }
  }
  return problems;
}
