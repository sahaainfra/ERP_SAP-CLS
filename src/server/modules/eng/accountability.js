import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { accountabilityOf, ledgerSources } from '../../platform/accountability/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { ROLE_TEMPLATES } from '../../platform/authz/templates.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';

// Accountability (part 04.05): who answers for each process in each scope (RACI), and what each person did (the action ledger). The RACI of a live project is changed only
// through the approval of its project manager and then its project director; the ledger is read from the events of the workflow engine and of the modules, and from the audit trail.
export const RACI_DOC = 'ACC_RACI';
const iso = () => new Date().toISOString();
const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));
const LETTER = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
const event = (db, type, entity, id, actor, companyId, data, extra = {}) => publishEvent(db, { type, entity, entityId: id, actorId: actor?.user ?? 'system', companyId, data, ...extra });

// ---- who feeds the ledger ----
// the workflow engine: a submission, a decision on a task (a review is a verification), a cancellation or withdrawal
const instanceOf = (db, id) => db.prepare('SELECT * FROM wf_instances WHERE id = ?').get(Number(id));
const wfEntry = (inst, e) => ({ companyId: inst.company_id, entity: inst.doc_type, entityId: inst.doc_id, entityRef: inst.doc_ref ?? null, projectId: inst.project_id, siteId: inst.site_id, ...e });
ledgerSources.onEvent('workflow.instance.submitted', (db, ev) => { const i = instanceOf(db, ev.data.instanceId); return i && wfEntry(i, { actor: ev.actorId, action: 'submitted', outcome: 'SUBMITTED' }); });
ledgerSources.onEvent('workflow.instance.resubmitted', (db, ev) => { const i = instanceOf(db, ev.data.instanceId); return i && wfEntry(i, { actor: ev.actorId, action: 'submitted', outcome: 'RESUBMITTED' }); });
ledgerSources.onEvent('workflow.instance.cancelled', (db, ev) => { const i = instanceOf(db, ev.data.instanceId); return i && wfEntry(i, { actor: ev.actorId, action: 'cancelled', outcome: 'CANCELLED' }); });
ledgerSources.onEvent('workflow.instance.withdrawn', (db, ev) => { const i = instanceOf(db, ev.data.instanceId); return i && wfEntry(i, { actor: ev.actorId, action: 'cancelled', outcome: 'WITHDRAWN' }); });
ledgerSources.onEvent('workflow.task.completed', (db, ev) => {
  const i = instanceOf(db, ev.data.instanceId);
  const t = db.prepare('SELECT * FROM wf_tasks WHERE id = ?').get(Number(ev.data.taskId));
  if (!i || !t) return null;
  const base = { actor: ev.actorId, roleCode: t.assignee_role ?? null, dueAt: t.due_at, onTime: t.due_at && t.acted_at ? t.acted_at <= t.due_at : null, details: { step: t.step_code, taskId: t.id, onBehalfOf: t.on_behalf_of ?? null } };
  const a = ev.data.action ?? t.action;
  if (a === 'approve') return wfEntry(i, { ...base, action: t.kind === 'REVIEW' ? 'verified' : 'approved', outcome: 'APPROVED' });
  if (a === 'reject') return wfEntry(i, { ...base, action: 'rejected', outcome: 'REJECTED', affectedUser: i.submitted_by });
  if (a === 'return') return wfEntry(i, { ...base, action: 'rejected', outcome: 'RETURNED', affectedUser: i.submitted_by });
  return null;
});
// the Protocol & Control Engine: an exception raised for an action a control stopped
ledgerSources.onEvent('pcs.exception.raised', (db, ev) => ({ companyId: ev.companyId, actor: ev.actorId, action: 'submitted', entity: 'pcs_exception', entityId: ev.entityId, entityRef: ev.data.exceptionNo, outcome: 'EXCEPTION_RAISED', projectId: ev.projectId, siteId: ev.siteId, details: { control: ev.data.control, emergency: ev.data.emergency } }));
// the audit trail of the sample document and of the use of an exception
ledgerSources.onAudit('eng_sample_docs', (db, row) => {
  const d = db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(row.entity_id));
  if (!d) return null;
  const action = { create: 'created', amend: 'created', update: 'modified' }[row.action];
  return action ? { companyId: d.company_id, actor: row.actor, action, entity: 'ENG_SAMPLE_DOC', entityId: d.id, entityRef: d.doc_no, projectId: d.project_id, siteId: d.site_id, outcome: row.action === 'amend' ? 'AMENDMENT' : 'OK' } : null;
});
ledgerSources.onAudit('pcs_exceptions', (db, row) => {
  if (row.action !== 'use') return null;
  const e = db.prepare('SELECT * FROM pcs_exceptions WHERE id = ?').get(Number(row.entity_id));
  return e ? { companyId: e.company_id, actor: row.actor, action: 'executed', entity: 'pcs_exception', entityId: e.id, entityRef: e.exception_no, projectId: e.project_id, siteId: e.site_id, outcome: 'EXCEPTION_USED', details: { control: e.control_code } } : null;
});

