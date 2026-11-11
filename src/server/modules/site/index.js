import { Router } from 'express';
import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { createFlagService } from '../core/api.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { registerOfflineForm, registerOfflineMaster } from '../eng/offline.js';
import { DAILY_STATUS, FRONT_STATUS, WA_DOC, WA_STATUS, createSiteService } from './service.js';
import { siteRoutes } from './routes.js';
import { DPR_DOC, DPR_STATUS, createDprService } from './dpr.js';
import { createDprReports } from './dpr-reports.js';
import { dprRoutes } from './dpr-routes.js';
import { parseDprCreate } from './validators.js';
import { HIN_DOC, HIN_STATUS, createConditionsService } from './conditions.js';
import { conditionsRoutes } from './conditions-routes.js';
import { registerWeatherProviders } from './weather-provider.js';

const services = new WeakMap();
export const siteOf = (db) => services.get(db) ?? null;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['site.wa.approved', 'A work authorisation was approved by the construction manager (and the project manager when it is outside the plan), or an emergency WA was raised and may be worked at once (part 14.01): data { waId, waNo, projectId, siteId, workFrontId, planDate, startTime, endTime, activityId, wbsId, locationId, plannedQty, uom, supervisor, emergency, resources: [{ type, key, itemId, trade, crewId, headcount, label, uom, qty }] }. For material issue (16.04), plant allocation (17.03), attendance validation (07.05) and the DPR (14.02); the WAs live on a site for a day are also read at GET /api/v1/site/work-authorisations/active.'],
  ['site.wa.closed', 'A work authorisation was closed with the quantity done and what each resource used (part 14.01): data { waId, waNo, projectId, siteId, planDate, activityId, plannedQty, actualQty, uom, resources: [{ type, key, label, uom, planned, actual }], varianceReason }. For progress (14.05).'],
  ['site.dpr.approved', 'A daily progress report was approved by the construction manager or the project manager, or an amendment replaced an approved one (part 14.02): data { dprId, docNo, projectId, siteId, date, supervisor, scope, revisionNo, amendment, supersedes, late, weather: { code, rainMm, ref }, work: [{ waId, waNo, activityId, locationId, qty, uom, plannedQty, pctOfWa, overWa }], labour: [{ category, contractorId, trade, headcount, manDays, otHours, attManDays }], materials: [{ itemId, qty, uom, waId, issueRef }], equipment: [{ key, label, hoursWorked, hoursIdle, hoursBreakdown }], hindrances, photos }. For progress (14.05), productivity (14.06), material reconciliation (16.10), measurement-book suggestions (22.01) and execution intelligence (27.06); an amendment carries the full new figures and `supersedes`, so the consumer recalculates.'],
  ['site.hindrance.approved', 'A hindrance was approved (SE, then CM, then PM) or an amendment replaced an approved one (part 14.03): data { hindranceId, rootId, docNo, projectId, siteId, title, type, responsibleParty, responsibleName, startDate, endDate, status, letterId, supersedes, activities: [{ id, code, name }], locations: [{ id, code }], thresholdDays }. For planning (13.05), which drafts a delay from it once it has lasted the threshold, and for the claims (21.06).'],
  ['site.hindrance.closed', 'An approved hindrance was closed with an end date and evidence (part 14.03): the same data as site.hindrance.approved, with the end date and status CLOSED. Planning finishes the delay draft with it.'],
  ['site.hindrance.escalated', 'A hindrance open for longer than site.hindrance.escalate_days was escalated to the construction manager and the project manager (part 14.03): data { hindranceId, docNo, projectId, siteId, level, openDays }.'],
  ['site.weather.recorded', 'The weather of a site and day was recorded, entered or fetched (part 14.03): data { weatherId, projectId, siteId, date, condition, rainfallMm, hoursLost, shutdown, pourRestricted }. For the daily progress report (14.02).'],
  ['site.weather.shutdown', 'A weather shutdown reached the hours that make a delay (part 14.03): data { weatherId, projectId, siteId, siteCode, date, hoursLost, delayDays, condition, rainfallMm, reason }. Planning (13.05) drafts a delay from it.'],
  ['site.daily_plan.issued', 'A daily work plan of a site and a supervisor was issued and its lines raised as work authorisations in draft (part 14.01): data { planId, docNo, projectId, siteId, planDate, supervisor, waIds }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'site', description });

integrityRegistry.register({
  statuses: { site_hindrances: Object.keys(HIN_STATUS), site_dprs: Object.keys(DPR_STATUS), site_work_authorisations: Object.keys(WA_STATUS), site_work_fronts: Object.keys(FRONT_STATUS), site_daily_plans: Object.keys(DAILY_STATUS) },
  uniqueKeys: [{ table: 'site_work_authorisations', columns: ['company_id', 'wa_no'] }, { table: 'site_daily_plans', columns: ['company_id', 'doc_no'] }, { table: 'site_dprs', columns: ['company_id', 'doc_no'] }, { table: 'site_hindrances', columns: ['company_id', 'doc_no'] }],
});

/** Module "site": site execution and progress control (M14). Part 14.01 holds work fronts, daily work plans and work authorisations ("no plan, no work"). The tables are `site_*`. */
export const site = {
  code: 'site',
  name: 'Site Execution & Progress',
  routePrefix: '/api/v1/site',
  ownerPart: '14.01',
  status: 'Work fronts of a site with their activities, status and open constraints; daily work plans of a site and a supervisor from the approved weekly plans (13.04) or copied from the day before; work authorisations (WA) with activity, WBS, location, quantity, crews, materials and plant from the norms, the budget line (12.03), the drawing revision (11.01), the permit and hold points, the time window and the supervisor, approved by the construction manager and by the project manager when outside the plan; emergency WAs regularised within 24 hours; closure with the quantity done and the reconciliation of what was used; the uses of attendance, stores, plant, DPR and measurement booked against a WA (CP-SITE-02).',
  tables: ['site_weather', 'site_hindrances', 'site_diary', 'site_visitors', 'site_dprs', 'site_dpr_work', 'site_dpr_labour', 'site_dpr_materials', 'site_dpr_equipment', 'site_dpr_photos', 'site_dpr_notes', 'site_work_fronts', 'site_daily_plans', 'site_daily_plan_lines', 'site_work_authorisations', 'site_wa_resources', 'site_wa_uses'],
  resources: ['weather', 'hindrances', 'diary', 'visitors', 'dprs', 'sites', 'board', 'wa-mobile', 'work-fronts', 'work-authorisations', 'daily-plans', 'wa-uses'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'site_work_authorisations'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const svc = createSiteService({ db }); services.set(db, svc);
    listExports.register('site.work_authorisations', { source: (actor, req) => svc.was.exportSource(actor, req), hidden: () => [] });
    // part 14.02: the daily progress report, its reports and its compliance
    const conditions = createConditionsService({ db, integrations: integrationsOf(db, { vaultKey: appConfig.vaultKey ?? undefined }) }); svc.conditions = conditions; svc.hindranceDecide = conditions.hindranceDecide;
    const dprSvc = createDprService({ db, dayContext: (...a) => conditions.dayContext(...a) }); svc.dpr = dprSvc; svc.dprReports = createDprReports({ db, base: dprSvc.base }); svc.dprDecide = dprSvc.dprDecide;
    listExports.register('site.dprs', { source: (actor, req) => dprSvc.dprs.exportSource(actor, req), hidden: () => [] });
    registerWeatherProviders(integrationsOf(db, { vaultKey: appConfig.vaultKey ?? undefined }).providers);
    for (const [code, key] of [['site.weather', 'weather'], ['site.hindrances', 'hindrances'], ['site.diary', 'diary'], ['site.visitors', 'visitors']]) listExports.register(code, { source: (actor, req) => conditions[key].exportSource(actor, req), hidden: () => [] });
    // BR-01: the hindrances open too long are escalated every morning
    const runtime = runtimeOf(db);
    runtime?.jobs?.register('site.hindrance_escalation', (ctx) => { const n = conditions.hindrances.escalate(); ctx.log(`Escalated ${n} hindrance(s)`); return { escalated: n }; }, { maxAttempts: 2, description: 'Escalates the hindrances open for longer than site.hindrance.escalate_days to the construction manager and the project manager.' });
    runtime?.scheduler?.define({ code: 'site.hindrance_escalation_daily', cron: '30 1 * * *', jobType: 'site.hindrance_escalation', description: 'Daily 07:00 India time: escalate the hindrances that have stayed open too long' });
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.site.p1401') ? next() : next(notFound('Work authorisation is not enabled for your company yet (feature flag ff.site.p1401 is OFF).'))));
    router.use(siteRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    const p1402 = Router();
    p1402.use((req, _res, next) => (flags.isOn(req.actor, 'ff.site.p1402') ? next() : next(notFound('The daily progress report is not enabled for your company yet (feature flag ff.site.p1402 is OFF).'))));
    p1402.use(dprRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    router.use('/dprs', p1402);
    router.use(['/weather', '/hindrances', '/diary', '/visitors'], (req, _res, next) => (flags.isOn(req.actor, 'ff.site.p1403') ? next() : next(notFound('Site diary, weather and hindrances are not enabled for your company yet (feature flag ff.site.p1403 is OFF).'))));
    router.use(conditionsRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/site', router);
  },
};

// ---- the approval of a work authorisation: the construction manager; the project manager too when the work is outside the plan or an emergency (regularisation). Whoever raised it never decides it.
const wline = (db, id) => db.prepare('SELECT x.*, p.code, s.code AS scode, a.code AS acode, a.name AS aname FROM site_work_authorisations x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.wa_site_id JOIN plan_activities a ON a.id = x.activity_id WHERE x.id = ?').get(id);
const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
workflowTypes.register({
  docType: WA_DOC, label: 'Work authorisation', processOwner: 'CM', route: (id) => `/site/work-authorisations?id=${id}`,
  describe(db, companyId, id) { const r = wline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.wa_no, title: `${r.code}/${r.scode} ${r.plan_date}: ${r.acode} ${r.planned_qty / 1000} ${r.uom ?? ''}${r.is_emergency ? ' (emergency)' : ''}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.wa_site_id } : null; },
  summarise(db, _actor, id) { const r = wline(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Site', value: `${r.code} / ${r.scode}` }, { label: 'Date and time', value: `${r.plan_date} ${r.start_time}–${r.end_time}` }, { label: 'Activity', value: `${r.acode} ${r.aname}` }, { label: 'Quantity', value: `${r.planned_qty / 1000} ${r.uom ?? ''}` }, { label: 'Supervisor', value: r.supervisor }, { label: 'In the weekly plan', value: r.in_plan ? 'Yes' : 'No' }, ...(r.is_emergency ? [{ label: 'Emergency', value: r.emergency_reason }] : [])] }; },
  defaultDefinition: { name: 'Work authorisation: the construction manager; the project manager when outside the plan or an emergency', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('CM', 'Construction manager', 'CM', 4), approver('PM', 'Project manager (outside the plan or emergency)', 'PM', 24, { field: 'escalate', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => siteOf(db)?.waDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => siteOf(db)?.waDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => siteOf(db)?.waDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => siteOf(db)?.waDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(WA_DOC, ({ db, instance }) => {
  const r = wline(db, Number(instance.docId)); if (!r) return { sections: [] };
  const res = db.prepare("SELECT resource_type, label, uom, planned_qty, headcount FROM site_wa_resources WHERE wa_id = ? AND deleted_at IS NULL ORDER BY resource_type, id").all(r.id);
  const tone = { FAIL: 'bad', WARN: 'warn' };
  return { sections: [
    { code: 'site-wa-checks', title: 'Checks before you approve (drawing, budget, permit, hold points, plan)', kind: 'metrics', items: json(r.checks_json, []).map((c) => ({ label: c.code.replace('_', ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()), value: `${c.result}: ${c.message}`, format: 'text', tone: tone[c.result] })) },
    { code: 'site-wa-resources', title: 'What the WA authorises', kind: 'metrics', items: res.length ? res.map((x) => ({ label: x.label, value: `${x.planned_qty / 1000} ${x.uom}${x.headcount != null ? ` (${x.headcount} people)` : ''}`, format: 'text' })) : [{ label: 'Resources', value: 'none named', format: 'text', tone: 'warn' }] },
  ] };
});
objectTypes.register({
  type: 'site_work_authorisation', label: 'Work authorisation', permission: 'site.work_authorisation.view', route: (id) => `/site/work-authorisations?id=${id}`, attachmentEntity: 'site_work_authorisation', approvalTarget: 'site_work_authorisation',
  access(db, actor, id) { const s = siteOf(db); if (!s) return null; try { const r = s.was.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'site_work_authorisations', id }],
  summary(db, actor, id) { const s = siteOf(db); if (!s) return null; try { const r = s.was.get(actor, Number(id)); return { label: `${r.waNo} ${r.siteCode} ${r.planDate}: ${r.activityCode}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = siteOf(db); if (!s) return []; try { const r = s.was.get(actor, Number(id)); return [...(r.dailyPlanId ? [{ kind: 'daily plan', label: 'Daily work plan', to: `/site/daily-plans?id=${r.dailyPlanId}`, direction: 'in' }] : []), ...(r.previous ? [{ kind: 'work authorisation', label: `${r.previous.waNo} (the revision it replaces)`, to: `/site/work-authorisations?id=${r.previous.id}`, direction: 'in' }] : []), ...r.uses.slice(0, 20).map((u) => ({ kind: u.kindLabel.toLowerCase(), label: `${u.source} (${u.result})`, to: null, direction: 'out' }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'site.work_authorisation.view').allowed) return []; return db.prepare('SELECT id, org_project_id, wa_site_id FROM site_work_authorisations WHERE company_id = ? AND deleted_at IS NULL AND wa_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `${q}%`, limit).filter((x) => authzOf(db).check(actor, 'site.work_authorisation.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.wa_site_id }).allowed).map((x) => ({ id: x.id })); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM site_work_authorisations WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'site_work_authorisation', label: 'Work authorisation (permit, photographs of the work, the signed sheet)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, wa_site_id, status FROM site_work_authorisations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.wa_site_id }).allowed; if (!at('site.work_authorisation.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.wa_site_id, canView: true, canEdit: at('site.work_authorisation.edit') || at('site.work_authorisation.close'), locked: ['SUPERSEDED', 'CANCELLED', 'REJECTED'].includes(r.status) };
  },
});

// ---- the approval of a daily progress report (part 14.02): the construction manager or the project manager; an amendment goes to the project manager only. Whoever sent it never decides it. ----------------
const dline = (db, id) => db.prepare('SELECT x.*, p.code, s.code AS scode FROM site_dprs x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.dpr_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: DPR_DOC, label: 'Daily progress report', processOwner: 'CM', route: (id) => `/site/dprs?id=${id}`,
  describe(db, companyId, id) { const r = dline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}/${r.scode} ${r.dpr_date}: ${r.scope === 'SITE' ? 'site report' : `report of ${r.supervisor}`}${r.parent_dpr_id ? ' (amendment)' : ''}${r.late ? ' (late)' : ''}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.dpr_site_id } : null; },
  summarise(db, _actor, id) { const r = dline(db, Number(id)); if (!r) return null; const f = json(r.flags_json, {}); return { fields: [{ label: 'Site', value: `${r.code} / ${r.scode}` }, { label: 'Date', value: r.dpr_date }, { label: 'Report of', value: `${r.scope === 'SITE' ? 'the site' : r.supervisor}` }, { label: 'Sent', value: `${String(r.submitted_at ?? '').slice(0, 16).replace('T', ' ')}${r.late ? `, ${r.late_minutes} minutes late` : ''}` }, { label: 'Flags', value: `${f.labourFlagged ?? 0} labour lines off the attendance, ${f.overWa ?? 0} lines over the WA` }, ...(r.reason ? [{ label: 'Reason for the amendment', value: r.reason }] : [])] }; },
  defaultDefinition: { name: 'Daily progress report: the construction manager or the project manager; an amendment, the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('CM', 'Construction manager or project manager', 'CM|PM', 12, { field: 'amendment', op: 'eq', value: 'no' }), approver('PM', 'Project manager (amendment)', 'PM', 24, { field: 'amendment', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => siteOf(db)?.dprDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => siteOf(db)?.dprDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => siteOf(db)?.dprDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => siteOf(db)?.dprDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(DPR_DOC, ({ db, instance }) => {
  const r = dline(db, Number(instance.docId)); if (!r) return { sections: [] }; const f = json(r.flags_json, {}); const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE dpr_id = ? AND deleted_at IS NULL`).get(r.id).n;
  const hin = db.prepare("SELECT note_text FROM site_dpr_notes WHERE dpr_id = ? AND note_type IN ('HINDRANCE', 'SAFETY') AND deleted_at IS NULL ORDER BY id LIMIT 5").all(r.id);
  const lab = db.prepare('SELECT SUM(man_days) AS md, SUM(att_man_days) AS am FROM site_dpr_labour WHERE dpr_id = ? AND deleted_at IS NULL').get(r.id);
  return { sections: [{ code: 'site-dpr-checks', title: 'Before you approve the report', kind: 'metrics', items: [
    { label: 'Sent', value: r.submitted_at ? `${String(r.submitted_at).slice(0, 16).replace('T', ' ')} UTC (${r.submitted_via === 'OFFLINE' ? 'from a phone offline' : 'online'})` : '—', format: 'text', tone: r.late ? 'warn' : undefined },
    { label: 'Cut-off', value: r.late ? `${r.late_minutes} minutes late` : 'in time', format: 'text', tone: r.late ? 'warn' : undefined },
    { label: 'Work lines', value: n('site_dpr_work'), format: 'number' }, { label: 'Lines over the quantity of the work authorisation', value: f.overWa ?? 0, format: 'number', tone: (f.overWa ?? 0) > 0 ? 'bad' : undefined },
    { label: 'Man-days reported / attendance', value: `${(lab.md ?? 0) / 1000} / ${(lab.am ?? 0) / 1000}`, format: 'text', tone: (f.labourFlagged ?? 0) > 0 ? 'warn' : undefined }, { label: 'Labour lines off the attendance', value: f.labourFlagged ?? 0, format: 'number', tone: (f.labourFlagged ?? 0) > 0 ? 'warn' : undefined },
    { label: 'Attendance not in the report', value: f.labourUnreported ?? 0, format: 'number', tone: (f.labourUnreported ?? 0) > 0 ? 'warn' : undefined }, { label: 'Lines adjusted from what the day offered', value: f.adjusted ?? 0, format: 'number' },
    { label: 'Hindrances and safety notes', value: hin.map((x) => x.note_text).join(' | ') || 'none', format: 'text', tone: hin.length ? 'warn' : undefined }] }] };
});
objectTypes.register({
  type: 'site_dpr', label: 'Daily progress report', permission: 'site.dpr.view', route: (id) => `/site/dprs?id=${id}`, attachmentEntity: 'site_dpr', approvalTarget: 'site_dpr',
  access(db, actor, id) { const s = siteOf(db); if (!s) return null; try { const r = s.dpr.dprs.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'site_dprs', id }],
  summary(db, actor, id) { const s = siteOf(db); if (!s) return null; try { const r = s.dpr.dprs.get(actor, Number(id)); return { label: `${r.docNo} ${r.siteCode} ${r.dprDate}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = siteOf(db); if (!s) return []; try { const r = s.dpr.dprs.get(actor, Number(id)); return [...r.work.map((w) => ({ kind: 'work authorisation', label: `${w.waNo} ${w.activity}`, to: `/site/work-authorisations?id=${w.waId}`, direction: 'in' })), ...(r.previous ? [{ kind: 'daily progress report', label: `${r.previous.docNo} (the report it amends)`, to: `/site/dprs?id=${r.previous.id}`, direction: 'in' }] : [])]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'site.dpr.view').allowed) return []; return db.prepare('SELECT id, org_project_id, dpr_site_id FROM site_dprs WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `${q}%`, limit).filter((x) => authzOf(db).check(actor, 'site.dpr.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.dpr_site_id }).allowed).map((x) => ({ id: x.id })); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM site_dprs WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'site_dpr', label: 'Daily progress report (photographs, the signed sheet, instructions received)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, dpr_site_id, status FROM site_dprs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.dpr_site_id }).allowed; if (!at('site.dpr.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.dpr_site_id, canView: true, canEdit: at('site.dpr.edit') && ['DRAFT', 'RETURNED'].includes(r.status), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});

