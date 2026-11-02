import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { hasPermission, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf, permissionRegistry } from '../../platform/authz/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { objectTypes } from '../../platform/objects/index.js';
import { searchEntities } from '../../platform/search/registry.js';
import { parse } from '../../platform/validation/index.js';

// Part 03.05: the application shell's server side. The navigation registry (filtered per person by permission and feature flag),
// favourites, recently opened records, the remembered working context and the launchpad. Changes to the registry are requests that
// another administrator approves in the approval engine (maker-checker), audited with old and new values.

export const APPROVAL_TYPE = 'ui_nav_change';
export const NAV_CHAIN = ['SYSADM'];
export const SELF = 'self'; // the explicit key for "any signed-in person" (BR-01: an entry without a key is not allowed, except Home and Profile)
const NO_KEY_OK = new Set(['home', 'profile']);
const PROTECTED = new Set(['admin-navigation']); // the page that edits the registry keeps its permission and stays active, so the registry cannot lock itself out
const MAX_FAVOURITES = 30;
const MAX_RECENT = 30;
const iconKeys = (node) => Object.entries(node).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? iconKeys(v) : k.startsWith('erp.') ? [k] : []));
const ICONS = new Set(iconKeys(JSON.parse(readFileSync(new URL('../../../shared/design/icon-registry.json', import.meta.url), 'utf8'))));

const text = (max) => z.string().trim().min(1).max(max);
const route = z.string().trim().max(300).regex(/^\/(?!\/)[A-Za-z0-9/_\-?=&%.]*$/, 'Use a path inside the application, such as /admin/users');
const changeShape = z.object({
  label: text(60).optional(),
  labelHi: z.string().trim().max(60).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  parentCode: z.string().trim().max(60).optional(),
  permissionKey: z.string().trim().max(80).nullable().optional(),
  featureFlag: z.string().trim().max(80).nullable().optional(),
  keywords: z.string().trim().max(300).nullable().optional(),
  mobileVisible: z.boolean().optional(),
  requiresContext: z.enum(['project', 'site']).nullable().optional(),
  shortcut: z.string().trim().length(1).regex(/^[a-z]$/, 'Use a single lower-case letter').nullable().optional(),
  tile: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict();

export const parseNavChange = (b) => parse(z.object({ code: text(60), changes: changeShape, reason: z.string().trim().min(5, 'Say why in at least 5 characters').max(500), version: z.number().int().positive().optional() }).strict(), b);
export const parseNavImport = (b) => parse(z.object({ entries: z.array(z.object({ code: text(60) }).and(changeShape)).min(1).max(100), reason: z.string().trim().min(5).max(500) }).strict(), b);
export const parseFavourite = (b) => parse(z.union([
  z.object({ navCode: text(60) }).strict(),
  z.object({ entity: z.string().max(40).regex(/^[a-z][a-z_]*$/), entityId: z.number().int().positive() }).strict(),
]), b);
export const parseFavouriteOrder = (b) => parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(MAX_FAVOURITES) }).strict(), b);
export const parseVisit = (b) => parse(z.object({ entity: z.string().max(40).regex(/^[a-z][a-z_]*$/), entityId: z.number().int().positive(), title: text(120), route }).strict(), b);
export const parseContext = (b) => parse(z.object({ projectId: z.number().int().positive().nullable().default(null), siteId: z.number().int().positive().nullable().default(null) }).strict(), b);

/** A record type a person can open, favourite or find among their recent records: an Object Page type, or a searchable type of part 03.08. */
const recordType = (entity) => objectTypes.get(entity) ?? searchEntities.get(entity);
const nowIso = () => new Date().toISOString();
const flagList = (rows) => [...new Set(rows.map((r) => r.feature_flag).filter(Boolean))];

