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
import { createFlagService } from '../core/api.js';
import { DAILY_STATUS, FRONT_STATUS, WA_DOC, WA_STATUS, createSiteService } from './service.js';
import { siteRoutes } from './routes.js';

const services = new WeakMap();
export const siteOf = (db) => services.get(db) ?? null;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['site.wa.approved', 'A work authorisation was approved by the construction manager (and the project manager when it is outside the plan), or an emergency WA was raised and may be worked at once (part 14.01): data { waId, waNo, projectId, siteId, workFrontId, planDate, startTime, endTime, activityId, wbsId, locationId, plannedQty, uom, supervisor, emergency, resources: [{ type, key, itemId, trade, crewId, headcount, label, uom, qty }] }. For material issue (16.04), plant allocation (17.03), attendance validation (07.05) and the DPR (14.02); the WAs live on a site for a day are also read at GET /api/v1/site/work-authorisations/active.'],
  ['site.wa.closed', 'A work authorisation was closed with the quantity done and what each resource used (part 14.01): data { waId, waNo, projectId, siteId, planDate, activityId, plannedQty, actualQty, uom, resources: [{ type, key, label, uom, planned, actual }], varianceReason }. For progress (14.05).'],
  ['site.daily_plan.issued', 'A daily work plan of a site and a supervisor was issued and its lines raised as work authorisations in draft (part 14.01): data { planId, docNo, projectId, siteId, planDate, supervisor, waIds }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'site', description });

integrityRegistry.register({
  statuses: { site_work_authorisations: Object.keys(WA_STATUS), site_work_fronts: Object.keys(FRONT_STATUS), site_daily_plans: Object.keys(DAILY_STATUS) },
  uniqueKeys: [{ table: 'site_work_authorisations', columns: ['company_id', 'wa_no'] }, { table: 'site_daily_plans', columns: ['company_id', 'doc_no'] }],
});

/** Module "site": site execution and progress control (M14). Part 14.01 holds work fronts, daily work plans and work authorisations ("no plan, no work"). The tables are `site_*`. */
export const site = {
  code: 'site',
  name: 'Site Execution & Progress',
  routePrefix: '/api/v1/site',
  ownerPart: '14.01',
  status: 'Work fronts of a site with their activities, status and open constraints; daily work plans of a site and a supervisor from the approved weekly plans (13.04) or copied from the day before; work authorisations (WA) with activity, WBS, location, quantity, crews, materials and plant from the norms, the budget line (12.03), the drawing revision (11.01), the permit and hold points, the time window and the supervisor, approved by the construction manager and by the project manager when outside the plan; emergency WAs regularised within 24 hours; closure with the quantity done and the reconciliation of what was used; the uses of attendance, stores, plant, DPR and measurement booked against a WA (CP-SITE-02).',
  tables: ['site_work_fronts', 'site_daily_plans', 'site_daily_plan_lines', 'site_work_authorisations', 'site_wa_resources', 'site_wa_uses'],
  resources: ['sites', 'board', 'wa-mobile', 'work-fronts', 'work-authorisations', 'daily-plans', 'wa-uses'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'site_work_authorisations'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const svc = createSiteService({ db }); services.set(db, svc);
    listExports.register('site.work_authorisations', { source: (actor, req) => svc.was.exportSource(actor, req), hidden: () => [] });
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.site.p1401') ? next() : next(notFound('Work authorisation is not enabled for your company yet (feature flag ff.site.p1401 is OFF).'))));
    router.use(siteRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
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
