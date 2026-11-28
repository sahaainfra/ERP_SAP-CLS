import { transaction } from '../../platform/db/index.js';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { isEnabled } from '../core/feature-flags/service.js';
import {
  ACTUAL_EVENTS, CHECK_DOC, CHECK_MODES, CHECK_RESULTS, COMMIT_EVENTS, COMMIT_STATUS, CONFIG_STATUS, CONTROL_CODE, DIMENSIONS, STAGES, cell, nowIso, rid, rupees, same, signed,
} from './constants.js';
import { budOf } from './budgets.js';

// The budget check service and the commitment ledger (part 12.03). Every spending document asks the check what is left of the budget of a WBS node and cost code before it commits money; the check answers from the budget in force (12.01, 12.02)
// less what is committed and what is already spent (BR-01), and says OK, warning or block according to the setting of the cost head and the stage. An approved PR, PO, WO, hire or service order puts its lines in the ledger; amendments adjust the
// commitment by the difference; short-close and cancellation release what is left; a receipt, issue, bill, payroll or plant cost becomes an actual and consumes the commitment it names, once. A blocked commitment goes ahead only with an exception
// approved through the protocol and control engine (04.04, BR-02). The settings are changed by a maker and a checker.
controlRegistry.define({
  code: CONTROL_CODE, module: 'bud', stage: 'VERIFY', description: 'A commitment above the budget of a cost head that blocks needs an approved exception', enforcement: 'EXCEPTION', evidenceRequired: true, escalationLevel: 1, ownerRole: 'PCMGR', mode: 'ENFORCE',
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'The commitment is above the budget and this cost head blocks it', details: { over: context.over ?? null, project: context.project ?? null } }),
});

