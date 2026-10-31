import { assertPermission, assertPermissionAnywhere, hasPermission } from '../../../platform/auth/index.js';
import { authzOf } from '../../../platform/authz/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { geofenceProblems, orgBlockers, testPoint } from '../../../platform/org/index.js';
import { gstinProblem, isStateCode } from '../../../../shared/gst.js';
import { ENTITIES } from './entities.js';

const ACTIVATION_CHAIN = ['PD', 'PCMGR'];
const GEOFENCE_CHAIN = ['SYSADM'];
const ENTITY_TYPE = { departments: 'DEPARTMENT', projects: 'PROJECT', sites: 'SITE' };
const ROLE_EVENT = { HEAD: 'department.head_changed', PROJECT_MANAGER: 'project.manager_changed', IN_CHARGE: 'site.in_charge_changed' };
const STATUS_MOVES = { ACTIVE: ['ON_HOLD', 'COMPLETED'], ON_HOLD: ['ACTIVE', 'COMPLETED'], COMPLETED: ['CLOSED'] };
const HIDDEN = new Set(['company_id', 'created_by', 'updated_by', 'is_active', 'deleted_at', 'deleted_by', 'source_type', 'source_id', 'remarks', 'project_id', 'site_id']);
const LINK_TABLE = { DEPARTMENT: 'org_departments', PROJECT: 'org_projects', SITE: 'org_sites' };
const GEOFENCE_FIELDS = ['latitude', 'longitude', 'geofenceType', 'geofenceRadiusM', 'geofencePolygon'];

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const istDate = (ms) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const centroid = (polygon) => {
  const pts = polygon.slice(0, -1);
  return { latitude: pts.reduce((s, p) => s + p[0], 0) / pts.length, longitude: pts.reduce((s, p) => s + p[1], 0) / pts.length };
};

/** The columns that describe a geofence, set consistently for its type. */
export function geofenceColumns(g) {
  if (!g || g.type === 'NONE') return { geofence_type: 'NONE', geofence_radius_m: null, geofence_polygon_json: null, latitude: g?.latitude ?? null, longitude: g?.longitude ?? null };
  if (g.type === 'CIRCLE') return { geofence_type: 'CIRCLE', geofence_radius_m: g.radiusM, geofence_polygon_json: null, latitude: g.latitude, longitude: g.longitude };
  const c = centroid(g.polygon);
  return { geofence_type: 'POLYGON', geofence_radius_m: null, geofence_polygon_json: JSON.stringify(g.polygon), latitude: c.latitude, longitude: c.longitude };
}
const geofenceOf = (row) => ({ type: row.geofence_type, latitude: row.latitude, longitude: row.longitude, radiusM: row.geofence_radius_m, polygon: row.geofence_polygon_json ? JSON.parse(row.geofence_polygon_json) : null });

/** The approval handlers of this part. The shared approval engine calls them in the approver's transaction (maker-checker). */
export const orgHandlers = {
  org_activation: {
    apply(db, request, actor) {
      const { entity, id } = request.payload;
      const table = entity === 'project' ? 'org_projects' : 'org_sites';
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND is_active = 1`).get(id, request.companyId);
      if (!row) throw unprocessable(`The ${entity} no longer exists, so it cannot be activated.`);
      if (!['DRAFT', 'INACTIVE'].includes(row.status)) throw unprocessable(`The ${entity} is ${row.status}, so it cannot be activated by this request.`);
      if (entity === 'site') {
        const p = db.prepare('SELECT status FROM org_projects WHERE id = ?').get(row.org_project_id);
        if (p?.status !== 'ACTIVE') throw unprocessable('The project of this site is not active yet, so the site cannot be activated.');
      }
      db.prepare(`UPDATE ${table} SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, new Date().toISOString(), id);
      writeAudit(db, { entity: table, entityId: id, action: 'activated', oldValues: { status: row.status }, newValues: { status: 'ACTIVE' }, reason: request.reason, actor: actor.user });
      publishEvent(db, { type: `iam.${entity}.activated`, entity, entityId: id, actorId: actor.user, companyId: request.companyId, siteId: entity === 'site' ? id : null, data: { code: row.code, requestId: request.id } });
    },
  },
  org_geofence_change: {
    apply(db, request, actor) {
      const { siteId, geofence } = request.payload;
      const row = db.prepare('SELECT * FROM org_sites WHERE id = ? AND company_id = ? AND is_active = 1').get(siteId, request.companyId);
      if (!row) throw unprocessable('The site no longer exists, so its geofence cannot be changed.');
      const problems = geofenceProblems(geofence);
      if (problems.length) throw unprocessable(`The requested geofence is no longer valid: ${problems.join(' ')}`);
      const cols = geofenceColumns(geofence);
      db.prepare('UPDATE org_sites SET geofence_type = :geofence_type, geofence_radius_m = :geofence_radius_m, geofence_polygon_json = :geofence_polygon_json, latitude = :latitude, longitude = :longitude, updated_by = :by, updated_at = :at, version = version + 1 WHERE id = :id')
        .run({ ...cols, by: actor.user, at: new Date().toISOString(), id: siteId });
      writeAudit(db, { entity: 'org_sites', entityId: siteId, action: 'geofence_change_approved', oldValues: geofenceOf(row), newValues: geofence, reason: request.reason, actor: actor.user });
      publishEvent(db, { type: 'iam.site.geofence_changed', entity: 'site', entityId: siteId, actorId: actor.user, companyId: request.companyId, siteId, data: { code: row.code, geofenceType: geofence.type, requestId: request.id } });
    },
  },
};

// The entities whose records belong to a project or a site, so a role held for part of the company reaches only its own part (part 02.04).
const SCOPED = new Set(['projects', 'sites', 'cost-centres']);

