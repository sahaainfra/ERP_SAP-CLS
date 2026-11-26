import { transaction } from '../../platform/db/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import {
  BAND_PCT, CHANGE_DOC, CHANGE_STATUS, CHANGE_TYPES, DRAWDOWN_DOC, LINE_KINDS, QTY_TYPES, REASONS, RESOURCE_TYPES, cell, esc, nowIso, rateOf, rid, rupees, same, signed, splitBy,
} from './constants.js';
import { budOf } from './budgets.js';

// Budget changes (part 12.02). A change asks to move the approved budget of a project: a revision (variation, scope change, rate escalation, re-estimate) changes the total; a transfer moves money between lines and nets to zero (BR-01);
// a contingency drawdown moves money from the contingency to the lines a realised risk (10.06) needs, never more than the contingency left (BR-01); an approved variation (21.05) drafts a revision by itself. Each change shows its lines before and
// after, the effect on the total and the margin, and goes through its approval band (BR-02): a revision or transfer to the project control manager, the project director and, above 5 % of the budget, the director; a drawdown to the project manager
// and the project director. Approved, it becomes a new approved version of the budget, which is the one in force for the checks (FR-05); the versions are compared line by line.
export const changeList = defineList({
  code: 'bud.changes', label: 'Budget change requests', permission: 'bud.change.view',
  from: 'bud_changes x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'x.justification', 'x.variation_ref', 'p.code'], defaultSort: '-docDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Change no.' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    docDate: { sql: 'x.doc_date', type: 'date', label: 'Date' }, changeType: { sql: 'x.change_type', type: 'enum', label: 'Type', options: Object.entries(CHANGE_TYPES) }, reasonCode: { sql: 'x.reason_code', type: 'enum', label: 'Reason', options: Object.entries(REASONS) },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(CHANGE_STATUS) }, totalDelta: { sql: 'x.total_delta', type: 'number', label: 'Change of the total' }, moved: { sql: 'x.moved_amount', type: 'number', label: 'Amount moved' },
    pct: { sql: 'x.pct_of_budget', type: 'number', label: '% of budget' }, requestedBy: { sql: 'x.requested_by', type: 'text', label: 'Requested by' },
  },
});

