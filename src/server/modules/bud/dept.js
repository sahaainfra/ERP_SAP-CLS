import { transaction } from '../../platform/db/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { ALLOC_BASIS, DEPT_DOC, DEPT_STATUS, GL_EVENT_FAMILY, POOL_SOURCE, RULE_STATUS, RUN_STATUS, cell, esc, json, nowIso, profileWeights, rid, rupees, same, signed, splitBy } from './constants.js';
import { allocateByWeights, poolsOverlap, sharesOf } from './alloc.js';
import { budOf } from './budgets.js';

// Head-office and department overhead budgets (part 12.04). A department head prepares the budget of a cost centre for a financial year by GL account and month; it goes to the department head, the CFO and the director (all configurable), is locked
// when approved and changes only by a new version that is compared with the one in force. Actual cost arrives from the general ledger (part 23 publishes it; until then the ingest endpoint takes it) and the report sets it against the budget by cost
// centre, account and month. An overhead pool (the approved budget or the actual cost of chosen cost centres and accounts for a range of months) is shared over the projects by a rule (by revenue, by direct cost or by fixed percentages) and the shares
// add up to the pool exactly (BR-01); part 23.10 reads them as the overhead pool of each project.
const CC_DEPT = "CASE WHEN c.linked_type = 'DEPARTMENT' THEN c.linked_id END";
export const deptList = defineList({
  code: 'bud.dept_budgets', label: 'Department budgets', permission: 'bud.dept_budget.view',
  from: 'bud_dept_budgets x JOIN org_cost_centres c ON c.id = x.cost_centre_id JOIN core_financial_years f ON f.id = x.fy_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.name', 'c.code', 'c.name'], defaultSort: '-docDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Budget no.' }, name: { sql: 'x.name', type: 'text', label: 'Name' }, costCentre: { sql: 'c.code', type: 'text', label: 'Cost centre' }, costCentreId: { sql: 'x.cost_centre_id', type: 'number', label: 'Cost centre id' },
    fy: { sql: 'f.code', type: 'text', label: 'Financial year' }, fyId: { sql: 'x.fy_id', type: 'number', label: 'Financial year id' }, docDate: { sql: 'x.doc_date', type: 'date', label: 'Date' }, versionNo: { sql: 'x.version_no', type: 'number', label: 'Version' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(DEPT_STATUS) }, total: { sql: 'x.total_amount', type: 'number', label: 'Budget total' }, requestedBy: { sql: 'x.requested_by', type: 'text', label: 'Prepared by' },
  },
});

