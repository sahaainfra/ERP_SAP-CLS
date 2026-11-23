import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, forbidden, notFound } from '../../platform/http/errors.js';
import { objectTypes } from '../../platform/objects/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { collabOf } from '../eng/collab.js';
import { registerProject360Widget } from '../proj/p360.js';
import { siteOf } from '../site/index.js';
import { requireMetricCatalogueSource } from './domain-metrics.js';

/**
 * Part 27.08 — "Why?" variance explainability and drill-down navigation.
 *
 * Explanations are deterministic decompositions of a KPI's variance, labelled with their method (FR-03); each component drills to the records
 * behind it, and the components plus an explicit residual always equal the total (BR-01):
 *   cost      cost variance (earned − actual) of the 14.07 control facts, by resource: quantity (labour and plant: productivity) and rate, with the
 *             unbudgeted cost split out as scope / variation, and the idle and breakdown plant hours of approved DPRs × the budget plant rate
 *             split out of plant productivity as delay-related
 *   schedule  schedule variance (earned − planned) by activity contribution, from the 14.07 earned and planned drill
 *   margin    the bridge from the previous approved CVR margin (22.09) to the current one, line by line (value up, cost down)
 * The drill-down walks Company → Project → Site / WBS → Activity → BOQ → Transaction → Document → Audit with a breadcrumb; every level reads the
 * owner's service (control facts, trace links and timeline of 04.14) with the person's own rights, so nothing outside their scope is named.
 */

export const EXPLAIN_FLAG = 'ff.bi.p2708';
const rs = (p) => (p == null ? null : Math.round(Number(p)) / 100);
const r2 = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const services = new WeakMap();
export const explainOf = (db) => services.get(db) ?? null;
const RES = { MATERIAL: ['Material', 'quantity'], LABOUR: ['Labour', 'productivity'], EQUIPMENT: ['Plant', 'productivity'], SUBCONTRACT: ['Subcontract', 'quantity'], TRANSPORT: ['Transport', 'quantity'], OTHER: ['Other', 'quantity'] };

export function requireExplain(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, EXPLAIN_FLAG)) throw notFound('The variance explainer is unavailable.');
  requireMetricCatalogueSource(context, actor);
}

