import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.10: project accounting.
//  FR-01 the project ledger from the general ledger's project dimension: revenue, direct costs by head, overheads; a project trial balance.
//  FR-02 revenue recognised over time for a project and a month (Ind AS 115 / AS 7): the percentage of completion is the cost incurred ÷ the estimate at completion
//  (cost to cost; the EAC of the approved forecast of 23.11, else the approved budget of 12.01) or the output (the value certified by the client, 22.04, or a
//  surveyed percentage with its note) ÷ the contract revenue; recognised revenue = POC × the contract revenue (the approved contracts of the project, 21.x).
//  BR-01 an expected loss (EAC above the contract revenue) is provided in full at once: provision = the loss less the part of it already in the books
//  (cost to date − revenue recognised).
//  FR-03 against what is billed (the operating revenue posted from the tax invoices and credit notes), the unbilled revenue (contract asset) or the billing in
//  excess (contract liability), posted through the posting engine (23.02) as the movement from the last approved month: Dr/Cr 170010 unbilled, Cr/Dr 230020
//  billing in excess, the difference to 410090 recognition adjustment; the provision Dr 560020 / Cr 240010. ACCMGR → CFO.
//  FR-04 the overhead pools shared by the posted allocation runs of 12.04, posted to the projects: Dr 560030 by project, Cr 560031.
//  FR-05 each approved recognition keeps its figures and the calculation trace: the period snapshot and its audit.

