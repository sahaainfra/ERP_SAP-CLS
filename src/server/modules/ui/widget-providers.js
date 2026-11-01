import { authzOf } from '../../platform/authz/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { widgetRegistry, workSources } from '../../platform/widgets/index.js';
import { rupees } from './lists.js';
import { APPROVAL_TYPE } from './sample-request-object.js';

// Part 03.07: the data of the widgets of this module and of the core and organisation figures it shows. Every provider reads the same tables
// as the list behind the widget, inside the same permission and data scope (BR-01), and returns what the framework draws; a result with
// nothing in it is an empty state, never a placeholder (BR-02). `ctx` is { db, actor, filters, params, approvals, shell, slaHours, targets }.
const PERMISSION = 'core.sample.use';
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** The period just before another of the same length (for the change a KPI shows). */
export function previousPeriod({ from, to }) {
  const length = daysBetween(from, to) + 1;
  const end = addDays(from, -1);
  return { from: addDays(end, -(length - 1)), to: end };
}

/** The percentage change from `previous` to `value`, one decimal, or null when there is nothing to compare with. */
export const trendPct = (value, previous) => (previous > 0 ? Math.round(((value - previous) / previous) * 1000) / 10 : null);

/**
 * The address of the list of requests a point of a widget opens: the same filters, so the list shows the same rows and the same count (T-02).
 * @param {{ status?: string | string[], priority?: string, projectCode?: string, siteCode?: string, from?: string, to?: string, mine?: boolean, user?: string }} filter
 */
export function requestsDrill({ status, priority, projectCode, siteCode, from, to, mine, user }) {
  const q = new URLSearchParams();
  if (status) q.set(Array.isArray(status) ? 'filter[status][in]' : 'filter[status]', [status].flat().join(','));
  if (priority) q.set('filter[priority]', priority);
  if (projectCode) q.set('filter[projectCode]', projectCode);
  if (siteCode) q.set('filter[siteCode]', siteCode);
  if (from && to) q.set('filter[docDate][between]', `${from},${to}`);
  if (mine && user) q.set('filter[requestedBy]', user);
  const s = q.toString();
  return `/admin/sample-requests${s ? `?${s}` : ''}`;
}

function requestScope(ctx, { alias = 'r', period = ctx.filters, extra = '', bind = {} } = {}) {
  const { db, actor, filters } = ctx;
  const sql = [
    `${alias}.company_id = :c`, `${alias}.deleted_at IS NULL`,
    authzOf(db).scopeFilter(actor, PERMISSION, { project: `${alias}.project_id`, site: `${alias}.site_id` }).sql,
    `${alias}.doc_date BETWEEN :from AND :to`,
  ];
  /** @type {Record<string, any>} */
  const params = { c: actor.companyId, from: period.from, to: period.to, ...bind };
  if (filters.projectId) { sql.push(`${alias}.project_id = :project`); params.project = filters.projectId; }
  if (filters.siteId) { sql.push(`${alias}.site_id = :site`); params.site = filters.siteId; }
  if (extra) sql.push(extra);
  return { where: sql.join(' AND '), params };
}
const count = (ctx, extra, period, bind) => {
  const s = requestScope(ctx, { extra, period, bind });
  return ctx.db.prepare(`SELECT COUNT(*) AS n FROM ui_sample_requests r WHERE ${s.where}`).get(s.params).n;
};
const names = (ctx) => ({
  projectCode: ctx.filters.projectId ? ctx.db.prepare('SELECT code FROM org_projects WHERE id = ?').get(ctx.filters.projectId)?.code : undefined,
  siteCode: ctx.filters.siteId ? ctx.db.prepare('SELECT code FROM org_sites WHERE id = ?').get(ctx.filters.siteId)?.code : undefined,
});
const baseDrill = (ctx) => ({ ...names(ctx), from: ctx.filters.from, to: ctx.filters.to });
const totalVisible = (ctx) => authzOf(ctx.db).maskRule(ctx.actor, 'ui_sample_request', 'total') === 'show';
const STATUS_LABEL = { DRAFT: 'Draft', SUBMITTED: 'Submitted', CANCELLED: 'Cancelled' };
const kpi = (value, extra = {}) => ({ value, unit: '', previous: null, trendPct: null, target: null, status: 'neutral', ...extra });

const slaDue = (createdAt, hours) => new Date(Date.parse(createdAt) + hours * 3_600_000).toISOString();