// ---- the approval of a RACI change of a live project ----
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
function activateBatch(db, batchId, actor) {
  const rows = db.prepare("SELECT * FROM acc_raci_assignments WHERE batch_id = ? AND status = 'PENDING'").all(batchId);
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.company_id}|${r.scope_type}|${r.scope_id}|${r.process_code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const end = dayBefore(r.effective_from);
    // a row that started on or after the new date ends where it started (and is retired); one that started before ends the day before
    db.prepare(`UPDATE acc_raci_assignments SET effective_to = CASE WHEN ? < effective_from THEN effective_from ELSE ? END, status = CASE WHEN ? < effective_from OR ? < ? THEN 'RETIRED' ELSE status END, updated_by = ?, updated_at = ?, version = version + 1
      WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND process_code = ? AND status = 'ACTIVE' AND batch_id != ? AND (effective_to IS NULL OR effective_to >= ?)`)
      .run(end, end, end, end, dayOf(), actor.user, iso(), r.company_id, r.scope_type, r.scope_id, r.process_code, batchId, r.effective_from);
  }
  db.prepare("UPDATE acc_raci_assignments SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE batch_id = ? AND status = 'PENDING'").run(actor.user, iso(), batchId);
  const first = rows[0];
  if (first) {
    writeAudit(db, { entity: 'acc_raci_assignments', entityId: batchId, action: 'activate', newValues: { scope: `${first.scope_type} ${first.scope_id}`, processes: seen.size, from: first.effective_from }, actor: actor.user, companyId: first.company_id, reason: first.reason });
    event(db, 'acc.raci.changed', 'acc_raci', batchId, actor, first.company_id, { scopeType: first.scope_type, scopeId: first.scope_id, processes: [...seen].length }, { projectId: first.scope_type === 'PROJECT' ? first.scope_id : null });
  }
  return rows;
}
const rejectBatch = (db, batchId, actor) => db.prepare("UPDATE acc_raci_assignments SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE batch_id = ? AND status = 'PENDING'").run(actor.user, iso(), batchId);

const scopeLabel = (db, companyId, type, id) => {
  if (type === 'PROJECT') { const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ? AND company_id = ?').get(id, companyId); return p ? `${p.code} ${p.name}` : `Project ${id}`; }
  if (type === 'SITE') { const s = db.prepare('SELECT code, name FROM org_sites WHERE id = ? AND company_id = ?').get(id, companyId); return s ? `${s.code} ${s.name}` : `Site ${id}`; }
  if (type === 'DEPARTMENT') { const d = db.prepare('SELECT name FROM org_departments WHERE id = ? AND company_id = ?').get(id, companyId); return d ? d.name : `Department ${id}`; }
  return 'The whole company';
};
const who = (r) => (r.user_id ? r.user_id : `role ${r.role_code}`);

workflowTypes.register({
  docType: RACI_DOC,
  label: 'RACI change of a live project',
  processOwner: 'PD',
  route: () => '/admin/raci',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM acc_raci_assignments WHERE batch_id = ? AND company_id = ? LIMIT 1').get(Number(id), companyId);
    if (!r) return null;
    const project = r.scope_type === 'PROJECT' ? r.scope_id : r.scope_type === 'SITE' ? db.prepare('SELECT org_project_id AS p FROM org_sites WHERE id = ?').get(r.scope_id)?.p : null;
    return { ref: `RACI #${id}`, title: `RACI change for ${scopeLabel(db, companyId, r.scope_type, r.scope_id)}`, originator: r.created_by, projectId: project ?? null, siteId: r.scope_type === 'SITE' ? r.scope_id : null };
  },
  summarise(db, actor, id) {
    const rows = db.prepare('SELECT * FROM acc_raci_assignments WHERE batch_id = ? ORDER BY process_code, raci, id').all(Number(id));
    if (!rows.length) return null;
    const f = rows[0];
    return {
      fields: [{ label: 'Scope', value: scopeLabel(db, f.company_id, f.scope_type, f.scope_id) }, { label: 'Takes effect', value: f.effective_from }, { label: 'Processes changed', value: new Set(rows.map((r) => r.process_code)).size }, { label: 'Reason', value: f.reason ?? '' }, { label: 'Proposed by', value: f.created_by }],
      lines: { columns: [{ key: 'process', label: 'Process' }, { key: 'raci', label: 'RACI' }, { key: 'who', label: 'Who' }], rows: rows.map((r) => ({ process: r.process_code, raci: LETTER[r.raci], who: who(r) })) },
    };
  },
  defaultDefinition: { name: 'RACI change approval', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('PM', 'Project manager', 'PM'), step('PD', 'Project director', 'PD')] },
  hooks: {
    onApproved: (db, { instance, actor }) => activateBatch(db, Number(instance.docId), actor),
    onRejected: (db, { instance, actor }) => rejectBatch(db, Number(instance.docId), actor),
    onReturned: (db, { instance, actor }) => rejectBatch(db, Number(instance.docId), actor),
    onCancelled: (db, { instance, actor }) => rejectBatch(db, Number(instance.docId), actor),
  },
});
// what the approvers see: the accountable person of each process now and as proposed
evidenceProviders.register(RACI_DOC, ({ db, instance }) => {
  const rows = db.prepare('SELECT * FROM acc_raci_assignments WHERE batch_id = ? ORDER BY process_code').all(Number(instance.docId));
  if (!rows.length) return { sections: [] };
  const f = rows[0];
  const procs = [...new Set(rows.map((r) => r.process_code))];
  const acc = accountabilityOf(db);
  const table = procs.map((p) => {
    const now = db.prepare("SELECT user_id FROM acc_raci_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND process_code = ? AND raci = 'A' AND status = 'ACTIVE' AND batch_id != ?").get(f.company_id, f.scope_type, f.scope_id, p, f.batch_id)?.user_id
      ?? acc.resolve({ companyId: f.company_id, processCode: p, projectId: f.scope_type === 'PROJECT' ? f.scope_id : null })?.accountable ?? 'nobody';
    const next = rows.find((r) => r.process_code === p && r.raci === 'A')?.user_id ?? 'nobody';
    return { process: p, now, next, change: now === next ? 'No change' : 'Changes' };
  });
  return { sections: [{ code: 'accountable', title: 'Who is accountable', kind: 'table', columns: [{ key: 'process', label: 'Process' }, { key: 'now', label: 'Now' }, { key: 'next', label: 'Proposed' }, { key: 'change', label: '' }], rows: table }], flags: table.some((t) => t.change === 'Changes') ? [{ code: 'accountable_changes', label: 'The accountable person of a process changes', severity: 'medium' }] : [] };
});

