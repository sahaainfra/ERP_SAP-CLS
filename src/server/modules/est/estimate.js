import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { calcOf } from '../../platform/calc/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { dec } from '../../../shared/decimal.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { ratesOf } from '../mdm/rates.js';
import { tendersOf } from '../bd/tender.js';
import { BASES, COMPONENT_TYPES, ESTIMATE_DOC, INDIRECTS, MODES, OPEN, STATUS, esc, json, money, nowIso, num, rid, same, units } from './constants.js';

// The estimate workspace (part 09.01). An estimate is a version of the costing of a tender (08.02) or a project: a header (basis date, region, currency, the HO overhead, contingency, escalation and GST percentages),
// items in sections that mirror the client BOQ (typed, pasted or imported from Excel), each priced from a released rate analysis (06.06: its direct cost per unit and its resources), from a manual build-up of components
// (materials, labour, plant, subcontract, priced from the resource rate library) or from a typed cost rate, with a markup that gives the selling rate; the indirect costs sheet; the risks whose exposure is the contingency.
// Every amount comes from the calculation engine (est.item_rate, est.percent_amount, est.estimate_total, ra.line_amount, ra.unit_rate, boq.line_amount) and is recomputed on the server at every save and at submit (BR-01).
// An item priced from an analysis that has a newer released version is flagged and re-priced on request (BR-01). Internal costs, markups and margins are shown only with est.estimate.cost (BR-02). Versions are copies
// (est_estimates rows sharing doc_no); two versions are compared item by item (FR-07). The resource summary adds up the materials, labour and plant of every item (FR-06) for the material take-off (09.02).
export const estimateList = defineList({
  code: 'est.estimates', label: 'Estimates', permission: 'est.estimate.view',
  from: 'est_estimates e LEFT JOIN tdr_tenders t ON t.id = e.tender_id LEFT JOIN org_projects p ON p.id = e.project_id', where: 'e.deleted_at IS NULL', searchable: ['e.doc_no', 'e.title', 't.doc_no', 't.name_of_work', 'p.name'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'e.doc_no', type: 'text', label: 'Estimate' }, versionNo: { sql: 'e.version_no', type: 'number', label: 'Version' }, title: { sql: 'e.title', type: 'text', label: 'Title' },
    tender: { sql: 't.doc_no', type: 'text', label: 'Tender' }, project: { sql: 'p.name', type: 'text', label: 'Project' }, basisDate: { sql: 'e.basis_date', type: 'date', label: 'Basis date' }, region: { sql: 'e.region_code', type: 'text', label: 'Region' },
    status: { sql: 'e.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) }, totalSelling: { sql: '(e.total_selling / 100.0)', type: 'money', label: 'Selling (₹)' },
    totalCost: { sql: '(e.total_cost / 100.0)', type: 'money', label: 'Cost (₹)', sensitive: true }, marginPct: { sql: '(e.margin_pct / 10000.0)', type: 'number', label: 'Margin %', sensitive: true }, bidValue: { sql: '(e.bid_value / 100.0)', type: 'money', label: 'Bid value with GST (₹)' },
  },
});
const SENSITIVE = ['totalCost', 'marginPct'];
const ITEM_COLS = ['section_code', 'section_name', 'item_no', 'sort_order', 'description', 'uom', 'qty', 'client_rate', 'work_item_id', 'build_mode', 'analysis_id', 'cost_rate', 'markup_pct', 'selling_rate', 'cost_amount', 'amount', 'priced_at', 'remarks'];

