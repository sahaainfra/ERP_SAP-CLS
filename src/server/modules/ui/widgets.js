import { z } from 'zod';
import { hasPermission, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { widgetRegistry, roleLayouts } from '../../platform/widgets/index.js';
import { parse } from '../../platform/validation/index.js';
import { financialYear, todayIST } from '../../../shared/dates.js';

// Part 03.07: the dashboard and widget framework's server side. The widget catalogue for a person, the data of one widget (through the provider of the
// module that owns it, inside the person's scope), and dashboards: the system layout, the default of a role (a change request another administrator
// approves) and each person's own copy (kept on the server, so it follows the person to every device).

export const APPROVAL_TYPE = 'ui_dashboard_change';
export const DASHBOARD_CHAIN = ['SYSADM'];
const MAX_ITEMS = 40;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD');
const code = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/, 'Not a widget code');
const dashboardCode = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, 'Not a dashboard code');
const PARAMS = {
  'notice.text': z.object({ title: z.string().trim().max(80).optional(), text: z.string().trim().min(1, 'Write the notice').max(1000) }).strict(),
  'requests.top': z.object({ limit: z.number().int().min(3).max(20) }).strict(),
};
const filtersShape = z.object({ projectId: z.number().int().positive().nullable().optional(), siteId: z.number().int().positive().nullable().optional(), preset: z.string().max(30).optional(), from: day.optional(), to: day.optional() }).strict();
const item = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/), widget: code, w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(4), params: z.record(z.string(), z.unknown()).optional() }).strict();
const layoutShape = z.array(item).max(MAX_ITEMS).superRefine((list, ctx) => {
  if (new Set(list.map((i) => i.id)).size !== list.length) ctx.addIssue({ code: 'custom', message: 'Each place on the dashboard needs its own id' });
});

export const parseDashboardCode = (v) => parse(dashboardCode, v);
export const parseWidgetCode = (v) => parse(code, v);
export const parseWidgetQuery = (q) => parse(z.object({
  projectId: z.coerce.number().int().positive().optional(), siteId: z.coerce.number().int().positive().optional(), from: day.optional(), to: day.optional(),
  params: z.string().max(2000).optional(),
}).strict(), q ?? {});
export const parsePersonal = (b) => parse(z.object({ layout: layoutShape, filters: filtersShape.default({}), version: z.number().int().positive().optional() }).strict(), b);
export const parseRoleDefault = (b) => parse(z.object({
  role: z.string().regex(/^[A-Z][A-Z0-9-]{1,19}$/, 'Use a role code such as PM'), name: z.string().trim().min(2).max(60).optional(),
  layout: layoutShape.optional(), filters: filtersShape.default({}), remove: z.boolean().optional(), reason: z.string().trim().min(5, 'Say why in at least 5 characters').max(500),
}).strict().refine((v) => v.remove || v.layout, { message: 'Give a layout, or ask to remove the default', path: ['layout'] }), b);
export const parseHistory = (q) => parse(z.object({ role: z.string().regex(/^[A-Z][A-Z0-9-]{1,19}$/) }).strict(), q);

const jsonOf = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

