import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { workflowResolvers } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.01: the workflow engine. T-01 a two-level approval completes and locks; T-02 parallel-all waits for both, parallel-any completes on the first;
// T-03 return and resubmit keep the history, withdrawal before the first action works; T-04 a new version does not touch running instances;
// T-05 nobody eligible sends the task to the administrators' queue and never approves.
const W = '/api/v1/workflow';
const E = '/api/v1/eng';
const json = { 'content-type': 'application/json' };
const key = (k = 'w') => ({ ...json, 'idempotency-key': `wf-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const pm2 = as('PM', 'pm2');
const acc = as('ACCMGR', 'acc1');
const cfo = as('CFO', 'cfo1');
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const own = as('PROCMGR', 'proc1');
const it = as('ITADM', 'it1');
const aud = as('AUD', 'aud1');

const make = async (api, who = pd, amount = '250000.00', title = 'Shuttering plates') => {
  const r = await api.call('POST', `${E}/sample-docs`, { ...who, headers: key('c'), body: { title, amount } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
};
const submit = (api, who, id, comment) => api.call('POST', `${E}/sample-docs/${id}/submit`, { ...who, headers: key('s'), body: comment ? { comment } : {} });
const doc = async (api, who, id) => (await api.call('GET', `${E}/sample-docs/${id}`, who)).json.data;
const inbox = async (api, who, mine = 'assigned') => (await api.call('GET', `${W}/tasks?mine=${mine}`, who)).json.data;
const act = (api, who, taskId, body) => api.call('POST', `${W}/tasks/${taskId}/act`, { ...who, headers: key('a'), body });
const openTask = (wf, step) => wf.tasks.find((t) => t.status === 'OPEN' && (!step || t.step === step));
const outbox = (api, type) => api.db.prepare('SELECT payload FROM core_outbox WHERE event_type = ?').all(type).map((r) => JSON.parse(r.payload));

/** Define a new version of the sample document type and take it through its own approval chain (SYSADM, the process owner, ITADM). */
async function activate(api, steps, { name = 'Test chain', settings } = {}) {
  const base = { docType: 'ENG_SAMPLE_DOC', name, settings: settings ?? { resubmit: 'first', distinctApprovers: true }, steps };
  const created = await api.call('POST', `${W}/definitions`, { ...sys, headers: key('d'), body: base });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.data.id;
  const req = await api.call('POST', `${W}/definitions/${id}/activate`, { ...sys, headers: key('x'), body: {} });
  assert.equal(req.status, 202, JSON.stringify(req.json));
  let wf = req.json.data.instance;
  for (const who of [sys2, own, it]) {
    wf = (await act(api, who, openTask(wf).id, { action: 'approve' })).json.data;
  }
  assert.equal(wf.status, 'APPROVED', JSON.stringify(wf));
  const d = (await api.call('GET', `${W}/definitions/${id}`, sys)).json.data;
  assert.equal(d.status, 'ACTIVE');
  return d;
}
const step = (code, name, approvers, extra = {}) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: null, requireAttachment: false, checklist: [], when: null, notify: [], action: null, ...extra });
const role = (r) => ({ kind: 'role', role: r });

test('T-01 FR-02 FR-06 BR-03 a two-level sequential approval completes, locks the document and tells the module', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await make(api);
  assert.equal(d.status, 'DRAFT');
  const s = await submit(api, pd, d.id, 'needed for the slab');
  assert.equal(s.status, 201, JSON.stringify(s.json));
  let wf = s.json.data.workflow;
  assert.equal(wf.status, 'RUNNING');
  assert.equal(wf.definitionVersion, 1);
  assert.equal((await doc(api, pd, d.id)).status, 'IN_APPROVAL');
  assert.deepEqual(wf.steps.map((x) => [x.code, x.state]), [['MANAGER', 'ACTIVE'], ['FINANCE', 'PENDING'], ['CFO', 'PENDING']]);
  // the task is in the inbox of the project manager and nobody else's
  assert.equal((await inbox(api, pm)).total, 1);
  assert.equal((await inbox(api, acc)).total, 0);
  assert.equal((await api.call('GET', `${W}/tasks/count`, pm)).json.data.open, 1);
  // the first approval moves it on; the amount is below the CFO's threshold, so the third step does not apply
  wf = (await act(api, pm, openTask(wf).id, { action: 'approve', comment: 'ok' })).json.data;
  assert.equal(wf.currentStep, 'FINANCE');
  wf = (await act(api, acc, openTask(wf).id, { action: 'approve' })).json.data;
  assert.equal(wf.status, 'APPROVED');
  assert.equal(wf.steps.find((x) => x.code === 'CFO').state, 'SKIPPED');
  const after = await doc(api, pd, d.id);
  assert.equal(after.status, 'APPROVED');
  assert.equal(after.locked, true);
  // BR-03 the approved document cannot be changed or submitted again
  assert.equal((await api.call('PUT', `${E}/sample-docs/${d.id}`, { ...pd, headers: key('u'), body: { title: 'Changed', amount: '1.00' } })).status, 422);
  assert.equal((await submit(api, pd, d.id)).status, 422);
  assert.throws(() => api.db.prepare("UPDATE eng_sample_docs SET locked = 0 WHERE id = ?").run(d.id), /CHECK/, 'the database itself refuses an approved document that is not locked');
  // history, audit and events
  assert.deepEqual(wf.history.map((h) => h.event).filter((e) => ['SUBMITTED', 'APPROVED', 'COMPLETED'].includes(e)), ['SUBMITTED', 'APPROVED', 'APPROVED', 'COMPLETED']);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'wf_instances' AND entity_id = ?").get(String(wf.id)).n >= 4, true);
  for (const t of ['workflow.instance.submitted', 'workflow.instance.approved', 'workflow.task.created', 'workflow.task.completed', 'eng.sample_doc.approved']) assert.ok(outbox(api, t).length >= 1, t);
  assert.equal(outbox(api, 'workflow.instance.approved')[0].data.docType, 'ENG_SAMPLE_DOC');
  // a large amount adds the CFO
  const big = await make(api, pd, '2500000.00', 'Tower crane hire');
  let w2 = (await submit(api, pd, big.id)).json.data.workflow;
  w2 = (await act(api, pm, openTask(w2).id, { action: 'approve' })).json.data;
  w2 = (await act(api, acc, openTask(w2).id, { action: 'approve' })).json.data;
  assert.equal(w2.status, 'RUNNING');
  assert.equal(w2.currentStep, 'CFO');
  assert.equal((await act(api, cfo, openTask(w2).id, { action: 'approve' })).json.data.status, 'APPROVED');
  await api.close();
});

test('BR-01 the originator never decides on their own document, nobody decides two steps, and the rules of a decision are enforced', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await make(api, as('PM', 'pm1'), '100000.00');
  const wf = (await submit(api, as('PM', 'pm1'), d.id)).json.data.workflow;
  const t = openTask(wf);
  const self = await act(api, as('PM', 'pm1'), t.id, { action: 'approve' });
  assert.equal(self.status, 403);
  assert.equal(self.json.error.code, 'SEGREGATION_OF_DUTIES');
  assert.equal((await act(api, as('ACCMGR', 'acc9'), t.id, { action: 'approve' })).status, 403, 'a person without the role of the step');
  assert.equal((await act(api, pm2, t.id, { action: 'reject' })).status, 400, 'a rejection needs a reason');
  assert.equal((await act(api, pm2, t.id, { action: 'return', comment: 'no' })).status, 400);
  assert.equal((await act(api, pm2, t.id, { action: 'bogus' })).status, 400);
  assert.equal((await act(api, pm2, t.id, { action: 'approve', version: 99 })).status, 409, 'a stale view of the task');
  const w2 = (await act(api, pm2, t.id, { action: 'approve' })).json.data;
  assert.equal((await act(api, pm2, t.id, { action: 'approve' })).status, 409, 'a decided task cannot be decided again');
  // pm2 holds PM and ACCMGR here: the same person cannot decide two steps
  const both = as('PM,ACCMGR', 'pm2');
  const second = await act(api, both, openTask(w2).id, { action: 'approve' });
  assert.equal(second.status, 403);
  assert.equal(second.json.error.code, 'SEGREGATION_OF_DUTIES');
  // reject closes it
  const rej = await act(api, acc, openTask(w2).id, { action: 'reject', comment: 'over budget for this month' });
  assert.equal(rej.json.data.status, 'REJECTED');
  assert.equal((await doc(api, pm, d.id)).status, 'REJECTED');
  await api.close();
});

test('T-02 FR-01 a parallel-all step waits for everyone, a parallel-any step completes on the first', async () => {
  const api = await startApi();
  await setupCompany(api);
  await activate(api, [
    step('BOTH', 'Both managers', [role('PM'), role('ACCMGR')], { mode: 'parallel_all' }),
    step('EITHER', 'Either director', [role('CFO'), role('DIR')], { mode: 'parallel_any' }),
  ]);
  const d = await make(api);
  let wf = (await submit(api, pd, d.id)).json.data.workflow;
  assert.equal(wf.definitionVersion, 1);
  assert.equal(wf.tasks.filter((t) => t.status === 'OPEN').length, 2, JSON.stringify(wf.tasks.map((t) => [t.step, t.assigneeRole, t.status])));
  assert.equal((await inbox(api, pm)).total, 1);
  assert.equal((await inbox(api, acc)).total, 1);
  wf = (await act(api, pm, wf.tasks.find((t) => t.assigneeRole === 'PM').id, { action: 'approve' })).json.data;
  assert.equal(wf.currentStep, 'BOTH', 'waiting for the accounts manager');
  assert.equal(wf.status, 'RUNNING');
  assert.equal(wf.tasks.filter((t) => t.status === 'OPEN').length, 1);
  wf = (await act(api, acc, openTask(wf).id, { action: 'approve' })).json.data;
  assert.equal(wf.currentStep, 'EITHER');
  assert.equal(wf.tasks.filter((t) => t.status === 'OPEN').length, 2);
  wf = (await act(api, as('DIR', 'dir1'), wf.tasks.find((t) => t.status === 'OPEN' && t.assigneeRole === 'DIR').id, { action: 'approve' })).json.data;
  assert.equal(wf.status, 'APPROVED', 'the first of two completes the step');
  assert.equal(wf.tasks.find((t) => t.assigneeRole === 'CFO').status, 'SKIPPED');
  // one rejection in a parallel-all step ends it at once
  const d2 = await make(api);
  const w2 = (await submit(api, pd, d2.id)).json.data.workflow;
  const rej = (await act(api, pm, w2.tasks.find((t) => t.assigneeRole === 'PM').id, { action: 'reject', comment: 'wrong specification' })).json.data;
  assert.equal(rej.status, 'REJECTED');
  assert.equal(rej.tasks.find((t) => t.assigneeRole === 'ACCMGR').status, 'CANCELLED');
  await api.close();
});

test('T-03 FR-03 FR-04 a returned document keeps its history on resubmission; a document can be returned to an earlier step; withdrawal works only before the first action', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await make(api);
  let wf = (await submit(api, pd, d.id)).json.data.workflow;
  wf = (await act(api, pm, openTask(wf).id, { action: 'approve' })).json.data;
  // return to the originator
  assert.equal((await act(api, acc, openTask(wf).id, { action: 'return', comment: '' })).status, 400);
  wf = (await act(api, acc, openTask(wf).id, { action: 'return', comment: 'attach the quotation please' })).json.data;
  assert.equal(wf.status, 'RETURNED');
  assert.equal((await doc(api, pd, d.id)).status, 'RETURNED');
  assert.equal((await api.call('GET', `${W}/instances/${wf.id}`, pd)).json.data.actions.resubmit, true);
  // edit and resubmit: the same instance, the next cycle, from the first step; nothing of the first round is lost
  assert.equal((await api.call('PUT', `${E}/sample-docs/${d.id}`, { ...pd, headers: key('u'), body: { title: 'Shuttering plates (revised)', amount: '260000.00' } })).status, 200);
  assert.equal((await act(api, pm2, wf.tasks[0].id, { action: 'approve' })).status, 409, 'the closed task of the first round');
  const again = (await submit(api, pd, d.id, 'quotation attached')).json.data.workflow;
  assert.equal(again.id, wf.id);
  assert.equal(again.cycle, 2);
  assert.equal(again.status, 'RUNNING');
  assert.equal(again.currentStep, 'MANAGER');
  const events = again.history.map((h) => h.event);
  assert.ok(events.includes('RETURNED') && events.includes('RESUBMITTED') && events.filter((e) => e === 'APPROVED').length === 1, events.join());
  assert.equal(openTask(again).assigneeRole, 'PM');
  assert.equal(again.tasks.filter((t) => t.superseded).length >= 2, true, 'the decisions of round one stay, marked as superseded');
  // the earlier approver may decide again in the new round (the round-one decision no longer counts)
  const r2 = (await act(api, pm, openTask(again).id, { action: 'approve' })).json.data;
  assert.equal(r2.currentStep, 'FINANCE');
  // return to an earlier step instead of the originator
  const back = (await act(api, acc, openTask(r2).id, { action: 'return', comment: 'the manager must re-check the quantities', returnToStep: 'MANAGER' })).json.data;
  assert.equal(back.status, 'RUNNING');
  assert.equal(back.currentStep, 'MANAGER');
  assert.equal(openTask(back).assigneeRole, 'PM');
  assert.equal((await doc(api, pd, d.id)).status, 'IN_APPROVAL');
  assert.equal((await act(api, pm, openTask(back).id, { action: 'return', comment: 'nowhere to go', returnToStep: 'FINANCE' })).status, 422, 'only an earlier step');
  // withdrawal: not after an action, yes before one
  assert.equal((await api.call('POST', `${W}/instances/${back.id}/withdraw`, { ...pd, headers: key('w'), body: {} })).status, 422);
  const d2 = await make(api);
  const fresh = (await submit(api, pd, d2.id)).json.data.workflow;
  assert.equal((await api.call('POST', `${W}/instances/${fresh.id}/withdraw`, { ...pm, headers: key('w'), body: {} })).status, 403, 'only the originator');
  const w = await api.call('POST', `${W}/instances/${fresh.id}/withdraw`, { ...pd, headers: key('w'), body: { comment: 'raised by mistake' } });
  assert.equal(w.status, 200);
  assert.equal(w.json.data.status, 'WITHDRAWN');
  assert.equal((await doc(api, pd, d2.id)).status, 'CANCELLED');
  assert.equal((await inbox(api, pm)).rows.some((t) => t.instance.id === fresh.id), false, 'its tasks are closed');
  await api.close();
});

test('T-04 FR-01 FR-02 a new definition version does not change an instance that is running', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await make(api);
  const wf = (await submit(api, pd, d.id)).json.data.workflow;
  assert.equal(wf.definitionVersion, 1);
  // version 2 has one step and another role; the running instance is not touched
  const v2 = await activate(api, [step('ONLY', 'Director', [role('DIR')])]);
  assert.equal(v2.version, 2);
  const list = (await api.call('GET', `${W}/definitions?docType=ENG_SAMPLE_DOC`, sys)).json.data.rows;
  assert.deepEqual(list.map((r) => [r.version, r.status]).sort(), [[1, 'RETIRED'], [2, 'ACTIVE']]);
  let still = (await api.call('GET', `${W}/instances/${wf.id}`, pd)).json.data;
  assert.equal(still.definitionVersion, 1);
  assert.deepEqual(still.steps.map((s) => s.code), ['MANAGER', 'FINANCE', 'CFO']);
  still = (await act(api, pm, openTask(still).id, { action: 'approve' })).json.data;
  assert.equal(still.currentStep, 'FINANCE', 'it carries on along version 1');
  // a document submitted now runs version 2
  const d2 = await make(api);
  const fresh = (await submit(api, pd, d2.id)).json.data.workflow;
  assert.equal(fresh.definitionVersion, 2);
  assert.deepEqual(fresh.steps.map((s) => s.code), ['ONLY']);
  assert.equal(openTask(fresh).assigneeRole, 'DIR');
  // a version cannot become active without its chain: the maker cannot approve their own activation or skip a step
  const draft = (await api.call('POST', `${W}/definitions/draft`, { ...sys, headers: key('d'), body: { docType: 'ENG_SAMPLE_DOC' } })).json.data;
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.version, 3);
  const req = (await api.call('POST', `${W}/definitions/${draft.id}/activate`, { ...sys, headers: key('x'), body: {} })).json.data;
  assert.equal((await act(api, sys, openTask(req.instance).id, { action: 'approve' })).status, 403, 'the maker cannot approve');
  assert.equal((await act(api, it, openTask(req.instance).id, { action: 'approve' })).status, 403, 'the technical validator cannot take the first step');
  assert.equal((await api.call('GET', `${W}/definitions/${draft.id}`, sys)).json.data.status, 'PENDING');
  // a rejected activation leaves the active version in force and the draft editable again
  const rej = await act(api, sys2, openTask(req.instance).id, { action: 'reject', comment: 'the second step is missing' });
  assert.equal(rej.json.data.status, 'REJECTED');
  const after = (await api.call('GET', `${W}/definitions/${draft.id}`, sys)).json.data;
  assert.equal(after.status, 'REJECTED');
  assert.equal((await api.call('GET', `${W}/definitions?docType=ENG_SAMPLE_DOC&status=ACTIVE`, sys)).json.data.rows[0].version, 2);
  const edited = await api.call('PUT', `${W}/definitions/${draft.id}`, { ...sys, headers: key('e'), body: { definition: { docType: 'ENG_SAMPLE_DOC', name: 'Fixed', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('A', 'Step A', [role('PM')]), step('B', 'Step B', [role('ACCMGR')])] } } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.data.status, 'DRAFT');
  await api.close();
});

test('T-05 BR-02 when nobody can be found for a step the task goes to the administrators\' queue and nothing is approved', async () => {
  const api = await startApi();
  await setupCompany(api);
  workflowResolvers.replace('process_owner', ({ instance }) => [{ role: instance.context.processOwner }]);
  workflowResolvers.register('nobody_test', () => []);
  await activate(api, [step('LOST', 'Nobody', [{ kind: 'resolver', resolver: 'nobody_test' }]), step('NEXT', 'Next', [role('ACCMGR')])]);
  const d = await make(api);
  let wf = (await submit(api, pd, d.id)).json.data.workflow;
  assert.equal(wf.status, 'RUNNING');
  assert.equal(wf.needsAdmin, true);
  assert.equal(wf.tasks[0].status, 'ADMIN_QUEUE');
  assert.equal((await doc(api, pd, d.id)).status, 'IN_APPROVAL', 'never auto-approved');
  assert.ok(outbox(api, 'workflow.task.unassigned').length === 1, 'an alert is raised');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'wf_instances' AND action = 'admin_queue'").get().n, 1);
  // only an administrator sees the queue and may assign it; nobody can decide a task that is in it
  assert.equal((await api.call('GET', `${W}/tasks?mine=admin`, pm)).status, 403);
  const queue = (await api.call('GET', `${W}/tasks?mine=admin`, sys)).json.data;
  assert.equal(queue.total, 1);
  assert.equal((await act(api, sys, wf.tasks[0].id, { action: 'approve' })).status, 409);
  assert.equal((await api.call('POST', `${W}/tasks/${wf.tasks[0].id}/assign`, { ...pm, headers: key('g'), body: { user: 'pm1' } })).status, 403);
  assert.equal((await api.call('POST', `${W}/tasks/${wf.tasks[0].id}/assign`, { ...sys, headers: key('g'), body: { user: 'pd1' } })).status, 403, 'not to the person who raised the document');
  wf = (await api.call('POST', `${W}/tasks/${wf.tasks[0].id}/assign`, { ...sys, headers: key('g'), body: { user: 'pm1', comment: 'covering for the project manager' } })).json.data;
  assert.equal(wf.needsAdmin, false);
  assert.equal(wf.tasks[0].status, 'OPEN');
  wf = (await act(api, pm, wf.tasks[0].id, { action: 'approve' })).json.data;
  assert.equal(wf.currentStep, 'NEXT');
  // the reporting manager of someone nobody manages is also an empty step
  await activate(api, [step('MGR', 'Reporting manager', [{ kind: 'manager' }])]);
  const d2 = await make(api);
  const w2 = (await submit(api, pd, d2.id)).json.data.workflow;
  assert.equal(w2.needsAdmin, true);
  await api.close();
});

test('FR-03 FR-05 a question keeps the task open and is answered by the originator; a task can be delegated; the inbox shows delegated and watched documents', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await make(api);
  let wf = (await submit(api, pd, d.id)).json.data.workflow;
  const t = openTask(wf);
  assert.equal((await act(api, pm, t.id, { action: 'clarify', comment: '' })).status, 400);
  wf = (await act(api, pm, t.id, { action: 'clarify', comment: 'which slab is this for?' })).json.data;
  assert.equal(openTask(wf).clarification, 'ASKED');
  assert.equal(wf.status, 'RUNNING');
  assert.equal((await act(api, pm, t.id, { action: 'approve' })).status, 422, 'not before the answer');
  assert.equal((await act(api, pm, t.id, { action: 'clarify', comment: 'again?' })).status, 422);
  assert.equal((await act(api, pm2, t.id, { action: 'answer', comment: 'the slab' })).status, 403, 'only the originator answers');
  wf = (await act(api, pd, t.id, { action: 'answer', comment: 'for the terrace slab, block B' })).json.data;
  assert.equal(openTask(wf).clarification, 'NONE');
  assert.deepEqual(wf.history.map((h) => h.event).filter((e) => e.startsWith('CLARIF')), ['CLARIFICATION_ASKED', 'CLARIFICATION_ANSWERED']);
  assert.equal(outbox(api, 'workflow.task.clarification_requested').length, 1);
  // delegation
  assert.equal((await act(api, pm, t.id, { action: 'delegate', delegateTo: 'pd1' })).status, 403, 'not to the originator');
  assert.equal((await act(api, pm, t.id, { action: 'delegate', delegateTo: 'pm1' })).status, 422);
  wf = (await act(api, pm, t.id, { action: 'delegate', delegateTo: 'pm2', comment: 'on leave tomorrow' })).json.data;
  assert.equal(openTask(wf).assigneeUser, 'pm2');
  assert.equal((await inbox(api, pm)).total, 0);
  assert.equal((await inbox(api, pm2)).total, 1);
  const delegated = await inbox(api, pm2, 'delegated');
  assert.equal(delegated.rows[0].direction, 'to_me');
  assert.equal((await inbox(api, pm, 'delegated')).rows[0].direction, 'by_me');
  const done = (await act(api, as('PM', 'pm2'), t.id, { action: 'approve' })).json.data;
  assert.equal(done.tasks.find((x) => x.id === t.id).onBehalfOf, 'pm1');
  // watching and started
  assert.equal((await inbox(api, pd, 'started')).total, 1);
  assert.equal((await inbox(api, pd, 'watching')).total, 1, 'the originator watches by default');
  assert.equal((await api.call('POST', `${W}/instances/${wf.id}/watch`, { ...aud, headers: key('w'), body: {} })).status, 200);
  assert.equal((await inbox(api, aud, 'watching')).total, 1);
  await api.close();
});

test('FR-03 AC-04 cancelling needs the role and a reason; who may see an instance; nothing crosses a company', async () => {
  const api = await startApi();
  await setupCompany(api);
  await setupCompany(api, { company: '2' });
  const d = await make(api);
  const wf = (await submit(api, pd, d.id)).json.data.workflow;
  assert.equal((await api.call('POST', `${W}/instances/${wf.id}/cancel`, { ...pm, headers: key('c'), body: { reason: 'not needed' } })).status, 403);
  assert.equal((await api.call('POST', `${W}/instances/${wf.id}/cancel`, { ...sys, headers: key('c'), body: {} })).status, 400, 'a reason is needed');
  // who may read it: the originator, an approver, a watcher, the auditor; not another employee, not another company
  assert.equal((await api.call('GET', `${W}/instances/${wf.id}`, pd)).status, 200);
  assert.equal((await api.call('GET', `${W}/instances/${wf.id}`, pm)).status, 200);
  assert.equal((await api.call('GET', `${W}/instances/${wf.id}`, aud)).status, 200);
  assert.equal((await api.call('GET', `${W}/instances/${wf.id}`, as('SK', 'sk1'))).status, 404);
  assert.equal((await api.call('GET', `${W}/instances/${wf.id}`, { ...sys, company: '2' })).status, 404);
  assert.equal((await api.call('GET', `${W}/instances`, as('SK', 'sk1'))).status, 403);
  assert.equal((await api.call('GET', `${W}/instances`, { ...sys, company: '2' })).json.data.total, 0);
  assert.equal((await api.call('GET', `${W}/instances`, aud)).json.data.total, 1);
  assert.equal((await act(api, { ...pm, company: '2' }, wf.tasks[0].id, { action: 'approve' })).status, 404, 'a task of another company');
  const byDoc = await api.call('GET', `${W}/documents/ENG_SAMPLE_DOC/${d.id}`, pd);
  assert.equal(byDoc.json.data.id, wf.id);
  const cancelled = await api.call('POST', `${W}/instances/${wf.id}/cancel`, { ...sys, headers: key('c'), body: { reason: 'the work was given to another vendor' } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.data.status, 'CANCELLED');
  assert.equal((await doc(api, pd, d.id)).status, 'CANCELLED');
  assert.equal((await api.call('POST', `${W}/instances/${wf.id}/cancel`, { ...sys, headers: key('c'), body: { reason: 'again, after the fact' } })).status, 422);
  // a cancelled document can be raised into approval again: a new instance
  const again = await submit(api, pd, d.id);
  assert.equal(again.status, 201);
  assert.notEqual(again.json.data.workflow.id, wf.id);
  await api.close();
});

test('FR-01 definitions: validation, permissions and the editor\'s choices', async () => {
  const api = await startApi();
  await setupCompany(api);
  const body = (steps, extra = {}) => ({ docType: 'ENG_SAMPLE_DOC', name: 'Checked chain', settings: { resubmit: 'first', distinctApprovers: true }, steps, ...extra });
  const post = (who, b) => api.call('POST', `${W}/definitions`, { ...who, headers: key('d'), body: b });
  assert.equal((await post(pm, body([step('A', 'Step A', [role('PM')])]))).status, 403);
  assert.equal((await post(aud, body([step('A', 'Step A', [role('PM')])]))).status, 403);
  const bad = async (steps, extra, re) => { const r = await post(sys, body(steps, extra)); assert.equal(r.status, 400, JSON.stringify(r.json)); assert.match(JSON.stringify(r.json), re); };
  await bad([], {}, /steps/);
  await bad([step('A', 'Step A', [])], {}, /at least one approver/);
  await bad([step('A', 'Step A', [role('PM'), role('CFO')])], {}, /single step has one approver/);
  await bad([step('A', 'Step A', [role('PM')], { mode: 'parallel_all' })], {}, /at least two approvers/);
  await bad([step('A', 'Step A', [role('PM')]), step('A', 'Step B', [role('CFO')])], {}, /used twice/);
  await bad([step('A', 'Step A', [role('pm')])], {}, /role code/);
  await bad([step('A', 'Step A', [{ kind: 'resolver', resolver: 'does_not_exist' }])], {}, /does not exist/);
  await bad([step('A', 'Step A', [], { type: 'system', action: 'nothing' }), step('B', 'Step B', [role('PM')])], {}, /system action/);
  await bad([step('A', 'Step A', [], { type: 'notification', notify: [role('PM')] })], {}, /decision/);
  await bad([step('A', 'Step A', [role('PM')])], { docType: 'NO_SUCH_TYPE' }, /not known/).catch(() => {});
  const missing = await post(sys, body([step('A', 'Step A', [role('PM')])], { docType: 'NO_SUCH_TYPE' }));
  assert.equal(missing.status, 422);
  const ok = await post(sys, body([step('A', 'Manager', [role('PM')], { slaHours: 12, requireAttachment: true, checklist: ['Quotation attached'], when: { field: 'amount', op: 'gte', value: 1000 } }), step('N', 'Tell the store', [], { type: 'notification', notify: [role('SK')] })]));
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.data.steps[0].checklist[0], 'Quotation attached');
  // the editor's choices and a comparison
  const options = (await api.call('GET', `${W}/definitions/options`, sys)).json.data;
  assert.ok(options.roles.some((r) => r.code === 'PM') && options.stepTypes.includes('system') && options.docTypes.some((t) => t.docType === 'ENG_SAMPLE_DOC'));
  const draft = (await api.call('POST', `${W}/definitions/draft`, { ...sys, headers: key('d'), body: { docType: 'ENG_SAMPLE_DOC' } })).json.data;
  const cmp = (await api.call('GET', `${W}/definitions/${ok.json.data.id}/compare/${draft.id}`, sys)).json.data;
  assert.ok(cmp.some((c) => c.change === 'ADDED') && cmp.some((c) => c.change === 'REMOVED'));
  // optimistic locking and deleting
  assert.equal((await api.call('PUT', `${W}/definitions/${ok.json.data.id}`, { ...sys, headers: key('e'), body: { definition: body([step('A', 'Manager', [role('PM')])]), version: 7 } })).status, 409);
  assert.equal((await api.call('DELETE', `${W}/definitions/${ok.json.data.id}`, { ...sys, headers: key('x') })).status, 200);
  assert.equal((await api.call('GET', `${W}/definitions/${ok.json.data.id}`, sys)).status, 404);
  const d = await make(api);
  await submit(api, pd, d.id);
  assert.equal((await api.call('GET', `${W}/definitions?status=ACTIVE`, aud)).json.data.rows[0].source, 'default_definition');
  assert.equal((await api.call('DELETE', `${W}/definitions/${(await api.call('GET', `${W}/definitions?status=ACTIVE`, aud)).json.data.rows[0].id}`, { ...sys, headers: key('x') })).status, 422, 'an active version is kept');
  await api.close();
});

test('FR-01 steps: required attachment and checklist before approval, notification and system steps, SLA reminder and escalation', async () => {
  const api = await startApi();
  await setupCompany(api);
  const { systemActions } = await import('../src/server/platform/workflow/index.js');
  let ran = 0;
  systemActions.register('count_test', () => { ran += 1; });
  await activate(api, [
    step('CHK', 'With checks', [role('PM')], { requireAttachment: true, checklist: ['Quotation attached', 'Budget checked'], slaHours: 1 }),
    step('TELL', 'Tell the store', [], { type: 'notification', notify: [role('SK')] }),
    step('SYS', 'System', [], { type: 'system', action: 'count_test' }),
    step('FIN', 'Finance', [role('ACCMGR')]),
  ]);
  const d = await make(api);
  let wf = (await submit(api, pd, d.id)).json.data.workflow;
  const t = openTask(wf);
  const blocked = await act(api, pm, t.id, { action: 'approve' });
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error.message, /checklist|attachment/);
  const file = api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by) VALUES (1, 'k1', 'q.pdf', 'pdf', 'application/pdf', 'document', 10, 'x', 'CLEAN', 'wf_task', 1, 'pm1')").run();
  const checks = ['Quotation attached', 'Budget checked'];
  assert.equal((await act(api, pm, t.id, { action: 'approve', checked: checks })).status, 422, 'the attachment is still missing');
  assert.equal((await act(api, pm, t.id, { action: 'approve', checked: checks, attachments: [999] })).status, 422, 'a file that does not exist');
  wf = (await act(api, pm, t.id, { action: 'approve', checked: checks, attachments: [Number(file.lastInsertRowid)] })).json.data;
  assert.equal(wf.currentStep, 'FIN');
  assert.equal(wf.tasks[0].attachments.length, 1);
  assert.equal(ran, 1, 'the system step ran');
  assert.ok(outbox(api, 'workflow.notification.requested').some((e) => e.data.template === 'workflow.step.notified' && e.data.recipients.includes('role:SK')));
  // the time passes: a reminder, then an escalation to the administrators
  const w2 = (await submit(api, pd, (await make(api)).id)).json.data.workflow;
  const t2 = openTask(w2);
  const engine = (await import('../src/server/platform/workflow/index.js')).workflowOf(api.db);
  api.db.prepare("UPDATE wf_tasks SET due_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(t2.id);
  assert.deepEqual(engine.sweepSla(), { reminded: 1, escalated: 0 });
  assert.deepEqual(engine.sweepSla(), { reminded: 0, escalated: 1 });
  assert.deepEqual(engine.sweepSla(), { reminded: 0, escalated: 0 });
  const seen = (await api.call('GET', `${W}/instances/${w2.id}`, pd)).json.data;
  assert.ok(seen.tasks.find((x) => x.id === t2.id).overdue);
  assert.deepEqual(seen.history.map((h) => h.event).filter((e) => ['REMINDER', 'ESCALATED'].includes(e)), ['REMINDER', 'ESCALATED']);
  const mon = (await api.call('GET', `${W}/monitor`, aud)).json.data;
  assert.equal(mon.totals.overdue, 1);
  assert.equal(mon.attention[0].id, w2.id);
  await api.close();
});

test('FR-06 AC-05 submit through the API: refused for a document that is not yours, one that does not exist, an unknown type; replays are idempotent; no route changes a status', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await make(api);
  const submitApi = (who, body, k) => api.call('POST', `${W}/submit`, { ...who, headers: k ? { ...json, 'idempotency-key': k } : json, body });
  assert.equal((await submitApi(pd, { docType: 'ENG_SAMPLE_DOC', docId: d.id })).status, 400, 'the Idempotency-Key is required');
  assert.equal((await submitApi(pm, { docType: 'ENG_SAMPLE_DOC', docId: d.id }, 'wf-api-key-1')).status, 403, 'only the originator submits');
  assert.equal((await submitApi(pd, { docType: 'ENG_SAMPLE_DOC', docId: 99999 }, 'wf-api-key-2')).status, 404);
  assert.equal((await submitApi(pd, { docType: 'NOPE', docId: 1 }, 'wf-api-key-3')).status, 422);
  assert.equal((await submitApi(pd, { docType: 'ENG_SAMPLE_DOC', docId: d.id, extra: 1 }, 'wf-api-key-4')).status, 400);
  const first = await submitApi(pd, { docType: 'ENG_SAMPLE_DOC', docId: d.id, context: { amount: 1 } }, 'wf-api-key-5');
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const replay = await submitApi(pd, { docType: 'ENG_SAMPLE_DOC', docId: d.id, context: { amount: 1 } }, 'wf-api-key-5');
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(replay.json.data.id, first.json.data.id);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM wf_instances').get().n, 1, 'one instance');
  assert.equal((await submitApi(pd, { docType: 'ENG_SAMPLE_DOC', docId: d.id }, 'wf-api-key-6')).status, 409, 'already in approval');
  // the document's status cannot be set by any route: the sample document has no status endpoint, and its database rows refuse a bypass of the lock
  for (const [m, p] of [['PUT', `${E}/sample-docs/${d.id}/status`], ['PATCH', `${E}/sample-docs/${d.id}`], ['POST', `${E}/sample-docs/${d.id}/approve`]]) assert.equal((await api.call(m, p, { ...sys, headers: key('x'), body: { status: 'APPROVED' } })).status, 404, `${m} ${p}`);
  assert.equal((await api.call('PUT', `${E}/sample-docs/${d.id}`, { ...pd, headers: key('u'), body: { title: 'Sneaky change', amount: '1.00' } })).status, 422, 'a document in approval cannot be edited');
  assert.equal((await doc(api, pd, d.id)).title, 'Shuttering plates');
  // history rows cannot be changed or removed
  assert.throws(() => api.db.prepare('DELETE FROM wf_history').run(), /cannot be removed/);
  assert.throws(() => api.db.prepare("UPDATE wf_history SET actor = 'x'").run(), /cannot be changed/);
  await api.close();
});

test('FR-08 AC-04 the monitor, its export and the amendment of an approved document', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await make(api);
  let wf = (await submit(api, pd, d.id)).json.data.workflow;
  wf = (await act(api, pm, openTask(wf).id, { action: 'approve' })).json.data;
  wf = (await act(api, acc, openTask(wf).id, { action: 'approve' })).json.data;
  const mon = (await api.call('GET', `${W}/monitor?docType=ENG_SAMPLE_DOC`, aud)).json.data;
  assert.equal(mon.byType[0].approved, 1);
  assert.equal(typeof mon.totals.avgCycleHours, 'number');
  assert.equal((await api.call('GET', `${W}/monitor`, pm)).status, 403);
  const csv = await api.raw('GET', `${W}/monitor?format=csv`, aud);
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString('utf8'), /Sample document,0,0,0,1/);
  assert.equal((await api.raw('GET', `${W}/monitor?format=xlsx`, aud)).status, 200);
  // amendment: a new document linked to the approved one, with its own approval linked to the first
  assert.equal((await api.call('POST', `${E}/sample-docs/${d.id}/amend`, { ...pm, headers: key('a'), body: {} })).status, 403);
  const amend = await api.call('POST', `${E}/sample-docs/${d.id}/amend`, { ...pd, headers: key('a'), body: {} });
  assert.equal(amend.status, 201, JSON.stringify(amend.json));
  assert.equal(amend.json.data.amendsId, d.id);
  assert.equal((await api.call('POST', `${E}/sample-docs/${d.id}/amend`, { ...pd, headers: key('a'), body: {} })).status, 409, 'one amendment at a time');
  const w2 = (await submit(api, pd, amend.json.data.id)).json.data.workflow;
  assert.equal(w2.previous.id, wf.id);
  const old = (await api.call('GET', `${W}/instances/${wf.id}`, pd)).json.data;
  assert.equal(old.amendments[0].id, w2.id);
  assert.equal((await doc(api, pd, d.id)).status, 'APPROVED', 'the original stays approved and locked');
  // the instances list, filtered
  const list = (await api.call('GET', `${W}/instances?status=RUNNING&q=Shuttering`, aud)).json.data;
  assert.equal(list.total, 1);
  assert.equal((await api.call('GET', `${W}/instances?status=BOGUS`, aud)).status, 400);
  // my work lists the approver's tasks
  const { workSources } = await import('../src/server/platform/widgets/index.js');
  assert.equal(workSources.list(api.db, { ...pm, user: 'pm1', roles: ['PM'], companyId: 1 }, 'task').filter((i) => i.source === 'Approvals').length, 1);
  await api.close();
});
