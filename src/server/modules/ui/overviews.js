import { roleLayouts, widgetRegistry } from '../../platform/widgets/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { billOf } from '../bill/index.js';
import { invOf } from '../inv/index.js';
import { hseOf } from '../hse/index.js';
import { qaOf } from '../qa/index.js';
import { procOf } from '../proc/index.js';
import { plantOf } from '../plant/index.js';
import { employeesOf } from '../hr/employees.js';
import { budOf } from '../bud/budgets.js';
import { notificationCentreOf } from '../eng/notifications.js';
import { punchesOf } from '../hr/punches.js';
import { labourOf } from '../hr/labour.js';
import { leaveOf } from '../hr/leave.js';
import { registerOf } from '../hr/att-register.js';
import { trainingOf } from '../hr/training.js';
import EN from '../../../shared/i18n/locales/en.js';

// Part 166.5: the overview pages. Each module dashboard of parts 01–166 is drawn as cards on the dashboard framework of 03.07 (a dashboard code,
// widgets in `ui_widgets`, a provider here per widget). A card never computes a figure of its own: its provider calls the service the old page
// calls, with the same filters, and returns a slice of that answer (T-01), named in `source` on the card. "View all ›" opens the list behind it.
// The rows of `ui_widgets` and `ui_dashboards` come from `migrations/…_ui_p16605.up.sql`, written from OVERVIEWS by scripts/overview_seed.mjs.

const MEMO_MS = 5000;
const memo = new Map();
/** The service's answer for this person and these filters, read once for all the cards of a page that load together. */
function once(key, fn) {
  const now = Date.now();
  for (const [k, v] of memo) if (v.at < now - MEMO_MS) memo.delete(k);
  const hit = memo.get(key);
  if (hit) { if (hit.error) throw hit.error; return hit.value; }
  try { const value = fn(); memo.set(key, { at: now, value }); return value; } catch (error) { memo.set(key, { at: now, error }); throw error; }
}
// total_changes() moves with every write on the database: a card read after an approval (from the to-do card) never gets the figures from before it
const writes = (db) => db.prepare('SELECT total_changes() AS n').get().n;
const keyOf = (dash, ctx) => `${dash}|${writes(ctx.db)}|${ctx.actor.companyId}|${ctx.actor.user}|${(ctx.actor.roles ?? []).join(',')}|${JSON.stringify(ctx.filters ?? {})}`;
const pid = (ctx) => ctx.filters?.projectId ?? undefined;
const period = (ctx) => (ctx.filters?.from && ctx.filters?.to ? { from: ctx.filters.from, to: ctx.filters.to } : {});
const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const withQuery = (route, q) => {
  if (!route) return null;
  const [path, search = ''] = String(route).split('?');
  const p = new URLSearchParams(search);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return `${path}${s ? `?${s}` : ''}`;
};
/**
 * A KPI card's data in the framework's shape.
 * @typedef {{ unit?: string, kind?: string, subtitle?: string, target?: any, status?: string, note?: any, drill?: any, previous?: any, trendPct?: any, source?: string, masked?: boolean }} KpiOptions
 * @param {any} value
 * @param {KpiOptions} [options]
 */
// a value the service could not measure (a rate without man-hours) stays null: the card shows —, never a 0 that is not a figure
const kpi = (value, { unit = '', kind = undefined, subtitle = undefined, target = null, status = 'neutral', note = null, drill = null, previous = null, trendPct = null, source = undefined, masked = false } = {}) => ({ value: num(value), unit, kind, subtitle, target: num(target), status, note, drill, previous, trendPct, source, masked });
const TONE = { good: 'green', ok: 'green', green: 'green', bad: 'red', red: 'red', warn: 'amber', amber: 'amber', attention: 'amber', neutral: 'neutral' };
const tone = (s) => TONE[String(s ?? '').toLowerCase()] ?? 'neutral';

/** The person's approvals and tasks waiting for a decision (the to-do card), from the workflow engine (04.01). */
/** Every open task of the person (up to 50), with its document type (the HR card keeps those of HR). */
function openTasks(ctx) {
  const list = workflowOf(ctx.db).listTasks(ctx.actor, { mine: 'assigned', limit: 50 });
  return {
    rows: list.rows.map((t) => ({
      taskId: t.id, docType: t.instance.docType, title: `${t.instance.docLabel}${t.instance.docRef ? ` ${t.instance.docRef}` : ''}${t.instance.title ? `: ${t.instance.title}` : ''}`,
      facts: [`Raised by ${t.instance.submittedBy}`, t.dueAt ? `due ${String(t.dueAt).slice(0, 10)}` : null, t.overdue ? 'past its time' : null].filter(Boolean),
      drill: t.instance.route ?? '/admin/approvals',
    })),
    total: list.total,
  };
}
/**
 * The to-do card: the first 8 of the person's open tasks, with the total.
 * @param {any} ctx @param {(row: any) => boolean} [keep]
 */
function todo(ctx, keep = TRUE) {
  const all = openTasks(ctx);
  const rows = all.rows.filter((r) => keep(r));
  return { rows: rows.slice(0, 8), total: keep === TRUE ? all.total : rows.length, drill: '/approvals', source: 'My open approvals and tasks' };
}
/** @type {(row: any) => boolean} */
const TRUE = () => true;

/** The latest notifications of the person with their time (the feed card), from the notification centre (04.06). */
function feed(ctx) {
  const centre = notificationCentreOf(ctx.db)?.centre;
  if (!centre) return { rows: [], total: 0, drill: '/notifications', source: 'Notification centre' };
  const list = centre.list(ctx.actor, { state: 'inbox', limit: 8 });
  const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  return { rows: list.rows.map((n) => ({ id: n.id, title: n.title, subtitle: `${when(n.at)}${n.read ? '' : ' · new'}`, drill: n.link ?? '/notifications' })), total: list.total, drill: '/notifications', source: 'Notification centre' };
}

/**
 * The overview pages. `read(ctx)` is the old page's service call; each card maps its answer. `w`/`h` are the card's default size on the
 * 12-column grid (S 3, M 6, L 8, XL 12). `drill` is the list behind the card ("View all ›").
 */