export function createAccountabilityService({ db, engine }) {
  const authz = authzOf(db);
  const acc = accountabilityOf(db);
  const may = (actor, key, scope = {}) => authz.check(actor, key, { companyId: actor.companyId, ...scope }).allowed;
  const today = () => engine.clock().toISOString().slice(0, 10);

  const templates = (companyId) => {
    const rows = db.prepare('SELECT * FROM acc_raci_templates WHERE (company_id IS NULL OR company_id = ?) AND is_active = 1 AND deleted_at IS NULL ORDER BY sort_order, process_code').all(companyId);
    const merged = new Map();
    for (const r of rows) if (r.company_id != null || !merged.has(r.process_code)) merged.set(r.process_code, r);
    return [...merged.values()].sort((a, b) => a.sort_order - b.sort_order || a.process_code.localeCompare(b.process_code)).map((r) => ({ code: r.process_code, name: r.name, description: r.description, roles: JSON.parse(r.roles_json), docTypes: JSON.parse(r.doc_types_json), scope: r.company_id == null ? 'shared' : 'company' }));
  };

  /** The scope the person names: it must exist in the company, and the person must hold the permission for it. */
  function scopeOf(actor, { scopeType, scopeId = 0 }, key) {
    let projectId = null;
    let siteId = null;
    if (scopeType === 'COMPANY') { if (scopeId) throw badRequest('Some fields are invalid.', [{ field: 'scopeId', message: 'The whole company has no number.' }]); }
    else if (scopeType === 'WBS') throw unprocessable('The responsibility of a WBS element arrives with the project structure (part 10.x). Use the project, the site or the department for now.');
    else if (scopeType === 'PROJECT') {
      const p = db.prepare('SELECT * FROM org_projects WHERE id = ? AND company_id = ?').get(scopeId, actor.companyId);
      if (!p) throw notFound('That project does not exist.');
      projectId = p.id;
    } else if (scopeType === 'SITE') {
      const s = db.prepare('SELECT * FROM org_sites WHERE id = ? AND company_id = ?').get(scopeId, actor.companyId);
      if (!s) throw notFound('That site does not exist.');
      projectId = s.org_project_id;
      siteId = s.id;
    } else if (scopeType === 'DEPARTMENT') {
      if (!db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ?').get(scopeId, actor.companyId)) throw notFound('That department does not exist.');
    }
    if (!may(actor, key, { projectId, siteId })) throw forbidden(`You may not ${key === 'acc.raci.maintain' ? 'change the RACI of' : 'see the RACI of'} this scope (permission ${key}).`);
    const live = projectId ? db.prepare('SELECT status FROM org_projects WHERE id = ?').get(projectId)?.status === 'ACTIVE' : false;
    return { scopeType, scopeId: scopeType === 'COMPANY' ? 0 : scopeId, projectId, siteId, live, label: scopeLabel(db, actor.companyId, scopeType, scopeId) };
  }

  const present = (r) => ({ id: r.id, processCode: r.process_code, user: r.user_id, role: r.role_code, raci: r.raci, status: r.status, from: r.effective_from, to: r.effective_to, batchId: r.batch_id, instanceId: r.instance_id, version: r.version });

  const raci = {
    templates: (actor) => templates(actor.companyId),
    /** The scopes a person may open in the editor: the projects, sites and departments of the company that they may see. */
    scopes(actor) {
      const projects = db.prepare("SELECT id, code, name, status FROM org_projects WHERE company_id = ? AND is_active = 1 AND status != 'CLOSED' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'acc.raci.view', { projectId: p.id }));
      const sites = db.prepare('SELECT id, code, name, org_project_id AS projectId FROM org_sites WHERE company_id = ? AND is_active = 1 ORDER BY code').all(actor.companyId).filter((x) => may(actor, 'acc.raci.view', { projectId: x.projectId, siteId: x.id }));
      const departments = may(actor, 'acc.raci.view') ? db.prepare('SELECT id, name FROM org_departments WHERE company_id = ? AND is_active = 1 ORDER BY name').all(actor.companyId) : [];
      return { company: may(actor, 'acc.raci.view'), projects, sites, departments };
    },
    /** The grid of a scope: each process with who is R, A, C and I here, who is accountable by inheritance if nobody is here, and a change waiting for approval. */
    get(actor, q) {
      const scope = scopeOf(actor, q, 'acc.raci.view');
      const t = today();
      const rows = db.prepare("SELECT * FROM acc_raci_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND is_active = 1 AND status = 'ACTIVE' AND (effective_to IS NULL OR effective_to >= ?) ORDER BY process_code, raci, id").all(actor.companyId, scope.scopeType, scope.scopeId, t);
      const pending = db.prepare("SELECT * FROM acc_raci_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND status = 'PENDING' ORDER BY id").all(actor.companyId, scope.scopeType, scope.scopeId);
      const processes = templates(actor.companyId).map((p) => {
        const mine = rows.filter((r) => r.process_code === p.code);
        const a = mine.find((r) => r.raci === 'A' && r.effective_from <= t);
        const inherited = a ? null : acc.resolve({ companyId: actor.companyId, processCode: p.code, projectId: scope.projectId, siteId: scope.scopeType === 'SITE' ? scope.scopeId : null, departmentId: scope.scopeType === 'DEPARTMENT' ? scope.scopeId : null, date: t });
        return { code: p.code, name: p.name, assignments: mine.map(present), accountable: a?.user_id ?? null, inherited: inherited && (inherited.scope.type !== scope.scopeType || inherited.scope.id !== scope.scopeId) ? { user: inherited.accountable, scope: inherited.scope } : null };
      });
      return { scope: { type: scope.scopeType, id: scope.scopeId, label: scope.label, live: scope.live }, processes, pending: pending.length ? { batchId: pending[0].batch_id, instanceId: pending[0].instance_id, by: pending[0].created_by, from: pending[0].effective_from, processes: [...new Set(pending.map((r) => r.process_code))], reason: pending[0].reason } : null, templates: templates(actor.companyId), canMaintain: may(actor, 'acc.raci.maintain', { projectId: scope.projectId, siteId: scope.siteId }) };
    },
    /**
     * The whole answer for the processes named: for each, who is R, A, C and I from the date. BR-01: exactly one Accountable, a person. A scope that is a live project changes only through
     * the approval of its project manager and then its project director; any other scope changes at once. Nothing changes if nothing differs.
     */
    propose(actor, b) {
      const scope = scopeOf(actor, b, 'acc.raci.maintain');
      const known = new Map(templates(actor.companyId).map((p) => [p.code, p]));
      const from = b.effectiveFrom ?? today();
      if (from < today()) throw badRequest('Some fields are invalid.', [{ field: 'effectiveFrom', message: 'A change cannot start in the past.' }]);
      const problems = [];
      const seenProcess = new Set();
      b.processes.forEach((p, i) => {
        const at = `processes.${i}`;
        if (!known.has(p.processCode)) problems.push({ field: `${at}.processCode`, message: `${p.processCode} is not a process of the list.` });
        if (seenProcess.has(p.processCode)) problems.push({ field: `${at}.processCode`, message: `${p.processCode} is given twice.` });
        seenProcess.add(p.processCode);
        const a = p.assignments.filter((x) => x.raci === 'A');
        if (a.length !== 1) problems.push({ field: `${at}.assignments`, message: a.length ? `${p.processCode} has ${a.length} accountable people; exactly one is allowed.` : `${p.processCode} has nobody accountable; name exactly one person.` });
        const keys = new Set();
        p.assignments.forEach((x, j) => {
          if (!x.user === !x.role) problems.push({ field: `${at}.assignments.${j}`, message: 'Name a person or a role, not both and not neither.' });
          if (x.role && !ROLE_CODES.has(x.role)) problems.push({ field: `${at}.assignments.${j}.role`, message: `${x.role} is not a role of the catalogue.` });
          if (x.raci === 'A' && !x.user) problems.push({ field: `${at}.assignments.${j}`, message: 'The accountable one is a person, not a role.' });
          const k = `${x.user ?? `role:${x.role}`}|${x.raci}`;
          if (keys.has(k)) problems.push({ field: `${at}.assignments.${j}`, message: `${x.user ?? x.role} is given twice as ${x.raci}.` });
          keys.add(k);
        });
      });
      if (problems.length) throw badRequest('The RACI is not valid.', problems);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM acc_raci_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND status = 'PENDING' LIMIT 1").get(actor.companyId, scope.scopeType, scope.scopeId)) throw conflict('A change of this scope is already waiting for approval. It must be decided first.');
        const changed = b.processes.filter((p) => {
          const now = db.prepare("SELECT user_id, role_code, raci FROM acc_raci_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND process_code = ? AND status = 'ACTIVE' AND (effective_to IS NULL OR effective_to >= ?)").all(actor.companyId, scope.scopeType, scope.scopeId, p.processCode, today());
          const norm = (l) => l.map((x) => `${x.user ?? x.user_id ?? ''}|${x.role ?? x.role_code ?? ''}|${x.raci}`).sort().join(';');
          return norm(now) !== norm(p.assignments);
        });
        if (!changed.length) throw unprocessable('Nothing is different from what is in force, so there is nothing to change.');
        const batchId = Number(db.prepare('SELECT COALESCE(MAX(batch_id), 0) + 1 AS n FROM acc_raci_assignments').get().n);
        const ins = db.prepare(`INSERT INTO acc_raci_assignments (company_id, scope_type, scope_id, process_code, user_id, role_code, raci, status, effective_from, batch_id, reason, project_id, site_id, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, 'raci_change')`);
        for (const p of changed) for (const x of p.assignments) ins.run(actor.companyId, scope.scopeType, scope.scopeId, p.processCode, x.user ?? null, x.role ?? null, x.raci, from, batchId, b.reason, scope.projectId, scope.siteId, actor.user);
        writeAudit(db, { entity: 'acc_raci_assignments', entityId: batchId, action: 'propose', newValues: { scope: `${scope.scopeType} ${scope.scopeId}`, processes: changed.map((p) => p.processCode), from }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        if (!scope.live) {
          activateBatch(db, batchId, actor);
          return { applied: true, batchId, processes: changed.map((p) => p.processCode) };
        }
        const instance = engine.submit(actor, { docType: RACI_DOC, docId: batchId, comment: b.reason, context: { scopeType: scope.scopeType, processes: changed.length } });
        db.prepare('UPDATE acc_raci_assignments SET instance_id = ? WHERE batch_id = ?').run(instance.id, batchId);
        event(db, 'acc.raci.proposed', 'acc_raci', batchId, actor, actor.companyId, { scopeType: scope.scopeType, scopeId: scope.scopeId, processes: changed.length }, { projectId: scope.projectId });
        return { applied: false, batchId, workflow: instance, processes: changed.map((p) => p.processCode) };
      });
    },
    /** A standard set of processes copied into a scope (FR-02). The accountable role of each template needs a person; the other roles stay as roles unless a person is named for them. */
    applyTemplate(actor, b) {
      const known = templates(actor.companyId);
      const chosen = b.processCodes?.length ? known.filter((t) => b.processCodes.includes(t.code)) : known;
      if (!chosen.length) throw unprocessable('None of those processes is in the list.');
      const problems = [];
      const processes = chosen.map((t) => ({
        processCode: t.code,
        assignments: t.roles.map((r) => {
          const person = b.people[r.role];
          if (r.raci === 'A' && !person) problems.push({ field: `people.${r.role}`, message: `Name the person who is ${r.role} for ${t.name}; the accountable one is a person.` });
          return person ? { user: person, raci: r.raci } : { role: r.role, raci: r.raci };
        }),
      }));
      if (problems.length) throw badRequest('The template cannot be applied yet.', [...new Map(problems.map((p) => [p.field, p])).values()]);
      return raci.propose(actor, { scopeType: b.scopeType, scopeId: b.scopeId, effectiveFrom: b.effectiveFrom, reason: b.reason, processes });
    },
    /** The answer other parts ask for: who is accountable and who is responsible for a process here. */
    resolve(actor, q) {
      if (!may(actor, 'acc.raci.view', { projectId: q.projectId ?? null }) && !may(actor, 'acc.report.view', { projectId: q.projectId ?? null })) throw forbidden('You may not see the RACI of this scope (permission acc.raci.view).');
      const r = acc.resolve({ companyId: actor.companyId, processCode: q.processCode, projectId: q.projectId ?? null, siteId: q.siteId ?? null, departmentId: q.departmentId ?? null, date: q.date ?? today() });
      return r ?? { accountable: null, gap: true, scope: null, responsible: [], consulted: [], informed: [] };
    },
    history(actor, q) {
      const scope = scopeOf(actor, q, 'acc.raci.view');
      const rows = db.prepare('SELECT * FROM acc_raci_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND (? IS NULL OR process_code = ?) ORDER BY id DESC LIMIT 200').all(actor.companyId, scope.scopeType, scope.scopeId, q.processCode ?? null, q.processCode ?? null);
      return rows.map((r) => ({ ...present(r), by: r.created_by, reason: r.reason, at: r.created_at }));
    },
    /** FR-06: for each project that is not closed, the processes nobody is accountable for (inherited from the company counts), and the ones with more than one by a fault of the data. */
    gaps(actor, /** @type {any} */ { projectId, onlyGaps = true } = {}) {
      const projects = db.prepare("SELECT id, code, name, status FROM org_projects WHERE company_id = ? AND status IN ('DRAFT', 'ACTIVE', 'ON_HOLD') AND is_active = 1 AND (? IS NULL OR id = ?) ORDER BY code").all(actor.companyId, projectId ?? null, projectId ?? null).filter((p) => may(actor, 'acc.raci.view', { projectId: p.id }));
      const procs = templates(actor.companyId);
      const t = today();
      const as = db.prepare("SELECT scope_type, scope_id, process_code, COUNT(*) AS n FROM acc_raci_assignments WHERE company_id = ? AND raci = 'A' AND status = 'ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND is_active = 1 GROUP BY scope_type, scope_id, process_code").all(actor.companyId, t, t);
      const count = new Map(as.map((r) => [`${r.scope_type}|${r.scope_id}|${r.process_code}`, r.n]));
      const rows = [];
      const perProject = [];
      for (const p of projects) {
        let gaps = 0;
        for (const pr of procs) {
          const own = count.get(`PROJECT|${p.id}|${pr.code}`) ?? 0;
          const company = count.get(`COMPANY|0|${pr.code}`) ?? 0;
          const status = own > 1 || (own === 0 && company > 1) ? 'MULTIPLE' : own === 1 || company === 1 ? 'OK' : 'GAP';
          if (status !== 'OK') gaps += 1;
          if (status !== 'OK' || !onlyGaps) rows.push({ projectId: p.id, project: `${p.code} ${p.name}`, processCode: pr.code, process: pr.name, status, source: own ? 'project' : company ? 'company' : null });
        }
        perProject.push({ id: p.id, code: p.code, name: p.name, gaps, processes: procs.length });
      }
      return { summary: { projects: projects.length, processes: procs.length, gaps: rows.filter((r) => r.status === 'GAP').length, multiple: rows.filter((r) => r.status === 'MULTIPLE').length }, projects: perProject, rows };
    },
  };

  // ---- the ledger and the scores ----
  const ledgerScope = (actor, p, alias = 'l') => {
    if (!may(actor, 'acc.ledger.view') && !may(actor, 'acc.report.view')) return null;
    return authz.scopeFilter(actor, may(actor, 'acc.ledger.view') ? 'acc.ledger.view' : 'acc.report.view', { project: `${alias}.project_id`, site: `${alias}.site_id` }).sql;
  };
  const entryOf = (r) => ({ id: r.id, at: r.occurred_at, actor: r.actor_id, role: r.role_code, action: r.action, entity: r.entity, entityId: r.entity_id, entityRef: r.entity_ref, process: r.process_code, outcome: r.outcome, dueAt: r.due_at, onTime: r.on_time == null ? null : r.on_time === 1, affectedUser: r.affected_user, projectId: r.project_id, details: JSON.parse(r.details_json || '{}') });
  const ledger = {
    list(actor, q = {}) {
      acc.sync();
      const p = { c: actor.companyId, limit: q.limit ?? 25, offset: q.offset ?? 0 };
      const where = ['l.company_id = :c'];
      const scoped = ledgerScope(actor, p);
      if (scoped == null || (q.user === actor.user && !may(actor, 'acc.ledger.view'))) {
        if (q.user && q.user !== actor.user) throw forbidden('You may see your own actions; the actions of others need permission acc.ledger.view.');
        where.push('l.actor_id = :me'); p.me = actor.user;
      } else {
        where.push(scoped);
        if (q.user) { where.push('l.actor_id = :u'); p.u = q.user; }
      }
      for (const [k, col] of [['action', 'l.action'], ['entity', 'l.entity'], ['process', 'l.process_code'], ['outcome', 'l.outcome']]) if (q[k]) { where.push(`${col} = :${k}`); p[k] = q[k]; }
      if (q.project) { where.push('l.project_id = :pr'); p.pr = q.project; }
      if (q.from) { where.push('l.occurred_at >= :from'); p.from = `${q.from}T00:00:00.000Z`; }
      if (q.to) { where.push('l.occurred_at <= :to'); p.to = `${q.to}T23:59:59.999Z`; }
      if (q.q) { where.push('(l.entity_ref LIKE :q OR l.entity_id LIKE :q OR l.actor_id LIKE :q)'); p.q = `%${q.q}%`; }
      const pc = { ...p }; delete pc.limit; delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM acc_action_ledger l WHERE ${where.join(' AND ')}`).get(pc).n;
      const rows = db.prepare(`SELECT l.* FROM acc_action_ledger l WHERE ${where.join(' AND ')} ORDER BY l.occurred_at DESC, l.id DESC LIMIT :limit OFFSET :offset`).all(p).map(entryOf);
      return { rows, total };
    },
  };

  /** The score is an input to a human review (07.11), never a decision: the share of timed actions that were on time, less a little for open items past their time and for returns and rejections received. */
  const scoreOf = (m) => {
    const timed = m.onTime + m.late;
    const base = timed ? (m.onTime / timed) * 100 : 100;
    const penalty = Math.min(30, m.overdueOpen * 5 + m.returnsReceived * 2 + m.rejectsReceived * 3);
    return Math.max(0, Math.round((base - penalty) * 10) / 10);
  };
  const empty = () => ({ actions: 0, onTime: 0, late: 0, exceptionsRaised: 0, returnsReceived: 0, rejectsReceived: 0, overdueOpen: 0 });
  const finish = (k, label, m) => ({ key: k, label, ...m, onTimePct: m.onTime + m.late ? Math.round((m.onTime / (m.onTime + m.late)) * 1000) / 10 : null, score: scoreOf(m) });
  const NOTE = 'The score is an input to the performance review (part 07.11). It is read by a person with the context of the work, and is never a penalty on its own.';
  const scores = {
    note: NOTE,
    /** by 'person', 'role' or 'project'; `self` lets a person read their own row without the report permission. */
    list(actor, q = {}, { self = false } = {}) {
      acc.sync();
      const by = q.by ?? 'person';
      const from = q.from ? `${q.from}T00:00:00.000Z` : new Date(Date.parse(engine.clock().toISOString()) - 90 * 86_400_000).toISOString();
      const to = q.to ? `${q.to}T23:59:59.999Z` : '9999';
      const p = { c: actor.companyId, from, to };
      let scope;
      if (self) { scope = 'l.actor_id = :me'; p.me = actor.user; }
      else {
        if (!may(actor, 'acc.report.view')) throw forbidden('You may not see the accountability report (permission acc.report.view).');
        scope = authz.scopeFilter(actor, 'acc.report.view', { project: 'l.project_id', site: 'l.site_id' }).sql;
      }
      const where = ['l.company_id = :c', 'l.occurred_at >= :from', 'l.occurred_at <= :to', scope];
      if (q.projectId) { where.push('l.project_id = :pr'); p.pr = q.projectId; }
      if (q.processCode) { where.push('l.process_code = :pc'); p.pc = q.processCode; }
      const col = { person: 'l.actor_id', role: 'l.role_code', project: 'l.project_id' }[by];
      const groups = new Map();
      const get = (k) => { if (!groups.has(k)) groups.set(k, empty()); return groups.get(k); };
      for (const r of db.prepare(`SELECT ${col} AS k, COUNT(*) AS n, SUM(CASE WHEN l.on_time = 1 THEN 1 ELSE 0 END) AS ot, SUM(CASE WHEN l.on_time = 0 THEN 1 ELSE 0 END) AS late FROM acc_action_ledger l WHERE ${where.join(' AND ')} AND ${col} IS NOT NULL GROUP BY ${col}`).all(p)) { const g = get(r.k); g.actions = r.n; g.onTime = r.ot; g.late = r.late; }
      for (const r of db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM acc_action_ledger l WHERE ${where.join(' AND ')} AND l.entity = 'pcs_exception' AND l.action = 'submitted' AND ${col} IS NOT NULL GROUP BY ${col}`).all(p)) get(r.k).exceptionsRaised = r.n;
      const rc = by === 'person' ? 'l.affected_user' : col;
      for (const r of db.prepare(`SELECT ${rc} AS k, l.outcome AS o, COUNT(*) AS n FROM acc_action_ledger l WHERE ${where.join(' AND ')} AND l.outcome IN ('RETURNED', 'REJECTED') AND ${rc} IS NOT NULL ${by === 'role' ? 'AND 0' : ''} GROUP BY ${rc}, l.outcome`).all(p)) { const g = get(r.k); if (r.o === 'RETURNED') g.returnsReceived += r.n; else g.rejectsReceived += r.n; }
      const nowIso = engine.clock().toISOString();
      const overdueCol = { person: 't.assignee_user_id', role: 't.assignee_role', project: 't.project_id' }[by];
      for (const r of db.prepare(`SELECT ${overdueCol} AS k, COUNT(*) AS n FROM wf_tasks t WHERE t.company_id = :c AND t.status = 'OPEN' AND t.superseded = 0 AND t.due_at < :now AND ${overdueCol} IS NOT NULL ${by === 'person' && self ? 'AND t.assignee_user_id = :me' : ''} GROUP BY ${overdueCol}`).all({ c: actor.companyId, now: nowIso, ...(by === 'person' && self ? { me: actor.user } : {}) })) if (groups.has(r.k) || self) get(r.k).overdueOpen = r.n;
      const label = (k) => (by === 'project' ? scopeLabel(db, actor.companyId, 'PROJECT', k) : String(k));
      const rows = [...groups.entries()].map(([k, m]) => finish(k, label(k), m)).sort((a, b) => a.score - b.score || String(a.label).localeCompare(String(b.label)));
      const total = rows.reduce((t, r) => { for (const f of Object.keys(empty())) t[f] += r[f]; return t; }, empty());
      return { by, from: from.slice(0, 10), to: q.to ?? null, rows, totals: finish('all', 'Everyone shown', total), note: NOTE, projects: db.prepare('SELECT DISTINCT p.id, p.code, p.name FROM acc_action_ledger l JOIN org_projects p ON p.id = l.project_id WHERE l.company_id = ? ORDER BY p.code').all(actor.companyId).filter((x) => may(actor, 'acc.report.view', { projectId: x.id })) };
    },
  };

  /** My Accountability (FR-04): what I answer for, what of mine is overdue, what I did lately, and my own figures. Needs no permission: it is only about the person. */
  function me(actor, q = {}) {
    acc.sync();
    const t = today();
    const roles = (actor.roles ?? []).filter(Boolean);
    const params = [actor.companyId, actor.user, t, t];
    const roleSql = roles.length ? ` OR a.role_code IN (${roles.map(() => '?').join(',')})` : '';
    const rows = db.prepare(`SELECT a.* FROM acc_raci_assignments a WHERE a.company_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?) AND (a.user_id = ?${roleSql}) ORDER BY a.process_code, a.scope_type, a.scope_id`).all(params[0], t, t, ...[params[1]], ...roles)
      .filter((r) => !q.projectId || (r.scope_type === 'PROJECT' && r.scope_id === q.projectId) || r.scope_type === 'COMPANY');
    const names = new Map(templates(actor.companyId).map((p) => [p.code, p.name]));
    const responsibilities = rows.map((r) => ({ processCode: r.process_code, process: names.get(r.process_code) ?? r.process_code, raci: r.raci, via: r.user_id ? 'you' : `your role ${r.role_code}`, scopeType: r.scope_type, scopeId: r.scope_id, scope: scopeLabel(db, actor.companyId, r.scope_type, r.scope_id), from: r.effective_from }));
    const overdue = engine.listTasks(actor, { mine: 'assigned', limit: 100 }).rows.filter((x) => x.dueAt && x.dueAt < engine.clock().toISOString())
      .map((x) => ({ taskId: x.id, title: `${x.instance.docLabel} ${x.instance.docRef ?? x.instance.docId}: ${x.step}`, dueAt: x.dueAt, hoursOverdue: Math.round((Date.parse(engine.clock().toISOString()) - Date.parse(x.dueAt)) / 3_600_000) }));
    const recent = ledger.list(actor, { user: actor.user, limit: 15, offset: 0, project: q.projectId }).rows;
    const mine = scores.list(actor, { by: 'person', from: q.from, to: q.to, projectId: q.projectId }, { self: true }).rows.find((r) => r.key === actor.user) ?? finish(actor.user, actor.user, empty());
    return { user: actor.user, responsibilities, counts: { responsible: responsibilities.filter((r) => r.raci === 'R').length, accountable: responsibilities.filter((r) => r.raci === 'A').length, consulted: responsibilities.filter((r) => r.raci === 'C').length, informed: responsibilities.filter((r) => r.raci === 'I').length }, overdue, recent, score: mine, note: NOTE,
      projects: db.prepare('SELECT DISTINCT p.id, p.code, p.name FROM acc_action_ledger l JOIN org_projects p ON p.id = l.project_id WHERE l.company_id = ? AND l.actor_id = ? ORDER BY p.code').all(actor.companyId, actor.user) };
  }

  return { raci, ledger, scores, me, templates: (a) => templates(a.companyId), sync: () => acc.sync() };
}
