import { toPdf } from '../../platform/export/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { rid } from '../proc/base.js';
import { qaHelpers } from '../qa/common.js';

// The HSE dashboard and safety KPIs (part 19.08): every figure is read live from the HSE tables of 19.01 to 19.07 and the attendance man-hours (07.06), inside the data scope of the person; nothing is stored.
// Lagging indicators (what happened): LTIFR, TRIR, severity rate (the incident service, T-01), near-miss ratio, safe man-hours since the last lost-time injury. Leading indicators (what keeps it from happening): toolbox talks, observations
// closed, inspections on time, PPE replacement, induction cover, contractor scores, welfare. Targets are parameters changed through the parameter engine (which audits every change).
for (const [key, type, def, description, min, max] of [
  ['hse.kpi.target_ltifr', 'decimal', 1, 'Target: lost-time injury frequency rate (per the rate base); amber up to one and a half times, red above.', 0, 1000],
  ['hse.kpi.target_trir', 'decimal', 3, 'Target: total recordable incident rate (per the rate base); amber up to one and a half times, red above.', 0, 1000],
  ['hse.kpi.target_observation_closure_pct', 'integer', 80, 'Target: share of observations raised in the period that are closed (percent).', 0, 100],
  ['hse.kpi.target_talks_pct', 'integer', 90, 'Target: toolbox talks held as a share of the talks expected (percent).', 0, 100],
  ['hse.kpi.target_inspection_pct', 'integer', 90, 'Target: inspection schedules that are not overdue (percent).', 0, 100],
  ['hse.kpi.target_ppe_pct', 'integer', 95, 'Target: issued PPE not past its replacement date (percent).', 0, 100],
  ['hse.kpi.target_induction_pct', 'integer', 95, 'Target: deployed workers with a valid induction (percent).', 0, 100],
  ['hse.kpi.talks_per_week', 'integer', 1, 'Toolbox talks expected per site per week.', 0, 21],
  ['hse.kpi.window_days', 'integer', 365, 'The default window of the dashboard in days; the rates are stated over it.', 7, 1100],
  ['hse.kpi.trend_months', 'integer', 12, 'Months shown in the trend charts.', 3, 36]]) {
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description, min, max });
}
const r1 = (n) => Math.round(n * 10) / 10; const r2 = (n) => Math.round(n * 100) / 100;
/** T-01: the rates the way the standards state them: events x base / man-hours, to two places; no rate without hours. */
export const rateOf = (events, hours, base = 1000000) => (hours > 0 ? r2((events * base) / hours) : null);
/** The share of a whole as a percent to one place; nothing when the whole is empty. */
export const pctOf = (part, whole) => (whole > 0 ? r1((part * 100) / whole) : null);

