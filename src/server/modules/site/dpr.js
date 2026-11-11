import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { isoOf, ordOf } from '../plan/cpm.js';

// The Daily Progress Report (part 14.02): the single daily record of site execution, prefilled from the day's work authorisations (14.01), the attendance (07.06), the material issues and the plant logs
// booked against them, confirmed or adjusted with a reason, sent by the cut-off, approved by the construction manager or the project manager and locked; a change after approval is an amendment that the
// project manager approves and that replaces it. The DPR of a site is one a day (BR-01); the report of a supervisor can be one of several that the site's DPR consolidates (FR-01).
export const DPR_DOC = 'SITE_DPR';
export const DPR_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded by an amendment' };
export const WEATHER = { CLEAR: 'Clear', CLOUDY: 'Cloudy', RAIN: 'Rain', HEAVY_RAIN: 'Heavy rain', STORM: 'Storm', FOG: 'Fog', HOT: 'Very hot', COLD: 'Cold' };
export const NOTE_TYPES = { HINDRANCE: 'Hindrance or delay', VISITOR: 'Visitor', INSTRUCTION: 'Instruction received', QUALITY: 'Quality observation', SAFETY: 'Safety observation or incident', NEXT_DAY: 'Plan for the next day' };
export const CATEGORIES = { STAFF: 'Own staff', CONTRACT: 'Contract labour' };
export const SCOPES = { SITE: 'Site', SUPERVISOR: 'Supervisor' };
const LIVE = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'];
const PRESENT = ['PRESENT', 'HALF_DAY', 'ON_DUTY', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED'];
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const q3 = (n) => Math.round(Number(n) * 1000);
const d3 = (n) => (n == null ? null : n / 1000);

for (const [key, dataType, def, description, extra] of [
  ['site.dpr.cutoff_time', 'string', '19:00', 'FR-05: the time of the day (HH:MM, India time) by which the daily progress report of the day is to be sent; one sent later is flagged late.', {}],
  ['site.dpr.qty_tolerance_pct', 'integer', 5, 'BR-01: how far, in percent, the quantity of a work line may be above what the work authorisation allows before the line needs a reason.', { min: 0, max: 100 }],
  ['site.dpr.labour_tolerance_pct', 'integer', 10, 'BR-02: how far, in percent, the man-days reported for a trade may differ from the attendance of the day before the line is flagged and needs a reason.', { min: 0, max: 100 }],
  ['site.dpr.distribution_roles', 'json', ['PM'], 'FR-06: the roles that are sent the daily progress report of their project when it is approved (a client contact is added when a client portal exists).', {}],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const dprList = defineList({
  code: 'site.dprs', label: 'Daily progress reports', permission: 'site.dpr.view',
  from: 'site_dprs x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.dpr_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 's.code', 'x.supervisor', 'x.summary'], defaultSort: '-dprDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'DPR no.' }, dprDate: { sql: 'x.dpr_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.dpr_site_id', type: 'number', label: 'Site id' }, supervisor: { sql: 'x.supervisor', type: 'text', label: 'Supervisor' },
    scope: { sql: 'x.scope', type: 'enum', label: 'Scope', options: Object.entries(SCOPES) }, late: { sql: 'x.late', type: 'enum', label: 'Late', options: [['1', 'Late'], ['0', 'On time']] },
    revisionNo: { sql: 'x.revision_no', type: 'number', label: 'Revision' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(DPR_STATUS) },
  },
});

/** @param {{ db: any, dayContext?: (companyId: number, siteId: number, date: string) => any }} deps */
export function createDprService({ db, dayContext = () => null }) {
  const authz = authzOf(db);
  const store = createParameterStore(db);
  const param = (companyId, key) => store.get(key, { companyId, date: todayIST() });
  const may = (actor, key, pid, sid = null) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid, siteId: sid }).allowed;
  const need = (actor, key, what, pid, sid = null) => { if (!may(actor, key, pid, sid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, recipients, ref, subject, detail, link, sourceId, scope = {}) => { if (!recipients.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients, data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId, ...scope }); } catch { /* saved anyway */ } };
  const number = (companyId, user) => {
    try { return issueNumber(db, { companyId, docType: DPR_DOC, actor: user, refType: 'site_dprs' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM site_dprs WHERE company_id = ?').get(companyId).n ?? 0) + 1; let no = `DPR/${String(n).padStart(6, '0')}`;
    for (let k = n + 1; db.prepare('SELECT 1 FROM site_dprs WHERE company_id = ? AND doc_no = ?').get(companyId, no); k += 1) no = `DPR/${String(k).padStart(6, '0')}`; return no;
  };
  const siteRow = (actor, siteId, key = 'site.dpr.view') => {
    const s = db.prepare('SELECT s.id, s.code, s.name, s.org_project_id, s.company_id, s.status, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ? AND s.deleted_at IS NULL').get(rid(siteId));
    if (!s || s.company_id !== actor.companyId || !may(actor, 'site.dpr.view', s.org_project_id, s.id)) throw notFound('That site does not exist.');
    if (key !== 'site.dpr.view') need(actor, key, 'do that for this site', s.org_project_id, s.id); return s;
  };
  const tolerances = (companyId) => ({ qty: Number(param(companyId, 'site.dpr.qty_tolerance_pct') ?? 5), labour: Number(param(companyId, 'site.dpr.labour_tolerance_pct') ?? 10) });
  const cutoffOf = (companyId, date, at) => {
    const t = String(param(companyId, 'site.dpr.cutoff_time') ?? '19:00'); const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '19:00'; const cut = Date.parse(`${date}T${hhmm}:00+05:30`); const when = Date.parse(at);
    return { cutoffAt: new Date(cut).toISOString(), late: when > cut ? 1 : 0, minutes: Math.max(0, Math.ceil((when - cut) / 60000)) };
  };

  // ---- the sources of a prefill (FR-02) -----------------------------------------------------------------------------------------------------------------------------------------------------
  /** Attendance of a site and day by category, contractor and trade (BR-02): a man-day is a full day present, half a day for a half day. `persons` limits it to the members of some crews. */
  function attendanceOf(companyId, siteId, date, persons = null) {
    const rows = db.prepare(`SELECT person_type, person_id, status, ot_minutes FROM att_daily WHERE company_id = ? AND daily_site_id = ? AND work_date = ? AND status IN (${PRESENT.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(companyId, siteId, date, ...PRESENT);
    const wq = db.prepare('SELECT trade_code, contractor_id FROM lab_workers WHERE root_id = ? AND company_id = ? AND deleted_at IS NULL ORDER BY (status = \'APPROVED\') DESC, revision_no DESC LIMIT 1');
    const eq = db.prepare('SELECT d.name AS trade FROM hr_employees e LEFT JOIN org_designations d ON d.id = e.designation_id WHERE e.id = ?');
    const out = new Map();
    for (const a of rows) {
      if (persons && !persons.has(`${a.person_type}:${a.person_id}`)) continue;
      const w = a.person_type === 'WORKER' ? wq.get(a.person_id, companyId) : null; const category = a.person_type === 'WORKER' ? 'CONTRACT' : 'STAFF';
      const trade = String(a.person_type === 'WORKER' ? (w?.trade_code ?? 'Worker') : (eq.get(a.person_id)?.trade ?? 'Staff')).trim(); const contractorId = category === 'CONTRACT' ? (w?.contractor_id ?? null) : null;
      const key = labourKey(category, contractorId, trade); const g = out.get(key) ?? { key, category, contractorId, trade, headcount: 0, manDays: 0, otHours: 0 };
      g.headcount += 1; g.manDays += a.status === 'HALF_DAY' ? 500 : 1000; g.otHours += Math.round((a.ot_minutes ?? 0) * 1000 / 60); out.set(key, g);
    }
    return out;
  }
  const labourKey = (category, contractorId, trade) => `${category}|${contractorId ?? 0}|${lower(String(trade).trim())}`;
  const contractorName = (id) => (id ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(id)?.legal_name ?? null : null);
  const waRows = (siteId, date) => db.prepare(`SELECT w.*, a.code AS acode, a.name AS aname, l.code AS lcode, l.name AS lname FROM site_work_authorisations w JOIN plan_activities a ON a.id = w.activity_id LEFT JOIN proj_locations l ON l.id = w.location_id
    WHERE w.wa_site_id = ? AND w.plan_date = ? AND w.status IN ('APPROVED', 'EMERGENCY') AND w.deleted_at IS NULL ORDER BY w.start_time, w.id`).all(siteId, date);
  const approvedOrSent = "d.status IN ('SUBMITTED', 'APPROVED') AND d.deleted_at IS NULL";
  /**
   * What the day offers for a report: the work of its work authorisations (the quantity they allow), the labour of the attendance, the materials issued and the plant logged against them, and the plan of
   * the next day. A report of the site that has supervisors' reports under it takes their figures instead (FR-01), and the baseline for a reason is what was offered.
   */
  function prefill(companyId, site, date, { scope = 'SITE', supervisor = null } = {}) {
    let was = waRows(site.id, date); if (scope === 'SUPERVISOR') was = was.filter((w) => same(w.supervisor, supervisor));
    const waIds = new Set(was.map((w) => w.id)); const subs = scope === 'SITE' ? db.prepare(`SELECT d.id FROM site_dprs d WHERE d.dpr_site_id = ? AND d.dpr_date = ? AND d.scope = 'SUPERVISOR' AND ${approvedOrSent}`).all(site.id, date).map((x) => x.id) : [];
    const inSubs = subs.map(() => '?').join(','); const subSum = (sql, ...p) => (subs.length ? db.prepare(sql.replace('@IN', inSubs)).all(...subs, ...p) : []);
    const done = new Map(subSum('SELECT wa_id, SUM(qty) AS qty FROM site_dpr_work WHERE dpr_id IN (@IN) AND deleted_at IS NULL GROUP BY wa_id').map((x) => [x.wa_id, x.qty]));
    const work = was.map((w) => ({ waId: w.id, waNo: w.wa_no, activityId: w.activity_id, activity: `${w.acode} ${w.aname}`, locationId: w.location_id, location: w.lcode ? `${w.lcode} ${w.lname}` : null, uom: w.uom, plannedQty: w.planned_qty, qty: done.has(w.id) ? done.get(w.id) : w.planned_qty, supervisor: w.supervisor, source: done.has(w.id) ? 'SUPERVISOR_DPR' : 'WA' }));
    let persons = null;
    if (scope === 'SUPERVISOR') {
      persons = new Set(); const crews = [...waIds].length ? db.prepare(`SELECT DISTINCT crew_id FROM site_wa_resources WHERE wa_id IN (${[...waIds].map(() => '?').join(',')}) AND crew_id IS NOT NULL AND deleted_at IS NULL`).all(...waIds).map((x) => x.crew_id) : [];
      for (const c of crews) for (const m of db.prepare('SELECT person_type, person_id FROM hr_crew_members WHERE crew_id = ? AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?)').all(c, date, date)) persons.add(`${m.person_type}:${m.person_id}`);
    }
    const att = attendanceOf(companyId, site.id, date, persons);
    const labour = subs.length
      ? subSum('SELECT category, contractor_id, trade_code, SUM(headcount) AS headcount, SUM(man_days) AS man_days, SUM(ot_hours) AS ot_hours FROM site_dpr_labour WHERE dpr_id IN (@IN) AND deleted_at IS NULL GROUP BY category, contractor_id, lower(trade_code)').map((x) => ({ key: labourKey(x.category, x.contractor_id, x.trade_code), category: x.category, contractorId: x.contractor_id, trade: x.trade_code, headcount: x.headcount, manDays: x.man_days, otHours: x.ot_hours }))
      : [...att.values()];
    const uses = (kind) => db.prepare(`SELECT u.res_key, u.wa_id, SUM(u.qty) AS qty, MAX(u.uom) AS uom, GROUP_CONCAT(u.src_id, ', ') AS refs FROM site_wa_uses u LEFT JOIN site_work_authorisations w ON w.id = u.wa_id WHERE u.company_id = ? AND u.site_id = ? AND u.use_kind = ? AND u.use_date = ? AND u.deleted_at IS NULL${scope === 'SUPERVISOR' ? ' AND w.id IS NOT NULL' : ''} GROUP BY u.res_key, u.wa_id`).all(companyId, site.id, kind, date)
      .filter((u) => scope !== 'SUPERVISOR' || waIds.has(u.wa_id));
    const materials = (subs.length ? subSum('SELECT item_id, wa_id, SUM(qty) AS qty, MAX(uom) AS uom, GROUP_CONCAT(issue_ref, \', \') AS refs FROM site_dpr_materials WHERE dpr_id IN (@IN) AND deleted_at IS NULL GROUP BY item_id, wa_id').map((x) => ({ itemId: x.item_id, waId: x.wa_id, qty: x.qty, uom: x.uom, issueRef: x.refs }))
      : uses('MATERIAL_ISSUE').filter((u) => /^item:\d+$/.test(u.res_key ?? '')).map((u) => ({ itemId: Number(u.res_key.slice(5)), waId: u.wa_id, qty: u.qty, uom: u.uom, issueRef: u.refs })))
      .map((m) => ({ ...m, item: db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(m.itemId) })).filter((m) => m.item);
    const equipment = subs.length ? subSum('SELECT equipment_key, MAX(label) AS label, SUM(hours_worked) AS hw, SUM(hours_idle) AS hi, SUM(hours_breakdown) AS hb, GROUP_CONCAT(log_ref, \', \') AS refs FROM site_dpr_equipment WHERE dpr_id IN (@IN) AND deleted_at IS NULL GROUP BY lower(equipment_key)').map((x) => ({ key: x.equipment_key, label: x.label, hoursWorked: x.hw, hoursIdle: x.hi, hoursBreakdown: x.hb, logRef: x.refs }))
      : uses('PLANT_LOG').filter((u) => /^plant:/.test(u.res_key ?? '')).map((u) => ({ key: u.res_key, label: u.res_key.slice(6), hoursWorked: u.qty, hoursIdle: 0, hoursBreakdown: 0, logRef: u.refs }));
    const next = db.prepare(`SELECT a.code, a.name, l.planned_qty, l.uom FROM site_daily_plans p JOIN site_daily_plan_lines l ON l.plan_id = p.id AND l.deleted_at IS NULL JOIN plan_activities a ON a.id = l.activity_id
      WHERE p.dp_site_id = ? AND p.plan_date = ? AND p.status IN ('DRAFT', 'ISSUED') AND p.deleted_at IS NULL${scope === 'SUPERVISOR' ? ' AND lower(p.supervisor) = lower(?)' : ''}`).all(site.id, isoOf(ordOf(date) + 1), ...(scope === 'SUPERVISOR' ? [supervisor] : []));
    const notes = subs.length ? subSum("SELECT n.note_type, n.note_text, d.supervisor FROM site_dpr_notes n JOIN site_dprs d ON d.id = n.dpr_id WHERE n.dpr_id IN (@IN) AND n.deleted_at IS NULL AND n.note_type <> 'NEXT_DAY' ORDER BY n.id").map((n) => ({ type: n.note_type, text: `${n.supervisor}: ${n.note_text}` })) : [];
    return {
      siteId: site.id, date, scope, supervisor, source: subs.length ? 'SUPERVISOR_DPRS' : 'WA_AND_ATTENDANCE', supervisorDprs: subs.length,
      work, labour: labour.map((x) => ({ ...x, contractor: contractorName(x.contractorId) })), materials, equipment, notes,
      nextDay: next.length ? next.map((x) => `${x.code} ${x.name}: ${d3(x.planned_qty)} ${x.uom ?? ''}`.trim()).join('; ') : null,
    };
  }
  const prefillView = (p) => ({ siteId: p.siteId, date: p.date, scope: p.scope, supervisor: p.supervisor, source: p.source, supervisorDprs: p.supervisorDprs,
    work: p.work.map((w) => ({ waId: w.waId, waNo: w.waNo, activityId: w.activityId, activity: w.activity, locationId: w.locationId, location: w.location, uom: w.uom, plannedQty: d3(w.plannedQty), qty: d3(w.qty), supervisor: w.supervisor, source: w.source })),
    labour: p.labour.map((l) => ({ category: l.category, contractorId: l.contractorId, contractor: l.contractor, trade: l.trade, headcount: l.headcount, manDays: d3(l.manDays), otHours: d3(l.otHours) })),
    materials: p.materials.map((m) => ({ itemId: m.itemId, item: `${m.item.code} ${m.item.name}`, uom: m.uom, qty: d3(m.qty), waId: m.waId, issueRef: m.issueRef })),
    equipment: p.equipment.map((e) => ({ equipmentKey: e.key, label: e.label, hoursWorked: d3(e.hoursWorked), hoursIdle: d3(e.hoursIdle), hoursBreakdown: d3(e.hoursBreakdown), logRef: e.logRef })), notes: p.notes, nextDay: p.nextDay });

  // ---- one report: the rows of its sections, derived on the server (FR-02, BR-01, BR-02) ---------------------------------------------------------------------------------------------------
  const rowsOf = (table, id, order = 'sort_order, id') => db.prepare(`SELECT * FROM ${table} WHERE dpr_id = ? AND deleted_at IS NULL ORDER BY ${order}`).all(id);
  /** What the sections were saved as, in the shape the API takes them, so a change to one section works out the others again. */
  const inputOf = (id) => ({
    work: rowsOf('site_dpr_work', id).map((x) => ({ waId: x.wa_id, qty: d3(x.qty), remarks: x.line_remarks, reason: x.reason })),
    labour: rowsOf('site_dpr_labour', id).map((x) => ({ category: x.category, contractorId: x.contractor_id, trade: x.trade_code, headcount: x.headcount, manDays: d3(x.man_days), otHours: d3(x.ot_hours), reason: x.reason })),
    materials: rowsOf('site_dpr_materials', id).map((x) => ({ itemId: x.item_id, qty: d3(x.qty), waId: x.wa_id, issueRef: x.issue_ref, reason: x.reason })),
    equipment: rowsOf('site_dpr_equipment', id).map((x) => ({ equipmentKey: x.equipment_key, label: x.label, hoursWorked: d3(x.hours_worked), hoursIdle: d3(x.hours_idle), hoursBreakdown: d3(x.hours_breakdown), logRef: x.log_ref, reason: x.reason })),
    notes: rowsOf('site_dpr_notes', id).map((x) => ({ type: x.note_type, text: x.note_text, linkedEntity: x.linked_entity, linkedId: x.linked_id })),
  });
  function derive(r, input) {
    const p = []; const site = { id: r.dpr_site_id }; const tol = tolerances(r.company_id); const pf = prefill(r.company_id, site, r.dpr_date, { scope: r.scope, supervisor: r.supervisor });
    const pfWork = new Map(pf.work.map((w) => [w.waId, w])); const pfMat = new Map(pf.materials.map((m) => [`${m.itemId}|${m.waId ?? 0}`, m])); const pfEq = new Map(pf.equipment.map((e) => [lower(e.key), e]));
    const att = attendanceOf(r.company_id, r.dpr_site_id, r.dpr_date); const family = [r.id, r.parent_dpr_id].filter(Boolean); const seen = new Set();
    const work = (input.work ?? []).map((l, i) => {
      const f = (field, message) => p.push({ field: `work.${i}.${field}`, message });
      const wa = db.prepare('SELECT * FROM site_work_authorisations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(l.waId, r.company_id);
      if (!wa || wa.wa_site_id !== r.dpr_site_id) { f('waId', 'Choose a work authorisation of this site'); return null; }
      if (seen.has(wa.id)) f('waId', `${wa.wa_no} is on another line: one line a work authorisation`); seen.add(wa.id);
      if (wa.plan_date !== r.dpr_date) f('waId', `${wa.wa_no} is for ${wa.plan_date}, not ${r.dpr_date}`);
      if (!(['APPROVED', 'EMERGENCY'].includes(wa.status) || (wa.status === 'CLOSED' && r.parent_dpr_id))) f('waId', `${wa.wa_no} is ${wa.status === 'CLOSED' ? 'closed' : 'not approved'}: work is reported only against an approved work authorisation`);
      const qty = q3(l.qty); const others = db.prepare(`SELECT COALESCE(SUM(w.qty), 0) AS n FROM site_dpr_work w JOIN site_dprs d ON d.id = w.dpr_id WHERE w.wa_id = ? AND w.deleted_at IS NULL AND d.scope = ? AND ${approvedOrSent} AND d.id NOT IN (${family.map(() => '?').join(',')})`).get(wa.id, r.scope, ...family).n;
      const over = wa.planned_qty > 0 ? (others + qty) * 100 > wa.planned_qty * (100 + tol.qty) : (others + qty) > 0;
      return { wa_id: wa.id, activity_id: wa.activity_id, location_id: wa.location_id, qty, uom: wa.uom, planned_qty: wa.planned_qty, prefill_qty: pfWork.get(wa.id)?.qty ?? null, over_wa: over ? 1 : 0, reason: l.reason ?? null, line_remarks: l.remarks ?? null };
    });
    const labourKeys = new Set(); let labourFlagged = 0;
    const labour = (input.labour ?? []).map((l, i) => {
      const f = (field, message) => p.push({ field: `labour.${i}.${field}`, message });
      const trade = String(l.trade).trim(); const contractorId = l.category === 'CONTRACT' ? (l.contractorId ?? null) : null;
      if (l.category === 'CONTRACT' && (!contractorId || !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ?').get(contractorId, r.company_id))) f('contractorId', 'Choose the contractor');
      const key = labourKey(l.category, contractorId, trade); if (labourKeys.has(key)) f('trade', `${trade} is on another line: one line a trade and contractor`); labourKeys.add(key);
      const a = att.get(key); const md = q3(l.manDays); const attMd = a?.manDays ?? 0;
      const variance = attMd > 0 ? Math.round(((md - attMd) * 10000) / attMd) : (md > 0 ? 10000 : 0); const flagged = Math.abs(variance) > tol.labour * 100 ? 1 : 0; labourFlagged += flagged;
      return { category: l.category, contractor_id: contractorId, trade_code: trade, headcount: l.headcount, man_days: md, ot_hours: q3(l.otHours ?? 0), att_headcount: a?.headcount ?? 0, att_man_days: attMd, variance_pct: variance, flagged, reason: l.reason ?? null };
    });
    const unreported = [...att.values()].filter((a) => !labourKeys.has(a.key));
    const matKeys = new Set();
    const materials = (input.materials ?? []).map((l, i) => {
      const f = (field, message) => p.push({ field: `materials.${i}.${field}`, message });
      const it = db.prepare('SELECT id, base_uom FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(l.itemId, r.company_id); if (!it) { f('itemId', 'Choose an item'); return null; }
      if (l.waId && !db.prepare('SELECT 1 FROM site_work_authorisations WHERE id = ? AND wa_site_id = ? AND plan_date = ? AND deleted_at IS NULL').get(l.waId, r.dpr_site_id, r.dpr_date)) f('waId', 'Choose a work authorisation of this site and day');
      const key = `${it.id}|${l.waId ?? 0}`; if (matKeys.has(key)) f('itemId', 'This item and work authorisation are on another line'); matKeys.add(key);
      return { item_id: it.id, qty: q3(l.qty), uom: it.base_uom, wa_id: l.waId ?? null, issue_ref: l.issueRef ?? pfMat.get(key)?.issueRef ?? null, prefill_qty: pfMat.get(key)?.qty ?? null, reason: l.reason ?? null };
    });
    const eqKeys = new Set();
    const equipment = (input.equipment ?? []).map((l, i) => {
      const f = (field, message) => p.push({ field: `equipment.${i}.${field}`, message });
      const label = String(l.label).trim(); const key = String(l.equipmentKey ?? `plant:${lower(label)}`).trim(); if (eqKeys.has(lower(key))) f('label', `${label} is on another line`); eqKeys.add(lower(key));
      const hw = q3(l.hoursWorked ?? 0); const hi = q3(l.hoursIdle ?? 0); const hb = q3(l.hoursBreakdown ?? 0); if (hw + hi + hb > 24000) f('hoursWorked', 'At most 24 hours a day for one machine');
      const e = pfEq.get(lower(key)); return { equipment_key: key, label, hours_worked: hw, hours_idle: hi, hours_breakdown: hb, log_ref: l.logRef ?? e?.logRef ?? null, prefill_hours: e ? e.hoursWorked : null, reason: l.reason ?? null };
    });
    const notes = (input.notes ?? []).map((n) => ({ note_type: n.type, note_text: n.text, linked_entity: n.linkedEntity ?? null, linked_id: n.linkedId ?? null }));
    const flags = { labourFlagged, labourUnreported: unreported.length, overWa: work.filter((w) => w?.over_wa).length, adjusted: [...work.filter((w) => w && w.prefill_qty != null && w.qty !== w.prefill_qty), ...materials.filter((m) => m && m.prefill_qty != null && m.qty !== m.prefill_qty)].length };
    return { p, work: work.filter(Boolean), labour, materials: materials.filter(Boolean), equipment, notes, flags, unreported, prefill: pf };
  }
  /** At sending: the work or the hindrance, and a reason wherever the report differs from what the day offered or goes past what a work authorisation allows (FR-02, BR-01, BR-02). */
  function sendProblems(d) {
    const p = []; const needs = (arr, section, when) => arr.forEach((x, i) => { if (when(x) && String(x.reason ?? '').trim().length < 5) p.push({ field: `${section}.${i}.reason`, message: 'Say why (at least 5 characters)' }); });
    if (!d.work.length && !d.notes.some((n) => n.note_type === 'HINDRANCE')) p.push({ field: 'work', message: 'Report the work done under a work authorisation, or the hindrance that stopped it' });
    needs(d.work, 'work', (x) => x.over_wa || (x.prefill_qty != null && x.qty !== x.prefill_qty));
    needs(d.labour, 'labour', (x) => x.flagged || (x.att_man_days > 0 && (x.man_days !== x.att_man_days || x.headcount !== x.att_headcount)));
    needs(d.materials, 'materials', (x) => x.prefill_qty != null ? x.qty !== x.prefill_qty : false);
    needs(d.equipment, 'equipment', (x) => x.prefill_hours != null && x.hours_worked !== x.prefill_hours);
    return p;
  }
  const writeSections = (actor, r, d) => {
    const now = nowIso(); for (const t of ['site_dpr_work', 'site_dpr_labour', 'site_dpr_materials', 'site_dpr_equipment', 'site_dpr_notes']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE dpr_id = ? AND deleted_at IS NULL`).run(now, actor.user, r.id);
    const ins = (table, row, i) => { const cols = ['company_id', 'dpr_id', ...Object.keys(row), 'sort_order', 'project_id', 'site_id', 'created_by', 'source_type']; db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(r.company_id, r.id, ...Object.values(row), i, r.org_project_id, r.dpr_site_id, actor.user, 'site_dpr'); };
    d.work.forEach((x, i) => ins('site_dpr_work', x, i)); d.labour.forEach((x, i) => ins('site_dpr_labour', x, i)); d.materials.forEach((x, i) => ins('site_dpr_materials', x, i)); d.equipment.forEach((x, i) => ins('site_dpr_equipment', x, i)); d.notes.forEach((x, i) => ins('site_dpr_notes', x, i));
    db.prepare('UPDATE site_dprs SET flags_json = ? WHERE id = ?').run(JSON.stringify(d.flags), r.id);
  };

  // ---- the views ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const fresh = (id) => db.prepare('SELECT * FROM site_dprs WHERE id = ?').get(id);
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(r.status === 'APPROVED' ? `${r.doc_no} is approved: it is locked; a change is an amendment.` : `${r.doc_no} is ${lower(DPR_STATUS[r.status])}: it is not changed now.`); };
  /** The photos of a report: the images attached to it (online, or by the offline engine) with the position and time that were kept, and the markups; a revision keeps the photos of the report it replaces. */
  function photosOf(r) {
    const meta = new Map(db.prepare('SELECT * FROM site_dpr_photos WHERE dpr_id = ? AND deleted_at IS NULL').all(r.id).map((x) => [x.file_id, x]));
    const ids = new Set([...meta.keys(), ...db.prepare("SELECT id FROM core_files WHERE company_id = ? AND linked_entity = 'site_dpr' AND linked_id = ? AND deleted_at IS NULL").all(r.company_id, r.id).map((x) => x.id)]);
    const off = db.prepare('SELECT l.lat, l.lng, l.effective_at FROM off_uploads u JOIN off_sync_log l ON l.company_id = u.company_id AND l.command_id = u.command_id WHERE u.file_id = ? AND u.company_id = ?');
    return [...ids].sort((a, b) => a - b).map((id) => {
      const f = db.prepare('SELECT id, original_name, mime, size_bytes, scan_status, created_at, created_by FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, r.company_id); if (!f || f.scan_status === 'INFECTED' || !/^image\//.test(f.mime ?? '')) return null;
      const m = meta.get(id); const o = off.get(id, r.company_id);
      return { fileId: f.id, name: f.original_name, size: f.size_bytes, caption: m?.caption ?? null, lat: m?.lat ?? o?.lat ?? null, lng: m?.lng ?? o?.lng ?? null, takenAt: m?.taken_at ?? o?.effective_at ?? f.created_at, locationId: m?.location_id ?? null, markup: json(m?.markup_json, []), by: f.created_by };
    }).filter(Boolean);
  }
  /** The sections of a report as the API shows them, the same for the screen, the print and the event. */
  function detailOf(r) {
    const v = /** @type {any} */ ({});
      const tol = tolerances(r.company_id);
      v.tolerance = { qtyPct: tol.qty, labourPct: tol.labour };
      v.work = rowsOf('site_dpr_work', r.id).map((x) => { const a = db.prepare('SELECT code, name FROM plan_activities WHERE id = ?').get(x.activity_id); const w = db.prepare('SELECT wa_no, status FROM site_work_authorisations WHERE id = ?').get(x.wa_id); const loc = x.location_id ? db.prepare('SELECT code, name FROM proj_locations WHERE id = ?').get(x.location_id) : null;
        return { id: x.id, waId: x.wa_id, waNo: w?.wa_no, waStatus: w?.status, activityId: x.activity_id, activity: a ? `${a.code} ${a.name}` : null, locationId: x.location_id, location: loc ? `${loc.code} ${loc.name}` : null, qty: d3(x.qty), uom: x.uom, plannedQty: d3(x.planned_qty), pctOfWa: x.planned_qty > 0 ? Math.round((x.qty * 10000) / x.planned_qty) / 100 : null, prefillQty: d3(x.prefill_qty), overWa: Boolean(x.over_wa), reason: x.reason, remarks: x.line_remarks }; });
      v.labour = rowsOf('site_dpr_labour', r.id).map((x) => ({ id: x.id, category: x.category, categoryLabel: CATEGORIES[x.category], contractorId: x.contractor_id, contractor: contractorName(x.contractor_id), trade: x.trade_code, headcount: x.headcount, manDays: d3(x.man_days), otHours: d3(x.ot_hours), attHeadcount: x.att_headcount, attManDays: d3(x.att_man_days), variancePct: x.variance_pct == null ? null : x.variance_pct / 100, flagged: Boolean(x.flagged), reason: x.reason }));
      v.unreported = [...attendanceOf(r.company_id, r.dpr_site_id, r.dpr_date).values()].filter((a) => !v.labour.some((l) => labourKey(l.category, l.contractorId, l.trade) === a.key)).map((a) => ({ category: a.category, categoryLabel: CATEGORIES[a.category], contractorId: a.contractorId, contractor: contractorName(a.contractorId), trade: a.trade, headcount: a.headcount, manDays: d3(a.manDays) }));
      v.materials = rowsOf('site_dpr_materials', r.id).map((x) => { const it = db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(x.item_id); const w = x.wa_id ? db.prepare('SELECT wa_no FROM site_work_authorisations WHERE id = ?').get(x.wa_id) : null; return { id: x.id, itemId: x.item_id, item: it ? `${it.code} ${it.name}` : null, qty: d3(x.qty), uom: x.uom, waId: x.wa_id, waNo: w?.wa_no ?? null, issueRef: x.issue_ref, prefillQty: d3(x.prefill_qty), reason: x.reason }; });
      v.equipment = rowsOf('site_dpr_equipment', r.id).map((x) => ({ id: x.id, equipmentKey: x.equipment_key, label: x.label, hoursWorked: d3(x.hours_worked), hoursIdle: d3(x.hours_idle), hoursBreakdown: d3(x.hours_breakdown), logRef: x.log_ref, prefillHours: d3(x.prefill_hours), reason: x.reason }));
      v.notes = rowsOf('site_dpr_notes', r.id).map((x) => ({ id: x.id, type: x.note_type, typeLabel: NOTE_TYPES[x.note_type], text: x.note_text, linkedEntity: x.linked_entity, linkedId: x.linked_id }));
      v.photos = photosOf(r); const p = r.parent_dpr_id ? fresh(r.parent_dpr_id) : null; v.previous = p ? { id: p.id, docNo: p.doc_no, revisionNo: p.revision_no, summary: p.summary } : null;
      v.revisions = db.prepare('SELECT id, doc_no, revision_no, status FROM site_dprs WHERE (parent_dpr_id = ? OR id = ?) AND id <> ? AND deleted_at IS NULL ORDER BY revision_no').all(r.id, r.parent_dpr_id ?? 0, r.id).map((x) => ({ id: x.id, docNo: x.doc_no, revisionNo: x.revision_no, status: x.status }));
    return v;
  }
  function view(actor, r, { detail = false } = {}) {
    const s = db.prepare('SELECT s.code, s.name, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.dpr_site_id); const can = (k) => may(actor, k, r.org_project_id, r.dpr_site_id);
    const own = same(r.requested_by, actor.user); const flags = json(r.flags_json, {}); const front = r.work_front_id ? db.prepare('SELECT code, name FROM site_work_fronts WHERE id = ?').get(r.work_front_id) : null;
    const v = {
      id: r.id, docNo: r.doc_no, projectId: r.org_project_id, projectCode: s?.pcode, projectName: s?.pname, siteId: r.dpr_site_id, siteCode: s?.code, siteName: s?.name, dprDate: r.dpr_date, supervisor: r.supervisor, scope: r.scope, scopeLabel: SCOPES[r.scope],
      workFrontId: r.work_front_id, workFront: front ? `${front.code} ${front.name}` : null, weatherCode: r.weather_code, weather: r.weather_code ? WEATHER[r.weather_code] : null, rainMm: r.rain_mm, weatherRef: r.weather_ref, summary: r.summary,
      status: r.status, statusLabel: DPR_STATUS[r.status], revisionNo: r.revision_no, parentDprId: r.parent_dpr_id, submittedAt: r.submitted_at, submittedVia: r.submitted_via, receivedAt: r.received_at, cutoffAt: r.cutoff_at, late: Boolean(r.late), lateMinutes: r.late_minutes,
      flags, reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('site.dpr.edit') && editable(r), submit: can('site.dpr.submit') && editable(r), withdraw: r.status === 'SUBMITTED' && own, cancel: can('site.dpr.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('site.dpr.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('site.dpr.amend') && r.status === 'APPROVED' && !db.prepare("SELECT 1 FROM site_dprs WHERE parent_dpr_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id), approve: can('site.dpr.approve') && r.status === 'SUBMITTED' && !own, print: can('site.dpr.print'), export: can('site.dpr.export') },
    };
    if (detail) Object.assign(v, detailOf(r));
    return v;
  }
  const scope = (actor) => { const f = authz.scopeFilter(actor, 'site.dpr.view', { project: 'x.org_project_id', site: 'x.dpr_site_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const SELECT = 'x.id, x.doc_no, x.dpr_date, x.org_project_id, x.dpr_site_id, x.supervisor, x.scope, x.status, x.late, x.revision_no, x.flags_json, p.code AS pcode, s.code AS scode';
  const listRow = (x) => { const f = json(x.flags_json, {}); return { id: x.id, docNo: x.doc_no, dprDate: x.dpr_date, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.dpr_site_id, supervisor: x.supervisor, scope: x.scope, late: x.late ? 'Late' : 'On time', revisionNo: x.revision_no, flagged: (f.labourFlagged ?? 0) + (f.overWa ?? 0) > 0, status: x.status, statusLabel: DPR_STATUS[x.status] }; };
  function row(actor, id, key = 'site.dpr.view') {
    const r = db.prepare('SELECT * FROM site_dprs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.dpr.view', r.org_project_id, r.dpr_site_id)) throw notFound('That daily progress report does not exist.'); if (key !== 'site.dpr.view') need(actor, key, 'do that with a daily progress report', r.org_project_id, r.dpr_site_id); return r;
  }
  const notFuture = (date) => { if (date > todayIST()) fail([{ field: 'dprDate', message: 'A report is made for today or an earlier day' }]); };

  const dprs = {
    list(actor, query) { if (!authz.check(actor, 'site.dpr.view').allowed) throw forbidden('You may not see daily progress reports (permission site.dpr.view).'); const sc = scope(actor); return runList(db, dprList, parseListRequest(dprList, query), { select: SELECT, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: listRow }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'site.dpr.export').allowed) throw forbidden('You may not export daily progress reports (permission site.dpr.export).'); const sc = scope(actor); const opts = { select: SELECT, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: dprList.label, permission: 'site.dpr.export', personal: false, columns: ['docNo', 'dprDate', 'project', 'site', 'supervisor', 'scope', 'late', 'revisionNo', 'status'].map((k) => ({ key: k, label: dprList.columns[k]?.label ?? k, type: 'text' })),
        rows: () => runList(db, dprList, req, { ...opts, limit: null, map: (x) => { const v = listRow(x); return { ...v, scope: SCOPES[v.scope], revisionNo: String(v.revisionNo), status: v.statusLabel }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All daily progress reports you may see'], count: () => countList(db, dprList, req, opts) };
    },
    get(actor, id) {
      const v = view(actor, row(actor, id), { detail: true });
      // the task the person decides it by, so the page can approve, return or reject without a trip to the inbox
      if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null;
      return v;
    },
    /** What a day offers a report of a site (FR-02): the prefill, with the report already made for it, if any. */
    prefill(actor, { siteId, date, scope: sc = 'SITE', supervisor }) {
      const s = siteRow(actor, siteId); notFuture(date); const sup = supervisor ?? actor.user; const p = prefillView(prefill(actor.companyId, s, date, { scope: sc, supervisor: sup }));
      const ex = db.prepare(`SELECT id, doc_no, status FROM site_dprs WHERE dpr_site_id = ? AND dpr_date = ? AND scope = ? AND parent_dpr_id IS NULL AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED')${sc === 'SUPERVISOR' ? ' AND lower(supervisor) = lower(?)' : ''}`).get(s.id, date, sc, ...(sc === 'SUPERVISOR' ? [sup] : []));
      return { site: { id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode }, ...p, conditions: dayContext(actor.companyId, s.id, date), existing: ex ? { id: ex.id, docNo: ex.doc_no, status: ex.status } : null,
        canCreate: may(actor, 'site.dpr.create', s.org_project_id, s.id), tolerance: { qtyPct: tolerances(actor.companyId).qty, labourPct: tolerances(actor.companyId).labour }, cutoff: param(actor.companyId, 'site.dpr.cutoff_time') };
    },
    /** The sites a person may report for, for the pickers. */
    sites(actor) { return db.prepare("SELECT s.id, s.code, s.name, s.org_project_id, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE' ORDER BY p.code, s.code").all(actor.companyId).filter((s) => may(actor, 'site.dpr.view', s.org_project_id, s.id)).map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode, canCreate: may(actor, 'site.dpr.create', s.org_project_id, s.id) })); },
    /** What the entry form offers besides the prefill: the contractors with workers on the project, the materials, the weather and note kinds. */
    options(actor, siteId) {
      const s = siteRow(actor, siteId);
      return { siteId: s.id, contractors: db.prepare('SELECT DISTINCT p.id, p.legal_name AS name FROM mdm_partners p JOIN lab_workers w ON w.contractor_id = p.id WHERE p.company_id = ? AND w.deleted_at IS NULL ORDER BY p.legal_name LIMIT 500').all(actor.companyId),
        items: db.prepare("SELECT id, code, name, base_uom AS uom FROM mdm_items WHERE company_id = ? AND item_type = 'MATERIAL' AND deleted_at IS NULL AND item_status = 'ACTIVE' ORDER BY code LIMIT 2000").all(actor.companyId),
        weather: Object.entries(WEATHER).map(([code, label]) => ({ code, label })), noteTypes: Object.entries(NOTE_TYPES).map(([code, label]) => ({ code, label })), categories: Object.entries(CATEGORIES).map(([code, label]) => ({ code, label })) };
    },
    create(actor, b, extra = {}) {
      const s = siteRow(actor, b.siteId, 'site.dpr.create'); notFuture(b.dprDate); const sc = b.scope ?? 'SITE'; const sup = b.supervisor ?? actor.user;
      const dup = db.prepare(`SELECT doc_no FROM site_dprs WHERE dpr_site_id = ? AND dpr_date = ? AND scope = ? AND parent_dpr_id IS NULL AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED')${sc === 'SUPERVISOR' ? ' AND lower(supervisor) = lower(?)' : ''}`).get(s.id, b.dprDate, sc, ...(sc === 'SUPERVISOR' ? [sup] : []));
      if (dup) throw conflict(`${dup.doc_no} is already the ${sc === 'SITE' ? 'report of this site' : `report of ${sup}`} for ${b.dprDate}: open it instead.`);
      return transaction(db, () => {
        // part 14.03: with the prefill, a report with no weather of its own takes the weather record of the site and day
        const wx = b.usePrefill && !b.weatherCode && b.rainMm == null ? dayContext(actor.companyId, s.id, b.dprDate)?.weather : null;
        const id = Number(db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, work_front_id, weather_code, rain_mm, weather_ref, summary, status, requested_by, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)")
          .run(actor.companyId, number(actor.companyId, actor.user), s.org_project_id, s.id, b.dprDate, sup, sc, b.workFrontId ?? null, b.weatherCode ?? wx?.code ?? null, b.rainMm ?? wx?.rainMm ?? null, b.weatherRef ?? wx?.ref ?? null, b.summary ?? null, actor.user, s.org_project_id, s.id, actor.user, extra.sourceType ?? 'api', extra.sourceId ?? null).lastInsertRowid);
        const r = fresh(id); let input = { work: b.work ?? [], labour: b.labour ?? [], materials: b.materials ?? [], equipment: b.equipment ?? [], notes: b.notes ?? [] };
        if (b.usePrefill) { const p = prefillView(prefill(actor.companyId, s, b.dprDate, { scope: sc, supervisor: sup })); input = { work: p.work.map((w) => ({ waId: w.waId, qty: w.qty })), labour: p.labour.map((l) => ({ category: l.category, contractorId: l.contractorId, trade: l.trade, headcount: l.headcount, manDays: l.manDays, otHours: l.otHours })), materials: p.materials.map((m) => ({ itemId: m.itemId, qty: m.qty, waId: m.waId, issueRef: m.issueRef })), equipment: p.equipment.map((e) => ({ label: e.label, equipmentKey: e.equipmentKey, hoursWorked: e.hoursWorked, hoursIdle: e.hoursIdle, hoursBreakdown: e.hoursBreakdown, logRef: e.logRef })), notes: [...p.notes, ...(p.nextDay ? [{ type: 'NEXT_DAY', text: p.nextDay }] : [])] };
          // part 14.03: the hindrances and the visits recorded for the day come into the report, linked to their records (a note that is already there is not repeated)
          const cx = dayContext(actor.companyId, s.id, b.dprDate); const have = (t) => input.notes.some((n) => n.text === t);
          for (const h of cx?.hindrances ?? []) { const t = `${h.docNo}: ${h.title}`; if (!have(t)) input.notes.push({ type: 'HINDRANCE', text: t, linkedEntity: 'site_hindrance', linkedId: String(h.rootId) }); }
          for (const v of cx?.visitors ?? []) { const t = `${v.name}${v.organisation ? ` (${v.organisation})` : ''}: ${v.purpose}`; if (!have(t)) input.notes.push({ type: 'VISITOR', text: t }); } }
        const d = derive(r, input); fail(d.p); writeSections(actor, r, d);
        audit(actor, 'site_dprs', id, 'create', actor.companyId, { newValues: { date: b.dprDate, scope: sc, prefill: Boolean(b.usePrefill), work: d.work.length } }); return dprs.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'site.dpr.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this report; reload it.');
      return transaction(db, () => {
        const set = []; const vals = []; for (const [k, c] of [['weatherCode', 'weather_code'], ['rainMm', 'rain_mm'], ['weatherRef', 'weather_ref'], ['summary', 'summary'], ['workFrontId', 'work_front_id']]) if (k in b) { set.push(`${c} = ?`); vals.push(b[k]); }
        if ('supervisor' in b && b.supervisor && r.scope === 'SUPERVISOR') { set.push('supervisor = ?'); vals.push(b.supervisor); }
        db.prepare(`UPDATE site_dprs SET ${[...set, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
        const n = fresh(r.id); const d = derive(n, { ...inputOf(r.id), ...Object.fromEntries(['work', 'labour', 'materials', 'equipment', 'notes'].filter((k) => k in b).map((k) => [k, b[k]])) }); fail(d.p); writeSections(actor, n, d);
        const changed = { ...b }; for (const k of ['work', 'labour', 'materials', 'equipment', 'notes']) if (k in changed) changed[k] = `${changed[k].length} lines`; delete changed.rowVersion; audit(actor, 'site_dprs', r.id, 'update', r.company_id, { newValues: changed }); return dprs.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'site.dpr.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { const now = nowIso(); for (const t of ['site_dpr_work', 'site_dpr_labour', 'site_dpr_materials', 'site_dpr_equipment', 'site_dpr_notes', 'site_dpr_photos']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE dpr_id = ? AND deleted_at IS NULL`).run(now, actor.user, r.id); db.prepare('UPDATE site_dprs SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'site_dprs', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    /** Send for approval (FR-05): the sections are worked out again, the reasons asked for, the cut-off judged by the time it was sent (the device's corrected time for an offline report); an amendment goes to the project manager only. */
    submit(actor, id, { effectiveAt = null, via = 'ONLINE' } = {}) {
      const r = row(actor, id, 'site.dpr.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned report is sent for approval.'); notFuture(r.dpr_date);
      return transaction(db, () => {
        const d = derive(r, inputOf(r.id)); fail(d.p); fail(sendProblems(d)); writeSections(actor, r, d);
        const at = effectiveAt && Date.parse(effectiveAt) <= Date.now() + 300_000 ? effectiveAt : nowIso(); const c = cutoffOf(r.company_id, r.dpr_date, at); const amendment = Boolean(r.parent_dpr_id);
        const ctx = { projectId: r.org_project_id, siteId: r.dpr_site_id, amendment: amendment ? 'yes' : 'no', late: c.late ? 'yes' : 'no', date: r.dpr_date };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: DPR_DOC, docId: String(r.id), comment: `${r.doc_no}${amendment ? ' (amendment)' : ''}${c.late ? ' (late)' : ''}`.slice(0, 300), context: ctx }); db.prepare('UPDATE site_dprs SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE site_dprs SET status = 'SUBMITTED', submitted_at = ?, submitted_via = ?, received_at = ?, cutoff_at = ?, late = ?, late_minutes = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(at, via, nowIso(), c.cutoffAt, c.late, c.minutes, actor.user, actor.user, nowIso(), r.id);
        audit(actor, 'site_dprs', r.id, 'submit', r.company_id, { newValues: { late: Boolean(c.late), lateMinutes: c.minutes, via, flags: d.flags } }); return dprs.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a report waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return dprs.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'site.dpr.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a report that is not approved is cancelled; an approved one is changed by an amendment.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE site_dprs SET status = 'CANCELLED', reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'site_dprs', r.id, 'cancel', r.company_id, { reason }); return dprs.get(actor, r.id); });
    },
    /** BR-03: an approved report is locked; an amendment is a copy (with its photos) that the project manager approves and that replaces it. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'site.dpr.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved report is amended.'); if (db.prepare("SELECT 1 FROM site_dprs WHERE parent_dpr_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('An amendment of this report is open.');
      return transaction(db, () => {
        const cols = ['org_project_id', 'dpr_site_id', 'dpr_date', 'supervisor', 'scope', 'work_front_id', 'weather_code', 'rain_mm', 'weather_ref', 'summary', 'project_id', 'site_id'];
        const nid = Number(db.prepare(`INSERT INTO site_dprs (company_id, doc_no, ${cols.join(', ')}, revision_no, parent_dpr_id, status, reason, requested_by, created_by, source_type, source_id) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, 'DRAFT', ?, ?, ?, 'site_dpr', ?)`)
          .run(r.company_id, number(r.company_id, actor.user), ...cols.map((c) => r[c]), r.revision_no + 1, r.id, reason, actor.user, actor.user, String(r.id)).lastInsertRowid);
        const n = fresh(nid); const d = derive(n, inputOf(r.id)); writeSections(actor, n, d);
        for (const ph of photosOf(r)) db.prepare("INSERT INTO site_dpr_photos (company_id, dpr_id, file_id, caption, lat, lng, taken_at, location_id, markup_json, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'site_dpr')").run(r.company_id, nid, ph.fileId, ph.caption, ph.lat, ph.lng, ph.takenAt, ph.locationId, JSON.stringify(ph.markup), r.org_project_id, r.dpr_site_id, actor.user);
        audit(actor, 'site_dprs', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return dprs.get(actor, nid);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'site_dprs' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    /** The caption, position, place and markup of a photo (FR-04); the file itself is attached through the file service or the offline engine. */
    photo(actor, id, fileId, b) {
      const r = row(actor, id, 'site.dpr.edit'); mustEdit(r); const ph = photosOf(r).find((x) => x.fileId === rid(fileId)); if (!ph) throw notFound('That photo is not attached to this report.');
      if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, r.org_project_id)) fail([{ field: 'locationId', message: 'Choose a location of the project' }]);
      const m = { caption: 'caption' in b ? b.caption : ph.caption, lat: 'lat' in b ? b.lat : ph.lat, lng: 'lng' in b ? b.lng : ph.lng, takenAt: 'takenAt' in b ? b.takenAt : ph.takenAt, locationId: 'locationId' in b ? b.locationId : ph.locationId, markup: 'markup' in b ? b.markup : ph.markup };
      return transaction(db, () => {
        const ex = db.prepare('SELECT id FROM site_dpr_photos WHERE dpr_id = ? AND file_id = ? AND deleted_at IS NULL').get(r.id, ph.fileId);
        if (ex) db.prepare('UPDATE site_dpr_photos SET caption = ?, lat = ?, lng = ?, taken_at = ?, location_id = ?, markup_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.caption, m.lat, m.lng, m.takenAt, m.locationId, JSON.stringify(m.markup), actor.user, nowIso(), ex.id);
        else db.prepare("INSERT INTO site_dpr_photos (company_id, dpr_id, file_id, caption, lat, lng, taken_at, location_id, markup_json, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'site_dpr')").run(r.company_id, r.id, ph.fileId, m.caption, m.lat, m.lng, m.takenAt, m.locationId, JSON.stringify(m.markup), r.org_project_id, r.dpr_site_id, actor.user);
        audit(actor, 'site_dprs', r.id, 'photo', r.company_id, { newValues: { fileId: ph.fileId, caption: m.caption } }); return dprs.get(actor, r.id);
      });
    },
    print(actor, id) {
      const r = row(actor, id, 'site.dpr.print'); const v = view(actor, r, { detail: true }); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? ''; audit(actor, 'site_dprs', r.id, 'print', r.company_id);
      const tr = (c, h = false) => `<tr>${c.map((x) => `<${h ? 'th' : 'td'}>${esc(x ?? '')}</${h ? 'th' : 'td'}>`).join('')}</tr>`; const tbl = (head, rows) => (rows.length ? `<table border="1" cellpadding="3">${tr(head, true)}${rows.map((x) => tr(x)).join('')}</table>` : '<p>None.</p>');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED REPORT</strong></p>`}<h1>${esc(co)}</h1><h2>Daily progress report ${esc(v.docNo)}${v.revisionNo > 1 ? ` · amendment ${v.revisionNo - 1}` : ''}</h2>`
        + `<p>${esc(v.projectCode)} ${esc(v.projectName)} · site ${esc(v.siteCode)} ${esc(v.siteName)} · ${esc(v.dprDate)} · ${esc(v.scopeLabel)} report of ${esc(v.supervisor)}${v.late ? ` · SENT LATE (${v.lateMinutes} min after ${esc(String(v.cutoffAt).slice(11, 16))} UTC)` : ''}</p>`
        + `<p>Weather: ${esc(v.weather ?? '—')}${v.rainMm != null ? `, rain ${v.rainMm} mm` : ''}${v.weatherRef ? ` (${esc(v.weatherRef)})` : ''}</p>${v.summary ? `<p>${esc(v.summary)}</p>` : ''}`
        + `<h3>Work done</h3>${tbl(['WA', 'Activity', 'Location', 'Quantity', 'Unit', '% of WA', 'Reason'], v.work.map((x) => [x.waNo, x.activity, x.location, x.qty, x.uom, x.pctOfWa, x.reason ?? x.remarks]))}`
        + `<h3>Labour</h3>${tbl(['Category', 'Contractor', 'Trade', 'Headcount', 'Man-days', 'Attendance', 'Variance %', 'OT hours'], v.labour.map((x) => [x.categoryLabel, x.contractor, x.trade, x.headcount, x.manDays, x.attManDays, x.variancePct, x.otHours]))}`
        + `<h3>Materials consumed</h3>${tbl(['Item', 'Quantity', 'Unit', 'WA', 'Issue'], v.materials.map((x) => [x.item, x.qty, x.uom, x.waNo, x.issueRef]))}`
        + `<h3>Equipment</h3>${tbl(['Equipment', 'Worked h', 'Idle h', 'Breakdown h', 'Log'], v.equipment.map((x) => [x.label, x.hoursWorked, x.hoursIdle, x.hoursBreakdown, x.logRef]))}`
        + `<h3>Observations</h3>${tbl(['Kind', 'Note'], v.notes.map((x) => [x.typeLabel, x.text]))}<h3>Photos</h3>${tbl(['Photo', 'Caption', 'Taken', 'Position'], v.photos.map((x) => [x.name, x.caption, String(x.takenAt ?? '').slice(0, 16).replace('T', ' '), x.lat == null ? '' : `${x.lat}, ${x.lng}`]))}`
        + `<p>${v.approvedAt ? `Approved by ${esc(v.approvedBy)} on ${esc(v.approvedAt.slice(0, 10))}` : `Prepared by ${esc(v.requestedBy ?? '')}`}</p></body></html>`;
    },
    /** The report as a PDF in the company's format (FR-06): a header with the facts of the day, then each section as rows. */
    pdf(actor, id) {
      const r = row(actor, id, 'site.dpr.print'); const v = view(actor, r, { detail: true }); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? ''; audit(actor, 'site_dprs', r.id, 'pdf', r.company_id);
      const rows = []; const add = (section, item, qty, unit, detail) => rows.push({ section, item: item ?? '', qty: qty == null ? '' : String(qty), unit: unit ?? '', detail: detail ?? '' });
      v.work.forEach((x) => add('Work done', `${x.waNo} ${x.activity}`, x.qty, x.uom, `${x.pctOfWa ?? '—'} % of the WA${x.reason ? `; ${x.reason}` : ''}`)); v.labour.forEach((x) => add('Labour', `${x.categoryLabel}: ${x.trade}${x.contractor ? ` (${x.contractor})` : ''}`, x.manDays, 'man-days', `${x.headcount} people; attendance ${x.attManDays ?? '—'}${x.flagged ? '; FLAGGED' : ''}`));
      v.materials.forEach((x) => add('Materials', x.item, x.qty, x.uom, x.waNo ?? x.issueRef)); v.equipment.forEach((x) => add('Equipment', x.label, x.hoursWorked, 'h worked', `idle ${x.hoursIdle} h, breakdown ${x.hoursBreakdown} h`)); v.notes.forEach((x) => add(x.typeLabel, x.text, null, '', '')); v.photos.forEach((x) => add('Photos', x.name, null, '', `${x.caption ?? ''} ${x.lat == null ? '' : `(${x.lat}, ${x.lng})`}`.trim()));
      const columns = [{ key: 'section', label: 'Section', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'qty', label: 'Quantity', type: 'text' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }];
      const footer = [`${co}: daily progress report ${v.docNo}${v.revisionNo > 1 ? ` (amendment ${v.revisionNo - 1})` : ''}`, `${v.projectCode} ${v.siteCode} · ${v.dprDate} · ${v.scopeLabel} report of ${v.supervisor} · weather ${v.weather ?? '—'}${v.late ? ' · sent late' : ''}`, v.approvedAt ? `Approved by ${v.approvedBy} on ${v.approvedAt.slice(0, 10)}` : `${v.statusLabel}: not an approved report`];
      return { buffer: toPdf({ columns, rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${String(v.docNo).replace(/\W+/g, '-')}.pdf` };
    },
    /** The approval engine's decision (its hook runs in the same transaction). */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        // BR-01: one approved report a site and day (a supervisor's report: one for the supervisor)
        const other = db.prepare(`SELECT doc_no FROM site_dprs WHERE dpr_site_id = ? AND dpr_date = ? AND scope = ? AND status = 'APPROVED' AND deleted_at IS NULL AND id NOT IN (?, ?)${r.scope === 'SUPERVISOR' ? ' AND lower(supervisor) = lower(?)' : ''}`).get(r.dpr_site_id, r.dpr_date, r.scope, r.id, r.parent_dpr_id ?? 0, ...(r.scope === 'SUPERVISOR' ? [r.supervisor] : []));
        if (other) throw unprocessable(`${other.doc_no} is already the approved report of this ${r.scope === 'SITE' ? 'site' : 'supervisor'} for ${r.dpr_date}; amend that one.`);
        db.prepare("UPDATE site_dprs SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
        if (r.parent_dpr_id) { db.prepare("UPDATE site_dprs SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_dpr_id); db.prepare("UPDATE site_wa_uses SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE use_kind = 'DPR' AND src_entity = 'site_dpr' AND src_id LIKE ? AND deleted_at IS NULL").run(now, actor.user, `${r.parent_dpr_id}:%`); }
        // the quantities done are booked against their work authorisations, where the closure of a WA reads them (14.01). A site's report is the authority for its day: it replaces the bookings of the supervisors' reports
        // it consolidates, and a supervisor's report approved after it books nothing. The bookings of a report that an amendment replaces were removed above.
        const siteApproved = r.scope === 'SUPERVISOR' && db.prepare("SELECT 1 FROM site_dprs WHERE dpr_site_id = ? AND dpr_date = ? AND scope = 'SITE' AND status = 'APPROVED' AND deleted_at IS NULL AND id <> ?").get(r.dpr_site_id, r.dpr_date, r.id);
        if (r.scope === 'SITE') for (const sub of db.prepare("SELECT id FROM site_dprs WHERE dpr_site_id = ? AND dpr_date = ? AND scope = 'SUPERVISOR' AND status = 'APPROVED' AND deleted_at IS NULL").all(r.dpr_site_id, r.dpr_date)) db.prepare("UPDATE site_wa_uses SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE use_kind = 'DPR' AND src_entity = 'site_dpr' AND src_id LIKE ? AND deleted_at IS NULL").run(now, actor.user, `${sub.id}:%`);
        if (!siteApproved) for (const w of rowsOf('site_dpr_work', r.id)) db.prepare("INSERT INTO site_wa_uses (company_id, org_project_id, wa_id, use_kind, src_entity, src_id, qty, uom, use_date, result, control_result, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, 'DPR', 'site_dpr', ?, ?, ?, ?, ?, 'DPR', ?, ?, ?, 'site_dpr', ?)").run(r.company_id, r.org_project_id, w.wa_id, `${r.id}:${w.id}`, w.qty, w.uom, r.dpr_date, w.over_wa ? 'WARN' : 'PASS', r.org_project_id, r.dpr_site_id, actor.user, String(r.id));
        audit(actor, 'site_dprs', r.id, r.parent_dpr_id ? 'approve_amendment' : 'approve', r.company_id);
        publishEvent(db, { type: 'site.dpr.approved', entity: 'site_dpr', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.dpr_site_id, data: eventData(r, actor.user) });
        const dist = param(r.company_id, 'site.dpr.distribution_roles'); const to = Array.isArray(dist) ? dist.filter((x) => /^[A-Z0-9_]{2,12}$/.test(String(x))) : [];
        const site = db.prepare('SELECT code FROM org_sites WHERE id = ?').get(r.dpr_site_id)?.code;
        notify(r.company_id, 'site.dpr.approved', [`user:${r.requested_by}`], r.doc_no, `${site} ${r.dpr_date}`, `${r.doc_no} is approved${r.parent_dpr_id ? ' as an amendment' : ''}.`, `/site/dprs?id=${r.id}`, r.id);
        if (to.length) notify(r.company_id, 'site.dpr.daily', [`role:${to.join('|')}`], r.doc_no, `${site} ${r.dpr_date}`, `Daily progress report of ${site} for ${r.dpr_date} is approved${r.late ? ' (it was sent late)' : ''}.`, `/site/dprs?id=${r.id}`, r.id, { projectId: r.org_project_id, siteId: r.dpr_site_id });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE site_dprs SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'site_dprs', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'site.dpr.rejected', [`user:${r.requested_by}`], r.doc_no, String(r.dpr_date), `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/site/dprs?id=${r.id}`, r.id);
    },
  };
  /** What the other modules read (progress 14.05, productivity 14.06, material reconciliation 16.10, MB suggestions 22.01): the sections as approved, in decimals. The plan's progress consumer reads `lines`, which this does not carry. */
  function eventData(r, by) {
    const v = detailOf(r);
    return { dprId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.dpr_site_id, date: r.dpr_date, supervisor: r.supervisor, scope: r.scope, revisionNo: r.revision_no, amendment: Boolean(r.parent_dpr_id), supersedes: r.parent_dpr_id ?? null, late: Boolean(r.late),
      weather: { code: r.weather_code, rainMm: r.rain_mm, ref: r.weather_ref },
      work: v.work.map((x) => ({ waId: x.waId, waNo: x.waNo, activityId: x.activityId, locationId: x.locationId, qty: x.qty, uom: x.uom, plannedQty: x.plannedQty, pctOfWa: x.pctOfWa, overWa: x.overWa })),
      labour: v.labour.map((x) => ({ category: x.category, contractorId: x.contractorId, trade: x.trade, headcount: x.headcount, manDays: x.manDays, otHours: x.otHours, attManDays: x.attManDays })),
      materials: v.materials.map((x) => ({ itemId: x.itemId, qty: x.qty, uom: x.uom, waId: x.waId, issueRef: x.issueRef })), equipment: v.equipment.map((x) => ({ key: x.equipmentKey, label: x.label, hoursWorked: x.hoursWorked, hoursIdle: x.hoursIdle, hoursBreakdown: x.hoursBreakdown })),
      hindrances: v.notes.filter((n) => n.type === 'HINDRANCE').length, photos: v.photos.length, by };
  }

  // ---- the offline form (04.15): the phone sends the whole report as one command, with its photos after it ----------------------------------------------------------------------------------
  const offline = {
    create(actor, v, ctx) {
      const b = { ...v }; const submit = b.submit === true; delete b.submit; const d = dprs.create(actor, b, { sourceType: 'off_command', sourceId: ctx.commandId });
      const out = submit ? dprs.submit(actor, d.id, { effectiveAt: ctx.effectiveAt, via: 'OFFLINE' }) : d; return { entityId: out.id, version: out.rowVersion, projectId: out.projectId };
    },
    load(actor, id) { try { const d = dprs.get(actor, id); return { version: d.rowVersion, projectId: d.projectId, status: d.status, values: { weatherCode: d.weatherCode, rainMm: d.rainMm, summary: d.summary, work: d.work.map((x) => ({ waId: x.waId, qty: x.qty, reason: x.reason, remarks: x.remarks })) } }; } catch { return null; } },
    update(actor, id, changes, ctx) { const b = { ...changes }; const submit = b.submit === true; delete b.submit; let d = Object.keys(b).length ? dprs.update(actor, id, b) : dprs.get(actor, id); if (submit) d = dprs.submit(actor, id, { effectiveAt: ctx.effectiveAt, via: 'OFFLINE' }); return { entityId: d.id, version: d.rowVersion }; },
    /** Today's and yesterday's prefill of each site a person reports for, so the phone can start a report with no signal. */
    masterRows(actor) {
      const rows = []; for (const s of dprs.sites(actor).filter((x) => x.canCreate)) for (const date of [todayIST(), isoOf(ordOf(todayIST()) - 1)]) { const p = prefillView(prefill(actor.companyId, { id: s.id }, date, { scope: 'SITE', supervisor: actor.user })); rows.push({ id: `${s.id}:${date}`, siteId: s.id, site: `${s.projectCode} ${s.code}`, date, ...p, changed: nowIso() }); }
      return rows;
    },
  };
  return { dprs, offline, base: { may, need, fail, audit, siteRow, param, tolerances, attendanceOf, labourKey, PRESENT, LIVE, hasAnywhere: (actor, key) => authz.check(actor, key).allowed }, dprDecide: dprs.decide };
}
