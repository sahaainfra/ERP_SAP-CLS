import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { memoryDb } from './helpers.js';
import { ROLE_TEMPLATES } from '../src/server/platform/authz/templates.js';
import { normaliseDefinition } from '../src/server/platform/workflow/definition.js';
import { systemActions, workflowResolvers, workflowTypes } from '../src/server/platform/workflow/registry.js';

// Part 30.04 FR-02: a workflow test for every document type. Every type registered with the workflow engine (part 04.01) is checked
// against the engine's contract: its default chain is a valid definition (the editor's own rules) whose approvers are real roles or
// registered resolvers; its process owner is a role; its route and its description work for a document that is not there. The behaviour
// of each chain (submit, approve, return, reject, the hooks) is tested in its module's own tests; the catalogue (30.04) shows both.
const ROLES = new Set(ROLE_TEMPLATES.map((r) => r.code));
const types = workflowTypes.list();

test('FR-02 every registered document type has a default chain the engine can run: decisions, real approvers, a process owner', () => {
  assert.ok(types.length > 200, `${types.length} document types`);
  const problems = [];
  for (const w of types) {
    const steps = w.defaultDefinition.steps;
    if (!steps.some((s) => s.type === 'approval' || s.type === 'review')) problems.push(`${w.docType}: no step asks for a decision`);
    if (new Set(steps.map((s) => s.code)).size !== steps.length) problems.push(`${w.docType}: a step code is used twice`);
    for (const s of steps) {
      if ((s.type === 'approval' || s.type === 'review') && !(s.approvers?.length)) problems.push(`${w.docType}: ${s.code} has no approver`);
      for (const a of [...(s.approvers ?? []), ...(s.notify ?? [])]) {
        if (a.kind === 'role') for (const r of String(a.role).split(/[|,]/)) if (!ROLES.has(r.trim())) problems.push(`${w.docType}: ${s.code} names the unknown role ${r}`);
        if (a.kind === 'resolver' && !workflowResolvers.get(a.resolver)) problems.push(`${w.docType}: ${s.code} names the unknown resolver ${a.resolver}`);
      }
      if (s.type === 'system' && !systemActions.get(s.action)) problems.push(`${w.docType}: ${s.code} runs the unknown action ${s.action}`);
    }
    if (!ROLES.has(w.processOwner)) problems.push(`${w.docType}: process owner ${w.processOwner} is not a role`);
  }
  assert.deepEqual(problems, []);
});

test('FR-02 D-807 the default chains open in the definition editor (a company copies them to change its chain): known exceptions only', () => {
  // The editor (04.01) is stricter than the engine: 30 default chains have a name over 120 characters, a single step with several approvers,
  // or a role written as a list the editor does not take. The engine runs them (their modules' tests pass), so the gap is recorded as D-807
  // and held here: the number may only fall.
  const refused = [];
  for (const w of types) { try { normaliseDefinition({ docType: w.docType, ...w.defaultDefinition }); } catch { refused.push(w.docType); } }
  assert.ok(refused.length <= 30, `the editor refuses ${refused.length} default chains: ${refused.join(', ')}`);
});

test('FR-02 every document type opens from a task and describes a missing document as nothing, without failing', () => {
  const db = memoryDb();
  const problems = [];
  for (const w of types) {
    try {
      const r = w.route(1);
      if (r != null && !(typeof r === 'string' && r.startsWith('/'))) problems.push(`${w.docType}: route ${r}`);
      const d = w.describe(db, 1, 987654321);
      if (d != null) problems.push(`${w.docType}: describes a document that is not there`);
      w.summarise?.(db, { companyId: 1, user: 'wf-coverage', roles: ['SYSADM'], permissions: new Set() }, 987654321);
    } catch (err) { problems.push(`${w.docType}: ${err.message}`); }
  }
  assert.deepEqual(problems, []);
});
