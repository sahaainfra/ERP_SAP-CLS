import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { budOf } from '../bud/budgets.js';
import { planOf } from '../plan/index.js';

// Work fronts, daily work plans and work authorisations (part 14.01): "no plan, no work".
// - A work front (FR-01) is a location of a site; its activities, status and constraints are worked out from the current schedule and the constraint log (13.04).
// - A daily work plan (FR-02) of a site and a supervisor takes the day's quantities of the approved weekly plans (13.04) or copies the day before; issued, each line becomes a WA in draft.
// - A work authorisation (FR-03) names the activity, WBS, location, quantity, crews, materials and plant (from the norms of the activity, 13.02), the budget line (checked by 12.03), the drawing
//   revision (checked against the current IFC revision, 11.01), the permit and hold points, the time window and the supervisor. The construction manager approves; what is outside the plan and
//   emergencies go on to the project manager. Approved, it is locked; a change is a revision. Closure (FR-04) records the quantity done and reconciles what was used against what was authorised.
// - An emergency WA (FR-05) is usable at once and is regularised through the same chain within 24 hours.
// - Attendance, material issue, plant logs, DPR and measurement (FR-07) name a WA through POST /site/wa-uses; a use without a WA or beyond what it authorises goes to CP-SITE-02.
export const WA_DOC = 'SITE_WA';
export const WA_STATUS = { DRAFT: 'Draft', EMERGENCY: 'Emergency (to be regularised)', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed', SUPERSEDED: 'Superseded by a revision' };
export const FRONT_STATUS = { OPEN: 'Open', BLOCKED: 'Blocked', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' };
export const DAILY_STATUS = { DRAFT: 'Draft', ISSUED: 'Issued (WAs raised)', CANCELLED: 'Cancelled' };
export const USE_KINDS = { ATTENDANCE: 'Attendance', MATERIAL_ISSUE: 'Material issue', PLANT_LOG: 'Plant log', DPR: 'Daily progress report', MEASUREMENT: 'Measurement' };
export const RES_TYPES = { LABOUR: 'Labour', MATERIAL: 'Material', PLANT: 'Plant' };
const LIVE = ['APPROVED', 'EMERGENCY'];
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const q3 = (n) => Math.round(Number(n) * 1000);
const d3 = (n) => (n == null ? null : n / 1000);

// The checks before approval (BR-01): a superseded or not-for-construction drawing, a budget that blocks, a permit that is needed and not there. WARN by default; ENFORCE blocks.
controlRegistry.define({
  code: 'CP-SITE-01', module: 'site', stage: 'APPROVE', description: 'A work authorisation is not approved on a superseded drawing, a budget that blocks or without the permit it needs', enforcement: 'BLOCK', ownerRole: 'CM', mode: 'WARN',
  evaluate: ({ context }) => ({ pass: !(context.problems ?? []).length, message: (context.problems ?? []).join(' '), details: { problems: context.problems ?? [], ref: context.ref ?? null } }),
});
// Work on site only against an approved WA (FR-07): a use without a WA, or beyond what the WA authorises (with the tolerance), needs an approved exception.
controlRegistry.define({
  code: 'CP-SITE-02', module: 'site', stage: 'EXECUTE', description: 'Labour, material, plant, progress and measurement are booked only against an approved work authorisation and within it', enforcement: 'EXCEPTION', evidenceRequired: true, ownerRole: 'CM', emergencyAllowed: true, mode: 'ENFORCE',
  thresholds: { usePct: 5, planPct: 5, closePct: 10 },
  evaluate: ({ context }) => ({ pass: !context.deviation, message: context.deviation ?? 'Within the work authorisation', details: { wa: context.waNo ?? null, kind: context.kind ?? null, ref: context.ref ?? null } }),
});

const YES_NO = [['1', 'Yes'], ['0', 'No']];
export const waList = defineList({
  code: 'site.work_authorisations', label: 'Work authorisations', permission: 'site.work_authorisation.view',
  from: 'site_work_authorisations x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.wa_site_id JOIN plan_activities a ON a.id = x.activity_id LEFT JOIN site_work_fronts f ON f.id = x.work_front_id',
  where: 'x.deleted_at IS NULL', searchable: ['x.wa_no', 'a.code', 'a.name', 'p.code', 'f.name', 'x.supervisor'], defaultSort: '-planDate',
  columns: {
    waNo: { sql: 'x.wa_no', type: 'text', label: 'WA no.' }, planDate: { sql: 'x.plan_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.wa_site_id', type: 'number', label: 'Site id' }, front: { sql: 'f.name', type: 'text', label: 'Work front' }, activity: { sql: 'a.code', type: 'text', label: 'Activity' },
    plannedQty: { sql: 'x.planned_qty', type: 'number', label: 'Planned qty' }, actualQty: { sql: 'x.actual_qty', type: 'number', label: 'Actual qty' }, supervisor: { sql: 'x.supervisor', type: 'text', label: 'Supervisor' },
    emergency: { sql: 'x.is_emergency', type: 'enum', label: 'Emergency', options: YES_NO }, inPlan: { sql: 'x.in_plan', type: 'enum', label: 'In the plan', options: YES_NO }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(WA_STATUS) },
  },
});
export const dailyList = defineList({
  code: 'site.daily_plans', label: 'Daily work plans', permission: 'site.daily_plan.view',
  from: 'site_daily_plans x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.dp_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 's.code', 'x.supervisor'], defaultSort: '-planDate',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Plan no.' }, planDate: { sql: 'x.plan_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.dp_site_id', type: 'number', label: 'Site id' }, supervisor: { sql: 'x.supervisor', type: 'text', label: 'Supervisor' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(DAILY_STATUS) } },
});

