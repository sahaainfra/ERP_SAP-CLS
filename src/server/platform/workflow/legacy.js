import { packSteps } from './definition.js';
import { forbidden, unprocessable } from '../http/errors.js';
import { workflowTypes } from './registry.js';

/**
 * The adapter for the approval logic that existed before the workflow engine (FR-07, part 04.01). The change requests of `core_change_requests`
 * (platform/approvals) keep their table, their handlers and their API; for a request type whose flag `ff.eng.p0401.legacy.<type>` is ON the decisions
 * are taken by the workflow engine instead of by the legacy code: who may decide, the segregation-of-duties rules, the movement from step to step
 * and the history are the engine's, and the request is only mirrored (status, step, step rows) so that every screen that reads it works unchanged.
 * Turning the flag OFF returns that type to the legacy code; requests already in flight finish under whichever code receives their next decision.
 *
 * A type is adapted by adding it to ADAPTED; its request is the document, `LEGACY_<TYPE>` its document type, and its definition is the chain the
 * request carries (a version is made when the chain changes).
 */
export const ADAPTED_TYPES = ['ui_translation_change'];
export const legacyFlag = (type) => `ff.eng.p0401.legacy.${type}`;
export const legacyDocType = (type) => `LEGACY_${type.toUpperCase()}`;
const iso = () => new Date().toISOString();

for (const type of ADAPTED_TYPES) {
  workflowTypes.register({
    docType: legacyDocType(type),
    label: `Change request (${type})`,
    processOwner: 'SYSADM',
    route: (id) => `/admin/requests?open=${id}`,
    describe(db, companyId, id) {
      const r = db.prepare('SELECT * FROM core_change_requests WHERE id = ? AND company_id = ?').get(Number(id), companyId);
      return r ? { ref: `CR-${r.id}`, title: r.title, originator: r.requested_by } : null;
    },
    defaultDefinition: { name: `Change request ${type}`, steps: [{ code: 'S1', name: 'Step 1', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'SYSADM' }], slaHours: null, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  });
}

const registry = new WeakMap();
/** The adapter of a database (set by the module that owns the engine), or null when there is none. */
export const legacyAdapterOf = (db) => registry.get(db) ?? null;

export function createLegacyAdapter({ db, engine, flags }) {
  const handles = (companyId, type) => ADAPTED_TYPES.includes(type) && flags.isOn({ companyId }, 'ff.eng.p0401') && flags.isOn({ companyId }, legacyFlag(type));
  const stepSpec = (entry, i) => {
    const approver = entry.startsWith('@') ? { kind: 'user', user: entry.slice(1) } : { kind: 'role', role: entry };
    return { code: `S${i + 1}`, name: `Step ${i + 1}: ${entry.startsWith('@') ? entry.slice(1) : entry.replace('|', ' or ')}`, type: 'approval', mode: 'single', approvers: [approver], slaHours: null, requireAttachment: false, checklist: [], when: null, notify: [], action: null };
  };
  /** The active definition of the type is the chain of the request: reuse it when it is the same, else make the next version. */
  function ensureDefinition(companyId, type, chain) {
    const docType = legacyDocType(type);
    const steps = chain.map(stepSpec);
    const body = packSteps({ settings: { resubmit: 'first', distinctApprovers: true }, steps });
    const active = db.prepare("SELECT * FROM wf_definitions WHERE company_id = ? AND doc_type = ? AND status = 'ACTIVE'").get(companyId, docType);
    if (active && active.steps_json === body) return;
    const version = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM wf_definitions WHERE company_id = ? AND doc_type = ?').get(companyId, docType).v;
    if (active) db.prepare("UPDATE wf_definitions SET status = 'RETIRED', retired_at = ?, row_version = row_version + 1 WHERE id = ?").run(iso(), active.id);
    db.prepare("INSERT INTO wf_definitions (company_id, doc_type, version, name, status, steps_json, activated_at, activated_by, created_by, source_type) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 'system', 'system', 'legacy_adapter')")
      .run(companyId, docType, version, `Change request ${type} (${chain.join(' > ')})`, body, iso());
  }
  const instanceOf = (request, statuses) => db.prepare(`SELECT * FROM wf_instances WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`).get(request.company_id, legacyDocType(request.type), String(request.id), ...statuses);

  const api = {
    handles,
    /** A request was raised: start its workflow. `startAt` lets a request already part-way through its chain begin at its step. */
    start(actor, { id, type, chain, companyId, startAt = 0, title }) {
      ensureDefinition(companyId, type, chain);
      const asOriginator = { user: actor.user, roles: actor.roles ?? [], companyId };
      return engine.submit(asOriginator, { docType: legacyDocType(type), docId: id, context: { type, title: title ?? '' }, startAt });
    },
    /** Take one decision on a request; returns what the mirror must show. */
    decide(actor, request, { action, comment }) {
      const chain = JSON.parse(request.chain_json);
      let inst = instanceOf(request, ['RUNNING']);
      if (!inst) { // a request raised before the flag was turned on: begin its workflow at the step it is at
        this.start({ user: request.requested_by, roles: [] }, { id: request.id, type: request.type, chain, companyId: request.company_id, startAt: request.current_step - 1, title: request.title });
        inst = instanceOf(request, ['RUNNING']);
      }
      const entry = chain[request.current_step - 1];
      // the same refusal, in the same words, as the legacy code for a person who does not hold the role of the step
      if (entry.startsWith('@') ? actor.user !== entry.slice(1) : !entry.split('|').some((x) => (actor.roles ?? []).includes(x))) {
        throw forbidden(entry.startsWith('@') ? `Step ${request.current_step} of this request is for ${entry.slice(1)} (the requester's manager). You are not that person.` : `Step ${request.current_step} of this request needs the ${entry.replace('|', ' or ')} role. Your roles do not include it.`);
      }
      const task = db.prepare("SELECT * FROM wf_tasks WHERE instance_id = ? AND step_code = ? AND superseded = 0 AND status IN ('OPEN', 'ADMIN_QUEUE') ORDER BY id LIMIT 1").get(inst.id, inst.current_step);
      if (!task) throw unprocessable('This request has no open step in the workflow engine.');
      engine.act(actor, task.id, { action, comment });
      const after = db.prepare('SELECT * FROM wf_instances WHERE id = ?').get(inst.id);
      const steps = JSON.parse(after.steps_json).steps;
      return { status: after.status === 'RUNNING' ? 'SUBMITTED' : after.status, step: after.status === 'RUNNING' ? steps.findIndex((s) => s.code === after.current_step) + 1 : request.current_step };
    },
    resubmit(actor, request) {
      const inst = instanceOf(request, ['RETURNED']);
      if (inst) engine.resubmit({ user: actor.user, roles: actor.roles ?? [], companyId: request.company_id }, inst.id, { comment: null });
      else this.start(actor, { id: request.id, type: request.type, chain: JSON.parse(request.chain_json), companyId: request.company_id, title: request.title });
    },
    withdraw(actor, request) {
      const inst = instanceOf(request, ['RUNNING', 'RETURNED']);
      if (inst) engine.abandon(request.company_id, inst.id, actor.user, 'WITHDRAWN', null);
    },
    reassign(request, to) { engine.reassignOriginator(request.company_id, legacyDocType(request.type), request.id, to); },
  };
  registry.set(db, api);
  return api;
}
