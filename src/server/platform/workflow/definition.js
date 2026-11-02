import { z } from 'zod';
import { badRequest } from '../http/errors.js';
import { systemActions, workflowResolvers } from './registry.js';

// The shape of a workflow definition (FR-01): an ordered graph of steps and the settings that apply to the whole definition. Everything is validated
// again on the server whatever the editor sent.
export const STEP_TYPES = ['approval', 'review', 'notification', 'system'];
export const STEP_MODES = ['single', 'parallel_all', 'parallel_any'];
export const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'];

const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/, 'letters, digits and underscores, starting with a letter');
const roleCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}(\|[A-Z][A-Z0-9_]{1,19})*$/, 'a role code such as PM, or alternatives such as ITADM|DIR');
const condition = z.object({ field: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,59}$/), op: z.enum(OPS), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]) }).strict();
const approver = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('role'), role: roleCode }).strict(),
  z.object({ kind: z.literal('user'), user: z.string().min(2).max(60) }).strict(),
  z.object({ kind: z.literal('manager') }).strict(),
  z.object({ kind: z.literal('resolver'), resolver: z.string().min(2).max(60) }).strict(),
]);
const step = z.object({
  code,
  name: z.string().trim().min(2).max(80),
  type: z.enum(STEP_TYPES).default('approval'),
  mode: z.enum(STEP_MODES).default('single'),
  approvers: z.array(approver).max(8).default([]),
  slaHours: z.number().int().min(1).max(2160).nullable().default(null),
  requireAttachment: z.boolean().default(false),
  checklist: z.array(z.string().trim().min(2).max(120)).max(12).default([]),
  when: condition.nullable().default(null),
  notify: z.array(approver).max(8).default([]),
  action: z.string().max(60).nullable().default(null),
}).strict();
const settings = z.object({ resubmit: z.enum(['first', 'returning_step']).default('first'), distinctApprovers: z.boolean().default(true) }).strict();
export const definitionBody = z.object({
  docType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/),
  name: z.string().trim().min(3).max(120),
  settings: settings.default({ resubmit: 'first', distinctApprovers: true }),
  steps: z.array(step).min(1).max(20),
}).strict();

/** Check a definition (the server-side rules the editor mirrors) and return it with its defaults filled. Throws a 400 naming each problem. */
export function normaliseDefinition(input, { forDocType } = {}) {
  const parsed = definitionBody.safeParse(input);
  if (!parsed.success) throw badRequest('The workflow definition is not valid.', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  const def = parsed.data;
  const problems = [];
  const seen = new Set();
  def.steps.forEach((s, i) => {
    const at = `steps.${i}`;
    if (seen.has(s.code)) problems.push({ field: `${at}.code`, message: `the step code ${s.code} is used twice` });
    seen.add(s.code);
    if (s.type === 'approval' || s.type === 'review') {
      if (s.approvers.length === 0) problems.push({ field: `${at}.approvers`, message: 'a step that asks for a decision needs at least one approver' });
      if (s.mode === 'single' && s.approvers.length > 1) problems.push({ field: `${at}.approvers`, message: 'a single step has one approver; choose "all" or "any" to ask several' });
      if (s.mode !== 'single' && s.approvers.length < 2 && !s.approvers.some((a) => a.kind === 'resolver')) problems.push({ field: `${at}.approvers`, message: 'a parallel step needs at least two approvers' });
    } else if (s.approvers.length > 0) problems.push({ field: `${at}.approvers`, message: `a ${s.type} step does not decide, so it has no approvers (use "notify")` });
    if (s.type === 'notification' && s.notify.length === 0) problems.push({ field: `${at}.notify`, message: 'a notification step needs someone to notify' });
    if (s.type === 'system' && !(s.action && systemActions.get(s.action))) problems.push({ field: `${at}.action`, message: `the system action "${s.action ?? ''}" does not exist; choose one of ${systemActions.names().join(', ') || '(none registered)'}` });
    for (const a of [...s.approvers, ...s.notify]) if (a.kind === 'resolver' && !workflowResolvers.get(a.resolver)) problems.push({ field: `${at}.approvers`, message: `the resolver "${a.resolver}" does not exist` });
    if (s.type !== 'system' && s.action) problems.push({ field: `${at}.action`, message: 'only a system step has an action' });
  });
  if (!def.steps.some((s) => s.type === 'approval' || s.type === 'review')) problems.push({ field: 'steps', message: 'a workflow needs at least one step that asks for a decision' });
  if (forDocType && def.docType !== forDocType) problems.push({ field: 'docType', message: 'the document type of a definition cannot be changed' });
  if (problems.length) throw badRequest('The workflow definition is not valid.', problems);
  return def;
}

/** What a stored definition is: settings and steps (steps_json). */
export const packSteps = (def) => JSON.stringify({ settings: def.settings, steps: def.steps });
export function unpackSteps(json) {
  const o = JSON.parse(json);
  return Array.isArray(o) ? { settings: { resubmit: 'first', distinctApprovers: true }, steps: o } : o;
}

const lookup = (obj, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);
/** Does the context meet a step's condition? No condition always meets. */
export function meets(cond, context) {
  if (!cond) return true;
  const v = lookup(context ?? {}, cond.field);
  if (v === undefined || v === null) return false;
  const n = (x) => (typeof x === 'number' ? x : Number(x));
  switch (cond.op) {
    case 'eq': return String(v) === String(cond.value);
    case 'ne': return String(v) !== String(cond.value);
    case 'gt': return n(v) > n(cond.value);
    case 'gte': return n(v) >= n(cond.value);
    case 'lt': return n(v) < n(cond.value);
    case 'lte': return n(v) <= n(cond.value);
    case 'in': return Array.isArray(cond.value) && cond.value.map(String).includes(String(v));
    default: return false;
  }
}