export function createLedgerService({ db, base }) {
  const { may, need, fail, audit, event, notify, orgOf, projOf, project, currentOf, codeById, wbsMeta } = base;
  const system = (companyId) => ({ user: 'system', companyId, roles: ['SYSTEM'] });

  // ---- the figures of a filter: budget, committed, actual, available (BR-01) -------------------------------------------------------------------------------------------
  const where = (alias, f) => { const w = []; const p = []; if (f.wbsId) { w.push(`${alias}.wbs_id = ?`); p.push(f.wbsId); } if (f.costCodeId) { w.push(`${alias}.cost_code_id = ?`); p.push(f.costCodeId); } if (f.costHeadId) { w.push(`${alias}.cost_head_id = ?`); p.push(f.costHeadId); } return { sql: w.length ? ` AND ${w.join(' AND ')}` : '', params: p }; };
  /**
   * Budget less what is committed and spent. Committed is what is still open on commitments; actual is every posted actual, including the part that consumed a commitment, so a receipt that turns 40 of a commitment of 100 into cost leaves 60 committed
   * and 40 actual: the same 100 is spent once and never twice. `except` is a commitment being amended, whose own open amount is not counted against itself.
   */
  function figures(projectId, f, { except = null } = {}) {
    const cur = currentOf(projectId); const b = where('l', f); const c = where('c', f); const a = where('a', f);
    const budget = cur ? db.prepare(`SELECT COALESCE(SUM(l.amount), 0) AS amount, COALESCE(SUM(l.qty), 0) AS qty FROM bud_lines l WHERE l.budget_id = ? AND l.deleted_at IS NULL AND l.line_kind IN ('DIRECT', 'OVERHEAD')${b.sql}`).get(cur.id, ...b.params) : { amount: 0, qty: 0 };
    const com = db.prepare(`SELECT COALESCE(SUM(c.amount - c.consumed_amount - c.released_amount), 0) AS amount, COALESCE(SUM(MAX(c.qty - c.consumed_qty, 0)), 0) AS qty FROM bud_commitments c WHERE c.org_project_id = ? AND c.deleted_at IS NULL AND c.status IN ('OPEN', 'PARTIAL')${c.sql}${except ? ' AND c.id <> ?' : ''}`).get(projectId, ...c.params, ...(except ? [except] : []));
    const act = db.prepare(`SELECT COALESCE(SUM(a.amount), 0) AS amount, COALESCE(SUM(a.qty), 0) AS qty FROM bud_actuals a WHERE a.org_project_id = ? AND a.deleted_at IS NULL AND a.status = 'POSTED'${a.sql}`).get(projectId, ...a.params);
    return { budgetId: cur?.id ?? null, budgetDocNo: cur?.doc_no ?? null, budget: budget.amount, budgetQty: budget.qty, committed: com.amount, committedQty: com.qty, actual: act.amount, actualQty: act.qty, available: budget.amount - com.amount - act.amount };
  }
  const money = (n) => rupees(n);
  const figOut = (x) => ({ budgetId: x.budgetId, budgetDocNo: x.budgetDocNo, budget: money(x.budget), committed: money(x.committed), actual: money(x.actual), available: signed(x.available), budgetQty: x.budgetQty / 1000, committedQty: x.committedQty / 1000, actualQty: x.actualQty / 1000, usedPct: x.budget > 0 ? Number((((x.committed + x.actual) / x.budget) * 100).toFixed(2)) : null });

  // ---- the settings in force ---------------------------------------------------------------------------------------------------------------------------------------
  /** The most specific setting in force on the date: cost head and stage, then cost head, then stage, then the default one; the latest start date among equals. No setting means the check is off. */
  function configFor(companyId, costHeadId, stage, date = todayIST()) {
    const rows = db.prepare("SELECT * FROM bud_check_config WHERE company_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND deleted_at IS NULL").all(companyId, date);
    const rank = (r) => (r.cost_head_id && r.stage ? 4 : r.cost_head_id ? 3 : r.stage ? 2 : 1);
    const hit = rows.filter((r) => (r.cost_head_id == null || r.cost_head_id === costHeadId) && (r.stage == null || r.stage === stage)).sort((a, b) => rank(b) - rank(a) || b.effective_from.localeCompare(a.effective_from) || b.id - a.id)[0];
    return hit ? { id: hit.id, docNo: hit.doc_no, mode: hit.mode, tolerancePct: hit.tolerance_pct, effectiveFrom: hit.effective_from } : { id: null, docNo: null, mode: 'OFF', tolerancePct: 0, effectiveFrom: null };
  }

  /** FR-01: one line against the budget: the figures, what is asked, what would be left, and the result per the setting of its cost head and stage. */
  function checkLine(actor, o, stage, l, date) {
    const code = l.costCodeId ? codeById(actor.companyId, l.costCodeId) : null; const costHeadId = code?.cost_head_id ?? null;
    const ex = l.sourceType && l.sourceId ? db.prepare("SELECT * FROM bud_commitments WHERE company_id = ? AND src_type = ? AND src_id = ? AND src_line_id = ? AND deleted_at IS NULL").get(actor.companyId, l.sourceType, String(l.sourceId), String(l.lineId ?? '')) : null;
    const f = figures(o.id, { wbsId: l.wbsId, costCodeId: l.costCodeId }, { except: ex?.id ?? null });
    const asked = Math.round(Number(l.amount) * 100); const requested = ex ? asked - ex.consumed_amount - ex.released_amount : asked; const cfg = configFor(actor.companyId, costHeadId, stage, date);
    const tolerance = Math.round((f.budget * cfg.tolerancePct) / 1_000_000); const over = requested - f.available; let result = 'OK'; let message = null;
    if (!f.budgetId) { result = cfg.mode === 'OFF' ? 'OK' : 'WARNING'; message = cfg.mode === 'OFF' ? null : 'The project has no approved budget (12.01).'; }
    else if (cfg.mode !== 'OFF' && over > 0) {
      if (over <= tolerance) { result = 'WARNING'; message = `₹ ${money(over)} over the budget available, within the tolerance of ${cfg.tolerancePct / 10000} %.`; }
      else if (cfg.mode === 'WARN') { result = 'WARNING'; message = `₹ ${money(over)} over the budget available (₹ ${signed(f.available)}).`; }
      else { result = 'BLOCK'; message = `₹ ${money(over)} over the budget available (₹ ${signed(f.available)}); this cost head blocks commitments above its budget.`; }
    }
    // PACK-16 (ff.proj.pack16, ADR-783): a cost committed to a project whose set-up is not complete (still in the Set-up stage of its life cycle)
    // is a warning on the line, shown before approval in the budget check and kept on the commitment; never a block here (the commitment
    // comes from a document already approved, and a refusal at this point would be dead-lettered, D-833).
    if (cfg.mode !== 'OFF' && isEnabled(db, 'ff.proj.pack16', { companyId: actor.companyId }) && projOf(o.id)?.lifecycle_state === 'SETUP') {
      const setup = 'The project is still in set-up: its set-up checklist is not complete (Projects, the project, Readiness).';
      if (result === 'OK') result = 'WARNING';
      message = message ? `${setup} ${message}` : setup;
    }
    const w = l.wbsId ? wbsMeta(l.wbsId) : null;
    return {
      lineId: l.lineId ?? '', wbsId: l.wbsId ?? null, wbs: w ? `${w.code} ${w.name}` : null, costCodeId: l.costCodeId ?? null, costCode: code?.code ?? null, costHeadId, stage, requested: money(requested), ...figOut(f), after: signed(f.available - requested),
      over: money(Math.max(0, over)), overPaise: Math.max(0, over), mode: cfg.mode, modeLabel: CHECK_MODES[cfg.mode], tolerancePct: cfg.tolerancePct / 10000, configNo: cfg.docNo, result, resultLabel: CHECK_RESULTS[result], message, existing: Boolean(ex),
    };
  }
  const summary = (lines) => (lines.some((x) => x.result === 'BLOCK') ? 'BLOCK' : lines.some((x) => x.result === 'WARNING') ? 'WARNING' : 'OK');

  // ---- the ledger writes -------------------------------------------------------------------------------------------------------------------------------------------
  const logOf = (actor, c, action, amountDelta, qtyDelta, refType = null, refId = null, note = null) => db.prepare('INSERT INTO bud_commitment_log (company_id, commitment_id, action, amount_delta, qty_delta, ref_type, ref_id, note, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'ledger\')').run(c.company_id, c.id, action, amountDelta, qtyDelta, refType, refId, note, c.org_project_id, actor.user);
  const statusOf = (c) => (c.released_amount > 0 && c.consumed_amount + c.released_amount >= c.amount ? 'CLOSED' : c.consumed_amount >= c.amount ? 'CLOSED' : c.consumed_amount > 0 ? 'PARTIAL' : 'OPEN');
  const commitRow = (id) => db.prepare('SELECT * FROM bud_commitments WHERE id = ?').get(id);

  /**
   * FR-02: an approved PR, PO, WO, hire order or service order puts its lines in the ledger; the same lines again are an amendment and move the commitment by the difference (T-01). Each line is checked first: a warning is recorded
   * and returned, a block stops the whole document unless an approved exception (04.04) names it (BR-02).
   */
  function commit(actor, b) {
    const o = orgOf(b.projectId); if (!o || o.company_id !== actor.companyId || !projOf(o.id)) throw notFound('That project does not exist.');
    return transaction(db, () => {
      const date = todayIST(); const out = []; let exceptionId = null; let exceptionNo = null;
      const checks = b.lines.map((l) => ({ l, r: checkLine(actor, o, b.stage, { ...l, sourceType: b.sourceType, sourceId: b.sourceId }, date) }));
      const worst = summary(checks.map((x) => x.r));
      if (worst === 'BLOCK') {
        const over = checks.filter((x) => x.r.result === 'BLOCK').reduce((a, x) => a + x.r.overPaise, 0);
        const r = protocolOf(db).enforce(actor, CONTROL_CODE, { entity: b.sourceType, entityId: String(b.sourceId), amount: Number(rupees(over)), valueAtRisk: Number(rupees(over)), ref: b.docRef ?? `${b.sourceType} ${b.sourceId}`, project: o.code, over: rupees(over), message: checks.find((x) => x.r.result === 'BLOCK').r.message });
        exceptionId = r.exceptionId ?? null; exceptionNo = r.exceptionNo ?? null;
      }
      for (const { l, r } of checks) {
        const code = l.costCodeId ? codeById(actor.companyId, l.costCodeId) : null; const amount = Math.round(Number(l.amount) * 100); const qty = Math.round(Number(l.qty ?? 0) * 1000); const key = String(l.lineId ?? '');
        const ex = db.prepare('SELECT * FROM bud_commitments WHERE company_id = ? AND src_type = ? AND src_id = ? AND src_line_id = ? AND deleted_at IS NULL').get(actor.companyId, b.sourceType, String(b.sourceId), key);
        if (ex) {
          if (ex.status === 'CANCELLED' || ex.released_amount > 0) throw conflict(`The commitment of ${b.docRef ?? b.sourceId} line ${key || 1} is ${COMMIT_STATUS[ex.status].toLowerCase()}: it is not amended.`);
          if (amount < ex.consumed_amount) throw unprocessable(`The commitment of ${b.docRef ?? b.sourceId} cannot go below what is consumed already (₹ ${money(ex.consumed_amount)}).`);
          const delta = amount - ex.amount; const qd = qty - ex.qty;
          if (delta !== 0 || qd !== 0 || l.wbsId !== ex.wbs_id || (l.costCodeId ?? null) !== ex.cost_code_id) {
            db.prepare("UPDATE bud_commitments SET amount = ?, qty = ?, wbs_id = ?, cost_code_id = ?, cost_head_id = ?, resource_type = ?, description = ?, vendor_ref = COALESCE(?, vendor_ref), vendor_name = COALESCE(?, vendor_name), doc_ref = COALESCE(?, doc_ref), status = ?, check_result = ?, exception_id = COALESCE(?, exception_id), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
              .run(amount, qty, l.wbsId ?? null, l.costCodeId ?? null, code?.cost_head_id ?? null, l.resourceType, l.description ?? ex.description, b.vendorRef ?? null, b.vendorName ?? null, b.docRef ?? null, statusOf({ ...ex, amount }), r.result, exceptionId, actor.user, nowIso(), ex.id);
            logOf(actor, ex, 'AMENDED', delta, qd, b.sourceType, String(b.sourceId), `${b.docRef ?? ''} amended by ${signed(delta)}`.trim());
          }
          out.push({ id: ex.id, lineId: key, action: delta === 0 && qd === 0 ? 'UNCHANGED' : 'AMENDED', delta: signed(delta), result: r.result });
        } else {
          const id = Number(db.prepare("INSERT INTO bud_commitments (company_id, org_project_id, wbs_id, cost_code_id, cost_head_id, resource_type, stage, doc_ref, vendor_ref, vendor_name, description, qty, amount, status, commit_date, src_type, src_id, src_line_id, exception_id, check_result, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(actor.companyId, o.id, l.wbsId ?? null, l.costCodeId ?? null, code?.cost_head_id ?? null, l.resourceType, b.stage, b.docRef ?? null, b.vendorRef ?? null, b.vendorName ?? null, l.description ?? null, qty, amount, date, b.sourceType, String(b.sourceId), key, exceptionId, r.result, o.id, actor.user, b.sourceType, String(b.sourceId)).lastInsertRowid);
          logOf(actor, { id, company_id: actor.companyId, org_project_id: o.id }, 'CREATED', amount, qty, b.sourceType, String(b.sourceId), b.docRef ?? null);
          out.push({ id, lineId: key, action: 'CREATED', delta: money(amount), result: r.result });
        }
      }
      if (b.replaces) { const n = release(actor, { sourceType: b.replaces.sourceType, sourceId: b.replaces.sourceId, cancel: true, reason: `Replaced by ${b.docRef ?? b.sourceType}`, quiet: true }); void n; }
      audit(actor, 'bud_commitments', out[0]?.id ?? 0, 'commit', actor.companyId, { newValues: { source: `${b.sourceType} ${b.sourceId}`, lines: out.length, result: worst, exception: exceptionNo } });
      const first = checks[0]?.r;
      event('bud.commitment.changed', actor, out[0]?.id ?? 0, actor.companyId, o.id, { projectId: o.id, sourceType: b.sourceType, sourceId: String(b.sourceId), stage: b.stage, lines: out.length, result: worst, exceptionNo, availableAfter: first?.after ?? null });
      if (worst !== 'OK') notify({ company_id: actor.companyId, id: out[0]?.id ?? 0, version_no: out[0]?.id ?? 0 }, 'bud.check.over_budget', [projOf(o.id)?.pm_user], b.docRef ?? `${b.sourceType} ${b.sourceId}`, o.code, checks.find((x) => x.r.message)?.r.message ?? 'Over budget.', `/bud/ledger?projectId=${o.id}`);
      return { result: worst, resultLabel: CHECK_RESULTS[worst], exceptionNo, lines: out, checks: checks.map((x) => x.r) };
    });
  }

  /** Short-close releases what is not consumed and keeps the consumed part as cost; cancel is the same for a commitment nothing consumed. T-01. */
  function release(actor, { sourceType, sourceId, cancel = false, reason = null, quiet = false }) {
    const rows = db.prepare("SELECT * FROM bud_commitments WHERE company_id = ? AND src_type = ? AND src_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'PARTIAL')").all(actor.companyId, sourceType, String(sourceId));
    if (!rows.length && !quiet) throw notFound('There is no open commitment for that document.');
    return transaction(db, () => {
      let released = 0;
      for (const c of rows) {
        const rem = c.amount - c.consumed_amount - c.released_amount; const consumed = c.consumed_amount > 0; const status = cancel && !consumed ? 'CANCELLED' : 'CLOSED';
        db.prepare('UPDATE bud_commitments SET released_amount = released_amount + ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(rem, status, actor.user, nowIso(), c.id);
        logOf(actor, c, status === 'CANCELLED' ? 'CANCELLED' : 'SHORT_CLOSED', -rem, 0, sourceType, String(sourceId), reason); released += rem;
      }
      if (rows.length) { audit(actor, 'bud_commitments', rows[0].id, cancel ? 'cancel' : 'short_close', actor.companyId, { reason, newValues: { released: money(released) } }); event('bud.commitment.changed', actor, rows[0].id, actor.companyId, rows[0].org_project_id, { projectId: rows[0].org_project_id, sourceType, sourceId: String(sourceId), stage: rows[0].stage, lines: rows.length, result: cancel ? 'CANCELLED' : 'SHORT_CLOSED', released: money(released) }); }
      return { released: money(released), lines: rows.length };
    });
  }

  /** FR-03: an actual cost reduces the commitment it names by what it consumes and is recorded once (T-02): the same document again changes nothing. */
  function postActual(actor, b) {
    // D-833 (owner's decision, 2026-11-25): a cost already incurred is charged to the project it was allocated to (payroll: the days at the
    // project's sites, else the deployment), even before the project's set-up (proj_projects) is complete; it was refused and dead-lettered.
    // A commitment still needs the set-up, because it is checked against the budget.
    const o = orgOf(b.projectId); if (!o || o.company_id !== actor.companyId) throw notFound('That project does not exist.');
    return transaction(db, () => {
      const out = []; const date = b.date ?? todayIST();
      for (const l of b.lines) {
        const key = String(l.lineId ?? ''); const dup = db.prepare('SELECT * FROM bud_actuals WHERE company_id = ? AND src_type = ? AND src_id = ? AND src_line_id = ? AND deleted_at IS NULL').get(actor.companyId, b.sourceType, String(b.sourceId), key);
        if (dup) { out.push({ id: dup.id, lineId: key, action: 'DUPLICATE' }); continue; }
        const code = l.costCodeId ? codeById(actor.companyId, l.costCodeId) : null; const amount = Math.round(Number(l.amount) * 100); const qty = Math.round(Number(l.qty ?? 0) * 1000);
        let c = null; if (l.commitment) c = db.prepare('SELECT * FROM bud_commitments WHERE company_id = ? AND src_type = ? AND src_id = ? AND src_line_id = ? AND deleted_at IS NULL').get(actor.companyId, l.commitment.sourceType, l.commitment.sourceId, l.commitment.lineId ?? '');
        if (c && c.org_project_id !== o.id) c = null;
        let consumed = 0; let consumedQty = 0;
        if (c && ['OPEN', 'PARTIAL'].includes(c.status)) { const rem = c.amount - c.consumed_amount - c.released_amount; consumed = Math.min(amount, rem); consumedQty = c.qty > 0 ? Math.min(qty, Math.max(0, c.qty - c.consumed_qty)) : 0; }
        const id = Number(db.prepare("INSERT INTO bud_actuals (company_id, org_project_id, wbs_id, cost_code_id, cost_head_id, resource_type, commitment_id, consumed_amount, consumed_qty, doc_ref, vendor_ref, vendor_name, description, qty, amount, actual_date, status, src_type, src_id, src_line_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?)")
          .run(actor.companyId, o.id, l.wbsId ?? c?.wbs_id ?? null, l.costCodeId ?? c?.cost_code_id ?? null, code?.cost_head_id ?? c?.cost_head_id ?? null, l.resourceType ?? c?.resource_type ?? 'OTHER', c?.id ?? null, consumed, consumedQty, b.docRef ?? null, b.vendorRef ?? c?.vendor_ref ?? null, b.vendorName ?? c?.vendor_name ?? null, l.description ?? null, qty, amount, date, b.sourceType, String(b.sourceId), key, o.id, actor.user, b.sourceType, String(b.sourceId)).lastInsertRowid);
        if (c && consumed >= 0 && ['OPEN', 'PARTIAL'].includes(c.status)) {
          const n = { ...c, consumed_amount: c.consumed_amount + consumed, consumed_qty: c.consumed_qty + consumedQty };
          db.prepare('UPDATE bud_commitments SET consumed_amount = ?, consumed_qty = ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(n.consumed_amount, n.consumed_qty, statusOf(n), actor.user, nowIso(), c.id);
          logOf(actor, c, 'CONSUMED', -consumed, -consumedQty, b.sourceType, String(b.sourceId), b.docRef ?? null);
        }
        out.push({ id, lineId: key, action: 'POSTED', consumed: money(consumed), unlinked: money(amount - consumed) });
      }
      const fresh = out.filter((x) => x.action === 'POSTED');
      if (fresh.length) { audit(actor, 'bud_actuals', fresh[0].id, 'post', actor.companyId, { newValues: { source: `${b.sourceType} ${b.sourceId}`, lines: fresh.length } }); event('bud.actual.posted', actor, fresh[0].id, actor.companyId, o.id, { projectId: o.id, sourceType: b.sourceType, sourceId: String(b.sourceId), lines: fresh.length, amount: money(b.lines.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0)) }); }
      return { lines: out };
    });
  }
  function reverseActual(actor, { sourceType, sourceId }) {
    const rows = db.prepare("SELECT * FROM bud_actuals WHERE company_id = ? AND src_type = ? AND src_id = ? AND status = 'POSTED' AND deleted_at IS NULL").all(actor.companyId, sourceType, String(sourceId));
    if (!rows.length) throw notFound('There is no posted actual for that document.');
    return transaction(db, () => {
      for (const a of rows) {
        db.prepare("UPDATE bud_actuals SET status = 'REVERSED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), a.id);
        const c = a.commitment_id ? commitRow(a.commitment_id) : null;
        if (c && a.consumed_amount > 0) {
          const n = { ...c, consumed_amount: Math.max(0, c.consumed_amount - a.consumed_amount), consumed_qty: Math.max(0, c.consumed_qty - a.consumed_qty) };
          db.prepare('UPDATE bud_commitments SET consumed_amount = ?, consumed_qty = ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(n.consumed_amount, n.consumed_qty, c.status === 'CANCELLED' ? 'CANCELLED' : (c.released_amount > 0 ? 'CLOSED' : statusOf(n)), actor.user, nowIso(), c.id);
          logOf(actor, c, 'UNCONSUMED', a.consumed_amount, a.consumed_qty, sourceType, String(sourceId), 'reversed');
        }
      }
      audit(actor, 'bud_actuals', rows[0].id, 'reverse', actor.companyId, { newValues: { lines: rows.length } });
      event('bud.actual.posted', actor, rows[0].id, actor.companyId, rows[0].org_project_id, { projectId: rows[0].org_project_id, sourceType, sourceId: String(sourceId), lines: rows.length, amount: `-${money(rows.reduce((a, x) => a + x.amount, 0))}`, reversed: true });
      return { reversed: rows.length };
    });
  }

  /**
   * F01-1: part of a posted actual line goes away (material returned to the vendor, or back from site into a store that is not the project's). The line keeps
   * its history: its amount and quantity are reduced, never below zero, and what it had consumed of a commitment is given back to that commitment, so an
   * order that is still open is committed again for the replacement (a closed one stays closed). Nothing posted for that line (for example a receipt into a central store) means nothing to reduce.
   */
  function reduceActual(actor, { sourceType, sourceId, lineId, amount, qty = 0, refType = null, refId = null, note = null }) {
    const a = db.prepare("SELECT * FROM bud_actuals WHERE company_id = ? AND src_type = ? AND src_id = ? AND src_line_id = ? AND status = 'POSTED' AND deleted_at IS NULL").get(actor.companyId, sourceType, String(sourceId), String(lineId ?? ''));
    if (!a) return null;
    const cut = Math.min(a.amount, Math.max(0, Math.round(Number(amount) * 100))); const cutQty = Math.min(a.qty, Math.max(0, Math.round(Number(qty ?? 0) * 1000)));
    if (cut === 0 && cutQty === 0) return { id: a.id, reduced: '0.00' };
    const un = Math.min(a.consumed_amount, cut); const unQty = Math.min(a.consumed_qty, cutQty);
    return transaction(db, () => {
      db.prepare('UPDATE bud_actuals SET amount = amount - ?, qty = qty - ?, consumed_amount = consumed_amount - ?, consumed_qty = consumed_qty - ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(cut, cutQty, un, unQty, actor.user, nowIso(), a.id);
      const c = a.commitment_id ? commitRow(a.commitment_id) : null;
      if (c && un > 0) {
        const n = { ...c, consumed_amount: Math.max(0, c.consumed_amount - un), consumed_qty: Math.max(0, c.consumed_qty - unQty) };
        db.prepare('UPDATE bud_commitments SET consumed_amount = ?, consumed_qty = ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(n.consumed_amount, n.consumed_qty, c.status === 'CANCELLED' ? 'CANCELLED' : (c.released_amount > 0 ? 'CLOSED' : statusOf(n)), actor.user, nowIso(), c.id);
        logOf(actor, c, 'UNCONSUMED', un, unQty, refType ?? sourceType, String(refId ?? sourceId), note ?? 'reduced');
      }
      audit(actor, 'bud_actuals', a.id, 'reduce', actor.companyId, { oldValues: { amount: money(a.amount) }, newValues: { amount: money(a.amount - cut), by: refType && refId ? `${refType} ${refId}` : null }, reason: note });
      event('bud.actual.posted', actor, a.id, actor.companyId, a.org_project_id, { projectId: a.org_project_id, sourceType, sourceId: String(sourceId), lines: 1, amount: `-${money(cut)}`, reversed: false });
      return { id: a.id, reduced: money(cut) };
    });
  }

  // ---- the check API, availability, the report ---------------------------------------------------------------------------------------------------------------------
  const ledger = {
    check(actor, b) {
      const o = project(actor, b.projectId, 'bud.check.use', 'bud.check.use'); const date = todayIST(); const lines = b.lines.map((l) => checkLine(actor, o, b.stage, l, date));
      for (const l of lines) if (l.costCodeId && !codeById(actor.companyId, l.costCodeId)) fail([{ field: 'lines.costCodeId', message: 'Choose an active cost code' }]);
      const result = summary(lines); let exception = null;
      // a document that names itself and is blocked is registered with the control engine as stopped, so that the person can raise an exception for it from the form (BR-02)
      const blocked = b.lines.map((l, i) => ({ l, r: lines[i] })).find((x) => x.r.result === 'BLOCK' && x.l.sourceType && x.l.sourceId);
      if (blocked) {
        const over = lines.filter((x) => x.result === 'BLOCK').reduce((a, x) => a + x.overPaise, 0);
        const c = protocolOf(db).check(actor, CONTROL_CODE, { entity: blocked.l.sourceType, entityId: String(blocked.l.sourceId), amount: Number(rupees(over)), valueAtRisk: Number(rupees(over)), ref: `${blocked.l.sourceType} ${blocked.l.sourceId}`, project: o.code, over: rupees(over), message: blocked.r.message });
        exception = { entity: blocked.l.sourceType, entityId: String(blocked.l.sourceId), outcome: c.outcome, required: c.outcome === 'exception_required', excepted: c.result === 'EXCEPTED', exceptionNo: c.exceptionNo ?? null };
      }
      return { projectId: o.id, stage: b.stage, result, exception, resultLabel: CHECK_RESULTS[result], budgetDocNo: lines[0]?.budgetDocNo ?? null, lines: lines.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'overPaise'))) };
    },
    availability(actor, q) {
      const o = project(actor, q.projectId, 'bud.check.use', 'bud.check.use'); const f = figures(o.id, { wbsId: q.wbsId, costCodeId: q.costCodeId });
      /** @type {any} */ const out = { projectId: o.id, projectCode: o.code, wbsId: q.wbsId ?? null, costCodeId: q.costCodeId ?? null, ...figOut(f) };
      if (q.amount != null) { const c = checkLine(actor, o, q.stage ?? 'PO', { wbsId: q.wbsId, costCodeId: q.costCodeId, amount: q.amount }, todayIST()); out.asked = { amount: String(q.amount), result: c.result, resultLabel: c.resultLabel, message: c.message, after: c.after, mode: c.mode }; }
      return out;
    },
    /** FR-06: budget, committed, actual and available by WBS, cost code, cost head or vendor; the vendor view shows commitments and actuals only. */
    report(actor, q) {
      const o = project(actor, q.projectId, 'bud.ledger.view', 'bud.ledger.view'); const cur = currentOf(o.id); const key = new Map();
      const g = (k, label, extra = {}) => { if (!key.has(k)) key.set(k, { key: k, label, budget: 0, committed: 0, actual: 0, ...extra }); return key.get(k); };
      const by = q.by; const lab = (kind, id) => (kind === 'wbs' ? (() => { const w = id ? wbsMeta(id) : null; return w ? `${w.code} ${w.name}` : '— (no WBS)'; })() : kind === 'cost_code' ? (() => { const c = id ? db.prepare('SELECT code, name FROM fin_cost_codes WHERE id = ?').get(id) : null; return c ? `${c.code} ${c.name}` : '— (no cost code)'; })() : (() => { const h = id ? db.prepare('SELECT code, name FROM fin_cost_heads WHERE id = ?').get(id) : null; return h ? `${h.code} ${h.name}` : '— (no cost head)'; })());
      const kf = (r) => (by === 'wbs' ? r.wbs_id : by === 'cost_code' ? r.cost_code_id : r.cost_head_id);
      if (by !== 'vendor' && cur) for (const l of db.prepare("SELECT * FROM bud_lines WHERE budget_id = ? AND deleted_at IS NULL AND line_kind IN ('DIRECT', 'OVERHEAD')").all(cur.id)) g(`${by}:${kf(l) ?? 0}`, lab(by, kf(l)), { id: kf(l) ?? null }).budget += l.amount;
      for (const c of db.prepare("SELECT * FROM bud_commitments WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'PARTIAL')").all(o.id)) { const k = by === 'vendor' ? (c.vendor_ref ?? '') : kf(c); g(`${by}:${k ?? 0}`, by === 'vendor' ? (c.vendor_name ?? c.vendor_ref ?? '— (no vendor)') : lab(by, k), { id: by === 'vendor' ? (c.vendor_ref ?? null) : (k ?? null) }).committed += c.amount - c.consumed_amount - c.released_amount; }
      for (const a of db.prepare("SELECT * FROM bud_actuals WHERE org_project_id = ? AND deleted_at IS NULL AND status = 'POSTED'").all(o.id)) { const k = by === 'vendor' ? (a.vendor_ref ?? '') : kf(a); g(`${by}:${k ?? 0}`, by === 'vendor' ? (a.vendor_name ?? a.vendor_ref ?? '— (no vendor)') : lab(by, k), { id: by === 'vendor' ? (a.vendor_ref ?? null) : (k ?? null) }).actual += a.amount; }
      const rows = [...key.values()].map((r) => ({ key: r.key, id: r.id ?? null, label: r.label, budget: money(r.budget), committed: money(r.committed), actual: money(r.actual), available: signed(r.budget - r.committed - r.actual), availablePaise: r.budget - r.committed - r.actual, usedPct: r.budget > 0 ? Number((((r.committed + r.actual) / r.budget) * 100).toFixed(2)) : null, over: r.budget - r.committed - r.actual < 0 && by !== 'vendor' })).sort((a, b) => a.label.localeCompare(b.label));
      const sum = (f2) => rows.reduce((a, r) => a + Math.round(Number(r[f2]) * 100), 0);
      const tb = by === 'vendor' ? 0 : sum('budget'); const tc = sum('committed'); const ta = sum('actual');
      return { projectId: o.id, projectCode: o.code, by, byLabel: by === 'vendor' ? 'Vendor' : DIMENSIONS[by === 'cost_code' ? 'cost_head' : by] ?? by, budgetDocNo: cur?.doc_no ?? null, versionNo: cur?.version_no ?? null, rows, totals: { budget: money(tb), committed: money(tc), actual: money(ta), available: signed(tb - tc - ta) }, reconciles: by === 'vendor' ? null : true };
    },
    /** The documents behind a figure: the commitments (with what each has consumed) and the actuals, filtered like the figure. */
    documents(actor, q) {
      const o = project(actor, q.projectId, 'bud.ledger.view', 'bud.ledger.view'); const c = where('c', q); const a = where('a', q); const vc = q.vendorRef ? ' AND c.vendor_ref = ?' : ''; const va = q.vendorRef ? ' AND a.vendor_ref = ?' : ''; const vp = q.vendorRef ? [q.vendorRef] : [];
      return {
        projectId: o.id,
        commitments: db.prepare(`SELECT c.* FROM bud_commitments c WHERE c.org_project_id = ? AND c.deleted_at IS NULL${c.sql}${vc} ORDER BY c.id DESC LIMIT 500`).all(o.id, ...c.params, ...vp).map((x) => ({ id: x.id, stage: x.stage, stageLabel: STAGES[x.stage], docRef: x.doc_ref, sourceType: x.src_type, sourceId: x.src_id, lineId: x.src_line_id, vendor: x.vendor_name ?? x.vendor_ref, description: x.description, wbs: wbsMeta(x.wbs_id)?.code ?? null, amount: money(x.amount), consumed: money(x.consumed_amount), released: money(x.released_amount), open: money(x.amount - x.consumed_amount - x.released_amount), status: x.status, statusLabel: COMMIT_STATUS[x.status], checkResult: x.check_result, date: x.commit_date })),
        actuals: db.prepare(`SELECT a.* FROM bud_actuals a WHERE a.org_project_id = ? AND a.deleted_at IS NULL${a.sql}${va} ORDER BY a.id DESC LIMIT 500`).all(o.id, ...a.params, ...vp).map((x) => ({ id: x.id, docRef: x.doc_ref, sourceType: x.src_type, sourceId: x.src_id, lineId: x.src_line_id, vendor: x.vendor_name ?? x.vendor_ref, wbs: wbsMeta(x.wbs_id)?.code ?? null, amount: money(x.amount), consumedCommitment: money(x.consumed_amount), unlinked: money(x.amount - x.consumed_amount), status: x.status, date: x.actual_date })),
      };
    },
    reportCsv(actor, q) {
      need(actor, 'bud.ledger.export', 'export the ledger report', q.projectId); const r = ledger.report(actor, q);
      const lines = [[r.byLabel, 'Budget', 'Committed', 'Actual', 'Available'], ...r.rows.map((x) => [x.label, x.budget, x.committed, x.actual, x.available]), ['Total', r.totals.budget, r.totals.committed, r.totals.actual, r.totals.available]];
      audit(actor, 'bud_commitments', 0, 'export', actor.companyId, { newValues: { project: r.projectCode, by: q.by } });
      return { name: `budget-ledger-${r.projectCode}.csv`, body: lines.map((x) => x.map((v) => `"${cell(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') };
    },
    /** Reconciliation of the ledger of a project (what the tests and the data-integrity check use): for every commitment, amount = open + consumed + released, and the consumed part equals the linked actuals. */
    reconcile(projectId) {
      const bad = [];
      for (const c of db.prepare('SELECT * FROM bud_commitments WHERE org_project_id = ? AND deleted_at IS NULL').all(projectId)) {
        const linked = db.prepare("SELECT COALESCE(SUM(consumed_amount), 0) AS n FROM bud_actuals WHERE commitment_id = ? AND status = 'POSTED' AND deleted_at IS NULL").get(c.id).n;
        const logSum = db.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS n FROM bud_commitment_log WHERE commitment_id = ?').get(c.id).n;
        if (linked !== c.consumed_amount) bad.push({ id: c.id, problem: `consumed ${c.consumed_amount} but linked actuals ${linked}` });
        if (logSum !== c.amount - c.consumed_amount - c.released_amount) bad.push({ id: c.id, problem: `log ${logSum} but open ${c.amount - c.consumed_amount - c.released_amount}` });
      }
      return bad;
    },
    commitments: { commit, release, ledgerLog: (actor, id) => { const c = commitRow(rid(id)); if (!c || c.company_id !== actor.companyId || !may(actor, 'bud.ledger.view', c.org_project_id)) throw notFound('That commitment does not exist.'); return db.prepare('SELECT * FROM bud_commitment_log WHERE commitment_id = ? ORDER BY id').all(c.id).map((x) => ({ id: x.id, action: x.action, amountDelta: signed(x.amount_delta), refType: x.ref_type, refId: x.ref_id, note: x.note, at: x.created_at, by: x.created_by })); } },
    actuals: { post: postActual, reverse: reverseActual, reduce: reduceActual },
    ingestCommitment(actor, b) {
      need(actor, 'bud.ledger.post', 'post to the commitment ledger', b.projectId);
      if (b.action === 'UPSERT') { if (!b.lines.length) throw unprocessable('A commitment has lines.'); return commit(actor, b); }
      return release(actor, { sourceType: b.sourceType, sourceId: b.sourceId, cancel: b.action === 'CANCEL', reason: b.reason });
    },
    ingestActual(actor, b) { need(actor, 'bud.ledger.post', 'post to the actual cost ledger', b.projectId); return b.action === 'POST' ? postActual(actor, b) : reverseActual(actor, b); },

    // ---- the settings, maker and checker (AC-04) ------------------------------------------------------------------------------------------------------------------
    config: {
      view: (r) => { const h = r.cost_head_id ? db.prepare('SELECT code, name FROM fin_cost_heads WHERE id = ?').get(r.cost_head_id) : null; return { id: r.id, docNo: r.doc_no, costHeadId: r.cost_head_id, costHead: h ? `${h.code} ${h.name}` : null, stage: r.stage, stageLabel: r.stage ? STAGES[r.stage] : null, mode: r.mode, modeLabel: CHECK_MODES[r.mode], tolerancePct: r.tolerance_pct / 10000, effectiveFrom: r.effective_from, status: r.status, statusLabel: CONFIG_STATUS[r.status], reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, canCancel: r.status === 'PENDING' }; },
      list(actor) { need(actor, 'bud.check.view', 'see the budget check settings'); return { rows: db.prepare('SELECT * FROM bud_check_config WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 500').all(actor.companyId).map(ledger.config.view), heads: db.prepare("SELECT id, code, name FROM fin_cost_heads WHERE (company_id IS NULL OR company_id = ?) AND head_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code").all(actor.companyId), stages: STAGES, modes: CHECK_MODES, inForce: db.prepare("SELECT * FROM bud_check_config WHERE company_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND deleted_at IS NULL").all(actor.companyId, todayIST()).length }; },
      propose(actor, b) {
        need(actor, 'bud.check.configure', 'change the budget check settings');
        if (b.costHeadId && !db.prepare("SELECT 1 FROM fin_cost_heads WHERE id = ? AND (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL").get(b.costHeadId, actor.companyId)) fail([{ field: 'costHeadId', message: 'Choose a cost head' }]);
        if (db.prepare("SELECT 1 FROM bud_check_config WHERE company_id = ? AND COALESCE(cost_head_id, 0) = ? AND COALESCE(stage, '') = ? AND effective_from = ? AND status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL").get(actor.companyId, b.costHeadId ?? 0, b.stage ?? '', b.effectiveFrom)) throw conflict('A setting for this cost head, stage and date exists already.');
        return transaction(db, () => {
          const n = (db.prepare('SELECT COUNT(*) AS n FROM bud_check_config WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
          const id = Number(db.prepare("INSERT INTO bud_check_config (company_id, doc_no, cost_head_id, stage, mode, tolerance_pct, effective_from, status, reason, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'api')").run(actor.companyId, `BCS/${String(n).padStart(4, '0')}`, b.costHeadId ?? null, b.stage ?? null, b.mode, Math.round(b.tolerancePct * 10000), b.effectiveFrom, b.reason, actor.user, actor.user).lastInsertRowid);
          const inst = workflowOf(db).submit(actor, { docType: CHECK_DOC, docId: String(id), comment: `Budget check setting ${b.mode}`, context: {} }); db.prepare('UPDATE bud_check_config SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id);
          audit(actor, 'bud_check_config', id, 'propose', actor.companyId, { reason: b.reason, newValues: { mode: b.mode, stage: b.stage, tolerancePct: b.tolerancePct, effectiveFrom: b.effectiveFrom } });
          return ledger.config.view(db.prepare('SELECT * FROM bud_check_config WHERE id = ?').get(id));
        });
      },
      cancel(actor, id, { reason }) {
        const r = db.prepare('SELECT * FROM bud_check_config WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That setting does not exist.'); need(actor, 'bud.check.configure', 'change the budget check settings');
        if (r.status !== 'PENDING') throw unprocessable('Only a setting waiting for approval is cancelled.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who proposed it cancels it.');
        return transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE bud_check_config SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); audit(actor, 'bud_check_config', r.id, 'cancel', actor.companyId, { reason }); return ledger.config.view(db.prepare('SELECT * FROM bud_check_config WHERE id = ?').get(r.id)); });
      },
      import(actor, b) { const made = []; const errors = []; b.rows.forEach((x, i) => { try { made.push({ row: i + 1, docNo: ledger.config.propose(actor, x).docNo }); } catch (e) { errors.push({ row: i + 1, message: e.details?.[0]?.message ?? e.message }); } }); return { created: made.length, errors, rows: made }; },
      csv(actor) { need(actor, 'bud.check.view', 'export the budget check settings'); const rows = ledger.config.list(actor).rows; const lines = [['No.', 'Cost head', 'Stage', 'Mode', 'Tolerance %', 'Effective from', 'Status'], ...rows.map((r) => [r.docNo, r.costHead ?? 'All', r.stage ?? 'All', r.mode, r.tolerancePct, r.effectiveFrom, r.status])]; audit(actor, 'bud_check_config', 0, 'export', actor.companyId, {}); return { name: 'budget-check-settings.csv', body: lines.map((x) => x.map((v) => `"${cell(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') }; },
      history(actor, id) { const r = db.prepare('SELECT * FROM bud_check_config WHERE id = ? AND company_id = ?').get(rid(id), actor.companyId); if (!r) throw notFound('That setting does not exist.'); need(actor, 'bud.check.view', 'see the budget check settings'); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'bud_check_config' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
      decide(instance, actor, outcome, comment) {
        const r = db.prepare('SELECT * FROM bud_check_config WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'PENDING') return;
        if (outcome === 'APPROVED') {
          transaction(db, () => {
            const now = nowIso(); db.prepare("UPDATE bud_check_config SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND id <> ? AND status = 'ACTIVE' AND COALESCE(cost_head_id, 0) = ? AND COALESCE(stage, '') = ? AND effective_from <= ?").run(actor.user, now, r.company_id, r.id, r.cost_head_id ?? 0, r.stage ?? '', r.effective_from);
            db.prepare("UPDATE bud_check_config SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
            audit(actor, 'bud_check_config', r.id, 'approve', r.company_id, { newValues: { mode: r.mode, effectiveFrom: r.effective_from } });
            event('bud.check.config_changed', actor, r.id, r.company_id, null, { configId: r.id, docNo: r.doc_no, costHeadId: r.cost_head_id, stage: r.stage, mode: r.mode, tolerancePct: r.tolerance_pct / 10000, effectiveFrom: r.effective_from });
            notify({ company_id: r.company_id, id: r.id, version_no: r.id }, 'bud.check.config_approved', [r.requested_by], r.doc_no, `${r.mode} ${r.stage ?? 'all stages'}`, `Budget check setting ${r.doc_no} is in force from ${r.effective_from}.`, '/bud/check-settings');
          });
          return;
        }
        db.prepare('UPDATE bud_check_config SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED', actor.user, nowIso(), r.id); audit(actor, 'bud_check_config', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      },
    },
  };

  // ---- the events of the modules that spend money (consumed once, idempotent by source) ------------------------------------------------------------------------------
  /** Handles one event of the commitment or actual families. `proc.po.approved` and `.amended` put or move the lines; `.closed` short-closes; `.cancelled` releases; an actual family `.posted` records; `.reversed` undoes. */
  ledger.onEvent = (e) => {
    const t = String(e.type ?? e.eventType ?? ''); const d = e.data ?? {}; const companyId = Number(e.companyId ?? d.companyId); if (!companyId || !d.projectId) return null;
    const actor = system(companyId); const fam = Object.keys(COMMIT_EVENTS).find((k) => t.startsWith(`${k}.`)); const verb = t.split('.').pop();
    if (fam) {
      const common = { projectId: Number(d.projectId), stage: COMMIT_EVENTS[fam], sourceType: d.sourceType ?? fam, sourceId: String(d.sourceId ?? ''), docRef: d.docRef ?? null, vendorRef: d.vendorRef ?? null, vendorName: d.vendorName ?? null };
      if (!common.sourceId) return null;
      if (['approved', 'amended'].includes(verb)) return commit(actor, { ...common, replaces: d.replaces ?? null, lines: (d.lines ?? []).map((l) => ({ lineId: l.lineId == null ? '' : String(l.lineId), wbsId: l.wbsId ?? null, costCodeId: l.costCodeId ?? null, resourceType: l.resourceType ?? 'OTHER', qty: Number(l.qty ?? 0), amount: Number(l.amount ?? 0), description: l.description ?? null })) });
      if (['closed', 'short_closed'].includes(verb)) return release(actor, { sourceType: common.sourceType, sourceId: common.sourceId, reason: d.reason ?? 'Short-closed', quiet: true });
      if (verb === 'cancelled') return release(actor, { sourceType: common.sourceType, sourceId: common.sourceId, cancel: true, reason: d.reason ?? 'Cancelled', quiet: true });
      return null;
    }
    const af = ACTUAL_EVENTS.find((k) => t.startsWith(`${k}.`));
    if (af) {
      const common = { projectId: Number(d.projectId), sourceType: d.sourceType ?? af, sourceId: String(d.sourceId ?? ''), docRef: d.docRef ?? null, vendorRef: d.vendorRef ?? null, vendorName: d.vendorName ?? null, date: d.date ?? null };
      if (!common.sourceId) return null;
      if (verb === 'posted') return postActual(actor, { ...common, lines: (d.lines ?? []).map((l) => ({ lineId: l.lineId == null ? '' : String(l.lineId), wbsId: l.wbsId ?? null, costCodeId: l.costCodeId ?? null, resourceType: l.resourceType ?? 'OTHER', qty: Number(l.qty ?? 0), amount: Number(l.amount ?? 0), description: l.description ?? null, commitment: l.commitment ? { sourceType: String(l.commitment.sourceType), sourceId: String(l.commitment.sourceId), lineId: l.commitment.lineId == null ? '' : String(l.commitment.lineId) } : null })) });
      if (verb === 'reversed') { try { return reverseActual(actor, common); } catch (x) { if (x instanceof HttpError && x.status === 404) return null; throw x; } }
    }
    return null;
  };
  return { ledger, checkDecide: ledger.config.decide };
}

// ---- workflow of the settings: a maker proposes, a checker (project director) approves ---------------------------------------------------------------------------------------
const cfg = (db, id) => db.prepare('SELECT * FROM bud_check_config WHERE id = ?').get(id);
workflowTypes.register({
  docType: CHECK_DOC, label: 'Budget check setting', processOwner: 'PCMGR', route: () => '/bud/check-settings',
  describe(db, companyId, id) { const r = cfg(db, rid(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Budget check: ${r.mode} ${r.stage ?? 'all stages'}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = cfg(db, rid(id)); if (!r) return null; const h = r.cost_head_id ? db.prepare('SELECT code, name FROM fin_cost_heads WHERE id = ?').get(r.cost_head_id) : null; return { fields: [{ label: 'Cost head', value: h ? `${h.code} ${h.name}` : 'All cost heads' }, { label: 'Stage', value: r.stage ? STAGES[r.stage] : 'All stages' }, { label: 'Mode', value: CHECK_MODES[r.mode] }, { label: 'Tolerance', value: `${r.tolerance_pct / 10000} %` }, { label: 'From', value: r.effective_from }, { label: 'Reason', value: r.reason ?? '' }] }; },
  defaultDefinition: { name: 'Budget check setting: the project director checks what the maker proposed', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'PD', name: 'Project director', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'PD' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: {
    onApproved: (db, { instance, actor }) => budOf(db)?.checkDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => budOf(db)?.checkDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => budOf(db)?.checkDecide(instance, actor, 'REJECTED', comment),
    onCancelled: (db, { instance, actor, comment }) => budOf(db)?.checkDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(CHECK_DOC, ({ db, instance }) => {
  const r = cfg(db, rid(instance.docId)); if (!r) return { sections: [] }; const now = db.prepare("SELECT mode, tolerance_pct FROM bud_check_config WHERE company_id = ? AND status = 'ACTIVE' AND COALESCE(cost_head_id, 0) = ? AND COALESCE(stage, '') = ? ORDER BY effective_from DESC LIMIT 1").get(r.company_id, r.cost_head_id ?? 0, r.stage ?? '');
  return { sections: [{ code: 'bud-check-config', title: 'Before you approve the setting', kind: 'metrics', items: [{ label: 'Now in force', value: now ? `${CHECK_MODES[now.mode]}, tolerance ${now.tolerance_pct / 10000} %` : 'No setting: the check is off', format: 'text' }, { label: 'Proposed', value: `${CHECK_MODES[r.mode]}, tolerance ${r.tolerance_pct / 10000} %, from ${r.effective_from}`, format: 'text' }, { label: 'Reason', value: r.reason ?? '', format: 'text' }] }] };
});