export const OVERVIEWS = [
  {
    code: 'ov-qs', name: 'QS Management Dashboard', route: '/bill/qs-dashboard', permission: 'bill.qs_dashboard.view', module: 'bill', part: '22.08',
    source: 'QS dashboard (billing)',
    read: (ctx) => once(keyOf('ov-qs', ctx), () => billOf(ctx.db).svc.qs.dashboard(ctx.actor, { projectId: pid(ctx) })),
    cards: [
      { code: 'ov.qs.unbilled_wip', title: 'Unbilled work (WIP)', type: 'kpi', w: 3, h: 1, drill: '/bill/qty-recon', map: (d) => qsKpi(d, 'unbilledWip') },
      { code: 'ov.qs.certified_not_billed', title: 'Certified, not billed', type: 'kpi', w: 3, h: 1, drill: '/bill/client-bill-new', map: (d) => qsKpi(d, 'certifiedNotBilled') },
      { code: 'ov.qs.billed_not_collected', title: 'Billed, not collected', type: 'kpi', w: 3, h: 1, drill: '/bill/client-bills?filter[status]=APPROVED', map: (d) => qsKpi(d, 'billedNotCollected') },
      { code: 'ov.qs.margin', title: 'Back-to-back margin', type: 'kpi', w: 3, h: 1, drill: '/bill/cert-analysis', map: (d) => (d.backToBack.masked ? { ...kpi(0, { source: 'QS dashboard (billing)' }), masked: true } : kpi(d.backToBack.margin, { kind: 'money', subtitle: `₹ · certified less subcontract billed${d.backToBack.marginPct === null ? '' : ` · ${d.backToBack.marginPct}%`}`, status: d.backToBack.margin < 0 ? 'red' : 'green', drill: '/bill/cert-analysis' })) },
      { code: 'ov.qs.chain', title: 'From work done to money received', type: 'bar', w: 6, h: 2, drill: '/bill/qty-recon', map: (d) => { const ks = ['workNotMeasured', 'measuredNotCertified', 'certifiedNotBilled', 'billedNotCollected']; const k = ks.map((x) => d.kpis.find((y) => y.key === x)); return { categories: k.map((x) => x.label), series: [{ name: '₹', values: k.map((x) => x.value), drill: k.map((x) => x.drill) }], unit: '₹' }; } },
      { code: 'ov.qs.top_unbilled', title: 'Top projects by unbilled work', type: 'topn', w: 6, h: 2, drill: '/bill/qty-recon', map: (d) => ({ kind: 'money', rows: [...d.portfolio].sort((a, b) => (b.unbilledWip ?? 0) - (a.unbilledWip ?? 0)).filter((p) => p.unbilledWip).slice(0, 5).map((p) => ({ id: p.projectId, label: `${p.project} ${p.name}`, value: p.unbilledWip, drill: `/bill/qty-recon?projectId=${p.projectId}` })), emptyTitle: 'No unbilled work', emptyText: 'Projects with executed work not yet billed appear here.' }) },
      { code: 'ov.qs.queues', title: 'Work queues of the QS', type: 'list', w: 6, h: 2, drill: '/bill/qs-dashboard', map: (d) => { const rows = Object.entries(d.queues).map(([k, q]) => ({ id: k, title: q.label, subtitle: `${q.count} waiting${q.late ? `, ${q.late} late` : ''}`, drill: q.rows[0]?.link ?? null })); return { rows: rows.filter((r) => r.subtitle !== '0 waiting'), total: rows.length, drill: null }; } },
      { code: 'ov.qs.leakage', title: 'Value leakage', type: 'bar', w: 6, h: 2, drill: '/bill/cert-analysis', map: (d) => ({ categories: d.leakage.map((x) => x.label), series: [{ name: 'Value', values: d.leakage.map((x) => x.value ?? 0), drill: d.leakage.map((x) => x.drill) }] }) },
    ],
  },
  {
    code: 'ov-tower', name: 'Contract Control Tower', route: '/bill/control-tower', permission: 'bill.control_tower.view', module: 'bill', part: '22.09',
    source: 'Contract control tower (billing)',
    read: (ctx) => once(keyOf('ov-tower', ctx), () => billOf(ctx.db).svc.tower.view(ctx.actor, { projectId: pid(ctx) })),
    cards: [
      { code: 'ov.tower.value', title: 'Contract value', type: 'kpi', w: 3, h: 1, drill: '/ctr/contracts', map: (d) => kpi(d.totals.value, { kind: 'money', subtitle: `₹ · ${d.totals.contracts} contract${d.totals.contracts === 1 ? '' : 's'}`, drill: '/ctr/contracts' }) },
      { code: 'ov.tower.billed', title: 'Billed to date', type: 'kpi', w: 3, h: 1, drill: '/bill/client-bills', map: (d) => kpi(d.totals.billed, { kind: 'money', subtitle: '₹ · approved client bills', drill: '/bill/client-bills' }) },
      { code: 'ov.tower.outstanding', title: 'Outstanding from the client', type: 'kpi', w: 3, h: 1, drill: '/bill/client-bills?filter[status]=APPROVED', map: (d) => kpi(d.totals.outstanding, { kind: 'money', subtitle: '₹ · billed less collected', status: d.totals.outstanding > 0 ? 'amber' : 'green', drill: '/bill/client-bills?filter[status]=APPROVED' }) },
      { code: 'ov.tower.margin', title: 'Margin', type: 'kpi', w: 3, h: 1, drill: '/bill/cvr', map: (d) => (d.totals.marginMasked ? { ...kpi(0), masked: true } : kpi(d.totals.margin, { kind: 'money', subtitle: '₹ · latest cost-value reconciliation', status: (d.totals.margin ?? 0) < 0 ? 'red' : 'green', drill: '/bill/cvr' })) },
      { code: 'ov.tower.position', title: 'Collected and outstanding by contract', type: 'stacked', w: 8, h: 2, drill: '/ctr/contracts', map: (d) => ({ categories: d.rows.map((r) => r.contractNo ?? r.project), series: [{ name: 'Collected', values: d.rows.map((r) => r.collected ?? 0) }, { name: 'Outstanding', values: d.rows.map((r) => r.outstanding ?? 0) }] }) },
      { code: 'ov.tower.exceptions', title: 'Contracts needing attention', type: 'topn', w: 4, h: 2, drill: '/bill/control-tower', map: (d) => ({ kind: 'count', rows: d.exceptions.filter((x) => x.count > 0).map((x) => ({ id: x.key, label: TOWER_FLAG[x.key] ?? x.key, sub: x.contracts.map((c) => c.contractNo).join(', '), value: x.count, drill: `/bill/control-tower?flag=${x.key}` })), emptyTitle: 'No contract needs attention', emptyText: 'Contracts at a loss, with a falling margin, without a CVR or at high risk appear here.' }) },
    ],
  },
  {
    code: 'ov-stores', name: 'Stores Dashboard', route: '/inv/dashboard', permission: 'inv.stock.view', module: 'inv', part: '16.01',
    source: 'Stores dashboard (inventory)',
    read: (ctx) => once(keyOf('ov-stores', ctx), () => invOf(ctx.db).invSvc.dashboard(ctx.actor, { projectId: pid(ctx) })),
    cards: [
      { code: 'ov.stores.value', title: 'Stock value', type: 'kpi', w: 3, h: 1, drill: '/inv/valuation', map: (d) => (d.canValues ? kpi(d.tiles.totalValue, { kind: 'money', subtitle: `₹ · ${d.tiles.stores} store${d.tiles.stores === 1 ? '' : 's'}`, drill: '/inv/valuation' }) : { ...kpi(0), masked: true }) },
      { code: 'ov.stores.below_reorder', title: 'Items below their reorder level', type: 'kpi', w: 3, h: 1, drill: '/inv/balances', map: (d) => kpi(d.tiles.belowReorder, { unit: d.tiles.belowReorder === 1 ? 'item' : 'items', subtitle: 'items · now', status: d.tiles.belowReorder ? 'red' : 'green', drill: '/inv/balances' }) },
      { code: 'ov.stores.pending', title: 'Waiting for approval', type: 'kpi', w: 3, h: 1, drill: '/inv/adjustments', map: (d) => kpi(d.tiles.pendingApprovals, { unit: 'waiting', subtitle: 'documents · now', status: d.tiles.pendingApprovals ? 'amber' : 'green', drill: '/inv/adjustments' }) },
      { code: 'ov.stores.reserved', title: 'Reserved lines', type: 'kpi', w: 3, h: 1, drill: '/inv/balances', map: (d) => kpi(d.tiles.reservedLines, { unit: 'lines', subtitle: 'lines · now', drill: '/inv/balances' }) },
      { code: 'ov.stores.by_store', title: 'Stock value by store', type: 'topn', w: 6, h: 2, drill: '/inv/balances', map: (d) => (d.canValues ? { kind: 'money', rows: d.byStore.slice().sort((a, b) => b.value - a.value).slice(0, 8).map((s) => ({ id: s.id, label: `${s.code} ${s.name}`, value: s.value, drill: `/inv/balances?q=${encodeURIComponent(s.code)}` })) } : { masked: true, rows: [] }) },
      { code: 'ov.stores.ageing', title: 'Age of the stock', type: 'bar', w: 6, h: 2, drill: '/inv/valuation', map: (d) => (d.canValues ? { categories: d.ageing.map((a) => `${a.label} days`), series: [{ name: '₹', values: d.ageing.map((a) => a.value) }] } : { masked: true, categories: [], series: [] }) },
      { code: 'ov.stores.reorder_list', title: 'Below reorder level', type: 'topn', w: 6, h: 2, drill: '/inv/balances', map: (d) => ({ kind: 'count', rows: d.belowReorder.slice(0, 8).map((r) => ({ id: r.itemId, label: `${r.code} ${r.name}`, sub: `free ${r.free} ${r.uom ?? ''}, reorder at ${r.reorderLevel}`, value: Math.max(0, Number(r.reorderLevel) - Number(r.free)), drill: `/inv/ledger?itemId=${r.itemId}` })), emptyTitle: 'Nothing below its reorder level', emptyText: 'Items whose free stock falls below the reorder level appear here.' }) },
    ],
  },
  {
    code: 'ov-hse', name: 'HSE Dashboard', route: '/hse/dashboard', permission: 'hse.dashboard.view', module: 'hse', part: '19.08',
    source: 'HSE safety indicators',
    read: (ctx) => once(keyOf('ov-hse', ctx), () => hseOf(ctx.db).svc.kpi.dashboard(ctx.actor, { projectId: pid(ctx), siteId: ctx.filters?.siteId ?? undefined, ...period(ctx) })),
    cards: [
      { code: 'ov.hse.safe_hours', title: 'Safe man-hours since the last lost-time injury', type: 'kpi', w: 4, h: 1, drill: '/hse/incidents', map: (d) => kpi(d.lagging.safe.manHours, { unit: 'man-hours', subtitle: `man-hours · ${d.lagging.safe.lastLtiDate ? `since ${d.lagging.safe.lastLtiDate}` : 'no lost-time injury on record'}`, status: 'green', drill: '/hse/incidents' }) },
      { code: 'ov.hse.ltifr', title: 'LTIFR', type: 'kpi', w: 4, h: 1, drill: '/hse/incidents', map: (d) => hseTile(d, 'ltifr') },
      { code: 'ov.hse.trir', title: 'TRIR', type: 'kpi', w: 4, h: 1, drill: '/hse/incidents', map: (d) => hseTile(d, 'trir') },
      { code: 'ov.hse.incidents', title: 'Incidents by kind', type: 'bar', w: 6, h: 2, drill: '/hse/incidents', map: (d) => { const k = Object.entries(d.lagging.counts); return { categories: k.map(([c]) => c.replace(/_/g, ' ').toLowerCase()), series: [{ name: 'Incidents', values: k.map(([, v]) => v), drill: k.map(([c]) => `/hse/incidents?filter[severity]=${c}`) }] }; } },
      { code: 'ov.hse.observations', title: 'Observations', type: 'donut', w: 6, h: 2, drill: '/hse/observations', map: (d) => ({ slices: [{ label: 'Closed in the period', value: d.leading.observations.closedInPeriod, drill: '/hse/observations?filter[status]=CLOSED' }, { label: 'Open, in time', value: Math.max(0, d.leading.observations.open - d.leading.observations.overdue), drill: '/hse/observations?filter[status]=OPEN' }, { label: 'Overdue', value: d.leading.observations.overdue, drill: '/hse/observations?overdue=1' }] }) },
      { code: 'ov.hse.leading', title: 'Leading indicators against target', type: 'bar', w: 12, h: 2, drill: '/hse/dashboard', map: (d) => { const rows = d.tiles.filter((t) => t.group === 'leading' && typeof t.value === 'number'); return { categories: rows.map((t) => t.label ?? t.key), series: [{ name: 'Value', values: rows.map((t) => t.value), drill: rows.map((t) => t.drill) }, { name: 'Target', values: rows.map((t) => t.target ?? 0) }] }; } },
    ],
  },
  {
    code: 'ov-qa', name: 'Quality Dashboard', route: '/qa/dashboard', permission: 'qa.dashboard.view', module: 'qa', part: '18.07',
    source: 'Quality dashboard',
    read: (ctx) => once(keyOf('ov-qa', ctx), () => qaOf(ctx.db).dsh.dashboard(ctx.actor, { projectId: pid(ctx), ...period(ctx) })),
    cards: [
      { code: 'ov.qa.first_time_ir', title: 'First-time IR approval', type: 'kpi', w: 3, h: 1, drill: '/qa/inspection-requests', map: (d) => qaKpi(d, 'firstTimeIr') },
      { code: 'ov.qa.open_ncr', title: 'Open NCRs', type: 'kpi', w: 3, h: 1, drill: '/qa/ncrs', map: (d) => qaKpi(d, 'openNcr') },
      { code: 'ov.qa.cube_fail', title: 'Cube failure rate (28-day)', type: 'kpi', w: 3, h: 1, drill: '/qa/test-requests', map: (d) => qaKpi(d, 'cubeFail') },
      { code: 'ov.qa.open_ir', title: 'Open inspection requests', type: 'kpi', w: 3, h: 1, drill: '/qa/inspection-requests', map: (d) => qaKpi(d, 'openIr') },
      { code: 'ov.qa.kpis', title: 'Quality measures against target', type: 'bar', w: 8, h: 2, drill: '/qa/dashboard', map: (d) => { const k = d.kpis.filter((x) => typeof x.value === 'number'); return { categories: k.map((x) => x.label), series: [{ name: 'Value', values: k.map((x) => x.value), drill: k.map((x) => x.drill) }, { name: 'Target', values: k.map((x) => x.target ?? 0) }] }; } },
      // the exceptions are { key, count, tone, drill }: their words are the quality page's own (the shared English text, qa namespace)
      { code: 'ov.qa.exceptions', title: 'Exceptions', type: 'alerts', w: 4, h: 2, drill: '/qa/ncrs', map: (d) => ({ rows: d.exceptions.slice(0, 8).map((x) => ({ id: x.key, title: String(EN.qa?.[`exc.${x.key}`] ?? x.key).replace('{n}', String(x.count)), subtitle: x.tone === 'red' ? 'Act now' : 'Needs attention', drill: x.drill ?? null })), total: d.exceptions.length, drill: null }) },
    ],
  },
  {
    code: 'ov-proc', name: 'Procurement Dashboard', route: '/proc/dashboard', permission: 'proc.analytics.view', module: 'proc', part: '15.10',
    source: 'Procurement analytics',
    read: (ctx) => once(keyOf('ov-proc', ctx), () => procOf(ctx.db).anaSvc.dashboard(ctx.actor, { projectId: pid(ctx), ...period(ctx) })),
    cards: [
      { code: 'ov.proc.spend_fy', title: 'Spend this financial year', type: 'kpi', w: 3, h: 1, drill: '/proc/spend-analysis', map: (d) => kpi(d.kpis.spendFy.value, { kind: 'money', subtitle: `₹ · since ${d.kpis.spendFy.from} · ${d.kpis.spendFy.count} orders`, drill: d.kpis.spendFy.route }) },
      { code: 'ov.proc.open_prs', title: 'Open requisitions', type: 'kpi', w: 3, h: 1, drill: '/proc/requisitions', map: (d) => kpi(d.kpis.openPrs.count, { unit: 'open', subtitle: `requisitions · oldest ${d.kpis.openPrs.oldestDays} days`, status: d.kpis.openPrs.count ? 'amber' : 'green', drill: d.kpis.openPrs.route }) },
      { code: 'ov.proc.overdue', title: 'Overdue deliveries', type: 'kpi', w: 3, h: 1, drill: '/proc/purchase-orders', map: (d) => kpi(d.kpis.overdueDeliveries.count, { unit: 'orders', subtitle: `orders · up to ${d.kpis.overdueDeliveries.maxDays} days late`, status: d.kpis.overdueDeliveries.count ? 'red' : 'green', drill: d.kpis.overdueDeliveries.route }) },
      { code: 'ov.proc.savings', title: 'Savings against budget', type: 'kpi', w: 3, h: 1, drill: '/proc/spend-analysis', map: (d) => kpi(d.kpis.savingsVsBudget.pct, { unit: '%', subtitle: `% · ₹ ${d.kpis.savingsVsBudget.value} saved`, target: d.kpis.savingsVsBudget.target, status: tone(d.kpis.savingsVsBudget.status), drill: d.kpis.savingsVsBudget.route }) },
      { code: 'ov.proc.queues', title: 'Work queues', type: 'topn', w: 6, h: 2, drill: '/proc/requisitions', map: (d) => ({ kind: 'count', rows: Object.entries(d.queues).map(([k, q]) => ({ id: k, label: q.label, sub: `₹ ${q.value}`, value: q.count, drill: q.route })) }) },
      { code: 'ov.proc.single_source', title: 'Orders without competition and emergency requisitions', type: 'bar', w: 6, h: 2, drill: '/proc/procurement-compliance', map: (d) => ({ categories: ['Orders without competition', 'Emergency requisitions'], series: [{ name: '%', values: [d.kpis.singleSource.pct ?? 0, d.kpis.emergency.pct ?? 0], drill: [d.kpis.singleSource.route, d.kpis.emergency.route] }, { name: 'Target', values: [d.kpis.singleSource.target ?? 0, d.kpis.emergency.target ?? 0] }] }) },
    ],
  },
  {
    code: 'ov-plant', name: 'Plant Dashboard', route: '/plant/dashboard', permission: 'plant.equipment.view', module: 'plant', part: '17.01',
    source: 'Plant dashboard',
    read: (ctx) => once(keyOf('ov-plant', ctx), () => plantOf(ctx.db).svc.dashboard(ctx.actor, { projectId: pid(ctx) })),
    cards: [
      { code: 'ov.plant.fleet', title: 'Fleet', type: 'kpi', w: 3, h: 1, drill: '/plant/equipment', map: (d) => kpi(d.kpis.fleet.count, { unit: 'machines', subtitle: `machines · ${d.kpis.fleet.owned} owned, ${d.kpis.fleet.hired} hired`, drill: d.kpis.fleet.drill }) },
      { code: 'ov.plant.utilisation', title: 'Utilisation', type: 'kpi', w: 3, h: 1, drill: '/plant/utilisation', map: (d) => kpi(d.kpis.utilisation.pct, { unit: '%', subtitle: `% · ${d.kpis.utilisation.working} of ${d.kpis.utilisation.deployed} deployed working today`, target: d.kpis.utilisation.target, status: tone(d.kpis.utilisation.status), drill: d.kpis.utilisation.drill }) },
      { code: 'ov.plant.breakdown', title: 'Under breakdown', type: 'kpi', w: 3, h: 1, drill: '/plant/equipment', map: (d) => kpi(d.kpis.breakdown.count, { unit: 'machines', subtitle: 'machines · now', status: tone(d.kpis.breakdown.status), drill: d.kpis.breakdown.drill }) },
      { code: 'ov.plant.expiring', title: 'Documents expiring', type: 'kpi', w: 3, h: 1, drill: '/plant/equipment', map: (d) => kpi(d.kpis.expiring.count, { unit: 'documents', subtitle: `documents · next ${d.kpis.expiring.days} days`, status: tone(d.kpis.expiring.status), drill: d.kpis.expiring.drill }) },
      { code: 'ov.plant.by_state', title: 'Machines by state', type: 'donut', w: 6, h: 2, drill: '/plant/equipment', map: (d) => ({ slices: (d.charts.byState ?? []).map((s) => ({ label: s.label ?? s.state, value: s.count ?? s.value ?? 0, drill: s.drill ?? null })) }) },
      { code: 'ov.plant.by_project', title: 'Machines by project', type: 'topn', w: 6, h: 2, drill: '/plant/equipment', map: (d) => ({ kind: 'count', rows: (d.charts.byProject ?? []).slice(0, 8).map((s, i) => ({ id: s.projectId ?? i, label: s.label ?? s.project, value: s.count ?? s.value ?? 0, drill: s.drill ?? null })) }) },
    ],
  },
  {
    code: 'ov-hr', name: 'HR Overview', route: '/hr', permission: 'hr.employee.view', module: 'hr', part: '07.01',
    source: 'HR employee overview',
    read: (ctx) => once(keyOf('ov-hr', ctx), () => employeesOf(ctx.db).overview(ctx.actor, { ...period(ctx) })),
    cards: [
      { code: 'ov.hr.headcount', title: 'Headcount', type: 'kpi', w: 3, h: 1, drill: '/hr/employees', map: (d) => hrTile(d, 'headcount') },
      { code: 'ov.hr.joiners', title: 'Joiners', type: 'kpi', w: 3, h: 1, drill: '/hr/employees', map: (d) => hrTile(d, 'joiners') },
      { code: 'ov.hr.leavers', title: 'Leavers', type: 'kpi', w: 3, h: 1, drill: '/hr/employees', map: (d) => hrTile(d, 'leavers') },
      { code: 'ov.hr.pending', title: 'Waiting for approval', type: 'kpi', w: 3, h: 1, drill: '/hr/employees', map: (d) => hrTile(d, 'pending') },
      // the overview's groups are { label, key, n } (key 0: none); each row opens the register filtered on it
      { code: 'ov.hr.by_department', title: 'People by department', type: 'topn', w: 6, h: 2, drill: '/hr/employees', map: (d) => ({ kind: 'count', rows: d.byDepartment.slice(0, 8).map((r, i) => ({ id: r.key ?? i, label: r.label, value: r.n, drill: r.key ? `/hr/employees?filter[departmentId]=${r.key}` : '/hr/employees' })) }) },
      { code: 'ov.hr.by_site', title: 'People by site', type: 'bar', w: 6, h: 2, drill: '/hr/employees', map: (d) => ({ categories: d.bySite.map((r) => r.label), series: [{ name: 'People', values: d.bySite.map((r) => r.n), drill: d.bySite.map((r) => (r.key ? `/hr/employees?filter[siteId]=${r.key}` : '/hr/employees')) }] }) },
    ],
  },
  {
    code: 'ov-budget', name: 'Budget vs Committed vs Actual', route: '/bud/ledger', permission: 'bud.ledger.view', module: 'bud', part: '12.03',
    source: 'Budget ledger report',
    read: (ctx) => (pid(ctx) ? once(keyOf('ov-budget', ctx), () => budOf(ctx.db).ledger.report(ctx.actor, { projectId: pid(ctx), by: 'wbs' })) : null),
    cards: [
      { code: 'ov.budget.totals', title: 'Budget, committed and actual', type: 'bar', w: 8, h: 2, drill: '/bud/ledger', map: (d) => (d ? budTotals(d) : { categories: [], series: [] }) },
      { code: 'ov.budget.available', title: 'Budget still available', type: 'kpi', w: 4, h: 1, drill: '/bud/ledger', map: (d, ctx) => (d ? budAvailable(d, ctx) : NO_PROJECT) },
      { code: 'ov.budget.top_overrun', title: 'Lines committed beyond their budget', type: 'topn', w: 4, h: 2, drill: '/bud/ledger', map: (d, ctx) => (d ? budOverruns(d, ctx) : { kind: 'money', rows: [], emptyTitle: 'No project chosen', emptyText: 'The ledger is read for one project: choose your working project, or a project in the filters.' }) },
    ],
  },
  {
    // Part 07.14 (built in 166.6): the workforce dashboard. Each card reads its own HR service (attendance today, leave, contract labour, the
    // register, the employee overview, the workflow); the site cards come first, so a phone shows them before the others (prompt 166.6 §2.1).
    code: 'ov-workforce', name: 'Workforce Dashboard', route: '/hr/workforce', permission: 'hr.workforce.view', module: 'hr', part: '07.14',
    source: 'HR workforce services',
    read: (ctx) => workforce(ctx),
    cards: [
      { code: 'ov.wf.attendance_today', title: 'Attendance today', type: 'bar', w: 6, h: 2, drill: '/att/today', source: 'Attendance, today\'s report and leave', map: (d) => wfAttendance(d) },
      { code: 'ov.wf.present', title: 'Present today', type: 'kpi', w: 3, h: 1, drill: '/att/today', source: 'Attendance, today\'s report', map: (d) => wfPresent(d) },
      { code: 'ov.wf.labour_on_site', title: 'Contract labour on site', type: 'topn', w: 3, h: 2, drill: '/labour/contractors', source: 'Contract labour strength', map: (d) => wfLabour(d) },
      { code: 'ov.wf.headcount_by_site', title: 'Headcount by site', type: 'topn', w: 6, h: 2, drill: '/hr/employees', source: 'HR employee overview', map: (d) => wfBySite(d) },
      { code: 'ov.wf.overtime', title: 'Overtime this month', type: 'kpi', w: 3, h: 1, drill: '/att/register', source: 'Attendance register', map: (d) => wfOvertime(d) },
      { code: 'ov.wf.leave_liability', title: 'Leave liability', type: 'kpi', w: 3, h: 1, drill: '/leave/balances', source: 'Leave balances', map: (d) => wfLiability(d) },
      { code: 'ov.wf.attrition', title: 'Attrition', type: 'kpi', w: 3, h: 1, drill: '/hr/employees?filter[status]=SEPARATED', source: 'HR employee overview', map: (d) => wfAttrition(d) },
      { code: 'ov.wf.pending', title: 'HR approvals waiting', type: 'todo', w: 6, h: 2, drill: '/approvals', source: 'My open approvals and tasks', map: (d) => d.pendingHr() },
      { code: 'ov.wf.expiring', title: 'Documents expired or expiring', type: 'alerts', w: 6, h: 2, drill: '/hr/employees', source: 'HR employee overview and contract labour', map: (d) => wfExpiring(d) },
    ],
  },
];