export function registerWidgetProviders() {
  const reg = (code, provider) => widgetRegistry.register({ code, provider });

  // ---- what waits for the person ----
  reg('approvals.waiting', (ctx) => {
    const items = ctx.approvals.awaiting(ctx.actor);
    const overdue = items.some((i) => Date.now() > Date.parse(slaDue(i.createdAt, ctx.slaHours)));
    return kpi(items.length, { unit: items.length === 1 ? 'request' : 'requests', status: items.length === 0 ? 'green' : overdue ? 'red' : 'amber', note: overdue ? 'One or more are past their time.' : null, drill: '/admin/approvals' });
  });
  reg('approvals.list', (ctx) => ({
    rows: ctx.approvals.awaiting(ctx.actor).slice(0, 10).map((i) => {
      const due = slaDue(i.createdAt, ctx.slaHours);
      return { id: i.id, title: i.title, subtitle: `Raised by ${i.requestedBy}`, due, overdue: Date.now() > Date.parse(due), drill: i.targetType === 'sample_request' ? `/admin/sample-requests?open=${i.targetId}` : '/admin/approvals' };
    }),
    total: ctx.approvals.awaiting(ctx.actor).length, drill: '/admin/approvals',
  }));
  reg('tasks.mine', (ctx) => {
    const rows = workSources.list(ctx.db, ctx.actor, 'task').slice(0, 10);
    return { rows: rows.map((t) => ({ id: t.id, title: t.title, subtitle: t.source, due: t.due ?? null, overdue: t.due ? Date.parse(t.due) < Date.now() : false, drill: t.route ?? null })), total: rows.length, drill: null };
  });
  reg('drafts.mine', (ctx) => {
    const n = ctx.db.prepare('SELECT COUNT(*) AS n FROM ui_drafts WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL AND is_active = 1').get(ctx.actor.companyId, ctx.actor.user).n;
    return kpi(n, { unit: n === 1 ? 'draft' : 'drafts', status: n > 0 ? 'amber' : 'green', drill: '/account/drafts' });
  });
  reg('mentions.mine', (ctx) => {
    const rows = ctx.db.prepare(`SELECT id, entity_type, entity_id, body, author_ref, created_at FROM ui_record_comments WHERE company_id = ? AND deleted_at IS NULL AND author_ref != ? AND mentions_json LIKE ? ORDER BY id DESC LIMIT 40`)
      .all(ctx.actor.companyId, ctx.actor.user, `%"username":"${ctx.actor.user.replace(/[%_"\\]/g, '')}"%`);
    const seen = rows.filter((r) => objectTypes.get(r.entity_type)?.access(ctx.db, ctx.actor, r.entity_id)).slice(0, 8);
    return { rows: seen.map((r) => ({ id: r.id, title: r.body.length > 90 ? `${r.body.slice(0, 90)}...` : r.body, subtitle: `${r.author_ref}, ${r.created_at.slice(0, 16).replace('T', ' ')}`, drill: objectTypes.get(r.entity_type).route?.(r.entity_id) ?? null })), total: seen.length, drill: null };
  });

  // ---- the register of sample material requests ----
  reg('requests.submitted', (ctx) => {
    const value = count(ctx, "r.status = 'SUBMITTED'");
    const previous = count(ctx, "r.status = 'SUBMITTED'", previousPeriod(ctx.filters));
    return kpi(value, { unit: value === 1 ? 'request' : 'requests', previous, trendPct: trendPct(value, previous), drill: requestsDrill({ status: 'SUBMITTED', ...baseDrill(ctx) }) });
  });
  reg('requests.mine_open', (ctx) => {
    const value = count(ctx, "r.status IN ('DRAFT', 'SUBMITTED') AND r.requested_by = :me", undefined, { me: ctx.actor.user });
    return kpi(value, { unit: value === 1 ? 'request' : 'requests', drill: requestsDrill({ status: ['DRAFT', 'SUBMITTED'], mine: true, user: ctx.actor.user, ...baseDrill(ctx) }) });
  });
  reg('requests.value', (ctx) => {
    if (!totalVisible(ctx)) return { masked: true };
    const sum = (period) => { const s = requestScope(ctx, { extra: "r.status = 'SUBMITTED'", period }); return ctx.db.prepare(`SELECT COALESCE(SUM(r.total_amount), 0) AS v FROM ui_sample_requests r WHERE ${s.where}`).get(s.params).v; };
    const value = sum(ctx.filters);
    const previous = sum(previousPeriod(ctx.filters));
    return kpi(rupees(value), { kind: 'money', unit: '₹', previous: rupees(previous), trendPct: trendPct(value, previous), drill: requestsDrill({ status: 'SUBMITTED', ...baseDrill(ctx) }) });
  });
  reg('requests.by_status', (ctx) => {
    const s = requestScope(ctx);
    const rows = ctx.db.prepare(`SELECT r.status AS status, COUNT(*) AS n FROM ui_sample_requests r WHERE ${s.where} GROUP BY r.status ORDER BY n DESC`).all(s.params);
    return { slices: rows.map((r) => ({ label: STATUS_LABEL[r.status] ?? r.status, value: r.n, drill: requestsDrill({ status: r.status, ...baseDrill(ctx) }) })), total: rows.reduce((a, r) => a + r.n, 0), unit: 'requests' };
  });
  reg('requests.by_project', (ctx) => {
    const s = requestScope(ctx);
    const rows = ctx.db.prepare(`SELECT p.code AS code, p.name AS name, COUNT(*) AS n FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id WHERE ${s.where} GROUP BY p.id ORDER BY n DESC, p.code LIMIT 10`).all(s.params);
    return { categories: rows.map((r) => r.code), series: [{ name: 'Requests', values: rows.map((r) => r.n), drill: rows.map((r) => requestsDrill({ projectCode: r.code, from: ctx.filters.from, to: ctx.filters.to })) }], unit: 'requests', titles: rows.map((r) => r.name) };
  });
  const buckets = (ctx) => {
    const days = daysBetween(ctx.filters.from, ctx.filters.to) + 1;
    return days <= 35 ? { sql: "strftime('%Y-%m-%d', r.doc_date)", label: 'day' } : days <= 200 ? { sql: "strftime('%Y-W%W', r.doc_date)", label: 'week' } : { sql: "strftime('%Y-%m', r.doc_date)", label: 'month' };
  };
  reg('requests.trend', (ctx) => {
    const b = buckets(ctx);
    const s = requestScope(ctx);
    const rows = ctx.db.prepare(`SELECT ${b.sql} AS k, COUNT(*) AS n, SUM(CASE WHEN r.status = 'SUBMITTED' THEN 1 ELSE 0 END) AS sub FROM ui_sample_requests r WHERE ${s.where} GROUP BY k ORDER BY k`).all(s.params);
    return { categories: rows.map((r) => r.k), series: [{ name: 'Raised', values: rows.map((r) => r.n) }, { name: 'Submitted', values: rows.map((r) => r.sub) }], unit: 'requests', granularity: b.label, drill: requestsDrill(baseDrill(ctx)) };
  });
  reg('requests.scurve', (ctx) => {
    const s = requestScope(ctx);
    const rows = ctx.db.prepare(`SELECT strftime('%Y-%m', r.doc_date) AS k, COUNT(*) AS n FROM ui_sample_requests r WHERE ${s.where} GROUP BY k ORDER BY k`).all(s.params);
    let run = 0;
    return { categories: rows.map((r) => r.k), series: [{ name: 'Requests raised to date', values: rows.map((r) => { run += r.n; return run; }) }], unit: 'requests', drill: requestsDrill(baseDrill(ctx)) };
  });
  reg('requests.by_priority', (ctx) => {
    const s = requestScope(ctx);
    const rows = ctx.db.prepare(`SELECT p.code AS code, r.priority AS priority, COUNT(*) AS n FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id WHERE ${s.where} GROUP BY p.id, r.priority ORDER BY p.code`).all(s.params);
    const codes = [...new Set(rows.map((r) => r.code))].slice(0, 10);
    const series = ['NORMAL', 'URGENT'].map((pr) => ({ name: pr === 'URGENT' ? 'Urgent' : 'Normal', values: codes.map((c) => rows.find((r) => r.code === c && r.priority === pr)?.n ?? 0), drill: codes.map((c) => requestsDrill({ projectCode: c, priority: pr, from: ctx.filters.from, to: ctx.filters.to })) }));
    return { categories: codes, series, unit: 'requests' };
  });
  reg('requests.heatmap', (ctx) => {
    const s = requestScope(ctx);
    const rows = ctx.db.prepare(`SELECT p.code AS code, r.status AS status, COUNT(*) AS n FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id WHERE ${s.where} GROUP BY p.id, r.status`).all(s.params);
    const rowsOf = [...new Set(rows.map((r) => r.code))].sort().slice(0, 12);
    const cols = ['DRAFT', 'SUBMITTED', 'CANCELLED'];
    return { rows: rowsOf, cols: cols.map((c) => STATUS_LABEL[c]), cells: rowsOf.flatMap((code, ri) => cols.map((st, ci) => ({ row: ri, col: ci, value: rows.find((r) => r.code === code && r.status === st)?.n ?? 0, drill: requestsDrill({ projectCode: code, status: st, from: ctx.filters.from, to: ctx.filters.to }) }))), unit: 'requests' };
  });
  reg('requests.gantt', (ctx) => {
    const s = requestScope(ctx, { extra: "r.status IN ('DRAFT', 'SUBMITTED') AND r.required_by IS NOT NULL" });
    const rows = ctx.db.prepare(`SELECT r.id, r.doc_no, r.title, r.doc_date, r.required_by, r.status FROM ui_sample_requests r WHERE ${s.where} ORDER BY r.required_by, r.id LIMIT 8`).all(s.params);
    return { rows: rows.map((r) => ({ label: r.doc_no ?? r.title, start: r.doc_date, end: r.required_by < r.doc_date ? r.doc_date : r.required_by, status: STATUS_LABEL[r.status], drill: `/admin/sample-requests?open=${r.id}` })) };
  });
  reg('requests.top', (ctx) => {
    const visible = totalVisible(ctx);
    const s = requestScope(ctx, { extra: "r.status != 'CANCELLED'" });
    const limit = Math.min(Math.max(Number(ctx.params.limit) || 5, 3), 20);
    // roles that may not see values get the requests needed soonest, never an order that would give the values away
    const rows = ctx.db.prepare(`SELECT r.id, r.doc_no, r.title, r.total_amount, r.required_by, p.code AS project FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id WHERE ${s.where} ORDER BY ${visible ? 'r.total_amount DESC' : 'COALESCE(r.required_by, r.doc_date)'}, r.id DESC LIMIT ${limit}`).all(s.params);
    return { columns: [{ key: 'docNo', label: 'Number' }, { key: 'title', label: 'Title' }, { key: 'project', label: 'Project' }, { key: 'value', label: 'Value (₹)', align: 'end' }], rows: rows.map((r) => ({ docNo: r.doc_no ?? 'Draft', title: r.title, project: r.project, value: visible ? rupees(r.total_amount) : '•••', drill: `/admin/sample-requests?open=${r.id}` })), masked: !visible, drill: requestsDrill(baseDrill(ctx)) };
  });
  reg('requests.overdue', (ctx) => {
    const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
    const s = requestScope(ctx, { extra: "r.status IN ('DRAFT', 'SUBMITTED') AND r.required_by IS NOT NULL AND r.required_by < :today", bind: { today } });
    const rows = ctx.db.prepare(`SELECT r.id, r.doc_no, r.title, r.required_by, r.status, p.code AS project FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id WHERE ${s.where} ORDER BY r.required_by, r.id LIMIT 10`).all(s.params);
    return { rows: rows.map((r) => ({ id: r.id, title: `${r.doc_no ?? 'Draft'}: ${r.title}`, subtitle: `${r.project}, needed by ${r.required_by}, ${STATUS_LABEL[r.status].toLowerCase()}`, days: daysBetween(r.required_by, today), drill: `/admin/sample-requests?open=${r.id}` })), total: rows.length };
  });
  reg('approvals.timeliness', (ctx) => {
    const rows = ctx.db.prepare(`SELECT cr.id, cr.created_at, cr.chain_json, (SELECT MAX(s.decided_at) FROM core_change_request_steps s WHERE s.request_id = cr.id) AS decided FROM core_change_requests cr WHERE cr.company_id = ? AND cr.type = ? AND cr.status IN ('APPROVED', 'REJECTED', 'RETURNED') AND substr(cr.created_at, 1, 10) BETWEEN ? AND ?`)
      .all(ctx.actor.companyId, APPROVAL_TYPE, ctx.filters.from, ctx.filters.to).filter((r) => r.decided);
    if (rows.length === 0) return { value: null, target: ctx.targets.timeliness, unit: '%' };
    const inTime = rows.filter((r) => Date.parse(r.decided) - Date.parse(r.created_at) <= ctx.slaHours * 3_600_000 * JSON.parse(r.chain_json).length).length;
    const value = Math.round((inTime / rows.length) * 1000) / 10;
    const t = ctx.targets.timeliness;
    return { value, min: 0, max: 100, target: t, unit: '%', status: value >= t ? 'green' : value >= t - 10 ? 'amber' : 'red', decided: rows.length, drill: '/admin/approvals' };
  });

  // ---- organisation ----
  reg('projects.mine', (ctx) => {
    const authz = authzOf(ctx.db);
    const scope = authz.scopeFilter(ctx.actor, 'org.view', { project: 't.id' }).sql;
    const rows = ctx.db.prepare(`SELECT t.id, t.code, t.name, t.status, (SELECT COUNT(*) FROM org_sites s WHERE s.org_project_id = t.id AND s.is_active = 1) AS sites FROM org_projects t WHERE t.company_id = ? AND t.is_active = 1 AND t.status != 'CLOSED' AND ${scope} ORDER BY t.code LIMIT 12`).all(ctx.actor.companyId);
    const open = (id) => { try { return ctx.db.prepare("SELECT COUNT(*) AS n FROM ui_sample_requests WHERE company_id = ? AND project_id = ? AND status IN ('DRAFT', 'SUBMITTED') AND deleted_at IS NULL").get(ctx.actor.companyId, id).n; } catch { return 0; } };
    return { rows: rows.map((r) => ({ id: r.id, title: `${r.code} ${r.name}`, subtitle: `${r.sites} site${r.sites === 1 ? '' : 's'}, ${r.status.toLowerCase()}${authz.check(ctx.actor, PERMISSION, { companyId: ctx.actor.companyId, projectId: r.id }).allowed ? `, ${open(r.id)} open request${open(r.id) === 1 ? '' : 's'}` : ''}`, drill: `/admin/projects` })), total: rows.length, drill: '/admin/projects' };
  });
  reg('sites.map', (ctx) => {
    const scope = authzOf(ctx.db).scopeFilter(ctx.actor, 'org.view', { project: 's.org_project_id', site: 's.id' }).sql;
    const rows = ctx.db.prepare(`SELECT s.id, s.code, s.name, s.latitude, s.longitude, p.code AS project FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = :c AND s.is_active = 1 AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL AND ${scope}${ctx.filters.projectId ? ' AND s.org_project_id = :p' : ''} ORDER BY s.code LIMIT 200`).all({ c: ctx.actor.companyId, ...(ctx.filters.projectId ? { p: ctx.filters.projectId } : {}) });
    return { points: rows.map((r) => ({ id: r.id, label: r.code, title: `${r.code} ${r.name} (${r.project})`, lat: r.latitude, lng: r.longitude, drill: '/admin/projects' })) };
  });

  // ---- calendar, quick actions, notice ----
  reg('calendar.month', (ctx) => {
    const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 7);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(ctx.params.month ?? '') ? ctx.params.month : today;
    const first = `${month}-01`;
    const end = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()).padStart(2, '0')}`;
    const events = [];
    for (const h of ctx.db.prepare('SELECT holiday_date, name FROM core_holidays WHERE company_id = ? AND holiday_date BETWEEN ? AND ? AND is_active = 1 AND deleted_at IS NULL ORDER BY holiday_date').all(ctx.actor.companyId, first, end)) events.push({ date: h.holiday_date, kind: 'holiday', label: h.name, drill: null });
    try {
      const s = requestScope(ctx, { period: { from: '0000-01-01', to: '9999-12-31' }, extra: "r.status IN ('DRAFT', 'SUBMITTED') AND r.requested_by = :me AND r.required_by BETWEEN :first AND :end", bind: { me: ctx.actor.user, first, end } });
      for (const r of ctx.db.prepare(`SELECT r.id, r.doc_no, r.title, r.required_by FROM ui_sample_requests r WHERE ${s.where} ORDER BY r.required_by`).all(s.params)) events.push({ date: r.required_by, kind: 'needed', label: `${r.doc_no ?? 'Draft'} needed`, drill: `/admin/sample-requests?open=${r.id}` });
    } catch { /* a person without the right to use the register has none of these */ }
    for (const a of ctx.approvals.awaiting(ctx.actor)) {
      const due = slaDue(a.createdAt, ctx.slaHours).slice(0, 10);
      if (due >= first && due <= end) events.push({ date: due, kind: 'due', label: `Approval due: ${a.title}`, drill: a.targetType === 'sample_request' ? `/admin/sample-requests?open=${a.targetId}` : '/admin/approvals' });
    }
    return { month, today: new Date(Date.now() + 19_800_000).toISOString().slice(0, 10), events: events.sort((x, y) => x.date.localeCompare(y.date)) };
  });
  reg('actions.quick', (ctx) => {
    const nav = ctx.shell.navigation(ctx.actor);
    const create = nav.quickCreate.map((q) => ({ label: q.label, route: q.route, icon: q.icon }));
    const field = nav.groups.flatMap((g) => g.pages).filter((p) => p.field).sort((a, b) => a.field.order - b.field.order).map((p) => ({ label: p.field.label, route: p.route, icon: p.icon }));
    return { actions: [...create, ...field].slice(0, 8) };
  });
  reg('notice.text', (ctx) => ({ text: String(ctx.params.text ?? '').slice(0, 1000), title: String(ctx.params.title ?? '').slice(0, 80) }));
}
