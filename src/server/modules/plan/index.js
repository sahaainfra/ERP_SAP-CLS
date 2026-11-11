import express, { Router } from 'express';
import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { SCHEDULE_DOC, SCHEDULE_STATUS, createPlanService } from './service.js';
import { baselineRoutes, delayRoutes, ganttRoutes, lookaheadRoutes, planRoutes } from './routes.js';
import { createGanttService } from './gantt.js';
import { createProgramme } from './programme.js';
import { CAUSES, DELAY_DOC, DELAY_STATUS, RESPONSIBILITY, createDelayService } from './delays.js';
import { CONSTRAINT_STATUS, WEEKLY_DOC, WEEKLY_STATUS, createLookaheadService } from './lookahead.js';
import { BASELINE_DOC, BASELINE_STATUS, REVISION_TYPES, createBaselineService } from './baselines.js';

const services = new WeakMap();
export const planOf = (db) => services.get(db) ?? null;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['plan.schedule.calculated', 'The CPM pass of a schedule ran on the server: data { scheduleId, projectId, docNo, versionNo, status, start, finish, dataDate, activities, critical, ms }.'],
  ['plan.schedule.approved', 'A schedule version was approved by the project controls manager and its logic locked; the previous approved version is superseded: data { scheduleId, projectId, docNo, versionNo, previousScheduleId, start, finish, activities, critical }. Look-ahead (13.04), work authorisation (14.01), MRP (15.02) and resource planning (17.08) read its activities at GET /api/v1/plan/current.'],
  ['plan.resources.updated', 'The labour, plant and material of an activity were set on the Gantt (part 13.02), for budget phasing (12.01) and resource planning (17.08): data { scheduleId, projectId, activityId, code, rows: [{ type, key, label, uom, qtyTotal }] }.'],
  ['plan.progress.updated', 'The progress of a schedule was updated at a data date and the schedule recalculated: data { scheduleId, projectId, dataDate, source (MANUAL or DPR), finish, activities: [{ activityId, code, actualStart, actualFinish, pctComplete, remainingDays }] }.'],
  ['plan.baseline.approved', 'A baseline of the programme was approved by the project manager and the project director (part 13.03); it is frozen and is now the current baseline of its project, the one variance and earned value read: data { baselineId, projectId, scheduleId, docNo, baselineNo, revisionType (ORIGINAL, EOT, RESEQUENCE, SCOPE, OTHER), previousBaselineId, start, finish, previousFinish, finishVar, activities, critical }. Its activities are read at GET /api/v1/plan/baselines/current. For control accounts (10.01), the DPR (14.05), earned value (13.05) and the delay analysis (21.06).'],
  ['plan.schedule.imported', 'A file of MS Project or Primavera was applied to a working schedule and the schedule calculated (part 13.03): data { scheduleId, projectId, importId, format, mode (REPLACE or MERGE), created, updated, removed, links, finish }.'],
  ['plan.constraint.raised', 'A constraint was found or logged on an activity (part 13.04): data { constraintId, projectId, scheduleId, activityId, code, type (DRAWING, RFI, SUBMITTAL, MATERIAL, LABOUR, PLANT, PERMIT, PREDECESSOR, CLIENT_APPROVAL, ACCESS), source, sourceId, dueDate }. For the dashboards.'],
  ['plan.constraint.cleared', 'A constraint was cleared (its source was resolved, or a person cleared or waived it): data { constraintId, projectId, scheduleId, activityId, type, by, waived }.'],
  ['plan.weekly_plan.approved', 'A weekly work plan was approved by the construction manager and the project manager (part 13.04); its commitments are spread over the working days of the week for work authorisation (14.01): data { planId, projectId, siteId, scheduleId, docNo, weekStart, revisionNo, supersedes, items, daily: [{ date, activityId, activity, crewId, qty, uom }] }. The daily plan is also read at GET /api/v1/plan/daily-plan.'],
  ['plan.weekly_plan.closed', 'A week was closed with its Percent Plan Complete (completed commitments / commitments) (part 13.04): data { planId, projectId, siteId, docNo, weekStart, items, completed, ppc, variance: [{ code, n }] }.'],
  ['plan.delay.drafted', 'A delay was drafted by itself from an RFI answered with a time impact (part 13.05): data { delayId, projectId, source, sourceId, delayDays }.'],
  ['plan.delay.approved', 'The classification of a delay was approved by the project manager and the commercial manager (part 13.05); it is locked and a revision replaces it: data { delayId, projectId, docNo, revisionNo, supersedes, title, cause, responsibility (EMPLOYER, CONTRACTOR, NEUTRAL), excusable, compensable, startDate, endDate, delayDays, impactDays (the completion shift of its time-impact analysis), tiaId, activities }. For the EOT claims (21.06) and the liquidated damages (21.07), which also read GET /api/v1/plan/delays/claims.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'plan', description });

integrityRegistry.register({
  allowNegative: ['plan_activities.total_float', 'plan_activities.free_float', 'plan_dependencies.lag_days'], companyOptional: ['plan_templates'],
  statuses: { plan_schedules: Object.keys(SCHEDULE_STATUS), plan_calendars: ['DRAFT', 'ACTIVE', 'CANCELLED'], plan_templates: ['DRAFT', 'ACTIVE', 'CANCELLED'], plan_resource_capacity: ['DRAFT', 'ACTIVE', 'CANCELLED'], plan_baselines: Object.keys(BASELINE_STATUS), plan_imports: ['ANALYSED', 'IMPORTED', 'DISCARDED'], plan_weekly_plans: Object.keys(WEEKLY_STATUS), plan_constraints: Object.keys(CONSTRAINT_STATUS), plan_lookaheads: ['ACTIVE', 'ARCHIVED'], plan_delays: Object.keys(DELAY_STATUS) },
  uniqueKeys: [{ table: 'plan_schedules', columns: ['company_id', 'doc_no'] }, { table: 'plan_baselines', columns: ['company_id', 'doc_no'] }, { table: 'plan_weekly_plans', columns: ['company_id', 'doc_no'] }, { table: 'plan_delays', columns: ['company_id', 'doc_no'] }, { table: 'plan_activities', columns: ['schedule_id', 'code'] }, { table: 'plan_dependencies', columns: ['schedule_id', 'pred_id', 'succ_id'] }],
});

/** Module "plan": planning and scheduling (M13). Part 13.01 holds the schedule core: schedules in versions, activities, links, calendars, templates, the CPM pass and the progress. The tables are `plan_*`. */
export const plan = {
  code: 'plan',
  name: 'Planning & Scheduling',
  routePrefix: '/api/v1/plan',
  ownerPart: '13.01',
  status: 'The schedule of a project in versions: activities (task, milestone, level of effort, WBS summary) on WBS nodes and locations with duration, calendar, constraint, quantity, BOQ split and person responsible; FS, SS, FF and SF links with lags (a loop is refused with its path); calendars of working days, holidays and site exceptions; activities generated from templates per WBS node or floor, or from the BOQ split by WBS; the CPM pass on the server (early and late dates, total and free float, critical path); progress at a data date; approval by the project controls manager. Part 13.03 adds the baselines of the programme (a frozen picture with a number, approved by the project manager and the project director, one of them current), the revisions with their reason and change summary, the variance of the current programme against a baseline, the quality check in the manner of DCMA-14, and the exchange with MS Project (XML) and Primavera P6 (XML and XER). The DPR (14.05) feeds progress by event.',
  tables: ['plan_calendars', 'plan_schedules', 'plan_activities', 'plan_dependencies', 'plan_activity_boq', 'plan_templates', 'plan_activity_resources', 'plan_resource_capacity', 'plan_gantt_edits', 'plan_baselines', 'plan_imports', 'plan_lookaheads', 'plan_constraints', 'plan_weekly_plans', 'plan_weekly_items', 'plan_delays', 'plan_tia', 'plan_delay_evidence'],
  companyOptional: ['plan_templates'],
  resources: ['projects', 'options', 'current', 'calendars', 'templates', 'schedules', 'activities', 'dependencies', 'resource-options', 'capacity', 'baselines', 'imports', 'lookahead', 'constraints', 'weekly-plans', 'ppc', 'daily-plan', 'delays'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_schedules'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const svc = /** @type {any} */ (createPlanService({ db })); const gantt = createGanttService({ db, plan: svc.plan }); svc.gantt = gantt; services.set(db, svc); const programme = createProgramme({ db, gantt });
    listExports.register('plan.schedules', { source: (actor, req) => svc.plan.schedules.exportSource(actor, req), hidden: () => [] });
    runtimeOf(db)?.bus?.subscribe(['site.dpr.approved'], (e) => { svc.plan.onDpr(e); }, { consumer: 'plan.progress' });
    runtimeOf(db)?.bus?.subscribe(['plan.schedule.calculated'], (e) => { if (e.data?.scheduleId) gantt.syncResources(Number(e.data.scheduleId)); }, { consumer: 'plan.resources' });
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.plan.p1301') ? next() : next(notFound('Planning and scheduling is not enabled for your company yet (feature flag ff.plan.p1301 is OFF).'))));
    const mw = { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) };
    router.use(planRoutes(svc, { exportsOf: () => listExportsOf(db) }, mw));
    const p1302 = Router();
    p1302.use((req, _res, next) => (flags.isOn(req.actor, 'ff.plan.p1302') ? next() : next(notFound('The Gantt planner and resource loading are not enabled for your company yet (feature flag ff.plan.p1302 is OFF).'))));
    p1302.use(ganttRoutes(gantt, programme, mw));
    router.use(p1302);
    // part 13.03: baselines, the comparison, the quality check and the files of MS Project and Primavera. A file comes as the body of the request (at most 16 MB), not as JSON.
    const bl = createBaselineService({ db, plan: svc.plan }); svc.baselines = bl; svc.baselineDecide = bl.baselineDecide;
    gantt.setBaselineSource((actor, s) => (flags.isOn(actor, 'ff.plan.p1303') ? bl.ganttBaseline(actor, s) : null));
    listExports.register('plan.baselines', { source: (actor, req) => bl.baselines.exportSource(actor, req), hidden: () => [] });
    const p1303 = Router();
    p1303.use((req, _res, next) => (flags.isOn(req.actor, 'ff.plan.p1303') ? next() : next(notFound('Baselines and the exchange of schedules are not enabled for your company yet (feature flag ff.plan.p1303 is OFF).'))));
    p1303.use(baselineRoutes(bl, { exportsOf: () => listExportsOf(db), fileBody: express.raw({ type: ['application/octet-stream', 'application/xml', 'text/xml', 'text/plain'], limit: '16mb' }) }, mw));
    router.use(p1303);
    // part 13.04: the look-ahead board, the constraint log and the weekly work plans. Constraints found in the RFIs, drawings and schedule are worked out again when those change (BR-02).
    const la = createLookaheadService({ db, plan: svc.plan }); svc.lookahead = la; svc.weeklyDecide = la.weeklyDecide;
    listExports.register('plan.constraints', { source: (actor, req) => la.constraints.exportSource(actor, req), hidden: () => [] });
    listExports.register('plan.weekly_plans', { source: (actor, req) => la.weekly.exportSource(actor, req), hidden: () => [] });
    runtimeOf(db)?.bus?.subscribe(['engg.rfi.issued', 'engg.rfi.responded', 'engg.rfi.closed', 'engg.drawing.issued', 'plan.progress.updated', 'plan.schedule.approved'], (e) => { if (flags.isOn({ companyId: Number(e.companyId ?? e.company_id) }, 'ff.plan.p1304')) la.onEvent(e); }, { consumer: 'plan.constraints' });
    const p1304 = Router();
    p1304.use((req, _res, next) => (flags.isOn(req.actor, 'ff.plan.p1304') ? next() : next(notFound('Look-ahead planning and weekly work plans are not enabled for your company yet (feature flag ff.plan.p1304 is OFF).'))));
    p1304.use(lookaheadRoutes(la, { exportsOf: () => listExportsOf(db) }, mw));
    router.use(p1304);
    // part 13.05: the delay register, the time-impact analysis and the delay summary. An RFI answered with a time impact drafts a delay (FR-02).
    const dl = createDelayService({ db, plan: svc.plan }); svc.delays = dl; svc.delayDecide = dl.delayDecide;
    listExports.register('plan.delays', { source: (actor, req) => dl.delays.exportSource(actor, req), hidden: () => [] });
    runtimeOf(db)?.bus?.subscribe(['engg.rfi.responded'], (e) => { if (flags.isOn({ companyId: Number(e.companyId ?? e.company_id) }, 'ff.plan.p1305')) dl.fromRfi(e); }, { consumer: 'plan.delays' });
    runtimeOf(db)?.bus?.subscribe(['site.hindrance.approved', 'site.hindrance.closed', 'site.weather.shutdown'], (e) => { if (flags.isOn({ companyId: Number(e.companyId ?? e.company_id) }, 'ff.plan.p1305')) dl.fromSite(e); }, { consumer: 'plan.delays.site' });
    const p1305 = Router();
    p1305.use((req, _res, next) => (flags.isOn(req.actor, 'ff.plan.p1305') ? next() : next(notFound('The delay register is not enabled for your company yet (feature flag ff.plan.p1305 is OFF).'))));
    p1305.use(delayRoutes(dl, { exportsOf: () => listExportsOf(db) }, mw));
    router.use(p1305);
    api.use('/plan', router);
  },
};

