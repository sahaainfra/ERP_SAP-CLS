import { inTransaction as transaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { authzOf, ROLE_TEMPLATES } from '../authz/index.js';
import { publishEvent } from '../events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../http/errors.js';
import { STEP_MODES, STEP_TYPES, OPS, normaliseDefinition, packSteps, unpackSteps } from './definition.js';
import { systemActions, workflowResolvers, workflowTypes } from './registry.js';

export const DEFINITION_DOC_TYPE = 'WF_DEFINITION';
const iso = () => new Date().toISOString();

// the activation workflow of a definition
workflowTypes.register({
  docType: DEFINITION_DOC_TYPE,
  label: 'Workflow definition',
  processOwner: 'SYSADM',
  route: (id) => `/admin/workflows/editor?id=${id}`,
  describe: (database, companyId, id) => {
    const r = database.prepare('SELECT * FROM wf_definitions WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return r ? { ref: `${r.doc_type} v${r.version}`, title: r.name } : null;
  },
  defaultDefinition: {
    name: 'Workflow definition activation',
    settings: { resubmit: 'first', distinctApprovers: true },
    steps: [
      { code: 'ADMIN', name: 'System administrator check', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'SYSADM' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null },
      { code: 'OWNER', name: 'Process owner', type: 'approval', mode: 'single', approvers: [{ kind: 'resolver', resolver: 'process_owner' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null },
      { code: 'TECH', name: 'Technical validation', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'ITADM' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null },
    ],
  },
  hooks: {
    onApproved(database, { instance, actor }) {
      const r = database.prepare('SELECT * FROM wf_definitions WHERE id = ?').get(Number(instance.docId));
      database.prepare("UPDATE wf_definitions SET status = 'RETIRED', retired_at = ?, updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE company_id = ? AND doc_type = ? AND status = 'ACTIVE' AND id != ?").run(iso(), actor.user, iso(), r.company_id, r.doc_type, r.id);
      database.prepare("UPDATE wf_definitions SET status = 'ACTIVE', activated_at = ?, activated_by = ?, updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(iso(), actor.user, actor.user, iso(), r.id);
      writeAudit(database, { entity: 'wf_definitions', entityId: r.id, action: 'activate', newValues: { docType: r.doc_type, version: r.version }, actor: actor.user });
      publishEvent(database, { type: 'workflow.definition.activated', entity: 'workflow_definition', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { docType: r.doc_type, version: r.version } });
    },
    onRejected: (database, { instance, actor }) => database.prepare("UPDATE wf_definitions SET status = 'REJECTED', updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, iso(), Number(instance.docId)),
    onReturned: (database, { instance, actor }) => database.prepare("UPDATE wf_definitions SET status = 'REJECTED', updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, iso(), Number(instance.docId)),
    onCancelled: (database, { instance, actor }) => database.prepare("UPDATE wf_definitions SET status = 'DRAFT', updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, iso(), Number(instance.docId)),
  },
});
// the owner of the process of the document type is the second approver
if (!workflowResolvers.get('process_owner')) workflowResolvers.register('process_owner', ({ instance }) => [{ role: workflowTypes.get(instance.context.docType)?.processOwner ?? 'SYSADM' }]);


/**
 * Definitions of workflows: a new version is a draft the maker edits; activating it is itself a workflow (SYSADM, then the owner of the process,
 * then ITADM), so a chain cannot be changed by one person. Running instances keep the version they started with (FR-02).
 */
export function createDefinitionService({ db, engine }) {
  const authz = authzOf(db);
  const present = (r, { withSteps = true } = {}) => {
    const body = unpackSteps(r.steps_json);
    return {
      id: r.id, docType: r.doc_type, docLabel: workflowTypes.get(r.doc_type)?.label ?? r.doc_type, version: r.version, name: r.name, status: r.status, activatedAt: r.activated_at, activatedBy: r.activated_by,
      retiredAt: r.retired_at, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, rowVersion: r.row_version, stepCount: body.steps.length, source: r.source_type, requestInstanceId: r.activation_instance_id,
      running: db.prepare("SELECT COUNT(*) AS n FROM wf_instances WHERE definition_id = ? AND status = 'RUNNING'").get(r.id).n,
      ...(withSteps ? { settings: body.settings, steps: body.steps } : {}),
    };
  };
  const load = (actor, id) => {
    const r = db.prepare('SELECT * FROM wf_definitions WHERE id = ? AND is_active = 1').get(id);
    if (!r || r.company_id !== actor.companyId) throw notFound('That workflow definition does not exist.');
    return r;
  };
  const mustDefine = (actor) => { if (!authz.check(actor, 'eng.workflow.define').allowed) throw forbidden('Only someone who may define workflows (eng.workflow.define) can do this.'); };
  const nextVersion = (companyId, docType) => db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM wf_definitions WHERE company_id = ? AND doc_type = ?').get(companyId, docType).v;
  const touch = (actor, id, patch) => {
    const cols = Object.keys(patch);
    db.prepare(`UPDATE wf_definitions SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, updated_by = :by, updated_at = :now, row_version = row_version + 1 WHERE id = :id`).run({ ...patch, by: actor.user, now: iso(), id });
  };

  return {
    present,
    /** The definitions and the document types that have none yet (they start with the module's default when first used). */
    list(actor, { docType, status, q, limit = 25, offset = 0 } = {}) {
      const where = ['company_id = :c', 'is_active = 1'];
      const p = { c: actor.companyId, limit, offset };
      if (docType) { where.push('doc_type = :t'); p.t = docType; }
      if (status) { where.push('status = :s'); p.s = status; }
      if (q) { where.push('(name LIKE :q OR doc_type LIKE :q)'); p.q = `%${q}%`; }
      const pc = { ...p };
    delete pc.limit;
    delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM wf_definitions WHERE ${where.join(' AND ')}`).get(pc).n;
      const rows = db.prepare(`SELECT * FROM wf_definitions WHERE ${where.join(' AND ')} ORDER BY doc_type, version DESC LIMIT :limit OFFSET :offset`).all(p).map((r) => present(r, { withSteps: false }));
      const used = new Set(db.prepare('SELECT DISTINCT doc_type FROM wf_definitions WHERE company_id = ?').all(actor.companyId).map((r) => r.doc_type));
      return { rows, total, docTypes: workflowTypes.list().map((t) => ({ docType: t.docType, label: t.label ?? t.docType, processOwner: t.processOwner, hasDefinition: used.has(t.docType) })) };
    },
    /** The choices the editor offers. */
    options() {
      return {
        stepTypes: STEP_TYPES, stepModes: STEP_MODES, operators: OPS, resolvers: workflowResolvers.names(), systemActions: systemActions.names(),
        roles: ROLE_TEMPLATES.map((r) => ({ code: r.code, name: r.name })).sort((a, b) => a.code.localeCompare(b.code)),
        docTypes: workflowTypes.list().map((t) => ({ docType: t.docType, label: t.label ?? t.docType, processOwner: t.processOwner })),
      };
    },
    get(actor, id) {
      return present(load(actor, id));
    },
    /** A new draft version of a document type: from the body given or, without one, a copy of the active version (or the module's default). */
    create(actor, body) {
      mustDefine(actor);
      return transaction(db, () => {
        const t = workflowTypes.get(body.docType);
        if (!t) throw unprocessable(`The document type ${body.docType} is not known to the workflow engine.`);
        const def = normaliseDefinition(body);
        const version = nextVersion(actor.companyId, def.docType);
        const res = db.prepare("INSERT INTO wf_definitions (company_id, doc_type, version, name, status, steps_json, created_by, source_type) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, 'definition_editor')").run(actor.companyId, def.docType, version, def.name, packSteps(def), actor.user);
        const id = Number(res.lastInsertRowid);
        writeAudit(db, { entity: 'wf_definitions', entityId: id, action: 'create', newValues: { docType: def.docType, version, steps: def.steps.length }, actor: actor.user });
        return present(db.prepare('SELECT * FROM wf_definitions WHERE id = ?').get(id));
      });
    },
    /** A draft for a document type starting from the active definition (so the editor never begins empty). */
    draftFrom(actor, docType) {
      mustDefine(actor);
      const active = engine.activeDefinition(actor.companyId, docType);
      const body = unpackSteps(active.steps_json);
      return this.create(actor, { docType, name: active.name, settings: body.settings, steps: body.steps });
    },
    update(actor, id, body, rowVersion) {
      mustDefine(actor);
      return transaction(db, () => {
        const r = load(actor, id);
        if (!['DRAFT', 'REJECTED'].includes(r.status)) throw unprocessable(`A ${r.status.toLowerCase()} version cannot be edited. Make a new version from it instead.`);
        if (rowVersion !== undefined && rowVersion !== r.row_version) throw conflict('This definition was changed by someone else. Refresh it and edit again.');
        const def = normaliseDefinition(body, { forDocType: r.doc_type });
        touch(actor, id, { name: def.name, steps_json: packSteps(def), status: 'DRAFT' });
        writeAudit(db, { entity: 'wf_definitions', entityId: id, action: 'update', oldValues: { steps: unpackSteps(r.steps_json).steps.length }, newValues: { steps: def.steps.length }, actor: actor.user });
        return present(db.prepare('SELECT * FROM wf_definitions WHERE id = ?').get(id));
      });
    },
    remove(actor, id) {
      mustDefine(actor);
      return transaction(db, () => {
        const r = load(actor, id);
        if (!['DRAFT', 'REJECTED'].includes(r.status)) throw unprocessable('Only a draft or a rejected version can be deleted; active and retired versions are kept for the instances that used them.');
        db.prepare('UPDATE wf_definitions SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ?').run(iso(), actor.user, id);
        writeAudit(db, { entity: 'wf_definitions', entityId: id, action: 'delete', actor: actor.user });
        return { id };
      });
    },
    /** Ask for a draft to become the active version: this starts the approval of the definition (SYSADM, the process owner, ITADM). */
    activate(actor, id) {
      mustDefine(actor);
      return transaction(db, () => {
        const r = load(actor, id);
        if (!['DRAFT', 'REJECTED'].includes(r.status)) throw unprocessable(r.status === 'ACTIVE' ? 'This version is already active.' : `A ${r.status.toLowerCase()} version cannot be activated.`);
        normaliseDefinition({ docType: r.doc_type, name: r.name, ...unpackSteps(r.steps_json) }); // the stored draft is valid today as well
        const t = workflowTypes.get(r.doc_type);
        touch(actor, id, { status: 'PENDING' });
        const instance = engine.submit(actor, { docType: DEFINITION_DOC_TYPE, docId: String(id), context: { docType: r.doc_type, version: r.version, processOwner: t?.processOwner ?? 'SYSADM', steps: unpackSteps(r.steps_json).steps.length }, comment: `Activate ${r.doc_type} version ${r.version}` });
        touch(actor, id, { activation_instance_id: instance.id });
        return { definition: present(db.prepare('SELECT * FROM wf_definitions WHERE id = ?').get(id)), instance };
      });
    },
    /** What differs between two versions of one type, step by step (the editor shows it before activation). */
    compare(actor, aId, bId) {
      const a = load(actor, aId);
      const b = load(actor, bId);
      if (a.doc_type !== b.doc_type) throw badRequest('Only two versions of the same document type can be compared.');
      const sa = unpackSteps(a.steps_json).steps;
      const sb = unpackSteps(b.steps_json).steps;
      const codes = [...new Set([...sa.map((s) => s.code), ...sb.map((s) => s.code)])];
      return codes.map((code) => {
        const x = sa.find((s) => s.code === code);
        const y = sb.find((s) => s.code === code);
        return { code, change: !x ? 'ADDED' : !y ? 'REMOVED' : JSON.stringify(x) === JSON.stringify(y) ? 'SAME' : 'CHANGED', from: x ?? null, to: y ?? null };
      });
    },
  };
}