// ---- Home insight cards by role (FR-03): cards of the dashboards above, plus the person's approvals; never a figure without a service ----
export const HOME = {
  code: 'home-insights', name: 'Home insights',
  roles: {
    PM: ['ov.todo.mine', 'ov.qs.unbilled_wip', 'ov.budget.available', 'ov.qa.open_ir', 'ov.hse.safe_hours', 'ov.hse.ltifr', 'ov.feed.notifications', 'calendar.month', 'actions.quick'],
    CM: ['ov.todo.mine', 'ov.qa.open_ir', 'ov.hse.safe_hours', 'ov.hse.ltifr', 'ov.budget.available', 'ov.feed.notifications', 'calendar.month'],
    QS: ['ov.todo.mine', 'ov.qs.certified_not_billed', 'ov.qs.unbilled_wip', 'ov.qs.queues', 'ov.feed.notifications', 'actions.quick'],
    COMMGR: ['ov.todo.mine', 'ov.qs.certified_not_billed', 'ov.qs.margin', 'ov.tower.outstanding', 'ov.feed.notifications'],
    SK: ['ov.todo.mine', 'ov.stores.below_reorder', 'ov.stores.pending', 'ov.stores.reorder_list', 'ov.feed.notifications', 'actions.quick'],
    STOREMGR: ['ov.todo.mine', 'ov.stores.below_reorder', 'ov.stores.value', 'ov.stores.reorder_list', 'ov.feed.notifications'],
    HRMGR: ['ov.todo.mine', 'ov.hr.headcount', 'ov.hr.joiners', 'ov.hr.pending', 'ov.feed.notifications'],
    HSEE: ['ov.todo.mine', 'ov.hse.safe_hours', 'ov.hse.ltifr', 'ov.hse.observations', 'ov.feed.notifications', 'calendar.month'],
    QCMGR: ['ov.todo.mine', 'ov.qa.open_ir', 'ov.qa.exceptions', 'ov.feed.notifications', 'calendar.month'],
    PROCMGR: ['ov.todo.mine', 'ov.proc.open_prs', 'ov.proc.overdue', 'ov.proc.queues', 'ov.feed.notifications'],
    PLANTMGR: ['ov.todo.mine', 'ov.plant.utilisation', 'ov.plant.breakdown', 'ov.plant.expiring', 'ov.feed.notifications'],
    DIR: ['ov.todo.mine', 'ov.tower.outstanding', 'ov.tower.margin', 'ov.qs.unbilled_wip', 'ov.hse.ltifr', 'ov.proc.spend_fy', 'ov.feed.notifications'],
  },
};
export const TODO_CARD = { code: 'ov.todo.mine', title: 'Waiting for my decision', type: 'todo', w: 6, h: 2, drill: '/approvals', permission: 'self', module: 'eng', description: 'The approvals and tasks waiting for your decision, with Approve and Return.' };
export const FEED_CARD = { code: 'ov.feed.notifications', title: 'Latest notifications', type: 'alerts', w: 6, h: 2, drill: '/notifications', permission: 'self', module: 'eng', description: 'Your latest notifications with their time.' };
/** Cards of no overview page: the to-do card and the notification feed. */
export const STANDALONE = [TODO_CARD, FEED_CARD];