/** The approval handler of this part: an approved request makes the role's default what was asked, in the approver's transaction. */
export const dashboardHandlers = {
  [APPROVAL_TYPE]: {
    apply(db, request, actor) {
      const { code: dash, role, name, layout, filters, remove, baseVersion } = request.payload;
      const existing = db.prepare("SELECT * FROM ui_dashboards WHERE company_id = ? AND code = ? AND owner_type = 'role' AND owner_ref = ? AND deleted_at IS NULL").get(request.companyId, dash, role);
      if ((existing?.version ?? 0) !== baseVersion) throw unprocessable(`The default of ${role} for ${dash} was changed after this request was raised. Raise the change again from what it is now.`);
      const system = db.prepare("SELECT * FROM ui_dashboards WHERE company_id IS NULL AND code = ? AND owner_type = 'system'").get(dash);
      if (!system) throw unprocessable(`There is no dashboard called ${dash} any more.`);
      const at = new Date().toISOString();
      if (remove) {
        if (existing) {
          db.prepare('DELETE FROM ui_dashboards WHERE id = ?').run(existing.id);
          writeAudit(db, { entity: 'ui_dashboards', entityId: existing.id, action: 'remove', oldValues: { code: dash, role, widgets: jsonOf(existing.layout_json, []).length }, reason: request.reason, actor: actor.user, companyId: request.companyId });
        }
      } else if (existing) {
        db.prepare('UPDATE ui_dashboards SET name = ?, layout_json = ?, filters_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(name ?? existing.name, JSON.stringify(layout), JSON.stringify(filters ?? {}), actor.user, at, existing.id);
        writeAudit(db, { entity: 'ui_dashboards', entityId: existing.id, action: 'update', oldValues: { widgets: jsonOf(existing.layout_json, []).map((i) => i.widget), name: existing.name }, newValues: { widgets: layout.map((i) => i.widget), name: name ?? existing.name }, reason: request.reason, actor: actor.user, companyId: request.companyId });
      } else {
        const id = Number(db.prepare("INSERT INTO ui_dashboards (company_id, code, name, owner_type, owner_ref, permission_key, layout_json, filters_json, created_by, source_type) VALUES (?, ?, ?, 'role', ?, ?, ?, ?, ?, 'dashboard_default')")
          .run(request.companyId, dash, name ?? system.name, role, system.permission_key, JSON.stringify(layout), JSON.stringify(filters ?? {}), actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'ui_dashboards', entityId: id, action: 'create', newValues: { code: dash, role, widgets: layout.map((i) => i.widget) }, reason: request.reason, actor: actor.user, companyId: request.companyId });
      }
      publishEvent(db, { type: 'ui.dashboard.changed', entity: 'dashboard', entityId: system.id, actorId: actor.user, companyId: request.companyId, data: { code: dash, role, removed: Boolean(remove), request: request.id } });
    },
  },
};

/** `approvals` is the approval engine, `shell` the shell service (the person's scope and quick actions), `targets` reads the company's widget targets. */
export function createWidgetService({ db, approvals, shell }) {
  const params = { get: (key, ctx) => createParameterStore(db).get(key, ctx) }; // read afresh: a changed value applies at once
  const cid = (actor) => actor.companyId;
  const may = (actor, key) => key === 'self' || hasPermissionAnywhere(actor, key);
  const metaOf = (r) => ({ code: r.code, module: r.module, title: r.title, titleHi: r.title_hi, description: r.description, type: r.type, defaultW: r.default_w, defaultH: r.default_h, refreshSec: r.refresh_sec, drillRoute: r.drill_route });
  const widgetRows = () => db.prepare('SELECT * FROM ui_widgets WHERE is_active = 1 AND deleted_at IS NULL ORDER BY sort_order, code').all().filter((r) => widgetRegistry.get(r.code));
  const rowOf = (c) => widgetRows().find((r) => r.code === c);

  /** The widgets this person may put on a dashboard. */
  const catalogue = (actor) => widgetRows().filter((r) => may(actor, r.permission_key) && widgetRegistry.available(r.code, db, actor)).map((r) => ({ ...metaOf(r), paramsKey: PARAMS[r.code] ? r.code : null }));

  /** The default period: the financial year the day is in. */
  const defaultPeriod = () => { const fy = financialYear(todayIST()); return { from: fy.start, to: fy.end }; };

  function filtersOf(actor, q) {
    const f = { ...defaultPeriod(), projectId: null, siteId: null };
    if (q.from) f.from = q.from;
    if (q.to) f.to = q.to;
    if (f.from > f.to) throw badRequest('Some fields are invalid.', [{ field: 'from', message: 'must not be after the end of the period' }]);
    const opts = shell.contextOptions(actor);
    if (q.projectId) {
      if (!opts.projects.some((p) => p.id === q.projectId)) throw forbidden('That is not a project you can work in.');
      f.projectId = q.projectId;
    }
    if (q.siteId) {
      if (!f.projectId || !opts.sites.some((s) => s.id === q.siteId && s.projectId === f.projectId)) throw badRequest('Some fields are invalid.', [{ field: 'siteId', message: 'is not a site of that project that you can work in' }]);
      f.siteId = q.siteId;
    }
    return f;
  }

  /** The data of one widget for this person, inside their permission and data scope (BR-01). */
  function data(actor, widgetCode, query) {
    const row = rowOf(widgetCode);
    if (!row) throw notFound(`There is no widget called ${widgetCode}.`);
    if (!may(actor, row.permission_key)) throw forbidden(`Your role does not include ${row.permission_key}, which the widget "${row.title}" needs.`);
    if (!widgetRegistry.available(widgetCode, db, actor)) throw notFound('That widget is unavailable.');
    let widgetParams = {};
    if (query.params) {
      try { widgetParams = JSON.parse(query.params); } catch { throw badRequest('Some fields are invalid.', [{ field: 'params', message: 'is not valid JSON' }]); }
      if (typeof widgetParams !== 'object' || widgetParams === null || Array.isArray(widgetParams)) throw badRequest('Some fields are invalid.', [{ field: 'params', message: 'must be an object' }]);
    }
    const filters = filtersOf(actor, query);
    const ctx = {
      db, actor, filters, params: widgetParams, approvals, shell,
      slaHours: Number(params.get('ui.approval.sla_hours', { companyId: cid(actor), date: todayIST() })),
      targets: { timeliness: Number(params.get('ui.widget.timeliness_target', { companyId: cid(actor), date: todayIST() })) },
    };
    return { ...metaOf(row), asOf: new Date().toISOString(), filters: { projectId: filters.projectId, siteId: filters.siteId, from: filters.from, to: filters.to }, data: widgetRegistry.get(row.code)(ctx) };
  }

  // ---- dashboards ----
  const systemRow = (dash) => db.prepare("SELECT * FROM ui_dashboards WHERE company_id IS NULL AND code = ? AND owner_type = 'system' AND is_active = 1 AND deleted_at IS NULL").get(dash);
  const ownRow = (actor, dash, type, ref) => db.prepare('SELECT * FROM ui_dashboards WHERE company_id = ? AND code = ? AND owner_type = ? AND owner_ref = ? AND is_active = 1 AND deleted_at IS NULL').get(cid(actor), dash, type, ref);
  const mustSee = (actor, sys) => {
    if (!may(actor, sys.permission_key)) throw forbidden(`Your role does not include ${sys.permission_key}, which the dashboard "${sys.name}" needs.`);
  };
  const withMeta = (layout) => layout.map((i) => ({ ...i, params: i.params ?? {} }));

  /** The dashboards this person can open. */
  function list(actor) {
    return db.prepare("SELECT * FROM ui_dashboards WHERE company_id IS NULL AND owner_type = 'system' AND is_active = 1 AND deleted_at IS NULL ORDER BY id").all()
      .filter((s) => may(actor, s.permission_key)).map((s) => ({ code: s.code, name: s.name, hasPersonal: Boolean(ownRow(actor, s.code, 'user', actor.user)) }));
  }

  /** The dashboard this person sees: their own copy, else the default of their role, else the system one; widgets they may not use are left out. */
  function resolve(actor, dash) {
    const sys = systemRow(dash);
    if (!sys) throw notFound(`There is no dashboard called ${dash}.`);
    mustSee(actor, sys);
    const personal = ownRow(actor, dash, 'user', actor.user);
    let role = null;
    if (!personal) for (const r of actor.roles ?? []) { role = ownRow(actor, dash, 'role', r); if (role) break; }
    // a role layout written in code (part 166.5, Home insights) when nothing is saved for the person or the role
    const coded = !personal && !role ? roleLayouts.for(dash, actor.roles ?? []) : null;
    if (coded) role = { owner_ref: coded[0], name: sys.name, layout_json: JSON.stringify(coded[1]), filters_json: sys.filters_json };
    const chosen = personal ?? role ?? sys;
    const all = withMeta(jsonOf(chosen.layout_json, []));
    const allowed = new Set(catalogue(actor).map((w) => w.code));
    const layout = all.filter((i) => allowed.has(i.widget));
    return {
      code: sys.code, name: chosen.name, source: personal ? 'personal' : role ? 'role' : 'system', roleCode: role?.owner_ref ?? null,
      layout, omitted: all.length - layout.length, filters: jsonOf(chosen.filters_json, {}), version: personal?.version ?? null, hasPersonal: Boolean(personal),
      canManage: hasPermission(actor, 'ui.dashboard.manage'),
    };
  }

  /** Check every place of a layout: the widget exists and its parameters are the ones it takes. */
  function checkLayout(layout) {
    const problems = [];
    layout.forEach((i, n) => {
      if (!widgetRegistry.get(i.widget) || !rowOf(i.widget)) problems.push({ field: `layout.${n}.widget`, message: `${i.widget} is not a widget of this application` });
      const schema = PARAMS[i.widget];
      if (schema) { const r = schema.safeParse(i.params ?? {}); if (!r.success) problems.push({ field: `layout.${n}.params`, message: r.error.issues[0].message }); } else if (i.params && Object.keys(i.params).length) problems.push({ field: `layout.${n}.params`, message: `${i.widget} takes no settings` });
    });
    if (problems.length) throw badRequest('Some fields are invalid.', problems);
  }

  /** Save the person's own copy (a person's layout is theirs to change, so there is no approval). */
  function savePersonal(actor, dash, body) {
    const sys = systemRow(dash);
    if (!sys) throw notFound(`There is no dashboard called ${dash}.`);
    mustSee(actor, sys);
    checkLayout(body.layout);
    const allowed = new Set(catalogue(actor).map((w) => w.code));
    const denied = body.layout.find((i) => !allowed.has(i.widget));
    if (denied) throw forbidden(`Your role may not use the widget ${denied.widget}.`);
    return transaction(db, () => {
      const existing = ownRow(actor, dash, 'user', actor.user);
      const at = new Date().toISOString();
      if (existing) {
        if (body.version !== undefined && body.version !== existing.version) throw conflict('Your dashboard was changed on another device. Reload it and make the change again.');
        db.prepare('UPDATE ui_dashboards SET layout_json = ?, filters_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(body.layout), JSON.stringify(body.filters), actor.user, at, existing.id);
        writeAudit(db, { entity: 'ui_dashboards', entityId: existing.id, action: 'update', oldValues: { widgets: jsonOf(existing.layout_json, []).map((i) => i.widget) }, newValues: { widgets: body.layout.map((i) => i.widget) }, actor: actor.user, companyId: cid(actor) });
      } else {
        const id = Number(db.prepare("INSERT INTO ui_dashboards (company_id, code, name, owner_type, owner_ref, permission_key, layout_json, filters_json, created_by, source_type) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, 'dashboard_copy')")
          .run(cid(actor), dash, sys.name, actor.user, sys.permission_key, JSON.stringify(body.layout), JSON.stringify(body.filters), actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'ui_dashboards', entityId: id, action: 'create', newValues: { code: dash, widgets: body.layout.map((i) => i.widget) }, actor: actor.user, companyId: cid(actor) });
      }
      return resolve(actor, dash);
    });
  }

  /** Give the person's own copy up, so they see the default of their role again. */
  function resetPersonal(actor, dash) {
    return transaction(db, () => {
      const existing = ownRow(actor, dash, 'user', actor.user);
      if (!existing) throw notFound('You have no copy of your own to reset.');
      db.prepare('DELETE FROM ui_dashboards WHERE id = ?').run(existing.id);
      writeAudit(db, { entity: 'ui_dashboards', entityId: existing.id, action: 'reset', oldValues: { widgets: jsonOf(existing.layout_json, []).map((i) => i.widget) }, actor: actor.user, companyId: cid(actor) });
      return resolve(actor, dash);
    });
  }

  // ---- role defaults (maker-checker) ----
  const mustManage = (actor) => {
    if (!hasPermission(actor, 'ui.dashboard.manage')) throw forbidden('Your role does not include ui.dashboard.manage. Ask a system administrator.');
  };

  /** The system layout, the default of each role that has one, and the requests waiting for approval, for the designer. */
  function roleDefaults(actor, dash) {
    mustManage(actor);
    const sys = systemRow(dash);
    if (!sys) throw notFound(`There is no dashboard called ${dash}.`);
    const roles = db.prepare("SELECT * FROM ui_dashboards WHERE company_id = ? AND code = ? AND owner_type = 'role' AND deleted_at IS NULL ORDER BY owner_ref").all(cid(actor), dash)
      .map((r) => ({ role: r.owner_ref, name: r.name, layout: withMeta(jsonOf(r.layout_json, [])), filters: jsonOf(r.filters_json, {}), version: r.version, updatedBy: r.updated_by ?? r.created_by, updatedAt: r.updated_at ?? r.created_at }));
    const pending = approvals.list(actor, { type: APPROVAL_TYPE, status: 'SUBMITTED', limit: 100, offset: 0 }).rows.filter((r) => r.payload?.code === dash)
      .map((r) => ({ id: r.id, role: r.payload.role, remove: Boolean(r.payload.remove), widgets: r.payload.layout?.length ?? 0, requestedBy: r.requestedBy, requestedAt: r.requestedAt, reason: r.reason }));
    const roleCodes = db.prepare('SELECT code, name FROM iam_roles WHERE company_id IS NULL ORDER BY code').all();
    return { code: dash, name: sys.name, system: { layout: withMeta(jsonOf(sys.layout_json, [])), filters: jsonOf(sys.filters_json, {}) }, roles, pending, roleCodes, catalogue: catalogue(actor) };
  }

  /** Ask for the default of a role to be set, changed or removed; another system administrator approves it. */
  function proposeRoleDefault(actor, dash, body) {
    mustManage(actor);
    const sys = systemRow(dash);
    if (!sys) throw notFound(`There is no dashboard called ${dash}.`);
    if (!db.prepare('SELECT 1 FROM iam_roles WHERE company_id IS NULL AND code = ?').get(body.role)) throw badRequest('Some fields are invalid.', [{ field: 'role', message: `${body.role} is not a role of this application` }]);
    const existing = ownRow(actor, dash, 'role', body.role);
    if (body.remove) {
      if (!existing) throw unprocessable(`${body.role} has no default of its own for ${dash}, so there is nothing to remove.`);
    } else {
      checkLayout(body.layout);
      const same = existing && JSON.stringify(jsonOf(existing.layout_json, [])) === JSON.stringify(body.layout) && JSON.stringify(jsonOf(existing.filters_json, {})) === JSON.stringify(body.filters) && (body.name ?? existing.name) === existing.name;
      if (same) throw unprocessable('Nothing is different from the current default, so there is nothing to approve.');
    }
    const open = db.prepare("SELECT payload_json FROM core_change_requests WHERE company_id = ? AND type = ? AND status = 'SUBMITTED' AND is_active = 1").all(cid(actor), APPROVAL_TYPE)
      .some((r) => { const p = jsonOf(r.payload_json, {}); return p.code === dash && p.role === body.role; });
    if (open) throw conflict(`A change to the default of ${body.role} for ${dash} is already waiting for approval.`);
    return approvals.submit(actor, {
      type: APPROVAL_TYPE, title: `${body.remove ? 'Remove' : 'Set'} the default of ${body.role} for ${sys.name}`, targetType: 'dashboard', targetId: sys.id,
      payload: { code: dash, role: body.role, name: body.name, layout: body.layout, filters: body.filters, remove: Boolean(body.remove), baseVersion: existing?.version ?? 0 }, reason: body.reason, chain: DASHBOARD_CHAIN,
    });
  }

  /** The audited changes of a role's default of one dashboard, newest first. */
  function history(actor, dash, role) {
    mustManage(actor);
    const row = ownRow(actor, dash, 'role', role);
    if (!row) return [];
    return db.prepare("SELECT id, action, old_values, new_values, reason, actor, created_at FROM core_audit_log WHERE entity = 'ui_dashboards' AND entity_id = ? ORDER BY id DESC LIMIT 100").all(String(row.id))
      .map((a) => ({ id: a.id, action: a.action, oldValues: a.old_values ? JSON.parse(a.old_values) : null, newValues: a.new_values ? JSON.parse(a.new_values) : null, reason: a.reason, actor: a.actor, at: a.created_at }));
  }

  return { catalogue, data, list, resolve, savePersonal, resetPersonal, roleDefaults, proposeRoleDefault, history };
}