export const REVREC_DOC = 'FIN_REVENUE_RECOGNITION';
export const METHODS = { COST_TO_COST: 'Cost to cost', OUTPUT: 'Output (work certified or surveyed)' };
const rs = (p) => (p == null ? null : p / 100);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(lastDay(y, m)).padStart(2, '0')}`; };
/** Accounts that are not cost incurred towards the contract's progress: the provision for losses, the corporate overhead allocated, tax. */
export const NOT_CONTRACT_COST = ['560020', '560030', '560031', '560010', '560011', '560013', '570001'];
export const OVERHEAD_ACCOUNTS = ['560004', '560005', '560030', '560031'];
/** POC (parts per million) of a value against a total, never above 100 %. */
export const pocOf = (done, total) => (total > 0 ? Math.min(1_000_000, Math.round((done * 1_000_000) / total)) : 0);
/**
 * The recognition of a month from its inputs, in paise (FR-02, BR-01): `{ method, costToDate, eac, contractRevenue, output, billedCum }`.
 * Returns the POC, the revenue recognised to date, the unbilled or the billing in excess, the expected loss and the provision for it.
 */
export function recognise({ method, costToDate, eac, contractRevenue, output = 0, billedCum }) {
  const poc = method === 'OUTPUT' ? pocOf(output, contractRevenue) : pocOf(costToDate, eac);
  const recognisedCum = Math.round((contractRevenue * poc) / 1_000_000);
  const expectedLoss = Math.max(0, eac - contractRevenue);
  // the loss already in the books is the cost to date less the revenue recognised; the rest is provided now (BR-01)
  const lossProvision = expectedLoss > 0 ? Math.max(0, expectedLoss - Math.max(0, costToDate - recognisedCum)) : 0;
  return { poc, recognisedCum, unbilled: Math.max(0, recognisedCum - billedCum), excess: Math.max(0, billedCum - recognisedCum), expectedLoss, lossProvision };
}

export const revrecList = defineList({
  code: 'fin.revenue_recognition', label: 'Revenue recognition', permission: 'fin.revenue_recognition.view',
  from: 'pa_revenue_recognition x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 'p.name'], defaultSort: '-period',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Record' }, period: { sql: 'x.period', type: 'text', label: 'Month' }, project: { sql: 'p.code', type: 'text', label: 'Project' },
    method: { sql: 'x.method', type: 'enum', label: 'Method', options: Object.entries(METHODS) }, poc: { sql: '(x.poc_ppm / 10000.0)', type: 'number', label: 'POC %' },
    recognised: { sql: '(x.recognised_cum_paise / 100.0)', type: 'money', label: 'Recognised to date', total: true }, period_rev: { sql: '(x.recognised_period_paise / 100.0)', type: 'money', label: 'Recognised this month', total: true },
    unbilled: { sql: '(x.unbilled_paise / 100.0)', type: 'money', label: 'Unbilled', total: true }, excess: { sql: '(x.excess_billing_paise / 100.0)', type: 'money', label: 'Billing in excess', total: true },
    provision: { sql: '(x.loss_provision_paise / 100.0)', type: 'money', label: 'Loss provision', total: true }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) },
  },
});

/** @param {{ db: any, base: any, gl: any, flags: any, forecast?: () => any }} o */
export function createProjectAccountingService({ db, base, gl, flags, forecast = () => null }) {
  const { may, audit, notify, authz } = base;
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2310');
  const evt = (type, actor, companyId, entity, entityId, data, projectId = undefined) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId, data });
  const acct = (companyId, code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null;
  const projectFor = (accountId, projectId) => (!projectId || db.prepare("SELECT 1 FROM fin_dimension_rules WHERE account_id = ? AND dimension = 'PROJECT' AND requirement = 'NOT_ALLOWED' AND deleted_at IS NULL").get(accountId) ? {} : { projectId });
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };
  const periodId = (companyId, date) => db.prepare('SELECT id FROM core_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(companyId, date, date)?.id ?? null;
  const projOf = (id) => db.prepare('SELECT id, company_id, code, name FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(Number(id)) ?? null;
  const scope = (actor, key) => { need(actor, key, 'see revenue recognition'); const f = authz.scopeFilter(actor, key, { project: 'x.org_project_id' }); return `x.company_id = :c AND ${f.sql}`; };
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));

  // ---- FR-01: the ledger of a project ----
  const POSTED = "j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL";
  /** Net debit − credit of the project's posted lines up to a date, by account, with the account's group and type. */
  function balances(companyId, projectId, to, from = null) {
    return db.prepare(`SELECT a.id, a.code, a.name, a.account_type, a.normal_side, g.code AS grp, SUM(l.debit_paise) AS dr, SUM(l.credit_paise) AS cr FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id
      WHERE j.company_id = ? AND l.project_id = ? AND ${POSTED} AND j.voucher_date <= ?${from ? ' AND j.voucher_date >= ?' : ''} GROUP BY a.id ORDER BY a.code`).all(companyId, projectId, to, ...(from ? [from] : []));
  }
  const headOf = (r) => (r.grp.startsWith('4') ? 'REVENUE' : OVERHEAD_ACCOUNTS.includes(r.code) ? 'OVERHEAD' : r.grp.startsWith('5') ? 'DIRECT_COST' : 'BALANCE_SHEET');
  /** Cost incurred towards the contract to a date (posted expenses of the project less those not towards its progress). */
  const costToDate = (companyId, projectId, to) => balances(companyId, projectId, to).filter((r) => r.grp.startsWith('5') && !NOT_CONTRACT_COST.includes(r.code)).reduce((a, r) => a + r.dr - r.cr, 0);
  /** What is billed to a date: the operating revenue posted for the project (tax invoices less credit notes), without the recognition adjustment. */
  const billedCum = (companyId, projectId, to) => balances(companyId, projectId, to).filter((r) => r.grp.startsWith('41') && r.code !== '410090').reduce((a, r) => a + r.cr - r.dr, 0);
  /** The contract revenue: the revised value of the project's approved client contracts. */
  const contractRevenue = (projectId) => (has('ctr_contracts') ? db.prepare("SELECT COALESCE(SUM(CASE WHEN revised_paise > 0 THEN revised_paise ELSE original_paise + amended_paise + variation_paise END), 0) AS v FROM ctr_contracts WHERE org_project_id = ? AND status = 'APPROVED' AND contract_state IN ('ACTIVE', 'COMPLETED', 'CLOSED') AND deleted_at IS NULL").get(projectId).v : 0);
  /** The value of work the client certified to a date (22.04): the output of the output method. */
  const certified = (projectId, to) => (has('bill_certifications') ? db.prepare("SELECT COALESCE(SUM(certified_gross_paise), 0) AS v FROM bill_certifications WHERE org_project_id = ? AND status = 'APPROVED' AND cert_date <= ? AND deleted_at IS NULL").get(projectId, to).v : 0);
  /** The estimate at completion: the approved forecast of the month or before (23.11), else the approved budget in force (12.01). */
  function eacOf(companyId, projectId, period) {
    const f = forecast()?.approvedEac?.(companyId, projectId, period); if (f) return { eac: f.eac, source: 'FORECAST', ref: f.docNo };
    const b = has('bud_budgets') ? db.prepare("SELECT doc_no, version_no, total_amount FROM bud_budgets WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1").get(projectId) : null;
    return b ? { eac: b.total_amount, source: 'BUDGET', ref: `${b.doc_no} v${b.version_no}` } : null;
  }
  const lastApproved = (projectId, period, exceptId = 0) => db.prepare("SELECT * FROM pa_revenue_recognition WHERE org_project_id = ? AND period < ? AND status = 'APPROVED' AND id <> ? AND deleted_at IS NULL ORDER BY period DESC LIMIT 1").get(projectId, period, exceptId) ?? null;

  /** FR-02: the figures of a project for a month, from the ledgers, with the trace of each input. */
  function compute(companyId, projectId, period, { method = 'COST_TO_COST', surveyPct = null, amendsId = null } = {}) {
    const end = monthEnd(period); const e = eacOf(companyId, projectId, period); const rev = contractRevenue(projectId);
    const problems = []; if (!rev) problems.push({ field: 'projectId', message: 'The project has no approved client contract with a value (21.x): there is no revenue to recognise.' });
    if (method === 'COST_TO_COST' && !e?.eac) problems.push({ field: 'projectId', message: 'The project has no approved forecast (23.11) or budget (12.01): the estimate at completion is not known.' });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    const cost = Math.max(0, costToDate(companyId, projectId, end)); const billed = Math.max(0, billedCum(companyId, projectId, end));
    const output = method === 'OUTPUT' ? (surveyPct != null ? Math.round((rev * Number(surveyPct)) / 100) : certified(projectId, end)) : 0;
    const eac = e?.eac ?? 0; const r = recognise({ method, costToDate: cost, eac, contractRevenue: rev, output, billedCum: billed });
    const prev = lastApproved(projectId, period, amendsId ?? 0); const base0 = amendsId ? db.prepare('SELECT * FROM pa_revenue_recognition WHERE id = ?').get(amendsId) : prev;
    return { period, end, method, surveyPct, cost, eac, eacSource: e?.source ?? 'BUDGET', eacRef: e?.ref ?? null, contractRevenue: rev, output, billed, ...r, recognisedPrev: prev?.recognised_cum_paise ?? 0, recognisedPeriod: r.recognisedCum - (prev?.recognised_cum_paise ?? 0),
      prevUnbilled: base0?.unbilled_paise ?? 0, prevExcess: base0?.excess_billing_paise ?? 0, prevProvision: base0?.loss_provision_paise ?? 0, prevRef: base0?.doc_no ?? null,
      trace: { costToDate: 'posted expenses of the project to the month end (general ledger, project dimension), less the provision for losses, the corporate overhead allocated and tax', eac: e ? `${e.source === 'FORECAST' ? 'approved forecast' : 'approved budget'} ${e.ref}` : 'not used', contractRevenue: 'revised value of the approved client contracts', billed: 'operating revenue posted for the project to the month end (tax invoices less credit notes)', output: method === 'OUTPUT' ? (surveyPct != null ? `surveyed ${surveyPct}% of the contract revenue` : 'value certified by the client to the month end') : 'not used' } };
  }
  const cols = (c) => ({ method: c.method, survey_pct_ppm: c.surveyPct != null ? Math.round(Number(c.surveyPct) * 10000) : null, cost_to_date_paise: c.cost, eac_paise: c.eac, eac_source: c.eacSource, eac_ref: c.eacRef, output_paise: c.output, poc_ppm: c.poc, contract_revenue_paise: c.contractRevenue, recognised_cum_paise: c.recognisedCum, recognised_prev_paise: c.recognisedPrev, recognised_period_paise: c.recognisedPeriod, billed_cum_paise: c.billed, unbilled_paise: c.unbilled, excess_billing_paise: c.excess, expected_loss_paise: c.expectedLoss, loss_provision_paise: c.lossProvision, prev_unbilled_paise: c.prevUnbilled, prev_excess_paise: c.prevExcess, prev_provision_paise: c.prevProvision, calc_json: JSON.stringify({ trace: c.trace, prevRef: c.prevRef }) });

  /** FR-03: the journal of a recognition: the movement of the contract asset, the contract liability and the provision from the last approved position. */
  function journalLines(x) {
    const c = x.company_id; const p = x.org_project_id; const dU = x.unbilled_paise - x.prev_unbilled_paise; const dE = x.excess_billing_paise - x.prev_excess_paise; const dP = x.loss_provision_paise - x.prev_provision_paise; const adj = dU - dE;
    const L = []; const line = (code, v, withProject = true) => { if (!v) return; const id = acct(c, code); if (!id) throw unprocessable(`Account ${code} is missing from the chart of accounts.`); L.push({ accountId: id, ...(v > 0 ? { debit: rs(v) } : { credit: rs(-v) }), ...(withProject ? projectFor(id, p) : {}) }); };
    line('170010', dU); line('230020', -dE); line('410090', -adj); line('560020', dP); line('240010', -dP); return L;
  }
  const flow = createFlow({ db, base, docType: REVREC_DOC, table: 'pa_revenue_recognition', perm: 'fin.revenue_recognition', label: 'revenue recognition', route: '/finance/revenue-recognition?id=', where: (r) => ({ pid: r.org_project_id, sid: null }),
    ctx: (r) => ({ total: rs(r.recognised_period_paise), period: r.period, makerRole: rolesOf(r.company_id, r.requested_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER', loss: r.loss_provision_paise > 0 ? 'yes' : 'no' }),
    title: (r) => `Revenue of ${projOf(r.org_project_id)?.code ?? ''} for ${r.period}: POC ${(r.poc_ppm / 10000).toFixed(2)}%, ₹${rs(r.recognised_period_paise)} this month`, notifyCode: 'fin.revrec.decided', prefix: 'RR',
    beforeSubmit: (_a, r) => { if (r.period > todayIST().slice(0, 7)) throw unprocessable('Revenue is recognised for a month that has begun.'); if (!on(r.company_id)) throw unprocessable('Revenue recognition is off for the company (ff.fin.p2310).'); const later = db.prepare("SELECT doc_no, period FROM pa_revenue_recognition WHERE org_project_id = ? AND period > ? AND status = 'APPROVED' AND deleted_at IS NULL LIMIT 1").get(r.org_project_id, r.period); if (later) throw conflict(`${later.doc_no} of ${later.period} is approved: a month before it is not recognised after it.`); const c = compute(r.company_id, r.org_project_id, r.period, { method: r.method, surveyPct: r.survey_pct_ppm != null ? r.survey_pct_ppm / 10000 : null, amendsId: r.amends_id }); const v = cols(c); db.prepare(`UPDATE pa_revenue_recognition SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(v), r.id); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM pa_revenue_recognition WHERE id = ?').get(r.id); const lines = journalLines(x); let jid = null;
      if (lines.length) { const j = gl.postEngine(x.company_id, { voucherType: 'JV', date: monthEnd(x.period), narration: `Revenue recognised for ${projOf(x.org_project_id)?.code} ${x.period}: POC ${(x.poc_ppm / 10000).toFixed(2)}% (${x.doc_no})`.slice(0, 500), sourceType: 'pa_revenue_recognition', sourceId: x.id, lines, user: actor.user }); jid = j.journal.id; }
      db.prepare('UPDATE pa_revenue_recognition SET journal_id = ?, period_id = ? WHERE id = ?').run(jid, periodId(x.company_id, monthEnd(x.period)), x.id);
      if (x.amends_id) db.prepare("UPDATE pa_revenue_recognition SET status = 'SUPERSEDED', updated_at = ? WHERE id = ? AND status = 'APPROVED'").run(nowIso(), x.amends_id);
      evt('fin.revenue.recognised', actor, x.company_id, 'pa_revenue_recognition', x.id, { recognitionId: x.id, docNo: x.doc_no, projectId: x.org_project_id, period: x.period, method: x.method, poc: x.poc_ppm / 10000, contractRevenue: rs(x.contract_revenue_paise), recognisedCum: rs(x.recognised_cum_paise), recognisedPeriod: rs(x.recognised_period_paise), billed: rs(x.billed_cum_paise), unbilled: rs(x.unbilled_paise), excess: rs(x.excess_billing_paise), lossProvision: rs(x.loss_provision_paise), eac: rs(x.eac_paise), costToDate: rs(x.cost_to_date_paise), journalId: jid }, x.org_project_id);
    },
  });
  const view = (actor, r, detail = false) => {
    const p = projOf(r.org_project_id); const o = { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, project: p ? `${p.code} ${p.name}` : null, period: r.period, method: r.method, methodLabel: METHODS[r.method], surveyPct: r.survey_pct_ppm != null ? r.survey_pct_ppm / 10000 : null, surveyNote: r.survey_note,
      costToDate: rs(r.cost_to_date_paise), eac: rs(r.eac_paise), eacSource: r.eac_source, eacRef: r.eac_ref, output: rs(r.output_paise), pocPct: r.poc_ppm / 10000, contractRevenue: rs(r.contract_revenue_paise), recognisedCum: rs(r.recognised_cum_paise), recognisedPrev: rs(r.recognised_prev_paise), recognisedPeriod: rs(r.recognised_period_paise),
      billed: rs(r.billed_cum_paise), unbilled: rs(r.unbilled_paise), excess: rs(r.excess_billing_paise), expectedLoss: rs(r.expected_loss_paise), lossProvision: rs(r.loss_provision_paise), prevUnbilled: rs(r.prev_unbilled_paise), prevExcess: rs(r.prev_excess_paise), prevProvision: rs(r.prev_provision_paise),
      journalId: r.journal_id, amendsId: r.amends_id, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, version: r.version,
      can: { ...flow.can(actor, r), recompute: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'fin.revenue_recognition.edit', r.org_project_id), amend: r.status === 'APPROVED' && may(actor, 'fin.revenue_recognition.amend', r.org_project_id) } };
    if (detail) { Object.assign(o.can, flow.approveInfo(actor, r)); let calc; try { calc = JSON.parse(r.calc_json); } catch { calc = {}; } o.trace = calc.trace ?? {}; o.prevRef = calc.prevRef ?? null; o.journal = r.journal_id ? db.prepare('SELECT a.code, a.name, l.debit_paise, l.credit_paise FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.journal_id).map((l) => ({ code: l.code, name: l.name, debit: rs(l.debit_paise), credit: rs(l.credit_paise) })) : journalLines(r).map((l) => ({ code: db.prepare('SELECT code FROM fin_accounts WHERE id = ?').get(l.accountId)?.code, name: db.prepare('SELECT name FROM fin_accounts WHERE id = ?').get(l.accountId)?.name, debit: l.debit ? Number(l.debit) : 0, credit: l.credit ? Number(l.credit) : 0, projected: true })); o.history = flow.history(actor, r.id); }
    return o;
  };
  const projectOk = (actor, projectId, key) => { const p = projOf(projectId); if (!p || p.company_id !== actor.companyId) throw notFound('That project does not exist.'); need(actor, key, 'recognise revenue for this project', p.id); return p; };
  const recognition = {
    flow,
    list(actor, query) { return runList(db, revrecList, parseListRequest(revrecList, query), { select: 'x.*', scopeSql: scope(actor, 'fin.revenue_recognition.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { return view(actor, flow.row(actor, id), true); },
    /** What a recognition would be, nothing saved (the preview step). */
    preview(actor, b) { projectOk(actor, b.projectId, 'fin.revenue_recognition.view'); const c = compute(actor.companyId, b.projectId, b.period, b); const x = { company_id: actor.companyId, org_project_id: b.projectId, ...cols(c), unbilled_paise: c.unbilled, excess_billing_paise: c.excess, loss_provision_paise: c.lossProvision, prev_unbilled_paise: c.prevUnbilled, prev_excess_paise: c.prevExcess, prev_provision_paise: c.prevProvision };
      return { ...view(actor, { ...x, id: 0, doc_no: null, period: b.period, status: 'DRAFT', version: 0, requested_by: actor.user }), trace: c.trace, prevRef: c.prevRef, journal: journalLines(x).map((l) => ({ code: db.prepare('SELECT code FROM fin_accounts WHERE id = ?').get(l.accountId)?.code, debit: l.debit ? Number(l.debit) : 0, credit: l.credit ? Number(l.credit) : 0 })) }; },
    create(actor, b) {
      const p = projectOk(actor, b.projectId, 'fin.revenue_recognition.create'); if (b.period > todayIST().slice(0, 7)) throw badRequest('Correct the highlighted fields', [{ field: 'period', message: 'Revenue is recognised for a month that has begun.' }]);
      if (b.method === 'OUTPUT' && b.surveyPct != null && !(b.surveyNote ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'surveyNote', message: 'Say how the surveyed percentage was measured.' }]);
      if (db.prepare("SELECT 1 FROM pa_revenue_recognition WHERE org_project_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(p.id, b.period)) throw conflict('The month is recognised for this project: amend the approved record instead.');
      const c = compute(actor.companyId, p.id, b.period, b); const v = cols(c);
      return transaction(db, () => { let id; try { id = Number(db.prepare(`INSERT INTO pa_revenue_recognition (company_id, doc_no, org_project_id, period, period_id, survey_note, ${Object.keys(v).join(', ')}, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ${Object.keys(v).map(() => '?').join(', ')}, ?, ?, 'api')`).run(actor.companyId, flow.next(actor), p.id, b.period, periodId(actor.companyId, monthEnd(b.period)), b.surveyNote ?? null, ...Object.values(v), actor.user, actor.user).lastInsertRowid); } catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict('A recognition of this project and month is already open.'); throw x; }
        audit(actor, 'pa_revenue_recognition', id, 'create', actor.companyId, { newValues: { project: p.code, period: b.period, method: c.method, poc: c.poc / 10000, recognised: rs(c.recognisedCum) } }); return recognition.get(actor, id); });
    },
    /** A draft or a returned record is worked out again from the ledgers (or with another method). */
    update(actor, id, b) {
      const r = flow.row(actor, id, 'fin.revenue_recognition.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned recognition is changed.'); if (b.version != null && b.version !== r.version) throw conflict('Someone changed this recognition meanwhile: reload it.');
      const method = b.method ?? r.method; const surveyPct = 'surveyPct' in b ? b.surveyPct : r.survey_pct_ppm != null ? r.survey_pct_ppm / 10000 : null; const note = 'surveyNote' in b ? b.surveyNote : r.survey_note;
      if (method === 'OUTPUT' && surveyPct != null && !(note ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'surveyNote', message: 'Say how the surveyed percentage was measured.' }]);
      const v = cols(compute(r.company_id, r.org_project_id, r.period, { method, surveyPct, amendsId: r.amends_id })); db.prepare(`UPDATE pa_revenue_recognition SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')}, survey_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...Object.values(v), note ?? null, actor.user, nowIso(), r.id);
      audit(actor, 'pa_revenue_recognition', r.id, 'update', r.company_id, { oldValues: { method: r.method, recognised: rs(r.recognised_cum_paise) }, newValues: { method, recognised: rs(v.recognised_cum_paise) } }); return recognition.get(actor, r.id);
    },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return recognition.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return recognition.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return recognition.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    /** An approved month corrected: a new draft beside it; its approval posts the difference and supersedes it. Only the project's latest approved month. */
    amend(actor, id, { reason }) {
      const r = flow.row(actor, id, 'fin.revenue_recognition.amend'); if (r.status !== 'APPROVED') throw conflict('Only an approved recognition is amended.');
      if (db.prepare("SELECT 1 FROM pa_revenue_recognition WHERE org_project_id = ? AND period > ? AND status = 'APPROVED' AND deleted_at IS NULL").get(r.org_project_id, r.period)) throw conflict('A later month is approved: amend that one, or correct this in the current month.');
      if (db.prepare("SELECT 1 FROM pa_revenue_recognition WHERE amends_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment is already open.');
      const c = compute(r.company_id, r.org_project_id, r.period, { method: r.method, surveyPct: r.survey_pct_ppm != null ? r.survey_pct_ppm / 10000 : null, amendsId: r.id }); const v = cols(c);
      return transaction(db, () => { const nid = Number(db.prepare(`INSERT INTO pa_revenue_recognition (company_id, doc_no, org_project_id, period, period_id, survey_note, amends_id, ${Object.keys(v).join(', ')}, requested_by, created_by, source_type, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ${Object.keys(v).map(() => '?').join(', ')}, ?, ?, 'api', ?)`).run(r.company_id, `${r.doc_no}-A${(db.prepare('SELECT COUNT(*) AS n FROM pa_revenue_recognition WHERE amends_id = ?').get(r.id).n ?? 0) + 1}`, r.org_project_id, r.period, r.period_id, r.survey_note, r.id, ...Object.values(v), actor.user, actor.user, reason).lastInsertRowid);
        audit(actor, 'pa_revenue_recognition', nid, 'amend', r.company_id, { reason: `amends ${r.doc_no}: ${reason}` }); return recognition.get(actor, nid); });
    },
    print(actor, id) {
      const r = flow.row(actor, id, 'fin.revenue_recognition.print'); const v = view(actor, r, true); audit(actor, 'pa_revenue_recognition', r.id, 'print', r.company_id); const m = (x) => (x ?? 0).toFixed(2);
      const rows = [['Project', v.project], ['Month', v.period], ['Method', v.methodLabel], ['Cost incurred to date', m(v.costToDate)], ['Estimate at completion', `${m(v.eac)} (${v.eacRef ?? v.eacSource})`], ['Output to date', m(v.output)], ['Percentage of completion', `${v.pocPct.toFixed(4)} %`], ['Contract revenue', m(v.contractRevenue)], ['Revenue recognised to date', m(v.recognisedCum)], ['Recognised before', m(v.recognisedPrev)], ['Recognised this month', m(v.recognisedPeriod)], ['Billed to date', m(v.billed)], ['Unbilled revenue (contract asset)', m(v.unbilled)], ['Billing in excess (contract liability)', m(v.excess)], ['Expected loss', m(v.expectedLoss)], ['Provision for the loss', m(v.lossProvision)], ['Status', v.statusLabel], ...v.journal.map((l) => [`Journal ${l.code} ${l.name ?? ''}`, l.debit ? `Dr ${m(l.debit)}` : `Cr ${m(l.credit)}`])].map(([k, x]) => ({ k, v: String(x ?? '') }));
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Revenue recognition ${r.doc_no}`, columns: [{ key: 'k', label: 'Particular', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }], rows, footer: [`Ind AS 115 / AS 7: ${v.methodLabel.toLowerCase()}. ${Object.entries(v.trace).map(([k, t]) => `${k}: ${t}`).join('; ')}`] }) };
    },
    exportCsv(actor, query = {}) { need(actor, 'fin.revenue_recognition.export', 'export revenue recognition'); const l = recognition.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'pa_revenue_recognition', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `revenue-recognition-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Record', 'Project', 'Month', 'Method', 'Cost to date', 'EAC', 'POC %', 'Contract revenue', 'Recognised to date', 'This month', 'Billed', 'Unbilled', 'Billing in excess', 'Loss provision', 'Status'], l.data.map((x) => [x.docNo, x.project, x.period, x.methodLabel, x.costToDate, x.eac, x.pocPct, x.contractRevenue, x.recognisedCum, x.recognisedPeriod, x.billed, x.unbilled, x.excess, x.lossProvision, x.statusLabel]))}`, 'utf8') }; },
    /** Drafts for many projects of a month from rows { project (code), period, method?, surveyPct?, surveyNote? }: each row stands alone. */
    importRows(actor, { rows }) {
      need(actor, 'fin.revenue_recognition.create', 'recognise revenue'); const out = [];
      for (const [i, x] of rows.entries()) { try { const p = db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, String(x.project ?? '')); if (!p) throw notFound(`Project ${x.project} does not exist.`); const d = recognition.create(actor, { projectId: p.id, period: x.period, method: x.method ?? 'COST_TO_COST', surveyPct: x.surveyPct ?? null, surveyNote: x.surveyNote ?? null }); out.push({ row: i + 1, ok: true, docNo: d.docNo }); } catch (e) { out.push({ row: i + 1, ok: false, error: e.message }); } }
      return { created: out.filter((x) => x.ok).length, rows: out };
    },
    /** The projects that can be recognised for a month: active projects with an approved contract, with the state of the month. */
    candidates(actor, { period }) {
      need(actor, 'fin.revenue_recognition.view', 'see revenue recognition');
      const rows = has('ctr_contracts') ? db.prepare("SELECT DISTINCT p.id, p.code, p.name FROM org_projects p JOIN ctr_contracts k ON k.org_project_id = p.id AND k.status = 'APPROVED' AND k.deleted_at IS NULL WHERE p.company_id = ? AND p.deleted_at IS NULL ORDER BY p.code LIMIT 500").all(actor.companyId) : [];
      return rows.filter((p) => may(actor, 'fin.revenue_recognition.view', p.id)).map((p) => { const r = db.prepare("SELECT id, doc_no, status FROM pa_revenue_recognition WHERE org_project_id = ? AND period = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(p.id, period); return { projectId: p.id, project: `${p.code} ${p.name}`, recognitionId: r?.id ?? null, docNo: r?.doc_no ?? null, status: r?.status ?? null }; });
    },
  };

  // ---- FR-01: project trial balance; reports ----
  const reports = {
    /** The trial balance of a project for [from, to]: opening, debits, credits, closing by account, grouped by head. */
    trialBalance(actor, { projectId, from, to }) {
      const p = projOf(projectId); if (!p || p.company_id !== actor.companyId) throw notFound('That project does not exist.'); need(actor, 'fin.project_ledger.view', 'see the project ledger', p.id);
      const open = new Map(balances(actor.companyId, p.id, addDaysIso(from, -1)).map((r) => [r.id, r.dr - r.cr])); const mov = balances(actor.companyId, p.id, to, from); const ids = new Set([...open.keys(), ...mov.map((r) => r.id)]);
      const info = new Map([...balances(actor.companyId, p.id, to)].map((r) => [r.id, r]));
      const rows = [...ids].map((id) => { const a = info.get(id) ?? mov.find((r) => r.id === id); const m = mov.find((r) => r.id === id); const o = open.get(id) ?? 0; return { accountId: id, code: a.code, name: a.name, head: headOf(a), opening: rs(o), debit: rs(m?.dr ?? 0), credit: rs(m?.cr ?? 0), closing: rs(o + (m?.dr ?? 0) - (m?.cr ?? 0)) }; }).sort((a, b) => a.code.localeCompare(b.code));
      const sum = (f, k) => rows.filter(f).reduce((a, r) => a + Math.round(r[k] * 100), 0) / 100; const H = (h) => (r) => r.head === h;
      const revenue = -sum(H('REVENUE'), 'closing'); const direct = sum(H('DIRECT_COST'), 'closing'); const overhead = sum(H('OVERHEAD'), 'closing');
      return { projectId: p.id, project: `${p.code} ${p.name}`, from, to, rows, totals: { debit: sum(() => true, 'debit'), credit: sum(() => true, 'credit'), closing: sum(() => true, 'closing') }, heads: { revenue: rs(Math.round(revenue * 100)), directCost: rs(Math.round(direct * 100)), overhead: rs(Math.round(overhead * 100)), margin: rs(Math.round((revenue - direct - overhead) * 100)) } };
    },
    /** WIP and unbilled revenue: the latest approved recognition of each project to a month. */
    wip(actor, { period }) {
      need(actor, 'fin.project_ledger.view', 'see WIP and unbilled revenue');
      const rows = db.prepare("SELECT x.* FROM pa_revenue_recognition x WHERE x.company_id = ? AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.period <= ? AND x.period = (SELECT MAX(y.period) FROM pa_revenue_recognition y WHERE y.org_project_id = x.org_project_id AND y.status = 'APPROVED' AND y.deleted_at IS NULL AND y.period <= ?) ORDER BY x.org_project_id").all(actor.companyId, period, period).filter((r) => may(actor, 'fin.project_ledger.view', r.org_project_id)).map((r) => view(actor, r));
      const t = (k) => rs(rows.reduce((a, r) => a + Math.round((r[k] ?? 0) * 100), 0));
      return { period, rows, totals: { contractRevenue: t('contractRevenue'), recognisedCum: t('recognisedCum'), billed: t('billed'), unbilled: t('unbilled'), excess: t('excess'), lossProvision: t('lossProvision'), costToDate: t('costToDate') } };
    },
    /** The overhead posted to the projects in [from, to] (months). */
    overheads(actor, { from, to }) {
      need(actor, 'fin.project_ledger.view', 'see the overhead allocated');
      const rows = db.prepare("SELECT o.*, p.code, p.name FROM pa_overhead_allocations o JOIN org_projects p ON p.id = o.org_project_id WHERE o.company_id = ? AND o.period BETWEEN ? AND ? AND o.deleted_at IS NULL ORDER BY o.period, o.pool, p.code").all(actor.companyId, from, to).filter((r) => may(actor, 'fin.project_ledger.view', r.org_project_id))
        .map((r) => ({ id: r.id, runId: r.run_id, pool: r.pool, period: r.period, projectId: r.org_project_id, project: `${r.code} ${r.name}`, basisValue: rs(r.basis_value_paise), amount: rs(r.amount_paise), status: r.alloc_status, journalId: r.journal_id, reversalJournalId: r.reversal_journal_id }));
      const live = rows.filter((r) => r.status === 'POSTED'); const byProject = new Map(); for (const r of live) byProject.set(r.project, (byProject.get(r.project) ?? 0) + Math.round(r.amount * 100));
      const unposted = has('bud_alloc_runs') ? db.prepare("SELECT r.id, r.doc_no, r.pool_amount FROM bud_alloc_runs r WHERE r.company_id = ? AND r.status = 'POSTED' AND r.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM pa_overhead_allocations o WHERE o.run_id = r.id AND o.deleted_at IS NULL)").all(actor.companyId).map((r) => ({ runId: r.id, docNo: r.doc_no, pool: rs(r.pool_amount) })) : [];
      return { from, to, rows, total: rs(live.reduce((a, r) => a + Math.round(r.amount * 100), 0)), byProject: [...byProject.entries()].map(([project, v]) => ({ project, amount: rs(v) })), unposted, canPost: may(actor, 'fin.overhead.post') };
    },
    /** @param {any} actor @param {any} args */
    exportCsv(actor, { kind, ...q }) {
      need(actor, 'fin.project_ledger.export', 'export project accounts'); let headers; let rows;
      if (kind === 'tb') { const t = reports.trialBalance(actor, q); headers = ['Account', 'Name', 'Head', 'Opening', 'Debit', 'Credit', 'Closing']; rows = t.rows.map((r) => [r.code, r.name, r.head, r.opening, r.debit, r.credit, r.closing]); }
      else if (kind === 'wip') { const w = reports.wip(actor, q); headers = ['Project', 'Month', 'POC %', 'Contract revenue', 'Cost to date', 'Recognised', 'Billed', 'Unbilled', 'Billing in excess', 'Loss provision']; rows = w.rows.map((r) => [r.project, r.period, r.pocPct, r.contractRevenue, r.costToDate, r.recognisedCum, r.billed, r.unbilled, r.excess, r.lossProvision]); }
      else { const o = reports.overheads(actor, q); headers = ['Pool', 'Month', 'Project', 'Basis', 'Amount', 'Status']; rows = o.rows.map((r) => [r.pool, r.period, r.project, r.basisValue, r.amount, r.status]); }
      audit(actor, 'pa_revenue_recognition', 0, 'export', actor.companyId, { reason: `project accounts ${kind}: ${rows.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `project-accounts-${kind}-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') };
    },
  };

  // ---- FR-04: the overhead of the pools (12.04) posted to the projects ----
  const overheads = {
    /** A posted allocation run: one journal, Dr 560030 by project, Cr 560031; once per run (the event and the catch-up both come here). */
    postRun(companyId, runId, user = 'system') {
      if (!on(companyId)) return null; const r = db.prepare("SELECT r.*, t.end_date, t.name AS to_name FROM bud_alloc_runs r JOIN core_periods t ON t.id = r.to_period_id WHERE r.id = ? AND r.company_id = ? AND r.status = 'POSTED' AND r.deleted_at IS NULL").get(Number(runId), companyId); if (!r) return null;
      if (db.prepare('SELECT 1 FROM pa_overhead_allocations WHERE run_id = ? AND deleted_at IS NULL').get(r.id)) return null;
      const lines = db.prepare('SELECT * FROM bud_alloc_lines WHERE run_id = ? AND deleted_at IS NULL AND amount > 0 ORDER BY org_project_id').all(r.id); if (!lines.length) return null;
      const dr = acct(companyId, '560030'); const cr = acct(companyId, '560031'); if (!dr || !cr) return null; // the company's chart is not set up yet: the catch-up posts the run once it is (a retried event would only dead-letter)
      const total = lines.reduce((a, l) => a + l.amount, 0); const period = r.end_date.slice(0, 7);
      return transaction(db, () => {
        const j = gl.postEngine(companyId, { voucherType: 'JV', date: r.end_date, narration: `Overhead pool ${r.doc_no} allocated to ${lines.length} project(s) to ${r.to_name}`, sourceType: 'bud_alloc_runs', sourceId: r.id, lines: [...lines.map((l) => ({ accountId: dr, debit: rs(l.amount), ...projectFor(dr, l.org_project_id) })), { accountId: cr, credit: rs(total) }], user });
        const ins = db.prepare("INSERT INTO pa_overhead_allocations (company_id, run_id, pool, period, period_id, org_project_id, basis_value_paise, amount_paise, journal_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bud_alloc_runs', ?)");
        for (const l of lines) ins.run(companyId, r.id, r.doc_no, period, periodId(companyId, r.end_date), l.org_project_id, l.basis_value ?? 0, l.amount, j.journal.id, user, String(r.id));
        audit({ user }, 'pa_overhead_allocations', r.id, 'post', companyId, { reason: `${r.doc_no}: ₹${rs(total)} to ${lines.length} project(s)` });
        evt('fin.overhead.posted', { user }, companyId, 'bud_alloc_runs', r.id, { runId: r.id, docNo: r.doc_no, period, total: rs(total), journalId: j.journal.id, allocations: lines.map((l) => ({ projectId: l.org_project_id, amount: rs(l.amount) })) });
        return { runId: r.id, journalId: j.journal.id, projects: lines.length, total: rs(total) };
      });
    },
    /** A run reversed in 12.04: its journal reversed (Cr by project, Dr the contra), today. */
    reverseRun(companyId, runId, user = 'system') {
      const rows = db.prepare("SELECT * FROM pa_overhead_allocations WHERE run_id = ? AND company_id = ? AND alloc_status = 'POSTED' AND deleted_at IS NULL").all(Number(runId), companyId); if (!rows.length) return null;
      const dr = acct(companyId, '560030'); const cr = acct(companyId, '560031'); const total = rows.reduce((a, l) => a + l.amount_paise, 0);
      return transaction(db, () => { const j = gl.postEngine(companyId, { voucherType: 'JV', date: todayIST(), narration: `Overhead pool ${rows[0].pool} reversed`, sourceType: 'bud_alloc_runs_reversal', sourceId: Number(runId), lines: [...rows.map((l) => ({ accountId: dr, credit: rs(l.amount_paise), ...projectFor(dr, l.org_project_id) })), { accountId: cr, debit: rs(total) }], user });
        db.prepare("UPDATE pa_overhead_allocations SET alloc_status = 'REVERSED', reversal_journal_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE run_id = ? AND alloc_status = 'POSTED'").run(j.journal.id, user, nowIso(), Number(runId)); audit({ user }, 'pa_overhead_allocations', Number(runId), 'reverse', companyId, { reason: rows[0].pool }); return { reversed: rows.length, journalId: j.journal.id }; });
    },
    /** The runs posted in 12.04 and not yet in the books (before the part was on, or a failed event): posted now. */
    catchUp(actor) { need(actor, 'fin.overhead.post', 'post overhead allocations'); if (!on(actor.companyId)) throw unprocessable('Project accounting is off for the company (ff.fin.p2310).'); const done = []; for (const r of db.prepare("SELECT id FROM bud_alloc_runs WHERE company_id = ? AND status = 'POSTED' AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM pa_overhead_allocations o WHERE o.run_id = bud_alloc_runs.id AND o.deleted_at IS NULL) ORDER BY id").all(actor.companyId)) { const x = overheads.postRun(actor.companyId, r.id, actor.user); if (x) done.push(x); } return { posted: done.length, runs: done }; },
  };
  const consumers = {
    onAllocated(e) { const c = Number(e.companyId); const id = e.data?.runId ?? e.entityId; return c && id ? overheads.postRun(c, id) : null; },
    onAllocationReversed(e) { const c = Number(e.companyId); const id = e.data?.runId ?? e.entityId; return c && id ? overheads.reverseRun(c, id) : null; },
  };
  /** The month's reminder: projects with an approved contract and no recognition of last month, from the 5th. */
  const jobs = {
    remind() { let n = 0; const today = todayIST(); if (Number(today.slice(8, 10)) < 5) return { reminded: 0 }; const [y, m] = today.slice(0, 7).split('-').map(Number); const last = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
      for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!on(c.id) || !has('ctr_contracts')) continue; const open = db.prepare("SELECT COUNT(DISTINCT k.org_project_id) AS n FROM ctr_contracts k WHERE k.company_id = ? AND k.status = 'APPROVED' AND k.contract_state = 'ACTIVE' AND k.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM pa_revenue_recognition r WHERE r.org_project_id = k.org_project_id AND r.period = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL)").get(c.id, last).n; if (!open) continue; n += 1; notify(c.id, 'fin.revrec.alert', ['permission:fin.revenue_recognition.create'], last, 'revenue to recognise', `${open} project(s) have no approved revenue recognition for ${last}.`, '/finance/revenue-recognition', `${c.id}-${last}`); }
      return { reminded: n }; },
  };
  return { recognition, reports, overheads, consumers, jobs, compute, revenueOf: (companyId, projectId, period) => db.prepare("SELECT * FROM pa_revenue_recognition WHERE company_id = ? AND org_project_id = ? AND period <= ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period DESC LIMIT 1").get(companyId, projectId, period) ?? null };
}
const addDaysIso = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
