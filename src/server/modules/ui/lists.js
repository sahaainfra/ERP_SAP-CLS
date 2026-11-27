import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { hasPermission, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { footerLines, writeExport, FORMATS } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { describeList, filtersOf, listExports, listRegistry, parseListRequest, queryOf } from '../../platform/list/index.js';
import { createExportGuard } from '../../platform/security/export.js';
import { securityHandlers } from '../../platform/security/handlers.js';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { parse } from '../../platform/validation/index.js';
import { fromUnits, toUnits } from '../../../shared/money.js';

// Part 03.03: saved list views, list exports (direct or as a background job) and the List Report of the reference register.
const nowIso = () => new Date().toISOString();
const istStamp = (iso = nowIso()) => new Date(Date.parse(iso) + 19_800_000).toISOString().replace('T', ' ').slice(0, 16);

// ---- saved views ----
const shareScope = z.object({ roles: z.array(z.string().regex(/^[A-Z][A-Z0-9-]{1,19}$/, 'Use role codes such as PM')).max(20).default([]), projects: z.array(z.number().int().positive()).max(50).default([]) }).strict();
const viewConfigSchema = z.object({
  columns: z.array(z.string().max(60)).max(60).default([]),
  hidden: z.array(z.string().max(60)).max(60).default([]),
  widths: z.record(z.string().max(60), z.number().int().min(40).max(800)).default({}),
  filters: z.array(z.object({ key: z.string().max(60), op: z.enum(['eq', 'ne', 'in', 'gte', 'lte', 'between', 'contains', 'empty', 'notempty']), value: z.string().max(500) }).strict()).max(30).default([]),
  sort: z.string().max(200).default(''),
  pageSize: z.number().int().refine((n) => [25, 50, 100, 200].includes(n)).default(25),
  q: z.string().max(100).default(''),
  groupBy: z.string().max(60).optional(), // part 166.7: the column the rows are grouped by
}).strict();
export const parseViewCreate = (b) => parse(z.object({ list: z.string().max(80), name: z.string().trim().min(1, 'Name the view').max(80), isShared: z.boolean().default(false), shareScope: shareScope.default({ roles: [], projects: [] }), isDefault: z.boolean().default(false), config: viewConfigSchema }).strict(), b);
export const parseViewUpdate = (b) => parse(z.object({ name: z.string().trim().min(1).max(80).optional(), isShared: z.boolean().optional(), shareScope: shareScope.optional(), isDefault: z.boolean().optional(), config: viewConfigSchema.optional(), version: z.number().int().positive() }).strict(), b);
export const parseViewList = (q) => parse(z.object({ list: z.string().max(80) }).strict(), q);
export const parseVersionBody = (b) => parse(z.object({ version: z.number().int().positive().optional() }).strict(), b ?? {});

/**
 * Saved views (FR-03): a person's own views of a list, and views shared by someone with ui.view.share with roles and/or projects (an
 * empty scope means everyone in the company who can open the list). A person sees their own and the shared ones aimed at them, never
 * another person's personal view. One default per person and list. Changes are audited (they are configuration a team relies on).
 */
export function createSavedViewService({ db, managedList = '' }) {
  const authz = authzOf(db);
  const present = (r, actor) => ({ id: r.id, list: r.list_code, name: r.name, isShared: r.is_shared === 1, shareScope: JSON.parse(r.share_scope_json), isDefault: r.is_default === 1, config: JSON.parse(r.config_json), owner: r.owner_ref, mine: r.owner_ref === actor.user, version: r.version, updatedAt: r.updated_at ?? r.created_at });
  const reaches = (actor, scope) => {
    const roles = scope.roles ?? [];
    const projects = scope.projects ?? [];
    if (!roles.length && !projects.length) return true;
    const held = new Set([...(actor.roles ?? []), ...(actor.grants?.roles ?? [])]);
    if (roles.some((r) => held.has(r))) return true;
    return projects.some((p) => authz.check(actor, 'org.view', { companyId: actor.companyId, projectId: p }).allowed);
  };
  const rowOf = (actor, id) => {
    const r = db.prepare('SELECT * FROM ui_saved_views WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!r || (r.owner_ref !== actor.user && !(r.is_shared === 1 && reaches(actor, JSON.parse(r.share_scope_json))))) throw notFound('That view does not exist.');
    if (listRegistry.get(r.list_code)?.managedViews && r.list_code !== managedList) throw notFound('That view does not exist.');
    return r;
  };
  const checkList = (code, config) => {
    const def = listRegistry.get(code);
    if (!def || (def.managedViews && code !== managedList)) throw badRequest('Some fields are invalid.', [{ field: 'list', message: `There is no list called ${code}.` }]);
    if (!config) return;
    const keys = new Set(Object.keys(def.columns));
    const bad = [...config.columns, ...config.hidden, ...Object.keys(config.widths), ...config.filters.map((f) => f.key)].find((k) => !keys.has(k));
    if (bad) throw badRequest('Some fields are invalid.', [{ field: 'config', message: `"${bad}" is not a column of ${def.label}.` }]);
  };
  const clearDefault = (actor, list, except = 0) => db.prepare('UPDATE ui_saved_views SET is_default = 0 WHERE company_id = ? AND owner_ref = ? AND list_code = ? AND id != ? AND deleted_at IS NULL').run(actor.companyId, actor.user, list, except);

  return {
    list(actor, list) {
      checkList(list);
      const rows = db.prepare('SELECT * FROM ui_saved_views WHERE company_id = ? AND list_code = ? AND deleted_at IS NULL AND (owner_ref = ? OR is_shared = 1) ORDER BY is_shared, lower(name)').all(actor.companyId, list, actor.user);
      return rows.filter((r) => r.owner_ref === actor.user || reaches(actor, JSON.parse(r.share_scope_json))).map((r) => present(r, actor));
    },

    create(actor, v) {
      checkList(v.list, v.config);
      if (v.isShared && !hasPermission(actor, 'ui.view.share')) throw forbidden('Sharing a view needs ui.view.share. Save it as a personal view, or ask a system administrator.');
      if (!db.prepare('SELECT 1 FROM org_companies WHERE id = ?').get(actor.companyId)) throw unprocessable('Your company is not set up yet, so views cannot be saved.');
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM ui_saved_views WHERE company_id = ? AND owner_ref = ? AND list_code = ? AND name = ? AND deleted_at IS NULL').get(actor.companyId, actor.user, v.list, v.name)) throw conflict(`You already have a view called "${v.name}" on this list. Choose another name or change that view.`);
        const id = Number(db.prepare("INSERT INTO ui_saved_views (company_id, owner_user_id, owner_ref, list_code, name, is_shared, share_scope_json, config_json, is_default, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved_view')")
          .run(actor.companyId, actor.userId ?? null, actor.user, v.list, v.name, v.isShared ? 1 : 0, JSON.stringify(v.isShared ? v.shareScope : {}), JSON.stringify(v.config), v.isDefault ? 1 : 0, actor.user).lastInsertRowid);
        if (v.isDefault) clearDefault(actor, v.list, id);
        writeAudit(db, { entity: 'ui_saved_views', entityId: id, action: 'create', newValues: { list: v.list, name: v.name, shared: v.isShared, scope: v.shareScope, default: v.isDefault }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'ui.saved_view.changed', entity: 'saved_view', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { list: v.list, action: 'create', shared: v.isShared } });
        return present(rowOf(actor, id), actor);
      });
    },

    update(actor, id, v) {
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (r.owner_ref !== actor.user) throw forbidden('Only the person who saved a view can change it.');
        if (r.version !== v.version) throw conflict('The view was changed elsewhere. Reload it, then make your change.');
        if (v.config) checkList(r.list_code, v.config);
        const shared = v.isShared ?? r.is_shared === 1;
        if (shared && !hasPermission(actor, 'ui.view.share')) throw forbidden('Sharing a view needs ui.view.share.');
        const next = { name: v.name ?? r.name, shared, scope: shared ? (v.shareScope ?? JSON.parse(r.share_scope_json)) : {}, config: v.config ?? JSON.parse(r.config_json), def: v.isDefault ?? r.is_default === 1 };
        db.prepare('UPDATE ui_saved_views SET name = ?, is_shared = ?, share_scope_json = ?, config_json = ?, is_default = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(next.name, next.shared ? 1 : 0, JSON.stringify(next.scope), JSON.stringify(next.config), next.def ? 1 : 0, actor.user, nowIso(), id);
        if (next.def) clearDefault(actor, r.list_code, id);
        writeAudit(db, { entity: 'ui_saved_views', entityId: id, action: 'update', oldValues: { name: r.name, shared: r.is_shared === 1, scope: JSON.parse(r.share_scope_json), default: r.is_default === 1 }, newValues: { name: next.name, shared: next.shared, scope: next.scope, default: next.def }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'ui.saved_view.changed', entity: 'saved_view', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { list: r.list_code, action: 'update', shared: next.shared } });
        return present(rowOf(actor, id), actor);
      });
    },

    /** @param {any} actor @param {number} id @param {{ version?: number }} [opts] */
    remove(actor, id, { version } = {}) {
      return transaction(db, () => {
        const r = rowOf(actor, id);
        if (r.owner_ref !== actor.user) throw forbidden('Only the person who saved a view can delete it.');
        if (version !== undefined && version !== r.version) throw conflict('The view was changed elsewhere. Reload it, then delete it.');
        db.prepare('UPDATE ui_saved_views SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
        writeAudit(db, { entity: 'ui_saved_views', entityId: id, action: 'delete', oldValues: { list: r.list_code, name: r.name, shared: r.is_shared === 1 }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'ui.saved_view.changed', entity: 'saved_view', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { list: r.list_code, action: 'delete', shared: r.is_shared === 1 } });
        return { deleted: 1 };
      });
    },
  };
}

