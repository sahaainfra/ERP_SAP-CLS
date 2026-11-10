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
import { baselineRoutes, ganttRoutes, planRoutes } from './routes.js';
import { createGanttService } from './gantt.js';
import { createProgramme } from './programme.js';
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
]) eventTypes.define({ type, version: 1, schema, owner: 'plan', description });

integrityRegistry.register({
  allowNegative: ['plan_activities.total_float', 'plan_activities.free_float', 'plan_dependencies.lag_days'], companyOptional: ['plan_templates'],
  statuses: { plan_schedules: Object.keys(SCHEDULE_STATUS), plan_calendars: ['DRAFT', 'ACTIVE', 'CANCELLED'], plan_templates: ['DRAFT', 'ACTIVE', 'CANCELLED'], plan_resource_capacity: ['DRAFT', 'ACTIVE', 'CANCELLED'], plan_baselines: Object.keys(BASELINE_STATUS), plan_imports: ['ANALYSED', 'IMPORTED', 'DISCARDED'] },
  uniqueKeys: [{ table: 'plan_schedules', columns: ['company_id', 'doc_no'] }, { table: 'plan_baselines', columns: ['company_id', 'doc_no'] }, { table: 'plan_activities', columns: ['schedule_id', 'code'] }, { table: 'plan_dependencies', columns: ['schedule_id', 'pred_id', 'succ_id'] }],
});

/** Module "plan": planning and scheduling (M13). Part 13.01 holds the schedule core: schedules in versions, activities, links, calendars, templates, the CPM pass and the progress. The tables are `plan_*`. */
export const plan = {
  code: 'plan',
  name: 'Planning & Scheduling',
  routePrefix: '/api/v1/plan',
  ownerPart: '13.01',
  status: 'The schedule of a project in versions: activities (task, milestone, level of effort, WBS summary) on WBS nodes and locations with duration, calendar, constraint, quantity, BOQ split and person responsible; FS, SS, FF and SF links with lags (a loop is refused with its path); calendars of working days, holidays and site exceptions; activities generated from templates per WBS node or floor, or from the BOQ split by WBS; the CPM pass on the server (early and late dates, total and free float, critical path); progress at a data date; approval by the project controls manager. Part 13.03 adds the baselines of the programme (a frozen picture with a number, approved by the project manager and the project director, one of them current), the revisions with their reason and change summary, the variance of the current programme against a baseline, the quality check in the manner of DCMA-14, and the exchange with MS Project (XML) and Primavera P6 (XML and XER). The DPR (14.05) feeds progress by event.',
  tables: ['plan_calendars', 'plan_schedules', 'plan_activities', 'plan_dependencies', 'plan_activity_boq', 'plan_templates', 'plan_activity_resources', 'plan_resource_capacity', 'plan_gantt_edits', 'plan_baselines', 'plan_imports'],
  companyOptional: ['plan_templates'],
  resources: ['projects', 'options', 'current', 'calendars', 'templates', 'schedules', 'activities', 'dependencies', 'resource-options', 'capacity', 'baselines', 'imports'],

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
