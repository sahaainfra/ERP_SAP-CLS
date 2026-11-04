import { createHash, randomBytes } from 'node:crypto';
import { inTransaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, unprocessable } from '../../platform/http/errors.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { formatINR, toUnits } from '../../../shared/money.js';
import { CONFIG_DOC } from './changes.js';

// The approval inbox (part 04.03): my pending tasks across every module with the time left, the document at a glance and the evidence before the decision, approving
// in bulk where the policy of the document type allows, approving from a secure link, and the documents I raised or follow. Nothing here decides for anyone: the
// decision is always the approver's own act, taken through the workflow engine (the same checks as at the Workflow Instance page).
const iso = () => new Date().toISOString();
const day = () => iso().slice(0, 10);
const SELF = 'SELF';
const LARGE = 1_000_000; // rupees: a document this large is always flagged
export const DEFAULT_POLICIES = [
  { docType: 'ENG_SAMPLE_DOC', bulk: true, bulkMax: 50_000, link: true, reauth: 25_000, expiry: 60 },
  { docType: 'PR', bulk: true, bulkMax: 50_000, link: true, reauth: 25_000, expiry: 60 },
  { docType: 'ATT', bulk: true, bulkMax: null, link: true, reauth: null, expiry: 120 },
  { docType: 'LEAVE', bulk: false, bulkMax: null, link: true, reauth: null, expiry: 120 },
  { docType: 'EXP', bulk: false, bulkMax: null, link: true, reauth: 25_000, expiry: 60 },
];
const hash = (token) => createHash('sha256').update(token).digest('hex');

/** The risk flags a document carries in the facts it was submitted with (FR-03). */
export function riskFlags(context = {}) {
  const flags = [];
  const yes = (v) => v === true || v === 'true' || v === 1 || v === 'yes';
  if (yes(context.singleSource)) flags.push({ code: 'single_source', label: 'Single-source purchase', severity: 'high' });
  if (yes(context.emergency)) flags.push({ code: 'emergency', label: 'Emergency purchase', severity: 'high' });
  if (yes(context.nonL1)) flags.push({ code: 'non_l1', label: 'Not the lowest quotation', severity: 'high' });
  if (Number(context.amount) >= LARGE) flags.push({ code: 'large', label: 'Large amount', severity: 'medium' });
  return flags;
}

