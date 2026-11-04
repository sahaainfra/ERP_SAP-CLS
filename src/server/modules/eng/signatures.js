import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { recordSecurityEvent } from '../../platform/audit/security.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { formatDate, formatDateTime } from '../../../shared/dates.js';
import { formatINR } from '../../../shared/money.js';
import { CATALOGUE } from './tpl-catalogue.js';
import { templateServiceOf } from './templates.js';

// Digital signature and QR verification (part 04.12). A generated document (04.11) is never changed; its signatures are rows beside it, each with the hash of the document, the signer, the time and a digest chained
// to the signature before, so a changed or removed row is found. A stamped copy (the signature image or the words of an electronic approval drawn on the last page) is made from the original and kept as a copy.
// Anybody can check a document by its code: the public answer holds only the fields the company configured; a file is checked by its hash (BR-01); a cancelled or superseded document says so (BR-02).
export const SIG_CONFIG_DOC = 'SIG_CONFIG';
export const METHODS = Object.freeze(['APPROVAL', 'IMAGE', 'ESIGN', 'DSC']);
export const METHOD_LABEL = Object.freeze({ APPROVAL: 'Electronic approval', IMAGE: 'Signature image', ESIGN: 'Aadhaar eSign', DSC: 'Digital signature certificate' });
export const PUBLIC_FIELDS = Object.freeze(['type', 'docNo', 'issuer', 'version', 'issuedAt', 'status', 'signers', 'project', 'amount']);
export const DEFAULT_CONFIG = Object.freeze({ publicFields: ['type', 'docNo', 'issuer', 'version', 'issuedAt', 'status', 'signers'], signApprovals: true, placements: { DEFAULT: { page: 'last', anchor: 'bottom', width: 132, height: 54, perRow: 4, margin: 34 } } });
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const readAll = async (s) => { const c = []; for await (const x of s) c.push(x); return Buffer.concat(c); };
/** What the standard fonts of a PDF can draw: other letters become a question mark. */
const latin = (s) => String(s ?? '').replace(/[^\x20-\x7e\u00a1-\u00ff]/g, '?');
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** A signing provider (eSign, DSC) is registered by the integration that has one (01.08): `sign({ docHash, signer, ... }) -> { certificateRef }`. None is registered by this part (D-243). */
export const signProviders = new Map();

const services = new WeakMap();
export const bind = (db, s) => services.set(db, s);
const bound = (db) => services.get(db);

