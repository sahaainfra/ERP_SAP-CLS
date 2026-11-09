import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { forbidden, notFound } from '../../platform/http/errors.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { collabOf } from '../eng/collab.js';
import { gisOf } from './gis.js';
import { meetingsOf } from './meetings.js';
import { risksOf } from './risks.js';
import { HEALTH_DIMENSIONS, P360_TABS, P360_TAB_LABELS, RAG_DEFAULTS, STATES, json, money } from './constants.js';

// Project 360 and the project dashboard (part 10.08). One page that gathers what every module knows of a project, with the figures of the module that owns them and a drill-down to its list or record. A module puts a widget on a slot of the page by
// registering a provider (`registerProject360Widget`); a slot whose owner module is not live yet shows an empty state that names the part that will supply it, never a made-up number (FR-06). A person sees a live widget only when they hold the permission
// of its module (BR-02). The health of the project (time, cost, quality, safety, cash, risk) follows thresholds each company sets (BR-01); a dimension whose module is not live is "no data", not green.
if (!parameterRegistry.get('proj.rag_thresholds')) parameterRegistry.define({ key: 'proj.rag_thresholds', dataType: 'json', default: RAG_DEFAULTS, scopes: ['system', 'company'], description: 'BR-01: the health thresholds of Project 360: { milestoneLateDaysAmber, milestoneLateDaysRed, riskCriticalRed, riskHighAmber, spiAmber, spiRed, cpiAmber, cpiRed }.' });

/** @type {Map<string, (ctx: any) => any>} widget code -> provider returning { figures: [{ key, label, value, unit?, tone?, drill? }], rows?: [{ title, subtitle?, tone?, drill? }], note? } */
export const project360Providers = new Map();
/** A module that goes live registers the provider of its slot (the slot is a row of proj_360_widgets). */
export const registerProject360Widget = (code, provider) => { if (project360Providers.has(code)) throw new Error(`Project 360 widget ${code} is already registered`); project360Providers.set(code, provider); };

const services = new WeakMap();
export const bindP360 = (db, s) => services.set(db, s);
export const p360Of = (db) => services.get(db) ?? null;
const WORST = { RED: 3, AMBER: 2, GREEN: 1, NONE: 0 };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const fig = (key, label, value, extra = {}) => ({ key, label, value, ...extra });
const periodOf = (period) => {
  const p = period ?? todayIST().slice(0, 7); const [y, m] = p.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { period: p, from: `${p}-01`, to: `${p}-${String(last).padStart(2, '0')}` };
};

