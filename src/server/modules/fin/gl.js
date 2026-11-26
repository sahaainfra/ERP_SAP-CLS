import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { assertPeriodOpen, findFinancialYear } from '../core/financial-years/service.js';
import { issueNumber } from '../core/numbering/service.js';
import { nowIso, rid, same } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { finOf } from './service.js';

// Part 23.01: the general ledger core, the single book of accounts. A journal (voucher) is a header and two or more lines, each a debit or a credit to one account with its
// dimensions. A manual journal is made by finance (FINEX), checked line by line against the account's rules (06.05: active, dimension rules, no control account by hand),
// balanced to the paisa, sent for approval (the accounts manager; above the CFO limit, the CFO too; the maker never approves), and posted when it is approved: the voucher
// number of its type and financial year is given, the balance projection (fin_balances) is written and `fin.journal.posted` / `fin.gl.posted` are published. A posted journal
// is never changed (BR-01): it is reversed by a mirror journal linked both ways, approved in the same band. An accrual is reversed by itself on the date it names; a recurring
// template becomes a journal on each due date, sent for approval in its owner's name. The posting engine (23.02) posts through postEngine(): approved by its rule, one journal
// per source document. The ledger of an account, the trial balance on any date and by dimension, and the carry-forward of the balances to the next financial year (FR-06)
// are read from the posted lines.

export const GL_DOC = 'FIN_JOURNAL';
export const VOUCHER_TYPES = { JV: 'Journal', PV: 'Payment', RV: 'Receipt', CV: 'Contra', PJ: 'Purchase', SJ: 'Sales', DN: 'Debit note', CN: 'Credit note', OB: 'Opening balance' };
export const KINDS = { MANUAL: 'Manual', RECURRING: 'Recurring', ACCRUAL: 'Accrual (reverses itself)', REVERSAL: 'Reversal', OPENING: 'Opening balances', ENGINE: 'Posting engine' };
export const FREQUENCIES = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };
/** [field of the API, column, dimension of the account's rules (06.05) or null] */
export const DIMS = [['branchId', 'branch_id', 'BRANCH'], ['projectId', 'project_id', 'PROJECT'], ['siteId', 'site_id', 'SITE'], ['wbsId', 'wbs_id', 'WBS'], ['costCentreId', 'cost_centre_id', 'COST_CENTRE'], ['profitCentreId', 'profit_centre_id', 'PROFIT_CENTRE'], ['departmentId', 'department_id', 'DEPARTMENT'], ['costCodeId', 'cost_code_id', null], ['partnerId', 'partner_id', null], ['employeeId', 'employee_id', 'EMPLOYEE'], ['equipmentId', 'equipment_id', 'EQUIPMENT']];
const LINE_COLS = DIMS.map((d) => d[1]);

if (!parameterRegistry.get('fin.journal.cfo_limit')) parameterRegistry.define({ key: 'fin.journal.cfo_limit', dataType: 'integer', default: 500000, scopes: ['system', 'company'], description: 'Part 23.01 §9: a manual journal or reversal above this many rupees is approved by the CFO after the accounts manager (₹5 lakh by default).', min: 0 });
if (!parameterRegistry.get('fin.gl.retained_earnings')) parameterRegistry.define({ key: 'fin.gl.retained_earnings', dataType: 'string', default: '320001', scopes: ['system', 'company'], description: 'Part 23.01 FR-06: the code of the equity account the profit or loss of a year is carried to in the opening balances of the next (320001 Retained earnings of the template chart); when the chart has no such account, the first EQUITY account.' });

const paise = (v) => Math.round(Number(v) * 100);
const rs = (p) => (p == null ? null : p / 100);
const exact = (v) => v == null || Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) < 1e-6;
const addMonths = (d, n, day) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); x.setUTCDate(Math.min(day, 28)); return x.toISOString().slice(0, 10); };
const STEP = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
const addDay = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

export const jnList = defineList({
  code: 'fin.journals', label: 'Journals', permission: 'fin.journal.view',
  from: 'fin_journals x', where: 'x.company_id = :c AND x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'COALESCE(x.voucher_no, x.doc_no)', type: 'text', label: 'Voucher' },
    voucherType: { sql: 'x.voucher_type', type: 'enum', label: 'Type', options: Object.entries(VOUCHER_TYPES) },
    voucherDate: { sql: 'x.voucher_date', type: 'date', label: 'Date' },
    narration: { sql: 'x.narration', type: 'text', label: 'Narration' },
    kind: { sql: 'x.kind', type: 'enum', label: 'Kind', options: Object.entries(KINDS) },
    source: { sql: "COALESCE(x.source_type, '')", type: 'text', label: 'Source' },
    period: { sql: "(SELECT name FROM core_periods WHERE id = x.period_id)", type: 'text', label: 'Period' },
    total: { sql: '(x.total_paise / 100.0)', type: 'money', label: 'Amount' },
    reversed: { sql: "(CASE WHEN x.reversed_by_id IS NOT NULL THEN 'Reversed' WHEN x.reversal_of_id IS NOT NULL THEN 'Reversal' ELSE '' END)", type: 'text', label: 'Reversal' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries({ ...STATUS, APPROVED: 'Posted' }) },
  },
});
export const rcList = defineList({
  code: 'fin.recurring_journals', label: 'Recurring journals', permission: 'fin.journal.view',
  from: 'fin_recurring_journals x', where: 'x.company_id = :c AND x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Template' }, name: { sql: 'x.name', type: 'text', label: 'Name' },
    frequency: { sql: 'x.frequency', type: 'enum', label: 'Frequency', options: Object.entries(FREQUENCIES) }, nextRunOn: { sql: 'x.next_run_on', type: 'date', label: 'Next journal' },
    total: { sql: '(x.total_paise / 100.0)', type: 'money', label: 'Amount' }, runs: { sql: 'x.runs', type: 'number', label: 'Journals made' },
    status: { sql: 'x.rec_status', type: 'enum', label: 'Status', options: Object.entries({ ACTIVE: 'Active', PAUSED: 'Paused', ENDED: 'Ended' }) },
  },
});

