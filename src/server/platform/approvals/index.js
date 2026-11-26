import { inTransaction, transaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../http/errors.js';
import { sodOf } from '../sod/index.js';
import { legacyAdapterOf } from '../workflow/legacy.js';

/**
 * A thin stand-in for the workflow engine of part 04.01, so approval-controlled configuration changes cannot be made
 * without approval today (defect D-022). A request carries a chain of role codes; each step needs someone holding that
 * role; nobody may approve their own request or two steps of one request; a rejection or a return needs a comment;
 * the change is applied, in the same transaction as the final approval, by the handler registered for the request type.
 * Not here (04.01): delegation, SLA reminders and escalation, parallel steps, configurable chains.
 */
export function createApprovalEngine({ db, handlers }) {
  const loadRequest = (id, companyId) => {
    const r = db.prepare('SELECT * FROM core_change_requests WHERE id = ? AND is_active = 1').get(id);
    if (!r || r.company_id !== companyId) throw notFound('That request does not exist.');
    return r;
  };
  const present = (r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    status: r.status,
    reason: r.reason,
    payload: JSON.parse(r.payload_json),
    chain: JSON.parse(r.chain_json),
    currentStep: r.current_step,
    requestedBy: r.requested_by,
    requestedAt: r.created_at,
    version: r.version,
    targetType: r.target_type,
    targetId: r.target_id,
  });
  const stepsOf = (id) =>
    db
      .prepare('SELECT step_no, role_code, decision, decided_by, decided_at, comment FROM core_change_request_steps WHERE request_id = ? ORDER BY id')
      .all(id)
      .map((s) => ({ stepNo: s.step_no, role: s.role_code, decision: s.decision, decidedBy: s.decided_by, decidedAt: s.decided_at, comment: s.comment }));

  return {
    present,

    /** Raise a request. `chain` is the list of roles that must approve, in order. */
    submit(actor, { type, title, targetType, targetId, payload, reason, chain }) {
      if (!handlers[type]) throw new Error(`No handler for request type ${type}`);
      return inTransaction(db, () => {
        const res = db
          .prepare(
            `INSERT INTO core_change_requests (company_id, type, title, target_type, target_id, payload_json, reason, status, chain_json, current_step, requested_by, created_by, source_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 1, ?, ?, 'change_request')`,
          )
          .run(actor.companyId, type, title, targetType, targetId, JSON.stringify(payload), reason, JSON.stringify(chain), actor.user, actor.user);
        const id = Number(res.lastInsertRowid);
        // who raised it, for the segregation-of-duties rules (part 02.05)
        sodOf(db).record({ companyId: actor.companyId, actor, action: 'change_request.create', subject: { type: 'change_request', id } });
        writeAudit(db, { entity: 'core_change_requests', entityId: id, action: 'submit', newValues: { type, chain, reason }, reason, actor: actor.user });
        publishEvent(db, { type: 'core.change_request.submitted', entity: 'change_request', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { type, targetType, targetId } });
        // part 04.01: a type that has been moved onto the workflow engine starts its workflow here (the request is mirrored from it)
        const adapter = legacyAdapterOf(db);
        if (adapter?.handles(actor.companyId, type)) adapter.start(actor, { id, type, chain, companyId: actor.companyId, title });
        return presentFull(id, actor.companyId);
      });
    },

    list(actor, { type, status, limit, offset, targetType = undefined }) {
      const where = ['company_id = :c', 'is_active = 1'];
      const params = { c: actor.companyId };
      if (type) {
        where.push('type = :type');
        params.type = type;
      }
      if (targetType) {
        where.push('target_type = :targetType');
        params.targetType = targetType;
      }
      if (status) {
        where.push('status = :status');
        params.status = status;
      }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_change_requests WHERE ${where.join(' AND ')}`).get(params).n;
      const rows = db.prepare(`SELECT * FROM core_change_requests WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all({ ...params, limit, offset });
      return { rows: rows.map((r) => ({ ...present(r), steps: stepsOf(r.id) })), total };
    },

    get(actor, id) {
      return presentFull(id, actor.companyId);
    },

    /** How many open requests wait for this person's decision at their current step (the bell and the launchpad of part 03.05). */
    awaitingCount(actor) {
      return this.awaiting(actor).length;
    },

    /** The open requests that wait for this person's decision at their current step, oldest first (the approvals widgets of part 03.07). */
    awaiting(actor) {
      const open = db.prepare("SELECT id, type, title, target_type, target_id, chain_json, current_step, requested_by, created_at FROM core_change_requests WHERE company_id = ? AND status = 'SUBMITTED' AND is_active = 1 ORDER BY id").all(actor.companyId);
      return open.filter((r) => {
        if (r.requested_by === actor.user) return false;
        const role = JSON.parse(r.chain_json)[r.current_step - 1] ?? '';
        return role.startsWith('@') ? actor.user === role.slice(1) : role.split('|').some((x) => (actor.roles ?? []).includes(x));
      }).map((r) => ({ id: r.id, type: r.type, title: r.title, targetType: r.target_type, targetId: r.target_id, requestedBy: r.requested_by, createdAt: r.created_at, step: r.current_step }));
    },

    /** Approve, reject or return the request at its current step. */
    act(actor, id, { action, comment, version }) {
      // a refusal on segregation-of-duties grounds is kept as a record even though the decision is rolled back
      return sodOf(db).attempt(() => transaction(db, () => {
        const r = loadRequest(id, actor.companyId);
        handlers[r.type]?.authorize?.(db, actor, r);
        if (r.status !== 'SUBMITTED') throw unprocessable(`This request is ${r.status.toLowerCase()}, so it can no longer be decided.`);
        if (version !== undefined && version !== r.version) throw conflict('This request was changed by someone else. Refresh it and decide again.');
        const chain = JSON.parse(r.chain_json);
        const role = chain[r.current_step - 1];
        const adapter = legacyAdapterOf(db);
        const adapted = Boolean(adapter?.handles(r.company_id, r.type));
        let moved = null;
        if (adapted) {
          // part 04.01: the workflow engine decides who may act and how the request moves; the segregation-of-duties rules of the action still apply
          if (action === 'approve') sodOf(db).guardAction({ companyId: r.company_id, actor, action: 'change_request.approve', subject: { type: 'change_request', id } });
          moved = adapter.decide(actor, r, { action, comment });
        } else {
          // a step written 'ITADM|DIR' is decided by either role
          if (role.startsWith('@') ? actor.user !== role.slice(1) : !role.split('|').some((x) => actor.roles.includes(x))) throw forbidden(role.startsWith('@') ? `Step ${r.current_step} of this request is for ${role.slice(1)} (the requester's manager). You are not that person.` : `Step ${r.current_step} of this request needs the ${role.replace('|', ' or ')} role. Your roles do not include it.`);
          if (action === 'approve') sodOf(db).guardAction({ companyId: r.company_id, actor, action: 'change_request.approve', subject: { type: 'change_request', id } });
          if (actor.user === r.requested_by) throw new HttpError(403, 'SEGREGATION_OF_DUTIES', 'You raised this request, so someone else must approve it.');
          // only the approvals of this round count: a return sends the request back to step 1, and the earlier round's decisions no longer stand
          const decided = db.prepare("SELECT decided_by FROM core_change_request_steps WHERE request_id = ? AND decision = 'APPROVED' AND id > COALESCE((SELECT MAX(id) FROM core_change_request_steps WHERE request_id = ? AND decision = 'RETURNED'), 0)").all(id, id).map((s) => s.decided_by);
          if (decided.includes(actor.user)) throw new HttpError(403, 'SEGREGATION_OF_DUTIES', 'You already approved an earlier step of this request; a different person must approve this step.');
          if (action !== 'approve' && (!comment || comment.trim().length < 5)) throw badRequest('Give a comment of at least 5 characters when you reject or return a request.', [{ field: 'comment', message: 'is required' }]);
        }

        const decision = { approve: 'APPROVED', reject: 'REJECTED', return: 'RETURNED' }[action];
        const now = new Date().toISOString();
        db.prepare('INSERT INTO core_change_request_steps (request_id, step_no, role_code, decision, decided_by, decided_at, comment) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, r.current_step, role, decision, actor.user, now, comment ?? null);

        if (action === 'approve') sodOf(db).record({ companyId: r.company_id, actor, action: 'change_request.approve', subject: { type: 'change_request', id } });
        let status = 'SUBMITTED';
        let step = r.current_step;
        if (moved) ({ status, step } = moved);
        else if (decision === 'REJECTED') status = 'REJECTED';
        else if (decision === 'RETURNED') status = 'RETURNED';
        else if (r.current_step === chain.length) status = 'APPROVED';
        else step += 1;

        db.prepare('UPDATE core_change_requests SET status = ?, current_step = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, step, actor.user, now, id);
        if (status === 'APPROVED') handlers[r.type].apply(db, { ...present({ ...r, status }), companyId: r.company_id }, actor); // throws => the whole decision rolls back
        // a type may also react to a rejection or a return (part 03.04: the record it governs is cancelled or reopened), in the same transaction
        else if ((status === 'REJECTED' || status === 'RETURNED') && handlers[r.type].decided) handlers[r.type].decided(db, { ...present({ ...r, status }), companyId: r.company_id }, status, comment ?? null, actor);
        writeAudit(db, { entity: 'core_change_requests', entityId: id, action: decision.toLowerCase(), newValues: { step: r.current_step, role, status }, reason: comment ?? null, actor: actor.user });
        publishEvent(db, { type: `core.change_request.${status === 'APPROVED' ? 'approved' : decision === 'APPROVED' ? 'advanced' : decision.toLowerCase()}`, entity: 'change_request', entityId: id, actorId: actor.user, companyId: r.company_id, data: { type: r.type, status, step: r.current_step } });
        return presentFull(id, actor.companyId);
      }));
    },

    /** The requester takes a returned request back, with a revised reason, to start the chain again. */
    resubmit(actor, id, { reason }) {
      return transaction(db, () => {
        const r = loadRequest(id, actor.companyId);
        handlers[r.type]?.authorize?.(db, actor, r);
        if (r.requested_by !== actor.user) throw forbidden('Only the person who raised a request can resubmit it.');
        if (r.status !== 'RETURNED') throw unprocessable('Only a returned request can be resubmitted.');
        db.prepare("UPDATE core_change_requests SET status = 'SUBMITTED', current_step = 1, reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, new Date().toISOString(), id);
        const adapter = legacyAdapterOf(db);
        if (adapter?.handles(r.company_id, r.type)) adapter.resubmit(actor, r);
        writeAudit(db, { entity: 'core_change_requests', entityId: id, action: 'resubmit', reason, actor: actor.user });
        return presentFull(id, actor.companyId);
      });
    },

    /** The requester withdraws a request that is still open. */
    withdraw(actor, id) {
      return inTransaction(db, () => {
        const r = loadRequest(id, actor.companyId);
        if (r.requested_by !== actor.user) throw forbidden('Only the person who raised a request can withdraw it.');
        if (!['SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable(`This request is ${r.status.toLowerCase()} and cannot be withdrawn.`);
        db.prepare("UPDATE core_change_requests SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, new Date().toISOString(), id);
        legacyAdapterOf(db)?.withdraw(actor, r);
        writeAudit(db, { entity: 'core_change_requests', entityId: id, action: 'withdraw', actor: actor.user });
        return presentFull(id, actor.companyId);
      });
    },

    /**
     * Hand the open requests raised by one person to another (a person is being deactivated, part 02.03). The successor must not have
     * decided a step of the request, or the segregation of duties would be broken. Returns how many requests moved. Runs inside the
     * caller's transaction.
     */
    reassignRequester(actor, { from, to, reason }) {
      const open = db.prepare("SELECT id, company_id, type FROM core_change_requests WHERE company_id = ? AND requested_by = ? AND status IN ('SUBMITTED', 'RETURNED') AND is_active = 1").all(actor.companyId, from);
      for (const { id } of open) {
        const touched = db.prepare('SELECT 1 FROM core_change_request_steps WHERE request_id = ? AND decided_by = ? AND decision = ?').get(id, to, 'APPROVED');
        if (touched) throw unprocessable(`Request ${id} already has a step approved by ${to}, so ${to} cannot take it over. Choose another person to take over.`);
      }
      for (const { id, company_id, type } of open) {
        legacyAdapterOf(db)?.reassign({ id, company_id, type }, to);
        db.prepare('UPDATE core_change_requests SET requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, actor.user, new Date().toISOString(), id);
        writeAudit(db, { entity: 'core_change_requests', entityId: id, action: 'reassign_requester', oldValues: { requestedBy: from }, newValues: { requestedBy: to }, reason, actor: actor.user });
      }
      return open.length;
    },

    /** Every request still waiting (submitted or returned) in a company, with the role its current step needs. */
    openRequests(companyId) {
      return db.prepare("SELECT * FROM core_change_requests WHERE company_id = ? AND status IN ('SUBMITTED', 'RETURNED') AND is_active = 1 ORDER BY id").all(companyId).map((r) => ({
        id: r.id, type: r.type, title: r.title, status: r.status, requestedBy: r.requested_by, targetType: r.target_type, targetId: r.target_id, stepRole: r.status === 'SUBMITTED' ? JSON.parse(r.chain_json)[r.current_step - 1] : null,
      }));
    },

    /** Is there an open request of this type for the same target? (A second one would be a conflict.) */
    hasOpen(companyId, type, targetType, targetId) {
      return Boolean(db.prepare("SELECT 1 FROM core_change_requests WHERE company_id = ? AND type = ? AND target_type = ? AND target_id = ? AND status IN ('SUBMITTED', 'RETURNED') AND is_active = 1").get(companyId, type, targetType, targetId));
    },
  };

  function presentFull(id, companyId) {
    const r = loadRequest(id, companyId);
    return { ...present(r), steps: stepsOf(id) };
  }
}
