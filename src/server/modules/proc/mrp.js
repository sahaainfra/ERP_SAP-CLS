import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv, toPdf, toXlsx } from '../../platform/export/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { isoOf, ordOf } from '../plan/cpm.js';
import { d3, json, lower, nowIso, q3, rid } from './base.js';

// Material demand planning and MRP (part 15.02). A run works out, for a project, what the schedule will need week by week and what to order:
// - Gross requirement (FR-01): each unfinished activity of the approved schedule needs, for each BOQ line it covers, the quantity of the line it still has to do times the material norm of that line times (1 + wastage); that need is phased over
//   the weeks the rest of the activity runs. Items in a released take-off (09.02) take the quantity of the take-off, phased like the norms say (or at once when no activity names them).
// - Netting (FR-02): week by week, the stock on hand (site, nearby stores, central as the company allows), plus what is on order, in transit or already requisitioned, less the gross requirement, kept above the safety stock; what is short is rounded
//   up to the minimum order quantity and to whole packs.
// - Dates (FR-03): required-by is the start of the activity less the buffer; order-by is required-by less the lead time of the item (or its supplier).
// - Proposals (FR-04, BR-01): one proposal per item and order-by week, which the planner accepts (a DRAFT requisition of 15.01 is made, never an approved one), changes or rejects with a reason.
// - Shortage heat-map and long-lead list (FR-05); approved alternates with free stock are shown and may be chosen in place of the item (FR-06), with the supplier capacity notes.
export const RUN_STATUS = { DRAFT: 'Ready to run', COMPLETED: 'Completed', CLOSED: 'Closed: every proposal decided', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded by a later run' };
export const DECISIONS = { OPEN: 'Waiting for the planner', ACCEPTED: 'Accepted: draft requisition made', REJECTED: 'Rejected', SUPERSEDED: 'Superseded by a later run' };
for (const [key, dataType, def, description, extra] of [
  ['proc.mrp.default_lead_days', 'integer', 7, 'FR-03: the lead time, in days, of an item that has no approved planning parameters.', { min: 0, max: 365 }],
  ['proc.mrp.long_lead_days', 'integer', 45, 'FR-05: an item whose lead time is this many days or more is a long-lead item (a critical material).', { min: 1, max: 730 }],
  ['proc.mrp.weekly_enabled', 'boolean', true, 'FR-01: whether the weekly job makes an MRP run for every active project that has an approved schedule.', {}],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/** FR-02 (T-01): the netting of one item over weeks, in whole thousandths. For each week: what is there (the stock carried plus the receipts of the week), the net requirement to keep the safety stock above the gross requirement, the quantity proposed (the net rounded up to the minimum order quantity and to whole packs) and the stock carried to the next week. */
export function netWeeks({ gross, receipts = [], freeStock = 0, safety = 0, moq = 0, pack = 0 }) {
  const out = []; let carried = freeStock;
  for (let i = 0; i < gross.length; i += 1) {
    const rec = receipts[i] ?? 0; const avail = carried + rec; const net = Math.max(0, gross[i] + safety - avail);
    let proposed = 0; if (net > 0) { proposed = Math.max(net, moq); if (pack > 0) proposed = Math.ceil(proposed / pack) * pack; }
    const end = avail + proposed - gross[i]; out.push({ gross: gross[i], available: avail, net, proposed, end }); carried = end;
  }
  return out;
}
const mondayOf = (iso) => { const d = new Date(`${iso}T00:00:00Z`); const wd = (d.getUTCDay() + 6) % 7; return isoOf(ordOf(iso) - wd); };
const weekIndex = (start, iso, n) => Math.min(n - 1, Math.max(0, Math.floor((ordOf(iso) - ordOf(start)) / 7)));

export const runList_ = defineList({
  code: 'proc.mrp_runs', label: 'MRP runs', permission: 'proc.run.view', from: 'proc_mrp_runs x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Run no.' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, kind: { sql: 'x.run_kind', type: 'enum', label: 'Kind', options: [['ON_DEMAND', 'On demand'], ['SCHEDULED', 'Weekly']] },
    horizon: { sql: 'x.horizon_weeks', type: 'number', label: 'Weeks' }, items: { sql: 'x.item_count', type: 'number', label: 'Items' }, shortages: { sql: 'x.shortage_count', type: 'number', label: 'Shortages' }, proposals: { sql: 'x.proposal_count', type: 'number', label: 'Proposals' }, runBy: { sql: 'x.run_by', type: 'text', label: 'Run by' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(RUN_STATUS) },
  },
});
export const proposalList = defineList({
  code: 'proc.mrp_proposals', label: 'PR proposals', permission: 'proc.run.view', from: 'proc_mrp_proposals x JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_items i ON i.id = x.item_id JOIN proc_mrp_runs r ON r.id = x.run_id', where: 'x.deleted_at IS NULL', searchable: ['i.code', 'i.name', 'p.code', 'r.doc_no'], defaultSort: 'orderBy',
  columns: {
    run: { sql: 'r.doc_no', type: 'text', label: 'Run' }, runId: { sql: 'x.run_id', type: 'number', label: 'Run id' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, item: { sql: 'i.code', type: 'text', label: 'Item' }, itemName: { sql: 'i.name', type: 'text', label: 'Name' },
    qty: { sql: 'x.qty', type: 'text', label: 'Quantity' }, uom: { sql: 'x.uom', type: 'text', label: 'Unit' }, requiredBy: { sql: 'x.required_by', type: 'date', label: 'Required by' }, orderBy: { sql: 'x.order_by', type: 'date', label: 'Order by' },
    urgency: { sql: "CASE WHEN x.late = 1 THEN 'LATE' WHEN x.long_lead = 1 THEN 'LONG_LEAD' ELSE 'NORMAL' END", type: 'enum', label: 'Urgency', options: [['LATE', 'Order-by date passed'], ['LONG_LEAD', 'Long lead'], ['NORMAL', 'Normal']] },
    decision: { sql: 'x.decision', type: 'enum', label: 'Decision', options: Object.entries(DECISIONS) },
  },
});

export function createMrpService({ db, base, stock, pr }) {
  const { authz, param, may, need, fail, audit, notify, number, project, itemOf } = base;
  const system = (companyId) => ({ user: 'system', companyId, roles: ['SYSTEM'] });
  const evt = (type, actor, r, data) => publishEvent(db, { type, entity: 'proc_mrp_run', entityId: r.id, actorId: actor?.user ?? 'system', companyId: r.company_id, projectId: r.org_project_id, data: { runId: r.id, docNo: r.doc_no, projectId: r.org_project_id, ...data } });
  const row = (actor, id, key = 'proc.run.view') => {
    const r = db.prepare('SELECT * FROM proc_mrp_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'proc.run.view', r.org_project_id)) throw notFound('That MRP run does not exist.'); if (key !== 'proc.run.view') need(actor, key, 'do that with an MRP run', r.org_project_id); return r;
  };
  const scope = (actor, alias = 'x') => { const f = authz.scopeFilter(actor, 'proc.run.view', { project: `${alias}.org_project_id` }); return { sql: `${alias}.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };

  // ---- the planning parameters of an item (lead time, minimum order, pack, safety stock, long lead): the approved row in force ------------------------------------------------------------------------------------
  function paramsOf(companyId, itemId, day) {
    const rows = db.prepare("SELECT * FROM proc_item_params WHERE company_id = ? AND item_id = ? AND status = 'APPROVED' AND effective_from <= ? AND deleted_at IS NULL ORDER BY effective_from DESC, id DESC").all(companyId, itemId, day);
    const dflt = rows.find((r) => r.vendor_id == null); const vend = rows.filter((r) => r.vendor_id != null).sort((a, b) => a.lead_time_days - b.lead_time_days)[0];
    const pick = dflt ?? vend ?? null; const item = itemOf(companyId, itemId); const dl = Number(param(companyId, 'proc.mrp.default_lead_days') ?? 7); const ll = Number(param(companyId, 'proc.mrp.long_lead_days') ?? 45);
    const reorder = db.prepare('SELECT reorder_level FROM mdm_items WHERE id = ?').get(itemId)?.reorder_level ?? 0; const lead = pick ? pick.lead_time_days : dl;
    return { found: Boolean(pick), lead, moq: pick?.moq ?? 0, pack: pick?.pack_size ?? 0, safety: pick ? pick.safety_stock : reorder, vendorId: pick?.vendor_id ?? vend?.vendor_id ?? null, capacityNote: rows.map((r) => r.capacity_note).filter(Boolean)[0] ?? null, longLead: Boolean(pick?.long_lead) || lead >= ll, uom: item?.base_uom };
  }
  /** A norm in its own unit turned into the base unit of the item (the item's own conversion, when it names the unit). */
  function toBase(item, uom, qty) {
    if (!item || !uom || lower(uom) === lower(item.base_uom)) return qty;
    const f = db.prepare('SELECT factor_to_base FROM mdm_item_uoms WHERE item_id = ? AND uom = ? COLLATE NOCASE AND deleted_at IS NULL').get(item.id, uom); return f ? Math.round(qty * Number(f.factor_to_base)) : qty;
  }

  // ---- FR-01: the gross requirement, phased ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function demand(r, start, n) {
    const today = todayIST(); const horizonEnd = isoOf(ordOf(start) + n * 7 - 1); const buffer = r.buffer_days; const warnings = []; const sched = db.prepare("SELECT * FROM plan_schedules WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL AND status = 'APPROVED' ORDER BY version_no DESC LIMIT 1").get(r.org_project_id, r.company_id);
    // item -> weeks[] of gross, week -> { need dates, activities }
    const items = new Map(); const slot = (itemId) => { if (!items.has(itemId)) items.set(itemId, { gross: new Array(n).fill(0), need: new Array(n).fill(null), acts: Array.from({ length: n }, () => []), fromMto: 0, normTotal: 0 }); return items.get(itemId); };
    if (!sched) { warnings.push('The project has no approved schedule: only released take-off quantities are planned.'); } else {
      const acts = db.prepare("SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL AND act_type = 'TASK' AND actual_finish IS NULL").all(sched.id); let undated = 0; let unlinked = 0;
      for (const a of acts) {
        const links = db.prepare('SELECT boq_line_id, qty FROM plan_activity_boq WHERE activity_id = ? AND deleted_at IS NULL').all(a.id); if (!links.length) { unlinked += 1; continue; }
        if (!a.es || !a.ef) { undated += 1; continue; } const left = Math.max(0, 1 - (a.pct_complete ?? 0) / 10000); if (left <= 0) continue;
        const from = a.es < today ? today : a.es; const to = a.ef < from ? from : a.ef; if (from > horizonEnd) continue; const total = ordOf(to) - ordOf(from) + 1;
        for (const l of links) for (const nm of db.prepare("SELECT * FROM proj_boq_line_norms WHERE line_id = ? AND norm_type = 'MATERIAL' AND resource_item_id IS NOT NULL AND deleted_at IS NULL").all(l.boq_line_id)) {
          const item = itemOf(r.company_id, nm.resource_item_id); if (!item) continue; const qty = toBase(item, nm.uom, Math.round((l.qty * left * nm.qty_per_unit * (1_000_000 + nm.wastage_pct)) / (1000 * 1_000_000))); if (qty <= 0) continue;
          const s = slot(item.id); s.normTotal += qty;
          for (let d = 0; d < total; d += 1) { const day = isoOf(ordOf(from) + d); if (day > horizonEnd) break; const w = weekIndex(start, day, n); s.gross[w] += qty / total; const nd = day < a.es ? a.es : day; const key = nd < today ? today : nd; if (!s.need[w] || key < s.need[w]) s.need[w] = key; }
          for (let w = 0; w < n; w += 1) if (s.gross[w] > 0 && !s.acts[w].some((x) => x.activityId === a.id)) { const ws = isoOf(ordOf(start) + w * 7); const we = isoOf(ordOf(ws) + 6); if (from <= we && to >= ws) s.acts[w].push({ activityId: a.id, code: a.code, name: a.name, start: a.es, finish: a.ef, scheduleId: sched.id }); }
        }
      }
      if (undated) warnings.push(`${undated} activit${undated === 1 ? 'y has' : 'ies have'} no planned dates and ${undated === 1 ? 'is' : 'are'} left out.`); if (unlinked) warnings.push(`${unlinked} activit${unlinked === 1 ? 'y is' : 'ies are'} not linked to BOQ lines and ${unlinked === 1 ? 'is' : 'are'} left out.`);
    }
    // the take-off quantities of released revisions: the item takes the quantity of the take-off
    if (r.include_mto) {
      const mto = db.prepare(`SELECT m.item_id AS item_id, SUM(m.qty) AS qty, m.uom AS uom FROM mto_material_requirements m JOIN mto_takeoffs t ON t.id = CAST(m.source_id AS INTEGER) WHERE m.source_type = 'mto_takeoff' AND m.deleted_at IS NULL AND m.item_id IS NOT NULL AND t.status = 'APPROVED' AND t.deleted_at IS NULL AND t.project_id = ? AND t.company_id = ? GROUP BY m.item_id, m.uom`).all(r.org_project_id, r.company_id);
      for (const m of mto) { const item = itemOf(r.company_id, m.item_id); if (!item) continue; const qty = toBase(item, m.uom, m.qty); if (qty <= 0) continue; const s = slot(item.id);
        if (s.normTotal > 0) { const k = qty / s.normTotal; for (let w = 0; w < n; w += 1) s.gross[w] *= k; } else { s.gross[0] += qty; if (!s.need[0] || today < s.need[0]) s.need[0] = today; s.acts[0].push({ activityId: null, code: 'MTO', name: 'Released take-off quantity: no activity names this item', start: null, finish: null, scheduleId: null }); warnings.push(`${item.code} is in a released take-off but no activity uses it: its quantity is needed at once.`); }
        s.fromMto = qty; }
    }
    // demand typed in by the planner for a draft run (a one-off job that is in neither the schedule nor a take-off)
    for (const m of json(r.parameters_json, {}).manual ?? []) { const item = itemOf(r.company_id, m.itemId); if (!item) continue; const s = slot(item.id); const w = weekIndex(start, m.weekStart < today ? today : m.weekStart, n); s.gross[w] += q3(m.qty); const nd = m.weekStart < today ? today : m.weekStart; if (!s.need[w] || nd < s.need[w]) s.need[w] = nd; s.acts[w].push({ activityId: null, code: 'MANUAL', name: m.note ?? 'Entered by the planner', start: null, finish: null, scheduleId: null }); }
    for (const s of items.values()) s.gross = s.gross.map((g) => Math.round(g));
    return { items, warnings, schedule: sched, buffer };
  }
  /** What is expected to arrive, by item and week: orders and goods in transit (loaded from the order and stock parts) and what is already requisitioned and not yet ordered. */
  function supply(r, start, n) {
    const out = new Map(); const slot = (id) => { if (!out.has(id)) out.set(id, { po: new Array(n).fill(0), transit: new Array(n).fill(0), pr: new Array(n).fill(0) }); return out.get(id); };
    const day = todayIST(); const at = (d) => weekIndex(start, d < day ? day : d, n);
    for (const x of db.prepare('SELECT * FROM proc_open_supply WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND balance_qty > 0').all(r.company_id, r.org_project_id)) slot(x.item_id)[x.supply_kind === 'PO' ? 'po' : 'transit'][at(x.expected_on)] += x.balance_qty;
    for (const x of db.prepare("SELECT l.item_id, l.balance_qty, l.required_by FROM proc_pr_lines l JOIN proc_requisitions p ON p.id = l.pr_id WHERE p.company_id = ? AND p.org_project_id = ? AND p.deleted_at IS NULL AND l.deleted_at IS NULL AND l.item_id IS NOT NULL AND l.balance_qty > 0 AND p.status IN ('DRAFT', 'RETURNED', 'SUBMITTED', 'EMERGENCY', 'APPROVED')").all(r.company_id, r.org_project_id)) slot(x.item_id).pr[at(x.required_by)] += x.balance_qty;
    return out;
  }

  /** The run: requirements, netting, dates, lines and proposals, in one transaction; the earlier run of the project is superseded. */
  function calculate(actor, id, { asSystem = false } = {}) {
    const r = asSystem ? db.prepare('SELECT * FROM proc_mrp_runs WHERE id = ? AND deleted_at IS NULL').get(rid(id)) : row(actor, id, 'proc.run.submit'); if (r.status !== 'DRAFT') throw unprocessable(`${RUN_STATUS[r.status]}: only a run that is ready is run.`);
    const today = todayIST(); const start = mondayOf(today); const n = r.horizon_weeks; const d = demand(r, start, n); const sup = supply(r, start, n);
    const ids = new Set([...d.items.keys(), ...sup.keys()]); const stockMap = stock.availability(r.company_id, r.org_project_id, null, [...ids]);
    return transaction(db, () => {
      const now = nowIso(); db.prepare('UPDATE proc_mrp_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE run_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_mrp_proposals SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE run_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id);
      let shortages = 0; const proposals = []; const shortList = []; const insLine = db.prepare('INSERT INTO proc_mrp_lines (company_id, run_id, item_id, week_start, gross_req, free_stock, open_po, in_transit, open_pr, safety_stock, net_req, proposed_qty, projected_end, required_by, order_by, late, source_activities_json, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'mrp_run\', ?)');
      for (const itemId of [...ids].sort((a, b) => a - b)) {
        const s = d.items.get(itemId) ?? { gross: new Array(n).fill(0), need: new Array(n).fill(null), acts: Array.from({ length: n }, () => []) }; const sp = sup.get(itemId); const pm = paramsOf(r.company_id, itemId, today); const free = stockMap.get(itemId)?.controlMilli ?? 0;
        const rec = Array.from({ length: n }, (_, w) => (sp ? sp.po[w] + sp.transit[w] + sp.pr[w] : 0)); const net = netWeeks({ gross: s.gross, receipts: rec, freeStock: free, safety: pm.safety, moq: pm.moq, pack: pm.pack });
        if (net.every((x) => x.gross === 0 && x.net === 0)) continue; let item0 = true; const perOrderWeek = new Map();
        net.forEach((x, w) => {
          const ws = isoOf(ordOf(start) + w * 7); const needDate = s.need[w] ?? (x.net > 0 ? (ws < today ? today : ws) : null); const requiredBy = needDate ? isoOf(ordOf(needDate) - d.buffer) : null; const orderBy = requiredBy ? isoOf(ordOf(requiredBy) - pm.lead) : null; const late = x.proposed > 0 && orderBy != null && orderBy < today ? 1 : 0;
          insLine.run(r.company_id, r.id, itemId, ws, x.gross, item0 ? free : 0, sp ? sp.po[w] : 0, sp ? sp.transit[w] : 0, sp ? sp.pr[w] : 0, pm.safety, x.net, x.proposed, x.end, requiredBy, orderBy, late, JSON.stringify(s.acts[w]), r.org_project_id, actor.user, String(r.id)); item0 = false;
          if (x.net > 0) { shortages += 1; shortList.push({ itemId, weekStart: ws, shortQty: d3(x.net), requiredBy, orderBy, late: Boolean(late) }); }
          if (x.proposed > 0 && orderBy) { const k = mondayOf(orderBy); const p = perOrderWeek.get(k) ?? { qty: 0, requiredBy, orderBy, late: 0, acts: [] }; p.qty += x.proposed; if (requiredBy < p.requiredBy) p.requiredBy = requiredBy; if (orderBy < p.orderBy) p.orderBy = orderBy; p.late = p.late || late; for (const a of s.acts[w]) if (!p.acts.some((y) => y.activityId === a.activityId && y.code === a.code)) p.acts.push(a); perOrderWeek.set(k, p); }
        });
        const item = itemOf(r.company_id, itemId);
        for (const p of perOrderWeek.values()) {
          const alts = db.prepare("SELECT i.id, i.code, i.name, i.base_uom FROM mdm_item_alternates a JOIN mdm_items i ON i.id = a.alternate_item_id WHERE a.item_id = ? AND a.deleted_at IS NULL AND i.item_status = 'ACTIVE' AND i.deleted_at IS NULL").all(itemId).map((a) => ({ itemId: a.id, code: a.code, name: a.name, uom: a.base_uom, freeQty: stock.availability(r.company_id, r.org_project_id, null, [a.id]).get(a.id)?.controlQty ?? 0 })).filter((a) => a.freeQty > 0);
          proposals.push({ itemId, uom: item.base_uom, qty: p.qty, requiredBy: p.requiredBy, orderBy: p.orderBy, late: p.late ? 1 : 0, longLead: pm.longLead ? 1 : 0, lead: pm.lead, vendorId: pm.vendorId, alts, acts: p.acts });
        }
      }
      for (const p of proposals) db.prepare('INSERT INTO proc_mrp_proposals (company_id, run_id, org_project_id, item_id, uom, qty, proposed_qty, required_by, order_by, late, long_lead, lead_days, vendor_id, alternates_json, source_activities_json, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'mrp_run\', ?)').run(r.company_id, r.id, r.org_project_id, p.itemId, p.uom, p.qty, p.qty, p.requiredBy, p.orderBy, p.late, p.longLead, p.lead, p.vendorId, JSON.stringify(p.alts), JSON.stringify(p.acts), r.org_project_id, actor.user, String(r.id));
      // the earlier run of the project gives way: its open proposals are superseded (an accepted one keeps its draft requisition)
      for (const old of db.prepare("SELECT id FROM proc_mrp_runs WHERE org_project_id = ? AND id <> ? AND status = 'COMPLETED' AND deleted_at IS NULL").all(r.org_project_id, r.id)) { db.prepare("UPDATE proc_mrp_proposals SET decision = 'SUPERSEDED', decided_by = ?, decided_at = ?, reason = ? WHERE run_id = ? AND decision = 'OPEN'").run(actor.user, now, `Superseded by ${r.doc_no}`, old.id); db.prepare("UPDATE proc_mrp_runs SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, old.id); }
      const itemCount = db.prepare('SELECT COUNT(DISTINCT item_id) AS n FROM proc_mrp_lines WHERE run_id = ? AND deleted_at IS NULL').get(r.id).n;
      db.prepare("UPDATE proc_mrp_runs SET status = ?, schedule_id = ?, run_at = ?, run_by = ?, item_count = ?, shortage_count = ?, proposal_count = ?, warnings_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(proposals.length ? 'COMPLETED' : 'COMPLETED', d.schedule?.id ?? null, now, actor.user, itemCount, shortages, proposals.length, JSON.stringify(d.warnings), actor.user, now, r.id);
      audit(actor, 'proc_mrp_runs', r.id, 'run', r.company_id, { newValues: { items: itemCount, shortages, proposals: proposals.length } });
      const fresh = db.prepare('SELECT * FROM proc_mrp_runs WHERE id = ?').get(r.id); const p = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(r.org_project_id);
      evt('proc.mrp.run_completed', actor, fresh, { items: itemCount, shortages, proposals: proposals.length, late: proposals.filter((x) => x.late).length });
      if (shortList.length) evt('proc.mrp.shortages_found', actor, fresh, { shortages: shortList });
      notify(r.company_id, 'proc.mrp.completed', [`user:${r.created_by}`, 'role:PROCIC'], r.doc_no, String(p?.code), `${r.doc_no}: ${itemCount} item(s), ${shortages} short week(s), ${proposals.length} proposal(s) for you to decide.`, `/proc/mrp?id=${r.id}`, r.id, { projectId: r.org_project_id });
      const late = proposals.filter((x) => x.late); if (late.length) notify(r.company_id, 'proc.mrp.late', ['role:PROCMGR|PM'], r.doc_no, String(p?.code), `${late.length} proposal(s) of ${r.doc_no} should have been ordered already (long lead or short notice).`, `/proc/mrp-proposals?runId=${r.id}`, `${r.id}.late`, { projectId: r.org_project_id });
      return asSystem ? { id: r.id, docNo: r.doc_no, proposals: proposals.length } : mrp.get(actor, r.id);
    });
  }

  // ---- the views -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const view = (actor, r, { detail = false } = {}) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const open = r.status === 'COMPLETED' ? db.prepare("SELECT COUNT(*) AS n FROM proc_mrp_proposals WHERE run_id = ? AND decision = 'OPEN' AND deleted_at IS NULL").get(r.id).n : 0;
    const o = { id: r.id, docNo: r.doc_no, date: r.doc_date, projectId: r.org_project_id, projectCode: p?.code, projectName: p?.name, kind: r.run_kind, horizonWeeks: r.horizon_weeks, bufferDays: r.buffer_days, includeMto: Boolean(r.include_mto), status: r.status, statusLabel: RUN_STATUS[r.status], runAt: r.run_at, runBy: r.run_by, itemCount: r.item_count, shortageCount: r.shortage_count, proposalCount: r.proposal_count, openProposals: open,
      warnings: json(r.warnings_json, []), revisionNo: r.revision_no, parentId: r.parent_id, scheduleId: r.schedule_id, cancelReason: r.cancel_reason, rowVersion: r.version,
      can: { edit: can('proc.run.edit') && r.status === 'DRAFT', run: can('proc.run.submit') && r.status === 'DRAFT', delete: can('proc.run.delete') && r.status === 'DRAFT', cancel: can('proc.run.cancel') && ['DRAFT', 'COMPLETED'].includes(r.status), amend: can('proc.run.amend') && ['COMPLETED', 'CLOSED'].includes(r.status), print: can('proc.run.print'), export: can('proc.run.export'), decide: can('proc.proposal.decide') && r.status === 'COMPLETED' } };
    if (detail) o.lines = linesOf(r);
    return o;
  };
  function linesOf(r) {
    return db.prepare('SELECT l.*, i.code, i.name, i.base_uom FROM proc_mrp_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.run_id = ? AND l.deleted_at IS NULL ORDER BY i.code, l.week_start').all(r.id).map((l) => ({ id: l.id, itemId: l.item_id, itemCode: l.code, itemName: l.name, uom: l.base_uom, weekStart: l.week_start, grossReq: d3(l.gross_req), freeStock: d3(l.free_stock), openPo: d3(l.open_po), inTransit: d3(l.in_transit), openPr: d3(l.open_pr), safetyStock: d3(l.safety_stock), netReq: d3(l.net_req), proposedQty: d3(l.proposed_qty), projectedEnd: d3(l.projected_end), requiredBy: l.required_by, orderBy: l.order_by, late: Boolean(l.late), activities: json(l.source_activities_json, []) }));
  }
  const mrp = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.run.view').allowed) throw forbidden('You may not see MRP runs (permission proc.run.view).'); const sc = scope(actor);
      return runList(db, runList_, parseListRequest(runList_, query), { select: 'x.*, p.code AS pcode', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, date: x.doc_date, project: x.pcode, projectId: x.org_project_id, kind: x.run_kind, horizon: x.horizon_weeks, items: x.item_count, shortages: x.shortage_count, proposals: x.proposal_count, runBy: x.run_by, status: x.status, statusLabel: RUN_STATUS[x.status] }) });
    },
    exportSource(actor, req) { return mrp.list(actor, { ...req, page: 1, pageSize: 100 }); },
    projects(actor) { return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'proc.run.view', p.id)).map((p) => ({ id: p.id, code: p.code, name: p.name, canRun: may(actor, 'proc.run.create', p.id), canDecide: may(actor, 'proc.proposal.decide', p.id), hasSchedule: Boolean(db.prepare("SELECT 1 FROM plan_schedules WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(p.id)) })); },
    get: (actor, id) => view(actor, row(actor, id), { detail: true }),
    create(actor, b) {
      const p = project(actor, b.projectId, 'proc.run.view', 'proc.run.create'); return transaction(db, () => {
        const no = number(actor.companyId, actor.user, 'PROC_MRP', 'proc_mrp_runs', 'MRP'); const id = Number(db.prepare("INSERT INTO proc_mrp_runs (company_id, doc_no, doc_date, org_project_id, run_kind, horizon_weeks, buffer_days, include_mto, parameters_json, status, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'api')").run(actor.companyId, no, todayIST(), p.id, b.kind ?? 'ON_DEMAND', b.horizonWeeks ?? 12, b.bufferDays ?? 3, b.includeMto === false ? 0 : 1, JSON.stringify({ note: b.note ?? null }), p.id, actor.user).lastInsertRowid);
        audit(actor, 'proc_mrp_runs', id, 'create', actor.companyId, { newValues: { docNo: no, horizonWeeks: b.horizonWeeks ?? 12 } }); return mrp.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.run.edit'); if (r.status !== 'DRAFT') throw conflict('A run that has been made is locked: amend it to run again with other parameters.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this run; reload it.');
      db.prepare('UPDATE proc_mrp_runs SET horizon_weeks = ?, buffer_days = ?, include_mto = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.horizonWeeks ?? r.horizon_weeks, b.bufferDays ?? r.buffer_days, 'includeMto' in b ? (b.includeMto ? 1 : 0) : r.include_mto, actor.user, nowIso(), r.id); audit(actor, 'proc_mrp_runs', r.id, 'update', r.company_id); return mrp.get(actor, r.id);
    },
    remove(actor, id) { const r = row(actor, id, 'proc.run.delete'); if (r.status !== 'DRAFT') throw unprocessable('Only a run not yet made is deleted. Cancel it instead.'); db.prepare('UPDATE proc_mrp_runs SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'proc_mrp_runs', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    /** Runs the planning (the standard `submit` of a run: it has no approval of its own, BR-01 puts the decision at the proposals). */
    submit: (actor, id) => calculate(actor, id),
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'proc.run.cancel'); if (!['DRAFT', 'COMPLETED'].includes(r.status)) throw unprocessable('Only a run that is not closed is cancelled.');
      return transaction(db, () => { db.prepare("UPDATE proc_mrp_proposals SET decision = 'REJECTED', decided_by = ?, decided_at = ?, reason = ? WHERE run_id = ? AND decision = 'OPEN'").run(actor.user, nowIso(), `Run cancelled: ${reason}`, r.id); db.prepare("UPDATE proc_mrp_runs SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_mrp_runs', r.id, 'cancel', r.company_id, { reason }); return mrp.get(actor, r.id); });
    },
    /** A new run with the same parameters, to be made again; when it is made, this one is superseded and its open proposals with it. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'proc.run.amend'); if (!['COMPLETED', 'CLOSED'].includes(r.status)) throw unprocessable('Only a run that has been made is amended.'); if (db.prepare("SELECT 1 FROM proc_mrp_runs WHERE parent_id = ? AND status = 'DRAFT' AND deleted_at IS NULL").get(r.id)) throw conflict('A new run of this one is waiting to be made.');
      return transaction(db, () => { const no = `${r.doc_no.split('/R')[0]}/R${r.revision_no + 1}`; const nid = Number(db.prepare("INSERT INTO proc_mrp_runs (company_id, doc_no, doc_date, org_project_id, run_kind, horizon_weeks, buffer_days, include_mto, parameters_json, status, revision_no, parent_id, project_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, 'ON_DEMAND', ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'amendment', ?, ?)").run(r.company_id, no, todayIST(), r.org_project_id, r.horizon_weeks, r.buffer_days, r.include_mto, r.parameters_json, r.revision_no + 1, r.id, r.org_project_id, actor.user, String(r.id), reason).lastInsertRowid); audit(actor, 'proc_mrp_runs', nid, 'amend', r.company_id, { reason, newValues: { of: r.doc_no } }); return mrp.get(actor, nid); });
    },
    /** Demand added to a draft run by hand (a one-off job in neither the schedule nor a take-off), by item code, week and quantity. */
    importDemand(actor, id, { rows }) {
      const r = row(actor, id, 'proc.run.edit'); if (r.status !== 'DRAFT') throw conflict('Demand is added to a run that is not yet made.'); const problems = []; const manual = json(r.parameters_json, {}).manual ?? [];
      rows.forEach((x, i) => { const it = db.prepare("SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND item_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(actor.companyId, x.itemCode); if (!it) problems.push({ field: `rows.${i}.itemCode`, message: `No active item with the code ${x.itemCode}` }); else manual.push({ itemId: it.id, weekStart: x.weekStart, qty: x.qty, note: x.note ?? null }); }); fail(problems);
      db.prepare('UPDATE proc_mrp_runs SET parameters_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify({ ...json(r.parameters_json, {}), manual }), actor.user, nowIso(), r.id); audit(actor, 'proc_mrp_runs', r.id, 'import', r.company_id, { newValues: { added: rows.length } }); return mrp.get(actor, r.id);
    },
    history(actor, id) { const r = row(actor, id); return { approvals: [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'proc_mrp_runs' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    lines(actor, id, q = {}) { const r = row(actor, id); let l = linesOf(r); if (q.itemId) l = l.filter((x) => x.itemId === q.itemId); return { run: view(actor, r), lines: l }; },
    heatmap(actor, id) {
      const r = row(actor, id); const start = mondayOf(r.doc_date < (r.run_at ?? '').slice(0, 10) ? r.run_at.slice(0, 10) : (r.run_at ?? r.doc_date).slice(0, 10)); const weeks = Array.from({ length: r.horizon_weeks }, (_, w) => isoOf(ordOf(start) + w * 7)); const byItem = new Map();
      for (const l of linesOf(r)) { if (!byItem.has(l.itemId)) byItem.set(l.itemId, { itemId: l.itemId, code: l.itemCode, name: l.itemName, uom: l.uom, weeks: weeks.map((w) => ({ weekStart: w, gross: 0, net: 0, proposed: 0, level: 'NONE', late: false })), totalShort: 0 }); const it = byItem.get(l.itemId); const i = weeks.indexOf(l.weekStart); if (i < 0) continue; const longLead = paramsOf(r.company_id, l.itemId, todayIST()).longLead; it.weeks[i] = { weekStart: l.weekStart, gross: l.grossReq, net: l.netReq, proposed: l.proposedQty, level: l.netReq > 0 ? (l.late || longLead ? 'CRITICAL' : 'SHORT') : (l.grossReq > 0 ? 'OK' : 'NONE'), late: l.late }; it.totalShort += l.netReq; }
      const items = [...byItem.values()].map((x) => ({ ...x, longLead: paramsOf(r.company_id, x.itemId, todayIST()).longLead, totalShort: Math.round(x.totalShort * 1000) / 1000 })).sort((a, b) => b.totalShort - a.totalShort || a.code.localeCompare(b.code));
      return { run: view(actor, r), weeks, items, totals: { items: items.length, short: items.filter((x) => x.totalShort > 0).length, critical: items.filter((x) => x.weeks.some((w) => w.level === 'CRITICAL')).length } };
    },
    /** FR-05: the long-lead materials: items whose lead time is long and that the run needs, with the order-by date, the days left to it and the supplier's capacity. */
    longLead(actor, id) {
      const r = row(actor, id); const today = todayIST(); const rows = []; const seen = new Set();
      for (const l of linesOf(r)) { if (seen.has(l.itemId)) continue; const pm = paramsOf(r.company_id, l.itemId, today); if (!pm.longLead) continue; seen.add(l.itemId); const ls = linesOf(r).filter((x) => x.itemId === l.itemId); const first = ls.filter((x) => x.requiredBy).sort((a, b) => a.requiredBy.localeCompare(b.requiredBy))[0]; const orderBy = first?.orderBy ?? null; const v = pm.vendorId ? db.prepare('SELECT display_name, legal_name FROM mdm_partners WHERE id = ?').get(pm.vendorId) : null;
        rows.push({ itemId: l.itemId, code: l.itemCode, name: l.itemName, uom: l.uom, leadDays: pm.lead, totalGross: Math.round(ls.reduce((n, x) => n + x.grossReq, 0) * 1000) / 1000, totalShort: Math.round(ls.reduce((n, x) => n + x.netReq, 0) * 1000) / 1000, requiredBy: first?.requiredBy ?? null, orderBy, daysToOrder: orderBy ? ordOf(orderBy) - ordOf(today) : null, late: orderBy ? orderBy < today : false, vendor: v?.display_name ?? v?.legal_name ?? null, capacityNote: pm.capacityNote, moq: d3(pm.moq), pack: d3(pm.pack) }); }
      rows.sort((a, b) => (a.daysToOrder ?? 9999) - (b.daysToOrder ?? 9999)); return { run: view(actor, r), rows };
    },
    reportExport(actor, id, { kind, format }) {
      const r = row(actor, id, 'proc.run.export'); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(actor.companyId)?.legal_name ?? ''; audit(actor, 'proc_mrp_runs', r.id, 'export', r.company_id, { newValues: { kind, format } }); let columns; let rows; let title;
      if (kind === 'LONG_LEAD') { const x = mrp.longLead(actor, id); title = `Long-lead items of ${r.doc_no}`; columns = [['code', 'Item'], ['name', 'Name'], ['leadDays', 'Lead time (days)'], ['totalShort', 'Short'], ['requiredBy', 'Required by'], ['orderBy', 'Order by'], ['daysToOrder', 'Days to order'], ['vendor', 'Supplier'], ['capacityNote', 'Capacity']].map(([key, label]) => ({ key, label, type: 'text' })); rows = x.rows.map((y) => Object.fromEntries(columns.map((c) => [c.key, String(y[c.key] ?? '')]))); }
      else if (kind === 'HEATMAP') { const x = mrp.heatmap(actor, id); title = `Shortage heat-map of ${r.doc_no}`; columns = [{ key: 'item', label: 'Item', type: 'text' }, ...x.weeks.map((w) => ({ key: w, label: w.slice(5), type: 'text' })), { key: 'short', label: 'Total short', type: 'text' }]; rows = x.items.map((y) => ({ item: `${y.code} ${y.name}`, ...Object.fromEntries(y.weeks.map((w) => [w.weekStart, w.net > 0 ? String(w.net) : ''])), short: String(y.totalShort) })); }
      else { title = `MRP result of ${r.doc_no}`; columns = [['itemCode', 'Item'], ['weekStart', 'Week'], ['grossReq', 'Gross'], ['freeStock', 'Free stock'], ['openPo', 'Open PO'], ['inTransit', 'In transit'], ['openPr', 'Open PR'], ['safetyStock', 'Safety'], ['netReq', 'Net'], ['proposedQty', 'Proposed'], ['requiredBy', 'Required by'], ['orderBy', 'Order by']].map(([key, label]) => ({ key, label, type: 'text' })); rows = linesOf(r).map((l) => Object.fromEntries(columns.map((c) => [c.key, String(l[c.key] ?? '')]))); }
      const footer = [`${co}: ${title}`, `Project ${db.prepare('SELECT code FROM org_projects WHERE id = ?').get(r.org_project_id)?.code}, run on ${(r.run_at ?? '').slice(0, 10)}, ${r.horizon_weeks} weeks`]; const name = `${r.doc_no.replaceAll('/', '-')}-${kind.toLowerCase()}`;
      if (format === 'csv') return { buffer: Buffer.from(toCsv({ columns, rows, footer })), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: rows.length };
      if (format === 'pdf') return { buffer: toPdf({ columns, rows, footer, title }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: rows.length };
      return { buffer: toXlsx({ columns, rows, footer, sheetName: 'MRP' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: rows.length };
    },
    print(actor, id) { return mrp.reportExport(actor, id, { kind: 'RESULT', format: 'pdf' }); },
    /** The weekly job (FR-01): a run for every active project that has an approved schedule, made by the system. */
    weekly(companyId) {
      const out = { runs: 0, skipped: 0 }; if (!param(companyId, 'proc.mrp.weekly_enabled')) return out;
      for (const p of db.prepare("SELECT id FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'").all(companyId)) {
        if (!db.prepare("SELECT 1 FROM plan_schedules WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(p.id)) { out.skipped += 1; continue; }
        const sys = system(companyId); const no = number(companyId, 'system', 'PROC_MRP', 'proc_mrp_runs', 'MRP');
        const id = Number(db.prepare("INSERT INTO proc_mrp_runs (company_id, doc_no, doc_date, org_project_id, run_kind, horizon_weeks, buffer_days, include_mto, status, project_id, created_by, source_type) VALUES (?, ?, ?, ?, 'SCHEDULED', 12, 3, 1, 'DRAFT', ?, 'system', 'job')").run(companyId, no, todayIST(), p.id, p.id).lastInsertRowid);
        calculate({ ...sys, roles: ['SYSADM'] }, id, { asSystem: true }); out.runs += 1;
      }
      return out;
    },
  };
  // ---- FR-04: the proposals ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const prow = (actor, id, key = 'proc.run.view') => {
    const p = db.prepare('SELECT * FROM proc_mrp_proposals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!p || !may(actor, 'proc.run.view', p.org_project_id)) throw notFound('That proposal does not exist.'); if (key !== 'proc.run.view') need(actor, key, 'decide on this proposal', p.org_project_id); return p;
  };
  const pview = (actor, p) => {
    const it = itemOf(p.company_id, p.item_id); const run = db.prepare('SELECT doc_no, status FROM proc_mrp_runs WHERE id = ?').get(p.run_id); const pr_ = p.pr_id ? db.prepare('SELECT doc_no, status FROM proc_requisitions WHERE id = ?').get(p.pr_id) : null; const v = p.vendor_id ? db.prepare('SELECT display_name, legal_name FROM mdm_partners WHERE id = ?').get(p.vendor_id) : null; const sub = p.substitute_item_id ? itemOf(p.company_id, p.substitute_item_id) : null; const today = todayIST();
    return { id: p.id, runId: p.run_id, runNo: run?.doc_no, projectId: p.org_project_id, itemId: p.item_id, itemCode: it?.code, itemName: it?.name, uom: p.uom, qty: d3(p.qty), proposedQty: d3(p.proposed_qty), requiredBy: p.required_by, orderBy: p.order_by, late: Boolean(p.late), daysToOrder: ordOf(p.order_by) - ordOf(today), longLead: Boolean(p.long_lead), leadDays: p.lead_days, vendorId: p.vendor_id, vendor: v?.display_name ?? v?.legal_name ?? null,
      alternates: json(p.alternates_json, []), substituteItemId: p.substitute_item_id, substitute: sub ? `${sub.code} ${sub.name}` : null, decision: p.decision, decisionLabel: DECISIONS[p.decision], decidedBy: p.decided_by, decidedAt: p.decided_at, reason: p.reason, modified: Boolean(p.modified), prId: p.pr_id, prNo: pr_?.doc_no ?? null, activities: json(p.source_activities_json, []), rowVersion: p.version,
      can: { decide: p.decision === 'OPEN' && run?.status === 'COMPLETED' && may(actor, 'proc.proposal.decide', p.org_project_id) } };
  };
  const props = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.run.view').allowed) throw forbidden('You may not see MRP proposals (permission proc.run.view).'); const sc = scope(actor);
      return runList(db, proposalList, parseListRequest(proposalList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const v = pview(actor, x); return { id: x.id, run: v.runNo, runId: x.run_id, project: db.prepare('SELECT code FROM org_projects WHERE id = ?').get(x.org_project_id)?.code, projectId: x.org_project_id, item: v.itemCode, itemName: v.itemName, qty: String(v.qty), uom: x.uom, requiredBy: x.required_by, orderBy: x.order_by, urgency: x.late ? 'LATE' : x.long_lead ? 'LONG_LEAD' : 'NORMAL', daysToOrder: v.daysToOrder, decision: x.decision, decisionLabel: v.decisionLabel, prNo: v.prNo }; } });
    },
    get: (actor, id) => pview(actor, prow(actor, id)),
    /** Change what is proposed before it is accepted: the quantity (it stays at the minimum order and the pack the item allows), the date, or an approved alternate in its place (FR-06). */
    modify(actor, id, b) {
      const p = prow(actor, id, 'proc.proposal.decide'); if (p.decision !== 'OPEN') throw conflict(`${DECISIONS[p.decision]}: it is not changed.`); if (b.rowVersion && b.rowVersion !== p.version) throw conflict('Someone changed this proposal; reload it.'); const problems = [];
      if (b.requiredBy && b.requiredBy < todayIST()) problems.push({ field: 'requiredBy', message: 'The required-by date is not before today' });
      let sub = p.substitute_item_id; if ('substituteItemId' in b) { if (b.substituteItemId == null) sub = null; else { const ok = json(p.alternates_json, []).some((a) => a.itemId === b.substituteItemId) || db.prepare('SELECT 1 FROM mdm_item_alternates WHERE item_id = ? AND alternate_item_id = ? AND deleted_at IS NULL').get(p.item_id, b.substituteItemId); if (!ok) problems.push({ field: 'substituteItemId', message: 'Not an approved alternate of this item' }); sub = b.substituteItemId; } }
      const pm = paramsOf(p.company_id, sub ?? p.item_id, todayIST()); const qty = b.qty != null ? q3(b.qty) : p.qty; if (qty <= 0) problems.push({ field: 'qty', message: 'Give a quantity above zero' }); else if (b.qty != null && pm.moq > 0 && qty < pm.moq) problems.push({ field: 'qty', message: `Below the minimum order quantity of ${d3(pm.moq)}` }); else if (b.qty != null && pm.pack > 0 && qty % pm.pack !== 0) problems.push({ field: 'qty', message: `Not a whole number of packs of ${d3(pm.pack)}` }); fail(problems);
      const sit = sub ? itemOf(p.company_id, sub) : itemOf(p.company_id, p.item_id);
      db.prepare('UPDATE proc_mrp_proposals SET qty = ?, required_by = ?, substitute_item_id = ?, uom = ?, modified = 1, remarks = COALESCE(?, remarks), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(qty, b.requiredBy ?? p.required_by, sub, sit?.base_uom ?? p.uom, b.note ?? null, actor.user, nowIso(), p.id); audit(actor, 'proc_mrp_proposals', p.id, 'modify', p.company_id, { oldValues: { qty: d3(p.qty), requiredBy: p.required_by, substitute: p.substitute_item_id }, newValues: { qty: d3(qty), requiredBy: b.requiredBy ?? p.required_by, substitute: sub } }); return props.get(actor, p.id);
    },
    reject(actor, id, { reason }) {
      const p = prow(actor, id, 'proc.proposal.decide'); if (p.decision !== 'OPEN') throw conflict(`${DECISIONS[p.decision]}: it is not decided again.`);
      return transaction(db, () => { db.prepare("UPDATE proc_mrp_proposals SET decision = 'REJECTED', decided_by = ?, decided_at = ?, reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), reason, actor.user, nowIso(), p.id); audit(actor, 'proc_mrp_proposals', p.id, 'reject', p.company_id, { reason }); closeIfDone(actor, p.run_id); return props.get(actor, p.id); });
    },
    /** BR-01: accepting makes a DRAFT requisition of 15.01 (source MRP) with a line for each proposal, and nothing more: it still goes through the approval by value. */
    accept(actor, { ids, siteId, items }) {
      const ps = ids.map((i) => prow(actor, i, 'proc.proposal.decide')); const projects = new Set(ps.map((p) => p.org_project_id)); if (projects.size !== 1) fail([{ field: 'ids', message: 'A requisition is for one project: accept the proposals of one project at a time' }]); const bad = ps.find((p) => p.decision !== 'OPEN'); if (bad) throw conflict(`${DECISIONS[bad.decision]}: proposal ${bad.id} is not accepted.`);
      const over = new Map((items ?? []).map((x) => [x.id, x])); const projectId = ps[0].org_project_id; const run = db.prepare('SELECT * FROM proc_mrp_runs WHERE id = ?').get(ps[0].run_id); if (ps.some((p) => p.run_id !== run.id)) fail([{ field: 'ids', message: 'Accept the proposals of one run at a time' }]);
      return transaction(db, () => {
        const lines = ps.map((p) => { const o = over.get(p.id) ?? {}; const it = p.substitute_item_id ?? p.item_id; return { itemId: it, qty: d3(o.qty != null ? q3(o.qty) : p.qty), uom: itemOf(p.company_id, it)?.base_uom ?? p.uom, requiredBy: o.requiredBy ?? (p.required_by < todayIST() ? todayIST() : p.required_by), estRate: o.estRate ?? undefined, preferredVendorId: p.vendor_id ?? undefined, proposalId: p.id }; });
        const made = pr.prs.fromMrp(actor, { projectId, siteId: siteId ?? null, priority: ps.some((p) => p.late) ? 'URGENT' : ps.some((p) => p.long_lead) ? 'HIGH' : 'NORMAL', purpose: `From ${run.doc_no}: ${ps.length} proposal(s)`, lines, runId: run.id, runNo: run.doc_no });
        for (const p of ps) { db.prepare("UPDATE proc_mrp_proposals SET decision = 'ACCEPTED', decided_by = ?, decided_at = ?, pr_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), made.id, actor.user, nowIso(), p.id); audit(actor, 'proc_mrp_proposals', p.id, 'accept', p.company_id, { newValues: { pr: made.docNo } }); }
        publishEvent(db, { type: 'proc.mrp.proposals_accepted', entity: 'proc_mrp_run', entityId: run.id, actorId: actor.user, companyId: run.company_id, projectId, data: { runId: run.id, docNo: run.doc_no, projectId, prId: made.id, prNo: made.docNo, proposals: ps.map((p) => p.id) } });
        closeIfDone(actor, run.id); return { prId: made.id, prNo: made.docNo, accepted: ps.length, requisition: made };
      });
    },
  };
  function closeIfDone(actor, runId) { if (!db.prepare("SELECT 1 FROM proc_mrp_proposals WHERE run_id = ? AND decision = 'OPEN' AND deleted_at IS NULL").get(runId)) db.prepare("UPDATE proc_mrp_runs SET status = 'CLOSED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'COMPLETED'").run(actor.user, nowIso(), runId); }
  const options = (actor, projectId) => { const p = project(actor, projectId, 'proc.run.view'); return { projectId: p.id, sites: db.prepare("SELECT id, code, name FROM org_sites WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(p.id, actor.companyId).map((s) => ({ id: s.id, label: `${s.code} ${s.name}` })), hasSchedule: Boolean(db.prepare("SELECT 1 FROM plan_schedules WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(p.id)), canRun: may(actor, 'proc.run.create', p.id), canDecide: may(actor, 'proc.proposal.decide', p.id) }; };
  /** What is on order or on the way, loaded until the order part (15.05) and the stock part keep it. */
  function ingestSupply(actor, { supplies }) {
    need(actor, 'proc.supply.ingest', 'load open orders'); const problems = [];
    supplies.forEach((s, i) => { if (!itemOf(actor.companyId, s.itemId)) problems.push({ field: `supplies.${i}.itemId`, message: 'Not an item of this company' }); const p = db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(s.projectId, actor.companyId); if (!p) problems.push({ field: `supplies.${i}.projectId`, message: 'Not a project of this company' }); }); fail(problems);
    return transaction(db, () => { let n = 0; for (const s of supplies) { const q = q3(s.balanceQty); const ex = db.prepare('SELECT * FROM proc_open_supply WHERE company_id = ? AND org_project_id = ? AND item_id = ? AND supply_kind = ? AND doc_ref = ?').get(actor.companyId, s.projectId, s.itemId, s.kind, s.docRef); if (ex) db.prepare('UPDATE proc_open_supply SET balance_qty = ?, expected_on = ?, deleted_at = NULL, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(q, s.expectedOn, actor.user, nowIso(), ex.id); else db.prepare("INSERT INTO proc_open_supply (company_id, org_project_id, item_id, supply_kind, doc_ref, balance_qty, expected_on, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingest')").run(actor.companyId, s.projectId, s.itemId, s.kind, s.docRef, q, s.expectedOn, s.projectId, actor.user); n += 1; } return { loaded: n }; });
  }
  return { mrp, props, options, ingestSupply, calculate, paramsOf };
}