export function createEstimateService({ db }) {
  const authz = authzOf(db);
  const calc = () => calcOf(db);
  const R = () => ratesOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (problems) => { if (problems.length) throw badRequest('Correct the highlighted fields', problems); };
  const costs = (actor) => may(actor, 'est.estimate.cost');
  /** A project estimate is seen by those whose grant covers its project; a tender estimate by everyone who holds the permission in the company. */
  const seesProject = (actor, key, projectId) => projectId == null ? may(actor, key) : authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed;
  const scopeSql = (actor) => { const f = authz.scopeFilter(actor, 'est.estimate.view', { project: 'e.project_id' }); return { sql: `e.company_id = :c AND (e.project_id IS NULL OR ${f.sql})`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const ev = (code, inputs, rec = null) => calc().evaluate(code, inputs, rec ? { entity: 'est_estimate', entityId: rec.id, field: rec.field, companyId: rec.companyId, user: rec.user } : {}).result;
  const event = (type, actor, id, companyId, data) => publishEvent(db, { type, entity: 'est_estimate', entityId: id, actorId: actor.user, companyId, data });
  const today = () => todayIST();

  // ---- reading -----------------------------------------------------------------------------------------------------------------------------
  const row = (actor, id, key = 'est.estimate.view') => {
    const e = db.prepare('SELECT * FROM est_estimates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!e || !seesProject(actor, key, e.project_id)) throw notFound('That estimate does not exist or is not yours to see.');
    return e;
  };
  const itemsOf = (id) => db.prepare('SELECT i.*, w.code AS work_code, w.name AS work_name, a.analysis_no, a.version_no AS analysis_version, a.analysis_status FROM est_estimate_items i LEFT JOIN mdm_items w ON w.id = i.work_item_id LEFT JOIN ra_analyses a ON a.id = i.analysis_id WHERE i.estimate_id = ? AND i.deleted_at IS NULL ORDER BY i.sort_order, i.id').all(id);
  const componentsOf = (itemId) => db.prepare('SELECT c.*, m.code AS item_code FROM est_item_components c LEFT JOIN mdm_items m ON m.id = c.component_item_id WHERE c.estimate_item_id = ? AND c.deleted_at IS NULL ORDER BY c.line_no').all(itemId);
  const indirectsOf = (id) => db.prepare('SELECT * FROM est_indirects WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(id);
  const risksOf = (id) => db.prepare('SELECT * FROM est_risks WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(id);
  /** The released version of an analysis that is now in force, when the item uses an older one (BR-01). */
  const newerOf = (i) => (i.analysis_id && i.analysis_no ? db.prepare("SELECT id, version_no FROM ra_analyses WHERE company_id = ? AND analysis_no = ? AND analysis_status = 'APPROVED' AND version_no > ? AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(i.company_id, i.analysis_no, i.analysis_version) : null) ?? null;
  const tenderOf = (id) => (id ? db.prepare('SELECT id, doc_no, name_of_work, region, status, stage, submission_at FROM tdr_tenders WHERE id = ?').get(id) ?? null : null);
  const projectOf = (id) => (id ? db.prepare('SELECT id, code, name FROM org_projects WHERE id = ?').get(id) ?? null : null);
  const mask = (actor, v) => (costs(actor) ? v : null);

  function itemView(actor, i, { components = false } = {}) {
    const c = costs(actor); const newer = newerOf(i);
    return {
      id: i.id, sectionCode: i.section_code, sectionName: i.section_name, itemNo: i.item_no, sortOrder: i.sort_order, description: i.description, uom: i.uom, qty: num(i.qty, 'quantity'), clientRate: num(i.client_rate, 'rate'),
      workItemId: i.work_item_id, workItem: i.work_item_id ? { id: i.work_item_id, code: i.work_code, name: i.work_name } : null, mode: i.build_mode, modeLabel: MODES[i.build_mode],
      analysisId: i.analysis_id, analysis: i.analysis_id ? { id: i.analysis_id, ref: `${i.analysis_no}/v${i.analysis_version}`, status: i.analysis_status } : null, stale: Boolean(newer), newerAnalysis: newer ? { id: newer.id, ref: `${i.analysis_no}/v${newer.version_no}` } : null,
      costRate: c ? num(i.cost_rate, 'rate') : null, markupPct: c ? num(i.markup_pct, 'percent') : null, sellingRate: money(i.selling_rate), costAmount: c ? money(i.cost_amount) : null, amount: money(i.amount), pricedAt: i.priced_at, notes: i.remarks,
      ...(components ? { components: i.build_mode === 'MANUAL' ? componentsOf(i.id).map((x) => ({ id: x.id, lineNo: x.line_no, type: x.component_type, itemId: x.component_item_id, itemCode: x.item_code, description: x.description, uom: x.uom, qty: num(x.qty_per_unit, 'quantity'), rate: c ? num(x.rate, 'rate') : null, amount: c ? money(x.amount) : null, origin: x.line_origin })) : [] } : {}),
    };
  }
  /** FR-08: cost against selling, and the margin of each section, through the engine. */
  function sectionsOf(actor, items) {
    const by = new Map();
    for (const i of items) { const s = by.get(i.section_code) ?? { code: i.section_code, name: i.section_name, items: 0, cost: dec(0), selling: dec(0) }; s.items += 1; s.cost = s.cost.add(dec(money(i.cost_amount))); s.selling = s.selling.add(dec(money(i.amount))); if (!s.name && i.section_name) s.name = i.section_name; by.set(i.section_code, s); }
    return [...by.values()].map((s) => {
      const m = ev('est.estimate_total', { direct_cost: s.cost.toFixed(2), indirect_cost: '0', risk_amount: '0', overhead_percent: '0', contingency_percent: '0', escalation_percent: '0', selling_amount: s.selling.toFixed(2), gst_percent: '0' });
      return { code: s.code, name: s.name, items: s.items, selling: s.selling.toFixed(2), cost: mask(actor, s.cost.toFixed(2)), margin: mask(actor, m.margin), marginPct: mask(actor, num(units(m.margin_percent, 'percent'), 'percent')) };
    });
  }
  function view(actor, e, { detail = false } = {}) {
    const c = costs(actor); const t = tenderOf(e.tender_id); const p = projectOf(e.project_id); const mine = same(e.created_by, actor.user); const editable = ['DRAFT', 'RETURNED'].includes(e.status);
    const base = {
      id: e.id, docNo: e.doc_no, versionNo: e.version_no, ref: `${e.doc_no}/v${e.version_no}`, title: e.title, tenderId: e.tender_id, tender: t ? { id: t.id, docNo: t.doc_no, nameOfWork: t.name_of_work } : null, projectId: e.project_id, project: p ? { id: p.id, code: p.code, name: p.name } : null,
      basisDate: e.basis_date, region: e.region_code, currency: e.currency_code, status: e.status, statusLabel: STATUS[e.status], rowVersion: e.version, requestedBy: e.requested_by, createdBy: e.created_by, approvedAt: e.approved_at, workflowInstanceId: e.workflow_instance_id,
      hoOverheadPct: c ? num(e.ho_overhead_pct, 'percent') : null, contingencyPct: c ? num(e.contingency_pct, 'percent') : null, escalationPct: c ? num(e.escalation_pct, 'percent') : null, gstPct: num(e.gst_pct, 'percent'),
      totals: { directCost: mask(actor, money(e.direct_cost)), indirectCost: mask(actor, money(e.indirect_cost)), overhead: mask(actor, money(e.overhead_amount)), risk: mask(actor, money(e.risk_amount)), contingency: mask(actor, money(e.contingency_amount)), escalation: mask(actor, money(e.escalation_amount)), totalCost: mask(actor, money(e.total_cost)), selling: money(e.total_selling), margin: mask(actor, money(e.margin_amount)), marginPct: mask(actor, num(e.margin_pct, 'percent')), gst: money(e.gst_amount), bidValue: money(e.bid_value) },
      calculatedAt: e.calculated_at, costsVisible: c,
    };
    if (!detail) return base;
    const items = itemsOf(e.id);
    const versions = db.prepare('SELECT id, version_no, status, total_selling, margin_pct, created_at, created_by FROM est_estimates WHERE company_id = ? AND doc_no = ? AND deleted_at IS NULL ORDER BY version_no DESC').all(e.company_id, e.doc_no)
      .map((x) => ({ id: x.id, versionNo: x.version_no, status: x.status, statusLabel: STATUS[x.status], selling: money(x.total_selling), marginPct: mask(actor, num(x.margin_pct, 'percent')), createdAt: x.created_at, createdBy: x.created_by }));
    const otherOpen = db.prepare("SELECT 1 FROM est_estimates WHERE company_id = ? AND doc_no = ? AND id != ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(e.company_id, e.doc_no, e.id);
    return {
      ...base, items: items.map((i) => itemView(actor, i, { components: true })), sections: sectionsOf(actor, items), stale: items.filter((i) => newerOf(i)).length,
      indirects: c ? indirectsOf(e.id).map((x) => ({ id: x.id, category: x.category, categoryLabel: INDIRECTS[x.category], description: x.description, basis: x.basis, qty: num(x.qty, 'quantity'), rate: num(x.rate, 'rate'), percent: num(x.percent, 'percent'), amount: money(x.amount) })) : null,
      risks: c ? risksOf(e.id).map((x) => ({ id: x.id, description: x.description, impact: money(x.impact), probabilityPct: num(x.probability_pct, 'percent'), exposure: money(x.exposure) })) : null,
      versions, breakdown: c ? json(e.breakdown_json, {}) : null,
      can: {
        edit: editable && mine && may(actor, 'est.estimate.edit'), delete: e.status === 'DRAFT' && mine && may(actor, 'est.estimate.delete'), submit: editable && mine && !otherOpen && may(actor, 'est.estimate.submit'),
        withdraw: e.status === 'SUBMITTED' && same(e.requested_by, actor.user), cancel: OPEN.includes(e.status) && mine && may(actor, 'est.estimate.cancel'), newVersion: may(actor, 'est.estimate.create') && seesProject(actor, 'est.estimate.create', e.project_id),
        amend: e.status === 'APPROVED' && may(actor, 'est.estimate.amend'), print: may(actor, 'est.estimate.print'), export: may(actor, 'est.estimate.export'), costs: c,
      },
    };
  }

  // ---- pricing (FR-03, BR-01) --------------------------------------------------------------------------------------------------------------
  /** One item priced: its cost rate from the analysis, the components or as typed; then the selling rate and the amounts. Problems are collected with the item's position. */
  function priceItem(actor, e, it, i, p) {
    const at = (f) => `items.${i}.${f}`;
    const out = { section_code: String(it.sectionCode ?? '').trim(), section_name: it.sectionName?.trim() || null, item_no: String(it.itemNo ?? '').trim(), sort_order: i + 1, description: String(it.description ?? '').trim(), uom: String(it.uom ?? '').trim().toUpperCase(), qty: units(it.qty ?? '0', 'quantity'), client_rate: it.clientRate == null || it.clientRate === '' ? null : units(it.clientRate, 'rate'), work_item_id: it.workItemId ?? null, build_mode: it.mode ?? 'RATE', analysis_id: null, markup_pct: units(it.markupPct ?? '0', 'percent'), remarks: it.notes?.trim() || null, components: [] };
    if (!out.section_code) p.push({ field: at('sectionCode'), message: 'Give the section of the item' });
    if (!out.item_no) p.push({ field: at('itemNo'), message: 'Give the item number of the BOQ' });
    if (!out.description) p.push({ field: at('description'), message: 'Describe the item' });
    if (!out.uom) p.push({ field: at('uom'), message: 'Give the unit' });
    if (out.work_item_id && !db.prepare('SELECT 1 FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(out.work_item_id, actor.companyId)) p.push({ field: at('workItemId'), message: 'Choose an item of your company' });
    let cost = dec(0);
    if (out.build_mode === 'ANALYSIS') {
      let a = null;
      if (!it.analysisId) p.push({ field: at('analysisId'), message: 'Choose the rate analysis that prices the item' });
      else { try { a = R().analyses.get(actor, Number(it.analysisId)); } catch { a = null; } if (!a) p.push({ field: at('analysisId'), message: 'Choose a rate analysis of your company' }); }
      if (a && !['APPROVED', 'SUPERSEDED'].includes(a.status)) { p.push({ field: at('analysisId'), message: `${a.ref} is ${a.statusLabel.toLowerCase()}: an estimate is priced from released analyses` }); a = null; }
      if (a && out.uom && a.basisUom && a.basisUom.toUpperCase() !== out.uom) p.push({ field: at('uom'), message: `${a.ref} prices per ${a.basisUom}; the item is in ${out.uom}` });
      if (a) {
        out.analysis_id = a.id; out.work_item_id = out.work_item_id ?? a.workItem?.id ?? null;
        // the direct cost per unit of the analysis (its components with wastage, without the analysis' own add-ons: the estimate adds its markup and its indirects)
        cost = dec(ev('ra.unit_rate', { direct_cost: a.directCost, basis_qty: a.basisQty, water_percent: '0', overhead_percent: '0', profit_percent: '0', contingency_percent: '0', insurance_percent: '0', escalation_percent: '0', gst_percent: '0' }).unit_rate);
      }
    } else if (out.build_mode === 'MANUAL') {
      const lines = it.components ?? [];
      if (!lines.length) p.push({ field: at('components'), message: 'A manual build-up has at least one component' });
      lines.forEach((l, k) => {
        const lat = (f) => `items.${i}.components.${k}.${f}`;
        let item = null; if (l.itemId) { item = db.prepare('SELECT id, code, name, base_uom FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(l.itemId, actor.companyId); if (!item) p.push({ field: lat('itemId'), message: 'is not an item of your company' }); }
        const uom = String(l.uom ?? item?.base_uom ?? '').trim().toUpperCase(); if (!uom) p.push({ field: lat('uom'), message: 'Give the unit of the component' });
        let rate = l.rate; let origin = 'MANUAL'; let rateId = null;
        if (item && (rate == null || rate === '')) {
          const lib = R().rateFor(actor.companyId, item.id, { region: e.region_code, projectId: e.project_id, date: e.basis_date });
          if (!lib) p.push({ field: lat('rate'), message: `The library has no rate of ${item.code} on ${e.basis_date}${e.region_code ? ` for ${e.region_code}` : ''}; type one` });
          else if (lib.uom !== uom) p.push({ field: lat('uom'), message: `The library rate of ${item.code} is per ${lib.uom}` });
          else { rate = lib.rate; origin = 'LIBRARY'; rateId = lib.id; }
        } else if (rate == null || rate === '') p.push({ field: lat('rate'), message: 'Give the rate of a component that is not an item' });
        const description = String(l.description ?? '').trim() || item?.name || ''; if (!description) p.push({ field: lat('description'), message: 'Describe the component' });
        const type = l.type ?? 'MATERIAL'; if (!COMPONENT_TYPES[type]) p.push({ field: lat('type'), message: 'Choose the kind of component' });
        if (rate == null || rate === '') return;
        const amt = ev('ra.line_amount', { quantity: String(l.qty ?? '0'), wastage_percent: '0', rate: String(rate) }).amount;
        cost = cost.add(dec(amt));
        out.components.push({ line_no: k + 1, component_type: type, component_item_id: item?.id ?? null, description, uom, qty_per_unit: units(l.qty ?? '0', 'quantity'), rate: units(rate, 'rate'), amount: units(amt, 'money'), line_origin: origin, resource_rate_id: rateId });
      });
    } else if (out.build_mode === 'RATE') {
      if (it.costRate == null || it.costRate === '') p.push({ field: at('costRate'), message: 'Give the cost rate, choose a rate analysis or build the rate up' });
      else cost = dec(String(it.costRate));
    } else p.push({ field: at('mode'), message: 'Price the item from a rate analysis, a manual build-up or a typed cost rate' });
    const r = ev('est.item_rate', { quantity: num(out.qty, 'quantity'), cost_rate: cost.round(4).toFixed(4), markup_percent: num(out.markup_pct, 'percent') });
    return { ...out, cost_rate: units(cost.round(4).toFixed(4), 'rate'), selling_rate: units(r.selling_rate, 'money'), cost_amount: units(r.cost_amount, 'money'), amount: units(r.amount, 'money'), priced_at: nowIso() };
  }
  function writeItems(actor, e, priced, { replace }) {
    const now = nowIso();
    if (replace) {
      db.prepare('UPDATE est_item_components SET deleted_at = ?, deleted_by = ? WHERE estimate_item_id IN (SELECT id FROM est_estimate_items WHERE estimate_id = ?) AND deleted_at IS NULL').run(now, actor.user, e.id);
      db.prepare('UPDATE est_estimate_items SET deleted_at = ?, deleted_by = ? WHERE estimate_id = ? AND deleted_at IS NULL').run(now, actor.user, e.id);
    }
    const start = replace ? 0 : (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM est_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL').get(e.id).n);
    for (const [k, x] of priced.entries()) {
      const id = Number(db.prepare(`INSERT INTO est_estimate_items (company_id, estimate_id, ${ITEM_COLS.join(', ')}, created_by, source_type, source_id) VALUES (?, ?, ${ITEM_COLS.map(() => '?').join(', ')}, ?, 'est_estimate', ?)`)
        .run(e.company_id, e.id, ...ITEM_COLS.map((col) => (col === 'sort_order' ? start + k + 1 : x[col] ?? null)), actor.user, String(e.id)).lastInsertRowid);
      for (const c of x.components) db.prepare("INSERT INTO est_item_components (company_id, estimate_item_id, line_no, component_type, component_item_id, description, uom, qty_per_unit, rate, amount, line_origin, resource_rate_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate_item')")
        .run(e.company_id, id, c.line_no, c.component_type, c.component_item_id, c.description, c.uom, c.qty_per_unit, c.rate, c.amount, c.line_origin, c.resource_rate_id, actor.user);
    }
  }
  /** The totals of the estimate (FR-04, FR-05, FR-08): the indirects that are a percentage of the direct cost follow it; the risks give the contingency; the engine does the rest. */
  function retotal(actor, e) {
    const sums = db.prepare('SELECT COALESCE(SUM(cost_amount), 0) AS cost, COALESCE(SUM(amount), 0) AS selling FROM est_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL').get(e.id);
    const direct = money(sums.cost);
    let indirect = dec(0);
    for (const x of indirectsOf(e.id)) {
      let amt = money(x.amount);
      if (x.basis === 'PERCENT') { amt = ev('est.percent_amount', { base: direct, percent: num(x.percent, 'percent') }).amount; db.prepare('UPDATE est_indirects SET amount = ? WHERE id = ?').run(units(amt, 'money'), x.id); }
      indirect = indirect.add(dec(amt));
    }
    const risk = money(db.prepare('SELECT COALESCE(SUM(exposure), 0) AS n FROM est_risks WHERE estimate_id = ? AND deleted_at IS NULL').get(e.id).n);
    const t = ev('est.estimate_total', { direct_cost: direct, indirect_cost: indirect.toFixed(2), risk_amount: risk, overhead_percent: num(e.ho_overhead_pct, 'percent'), contingency_percent: num(e.contingency_pct, 'percent'), escalation_percent: num(e.escalation_pct, 'percent'), selling_amount: money(sums.selling), gst_percent: num(e.gst_pct, 'percent') }, { id: e.id, field: 'totals', companyId: e.company_id, user: actor.user });
    db.prepare('UPDATE est_estimates SET direct_cost = ?, indirect_cost = ?, overhead_amount = ?, risk_amount = ?, contingency_amount = ?, escalation_amount = ?, total_cost = ?, total_selling = ?, margin_amount = ?, margin_pct = ?, gst_amount = ?, bid_value = ?, breakdown_json = ?, calculated_at = ? WHERE id = ?')
      .run(sums.cost, units(indirect.toFixed(2), 'money'), units(t.overhead, 'money'), units(risk, 'money'), units(t.contingency, 'money'), units(t.escalation, 'money'), units(t.total_cost, 'money'), sums.selling, units(t.margin, 'money'), units(t.margin_percent, 'percent'), units(t.gst, 'money'), units(t.bid_value, 'money'), JSON.stringify({ ...t, direct_cost: direct, indirect_cost: indirect.toFixed(2), risk_amount: risk, selling_amount: money(sums.selling), formula: 'est.estimate_total' }), nowIso(), e.id);
  }
  /** A change to a draft: the estimate is the actor's, editable, and at the version the actor saw (409 otherwise). */
  function editable(actor, id, version) {
    const e = row(actor, id); need(actor, 'est.estimate.edit', 'change estimates');
    if (!['DRAFT', 'RETURNED'].includes(e.status)) throw new HttpError(409, 'LOCKED', `${e.doc_no}/v${e.version_no} is ${STATUS[e.status].toLowerCase()}; a change is a new version.`);
    if (!same(e.created_by, actor.user)) throw forbidden('Only the estimator who made this version changes it; make a new version.');
    if (version != null && version !== e.version) throw conflict(`The estimate was changed by someone else (version ${e.version}, you had ${version}); reload it.`);
    if (!seesProject(actor, 'est.estimate.edit', e.project_id)) throw notFound('That estimate does not exist or is not yours to see.');
    return e;
  }
  const bump = (actor, id) => db.prepare('UPDATE est_estimates SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), id);
  const HEAD = [['hoOverheadPct', 'ho_overhead_pct', 'percent'], ['contingencyPct', 'contingency_pct', 'percent'], ['escalationPct', 'escalation_pct', 'percent'], ['gstPct', 'gst_pct', 'percent']];
  function headerProblems(actor, b, isNew) {
    const p = [];
    if (isNew) {
      if (!b.tenderId && !b.projectId) p.push({ field: 'tenderId', message: 'An estimate is for a tender or a project' });
      if (b.tenderId) { let t; try { t = tendersOf(db)?.tenderRow(actor, b.tenderId) ?? null; } catch { t = null; } if (!t) p.push({ field: 'tenderId', message: 'Choose a tender of your company that you can see' }); else if (t.status !== 'APPROVED') p.push({ field: 'tenderId', message: 'The registration of the tender is not approved yet' }); }
      if (b.projectId) { if (!db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.projectId, actor.companyId)) p.push({ field: 'projectId', message: 'Choose a project of your company' }); else if (!seesProject(actor, 'est.estimate.create', b.projectId)) p.push({ field: 'projectId', message: 'The project is outside your assignments' }); }
    }
    if (b.region && !db.prepare("SELECT 1 FROM mdm_states WHERE code = ? AND deleted_at IS NULL").get(b.region)) p.push({ field: 'region', message: 'Choose a state of the states master' });
    if (b.basisDate && b.basisDate > today()) p.push({ field: 'basisDate', message: 'The basis date of the rates is today or earlier' });
    return p;
  }

  const nextNo = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: ESTIMATE_DOC, actor: actor.user, refType: 'est_estimates' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    let k = db.prepare('SELECT COUNT(DISTINCT doc_no) AS n FROM est_estimates WHERE company_id = ?').get(actor.companyId).n + 1; let no = `EST-${String(k).padStart(5, '0')}`;
    while (db.prepare('SELECT 1 FROM est_estimates WHERE company_id = ? AND doc_no = ?').get(actor.companyId, no)) { k += 1; no = `EST-${String(k).padStart(5, '0')}`; }
    return no;
  };
  /** Copies a version (items, components, indirects, risks) into a new draft version of the same estimate (FR-07). */
  function copyInto(actor, from, reason) {
    const v = db.prepare('SELECT MAX(version_no) AS n FROM est_estimates WHERE company_id = ? AND doc_no = ?').get(from.company_id, from.doc_no).n + 1;
    const id = Number(db.prepare("INSERT INTO est_estimates (company_id, doc_no, version_no, title, tender_id, project_id, basis_date, region_code, currency_code, ho_overhead_pct, contingency_pct, escalation_pct, gst_pct, status, supersedes_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'est_estimate', ?, ?)")
      .run(from.company_id, from.doc_no, v, from.title, from.tender_id, from.project_id, from.basis_date, from.region_code, from.currency_code, from.ho_overhead_pct, from.contingency_pct, from.escalation_pct, from.gst_pct, from.id, actor.user, String(from.id), reason ?? null).lastInsertRowid);
    for (const i of itemsOf(from.id)) {
      const nid = Number(db.prepare(`INSERT INTO est_estimate_items (company_id, estimate_id, ${ITEM_COLS.join(', ')}, created_by, source_type, source_id) VALUES (?, ?, ${ITEM_COLS.map(() => '?').join(', ')}, ?, 'est_estimate_item', ?)`).run(i.company_id, id, ...ITEM_COLS.map((c) => i[c] ?? null), actor.user, String(i.id)).lastInsertRowid);
      for (const c of componentsOf(i.id)) db.prepare("INSERT INTO est_item_components (company_id, estimate_item_id, line_no, component_type, component_item_id, description, uom, qty_per_unit, rate, amount, line_origin, resource_rate_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate_item')").run(c.company_id, nid, c.line_no, c.component_type, c.component_item_id, c.description, c.uom, c.qty_per_unit, c.rate, c.amount, c.line_origin, c.resource_rate_id, actor.user);
    }
    for (const x of indirectsOf(from.id)) db.prepare("INSERT INTO est_indirects (company_id, estimate_id, sort_order, category, description, basis, qty, rate, percent, amount, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate')").run(x.company_id, id, x.sort_order, x.category, x.description, x.basis, x.qty, x.rate, x.percent, x.amount, actor.user);
    for (const x of risksOf(from.id)) db.prepare("INSERT INTO est_risks (company_id, estimate_id, sort_order, description, impact, probability_pct, exposure, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate')").run(x.company_id, id, x.sort_order, x.description, x.impact, x.probability_pct, x.exposure, actor.user);
    const e = db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(id); retotal(actor, e);
    writeAudit(db, { entity: 'est_estimates', entityId: id, action: 'version', newValues: { from: `${from.doc_no}/v${from.version_no}`, versionNo: v }, reason: reason ?? null, actor: actor.user, companyId: from.company_id });
    return id;
  }
  /** BOQ rows (FR-02) checked as items without a price yet: they keep the client's rate and are priced later. */
  function boqRows(rows, existing) {
    const p = []; const seen = new Set(existing);
    const out = rows.map((r, i) => {
      const at = (f) => `rows.${i}.${f}`; const itemNo = String(r.itemNo ?? '').trim();
      if (!String(r.sectionCode ?? '').trim()) p.push({ field: at('sectionCode'), message: `Row ${i + 1}: give the section` });
      if (!itemNo) p.push({ field: at('itemNo'), message: `Row ${i + 1}: give the item number` }); else if (seen.has(itemNo.toLowerCase())) p.push({ field: at('itemNo'), message: `Row ${i + 1}: item ${itemNo} is already in the estimate` }); else seen.add(itemNo.toLowerCase());
      if (!String(r.description ?? '').trim()) p.push({ field: at('description'), message: `Row ${i + 1}: describe the item` });
      if (!String(r.uom ?? '').trim()) p.push({ field: at('uom'), message: `Row ${i + 1}: give the unit` });
      const q = Number(String(r.qty ?? '').replace(/,/g, '')); if (!Number.isFinite(q) || q < 0) p.push({ field: at('qty'), message: `Row ${i + 1}: the quantity is a number of zero or more` });
      const cr = r.clientRate == null || r.clientRate === '' ? null : Number(String(r.clientRate).replace(/,/g, '')); if (cr != null && (!Number.isFinite(cr) || cr < 0)) p.push({ field: at('clientRate'), message: `Row ${i + 1}: the client's rate is a number` });
      return { sectionCode: String(r.sectionCode ?? '').trim(), sectionName: r.sectionName ? String(r.sectionName).trim() : null, itemNo, description: String(r.description ?? '').trim(), uom: String(r.uom ?? '').trim().toUpperCase(), qty: Number.isFinite(q) ? String(String(r.qty).replace(/,/g, '')).trim() : '0', clientRate: cr == null ? null : String(cr) };
    });
    return { rows: out, problems: p };
  }

  /** FR-06: the materials, labour and plant of every item (from its analysis or its build-up) times its quantity. */
  function resourcesOf(actor, e, { type = null } = /** @type {any} */ ({})) {
    const c = costs(actor); const by = new Map();
    const add = (k, t, itemId, code, description, uom, qty, rate) => { const x = by.get(k) ?? { type: t, itemId, itemCode: code, description, uom, qty: dec(0), amount: dec(0), items: 0 }; x.qty = x.qty.add(qty); x.amount = x.amount.add(qty.mul(rate ?? '0')); x.items += 1; by.set(k, x); };
    const analyses = new Map();
    for (const i of itemsOf(e.id)) {
      const q = dec(num(i.qty, 'quantity'));
      if (i.build_mode === 'ANALYSIS' && i.analysis_id) {
        let a = analyses.get(i.analysis_id); if (a === undefined) { try { a = R().analyses.get(actor, i.analysis_id); } catch { a = db.prepare('SELECT basis_qty FROM ra_analyses WHERE id = ?').get(i.analysis_id) ? { basisQty: num(db.prepare('SELECT basis_qty FROM ra_analyses WHERE id = ?').get(i.analysis_id).basis_qty, 'quantity'), lines: db.prepare('SELECT l.*, m.code AS item_code FROM ra_analysis_lines l LEFT JOIN mdm_items m ON m.id = l.component_item_id WHERE l.analysis_id = ? AND l.deleted_at IS NULL').all(i.analysis_id).map((l) => ({ type: l.component_type, itemId: l.component_item_id, itemCode: l.item_code, description: l.description, uom: l.uom, qty: num(l.qty_per_basis, 'quantity'), wastagePct: num(l.wastage_pct, 'percent'), rate: num(l.rate, 'rate') })) } : null; } analyses.set(i.analysis_id, a); }
        if (!a) continue;
        for (const l of a.lines) { const per = dec(l.qty).mul(dec(1).add(dec(l.wastagePct ?? '0').div(100, 12))).div(dec(a.basisQty), 12); add(`${l.type}|${l.itemId ?? l.description}|${l.uom}`, l.type, l.itemId, l.itemCode, l.description, l.uom, per.mul(q), l.rate); }
      } else if (i.build_mode === 'MANUAL') for (const x of componentsOf(i.id)) add(`${x.component_type}|${x.component_item_id ?? x.description}|${x.uom}`, x.component_type, x.component_item_id, x.item_code, x.description, x.uom, dec(num(x.qty_per_unit, 'quantity')).mul(q), num(x.rate, 'rate'));
    }
    const rows = [...by.values()].filter((x) => !type || x.type === type).sort((p, q) => Object.keys(COMPONENT_TYPES).indexOf(p.type) - Object.keys(COMPONENT_TYPES).indexOf(q.type) || String(p.description).localeCompare(String(q.description)))
      .map((x) => ({ type: x.type, typeLabel: COMPONENT_TYPES[x.type], itemId: x.itemId, itemCode: x.itemCode, description: x.description, uom: x.uom, qty: x.qty.round(3).toFixed(3), amount: c ? x.amount.round(2).toFixed(2) : null, items: x.items }));
    const byType = Object.keys(COMPONENT_TYPES).map((t) => ({ type: t, label: COMPONENT_TYPES[t], lines: rows.filter((r) => r.type === t).length, amount: c ? rows.filter((r) => r.type === t).reduce((s, r) => s.add(dec(r.amount)), dec(0)).toFixed(2) : null })).filter((x) => x.lines);
    const sumOf = (pred) => rows.filter(pred).reduce((s, r) => s.add(dec(r.qty)), dec(0)).round(3).toFixed(3);
    const headline = { cementMt: sumOf((r) => r.type === 'MATERIAL' && /cement/i.test(r.description) && r.uom === 'MT'), steelMt: sumOf((r) => r.type === 'MATERIAL' && /steel|reinforcement|tmt/i.test(r.description) && r.uom === 'MT'), labourManDays: sumOf((r) => r.type === 'LABOUR' && ['DAY', 'MANDAY', 'MD'].includes(r.uom)), plantHours: sumOf((r) => r.type === 'EQUIPMENT' && ['HR', 'HOUR'].includes(r.uom)), plantDays: sumOf((r) => r.type === 'EQUIPMENT' && r.uom === 'DAY') };
    return { estimate: { id: e.id, ref: `${e.doc_no}/v${e.version_no}`, title: e.title, status: e.status }, rows, byType, headline, costsVisible: c };
  }

  // ---- the API of the service --------------------------------------------------------------------------------------------------------------
  const estimates = {
    list(actor, query) {
      need(actor, 'est.estimate.view', 'see estimates'); const s = scopeSql(actor); const c = costs(actor);
      return runList(db, estimateList, parseListRequest(estimateList, query), { select: 'e.*', scopeSql: s.sql, params: s.params, tieBreaker: 'e.id', map: (e) => { const v = view(actor, e); return { id: v.id, docNo: v.docNo, versionNo: v.versionNo, ref: v.ref, title: v.title, tender: v.tender?.docNo ?? null, tenderId: v.tenderId, project: v.project?.name ?? null, projectId: v.projectId, basisDate: v.basisDate, region: v.region, status: v.status, statusLabel: v.statusLabel, totalSelling: v.totals.selling, totalCost: c ? v.totals.totalCost : null, marginPct: c ? v.totals.marginPct : null, bidValue: v.totals.bidValue, rowVersion: v.rowVersion }; } });
    },
    exportSource(actor, req) {
      need(actor, 'est.estimate.export', 'export estimates'); const s = scopeSql(actor); const c = costs(actor); const opts = { select: 'e.*', scopeSql: s.sql, params: s.params, tieBreaker: 'e.id' };
      const cols = Object.entries(estimateList.columns).filter(([k]) => c || !SENSITIVE.includes(k));
      return { title: estimateList.label, permission: 'est.estimate.export', personal: false, columns: cols.map(([key, x]) => ({ key, label: x.label, type: x.type === 'enum' ? 'text' : x.type })), count: () => countList(db, estimateList, req, opts),
        rows: () => runList(db, estimateList, req, { ...opts, limit: null, map: (e) => { const v = view(actor, e); return { docNo: v.docNo, versionNo: v.versionNo, title: v.title, tender: v.tender?.docNo ?? '', project: v.project?.name ?? '', basisDate: v.basisDate, region: v.region ?? '', status: v.statusLabel, totalSelling: v.totals.selling, ...(c ? { totalCost: v.totals.totalCost, marginPct: v.totals.marginPct } : {}), bidValue: v.totals.bidValue }; } }).data,
        describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${estimateList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    hidden: (actor) => (costs(actor) ? [] : SENSITIVE),
    get(actor, id) { need(actor, 'est.estimate.view', 'see estimates'); return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      need(actor, 'est.estimate.create', 'make estimates');
      fail(headerProblems(actor, b, true));
      const t = b.tenderId ? tenderOf(b.tenderId) : null;
      return transaction(db, () => {
        const no = nextNo(actor);
        const vals = Object.fromEntries(HEAD.map(([k, col, kind]) => [col, units(b[k] ?? (k === 'gstPct' ? '18' : '0'), kind)]));
        const id = Number(db.prepare("INSERT INTO est_estimates (company_id, doc_no, version_no, title, tender_id, project_id, basis_date, region_code, currency_code, ho_overhead_pct, contingency_pct, escalation_pct, gst_pct, status, created_by, source_type, source_id) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)")
          .run(actor.companyId, no, b.title?.trim() || t?.name_of_work || 'Estimate', b.tenderId ?? null, b.projectId ?? null, b.basisDate ?? today(), b.region ?? null, b.currency ?? 'INR', vals.ho_overhead_pct, vals.contingency_pct, vals.escalation_pct, vals.gst_pct, actor.user, b.tenderId ? 'tdr_tender' : 'org_project', String(b.tenderId ?? b.projectId)).lastInsertRowid);
        writeAudit(db, { entity: 'est_estimates', entityId: id, action: 'create', newValues: { docNo: no, tenderId: b.tenderId ?? null, projectId: b.projectId ?? null }, actor: actor.user, companyId: actor.companyId });
        event('est.estimate.created', actor, id, actor.companyId, { estimateId: id, docNo: no, versionNo: 1, tenderId: b.tenderId ?? null, projectId: b.projectId ?? null });
        return estimates.get(actor, id);
      });
    },
    update(actor, id, b) {
      const e = editable(actor, id, b.version); fail(headerProblems(actor, b, false));
      return transaction(db, () => {
        const sets = []; const vals = [];
        for (const [k, col] of [['title', 'title'], ['basisDate', 'basis_date'], ['region', 'region_code'], ['currency', 'currency_code']]) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(k === 'title' ? String(b[k]).trim() : b[k] || null); }
        for (const [k, col, kind] of HEAD) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(units(b[k], kind)); }
        if (sets.length) db.prepare(`UPDATE est_estimates SET ${sets.join(', ')} WHERE id = ?`).run(...vals, e.id);
        bump(actor, e.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id));
        writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'update', newValues: b, actor: actor.user, companyId: e.company_id });
        return estimates.get(actor, e.id);
      });
    },
    remove(actor, id) {
      const e = row(actor, id); need(actor, 'est.estimate.delete', 'delete estimates');
      if (e.status !== 'DRAFT' || !same(e.created_by, actor.user)) throw unprocessable('Only a draft version is deleted, by the estimator who made it.');
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE est_estimates SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(now, actor.user, e.id); writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'delete', actor: actor.user, companyId: e.company_id }); return { id: e.id, deleted: true }; });
    },
    /** FR-02, FR-03: the items grid saved whole; every item is priced on the server. */
    putItems(actor, id, { items, version }) {
      const e = editable(actor, id, version); const p = [];
      const priced = items.map((it, i) => priceItem(actor, e, it, i, p));
      const nos = new Map(); priced.forEach((x, i) => { const k = x.item_no.toLowerCase(); if (k && nos.has(k)) p.push({ field: `items.${i}.itemNo`, message: `Item ${x.item_no} is listed twice (also row ${nos.get(k) + 1})` }); nos.set(k, i); });
      fail(p);
      return transaction(db, () => { writeItems(actor, e, priced, { replace: true }); bump(actor, e.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id)); writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'items', newValues: { items: priced.length }, actor: actor.user, companyId: e.company_id }); return estimates.get(actor, e.id); });
    },
    /** FR-02: rows of the client BOQ (pasted from Excel or from the import) checked, then added as unpriced items. */
    importBoq(actor, id, { rows, commit = false, replace = false, version }) {
      const e = editable(actor, id, version); need(actor, 'est.estimate.import', 'import BOQs');
      const existing = replace ? [] : itemsOf(e.id).map((i) => i.item_no.toLowerCase());
      const out = boqRows(rows, existing);
      const summary = { rows: out.rows.length, sections: [...new Set(out.rows.map((r) => r.sectionCode))].length, problems: out.problems };
      if (!commit || out.problems.length) return { ...summary, committed: false, preview: out.rows.slice(0, 200) };
      return transaction(db, () => {
        const priced = out.rows.map((r, i) => priceItem(actor, e, { ...r, mode: 'RATE', costRate: '0' }, i, []));
        writeItems(actor, e, priced, { replace }); bump(actor, e.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id));
        writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'import_boq', newValues: { rows: priced.length, replace }, actor: actor.user, companyId: e.company_id });
        event('est.estimate.boq_imported', actor, e.id, e.company_id, { estimateId: e.id, docNo: e.doc_no, versionNo: e.version_no, rows: priced.length });
        return { ...summary, committed: true, estimate: estimates.get(actor, e.id) };
      });
    },
    /** One BOQ row added by the Excel import (04.13), in the import's transaction. */
    importRow(actor, { estimateNo, versionNo, row: r }) {
      const e = db.prepare('SELECT * FROM est_estimates WHERE company_id = ? AND doc_no = ? AND version_no = ? AND deleted_at IS NULL').get(actor.companyId, estimateNo, Number(versionNo ?? 1));
      if (!e) throw unprocessable(`Estimate ${estimateNo}/v${versionNo ?? 1} does not exist`);
      const ed = editable(actor, e.id, null); need(actor, 'est.estimate.import', 'import BOQs');
      const out = boqRows([r], itemsOf(ed.id).map((i) => i.item_no.toLowerCase())); if (out.problems.length) throw unprocessable(out.problems.map((x) => x.message).join('; '));
      writeItems(actor, ed, [priceItem(actor, ed, { ...out.rows[0], mode: 'RATE', costRate: '0' }, 0, [])], { replace: false }); bump(actor, ed.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(ed.id));
      return { id: ed.id, ref: `${ed.doc_no}/v${ed.version_no} ${out.rows[0].itemNo}` };
    },
    /** FR-04: the indirect costs sheet. */
    putIndirects(actor, id, { lines, version }) {
      const e = editable(actor, id, version); const p = [];
      const rows = lines.map((l, i) => {
        const at = (f) => `lines.${i}.${f}`; let amount = '0';
        if (!INDIRECTS[l.category]) p.push({ field: at('category'), message: 'Choose the kind of indirect cost' });
        if (!String(l.description ?? '').trim()) p.push({ field: at('description'), message: 'Describe the indirect cost' });
        if (l.basis === 'LUMP_SUM') { if (l.amount == null || l.amount === '') p.push({ field: at('amount'), message: 'Give the amount' }); else amount = String(l.amount); }
        else if (l.basis === 'QTY_RATE') { if (l.qty == null || l.rate == null || l.qty === '' || l.rate === '') p.push({ field: at('rate'), message: 'Give the quantity (months, numbers) and the rate' }); else amount = ev('boq.line_amount', { quantity: String(l.qty), rate: String(l.rate) }).amount; }
        else if (l.basis === 'PERCENT') { if (l.percent == null || l.percent === '') p.push({ field: at('percent'), message: 'Give the percentage of the direct cost' }); }
        else p.push({ field: at('basis'), message: 'Choose how the cost is worked out' });
        return { category: l.category, description: String(l.description ?? '').trim(), basis: l.basis, qty: l.basis === 'QTY_RATE' ? units(l.qty, 'quantity') : null, rate: l.basis === 'QTY_RATE' ? units(l.rate, 'rate') : null, percent: l.basis === 'PERCENT' ? units(l.percent, 'percent') : null, amount: units(amount, 'money') };
      });
      fail(p);
      return transaction(db, () => {
        db.prepare('UPDATE est_indirects SET deleted_at = ?, deleted_by = ? WHERE estimate_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, e.id);
        rows.forEach((x, k) => db.prepare("INSERT INTO est_indirects (company_id, estimate_id, sort_order, category, description, basis, qty, rate, percent, amount, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate')").run(e.company_id, e.id, k + 1, x.category, x.description, x.basis, x.qty, x.rate, x.percent, x.amount, actor.user));
        bump(actor, e.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id)); writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'indirects', newValues: { lines: rows.length }, actor: actor.user, companyId: e.company_id });
        return estimates.get(actor, e.id);
      });
    },
    /** FR-05: the risks; their exposure (impact x probability) is the contingency, with the percentage of the header on top. */
    putRisks(actor, id, { lines, version }) {
      const e = editable(actor, id, version); const p = [];
      const rows = lines.map((l, i) => {
        if (!String(l.description ?? '').trim()) p.push({ field: `lines.${i}.description`, message: 'Describe the risk' });
        const exposure = ev('est.percent_amount', { base: String(l.impact ?? '0'), percent: String(l.probabilityPct ?? '0') }).amount;
        return { description: String(l.description ?? '').trim(), impact: units(l.impact ?? '0', 'money'), probability: units(l.probabilityPct ?? '0', 'percent'), exposure: units(exposure, 'money') };
      });
      fail(p);
      return transaction(db, () => {
        db.prepare('UPDATE est_risks SET deleted_at = ?, deleted_by = ? WHERE estimate_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, e.id);
        rows.forEach((x, k) => db.prepare("INSERT INTO est_risks (company_id, estimate_id, sort_order, description, impact, probability_pct, exposure, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate')").run(e.company_id, e.id, k + 1, x.description, x.impact, x.probability, x.exposure, actor.user));
        bump(actor, e.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id)); writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'risks', newValues: { lines: rows.length }, actor: actor.user, companyId: e.company_id });
        return estimates.get(actor, e.id);
      });
    },
    /** BR-01: the items priced from an analysis that has a newer released version are re-priced from it (all of them, or the ones named). */
    reprice(actor, id, { itemIds, version }) {
      const e = editable(actor, id, version);
      const items = itemsOf(e.id); const p = []; let changed = 0;
      const input = items.map((i) => {
        const v = itemView(actor, i, { components: true }); const newer = newerOf(i); const pick = !itemIds || itemIds.includes(i.id);
        if (newer && pick) changed += 1;
        return { sectionCode: v.sectionCode, sectionName: v.sectionName, itemNo: v.itemNo, description: v.description, uom: v.uom, qty: v.qty, clientRate: v.clientRate, workItemId: v.workItemId, mode: v.mode, analysisId: newer && pick ? newer.id : v.analysisId, costRate: num(i.cost_rate, 'rate'), markupPct: num(i.markup_pct, 'percent'), notes: v.notes, components: (v.components ?? []).map((c) => ({ type: c.type, itemId: c.itemId, description: c.description, uom: c.uom, qty: c.qty, rate: c.origin === 'LIBRARY' && newer && pick ? null : num(componentsOf(i.id).find((x) => x.id === c.id)?.rate, 'rate') })) };
      });
      if (!changed) return { changed: 0, estimate: estimates.get(actor, e.id) };
      const priced = input.map((it, i) => priceItem(actor, e, it, i, p)); fail(p);
      return transaction(db, () => { writeItems(actor, e, priced, { replace: true }); bump(actor, e.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id)); writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'reprice', newValues: { items: changed }, actor: actor.user, companyId: e.company_id }); return { changed, estimate: estimates.get(actor, e.id) }; });
    },
    /** 09.02 FR-06: the quantities of a released take-off into the items of a draft with the same BOQ item number; each item is priced again. */
    applyQuantities(actor, id, { quantities, source }) {
      const e = editable(actor, id, null); const items = itemsOf(e.id); const p = [];
      const want = new Map(quantities.map((q) => [String(q.itemNo).toLowerCase(), q.qty]));
      const matched = []; const input = items.map((i) => {
        const v = itemView(actor, i, { components: true }); const q = want.get(i.item_no.toLowerCase());
        if (q != null && q !== num(i.qty, 'quantity')) matched.push({ itemNo: i.item_no, from: num(i.qty, 'quantity'), to: q });
        return { sectionCode: v.sectionCode, sectionName: v.sectionName, itemNo: v.itemNo, description: v.description, uom: v.uom, qty: q ?? v.qty, clientRate: v.clientRate, workItemId: v.workItemId, mode: v.mode, analysisId: v.analysisId, costRate: num(i.cost_rate, 'rate'), markupPct: num(i.markup_pct, 'percent'), notes: v.notes, components: componentsOf(i.id).map((c) => ({ type: c.component_type, itemId: c.component_item_id, description: c.description, uom: c.uom, qty: num(c.qty_per_unit, 'quantity'), rate: num(c.rate, 'rate') })) };
      });
      const unmatched = quantities.filter((q) => !items.some((i) => i.item_no.toLowerCase() === String(q.itemNo).toLowerCase())).map((q) => q.itemNo);
      if (matched.length) {
        const priced = input.map((it, i) => priceItem(actor, e, it, i, p)); fail(p);
        transaction(db, () => { writeItems(actor, e, priced, { replace: true }); bump(actor, e.id); retotal(actor, db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id)); writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'quantities', newValues: { source, items: matched.length }, actor: actor.user, companyId: e.company_id }); });
      }
      return { matched, unmatched, estimate: estimates.get(actor, e.id) };
    },
    /** FR-07: a new draft version copied from this one. */
    newVersion(actor, id, { reason = null } = /** @type {any} */ ({})) {
      const e = row(actor, id); need(actor, 'est.estimate.create', 'make estimate versions');
      if (!seesProject(actor, 'est.estimate.create', e.project_id)) throw forbidden('The project is outside your assignments.');
      if (e.status === 'APPROVED') need(actor, 'est.estimate.amend', 'amend approved estimates');
      return transaction(db, () => { const nid = copyInto(actor, e, reason); event('est.estimate.versioned', actor, nid, e.company_id, { estimateId: nid, docNo: e.doc_no, fromVersion: e.version_no }); return estimates.get(actor, nid); });
    },
    submit(actor, id) {
      const e = editable(actor, id, null); need(actor, 'est.estimate.submit', 'send estimates for approval');
      if (db.prepare("SELECT 1 FROM est_estimates WHERE company_id = ? AND doc_no = ? AND id != ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(e.company_id, e.doc_no, e.id)) throw conflict('Another version of this estimate is in approval; withdraw it first.');
      const items = itemsOf(e.id); const p = [];
      if (!items.length) p.push({ field: 'items', message: 'An estimate has at least one item' });
      const unpriced = items.filter((i) => i.qty > 0 && i.selling_rate === 0); if (unpriced.length) p.push({ field: 'items', message: `Price every item: ${unpriced.slice(0, 10).map((i) => i.item_no).join(', ')}${unpriced.length > 10 ? ` and ${unpriced.length - 10} more` : ''}` });
      const stale = items.filter((i) => newerOf(i)); if (stale.length) p.push({ field: 'items', message: `A newer released rate analysis prices ${stale.map((i) => i.item_no).join(', ')}: re-price them first (BR-01)` });
      if (p.length) throw unprocessable('The estimate is not ready for approval.', p);
      return transaction(db, () => {
        retotal(actor, e); const x = db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(e.id);
        const ctx = { valueMinor: x.bid_value, totalSelling: money(x.total_selling), marginPct: num(x.margin_pct, 'percent'), projectId: x.project_id };
        if (x.status === 'RETURNED') workflowOf(db).resubmit(actor, x.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: ESTIMATE_DOC, docId: String(x.id), comment: `${x.doc_no}/v${x.version_no}`, context: ctx }); db.prepare('UPDATE est_estimates SET workflow_instance_id = ? WHERE id = ?').run(inst.id, x.id); }
        db.prepare("UPDATE est_estimates SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), x.id);
        writeAudit(db, { entity: 'est_estimates', entityId: x.id, action: 'submit', actor: actor.user, companyId: x.company_id });
        return estimates.get(actor, x.id);
      });
    },
    withdraw(actor, id, { reason }) { const e = row(actor, id); if (e.status !== 'SUBMITTED') throw unprocessable('Only an estimate in approval is withdrawn.'); if (!same(e.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, e.workflow_instance_id, { comment: reason }); return estimates.get(actor, id); },
    cancel(actor, id, { reason }) {
      const e = row(actor, id); need(actor, 'est.estimate.cancel', 'cancel estimates');
      if (!OPEN.includes(e.status) || !same(e.created_by, actor.user)) throw unprocessable('Only an open version is cancelled, by the estimator who made it.');
      return transaction(db, () => { if (e.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, e.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE est_estimates SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), e.id); writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'cancel', reason, actor: actor.user, companyId: e.company_id }); return estimates.get(actor, id); });
    },
    history(actor, id) {
      const e = row(actor, id);
      return { approvals: e.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(e.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all('est_estimates', String(e.id)) };
    },
    /** FR-07: two versions of the same estimate, item by item (matched by the BOQ item number), and their totals. */
    compare(actor, id, withId) {
      need(actor, 'est.estimate.view', 'see estimates');
      const a = row(actor, id); const b = row(actor, withId); if (a.doc_no !== b.doc_no) throw unprocessable('Compare two versions of the same estimate.');
      const c = costs(actor); const ia = new Map(itemsOf(a.id).map((i) => [i.item_no.toLowerCase(), i])); const ib = new Map(itemsOf(b.id).map((i) => [i.item_no.toLowerCase(), i]));
      const d = (x, y, kind) => (x == null || y == null ? null : num(y - x, kind));
      const side = (i) => (i ? { qty: num(i.qty, 'quantity'), costRate: c ? num(i.cost_rate, 'rate') : null, markupPct: c ? num(i.markup_pct, 'percent') : null, sellingRate: money(i.selling_rate), amount: money(i.amount), mode: i.build_mode } : null);
      const rows = [...new Set([...ia.keys(), ...ib.keys()])].map((k) => {
        const x = ia.get(k); const y = ib.get(k); const ref = y ?? x;
        const change = !x ? 'ADDED' : !y ? 'REMOVED' : (x.qty !== y.qty || x.selling_rate !== y.selling_rate || x.cost_rate !== y.cost_rate || x.markup_pct !== y.markup_pct || x.description !== y.description) ? 'CHANGED' : 'SAME';
        return { itemNo: ref.item_no, sectionCode: ref.section_code, description: ref.description, uom: ref.uom, change, from: side(x), to: side(y), delta: { qty: d(x?.qty ?? 0, y?.qty ?? 0, 'quantity'), sellingRate: x && y ? money(y.selling_rate - x.selling_rate) : null, amount: money((y?.amount ?? 0) - (x?.amount ?? 0)), costRate: c && x && y ? num(y.cost_rate - x.cost_rate, 'rate') : null, markupPct: c && x && y ? num(y.markup_pct - x.markup_pct, 'percent') : null } };
      }).sort((p, q) => (ib.has(p.itemNo.toLowerCase()) ? [...ib.keys()].indexOf(p.itemNo.toLowerCase()) : 1e9 + [...ia.keys()].indexOf(p.itemNo.toLowerCase())) - (ib.has(q.itemNo.toLowerCase()) ? [...ib.keys()].indexOf(q.itemNo.toLowerCase()) : 1e9 + [...ia.keys()].indexOf(q.itemNo.toLowerCase())));
      const tot = (e) => ({ selling: money(e.total_selling), cost: c ? money(e.total_cost) : null, margin: c ? money(e.margin_amount) : null, marginPct: c ? num(e.margin_pct, 'percent') : null, bidValue: money(e.bid_value), indirect: c ? money(e.indirect_cost) : null });
      const totals = { from: tot(a), to: tot(b), delta: { selling: money(b.total_selling - a.total_selling), cost: c ? money(b.total_cost - a.total_cost) : null, margin: c ? money(b.margin_amount - a.margin_amount) : null, marginPct: c ? num(b.margin_pct - a.margin_pct, 'percent') : null, bidValue: money(b.bid_value - a.bid_value) } };
      return { from: { id: a.id, ref: `${a.doc_no}/v${a.version_no}`, status: a.status }, to: { id: b.id, ref: `${b.doc_no}/v${b.version_no}`, status: b.status }, rows, totals, counts: { added: rows.filter((r) => r.change === 'ADDED').length, removed: rows.filter((r) => r.change === 'REMOVED').length, changed: rows.filter((r) => r.change === 'CHANGED').length, same: rows.filter((r) => r.change === 'SAME').length }, costsVisible: c };
    },
    resources(actor, id, { type = null } = /** @type {any} */ ({})) { need(actor, 'est.estimate.view', 'see estimates'); return resourcesOf(actor, row(actor, id), { type }); },
    print(actor, id) {
      need(actor, 'est.estimate.print', 'print estimates'); const v = estimates.get(actor, id); const c = v.costsVisible;
      writeAudit(db, { entity: 'est_estimates', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const rows = v.items.map((i) => `<tr><td>${esc(i.sectionCode)}</td><td>${esc(i.itemNo)}</td><td>${esc(i.description)}</td><td>${esc(i.uom)}</td><td style="text-align:right">${esc(i.qty)}</td>${c ? `<td style="text-align:right">${esc(i.costRate)}</td><td style="text-align:right">${esc(i.markupPct)}</td>` : ''}<td style="text-align:right">${esc(i.sellingRate)}</td><td style="text-align:right">${esc(i.amount)}</td></tr>`).join('');
      const t = v.totals;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.ref)}</title><style>body{font:13px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body><h1>Estimate ${esc(v.ref)}</h1><p>${esc(v.title)} · ${esc(v.tender ? `${v.tender.docNo} ${v.tender.nameOfWork}` : v.project?.name)} · basis ${esc(v.basisDate)} · ${esc(v.statusLabel)}</p><table><thead><tr><th>Section</th><th>Item</th><th>Description</th><th>Unit</th><th>Quantity</th>${c ? '<th>Cost rate</th><th>Markup %</th>' : ''}<th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><p>Selling ₹ ${esc(t.selling)} · GST ₹ ${esc(t.gst)} · Bid value ₹ ${esc(t.bidValue)}${c ? ` · Direct ₹ ${esc(t.directCost)} · Indirect ₹ ${esc(t.indirectCost)} · Overhead ₹ ${esc(t.overhead)} · Contingency ₹ ${esc(t.contingency)} · Escalation ₹ ${esc(t.escalation)} · Total cost ₹ ${esc(t.totalCost)} · Margin ₹ ${esc(t.margin)} (${esc(t.marginPct)}%)` : ''}</p></body></html>`;
    },
    /** For other parts (09.02, 09.03, 08.03): the approved estimate of a tender. */
    approvedForTender(companyId, tenderId) { return db.prepare("SELECT * FROM est_estimates WHERE company_id = ? AND tender_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(companyId, tenderId) ?? null; },
  };

  function decide(instance, actor, outcome, comment) {
    const e = db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(rid(instance.docId));
    if (!e || !['SUBMITTED', 'RETURNED'].includes(e.status)) return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
    db.prepare('UPDATE est_estimates SET status = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, to === 'APPROVED' ? nowIso() : null, actor.user, nowIso(), e.id);
    if (withdrawn) db.prepare('UPDATE est_estimates SET workflow_instance_id = NULL WHERE id = ?').run(e.id);
    writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: e.company_id });
    if (to !== 'APPROVED') return;
    db.prepare("UPDATE est_estimates SET status = 'SUPERSEDED', updated_at = ? WHERE company_id = ? AND doc_no = ? AND id != ? AND status = 'APPROVED'").run(nowIso(), e.company_id, e.doc_no, e.id);
    const res = resourcesOf(actor, e);
    event('est.estimate.approved', actor, e.id, e.company_id, { estimateId: e.id, docNo: e.doc_no, versionNo: e.version_no, tenderId: e.tender_id, projectId: e.project_id, totalSelling: money(e.total_selling), totalCost: money(e.total_cost), marginPct: num(e.margin_pct, 'percent'), bidValue: money(e.bid_value), gst: money(e.gst_amount), resources: res.rows.map((r) => ({ type: r.type, itemId: r.itemId, itemCode: r.itemCode, description: r.description, uom: r.uom, qty: r.qty })) });
  }
  return { estimates, decide, access: (actor, id) => { const e = db.prepare('SELECT * FROM est_estimates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); return e && seesProject(actor, 'est.estimate.view', e.project_id) ? e : null; } };
}

const services = new WeakMap();
export const bindEstimates = (db, s) => services.set(db, s);
export const estimatesOf = (db) => services.get(db) ?? null;

if (!workflowResolvers.get('est.reviewer')) workflowResolvers.register('est.reviewer', ({ db, companyId, instance }) => {
  const r = db.prepare('SELECT created_by FROM est_estimates WHERE id = ?').get(rid(instance.docId));
  const out = new Set([instance.submittedBy, r?.created_by].filter(Boolean).map((x) => String(x).toLowerCase()));
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => json(u.roles_json, []).includes('EST') && !out.has(u.username.toLowerCase())).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'DIR' }];
});
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
workflowTypes.register({
  docType: ESTIMATE_DOC, label: 'Estimate', processOwner: 'EST', route: (id) => `/est/estimate?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT doc_no, version_no, title, requested_by FROM est_estimates WHERE id = ? AND company_id = ?').get(rid(id), companyId); return r ? { ref: `${r.doc_no}/v${r.version_no}`, title: r.title, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const e = db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(rid(id)); if (!e) return null; return { fields: [{ label: 'Estimate', value: `${e.doc_no}/v${e.version_no}` }, { label: 'Title', value: e.title }, { label: 'Selling', value: `₹ ${money(e.total_selling)}` }, { label: 'Total cost', value: `₹ ${money(e.total_cost)}` }, { label: 'Margin', value: `${num(e.margin_pct, 'percent')}%` }, { label: 'Bid value with GST', value: `₹ ${money(e.bid_value)}` }] }; },
  defaultDefinition: { name: 'Estimate: a colleague of the estimation team, then the director (09.03 adds the formal review)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('EST', 'Estimation review', [{ kind: 'resolver', resolver: 'est.reviewer' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }])] },
  hooks: {
    onApproved: (db, { instance, actor }) => estimatesOf(db)?.decide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => estimatesOf(db)?.decide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => estimatesOf(db)?.decide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => estimatesOf(db)?.decide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(ESTIMATE_DOC, ({ db, instance }) => {
  const e = db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(rid(instance.docId)); if (!e) return { sections: [] };
  const prev = db.prepare("SELECT * FROM est_estimates WHERE company_id = ? AND doc_no = ? AND version_no < ? AND status IN ('APPROVED', 'SUPERSEDED') AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(e.company_id, e.doc_no, e.version_no);
  const n = db.prepare('SELECT COUNT(*) AS n, SUM(build_mode = \'ANALYSIS\') AS a FROM est_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL').get(e.id);
  return { sections: [{ code: 'est-estimate', title: 'Before approving the estimate', kind: 'metrics', items: [{ label: 'Margin', value: `${num(e.margin_pct, 'percent')}%`, format: 'text' }, { label: 'Items priced from rate analyses', value: `${n.a ?? 0} of ${n.n}`, format: 'text' }, { label: 'Against the last approved version', value: prev ? `₹ ${money(e.total_selling - prev.total_selling)} selling` : 'first version', format: 'text' }] }] };
});
export { BASES, COMPONENT_TYPES, INDIRECTS, MODES };