// ---- the offline engine (04.15): the DPR is a form of the phone; its photos follow the command and are attached to the report it made ------------------------------------------------------------------
const dprIssues = (values) => { try { const rest = { ...values }; delete rest.submit; parseDprCreate(rest); return []; } catch (e) { return (e?.details ?? [{ field: 'form', message: e?.message ?? 'The report is not valid.' }]).map((d) => ({ field: d.field, message: `${d.field}: ${d.message}` })); } };
registerOfflineForm({
  code: 'dpr', label: 'Daily progress report', labelHi: 'दैनिक प्रगति रिपोर्ट', module: '14.02', route: '/site/dpr-entry', permission: 'site.dpr.create', attachmentEntity: 'site_dpr',
  fields: [{ key: 'siteId', label: 'Site', labelHi: 'साइट', type: 'site', required: true }, { key: 'dprDate', label: 'Date', labelHi: 'तारीख', type: 'text', required: true }],
  rules: () => ({}),
  validate: (values, _rules, op) => (op === 'update' ? [] : dprIssues(values)),
  create: (db, actor, values, ctx) => siteOf(db).dpr.offline.create(actor, values, ctx),
  load: (db, actor, id) => siteOf(db)?.dpr.offline.load(actor, id) ?? null,
  update: (db, actor, id, changes, ctx) => siteOf(db).dpr.offline.update(actor, id, changes, ctx),
});
registerOfflineMaster({ code: 'dpr_prefill', label: 'What today and yesterday offer a daily progress report', permission: 'site.dpr.create', rows: (db, actor) => ({ rows: siteOf(db)?.dpr.offline.masterRows(actor) ?? [], removed: [] }) });
registerOfflineMaster({
  code: 'dpr_contractors', label: 'Contractors with workers', permission: 'site.dpr.create',
  rows: (db, actor) => ({ rows: db.prepare('SELECT DISTINCT p.id, p.legal_name AS name FROM mdm_partners p JOIN lab_workers w ON w.contractor_id = p.id WHERE p.company_id = ? AND w.deleted_at IS NULL ORDER BY p.legal_name LIMIT 500').all(actor.companyId), removed: [] }),
});
registerOfflineMaster({
  code: 'dpr_items', label: 'Materials', permission: 'site.dpr.create',
  rows: (db, actor) => ({ rows: db.prepare("SELECT id, code, name, base_uom AS uom FROM mdm_items WHERE company_id = ? AND item_type = 'MATERIAL' AND deleted_at IS NULL AND item_status = 'ACTIVE' ORDER BY code LIMIT 2000").all(actor.companyId), removed: [] }),
});
widgetRegistry.register({
  code: 'site.dpr_compliance',
  provider: (ctx) => {
    const w = siteOf(ctx.db)?.dprReports.widget(ctx.actor) ?? { value: 100, expected: 0, missing: 0, bySite: 0 };
    return { value: w.value, unit: '% on time', previous: null, trendPct: null, target: 90, status: w.expected === 0 ? 'neutral' : w.value >= 90 ? 'green' : w.value >= 70 ? 'amber' : 'red', note: w.missing ? `${w.missing} site days with no report${w.bySite ? ` at ${w.bySite} sites` : ''} in the last 14 days.` : 'Every site day of the last 14 days has its report.', drill: '/site/dpr-compliance' };
  },
});

