import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { CHAINAGE_TYPES, DISCIPLINES, HUNDRED, LOC_RULES, LOC_TYPES, MAX_LEVEL, VERSION_STATUS, WBS_CHANGE_DOC, WBS_TEMPLATES, WP_STATUS, WP_TYPES, json, nowIso, num, rid, same } from './constants.js';

// The project structure (part 10.03). The work breakdown structure is a tree per project with codes (generated or typed, unique within the project), levels, weights that sum to 100 % among the children of a node (BR-02), a responsible person, a
// discipline and control accounts. It starts from a template of the project type or a copy of another project and is edited with moves, bulk edits and Excel import. A node used by anything (a work package, the matrix, and later the BOQ, the schedule
// and the measurements, which register themselves in `usageProviders`) is deactivated, never deleted, and a move keeps every link because the links are by id (BR-01). When the WBS is baselined its structure is locked: a change is a request with
// operations and a reason, approved by planning, the project manager and the project controls manager, and every approved change is a new version with its diff and snapshot (FR-07). Work packages group nodes for subcontracting, procurement or
// self-execution (FR-03); the location breakdown holds blocks, buildings, floors, zones and rooms or chainage segments and structures with a map reference (FR-04); the matrix says which node applies in which location (FR-05).
/** What a later part adds to "this node is in use": (db, { projectId, wbsId }) => number of records that point at it (the BOQ of 10.04, the schedule of 13.01, the measurements of 22.01). */
export const usageProviders = /** @type {Array<(db: any, ctx: { projectId: number, wbsId: number }) => number>} */ ([]);
/** The same for a location: (db, { projectId, locationId }) => number. */
export const locationUsageProviders = /** @type {Array<(db: any, ctx: { projectId: number, locationId: number }) => number>} */ ([]);