export function createOrgService({ db, approvals, clock }) {
  const authz = authzOf(db);
  const forbiddenFor = (perm, noun) => forbidden(`Your role does not include ${perm} for this ${noun}. It is outside the projects and sites your assignments cover.`);
  /** What a record is, for the permission engine: which project and site it sits in. */
  function resourceOf(key, row) {
    if (key === 'projects') return { companyId: row.company_id, projectId: row.id };
    if (key === 'sites') return { companyId: row.company_id, projectId: row.org_project_id, siteId: row.id };
    if (key === 'cost-centres') {
      const siteProject = row.linked_type === 'SITE' ? db.prepare('SELECT org_project_id FROM org_sites WHERE id = ?').get(row.linked_id)?.org_project_id : null;
      return { companyId: row.company_id, projectId: row.linked_type === 'PROJECT' ? row.linked_id : (siteProject ?? null), siteId: row.linked_type === 'SITE' ? row.linked_id : null };
    }
    return { companyId: row.company_id };
  }
  /** The actor may do `perm` on this record (a role held company-wide, or a scoped assignment that covers it). */
  const guard = (actor, perm, key, row) => {
    if (!authz.check(actor, perm, resourceOf(key, row)).allowed) throw forbiddenFor(perm, ENTITIES[key].noun);
  };
  /** A SQL condition limiting a list of a scoped entity to what the actor's assignments cover. */
  function scopeCondition(actor, key) {
    if (key === 'projects') return authz.scopeFilter(actor, 'org.view', { project: 't.id' });
    if (key === 'sites') return authz.scopeFilter(actor, 'org.view', { project: 't.org_project_id', site: 't.id' });
    const p = authz.scopeFilter(actor, 'org.view', { project: 't.linked_id' });
    if (p.unrestricted) return p;
    const s = authz.scopeFilter(actor, 'org.view', { site: 't.linked_id' });
    // a cost centre of a site is covered by a grant on the site's project
    const sp = authz.scopeFilter(actor, 'org.view', { project: 's2.org_project_id' });
    return { sql: `((t.linked_type = 'PROJECT' AND ${p.sql}) OR (t.linked_type = 'SITE' AND (${s.sql} OR t.linked_id IN (SELECT s2.id FROM org_sites s2 WHERE ${sp.sql}))))`, unrestricted: false };
  }
  /** Reading needs org.view: for the whole company, or for a scoped entity anywhere (the list is then limited to the scope). */
  const mayRead = (actor, key) => (SCOPED.has(key) ? assertPermissionAnywhere(actor, 'org.view') : assertPermission(actor, 'org.view'));
  const cid = (actor) => companyScope(actor).params._company_scope;
  const today = () => istDate(clock());
  const tableColumns = new Map();
  const columnsOf = (table) => {
    if (!tableColumns.has(table)) tableColumns.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)));
    return tableColumns.get(table);
  };

  const scopeSql = (key, actor) => (ENTITIES[key].scope === 'global' ? (hasPermission(actor, 'org.company.manage') ? '1 = 1' : 't.id = :c') : 't.company_id = :c');
  const select = (key) => `SELECT t.*${ENTITIES[key].extra ? `, ${ENTITIES[key].extra}` : ''} FROM ${ENTITIES[key].table} t`;
  const live = 't.is_active = 1 AND t.deleted_at IS NULL';

  function load(actor, key, id) {
    const scope = scopeSql(key, actor);
    const row = db.prepare(`${select(key)} WHERE t.id = :id AND ${scope} AND ${live}`).get(scope.includes(':c') ? { id, c: cid(actor) } : { id });
    if (!row) throw notFound(`That ${ENTITIES[key].noun} does not exist.`);
    if (SCOPED.has(key) && !authz.check(actor, 'org.view', resourceOf(key, row)).allowed) throw notFound(`That ${ENTITIES[key].noun} does not exist.`);
    return row;
  }

  function present(key, row, actor, raw = false) {
    const e = ENTITIES[key];
    const known = columnsOf(e.table);
    const out = { id: row.id, status: row.status, version: row.version, companyId: row.company_id, createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, canManage: hasPermission(actor, e.permission) };
    for (const [name, spec] of Object.entries(e.fields)) {
      const v = row[spec.col];
      out[name] = spec.kind === 'json' ? (v ? JSON.parse(v) : null) : (v ?? null);
    }
    for (const [k, v] of Object.entries(row)) if (!known.has(k) && !HIDDEN.has(k)) out[camel(k)] = v;
    if (key === 'sites') out.geofence = geofenceOf(row);
    if (key === 'companies' && !raw) return authz.mask(actor, 'org_company', out);
    return out;
  }

  const refRow = (key, id, companyId) => db.prepare(`SELECT * FROM ${ENTITIES[key].table} WHERE id = ? AND company_id = ? AND is_active = 1 AND deleted_at IS NULL`).get(id, companyId);
  const userRow = (id, companyId) => db.prepare("SELECT id, username, display_name FROM iam_users WHERE id = ? AND company_id = ? AND status = 'ACTIVE' AND is_active = 1").get(id, companyId);

  function descendantIds(table, id) {
    return db.prepare(`WITH RECURSIVE d(id) AS (SELECT :id UNION ALL SELECT t.id FROM ${table} t JOIN d ON t.parent_id = d.id WHERE t.is_active = 1) SELECT id FROM d`).all({ id }).map((r) => r.id);
  }

  /** Every rule that needs the database or more than one field. Returns the columns to write. */
  function check(key, companyId, input, current) {
    const e = ENTITIES[key];
    const problems = [];
    const bad = (field, message) => problems.push({ field, message });
    const now = current ? present(key, current, { roles: [] }, true) : {};
    const merged = { ...now, ...input };
    for (const [name, spec] of Object.entries(e.fields)) {
      const v = input[name];
      if (v === undefined || v === null) continue;
      if (spec.kind === 'ref') {
        const ref = refRow(spec.ref, v, companyId);
        if (!ref) bad(name, `That ${ENTITIES[spec.ref].noun} does not exist in this company.`);
        else if (ref.status && ['INACTIVE', 'CLOSED'].includes(ref.status) && v !== now[name]) bad(name, `That ${ENTITIES[spec.ref].noun} is ${ref.status.toLowerCase()}.`);
      }
      if (spec.kind === 'user' && !userRow(v, companyId)) bad(name, 'That user does not exist, is disabled or belongs to another company.');
      if (spec.kind === 'state' && !isStateCode(v)) bad(name, `${v} is not a GST state code.`);
      if (spec.kind === 'gstin') {
        const p = gstinProblem(v, { pan: key === 'companies' ? (merged.pan ?? null) : null });
        if (p) bad(name, p);
        else if (key === 'branches' && merged.stateCode && v.slice(0, 2) !== merged.stateCode) bad(name, 'The state code in the GSTIN differs from the branch state.');
      }
    }
    if (e.parent && input.parentId != null && current) {
      if (input.parentId === current.id || descendantIds(e.table, current.id).includes(input.parentId)) bad('parentId', `A ${e.noun} cannot sit under itself or one of its own descendants.`);
    }
    if (key === 'branches' && input.parentId != null && !problems.length) {
      const parent = refRow('branches', input.parentId, companyId);
      if (parent && parent.kind !== 'REGION') bad('parentId', 'Only a region can have branches under it.');
    }
    if (key === 'projects' && merged.startDate && merged.endDate && merged.endDate < merged.startDate) bad('endDate', 'The end date cannot be before the start date.');
    if (key === 'cost-centres') {
      if ((merged.linkedType == null) !== (merged.linkedId == null)) bad('linkedId', 'Give both the type and the record it is linked to, or neither.');
      else if (merged.linkedType && (input.linkedType !== undefined || input.linkedId !== undefined)) {
        const t = db.prepare(`SELECT id FROM ${LINK_TABLE[merged.linkedType]} WHERE id = ? AND company_id = ? AND is_active = 1`).get(merged.linkedId, companyId);
        if (!t) bad('linkedId', `That ${merged.linkedType.toLowerCase()} does not exist in this company.`);
      }
    }
    const extra = {};
    if (key === 'sites') {
      if (merged.workingStart && merged.workingEnd && merged.workingEnd <= merged.workingStart) bad('workingEnd', 'Working hours must end after they start.');
      if (input.projectId != null) {
        const p = refRow('projects', input.projectId, companyId);
        if (p && ['COMPLETED', 'CLOSED'].includes(p.status)) bad('projectId', `The project is ${p.status.toLowerCase()}; sites cannot be added to it.`);
      }
      if (GEOFENCE_FIELDS.some((f) => f in input)) {
        const g = { type: merged.geofenceType ?? 'NONE', latitude: merged.latitude, longitude: merged.longitude, radiusM: merged.geofenceRadiusM, polygon: merged.geofencePolygon };
        for (const message of geofenceProblems(g)) bad('geofence', message);
        if (!problems.length) Object.assign(extra, geofenceColumns(g));
      }
    }
    if (problems.length) throw badRequest('Some fields are invalid. Fix them and try again.', problems);
    return extra;
  }

  /** Is the code already used where it must be unique (BR-01)? */
  function assertCodeFree(key, companyId, cols, selfId = null) {
    const e = ENTITIES[key];
    const where = { code: cols.code, self: selfId ?? 0 };
    let scope = '';
    if (key === 'sites') { scope = 'AND org_project_id = :p'; where.p = cols.org_project_id; }
    else if (key !== 'companies') { scope = 'AND company_id = :c'; where.c = companyId; }
    if (e.parent) { scope += ' AND COALESCE(parent_id, 0) = :par'; where.par = cols.parent_id ?? 0; }
    const dupe = db.prepare(`SELECT id FROM ${e.table} WHERE code = :code AND id != :self ${scope}`).get(where);
    if (dupe) throw conflict(`The code ${cols.code} is already used by another ${e.noun}${e.parent ? ' under the same parent' : key === 'sites' ? ' in this project' : ''}. Choose a different code.`, [{ field: 'code', message: `The code ${cols.code} is already used. Choose a different code.` }]);
  }

  /** @returns {Record<string, any>} */
  const toColumns = (key, input) => {
    /** @type {Record<string, any>} */
    const cols = {};
    for (const [name, spec] of Object.entries(ENTITIES[key].fields)) {
      if (!(name in input) || spec.assigned) continue;
      cols[spec.col] = spec.kind === 'json' ? (input[name] == null ? null : JSON.stringify(input[name])) : (input[name] ?? null);
    }
    return cols;
  };
  const currentApi = (key, row) => present(key, row, { roles: [] }, true);

  function event(key, verb, row, actor, data = {}) {
    const e = ENTITIES[key];
    publishEvent(db, {
      type: `iam.${e.event}.${verb}`, entity: e.event, entityId: row.id, actorId: actor.user, companyId: key === 'companies' ? row.id : row.company_id, siteId: key === 'sites' ? row.id : null,
      data: { code: row.code, ...data },
    });
  }

  function writeAssignment(key, row, spec, userId, from, reason, actor, applied) {
    const type = ENTITY_TYPE[key];
    const companyId = row.company_id;
    db.prepare('INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, applied, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, type, row.id, spec.assigned, userId, from, applied ? 1 : 0, reason, actor.user, 'org_assignment');
    if (applied) db.prepare(`UPDATE ${ENTITIES[key].table} SET ${spec.col} = ? WHERE id = ?`).run(userId, row.id);
  }

  const assignedSpec = (key) => Object.values(ENTITIES[key].fields).find((s) => s.assigned);

  function applyAssignment(a, actorName) {
    const key = Object.keys(ENTITY_TYPE).find((k) => ENTITY_TYPE[k] === a.entity_type);
    const e = ENTITIES[key];
    const spec = assignedSpec(key);
    const open = db.prepare('SELECT * FROM org_assignments WHERE entity_type = ? AND entity_id = ? AND role = ? AND applied = 1 AND effective_to IS NULL AND is_active = 1').get(a.entity_type, a.entity_id, a.role);
    const from = open && open.effective_from > a.effective_from ? open.effective_from : a.effective_from;
    if (open) db.prepare('UPDATE org_assignments SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(from, actorName, new Date(clock()).toISOString(), open.id);
    db.prepare('UPDATE org_assignments SET applied = 1, effective_from = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(from, actorName, new Date(clock()).toISOString(), a.id);
    db.prepare(`UPDATE ${e.table} SET ${spec.col} = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(a.user_id, actorName, new Date(clock()).toISOString(), a.entity_id);
    const row = db.prepare(`SELECT * FROM ${e.table} WHERE id = ?`).get(a.entity_id);
    writeAudit(db, { entity: e.table, entityId: a.entity_id, action: 'assignment_applied', oldValues: { [spec.assigned]: open?.user_id ?? null }, newValues: { [spec.assigned]: a.user_id, effectiveFrom: from }, actor: actorName });
    publishEvent(db, { type: `iam.${ROLE_EVENT[a.role]}`, entity: e.event, entityId: a.entity_id, actorId: actorName, companyId: a.company_id, siteId: key === 'sites' ? a.entity_id : null, data: { code: row.code, userId: a.user_id, effectiveFrom: from } });
  }

  function builtInBlockers(key, row) {
    const e = ENTITIES[key];
    const found = [];
    for (const [type, sql, hint] of e.block) {
      const n = db.prepare(sql).get({ id: row.id }).n;
      if (n > 0) found.push({ type, count: n, hint });
    }
    for (const b of orgBlockers.collect(db, e.event, { companyId: key === 'companies' ? row.id : row.company_id, id: row.id })) found.push({ type: b.type, count: b.count, hint: b.hint ?? '', source: b.source });
    return found;
  }
  const blockedError = (key, row, blockers) =>
    unprocessable(
      `The ${ENTITIES[key].noun} ${row.code} cannot be deactivated while it still has: ${blockers.map((b) => `${b.count} ${b.type}`).join('; ')}. Clear these first, then try again.`,
      blockers.map((b) => ({ field: 'blockers', message: `${b.count} ${b.type}. ${b.hint}`.trim(), type: b.type, count: b.count })),
    );

  const targetOf = { projects: 'org_project', sites: 'org_site' };

  const service = {
    list(actor, key, query) {
      mayRead(actor, key);
      const e = ENTITIES[key];
      const scope = scopeSql(key, actor);
      const params = { q: likePattern(query.q) };
      if (scope.includes(':c')) params.c = cid(actor);
      const where = [scope, live, ...(SCOPED.has(key) ? [scopeCondition(actor, key).sql] : []), `(${e.search.map((c) => `${c} LIKE :q ESCAPE '\\'`).join(' OR ')})`];
      for (const [name, value] of Object.entries(query.filters)) {
        where.push(`${e.filterable[name]} = :f_${name}`);
        params[`f_${name}`] = value;
      }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM ${e.table} t WHERE ${where.join(' AND ')}`).get(params).n;
      const order = orderBySql(query.sort, e.sortable, 't.id');
      const rows = db.prepare(`${select(key)} WHERE ${where.join(' AND ')} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((r) => present(key, r, actor)), total, query);
    },

    get(actor, key, id) {
      mayRead(actor, key);
      return present(key, load(actor, key, id), actor);
    },

    create(actor, key, input, ctx) {
      const e = ENTITIES[key];
      if (key === 'sites') {
        assertPermissionAnywhere(actor, e.permission);
        if (!authz.check(actor, e.permission, { companyId: actor.companyId, projectId: input.projectId }).allowed) throw forbiddenFor(e.permission, 'project');
      } else assertPermission(actor, e.permission);
      const companyId = key === 'companies' ? null : cid(actor);
      if (companyId != null && !db.prepare('SELECT 1 FROM org_companies WHERE id = ? AND is_active = 1').get(companyId)) {
        throw unprocessable(`Company ${companyId} has no company record yet. A system administrator creates it under Organisation, then its data can be added.`);
      }
      return transaction(db, () => {
        const extra = check(key, companyId, input, null);
        const cols = /** @type {Record<string, any>} */ ({ ...toColumns(key, input), ...extra });
        if (key === 'sites') {
          const project = refRow('projects', input.projectId, companyId);
          if (!project) throw badRequest('Some fields are invalid.', [{ field: 'projectId', message: 'That project does not exist in this company.' }]);
          cols.company_id = companyId;
        } else if (key !== 'companies') cols.company_id = companyId;
        assertCodeFree(key, companyId, cols);
        const names = Object.keys(cols);
        const res = db.prepare(`INSERT INTO ${e.table} (${[...names, 'created_by', 'source_type'].join(', ')}) VALUES (${[...names.map((n) => `:${n}`), ':created_by', ':source_type'].join(', ')})`)
          .run({ ...cols, created_by: actor.user, source_type: 'org_master' });
        const id = Number(res.lastInsertRowid);
        if (key === 'companies') db.prepare('UPDATE org_companies SET company_id = id WHERE id = ?').run(id);
        const row = db.prepare(`SELECT * FROM ${e.table} WHERE id = ?`).get(id);
        const spec = assignedSpec(key);
        if (spec && input[Object.keys(e.fields).find((n) => e.fields[n] === spec)] != null) {
          writeAssignment(key, row, spec, input[Object.keys(e.fields).find((n) => e.fields[n] === spec)], today(), 'Initial assignment', actor, true);
        }
        writeAudit(db, { entity: e.table, entityId: id, action: 'create', newValues: input, actor: actor.user, correlationId: ctx.correlationId });
        event(key, 'created', row, actor, { name: row.name ?? row.legal_name });
        return present(key, load(actor, key, id), actor);
      });
    },

    update(actor, key, id, body, ctx) {
      const e = ENTITIES[key];
      (SCOPED.has(key) ? assertPermissionAnywhere : assertPermission)(actor, e.permission);
      const { version, reason, ...input } = body;
      if (Object.keys(input).length === 0) throw badRequest('Nothing to change: send at least one field.');
      return transaction(db, () => {
        /** @type {any} */
        const row = load(actor, key, id);
        if (SCOPED.has(key)) guard(actor, e.permission, key, row);
        assertVersion(row.version, version, `The ${e.noun} ${row.code}`, 'Refresh the page and try again.');
        const before = currentApi(key, row);
        if (key === 'projects' && row.status === 'CLOSED') throw unprocessable('A closed project cannot be edited.');
        if (key === 'sites' && row.status !== 'DRAFT') {
          const changed = GEOFENCE_FIELDS.filter((f) => f in input && !sameJson(input[f], before[f]));
          if (changed.length) throw unprocessable('The location and geofence of a site that is not a draft change only through an approved geofence change request. Raise one from the site page.');
        }
        const companyId = key === 'companies' ? null : row.company_id;
        const extra = check(key, companyId, input, row);
        const cols = /** @type {Record<string, any>} */ ({ ...toColumns(key, input), ...extra });
        if ('code' in cols || 'parent_id' in cols) assertCodeFree(key, companyId, { code: cols.code ?? row.code, parent_id: 'parent_id' in cols ? cols.parent_id : row.parent_id, org_project_id: row.org_project_id }, row.id);
        const set = Object.keys(cols).map((n) => `${n} = :${n}`);
        const res = db.prepare(`UPDATE ${e.table} SET ${[...set, 'updated_by = :by', 'updated_at = :at', 'version = version + 1'].join(', ')} WHERE id = :id AND version = :version`)
          .run({ ...cols, by: actor.user, at: new Date(clock()).toISOString(), id, version: row.version });
        if (Number(res.changes) !== 1) throw conflict(`The ${e.noun} was changed by someone else. Refresh and try again.`);
        const after = currentApi(key, db.prepare(`SELECT * FROM ${e.table} WHERE id = ?`).get(id));
        const names = Object.keys(input);
        writeAudit(db, { entity: e.table, entityId: id, action: 'update', oldValues: Object.fromEntries(names.map((n) => [n, before[n]])), newValues: Object.fromEntries(names.map((n) => [n, after[n]])), reason: reason ?? null, actor: actor.user, correlationId: ctx.correlationId });
        event(key, 'updated', db.prepare(`SELECT * FROM ${e.table} WHERE id = ?`).get(id), actor, { fields: names });
        return present(key, load(actor, key, id), actor);
      });
    },

    blockers(actor, key, id) {
      mayRead(actor, key);
      const row = load(actor, key, id);
      return builtInBlockers(key, row);
    },

    deactivate(actor, key, id, { reason, version }, ctx) {
      const e = ENTITIES[key];
      (SCOPED.has(key) ? assertPermissionAnywhere : assertPermission)(actor, e.permission);
      if (key === 'projects') throw unprocessable('A project is not deactivated: complete and then close it with the status action.');
      return transaction(db, () => {
        /** @type {any} */
        const row = load(actor, key, id);
        if (SCOPED.has(key)) guard(actor, e.permission, key, row);
        assertVersion(row.version, version, `The ${e.noun} ${row.code}`, 'Refresh the page and try again.');
        if (row.status === 'INACTIVE') throw unprocessable(`The ${e.noun} ${row.code} is already inactive.`);
        const blockers = builtInBlockers(key, row);
        if (blockers.length) throw blockedError(key, row, blockers);
        db.prepare("UPDATE " + e.table + " SET status = 'INACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, new Date(clock()).toISOString(), id);
        writeAudit(db, { entity: e.table, entityId: id, action: 'deactivate', oldValues: { status: row.status }, newValues: { status: 'INACTIVE' }, reason, actor: actor.user, correlationId: ctx.correlationId });
        event(key, 'deactivated', row, actor, { reason });
        return present(key, load(actor, key, id), actor);
      });
    },

    activate(actor, key, id, { reason, version }, ctx) {
      const e = ENTITIES[key];
      (SCOPED.has(key) ? assertPermissionAnywhere : assertPermission)(actor, e.permission);
      if (e.controlled) throw unprocessable(`A ${e.noun} is activated only through an approval request (project director, then project control). Raise one from its page.`);
      return transaction(db, () => {
        /** @type {any} */
        const row = load(actor, key, id);
        if (SCOPED.has(key)) guard(actor, e.permission, key, row);
        assertVersion(row.version, version, `The ${e.noun} ${row.code}`, 'Refresh the page and try again.');
        if (row.status !== 'INACTIVE') throw unprocessable(`The ${e.noun} ${row.code} is already active.`);
        db.prepare("UPDATE " + e.table + " SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, new Date(clock()).toISOString(), id);
        writeAudit(db, { entity: e.table, entityId: id, action: 'activate', oldValues: { status: 'INACTIVE' }, newValues: { status: 'ACTIVE' }, reason, actor: actor.user, correlationId: ctx.correlationId });
        event(key, 'activated', row, actor, { reason });
        return present(key, load(actor, key, id), actor);
      });
    },

    /** ON_HOLD, resume, COMPLETED, CLOSED. A first activation, and any other route to ACTIVE from DRAFT, is an approval. */
    projectStatus(actor, id, { status, reason, version }, ctx) {
      assertPermissionAnywhere(actor, ENTITIES.projects.permission);
      return transaction(db, () => {
        const row = load(actor, 'projects', id);
        guard(actor, ENTITIES.projects.permission, 'projects', row);
        assertVersion(row.version, version, `The project ${row.code}`, 'Refresh the page and try again.');
        if (row.status === 'DRAFT' && status === 'ACTIVE') throw unprocessable('A new project is activated only through an approval request (project director, then project control).');
        if (!(STATUS_MOVES[row.status] ?? []).includes(status)) throw unprocessable(`A project that is ${row.status} cannot move to ${status}.`);
        if (['COMPLETED', 'CLOSED'].includes(status)) {
          const blockers = builtInBlockers('projects', row);
          if (blockers.length) throw blockedError('projects', row, blockers);
        }
        db.prepare('UPDATE org_projects SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, new Date(clock()).toISOString(), id);
        writeAudit(db, { entity: 'org_projects', entityId: id, action: 'status_change', oldValues: { status: row.status }, newValues: { status }, reason, actor: actor.user, correlationId: ctx.correlationId });
        event('projects', 'status_changed', row, actor, { from: row.status, to: status, reason });
        return present('projects', load(actor, 'projects', id), actor);
      });
    },

    descendants(actor, key, id) {
      mayRead(actor, key);
      const e = ENTITIES[key];
      if (!e.parent) throw notFound(`A ${e.noun} has no hierarchy.`);
      load(actor, key, id);
      const rows = db.prepare(`WITH RECURSIVE d(id, depth) AS (SELECT :id, 0 UNION ALL SELECT t.id, d.depth + 1 FROM ${e.table} t JOIN d ON t.parent_id = d.id WHERE t.is_active = 1)
        SELECT t.id, t.code, t.name, t.parent_id, t.status, d.depth FROM d JOIN ${e.table} t ON t.id = d.id ORDER BY d.depth, t.code`).all({ id });
      return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, parentId: r.parent_id, status: r.status, depth: r.depth }));
    },

    // ---- effective-dated assignments (FR-07) ----
    assign(actor, key, id, { userId, effectiveFrom, reason }, ctx) {
      const e = ENTITIES[key];
      const spec = assignedSpec(key);
      if (!spec) throw notFound(`A ${e.noun} has no assigned person.`);
      (SCOPED.has(key) ? assertPermissionAnywhere : assertPermission)(actor, e.permission);
      return transaction(db, () => {
        /** @type {any} */
        const row = load(actor, key, id);
        if (SCOPED.has(key)) guard(actor, e.permission, key, row);
        if (userId != null && !userRow(userId, row.company_id)) throw badRequest('Some fields are invalid.', [{ field: 'userId', message: 'That user does not exist, is disabled or belongs to another company.' }]);
        const open = db.prepare('SELECT * FROM org_assignments WHERE entity_type = ? AND entity_id = ? AND role = ? AND applied = 1 AND effective_to IS NULL AND is_active = 1').get(ENTITY_TYPE[key], id, spec.assigned);
        if (open && (open.user_id ?? null) === userId && effectiveFrom <= today()) throw unprocessable('That person already holds this role.');
        if (open && effectiveFrom < open.effective_from) throw unprocessable(`The change cannot start before the current holder's start date (${open.effective_from}).`);
        const pending = db.prepare('SELECT id, effective_from FROM org_assignments WHERE entity_type = ? AND entity_id = ? AND role = ? AND applied = 0 AND is_active = 1').get(ENTITY_TYPE[key], id, spec.assigned);
        if (effectiveFrom > today()) {
          if (pending) throw conflict('There is already a change waiting to take effect. Cancel it first.');
          writeAssignment(key, row, spec, userId, effectiveFrom, reason, actor, false);
          writeAudit(db, { entity: e.table, entityId: id, action: 'assignment_scheduled', newValues: { [spec.assigned]: userId, effectiveFrom }, reason, actor: actor.user, correlationId: ctx.correlationId });
          return { applied: false, effectiveFrom };
        }
        if (pending && pending.effective_from <= effectiveFrom) throw conflict('A later change is already waiting; cancel it before making an earlier one.');
        const created = db.prepare('INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, applied, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
          .run(row.company_id, ENTITY_TYPE[key], id, spec.assigned, userId, effectiveFrom, reason, actor.user, 'org_assignment');
        applyAssignment(db.prepare('SELECT * FROM org_assignments WHERE id = ?').get(Number(created.lastInsertRowid)), actor.user);
        return { applied: true, effectiveFrom };
      });
    },

    cancelAssignment(actor, key, id, assignmentId) {
      (SCOPED.has(key) ? assertPermissionAnywhere : assertPermission)(actor, ENTITIES[key].permission);
      return transaction(db, () => {
        /** @type {any} */
        const row = load(actor, key, id);
        if (SCOPED.has(key)) guard(actor, ENTITIES[key].permission, key, row);
        const a = db.prepare('SELECT * FROM org_assignments WHERE id = ? AND entity_type = ? AND entity_id = ? AND is_active = 1').get(assignmentId, ENTITY_TYPE[key], id);
        if (!a) throw notFound('That scheduled change does not exist.');
        if (a.applied) throw unprocessable('That change has already taken effect and is part of the history.');
        db.prepare('UPDATE org_assignments SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ?').run(new Date(clock()).toISOString(), actor.user, assignmentId);
        writeAudit(db, { entity: ENTITIES[key].table, entityId: row.id, action: 'assignment_cancelled', newValues: { assignmentId }, actor: actor.user });
        return { cancelled: true };
      });
    },

    /** The daily job: scheduled changes whose date has come. */
    applyDueAssignments() {
      const due = db.prepare('SELECT * FROM org_assignments WHERE applied = 0 AND is_active = 1 AND effective_from <= ? ORDER BY effective_from, id').all(today());
      for (const a of due) transaction(db, () => applyAssignment(a, 'system'));
      return { applied: due.length };
    },

    /** The department, project and site roles a person holds now or has waiting (used before a person is deactivated, part 02.03). */
    holdingsOf(companyId, userId) {
      const label = { DEPARTMENT: ['org_departments', 'department head'], PROJECT: ['org_projects', 'project manager'], SITE: ['org_sites', 'site in-charge'] };
      return db.prepare('SELECT a.id, a.entity_type, a.entity_id, a.role, a.applied, a.effective_from FROM org_assignments a WHERE a.company_id = ? AND a.user_id = ? AND a.is_active = 1 AND a.effective_to IS NULL ORDER BY a.entity_type, a.entity_id').all(companyId, userId)
        .map((a) => {
          const row = db.prepare(`SELECT code, name FROM ${label[a.entity_type][0]} WHERE id = ?`).get(a.entity_id);
          return { id: a.id, entityType: a.entity_type, entityId: a.entity_id, role: a.role, kind: label[a.entity_type][1], code: row?.code ?? null, name: row?.name ?? null, pending: !a.applied, effectiveFrom: a.effective_from };
        });
    },

    /** Hand every role held by one person to another, from today (the caller has checked the right to do so). Runs inside the caller's transaction. */
    reassignHoldings(actorName, companyId, fromUserId, toUserId, reason) {
      let moved = 0;
      for (const a of db.prepare('SELECT * FROM org_assignments WHERE company_id = ? AND user_id = ? AND is_active = 1 AND effective_to IS NULL').all(companyId, fromUserId)) {
        if (!a.applied) {
          db.prepare('UPDATE org_assignments SET user_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(toUserId, actorName, new Date(clock()).toISOString(), a.id);
        } else {
          const created = db.prepare('INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, applied, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
            .run(companyId, a.entity_type, a.entity_id, a.role, toUserId, today() < a.effective_from ? a.effective_from : today(), reason, actorName, 'org_assignment');
          applyAssignment(db.prepare('SELECT * FROM org_assignments WHERE id = ?').get(Number(created.lastInsertRowid)), actorName);
        }
        moved += 1;
      }
      return moved;
    },

    history(actor, key, id) {
      mayRead(actor, key);
      const row = load(actor, key, id);
      const e = ENTITIES[key];
      const assignments = ENTITY_TYPE[key]
        ? db.prepare('SELECT a.*, u.username, u.display_name FROM org_assignments a LEFT JOIN iam_users u ON u.id = a.user_id WHERE a.entity_type = ? AND a.entity_id = ? AND a.is_active = 1 ORDER BY a.effective_from DESC, a.id DESC').all(ENTITY_TYPE[key], id)
          .map((a) => ({ id: a.id, role: a.role, user: a.username ?? null, userName: a.display_name ?? null, effectiveFrom: a.effective_from, effectiveTo: a.effective_to, pending: !a.applied, reason: a.reason, by: a.created_by }))
        : [];
      const audit = db.prepare('SELECT action, actor, reason, old_values, new_values, created_at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 100').all(e.table, String(row.id))
        .map((a) => ({ action: a.action, actor: a.actor, reason: a.reason, at: a.created_at, before: a.old_values ? JSON.parse(a.old_values) : null, after: a.new_values ? JSON.parse(a.new_values) : null }));
      return { assignments, audit };
    },

    // ---- approvals ----
    requestActivation(actor, key, id, { reason }) {
      const e = ENTITIES[key];
      if (!e.controlled) throw notFound(`A ${e.noun} is not activated by approval.`);
      (SCOPED.has(key) ? assertPermissionAnywhere : assertPermission)(actor, e.permission);
      const row = load(actor, key, id);
      if (SCOPED.has(key)) guard(actor, e.permission, key, row);
      if (!['DRAFT', 'INACTIVE'].includes(row.status) || (key === 'projects' && row.status !== 'DRAFT')) throw unprocessable(`The ${e.noun} ${row.code} is ${row.status}, so there is nothing to activate.`);
      if (key === 'sites') {
        const p = db.prepare('SELECT status FROM org_projects WHERE id = ?').get(row.org_project_id);
        if (p?.status !== 'ACTIVE') throw unprocessable('Activate the project first: a site can only be activated inside an active project.');
      }
      if (approvals.hasOpen(row.company_id, 'org_activation', targetOf[key], id)) throw conflict('There is already an open activation request for this record.');
      return approvals.submit(actor, {
        type: 'org_activation', title: `Activate ${e.noun} ${row.code} ${row.name}`, targetType: targetOf[key], targetId: id,
        payload: { entity: e.event, id, code: row.code, name: row.name }, reason, chain: ACTIVATION_CHAIN,
      });
    },

    requestGeofenceChange(actor, id, { geofence, reason }) {
      assertPermissionAnywhere(actor, 'org.geofence.request');
      const row = load(actor, 'sites', id);
      guard(actor, 'org.geofence.request', 'sites', row);
      if (row.status === 'DRAFT') throw unprocessable('A draft site is edited directly; approval is needed only once the site is active or has been active.');
      const problems = geofenceProblems(geofence);
      if (problems.length) throw badRequest('The geofence is not valid.', problems.map((message) => ({ field: 'geofence', message })));
      const next = geofenceColumns(geofence);
      const cur = geofenceColumns(geofenceOf(row));
      if (sameJson(next, { ...cur, latitude: cur.latitude, longitude: cur.longitude })) throw unprocessable('Nothing would change: the requested geofence is the current one.');
      if (approvals.hasOpen(row.company_id, 'org_geofence_change', 'org_site', id)) throw conflict('There is already an open geofence change request for this site.');
      return approvals.submit(actor, {
        type: 'org_geofence_change', title: `Change geofence of site ${row.code} ${row.name}`, targetType: 'org_site', targetId: id,
        payload: { siteId: id, geofence: { ...geofence, latitude: next.latitude, longitude: next.longitude }, from: geofenceOf(row) }, reason, chain: GEOFENCE_CHAIN,
      });
    },

    requestsFor(actor, key, id) {
      mayRead(actor, key);
      load(actor, key, id);
      const target = targetOf[key];
      if (!target) return [];
      const ids = db.prepare('SELECT id FROM core_change_requests WHERE company_id = ? AND target_type = ? AND target_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 30').all(cid(actor), target, id);
      return ids.map((r) => approvals.get(actor, r.id));
    },

    // ---- geofence tests (T-01) ----
    testSite(actor, id, { latitude, longitude, toleranceM }) {
      assertPermissionAnywhere(actor, 'org.view');
      const row = load(actor, 'sites', id);
      if (row.geofence_type === 'NONE') throw unprocessable('This site has no geofence to test against. Draw one first.');
      return service.testShape(actor, { geofence: geofenceOf(row), latitude, longitude, toleranceM });
    },
    testShape(actor, { geofence, latitude, longitude, toleranceM }) {
      assertPermissionAnywhere(actor, 'org.view');
      const problems = geofenceProblems(geofence);
      if (problems.length) throw badRequest('The geofence is not valid.', problems.map((message) => ({ field: 'geofence', message })));
      return testPoint(geofence, { lat: latitude, lng: longitude }, toleranceM);
    },

    // ---- context, tree, lookups ----
    context(actor) {
      const c = cid(actor);
      const company = db.prepare('SELECT id, code, legal_name, short_name FROM org_companies WHERE id = ? AND is_active = 1').get(c);
      const pf = authz.scopeFilter(actor, 'org.view', { project: 't.id' }).sql;
      const sf = authz.scopeFilter(actor, 'org.view', { project: 't.org_project_id', site: 't.id' }).sql;
      const projects = db.prepare(`SELECT t.id, t.code, t.name, t.status FROM org_projects t WHERE t.company_id = ? AND t.is_active = 1 AND t.status != 'CLOSED' AND ${pf} ORDER BY t.code`).all(c);
      const sites = db.prepare(`SELECT t.id, t.code, t.name, t.status, t.org_project_id AS project_id, t.site_type FROM org_sites t WHERE t.company_id = ? AND t.is_active = 1 AND t.status != 'INACTIVE' AND ${sf} ORDER BY t.code`).all(c);
      return {
        companies: company ? [{ id: company.id, code: company.code, name: company.short_name, legalName: company.legal_name }] : [],
        projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status })),
        sites: sites.map((s) => ({ id: s.id, code: s.code, name: s.name, status: s.status, projectId: s.project_id, type: s.site_type })),
      };
    },

    tree(actor) {
      assertPermission(actor, 'org.view');
      const c = cid(actor);
      const nest = (rows) => {
        const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
        const roots = [];
        for (const n of byId.values()) (n.parentId && byId.has(n.parentId) ? byId.get(n.parentId).children : roots).push(n);
        return roots;
      };
      const all = (sql) => db.prepare(sql).all({ c });
      const company = db.prepare('SELECT id, code, legal_name, short_name, status FROM org_companies WHERE id = ?').get(c);
      return {
        company: company ? { id: company.id, code: company.code, name: company.legal_name, status: company.status } : null,
        branches: nest(all('SELECT id, parent_id AS parentId, kind, code, name, status FROM org_branches WHERE company_id = :c AND is_active = 1 ORDER BY code')),
        departments: nest(all("SELECT d.id, d.parent_id AS parentId, d.kind, d.code, d.name, d.status, d.version, d.head_user_id AS headUserId, (SELECT display_name FROM iam_users u WHERE u.id = d.head_user_id) AS headName FROM org_departments d WHERE d.company_id = :c AND d.is_active = 1 ORDER BY d.code")),
        projects: all("SELECT id, code, name, status, type FROM org_projects WHERE company_id = :c AND is_active = 1 ORDER BY code")
          .map((p) => ({ ...p, sites: db.prepare('SELECT id, code, name, status, site_type AS type FROM org_sites WHERE org_project_id = ? AND is_active = 1 ORDER BY code').all(p.id).map((s) => ({ ...s })) })),
        locations: all('SELECT id, type, code, name, status FROM org_locations WHERE company_id = :c AND is_active = 1 ORDER BY code'),
        costCentres: nest(all('SELECT id, parent_id AS parentId, type, code, name, status, linked_type AS linkedType, linked_id AS linkedId FROM org_cost_centres WHERE company_id = :c AND is_active = 1 ORDER BY code')),
      };
    },

    lookupUsers(actor, query) {
      assertPermission(actor, 'org.view');
      const rows = db.prepare("SELECT id, username, display_name FROM iam_users WHERE company_id = :c AND status = 'ACTIVE' AND is_active = 1 AND (username LIKE :q ESCAPE '\\' OR display_name LIKE :q ESCAPE '\\') ORDER BY username LIMIT 50").all({ c: cid(actor), q: likePattern(query.q) });
      return rows.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name }));
    },
  };
  return service;
}
