import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv, toPdf, toXlsx } from '../../platform/export/index.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { isoOf, ordOf } from '../plan/cpm.js';

// Productivity tracking and analysis (part 14.06).
// - Actual productivity (FR-02, BR-01): each work line of an approved DPR is output over the man-days and machine-hours allocated to it. A crew's man-days that serve several activities of a day are shared by the planned
//   man-days of each work authorisation (the crews and headcount it names), else by the man-days the norm asks for, else by quantity; the equipment hours go to the work authorisations that name that plant.
// - Norms (FR-01): the output per man-day or machine-hour of an activity, from the BOQ resource norms (10.04) or entered by planning and approved (maker-checker, PM). A row more than `site.productivity.outlier_factor` times its norm is
//   flagged for a data check and left out of the figures.
// - Losses (FR-03): the man-days a work line fell short of its norm are put to a reason: recorded by the site with a code, else read from the DPR (breakdown, idle plant), the weather (14.03) and the drawings hindrance (14.03).
// - Alerts (FR-05): an activity of a site below `site.productivity.alert_pct` of its norm on each of its last `site.productivity.alert_days` days.
export const NORM_DOC = 'SITE_PROD_NORM';
export const NORM_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const LOSS_REASONS = { IDLE: 'Idle time', REWORK: 'Rework', WEATHER: 'Weather', MATERIAL_SHORTAGE: 'Material shortage', DRAWING_DELAY: 'Drawing delay', BREAKDOWN: 'Breakdown', OTHER: 'Other', UNEXPLAINED: 'Not explained' };
export const RESOURCES = { LABOUR: 'Labour (output per man-day)', EQUIPMENT: 'Equipment (output per machine-hour)' };
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const d3 = (n) => (n == null ? null : n / 1000);
const q3 = (n) => Math.round(Number(n) * 1000);
const sd = (n) => (n == null ? null : String(Math.round(n * 1000) / 1000));
const pc = (n) => (n == null ? null : Math.round(n) / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

for (const [key, dataType, def, description, extra] of [
  ['site.productivity.alert_pct', 'integer', 80, 'FR-05: the percent of its norm below which the productivity of an activity of a site counts as low.', { min: 10, max: 100 }],
  ['site.productivity.alert_days', 'integer', 3, 'FR-05: the number of working days in a row an activity of a site must be below the threshold for an alert.', { min: 1, max: 30 }],
  ['site.productivity.outlier_factor', 'integer', 3, 'BR-01: a productivity above this many times its norm is flagged for a data check and left out of the figures.', { min: 2, max: 20 }],
  ['site.productivity.hours_per_day', 'integer', 8, 'FR-01: the working hours of a man-day, to turn a BOQ labour norm given in hours into man-days.', { min: 1, max: 24 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const actualList = defineList({
  code: 'site.productivity', label: 'Productivity records', permission: 'site.productivity.view', from: 'prod_actuals x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.prod_site_id JOIN site_dprs d ON d.id = x.dpr_id LEFT JOIN hr_crews c ON c.id = x.crew_id LEFT JOIN mdm_partners k ON k.id = x.contractor_id', where: 'x.deleted_at IS NULL', searchable: ['x.activity_code', 'x.work_type', 'p.code', 's.code', 'd.doc_no'], defaultSort: '-date',
  columns: {
    date: { sql: 'x.work_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.prod_site_id', type: 'number', label: 'Site id' },
    activity: { sql: 'x.activity_code', type: 'text', label: 'Activity' }, workType: { sql: 'x.work_type', type: 'text', label: 'Work type' }, crew: { sql: 'c.name', type: 'text', label: 'Crew' }, contractor: { sql: 'k.legal_name', type: 'text', label: 'Contractor' }, dpr: { sql: 'd.doc_no', type: 'text', label: 'DPR' },
    qty: { sql: 'x.qty', type: 'text', label: 'Quantity' }, manDays: { sql: 'x.man_days', type: 'text', label: 'Man-days' }, productivity: { sql: 'x.productivity', type: 'text', label: 'Output per man-day' }, variance: { sql: 'x.variance_pct', type: 'text', label: 'Variance %' },
    lostMd: { sql: 'x.shortfall_md', type: 'text', label: 'Man-days lost' }, reason: { sql: 'COALESCE(x.loss_reason, x.derived_reason)', type: 'enum', label: 'Loss reason', options: Object.entries(LOSS_REASONS).filter(([k]) => k !== 'UNEXPLAINED') },
    outlier: { sql: "CASE WHEN x.outlier = 1 THEN '1' ELSE '0' END", type: 'enum', label: 'Data check', options: [['1', 'Check the data'], ['0', 'Counted']] },
  },
});
export const normList = defineList({
  code: 'site.prod_norms', label: 'Productivity norms', permission: 'site.productivity.view', from: 'prod_norms x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.activity_code', 'x.work_type', 'p.code'], defaultSort: '-effectiveFrom',
  columns: {
    project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, activity: { sql: 'x.activity_code', type: 'text', label: 'Activity' }, workType: { sql: 'x.work_type', type: 'text', label: 'Work type' },
    resource: { sql: 'x.resource_type', type: 'enum', label: 'Resource', options: Object.entries(RESOURCES) }, output: { sql: 'x.output_per_unit', type: 'text', label: 'Output per unit' }, source: { sql: 'x.source', type: 'enum', label: 'Source', options: [['BOQ', 'BOQ norms'], ['MANUAL', 'Entered']] },
    effectiveFrom: { sql: 'x.effective_from', type: 'date', label: 'Effective from' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(NORM_STATUS) },
  },
});

export function createProductivityService({ db }) {
  const authz = authzOf(db);
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const may = (actor, key, pid, sid = null) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid, siteId: sid }).allowed;
  const need = (actor, key, what, pid, sid = null) => { if (!may(actor, key, pid, sid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, recipients, ref, subject, detail, link, sourceId, scope = {}) => { if (!recipients.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients, data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId, ...scope }); } catch { /* saved anyway */ } };
  const project = (actor, projectId, key = 'site.productivity.view') => {
    const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(projectId));
    if (!p || p.company_id !== actor.companyId || !may(actor, 'site.productivity.view', p.id)) throw notFound('That project does not exist.'); if (key !== 'site.productivity.view') need(actor, key, 'do that for this project', p.id); return p;
  };
  const siteRow = (actor, siteId, key = 'site.productivity.view') => {
    const s = db.prepare('SELECT s.id, s.code, s.name, s.org_project_id, s.company_id FROM org_sites s WHERE s.id = ? AND s.deleted_at IS NULL').get(rid(siteId));
    if (!s || s.company_id !== actor.companyId || !may(actor, 'site.productivity.view', s.org_project_id, s.id)) throw notFound('That site does not exist.'); if (key !== 'site.productivity.view') need(actor, key, 'do that for this site', s.org_project_id, s.id); return s;
  };
  const scope = (actor, alias = 'x', site = 'prod_site_id') => { const f = authz.scopeFilter(actor, 'site.productivity.view', { project: `${alias}.org_project_id`, site: `${alias}.${site}` }); return { sql: `${alias}.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };

  // ---- norms (FR-01) ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The work type of an activity, for the benchmarks: the work item of its BOQ line (10.04) when it has one, else its unit of measure. */
  function workTypeOf(activityId, uom) {
    const w = activityId ? db.prepare('SELECT i.code FROM plan_activity_boq b JOIN proj_boq_lines l ON l.id = b.boq_line_id JOIN mdm_items i ON i.id = l.work_item_id WHERE b.activity_id = ? AND b.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY b.qty DESC LIMIT 1').get(activityId) : null;
    return w?.code ?? `UOM:${lower(uom || 'nos')}`;
  }
  const currentActivity = (companyId, projectId, code) => db.prepare("SELECT a.id, a.code, a.name, a.uom FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.org_project_id = ? AND s.company_id = ? AND s.deleted_at IS NULL AND a.code = ? COLLATE NOCASE AND a.deleted_at IS NULL ORDER BY (s.status = 'APPROVED') DESC, s.version_no DESC LIMIT 1").get(projectId, companyId, code);
  /** The norm in force for an activity on a day: an approved entered norm before the BOQ one, the latest effective. Output in thousandths. */
  function normOf(projectId, code, resource, date) {
    const r = db.prepare("SELECT output_per_unit FROM prod_norms WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND resource_type = ? AND status = 'APPROVED' AND effective_from <= ? AND deleted_at IS NULL ORDER BY (source = 'MANUAL') DESC, effective_from DESC, id DESC LIMIT 1").get(projectId, code, resource, date);
    return r?.output_per_unit ?? null;
  }
  /** FR-01: the norms of the BOQ resource lines (labour in man-days or hours a unit, equipment in hours a unit) of the lines an activity is linked to, as output per man-day and per machine-hour. */
  function boqNorms(companyId, projectId) {
    const hpd = Number(param(companyId, 'site.productivity.hours_per_day') ?? 8); const out = [];
    const acts = db.prepare("SELECT a.id, a.code, a.uom FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.org_project_id = ? AND s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'APPROVED' AND a.deleted_at IS NULL").all(projectId, companyId);
    for (const a of acts) {
      const links = db.prepare('SELECT boq_line_id, qty FROM plan_activity_boq WHERE activity_id = ? AND deleted_at IS NULL').all(a.id); if (!links.length) continue;
      for (const [type, norm] of [['LABOUR', 'LABOUR'], ['EQUIPMENT', 'EQUIPMENT']]) {
        let units = 0; let per = 0;
        for (const l of links) for (const n of db.prepare('SELECT uom, qty_per_unit FROM proj_boq_line_norms WHERE line_id = ? AND norm_type = ? AND deleted_at IS NULL').all(l.boq_line_id, norm)) {
          const hours = /hour|hr/i.test(n.uom); const perUnit = type === 'LABOUR' ? (hours ? n.qty_per_unit / hpd : n.qty_per_unit) : (hours || !/day/i.test(n.uom) ? n.qty_per_unit : n.qty_per_unit * hpd); // man-days (or machine-hours) of the resource a unit
          per += (l.qty || 1) * perUnit; units += l.qty || 1;
        }
        if (per > 0 && units > 0) out.push({ activity: a, resource: type, output: Math.round((1000 * units * 1000) / per) });
      }
    }
    return out;
  }
  const nview = (actor, r) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const own = same(r.requested_by, actor.user);
    return { id: r.id, projectId: r.org_project_id, projectCode: p?.code, activityCode: r.activity_code, workType: r.work_type, resourceType: r.resource_type, resourceLabel: RESOURCES[r.resource_type], outputPerUnit: d3(r.output_per_unit), uom: r.uom, perLabel: r.resource_type === 'LABOUR' ? 'man-day' : 'machine-hour', source: r.source, effectiveFrom: r.effective_from, note: r.note,
      status: r.status, statusLabel: NORM_STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('site.productivity.configure') && r.source === 'MANUAL' && ['DRAFT', 'RETURNED'].includes(r.status), submit: can('site.productivity.submit') && r.source === 'MANUAL' && ['DRAFT', 'RETURNED'].includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: can('site.productivity.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('site.productivity.configure') && r.status === 'DRAFT' && !r.workflow_instance_id, approve: can('site.productivity.approve') && r.status === 'SUBMITTED' && !own } };
  };
  const nrow = (actor, id, key = 'site.productivity.view') => {
    const r = db.prepare('SELECT * FROM prod_norms WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.productivity.view', r.org_project_id)) throw notFound('That productivity norm does not exist.'); if (key !== 'site.productivity.view') need(actor, key, 'do that with a productivity norm', r.org_project_id); return r;
  };
  const nscope = (actor) => { const f = authz.scopeFilter(actor, 'site.productivity.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const NSELECT = 'x.id, x.org_project_id, x.activity_code, x.work_type, x.resource_type, x.output_per_unit, x.uom, x.source, x.effective_from, x.status, p.code AS pcode';
  const nlist = (x) => ({ id: x.id, project: x.pcode, projectId: x.org_project_id, activity: x.activity_code, workType: x.work_type, resource: x.resource_type, resourceLabel: RESOURCES[x.resource_type], output: sd(d3(x.output_per_unit)), uom: x.uom, source: x.source === 'BOQ' ? 'BOQ norms' : 'Entered', effectiveFrom: x.effective_from, status: x.status, statusLabel: NORM_STATUS[x.status] });
  const norms = {
    list(actor, query) { if (!authz.check(actor, 'site.productivity.view').allowed) throw forbidden('You may not see productivity norms (permission site.productivity.view).'); const sc = nscope(actor); return runList(db, normList, parseListRequest(normList, query), { select: NSELECT, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: nlist }); },
    get: (actor, id) => { const v = nview(actor, nrow(actor, id)); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    create(actor, b) {
      const p = project(actor, b.projectId, 'site.productivity.configure'); const a = currentActivity(actor.companyId, p.id, b.activityCode); if (!a) fail([{ field: 'activityCode', message: 'Not an activity of the schedule of this project' }]);
      if (db.prepare("SELECT 1 FROM prod_norms WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND resource_type = ? AND source = 'MANUAL' AND effective_from = ? AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED') AND deleted_at IS NULL").get(p.id, a.code, b.resourceType, b.effectiveFrom)) throw conflict('A norm of this activity and resource is already entered from that date: change it, or give a later date.');
      return transaction(db, () => { const id = Number(db.prepare("INSERT INTO prod_norms (company_id, org_project_id, activity_code, work_type, resource_type, output_per_unit, uom, source, effective_from, status, note, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, 'DRAFT', ?, ?, ?, ?, 'api')").run(actor.companyId, p.id, a.code, workTypeOf(a.id, a.uom), b.resourceType, q3(b.outputPerUnit), a.uom, b.effectiveFrom, b.note ?? null, actor.user, p.id, actor.user).lastInsertRowid); audit(actor, 'prod_norms', id, 'create', actor.companyId, { newValues: { activity: a.code, resource: b.resourceType, output: b.outputPerUnit } }); return norms.get(actor, id); });
    },
    update(actor, id, b) {
      const r = nrow(actor, id, 'site.productivity.configure'); if (r.source !== 'MANUAL' || !['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(r.status === 'APPROVED' ? 'An approved norm is locked: enter a new one from a later date.' : `${lower(NORM_STATUS[r.status])}: the norm is not changed now.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this norm; reload it.');
      return transaction(db, () => { db.prepare('UPDATE prod_norms SET output_per_unit = ?, effective_from = ?, note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('outputPerUnit' in b ? q3(b.outputPerUnit) : r.output_per_unit, b.effectiveFrom ?? r.effective_from, 'note' in b ? b.note : r.note, actor.user, nowIso(), r.id); const ch = { ...b }; delete ch.rowVersion; audit(actor, 'prod_norms', r.id, 'update', r.company_id, { oldValues: { output: d3(r.output_per_unit), from: r.effective_from }, newValues: ch }); return norms.get(actor, r.id); });
    },
    remove(actor, id) { const r = nrow(actor, id, 'site.productivity.configure'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { db.prepare('UPDATE prod_norms SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'prod_norms', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = nrow(actor, id, 'site.productivity.submit'); if (r.source !== 'MANUAL' || !['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only an entered norm that is a draft or returned is sent for approval.');
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, resource: r.resource_type };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: NORM_DOC, docId: String(r.id), comment: `${r.activity_code} ${r.resource_type.toLowerCase()} norm from ${r.effective_from}`.slice(0, 300), context: ctx }); db.prepare('UPDATE prod_norms SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE prod_norms SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'prod_norms', r.id, 'submit', r.company_id); return norms.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = nrow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a norm waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return norms.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = nrow(actor, id, 'site.productivity.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a norm that is not approved is cancelled.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE prod_norms SET status = 'CANCELLED', note = COALESCE(note, ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'prod_norms', r.id, 'cancel', r.company_id, { reason }); return norms.get(actor, r.id); });
    },
    history(actor, id) { const r = nrow(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'prod_norms' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    /** FR-01: the norms the BOQ gives, as approved norms from today (the BOQ was approved in 10.04); one that changed supersedes the one before. The records are then scored again. */
    refreshBoq(actor, { projectId }) {
      const p = project(actor, projectId, 'site.productivity.configure'); const found = boqNorms(actor.companyId, p.id); const today = todayIST(); let made = 0; let kept = 0;
      transaction(db, () => {
        for (const n of found) {
          const cur = db.prepare("SELECT id, output_per_unit FROM prod_norms WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND resource_type = ? AND source = 'BOQ' AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY effective_from DESC, id DESC LIMIT 1").get(p.id, n.activity.code, n.resource);
          if (cur && cur.output_per_unit === n.output) { kept += 1; continue; }
          if (cur) db.prepare("UPDATE prod_norms SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), cur.id);
          db.prepare("DELETE FROM prod_norms WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND resource_type = ? AND source = 'BOQ' AND effective_from = ? AND status = 'SUPERSEDED'").run(p.id, n.activity.code, n.resource, today);
          db.prepare("INSERT INTO prod_norms (company_id, org_project_id, activity_code, work_type, resource_type, output_per_unit, uom, source, effective_from, status, requested_by, approved_by, approved_at, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'BOQ', ?, 'APPROVED', ?, 'boq', ?, ?, ?, 'proj_boq_line_norms', ?)").run(actor.companyId, p.id, n.activity.code, workTypeOf(n.activity.id, n.activity.uom), n.resource, n.output, n.activity.uom, today, actor.user, nowIso(), p.id, actor.user, String(n.activity.id)); made += 1;
        }
        rescore(actor.companyId, p.id); audit(actor, 'prod_norms', String(p.id), 'refresh_boq', actor.companyId, { newValues: { made, kept } });
      });
      return { projectId: p.id, made, kept, found: found.length };
    },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM prod_norms WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE prod_norms SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND resource_type = ? AND source = 'MANUAL' AND status = 'APPROVED' AND effective_from <= ? AND id <> ? AND deleted_at IS NULL").run(actor.user, now, r.org_project_id, r.activity_code, r.resource_type, r.effective_from, r.id);
        db.prepare("UPDATE prod_norms SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); rescore(r.company_id, r.org_project_id); audit(actor, 'prod_norms', r.id, 'approve', r.company_id);
        notify(r.company_id, 'site.productivity.norm_approved', [`user:${r.requested_by}`], r.activity_code, `${r.resource_type.toLowerCase()} norm`, `The ${r.resource_type.toLowerCase()} norm of ${r.activity_code} (${d3(r.output_per_unit)} a ${r.resource_type === 'LABOUR' ? 'man-day' : 'machine-hour'}) is approved from ${r.effective_from}; the productivity records are scored against it.`, `/site/productivity-norms?id=${r.id}`, r.id); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE prod_norms SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'prod_norms', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'site.productivity.norm_rejected', [`user:${r.requested_by}`], r.activity_code, `${r.resource_type.toLowerCase()} norm`, `The norm of ${r.activity_code} was not approved${comment ? `: ${comment}` : ''}.`, `/site/productivity-norms?id=${r.id}`, r.id);
    },
  };

  // ---- the productivity of the approved DPRs (FR-02, FR-03, BR-01) ------------------------------------------------------------------------------------------------------------------
  const manualLosses = (projectId, siteId, date) => db.prepare('SELECT activity_code, reason_code, hours_lost FROM prod_losses WHERE loss_site_id = ? AND loss_date = ? AND deleted_at IS NULL').all(siteId, date);
  /** The reason a shortfall is put to: the biggest loss the site recorded for the activity that day, else for the site that day. */
  function manualReason(losses, code) {
    const pick = (list) => { const m = new Map(); for (const l of list) m.set(l.reason_code, (m.get(l.reason_code) ?? 0) + l.hours_lost); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
    return pick(losses.filter((l) => l.activity_code && lower(l.activity_code) === lower(code))) ?? pick(losses.filter((l) => !l.activity_code));
  }
  /** What the day itself says about a loss: plant broken down, plant idle, the weather record of the site, a drawings hindrance. */
  function derivedReason(companyId, siteId, date, equipment, weatherCode) {
    if ((equipment ?? []).some((e) => (e.hoursBreakdown ?? 0) > 0)) return 'BREAKDOWN';
    const w = db.prepare('SELECT shutdown, hours_lost FROM site_weather WHERE wx_site_id = ? AND wx_date = ? AND company_id = ? AND deleted_at IS NULL').get(siteId, date, companyId); if ((w && (w.shutdown || w.hours_lost > 0)) || ['HEAVY_RAIN', 'STORM'].includes(weatherCode)) return 'WEATHER';
    if (db.prepare("SELECT 1 FROM site_hindrances WHERE hin_site_id = ? AND company_id = ? AND hin_type = 'DRAWINGS_PENDING' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) AND status IN ('APPROVED', 'CLOSED') AND deleted_at IS NULL").get(siteId, companyId, date, date)) return 'DRAWING_DELAY';
    if ((equipment ?? []).some((e) => (e.hoursIdle ?? 0) > 0)) return 'IDLE'; return null;
  }
  /** Scores a row against its norms: productivity, variance, the man-days lost and the data check. Quantities are thousandths. */
  function score(companyId, projectId, code, date, qty, md, mh) {
    const factor = Number(param(companyId, 'site.productivity.outlier_factor') ?? 3); const nl = normOf(projectId, code, 'LABOUR', date); const ne = normOf(projectId, code, 'EQUIPMENT', date);
    const prod = md > 0 ? Math.round((qty * 1000) / md) : null; const prodM = mh > 0 ? Math.round((qty * 1000) / mh) : null;
    const outlier = (nl != null && prod != null && prod > factor * nl) || (ne != null && prodM != null && prodM > factor * ne) ? 1 : 0;
    const expected = nl != null && md > 0 ? Math.round((qty * 1000) / nl) : null; const shortfall = !outlier && expected != null ? Math.max(0, md - expected) : 0;
    return { nl, ne, prod, prodM, variance: nl != null && prod != null ? Math.round(((prod - nl) * 10000) / nl) : null, varianceM: ne != null && prodM != null ? Math.round(((prodM - ne) * 10000) / ne) : null, shortfall, outlier };
  }
  /** Scores every record of a project again (a norm was approved or refreshed); the reasons stay. */
  function rescore(companyId, projectId) {
    for (const r of db.prepare('SELECT id, activity_code, work_date, qty, man_days, machine_hours, loss_reason, derived_reason FROM prod_actuals WHERE org_project_id = ? AND deleted_at IS NULL').all(projectId)) {
      const s = score(companyId, projectId, r.activity_code, r.work_date, r.qty, r.man_days, r.machine_hours);
      db.prepare('UPDATE prod_actuals SET norm_labour = ?, norm_equipment = ?, productivity = ?, productivity_machine = ?, variance_pct = ?, machine_variance_pct = ?, shortfall_md = ?, outlier = ? WHERE id = ?').run(s.nl, s.ne, s.prod, s.prodM, s.variance, s.varianceM, s.shortfall, s.outlier, r.id);
    }
    // the alerts follow the new norms
    for (const x of db.prepare('SELECT DISTINCT prod_site_id, activity_code FROM prod_actuals WHERE org_project_id = ? AND deleted_at IS NULL').all(projectId)) alertsFor(companyId, projectId, x.prod_site_id, x.activity_code);
  }
  /** `site.dpr.approved`: the work lines of the report with the man-days and machine-hours shared among them. Idempotent: the rows of the report (and of the report it amends) are replaced. */
  function onDpr(e) {
    const d = e.data ?? {}; const companyId = Number(e.companyId ?? e.company_id); const projectId = Number(d.projectId); const siteId = Number(d.siteId); if (!companyId || !projectId || !siteId || !d.dprId || !d.date) return null;
    const now = nowIso(); const touched = new Set(); let made = 0;
    transaction(db, () => {
      const kill = (where, ...params) => { for (const r of db.prepare(`SELECT id, activity_code FROM prod_actuals WHERE company_id = ? AND deleted_at IS NULL AND ${where}`).all(companyId, ...params)) { db.prepare('UPDATE prod_actuals SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, 'system', r.id); touched.add(r.activity_code); } };
      if (d.supersedes) kill('dpr_id = ?', Number(d.supersedes)); kill('dpr_id = ?', Number(d.dprId));
      if (d.scope === 'SITE') kill("dpr_scope = 'SUPERVISOR' AND prod_site_id = ? AND work_date = ?", siteId, d.date);
      if (d.scope === 'SUPERVISOR' && db.prepare("SELECT 1 FROM prod_actuals WHERE prod_site_id = ? AND work_date = ? AND dpr_scope = 'SITE' AND deleted_at IS NULL").get(siteId, d.date)) return;
      const lines = (d.work ?? []).filter((w) => Number(w.qty) > 0).map((w) => { const act = db.prepare('SELECT id, code, uom FROM plan_activities WHERE id = ? AND company_id = ?').get(Number(w.activityId), companyId); return act ? { w, act, qty: q3(w.qty), res: db.prepare("SELECT resource_type, crew_id, res_key, planned_qty FROM site_wa_resources WHERE wa_id = ? AND deleted_at IS NULL").all(Number(w.waId)) } : null; }).filter(Boolean);
      if (!lines.length) return;
      const labourMd = (d.labour ?? []).reduce((n, l) => n + q3(l.manDays ?? 0), 0); const contractor = [...(d.labour ?? [])].filter((l) => l.category === 'CONTRACT' && l.contractorId).sort((a, b) => b.manDays - a.manDays)[0]?.contractorId ?? null;
      // the weights that share the man-days: the planned man-days of the crews of each work authorisation; else the man-days its norm asks for; else the quantity
      let basis = 'WA'; let weights = lines.map((l) => l.res.filter((r) => r.resource_type === 'LABOUR').reduce((n, r) => n + r.planned_qty, 0));
      if (weights.every((x) => x === 0)) { basis = 'NORM'; weights = lines.map((l) => { const n = normOf(projectId, l.act.code, 'LABOUR', d.date); return n ? Math.round((l.qty * 1000) / n) : 0; }); }
      if (weights.every((x) => x === 0)) { basis = 'QTY'; weights = lines.map((l) => l.qty); }
      if (weights.some((x) => x === 0) && weights.some((x) => x > 0)) weights = weights.map((x) => (x === 0 ? Math.min(...weights.filter((y) => y > 0)) : x));
      const share = (total, ws) => { const sum = ws.reduce((n, x) => n + x, 0); let left = total; return ws.map((x, i) => { const v = i === ws.length - 1 ? left : Math.floor((total * x) / (sum || 1)); left -= v; return v; }); };
      const mdShare = share(labourMd, weights); const mh = lines.map(() => 0);
      for (const eq of d.equipment ?? []) { const hrs = q3(eq.hoursWorked ?? 0); if (!hrs) continue; const key = lower(eq.key); let ws = lines.map((l) => l.res.filter((r) => r.resource_type === 'PLANT' && lower(r.res_key) === key).reduce((n, r) => n + Math.max(1, r.planned_qty), 0)); if (ws.every((x) => x === 0)) ws = weights; share(hrs, ws).forEach((v, i) => { mh[i] += v; }); }
      const losses = manualLosses(projectId, siteId, d.date); const derived = derivedReason(companyId, siteId, d.date, d.equipment, d.weather?.code);
      lines.forEach((l, i) => {
        const crew = [...l.res.filter((r) => r.resource_type === 'LABOUR' && r.crew_id)].sort((a, b) => b.planned_qty - a.planned_qty)[0]?.crew_id ?? null; const s = score(companyId, projectId, l.act.code, d.date, l.qty, mdShare[i], mh[i]);
        db.prepare("INSERT INTO prod_actuals (company_id, org_project_id, prod_site_id, work_date, activity_id, activity_code, work_type, crew_id, contractor_id, dpr_id, dpr_work_id, dpr_scope, qty, uom, man_days, machine_hours, alloc_basis, norm_labour, norm_equipment, productivity, productivity_machine, variance_pct, machine_variance_pct, shortfall_md, loss_reason, derived_reason, outlier, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'site_dpr', ?)")
          .run(companyId, projectId, siteId, d.date, l.act.id, l.act.code, workTypeOf(l.act.id, l.act.uom), crew, contractor, Number(d.dprId), l.w.waId ?? null, d.scope ?? 'SITE', l.qty, l.w.uom ?? l.act.uom, mdShare[i], mh[i], basis, s.nl, s.ne, s.prod, s.prodM, s.variance, s.varianceM, s.shortfall, s.shortfall > 0 ? manualReason(losses, l.act.code) : null, s.shortfall > 0 ? derived : null, s.outlier, projectId, siteId, String(d.dprId)); touched.add(l.act.code); made += 1;
      });
      publishEvent(db, { type: 'site.productivity.updated', entity: 'site_productivity', entityId: Number(d.dprId), actorId: 'system', companyId, projectId, siteId, data: { projectId, siteId, date: d.date, dprId: Number(d.dprId), lines: made, activities: [...touched] } });
    });
    for (const code of touched) alertsFor(companyId, projectId, siteId, code);
    return { made };
  }
  /** FR-05: an activity of a site below the threshold on each of its last N days (the days with a record, the daily output over the daily norm) raises an alert; a day back at the norm clears it. */
  function alertsFor(companyId, projectId, siteId, code) {
    const pctLimit = Number(param(companyId, 'site.productivity.alert_pct') ?? 80); const n = Number(param(companyId, 'site.productivity.alert_days') ?? 3);
    const days = db.prepare("SELECT work_date, SUM(qty) AS q, SUM(man_days) AS md, MAX(norm_labour) AS nl FROM prod_actuals WHERE prod_site_id = ? AND activity_code = ? COLLATE NOCASE AND deleted_at IS NULL AND outlier = 0 AND norm_labour IS NOT NULL AND man_days > 0 GROUP BY work_date ORDER BY work_date DESC LIMIT ?").all(siteId, code, n);
    const open = db.prepare("SELECT * FROM prod_alerts WHERE alert_site_id = ? AND activity_code = ? COLLATE NOCASE AND status = 'OPEN' AND deleted_at IS NULL").get(siteId, code); if (!days.length) return;
    const pcts = days.map((x) => Math.round((x.q * 1000 * 10000) / x.md / x.nl)); // percent of norm x 100
    if (days.length >= n && pcts.every((x) => x < pctLimit * 100)) {
      const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length); const from = days.at(-1).work_date; const to = days[0].work_date; const act = db.prepare('SELECT work_type FROM prod_actuals WHERE prod_site_id = ? AND activity_code = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1').get(siteId, code);
      if (open) { db.prepare('UPDATE prod_alerts SET from_date = ?, to_date = ?, days = ?, avg_pct = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(from, to, days.length, avg, 'system', nowIso(), open.id); return; }
      const id = Number(db.prepare("INSERT INTO prod_alerts (company_id, org_project_id, alert_site_id, activity_code, work_type, days, from_date, to_date, avg_pct, status, raised_at, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, 'system', 'prod_actuals')").run(companyId, projectId, siteId, code, act?.work_type ?? '', days.length, from, to, avg, nowIso(), projectId).lastInsertRowid);
      const site = db.prepare('SELECT code FROM org_sites WHERE id = ?').get(siteId)?.code;
      writeAudit(db, { entity: 'prod_alerts', entityId: id, action: 'raise', actor: 'system', companyId, newValues: { code, avgPct: avg / 100, days: days.length } });
      publishEvent(db, { type: 'site.productivity.low', entity: 'site_productivity', entityId: id, actorId: 'system', companyId, projectId, siteId, data: { alertId: id, projectId, siteId, activityCode: code, days: days.length, fromDate: from, toDate: to, avgPctOfNorm: avg / 100 } });
      notify(companyId, 'site.productivity.low', ['role:CM|PM|PCMGR'], `${code} · ${days.length} days`, String(site), `The productivity of ${code} at ${site} was ${avg / 100} % of its norm on each of the last ${days.length} days (${from} to ${to}).`, `/site/productivity?siteId=${siteId}`, id, { projectId, siteId });
    } else if (open && pcts[0] >= pctLimit * 100) db.prepare("UPDATE prod_alerts SET status = 'CLEARED', cleared_at = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), open.id);
  }

  // ---- the losses the site records (FR-03) -----------------------------------------------------------------------------------------------------------------------------------------
  const lview = (actor, r) => { const s = db.prepare('SELECT code FROM org_sites WHERE id = ?').get(r.loss_site_id); return { id: r.id, siteId: r.loss_site_id, siteCode: s?.code, projectId: r.org_project_id, date: r.loss_date, activityCode: r.activity_code, reasonCode: r.reason_code, reasonLabel: LOSS_REASONS[r.reason_code], hoursLost: d3(r.hours_lost), note: r.note, createdBy: r.created_by, can: { delete: may(actor, 'site.productivity.record', r.org_project_id, r.loss_site_id) } }; };
  /** A loss recorded (or taken away) puts the shortfalls of that site and day to their reason again. */
  function reason(companyId, siteId, date) {
    const losses = manualLosses(0, siteId, date);
    for (const r of db.prepare('SELECT id, activity_code, shortfall_md, derived_reason FROM prod_actuals WHERE prod_site_id = ? AND work_date = ? AND deleted_at IS NULL').all(siteId, date)) db.prepare('UPDATE prod_actuals SET loss_reason = ? WHERE id = ?').run(r.shortfall_md > 0 ? manualReason(losses, r.activity_code) : null, r.id);
    void companyId;
  }
  const losses = {
    list(actor, q) {
      if (!authz.check(actor, 'site.productivity.view').allowed) throw forbidden('You may not see productivity records (permission site.productivity.view).'); const sc = scope(actor, 'x', 'loss_site_id');
      return db.prepare(`SELECT x.* FROM prod_losses x WHERE x.deleted_at IS NULL AND ${sc.sql}${q.projectId ? ' AND x.org_project_id = :p' : ''}${q.siteId ? ' AND x.loss_site_id = :s' : ''}${q.from ? ' AND x.loss_date >= :f' : ''}${q.to ? ' AND x.loss_date <= :t' : ''} ORDER BY x.loss_date DESC, x.id DESC LIMIT 300`).all({ ...sc.params, ...(q.projectId ? { p: q.projectId } : {}), ...(q.siteId ? { s: q.siteId } : {}), ...(q.from ? { f: q.from } : {}), ...(q.to ? { t: q.to } : {}) }).map((r) => lview(actor, r));
    },
    create(actor, b) {
      const s = siteRow(actor, b.siteId, 'site.productivity.record'); if (b.date > todayIST()) fail([{ field: 'date', message: 'Use today or an earlier day' }]); if (b.activityCode && !currentActivity(actor.companyId, s.org_project_id, b.activityCode)) fail([{ field: 'activityCode', message: 'Not an activity of the schedule of this project' }]);
      return transaction(db, () => { const code = b.activityCode ? currentActivity(actor.companyId, s.org_project_id, b.activityCode).code : null; const id = Number(db.prepare("INSERT INTO prod_losses (company_id, org_project_id, loss_site_id, loss_date, activity_code, reason_code, hours_lost, note, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, s.org_project_id, s.id, b.date, code, b.reasonCode, q3(b.hoursLost), b.note ?? null, s.org_project_id, s.id, actor.user).lastInsertRowid); reason(actor.companyId, s.id, b.date); audit(actor, 'prod_losses', id, 'create', actor.companyId, { newValues: { date: b.date, reason: b.reasonCode, hours: b.hoursLost, activity: code } }); return lview(actor, db.prepare('SELECT * FROM prod_losses WHERE id = ?').get(id)); });
    },
    remove(actor, id) {
      const r = db.prepare('SELECT * FROM prod_losses WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'site.productivity.view', r.org_project_id, r.loss_site_id)) throw notFound('That loss does not exist.'); need(actor, 'site.productivity.record', 'delete a loss', r.org_project_id, r.loss_site_id);
      transaction(db, () => { db.prepare('UPDATE prod_losses SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); reason(actor.companyId, r.loss_site_id, r.loss_date); audit(actor, 'prod_losses', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true };
    },
  };

  // ---- the figures (FR-02, FR-04, section 10) ----------------------------------------------------------------------------------------------------------------------------------------
  const range = (q, days = 29) => { const to = q.to ?? todayIST(); return { from: q.from ?? isoOf(ordOf(to) - days), to }; };
  const filters = (q, params) => { let s = ''; if (q.projectId) { s += ' AND x.org_project_id = :p'; params.p = q.projectId; } if (q.siteId) { s += ' AND x.prod_site_id = :s'; params.s = q.siteId; } if (q.workType) { s += ' AND x.work_type = :w'; params.w = q.workType; } return s; };
  // the figures of a group of records: output per man-day and machine-hour, and the efficiency (the man-days the norm asks for over the man-days used, in the records that have a norm)
  const AGG = "SUM(x.qty) AS qty, SUM(x.man_days) AS md, SUM(x.machine_hours) AS mh, SUM(x.shortfall_md) AS lost, COUNT(*) AS n, SUM(CASE WHEN x.norm_labour IS NOT NULL AND x.man_days > 0 THEN x.qty * 1000.0 / x.norm_labour ELSE 0 END) AS exp_md, SUM(CASE WHEN x.norm_labour IS NOT NULL AND x.man_days > 0 THEN x.man_days ELSE 0 END) AS norm_md, SUM(CASE WHEN x.norm_equipment IS NOT NULL AND x.machine_hours > 0 THEN x.qty * 1000.0 / x.norm_equipment ELSE 0 END) AS exp_mh, SUM(CASE WHEN x.norm_equipment IS NOT NULL AND x.machine_hours > 0 THEN x.machine_hours ELSE 0 END) AS norm_mh, SUM(CASE WHEN x.variance_pct < 0 THEN 1 ELSE 0 END) AS below";
  const figs = (r) => ({ qty: d3(r.qty), manDays: d3(r.md), machineHours: d3(r.mh), outputPerMd: r.md > 0 ? Math.round((r.qty * 1000) / r.md) / 1000 : null, outputPerMh: r.mh > 0 ? Math.round((r.qty * 1000) / r.mh) / 1000 : null, efficiency: r.norm_md > 0 ? Math.round((r.exp_md * 10000) / r.norm_md) / 100 : null, machineEfficiency: r.norm_mh > 0 ? Math.round((r.exp_mh * 10000) / r.norm_mh) / 100 : null, lostManDays: d3(r.lost), records: r.n, belowNorm: r.below ?? 0 });
  const GROUPS = { ACTIVITY: ["x.activity_code", "x.activity_code"], WORK_TYPE: ['x.work_type', 'x.work_type'], CREW: ["COALESCE(c.name, '(no crew)')", "COALESCE(CAST(x.crew_id AS TEXT), '0')"], CONTRACTOR: ["COALESCE(k.legal_name, '(own staff)')", "COALESCE(CAST(x.contractor_id AS TEXT), '0')"], SITE: ['s.code', 'CAST(x.prod_site_id AS TEXT)'], WEEK: ["strftime('%Y-%m-%d', date(x.work_date, '-' || ((CAST(strftime('%w', x.work_date) AS INTEGER) + 6) % 7) || ' days'))", "strftime('%Y-%m-%d', date(x.work_date, '-' || ((CAST(strftime('%w', x.work_date) AS INTEGER) + 6) % 7) || ' days'))"] };
  const FROM = 'prod_actuals x JOIN org_sites s ON s.id = x.prod_site_id LEFT JOIN hr_crews c ON c.id = x.crew_id LEFT JOIN mdm_partners k ON k.id = x.contractor_id';
  function grouped(actor, q, by, { limit = 200 } = {}) {
    const sc = scope(actor); const { from, to } = range(q); const params = { ...sc.params, f: from, t: to }; const f = filters(q, params); const [label, key] = GROUPS[by];
    return db.prepare(`SELECT ${label} AS label, ${key} AS gkey, MAX(x.uom) AS uom, MAX(x.work_type) AS wtype, ${AGG} FROM ${FROM} WHERE x.deleted_at IS NULL AND x.outlier = 0 AND x.work_date BETWEEN :f AND :t AND ${sc.sql}${f} GROUP BY ${key}, ${label} ORDER BY ${by === 'WEEK' ? 'label' : 'lost DESC'} LIMIT ${limit}`).all(params).map((r) => ({ key: r.gkey, label: r.label, uom: r.uom, workType: r.wtype, ...figs(r) }));
  }
  function reasons(actor, q) {
    const sc = scope(actor); const { from, to } = range(q); const params = { ...sc.params, f: from, t: to }; const f = filters(q, params);
    const rows = db.prepare(`SELECT COALESCE(x.loss_reason, x.derived_reason, 'UNEXPLAINED') AS reason, SUM(x.shortfall_md) AS lost, COUNT(*) AS n FROM ${FROM} WHERE x.deleted_at IS NULL AND x.outlier = 0 AND x.shortfall_md > 0 AND x.work_date BETWEEN :f AND :t AND ${sc.sql}${f} GROUP BY reason ORDER BY lost DESC`).all(params); const total = rows.reduce((n, r) => n + r.lost, 0);
    return rows.map((r) => ({ reason: r.reason, label: LOSS_REASONS[r.reason], lostManDays: d3(r.lost), records: r.n, sharePct: total ? Math.round((r.lost * 10000) / total) / 100 : 0 }));
  }
  function summary(actor, q) {
    const sc = scope(actor); const { from, to } = range(q); const params = { ...sc.params, f: from, t: to }; const f = filters(q, params);
    const t = db.prepare(`SELECT ${AGG}, SUM(CASE WHEN x.outlier = 1 THEN 1 ELSE 0 END) AS outliers FROM prod_actuals x WHERE x.deleted_at IS NULL AND x.work_date BETWEEN :f AND :t AND ${sc.sql}${f}`).get(params);
    const counted = db.prepare(`SELECT ${AGG} FROM prod_actuals x WHERE x.deleted_at IS NULL AND x.outlier = 0 AND x.work_date BETWEEN :f AND :t AND ${sc.sql}${f}`).get(params);
    return { from, to, ...figs(counted), outlierCount: t.outliers ?? 0, records: counted.n };
  }
  function alertList(actor, q) {
    const sc = scope(actor, 'x', 'alert_site_id'); return db.prepare(`SELECT x.*, s.code AS scode FROM prod_alerts x JOIN org_sites s ON s.id = x.alert_site_id WHERE x.deleted_at IS NULL AND x.status = 'OPEN' AND ${sc.sql}${q.projectId ? ' AND x.org_project_id = :p' : ''}${q.siteId ? ' AND x.alert_site_id = :s' : ''} ORDER BY x.avg_pct LIMIT 50`).all({ ...sc.params, ...(q.projectId ? { p: q.projectId } : {}), ...(q.siteId ? { s: q.siteId } : {}) })
      .map((a) => ({ id: a.id, siteId: a.alert_site_id, site: a.scode, projectId: a.org_project_id, activityCode: a.activity_code, workType: a.work_type, days: a.days, fromDate: a.from_date, toDate: a.to_date, avgPctOfNorm: pc(a.avg_pct), raisedAt: a.raised_at }));
  }
  function outliers(actor, q) {
    const sc = scope(actor); const { from, to } = range(q); const params = { ...sc.params, f: from, t: to }; const f = filters(q, params);
    return db.prepare(`SELECT x.id, x.work_date, x.activity_code, s.code AS scode, x.qty, x.man_days, x.productivity, x.norm_labour, d.doc_no, x.dpr_id FROM prod_actuals x JOIN org_sites s ON s.id = x.prod_site_id JOIN site_dprs d ON d.id = x.dpr_id WHERE x.deleted_at IS NULL AND x.outlier = 1 AND x.work_date BETWEEN :f AND :t AND ${sc.sql}${f} ORDER BY x.work_date DESC LIMIT 30`).all(params).map((r) => ({ id: r.id, date: r.work_date, activityCode: r.activity_code, site: r.scode, qty: d3(r.qty), manDays: d3(r.man_days), outputPerMd: d3(r.productivity), norm: d3(r.norm_labour), timesNorm: r.norm_labour ? Math.round((r.productivity * 100) / r.norm_labour) / 100 : null, dprId: r.dpr_id, dprNo: r.doc_no }));
  }
  const projects = (actor) => db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'site.productivity.view', p.id)).map((p) => ({ id: p.id, code: p.code, name: p.name, canConfigure: may(actor, 'site.productivity.configure', p.id) }));
  const sitesOf = (actor, projectId) => db.prepare("SELECT s.id, s.code, s.name, s.org_project_id FROM org_sites s WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE' ORDER BY s.code").all(actor.companyId).filter((s) => (!projectId || s.org_project_id === projectId) && may(actor, 'site.productivity.view', s.org_project_id, s.id)).map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, canRecord: may(actor, 'site.productivity.record', s.org_project_id, s.id) }));
  function need_view(actor) { if (!authz.check(actor, 'site.productivity.view').allowed) throw forbidden('You may not see productivity (permission site.productivity.view).'); }
  function checkQ(actor, q) { need_view(actor); if (q.projectId) project(actor, q.projectId); if (q.siteId) siteRow(actor, q.siteId); if (q.from && q.to && q.from > q.to) fail([{ field: 'from', message: 'The start is not after the end' }]); }
  const dashboard = (actor, q) => {
    checkQ(actor, q); const s = summary(actor, q); const weeks = grouped(actor, q, 'WEEK');
    const worst = grouped(actor, { ...q }, 'ACTIVITY').filter((r) => r.efficiency != null && r.manDays >= 1).sort((a, b) => a.efficiency - b.efficiency).slice(0, 5);
    return { ...s, limit: Number(param(actor.companyId, 'site.productivity.alert_pct') ?? 80), byWorkType: grouped(actor, q, 'WORK_TYPE'), byCrew: grouped(actor, q, 'CREW'), byContractor: grouped(actor, q, 'CONTRACTOR'), bySite: grouped(actor, q, 'SITE'), trend: weeks.map((w) => ({ week: w.label, efficiency: w.efficiency, outputPerMd: w.outputPerMd, lostManDays: w.lostManDays })), worst, reasons: reasons(actor, q), alerts: alertList(actor, q), outliers: outliers(actor, q), projects: projects(actor), sites: sitesOf(actor, q.projectId) };
  };
  /** FR-04: the same work type across the sites and projects the person may see: output per man-day of each, the best and the company average. */
  function benchmarks(actor, q) {
    const sc = scope(actor); const { from, to } = range(q, 89); const params = { ...sc.params, f: from, t: to };
    const rows = db.prepare(`SELECT x.work_type AS wt, p.code AS pcode, s.code AS scode, s.id AS sid, MAX(x.uom) AS uom, ${AGG} FROM prod_actuals x JOIN org_sites s ON s.id = x.prod_site_id JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.outlier = 0 AND x.work_date BETWEEN :f AND :t AND ${sc.sql}${q.workType ? ' AND x.work_type = :w' : ''} GROUP BY x.work_type, s.id ORDER BY x.work_type, s.code`).all({ ...params, ...(q.workType ? { w: q.workType } : {}) });
    const by = new Map(); for (const r of rows) { const g = by.get(r.wt) ?? { workType: r.wt, uom: r.uom, sites: [], qty: 0, md: 0 }; g.sites.push({ siteId: r.sid, site: r.scode, project: r.pcode, ...figs(r) }); g.qty += r.qty; g.md += r.md; by.set(r.wt, g); }
    return [...by.values()].map((g) => { const avg = g.md > 0 ? Math.round((g.qty * 1000) / g.md) / 1000 : null; const best = [...g.sites].filter((x) => x.outputPerMd != null).sort((a, b) => b.outputPerMd - a.outputPerMd)[0]; return { workType: g.workType, uom: g.uom, averageOutputPerMd: avg, best: best ? { site: best.site, project: best.project, outputPerMd: best.outputPerMd } : null, sites: g.sites.map((x) => ({ ...x, vsAveragePct: avg && x.outputPerMd != null ? Math.round(((x.outputPerMd - avg) * 10000) / avg) / 100 : null })) }; });
  }
  const report = (actor, q) => { checkQ(actor, q); const by = q.groupBy ?? 'ACTIVITY'; return { ...summary(actor, q), groupBy: by, groups: grouped(actor, q, by), reasons: reasons(actor, q), benchmarks: benchmarks(actor, q), losses: losses.list(actor, { ...q, from: range(q).from, to: range(q).to }), outliers: outliers(actor, q) }; };
  function reportExport(actor, q) {
    const r = report(actor, q); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(actor.companyId)?.legal_name ?? ''; audit(actor, 'prod_actuals', 'report', 'export', actor.companyId, { newValues: { format: q.format, groupBy: r.groupBy, from: r.from, to: r.to } });
    const columns = [['label', GROUP_LABEL[r.groupBy]], ['qty', 'Output'], ['manDays', 'Man-days'], ['machineHours', 'Machine-hours'], ['outputPerMd', 'Output per man-day'], ['outputPerMh', 'Output per machine-hour'], ['efficiency', 'Labour efficiency %'], ['machineEfficiency', 'Machine efficiency %'], ['lostManDays', 'Man-days lost'], ['records', 'Records']].map(([key, label]) => ({ key, label, type: 'text' }));
    const rows = r.groups.map((g) => Object.fromEntries(columns.map((c) => [c.key, String(g[c.key] ?? '')])));
    const footer = [`${co}: productivity ${r.from} to ${r.to}, by ${r.groupBy.toLowerCase().replace('_', ' ')}`, `Labour efficiency ${r.efficiency ?? '—'} % · ${r.lostManDays ?? 0} man-days lost · ${r.outlierCount} records to check`, `Loss reasons: ${r.reasons.map((x) => `${x.label} ${x.lostManDays}`).join('; ') || 'none'}`];
    const name = `productivity-${r.from}-${r.to}`;
    if (q.format === 'csv') return { buffer: Buffer.from(toCsv({ columns, rows, footer })), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: rows.length };
    if (q.format === 'pdf') return { buffer: toPdf({ columns, rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: rows.length };
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'Productivity' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: rows.length };
  }
  const GROUP_LABEL = { ACTIVITY: 'Activity', WORK_TYPE: 'Work type', CREW: 'Crew', CONTRACTOR: 'Contractor', SITE: 'Site', WEEK: 'Week of' };
  const listing = {
    list(actor, query) { need_view(actor); const sc = scope(actor); return runList(db, actualList, parseListRequest(actualList, query), { select: 'x.id, x.work_date, x.org_project_id, x.prod_site_id, x.activity_code, x.work_type, x.qty, x.uom, x.man_days, x.productivity, x.variance_pct, x.shortfall_md, x.loss_reason, x.derived_reason, x.outlier, x.dpr_id, p.code AS pcode, s.code AS scode, d.doc_no AS dno, c.name AS cname, k.legal_name AS kname', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, date: x.work_date, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.prod_site_id, activity: x.activity_code, workType: x.work_type, crew: x.cname, contractor: x.kname, dpr: x.dno, dprId: x.dpr_id, qty: sd(d3(x.qty)), uom: x.uom, manDays: sd(d3(x.man_days)), productivity: sd(d3(x.productivity)), variance: sd(pc(x.variance_pct)), lostMd: sd(d3(x.shortfall_md)), reason: LOSS_REASONS[x.loss_reason ?? x.derived_reason] ?? '', outlier: x.outlier ? 'Check the data' : 'Counted' }) }); },
  };
  void countList; void esc; void unprocessable;
  return { norms, losses, dashboard, report, reportExport, benchmarks: (actor, q) => { checkQ(actor, q); return benchmarks(actor, q); }, alerts: (actor, q) => { checkQ(actor, q); return alertList(actor, q); }, rows: listing, onDpr, projects, sites: (actor, projectId) => sitesOf(actor, projectId), normDecide: norms.decide, options(actor, projectId) { const p = project(actor, projectId); return { projectId: p.id, activities: db.prepare("SELECT a.code, a.name, a.uom FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.org_project_id = ? AND s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'APPROVED' AND a.deleted_at IS NULL AND a.act_type = 'TASK' ORDER BY a.code LIMIT 1000").all(p.id, actor.companyId), reasons: Object.entries(LOSS_REASONS).filter(([k]) => k !== 'UNEXPLAINED').map(([code, label]) => ({ code, label })), resources: Object.entries(RESOURCES).map(([code, label]) => ({ code, label })), sites: sitesOf(actor, p.id) }; }, base: { may, param } };
}
