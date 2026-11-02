import { z } from 'zod';
import { assertPermission, hasPermission } from '../../platform/auth/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv, toXlsx } from '../../platform/export/index.js';
import { parse } from '../../platform/validation/index.js';
import { todayIST } from '../../../shared/dates.js';

// Part 03.10: the tracker of the migration of existing screens onto the design system (FR-06, FR-07, BR-02). Rows are the pages of the application; a page
// moves Migrated -> Verified only by a person who holds the page's owner role and did not migrate it; a page that another part will rebuild is Scheduled to
// that part. The address a page used to have is a redirect to its address now, and registering one is a change another administrator approves.

export const ROUTE_APPROVAL = 'ui_page_route_change';
const CHAIN = ['SYSADM'];
const MODULES = ['core', 'iam', 'ui'];
const STATUSES = ['NOT_STARTED', 'MIGRATED', 'VERIFIED', 'SCHEDULED'];
const TYPES = ['DASHBOARD', 'LIST', 'OBJECT', 'FORM', 'WORKLIST', 'REPORT'];
const SEVERITY = ['Low', 'Medium', 'High', 'Critical'];

const code = z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/, 'Use a page code such as admin.users');
const route = z.string().trim().max(200).regex(/^\/(?!\/)[A-Za-z0-9/_.-]*$/, 'Use an address inside the application, such as /admin/users');
const version = z.number().int().positive();
export const parsePageCode = (v) => parse(code, v);
export const parseModuleParam = (v) => parse(z.enum(MODULES), v);
export const parseTrackerQuery = (q) => parse(z.object({ module: z.enum(MODULES).optional(), status: z.enum(STATUSES).optional(), type: z.enum(TYPES).optional(), q: z.string().max(100).default(''), defects: z.enum(['open']).optional() }).strict(), q ?? {});
export const parseExportQuery = (q) => parse(z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx'), module: z.enum(MODULES).optional(), status: z.enum(STATUSES).optional(), type: z.enum(TYPES).optional(), q: z.string().max(100).default(''), defects: z.enum(['open']).optional() }).strict(), q ?? {});
export const parseDefect = (b) => parse(z.object({ text: z.string().trim().min(5, 'Say what is wrong in at least 5 characters').max(300), severity: z.enum(SEVERITY), ownerPart: z.string().trim().min(2).max(60), version }).strict(), b);
export const parseResolve = (b) => parse(z.object({ note: z.string().trim().min(5, 'Say what was done in at least 5 characters').max(300), version }).strict(), b);
export const parseTransition = (b) => parse(z.object({ to: z.enum(['MIGRATED', 'VERIFIED', 'SCHEDULED']), reason: z.string().trim().min(5, 'Say why in at least 5 characters').max(500), scheduledPart: z.string().regex(/^\d\d\.\d\d$/, 'Use a part number such as 04.08').optional(), version }).strict().refine((v) => v.to !== 'SCHEDULED' || v.scheduledPart, { message: 'Name the part that will rebuild the page', path: ['scheduledPart'] }), b);
export const parseSignoff = (b) => parse(z.object({ comment: z.string().trim().min(5, 'Say what was checked in at least 5 characters').max(500) }).strict(), b);
export const parseRouteChange = (b) => parse(z.object({ oldRoute: route, reason: z.string().trim().min(5, 'Say why in at least 5 characters').max(500), version }).strict(), b);

const nowIso = () => new Date().toISOString();
const json = (s) => { try { return JSON.parse(s); } catch { return []; } };
const holds = (actor, role) => [...(actor.roles ?? []), ...(actor.grants?.roles ?? [])].includes(role) || [...(actor.roles ?? []), ...(actor.grants?.roles ?? [])].includes('SUPADM');

const present = (r) => {
  const defects = json(r.defects_json);
  return {
    code: r.page_code, module: r.module, label: r.label, oldRoute: r.old_route, newRoute: r.new_route, redirects: r.old_route !== r.new_route, type: r.page_type, status: r.status, ownerRole: r.owner_role,
    migratedInPart: r.migrated_in_part, migratedBy: r.migrated_by, migratedAt: r.migrated_at, verifiedBy: r.verified_by, verifiedAt: r.verified_at, scheduledPart: r.scheduled_part,
    defects, openDefects: defects.filter((d) => d.status === 'OPEN').length, blocking: defects.filter((d) => d.status === 'OPEN' && ['High', 'Critical'].includes(d.severity)).length, notes: r.notes ?? '', version: r.version,
  };
};

/** The approval handler: an approved request registers (or clears) the address a page used to have. */
export const pageRouteHandlers = {
  [ROUTE_APPROVAL]: {
    apply(db, request, actor) {
      const { code: pageCode, oldRoute, baseVersion } = request.payload;
      const row = db.prepare('SELECT * FROM ui_page_migration WHERE page_code = ? AND deleted_at IS NULL').get(pageCode);
      if (!row) throw unprocessable(`The page ${pageCode} no longer exists, so its old address cannot be changed.`);
      if (row.version !== baseVersion) throw unprocessable(`The page ${pageCode} was changed after this request was raised. Raise the change again from its current state.`);
      if (oldRoute !== row.new_route && db.prepare('SELECT 1 FROM ui_page_migration WHERE (new_route = ? OR (old_route = ? AND page_code != ?)) AND deleted_at IS NULL').get(oldRoute, oldRoute, pageCode)) throw unprocessable(`The address ${oldRoute} is a page of the application or already redirects elsewhere.`);
      db.prepare('UPDATE ui_page_migration SET old_route = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(oldRoute, actor.user, nowIso(), row.id);
      writeAudit(db, { entity: 'ui_page_migration', entityId: row.id, action: 'update', oldValues: { oldRoute: row.old_route }, newValues: { oldRoute }, reason: request.reason, actor: actor.user, companyId: request.companyId });
      publishEvent(db, { type: 'ui.page_migration.changed', entity: 'page_migration', entityId: row.id, actorId: actor.user, companyId: request.companyId, data: { code: pageCode, change: 'route' } });
    },
  },
};

export function createPageMigrationService({ db, approvals }) {
  const mustView = (actor) => assertPermission(actor, 'ui.migration.view');
  const mustSign = (actor) => assertPermission(actor, 'ui.migration.signoff');
  const rowOf = (pageCode) => {
    const r = db.prepare('SELECT * FROM ui_page_migration WHERE page_code = ? AND deleted_at IS NULL').get(pageCode);
    if (!r) throw notFound(`There is no page called ${pageCode} in the tracker.`);
    return r;
  };
  const checkVersion = (r, v) => { if (v !== undefined && v !== r.version) throw conflict('This page was changed by someone else. Reload it and try again.'); };
  const ownerOnly = (actor, r) => { if (!holds(actor, r.owner_role)) throw forbidden(`Only the owner of this page (the role ${r.owner_role}) can do that.`); };
  const touch = (actor, r, patch, action, old, next, reason) => {
    const sets = Object.keys(patch);
    db.prepare(`UPDATE ui_page_migration SET ${sets.map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map((k) => patch[k]), actor.user, nowIso(), r.id);
    writeAudit(db, { entity: 'ui_page_migration', entityId: r.id, action, oldValues: old, newValues: next, reason, actor: actor.user, companyId: actor.companyId });
    publishEvent(db, { type: 'ui.page_migration.changed', entity: 'page_migration', entityId: r.id, actorId: actor.user, companyId: actor.companyId, data: { code: r.page_code, change: action } });
    return present(rowOf(r.page_code));
  };

  const filtered = (q) => {
    const needle = (q.q ?? '').trim().toLowerCase();
    return db.prepare('SELECT * FROM ui_page_migration WHERE deleted_at IS NULL ORDER BY module, page_code').all().map(present)
      .filter((p) => (!q.module || p.module === q.module) && (!q.status || p.status === q.status) && (!q.type || p.type === q.type) && (q.defects !== 'open' || p.openDefects > 0)
        && (!needle || `${p.code} ${p.label} ${p.newRoute} ${p.oldRoute}`.toLowerCase().includes(needle)));
  };

  /** Progress by module and by page type, over every page (the filters narrow the table, not the summary). */
  function summary() {
    const all = db.prepare('SELECT * FROM ui_page_migration WHERE deleted_at IS NULL').all().map(present);
    const count = (list) => ({ total: list.length, notStarted: list.filter((p) => p.status === 'NOT_STARTED').length, migrated: list.filter((p) => p.status === 'MIGRATED').length, verified: list.filter((p) => p.status === 'VERIFIED').length, scheduled: list.filter((p) => p.status === 'SCHEDULED').length, openDefects: list.reduce((n, p) => n + p.openDefects, 0), redirects: list.filter((p) => p.redirects).length });
    return { totals: count(all), byModule: MODULES.map((m) => ({ module: m, ...count(all.filter((p) => p.module === m)) })), byType: TYPES.map((t) => ({ type: t, ...count(all.filter((p) => p.type === t)) })) };
  }

  function list(actor, q) {
    mustView(actor);
    return { rows: filtered(q), summary: summary(), modules: MODULES, types: TYPES, statuses: STATUSES, canSignOff: hasPermission(actor, 'ui.migration.signoff') };
  }

  /** The old addresses and where they lead now: any signed-in person (the browser asks when it lands on an address that is no page). */
  const redirects = () => db.prepare('SELECT old_route, new_route FROM ui_page_migration WHERE old_route != new_route AND deleted_at IS NULL ORDER BY old_route').all().map((r) => ({ from: r.old_route, to: r.new_route }));

  function exportRows(actor, q) {
    mustView(actor);
    const rows = filtered(q).map((p) => ({ code: p.code, module: p.module, label: p.label, type: p.type, status: p.status, oldRoute: p.oldRoute, newRoute: p.newRoute, owner: p.ownerRole, migratedIn: p.migratedInPart ?? '', verifiedBy: p.verifiedBy ?? '', verifiedAt: p.verifiedAt ?? '', scheduledTo: p.scheduledPart ?? '', openDefects: p.openDefects, defects: p.defects.filter((d) => d.status === 'OPEN').map((d) => `${d.id} ${d.severity}: ${d.text}`).join(' | ') }));
    const columns = [['code', 'Page'], ['module', 'Module'], ['label', 'Name'], ['type', 'Page type'], ['status', 'Status'], ['oldRoute', 'Old address'], ['newRoute', 'Address'], ['owner', 'Owner role'], ['migratedIn', 'Migrated in part'], ['verifiedBy', 'Verified by'], ['verifiedAt', 'Verified at'], ['scheduledTo', 'Scheduled to part'], ['openDefects', 'Open defects'], ['defects', 'Defects']].map(([key, label]) => ({ key, label, type: key === 'openDefects' ? 'number' : 'text' }));
    writeAudit(db, { entity: 'ui_page_migration', entityId: 'export', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
    const footer = [`Screen migration tracker, ${rows.length} page(s). Generated by ${actor.user} on ${todayIST()}.`];
    return q.format === 'csv' ? { buffer: toCsv({ columns, rows, footer }), type: 'text/csv; charset=utf-8', fileName: `screen-migration-${todayIST()}.csv` }
      : { buffer: toXlsx({ columns, rows, footer, sheetName: 'Migration' }), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `screen-migration-${todayIST()}.xlsx` };
  }

  function addDefect(actor, pageCode, input) {
    mustSign(actor);
    return transaction(db, () => {
      const r = rowOf(pageCode);
      checkVersion(r, input.version);
      const defects = json(r.defects_json);
      const next = Math.max(0, ...defects.map((d) => Number(/^P-(\d+)$/.exec(d.id)?.[1] ?? 0))) + 1;
      const d = { id: `P-${next}`, text: input.text, severity: input.severity, ownerPart: input.ownerPart, status: 'OPEN', raisedBy: actor.user, raisedAt: nowIso() };
      return touch(actor, r, { defects_json: JSON.stringify([...defects, d]) }, 'defect_added', { openDefects: defects.filter((x) => x.status === 'OPEN').length }, { defect: d.id, severity: d.severity, text: d.text }, null);
    });
  }

  function resolveDefect(actor, pageCode, defectId, input) {
    mustSign(actor);
    return transaction(db, () => {
      const r = rowOf(pageCode);
      checkVersion(r, input.version);
      const defects = json(r.defects_json);
      const d = defects.find((x) => x.id === defectId);
      if (!d) throw notFound(`There is no defect ${defectId} on ${pageCode}.`);
      if (d.status !== 'OPEN') throw unprocessable(`The defect ${defectId} is already ${d.status.toLowerCase()}.`);
      const next = defects.map((x) => (x.id === defectId ? { ...x, status: 'RESOLVED', note: input.note, resolvedBy: actor.user, resolvedAt: nowIso() } : x));
      return touch(actor, r, { defects_json: JSON.stringify(next) }, 'defect_resolved', { defect: defectId, status: 'OPEN' }, { defect: defectId, status: 'RESOLVED' }, input.note);
    });
  }

  /** Verify, reopen or schedule a page. Verify: the owner of the page, not the person who migrated it, and no open High or Critical defect. */
  function transition(actor, pageCode, input) {
    mustSign(actor);
    return transaction(db, () => {
      const r = rowOf(pageCode);
      checkVersion(r, input.version);
      const old = { status: r.status, verifiedBy: r.verified_by, scheduledPart: r.scheduled_part };
      if (input.to === 'VERIFIED') {
        if (r.status !== 'MIGRATED') throw unprocessable(`The page is ${r.status.toLowerCase().replace('_', ' ')}; only a migrated page can be verified.`);
        ownerOnly(actor, r);
        if (r.migrated_by === actor.user) throw forbidden('You migrated this page, so someone else must verify it.');
        const open = present(r).blocking;
        if (open > 0) throw unprocessable(`${open} High or Critical defect(s) are open on this page. Resolve them, or schedule the page to the part that will fix them, before it is verified.`);
        return touch(actor, r, { status: 'VERIFIED', verified_by: actor.user, verified_at: nowIso(), scheduled_part: null }, 'verify', old, { status: 'VERIFIED', verifiedBy: actor.user }, input.reason);
      }
      if (input.to === 'SCHEDULED') {
        if (r.status === 'SCHEDULED' && r.scheduled_part === input.scheduledPart) throw unprocessable('The page is already scheduled to that part.');
        return touch(actor, r, { status: 'SCHEDULED', scheduled_part: input.scheduledPart, verified_by: null, verified_at: null }, 'schedule', old, { status: 'SCHEDULED', scheduledPart: input.scheduledPart }, input.reason);
      }
      if (r.status === 'MIGRATED') throw unprocessable('The page is already migrated.');
      return touch(actor, r, { status: 'MIGRATED', migrated_by: actor.user, migrated_at: nowIso(), verified_by: null, verified_at: null, scheduled_part: null }, r.status === 'VERIFIED' ? 'reopen' : 'migrate', old, { status: 'MIGRATED', migratedBy: actor.user }, input.reason);
    });
  }

  /** Sign off a whole module: every migrated page without a blocking defect is verified; the others are listed with the reason (FR-07). */
  function signoffModule(actor, module, { comment }) {
    mustSign(actor);
    return transaction(db, () => {
      const owner = { core: 'ITADM', iam: 'SYSADM', ui: 'PCMGR' }[module];
      if (!holds(actor, owner)) throw forbidden(`Only the owner of the ${module} module (the role ${owner}) can sign it off.`);
      const rows = db.prepare("SELECT * FROM ui_page_migration WHERE module = ? AND deleted_at IS NULL AND status = 'MIGRATED' ORDER BY page_code").all(module);
      const verified = [];
      const skipped = [];
      for (const r of rows) {
        if (r.migrated_by === actor.user) { skipped.push({ code: r.page_code, reason: 'you migrated it' }); continue; }
        const blocking = present(r).blocking;
        if (blocking > 0) { skipped.push({ code: r.page_code, reason: `${blocking} High or Critical defect(s) open` }); continue; }
        touch(actor, r, { status: 'VERIFIED', verified_by: actor.user, verified_at: nowIso() }, 'verify', { status: 'MIGRATED' }, { status: 'VERIFIED', verifiedBy: actor.user }, comment);
        verified.push(r.page_code);
      }
      writeAudit(db, { entity: 'ui_page_migration', entityId: `module:${module}`, action: 'signoff', newValues: { verified: verified.length, skipped: skipped.length }, reason: comment, actor: actor.user, companyId: actor.companyId });
      return { module, verified, skipped, summary: summary().byModule.find((m) => m.module === module) };
    });
  }

  /** Ask for the old address of a page to be registered, so it redirects: another system administrator approves. */
  function proposeRoute(actor, pageCode, input) {
    mustSign(actor);
    const r = rowOf(pageCode);
    checkVersion(r, input.version);
    if (input.oldRoute === r.old_route) throw unprocessable('That is already the old address of this page.');
    if (input.oldRoute !== r.new_route && db.prepare('SELECT page_code FROM ui_page_migration WHERE (new_route = ? OR old_route = ?) AND page_code != ? AND deleted_at IS NULL').get(input.oldRoute, input.oldRoute, pageCode)) throw badRequest('Some fields are invalid.', [{ field: 'oldRoute', message: 'is a page of the application or already redirects elsewhere' }]);
    if (db.prepare("SELECT 1 FROM core_change_requests WHERE company_id = ? AND type = ? AND target_id = ? AND status = 'SUBMITTED' AND is_active = 1").get(actor.companyId, ROUTE_APPROVAL, r.id)) throw conflict('A change to the old address of this page is already waiting for approval.');
    return approvals.submit(actor, { type: ROUTE_APPROVAL, title: input.oldRoute === r.new_route ? `Remove the redirect to ${r.label}` : `Redirect ${input.oldRoute} to ${r.label}`, targetType: 'page_migration', targetId: r.id, payload: { code: pageCode, oldRoute: input.oldRoute, baseVersion: r.version }, reason: input.reason, chain: CHAIN });
  }

  const pending = (actor) => { mustView(actor); return approvals.list(actor, { type: ROUTE_APPROVAL, status: 'SUBMITTED', limit: 50, offset: 0 }).rows.map((p) => ({ id: p.id, title: p.title, code: p.payload?.code, oldRoute: p.payload?.oldRoute, requestedBy: p.requestedBy, requestedAt: p.requestedAt, reason: p.reason })); };

  return { list, redirects, exportRows, addDefect, resolveDefect, transition, signoffModule, proposeRoute, pending };
}
