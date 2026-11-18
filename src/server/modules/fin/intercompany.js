import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { SCHEDULE3, finOf } from './service.js';

// Part 23.15: multi-company, inter-company and consolidation.
//  FR-01 the relationship of two companies (subsidiary, associate, joint venture, fellow) with the holding and the inter-company accounts of each side.
//  FR-02 an inter-company transaction (charge, transfer, loan, settlement) is approved by the originating accounts manager and accepted by the counterpart's
//  accounts manager, who names the account of his side; the acceptance posts the mirror journals in both companies at once (BR-01), each through the posting
//  engine: the originator's due-from (or due-to for a settlement) against the account named, the counterpart's account against its due-to (or due-from).
//  FR-03 reconciliation: the inter-company balance of each pair from both sides, the lines on inter-company accounts that came from no transaction, the items
//  waiting for the counterpart or disputed.
//  FR-04 consolidation of a parent with its subsidiaries: the statements of 23.14 added up, the inter-company balances and charges eliminated, the investment
//  eliminated against the share capital, the non-controlling interest; finalised only when nothing is unmatched or open.
//  FR-05 JV / consortium projects: the partners' shares and the statement of each partner's share of revenue, cost and result.

export const IC_DOC = 'FIN_IC_TRANSACTION';
const rs = (p) => (p == null ? null : Math.round(p) / 100);
const paise = (v) => Math.round(Number(v) * 100);
const TYPES = { CHARGE: 'Charge (services, costs recharged)', TRANSFER: 'Fund transfer', LOAN: 'Loan', SETTLEMENT: 'Settlement of what is owed' };

export const icList = defineList({
  code: 'fin.ic_transactions', label: 'Inter-company transactions', permission: 'fin.transaction.view', from: 'ic_transactions x', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.reference', 'x.description'], defaultSort: '-txnDate',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Transaction' }, txnDate: { sql: 'x.txn_date', type: 'date', label: 'Date' }, type: { sql: 'x.ic_type', type: 'enum', label: 'Type', options: Object.keys(TYPES) }, amount: { sql: '(x.amount_paise / 100.0)', type: 'money', label: 'Amount' }, state: { sql: 'x.ic_state', type: 'enum', label: 'State', options: ['DRAFT', 'AWAITING_COUNTERPART', 'POSTED', 'DISPUTED', 'REVERSED'] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.keys(STATUS) }, toCompanyId: { sql: 'x.to_company_id', type: 'number', label: 'Counterpart' } },
});

/** Pure (T-01): the elimination entries are balanced and the consolidated balance sheet still balances. */
export const balanced = (entries) => entries.reduce((a, e) => a + (e.debit ?? 0) - (e.credit ?? 0), 0) === 0;