/** The columns of a registry entry that a change may set, with the database column of each. */
const COLUMNS = { label: 'label', labelHi: 'label_hi', icon: 'icon', sortOrder: 'sort_order', parentCode: 'parent_code', permissionKey: 'permission_key', featureFlag: 'feature_flag', keywords: 'keywords', mobileVisible: 'mobile_visible', requiresContext: 'requires_context', shortcut: 'shortcut', tile: 'tile', isActive: 'is_active' };
const BOOLEANS = new Set(['mobileVisible', 'tile', 'isActive']);

const presentEntry = (r) => ({
  code: r.code, parentCode: r.parent_code, kind: r.kind, placement: r.placement, label: r.label, labelHi: r.label_hi, route: r.route, icon: r.icon,
  permissionKey: r.permission_key, featureFlag: r.feature_flag, sortOrder: r.sort_order, keywords: r.keywords, mobileVisible: r.mobile_visible === 1,
  requiresContext: r.requires_context, shortcut: r.shortcut, tile: r.tile === 1, isActive: r.is_active === 1, version: r.version,
  quickCreate: r.quick_create_label ? { label: r.quick_create_label, route: r.quick_create_route } : null,
});
const valueOf = (key, v) => (BOOLEANS.has(key) ? (v ? 1 : 0) : v ?? null);