export function createInboxService({ db, engine, limits, matrixOptions }) {
  const authz = authzOf(db);
  const seeded = new Set();
  const nowMs = () => engine.clock().getTime();
  const amountOf = (inst) => { const a = Number(inst.context.amount); return Number.isFinite(a) ? a : null; };

  // ---------------------------------------------------------------- policies (bulk and link approval by document type)
  const policyRow = (companyId, docType, date = day()) => db.prepare(`SELECT * FROM wf_approval_policies WHERE company_id = ? AND doc_type = ? AND status IN ('ACTIVE', 'RETIRED') AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY effective_from DESC, id DESC LIMIT 1`).get(companyId, docType, date, date);
  function ensureDefaults(companyId) {
    if (seeded.has(companyId)) return;
    if (!db.prepare('SELECT 1 FROM wf_approval_policies WHERE company_id = ? LIMIT 1').get(companyId)) {
      for (const p of DEFAULT_POLICIES) db.prepare("INSERT INTO wf_approval_policies (company_id, doc_type, bulk_eligible, bulk_max_amount, link_eligible, link_reauth_amount, link_expiry_minutes, status, effective_from, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', '2000-01-01', 'system', 'default_policy')")
        .run(companyId, p.docType, p.bulk ? 1 : 0, p.bulkMax == null ? null : p.bulkMax * 100, p.link ? 1 : 0, p.reauth == null ? null : p.reauth * 100, p.expiry);
    }
    if (!db.isTransaction) seeded.add(companyId); // inside a transaction the rows may still be rolled back
  }
  const policyOf = (companyId, docType) => {
    ensureDefaults(companyId);
    const r = policyRow(companyId, docType);
    return r ? { bulkEligible: r.bulk_eligible === 1, bulkMax: r.bulk_max_amount, linkEligible: r.link_eligible === 1, linkReauth: r.link_reauth_amount, linkExpiry: r.link_expiry_minutes } : { bulkEligible: false, bulkMax: null, linkEligible: false, linkReauth: null, linkExpiry: 60 };
  };

  // ---------------------------------------------------------------- the inbox
  /** Where a task stands against its time (FR-01): on track, due soon (past the reminder point), overdue, or escalated. */
  function slaStatus(t, now = nowMs()) {
    if (t.escalatedAt) return 'ESCALATED';
    if (t.dueAt && now >= Date.parse(t.dueAt)) return 'OVERDUE';
    if ((t.remindAt && now >= Date.parse(t.remindAt)) || t.remindedAt) return 'DUE_SOON';
    return 'ON_TRACK';
  }
  const slaRank = { ESCALATED: 0, OVERDUE: 0, DUE_SOON: 1, ON_TRACK: 2 };
  const projectNames = (ids) => {
    const out = new Map();
    for (const id of new Set(ids.filter(Boolean))) { const p = db.prepare('SELECT id, code, name FROM org_projects WHERE id = ?').get(id); if (p) out.set(id, p); }
    return out;
  };

  function bulkCheck(actor, detail) {
    const { task, instance, step } = detail;
    const policy = policyOf(instance.companyId, instance.docType);
    const flags = riskFlags(instance.context);
    const amount = amountOf(instance);
    if (!detail.canAct) return { eligible: false, reason: detail.whyNot ?? 'You cannot decide this task.' };
    if (!policy.bulkEligible) return { eligible: false, reason: 'Documents of this type are not approved in bulk; open it and decide it on its own.' };
    if (flags.length) return { eligible: false, reason: `It carries risk flags (${flags.map((f) => f.label.toLowerCase()).join(', ')}), so it must be decided on its own.` };
    if (policy.bulkMax != null && amount != null && amount * 100 > policy.bulkMax) return { eligible: false, reason: `Its amount, ${formatINR(amount)}, is above the bulk limit of ${formatINR(policy.bulkMax / 100)}.` };
    if (step?.requireAttachment || step?.checklist?.length) return { eligible: false, reason: 'This step needs a file or a checklist, so it must be decided on its own.' };
    if (task.clarification === 'ASKED') return { eligible: false, reason: 'A question on it is waiting for an answer.' };
    return { eligible: true, reason: null };
  }

  function row(actor, t, projects, now) {
    const i = t.instance;
    const sla = slaStatus(t, now);
    const policy = policyOf(i.companyId, i.docType);
    const flags = riskFlags(i.context);
    const amount = amountOf(i);
    const bulk = bulkCheck(actor, { task: t, instance: i, step: engine.stepOf(i.id, t.step), canAct: t.canAct, whyNot: t.whyNot });
    const p = projects.get(i.projectId);
    return {
      taskId: t.id, instanceId: i.id, docType: i.docType, docLabel: i.docLabel, docRef: i.docRef, title: i.title, route: i.route, step: t.step,
      project: p ? { id: p.id, code: p.code, name: p.name } : null, amount, submittedBy: i.submittedBy, submittedAt: i.submittedAt, ageHours: Math.max(0, Math.round(((now - Date.parse(t.createdAt ?? i.submittedAt)) / 3_600_000) * 10) / 10),
      dueAt: t.dueAt, sla, onBehalfOf: t.delegatedFrom ?? null, escalation: t.escalationOf != null, flags, canAct: t.canAct, whyNot: t.whyNot ?? null,
      bulkEligible: bulk.eligible, bulkReason: bulk.reason, linkEligible: policy.linkEligible, clarification: t.clarification,
    };
  }

  /** @param {any} actor @param {any} [o] */
  function inbox(actor, { docType, projectId, sla, q, bulk, sort = 'urgency', limit = 25, offset = 0 } = {}) {
    const now = nowMs();
    const all = engine.listTasks(actor, { mine: 'assigned', limit: 2000 }).rows;
    const projects = projectNames(all.map((t) => t.instance.projectId));
    let rows = all.map((t) => row(actor, t, projects, now));
    const counts = { pending: rows.length, overdue: rows.filter((r) => r.sla === 'OVERDUE' || r.sla === 'ESCALATED').length, dueSoon: rows.filter((r) => r.sla === 'DUE_SOON').length, bulkEligible: rows.filter((r) => r.bulkEligible).length, delegated: rows.filter((r) => r.onBehalfOf).length };
    const docTypes = [...new Map(rows.map((r) => [r.docType, r.docLabel])).entries()].map(([k, v]) => ({ docType: k, label: v }));
    const projectList = [...projects.values()].map((p) => ({ id: p.id, code: p.code, name: p.name }));
    if (docType) rows = rows.filter((r) => r.docType === docType);
    if (projectId) rows = rows.filter((r) => r.project?.id === projectId);
    if (sla) rows = rows.filter((r) => (sla === 'OVERDUE' ? ['OVERDUE', 'ESCALATED'].includes(r.sla) : r.sla === sla));
    if (bulk) rows = rows.filter((r) => r.bulkEligible);
    if (q) { const needle = q.toLowerCase(); rows = rows.filter((r) => [r.docRef, r.title, r.submittedBy, r.docLabel].some((x) => String(x ?? '').toLowerCase().includes(needle))); }
    const by = {
      urgency: (a, b) => slaRank[a.sla] - slaRank[b.sla] || String(a.dueAt).localeCompare(String(b.dueAt)),
      age: (a, b) => b.ageHours - a.ageHours,
      amount: (a, b) => (b.amount ?? -1) - (a.amount ?? -1),
    }[sort] ?? (() => 0);
    rows.sort(by);
    return { rows: rows.slice(offset, offset + limit), total: rows.length, counts, docTypes, projects: projectList };
  }

  function counts(actor) {
    const { counts: c } = inbox(actor, { limit: 1 });
    const submitted = engine.listTasks(actor, { mine: 'started', limit: 1000 }).rows;
    const watching = engine.listTasks(actor, { mine: 'watching', limit: 1 }).total;
    return { ...c, submitted: submitted.filter((s) => s.status === 'RUNNING').length, returned: submitted.filter((s) => s.status === 'RETURNED').length, watching };
  }

  /** The documents I raised, and the ones I follow, with where each one stands (FR-07). */
  /** @param {any} actor @param {any} [o] */
  function submissions(actor, { kind = 'submitted', status, q, limit = 25, offset = 0 } = {}) {
    const r = engine.listTasks(actor, { mine: kind === 'watching' ? 'watching' : 'started', limit: 1000 });
    let rows = r.rows.map((i) => ({
      instanceId: i.id, docType: i.docType, docLabel: i.docLabel, docRef: i.docRef, title: i.title, route: i.route, status: i.status, step: i.currentStep, submittedBy: i.submittedBy, submittedAt: i.submittedAt, completedAt: i.completedAt, cycle: i.cycle,
      amount: amountOf(i), waitingFor: i.tasks.filter((t) => t.status === 'OPEN' || t.status === 'ADMIN_QUEUE').map((t) => t.assigneeUser ?? t.assigneeRole ?? 'an administrator'), needsAdmin: i.needsAdmin,
    }));
    if (status) rows = rows.filter((x) => x.status === status);
    if (q) { const needle = q.toLowerCase(); rows = rows.filter((x) => [x.docRef, x.title, x.docLabel].some((s) => String(s ?? '').toLowerCase().includes(needle))); }
    return { rows: rows.slice(offset, offset + limit), total: rows.length, kind };
  }

  // ---------------------------------------------------------------- the drawer and the evidence panel
  function standardSections(actor, detail) {
    const { instance: inst, task } = detail;
    const out = [];
    const amount = amountOf(inst);
    const roles = String(task.assigneeRole ?? '').split('|').filter(Boolean);
    const sections = [];
    const own = (task.assigneeRole ? roles : (actor.roles ?? [])).map((r) => ({ role: r, limit: limits.limitFor({ companyId: inst.companyId, role: r, docType: inst.docType }), has: limits.hasAuthority({ companyId: inst.companyId, role: r, docType: inst.docType }) })).filter((l) => l.has);
    if (own.length) {
      const l = own[0];
      sections.push({ code: 'authority', title: 'Your authority', kind: 'metrics', items: [
        { label: `Limit of ${l.role} for ${inst.docLabel}`, value: l.limit == null ? 'No limit' : l.limit / 100, format: l.limit == null ? 'text' : 'inr' },
        ...(amount != null ? [{ label: 'This document', value: amount, format: 'inr', tone: l.limit != null && amount * 100 > l.limit ? 'error' : 'success', note: l.limit != null && amount * 100 > l.limit ? 'Above the limit of the role.' : 'Within the limit.' }] : []),
      ] });
    }
    const dueMs = task.dueAt ? Date.parse(task.dueAt) : null;
    sections.push({ code: 'time', title: 'Time', kind: 'metrics', items: [
      { label: 'Due', value: task.dueAt, format: 'datetime', tone: slaStatus(task) === 'ON_TRACK' ? 'success' : slaStatus(task) === 'DUE_SOON' ? 'warning' : 'error' },
      ...(dueMs ? [{ label: dueMs > nowMs() ? 'Time left' : 'Overdue by', value: `${Math.abs(Math.round((dueMs - nowMs()) / 360_000) / 10)} h`, format: 'text' }] : []),
      ...(task.escalationOf != null ? [{ label: 'Escalated', value: 'This task was added because the one before it passed its time.', format: 'text' }] : []),
    ] });
    const history = db.prepare("SELECT event, actor, step_code, comment, at FROM wf_history WHERE instance_id = ? AND event IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'RETURNED_TO_STEP', 'CLARIFICATION_ASKED', 'CLARIFICATION_ANSWERED', 'DELEGATED', 'RESUBMITTED', 'ESCALATED') ORDER BY id DESC LIMIT 10").all(inst.id);
    sections.push({ code: 'history', title: 'Decisions on this document so far', kind: 'table', columns: [{ key: 'at', label: 'When', format: 'datetime' }, { key: 'event', label: 'What' }, { key: 'actor', label: 'Who' }, { key: 'step', label: 'Step' }, { key: 'comment', label: 'Comment' }], rows: history.map((h) => ({ at: h.at, event: h.event.replace(/_/g, ' ').toLowerCase(), actor: h.actor, step: h.step_code, comment: h.comment })), empty: 'Nobody has acted on it yet.' });
    const similar = db.prepare("SELECT id, doc_ref, status, completed_at, context_json FROM wf_instances WHERE company_id = ? AND doc_type = ? AND id != ? AND lower(title) = lower(?) AND status IN ('APPROVED', 'REJECTED') AND is_active = 1 AND project_id IS ? ORDER BY id DESC LIMIT 5").all(inst.companyId, inst.docType, inst.id, inst.title ?? '', inst.projectId ?? null); // the decisions of the same project, which the approver of this task may know
    sections.push({ code: 'similar', title: 'Earlier decisions on similar items', kind: 'table', columns: [{ key: 'ref', label: 'Document' }, { key: 'status', label: 'Decision' }, { key: 'amount', label: 'Amount', format: 'inr' }, { key: 'at', label: 'Decided', format: 'datetime' }], rows: similar.map((s) => ({ ref: s.doc_ref, status: s.status.toLowerCase(), amount: Number(JSON.parse(s.context_json).amount) || null, at: s.completed_at })), empty: 'No earlier document with this title was decided.' });
    if (task.delegatedFrom) sections.push({ code: 'delegation', title: 'Delegation', kind: 'list', items: [{ label: 'On behalf of', detail: `${task.delegatedFrom} delegated this to ${task.assigneeUser ?? 'you'}.` }] });
    out.push(...sections);
    return out;
  }

  async function evidenceFor(actor, taskId) {
    const detail = engine.taskDetail(actor, taskId);
    const inst = detail.instance;
    const document = (() => { try { return workflowTypes.get(inst.docType)?.describe(db, inst.companyId, inst.docId) ?? null; } catch { return null; } })();
    const summary = (() => { try { return workflowTypes.get(inst.docType)?.summarise(db, actor, inst.docId) ?? null; } catch { return null; } })();
    const sections = standardSections(actor, detail);
    const flags = riskFlags(inst.context);
    const unavailable = [];
    for (const fn of evidenceProviders.of(inst.docType)) {
      try {
        const r = await fn({ db, actor, instance: inst, task: detail.task, document });
        for (const s of r?.sections ?? []) sections.push(maskSection(actor, s));
        for (const f of r?.flags ?? []) if (!flags.some((x) => x.code === f.code)) flags.push(f);
      } catch (err) {
        unavailable.push({ message: `Some evidence for ${inst.docLabel} could not be read now.`, detail: err instanceof HttpError ? err.message : null });
      }
    }
    const bulk = bulkCheck(actor, detail);
    const policy = policyOf(inst.companyId, inst.docType);
    return {
      computedAt: iso(), task: detail.task, instance: inst, step: detail.step, canAct: detail.canAct, whyNot: detail.whyNot, mine: detail.mine,
      summary, sections, flags, unavailable, hasProviders: evidenceProviders.hasFor(inst.docType),
      emptyMessage: evidenceProviders.hasFor(inst.docType) ? null : `The module that owns ${inst.docLabel} has not added its own evidence (budget, commitments, rates, stock) yet. What is shown is what the approval itself knows.`,
      bulk: { eligible: bulk.eligible, reason: bulk.reason }, link: { eligible: policy.linkEligible, reauthAbove: policy.linkReauth == null ? null : policy.linkReauth / 100, expiryMinutes: policy.linkExpiry },
    };
  }
  /** A value flagged as masked is shown, partly shown or hidden by the field masks of the permission engine. */
  function maskSection(actor, s) {
    const hide = (item) => {
      if (!item?.mask) return item;
      const rule = authz.maskRule(actor, item.mask[0], item.mask[1]);
      if (rule === 'show') return item;
      return { ...item, value: rule === 'hide' ? null : '•••', masked: true };
    };
    return { ...s, items: s.items?.map(hide), rows: s.rows?.map((r) => (r.__mask ? hide({ ...r, mask: r.__mask }) : r)) };
  }

  // ---------------------------------------------------------------- bulk approval
  function bulkAct(actor, { taskIds, action = 'approve', comment }) {
    if (action !== 'approve') throw badRequest('Only approval can be done in bulk; reject, return and questions are decided one document at a time.', [{ field: 'action', message: 'must be approve' }]);
    const results = [];
    for (const id of taskIds) {
      let detail;
      try { detail = engine.taskDetail(actor, id); } catch (e) { results.push({ taskId: id, ok: false, reason: e instanceof HttpError ? e.message : 'This task could not be read.' }); continue; }
      const check = bulkCheck(actor, detail);
      if (!check.eligible) { results.push({ taskId: id, ok: false, reason: check.reason, docRef: detail.instance.docRef }); continue; }
      try {
        engine.act(actor, id, { action: 'approve', comment: comment || undefined, version: detail.task.version });
        results.push({ taskId: id, ok: true, docRef: detail.instance.docRef });
      } catch (e) { results.push({ taskId: id, ok: false, reason: e instanceof HttpError ? e.message : 'It could not be approved.', docRef: detail.instance.docRef }); }
    }
    const done = results.filter((r) => r.ok).length;
    inTransaction(db, () => {
      writeAudit(db, { entity: 'wf_tasks', entityId: 'bulk', action: 'bulk_approve', newValues: { requested: taskIds.length, approved: done, refused: taskIds.length - done, taskIds }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'workflow.bulk.approved', entity: 'workflow_task', entityId: taskIds[0], actorId: actor.user, companyId: actor.companyId, data: { requested: taskIds.length, approved: done } });
    });
    return { results, approved: done, refused: taskIds.length - done };
  }

  // ---------------------------------------------------------------- approval by secure link
  const linkRow = (token) => db.prepare('SELECT * FROM wf_link_tokens WHERE token_hash = ? AND is_active = 1').get(hash(String(token)));
  const GONE = () => new HttpError(410, 'LINK_INVALID', 'This link has expired, was already used, or is not valid. Open the approval from your inbox instead.');
  const live = (l) => {
    if (!l || l.status !== 'ISSUED') return false;
    if (Date.parse(l.expires_at) <= nowMs()) { db.prepare("UPDATE wf_link_tokens SET status = 'EXPIRED', updated_at = ?, version = version + 1 WHERE id = ? AND status = 'ISSUED'").run(iso(), l.id); return false; }
    return true;
  };

  /** A link for the approver's own task. The token is shown to them once and only its hash is kept; the notification service (04.06) will deliver links to e-mail and WhatsApp the same way. */
  function issueLink(actor, taskId, { channel = SELF } = {}) {
    return inTransaction(db, () => {
      const detail = engine.taskDetail(actor, taskId);
      const policy = policyOf(detail.instance.companyId, detail.instance.docType);
      if (!policy.linkEligible) throw unprocessable(`Documents of this type cannot be approved from a link.`);
      if (!detail.canAct) throw forbidden(detail.whyNot ?? 'You cannot decide this task, so you cannot be sent a link to it.');
      const token = randomBytes(32).toString('base64url');
      const expires = new Date(nowMs() + policy.linkExpiry * 60_000).toISOString();
      const amount = amountOf(detail.instance);
      const reauth = policy.linkReauth != null && amount != null && amount * 100 > policy.linkReauth ? 1 : 0;
      db.prepare("UPDATE wf_link_tokens SET status = 'REVOKED', updated_at = ?, version = version + 1 WHERE task_id = ? AND user_ref = ? AND status = 'ISSUED'").run(iso(), taskId, actor.user);
      const id = Number(db.prepare("INSERT INTO wf_link_tokens (company_id, task_id, instance_id, user_ref, roles_json, token_hash, channel, status, reauth_required, expires_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?, 'approval_link')")
        .run(actor.companyId, taskId, detail.instance.id, actor.user, JSON.stringify(actor.roles ?? []), hash(token), channel, reauth, expires, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'wf_link_tokens', entityId: id, action: 'issue', newValues: { taskId, channel, expiresAt: expires, reauthRequired: reauth === 1 }, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'workflow.link.issued', entity: 'workflow_link', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { taskId, channel, expiresAt: expires } });
      return { id, token, url: `/approve-link?t=${token}`, expiresAt: expires, reauthRequired: reauth === 1 };
    });
  }
  /** What the person who opens the link may see before deciding: the document at a glance, the step, the amount; no evidence. */
  function peekLink(token) {
    const l = linkRow(token);
    if (!live(l)) throw GONE();
    const inst = engine.instanceRow(l.instance_id);
    const task = db.prepare('SELECT * FROM wf_tasks WHERE id = ?').get(l.task_id);
    if (!inst || !task || task.status !== 'OPEN') throw GONE();
    const t = workflowTypes.get(inst.doc_type);
    const ctx = JSON.parse(inst.context_json);
    return { docLabel: t?.label ?? inst.doc_type, docRef: inst.doc_ref, title: inst.title, submittedBy: inst.submitted_by, step: task.step_code, amount: Number.isFinite(Number(ctx.amount)) ? Number(ctx.amount) : null, expiresAt: l.expires_at, reauthRequired: l.reauth_required === 1, user: l.user_ref, flags: riskFlags(ctx) };
  }
  /** Decide from the link. Above the threshold the person must also be signed in as themselves (`session`), which is the re-authentication (BR-03). Used once. */
  function decideLink(token, { action, comment }, session, via = 'link') {
    if (!['approve', 'reject'].includes(action)) throw badRequest('From a link you can approve or reject.', [{ field: 'action', message: 'must be approve or reject' }]);
    return inTransaction(db, () => {
      const l = linkRow(token);
      if (!live(l)) throw GONE();
      if (session && session.user !== l.user_ref) throw forbidden('This link was made for another person.');
      if (l.reauth_required === 1 && !session) throw new HttpError(401, 'REAUTH_REQUIRED', 'This amount needs you to sign in again before you decide. Sign in and open the link again.');
      const used = db.prepare("UPDATE wf_link_tokens SET status = 'USED', used_at = ?, used_action = ?, used_via = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'ISSUED' AND expires_at > ?").run(iso(), action, via, iso(), l.id, iso());
      if (used.changes !== 1) throw GONE();
      const actor = { user: l.user_ref, roles: JSON.parse(l.roles_json), companyId: l.company_id };
      const result = engine.act(actor, l.task_id, { action, comment: comment || undefined });
      writeAudit(db, { entity: 'wf_link_tokens', entityId: l.id, action: `decide_${action}`, newValues: { taskId: l.task_id, via, reauthenticated: Boolean(session) }, reason: comment ?? null, actor: l.user_ref, companyId: l.company_id });
      publishEvent(db, { type: 'workflow.link.used', entity: 'workflow_link', entityId: l.id, actorId: l.user_ref, companyId: l.company_id, data: { taskId: l.task_id, action } });
      return { status: result.status, docRef: result.docRef, action };
    });
  }

  // ---------------------------------------------------------------- policy changes (maker-checker)
  const presentPolicy = (r) => ({ id: r.id, docType: r.doc_type, bulkEligible: r.bulk_eligible === 1, bulkMaxAmount: r.bulk_max_amount == null ? null : r.bulk_max_amount / 100, linkEligible: r.link_eligible === 1, linkReauthAmount: r.link_reauth_amount == null ? null : r.link_reauth_amount / 100, linkExpiryMinutes: r.link_expiry_minutes, status: r.status, effectiveFrom: r.effective_from, batchId: r.batch_id });
  return {
    companyOfToken: (token) => linkRow(token)?.company_id ?? null,
    ensureDefaults, riskFlags, slaStatus, policyOf, bulkCheck, inbox, counts, submissions, evidenceFor, bulkAct, issueLink, peekLink, decideLink,
    listPolicies(actor) {
      ensureDefaults(actor.companyId);
      return db.prepare("SELECT * FROM wf_approval_policies WHERE company_id = ? AND is_active = 1 AND status IN ('ACTIVE', 'PENDING') ORDER BY doc_type, effective_from DESC").all(actor.companyId).map(presentPolicy);
    },
    proposePolicies(actor, { policies, effectiveFrom, reason }) {
      if (!authz.check(actor, 'eng.matrix.manage').allowed) throw forbidden('Only someone who maintains the approval matrix (eng.matrix.manage) can do this.');
      ensureDefaults(actor.companyId);
      return inTransaction(db, () => {
        if (effectiveFrom < day()) throw unprocessable('A change takes effect from today or a later date.');
        for (const t of ['wf_escalation_paths', 'wf_sla_settings', 'wf_approval_policies']) if (db.prepare(`SELECT 1 FROM ${t} WHERE company_id = ? AND status = 'PENDING'`).get(actor.companyId)) throw conflict('Another change of escalation, SLA or approval settings is waiting for approval. Ask for it to be decided first.');
        const known = new Set(matrixOptions().map((d) => d.docType));
        const ids = [];
        policies.forEach((p, i) => {
          if (!known.has(p.docType)) throw badRequest('Some settings are not valid.', [{ field: `policies.${i}.docType`, message: `${p.docType} is not a document type` }]);
          ids.push(Number(db.prepare("INSERT INTO wf_approval_policies (company_id, doc_type, bulk_eligible, bulk_max_amount, link_eligible, link_reauth_amount, link_expiry_minutes, status, effective_from, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'policy_editor')")
            .run(actor.companyId, p.docType, p.bulkEligible ? 1 : 0, p.bulkMaxAmount == null ? null : toUnits(p.bulkMaxAmount, 'money'), p.linkEligible ? 1 : 0, p.linkReauthAmount == null ? null : toUnits(p.linkReauthAmount, 'money'), p.linkExpiryMinutes, effectiveFrom, reason, actor.user).lastInsertRowid));
        });
        const batch = Math.min(...ids);
        for (const id of ids) db.prepare('UPDATE wf_approval_policies SET batch_id = ? WHERE id = ?').run(batch, id);
        const instance = engine.submit(actor, { docType: CONFIG_DOC, docId: String(batch), comment: reason, context: { owner: 'CFO', maxAmount: 0, effectiveFrom } });
        writeAudit(db, { entity: 'wf_approval_policies', entityId: batch, action: 'propose', newValues: { policies: policies.length, effectiveFrom }, reason, actor: actor.user });
        return { batchId: batch, instance };
      });
    },
  };
}
