import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';

// The documents the controls of the engine are changed through (part 04.02, section 9): a change of the approval matrix, of the authority limits, of the
// escalation hierarchy or the SLA settings, and a delegation of more than 15 days. Each is a document of the engine, so the engine's own rules (nobody approves
// what they raised, one person one step) protect the controls of every other document. A change is a row waiting with status PENDING; the hook of the last
// approval makes it ACTIVE, and the rejection of any step leaves it REJECTED (a return too: the maker corrects and asks again).
export const MATRIX_DOC = 'WF_MATRIX';
export const AUTHORITY_DOC = 'WF_AUTHORITY';
export const CONFIG_DOC = 'WF_CONFIG';
export const DELEGATION_DOC = 'WF_DELEGATION';
export const BIG_LIMIT_RUPEES = 10_000_000; // above ₹1 Cr the director also approves
const iso = () => new Date().toISOString();
const day = () => iso().slice(0, 10);
const dayBefore = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 24, requireAttachment: false, checklist: [], when, notify: [], action: null });
const changeChain = [
  step('MAKER_CHECK', 'System administrator check', [{ kind: 'role', role: 'SYSADM' }]),
  step('OWNER', 'Chief financial officer or process owner', [{ kind: 'resolver', resolver: 'matrix_owner' }]),
  step('DIRECTOR', 'Director (limits above ₹1 Cr)', [{ kind: 'role', role: 'DIR' }], { field: 'maxAmount', op: 'gt', value: BIG_LIMIT_RUPEES }),
];
if (!workflowResolvers.get('matrix_owner')) workflowResolvers.register('matrix_owner', ({ instance }) => [{ role: instance.context.owner || 'CFO' }]);

const status = (db, table, id, to, actor, extra = '') => db.prepare(`UPDATE ${table} SET status = ?, ${extra} updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(to, actor.user, iso(), id);
const event = (db, type, entity, id, actor, companyId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, data });

/** Make a batch of rows of a table take effect: the rows become ACTIVE and the ones they replace end the day before. `same` names the columns that identify what a row replaces. */
function activateBatch(db, table, batchId, actor, same) {
  const rows = db.prepare(`SELECT * FROM ${table} WHERE batch_id = ? AND status = 'PENDING'`).all(batchId);
  for (const r of rows) {
    const clause = same.map((c) => `${c} = ?`).join(' AND ');
    const params = same.map((c) => r[c]);
    const from = r.effective_from <= day() ? r.effective_from : r.effective_from;
    db.prepare(`UPDATE ${table} SET effective_to = ?, status = CASE WHEN ? < ? THEN 'RETIRED' ELSE status END, updated_by = ?, updated_at = ?, version = version + 1
      WHERE company_id = ? AND id != ? AND status = 'ACTIVE' AND ${clause} AND effective_from < ? AND (effective_to IS NULL OR effective_to >= ?)`)
      .run(dayBefore(from), dayBefore(from), day(), actor.user, iso(), r.company_id, r.id, ...params, from, from);
    status(db, table, r.id, 'ACTIVE', actor);
  }
  return rows;
}
const rejectBatch = (db, table, batchId, actor, to = 'REJECTED') => db.prepare(`UPDATE ${table} SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE batch_id = ? AND status = 'PENDING'`).run(to, actor.user, iso(), batchId);

const common = (label, onApproved, onFailed) => ({
  label,
  processOwner: 'SYSADM',
  defaultDefinition: { name: `${label} approval`, settings: { resubmit: 'first', distinctApprovers: true }, steps: changeChain },
  hooks: {
    onApproved: (db, { instance, actor }) => onApproved(db, Number(instance.docId), actor, instance.companyId),
    onRejected: (db, { instance, actor }) => onFailed(db, Number(instance.docId), actor, 'REJECTED'),
    onReturned: (db, { instance, actor }) => onFailed(db, Number(instance.docId), actor, 'REJECTED'),
    onCancelled: (db, { instance, actor }) => onFailed(db, Number(instance.docId), actor, 'REJECTED'),
  },
});

workflowTypes.register({
  docType: MATRIX_DOC,
  route: (id) => `/admin/approval-matrix/editor?id=${id}`,
  describe: (db, companyId, id) => { const m = db.prepare('SELECT * FROM wf_matrix WHERE id = ? AND company_id = ?').get(Number(id), companyId); return m ? { ref: `${m.doc_type} v${m.matrix_version}`, title: m.name } : null; },
  ...common('Approval matrix change',
    (db, id, actor) => {
      const m = db.prepare('SELECT * FROM wf_matrix WHERE id = ?').get(id);
      db.prepare(`UPDATE wf_matrix SET effective_to = ?, status = CASE WHEN ? < ? THEN 'RETIRED' ELSE status END, updated_by = ?, updated_at = ?, version = version + 1
        WHERE company_id = ? AND doc_type = ? AND scope_type = ? AND scope_id = ? AND id != ? AND status = 'ACTIVE' AND matrix_version < ? AND (effective_to IS NULL OR effective_to >= ?)`)
        .run(dayBefore(m.effective_from), dayBefore(m.effective_from), day(), actor.user, iso(), m.company_id, m.doc_type, m.scope_type, m.scope_id, m.id, m.matrix_version, m.effective_from);
      db.prepare("UPDATE wf_matrix SET status = 'ACTIVE', activated_at = ?, activated_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), actor.user, actor.user, iso(), id);
      writeAudit(db, { entity: 'wf_matrix', entityId: id, action: 'activate', newValues: { docType: m.doc_type, version: m.matrix_version, from: m.effective_from }, actor: actor.user });
      event(db, 'workflow.matrix.activated', 'workflow_matrix', id, actor, m.company_id, { docType: m.doc_type, version: m.matrix_version, effectiveFrom: m.effective_from });
    },
    (db, id, actor, to) => status(db, 'wf_matrix', id, to, actor)),
});

workflowTypes.register({
  docType: AUTHORITY_DOC,
  route: () => '/admin/authority-limits',
  describe: (db, companyId, id) => { const r = db.prepare('SELECT * FROM wf_authority_limits WHERE batch_id = ? AND company_id = ? LIMIT 1').get(Number(id), companyId); return r ? { ref: `Limits #${id}`, title: 'Change of authority limits' } : null; },
  ...common('Authority limit change',
    (db, batchId, actor, companyId) => {
      const rows = activateBatch(db, 'wf_authority_limits', batchId, actor, ['role_code', 'doc_type']);
      writeAudit(db, { entity: 'wf_authority_limits', entityId: batchId, action: 'activate', newValues: { rows: rows.length }, actor: actor.user });
      event(db, 'workflow.authority_limits.changed', 'workflow_authority_limits', batchId, actor, companyId, { rows: rows.length });
    },
    (db, batchId, actor, to) => rejectBatch(db, 'wf_authority_limits', batchId, actor, to)),
});

