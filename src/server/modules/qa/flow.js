import { transaction } from '../../platform/db/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { nowIso, rid, same } from '../proc/base.js';

export const STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
const EDITABLE = ['DRAFT', 'RETURNED'];

/**
 * The approval life of one kind of quality document, written once: the row with its rights, send for approval (the workflow engine), withdraw, cancel, history and the outcome of the approval. Each part gives what is special:
 * the permission prefix, the table, the workflow type, the context of the workflow, what must hold before it is sent (`beforeSubmit`) and what follows an approval or another outcome (`onApproved`, `onOutcome`).
 */
/** @param {any} o */
export function createFlow({ db, base, docType, table, perm, label, route, ctx, title, where = (r) => ({ pid: r.org_project_id ?? null, sid: r.org_site_id ?? null }), beforeSubmit = (/** @type {any} */ _a, /** @type {any} */ _r) => {}, onApproved = (/** @type {any} */ _a, /** @type {any} */ _r, /** @type {any} */ _c) => {}, onOutcome = (/** @type {any} */ _a, /** @type {any} */ _r, /** @type {any} */ _s, /** @type {any} */ _c) => {}, notifyCode, numberKey, prefix }) {
  const { authz, may, audit, notify, number } = base; void authz;
  const at = (r) => where(r);
  const flow = {
    perm, table, docType, EDITABLE,
    row(actor, id, key = `${perm}.view`) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(rid(id), actor.companyId); const w = r ? at(r) : null; if (!r || !may(actor, `${perm}.view`, w.pid, w.sid)) throw notFound(`That ${label} does not exist.`); if (key !== `${perm}.view` && !may(actor, key, w.pid, w.sid)) throw forbidden(`You may not do this (permission ${key}).`); return r; },
    can(actor, r) { const w = at(r); const c = (k) => may(actor, `${perm}.${k}`, w.pid, w.sid); const own = same(r.requested_by, actor.user);
      return { edit: c('edit') && EDITABLE.includes(r.status), delete: c('delete') && r.status === 'DRAFT', submit: c('submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: c('cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), amend: c('amend') && r.status === 'APPROVED', print: c('print') }; },
    approveInfo(actor, r) { const w = at(r); const own = same(r.requested_by, actor.user); const approve = r.status === 'SUBMITTED' && !own && may(actor, `${perm}.approve`, w.pid, w.sid); let taskId = null; if (approve && r.workflow_instance_id) taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === r.workflow_instance_id)?.id ?? null; return { approve, taskId }; },
    next(actor, p = {}) { return number(actor.companyId, actor.user, numberKey ?? docType, table, prefix, p); },
    remove(actor, id) { const r = flow.row(actor, id, `${perm}.delete`); if (r.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare(`UPDATE ${table} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?`).run(nowIso(), actor.user, r.id); audit(actor, table, r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = flow.row(actor, id, `${perm}.submit`); if (!EDITABLE.includes(r.status)) throw unprocessable(`Only a draft or a returned ${label} is sent for approval.`); beforeSubmit(actor, r);
      return transaction(db, () => { const w = at(r); const context = { projectId: w.pid ?? undefined, siteId: w.sid ?? undefined, ...ctx(r) };
        if (r.status === 'RETURNED' && r.workflow_instance_id && !db.prepare("SELECT 1 FROM wf_instances WHERE id = ? AND status IN ('APPROVED', 'REJECTED')").get(r.workflow_instance_id)) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context });
        else { const inst = workflowOf(db).submit(actor, { docType, docId: String(r.id), comment: `${r.doc_no ?? r.code ?? r.id} ${title(r)}`.slice(0, 300), context }); db.prepare(`UPDATE ${table} SET workflow_instance_id = ? WHERE id = ?`).run(inst.id, r.id); }
        db.prepare(`UPDATE ${table} SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, actor.user, nowIso(), r.id); audit(actor, table, r.id, 'submit', r.company_id); return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.id); });
    },
    withdraw(actor, id, { reason }) { const r = flow.row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable(`Only a ${label} waiting for approval is withdrawn.`); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.id); },
    cancel(actor, id, { reason }) { const r = flow.row(actor, id, `${perm}.cancel`); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable(`An approved ${label} is amended, not cancelled.`); const w0 = at(r); if (!same(r.requested_by, actor.user) && !may(actor, `${perm}.approve`, w0.pid, w0.sid)) throw forbidden(`Only the person who made this ${label}, or an approver, cancels it.`); return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare(`UPDATE ${table} SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(reason, actor.user, nowIso(), r.id); audit(actor, table, r.id, 'cancel', r.company_id, { reason }); onOutcome(actor, db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.id), 'CANCELLED', reason); return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.id); }); },
    history(actor, id) { const r = flow.row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all(table, String(r.id)) }; },
    /** The outcome of the workflow: approved (the part's own follow-up runs), or returned, rejected, withdrawn or closed. */
    decide(instance, actor, outcome, comment) {
      const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') { db.prepare(`UPDATE ${table} SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, now, actor.user, now, r.id); audit(actor, table, r.id, 'approve', r.company_id); const f = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.id); onApproved(actor, f, comment); const w = at(f); notify(r.company_id, notifyCode, [`user:${r.requested_by}`], r.doc_no ?? r.code, 'approved', `${r.doc_no ?? r.code} is approved.`, `${route}${r.id}`, r.id, { projectId: w.pid ?? undefined }); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare(`UPDATE ${table} SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, table, r.id, outcome.toLowerCase(), r.company_id, { reason: comment }); onOutcome(actor, db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.id), to, comment); const w = at(r);
      notify(r.company_id, notifyCode, [`user:${r.requested_by}`], r.doc_no ?? r.code, outcome.toLowerCase(), `${r.doc_no ?? r.code} is ${outcome === 'RETURNED' ? 'returned to you for correction' : outcome === 'REJECTED' ? 'rejected' : 'closed'}${comment ? `: ${comment}` : ''}.`, `${route}${r.id}`, r.id, { projectId: w.pid ?? undefined });
    },
  };
  return flow;
}