export function createChangeService({ db, base }) {
  const { may, need, fail, audit, event, notify, orgOf, projOf, project, retotal, linesOf, margin, wbsMeta, wpOf, codeById, currentOf, numberFor: budgetNumber } = base;
  const scopeSql = base.scopeSql;
  const freshC = (id) => db.prepare('SELECT * FROM bud_changes WHERE id = ?').get(id);
  const linesOfC = (id) => db.prepare('SELECT * FROM bud_change_lines WHERE change_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(id);
  function row(actor, id, key = 'bud.change.view') {
    const r = db.prepare('SELECT * FROM bud_changes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'bud.change.view', r.org_project_id)) throw notFound('That budget change does not exist.');
    if (key !== 'bud.change.view') need(actor, key, 'do that with a budget change', r.org_project_id);
    return r;
  }
  const numberFor = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: CHANGE_DOC, actor: actor.user, refType: 'bud_changes' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM bud_changes WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1; return `BCR/${String(n).padStart(5, '0')}`;
  };
  const riskOf = (projectId, riskId) => (riskId ? db.prepare("SELECT id, doc_no, title, rtype, status, emv, contingency_allocated FROM proj_risks WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL").get(riskId, projectId) : null);
  /** The contingency still free: the contingency of the budget in force less the drawdowns already waiting for approval (other than this one). */
  const pendingDrawdowns = (projectId, exceptId) => db.prepare("SELECT COALESCE(SUM(moved_amount), 0) AS a FROM bud_changes WHERE org_project_id = ? AND change_type = 'DRAWDOWN' AND status = 'SUBMITTED' AND deleted_at IS NULL AND id <> ?").get(projectId, exceptId ?? 0).a;

  /**
   * The lines of a change against the budget in force, checked and with the values before; the rules of its type applied (BR-01); the effect on the total, the share of the budget and the margin computed here, never taken from the client.
   * A drawdown names only the lines that receive money; the reduction of the contingency is added here.
   */
  function evaluate(actor, o, cur, b) {
    const p = []; const out = []; const type = b.changeType; const byId = new Map(linesOf(cur.id).map((l) => [l.id, l])); const seen = new Set();
    (b.lines ?? []).forEach((x, i) => {
      const f = (field, message) => p.push({ field: `lines.${i}.${field}`, message });
      const amountDelta = Math.round(Number(x.amountDelta) * 100); const qtyDelta = Math.round(Number(x.qtyDelta ?? 0) * 1000);
      if (x.lineId) {
        const l = byId.get(x.lineId); if (!l) { f('lineId', 'Choose a line of the budget in force'); return; }
        if (seen.has(l.id)) { f('lineId', 'A line is named twice'); return; } seen.add(l.id);
        if (l.amount + amountDelta < 0) f('amountDelta', `The line would go below zero (it is ₹ ${rupees(l.amount)})`);
        if (l.qty + qtyDelta < 0) f('qtyDelta', 'The quantity would go below zero');
        if (type === 'TRANSFER' && ['CONTINGENCY', 'RESERVE'].includes(l.line_kind)) f('lineId', 'Contingency and reserve are not transferred: use a drawdown');
        if (type === 'DRAWDOWN' && l.line_kind === 'CONTINGENCY') f('lineId', 'Name the lines that receive the money; the contingency is reduced by itself');
        if (type === 'DRAWDOWN' && amountDelta < 0) f('amountDelta', 'A drawdown only adds to lines');
        out.push({ lineId: l.id, lineKind: l.line_kind, wbsId: l.wbs_id, costCodeId: l.cost_code_id, resourceType: l.resource_type, resourceName: l.resource_name, uom: l.uom, qtyBefore: l.qty, amountBefore: l.amount, qtyDelta, amountDelta, note: x.note ?? null });
      } else {
        const kind = x.lineKind ?? 'DIRECT'; const rtype = x.resourceType ?? 'OTHER';
        if (!x.resourceName || x.resourceName.length < 2) f('resourceName', 'Name the resource of the new line');
        if (x.wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(x.wbsId, o.id)) f('wbsId', 'Choose a WBS node of this project');
        if (kind === 'DIRECT' && !x.wbsId) f('wbsId', 'A direct line sits on a WBS node');
        if (['CONTINGENCY', 'RESERVE'].includes(kind) && x.wbsId) f('wbsId', 'Contingency and reserve are not on a WBS node');
        if (x.costCodeId && !codeById(actor.companyId, x.costCodeId)) f('costCodeId', 'Choose an active cost code');
        if (['DIRECT', 'OVERHEAD'].includes(kind) && !x.costCodeId) f('costCodeId', 'A direct or overhead line carries a cost code');
        if (amountDelta < 0) f('amountDelta', 'A new line starts from zero: it can only be added to');
        if (kind === 'DIRECT' && QTY_TYPES.includes(rtype) && (qtyDelta <= 0 || !x.uom)) f('qtyDelta', 'A new material, labour or plant line carries a quantity and a unit (BR-02 of 12.01)');
        if (type === 'TRANSFER' && ['CONTINGENCY', 'RESERVE'].includes(kind)) f('lineKind', 'Contingency and reserve are not transferred');
        if (type === 'DRAWDOWN' && kind === 'CONTINGENCY') f('lineKind', 'A drawdown takes from the contingency, it does not add to it');
        out.push({ lineId: null, lineKind: kind, wbsId: x.wbsId ?? null, costCodeId: x.costCodeId ?? null, resourceType: rtype, resourceName: x.resourceName ?? '', uom: x.uom ?? null, qtyBefore: 0, amountBefore: 0, qtyDelta, amountDelta, note: x.note ?? null });
      }
    });
    if (!out.length && b.requireLines !== false) p.push({ field: 'lines', message: 'Name at least one line that changes' });
    if (out.some((l) => l.amountDelta === 0 && l.qtyDelta === 0)) p.push({ field: 'lines', message: 'Every line changes by an amount or a quantity' });
    // the rules of the type (BR-01)
    const net = out.reduce((a, l) => a + l.amountDelta, 0); const issues = [];
    let drawdown = 0; let available = null;
    if (type === 'TRANSFER') {
      if (out.length < 2) p.push({ field: 'lines', message: 'A transfer takes from one line and gives to another' });
      if (net !== 0) issues.push({ code: 'NOT_NET_ZERO', text: `A transfer must net to zero: the lines add up to ₹ ${signed(net)} (BR-01).` });
    }
    // a revision or transfer may name a risk too: it is one of this project's, as for a drawdown
    if (type !== 'DRAWDOWN' && b.riskId && !riskOf(o.id, b.riskId)) p.push({ field: 'riskId', message: 'Choose a risk of this project' });
    if (type === 'DRAWDOWN') {
      const r = riskOf(o.id, b.riskId);
      if (!b.riskId) p.push({ field: 'riskId', message: 'Name the risk of the register (10.06) that the drawdown is for' });
      else if (!r) p.push({ field: 'riskId', message: 'Choose a risk of this project' });
      else if (r.rtype !== 'RISK' || ['CANCELLED'].includes(r.status) || (r.status === 'CLOSED')) p.push({ field: 'riskId', message: 'Choose a risk that is open or has occurred' });
      drawdown = net; const cont = linesOf(cur.id).filter((l) => l.line_kind === 'CONTINGENCY');
      available = cont.reduce((a, l) => a + l.amount, 0) - pendingDrawdowns(o.id, b.changeId);
      if (drawdown <= 0) p.push({ field: 'lines', message: 'Say how much each line receives' });
      else if (drawdown > available) issues.push({ code: 'OVER_CONTINGENCY', text: `The drawdown of ₹ ${rupees(drawdown)} is more than the contingency left, ₹ ${rupees(Math.max(0, available))} (BR-01).` });
      else { let left = drawdown; for (const l of cont) { if (left <= 0) break; const take = Math.min(l.amount, left); left -= take; out.push({ lineId: l.id, lineKind: 'CONTINGENCY', wbsId: null, costCodeId: l.cost_code_id, resourceType: l.resource_type, resourceName: l.resource_name, uom: l.uom, qtyBefore: l.qty, amountBefore: l.amount, qtyDelta: 0, amountDelta: -take, note: 'Drawdown', auto: true }); } }
    }
    const totalDelta = out.reduce((a, l) => a + l.amountDelta, 0); const moved = out.reduce((a, l) => a + (l.amountDelta > 0 ? l.amountDelta : 0), 0);
    const base = cur.total_amount || 1; const pct = Math.round(((['TRANSFER', 'DRAWDOWN'].includes(type) ? moved : Math.abs(totalDelta)) * 1_000_000) / base);
    const sumKind = (k) => out.filter((l) => l.lineKind === k).reduce((a, l) => a + l.amountDelta, 0);
    const after = { ...cur, direct_total: cur.direct_total + sumKind('DIRECT'), overhead_total: cur.overhead_total + sumKind('OVERHEAD'), contingency_total: cur.contingency_total + sumKind('CONTINGENCY'), reserve_total: cur.reserve_total + sumKind('RESERVE'), total_amount: cur.total_amount + totalDelta };
    const mb = margin(cur); const ma = margin(after); const director = !['DRAWDOWN'].includes(type) && pct > BAND_PCT * 10000;
    return {
      problems: p, issues, lines: out, net, totalDelta, moved, pct, drawdown, available, before: cur, after,
      impact: {
        budgetId: cur.id, budgetDocNo: cur.doc_no, versionNo: cur.version_no, totalBefore: rupees(cur.total_amount), totalAfter: rupees(after.total_amount), totalDelta: signed(totalDelta), moved: rupees(moved), pctOfBudget: pct / 10000, net: signed(net),
        marginBefore: mb.margin, marginAfter: ma.margin, marginPctBefore: mb.marginPct, marginPctAfter: ma.marginPct, warningAfter: ma.warning, contingencyBefore: rupees(cur.contingency_total), contingencyAfter: rupees(after.contingency_total),
        contingencyAvailable: available == null ? null : rupees(Math.max(0, available)), chain: type === 'DRAWDOWN' ? ['PM', 'PD'] : director ? ['PCMGR', 'PD', 'DIR'] : ['PCMGR', 'PD'], directorRequired: director, bandPct: BAND_PCT,
      },
    };
  }
  const lineOut = (l) => {
    const w = wbsMeta(l.wbs_id); const cc = l.cost_code_id ? db.prepare('SELECT code, name FROM fin_cost_codes WHERE id = ?').get(l.cost_code_id) : null;
    const qb = l.qty_before ?? l.qtyBefore; const qd = l.qty_delta ?? l.qtyDelta; const ab = l.amount_before ?? l.amountBefore; const ad = l.amount_delta ?? l.amountDelta;
    return { id: l.id ?? null, lineId: l.line_id ?? l.lineId ?? null, lineKind: l.line_kind ?? l.lineKind, lineKindLabel: LINE_KINDS[l.line_kind ?? l.lineKind], wbsId: l.wbs_id ?? l.wbsId ?? null, wbsCode: w?.code ?? null, costCodeId: l.cost_code_id ?? l.costCodeId ?? null, costCode: cc?.code ?? null, resourceType: l.resource_type ?? l.resourceType, resourceTypeLabel: RESOURCE_TYPES[l.resource_type ?? l.resourceType], resourceName: l.resource_name ?? l.resourceName, uom: l.uom,
      qtyBefore: qb / 1000, qtyDelta: qd / 1000, qtyAfter: (qb + qd) / 1000, amountBefore: rupees(ab), amountDelta: signed(ad), amountAfter: rupees(ab + ad), isNew: !(l.line_id ?? l.lineId), note: l.note ?? null };
  };
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const editable = ['DRAFT', 'RETURNED'].includes(r.status);
    const risk = r.risk_id ? db.prepare('SELECT id, doc_no, title, status FROM proj_risks WHERE id = ?').get(r.risk_id) : null; const res = r.result_budget_id ? db.prepare('SELECT id, doc_no, version_no FROM bud_budgets WHERE id = ?').get(r.result_budget_id) : null;
    const v = {
      id: r.id, docNo: r.doc_no, docDate: r.doc_date, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, budgetId: r.budget_id, changeType: r.change_type, changeTypeLabel: CHANGE_TYPES[r.change_type], reasonCode: r.reason_code, reasonLabel: REASONS[r.reason_code],
      title: r.title, justification: r.justification, riskId: r.risk_id, risk: risk ? { id: risk.id, docNo: risk.doc_no, title: risk.title, status: risk.status } : null, variationId: r.variation_id, variationRef: r.variation_ref, status: r.status, statusLabel: CHANGE_STATUS[r.status],
      budgetTotalBefore: rupees(r.budget_total_before), totalDelta: signed(r.total_delta), moved: rupees(r.moved_amount), pctOfBudget: r.pct_of_budget / 10000, marginBefore: signed(r.margin_before), marginAfter: signed(r.margin_after),
      resultBudget: res ? { id: res.id, docNo: res.doc_no, versionNo: res.version_no } : null, amendsChangeId: r.amends_change_id, approvedAt: r.approved_at, approvedBy: r.approved_by, requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version, sourceType: r.source_type,
      can: {
        edit: can('bud.change.edit') && editable, submit: can('bud.change.submit') && editable, withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('bud.change.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status),
        delete: can('bud.change.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, amend: can('bud.change.amend') && ['REJECTED', 'CANCELLED'].includes(r.status), print: can('bud.change.print'), export: can('bud.change.export'),
      },
    };
    if (detail) {
      v.lines = linesOfC(r.id).map(lineOut);
      const cur = currentOf(r.org_project_id); v.stale = editable && Boolean(cur) && cur.id !== r.budget_id;
      if (editable && cur && !v.stale) { const e = evaluate(actor, o, cur, { changeType: r.change_type === 'VARIATION' ? 'REVISION' : r.change_type, riskId: r.risk_id, changeId: r.id, lines: linesOfC(r.id).filter((l) => !(r.change_type === 'DRAWDOWN' && l.line_kind === 'CONTINGENCY')).map((l) => ({ lineId: l.line_id, lineKind: l.line_kind, wbsId: l.wbs_id, costCodeId: l.cost_code_id, resourceType: l.resource_type, resourceName: l.resource_name, uom: l.uom, qtyDelta: l.qty_delta / 1000, amountDelta: l.amount_delta / 100 })) }); v.impact = e.impact; v.issues = [...e.issues, ...e.problems.map((x) => ({ code: 'FIELD', text: x.message }))]; }
      else v.impact = null;
    }
    return v;
  }
  function save(actor, o, cur, b, changeId = null) {
    const e = evaluate(actor, o, cur, { ...b, changeId, requireLines: b.changeType !== 'VARIATION' }); fail(e.problems);
    if (e.issues.length) throw unprocessable(e.issues.map((i) => i.text).join(' '));
    return e;
  }
  function writeLines(actor, changeId, companyId, projectId, e) {
    db.prepare('UPDATE bud_change_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE change_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, changeId);
    const ins = db.prepare("INSERT INTO bud_change_lines (company_id, change_id, line_id, line_kind, wbs_id, cost_code_id, resource_type, resource_name, uom, qty_before, amount_before, qty_delta, amount_delta, note, sort_order, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')");
    e.lines.forEach((l, i) => ins.run(companyId, changeId, l.lineId, l.lineKind, l.wbsId, l.costCodeId, l.resourceType, l.resourceName, l.uom, l.qtyBefore, l.amountBefore, l.qtyDelta, l.amountDelta, l.note, i + 1, projectId, actor.user));
    db.prepare('UPDATE bud_changes SET budget_id = ?, budget_total_before = ?, total_delta = ?, moved_amount = ?, pct_of_budget = ?, margin_before = ?, margin_after = ? WHERE id = ?')
      .run(e.before.id, e.before.total_amount, e.totalDelta, e.moved, e.pct, Math.round(Number(margin(e.before).margin) * 100), Math.round(Number(margin(e.after).margin) * 100), changeId);
  }
  const needCurrent = (o) => { const cur = currentOf(o.id); if (!cur) throw unprocessable('The project has no approved budget (12.01): there is nothing to change yet.'); return cur; };
  const draftBudget = (projectId) => db.prepare("SELECT doc_no FROM bud_budgets WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(projectId);
  const inputOf = (r, lines) => ({ changeType: r.change_type === 'VARIATION' ? 'REVISION' : r.change_type, riskId: r.risk_id, lines: lines.filter((l) => !(r.change_type === 'DRAWDOWN' && l.line_kind === 'CONTINGENCY')).map((l) => ({ lineId: l.line_id, lineKind: l.line_kind, wbsId: l.wbs_id, costCodeId: l.cost_code_id, resourceType: l.resource_type, resourceName: l.resource_name, uom: l.uom, qtyDelta: l.qty_delta / 1000, amountDelta: l.amount_delta / 100, note: l.note })) });

  // ---- applying an approved change: a new approved version of the budget (FR-05) ----------------------------------------------------------------------------------------
  function apply(actor, c) {
    const cur = currentOf(c.org_project_id); if (!cur) return null; const now = nowIso();
    const vno = (db.prepare('SELECT MAX(version_no) AS n FROM bud_budgets WHERE org_project_id = ? AND deleted_at IS NULL').get(c.org_project_id).n ?? 1) + 1;
    const nid = Number(db.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, version_no, vtype, name, baseline_pack_id, boq_version_id, parent_budget_id, status, contract_value, target_margin_pct, baseline_cost, phasing_method, approved_at, approved_by, locked_at, workflow_instance_id, requested_by, reason, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'REVISED', ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bud_change', ?)")
      .run(cur.company_id, budgetNumber({ companyId: cur.company_id, user: actor.user }), todayIST(), cur.org_project_id, vno, cur.name, cur.baseline_pack_id, cur.boq_version_id, cur.id, projOf(cur.org_project_id)?.contract_value ?? cur.contract_value, cur.target_margin_pct, cur.baseline_cost, cur.phasing_method, now, actor.user, now, c.workflow_instance_id, c.requested_by, `${c.doc_no}: ${c.title}`.slice(0, 1000), cur.org_project_id, actor.user, String(c.id)).lastInsertRowid);
    const deltas = new Map(); const added = [];
    for (const l of linesOfC(c.id)) { if (l.line_id) deltas.set(l.line_id, l); else added.push(l); }
    const months = db.prepare('SELECT DISTINCT period FROM bud_phasing WHERE budget_id = ? AND deleted_at IS NULL ORDER BY period').all(cur.id).map((x) => x.period);
    const thisMonth = todayIST().slice(0, 7); const ahead = months.filter((m) => m >= thisMonth); const spreadOver = ahead.length ? ahead : months.slice(-1);
    const insLine = db.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, work_package_id, boq_line_id, cost_code_id, cost_head_id, resource_type, resource_name, uom, qty, rate, amount, gen_qty, gen_rate, gen_amount, origin, adjust_reason, adjusted_by, adjusted_at, unrated, sort_order, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)");
    const insPh = db.prepare("INSERT INTO bud_phasing (company_id, budget_id, line_id, period, amount, qty, method, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'bud_change')");
    const phase = (lid, oldRows, amount, qty) => {
      if (amount <= 0 && qty <= 0) return;
      const rows = oldRows.filter((p) => p.amount > 0); const periods = rows.length ? rows.map((p) => p.period) : spreadOver; if (!periods.length) return;
      const w = rows.length ? rows.map((p) => p.amount) : periods.map(() => 1); const a = splitBy(amount, w); const q = splitBy(qty, w); const method = rows[0]?.method ?? 'MANUAL';
      periods.forEach((m, i) => { if (a[i] > 0 || q[i] > 0) insPh.run(cur.company_id, nid, lid, m, a[i], q[i], method, cur.org_project_id, actor.user); });
    };
    let sort = 0;
    for (const l of linesOf(cur.id)) {
      const d = deltas.get(l.id); const qty = l.qty + (d?.qty_delta ?? 0); const amount = l.amount + (d?.amount_delta ?? 0); const rate = d ? (qty > 0 ? rateOf(qty, amount) : l.rate) : l.rate; sort = Math.max(sort, l.sort_order);
      const lid = Number(insLine.run(l.company_id, nid, l.line_kind, l.wbs_id, l.work_package_id, l.boq_line_id, l.cost_code_id, l.cost_head_id, l.resource_type, l.resource_name, l.uom, qty, rate, amount, l.gen_qty, l.gen_rate, l.gen_amount, l.origin, d ? `${c.doc_no}: ${d.note ?? c.title}`.slice(0, 1000) : l.adjust_reason, d ? actor.user : l.adjusted_by, d ? now : l.adjusted_at, l.sort_order, l.project_id, actor.user, d ? 'bud_change' : l.source_type, d ? String(c.id) : l.source_id).lastInsertRowid);
      const old = db.prepare('SELECT period, amount, qty, method FROM bud_phasing WHERE line_id = ? AND deleted_at IS NULL ORDER BY period').all(l.id);
      if (!d) { for (const p of old) insPh.run(cur.company_id, nid, lid, p.period, p.amount, p.qty, p.method, cur.org_project_id, actor.user); } else phase(lid, old, amount, qty);
    }
    for (const a of added) {
      const code = a.cost_code_id ? codeById(cur.company_id, a.cost_code_id) : null; const wp = a.wbs_id ? wpOf(cur.org_project_id, a.wbs_id) : null; const qty = a.qty_delta > 0 ? a.qty_delta : (a.uom ? 0 : 1000); const amount = a.amount_delta;
      const lid = Number(insLine.run(cur.company_id, nid, a.line_kind, a.wbs_id, wp?.id ?? null, null, code?.id ?? null, code?.cost_head_id ?? null, a.resource_type, a.resource_name, a.uom ?? 'LS', qty, qty > 0 ? rateOf(qty, amount) : 0, amount, null, null, null, 'MANUAL', `${c.doc_no}: ${a.note ?? c.title}`.slice(0, 1000), actor.user, now, (sort += 1), cur.org_project_id, actor.user, 'bud_change', String(c.id)).lastInsertRowid);
      phase(lid, [], amount, qty);
    }
    retotal(nid);
    db.prepare("UPDATE bud_budgets SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, cur.id);
    return nid;
  }

  const changes = {
    list(actor, query) {
      need(actor, 'bud.change.view', 'see budget changes'); const s = scopeSql(actor, 'bud.change.view');
      return runList(db, changeList, parseListRequest(changeList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, title: v.title, projectId: v.projectId, project: v.projectCode, docDate: v.docDate, changeType: v.changeType, changeTypeLabel: v.changeTypeLabel, reasonCode: v.reasonCode, reasonLabel: v.reasonLabel, status: v.status, statusLabel: v.statusLabel, totalDelta: v.totalDelta, moved: v.moved, pct: String(v.pctOfBudget), requestedBy: v.requestedBy }; } });
    },
    exportSource(actor, req) {
      need(actor, 'bud.change.export', 'export budget changes'); const s = scopeSql(actor, 'bud.change.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return {
        title: changeList.label, permission: 'bud.change.export', personal: false,
        columns: [{ key: 'docNo', label: 'Change no.', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'reason', label: 'Reason', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'totalDelta', label: 'Change of the total', type: 'text' }, { key: 'moved', label: 'Amount moved', type: 'text' }, { key: 'pct', label: '% of budget', type: 'text' }],
        rows: () => runList(db, changeList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, project: v.projectCode, type: v.changeTypeLabel, reason: v.reasonLabel, title: v.title, status: v.statusLabel, totalDelta: v.totalDelta, moved: v.moved, pct: String(v.pctOfBudget) }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All budget changes you may see'], count: () => countList(db, changeList, req, opts),
      };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    /** What a project offers to a change: the lines of the budget in force, the contingency left and the risks of the register. */
    options(actor, projectId) {
      const o = project(actor, projectId, 'bud.change.view', 'bud.change.view'); const cur = currentOf(o.id);
      return {
        projectId: o.id, budget: cur ? { id: cur.id, docNo: cur.doc_no, versionNo: cur.version_no, total: rupees(cur.total_amount), contingency: rupees(cur.contingency_total), contingencyAvailable: rupees(Math.max(0, cur.contingency_total - pendingDrawdowns(o.id, null))) } : null,
        lines: cur ? linesOf(cur.id).map((l) => { const w = wbsMeta(l.wbs_id); const cc = l.cost_code_id ? db.prepare('SELECT code FROM fin_cost_codes WHERE id = ?').get(l.cost_code_id) : null; return { id: l.id, lineKind: l.line_kind, wbsCode: w?.code ?? null, costCode: cc?.code ?? null, resourceType: l.resource_type, resourceName: l.resource_name, uom: l.uom, qty: l.qty / 1000, amount: rupees(l.amount) }; }) : [],
        risks: db.prepare("SELECT id, doc_no, title, status, emv FROM proj_risks WHERE org_project_id = ? AND rtype = 'RISK' AND status IN ('OPEN', 'OCCURRED', 'CLOSE_REQUESTED') AND deleted_at IS NULL ORDER BY doc_no").all(o.id).map((r) => ({ id: r.id, docNo: r.doc_no, title: r.title, status: r.status, emv: rupees(r.emv) })),
        wbs: db.prepare("SELECT id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL AND wbs_status = 'ACTIVE' ORDER BY code").all(o.id),
        costCodes: db.prepare("SELECT id, code, name FROM fin_cost_codes WHERE (company_id IS NULL OR company_id = ?) AND code_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code").all(actor.companyId),
      };
    },
    /** FR-01: the impact of a change before it is saved: lines before and after, the total, the share of the budget, the margin, the band; nothing is saved. */
    preview(actor, b) {
      const o = project(actor, b.projectId, 'bud.change.create', 'bud.change.view'); const cur = needCurrent(o); const e = evaluate(actor, o, cur, { ...b, changeId: b.changeId });
      return { impact: e.impact, lines: e.lines.map(lineOut), problems: e.problems, issues: e.issues, ok: !e.problems.length && !e.issues.length };
    },
    create(actor, b) {
      const o = project(actor, b.projectId, 'bud.change.create', 'bud.change.view'); const cur = needCurrent(o); const e = save(actor, o, cur, b);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO bud_changes (company_id, doc_no, doc_date, org_project_id, budget_id, change_type, reason_code, title, justification, risk_id, variation_ref, status, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)")
          .run(o.company_id, numberFor(actor), todayIST(), o.id, cur.id, b.changeType, b.reasonCode, b.title, b.justification, b.changeType === 'DRAWDOWN' ? b.riskId : (b.riskId ?? null), b.variationRef ?? null, actor.user, o.id, actor.user, b.sourceType ?? 'api').lastInsertRowid);
        writeLines(actor, id, o.company_id, o.id, e); audit(actor, 'bud_changes', id, 'create', o.company_id, { newValues: { type: b.changeType, totalDelta: signed(e.totalDelta) } });
        return changes.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'bud.change.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`${r.doc_no} is ${CHANGE_STATUS[r.status].toLowerCase()}: it is not edited now.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this budget change; reload it.');
      const o = orgOf(r.org_project_id); const cur = needCurrent(o);
      const input = { ...inputOf(r, linesOfC(r.id)), ...(b.riskId !== undefined ? { riskId: b.riskId } : {}), ...(b.lines ? { lines: b.lines } : {}), changeId: r.id };
      if (!b.lines && cur.id !== r.budget_id) throw conflict('The budget changed since this request was drafted: give its lines again against the budget in force.');
      const e = save(actor, o, cur, { ...input, changeType: r.change_type === 'VARIATION' ? 'REVISION' : r.change_type });
      return transaction(db, () => {
        const sets = []; const vals = []; for (const [k, c] of [['reasonCode', 'reason_code'], ['title', 'title'], ['justification', 'justification'], ['riskId', 'risk_id'], ['variationRef', 'variation_ref']]) if (k in b) { sets.push(`${c} = ?`); vals.push(b[k]); }
        db.prepare(`UPDATE bud_changes SET ${[...sets, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
        writeLines(actor, r.id, r.company_id, r.org_project_id, e); audit(actor, 'bud_changes', r.id, 'update', r.company_id); return changes.get(actor, r.id);
      });
    },
    remove(actor, id) {
      const r = row(actor, id, 'bud.change.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.');
      transaction(db, () => { const now = nowIso(); db.prepare('UPDATE bud_change_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE change_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE bud_changes SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'bud_changes', r.id, 'delete', r.company_id); });
      return { id: r.id, deleted: true };
    },
    /** BR-02: the band comes from the share of the budget, recomputed here; one change of a project is in approval at a time, so each is decided against the budget in force. */
    submit(actor, id) {
      const r = row(actor, id, 'bud.change.submit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or a returned change is sent for approval.');
      const o = orgOf(r.org_project_id); const cur = needCurrent(o); if (cur.id !== r.budget_id) throw conflict('The budget changed since this request was drafted: give its lines again against the budget in force.');
      const other = db.prepare("SELECT doc_no FROM bud_changes WHERE org_project_id = ? AND status = 'SUBMITTED' AND id <> ? AND deleted_at IS NULL").get(r.org_project_id, r.id); if (other) throw conflict(`${other.doc_no} of this project is waiting for approval: it is decided first.`);
      const d = draftBudget(r.org_project_id); if (d) throw conflict(`Budget ${d.doc_no} of this project is being revised: finish or cancel it first.`);
      const e = save(actor, o, cur, { ...inputOf(r, linesOfC(r.id)), changeId: r.id, requireLines: true });
      return transaction(db, () => {
        writeLines(actor, r.id, r.company_id, r.org_project_id, e);
        const ctx = { projectId: r.org_project_id, pct: e.pct / 10000, amount: Number(rupees(r.change_type === 'DRAWDOWN' || r.change_type === 'TRANSFER' ? e.moved : Math.abs(e.totalDelta))) };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: r.change_type === 'DRAWDOWN' ? DRAWDOWN_DOC : CHANGE_DOC, docId: String(r.id), comment: `${o.code} ${r.doc_no} ${r.title}`.slice(0, 300), context: ctx }); db.prepare('UPDATE bud_changes SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE bud_changes SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id);
        audit(actor, 'bud_changes', r.id, 'submit', r.company_id, { newValues: { pct: e.pct / 10000, totalDelta: signed(e.totalDelta) } }); return changes.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a change waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return changes.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'bud.change.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a change that is not decided is cancelled; an approved change is undone by another change.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE bud_changes SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'bud_changes', r.id, 'cancel', r.company_id, { reason }); return changes.get(actor, r.id); });
    },
    /** A rejected or cancelled change is raised again as a new draft with its lines, against the budget in force. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'bud.change.amend'); if (!['REJECTED', 'CANCELLED'].includes(r.status)) throw unprocessable('Only a rejected or cancelled change is raised again; an approved change is undone by another change.');
      const o = orgOf(r.org_project_id); const cur = needCurrent(o); const input = inputOf(r, linesOfC(r.id)); const e = evaluate(actor, o, cur, { ...input, changeId: null });
      return transaction(db, () => {
        const nid = Number(db.prepare("INSERT INTO bud_changes (company_id, doc_no, doc_date, org_project_id, budget_id, change_type, reason_code, title, justification, risk_id, variation_id, variation_ref, status, amends_change_id, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
          .run(r.company_id, numberFor(actor), todayIST(), r.org_project_id, cur.id, r.change_type, r.reason_code, r.title, `${r.justification ?? ''}\nRaised again: ${reason}`.trim().slice(0, 4000), r.risk_id, r.variation_ref, r.id, actor.user, r.org_project_id, actor.user).lastInsertRowid);
        const keep = e.lines.filter((l) => !l.auto && l.amountBefore + l.amountDelta >= 0 && l.qtyBefore + l.qtyDelta >= 0); writeLines(actor, nid, r.company_id, r.org_project_id, { ...e, lines: keep, totalDelta: keep.reduce((a, l) => a + l.amountDelta, 0), moved: keep.reduce((a, l) => a + Math.max(0, l.amountDelta), 0) });
        audit(actor, 'bud_changes', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return changes.get(actor, nid);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'bud_changes' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'bud.change.print'); const v = view(actor, r, { detail: true }); const company = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? '';
      const tr = (cells) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED CHANGE</strong></p>`}<h1>${esc(company)}</h1><h2>Budget change ${esc(v.docNo)} · ${esc(v.projectCode)} ${esc(v.projectName)}</h2>`
        + `<p>${esc(v.changeTypeLabel)} · ${esc(v.reasonLabel)} · ${esc(v.title)}</p><p>${esc(v.justification ?? '')}</p>${v.risk ? `<p>Risk ${esc(v.risk.docNo)} ${esc(v.risk.title)}</p>` : ''}${v.variationRef ? `<p>Variation ${esc(v.variationRef)}</p>` : ''}`
        + `<p>Budget before ₹ ${esc(v.budgetTotalBefore)} · change ₹ ${esc(v.totalDelta)} · moved ₹ ${esc(v.moved)} · ${v.pctOfBudget} % of the budget · margin ₹ ${esc(v.marginBefore)} → ₹ ${esc(v.marginAfter)}</p>`
        + `<table border="1" cellpadding="4"><tr><th>Kind</th><th>WBS</th><th>Cost code</th><th>Resource</th><th>Before (₹)</th><th>Change (₹)</th><th>After (₹)</th></tr>${v.lines.map((l) => tr([l.lineKindLabel, l.wbsCode ?? '—', l.costCode ?? '—', l.resourceName, l.amountBefore, l.amountDelta, l.amountAfter])).join('')}</table>${v.resultBudget ? `<p>Applied as budget ${esc(v.resultBudget.docNo)} version ${v.resultBudget.versionNo}</p>` : ''}</body></html>`;
    },
    import(actor, b) {
      const made = []; const errors = [];
      b.rows.forEach((x, i) => { try { const v = changes.create(actor, x); made.push({ row: i + 1, id: v.id, docNo: v.docNo }); } catch (e) { errors.push({ row: i + 1, title: x.title, message: e.details?.[0]?.message ?? e.message }); } });
      return { created: made.length, errors, rows: made };
    },

    // ---- FR-04: an approved variation drafts a revision by itself (21.05 publishes ctr.variation.approved) -------------------------------------------------------------
    fromVariation(event) {
      const d = event.data ?? {}; const projectId = Number(d.projectId); const variationId = Number(d.variationId); if (!projectId || !variationId) return null;
      const o = orgOf(projectId); if (!o || (event.companyId && o.company_id !== Number(event.companyId))) return null; const cur = currentOf(o.id); if (!cur) return null;
      if (db.prepare("SELECT 1 FROM bud_changes WHERE org_project_id = ? AND variation_id = ? AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL").get(o.id, variationId)) return null;
      const actor = { user: 'system', companyId: o.company_id, roles: ['SYSTEM'] };
      const lines = (Array.isArray(d.lines) ? d.lines : []).map((l) => ({ lineId: null, lineKind: 'DIRECT', wbsId: l.wbsId ?? null, costCodeId: l.costCodeId ?? null, resourceType: l.resourceType ?? 'OTHER', resourceName: String(l.resourceName ?? l.description ?? d.title ?? 'Variation work').slice(0, 200), uom: l.uom ?? null, qtyDelta: Number(l.qty ?? 0), amountDelta: Number(l.amount ?? 0), note: d.variationNo ?? null }));
      const e = evaluate(actor, o, cur, { changeType: 'REVISION', lines, requireLines: false }); const good = e.problems.length ? [] : e.lines;
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO bud_changes (company_id, doc_no, doc_date, org_project_id, budget_id, change_type, reason_code, title, justification, variation_id, variation_ref, status, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'VARIATION', 'VARIATION', ?, ?, ?, ?, 'DRAFT', ?, 'system', 'ctr_variation', ?)")
          .run(o.company_id, numberFor(actor), todayIST(), o.id, cur.id, `Variation ${d.variationNo ?? variationId}: ${d.title ?? ''}`.trim().slice(0, 200), `Drafted from the approved variation ${d.variationNo ?? variationId}${d.amount ? ` of ₹ ${d.amount}` : ''}.${e.problems.length ? ' Its lines could not be placed on the budget and must be given.' : ''}`, variationId, d.variationNo ?? null, o.id, String(variationId)).lastInsertRowid);
        writeLines(actor, id, o.company_id, o.id, { ...e, lines: good, totalDelta: good.reduce((a, l) => a + l.amountDelta, 0), moved: good.reduce((a, l) => a + Math.max(0, l.amountDelta), 0) });
        audit(actor, 'bud_changes', id, 'create', o.company_id, { newValues: { variationId, variationNo: d.variationNo ?? null } });
        const c = freshC(id); notify({ ...c, version_no: c.id }, 'bud.change.variation_draft', [projOf(o.id)?.pm_user], c.doc_no, c.title, 'A draft budget revision was made from an approved variation: check its lines and send it for approval.', `/bud/change?id=${c.id}`);
        return id;
      });
    },

    // ---- FR-05: versions compared ---------------------------------------------------------------------------------------------------------------------------------
    compare(actor, { projectId, from, to, by = 'line' }) {
      const o = project(actor, projectId, 'bud.budget.view', 'bud.budget.view');
      const versions = db.prepare("SELECT * FROM bud_budgets WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'SUPERSEDED') ORDER BY version_no, id").all(o.id);
      const vb = (id) => versions.find((v) => v.id === id);
      const B = to ? vb(to) : versions.at(-1); if (to && !B) throw notFound('That version does not exist.'); const A = from ? vb(from) : (B?.parent_budget_id ? vb(B.parent_budget_id) : null); if (from && !A) throw notFound('That version does not exist.');
      const keyOf = (l) => (by === 'cost_head' ? (l.cost_head_id ? `h${l.cost_head_id}` : `k${l.line_kind}`) : by === 'wbs' ? (l.wbs_id ? `w${l.wbs_id}` : `k${l.line_kind}`) : `${l.line_kind}|${l.wbs_id ?? ''}|${l.cost_code_id ?? ''}|${l.resource_type}|${l.resource_name.toLowerCase()}`);
      const labelOf = (l) => { if (by === 'cost_head') { const h = l.cost_head_id ? db.prepare('SELECT code, name FROM fin_cost_heads WHERE id = ?').get(l.cost_head_id) : null; return h ? `${h.code} ${h.name}` : LINE_KINDS[l.line_kind]; } if (by === 'wbs') { const w = wbsMeta(l.wbs_id); return w ? `${w.code} ${w.name}` : `Not allocated: ${LINE_KINDS[l.line_kind]}`; } const w = wbsMeta(l.wbs_id); return `${LINE_KINDS[l.line_kind]} · ${w?.code ?? '—'} · ${l.resource_name}`; };
      const rows = new Map(); const put = (l, side) => { const k = keyOf(l); const g = rows.get(k) ?? { key: k, label: labelOf(l), before: 0, after: 0, qtyBefore: 0, qtyAfter: 0, uom: by === 'line' ? l.uom : null }; g[side] += l.amount; g[side === 'before' ? 'qtyBefore' : 'qtyAfter'] += l.qty; rows.set(k, g); };
      if (A) for (const l of linesOf(A.id)) put(l, 'before'); if (B) for (const l of linesOf(B.id)) put(l, 'after');
      const out = [...rows.values()].map((g) => ({ key: g.key, label: g.label, before: rupees(g.before), after: rupees(g.after), delta: signed(g.after - g.before), deltaPaise: g.after - g.before, qtyBefore: by === 'line' ? g.qtyBefore / 1000 : null, qtyAfter: by === 'line' ? g.qtyAfter / 1000 : null, uom: g.uom, changed: g.after !== g.before })).sort((a, b) => Math.abs(b.deltaPaise) - Math.abs(a.deltaPaise) || a.label.localeCompare(b.label));
      const changeOf = (v) => (v.source_type === 'bud_change' ? db.prepare('SELECT id, doc_no, change_type, title FROM bud_changes WHERE id = ?').get(Number(v.source_id)) : null);
      const history = db.prepare('SELECT * FROM bud_changes WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(o.id).filter(() => may(actor, 'bud.change.view', o.id)).map((c) => ({ id: c.id, docNo: c.doc_no, changeType: c.change_type, changeTypeLabel: CHANGE_TYPES[c.change_type], title: c.title, status: c.status, statusLabel: CHANGE_STATUS[c.status], totalDelta: signed(c.total_delta), moved: rupees(c.moved_amount), pct: c.pct_of_budget / 10000, approvedAt: c.approved_at, resultBudgetId: c.result_budget_id }));
      return {
        projectId: o.id, projectCode: o.code, by, from: A ? { id: A.id, docNo: A.doc_no, versionNo: A.version_no, total: rupees(A.total_amount) } : null, to: B ? { id: B.id, docNo: B.doc_no, versionNo: B.version_no, total: rupees(B.total_amount) } : null,
        totalBefore: rupees(A?.total_amount ?? 0), totalAfter: rupees(B?.total_amount ?? 0), totalDelta: signed((B?.total_amount ?? 0) - (A?.total_amount ?? 0)), rows: out, changedRows: out.filter((x) => x.changed).length,
        versions: versions.map((v) => { const c = changeOf(v); return { id: v.id, docNo: v.doc_no, versionNo: v.version_no, vtype: v.vtype, status: v.status, current: v.status === 'APPROVED', total: rupees(v.total_amount), approvedAt: v.approved_at, reason: v.reason, change: c ? { id: c.id, docNo: c.doc_no, changeType: c.change_type, title: c.title } : null }; }), history,
      };
    },
    compareCsv(actor, q) {
      need(actor, 'bud.budget.export', 'export a budget comparison'); const c = changes.compare(actor, q);
      const head = ['Item', `Before (${c.from?.docNo ?? '-'})`, `After (${c.to?.docNo ?? '-'})`, 'Change']; const lines = [head, ...c.rows.map((r) => [r.label, r.before, r.after, r.delta]), ['Total', c.totalBefore, c.totalAfter, c.totalDelta]];
      audit(actor, 'bud_budgets', c.to?.id ?? 0, 'export', actor.companyId, { newValues: { compare: `${c.from?.docNo ?? '-'} → ${c.to?.docNo ?? '-'}` } });
      return { name: `budget-compare-${c.projectCode}.csv`, body: lines.map((r) => r.map((x) => `"${cell(x).replaceAll('"', '""')}"`).join(',')).join('\r\n') };
    },

    decide(instance, actor, outcome, comment) {
      const r = freshC(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') {
        transaction(db, () => {
          const prev = currentOf(r.org_project_id); const nid = apply(actor, r); const now = nowIso();
          db.prepare("UPDATE bud_changes SET status = 'APPROVED', approved_at = ?, approved_by = ?, result_budget_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, nid, actor.user, now, r.id);
          audit(actor, 'bud_changes', r.id, 'approve', r.company_id, { newValues: { resultBudgetId: nid } });
          const nb = nid ? db.prepare('SELECT * FROM bud_budgets WHERE id = ?').get(nid) : null;
          event('bud.change.approved', actor, r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, changeId: r.id, docNo: r.doc_no, changeType: r.change_type, reasonCode: r.reason_code, riskId: r.risk_id, variationId: r.variation_id, totalDelta: signed(r.total_delta), moved: rupees(r.moved_amount), pct: r.pct_of_budget / 10000, budgetId: nid });
          if (nb) event('bud.budget.revised', actor, nid, r.company_id, r.org_project_id, { projectId: r.org_project_id, budgetId: nid, previousBudgetId: prev?.id ?? null, versionNo: nb.version_no, total: rupees(nb.total_amount), totalBefore: rupees(prev?.total_amount ?? 0), delta: signed(nb.total_amount - (prev?.total_amount ?? 0)), source: 'CHANGE', changeId: r.id, changeType: r.change_type, reason: r.title });
          notify({ ...r, version_no: r.id }, 'bud.change.approved', [r.requested_by, projOf(r.org_project_id)?.pm_user], r.doc_no, r.title, `Budget change ${r.doc_no} is approved${nb ? ` and budget ${nb.doc_no} version ${nb.version_no} is now in force` : ''}.`, `/bud/change?id=${r.id}`);
        });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE bud_changes SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, nowIso(), r.id); audit(actor, 'bud_changes', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
    },
  };
  return { changes, changeDecide: changes.decide };
}

// ---- workflow, evidence ---------------------------------------------------------------------------------------------------------------------------------------------
const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const cline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM bud_changes x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
const hooks = {
  onApproved: (db, { instance, actor }) => budOf(db)?.changeDecide(instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => budOf(db)?.changeDecide(instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => budOf(db)?.changeDecide(instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => budOf(db)?.changeDecide(instance, actor, 'CANCELLED', comment),
};
const describe = (db, companyId, id) => { const r = cline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} ${CHANGE_TYPES[r.change_type]}: ${r.title}`, originator: r.requested_by } : null; };
const summarise = (db, _actor, id) => { const r = cline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Type', value: CHANGE_TYPES[r.change_type] }, { label: 'Reason', value: REASONS[r.reason_code] }, { label: 'Change of the total', value: `₹ ${signed(r.total_delta)}` }, { label: 'Amount moved', value: `₹ ${rupees(r.moved_amount)}` }, { label: 'Share of the budget', value: `${r.pct_of_budget / 10000} %` }, { label: 'Margin after', value: `₹ ${signed(r.margin_after)}` }] }; };
workflowTypes.register({
  docType: CHANGE_DOC, label: 'Budget revision or transfer', processOwner: 'PCMGR', route: (id) => `/bud/change?id=${id}`, describe, summarise, hooks,
  defaultDefinition: { name: `Budget revision or transfer: the project control manager, the project director, and the director above ${BAND_PCT} % of the budget`, settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PCMGR', 'Project control manager', 'PCMGR'), step('PD', 'Project director', 'PD'), step('DIR', `Director (above ${BAND_PCT} % of the budget)`, 'DIR', { field: 'pct', op: 'gt', value: BAND_PCT })] },
});
workflowTypes.register({
  docType: DRAWDOWN_DOC, label: 'Contingency drawdown', processOwner: 'PCMGR', route: (id) => `/bud/change?id=${id}`, describe, summarise, hooks,
  defaultDefinition: { name: 'Contingency drawdown: the project manager and the project director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PM', 'Project manager', 'PM'), step('PD', 'Project director', 'PD')] },
});
const evidence = ({ db, instance }) => {
  const r = cline(db, rid(instance.docId)); if (!r) return { sections: [] }; const risk = r.risk_id ? db.prepare('SELECT doc_no, title, status, emv FROM proj_risks WHERE id = ?').get(r.risk_id) : null;
  const cur = db.prepare('SELECT contingency_total FROM bud_budgets WHERE id = ?').get(r.budget_id);
  return { sections: [{ code: 'bud-change', title: 'Before you approve the budget change', kind: 'metrics', items: [
    { label: 'Type', value: CHANGE_TYPES[r.change_type], format: 'text' }, { label: 'Budget before', value: Number(rupees(r.budget_total_before)), format: 'inr' }, { label: 'Change of the total', value: `₹ ${signed(r.total_delta)}`, format: 'text' }, { label: 'Amount moved', value: Number(rupees(r.moved_amount)), format: 'inr' },
    { label: 'Share of the budget', value: `${r.pct_of_budget / 10000} % (director above ${BAND_PCT} %)`, format: 'text' }, { label: 'Margin before → after', value: `₹ ${signed(r.margin_before)} → ₹ ${signed(r.margin_after)}`, format: 'text' },
    ...(risk ? [{ label: 'Risk', value: `${risk.doc_no} ${risk.title} (${risk.status})`, format: 'text' }, { label: 'Contingency before', value: Number(rupees(cur?.contingency_total ?? 0)), format: 'inr' }] : []), ...(r.variation_ref ? [{ label: 'Variation', value: r.variation_ref, format: 'text' }] : [])] }] };
};
evidenceProviders.register(CHANGE_DOC, evidence);
evidenceProviders.register(DRAWDOWN_DOC, evidence);