workflowTypes.register({
  docType: CONFIG_DOC,
  route: () => '/admin/escalation',
  describe: (db, companyId, id) => {
    const r = db.prepare('SELECT 1 FROM wf_escalation_paths WHERE batch_id = ? AND company_id = ? UNION SELECT 1 FROM wf_sla_settings WHERE batch_id = ? AND company_id = ? UNION SELECT 1 FROM wf_approval_policies WHERE batch_id = ? AND company_id = ?').get(Number(id), companyId, Number(id), companyId, Number(id), companyId);
    return r ? { ref: `Settings #${id}`, title: 'Change of escalation paths, SLA or approval settings' } : null;
  },
  ...common('Escalation and SLA settings change',
    (db, batchId, actor, companyId) => {
      const paths = activateBatch(db, 'wf_escalation_paths', batchId, actor, ['scope_type', 'scope_id']);
      const sla = activateBatch(db, 'wf_sla_settings', batchId, actor, ['doc_type']);
      const pol = activateBatch(db, 'wf_approval_policies', batchId, actor, ['doc_type']);
      writeAudit(db, { entity: 'wf_escalation_paths', entityId: batchId, action: 'activate', newValues: { paths: paths.length, sla: sla.length, policies: pol.length }, actor: actor.user });
      event(db, 'workflow.settings.changed', 'workflow_settings', batchId, actor, companyId, { paths: paths.length, sla: sla.length, policies: pol.length });
    },
    (db, batchId, actor, to) => { rejectBatch(db, 'wf_escalation_paths', batchId, actor, to); rejectBatch(db, 'wf_sla_settings', batchId, actor, to); rejectBatch(db, 'wf_approval_policies', batchId, actor, to); }),
});

workflowTypes.register({
  docType: DELEGATION_DOC,
  route: () => '/workflow/delegations',
  describe: (db, companyId, id) => { const d = db.prepare('SELECT * FROM wf_delegations WHERE id = ? AND company_id = ?').get(Number(id), companyId); return d ? { ref: `Delegation #${id}`, title: `${d.delegator} to ${d.delegate}`, originator: d.delegator } : null; },
  label: 'Delegation over 15 days',
  processOwner: 'HRMGR',
  defaultDefinition: { name: 'Long delegation approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('MANAGER', "Delegator's manager", [{ kind: 'manager' }])] },
  hooks: {
    onApproved(db, { instance, actor }) { status(db, 'wf_delegations', Number(instance.docId), 'ACTIVE', actor); event(db, 'workflow.delegation.activated', 'workflow_delegation', instance.docId, actor, instance.companyId, { id: Number(instance.docId) }); },
    onRejected: (db, { instance, actor }) => status(db, 'wf_delegations', Number(instance.docId), 'REJECTED', actor),
    onReturned: (db, { instance, actor }) => status(db, 'wf_delegations', Number(instance.docId), 'REJECTED', actor),
    onCancelled: (db, { instance, actor }) => status(db, 'wf_delegations', Number(instance.docId), 'REVOKED', actor),
  },
});
