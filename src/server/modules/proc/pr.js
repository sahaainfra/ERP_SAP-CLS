import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { budOf } from '../bud/budgets.js';
import { PRIORITIES, d3, json, lower, nowIso, q3, rid, rs, same } from './base.js';

// Purchase requisitions (part 15.01, FR-03 to FR-06): what is to be bought, from material requests (consolidated, each line keeping its trace to the request lines), from MRP proposals (15.02) or direct with a reason. Every line carries an
// estimated rate (rate contract, last PO, budget rate, item standard, or entered), is checked against the stock of the site and nearby stores (control CP-PROC-01), the budget (12.03: a block needs an approved exception; a quantity beyond
// the budget quantity needs one too, CP-PROC-02) and other open requisitions (possible duplicates). Approval is by the value: the project manager, the project director above the first band, the procurement manager above the second.
// An emergency purchase (CP-PROC-06) goes to the project manager alone and is regularised by that approval within the hours the company allows. An approved requisition puts its lines in the commitment ledger (12.03) as a soft commitment.
export const PR_DOC = 'PROC_PR';
export const PR_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', EMERGENCY: 'Emergency (to be regularised)', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed (short-closed)', SUPERSEDED: 'Superseded by an amendment' };
export const PR_SOURCES = { MR: 'Material requests', MRP: 'MRP proposal', DIRECT: 'Direct' };
export const RATE_SOURCES = { RATE_CONTRACT: 'Rate contract', LAST_PO: 'Last purchase', BUDGET: 'Budget rate', STANDARD: 'Item standard rate', MANUAL: 'Entered' };
export const BUDGET_STATUS = { NOT_CHECKED: 'Not checked', OK: 'Within the budget', WARNING: 'Over the budget (warning)', BLOCK: 'Blocked by the budget' };
const EDITABLE = ['DRAFT', 'RETURNED'];
/** Rate contracts (11.03) are not live; a provider registered here is asked first and may return { rate (paise a unit), ref }. */
export const rateContracts = { providers: [], register(fn) { this.providers.push(fn); } };

