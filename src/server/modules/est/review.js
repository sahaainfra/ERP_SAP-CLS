import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { calcOf } from '../../platform/calc/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { dec } from '../../../shared/decimal.js';
import { todayIST } from '../../../shared/dates.js';
import { amountInWords } from '../../../shared/i18n/words.js';
import { ASSUMPTION_KINDS, COMPONENT_TYPES, REVIEW_ITEMS, STATUS, esc, money, nowIso, num, rid, same, units } from './constants.js';
import { estimateHooks, estimatesOf } from './estimate.js';

// Estimate review, approval, bid price summary and priced BOQ (part 09.03). The commercial manager reviews an estimate against the checklist (quantities checked, rates current, indirects complete, risks priced, assumptions
// listed) on the Estimate Review panel or in the inbox: the review step of the approval (EST, then COMMGR, then DIR) cannot be approved without ticking every item (FR-01, FR-04). The bid price summary shows the parts of the
// price from the estimate (direct cost, indirects, overhead, contingency, escalation, profit), the discount or rebate, GST and the final bid price, all from the calculation engine (est.bid_price; BR-01); a discount above the
// threshold is approved by the director before the estimate can be sent (EST_DISCOUNT). The register of assumptions, inclusions, exclusions and qualifications goes with the estimate (FR-03). The sensitivity shows what +/- x %
// on a key resource (steel, cement, labour, plant) does to the bid price and to the margin (FR-02, T-01); the unbalanced bidding analysis flags items priced well above or below the average markup or the client's rate (FR-06).
// The priced BOQ comes out in the client's format (Excel, PDF or print) with the rates in figures and in words (FR-05). Only an approved estimate is used for the bid (08.03) and the baseline (10.02) (BR-02).
export const DISCOUNT_DOC = 'EST_DISCOUNT';
for (const [key, dataType, def, description, extra] of [
  ['est.bid.discount_director_pct', 'decimal', '2', 'BR-01: a discount or rebate above this percentage of the selling amount is approved by the director before the estimate is sent for approval.', { min: 0, max: 100 }],
  ['est.unbalanced.band_points', 'decimal', '10', 'FR-06: an item whose markup is more than this many percentage points above or below the average markup of the estimate is flagged as unbalanced.', { min: 0, max: 100 }],
  ['est.unbalanced.client_band_pct', 'decimal', '25', 'FR-06: an item whose selling rate is more than this percentage above or below the client\'s rate is flagged.', { min: 0, max: 100 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });
const DONE_DISCOUNT = ['NOT_REQUIRED', 'APPROVED'];

export function createReviewService({ db }) {
  const authz = authzOf(db);
  const calc = () => calcOf(db);
  const E = () => estimatesOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const ev = (code, inputs, rec = null) => calc().evaluate(code, inputs, rec ? { entity: 'est_estimate', entityId: rec.id, field: rec.field, companyId: rec.companyId, user: rec.user } : {}).result;
  const costs = (actor) => may(actor, 'est.estimate.cost');
  /** The estimate as the actor may see it (09.01 decides: company, project grant). */
  const row = (actor, id) => { const e = E()?.access(actor, id); if (!e || !may(actor, 'est.estimate.view')) throw notFound('That estimate does not exist or is not yours to see.'); return e; };
  const fresh = (id) => db.prepare('SELECT * FROM est_estimates WHERE id = ?').get(id);
  const threshold = (companyId) => dec(String(param(companyId, 'est.bid.discount_director_pct') ?? '2'));

  // ---- the bid price summary (FR-02, BR-01) ------------------------------------------------------------------------------------------------
  const summaryRow = (eid) => db.prepare('SELECT * FROM est_bid_summary WHERE estimate_id = ? AND deleted_at IS NULL').get(eid) ?? null;
  /** The summary kept in step with the estimate: the parts from its totals, the discount kept, the price worked out by est.bid_price. */
  function sync(e, user = 'system') {
    let b = summaryRow(e.id);
    const pct = b ? num(b.discount_pct, 'percent') : '0';
    const r = ev('est.bid_price', { selling_amount: money(e.total_selling), discount_percent: pct, gst_percent: num(e.gst_pct, 'percent') }, { id: e.id, field: 'bid_price', companyId: e.company_id, user });
    const vals = [e.direct_cost, e.indirect_cost, e.overhead_amount, e.contingency_amount, e.escalation_amount, e.total_cost, e.total_selling - e.total_cost, e.total_selling, units(r.discount, 'money'), units(r.net, 'money'), e.gst_pct, units(r.gst, 'money'), units(r.bid_price, 'money'), nowIso()];
    if (!b) db.prepare("INSERT INTO est_bid_summary (company_id, estimate_id, direct_cost, indirect_cost, overhead_amount, contingency_amount, escalation_amount, total_cost, profit_amount, selling_amount, discount_amount, net_price, gst_pct, gst_amount, bid_price, calculated_at, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate', ?)").run(e.company_id, e.id, ...vals, e.project_id, user, String(e.id));
    else db.prepare('UPDATE est_bid_summary SET direct_cost = ?, indirect_cost = ?, overhead_amount = ?, contingency_amount = ?, escalation_amount = ?, total_cost = ?, profit_amount = ?, selling_amount = ?, discount_amount = ?, net_price = ?, gst_pct = ?, gst_amount = ?, bid_price = ?, calculated_at = ? WHERE id = ?').run(...vals, b.id);
    b = summaryRow(e.id); return b;
  }
  function summaryView(actor, e, b) {
    const c = costs(actor); const m = (u) => (c ? money(u) : null);
    const parts = [['direct', b.direct_cost], ['indirect', b.indirect_cost], ['overhead', b.overhead_amount], ['contingency', b.contingency_amount], ['escalation', b.escalation_amount], ['profit', b.profit_amount]];
    return {
      id: b.id, estimateId: e.id, parts: c ? parts.map(([k, v]) => ({ key: k, amount: money(v) })) : null, totalCost: m(b.total_cost), profit: m(b.profit_amount), profitPct: c && b.selling_amount ? dec(money(b.profit_amount)).mul(100).div(dec(money(b.selling_amount)), 6).round(2).toFixed(2) : null,
      selling: money(b.selling_amount), discountPct: num(b.discount_pct, 'percent'), discount: money(b.discount_amount), net: money(b.net_price), gstPct: num(b.gst_pct, 'percent'), gst: money(b.gst_amount), bidPrice: money(b.bid_price), bidPriceInWords: amountInWords(money(b.bid_price)),
      discountReason: b.discount_reason, discountStatus: b.discount_status, thresholdPct: threshold(e.company_id).toFixed(), workflowInstanceId: b.workflow_instance_id, requestedBy: b.requested_by, decidedAt: b.decided_at, rowVersion: b.version, calculatedAt: b.calculated_at,
      // BR-01: the parts add up to the bid price
      check: c ? { sumOfParts: dec(money(b.total_cost)).add(dec(money(b.profit_amount))).sub(dec(money(b.discount_amount))).add(dec(money(b.gst_amount))).toFixed(2), equals: b.total_cost + b.profit_amount - b.discount_amount + b.gst_amount === b.bid_price } : null,
    };
  }
  const editableEstimate = (actor, e) => {
    if (!['DRAFT', 'RETURNED'].includes(e.status)) throw new HttpError(409, 'LOCKED', `${e.doc_no}/v${e.version_no} is ${STATUS[e.status].toLowerCase()}; a change is a new version.`);
    if (!same(e.created_by, actor.user)) throw forbidden('Only the estimator who made this version changes its bid price.');
  };
  const summary = {
    get(actor, id) { need(actor, 'est.review.view', 'see bid summaries'); const e = row(actor, id); const b = ['DRAFT', 'RETURNED'].includes(e.status) || !summaryRow(e.id) ? transaction(db, () => sync(e, actor.user)) : summaryRow(e.id); return summaryView(actor, e, b); },
    /** BR-01: the discount or rebate; above the threshold it waits for the director. */
    update(actor, id, { discountPct, discountReason, version }) {
      need(actor, 'est.bid.edit', 'change bid prices'); const e = row(actor, id); editableEstimate(actor, e);
      const b0 = transaction(db, () => sync(e, actor.user));
      if (version != null && b0.version !== version) throw conflict(`The bid summary was changed by someone else (version ${b0.version}, you had ${version}); reload it.`);
      if (b0.discount_status === 'SUBMITTED') throw new HttpError(409, 'LOCKED', 'The discount is with the director; withdraw it first.');
      const pct = dec(String(discountPct));
      if (pct.gt(dec(0)) && String(discountReason ?? '').trim().length < 10) throw badRequest('Correct the highlighted fields', [{ field: 'discountReason', message: 'Say why the discount is given (at least 10 characters)' }]);
      const status = pct.gt(threshold(e.company_id)) ? 'DRAFT' : 'NOT_REQUIRED';
      return transaction(db, () => {
        db.prepare('UPDATE est_bid_summary SET discount_pct = ?, discount_reason = ?, discount_status = ?, workflow_instance_id = CASE WHEN ? = \'NOT_REQUIRED\' THEN NULL ELSE workflow_instance_id END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(units(pct.toFixed(), 'percent'), pct.gt(dec(0)) ? String(discountReason).trim() : null, status, status, actor.user, nowIso(), b0.id);
        const b = sync(fresh(e.id), actor.user);
        writeAudit(db, { entity: 'est_bid_summary', entityId: b.id, action: 'discount', oldValues: { discountPct: num(b0.discount_pct, 'percent') }, newValues: { discountPct: pct.toFixed(), status }, actor: actor.user, companyId: e.company_id });
        return summaryView(actor, fresh(e.id), b);
      });
    },
    submitDiscount(actor, id) {
      need(actor, 'est.bid.edit', 'change bid prices'); const e = row(actor, id); editableEstimate(actor, e);
      const b = transaction(db, () => sync(e, actor.user));
      if (!['DRAFT', 'RETURNED'].includes(b.discount_status)) throw unprocessable(b.discount_status === 'NOT_REQUIRED' ? 'A discount within the threshold needs no approval.' : 'The discount is already with the director or decided.');
      return transaction(db, () => {
        const ctx = { discountPct: num(b.discount_pct, 'percent'), valueMinor: b.discount_amount, projectId: e.project_id };
        if (b.discount_status === 'RETURNED' && b.workflow_instance_id) workflowOf(db).resubmit(actor, b.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: DISCOUNT_DOC, docId: String(b.id), comment: `${e.doc_no}/v${e.version_no}: ${num(b.discount_pct, 'percent')}%`, context: ctx }); db.prepare('UPDATE est_bid_summary SET workflow_instance_id = ? WHERE id = ?').run(inst.id, b.id); }
        db.prepare("UPDATE est_bid_summary SET discount_status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), b.id);
        writeAudit(db, { entity: 'est_bid_summary', entityId: b.id, action: 'submit', actor: actor.user, companyId: e.company_id });
        return summaryView(actor, e, summaryRow(e.id));
      });
    },
    withdrawDiscount(actor, id, { reason }) { const e = row(actor, id); const b = summaryRow(e.id); if (!b || b.discount_status !== 'SUBMITTED') throw unprocessable('Only a discount with the director is withdrawn.'); if (!same(b.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, b.workflow_instance_id, { comment: reason }); return summaryView(actor, e, summaryRow(e.id)); },
  };
  function decideDiscount(instance, actor, outcome, comment) {
    const b = db.prepare('SELECT * FROM est_bid_summary WHERE id = ?').get(rid(instance.docId)); if (!b || b.discount_status !== 'SUBMITTED') return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
    db.prepare('UPDATE est_bid_summary SET discount_status = ?, decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, nowIso(), actor.user, nowIso(), b.id);
    if (withdrawn) db.prepare('UPDATE est_bid_summary SET workflow_instance_id = NULL WHERE id = ?').run(b.id);
    writeAudit(db, { entity: 'est_bid_summary', entityId: b.id, action: `discount_${outcome.toLowerCase()}`, reason: comment ?? null, actor: actor.user, companyId: b.company_id });
  }

  // ---- reviews (FR-01, FR-04) --------------------------------------------------------------------------------------------------------------
  const reviewView = (r) => ({ id: r.id, reviewer: r.reviewer, at: r.created_at, verdict: r.verdict, status: r.review_status, comments: r.comments, checked: JSON.parse(r.checklist_json) });
  /** The open approval task of the estimate that the actor may act on (their own, or one for their role). */
  const openTask = (actor, e) => (e.workflow_instance_id ? db.prepare(`SELECT t.* FROM wf_tasks t WHERE t.instance_id = ? AND t.status = 'OPEN' AND (lower(t.assignee_user_id) = lower(?) OR (t.assignee_user_id IS NULL AND t.assignee_role IN (${(actor.roles ?? []).map(() => '?').join(', ') || "''"}))) ORDER BY t.id LIMIT 1`).get(e.workflow_instance_id, actor.user, ...(actor.roles ?? [])) : null) ?? null;
  const reviews = {
    list(actor, id) { need(actor, 'est.review.view', 'see estimate reviews'); const e = row(actor, id); return db.prepare('SELECT * FROM est_reviews WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(e.id).map(reviewView); },
    /** A review recorded against the checklist; when the reviewer holds the open review task, it approves or returns it (the engine checks the checklist again). */
    record(actor, id, { checked, comments, verdict }) {
      need(actor, 'est.review.perform', 'review estimates'); const e = row(actor, id);
      if (same(e.created_by, actor.user)) throw forbidden('The estimator who made the estimate does not review it.');
      const codes = REVIEW_ITEMS.map(([c]) => c); const unknown = checked.filter((c) => !codes.includes(c)); if (unknown.length) throw badRequest('Correct the highlighted fields', [{ field: 'checked', message: `${unknown.join(', ')} is not an item of the checklist` }]);
      const missing = REVIEW_ITEMS.filter(([c]) => !checked.includes(c));
      if (verdict === 'APPROVE' && missing.length) throw unprocessable('Tick every item of the checklist before approving the review.', missing.map(([c, l]) => ({ field: `checked.${c}`, message: l })));
      if (verdict !== 'APPROVE' && String(comments ?? '').trim().length < 5) throw badRequest('Correct the highlighted fields', [{ field: 'comments', message: 'Say what needs attention (at least 5 characters)' }]);
      const task = verdict === 'NOTE' ? null : openTask(actor, e);
      if (verdict !== 'NOTE' && !task) throw unprocessable('There is no review task of this estimate waiting for you; record the review as a note.');
      return transaction(db, () => {
        const rid2 = Number(db.prepare("INSERT INTO est_reviews (company_id, estimate_id, reviewer, checklist_json, comments, verdict, review_status, workflow_task_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'est_estimate', ?)")
          .run(e.company_id, e.id, actor.user, JSON.stringify(checked), comments?.trim() || null, verdict, task ? 'ACTED' : 'RECORDED', task?.id ?? null, e.project_id, actor.user, String(e.id)).lastInsertRowid);
        if (task) workflowOf(db).act(actor, task.id, { action: verdict === 'APPROVE' ? 'approve' : 'return', comment: comments?.trim() || 'Reviewed against the checklist', checked: REVIEW_ITEMS.filter(([c]) => checked.includes(c)).map(([, l]) => l) });
        writeAudit(db, { entity: 'est_reviews', entityId: rid2, action: verdict.toLowerCase(), newValues: { estimateId: e.id, checked }, reason: comments ?? null, actor: actor.user, companyId: e.company_id });
        return reviewView(db.prepare('SELECT * FROM est_reviews WHERE id = ?').get(rid2));
      });
    },
  };

  // ---- the assumptions register (FR-03) ----------------------------------------------------------------------------------------------------
  const assumptions = {
    list(actor, id) { need(actor, 'est.review.view', 'see estimate reviews'); const e = row(actor, id); return db.prepare('SELECT * FROM est_assumptions WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(e.id).map((a) => ({ id: a.id, kind: a.kind, kindLabel: ASSUMPTION_KINDS[a.kind], text: a.text })); },
    put(actor, id, { lines, version }) {
      need(actor, 'est.estimate.edit', 'change estimates'); const e = row(actor, id); editableEstimate(actor, e);
      if (version != null && version !== e.version) throw conflict(`The estimate was changed by someone else (version ${e.version}, you had ${version}); reload it.`);
      return transaction(db, () => {
        db.prepare('UPDATE est_assumptions SET deleted_at = ?, deleted_by = ? WHERE estimate_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, e.id);
        lines.forEach((l, k) => db.prepare("INSERT INTO est_assumptions (company_id, estimate_id, kind, sort_order, text, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'est_estimate', ?)").run(e.company_id, e.id, l.kind, k + 1, l.text.trim(), e.project_id, actor.user, String(e.id)));
        db.prepare('UPDATE est_estimates SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), e.id);
        writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'assumptions', newValues: { lines: lines.length }, actor: actor.user, companyId: e.company_id });
        return assumptions.list(actor, e.id);
      });
    },
  };
  /** Copies the register and the discount to a new version of the estimate (an amendment keeps them). */
  function copyTo(fromId, toId, user) {
    for (const a of db.prepare('SELECT * FROM est_assumptions WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order').all(fromId)) db.prepare("INSERT INTO est_assumptions (company_id, estimate_id, kind, sort_order, text, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'est_assumption', ?)").run(a.company_id, toId, a.kind, a.sort_order, a.text, a.project_id, user, String(a.id));
  }

  // ---- what drives the price: resources per unit of each item (shared by the sensitivity) ---------------------------------------------------
  /** The resources of one unit of an item with their amount per unit: the analysis lines (with wastage, per basis) or the build-up components. */
  function perUnit(i) {
    if (i.build_mode === 'ANALYSIS' && i.analysis_id) {
      const a = db.prepare('SELECT basis_qty FROM ra_analyses WHERE id = ?').get(i.analysis_id); if (!a) return [];
      return db.prepare('SELECT l.*, m.code AS item_code FROM ra_analysis_lines l LEFT JOIN mdm_items m ON m.id = l.component_item_id WHERE l.analysis_id = ? AND l.deleted_at IS NULL').all(i.analysis_id)
        .map((l) => ({ type: l.component_type, itemId: l.component_item_id, itemCode: l.item_code, description: l.description, amount: dec(num(l.amount, 'money')).div(dec(num(a.basis_qty, 'quantity')), 12) }));
    }
    if (i.build_mode === 'MANUAL') return db.prepare('SELECT c.*, m.code AS item_code FROM est_item_components c LEFT JOIN mdm_items m ON m.id = c.component_item_id WHERE c.estimate_item_id = ? AND c.deleted_at IS NULL').all(i.id).map((c) => ({ type: c.component_type, itemId: c.component_item_id, itemCode: c.item_code, description: c.description, amount: dec(money(c.amount)) }));
    return [];
  }
  const keyOf = (r) => (r.itemId ? `item:${r.itemId}` : `desc:${String(r.description).toLowerCase()}`);
  /** FR-02, T-01: +/- pct on one resource (or a kind of resource): every item that uses it costs more per unit, keeps its markup, and the bid price follows through est.item_rate and est.bid_price. */
  function sensitivity(actor, id, { pct = '10' } = /** @type {any} */ ({})) {
    need(actor, 'est.estimate.cost', 'see the costs of estimates'); const e = row(actor, id);
    const b = ['DRAFT', 'RETURNED'].includes(e.status) || !summaryRow(e.id) ? transaction(db, () => sync(e, actor.user)) : summaryRow(e.id);
    const items = db.prepare('SELECT * FROM est_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order').all(e.id).map((i) => ({ i, res: perUnit(i) }));
    const drivers = new Map();
    for (const { i, res } of items) for (const r of res) { const k = keyOf(r); const d = drivers.get(k) ?? { key: k, label: r.description, itemCode: r.itemCode, type: r.type, amount: dec(0) }; d.amount = d.amount.add(r.amount.mul(dec(num(i.qty, 'quantity')))); drivers.set(k, d); }
    const top = [...drivers.values()].sort((a, c) => (c.amount.gt(a.amount) ? 1 : -1)).slice(0, 8);
    const groups = [...top.map((d) => ({ key: d.key, label: d.itemCode ? `${d.itemCode} · ${d.label}` : d.label, kind: 'resource', test: (r) => keyOf(r) === d.key })), ...Object.keys(COMPONENT_TYPES).filter((t) => [...drivers.values()].some((d) => d.type === t)).map((t) => ({ key: `type:${t}`, label: COMPONENT_TYPES[t], kind: 'type', test: (r) => r.type === t }))];
    const base = { selling: money(b.selling_amount), bidPrice: money(b.bid_price), totalCost: money(b.total_cost), profit: money(b.profit_amount) };
    const discount = num(b.discount_pct, 'percent'); const gst = num(e.gst_pct, 'percent');
    const rows = groups.map((g) => {
      let selling = dec(0); let dCost = dec(0);
      for (const { i, res } of items) {
        const perUnitDelta = res.filter(g.test).reduce((s, r) => s.add(r.amount), dec(0)).mul(dec(String(pct))).div(100, 12);
        const q = num(i.qty, 'quantity');
        if (perUnitDelta.isZero()) { selling = selling.add(dec(money(i.amount))); continue; }
        const cost = dec(num(i.cost_rate, 'rate')).add(perUnitDelta).round(4);
        const r = ev('est.item_rate', { quantity: q, cost_rate: cost.toFixed(4), markup_percent: num(i.markup_pct, 'percent') });
        selling = selling.add(dec(r.amount)); dCost = dCost.add(dec(r.cost_amount)).sub(dec(money(i.cost_amount)));
      }
      const p = ev('est.bid_price', { selling_amount: selling.toFixed(2), discount_percent: discount, gst_percent: gst });
      return { key: g.key, label: g.label, kind: g.kind, baseAmount: g.kind === 'resource' ? drivers.get(g.key).amount.round(2).toFixed(2) : [...drivers.values()].filter((d) => d.type === g.key.slice(5)).reduce((s, d) => s.add(d.amount), dec(0)).round(2).toFixed(2), costDelta: dCost.round(2).toFixed(2), selling: selling.toFixed(2), bidPrice: p.bid_price, bidDelta: dec(p.bid_price).sub(dec(base.bidPrice)).toFixed(2), bidDeltaPct: dec(base.bidPrice).isZero() ? '0.00' : dec(p.bid_price).sub(dec(base.bidPrice)).mul(100).div(dec(base.bidPrice), 6).round(2).toFixed(2), marginAtSamePrice: dec(base.profit).sub(dCost).round(2).toFixed(2) };
    });
    return { estimate: { id: e.id, ref: `${e.doc_no}/v${e.version_no}` }, pct: String(pct), base, rows };
  }

  /** FR-06: items priced well above or below the average markup of the estimate, or away from the client's rate, flagged for management. */
  function unbalanced(actor, id) {
    need(actor, 'est.estimate.cost', 'see the costs of estimates'); const e = row(actor, id);
    const band = dec(String(param(e.company_id, 'est.unbalanced.band_points') ?? '10')); const clientBand = dec(String(param(e.company_id, 'est.unbalanced.client_band_pct') ?? '25'));
    const items = db.prepare('SELECT * FROM est_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order').all(e.id);
    const cost = items.reduce((s, i) => s + i.cost_amount, 0); const sell = items.reduce((s, i) => s + i.amount, 0);
    const avg = cost ? dec(money(sell - cost)).mul(100).div(dec(money(cost)), 6).round(2) : dec(0);
    const rows = items.map((i) => {
      const m = i.cost_amount ? dec(money(i.amount - i.cost_amount)).mul(100).div(dec(money(i.cost_amount)), 6).round(2) : dec(num(i.markup_pct, 'percent'));
      const vsClient = i.client_rate ? dec(money(i.selling_rate)).sub(dec(num(i.client_rate, 'rate'))).mul(100).div(dec(num(i.client_rate, 'rate')), 6).round(2) : null;
      const flags = [];
      if (m.sub(avg).gt(band)) flags.push('ABOVE_AVERAGE'); if (avg.sub(m).gt(band)) flags.push('BELOW_AVERAGE'); if (i.qty > 0 && i.selling_rate <= Math.round(i.cost_rate / 100)) flags.push('AT_OR_BELOW_COST');
      if (vsClient && vsClient.gt(clientBand)) flags.push('ABOVE_CLIENT'); if (vsClient && dec(0).sub(vsClient).gt(clientBand)) flags.push('BELOW_CLIENT');
      return { itemId: i.id, itemNo: i.item_no, sectionCode: i.section_code, description: i.description, uom: i.uom, qty: num(i.qty, 'quantity'), costRate: num(i.cost_rate, 'rate'), sellingRate: money(i.selling_rate), clientRate: num(i.client_rate, 'rate'), markupPct: m.toFixed(2), vsClientPct: vsClient?.toFixed(2) ?? null, amount: money(i.amount), flags };
    });
    return { estimate: { id: e.id, ref: `${e.doc_no}/v${e.version_no}` }, averageMarkupPct: avg.toFixed(2), bandPoints: band.toFixed(), clientBandPct: clientBand.toFixed(), rows, flagged: rows.filter((r) => r.flags.length).length };
  }

  // ---- the priced BOQ in the client's format (FR-05) ----------------------------------------------------------------------------------------
  function pricedBoq(actor, id, { format = 'xlsx', words = true } = /** @type {any} */ ({})) {
    need(actor, 'est.boq.export', 'export priced BOQs'); const e = row(actor, id);
    const b = ['DRAFT', 'RETURNED'].includes(e.status) || !summaryRow(e.id) ? transaction(db, () => sync(e, actor.user)) : summaryRow(e.id);
    const items = db.prepare('SELECT * FROM est_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(e.id);
    const t = e.tender_id ? db.prepare('SELECT doc_no, name_of_work FROM tdr_tenders WHERE id = ?').get(e.tender_id) : null;
    const draft = e.status !== 'APPROVED';
    const columns = [{ key: 'itemNo', label: 'Item No.', type: 'text' }, { key: 'description', label: 'Description of item', type: 'text' }, { key: 'uom', label: 'Unit', type: 'text' }, { key: 'qty', label: 'Quantity', type: 'number' }, { key: 'rate', label: 'Rate (₹)', type: 'money' }, ...(words ? [{ key: 'rateWords', label: 'Rate in words', type: 'text' }] : []), { key: 'amount', label: 'Amount (₹)', type: 'money' }];
    const rows = []; let section = null;
    for (const i of items) {
      if (i.section_code !== section) { section = i.section_code; rows.push({ itemNo: i.section_code, description: (i.section_name ?? `Section ${i.section_code}`).toUpperCase(), uom: '', qty: '', rate: '', rateWords: '', amount: '' }); }
      rows.push({ itemNo: i.item_no, description: i.description, uom: i.uom, qty: num(i.qty, 'quantity'), rate: money(i.selling_rate), rateWords: words ? amountInWords(money(i.selling_rate)) : '', amount: money(i.amount) });
    }
    const footer = [`Total of the BOQ: ₹ ${money(b.selling_amount)}`, ...(b.discount_amount ? [`Rebate ${num(b.discount_pct, 'percent')}%: ₹ ${money(b.discount_amount)}`, `Net: ₹ ${money(b.net_price)}`] : []), `GST ${num(b.gst_pct, 'percent')}%: ₹ ${money(b.gst_amount)}`, `Bid price: ₹ ${money(b.bid_price)} (${amountInWords(money(b.bid_price))})`, ...(draft ? [`DRAFT ${STATUS[e.status].toUpperCase()}: not for submission until the estimate is approved`] : [])];
    const title = `Priced BOQ ${e.doc_no}/v${e.version_no}${t ? ` · ${t.doc_no} ${t.name_of_work}` : ''}`;
    writeAudit(db, { entity: 'est_estimates', entityId: e.id, action: 'priced_boq', newValues: { format, rows: items.length, draft }, actor: actor.user, companyId: e.company_id });
    if (format === 'html') {
      const tr = rows.map((r) => (r.uom === '' ? `<tr><th colspan="${columns.length}" style="text-align:left">${esc(r.itemNo)} ${esc(r.description)}</th></tr>` : `<tr>${columns.map((c) => `<td${['qty', 'rate', 'amount'].includes(c.key) ? ' style="text-align:right"' : ''}>${esc(r[c.key])}</td>`).join('')}</tr>`)).join('');
      return { kind: 'html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:12px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;vertical-align:top}table{border-collapse:collapse;width:100%}${draft ? 'body::before{content:"DRAFT – not for submission";display:block;color:#b00;font-weight:bold;margin-bottom:8px}' : ''}</style></head><body><h1>${esc(title)}</h1><table><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${tr}</tbody></table>${footer.map((f) => `<p>${esc(f)}</p>`).join('')}</body></html>` };
    }
    const buffer = writeExport(format, { columns, rows, footer, title, sheetName: 'Priced BOQ' });
    return { kind: 'file', buffer, contentType: FORMATS[format], fileName: `priced-boq-${e.doc_no}-v${e.version_no}${draft ? '-DRAFT' : ''}.${format}` };
  }

  /** The Estimate Review panel: the estimate, the checklist, the reviews, the bid summary, the register, the unbalanced items (for those who see costs), and what the actor may do. */
  function panel(actor, id) {
    need(actor, 'est.review.view', 'see estimate reviews'); const e = row(actor, id);
    const v = E().estimates.get(actor, e.id); const s = summary.get(actor, e.id); const c = costs(actor);
    const task = openTask(actor, fresh(e.id)); const step = task ? db.prepare('SELECT step_code FROM wf_tasks WHERE id = ?').get(task.id)?.step_code ?? null : null;
    return {
      estimate: { id: v.id, ref: v.ref, title: v.title, status: v.status, statusLabel: v.statusLabel, tender: v.tender, project: v.project, basisDate: v.basisDate, totals: v.totals, costsVisible: c, rowVersion: v.rowVersion, workflowInstanceId: v.workflowInstanceId, items: v.items.length, sections: v.sections, can: v.can },
      checklist: REVIEW_ITEMS.map(([code, label]) => ({ code, label })), reviews: reviews.list(actor, e.id), summary: s, assumptions: assumptions.list(actor, e.id), unbalanced: c ? unbalanced(actor, e.id) : null,
      can: { review: may(actor, 'est.review.perform') && !same(e.created_by, actor.user), reviewTask: Boolean(task), reviewStep: step, editBid: may(actor, 'est.bid.edit') && ['DRAFT', 'RETURNED'].includes(e.status) && same(e.created_by, actor.user), editAssumptions: may(actor, 'est.estimate.edit') && ['DRAFT', 'RETURNED'].includes(e.status) && same(e.created_by, actor.user), exportBoq: may(actor, 'est.boq.export'), sensitivity: c, forBid: e.status === 'APPROVED' },
    };
  }
  return { summary, reviews, assumptions, sensitivity, unbalanced, pricedBoq, panel, sync, copyTo, decideDiscount, discountReady: (e) => { const b = summaryRow(e.id); return !b || DONE_DISCOUNT.includes(b.discount_status); }, summaryRow };
}

const services = new WeakMap();
export const bindReview = (db, s) => services.set(db, s);
export const reviewOf = (db) => services.get(db) ?? null;

// BR-01: an estimate is not sent while a discount above the threshold waits for the director; its approval carries the bid summary (08.03, 10.02).
estimateHooks.gates.push((db, e) => { const s = reviewOf(db); if (!s) return []; transaction(db, () => s.sync(e)); return s.discountReady(e) ? [] : [{ field: 'discount', message: 'The discount is above the threshold: the director approves it before the estimate is sent' }]; });
estimateHooks.approved.push((db, e) => { const s = reviewOf(db); const b = s?.summaryRow(e.id); return b ? { bidSummary: { discountPct: num(b.discount_pct, 'percent'), discount: money(b.discount_amount), net: money(b.net_price), gst: money(b.gst_amount), bidPrice: money(b.bid_price) } } : {}; });
estimateHooks.versioned = (db, fromId, toId, user) => reviewOf(db)?.copyTo(fromId, toId, user);

workflowTypes.register({
  docType: DISCOUNT_DOC, label: 'Bid discount above the threshold', processOwner: 'DIR', route: (id) => { return `/est/bid-price?summary=${id}`; },
  describe(db, companyId, id) { const r = db.prepare('SELECT b.*, e.doc_no, e.version_no, e.title FROM est_bid_summary b JOIN est_estimates e ON e.id = b.estimate_id WHERE b.id = ? AND b.company_id = ?').get(rid(id), companyId); return r ? { ref: `${r.doc_no}/v${r.version_no} discount`, title: r.title, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT b.*, e.doc_no, e.version_no, e.title FROM est_bid_summary b JOIN est_estimates e ON e.id = b.estimate_id WHERE b.id = ?').get(rid(id)); if (!r) return null; return { fields: [{ label: 'Estimate', value: `${r.doc_no}/v${r.version_no} ${r.title}` }, { label: 'Discount', value: `${num(r.discount_pct, 'percent')}% = ₹ ${money(r.discount_amount)}` }, { label: 'Selling before the discount', value: `₹ ${money(r.selling_amount)}` }, { label: 'Profit before the discount', value: `₹ ${money(r.profit_amount)}` }, { label: 'Bid price', value: `₹ ${money(r.bid_price)}` }, { label: 'Why', value: r.discount_reason ?? '' }] }; },
  defaultDefinition: { name: 'Bid discount above the threshold: the director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'DIR', name: 'Director', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'DIR' }], slaHours: 24, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: {
    onApproved: (db, { instance, actor }) => reviewOf(db)?.decideDiscount(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => reviewOf(db)?.decideDiscount(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => reviewOf(db)?.decideDiscount(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => reviewOf(db)?.decideDiscount(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(DISCOUNT_DOC, ({ db, instance }) => {
  const b = db.prepare('SELECT * FROM est_bid_summary WHERE id = ?').get(rid(instance.docId)); if (!b) return { sections: [] };
  const profitAfter = b.profit_amount - b.discount_amount;
  return { sections: [{ code: 'est-discount', title: 'Before approving the discount', kind: 'metrics', items: [{ label: 'Profit after the discount', value: `₹ ${money(profitAfter)}`, format: 'text' }, { label: 'Margin after the discount', value: b.net_price ? `${dec(money(profitAfter)).mul(100).div(dec(money(b.net_price)), 6).round(2).toFixed(2)}%` : '–', format: 'text' }] }] };
});
