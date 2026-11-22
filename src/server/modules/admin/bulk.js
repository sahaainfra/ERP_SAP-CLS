import { zipSync } from 'fflate';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { excelOf, importTypes } from '../eng/excel.js';

/**
 * Part 29.04 — template packs and the bulk data entry workspace, on the Excel engine (04.13).
 *
 * A pack groups the engine's import types of a module (masters, project data, workforce, business development, rates, transactions) with
 * its documentation: instructions, an example row per template, and a version history (a manager publishes a new version with a reason).
 * The pack downloads as one zip: a README, an instructions workbook (every column of every template, required, type and help, and the
 * examples) and each template workbook.
 *
 * A bulk batch is a grid of rows typed or pasted in the browser. Each change is checked by the engine's own row check (types, required,
 * lookups, duplicates, the module's rules), and the cells in error are returned for the page to highlight. A batch is saved as a draft and
 * submitted as a whole. A batch of approval-controlled data (a type whose single records are created directly) waits for the module approver
 * (preparer → module approver); a type whose records enter their own workflow is imported on submit and each record follows its own chain.
 * The import runs as the preparer, through the module's service, all or nothing (BR-01, T-01).
 */
export const BULK_FLAG = 'ff.admin.p2904';
export const BATCH_TYPE = 'xl_bulk_batch';
const iso = () => new Date().toISOString();

/** The packs of the system; a company publishes its own versions of their documentation. Types not registered are left out. */
export const PACKS = Object.freeze({
  masters: { name: 'Masters', module: 'Master data', templates: ['MDM_ITEM', 'MDM_BUSINESS_PARTNER', 'MDM_PARTNER', 'MDM_UOM', 'MDM_HSN_SAC', 'MDM_GST_RATE', 'MDM_TDS_SECTION', 'MDM_BANK', 'MDM_PAYMENT_TERM', 'MDM_CURRENCY', 'MDM_STATE', 'MDM_DISTRICT', 'MDM_LOOKUP', 'ORG_DESIGNATION'] },
  workforce: { name: 'Workforce', module: 'HR and attendance', templates: ['HR_EMPLOYEE', 'HR_WORKER', 'HR_DEPLOYMENT', 'TRN_CERT', 'ATT_DEVICE_PUNCH'] },
  project: { name: 'Project data', module: 'Projects, estimation and budgets', templates: ['PROJ_WBS', 'PROJ_LOCATION', 'PROJ_MILESTONE', 'PROJ_BOQ_LINE', 'EST_BOQ', 'EST_MTO', 'BUD_DEPT_BUDGET'] },
  rates: { name: 'Rates and SOR', module: 'Rate library', templates: ['MDM_RESOURCE_RATE', 'MDM_SOR_ITEM', 'MDM_EXCHANGE_RATE'] },
  bd: { name: 'Business development', module: 'Leads, opportunities and tenders', templates: ['BD_LEAD', 'BD_OPPORTUNITY', 'BD_TENDER', 'BD_CREDENTIAL'] },
});
/** Types whose rows enter their own approval workflow when created (drafts, requests, registrations): imported on submit. */
const OWN_WORKFLOW = new Set(['ENG_SAMPLE_DOC', 'MDM_PARTNER', 'MDM_BUSINESS_PARTNER', 'MDM_ITEM', 'HR_WORKER', 'TRN_CERT', 'HR_DEPLOYMENT', 'HR_EMPLOYEE', 'BD_LEAD', 'BD_OPPORTUNITY', 'BD_TENDER']);
/** The module approver of a batch (configurable per type here; the role, never the preparer, decides). */
const APPROVER_OF_MODULE = { organisation: 'HRMGR', engine: 'ITADM', 'master data': 'PROCMGR', hr: 'HRMGR', 'business development': 'DIR', estimation: 'COMMGR', 'project master': 'PD', 'project structure': 'PD', 'project BOQ': 'PD', bud: 'CFO' };
const APPROVER_OF_TYPE = { MDM_CURRENCY: 'CFO', MDM_EXCHANGE_RATE: 'CFO', MDM_BANK: 'CFO', MDM_PAYMENT_TERM: 'CFO', MDM_GST_RATE: 'CFO', MDM_TDS_SECTION: 'CFO', MDM_HSN_SAC: 'CFO', MDM_LOOKUP: 'ITADM', MDM_STATE: 'ITADM', MDM_DISTRICT: 'ITADM', MDM_RESOURCE_RATE: 'COMMGR', MDM_SOR_ITEM: 'COMMGR', BD_CREDENTIAL: 'DIR' };
export const approverOf = (def) => APPROVER_OF_TYPE[def.code] ?? APPROVER_OF_MODULE[def.module] ?? 'ITADM';
export const needsApproval = (def) => !OWN_WORKFLOW.has(def.code);