// ---- the workforce dashboard (07.14): each piece is read on demand, so a card needs only its own service and permission ----
const HR_DOCS = /^(HR_|ATT_|LV_|LAB_|PERF_|TRN_|EXP_|EXIT_|ESS_|DEP_|REC_)/;
function workforce(ctx) {
  const k = (part) => keyOf(`ov-workforce:${part}`, ctx);
  const pid = ctx.filters?.projectId ?? null;
  const sid = ctx.filters?.siteId ?? null;
  const tryRead = (fn) => { try { return fn(); } catch (e) { if (e?.status === 403) return null; throw e; } };
  return {
    db: ctx.db, actor: ctx.actor,
    today: () => once(k('today'), () => punchesOf(ctx.db).report.today(ctx.actor, { projectId: pid, siteId: sid })),
    leave: () => once(k('leave'), () => tryRead(() => leaveOf(ctx.db).balances.summary(ctx.actor, {}))),
    labour: () => once(k('labour'), () => labourOf(ctx.db).contractors.strength(ctx.actor, { ...(pid ? { projectId: pid } : {}), ...(sid ? { siteId: sid } : {}) })),
    overview: () => once(k('overview'), () => employeesOf(ctx.db).overview(ctx.actor, { ...period(ctx) })),
    overtime: () => once(k('overtime'), () => registerOf(ctx.db).overtimeMonth(ctx.actor, { projectId: pid, siteId: sid })),
    pendingHr: () => todo(ctx, (r) => HR_DOCS.test(r.docType ?? '')),
  };
}
function wfAttendance(d) {
  const t = d.today().totals;
  const lv = d.leave();
  const cats = [['Present', t.present], ['Absent', t.absent], ['Late', t.late], ...(lv ? [['On leave', lv.onLeaveToday]] : [])];
  return { categories: cats.map(([c]) => c), series: [{ name: 'People', values: cats.map(([, v]) => v), drill: cats.map(([c]) => (c === 'On leave' ? '/leave/calendar' : '/att/today')) }] };
}
function wfPresent(d) {
  const r = d.today();
  return kpi(r.totals.present, { unit: 'people', subtitle: `people · ${r.date} · ${r.totals.expected} expected, ${r.totals.deployed} deployed`, status: r.totals.absent > 0 ? 'amber' : 'green', note: r.totals.openAnomalies ? `${r.totals.openAnomalies} attendance anomalies open` : null, drill: '/att/today' });
}
function wfLabour(d) {
  const rows = d.labour().filter((x) => x.present || x.deployed).sort((a, b) => b.present - a.present || b.deployed - a.deployed).slice(0, 8);
  return { kind: 'count', rows: rows.map((x) => ({ id: x.id, label: x.name, sub: `${x.deployed} deployed, ${x.registered} registered`, value: x.present, drill: `/labour/contractors?open=${x.id}` })), emptyTitle: 'No contract labour on site', emptyText: 'Contractors with workers present today appear here.' };
}
function wfBySite(d) {
  const o = d.overview();
  return { kind: 'count', rows: o.bySite.slice(0, 8).map((r) => ({ id: r.key, label: r.label, value: r.n, drill: r.key ? `/hr/employees?filter[siteId]=${r.key}` : '/hr/employees' })), emptyTitle: 'No employees yet', emptyText: 'Active employees appear here by their site.' };
}
function wfOvertime(d) {
  const o = d.overtime();
  return kpi(o.hours, { unit: 'hours', subtitle: `hours paid · ${o.month} · ${o.people} people`, note: 'No overtime budget is set in the application, so it is not compared.', drill: '/att/register' });
}
function wfLiability(d) {
  const l = d.leave();
  if (!l) return { ...kpi(null), masked: true };
  return kpi(l.liabilityDays, { unit: 'days', subtitle: `days of paid leave to be taken · ${l.year}`, note: l.liability.map((x) => `${x.code} ${x.days}`).join(', ') || null, drill: '/leave/balances' });
}
function wfAttrition(d) {
  const o = d.overview();
  const tile = (key) => o.tiles.find((x) => x.key === key)?.value ?? 0;
  const head = tile('headcount');
  const leavers = tile('leavers');
  const pct = head + leavers > 0 ? Math.round((leavers * 1000) / (head + leavers)) / 10 : null;
  return kpi(pct, { unit: '%', subtitle: `% · leavers ÷ (headcount + leavers) · ${o.period.from} to ${o.period.to}`, note: `${leavers} left, ${head} in post`, status: pct === null ? 'neutral' : pct > 10 ? 'amber' : 'green', drill: '/hr/employees?filter[status]=SEPARATED' });
}
function wfExpiring(d) {
  const o = d.overview();
  const rows = o.attention.filter((a) => /document/.test(a.text)).map((a, i) => ({ id: `e${i}`, title: a.text, subtitle: a.kind === 'ERROR' ? 'Expired' : 'Expiring soon', drill: a.link }));
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  for (const c of d.labour().filter((x) => x.licenceValidUntil && x.licenceValidUntil <= soon)) rows.push({ id: `l${c.id}`, title: `${c.name}: labour licence ${c.licenceValidUntil < new Date().toISOString().slice(0, 10) ? 'expired' : 'expires'} on ${c.licenceValidUntil}`, subtitle: 'Contract labour licence', drill: `/labour/contractors?open=${c.id}` });
  // certificates and licences of training (07.10) that have expired or expire within their alert days
  const certs = trainingOf(d.db)?.widget(d.actor)?.value ?? 0;
  if (certs > 0) rows.push({ id: 'certs', title: `${certs} training certificate(s) or licence(s) expired or expiring`, subtitle: 'Training', drill: '/training/certifications' });
  return { rows: rows.slice(0, 10), total: rows.length, drill: '/hr/employees' };
}