// ---- the approval of a schedule: the project controls manager (the creator never approves) -----------------------------------------------------------------------
const sline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM plan_schedules x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: SCHEDULE_DOC, label: 'Project schedule', processOwner: 'PCMGR', route: (id) => `/plan/activities?scheduleId=${id}`,
  describe(db, companyId, id) { const r = sline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} schedule v${r.version_no}: ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = sline(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Version', value: String(r.version_no) }, { label: 'Start', value: r.start_date }, { label: 'Finish', value: r.finish_date ?? '—' }, { label: 'Activities', value: String(r.activities_count) }, { label: 'Critical', value: String(r.critical_count) }] }; },
  defaultDefinition: { name: 'Project schedule: the project controls manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'PCMGR', name: 'Project controls manager', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'PCMGR' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: {
    onApproved: (db, { instance, actor }) => planOf(db)?.planDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => planOf(db)?.planDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => planOf(db)?.planDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => planOf(db)?.planDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(SCHEDULE_DOC, ({ db, instance }) => {
  const r = sline(db, Number(instance.docId)); if (!r) return { sections: [] };
  const x = db.prepare('SELECT SUM(total_float < 0) AS neg, SUM(constraint_type <> \'NONE\') AS cons, SUM(act_type = \'MILESTONE\') AS ms, (SELECT COUNT(*) FROM plan_dependencies d WHERE d.schedule_id = ? AND d.deleted_at IS NULL) AS links FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').get(r.id, r.id);
  const open = db.prepare("SELECT COUNT(*) AS n FROM plan_activities a WHERE a.schedule_id = ? AND a.deleted_at IS NULL AND a.act_type IN ('TASK', 'MILESTONE') AND NOT EXISTS (SELECT 1 FROM plan_dependencies d WHERE d.deleted_at IS NULL AND d.succ_id = a.id) AND NOT EXISTS (SELECT 1 FROM plan_dependencies d WHERE d.deleted_at IS NULL AND d.pred_id = a.id)").get(r.id).n;
  const prev = db.prepare("SELECT doc_no, finish_date FROM plan_schedules WHERE org_project_id = ? AND status = 'APPROVED' AND id <> ? AND deleted_at IS NULL").get(r.org_project_id, r.id);
  return { sections: [{ code: 'plan-schedule', title: 'Before you approve the schedule', kind: 'metrics', items: [
    { label: 'Start → finish', value: `${r.start_date} → ${r.finish_date ?? 'not calculated'}`, format: 'text' }, { label: 'Activities', value: r.activities_count, format: 'number' }, { label: 'Critical', value: r.critical_count, format: 'number' },
    { label: 'Negative float', value: x.neg ?? 0, format: 'number', tone: (x.neg ?? 0) > 0 ? 'bad' : undefined }, { label: 'Activities with no link at all', value: open, format: 'number', tone: open > 0 ? 'warn' : undefined }, { label: 'Links', value: x.links ?? 0, format: 'number' }, { label: 'Constraints', value: x.cons ?? 0, format: 'number' },
    ...(prev ? [{ label: `Finish of the version in force (${prev.doc_no})`, value: prev.finish_date ?? '—', format: 'text' }] : [])] }] };
});
objectTypes.register({
  type: 'plan_schedule', label: 'Project schedule', permission: 'plan.schedule.view', route: (id) => `/plan/activities?scheduleId=${id}`, attachmentEntity: 'plan_schedule', approvalTarget: 'plan_schedule',
  access(db, actor, id) { const s = planOf(db); if (!s) return null; try { const r = s.plan.schedules.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: null, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'plan_schedules', id }],
  summary(db, actor, id) { const s = planOf(db); if (!s) return null; try { const r = s.plan.schedules.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode} v${r.versionNo}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = planOf(db); if (!s) return []; try { const r = s.plan.schedules.get(actor, Number(id)); return [{ kind: 'report', label: 'Critical path and float', to: `/plan/critical?scheduleId=${r.id}`, direction: 'out' }, ...db.prepare('SELECT id, doc_no, version_no, status FROM plan_schedules WHERE org_project_id = ? AND id <> ? AND deleted_at IS NULL ORDER BY version_no').all(r.projectId, r.id).map((v) => ({ kind: 'schedule', label: `${v.doc_no} version ${v.version_no} (${SCHEDULE_STATUS[v.status]})`, to: `/plan/activities?scheduleId=${v.id}`, direction: v.version_no < r.versionNo ? 'in' : 'out' }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'plan.schedule.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM plan_schedules WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `${q}%`, limit).filter((x) => authzOf(db).check(actor, 'plan.schedule.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => ({ id: x.id })); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM plan_schedules WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'plan_schedule', label: 'Project schedule (programme, method statement, notes)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, status FROM plan_schedules WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed; if (!at('plan.schedule.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: null, canView: true, canEdit: at('plan.schedule.edit'), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});

// ---- the approval of a baseline (part 13.03): the project manager reviews, the project director approves; the planner who prepares it holds no approval ----------------------
const bline = (db, id) => db.prepare('SELECT x.id, x.company_id, x.doc_no, x.name, x.org_project_id, x.schedule_id, x.baseline_no, x.revision_type, x.reason, x.change_summary, x.change_json, x.start_date, x.finish_date, x.activities_count, x.critical_count, x.links_count, x.status, x.requested_by, x.previous_baseline_id, p.code, p.name AS pname FROM plan_baselines x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
const approver = (code, name, role, slaHours) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
workflowTypes.register({
  docType: BASELINE_DOC, label: 'Programme baseline', processOwner: 'PD', route: (id) => `/plan/baselines?id=${id}`,
  describe(db, companyId, id) { const r = bline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} baseline revision ${r.baseline_no}: ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = bline(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Kind', value: REVISION_TYPES[r.revision_type] }, { label: 'Revision', value: String(r.baseline_no) }, { label: 'Start', value: r.start_date ?? '—' }, { label: 'Finish', value: r.finish_date ?? '—' }, { label: 'Activities', value: String(r.activities_count) }, { label: 'Reason', value: r.reason }] }; },
  defaultDefinition: { name: 'Programme baseline: the project manager, then the project director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PM', 'Project manager (review)', 'PM', 48), approver('PD', 'Project director (approval)', 'PD', 72)] },
  hooks: {
    onApproved: (db, { instance, actor }) => planOf(db)?.baselineDecide?.(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => planOf(db)?.baselineDecide?.(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => planOf(db)?.baselineDecide?.(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => planOf(db)?.baselineDecide?.(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(BASELINE_DOC, ({ db, instance }) => {
  const r = bline(db, Number(instance.docId)); if (!r) return { sections: [] }; const c = (() => { try { return JSON.parse(r.change_json ?? '{}'); } catch { return {}; } })();
  const s = db.prepare('SELECT doc_no, version_no, status FROM plan_schedules WHERE id = ?').get(r.schedule_id); const prev = r.previous_baseline_id ? db.prepare('SELECT doc_no, baseline_no, finish_date FROM plan_baselines WHERE id = ?').get(r.previous_baseline_id) : null;
  const items = [
    { label: 'Kind', value: REVISION_TYPES[r.revision_type], format: 'text' }, { label: 'Start → finish', value: `${r.start_date ?? '—'} → ${r.finish_date ?? '—'}`, format: 'text' }, { label: 'Activities', value: r.activities_count, format: 'number' }, { label: 'Critical', value: r.critical_count, format: 'number' }, { label: 'Links', value: r.links_count, format: 'number' },
    { label: 'Schedule', value: s ? `${s.doc_no} v${s.version_no} (${SCHEDULE_STATUS[s.status] ?? s.status})` : '—', format: 'text', tone: s && s.status !== 'APPROVED' ? 'warn' : undefined },
  ];
  if (prev) items.push({ label: `Finish of the current baseline (${prev.doc_no})`, value: prev.finish_date ?? '—', format: 'text' }, { label: 'Finish moves by (days)', value: c.finishVar ?? 0, format: 'number', tone: (c.finishVar ?? 0) > 0 ? 'bad' : undefined }, { label: 'Activities later than the current baseline', value: c.slipped ?? 0, format: 'number', tone: (c.slipped ?? 0) > 0 ? 'warn' : undefined }, { label: 'Of them critical', value: c.criticalSlipped ?? 0, format: 'number', tone: (c.criticalSlipped ?? 0) > 0 ? 'bad' : undefined }, { label: 'Added / removed / changed', value: `${c.added ?? 0} / ${c.removed ?? 0} / ${c.changed ?? 0}`, format: 'text' });
  if (r.change_summary) items.push({ label: 'Change summary', value: r.change_summary, format: 'text' });
  return { sections: [{ code: 'plan-baseline', title: 'Before you approve the baseline', kind: 'metrics', items }] };
});
objectTypes.register({
  type: 'plan_baseline', label: 'Programme baseline', permission: 'plan.baseline.view', route: (id) => `/plan/baselines?id=${id}`, attachmentEntity: 'plan_baseline', approvalTarget: 'plan_baseline',
  access(db, actor, id) { const s = planOf(db)?.baselines; if (!s) return null; try { const r = s.baselines.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: null, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'plan_baselines', id }],
  summary(db, actor, id) { const s = planOf(db)?.baselines; if (!s) return null; try { const r = s.baselines.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode} revision ${r.baselineNo}${r.current ? ' (current)' : ''}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = planOf(db)?.baselines; if (!s) return []; try { const r = s.baselines.get(actor, Number(id)); return [{ kind: 'schedule', label: `Schedule ${r.scheduleDocNo}`, to: `/plan/activities?scheduleId=${r.scheduleId}`, direction: 'in' }, { kind: 'report', label: 'Variance against the current programme', to: `/plan/variance?baselineId=${r.id}`, direction: 'out' }, ...db.prepare('SELECT id, doc_no, baseline_no, status, is_current FROM plan_baselines WHERE org_project_id = ? AND id <> ? AND deleted_at IS NULL ORDER BY baseline_no').all(r.projectId, r.id).map((v) => ({ kind: 'baseline', label: `${v.doc_no} revision ${v.baseline_no} (${BASELINE_STATUS[v.status]}${v.is_current ? ', current' : ''})`, to: `/plan/baselines?id=${v.id}`, direction: v.baseline_no < r.baselineNo ? 'in' : 'out' }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'plan.baseline.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM plan_baselines WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `${q}%`, limit).filter((x) => authzOf(db).check(actor, 'plan.baseline.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => ({ id: x.id })); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM plan_baselines WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'plan_baseline', label: 'Programme baseline (the letter of the extension of time, the client approval, notes)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, status FROM plan_baselines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed; if (!at('plan.baseline.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: null, canView: true, canEdit: at('plan.baseline.edit'), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});

// ---- the approval of a weekly work plan (part 13.04): the construction manager, then the project manager; whoever prepared the plan never decides it -----------------------------
const wline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM plan_weekly_plans x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: WEEKLY_DOC, label: 'Weekly work plan', processOwner: 'PM', route: (id) => `/plan/weekly?id=${id}`,
  describe(db, companyId, id) { const r = wline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} work plan, week of ${r.week_start}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = wline(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Week from', value: r.week_start }, { label: 'Revision', value: String(r.revision_no) }, { label: 'Commitments', value: String(r.items_count) }, ...(r.reason ? [{ label: 'Reason for the revision', value: r.reason }] : [])] }; },
  defaultDefinition: { name: 'Weekly work plan: the construction manager, then the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('CM', 'Construction manager (review)', 'CM', 24), approver('PM', 'Project manager (approval)', 'PM', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => planOf(db)?.weeklyDecide?.(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => planOf(db)?.weeklyDecide?.(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => planOf(db)?.weeklyDecide?.(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => planOf(db)?.weeklyDecide?.(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(WEEKLY_DOC, ({ db, instance }) => {
  const r = wline(db, Number(instance.docId)); if (!r) return { sections: [] };
  const blocked = db.prepare("SELECT COUNT(*) AS n FROM plan_weekly_items i WHERE i.plan_id = ? AND i.deleted_at IS NULL AND EXISTS (SELECT 1 FROM plan_constraints c WHERE c.activity_id = i.activity_id AND c.status = 'OPEN' AND c.deleted_at IS NULL)").get(r.id).n;
  const last = db.prepare("SELECT doc_no, week_start, ppc FROM plan_weekly_plans WHERE org_project_id = ? AND status = 'CLOSED' AND deleted_at IS NULL ORDER BY week_start DESC LIMIT 1").get(r.org_project_id);
  return { sections: [{ code: 'plan-weekly', title: 'Before you approve the weekly plan', kind: 'metrics', items: [
    { label: 'Week from', value: r.week_start, format: 'text' }, { label: 'Commitments', value: r.items_count, format: 'number' }, { label: 'Commitments on activities with an open constraint', value: blocked, format: 'number', tone: blocked > 0 ? 'bad' : undefined },
    ...(last?.ppc != null ? [{ label: `PPC of the last closed week (${last.week_start})`, value: `${last.ppc / 100} %`, format: 'text', tone: last.ppc < 7000 ? 'warn' : undefined }] : []), ...(r.reason ? [{ label: 'Reason for the revision', value: r.reason, format: 'text' }] : [])] }] };
});
objectTypes.register({
  type: 'plan_weekly_plan', label: 'Weekly work plan', permission: 'plan.weekly_plan.view', route: (id) => `/plan/weekly?id=${id}`, attachmentEntity: 'plan_weekly_plan', approvalTarget: 'plan_weekly_plan',
  access(db, actor, id) { const s = planOf(db)?.lookahead; if (!s) return null; try { const r = s.weekly.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'plan_weekly_plans', id }],
  summary(db, actor, id) { const s = planOf(db)?.lookahead; if (!s) return null; try { const r = s.weekly.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode} week of ${r.weekStart}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = planOf(db)?.lookahead; if (!s) return []; try { const r = s.weekly.get(actor, Number(id)); return [{ kind: 'schedule', label: `Schedule ${r.scheduleDocNo}`, to: `/plan/activities?scheduleId=${r.scheduleId}`, direction: 'in' }, { kind: 'report', label: 'Look-ahead board', to: `/plan/lookahead?scheduleId=${r.scheduleId}`, direction: 'in' }, ...db.prepare('SELECT id, doc_no, revision_no, status FROM plan_weekly_plans WHERE org_project_id = ? AND week_start = ? AND id <> ? AND deleted_at IS NULL ORDER BY revision_no').all(r.projectId, r.weekStart, r.id).map((v) => ({ kind: 'weekly plan', label: `${v.doc_no} revision ${v.revision_no} (${WEEKLY_STATUS[v.status]})`, to: `/plan/weekly?id=${v.id}`, direction: v.revision_no < r.revisionNo ? 'in' : 'out' }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'plan.weekly_plan.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM plan_weekly_plans WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `${q}%`, limit).filter((x) => authzOf(db).check(actor, 'plan.weekly_plan.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => ({ id: x.id })); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM plan_weekly_plans WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'plan_weekly_plan', label: 'Weekly work plan (the signed sheet, photographs of the work, notes)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, status FROM plan_weekly_plans WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed; if (!at('plan.weekly_plan.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: null, canView: true, canEdit: at('plan.weekly_plan.edit') || at('plan.weekly_plan.record'), locked: ['SUPERSEDED', 'CANCELLED'].includes(r.status) };
  },
});

// ---- the approval of a delay classification (part 13.05): the planner prepares, the project manager and then the commercial manager approve -----------------------------------------
const dline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM plan_delays x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: DELAY_DOC, label: 'Delay classification', processOwner: 'COMMGR', route: (id) => `/plan/delays?id=${id}`,
  describe(db, companyId, id) { const r = dline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} delay: ${r.title}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = dline(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Cause', value: CAUSES[r.cause_category] }, { label: 'Responsibility', value: RESPONSIBILITY[r.responsibility] }, { label: 'From', value: r.start_date }, { label: 'To', value: r.end_date }, { label: 'Delay days', value: String(r.delay_days) }, { label: 'Impact on completion (days)', value: r.impact_days == null ? 'not analysed' : String(r.impact_days) }] }; },
  defaultDefinition: { name: 'Delay classification: the project manager, then the commercial manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PM', 'Project manager (review)', 'PM', 48), approver('COMMGR', 'Commercial manager (approval)', 'COMMGR', 72)] },
  hooks: {
    onApproved: (db, { instance, actor }) => planOf(db)?.delayDecide?.(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => planOf(db)?.delayDecide?.(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => planOf(db)?.delayDecide?.(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => planOf(db)?.delayDecide?.(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(DELAY_DOC, ({ db, instance }) => {
  const r = dline(db, Number(instance.docId)); if (!r) return { sections: [] };
  const ev = db.prepare('SELECT entity, COUNT(*) AS n FROM plan_delay_evidence WHERE delay_id = ? AND deleted_at IS NULL GROUP BY entity').all(r.id); const t = r.tia_id ? db.prepare('SELECT completion_before, completion_after, impact_days, schedule_copy_ref FROM plan_tia WHERE id = ?').get(r.tia_id) : null;
  const acts = (() => { try { return JSON.parse(r.affected_activities_json ?? '[]'); } catch { return []; } })();
  return { sections: [{ code: 'plan-delay', title: 'Before you approve the classification', kind: 'metrics', items: [
    { label: 'Cause', value: CAUSES[r.cause_category], format: 'text' }, { label: 'Responsibility', value: RESPONSIBILITY[r.responsibility], format: 'text' }, { label: 'Period', value: `${r.start_date} → ${r.end_date} (${r.delay_days} days)`, format: 'text' },
    { label: 'Activities', value: acts.map((a) => a.code).join(', ') || '—', format: 'text', tone: acts.length ? undefined : 'warn' },
    { label: 'Impact on completion', value: t ? `${t.completion_before} → ${t.completion_after} (${t.impact_days} days, on ${t.schedule_copy_ref})` : 'not analysed', format: 'text', tone: t ? undefined : 'warn' },
    { label: 'Evidence', value: ev.map((e) => `${e.n} ${e.entity.replace(/^[a-z]+_/, '')}`).join(', ') || 'none', format: 'text', tone: ev.length ? undefined : 'bad' },
    ...(r.concurrency_note ? [{ label: 'Concurrency', value: r.concurrency_note, format: 'text', tone: 'warn' }] : [])] }] };
});
objectTypes.register({
  type: 'plan_delay', label: 'Delay', permission: 'plan.delay.view', route: (id) => `/plan/delays?id=${id}`, attachmentEntity: 'plan_delay', approvalTarget: 'plan_delay',
  access(db, actor, id) { const s = planOf(db)?.delays; if (!s) return null; try { const r = s.delays.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: null, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'plan_delays', id }],
  summary(db, actor, id) { const s = planOf(db)?.delays; if (!s) return null; try { const r = s.delays.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode}: ${r.title}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = planOf(db)?.delays; if (!s) return []; try { const r = s.delays.get(actor, Number(id)); return [...r.evidence.filter((e) => e.link).map((e) => ({ kind: e.entityLabel.toLowerCase(), label: e.label, to: e.link, direction: 'in' })), ...(r.previous ? [{ kind: 'delay', label: `${r.previous.docNo} (the revision it replaces)`, to: `/plan/delays?id=${r.previous.id}`, direction: 'in' }] : [])]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'plan.delay.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM plan_delays WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `${q}%`, limit).filter((x) => authzOf(db).check(actor, 'plan.delay.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => ({ id: x.id })); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM plan_delays WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'plan_delay', label: 'Delay (photographs, site records, correspondence)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, status FROM plan_delays WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed; if (!at('plan.delay.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: null, canView: true, canEdit: at('plan.delay.edit'), locked: ['SUPERSEDED', 'CANCELLED', 'REJECTED'].includes(r.status) };
  },
});