export function createExplain(context) {
  const { db } = context;
  const authz = authzOf(db);
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const control = () => siteOf(db)?.controlSvc ?? null;
  const guard = (actor) => { requireExplain(context, actor); assertPermissionAnywhere(actor, 'bi.explain.view'); };
  const may = (actor, key, projectId) => authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed;
  const projectOf = (actor, projectId) => {
    const p = db.prepare('SELECT id, code, name FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(projectId), actor.companyId);
    if (!p || !may(actor, 'bi.explain.view', p.id)) throw notFound('That project is not in your scope.');
    return p;
  };
  /** The owner's figures, read as the person (the project is already known to exist and be in scope): a refusal of the owner means the figures are hidden for this role. */
  const owner = (fn, what) => { try { return fn(); } catch (error) { if (error.status === 403 || error.status === 404) throw forbidden(`Your role does not see ${what} (the owning module refuses it).`); throw error; } };
  /** @returns {any} */
  const finish = (kpi, p, total, components, extra = {}) => {
    const sum = r2(components.reduce((n, c) => n + c.amount, 0));
    const residual = r2(total - sum);
    return { kpi, projectId: p.id, project: `${p.code} ${p.name}`, total: r2(total), components, residual, explained: r2(sum),
      check: { components: sum, residual, total: r2(total), balanced: r2(sum + residual) === r2(total) }, method: 'DETERMINISTIC', narrative: null, narrativeSource: 'AI narrative (28.02) is not available', asOf: todayIST(), ...extra };
  };

  // ---------------------------------------------------------------- FR-01: cost overrun decomposition
  function costWhy(actor, p, period) {
    const svc = control(); if (!svc) throw notFound('Project control (14.07) is not installed.');
    const v = owner(() => svc.variance(actor, { projectId: p.id, groupBy: 'RESOURCE', period }), 'project costs');
    const byRes = new Map(v.rows.map((r) => [r.id, r]));
    // unbudgeted cost (keys with no budget): its variance is the whole of its rate variance; it is scope / variation, not a rate effect
    const unbudgeted = new Map();
    for (const x of db.prepare(`SELECT resource_type AS r, SUM(earned_cost) - SUM(actual_cost) AS cv FROM ctl_facts WHERE org_project_id = ? AND deleted_at IS NULL ${period ? 'AND period_key = ?' : ''}
      GROUP BY wbs_id, cost_code_id, resource_type HAVING SUM(budget_cost) = 0`).all(p.id, ...(period ? [period] : []))) unbudgeted.set(x.r, r2((unbudgeted.get(x.r) ?? 0) + rs(x.cv)));
    // delay-related: idle and breakdown plant hours of approved DPRs × the budget plant rate (part of the plant productivity variance)
    const idleTh = has('site_dpr_equipment') ? db.prepare(`SELECT COALESCE(SUM(x.hours_idle + x.hours_breakdown), 0) AS h FROM site_dpr_equipment x JOIN site_dprs d ON d.id = x.dpr_id
      WHERE d.company_id = ? AND d.org_project_id = ? AND d.status = 'APPROVED' AND x.deleted_at IS NULL ${period ? 'AND substr(d.dpr_date, 1, 7) = ?' : ''}`).get(actor.companyId, p.id, ...(period ? [period] : [])).h : 0;
    const comps = [];
    let variation = 0; let delay = 0;
    for (const [key, [label, qtyWord]] of Object.entries(RES)) {
      const r = byRes.get(key); if (!r) continue;
      const unb = unbudgeted.get(key) ?? 0; variation += unb;
      let qty = r.quantityVariance ?? 0; const rate = r2((r.rateVariance ?? 0) - unb);
      if (key === 'EQUIPMENT' && r.budgetRate && idleTh) {
        delay = -r2((idleTh / 1000) * r.budgetRate);
        qty = r2(qty - delay);
      }
      const drill = `/bi/explain?tab=drill&level=resource&projectId=${p.id}&resource=${key}`;
      if (qty) comps.push({ key: `${key}_${qtyWord.toUpperCase()}`, group: label, label: `${label} ${qtyWord}`, amount: r2(qty), drill,
        method: `(earned quantity − actual quantity) × budget rate${key === 'EQUIPMENT' && delay ? ', less the delay-related part' : ''}` });
      if (rate) comps.push({ key: `${key}_RATE`, group: label, label: `${label} rate`, amount: rate, drill, method: '(budget rate − actual rate) × actual quantity, on budgeted work' });
    }
    if (variation) comps.push({ key: 'SCOPE_VARIATION', group: 'Scope', label: 'Scope / variations (unbudgeted cost)', amount: r2(variation), drill: `/bi/explain?tab=drill&level=project&id=${p.id}`, method: 'earned − actual on cost lines with no budget' });
    if (delay) comps.push({ key: 'DELAY', group: 'Plant', label: 'Delay-related (idle and breakdown plant)', amount: r2(delay), drill: `/site/dprs?projectId=${p.id}`, method: `${r2(idleTh / 1000)} idle and breakdown hours of approved DPRs × budget plant rate ₹${byRes.get('EQUIPMENT').budgetRate}` });
    comps.sort((a, b) => a.amount - b.amount);
    return finish('cost', p, v.totals.costVariance ?? 0, comps, {
      label: 'Cost variance (earned − actual)', sign: 'A negative amount is an overrun.', period: period ?? null,
      figures: { budget: v.totals.budget, earned: v.totals.earned, actual: v.totals.actual, planned: v.totals.planned }, source: { name: 'Project control facts (14.07)', route: `/site/control?projectId=${p.id}` } });
  }

  // ---------------------------------------------------------------- FR-01: schedule variance by activity
  function scheduleWhy(actor, p, period) {
    const svc = control(); if (!svc) throw notFound('Project control (14.07) is not installed.');
    const v = owner(() => svc.variance(actor, { projectId: p.id, groupBy: 'WBS', period }), 'project progress values');
    const ev = owner(() => svc.drill(actor, { projectId: p.id, measure: 'EARNED' }), 'earned value');
    const pv = owner(() => svc.drill(actor, { projectId: p.id, measure: 'PLANNED' }), 'planned value');
    const acts = new Map();
    for (const r of ev.rows) acts.set(r.id, { code: r.id, name: r.description, wbs: r.wbs, earned: r.amount ?? 0, planned: 0 });
    for (const r of pv.rows) { const a = acts.get(r.id) ?? { code: r.id, name: r.description, wbs: r.wbs, earned: 0, planned: 0 }; a.planned = r.amount ?? 0; acts.set(r.id, a); }
    const all = [...acts.values()].map((a) => ({ ...a, amount: r2(a.earned - a.planned) })).filter((a) => a.amount).sort((a, b) => a.amount - b.amount);
    const top = all.slice(0, 10); const rest = all.slice(10);
    const comps = top.map((a) => ({ key: `ACT_${a.code}`, group: a.wbs ?? 'Activity', label: `${a.code} ${a.name}`, amount: a.amount, drill: `/bi/explain?tab=drill&level=project&id=${p.id}`, method: 'earned − planned value of the activity' }));
    if (rest.length) comps.push({ key: 'ACT_OTHER', group: 'Activity', label: `${rest.length} other activities`, amount: r2(rest.reduce((n, a) => n + a.amount, 0)), drill: `/bi/explain?tab=drill&level=project&id=${p.id}`, method: 'earned − planned value, summed' });
    return finish('schedule', p, v.totals.scheduleVariance ?? 0, comps, { label: 'Schedule variance (earned − planned)', sign: 'A negative amount is behind plan.', period: period ?? null,
      figures: { earned: v.totals.earned, planned: v.totals.planned }, residualNote: 'Value in control facts not tied to a scheduled activity', source: { name: 'Project control facts and progress (14.05, 14.07)', route: `/site/control?projectId=${p.id}` } });
  }

  // ---------------------------------------------------------------- FR-01: margin bridge between two approved CVRs
  function marginWhy(actor, p, period) {
    if (!has('bill_cvr_reports')) throw notFound('The cost-value reconciliation (22.09) is not installed.');
    if (!may(actor, 'bill.report.view', p.id)) throw forbidden('Your role does not see the cost-value reconciliation (bill.report.view).');
    const cur = db.prepare(`SELECT * FROM bill_cvr_reports WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ${period ? 'AND period <= ?' : ''} ORDER BY period DESC, id DESC LIMIT 1`).get(actor.companyId, p.id, ...(period ? [period] : []));
    if (!cur) return finish('margin', p, 0, [], { label: 'Margin change', empty: 'No approved cost-value reconciliation for this project yet.' });
    const prev = db.prepare("SELECT * FROM bill_cvr_reports WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND period < ? ORDER BY period DESC, id DESC LIMIT 1").get(actor.companyId, p.id, cur.period);
    const lines = (r, col) => new Map((r ? JSON.parse(r[col] || '[]') : []).map((l) => [l.key, l]));
    const comps = [];
    /** @type {Array<[string, number, string]>} */
    const sides = [['value_lines_json', 1, 'Value'], ['expense_lines_json', -1, 'Cost']];
    for (const [col, sign, side] of sides) {
      const a = lines(cur, col); const b = lines(prev, col);
      for (const k of new Set([...a.keys(), ...b.keys()])) {
        const d = (Number(a.get(k)?.amount ?? 0) - Number(b.get(k)?.amount ?? 0)) * sign;
        if (d) comps.push({ key: `${side.toUpperCase()}_${k}`, group: side, label: `${side}: ${a.get(k)?.label ?? b.get(k)?.label ?? k}`, amount: rs(d), drill: a.get(k)?.drill ?? `/bill/cvr?id=${cur.id}`,
          method: sign > 0 ? 'change in this value line (adds to margin)' : 'change in this cost line (reduces margin)' });
      }
    }
    comps.sort((x, y) => x.amount - y.amount);
    return finish('margin', p, rs(cur.margin_paise - (prev?.margin_paise ?? 0)), comps, { label: `Margin change ${prev ? `${prev.period} → ${cur.period}` : `to ${cur.period}`}`, sign: 'A negative amount reduces the margin.',
      period: cur.period, figures: { margin: rs(cur.margin_paise), previousMargin: prev ? rs(prev.margin_paise) : null, marginPct: cur.margin_bp == null ? null : cur.margin_bp / 100, budgetMarginPct: cur.budget_margin_bp == null ? null : cur.budget_margin_bp / 100 },
      source: { name: `CVR ${cur.doc_no}${prev ? ` against ${prev.doc_no}` : ''} (22.09)`, route: `/bill/cvr?id=${cur.id}` } });
  }

  /** @returns {any} */
  function why(actor, { projectId, kpi = 'cost', period = null }) {
    guard(actor);
    const p = projectOf(actor, projectId);
    const out = kpi === 'schedule' ? scheduleWhy(actor, p, period) : kpi === 'margin' ? marginWhy(actor, p, period) : costWhy(actor, p, period);
    return { ...out, breadcrumb: crumbs(actor, 'project', p.id) };
  }

  function exportWhy(actor, q, format) {
    guard(actor); assertPermissionAnywhere(actor, 'bi.explain.export');
    const w = why(actor, q);
    const rows = [...w.components.map((c) => ({ group: c.group, label: c.label, amount: c.amount, method: c.method })), { group: '', label: 'Residual (not explained)', amount: w.residual, method: 'total − sum of components' },
      { group: '', label: 'Total', amount: w.total, method: w.label }];
    const buffer = writeExport(format, { columns: [{ key: 'group', label: 'Group', type: 'text' }, { key: 'label', label: 'Component', type: 'text' }, { key: 'amount', label: 'Amount (₹)', type: 'number' }, { key: 'method', label: 'Method', type: 'text' }],
      rows, title: `Why? ${w.label} — ${w.project}`, sheetName: 'Variance', footer: [`Deterministic decomposition · ${w.source?.name ?? ''} · as of ${w.asOf}`, w.sign ?? ''] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'bi.explain', action: 'export', newValues: { format, projectId: w.projectId, kpi: w.kpi }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `why-${w.kpi}-${w.project.split(' ')[0]}.${format}` };
  }

  // ---------------------------------------------------------------- FR-02: the drill-down with its breadcrumb
  const node = (level, id, label, extra = {}) => ({ level, id: id == null ? null : String(id), label, ...extra });
  function crumbs(actor, level, id, ctx = {}) {
    const out = [node('company', null, db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(actor.companyId)?.legal_name ?? 'Company')];
    const proj = (pid) => { const p = db.prepare('SELECT id, code FROM org_projects WHERE id = ?').get(pid); if (p) out.push(node('project', p.id, p.code)); };
    const wbsChain = (wid) => { const chain = []; let w = db.prepare('SELECT id, code, name, parent_id, project_id FROM proj_wbs WHERE id = ?').get(wid); while (w) { chain.unshift(node('wbs', w.id, `${w.code} ${w.name}`)); w = w.parent_id ? db.prepare('SELECT id, code, name, parent_id, project_id FROM proj_wbs WHERE id = ?').get(w.parent_id) : null; } return chain; };
    const projectOfWbs = (wid) => db.prepare('SELECT project_id AS id FROM proj_wbs WHERE id = ?').get(wid)?.id ?? null;
    if (level === 'project') proj(id);
    if (level === 'site') { const s = db.prepare('SELECT id, code, org_project_id FROM org_sites WHERE id = ?').get(id); if (s) { proj(s.org_project_id); out.push(node('site', s.id, s.code)); } }
    if (level === 'resource') { proj(ctx.projectId); out.push(node('resource', id, RES[id]?.[0] ?? id, { projectId: ctx.projectId })); }
    if (level === 'wbs') { proj(ctx.projectId ?? projectOfWbs(id)); out.push(...wbsChain(id)); }
    if (level === 'activity') { const a = db.prepare('SELECT a.id, a.code, a.wbs_id, s.org_project_id FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE a.id = ?').get(id); if (a) { proj(a.org_project_id); if (a.wbs_id) out.push(...wbsChain(a.wbs_id)); out.push(node('activity', a.id, a.code)); } }
    if (level === 'boq') { const b = db.prepare('SELECT l.id, l.item_code, v.org_project_id FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.id = ?').get(id); if (b) { proj(b.org_project_id); out.push(node('boq', b.id, `BOQ ${b.item_code}`)); } }
    if (level === 'txn' || level === 'document' || level === 'audit') {
      const t = ctx.txnId ? db.prepare('SELECT id, org_project_id, wbs_id, src_type, src_id, doc_ref FROM bud_actuals WHERE id = ?').get(ctx.txnId) : null;
      if (t) { proj(t.org_project_id); if (t.wbs_id) out.push(...wbsChain(t.wbs_id)); out.push(node('txn', t.id, t.doc_ref ?? `${t.src_type} ${t.src_id}`)); }
      if (level !== 'txn' && ctx.entity) out.push(node('document', ctx.entityId, `${objectTypes.get(ctx.entity)?.label ?? ctx.entity} ${ctx.entityId}`, { entity: ctx.entity }));
      if (level === 'audit') out.push(node('audit', ctx.entityId, 'Audit trail', { entity: ctx.entity }));
    }
    return out;
  }
  const wbsProject = (wid, companyId) => db.prepare('SELECT project_id AS id FROM proj_wbs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(wid, companyId)?.id ?? null;
  const factsBy = (projectId, col, value) => db.prepare(`SELECT COALESCE(SUM(budget_cost), 0) AS b, COALESCE(SUM(earned_cost), 0) AS e, COALESCE(SUM(actual_cost), 0) AS a FROM ctl_facts
    WHERE org_project_id = ? AND deleted_at IS NULL ${col ? `AND ${col} = ?` : ''}`).get(projectId, ...(col ? [value] : []));
  const money = (actor, pid, f) => (may(actor, 'site.control.view', pid) ? { budget: rs(f.b), earned: rs(f.e), actual: rs(f.a), costVariance: rs(f.e - f.a) } : { masked: true });

  function drill(actor, q) {
    guard(actor);
    const level = q.level ?? 'company';
    const children = [];
    let title;
    if (level === 'company') {
      title = 'Projects';
      const scope = authz.scopeFilter(actor, 'bi.explain.view', { project: 'p.id' }).sql;
      for (const p of db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = ? AND p.deleted_at IS NULL AND p.status IN ('ACTIVE','ON_HOLD') AND (${scope}) ORDER BY p.code`).all(actor.companyId)) {
        children.push(node('project', p.id, `${p.code} ${p.name}`, { figures: money(actor, p.id, factsBy(p.id)), why: `/bi/explain?projectId=${p.id}&kpi=cost` }));
      }
    } else if (level === 'project') {
      const p = projectOf(actor, q.id); title = `${p.code} ${p.name}`;
      for (const s of db.prepare("SELECT id, code, name FROM org_sites WHERE company_id = ? AND org_project_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code").all(actor.companyId, p.id)) {
        if (authz.check(actor, 'bi.explain.view', { companyId: actor.companyId, projectId: p.id, siteId: s.id }).allowed) children.push(node('site', s.id, `${s.code} ${s.name}`, { kind: 'Site' }));
      }
      for (const w of db.prepare(`SELECT w.id, w.code, w.name FROM proj_wbs w WHERE w.project_id = ? AND w.parent_id IS NULL AND w.deleted_at IS NULL ORDER BY w.code`).all(p.id)) {
        children.push(node('wbs', w.id, `${w.code} ${w.name}`, { kind: 'WBS', figures: money(actor, p.id, factsBy(p.id, 'wbs_id', w.id)) }));
      }
      for (const [k, [label]] of Object.entries(RES)) {
        const f = factsBy(p.id, 'resource_type', k);
        if (f.a || f.b) children.push(node('resource', k, label, { kind: 'Resource', projectId: p.id, figures: money(actor, p.id, f) }));
      }
    } else if (level === 'site') {
      const s = db.prepare('SELECT id, code, name, org_project_id FROM org_sites WHERE id = ? AND company_id = ?').get(Number(q.id), actor.companyId);
      if (!s || !authz.check(actor, 'bi.explain.view', { companyId: actor.companyId, projectId: s.org_project_id, siteId: s.id }).allowed) throw notFound('That site is not in your scope.');
      title = `${s.code} ${s.name}`;
      for (const a of db.prepare(`SELECT a.id, a.code, a.name, SUM(w.qty) AS qty FROM site_dpr_work w JOIN site_dprs d ON d.id = w.dpr_id JOIN plan_activities a ON a.id = w.activity_id
        WHERE d.company_id = ? AND d.dpr_site_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND w.deleted_at IS NULL GROUP BY a.id ORDER BY a.code LIMIT 200`).all(actor.companyId, s.id)) {
        children.push(node('activity', a.id, `${a.code} ${a.name}`, { kind: 'Activity', detail: `${a.qty / 1000} executed in approved DPRs` }));
      }
    } else if (level === 'resource' || level === 'wbs') {
      const projectId = level === 'wbs' ? wbsProject(Number(q.id), actor.companyId) : Number(q.projectId);
      const p = projectOf(actor, projectId); title = level === 'wbs' ? (db.prepare('SELECT code, name FROM proj_wbs WHERE id = ?').get(Number(q.id)) ?? {}).code : RES[q.id]?.[0] ?? q.id;
      if (level === 'wbs') {
        for (const w of db.prepare('SELECT id, code, name FROM proj_wbs WHERE parent_id = ? AND deleted_at IS NULL ORDER BY code').all(Number(q.id))) children.push(node('wbs', w.id, `${w.code} ${w.name}`, { kind: 'WBS', figures: money(actor, p.id, factsBy(p.id, 'wbs_id', w.id)) }));
        for (const a of db.prepare('SELECT a.id, a.code, a.name FROM plan_activities a WHERE a.wbs_id = ? AND a.deleted_at IS NULL ORDER BY a.code LIMIT 200').all(Number(q.id))) children.push(node('activity', a.id, `${a.code} ${a.name}`, { kind: 'Activity' }));
      }
      const svc = control();
      if (svc && may(actor, 'site.control.view', p.id)) {
        const d = svc.drill(actor, { projectId: p.id, measure: 'ACTUAL', ...(level === 'wbs' ? { wbsId: Number(q.id) } : { resourceType: q.id }) });
        for (const r of d.rows.slice(0, 100)) children.push(node('txn', r.id, `${r.docRef} · ${r.description ?? ''}`.trim(), { kind: 'Transaction', figures: { amount: r.amount, qty: r.qty }, date: r.date, detail: `${r.resource ?? ''} ${r.costCode ?? ''}`.trim() }));
      }
    } else if (level === 'activity') {
      const a = db.prepare('SELECT a.id, a.code, a.name, s.org_project_id AS pid FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE a.id = ? AND s.company_id = ?').get(Number(q.id), actor.companyId);
      if (!a) throw notFound('That activity does not exist.'); projectOf(actor, a.pid); title = `${a.code} ${a.name}`;
      for (const b of db.prepare('SELECT l.id, l.item_code, l.description, l.uom, x.qty FROM plan_activity_boq x JOIN proj_boq_lines l ON l.id = x.boq_line_id WHERE x.activity_id = ? AND x.deleted_at IS NULL ORDER BY l.item_code').all(a.id)) {
        children.push(node('boq', b.id, `${b.item_code} ${b.description}`, { kind: 'BOQ item', detail: `${b.qty / 1000} ${b.uom ?? ''} on this activity` }));
      }
      for (const w of db.prepare("SELECT d.id, d.doc_no, d.dpr_date, w.qty FROM site_dpr_work w JOIN site_dprs d ON d.id = w.dpr_id WHERE w.activity_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY d.dpr_date DESC LIMIT 50").all(a.id)) {
        children.push(node('document', w.id, `${w.doc_no} · ${w.dpr_date}`, { kind: 'DPR', entity: 'site_dpr', detail: `${w.qty / 1000} executed`, route: `/site/dprs?id=${w.id}` }));
      }
    } else if (level === 'boq') {
      const b = db.prepare('SELECT l.id, l.item_code, l.description, v.org_project_id AS pid FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.id = ? AND v.company_id = ?').get(Number(q.id), actor.companyId);
      if (!b) throw notFound('That BOQ item does not exist.'); projectOf(actor, b.pid); title = `${b.item_code} ${b.description}`;
      if (has('bill_mb_entries')) for (const m of db.prepare('SELECT id, doc_no, measured_on, qty_th, status FROM bill_mb_entries WHERE boq_line_id = ? AND deleted_at IS NULL ORDER BY measured_on DESC LIMIT 100').all(b.id)) {
        children.push(node('document', m.id, `${m.doc_no} · ${m.measured_on}`, { kind: 'Measurement', entity: 'bill_mb_entries', detail: `${m.qty_th / 1000} measured · ${m.status}`, route: `/bill/mb?id=${m.id}` }));
      }
    } else if (level === 'txn') {
      const t = db.prepare('SELECT * FROM bud_actuals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(q.id), actor.companyId);
      if (!t) throw notFound('That transaction does not exist.'); projectOf(actor, t.org_project_id);
      if (!may(actor, 'site.control.view', t.org_project_id)) throw forbidden('Your role does not see project costs.');
      title = t.doc_ref ?? `${t.src_type} ${t.src_id}`;
      const entity = entityOf(t.src_type);
      const collab = collabOf(db);
      const doc = entity && collab ? safe(() => collab.describe(actor, entity, t.src_id)) : null;
      children.push(node('document', t.src_id, doc?.label ?? `${t.src_type} ${t.src_id}`, { kind: doc?.typeLabel ?? 'Source document', entity, route: doc?.route ?? null, restricted: Boolean(entity && collab && !doc) }));
      if (entity && collab && doc) {
        const g = safe(() => collab.trace.graph(actor, { entity, id: t.src_id, depth: 2 }));
        for (const n of [...(g?.upstream ?? []), ...(g?.downstream ?? [])]) children.push(node('document', n.id, n.restricted ? 'Restricted record' : n.label, { kind: `${n.typeLabel} (${n.relation})`, entity: n.type, route: n.route, restricted: n.restricted }));
      }
      return { level, id: String(t.id), title, breadcrumb: crumbs(actor, 'txn', t.id, { txnId: t.id }), children, figures: { amount: rs(t.amount), qty: t.qty / 1000, date: t.actual_date } };
    } else if (level === 'document' || level === 'audit') {
      if (!q.entity) throw badRequest('Give the entity of the document.', [{ field: 'entity', message: 'is required' }]);
      const collab = collabOf(db); if (!collab) throw notFound('The timeline service is unavailable.');
      const doc = safe(() => collab.describe(actor, q.entity, q.id));
      if (!doc) throw notFound('That record does not exist or is outside your scope.');
      title = doc.label;
      if (level === 'document') {
        const g = safe(() => collab.trace.graph(actor, { entity: q.entity, id: q.id, depth: 2 }));
        for (const n of [...(g?.upstream ?? []), ...(g?.downstream ?? [])]) children.push(node('document', n.id, n.restricted ? 'Restricted record' : n.label, { kind: `${n.typeLabel} (${n.relation})`, entity: n.type, route: n.route, restricted: n.restricted }));
        children.push(node('audit', q.id, 'Audit trail', { kind: 'Audit', entity: q.entity }));
      } else {
        const tl = safe(() => collab.timeline.record(actor, { entity: q.entity, id: q.id, limit: 50 }));
        for (const e of tl?.rows ?? []) children.push(node('event', e.key ?? null, `${e.action ?? e.kind}${e.summary ? `: ${e.summary}` : ''}`, { kind: e.kind, at: e.at, actor: e.actorName ?? e.actor, detail: e.reason ?? null }));
      }
      return { level, id: String(q.id), title, route: doc.route, breadcrumb: crumbs(actor, level, q.id, { txnId: q.txnId ? Number(q.txnId) : null, entity: q.entity, entityId: q.id }), children };
    } else throw badRequest('Unknown drill level.', [{ field: 'level', message: 'is not a drill level' }]);
    return { level, id: q.id == null ? null : String(q.id), title, breadcrumb: crumbs(actor, level, level === 'company' ? null : (level === 'resource' ? q.id : Number(q.id)), { projectId: q.projectId ? Number(q.projectId) : null }), children };
  }
  const safe = (fn) => { try { return fn(); } catch (error) { if ([403, 404].includes(error.status)) return null; throw error; } };
  /** The object type of a cost source (04.14 / 03.04 registry), when it has one. */
  function entityOf(srcType) {
    const map = { GRN: 'inv_grn', GRN_DIRECT: 'inv_grn', GRN_STOCK: 'inv_grn', 'inv.grn': 'inv_grn', inv_grns: 'inv_grn', ISSUE: 'inv_issue', 'inv.issue': 'inv_issue', inv_issues: 'inv_issue',
      AP_BILL: 'ap_bills', 'ap.bill': 'ap_bills', SUB_BILL: 'bill_sub_bills', PLANT_LOG: 'plt_log', 'plant.cost': 'plt_log', plt_logs: 'plt_log', JOURNAL: 'fin_journals' };
    const e = map[srcType] ?? String(srcType).toLowerCase();
    return objectTypes.get(e) ? e : null;
  }

  const service = { why, exportWhy, drill };
  services.set(db, service);
  return service;
}

/** Project 360 (10.08) and the dashboard: the cost variance of the project and its largest component, with the "Why?" link. */
const contexts = new WeakMap();
export const bindExplain = (db, context) => contexts.set(db, context);
const ok = (db, actor) => { const c = contexts.get(db); if (!c || !explainOf(db) || !hasPermissionAnywhere(actor, 'bi.explain.view')) return false; try { requireExplain(c, actor); return true; } catch (e) { if (e.status === 404) return false; throw e; } };
registerProject360Widget('bi.why_cost', ({ db, actor, project }) => {
  if (!ok(db, actor)) return null;
  try {
    const w = explainOf(db).why(actor, { projectId: project.project_id, kpi: 'cost' });
    const worst = w.components[0];
    return { figures: [{ key: 'costVariance', label: 'Cost variance (₹)', value: w.total, drill: `/bi/explain?projectId=${project.project_id}&kpi=cost` },
      ...(worst ? [{ key: 'largest', label: `Largest: ${worst.label} (₹)`, value: worst.amount, drill: worst.drill }] : [])], note: 'Why? deterministic decomposition' };
  } catch (e) { if ([403, 404].includes(e.status)) return null; throw e; }
});
widgetRegistry.register({
  code: 'bi.why_cost',
  available: ok,
  provider({ db, actor, filters }) {
    if (!filters.projectId) return { empty: true, emptyTitle: 'Select a project', emptyText: 'The cost variance is explained for one project at a time.' };
    const w = explainOf(db).why(actor, { projectId: filters.projectId, kpi: 'cost' });
    return { label: 'Cost variance', value: w.total, kind: 'money', currency: 'INR', subtitle: w.components[0] ? `Largest: ${w.components[0].label}` : 'No variance', drill: `/bi/explain?projectId=${filters.projectId}&kpi=cost` };
  },
});