export const workPackageList = defineList({
  code: 'proj.work_packages', label: 'Work packages', permission: 'proj.wbs.view',
  from: 'proj_work_packages x JOIN org_projects p ON p.id = x.project_id', where: 'x.deleted_at IS NULL', searchable: ['x.code', 'x.name', 'p.code', 'p.name', 'x.owner_user'], defaultSort: 'code',
  columns: {
    code: { sql: 'x.code', type: 'text', label: 'Code' }, name: { sql: 'x.name', type: 'text', label: 'Work package' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.project_id', type: 'number', label: 'Project id' },
    type: { sql: 'x.wp_type', type: 'enum', label: 'Type', options: Object.entries(WP_TYPES) }, owner: { sql: 'x.owner_user', type: 'text', label: 'Owner' }, status: { sql: 'x.wp_status', type: 'enum', label: 'Status', options: Object.entries(WP_STATUS) },
    nodes: { sql: "json_array_length(x.wbs_ids_json)", type: 'number', label: 'WBS nodes' },
  },
});

class Rollback extends Error {}
const pctText = (u) => num(u, 'percent');
const toPct = (v) => { const s = String(v ?? '0').trim(); if (!/^\d+(\.\d{1,4})?$/.test(s)) return null; const [a, b = ''] = s.split('.'); return Number(a) * 10000 + Number(b.padEnd(4, '0')); };

export function createStructureService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, projectId = null) => (projectId == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed);
  const need = (actor, key, what, projectId = null) => { if (!may(actor, key, projectId)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const event = (type, actor, entity, id, companyId, projectId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const userOk = (companyId, u) => !u || Boolean(db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(companyId, u));
  /** The project of an organisation id the person may see (with the right asked). */
  function project(actor, projectId, key = 'proj.wbs.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id) || !may(actor, 'proj.wbs.view', o.id)) throw notFound('That project does not exist.');
    if (key !== 'proj.wbs.view') need(actor, key, 'do that with the project structure', o.id);
    return o;
  }
  const baselined = (projectId) => Boolean(db.prepare("SELECT 1 FROM proj_wbs_versions WHERE project_id = ? AND kind = 'BASELINE' AND version_status = 'APPROVED' AND deleted_at IS NULL").get(projectId));
  const versionNo = (projectId) => db.prepare("SELECT COALESCE(MAX(version_no), 0) AS n FROM proj_wbs_versions WHERE project_id = ? AND version_status = 'APPROVED' AND deleted_at IS NULL").get(projectId).n;
  const nodes = (projectId, activeOnly = false) => db.prepare(`SELECT * FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL${activeOnly ? " AND wbs_status = 'ACTIVE'" : ''} ORDER BY level, parent_id, sort_order, id`).all(projectId);
  const node = (projectId, id) => { const w = db.prepare('SELECT * FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(Number(id), projectId); if (!w) throw notFound('That WBS node does not exist in this project.'); return w; };
  const LOCKED = (what) => new HttpError(409, 'WBS_BASELINED', `The WBS of this project is baselined: ${what} is changed by a change request (planning, the project manager and the project controls manager approve it).`);

  // ---- usage (BR-01) ---------------------------------------------------------------------------------------------------------------------------
  function usage(projectId, w) {
    let n = db.prepare("SELECT COUNT(*) AS n FROM proj_work_packages WHERE project_id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(wbs_ids_json) j WHERE j.value = ?)").get(projectId, w.id).n;
    n += db.prepare('SELECT COUNT(*) AS n FROM proj_wbs_locations WHERE wbs_id = ? AND deleted_at IS NULL').get(w.id).n;
    for (const f of usageProviders) n += Number(f(db, { projectId, wbsId: w.id }) || 0);
    return n;
  }
  const subtreeIds = (projectId, id) => { const all = nodes(projectId); const out = []; const walk = (pid) => { for (const c of all.filter((x) => x.parent_id === pid)) { out.push(c.id); walk(c.id); } }; walk(id); return out; };

  // ---- invariants (BR-01, BR-02) -------------------------------------------------------------------------------------------------------------------
  /** The groups of siblings whose weights do not sum to 100 %. */
  function weightGroups(projectId) {
    const all = nodes(projectId, true); const groups = new Map();
    for (const w of all) { const k = w.parent_id ?? 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
    return [...groups.entries()].map(([pid, list]) => { const sum = list.reduce((s, x) => s + x.weight, 0); const p = pid ? all.find((x) => x.id === pid) : null; return { parentId: pid || null, parentCode: p?.code ?? null, parentName: p?.name ?? null, count: list.length, sum: pctText(sum), ok: sum === HUNDRED }; });
  }
  const checkAll = (projectId) => {
    const p = [];
    for (const g of weightGroups(projectId)) if (!g.ok) p.push({ field: 'weight', message: `${g.parentCode ? `Under ${g.parentCode} ${g.parentName}` : 'At the top level'} the weights of the ${g.count} node(s) sum to ${g.sum} %, not 100 %` });
    for (const w of nodes(projectId, true)) if (w.parent_id && db.prepare("SELECT 1 FROM proj_wbs WHERE id = ? AND wbs_status = 'INACTIVE'").get(w.parent_id)) p.push({ field: 'status', message: `${w.code} is active under an inactive parent` });
    return p;
  };
  function nextCode(projectId, parentId) {
    const parent = parentId ? db.prepare('SELECT code FROM proj_wbs WHERE id = ?').get(parentId) : null; const prefix = parent ? `${parent.code}.` : '';
    const sib = db.prepare('SELECT code FROM proj_wbs WHERE project_id = ? AND parent_id IS ? AND deleted_at IS NULL').all(projectId, parentId ?? null);
    let k = sib.reduce((m, s) => { const t = s.code.startsWith(prefix) ? s.code.slice(prefix.length) : ''; return /^\d+$/.test(t) ? Math.max(m, Number(t)) : m; }, 0) + 1;
    while (db.prepare('SELECT 1 FROM proj_wbs WHERE project_id = ? AND code = ? AND deleted_at IS NULL').get(projectId, `${prefix}${k}`)) k += 1;
    return `${prefix}${k}`;
  }
  const codeOk = (c) => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(c);

  // ---- the writes, without the baseline lock (used by the direct edits before the baseline and by approved changes) --------------------------------------
  function put(actor, o, b, ctx = {}) {
    const parent = b.parentId ? node(o.id, b.parentId) : null;
    if (parent && parent.wbs_status !== 'ACTIVE') throw unprocessable(`${parent.code} is inactive: nodes are not added under it.`);
    const level = parent ? parent.level + 1 : 1; if (level > MAX_LEVEL) throw unprocessable(`The WBS has at most ${MAX_LEVEL} levels.`);
    const code = (b.code ?? '').trim() || nextCode(o.id, b.parentId ?? null);
    const p = [];
    if (!codeOk(code)) p.push({ field: 'code', message: 'A code is letters, digits and . _ / - (up to 40 characters)' });
    else if (db.prepare('SELECT 1 FROM proj_wbs WHERE project_id = ? AND code = ? AND deleted_at IS NULL').get(o.id, code)) p.push({ field: 'code', message: `${code} is used in this project already` });
    if (b.responsibleUser && !userOk(actor.companyId, b.responsibleUser)) p.push({ field: 'responsibleUser', message: `${b.responsibleUser} is not a user of your company` });
    if (b.discipline && !DISCIPLINES[b.discipline]) p.push({ field: 'discipline', message: 'Choose a discipline of the list' });
    const wt = b.weight == null ? 0 : (typeof b.weight === 'number' && Number.isInteger(b.weight) && ctx.units ? b.weight : toPct(b.weight));
    if (wt == null || wt < 0 || wt > HUNDRED) p.push({ field: 'weight', message: 'A weight is a percentage from 0 to 100' });
    fail(p);
    const sum = db.prepare("SELECT COALESCE(SUM(weight), 0) AS s FROM proj_wbs WHERE project_id = ? AND parent_id IS ? AND deleted_at IS NULL AND wbs_status = 'ACTIVE'").get(o.id, b.parentId ?? null).s;
    if (sum + wt > HUNDRED && !ctx.loose) throw unprocessable(`The weights under this node would sum to ${pctText(sum + wt)} %: they sum to 100 % at most.`);
    const order = b.sortOrder ?? (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM proj_wbs WHERE project_id = ? AND parent_id IS ? AND deleted_at IS NULL').get(o.id, b.parentId ?? null).n);
    const id = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, weight, discipline, responsible_user, is_control_account, sort_order, description, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(actor.companyId, o.id, b.parentId ?? null, code, b.name.trim(), level, wt, b.discipline ?? parent?.discipline ?? null, b.responsibleUser ? userName(actor.companyId, b.responsibleUser) : null, b.isControlAccount ? 1 : 0, order, b.description ?? null, actor.user, ctx.sourceType ?? 'proj_project', String(ctx.sourceId ?? o.id)).lastInsertRowid);
    return node(o.id, id);
  }
  const userName = (companyId, u) => db.prepare('SELECT username FROM iam_users WHERE company_id = ? AND lower(username) = lower(?)').get(companyId, u)?.username ?? u;
  function patch(actor, o, w, b, ctx = {}) {
    const p = []; const sets = []; const vals = [];
    if (b.name !== undefined) { if (!b.name.trim()) p.push({ field: 'name', message: 'Give the name' }); sets.push('name = ?'); vals.push(b.name.trim()); }
    if (b.code !== undefined && b.code.trim() !== w.code) { const c = b.code.trim(); if (!codeOk(c)) p.push({ field: 'code', message: 'A code is letters, digits and . _ / - (up to 40 characters)' }); else if (db.prepare('SELECT 1 FROM proj_wbs WHERE project_id = ? AND code = ? AND id != ? AND deleted_at IS NULL').get(o.id, c, w.id)) p.push({ field: 'code', message: `${c} is used in this project already` }); sets.push('code = ?'); vals.push(c); }
    if (b.discipline !== undefined) { if (b.discipline && !DISCIPLINES[b.discipline]) p.push({ field: 'discipline', message: 'Choose a discipline of the list' }); sets.push('discipline = ?'); vals.push(b.discipline || null); }
    if (b.responsibleUser !== undefined) { if (b.responsibleUser && !userOk(actor.companyId, b.responsibleUser)) p.push({ field: 'responsibleUser', message: `${b.responsibleUser} is not a user of your company` }); sets.push('responsible_user = ?'); vals.push(b.responsibleUser ? userName(actor.companyId, b.responsibleUser) : null); }
    if (b.isControlAccount !== undefined) { sets.push('is_control_account = ?'); vals.push(b.isControlAccount ? 1 : 0); }
    if (b.description !== undefined) { sets.push('description = ?'); vals.push(b.description || null); }
    if (b.weight !== undefined) { const wt = toPct(b.weight); if (wt == null || wt < 0 || wt > HUNDRED) p.push({ field: 'weight', message: 'A weight is a percentage from 0 to 100' }); else { const sum = db.prepare("SELECT COALESCE(SUM(weight), 0) AS s FROM proj_wbs WHERE project_id = ? AND parent_id IS ? AND deleted_at IS NULL AND wbs_status = 'ACTIVE' AND id != ?").get(o.id, w.parent_id, w.id).s; if (sum + wt > HUNDRED && !ctx.loose) p.push({ field: 'weight', message: `The weights of the siblings would sum to ${pctText(sum + wt)} %: 100 % at most` }); sets.push('weight = ?'); vals.push(wt); } }
    fail(p);
    if (!sets.length) return w;
    db.prepare(`UPDATE proj_wbs SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...vals, actor.user, nowIso(), w.id);
    return node(o.id, w.id);
  }
  function relevel(projectId, id, level) {
    db.prepare('UPDATE proj_wbs SET level = ? WHERE id = ?').run(level, id);
    for (const c of db.prepare('SELECT id FROM proj_wbs WHERE parent_id = ? AND deleted_at IS NULL').all(id)) relevel(projectId, c.id, level + 1);
  }
  const depthBelow = (projectId, id) => { let d = 0; for (const c of db.prepare('SELECT id FROM proj_wbs WHERE parent_id = ? AND deleted_at IS NULL').all(id)) d = Math.max(d, 1 + depthBelow(projectId, c.id)); return d; };
  /** A move keeps the code, the weight and every link (links are by id); the node goes before `beforeId` or last under the new parent. */
  function relocate(actor, o, w, { parentId = null, beforeId = null }) {
    const target = parentId ? node(o.id, parentId) : null;
    if (target && (target.id === w.id || subtreeIds(o.id, w.id).includes(target.id))) throw unprocessable('A node cannot be moved under itself or under one of its own descendants.');
    if (target && target.wbs_status !== 'ACTIVE') throw unprocessable(`${target.code} is inactive: nodes are not moved under it.`);
    const level = (target?.level ?? 0) + 1; if (level + depthBelow(o.id, w.id) > MAX_LEVEL) throw unprocessable(`The move would take the WBS below level ${MAX_LEVEL}.`);
    const sibs = db.prepare('SELECT id FROM proj_wbs WHERE project_id = ? AND parent_id IS ? AND deleted_at IS NULL AND id != ? ORDER BY sort_order, id').all(o.id, target?.id ?? null, w.id).map((x) => x.id);
    let at = sibs.length; if (beforeId) { const k = sibs.indexOf(Number(beforeId)); if (k < 0) throw unprocessable('The node to place it before is not under that parent.'); at = k; }
    sibs.splice(at, 0, w.id);
    db.prepare('UPDATE proj_wbs SET parent_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(target?.id ?? null, actor.user, nowIso(), w.id);
    sibs.forEach((id, i) => db.prepare('UPDATE proj_wbs SET sort_order = ? WHERE id = ?').run(i + 1, id));
    relevel(o.id, w.id, level);
    return node(o.id, w.id);
  }
  function setActive(actor, o, w, on) {
    const ids = [w.id, ...subtreeIds(o.id, w.id)];
    if (on) { if (w.parent_id && db.prepare("SELECT 1 FROM proj_wbs WHERE id = ? AND wbs_status = 'INACTIVE'").get(w.parent_id)) throw unprocessable('Activate the parent first.'); ids.length = 1; }
    for (const id of ids) db.prepare('UPDATE proj_wbs SET wbs_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(on ? 'ACTIVE' : 'INACTIVE', actor.user, nowIso(), id);
    return node(o.id, w.id);
  }
  function drop(actor, o, w) {
    if (db.prepare('SELECT 1 FROM proj_wbs WHERE parent_id = ? AND deleted_at IS NULL').get(w.id)) throw unprocessable(`${w.code} has nodes under it: delete or move them first.`);
    const u = usage(o.id, w); if (u > 0) throw new HttpError(409, 'WBS_IN_USE', `${w.code} is in use (${u} record(s) point at it): it is deactivated, not deleted.`);
    db.prepare('UPDATE proj_wbs SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, w.id);
  }
  function view(w, o, extra = {}) {
    return { id: w.id, parentId: w.parent_id, code: w.code, name: w.name, level: w.level, weight: pctText(w.weight), discipline: w.discipline, disciplineLabel: DISCIPLINES[w.discipline] ?? null, responsibleUser: w.responsible_user, isControlAccount: Boolean(w.is_control_account), sortOrder: w.sort_order, status: w.wbs_status, description: w.description, rowVersion: w.version, ...extra };
  }
  const snapshot = (projectId) => nodes(projectId).map((w) => ({ id: w.id, code: w.code, parentCode: w.parent_id ? db.prepare('SELECT code FROM proj_wbs WHERE id = ?').get(w.parent_id)?.code ?? null : null, level: w.level, name: w.name, weight: pctText(w.weight), discipline: w.discipline, responsibleUser: w.responsible_user, controlAccount: Boolean(w.is_control_account), status: w.wbs_status, sortOrder: w.sort_order }));
  function diff(before, after) {
    const b = new Map(before.map((x) => [x.id, x])); const a = new Map(after.map((x) => [x.id, x])); const out = [];
    for (const [id, x] of a) { const y = b.get(id); if (!y) { out.push({ kind: 'ADDED', code: x.code, name: x.name }); continue; } const ch = []; for (const k of ['code', 'name', 'parentCode', 'weight', 'discipline', 'responsibleUser', 'controlAccount', 'status']) if (x[k] !== y[k]) ch.push({ field: k, before: y[k], after: x[k] }); if (ch.length) out.push({ kind: ch.some((c) => c.field === 'parentCode') ? 'MOVED' : 'CHANGED', code: x.code, name: x.name, changes: ch }); }
    for (const [id, y] of b) if (!a.has(id)) out.push({ kind: 'REMOVED', code: y.code, name: y.name });
    return out;
  }

  // ---- the WBS ---------------------------------------------------------------------------------------------------------------------------------------
  function tree(actor, projectId) {
    const o = project(actor, projectId); const rows = nodes(o.id); const can = (k) => may(actor, k, o.id); const base = baselined(o.id);
    const kids = new Map(); for (const w of rows) { const k = w.parent_id ?? 0; kids.set(k, (kids.get(k) ?? 0) + 1); }
    const open = db.prepare("SELECT id, version_status FROM proj_wbs_versions WHERE project_id = ? AND kind = 'CHANGE' AND version_status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(o.id);
    const tpl = WBS_TEMPLATES;
    return {
      project: { id: o.id, code: o.code, name: o.name, type: o.type }, baselined: base, versionNo: versionNo(o.id), openChange: open ? { id: open.id, status: open.version_status } : null,
      nodes: rows.map((w) => view(w, o, { children: kids.get(w.id) ?? 0, usage: usage(o.id, w) })), validation: { groups: weightGroups(o.id), problems: checkAll(o.id), ok: checkAll(o.id).length === 0 },
      templates: Object.entries(tpl).map(([code, t]) => ({ code, label: t.label })), disciplines: Object.entries(DISCIPLINES).map(([code, label]) => ({ code, label })),
      sources: db.prepare('SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = ? AND p.id != ? AND EXISTS (SELECT 1 FROM proj_wbs w WHERE w.project_id = p.id AND w.deleted_at IS NULL)').all(actor.companyId, o.id).filter((p) => may(actor, 'proj.wbs.view', p.id)),
      can: { manage: can('proj.wbs.manage') && !base, edit: can('proj.wbs.manage'), baseline: can('proj.wbs.baseline') && !base, change: can('proj.wbs.change') && base, approve: can('proj.wbs.approve'), export: can('proj.wbs.export'), import: can('proj.wbs.import') && !base, template: can('proj.wbs.manage') && !base },
    };
  }
  const audit = (o, w, action, actor, newValues, oldValues) => writeAudit(db, { entity: 'proj_wbs', entityId: w.id, action, oldValues, newValues, actor: actor.user, companyId: o.company_id });
  /** The projects with a project master whose structure the person may see (the chooser of the pages). */
  const projectsList = (actor) => db.prepare('SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = ? AND EXISTS (SELECT 1 FROM proj_projects x WHERE x.project_id = p.id AND x.deleted_at IS NULL) ORDER BY p.code').all(actor.companyId).filter((p) => { need(actor, 'proj.wbs.view', 'see the project structure'); return may(actor, 'proj.wbs.view', p.id); }).map((p) => ({ projectId: p.id, code: p.code, name: p.name }));
  const wbs = {
    tree,
    create(actor, projectId, b) {
      const o = project(actor, projectId, 'proj.wbs.manage'); if (baselined(o.id)) throw LOCKED('adding a node');
      return transaction(db, () => { const w = put(actor, o, b); audit(o, w, 'create', actor, { code: w.code, parent: b.parentId ?? null }); event('proj.wbs.updated', actor, 'wbs', w.id, o.company_id, o.id, { projectId: o.id, wbsId: w.id, code: w.code, action: 'created' }); return view(w, o); });
    },
    update(actor, projectId, id, b) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const w = node(o.id, id);
      if (b.version != null && b.version !== w.version) throw conflict(`${w.code} was changed by someone else (version ${w.version}, you had ${b.version}); reload it.`);
      if (baselined(o.id) && ['code', 'weight', 'isControlAccount'].some((k) => b[k] !== undefined)) throw LOCKED('the code, the weight and the control account of a node');
      return transaction(db, () => { const x = patch(actor, o, w, b); audit(o, x, 'update', actor, b, { name: w.name, code: w.code, weight: pctText(w.weight) }); event('proj.wbs.updated', actor, 'wbs', x.id, o.company_id, o.id, { projectId: o.id, wbsId: x.id, code: x.code, action: 'updated' }); return view(x, o); });
    },
    move(actor, projectId, id, b) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const w = node(o.id, id); if (baselined(o.id)) throw LOCKED('moving a node');
      return transaction(db, () => { const x = relocate(actor, o, w, b); audit(o, x, 'move', actor, { parentId: b.parentId ?? null }, { parentId: w.parent_id }); event('proj.wbs.updated', actor, 'wbs', x.id, o.company_id, o.id, { projectId: o.id, wbsId: x.id, code: x.code, action: 'moved' }); return tree(actor, o.id); });
    },
    remove(actor, projectId, id) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const w = node(o.id, id); if (baselined(o.id)) throw LOCKED('deleting a node');
      return transaction(db, () => { drop(actor, o, w); audit(o, w, 'delete', actor, null, { code: w.code }); event('proj.wbs.updated', actor, 'wbs', w.id, o.company_id, o.id, { projectId: o.id, wbsId: w.id, code: w.code, action: 'deleted' }); return tree(actor, o.id); });
    },
    setStatus(actor, projectId, id, on) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const w = node(o.id, id); if (baselined(o.id)) throw LOCKED('deactivating a node');
      return transaction(db, () => { const x = setActive(actor, o, w, on); audit(o, x, on ? 'activate' : 'deactivate', actor, { status: x.wbs_status }); return tree(actor, o.id); });
    },
    /** Bulk edit of the fields that do not change the structure (and the control account before the baseline). */
    bulk(actor, projectId, { ids, set }) {
      const o = project(actor, projectId, 'proj.wbs.manage');
      if (baselined(o.id) && set.isControlAccount !== undefined) throw LOCKED('the control account of a node');
      return transaction(db, () => { for (const id of ids) { const w = node(o.id, id); patch(actor, o, w, set); audit(o, w, 'bulk', actor, set); } event('proj.wbs.updated', actor, 'wbs', ids[0], o.company_id, o.id, { projectId: o.id, action: 'bulk', count: ids.length }); return tree(actor, o.id); });
    },
    /** BR-02: scales the weights of the siblings to sum to 100 % keeping their proportions (equal shares when all are zero); the rest goes to the first. */
    normalise(actor, projectId, { parentId = undefined } = {}) {
      const o = project(actor, projectId, 'proj.wbs.manage'); if (baselined(o.id)) throw LOCKED('the weights');
      return transaction(db, () => {
        const groups = new Map(); for (const w of nodes(o.id, true)) { const k = w.parent_id ?? 0; if (parentId !== undefined && k !== (parentId ?? 0)) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
        for (const list of groups.values()) {
          const sum = list.reduce((s, x) => s + x.weight, 0); let ws = sum === 0 ? list.map(() => Math.floor(HUNDRED / list.length)) : list.map((x) => Math.floor((x.weight * HUNDRED) / sum));
          ws[0] += HUNDRED - ws.reduce((s, x) => s + x, 0);
          list.forEach((x, i) => db.prepare('UPDATE proj_wbs SET weight = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(ws[i], actor.user, nowIso(), x.id));
        }
        writeAudit(db, { entity: 'proj_wbs', entityId: o.id, action: 'normalise', actor: actor.user, companyId: o.company_id }); return tree(actor, o.id);
      });
    },
    validate(actor, projectId) { const o = project(actor, projectId); const p = checkAll(o.id); return { ok: p.length === 0, groups: weightGroups(o.id), problems: p }; },
    /** FR-02: starts the WBS from a template of the project type, at the top or under a node. */
    applyTemplate(actor, projectId, { template, parentId = null }) {
      const o = project(actor, projectId, 'proj.wbs.manage'); if (baselined(o.id)) throw LOCKED('applying a template');
      const tpl = WBS_TEMPLATES[template]; if (!tpl) throw badRequest('Correct the highlighted fields', [{ field: 'template', message: 'Choose a template of the list' }]);
      if (!parentId && db.prepare('SELECT 1 FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL').get(o.id)) throw conflict('The WBS is not empty: apply the template under a node, or copy into an empty WBS.');
      return transaction(db, () => {
        let made = 0; const share = (n2) => { const base = Math.floor(HUNDRED / n2); return (i) => (i === 0 ? base + (HUNDRED - base * n2) : base); };
        const walk = (list, pid) => { const w = share(list.length); list.forEach((t, i) => { const x = put(actor, o, { parentId: pid, name: t.name, discipline: t.discipline, isControlAccount: Boolean(t.ca), weight: pctText(w(i)) }, { sourceType: 'proj_wbs_template', sourceId: template }); made += 1; if (t.children?.length) walk(t.children, x.id); }); };
        walk(tpl.tree, parentId);
        writeAudit(db, { entity: 'proj_wbs', entityId: o.id, action: 'template', newValues: { template, nodes: made }, actor: actor.user, companyId: o.company_id });
        event('proj.wbs.updated', actor, 'wbs', o.id, o.company_id, o.id, { projectId: o.id, action: 'template', template, nodes: made });
        return { created: made, tree: tree(actor, o.id) };
      });
    },
    /** FR-02: copies the structure of another project (the WBS, and when asked its locations and work packages) into an empty WBS. */
    copyFrom(actor, projectId, { sourceProjectId, includeLocations = false, includeWorkPackages = false }) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const s = project(actor, sourceProjectId);
      if (s.id === o.id) throw unprocessable('Choose another project to copy from.'); if (baselined(o.id)) throw LOCKED('copying a structure');
      if (db.prepare('SELECT 1 FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL').get(o.id)) throw conflict('The WBS is not empty: copying is into an empty WBS.');
      const src = nodes(s.id); if (!src.length) throw unprocessable(`${s.code} has no WBS to copy.`);
      return transaction(db, () => {
        const map = new Map(); for (const w of src) { const parent = w.parent_id ? map.get(w.parent_id) : null; const x = put(actor, o, { parentId: parent?.id ?? null, code: w.code, name: w.name, weight: w.weight, discipline: w.discipline, responsibleUser: userOk(actor.companyId, w.responsible_user) ? w.responsible_user : null, isControlAccount: Boolean(w.is_control_account), sortOrder: w.sort_order, description: w.description }, { units: true, loose: true, sourceType: 'proj_wbs', sourceId: w.id }); if (w.wbs_status === 'INACTIVE') db.prepare("UPDATE proj_wbs SET wbs_status = 'INACTIVE' WHERE id = ?").run(x.id); map.set(w.id, x); }
        let locs = 0; let wps = 0;
        if (includeLocations) { const lmap = new Map(); for (const l of db.prepare('SELECT * FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL ORDER BY id').all(s.id)) { const x = putLocation(actor, o, { parentId: l.parent_id ? lmap.get(l.parent_id)?.id ?? null : null, type: l.loc_type, code: l.code, name: l.name, chainageFrom: l.chainage_from, chainageTo: l.chainage_to, lat: l.lat, lng: l.lng, description: l.description }, { sourceType: 'proj_locations', sourceId: l.id }); lmap.set(l.id, x); locs += 1; } }
        if (includeWorkPackages) for (const w of db.prepare('SELECT * FROM proj_work_packages WHERE project_id = ? AND deleted_at IS NULL ORDER BY id').all(s.id)) { db.prepare("INSERT INTO proj_work_packages (company_id, project_id, code, name, wp_type, wbs_ids_json, owner_user, wp_status, description, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_work_packages', ?)").run(actor.companyId, o.id, w.code, w.name, w.wp_type, JSON.stringify(json(w.wbs_ids_json, []).map((i) => map.get(i)?.id).filter(Boolean)), userOk(actor.companyId, w.owner_user) ? w.owner_user : null, w.wp_status, w.description, actor.user, String(w.id)); wps += 1; }
        writeAudit(db, { entity: 'proj_wbs', entityId: o.id, action: 'copy', newValues: { from: s.code, nodes: src.length, locations: locs, workPackages: wps }, actor: actor.user, companyId: o.company_id });
        event('proj.wbs.updated', actor, 'wbs', o.id, o.company_id, o.id, { projectId: o.id, action: 'copy', from: s.id, nodes: src.length });
        return { created: src.length, locations: locs, workPackages: wps, tree: tree(actor, o.id) };
      });
    },
    /** One row of the Excel import (04.13): a node by code under a parent by code; refused after the baseline. */
    importRow(actor, { projectCode, row }) {
      const o = db.prepare('SELECT * FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1').get(actor.companyId, projectCode); if (!o) throw unprocessable(`Project ${projectCode} does not exist`);
      project(actor, o.id, 'proj.wbs.import'); if (baselined(o.id)) throw LOCKED('importing nodes');
      const parent = row.parentCode ? db.prepare('SELECT id FROM proj_wbs WHERE project_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(o.id, row.parentCode) : null; if (row.parentCode && !parent) throw unprocessable(`The parent ${row.parentCode} is not in the project (list parents before their children)`);
      const w = put(actor, o, { parentId: parent?.id ?? null, code: row.code, name: row.name, weight: row.weight ?? '0', discipline: row.discipline || null, responsibleUser: row.responsibleUser || null, isControlAccount: Boolean(row.controlAccount) }, { loose: true, sourceType: 'excel_import' });
      return { id: w.id, ref: `${o.code} ${w.code}` };
    },
    /** The WBS as a file (Excel, CSV, PDF) with its levels, weights and the people responsible. */
    exportFile(actor, projectId, format = 'xlsx') {
      const o = project(actor, projectId, 'proj.wbs.export'); const rows = nodes(o.id); const byId = new Map(rows.map((w) => [w.id, w]));
      writeAudit(db, { entity: 'proj_wbs', entityId: o.id, action: 'export', newValues: { format, rows: rows.length }, actor: actor.user, companyId: o.company_id });
      const cols = [{ key: 'code', label: 'Code', type: 'text' }, { key: 'parentCode', label: 'Parent', type: 'text' }, { key: 'level', label: 'Level', type: 'number' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'weight', label: 'Weight %', type: 'text' }, { key: 'discipline', label: 'Discipline', type: 'text' }, { key: 'responsibleUser', label: 'Responsible', type: 'text' }, { key: 'controlAccount', label: 'Control account', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }];
      const data = rows.map((w) => ({ code: w.code, parentCode: byId.get(w.parent_id)?.code ?? '', level: w.level, name: `${'  '.repeat(w.level - 1)}${w.name}`, weight: pctText(w.weight), discipline: w.discipline ?? '', responsibleUser: w.responsible_user ?? '', controlAccount: w.is_control_account ? 'Yes' : 'No', status: w.wbs_status }));
      const title = `WBS ${o.code} ${o.name}${baselined(o.id) ? ` · version ${versionNo(o.id)}` : ' · not baselined'}`;
      return { buffer: writeExport(format, { columns: cols, rows: data, footer: [`${rows.length} nodes`], title, sheetName: 'WBS' }), contentType: FORMATS[format], fileName: `wbs-${o.code}.${format}` };
    },
    /** FR-07: baselining the WBS: the weights sum to 100 %, there is at least one node; version 1 keeps the snapshot; from now on the structure changes by approved request. */
    baseline(actor, projectId, { reason } = /** @type {any} */ ({})) {
      const o = project(actor, projectId, 'proj.wbs.baseline'); if (baselined(o.id)) throw conflict('The WBS is baselined already.');
      if (!nodes(o.id, true).length) throw unprocessable('There is no WBS to baseline.');
      const p = checkAll(o.id); if (p.length) throw unprocessable('The WBS cannot be baselined yet.', p);
      return transaction(db, () => {
        const snap = snapshot(o.id); const id = Number(db.prepare("INSERT INTO proj_wbs_versions (company_id, project_id, version_no, kind, version_status, reason, snapshot_json, diff_json, requested_by, decided_at, created_by, source_type, source_id) VALUES (?, ?, 1, 'BASELINE', 'APPROVED', ?, ?, '[]', ?, ?, ?, 'proj_wbs', ?)").run(o.company_id, o.id, reason ?? 'Baseline of the WBS', JSON.stringify(snap), actor.user, nowIso(), actor.user, String(o.id)).lastInsertRowid);
        writeAudit(db, { entity: 'proj_wbs_versions', entityId: id, action: 'baseline', newValues: { nodes: snap.length }, reason, actor: actor.user, companyId: o.company_id });
        event('proj.wbs.baselined', actor, 'wbs_version', id, o.company_id, o.id, { projectId: o.id, code: o.code, versionNo: 1, nodes: snap.length, controlAccounts: snap.filter((x) => x.controlAccount).length });
        return tree(actor, o.id);
      });
    },
    versions(actor, projectId) {
      const o = project(actor, projectId); return db.prepare('SELECT * FROM proj_wbs_versions WHERE project_id = ? AND deleted_at IS NULL ORDER BY version_no DESC, id DESC').all(o.id).map((v) => versionView(v));
    },
    version(actor, projectId, id) {
      const o = project(actor, projectId); const v = db.prepare('SELECT * FROM proj_wbs_versions WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(rid(id), o.id); if (!v) throw notFound('That version does not exist.');
      return { ...versionView(v), snapshot: json(v.snapshot_json, null), diff: json(v.diff_json, []), ops: json(v.ops_json, []) };
    },
  };
  const versionView = (v) => ({ id: v.id, versionNo: v.version_no, kind: v.kind, status: v.version_status, statusLabel: VERSION_STATUS[v.version_status], reason: v.reason, requestedBy: v.requested_by, decidedAt: v.decided_at, changes: json(v.diff_json, []).length, workflowInstanceId: v.workflow_instance_id, rowVersion: v.version, ops: json(v.ops_json, []).length });

  // ---- changes after the baseline (FR-07) -----------------------------------------------------------------------------------------------------------
  /** Applies the operations of a change in order; the references are ids of nodes, or codes of nodes added earlier in the same change. */
  function applyOps(actor, o, ops) {
    const made = new Map(); const ref = (v) => (typeof v === 'string' && made.has(v) ? made.get(v).id : v);
    const find = (v) => { const id = ref(v); return node(o.id, id); };
    for (const op of ops) {
      if (op.op === 'add') { const w = put(actor, o, { ...op, parentId: op.parentId == null ? null : ref(op.parentId) }, { loose: true, sourceType: 'proj_wbs_change' }); if (op.code) made.set(op.code, w); }
      else if (op.op === 'update') patch(actor, o, find(op.id), op.fields ?? {}, { loose: true });
      else if (op.op === 'move') relocate(actor, o, find(op.id), { parentId: op.parentId == null ? null : ref(op.parentId), beforeId: op.beforeId ?? null });
      else if (op.op === 'deactivate') setActive(actor, o, find(op.id), false);
      else if (op.op === 'activate') setActive(actor, o, find(op.id), true);
      else if (op.op === 'delete') drop(actor, o, find(op.id));
      else if (op.op === 'weights') for (const x of op.weights) { const wt = toPct(x.weight); if (wt == null) throw unprocessable(`${x.weight} is not a weight`); patch(actor, o, find(x.id), { weight: x.weight }, { loose: true }); }
      else throw unprocessable(`Unknown operation ${op.op}`);
    }
  }
  /** Tries the operations inside a transaction that is always rolled back; returns what the structure would look like (the diff, the problems). */
  function dryRun(actor, o, ops) {
    const before = snapshot(o.id); let out = null;
    try {
      transaction(db, () => { applyOps(actor, o, ops); out = { problems: checkAll(o.id), diff: diff(before, snapshot(o.id)) }; throw new Rollback('dry run'); });
    } catch (x) { if (!(x instanceof Rollback)) throw x; }
    return out;
  }
  const changeRow = (actor, projectId, id) => { const o = project(actor, projectId); const v = db.prepare("SELECT * FROM proj_wbs_versions WHERE id = ? AND project_id = ? AND kind = 'CHANGE' AND deleted_at IS NULL").get(rid(id), o.id); if (!v) throw notFound('That change request does not exist.'); return { o, v }; };
  const changes = {
    list(actor, projectId) { const o = project(actor, projectId); return db.prepare("SELECT * FROM proj_wbs_versions WHERE project_id = ? AND kind = 'CHANGE' AND deleted_at IS NULL ORDER BY id DESC").all(o.id).map((v) => ({ ...versionView(v), diff: json(v.diff_json, []) })); },
    create(actor, projectId, { reason, ops }) {
      const o = project(actor, projectId, 'proj.wbs.change'); if (!baselined(o.id)) throw unprocessable('The WBS is not baselined: change it directly.');
      if (db.prepare("SELECT 1 FROM proj_wbs_versions WHERE project_id = ? AND kind = 'CHANGE' AND version_status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(o.id)) throw conflict('Another change request of this project is open: finish or cancel it first.');
      const r = dryRun(actor, o, ops); if (r.problems.length) throw unprocessable('The change would leave the WBS invalid.', r.problems);
      if (!r.diff.length) throw unprocessable('The change does not alter the WBS.');
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO proj_wbs_versions (company_id, project_id, version_no, kind, version_status, reason, ops_json, diff_json, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, 'CHANGE', 'DRAFT', ?, ?, ?, ?, ?, 'proj_wbs', ?)").run(o.company_id, o.id, versionNo(o.id) + 1, reason, JSON.stringify(ops), JSON.stringify(r.diff), actor.user, actor.user, String(o.id)).lastInsertRowid);
        writeAudit(db, { entity: 'proj_wbs_versions', entityId: id, action: 'create', newValues: { ops: ops.length, changes: r.diff.length }, reason, actor: actor.user, companyId: o.company_id });
        return changes.get(actor, o.id, id);
      });
    },
    get(actor, projectId, id) { const { o, v } = changeRow(actor, projectId, id); return { ...versionView(v), diff: json(v.diff_json, []), ops: json(v.ops_json, []), projectCode: o.code, can: { submit: may(actor, 'proj.wbs.change', o.id) && ['DRAFT', 'RETURNED'].includes(v.version_status), withdraw: v.version_status === 'SUBMITTED' && same(v.requested_by, actor.user), cancel: may(actor, 'proj.wbs.change', o.id) && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(v.version_status) } }; },
    submit(actor, projectId, id) {
      const { o, v } = changeRow(actor, projectId, id); need(actor, 'proj.wbs.change', 'raise WBS changes', o.id);
      if (!['DRAFT', 'RETURNED'].includes(v.version_status)) throw unprocessable('Only a draft or returned change is sent for approval.');
      const ops = json(v.ops_json, []); const r = dryRun(actor, o, ops); if (r.problems.length) throw unprocessable('The WBS has changed since this request was made and the change no longer fits.', r.problems);
      return transaction(db, () => {
        const ctx = { projectId: o.id };
        if (v.version_status === 'RETURNED') workflowOf(db).resubmit(actor, v.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: WBS_CHANGE_DOC, docId: String(v.id), comment: `${o.code} WBS change`, context: ctx }); db.prepare('UPDATE proj_wbs_versions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, v.id); }
        db.prepare("UPDATE proj_wbs_versions SET version_status = 'SUBMITTED', diff_json = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(r.diff), actor.user, actor.user, nowIso(), v.id);
        writeAudit(db, { entity: 'proj_wbs_versions', entityId: v.id, action: 'submit', actor: actor.user, companyId: o.company_id });
        return changes.get(actor, o.id, v.id);
      });
    },
    withdraw(actor, projectId, id, { reason }) { const { o, v } = changeRow(actor, projectId, id); if (v.version_status !== 'SUBMITTED') throw unprocessable('Only a change waiting for approval is withdrawn.'); if (!same(v.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, v.workflow_instance_id, { comment: reason }); return changes.get(actor, o.id, v.id); },
    cancel(actor, projectId, id, { reason }) {
      const { o, v } = changeRow(actor, projectId, id); need(actor, 'proj.wbs.change', 'cancel WBS changes', o.id);
      if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(v.version_status)) throw unprocessable('Only a change that is not decided is cancelled.');
      return transaction(db, () => { if (v.version_status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, v.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_wbs_versions SET version_status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), v.id); writeAudit(db, { entity: 'proj_wbs_versions', entityId: v.id, action: 'cancel', reason, actor: actor.user, companyId: o.company_id }); return changes.get(actor, o.id, v.id); });
    },
    /** The approval: the operations are applied again (the WBS may have moved on), the version is kept with its snapshot and diff, the parts that follow are told. */
    decide(instance, actor, outcome, comment) {
      const v = db.prepare('SELECT * FROM proj_wbs_versions WHERE id = ?').get(rid(instance.docId)); if (!v || v.version_status !== 'SUBMITTED') return;
      const o = orgOf(v.project_id); const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      let to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      let note = comment ?? null;
      if (to === 'APPROVED') {
        const ops = json(v.ops_json, []); const before = snapshot(v.project_id);
        try {
          transaction(db, () => { applyOps({ ...actor, companyId: v.company_id }, o, ops); const p = checkAll(v.project_id); if (p.length) throw unprocessable('invalid', p); });
        } catch (x) { to = 'RETURNED'; note = `The change no longer fits the WBS (${x.message}); correct it and send it again.`; }
        if (to === 'APPROVED') {
          const after = snapshot(v.project_id); const d = diff(before, after);
          db.prepare("UPDATE proj_wbs_versions SET version_status = 'APPROVED', snapshot_json = ?, diff_json = ?, decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(after), JSON.stringify(d), nowIso(), actor.user, nowIso(), v.id);
          writeAudit(db, { entity: 'proj_wbs_versions', entityId: v.id, action: 'approved', newValues: { versionNo: v.version_no, changes: d.length }, reason: v.reason, actor: actor.user, companyId: v.company_id });
          event('proj.wbs.changed', actor, 'wbs_version', v.id, v.company_id, v.project_id, { projectId: v.project_id, code: o.code, versionNo: v.version_no, reason: v.reason, changes: d.length, added: d.filter((x) => x.kind === 'ADDED').length, moved: d.filter((x) => x.kind === 'MOVED').length, removed: d.filter((x) => x.kind === 'REMOVED').length });
          return;
        }
      }
      db.prepare('UPDATE proj_wbs_versions SET version_status = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, note, actor.user, nowIso(), v.id);
      if (withdrawn) db.prepare('UPDATE proj_wbs_versions SET workflow_instance_id = NULL WHERE id = ?').run(v.id);
      writeAudit(db, { entity: 'proj_wbs_versions', entityId: v.id, action: outcome.toLowerCase(), reason: note, actor: actor.user, companyId: v.company_id });
    },
    /** The project of a change request (the approval inbox opens a change without knowing its project). */
    locate(actor, id) { const v = db.prepare("SELECT * FROM proj_wbs_versions WHERE id = ? AND company_id = ? AND kind = 'CHANGE' AND deleted_at IS NULL").get(rid(id), actor.companyId); if (!v || !may(actor, 'proj.wbs.view', v.project_id)) throw notFound('That change request does not exist.'); return { projectId: v.project_id, id: v.id }; },
    history(actor, projectId, id) { const { v } = changeRow(actor, projectId, id); return { approvals: v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id) : [] }; },
  };

  // ---- locations (FR-04) -----------------------------------------------------------------------------------------------------------------------------
  const lrow = (projectId, id) => { const l = db.prepare('SELECT * FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(Number(id), projectId); if (!l) throw notFound('That location does not exist in this project.'); return l; };
  const locUsage = (projectId, l) => { let n = db.prepare('SELECT COUNT(*) AS n FROM proj_wbs_locations WHERE location_id = ? AND deleted_at IS NULL').get(l.id).n; for (const f of locationUsageProviders) n += Number(f(db, { projectId, locationId: l.id }) || 0); return n; };
  function locProblems(o, b, existing = null) {
    const p = []; const parent = b.parentId ? db.prepare('SELECT * FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.parentId, o.id) : null;
    if (b.parentId && !parent) p.push({ field: 'parentId', message: 'Choose a parent of this project' });
    const allowed = LOC_RULES[parent?.loc_type ?? ''] ?? [];
    if (!LOC_TYPES[b.type]) p.push({ field: 'type', message: 'Choose a type of the list' });
    else if (!allowed.includes(b.type)) p.push({ field: 'type', message: parent ? `A ${LOC_TYPES[b.type].toLowerCase()} is not placed under a ${LOC_TYPES[parent.loc_type].toLowerCase()} (allowed: ${allowed.map((t) => LOC_TYPES[t].toLowerCase()).join(', ') || 'nothing'})` : `A ${LOC_TYPES[b.type].toLowerCase()} is not at the top level` });
    if (parent && parent.loc_status !== 'ACTIVE') p.push({ field: 'parentId', message: `${parent.code} is inactive` });
    const chain = CHAINAGE_TYPES.includes(b.type); const from = b.chainageFrom ?? null; const to = b.chainageTo ?? null;
    if (!chain && (from != null || to != null)) p.push({ field: 'chainageFrom', message: 'Only a chainage segment or a structure has a chainage' });
    if (b.type === 'CHAINAGE') { if (from == null || to == null) p.push({ field: 'chainageFrom', message: 'A chainage segment has a start and an end' }); else if (to <= from) p.push({ field: 'chainageTo', message: 'The end of a segment is beyond its start' }); }
    if (b.type === 'STRUCTURE' && from == null) p.push({ field: 'chainageFrom', message: 'A structure has its chainage (the start, and the end when it has a length)' });
    if (from != null && to != null && to < from) p.push({ field: 'chainageTo', message: 'The end is before the start' });
    if (chain && from != null) {
      if (parent?.loc_type === 'CHAINAGE' && parent.chainage_from != null && (from < parent.chainage_from || (to ?? from) > parent.chainage_to)) p.push({ field: 'chainageFrom', message: `Inside ${parent.code} the chainage is from ${parent.chainage_from} m to ${parent.chainage_to} m` });
      if (b.type === 'CHAINAGE') for (const s of db.prepare("SELECT code, chainage_from AS f, chainage_to AS t FROM proj_locations WHERE project_id = ? AND parent_id IS ? AND loc_type = 'CHAINAGE' AND deleted_at IS NULL AND loc_status = 'ACTIVE' AND id != ?").all(o.id, b.parentId ?? null, existing?.id ?? 0)) if (from < s.t && to > s.f) p.push({ field: 'chainageFrom', message: `The segment overlaps ${s.code} (${s.f} to ${s.t} m)` });
    }
    if (existing && b.type === 'CHAINAGE' && from != null && to != null) for (const k of db.prepare("SELECT code, chainage_from AS f, chainage_to AS t FROM proj_locations WHERE parent_id = ? AND deleted_at IS NULL AND chainage_from IS NOT NULL").all(existing.id)) if (k.f < from || (k.t ?? k.f) > to) p.push({ field: 'chainageFrom', message: `${k.code} (${k.f} to ${k.t ?? k.f} m) would fall outside the segment` });
    if ((b.lat == null) !== (b.lng == null)) p.push({ field: 'lat', message: 'Give both the latitude and the longitude, or neither' });
    if (b.lat != null && (b.lat < -90 || b.lat > 90)) p.push({ field: 'lat', message: 'Latitude is from -90 to 90' });
    if (b.lng != null && (b.lng < -180 || b.lng > 180)) p.push({ field: 'lng', message: 'Longitude is from -180 to 180' });
    const code = (b.code ?? '').trim(); if (!codeOk(code)) p.push({ field: 'code', message: 'A code is letters, digits and . _ / - (up to 40 characters)' });
    else if (db.prepare('SELECT 1 FROM proj_locations WHERE project_id = ? AND code = ? AND deleted_at IS NULL AND id != ?').get(o.id, code, existing?.id ?? 0)) p.push({ field: 'code', message: `${code} is used in this project already` });
    if (!String(b.name ?? '').trim()) p.push({ field: 'name', message: 'Give the name' });
    return p;
  }
  function putLocation(actor, o, b, ctx = {}) {
    fail(locProblems(o, b));
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM proj_locations WHERE project_id = ? AND parent_id IS ? AND deleted_at IS NULL').get(o.id, b.parentId ?? null).n;
    const id = Number(db.prepare('INSERT INTO proj_locations (company_id, project_id, parent_id, loc_type, code, name, chainage_from, chainage_to, lat, lng, sort_order, description, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(actor.companyId, o.id, b.parentId ?? null, b.type, b.code.trim(), b.name.trim(), b.chainageFrom ?? null, b.type === 'STRUCTURE' ? (b.chainageTo ?? b.chainageFrom ?? null) : (b.chainageTo ?? null), b.lat ?? null, b.lng ?? null, order, b.description ?? null, actor.user, ctx.sourceType ?? 'proj_project', String(ctx.sourceId ?? o.id)).lastInsertRowid);
    return lrow(o.id, id);
  }
  const locView = (l, extra = {}) => ({ id: l.id, parentId: l.parent_id, type: l.loc_type, typeLabel: LOC_TYPES[l.loc_type], code: l.code, name: l.name, chainageFrom: l.chainage_from, chainageTo: l.chainage_to, lat: l.lat, lng: l.lng, sortOrder: l.sort_order, status: l.loc_status, description: l.description, rowVersion: l.version, ...extra });
  const locations = {
    tree(actor, projectId) {
      const o = project(actor, projectId); const rows = db.prepare('SELECT * FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL ORDER BY COALESCE(chainage_from, 999999999), parent_id, sort_order, id').all(o.id);
      const kids = new Map(); for (const l of rows) kids.set(l.parent_id ?? 0, (kids.get(l.parent_id ?? 0) ?? 0) + 1);
      return { project: { id: o.id, code: o.code, name: o.name, type: o.type }, nodes: rows.map((l) => locView(l, { children: kids.get(l.id) ?? 0, usage: locUsage(o.id, l) })), types: Object.entries(LOC_TYPES).map(([code, label]) => ({ code, label })), rules: LOC_RULES, linear: rows.some((l) => CHAINAGE_TYPES.includes(l.loc_type)), can: { manage: may(actor, 'proj.wbs.manage', o.id), import: may(actor, 'proj.wbs.import', o.id), export: may(actor, 'proj.wbs.export', o.id) } };
    },
    create(actor, projectId, b) {
      const o = project(actor, projectId, 'proj.wbs.manage');
      return transaction(db, () => { const l = putLocation(actor, o, b); writeAudit(db, { entity: 'proj_locations', entityId: l.id, action: 'create', newValues: { code: l.code, type: l.loc_type }, actor: actor.user, companyId: o.company_id }); event('proj.location.updated', actor, 'location', l.id, o.company_id, o.id, { projectId: o.id, locationId: l.id, code: l.code, action: 'created' }); return locView(l); });
    },
    update(actor, projectId, id, b) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const l = lrow(o.id, id);
      if (b.version != null && b.version !== l.version) throw conflict(`${l.code} was changed by someone else; reload it.`);
      const m = { parentId: l.parent_id, type: l.loc_type, code: l.code, name: l.name, chainageFrom: l.chainage_from, chainageTo: l.chainage_to, lat: l.lat, lng: l.lng, description: l.description, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'version' && k !== 'status')) };
      if (m.type !== l.loc_type && db.prepare('SELECT 1 FROM proj_locations WHERE parent_id = ? AND deleted_at IS NULL').get(l.id)) throw unprocessable('The type of a location with locations under it is not changed.');
      fail(locProblems(o, m, l));
      return transaction(db, () => {
        db.prepare('UPDATE proj_locations SET loc_type = ?, code = ?, name = ?, chainage_from = ?, chainage_to = ?, lat = ?, lng = ?, description = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.type, m.code.trim(), m.name.trim(), m.chainageFrom ?? null, m.chainageTo ?? null, m.lat ?? null, m.lng ?? null, m.description ?? null, actor.user, nowIso(), l.id);
        writeAudit(db, { entity: 'proj_locations', entityId: l.id, action: 'update', oldValues: { code: l.code, name: l.name }, newValues: b, actor: actor.user, companyId: o.company_id }); event('proj.location.updated', actor, 'location', l.id, o.company_id, o.id, { projectId: o.id, locationId: l.id, code: m.code, action: 'updated' });
        return locView(lrow(o.id, l.id));
      });
    },
    move(actor, projectId, id, { parentId = null }) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const l = lrow(o.id, id);
      const sub = new Set(); const walk = (pid) => { for (const c of db.prepare('SELECT id FROM proj_locations WHERE parent_id = ? AND deleted_at IS NULL').all(pid)) { sub.add(c.id); walk(c.id); } }; walk(l.id);
      if (parentId && (parentId === l.id || sub.has(parentId))) throw unprocessable('A location cannot be moved under itself or under one of its own locations.');
      fail(locProblems(o, { parentId, type: l.loc_type, code: l.code, name: l.name, chainageFrom: l.chainage_from, chainageTo: l.chainage_to, lat: l.lat, lng: l.lng }, l));
      return transaction(db, () => { db.prepare('UPDATE proj_locations SET parent_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(parentId, actor.user, nowIso(), l.id); writeAudit(db, { entity: 'proj_locations', entityId: l.id, action: 'move', oldValues: { parentId: l.parent_id }, newValues: { parentId }, actor: actor.user, companyId: o.company_id }); event('proj.location.updated', actor, 'location', l.id, o.company_id, o.id, { projectId: o.id, locationId: l.id, code: l.code, action: 'moved' }); return locations.tree(actor, o.id); });
    },
    setStatus(actor, projectId, id, on) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const l = lrow(o.id, id);
      return transaction(db, () => {
        const ids = [l.id]; if (!on) { const walk = (pid) => { for (const c of db.prepare('SELECT id FROM proj_locations WHERE parent_id = ? AND deleted_at IS NULL').all(pid)) { ids.push(c.id); walk(c.id); } }; walk(l.id); }
        else if (l.parent_id && db.prepare("SELECT 1 FROM proj_locations WHERE id = ? AND loc_status = 'INACTIVE'").get(l.parent_id)) throw unprocessable('Activate the parent first.');
        for (const i of ids) db.prepare('UPDATE proj_locations SET loc_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(on ? 'ACTIVE' : 'INACTIVE', actor.user, nowIso(), i);
        writeAudit(db, { entity: 'proj_locations', entityId: l.id, action: on ? 'activate' : 'deactivate', actor: actor.user, companyId: o.company_id }); return locations.tree(actor, o.id);
      });
    },
    remove(actor, projectId, id) {
      const o = project(actor, projectId, 'proj.wbs.manage'); const l = lrow(o.id, id);
      if (db.prepare('SELECT 1 FROM proj_locations WHERE parent_id = ? AND deleted_at IS NULL').get(l.id)) throw unprocessable(`${l.code} has locations under it: delete or move them first.`);
      const u = locUsage(o.id, l); if (u > 0) throw new HttpError(409, 'LOCATION_IN_USE', `${l.code} is in use (${u} record(s) point at it): it is deactivated, not deleted.`);
      return transaction(db, () => { db.prepare('UPDATE proj_locations SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, l.id); writeAudit(db, { entity: 'proj_locations', entityId: l.id, action: 'delete', oldValues: { code: l.code }, actor: actor.user, companyId: o.company_id }); return locations.tree(actor, o.id); });
    },
    importRow(actor, { projectCode, row }) {
      const o = db.prepare('SELECT * FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1').get(actor.companyId, projectCode); if (!o) throw unprocessable(`Project ${projectCode} does not exist`);
      project(actor, o.id, 'proj.wbs.import');
      const parent = row.parentCode ? db.prepare('SELECT id FROM proj_locations WHERE project_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(o.id, row.parentCode) : null; if (row.parentCode && !parent) throw unprocessable(`The parent ${row.parentCode} is not in the project (list parents before their children)`);
      const l = putLocation(actor, o, { parentId: parent?.id ?? null, type: row.type, code: row.code, name: row.name, chainageFrom: row.chainageFrom ?? null, chainageTo: row.chainageTo ?? null, lat: row.lat ?? null, lng: row.lng ?? null }, { sourceType: 'excel_import' });
      return { id: l.id, ref: `${o.code} ${l.code}` };
    },
  };

  // ---- the matrix (FR-05) ------------------------------------------------------------------------------------------------------------------------------
  const matrix = {
    get(actor, projectId) {
      const o = project(actor, projectId); const w = nodes(o.id, true); const hasKid = new Set(w.filter((x) => x.parent_id).map((x) => x.parent_id));
      const ls = db.prepare("SELECT * FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL AND loc_status = 'ACTIVE' ORDER BY COALESCE(chainage_from, 999999999), parent_id, sort_order, id").all(o.id); const lKid = new Set(ls.filter((x) => x.parent_id).map((x) => x.parent_id));
      const cells = db.prepare('SELECT wbs_id, location_id FROM proj_wbs_locations WHERE project_id = ? AND deleted_at IS NULL').all(o.id);
      return { project: { id: o.id, code: o.code }, rows: w.filter((x) => !hasKid.has(x.id)).map((x) => ({ id: x.id, code: x.code, name: x.name, path: x.level })), columns: ls.filter((x) => !lKid.has(x.id)).map((x) => ({ id: x.id, code: x.code, name: x.name, type: x.loc_type })), cells: cells.map((c) => [c.wbs_id, c.location_id]), can: { manage: may(actor, 'proj.wbs.manage', o.id) } };
    },
    set(actor, projectId, { cells }) {
      const o = project(actor, projectId, 'proj.wbs.manage');
      return transaction(db, () => {
        let on = 0; let off = 0;
        for (const c of cells) {
          const w = node(o.id, c.wbsId); const l = lrow(o.id, c.locationId);
          if (db.prepare('SELECT 1 FROM proj_wbs WHERE parent_id = ? AND deleted_at IS NULL').get(w.id)) throw unprocessable(`${w.code} has nodes under it: the matrix is kept for the lowest nodes.`);
          if (db.prepare('SELECT 1 FROM proj_locations WHERE parent_id = ? AND deleted_at IS NULL').get(l.id)) throw unprocessable(`${l.code} has locations under it: the matrix is kept for the lowest locations.`);
          if (w.wbs_status !== 'ACTIVE' || l.loc_status !== 'ACTIVE') throw unprocessable('Inactive nodes and locations are not in the matrix.');
          const has = db.prepare('SELECT id FROM proj_wbs_locations WHERE wbs_id = ? AND location_id = ? AND deleted_at IS NULL').get(w.id, l.id);
          if (c.on && !has) { db.prepare("INSERT INTO proj_wbs_locations (company_id, project_id, wbs_id, location_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'proj_wbs', ?)").run(actor.companyId, o.id, w.id, l.id, actor.user, String(w.id)); on += 1; }
          if (!c.on && has) { db.prepare('DELETE FROM proj_wbs_locations WHERE id = ?').run(has.id); off += 1; }
        }
        writeAudit(db, { entity: 'proj_wbs_locations', entityId: o.id, action: 'matrix', newValues: { on, off }, actor: actor.user, companyId: o.company_id });
        event('proj.matrix.updated', actor, 'matrix', o.id, o.company_id, o.id, { projectId: o.id, on, off });
        return matrix.get(actor, o.id);
      });
    },
  };

  // ---- work packages (FR-03) -----------------------------------------------------------------------------------------------------------------------------
  const wprow = (actor, id) => { const x = db.prepare('SELECT * FROM proj_work_packages WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!x || !may(actor, 'proj.wbs.view', x.project_id)) throw notFound('That work package does not exist.'); return x; };
  const wpView = (x, detail = false) => {
    const ids = json(x.wbs_ids_json, []); const o = orgOf(x.project_id);
    const out = { id: x.id, projectId: x.project_id, projectCode: o?.code, code: x.code, name: x.name, type: x.wp_type, typeLabel: WP_TYPES[x.wp_type], ownerUser: x.owner_user, status: x.wp_status, statusLabel: WP_STATUS[x.wp_status], description: x.description, wbsIds: ids, rowVersion: x.version };
    if (detail) out.nodes = ids.map((i) => db.prepare('SELECT id, code, name, wbs_status AS status FROM proj_wbs WHERE id = ? AND deleted_at IS NULL').get(i)).filter(Boolean);
    return out;
  };
  function wpProblems(actor, o, b, existing = null) {
    const p = []; const code = (b.code ?? '').trim();
    if (!codeOk(code)) p.push({ field: 'code', message: 'A code is letters, digits and . _ / - (up to 40 characters)' });
    else if (db.prepare('SELECT 1 FROM proj_work_packages WHERE project_id = ? AND code = ? AND deleted_at IS NULL AND id != ?').get(o.id, code, existing?.id ?? 0)) p.push({ field: 'code', message: `${code} is used in this project already` });
    if (!String(b.name ?? '').trim()) p.push({ field: 'name', message: 'Give the name' });
    if (!WP_TYPES[b.type]) p.push({ field: 'type', message: 'Choose a type of the list' });
    if (b.ownerUser && !userOk(actor.companyId, b.ownerUser)) p.push({ field: 'ownerUser', message: `${b.ownerUser} is not a user of your company` });
    const ids = b.wbsIds ?? []; if (new Set(ids).size !== ids.length) p.push({ field: 'wbsIds', message: 'A node is listed twice' });
    for (const i of ids) {
      const w = db.prepare('SELECT * FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(i, o.id);
      if (!w) { p.push({ field: 'wbsIds', message: `Node ${i} is not in this project` }); continue; }
      if (w.wbs_status !== 'ACTIVE') p.push({ field: 'wbsIds', message: `${w.code} is inactive` });
      const other = db.prepare("SELECT code FROM proj_work_packages WHERE project_id = ? AND wp_type = ? AND deleted_at IS NULL AND wp_status != 'INACTIVE' AND id != ? AND EXISTS (SELECT 1 FROM json_each(wbs_ids_json) j WHERE j.value = ?)").get(o.id, b.type, existing?.id ?? 0, i);
      if (other) p.push({ field: 'wbsIds', message: `${w.code} is in work package ${other.code} of the same type already` });
    }
    return p;
  }
  const packages = {
    list(actor, query) {
      need(actor, 'proj.wbs.view', 'see work packages'); const f = authz.scopeFilter(actor, 'proj.wbs.view', { project: 'x.project_id' });
      return runList(db, workPackageList, parseListRequest(workPackageList, query), { select: 'x.*', scopeSql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) }, tieBreaker: 'x.id', map: (x) => ({ ...wpView(x), nodes: json(x.wbs_ids_json, []).length }) });
    },
    exportSource(actor, req) {
      need(actor, 'proj.wbs.export', 'export work packages'); const f = authz.scopeFilter(actor, 'proj.wbs.view', { project: 'x.project_id' }); const opts = { select: 'x.*', scopeSql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) }, tieBreaker: 'x.id' };
      return { title: workPackageList.label, permission: 'proj.wbs.export', personal: false, columns: [{ key: 'code', label: 'Code', type: 'text' }, { key: 'name', label: 'Work package', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'owner', label: 'Owner', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'nodes', label: 'WBS nodes', type: 'number' }], count: () => countList(db, workPackageList, req, opts),
        rows: () => runList(db, workPackageList, req, { ...opts, limit: null, map: (x) => { const v = wpView(x); return { code: v.code, name: v.name, project: v.projectCode, type: v.typeLabel, owner: v.ownerUser ?? '', status: v.statusLabel, nodes: v.wbsIds.length }; } }).data, describe: (r) => [r.q ? `search "${r.q}"` : ''].filter(Boolean) };
    },
    get(actor, id) { return wpView(wprow(actor, id), true); },
    create(actor, projectId, b) {
      const o = project(actor, projectId, 'proj.wbs.manage'); fail(wpProblems(actor, o, b));
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO proj_work_packages (company_id, project_id, code, name, wp_type, wbs_ids_json, owner_user, description, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_project', ?)").run(actor.companyId, o.id, b.code.trim(), b.name.trim(), b.type, JSON.stringify(b.wbsIds ?? []), b.ownerUser ? userName(actor.companyId, b.ownerUser) : null, b.description ?? null, actor.user, String(o.id)).lastInsertRowid);
        writeAudit(db, { entity: 'proj_work_packages', entityId: id, action: 'create', newValues: { code: b.code, type: b.type, nodes: (b.wbsIds ?? []).length }, actor: actor.user, companyId: o.company_id });
        event('proj.workpackage.updated', actor, 'work_package', id, o.company_id, o.id, { projectId: o.id, workPackageId: id, code: b.code, type: b.type, action: 'created' });
        return wpView(wprow(actor, id), true);
      });
    },
    update(actor, id, b) {
      const x = wprow(actor, id); const o = orgOf(x.project_id); need(actor, 'proj.wbs.manage', 'change work packages', x.project_id);
      if (b.version != null && b.version !== x.version) throw conflict(`${x.code} was changed by someone else; reload it.`);
      if (x.wp_status === 'CLOSED' && b.status === undefined) throw new HttpError(409, 'LOCKED', `${x.code} is closed: reopen it first.`);
      const m = { code: x.code, name: x.name, type: x.wp_type, ownerUser: x.owner_user, description: x.description, wbsIds: json(x.wbs_ids_json, []), ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && !['version', 'status'].includes(k))) };
      fail(wpProblems(actor, o, m, x)); const status = b.status ?? x.wp_status;
      return transaction(db, () => {
        db.prepare('UPDATE proj_work_packages SET code = ?, name = ?, wp_type = ?, wbs_ids_json = ?, owner_user = ?, description = ?, wp_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.code.trim(), m.name.trim(), m.type, JSON.stringify(m.wbsIds), m.ownerUser ? userName(actor.companyId, m.ownerUser) : null, m.description ?? null, status, actor.user, nowIso(), x.id);
        writeAudit(db, { entity: 'proj_work_packages', entityId: x.id, action: 'update', oldValues: { code: x.code, status: x.wp_status }, newValues: b, actor: actor.user, companyId: x.company_id });
        event('proj.workpackage.updated', actor, 'work_package', x.id, x.company_id, x.project_id, { projectId: x.project_id, workPackageId: x.id, code: m.code, type: m.type, status, action: 'updated' });
        return wpView(wprow(actor, x.id), true);
      });
    },
    remove(actor, id) {
      const x = wprow(actor, id); need(actor, 'proj.wbs.manage', 'delete work packages', x.project_id);
      return transaction(db, () => { db.prepare('UPDATE proj_work_packages SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, x.id); writeAudit(db, { entity: 'proj_work_packages', entityId: x.id, action: 'delete', oldValues: { code: x.code }, actor: actor.user, companyId: x.company_id }); return { id: x.id, deleted: true }; });
    },
  };
  /** For the parts that follow: the WBS, the locations and the work packages of a project (reads only). */
  const forProject = (companyId, projectId) => ({ wbs: nodes(projectId, true).map((w) => ({ id: w.id, parentId: w.parent_id, code: w.code, name: w.name, level: w.level, weight: pctText(w.weight), controlAccount: Boolean(w.is_control_account) })), locations: db.prepare("SELECT id, parent_id AS parentId, loc_type AS type, code, name, chainage_from AS chainageFrom, chainage_to AS chainageTo FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL AND loc_status = 'ACTIVE'").all(projectId), baselined: baselined(projectId), versionNo: versionNo(projectId) });
  return { projectsList, wbs, changes, locations, matrix, packages, decide: changes.decide, forProject, baselined };
}

const services = new WeakMap();
export const bindStructure = (db, s) => services.set(db, s);
export const structureOf = (db) => services.get(db) ?? null;

const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const changeLine = (db, id) => db.prepare('SELECT v.*, p.code, p.name FROM proj_wbs_versions v JOIN org_projects p ON p.id = v.project_id WHERE v.id = ?').get(id);
workflowTypes.register({
  docType: WBS_CHANGE_DOC, label: 'WBS change after baseline', processOwner: 'PCMGR', route: (id) => `/proj/wbs?change=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT v.requested_by, v.version_no, p.code, p.name FROM proj_wbs_versions v JOIN org_projects p ON p.id = v.project_id WHERE v.id = ? AND v.company_id = ?').get(rid(id), companyId); return r ? { ref: `${r.code} WBS v${r.version_no}`, title: r.name, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = changeLine(db, rid(id)); if (!r) return null; const d = json(r.diff_json, []); return { fields: [{ label: 'Project', value: `${r.code} ${r.name}` }, { label: 'Version', value: String(r.version_no) }, { label: 'Why', value: r.reason ?? '' }, { label: 'Changes', value: d.map((x) => `${x.kind.toLowerCase()} ${x.code}`).join('; ').slice(0, 400) }] }; },
  defaultDefinition: { name: 'WBS change after baseline: planning, the project manager, then the project controls manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PLAN', 'Planning engineer', 'PLAN'), step('PM', 'Project manager', 'PM'), step('PCMGR', 'Project controls manager', 'PCMGR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => structureOf(db)?.decide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => structureOf(db)?.decide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => structureOf(db)?.decide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => structureOf(db)?.decide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(WBS_CHANGE_DOC, ({ db, instance }) => {
  const v = changeLine(db, rid(instance.docId)); if (!v) return { sections: [] }; const d = json(v.diff_json, []);
  return { sections: [{ code: 'proj-wbs-change', title: 'Before approving the WBS change', kind: 'metrics', items: [{ label: 'Version', value: String(v.version_no), format: 'text' }, { label: 'Reason', value: v.reason ?? '', format: 'text' }, { label: 'Nodes added', value: String(d.filter((x) => x.kind === 'ADDED').length), format: 'text' }, { label: 'Nodes moved', value: String(d.filter((x) => x.kind === 'MOVED').length), format: 'text' }, { label: 'Nodes changed', value: String(d.filter((x) => x.kind === 'CHANGED').length), format: 'text' }, { label: 'Nodes removed', value: String(d.filter((x) => x.kind === 'REMOVED').length), format: 'text' }] }] };
});