export function createSiteService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid, sid = null) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid, siteId: sid }).allowed;
  const need = (actor, key, what, pid, sid = null) => { if (!may(actor, key, pid, sid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, users, ref, subject, detail, link, sourceId) => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId }); } catch { /* saved anyway */ } };
  const event = (type, r, data) => publishEvent(db, { type, entity: 'site_work_authorisation', entityId: r.id, actorId: data.by ?? null, companyId: r.company_id, projectId: r.org_project_id, siteId: r.wa_site_id, data });
  const number = (companyId, user, docType, table, col, prefix) => {
    try { return issueNumber(db, { companyId, docType, actor: user, refType: table }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`;
    for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND ${col} = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no;
  };
  const control = (companyId) => { const p = protocolOf(db); const row = p.ensure(companyId, 'CP-SITE-02'); return p.thresholdsOf(row); };
  const siteOf = (actor, siteId, key = 'site.work_authorisation.view') => {
    const s = db.prepare('SELECT s.id, s.code, s.name, s.org_project_id, s.company_id, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ? AND s.deleted_at IS NULL').get(rid(siteId));
    if (!s || s.company_id !== actor.companyId || !may(actor, key.startsWith('site.work_front') ? 'site.work_front.view' : key.startsWith('site.daily') ? 'site.daily_plan.view' : 'site.work_authorisation.view', s.org_project_id, s.id)) throw notFound('That site does not exist.');
    need(actor, key, 'do that for this site', s.org_project_id, s.id); return s;
  };
  const currentSchedule = (companyId, projectId) => db.prepare("SELECT * FROM plan_schedules WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'DRAFT', 'RETURNED', 'SUBMITTED') ORDER BY (status = 'APPROVED') DESC, id DESC").get(companyId, projectId);
  const activityOf = (projectId, id) => db.prepare("SELECT a.*, s.org_project_id FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE a.id = ? AND a.deleted_at IS NULL AND a.act_type IN ('TASK', 'MILESTONE')").get(rid(id));
  const frontRow = (id) => db.prepare('SELECT * FROM site_work_fronts WHERE id = ? AND deleted_at IS NULL').get(rid(id));
  const crewSize = (crewId, date) => db.prepare('SELECT COUNT(*) AS n FROM hr_crew_members WHERE crew_id = ? AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?)').get(crewId, date, date).n;

  // ---- FR-01: work fronts ---------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The activities of a front (its location in the current schedule), its constraints and the status they give: blocked by an open constraint, completed when every activity is done. */
  function frontState(f, date = todayIST()) {
    const s = currentSchedule(f.company_id, f.org_project_id);
    const acts = s && f.location_id ? db.prepare("SELECT id, code, name, qty, uom, pct_complete, es, ef FROM plan_activities WHERE schedule_id = ? AND location_id = ? AND deleted_at IS NULL AND act_type IN ('TASK', 'MILESTONE') ORDER BY es, sort_order, id").all(s.id, f.location_id) : [];
    const ids = acts.map((a) => a.id); const ph = ids.map(() => '?').join(',');
    const cons = ids.length ? db.prepare(`SELECT ctype, COUNT(*) AS n FROM plan_constraints WHERE activity_id IN (${ph}) AND status = 'OPEN' AND deleted_at IS NULL GROUP BY ctype ORDER BY ctype`).all(...ids) : [];
    const open = cons.reduce((t, c) => t + c.n, 0); const live = db.prepare(`SELECT COUNT(*) AS n FROM site_work_authorisations WHERE work_front_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'EMERGENCY') AND plan_date = ?`).get(f.id, date).n;
    const done = acts.length > 0 && acts.every((a) => a.pct_complete >= 10000); const started = acts.some((a) => a.pct_complete > 0) || live > 0;
    const status = done ? 'COMPLETED' : open > 0 ? 'BLOCKED' : started ? 'IN_PROGRESS' : 'OPEN';
    const summary = open ? `${open} open: ${cons.map((c) => `${c.ctype} ${c.n}`).join(', ')}` : null;
    return { status, summary, activities: acts.filter((a) => a.pct_complete < 10000).map((a) => ({ id: a.id, code: a.code, name: a.name, qty: d3(a.qty), uom: a.uom, pct: a.pct_complete / 100, es: a.es, ef: a.ef })), constraints: cons.map((c) => ({ type: c.ctype, open: c.n })) };
  }
  const refreshFront = (id) => { const f = id ? frontRow(id) : null; if (!f) return; const st = frontState(f); if (st.status !== f.status || st.summary !== f.constraints_summary) db.prepare('UPDATE site_work_fronts SET status = ?, constraints_summary = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(st.status, st.summary, nowIso(), f.id); };
  const frontView = (f, detail = true, date = todayIST()) => { const st = frontState(f, date); const loc = f.location_id ? db.prepare('SELECT code, name FROM proj_locations WHERE id = ?').get(f.location_id) : null; return { id: f.id, siteId: f.wf_site_id, projectId: f.org_project_id, locationId: f.location_id, location: loc ? `${loc.code} ${loc.name}` : null, code: f.code, name: f.name, status: st.status, statusLabel: FRONT_STATUS[st.status], constraintsSummary: st.summary, constraints: st.constraints, ...(detail ? { activities: st.activities } : { activitiesCount: st.activities.length }), sortOrder: f.sort_order, rowVersion: f.version }; };
  const fronts = {
    list(actor, { siteId }) { const s = siteOf(actor, siteId, 'site.work_front.view'); return { site: { id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode }, fronts: db.prepare('SELECT * FROM site_work_fronts WHERE wf_site_id = ? AND deleted_at IS NULL ORDER BY sort_order, code').all(s.id).map((f) => frontView(f)), canManage: may(actor, 'site.work_front.manage', s.org_project_id, s.id) }; },
    create(actor, b) {
      const s = siteOf(actor, b.siteId, 'site.work_front.manage'); const p = [];
      if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, s.org_project_id)) p.push({ field: 'locationId', message: 'Choose a location of the project' });
      if (db.prepare('SELECT 1 FROM site_work_fronts WHERE wf_site_id = ? AND code = ? AND deleted_at IS NULL').get(s.id, b.code)) p.push({ field: 'code', message: 'This code is used by another front of the site' }); fail(p);
      return transaction(db, () => { const id = Number(db.prepare("INSERT INTO site_work_fronts (company_id, org_project_id, wf_site_id, location_id, code, name, sort_order, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, s.org_project_id, s.id, b.locationId ?? null, b.code, b.name, b.sortOrder ?? 0, s.org_project_id, s.id, actor.user).lastInsertRowid); refreshFront(id); audit(actor, 'site_work_fronts', id, 'create', actor.companyId, { newValues: b }); return frontView(frontRow(id)); });
    },
    update(actor, id, b) {
      const f = frontRow(id); if (!f || f.company_id !== actor.companyId) throw notFound('That work front does not exist.'); siteOf(actor, f.wf_site_id, 'site.work_front.manage'); if (b.rowVersion && b.rowVersion !== f.version) throw conflict('Someone changed this work front; reload it.');
      if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, f.org_project_id)) fail([{ field: 'locationId', message: 'Choose a location of the project' }]);
      return transaction(db, () => { db.prepare('UPDATE site_work_fronts SET name = COALESCE(?, name), location_id = ?, sort_order = COALESCE(?, sort_order), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name ?? null, 'locationId' in b ? b.locationId : f.location_id, b.sortOrder ?? null, actor.user, nowIso(), f.id); refreshFront(f.id); audit(actor, 'site_work_fronts', f.id, 'update', f.company_id, { oldValues: { name: f.name, locationId: f.location_id }, newValues: b }); return frontView(frontRow(f.id)); });
    },
    remove(actor, id) {
      const f = frontRow(id); if (!f || f.company_id !== actor.companyId) throw notFound('That work front does not exist.'); siteOf(actor, f.wf_site_id, 'site.work_front.manage');
      if (db.prepare("SELECT 1 FROM site_work_authorisations WHERE work_front_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED')").get(f.id)) throw unprocessable('Work authorisations name this front; it is kept.');
      db.prepare('UPDATE site_work_fronts SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, f.id); audit(actor, 'site_work_fronts', f.id, 'delete', f.company_id); return { id: f.id, deleted: true };
    },
  };

  // ---- FR-03: the work authorisation -------------------------------------------------------------------------------------------------------------------------------------------------
  function row(actor, id, key = 'site.work_authorisation.view') {
    const r = db.prepare('SELECT * FROM site_work_authorisations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.work_authorisation.view', r.org_project_id, r.wa_site_id)) throw notFound('That work authorisation does not exist.'); if (key !== 'site.work_authorisation.view') need(actor, key, 'do that with a work authorisation', r.org_project_id, r.wa_site_id); return r;
  }
  const fresh = (id) => db.prepare('SELECT * FROM site_work_authorisations WHERE id = ?').get(id);
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(r.status === 'APPROVED' ? `${r.wa_no} is approved: it is locked; a change is a revision.` : `${r.wa_no} is ${lower(WA_STATUS[r.status])}: it is not changed now.`); };
  const resources = (waId) => db.prepare('SELECT r.*, i.code AS item_code, c.code AS ccode, c.name AS cname FROM site_wa_resources r LEFT JOIN mdm_items i ON i.id = r.item_id LEFT JOIN hr_crews c ON c.id = r.crew_id WHERE r.wa_id = ? AND r.deleted_at IS NULL ORDER BY r.resource_type, r.id').all(waId);
  const resView = (x, tol) => { const over = x.planned_qty > 0 ? Math.round(((x.actual_qty - x.planned_qty) * 10000) / x.planned_qty) / 100 : (x.actual_qty > 0 ? 100 : 0); return { id: x.id, type: x.resource_type, typeLabel: RES_TYPES[x.resource_type], itemId: x.item_id, itemCode: x.item_code ?? null, trade: x.trade, crewId: x.crew_id, crew: x.ccode ? `${x.ccode} ${x.cname}` : null, key: x.res_key, label: x.label, uom: x.uom, headcount: x.headcount, plannedQty: d3(x.planned_qty), actualQty: d3(x.actual_qty), variancePct: over, beyond: tol != null && Math.abs(over) > tol, source: x.source }; };
  /** Remaining quantity of an activity (BR-02): its quantity less what is done (progress, or the actuals of closed WAs, whichever is more) and less the WAs open on it. */
  function remainingOf(a, exceptId = 0) {
    const closed = db.prepare("SELECT COALESCE(SUM(actual_qty), 0) AS n FROM site_work_authorisations WHERE activity_id = ? AND status = 'CLOSED' AND deleted_at IS NULL").get(a.id).n;
    const open = db.prepare(`SELECT COALESCE(SUM(planned_qty), 0) AS n FROM site_work_authorisations WHERE activity_id = ? AND status IN ('SUBMITTED', 'APPROVED', 'EMERGENCY') AND deleted_at IS NULL AND id <> ? AND id NOT IN (SELECT parent_wa_id FROM site_work_authorisations WHERE id = ? AND parent_wa_id IS NOT NULL)`).get(a.id, exceptId, exceptId).n;
    return Math.max(0, a.qty - Math.max(Math.round((a.qty * a.pct_complete) / 10000), closed) - open);
  }
  function checkQty(companyId, a, qty, exceptId) {
    if (!a.qty) return null; const rem = remainingOf(a, exceptId); const tol = Number(control(companyId).planPct ?? 5); const max = Math.floor((rem * (100 + tol)) / 100);
    return qty > max ? { field: 'plannedQty', message: `At most ${d3(max)} ${a.uom ?? ''} can be authorised: ${d3(rem)} remains of ${a.code} (with a tolerance of ${tol} %)`.replace(/\s+\(/, ' (') } : null;
  }
  /** Is the activity in an approved weekly plan for the day (13.04)? */
  const inWeeklyPlan = (actor, projectId, activityId, date) => { try { return (planOf(db)?.lookahead?.dailyPlan(actor, projectId, date).rows ?? []).some((x) => x.activityId === activityId); } catch { return false; } };
  /** The checks of a WA (BR-01) as they stand: drawing, budget, permit, hold points, plan. A budget is checked with the person's own right to use the budget check (12.03). */
  function checksOf(actor, r, { budget = true } = {}) {
    const out = [];
    if (r.drawing_id) {
      const d = db.prepare('SELECT drawing_no, current_ifc_revision_id FROM engg_drawings WHERE id = ?').get(r.drawing_id); const ifc = d?.current_ifc_revision_id ? db.prepare('SELECT rev_label FROM engg_drawing_revisions WHERE id = ?').get(d.current_ifc_revision_id) : null;
      const rev = db.prepare('SELECT id, rev_status, status_code FROM engg_drawing_revisions WHERE drawing_id = ? AND lower(rev_label) = lower(?) AND deleted_at IS NULL ORDER BY id DESC').get(r.drawing_id, r.drawing_revision ?? '');
      if (!ifc) out.push({ code: 'DRAWING', result: 'FAIL', message: `Drawing ${d?.drawing_no} has no revision issued for construction.` });
      else if (!rev || rev.id !== d.current_ifc_revision_id) out.push({ code: 'DRAWING', result: 'FAIL', message: `Drawing ${d.drawing_no} revision ${r.drawing_revision ?? '—'} is ${rev?.rev_status === 'SUPERSEDED' ? 'superseded' : 'not the revision for construction'}; the current IFC revision is ${ifc.rev_label}.` });
      else out.push({ code: 'DRAWING', result: 'PASS', message: `Drawing ${d.drawing_no} revision ${ifc.rev_label} is the current IFC revision.` });
    } else out.push({ code: 'DRAWING', result: 'NA', message: 'No drawing named.' });
    if (budget) {
      if (r.budget_amount > 0) {
        const bud = budOf(db)?.ledger; let res = null; let msg;
        if (!bud) msg = 'The budget check (12.03) is not installed.';
        else { try { const c = bud.check(actor, { projectId: r.org_project_id, stage: 'OTHER', lines: [{ wbsId: r.wbs_id, costCodeId: r.cost_code_id, amount: r.budget_amount / 100, sourceType: 'site_wa', sourceId: String(r.id), lineId: '' }] }); res = c.result; msg = c.lines[0]?.message ?? `Within the budget available (₹ ${c.lines[0]?.available ?? '—'}).`; } catch (e) { msg = `The budget was not checked: ${e.message}`; } }
        out.push({ code: 'BUDGET', result: res === 'BLOCK' ? 'FAIL' : res === 'OK' ? 'PASS' : 'WARN', message: msg ?? 'Within the budget available.' });
      } else out.push({ code: 'BUDGET', result: 'NA', message: 'No amount named against the budget.' });
    } else { const prev = json(r.checks_json, []).find((c) => c.code === 'BUDGET'); if (prev) out.push(prev); }
    if (r.permit_required) out.push(r.permit_ref ? { code: 'PERMIT', result: 'PASS', message: `Permit ${r.permit_ref} (the permit-to-work register, 19.02, is not live: the reference is recorded).` } : { code: 'PERMIT', result: 'FAIL', message: 'A permit to work is needed and none is named.' });
    else out.push({ code: 'PERMIT', result: 'NA', message: 'No permit needed.' });
    out.push(r.hold_points ? { code: 'HOLD_POINTS', result: 'WARN', message: `Hold points: ${r.hold_points} (inspection requests, 18.02, are not live: release them on site).` } : { code: 'HOLD_POINTS', result: 'NA', message: 'No hold point.' });
    out.push(r.in_plan ? { code: 'PLAN', result: 'PASS', message: 'In the approved weekly plan of the day.' } : { code: 'PLAN', result: 'WARN', message: r.is_emergency ? 'Emergency work, outside the plan: the project manager regularises it.' : 'Outside the weekly plan: the project manager also approves it.' });
    return out;
  }
  const problemsOf = (checks) => checks.filter((c) => c.result === 'FAIL' && ['DRAWING', 'BUDGET', 'PERMIT'].includes(c.code)).map((c) => c.message);
  /** CP-SITE-01: a WARN mode lets the WA through with its warnings written down; ENFORCE stops it. */
  const enforceChecks = (actor, r, checks) => protocolOf(db).enforce(actor, 'CP-SITE-01', { entity: 'site_wa', entityId: String(r.id), problems: problemsOf(checks), ref: r.wa_no, projectId: r.org_project_id, siteId: r.wa_site_id });

  function view(actor, r, { detail = false } = {}) {
    const a = db.prepare('SELECT code, name, qty, uom FROM plan_activities WHERE id = ?').get(r.activity_id); const s = db.prepare('SELECT s.code, s.name, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.wa_site_id);
    const f = r.work_front_id ? frontRow(r.work_front_id) : null; const w = r.wbs_id ? db.prepare('SELECT code, name FROM proj_wbs WHERE id = ?').get(r.wbs_id) : null; const loc = r.location_id ? db.prepare('SELECT code, name FROM proj_locations WHERE id = ?').get(r.location_id) : null;
    const d = r.drawing_id ? db.prepare('SELECT drawing_no, title FROM engg_drawings WHERE id = ?').get(r.drawing_id) : null; const can = (k) => may(actor, k, r.org_project_id, r.wa_site_id); const own = same(r.requested_by, actor.user) || same(r.created_by, actor.user);
    const overdue = r.status === 'EMERGENCY' && r.regularise_by && r.regularise_by < nowIso();
    const v = {
      id: r.id, waNo: r.wa_no, projectId: r.org_project_id, projectCode: s?.pcode, projectName: s?.pname, siteId: r.wa_site_id, siteCode: s?.code, siteName: s?.name, workFrontId: r.work_front_id, workFront: f ? `${f.code} ${f.name}` : null, dailyPlanId: r.daily_plan_id,
      planDate: r.plan_date, activityId: r.activity_id, activity: a ? `${a.code} ${a.name}` : null, activityCode: a?.code, wbsId: r.wbs_id, wbs: w ? `${w.code} ${w.name}` : null, locationId: r.location_id, location: loc ? `${loc.code} ${loc.name}` : null,
      plannedQty: d3(r.planned_qty), uom: r.uom, actualQty: d3(r.actual_qty), drawingId: r.drawing_id, drawing: d ? `${d.drawing_no} ${d.title}` : null, drawingRevision: r.drawing_revision, costCodeId: r.cost_code_id, budgetAmount: r.budget_amount / 100, budgetLineRef: r.budget_line_ref,
      permitRequired: Boolean(r.permit_required), permitRef: r.permit_ref, holdPoints: r.hold_points, startTime: r.start_time, endTime: r.end_time, supervisor: r.supervisor, inPlan: Boolean(r.in_plan), emergency: Boolean(r.is_emergency), emergencyReason: r.emergency_reason,
      regulariseBy: r.regularise_by, regularisedAt: r.regularised_at, overdue, checks: json(r.checks_json, []), revisionNo: r.revision_no, parentWaId: r.parent_wa_id, status: r.status, statusLabel: WA_STATUS[r.status], closureNotes: r.closure_notes, varianceReason: r.variance_reason, closedAt: r.closed_at, closedBy: r.closed_by,
      reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('site.work_authorisation.edit') && editable(r), submit: can('site.work_authorisation.submit') && (editable(r) || (r.status === 'EMERGENCY' && !r.workflow_instance_id)), withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user),
        cancel: can('site.work_authorisation.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('site.work_authorisation.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, close: can('site.work_authorisation.close') && r.status === 'APPROVED',
        amend: can('site.work_authorisation.amend') && r.status === 'APPROVED' && !db.prepare("SELECT 1 FROM site_work_authorisations WHERE parent_wa_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id), approve: can('site.work_authorisation.approve') && r.status === 'SUBMITTED' && !own, print: can('site.work_authorisation.print'), export: can('site.work_authorisation.export') },
    };
    if (detail) {
      const tol = Number(control(r.company_id).closePct ?? 10); v.resources = resources(r.id).map((x) => resView(x, tol)); v.tolerancePct = tol;
      v.uses = db.prepare('SELECT use_kind, src_entity, src_id, resource_type, res_key, qty, uom, use_date, result, exception_no, created_by, created_at FROM site_wa_uses WHERE wa_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 200').all(r.id).map((u) => ({ kind: u.use_kind, kindLabel: USE_KINDS[u.use_kind], source: `${u.src_entity} ${u.src_id}`, type: u.resource_type, key: u.res_key, qty: d3(u.qty), uom: u.uom, date: u.use_date, result: u.result, exceptionNo: u.exception_no, by: u.created_by, at: u.created_at }));
      v.dprQty = d3(db.prepare("SELECT COALESCE(SUM(qty), 0) AS n FROM site_wa_uses WHERE wa_id = ? AND use_kind = 'DPR' AND deleted_at IS NULL").get(r.id).n);
      const p = r.parent_wa_id ? fresh(r.parent_wa_id) : null; v.previous = p ? { id: p.id, waNo: p.wa_no, plannedQty: d3(p.planned_qty), startTime: p.start_time, endTime: p.end_time, drawingRevision: p.drawing_revision } : null;
      v.activityQty = a ? d3(a.qty) : null; v.remainingQty = a?.qty ? d3(remainingOf({ ...db.prepare('SELECT id, qty, pct_complete, code, uom FROM plan_activities WHERE id = ?').get(r.activity_id) }, r.id)) : null;
    }
    return v;
  }
  const scope = (actor, key = 'site.work_authorisation.view') => { const f = authz.scopeFilter(actor, key, { project: 'x.org_project_id', site: 'x.wa_site_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const SELECT = 'x.id, x.wa_no, x.plan_date, x.org_project_id, x.wa_site_id, x.work_front_id, x.activity_id, x.planned_qty, x.actual_qty, x.uom, x.supervisor, x.is_emergency, x.in_plan, x.status, x.regularise_by, x.start_time, x.end_time, p.code AS pcode, s.code AS scode, a.code AS acode, a.name AS aname, f.code AS fcode, f.name AS fname';
  const listRow = (x) => ({ id: x.id, waNo: x.wa_no, planDate: x.plan_date, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.wa_site_id, front: x.fname ? `${x.fcode} ${x.fname}` : null, workFrontId: x.work_front_id, activity: `${x.acode} ${x.aname}`, activityId: x.activity_id, plannedQty: d3(x.planned_qty), actualQty: d3(x.actual_qty), uom: x.uom, supervisor: x.supervisor, startTime: x.start_time, endTime: x.end_time, emergency: String(x.is_emergency), inPlan: String(x.in_plan), overdue: x.status === 'EMERGENCY' && x.regularise_by < nowIso(), status: x.status, statusLabel: WA_STATUS[x.status] });

  /** The resources a WA authorises: the crews named (labour by trade, a man-day a head) and the materials and plant of the activity's norms (13.02) in proportion to the quantity. */
  function resourcesFor(r, a, b) {
    const out = []; const date = r.plan_date;
    for (const c of b.crews ?? []) {
      const crew = db.prepare('SELECT id, code, name, trade, crew_site_id FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(c.crewId, r.company_id); if (!crew) continue;
      const head = c.headcount ?? crewSize(crew.id, date); out.push({ resource_type: 'LABOUR', item_id: null, trade: crew.trade, crew_id: crew.id, res_key: `trade:${lower(crew.trade)}`, label: `${crew.code} ${crew.name} (${crew.trade})`, uom: 'man-day', headcount: head, planned_qty: head * 1000, source: 'MANUAL' });
    }
    if (b.resources?.length) for (const x of b.resources) out.push({ resource_type: x.type, item_id: x.itemId ?? null, trade: x.trade ?? null, crew_id: null, res_key: x.itemId ? `item:${x.itemId}` : `${x.type === 'LABOUR' ? 'trade' : 'plant'}:${lower(x.trade)}`, label: x.label, uom: x.uom, headcount: null, planned_qty: q3(x.qty), source: 'MANUAL' });
    else if (a.qty > 0) {
      for (const n of db.prepare("SELECT * FROM plan_activity_resources WHERE activity_id = ? AND deleted_at IS NULL AND resource_type IN ('MATERIAL', 'PLANT') ORDER BY id").all(a.id)) {
        const q = Math.round((n.qty_total * r.planned_qty) / a.qty); if (q > 0) out.push({ resource_type: n.resource_type, item_id: n.item_id, trade: n.trade, crew_id: null, res_key: n.item_id ? `item:${n.item_id}` : n.res_key, label: n.label, uom: n.uom, headcount: null, planned_qty: q, source: 'NORM' });
      }
    }
    return out;
  }
  const writeResources = (actor, r, list) => { db.prepare('UPDATE site_wa_resources SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE wa_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id); for (const x of list) db.prepare("INSERT INTO site_wa_resources (company_id, wa_id, resource_type, item_id, trade, crew_id, res_key, label, uom, headcount, planned_qty, actual_qty, source, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'site_wa')").run(r.company_id, r.id, x.resource_type, x.item_id, x.trade ?? null, x.crew_id ?? null, x.res_key, x.label, x.uom, x.headcount ?? null, x.planned_qty, x.actual_qty ?? 0, x.source, r.org_project_id, r.wa_site_id, actor.user); };

  /** Validate what a WA names against the project, site and schedule; defaults from the activity, the front and the current IFC revision. */
  function resolve(actor, s, b, exceptId = 0) {
    const p = []; const a = activityOf(s.org_project_id, b.activityId);
    if (!a || a.org_project_id !== s.org_project_id || a.company_id !== actor.companyId) { fail([{ field: 'activityId', message: 'Choose an activity of the project\'s schedule' }]); }
    const f = b.workFrontId ? frontRow(b.workFrontId) : frontRow(frontFor(s.id, a.id) ?? 0); if (b.workFrontId && (!f || f.wf_site_id !== s.id)) p.push({ field: 'workFrontId', message: 'Choose a work front of the site' });
    const wbsId = b.wbsId ?? a.wbs_id ?? null; if (b.wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.wbsId, s.org_project_id)) p.push({ field: 'wbsId', message: 'Choose a WBS node of the project' });
    const locationId = b.locationId ?? f?.location_id ?? a.location_id ?? null; if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, s.org_project_id)) p.push({ field: 'locationId', message: 'Choose a location of the project' });
    let drawingRevision = b.drawingRevision ?? null;
    if (b.drawingId) { const d = db.prepare('SELECT id, org_project_id, current_ifc_revision_id FROM engg_drawings WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.drawingId, actor.companyId); if (!d || d.org_project_id !== s.org_project_id) p.push({ field: 'drawingId', message: 'Choose a drawing of the project' }); else if (!drawingRevision && d.current_ifc_revision_id) drawingRevision = db.prepare('SELECT rev_label FROM engg_drawing_revisions WHERE id = ?').get(d.current_ifc_revision_id).rev_label; }
    if (b.costCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL').get(b.costCodeId, actor.companyId)) p.push({ field: 'costCodeId', message: 'Choose a cost code' });
    for (const [i, c] of (b.crews ?? []).entries()) { const crew = db.prepare('SELECT crew_site_id FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(c.crewId, actor.companyId); if (!crew || crew.crew_site_id !== s.id) p.push({ field: `crews.${i}.crewId`, message: 'Choose a crew deployed at the site' }); }
    if (b.startTime >= b.endTime) p.push({ field: 'endTime', message: 'The end is after the start' });
    const qty = q3(b.plannedQty); const over = checkQty(actor.companyId, a, qty, exceptId); if (over) p.push(over); fail(p);
    return { a, f, wbsId, locationId, drawingRevision, qty };
  }

  const was = {
    list(actor, query) { if (!authz.check(actor, 'site.work_authorisation.view').allowed) throw forbidden('You may not see work authorisations (permission site.work_authorisation.view).'); const sc = scope(actor); return runList(db, waList, parseListRequest(waList, query), { select: SELECT, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: listRow }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'site.work_authorisation.export').allowed) throw forbidden('You may not export work authorisations (permission site.work_authorisation.export).'); const sc = scope(actor); const opts = { select: SELECT, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: waList.label, permission: 'site.work_authorisation.export', personal: false, columns: ['waNo', 'planDate', 'project', 'site', 'front', 'activity', 'plannedQty', 'actualQty', 'uom', 'supervisor', 'status'].map((k) => ({ key: k, label: waList.columns[k]?.label ?? (k === 'uom' ? 'Unit' : k), type: 'text' })),
        rows: () => runList(db, waList, req, { ...opts, limit: null, map: (x) => { const v = listRow(x); return { ...v, plannedQty: String(v.plannedQty), actualQty: v.actualQty == null ? '' : String(v.actualQty), uom: v.uom ?? '', front: v.front ?? '', status: v.statusLabel }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All work authorisations you may see'], count: () => countList(db, waList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    /** What the WA form offers for a site and a day: fronts, activities with what remains, crews deployed, drawings with their IFC revision, the activities of the day's weekly plan. */
    options(actor, { siteId, date }) {
      const s = siteOf(actor, siteId); const day = date ?? todayIST(); const sch = currentSchedule(actor.companyId, s.org_project_id);
      const planned = (() => { try { return planOf(db)?.lookahead?.dailyPlan(actor, s.org_project_id, day).rows ?? []; } catch { return []; } })();
      return {
        site: { id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode }, date: day, schedule: sch ? { id: sch.id, docNo: sch.doc_no, status: sch.status } : null,
        fronts: db.prepare('SELECT id, code, name, location_id FROM site_work_fronts WHERE wf_site_id = ? AND deleted_at IS NULL ORDER BY sort_order, code').all(s.id).map((f) => ({ id: f.id, code: f.code, name: f.name, locationId: f.location_id })),
        activities: sch ? db.prepare("SELECT id, code, name, qty, uom, pct_complete, wbs_id, location_id FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL AND act_type IN ('TASK', 'MILESTONE') AND pct_complete < 10000 ORDER BY sort_order, id").all(sch.id).map((a) => ({ id: a.id, code: a.code, name: a.name, qty: d3(a.qty), uom: a.uom, pct: a.pct_complete / 100, wbsId: a.wbs_id, locationId: a.location_id, remaining: a.qty ? d3(remainingOf(a)) : null, inPlan: planned.some((x) => x.activityId === a.id) })) : [],
        crews: db.prepare('SELECT id, code, name, trade FROM hr_crews WHERE crew_site_id = ? AND company_id = ? AND deleted_at IS NULL AND active = 1 ORDER BY code').all(s.id, actor.companyId).map((c) => ({ id: c.id, code: c.code, name: c.name, trade: c.trade, headcount: crewSize(c.id, day) })),
        drawings: db.prepare("SELECT d.id, d.drawing_no, d.title, r.rev_label FROM engg_drawings d LEFT JOIN engg_drawing_revisions r ON r.id = d.current_ifc_revision_id WHERE d.org_project_id = ? AND d.deleted_at IS NULL ORDER BY d.drawing_no LIMIT 500").all(s.org_project_id).map((d) => ({ id: d.id, drawingNo: d.drawing_no, title: d.title, ifcRevision: d.rev_label ?? null })),
        locations: db.prepare('SELECT id, code, name FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order, code LIMIT 1000').all(s.org_project_id),
        plan: planned, tolerancePct: Number(control(actor.companyId).planPct ?? 5),
      };
    },
    create(actor, b, extra = {}) {
      const s = siteOf(actor, b.siteId, 'site.work_authorisation.create'); const x = resolve(actor, s, b); const inPlan = extra.inPlan ?? inWeeklyPlan(actor, s.org_project_id, x.a.id, b.planDate);
      if (b.emergency && b.planDate !== todayIST()) fail([{ field: 'planDate', message: 'Emergency work is authorised for today' }]);
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, WA_DOC, 'site_work_authorisations', 'wa_no', 'WA'); const by = b.emergency ? new Date(Date.now() + 24 * 3600_000).toISOString() : null;
        const id = Number(db.prepare(`INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, work_front_id, daily_plan_id, plan_date, activity_id, wbs_id, location_id, planned_qty, uom, drawing_id, drawing_revision, cost_code_id, budget_amount, budget_line_ref, permit_required, permit_ref, hold_points, start_time, end_time, supervisor, in_plan, is_emergency, emergency_reason, regularise_by, status, requested_by, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(actor.companyId, no, s.org_project_id, s.id, x.f?.id ?? null, extra.dailyPlanId ?? null, b.planDate, x.a.id, x.wbsId, x.locationId, x.qty, b.uom ?? x.a.uom ?? null, b.drawingId ?? null, x.drawingRevision, b.costCodeId ?? null, Math.round((b.budgetAmount ?? 0) * 100), b.budgetLineRef ?? null, b.permitRequired ? 1 : 0, b.permitRef ?? null, b.holdPoints ?? null, b.startTime, b.endTime, b.supervisor ?? actor.user, inPlan ? 1 : 0, b.emergency ? 1 : 0, b.emergency ? b.emergencyReason : null, by, b.emergency ? 'EMERGENCY' : 'DRAFT', actor.user, s.org_project_id, s.id, actor.user, extra.sourceType ?? 'api', extra.sourceId ?? null).lastInsertRowid);
        const r = fresh(id); writeResources(actor, r, resourcesFor(r, x.a, b)); const checks = checksOf(actor, r); db.prepare('UPDATE site_work_authorisations SET checks_json = ? WHERE id = ?').run(JSON.stringify(checks), id);
        audit(actor, 'site_work_authorisations', id, b.emergency ? 'emergency' : 'create', actor.companyId, { newValues: { activity: x.a.code, qty: b.plannedQty, date: b.planDate, emergency: Boolean(b.emergency), reason: b.emergencyReason ?? undefined } });
        if (b.emergency) {
          const e = fresh(id); refreshFront(e.work_front_id); event('site.wa.approved', e, waEventData(e, actor.user));
          notify(actor.companyId, 'site.wa.regularise', [actor.user], no, x.a.code, `Emergency work ${no} on ${x.a.code} started: send it for regularisation by ${by.slice(0, 16).replace('T', ' ')} UTC.`, `/site/work-authorisations?id=${id}`, id);
        }
        return was.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'site.work_authorisation.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this work authorisation; reload it.');
      const s = siteOf(actor, r.wa_site_id); const cur = { activityId: r.activity_id, workFrontId: r.work_front_id, wbsId: r.wbs_id, locationId: r.location_id, plannedQty: d3(r.planned_qty), drawingId: r.drawing_id, drawingRevision: r.drawing_revision, costCodeId: r.cost_code_id, startTime: r.start_time, endTime: r.end_time };
      const m = { ...cur, ...b }; if ('drawingId' in b && !('drawingRevision' in b)) m.drawingRevision = null; const x = resolve(actor, s, m, r.id);
      return transaction(db, () => {
        db.prepare(`UPDATE site_work_authorisations SET activity_id = ?, work_front_id = ?, wbs_id = ?, location_id = ?, planned_qty = ?, uom = ?, drawing_id = ?, drawing_revision = ?, cost_code_id = ?, budget_amount = ?, budget_line_ref = ?, permit_required = ?, permit_ref = ?, hold_points = ?, start_time = ?, end_time = ?, supervisor = ?, plan_date = ?, in_plan = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
          .run(x.a.id, m.workFrontId ?? null, x.wbsId, x.locationId, x.qty, b.uom ?? r.uom ?? x.a.uom ?? null, m.drawingId ?? null, x.drawingRevision, m.costCodeId ?? null, 'budgetAmount' in b ? Math.round((b.budgetAmount ?? 0) * 100) : r.budget_amount, 'budgetLineRef' in b ? b.budgetLineRef : r.budget_line_ref, 'permitRequired' in b ? (b.permitRequired ? 1 : 0) : r.permit_required, 'permitRef' in b ? b.permitRef : r.permit_ref, 'holdPoints' in b ? b.holdPoints : r.hold_points, m.startTime, m.endTime, b.supervisor ?? r.supervisor, b.planDate ?? r.plan_date, (r.daily_plan_id && x.a.id === r.activity_id) || inWeeklyPlan(actor, r.org_project_id, x.a.id, b.planDate ?? r.plan_date) ? 1 : 0, actor.user, nowIso(), r.id);
        const n = fresh(r.id); if ('crews' in b || 'resources' in b || x.qty !== r.planned_qty || x.a.id !== r.activity_id) writeResources(actor, n, resourcesFor(n, x.a, { crews: b.crews ?? resources(r.id).filter((y) => y.crew_id).map((y) => ({ crewId: y.crew_id, headcount: y.headcount })), resources: b.resources }));
        db.prepare('UPDATE site_work_authorisations SET checks_json = ? WHERE id = ?').run(JSON.stringify(checksOf(actor, n)), r.id);
        const changed = { ...b }; delete changed.rowVersion; audit(actor, 'site_work_authorisations', r.id, 'update', r.company_id, { oldValues: cur, newValues: changed }); return was.get(actor, r.id);
      });
    },
    /** The board moves a WA in draft to another front of its site (server-validated; the board undoes by moving it back). */
    move(actor, id, { workFrontId }) {
      const r = row(actor, id, 'site.work_authorisation.edit'); mustEdit(r); const f = workFrontId ? frontRow(workFrontId) : null; if (workFrontId && (!f || f.wf_site_id !== r.wa_site_id)) fail([{ field: 'workFrontId', message: 'Choose a work front of the site' }]);
      return transaction(db, () => { db.prepare('UPDATE site_work_authorisations SET work_front_id = ?, location_id = COALESCE(?, location_id), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(f?.id ?? null, f?.location_id ?? null, actor.user, nowIso(), r.id); audit(actor, 'site_work_authorisations', r.id, 'move', r.company_id, { oldValues: { workFrontId: r.work_front_id }, newValues: { workFrontId: f?.id ?? null } }); refreshFront(r.work_front_id); refreshFront(f?.id); return was.get(actor, r.id); });
    },
    remove(actor, id) { const r = row(actor, id, 'site.work_authorisation.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { const now = nowIso(); db.prepare('UPDATE site_wa_resources SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE wa_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE site_daily_plan_lines SET wa_id = NULL WHERE wa_id = ?').run(r.id); db.prepare('UPDATE site_work_authorisations SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'site_work_authorisations', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    /** Send for approval: the construction manager, and the project manager too when the work is outside the plan or an emergency (regularisation). The checks are made again (CP-SITE-01). */
    submit(actor, id) {
      const r = row(actor, id, 'site.work_authorisation.submit'); const regularise = r.status === 'EMERGENCY' && !r.workflow_instance_id;
      if (!editable(r) && !regularise) throw unprocessable('Only a draft, a returned WA or an emergency WA waiting for regularisation is sent for approval.');
      const a = db.prepare('SELECT * FROM plan_activities WHERE id = ?').get(r.activity_id); if (!regularise) { const over = checkQty(r.company_id, a, r.planned_qty, r.id); if (over) fail([over]); }
      if (!resources(r.id).some((x) => x.resource_type === 'LABOUR') && !r.is_emergency) fail([{ field: 'crews', message: 'Name the crew (or the labour by trade) the work is authorised for' }]);
      return transaction(db, () => {
        const checks = checksOf(actor, r); db.prepare('UPDATE site_work_authorisations SET checks_json = ? WHERE id = ?').run(JSON.stringify(checks), r.id);
        if (!regularise) enforceChecks(actor, r, checks);
        const ctx = { projectId: r.org_project_id, siteId: r.wa_site_id, escalate: !r.in_plan || r.is_emergency ? 'yes' : 'no', emergency: r.is_emergency ? 'yes' : 'no', plannedQty: d3(r.planned_qty) };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: WA_DOC, docId: String(r.id), comment: `${r.wa_no}${r.is_emergency ? ' (emergency, regularisation)' : ''}`.slice(0, 300), context: ctx }); db.prepare('UPDATE site_work_authorisations SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        // an emergency WA stays usable while it is regularised
        db.prepare(`UPDATE site_work_authorisations SET status = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(regularise ? 'EMERGENCY' : 'SUBMITTED', actor.user, actor.user, nowIso(), r.id);
        audit(actor, 'site_work_authorisations', r.id, regularise ? 'regularise' : 'submit', r.company_id, { newValues: ctx }); return was.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (!r.workflow_instance_id || !['SUBMITTED', 'EMERGENCY'].includes(r.status)) throw unprocessable('Only a WA waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return was.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'site.work_authorisation.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a WA that is not approved is cancelled; an approved one is closed or revised.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE site_work_authorisations SET status = 'CANCELLED', reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'site_work_authorisations', r.id, 'cancel', r.company_id, { reason }); return was.get(actor, r.id); });
    },
    /** An approved WA is changed by a revision: a draft copy (with its resources) that replaces it when approved. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'site.work_authorisation.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved WA is revised.'); if (db.prepare("SELECT 1 FROM site_work_authorisations WHERE parent_wa_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('A revision of this WA is open.');
      return transaction(db, () => {
        const cols = ['org_project_id', 'wa_site_id', 'work_front_id', 'daily_plan_id', 'plan_date', 'activity_id', 'wbs_id', 'location_id', 'planned_qty', 'uom', 'drawing_id', 'drawing_revision', 'cost_code_id', 'budget_amount', 'budget_line_ref', 'permit_required', 'permit_ref', 'hold_points', 'start_time', 'end_time', 'supervisor', 'in_plan', 'checks_json', 'project_id', 'site_id'];
        const nid = Number(db.prepare(`INSERT INTO site_work_authorisations (company_id, wa_no, ${cols.join(', ')}, revision_no, parent_wa_id, status, reason, requested_by, created_by, source_type, source_id) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, 'DRAFT', ?, ?, ?, 'site_wa', ?)`)
          .run(r.company_id, number(r.company_id, actor.user, WA_DOC, 'site_work_authorisations', 'wa_no', 'WA'), ...cols.map((c) => r[c]), r.revision_no + 1, r.id, reason, actor.user, actor.user, String(r.id)).lastInsertRowid);
        writeResources(actor, fresh(nid), resources(r.id).map((x) => ({ ...x, actual_qty: 0 }))); audit(actor, 'site_work_authorisations', nid, 'amend', r.company_id, { reason, newValues: { from: r.wa_no } }); return was.get(actor, nid);
      });
    },
    /** FR-04: the quantity done (the DPR quantities by default) and what each resource used; a material used beyond the tolerance needs the reason (BR-03). */
    close(actor, id, b) {
      const r = row(actor, id, 'site.work_authorisation.close'); if (r.status !== 'APPROVED') throw unprocessable(r.status === 'EMERGENCY' ? 'Regularise the emergency WA before it is closed.' : 'Only an approved WA is closed.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this work authorisation; reload it.');
      const tol = Number(control(r.company_id).closePct ?? 10); const res = resources(r.id); const p = []; const given = new Map((b.resources ?? []).map((x) => [x.id, q3(x.actualQty)]));
      for (const id2 of given.keys()) if (!res.some((x) => x.id === id2)) p.push({ field: 'resources', message: `Resource ${id2} is not of this WA` });
      const after = res.map((x) => ({ ...x, actual_qty: given.has(x.id) ? given.get(x.id) : x.actual_qty }));
      const beyond = after.filter((x) => x.resource_type === 'MATERIAL' && (x.planned_qty > 0 ? Math.abs(x.actual_qty - x.planned_qty) * 100 > x.planned_qty * tol : x.actual_qty > 0));
      if (beyond.length && !b.varianceReason) p.push({ field: 'varianceReason', message: `Say why ${beyond.map((x) => x.label).join(', ')} differ from what was authorised by more than ${tol} %` }); fail(p);
      const actual = b.actualQty != null ? q3(b.actualQty) : db.prepare("SELECT COALESCE(SUM(qty), 0) AS n FROM site_wa_uses WHERE wa_id = ? AND use_kind = 'DPR' AND deleted_at IS NULL").get(r.id).n;
      return transaction(db, () => {
        for (const x of after) db.prepare('UPDATE site_wa_resources SET actual_qty = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(x.actual_qty, actor.user, nowIso(), x.id);
        db.prepare("UPDATE site_work_authorisations SET status = 'CLOSED', actual_qty = ?, closure_notes = ?, variance_reason = ?, closed_at = ?, closed_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actual, b.closureNotes ?? null, b.varianceReason ?? null, nowIso(), actor.user, actor.user, nowIso(), r.id);
        protocolOf(db).markStage(r.company_id, 'site_wa', r.id, 'CLOSE', null, actor.user);
        const n = fresh(r.id); audit(actor, 'site_work_authorisations', r.id, 'close', r.company_id, { newValues: { actualQty: d3(actual), variance: beyond.map((x) => x.label), reason: b.varianceReason ?? undefined } }); refreshFront(r.work_front_id);
        event('site.wa.closed', n, { waId: n.id, waNo: n.wa_no, projectId: n.org_project_id, siteId: n.wa_site_id, planDate: n.plan_date, activityId: n.activity_id, plannedQty: d3(n.planned_qty), actualQty: d3(actual), uom: n.uom, resources: after.map((x) => ({ type: x.resource_type, key: x.res_key, label: x.label, uom: x.uom, planned: d3(x.planned_qty), actual: d3(x.actual_qty) })), varianceReason: n.variance_reason, by: actor.user });
        return was.get(actor, r.id);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'site_work_authorisations' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'site.work_authorisation.print'); const v = view(actor, r, { detail: true }); const tr = (c, h = false) => `<tr>${c.map((x) => `<${h ? 'th' : 'td'}>${esc(x)}</${h ? 'th' : 'td'}>`).join('')}</tr>`; audit(actor, 'site_work_authorisations', r.id, 'print', r.company_id);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.waNo)}</title></head><body>${['APPROVED', 'CLOSED', 'EMERGENCY'].includes(v.status) ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED AUTHORISATION</strong></p>`}<h1>Work authorisation ${esc(v.waNo)}${v.emergency ? ' (EMERGENCY)' : ''}</h1>`
        + `<p>${esc(v.projectCode)} ${esc(v.projectName)} · site ${esc(v.siteCode)} ${esc(v.siteName)}${v.workFront ? ` · front ${esc(v.workFront)}` : ''} · ${esc(v.planDate)} ${esc(v.startTime)}–${esc(v.endTime)} · supervisor ${esc(v.supervisor)}</p>`
        + `<p>Activity ${esc(v.activity)}${v.wbs ? ` · WBS ${esc(v.wbs)}` : ''}${v.location ? ` · ${esc(v.location)}` : ''}: <strong>${v.plannedQty} ${esc(v.uom ?? '')}</strong>${v.actualQty != null ? ` · done ${v.actualQty}` : ''}</p>`
        + `<p>Drawing ${esc(v.drawing ?? '—')} rev ${esc(v.drawingRevision ?? '—')} · permit ${v.permitRequired ? esc(v.permitRef ?? 'NEEDED') : 'not needed'} · hold points ${esc(v.holdPoints ?? 'none')}</p>`
        + `<h2>Resources</h2><table border="1" cellpadding="3">${tr(['Type', 'Resource', 'Unit', 'Authorised', 'Used'], true)}${v.resources.map((x) => tr([x.typeLabel, x.label, x.uom, x.plannedQty, x.actualQty])).join('')}</table>`
        + `<h2>Checks</h2><table border="1" cellpadding="3">${tr(['Check', 'Result', 'Detail'], true)}${v.checks.map((c) => tr([c.code, c.result, c.message])).join('')}</table>`
        + `<p>${v.approvedAt ? `Approved by ${esc(v.approvedBy)} on ${esc(v.approvedAt.slice(0, 10))}` : `Raised by ${esc(v.requestedBy ?? '')}`}</p></body></html>`;
    },
    /** The approval engine's decision (its hook runs in the same transaction): the drawing and the permit are checked once more, so a WA is not approved on what changed since it was sent. */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || !['SUBMITTED', 'EMERGENCY'].includes(r.status)) return; const now = nowIso(); const who = { user: actor.user, companyId: r.company_id, roles: [] };
      if (outcome === 'APPROVED') {
        const checks = checksOf(who, r, { budget: false }); enforceChecks(who, r, checks);
        db.prepare("UPDATE site_work_authorisations SET status = 'APPROVED', checks_json = ?, approved_by = ?, approved_at = ?, regularised_at = CASE WHEN is_emergency = 1 THEN ? ELSE regularised_at END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(checks), actor.user, now, now, actor.user, now, r.id);
        if (r.parent_wa_id) { db.prepare("UPDATE site_work_authorisations SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_wa_id); db.prepare('UPDATE site_wa_uses SET wa_id = ? WHERE wa_id = ?').run(r.id, r.parent_wa_id); }
        audit(actor, 'site_work_authorisations', r.id, r.is_emergency ? 'regularised' : 'approve', r.company_id); protocolOf(db).markStage(r.company_id, 'site_wa', r.id, 'APPROVE', 'CP-SITE-01', actor.user);
        const n = fresh(r.id); refreshFront(n.work_front_id); if (!r.is_emergency) event('site.wa.approved', n, waEventData(n, actor.user));
        notify(r.company_id, 'site.wa.approved', [r.requested_by, r.supervisor], r.wa_no, `${r.plan_date}`, `${r.wa_no} is ${r.is_emergency ? 'regularised' : 'approved'} for ${r.plan_date}.`, `/site/work-authorisations?id=${r.id}`, r.id);
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      // an emergency WA that is withdrawn, returned or rejected stays an emergency: the work was done and still waits to be regularised
      const to = r.is_emergency ? (outcome === 'REJECTED' ? 'REJECTED' : 'EMERGENCY') : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE site_work_authorisations SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn || (r.is_emergency && to === 'EMERGENCY') ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'site_work_authorisations', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'site.wa.rejected', [r.requested_by], r.wa_no, r.plan_date, `${r.wa_no} was not approved${comment ? `: ${comment}` : ''}.`, `/site/work-authorisations?id=${r.id}`, r.id);
    },
  };
  function waEventData(r, by) {
    return { waId: r.id, waNo: r.wa_no, projectId: r.org_project_id, siteId: r.wa_site_id, workFrontId: r.work_front_id, planDate: r.plan_date, startTime: r.start_time, endTime: r.end_time, activityId: r.activity_id, wbsId: r.wbs_id, locationId: r.location_id, plannedQty: d3(r.planned_qty), uom: r.uom, supervisor: r.supervisor, emergency: Boolean(r.is_emergency),
      resources: resources(r.id).map((x) => ({ type: x.resource_type, key: x.res_key, itemId: x.item_id, trade: x.trade, crewId: x.crew_id, headcount: x.headcount, label: x.label, uom: x.uom, qty: d3(x.planned_qty) })), by };
  }

  // ---- FR-02: daily work plans --------------------------------------------------------------------------------------------------------------------------------------------------------
  const dpRow = (actor, id, key = 'site.daily_plan.view') => { const r = db.prepare('SELECT * FROM site_daily_plans WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'site.daily_plan.view', r.org_project_id, r.dp_site_id)) throw notFound('That daily work plan does not exist.'); if (key !== 'site.daily_plan.view') need(actor, key, 'do that with a daily plan', r.org_project_id, r.dp_site_id); return r; };
  const dpView = (actor, r) => {
    const s = db.prepare('SELECT s.code, s.name, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.dp_site_id); const can = (k) => may(actor, k, r.org_project_id, r.dp_site_id);
    const lines = db.prepare('SELECT l.*, a.code AS acode, a.name AS aname, a.qty AS aqty, a.pct_complete, f.code AS fcode, f.name AS fname, c.code AS ccode, c.name AS cname, c.trade, w.wa_no, w.status AS wstatus FROM site_daily_plan_lines l JOIN plan_activities a ON a.id = l.activity_id LEFT JOIN site_work_fronts f ON f.id = l.work_front_id LEFT JOIN hr_crews c ON c.id = l.crew_id LEFT JOIN site_work_authorisations w ON w.id = l.wa_id WHERE l.plan_id = ? AND l.deleted_at IS NULL ORDER BY l.id').all(r.id);
    return { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, projectCode: s?.pcode, siteId: r.dp_site_id, siteCode: s?.code, siteName: s?.name, planDate: r.plan_date, supervisor: r.supervisor, status: r.status, statusLabel: DAILY_STATUS[r.status], note: r.note, copiedFromId: r.copied_from_id, issuedAt: r.issued_at, issuedBy: r.issued_by, rowVersion: r.version,
      lines: lines.map((l) => ({ id: l.id, activityId: l.activity_id, activity: `${l.acode} ${l.aname}`, workFrontId: l.work_front_id, workFront: l.fname ? `${l.fcode} ${l.fname}` : null, crewId: l.crew_id, crew: l.ccode ? `${l.ccode} ${l.cname} (${l.trade})` : null, plannedQty: d3(l.planned_qty), uom: l.uom, weeklyItemId: l.weekly_item_id, fromWeekly: Boolean(l.weekly_item_id), waId: l.wa_id, waNo: l.wa_no, waStatus: l.wstatus })),
      can: { edit: can('site.daily_plan.manage') && r.status === 'DRAFT', issue: can('site.daily_plan.manage') && can('site.work_authorisation.create') && r.status === 'DRAFT', cancel: can('site.daily_plan.manage') && r.status === 'DRAFT' } };
  };
  /** The front a line goes to: the front of the site whose location is the activity's. */
  const frontFor = (siteId, activityId) => { const a = db.prepare('SELECT location_id FROM plan_activities WHERE id = ?').get(activityId); return a?.location_id ? db.prepare('SELECT id FROM site_work_fronts WHERE wf_site_id = ? AND location_id = ? AND deleted_at IS NULL ORDER BY sort_order LIMIT 1').get(siteId, a.location_id)?.id ?? null : null; };
  function checkLines(actor, s, lines) {
    const p = []; lines.forEach((l, i) => {
      const a = activityOf(s.org_project_id, l.activityId); if (!a || a.org_project_id !== s.org_project_id) p.push({ field: `lines.${i}.activityId`, message: 'Choose an activity of the project' });
      if (l.workFrontId) { const f = frontRow(l.workFrontId); if (!f || f.wf_site_id !== s.id) p.push({ field: `lines.${i}.workFrontId`, message: 'Choose a work front of the site' }); }
      if (l.crewId) { const c = db.prepare('SELECT crew_site_id FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(l.crewId, actor.companyId); if (!c || c.crew_site_id !== s.id) p.push({ field: `lines.${i}.crewId`, message: 'Choose a crew of the site' }); }
    }); fail(p);
  }
  const writeLines = (actor, r, lines) => { db.prepare('UPDATE site_daily_plan_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE plan_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id); for (const l of lines) db.prepare("INSERT INTO site_daily_plan_lines (company_id, plan_id, activity_id, work_front_id, crew_id, planned_qty, uom, weekly_item_id, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'site_daily_plan')").run(r.company_id, r.id, l.activityId, l.workFrontId ?? frontFor(r.dp_site_id, l.activityId), l.crewId ?? null, q3(l.plannedQty), l.uom ?? db.prepare('SELECT uom FROM plan_activities WHERE id = ?').get(l.activityId)?.uom ?? null, l.weeklyItemId ?? null, r.org_project_id, r.dp_site_id, actor.user); };
  const daily = {
    list(actor, query) { if (!authz.check(actor, 'site.daily_plan.view').allowed) throw forbidden('You may not see daily work plans (permission site.daily_plan.view).'); const f = authz.scopeFilter(actor, 'site.daily_plan.view', { project: 'x.org_project_id', site: 'x.dp_site_id' }); return runList(db, dailyList, parseListRequest(dailyList, query), { select: 'x.*, p.code AS pcode, s.code AS scode, (SELECT COUNT(*) FROM site_daily_plan_lines l WHERE l.plan_id = x.id AND l.deleted_at IS NULL) AS n', scopeSql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) }, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, planDate: x.plan_date, project: x.pcode, site: x.scode, siteId: x.dp_site_id, supervisor: x.supervisor, lines: x.n, status: x.status, statusLabel: DAILY_STATUS[x.status] }) }); },
    get(actor, id) { return dpView(actor, dpRow(actor, id)); },
    /** A new plan for a site, a day and a supervisor: from the approved weekly plans of the day (13.04), as a copy of the supervisor's plan of the day before, or empty. */
    create(actor, b) {
      const s = siteOf(actor, b.siteId, 'site.daily_plan.manage'); const sup = b.supervisor ?? actor.user;
      if (db.prepare("SELECT 1 FROM site_daily_plans WHERE dp_site_id = ? AND plan_date = ? AND lower(supervisor) = lower(?) AND deleted_at IS NULL AND status <> 'CANCELLED'").get(s.id, b.planDate, sup)) throw conflict(`${sup} already has a plan for ${b.planDate} on this site.`);
      let lines = []; let from = null; let weeklyId = null;
      if (b.from === 'WEEKLY') {
        const rows = planOf(db)?.lookahead?.dailyPlan(actor, s.org_project_id, b.planDate).rows ?? []; const siteCrews = new Set(db.prepare('SELECT id FROM hr_crews WHERE crew_site_id = ?').all(s.id).map((c) => c.id));
        const mine = rows.filter((x) => { const wp = db.prepare('SELECT wp_site_id FROM plan_weekly_plans WHERE id = ?').get(x.planId); return !wp?.wp_site_id || wp.wp_site_id === s.id || (x.crewId && siteCrews.has(x.crewId)); });
        lines = mine.map((x) => ({ activityId: x.activityId, crewId: x.crewId && siteCrews.has(x.crewId) ? x.crewId : null, plannedQty: x.qty, uom: x.uom, weeklyItemId: x.itemId })); weeklyId = mine[0]?.planId ?? null;
        if (!lines.length) throw unprocessable(`No approved weekly plan has work on ${b.planDate} for this site. Approve the weekly plan (13.04) or start from an empty plan.`);
      } else if (b.from === 'YESTERDAY') {
        const prev = db.prepare("SELECT * FROM site_daily_plans WHERE dp_site_id = ? AND lower(supervisor) = lower(?) AND plan_date < ? AND deleted_at IS NULL AND status <> 'CANCELLED' ORDER BY plan_date DESC, id DESC").get(s.id, sup, b.planDate);
        if (!prev) throw unprocessable('There is no earlier plan of this supervisor on this site to copy.'); from = prev.id;
        lines = db.prepare('SELECT l.activity_id, l.work_front_id, l.crew_id, l.planned_qty, l.uom, a.pct_complete FROM site_daily_plan_lines l JOIN plan_activities a ON a.id = l.activity_id WHERE l.plan_id = ? AND l.deleted_at IS NULL').all(prev.id).filter((l) => l.pct_complete < 10000).map((l) => ({ activityId: l.activity_id, workFrontId: l.work_front_id, crewId: l.crew_id, plannedQty: d3(l.planned_qty), uom: l.uom }));
      } else lines = b.lines ?? [];
      if (b.from !== 'YESTERDAY') checkLines(actor, s, lines.map((l) => ({ ...l, crewId: l.crewId })));
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO site_daily_plans (company_id, doc_no, org_project_id, dp_site_id, schedule_id, plan_date, supervisor, weekly_plan_id, copied_from_id, status, note, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)")
          .run(actor.companyId, number(actor.companyId, actor.user, 'SITE_DP', 'site_daily_plans', 'doc_no', 'DWP'), s.org_project_id, s.id, currentSchedule(actor.companyId, s.org_project_id)?.id ?? null, b.planDate, sup, weeklyId, from, b.note ?? null, s.org_project_id, s.id, actor.user, b.from === 'WEEKLY' ? 'plan_weekly_plan' : b.from === 'YESTERDAY' ? 'site_daily_plan' : 'api').lastInsertRowid);
        writeLines(actor, db.prepare('SELECT * FROM site_daily_plans WHERE id = ?').get(id), lines); audit(actor, 'site_daily_plans', id, 'create', actor.companyId, { newValues: { date: b.planDate, from: b.from, lines: lines.length } }); return daily.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = dpRow(actor, id, 'site.daily_plan.manage'); if (r.status !== 'DRAFT') throw conflict(`${r.doc_no} is ${lower(DAILY_STATUS[r.status])}: it is not changed.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this plan; reload it.');
      const s = siteOf(actor, r.dp_site_id, 'site.daily_plan.manage'); if (b.lines) checkLines(actor, s, b.lines);
      return transaction(db, () => { if (b.lines) writeLines(actor, r, b.lines); db.prepare('UPDATE site_daily_plans SET note = COALESCE(?, note), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.note ?? null, actor.user, nowIso(), r.id); audit(actor, 'site_daily_plans', r.id, 'update', r.company_id, { newValues: { lines: b.lines?.length } }); return daily.get(actor, r.id); });
    },
    cancel(actor, id, { reason }) { const r = dpRow(actor, id, 'site.daily_plan.manage'); if (r.status !== 'DRAFT') throw unprocessable('Only a draft plan is cancelled; the WAs of an issued plan are cancelled one by one.'); db.prepare("UPDATE site_daily_plans SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'site_daily_plans', r.id, 'cancel', r.company_id, { reason }); return daily.get(actor, r.id); },
    /** Issue: each line becomes a WA in draft (in the plan), with the time window given; the WAs go for approval from their own page or the mobile screen. */
    issue(actor, id, b) {
      const r = dpRow(actor, id, 'site.daily_plan.manage'); need(actor, 'site.work_authorisation.create', 'raise work authorisations', r.org_project_id, r.dp_site_id); if (r.status !== 'DRAFT') throw conflict(`${r.doc_no} is ${lower(DAILY_STATUS[r.status])}.`);
      const lines = db.prepare('SELECT * FROM site_daily_plan_lines WHERE plan_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id); if (!lines.length) fail([{ field: 'lines', message: 'Add the work of the day first' }]);
      return transaction(db, () => {
        const made = [];
        lines.forEach((l, i) => {
          try {
            const w = was.create(actor, { siteId: r.dp_site_id, planDate: r.plan_date, activityId: l.activity_id, workFrontId: l.work_front_id ?? undefined, plannedQty: d3(l.planned_qty), uom: l.uom ?? undefined, startTime: b.startTime, endTime: b.endTime, supervisor: r.supervisor, crews: l.crew_id ? [{ crewId: l.crew_id }] : [] }, { dailyPlanId: r.id, inPlan: Boolean(l.weekly_item_id) || undefined, sourceType: 'site_daily_plan', sourceId: String(r.id) });
            db.prepare('UPDATE site_daily_plan_lines SET wa_id = ? WHERE id = ?').run(w.id, l.id); made.push(w.id);
          } catch (e) { if (e?.status === 400) throw badRequest('Correct the highlighted lines', (e.details ?? []).map((d) => ({ ...d, field: `lines.${i}.${d.field}` }))); throw e; }
        });
        db.prepare("UPDATE site_daily_plans SET status = 'ISSUED', issued_at = ?, issued_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, actor.user, nowIso(), r.id); audit(actor, 'site_daily_plans', r.id, 'issue', r.company_id, { newValues: { was: made.length } });
        publishEvent(db, { type: 'site.daily_plan.issued', entity: 'site_daily_plan', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.dp_site_id, data: { planId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.dp_site_id, planDate: r.plan_date, supervisor: r.supervisor, waIds: made } });
        return daily.get(actor, r.id);
      });
    },
  };

  // ---- FR-06: the board of a site for a day -----------------------------------------------------------------------------------------------------------------------------------------------
  function board(actor, { siteId, date }) {
    const s = siteOf(actor, siteId); const day = date ?? todayIST();
    const rows = db.prepare(`SELECT x.*, a.code AS acode, a.name AS aname FROM site_work_authorisations x JOIN plan_activities a ON a.id = x.activity_id WHERE x.wa_site_id = ? AND x.plan_date = ? AND x.deleted_at IS NULL AND x.status NOT IN ('CANCELLED', 'SUPERSEDED') ORDER BY x.start_time, x.id`).all(s.id, day);
    const card = (x) => ({ id: x.id, waNo: x.wa_no, activity: `${x.acode} ${x.aname}`, plannedQty: d3(x.planned_qty), actualQty: d3(x.actual_qty), uom: x.uom, startTime: x.start_time, endTime: x.end_time, supervisor: x.supervisor, crews: resources(x.id).filter((y) => y.resource_type === 'LABOUR').map((y) => `${y.label}${y.headcount != null ? ` × ${y.headcount}` : ''}`), emergency: Boolean(x.is_emergency), overdue: x.status === 'EMERGENCY' && x.regularise_by < nowIso(), inPlan: Boolean(x.in_plan), status: x.status, statusLabel: WA_STATUS[x.status], movable: editable(x), checksFailed: json(x.checks_json, []).filter((c) => c.result === 'FAIL').length });
    const fr = db.prepare('SELECT * FROM site_work_fronts WHERE wf_site_id = ? AND deleted_at IS NULL ORDER BY sort_order, code').all(s.id);
    const lanes = fr.map((f) => { const v = frontView(f, false, day); return { ...v, was: rows.filter((x) => x.work_front_id === f.id).map(card) }; });
    const loose = rows.filter((x) => !x.work_front_id || !fr.some((f) => f.id === x.work_front_id)).map(card);
    const count = (st) => rows.filter((x) => st.includes(x.status)).length;
    return { site: { id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode }, date: day, lanes, unassigned: loose, totals: { authorised: count(['APPROVED', 'EMERGENCY']), waiting: count(['SUBMITTED']), draft: count(['DRAFT', 'RETURNED']), closed: count(['CLOSED']), emergencies: count(['EMERGENCY']) },
      can: { create: may(actor, 'site.work_authorisation.create', s.org_project_id, s.id), move: may(actor, 'site.work_authorisation.edit', s.org_project_id, s.id), manageFronts: may(actor, 'site.work_front.manage', s.org_project_id, s.id) } };
  }
  /** The sites a person may see, for the pickers. */
  const sites = (actor) => db.prepare("SELECT s.id, s.code, s.name, s.org_project_id, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE' ORDER BY p.code, s.code").all(actor.companyId).filter((s) => may(actor, 'site.work_authorisation.view', s.org_project_id, s.id) || may(actor, 'site.daily_plan.view', s.org_project_id, s.id)).map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode }));

  // ---- FR-04 on a phone: what waits for me to approve, and the WAs of today I can close --------------------------------------------------------------------------------------------------
  function mobile(actor, { date }) {
    const day = date ?? todayIST(); const tasks = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.filter((t) => t.instance?.docType === WA_DOC);
    const toApprove = tasks.map((t) => { const r = fresh(rid(t.instance.docId)); if (!r) return null; try { return { taskId: t.id, taskVersion: t.version, step: t.step, ...view(actor, row(actor, r.id), { detail: true }) }; } catch { return null; } }).filter(Boolean);
    const sc = scope(actor, 'site.work_authorisation.close');
    const toClose = authz.check(actor, 'site.work_authorisation.close').allowed ? db.prepare(`SELECT x.id FROM site_work_authorisations x WHERE ${sc.sql} AND x.deleted_at IS NULL AND x.status = 'APPROVED' AND x.plan_date <= :day ORDER BY x.plan_date DESC, x.start_time LIMIT 50`).all({ ...sc.params, day }).map((x) => view(actor, row(actor, x.id), { detail: true })) : [];
    return { date: day, toApprove, toClose };
  }

  // ---- FR-07: attendance, material issue, plant logs, DPR and measurement name a WA ---------------------------------------------------------------------------------------------------------
  /**
   * Record a use against a WA (or without one). Within the WA it passes and adds to what the resource used; without a WA, on a WA that is not live, or beyond what it authorises (with the
   * tolerance), CP-SITE-02 asks for an approved exception (ENFORCE) or writes a warning (WARN, OBSERVE). The same source is recorded once (a replay returns the first answer).
   */
  function recordUse(actor, b) {
    const o = db.prepare('SELECT id, code, company_id FROM org_projects WHERE id = ?').get(b.projectId); if (!o || o.company_id !== actor.companyId || !may(actor, 'site.wa.use', o.id, b.siteId ?? null)) throw notFound('That project does not exist.');
    const dup = db.prepare("SELECT * FROM site_wa_uses WHERE company_id = ? AND use_kind = ? AND src_entity = ? AND src_id = ? AND COALESCE(res_key, '') = ? AND deleted_at IS NULL").get(actor.companyId, b.kind, b.srcEntity, b.srcId, resKeyOf(b) ?? ''); if (dup) return useView(dup, true);
    const w = b.waId ? db.prepare('SELECT * FROM site_work_authorisations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.waId, actor.companyId) : null; if (b.waId && (!w || w.org_project_id !== o.id)) fail([{ field: 'waId', message: 'Choose a work authorisation of the project' }]);
    const tol = Number(control(actor.companyId).usePct ?? 5); const qty = q3(b.qty ?? 0); const key = resKeyOf(b); let deviation = null; let res = null;
    if (!w) deviation = `${USE_KINDS[b.kind]} ${b.srcEntity} ${b.srcId} names no work authorisation.`;
    else if (!LIVE.includes(w.status)) deviation = `${w.wa_no} is ${lower(WA_STATUS[w.status])}: work is booked only against an approved WA.`;
    else if (b.date && b.date !== w.plan_date) deviation = `${w.wa_no} is for ${w.plan_date}, not ${b.date}.`;
    else if (['DPR', 'MEASUREMENT'].includes(b.kind)) { const done = db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM site_wa_uses WHERE wa_id = ? AND use_kind = ? AND deleted_at IS NULL').get(w.id, b.kind).n; if ((done + qty) * 100 > w.planned_qty * (100 + tol)) deviation = `${d3(done + qty)} ${w.uom ?? ''} is beyond the ${d3(w.planned_qty)} authorised by ${w.wa_no} (tolerance ${tol} %).`; }
    else {
      res = db.prepare('SELECT * FROM site_wa_resources WHERE wa_id = ? AND resource_type = ? AND deleted_at IS NULL AND (lower(res_key) = lower(?) OR (? IS NOT NULL AND crew_id = ?)) ORDER BY id LIMIT 1').get(w.id, typeOf(b), key ?? '', b.crewId ?? null, b.crewId ?? null);
      if (!res) deviation = `${w.wa_no} does not authorise ${b.label ?? key ?? lower(RES_TYPES[typeOf(b)])}.`;
      else if ((res.actual_qty + qty) * 100 > res.planned_qty * (100 + tol)) deviation = `${d3(res.actual_qty + qty)} ${res.uom} of ${res.label} is beyond the ${d3(res.planned_qty)} authorised by ${w.wa_no} (tolerance ${tol} %).`;
    }
    return transaction(db, () => {
      const entityId = `${b.kind}:${b.srcEntity}:${b.srcId}${key ? `:${key}` : ''}`;
      const c = protocolOf(db).enforce(actor, 'CP-SITE-02', { entity: 'site_wa_use', entityId, deviation, waNo: w?.wa_no ?? null, kind: b.kind, ref: `${b.srcEntity} ${b.srcId}`, projectId: o.id, siteId: w?.wa_site_id ?? b.siteId ?? null }, { source: b.srcEntity });
      const result = !deviation ? 'PASS' : c.result === 'EXCEPTED' ? 'EXCEPTED' : c.observed ? 'OBSERVED' : 'WARN';
      const id = Number(db.prepare("INSERT INTO site_wa_uses (company_id, org_project_id, wa_id, use_kind, src_entity, src_id, resource_type, res_key, qty, uom, use_date, result, control_result, exception_no, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(actor.companyId, o.id, w?.id ?? null, b.kind, b.srcEntity, b.srcId, ['DPR', 'MEASUREMENT'].includes(b.kind) ? null : typeOf(b), key, qty, b.uom ?? res?.uom ?? w?.uom ?? null, b.date ?? todayIST(), result, c.result, c.exceptionNo ?? null, o.id, w?.wa_site_id ?? b.siteId ?? null, actor.user, b.srcEntity, b.srcId).lastInsertRowid);
      if (res) db.prepare('UPDATE site_wa_resources SET actual_qty = actual_qty + ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(qty, actor.user, nowIso(), res.id);
      if (w && result === 'PASS') protocolOf(db).markStage(actor.companyId, 'site_wa', w.id, 'EXECUTE', 'CP-SITE-02', actor.user);
      audit(actor, 'site_wa_uses', id, 'record', actor.companyId, { newValues: { kind: b.kind, source: `${b.srcEntity} ${b.srcId}`, wa: w?.wa_no ?? null, qty: b.qty, result } });
      return useView(db.prepare('SELECT * FROM site_wa_uses WHERE id = ?').get(id), false, deviation);
    });
  }
  const typeOf = (b) => b.resourceType ?? ({ ATTENDANCE: 'LABOUR', MATERIAL_ISSUE: 'MATERIAL', PLANT_LOG: 'PLANT' })[b.kind] ?? null;
  const resKeyOf = (b) => (['DPR', 'MEASUREMENT'].includes(b.kind) ? null : b.itemId ? `item:${b.itemId}` : b.trade ? `${typeOf(b) === 'PLANT' ? 'plant' : 'trade'}:${lower(b.trade)}` : b.resKey ?? null);
  const useView = (u, replay, deviation = null) => ({ id: u.id, waId: u.wa_id, kind: u.use_kind, source: `${u.src_entity} ${u.src_id}`, resourceType: u.resource_type, key: u.res_key, qty: d3(u.qty), uom: u.uom, date: u.use_date, result: u.result, control: u.control_result, exceptionNo: u.exception_no, deviation, replay });
  /** The WAs live on a site for a day: what attendance, stores and plant validate against (07.05, 16.04, 17.03). */
  function active(actor, { siteId, date }) {
    const s = siteOf(actor, siteId); const day = date ?? todayIST();
    return db.prepare("SELECT * FROM site_work_authorisations WHERE wa_site_id = ? AND plan_date = ? AND status IN ('APPROVED', 'EMERGENCY') AND deleted_at IS NULL ORDER BY start_time").all(s.id, day).map((r) => ({ ...waEventData(r, null), waNo: r.wa_no, status: r.status }));
  }

  return { fronts, was, daily, board, sites, mobile, recordUse, active, waDecide: was.decide, refreshFront };
}