controlRegistry.define({
  code: 'CP-PROC-01', module: 'proc', stage: 'VERIFY', description: 'No purchase requisition while free stock at the same or a nearby store covers the need, unless an exception is approved', enforcement: 'EXCEPTION', evidenceRequired: true, escalationLevel: 1, ownerRole: 'PROCMGR', mode: 'ENFORCE',
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'Free stock covers the need', details: { items: context.items ?? null, project: context.project ?? null } }),
});
controlRegistry.define({
  code: 'CP-PROC-02', module: 'proc', stage: 'VERIFY', description: 'A requisition quantity beyond the budget quantity needs an approved exception', enforcement: 'EXCEPTION', evidenceRequired: true, escalationLevel: 1, ownerRole: 'PCMGR', mode: 'ENFORCE',
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'The quantity is beyond the budget quantity', details: { items: context.items ?? null, project: context.project ?? null } }),
});
controlRegistry.define({
  code: 'CP-PROC-06', module: 'proc', stage: 'VERIFY', description: 'An emergency purchase goes ahead and is regularised by the project manager within 24 hours', enforcement: 'BLOCK', evidenceRequired: false, escalationLevel: 1, ownerRole: 'PM', mode: 'WARN', emergencyAllowed: true,
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'Emergency purchase', details: { ref: context.ref ?? null, reason: context.reason ?? null } }),
});
for (const [key, dataType, def, description, extra] of [
  ['proc.pr.band_pd_minor', 'integer', 50_000_000, 'Section 9: a requisition above this value, in paise (₹ 5 lakh), also needs the project director.', { min: 0, max: 100_000_000_000 }],
  ['proc.pr.band_procmgr_minor', 'integer', 250_000_000, 'Section 9: a requisition above this value, in paise (₹ 25 lakh), also needs the procurement manager.', { min: 0, max: 100_000_000_000 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const prList = defineList({
  code: 'proc.requisitions', label: 'Purchase requisitions', permission: 'proc.requisition.view', from: 'proc_requisitions x JOIN org_projects p ON p.id = x.org_project_id LEFT JOIN org_sites s ON s.id = x.pr_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 's.code', 'x.purpose', 'x.requested_by'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'PR no.' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.pr_site_id', type: 'number', label: 'Site id' },
    source: { sql: 'x.pr_source', type: 'enum', label: 'Source', options: Object.entries(PR_SOURCES) }, requestedBy: { sql: 'x.requested_by', type: 'text', label: 'Requested by' }, requiredBy: { sql: 'x.required_by', type: 'date', label: 'Required by' }, priority: { sql: 'x.priority', type: 'enum', label: 'Priority', options: Object.entries(PRIORITIES) },
    amount: { sql: 'x.total_amount', type: 'text', label: 'Estimated value' }, budget: { sql: 'x.budget_check_status', type: 'enum', label: 'Budget', options: Object.entries(BUDGET_STATUS) }, emergency: { sql: "CASE WHEN x.is_emergency = 1 THEN 'YES' ELSE 'NO' END", type: 'enum', label: 'Emergency', options: [['YES', 'Yes'], ['NO', 'No']] },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(PR_STATUS) },
  },
});

const RES = { MATERIAL: 'MATERIAL', CONSUMABLE: 'MATERIAL', SPARE: 'MATERIAL', TOOL: 'MATERIAL', RETURNABLE: 'MATERIAL', EQUIPMENT: 'EQUIPMENT', LABOUR: 'LABOUR', SERVICE: 'SUBCONTRACT', SUBCONTRACT: 'SUBCONTRACT' };

export function createPrService({ db, base, stock, mr }) {
  const { authz, param, may, need, fail, audit, notify, number, project, siteOf, wbsOf, codeOf, itemOf, uomOk, budgetOf } = base;
  const evt = (type, actor, r, data) => publishEvent(db, { type, entity: 'proc_requisition', entityId: r.id, actorId: actor?.user ?? 'system', companyId: r.company_id, projectId: r.org_project_id, siteId: r.pr_site_id ?? undefined, data: { prId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.pr_site_id, ...data } });
  const linesOf = (id) => db.prepare('SELECT * FROM proc_pr_lines WHERE pr_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  const sourcesOf = (lineId) => db.prepare('SELECT s.*, m.doc_no AS mr_no, m.id AS mr_id, ml.line_no AS mr_line_no FROM proc_pr_sources s JOIN proc_mr_lines ml ON ml.id = s.mr_line_id JOIN proc_material_requests m ON m.id = ml.mr_id WHERE s.pr_line_id = ? AND s.deleted_at IS NULL ORDER BY s.id').all(lineId);
  const row = (actor, id, key = 'proc.requisition.view') => {
    const r = db.prepare('SELECT * FROM proc_requisitions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'proc.requisition.view', r.org_project_id, r.pr_site_id)) throw notFound('That purchase requisition does not exist.'); if (key !== 'proc.requisition.view') need(actor, key, 'do that with a purchase requisition', r.org_project_id, r.pr_site_id); return r;
  };
  const scope = (actor) => { const f = authz.scopeFilter(actor, 'proc.requisition.view', { project: 'x.org_project_id', site: 'x.pr_site_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const sysActor = (companyId, user = 'system') => ({ user, companyId, roles: ['SYSTEM'] });

  // ---- the estimated rate (BR-01): rate contract, then the last purchase, then the budget rate, then the standard rate of the item --------------------------------------------------------------------------
  function rateFor(companyId, projectId, item, wbsId, costCodeId, vendorId = null) {
    if (item) for (const fn of rateContracts.providers) { const x = fn({ companyId, projectId, itemId: item.id, vendorId }); if (x?.rate > 0) return { rate: x.rate, source: 'RATE_CONTRACT' }; }
    if (item?.last_purchase_amount > 0) return { rate: item.last_purchase_amount, source: 'LAST_PO' };
    const b = budgetOf(projectId); if (b && costCodeId) { const l = db.prepare("SELECT rate, amount, qty FROM bud_lines WHERE budget_id = ? AND cost_code_id = ? AND deleted_at IS NULL AND line_kind = 'DIRECT' AND (? IS NULL OR wbs_id = ? OR wbs_id IS NULL) ORDER BY (wbs_id = ?) DESC, id LIMIT 1").get(b.id, costCodeId, wbsId ?? null, wbsId ?? null, wbsId ?? -1); const r = l?.rate > 0 ? l.rate : l?.qty > 0 ? Math.round((l.amount * 1000) / l.qty) : 0; if (r > 0) return { rate: r, source: 'BUDGET' }; }
    if (item?.standard_amount > 0) return { rate: item.standard_amount, source: 'STANDARD' };
    return { rate: 0, source: 'MANUAL' };
  }
  /** The lines of a requisition checked and priced again on every save and send: BR-01 (required-by not before today, a unit that fits the item, the rate), totals recomputed on the server. */
  function normalise(actor, p, h, lines) {
    const problems = []; const out = []; const today = todayIST();
    if (h.requiredBy < today) problems.push({ field: 'requiredBy', message: 'The required-by date is not before today' }); if (!lines.length) problems.push({ field: 'lines', message: 'Add at least one line' });
    lines.forEach((l, i) => {
      const at = `lines.${i}`; const item = l.itemId ? itemOf(actor.companyId, l.itemId) : null; const by = l.requiredBy ?? h.requiredBy;
      if (l.itemId && (!item || item.item_status !== 'ACTIVE')) { problems.push({ field: `${at}.itemId`, message: 'Choose an active item of the item master' }); return; }
      if (!l.itemId && !l.serviceDesc) { problems.push({ field: `${at}.serviceDesc`, message: 'Name the item, or describe the service' }); return; }
      if (item && !uomOk(item, l.uom)) problems.push({ field: `${at}.uom`, message: `Not a unit of ${item.code} (${item.base_uom} or one of its conversions)` });
      if (by < today) problems.push({ field: `${at}.requiredBy`, message: 'The required-by date is not before today' });
      const ds = l.deliverySiteId ?? h.siteId ?? null; if (ds && !siteOf(actor.companyId, p.id, ds)) problems.push({ field: `${at}.deliverySiteId`, message: 'Not a site of this project' });
      if (l.wbsId && !wbsOf(p.id, l.wbsId)) problems.push({ field: `${at}.wbsId`, message: 'Not a WBS node of this project' }); if (l.costCodeId && !codeOf(actor.companyId, l.costCodeId)) problems.push({ field: `${at}.costCodeId`, message: 'Not a cost code of this company' });
      if (l.preferredVendorId && !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(l.preferredVendorId, actor.companyId)) problems.push({ field: `${at}.preferredVendorId`, message: 'Not a business partner of this company' });
      const given = l.estRate != null; const d = given ? { rate: Math.round(Number(l.estRate) * 100), source: 'MANUAL' } : rateFor(actor.companyId, p.id, item, l.wbsId, l.costCodeId, l.preferredVendorId);
      if (d.rate <= 0) problems.push({ field: `${at}.estRate`, message: 'No rate contract, last purchase, budget or standard rate was found: enter an estimated rate' });
      const qty = q3(l.qty); out.push({ ...l, item, qty, uom: l.uom, estRate: d.rate, rateSource: d.source, amount: Math.round((qty * d.rate) / 1000), requiredBy: by, deliverySiteId: ds });
    });
    fail(problems); const total = out.reduce((n, x) => n + x.amount, 0);
    if (h.clientTotal != null && Math.round(Number(h.clientTotal) * 100) !== total) fail([{ field: 'total', message: `The total is ${rs(total)}: the value sent (${h.clientTotal}) is not accepted` }]);
    return { lines: out, total };
  }
  const saveLines = (r, lines, actor) => {
    const now = nowIso(); const old = linesOf(r.id); for (const l of old) db.prepare('UPDATE proc_pr_sources SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE pr_line_id = ? AND deleted_at IS NULL').run(now, actor.user, l.id);
    db.prepare('UPDATE proc_pr_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE pr_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); const ids = [];
    lines.forEach((l, i) => { const id = Number(db.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, service_desc, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, wbs_id, cost_code_id, spec, preferred_vendor_id, approved_makes, balance_qty, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, i + 1, l.itemId ?? null, l.serviceDesc ?? null, l.qty, l.uom, l.estRate, l.amount, l.rateSource, l.requiredBy, l.deliverySiteId ?? null, l.wbsId ?? null, l.costCodeId ?? null, l.spec ?? null, l.preferredVendorId ?? null, l.approvedMakes ?? null, l.qty, r.org_project_id, r.pr_site_id, actor.user).lastInsertRowid); ids.push(id); });
    return ids;
  };
  const retotal = (id, total) => db.prepare('UPDATE proc_requisitions SET total_amount = ? WHERE id = ?').run(total, id);

  // ---- the checks: stock, budget, duplicates (FR-04, BR-02, BR-03) -------------------------------------------------------------------------------------------------------------------------------------
  function runChecks(actor, r) {
    const ls = linesOf(r.id); const items = ls.filter((l) => l.item_id).map((l) => l.item_id); const days = Number(param(r.company_id, 'proc.pr.duplicate_days') ?? 30);
    const av = new Map(); for (const l of ls) { const site = l.delivery_site_id ?? r.pr_site_id; const k = site ?? 0; if (!av.has(k)) av.set(k, stock.availability(r.company_id, r.org_project_id, site, items)); }
    const lineChecks = ls.map((l) => { const a = l.item_id ? av.get(l.delivery_site_id ?? r.pr_site_id ?? 0)?.get(l.item_id) : null; const cover = a ? a.controlMilli : 0; const res = !l.item_id ? 'NA' : cover >= l.qty && l.qty > 0 ? 'COVERED' : cover > 0 ? 'PARTIAL' : 'NONE';
      const dup = l.item_id ? db.prepare("SELECT p.id, p.doc_no, p.status, pl.qty, pl.balance_qty FROM proc_pr_lines pl JOIN proc_requisitions p ON p.id = pl.pr_id WHERE pl.item_id = ? AND pl.pr_id <> ? AND pl.deleted_at IS NULL AND p.deleted_at IS NULL AND p.org_project_id = ? AND COALESCE(pl.delivery_site_id, 0) = ? AND p.status IN ('SUBMITTED', 'EMERGENCY', 'APPROVED') AND pl.balance_qty > 0 AND p.id <> COALESCE(?, 0) AND date(p.doc_date) >= date(?, '-' || ? || ' days')").all(l.item_id, r.id, r.org_project_id, l.delivery_site_id ?? r.pr_site_id ?? 0, r.parent_id, r.doc_date, days) : [];
      return { lineId: l.id, lineNo: l.line_no, itemId: l.item_id, stock: { result: res, freeQty: d3(cover), needQty: d3(l.qty), stores: a?.stores ?? [] }, budget: { result: 'NOT_CHECKED', message: l.cost_code_id ? null : 'No cost code: the budget is not checked for this line' }, duplicates: dup.map((x) => ({ prId: x.id, docNo: x.doc_no, status: x.status, qty: d3(x.qty), balance: d3(x.balance_qty) })) }; });
    const bud = budOf(db)?.ledger; let budgetSummary = 'NOT_CHECKED'; let exception = null;
    const checkable = ls.filter((l) => l.cost_code_id && l.est_amount > 0);
    if (bud && checkable.length) {
      const body = { projectId: r.org_project_id, stage: 'PR', lines: checkable.map((l) => ({ lineId: String(l.line_no), wbsId: l.wbs_id ?? undefined, costCodeId: l.cost_code_id, amount: l.est_amount / 100, sourceType: 'proc_pr', sourceId: String(r.id) })) };
      const res = (() => { try { return bud.check(actor, body); } catch { try { return bud.check({ user: actor.user, companyId: r.company_id, roles: ['SYSADM'] }, body); } catch { return null; } } })();
      if (res) {
        budgetSummary = res.result; exception = res.exception ?? null;
        for (const x of res.lines) { const lc = lineChecks.find((c) => String(c.lineNo) === String(x.lineId)); const l = ls.find((y) => String(y.line_no) === String(x.lineId)); if (!lc) continue; const beyond = x.budgetQty > 0 && d3(l.qty) + x.committedQty + x.actualQty > x.budgetQty;
          lc.budget = { result: x.result, resultLabel: x.resultLabel, message: x.message, budget: x.budget, committed: x.committed, actual: x.actual, available: x.available, after: x.after, over: x.over, usedPct: x.usedPct, mode: x.modeLabel, wbs: x.wbs, costCode: x.costCode, budgetQty: x.budgetQty, committedQty: x.committedQty, actualQty: x.actualQty, beyondQty: beyond, beyondBy: beyond ? Math.round((d3(l.qty) + x.committedQty + x.actualQty - x.budgetQty) * 1000) / 1000 : 0 }; }
      }
    }
    const rank = { COVERED: 3, PARTIAL: 2, NONE: 1, NA: 0 };
    return { lines: lineChecks, summary: { stock: lineChecks.reduce((w, c) => (rank[c.stock.result] > rank[w] ? c.stock.result : w), 'NA'), budget: budgetSummary, duplicates: lineChecks.reduce((n, c) => n + c.duplicates.length, 0), beyondQty: lineChecks.filter((c) => c.budget.beyondQty).length, exception }, checkedAt: nowIso() };
  }

  const view = (actor, r, { detail = false } = {}) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const s = r.pr_site_id ? db.prepare('SELECT code, name FROM org_sites WHERE id = ?').get(r.pr_site_id) : null; const can = (k) => may(actor, k, r.org_project_id, r.pr_site_id); const own = same(r.requested_by, actor.user); const cost = can('proc.requisition.cost');
    const o = {
      id: r.id, docNo: r.doc_no, date: r.doc_date, projectId: r.org_project_id, projectCode: p?.code, projectName: p?.name, siteId: r.pr_site_id, siteCode: s?.code ?? null, siteName: s?.name ?? null, source: r.pr_source, sourceLabel: PR_SOURCES[r.pr_source], directReason: r.direct_reason, requestedBy: r.requested_by, requiredBy: r.required_by, priority: r.priority, priorityLabel: PRIORITIES[r.priority], purpose: r.purpose,
      totalAmount: cost ? rs(r.total_amount) : null, canSeeCost: cost, budgetStatus: r.budget_check_status, budgetStatusLabel: BUDGET_STATUS[r.budget_check_status], isEmergency: Boolean(r.is_emergency), emergencyReason: r.emergency_reason, regulariseBy: r.regularise_by, regularisedAt: r.regularised_at, status: r.status, statusLabel: PR_STATUS[r.status], revisionNo: r.revision_no, parentId: r.parent_id,
      workflowInstanceId: r.workflow_instance_id, approvedBy: r.approved_by, approvedAt: r.approved_at, cancelReason: r.cancel_reason, closedReason: r.closed_reason, rowVersion: r.version,
      can: { edit: can('proc.requisition.edit') && EDITABLE.includes(r.status), submit: can('proc.requisition.submit') && EDITABLE.includes(r.status), withdraw: ['SUBMITTED', 'EMERGENCY'].includes(r.status) && own, cancel: can('proc.requisition.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'EMERGENCY', 'APPROVED'].includes(r.status), delete: can('proc.requisition.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('proc.requisition.amend') && r.status === 'APPROVED', close: can('proc.requisition.cancel') && r.status === 'APPROVED', approve: can('proc.requisition.approve') && ['SUBMITTED', 'EMERGENCY'].includes(r.status) && !own, print: can('proc.requisition.print'), emergency: can('proc.requisition.emergency') },
    };
    if (detail) {
      const ls = linesOf(r.id); const stored = json(r.checks_json, null);
      o.lines = ls.map((l) => { const it = l.item_id ? itemOf(r.company_id, l.item_id) : null; const w = l.wbs_id ? wbsOf(r.org_project_id, l.wbs_id) : null; const c = l.cost_code_id ? codeOf(r.company_id, l.cost_code_id) : null; const ds = l.delivery_site_id ? db.prepare('SELECT code, name FROM org_sites WHERE id = ?').get(l.delivery_site_id) : null; const v = l.preferred_vendor_id ? db.prepare('SELECT display_name, legal_name FROM mdm_partners WHERE id = ?').get(l.preferred_vendor_id) : null;
        return { id: l.id, lineNo: l.line_no, itemId: l.item_id, itemCode: it?.code ?? null, itemName: it?.name ?? l.service_desc, serviceDesc: l.service_desc, qty: d3(l.qty), uom: l.uom, estRate: cost ? rs(l.est_rate) : null, estAmount: cost ? rs(l.est_amount) : null, rateSource: l.valued_from, rateSourceLabel: RATE_SOURCES[l.valued_from], requiredBy: l.required_by, deliverySiteId: l.delivery_site_id, deliverySite: ds ? `${ds.code} ${ds.name}` : null, wbsId: l.wbs_id, wbs: w ? `${w.code} ${w.name}` : null, costCodeId: l.cost_code_id, costCode: c ? `${c.code} ${c.name}` : null,
          spec: l.spec, preferredVendorId: l.preferred_vendor_id, preferredVendor: v?.display_name ?? v?.legal_name ?? null, approvedMakes: l.approved_makes, orderedQty: d3(l.ordered_qty), balanceQty: d3(l.balance_qty), closedQty: d3(l.closed_qty),
          sources: sourcesOf(l.id).map((x) => ({ mrId: x.mr_id, mrNo: x.mr_no, mrLineNo: x.mr_line_no, qty: d3(x.qty) })) }; });
      o.checks = stored; o.warnings = [];
    }
    return o;
  };

  // ---- the master-data defaults of a header --------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const flagsOf = (actor, p, b) => {
    const problems = [];
    if (b.isEmergency) { need(actor, 'proc.requisition.emergency', 'raise an emergency purchase', p.id); if (!b.emergencyReason || b.emergencyReason.length < 10) problems.push({ field: 'emergencyReason', message: 'Say why it cannot wait for the normal approval (at least 10 characters)' }); }
    if ((b.source ?? 'DIRECT') === 'DIRECT' && (!b.directReason || b.directReason.length < 10)) problems.push({ field: 'directReason', message: 'A requisition raised without a material request needs a reason (at least 10 characters)' });
    fail(problems);
  };
  const prs = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.requisition.view').allowed) throw forbidden('You may not see purchase requisitions (permission proc.requisition.view).'); const sc = scope(actor);
      return runList(db, prList, parseListRequest(prList, query), { select: 'x.*, p.code AS pcode, s.code AS scode', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, date: x.doc_date, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.pr_site_id, source: x.pr_source, requestedBy: x.requested_by, requiredBy: x.required_by, priority: x.priority, amount: may(actor, 'proc.requisition.cost', x.org_project_id, x.pr_site_id) ? String(rs(x.total_amount)) : null, budget: x.budget_check_status, emergency: x.is_emergency ? 'YES' : 'NO', status: x.status, statusLabel: PR_STATUS[x.status] }) });
    },
    exportSource(actor, req) { return prs.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get(actor, id) { const v = view(actor, row(actor, id), { detail: true }); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    /** The panels of the object page, worked out now: stock, budget, possible duplicates. */
    checks(actor, id) { const r = row(actor, id); return runChecks(actor, r); },
    options(actor, projectId) {
      const p = project(actor, projectId, 'proc.requisition.view');
      return { projectId: p.id, sites: db.prepare("SELECT id, code, name FROM org_sites WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(p.id, actor.companyId).map((s) => ({ id: s.id, label: `${s.code} ${s.name}` })),
        wbs: db.prepare('SELECT id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL ORDER BY code').all(p.id).map((w) => ({ id: w.id, label: `${w.code} ${w.name}` })), costCodes: db.prepare('SELECT id, code, name FROM fin_cost_codes WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY code').all(actor.companyId).map((c) => ({ id: c.id, label: `${c.code} ${c.name}` })),
        vendors: db.prepare("SELECT id, display_name, legal_name FROM mdm_partners WHERE company_id = ? AND deleted_at IS NULL ORDER BY display_name LIMIT 300").all(actor.companyId).map((v) => ({ id: v.id, label: v.display_name ?? v.legal_name })), canEmergency: may(actor, 'proc.requisition.emergency', p.id), canCost: may(actor, 'proc.requisition.cost', p.id), today: todayIST() };
    },
    /** The default rate of an item for the line being filled in (BR-01). */
    rate(actor, { projectId, itemId, wbsId, costCodeId }) { const p = project(actor, projectId, 'proc.requisition.view'); const it = itemOf(actor.companyId, itemId); if (!it) throw notFound('That item does not exist.'); if (!may(actor, 'proc.requisition.cost', p.id)) return { rate: null, source: null, masked: true }; const r = rateFor(actor.companyId, p.id, it, wbsId ?? null, costCodeId ?? null); return { rate: rs(r.rate), source: r.source, sourceLabel: RATE_SOURCES[r.source], uoms: [it.base_uom, ...db.prepare('SELECT uom FROM mdm_item_uoms WHERE item_id = ? AND deleted_at IS NULL').all(it.id).map((x) => x.uom)] }; },
    create(actor, b) {
      const p = project(actor, b.projectId, 'proc.requisition.view'); need(actor, 'proc.requisition.create', 'raise a purchase requisition', p.id); const site = b.siteId ? siteOf(actor.companyId, p.id, b.siteId) : null; if (b.siteId && !site) fail([{ field: 'siteId', message: 'Not a site of this project' }]);
      flagsOf(actor, p, { ...b, source: 'DIRECT' }); const { lines, total } = normalise(actor, p, { requiredBy: b.requiredBy, siteId: site?.id ?? null, clientTotal: b.total }, b.lines);
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, PR_DOC, 'proc_requisitions', 'PR');
        const id = Number(db.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, direct_reason, requested_by, required_by, priority, purpose, total_amount, is_emergency, emergency_reason, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'DIRECT', ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(actor.companyId, no, todayIST(), p.id, site?.id ?? null, b.directReason, actor.user, b.requiredBy, b.priority ?? 'NORMAL', b.purpose ?? null, total, b.isEmergency ? 1 : 0, b.isEmergency ? b.emergencyReason : null, p.id, site?.id ?? null, actor.user).lastInsertRowid);
        db.prepare('UPDATE proc_requisitions SET root_id = id WHERE id = ?').run(id); const r = db.prepare('SELECT * FROM proc_requisitions WHERE id = ?').get(id); saveLines(r, lines, actor); audit(actor, 'proc_requisitions', id, 'create', actor.companyId, { newValues: { docNo: no, source: 'DIRECT', lines: lines.length } }); return prs.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.requisition.edit'); if (!EDITABLE.includes(r.status)) throw conflict(r.status === 'APPROVED' ? 'An approved requisition is locked: amend it.' : `${PR_STATUS[r.status]}: it is not changed now.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this requisition; reload it.');
      const p = project(actor, r.org_project_id, 'proc.requisition.view'); const siteId = 'siteId' in b ? b.siteId : r.pr_site_id; if (siteId && !siteOf(actor.companyId, p.id, siteId)) fail([{ field: 'siteId', message: 'Not a site of this project' }]);
      const emergency = 'isEmergency' in b ? b.isEmergency : Boolean(r.is_emergency); flagsOf(actor, p, { isEmergency: emergency, emergencyReason: 'emergencyReason' in b ? b.emergencyReason : r.emergency_reason, source: r.pr_source === 'DIRECT' ? 'DIRECT' : r.pr_source, directReason: 'directReason' in b ? b.directReason : r.direct_reason });
      const req = b.requiredBy ?? r.required_by; const stored = linesOf(r.id); const asInput = (l) => ({ itemId: l.item_id, serviceDesc: l.service_desc, qty: d3(l.qty), uom: l.uom, estRate: rs(l.est_rate), requiredBy: l.required_by, deliverySiteId: l.delivery_site_id, wbsId: l.wbs_id, costCodeId: l.cost_code_id, spec: l.spec, preferredVendorId: l.preferred_vendor_id, approvedMakes: l.approved_makes });
      // a requisition made from material requests keeps its items, quantities and trace: only the rate, date, vendor, spec, WBS node and cost code of its lines are changed
      const inPlace = r.pr_source === 'MR' && Boolean(b.lines); if (inPlace && (b.lines.length !== stored.length || b.lines.some((x, i) => x.itemId !== stored[i].item_id || q3(x.qty) !== stored[i].qty || lower(x.uom) !== lower(stored[i].uom)))) throw conflict('The lines of a requisition made from material requests come from them: change their rate, date, vendor and specification here, and their items and quantities in the requests.');
      const cur = inPlace ? stored.map((l, i) => ({ ...asInput(l), ...Object.fromEntries(Object.entries({ estRate: b.lines[i].estRate, requiredBy: b.lines[i].requiredBy, spec: b.lines[i].spec, preferredVendorId: b.lines[i].preferredVendorId, approvedMakes: b.lines[i].approvedMakes, wbsId: b.lines[i].wbsId, costCodeId: b.lines[i].costCodeId }).filter(([, v]) => v !== undefined && v !== null)) })) : (b.lines ?? stored.map(asInput));
      const { lines, total } = normalise(actor, p, { requiredBy: req, siteId, clientTotal: b.total }, cur);
      return transaction(db, () => {
        db.prepare('UPDATE proc_requisitions SET pr_site_id = ?, required_by = ?, priority = ?, purpose = ?, direct_reason = ?, is_emergency = ?, emergency_reason = ?, total_amount = ?, budget_check_status = \'NOT_CHECKED\', checks_json = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(siteId ?? null, req, b.priority ?? r.priority, 'purpose' in b ? b.purpose : r.purpose, 'directReason' in b ? b.directReason : r.direct_reason, emergency ? 1 : 0, emergency ? ('emergencyReason' in b ? b.emergencyReason : r.emergency_reason) : null, total, actor.user, nowIso(), r.id);
        if (inPlace) lines.forEach((l, i) => db.prepare('UPDATE proc_pr_lines SET est_rate = ?, est_amount = ?, valued_from = ?, required_by = ?, spec = ?, preferred_vendor_id = ?, approved_makes = ?, wbs_id = ?, cost_code_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(l.estRate, l.amount, l.rateSource, l.requiredBy, l.spec ?? null, l.preferredVendorId ?? null, l.approvedMakes ?? null, l.wbsId ?? null, l.costCodeId ?? null, actor.user, nowIso(), stored[i].id));
        else if (r.pr_source !== 'MR' && (b.lines || 'siteId' in b)) saveLines({ ...r, pr_site_id: siteId ?? null }, lines, actor);
        audit(actor, 'proc_requisitions', r.id, 'update', r.company_id); return prs.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'proc.requisition.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { releaseMr(actor, r); const now = nowIso(); db.prepare('UPDATE proc_pr_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE pr_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_requisitions SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'proc_requisitions', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },

    /** Send for approval: the checks are made again; free stock at the site or a nearby store, and a quantity beyond the budget quantity, need an approved exception (CP-PROC-01, CP-PROC-02); a blocked budget is stopped at the approval (12.03). */
    submit(actor, id) {
      const r = row(actor, id, 'proc.requisition.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned requisition is sent for approval.'); const p = project(actor, r.org_project_id, 'proc.requisition.view');
      const ls = linesOf(r.id); const { total } = normalise(actor, p, { requiredBy: r.required_by, siteId: r.pr_site_id }, ls.map((l) => ({ itemId: l.item_id, serviceDesc: l.service_desc, qty: d3(l.qty), uom: l.uom, estRate: rs(l.est_rate), requiredBy: l.required_by, deliverySiteId: l.delivery_site_id, wbsId: l.wbs_id, costCodeId: l.cost_code_id })));
      if (r.is_emergency) need(actor, 'proc.requisition.emergency', 'send an emergency purchase', r.org_project_id);
      return transaction(db, () => {
        db.prepare('UPDATE proc_requisitions SET total_amount = ? WHERE id = ?').run(total, r.id); const fresh = db.prepare('SELECT * FROM proc_requisitions WHERE id = ?').get(r.id); const checks = runChecks(actor, fresh);
        db.prepare('UPDATE proc_requisitions SET checks_json = ?, budget_check_status = ? WHERE id = ?').run(JSON.stringify(checks), checks.summary.budget, r.id);
        const protocol = protocolOf(db); const names = (pred) => checks.lines.filter(pred).map((c) => ls.find((l) => l.id === c.lineId)).map((l) => itemOf(r.company_id, l?.item_id)?.code ?? `line ${l?.line_no}`);
        if (r.is_emergency) protocol.check(actor, 'CP-PROC-06', { entity: 'proc_pr', entityId: String(r.id), ref: r.doc_no, reason: r.emergency_reason, message: `Emergency purchase ${r.doc_no}: ${r.emergency_reason}` });
        else if (checks.summary.stock === 'COVERED') { const items = names((c) => c.stock.result === 'COVERED'); protocol.enforce(actor, 'CP-PROC-01', { entity: 'proc_pr', entityId: String(r.id), amount: Number(rs(total)), valueAtRisk: Number(rs(total)), ref: r.doc_no, project: p.code, items: items.join(', '), message: `Free stock at the site or a nearby store covers ${items.join(', ')}: use it (issue or transfer) instead of buying.` }); }
        if (checks.summary.beyondQty > 0) { const items = names((c) => c.budget.beyondQty); protocol.enforce(actor, 'CP-PROC-02', { entity: 'proc_pr', entityId: String(r.id), amount: Number(rs(total)), valueAtRisk: Number(rs(total)), ref: r.doc_no, project: p.code, items: items.join(', '), message: `The quantity of ${items.join(', ')} is beyond the budget quantity.` }); }
        const pd = Number(param(r.company_id, 'proc.pr.band_pd_minor') ?? 50_000_000); const pm = Number(param(r.company_id, 'proc.pr.band_procmgr_minor') ?? 250_000_000);
        const ctx = { projectId: r.org_project_id, siteId: r.pr_site_id ?? undefined, amount: Number(rs(total)), emergency: r.is_emergency ? 'yes' : 'no', bandPd: !r.is_emergency && total > pd ? 'yes' : 'no', bandProc: !r.is_emergency && total > pm ? 'yes' : 'no', source: r.pr_source };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: PR_DOC, docId: String(r.id), comment: `${r.doc_no}${r.is_emergency ? ' (emergency, regularisation)' : ''}: ${rs(total)}`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_requisitions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        const hours = Number(param(r.company_id, 'proc.pr.regularise_hours') ?? 24); const by = r.is_emergency ? new Date(Date.now() + hours * 3_600_000).toISOString() : null;
        db.prepare('UPDATE proc_requisitions SET status = ?, requested_by = ?, submitted_at = ?, regularise_by = ?, overdue_notified = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(r.is_emergency ? 'EMERGENCY' : 'SUBMITTED', actor.user, nowIso(), by, actor.user, nowIso(), r.id);
        audit(actor, 'proc_requisitions', r.id, 'submit', r.company_id, { newValues: { total: rs(total), emergency: Boolean(r.is_emergency), bands: [ctx.bandPd, ctx.bandProc] } });
        if (r.is_emergency) { evt('proc.pr.emergency_raised', actor, r, { regulariseBy: by, reason: r.emergency_reason, amount: rs(total) }); notify(r.company_id, 'proc.pr.emergency', ['role:PM|PROCMGR'], r.doc_no, String(p.code), `${r.doc_no} (${rs(total)}) is an emergency purchase: the project manager regularises it by approving it within ${hours} hours.`, `/proc/requisitions?id=${r.id}`, r.id, { projectId: r.org_project_id }); }
        return prs.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (!['SUBMITTED', 'EMERGENCY'].includes(r.status)) throw unprocessable('Only a requisition waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return prs.get(actor, r.id); },
    /** FR-05: a requisition that is not approved is cancelled; an approved one with nothing ordered is cancelled and its commitment released; one with something ordered is short-closed. */
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'proc.requisition.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'EMERGENCY', 'APPROVED'].includes(r.status)) throw unprocessable('Only a requisition that is not closed is cancelled.');
      if (r.status === 'APPROVED' && linesOf(r.id).some((l) => l.ordered_qty > 0)) throw conflict('Part of this requisition is ordered: short-close it instead.');
      return transaction(db, () => {
        if (['SUBMITTED', 'EMERGENCY'].includes(r.status)) workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason);
        if (r.status === 'APPROVED') budOf(db)?.ledger?.commitments?.release(sysActor(r.company_id, actor.user), { sourceType: 'proc_pr', sourceId: String(r.id), cancel: true, reason: `${r.doc_no} cancelled: ${reason}`, quiet: true });
        releaseMr(actor, r); db.prepare("UPDATE proc_requisitions SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_requisitions', r.id, 'cancel', r.company_id, { reason }); evt('proc.pr.cancelled', actor, r, { reason }); return prs.get(actor, r.id);
      });
    },
    /** FR-05: short-close an approved requisition: what is not ordered is given up, the commitment of it released and the material request lines it covered are free to be met again. */
    close(actor, id, { reason }) {
      const r = row(actor, id, 'proc.requisition.cancel'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved requisition is short-closed.'); const ls = linesOf(r.id); if (!ls.some((l) => l.balance_qty > 0)) throw unprocessable('Everything on this requisition is ordered already.');
      return transaction(db, () => {
        for (const l of ls) if (l.balance_qty > 0) { db.prepare('UPDATE proc_pr_lines SET closed_qty = closed_qty + balance_qty, balance_qty = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), l.id); freeMrQty(l, l.balance_qty, actor); }
        const ordered = ls.reduce((n, l) => n + l.ordered_qty * l.est_rate, 0);
        if (ordered === 0) budOf(db)?.ledger?.commitments?.release(sysActor(r.company_id, actor.user), { sourceType: 'proc_pr', sourceId: String(r.id), cancel: true, reason: `${r.doc_no} short-closed: ${reason}`, quiet: true });
        else budOf(db)?.ledger?.commitments?.release(sysActor(r.company_id, actor.user), { sourceType: 'proc_pr', sourceId: String(r.id), cancel: false, reason: `${r.doc_no} short-closed: ${reason}`, quiet: true });
        db.prepare("UPDATE proc_requisitions SET status = 'CLOSED', closed_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_requisitions', r.id, 'close', r.company_id, { reason }); evt('proc.pr.closed', actor, r, { reason, balanceGivenUp: true }); return prs.get(actor, r.id);
      });
    },
    /** An approved requisition is amended by a new revision with the lines copied; it replaces the original, and its commitment, when it is approved. Not once something is ordered. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'proc.requisition.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved requisition is amended.'); const ls = linesOf(r.id); if (ls.some((l) => l.ordered_qty > 0 || l.closed_qty > 0)) throw conflict('Part of this requisition is ordered or short-closed: it is not amended.');
      if (db.prepare("SELECT 1 FROM proc_requisitions WHERE parent_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'EMERGENCY') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment of this requisition is already open.');
      return transaction(db, () => {
        const no = `${r.doc_no.split('/R')[0]}/R${r.revision_no + 1}`; const nid = Number(db.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, direct_reason, requested_by, required_by, priority, purpose, total_amount, is_emergency, status, revision_no, parent_id, root_id, project_id, site_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'DRAFT', ?, ?, ?, ?, ?, ?, 'amendment', ?, ?)").run(r.company_id, no, todayIST(), r.org_project_id, r.pr_site_id, r.pr_source, r.direct_reason ?? (r.pr_source === 'DIRECT' ? reason : null), actor.user, r.required_by > todayIST() ? r.required_by : todayIST(), r.priority, r.purpose, r.total_amount, r.revision_no + 1, r.id, r.root_id ?? r.id, r.org_project_id, r.pr_site_id, actor.user, String(r.id), reason).lastInsertRowid);
        const n = db.prepare('SELECT * FROM proc_requisitions WHERE id = ?').get(nid); const ids = saveLines(n, ls.map((l) => ({ itemId: l.item_id, serviceDesc: l.service_desc, qty: l.qty, uom: l.uom, estRate: l.est_rate, rateSource: l.valued_from, amount: l.est_amount, requiredBy: l.required_by > todayIST() ? l.required_by : todayIST(), deliverySiteId: l.delivery_site_id, wbsId: l.wbs_id, costCodeId: l.cost_code_id, spec: l.spec, preferredVendorId: l.preferred_vendor_id, approvedMakes: l.approved_makes })), actor);
        ls.forEach((l, i) => { for (const s of sourcesOf(l.id)) db.prepare("INSERT INTO proc_pr_sources (company_id, pr_line_id, mr_line_id, qty, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'amendment', ?)").run(r.company_id, ids[i], s.mr_line_id, s.qty, r.org_project_id, actor.user, String(l.id)); });
        audit(actor, 'proc_requisitions', nid, 'amend', r.company_id, { reason, newValues: { of: r.doc_no } }); return prs.get(actor, nid);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'proc_requisitions' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'proc.requisition.print'); const v = view(actor, r, { detail: true }); audit(actor, 'proc_requisitions', r.id, 'print', r.company_id);
      const cols = [['lineNo', '#'], ['item', 'Item or service'], ['qty', 'Quantity'], ['uom', 'Unit'], ['requiredBy', 'Required by'], ['mr', 'Material requests']]; if (v.canSeeCost) cols.push(['rate', 'Est. rate'], ['amount', 'Est. amount']);
      const columns = cols.map(([key, label]) => ({ key, label, type: 'text' })); const rows = v.lines.map((l) => ({ lineNo: String(l.lineNo), item: l.itemCode ? `${l.itemCode} ${l.itemName}` : l.itemName, qty: String(l.qty), uom: l.uom, requiredBy: l.requiredBy, mr: l.sources.map((x) => x.mrNo).join(', '), rate: String(l.estRate ?? ''), amount: String(l.estAmount ?? '') }));
      const footer = [`${v.docNo}: ${v.projectCode}${v.siteCode ? ` / ${v.siteCode}` : ''}, required by ${v.requiredBy}, ${v.priorityLabel} priority${v.isEmergency ? ', EMERGENCY' : ''}`, v.canSeeCost ? `Estimated value ${v.totalAmount}` : '', `Requested by ${v.requestedBy}${v.approvedBy ? `; approved by ${v.approvedBy}` : ''}`].filter(Boolean);
      return { buffer: toPdf({ columns, rows, footer, title: `Purchase requisition ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    importLines(actor, id, { rows }) {
      const r = row(actor, id, 'proc.requisition.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Lines are added to a draft or a returned requisition.'); const p = project(actor, r.org_project_id, 'proc.requisition.view'); const problems = [];
      const add = rows.map((x, i) => { let itemId = null; if (x.itemCode) { const it = db.prepare("SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND item_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(actor.companyId, x.itemCode); if (!it) problems.push({ field: `rows.${i}.itemCode`, message: `No active item with the code ${x.itemCode}` }); itemId = it?.id ?? null; } return { itemId, serviceDesc: x.itemCode ? null : x.serviceDesc, qty: x.qty, uom: x.uom, estRate: x.estRate ?? undefined, requiredBy: x.requiredBy ?? undefined }; }); fail(problems);
      const all = [...linesOf(r.id).map((l) => ({ itemId: l.item_id, serviceDesc: l.service_desc, qty: d3(l.qty), uom: l.uom, estRate: rs(l.est_rate), requiredBy: l.required_by, deliverySiteId: l.delivery_site_id, wbsId: l.wbs_id, costCodeId: l.cost_code_id })), ...add]; const { lines, total } = normalise(actor, p, { requiredBy: r.required_by, siteId: r.pr_site_id }, all);
      return transaction(db, () => { if (r.pr_source === 'MR') throw conflict('Lines of a requisition made from material requests come from them.'); saveLines(r, lines, actor); retotal(r.id, total); audit(actor, 'proc_requisitions', r.id, 'import', r.company_id, { newValues: { added: add.length } }); return prs.get(actor, r.id); });
    },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM proc_requisitions WHERE id = ?').get(rid(instance.docId)); if (!r || !['SUBMITTED', 'EMERGENCY'].includes(r.status)) return; const now = nowIso(); const p = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(r.org_project_id);
      if (outcome === 'APPROVED') {
        // T-02: the commitment is recorded in the ledger of 12.03; a hard block stops the approval unless an approved exception names this requisition (the whole decision is undone)
        const ls = linesOf(r.id); const bud = budOf(db)?.ledger; let commit = null;
        if (bud && ls.length && db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(r.org_project_id)) commit = bud.commitments.commit(sysActor(r.company_id, actor.user), { projectId: r.org_project_id, stage: 'PR', sourceType: 'proc_pr', sourceId: String(r.id), docRef: r.doc_no, replaces: r.parent_id ? { sourceType: 'proc_pr', sourceId: String(r.parent_id) } : undefined,
          lines: ls.map((l) => ({ lineId: String(l.line_no), wbsId: l.wbs_id ?? undefined, costCodeId: l.cost_code_id ?? undefined, resourceType: RES[itemOf(r.company_id, l.item_id)?.item_type] ?? 'OTHER', qty: d3(l.qty), amount: l.est_amount / 100, description: itemOf(r.company_id, l.item_id)?.name ?? l.service_desc })) });
        db.prepare("UPDATE proc_requisitions SET status = 'APPROVED', approved_by = ?, approved_at = ?, regularised_at = CASE WHEN is_emergency = 1 THEN ? ELSE regularised_at END, budget_check_status = COALESCE(?, budget_check_status), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, commit?.result ?? null, actor.user, now, r.id);
        if (r.parent_id) db.prepare("UPDATE proc_requisitions SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_id);
        audit(actor, 'proc_requisitions', r.id, r.is_emergency ? 'regularise' : 'approve', r.company_id);
        evt('proc.pr.approved', actor, r, { requiredBy: r.required_by, priority: r.priority, emergency: Boolean(r.is_emergency), amount: rs(r.total_amount), supersedes: r.parent_id, source: r.pr_source, commitment: commit?.result ?? null,
          lines: ls.map((l) => ({ lineId: l.id, lineNo: l.line_no, itemId: l.item_id, serviceDesc: l.service_desc, qty: d3(l.qty), uom: l.uom, estRate: rs(l.est_rate), requiredBy: l.required_by, deliverySiteId: l.delivery_site_id, wbsId: l.wbs_id, costCodeId: l.cost_code_id, preferredVendorId: l.preferred_vendor_id, spec: l.spec, mrLines: sourcesOf(l.id).map((s) => ({ mrId: s.mr_id, mrLineId: s.mr_line_id, qty: d3(s.qty) })) })) });
        notify(r.company_id, 'proc.pr.approved', [`user:${r.requested_by}`, 'role:PROCIC|PROCMGR'], r.doc_no, String(p?.code), `${r.doc_no} is approved${r.is_emergency ? ' and regularised' : ''}; it goes to enquiry and order.`, `/proc/requisitions?id=${r.id}`, r.id, { projectId: r.org_project_id }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proc_requisitions SET status = ?, workflow_instance_id = ?, regularise_by = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'proc_requisitions', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (['REJECTED', 'CANCELLED'].includes(to)) releaseMr(actor, r);
      if (outcome === 'REJECTED') notify(r.company_id, 'proc.pr.rejected', [`user:${r.requested_by}`], r.doc_no, String(p?.code), `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/proc/requisitions?id=${r.id}`, r.id);
    },
  };

  // ---- the trace to the material requests: a consolidated line keeps one row per request line (T-03) --------------------------------------------------------------------------------------------------
  function freeMrQty(prLine, qty, actor) {
    let left = qty; for (const s of sourcesOf(prLine.id).reverse()) { if (left <= 0) break; const take = Math.min(left, s.qty); const ml = db.prepare('SELECT * FROM proc_mr_lines WHERE id = ?').get(s.mr_line_id); if (!ml) continue; const n = { ...ml, pr_qty: Math.max(0, ml.pr_qty - take) }; db.prepare('UPDATE proc_mr_lines SET pr_qty = ?, fulfilment_mode = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(n.pr_qty, mr.modeOf(n), actor.user, nowIso(), ml.id); left -= take; }
  }
  /** A requisition that is rejected, cancelled or deleted gives its request lines back; an amendment never does (its original still holds them). */
  function releaseMr(actor, r) {
    if (r.parent_id) return; for (const l of linesOf(r.id)) { freeMrQty(l, l.qty - l.closed_qty, actor); db.prepare('UPDATE proc_pr_sources SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE pr_line_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, l.id); }
  }
  /** FR-03: material requests (or chosen lines of them) are consolidated into one draft requisition: the open quantity of each approved request line is grouped by item, unit, delivery site, WBS node and cost code. */
  function gather(actor, b) {
    const ids = [...new Set(b.mrIds)]; const rows = []; const skipped = []; let projectId = null;
    for (const id of ids) {
      const m = db.prepare('SELECT * FROM proc_material_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!m || !may(actor, 'proc.material_request.view', m.org_project_id, m.mr_site_id)) { skipped.push({ mrId: id, reason: 'Not a material request you can see' }); continue; }
      if (m.status !== 'APPROVED') { skipped.push({ mrId: id, docNo: m.doc_no, reason: 'Only approved requests are consolidated' }); continue; }
      if (projectId && projectId !== m.org_project_id) { skipped.push({ mrId: id, docNo: m.doc_no, reason: 'A requisition is for one project: this request is for another' }); continue; } projectId = m.org_project_id;
      for (const l of mr.linesOf(m.id)) { if (b.mrLineIds?.length && !b.mrLineIds.includes(l.id)) continue; const open = l.qty - mr.covered(l); if (open > 0) rows.push({ m, l, open }); }
    }
    if (!projectId) fail([{ field: 'mrIds', message: 'None of the material requests can be consolidated' }]);
    const groups = new Map(); for (const x of rows) { const k = `${x.l.item_id}|${lower(x.l.uom)}|${x.m.mr_site_id}|${x.l.wbs_id ?? 0}|${x.l.cost_code_id ?? 0}`; if (!groups.has(k)) groups.set(k, { key: k, itemId: x.l.item_id, uom: x.l.uom, siteId: x.m.mr_site_id, wbsId: x.l.wbs_id, costCodeId: x.l.cost_code_id, qty: 0, requiredBy: x.m.required_by, sources: [] }); const g = groups.get(k); g.qty += x.open; if (x.m.required_by < g.requiredBy) g.requiredBy = x.m.required_by; g.sources.push({ mrId: x.m.id, mrNo: x.m.doc_no, mrLineId: x.l.id, qty: x.open }); }
    return { projectId, groups: [...groups.values()], skipped, priority: rows.some((x) => x.m.priority === 'URGENT') ? 'URGENT' : rows.some((x) => x.m.priority === 'HIGH') ? 'HIGH' : 'NORMAL' };
  }
  const consolidate = {
    preview(actor, b) {
      const g = gather(actor, b); const p = project(actor, g.projectId, 'proc.requisition.view'); const cost = may(actor, 'proc.requisition.cost', p.id);
      const groups = g.groups.map((x) => { const it = itemOf(actor.companyId, x.itemId); const rt = rateFor(actor.companyId, p.id, it, x.wbsId, x.costCodeId); const s = siteOf(actor.companyId, p.id, x.siteId); const a = stock.availability(actor.companyId, p.id, x.siteId, [x.itemId]).get(x.itemId);
        return { key: x.key, itemId: x.itemId, itemCode: it?.code, itemName: it?.name, uom: x.uom, qty: d3(x.qty), siteId: x.siteId, site: s ? `${s.code} ${s.name}` : null, wbsId: x.wbsId, costCodeId: x.costCodeId, requiredBy: x.requiredBy, estRate: cost ? rs(rt.rate) : null, rateSource: cost ? rt.source : null, estAmount: cost ? rs(Math.round((x.qty * rt.rate) / 1000)) : null, freeStock: a?.controlQty ?? 0, stockCovers: (a?.controlMilli ?? 0) >= x.qty, sources: x.sources.map((s2) => ({ ...s2, qty: d3(s2.qty) })) }; });
      return { projectId: p.id, projectCode: p.code, priority: g.priority, groups, skipped: g.skipped, canCost: cost, requiredBy: groups.reduce((m, x) => (!m || x.requiredBy < m ? x.requiredBy : m), null), lineCount: groups.length, sourceCount: groups.reduce((n, x) => n + x.sources.length, 0) };
    },
    create(actor, b) {
      const g = gather(actor, b); const p = project(actor, g.projectId, 'proc.requisition.view'); need(actor, 'proc.requisition.create', 'raise a purchase requisition', p.id);
      const sites = new Set(g.groups.map((x) => x.siteId)); const siteId = sites.size === 1 ? [...sites][0] : null; const required = b.requiredBy ?? g.groups.reduce((m, x) => (!m || x.requiredBy < m ? x.requiredBy : m), null);
      const today = todayIST(); const lines = g.groups.map((x) => ({ itemId: x.itemId, qty: d3(x.qty), uom: x.uom, requiredBy: x.requiredBy < today ? today : x.requiredBy, deliverySiteId: x.siteId, wbsId: x.wbsId ?? undefined, costCodeId: x.costCodeId ?? undefined, _sources: x.sources }));
      const n = normalise(actor, p, { requiredBy: required < today ? today : required, siteId, clientTotal: b.total }, lines);
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, PR_DOC, 'proc_requisitions', 'PR');
        const id = Number(db.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, priority, purpose, total_amount, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'MR', ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(actor.companyId, no, today, p.id, siteId, actor.user, required < today ? today : required, b.priority ?? g.priority, b.purpose ?? null, n.total, p.id, siteId, actor.user).lastInsertRowid);
        db.prepare('UPDATE proc_requisitions SET root_id = id WHERE id = ?').run(id); const r = db.prepare('SELECT * FROM proc_requisitions WHERE id = ?').get(id); const ids = saveLines(r, n.lines, actor);
        g.groups.forEach((x, i) => { for (const s of x.sources) { db.prepare("INSERT INTO proc_pr_sources (company_id, pr_line_id, mr_line_id, qty, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'proc_mr_line', ?)").run(actor.companyId, ids[i], s.mrLineId, s.qty, p.id, actor.user, String(s.mrLineId)); const ml = db.prepare('SELECT * FROM proc_mr_lines WHERE id = ?').get(s.mrLineId); const nl = { ...ml, pr_qty: ml.pr_qty + s.qty }; db.prepare('UPDATE proc_mr_lines SET pr_qty = ?, fulfilment_mode = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nl.pr_qty, mr.modeOf(nl), actor.user, nowIso(), ml.id); } });
        audit(actor, 'proc_requisitions', id, 'consolidate', actor.companyId, { newValues: { docNo: no, requests: [...new Set(g.groups.flatMap((x) => x.sources.map((s) => s.mrNo)))], lines: g.groups.length } }); return prs.get(actor, id);
      });
    },
  };
  /** The balance to order falls as orders are placed (the purchase order part, 15.04, tells it through the event proc.po.approved: data { lines: [{ prLineId, qty }] }, a negative qty undoing an order). */
  function onPoEvent(e) {
    const d = e.data ?? {}; let n = 0;
    transaction(db, () => { for (const x of d.lines ?? []) { const l = db.prepare('SELECT * FROM proc_pr_lines WHERE id = ? AND deleted_at IS NULL').get(Number(x.prLineId)); if (!l) continue; const q = q3(x.qty); const ord = Math.max(0, Math.min(l.qty - l.closed_qty, l.ordered_qty + q)); db.prepare('UPDATE proc_pr_lines SET ordered_qty = ?, balance_qty = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(ord, l.qty - l.closed_qty - ord, 'system', nowIso(), l.id); n += 1; } });
    return n;
  }
  /** FR-06: an emergency purchase not regularised within the hours is told to the project manager and the procurement manager, once. */
  function sweepEmergencies() {
    let n = 0; for (const r of db.prepare("SELECT * FROM proc_requisitions WHERE is_emergency = 1 AND status = 'EMERGENCY' AND overdue_notified = 0 AND regularise_by < ? AND deleted_at IS NULL").all(nowIso())) {
      const p = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(r.org_project_id); db.prepare('UPDATE proc_requisitions SET overdue_notified = 1 WHERE id = ?').run(r.id);
      evt('proc.pr.regularisation_overdue', null, r, { regulariseBy: r.regularise_by, reason: r.emergency_reason }); notify(r.company_id, 'proc.pr.overdue', ['role:PM|PROCMGR|PD'], r.doc_no, String(p?.code), `${r.doc_no} is an emergency purchase that should have been regularised by ${String(r.regularise_by).slice(0, 16).replace('T', ' ')}.`, `/proc/requisitions?id=${r.id}`, r.id, { projectId: r.org_project_id }); n += 1;
    } return n;
  }
  return { prs, consolidate, onPoEvent, sweepEmergencies, decide: prs.decide };
}
