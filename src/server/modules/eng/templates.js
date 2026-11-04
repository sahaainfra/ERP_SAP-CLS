import { createHash, randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { createSigner } from '../../platform/files/signing.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { commOf } from '../../platform/comm/index.js';
import { qrRegistry } from '../../platform/qr/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { formatBusinessDate } from '../../../shared/dates.js';
import { CATALOGUE, DOC_TYPES, OWNER_ROLES, SYSTEM_SCALARS, compute, sampleOf, variablesOf } from './tpl-catalogue.js';
import { documentHtml, render, validate } from './tpl-engine.js';
import { renderPdf } from './tpl-pdf.js';
import { BASE_CSS, standardFormat } from './tpl-library.js';

// Document templates, PDF generation, print and delivery (part 04.11). A template (a format with controlled variables) is approved before production use (BR-01); an official document is made from approved data
// and the active template, carries a QR verification code, is stored through the file service and never changes (BR-02: a new generation is a new version with a reason); delivery goes by download, e-mail,
// WhatsApp, message or portal and every step is logged.
export const TEMPLATE_DOC = 'TPL_TEMPLATE';
export const VERIFY_QR = 'DOCVERIFY';
export const LINK_DAYS = 7;
export const BULK_MAX = 1000;
export const CHANNELS = Object.freeze(['DOWNLOAD', 'EMAIL', 'WHATSAPP', 'MESSAGE', 'PORTAL']);
export const PURPOSES = Object.freeze(['OFFICIAL', 'ARCHIVAL', 'MILESTONE']);
const SENSITIVE_KEYS = (cat) => Object.entries(cat.scalars).filter(([, v]) => v.sensitive).map(([k]) => k);
const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newVerifyCode = () => Array.from(randomBytes(12), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const safeName = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80);

const services = new WeakMap();
export const bind = (db, service) => services.set(db, service);
const bound = (db) => services.get(db);

/** Where the data of a document comes from. A module registers its own source for its document type (it reads its own tables); until it does, the records published with `records.publish` are used. */
export const templateSources = new Map();
export const registerTemplateSource = (docType, source) => {
  if (!CATALOGUE[docType]) throw new Error(`${docType} is not a document type of the format library`);
  templateSources.set(docType, source);
};

export function createTemplateService({ db, engine, storage, jobs, secret, publicUrl = null }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const comm = commOf(db);
  const signer = createSigner(`${secret ?? randomBytes(32).toString('hex')}:tpl-documents`, () => engine.clock().getTime());
  const may = (actor, key, scope) => authz.check(actor, key, scope ?? { companyId: actor.companyId }).allowed;
  /** Does the person hold the right anywhere (for a list: the rows are then limited to their scope)? */
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const nowIso = () => engine.clock().toISOString();
  const today = () => new Date(engine.clock().getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const userRow = (companyId, name) => db.prepare("SELECT username, display_name FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1 AND status = 'ACTIVE'").get(companyId, name);

  // ---- the library: the shared standard formats, written once ----
  function seedLibrary() {
    const insert = db.prepare("INSERT OR IGNORE INTO tpl_templates (company_id, doc_type, code, template_version, name, html, css, variables_json, status, is_default, approved_by, approved_at, effective_from, created_by, source_type) VALUES (NULL, ?, ?, 1, ?, ?, ?, ?, 'ACTIVE', 1, 'system', ?, '2026-01-01', 'system', 'reference_seed')");
    for (const t of DOC_TYPES) {
      const f = standardFormat(t);
      const v = validate(t, f);
      if (!v.ok) throw new Error(`The standard format of ${t} is not valid: ${v.problems[0].message}`);
      insert.run(t, `${t}_STANDARD`, f.name, f.html, f.css, JSON.stringify(v.variables), '2026-01-01T00:00:00.000Z');
    }
  }

  // ---- presenting ----
  const typeRow = (t) => ({ code: t, label: CATALOGUE[t].label, labelHi: CATALOGUE[t].labelHi, owner: CATALOGUE[t].owner, sensitive: Boolean(CATALOGUE[t].sensitive), entity: CATALOGUE[t].entity });
  const templateRow = (r, { full = false } = {}) => ({
    id: r.id, docType: r.doc_type, typeLabel: CATALOGUE[r.doc_type]?.label ?? r.doc_type, code: r.code, version: r.template_version, name: r.name, status: r.status, isDefault: r.is_default === 1, shared: r.company_id === null, orientation: r.orientation,
    owner: CATALOGUE[r.doc_type]?.owner ?? null, changeNote: r.change_note, instanceId: r.instance_id, approvedBy: r.approved_by, approvedAt: r.approved_at, effectiveFrom: r.effective_from, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, rowVersion: r.version,
    ...(full ? { html: r.html, css: r.css, brand: JSON.parse(r.brand_json || '{}'), variables: JSON.parse(r.variables_json || '[]') } : {}),
  });

  const templates = {
    list(actor, q = {}) {
      if (!may(actor, 'tpl.template.view')) throw forbidden('You may not see the templates (permission tpl.template.view).');
      const where = ['(t.company_id = :c OR t.company_id IS NULL)', 't.is_active = 1'];
      const p = { c: actor.companyId };
      if (q.docType) { where.push('t.doc_type = :dt'); p.dt = q.docType; }
      if (q.status) { where.push('t.status = :st'); p.st = q.status; }
      if (q.q) { where.push("(t.code LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')"); p.q = `%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`; }
      const rows = db.prepare(`SELECT t.* FROM tpl_templates t WHERE ${where.join(' AND ')} ORDER BY t.doc_type, t.code, t.template_version DESC`).all(p);
      // a company's own row hides a shared row of the same code and version order: the page shows both, marked
      const total = rows.length;
      const limit = Math.min(Number(q.limit) || 50, 100);
      const offset = Number(q.offset) || 0;
      return { rows: rows.slice(offset, offset + limit).map((r) => templateRow(r)), total, limit, offset, docTypes: DOC_TYPES.map(typeRow), canEdit: may(actor, 'tpl.template.edit') };
    },
    get(actor, id) {
      if (!may(actor, 'tpl.template.view')) throw forbidden('You may not see the templates (permission tpl.template.view).');
      const r = db.prepare('SELECT * FROM tpl_templates WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND is_active = 1').get(id, actor.companyId);
      if (!r) throw notFound('That template does not exist.');
      const versions = db.prepare('SELECT * FROM tpl_templates WHERE code = ? AND COALESCE(company_id, 0) = COALESCE(?, 0) AND is_active = 1 ORDER BY template_version DESC').all(r.code, r.company_id).map((x) => templateRow(x));
      return { ...templateRow(r, { full: true }), versions, canEdit: may(actor, 'tpl.template.edit'), variablesCatalogue: variablesOf(r.doc_type) };
    },
    catalogue(actor, docType) {
      if (!may(actor, 'tpl.template.view')) throw forbidden('You may not see the templates (permission tpl.template.view).');
      if (!CATALOGUE[docType]) throw notFound(`${docType} is not a document type of the library.`);
      return { ...typeRow(docType), variables: variablesOf(docType), groups: Object.fromEntries(Object.entries(CATALOGUE[docType].groups).map(([k, g]) => [k, g.label])), standard: standardFormat(docType), baseCss: BASE_CSS };
    },
    validate(actor, body) {
      if (!may(actor, 'tpl.template.view')) throw forbidden('You may not see the templates (permission tpl.template.view).');
      return validate(body.docType, body);
    },
    /** Create a draft: a new code, or the next version of a code (the company's own copy of a shared format). Only one draft of a code at a time. */
    create(actor, b) {
      if (!may(actor, 'tpl.template.edit')) throw forbidden('You may not change templates (permission tpl.template.edit).');
      if (!CATALOGUE[b.docType]) throw badRequest(`${b.docType} is not a document type of the library.`, [{ field: 'docType', message: 'Choose a document type of the library.' }]);
      const v = validate(b.docType, b);
      if (!v.ok) throw unprocessable('The template is not valid.', v.problems.map((p) => ({ field: p.variable ? 'html' : 'html', message: `Line ${p.line}: ${p.message}` })));
      const brand = brandOf(b.brand);
      return transaction(db, () => {
        const exists = db.prepare('SELECT MAX(template_version) AS v FROM tpl_templates WHERE COALESCE(company_id, 0) IN (0, ?) AND code = ?').get(actor.companyId, b.code);
        const own = db.prepare("SELECT 1 FROM tpl_templates WHERE company_id = ? AND code = ? AND status IN ('DRAFT', 'IN_REVIEW') AND is_active = 1").get(actor.companyId, b.code);
        if (own) throw conflict(`A change of ${b.code} is already a draft or waiting for approval. Finish or cancel it first.`);
        const sharedDoc = db.prepare('SELECT doc_type FROM tpl_templates WHERE COALESCE(company_id, 0) IN (0, ?) AND code = ? LIMIT 1').get(actor.companyId, b.code);
        if (sharedDoc && sharedDoc.doc_type !== b.docType) throw conflict(`${b.code} is a template of ${sharedDoc.doc_type}; a code belongs to one document type.`);
        const version = (exists?.v ?? 0) + 1;
        const res = db.prepare(`INSERT INTO tpl_templates (company_id, doc_type, code, template_version, name, html, css, orientation, brand_json, variables_json, status, is_default, change_note, effective_from, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 0, ?, ?, ?, 'template_editor')`).run(actor.companyId, b.docType, b.code, version, b.name, b.html, b.css ?? '', b.orientation ?? 'portrait', JSON.stringify(brand), JSON.stringify(v.variables), b.changeNote ?? null, b.effectiveFrom ?? null, actor.user);
        const id = Number(res.lastInsertRowid);
        writeAudit(db, { entity: 'tpl_templates', entityId: id, action: 'create', newValues: { code: b.code, version, docType: b.docType }, actor: actor.user, companyId: actor.companyId });
        return templates.get(actor, id);
      });
    },
    update(actor, id, b) {
      if (!may(actor, 'tpl.template.edit')) throw forbidden('You may not change templates (permission tpl.template.edit).');
      return transaction(db, () => {
        const r = db.prepare('SELECT * FROM tpl_templates WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
        if (!r) throw notFound('That template does not exist, or it is a shared standard format; make your own copy first.');
        if (r.status !== 'DRAFT') throw conflict(`This template is ${r.status.toLowerCase().replace('_', ' ')}; only a draft can be changed. Start a new version.`);
        if (b.rowVersion != null && b.rowVersion !== r.version) throw conflict('Someone else changed this draft. Reload it to see their changes.');
        const merged = { docType: r.doc_type, html: b.html ?? r.html, css: b.css ?? r.css };
        const v = validate(r.doc_type, merged);
        if (!v.ok) throw unprocessable('The template is not valid.', v.problems.map((p) => ({ field: 'html', message: `Line ${p.line}: ${p.message}` })));
        const brand = b.brand ? brandOf(b.brand) : JSON.parse(r.brand_json || '{}');
        db.prepare('UPDATE tpl_templates SET name = ?, html = ?, css = ?, orientation = ?, brand_json = ?, variables_json = ?, change_note = ?, effective_from = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(b.name ?? r.name, merged.html, merged.css, b.orientation ?? r.orientation, JSON.stringify(brand), JSON.stringify(v.variables), b.changeNote ?? r.change_note, b.effectiveFrom === undefined ? r.effective_from : b.effectiveFrom, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'tpl_templates', entityId: id, action: 'update', oldValues: { html: r.html.length, css: r.css.length }, newValues: { html: merged.html.length, css: merged.css.length }, actor: actor.user, companyId: actor.companyId });
        return templates.get(actor, id);
      });
    },
    /** BR-01: the maker sends the draft; the process owner of the document type approves it. */
    submit(actor, id) {
      if (!may(actor, 'tpl.template.edit')) throw forbidden('You may not change templates (permission tpl.template.edit).');
      return transaction(db, () => {
        const r = db.prepare('SELECT * FROM tpl_templates WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
        if (!r) throw notFound('That template does not exist.');
        if (r.status !== 'DRAFT') throw conflict(`This template is ${r.status.toLowerCase().replace('_', ' ')}; only a draft is sent for approval.`);
        const v = validate(r.doc_type, r);
        if (!v.ok) throw unprocessable('The template has problems and cannot be sent for approval.', v.problems.map((p) => ({ field: 'html', message: `Line ${p.line}: ${p.message}` })));
        // a trial with the sample record proves that it draws
        const sample = compute(r.doc_type, sampleOf(r.doc_type));
        render(r.doc_type, r.html, { data: sample.data });
        db.prepare("UPDATE tpl_templates SET status = 'IN_REVIEW', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        const instance = engine.submit(actor, { docType: TEMPLATE_DOC, docId: id, comment: r.change_note ?? `Template ${r.code} version ${r.template_version}`, context: { ownerRole: CATALOGUE[r.doc_type].owner, docType: r.doc_type } });
        db.prepare('UPDATE tpl_templates SET instance_id = ? WHERE id = ?').run(instance.id, id);
        writeAudit(db, { entity: 'tpl_templates', entityId: id, action: 'submit', newValues: { instanceId: instance.id, owner: CATALOGUE[r.doc_type].owner }, actor: actor.user, companyId: actor.companyId });
        return { ...templates.get(actor, id), workflow: instance };
      });
    },
    discard(actor, id) {
      if (!may(actor, 'tpl.template.edit')) throw forbidden('You may not change templates (permission tpl.template.edit).');
      return transaction(db, () => {
        const r = db.prepare('SELECT * FROM tpl_templates WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
        if (!r) throw notFound('That template does not exist.');
        if (r.status !== 'DRAFT') throw conflict('Only a draft can be discarded.');
        db.prepare("UPDATE tpl_templates SET is_active = 0, deleted_at = ?, deleted_by = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, id);
        writeAudit(db, { entity: 'tpl_templates', entityId: id, action: 'discard', actor: actor.user, companyId: actor.companyId });
        return { id, discarded: true };
      });
    },
    // the hooks of the approval
    activate(instance, actor) {
      const r = db.prepare('SELECT * FROM tpl_templates WHERE id = ?').get(Number(instance.docId));
      if (!r) return;
      const stamp = nowIso();
      db.prepare("UPDATE tpl_templates SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE COALESCE(company_id, 0) = COALESCE(?, 0) AND code = ? AND status = 'ACTIVE'").run(actor.user, stamp, r.company_id, r.code);
      db.prepare("UPDATE tpl_templates SET status = 'ACTIVE', approved_by = ?, approved_at = ?, effective_from = COALESCE(effective_from, ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, stamp, today(), actor.user, stamp, r.id);
      writeAudit(db, { entity: 'tpl_templates', entityId: r.id, action: 'activate', newValues: { code: r.code, version: r.template_version }, actor: actor.user, companyId: r.company_id });
      publishEvent(db, { type: 'tpl.template.activated', entity: 'document_template', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { code: r.code, version: r.template_version, docType: r.doc_type } });
    },
    backToMaker(instance, status) {
      db.prepare("UPDATE tpl_templates SET status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'IN_REVIEW'").run(status, nowIso(), Number(instance.docId));
    },
    /** The active template of a type for production, on the day: a company's own first, then the shared standard. */
    pick(companyId, docType, code = null) {
      const where = code ? 'AND code = :code' : 'AND doc_type = :dt';
      const rows = db.prepare(`SELECT * FROM tpl_templates WHERE (company_id = :c OR company_id IS NULL) AND status = 'ACTIVE' AND is_active = 1 AND (effective_from IS NULL OR effective_from <= :today) ${where} ORDER BY company_id IS NULL, is_default DESC, template_version DESC`).all({ c: companyId, today: today(), ...(code ? { code } : { dt: docType }) });
      const own = rows.filter((r) => r.company_id !== null);
      return (own.find((r) => r.is_default === 1) ?? own[0] ?? rows[0]) || null;
    },
  };

  // ---- the data of the documents ----
  const maskRecord = (actor, docType, data, scope) => {
    if (may(actor, 'tpl.document.generate_sensitive', scope)) return data;
    const copy = JSON.parse(JSON.stringify(data));
    for (const k of SENSITIVE_KEYS(CATALOGUE[docType])) {
      const parts = k.split('.');
      let o = copy;
      for (const p of parts.slice(0, -1)) o = o?.[p];
      if (o && parts[parts.length - 1] in o) o[parts[parts.length - 1]] = '••••';
    }
    return copy;
  };
  const recordRow = (actor, r) => ({ id: r.id, docType: r.doc_type, entityId: r.entity_id, docNo: r.doc_no, approved: r.approved === 1, sample: r.is_sample === 1, projectId: r.project_id, version: r.record_version, updatedAt: r.updated_at ?? r.created_at, data: maskRecord(actor, r.doc_type, JSON.parse(r.data_json), { companyId: r.company_id, projectId: r.project_id ?? undefined, siteId: r.site_id ?? undefined }) });
  const records = {
    /** A module hands over the approved data of a document (an adapter until the module publishes its own source). The totals are recomputed here and a different total sent is refused. */
    publish(actor, b) {
      if (!may(actor, 'tpl.record.publish', { companyId: actor.companyId, projectId: b.projectId ?? undefined, siteId: b.siteId ?? undefined })) throw forbidden('You may not publish data for documents (permission tpl.record.publish).');
      const cat = CATALOGUE[b.docType];
      if (!cat) throw badRequest(`${b.docType} is not a document type of the library.`, [{ field: 'docType', message: 'Choose a document type of the library.' }]);
      const { data, problems } = compute(b.docType, b.data);
      if (problems.length) throw unprocessable('The data of the document is not valid.', problems.map((p) => ({ field: p.field, message: p.message })));
      return transaction(db, () => {
        const old = db.prepare('SELECT * FROM tpl_records WHERE company_id = ? AND doc_type = ? AND entity_id = ?').get(actor.companyId, b.docType, b.entityId);
        const docNo = b.docNo ?? data.docNo;
        if (!docNo) throw badRequest('The document needs a number.', [{ field: 'docNo', message: 'Give the number of the document.' }]);
        data.docNo = docNo;
        if (old) {
          if (db.prepare('SELECT 1 FROM tpl_generated_docs WHERE company_id = ? AND doc_type = ? AND entity_id = ? AND is_current = 1').get(actor.companyId, b.docType, b.entityId) && JSON.stringify(JSON.parse(old.data_json)) !== JSON.stringify(data) && !b.reason) throw conflict('An official document was already generated from this record. Give a reason for changing its data; generate a new version after that.');
          db.prepare('UPDATE tpl_records SET doc_no = ?, data_json = ?, approved = ?, is_sample = ?, project_id = ?, site_id = ?, record_version = record_version + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
            .run(docNo, JSON.stringify(data), b.approved ? 1 : 0, b.sample ? 1 : 0, b.projectId ?? null, b.siteId ?? null, actor.user, nowIso(), old.id);
        } else {
          db.prepare("INSERT INTO tpl_records (company_id, doc_type, entity_id, doc_no, data_json, approved, is_sample, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'publish')")
            .run(actor.companyId, b.docType, b.entityId, docNo, JSON.stringify(data), b.approved ? 1 : 0, b.sample ? 1 : 0, b.projectId ?? null, b.siteId ?? null, actor.user);
        }
        const row = db.prepare('SELECT * FROM tpl_records WHERE company_id = ? AND doc_type = ? AND entity_id = ?').get(actor.companyId, b.docType, b.entityId);
        writeAudit(db, { entity: 'tpl_records', entityId: row.id, action: old ? 'update' : 'create', newValues: { docType: b.docType, entityId: b.entityId, approved: b.approved }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        publishEvent(db, { type: 'tpl.record.published', entity: 'document_record', entityId: row.id, actorId: actor.user, companyId: actor.companyId, projectId: row.project_id, siteId: row.site_id, data: { docType: b.docType, entityId: b.entityId, docNo } });
        return recordRow(actor, row);
      });
    },
    list(actor, q = {}) {
      if (!anywhere(actor, 'tpl.document.generate') && !anywhere(actor, 'tpl.template.view')) throw forbidden('You may not see the records documents are made from (permission tpl.document.generate).');
      const where = ['r.company_id = :c', 'r.is_active = 1'];
      const p = { c: actor.companyId };
      if (q.docType) { where.push('r.doc_type = :dt'); p.dt = q.docType; }
      if (q.approved === '1') where.push('r.approved = 1');
      if (q.q) { where.push("(r.doc_no LIKE :q ESCAPE '\\' OR r.entity_id LIKE :q ESCAPE '\\')"); p.q = `%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`; }
      const scope = authz.scopeFilter(actor, 'tpl.document.generate', { project: 'r.project_id', site: 'r.site_id' }).sql;
      const rows = db.prepare(`SELECT r.* FROM tpl_records r WHERE ${where.join(' AND ')} AND ${scope} ORDER BY r.updated_at DESC, r.id DESC LIMIT :lim`).all({ ...p, lim: Math.min(Number(q.limit) || 50, 200) });
      return { rows: rows.map((r) => recordRow(actor, r)) };
    },
    get(actor, id) {
      const r = db.prepare('SELECT * FROM tpl_records WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      if (!r || !may(actor, 'tpl.document.generate', { companyId: r.company_id, projectId: r.project_id ?? undefined, siteId: r.site_id ?? undefined })) throw notFound('That record does not exist.');
      return recordRow(actor, r);
    },
  };
  /** The data of one document through its source: { data, docNo, approved, sample, projectId, siteId, recordId } or null. */
  function load(companyId, docType, entityId, actor) {
    const src = templateSources.get(docType);
    if (src) { const r = src.load(db, actor, entityId); return r ? { sample: false, recordId: null, ...r } : null; }
    const r = db.prepare('SELECT * FROM tpl_records WHERE company_id = ? AND doc_type = ? AND entity_id = ? AND is_active = 1').get(companyId, docType, String(entityId));
    return r ? { data: JSON.parse(r.data_json), docNo: r.doc_no, approved: r.approved === 1, sample: r.is_sample === 1, projectId: r.project_id, siteId: r.site_id, recordId: r.id } : null;
  }

  // ---- the system variables, the QR code, the PDF ----
  const brandOf = (b) => {
    const brand = { address: String(b?.address ?? '').slice(0, 300), phone: String(b?.phone ?? '').slice(0, 40), email: String(b?.email ?? '').slice(0, 120), footerNote: String(b?.footerNote ?? '').slice(0, 200), logo: '' };
    if (b?.logo) {
      if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(b.logo) || b.logo.length > 200_000) throw badRequest('The logo must be a PNG or JPEG picture of at most 150 KB.', [{ field: 'brand.logo', message: 'Use a PNG or JPEG of at most 150 KB.' }]);
      brand.logo = b.logo;
    }
    return brand;
  };
  const verifyUrl = (code) => (publicUrl ? `${publicUrl.replace(/\/$/, '')}/verify/${code}` : `ERP:${VERIFY_QR}:${code}`);
  async function pictureTags(brand, code) {
    const qr = await QRCode.toDataURL(verifyUrl(code), { margin: 0, width: 220, errorCorrectionLevel: 'M' });
    let logo = '';
    if (brand.logo) {
      const m = await sharp(Buffer.from(brand.logo.split(',')[1], 'base64')).metadata();
      logo = `<img src="${brand.logo}" width="${Math.round((34 * (m.width ?? 1)) / (m.height ?? 1))}" height="34">`;
    }
    return { qr: `<img src="${qr}" width="54" height="54">`, logo };
  }
  const companyOf = (companyId) => db.prepare('SELECT legal_name, gstin_primary, pan FROM org_companies WHERE id = ?').get(companyId) ?? {};
  const projectOf = (id) => (id ? db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(id) : null);
  function systemVars({ tpl, companyId, record, code, version, label, by }) {
    const co = companyOf(companyId);
    const brand = JSON.parse(tpl.brand_json || '{}');
    const pr = projectOf(record.projectId);
    return {
      company: { name: co.legal_name ?? '', gstin: co.gstin_primary ?? '', pan: co.pan ?? '', address: brand.address ?? '', phone: brand.phone ?? '', email: brand.email ?? '', footerNote: brand.footerNote ?? '' },
      project: { name: pr?.name ?? '', code: pr?.code ?? '' }, docNo: record.docNo, docDate: record.data?.docDate ?? '', generatedAt: nowIso(), generatedBy: by, verifyCode: code, verifyUrl: verifyUrl(code), version, copyLabel: label,
    };
  }
  async function makePdf(tpl, companyId, record, data, { code, version, label, by, preview = false, pdfa = false }) {
    const brand = JSON.parse(tpl.brand_json || '{}');
    const pictures = await pictureTags(brand, code);
    const system = systemVars({ tpl, companyId, record: { ...record, data }, code, version, label, by });
    const html = render(tpl.doc_type, tpl.html, { data, system, ...pictures });
    return renderPdf(documentHtml(html), { css: `${BASE_CSS}\n${tpl.css ?? ''}`, orientation: tpl.orientation, title: `${CATALOGUE[tpl.doc_type].label} ${record.docNo}`, author: system.company.name || 'Construction ERP', subject: `${CATALOGUE[tpl.doc_type].label} version ${version}`, pdfa, watermark: preview ? 'PREVIEW' : null, created: engine.clock() });
  }

  const authoriseGenerate = (actor, docType, rec) => {
    const scope = { companyId: actor.companyId, projectId: rec.projectId ?? undefined, siteId: rec.siteId ?? undefined };
    if (!may(actor, 'tpl.document.generate', scope)) throw forbidden('You may not generate documents here (permission tpl.document.generate).');
    if (CATALOGUE[docType].sensitive && !may(actor, 'tpl.document.generate_sensitive', scope)) throw forbidden(`${CATALOGUE[docType].label} carries pay and identity data; you need the permission tpl.document.generate_sensitive.`);
  };

  /** A picture of the document before it is final (FR-04): from a template draft or version, with the sample record or a real record; watermarked PREVIEW and never stored. */
  async function preview(actor, b) {
    if (!may(actor, 'tpl.template.view')) throw forbidden('You may not see the templates (permission tpl.template.view).');
    let tpl = b.templateId ? db.prepare('SELECT * FROM tpl_templates WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND is_active = 1').get(b.templateId, actor.companyId) : null;
    if (b.templateId && !tpl) throw notFound('That template does not exist.');
    const docType = tpl?.doc_type ?? b.docType;
    if (!CATALOGUE[docType]) throw badRequest('Choose a document type.', [{ field: 'docType', message: 'Choose a document type of the library.' }]);
    tpl = { ...(tpl ?? {}), doc_type: docType, html: b.html ?? tpl?.html, css: b.css ?? tpl?.css ?? '', orientation: b.orientation ?? tpl?.orientation ?? 'portrait', brand_json: JSON.stringify(b.brand ? brandOf(b.brand) : JSON.parse(tpl?.brand_json || '{}')) };
    if (!tpl.html) throw badRequest('There is no template to preview.', [{ field: 'html', message: 'Write the template first.' }]);
    const v = validate(docType, tpl);
    if (!v.ok) throw unprocessable('The template is not valid.', v.problems.map((p) => ({ field: 'html', message: `Line ${p.line}: ${p.message}` })));
    let rec;
    if (b.recordId) {
      const row = db.prepare('SELECT * FROM tpl_records WHERE id = ? AND company_id = ? AND doc_type = ? AND is_active = 1').get(b.recordId, actor.companyId, docType);
      if (!row) throw notFound('That record does not exist.');
      rec = { data: JSON.parse(row.data_json), docNo: row.doc_no, projectId: row.project_id, siteId: row.site_id };
      authoriseGenerate(actor, docType, rec);
    } else rec = { data: sampleOf(docType), docNo: 'PREVIEW', projectId: null, siteId: null };
    const { data, problems } = compute(docType, rec.data);
    if (problems.length) throw unprocessable('The record cannot be printed.', problems.map((p) => ({ field: p.field, message: p.message })));
    const out = await makePdf(tpl, actor.companyId, rec, data, { code: 'PREVIEW', version: 0, label: 'PREVIEW - NOT AN OFFICIAL DOCUMENT', by: actor.user, preview: true });
    writeAudit(db, { entity: 'tpl_templates', entityId: tpl.id ?? 0, action: 'preview', newValues: { docType, record: b.recordId ?? 'sample' }, actor: actor.user, companyId: actor.companyId });
    return { buffer: out.buffer, pages: out.pages, fileName: `preview-${docType}.pdf` };
  }

  // ---- generating official documents (FR-04, FR-05, BR-02) ----
  const genRow = (g, extra = {}) => ({
    id: g.id, docType: g.doc_type, typeLabel: CATALOGUE[g.doc_type]?.label ?? g.doc_type, entity: g.entity, entityId: g.entity_id, docNo: g.doc_number, version: g.version_no, current: g.is_current === 1, supersededBy: g.superseded_by, purpose: g.purpose, reason: g.reason,
    templateId: g.template_id, templateCode: g.template_code, templateVersion: g.template_version, fileId: g.file_id, hash: g.hash, pages: g.pages, pdfa: g.pdfa === 1, verifyCode: g.verify_code, generatedBy: g.generated_by, generatedAt: g.generated_at,
    projectId: g.project_id, projectName: g.project_name ?? null, size: g.size_bytes ?? null, deliveries: g.deliveries ?? 0, ...extra,
  });
  const GEN_SELECT = `SELECT g.*, t.code AS template_code, t.template_version AS template_version, f.size_bytes, p.name AS project_name, (SELECT COUNT(*) FROM tpl_deliveries d WHERE d.generated_doc_id = g.id AND d.channel <> 'DOWNLOAD') AS deliveries
    FROM tpl_generated_docs g JOIN tpl_templates t ON t.id = g.template_id JOIN core_files f ON f.id = g.file_id LEFT JOIN org_projects p ON p.id = g.project_id`;

  /** One document. `internal` is for the background job and the milestone rules: permissions were checked when they were asked for. */
  async function generateOne(actor, b, { internal = false, bulkJobId = null } = {}) {
    const cat = CATALOGUE[b.docType];
    if (!cat) throw badRequest(`${b.docType} is not a document type of the library.`, [{ field: 'docType', message: 'Choose a document type of the library.' }]);
    const rec = load(actor.companyId, b.docType, b.entityId, actor);
    if (!rec) throw notFound('There is no record with that number to print.');
    if (!internal) authoriseGenerate(actor, b.docType, rec);
    if (rec.sample) throw unprocessable('This is a sample record. An official document is made only from real, approved data.');
    if (!rec.approved) throw unprocessable('This record is not approved. An official document is generated only from approved data.');
    const { data, problems } = compute(b.docType, rec.data);
    if (problems.length) throw unprocessable('The data cannot be printed: it does not pass the checks.', problems.map((p) => ({ field: p.field, message: p.message })));
    const tpl = templates.pick(actor.companyId, b.docType, b.templateCode ?? null);
    if (!tpl) throw conflict(`There is no approved template for ${cat.label}${b.templateCode ? ` with the code ${b.templateCode}` : ''}. Only approved templates are used for official documents.`);
    if (tpl.doc_type !== b.docType) throw unprocessable(`The template ${tpl.code} is for ${tpl.doc_type}, not ${b.docType}.`);
    const entityId = String(b.entityId);
    const prev = db.prepare('SELECT * FROM tpl_generated_docs WHERE company_id = ? AND doc_type = ? AND entity_id = ? AND is_current = 1').get(actor.companyId, b.docType, entityId);
    if (prev && (!b.reason || b.reason.trim().length < 5)) throw conflict(`An official document ${prev.doc_number} version ${prev.version_no} already exists. Give a reason (at least 5 characters) to generate a new version; the earlier version is kept.`, [{ field: 'reason', message: 'Give a reason to generate a new version.' }]);
    const version = (db.prepare('SELECT MAX(version_no) AS v FROM tpl_generated_docs WHERE company_id = ? AND doc_type = ? AND entity_id = ?').get(actor.companyId, b.docType, entityId).v ?? 0) + 1;
    const code = newVerifyCode();
    const label = version === 1 ? 'ORIGINAL' : `REGENERATED v${version}`;
    const purpose = b.purpose ?? 'OFFICIAL';
    const out = await makePdf(tpl, actor.companyId, { ...rec, docNo: rec.docNo }, data, { code, version, label, by: actor.user, pdfa: Boolean(b.pdfa) || purpose === 'ARCHIVAL' });
    const hash = sha256(out.buffer);
    const day = engine.clock();
    const key = `c${actor.companyId}/tpl/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.pdf`;
    await storage.putBuffer(key, out.buffer);
    try {
      return transaction(db, () => {
        const clash = db.prepare('SELECT MAX(version_no) AS v FROM tpl_generated_docs WHERE company_id = ? AND doc_type = ? AND entity_id = ?').get(actor.companyId, b.docType, entityId).v ?? 0;
        if (clash !== version - 1) throw conflict('Someone generated this document at the same moment. Try again.');
        const f = db.prepare(`INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, scanned_at, linked_entity, linked_id, version_no, retention_class, project_id, site_id, created_by, source_type)
          VALUES (?, ?, ?, 'pdf', 'application/pdf', 'document', ?, ?, 'CLEAN', ?, 'tpl_generated', 0, 1, ?, ?, ?, ?, 'tpl_generate')`)
          .run(actor.companyId, key, `${safeName(rec.docNo)}_v${version}.pdf`, out.buffer.length, hash, nowIso(), purpose === 'ARCHIVAL' ? 'permanent' : 'statutory', rec.projectId ?? null, rec.siteId ?? null, actor.user);
        const fileId = Number(f.lastInsertRowid);
        const res = db.prepare(`INSERT INTO tpl_generated_docs (company_id, template_id, doc_type, entity, entity_id, doc_number, version_no, file_id, hash, pages, pdfa, purpose, reason, verify_code, bulk_job_id, generated_by, generated_at, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tpl_generate', ?)`)
          .run(actor.companyId, tpl.id, b.docType, cat.entity, entityId, rec.docNo, version, fileId, hash, out.pages, Boolean(b.pdfa) || purpose === 'ARCHIVAL' ? 1 : 0, purpose, b.reason ?? null, code, bulkJobId, actor.user, nowIso(), rec.projectId ?? null, rec.siteId ?? null, actor.user, rec.recordId == null ? null : String(rec.recordId));
        const id = Number(res.lastInsertRowid);
        db.prepare('UPDATE core_files SET linked_id = ? WHERE id = ?').run(id, fileId);
        if (prev) db.prepare('UPDATE tpl_generated_docs SET is_current = 0, superseded_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(id, actor.user, nowIso(), prev.id);
        writeAudit(db, { entity: 'tpl_generated_docs', entityId: id, action: 'generate', newValues: { docType: b.docType, docNo: rec.docNo, version, template: `${tpl.code} v${tpl.template_version}`, hash, purpose }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        publishEvent(db, { type: 'tpl.document.generated', entity: 'generated_document', entityId: id, actorId: actor.user, companyId: actor.companyId, projectId: rec.projectId ?? null, siteId: rec.siteId ?? null, data: { docType: b.docType, docNo: rec.docNo, version, fileId, verifyCode: code, purpose } });
        return generated.row(id);
      });
    } catch (e) {
      await storage.remove?.(key);
      throw e;
    }
  }

  const generated = {
    row(id) { return genRow(db.prepare(`${GEN_SELECT} WHERE g.id = ?`).get(id)); },
    /** Visibility of a generated document: the right to see them inside the person's scope, or whoever generated it. */
    visible(actor, g) {
      if (g.company_id !== actor.companyId) return false;
      if (g.generated_by === actor.user && may(actor, 'tpl.document.view')) return true;
      return may(actor, 'tpl.document.view', { companyId: g.company_id, projectId: g.project_id ?? undefined, siteId: g.site_id ?? undefined })
        && (!CATALOGUE[g.doc_type]?.sensitive || may(actor, 'tpl.document.generate_sensitive', { companyId: g.company_id, projectId: g.project_id ?? undefined, siteId: g.site_id ?? undefined }));
    },
    list(actor, q = {}) {
      if (!anywhere(actor, 'tpl.document.view')) throw forbidden('You may not see generated documents (permission tpl.document.view).');
      const where = ['g.company_id = :c', 'g.is_active = 1'];
      const p = { c: actor.companyId };
      if (q.docType) { where.push('g.doc_type = :dt'); p.dt = q.docType; }
      if (q.projectId) { where.push('g.project_id = :pj'); p.pj = q.projectId; }
      if (q.purpose) { where.push('g.purpose = :pu'); p.pu = q.purpose; }
      if (q.current === '1') where.push('g.is_current = 1');
      if (q.bulkJobId) { where.push('g.bulk_job_id = :bj'); p.bj = q.bulkJobId; }
      if (q.from) { where.push('g.generated_at >= :from'); p.from = `${q.from}T00:00:00.000Z`; }
      if (q.to) { where.push('g.generated_at <= :to'); p.to = `${q.to}T23:59:59.999Z`; }
      if (q.q) { where.push("(g.doc_number LIKE :q ESCAPE '\\' OR g.verify_code LIKE :q ESCAPE '\\' OR g.generated_by LIKE :q ESCAPE '\\')"); p.q = `%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`; }
      const scope = authz.scopeFilter(actor, 'tpl.document.view', { project: 'g.project_id', site: 'g.site_id' }).sql;
      const sensitive = `(g.doc_type NOT IN (${DOC_TYPES.filter((t) => CATALOGUE[t].sensitive).map((t) => `'${t}'`).join(', ')}) OR ${authz.scopeFilter(actor, 'tpl.document.generate_sensitive', { project: 'g.project_id', site: 'g.site_id' }).sql})`;
      const w = `${where.join(' AND ')} AND (${scope} OR g.generated_by = :me) AND ${sensitive}`;
      p.me = actor.user;
      const sorts = { newest: 'g.generated_at DESC, g.id DESC', oldest: 'g.generated_at ASC, g.id ASC', number: 'g.doc_number ASC, g.version_no DESC', type: 'g.doc_type ASC, g.generated_at DESC' };
      const total = db.prepare(`SELECT COUNT(*) AS n FROM tpl_generated_docs g WHERE ${w}`).get(p).n;
      const limit = [25, 50, 100].includes(Number(q.limit)) ? Number(q.limit) : 25;
      const offset = Math.max(0, Number(q.offset) || 0);
      const rows = db.prepare(`${GEN_SELECT} WHERE ${w} ORDER BY ${sorts[q.sort] ?? sorts.newest} LIMIT :lim OFFSET :off`).all({ ...p, lim: limit, off: offset }).map((g) => genRow(g));
      const byType = db.prepare(`SELECT g.doc_type AS docType, COUNT(*) AS n FROM tpl_generated_docs g WHERE ${w} GROUP BY g.doc_type ORDER BY n DESC`).all(p).map((r) => ({ ...r, label: CATALOGUE[r.docType]?.label ?? r.docType }));
      const byDay = db.prepare(`SELECT substr(g.generated_at, 1, 10) AS day, COUNT(*) AS n FROM tpl_generated_docs g WHERE ${w} GROUP BY day ORDER BY day DESC LIMIT 30`).all(p).reverse();
      const delivered = db.prepare(`SELECT COUNT(*) AS n FROM tpl_deliveries d JOIN tpl_generated_docs g ON g.id = d.generated_doc_id WHERE d.channel <> 'DOWNLOAD' AND ${w}`).get(p).n;
      return { rows, total, limit, offset, summary: { total, byType, byDay, delivered }, docTypes: DOC_TYPES.map(typeRow), canGenerate: anywhere(actor, 'tpl.document.generate'), canDeliver: anywhere(actor, 'tpl.document.deliver') };
    },
    get(actor, id) {
      const g = db.prepare(`${GEN_SELECT} WHERE g.id = ? AND g.is_active = 1`).get(id);
      if (!g || !generated.visible(actor, g)) throw notFound('That document does not exist.');
      const versions = db.prepare('SELECT id, version_no, is_current, generated_at, generated_by, reason, hash FROM tpl_generated_docs WHERE company_id = ? AND doc_type = ? AND entity_id = ? ORDER BY version_no DESC').all(g.company_id, g.doc_type, g.entity_id)
        .map((v) => ({ id: v.id, version: v.version_no, current: v.is_current === 1, generatedAt: v.generated_at, generatedBy: v.generated_by, reason: v.reason, hash: v.hash }));
      const deliveries = db.prepare('SELECT * FROM tpl_deliveries WHERE generated_doc_id = ? ORDER BY id DESC').all(id).map(deliveryRow);
      return { ...genRow(g), versions, deliveries, canDeliver: may(actor, 'tpl.document.deliver', { companyId: g.company_id, projectId: g.project_id ?? undefined, siteId: g.site_id ?? undefined }), verifyUrl: verifyUrl(g.verify_code) };
    },
    /** The PDF for a person who may see it; each opening is written to the audit trail and to the delivery log (13: print). */
    async content(actor, id, { download = false } = {}) {
      const g = db.prepare('SELECT * FROM tpl_generated_docs WHERE id = ? AND is_active = 1').get(id);
      if (!g || !generated.visible(actor, g)) throw notFound('That document does not exist.');
      const f = db.prepare('SELECT * FROM core_files WHERE id = ?').get(g.file_id);
      const total = await storage.size(f.storage_key);
      if (total === null) throw notFound('The stored file is missing. Tell an administrator.');
      db.prepare("INSERT INTO tpl_deliveries (company_id, generated_doc_id, channel, recipient, status, sent_at, project_id, site_id, created_by, source_type) VALUES (?, ?, 'DOWNLOAD', ?, 'DOWNLOADED', ?, ?, ?, ?, 'tpl_download')").run(g.company_id, g.id, actor.user, nowIso(), g.project_id, g.site_id, actor.user);
      writeAudit(db, { entity: 'tpl_generated_docs', entityId: g.id, action: download ? 'download' : 'print', newValues: { docNo: g.doc_number, version: g.version_no }, actor: actor.user, companyId: g.company_id });
      return { headers: { 'content-type': 'application/pdf', 'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${f.original_name}"`, 'content-length': String(total), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }, stream: storage.createReadStream(f.storage_key) };
    },
    /** A document for a signed link (no sign-in: the link is the proof, as in the file service). */
    async linked(id, query) {
      const bad = signer.check({ id, exp: query.exp, v: 'file', d: 'attachment', sig: query.sig });
      if (bad === 'expired') throw Object.assign(new Error('This download link has expired. Ask the sender for a new one.'), { status: 410, code: 'LINK_EXPIRED' });
      if (bad) throw forbidden('This download link is not valid.');
      const g = db.prepare('SELECT * FROM tpl_generated_docs WHERE id = ? AND is_active = 1').get(id);
      if (!g) throw notFound('That document does not exist.');
      const f = db.prepare('SELECT * FROM core_files WHERE id = ?').get(g.file_id);
      const total = await storage.size(f.storage_key);
      if (total === null) throw notFound('The stored file is missing.');
      db.prepare("INSERT INTO tpl_deliveries (company_id, generated_doc_id, channel, recipient, status, sent_at, project_id, site_id, created_by, source_type) VALUES (?, ?, 'DOWNLOAD', 'signed link', 'DOWNLOADED', ?, ?, ?, 'link', 'tpl_download')").run(g.company_id, g.id, nowIso(), g.project_id, g.site_id);
      return { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${f.original_name}"`, 'content-length': String(total), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }, stream: storage.createReadStream(f.storage_key) };
    },
    /** What anyone who scans the QR code learns: that the document is genuine, which version it is and whether it is still the current one (04.12 builds the full page on this). */
    verify(code) {
      const g = db.prepare('SELECT g.*, c.legal_name FROM tpl_generated_docs g JOIN org_companies c ON c.id = g.company_id WHERE g.verify_code = ?').get(String(code).toUpperCase());
      if (!g) return { valid: false, message: 'No document of this system carries this code.' };
      const f = db.prepare('SELECT sha256 FROM core_files WHERE id = ?').get(g.file_id);
      const sound = f?.sha256 === g.hash;
      return { valid: sound, current: g.is_current === 1, message: !sound ? 'The stored file does not match its record.' : g.is_current === 1 ? 'This is the current, genuine document.' : 'This is a genuine document, but a newer version has replaced it.',
        document: { type: CATALOGUE[g.doc_type]?.label ?? g.doc_type, docNo: g.doc_number, version: g.version_no, issuedBy: g.legal_name, generatedAt: g.generated_at, fingerprint: g.hash.slice(0, 16) } };
    },
  };
  const deliveryRow = (d) => ({ id: d.id, channel: d.channel, recipient: d.recipient, status: d.status, sentAt: d.sent_at, error: d.error, messageId: d.comm_message_id, linkExpiresAt: d.link_expires_at, createdBy: d.created_by, createdAt: d.created_at });

  // ---- delivery (FR-06) ----
  const linkFor = (g) => {
    const l = signer.sign({ id: g.id, ttlSeconds: LINK_DAYS * 86400, variant: 'file', disposition: 'attachment' });
    const path = `/api/v1/tpl/generated/${g.id}/file?exp=${l.exp}&sig=${l.sig}`;
    return { url: publicUrl ? `${publicUrl.replace(/\/$/, '')}${path}` : path, expiresAt: new Date(l.exp * 1000).toISOString() };
  };
  const delivery = {
    send(actor, id, b) {
      const g = db.prepare('SELECT * FROM tpl_generated_docs WHERE id = ? AND is_active = 1').get(id);
      if (!g || !generated.visible(actor, g)) throw notFound('That document does not exist.');
      const scope = { companyId: g.company_id, projectId: g.project_id ?? undefined, siteId: g.site_id ?? undefined };
      if (!may(actor, 'tpl.document.deliver', scope)) throw forbidden('You may not send documents (permission tpl.document.deliver).');
      if (!CHANNELS.includes(b.channel) || b.channel === 'DOWNLOAD') throw badRequest('Choose how to deliver it.', [{ field: 'channel', message: 'Choose e-mail, WhatsApp, message or portal.' }]);
      const label = CATALOGUE[g.doc_type]?.label ?? g.doc_type;
      const link = linkFor(g);
      const results = [];
      for (const to of b.recipients) {
        const stamp = nowIso();
        const ins = db.prepare("INSERT INTO tpl_deliveries (company_id, generated_doc_id, channel, recipient, status, link_expires_at, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, 'tpl_deliver')").run(g.company_id, g.id, b.channel, to, link.expiresAt, g.project_id, g.site_id, actor.user);
        const rowId = Number(ins.lastInsertRowid);
        if (b.channel === 'EMAIL' || b.channel === 'WHATSAPP') {
          const subject = b.subject ?? `${label} ${g.doc_number} (version ${g.version_no})`;
          const body = `${b.message ? `${b.message}\n\n` : ''}${label} ${g.doc_number}, version ${g.version_no}, is attached as a link that is valid for ${LINK_DAYS} days. Its genuineness can be checked with the QR code on the document.`;
          const r = comm.send({ companyId: g.company_id, channel: b.channel, to, subject, body, templateCode: b.channel === 'WHATSAPP' ? 'tpl.document.delivery' : undefined, purpose: 'TRANSACTIONAL', attachments: [{ name: `${g.doc_number}.pdf`, url: link.url }], related: { entity: 'tpl_generated_doc', id: g.id }, actor: actor.user, data: { docNo: g.doc_number, docLabel: label, link: link.url } });
          db.prepare('UPDATE tpl_deliveries SET status = ?, comm_message_id = ?, error = ?, sent_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(r.status === 'BLOCKED' ? 'BLOCKED' : 'QUEUED', r.id, r.status === 'BLOCKED' ? r.message : null, r.status === 'BLOCKED' ? null : stamp, stamp, rowId);
        } else {
          // message (05.01) and portal (M25) belong to other parts: the request is published and stays queued until their consumer takes it
          publishEvent(db, { type: 'tpl.document.delivery_requested', entity: 'generated_document', entityId: g.id, actorId: actor.user, companyId: g.company_id, projectId: g.project_id, siteId: g.site_id, data: { channel: b.channel, recipient: to, deliveryId: rowId, docNo: g.doc_number, fileId: g.file_id, version: g.version_no } });
        }
        results.push(rowId);
      }
      writeAudit(db, { entity: 'tpl_generated_docs', entityId: g.id, action: 'deliver', newValues: { channel: b.channel, recipients: b.recipients.length }, actor: actor.user, companyId: g.company_id });
      publishEvent(db, { type: 'tpl.document.delivered', entity: 'generated_document', entityId: g.id, actorId: actor.user, companyId: g.company_id, projectId: g.project_id, siteId: g.site_id, data: { channel: b.channel, recipients: b.recipients.length, docNo: g.doc_number } });
      return { deliveries: db.prepare(`SELECT * FROM tpl_deliveries WHERE id IN (${results.map(() => '?').join(',')}) ORDER BY id`).all(...results).map(deliveryRow) };
    },
    /** What the gateway reports later (sent, delivered, read, failed) is written back to the delivery log. */
    onMessage(event) {
      const id = Number(event.entityId ?? event.data?.messageId);
      if (!id) return;
      const m = db.prepare('SELECT status, last_error FROM comm_messages WHERE id = ?').get(id);
      if (!m) return;
      const map = { QUEUED: 'QUEUED', SENDING: 'QUEUED', SENT: 'SENT', DELIVERED: 'DELIVERED', READ: 'READ', FAILED: 'FAILED', BLOCKED: 'BLOCKED' };
      db.prepare('UPDATE tpl_deliveries SET status = ?, error = ?, updated_at = ?, version = version + 1 WHERE comm_message_id = ?').run(map[m.status] ?? 'SENT', m.status === 'FAILED' ? m.last_error : null, nowIso(), id);
    },
    list(actor, q = {}) {
      if (!anywhere(actor, 'tpl.document.view')) throw forbidden('You may not see generated documents (permission tpl.document.view).');
      const p = { c: actor.companyId, lim: Math.min(Number(q.limit) || 50, 100) };
      const scope = authz.scopeFilter(actor, 'tpl.document.view', { project: 'd.project_id', site: 'd.site_id' }).sql;
      return { rows: db.prepare(`SELECT d.*, g.doc_number AS doc_no, g.version_no FROM tpl_deliveries d JOIN tpl_generated_docs g ON g.id = d.generated_doc_id WHERE d.company_id = :c AND d.channel <> 'DOWNLOAD' AND ${scope} ORDER BY d.id DESC LIMIT :lim`).all(p).map((d) => ({ ...deliveryRow(d), docNo: d.doc_no, version: d.version_no })) };
    },
  };

  // ---- bulk generation as a background job (FR-04, T-03) ----
  const bulk = {
    async start(actor, b) {
      if (!CATALOGUE[b.docType]) throw badRequest(`${b.docType} is not a document type of the library.`, [{ field: 'docType', message: 'Choose a document type of the library.' }]);
      const ids = [...new Set(b.entityIds.map(String))];
      if (ids.length > BULK_MAX) throw badRequest(`At most ${BULK_MAX} documents can be generated at once.`, [{ field: 'entityIds', message: `Choose at most ${BULK_MAX}.` }]);
      // every record is checked now, with the person's own rights, so the job needs no identity of its own
      const problems = [];
      for (const e of ids) {
        const rec = load(actor.companyId, b.docType, e, actor);
        if (!rec) { problems.push({ field: 'entityIds', message: `${e}: there is no such record.` }); continue; }
        try { authoriseGenerate(actor, b.docType, rec); } catch (er) { problems.push({ field: 'entityIds', message: `${e}: ${er.message}` }); }
        if (!rec.approved || rec.sample) problems.push({ field: 'entityIds', message: `${e}: the record is not approved real data.` });
      }
      if (problems.length) throw unprocessable(`${problems.length} of the ${ids.length} records cannot be printed. Nothing was started.`, problems.slice(0, 20));
      if (!b.templateCode && !templates.pick(actor.companyId, b.docType)) throw conflict(`There is no approved template for ${CATALOGUE[b.docType].label}.`);
      const stamp = nowIso();
      const id = transaction(db, () => {
        const res = db.prepare("INSERT INTO tpl_bulk_jobs (company_id, doc_type, template_code, total, status, entity_ids_json, purpose, pdfa, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, 'tpl_bulk')")
          .run(actor.companyId, b.docType, b.templateCode ?? null, ids.length, JSON.stringify(ids), b.purpose ?? 'OFFICIAL', b.pdfa ? 1 : 0, actor.user, actor.user);
        const bid = Number(res.lastInsertRowid);
        const job = jobs.enqueue('tpl.bulk', { bulkId: bid, reason: b.reason ?? null }, { createdBy: actor.user, companyId: actor.companyId });
        db.prepare('UPDATE tpl_bulk_jobs SET job_id = ? WHERE id = ?').run(job?.jobId ?? null, bid);
        writeAudit(db, { entity: 'tpl_bulk_jobs', entityId: bid, action: 'start', newValues: { docType: b.docType, total: ids.length }, actor: actor.user, companyId: actor.companyId });
        return bid;
      });
      void stamp;
      return bulk.get(actor, id);
    },
    get(actor, id) {
      const j = db.prepare('SELECT * FROM tpl_bulk_jobs WHERE id = ? AND company_id = ?').get(id, actor.companyId);
      if (!j || (j.requested_by !== actor.user && !may(actor, 'tpl.template.view'))) throw notFound('That job does not exist.');
      return { id: j.id, docType: j.doc_type, total: j.total, done: j.done, failed: j.failed, status: j.status, jobId: j.job_id, requestedBy: j.requested_by, startedAt: j.started_at, finishedAt: j.finished_at, results: JSON.parse(j.results_json) };
    },
    /** The job: each document as its own transaction, so one failure never loses the others; progress and a notification at the end. */
    async run(ctx) {
      const j = db.prepare('SELECT * FROM tpl_bulk_jobs WHERE id = ?').get(ctx.params.bulkId);
      if (!j || j.status === 'DONE') return { done: j?.done ?? 0 };
      const actor = { user: j.requested_by, roles: [], companyId: j.company_id };
      const ids = JSON.parse(j.entity_ids_json);
      const results = [];
      db.prepare("UPDATE tpl_bulk_jobs SET status = 'RUNNING', started_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), j.id);
      let done = 0; let failed = 0;
      for (const [i, e] of ids.entries()) {
        ctx.throwIfCancelled?.();
        try {
          const g = await generateOne(actor, { docType: j.doc_type, entityId: e, templateCode: j.template_code, purpose: j.purpose, pdfa: j.pdfa === 1, reason: ctx.params.reason ?? 'Bulk generation' }, { internal: true, bulkJobId: j.id });
          results.push({ entityId: e, status: 'OK', documentId: g.id, docNo: g.docNo, version: g.version });
          done += 1;
        } catch (er) { results.push({ entityId: e, status: 'FAILED', error: String(er.message).slice(0, 200) }); failed += 1; }
        if ((i + 1) % 10 === 0 || i === ids.length - 1) {
          db.prepare('UPDATE tpl_bulk_jobs SET done = ?, failed = ?, results_json = ?, updated_at = ? WHERE id = ?').run(done, failed, JSON.stringify(results), nowIso(), j.id);
          ctx.setProgress?.(Math.round(((i + 1) / ids.length) * 100), `${i + 1} of ${ids.length}`);
        }
      }
      db.prepare("UPDATE tpl_bulk_jobs SET status = ?, finished_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(failed === ids.length && ids.length > 0 ? 'FAILED' : 'DONE', nowIso(), nowIso(), j.id);
      publishEvent(db, { type: 'tpl.bulk.completed', entity: 'bulk_generation', entityId: j.id, actorId: j.requested_by, companyId: j.company_id, data: { docType: j.doc_type, total: ids.length, done, failed } });
      if (userRow(j.company_id, j.requested_by)) {
        notif.notify({ companyId: j.company_id, templateCode: 'tpl.bulk.done', recipients: [`user:${j.requested_by}`], data: { docLabel: CATALOGUE[j.doc_type].label, done: String(done), failed: String(failed), total: String(ids.length) }, link: `/documents/generated?bulk=${j.id}`, sourceType: 'tpl_bulk_job', sourceId: j.id, eventKey: `tpl:bulk:${j.id}` });
      }
      return { done, failed };
    },
  };

  // ---- generation at the milestones of the workflow (FR-08) ----
  const rules = {
    list(actor) {
      if (!may(actor, 'tpl.template.view')) throw forbidden('You may not see the templates (permission tpl.template.view).');
      return { rows: db.prepare('SELECT * FROM tpl_auto_rules WHERE company_id = ? AND is_active = 1 ORDER BY workflow_doc_type, doc_type').all(actor.companyId).map((r) => ({ id: r.id, workflowDocType: r.workflow_doc_type, docType: r.doc_type, templateCode: r.template_code, enabled: r.enabled === 1 })), workflowTypes: workflowTypes.list?.().map((w) => ({ code: w.docType, label: w.label })) ?? [] };
    },
    set(actor, b) {
      if (!may(actor, 'tpl.rule.edit')) throw forbidden('You may not change the automatic generation (permission tpl.rule.edit).');
      if (!CATALOGUE[b.docType]) throw badRequest(`${b.docType} is not a document type of the library.`, [{ field: 'docType', message: 'Choose a document type of the library.' }]);
      return transaction(db, () => {
        const old = db.prepare('SELECT * FROM tpl_auto_rules WHERE company_id = ? AND workflow_doc_type = ? AND doc_type = ? AND is_active = 1').get(actor.companyId, b.workflowDocType, b.docType);
        if (old) db.prepare('UPDATE tpl_auto_rules SET enabled = ?, template_code = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.enabled ? 1 : 0, b.templateCode ?? null, actor.user, nowIso(), old.id);
        else db.prepare("INSERT INTO tpl_auto_rules (company_id, workflow_doc_type, doc_type, template_code, enabled, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'rule')").run(actor.companyId, b.workflowDocType, b.docType, b.templateCode ?? null, b.enabled ? 1 : 0, actor.user);
        writeAudit(db, { entity: 'tpl_auto_rules', entityId: old?.id ?? 0, action: old ? 'update' : 'create', newValues: b, actor: actor.user, companyId: actor.companyId });
        return rules.list(actor);
      });
    },
    /** The approval of a record of a type that has a rule queues the making of its document (rendering is slow work, so a job does it, not the event handler). */
    onApproved(event) {
      const inst = db.prepare('SELECT * FROM wf_instances WHERE id = ?').get(Number(event.data?.instanceId));
      if (!inst) return;
      for (const r of db.prepare('SELECT * FROM tpl_auto_rules WHERE company_id = ? AND workflow_doc_type = ? AND enabled = 1 AND is_active = 1').all(inst.company_id, inst.doc_type)) {
        jobs.enqueue('tpl.milestone', { companyId: inst.company_id, docType: r.doc_type, entityId: String(inst.doc_id), templateCode: r.template_code, by: event.actorId && event.actorId !== 'system' ? event.actorId : 'system' }, { createdBy: 'system', companyId: inst.company_id });
      }
    },
    async runMilestone(ctx) {
      const p = ctx.params;
      const existing = db.prepare("SELECT 1 FROM tpl_generated_docs WHERE company_id = ? AND doc_type = ? AND entity_id = ? AND purpose = 'MILESTONE' AND is_current = 1").get(p.companyId, p.docType, String(p.entityId));
      if (existing) return { skipped: true }; // the event is delivered at least once; the document is made once
      const g = await generateOne({ user: p.by, roles: [], companyId: p.companyId }, { docType: p.docType, entityId: p.entityId, templateCode: p.templateCode ?? undefined, purpose: 'MILESTONE' }, { internal: true });
      ctx.log?.(`Generated ${g.docNo} version ${g.version}`);
      return { documentId: g.id };
    },
  };

  return { seedLibrary, templates, records, preview, generate: (actor, b) => generateOne(actor, b), generated, delivery, bulk, rules, load, catalogue: (t) => CATALOGUE[t], ownerRoles: OWNER_ROLES, linkFor, SYSTEM_SCALARS, formatBusinessDate };
}

// ---- the approval of a template ----
workflowTypes.register({
  docType: TEMPLATE_DOC,
  label: 'Document template',
  processOwner: 'SYSADM',
  route: (id) => `/admin/templates/editor?id=${id}`,
  describe(db, companyId, id) {
    const t = db.prepare('SELECT * FROM tpl_templates WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return t ? { ref: `${t.code} version ${t.template_version}`, title: t.name, originator: t.created_by } : null;
  },
  summarise(db, actor, id) {
    const t = db.prepare('SELECT * FROM tpl_templates WHERE id = ?').get(Number(id));
    if (!t) return null;
    const prev = db.prepare("SELECT * FROM tpl_templates WHERE COALESCE(company_id, 0) IN (0, ?) AND code = ? AND status = 'ACTIVE' ORDER BY company_id IS NULL LIMIT 1").get(t.company_id ?? 0, t.code);
    return { fields: [{ label: 'Template', value: `${t.code} version ${t.template_version}` }, { label: 'Document type', value: CATALOGUE[t.doc_type]?.label ?? t.doc_type }, { label: 'Name', value: t.name }, { label: 'Replaces', value: prev ? `version ${prev.template_version}` : 'nothing (first version)' }, { label: 'Change', value: t.change_note ?? '' }] };
  },
  defaultDefinition: { name: 'Template activation', settings: { resubmit: 'first', distinctApprovers: true }, steps: OWNER_ROLES.map((r) => step(`OWNER_${r}`, `Process owner (${r})`, r, { field: 'ownerRole', op: 'eq', value: r })) },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.templates.activate(instance, actor),
    onRejected: (db, { instance }) => bound(db)?.templates.backToMaker(instance, 'REJECTED'),
    onReturned: (db, { instance }) => bound(db)?.templates.backToMaker(instance, 'DRAFT'),
    onCancelled: (db, { instance }) => bound(db)?.templates.backToMaker(instance, 'DRAFT'),
    onResubmitted: (db, { instance }) => db.prepare("UPDATE tpl_templates SET status = 'IN_REVIEW', updated_at = ?, version = version + 1 WHERE id = ?").run(new Date().toISOString(), Number(instance.docId)),
  },
});
const lineSet = (s) => new Map(String(s ?? '').split('\n').map((l) => [l, true]));
evidenceProviders.register(TEMPLATE_DOC, ({ db, instance }) => {
  const t = db.prepare('SELECT * FROM tpl_templates WHERE id = ?').get(Number(instance.docId));
  if (!t) return { sections: [] };
  const prev = db.prepare("SELECT * FROM tpl_templates WHERE COALESCE(company_id, 0) IN (0, ?) AND code = ? AND status = 'ACTIVE' ORDER BY company_id IS NULL LIMIT 1").get(t.company_id ?? 0, t.code);
  const v = validate(t.doc_type, t);
  const was = lineSet(prev?.html); const now = lineSet(t.html);
  const added = [...now.keys()].filter((l) => !was.has(l) && l.trim()).length;
  const removed = [...was.keys()].filter((l) => !now.has(l) && l.trim()).length;
  return {
    sections: [
      { code: 'template', title: 'The template', kind: 'metrics', items: [{ label: 'Version', value: String(t.template_version), format: 'text' }, { label: 'Replaces', value: prev ? `version ${prev.template_version}` : 'nothing (first version)', format: 'text' }, { label: 'Lines added', value: String(added), format: 'text' }, { label: 'Lines removed', value: String(removed), format: 'text' }, { label: 'Check against the catalogue', value: v.ok ? 'Passes' : `${v.problems.length} problem(s)`, format: 'text', tone: v.ok ? 'good' : 'bad' }, { label: 'Variables used', value: String(v.variables.length), format: 'text' }] },
    ],
    flags: v.ok ? [] : [{ tone: 'bad', text: 'The template does not pass the check against the variable catalogue.' }],
  };
});

fileEntities.register({
  entity: 'tpl_generated', label: 'Generated document',
  resolve(db, actor, id) {
    const s = bound(db);
    const g = db.prepare('SELECT * FROM tpl_generated_docs WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
    if (!g || !s || !s.generated.visible(actor, g)) return null;
    return { companyId: g.company_id, projectId: g.project_id ?? null, siteId: g.site_id ?? null, canView: true, canEdit: false, locked: true };
  },
});

// the code printed on a document is read by the scanner of the application too (03.06): a person who may see the document is taken to it
qrRegistry.register({
  type: VERIFY_QR, label: 'Generated document (verification code)',
  match: ({ typed }) => typed?.type === VERIFY_QR,
  resolve(db, actor, { typed }) {
    const s = bound(db);
    const g = db.prepare('SELECT * FROM tpl_generated_docs WHERE verify_code = ?').get(typed.ref.toUpperCase());
    if (!g || !s || !s.generated.visible(actor, g)) return null;
    return { id: g.id, title: `${g.doc_number} version ${g.version_no}`, route: `/documents/generated?id=${g.id}` };
  },
});

export { DOC_TYPES };