/** @param {{ db: any, base: any, flags: any, gl: any, closes: () => any }} o */
export function createInterCompanyService({ db, base, flags, gl, closes }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2315');
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const company = (id) => db.prepare('SELECT id, code, legal_name, short_name FROM org_companies WHERE id = ?').get(Number(id)) ?? null;
  const cname = (id) => { const c = company(id); return c ? `${c.code} ${c.short_name ?? c.legal_name}` : String(id); };
  const setup = (companyId) => { try { finOf(db)?.ensureSetup(companyId); } catch { /* the posting reports it */ } };
  const acctByCode = (companyId, code) => { setup(companyId); return db.prepare("SELECT a.id, a.code, a.name, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id = ? AND a.code = ? AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE'").get(companyId, code) ?? null; };
  const acctById = (companyId, id) => db.prepare("SELECT a.id, a.code, a.name, a.is_control, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.id = ? AND a.company_id = ? AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE'").get(Number(id), companyId) ?? null;
  const pc = () => { const x = closes(); if (!x) throw unprocessable('The statements of part 23.14 are not set up for this database.'); return x; };

  // ---- FR-01: relationships ----
  const relOf = (a, b) => db.prepare("SELECT * FROM ic_relationships WHERE deleted_at IS NULL AND rel_status = 'ACTIVE' AND ((company_id = ? AND counterpart_company_id = ?) OR (company_id = ? AND counterpart_company_id = ?))").get(a, b, b, a) ?? null;
  /** The receivable and payable codes company `c` uses with its counterpart in relationship `r`. */
  const codesOf = (r, c) => (r.company_id === c ? { rec: r.receivable_code, pay: r.payable_code } : { rec: r.cp_receivable_code, pay: r.cp_payable_code });
  const relView = (actor, r) => { const mine = r.company_id === actor.companyId; return { id: r.id, parentId: r.company_id, parent: cname(r.company_id), counterpartId: r.counterpart_company_id, counterpart: cname(r.counterpart_company_id), other: mine ? cname(r.counterpart_company_id) : cname(r.company_id), otherId: mine ? r.counterpart_company_id : r.company_id, side: mine ? 'PARENT' : 'COUNTERPART', type: r.relationship_type, holdingPct: r.holding_pct, consolidate: Boolean(r.consolidate), accounts: { own: codesOf(r, actor.companyId), theirs: codesOf(r, mine ? r.counterpart_company_id : r.company_id) }, status: r.rel_status, version: r.version }; };
  const relationships = {
    list(actor) { need(actor, 'fin.transaction.view', 'see inter-company relationships'); return db.prepare('SELECT * FROM ic_relationships WHERE deleted_at IS NULL AND (company_id = ? OR counterpart_company_id = ?) ORDER BY id').all(actor.companyId, actor.companyId).map((r) => relView(actor, r)); },
    /** The relationship is kept by the CFO of the parent (or first) company; both sides' account codes must exist. */
    save(actor, b) {
      need(actor, 'fin.ic.configure', 'keep inter-company relationships'); const c = actor.companyId; const cp = Number(b.counterpartCompanyId);
      if (cp === c || !company(cp)) throw badRequest('Correct the highlighted fields', [{ field: 'counterpartCompanyId', message: 'Choose another company of the group.' }]);
      const codes = { receivable_code: b.receivableCode ?? '160090', payable_code: b.payableCode ?? '230090', cp_receivable_code: b.counterpartReceivableCode ?? '160090', cp_payable_code: b.counterpartPayableCode ?? '230090' };
      const bad = [['receivableCode', c, codes.receivable_code], ['payableCode', c, codes.payable_code], ['counterpartReceivableCode', cp, codes.cp_receivable_code], ['counterpartPayableCode', cp, codes.cp_payable_code]].filter(([, co, code]) => !acctByCode(co, code)).map(([field, co, code]) => ({ field, message: `Account ${code} does not exist in ${cname(co)}.` }));
      if (bad.length) throw badRequest('Correct the highlighted fields', bad);
      const ex = db.prepare('SELECT * FROM ic_relationships WHERE deleted_at IS NULL AND ((company_id = ? AND counterpart_company_id = ?) OR (company_id = ? AND counterpart_company_id = ?))').get(c, cp, cp, c);
      if (ex && ex.company_id !== c) throw conflict(`${cname(cp)} already keeps this relationship; change it there.`);
      if (ex) { if (b.version != null && b.version !== ex.version) throw conflict('Someone changed this relationship: reload it.'); db.prepare('UPDATE ic_relationships SET relationship_type = ?, holding_pct = ?, consolidate = ?, receivable_code = ?, payable_code = ?, cp_receivable_code = ?, cp_payable_code = ?, rel_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.type ?? ex.relationship_type, b.holdingPct ?? ex.holding_pct, b.consolidate === false ? 0 : 1, codes.receivable_code, codes.payable_code, codes.cp_receivable_code, codes.cp_payable_code, b.status ?? 'ACTIVE', actor.user, nowIso(), ex.id); audit(actor, 'ic_relationships', ex.id, 'update', c, { oldValues: { type: ex.relationship_type, holding: ex.holding_pct }, newValues: { type: b.type, holding: b.holdingPct } }); }
      else { const id = Number(db.prepare("INSERT INTO ic_relationships (company_id, counterpart_company_id, relationship_type, holding_pct, consolidate, receivable_code, payable_code, cp_receivable_code, cp_payable_code, valid_from, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, cp, b.type ?? 'SUBSIDIARY', b.holdingPct ?? 100, b.consolidate === false ? 0 : 1, codes.receivable_code, codes.payable_code, codes.cp_receivable_code, codes.cp_payable_code, b.validFrom ?? null, actor.user).lastInsertRowid); audit(actor, 'ic_relationships', id, 'create', c, { newValues: { counterpart: cp, type: b.type ?? 'SUBSIDIARY', holding: b.holdingPct ?? 100 } }); }
      return relationships.list(actor);
    },
  };

  // ---- FR-02: the transaction (approval-controlled) and its mirror ----
  const sideOf = (t) => (t.ic_type === 'SETTLEMENT' ? { a: 'pay', b: 'rec' } : { a: 'rec', b: 'pay' });
  const flow = createFlow({ db, base, docType: IC_DOC, table: 'ic_transactions', perm: 'fin.transaction', label: 'inter-company transaction', route: '/finance/inter-company?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.amount_paise), type: r.ic_type }), title: (r) => `${TYPES[r.ic_type]} to ${cname(r.to_company_id)}: ₹${rs(r.amount_paise)} — ${r.description}`, notifyCode: 'fin.ic.decided', prefix: 'IC',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('Inter-company is off for the company (ff.fin.p2315).'); if (!relOf(r.company_id, r.to_company_id)) throw unprocessable('The relationship with the counterpart is no longer active.'); if (!acctById(r.company_id, r.from_account_id)) throw unprocessable('The account of this side is no longer active.'); },
    onApproved: (actor, r) => { db.prepare("UPDATE ic_transactions SET ic_state = 'AWAITING_COUNTERPART' WHERE id = ?").run(r.id);
      notify(r.to_company_id, 'fin.ic.alert', ['permission:fin.transaction.approve'], r.doc_no, 'to accept', `${cname(r.company_id)} sent ${TYPES[r.ic_type].toLowerCase()} ${r.doc_no} of ₹${rs(r.amount_paise)}: ${r.description}. Accept it with the account of your side, or dispute it.`, `/finance/inter-company?id=${r.id}`, `${r.id}-await`); },
  });
  /** A transaction seen from either company: the originator's, or one sent to the viewer's company once approved. */
  const rowFor = (actor, id) => { const r = db.prepare('SELECT * FROM ic_transactions WHERE id = ? AND deleted_at IS NULL').get(Number(id)); if (!r || !may(actor, 'fin.transaction.view') || !(r.company_id === actor.companyId || (r.to_company_id === actor.companyId && r.status === 'APPROVED'))) throw notFound('That inter-company transaction does not exist.'); return r; };
  const view = (actor, r, detail = false) => {
    const mine = r.company_id === actor.companyId; const j = JSON.parse(r.journals_json || '{}'); const ref = (id, c) => (id ? db.prepare('SELECT id, voucher_no, doc_no, status FROM fin_journals WHERE id = ? AND company_id = ?').get(id, c) : null);
    const o = { id: r.id, docNo: r.doc_no, side: mine ? 'OUT' : 'IN', from: cname(r.company_id), fromId: r.company_id, to: cname(r.to_company_id), toId: r.to_company_id, type: r.ic_type, typeLabel: TYPES[r.ic_type], date: r.txn_date, amount: rs(r.amount_paise), reference: r.reference, description: r.description, projectId: r.org_project_id, state: r.ic_state, status: r.status, statusLabel: STATUS[r.status], disputeReason: r.dispute_reason, acceptedBy: r.accepted_by, acceptedAt: r.accepted_at, requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version,
      can: mine ? { ...flow.can(actor, r), reverse: r.ic_state === 'POSTED' && may(actor, 'fin.transaction.amend'), drop: r.ic_state === 'DISPUTED' && may(actor, 'fin.transaction.cancel') } : { accept: r.ic_state === 'AWAITING_COUNTERPART' && may(actor, 'fin.transaction.approve'), dispute: r.ic_state === 'AWAITING_COUNTERPART' && may(actor, 'fin.transaction.approve') } };
    if (detail) { const fa = r.from_account_id ? db.prepare('SELECT code, name FROM fin_accounts WHERE id = ?').get(r.from_account_id) : null; const ta = r.to_account_id ? db.prepare('SELECT code, name FROM fin_accounts WHERE id = ?').get(r.to_account_id) : null;
      const r0 = relOf(r.company_id, r.to_company_id) ?? db.prepare('SELECT * FROM ic_relationships WHERE id = ?').get(r.relationship_id); const s = sideOf(r);
      o.mirror = { from: { account: fa ? `${fa.code} ${fa.name}` : null, ic: codesOf(r0, r.company_id)[s.a], journal: ref(j.from, r.company_id) }, to: { account: ta ? `${ta.code} ${ta.name}` : null, ic: codesOf(r0, r.to_company_id)[s.b], journal: ref(j.to, r.to_company_id) } };
      if (mine) Object.assign(o.can, flow.approveInfo(actor, r)); o.history = mine ? flow.history(actor, r.id) : { approvals: [], audit: [] }; }
    return o;
  };
  const editable = (actor, id) => { const r = flow.row(actor, id, 'fin.transaction.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned transaction is changed.'); return r; };
  /** The dimensions a posting to the account needs (cost centre, project …), checked as the posting engine will. */
  const dimProblems = (c, accountId, dims) => { if (!gl?.checkLines) return []; const k = gl.checkLines(c, [{ accountId: Number(accountId), debit: '1', ...dims }, { accountId: Number(accountId), credit: '1', ...dims }], { source: 'ENGINE' }); return k.problems.map((p) => ({ field: 'dimensions', message: p.message })); };
  const checkOwn = (c, b) => { const a = acctById(c, b.accountId); const problems = []; if (!a) problems.push({ field: 'accountId', message: 'Choose an active account of your company.' });
    else { const rel = relOf(c, Number(b.counterpartCompanyId)); if (rel && Object.values(codesOf(rel, c)).includes(a.code)) problems.push({ field: 'accountId', message: 'The inter-company account is posted by the mirror itself; choose the income, cost or bank account of the transaction.' }); if (a.is_control) problems.push({ field: 'accountId', message: 'Not a control account.' }); }
    return problems; };
  const transactions = {
    flow,
    list(actor, query) { need(actor, 'fin.transaction.view', 'see inter-company transactions'); const side = query.side === 'in' ? 'in' : query.side === 'out' ? 'out' : 'all'; const q = { ...query }; delete q.side;
      const scopeSql = side === 'in' ? "x.to_company_id = :c AND x.status = 'APPROVED'" : side === 'out' ? 'x.company_id = :c' : "(x.company_id = :c OR (x.to_company_id = :c AND x.status = 'APPROVED'))";
      return runList(db, icList, parseListRequest(icList, q), { select: 'x.*', scopeSql, params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { return view(actor, rowFor(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.transaction.create', 'raise inter-company transactions'); const c = actor.companyId; const cp = Number(b.counterpartCompanyId); const rel = relOf(c, cp);
      if (!rel) throw badRequest('Correct the highlighted fields', [{ field: 'counterpartCompanyId', message: 'No active inter-company relationship with that company.' }]);
      const problems = checkOwn(c, b); if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(Number(b.projectId), c)) throw badRequest('Correct the highlighted fields', [{ field: 'projectId', message: 'Not a project of your company.' }]);
      const dims = { ...(b.dimensions ?? {}), ...(b.projectId ? { projectId: Number(b.projectId) } : {}) }; const dp = dimProblems(c, b.accountId, dims); if (dp.length) throw badRequest('Correct the highlighted fields', dp);
      const id = Number(db.prepare("INSERT INTO ic_transactions (company_id, doc_no, relationship_id, to_company_id, ic_type, txn_date, amount_paise, reference, description, from_account_id, org_project_id, from_dims_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, flow.next(actor), rel.id, cp, b.type, b.date, paise(b.amount), b.reference ?? null, b.description, Number(b.accountId), b.projectId ?? null, JSON.stringify(b.dimensions ?? {}), actor.user).lastInsertRowid);
      audit(actor, 'ic_transactions', id, 'create', c, { newValues: { to: cp, type: b.type, amount: b.amount, date: b.date } }); return transactions.get(actor, id);
    },
    update(actor, id, b) { const r = editable(actor, id); if (b.version != null && b.version !== r.version) throw conflict('Someone changed this transaction: reload it.'); const m = { ...b, counterpartCompanyId: r.to_company_id, accountId: b.accountId ?? r.from_account_id }; const problems = checkOwn(r.company_id, m); if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      db.prepare('UPDATE ic_transactions SET txn_date = COALESCE(?, txn_date), amount_paise = COALESCE(?, amount_paise), reference = COALESCE(?, reference), description = COALESCE(?, description), from_account_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.date ?? null, b.amount != null ? paise(b.amount) : null, b.reference ?? null, b.description ?? null, Number(m.accountId), actor.user, nowIso(), r.id);
      audit(actor, 'ic_transactions', r.id, 'update', r.company_id, { oldValues: { amount: rs(r.amount_paise), date: r.txn_date }, newValues: { amount: b.amount, date: b.date } }); return transactions.get(actor, r.id); },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return transactions.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return transactions.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return transactions.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    /** The counterpart accepts with the account of its side: both mirror journals posted in one database transaction (BR-01). */
    accept(actor, id, { accountId, projectId = null, dimensions = {} }) {
      const r = rowFor(actor, id); if (r.to_company_id !== actor.companyId) throw forbidden('Only the counterpart company accepts the transaction.'); need(actor, 'fin.transaction.approve', 'accept inter-company transactions');
      if (r.ic_state !== 'AWAITING_COUNTERPART') throw conflict('The transaction is not waiting for your acceptance.'); if (!on(actor.companyId)) throw unprocessable('Inter-company is off for your company (ff.fin.p2315).');
      const rel = relOf(r.company_id, r.to_company_id); if (!rel) throw unprocessable('The relationship is no longer active.'); const own = acctById(actor.companyId, accountId);
      if (!own || own.is_control || Object.values(codesOf(rel, actor.companyId)).includes(own.code)) throw badRequest('Correct the highlighted fields', [{ field: 'accountId', message: 'Choose the cost, income or bank account of your side (not an inter-company or control account).' }]);
      if (projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(Number(projectId), actor.companyId)) throw badRequest('Correct the highlighted fields', [{ field: 'projectId', message: 'Not a project of your company.' }]);
      const toDims = { ...dimensions, ...(projectId ? { projectId: Number(projectId) } : {}) }; const dp = dimProblems(actor.companyId, own.id, toDims); if (dp.length) throw badRequest('Correct the highlighted fields', dp); const fromDims = { ...JSON.parse(r.from_dims_json || '{}'), ...(r.org_project_id ? { projectId: r.org_project_id } : {}) };
      const s = sideOf(r); const icA = acctByCode(r.company_id, codesOf(rel, r.company_id)[s.a]); const icB = acctByCode(r.to_company_id, codesOf(rel, r.to_company_id)[s.b]); if (!icA || !icB) throw unprocessable('An inter-company account of the relationship is missing.');
      const amt = String(rs(r.amount_paise)); const narr = `${r.doc_no} ${TYPES[r.ic_type]}: ${r.description}`;
      return transaction(db, () => {
        const ja = gl.postEngine(r.company_id, { date: r.txn_date, narration: `${narr} (to ${cname(r.to_company_id)})`, sourceType: 'ic_transactions', sourceId: r.id, user: actor.user, lines: [{ accountId: icA.id, debit: amt }, { accountId: r.from_account_id, credit: amt, ...fromDims }] }).journal;
        const jb = gl.postEngine(r.to_company_id, { date: r.txn_date, narration: `${narr} (from ${cname(r.company_id)})`, sourceType: 'ic_transactions', sourceId: r.id, user: actor.user, lines: [{ accountId: own.id, debit: amt, ...toDims }, { accountId: icB.id, credit: amt }] }).journal;
        db.prepare("UPDATE ic_transactions SET ic_state = 'POSTED', to_account_id = ?, to_dims_json = ?, journals_json = ?, accepted_by = ?, accepted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(own.id, JSON.stringify(toDims), JSON.stringify({ from: ja.id, to: jb.id }), actor.user, nowIso(), nowIso(), r.id);
        audit(actor, 'ic_transactions', r.id, 'accept', actor.companyId, { newValues: { account: own.code, journals: { from: ja.id, to: jb.id } } });
        evt('fin.ic_transaction.posted', actor, r.company_id, 'ic_transactions', r.id, { transactionId: r.id, docNo: r.doc_no, type: r.ic_type, fromCompanyId: r.company_id, toCompanyId: r.to_company_id, amount: rs(r.amount_paise), date: r.txn_date, journals: { from: ja.id, to: jb.id } });
        notify(r.company_id, 'fin.ic.decided', [`user:${r.requested_by}`], r.doc_no, 'accepted', `${cname(r.to_company_id)} accepted ${r.doc_no}; the mirror journals are posted in both companies.`, `/finance/inter-company?id=${r.id}`, `${r.id}-posted`);
        return transactions.get(actor, r.id);
      });
    },
    dispute(actor, id, { reason }) { const r = rowFor(actor, id); if (r.to_company_id !== actor.companyId) throw forbidden('Only the counterpart company disputes the transaction.'); need(actor, 'fin.transaction.approve', 'dispute inter-company transactions'); if (r.ic_state !== 'AWAITING_COUNTERPART') throw conflict('The transaction is not waiting for your acceptance.');
      db.prepare("UPDATE ic_transactions SET ic_state = 'DISPUTED', dispute_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, nowIso(), r.id); audit(actor, 'ic_transactions', r.id, 'dispute', actor.companyId, { reason });
      notify(r.company_id, 'fin.ic.alert', [`user:${r.requested_by}`, 'permission:fin.transaction.approve'], r.doc_no, 'disputed', `${cname(r.to_company_id)} disputed ${r.doc_no}: ${reason}`, `/finance/inter-company?id=${r.id}`, `${r.id}-dispute`); return transactions.get(actor, r.id); },
    /** A disputed transaction dropped by the originator (nothing was posted); a corrected one is raised as a new transaction. */
    drop(actor, id, { reason }) { const r = flow.row(actor, id, 'fin.transaction.cancel'); if (r.ic_state !== 'DISPUTED') throw conflict('Only a disputed transaction is dropped.'); db.prepare("UPDATE ic_transactions SET ic_state = 'REVERSED', cancel_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, nowIso(), r.id); audit(actor, 'ic_transactions', r.id, 'drop', r.company_id, { reason }); return transactions.get(actor, r.id); },
    /** A posted transaction reversed in both companies at once. */
    reverse(actor, id, { reason }) { const r = flow.row(actor, id, 'fin.transaction.amend'); if (r.ic_state !== 'POSTED') throw conflict('Only a posted transaction is reversed.'); const j = JSON.parse(r.journals_json || '{}');
      return transaction(db, () => { const ra = gl.reverseEngine(r.company_id, j.from, { date: todayIST(), reason, user: actor.user }); const rb = gl.reverseEngine(r.to_company_id, j.to, { date: todayIST(), reason, user: actor.user }); if (!ra || !rb) throw conflict('A mirror journal is already reversed or not posted.');
        db.prepare("UPDATE ic_transactions SET ic_state = 'REVERSED', journals_json = ?, cancel_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify({ ...j, fromReversal: ra.journal?.id ?? ra.id ?? null, toReversal: rb.journal?.id ?? rb.id ?? null }), reason, nowIso(), r.id); audit(actor, 'ic_transactions', r.id, 'reverse', r.company_id, { reason });
        notify(r.to_company_id, 'fin.ic.alert', ['permission:fin.transaction.approve'], r.doc_no, 'reversed', `${cname(r.company_id)} reversed ${r.doc_no} in both companies: ${reason}`, `/finance/inter-company?id=${r.id}`, `${r.id}-rev`); return transactions.get(actor, r.id); }); },
    print(actor, id) { const r = rowFor(actor, id); need(actor, 'fin.transaction.print', 'print inter-company transactions'); const x = view(actor, r, true); audit(actor, 'ic_transactions', r.id, 'print', actor.companyId);
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Inter-company ${r.doc_no} · ${x.typeLabel} · ${x.from} → ${x.to}`, columns: [{ key: 'k', label: 'Field', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }], rows: [['Date', x.date], ['Amount', `₹${x.amount}`], ['Description', x.description], ['Reference', x.reference ?? ''], ['State', x.state], [`${x.from}`, `${x.mirror.from.ic} / ${x.mirror.from.account ?? ''} ${x.mirror.from.journal?.voucher_no ?? ''}`], [`${x.to}`, `${x.mirror.to.account ?? '(on acceptance)'} / ${x.mirror.to.ic} ${x.mirror.to.journal?.voucher_no ?? ''}`]].map(([k, v]) => ({ k, v })), footer: [`Accepted by ${x.acceptedBy ?? '—'} on ${x.acceptedAt ?? '—'}.`] }) }; },
    exportCsv(actor, query = {}) { need(actor, 'fin.transaction.export', 'export inter-company transactions'); const l = transactions.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'ic_transactions', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: 'inter-company-transactions.csv', buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Transaction', 'Date', 'From', 'To', 'Type', 'Amount', 'State', 'Status', 'Description'], l.data.map((x) => [x.docNo, x.date, x.from, x.to, x.typeLabel, x.amount, x.state, x.statusLabel, x.description]))}`, 'utf8') }; },
  };

  // ---- FR-03: reconciliation ----
  const POSTED = "j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL";
  /** The inter-company transaction a journal belongs to: its own mirror journal, or the reversal of one. */
  const TXID = "(CASE WHEN j.source_type = 'ic_transactions' THEN CAST(j.source_id AS INTEGER) WHEN j.source_type = 'fin_journals' THEN (SELECT CAST(o.source_id AS INTEGER) FROM fin_journals o WHERE o.id = CAST(j.source_id AS INTEGER) AND o.source_type = 'ic_transactions') END)";
  /** The inter-company balance of company `c` towards `cp` (Dr positive) from the mirror journals to a date, and the lines on its inter-company accounts that came from no transaction. */
  function pairLines(c, cp, asOf) {
    return db.prepare(`SELECT l.account_id AS id, SUM(l.debit_paise - l.credit_paise) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN ic_transactions t ON t.id = ${TXID}
      JOIN ic_relationships r ON r.id = t.relationship_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date <= ? AND ((t.company_id = ? AND t.to_company_id = ?) OR (t.company_id = ? AND t.to_company_id = ?))
      AND a.code IN (CASE WHEN r.company_id = ? THEN r.receivable_code ELSE r.cp_receivable_code END, CASE WHEN r.company_id = ? THEN r.payable_code ELSE r.cp_payable_code END) GROUP BY l.account_id`).all(c, asOf, c, cp, cp, c, c, c);
  }
  function stray(c, asOf) {
    const codes = [...new Set(db.prepare('SELECT * FROM ic_relationships WHERE deleted_at IS NULL AND (company_id = ? OR counterpart_company_id = ?)').all(c, c).flatMap((r) => Object.values(codesOf(r, c))))]; if (!codes.length) return [];
    const lines = db.prepare(`SELECT l.id, j.id AS journal_id, j.voucher_no, j.voucher_date, a.code, l.debit_paise, l.credit_paise, j.narration FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = ? AND ${POSTED} AND j.voucher_date <= ? AND a.code IN (${codes.map(() => '?').join(',')}) AND COALESCE(j.source_type, '') <> 'core_financial_years' AND ${TXID} IS NULL ORDER BY j.voucher_date LIMIT 200`).all(c, asOf, ...codes)
      .map((x) => ({ lineId: x.id, journalId: x.journal_id, voucherNo: x.voucher_no, date: x.voucher_date, account: x.code, debit: rs(x.debit_paise), credit: rs(x.credit_paise), narration: x.narration }));
    // a one-sided line corrected by an opposite entry is resolved: the lines are shown only while they leave a difference
    const net = lines.reduce((a, x) => a + Math.round(((x.debit ?? 0) - (x.credit ?? 0)) * 100), 0); return net === 0 ? [] : lines;
  }
  function reconcile(companies, asOf) {
    const pairs = []; for (const r of db.prepare("SELECT * FROM ic_relationships WHERE deleted_at IS NULL AND rel_status = 'ACTIVE'").all()) { if (!companies.includes(r.company_id) || !companies.includes(r.counterpart_company_id)) continue;
      const al = pairLines(r.company_id, r.counterpart_company_id, asOf); const bl = pairLines(r.counterpart_company_id, r.company_id, asOf); const a = al.reduce((x, y) => x + y.v, 0); const b = bl.reduce((x, y) => x + y.v, 0); pairs.push({ relationshipId: r.id, a: r.company_id, b: r.counterpart_company_id, aName: cname(r.company_id), bName: cname(r.counterpart_company_id), aBalance: a, bBalance: b, difference: a + b, aLines: al, bLines: bl }); }
    const strays = companies.flatMap((c) => stray(c, asOf).map((s) => ({ ...s, companyId: c, company: cname(c) })));
    const open = db.prepare(`SELECT id, doc_no, company_id, to_company_id, ic_state, amount_paise, txn_date FROM ic_transactions WHERE deleted_at IS NULL AND ic_state IN ('AWAITING_COUNTERPART', 'DISPUTED') AND txn_date <= ? AND company_id IN (${companies.join(',')}) AND to_company_id IN (${companies.join(',')})`).all(asOf);
    return { pairs, strays, open };
  }
  const reconciliation = {
    get(actor, { asOf }) { need(actor, 'fin.transaction.view', 'see the inter-company reconciliation'); const c = actor.companyId; const d = asOf ?? todayIST();
      const others = db.prepare("SELECT company_id, counterpart_company_id FROM ic_relationships WHERE deleted_at IS NULL AND rel_status = 'ACTIVE' AND (company_id = ? OR counterpart_company_id = ?)").all(c, c).map((r) => (r.company_id === c ? r.counterpart_company_id : r.company_id));
      const x = reconcile([c, ...others], d); const pairs = x.pairs.filter((p) => p.a === c || p.b === c);
      return { asOf: d, pairs: pairs.map((p) => { const mineA = p.a === c; return { relationshipId: p.relationshipId, counterpart: mineA ? p.bName : p.aName, counterpartId: mineA ? p.b : p.a, own: rs(mineA ? p.aBalance : p.bBalance), theirs: rs(mineA ? p.bBalance : p.aBalance), difference: rs(p.difference), matched: p.difference === 0 }; }),
        strays: x.strays.filter((s) => s.companyId === c), open: x.open.filter((o) => o.company_id === c || o.to_company_id === c).map((o) => ({ id: o.id, docNo: o.doc_no, from: cname(o.company_id), to: cname(o.to_company_id), state: o.ic_state, amount: rs(o.amount_paise), date: o.txn_date })) }; },
  };

  // ---- FR-04: consolidation ----
  const groupOf = (parent) => [parent, ...db.prepare("SELECT counterpart_company_id AS id, holding_pct FROM ic_relationships WHERE company_id = ? AND deleted_at IS NULL AND rel_status = 'ACTIVE' AND consolidate = 1 AND relationship_type = 'SUBSIDIARY'").all(parent).map((r) => r.id)];
  function consolidate(actor, period, basis) {
    const parent = actor.companyId; const P0 = pc(); const lc = new Map(); const P = { ...P0, lineOf: (c, id) => { const k = `${c}:${id}`; if (!lc.has(k)) lc.set(k, P0.lineOf(c, id)); return lc.get(k); } }; const subs = db.prepare("SELECT counterpart_company_id AS id, holding_pct FROM ic_relationships WHERE company_id = ? AND deleted_at IS NULL AND rel_status = 'ACTIVE' AND consolidate = 1 AND relationship_type = 'SUBSIDIARY'").all(parent);
    const members = [parent, ...subs.map((s) => s.id)]; const fy = db.prepare('SELECT * FROM core_financial_years WHERE company_id = ? AND start_date <= ? AND end_date >= ?').get(parent, `${period}-01`, `${period}-01`); if (!fy) throw unprocessable(`No financial year of the parent covers ${period}.`);
    const fr = P.frameOf(period, basis, fy.start_date); const companies = []; const bs = {}; const pl = {}; const add = (o, k, v) => { o[k] = (o[k] ?? 0) + v; };
    for (const c of members) { const pos = P.position(c, fr.to); const p = P.pnl(c, fr.from, fr.to); companies.push({ id: c, name: cname(c), assets: rs(pos.assets), equityLiabilities: rs(pos.eqLiab), pat: rs(p.pat), balanced: pos.tb.balanced, lines: pos.lines, pl: p }); for (const [k, v] of Object.entries(pos.lines)) add(bs, k, v); for (const [k, v] of Object.entries(p.lines)) add(pl, k, v); }
    const elim = []; const e = (description, line, amount) => { if (!amount) return; elim.push({ description, line, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 }); };
    // the inter-company balances: each side's mirror lines on its inter-company accounts reversed, by the Schedule III line of the account
    const rec = reconcile(members, fr.to);
    for (const p of rec.pairs) for (const [c, cp, rows] of [[p.a, p.b, p.aLines], [p.b, p.a, p.bLines]]) {
      for (const r of rows) { const line = P.lineOf(c, r.id); const nature = SCHEDULE3.find((x) => x.code === line)?.nature; e(`Inter-company balance of ${cname(c)} with ${cname(cp)}`, line, -r.v); add(bs, line, nature === 'ASSET' ? -r.v : r.v); } }
    // the charges between group companies in the period: the income of one and the cost of the other
    for (const t of db.prepare(`SELECT * FROM ic_transactions WHERE ic_type = 'CHARGE' AND ic_state = 'POSTED' AND txn_date BETWEEN ? AND ? AND company_id IN (${members.join(',')}) AND to_company_id IN (${members.join(',')})`).all(fr.from, fr.to)) {
      const li = P.lineOf(t.company_id, t.from_account_id); const le = P.lineOf(t.to_company_id, t.to_account_id); e(`${t.doc_no}: income of ${cname(t.company_id)}`, li, t.amount_paise); e(`${t.doc_no}: cost of ${cname(t.to_company_id)}`, le, -t.amount_paise); add(pl, li, -t.amount_paise); add(pl, le, -t.amount_paise); }
    // the investment against the subsidiary's share capital; the non-controlling interest
    let nciEquity = 0; let nciProfit = 0; let investLeft = companies[0].lines.BS_NC_INVESTMENTS ?? 0;
    for (const s of subs) { const co = companies.find((x) => x.id === s.id); const h = s.holding_pct / 100; const sc = co.lines.BS_SHARE_CAPITAL ?? 0; const oe = co.lines.BS_OTHER_EQUITY ?? 0; const nci = (sc - Math.round(h * sc)) + Math.round((1 - h) * oe); const inv = Math.min(investLeft, Math.round(h * sc)); investLeft -= inv;
      e(`Share capital of ${co.name}`, 'BS_SHARE_CAPITAL', sc); if (Math.round((1 - h) * oe)) e(`Reserves of ${co.name} attributable to the non-controlling interest`, 'BS_OTHER_EQUITY', Math.round((1 - h) * oe)); e(`Investment in ${co.name}`, 'BS_NC_INVESTMENTS', -inv); if (Math.round(h * sc) - inv) e(`Capital reserve on ${co.name}`, 'BS_OTHER_EQUITY', -(Math.round(h * sc) - inv)); if (nci) e(`Non-controlling interest in ${co.name}`, 'BS_NCI', -nci);
      add(bs, 'BS_SHARE_CAPITAL', -sc); add(bs, 'BS_OTHER_EQUITY', -Math.round((1 - h) * oe) + (Math.round(h * sc) - inv)); add(bs, 'BS_NC_INVESTMENTS', -inv); nciEquity += nci; nciProfit += Math.round((1 - h) * Math.round(co.pat * 100)); }
    bs.BS_NCI = nciEquity;
    const assets = SCHEDULE3.filter((s) => s.statement === 'BS' && s.nature === 'ASSET').reduce((a, s) => a + (bs[s.code] ?? 0), 0); const eqLiab = SCHEDULE3.filter((s) => s.statement === 'BS' && s.nature !== 'ASSET').reduce((a, s) => a + (bs[s.code] ?? 0), 0) + nciEquity;
    const income = SCHEDULE3.filter((s) => s.nature === 'INCOME').reduce((a, s) => a + (pl[s.code] ?? 0), 0); const expenses = SCHEDULE3.filter((s) => s.nature === 'EXPENSE' && s.code !== 'PL_TAX_EXPENSE').reduce((a, s) => a + (pl[s.code] ?? 0), 0); const pbt = income - expenses; const pat = pbt - (pl.PL_TAX_EXPENSE ?? 0);
    const unmatched = rec.pairs.reduce((a, p) => a + Math.abs(p.difference), 0) + rec.strays.reduce((a, s) => a + Math.round(Math.abs((s.debit ?? 0) - (s.credit ?? 0)) * 100), 0);
    const rows = (st, src) => [...SCHEDULE3.filter((s) => s.statement === st).map((s) => ({ code: s.code, section: s.section, label: s.label, amount: rs(src[s.code] ?? 0), byCompany: companies.map((c) => ({ company: c.name, amount: rs(st === 'BS' ? c.lines[s.code] ?? 0 : c.pl.lines[s.code] ?? 0) })) })), ...(st === 'BS' ? [{ code: 'BS_NCI', section: 'Equity', label: 'Non-controlling interest', amount: rs(nciEquity), byCompany: [] }] : [])];
    return { period, basis, from: fr.from, to: fr.to, parent: cname(parent), companies: companies.map((c) => ({ id: c.id, name: c.name, assets: c.assets, equityLiabilities: c.equityLiabilities, pat: c.pat, balanced: c.balanced, holdingPct: c.id === parent ? 100 : subs.find((s) => s.id === c.id)?.holding_pct })),
      balanceSheet: { rows: rows('BS', bs), totals: { assets: rs(assets), equityLiabilities: rs(eqLiab), balanced: assets === eqLiab } }, profitAndLoss: { rows: rows('PL', pl), totals: { income: rs(income), expenses: rs(expenses), pbt: rs(pbt), pat: rs(pat), attributableToOwners: rs(pat - nciProfit), attributableToNci: rs(nciProfit) } },
      eliminations: { entries: elim.map((x) => ({ ...x, debit: rs(x.debit), credit: rs(x.credit) })), debit: rs(elim.reduce((a, x) => a + x.debit, 0)), credit: rs(elim.reduce((a, x) => a + x.credit, 0)), balanced: balanced(elim) },
      reconciliation: { pairs: rec.pairs.map((p) => ({ a: p.aName, b: p.bName, aBalance: rs(p.aBalance), bBalance: rs(p.bBalance), difference: rs(p.difference) })), strays: rec.strays, open: rec.open.map((o) => ({ id: o.id, docNo: o.doc_no, state: o.ic_state, amount: rs(o.amount_paise) })) }, unmatched: rs(unmatched), canFinalise: unmatched === 0 && rec.open.length === 0 };
  }
  const consolidations = {
    preview(actor, { period, basis = 'YTD' }) { need(actor, 'fin.consolidation.view', 'see consolidated statements'); return consolidate(actor, period, basis); },
    list(actor) { need(actor, 'fin.consolidation.view', 'see consolidations'); return db.prepare('SELECT id, doc_no, period, basis, run_status, eliminations_paise, unmatched_paise, finalised_by, finalised_at, created_at FROM ic_consolidations WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(actor.companyId).map((r) => ({ id: r.id, docNo: r.doc_no, period: r.period, basis: r.basis, status: r.run_status, eliminations: rs(r.eliminations_paise), unmatched: rs(r.unmatched_paise), finalisedBy: r.finalised_by, finalisedAt: r.finalised_at, at: r.created_at })); },
    get(actor, id) { need(actor, 'fin.consolidation.view', 'see consolidations'); const r = db.prepare('SELECT * FROM ic_consolidations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That consolidation does not exist.'); return { id: r.id, docNo: r.doc_no, status: r.run_status, finalisedBy: r.finalised_by, finalisedAt: r.finalised_at, ...JSON.parse(r.result_json) }; },
    /** A run saved as a draft; finalised by the CFO only when nothing is unmatched or open (BR-01). */
    run(actor, { period, basis = 'YTD' }) { need(actor, 'fin.consolidation.run', 'run the consolidation'); const x = consolidate(actor, period, basis); const no = `CON/${period}/${basis}/${(db.prepare('SELECT COUNT(*) AS n FROM ic_consolidations WHERE company_id = ? AND period = ? AND basis = ?').get(actor.companyId, period, basis).n ?? 0) + 1}`;
      const id = Number(db.prepare("INSERT INTO ic_consolidations (company_id, doc_no, period, basis, companies_json, result_json, eliminations_paise, unmatched_paise, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, no, period, basis, JSON.stringify(groupOf(actor.companyId)), JSON.stringify(x), Math.round((x.eliminations.debit ?? 0) * 100), Math.round(x.unmatched * 100), actor.user).lastInsertRowid);
      audit(actor, 'ic_consolidations', id, 'create', actor.companyId, { newValues: { period, basis, unmatched: x.unmatched } }); return consolidations.get(actor, id); },
    finalise(actor, id) { need(actor, 'fin.consolidation.finalise', 'finalise the consolidation'); const r = db.prepare('SELECT * FROM ic_consolidations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That consolidation does not exist.'); if (r.run_status !== 'DRAFT') throw conflict('Only a draft run is finalised.');
      const x = consolidate(actor, r.period, r.basis); if (!x.canFinalise) throw unprocessable(`The consolidation cannot be finalised: unmatched inter-company balances ₹${x.unmatched}${x.reconciliation.open.length ? ` and ${x.reconciliation.open.length} transaction(s) waiting for the counterpart or disputed` : ''}.`);
      if (!x.eliminations.balanced || !x.balanceSheet.totals.balanced) throw unprocessable('The eliminations or the consolidated balance sheet do not balance.');
      transaction(db, () => { db.prepare("UPDATE ic_consolidations SET run_status = 'SUPERSEDED', updated_at = ? WHERE company_id = ? AND period = ? AND basis = ? AND run_status = 'FINAL'").run(nowIso(), r.company_id, r.period, r.basis); db.prepare("UPDATE ic_consolidations SET run_status = 'FINAL', result_json = ?, finalised_by = ?, finalised_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(x), actor.user, nowIso(), nowIso(), r.id);
        audit(actor, 'ic_consolidations', r.id, 'finalise', r.company_id); evt('fin.consolidation.finalised', actor, r.company_id, 'ic_consolidations', r.id, { consolidationId: r.id, docNo: r.doc_no, period: r.period, basis: r.basis, companies: x.companies.map((c) => c.id), assets: x.balanceSheet.totals.assets, pat: x.profitAndLoss.totals.pat, eliminations: x.eliminations.debit }); });
      return consolidations.get(actor, r.id); },
    exportCsv(actor, { period, basis = 'YTD' }) { need(actor, 'fin.consolidation.view', 'export consolidated statements'); const x = consolidate(actor, period, basis); audit(actor, 'ic_consolidations', 0, 'export', actor.companyId, { reason: `${period} ${basis}` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `consolidated-${period}-${basis.toLowerCase()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Statement', 'Section', 'Line', 'Consolidated', ...x.companies.map((c) => c.name)], [...x.balanceSheet.rows.map((r) => ['Balance sheet', r.section, r.label, r.amount, ...r.byCompany.map((b) => b.amount)]), ...x.profitAndLoss.rows.map((r) => ['Profit and loss', r.section, r.label, r.amount, ...r.byCompany.map((b) => b.amount)]), ...x.eliminations.entries.map((e) => ['Elimination', e.line, e.description, e.debit || -e.credit])])}`, 'utf8') }; },
  };

  // ---- FR-05: JV / consortium shares ----
  const projOf = (actor, id) => { const p = db.prepare('SELECT id, company_id, code, name FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(Number(id)); if (!p || p.company_id !== actor.companyId) throw notFound('That project does not exist.'); return p; };
  const jv = {
    list(actor, { projectId }) { need(actor, 'fin.jv.view', 'see JV shares'); const p = projOf(actor, projectId); const rows = db.prepare('SELECT * FROM jv_shares WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL ORDER BY share_role, partner_name').all(p.id, actor.companyId);
      const others = rows.reduce((a, r) => a + r.share_pct, 0); return { projectId: p.id, project: `${p.code} ${p.name}`, ownShare: Math.round((100 - others) * 10000) / 10000, partners: rows.map((r) => ({ id: r.id, name: r.partner_name, partnerId: r.partner_id, partnerCompanyId: r.partner_company_id, sharePct: r.share_pct, role: r.share_role, version: r.version })) }; },
    save(actor, b) { need(actor, 'fin.jv.manage', 'keep JV shares'); const p = projOf(actor, b.projectId); const others = db.prepare('SELECT COALESCE(SUM(share_pct), 0) AS s FROM jv_shares WHERE org_project_id = ? AND deleted_at IS NULL AND id <> ? AND company_id = ?').get(p.id, Number(b.id ?? 0), actor.companyId).s;
      if (others + b.sharePct >= 100) throw badRequest('Correct the highlighted fields', [{ field: 'sharePct', message: `The partners' shares would reach ${others + b.sharePct} %; your company's own share must stay above 0.` }]);
      const name = b.partnerName ?? (b.partnerCompanyId ? cname(b.partnerCompanyId) : b.partnerId ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ? AND company_id = ?').get(Number(b.partnerId), actor.companyId)?.legal_name : null); if (!name) throw badRequest('Correct the highlighted fields', [{ field: 'partnerName', message: 'Name the partner.' }]);
      if (b.id) { const r = db.prepare('SELECT * FROM jv_shares WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(b.id), actor.companyId); if (!r) throw notFound('That share does not exist.'); db.prepare('UPDATE jv_shares SET partner_name = ?, share_pct = ?, share_role = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(name, b.sharePct, b.role ?? r.share_role, actor.user, nowIso(), r.id); audit(actor, 'jv_shares', r.id, 'update', actor.companyId, { oldValues: { share: r.share_pct }, newValues: { share: b.sharePct } }); }
      else { try { const id = Number(db.prepare("INSERT INTO jv_shares (company_id, org_project_id, partner_id, partner_company_id, partner_name, share_pct, share_role, valid_from, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, p.id, b.partnerId ?? null, b.partnerCompanyId ?? null, name, b.sharePct, b.role ?? 'MEMBER', b.validFrom ?? null, actor.user).lastInsertRowid); audit(actor, 'jv_shares', id, 'create', actor.companyId, { newValues: { partner: name, share: b.sharePct } }); } catch (e) { if (/UNIQUE/.test(String(e.message))) throw conflict('That partner already has a share in the project.'); throw e; } }
      return jv.list(actor, { projectId: p.id }); },
    remove(actor, id, { reason }) { need(actor, 'fin.jv.manage', 'keep JV shares'); const r = db.prepare('SELECT * FROM jv_shares WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That share does not exist.'); db.prepare('UPDATE jv_shares SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'jv_shares', r.id, 'delete', actor.companyId, { reason }); return jv.list(actor, { projectId: r.org_project_id }); },
    /** The project's revenue and cost of a range (posted lines carrying the project) and each partner's share of them. */
    statement(actor, { projectId, from, to }) {
      need(actor, 'fin.jv.view', 'see the JV partner statement'); const s = jv.list(actor, { projectId }); const P = pc();
      const lines = db.prepare(`SELECT l.account_id AS id, g.nature, SUM(l.debit_paise - l.credit_paise) AS v FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id WHERE j.company_id = ? AND ${POSTED} AND l.project_id = ? AND j.voucher_date BETWEEN ? AND ? AND g.nature IN ('INCOME', 'EXPENSE') AND j.kind <> 'OPENING' GROUP BY l.account_id, g.nature`).all(actor.companyId, s.projectId, from, to);
      const by = {}; for (const r of lines) { const line = P.lineOf(actor.companyId, r.id); by[line] = (by[line] ?? 0) + (r.nature === 'INCOME' ? -r.v : r.v); }
      const revenue = SCHEDULE3.filter((x) => x.nature === 'INCOME').reduce((a, x) => a + (by[x.code] ?? 0), 0); const cost = SCHEDULE3.filter((x) => x.nature === 'EXPENSE').reduce((a, x) => a + (by[x.code] ?? 0), 0);
      const parties = [{ name: cname(actor.companyId), sharePct: s.ownShare, own: true }, ...s.partners.map((p) => ({ name: p.name, sharePct: p.sharePct, own: false, role: p.role }))];
      const split = (v, pct) => Math.round((v * pct) / 100); const shares = parties.map((p) => ({ ...p, revenue: rs(split(revenue, p.sharePct)), cost: rs(split(cost, p.sharePct)), result: rs(split(revenue, p.sharePct) - split(cost, p.sharePct)) }));
      const d = revenue - shares.reduce((a, x) => a + Math.round(x.revenue * 100), 0); if (d && shares.length) shares[0].revenue = rs(Math.round(shares[0].revenue * 100) + d); const dc = cost - shares.reduce((a, x) => a + Math.round(x.cost * 100), 0); if (dc && shares.length) shares[0].cost = rs(Math.round(shares[0].cost * 100) + dc); if (shares.length) shares[0].result = rs(Math.round(shares[0].revenue * 100) - Math.round(shares[0].cost * 100));
      return { projectId: s.projectId, project: s.project, from, to, revenue: rs(revenue), cost: rs(cost), result: rs(revenue - cost), lines: SCHEDULE3.filter((x) => x.statement === 'PL' && by[x.code]).map((x) => ({ code: x.code, label: x.label, amount: rs(by[x.code]) })), shares };
    },
  };

  return { relationships, transactions, reconciliation, consolidations, jv };
}