// ---- helpers of the maps ----
function qsKpi(d, key) {
  const k = d.kpis.find((x) => x.key === key);
  return kpi(k.value, { kind: k.unit === 'Rs' ? 'money' : undefined, unit: k.unit === 'Rs' ? '' : k.unit, subtitle: `${k.unit === 'Rs' ? '₹' : 'count'} · ${d.projectId ? 'this project' : `${d.projectCount} project${d.projectCount === 1 ? '' : 's'}`} · as of ${d.asOf}`, status: tone(k.status), note: k.note, drill: k.drill });
}
function hseTile(d, key) {
  const t = d.tiles.find((x) => x.key === key);
  if (!t) return kpi(0, { subtitle: 'not measured' });
  return kpi(t.value, { unit: t.unit, subtitle: `per ${d.rateBase.toLocaleString('en-IN')} man-hours · ${d.period.from} to ${d.period.to}`, target: t.target, status: tone(t.status), drill: t.drill });
}
function qaKpi(d, key) {
  const k = d.kpis.find((x) => x.key === key);
  if (!k) return kpi(0, { subtitle: 'not measured' });
  return kpi(k.value, { unit: k.unit, subtitle: `${k.unit || 'count'} · ${d.period.from} to ${d.period.to}${k.n !== undefined ? ` · ${k.n} recorded` : ''}`, target: k.target, status: tone(k.status), drill: k.drill, previous: k.previous ?? null, trendPct: typeof k.trend === 'number' ? k.trend : null });
}
function hrTile(d, key) {
  const t = d.tiles.find((x) => x.key === key);
  if (!t) return kpi(0, { subtitle: 'not measured' });
  return kpi(t.value, { subtitle: `people · ${d.period.from} to ${d.period.to}`, note: t.hint ?? null, status: tone(t.tone), drill: t.to });
}
const paise = (v) => (v === null || v === undefined || v === '' ? 0 : Number(String(v).replace(/,/g, '')) || 0); // the ledger's money is text in rupees
/** A KPI with nothing to read (no project chosen): an empty state on the card, never a 0 that is not a figure. */
const NO_PROJECT = { empty: true, emptyTitle: 'No project chosen', emptyText: 'The budget is read for one project: choose your working project, or a project in the filters.', value: null };
const TOWER_FLAG = { LOSS: 'At a loss', MARGIN_FALLING: 'Margin falling', NO_CVR: 'No cost-value reconciliation', HIGH_RISK: 'High risk' };
function budTotals(d) {
  const t = d.totals ?? {};
  const keys = [['budget', 'Budget'], ['committed', 'Committed'], ['actual', 'Actual']].filter(([k]) => t[k] !== undefined);
  return { categories: keys.map(([, l]) => l), series: [{ name: '₹', values: keys.map(([k]) => paise(t[k])) }] };
}
function budAvailable(d, ctx) {
  const t = d.totals ?? {};
  const value = paise(t.available);
  return kpi(value, { kind: 'money', subtitle: `₹ · budget less committed and actual · ${d.projectCode}`, status: value < 0 ? 'red' : 'green', drill: withQuery('/bud/ledger', { projectId: pid(ctx) }) });
}
function budOverruns(d, ctx) {
  const rows = (d.rows ?? []).map((r, i) => ({ id: r.key ?? r.id ?? i, label: r.label, value: paise(r.committed) + paise(r.actual) - paise(r.budget) })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  return { kind: 'money', rows: rows.map((r) => ({ ...r, drill: withQuery('/bud/ledger', { projectId: pid(ctx) }) })), emptyTitle: 'Nothing committed beyond its budget', emptyText: 'Lines whose commitments pass the budget appear here.' };
}

/** Every card's code, with its overview (for the seed, the tests and the providers). */
export const allCards = () => [...OVERVIEWS.flatMap((o) => o.cards.map((c) => ({ ...c, overview: o }))), ...STANDALONE.map((c) => ({ ...c, overview: null }))];

let registered = false;
/** Register a provider per card. A card reads its overview's service; with the flag OFF the overview pages are not shown, so no card is asked. */
export function registerOverviewProviders() {
  if (registered) return;
  registered = true;
  for (const o of OVERVIEWS) {
    for (const c of o.cards) {
      widgetRegistry.register({
        code: c.code,
        provider: (ctx) => {
          const d = o.read(ctx);
          const out = c.map(d, ctx);
          // the list behind the card, with the dashboard's project and site (the framework adds them to "View all ›" as well)
          return { ...out, drill: out.drill ?? c.drill, source: out.source ?? c.source ?? o.source };
        },
      });
    }
  }
  widgetRegistry.register({ code: TODO_CARD.code, provider: (ctx) => todo(ctx) });
  widgetRegistry.register({ code: FEED_CARD.code, provider: (ctx) => feed(ctx) });
  roleLayouts.register(HOME.code, Object.fromEntries(Object.entries(HOME.roles).map(([role, codes]) => [role, homeLayout(codes)])));
}

const byCode = () => new Map(allCards().map((c) => [c.code, c]));
/** A Home layout of cards: KPIs in a row of four, lists and charts two to a row (S 3 / M 6 on the 12-column grid). */
export function homeLayout(codes) {
  const cards = byCode();
  // cards of 03.07 used on Home as they are: the calendar of the month (deadlines and inspections) and the quick actions
  const framework = { 'calendar.month': { type: 'calendar', w: 6, h: 3 }, 'actions.quick': { type: 'actions', w: 6, h: 1 } };
  return codes.map((code, i) => { const c = cards.get(code) ?? framework[code]; return { id: `h${i + 1}`, widget: code, w: c.w && !cards.has(code) ? c.w : c.type === 'kpi' ? 3 : 6, h: c.h && !cards.has(code) ? c.h : c.type === 'kpi' ? 1 : 2 }; });
}
