import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { parse } from '../../platform/validation/index.js';
import { todayIST } from '../../../shared/dates.js';

// The two things an administrator decides before and while secure messaging is used (part 05.03):
//  * the open-source licence review and register (FR-01): every component, its licence and obligations; the review of the end-to-end library is approved by the IT administrator and then the director, and no
//    secure conversation can be made until it is (AC-01: the gate is in the service, not in a document);
//  * the secure messaging policy (FR-07): who may make secure conversations, limits, disappearing messages, retention of metadata; a change is an approved, dated version like the messaging settings of 05.02.
export const E2E_COMPONENT = 'erp-e2e-v1 (company code over the platform WebCrypto API)';
export const POLICY_DOC = 'SEC_POLICY';
export const REVIEW_DOC = 'OSS_LICENCE_REVIEW';
const PERMISSIVE = /^(MIT|ISC|BSD|Apache|0BSD|BlueOak|CC0|Unlicense|Python|CC-BY|WTFPL|Zlib)/i;
const COPYLEFT = /(A?GPL|LGPL|SSPL|EUPL|MPL|CDDL|EPL)/i;

export const POLICY_DEFAULTS = Object.freeze({
  enabled: false, creatorRoles: ['DIR', 'PD', 'PM', 'HRMGR', 'CFO'], maxGroupMembers: 10, maxDevicesPerUser: 5, allowAttachments: true, maxAttachmentMb: 10,
  defaultDisappearSeconds: 0, allowedDisappearSeconds: [0, 3600, 86_400, 604_800], metadataRetentionDays: 90, undeliveredRetentionDays: 14, screenshotWarning: true,
});
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const role = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'A role code such as PM');
export const parsePolicy = (b) => parse(z.object({
  enabled: z.boolean(), creatorRoles: z.array(role).max(40), maxGroupMembers: z.number().int().min(2).max(20), maxDevicesPerUser: z.number().int().min(1).max(10), allowAttachments: z.boolean(),
  maxAttachmentMb: z.number().int().min(1).max(50), defaultDisappearSeconds: z.number().int().min(0).max(31_536_000), allowedDisappearSeconds: z.array(z.number().int().min(0).max(31_536_000)).min(1).max(12),
  metadataRetentionDays: z.number().int().min(7).max(3650), undeliveredRetentionDays: z.number().int().min(1).max(90), screenshotWarning: z.boolean(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-11-04'), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500),
}).strict().refine((o) => o.allowedDisappearSeconds.includes(o.defaultDisappearSeconds), { message: 'The default must be one of the allowed times', path: ['defaultDisappearSeconds'] }), b);
export const parseRegisterEntry = (b) => parse(z.object({
  component: z.string().trim().min(2).max(120), version: z.string().trim().max(40).default(''), licence: z.string().trim().min(2).max(80), usage: z.string().trim().max(400).default(''),
  obligations: z.string().trim().max(1000).default(''), reason: z.string().trim().min(5).max(300),
}).strict(), b);
export const parseReviewSubmit = (b) => parse(z.object({ comment: z.string().trim().min(5, 'Say what the reviewer should know (at least 5 characters)').max(1000) }).strict(), b);

/** The seeded entries of the register for a company: the library that was considered and the one that is used. Their status is a decision of the review, never of this code. */
export const SEED_REGISTER = Object.freeze([
  { component: 'libsignal (Signal Protocol)', version: '', licence: 'AGPL-3.0-only', usage: 'Considered for secure messaging; not used.', obligations: 'AGPL-3.0 section 13: the complete corresponding source of the ERP would have to be offered to every user who talks to it over a network; not compatible with the ERP licence. Review decision: not adopted.', decision: 'REJECTED' },
  { component: 'Signal-Server', version: '', licence: 'AGPL-3.0-only', usage: 'Considered for the relay; not used (the sec module is the relay).', obligations: 'Same network-copyleft duty as libsignal. Review decision: not adopted.', decision: 'REJECTED' },
  { component: '@matrix-org/olm (Olm and Megolm)', version: '', licence: 'Apache-2.0', usage: 'The permitted alternative named in the licence review; not adopted because the audited platform WebCrypto API is enough for the protocol of this part.', obligations: 'Notice and NOTICE file if it is ever shipped; no source-offer duty.', decision: 'NOT_USED' },
  { component: E2E_COMPONENT, version: 'erp-e2e-v1', licence: 'Company code (ERP licence) using the WebCrypto API of the browser and of Node.js', usage: 'End-to-end encryption of secure conversations: src/shared/e2e.js. No primitive of its own: ECDSA and ECDH P-256, HKDF-SHA-256, AES-256-GCM.', obligations: 'None beyond the ERP licence. The composition (not the primitives) was designed here, so it needs an independent cryptographic review before it protects regulated data (D-276).', decision: 'APPROVED' },
]);
const ruleSet = ['ITADM', 'DIR'];

const nowIso = () => new Date().toISOString();

/** The policy in force for a company today (a future-dated change takes effect when its day comes). */
export function activePolicy(db, companyId) {
  const today = todayIST();
  for (const r of db.prepare("SELECT * FROM sec_policy WHERE company_id = ? AND status = 'SCHEDULED' AND is_active = 1 AND effective_from <= ? ORDER BY config_version").all(companyId, today)) {
    db.prepare("UPDATE sec_policy SET status = 'RETIRED', updated_at = ?, version = version + 1 WHERE company_id = ? AND status = 'ACTIVE'").run(nowIso(), companyId);
    db.prepare("UPDATE sec_policy SET status = 'ACTIVE', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), r.id);
  }
  const r = db.prepare("SELECT * FROM sec_policy WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1").get(companyId);
  return r ? { ...POLICY_DEFAULTS, ...JSON.parse(r.config_json), version: r.config_version, effectiveFrom: r.effective_from } : { ...POLICY_DEFAULTS, version: 0, effectiveFrom: null };
}
/** Has the licence review approved the end-to-end implementation? (AC-01) */
export const licenceApproved = (db, companyId) => Boolean(db.prepare("SELECT 1 FROM oss_register WHERE company_id = ? AND component = ? AND compliance_status = 'APPROVED' AND is_active = 1").get(companyId, E2E_COMPONENT));
/** Secure messaging can be used only when the policy is on and the licence review approved the library. */
export const secureReady = (db, companyId) => activePolicy(db, companyId).enabled && licenceApproved(db, companyId);

export function createGovernanceService({ db, engine, root = process.cwd() }) {
  const authz = authzOf(db);
  const may = (actor, key) => authz.check(actor, key, { companyId: actor.companyId }).allowed;
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const reg = (r) => ({ id: r.id, component: r.component, version: r.component_version, licence: r.licence, usage: r.usage, obligations: r.obligations, status: r.compliance_status, source: r.entry_source, reviewId: r.review_id, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
    copyleft: COPYLEFT.test(r.licence) && !PERMISSIVE.test(r.licence), permissive: PERMISSIVE.test(r.licence) });

  function ensureRegister(companyId) {
    for (const e of SEED_REGISTER) {
      if (db.prepare('SELECT 1 FROM oss_register WHERE company_id = ? AND component = ?').get(companyId, e.component)) continue;
      db.prepare("INSERT INTO oss_register (company_id, component, component_version, licence, usage, obligations, compliance_status, entry_source, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'TO_REVIEW', 'SEED', 'system', 'oss_register')").run(companyId, e.component, e.version, e.licence, e.usage, e.obligations);
    }
  }
  const policyRow = (r) => ({ id: r.id, version: r.config_version, status: r.status, effectiveFrom: r.effective_from, reason: r.reason, by: r.created_by, at: r.created_at, instanceId: r.instance_id, config: { ...POLICY_DEFAULTS, ...JSON.parse(r.config_json) } });
  const reviewRow = (r) => ({ id: r.id, version: r.review_version, subject: r.subject, status: r.status, by: r.created_by, at: r.created_at, instanceId: r.instance_id, decidedAt: r.decided_at, document: JSON.parse(r.document_json) });

  const policy = {
    get(actor) {
      if (!anywhere(actor, 'sec.policy.view')) throw forbidden('You may not see the secure messaging policy (permission sec.policy.view).');
      const history = db.prepare('SELECT * FROM sec_policy WHERE company_id = ? AND is_active = 1 ORDER BY config_version DESC LIMIT 50').all(actor.companyId).map(policyRow);
      return { policy: activePolicy(db, actor.companyId), pending: history.find((h) => h.status === 'PENDING') ?? null, history, canEdit: may(actor, 'sec.policy.edit'), licenceApproved: licenceApproved(db, actor.companyId), defaults: POLICY_DEFAULTS };
    },
    propose(actor, b) {
      if (!may(actor, 'sec.policy.edit')) throw forbidden('You may not change the secure messaging policy (permission sec.policy.edit).');
      if (b.effectiveFrom < todayIST()) throw badRequest('The date cannot be in the past.', [{ field: 'effectiveFrom', message: 'choose today or a later date' }]);
      ensureRegister(actor.companyId);
      if (b.enabled && !licenceApproved(db, actor.companyId)) throw unprocessable('Secure messaging cannot be switched on before the open-source licence review of the end-to-end library is approved (Open-Source Licence Register).', [{ field: 'enabled', message: 'the licence review is not approved yet' }]);
      const { reason, effectiveFrom, ...value } = b;
      const current = activePolicy(db, actor.companyId);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM sec_policy WHERE company_id = ? AND status = 'PENDING' AND is_active = 1").get(actor.companyId)) throw conflict('A change of the secure messaging policy is already waiting for approval.');
        const v = (db.prepare('SELECT MAX(config_version) AS v FROM sec_policy WHERE company_id = ?').get(actor.companyId).v ?? 0) + 1;
        const id = Number(db.prepare("INSERT INTO sec_policy (company_id, config_json, config_version, status, effective_from, reason, created_by, source_type) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, 'sec_policy')").run(actor.companyId, JSON.stringify(value), v, effectiveFrom, reason, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'sec_policy', entityId: id, action: 'propose', oldValues: current, newValues: { ...POLICY_DEFAULTS, ...value }, actor: actor.user, companyId: actor.companyId, reason });
        const instance = engine.submit(actor, { docType: POLICY_DOC, docId: id, comment: reason, context: {} });
        db.prepare('UPDATE sec_policy SET instance_id = ? WHERE id = ?').run(instance.id, id);
        return { id, version: v, workflow: instance };
      });
    },
    activate(instance, actor) {
      const r = db.prepare('SELECT * FROM sec_policy WHERE id = ?').get(Number(instance.docId));
      if (!r) return;
      const now = nowIso();
      if (r.effective_from <= todayIST()) {
        db.prepare("UPDATE sec_policy SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND status = 'ACTIVE'").run(actor.user, now, r.company_id);
        db.prepare("UPDATE sec_policy SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
      } else db.prepare("UPDATE sec_policy SET status = 'SCHEDULED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
      writeAudit(db, { entity: 'sec_policy', entityId: r.id, action: 'approve', newValues: { version: r.config_version, effectiveFrom: r.effective_from }, actor: actor.user, companyId: r.company_id });
    },
    reject(instance, actor) { db.prepare("UPDATE sec_policy SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, nowIso(), Number(instance.docId)); },
    export(actor) {
      const g = policy.get(actor);
      return { exportedAt: nowIso(), policy: g.policy, history: g.history.map((h) => ({ version: h.version, status: h.status, effectiveFrom: h.effectiveFrom, reason: h.reason, by: h.by, config: h.config })) };
    },
  };

  const register = {
    list(actor, { q, status, licence } = {}) {
      if (!anywhere(actor, 'sec.licence.view')) throw forbidden('You may not see the open-source licence register (permission sec.licence.view).');
      ensureRegister(actor.companyId);
      let rows = db.prepare('SELECT * FROM oss_register WHERE company_id = ? AND is_active = 1 ORDER BY component').all(actor.companyId).map(reg);
      if (status) rows = rows.filter((r) => r.status === status);
      if (licence === 'copyleft') rows = rows.filter((r) => r.copyleft); else if (licence === 'permissive') rows = rows.filter((r) => r.permissive);
      if (q) { const n = q.toLowerCase(); rows = rows.filter((r) => `${r.component} ${r.licence} ${r.usage}`.toLowerCase().includes(n)); }
      const all = db.prepare('SELECT compliance_status AS s, COUNT(*) AS n FROM oss_register WHERE company_id = ? AND is_active = 1 GROUP BY compliance_status').all(actor.companyId);
      const reviews = db.prepare('SELECT * FROM sec_licence_reviews WHERE company_id = ? AND is_active = 1 ORDER BY review_version DESC LIMIT 20').all(actor.companyId).map(reviewRow);
      return { rows, counts: Object.fromEntries(all.map((r) => [r.s, r.n])), reviews, pendingReview: reviews.find((r) => r.status === 'PENDING') ?? null, approved: licenceApproved(db, actor.companyId), canEdit: may(actor, 'sec.licence.edit'), e2eComponent: E2E_COMPONENT };
    },
    /** Adds or changes an entry. Its status never changes here: only an approved review changes a status. */
    upsert(actor, b) {
      if (!may(actor, 'sec.licence.edit')) throw forbidden('You may not change the open-source licence register (permission sec.licence.edit).');
      ensureRegister(actor.companyId);
      return transaction(db, () => {
        const ex = db.prepare('SELECT * FROM oss_register WHERE company_id = ? AND component = ?').get(actor.companyId, b.component);
        if (ex) {
          db.prepare('UPDATE oss_register SET component_version = ?, licence = ?, usage = ?, obligations = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.version, b.licence, b.usage, b.obligations, actor.user, nowIso(), ex.id);
          writeAudit(db, { entity: 'oss_register', entityId: ex.id, action: 'update', oldValues: reg(ex), newValues: b, actor: actor.user, companyId: actor.companyId, reason: b.reason });
          return { id: ex.id, created: false };
        }
        const id = Number(db.prepare("INSERT INTO oss_register (company_id, component, component_version, licence, usage, obligations, compliance_status, entry_source, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'TO_REVIEW', 'MANUAL', ?, 'oss_register')").run(actor.companyId, b.component, b.version, b.licence, b.usage, b.obligations, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'oss_register', entityId: id, action: 'create', newValues: b, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        return { id, created: true };
      });
    },
    /** Reads the project's own package.json and the licence of every installed dependency; new components come in as "to review", known ones keep their status. */
    scan(actor) {
      if (!may(actor, 'sec.licence.edit')) throw forbidden('You may not change the open-source licence register (permission sec.licence.edit).');
      ensureRegister(actor.companyId);
      const pkgPath = join(root, 'package.json');
      if (!existsSync(pkgPath)) throw unprocessable('package.json was not found next to the server.');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      let added = 0; let updated = 0;
      transaction(db, () => {
        for (const name of Object.keys(deps).sort()) {
          const p = join(root, 'node_modules', name, 'package.json');
          let licence = 'UNKNOWN'; let version = String(deps[name]);
          if (existsSync(p)) { const m = JSON.parse(readFileSync(p, 'utf8')); licence = typeof m.license === 'string' ? m.license : m.license?.type ?? (m.licenses?.map((l) => l.type).join(' OR ') || 'UNKNOWN'); version = m.version ?? version; }
          const usage = pkg.dependencies?.[name] ? 'Runtime dependency of the ERP' : 'Development and test tool (not shipped)';
          const obligations = PERMISSIVE.test(licence) ? 'Keep the copyright and licence notice.' : COPYLEFT.test(licence) ? 'Copyleft licence: legal review of the duties (source offer, linking) is needed before use.' : 'Unknown licence: find out and record it.';
          const ex = db.prepare('SELECT * FROM oss_register WHERE company_id = ? AND component = ?').get(actor.companyId, name);
          if (ex) { if (ex.entry_source === 'SCAN') { db.prepare('UPDATE oss_register SET component_version = ?, licence = ?, usage = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(version, licence, usage, actor.user, nowIso(), ex.id); updated += 1; } continue; }
          db.prepare("INSERT INTO oss_register (company_id, component, component_version, licence, usage, obligations, compliance_status, entry_source, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'TO_REVIEW', 'SCAN', ?, 'oss_register')").run(actor.companyId, name, version, licence, usage, obligations, actor.user);
          added += 1;
        }
        writeAudit(db, { entity: 'oss_register', entityId: 0, action: 'scan', newValues: { added, updated }, actor: actor.user, companyId: actor.companyId });
      });
      return { added, updated, total: db.prepare('SELECT COUNT(*) AS n FROM oss_register WHERE company_id = ? AND is_active = 1').get(actor.companyId).n };
    },
    export(actor, filters) {
      const { rows } = register.list(actor, filters);
      return rows.map((r) => ({ Component: r.component, Version: r.version, Licence: r.licence, Usage: r.usage, Obligations: r.obligations, Status: r.status, 'Reviewed by': r.reviewedBy ?? '', 'Reviewed at': r.reviewedAt ?? '' }));
    },
  };

  const reviews = {
    /** Sends the written licence review to the approvers (IT administrator, then the director). The document records what each component's decision is going to be. */
    submit(actor, b) {
      if (!may(actor, 'sec.licence.edit')) throw forbidden('You may not submit the licence review (permission sec.licence.edit).');
      ensureRegister(actor.companyId);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM sec_licence_reviews WHERE company_id = ? AND status = 'PENDING' AND is_active = 1").get(actor.companyId)) throw conflict('A licence review is already waiting for approval.');
        const decisions = SEED_REGISTER.map((e) => ({ component: e.component, licence: e.licence, status: e.decision, obligations: e.obligations }));
        const document = { title: 'Open-source licence review: end-to-end secure messaging', summary: 'libsignal and the Signal server are AGPL-3.0: using them would oblige the company to offer the complete source of the ERP to every user. The alternative of the brief (Olm and Megolm, Apache-2.0) is permitted but not needed: the part composes the audited WebCrypto API of the platform. Approving this review (1) records those decisions in the register, (2) marks the permissive licences of the other components as approved, (3) allows secure messaging to be switched on.',
          decisions, permissiveBulk: true, comment: b.comment, document: 'docs/erp/LICENCE_REVIEW_05.03.md' };
        const v = (db.prepare('SELECT MAX(review_version) AS v FROM sec_licence_reviews WHERE company_id = ?').get(actor.companyId).v ?? 0) + 1;
        const id = Number(db.prepare("INSERT INTO sec_licence_reviews (company_id, review_version, subject, document_json, status, created_by, source_type) VALUES (?, ?, ?, ?, 'PENDING', ?, 'sec_licence_review')").run(actor.companyId, v, 'End-to-end secure messaging library', JSON.stringify(document), actor.user).lastInsertRowid);
        db.prepare("UPDATE oss_register SET compliance_status = 'IN_REVIEW', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND compliance_status = 'TO_REVIEW' AND component IN (" + SEED_REGISTER.map(() => '?').join(',') + ')').run(actor.user, nowIso(), actor.companyId, ...SEED_REGISTER.map((e) => e.component));
        writeAudit(db, { entity: 'sec_licence_review', entityId: id, action: 'submit', newValues: { version: v }, actor: actor.user, companyId: actor.companyId, reason: b.comment });
        const instance = engine.submit(actor, { docType: REVIEW_DOC, docId: id, comment: b.comment, context: {} });
        db.prepare('UPDATE sec_licence_reviews SET instance_id = ? WHERE id = ?').run(instance.id, id);
        return { id, version: v, workflow: instance };
      });
    },
    /** The approved review writes its decisions into the register. */
    approve(instance, actor) {
      const r = db.prepare('SELECT * FROM sec_licence_reviews WHERE id = ?').get(Number(instance.docId));
      if (!r) return;
      const doc = JSON.parse(r.document_json);
      const now = nowIso();
      for (const d of doc.decisions) db.prepare('UPDATE oss_register SET compliance_status = ?, review_id = ?, reviewed_by = ?, reviewed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND component = ?').run(d.status, r.id, actor.user, now, actor.user, now, r.company_id, d.component);
      if (doc.permissiveBulk) {
        for (const row of db.prepare("SELECT * FROM oss_register WHERE company_id = ? AND compliance_status = 'TO_REVIEW' AND is_active = 1").all(r.company_id)) {
          if (PERMISSIVE.test(row.licence)) db.prepare("UPDATE oss_register SET compliance_status = 'APPROVED', review_id = ?, reviewed_by = ?, reviewed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(r.id, actor.user, now, actor.user, now, row.id);
        }
      }
      db.prepare("UPDATE sec_licence_reviews SET status = 'APPROVED', decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, r.id);
      writeAudit(db, { entity: 'sec_licence_review', entityId: r.id, action: 'approve', newValues: { version: r.review_version }, actor: actor.user, companyId: r.company_id });
    },
    reject(instance, actor) {
      const r = db.prepare("SELECT * FROM sec_licence_reviews WHERE id = ? AND status = 'PENDING'").get(Number(instance.docId));
      if (!r) return;
      const now = nowIso();
      db.prepare("UPDATE sec_licence_reviews SET status = 'REJECTED', decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, r.id);
      db.prepare("UPDATE oss_register SET compliance_status = 'TO_REVIEW', updated_at = ?, version = version + 1 WHERE company_id = ? AND compliance_status = 'IN_REVIEW'").run(now, r.company_id);
    },
  };
  void notFound;
  return { policy, register, reviews, ensureRegister, ruleSet };
}

const services = new WeakMap();
export const bindGovernance = (db, s) => services.set(db, s);
export const governanceOf = (db) => services.get(db);
const bound = (db) => services.get(db);

workflowTypes.register({
  docType: POLICY_DOC,
  label: 'Secure messaging policy change',
  processOwner: 'SYSADM',
  route: () => '/admin/secure-messaging',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM sec_policy WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return r ? { ref: `Secure messaging policy version ${r.config_version}`, title: 'Change of who may use secure conversations and their limits', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const r = db.prepare('SELECT * FROM sec_policy WHERE id = ?').get(Number(id));
    if (!r) return null;
    const c = { ...POLICY_DEFAULTS, ...JSON.parse(r.config_json) };
    return { fields: [{ label: 'Secure messaging on', value: c.enabled ? 'Yes' : 'No' }, { label: 'Roles that may start a secure conversation', value: c.creatorRoles.join(', ') || 'none' }, { label: 'Largest group', value: c.maxGroupMembers }, { label: 'Devices per person', value: c.maxDevicesPerUser }, { label: 'In force from', value: r.effective_from }] };
  },
  defaultDefinition: { name: 'Secure messaging policy approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CHECK', 'IT administrator or director', 'ITADM|DIR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.policy.activate(instance, actor),
    onRejected: (db, { instance, actor }) => bound(db)?.policy.reject(instance, actor),
    onReturned: (db, { instance, actor }) => bound(db)?.policy.reject(instance, actor),
    onCancelled: (db, { instance, actor }) => bound(db)?.policy.reject(instance, actor),
  },
});
workflowTypes.register({
  docType: REVIEW_DOC,
  label: 'Open-source licence review',
  processOwner: 'ITADM',
  route: () => '/admin/licences',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM sec_licence_reviews WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return r ? { ref: `Licence review ${r.review_version}`, title: r.subject, originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const r = db.prepare('SELECT * FROM sec_licence_reviews WHERE id = ?').get(Number(id));
    if (!r) return null;
    const d = JSON.parse(r.document_json);
    return { fields: [{ label: 'Subject', value: r.subject }, ...d.decisions.map((x) => ({ label: x.component, value: `${x.status} (${x.licence})` })), { label: 'Document', value: d.document }] };
  },
  defaultDefinition: { name: 'Open-source licence review', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('ITADM', 'IT administrator', 'ITADM'), step('DIR', 'Director (legal)', 'DIR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.reviews.approve(instance, actor),
    onRejected: (db, { instance, actor }) => bound(db)?.reviews.reject(instance, actor),
    onReturned: (db, { instance, actor }) => bound(db)?.reviews.reject(instance, actor),
    onCancelled: (db, { instance, actor }) => bound(db)?.reviews.reject(instance, actor),
  },
});
evidenceProviders.register(POLICY_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM sec_policy WHERE id = ?').get(Number(instance.docId));
  if (!r) return { sections: [] };
  const was = activePolicy(db, r.company_id);
  const now = { ...POLICY_DEFAULTS, ...JSON.parse(r.config_json) };
  const changed = Object.keys(POLICY_DEFAULTS).filter((k) => JSON.stringify(was[k]) !== JSON.stringify(now[k]));
  return { sections: [{ code: 'policy', title: 'What changes', kind: 'metrics', items: [{ label: 'Settings changed', value: changed.join(', ') || 'none', format: 'text' }, { label: 'Licence review approved', value: licenceApproved(db, r.company_id) ? 'Yes' : 'No', format: 'text', tone: licenceApproved(db, r.company_id) ? undefined : 'warn' }] }] };
});
evidenceProviders.register(REVIEW_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM sec_licence_reviews WHERE id = ?').get(Number(instance.docId));
  if (!r) return { sections: [] };
  const d = JSON.parse(r.document_json);
  return { sections: [{ code: 'review', title: 'Decisions in this review', kind: 'metrics', items: d.decisions.map((x) => ({ label: x.component, value: `${x.status} · ${x.licence}`, format: 'text', tone: x.status === 'REJECTED' ? 'warn' : undefined })) }] };
});