export function createP360Service({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const thresholdsOf = (companyId) => { const v = createParameterStore(db).get('proj.rag_thresholds', { companyId, date: todayIST() }); return { ...RAG_DEFAULTS, ...((typeof v === 'string' ? json(v, null) : v) ?? {}) }; };
  function project(actor, projectId) {
    const x = db.prepare('SELECT x.*, p.code, p.name, p.company_id AS org_company, p.type AS org_type FROM proj_projects x JOIN org_projects p ON p.id = x.project_id WHERE x.project_id = ? AND x.deleted_at IS NULL').get(Number(projectId));
    if (!x || x.org_company !== actor.companyId || !may(actor, 'proj.p360.view', x.project_id)) throw notFound('That project does not exist.');
    return x;
  }

  // ---- health (BR-01) -------------------------------------------------------------------------------------------------------------------------------
  function health(x, t) {
    const today = todayIST(); const items = [];
    const ms = db.prepare("SELECT planned_date FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL AND milestone_status = 'PLANNED' AND planned_date < ?").all(x.project_id, today);
    const total = db.prepare("SELECT COUNT(*) AS n FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL AND milestone_status <> 'WAIVED'").get(x.project_id).n;
    const worst = ms.reduce((m, r) => Math.max(m, daysBetween(r.planned_date, today)), 0);
    items.push({ code: 'TIME', level: !total ? 'NONE' : worst >= t.milestoneLateDaysRed ? 'RED' : worst >= t.milestoneLateDaysAmber ? 'AMBER' : 'GREEN', detail: !total ? 'No milestones are set.' : ms.length ? `${ms.length} planned milestone(s) overdue, the longest by ${worst} day(s).` : 'Every planned milestone is on time.' });
    const r = db.prepare("SELECT SUM(CASE WHEN level = 'CRITICAL' THEN 1 ELSE 0 END) AS crit, SUM(CASE WHEN level = 'HIGH' THEN 1 ELSE 0 END) AS high, COUNT(*) AS n, COALESCE(SUM(emv), 0) AS emv, COALESCE(SUM(contingency_allocated), 0) AS alloc FROM proj_risks WHERE org_project_id = ? AND rtype = 'RISK' AND status IN ('OPEN', 'CLOSE_REQUESTED') AND deleted_at IS NULL").get(x.project_id);
    items.push({ code: 'RISK', level: !r.n ? 'NONE' : r.crit >= t.riskCriticalRed ? 'RED' : r.high >= t.riskHighAmber || r.emv > r.alloc ? 'AMBER' : 'GREEN', detail: !r.n ? 'No open risks are registered.' : `${r.crit} critical and ${r.high} high of ${r.n} open risk(s).` });
    for (const code of ['COST', 'QUALITY', 'SAFETY', 'CASH']) items.push({ code, level: 'NONE', detail: `No data yet: this comes from part ${HEALTH_DIMENSIONS[code][2]}.` });
    const level = items.reduce((w, h) => (WORST[h.level] > WORST[w] ? h.level : w), 'NONE');
    return { level, items: items.map((i) => ({ ...i, label: HEALTH_DIMENSIONS[i.code][0], ownerPart: HEALTH_DIMENSIONS[i.code][2] })) };
  }

  // ---- the live widgets of the parts that exist --------------------------------------------------------------------------------------------------------
  // the widgets of the parts that exist belong to this service (they read its database); a later module registers its own in the shared registry above
  const builtins = new Map(); const builtin = (code, fn) => builtins.set(code, fn);
  const drill = (tpl, ctx) => (tpl ? tpl.replace('{projectId}', String(ctx.project.project_id)) : null);
  const T = { good: 'green', warn: 'amber', bad: 'red' };
  builtin('milestones', (ctx) => {
    const id = ctx.project.project_id; const today = todayIST();
    const c = (w, ...a) => db.prepare(`SELECT COUNT(*) AS n FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL AND ${w}`).get(id, ...a).n;
    const overdue = c("milestone_status = 'PLANNED' AND planned_date < ?", today);
    return { figures: [fig('total', 'Milestones', c("milestone_status <> 'WAIVED'")), fig('achieved', 'Achieved', c("milestone_status = 'ACHIEVED'")), fig('overdue', 'Overdue', overdue, { tone: overdue ? T.bad : T.good, drill: drill('/proj/project?id={projectId}', ctx) }),
      fig('due', `Due in ${ctx.period.period}`, c("milestone_status = 'PLANNED' AND planned_date BETWEEN ? AND ?", ctx.period.from, ctx.period.to))],
    rows: db.prepare("SELECT name, planned_date, milestone_status FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL AND milestone_status = 'PLANNED' ORDER BY planned_date LIMIT 5").all(id).map((m) => ({ title: m.name, subtitle: `Planned ${m.planned_date}`, tone: m.planned_date < today ? T.bad : null })) };
  });
  builtin('risks', (ctx) => {
    const d = risksOf(db).dashboard.get(ctx.actor, ctx.project.project_id);
    return { figures: [fig('open', 'Open risks', d.counts.risks, { drill: `/proj/risks?filter[projectId]=${ctx.project.project_id}&filter[type]=RISK&filter[status]=OPEN` }), fig('critical', 'Critical', d.counts.critical, { tone: d.counts.critical ? T.bad : T.good, drill: `/proj/risks?filter[projectId]=${ctx.project.project_id}&filter[level]=CRITICAL&filter[status]=OPEN` }),
      fig('high', 'High', d.counts.high, { tone: d.counts.high ? T.warn : T.good }), fig('opportunities', 'Open opportunities', d.counts.opportunities), fig('emv', 'Risk EMV (₹)', d.riskEmv, { format: 'money', drill: `/proj/risk-dashboard?projectId=${ctx.project.project_id}` }), fig('oppEmv', 'Opportunity EMV (₹)', d.opportunityEmv, { format: 'money' }),
      fig('contingency', 'Contingency left (₹)', d.contingency.left, { format: 'money' })],
    rows: d.top.slice(0, 5).map((r) => ({ title: `${r.docNo} ${r.title}`, subtitle: `${r.level} · score ${r.score} · ${r.owner}`, tone: r.level === 'CRITICAL' ? T.bad : r.level === 'HIGH' ? T.warn : null, drill: `/proj/risk?id=${r.id}` })) };
  });
  builtin('issues', (ctx) => {
    const d = risksOf(db).dashboard.get(ctx.actor, ctx.project.project_id);
    const raised = db.prepare('SELECT COUNT(*) AS n FROM proj_risk_issues WHERE org_project_id = ? AND deleted_at IS NULL AND substr(created_at, 1, 10) BETWEEN ? AND ?').get(ctx.project.project_id, ctx.period.from, ctx.period.to).n;
    return { figures: [fig('open', 'Open issues', d.counts.issues, { drill: `/proj/issues?filter[projectId]=${ctx.project.project_id}&filter[status]=OPEN` }), fig('overdue', 'Overdue', d.counts.issuesOverdue, { tone: d.counts.issuesOverdue ? T.bad : T.good, drill: `/proj/issues?filter[projectId]=${ctx.project.project_id}&filter[overdue]=1` }), fig('raised', `Raised in ${ctx.period.period}`, raised)],
      rows: db.prepare("SELECT id, doc_no, title, priority, owner_user FROM proj_risk_issues WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS') ORDER BY CASE priority WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC, id LIMIT 5").all(ctx.project.project_id).map((i) => ({ title: `${i.doc_no} ${i.title}`, subtitle: `${i.priority} · ${i.owner_user}`, tone: ['CRITICAL', 'HIGH'].includes(i.priority) ? T.bad : null, drill: `/proj/issue?id=${i.id}` })) };
  });
  builtin('map', (ctx) => {
    const m = gisOf(db).map.get(ctx.actor, ctx.project.project_id); const h = gisOf(db).heatmap(ctx.actor, ctx.project.project_id);
    const withP = h.locations.filter((l) => l.pct != null); const avg = withP.length ? Math.round(withP.reduce((n, l) => n + l.pct, 0) / withP.length * 100) / 100 : null;
    return { figures: [fig('located', 'Locations on the map', m.summary.located, { drill: `/proj/map?projectId=${ctx.project.project_id}` }), fig('locations', 'Locations', m.summary.locations), fig('layers', 'Layers and overlays', m.summary.layers + m.summary.overlays), fig('progress', 'Average progress of located work (%)', avg, { drill: `/proj/strip-chart?projectId=${ctx.project.project_id}` })],
      note: avg == null ? 'No progress has been recorded for the locations yet.' : null };
  });
  builtin('wbs', (ctx) => {
    const id = ctx.project.project_id; const nodes = db.prepare('SELECT COUNT(*) AS n FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL').get(id).n;
    const v = db.prepare("SELECT version_no FROM proj_wbs_versions WHERE project_id = ? AND version_status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(id);
    return { figures: [fig('nodes', 'WBS nodes', nodes, { drill: `/proj/wbs?projectId=${id}` }), fig('baseline', 'Baselined version', v ? `v${v.version_no}` : 'Not baselined', { tone: v ? T.good : T.warn }),
      fig('packages', 'Work packages', db.prepare('SELECT COUNT(*) AS n FROM proj_work_packages WHERE project_id = ? AND deleted_at IS NULL').get(id).n, { drill: `/proj/work-packages?projectId=${id}` })] };
  });
  builtin('boq', (ctx) => {
    const id = ctx.project.project_id; const v = db.prepare("SELECT version_no, total_amount FROM proj_boq_versions WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(id);
    return { figures: [fig('versions', 'Frozen BOQ versions', db.prepare("SELECT COUNT(*) AS n FROM proj_boq_versions WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(id).n, { drill: `/proj/versions?projectId=${id}` }), fig('latest', 'Latest frozen version', v ? `v${v.version_no}` : 'None'), fig('amount', 'Latest frozen BOQ value (₹)', v ? money(v.total_amount) : null, { format: 'money' })] };
  });
  builtin('team', (ctx) => {
    const id = ctx.project.project_id; const today = todayIST();
    return { figures: [fig('members', 'Team members', db.prepare("SELECT COUNT(*) AS n FROM proj_team WHERE org_project_id = ? AND deleted_at IS NULL AND team_status = 'APPROVED' AND (to_date IS NULL OR to_date >= ?)").get(id, today).n, { drill: `/proj/team?projectId=${id}` }),
      fig('waiting', 'Requests waiting', db.prepare("SELECT COUNT(*) AS n FROM proj_team WHERE org_project_id = ? AND deleted_at IS NULL AND team_status = 'REQUESTED'").get(id).n),
      fig('stakeholders', 'Stakeholders', db.prepare('SELECT COUNT(*) AS n FROM proj_stakeholders WHERE org_project_id = ? AND deleted_at IS NULL').get(id).n, { drill: `/proj/stakeholders?projectId=${id}` }),
      fig('meetings', `Minutes issued in ${ctx.period.period}`, db.prepare("SELECT COUNT(*) AS n FROM proj_meetings WHERE org_project_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND meeting_date BETWEEN ? AND ?").get(id, ctx.period.from, ctx.period.to).n, { drill: '/proj/meetings' })] };
  });
  builtin('actions', (ctx) => {
    const s = meetingsOf(db).actions.summary(ctx.actor, { projectId: ctx.project.project_id });
    return { figures: [fig('open', 'Open actions', (s.open ?? 0) + (s.inProgress ?? 0) + (s.blocked ?? 0), { drill: '/proj/action-tracker' }), fig('overdue', 'Overdue', s.overdue ?? 0, { tone: s.overdue ? T.bad : T.good }), fig('done', 'Done', s.done ?? 0)] };
  });
  builtin('baseline', (ctx) => {
    const id = ctx.project.project_id; const p = db.prepare("SELECT pack_no, status, signed_off_at, contract_value FROM proj_baseline_packs WHERE project_id = ? AND deleted_at IS NULL ORDER BY pack_no DESC, id DESC LIMIT 1").get(id);
    return { figures: [fig('status', 'Latest baseline pack', p ? (p.status === 'APPROVED' ? 'Signed off' : p.status.toLowerCase()) : 'None', { tone: p?.status === 'APPROVED' ? T.good : T.warn, drill: `/proj/baseline-packs?projectId=${id}` }), fig('signed', 'Signed off on', p?.signed_off_at ? p.signed_off_at.slice(0, 10) : null),
      fig('value', 'Contract value of the pack (₹)', p ? money(p.contract_value) : null, { format: 'money' })] };
  });
  builtin('activity', (ctx) => {
    const c = collabOf(db); if (!c) return { figures: [], rows: [], note: 'The activity feed is not running.' };
    const r = c.timeline.project(ctx.actor, { projectId: ctx.project.project_id, limit: 8, offset: 0 });
    return { figures: [fig('events', 'Events in the feed', r.total, { drill: `/projects/activity?projectId=${ctx.project.project_id}` })], rows: (r.rows ?? []).map((e) => ({ title: `${e.actor ?? ''} ${e.action ?? ''}: ${e.summary ?? ''}`.trim().slice(0, 140), subtitle: String(e.at ?? '').slice(0, 16).replace('T', ' '), drill: e.record?.route ?? null })) };
  });

  // ---- the page -------------------------------------------------------------------------------------------------------------------------------------
  function header(actor, x, t) {
    const client = x.client_partner_id ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ? AND company_id = ?').get(x.client_partner_id, x.company_id) : null;
    const showMoney = may(actor, 'proj.boq.rates', x.project_id);
    const pack = db.prepare("SELECT contract_value FROM proj_baseline_packs WHERE project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY pack_no, id LIMIT 1").get(x.project_id);
    const h = health(x, t);
    return { projectId: x.project_id, id: x.id, code: x.code, name: x.name, client: client?.legal_name ?? null, lifecycleState: x.lifecycle_state, lifecycleLabel: STATES[x.lifecycle_state] ?? x.lifecycle_state, pm: x.pm_user, director: x.director_user,
      contractValue: showMoney ? money(x.contract_value) : null, originalContractValue: showMoney && pack ? money(pack.contract_value) : null, valueHidden: !showMoney, startDate: x.start_date, scheduledCompletion: x.scheduled_completion, forecastCompletion: x.revised_completion ?? null,
      health: h.level, healthItems: h.items, thresholds: t };
  }
  const slotsOf = (companyId) => {
    const rows = db.prepare('SELECT * FROM proj_360_widgets WHERE deleted_at IS NULL AND is_active = 1 AND (company_id IS NULL OR company_id = ?) ORDER BY tab, sort_order, id').all(companyId);
    const by = new Map(); for (const r of rows) by.set(r.widget_code, r.company_id == null && by.has(r.widget_code) ? by.get(r.widget_code) : r); // a company's own row beats the platform's
    return [...by.values()].sort((a, b) => P360_TABS.indexOf(a.tab) - P360_TABS.indexOf(b.tab) || a.sort_order - b.sort_order);
  };
  function widgets(actor, x, period) {
    const ctx = { db, actor, project: x, period, thresholds: thresholdsOf(x.company_id) }; const out = [];
    for (const s of slotsOf(x.company_id)) {
      const base = { code: s.widget_code, tab: s.tab, slot: s.slot, title: s.title, titleHi: s.title_hi, ownerPart: s.owner_part, module: s.module };
      const provider = project360Providers.get(s.widget_code) ?? builtins.get(s.widget_code);
      if (!provider) { out.push({ ...base, status: 'NOT_LIVE', emptyText: s.empty_text ?? `This comes from part ${s.owner_part}, which is not live yet.`, figures: [], rows: [] }); continue; }
      if (!may(actor, s.permission_key, x.project_id)) continue; // BR-02: a live widget of a module the person has no right to is not shown at all
      try { const d = provider(ctx); out.push({ ...base, status: 'LIVE', figures: (d.figures ?? []).map((f) => ({ ...f, drill: drill(f.drill, ctx) })), rows: (d.rows ?? []).map((r) => ({ ...r, drill: drill(r.drill, ctx) })), note: d.note ?? null, drill: drill(s.drill_route, ctx) }); } catch (e) { out.push({ ...base, status: 'ERROR', figures: [], rows: [], emptyText: 'This widget could not be drawn; try again.', error: String(e?.message ?? e).slice(0, 160) }); }
    }
    return out;
  }
  const p360 = {
    get(actor, projectId, { period } = /** @type {{ period?: string }} */ ({})) {
      const x = project(actor, projectId); const t = thresholdsOf(x.company_id); const per = periodOf(period); const w = widgets(actor, x, per);
      return { ...header(actor, x, t), period: per, tabs: P360_TABS.map((k) => ({ key: k, label: P360_TAB_LABELS[k], widgets: w.filter((i) => i.tab === k) })), can: { export: may(actor, 'proj.p360.export', x.project_id) } };
    },
    exportFile(actor, projectId, format = 'pdf', { period } = /** @type {{ period?: string }} */ ({})) {
      const x = project(actor, projectId); if (!may(actor, 'proj.p360.export', x.project_id)) throw forbidden('You may not export Project 360 (permission proj.p360.export).');
      const d = p360.get(actor, projectId, { period }); const rows = [];
      rows.push({ tab: 'Header', widget: 'Project', figure: 'Code and name', value: `${d.code} ${d.name}` }, { tab: 'Header', widget: 'Project', figure: 'Client', value: d.client ?? '' }, { tab: 'Header', widget: 'Project', figure: 'Lifecycle state', value: d.lifecycleLabel }, { tab: 'Header', widget: 'Project', figure: 'Project manager', value: d.pm ?? '' },
        { tab: 'Header', widget: 'Project', figure: 'Start, scheduled and forecast completion', value: `${d.startDate ?? '-'} / ${d.scheduledCompletion ?? '-'} / ${d.forecastCompletion ?? '-'}` }, ...(d.valueHidden ? [] : [{ tab: 'Header', widget: 'Project', figure: 'Contract value (₹)', value: d.contractValue }]));
      for (const h of d.healthItems) rows.push({ tab: 'Health', widget: h.label, figure: h.level, value: h.detail });
      for (const tab of d.tabs) for (const w of tab.widgets) { if (w.status !== 'LIVE') rows.push({ tab: tab.label, widget: w.title, figure: 'Not live', value: w.emptyText }); for (const f of w.figures) rows.push({ tab: tab.label, widget: w.title, figure: f.label, value: f.value == null ? '' : String(f.value) }); }
      writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'export', newValues: { what: 'project 360', format, period: d.period.period }, actor: actor.user, companyId: x.company_id });
      return { buffer: writeExport(format, { columns: [{ key: 'tab', label: 'Tab', type: 'text' }, { key: 'widget', label: 'Widget', type: 'text' }, { key: 'figure', label: 'Figure', type: 'text' }, { key: 'value', label: 'Value', type: 'text' }], rows, footer: [`Period ${d.period.period}; health ${d.health}`], title: `Project 360: ${d.code} ${d.name}`, sheetName: 'Project 360' }), contentType: FORMATS[format], fileName: `project-360-${d.code}-${d.period.period}.${format}` };
    },
    /** FR-05: the projects the person may see, each with its health and the figures that matter first. */
    portfolio(actor, { q, health: only } = /** @type {{ q?: string, health?: string }} */ ({})) {
      if (!may(actor, 'proj.p360.view')) throw forbidden('You may not see the portfolio (permission proj.p360.view).');
      const f = authz.scopeFilter(actor, 'proj.p360.view', { project: 'x.project_id' }); const t = thresholdsOf(actor.companyId);
      const rows = db.prepare(`SELECT x.*, p.code, p.name FROM proj_projects x JOIN org_projects p ON p.id = x.project_id WHERE x.company_id = :c AND x.deleted_at IS NULL AND ${f.sql} ORDER BY p.code LIMIT 300`).all({ c: actor.companyId, ...(f.params ?? {}) });
      const today = todayIST();
      const list = rows.filter((x) => !q || `${x.code} ${x.name}`.toLowerCase().includes(String(q).toLowerCase())).map((x) => {
        const h = health(x, t); const n = (sql, ...a) => db.prepare(sql).get(...a).n; const can = (k) => may(actor, k, x.project_id);
        return { projectId: x.project_id, code: x.code, name: x.name, lifecycleState: x.lifecycle_state, lifecycleLabel: STATES[x.lifecycle_state] ?? x.lifecycle_state, pm: x.pm_user, startDate: x.start_date, scheduledCompletion: x.scheduled_completion, health: h.level, healthItems: h.items.map((i) => ({ code: i.code, label: i.label, level: i.level })),
          overdueMilestones: n("SELECT COUNT(*) AS n FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL AND milestone_status = 'PLANNED' AND planned_date < ?", x.project_id, today),
          criticalRisks: can('proj.risk.view') ? n("SELECT COUNT(*) AS n FROM proj_risks WHERE org_project_id = ? AND deleted_at IS NULL AND rtype = 'RISK' AND status = 'OPEN' AND level = 'CRITICAL'", x.project_id) : null,
          openIssues: can('proj.issue.view') ? n("SELECT COUNT(*) AS n FROM proj_risk_issues WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS')", x.project_id) : null };
      }).filter((p) => !only || p.health === only).sort((a, b) => WORST[b.health] - WORST[a.health] || a.code.localeCompare(b.code));
      const count = (l) => list.filter((p) => p.health === l).length;
      return { projects: list, summary: { total: list.length, red: count('RED'), amber: count('AMBER'), green: count('GREEN'), none: count('NONE') } };
    },
  };

  // the three KPI widgets of the dashboard framework (03.07): the figures of the projects in view, inside the person's scope
  const scoped = (ctx, perm) => {
    const f = authz.scopeFilter(ctx.actor, perm, { project: 'x.project_id' });
    return { where: `x.company_id = :c AND x.deleted_at IS NULL AND ${f.sql}${ctx.filters?.projectId ? ' AND x.project_id = :pid' : ''}`, params: { c: ctx.actor.companyId, ...(f.params ?? {}), ...(ctx.filters?.projectId ? { pid: ctx.filters.projectId } : {}) } };
  };
  const kpi = (value, extra) => ({ value, unit: '', previous: null, trendPct: null, target: null, status: 'neutral', ...extra });
  for (const [code, fn] of [
    ['proj.risks.critical', (ctx) => { const s = scoped(ctx, 'proj.risk.view'); const n = ctx.db.prepare(`SELECT COUNT(*) AS n FROM proj_risks x WHERE ${s.where} AND x.rtype = 'RISK' AND x.status = 'OPEN' AND x.level = 'CRITICAL'`).get(s.params).n; return kpi(n, { unit: n === 1 ? 'risk' : 'risks', status: n ? 'red' : 'green', drill: '/proj/risks?filter[level]=CRITICAL&filter[status]=OPEN' }); }],
    ['proj.milestones.late', (ctx) => { const s = scoped(ctx, 'proj.project.view'); const n = ctx.db.prepare(`SELECT COUNT(*) AS n FROM proj_milestones m JOIN proj_projects x ON x.project_id = m.project_id WHERE ${s.where} AND m.deleted_at IS NULL AND m.milestone_status = 'PLANNED' AND m.planned_date < :today`).get({ ...s.params, today: todayIST() }).n; return kpi(n, { unit: n === 1 ? 'milestone' : 'milestones', status: n ? 'amber' : 'green', drill: '/proj/projects' }); }],
    ['proj.map.located', (ctx) => { const s = scoped(ctx, 'proj.gis.view'); const n = ctx.db.prepare(`SELECT COUNT(*) AS n FROM proj_locations l JOIN proj_projects x ON x.project_id = l.project_id WHERE ${s.where} AND l.deleted_at IS NULL AND l.lat IS NOT NULL AND l.lng IS NOT NULL`).get(s.params).n; return kpi(n, { unit: n === 1 ? 'location' : 'locations', drill: '/proj/map' }); }],
  ]) if (!widgetRegistry.get(code)) widgetRegistry.register({ code, provider: fn });
  return { p360 };
}