// ---- exports ----
/**
 * List exports (FR-06, BR-02). A register gives `source(actor, req)` -> { def, columns, count(), rows(), title, permission, personal }:
 * the same query and masks as its screen. Up to `core.export.max_rows` the file comes back at once; above it a job writes the file and
 * the person finds it under My Exports (and the event ui.export.completed is published). Every export is audited by the export guard.
 */
export function createExportService({ db, storagePath, jobs, devHeaders = false }) {
  // part 30.06: a bulk export of personal data raises its approval request (02.07) instead of failing with a server error
  const guard = createExportGuard({ db, approvals: createApprovalEngine({ db, handlers: { bulk_personal_export: securityHandlers.bulk_personal_export } }) });
  const sources = new Map();
  const downloadChecks = new Map();
  const sourceParameters = new Map();
  const dir = join(storagePath, 'exports');
  const fileOf = (key) => join(dir, key);
  const currentAccount = ({ userId, user, companyId }) => db.prepare(`SELECT roles_json FROM iam_users
    WHERE id = ? AND username = ? AND (company_id = ? OR company_id IS NULL)
      AND status = 'ACTIVE' AND is_active = 1 AND deleted_at IS NULL`).get(userId, user, companyId);
  const changed = () => forbidden('Your report access changed. Request a new export.');
  const present = (r) => ({ id: r.id, list: r.list_code, format: r.format, status: r.status, rows: r.rows_written || r.rows_planned, fileName: r.file_name, bytes: r.bytes, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at, expiresAt: r.expires_at, filters: JSON.parse(r.query_json) });

  /**
   * The export source of a list. Many modules register a source that hands back their list page ({ data, meta }, the first 100 rows)
   * rather than an export source, and validates the query as its own list route does (a parsed request fails that check). Such a
   * source is asked with the plain query and turned into an export source: the columns and title of the list definition, the export
   * permission of the list where one exists, and the page's rows. A list longer than that page is refused rather than cut short.
   */
  const knownPermission = (key) => Boolean(db.prepare('SELECT 1 FROM iam_permissions WHERE perm_key = ?').get(key));
  function resolve(code, actor, req) {
    const fn = sources.get(code) ?? listExports.source(code);
    if (!fn) throw notFound(`There is no export for ${code}.`);
    let out = null; let first = null;
    try { out = fn(actor, req); } catch (err) { if (err?.code !== 'VALIDATION_ERROR') throw err; first = err; }
    if (out && typeof out.rows === 'function') return out;
    let page = Array.isArray(out?.data) ? out : null;
    // only a source that is a list page in disguise is retried with the plain query; a real refusal of the request (a field it does not allow) stands
    if (!page) { try { page = fn(actor, queryOf(req)); } catch (err) { throw first ?? err; } }
    const def = listRegistry.get(code);
    if (!def || !Array.isArray(page?.data)) { if (first) throw first; throw notFound(`There is no export for ${code}.`); }
    const total = Number(page.meta?.total ?? page.data.length);
    if (total > page.data.length) throw unprocessable(`This list can export ${page.data.length} rows at a time and holds ${total} with these filters. Narrow the filters and export in parts.`);
    const exportKey = def.permission ? `${def.permission.replace(/\.view$/, '')}.export` : null;
    return {
      title: def.label,
      permission: exportKey && knownPermission(exportKey) ? exportKey : def.permission,
      personal: Boolean(def.personal),
      columns: Object.entries(def.columns).map(([key, c]) => ({ key, label: c.label ?? key, type: c.type })),
      count: () => total,
      rows: () => page.data,
      describe: (r) => [r.q ? `search "${r.q}"` : '', ...(r.filters ?? []).map((x) => `${def.columns[x.key]?.label ?? x.key} ${x.op} ${x.raw}`)].filter(Boolean).join('; '),
    };
  }

  function build(actor, code, req, format) {
    const src = resolve(code, actor, req);
    const rows = src.rows();
    const generatedAt = istStamp();
    const footer = footerLines({ title: src.title, generatedBy: actor.user, generatedAt, filters: src.describe(req), rows: rows.length });
    const buffer = writeExport(format, { columns: src.columns, rows, footer, title: src.title, sheetName: src.title });
    const digits = generatedAt.replace(/\D/g, '');
    const fileName = `${code.replace(/\./g, '-')}-${digits.slice(0, 8)}-${digits.slice(8, 12)}.${format}`;
    return { buffer, rows: rows.length, fileName, src };
  }

  const service = {
    /** Whether a list has an export: a source of its own here, or one its module registered (listExports). */
    has: (code) => Boolean(sources.get(code) ?? listExports.source(code)),
    register(code, source, { checkAccess = undefined, parameters = [] } = {}) {
      sources.set(code, source);
      if (checkAccess) downloadChecks.set(code, checkAccess);
      if (parameters.length) sourceParameters.set(code, parameters);
    },

    /** Export now, or queue a job when the export is larger than a direct download may be. */
    start(actor, code, query, { queued = false } = {}) {
      if (!(sources.get(code) ?? listExports.source(code))) throw notFound(`There is no export for ${code}.`);
      const def = listRegistry.get(code);
      const parameters = sourceParameters.get(code) ?? [];
      const req = parseListRequest(def, query, { extra: ['format', 'approvalId', ...parameters] });
      const format = String(req.format ?? 'csv');
      if (!FORMATS[format]) throw badRequest('Some fields are invalid.', [{ field: 'format', message: 'Use xlsx, csv or pdf' }]);
      const src = resolve(code, actor, req);
      const count = src.count();
      const background = queued || count > guard.maxRows(actor.companyId);
      const approvalId = req.approvalId == null || req.approvalId === '' ? null : Number(req.approvalId);
      if (approvalId != null && !Number.isSafeInteger(approvalId)) throw badRequest('Some fields are invalid.', [{ field: 'approvalId', message: 'The number of the approved request' }]);
      const grant = guard.authorize(actor, { report: code, permission: src.permission, rows: count, personal: Boolean(src.personal), filters: filtersOf(req), anywhere: true, background, approvalId });
      if (grant.status === 'APPROVAL_REQUIRED') throw unprocessable(`This export holds ${count} people's records: it needs the approval of the HR manager or a director. Request ${grant.request.id} is waiting; export again with approvalId=${grant.request.id} once it is approved.`, [{ field: 'approvalId', message: String(grant.request.id) }]);
      if (!background) {
        let out;
        try {
          out = build(actor, code, req, format);
          guard.complete(actor, { report: code, format, rows: out.rows, filters: filtersOf(req), personal: Boolean(src.personal), approvalId: grant.approvalId ?? null });
        } catch (err) { guard.release(actor, grant.approvalId, err?.message); throw err; }
        return { kind: 'file', ...out, contentType: FORMATS[format] };
      }
      // an export that cannot be queued gives its approval back (one cancelled while queued keeps it spent: the person asks again)
      try { return transaction(db, () => {
        const savedQuery = queryOf(req);
        for (const parameter of parameters) {
          if (req[parameter] !== undefined) savedQuery[parameter] = req[parameter];
        }
        const scope = downloadChecks.get(code)?.(actor, savedQuery);
        const id = Number(db.prepare("INSERT INTO ui_export_jobs (company_id, user_id, user_ref, list_code, format, query_json, actor_json, status, rows_planned, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, 'list_export')")
          .run(actor.companyId, actor.userId ?? null, actor.user, code, format, JSON.stringify(savedQuery), JSON.stringify({ user: actor.user, userId: actor.userId ?? null, roles: actor.roles ?? [], companyId: actor.companyId, scope, approvalId: grant.approvalId ?? null }), count, actor.user).lastInsertRowid);
        const job = jobs.enqueue('ui.export', { exportId: id }, { createdBy: actor.user, companyId: actor.companyId });
        db.prepare('UPDATE ui_export_jobs SET job_id = ? WHERE id = ?').run(job.id, id);
        writeAudit(db, { entity: 'ui_export_jobs', entityId: id, action: 'queue', newValues: { list: code, format, rows: count, filters: filtersOf(req) }, actor: actor.user, companyId: actor.companyId });
        return { kind: 'job', ...present(db.prepare('SELECT * FROM ui_export_jobs WHERE id = ?').get(id)) };
      }); } catch (err) { guard.release(actor, grant.approvalId, err?.message); throw err; }
    },

    /** The job: replay the screen's query as the person who asked (their scope and masks), write the file, keep it for 7 days. */
    /** `final`: the job's last attempt; if it fails, its file is removed and the approval the export was let through on is given back. An export
     *  whose approval was given back does not run again (a retried job): the person exports again, on a fresh check of the approval. */
    /** @param {number} exportId @param {(message: string) => void} [log] @param {{ final?: boolean }} [options] */
    run(exportId, log = (_message) => {}, { final = false } = {}) {
      const r = db.prepare('SELECT * FROM ui_export_jobs WHERE id = ?').get(exportId);
      if (!r || r.status === 'DONE') return { skipped: true };
      db.prepare("UPDATE ui_export_jobs SET status = 'RUNNING', updated_at = ? WHERE id = ?").run(nowIso(), exportId);
      let written = null;
      try {
        const check = downloadChecks.get(r.list_code);
        const savedActor = JSON.parse(r.actor_json);
        if (savedActor.approvalReleased) throw unprocessable('The approval of this export was given back when it failed. Export again.');
        if (check && savedActor.userId != null) {
          const account = currentAccount(savedActor);
          if (!account) throw changed();
          savedActor.roles = JSON.parse(account.roles_json);
        }
        const actor = authzOf(db).enrich(savedActor);
        const savedQuery = JSON.parse(r.query_json);
        if (check && check(actor, savedQuery) !== actor.scope) throw changed();
        const req = parseListRequest(listRegistry.get(r.list_code), { ...savedQuery, pageSize: '25' }, { extra: sourceParameters.get(r.list_code) ?? [] });
        const out = build(actor, r.list_code, req, r.format);
        mkdirSync(dir, { recursive: true });
        const key = `${r.company_id}-${r.id}-${Date.now().toString(36)}.${r.format}`;
        writeFileSync(fileOf(key), out.buffer); written = key;
        const at = nowIso();
        db.prepare("UPDATE ui_export_jobs SET status = 'DONE', rows_written = ?, file_name = ?, storage_key = ?, bytes = ?, finished_at = ?, expires_at = ?, updated_at = ? WHERE id = ?")
          .run(out.rows, out.fileName, key, out.buffer.length, at, new Date(Date.now() + 7 * 86_400_000).toISOString(), at, exportId);
        guard.complete(actor, { report: r.list_code, format: r.format, rows: out.rows, filters: JSON.parse(r.query_json), personal: Boolean(out.src.personal), approvalId: JSON.parse(r.actor_json).approvalId ?? null });
        publishEvent(db, { type: 'ui.export.completed', entity: 'export_job', entityId: exportId, actorId: actor.user, companyId: r.company_id, data: { list: r.list_code, format: r.format, rows: out.rows } });
        log(`Exported ${out.rows} rows of ${r.list_code} as ${r.format}`);
        return { rows: out.rows };
      } catch (err) {
        if (written) rmSync(fileOf(written), { force: true });
        db.prepare("UPDATE ui_export_jobs SET status = 'FAILED', error = ?, storage_key = NULL, file_name = NULL, bytes = 0, finished_at = ?, updated_at = ? WHERE id = ?").run(String(err.message).slice(0, 500), nowIso(), nowIso(), exportId);
        const saved = JSON.parse(r.actor_json);
        if (final && saved.approvalId != null && !saved.approvalReleased) {
          guard.release({ user: saved.user, companyId: r.company_id }, saved.approvalId, err?.message);
          db.prepare('UPDATE ui_export_jobs SET actor_json = ? WHERE id = ?').run(JSON.stringify({ ...saved, approvalReleased: true }), exportId);
        }
        throw err;
      }
    },

    mine(actor) {
      return db.prepare('SELECT * FROM ui_export_jobs WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(actor.companyId, actor.user).map(present);
    },

    checkAccess(actor, id) {
      const r = db.prepare('SELECT * FROM ui_export_jobs WHERE id = ? AND company_id = ? AND user_ref = ? AND deleted_at IS NULL').get(id, actor.companyId, actor.user);
      if (!r) throw notFound('That export does not exist.');
      const check = downloadChecks.get(r.list_code);
      if (!check) return r;
      const { scope } = JSON.parse(r.actor_json);
      const savedQuery = JSON.parse(r.query_json);
      if (r.user_id != null && r.user_id !== actor.userId) {
        if (!devHeaders || actor.userId != null) throw notFound('That export does not exist.');
        const identified = { ...actor, userId: r.user_id };
        const account = currentAccount(identified);
        if (!account) throw notFound('That export does not exist.');
        const authz = authzOf(db);
        if (check(authz.enrich({ ...identified, roles: JSON.parse(account.roles_json) }), savedQuery) !== scope) throw changed();
        actor = authz.enrich(identified);
      }
      if (check(actor, savedQuery) !== scope) throw changed();
      return r;
    },

    /** The file of a finished export, for the person who asked only. */
    download(actor, id) {
      const r = service.checkAccess(actor, id);
      if (r.status !== 'DONE') throw unprocessable(r.status === 'FAILED' ? `That export failed: ${r.error}` : 'That export is not ready yet.');
      if (r.expires_at && r.expires_at < nowIso()) throw unprocessable('That export has expired (exports are kept for 7 days). Export again.');
      writeAudit(db, { entity: 'ui_export_jobs', entityId: id, action: 'download', newValues: { list: r.list_code, rows: r.rows_written }, actor: actor.user, companyId: actor.companyId });
      return { buffer: readFileSync(fileOf(r.storage_key)), fileName: r.file_name, contentType: FORMATS[r.format], rows: r.rows_written };
    },

    /** Remove expired files (run daily). */
    purge() {
      const old = db.prepare("SELECT id, storage_key FROM ui_export_jobs WHERE status = 'DONE' AND expires_at < ?").all(nowIso());
      for (const r of old) {
        rmSync(fileOf(r.storage_key), { force: true });
        db.prepare("UPDATE ui_export_jobs SET status = 'EXPIRED', storage_key = NULL, updated_at = ? WHERE id = ?").run(nowIso(), r.id);
      }
      return { expired: old.length };
    },
  };
  return service;
}

/** The columns of a list as the browser needs them, with the columns the actor may not see removed from sorting and filtering. */
/** @param {any} actor @param {string} code @param {(actor: any) => string[]} [hiddenFor] */
export function describeFor(actor, code, hiddenFor = (_actor) => []) {
  const def = listRegistry.get(code);
  if (!def) throw notFound(`There is no list called ${code}.`);
  if (def.permission && !hasPermissionAnywhere(actor, def.permission)) throw forbidden(`Your role does not include ${def.permission}.`);
  const masked = new Set(hiddenFor(actor));
  const d = describeList(def);
  return { ...d, columns: d.columns.map((c) => (masked.has(c.key) ? { ...c, sortable: false, filterable: false, operators: [], masked: true } : c)) };
}

/** A money column: the API speaks rupees, the database paise. */
export const moneyColumn = (sql, label, extra = {}) => ({ sql, label, type: 'money', toDb: (v) => toUnits(v, 'money'), ...extra });
export const rupees = (paise) => fromUnits(paise, 'money').toFixed(2);