export function createDeptService({ db, base }) {
  const { fail, audit, currentOf, orgOf } = base;
  const authz = authzOf(db);
  const system = (companyId) => ({ user: 'system', companyId, roles: ['SYSTEM'] });
  /** May the actor do `key` for a department (or, with no department, for the whole company)? A cost centre without a department is company-level: only a company-wide grant reaches it. */
  const may = (actor, key, departmentId = null) => authz.check(actor, key, { companyId: actor.companyId, ...(departmentId != null ? { departmentId } : {}) }).allowed;
  const need = (actor, key, what, departmentId = null) => { if (!may(actor, key, departmentId)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const anywhere = (actor, key, what) => { if (!authz.check(actor, key).allowed) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const event = (type, actor, id, companyId, data, entity = 'bud_dept_budget') => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId: null, data });
  const notify = (companyId, code, users, ref, subject, detail, link, sourceId) => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId }); } catch { /* the record is still saved */ } };
  const numberFor = (actor, docType, table, prefix, width) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType, actor: actor.user, refType: table }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(actor.companyId).n ?? 0) + 1; return `${prefix}/${String(n).padStart(width, '0')}`;
  };
  const fresh = (id) => db.prepare('SELECT * FROM bud_dept_budgets WHERE id = ?').get(id);

  // ---- masters ---------------------------------------------------------------------------------------------------------------------------------------------------------
  const fyRow = (companyId, id) => db.prepare('SELECT * FROM core_financial_years WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId);
  const periodsOf = (fyId) => db.prepare('SELECT id, period_no, name, start_date, end_date FROM core_periods WHERE fy_id = ? AND deleted_at IS NULL ORDER BY period_no').all(fyId);
  const ccRow = (companyId, id) => db.prepare(`SELECT c.*, ${CC_DEPT} AS dept_id, d.name AS dept_name FROM org_cost_centres c LEFT JOIN org_departments d ON d.id = (${CC_DEPT}) WHERE c.id = ? AND c.company_id = ? AND c.deleted_at IS NULL`).get(id, companyId);
  const ccUsable = (c) => Boolean(c) && c.type === 'COST' && c.status === 'ACTIVE' && (c.linked_type == null || c.linked_type === 'DEPARTMENT');
  const accountRow = (companyId, id) => db.prepare('SELECT a.id, a.code, a.name, a.account_status, a.is_control, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.id = ? AND (a.company_id IS NULL OR a.company_id = ?) AND a.deleted_at IS NULL').get(id, companyId);
  const accountUsable = (a) => Boolean(a) && a.nature === 'EXPENSE' && a.account_status === 'ACTIVE' && !a.is_control;
  const deptHeadOf = (departmentId) => {
    if (!departmentId) return null;
    const a = db.prepare("SELECT u.username FROM org_assignments a JOIN iam_users u ON u.id = a.user_id WHERE a.entity_type = 'DEPARTMENT' AND a.entity_id = ? AND a.role = 'HEAD' AND a.is_active = 1 AND a.applied = 1 AND a.effective_from <= date('now') AND (a.effective_to IS NULL OR a.effective_to >= date('now')) ORDER BY a.effective_from DESC LIMIT 1").get(departmentId);
    if (a) return a.username;
    return db.prepare('SELECT u.username FROM org_departments d JOIN iam_users u ON u.id = d.head_user_id WHERE d.id = ?').get(departmentId)?.username ?? null;
  };

  // ---- the lines: accounts x the twelve months of the year --------------------------------------------------------------------------------------------------------------
  /** BR: the amounts come in rupees per account and month; whole paise only; each account once; expense accounts only. The total is worked out here, a total sent by the client must agree with it. */
  function evaluate(actor, periods, b) {
    const p = []; const seen = new Set(); const accounts = [];
    (b.lines ?? []).forEach((l, i) => {
      const f = (field, message) => p.push({ field: `lines.${i}.${field}`, message });
      const a = accountRow(actor.companyId, l.accountId);
      if (!accountUsable(a)) { f('accountId', 'Choose an active expense account of the chart of accounts'); return; }
      if (seen.has(a.id)) { f('accountId', 'An account is given twice: put all its months on one line'); return; } seen.add(a.id);
      if (l.months.length !== periods.length) { f('months', `The financial year has ${periods.length} months`); return; }
      accounts.push({ account: a, note: l.note ?? null, months: l.months.map((m) => Math.round(Number(m) * 100)) });
    });
    const total = accounts.reduce((s, a) => s + a.months.reduce((x, y) => x + y, 0), 0);
    if (b.total != null && Math.round(Number(b.total) * 100) !== total) p.push({ field: 'total', message: `The total given (₹ ${Number(b.total).toFixed(2)}) differs from the lines (₹ ${rupees(total)}): totals are worked out by the server` });
    return { problems: p, accounts, total };
  }
  function writeLines(actor, budget, periods, e) {
    const now = nowIso();
    db.prepare('UPDATE bud_dept_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE budget_id = ? AND deleted_at IS NULL').run(now, actor.user, budget.id);
    const ins = db.prepare("INSERT INTO bud_dept_lines (company_id, budget_id, account_id, period_id, amount, note, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')");
    e.accounts.forEach((a, i) => a.months.forEach((m, k) => ins.run(budget.company_id, budget.id, a.account.id, periods[k].id, m, a.note, i + 1, actor.user)));
    retotal(budget.id);
  }
  function retotal(budgetId) {
    const t = db.prepare('SELECT COALESCE(SUM(amount), 0) AS a, COUNT(DISTINCT account_id) AS n FROM bud_dept_lines WHERE budget_id = ? AND deleted_at IS NULL').get(budgetId);
    db.prepare('UPDATE bud_dept_budgets SET total_amount = ?, lines_count = ? WHERE id = ?').run(t.a, t.n, budgetId);
  }
  function linesOut(budgetId, periods) {
    const rows = db.prepare('SELECT l.account_id, l.period_id, l.amount, l.note, a.code, a.name FROM bud_dept_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.budget_id = ? AND l.deleted_at IS NULL ORDER BY a.code, l.period_id').all(budgetId);
    const idx = new Map(periods.map((p, i) => [p.id, i])); const by = new Map();
    for (const r of rows) {
      let g = by.get(r.account_id); if (!g) { g = { accountId: r.account_id, accountCode: r.code, accountName: r.name, note: r.note, paise: Array(periods.length).fill(0) }; by.set(r.account_id, g); }
      g.paise[idx.get(r.period_id)] = r.amount;
    }
    return [...by.values()].map((g) => ({ accountId: g.accountId, accountCode: g.accountCode, accountName: g.accountName, note: g.note, months: g.paise.map(rupees), total: rupees(g.paise.reduce((a, b) => a + b, 0)), paise: g.paise }));
  }
  const monthTotals = (lines, n) => Array.from({ length: n }, (_, k) => lines.reduce((s, l) => s + l.paise[k], 0));

  // ---- one budget, as the pages and the API see it ----------------------------------------------------------------------------------------------------------------------
  function row(actor, id, key = 'bud.dept_budget.view') {
    const r = db.prepare('SELECT * FROM bud_dept_budgets WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'bud.dept_budget.view', r.department_id)) throw notFound('That department budget does not exist.');
    if (key !== 'bud.dept_budget.view') need(actor, key, 'do that with a department budget', r.department_id);
    return r;
  }
  const openOf = (r) => db.prepare("SELECT doc_no FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND id <> ? AND deleted_at IS NULL").get(r.company_id, r.fy_id, r.cost_centre_id, r.id);
  function view(actor, r, { detail = false } = {}) {
    const fy = db.prepare('SELECT id, code, start_date, end_date, status FROM core_financial_years WHERE id = ?').get(r.fy_id); const cc = ccRow(r.company_id, r.cost_centre_id); const can = (k) => may(actor, k, r.department_id); const editable = ['DRAFT', 'RETURNED'].includes(r.status);
    const v = {
      id: r.id, docNo: r.doc_no, docDate: r.doc_date, fyId: r.fy_id, fy: fy?.code, costCentreId: r.cost_centre_id, costCentreCode: cc?.code, costCentreName: cc?.name, departmentId: r.department_id, department: cc?.dept_name ?? null, name: r.name, versionNo: r.version_no, vtype: r.vtype,
      status: r.status, statusLabel: DEPT_STATUS[r.status], total: rupees(r.total_amount), linesCount: r.lines_count, parentBudgetId: r.parent_budget_id, reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, lockedAt: r.locked_at,
      workflowInstanceId: r.workflow_instance_id, rowVersion: r.version, inForce: r.status === 'APPROVED',
      can: {
        edit: can('bud.dept_budget.edit') && editable, submit: can('bud.dept_budget.submit') && editable && r.total_amount > 0, withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('bud.dept_budget.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status),
        delete: can('bud.dept_budget.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, amend: can('bud.dept_budget.amend') && ['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status) && !openOf(r), print: can('bud.dept_budget.print'), export: can('bud.dept_budget.export'),
      },
    };
    if (detail) {
      const periods = periodsOf(r.fy_id); const lines = linesOut(r.id, periods);
      v.periods = periods.map((p) => ({ id: p.id, periodNo: p.period_no, name: p.name }));
      v.lines = lines.map((l) => ({ accountId: l.accountId, accountCode: l.accountCode, accountName: l.accountName, note: l.note, months: l.months, total: l.total })); v.monthTotals = monthTotals(lines, periods.length).map(rupees);
      const spent = db.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM bud_dept_actuals WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status = 'POSTED'").get(r.company_id, r.fy_id, r.cost_centre_id).a;
      v.actualToDate = rupees(spent);
      const open = openOf(r); v.openVersion = open ? open.doc_no : null;
      const parent = r.parent_budget_id ? fresh(r.parent_budget_id) : null; v.parent = parent ? { id: parent.id, docNo: parent.doc_no, versionNo: parent.version_no, total: rupees(parent.total_amount) } : null;
    }
    return v;
  }
  const costCentreFacts = (actor, b) => {
    const p = []; const fy = fyRow(actor.companyId, b.fyId); const cc = ccRow(actor.companyId, b.costCentreId);
    if (!fy) p.push({ field: 'fyId', message: 'Choose a financial year of the company' }); else if (fy.status !== 'Open') p.push({ field: 'fyId', message: `Financial year ${fy.code} is closed` });
    if (!ccUsable(cc)) p.push({ field: 'costCentreId', message: 'Choose an active cost centre of a department (not of a project or a site)' });
    fail(p); return { fy, cc };
  };

  const budgets = {
    list(actor, query) {
      anywhere(actor, 'bud.dept_budget.view', 'see department budgets'); const f = authz.scopeFilter(actor, 'bud.dept_budget.view', { department: 'x.department_id' });
      return runList(db, deptList, parseListRequest(deptList, query), { select: 'x.*', scopeSql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) }, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, name: v.name, costCentre: v.costCentreCode, costCentreName: v.costCentreName, fy: v.fy, fyId: v.fyId, docDate: v.docDate, versionNo: v.versionNo, status: v.status, statusLabel: v.statusLabel, total: v.total, requestedBy: v.requestedBy }; } });
    },
    exportSource(actor, req) {
      anywhere(actor, 'bud.dept_budget.export', 'export department budgets'); const f = authz.scopeFilter(actor, 'bud.dept_budget.export', { department: 'x.department_id' }); const opts = { select: 'x.*', scopeSql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) }, tieBreaker: 'x.id' };
      return {
        title: deptList.label, permission: 'bud.dept_budget.export', personal: false,
        columns: [{ key: 'docNo', label: 'Budget no.', type: 'text' }, { key: 'fy', label: 'Financial year', type: 'text' }, { key: 'costCentre', label: 'Cost centre', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'versionNo', label: 'Version', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'total', label: 'Budget total', type: 'text' }, { key: 'requestedBy', label: 'Prepared by', type: 'text' }],
        rows: () => runList(db, deptList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, fy: v.fy, costCentre: `${v.costCentreCode} ${v.costCentreName}`, name: v.name, versionNo: String(v.versionNo), status: v.statusLabel, total: v.total, requestedBy: v.requestedBy ?? '' }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All department budgets you may see'], count: () => countList(db, deptList, req, opts),
      };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    /** What the workbench offers: the financial years with their months, the cost centres the person may prepare a budget for, and the expense accounts. */
    options(actor) {
      anywhere(actor, 'bud.dept_budget.view', 'see department budgets');
      const fys = db.prepare('SELECT id, code, start_date, end_date, status FROM core_financial_years WHERE company_id = ? AND deleted_at IS NULL ORDER BY start_date DESC').all(actor.companyId).map((f) => ({ id: f.id, code: f.code, startDate: f.start_date, endDate: f.end_date, status: f.status, periods: periodsOf(f.id).map((p) => ({ id: p.id, periodNo: p.period_no, name: p.name })) }));
      const costCentres = db.prepare(`SELECT c.id, c.code, c.name, ${CC_DEPT} AS dept_id FROM org_cost_centres c WHERE c.company_id = ? AND c.deleted_at IS NULL AND c.type = 'COST' AND c.status = 'ACTIVE' AND (c.linked_type IS NULL OR c.linked_type = 'DEPARTMENT') ORDER BY c.code`).all(actor.companyId)
        .filter((c) => may(actor, 'bud.dept_budget.view', c.dept_id)).map((c) => ({ id: c.id, code: c.code, name: c.name, departmentId: c.dept_id, canPrepare: may(actor, 'bud.dept_budget.create', c.dept_id) }));
      const accounts = db.prepare("SELECT a.id, a.code, a.name FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE (a.company_id IS NULL OR a.company_id = ?) AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE' AND a.is_control = 0 AND g.nature = 'EXPENSE' ORDER BY a.code").all(actor.companyId);
      return { fys, costCentres, accounts };
    },
    /** FR-01: the monthly phasing of a yearly amount, worked out here: an even spread or a profile; the months add up to the total exactly. */
    spread(actor, { total, profile }) {
      anywhere(actor, 'bud.dept_budget.create', 'prepare department budgets');
      const parts = splitBy(Math.round(total * 100), profileWeights(profile, 12).map((w) => Math.round(w * 1e9)));
      return { profile, total: rupees(Math.round(total * 100)), months: parts.map(rupees) };
    },
    create(actor, b) {
      const { fy, cc } = costCentreFacts(actor, b); need(actor, 'bud.dept_budget.create', 'prepare a budget for this cost centre', cc.dept_id);
      const periods = periodsOf(fy.id); const e = evaluate(actor, periods, b); fail(e.problems);
      const approved = db.prepare("SELECT doc_no FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(actor.companyId, fy.id, cc.id);
      if (approved) throw conflict(`${approved.doc_no} is approved for ${cc.code} in ${fy.code}: it is changed by a new version (amend), not a new budget.`);
      const open = db.prepare("SELECT doc_no FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(actor.companyId, fy.id, cc.id);
      if (open) throw conflict(`${open.doc_no} is open for ${cc.code} in ${fy.code}: finish or cancel it first.`);
      return transaction(db, () => {
        const vno = (db.prepare('SELECT MAX(version_no) AS n FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND deleted_at IS NULL').get(actor.companyId, fy.id, cc.id).n ?? 0) + 1;
        const id = Number(db.prepare("INSERT INTO bud_dept_budgets (company_id, doc_no, doc_date, fy_id, cost_centre_id, department_id, version_no, vtype, name, status, reason, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'ORIGINAL', ?, 'DRAFT', ?, ?, ?, 'api')")
          .run(actor.companyId, numberFor(actor, DEPT_DOC, 'bud_dept_budgets', 'DEB', 5), todayIST(), fy.id, cc.id, cc.dept_id ?? null, vno, b.name ?? `${cc.code} ${cc.name} budget ${fy.code}`, b.reason ?? null, actor.user, actor.user).lastInsertRowid);
        writeLines(actor, fresh(id), periods, e); audit(actor, 'bud_dept_budgets', id, 'create', actor.companyId, { newValues: { fy: fy.code, costCentre: cc.code, total: rupees(e.total) } });
        return budgets.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'bud.dept_budget.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`${r.doc_no} is ${DEPT_STATUS[r.status].toLowerCase()}: it is not edited now.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this budget; reload it.');
      const periods = periodsOf(r.fy_id); const e = b.lines ? evaluate(actor, periods, b) : null; if (e) fail(e.problems);
      else if (b.total != null && Math.round(Number(b.total) * 100) !== r.total_amount) fail([{ field: 'total', message: `The total given differs from the budget (₹ ${rupees(r.total_amount)}): totals are worked out by the server` }]);
      return transaction(db, () => {
        const sets = []; const vals = []; for (const [k, c] of [['name', 'name'], ['reason', 'reason']]) if (k in b) { sets.push(`${c} = ?`); vals.push(b[k]); }
        db.prepare(`UPDATE bud_dept_budgets SET ${[...sets, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
        if (e) writeLines(actor, r, periods, e); audit(actor, 'bud_dept_budgets', r.id, 'update', r.company_id, { newValues: { total: rupees(fresh(r.id).total_amount) } }); return budgets.get(actor, r.id);
      });
    },
    remove(actor, id) {
      const r = row(actor, id, 'bud.dept_budget.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.');
      transaction(db, () => { const now = nowIso(); db.prepare('UPDATE bud_dept_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE budget_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE bud_dept_budgets SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'bud_dept_budgets', r.id, 'delete', r.company_id); });
      return { id: r.id, deleted: true };
    },
    /** The budget is recomputed on the server and must be worth sending: at least one amount, an open financial year; then it goes to the department head, the CFO and the director. */
    submit(actor, id) {
      const r = row(actor, id, 'bud.dept_budget.submit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or a returned budget is sent for approval.');
      const fy = fyRow(r.company_id, r.fy_id); if (!fy || fy.status !== 'Open') throw unprocessable(`Financial year ${fy?.code ?? ''} is closed: no budget is sent for it.`);
      retotal(r.id); const cur = fresh(r.id); if (cur.total_amount <= 0) throw unprocessable('The budget has no amount: give at least one account and month.');
      return transaction(db, () => {
        const ctx = { costCentreId: r.cost_centre_id, departmentId: r.department_id, amount: Number(rupees(cur.total_amount)) };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: DEPT_DOC, docId: String(r.id), comment: `${r.doc_no} ${r.name}`.slice(0, 300), context: ctx }); db.prepare('UPDATE bud_dept_budgets SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE bud_dept_budgets SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id);
        audit(actor, 'bud_dept_budgets', r.id, 'submit', r.company_id, { newValues: { total: rupees(cur.total_amount) } }); return budgets.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a budget waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return budgets.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'bud.dept_budget.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a budget that is not decided is cancelled; an approved budget is changed by a new version.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE bud_dept_budgets SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'bud_dept_budgets', r.id, 'cancel', r.company_id, { reason }); return budgets.get(actor, r.id); });
    },
    /** An approved budget is changed by a new version (a draft copy, compared with the one in force and approved again); a rejected or cancelled one is raised again the same way. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'bud.dept_budget.amend'); if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) throw unprocessable('Only an approved, rejected or cancelled budget is amended.');
      const open = openOf(r); if (open) throw conflict(`${open.doc_no} is open for this cost centre and year: finish or cancel it first.`);
      const fy = fyRow(r.company_id, r.fy_id); if (!fy || fy.status !== 'Open') throw unprocessable(`Financial year ${fy?.code ?? ''} is closed.`);
      return transaction(db, () => {
        const inForce = db.prepare("SELECT * FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(r.company_id, r.fy_id, r.cost_centre_id);
        const vno = (db.prepare('SELECT MAX(version_no) AS n FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND deleted_at IS NULL').get(r.company_id, r.fy_id, r.cost_centre_id).n ?? 0) + 1;
        const nid = Number(db.prepare("INSERT INTO bud_dept_budgets (company_id, doc_no, doc_date, fy_id, cost_centre_id, department_id, version_no, vtype, name, status, parent_budget_id, reason, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'bud_dept_budget', ?)")
          .run(r.company_id, numberFor(actor, DEPT_DOC, 'bud_dept_budgets', 'DEB', 5), todayIST(), r.fy_id, r.cost_centre_id, r.department_id, vno, inForce || r.vtype === 'REVISED' ? 'REVISED' : 'ORIGINAL', r.name, (inForce ?? r).id, reason, actor.user, actor.user, String(r.id)).lastInsertRowid);
        db.prepare("INSERT INTO bud_dept_lines (company_id, budget_id, account_id, period_id, amount, note, sort_order, created_by, source_type) SELECT company_id, ?, account_id, period_id, amount, note, sort_order, ?, 'bud_dept_budget' FROM bud_dept_lines WHERE budget_id = ? AND deleted_at IS NULL").run(nid, actor.user, r.id);
        retotal(nid); audit(actor, 'bud_dept_budgets', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } });
        if (r.status === 'APPROVED') event('bud.dept_budget.revision_started', actor, nid, r.company_id, { budgetId: nid, parentBudgetId: r.id, fyId: r.fy_id, costCentreId: r.cost_centre_id, versionNo: vno, reason });
        return budgets.get(actor, nid);
      });
    },
    /** Amendment comparison: the budget against the one it revises (or any other version of the same cost centre and year), by account and month. */
    compare(actor, id, withId) {
      const r = row(actor, id); const otherId = withId ?? r.parent_budget_id; const o = otherId ? db.prepare('SELECT * FROM bud_dept_budgets WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(otherId, r.company_id) : null;
      if (otherId && (!o || o.fy_id !== r.fy_id || o.cost_centre_id !== r.cost_centre_id)) throw notFound('That version does not exist for this cost centre and year.');
      const periods = periodsOf(r.fy_id); const A = o ? linesOut(o.id, periods) : []; const B = linesOut(r.id, periods); const rows = new Map();
      const put = (l, side) => { const g = rows.get(l.accountId) ?? { accountId: l.accountId, code: l.accountCode, name: l.accountName, before: Array(periods.length).fill(0), after: Array(periods.length).fill(0) }; g[side] = l.paise; rows.set(l.accountId, g); };
      A.forEach((l) => put(l, 'before')); B.forEach((l) => put(l, 'after'));
      const out = [...rows.values()].map((g) => { const b = g.before.reduce((a, x) => a + x, 0); const a = g.after.reduce((s, x) => s + x, 0); return { accountId: g.accountId, code: g.code, name: g.name, before: rupees(b), after: rupees(a), delta: signed(a - b), deltaPaise: a - b, months: g.after.map((x, k) => ({ before: rupees(g.before[k]), after: rupees(x), delta: signed(x - g.before[k]) })), changed: a !== b || g.after.some((x, k) => x !== g.before[k]) }; }).sort((x, y) => x.code.localeCompare(y.code));
      return { from: o ? { id: o.id, docNo: o.doc_no, versionNo: o.version_no, status: o.status, total: rupees(o.total_amount) } : null, to: { id: r.id, docNo: r.doc_no, versionNo: r.version_no, status: r.status, total: rupees(r.total_amount) }, totalBefore: rupees(o?.total_amount ?? 0), totalAfter: rupees(r.total_amount), totalDelta: signed(r.total_amount - (o?.total_amount ?? 0)), rows: out, changedRows: out.filter((x) => x.changed).length, periods: periods.map((p) => ({ periodNo: p.period_no, name: p.name })) };
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'bud_dept_budgets' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'bud.dept_budget.print'); const v = view(actor, r, { detail: true }); const company = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? '';
      const tr = (cells, h = false) => `<tr>${cells.map((c) => `<${h ? 'th' : 'td'}>${esc(c)}</${h ? 'th' : 'td'}>`).join('')}</tr>`;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED BUDGET</strong></p>`}<h1>${esc(company)}</h1><h2>Department budget ${esc(v.docNo)} · ${esc(v.costCentreCode)} ${esc(v.costCentreName)} · ${esc(v.fy)}</h2>`
        + `<p>Version ${v.versionNo} (${esc(v.vtype === 'ORIGINAL' ? 'original' : 'revised')}) · ${esc(v.name)} · prepared by ${esc(v.requestedBy ?? '')}${v.approvedBy ? ` · approved by ${esc(v.approvedBy)} on ${esc(String(v.approvedAt).slice(0, 10))}` : ''}</p>${v.reason ? `<p>${esc(v.reason)}</p>` : ''}`
        + `<table border="1" cellpadding="3">${tr(['Account', ...v.periods.map((p) => p.name), 'Total (₹)'], true)}${v.lines.map((l) => tr([`${l.accountCode} ${l.accountName}`, ...l.months, l.total])).join('')}${tr(['Total', ...v.monthTotals, v.total])}</table></body></html>`;
    },
    import(actor, b) {
      const made = []; const errors = [];
      b.rows.forEach((x, i) => { try { const v = budgets.create(actor, x); made.push({ row: i + 1, id: v.id, docNo: v.docNo }); } catch (e) { errors.push({ row: i + 1, costCentreId: x.costCentreId, message: e.details?.[0]?.message ?? e.message }); } });
      return { created: made.length, errors, rows: made };
    },
    /** The approval hooks: approved, the budget is locked and the previous version is superseded; rejected, returned or cancelled it goes back to its maker. */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        transaction(db, () => {
          const prev = db.prepare("SELECT * FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status = 'APPROVED' AND id <> ? AND deleted_at IS NULL").get(r.company_id, r.fy_id, r.cost_centre_id, r.id);
          if (prev) db.prepare("UPDATE bud_dept_budgets SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, prev.id);
          db.prepare("UPDATE bud_dept_budgets SET status = 'APPROVED', approved_by = ?, approved_at = ?, locked_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, actor.user, now, r.id);
          audit(actor, 'bud_dept_budgets', r.id, 'approve', r.company_id, { newValues: { total: rupees(r.total_amount), supersedes: prev?.doc_no ?? null } });
          const cc = ccRow(r.company_id, r.cost_centre_id); const periods = periodsOf(r.fy_id);
          event('bud.dept_budget.approved', actor, r.id, r.company_id, { budgetId: r.id, docNo: r.doc_no, fyId: r.fy_id, costCentreId: r.cost_centre_id, departmentId: r.department_id, versionNo: r.version_no, vtype: r.vtype, total: rupees(r.total_amount), previousBudgetId: prev?.id ?? null, previousTotal: prev ? rupees(prev.total_amount) : null, months: monthTotals(linesOut(r.id, periods), periods.length).map(rupees) });
          notify(r.company_id, 'bud.dept.approved', [r.requested_by, deptHeadOf(r.department_id)], r.doc_no, `${cc?.code ?? ''} ${r.name}`, `Department budget ${r.doc_no} version ${r.version_no} (₹ ${rupees(r.total_amount)}) is approved and locked.`, `/bud/dept-budget?id=${r.id}`, r.id);
        });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE bud_dept_budgets SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'bud_dept_budgets', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'bud.dept.rejected', [r.requested_by], r.doc_no, r.name, `Department budget ${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/bud/dept-budget?id=${r.id}`, r.id);
    },
  };

  // ---- FR-03: actual cost of the general ledger -----------------------------------------------------------------------------------------------------------------------
  const periodOn = (companyId, date) => db.prepare('SELECT p.id, p.fy_id, p.period_no FROM core_periods p WHERE p.company_id = ? AND p.deleted_at IS NULL AND ? BETWEEN p.start_date AND p.end_date').get(companyId, date);
  /** Records (or reverses) the lines of one ledger document once: the same document again changes nothing; a different amount for a recorded line is refused until it is reversed. */
  function recordActuals(actor, b) {
    const companyId = actor.companyId;
    return transaction(db, () => {
      if (b.action === 'REVERSE') {
        const rows = db.prepare("SELECT * FROM bud_dept_actuals WHERE company_id = ? AND src_type = ? AND src_id = ? AND status = 'POSTED'").all(companyId, b.sourceType, b.sourceId);
        if (!rows.length) throw notFound('No actual of that ledger document is recorded.');
        db.prepare("UPDATE bud_dept_actuals SET status = 'REVERSED', reversed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND src_type = ? AND src_id = ? AND status = 'POSTED'").run(nowIso(), actor.user, nowIso(), companyId, b.sourceType, b.sourceId);
        audit(actor, 'bud_dept_actuals', rows[0].id, 'reverse', companyId, { newValues: { source: `${b.sourceType} ${b.sourceId}`, lines: rows.length } });
        return { action: 'REVERSE', reversed: rows.length, amount: signed(rows.reduce((a, x) => a + x.amount, 0)) };
      }
      const date = b.date ?? todayIST(); const per = periodOn(companyId, date); const problems = []; const out = [];
      if (!per) throw unprocessable(`No financial period of the company covers ${date}.`);
      b.lines.forEach((l, i) => {
        const cc = ccRow(companyId, l.costCentreId); const a = accountRow(companyId, l.accountId); const f = (field, message) => problems.push({ field: `lines.${i}.${field}`, message });
        if (!cc) f('costCentreId', 'Choose a cost centre of the company'); if (!a) f('accountId', 'Choose an account of the chart');
        out.push({ l, cc, a });
      });
      fail(problems); if (!out.length) throw unprocessable('The ledger document has no lines.');
      const results = []; const amountOf = (l) => Math.round(l.amount * 100);
      for (const { l } of out) {
        const ex = db.prepare('SELECT * FROM bud_dept_actuals WHERE company_id = ? AND src_type = ? AND src_id = ? AND src_line_id = ?').get(companyId, b.sourceType, b.sourceId, l.lineId);
        if (ex && ex.status === 'POSTED') {
          if (ex.amount === amountOf(l) && ex.cost_centre_id === l.costCentreId && ex.account_id === l.accountId) { results.push({ lineId: l.lineId, action: 'DUPLICATE', amount: signed(ex.amount) }); continue; }
          throw conflict(`Line ${l.lineId || '(only line)'} of ${b.sourceType} ${b.sourceId} is recorded with another amount, cost centre or account: reverse the document first.`);
        }
        if (ex) {
          db.prepare("UPDATE bud_dept_actuals SET fy_id = ?, period_id = ?, cost_centre_id = ?, account_id = ?, amount = ?, doc_ref = ?, narration = ?, posted_date = ?, status = 'POSTED', reversed_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(per.fy_id, per.id, l.costCentreId, l.accountId, amountOf(l), b.docRef, l.narration ?? null, date, actor.user, nowIso(), ex.id);
          results.push({ lineId: l.lineId, action: 'REPOSTED', amount: signed(amountOf(l)) }); continue;
        }
        db.prepare("INSERT INTO bud_dept_actuals (company_id, fy_id, period_id, cost_centre_id, account_id, amount, src_type, src_id, src_line_id, doc_ref, narration, posted_date, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, 'gl')")
          .run(companyId, per.fy_id, per.id, l.costCentreId, l.accountId, amountOf(l), b.sourceType, b.sourceId, l.lineId, b.docRef, l.narration ?? null, date, actor.user);
        results.push({ lineId: l.lineId, action: 'POSTED', amount: signed(amountOf(l)) });
      }
      audit(actor, 'bud_dept_actuals', 0, 'post', companyId, { newValues: { source: `${b.sourceType} ${b.sourceId}`, lines: results.length } });
      return { action: 'POST', date, lines: results };
    });
  }
  const actuals = {
    ingest(actor, b) { need(actor, 'bud.dept_actual.post', 'record ledger actuals'); return recordActuals(actor, b); },
    /** The events of the general ledger (part 23): `fin.gl.posted` and `fin.gl.reversed`, consumed once per source line. */
    onEvent(e) {
      const t = String(e.type ?? e.eventType ?? ''); if (!t.startsWith(`${GL_EVENT_FAMILY}.`)) return null; const d = e.data ?? {}; const companyId = Number(e.companyId ?? d.companyId); const verb = t.split('.').pop();
      if (!companyId || d.sourceId == null || !['posted', 'reversed'].includes(verb)) return null;
      const base0 = { sourceType: String(d.sourceType ?? 'fin_gl'), sourceId: String(d.sourceId), docRef: d.docRef ?? null, date: d.date ?? null };
      if (verb === 'reversed') { try { return recordActuals(system(companyId), { ...base0, action: 'REVERSE', lines: [] }); } catch (x) { if (x?.status === 404) return null; throw x; } }
      return recordActuals(system(companyId), { ...base0, action: 'POST', lines: (d.lines ?? []).map((l) => ({ lineId: l.lineId == null ? '' : String(l.lineId), costCentreId: Number(l.costCentreId), accountId: Number(l.accountId), amount: Number(l.amount), narration: l.narration ?? null })) });
    },
  };

  // ---- FR-03: budget against actual, by department (cost centre), account and month ---------------------------------------------------------------------------------
  function reportFacts(actor, q) {
    anywhere(actor, 'bud.dept_report.view', 'see the department budget report'); const fy = fyRow(actor.companyId, q.fyId); if (!fy) throw notFound('That financial year does not exist.');
    const f = authz.scopeFilter(actor, 'bud.dept_report.view', { department: CC_DEPT }); const periods = periodsOf(fy.id);
    const params = { co: actor.companyId, fy: fy.id, ...(f.params ?? {}), ...(q.costCentreId ? { cc: q.costCentreId } : {}) }; const up = q.upTo ?? 12;
    const scope = `AND ${f.sql}${q.costCentreId ? ' AND c.id = :cc' : ''}`;
    return { fy, periods, params, scope, up };
  }
  function report(actor, q) {
    const { fy, periods, params, scope, up } = reportFacts(actor, q);
    const bud = db.prepare(`SELECT c.id AS cc, c.code AS cc_code, c.name AS cc_name, l.account_id, a.code AS a_code, a.name AS a_name, p.period_no, SUM(l.amount) AS amt FROM bud_dept_lines l JOIN bud_dept_budgets b ON b.id = l.budget_id AND b.status = 'APPROVED' AND b.deleted_at IS NULL
      JOIN org_cost_centres c ON c.id = b.cost_centre_id JOIN fin_accounts a ON a.id = l.account_id JOIN core_periods p ON p.id = l.period_id WHERE b.company_id = :co AND b.fy_id = :fy AND l.deleted_at IS NULL AND p.period_no <= :up ${scope} GROUP BY c.id, l.account_id, p.period_no`).all({ ...params, up });
    const act = db.prepare(`SELECT c.id AS cc, c.code AS cc_code, c.name AS cc_name, x.account_id, a.code AS a_code, a.name AS a_name, p.period_no, SUM(x.amount) AS amt FROM bud_dept_actuals x JOIN org_cost_centres c ON c.id = x.cost_centre_id JOIN fin_accounts a ON a.id = x.account_id JOIN core_periods p ON p.id = x.period_id
      WHERE x.company_id = :co AND x.fy_id = :fy AND x.status = 'POSTED' AND x.deleted_at IS NULL AND p.period_no <= :up ${scope} GROUP BY c.id, x.account_id, p.period_no`).all({ ...params, up });
    const by = q.by ?? 'cost_centre'; const rows = new Map();
    const keyOf = (r) => (by === 'account' ? [`a${r.account_id}`, r.account_id, `${r.a_code} ${r.a_name}`] : by === 'month' ? [`m${r.period_no}`, r.period_no, periods.find((p) => p.period_no === r.period_no)?.name ?? `Month ${r.period_no}`] : [`c${r.cc}`, r.cc, `${r.cc_code} ${r.cc_name}`]);
    const put = (r, side) => { const [key, id, label] = keyOf(r); const g = rows.get(key) ?? { key, id, label, budget: 0, actual: 0 }; g[side] += r.amt; rows.set(key, g); };
    bud.forEach((r) => put(r, 'budget')); act.forEach((r) => put(r, 'actual'));
    const out = [...rows.values()].sort((a, b) => (by === 'month' ? a.id - b.id : a.label.localeCompare(b.label))).map((g) => ({ key: g.key, id: g.id, label: g.label, budget: rupees(g.budget), actual: rupees(g.actual), variance: signed(g.budget - g.actual), usedPct: g.budget > 0 ? Math.round((g.actual * 1000) / g.budget) / 10 : null, over: g.actual > g.budget, unbudgeted: g.budget === 0 && g.actual !== 0 }));
    const tb = [...rows.values()].reduce((a, g) => a + g.budget, 0); const ta = [...rows.values()].reduce((a, g) => a + g.actual, 0);
    const budgets = db.prepare(`SELECT b.id, b.doc_no, b.version_no, b.total_amount, c.code AS cc_code, c.name AS cc_name FROM bud_dept_budgets b JOIN org_cost_centres c ON c.id = b.cost_centre_id WHERE b.company_id = :co AND b.fy_id = :fy AND b.status = 'APPROVED' AND b.deleted_at IS NULL ${scope} ORDER BY c.code`).all(params).map((b) => ({ id: b.id, docNo: b.doc_no, versionNo: b.version_no, costCentre: `${b.cc_code} ${b.cc_name}`, total: rupees(b.total_amount) }));
    const live = db.prepare("SELECT 1 FROM bud_dept_actuals WHERE company_id = ? AND fy_id = ? AND status = 'POSTED' AND deleted_at IS NULL LIMIT 1").get(actor.companyId, fy.id);
    return { fyId: fy.id, fy: fy.code, by, upTo: up, upToName: periods[up - 1]?.name ?? null, rows: out, totals: { budget: rupees(tb), actual: rupees(ta), variance: signed(tb - ta), usedPct: tb > 0 ? Math.round((ta * 1000) / tb) / 10 : null, over: ta > tb }, budgets, actualsLive: Boolean(live), noBudget: out.filter((r) => r.unbudgeted).length };
  }
  function reportDocs(actor, q) {
    const { fy, params, scope } = reportFacts(actor, { fyId: q.fyId, costCentreId: q.costCentreId, upTo: 12 });
    const extra = `${q.accountId ? ' AND a.id = :acc' : ''}${q.periodNo ? ' AND p.period_no = :pno' : ''}`; const ps = { ...params, ...(q.accountId ? { acc: q.accountId } : {}), ...(q.periodNo ? { pno: q.periodNo } : {}) };
    const lines = db.prepare(`SELECT b.id AS budget_id, b.doc_no, b.version_no, c.code AS cc_code, a.code AS a_code, a.name AS a_name, p.period_no, p.name AS p_name, l.amount FROM bud_dept_lines l JOIN bud_dept_budgets b ON b.id = l.budget_id AND b.status = 'APPROVED' AND b.deleted_at IS NULL JOIN org_cost_centres c ON c.id = b.cost_centre_id
      JOIN fin_accounts a ON a.id = l.account_id JOIN core_periods p ON p.id = l.period_id WHERE b.company_id = :co AND b.fy_id = :fy AND l.deleted_at IS NULL AND l.amount <> 0 ${scope}${extra} ORDER BY c.code, a.code, p.period_no`).all(ps);
    const acts = db.prepare(`SELECT x.id, x.src_type, x.src_id, x.doc_ref, x.narration, x.posted_date, x.amount, c.code AS cc_code, a.code AS a_code, a.name AS a_name, p.period_no FROM bud_dept_actuals x JOIN org_cost_centres c ON c.id = x.cost_centre_id JOIN fin_accounts a ON a.id = x.account_id JOIN core_periods p ON p.id = x.period_id
      WHERE x.company_id = :co AND x.fy_id = :fy AND x.status = 'POSTED' AND x.deleted_at IS NULL ${scope}${extra} ORDER BY x.posted_date, x.id`).all(ps);
    return { fyId: fy.id, budget: lines.map((l) => ({ budgetId: l.budget_id, docNo: l.doc_no, versionNo: l.version_no, costCentre: l.cc_code, account: `${l.a_code} ${l.a_name}`, periodNo: l.period_no, period: l.p_name, amount: rupees(l.amount) })), actuals: acts.map((x) => ({ id: x.id, sourceType: x.src_type, sourceId: x.src_id, docRef: x.doc_ref, narration: x.narration, date: x.posted_date, costCentre: x.cc_code, account: `${x.a_code} ${x.a_name}`, periodNo: x.period_no, amount: signed(x.amount) })) };
  }
  function reportCsv(actor, q) {
    anywhere(actor, 'bud.dept_report.export', 'export the department budget report'); const r = report(actor, q);
    const lines = [['Item', 'Budget', 'Actual', 'Variance (budget less actual)', 'Used %'], ...r.rows.map((x) => [x.label, x.budget, x.actual, x.variance, x.usedPct ?? '']), ['Total', r.totals.budget, r.totals.actual, r.totals.variance, r.totals.usedPct ?? '']];
    audit(actor, 'bud_dept_budgets', 0, 'export', actor.companyId, { newValues: { report: `${r.fy} by ${r.by} up to ${r.upTo}` } });
    return { name: `department-budget-vs-actual-${r.fy}.csv`, body: lines.map((x) => x.map((v) => `"${cell(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') };
  }

  // ---- FR-04: allocation rules (a maker drafts, a checker activates) and runs ----------------------------------------------------------------------------------------------
  const ruleRow = (actor, id) => { const r = db.prepare('SELECT * FROM bud_alloc_rules WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That allocation rule does not exist.'); return r; };
  const ruleBody = (r) => { const j = json(r.rules_json, {}); return { pool: { costCentreIds: j.pool?.costCentreIds ?? [], accountIds: j.pool?.accountIds ?? [] }, projectIds: j.projectIds ?? [], fixed: j.fixed ?? [] }; };
  /** The rule as the parts of its definition that a person edits; problems are collected, not thrown one by one. */
  function checkRule(actor, b, fy) {
    const p = []; const pool = b.pool ?? { costCentreIds: [], accountIds: [] };
    if (!fy) p.push({ field: 'fyId', message: 'Choose a financial year of the company' });
    for (const id of pool.costCentreIds) if (!ccUsable(ccRow(actor.companyId, id))) p.push({ field: 'pool.costCentreIds', message: `Cost centre ${id} is not an active cost centre of a department` });
    for (const id of pool.accountIds) if (!accountUsable(accountRow(actor.companyId, id))) p.push({ field: 'pool.accountIds', message: `Account ${id} is not an active expense account` });
    const proj = (id) => db.prepare("SELECT p.id, p.code, p.name FROM org_projects p WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL").get(id, actor.companyId);
    if (b.basis === 'FIXED_PCT') {
      if (!b.fixed?.length) p.push({ field: 'fixed', message: 'Give the project and its percentage for each share' });
      const seen = new Set(); let sum = 0;
      for (const [i, x] of (b.fixed ?? []).entries()) { if (!proj(x.projectId)) p.push({ field: `fixed.${i}.projectId`, message: 'Choose a project of the company' }); if (seen.has(x.projectId)) p.push({ field: `fixed.${i}.projectId`, message: 'A project is given twice' }); seen.add(x.projectId); sum += Math.round(x.pct * 10000); }
      if (b.fixed?.length && sum !== 1_000_000) p.push({ field: 'fixed', message: `The percentages add up to ${sum / 10000} %: they must add up to 100 % so that the shares equal the pool (BR-01)` });
      if (b.projectIds?.length) p.push({ field: 'projectIds', message: 'Fixed percentages name their projects themselves' });
    } else {
      if (b.fixed?.length) p.push({ field: 'fixed', message: 'Percentages belong to the fixed basis' });
      for (const id of b.projectIds ?? []) if (!proj(id)) p.push({ field: 'projectIds', message: `Project ${id} is not a project of the company` });
    }
    return p;
  }
  function ruleView(actor, r) {
    const body = ruleBody(r); const fy = db.prepare('SELECT code FROM core_financial_years WHERE id = ?').get(r.fy_id);
    const ccs = body.pool.costCentreIds.map((id) => db.prepare('SELECT id, code, name FROM org_cost_centres WHERE id = ?').get(id)).filter(Boolean);
    const accs = body.pool.accountIds.map((id) => db.prepare('SELECT id, code, name FROM fin_accounts WHERE id = ?').get(id)).filter(Boolean);
    const projects = (ids) => ids.map((id) => db.prepare('SELECT id, code, name FROM org_projects WHERE id = ?').get(id)).filter(Boolean);
    const company = authz.check(actor, 'bud.alloc.configure', { companyId: actor.companyId }).allowed; const approver = authz.check(actor, 'bud.alloc.approve', { companyId: actor.companyId }).allowed;
    const runs = db.prepare("SELECT COUNT(*) AS n FROM bud_alloc_runs WHERE rule_id = ? AND status = 'POSTED' AND deleted_at IS NULL").get(r.id).n;
    return {
      id: r.id, docNo: r.doc_no, fyId: r.fy_id, fy: fy?.code, name: r.name, basis: r.basis, basisLabel: ALLOC_BASIS[r.basis], pool: { costCentreIds: body.pool.costCentreIds, accountIds: body.pool.accountIds, costCentres: ccs, accounts: accs },
      projectIds: body.projectIds, projects: projects(body.projectIds), fixed: body.fixed.map((x) => ({ projectId: x.projectId, pct: x.pct, project: projects([x.projectId])[0] ?? null })), status: r.status, statusLabel: RULE_STATUS[r.status], reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, rowVersion: r.version, postedRuns: runs,
      can: { edit: company && r.status === 'DRAFT', activate: approver && r.status === 'DRAFT' && !same(r.requested_by, actor.user), cancel: (company && r.status === 'DRAFT') || (approver && r.status === 'ACTIVE' && runs === 0) },
    };
  }
  const overlapping = (actor, r, body) => db.prepare("SELECT * FROM bud_alloc_rules WHERE company_id = ? AND fy_id = ? AND status = 'ACTIVE' AND id <> ? AND deleted_at IS NULL").all(actor.companyId, r.fy_id, r.id).find((o) => poolsOverlap(body.pool, ruleBody(o).pool));
  const rules = {
    list(actor, q) {
      anywhere(actor, 'bud.alloc.view', 'see the allocation rules');
      const rows = db.prepare(`SELECT * FROM bud_alloc_rules WHERE company_id = ? AND deleted_at IS NULL${q.fyId ? ' AND fy_id = ?' : ''}${q.status ? ' AND status = ?' : ''} ORDER BY id DESC`).all(actor.companyId, ...(q.fyId ? [q.fyId] : []), ...(q.status ? [q.status] : []));
      return { rows: rows.map((r) => ruleView(actor, r)), inForce: rows.filter((r) => r.status === 'ACTIVE').length };
    },
    get(actor, id) { anywhere(actor, 'bud.alloc.view', 'see the allocation rules'); return ruleView(actor, ruleRow(actor, id)); },
    create(actor, b) {
      need(actor, 'bud.alloc.configure', 'draft an allocation rule'); const fy = fyRow(actor.companyId, b.fyId); fail(checkRule(actor, b, fy));
      if (db.prepare("SELECT 1 FROM bud_alloc_rules WHERE company_id = ? AND fy_id = ? AND name = ? COLLATE NOCASE AND status IN ('DRAFT', 'ACTIVE') AND deleted_at IS NULL").get(actor.companyId, fy.id, b.name)) throw conflict('A rule of that name exists for this financial year.');
      return transaction(db, () => {
        const body = { pool: { costCentreIds: b.pool.costCentreIds, accountIds: b.pool.accountIds }, projectIds: b.projectIds ?? [], fixed: b.fixed ?? [] };
        const id = Number(db.prepare("INSERT INTO bud_alloc_rules (company_id, doc_no, fy_id, name, basis, rules_json, status, reason, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(actor.companyId, numberFor(actor, 'BUD_ALLOC_RULE', 'bud_alloc_rules', 'ARL', 4), fy.id, b.name, b.basis, JSON.stringify(body), b.reason, actor.user, actor.user).lastInsertRowid);
        audit(actor, 'bud_alloc_rules', id, 'create', actor.companyId, { reason: b.reason, newValues: { name: b.name, basis: b.basis } }); return rules.get(actor, id);
      });
    },
    update(actor, id, b) {
      need(actor, 'bud.alloc.configure', 'change an allocation rule'); const r = ruleRow(actor, id); if (r.status !== 'DRAFT') throw conflict(`${r.doc_no} is ${RULE_STATUS[r.status].toLowerCase()}: a rule in force is locked; cancel it and draft another.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this rule; reload it.');
      const cur = ruleBody(r); const merged = { basis: b.basis ?? r.basis, pool: b.pool ?? cur.pool, projectIds: b.projectIds ?? (b.basis && b.basis !== r.basis ? [] : cur.projectIds), fixed: b.fixed ?? (b.basis && b.basis !== r.basis ? [] : cur.fixed) };
      fail(checkRule(actor, merged, fyRow(actor.companyId, r.fy_id)));
      return transaction(db, () => {
        db.prepare('UPDATE bud_alloc_rules SET name = ?, basis = ?, rules_json = ?, reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name ?? r.name, merged.basis, JSON.stringify({ pool: merged.pool, projectIds: merged.projectIds, fixed: merged.fixed }), b.reason ?? r.reason, actor.user, nowIso(), r.id);
        audit(actor, 'bud_alloc_rules', r.id, 'update', actor.companyId, { reason: b.reason }); return rules.get(actor, r.id);
      });
    },
    /** The checker: a second person puts the rule in force. The pools of the rules in force of one financial year do not overlap, or the same money would be shared twice. */
    activate(actor, id) {
      need(actor, 'bud.alloc.approve', 'put an allocation rule in force'); const r = ruleRow(actor, id); if (r.status !== 'DRAFT') throw unprocessable('Only a draft rule is put in force.');
      if (same(r.requested_by, actor.user)) throw forbidden('The person who drafted a rule does not put it in force (segregation of duties).');
      const body = ruleBody(r); fail(checkRule(actor, { basis: r.basis, ...body }, fyRow(actor.companyId, r.fy_id)));
      const o = overlapping(actor, r, body); if (o) throw conflict(`${o.doc_no} (${o.name}) is in force for the same cost centres and accounts: cancel it first, or the same money would be shared twice.`);
      return transaction(db, () => {
        const now = nowIso(); db.prepare("UPDATE bud_alloc_rules SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
        audit(actor, 'bud_alloc_rules', r.id, 'activate', actor.companyId, { newValues: { basis: r.basis } }); event('bud.alloc.rule_changed', actor, r.id, actor.companyId, { ruleId: r.id, docNo: r.doc_no, fyId: r.fy_id, basis: r.basis, status: 'ACTIVE' }, 'bud_alloc_rule');
        return rules.get(actor, r.id);
      });
    },
    cancel(actor, id, { reason }) {
      const r = ruleRow(actor, id);
      if (r.status === 'DRAFT') need(actor, 'bud.alloc.configure', 'cancel an allocation rule');
      else if (r.status === 'ACTIVE') { need(actor, 'bud.alloc.approve', 'withdraw an allocation rule in force'); if (db.prepare("SELECT 1 FROM bud_alloc_runs WHERE rule_id = ? AND status = 'POSTED' AND deleted_at IS NULL").get(r.id)) throw unprocessable('This rule has posted allocations: reverse them first.'); }
      else throw unprocessable('Only a draft or a rule in force is cancelled.');
      return transaction(db, () => { db.prepare("UPDATE bud_alloc_rules SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'bud_alloc_rules', r.id, 'cancel', actor.companyId, { reason }); if (r.status === 'ACTIVE') event('bud.alloc.rule_changed', actor, r.id, actor.companyId, { ruleId: r.id, docNo: r.doc_no, fyId: r.fy_id, basis: r.basis, status: 'CANCELLED' }, 'bud_alloc_rule'); return rules.get(actor, r.id); });
    },
    history(actor, id) { anywhere(actor, 'bud.alloc.view', 'see the allocation rules'); const r = ruleRow(actor, id); return { approvals: [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'bud_alloc_rules' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    csv(actor) {
      anywhere(actor, 'bud.alloc.view', 'export the allocation rules'); const rs = rules.list(actor, {}).rows;
      const lines = [['No.', 'Financial year', 'Name', 'Basis', 'Cost centres', 'Accounts', 'Projects', 'Status'], ...rs.map((r) => [r.docNo, r.fy, r.name, r.basisLabel, r.pool.costCentres.map((c) => c.code).join(' '), r.pool.accounts.length ? r.pool.accounts.map((c) => c.code).join(' ') : 'All', r.basis === 'FIXED_PCT' ? r.fixed.map((f) => `${f.project?.code} ${f.pct}%`).join(' ') : (r.projects.length ? r.projects.map((p) => p.code).join(' ') : 'All active'), r.statusLabel])];
      audit(actor, 'bud_alloc_rules', 0, 'export', actor.companyId, {}); return { name: 'overhead-allocation-rules.csv', body: lines.map((x) => x.map((v) => `"${cell(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') };
    },
  };

  // ---- the pool, the basis and the shares -----------------------------------------------------------------------------------------------------------------------------
  /** The pool: the approved budget (or the actual cost of the ledger) of the cost centres and accounts of the rule, for the months chosen; by cost centre so that it can be explained. */
  function poolOf(actor, rule, body, from, to, source) {
    const cc = body.pool.costCentreIds; const acc = body.pool.accountIds; const accSql = acc.length ? ` AND t.account_id IN (${acc.map(Number).join(',')})` : '';
    const sql = source === 'BUDGET'
      ? `SELECT t.cost_centre_id AS cc, SUM(t.amount) AS amt FROM (SELECT b.cost_centre_id, l.account_id, l.amount, l.period_id FROM bud_dept_lines l JOIN bud_dept_budgets b ON b.id = l.budget_id WHERE b.company_id = ? AND b.fy_id = ? AND b.status = 'APPROVED' AND b.deleted_at IS NULL AND l.deleted_at IS NULL) t JOIN core_periods p ON p.id = t.period_id WHERE t.cost_centre_id IN (${cc.map(Number).join(',')})${accSql} AND p.period_no BETWEEN ? AND ? GROUP BY t.cost_centre_id`
      : `SELECT t.cost_centre_id AS cc, SUM(t.amount) AS amt FROM (SELECT x.cost_centre_id, x.account_id, x.amount, x.period_id FROM bud_dept_actuals x WHERE x.company_id = ? AND x.fy_id = ? AND x.status = 'POSTED' AND x.deleted_at IS NULL) t JOIN core_periods p ON p.id = t.period_id WHERE t.cost_centre_id IN (${cc.map(Number).join(',')})${accSql} AND p.period_no BETWEEN ? AND ? GROUP BY t.cost_centre_id`;
    const rows = db.prepare(sql).all(actor.companyId, rule.fy_id, from.period_no, to.period_no);
    return rows.map((r) => { const c = db.prepare('SELECT code, name FROM org_cost_centres WHERE id = ?').get(r.cc); return { costCentreId: r.cc, costCentre: `${c.code} ${c.name}`, amount: r.amt }; }).filter((r) => r.amount !== 0);
  }
  /** The weights: a revenue (the contract value until the ledger of part 23 gives the revenue of the months), the direct cost posted in the months (the approved budget's direct cost when nothing is posted yet), or the fixed percentages. */
  function basisOf(actor, rule, body, from, to) {
    let projects;
    if (rule.basis === 'FIXED_PCT') projects = body.fixed.map((f) => ({ id: f.projectId, w: Math.round(f.pct * 10000) }));
    else {
      const list = db.prepare("SELECT p.id, COALESCE(pp.contract_value, 0) AS cv FROM org_projects p LEFT JOIN proj_projects pp ON pp.project_id = p.id AND pp.deleted_at IS NULL WHERE p.company_id = ? AND p.status = 'ACTIVE' AND p.deleted_at IS NULL ORDER BY p.id").all(actor.companyId).filter((p) => !body.projectIds.length || body.projectIds.includes(p.id));
      if (rule.basis === 'REVENUE') projects = list.map((p) => ({ id: p.id, w: p.cv }));
      else {
        const spent = new Map(db.prepare("SELECT org_project_id AS id, SUM(amount) AS a FROM bud_actuals WHERE company_id = ? AND status = 'POSTED' AND deleted_at IS NULL AND actual_date BETWEEN ? AND ? GROUP BY org_project_id").all(actor.companyId, from.start_date, to.end_date).map((x) => [x.id, x.a]));
        if (list.some((p) => (spent.get(p.id) ?? 0) > 0)) projects = list.map((p) => ({ id: p.id, w: spent.get(p.id) ?? 0, source: 'ACTUAL' }));
        else projects = list.map((p) => ({ id: p.id, w: currentOf(p.id)?.direct_total ?? 0, source: 'BUDGET' }));
      }
    }
    return { projects: projects.filter((p) => p.w > 0), source: rule.basis === 'FIXED_PCT' ? 'FIXED' : rule.basis === 'REVENUE' ? 'CONTRACT_VALUE' : (projects.some((p) => p.source === 'ACTUAL') ? 'ACTUAL_DIRECT_COST' : 'BUDGET_DIRECT_COST') };
  }
  function compute(actor, b) {
    const rule = ruleRow(actor, b.ruleId); if (rule.status !== 'ACTIVE') throw unprocessable(`${rule.doc_no} is ${RULE_STATUS[rule.status].toLowerCase()}: only a rule in force is run.`);
    const periods = periodsOf(rule.fy_id); const from = periods.find((p) => p.period_no === b.fromPeriodNo); const to = periods.find((p) => p.period_no === b.toPeriodNo); if (!from || !to) throw unprocessable('The months are not months of the financial year of the rule.');
    const body = ruleBody(rule); const breakdown = poolOf(actor, rule, body, from, to, b.poolSource); const pool = breakdown.reduce((a, x) => a + x.amount, 0);
    if (pool <= 0) throw unprocessable(`There is nothing to allocate: the ${POOL_SOURCE[b.poolSource].toLowerCase()} of the pool is ₹ ${rupees(Math.max(pool, 0))} for ${from.name} to ${to.name}.`);
    const basis = basisOf(actor, rule, body, from, to); if (!basis.projects.length) throw unprocessable('No project has a basis value for this rule (an active project with a contract value, direct cost or a percentage).');
    const a = allocateByWeights(pool, basis.projects.map((p) => p.w)); const sh = sharesOf(basis.projects.map((p) => p.w));
    const lines = basis.projects.map((p, i) => { const o = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(p.id); return { projectId: p.id, code: o.code, name: o.name, basisValue: p.w, share: sh[i], amount: a.parts[i], residual: i === a.residualIndex ? a.residual : 0 }; });
    if (lines.reduce((s, l) => s + l.amount, 0) !== pool) throw new Error('The allocation does not add up to the pool'); // BR-01 guard: allocateByWeights makes this impossible
    return { rule, from, to, source: b.poolSource, pool, breakdown, basisSource: basis.source, lines };
  }
  const calcOut = (c) => ({
    ruleId: c.rule.id, ruleDocNo: c.rule.doc_no, ruleName: c.rule.name, basis: c.rule.basis, basisLabel: ALLOC_BASIS[c.rule.basis], basisSource: c.basisSource, fyId: c.rule.fy_id, from: { periodNo: c.from.period_no, name: c.from.name }, to: { periodNo: c.to.period_no, name: c.to.name }, poolSource: c.source, poolSourceLabel: POOL_SOURCE[c.source],
    pool: rupees(c.pool), allocated: rupees(c.lines.reduce((s, l) => s + l.amount, 0)), breakdown: c.breakdown.map((x) => ({ costCentreId: x.costCentreId, costCentre: x.costCentre, amount: rupees(x.amount) })),
    lines: c.lines.map((l) => ({ projectId: l.projectId, project: `${l.code} ${l.name}`, basisValue: c.rule.basis === 'FIXED_PCT' ? String(l.basisValue / 10000) : rupees(l.basisValue), share: l.share / 10000, amount: rupees(l.amount), residual: l.residual ? rupees(l.residual) : '0.00' })), balanced: c.lines.reduce((s, l) => s + l.amount, 0) === c.pool,
  });
  const runView = (actor, r, { detail = false } = {}) => {
    const rule = db.prepare('SELECT doc_no, name FROM bud_alloc_rules WHERE id = ?').get(r.rule_id); const fy = db.prepare('SELECT code FROM core_financial_years WHERE id = ?').get(r.fy_id);
    const f = db.prepare('SELECT period_no, name FROM core_periods WHERE id = ?').get(r.from_period_id); const t = db.prepare('SELECT period_no, name FROM core_periods WHERE id = ?').get(r.to_period_id);
    const v = { id: r.id, docNo: r.doc_no, fyId: r.fy_id, fy: fy?.code, ruleId: r.rule_id, rule: rule ? `${rule.doc_no} ${rule.name}` : null, basis: r.basis, basisLabel: ALLOC_BASIS[r.basis], basisSource: r.basis_source, from: f?.name, to: t?.name, fromPeriodNo: f?.period_no, toPeriodNo: t?.period_no, poolSource: r.pool_source, poolSourceLabel: POOL_SOURCE[r.pool_source], pool: rupees(r.pool_amount), allocated: rupees(r.allocated_amount), projects: r.projects_count, status: r.status, statusLabel: RUN_STATUS[r.status], runBy: r.run_by, reversedBy: r.reversed_by, reversedAt: r.reversed_at, reverseReason: r.reverse_reason, createdAt: r.created_at, can: { reverse: r.status === 'POSTED' && authz.check(actor, 'bud.alloc.run', { companyId: actor.companyId }).allowed } };
    if (detail) { v.breakdown = json(r.pool_json, []).map((x) => ({ costCentre: x.costCentre, amount: rupees(x.amount) })); v.lines = db.prepare('SELECT l.*, p.code, p.name FROM bud_alloc_lines l JOIN org_projects p ON p.id = l.org_project_id WHERE l.run_id = ? AND l.deleted_at IS NULL ORDER BY l.org_project_id').all(r.id).map((l) => ({ projectId: l.org_project_id, project: `${l.code} ${l.name}`, basisValue: r.basis === 'FIXED_PCT' ? String(l.basis_value / 10000) : rupees(l.basis_value), share: l.share / 10000, amount: rupees(l.amount), residual: l.residual ? rupees(l.residual) : '0.00' })); v.balanced = v.lines.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0) === r.pool_amount; }
    return v;
  };
  const runs = {
    /** FR-04: what a run would do, nothing saved: the pool, its breakdown, the basis and the share of each project. */
    preview(actor, b) { need(actor, 'bud.alloc.view', 'see an allocation'); return calcOut(compute(actor, b)); },
    post(actor, b) {
      need(actor, 'bud.alloc.run', 'run an overhead allocation'); const c = compute(actor, b);
      if (b.expectedPool != null && Math.round(b.expectedPool * 100) !== c.pool) throw conflict(`The pool is now ₹ ${rupees(c.pool)}, not ₹ ${b.expectedPool.toFixed(2)} as previewed: look at the preview again.`);
      const done = db.prepare("SELECT doc_no FROM bud_alloc_runs WHERE company_id = ? AND rule_id = ? AND from_period_id = ? AND to_period_id = ? AND pool_source = ? AND status = 'POSTED' AND deleted_at IS NULL").get(actor.companyId, c.rule.id, c.from.id, c.to.id, c.source);
      if (done) throw conflict(`${done.doc_no} has allocated this pool for these months already: reverse it first to run again.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO bud_alloc_runs (company_id, doc_no, fy_id, rule_id, basis, from_period_id, to_period_id, pool_source, basis_source, pool_amount, allocated_amount, projects_count, pool_json, status, run_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, 'api')")
          .run(actor.companyId, numberFor(actor, 'BUD_ALLOC_RUN', 'bud_alloc_runs', 'OAR', 5), c.rule.fy_id, c.rule.id, c.rule.basis, c.from.id, c.to.id, c.source, c.basisSource, c.pool, c.pool, c.lines.length, JSON.stringify(c.breakdown), actor.user, actor.user).lastInsertRowid);
        const ins = db.prepare("INSERT INTO bud_alloc_lines (company_id, run_id, org_project_id, basis_value, share, amount, residual, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')");
        for (const l of c.lines) ins.run(actor.companyId, id, l.projectId, l.basisValue, l.share, l.amount, l.residual, l.projectId, actor.user);
        const run = db.prepare('SELECT * FROM bud_alloc_runs WHERE id = ?').get(id);
        audit(actor, 'bud_alloc_runs', id, 'post', actor.companyId, { newValues: { rule: c.rule.doc_no, pool: rupees(c.pool), from: c.from.name, to: c.to.name, projects: c.lines.length } });
        event('bud.overhead.allocated', actor, id, actor.companyId, { runId: id, docNo: run.doc_no, fyId: c.rule.fy_id, ruleId: c.rule.id, basis: c.rule.basis, poolSource: c.source, fromPeriod: c.from.name, toPeriod: c.to.name, fromDate: c.from.start_date, toDate: c.to.end_date, pool: rupees(c.pool), allocations: c.lines.map((l) => ({ projectId: l.projectId, amount: rupees(l.amount), share: l.share / 10000 })) }, 'bud_alloc_run');
        notify(actor.companyId, 'bud.alloc.posted', [actor.user], run.doc_no, c.rule.name, `Overhead allocation ${run.doc_no}: ₹ ${rupees(c.pool)} shared over ${c.lines.length} project(s).`, '/bud/alloc', id);
        return runView(actor, run, { detail: true });
      });
    },
    reverse(actor, id, { reason }) {
      need(actor, 'bud.alloc.run', 'reverse an overhead allocation'); const r = db.prepare('SELECT * FROM bud_alloc_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That allocation does not exist.');
      if (r.status !== 'POSTED') throw unprocessable('Only a posted allocation is reversed.');
      return transaction(db, () => {
        const now = nowIso(); db.prepare("UPDATE bud_alloc_runs SET status = 'REVERSED', reversed_by = ?, reversed_at = ?, reverse_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, reason, actor.user, now, r.id);
        audit(actor, 'bud_alloc_runs', r.id, 'reverse', actor.companyId, { reason }); event('bud.overhead.allocation_reversed', actor, r.id, actor.companyId, { runId: r.id, docNo: r.doc_no, fyId: r.fy_id, ruleId: r.rule_id, pool: rupees(r.pool_amount), reason }, 'bud_alloc_run');
        return runView(actor, db.prepare('SELECT * FROM bud_alloc_runs WHERE id = ?').get(r.id), { detail: true });
      });
    },
    list(actor, q) {
      anywhere(actor, 'bud.alloc.view', 'see the allocations');
      return { rows: db.prepare(`SELECT * FROM bud_alloc_runs WHERE company_id = ? AND deleted_at IS NULL${q.fyId ? ' AND fy_id = ?' : ''}${q.ruleId ? ' AND rule_id = ?' : ''} ORDER BY id DESC LIMIT 200`).all(actor.companyId, ...(q.fyId ? [q.fyId] : []), ...(q.ruleId ? [q.ruleId] : [])).map((r) => runView(actor, r)) };
    },
    get(actor, id) { anywhere(actor, 'bud.alloc.view', 'see the allocations'); const r = db.prepare('SELECT * FROM bud_alloc_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That allocation does not exist.'); return runView(actor, r, { detail: true }); },
    /** What part 23.10 reads: the overhead allocated to a project by the posted runs, with the months they cover. */
    poolOfProject(actor, { projectId, fyId }) {
      anywhere(actor, 'bud.alloc.view', 'see the overhead allocated to a project'); const o = orgOf(projectId); if (!o || o.company_id !== actor.companyId) throw notFound('That project does not exist.');
      const rows = db.prepare(`SELECT r.id AS run_id, r.doc_no, r.fy_id, r.basis, r.pool_source, f.name AS from_name, f.start_date, t.name AS to_name, t.end_date, l.amount, l.share FROM bud_alloc_lines l JOIN bud_alloc_runs r ON r.id = l.run_id JOIN core_periods f ON f.id = r.from_period_id JOIN core_periods t ON t.id = r.to_period_id
        WHERE l.org_project_id = ? AND r.company_id = ? AND r.status = 'POSTED' AND r.deleted_at IS NULL AND l.deleted_at IS NULL${fyId ? ' AND r.fy_id = ?' : ''} ORDER BY f.start_date, r.id`).all(projectId, actor.companyId, ...(fyId ? [fyId] : []));
      return { projectId, projectCode: o.code, total: rupees(rows.reduce((a, x) => a + x.amount, 0)), rows: rows.map((x) => ({ runId: x.run_id, docNo: x.doc_no, fyId: x.fy_id, basis: x.basis, basisLabel: ALLOC_BASIS[x.basis], poolSource: x.pool_source, from: x.from_name, to: x.to_name, fromDate: x.start_date, toDate: x.end_date, amount: rupees(x.amount), share: x.share / 10000 })) };
    },
  };

  return { dept: { budgets, actuals, report, reportDocs, reportCsv, rules, runs }, deptDecide: budgets.decide };
}

// ---- workflow, resolver, evidence ------------------------------------------------------------------------------------------------------------------------------------------
/**
 * "bud_dept_head": the head of the department of the cost centre of the budget (the HEAD assignment of the organisation, or the head recorded on the department). When the person who sent the budget is that head, the head of the department above decides;
 * when nobody is found the step waits for a workflow administrator, as the engine does for every empty step; nobody else approves in their place.
 */
if (!workflowResolvers.get('bud_dept_head')) {
  workflowResolvers.register('bud_dept_head', ({ db, instance }) => {
    const r = db.prepare('SELECT department_id FROM bud_dept_budgets WHERE id = ?').get(rid(instance.docId)); let d = r?.department_id ?? null; const seen = new Set();
    while (d && !seen.has(d)) {
      seen.add(d);
      const head = db.prepare("SELECT u.username FROM org_assignments a JOIN iam_users u ON u.id = a.user_id WHERE a.entity_type = 'DEPARTMENT' AND a.entity_id = ? AND a.role = 'HEAD' AND a.is_active = 1 AND a.applied = 1 AND a.effective_from <= date('now') AND (a.effective_to IS NULL OR a.effective_to >= date('now')) ORDER BY a.effective_from DESC LIMIT 1").get(d)?.username
        ?? db.prepare('SELECT u.username FROM org_departments x JOIN iam_users u ON u.id = x.head_user_id WHERE x.id = ?').get(d)?.username;
      if (head && !same(head, instance.submittedBy)) return [head];
      d = db.prepare('SELECT parent_id FROM org_departments WHERE id = ?').get(d)?.parent_id ?? null;
    }
    return [];
  });
}
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const dline = (db, id) => db.prepare('SELECT x.*, c.code, c.name AS cname, f.code AS fy FROM bud_dept_budgets x JOIN org_cost_centres c ON c.id = x.cost_centre_id JOIN core_financial_years f ON f.id = x.fy_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: DEPT_DOC, label: 'Department budget', processOwner: 'CFO', route: (id) => `/bud/dept-budget?id=${id}`,
  describe(db, companyId, id) { const r = dline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} department budget ${r.fy}: ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = dline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Cost centre', value: `${r.code} ${r.cname}` }, { label: 'Financial year', value: r.fy }, { label: 'Version', value: `${r.version_no} (${r.vtype === 'ORIGINAL' ? 'original' : 'revised'})` }, { label: 'Budget total', value: `₹ ${rupees(r.total_amount)}` }, { label: 'Accounts', value: String(r.lines_count) }] }; },
  defaultDefinition: { name: 'Department budget: the department head, the CFO and the director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DEPT_HEAD', 'Department head', [{ kind: 'resolver', resolver: 'bud_dept_head' }]), step('CFO', 'Chief financial officer', [{ kind: 'role', role: 'CFO' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }])] },
  hooks: {
    onApproved: (db, { instance, actor }) => budOf(db)?.deptDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => budOf(db)?.deptDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => budOf(db)?.deptDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => budOf(db)?.deptDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(DEPT_DOC, ({ db, instance }) => {
  const r = dline(db, rid(instance.docId)); if (!r) return { sections: [] };
  const prev = db.prepare("SELECT doc_no, version_no, total_amount FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status = 'APPROVED' AND id <> ? AND deleted_at IS NULL").get(r.company_id, r.fy_id, r.cost_centre_id, r.id);
  const last = db.prepare("SELECT b.total_amount, f.code FROM bud_dept_budgets b JOIN core_financial_years f ON f.id = b.fy_id WHERE b.company_id = ? AND b.cost_centre_id = ? AND b.fy_id <> ? AND b.status IN ('APPROVED', 'SUPERSEDED') AND b.deleted_at IS NULL ORDER BY f.start_date DESC, b.version_no DESC LIMIT 1").get(r.company_id, r.cost_centre_id, r.fy_id);
  const spent = db.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM bud_dept_actuals WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND status = 'POSTED'").get(r.company_id, r.fy_id, r.cost_centre_id).a;
  return { sections: [{ code: 'bud-dept', title: 'Before you approve the department budget', kind: 'metrics', items: [
    { label: 'Cost centre', value: `${r.code} ${r.cname}`, format: 'text' }, { label: 'Financial year', value: r.fy, format: 'text' }, { label: 'Version', value: `${r.version_no} (${r.vtype === 'ORIGINAL' ? 'original' : 'revised'})`, format: 'text' }, { label: 'Budget total', value: Number(rupees(r.total_amount)), format: 'inr' },
    ...(prev ? [{ label: `Version in force (${prev.doc_no})`, value: Number(rupees(prev.total_amount)), format: 'inr' }, { label: 'Change', value: `₹ ${signed(r.total_amount - prev.total_amount)}`, format: 'text' }] : []),
    ...(last ? [{ label: `Approved budget of ${last.code}`, value: Number(rupees(last.total_amount)), format: 'inr' }] : []), { label: 'Actual cost of the year so far', value: Number(rupees(spent)), format: 'inr' }] }] };
});

// ---- the record on the object page: discussion, timeline, trace, related records and attachments ----------------------------------------------------------------------------------
const deptSvc = (db) => budOf(db)?.dept?.budgets ?? null;
objectTypes.register({
  type: 'bud_dept_budget', label: 'Department budget', permission: 'bud.dept_budget.view', route: (id) => `/bud/dept-budget?id=${id}`, attachmentEntity: 'bud_dept_budget', approvalTarget: 'bud_dept_budget',
  access(db, actor, id) { const s = deptSvc(db); if (!s) return null; try { const r = s.get(actor, Number(id)); return { companyId: actor.companyId, projectId: null, siteId: null, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'bud_dept_budgets', id }],
  summary(db, actor, id) { const s = deptSvc(db); if (!s) return null; try { const r = s.get(actor, Number(id)); return { label: `${r.docNo} ${r.costCentreCode} ${r.fy}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) {
    const s = deptSvc(db); if (!s) return [];
    try {
      const r = s.get(actor, Number(id)); const out = [{ kind: 'report', label: `Budget against actual ${r.fy}`, to: `/bud/dept-report?fyId=${r.fyId}&costCentreId=${r.costCentreId}`, direction: 'out' }];
      for (const v of db.prepare('SELECT id, doc_no, version_no, status FROM bud_dept_budgets WHERE company_id = ? AND fy_id = ? AND cost_centre_id = ? AND id <> ? AND deleted_at IS NULL ORDER BY version_no').all(actor.companyId, r.fyId, r.costCentreId, r.id)) out.push({ kind: 'dept_budget', label: `${v.doc_no} version ${v.version_no} (${DEPT_STATUS[v.status]})`, to: `/bud/dept-budget?id=${v.id}`, direction: v.version_no < r.versionNo ? 'in' : 'out' });
      return out;
    } catch { return []; }
  },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'bud.dept_budget.view').allowed) return []; return db.prepare("SELECT id FROM bud_dept_budgets WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?").all(actor.companyId, `${q}%`, limit).map((x) => ({ id: x.id })); },
});
fileEntities.register({
  entity: 'bud_dept_budget', label: 'Department budget (working papers, approvals and minutes)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, department_id, status FROM bud_dept_budgets WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, ...(r.department_id != null ? { departmentId: r.department_id } : {}) }).allowed;
    if (!at('bud.dept_budget.view')) return null;
    return { companyId: r.company_id, projectId: null, siteId: null, canView: true, canEdit: at('bud.dept_budget.edit'), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});