export function createKpiService({ db, base, flags, parts }) {
  const { audit, notify, fail, may, param } = base; void flags; const { evt, gate, scopeOf, pcode } = qaHelpers({ db, base }); const today = () => todayIST(); const key = 'hse.dashboard.view';
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); const dayDiff = (a, b) => Math.round((Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const soft = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  const win = (companyId, q) => { const days = Number(param(companyId, 'hse.kpi.window_days') ?? 365); const to = q.to ?? today(); const from = q.from ?? addDays(to, -days + 1); return { from, to, days: dayDiff(to, from) + 1 }; };
  const targets = (companyId) => ({ ltifr: Number(param(companyId, 'hse.kpi.target_ltifr') ?? 1), trir: Number(param(companyId, 'hse.kpi.target_trir') ?? 3), obs: Number(param(companyId, 'hse.kpi.target_observation_closure_pct') ?? 80), talks: Number(param(companyId, 'hse.kpi.target_talks_pct') ?? 90), insp: Number(param(companyId, 'hse.kpi.target_inspection_pct') ?? 90), ppe: Number(param(companyId, 'hse.kpi.target_ppe_pct') ?? 95), ind: Number(param(companyId, 'hse.kpi.target_induction_pct') ?? 95) });
  /** green at or inside the target, amber within a margin, red beyond; lower is better for a rate, higher for a share. */
  const tone = (value, target, lowerBetter) => { if (value == null || target == null) return 'neutral'; if (lowerBetter) return value <= target ? 'green' : value <= target * 1.5 ? 'amber' : 'red'; return value >= target ? 'green' : value >= target - 10 ? 'amber' : 'red'; };
  const sitesOf = (actor, q) => db.prepare('SELECT s.id, s.code, s.name, s.org_project_id AS pid FROM org_sites s WHERE s.company_id = ? AND s.deleted_at IS NULL ORDER BY s.code').all(actor.companyId).filter((s) => (!q.projectId || s.pid === rid(q.projectId)) && (!q.siteId || s.id === rid(q.siteId)) && may(actor, key, s.pid, s.id));
  const where = (actor, q, alias = 'x') => { let sql = `${scopeOf(actor, key, alias)} AND ${alias}.deleted_at IS NULL`; const P = { c: actor.companyId }; if (q.projectId) { sql += ` AND ${alias}.org_project_id = :pj`; P.pj = rid(q.projectId); } if (q.siteId) { sql += ` AND ${alias}.org_site_id = :s`; P.s = rid(q.siteId); } return { sql, P }; };
  const one = (sql, P) => db.prepare(sql).get(P);
  const hoursFor = (companyId, siteIds, from, to) => (siteIds.length ? Math.round(db.prepare(`SELECT COALESCE(SUM(worked_minutes), 0) AS m FROM att_daily WHERE company_id = ? AND daily_site_id IN (${siteIds.map(() => '?').join(', ')}) AND work_date >= ? AND work_date <= ? AND deleted_at IS NULL`).get(companyId, ...siteIds, from, to).m / 60) : 0);

  /** FR-01, FR-02: safe man-hours since the last lost-time injury (or since the first attendance when there has been none). */
  function safeHours(actor, q, sites) {
    const w = where(actor, q); const last = one(`SELECT MAX(substr(x.occurred_at, 1, 10)) AS d FROM hse_incidents x WHERE ${w.sql} AND x.classification IN ('LTI', 'FATALITY') AND x.incident_status <> 'CANCELLED'`, w.P).d; const ids = sites.map((s) => s.id);
    const first = ids.length ? db.prepare(`SELECT MIN(work_date) AS d FROM att_daily WHERE company_id = ? AND daily_site_id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL`).get(actor.companyId, ...ids).d : null; const since = last ? addDays(last, 1) : first;
    return { lastLtiDate: last, since, days: last ? dayDiff(today(), last) : (first ? dayDiff(today(), first) : null), manHours: since ? hoursFor(actor.companyId, ids, since, today()) : 0 };
  }
  function leading(actor, q, w, sites) {
    const T = targets(actor.companyId); const x = where(actor, q); const range = (col) => ` AND substr(x.${col}, 1, 10) >= :from AND substr(x.${col}, 1, 10) <= :to`; const P = { ...x.P, from: w.from, to: w.to }; const t0 = today();
    const talks = one(`SELECT COUNT(*) AS n, COALESCE(SUM(x.attendee_count), 0) AS a FROM hse_toolbox_talks x WHERE ${x.sql} AND x.status = 'APPROVED'${range('talk_date')}`, P); const expected = Math.max(0, Math.round((w.days / 7) * sites.length * Number(param(actor.companyId, 'hse.kpi.talks_per_week') ?? 1)));
    const raised = one(`SELECT COUNT(*) AS n FROM hse_observations x WHERE ${x.sql} AND x.obs_status <> 'CANCELLED'${range('created_at')}`, P).n; const closedOfRaised = one(`SELECT COUNT(*) AS n FROM hse_observations x WHERE ${x.sql} AND x.obs_status = 'CLOSED'${range('created_at')}`, P).n;
    const closedInPeriod = one(`SELECT COUNT(*) AS n FROM hse_observations x WHERE ${x.sql} AND x.obs_status = 'CLOSED'${range('closed_on')}`, P).n; const obsOpen = one(`SELECT COUNT(*) AS n FROM hse_observations x WHERE ${x.sql} AND x.obs_status IN ('OPEN', 'ACTION_DONE')`, x.P).n;
    const obsOverdue = one(`SELECT COUNT(*) AS n FROM hse_observations x WHERE ${x.sql} AND x.obs_status IN ('OPEN', 'ACTION_DONE') AND x.due_at IS NOT NULL AND substr(x.due_at, 1, 10) < :t`, { ...x.P, t: t0 }).n;
    const sch = one(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN x.next_due < :t THEN 1 ELSE 0 END), 0) AS late FROM hse_inspection_schedules x WHERE ${x.sql} AND x.schedule_status = 'ACTIVE'`, { ...x.P, t: t0 }); const done = one(`SELECT COUNT(*) AS n FROM hse_inspection_schedules x WHERE ${x.sql} AND x.schedule_status = 'ACTIVE' AND x.last_done_on >= :from AND x.last_done_on <= :to`, P).n;
    const ppe = one(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN x.replace_due IS NOT NULL AND x.replace_due < :t THEN 1 ELSE 0 END), 0) AS late FROM hse_ppe_issues x WHERE ${x.sql} AND x.issue_status = 'ISSUED'`, { ...x.P, t: t0 });
    const permits = one(`SELECT COALESCE(SUM(CASE WHEN x.permit_status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active, COALESCE(SUM(CASE WHEN x.permit_status = 'SUSPENDED' THEN 1 ELSE 0 END), 0) AS suspended, COALESCE(SUM(CASE WHEN x.permit_status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS expired FROM hse_permits x WHERE ${x.sql} AND x.status = 'APPROVED'`, x.P);
    const issued = one(`SELECT COUNT(*) AS n FROM hse_permits x WHERE ${x.sql} AND x.status = 'APPROVED'${range('activated_at')}`, P).n;
    const ind = soft(() => parts().ind.compliance(actor, { projectId: q.projectId, siteId: q.siteId, from: w.from, to: w.to })); const sc = soft(() => parts().sf.scores.list(actor, {})); const camp = soft(() => parts().cm.campInspections.compliance(actor));
    const campRows = (camp?.camps ?? []).filter((c) => c.compliancePct != null);
    return {
      T, talks: { held: talks.n, expected, attendance: talks.a, pct: pctOf(talks.n, expected) }, observations: { raised, closedOfRaised, closedInPeriod, open: obsOpen, overdue: obsOverdue, closurePct: pctOf(closedOfRaised, raised) },
      inspections: { schedules: sch.n, overdue: sch.late, doneInPeriod: done, onTimePct: pctOf(sch.n - sch.late, sch.n) }, ppe: { issued: ppe.n, overdue: ppe.late, pct: pctOf(ppe.n - ppe.late, ppe.n) },
      permits: { active: permits.active, suspended: permits.suspended, expired: permits.expired, issuedInPeriod: issued },
      induction: ind ? { deployed: ind.totals.deployed, inducted: ind.totals.inducted, notInducted: ind.totals.notInducted, expiringSoon: ind.totals.expiringSoon, pct: pctOf(ind.totals.inducted, ind.totals.deployed) } : null,
      contractors: sc ? { count: sc.rows.length, average: sc.rows.length ? Math.round(sc.rows.reduce((n, r) => n + r.score, 0) / sc.rows.length) : null, low: sc.rows.filter((r) => r.band === 'D' || r.band === 'C').length, worst: sc.rows.slice(0, 3).map((r) => ({ name: r.name, score: r.score, band: r.band })) } : null,
      welfare: campRows.length ? { camps: campRows.length, pct: r1(campRows.reduce((n, c) => n + c.compliancePct, 0) / campRows.length) } : null,
    };
  }
  /** The monthly series of the rates over the months before the end of the window. */
  function trend(actor, q, w) {
    const n = Number(param(actor.companyId, 'hse.kpi.trend_months') ?? 12); const end = w.to.slice(0, 7); const months = []; let [y, m] = end.split('-').map(Number); for (let i = 0; i < n; i += 1) { months.unshift(`${y}-${String(m).padStart(2, '0')}`); m -= 1; if (m === 0) { m = 12; y -= 1; } }
    return months.map((ym) => { const s = parts().inc.stats(actor, { projectId: q.projectId, siteId: q.siteId, from: `${ym}-01`, to: lastDay(ym) < w.to ? lastDay(ym) : w.to }, key); return { month: ym, manHours: s.manHours, lti: s.lti, recordable: s.recordable, nearMiss: s.counts.NEAR_MISS, ltifr: s.ltifr, trir: s.trir, lostDays: s.lostDays }; });
  }
  function siteTable(actor, q, w, sites) {
    return sites.map((s) => { const st = parts().inc.stats(actor, { siteId: s.id, from: w.from, to: w.to }, key); const x = { c: actor.companyId, s: s.id, from: w.from, to: w.to, t: today() }; const obsOpen = db.prepare("SELECT COUNT(*) AS n FROM hse_observations WHERE company_id = :c AND org_site_id = :s AND obs_status IN ('OPEN', 'ACTION_DONE') AND deleted_at IS NULL").get({ c: x.c, s: x.s }).n;
      const talks = db.prepare("SELECT COUNT(*) AS n FROM hse_toolbox_talks WHERE company_id = :c AND org_site_id = :s AND status = 'APPROVED' AND talk_date >= :from AND talk_date <= :to AND deleted_at IS NULL").get({ c: x.c, s: x.s, from: x.from, to: x.to }).n; const permits = db.prepare("SELECT COUNT(*) AS n FROM hse_permits WHERE company_id = :c AND org_site_id = :s AND permit_status = 'ACTIVE' AND status = 'APPROVED' AND deleted_at IS NULL").get({ c: x.c, s: x.s }).n;
      return { siteId: s.id, site: s.code, siteName: s.name, projectId: s.pid, project: pcode(s.pid), manHours: st.manHours, lti: st.lti, recordable: st.recordable, nearMiss: st.counts.NEAR_MISS, ltifr: st.ltifr, trir: st.trir, severityRate: st.severityRate, openObservations: obsOpen, talks, activePermits: permits, drill: `/hse/incidents?filter[site]=${encodeURIComponent(s.code)}` }; }).sort((a, b) => (b.ltifr ?? -1) - (a.ltifr ?? -1) || a.site.localeCompare(b.site));
  }
  /** FR-01 to FR-03, BR-01: the tiles with value, target and colour, the leading indicators, the trend, the comparison of sites, the exceptions and the person's pending HSE approvals. */
  function dashboard(actor, q = {}) {
    gate(actor, key, 'see the HSE dashboard'); const w = win(actor.companyId, q); const sites = sitesOf(actor, q); const T = targets(actor.companyId);
    const lag = parts().inc.stats(actor, { projectId: q.projectId, siteId: q.siteId, from: w.from, to: w.to }, key); const lead = leading(actor, q, w, sites); const safe = safeHours(actor, q, sites); const nearMiss = lag.counts.NEAR_MISS;
    const nmRatio = lag.recordable > 0 ? r1(nearMiss / lag.recordable) : null;
    const tiles = [
      { key: 'ltifr', group: 'lagging', value: lag.ltifr, unit: '', target: T.ltifr, status: tone(lag.ltifr, T.ltifr, true), note: { k: 'lti', n: lag.lti }, drill: '/hse/incidents?filter[classification]=LTI' },
      { key: 'trir', group: 'lagging', value: lag.trir, unit: '', target: T.trir, status: tone(lag.trir, T.trir, true), note: { k: 'recordable', n: lag.recordable }, drill: '/hse/incidents' },
      { key: 'severityRate', group: 'lagging', value: lag.severityRate, unit: '', target: null, status: 'neutral', note: { k: 'lostDays', n: lag.lostDays }, drill: '/hse/incidents' },
      { key: 'nearMissRatio', group: 'lagging', value: nmRatio, unit: ' : 1', target: null, status: 'neutral', note: { k: 'nearMiss', n: nearMiss }, drill: '/hse/incidents?filter[type]=NEAR_MISS' },
      { key: 'safeManHours', group: 'lagging', value: safe.manHours, unit: ' h', target: null, status: safe.lastLtiDate ? 'neutral' : 'green', note: safe.lastLtiDate ? { k: 'sinceLti', n: safe.days } : { k: 'noLti' }, drill: '/hse/incidents?filter[classification]=LTI' },
      { key: 'manHours', group: 'lagging', value: lag.manHours, unit: ' h', target: null, status: 'neutral', note: { k: 'sites', n: sites.length }, drill: null },
      { key: 'talks', group: 'leading', value: lead.talks.pct, unit: '%', target: T.talks, status: tone(lead.talks.pct, T.talks, false), note: { k: 'talks', n: lead.talks.held, m: lead.talks.expected }, drill: '/hse/toolbox' },
      { key: 'observationClosure', group: 'leading', value: lead.observations.closurePct, unit: '%', target: T.obs, status: tone(lead.observations.closurePct, T.obs, false), note: { k: 'obs', n: lead.observations.raised, m: lead.observations.open }, drill: '/hse/observations' },
      { key: 'inspections', group: 'leading', value: lead.inspections.onTimePct, unit: '%', target: T.insp, status: tone(lead.inspections.onTimePct, T.insp, false), note: { k: 'insp', n: lead.inspections.overdue, m: lead.inspections.schedules }, drill: '/hse/inspection-schedules' },
      { key: 'ppe', group: 'leading', value: lead.ppe.pct, unit: '%', target: T.ppe, status: tone(lead.ppe.pct, T.ppe, false), note: { k: 'ppe', n: lead.ppe.overdue }, drill: '/hse/ppe-register' },
      { key: 'induction', group: 'leading', value: lead.induction?.pct ?? null, unit: '%', target: T.ind, status: tone(lead.induction?.pct ?? null, T.ind, false), note: lead.induction ? { k: 'ind', n: lead.induction.notInducted } : { k: 'na' }, drill: '/hse/compliance' },
      { key: 'contractors', group: 'leading', value: lead.contractors?.average ?? null, unit: '', target: null, status: 'neutral', note: lead.contractors ? { k: 'contr', n: lead.contractors.low } : { k: 'na' }, drill: '/hse/contractor-scores' },
    ];
    const exceptions = [];
    if (lag.ltifr != null && lag.ltifr > T.ltifr) exceptions.push({ key: 'ltifrOverTarget', count: 1, tone: tone(lag.ltifr, T.ltifr, true), drill: '/hse/incidents?filter[classification]=LTI' });
    if (lag.openInvestigations) exceptions.push({ key: 'openInvestigations', count: lag.openInvestigations, tone: 'amber', drill: '/hse/incidents' });
    if (lead.observations.overdue) exceptions.push({ key: 'overdueObservations', count: lead.observations.overdue, tone: 'amber', drill: '/hse/observations' });
    if (lead.inspections.overdue) exceptions.push({ key: 'overdueInspections', count: lead.inspections.overdue, tone: 'amber', drill: '/hse/inspection-schedules' });
    if (lead.permits.expired) exceptions.push({ key: 'expiredPermits', count: lead.permits.expired, tone: 'red', drill: '/hse/permit-board' });
    if (lead.ppe.overdue) exceptions.push({ key: 'ppeDue', count: lead.ppe.overdue, tone: 'amber', drill: '/hse/ppe-register' });
    if (lead.induction?.notInducted) exceptions.push({ key: 'notInducted', count: lead.induction.notInducted, tone: 'red', drill: '/hse/compliance' });
    const pending = soft(() => workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.filter((t) => /^(HSE_|SCY_|CAMP_)/.test(String(t.instance?.docType ?? t.instance?.doc_type ?? ''))).length, 0);
    return { can: { export: base.authz.hasAnywhere(actor, 'hse.dashboard.export'), report: base.authz.hasAnywhere(actor, 'hse.dashboard.report') }, filters: { projects: [...new Map(sites.map((x) => [x.pid, { id: x.pid, code: pcode(x.pid) }])).values()], sites: sites.map((x) => ({ id: x.id, code: x.code, name: x.name, projectId: x.pid })) }, period: { from: w.from, to: w.to, days: w.days }, projectId: q.projectId ? rid(q.projectId) : null, siteId: q.siteId ? rid(q.siteId) : null, rateBase: lag.rateBase, tiles, lagging: { ...lag, nearMissRatio: nmRatio, safe }, leading: lead, exceptions, pending, trend: trend(actor, q, w), sites: siteTable(actor, q, w, sites) };
  }
  /** The monthly report (FR-03): the figures of one month, the comparison of sites and the highlights, as a PDF. */
  function monthlyReport(actor, q = {}) {
    gate(actor, 'hse.dashboard.report', 'make the monthly HSE report'); const month = q.month ?? today().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(month)) fail([{ field: 'month', message: 'Use a month such as 2026-12' }]);
    const d = dashboard(actor, { projectId: q.projectId, siteId: q.siteId, from: `${month}-01`, to: lastDay(month) < today() ? lastDay(month) : today() }); const name = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    const rows = [{ a: 'HSE report', b: month, c: '', d: '' }, ...d.tiles.map((k) => ({ a: name(k.key), b: k.value == null ? '-' : `${k.value}${k.unit}`, c: k.target == null ? '' : `${k.target}${k.unit === '%' ? '%' : ''}`, d: k.status })), { a: 'Sites', b: 'Man-hours / LTI', c: 'LTIFR / TRIR', d: 'Open observations' }, ...d.sites.map((s) => ({ a: `${s.site} ${s.siteName}`, b: `${s.manHours} / ${s.lti}`, c: `${s.ltifr ?? '-'} / ${s.trir ?? '-'}`, d: String(s.openObservations) })), ...d.exceptions.map((e) => ({ a: 'Attention', b: name(e.key), c: String(e.count), d: e.tone }))];
    audit(actor, 'hse_dashboard', 0, 'report', actor.companyId, { reason: `monthly report ${month}` });
    return { buffer: toPdf({ columns: [{ key: 'a', label: 'Particular', type: 'text' }, { key: 'b', label: 'Value', type: 'text' }, { key: 'c', label: 'Target', type: 'text' }, { key: 'd', label: 'Status', type: 'text' }], rows, footer: [`Rates per ${d.rateBase} man-hours`], title: `Monthly HSE report ${month}` }), contentType: 'application/pdf', fileName: `hse-report-${month}.pdf`, rows: rows.length };
  }
  function exportCsv(actor, q = {}) {
    gate(actor, 'hse.dashboard.export', 'export the HSE figures'); const kind = q.kind ?? 'kpis'; const d = dashboard(actor, q); let headers; let rows;
    if (kind === 'sites') { headers = ['Site', 'Project', 'Man-hours', 'LTI', 'Recordable', 'Near miss', 'LTIFR', 'TRIR', 'Severity rate', 'Open observations', 'Talks', 'Active permits']; rows = d.sites.map((s) => [s.site, s.project, s.manHours, s.lti, s.recordable, s.nearMiss, s.ltifr ?? '', s.trir ?? '', s.severityRate ?? '', s.openObservations, s.talks, s.activePermits]); }
    else if (kind === 'trend') { headers = ['Month', 'Man-hours', 'LTI', 'Recordable', 'Near miss', 'LTIFR', 'TRIR', 'Lost days']; rows = d.trend.map((m) => [m.month, m.manHours, m.lti, m.recordable, m.nearMiss, m.ltifr ?? '', m.trir ?? '', m.lostDays]); }
    else { headers = ['KPI', 'Group', 'Value', 'Target', 'Status']; rows = d.tiles.map((k) => [k.key, k.group, k.value ?? '', k.target ?? '', k.status]); }
    audit(actor, 'hse_dashboard', 0, 'export', actor.companyId, { reason: `${kind} ${rows.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `hse-${kind}-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') };
  }
  /** The Project 360 widget (10.08): the safety figures of one project. */
  function projectWidget(actor, projectId) {
    const d = dashboard(actor, { projectId }); const by = Object.fromEntries(d.tiles.map((k) => [k.key, k])); const f = (k, label, unit = '') => ({ key: k, label, value: by[k].value == null ? '-' : `${by[k].value}${unit}`, tone: by[k].status === 'neutral' ? undefined : by[k].status, drill: by[k].drill });
    return { figures: [f('ltifr', 'LTIFR'), f('trir', 'TRIR'), f('safeManHours', 'Safe man-hours', ' h'), f('observationClosure', 'Observations closed', ' %')], rows: d.exceptions.slice(0, 3).map((e) => ({ label: `${e.key}: ${e.count}`, value: e.count, drill: e.drill })) };
  }
  function widget(actor, code) {
    const d = dashboard(actor, {}); const k = d.tiles.find((x) => x.key === (code === 'hse.ltifr' ? 'ltifr' : 'safeManHours')); return { value: k.value ?? 0, unit: code === 'hse.ltifr' ? ' LTIFR' : ' safe hours', previous: code === 'hse.ltifr' ? (d.trend.at(-2)?.ltifr ?? null) : null, trendPct: null, target: k.target, status: k.status, note: k.note ? `${k.note.n ?? ''}` : null };
  }
  /** The nightly check: the company rate over the year against the target; the HSE head is told once a month, and `hse.kpi.breached` is published for the control towers. */
  function breachCheck(companyId) {
    const t = today(); const from = `${t.slice(0, 4)}-01-01`; const T = targets(companyId); const baseN = Number(param(companyId, 'hse.kpi.rate_base') ?? 1000000);
    const sites = db.prepare('SELECT id FROM org_sites WHERE company_id = ? AND deleted_at IS NULL').all(companyId).map((s) => s.id); const hours = hoursFor(companyId, sites, from, t); const lti = db.prepare("SELECT COUNT(*) AS n FROM hse_incidents WHERE company_id = ? AND classification IN ('LTI', 'FATALITY') AND incident_status <> 'CANCELLED' AND deleted_at IS NULL AND substr(occurred_at, 1, 10) >= ?").get(companyId, from).n;
    const ltifr = rateOf(lti, hours, baseN); if (ltifr == null || ltifr <= T.ltifr) return { told: 0, ltifr }; const period = t.slice(0, 7);
    notify(companyId, 'hse.kpi.alert', ['role:HSEO', 'role:PD'], 'LTIFR', 'over target', `The lost-time injury frequency rate this year is ${ltifr} against a target of ${T.ltifr} (per ${baseN} man-hours).`, '/hse/dashboard', `ltifr.${period}`, {});
    evt('hse.kpi.breached', { user: 'system' }, companyId, 'hse_dashboard', 0, { metric: 'ltifr', value: ltifr, target: T.ltifr, period, manHours: hours, lti }, null); return { told: 1, ltifr };
  }
  return { dashboard, monthlyReport, exportCsv, projectWidget, widget, breachCheck };
}
