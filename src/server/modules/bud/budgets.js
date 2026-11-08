import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { DIRECTOR_ABOVE_RUPEES, units } from '../proj/constants.js';
import {
  BUDGET_DOC, BUDGET_STATUS, DEFAULT_CODES, DIMENSIONS, LINE_KINDS, METHODS, PROFILES, QTY_TYPES, RESOURCE_TYPES, TARGET_MARGIN_DEFAULT, VTYPES,
  esc, json, lineAmount, monthsBetween, nowIso, paise, profileWeights, rateOf, rid, rupees, same, splitBy,
} from './constants.js';

// Project budget (part 12.01). The budget is generated from the signed-off baseline pack (10.02) and the BOQ norms (10.04): a line per WBS node x cost code x resource with the quantity, the rate and the amount, the generated values kept beside the adjusted ones
// (every adjustment has a reason). Overheads, a contingency and a management reserve (not allocated to a WBS) are lines too. The lines are viewed by WBS, cost head, resource, work package and control account, phased over months (by hand or on an S-curve profile) and
// compared with the contract value (BR-01, a warning). The budget is approved by the project control manager, the project manager, the project director and, above ₹ 50 crore, the director; an approved budget is locked and corrected only by a revision (FR-07).
for (const [key, dataType, def, description] of [
  ['bud.target_margin_pct', 'decimal', TARGET_MARGIN_DEFAULT, 'BR-01: the margin, in percent of the contract value, that the budget (direct cost, overheads and contingency) leaves; a budget above contract value less this margin is warned about.'],
  ['bud.default_cost_codes', 'json', JSON.stringify(DEFAULT_CODES), 'The cost code that a generated line gets when its BOQ item has none: by resource type, and SITE_OVERHEAD and HEAD_OFFICE for the overheads.'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });

const services = new WeakMap();
export const bindBud = (db, s) => services.set(db, s);
export const budOf = (db) => services.get(db) ?? null;

export const budgetList = defineList({
  code: 'bud.budgets', label: 'Budget versions', permission: 'bud.budget.view',
  from: 'bud_budgets x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.name', 'p.code', 'p.name'], defaultSort: '-docDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Budget no.' }, name: { sql: 'x.name', type: 'text', label: 'Name' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    docDate: { sql: 'x.doc_date', type: 'date', label: 'Date' }, versionNo: { sql: 'x.version_no', type: 'number', label: 'Version' }, vtype: { sql: 'x.vtype', type: 'enum', label: 'Type', options: Object.entries(VTYPES) },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(BUDGET_STATUS) }, contractValue: { sql: 'x.contract_value', type: 'number', label: 'Contract value' }, total: { sql: 'x.total_amount', type: 'number', label: 'Budget total' },
    direct: { sql: 'x.direct_total', type: 'number', label: 'Direct cost' }, requestedBy: { sql: 'x.requested_by', type: 'text', label: 'Prepared by' },
  },
});