/** The approval handler of this part: an approved request changes the registry in the approver's transaction. */
export const navHandlers = {
  [APPROVAL_TYPE]: {
    apply(db, request, actor) {
      const { code, changes, baseVersion } = request.payload;
      const row = db.prepare('SELECT * FROM ui_navigation_entries WHERE code = ? AND deleted_at IS NULL').get(code);
      if (!row) throw unprocessable(`The navigation entry ${code} no longer exists, so the change cannot be applied.`);
      if (row.version !== baseVersion) throw unprocessable(`The entry ${code} was changed after this request was raised. Raise the change again from its current settings.`);
      const sets = [];
      const params = [];
      const before = {};
      const after = {};
      const entry = presentEntry(row);
      for (const [k, v] of Object.entries(changes)) {
        sets.push(`${COLUMNS[k]} = ?`);
        params.push(valueOf(k, v));
        before[k] = entry[k];
        after[k] = v;
      }
      db.prepare(`UPDATE ui_navigation_entries SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...params, actor.user, nowIso(), row.id);
      writeAudit(db, { entity: 'ui_navigation_entries', entityId: row.id, action: 'update', oldValues: before, newValues: after, reason: request.reason, actor: actor.user, companyId: request.companyId });
      publishEvent(db, { type: 'ui.navigation.changed', entity: 'navigation_entry', entityId: row.id, actorId: actor.user, companyId: request.companyId, data: { code, fields: Object.keys(changes), request: request.id } });
    },
  },
};

/**
 * Navigation (FR-01), favourites and recent records (FR-06), the working context (FR-03) and the launchpad. `flags` is the feature flag
 * service; `approvals` the approval engine (maker-checker for registry changes and the count of requests waiting for a person).
 */
export function createShellService({ db, flags, approvals }) {
  const authz = authzOf(db);
  const user = (actor) => actor.user;

  // ---- navigation ----
  const rowsFor = (actor) => db.prepare('SELECT * FROM ui_navigation_entries WHERE is_active = 1 AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?) ORDER BY sort_order, id').all(actor.companyId);
  // a right held for some projects or sites only still opens the page: the page and its API apply the data scope
  const allowedBy = (actor, key) => (key === null || key === SELF ? true : hasPermissionAnywhere(actor, key));

  function navigation(actor) {
    const rows = rowsFor(actor);
    const on = flags.evaluate(actor, { keys: flagList(rows) });
    const groups = rows.filter((r) => r.kind === 'group');
    const byParent = new Map(groups.map((g) => [g.code, { code: g.code, label: g.label, labelHi: g.label_hi, icon: g.icon, placement: g.placement, shortcut: g.shortcut, pages: [] }]));
    const fieldTiles = new Map(db.prepare('SELECT code, nav_code, label, label_hi, sort_order FROM ui_field_tiles WHERE is_active = 1 AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').all(actor.companyId).map((t) => [t.nav_code, { code: t.code, label: t.label, labelHi: t.label_hi, order: t.sort_order }]));
    const denied = [];
    const quickCreate = [];
    for (const r of rows.filter((x) => x.kind === 'page')) {
      const group = byParent.get(r.parent_code);
      if (!group) continue;
      const permitted = allowedBy(actor, r.permission_key);
      const flagged = !r.feature_flag || on[r.feature_flag] === true;
      if (!permitted || !flagged) {
        denied.push({ route: r.route, label: r.label, reason: permitted ? 'flag' : 'permission', permissionKey: permitted ? null : r.permission_key, featureFlag: permitted ? r.feature_flag : null });
        continue;
      }
      const page = presentEntry(r);
      group.pages.push({ code: page.code, label: page.label, labelHi: page.labelHi, route: page.route, icon: page.icon, keywords: page.keywords ?? '', mobileVisible: page.mobileVisible, requiresContext: page.requiresContext, onboarding: r.onboarding, shortcut: page.shortcut, tile: page.tile, quickCreate: page.quickCreate, field: fieldTiles.get(page.code) ?? null });
      if (page.quickCreate) quickCreate.push({ code: page.code, label: page.quickCreate.label, route: page.quickCreate.route, icon: 'erp.action.create' });
    }
    return { groups: [...byParent.values()].filter((g) => g.pages.length > 0), quickCreate, denied, etag: `${rows.length}-${rows.reduce((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), '')}` };
  }

  /** The page entries the person may open, flat (favourites, recent records and the launchpad are checked against it). */
  const pagesOf = (actor) => navigation(actor).groups.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.code, groupLabel: g.label, placement: g.placement })));

  // ---- registry administration (maker-checker) ----
  const mustManage = (actor) => {
    if (!hasPermission(actor, 'ui.nav.manage')) throw forbidden('Your role does not include ui.nav.manage. Ask a system administrator.');
  };
  const entryRow = (actor, code) => {
    const r = db.prepare('SELECT * FROM ui_navigation_entries WHERE code = ? AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').get(code, actor.companyId);
    if (!r) throw notFound(`There is no navigation entry called ${code}.`);
    return r;
  };
  const flagKeys = () => new Set(db.prepare('SELECT DISTINCT key FROM core_feature_flags').all().map((r) => r.key));

  /** Check a change against the registry rules and return only what differs from what is stored. */
  function checkChange(row, changes) {
    const entry = presentEntry(row);
    const problems = [];
    const real = {};
    for (const [k, v] of Object.entries(changes)) {
      if (k === 'isActive' && v === false && row.kind === 'group') {
        const kids = db.prepare("SELECT COUNT(*) AS n FROM ui_navigation_entries WHERE parent_code = ? AND is_active = 1 AND kind = 'page'").get(row.code).n;
        if (kids > 0) problems.push({ field: k, message: `The group still holds ${kids} active page(s). Move or hide them first.` });
      }
      if (row.kind === 'group' && ['permissionKey', 'featureFlag', 'requiresContext', 'parentCode', 'tile'].includes(k)) problems.push({ field: k, message: 'A group has no such setting; its visibility follows its pages.' });
      if (PROTECTED.has(row.code) && ((k === 'permissionKey' && v !== row.permission_key) || (k === 'isActive' && v === false) || (k === 'featureFlag' && v !== row.feature_flag))) problems.push({ field: k, message: 'The page that edits this registry keeps its permission, flag and place, so the registry cannot lock itself out.' });
      if (k === 'permissionKey') {
        if (v === null && !NO_KEY_OK.has(row.code)) problems.push({ field: k, message: `Every page needs a permission key (use ${SELF} for any signed-in person); only Home and Profile may go without.` });
        else if (v !== null && v !== SELF && !permissionRegistry.get(v)) problems.push({ field: k, message: `${v} is not a permission key of this application.` });
      }
      if (k === 'featureFlag' && v !== null && !flagKeys().has(v)) problems.push({ field: k, message: `${v} is not a feature flag of this application.` });
      if (k === 'icon' && v !== null && !ICONS.has(v)) problems.push({ field: k, message: `${v} is not an icon of the icon registry.` });
      if (k === 'parentCode') {
        const g = db.prepare("SELECT code FROM ui_navigation_entries WHERE code = ? AND kind = 'group' AND is_active = 1").get(v);
        if (!g) problems.push({ field: k, message: `${v} is not a group.` });
      }
      if (k === 'shortcut' && v) {
        const clash = db.prepare('SELECT code FROM ui_navigation_entries WHERE shortcut = ? AND code != ? AND is_active = 1').get(v, row.code);
        if (clash) problems.push({ field: k, message: `The shortcut g ${v} already opens ${clash.code}.` });
      }
      if (k === 'label' && !v) problems.push({ field: k, message: 'A label is needed.' });
      if (valueOf(k, v) !== valueOf(k, entry[k])) real[k] = v;
    }
    if (problems.length) throw badRequest('Some fields are invalid.', problems);
    return real;
  }

  function openRequestFor(actor, row) {
    return db.prepare("SELECT id FROM core_change_requests WHERE company_id = ? AND type = ? AND target_type = 'nav_entry' AND target_id = ? AND status = 'SUBMITTED' AND is_active = 1").get(actor.companyId, APPROVAL_TYPE, row.id);
  }

  function propose(actor, body) {
    mustManage(actor);
    const row = entryRow(actor, body.code);
    if (body.version !== undefined && body.version !== row.version) throw conflict('This entry was changed by someone else. Refresh it and change it again.');
    const changes = checkChange(row, body.changes);
    if (Object.keys(changes).length === 0) throw unprocessable('Nothing is different from the stored settings, so there is nothing to approve.');
    if (openRequestFor(actor, row)) throw conflict('A change to this entry is already waiting for approval.');
    return approvals.submit(actor, { type: APPROVAL_TYPE, title: `Change navigation entry ${row.label}`, targetType: 'nav_entry', targetId: row.id, payload: { code: row.code, changes, baseVersion: row.version }, reason: body.reason, chain: NAV_CHAIN });
  }

  const pendingChanges = (actor) => approvals.list(actor, { type: APPROVAL_TYPE, status: 'SUBMITTED', limit: 100, offset: 0 }).rows.map((r) => ({ id: r.id, title: r.title, code: r.payload?.code, changes: r.payload?.changes, requestedBy: r.requestedBy, requestedAt: r.requestedAt, reason: r.reason, version: r.version }));

  /** A peer-readable shape of the whole registry for the Config page and for export. */
  function registry(actor) {
    mustManage(actor);
    const rows = db.prepare('SELECT * FROM ui_navigation_entries WHERE deleted_at IS NULL AND (company_id IS NULL OR company_id = ?) ORDER BY placement, sort_order, id').all(actor.companyId);
    const groups = new Map(rows.filter((r) => r.kind === 'group').map((g) => [g.code, g.label]));
    const known = [...flagKeys()].sort();
    return {
      entries: rows.map((r) => ({ ...presentEntry(r), groupLabel: groups.get(r.parent_code) ?? null })),
      pending: pendingChanges(actor),
      options: { permissions: [SELF, ...permissionRegistry.list().map((p) => p.key)], flags: known, icons: [...ICONS].sort(), groups: rows.filter((r) => r.kind === 'group').map((g) => ({ code: g.code, label: g.label })) },
    };
  }

  function history(actor, code) {
    mustManage(actor);
    const row = entryRow(actor, code);
    return db.prepare("SELECT id, action, old_values, new_values, reason, actor, created_at FROM core_audit_log WHERE entity = 'ui_navigation_entries' AND entity_id = ? ORDER BY id DESC LIMIT 100").all(String(row.id))
      .map((a) => ({ id: a.id, action: a.action, oldValues: a.old_values ? JSON.parse(a.old_values) : null, newValues: a.new_values ? JSON.parse(a.new_values) : null, reason: a.reason, actor: a.actor, at: a.created_at }));
  }

  const exportSettings = (actor) => {
    mustManage(actor);
    const entries = registry(actor).entries.map((e) => ({ code: e.code, ...Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, e[k]])) }));
    writeAudit(db, { entity: 'ui_navigation_entries', entityId: 'registry', action: 'export', newValues: { entries: entries.length }, actor: actor.user, companyId: actor.companyId });
    return { exportedAt: nowIso(), entries };
  };

  /** Import never writes to the registry: every difference becomes a change request that another administrator approves. */
  function importSettings(actor, body) {
    mustManage(actor);
    const result = { requested: [], unchanged: [], errors: [] };
    for (const e of body.entries) {
      const { code, ...changes } = e;
      try {
        const row = entryRow(actor, code);
        const real = checkChange(row, changes);
        if (Object.keys(real).length === 0) { result.unchanged.push(code); continue; }
        if (openRequestFor(actor, row)) throw conflict('A change to this entry is already waiting for approval.');
        const req = approvals.submit(actor, { type: APPROVAL_TYPE, title: `Change navigation entry ${row.label}`, targetType: 'nav_entry', targetId: row.id, payload: { code, changes: real, baseVersion: row.version }, reason: body.reason, chain: NAV_CHAIN });
        result.requested.push({ code, requestId: req.id });
      } catch (err) {
        result.errors.push({ code, message: err.details?.[0]?.message ?? err.message });
      }
    }
    return result;
  }

  // ---- favourites ----
  const presentFav = (r) => ({ id: r.id, kind: r.kind, navCode: r.nav_code, entity: r.entity, entityId: r.entity_id, title: r.title, route: r.route, sortOrder: r.sort_order });
  const favRows = (actor) => db.prepare('SELECT * FROM ui_favourites WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY sort_order, id').all(actor.companyId, user(actor));

  /** A person's favourites; a page they can no longer open, or a record they can no longer see, is left out. */
  function favourites(actor) {
    const pages = new Map(pagesOf(actor).map((p) => [p.code, p]));
    return favRows(actor).filter((r) => (r.kind === 'page' ? pages.has(r.nav_code) : Boolean(recordType(r.entity)?.access(db, actor, r.entity_id)))).map((r) => {
      const p = r.kind === 'page' ? pages.get(r.nav_code) : null;
      return presentFav({ ...r, title: p?.label ?? r.title, route: p?.route ?? r.route });
    });
  }

  function addFavourite(actor, body) {
    return transaction(db, () => {
      const existing = favRows(actor);
      if (existing.length >= MAX_FAVOURITES) throw unprocessable(`You can keep ${MAX_FAVOURITES} favourites. Remove one first.`);
      let rec;
      if ('navCode' in body) {
        const page = pagesOf(actor).find((p) => p.code === body.navCode);
        if (!page) throw notFound('That page does not exist or is not open to you.');
        rec = { refKey: `nav:${page.code}`, kind: 'page', navCode: page.code, entity: null, entityId: null, title: page.label, route: page.route };
      } else {
        const def = recordType(body.entity);
        const found = def?.access(db, actor, body.entityId);
        if (!def || !found) throw notFound('That record does not exist or is not open to you.');
        const title = db.prepare('SELECT title FROM ui_recent_records WHERE company_id = ? AND user_ref = ? AND entity = ? AND entity_id = ?').get(actor.companyId, user(actor), body.entity, body.entityId)?.title;
        rec = { refKey: `rec:${body.entity}:${body.entityId}`, kind: 'record', navCode: null, entity: body.entity, entityId: body.entityId, title: title ?? `${def.label} ${body.entityId}`, route: def.route ? def.route(body.entityId) : '/home' };
      }
      if (existing.some((r) => r.ref_key === rec.refKey)) throw conflict('That is already one of your favourites.');
      const order = (existing.at(-1)?.sort_order ?? 0) + 10;
      const res = db.prepare(`INSERT INTO ui_favourites (company_id, user_ref, ref_key, kind, nav_code, entity, entity_id, title, route, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'favourite')`)
        .run(actor.companyId, user(actor), rec.refKey, rec.kind, rec.navCode, rec.entity, rec.entityId, rec.title, rec.route, order, user(actor));
      return presentFav(db.prepare('SELECT * FROM ui_favourites WHERE id = ?').get(Number(res.lastInsertRowid)));
    });
  }

  function removeFavourite(actor, id) {
    const r = db.prepare('SELECT id FROM ui_favourites WHERE id = ? AND company_id = ? AND user_ref = ? AND deleted_at IS NULL').get(id, actor.companyId, user(actor));
    if (!r) throw notFound('That favourite does not exist.');
    db.prepare('DELETE FROM ui_favourites WHERE id = ?').run(id);
    return { id };
  }

  function orderFavourites(actor, { ids }) {
    return transaction(db, () => {
      const mine = new Set(favRows(actor).map((r) => r.id));
      if (ids.some((i) => !mine.has(i))) throw badRequest('Some favourites are not yours.', [{ field: 'ids', message: 'contains a favourite that is not yours' }]);
      ids.forEach((id, i) => db.prepare('UPDATE ui_favourites SET sort_order = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run((i + 1) * 10, user(actor), nowIso(), id));
      return favourites(actor);
    });
  }

  // ---- recent records ----
  function visit(actor, body) {
    const def = recordType(body.entity);
    if (!def || !def.access(db, actor, body.entityId)) throw notFound('That record does not exist or is not open to you.');
    return transaction(db, () => {
      const at = nowIso();
      db.prepare(`INSERT INTO ui_recent_records (company_id, user_ref, entity, entity_id, title, route, visited_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visit')
        ON CONFLICT (company_id, user_ref, entity, entity_id) DO UPDATE SET title = excluded.title, route = excluded.route, visited_at = excluded.visited_at, visit_count = visit_count + 1, updated_by = excluded.created_by, updated_at = excluded.visited_at, version = version + 1`)
        .run(actor.companyId, user(actor), body.entity, body.entityId, body.title, body.route, at, user(actor));
      db.prepare(`DELETE FROM ui_recent_records WHERE company_id = ? AND user_ref = ? AND id NOT IN (SELECT id FROM ui_recent_records WHERE company_id = ? AND user_ref = ? ORDER BY visited_at DESC, id DESC LIMIT ${MAX_RECENT})`).run(actor.companyId, user(actor), actor.companyId, user(actor));
      return { entity: body.entity, entityId: body.entityId };
    });
  }

  /** The records a person opened last, newest first, leaving out any they can no longer see. */
  function recent(actor, limit = 10) {
    const rows = db.prepare('SELECT * FROM ui_recent_records WHERE company_id = ? AND user_ref = ? ORDER BY visited_at DESC, id DESC LIMIT 30').all(actor.companyId, user(actor));
    return rows.filter((r) => Boolean(recordType(r.entity)?.access(db, actor, r.entity_id))).slice(0, limit)
      .map((r) => ({ entity: r.entity, entityId: r.entity_id, title: r.title, route: r.route, type: recordType(r.entity)?.label ?? r.entity, visitedAt: r.visited_at }));
  }

  // ---- working context ----
  function scoped(actor) {
    const company = db.prepare('SELECT id, code, legal_name, short_name FROM org_companies WHERE id = ? AND is_active = 1').get(actor.companyId);
    const pf = authz.scopeFilter(actor, 'org.view', { project: 't.id' }).sql;
    const sf = authz.scopeFilter(actor, 'org.view', { project: 't.org_project_id', site: 't.id' }).sql;
    const projects = db.prepare(`SELECT t.id, t.code, t.name, t.status FROM org_projects t WHERE t.company_id = ? AND t.is_active = 1 AND t.status != 'CLOSED' AND ${pf} ORDER BY t.code`).all(actor.companyId);
    const sites = db.prepare(`SELECT t.id, t.code, t.name, t.status, t.org_project_id AS project_id FROM org_sites t WHERE t.company_id = ? AND t.is_active = 1 AND t.status != 'INACTIVE' AND ${sf} ORDER BY t.code`).all(actor.companyId);
    return {
      companies: company ? [{ id: company.id, code: company.code, name: company.short_name, legalName: company.legal_name }] : [],
      projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status })),
      sites: sites.map((s) => ({ id: s.id, code: s.code, name: s.name, status: s.status, projectId: s.project_id })),
    };
  }

  /** The companies, projects and sites in the person's scope, and the choice they made last (dropped when it left their scope). */
  function contextOptions(actor) {
    const opts = scoped(actor);
    const saved = db.prepare('SELECT context_project_id, context_site_id FROM ui_user_context WHERE company_id = ? AND user_ref = ?').get(actor.companyId, user(actor));
    const project = opts.projects.find((p) => p.id === saved?.context_project_id)?.id ?? null;
    const site = project ? opts.sites.find((s) => s.id === saved?.context_site_id && s.projectId === project)?.id ?? null : null;
    return { ...opts, selected: { companyId: actor.companyId, projectId: project, siteId: site } };
  }

  function setContext(actor, { projectId, siteId }) {
    const opts = scoped(actor);
    if (projectId && !opts.projects.some((p) => p.id === projectId)) throw badRequest('Some fields are invalid.', [{ field: 'projectId', message: 'is not a project you can work in' }]);
    if (siteId && !projectId) throw badRequest('Some fields are invalid.', [{ field: 'siteId', message: 'needs the project of the site' }]);
    if (siteId && !opts.sites.some((s) => s.id === siteId && s.projectId === projectId)) throw badRequest('Some fields are invalid.', [{ field: 'siteId', message: 'is not a site of that project that you can work in' }]);
    db.prepare(`INSERT INTO ui_user_context (company_id, user_ref, context_project_id, context_site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'user_context')
      ON CONFLICT (company_id, user_ref) DO UPDATE SET context_project_id = excluded.context_project_id, context_site_id = excluded.context_site_id, updated_by = excluded.created_by, updated_at = ?, version = version + 1`)
      .run(actor.companyId, user(actor), projectId, siteId, user(actor), nowIso());
    return contextOptions(actor);
  }

  // ---- launchpad ----
  function launchpad(actor) {
    const nav = navigation(actor);
    const tiles = nav.groups.filter((g) => g.placement === 'sidebar').flatMap((g) => g.pages.filter((p) => p.tile && p.route !== '/home').map((p) => ({ code: p.code, label: p.label, labelHi: p.labelHi, route: p.route, icon: p.icon, group: g.label })));
    const drafts = db.prepare('SELECT COUNT(*) AS n FROM ui_drafts WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL AND is_active = 1').get(actor.companyId, user(actor)).n;
    const exportsRunning = db.prepare("SELECT COUNT(*) AS n FROM ui_export_jobs WHERE company_id = ? AND user_ref = ? AND status IN ('QUEUED', 'RUNNING')").get(actor.companyId, user(actor)).n;
    return {
      tiles,
      favourites: favourites(actor),
      recent: recent(actor, 8),
      pending: { approvals: approvals.awaitingCount(actor), drafts, exports: exportsRunning },
    };
  }

  /** What the notification bell shows until the notification service (04.06) exists: the requests waiting for this person. */
  const bell = (actor) => ({ unread: approvals.awaitingCount(actor), source: 'approvals' });

  return { navigation, registry, propose, history, exportSettings, importSettings, favourites, addFavourite, removeFavourite, orderFavourites, visit, recent, contextOptions, setContext, launchpad, bell };
}
