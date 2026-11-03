import { z } from 'zod';
import { assertPermissionAnywhere, hasPermission } from '../../platform/auth/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { parse } from '../../platform/validation/index.js';
import { compareSnapshots } from '../../../shared/forms/compare.js';
import { todayIST } from '../../../shared/dates.js';

// Part 03.04: the services every record shares on the Object Page: discussion, timeline, documents checklist, related records,
// versions and their comparison, reason codes, the approvals view and print. A module registers its record type (platform/objects);
// these services then work for it.
const nowIso = () => new Date().toISOString();
const cid = (actor) => actor.companyId;

export const parseComment = (b) => parse(z.object({ body: z.string().trim().min(1, 'Write something').max(2000, 'Use at most 2000 characters') }).strict(), b);
export const parseDocumentLink = (b) => parse(z.object({ requirementCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'Use the code of a required document'), fileId: z.number().int().positive() }).strict(), b);
export const parseCompare = (q) => parse(z.object({ from: z.union([z.literal('current'), z.coerce.number().int().positive()]), to: z.union([z.literal('current'), z.coerce.number().int().positive()]) }).strict(), q);
export const parseReasonFor = (q) => parse(z.object({ for: z.enum(['cancel', 'reject', 'return', 'reverse', 'deviate', 'override']) }).strict(), q);
export const parseTypeId = (type, id) => [parse(z.string().regex(/^[a-z][a-z_]*$/), type), parse(z.coerce.number().int().positive(), id)];

/** Record a snapshot of a record (a submit). Version numbers count up per record; version 1 is the original. */
export function recordVersion(db, { companyId, type, id, snapshot, reason = null, actor, projectId = null, siteId = null }) {
  const n = db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM ui_record_versions WHERE company_id = ? AND entity_type = ? AND entity_id = ?').get(companyId, type, id).n;
  db.prepare("INSERT INTO ui_record_versions (company_id, entity_type, entity_id, version_no, snapshot_json, reason, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'record_version')")
    .run(companyId, type, id, n, JSON.stringify(snapshot), reason, projectId, siteId, actor);
  return n;
}

/** The required documents of a record's type and which are attached. A file counts once its virus scan is clean. */
export function documentChecklist(db, { companyId, type, docType, id }) {
  const reqs = db.prepare('SELECT * FROM ui_required_documents WHERE doc_type = ? AND (company_id IS NULL OR company_id = ?) AND is_active = 1 AND deleted_at IS NULL ORDER BY sort_order, code').all(docType, companyId);
  const links = db.prepare(`SELECT d.id AS link_id, d.requirement_code, d.created_by AS linked_by, f.id AS file_id, f.original_name, f.version_no, f.scan_status, f.size_bytes, f.created_at
    FROM ui_record_documents d JOIN core_files f ON f.id = d.file_id WHERE d.company_id = ? AND d.entity_type = ? AND d.entity_id = ? AND d.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY d.id`).all(companyId, type, id);
  return reqs.map((r) => {
    const files = links.filter((l) => l.requirement_code === r.code).map((l) => ({ linkId: l.link_id, fileId: l.file_id, name: l.original_name, versionNo: l.version_no, scanStatus: l.scan_status, bytes: l.size_bytes, linkedBy: l.linked_by, at: l.created_at }));
    return { code: r.code, label: r.label, description: r.description, requiredAt: r.required_at, required: r.required_at !== 'optional', files, satisfied: files.some((f) => f.scanStatus === 'CLEAN') };
  });
}

/** The required documents still missing at a step ('submit' or 'approve'): [{ code, label }]. */
export const missingDocuments = (db, { companyId, type, docType, id, stage }) =>
  documentChecklist(db, { companyId, type, docType, id }).filter((r) => (r.requiredAt === 'submit' || (stage === 'approve' && r.requiredAt === 'approve')) && !r.satisfied).map((r) => ({ code: r.code, label: r.label }));