export function createSignatureService({ db, engine, storage, jobs, publicUrl = null }) {
  const authz = authzOf(db);
  const may = (actor, key, scope) => authz.check(actor, key, scope ?? { companyId: actor.companyId }).allowed;
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const nowIso = () => engine.clock().toISOString();
  const tpl = () => templateServiceOf(db);
  const scopeOf = (g) => ({ companyId: g.company_id, projectId: g.project_id ?? undefined, siteId: g.site_id ?? undefined });
  const userId = (companyId, name) => db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, name)?.id ?? null;
  const displayName = (companyId, name) => db.prepare('SELECT display_name FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, name)?.display_name ?? name;

  // ---- configuration ----
  const config = {
    active(companyId) {
      const r = db.prepare("SELECT * FROM sig_config WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1").get(companyId);
      return r ? { ...DEFAULT_CONFIG, ...JSON.parse(r.config_json), version: r.config_version } : { ...DEFAULT_CONFIG, version: 0 };
    },
    get(actor) {
      if (!anywhere(actor, 'sig.config.view')) throw forbidden('You may not see the signature settings (permission sig.config.view).');
      const pending = db.prepare("SELECT * FROM sig_config WHERE company_id = ? AND status = 'PENDING' AND is_active = 1").get(actor.companyId);
      return { config: config.active(actor.companyId), pending: pending ? { id: pending.id, instanceId: pending.instance_id, by: pending.created_by, reason: pending.reason, config: JSON.parse(pending.config_json) } : null, choices: PUBLIC_FIELDS, docTypes: Object.keys(CATALOGUE), canEdit: may(actor, 'sig.config.edit') };
    },
    propose(actor, b) {
      if (!may(actor, 'sig.config.edit')) throw forbidden('You may not change the signature settings (permission sig.config.edit).');
      const problems = [];
      for (const f of b.publicFields) if (!PUBLIC_FIELDS.includes(f)) problems.push({ field: 'publicFields', message: `${f} is not a field that can be public.` });
      for (const k of Object.keys(b.placements)) if (k !== 'DEFAULT' && !CATALOGUE[k]) problems.push({ field: `placements.${k}`, message: `${k} is not a document type of the library.` });
      if (problems.length) throw badRequest('The settings are not valid.', problems);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM sig_config WHERE company_id = ? AND status = 'PENDING' AND is_active = 1").get(actor.companyId)) throw conflict('A change of the signature settings is already waiting for approval. It must be decided first.');
        const v = (db.prepare('SELECT MAX(config_version) AS v FROM sig_config WHERE company_id = ?').get(actor.companyId).v ?? 0) + 1;
        const value = { publicFields: b.publicFields, signApprovals: b.signApprovals, placements: { DEFAULT: DEFAULT_CONFIG.placements.DEFAULT, ...b.placements } };
        const id = Number(db.prepare("INSERT INTO sig_config (company_id, config_json, config_version, status, reason, created_by, source_type) VALUES (?, ?, ?, 'PENDING', ?, ?, 'config_change')").run(actor.companyId, JSON.stringify(value), v, b.reason, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'sig_config', entityId: id, action: 'propose', oldValues: config.active(actor.companyId), newValues: value, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine.submit(actor, { docType: SIG_CONFIG_DOC, docId: id, comment: b.reason, context: {} });
        db.prepare('UPDATE sig_config SET instance_id = ? WHERE id = ?').run(instance.id, id);
        return { id, workflow: instance };
      });
    },
    activate(instance, actor) {
      const r = db.prepare('SELECT * FROM sig_config WHERE id = ?').get(Number(instance.docId));
      if (!r) return;
      const stamp = nowIso();
      db.prepare("UPDATE sig_config SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND status = 'ACTIVE'").run(actor.user, stamp, r.company_id);
      db.prepare("UPDATE sig_config SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, stamp, r.id);
      writeAudit(db, { entity: 'sig_config', entityId: r.id, action: 'activate', newValues: { version: r.config_version }, actor: actor.user, companyId: r.company_id });
    },
    reject(instance, actor) { db.prepare("UPDATE sig_config SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, nowIso(), Number(instance.docId)); },
  };

  // ---- the verification row of a document (its code is the one printed in the QR) ----
  const ensureVerification = (g) => {
    db.prepare("INSERT OR IGNORE INTO sig_verifications (company_id, code, generated_doc_id, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'system', 'tpl_generated')").run(g.company_id, g.verify_code, g.id, g.project_id, g.site_id);
    return db.prepare('SELECT * FROM sig_verifications WHERE generated_doc_id = ?').get(g.id);
  };
  const generated = (id) => db.prepare('SELECT * FROM tpl_generated_docs WHERE id = ? AND is_active = 1').get(id);
  const visibleDoc = (actor, id) => {
    const g = generated(id);
    if (!g || !tpl().generated.visible(actor, g)) throw notFound('That document does not exist.');
    return g;
  };
  const chainOf = (docId) => db.prepare('SELECT * FROM sig_signatures WHERE generated_doc_id = ? ORDER BY id').all(docId);
  const digestOf = (prev, hash, name, method, at, cert) => sha256([prev ?? '', hash, name, method, at, cert ?? ''].join('|'));
  /** Is every digest of the chain what the rows say it should be? A changed or removed row breaks it. */
  const chainIntact = (rows, hash) => { let prev = null; for (const r of rows) { if (r.hash !== hash || r.prev_digest !== prev || r.digest !== digestOf(prev, r.hash, r.signer_name, r.method, r.signed_at, r.certificate_ref)) return false; prev = r.digest; } return true; };

  // ---- signing ----
  /** Add a signature row (inside the caller's transaction). */
  function addSignature(g, { signerName, method, label = null, certificateRef = null, signedAt = null, workflowInstanceId = null, ip = null, actor = 'system' }) {
    const ver = ensureVerification(g);
    if (ver.status === 'CANCELLED') throw conflict('This document was cancelled; it can no longer be signed.');
    if (g.is_current !== 1) throw conflict('This document was replaced by a newer version; sign the current one.');
    const at = signedAt ?? nowIso();
    const rows = chainOf(g.id);
    const prev = rows.length ? rows[rows.length - 1].digest : null;
    const digest = digestOf(prev, g.hash, signerName, method, at, certificateRef);
    const res = db.prepare(`INSERT INTO sig_signatures (company_id, generated_doc_id, signer_user_id, signer_name, signer_label, method, signed_at, hash, digest, prev_digest, certificate_ref, workflow_instance_id, ip, project_id, site_id, created_by, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tpl_generated', ?)`).run(g.company_id, g.id, userId(g.company_id, signerName), signerName, label, method, at, g.hash, digest, prev, certificateRef, workflowInstanceId, ip, g.project_id, g.site_id, actor, String(g.id));
    const id = Number(res.lastInsertRowid);
    writeAudit(db, { entity: 'sig_signatures', entityId: id, action: 'sign', newValues: { docNo: g.doc_number, version: g.version_no, method, signer: signerName, hash: g.hash }, actor, companyId: g.company_id });
    publishEvent(db, { type: 'sig.document.signed', entity: 'generated_document', entityId: g.id, actorId: signerName, companyId: g.company_id, projectId: g.project_id, siteId: g.site_id, data: { docNo: g.doc_number, version: g.version_no, method, signer: signerName } });
    return id;
  }
  const signer = {
    /** A person signs: the electronic approval (their sign-in is the proof) or the image of their profile; eSign and DSC go through a provider. */
    async sign(actor, id, b, ip = null) {
      const g = visibleDoc(actor, id);
      if (!may(actor, 'sig.document.sign', scopeOf(g))) throw forbidden('You may not sign documents here (permission sig.document.sign).');
      let certificateRef = null;
      if (b.method === 'IMAGE' && !db.prepare('SELECT 1 FROM sig_profiles WHERE company_id = ? AND user_name = ? AND is_active = 1').get(g.company_id, actor.user)) throw unprocessable('You have no signature picture yet. Add it under My signature on the Signature Register.');
      if (b.method === 'ESIGN' || b.method === 'DSC') {
        const p = signProviders.get(b.method);
        if (!p) throw conflict(`${METHOD_LABEL[b.method]} needs a provider and none is connected for this company. Ask the IT administrator to connect one (Integration hub).`);
        certificateRef = (await p.sign({ docHash: g.hash, signer: actor.user, docNo: g.doc_number })).certificateRef;
      }
      const sigId = transaction(db, () => {
        if (db.prepare("SELECT 1 FROM sig_signatures WHERE generated_doc_id = ? AND signer_name = ? AND method = ? AND status = 'SIGNED'").get(g.id, actor.user, b.method)) throw conflict(`You have already signed this document by ${METHOD_LABEL[b.method].toLowerCase()}.`);
        return addSignature(g, { signerName: actor.user, method: b.method, label: b.label ?? null, certificateRef, ip, actor: actor.user });
      });
      await signer.stamp(g.id);
      return signer.detail(actor, g.id, sigId);
    },
    /** The electronic approval of the workflow becomes signatures: one for each approver who approved the document's instance, with the time of the approval. */
    fromApprovals(g) {
      if (!config.active(g.company_id).signApprovals) return 0;
      const insts = db.prepare(`SELECT * FROM wf_instances WHERE company_id = ? AND status = 'APPROVED' AND doc_id = ? AND (doc_type = ? OR doc_type IN (SELECT workflow_doc_type FROM tpl_auto_rules WHERE company_id = ? AND doc_type = ?)) ORDER BY id`).all(g.company_id, g.entity_id, g.doc_type, g.company_id, g.doc_type);
      let n = 0;
      for (const inst of insts) {
        for (const h of db.prepare("SELECT * FROM wf_history WHERE instance_id = ? AND event = 'APPROVED' ORDER BY id").all(inst.id)) {
          if (db.prepare("SELECT 1 FROM sig_signatures WHERE generated_doc_id = ? AND signer_name = ? AND method = 'APPROVAL' AND status = 'SIGNED'").get(g.id, h.actor)) continue;
          try { addSignature(g, { signerName: h.actor, method: 'APPROVAL', label: h.step_code, certificateRef: `workflow:${inst.id}`, signedAt: h.at, workflowInstanceId: inst.id, actor: 'system' }); n += 1; } catch (e) { if (e.status !== 409) throw e; }
        }
      }
      if (n) jobs.enqueue('sig.stamp', { id: g.id }, { createdBy: 'system', companyId: g.company_id });
      return n;
    },
    onApproved(event) {
      const inst = db.prepare('SELECT * FROM wf_instances WHERE id = ?').get(Number(event.data?.instanceId));
      if (!inst) return;
      for (const g of db.prepare(`SELECT * FROM tpl_generated_docs WHERE company_id = ? AND entity_id = ? AND is_current = 1 AND (doc_type = ? OR doc_type IN (SELECT doc_type FROM tpl_auto_rules WHERE company_id = ? AND workflow_doc_type = ?))`).all(inst.company_id, String(inst.doc_id), inst.doc_type, inst.company_id, inst.doc_type)) signer.fromApprovals(g);
    },
    onGenerated(event) {
      const g = generated(Number(event.entityId));
      if (g) { ensureVerification(g); signer.fromApprovals(g); }
    },
    /** The stamped copy: the original file with the signatures drawn on one page, kept as a copy; the original is never changed. */
    async stamp(docId) {
      const g = generated(docId);
      if (!g) return null;
      const rows = chainOf(docId);
      if (rows.length === 0) return null;
      const last = db.prepare('SELECT signature_count FROM sig_copies WHERE generated_doc_id = ? ORDER BY id DESC').get(docId);
      const revoked = rows.filter((r) => r.status === 'REVOKED').length;
      const sig = rows.length * 1000 + revoked;
      if (last && last.signature_count === sig) return null; // already drawn for exactly this state
      const file = db.prepare('SELECT * FROM core_files WHERE id = ?').get(g.file_id);
      const pdf = await PDFDocument.load(await readAll(storage.createReadStream(file.storage_key)), { updateMetadata: false });
      const cfg = config.active(g.company_id);
      const place = { ...DEFAULT_CONFIG.placements.DEFAULT, ...(cfg.placements?.[g.doc_type] ?? cfg.placements?.DEFAULT ?? {}) };
      const pages = pdf.getPages();
      const page = place.page === 'first' ? pages[0] : pages[pages.length - 1];
      const { width: pw, height: ph } = page.getSize();
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const reg = await pdf.embedFont(StandardFonts.Helvetica);
      const colour = rgb(0.08, 0.19, 0.37);
      const gap = 6;
      const perRow = Math.max(1, Math.min(place.perRow, Math.floor((pw - 2 * place.margin + gap) / (place.width + gap))));
      for (const [i, r] of rows.entries()) {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const x = place.margin + col * (place.width + gap);
        const y = place.anchor === 'top' ? ph - place.margin - place.height - row * (place.height + gap) : place.margin + 22 + (Math.floor((rows.length - 1) / perRow) - row) * (place.height + gap);
        page.drawRectangle({ x, y, width: place.width, height: place.height, borderColor: r.status === 'REVOKED' ? rgb(0.75, 0.1, 0.1) : colour, borderWidth: 0.8 });
        let top = y + place.height - 11;
        if (r.method === 'IMAGE') {
          const prof = db.prepare('SELECT image_data FROM sig_profiles WHERE company_id = ? AND user_name = ?').get(r.company_id, r.signer_name);
          if (prof) {
            try {
              const m = /^data:image\/(png|jpe?g);base64,(.*)$/.exec(prof.image_data);
              const img = m[1] === 'png' ? await pdf.embedPng(Buffer.from(m[2], 'base64')) : await pdf.embedJpg(Buffer.from(m[2], 'base64'));
              const s = Math.min((place.width - 12) / img.width, 22 / img.height);
              page.drawImage(img, { x: x + 6, y: top - 20, width: img.width * s, height: img.height * s });
              top -= 24;
            } catch { /* a picture that cannot be read leaves the words only */ }
          }
        }
        page.drawText(latin(displayName(r.company_id, r.signer_name)).slice(0, 26), { x: x + 6, y: top, size: 8, font: bold, color: colour });
        page.drawText(latin(`${METHOD_LABEL[r.method]}${r.signer_label ? ` (${r.signer_label})` : ''}`).slice(0, 34), { x: x + 6, y: top - 9, size: 6.5, font: reg, color: colour });
        page.drawText(latin(formatDateTime(r.signed_at)), { x: x + 6, y: top - 17, size: 6.5, font: reg, color: colour });
        page.drawText(latin(`Ref ${r.digest.slice(0, 12)}`), { x: x + 6, y: top - 25, size: 6, font: reg, color: rgb(0.35, 0.4, 0.45) });
        if (r.status === 'REVOKED') page.drawText('REVOKED', { x: x + place.width - 52, y: y + 5, size: 9, font: bold, color: rgb(0.75, 0.1, 0.1) });
      }
      page.drawText(latin(`Signed copy. Verify: ${publicUrl ? `${publicUrl.replace(/\/$/, '')}/verify/${g.verify_code}` : `code ${g.verify_code}`}`), { x: place.margin, y: 12, size: 6.5, font: reg, color: rgb(0.35, 0.4, 0.45) });
      const bytes = Buffer.from(await pdf.save());
      const hash = sha256(bytes);
      const day = engine.clock();
      const key = `c${g.company_id}/sig/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.pdf`;
      await storage.putBuffer(key, bytes);
      return transaction(db, () => {
        const f = db.prepare(`INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, scanned_at, linked_entity, linked_id, version_no, retention_class, project_id, site_id, created_by, source_type)
          VALUES (?, ?, ?, 'pdf', 'application/pdf', 'document', ?, ?, 'CLEAN', ?, 'tpl_generated', ?, 1, 'statutory', ?, ?, 'system', 'sig_stamp')`).run(g.company_id, key, `${String(g.doc_number).replace(/[^\w.-]+/g, '_')}_v${g.version_no}_signed.pdf`, bytes.length, hash, nowIso(), g.id, g.project_id, g.site_id);
        db.prepare('INSERT INTO sig_copies (company_id, generated_doc_id, file_id, hash, signature_count, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(g.company_id, g.id, Number(f.lastInsertRowid), hash, sig, g.project_id, g.site_id, 'system', 'sig_stamp');
        return { hash, fileId: Number(f.lastInsertRowid) };
      });
    },
    /** The latest stamped copy (or the original when nobody signed) for a person who may see the document. */
    async content(actor, id) {
      const g = visibleDoc(actor, id);
      const copy = db.prepare('SELECT * FROM sig_copies WHERE generated_doc_id = ? ORDER BY id DESC').get(g.id);
      const f = db.prepare('SELECT * FROM core_files WHERE id = ?').get(copy ? copy.file_id : g.file_id);
      const total = await storage.size(f.storage_key);
      if (total === null) throw notFound('The stored file is missing. Tell an administrator.');
      writeAudit(db, { entity: 'tpl_generated_docs', entityId: g.id, action: 'download_signed', newValues: { docNo: g.doc_number, copy: Boolean(copy) }, actor: actor.user, companyId: g.company_id });
      return { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${f.original_name}"`, 'content-length': String(total), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-signed-copy': copy ? '1' : '0' }, stream: storage.createReadStream(f.storage_key) };
    },
    cancel(actor, id, reason) {
      const g = visibleDoc(actor, id);
      if (!may(actor, 'sig.document.cancel', scopeOf(g))) throw forbidden('You may not cancel documents (permission sig.document.cancel).');
      return transaction(db, () => {
        const v = ensureVerification(g);
        if (v.status === 'CANCELLED') throw conflict('This document is already cancelled.');
        db.prepare("UPDATE sig_verifications SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, reason, actor.user, nowIso(), v.id);
        writeAudit(db, { entity: 'sig_verifications', entityId: v.id, action: 'cancel', newValues: { docNo: g.doc_number, version: g.version_no }, actor: actor.user, companyId: g.company_id, reason });
        publishEvent(db, { type: 'sig.document.cancelled', entity: 'generated_document', entityId: g.id, actorId: actor.user, companyId: g.company_id, projectId: g.project_id, siteId: g.site_id, data: { docNo: g.doc_number, version: g.version_no, reason } });
        return signer.detail(actor, g.id);
      });
    },
    async revoke(actor, id, reason) {
      const s = db.prepare('SELECT * FROM sig_signatures WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      if (!s) throw notFound('That signature does not exist.');
      const g = visibleDoc(actor, s.generated_doc_id);
      if (!may(actor, 'sig.signature.revoke', scopeOf(g))) throw forbidden('You may not revoke signatures (permission sig.signature.revoke).');
      transaction(db, () => {
        if (s.status === 'REVOKED') throw conflict('This signature is already revoked.');
        db.prepare("UPDATE sig_signatures SET status = 'REVOKED', revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, reason, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'sig_signatures', entityId: id, action: 'revoke', newValues: { docNo: g.doc_number, signer: s.signer_name }, actor: actor.user, companyId: g.company_id, reason });
        publishEvent(db, { type: 'sig.signature.revoked', entity: 'generated_document', entityId: g.id, actorId: actor.user, companyId: g.company_id, projectId: g.project_id, siteId: g.site_id, data: { docNo: g.doc_number, signer: s.signer_name, reason } });
      });
      await signer.stamp(g.id);
      return signer.detail(actor, g.id);
    },

    // ---- what a signed document shows to people who may see it ----
    detail(actor, id, focus = null) {
      const g = visibleDoc(actor, id);
      if (!anywhere(actor, 'sig.document.view') || !may(actor, 'sig.document.view', scopeOf(g))) throw forbidden('You may not see signatures (permission sig.document.view).');
      const v = ensureVerification(g);
      const rows = chainOf(g.id);
      const copies = db.prepare('SELECT * FROM sig_copies WHERE generated_doc_id = ? ORDER BY id DESC').all(g.id);
      return {
        documentId: g.id, docNo: g.doc_number, docType: g.doc_type, typeLabel: CATALOGUE[g.doc_type]?.label ?? g.doc_type, version: g.version_no, current: g.is_current === 1, hash: g.hash, verifyCode: g.verify_code,
        verifyUrl: publicUrl ? `${publicUrl.replace(/\/$/, '')}/verify/${g.verify_code}` : `/verify/${g.verify_code}`, status: statusOf(g, v).status, cancelled: v.status === 'CANCELLED' ? { at: v.cancelled_at, by: v.cancelled_by, reason: v.cancel_reason } : null,
        verifications: { count: v.verify_count, mismatches: v.mismatch_count, last: v.last_verified_at }, chainIntact: chainIntact(rows, g.hash), copies: copies.map((c) => ({ id: c.id, hash: c.hash, at: c.created_at })), focus,
        signatures: rows.map(sigRow), canSign: may(actor, 'sig.document.sign', scopeOf(g)) && v.status !== 'CANCELLED' && g.is_current === 1, canCancel: may(actor, 'sig.document.cancel', scopeOf(g)) && v.status !== 'CANCELLED', canRevoke: may(actor, 'sig.signature.revoke', scopeOf(g)),
        providers: { ESIGN: signProviders.has('ESIGN'), DSC: signProviders.has('DSC') }, hasProfile: Boolean(db.prepare('SELECT 1 FROM sig_profiles WHERE company_id = ? AND user_name = ? AND is_active = 1').get(g.company_id, actor.user)),
      };
    },
    detailByCode(actor, code) {
      const g = db.prepare('SELECT id FROM tpl_generated_docs WHERE verify_code = ?').get(String(code).toUpperCase());
      if (!g) throw notFound('No document of this system carries this code.');
      return signer.detail(actor, g.id);
    },

    // ---- the public check (no sign-in) ----
    verify(code, { file = null } = {}) {
      const g = db.prepare('SELECT g.*, c.legal_name FROM tpl_generated_docs g JOIN org_companies c ON c.id = g.company_id WHERE g.verify_code = ?').get(String(code).toUpperCase());
      if (!g) return { found: false, status: 'UNKNOWN', valid: false, message: 'No document of this system carries this code.' };
      const v = ensureVerification(g);
      const st = statusOf(g, v);
      let fileResult = null;
      if (file) {
        const h = sha256(file);
        const copy = db.prepare('SELECT 1 FROM sig_copies WHERE generated_doc_id = ? AND hash = ?').get(g.id, h);
        const match = h === g.hash || Boolean(copy);
        fileResult = { match, kind: !match ? null : h === g.hash ? 'original' : 'signed copy', fingerprint: h.slice(0, 16), message: match ? `The file is exactly the ${h === g.hash ? 'original' : 'signed copy'} issued by ${g.legal_name}.` : 'The file is NOT the document that was issued: at least one byte differs.' };
      }
      db.prepare('UPDATE sig_verifications SET verify_count = verify_count + 1, mismatch_count = mismatch_count + ?, last_verified_at = ? WHERE id = ?').run(fileResult && !fileResult.match ? 1 : 0, nowIso(), v.id);
      if (fileResult && !fileResult.match) {
        recordSecurityEvent(db, { companyId: g.company_id, type: 'sig.tamper_detected', severity: 'WARNING', details: { docNo: g.doc_number, version: g.version_no, fingerprint: fileResult.fingerprint }, sourceType: 'tpl_generated', sourceId: String(g.id) });
        publishEvent(db, { type: 'sig.verification.failed', entity: 'generated_document', entityId: g.id, actorId: 'public', companyId: g.company_id, projectId: g.project_id, siteId: g.site_id, data: { docNo: g.doc_number, version: g.version_no } });
      }
      const cfg = config.active(g.company_id);
      const pub = new Set(cfg.publicFields);
      const out = { found: true, valid: st.status === 'VALID', status: st.status, message: st.message };
      if (pub.has('type')) out.type = CATALOGUE[g.doc_type]?.label ?? g.doc_type;
      if (pub.has('docNo')) out.docNo = g.doc_number;
      if (pub.has('issuer')) out.issuer = g.legal_name;
      if (pub.has('version')) out.version = g.version_no;
      if (pub.has('issuedAt')) out.issuedAt = g.generated_at;
      if (pub.has('project') && g.project_id) out.project = db.prepare('SELECT name FROM org_projects WHERE id = ?').get(g.project_id)?.name ?? null;
      if (pub.has('amount') && !CATALOGUE[g.doc_type]?.sensitive) {
        const rec = g.source_id ? db.prepare('SELECT data_json FROM tpl_records WHERE id = ?').get(Number(g.source_id)) : null;
        const d = rec ? JSON.parse(rec.data_json) : {};
        const amt = d.grandTotal ?? d.total ?? null;
        if (amt != null) out.amount = formatINR(String(amt));
      }
      if (pub.has('signers')) out.signers = chainOf(g.id).map((r) => ({ name: displayName(g.company_id, r.signer_name), method: METHOD_LABEL[r.method], at: r.signed_at, status: r.status === 'REVOKED' ? 'Revoked' : 'Signed' }));
      if (fileResult) out.file = fileResult;
      return out;
    },
  };
  const statusOf = (g, v) => {
    const f = db.prepare('SELECT sha256 FROM core_files WHERE id = ?').get(g.file_id);
    if (f?.sha256 !== g.hash) return { status: 'INVALID', message: 'The stored file no longer matches its record. Do not rely on this document.' };
    if (v.status === 'CANCELLED') return { status: 'CANCELLED', message: `Cancelled on ${formatDate(v.cancelled_at)}.` };
    if (g.is_current !== 1) {
      const next = db.prepare('SELECT generated_at FROM tpl_generated_docs WHERE id = ?').get(g.superseded_by);
      return { status: 'SUPERSEDED', message: `Superseded on ${formatDate(next?.generated_at ?? g.updated_at)}. A newer version of this document exists.` };
    }
    return { status: 'VALID', message: 'This is a genuine, current document.' };
  };
  const sigRow = (r) => ({ id: r.id, signer: r.signer_name, name: displayName(r.company_id, r.signer_name), method: r.method, methodLabel: METHOD_LABEL[r.method], label: r.signer_label, signedAt: r.signed_at, status: r.status, certificateRef: r.certificate_ref, ip: r.ip, workflowInstanceId: r.workflow_instance_id, digest: r.digest, revokedAt: r.revoked_at, revokedBy: r.revoked_by, revokeReason: r.revoke_reason });

  // ---- the register ----
  const register = {
    list(actor, q = {}) {
      if (!anywhere(actor, 'sig.register.view')) throw forbidden('You may not see the signature register (permission sig.register.view).');
      const where = ['s.company_id = :c', 's.is_active = 1'];
      const p = { c: actor.companyId };
      if (q.method) { where.push('s.method = :m'); p.m = q.method; }
      if (q.status) { where.push('s.status = :st'); p.st = q.status; }
      if (q.docType) { where.push('g.doc_type = :dt'); p.dt = q.docType; }
      if (q.projectId) { where.push('s.project_id = :pj'); p.pj = q.projectId; }
      if (q.signer) { where.push("s.signer_name LIKE :sg ESCAPE '\\'"); p.sg = `%${String(q.signer).replace(/[\\%_]/g, '\\$&')}%`; }
      if (q.from) { where.push('s.signed_at >= :from'); p.from = `${q.from}T00:00:00.000Z`; }
      if (q.to) { where.push('s.signed_at <= :to'); p.to = `${q.to}T23:59:59.999Z`; }
      if (q.q) { where.push("(g.doc_number LIKE :q ESCAPE '\\' OR g.verify_code LIKE :q ESCAPE '\\')"); p.q = `%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`; }
      const scope = authz.scopeFilter(actor, 'sig.register.view', { project: 's.project_id', site: 's.site_id' }).sql;
      const sens = Object.keys(CATALOGUE).filter((t) => CATALOGUE[t].sensitive).map((t) => `'${t}'`).join(', ');
      const w = `${where.join(' AND ')} AND ${scope} AND (g.doc_type NOT IN (${sens}) OR ${authz.scopeFilter(actor, 'tpl.document.generate_sensitive', { project: 's.project_id', site: 's.site_id' }).sql})`;
      const from = 'FROM sig_signatures s JOIN tpl_generated_docs g ON g.id = s.generated_doc_id JOIN sig_verifications v ON v.generated_doc_id = g.id';
      const total = db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${w}`).get(p).n;
      const limit = [25, 50, 100].includes(Number(q.limit)) ? Number(q.limit) : 25;
      const offset = Math.max(0, Number(q.offset) || 0);
      const sorts = { newest: 's.signed_at DESC, s.id DESC', oldest: 's.signed_at ASC, s.id ASC', number: 'g.doc_number ASC, s.id ASC', signer: 's.signer_name ASC, s.id DESC' };
      const rows = db.prepare(`SELECT s.*, g.doc_number, g.doc_type, g.version_no, g.is_current, g.verify_code, v.status AS doc_status, v.verify_count ${from} WHERE ${w} ORDER BY ${sorts[q.sort] ?? sorts.newest} LIMIT :lim OFFSET :off`).all({ ...p, lim: limit, off: offset })
        .map((r) => ({ ...sigRow(r), documentId: r.generated_doc_id, docNo: r.doc_number, docType: r.doc_type, typeLabel: CATALOGUE[r.doc_type]?.label ?? r.doc_type, version: r.version_no, current: r.is_current === 1, documentStatus: r.doc_status, verifyCode: r.verify_code, verifications: r.verify_count, projectId: r.project_id }));
      const byMethod = db.prepare(`SELECT s.method AS method, COUNT(*) AS n ${from} WHERE ${w} GROUP BY s.method ORDER BY n DESC`).all(p).map((r) => ({ ...r, label: METHOD_LABEL[r.method] }));
      const byStatus = db.prepare(`SELECT s.status AS status, COUNT(*) AS n ${from} WHERE ${w} GROUP BY s.status`).all(p);
      const checks = db.prepare(`SELECT COALESCE(SUM(v.verify_count), 0) AS checks, COALESCE(SUM(v.mismatch_count), 0) AS mismatches FROM sig_verifications v WHERE v.id IN (SELECT DISTINCT v.id ${from} WHERE ${w})`).get(p);
      return { rows, total, limit, offset, summary: { total, byMethod, byStatus, checks: checks.checks, mismatches: checks.mismatches }, canRevoke: anywhere(actor, 'sig.signature.revoke'), methods: METHODS.map((m) => ({ code: m, label: METHOD_LABEL[m] })) };
    },
  };

  // ---- the signature picture of a person ----
  const profile = {
    get(actor) {
      if (!anywhere(actor, 'sig.document.sign')) throw forbidden('You may not sign documents (permission sig.document.sign).');
      const r = db.prepare('SELECT * FROM sig_profiles WHERE company_id = ? AND user_name = ? AND is_active = 1').get(actor.companyId, actor.user);
      return { has: Boolean(r), image: r?.image_data ?? null, updatedAt: r?.updated_at ?? r?.created_at ?? null };
    },
    async put(actor, image) {
      if (!anywhere(actor, 'sig.document.sign')) throw forbidden('You may not sign documents (permission sig.document.sign).');
      const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!m || image.length > 200_000) throw badRequest('The picture must be a PNG or JPEG of at most 150 KB.', [{ field: 'image', message: 'Use a PNG or JPEG of at most 150 KB.' }]);
      try { const meta = await sharp(Buffer.from(m[2], 'base64')).metadata(); if (!meta.width || !meta.height || meta.width > 2000 || meta.height > 1000) throw new Error('size'); } catch { throw badRequest('That is not a usable picture (at most 2000 by 1000 pixels).', [{ field: 'image', message: 'Use a PNG or JPEG of at most 2000 by 1000 pixels.' }]); }
      transaction(db, () => {
        const old = db.prepare('SELECT id FROM sig_profiles WHERE company_id = ? AND user_name = ?').get(actor.companyId, actor.user);
        if (old) db.prepare('UPDATE sig_profiles SET image_data = ?, image_hash = ?, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(image, sha256(image), actor.user, nowIso(), old.id);
        else db.prepare("INSERT INTO sig_profiles (company_id, user_name, image_data, image_hash, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'profile')").run(actor.companyId, actor.user, image, sha256(image), actor.user);
        writeAudit(db, { entity: 'sig_profiles', entityId: actor.user, action: old ? 'update' : 'create', actor: actor.user, companyId: actor.companyId });
      });
      return profile.get(actor);
    },
    remove(actor) {
      db.prepare('UPDATE sig_profiles SET is_active = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND user_name = ?').run(actor.user, nowIso(), actor.companyId, actor.user);
      writeAudit(db, { entity: 'sig_profiles', entityId: actor.user, action: 'remove', actor: actor.user, companyId: actor.companyId });
      return profile.get(actor);
    },
  };

  const companyOfCode = (code) => db.prepare('SELECT company_id FROM tpl_generated_docs WHERE verify_code = ?').get(String(code).toUpperCase())?.company_id ?? null;
  return { config, signer, register, profile, ensureVerification, companyOfCode };
}

// ---- the approval of a change of the settings ----
workflowTypes.register({
  docType: SIG_CONFIG_DOC,
  label: 'Signature settings change',
  processOwner: 'SYSADM',
  route: () => '/admin/signatures',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM sig_config WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return r ? { ref: `Signature settings version ${r.config_version}`, title: 'Change of the public fields and signature placement', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const r = db.prepare('SELECT * FROM sig_config WHERE id = ?').get(Number(id));
    if (!r) return null;
    const c = JSON.parse(r.config_json);
    return { fields: [{ label: 'Public fields', value: c.publicFields.join(', ') }, { label: 'Sign approvals automatically', value: c.signApprovals ? 'Yes' : 'No' }, { label: 'Placements', value: Object.keys(c.placements).join(', ') }, { label: 'Reason', value: r.reason ?? '' }] };
  },
  defaultDefinition: { name: 'Signature settings approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CHECK', 'System administrator or director', 'SYSADM|DIR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.config.activate(instance, actor),
    onRejected: (db, { instance, actor }) => bound(db)?.config.reject(instance, actor),
    onReturned: (db, { instance, actor }) => bound(db)?.config.reject(instance, actor),
    onCancelled: (db, { instance, actor }) => bound(db)?.config.reject(instance, actor),
  },
});
evidenceProviders.register(SIG_CONFIG_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM sig_config WHERE id = ?').get(Number(instance.docId));
  if (!r) return { sections: [] };
  const was = db.prepare("SELECT * FROM sig_config WHERE company_id = ? AND status = 'ACTIVE'").get(r.company_id);
  const a = was ? JSON.parse(was.config_json) : DEFAULT_CONFIG; const b = JSON.parse(r.config_json);
  const added = b.publicFields.filter((f) => !a.publicFields.includes(f)); const removed = a.publicFields.filter((f) => !b.publicFields.includes(f));
  return { sections: [{ code: 'config', title: 'What changes', kind: 'metrics', items: [{ label: 'Made public', value: added.join(', ') || 'nothing', format: 'text', tone: added.length ? 'warn' : undefined }, { label: 'No longer public', value: removed.join(', ') || 'nothing', format: 'text' }] }], flags: added.includes('amount') ? [{ tone: 'warn', text: 'The amount of a document would be shown to anybody who scans its QR code.' }] : [] };
});