export function createBudgetService({ db }) {
  const authz = authzOf(db); const store = createParameterStore(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const event = (type, actor, id, companyId, projectId, data) => publishEvent(db, { type, entity: 'bud_budget', entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const projOf = (id) => db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(id);
  const scopeSql = (actor, perm) => { const f = authz.scopeFilter(actor, perm, { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const fresh = (id) => db.prepare('SELECT * FROM bud_budgets WHERE id = ?').get(id);
  const notify = (r, code, users, ref, subject, detail, link) => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId: r.company_id, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${code}.${r.version_no}`, sourceId: r.id }); } catch { /* the budget is still saved */ } };
  const targetPct = (companyId) => { const v = store.get('bud.target_margin_pct', { companyId, date: todayIST() }); return units(String(v?.value ?? v ?? TARGET_MARGIN_DEFAULT), 'percent'); };
  const defaultCodes = (companyId) => { const v = store.get('bud.default_cost_codes', { companyId, date: todayIST() }); const x = v?.value ?? v; return { ...DEFAULT_CODES, ...(typeof x === 'string' ? json(x, {}) : (x ?? {})) }; };

  function row(actor, id, key = 'bud.budget.view') {
    const r = db.prepare('SELECT * FROM bud_budgets WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'bud.budget.view', r.org_project_id)) throw notFound('That budget does not exist.');
    if (key !== 'bud.budget.view') need(actor, key, 'do that with a budget', r.org_project_id);
    return r;
  }
  function project(actor, projectId, key, base = 'bud.budget.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !projOf(o.id) || !may(actor, base, o.id)) throw notFound('That project does not exist.');
    if (key !== base) need(actor, key, 'do that for this project', o.id);
    return o;
  }

  // ---- the margin against the contract value (FR-06, BR-01) ---------------------------------------------------------------------------------------------------
  /** BR-01: direct cost, overheads and contingency must not exceed the contract value less the target margin (a warning, not a stop); the management reserve is held outside that test and shown beside it. */
  function margin(r) {
    const cv = r.contract_value; const basis = r.direct_total + r.overhead_total + r.contingency_total; const limit = cv - Math.round((cv * r.target_margin_pct) / 1_000_000);
    const m = cv - basis; const afterReserve = m - r.reserve_total;
    return {
      contractValue: rupees(cv), targetMarginPct: r.target_margin_pct / 10000, directCost: rupees(r.direct_total), overheads: rupees(r.overhead_total), contingency: rupees(r.contingency_total), reserve: rupees(r.reserve_total), budgetTotal: rupees(r.total_amount), costBasis: rupees(basis),
      limit: rupees(limit), margin: rupees(m), marginPct: cv > 0 ? Number(((m / cv) * 100).toFixed(2)) : null, marginAfterReserve: rupees(afterReserve), warning: basis > limit, over: basis > limit ? rupees(basis - limit) : '0.00',
      message: basis > limit ? `The budget (direct cost, overheads and contingency) is ₹ ${rupees(basis - limit)} above the contract value less the ${r.target_margin_pct / 10000} % target margin.` : null,
    };
  }
  function retotal(budgetId) {
    const t = Object.fromEntries(db.prepare("SELECT line_kind, COALESCE(SUM(amount), 0) AS a, COUNT(*) AS n FROM bud_lines WHERE budget_id = ? AND deleted_at IS NULL GROUP BY line_kind").all(budgetId).map((x) => [x.line_kind, x]));
    const g = (k) => t[k]?.a ?? 0; const total = g('DIRECT') + g('OVERHEAD') + g('CONTINGENCY') + g('RESERVE'); const n = Object.values(t).reduce((a, x) => a + x.n, 0);
    db.prepare('UPDATE bud_budgets SET direct_total = ?, overhead_total = ?, contingency_total = ?, reserve_total = ?, total_amount = ?, lines_count = ? WHERE id = ?').run(g('DIRECT'), g('OVERHEAD'), g('CONTINGENCY'), g('RESERVE'), total, n, budgetId);
  }

  // ---- the lines -----------------------------------------------------------------------------------------------------------------------------------------------
  const wbsMeta = (id) => (id ? db.prepare('SELECT id, code, name, parent_id, is_control_account FROM proj_wbs WHERE id = ?').get(id) : null);
  function controlAccountOf(wbsId) {
    let w = wbsMeta(wbsId); const seen = new Set();
    while (w && !seen.has(w.id)) { if (w.is_control_account) return w; seen.add(w.id); w = w.parent_id ? wbsMeta(w.parent_id) : null; }
    return null;
  }
  const wpOf = (projectId, wbsId) => (wbsId ? db.prepare("SELECT id, code, name, wbs_ids_json FROM proj_work_packages WHERE project_id = ? AND deleted_at IS NULL AND wp_status = 'ACTIVE' ORDER BY id").all(projectId).find((w) => json(w.wbs_ids_json, []).map(Number).includes(Number(wbsId))) ?? null : null);
  const codeRow = (companyId, code) => db.prepare("SELECT c.id, c.code, c.name, c.cost_head_id FROM fin_cost_codes c WHERE c.code = ? AND (c.company_id IS NULL OR c.company_id = ?) AND c.code_status = 'ACTIVE' AND c.deleted_at IS NULL ORDER BY c.company_id IS NULL LIMIT 1").get(code, companyId);
  const codeById = (companyId, id) => db.prepare("SELECT c.id, c.code, c.name, c.cost_head_id FROM fin_cost_codes c WHERE c.id = ? AND (c.company_id IS NULL OR c.company_id = ?) AND c.deleted_at IS NULL").get(id, companyId);

  function lineView(l, { masked = false } = {}) {
    const w = wbsMeta(l.wbs_id); const cc = l.cost_code_id ? db.prepare('SELECT code, name FROM fin_cost_codes WHERE id = ?').get(l.cost_code_id) : null; const head = l.cost_head_id ? db.prepare('SELECT code, name FROM fin_cost_heads WHERE id = ?').get(l.cost_head_id) : null;
    const wp = l.work_package_id ? db.prepare('SELECT code, name FROM proj_work_packages WHERE id = ?').get(l.work_package_id) : null; void masked;
    return {
      id: l.id, lineKind: l.line_kind, lineKindLabel: LINE_KINDS[l.line_kind], wbsId: l.wbs_id, wbsCode: w?.code ?? null, wbsName: w?.name ?? null, workPackageId: l.work_package_id, workPackage: wp ? `${wp.code} ${wp.name}` : null, boqLineId: l.boq_line_id,
      costCodeId: l.cost_code_id, costCode: cc?.code ?? null, costCodeName: cc?.name ?? null, costHeadId: l.cost_head_id, costHead: head ? `${head.code} ${head.name}` : null, resourceType: l.resource_type, resourceTypeLabel: RESOURCE_TYPES[l.resource_type], resourceName: l.resource_name, uom: l.uom,
      qty: l.qty / 1000, rate: l.rate / 10000, amount: rupees(l.amount), genQty: l.gen_qty == null ? null : l.gen_qty / 1000, genRate: l.gen_rate == null ? null : l.gen_rate / 10000, genAmount: l.gen_amount == null ? null : rupees(l.gen_amount),
      origin: l.origin, adjusted: l.origin === 'GENERATED' && l.gen_amount != null && (l.gen_amount !== l.amount || l.gen_qty !== l.qty), adjustReason: l.adjust_reason, adjustedBy: l.adjusted_by, adjustedAt: l.adjusted_at, unrated: Boolean(l.unrated), rowVersion: l.version,
    };
  }
  const linesOf = (budgetId) => db.prepare('SELECT * FROM bud_lines WHERE budget_id = ? AND deleted_at IS NULL ORDER BY CASE line_kind WHEN \'DIRECT\' THEN 1 WHEN \'OVERHEAD\' THEN 2 WHEN \'CONTINGENCY\' THEN 3 ELSE 4 END, sort_order, id').all(budgetId);
  const phasedOf = (lineId) => db.prepare('SELECT COALESCE(SUM(amount), 0) AS a, COUNT(*) AS n FROM bud_phasing WHERE line_id = ? AND deleted_at IS NULL').get(lineId);

  /** What stops a budget going for approval: every direct line sits on a WBS node with a cost code and a rate, material, labour and plant lines carry quantity and amount (BR-02), and the phasing adds up to the budget. */
  function readiness(r) {
    const problems = []; const ls = linesOf(r.id);
    if (!ls.length) problems.push({ code: 'EMPTY', text: 'The budget has no lines.' });
    const unrated = ls.filter((l) => l.unrated); if (unrated.length) problems.push({ code: 'UNRATED', text: `${unrated.length} line(s) have no rate (${unrated.slice(0, 3).map((l) => l.resource_name).join(', ')}): rate them or remove them.` });
    const noWbs = ls.filter((l) => l.line_kind === 'DIRECT' && !l.wbs_id); if (noWbs.length) problems.push({ code: 'WBS', text: `${noWbs.length} direct line(s) are not on a WBS node (map the BOQ item in 10.04 or choose a node).` });
    const noCode = ls.filter((l) => l.line_kind !== 'CONTINGENCY' && l.line_kind !== 'RESERVE' && !l.cost_code_id); if (noCode.length) problems.push({ code: 'CODE', text: `${noCode.length} line(s) have no cost code.` });
    const noQty = ls.filter((l) => l.line_kind === 'DIRECT' && QTY_TYPES.includes(l.resource_type) && (l.qty <= 0 || !l.uom)); if (noQty.length) problems.push({ code: 'QTY', text: `${noQty.length} material, labour or plant line(s) lack a quantity or unit (BR-02).` });
    const unphased = ls.filter((l) => l.amount > 0 && phasedOf(l.id).a !== l.amount); if (unphased.length) problems.push({ code: 'PHASING', text: `${unphased.length} line(s) are not fully phased over the months: the phasing must add up to the budget.` });
    return { ok: problems.length === 0, problems };
  }
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(`${r.doc_no} is ${BUDGET_STATUS[r.status].toLowerCase()}: its lines are not edited now. ${r.status === 'APPROVED' ? 'Revise it instead.' : ''}`.trim()); };

  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const m = margin(r); const open = db.prepare("SELECT 1 FROM bud_budgets WHERE parent_budget_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id);
    const big = r.total_amount >= DIRECTOR_ABOVE_RUPEES * 100;
    const v = {
      id: r.id, docNo: r.doc_no, docDate: r.doc_date, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, versionNo: r.version_no, vtype: r.vtype, vtypeLabel: VTYPES[r.vtype], name: r.name, status: r.status, statusLabel: BUDGET_STATUS[r.status], locked: Boolean(r.locked_at),
      baselinePackId: r.baseline_pack_id, boqVersionId: r.boq_version_id, parentBudgetId: r.parent_budget_id, contractValue: rupees(r.contract_value), targetMarginPct: r.target_margin_pct / 10000, directTotal: rupees(r.direct_total), overheadTotal: rupees(r.overhead_total),
      contingencyTotal: rupees(r.contingency_total), reserveTotal: rupees(r.reserve_total), totalAmount: rupees(r.total_amount), baselineCost: rupees(r.baseline_cost), linesCount: r.lines_count, phasingMethod: r.phasing_method, generatedAt: r.generated_at, approvedAt: r.approved_at, approvedBy: r.approved_by,
      requestedBy: r.requested_by, reason: r.reason, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version, margin: m, directorRequired: big, chain: big ? ['PCMGR', 'PM', 'PD', 'DIR'] : ['PCMGR', 'PM', 'PD'],
      can: {
        edit: can('bud.budget.edit') && editable(r), submit: can('bud.budget.submit') && editable(r), withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('bud.budget.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status),
        delete: can('bud.budget.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, amend: can('bud.budget.amend') && r.status === 'APPROVED' && !open, print: can('bud.budget.print'), export: can('bud.budget.export'),
      },
    };
    if (detail) {
      v.readiness = readiness(r); v.lines = linesOf(r.id).map((l) => lineView(l)); v.pack = r.baseline_pack_id ? (() => { const p = db.prepare('SELECT doc_no, pack_no FROM proj_baseline_packs WHERE id = ?').get(r.baseline_pack_id); return p ? { docNo: p.doc_no, packNo: p.pack_no } : null; })() : null;
      v.boqVersion = r.boq_version_id ? (() => { const b = db.prepare('SELECT doc_no, version_no, vtype FROM proj_boq_versions WHERE id = ?').get(r.boq_version_id); return b ? { docNo: b.doc_no, versionNo: b.version_no, vtype: b.vtype } : null; })() : null;
      v.versions = db.prepare('SELECT id, doc_no, version_no, vtype, status, total_amount FROM bud_budgets WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY version_no, id').all(r.org_project_id).map((x) => ({ id: x.id, docNo: x.doc_no, versionNo: x.version_no, vtype: x.vtype, status: x.status, statusLabel: BUDGET_STATUS[x.status], totalAmount: rupees(x.total_amount) }));
    }
    return v;
  }

  // ---- generation from the baseline pack and the BOQ norms (FR-01) --------------------------------------------------------------------------------------------
  function compute(actor, projectId, opts = {}) {
    const o = project(actor, projectId, 'bud.budget.create', 'bud.budget.view'); const x = projOf(o.id); const issues = [];
    const pack = db.prepare("SELECT * FROM proj_baseline_packs WHERE project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY pack_no DESC, id DESC").get(o.id);
    if (!pack) issues.push({ code: 'PACK', text: 'The commercial baseline of this project is not signed off yet (10.02).' });
    const ver = db.prepare("SELECT * FROM proj_boq_versions WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY (vtype = 'CONTRACT') DESC, version_no DESC, id DESC").get(o.id);
    if (!ver) issues.push({ code: 'BOQ', text: 'The project has no approved BOQ version (10.04).' });
    const snap = pack ? json(pack.snapshot_json, {}) : {}; const codes = defaultCodes(actor.companyId); const lines = []; let sort = 0;
    const override = new Map((opts.rates ?? []).map((r) => [`${r.type}|${r.description.toLowerCase()}`, units(String(r.rate), 'rate')]));
    const bySnap = new Map((snap.boq ?? []).map((b) => [String(b.itemNo).toLowerCase(), b]));
    const codeFor = (type, boqCodeId) => { if (boqCodeId) { const c = codeById(actor.companyId, boqCodeId); if (c) return c; } return codeRow(actor.companyId, codes[type] ?? codes.OTHER); };
    const push = (l) => { const wp = l.wbsId ? wpOf(o.id, l.wbsId) : null; lines.push({ ...l, workPackageId: wp?.id ?? null, sort: (sort += 1) }); };
    if (ver) {
      const boq = db.prepare("SELECT l.* FROM proj_boq_lines l WHERE l.version_id = ? AND l.deleted_at IS NULL AND l.line_kind IN ('ITEM', 'SUBITEM') AND l.qty > 0 AND NOT EXISTS (SELECT 1 FROM proj_boq_lines c WHERE c.parent_id = l.id AND c.deleted_at IS NULL) ORDER BY l.sort_order, l.id").all(ver.id);
      for (const b of boq) {
        const si = bySnap.get(String(b.item_code).toLowerCase()); const norms = db.prepare('SELECT * FROM proj_boq_line_norms WHERE line_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(b.id);
        const split = db.prepare('SELECT wbs_id, SUM(qty) AS qty FROM proj_boq_line_wbs WHERE line_id = ? AND deleted_at IS NULL GROUP BY wbs_id ORDER BY wbs_id').all(b.id).map((s) => ({ wbsId: s.wbs_id, qty: s.qty }));
        const mapped = split.reduce((a, s) => a + s.qty, 0); if (b.qty > mapped) split.push({ wbsId: null, qty: b.qty - mapped });
        if (!split.some((s) => s.wbsId)) issues.push({ code: 'UNMAPPED', text: `BOQ item ${b.item_code} is not mapped to a WBS node (10.04): its lines have no WBS.` });
        const rated = new Map((si?.norms?.lines ?? []).map((n) => [`${n.type}|${String(n.description).toLowerCase()}`, units(String(n.rate), 'rate')]));
        for (const s of split) {
          if (norms.length) {
            for (const n of norms) {
              const key = `${n.norm_type}|${n.description.toLowerCase()}`; const rate = override.get(key) ?? rated.get(key); const qty = Math.round(((s.qty * n.qty_per_unit) / 1000) * ((1_000_000 + n.wastage_pct) / 1_000_000)); const code = codeFor(n.norm_type, b.cost_code_id);
              push({ lineKind: 'DIRECT', wbsId: s.wbsId, boqLineId: b.id, costCodeId: code?.id ?? null, costHeadId: code?.cost_head_id ?? null, resourceType: n.norm_type, resourceName: n.description, uom: n.uom, qty, rate: rate ?? 0, amount: lineAmount(qty, rate ?? 0), unrated: rate == null });
            }
          } else {
            const key = `OTHER|${b.description.toLowerCase()}`; const rate = override.get(key) ?? (si ? units(String(si.costRate), 'rate') : null); const code = codeFor('OTHER', b.cost_code_id);
            push({ lineKind: 'DIRECT', wbsId: s.wbsId, boqLineId: b.id, costCodeId: code?.id ?? null, costHeadId: code?.cost_head_id ?? null, resourceType: 'OTHER', resourceName: b.description, uom: b.uom, qty: s.qty, rate: rate ?? 0, amount: lineAmount(s.qty, rate ?? 0), unrated: rate == null || rate === 0 });
          }
        }
      }
    }
    for (const i of snap.indirects ?? []) {
      const a = paise(i.amount); if (a <= 0) continue; const ho = /head office|\bho\b|corporate/i.test(`${i.category} ${i.description}`); const code = codeRow(actor.companyId, ho ? codes.HEAD_OFFICE : codes.SITE_OVERHEAD);
      push({ lineKind: 'OVERHEAD', wbsId: null, boqLineId: null, costCodeId: code?.id ?? null, costHeadId: code?.cost_head_id ?? null, resourceType: 'OTHER', resourceName: `${i.category}: ${i.description}`.slice(0, 200), uom: 'LS', qty: 1000, rate: a * 100, amount: a, unrated: false });
    }
    const cont = paise(snap.commercials?.contingency); if (cont > 0) push({ lineKind: 'CONTINGENCY', wbsId: null, boqLineId: null, costCodeId: null, costHeadId: null, resourceType: 'OTHER', resourceName: 'Contingency (estimate allowance)', uom: 'LS', qty: 1000, rate: cont * 100, amount: cont, unrated: false });
    const risk = paise(snap.commercials?.risk); if (risk > 0) push({ lineKind: 'RESERVE', wbsId: null, boqLineId: null, costCodeId: null, costHeadId: null, resourceType: 'OTHER', resourceName: 'Management reserve (risk allowance)', uom: 'LS', qty: 1000, rate: risk * 100, amount: risk, unrated: false });
    const sum = (k) => lines.filter((l) => l.lineKind === k).reduce((a, l) => a + l.amount, 0);
    const baselineCost = paise(snap.boqCost);
    return { o, x, pack, ver, lines, issues, totals: { direct: sum('DIRECT'), overhead: sum('OVERHEAD'), contingency: sum('CONTINGENCY'), reserve: sum('RESERVE'), baselineCost }, unrated: lines.filter((l) => l.unrated).length, contractValue: x?.contract_value ?? 0 };
  }
  const previewLine = (l) => ({ lineKind: l.lineKind, wbsId: l.wbsId, wbs: l.wbsId ? (() => { const w = wbsMeta(l.wbsId); return w ? `${w.code} ${w.name}` : null; })() : null, costCodeId: l.costCodeId, costCode: l.costCodeId ? db.prepare('SELECT code FROM fin_cost_codes WHERE id = ?').get(l.costCodeId)?.code : null, resourceType: l.resourceType, resourceName: l.resourceName, uom: l.uom, qty: l.qty / 1000, rate: l.rate / 10000, amount: rupees(l.amount), unrated: l.unrated });

  function viewsOf(r, by) {
      const ls = linesOf(r.id); const groups = new Map();
      const add = (key, label, l, extra = {}) => { const g = groups.get(key) ?? { key, label, amount: 0, qty: 0, lines: 0, ...extra }; g.amount += l.amount; g.qty += l.qty; g.lines += 1; groups.set(key, g); };
      for (const l of ls) {
        if (by === 'wbs') { const w = wbsMeta(l.wbs_id); add(w ? `w${w.id}` : `k${l.line_kind}`, w ? `${w.code} ${w.name}` : `Not allocated: ${LINE_KINDS[l.line_kind]}`, l, { allocated: Boolean(w) }); }
        else if (by === 'cost_head') { const h = l.cost_head_id ? db.prepare('SELECT code, name FROM fin_cost_heads WHERE id = ?').get(l.cost_head_id) : null; add(h ? `h${h.code}` : `k${l.line_kind}`, h ? `${h.code} ${h.name}` : `No cost head: ${LINE_KINDS[l.line_kind]}`, l); }
        else if (by === 'resource') add(`${l.line_kind}|${l.resource_type}|${l.resource_name.toLowerCase()}`, `${RESOURCE_TYPES[l.resource_type]}: ${l.resource_name}`, l, { uom: l.uom });
        else if (by === 'work_package') { const w = l.work_package_id ? db.prepare('SELECT code, name FROM proj_work_packages WHERE id = ?').get(l.work_package_id) : null; add(w ? `p${l.work_package_id}` : `k${l.line_kind}`, w ? `${w.code} ${w.name}` : (l.line_kind === 'DIRECT' ? 'No work package' : `Not allocated: ${LINE_KINDS[l.line_kind]}`), l); }
        else { const c = l.wbs_id ? controlAccountOf(l.wbs_id) : null; add(c ? `c${c.id}` : `k${l.line_kind}${l.wbs_id ? '-n' : ''}`, c ? `${c.code} ${c.name}` : (l.wbs_id ? 'No control account' : `Not allocated: ${LINE_KINDS[l.line_kind]}`), l); }
      }
      const total = r.total_amount || 1;
      const rows = [...groups.values()].sort((a, b) => b.amount - a.amount).map((g) => ({ key: g.key, label: g.label, amount: rupees(g.amount), amountPaise: g.amount, share: Number(((g.amount / total) * 100).toFixed(2)), lines: g.lines, uom: g.uom ?? null, qty: g.uom ? g.qty / 1000 : null }));
      return { by, byLabel: DIMENSIONS[by], budgetId: r.id, total: rupees(r.total_amount), rows, reconciled: rows.reduce((a, x) => a + x.amountPaise, 0) === r.total_amount };
    
  }

  const budgets = {
    list(actor, query) {
      need(actor, 'bud.budget.view', 'see budgets'); const s = scopeSql(actor, 'bud.budget.view');
      return runList(db, budgetList, parseListRequest(budgetList, query), {
        select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id',
        map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, name: v.name, projectId: v.projectId, project: v.projectCode, projectName: v.projectName, docDate: v.docDate, versionNo: v.versionNo, vtype: v.vtype, vtypeLabel: v.vtypeLabel, status: v.status, statusLabel: v.statusLabel, contractValue: v.contractValue, total: v.totalAmount, direct: v.directTotal, requestedBy: v.requestedBy, marginWarning: v.margin.warning, locked: v.locked }; },
      });
    },
    exportSource(actor, req) {
      need(actor, 'bud.budget.export', 'export budgets'); const s = scopeSql(actor, 'bud.budget.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return {
        title: budgetList.label, permission: 'bud.budget.export', personal: false,
        columns: [{ key: 'docNo', label: 'Budget no.', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'versionNo', label: 'Version', type: 'number' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'contractValue', label: 'Contract value', type: 'text' }, { key: 'direct', label: 'Direct cost', type: 'text' }, { key: 'total', label: 'Budget total', type: 'text' }, { key: 'marginWarning', label: 'Above margin limit', type: 'text' }],
        rows: () => runList(db, budgetList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, project: v.projectCode, versionNo: v.versionNo, status: v.statusLabel, contractValue: v.contractValue, direct: v.directTotal, total: v.totalAmount, marginWarning: v.margin.warning ? 'Yes' : 'No' }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All budgets you may see'], count: () => countList(db, budgetList, req, opts),
      };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    options(actor) {
      need(actor, 'bud.budget.view', 'see projects with budgets'); const s = scopeSql(actor, 'bud.budget.view');
      return db.prepare('SELECT p.id, p.code, p.name FROM proj_projects x JOIN org_projects p ON p.id = x.project_id WHERE x.deleted_at IS NULL AND x.company_id = :c AND ' + s.sql.replace('x.org_project_id', 'x.project_id') + ' ORDER BY p.code').all(s.params).map((p) => ({ id: p.id, code: p.code, name: p.name }));
    },
    structure(actor, projectId) {
      const o = project(actor, projectId, 'bud.budget.view');
      return { wbs: db.prepare("SELECT id, code, name, level FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL AND wbs_status = 'ACTIVE' ORDER BY code").all(o.id), costCodes: db.prepare("SELECT id, code, name FROM fin_cost_codes WHERE (company_id IS NULL OR company_id = ?) AND code_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code").all(actor.companyId) };
    },
    /** FR-01: what the generation would do, with the lines, the totals against the baseline cost and what is missing; nothing is saved. */
    preview(actor, { projectId, rates = [] }) {
      const c = compute(actor, projectId, { rates }); const existing = db.prepare("SELECT id, doc_no, status FROM bud_budgets WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL").all(c.o.id); const issues = [...c.issues];
      if (existing.length) issues.push({ code: 'EXISTS', text: `${existing[0].doc_no} is ${BUDGET_STATUS[existing[0].status].toLowerCase()} already: ${existing[0].status === 'APPROVED' ? 'revise it' : 'finish or cancel it'} instead of generating another.` });
      const unrated = []; const seen = new Set(); for (const l of c.lines.filter((x) => x.unrated)) { const k = `${l.resourceType}|${l.resourceName}`; if (!seen.has(k)) { seen.add(k); unrated.push({ type: l.resourceType, description: l.resourceName, uom: l.uom }); } }
      const t = c.totals; const total = t.direct + t.overhead + t.contingency + t.reserve;
      return {
        projectId: c.o.id, projectCode: c.o.code, projectName: c.o.name, pack: c.pack ? { id: c.pack.id, docNo: c.pack.doc_no, packNo: c.pack.pack_no } : null, boqVersion: c.ver ? { id: c.ver.id, docNo: c.ver.doc_no, versionNo: c.ver.version_no, vtype: c.ver.vtype } : null, contractValue: rupees(c.contractValue),
        targetMarginPct: targetPct(actor.companyId) / 10000, totals: { direct: rupees(t.direct), overhead: rupees(t.overhead), contingency: rupees(t.contingency), reserve: rupees(t.reserve), total: rupees(total), baselineCost: rupees(t.baselineCost), differenceToBaseline: rupees(t.direct - t.baselineCost) },
        linesCount: c.lines.length, unratedCount: c.unrated, unrated, issues, canGenerate: issues.length === 0 && c.unrated === 0 && c.lines.some((l) => l.lineKind === 'DIRECT'), lines: c.lines.slice(0, 400).map(previewLine),
      };
    },
    generate(actor, b) {
      const c = compute(actor, b.projectId, { rates: b.rates }); need(actor, 'bud.budget.create', 'prepare a budget', c.o.id);
      if (c.issues.length) throw unprocessable(c.issues.map((i) => i.text).join(' '));
      if (!c.lines.some((l) => l.lineKind === 'DIRECT')) throw unprocessable('The BOQ has no lines with a quantity: there is nothing to budget.');
      const open = db.prepare("SELECT doc_no, status FROM bud_budgets WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL").get(c.o.id);
      if (open) throw conflict(`${open.doc_no} is ${BUDGET_STATUS[open.status].toLowerCase()} already: ${open.status === 'APPROVED' ? 'revise it' : 'finish or cancel it'} instead of generating another.`);
      return transaction(db, () => budgets.insertFrom(actor, c, { name: b.name ?? `Budget of ${c.o.code}`, targetMarginPct: b.targetMarginPct == null ? null : Math.round(b.targetMarginPct * 10000), versionNo: 1, vtype: 'ORIGINAL', parentId: null, reason: null }));
    },
    insertFrom(actor, c, { name, targetMarginPct, versionNo, vtype, parentId, reason }) {
      const t = c.totals; const docNo = numberFor(actor); const now = nowIso(); const total = t.direct + t.overhead + t.contingency + t.reserve;
      const id = Number(db.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, version_no, vtype, name, baseline_pack_id, boq_version_id, parent_budget_id, status, contract_value, target_margin_pct, baseline_cost, generated_at, requested_by, reason, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
        .run(actor.companyId, docNo, todayIST(), c.o.id, versionNo, vtype, name, c.pack?.id ?? null, c.ver?.id ?? null, parentId, c.contractValue, targetMarginPct ?? targetPct(actor.companyId), t.baselineCost, now, actor.user, reason, c.o.id, actor.user).lastInsertRowid);
      const ins = db.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, work_package_id, boq_line_id, cost_code_id, cost_head_id, resource_type, resource_name, uom, qty, rate, amount, gen_qty, gen_rate, gen_amount, origin, unrated, sort_order, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GENERATED', ?, ?, ?, ?, 'api')");
      for (const l of c.lines) ins.run(actor.companyId, id, l.lineKind, l.wbsId, l.workPackageId, l.boqLineId, l.costCodeId, l.costHeadId, l.resourceType, l.resourceName, l.uom, l.qty, l.rate, l.amount, l.qty, l.rate, l.amount, l.unrated ? 1 : 0, l.sort, c.o.id, actor.user);
      retotal(id); audit(actor, 'bud_budgets', id, 'generate', actor.companyId, { newValues: { docNo, lines: c.lines.length, total } });
      event('bud.budget.generated', actor, id, actor.companyId, c.o.id, { projectId: c.o.id, budgetId: id, docNo, versionNo, lines: c.lines.length, total: rupees(total), baselinePackId: c.pack?.id ?? null, boqVersionId: c.ver?.id ?? null });
      return budgets.get(actor, id);
    },
    create(actor, b) {
      const o = project(actor, b.projectId, 'bud.budget.create'); const x = projOf(o.id);
      const open = db.prepare("SELECT doc_no, status FROM bud_budgets WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL").get(o.id); if (open) throw conflict(`${open.doc_no} is ${BUDGET_STATUS[open.status].toLowerCase()} already.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, version_no, vtype, name, status, contract_value, target_margin_pct, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, 1, 'ORIGINAL', ?, 'DRAFT', ?, ?, ?, ?, ?, 'api')")
          .run(actor.companyId, numberFor(actor), todayIST(), o.id, b.name, x.contract_value, b.targetMarginPct == null ? targetPct(actor.companyId) : Math.round(b.targetMarginPct * 10000), actor.user, o.id, actor.user).lastInsertRowid);
        audit(actor, 'bud_budgets', id, 'create', actor.companyId); return budgets.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'bud.budget.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this budget; reload it.');
      const sets = []; const vals = []; if ('name' in b) { sets.push('name = ?'); vals.push(b.name); } if ('targetMarginPct' in b) { sets.push('target_margin_pct = ?'); vals.push(Math.round(b.targetMarginPct * 10000)); }
      if (sets.length) db.prepare(`UPDATE bud_budgets SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
      audit(actor, 'bud_budgets', r.id, 'update', r.company_id); return budgets.get(actor, r.id);
    },
    remove(actor, id) {
      const r = row(actor, id, 'bud.budget.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.');
      transaction(db, () => { const now = nowIso(); for (const t of ['bud_phasing', 'bud_lines']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE budget_id = ? AND deleted_at IS NULL`).run(now, actor.user, r.id); db.prepare('UPDATE bud_budgets SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'bud_budgets', r.id, 'delete', r.company_id); });
      return { id: r.id, deleted: true };
    },
    submit(actor, id) {
      const r = row(actor, id, 'bud.budget.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned budget is sent for approval.');
      const rd = readiness(r); if (!rd.ok) throw unprocessable(`The budget is not ready: ${rd.problems.map((p) => p.text).join(' ')}`);
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, amount: Number(rupees(r.total_amount)) };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: BUDGET_DOC, docId: String(r.id), comment: `${orgOf(r.org_project_id).code} ${r.doc_no}`.slice(0, 300), context: ctx }); db.prepare('UPDATE bud_budgets SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE bud_budgets SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id);
        const f = fresh(r.id); const m = margin(f); audit(actor, 'bud_budgets', r.id, 'submit', r.company_id, { newValues: { total: rupees(f.total_amount), marginWarning: m.warning } });
        if (m.warning) notify(f, 'bud.budget.margin_warning', [projOf(r.org_project_id)?.pm_user], f.doc_no, f.name, m.message, `/bud/budget?id=${f.id}`);
        return budgets.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a budget waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return budgets.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'bud.budget.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a budget that is not approved is cancelled; an approved one is revised.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE bud_budgets SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'bud_budgets', r.id, 'cancel', r.company_id, { reason }); return budgets.get(actor, r.id); });
    },
    /** FR-07: an approved budget stays as it was; a revision copies its lines, carries the reason and replaces it when approved. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'bud.budget.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved budget is revised.');
      if (db.prepare("SELECT 1 FROM bud_budgets WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.org_project_id)) throw conflict('A revision of this budget is in preparation already.');
      return transaction(db, () => {
        const vno = (db.prepare('SELECT MAX(version_no) AS n FROM bud_budgets WHERE org_project_id = ? AND deleted_at IS NULL').get(r.org_project_id).n ?? 1) + 1; const x = projOf(r.org_project_id);
        const nid = Number(db.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, version_no, vtype, name, baseline_pack_id, boq_version_id, parent_budget_id, status, contract_value, target_margin_pct, baseline_cost, phasing_method, requested_by, reason, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'REVISED', ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
          .run(r.company_id, numberFor(actor), todayIST(), r.org_project_id, vno, r.name, r.baseline_pack_id, r.boq_version_id, r.id, x?.contract_value ?? r.contract_value, r.target_margin_pct, r.baseline_cost, r.phasing_method, actor.user, reason, r.org_project_id, actor.user).lastInsertRowid);
        const map = new Map();
        for (const l of linesOf(r.id)) {
          const lid = Number(db.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, work_package_id, boq_line_id, cost_code_id, cost_head_id, resource_type, resource_name, uom, qty, rate, amount, gen_qty, gen_rate, gen_amount, origin, adjust_reason, adjusted_by, adjusted_at, unrated, sort_order, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
            .run(l.company_id, nid, l.line_kind, l.wbs_id, l.work_package_id, l.boq_line_id, l.cost_code_id, l.cost_head_id, l.resource_type, l.resource_name, l.uom, l.qty, l.rate, l.amount, l.gen_qty, l.gen_rate, l.gen_amount, l.origin, l.adjust_reason, l.adjusted_by, l.adjusted_at, l.unrated, l.sort_order, l.project_id, actor.user).lastInsertRowid);
          map.set(l.id, lid);
        }
        for (const p of db.prepare('SELECT * FROM bud_phasing WHERE budget_id = ? AND deleted_at IS NULL').all(r.id)) db.prepare("INSERT INTO bud_phasing (company_id, budget_id, line_id, period, amount, qty, method, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(p.company_id, nid, map.get(p.line_id), p.period, p.amount, p.qty, p.method, p.project_id, actor.user);
        retotal(nid); audit(actor, 'bud_budgets', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } });
        event('bud.budget.revised', actor, nid, r.company_id, r.org_project_id, { projectId: r.org_project_id, budgetId: nid, parentBudgetId: r.id, versionNo: vno, reason });
        return budgets.get(actor, nid);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('bud_budgets', 'bud_lines') AND (entity_id = ? OR (entity = 'bud_lines' AND entity_id IN (SELECT id FROM bud_lines WHERE budget_id = ?))) ORDER BY id").all(String(r.id), r.id) }; },
    print(actor, id) {
      const r = row(actor, id, 'bud.budget.print'); const v = view(actor, r, { detail: true }); const company = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? '';
      const head = v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED BUDGET</strong></p>`; const by = budgets.views(actor, r.id, { by: 'cost_head' });
      const tr = (cells) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${head}<h1>${esc(company)}</h1><h2>Project budget ${esc(v.docNo)} · ${esc(v.projectCode)} ${esc(v.projectName)}</h2><p>Version ${v.versionNo} (${esc(v.vtypeLabel)}) · ${esc(v.statusLabel)} · Contract value ₹ ${esc(v.contractValue)}</p>`
        + `<table border="1" cellpadding="4"><tr><th>Cost head</th><th>Amount (₹)</th></tr>${by.rows.map((x) => tr([x.label, x.amount])).join('')}${tr(['Total', v.totalAmount])}</table>`
        + `<p>Direct ₹ ${esc(v.directTotal)} · Overheads ₹ ${esc(v.overheadTotal)} · Contingency ₹ ${esc(v.contingencyTotal)} · Management reserve ₹ ${esc(v.reserveTotal)}</p><p>Margin ₹ ${esc(v.margin.margin)} (${v.margin.marginPct ?? '—'} %)${v.margin.warning ? ` · WARNING: ${esc(v.margin.message)}` : ''}</p>`
        + `<table border="1" cellpadding="4"><tr><th>Kind</th><th>WBS</th><th>Cost code</th><th>Resource</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount (₹)</th></tr>${v.lines.map((l) => tr([l.lineKindLabel, l.wbsCode ?? '—', l.costCode ?? '—', l.resourceName, l.uom ?? '', l.qty, l.rate, l.amount])).join('')}</table></body></html>`;
    },

    // ---- the views by dimension (FR-02) -------------------------------------------------------------------------------------------------------------------------
    views(actor, id, { by = 'wbs' } = {}) { return viewsOf(row(actor, id), by); },
    margin(actor, id) { const r = row(actor, id); return { budgetId: r.id, ...margin(r), bands: { pm: 'Project manager', pd: 'Project director', dir: r.total_amount >= DIRECTOR_ABOVE_RUPEES * 100 ? 'Director (above ₹ 50 crore)' : null } }; },

    // ---- lines: adjustments with a reason (FR-01), overheads, contingency, reserve (FR-03, FR-04) ----------------------------------------------------------------------
    lines: {
      list(actor, id, q = {}) { const r = row(actor, id); const ls = linesOf(r.id).filter((l) => (!q.kind || l.line_kind === q.kind) && (!q.wbsId || l.wbs_id === Number(q.wbsId))); return { budgetId: r.id, rows: ls.map((l) => lineView(l)) }; },
      problems(actor, r, b, cur = null) {
        const p = []; const kind = cur?.line_kind ?? b.lineKind; const type = b.resourceType ?? cur?.resource_type ?? 'OTHER'; const wbsId = 'wbsId' in b ? b.wbsId : cur?.wbs_id;
        if (wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(wbsId, r.org_project_id)) p.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
        if (kind === 'DIRECT' && !wbsId) p.push({ field: 'wbsId', message: 'A direct line sits on a WBS node' });
        if ((kind === 'CONTINGENCY' || kind === 'RESERVE') && wbsId) p.push({ field: 'wbsId', message: 'Contingency and management reserve are not allocated to a WBS node (FR-04)' });
        const codeId = 'costCodeId' in b ? b.costCodeId : cur?.cost_code_id; if (codeId && !codeById(r.company_id, codeId)) p.push({ field: 'costCodeId', message: 'Choose an active cost code' });
        if ((kind === 'DIRECT' || kind === 'OVERHEAD') && !codeId) p.push({ field: 'costCodeId', message: 'A direct or overhead line carries a cost code' });
        const qty = b.qty ?? (cur ? cur.qty / 1000 : null); if (kind === 'DIRECT' && QTY_TYPES.includes(type) && !(qty > 0)) p.push({ field: 'qty', message: 'A material, labour or plant line carries a quantity as well as an amount (BR-02)' });
        if (kind === 'DIRECT' && QTY_TYPES.includes(type) && !(b.uom ?? cur?.uom)) p.push({ field: 'uom', message: 'Give the unit of the quantity (BR-02)' });
        return p;
      },
      /** The quantity (x 1 000), rate (x 10 000) and amount (paise) of the values given: quantity and rate give the amount, quantity and amount give the rate, an amount alone is a lump sum. */
      figures(b, cur = null) {
        const qty = b.qty != null ? Math.round(b.qty * 1000) : (cur?.qty ?? null); let rate = b.rate != null ? Math.round(b.rate * 10000) : null; let amount = b.amount != null ? Math.round(b.amount * 100) : null;
        if (rate != null && qty != null && amount == null) amount = lineAmount(qty, rate);
        else if (amount != null && qty != null && qty > 0 && rate == null) rate = rateOf(qty, amount);
        else if (amount != null && (qty == null || qty === 0) && rate == null) { return { qty: 1000, rate: amount * 100, amount }; }
        else if (rate == null && amount == null && cur) { rate = cur.rate; amount = lineAmount(qty ?? cur.qty, rate); }
        return { qty: qty ?? 0, rate: rate ?? 0, amount: amount ?? 0 };
      },
      create(actor, id, b) {
        const r = row(actor, id, 'bud.budget.edit'); mustEdit(r); fail(budgets.lines.problems(actor, r, b)); const f = budgets.lines.figures(b); const code = b.costCodeId ? codeById(r.company_id, b.costCodeId) : null;
        return transaction(db, () => {
          const wp = b.wbsId ? wpOf(r.org_project_id, b.wbsId) : null; const sort = (db.prepare('SELECT MAX(sort_order) AS n FROM bud_lines WHERE budget_id = ?').get(r.id).n ?? 0) + 1;
          const lid = Number(db.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, work_package_id, cost_code_id, cost_head_id, resource_type, resource_name, uom, qty, rate, amount, origin, adjust_reason, adjusted_by, adjusted_at, unrated, sort_order, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, 0, ?, ?, ?, 'api')")
            .run(r.company_id, r.id, b.lineKind, b.wbsId, wp?.id ?? null, code?.id ?? null, code?.cost_head_id ?? null, b.resourceType, b.resourceName, b.uom, f.qty, f.rate, f.amount, b.reason, actor.user, nowIso(), sort, r.org_project_id, actor.user).lastInsertRowid);
          retotal(r.id); audit(actor, 'bud_lines', lid, 'create', r.company_id, { reason: b.reason, newValues: { kind: b.lineKind, amount: rupees(f.amount) } }); return lineView(db.prepare('SELECT * FROM bud_lines WHERE id = ?').get(lid));
        });
      },
      update(actor, lineId, b) {
        const l = db.prepare('SELECT * FROM bud_lines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(lineId), actor.companyId); if (!l) throw notFound('That budget line does not exist.');
        const r = row(actor, l.budget_id, 'bud.budget.edit'); mustEdit(r); fail(budgets.lines.problems(actor, r, b, l)); const money = ('qty' in b) || ('rate' in b) || ('amount' in b); const f = money ? budgets.lines.figures(b, l) : { qty: l.qty, rate: l.rate, amount: l.amount };
        const sets = []; const vals = []; const put = (c, v) => { sets.push(`${c} = ?`); vals.push(v); };
        if ('wbsId' in b) { put('wbs_id', b.wbsId); put('work_package_id', b.wbsId ? (wpOf(r.org_project_id, b.wbsId)?.id ?? null) : null); }
        if ('costCodeId' in b) { const c = b.costCodeId ? codeById(r.company_id, b.costCodeId) : null; put('cost_code_id', c?.id ?? null); put('cost_head_id', c?.cost_head_id ?? null); }
        if ('resourceName' in b) put('resource_name', b.resourceName); if ('uom' in b) put('uom', b.uom);
        if (money) { put('qty', f.qty); put('rate', f.rate); put('amount', f.amount); put('unrated', 0); }
        return transaction(db, () => {
          db.prepare(`UPDATE bud_lines SET ${sets.join(', ')}, adjust_reason = ?, adjusted_by = ?, adjusted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...vals, b.reason, actor.user, nowIso(), actor.user, nowIso(), l.id);
          if (money && f.amount !== l.amount) db.prepare('UPDATE bud_phasing SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE line_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, l.id);
          retotal(r.id); audit(actor, 'bud_lines', l.id, 'adjust', r.company_id, { reason: b.reason, oldValues: { qty: l.qty / 1000, rate: l.rate / 10000, amount: rupees(l.amount) }, newValues: { qty: f.qty / 1000, rate: f.rate / 10000, amount: rupees(f.amount) } });
          return lineView(db.prepare('SELECT * FROM bud_lines WHERE id = ?').get(l.id));
        });
      },
      remove(actor, lineId, { reason }) {
        const l = db.prepare('SELECT * FROM bud_lines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(lineId), actor.companyId); if (!l) throw notFound('That budget line does not exist.');
        const r = row(actor, l.budget_id, 'bud.budget.edit'); mustEdit(r);
        transaction(db, () => { const now = nowIso(); db.prepare('UPDATE bud_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, l.id); db.prepare('UPDATE bud_phasing SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE line_id = ? AND deleted_at IS NULL').run(now, actor.user, l.id); retotal(r.id); audit(actor, 'bud_lines', l.id, 'remove', r.company_id, { reason }); });
        return { id: l.id, deleted: true };
      },
      import(actor, id, b) {
        const r = row(actor, id, 'bud.budget.edit'); mustEdit(r); const made = []; const errors = [];
        b.rows.forEach((x, i) => { try { const v = budgets.lines.create(actor, r.id, { ...x, reason: x.reason ?? 'Imported' }); made.push({ row: i + 1, id: v.id }); } catch (e) { errors.push({ row: i + 1, resource: x.resourceName, message: e.details?.[0]?.message ?? e.message }); } });
        return { created: made.length, errors, rows: made };
      },
    },

    // ---- time phasing (FR-05) ------------------------------------------------------------------------------------------------------------------------------------
    phasing: {
      get(actor, id) {
        const r = row(actor, id); const rows = db.prepare('SELECT period, SUM(amount) AS a, SUM(qty) AS q FROM bud_phasing WHERE budget_id = ? AND deleted_at IS NULL GROUP BY period ORDER BY period').all(r.id); let cum = 0; const total = r.total_amount || 1;
        const periods = rows.map((p) => { cum += p.a; return { period: p.period, amount: rupees(p.a), cumulative: rupees(cum), cumulativePct: Number(((cum / total) * 100).toFixed(2)) }; });
        const ls = linesOf(r.id).filter((l) => l.amount > 0); const unphased = ls.filter((l) => phasedOf(l.id).a !== l.amount);
        return { budgetId: r.id, method: r.phasing_method, methodLabel: r.phasing_method ? METHODS[r.phasing_method] : null, periods, phasedTotal: rupees(cum), total: rupees(r.total_amount), reconciled: cum === r.total_amount && unphased.length === 0, unphasedLines: unphased.length, profiles: PROFILES };
      },
      lineGet(actor, lineId) { const l = db.prepare('SELECT * FROM bud_lines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(lineId), actor.companyId); if (!l) throw notFound('That budget line does not exist.'); row(actor, l.budget_id); return { lineId: l.id, amount: rupees(l.amount), rows: db.prepare('SELECT period, amount, method FROM bud_phasing WHERE line_id = ? AND deleted_at IS NULL ORDER BY period').all(l.id).map((p) => ({ period: p.period, amount: rupees(p.amount), method: p.method })) }; },
      /** Manual phasing of one line: the months must add up to the amount of the line. */
      lineSet(actor, lineId, { rows }) {
        const l = db.prepare('SELECT * FROM bud_lines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(lineId), actor.companyId); if (!l) throw notFound('That budget line does not exist.');
        const r = row(actor, l.budget_id, 'bud.budget.edit'); mustEdit(r); const sum = rows.reduce((a, x) => a + Math.round(x.amount * 100), 0); if (new Set(rows.map((x) => x.period)).size !== rows.length) throw unprocessable('A month is given twice.');
        if (sum !== l.amount) throw unprocessable(`The months add up to ₹ ${rupees(sum)}, the line is ₹ ${rupees(l.amount)}: the phasing must add up to the budget.`);
        return transaction(db, () => {
          db.prepare('UPDATE bud_phasing SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE line_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, l.id);
          for (const x of rows) { const a = Math.round(x.amount * 100); if (a > 0) db.prepare("INSERT INTO bud_phasing (company_id, budget_id, line_id, period, amount, qty, method, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, 'api')").run(l.company_id, r.id, l.id, x.period, a, l.amount ? Math.round((l.qty * a) / l.amount) : 0, r.org_project_id, actor.user); }
          db.prepare("UPDATE bud_budgets SET phasing_method = COALESCE(phasing_method, 'MANUAL') WHERE id = ?").run(r.id); audit(actor, 'bud_phasing', l.id, 'phase', r.company_id, { newValues: { months: rows.length } }); return budgets.phasing.lineGet(actor, l.id);
        });
      },
      /** S-curve profile (or the schedule, when 13.02 is built): every line is spread over the months from `from` to `to` (default: the contract period) and the last month takes the rounding, so the phasing always adds up to the budget. */
      generate(actor, id, b) {
        const r = row(actor, id, 'bud.budget.edit'); mustEdit(r);
        if (b.method === 'SCHEDULE') {
          if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sch_activities'").get()) throw unprocessable('Phasing from the schedule is available when the schedule is built (13.02). Use an S-curve profile or phase by hand.');
          throw unprocessable('Phasing from the schedule is not connected yet.');
        }
        const x = projOf(r.org_project_id); const from = b.from ?? x?.start_date?.slice(0, 7); const to = b.to ?? x?.scheduled_completion?.slice(0, 7);
        if (!from || !to) throw unprocessable('The project has no start date and completion date: give the first and the last month.'); if (to < from) throw unprocessable('The last month is before the first month.');
        const months = monthsBetween(from, to); if (months.length > 120) throw unprocessable('The phasing is over at most 120 months.'); const w = profileWeights(b.profile, months.length);
        return transaction(db, () => {
          db.prepare('UPDATE bud_phasing SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE budget_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id);
          const ins = db.prepare("INSERT INTO bud_phasing (company_id, budget_id, line_id, period, amount, qty, method, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'SCURVE', ?, ?, 'api')");
          for (const l of linesOf(r.id)) { if (l.amount <= 0) continue; const a = splitBy(l.amount, w); const q = splitBy(l.qty, w); months.forEach((m, i) => { if (a[i] > 0 || q[i] > 0) ins.run(l.company_id, r.id, l.id, m, a[i], q[i], r.org_project_id, actor.user); }); }
          db.prepare('UPDATE bud_budgets SET phasing_method = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('SCURVE', actor.user, nowIso(), r.id); audit(actor, 'bud_phasing', r.id, 'phase', r.company_id, { newValues: { profile: b.profile, months: months.length } });
          return budgets.phasing.get(actor, r.id);
        });
      },
    },

    // ---- the decision of the workflow ----------------------------------------------------------------------------------------------------------------------------
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') {
        transaction(db, () => {
          const now = nowIso(); db.prepare("UPDATE bud_budgets SET status = 'APPROVED', approved_at = ?, approved_by = ?, locked_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, actor.user, now, r.id);
          if (r.parent_budget_id) db.prepare("UPDATE bud_budgets SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_budget_id);
          audit(actor, 'bud_budgets', r.id, 'approve', r.company_id); const f = fresh(r.id); const m = margin(f);
          event('bud.budget.approved', actor, r.id, r.company_id, r.org_project_id, {
            projectId: r.org_project_id, budgetId: r.id, docNo: r.doc_no, versionNo: r.version_no, vtype: r.vtype, total: rupees(f.total_amount), direct: rupees(f.direct_total), overhead: rupees(f.overhead_total), contingency: rupees(f.contingency_total), reserve: rupees(f.reserve_total),
            contractValue: rupees(f.contract_value), marginPct: m.marginPct, marginWarning: m.warning, supersedes: r.parent_budget_id, byCostHead: viewsOf(f, 'cost_head').rows.map((x) => ({ label: x.label, amount: x.amount })),
          });
          notify(f, 'bud.budget.approved', [f.requested_by, projOf(r.org_project_id)?.pm_user], f.doc_no, f.name, `Budget ${f.doc_no} version ${f.version_no} is approved and locked.`, `/bud/budget?id=${f.id}`);
        });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE bud_budgets SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, nowIso(), r.id); audit(actor, 'bud_budgets', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
    },
  };
  function numberFor(actor) {
    try { return issueNumber(db, { companyId: actor.companyId, docType: BUDGET_DOC, actor: actor.user, refType: 'bud_budgets' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM bud_budgets WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1; return `BUD/${String(n).padStart(5, '0')}`;
  }
  return { budgets, budgetDecide: budgets.decide, budgetOptions: budgets.options };
}

// ---- workflow, evidence ---------------------------------------------------------------------------------------------------------------------------------------------
const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const bline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM bud_budgets x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: BUDGET_DOC, label: 'Project budget', processOwner: 'PCMGR', route: (id) => `/bud/budget?id=${id}`,
  describe(db, companyId, id) { const r = bline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const r = bline(db, rid(id)); if (!r) return null; const cv = r.contract_value; const basis = r.direct_total + r.overhead_total + r.contingency_total;
    return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Version', value: `${r.version_no} (${VTYPES[r.vtype]})` }, { label: 'Budget total', value: `₹ ${rupees(r.total_amount)}` }, { label: 'Contract value', value: `₹ ${rupees(cv)}` }, { label: 'Margin left', value: `₹ ${rupees(cv - basis)}` }, { label: 'Reason', value: r.reason ?? '' }] };
  },
  defaultDefinition: { name: 'Project budget: the project control manager, the project manager, the project director, and the director above ₹ 50 crore', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PCMGR', 'Project control manager', 'PCMGR'), step('PM', 'Project manager', 'PM'), step('PD', 'Project director', 'PD'), step('DIR', 'Director (above ₹ 50 crore)', 'DIR', { field: 'amount', op: 'gte', value: DIRECTOR_ABOVE_RUPEES })] },
  hooks: {
    onApproved: (db, { instance, actor }) => budOf(db)?.budgetDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => budOf(db)?.budgetDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => budOf(db)?.budgetDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => budOf(db)?.budgetDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(BUDGET_DOC, ({ db, instance }) => {
  const r = bline(db, rid(instance.docId)); if (!r) return { sections: [] }; const cv = r.contract_value; const basis = r.direct_total + r.overhead_total + r.contingency_total; const limit = cv - Math.round((cv * r.target_margin_pct) / 1_000_000);
  const adjusted = db.prepare("SELECT COUNT(*) AS n FROM bud_lines WHERE budget_id = ? AND deleted_at IS NULL AND (origin = 'MANUAL' OR (gen_amount IS NOT NULL AND gen_amount <> amount))").get(r.id).n;
  return { sections: [{ code: 'bud-budget', title: 'Before you approve the budget', kind: 'metrics', items: [
    { label: 'Budget total', value: Number(rupees(r.total_amount)), format: 'inr' }, { label: 'Direct cost', value: Number(rupees(r.direct_total)), format: 'inr' }, { label: 'Overheads', value: Number(rupees(r.overhead_total)), format: 'inr' }, { label: 'Contingency', value: Number(rupees(r.contingency_total)), format: 'inr' }, { label: 'Management reserve', value: Number(rupees(r.reserve_total)), format: 'inr' },
    { label: 'Contract value', value: Number(rupees(cv)), format: 'inr' }, { label: 'Margin left', value: `${cv > 0 ? ((cv - basis) / cv * 100).toFixed(2) : '0'} % (target ${r.target_margin_pct / 10000} %)`, format: 'text' }, { label: 'Above the margin limit', value: basis > limit ? `Yes, by ₹ ${rupees(basis - limit)}` : 'No', format: 'text' },
    { label: 'Lines added or adjusted since the generation', value: String(adjusted), format: 'text' }, { label: 'Lines', value: String(r.lines_count), format: 'text' }] }] };
});
void esc;
