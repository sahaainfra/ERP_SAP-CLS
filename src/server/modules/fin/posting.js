import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { CalcError, runDefinition } from '../../../shared/calc.js';
import { todayIST } from '../../../shared/dates.js';
import { assertPeriodOpen } from '../core/financial-years/service.js';
import { nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { finOf } from './service.js';

// Part 23.02: the posting engine. Every financial event of the other modules (a goods receipt, a return to vendor, an issue, a matched vendor invoice, an approved
// subcontractor bill, a tax invoice and its cancellation) is turned into one journal of the general ledger (23.01) by the rule in force for it on the event's date:
// the rule's conditions pick it among the rules of the event type (by priority), its lines give the account (a code of the company's chart), the side, the amount
// (an expression of the calculation engine 01.06 over the event's figures, exact to the paisa) and the dimensions (fields of the event). One event makes at most one
// journal (the log is unique per event, the journal per source document, BR-01); an event that cannot post (no rule, an account missing, a dimension the account needs,
// a closed period) waits in the failed postings with its reason until it is re-posted. Rules change by a new version approved by the CFO, in force from its date
// (events before it keep the old version); history is replayed after a dry run, its commit approved by the accounts manager and the CFO. The sub-ledgers are
// reconciled with the control accounts of the ledger.

export const RULE_DOC = 'FIN_POSTING_RULE';
export const REPLAY_DOC = 'FIN_REPLAY';
const paise = (s) => Math.round(Number(s) * 100);
const rs = (p) => (p == null ? null : p / 100);
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const OPS = ['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty'];
const LINE_DIMS = ['branchId', 'projectId', 'siteId', 'wbsId', 'costCentreId', 'profitCentreId', 'departmentId', 'costCodeId', 'partnerId', 'employeeId', 'equipmentId'];

/**
 * The events the engine posts. docType: the object type of the source document (the journal's source, drill-down); idField: its id in the event; date: the
 * field (or a lookup) that dates the journal; amounts: the figures in rupees, `paise` those the producer sends in paise; text: fields a condition or a narration may use;
 * enrich(db, companyId, data): more fields read from the masters (the project and site of a store, the state of supply of an invoice).
 */
export const EVENTS = {
  'inv.grn.posted': { label: 'Goods receipt posted (16.03)', docType: 'inv_grns', idField: 'grnId', refField: 'docNo', date: (d) => d.receivedOn, paise: ['totalValue'], amounts: [], text: ['docNo', 'challanNo', 'invoiceNo'], ids: ['vendorId', 'storeId', 'poId'], enrich: 'store' },
  'inv.rtv.posted': { label: 'Return to vendor posted (16.03)', docType: 'inv_rtvs', idField: 'rtvId', refField: 'docNo', date: (d, db) => db.prepare('SELECT rtv_date AS d FROM inv_rtvs WHERE id = ?').get(Number(d.rtvId))?.d, paise: ['totalValue'], amounts: [], text: ['docNo', 'grnNo', 'reason'], ids: ['vendorId', 'storeId', 'grnId'], enrich: 'store' },
  'inv.issue.posted': { label: 'Material issue posted (16.04)', docType: 'inv_issues', idField: 'issueId', refField: 'docNo', date: (d, db) => db.prepare('SELECT issue_date AS d FROM inv_issues WHERE id = ?').get(Number(d.issueId))?.d, paise: ['totalValue', 'recoverableValue'], amounts: [], text: ['docNo', 'type'], ids: ['projectId', 'storeId', 'wbsId', 'costCodeId', 'subcontractorId'], enrich: 'store' },
  'ap.invoice.matched': { label: 'Vendor invoice matched and approved (22.06)', docType: 'bill_vendor_invoices', idField: 'invoiceId', refField: 'invoiceNo', date: (d) => d.invoiceDate, paise: [], amounts: ['taxable', 'tax', 'total', 'debit', 'payable'], text: ['invoiceNo', 'kind', 'vendorGstin'], ids: ['projectId', 'vendorId', 'poId'], enrich: 'vendorSupply' },
  'bill.sub.approved': { label: 'Subcontractor bill approved (22.05)', docType: 'bill_sub_bills', idField: 'billId', refField: 'billNo', date: (d) => d.periodTo, paise: [], amounts: ['gross', 'gst', 'rcm', 'tds', 'retention', 'securityDeposit', 'advanceRecovery', 'deductions', 'net'], text: ['billNo', 'billType', 'gstMode'], ids: ['projectId', 'subcontractorId', 'woId'], enrich: 'subSupply' },
  'bill.invoice.issued': { label: 'Tax invoice issued to the client (22.04)', docType: 'bill_tax_invoices', idField: 'invoiceId', refField: 'invoiceNo', date: (d) => d.invoiceDate, paise: [], amounts: ['taxable', 'cgst', 'sgst', 'igst', 'total'], text: ['invoiceNo', 'supply', 'sacCode'], ids: ['projectId', 'contractId', 'billId'], enrich: 'client' },
  'bill.invoice.cancelled': { label: 'Tax invoice cancelled (22.04)', docType: 'bill_tax_invoices', idField: 'invoiceId', refField: 'invoiceNo', date: (d, _db, e) => String(e?.occurredAt ?? '').slice(0, 10) || todayIST(), paise: [], amounts: ['total'], text: ['invoiceNo', 'reason'], ids: ['projectId', 'billId'], enrich: null },
};
export const EVENT_TYPES = Object.keys(EVENTS);

export const ruleList = defineList({
  code: 'fin.posting_rules', label: 'Posting rules', permission: 'fin.posting_rule.view',
  from: 'fin_posting_rules x', where: '(x.company_id = :c OR (x.company_id IS NULL AND NOT EXISTS (SELECT 1 FROM fin_posting_rules o WHERE o.company_id = :c AND o.rule_code = x.rule_code AND o.deleted_at IS NULL))) AND x.deleted_at IS NULL',
  columns: {
    ruleCode: { sql: 'x.rule_code', type: 'text', label: 'Rule' }, name: { sql: 'x.name', type: 'text', label: 'Name' },
    eventType: { sql: 'x.event_type', type: 'enum', label: 'Event', options: Object.entries(EVENTS).map(([k, v]) => [k, v.label]) },
    priority: { sql: 'x.priority', type: 'number', label: 'Priority' }, version: { sql: 'x.rule_version', type: 'number', label: 'Version' },
    effectiveFrom: { sql: 'x.effective_from', type: 'date', label: 'In force from' }, owner: { sql: "(CASE WHEN x.company_id IS NULL THEN 'Standard' ELSE 'Company' END)", type: 'text', label: 'Kept by' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries({ ...STATUS, APPROVED: 'In force' }) },
  },
});
export const logList = defineList({
  code: 'fin.postings', label: 'Postings', permission: 'fin.posting.view',
  from: 'fin_posting_log x', where: 'x.company_id = :c AND x.deleted_at IS NULL',
  columns: {
    docRef: { sql: "COALESCE(x.doc_ref, x.doc_type || ' ' || x.doc_id)", type: 'text', label: 'Document' },
    eventType: { sql: 'x.event_type', type: 'enum', label: 'Event', options: Object.entries(EVENTS).map(([k, v]) => [k, v.label]) },
    eventDate: { sql: 'x.event_date', type: 'date', label: 'Date' }, amount: { sql: '(x.amount_paise / 100.0)', type: 'money', label: 'Amount' },
    errorCode: { sql: "COALESCE(x.error_code, '')", type: 'text', label: 'Reason' }, error: { sql: "COALESCE(x.error, '')", type: 'text', label: 'What is wrong' },
    attempts: { sql: 'x.attempts', type: 'number', label: 'Attempts' },
    age: { sql: "CAST(julianday('now') - julianday(x.created_at) AS INTEGER)", type: 'number', label: 'Days waiting' },
    status: { sql: 'x.log_status', type: 'enum', label: 'Status', options: [['POSTED', 'Posted'], ['FAILED', 'Failed'], ['SKIPPED', 'Skipped'], ['RESOLVED', 'Resolved'], ['IGNORED', 'Ignored']] },
  },
});

/** @param {{ db: any, base: any, gl: any, flags: any }} o */
export function createPostingService({ db, base, gl, flags }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2302');

  // ---- what an event brings: its date, figures (rupees, as strings for the exact calculation) and the fields read from the masters ----
  const ownStates = (companyId) => {
    const s = db.prepare('SELECT gstins_json FROM core_company_settings WHERE company_id = ?').get(companyId);
    const fromSettings = s ? json(s.gstins_json, []).map((g) => g.stateCode ?? String(g.gstin ?? '').slice(0, 2)) : [];
    const fromBranches = db.prepare("SELECT COALESCE(state_code, substr(gstin, 1, 2)) AS st FROM org_branches WHERE company_id = ? AND gstin IS NOT NULL AND gstin <> '' AND deleted_at IS NULL").all(companyId).map((r) => r.st);
    return new Set([...fromSettings, ...fromBranches].filter(Boolean).map(String));
  };
  /** 0 within the state, 1 between states; null when it cannot be told (no GSTIN of the party or of the company) and there is tax. */
  const supplyOf = (companyId, gstin, tax) => { if (!Number(tax)) return 0; const own = ownStates(companyId); if (!gstin || !own.size) return null; return own.has(String(gstin).slice(0, 2)) ? 0 : 1; };
  const ENRICH = {
    store: (companyId, d) => { const st = d.storeId ? db.prepare('SELECT * FROM inv_stores WHERE id = ? AND company_id = ?').get(Number(d.storeId), companyId) : null; return { storeProjectId: st?.org_project_id ?? st?.project_id ?? null, storeSiteId: st?.org_site_id ?? st?.site_id ?? null }; },
    vendorSupply: (companyId, d) => ({ interState: supplyOf(companyId, d.vendorGstin, d.tax) }),
    subSupply: (companyId, d) => { const g = d.subcontractorId ? db.prepare("SELECT gstin FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(Number(d.subcontractorId)) : null; return { interState: supplyOf(companyId, g?.gstin, d.gst) }; },
    client: (companyId, d) => { const k = d.contractId ? db.prepare('SELECT client_partner_id FROM ctr_contracts WHERE id = ? AND company_id = ?').get(Number(d.contractId), companyId) : null; return { clientId: k?.client_partner_id ?? null }; },
  };
  function contextOf(companyId, e) {
    const def = EVENTS[e.type]; const d = e.data ?? {};
    const data = { ...d };
    for (const k of def.paise) if (d[k] != null) data[k] = (Number(d[k]) / 100).toFixed(2);
    for (const k of def.amounts) if (d[k] != null) data[k] = String(d[k]);
    if (def.enrich) { try { Object.assign(data, ENRICH[def.enrich](companyId, d)); } catch { /* a master that is not there: the rule's field stays empty and the rule says what is missing */ } }
    return { def, data, date: def.date(d, db, e), docId: d[def.idField] == null ? null : String(d[def.idField]), docRef: d[def.refField] ?? null };
  }

  // ---- the rules in force ----
  const ruleView = (r) => ({ id: r.id, docNo: r.doc_no, ruleCode: r.rule_code, eventType: r.event_type, eventLabel: EVENTS[r.event_type]?.label ?? r.event_type, name: r.name, action: r.action, reversesEvent: r.reverses_event, priority: r.priority, conditions: json(r.condition_json, []), lines: json(r.lines_json, []), narration: r.narration_template, voucherType: r.voucher_type, version: r.rule_version, effectiveFrom: r.effective_from, status: r.status, standard: r.company_id == null, reason: r.change_reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, rowVersion: r.version });
  /** The rules of an event type in force on a date: of each rule code the latest approved version from on or before the date; the company's own versions replace the standard ones of the same code. */
  function rulesFor(companyId, eventType, date) {
    const rows = db.prepare("SELECT * FROM fin_posting_rules WHERE event_type = ? AND status = 'APPROVED' AND effective_from <= ? AND deleted_at IS NULL AND (company_id = ? OR company_id IS NULL) ORDER BY rule_code, (company_id IS NULL), rule_version DESC").all(eventType, date, companyId);
    const own = new Set(rows.filter((r) => r.company_id === companyId).map((r) => r.rule_code)); const seen = new Set(); const out = [];
    for (const r of rows) { if (seen.has(r.rule_code) || (r.company_id == null && own.has(r.rule_code))) continue; seen.add(r.rule_code); out.push(r); }
    return out.sort((a, b) => a.priority - b.priority || a.rule_code.localeCompare(b.rule_code));
  }
  const valueAt = (data, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
  function matches(conds, data) {
    return conds.every((c) => {
      const v = valueAt(data, c.field); const n = Number(v); const w = c.value;
      switch (c.op) {
        case 'eq': return String(v ?? '') === String(w); case 'ne': return String(v ?? '') !== String(w);
        case 'in': return (Array.isArray(w) ? w : String(w).split(',')).map((x) => String(x).trim()).includes(String(v ?? ''));
        case 'gt': return n > Number(w); case 'gte': return n >= Number(w); case 'lt': return n < Number(w); case 'lte': return n <= Number(w);
        case 'empty': return v == null || v === ''; case 'notempty': return !(v == null || v === '');
        default: return false;
      }
    });
  }
  const fill = (tpl, data) => String(tpl ?? '').replace(/\{([A-Za-z0-9_.]+)\}/g, (_m, k) => { const v = valueAt(data, k); return v == null ? '' : String(v); });
  /** An amount of a rule line: the expression of the calculation engine over the event's figures, rounded to the paisa. */
  function amountOf(expr, def, data) {
    const names = [...def.paise, ...def.amounts, 'interState'];
    const inputs = names.filter((k) => data[k] != null && data[k] !== '').map((k) => ({ name: k, type: k === 'interState' ? 'integer' : 'decimal' }));
    const raw = Object.fromEntries(inputs.map((i) => [i.name, String(data[i.name])]));
    const r = runDefinition({ expression: `amount = ${expr}`, inputs, outputs: [{ name: 'amount', type: 'money' }], rounding_policy: 'half_up' }, raw);
    return paise(r.outputs.amount);
  }
  /** @returns {any} */
  const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

  /**
   * What an event would post, without writing: { ok, rule, journal: { voucherType, date, narration, sourceType, sourceId, lines } } or { ok: false, code, message }.
   * A REVERSE rule returns { ok, reverse: journalId }. `ruleOverride` tests a draft rule against a sample event.
   * @returns {any}
   */
  function prepare(companyId, e, { ruleOverride = null, check = true } = {}) {
    const def = EVENTS[e.type]; if (!def) return fail('EVENT_UNKNOWN', `The engine does not post ${e.type} events.`);
    const { data, date, docId, docRef } = contextOf(companyId, e);
    if (!date) return fail('NO_DATE', 'The event has no date the journal can take.');
    if (!docId) return fail('NO_DOCUMENT', `The event has no ${def.idField}.`);
    const rules = ruleOverride ? [ruleOverride] : rulesFor(companyId, e.type, date);
    const rule = rules.find((r) => matches(json(r.condition_json, []), data));
    if (!rule) return fail('NO_RULE', `No posting rule in force on ${date} fits this ${def.label.toLowerCase()}${rules.length ? ` (${rules.length} rule${rules.length === 1 ? '' : 's'} of the event, none whose conditions match)` : ''}.`, { date, docId, docRef });
    const base0 = { rule, date, docId, docRef, sourceType: def.docType };
    if (rule.action === 'REVERSE') {
      const orig = db.prepare("SELECT journal_id FROM fin_posting_log WHERE company_id = ? AND event_type = ? AND doc_id = ? AND log_status IN ('POSTED', 'RESOLVED') AND journal_id IS NOT NULL ORDER BY id DESC LIMIT 1").get(companyId, rule.reverses_event, docId);
      if (!orig) return fail('NOTHING_TO_REVERSE', `No journal of ${rule.reverses_event} for ${docRef ?? docId} to reverse.`, { date, docId, docRef });
      return { ok: true, ...base0, reverse: orig.journal_id, narration: fill(rule.narration_template, data).slice(0, 300) || `Reversal of ${docRef ?? docId}`, total: 0 };
    }
    if (data.interState === null && json(rule.lines_json, []).some((l) => /\binterState\b/.test(String(l.amount)))) return fail('SUPPLY_UNKNOWN', 'The state of supply cannot be told: the GSTIN of the party or the company\'s own GSTIN is missing. Add it to the partner or the company settings, then re-post.', { ...base0, rule });
    finOf(db)?.ensureSetup(companyId);
    const lines = []; const problems = [];
    json(rule.lines_json, []).forEach((l, i) => {
      const a = db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, String(l.account ?? ''));
      if (!a) { problems.push(`line ${i + 1}: account ${l.account} is not in the company's chart`); return; }
      let amt;
      try { amt = amountOf(l.amount, def, data); } catch (x) { problems.push(`line ${i + 1}: the amount "${l.amount}" cannot be worked out (${x instanceof CalcError ? x.message : String(x?.message ?? x)})`); return; }
      if (amt < 0) { problems.push(`line ${i + 1}: the amount "${l.amount}" is negative (${(amt / 100).toFixed(2)})`); return; }
      if (amt === 0) return;
      const dims = {}; for (const [k, path] of Object.entries(l.dims ?? {})) { if (!LINE_DIMS.includes(k)) continue; const v = valueAt(data, path); if (v != null && v !== '') dims[k] = Number(v); }
      lines.push({ accountId: a.id, ...(l.side === 'DR' ? { debit: (amt / 100).toFixed(2) } : { credit: (amt / 100).toFixed(2) }), narration: l.narration ? fill(l.narration, data).slice(0, 300) : null, ...dims });
    });
    if (problems.length) return fail(problems.some((p) => p.includes('chart')) ? 'MISSING_ACCOUNT' : 'AMOUNT', problems.join('; '), { ...base0, rule });
    if (lines.length < 2) return fail('NO_LINES', 'The rule gives fewer than two lines for this event (every amount is nil).', { ...base0, rule });
    const journal = { voucherType: rule.voucher_type, date, narration: (fill(rule.narration_template, data) || `${def.label} ${docRef ?? docId}`).slice(0, 500), sourceType: def.docType, sourceId: docId, lines };
    if (check) {
      const c = gl.checkLines(companyId, lines, { source: 'ENGINE' }); if (c.problems.length) return fail(c.problems.some((p) => p.code === 'UNBALANCED') ? 'UNBALANCED' : 'DIMENSION', c.problems.map((p) => p.message).join(' '), { ...base0, journal });
      try { assertPeriodOpen(db, { companyId, module: 'finance', date }); } catch (x) { return fail(x.code ?? 'PERIOD', x.message, { ...base0, journal }); }
    }
    return { ok: true, ...base0, journal, total: lines.reduce((s, l) => s + paise(l.debit ?? 0), 0) };
  }

  // ---- FR-02: the consumer of the outbox ----
  const logRow = (companyId, eventId) => db.prepare('SELECT * FROM fin_posting_log WHERE company_id = ? AND event_id = ?').get(companyId, eventId);
  const slim = (e) => ({ eventId: e.eventId, type: e.type, occurredAt: e.occurredAt ?? null, companyId: e.companyId, entity: e.entity ?? null, entityId: e.entityId ?? null, data: e.data ?? {} });
  /** Post one event (once): the log row says what happened. Returns the log row. `retry` re-posts a failed one; `replayRunId` marks a replay. */
  function handle(e, { retry = false, replayRunId = null, user = 'system' } = {}) {
    const companyId = Number(e.companyId); if (!companyId || !EVENTS[e.type]) return null;
    const prior = logRow(companyId, e.eventId);
    if (prior && (prior.log_status !== 'FAILED' || !retry)) return prior;
    const p = prepare(companyId, e);
    const now = nowIso(); const status = p.ok ? 'POSTED' : 'FAILED';
    const write = (journalId, code, message) => {
      const st = journalId || p.reverse ? 'POSTED' : status; const amt = p.total ?? 0;
      if (prior) db.prepare('UPDATE fin_posting_log SET rule_id = ?, journal_id = ?, log_status = ?, error_code = ?, error = ?, attempts = attempts + 1, amount_paise = ?, posted_at = ?, event_date = COALESCE(?, event_date), replay_run_id = COALESCE(?, replay_run_id), updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND event_id = ?')
        .run(p.rule?.id ?? null, journalId, st, code, message, amt, journalId ? now : null, p.date ?? null, replayRunId, user, now, companyId, e.eventId);
      else db.prepare("INSERT INTO fin_posting_log (company_id, event_id, event_type, event_date, doc_type, doc_id, doc_ref, rule_id, journal_id, log_status, error_code, error, amount_paise, payload_json, posted_at, replay_run_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fin_posting')")
        .run(companyId, e.eventId, e.type, p.date ?? null, EVENTS[e.type].docType, p.docId ?? (e.data?.[EVENTS[e.type].idField] == null ? null : String(e.data[EVENTS[e.type].idField])), p.docRef ?? null, p.rule?.id ?? null, journalId, st, code, message, amt, JSON.stringify(slim(e)), journalId ? now : null, replayRunId, user);
      return logRow(companyId, e.eventId);
    };
    if (!p.ok) {
      const row = write(null, p.code, p.message);
      if (!prior) notify(companyId, 'fin.posting.failed', ['permission:fin.posting.repost'], p.docRef ?? `${e.type}`, 'could not be posted', `${EVENTS[e.type].label} ${p.docRef ?? p.docId ?? ''} was not posted: ${p.message}`, `/finance/failed-postings?id=${row.id}`, row.id);
      return row;
    }
    try {
      return transaction(db, () => {
        if (p.reverse) { const rv = gl.reverseEngine(companyId, p.reverse, { date: p.date, reason: p.narration, user }); return write(rv?.id ?? null, null, null); }
        const r = gl.postEngine(companyId, { ...p.journal, user });
        const row = write(r.journal.id, r.duplicate ? 'DUPLICATE_SOURCE' : null, r.duplicate ? 'The document was already posted by another event; nothing more was posted.' : null);
        // the posting status back to the source document (23.02 outputs): its module, the document flow and the trace show the journal
        if (!r.duplicate) publishEvent(db, { type: 'fin.document.posted', entity: p.sourceType, entityId: p.docId, actorId: user, companyId, data: { eventType: e.type, docType: p.sourceType, docId: p.docId, docRef: p.docRef ?? null, journalId: r.journal.id, voucherNo: r.journal.voucher_no, date: p.date, amount: rs(p.total), rule: p.rule.rule_code } });
        return row;
      });
    } catch (x) {
      const row = write(null, x?.code ?? 'POSTING_FAILED', String(x?.message ?? x).slice(0, 1000));
      if (!prior) notify(companyId, 'fin.posting.failed', ['permission:fin.posting.repost'], p.docRef ?? e.type, 'could not be posted', `${EVENTS[e.type].label} ${p.docRef ?? ''} was not posted: ${x?.message ?? x}`, `/finance/failed-postings?id=${row.id}`, row.id);
      return row;
    }
  }
  /** The bus consumer: only for a company whose flag is on. */
  const onEvent = (e) => { if (!e?.companyId || !on(Number(e.companyId))) return null; return handle(e); };

  // ---- FR-04: the failed postings ----
  const logView = (r, detail = false) => {
    const o = { id: r.id, eventId: r.event_id, eventType: r.event_type, eventLabel: EVENTS[r.event_type]?.label ?? r.event_type, eventDate: r.event_date, docType: r.doc_type, docId: r.doc_id, docRef: r.doc_ref ?? `${r.doc_type} ${r.doc_id}`, ruleId: r.rule_id, journalId: r.journal_id, status: r.log_status, errorCode: r.error_code, error: r.error, attempts: r.attempts, amount: rs(r.amount_paise), postedAt: r.posted_at, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, note: r.resolution_note, createdAt: r.created_at, replayRunId: r.replay_run_id, age: Math.max(0, Math.floor((Date.now() - Date.parse(r.created_at)) / 86_400_000)) };
    if (detail) { const ev = json(r.payload_json, {}); Object.assign(o, { payload: ev.data ?? {}, journal: r.journal_id ? db.prepare('SELECT id, voucher_no, status FROM fin_journals WHERE id = ?').get(r.journal_id) : null, rule: r.rule_id ? ruleView(db.prepare('SELECT * FROM fin_posting_rules WHERE id = ?').get(r.rule_id)) : null, preview: r.log_status === 'FAILED' ? (() => { const p = prepare(r.company_id, ev); return p.ok ? { ok: true, lines: p.journal?.lines ?? [], date: p.date, rule: p.rule.rule_code } : { ok: false, code: p.code, message: p.message }; })() : null }); }
    return o;
  };
  const logRowOf = (actor, id) => { const r = db.prepare('SELECT * FROM fin_posting_log WHERE id = ? AND company_id = ?').get(rid(id), actor.companyId); if (!r) throw notFound('That posting does not exist.'); return r; };
  const postings = {
    list(actor, query) { need(actor, 'fin.posting.view', 'see postings'); return runList(db, logList, parseListRequest(logList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => logView(r) }); },
    get(actor, id) { need(actor, 'fin.posting.view', 'see postings'); return logView(logRowOf(actor, id), true); },
    summary(actor) { need(actor, 'fin.posting.view', 'see postings'); const rows = db.prepare('SELECT log_status AS s, COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS a FROM fin_posting_log WHERE company_id = ? GROUP BY log_status').all(actor.companyId); const byCode = db.prepare("SELECT COALESCE(error_code, 'OTHER') AS code, COUNT(*) AS n FROM fin_posting_log WHERE company_id = ? AND log_status = 'FAILED' GROUP BY error_code ORDER BY n DESC").all(actor.companyId); return { counts: Object.fromEntries(rows.map((r) => [r.s, r.n])), failedByCode: byCode, oldestFailed: db.prepare("SELECT MIN(created_at) AS m FROM fin_posting_log WHERE company_id = ? AND log_status = 'FAILED'").get(actor.companyId).m }; },
    /** Post a failed event again (after the rule, the chart, the master or the period was put right). */
    repost(actor, id) { need(actor, 'fin.posting.repost', 're-post'); const r = logRowOf(actor, id); if (r.log_status !== 'FAILED') throw conflict('Only a failed posting is posted again.'); const out = handle(json(r.payload_json, {}), { retry: true, user: actor.user }); audit(actor, 'fin_posting_log', r.id, 'repost', actor.companyId, { newValues: { status: out.log_status, error: out.error_code } }); return logView(out, true); },
    repostAll(actor, { errorCode }) { need(actor, 'fin.posting.repost', 're-post'); const ids = db.prepare(`SELECT id FROM fin_posting_log WHERE company_id = ? AND log_status = 'FAILED'${errorCode ? ' AND error_code = ?' : ''} ORDER BY id LIMIT 500`).all(...[actor.companyId, ...(errorCode ? [errorCode] : [])]).map((x) => x.id); let posted = 0; for (const id of ids) { const r = db.prepare('SELECT * FROM fin_posting_log WHERE id = ?').get(id); if (handle(json(r.payload_json, {}), { retry: true, user: actor.user }).log_status === 'POSTED') posted += 1; } audit(actor, 'fin_posting_log', 0, 'repost', actor.companyId, { reason: `${posted} of ${ids.length}` }); return { tried: ids.length, posted }; },
    /** Close a failed posting without the engine: put right by a manual journal (its id) or not to be posted (a reason). */
    resolve(actor, id, { outcome, journalId, note }) {
      need(actor, 'fin.posting.resolve', 'resolve failed postings'); const r = logRowOf(actor, id); if (r.log_status !== 'FAILED') throw conflict('Only a failed posting is resolved.');
      if (outcome === 'RESOLVED') { const j = journalId ? db.prepare("SELECT id FROM fin_journals WHERE id = ? AND company_id = ? AND status = 'APPROVED'").get(Number(journalId), actor.companyId) : null; if (!j) throw badRequest('Correct the highlighted fields', [{ field: 'journalId', message: 'Name the posted journal that put it right.' }]); }
      db.prepare('UPDATE fin_posting_log SET log_status = ?, journal_id = COALESCE(?, journal_id), resolved_by = ?, resolved_at = ?, resolution_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome, outcome === 'RESOLVED' ? Number(journalId) : null, actor.user, nowIso(), note, actor.user, nowIso(), r.id);
      audit(actor, 'fin_posting_log', r.id, outcome.toLowerCase(), actor.companyId, { reason: note }); return logView(db.prepare('SELECT * FROM fin_posting_log WHERE id = ?').get(r.id), true);
    },
    exportCsv(actor, query = {}) { need(actor, 'fin.posting.view', 'export postings'); const l = postings.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'fin_posting_log', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `postings-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Document', 'Event', 'Date', 'Amount', 'Status', 'Reason', 'What is wrong', 'Attempts'], l.data.map((x) => [x.docRef, x.eventLabel, x.eventDate, x.amount, x.status, x.errorCode ?? '', x.error ?? '', x.attempts]))}`, 'utf8') }; },
  };

  // ---- FR-01: the rule matrix (a change is a new version approved by the CFO, in force from its date) ----
  const ruleRow = (actor, id) => { const r = db.prepare('SELECT * FROM fin_posting_rules WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That posting rule does not exist.'); return r; };
  const ruleFlow = createFlow({
    db, base, docType: RULE_DOC, table: 'fin_posting_rules', perm: 'fin.posting_rule', label: 'posting rule', route: '/finance/posting-rules?id=',
    where: () => ({ pid: null, sid: null }), ctx: (r) => ({ eventType: r.event_type, ruleCode: r.rule_code }), title: (r) => `${r.rule_code} v${r.rule_version} ${r.name} from ${r.effective_from}`,
    notifyCode: 'fin.posting_rule.decided', numberKey: 'FIN_POSTING_RULE', prefix: 'PRL',
    beforeSubmit: (_a, r) => { const p = checkRule({ eventType: r.event_type, action: r.action, reversesEvent: r.reverses_event, conditions: json(r.condition_json, []), lines: json(r.lines_json, []) }, r.company_id); if (p.length) throw badRequest('Correct the highlighted fields', p); },
  });
  function checkRule(b, companyId) {
    const p = []; const def = EVENTS[b.eventType];
    if (!def) { p.push({ field: 'eventType', message: 'Choose an event the engine posts.' }); return p; }
    (b.conditions ?? []).forEach((c, i) => { if (!c.field) p.push({ field: `conditions.${i}.field`, message: 'Name the field of the event.' }); if (!OPS.includes(c.op)) p.push({ field: `conditions.${i}.op`, message: 'Choose a comparison.' }); });
    if (b.action === 'REVERSE') { if (!EVENTS[b.reversesEvent]) p.push({ field: 'reversesEvent', message: 'Name the event whose journal is reversed.' }); return p; }
    const lines = b.lines ?? []; if (lines.length < 2) p.push({ field: 'lines', message: 'A rule has at least two lines.' });
    if (!lines.some((l) => l.side === 'DR') || !lines.some((l) => l.side === 'CR')) p.push({ field: 'lines', message: 'A rule debits something and credits something.' });
    const names = [...def.paise, ...def.amounts, 'interState'];
    lines.forEach((l, i) => {
      if (!['DR', 'CR'].includes(l.side)) p.push({ field: `lines.${i}.side`, message: 'Debit or credit.' });
      if (companyId != null && !db.prepare('SELECT 1 FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, String(l.account ?? ''))) p.push({ field: `lines.${i}.account`, message: `Account ${l.account} is not in the chart of accounts.` });
      try { runDefinition({ expression: `amount = ${l.amount}`, inputs: names.map((n) => ({ name: n, type: n === 'interState' ? 'integer' : 'decimal' })), outputs: [{ name: 'amount', type: 'money' }] }, Object.fromEntries(names.map((n) => [n, n === 'interState' ? '0' : '1']))); } catch (x) { p.push({ field: `lines.${i}.amount`, message: `The amount: ${x.message}` }); }
      for (const k of Object.keys(l.dims ?? {})) if (!LINE_DIMS.includes(k)) p.push({ field: `lines.${i}.dims`, message: `${k} is not a dimension of a journal line.` });
    });
    return p;
  }
  const rules = {
    flow: ruleFlow,
    catalogue(actor) { need(actor, 'fin.posting_rule.view', 'see posting rules'); return Object.entries(EVENTS).map(([type, d]) => ({ type, label: d.label, docType: d.docType, amounts: [...d.paise, ...d.amounts], text: d.text, ids: d.ids, extra: d.enrich === 'store' ? ['storeProjectId', 'storeSiteId'] : d.enrich === 'client' ? ['clientId'] : d.enrich ? ['interState'] : [] })); },
    list(actor, query) { need(actor, 'fin.posting_rule.view', 'see posting rules'); return runList(db, ruleList, parseListRequest(ruleList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: ruleView }); },
    get(actor, id) {
      need(actor, 'fin.posting_rule.view', 'see posting rules'); const r = ruleRow(actor, id); const v = ruleView(r);
      const versions = db.prepare('SELECT * FROM fin_posting_rules WHERE rule_code = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY (company_id IS NULL), rule_version DESC').all(r.rule_code, actor.companyId).map(ruleView);
      const own = r.company_id === actor.companyId; const can = own ? ruleFlow.can(actor, r) : { edit: false, delete: false, submit: false, withdraw: false, cancel: false };
      return { ...v, versions, can: { ...can, change: may(actor, 'fin.posting_rule.edit') && r.status === 'APPROVED' }, ...(own ? ruleFlow.approveInfo(actor, r) : {}) };
    },
    /** A new version of a rule (or a new rule): a draft of the company, in force from its date once approved. */
    propose(actor, b) {
      need(actor, 'fin.posting_rule.edit', 'change posting rules'); const p = checkRule(b, actor.companyId);
      if (b.effectiveFrom < todayIST() && !b.backdate) p.push({ field: 'effectiveFrom', message: 'A rule changes events from a date on; an earlier date changes posted history only through a replay (BR-01).' });
      if (p.length) throw badRequest('Correct the highlighted fields', p);
      const code = b.ruleCode ?? `R-${Date.now().toString(36).toUpperCase()}`;
      if (db.prepare("SELECT 1 FROM fin_posting_rules WHERE company_id = ? AND rule_code = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(actor.companyId, code)) throw conflict('A change of this rule is already waiting; finish or cancel it first.');
      const ver = (db.prepare('SELECT MAX(rule_version) AS v FROM fin_posting_rules WHERE rule_code = ? AND (company_id = ? OR company_id IS NULL)').get(code, actor.companyId).v ?? 0) + 1;
      const n = (db.prepare('SELECT COUNT(*) AS n FROM fin_posting_rules WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
      const id = Number(db.prepare(`INSERT INTO fin_posting_rules (company_id, doc_no, rule_code, event_type, name, action, reverses_event, priority, condition_json, lines_json, narration_template, voucher_type, rule_version, effective_from, status, change_reason, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'fin_posting_rules')`)
        .run(actor.companyId, `PRL/${String(n).padStart(5, '0')}`, code, b.eventType, b.name, b.action ?? 'POST', b.reversesEvent ?? null, b.priority ?? 100, JSON.stringify(b.conditions ?? []), JSON.stringify(b.lines ?? []), b.narration ?? '', b.voucherType ?? 'JV', ver, b.effectiveFrom, b.reason, actor.user, actor.user).lastInsertRowid);
      audit(actor, 'fin_posting_rules', id, 'create', actor.companyId, { newValues: { ruleCode: code, version: ver, from: b.effectiveFrom }, reason: b.reason });
      return rules.get(actor, id);
    },
    update(actor, id, b) {
      const r = ruleFlow.row(actor, id, 'fin.posting_rule.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned rule is changed.'); if (b.version !== r.version) throw conflict('The rule was changed by someone else; reload it.');
      const next = { eventType: r.event_type, action: b.action ?? r.action, reversesEvent: b.reversesEvent ?? r.reverses_event, conditions: b.conditions ?? json(r.condition_json, []), lines: b.lines ?? json(r.lines_json, []) };
      const p = checkRule(next, actor.companyId); if (p.length) throw badRequest('Correct the highlighted fields', p);
      db.prepare('UPDATE fin_posting_rules SET name = ?, priority = ?, condition_json = ?, lines_json = ?, narration_template = ?, voucher_type = ?, effective_from = ?, change_reason = ?, action = ?, reverses_event = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name ?? r.name, b.priority ?? r.priority, JSON.stringify(next.conditions), JSON.stringify(next.lines), b.narration ?? r.narration_template, b.voucherType ?? r.voucher_type, b.effectiveFrom ?? r.effective_from, b.reason ?? r.change_reason, next.action, next.reversesEvent, actor.user, nowIso(), r.id);
      audit(actor, 'fin_posting_rules', r.id, 'update', actor.companyId); return rules.get(actor, r.id);
    },
    submit(actor, id) { ruleFlow.submit(actor, id); return rules.get(actor, id); },
    withdraw(actor, id, b) { ruleFlow.withdraw(actor, id, b); return rules.get(actor, id); },
    cancel(actor, id, b) { ruleFlow.cancel(actor, id, b); return rules.get(actor, id); },
    history(actor, id) { return ruleFlow.history(actor, id); },
    /** Test a rule (the one given, or a draft's own body) against a sample event: what it would post, nothing written. */
    test(actor, { ruleId, rule, eventType, data, outboxId }) {
      need(actor, 'fin.posting_rule.view', 'test posting rules');
      let e;
      if (outboxId) { const o = db.prepare('SELECT * FROM core_outbox WHERE id = ?').get(Number(outboxId)); const pl = o ? json(o.payload, {}) : null; if (!pl || Number(pl.companyId) !== actor.companyId) throw notFound('That event does not exist.'); e = { ...pl, type: o.event_type }; }
      else e = { eventId: 'test', type: eventType, companyId: actor.companyId, occurredAt: nowIso(), data: data ?? {} };
      let override = null;
      if (ruleId) override = ruleRow(actor, ruleId);
      else if (rule) { const p = checkRule({ ...rule, eventType: e.type }, actor.companyId); if (p.length) throw badRequest('Correct the highlighted fields', p); override = { id: null, rule_code: 'TEST', action: rule.action ?? 'POST', reverses_event: rule.reversesEvent ?? null, condition_json: JSON.stringify(rule.conditions ?? []), lines_json: JSON.stringify(rule.lines ?? []), narration_template: rule.narration ?? '', voucher_type: rule.voucherType ?? 'JV' };
      }
      const p = prepare(actor.companyId, e, { ruleOverride: override });
      const acct = (id) => db.prepare('SELECT code, name FROM fin_accounts WHERE id = ?').get(id);
      return p.ok ? { ok: true, date: p.date, rule: p.rule?.rule_code, reverse: p.reverse ?? null, narration: p.journal?.narration ?? p.narration, lines: (p.journal?.lines ?? []).map((l) => ({ ...l, account: (({ code, name }) => `${code} ${name}`)(acct(l.accountId)) })), total: rs(p.total) } : { ok: false, code: p.code, message: p.message, lines: (p.journal?.lines ?? []).map((l) => ({ ...l, account: (({ code, name }) => `${code} ${name}`)(acct(l.accountId)) })) };
    },
    samples(actor, eventType) { need(actor, 'fin.posting_rule.view', 'see sample events'); return db.prepare("SELECT id, payload, published_at FROM core_outbox WHERE event_type = ? AND json_extract(payload, '$.companyId') = ? ORDER BY id DESC LIMIT 20").all(eventType, actor.companyId).map((o) => { const pl = json(o.payload, {}); const d = EVENTS[eventType]; return { outboxId: o.id, occurredAt: pl.occurredAt, ref: pl.data?.[d.refField] ?? pl.data?.[d.idField], data: pl.data }; }); },
    decide(instance, actor, outcome, comment) { return ruleFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- FR-03: replay of the events emitted before the engine (or before a rule) with a dry run before the commit ----
  const replayFlow = createFlow({
    db, base, docType: REPLAY_DOC, table: 'fin_replay_runs', perm: 'fin.replay', label: 'replay', route: '/finance/posting-replay?id=',
    where: () => ({ pid: null, sid: null }), ctx: (r) => { const s = json(r.dry_run_json, {}); return { events: s.events ?? 0, wouldPost: s.wouldPost ?? 0, total: s.total ?? 0 }; }, title: (r) => `${r.from_date}..${r.to_date} ${json(r.event_types_json, []).join(', ')}`,
    notifyCode: 'fin.replay.decided', numberKey: 'FIN_REPLAY', prefix: 'RPL',
    beforeSubmit: (_a, r) => { const s = dryRun(r.company_id, { eventTypes: json(r.event_types_json, []), from: r.from_date, to: r.to_date }); if (s.hash !== r.dry_run_hash) throw conflict('The events or the rules changed since the dry run; run it again before sending it.'); },
    onApproved: (actor, r) => commitReplay(actor, r),
  });
  /** The events of a replay: from the outbox, of the company and the types, dated in the range, not yet taken by the engine. */
  function replayEvents(companyId, { eventTypes, from, to }) {
    const rows = db.prepare(`SELECT id, event_type, payload FROM core_outbox WHERE event_type IN (${eventTypes.map(() => '?').join(',')}) AND json_extract(payload, '$.companyId') = ? ORDER BY id`).all(...eventTypes, companyId);
    const out = [];
    for (const o of rows) {
      const e = { ...json(o.payload, {}), type: o.event_type }; if (!e.eventId) e.eventId = `legacy-${o.id}`;
      const date = EVENTS[e.type].date(e.data ?? {}, db, e); if (!date || date < from || date > to) continue;
      const prior = logRow(companyId, e.eventId); if (prior && prior.log_status !== 'FAILED') continue;
      out.push(e);
    }
    return out;
  }
  function dryRun(companyId, q) {
    const evs = replayEvents(companyId, q); const failures = {}; const byType = {}; let wouldPost = 0; let total = 0; const items = [];
    for (const e of evs) {
      const p = prepare(companyId, e); byType[e.type] ??= { events: 0, post: 0, total: 0 }; byType[e.type].events += 1;
      if (p.ok) { wouldPost += 1; total += p.total ?? 0; byType[e.type].post += 1; byType[e.type].total += p.total ?? 0; } else failures[p.code] = (failures[p.code] ?? 0) + 1;
      if (items.length < 200) items.push({ eventId: e.eventId, type: e.type, ref: p.docRef ?? null, date: p.date ?? null, ok: p.ok, code: p.ok ? null : p.code, message: p.ok ? null : p.message, amount: rs(p.total ?? 0) });
    }
    const hash = createHash('sha256').update(JSON.stringify(evs.map((e) => e.eventId)) + JSON.stringify({ wouldPost, total, failures })).digest('hex');
    return { events: evs.length, wouldPost, total: rs(total), failures, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, total: rs(v.total) }])), items, hash };
  }
  function commitReplay(actor, r) {
    const q = { eventTypes: json(r.event_types_json, []), from: r.from_date, to: r.to_date }; let posted = 0; let failed = 0; let total = 0;
    for (const e of replayEvents(r.company_id, q)) { const row = handle(e, { retry: true, replayRunId: r.id, user: actor.user }); if (row?.log_status === 'POSTED') { posted += 1; total += row.amount_paise; } else failed += 1; }
    const result = { posted, failed, total: rs(total) };
    db.prepare('UPDATE fin_replay_runs SET result_json = ?, committed_at = ? WHERE id = ?').run(JSON.stringify(result), nowIso(), r.id);
    audit(actor, 'fin_replay_runs', r.id, 'commit', r.company_id, { newValues: result });
  }
  const runView = (actor, r, detail = false) => ({ id: r.id, docNo: r.doc_no, eventTypes: json(r.event_types_json, []), from: r.from_date, to: r.to_date, dryRun: detail ? json(r.dry_run_json, {}) : (({ items: _items, ...x }) => x)(json(r.dry_run_json, {})), result: json(r.result_json, null), committedAt: r.committed_at, status: r.status, requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version, can: replayFlow.can(actor, r), ...(detail ? replayFlow.approveInfo(actor, r) : {}) });
  const replays = {
    flow: replayFlow,
    list(actor) { need(actor, 'fin.replay.view', 'see replays'); return { rows: db.prepare('SELECT * FROM fin_replay_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 100').all(actor.companyId).map((r) => runView(actor, r)) }; },
    get(actor, id) { return runView(actor, replayFlow.row(actor, id), true); },
    /** The dry run: what the replay would post, saved as a draft run to send for approval. */
    create(actor, b) {
      need(actor, 'fin.replay.create', 'replay events'); const types = b.eventTypes.filter((t) => EVENTS[t]); if (!types.length) throw badRequest('Correct the highlighted fields', [{ field: 'eventTypes', message: 'Choose the events to replay.' }]);
      if (b.from > b.to) throw badRequest('Correct the highlighted fields', [{ field: 'to', message: 'The last date is on or after the first.' }]);
      const s = dryRun(actor.companyId, { eventTypes: types, from: b.from, to: b.to }); const n = (db.prepare('SELECT COUNT(*) AS n FROM fin_replay_runs WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
      const id = Number(db.prepare("INSERT INTO fin_replay_runs (company_id, doc_no, event_types_json, from_date, to_date, dry_run_json, dry_run_hash, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'fin_replay_runs')").run(actor.companyId, `RPL/${String(n).padStart(5, '0')}`, JSON.stringify(types), b.from, b.to, JSON.stringify(s), s.hash, actor.user, actor.user).lastInsertRowid);
      audit(actor, 'fin_replay_runs', id, 'create', actor.companyId, { newValues: { events: s.events, wouldPost: s.wouldPost, total: s.total } });
      return replays.get(actor, id);
    },
    submit(actor, id) { replayFlow.submit(actor, id); return replays.get(actor, id); },
    withdraw(actor, id, b) { replayFlow.withdraw(actor, id, b); return replays.get(actor, id); },
    cancel(actor, id, b) { replayFlow.cancel(actor, id, b); return replays.get(actor, id); },
    history(actor, id) { return replayFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return replayFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- FR-05: the sub-ledgers against the control accounts of the ledger ----
  /** The ledger balance (debit − credit, paise) of accounts, posted up to a date. */
  // whole periods from the balance projection (23.01 BR-02), the days after the last whole period from the lines
  const glBalance = (companyId, where, args, asOf) => {
    const lastEnd = db.prepare('SELECT MAX(end_date) AS d FROM core_periods WHERE company_id = ? AND end_date <= ?').get(companyId, asOf).d;
    const proj = lastEnd ? db.prepare(`SELECT COALESCE(SUM(b.debit_paise - b.credit_paise), 0) AS b FROM fin_balances b JOIN core_periods p ON p.id = b.period_id JOIN fin_accounts a ON a.id = b.account_id WHERE b.company_id = ? AND p.end_date <= ? AND ${where}`).get(companyId, lastEnd, ...args).b : 0;
    const rest = db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise), 0) AS b FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE l.company_id = ? AND j.status = 'APPROVED' AND j.voucher_date > ? AND j.voucher_date <= ? AND l.deleted_at IS NULL AND ${where}`).get(companyId, lastEnd ?? '0000-00-00', asOf, ...args).b;
    return proj + rest;
  };
  const tableHas = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  function reconcile(actor, { asOf }) {
    need(actor, 'fin.posting.view', 'see the reconciliation'); const c = actor.companyId; const on2 = asOf ?? todayIST();
    const rows = [];
    const add = (code, label, sub, glP, accounts, drill) => rows.push({ code, label, subledger: rs(sub), gl: rs(glP), difference: rs(sub - glP), accounts, drill });
    // AP: vendor invoices matched (payable) and subcontractor bills approved (net), less what was paid (payments come with 23.04): credit balance of the AP control accounts
    if (tableHas('ap_bills') && db.prepare("SELECT 1 FROM ap_bills WHERE company_id = ? LIMIT 1").get(c)) {
      // 23.03: the AP sub-ledger is the AP bills (net of TDS, of what was set against them and paid); employee claims are not on the AP control accounts
      const ap = db.prepare("SELECT COALESCE(SUM(net_payable_paise - adjusted_paise - paid_paise), 0) AS s FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND bill_source != 'EXPENSE_CLAIM' AND bill_date <= ? AND deleted_at IS NULL").get(c, on2).s;
      const dnOpen = db.prepare("SELECT COALESCE(SUM(n.total_paise), 0) - COALESCE((SELECT SUM(a.amount_paise) FROM ap_bill_adjustments a WHERE a.company_id = ? AND a.adj_kind = 'DEBIT_NOTE' AND a.deleted_at IS NULL), 0) AS s FROM ap_debit_notes n WHERE n.company_id = ? AND n.status = 'APPROVED' AND n.note_date <= ? AND n.deleted_at IS NULL").get(c, c, on2).s;
      add('AP', 'Accounts payable (AP bills outstanding, less debit notes not yet set against a bill)', ap - dnOpen, -glBalance(c, "a.control_kind = 'AP'", [], on2), 'AP control accounts', '/finance/ap-bills');
    } else if (tableHas('bill_vendor_invoices')) {
      const vi = db.prepare("SELECT COALESCE(SUM(total_paise), 0) AS s FROM bill_vendor_invoices WHERE company_id = ? AND status = 'APPROVED' AND invoice_date <= ? AND deleted_at IS NULL").get(c, on2).s;
      const sb = db.prepare("SELECT COALESCE(SUM(net_paise), 0) AS s FROM bill_sub_bills WHERE company_id = ? AND status = 'APPROVED' AND period_to <= ? AND deleted_at IS NULL").get(c, on2).s;
      add('AP', 'Accounts payable (vendor invoices and subcontractor bills)', vi + sb, -glBalance(c, "a.control_kind = 'AP'", [], on2), 'AP control accounts', '/bill/invoice-hub');
    }
    if (tableHas('bill_tax_invoices')) add('AR', 'Accounts receivable (tax invoices issued)', db.prepare("SELECT COALESCE(SUM(total_paise), 0) AS s FROM bill_tax_invoices WHERE company_id = ? AND status = 'APPROVED' AND invoice_no IS NOT NULL AND invoice_date <= ? AND deleted_at IS NULL").get(c, on2).s, glBalance(c, "a.control_kind = 'AR'", [], on2), 'AR control accounts', '/bill/tax-invoices');
    if (tableHas('inv_stock_ledger')) add('INVENTORY', 'Inventory (stock ledger value)', db.prepare('SELECT COALESCE(SUM(CASE WHEN qty_in > 0 THEN value ELSE -value END), 0) AS s FROM inv_stock_ledger WHERE company_id = ? AND txn_date <= ?').get(c, on2).s, glBalance(c, "a.control_kind = 'INVENTORY'", [], on2), 'Inventory control accounts', '/inv/stock');
    if (tableHas('inv_grns')) {
      const grn = db.prepare("SELECT COALESCE(SUM(total_value), 0) AS s FROM inv_grns WHERE company_id = ? AND status = 'APPROVED' AND received_date <= ? AND deleted_at IS NULL").get(c, on2).s;
      const rtv = tableHas('inv_rtvs') ? db.prepare("SELECT COALESCE(SUM(total_value), 0) AS s FROM inv_rtvs WHERE company_id = ? AND status = 'APPROVED' AND rtv_date <= ? AND deleted_at IS NULL").get(c, on2).s : 0;
      const inv = db.prepare("SELECT COALESCE(SUM(taxable_paise), 0) AS s FROM bill_vendor_invoices WHERE company_id = ? AND status = 'APPROVED' AND invoice_kind = 'PO' AND invoice_date <= ? AND deleted_at IS NULL").get(c, on2).s;
      add('GRNI', 'Goods received not invoiced (receipts less returns less invoices on purchase orders)', grn - rtv - inv, -glBalance(c, "a.code = '240002'", [], on2), '240002', '/inv/grns');
    }
    if (tableHas('bill_retention_ledger')) add('RETENTION', 'Retention and deposits held from subcontractors', db.prepare("SELECT COALESCE(SUM(CASE WHEN txn_type = 'RELEASED' THEN -amount_paise ELSE amount_paise END), 0) AS s FROM bill_retention_ledger WHERE company_id = ? AND party_type = 'SUBCONTRACTOR' AND txn_date <= ?").get(c, on2).s, -glBalance(c, "a.control_kind = 'RETENTION_PAYABLE'", [], on2), 'Retention payable', '/bill/retention');
    if (tableHas('bill_advances')) add('ADVANCES', 'Advances given, not yet recovered', db.prepare("SELECT COALESCE(SUM(amount_paise - recovered_paise), 0) AS s FROM bill_advances WHERE company_id = ? AND direction = 'GIVEN' AND status = 'APPROVED' AND advance_date <= ? AND deleted_at IS NULL").get(c, on2).s, glBalance(c, "a.code = '160001'", [], on2), '160001', '/bill/advances');
    const unposted = db.prepare("SELECT event_type AS t, COUNT(*) AS n FROM fin_posting_log WHERE company_id = ? AND log_status = 'FAILED' GROUP BY event_type").all(c);
    return { asOf: on2, rows, clean: rows.every((r) => r.difference === 0), failed: Object.fromEntries(unposted.map((u) => [u.t, u.n])) };
  }

  return { prepare, handle, onEvent, postings, rules, replays, reconcile, dryRun, EVENTS };
}

export { HttpError, unprocessable };