const services = new WeakMap();
export const bulkOf = (db) => services.get(db) ?? null;

/** @param {any} context */
export function createBulkWorkspace(context) {
  const { db } = context;
  const authz = authzOf(db);
  const xl = () => { const x = excelOf(db); if (!x?.grid) throw unprocessable('The Excel engine (04.13) is not installed.'); return x; };
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, BULK_FLAG)) throw notFound('Bulk data entry is not enabled for this company.');
    if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`);
  };
  const defOf = (code) => { const d = importTypes.get(code); if (!d) throw notFound(`There is no template ${code}.`); return d; };

  // ---------------------------------------------------------------- packs
  const packRow = (companyId, code) => db.prepare("SELECT * FROM xl_packs WHERE company_id = ? AND code = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(companyId, code);
  const defaultExample = (def) => Object.fromEntries(def.columns.map((c) => [c.key, c.example ?? (c.type === 'int' ? String(c.min ?? 1) : c.type === 'decimal' || c.type === 'money' ? '100.00' : c.type === 'date' ? '2027-03-31' : c.type === 'bool' ? 'Yes' : c.type === 'enum' ? c.values?.[0] ?? '' : '')]));
  function packOf(actor, code) {
    const sys = PACKS[code]; if (!sys) throw notFound(`There is no pack ${code}.`);
    const row = packRow(actor.companyId, code);
    const templates = (row ? JSON.parse(row.template_codes_json) : sys.templates).filter((t) => importTypes.has(t));
    const examples = row?.examples_json ? JSON.parse(row.examples_json) : {};
    const history = db.prepare('SELECT pack_version, status, notes, created_by, created_at FROM xl_packs WHERE company_id = ? AND code = ? AND deleted_at IS NULL ORDER BY pack_version DESC LIMIT 20').all(actor.companyId, code);
    return { code, name: sys.name, module: sys.module, version: row?.pack_version ?? 1, publishedBy: row?.created_by ?? 'system', publishedAt: row?.created_at ?? null, instructions: row?.instructions ?? '', notes: row?.notes ?? 'First version: the templates of the module as registered.',
      templates: templates.map((t) => { const d = importTypes.get(t); return { code: t, label: d.label, module: d.module, description: d.description ?? '', canImport: hasPermissionAnywhere(actor, d.permission), needsApproval: needsApproval(d), approver: needsApproval(d) ? approverOf(d) : null, columns: d.columns.length, example: examples[t] ?? defaultExample(d) }; }),
      missing: sys.templates.filter((t) => !importTypes.has(t)),
      history: [...history.map((h) => ({ version: h.pack_version, status: h.status, notes: h.notes, by: h.created_by, at: h.created_at })), ...(history.some((h) => h.pack_version === 1) ? [] : [{ version: 1, status: row ? 'RETIRED' : 'ACTIVE', notes: 'First version: the templates of the module as registered.', by: 'system', at: null }])] };
  }
  const packs = {
    list(actor) {
      guard(actor, 'adm.bulk.use');
      return { rows: Object.keys(PACKS).map((code) => { const p = packOf(actor, code); return { ...p, templates: p.templates.map(({ example: _e, ...t }) => t) }; }), canManage: hasPermissionAnywhere(actor, 'adm.pack.manage') };
    },
    get(actor, code) { guard(actor, 'adm.bulk.use'); return packOf(actor, code); },
    /** FR-03 version control: a new version of the pack's documentation (instructions, examples, the templates it holds), with a reason. */
    publish(actor, code, { instructions = '', examples = {}, templates = null, notes }) {
      guard(actor, 'adm.pack.manage');
      const sys = PACKS[code]; if (!sys) throw notFound(`There is no pack ${code}.`);
      const chosen = templates ?? sys.templates;
      const unknown = chosen.filter((t) => !importTypes.has(t)); if (unknown.length) throw unprocessable(`Not a template: ${unknown.join(', ')}.`);
      for (const [t, ex] of Object.entries(examples)) {
        if (!chosen.includes(t)) throw unprocessable(`${t} is not in this pack.`);
        const cols = new Set(importTypes.get(t).columns.map((c) => c.key)); const bad = Object.keys(ex).filter((k) => !cols.has(k)); if (bad.length) throw unprocessable(`${t} has no column ${bad.join(', ')}.`);
        if (Object.values(ex).some((v) => /^[=+\-@]/.test(String(v)) && !/^[+-]?\d/.test(String(v)))) throw unprocessable('An example cannot start with = + - or @.');
      }
      return transaction(db, () => {
        const prev = packRow(actor.companyId, code);
        const version = (db.prepare('SELECT MAX(pack_version) AS v FROM xl_packs WHERE company_id = ? AND code = ?').get(actor.companyId, code).v ?? 1) + 1;
        if (prev) db.prepare("UPDATE xl_packs SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), prev.id);
        const id = Number(db.prepare("INSERT INTO xl_packs (company_id, code, module, name, template_codes_json, pack_version, instructions, examples_json, notes, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 'pack')")
          .run(actor.companyId, code, sys.module, sys.name, JSON.stringify(chosen), version, instructions, JSON.stringify(examples), notes, actor.user).lastInsertRowid);
        writeAudit(db, { companyId: actor.companyId, entity: 'xl_packs', entityId: String(id), action: 'publish', actor: actor.user, oldValues: prev ? { version: prev.pack_version } : null, newValues: { code, version, templates: chosen, notes } });
        publishEvent(db, { type: 'admin.pack.published', entity: 'xl_packs', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code, version } });
        return packOf(actor, code);
      });
    },
    /** FR-01 FR-03 the pack as one zip: README, the instructions workbook (columns and examples) and every template the person may import. */
    download(actor, code) {
      guard(actor, 'adm.bulk.use');
      const p = packOf(actor, code); const x = xl();
      const usable = p.templates.filter((t) => t.canImport);
      const rows = []; for (const t of usable) { const g = x.grid.columns(actor, t.code); for (const c of g.columns) rows.push({ template: t.label, column: c.label, required: c.required ? 'Yes' : 'No', type: c.type, help: c.help, example: String(t.example[c.key] ?? '') }); }
      const guide = writeExport('xlsx', { title: `${p.name} pack v${p.version}: instructions`, sheetName: 'Instructions', columns: [['template', 'Template'], ['column', 'Column'], ['required', 'Required'], ['type', 'Type'], ['help', 'Help'], ['example', 'Example']].map(([key, label]) => ({ key, label })), rows,
        footer: ['Fill each template on its Data sheet, or paste the rows into the Bulk Data Entry Workspace. Nothing is saved until the batch is checked and, where shown, approved.', ...String(p.instructions).split('\n').filter(Boolean)] });
      const readme = [`${p.name} template pack — version ${p.version}`, `Module: ${p.module}`, `Published by ${p.publishedBy}${p.publishedAt ? ` on ${p.publishedAt.slice(0, 10)}` : ''}. ${p.notes}`, '', ...String(p.instructions || 'Use one template per kind of record. Columns marked * are required. Codes or names of master records both work.').split('\n'), '',
        'Templates:', ...usable.map((t) => `- ${t.label} (${t.code})${t.needsApproval ? ` — approved by ${t.approver} before it is saved` : ' — each record follows its own approval'}`), ...(p.templates.length > usable.length ? ['', `Left out (you may not import them): ${p.templates.filter((t) => !t.canImport).map((t) => t.label).join(', ')}.`] : []), '', 'Version history:', ...p.history.map((h) => `- v${h.version} ${h.status.toLowerCase()} — ${h.notes ?? ''} (${h.by})`)].join('\n');
      const files = { 'README.txt': new TextEncoder().encode(readme), [`00-${code}-instructions.xlsx`]: new Uint8Array(guide) };
      usable.forEach((t, i) => { const f = x.templates.download(actor, t.code); files[`${String(i + 1).padStart(2, '0')}-${f.fileName}`] = new Uint8Array(f.buffer); });
      writeAudit(db, { companyId: actor.companyId, entity: 'xl_packs', entityId: code, action: 'download', actor: actor.user, newValues: { version: p.version, templates: usable.map((t) => t.code) } });
      return { buffer: Buffer.from(zipSync(files)), contentType: 'application/zip', fileName: `${code}-pack-v${p.version}.zip` };
    },
  };

  // ---------------------------------------------------------------- batches
  const handlers = { [BATCH_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, approver) { importBatch(request.payload.batchId, approver); },
  } };
  const engine = createApprovalEngine({ db, handlers });
  const preparerOf = (b) => { const a = JSON.parse(b.actor_json); const actor = { user: a.user, userId: a.userId ?? null, roles: a.roles ?? [], companyId: b.company_id }; authz.enrich(actor); return actor; };
  /** The import of a batch as its preparer: all or nothing. A failure leaves the batch FAILED with the rows' errors and saves nothing. */
  function importBatch(id, by) {
    const b = db.prepare('SELECT * FROM xl_bulk_batches WHERE id = ?').get(id);
    const out = xl().grid.commit(preparerOf(b), b.template_code, JSON.parse(b.rows_json), { onExisting: b.on_existing });
    if (!out.ok) {
      db.prepare("UPDATE xl_bulk_batches SET status = 'FAILED', errors_json = ?, error_count = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(out.errors), out.errors.length, by.user, iso(), id);
      writeAudit(db, { companyId: b.company_id, entity: 'xl_bulk_batches', entityId: String(id), action: 'import_failed', actor: by.user, newValues: { errors: out.errors.length } });
      publishEvent(db, { type: 'admin.bulk_batch.failed', entity: 'xl_bulk_batches', entityId: id, actorId: by.user, companyId: b.company_id, data: { template: b.template_code, errors: out.errors.length } });
      return out;
    }
    db.prepare("UPDATE xl_bulk_batches SET status = 'IMPORTED', result_json = ?, errors_json = NULL, error_count = 0, imported_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(out), iso(), by.user, iso(), id);
    writeAudit(db, { companyId: b.company_id, entity: 'xl_bulk_batches', entityId: String(id), action: 'imported', actor: by.user, newValues: { created: out.created, updated: out.updated, skipped: out.skipped } });
    publishEvent(db, { type: 'admin.bulk_batch.imported', entity: 'xl_bulk_batches', entityId: id, actorId: by.user, companyId: b.company_id, data: { template: b.template_code, created: out.created, updated: out.updated } });
    return out;
  }
  const view = (b, actor, mine = new Set()) => ({ id: b.id, docNo: b.doc_no, title: b.title, templateCode: b.template_code, template: importTypes.get(b.template_code)?.label ?? b.template_code, packCode: b.pack_code, onExisting: b.on_existing, status: b.status, rows: b.row_count, errors: b.error_count,
    needsApproval: Boolean(b.needs_approval), approver: b.approver_role, requestId: b.request_id, canApprove: mine.has(b.request_id), canEdit: b.created_by === actor.user && ['DRAFT', 'RETURNED', 'FAILED'].includes(b.status), by: b.created_by, createdAt: b.created_at, submittedAt: b.submitted_at, importedAt: b.imported_at,
    result: b.result_json ? JSON.parse(b.result_json) : null, rowVersion: b.version });
  const load = (actor, id) => {
    const b = db.prepare('SELECT * FROM xl_bulk_batches WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!b) throw notFound('That batch does not exist.');
    const mine = new Set(engine.awaiting(actor).map((x) => x.id));
    const decided = () => db.prepare('SELECT 1 FROM core_change_request_steps s JOIN core_change_requests r ON r.id = s.request_id WHERE r.target_type = ? AND r.target_id = ? AND s.decided_by = ?').get('xl_bulk_batches', String(b.id), actor.user);
    if (b.created_by !== actor.user && !mine.has(b.request_id) && !hasPermissionAnywhere(actor, 'adm.bulk.view_all') && !decided()) throw notFound('That batch does not exist.');
    return { b, mine };
  };
  const clean = (def, rows) => rows.map((r) => Object.fromEntries(def.columns.map((c) => [c.key, r?.[c.key] == null ? '' : String(r[c.key]).slice(0, 2000)])));
  const nonEmpty = (rows) => rows.filter((r) => Object.values(r).some((v) => String(v).trim() !== ''));
  const nextDoc = () => `BULK-${String((db.prepare('SELECT COUNT(*) AS n FROM xl_bulk_batches').get().n ?? 0) + 1).padStart(6, '0')}`;

  const batches = {
    columns(actor, code) { guard(actor, 'adm.bulk.use'); const d = defOf(code); const g = xl().grid.columns(actor, code); return { ...g, needsApproval: needsApproval(d), approver: needsApproval(d) ? approverOf(d) : null }; },
    /** FR-02: check rows without saving them (each cell edit); returns the errors by row and column for the grid to highlight. */
    check(actor, code, rows, onExisting = 'ERROR') { guard(actor, 'adm.bulk.use'); const d = defOf(code); return { results: xl().grid.check(actor, code, nonEmpty(clean(d, rows)), { onExisting }) }; },
    list(actor, { status = null, scope = 'mine', page = 1, pageSize = 25 } = {}) {
      guard(actor, 'adm.bulk.use');
      const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      const where = ['company_id = ?', 'deleted_at IS NULL']; const p = [actor.companyId];
      if (scope === 'approve') {
        // waiting for me, and the batches I have already decided (so the outcome stays in view)
        where.push(`(request_id IN (${[...mine, 0].map(() => '?').join(',')}) OR id IN (SELECT CAST(r.target_id AS INTEGER) FROM core_change_requests r JOIN core_change_request_steps st ON st.request_id = r.id WHERE r.company_id = ? AND r.type = ? AND st.decided_by = ?))`);
        p.push(...mine, 0, actor.companyId, BATCH_TYPE, actor.user);
      }
      else if (scope === 'all' && hasPermissionAnywhere(actor, 'adm.bulk.view_all')) { /* the whole company */ } else { where.push('created_by = ?'); p.push(actor.user); }
      if (status) { where.push('status = ?'); p.push(status); }
      const sql = where.join(' AND ');
      const rows = db.prepare(`SELECT * FROM xl_bulk_batches WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize);
      return { rows: rows.map((b) => view(b, actor, mine)), total: db.prepare(`SELECT COUNT(*) AS n FROM xl_bulk_batches WHERE ${sql}`).get(...p).n, page, pageSize, awaiting: mine.size, canViewAll: hasPermissionAnywhere(actor, 'adm.bulk.view_all') };
    },
    get(actor, id) {
      guard(actor, 'adm.bulk.use');
      const { b, mine } = load(actor, id);
      const d = importTypes.get(b.template_code);
      const sensitive = new Set((d?.columns ?? []).filter((c) => c.sensitive).map((c) => c.key));
      const rows = JSON.parse(b.rows_json).map((r) => (b.created_by === actor.user ? r : Object.fromEntries(Object.entries(r).map(([k, v]) => [k, sensitive.has(k) && v ? '••••' : v]))));
      return { ...view(b, actor, mine), data: rows, rowErrors: b.errors_json ? JSON.parse(b.errors_json) : [], request: b.request_id ? engine.get(actor, b.request_id) : null };
    },
    /** Save as a draft batch (new, or the preparer's own draft, returned or failed batch). The rows are checked and the error count kept. */
    save(actor, { id = null, templateCode, packCode = null, title, rows, onExisting = 'ERROR', version = null }) {
      guard(actor, 'adm.bulk.use');
      const d = defOf(templateCode); const data = nonEmpty(clean(d, rows));
      if (!data.length) throw unprocessable('The batch has no rows.');
      const results = xl().grid.check(actor, templateCode, data, { onExisting });
      const errs = results.filter((r) => r.errors.length).map((r) => ({ line: r.line, errors: r.errors }));
      return transaction(db, () => {
        if (id) {
          const { b } = load(actor, id);
          if (b.created_by !== actor.user) throw forbidden('Only the preparer can change a batch.');
          if (!['DRAFT', 'RETURNED', 'FAILED'].includes(b.status)) throw conflict(`The batch is ${b.status.toLowerCase()}; it cannot be changed.`);
          if (version != null && version !== b.version) throw conflict('The batch was changed meanwhile. Reload it.');
          if (b.template_code !== templateCode) throw unprocessable('A batch keeps its template.');
          db.prepare("UPDATE xl_bulk_batches SET title = ?, rows_json = ?, row_count = ?, error_count = ?, errors_json = ?, on_existing = ?, status = 'DRAFT', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(title, JSON.stringify(data), data.length, errs.length, JSON.stringify(errs), onExisting, actor.user, iso(), b.id);
          writeAudit(db, { companyId: actor.companyId, entity: 'xl_bulk_batches', entityId: String(b.id), action: 'update', actor: actor.user, newValues: { rows: data.length, errors: errs.length } });
          return { ...batches.get(actor, b.id), results };
        }
        const nid = Number(db.prepare(`INSERT INTO xl_bulk_batches (company_id, doc_no, title, template_code, pack_code, rows_json, row_count, error_count, errors_json, on_existing, needs_approval, approver_role, status, actor_json, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'bulk_entry')`).run(actor.companyId, nextDoc(), title, templateCode, packCode, JSON.stringify(data), data.length, errs.length, JSON.stringify(errs), onExisting, needsApproval(d) ? 1 : 0, needsApproval(d) ? approverOf(d) : null, JSON.stringify({ user: actor.user, userId: actor.userId ?? null, roles: actor.roles ?? [] }), actor.user).lastInsertRowid);
        writeAudit(db, { companyId: actor.companyId, entity: 'xl_bulk_batches', entityId: String(nid), action: 'create', actor: actor.user, newValues: { template: templateCode, rows: data.length, errors: errs.length } });
        return { ...batches.get(actor, nid), results };
      });
    },
    /** BR-01: submitted as a whole once every row is correct; approval-controlled data waits for the module approver, other data is imported now. */
    submit(actor, id, { reason, version = null }) {
      guard(actor, 'adm.bulk.use');
      const { b } = load(actor, id);
      if (b.created_by !== actor.user) throw forbidden('Only the preparer can submit a batch.');
      if (!['DRAFT', 'RETURNED', 'FAILED'].includes(b.status)) throw conflict(`The batch is ${b.status.toLowerCase()}.`);
      if (version != null && version !== b.version) throw conflict('The batch was changed meanwhile. Reload it.');
      const results = xl().grid.check(actor, b.template_code, JSON.parse(b.rows_json), { onExisting: b.on_existing });
      const errs = results.filter((r) => r.errors.length);
      if (errs.length) {
        db.prepare('UPDATE xl_bulk_batches SET error_count = ?, errors_json = ?, updated_at = ? WHERE id = ?').run(errs.length, JSON.stringify(errs.map((r) => ({ line: r.line, errors: r.errors }))), iso(), b.id);
        throw Object.assign(unprocessable(`${errs.length} row(s) have errors; correct them before submitting.`), { details: errs.slice(0, 50).flatMap((r) => r.errors.map((e) => ({ field: `rows.${r.line}.${e.column ?? ''}`, message: e.message }))) });
      }
      const d = defOf(b.template_code);
      return transaction(db, () => {
        db.prepare("UPDATE xl_bulk_batches SET status = 'SUBMITTED', submitted_at = ?, error_count = 0, errors_json = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), actor.user, iso(), b.id);
        writeAudit(db, { companyId: actor.companyId, entity: 'xl_bulk_batches', entityId: String(b.id), action: 'submit', actor: actor.user, newValues: { rows: b.row_count, reason } });
        if (needsApproval(d)) {
          const req = engine.submit(actor, { type: BATCH_TYPE, title: `${b.doc_no}: ${b.row_count} ${d.label}`, targetType: 'xl_bulk_batches', targetId: String(b.id), payload: { batchId: b.id, template: b.template_code, rows: b.row_count }, reason, chain: [approverOf(d)] });
          db.prepare('UPDATE xl_bulk_batches SET request_id = ? WHERE id = ?').run(req.id, b.id);
          publishEvent(db, { type: 'admin.bulk_batch.submitted', entity: 'xl_bulk_batches', entityId: b.id, actorId: actor.user, companyId: actor.companyId, data: { template: b.template_code, rows: b.row_count, approver: approverOf(d) } });
        } else importBatch(b.id, actor);
        return batches.get(actor, b.id);
      });
    },
    decide(actor, id, body) {
      guard(actor, 'adm.bulk.use');
      const { b } = load(actor, id); if (!b.request_id || b.status !== 'SUBMITTED') throw conflict('The batch is not waiting for approval.');
      const out = engine.act(actor, b.request_id, body);
      if (out.status === 'REJECTED' || out.status === 'RETURNED') db.prepare('UPDATE xl_bulk_batches SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(out.status, actor.user, iso(), b.id);
      return batches.get(actor, b.id);
    },
    cancel(actor, id) {
      guard(actor, 'adm.bulk.use');
      const { b } = load(actor, id); if (b.created_by !== actor.user) throw forbidden('Only the preparer can cancel a batch.');
      if (!['DRAFT', 'RETURNED', 'FAILED'].includes(b.status)) throw conflict(`The batch is ${b.status.toLowerCase()}.`);
      db.prepare("UPDATE xl_bulk_batches SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), b.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'xl_bulk_batches', entityId: String(b.id), action: 'cancel', actor: actor.user });
      return batches.get(actor, b.id);
    },
  };

  const svc = { packs, batches, engine };
  services.set(db, svc);
  return svc;
}