/** @param {{ db: any, base: any }} o */
export function createGlService({ db, base }) {
  const { may, audit, notify } = base;
  const fin = () => finOf(db);
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const cfoLimitPaise = (companyId) => Number(param(companyId, 'fin.journal.cfo_limit') ?? 500000) * 100;
  const evt = (type, actor, companyId, id, data) => publishEvent(db, { type, entity: 'fin_journals', entityId: id, actorId: actor?.user ?? 'system', companyId, data });
  const company = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };

  // ---- the lines: one check for a draft, a submission, a posting and the engine ----
  /** The lines of a request in paise with their dimensions, and the problems of each (field `lines.<i>.<field>`). */
  function checkLines(companyId, lines, { source = 'MANUAL' } = {}) {
    const problems = []; const out = [];
    if (!Array.isArray(lines) || lines.length < 2) problems.push({ field: 'lines', message: 'A journal has at least two lines: something debited and something credited.' });
    (lines ?? []).forEach((l, i) => {
      const f = (field, message) => problems.push({ field: `lines.${i}.${field}`, message });
      const dr = l.debit == null || l.debit === '' ? 0 : Number(l.debit); const cr = l.credit == null || l.credit === '' ? 0 : Number(l.credit);
      if (!Number.isFinite(dr) || !Number.isFinite(cr) || dr < 0 || cr < 0) f('debit', 'Debit and credit are amounts of zero or more.');
      else if (!exact(dr) || !exact(cr)) f('debit', 'An amount has at most two decimals (paise).');
      else if ((dr > 0) === (cr > 0)) f('debit', 'A line is either a debit or a credit: give one amount, not both and not none.');
      const dims = {}; for (const [k, , d] of DIMS) { const v = l[k]; if (v != null && v !== '') { if (!/^\d+$/.test(String(v))) f(k, 'Choose a value from the list.'); else if (d) dims[d] = Number(v); } }
      if (!l.accountId) f('accountId', 'Choose an account.');
      else {
        const v = fin().validatePosting(companyId, { accountId: Number(l.accountId), dimensions: dims, source });
        for (const e of v.errors) { const k = e.dimension ? (DIMS.find((x) => x[2] === e.dimension)?.[0] ?? 'accountId') : 'accountId'; f(k, e.message); }
      }
      if (l.costCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL').get(Number(l.costCodeId), companyId)) f('costCodeId', 'The cost code does not exist in this company.');
      if (l.partnerId && !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(l.partnerId), companyId)) f('partnerId', 'The partner does not exist in this company.');
      if (l.narration != null && String(l.narration).length > 300) f('narration', 'A line narration is at most 300 characters.');
      out.push({ accountId: Number(l.accountId), debit: Number.isFinite(dr) ? paise(dr) : 0, credit: Number.isFinite(cr) ? paise(cr) : 0, narration: l.narration ? String(l.narration).trim() : null, ...Object.fromEntries(DIMS.map(([k, c]) => [c, l[k] == null || l[k] === '' ? null : Number(l[k])])) });
    });
    const dr = out.reduce((a, x) => a + x.debit, 0); const cr = out.reduce((a, x) => a + x.credit, 0);
    if (!problems.length && dr !== cr) problems.push({ field: 'lines', code: 'UNBALANCED', message: `The journal does not balance: debits ₹${(dr / 100).toFixed(2)}, credits ₹${(cr / 100).toFixed(2)}, a difference of ₹${(Math.abs(dr - cr) / 100).toFixed(2)}.` });
    return { lines: out, total: dr, problems };
  }
  const fail = (problems) => { if (problems.length) throw badRequest(problems.find((p) => p.code === 'UNBALANCED')?.message ?? 'Correct the highlighted fields', problems); };
  const periodOf = (companyId, date, actor = null) => assertPeriodOpen(db, { companyId, module: 'finance', date, actor });

  // ---- numbers ----
  /** The voucher number of a type in its financial year: the company's numbering series FIN_<type> when one is set up (01.03), else <type>/<FY>/000001. */
  function voucherNo(companyId, type, date) {
    try { return issueNumber(db, { companyId, docType: `FIN_${type}`, date, actor: 'system', refType: 'fin_journals' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const fy = findFinancialYear(db, companyId, date); const pre = `${type}/${fy?.code ?? date.slice(0, 4)}/`;
    const last = db.prepare("SELECT voucher_no FROM fin_journals WHERE company_id = ? AND voucher_no LIKE ? ORDER BY length(voucher_no) DESC, voucher_no DESC LIMIT 1").get(companyId, `${pre}%`);
    const n = last ? Number(String(last.voucher_no).slice(pre.length)) + 1 : 1; return `${pre}${String(n).padStart(6, '0')}`;
  }
  const draftNo = (companyId) => { const n = (db.prepare('SELECT COUNT(*) AS n FROM fin_journals WHERE company_id = ?').get(companyId).n ?? 0) + 1; let no = `JNL/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare('SELECT 1 FROM fin_journals WHERE company_id = ? AND doc_no = ?').get(companyId, no); k += 1) no = `JNL/${String(k).padStart(6, '0')}`; return no; };

  // ---- the projection (BR-02) ----
  function project(j, sign = 1) {
    const lines = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL').all(j.id);
    const up = db.prepare(`INSERT INTO fin_balances (company_id, account_id, period_id, dimension_hash, branch_id, cost_centre_id, project_id, site_id, debit_paise, credit_paise, created_by, source_type)
      VALUES (:c, :a, :p, :h, :b, :cc, :pr, :s, :dr, :cr, 'system', 'fin_journals')
      ON CONFLICT (company_id, account_id, period_id, dimension_hash) DO UPDATE SET debit_paise = debit_paise + :dr, credit_paise = credit_paise + :cr, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), version = version + 1`);
    for (const l of lines) up.run({ c: j.company_id, a: l.account_id, p: j.period_id, h: `${l.branch_id ?? ''}|${l.project_id ?? ''}|${l.site_id ?? ''}|${l.cost_centre_id ?? ''}`, b: l.branch_id, cc: l.cost_centre_id, pr: l.project_id, s: l.site_id, dr: sign * l.debit_paise, cr: sign * l.credit_paise });
  }

  /** Post an approved journal: its number, period and financial year, the projection and the events (in the caller's transaction). */
  function post(j, actor) {
    // a reversal posts only while the journal it reverses is not reversed already (an accrual's own reversal and a manual one may both be waiting)
    if (j.reversal_of_id) { const o = db.prepare('SELECT reversed_by_id, voucher_no FROM fin_journals WHERE id = ?').get(j.reversal_of_id); if (o?.reversed_by_id && o.reversed_by_id !== j.id) throw conflict(`${o.voucher_no ?? 'The journal'} is already reversed; this reversal is not posted.`); }
    const per = periodOf(j.company_id, j.voucher_date, actor?.roles ? actor : null); const fy = findFinancialYear(db, j.company_id, j.voucher_date);
    const no = j.voucher_no ?? voucherNo(j.company_id, j.voucher_type, j.voucher_date); const now = nowIso();
    db.prepare("UPDATE fin_journals SET voucher_no = ?, period_id = ?, fy_id = ?, posted_at = ?, posted_by = ?, status = 'APPROVED', updated_at = ?, version = version + 1 WHERE id = ?").run(no, per.id, fy?.id ?? null, now, actor?.user ?? 'system', now, j.id);
    const f = db.prepare('SELECT * FROM fin_journals WHERE id = ?').get(j.id); project(f);
    if (f.reversal_of_id) db.prepare('UPDATE fin_journals SET reversed_by_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND reversed_by_id IS NULL').run(f.id, now, f.reversal_of_id);
    audit(actor ?? { user: 'system' }, 'fin_journals', f.id, 'post', f.company_id, { newValues: { voucherNo: no, total: rs(f.total_paise), period: per.name } });
    const lines = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL ORDER BY line_no').all(f.id);
    evt('fin.journal.posted', actor, f.company_id, f.id, { journalId: f.id, voucherNo: no, voucherType: f.voucher_type, kind: f.kind, date: f.voucher_date, periodId: per.id, total: rs(f.total_paise), sourceType: f.source_type, sourceId: f.source_id, reversalOf: f.reversal_of_id, lines: lines.map((l) => ({ lineId: l.id, accountId: l.account_id, debit: rs(l.debit_paise), credit: rs(l.credit_paise), projectId: l.project_id, siteId: l.site_id, costCentreId: l.cost_centre_id, branchId: l.branch_id })) });
    // the budget actuals of departments (16.x) read the lines with a cost centre (contract of `fin.gl.*`, bud/constants.js)
    const cc = lines.filter((l) => l.cost_centre_id);
    if (f.reversal_of_id) { const o = db.prepare('SELECT * FROM fin_journals WHERE id = ?').get(f.reversal_of_id); if (db.prepare('SELECT 1 FROM fin_journal_lines WHERE journal_id = ? AND cost_centre_id IS NOT NULL').get(o.id)) evt('fin.gl.reversed', actor, f.company_id, o.id, { sourceType: 'fin_journal', sourceId: String(o.id), docRef: o.voucher_no, date: f.voucher_date }); }
    else if (cc.length) evt('fin.gl.posted', actor, f.company_id, f.id, { sourceType: 'fin_journal', sourceId: String(f.id), docRef: no, date: f.voucher_date, lines: cc.map((l) => ({ lineId: String(l.id), costCentreId: l.cost_centre_id, accountId: l.account_id, amount: rs(l.debit_paise - l.credit_paise), narration: l.narration ?? f.narration })) });
    return f;
  }

  function insertLines(companyId, journalId, lines, user) {
    const ins = db.prepare(`INSERT INTO fin_journal_lines (company_id, journal_id, line_no, account_id, debit_paise, credit_paise, narration, ${LINE_COLS.join(', ')}, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ${LINE_COLS.map(() => '?').join(', ')}, ?, 'fin_journals')`);
    lines.forEach((l, i) => ins.run(companyId, journalId, i + 1, l.accountId, l.debit, l.credit, l.narration, ...LINE_COLS.map((c) => l[c]), user));
  }

  const flow = createFlow({
    db, base, docType: GL_DOC, table: 'fin_journals', perm: 'fin.journal', label: 'journal', route: '/finance/journals?id=',
    where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.total_paise), overCfo: r.total_paise > cfoLimitPaise(r.company_id) ? 1 : 0, kind: r.kind, voucherType: r.voucher_type }),
    title: (r) => `${VOUCHER_TYPES[r.voucher_type]} ${r.voucher_date} ₹${(r.total_paise / 100).toFixed(2)}: ${r.narration}`,
    notifyCode: 'fin.journal.decided', numberKey: 'FIN_JOURNAL', prefix: 'JNL',
    beforeSubmit: (actor, r) => {
      const lines = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id);
      const c = checkLines(r.company_id, lines.map(lineIn), { source: sourceOf(r) }); fail(c.problems);
      if (c.total !== r.total_paise) throw conflict('The total of the journal does not match its lines; open it again and save.');
      periodOf(r.company_id, r.voucher_date, actor);
    },
    onApproved: (actor, r) => post(r, actor),
  });
  const sourceOf = (r) => (r.kind === 'OPENING' || r.kind === 'ENGINE' ? 'ENGINE' : 'MANUAL');
  const lineIn = (l) => ({ accountId: l.account_id, debit: rs(l.debit_paise), credit: rs(l.credit_paise), narration: l.narration, ...Object.fromEntries(DIMS.map(([k, c]) => [k, l[c]])) });

  // ---- views ----
  const nameOf = { account: (id) => db.prepare('SELECT code, name, normal_side FROM fin_accounts WHERE id = ?').get(id) };
  const label = (table, id, cols = 'code, name') => (id == null ? null : db.prepare(`SELECT ${cols} FROM ${table} WHERE id = ?`).get(id) ?? null);
  const sourceLink = (t, id) => { if (!t || id == null) return null; const o = objectTypes.get?.(t); return o ? { type: t, id: String(id), route: o.route(id), label: o.label } : { type: t, id: String(id), route: null, label: t }; };
  function lineView(l) {
    const a = nameOf.account(l.account_id);
    const dim = (k, table, cols) => { const r = label(table, l[k], cols); return r ? (r.code ? `${r.code} ${r.name ?? ''}`.trim() : (r.name ?? null)) : null; };
    return { id: l.id, lineNo: l.line_no, accountId: l.account_id, account: a ? `${a.code} ${a.name}` : null, debit: rs(l.debit_paise), credit: rs(l.credit_paise), narration: l.narration,
      ...Object.fromEntries(DIMS.map(([k, c]) => [k, l[c]])),
      labels: { branch: dim('branch_id', 'org_branches'), project: dim('project_id', 'org_projects'), site: dim('site_id', 'org_sites'), wbs: dim('wbs_id', 'proj_wbs'), costCentre: dim('cost_centre_id', 'org_cost_centres'), profitCentre: dim('profit_centre_id', 'org_cost_centres'), department: dim('department_id', 'org_departments'), costCode: dim('cost_code_id', 'fin_cost_codes'), partner: dim('partner_id', 'mdm_partners', 'code, legal_name AS name'), employee: dim('employee_id', 'hr_employees', 'emp_code AS code, full_name AS name'), equipment: dim('equipment_id', 'plt_equipment', 'asset_code AS code, NULL AS name') } };
  }
  function view(actor, r, detail = false) {
    const per = r.period_id ? db.prepare('SELECT name FROM core_periods WHERE id = ?').get(r.period_id) : null;
    const c0 = flow.can(actor, r);
    const posted = r.status === 'APPROVED';
    const o = { id: r.id, docNo: r.voucher_no ?? r.doc_no, draftNo: r.doc_no, voucherNo: r.voucher_no, voucherType: r.voucher_type, voucherTypeLabel: VOUCHER_TYPES[r.voucher_type], voucherDate: r.voucher_date, period: per?.name ?? null, kind: r.kind, kindLabel: KINDS[r.kind], narration: r.narration, total: rs(r.total_paise), status: r.status, statusLabel: posted ? 'Posted' : STATUS[r.status], postedAt: r.posted_at, postedBy: r.posted_by, autoReverseOn: r.auto_reverse_on, reversalOfId: r.reversal_of_id, reversedById: r.reversed_by_id, recurringId: r.recurring_id, source: sourceLink(r.source_type, r.source_id), sourceType: r.source_type, sourceId: r.source_id, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, version: r.version, cancelReason: r.cancel_reason,
      reversed: r.reversed_by_id ? 'Reversed' : r.reversal_of_id ? 'Reversal' : '',
      can: { ...c0, amend: false, reverse: posted && !r.reversed_by_id && !r.reversal_of_id && r.kind !== 'ENGINE' && may(actor, 'fin.journal.create') && !db.prepare("SELECT 1 FROM fin_journals WHERE reversal_of_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id) } };
    if (detail) {
      const lines = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id).map(lineView);
      const link = (id) => { if (!id) return null; const x = db.prepare('SELECT id, voucher_no, doc_no, status FROM fin_journals WHERE id = ?').get(id); return x ? { id: x.id, docNo: x.voucher_no ?? x.doc_no, status: x.status } : null; };
      Object.assign(o, flow.approveInfo(actor, r), { lines, debit: rs(lines.reduce((a, l) => a + paise(l.debit), 0)), credit: rs(lines.reduce((a, l) => a + paise(l.credit), 0)), reversalOf: link(r.reversal_of_id), reversedBy: link(r.reversed_by_id), pendingReversal: link(db.prepare("SELECT id FROM fin_journals WHERE reversal_of_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') ORDER BY id DESC LIMIT 1").get(r.id)?.id) });
    }
    return o;
  }
  const fresh = (actor, id) => view(actor, db.prepare('SELECT * FROM fin_journals WHERE id = ?').get(id), true);

  // ---- journals ----
  const journals = {
    flow,
    list(actor, query) { company(actor, 'fin.journal.view', 'see journals'); return runList(db, jnList, parseListRequest(jnList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { company(actor, 'fin.journal.view', 'see journals'); return view(actor, flow.row(actor, id), true); },
    options(actor) {
      company(actor, 'fin.journal.view', 'see journals'); fin().ensureSetup(actor.companyId);
      const accounts = db.prepare("SELECT a.id, a.code, a.name, a.account_type, a.normal_side, a.is_control, a.manual_posting_allowed, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id = ? AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE' ORDER BY a.code").all(actor.companyId);
      const rules = new Map(); for (const r of db.prepare('SELECT account_id, dimension, requirement FROM fin_dimension_rules WHERE company_id = ? AND deleted_at IS NULL').all(actor.companyId)) { if (!rules.has(r.account_id)) rules.set(r.account_id, {}); rules.get(r.account_id)[r.dimension] = r.requirement; }
      const pick = (sql) => db.prepare(sql).all(actor.companyId);
      return {
        voucherTypes: Object.entries(VOUCHER_TYPES).map(([code, name]) => ({ code, name })), kinds: Object.entries(KINDS).filter(([k]) => ['MANUAL', 'ACCRUAL', 'OPENING'].includes(k)).map(([code, name]) => ({ code, name })),
        accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.account_type, nature: a.nature, normalBalance: a.normal_side, manual: Boolean(a.manual_posting_allowed), control: Boolean(a.is_control), rules: rules.get(a.id) ?? {} })),
        branches: pick("SELECT id, code, name FROM org_branches WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code"),
        projects: pick('SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500'),
        sites: pick('SELECT id, code, name, org_project_id AS projectId FROM org_sites WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 1000'),
        wbs: pick("SELECT id, code, name, project_id AS projectId FROM proj_wbs WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 2000"),
        costCentres: pick("SELECT id, code, name FROM org_cost_centres WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' AND type = 'COST' ORDER BY code"),
        profitCentres: pick("SELECT id, code, name FROM org_cost_centres WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' AND type = 'PROFIT' ORDER BY code"),
        departments: pick('SELECT id, code, name FROM org_departments WHERE company_id = ? AND deleted_at IS NULL ORDER BY name'),
        costCodes: db.prepare('SELECT id, code, name FROM fin_cost_codes WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY code LIMIT 2000').all(actor.companyId),
        partners: pick("SELECT id, code, legal_name AS name FROM mdm_partners WHERE company_id = ? AND deleted_at IS NULL ORDER BY legal_name LIMIT 1000"),
        employees: pick("SELECT id, emp_code AS code, full_name AS name FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL ORDER BY full_name LIMIT 2000"),
        equipment: pick("SELECT id, asset_code AS code, asset_code AS name FROM plt_equipment WHERE company_id = ? AND deleted_at IS NULL ORDER BY asset_code LIMIT 1000"),
        cfoLimit: cfoLimitPaise(actor.companyId) / 100, today: todayIST(),
      };
    },
    /** Lines checked without saving (the form's live check; the same rules as save and submit). */
    check(actor, b) { company(actor, 'fin.journal.view', 'check journals'); const c = checkLines(actor.companyId, b.lines, { source: b.kind === 'OPENING' ? 'ENGINE' : 'MANUAL' }); return { ok: c.problems.length === 0, total: rs(c.total), problems: c.problems }; },
    create(actor, b) {
      company(actor, 'fin.journal.create', 'make journals');
      const kind = b.kind ?? 'MANUAL'; if (!['MANUAL', 'ACCRUAL', 'OPENING'].includes(kind)) throw badRequest('Correct the highlighted fields', [{ field: 'kind', message: 'A journal typed by a person is manual, an accrual or opening balances.' }]);
      const type = kind === 'OPENING' ? 'OB' : b.voucherType; const problems = [];
      if (!VOUCHER_TYPES[type] || (type === 'OB' && kind !== 'OPENING')) problems.push({ field: 'voucherType', message: 'Choose the type of voucher.' });
      if (kind === 'OPENING') { const fy = findFinancialYear(db, actor.companyId, b.voucherDate); if (!fy || fy.start_date !== b.voucherDate) problems.push({ field: 'voucherDate', message: 'Opening balances are dated on the first day of the financial year.' }); }
      if (kind === 'ACCRUAL' && !(b.autoReverseOn > b.voucherDate)) problems.push({ field: 'autoReverseOn', message: 'An accrual names the date after it on which it reverses itself (usually the first day of the next month).' });
      if (kind !== 'ACCRUAL' && b.autoReverseOn) problems.push({ field: 'autoReverseOn', message: 'Only an accrual reverses itself.' });
      const c = checkLines(actor.companyId, b.lines, { source: kind === 'OPENING' ? 'ENGINE' : 'MANUAL' }); problems.push(...c.problems);
      if (b.total != null && paise(b.total) !== c.total) problems.push({ field: 'total', message: 'The total sent does not match the lines; the server adds them up.' });
      fail(problems); periodOf(actor.companyId, b.voucherDate, actor);
      return transaction(db, () => {
        const id = Number(db.prepare(`INSERT INTO fin_journals (company_id, doc_no, voucher_type, voucher_date, kind, narration, total_paise, auto_reverse_on, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(actor.companyId, draftNo(actor.companyId), type, b.voucherDate, kind, b.narration.trim(), c.total, kind === 'ACCRUAL' ? b.autoReverseOn : null, actor.user, actor.user, b.sourceType ?? null, b.sourceId == null ? null : String(b.sourceId)).lastInsertRowid);
        insertLines(actor.companyId, id, c.lines, actor.user); audit(actor, 'fin_journals', id, 'create', actor.companyId, { newValues: { voucherType: type, total: rs(c.total), lines: c.lines.length } });
        return fresh(actor, id);
      });
    },
    update(actor, id, b) {
      const r = flow.row(actor, id, 'fin.journal.edit'); if (!flow.EDITABLE.includes(r.status)) throw conflict('Only a draft or a journal returned for correction is changed; a posted journal is reversed.');
      if (b.version !== r.version) throw conflict('The journal was changed by someone else; reload it.');
      const kind = r.kind; const type = kind === 'OPENING' ? 'OB' : (b.voucherType ?? r.voucher_type); const date = b.voucherDate ?? r.voucher_date; const problems = [];
      if (!VOUCHER_TYPES[type] || (type === 'OB' && kind !== 'OPENING')) problems.push({ field: 'voucherType', message: 'Choose the type of voucher.' });
      const autoRev = b.autoReverseOn !== undefined ? b.autoReverseOn : r.auto_reverse_on;
      if (kind === 'ACCRUAL' && !(autoRev > date)) problems.push({ field: 'autoReverseOn', message: 'An accrual reverses itself on a date after its own.' });
      const c = checkLines(r.company_id, b.lines ?? db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id).map(lineIn), { source: sourceOf(r) }); problems.push(...c.problems);
      if (b.total != null && paise(b.total) !== c.total) problems.push({ field: 'total', message: 'The total sent does not match the lines; the server adds them up.' });
      fail(problems); periodOf(r.company_id, date, actor);
      return transaction(db, () => {
        const before = view(actor, r, true);
        db.prepare('UPDATE fin_journals SET voucher_type = ?, voucher_date = ?, narration = ?, total_paise = ?, auto_reverse_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(type, date, (b.narration ?? r.narration).trim(), c.total, kind === 'ACCRUAL' ? autoRev : null, actor.user, nowIso(), r.id);
        db.prepare('DELETE FROM fin_journal_lines WHERE journal_id = ?').run(r.id); insertLines(r.company_id, r.id, c.lines, actor.user);
        audit(actor, 'fin_journals', r.id, 'update', r.company_id, { oldValues: { total: before.total, lines: before.lines.length }, newValues: { total: rs(c.total), lines: c.lines.length } });
        return fresh(actor, r.id);
      });
    },
    remove(actor, id) { const r = flow.row(actor, id, 'fin.journal.delete'); if (r.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); return transaction(db, () => { db.prepare('UPDATE fin_journal_lines SET deleted_at = ?, deleted_by = ? WHERE journal_id = ?').run(nowIso(), actor.user, r.id); return flow.remove(actor, id); }); },
    submit(actor, id) { flow.submit(actor, id); return fresh(actor, rid(id)); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return fresh(actor, rid(id)); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return fresh(actor, rid(id)); },
    history(actor, id) { return flow.history(actor, id); },
    /** BR-01, FR-04: a posted journal is reversed by a mirror journal (debits and credits swapped), linked both ways, sent for approval in the same band. */
    reverse(actor, id, { date, reason }) {
      company(actor, 'fin.journal.create', 'reverse journals'); const r = flow.row(actor, id);
      if (r.status !== 'APPROVED') throw unprocessable('Only a posted journal is reversed; a draft is changed or deleted.');
      if (r.reversed_by_id) throw conflict('This journal is already reversed.');
      if (r.reversal_of_id) throw unprocessable('A reversal is not reversed again; post a new journal instead.');
      if (r.kind === 'ENGINE') throw unprocessable('A journal of the posting engine is reversed by cancelling or correcting its source document.');
      if (db.prepare("SELECT 1 FROM fin_journals WHERE reversal_of_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('A reversal of this journal is already waiting.');
      const on = date ?? todayIST(); if (on < r.voucher_date) throw badRequest('Correct the highlighted fields', [{ field: 'date', message: 'A reversal is dated on or after the journal it reverses.' }]);
      periodOf(r.company_id, on, actor);
      const id2 = transaction(db, () => {
        const nid = Number(db.prepare(`INSERT INTO fin_journals (company_id, doc_no, voucher_type, voucher_date, kind, narration, total_paise, reversal_of_id, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, 'REVERSAL', ?, ?, ?, ?, ?, 'fin_journals', ?)`)
          .run(r.company_id, draftNo(r.company_id), r.voucher_type === 'OB' ? 'JV' : r.voucher_type, on, `Reversal of ${r.voucher_no}: ${reason}`.slice(0, 500), r.total_paise, r.id, actor.user, actor.user, String(r.id)).lastInsertRowid);
        const lines = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id);
        insertLines(r.company_id, nid, lines.map((l) => ({ accountId: l.account_id, debit: l.credit_paise, credit: l.debit_paise, narration: l.narration, ...Object.fromEntries(LINE_COLS.map((c) => [c, l[c]])) })), actor.user);
        audit(actor, 'fin_journals', nid, 'create', r.company_id, { reason, newValues: { reversalOf: r.voucher_no } });
        return nid;
      });
      flow.submit(actor, id2); return fresh(actor, id2);
    },
    /** A posted journal is not amended in place: the amendment is its reversal (sent for approval) and a draft copy to correct and send. */
    amend(actor, id, { reason }) {
      company(actor, 'fin.journal.amend', 'amend journals'); const r = flow.row(actor, id);
      const rev = journals.reverse(actor, id, { date: todayIST() > r.voucher_date ? todayIST() : r.voucher_date, reason: `Amendment: ${reason}` });
      const lines = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id).map(lineIn);
      const copy = journals.create(actor, { voucherType: r.voucher_type, voucherDate: rev.voucherDate, kind: r.kind === 'OPENING' ? 'OPENING' : 'MANUAL', narration: `${r.narration} (amends ${r.voucher_no})`.slice(0, 500), lines, sourceType: 'fin_journals', sourceId: r.id });
      return { reversal: rev, draft: copy };
    },
    print(actor, id) {
      const v = journals.get(actor, id); company(actor, 'fin.journal.print', 'print journals'); audit(actor, 'fin_journals', v.id, 'print', actor.companyId);
      const rows = v.lines.map((l) => ({ sl: String(l.lineNo), account: l.account, dims: Object.values(l.labels).filter(Boolean).join(' · '), narration: l.narration ?? '', debit: l.debit || null, credit: l.credit || null }));
      return { buffer: toPdf({ columns: [{ key: 'sl', label: 'Sl', type: 'text' }, { key: 'account', label: 'Account', type: 'text' }, { key: 'dims', label: 'Dimensions', type: 'text' }, { key: 'narration', label: 'Narration', type: 'text' }, { key: 'debit', label: 'Debit', type: 'number' }, { key: 'credit', label: 'Credit', type: 'number' }], rows, footer: [`${v.docNo} · ${v.voucherTypeLabel} · ${v.voucherDate} · ${v.statusLabel} · ${v.narration}`], title: `${v.voucherTypeLabel} ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf` };
    },
    exportCsv(actor, query = {}) {
      company(actor, 'fin.journal.export', 'export journals'); const l = journals.list(actor, { ...query, page: 1, pageSize: 100 });
      const rows = l.data.map((x) => [x.docNo, x.voucherTypeLabel, x.voucherDate, x.narration, x.kindLabel, x.total, x.statusLabel]); audit(actor, 'fin_journals', 0, 'export', actor.companyId, { reason: `${rows.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `journals-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Voucher', 'Type', 'Date', 'Narration', 'Kind', 'Amount', 'Status'], rows)}`, 'utf8') };
    },
    /** Import drafts: rows of one journal share a `ref`; each journal is checked like a typed one and saved as a draft (nothing is posted by an import). */
    importRows(actor, { rows }) {
      company(actor, 'fin.journal.create', 'import journals'); const groups = new Map();
      rows.forEach((x, i) => { const k = String(x.ref ?? '').trim(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ ...x, row: i + 1 }); });
      const accounts = new Map(db.prepare('SELECT id, code FROM fin_accounts WHERE company_id = ? AND deleted_at IS NULL').all(actor.companyId).map((a) => [a.code, a.id]));
      const out = [];
      for (const [ref, rs0] of groups) {
        try {
          if (!ref) throw new Error('Every row names the journal it belongs to (ref).');
          const h = rs0[0]; const lines = rs0.map((x) => { const a = accounts.get(String(x.accountCode ?? '').trim()); if (!a) throw new Error(`Row ${x.row}: account ${x.accountCode ?? '(none)'} is not in the chart.`); return { accountId: a, debit: x.debit ?? null, credit: x.credit ?? null, narration: x.narration ?? null, projectId: x.projectId ?? null, siteId: x.siteId ?? null, costCentreId: x.costCentreId ?? null, branchId: x.branchId ?? null }; });
          const d = journals.create(actor, { voucherType: h.voucherType ?? 'JV', voucherDate: h.voucherDate, narration: h.narration ?? `Imported journal ${ref}`, kind: 'MANUAL', lines });
          out.push({ ref, id: d.id, docNo: d.docNo });
        } catch (e) { out.push({ ref, error: e.problems?.map((p) => p.message).join(' ') || e.message }); }
      }
      audit(actor, 'fin_journals', 0, 'import', actor.companyId, { reason: `${out.filter((x) => x.id).length} of ${out.length} journal(s)` });
      return out;
    },
    /** The outcome of the workflow (approve: post). */
    decide(instance, actor, outcome, comment) { return flow.decide(instance, actor, outcome, comment); },
  };

  // ---- the posting engine's entry (23.02) and the system's own journals ----
  /**
   * A journal of the posting engine, posted at once (approved by its rule): one per source document (BR-01 of 23.02, the unique source key), control accounts allowed,
   * dimension rules and the period checked like any other. Returns { journal, duplicate }.
   */
  function postEngine(companyId, { voucherType = 'JV', date, narration, sourceType, sourceId, lines, user = 'system', kind = 'ENGINE' }) {
    const existing = db.prepare("SELECT * FROM fin_journals WHERE company_id = ? AND source_type = ? AND source_id = ? AND kind = 'ENGINE' AND status != 'CANCELLED'").get(companyId, sourceType, String(sourceId));
    if (existing) return { journal: existing, duplicate: true };
    const c = checkLines(companyId, lines, { source: 'ENGINE' });
    if (c.problems.length) throw Object.assign(new HttpError(422, 'POSTING_INVALID', c.problems.map((p) => p.message).join(' ')), { problems: c.problems });
    periodOf(companyId, date);
    return inTx(() => {
      const id = Number(db.prepare(`INSERT INTO fin_journals (company_id, doc_no, voucher_type, voucher_date, kind, narration, total_paise, status, requested_by, approved_by, approved_at, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?, ?)`)
        .run(companyId, draftNo(companyId), voucherType, date, kind, String(narration).slice(0, 500), c.total, user, user, nowIso(), user, sourceType, String(sourceId)).lastInsertRowid);
      insertLines(companyId, id, c.lines, user);
      return { journal: post(db.prepare('SELECT * FROM fin_journals WHERE id = ?').get(id), { user, companyId }), duplicate: false };
    });
  }
  const inTx = (fn) => (db.isTransaction ? fn() : transaction(db, fn));
  /** The engine's own reversal of its journal (a cancelled source document): a mirror posted at once. */
  function reverseEngine(companyId, journalId, { date, reason, user = 'system' }) {
    const r = db.prepare('SELECT * FROM fin_journals WHERE id = ? AND company_id = ?').get(journalId, companyId); if (!r || r.status !== 'APPROVED' || r.reversed_by_id) return null;
    return inTx(() => {
      const on = date && date > r.voucher_date ? date : r.voucher_date; periodOf(companyId, on);
      const nid = Number(db.prepare(`INSERT INTO fin_journals (company_id, doc_no, voucher_type, voucher_date, kind, narration, total_paise, status, reversal_of_id, requested_by, approved_by, approved_at, created_by, source_type, source_id) VALUES (?, ?, ?, ?, 'REVERSAL', ?, ?, 'APPROVED', ?, ?, ?, ?, ?, 'fin_journals', ?)`)
        .run(companyId, draftNo(companyId), r.voucher_type === 'OB' ? 'JV' : r.voucher_type, on, `Reversal of ${r.voucher_no}: ${reason}`.slice(0, 500), r.total_paise, r.id, user, user, nowIso(), user, String(r.id)).lastInsertRowid);
      const lines = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id);
      insertLines(companyId, nid, lines.map((l) => ({ accountId: l.account_id, debit: l.credit_paise, credit: l.debit_paise, narration: l.narration, ...Object.fromEntries(LINE_COLS.map((c) => [c, l[c]])) })), user);
      return post(db.prepare('SELECT * FROM fin_journals WHERE id = ?').get(nid), { user, companyId });
    });
  }

  // ---- FR-03: accruals reverse themselves; recurring templates make journals ----
  const jobs = {
    /** Accruals whose reversal date has come: reversed and posted (the accrual's approval covers its own reversal). */
    autoReverse(today = todayIST()) {
      let n = 0; const errors = [];
      for (const j of db.prepare("SELECT * FROM fin_journals WHERE kind = 'ACCRUAL' AND status = 'APPROVED' AND reversed_by_id IS NULL AND auto_reverse_on IS NOT NULL AND auto_reverse_on <= ?").all(today)) {
        try { reverseEngine(j.company_id, j.id, { date: j.auto_reverse_on, reason: 'accrual reversed on the date it named' }); n += 1; } catch (e) { errors.push(`${j.voucher_no}: ${e.message}`); notify(j.company_id, 'fin.journal.alert', [`user:${j.requested_by}`], j.voucher_no, 'auto-reversal failed', `The accrual ${j.voucher_no} could not reverse itself on ${j.auto_reverse_on}: ${e.message}`, `/finance/journals?id=${j.id}`, j.id); }
      }
      return { reversed: n, errors };
    },
    /** Recurring templates due on or before today: one journal each (drafted and sent for approval in the owner's name); the next date moves on. */
    recurring(today = todayIST()) {
      let n = 0; const errors = [];
      for (const t of db.prepare("SELECT * FROM fin_recurring_journals WHERE rec_status = 'ACTIVE' AND deleted_at IS NULL AND next_run_on <= ?").all(today)) {
        const owner = { user: t.owner_user, companyId: t.company_id, roles: [] };
        try {
          const lines = JSON.parse(t.lines_json); const c = checkLines(t.company_id, lines); if (c.problems.length) throw new Error(c.problems.map((p) => p.message).join(' '));
          periodOf(t.company_id, t.next_run_on);
          transaction(db, () => {
            const id = Number(db.prepare(`INSERT INTO fin_journals (company_id, doc_no, voucher_type, voucher_date, kind, narration, total_paise, recurring_id, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, 'RECURRING', ?, ?, ?, ?, 'system', 'fin_recurring_journals', ?)`)
              .run(t.company_id, draftNo(t.company_id), t.voucher_type, t.next_run_on, `${t.narration} (${t.next_run_on})`.slice(0, 500), c.total, t.id, t.owner_user, String(t.id)).lastInsertRowid);
            insertLines(t.company_id, id, c.lines, 'system');
            const inst = workflowOf(db).submit(owner, { docType: GL_DOC, docId: String(id), comment: `${t.doc_no} ${t.name}`, context: { total: rs(c.total), overCfo: c.total > cfoLimitPaise(t.company_id) ? 1 : 0, kind: 'RECURRING', voucherType: t.voucher_type } });
            db.prepare("UPDATE fin_journals SET status = 'SUBMITTED', workflow_instance_id = ? WHERE id = ?").run(inst.id, id);
            const next = addMonths(t.next_run_on, STEP[t.frequency], t.day_of_month); const ended = t.end_on && next > t.end_on;
            db.prepare("UPDATE fin_recurring_journals SET runs = runs + 1, last_run_on = ?, next_run_on = ?, rec_status = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(t.next_run_on, next, ended ? 'ENDED' : 'ACTIVE', nowIso(), t.id);
            audit({ user: 'system' }, 'fin_recurring_journals', t.id, 'run', t.company_id, { newValues: { journalId: id, date: t.next_run_on } });
          });
          n += 1;
        } catch (e) { errors.push(`${t.doc_no}: ${e.message}`); notify(t.company_id, 'fin.journal.alert', [`user:${t.owner_user}`], t.doc_no, 'recurring journal not made', `The recurring journal ${t.doc_no} ${t.name} could not be made for ${t.next_run_on}: ${e.message}`, `/finance/recurring-journals?id=${t.id}`, t.id); }
      }
      return { made: n, errors };
    },
  };

  const recurring = {
    list(actor, query) { company(actor, 'fin.journal.view', 'see recurring journals'); return runList(db, rcList, parseListRequest(rcList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => recurring.view(actor, r) }); },
    view(actor, r, detail = false) {
      const o = { id: r.id, docNo: r.doc_no, name: r.name, voucherType: r.voucher_type, frequency: r.frequency, frequencyLabel: FREQUENCIES[r.frequency], dayOfMonth: r.day_of_month, nextRunOn: r.next_run_on, endOn: r.end_on, narration: r.narration, total: rs(r.total_paise), status: r.rec_status, runs: r.runs, lastRunOn: r.last_run_on, owner: r.owner_user, version: r.version, can: { edit: may(actor, 'fin.recurring.manage') && r.rec_status !== 'ENDED' } };
      if (detail) Object.assign(o, { lines: JSON.parse(r.lines_json).map((l) => { const a = nameOf.account(Number(l.accountId)); return { ...l, account: a ? `${a.code} ${a.name}` : null }; }), journals: db.prepare('SELECT id, voucher_no, doc_no, voucher_date, status, total_paise FROM fin_journals WHERE recurring_id = ? ORDER BY id DESC LIMIT 24').all(r.id).map((j) => ({ id: j.id, docNo: j.voucher_no ?? j.doc_no, date: j.voucher_date, status: j.status, total: rs(j.total_paise) })) });
      return o;
    },
    get(actor, id) { company(actor, 'fin.journal.view', 'see recurring journals'); const r = db.prepare('SELECT * FROM fin_recurring_journals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That recurring journal does not exist.'); return recurring.view(actor, r, true); },
    save(actor, id, b) {
      company(actor, 'fin.recurring.manage', 'set up recurring journals'); const problems = [];
      if (!VOUCHER_TYPES[b.voucherType] || b.voucherType === 'OB') problems.push({ field: 'voucherType', message: 'Choose the type of voucher.' });
      if (!FREQUENCIES[b.frequency]) problems.push({ field: 'frequency', message: 'Choose how often.' });
      if (b.endOn && b.endOn < b.nextRunOn) problems.push({ field: 'endOn', message: 'The last date is on or after the first.' });
      const c = checkLines(actor.companyId, b.lines); problems.push(...c.problems); fail(problems);
      const day = Math.min(28, Number(b.nextRunOn.slice(8, 10)));
      return transaction(db, () => {
        if (id) {
          const r = db.prepare('SELECT * FROM fin_recurring_journals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That recurring journal does not exist.');
          if (r.rec_status === 'ENDED') throw conflict('An ended recurring journal is not changed.'); if (b.version !== r.version) throw conflict('The recurring journal was changed by someone else; reload it.');
          db.prepare('UPDATE fin_recurring_journals SET name = ?, voucher_type = ?, frequency = ?, day_of_month = ?, next_run_on = ?, end_on = ?, narration = ?, lines_json = ?, total_paise = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name, b.voucherType, b.frequency, day, b.nextRunOn, b.endOn ?? null, b.narration, JSON.stringify(b.lines), c.total, actor.user, nowIso(), r.id);
          audit(actor, 'fin_recurring_journals', r.id, 'update', actor.companyId, { oldValues: { total: rs(r.total_paise), next: r.next_run_on }, newValues: { total: rs(c.total), next: b.nextRunOn } });
          return recurring.get(actor, r.id);
        }
        const n = (db.prepare('SELECT COUNT(*) AS n FROM fin_recurring_journals WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
        const nid = Number(db.prepare("INSERT INTO fin_recurring_journals (company_id, doc_no, name, voucher_type, frequency, day_of_month, next_run_on, end_on, narration, lines_json, total_paise, owner_user, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fin_recurring_journals')")
          .run(actor.companyId, `RJN/${String(n).padStart(6, '0')}`, b.name, b.voucherType, b.frequency, day, b.nextRunOn, b.endOn ?? null, b.narration, JSON.stringify(b.lines), c.total, actor.user, actor.user).lastInsertRowid);
        audit(actor, 'fin_recurring_journals', nid, 'create', actor.companyId, { newValues: { name: b.name, total: rs(c.total), frequency: b.frequency } });
        return recurring.get(actor, nid);
      });
    },
    setStatus(actor, id, { status, reason }) {
      company(actor, 'fin.recurring.manage', 'pause or end recurring journals'); const r = db.prepare('SELECT * FROM fin_recurring_journals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That recurring journal does not exist.');
      if (r.rec_status === 'ENDED') throw conflict('The recurring journal has ended.');
      db.prepare('UPDATE fin_recurring_journals SET rec_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, nowIso(), r.id);
      audit(actor, 'fin_recurring_journals', r.id, status.toLowerCase(), actor.companyId, { reason, oldValues: { status: r.rec_status }, newValues: { status } }); return recurring.get(actor, r.id);
    },
  };

  // ---- FR-05: the ledger of an account and the trial balance ----
  /** The financial year of a date and the dimension filter on the lines. Balances run within the financial year: its opening balances journal carries the previous year (FR-06). */
  function frame(actor, q) {
    company(actor, 'fin.ledger.view', 'see the ledger'); const date = q.to ?? q.asOf ?? todayIST();
    const fy = findFinancialYear(db, actor.companyId, date); if (!fy) throw unprocessable(`No financial year covers ${date}.`);
    const from = q.from && q.from > fy.start_date ? q.from : fy.start_date;
    if (from > date) throw badRequest('Correct the highlighted fields', [{ field: 'from', message: 'The first date is on or before the last.' }]);
    const where = []; const params = { c: actor.companyId, fs: fy.start_date, from, to: date };
    for (const [k, c] of DIMS) if (q[k]) { where.push(`l.${c} = :${k}`); params[k] = Number(q[k]); }
    return { fy, from, to: date, dims: where.length ? ` AND ${where.join(' AND ')}` : '', params };
  }
  const POSTED = "j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL";
  /** The named parameters a statement uses, out of a larger set (node:sqlite refuses a name the statement does not have). */
  const bind = (sql, params) => Object.fromEntries(Object.entries(params).filter(([k]) => new RegExp(`:${k}\\b`).test(sql)));
  const q1 = (sql, params) => db.prepare(sql).get(bind(sql, params));
  const qa = (sql, params) => db.prepare(sql).all(bind(sql, params));
  function ledger(actor, q) {
    const { fy, from, to, dims, params } = frame(actor, q);
    const a = db.prepare('SELECT a.*, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.id = ? AND a.company_id = ? AND a.deleted_at IS NULL').get(Number(q.accountId), actor.companyId);
    if (!a) throw notFound('That account does not exist.');
    const p = { ...params, a: a.id };
    // one pass for the opening balance (from the first day of the year to the day before the first date) and the totals of the dates asked
    const total = q1(`SELECT COALESCE(SUM(CASE WHEN j.voucher_date < :from THEN l.debit_paise - l.credit_paise ELSE 0 END), 0) AS ob, SUM(CASE WHEN j.voucher_date >= :from THEN 1 ELSE 0 END) AS n,
        COALESCE(SUM(CASE WHEN j.voucher_date >= :from THEN l.debit_paise ELSE 0 END), 0) AS dr, COALESCE(SUM(CASE WHEN j.voucher_date >= :from THEN l.credit_paise ELSE 0 END), 0) AS cr
      FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = :c AND l.account_id = :a AND ${POSTED} AND j.voucher_date BETWEEN :fs AND :to${dims}`, p);
    const ob = total.ob; total.n = total.n ?? 0;
    const page = Math.max(1, Number(q.page) || 1); const size = Math.min(500, Math.max(1, Number(q.pageSize) || 100));
    const rows = qa(`SELECT * FROM (SELECT l.*, j.voucher_no, j.voucher_type, j.voucher_date, j.narration AS jn, j.source_type AS jst, j.source_id AS jsi, j.kind,
        SUM(l.debit_paise - l.credit_paise) OVER (ORDER BY j.voucher_date, j.id, l.line_no ROWS UNBOUNDED PRECEDING) AS run
      FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = :c AND l.account_id = :a AND ${POSTED} AND j.voucher_date >= :fs AND j.voucher_date BETWEEN :from AND :to${dims}) ORDER BY voucher_date, journal_id, line_no LIMIT :lim OFFSET :off`, { ...p, lim: size, off: (page - 1) * size });
    const sign = a.normal_side === 'DR' ? 1 : -1;
    const bal = (paiseDrMinusCr) => ({ amount: rs(Math.abs(paiseDrMinusCr)), side: paiseDrMinusCr === 0 ? '' : paiseDrMinusCr > 0 ? 'Dr' : 'Cr', normal: rs(sign * paiseDrMinusCr) });
    const closing = ob + total.dr - total.cr;
    return {
      account: { id: a.id, code: a.code, name: a.name, nature: a.nature, normalBalance: a.normal_side }, fy: { id: fy.id, code: fy.code }, from, to,
      opening: bal(ob), debit: rs(total.dr), credit: rs(total.cr), closing: bal(closing),
      rows: rows.map((r) => ({ lineId: r.id, journalId: r.journal_id, voucherNo: r.voucher_no, voucherType: r.voucher_type, date: r.voucher_date, narration: r.narration ?? r.jn, kind: r.kind, debit: rs(r.debit_paise), credit: rs(r.credit_paise), balance: bal(ob + r.run), source: sourceLink(r.jst, r.jsi), projectId: r.project_id, costCentreId: r.cost_centre_id })),
      page, pageSize: size, totalRows: total.n,
    };
  }
  const PROJECTED = { branchId: 'branch_id', projectId: 'project_id', siteId: 'site_id', costCentreId: 'cost_centre_id' };
  /**
   * The trial balance's sums per account { ob, dr, cr } in paise. Whole months come from the balance projection (fin_balances, written at each posting, BR-02) and only the
   * part-month up to the date from the lines, so a year of 200 000 lines is read in a few hundred rows; a filter on a dimension the projection does not carry, or a first
   * date that is not the start of a month, reads the lines.
   */
  function tbSums(companyId, fy, from, to, q, dims, params) {
    const extra = DIMS.map((d) => d[0]).filter((k) => q[k] && !PROJECTED[k]);
    const periods = db.prepare('SELECT id, start_date, end_date FROM core_periods WHERE company_id = ? AND fy_id = ? ORDER BY start_date').all(companyId, fy.id);
    const full = periods.filter((p) => p.end_date <= to);
    if (extra.length || !periods.some((p) => p.start_date === from)) {
      return qa(`SELECT l.account_id AS id, SUM(CASE WHEN j.voucher_date < :from THEN l.debit_paise - l.credit_paise ELSE 0 END) AS ob, SUM(CASE WHEN j.voucher_date >= :from THEN l.debit_paise ELSE 0 END) AS dr, SUM(CASE WHEN j.voucher_date >= :from THEN l.credit_paise ELSE 0 END) AS cr
        FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = :c AND ${POSTED} AND j.voucher_date BETWEEN :fs AND :to${dims} GROUP BY l.account_id`, params);
    }
    const sums = new Map(); const add = (id, ob, dr, cr) => { const x = sums.get(id) ?? { id, ob: 0, dr: 0, cr: 0 }; x.ob += ob; x.dr += dr; x.cr += cr; sums.set(id, x); };
    if (full.length) {
      const bw = Object.entries(PROJECTED).filter(([k]) => q[k]).map(([k, c]) => ` AND b.${c} = :${k}`).join('');
      for (const r of qa(`SELECT account_id, SUM(CASE WHEN p.end_date < :from THEN b.debit_paise - b.credit_paise ELSE 0 END) AS ob, SUM(CASE WHEN p.end_date >= :from THEN b.debit_paise ELSE 0 END) AS dr, SUM(CASE WHEN p.end_date >= :from THEN b.credit_paise ELSE 0 END) AS cr
        FROM fin_balances b JOIN core_periods p ON p.id = b.period_id WHERE b.company_id = :c AND b.period_id IN (${full.map((p) => p.id).join(',')})${bw} GROUP BY account_id`, params)) add(r.account_id, r.ob, r.dr, r.cr);
    }
    const restFrom = full.length ? addDay(full.at(-1).end_date) : fy.start_date;
    if (restFrom <= to) for (const r of qa(`SELECT l.account_id AS id, SUM(CASE WHEN j.voucher_date < :from THEN l.debit_paise - l.credit_paise ELSE 0 END) AS ob, SUM(CASE WHEN j.voucher_date >= :from THEN l.debit_paise ELSE 0 END) AS dr, SUM(CASE WHEN j.voucher_date >= :from THEN l.credit_paise ELSE 0 END) AS cr
        FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = :c AND ${POSTED} AND j.voucher_date BETWEEN :rest AND :to${dims} GROUP BY l.account_id`, { ...params, rest: restFrom })) add(r.id, r.ob, r.dr, r.cr);
    return [...sums.values()];
  }
  function trialBalance(actor, q) {
    const { fy, from, to, dims, params } = frame(actor, { ...q, to: q.asOf ?? q.to });
    const sums = tbSums(actor.companyId, fy, from, to, q, dims, params);
    const meta = new Map(db.prepare('SELECT a.id, a.code, a.name, a.normal_side, g.nature, g.code AS gcode, g.name AS gname FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id = ?').all(actor.companyId).map((a) => [a.id, a]));
    const rows = sums.map((x) => ({ ...meta.get(x.id), ob: x.ob, dr: x.dr, cr: x.cr })).filter((r) => r.code).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const out = rows.map((r) => { const cl = r.ob + r.dr - r.cr; return { accountId: r.id, code: r.code, name: r.name, nature: r.nature, group: `${r.gcode} ${r.gname}`, openingDebit: rs(Math.max(r.ob, 0)), openingCredit: rs(Math.max(-r.ob, 0)), debit: rs(r.dr), credit: rs(r.cr), closingDebit: rs(Math.max(cl, 0)), closingCredit: rs(Math.max(-cl, 0)) }; }).filter((r) => r.openingDebit || r.openingCredit || r.debit || r.credit);
    const sum = (k) => rs(out.reduce((a, r) => a + paise(r[k]), 0));
    const totals = { openingDebit: sum('openingDebit'), openingCredit: sum('openingCredit'), debit: sum('debit'), credit: sum('credit'), closingDebit: sum('closingDebit'), closingCredit: sum('closingCredit') };
    const byNature = {}; for (const r of out) { byNature[r.nature] ??= 0; byNature[r.nature] += paise(r.closingDebit) - paise(r.closingCredit); }
    return { fy: { id: fy.id, code: fy.code, startDate: fy.start_date, endDate: fy.end_date }, from, asOf: to, rows: out, totals, balanced: totals.closingDebit === totals.closingCredit && totals.debit === totals.credit, byNature: Object.entries(byNature).map(([nature, p]) => ({ nature, amount: rs(Math.abs(p)), side: p >= 0 ? 'Dr' : 'Cr' })) };
  }
  function exportTb(actor, q) {
    company(actor, 'fin.journal.export', 'export the trial balance'); const tb = trialBalance(actor, q);
    const rows = tb.rows.map((r) => [r.code, r.name, r.group, r.openingDebit, r.openingCredit, r.debit, r.credit, r.closingDebit, r.closingCredit]);
    rows.push(['', 'Total', '', tb.totals.openingDebit, tb.totals.openingCredit, tb.totals.debit, tb.totals.credit, tb.totals.closingDebit, tb.totals.closingCredit]);
    audit(actor, 'fin_journals', 0, 'export', actor.companyId, { reason: `trial balance ${tb.asOf}` });
    return { contentType: 'text/csv; charset=utf-8', fileName: `trial-balance-${tb.asOf}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Account', 'Name', 'Group', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'], rows)}`, 'utf8') };
  }
  function exportLedger(actor, q) {
    company(actor, 'fin.journal.export', 'export the ledger'); const l = ledger(actor, { ...q, page: 1, pageSize: 500 });
    const rows = [['', '', 'Opening balance', '', '', `${l.opening.amount} ${l.opening.side}`], ...l.rows.map((r) => [r.date, r.voucherNo, r.narration, r.debit || '', r.credit || '', `${r.balance.amount} ${r.balance.side}`])];
    audit(actor, 'fin_journals', 0, 'export', actor.companyId, { reason: `ledger ${l.account.code} ${l.from}..${l.to}` });
    return { contentType: 'text/csv; charset=utf-8', fileName: `ledger-${l.account.code}-${l.to}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Date', 'Voucher', 'Narration', 'Debit', 'Credit', 'Balance'], rows)}`, 'utf8') };
  }

  /** FR-06: the balances of the year carried to the next as an opening balances journal (a draft, approved like any other): assets, liabilities and equity by account and branch; the profit or loss to retained earnings. */
  function carryForward(actor, { fyId }) {
    company(actor, 'fin.journal.create', 'carry balances forward');
    const fy = db.prepare('SELECT * FROM core_financial_years WHERE id = ? AND company_id = ?').get(Number(fyId), actor.companyId); if (!fy) throw notFound('That financial year does not exist.');
    const next = db.prepare('SELECT * FROM core_financial_years WHERE company_id = ? AND start_date > ? ORDER BY start_date LIMIT 1').get(actor.companyId, fy.end_date);
    if (!next) throw unprocessable(`The financial year after ${fy.code} is not set up; ask the System Administrator to create it first.`);
    if (db.prepare("SELECT 1 FROM fin_journals WHERE company_id = ? AND kind = 'OPENING' AND voucher_date = ? AND status NOT IN ('CANCELLED', 'REJECTED') AND source_type = 'core_financial_years'").get(actor.companyId, next.start_date)) throw conflict(`The balances of ${fy.code} are already carried forward to ${next.code}; reverse that journal first to carry them again.`);
    const rows = db.prepare(`SELECT l.account_id, l.branch_id, g.nature, SUM(l.debit_paise - l.credit_paise) AS b FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id
      WHERE l.company_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? GROUP BY l.account_id, l.branch_id, g.nature HAVING b != 0`).all(actor.companyId, fy.start_date, fy.end_date);
    const lines = []; let pl = 0;
    for (const r of rows) { if (['INCOME', 'EXPENSE'].includes(r.nature)) { pl += r.b; continue; } lines.push({ accountId: r.account_id, branchId: r.branch_id, debit: r.b > 0 ? rs(r.b) : null, credit: r.b < 0 ? rs(-r.b) : null, narration: `Balance of ${fy.code}` }); }
    if (pl !== 0) {
      const code = String(param(actor.companyId, 'fin.gl.retained_earnings') || '');
      const re = (code ? db.prepare("SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL AND account_status = 'ACTIVE'").get(actor.companyId, code) : null) ?? db.prepare("SELECT a.id FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id = ? AND g.nature = 'EQUITY' AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE' ORDER BY a.code LIMIT 1").get(actor.companyId);
      if (!re) throw unprocessable('No equity account to carry the profit or loss to; set fin.gl.retained_earnings or open an equity account.');
      lines.push({ accountId: re.id, debit: pl > 0 ? rs(pl) : null, credit: pl < 0 ? rs(-pl) : null, narration: `${pl < 0 ? 'Profit' : 'Loss'} of ${fy.code}` });
    }
    if (lines.length < 2) throw unprocessable(`Nothing to carry forward: ${fy.code} has no posted balances.`);
    return journals.create(actor, { voucherType: 'OB', voucherDate: next.start_date, kind: 'OPENING', narration: `Opening balances of ${next.code} carried from ${fy.code}`, lines, sourceType: 'core_financial_years', sourceId: fy.id });
  }

  /** BR-02: the balance projection against the sum of the posted lines, per account and period: the differences (none when the books are whole). */
  function integrity(actor) {
    company(actor, 'fin.ledger.view', 'check the ledger');
    const diff = db.prepare(`SELECT k.account_id, k.period_id, COALESCE(b.dr, 0) AS bdr, COALESCE(b.cr, 0) AS bcr, COALESCE(s.dr, 0) AS ldr, COALESCE(s.cr, 0) AS lcr FROM
      (SELECT account_id, period_id FROM fin_balances WHERE company_id = :c UNION SELECT l.account_id, j.period_id FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = :c AND ${POSTED}) k
      LEFT JOIN (SELECT account_id, period_id, SUM(debit_paise) AS dr, SUM(credit_paise) AS cr FROM fin_balances WHERE company_id = :c GROUP BY account_id, period_id) b ON b.account_id = k.account_id AND b.period_id = k.period_id
      LEFT JOIN (SELECT l.account_id, j.period_id, SUM(l.debit_paise) AS dr, SUM(l.credit_paise) AS cr FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = :c AND ${POSTED} GROUP BY l.account_id, j.period_id) s ON s.account_id = k.account_id AND s.period_id = k.period_id
      WHERE COALESCE(b.dr, 0) != COALESCE(s.dr, 0) OR COALESCE(b.cr, 0) != COALESCE(s.cr, 0)`).all({ c: actor.companyId });
    const unbalanced = db.prepare(`SELECT j.id, j.voucher_no FROM fin_journals j JOIN fin_journal_lines l ON l.journal_id = j.id AND l.deleted_at IS NULL WHERE j.company_id = ? AND j.status = 'APPROVED' GROUP BY j.id HAVING SUM(l.debit_paise) != SUM(l.credit_paise)`).all(actor.companyId);
    return { ok: !diff.length && !unbalanced.length, differences: diff.map((d) => ({ accountId: d.account_id, periodId: d.period_id, projection: { debit: rs(d.bdr), credit: rs(d.bcr) }, lines: { debit: rs(d.ldr), credit: rs(d.lcr) } })), unbalanced };
  }

  /** What other modules see of an account's postings (06.05 BR-02: an account with postings keeps its nature and is not deleted). */
  const postingsOf = (companyId, accountId) => db.prepare("SELECT COUNT(*) AS n FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = ? AND l.account_id = ? AND j.status IN ('APPROVED', 'SUBMITTED') AND l.deleted_at IS NULL").get(companyId, accountId).n;

  return { journals, recurring, jobs, ledger, trialBalance, exportTb, exportLedger, carryForward, integrity, postEngine, reverseEngine, checkLines, postingsOf, view: fresh };
}

export { same };
