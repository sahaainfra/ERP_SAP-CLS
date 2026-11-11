import { forbidden, badRequest } from '../../platform/http/errors.js';
import { toCsv, toPdf, toXlsx } from '../../platform/export/index.js';
import { todayIST } from '../../../shared/dates.js';
import { isoOf, ordOf } from '../plan/cpm.js';
import { CATEGORIES, NOTE_TYPES, WEATHER } from './dpr.js';

// The reports of the daily progress reports (part 14.02): the days a site should have reported and did not (missing), the share sent by the cut-off (compliance), the consolidated daily site report of
// the approved reports and the weekly and monthly progress reports built from them (FR-07). Every figure comes from the approved reports; none is typed.
const d3 = (n) => (n == null ? null : n / 1000);
const MAX_DAYS = 93;
const chunks = (a, n = 800) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const mondayOf = (iso) => isoOf(ordOf(iso) - ((ordOf(iso) + 3) % 7));
const istNow = () => new Date(Date.now() + 19_800_000).toISOString();

export function createDprReports({ db, base }) {
  const { may, fail, audit, param, PRESENT } = base;
  const range = (q, def = 13) => { const to = q.to ?? todayIST(); const from = q.from ?? isoOf(ordOf(to) - def); if (from > to) fail([{ field: 'to', message: 'The end is not before the start' }]); if (ordOf(to) - ordOf(from) + 1 > MAX_DAYS) fail([{ field: 'to', message: `At most ${MAX_DAYS} days at a time` }]); return { from, to }; };
  const visibleSites = (actor, q, key) => {
    const rows = db.prepare("SELECT s.id, s.code, s.name, s.org_project_id AS pid, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE'").all(actor.companyId);
    return new Map(rows.filter((s) => (!q.projectId || s.pid === q.projectId) && (!q.siteId || s.id === q.siteId) && may(actor, key, s.pid, s.id)).map((s) => [s.id, s]));
  };

  /** Every site and day that should have a report (a work authorisation or attendance that day) with what became of it: missing, late, or on time. Today counts only after the cut-off. */
  function siteDays(actor, q) {
    const { from, to } = range(q); const sites = visibleSites(actor, q, 'site.dpr.report'); const today = todayIST();
    const cut = String(param(actor.companyId, 'site.dpr.cutoff_time') ?? '19:00'); const dueToday = istNow().slice(11, 16) >= cut;
    const exp = db.prepare(`SELECT DISTINCT wa_site_id AS site_id, plan_date AS d FROM site_work_authorisations WHERE company_id = ? AND plan_date BETWEEN ? AND ? AND status IN ('APPROVED', 'EMERGENCY', 'CLOSED') AND deleted_at IS NULL
      UNION SELECT DISTINCT daily_site_id, work_date FROM att_daily WHERE company_id = ? AND work_date BETWEEN ? AND ? AND status IN (${PRESENT.map(() => '?').join(',')}) AND daily_site_id IS NOT NULL AND deleted_at IS NULL`).all(actor.companyId, from, to, actor.companyId, from, to, ...PRESENT)
      .filter((x) => sites.has(x.site_id) && x.d <= today && (x.d < today || dueToday));
    const reps = new Map(); const drafts = new Map();
    for (const d of db.prepare("SELECT id, doc_no, dpr_site_id, dpr_date, status, late, submitted_at, approved_at, scope FROM site_dprs WHERE company_id = ? AND dpr_date BETWEEN ? AND ? AND parent_dpr_id IS NULL AND deleted_at IS NULL ORDER BY id").all(actor.companyId, from, to)) {
      const k = `${d.dpr_site_id}|${d.dpr_date}`;
      if (d.submitted_at && ['SUBMITTED', 'APPROVED', 'SUPERSEDED'].includes(d.status)) { const c = reps.get(k); if (!c || d.submitted_at < c.submitted_at) reps.set(k, d); } else if (['DRAFT', 'RETURNED'].includes(d.status)) drafts.set(k, d);
    }
    return exp.map((x) => {
      const s = sites.get(x.site_id); const k = `${x.site_id}|${x.d}`; const r = reps.get(k); const dr = drafts.get(k);
      const same = r?.approved_at ? new Date(Date.parse(r.approved_at) + 19_800_000).toISOString().slice(0, 10) === x.d : false;
      return { siteId: s.id, site: s.code, siteName: s.name, project: s.pcode, projectId: s.pid, date: x.d, state: !r ? 'MISSING' : r.late ? 'LATE' : 'ON_TIME', dprId: r?.id ?? dr?.id ?? null, docNo: r?.doc_no ?? dr?.doc_no ?? null, status: r?.status ?? dr?.status ?? null, submittedAt: r?.submitted_at ?? null, approvedSameDay: Boolean(same), draft: !r && Boolean(dr) };
    }).sort((a, b) => b.date.localeCompare(a.date) || a.project.localeCompare(b.project) || a.site.localeCompare(b.site));
  }
  const need = (actor) => { if (!base.hasAnywhere(actor, 'site.dpr.report')) throw forbidden('You may not see the DPR reports (permission site.dpr.report).'); };
  const pct = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : null);
  function compliance(actor, q) {
    need(actor); const { from, to } = range(q); const rows = siteDays(actor, { ...q, from, to });
    const count = (f) => rows.filter(f).length; const expected = rows.length; const submitted = count((r) => r.state !== 'MISSING'); const onTime = count((r) => r.state === 'ON_TIME'); const late = count((r) => r.state === 'LATE'); const missing = count((r) => r.state === 'MISSING');
    const same = count((r) => r.approvedSameDay);
    const group = (keyOf, mk) => { const m = new Map(); for (const r of rows) { const k = keyOf(r); const g = m.get(k) ?? mk(r); g.expected += 1; if (r.state === 'ON_TIME') g.onTime += 1; else if (r.state === 'LATE') g.late += 1; else { g.missing += 1; g.missingDates.push(r.date); } m.set(k, g); } return [...m.values()]; };
    return { from, to, totals: { expected, submitted, onTime, late, missing, approvedSameDay: same, onTimePct: pct(onTime, expected), submittedPct: pct(submitted, expected), approvedSameDayPct: pct(same, submitted) },
      bySite: group((r) => r.siteId, (r) => ({ siteId: r.siteId, site: r.site, siteName: r.siteName, project: r.project, projectId: r.projectId, expected: 0, onTime: 0, late: 0, missing: 0, missingDates: [] })).map((g) => ({ ...g, onTimePct: pct(g.onTime, g.expected) })).sort((a, b) => b.missing - a.missing || a.site.localeCompare(b.site)),
      byDay: group((r) => r.date, (r) => ({ date: r.date, expected: 0, onTime: 0, late: 0, missing: 0, missingDates: [] })).map((g) => ({ date: g.date, expected: g.expected, onTime: g.onTime, late: g.late, missing: g.missing })).sort((a, b) => a.date.localeCompare(b.date)),
      cutoff: param(actor.companyId, 'site.dpr.cutoff_time') };
  }
  function missing(actor, q) { need(actor); const { from, to } = range(q, 6); const rows = siteDays(actor, { ...q, from, to }).filter((r) => r.state === 'MISSING'); return { from, to, rows, total: rows.length }; }
  /** The figure of the widget: the share sent on time over the last 14 days and the sites with a missing report today or yesterday. */
  function widget(actor) { const c = compliance(actor, {}); const t = c.totals; return { value: t.onTimePct ?? 100, expected: t.expected, missing: t.missing, bySite: c.bySite.filter((s) => s.missing > 0).length }; }

  // ---- the consolidated daily site report and the weekly and monthly progress reports (FR-07) -------------------------------------------------------------------------------------------------
  function periodOf(q) {
    const kind = q.period ?? 'DAY'; const ref = q.date ?? todayIST();
    if (kind === 'RANGE') { const { from, to } = range({ from: q.from, to: q.to }, 6); return { kind, from, to, label: `${from} to ${to}` }; }
    if (kind === 'WEEK') { const from = mondayOf(ref); return { kind, from, to: isoOf(ordOf(from) + 6), label: `Week of ${from}` }; }
    if (kind === 'MONTH') { const y = Number(ref.slice(0, 4)); const m = Number(ref.slice(5, 7)); const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return { kind, from: `${ref.slice(0, 7)}-01`, to, label: `${ref.slice(0, 7)}` }; }
    return { kind: 'DAY', from: ref, to: ref, label: ref };
  }
  /** The approved reports of the period for the sites a person may read: for each site and day the site's report, or the supervisors' reports when the site has none. */
  function approvedOf(actor, q, per) {
    const sites = visibleSites(actor, q, 'site.dpr.report'); const all = db.prepare("SELECT * FROM site_dprs WHERE company_id = ? AND dpr_date BETWEEN ? AND ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY dpr_date, id").all(actor.companyId, per.from, per.to).filter((d) => sites.has(d.dpr_site_id));
    const byDay = new Map(); for (const d of all) { const k = `${d.dpr_site_id}|${d.dpr_date}`; const g = byDay.get(k) ?? { site: [], sup: [] }; (d.scope === 'SITE' ? g.site : g.sup).push(d); byDay.set(k, g); }
    return { sites, dprs: [...byDay.values()].flatMap((g) => (g.site.length ? g.site : g.sup)), pending: db.prepare("SELECT COUNT(*) AS n FROM site_dprs WHERE company_id = ? AND dpr_date BETWEEN ? AND ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(actor.companyId, per.from, per.to).n };
  }
  function report(actor, q) {
    need(actor); const per = periodOf(q); const { sites, dprs, pending } = approvedOf(actor, q, per); const ids = dprs.map((d) => d.id);
    const sum = (sql, ...p) => chunks(ids).flatMap((c) => db.prepare(sql.replace('@IN', c.map(() => '?').join(','))).all(...c, ...p));
    const merge = (rows, keyOf, mk, add) => { const m = new Map(); for (const r of rows) { const k = keyOf(r); const g = m.get(k) ?? mk(r); add(g, r); m.set(k, g); } return [...m.values()]; };
    const siteOf = new Map(dprs.map((d) => [d.id, sites.get(d.dpr_site_id)]));
    const work = merge(sum('SELECT w.dpr_id, w.wa_id, w.activity_id, w.qty, w.uom, w.planned_qty, w.over_wa, a.code, a.name FROM site_dpr_work w JOIN plan_activities a ON a.id = w.activity_id WHERE w.dpr_id IN (@IN) AND w.deleted_at IS NULL'), (r) => `${r.activity_id}|${r.uom}`, (r) => ({ activityId: r.activity_id, activity: `${r.code} ${r.name}`, uom: r.uom, qty: 0, plannedQty: 0, lines: 0, overWa: 0, sites: new Set() }), (g, r) => { g.qty += r.qty; g.plannedQty += r.planned_qty; g.lines += 1; g.overWa += r.over_wa; g.sites.add(siteOf.get(r.dpr_id).code); })
      .map((g) => ({ activityId: g.activityId, activity: g.activity, uom: g.uom, qty: d3(g.qty), plannedQty: d3(g.plannedQty), pctOfPlan: g.plannedQty ? Math.round((g.qty * 1000) / g.plannedQty) / 10 : null, lines: g.lines, overWa: g.overWa, sites: [...g.sites].sort() })).sort((a, b) => a.activity.localeCompare(b.activity));
    const labour = merge(sum('SELECT l.dpr_id, l.category, l.contractor_id, l.trade_code, l.headcount, l.man_days, l.ot_hours, l.flagged, p.legal_name AS contractor FROM site_dpr_labour l LEFT JOIN mdm_partners p ON p.id = l.contractor_id WHERE l.dpr_id IN (@IN) AND l.deleted_at IS NULL'), (r) => `${r.category}|${r.contractor_id ?? 0}|${String(r.trade_code).toLowerCase()}`, (r) => ({ category: r.category, contractor: r.contractor ?? null, trade: r.trade_code, manDays: 0, otHours: 0, headcountDays: 0, flagged: 0 }), (g, r) => { g.manDays += r.man_days; g.otHours += r.ot_hours; g.headcountDays += r.headcount; g.flagged += r.flagged; })
      .map((g) => ({ ...g, categoryLabel: CATEGORIES[g.category], manDays: d3(g.manDays), otHours: d3(g.otHours) })).sort((a, b) => a.category.localeCompare(b.category) || a.trade.localeCompare(b.trade));
    const materials = merge(sum('SELECT m.qty, m.uom, i.code, i.name, m.item_id FROM site_dpr_materials m JOIN mdm_items i ON i.id = m.item_id WHERE m.dpr_id IN (@IN) AND m.deleted_at IS NULL'), (r) => `${r.item_id}|${r.uom}`, (r) => ({ item: `${r.code} ${r.name}`, uom: r.uom, qty: 0 }), (g, r) => { g.qty += r.qty; }).map((g) => ({ ...g, qty: d3(g.qty) })).sort((a, b) => a.item.localeCompare(b.item));
    const equipment = merge(sum('SELECT equipment_key, label, hours_worked, hours_idle, hours_breakdown FROM site_dpr_equipment WHERE dpr_id IN (@IN) AND deleted_at IS NULL'), (r) => String(r.equipment_key).toLowerCase(), (r) => ({ label: r.label, hoursWorked: 0, hoursIdle: 0, hoursBreakdown: 0 }), (g, r) => { g.hoursWorked += r.hours_worked; g.hoursIdle += r.hours_idle; g.hoursBreakdown += r.hours_breakdown; })
      .map((g) => ({ ...g, hoursWorked: d3(g.hoursWorked), hoursIdle: d3(g.hoursIdle), hoursBreakdown: d3(g.hoursBreakdown) })).sort((a, b) => a.label.localeCompare(b.label));
    const notes = sum("SELECT n.dpr_id, n.note_type, n.note_text FROM site_dpr_notes n WHERE n.dpr_id IN (@IN) AND n.deleted_at IS NULL AND n.note_type IN ('HINDRANCE', 'SAFETY', 'QUALITY', 'INSTRUCTION') ORDER BY n.id");
    const byDpr = new Map(dprs.map((d) => [d.id, d])); const noteRows = notes.slice(0, 300).map((n) => { const d = byDpr.get(n.dpr_id); return { date: d.dpr_date, site: siteOf.get(d.id).code, docNo: d.doc_no, type: n.note_type, typeLabel: NOTE_TYPES[n.note_type], text: n.note_text }; });
    const perDpr = new Map(); for (const r of sum('SELECT dpr_id, SUM(man_days) AS md FROM site_dpr_labour WHERE dpr_id IN (@IN) AND deleted_at IS NULL GROUP BY dpr_id')) perDpr.set(r.dpr_id, { md: r.md }); const wl = new Map(sum('SELECT dpr_id, COUNT(*) AS n FROM site_dpr_work WHERE dpr_id IN (@IN) AND deleted_at IS NULL GROUP BY dpr_id').map((r) => [r.dpr_id, r.n]));
    const hin = new Map(); for (const n of notes.filter((x) => x.note_type === 'HINDRANCE')) hin.set(n.dpr_id, (hin.get(n.dpr_id) ?? 0) + 1);
    const days = dprs.map((d) => { const f = JSON.parse(d.flags_json || '{}'); return { date: d.dpr_date, site: siteOf.get(d.id).code, project: siteOf.get(d.id).pcode, dprId: d.id, docNo: d.doc_no, supervisor: d.supervisor, scope: d.scope, late: Boolean(d.late), weather: d.weather_code ? WEATHER[d.weather_code] : null, rainMm: d.rain_mm, workLines: wl.get(d.id) ?? 0, manDays: d3(perDpr.get(d.id)?.md ?? 0), hindrances: hin.get(d.id) ?? 0, flagged: (f.labourFlagged ?? 0) + (f.overWa ?? 0) }; }).sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site));
    const weather = merge(days.filter((d) => d.weather), (d) => d.weather, (d) => ({ weather: d.weather, days: 0, rainMm: 0 }), (g, d) => { g.days += 1; g.rainMm += d.rainMm ?? 0; });
    const manDays = labour.reduce((t, l) => t + l.manDays, 0);
    return { period: per, filters: { projectId: q.projectId ?? null, siteId: q.siteId ?? null }, counts: { dprs: dprs.length, siteDays: new Set(dprs.map((d) => `${d.dpr_site_id}|${d.dpr_date}`)).size, sites: new Set(dprs.map((d) => d.dpr_site_id)).size, late: dprs.filter((d) => d.late).length, amended: dprs.filter((d) => d.revision_no > 1).length, pendingApproval: pending }, totals: { manDays: Math.round(manDays * 1000) / 1000, hindrances: noteRows.filter((n) => n.type === 'HINDRANCE').length, rainMm: weather.reduce((t, w) => t + w.rainMm, 0) },
      work, labour, materials, equipment, weather, notes: noteRows, days };
  }
  /** The report as XLSX, CSV or PDF: one list of rows with the section they belong to, from the same figures as the screen. */
  function reportExport(actor, q) {
    if (!base.hasAnywhere(actor, 'site.dpr.export')) throw forbidden('You may not export daily progress reports (permission site.dpr.export).');
    const r = report(actor, q); const rows = []; const add = (section, item, qty, unit, detail, site = '') => rows.push({ section, site, item, qty: qty == null ? '' : qty, unit: unit ?? '', detail: detail ?? '' });
    r.work.forEach((x) => add('Work done', x.activity, x.qty, x.uom, `${x.pctOfPlan ?? '—'} % of the authorised; ${x.lines} lines${x.overWa ? `; ${x.overWa} over the WA` : ''}`, x.sites.join(', ')));
    r.labour.forEach((x) => add('Labour', `${x.categoryLabel}: ${x.trade}${x.contractor ? ` (${x.contractor})` : ''}`, x.manDays, 'man-days', `${x.otHours} OT hours${x.flagged ? `; ${x.flagged} flagged` : ''}`));
    r.materials.forEach((x) => add('Materials consumed', x.item, x.qty, x.uom)); r.equipment.forEach((x) => add('Equipment', x.label, x.hoursWorked, 'h worked', `idle ${x.hoursIdle} h, breakdown ${x.hoursBreakdown} h`));
    r.weather.forEach((x) => add('Weather', x.weather, x.days, 'days', `${x.rainMm} mm rain`)); r.notes.forEach((x) => add(x.typeLabel, x.text, null, '', `${x.date} ${x.docNo}`, x.site));
    r.days.forEach((x) => add('Reports', x.docNo, x.manDays, 'man-days', `${x.date}; ${x.supervisor}; ${x.workLines} work lines${x.late ? '; late' : ''}${x.flagged ? '; flagged' : ''}`, x.site));
    const columns = [{ key: 'section', label: 'Section', type: 'text' }, { key: 'site', label: 'Site', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'qty', label: 'Quantity', type: 'number' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }];
    const title = `${r.period.kind === 'DAY' ? 'Daily site report' : r.period.kind === 'WEEK' ? 'Weekly progress report' : r.period.kind === 'MONTH' ? 'Monthly progress report' : 'Progress report'} · ${r.period.label}`;
    const footer = [title, `${r.counts.dprs} approved reports on ${r.counts.siteDays} site days of ${r.counts.sites} sites; ${r.counts.late} sent late; ${r.counts.pendingApproval} still waiting for approval; ${r.totals.manDays} man-days.`, 'Figures are those of the approved daily progress reports.'];
    audit(actor, 'site_dprs', 0, 'export', actor.companyId, { newValues: { report: title, format: q.format, rows: rows.length } }); const name = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    if (q.format === 'csv') return { buffer: toCsv({ columns, rows, footer }), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: rows.length };
    if (q.format === 'pdf') return { buffer: toPdf({ columns, rows: rows.map((x) => ({ ...x, qty: String(x.qty) })), footer, title }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: rows.length };
    if (!['xlsx', undefined].includes(q.format)) throw badRequest('Choose xlsx, csv or pdf.');
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'Progress' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: rows.length };
  }
  return { siteDays, compliance, missing, report, reportExport, widget };
}