export function createObjectService({ db, approvals }) {
  const params = { get: (key, ctx) => createParameterStore(db).get(key, ctx) }; // read afresh: a changed value applies at once (found in 03.06)
  const must = (actor, type, id) => {
    const def = objectTypes.get(type);
    if (!def) throw notFound(`There is no record type called ${type}.`);
    assertPermissionAnywhere(actor, def.permission);
    const access = def.access(db, actor, id);
    if (!access) throw notFound('That record does not exist.');
    return { def, access };
  };
  const diff = (a, b) => {
    const out = {};
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out[k] = { old: a?.[k], new: b?.[k] };
    return out;
  };

  /** The approval rounds of a record: each request raised for it, its steps, who can decide the open one and the SLA of the open step. */
  function approvalRounds(actor, def, id) {
    const hours = Number(params.get('ui.approval.sla_hours', { companyId: cid(actor), date: todayIST() }));
    const rows = db.prepare('SELECT id FROM core_change_requests WHERE company_id = ? AND target_type = ? AND target_id = ? AND is_active = 1 ORDER BY id').all(cid(actor), def.approvalTarget, id);
    return rows.map(({ id: rid }) => {
      const r = approvals.get(actor, rid);
      const steps = r.chain.map((role, i) => {
        const done = r.steps.find((s) => s.stepNo === i + 1);
        const state = done ? done.decision : r.status === 'SUBMITTED' && r.currentStep === i + 1 ? 'CURRENT' : 'WAITING';
        const holders = state === 'CURRENT' || state === 'WAITING' ? db.prepare("SELECT u.username, u.display_name FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 AND u.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN (SELECT value FROM json_each(?))) ORDER BY u.username LIMIT 8").all(cid(actor), JSON.stringify(role.split('|'))) : [];
        return { stepNo: i + 1, role, state, decidedBy: done?.decidedBy ?? null, decidedAt: done?.decidedAt ?? null, comment: done?.comment ?? null, onBehalfOf: null, approvers: holders.map((h) => ({ username: h.username, name: h.display_name })) };
      });
      const open = r.status === 'SUBMITTED';
      const last = r.steps.length ? r.steps[r.steps.length - 1].decidedAt : r.requestedAt;
      const dueAt = open ? new Date(Date.parse(last) + hours * 3_600_000).toISOString() : null;
      return { id: r.id, status: r.status, title: r.title, reason: r.reason, requestedBy: r.requestedBy, requestedAt: r.requestedAt, chain: r.chain, currentStep: r.currentStep, version: r.version, steps, sla: open ? { hours, dueAt, overdue: Date.parse(dueAt) < Date.now() } : null };
    });
  }

  return {
    approvalRounds,

    approvalsOf(actor, type, id) {
      const { def } = must(actor, type, id);
      return { rounds: approvalRounds(actor, def, id), evidence: null };
    },

    // ---- discussion ----
    comments(actor, type, id) {
      must(actor, type, id);
      return db.prepare('SELECT * FROM ui_record_comments WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY id').all(cid(actor), type, id)
        .map((c) => ({ id: c.id, author: c.author_ref, body: c.body, mentions: JSON.parse(c.mentions_json), at: c.created_at }));
    },

    addComment(actor, type, id, { body }) {
      const { def, access } = must(actor, type, id);
      const mentions = [];
      for (const m of body.matchAll(/(?:^|[^\w@])@([A-Za-z0-9._-]{2,40})/g)) {
        const u = db.prepare("SELECT id, username, display_name FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND status = 'ACTIVE' AND is_active = 1").get(cid(actor), m[1]);
        if (u && !mentions.some((x) => x.id === u.id)) mentions.push({ id: u.id, username: u.username, name: u.display_name });
      }
      return transaction(db, () => {
        const cidRow = Number(db.prepare("INSERT INTO ui_record_comments (company_id, entity_type, entity_id, body, mentions_json, author_ref, author_id, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'record_comment')")
          .run(cid(actor), type, id, body, JSON.stringify(mentions), actor.user, actor.userId ?? null, access.projectId ?? null, access.siteId ?? null, actor.user).lastInsertRowid);
        const [auditEntity] = def.auditEntities(id);
        writeAudit(db, { entity: auditEntity.entity, entityId: auditEntity.id, action: 'comment', newValues: { comment: cidRow, mentions: mentions.map((m) => m.username) }, actor: actor.user, companyId: cid(actor) });
        publishEvent(db, { type: 'ui.comment.created', entity: type, entityId: id, actorId: actor.user, companyId: cid(actor), data: { type, mentions: mentions.map((m) => m.username) } });
        return { id: cidRow, author: actor.user, body, mentions, at: nowIso() };
      });
    },

    // ---- timeline: the record's audit entries, the approval decisions and the comments in one list, newest first ----
    timeline(actor, type, id) {
      const { def } = must(actor, type, id);
      const out = [];
      for (const { entity, id: eid } of def.auditEntities(id)) {
        for (const a of db.prepare('SELECT id, action, old_values, new_values, reason, actor, created_at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all(entity, String(eid))) {
          if (a.action === 'comment') continue; // the comment itself is listed below
          const oldV = def.maskEntries ? def.maskEntries(db, actor, a.old_values ? JSON.parse(a.old_values) : null) : (a.old_values ? JSON.parse(a.old_values) : null);
          const newV = def.maskEntries ? def.maskEntries(db, actor, a.new_values ? JSON.parse(a.new_values) : null) : (a.new_values ? JSON.parse(a.new_values) : null);
          out.push({ key: `a${a.id}`, kind: 'audit', at: a.created_at, actor: a.actor, action: a.action, reason: a.reason, changes: a.action === 'create' ? diff({}, newV) : diff(oldV, newV) });
        }
      }
      for (const round of approvalRounds(actor, def, id)) {
        out.push({ key: `r${round.id}`, kind: 'approval', at: round.requestedAt, actor: round.requestedBy, action: 'sent for approval', reason: round.reason, changes: {}, detail: `Chain: ${round.chain.map((c) => c.replace('|', ' or ')).join(', then ')}` });
        for (const s of round.steps.filter((x) => x.decidedAt)) out.push({ key: `s${round.id}-${s.stepNo}`, kind: 'approval', at: s.decidedAt, actor: s.decidedBy, action: s.state.toLowerCase(), reason: s.comment, changes: {}, detail: `Step ${s.stepNo}, ${s.role.replace('|', ' or ')}` });
      }
      for (const c of this.comments(actor, type, id)) out.push({ key: `c${c.id}`, kind: 'comment', at: c.at, actor: c.author, action: 'commented', reason: c.body, changes: {}, mentions: c.mentions });
      out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
      return out.slice(0, 300);
    },

    // ---- related records ----
    related(actor, type, id) {
      const { def } = must(actor, type, id);
      const links = def.related ? def.related(db, actor, id) : [];
      const rounds = db.prepare('SELECT id, status FROM core_change_requests WHERE company_id = ? AND target_type = ? AND target_id = ? AND is_active = 1 ORDER BY id').all(cid(actor), def.approvalTarget, id);
      if (hasPermission(actor, 'core.requests.view')) for (const r of rounds) links.push({ kind: 'Approval request', label: `#${r.id}, ${r.status.toLowerCase()}`, to: '/admin/approvals', direction: 'derived' });
      return links;
    },

    // ---- documents ----
    documents(actor, type, id) {
      const { def } = must(actor, type, id);
      const requirements = documentChecklist(db, { companyId: cid(actor), type, docType: def.documentType, id });
      return { requirements, complete: requirements.filter((r) => r.required).every((r) => r.satisfied), attachmentEntity: def.attachmentEntity };
    },

    linkDocument(actor, type, id, { requirementCode, fileId }) {
      const { def, access } = must(actor, type, id);
      if (access.status === 'CANCELLED') throw unprocessable('This record is cancelled, so documents can no longer be attached to it.');
      if (!db.prepare('SELECT 1 FROM ui_required_documents WHERE doc_type = ? AND code = ? AND (company_id IS NULL OR company_id = ?) AND is_active = 1').get(def.documentType, requirementCode, cid(actor))) throw badRequest('Some fields are invalid.', [{ field: 'requirementCode', message: 'That is not a document this record needs.' }]);
      const f = db.prepare('SELECT id, original_name FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ? AND linked_id = ? AND deleted_at IS NULL').get(fileId, cid(actor), def.attachmentEntity, id);
      if (!f) throw badRequest('Some fields are invalid.', [{ field: 'fileId', message: 'That file is not attached to this record. Upload it first.' }]);
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM ui_record_documents WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND requirement_code = ? AND file_id = ? AND deleted_at IS NULL').get(cid(actor), type, id, requirementCode, fileId)) throw conflict('That file already stands for this document.');
        const linkId = Number(db.prepare("INSERT INTO ui_record_documents (company_id, entity_type, entity_id, requirement_code, file_id, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'record_document')").run(cid(actor), type, id, requirementCode, fileId, access.projectId ?? null, access.siteId ?? null, actor.user).lastInsertRowid);
        const [auditEntity] = def.auditEntities(id);
        writeAudit(db, { entity: auditEntity.entity, entityId: auditEntity.id, action: 'document_linked', newValues: { requirement: requirementCode, file: f.original_name }, actor: actor.user, companyId: cid(actor) });
        return { linkId };
      });
    },

    unlinkDocument(actor, type, id, linkId) {
      const { def, access } = must(actor, type, id);
      if (access.status === 'CANCELLED') throw unprocessable('This record is cancelled, so its documents can no longer be changed.');
      return transaction(db, () => {
        const l = db.prepare('SELECT d.*, f.original_name FROM ui_record_documents d JOIN core_files f ON f.id = d.file_id WHERE d.id = ? AND d.company_id = ? AND d.entity_type = ? AND d.entity_id = ? AND d.deleted_at IS NULL').get(linkId, cid(actor), type, id);
        if (!l) throw notFound('That document link does not exist.');
        db.prepare('UPDATE ui_record_documents SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, linkId);
        const [auditEntity] = def.auditEntities(id);
        writeAudit(db, { entity: auditEntity.entity, entityId: auditEntity.id, action: 'document_unlinked', oldValues: { requirement: l.requirement_code, file: l.original_name }, actor: actor.user, companyId: cid(actor) });
        return { removed: 1 };
      });
    },

    // ---- versions and the amendment comparison ----
    versions(actor, type, id) {
      must(actor, type, id);
      const rows = db.prepare('SELECT version_no, reason, created_by, created_at FROM ui_record_versions WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY version_no').all(cid(actor), type, id);
      return rows.map((v) => ({ versionNo: v.version_no, reason: v.reason, by: v.created_by, at: v.created_at, label: v.version_no === 1 ? 'Original' : `Amendment ${v.version_no - 1}` }));
    },

    compare(actor, type, id, { from, to }) {
      const { def } = must(actor, type, id);
      if (!def.compare) throw unprocessable('This record type has no comparison.');
      const load = (v) => {
        if (v === 'current') return def.snapshot(db, actor, id);
        const row = db.prepare('SELECT snapshot_json FROM ui_record_versions WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND version_no = ?').get(cid(actor), type, id, v);
        if (!row) throw notFound(`There is no version ${v} of this record.`);
        return JSON.parse(row.snapshot_json);
      };
      const mask = def.maskSnapshot ?? ((_db, _actor, s) => s);
      const a = mask(db, actor, load(from));
      const b = mask(db, actor, load(to));
      return { from, to, ...compareSnapshots(a, b, def.compare) };
    },

    // ---- reason codes ----
    reasonCodes(actor, forAction) {
      // part 04.04: the reason codes are one master (pcs_reason_codes); a database without it, or without codes for the action, still has the list of part 03.04
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pcs_reason_codes'").get()) {
        const rows = db.prepare('SELECT * FROM pcs_reason_codes WHERE action_type = ? AND (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL ORDER BY sort_order, code').all(forAction, cid(actor));
        const merged = new Map();
        for (const r of rows) if (r.company_id != null || !merged.has(r.code)) merged.set(r.code, r);
        const list = [...merged.values()].filter((r) => r.is_active === 1).sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
        if (list.length) return list.map((r) => ({ code: r.code, label: r.label, needsText: r.needs_text === 1, requiresEvidence: r.requires_evidence === 1 }));
      }
      return db.prepare('SELECT code, label, needs_text FROM ui_reason_codes WHERE applies_to = ? AND (company_id IS NULL OR company_id = ?) AND is_active = 1 AND deleted_at IS NULL ORDER BY sort_order, code').all(forAction, cid(actor)).map((r) => ({ code: r.code, label: r.label, needsText: r.needs_text === 1 }));
    },

    /** Check a reason code for an action and return its label; refuse an unknown code or a missing text where the code needs one. */
    checkReason(actor, forAction, { reasonCode, reason }) {
      const codes = this.reasonCodes(actor, forAction);
      const c = codes.find((x) => x.code === reasonCode);
      if (!c) throw badRequest('Some fields are invalid.', [{ field: 'reasonCode', message: `Choose a reason for this ${forAction}.` }]);
      if (!reason || reason.trim().length < 5) throw badRequest('Some fields are invalid.', [{ field: 'reason', message: c.needsText ? 'Explain the reason (at least 5 characters).' : 'Add a few words of explanation (at least 5 characters).' }]);
      return { code: c.code, label: c.label, text: reason.trim() };
    },

    // ---- print ----
    print(actor, type, id) {
      const { def } = must(actor, type, id);
      if (!def.print) throw unprocessable('This record type has no print layout yet.');
      const out = def.print(db, actor, id);
      const [auditEntity] = def.auditEntities(id);
      writeAudit(db, { entity: auditEntity.entity, entityId: auditEntity.id, action: 'print', newValues: { file: out.fileName }, actor: actor.user, companyId: cid(actor) });
      return out;
    },

  };
}