// ---- the approval of a hindrance (part 14.03): the site engineer raises it, the construction manager and then the project manager approve it; whoever raised it never decides it. ------------------------
const hline = (db, id) => db.prepare('SELECT x.*, p.code, s.code AS scode FROM site_hindrances x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.hin_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: HIN_DOC, label: 'Hindrance', processOwner: 'PM', route: (id) => `/site/hindrances?id=${id}`,
  describe(db, companyId, id) { const r = hline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}/${r.scode}: ${r.title}${r.parent_hindrance_id ? ' (amendment)' : ''}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.hin_site_id } : null; },
  summarise(db, _actor, id) { const r = hline(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Site', value: `${r.code} / ${r.scode}` }, { label: 'Hindrance', value: r.title }, { label: 'Type', value: String(r.hin_type).replace(/_/g, ' ').toLowerCase() }, { label: 'Responsible', value: `${String(r.responsible_party).replace(/_/g, ' ').toLowerCase()}${r.responsible_name ? ` (${r.responsible_name})` : ''}` }, { label: 'Since', value: r.start_date }, ...(r.reason ? [{ label: 'Reason for the amendment', value: r.reason }] : [])] }; },
  defaultDefinition: { name: 'Hindrance: the construction manager, then the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('CM', 'Construction manager', 'CM', 12), approver('PM', 'Project manager', 'PM', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => siteOf(db)?.hindranceDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => siteOf(db)?.hindranceDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => siteOf(db)?.hindranceDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => siteOf(db)?.hindranceDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(HIN_DOC, ({ db, instance }) => {
  const r = hline(db, Number(instance.docId)); if (!r) return { sections: [] };
  const files = db.prepare("SELECT COUNT(*) AS n FROM core_files WHERE company_id = ? AND linked_entity = 'site_hindrance' AND linked_id = ? AND deleted_at IS NULL").get(r.company_id, r.id).n;
  const letter = r.letter_id ? db.prepare('SELECT letter_no, subject FROM engg_letters WHERE id = ?').get(r.letter_id) : null; const aff = json(r.affected_json, {});
  return { sections: [{ code: 'site-hindrance-checks', title: 'Before you approve the hindrance (it becomes evidence for delays and claims)', kind: 'metrics', items: [
    { label: 'Open since', value: `${r.start_date}${r.end_date ? ` to ${r.end_date}` : ''}`, format: 'text' }, { label: 'Notified by letter', value: letter ? `${letter.letter_no} ${letter.subject}` : 'no letter linked', format: 'text', tone: letter ? undefined : 'warn' },
    { label: 'Evidence files', value: files, format: 'number', tone: files ? undefined : 'warn' }, { label: 'Activities affected', value: (aff.activities ?? []).map((a) => a.code).join(', ') || 'none named', format: 'text', tone: (aff.activities ?? []).length ? undefined : 'warn' },
    { label: 'Locations affected', value: (aff.locations ?? []).map((a) => a.code).join(', ') || 'none named', format: 'text' }] }] };
});
objectTypes.register({
  type: 'site_hindrance', label: 'Hindrance', permission: 'site.hindrance.view', route: (id) => `/site/hindrances?id=${id}`, attachmentEntity: 'site_hindrance', approvalTarget: 'site_hindrance',
  access(db, actor, id) { const s = siteOf(db); if (!s) return null; try { const r = s.conditions.hindrances.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'site_hindrances', id }],
  summary(db, actor, id) { const s = siteOf(db); if (!s) return null; try { const r = s.conditions.hindrances.get(actor, Number(id)); return { label: `${r.docNo} ${r.siteCode}: ${r.title}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = siteOf(db); if (!s) return []; try { const r = s.conditions.hindrances.get(actor, Number(id)); return [...(r.delay ? [{ kind: 'delay', label: `${r.delay.docNo} (${r.delay.status})`, to: `/plan/delays?id=${r.delay.id}`, direction: 'out' }] : []), ...(r.evidence.letter ? [{ kind: 'letter', label: `${r.evidence.letter.letterNo} ${r.evidence.letter.subject}`, to: `/engg/letters?id=${r.evidence.letter.id}`, direction: 'in' }] : []), ...r.dprs.map((d) => ({ kind: 'daily progress report', label: d.docNo, to: `/site/dprs?id=${d.id}`, direction: 'out' })), ...(r.previous ? [{ kind: 'hindrance', label: `${r.previous.docNo} (the revision it replaces)`, to: `/site/hindrances?id=${r.previous.id}`, direction: 'in' }] : [])]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'site.hindrance.view').allowed) return []; return db.prepare('SELECT id, org_project_id, hin_site_id FROM site_hindrances WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `${q}%`, limit).filter((x) => authzOf(db).check(actor, 'site.hindrance.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.hin_site_id }).allowed).map((x) => ({ id: x.id })); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM site_hindrances WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'site_hindrance', label: 'Hindrance (letters, photographs, minutes: the evidence)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, hin_site_id, status FROM site_hindrances WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.hin_site_id }).allowed; if (!at('site.hindrance.view')) return null;
    // evidence may be added to an open hindrance up to its closure (BR-01); a closed, rejected or cancelled one is sealed
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.hin_site_id, canView: true, canEdit: (at('site.hindrance.edit') || at('site.hindrance.close')) && ['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status), locked: !['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status) };
  },
});
fileEntities.register({
  entity: 'site_diary', label: 'Site diary entry (photographs, the signed note)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, dy_site_id, signed_at FROM site_diary WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.dy_site_id }).allowed; if (!at('site.diary.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.dy_site_id, canView: true, canEdit: at('site.diary.edit') && !r.signed_at, locked: Boolean(r.signed_at) };
  },
});
