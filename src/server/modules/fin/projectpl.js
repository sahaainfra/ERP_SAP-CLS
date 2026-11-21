import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.12: the project P&L and profitability.
//  FR-01 the structure of the P&L: lines and the accounts or account groups each takes (the longest group code wins; an account named wins over a group; the
//  catch-all line takes what no line names, so nothing of the ledger is left out); the template, copied for a company when it is changed.
//  FR-02 the P&L of a project for a month and to date from the ledger (the revenue recognised by 23.10 is in it); the budget P&L from the contract revenue
//  and the approved budget (12.01: each line's cost code → cost head → its account → the P&L line); the forecast P&L from the approved forecast (23.11).
//  FR-03 margins (% of revenue) and drill-down from a line to its journal lines and their source documents.
//  FR-04 the snapshot of a month, frozen when the CFO approves it (ACCMGR → CFO), only when its totals equal the ledger's for the project and month (BR-01)
//  and the ledger has not changed since it was worked out; a frozen snapshot is never changed.
//  FR-05 the portfolio: projects ranked by margin, by sector (project type), region (branch) and client; loss-making projects; the PM sees his projects with the
//  corporate overhead masked (without fin.pl.view_overheads).

export const SNAPSHOT_DOC = 'FIN_PL_SNAPSHOT';
const rs = (p) => (p == null ? null : p / 100);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(lastDay(y, m)).padStart(2, '0')}`; };
const fyStart = (d) => { const y = Number(d.slice(0, 4)); return `${Number(d.slice(5, 7)) >= 4 ? y : y - 1}-04-01`; };

/** The P&L line of an account: an account named in a line's mapping, else the line whose group code is the longest prefix of the account's group, else the catch-all. */
export function lineOfAccount(structure, account) {
  for (const l of structure) if ((l.map.accounts ?? []).includes(account.code)) return l.line_code;
  let best = null; let len = -1; for (const l of structure) for (const g of l.map.groups ?? []) if (String(account.grp).startsWith(g) && g.length > len) { best = l.line_code; len = g.length; }
  return best ?? structure.find((l) => l.catch_all)?.line_code ?? null;
}
/** The lines of a P&L from amounts by line code (revenue positive as credit, costs positive as debit): the subtotals worked out in order of the structure. */
export function plLines(structure, amounts) {
  let revenue = 0; let costs = 0; const out = [];
  for (const l of structure) {
    if (l.line_type === 'REVENUE') { const v = amounts[l.line_code] ?? 0; revenue += v; out.push({ code: l.line_code, name: l.name, type: l.line_type, overhead: Boolean(l.overhead), amount: v }); }
    else if (l.line_type === 'COST') { const v = amounts[l.line_code] ?? 0; costs += v; out.push({ code: l.line_code, name: l.name, type: l.line_type, overhead: Boolean(l.overhead), amount: v }); }
    else out.push({ code: l.line_code, name: l.name, type: l.line_type, overhead: l.line_type === 'OPERATING_PROFIT', amount: revenue - costs, subtotal: true });
  }
  return out.map((x) => ({ ...x, pct: revenue ? Math.round((x.amount * 10000) / revenue) / 100 : null }));
}

export const snapshotList = defineList({
  code: 'fin.pl_snapshots', label: 'P&L snapshots', permission: 'fin.pl_snapshot.view',
  from: 'pl_snapshots x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 'p.name'], defaultSort: '-period',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Snapshot' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, period: { sql: 'x.period', type: 'text', label: 'Month' }, revenue: { sql: '(x.revenue_paise / 100.0)', type: 'money', label: 'Revenue', total: true }, grossProfit: { sql: '(x.gross_profit_paise / 100.0)', type: 'money', label: 'Gross profit', total: true }, frozenAt: { sql: "COALESCE(x.frozen_at, '')", type: 'text', label: 'Frozen' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) } },
});

/** @param {{ db: any, base: any, flags: any }} o */
export function createProjectPlService({ db, base, flags }) {
  const { may, audit, notify, authz } = base;
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2312');
  const evt = (type, actor, companyId, entity, entityId, data, projectId = undefined) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId, data });
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const projOf = (id) => db.prepare('SELECT id, company_id, code, name, type, branch_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(Number(id)) ?? null;
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };
  const periodId = (companyId, date) => db.prepare('SELECT id FROM core_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(companyId, date, date)?.id ?? null;
  const scope = (actor, key) => { need(actor, key, 'see P&L snapshots'); const f = authz.scopeFilter(actor, key, { project: 'x.org_project_id' }); return `x.company_id = :c AND ${f.sql}`; };

  // ---- FR-01: the structure ----
  const structureOf = (companyId) => { const own = db.prepare('SELECT * FROM pl_structure WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort, id').all(companyId); const rows = own.length ? own : db.prepare('SELECT * FROM pl_structure WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY sort, id').all();
    return rows.map((r) => { let map; try { map = JSON.parse(r.mapping_json); } catch { map = {}; } return { ...r, map }; }); };
  const accountsOf = (companyId) => db.prepare("SELECT a.id, a.code, a.name, g.code AS grp FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id = ? AND a.deleted_at IS NULL AND (g.code LIKE '4%' OR g.code LIKE '5%')").all(companyId);
  const lineMap = (companyId) => { const s = structureOf(companyId); const m = new Map(); for (const a of accountsOf(companyId)) m.set(a.id, lineOfAccount(s, a)); return { structure: s, map: m }; };
  const structure = {
    get(actor) { need(actor, 'fin.pl.view', 'see the P&L structure'); const s = structureOf(actor.companyId); const accts = accountsOf(actor.companyId);
      return { own: Boolean(db.prepare('SELECT 1 FROM pl_structure WHERE company_id = ? AND deleted_at IS NULL').get(actor.companyId)), lines: s.map((l) => ({ code: l.line_code, name: l.name, type: l.line_type, accounts: l.map.accounts ?? [], groups: l.map.groups ?? [], catchAll: Boolean(l.catch_all), overhead: Boolean(l.overhead), sort: l.sort, takes: accts.filter((a) => lineOfAccount(s, a) === l.line_code).map((a) => `${a.code} ${a.name}`) })), canConfigure: may(actor, 'fin.pl.configure') }; },
    /** A line's mapping changed: the company's own copy of the structure is made from the template first. An account is named by one line only. */
    setLine(actor, code, b) {
      need(actor, 'fin.pl.configure', 'change the P&L structure'); const c = actor.companyId;
      return transaction(db, () => {
        if (!db.prepare('SELECT 1 FROM pl_structure WHERE company_id = ? AND deleted_at IS NULL').get(c)) for (const t of db.prepare('SELECT * FROM pl_structure WHERE company_id IS NULL AND deleted_at IS NULL').all()) db.prepare("INSERT INTO pl_structure (company_id, line_code, name, line_type, mapping_json, catch_all, overhead, sort, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pl_structure')").run(c, t.line_code, t.name, t.line_type, t.mapping_json, t.catch_all, t.overhead, t.sort, actor.user);
        const l = db.prepare('SELECT * FROM pl_structure WHERE company_id = ? AND line_code = ? AND deleted_at IS NULL').get(c, code); if (!l) throw notFound('That P&L line does not exist.');
        if (['GROSS_PROFIT', 'OPERATING_PROFIT'].includes(l.line_type)) throw unprocessable('A subtotal takes no accounts.');
        const known = new Set(accountsOf(c).map((a) => a.code)); const bad = (b.accounts ?? []).filter((a) => !known.has(a)); if (bad.length) throw badRequest('Correct the highlighted fields', [{ field: 'accounts', message: `Not income or expense accounts of the company: ${bad.join(', ')}` }]);
        const others = db.prepare('SELECT line_code, mapping_json FROM pl_structure WHERE company_id = ? AND line_code <> ? AND deleted_at IS NULL').all(c, code); const dup = (b.accounts ?? []).filter((a) => others.some((o) => (JSON.parse(o.mapping_json).accounts ?? []).includes(a)));
        if (dup.length) throw badRequest('Correct the highlighted fields', [{ field: 'accounts', message: `Already named by another line: ${dup.join(', ')}` }]);
        const before = l.mapping_json; const mapping = JSON.stringify({ accounts: b.accounts ?? [], groups: b.groups ?? [] });
        db.prepare('UPDATE pl_structure SET name = ?, mapping_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name ?? l.name, mapping, actor.user, nowIso(), l.id);
        audit(actor, 'pl_structure', l.id, 'update', c, { oldValues: { mapping: before }, newValues: { mapping } }); return structure.get(actor);
      });
    },
  };

  // ---- FR-02: actual, budget and forecast of a project ----
  const POSTED = "j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL";
  /** By account: credit − debit of the project's posted income and expense lines in [from, to]; the count and last line id (to see the ledger change). */
  function glOf(companyId, projectId, from, to) {
    const rows = db.prepare(`SELECT l.account_id, g.code AS grp, SUM(l.credit_paise - l.debit_paise) AS net, COUNT(*) AS n, MAX(l.id) AS maxid FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id
      WHERE j.company_id = ? AND l.project_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? AND (g.code LIKE '4%' OR g.code LIKE '5%') GROUP BY l.account_id`).all(companyId, projectId, from, to);
    return { rows, total: rows.reduce((a, r) => a + r.net, 0), count: rows.reduce((a, r) => a + r.n, 0), maxId: rows.reduce((a, r) => Math.max(a, r.maxid ?? 0), 0) };
  }
  function actual(companyId, projectId, from, to, lm = lineMap(companyId)) {
    const g = glOf(companyId, projectId, from, to); const types = new Map(lm.structure.map((l) => [l.line_code, l.line_type])); const amounts = {};
    for (const r of g.rows) { const code = lm.map.get(r.account_id); if (!code) continue; amounts[code] = (amounts[code] ?? 0) + (types.get(code) === 'REVENUE' ? r.net : -r.net); }
    const lines = plLines(lm.structure, amounts); return { lines, gl: g, plTotal: lines.find((x) => x.type === 'OPERATING_PROFIT')?.amount ?? 0 };
  }
  const contractRevenue = (projectId) => (has('ctr_contracts') ? db.prepare("SELECT COALESCE(SUM(CASE WHEN revised_paise > 0 THEN revised_paise ELSE original_paise + amended_paise + variation_paise END), 0) AS v FROM ctr_contracts WHERE org_project_id = ? AND status = 'APPROVED' AND contract_state IN ('ACTIVE', 'COMPLETED', 'CLOSED') AND deleted_at IS NULL").get(projectId).v : 0);
  /** A cost code's P&L line: its cost head's default account through the structure. */
  const codeLine = (companyId, lm, costCodeId, fallback) => { if (!costCodeId) return fallback; const a = db.prepare('SELECT a.id FROM fin_cost_codes c JOIN fin_cost_heads h ON h.id = c.cost_head_id JOIN fin_accounts a ON a.company_id = ? AND a.code = h.default_account_code AND a.deleted_at IS NULL WHERE c.id = ?').get(companyId, costCodeId); return (a && lm.map.get(a.id)) || fallback; };
  const revenueLine = (lm) => lm.structure.find((l) => l.line_type === 'REVENUE')?.line_code ?? 'REVENUE'; const otherLine = (lm) => lm.structure.find((l) => l.catch_all)?.line_code ?? 'OTHER';
  function budget(companyId, projectId, lm = lineMap(companyId)) {
    const b = has('bud_budgets') ? db.prepare("SELECT * FROM bud_budgets WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1").get(projectId) : null; if (!b) return null;
    const amounts = { [revenueLine(lm)]: contractRevenue(projectId) }; const site = lm.structure.find((l) => l.line_code === 'SITE_OVERHEAD') ? 'SITE_OVERHEAD' : otherLine(lm);
    for (const l of db.prepare('SELECT line_kind, cost_code_id, SUM(amount) AS a FROM bud_lines WHERE budget_id = ? AND deleted_at IS NULL GROUP BY line_kind, cost_code_id').all(b.id)) { const code = codeLine(companyId, lm, l.cost_code_id, l.line_kind === 'OVERHEAD' ? site : otherLine(lm)); amounts[code] = (amounts[code] ?? 0) + l.a; }
    return { ref: `${b.doc_no} v${b.version_no}`, lines: plLines(lm.structure, amounts) };
  }
  function forecast(companyId, projectId, period, lm = lineMap(companyId)) {
    const f = has('fc_forecasts') ? db.prepare("SELECT * FROM fc_forecasts WHERE org_project_id = ? AND period <= ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period DESC, version_no DESC LIMIT 1").get(projectId, period) : null; if (!f) return null;
    const amounts = { [revenueLine(lm)]: contractRevenue(projectId) };
    for (const l of db.prepare('SELECT cost_code_id, SUM(eac_paise) AS a FROM fc_forecast_lines WHERE forecast_id = ? AND deleted_at IS NULL GROUP BY cost_code_id').all(f.id)) { const code = codeLine(companyId, lm, l.cost_code_id, otherLine(lm)); amounts[code] = (amounts[code] ?? 0) + l.a; }
    amounts[otherLine(lm)] = (amounts[otherLine(lm)] ?? 0) + f.risk_allowance_paise + f.pending_var_cost_paise;
    return { ref: `${f.doc_no} v${f.version_no} (${f.period})`, lines: plLines(lm.structure, amounts) };
  }
  const masked = (actor, lines) => (may(actor, 'fin.pl.view_overheads') ? lines : lines.map((l) => (l.overhead ? { ...l, amount: null, pct: null, masked: true } : l)));
  const money = (lines) => lines.map((l) => ({ ...l, amount: l.amount == null ? null : rs(l.amount) }));
  const projectOk = (actor, projectId, key, what) => { const p = projOf(projectId); if (!p || p.company_id !== actor.companyId) throw notFound('That project does not exist.'); need(actor, key, what, p.id); return p; };
  const pl = {
    /** The projects whose P&L the actor may see (for the picker). */
    projects(actor) { need(actor, 'fin.pl.view', 'see the project P&L'); return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500").all(actor.companyId).filter((p) => may(actor, 'fin.pl.view', p.id)).map((p) => ({ projectId: p.id, project: `${p.code} ${p.name}` })); },
    /** FR-02, FR-03: the P&L of a project: the month, to date (life of the project), budget and forecast side by side, with the frozen snapshot if any. */
    project(actor, { projectId, period }) {
      const p = projectOk(actor, projectId, 'fin.pl.view', 'see the project P&L'); const c = actor.companyId; const lm = lineMap(c); const end = monthEnd(period);
      const month = actual(c, p.id, `${period}-01`, end, lm); const cum = actual(c, p.id, '0000-01-01', end, lm); const ytd = actual(c, p.id, fyStart(end), end, lm); const bud = budget(c, p.id, lm); const fc = forecast(c, p.id, period, lm);
      const snap = db.prepare("SELECT id, doc_no, status, frozen_at FROM pl_snapshots WHERE org_project_id = ? AND period = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(p.id, period);
      const trend = []; for (let k = 5; k >= 0; k -= 1) { const d = new Date(`${period}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); const per = d.toISOString().slice(0, 7); const a = actual(c, p.id, `${per}-01`, monthEnd(per), lm); trend.push({ period: per, revenue: rs(a.lines.find((x) => x.type === 'REVENUE')?.amount ?? 0), grossProfit: rs(a.lines.find((x) => x.type === 'GROSS_PROFIT')?.amount ?? 0) }); }
      return { projectId: p.id, project: `${p.code} ${p.name}`, period, month: money(masked(actor, month.lines)), ytd: money(masked(actor, ytd.lines)), cumulative: money(masked(actor, cum.lines)), budget: bud ? { ref: bud.ref, lines: money(masked(actor, bud.lines)) } : null, forecast: fc ? { ref: fc.ref, lines: money(masked(actor, fc.lines)) } : null,
        reconciled: { gl: rs(cum.gl.total), pl: rs(cum.plTotal), equal: cum.gl.total === cum.plTotal }, snapshot: snap ? { id: snap.id, docNo: snap.doc_no, status: snap.status, frozenAt: snap.frozen_at } : null, trend, overheadsMasked: !may(actor, 'fin.pl.view_overheads'), canSnapshot: may(actor, 'fin.pl_snapshot.create', p.id) };
    },
    /** FR-03: the journal lines behind a P&L line of a project in [from, to], with their source documents (latest 200). */
    drill(actor, { projectId, line, from, to }) {
      const p = projectOk(actor, projectId, 'fin.pl.view', 'see the project P&L'); const lm = lineMap(actor.companyId); const l = lm.structure.find((x) => x.line_code === line); if (!l) throw notFound('That P&L line does not exist.');
      if (l.overhead && !may(actor, 'fin.pl.view_overheads')) throw forbidden('You may not see the corporate overhead (permission fin.pl.view_overheads).');
      const ids = [...lm.map.entries()].filter(([, code]) => code === line).map(([id]) => id); if (!ids.length) return { line, rows: [] };
      const rows = db.prepare(`SELECT j.id AS jid, j.voucher_no, j.doc_no, j.voucher_date, j.narration, j.source_type, j.source_id, a.code, a.name, l.debit_paise, l.credit_paise FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = ? AND l.project_id = ? AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? AND l.account_id IN (${ids.map(() => '?').join(',')}) ORDER BY j.voucher_date DESC, l.id DESC LIMIT 200`).all(actor.companyId, p.id, from, to, ...ids);
      return { line, name: l.name, rows: rows.map((r) => ({ journalId: r.jid, voucherNo: r.voucher_no ?? r.doc_no, date: r.voucher_date, narration: r.narration, source: r.source_type ? `${r.source_type} ${r.source_id ?? ''}`.trim() : null, account: `${r.code} ${r.name}`, debit: rs(r.debit_paise), credit: rs(r.credit_paise) })) };
    },
  };

  // ---- FR-04: the snapshot ----
  function compute(companyId, projectId, period) {
    const lm = lineMap(companyId); const end = monthEnd(period); const month = actual(companyId, projectId, `${period}-01`, end, lm); const cum = actual(companyId, projectId, '0000-01-01', end, lm);
    const g = (lines, type) => lines.find((x) => x.type === type)?.amount ?? 0; const bud = budget(companyId, projectId, lm); const fc = forecast(companyId, projectId, period, lm);
    return { lines: month.lines.map((l) => ({ ...l, cumulative: cum.lines.find((x) => x.code === l.code)?.amount ?? 0 })), revenue: g(month.lines, 'REVENUE'), gross: g(month.lines, 'GROSS_PROFIT'), operating: g(month.lines, 'OPERATING_PROFIT'), revenueCum: g(cum.lines, 'REVENUE'), operatingCum: g(cum.lines, 'OPERATING_PROFIT'), glTotal: month.gl.total, plTotal: month.plTotal, glCount: month.gl.count, glMax: month.gl.maxId, budget: bud ?? {}, forecast: fc ?? {} };
  }
  const cols = (x) => ({ lines_json: JSON.stringify(x.lines), revenue_paise: x.revenue, gross_profit_paise: x.gross, operating_profit_paise: x.operating, revenue_cum_paise: x.revenueCum, operating_profit_cum_paise: x.operatingCum, gl_total_paise: x.glTotal, pl_total_paise: x.plTotal, gl_lines_count: x.glCount, gl_max_line_id: x.glMax, budget_json: JSON.stringify(x.budget), forecast_json: JSON.stringify(x.forecast) });
  const flow = createFlow({ db, base, docType: SNAPSHOT_DOC, table: 'pl_snapshots', perm: 'fin.pl_snapshot', label: 'P&L snapshot', route: '/finance/project-pl?snapshot=', where: (r) => ({ pid: r.org_project_id, sid: null }),
    ctx: (r) => ({ total: rs(r.revenue_paise), period: r.period, makerRole: rolesOf(r.company_id, r.requested_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER' }), title: (r) => `P&L of ${projOf(r.org_project_id)?.code ?? ''} for ${r.period}: revenue ₹${rs(r.revenue_paise)}, operating profit ₹${rs(r.operating_profit_paise)}`, notifyCode: 'fin.pl.decided', prefix: 'PLS',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('The project P&L is off for the company (ff.fin.p2312).'); const x = compute(r.company_id, r.org_project_id, r.period); if (x.glTotal !== x.plTotal) throw conflict(`The P&L (₹${rs(x.plTotal)}) does not equal the ledger (₹${rs(x.glTotal)}) for the project and month: correct the P&L structure first (BR-01).`); const v = cols(x); db.prepare(`UPDATE pl_snapshots SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(v), r.id); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM pl_snapshots WHERE id = ?').get(r.id); const g = glOf(x.company_id, x.org_project_id, `${x.period}-01`, monthEnd(x.period));
      // BR-01: frozen only as it was worked out: the ledger of the project and month must not have changed since
      if (g.total !== x.gl_total_paise || g.count !== x.gl_lines_count || g.maxId !== x.gl_max_line_id) throw conflict('The ledger of this project and month changed after the snapshot was worked out: return it to be worked out again.');
      db.prepare('UPDATE pl_snapshots SET frozen_at = ?, period_id = ? WHERE id = ?').run(nowIso(), periodId(x.company_id, monthEnd(x.period)), x.id);
      if (x.amends_id) db.prepare("UPDATE pl_snapshots SET status = 'SUPERSEDED', updated_at = ? WHERE id = ? AND status = 'APPROVED'").run(nowIso(), x.amends_id);
      evt('fin.pl_snapshot.frozen', actor, x.company_id, 'pl_snapshots', x.id, { snapshotId: x.id, docNo: x.doc_no, projectId: x.org_project_id, period: x.period, revenue: rs(x.revenue_paise), grossProfit: rs(x.gross_profit_paise), operatingProfit: rs(x.operating_profit_paise), revenueToDate: rs(x.revenue_cum_paise), operatingProfitToDate: rs(x.operating_profit_cum_paise) }, x.org_project_id);
    },
  });
  const snapView = (actor, r, detail = false) => {
    const p = projOf(r.org_project_id); const lines = (() => { try { return JSON.parse(r.lines_json); } catch { return []; } })(); const showOh = may(actor, 'fin.pl.view_overheads');
    const o = { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, project: p ? `${p.code} ${p.name}` : null, period: r.period, revenue: rs(r.revenue_paise), grossProfit: rs(r.gross_profit_paise), operatingProfit: showOh ? rs(r.operating_profit_paise) : null, revenueToDate: rs(r.revenue_cum_paise), glTotal: showOh ? rs(r.gl_total_paise) : null, plTotal: showOh ? rs(r.pl_total_paise) : null, reconciled: r.gl_total_paise === r.pl_total_paise, frozenAt: r.frozen_at, amendsId: r.amends_id, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version,
      can: { ...flow.can(actor, r), recompute: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'fin.pl_snapshot.edit', r.org_project_id), amend: r.status === 'APPROVED' && may(actor, 'fin.pl_snapshot.amend', r.org_project_id) } };
    if (detail) { Object.assign(o.can, flow.approveInfo(actor, r)); o.lines = lines.map((l) => (l.overhead && !showOh ? { ...l, amount: null, cumulative: null, pct: null, masked: true } : { ...l, amount: rs(l.amount), cumulative: rs(l.cumulative) })); o.history = flow.history(actor, r.id); }
    return o;
  };
  const snapshots = {
    flow,
    list(actor, query) { return runList(db, snapshotList, parseListRequest(snapshotList, query), { select: 'x.*', scopeSql: scope(actor, 'fin.pl_snapshot.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => snapView(actor, r) }); },
    get(actor, id) { return snapView(actor, flow.row(actor, id), true); },
    create(actor, { projectId, period }) {
      const p = projectOk(actor, projectId, 'fin.pl_snapshot.create', 'make P&L snapshots'); if (period >= todayIST().slice(0, 7)) throw badRequest('Correct the highlighted fields', [{ field: 'period', message: 'A snapshot is made of a month that has ended.' }]);
      if (db.prepare("SELECT 1 FROM pl_snapshots WHERE org_project_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(p.id, period)) throw conflict('The month is frozen for this project: a frozen snapshot is not changed.');
      const x = compute(actor.companyId, p.id, period); const v = cols(x);
      return transaction(db, () => { let id; try { id = Number(db.prepare(`INSERT INTO pl_snapshots (company_id, doc_no, org_project_id, period, ${Object.keys(v).join(', ')}, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ${Object.keys(v).map(() => '?').join(', ')}, ?, ?, 'api')`).run(actor.companyId, flow.next(actor), p.id, period, ...Object.values(v), actor.user, actor.user).lastInsertRowid); } catch (e) { if (/UNIQUE/.test(String(e.message))) throw conflict('A snapshot of this project and month is already open.'); throw e; }
        audit(actor, 'pl_snapshots', id, 'create', actor.companyId, { newValues: { project: p.code, period, revenue: rs(x.revenue), operating: rs(x.operating) } }); return snapshots.get(actor, id); });
    },
    recompute(actor, id) { const r = flow.row(actor, id, 'fin.pl_snapshot.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned snapshot is worked out again.'); const v = cols(compute(r.company_id, r.org_project_id, r.period)); db.prepare(`UPDATE pl_snapshots SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...Object.values(v), actor.user, nowIso(), r.id); audit(actor, 'pl_snapshots', r.id, 'recompute', r.company_id); return snapshots.get(actor, r.id); },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return snapshots.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return snapshots.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return snapshots.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    /** A frozen snapshot is never changed: a correction (after a prior-period adjustment) is a new snapshot that supersedes it when approved. */
    amend(actor, id, { reason }) {
      const r = flow.row(actor, id, 'fin.pl_snapshot.amend'); if (r.status !== 'APPROVED') throw conflict('Only a frozen snapshot is amended.'); if (db.prepare("SELECT 1 FROM pl_snapshots WHERE org_project_id = ? AND period = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.org_project_id, r.period)) throw conflict('An amendment is already open.');
      const v = cols(compute(r.company_id, r.org_project_id, r.period));
      return transaction(db, () => { const nid = Number(db.prepare(`INSERT INTO pl_snapshots (company_id, doc_no, org_project_id, period, amends_id, ${Object.keys(v).join(', ')}, requested_by, created_by, source_type, remarks) VALUES (?, ?, ?, ?, ?, ${Object.keys(v).map(() => '?').join(', ')}, ?, ?, 'pl_snapshots', ?)`).run(r.company_id, `${r.doc_no}-A${(db.prepare('SELECT COUNT(*) AS n FROM pl_snapshots WHERE amends_id = ?').get(r.id).n ?? 0) + 1}`, r.org_project_id, r.period, r.id, ...Object.values(v), actor.user, actor.user, reason).lastInsertRowid); audit(actor, 'pl_snapshots', nid, 'amend', r.company_id, { reason: `amends ${r.doc_no}: ${reason}` }); return snapshots.get(actor, nid); });
    },
    print(actor, id) { const r = flow.row(actor, id, 'fin.pl_snapshot.print'); const v = snapView(actor, r, true); audit(actor, 'pl_snapshots', r.id, 'print', r.company_id); const m = (x) => (x == null ? '—' : x.toFixed(2));
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `P&L ${v.project} · ${v.period} (${r.doc_no})`, columns: [{ key: 'l', label: 'Line', type: 'text' }, { key: 'm', label: 'Month' }, { key: 'p', label: '% of revenue', type: 'text' }, { key: 'c', label: 'To date' }], rows: v.lines.map((l) => ({ l: l.name, m: m(l.amount), p: l.pct == null ? '' : `${l.pct} %`, c: m(l.cumulative) })), footer: [`${v.frozenAt ? `Frozen ${v.frozenAt}` : v.statusLabel}. Ledger ${m(v.glTotal)}, P&L ${m(v.plTotal)}${v.reconciled ? ' — equal' : ' — NOT EQUAL'}.`] }) }; },
    exportCsv(actor, query = {}) { need(actor, 'fin.pl_snapshot.export', 'export P&L snapshots'); const l = snapshots.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'pl_snapshots', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `pl-snapshots-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Snapshot', 'Project', 'Month', 'Revenue', 'Gross profit', 'Operating profit', 'Revenue to date', 'Frozen', 'Status'], l.data.map((x) => [x.docNo, x.project, x.period, x.revenue, x.grossProfit, x.operatingProfit ?? '', x.revenueToDate, x.frozenAt ?? '', x.statusLabel]))}`, 'utf8') }; },
  };

  // ---- FR-05: the portfolio ----
  /** Profitability of every project the actor may see over [from, to] from the ledger, ranked by gross margin; segments by sector, region and client. */
  function portfolio(actor, { from, to }) {
    need(actor, 'fin.pl.view', 'see profitability'); const c = actor.companyId; const lm = lineMap(c); const types = new Map(lm.structure.map((l) => [l.line_code, l.line_type])); const showOh = may(actor, 'fin.pl.view_overheads'); const ohLines = new Set(lm.structure.filter((l) => l.overhead).map((l) => l.line_code));
    const per = new Map(); for (const r of db.prepare(`SELECT l.project_id AS pid, l.account_id, SUM(l.credit_paise - l.debit_paise) AS net FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_account_groups g ON g.id = a.group_id WHERE j.company_id = ? AND l.project_id IS NOT NULL AND ${POSTED} AND j.voucher_date BETWEEN ? AND ? AND (g.code LIKE '4%' OR g.code LIKE '5%') GROUP BY l.project_id, l.account_id`).all(c, from, to)) {
      const code = lm.map.get(r.account_id); if (!code) continue; if (!per.has(r.pid)) per.set(r.pid, {}); const a = per.get(r.pid); a[code] = (a[code] ?? 0) + (types.get(code) === 'REVENUE' ? r.net : -r.net); }
    const clientOf = (pid) => (has('ctr_contracts') ? db.prepare("SELECT m.legal_name FROM ctr_contracts k JOIN mdm_partners m ON m.id = k.client_partner_id WHERE k.org_project_id = ? AND k.status = 'APPROVED' AND k.deleted_at IS NULL ORDER BY k.id LIMIT 1").get(pid)?.legal_name ?? null : null);
    const regionOf = (bid) => (bid ? db.prepare('SELECT name FROM org_branches WHERE id = ?').get(bid)?.name ?? null : null);
    const rows = [...per.entries()].filter(([pid]) => may(actor, 'fin.pl.view', pid)).map(([pid, a]) => { const p = projOf(pid); const lines = plLines(lm.structure, a); const v = (t) => lines.find((x) => x.type === t)?.amount ?? 0; const rev = v('REVENUE'); const gp = v('GROSS_PROFIT'); const op = v('OPERATING_PROFIT'); const oh = [...ohLines].reduce((s, k) => s + (a[k] ?? 0), 0);
      return { projectId: pid, project: p ? `${p.code} ${p.name}` : String(pid), sector: p?.type ?? null, region: regionOf(p?.branch_id) ?? 'No region', client: clientOf(pid) ?? 'No client', revenue: rs(rev), grossProfit: rs(gp), grossMarginPct: rev ? Math.round((gp * 10000) / rev) / 100 : null, overhead: showOh ? rs(oh) : null, operatingProfit: showOh ? rs(op) : null, operatingMarginPct: showOh && rev ? Math.round((op * 10000) / rev) / 100 : null, lossMaking: gp < 0 }; })
      .sort((x, y) => (y.grossMarginPct ?? -1e9) - (x.grossMarginPct ?? -1e9));
    const seg = (k) => { const m = new Map(); for (const r of rows) { const s = m.get(r[k]) ?? { name: r[k], revenue: 0, grossProfit: 0, projects: 0 }; s.revenue += Math.round(r.revenue * 100); s.grossProfit += Math.round(r.grossProfit * 100); s.projects += 1; m.set(r[k], s); } return [...m.values()].map((s) => ({ ...s, revenue: rs(s.revenue), grossProfit: rs(s.grossProfit), grossMarginPct: s.revenue ? Math.round((s.grossProfit * 10000) / s.revenue) / 100 : null })).sort((a, b) => b.revenue - a.revenue); };
    const tot = (k) => rs(rows.reduce((s, r) => s + Math.round((r[k] ?? 0) * 100), 0)); const revenue = tot('revenue'); const gp = tot('grossProfit');
    const pendingFreeze = db.prepare("SELECT COUNT(*) AS n FROM pl_snapshots WHERE company_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(c).n;
    return { from, to, kpis: { revenue, grossProfit: gp, grossMarginPct: revenue ? Math.round((gp * 10000) / revenue) / 100 : null, operatingProfit: showOh ? tot('operatingProfit') : null, projects: rows.length, lossMaking: rows.filter((r) => r.lossMaking).length, snapshotsWaiting: pendingFreeze }, rows, segments: { sector: seg('sector'), region: seg('region'), client: seg('client') }, exceptions: rows.filter((r) => r.lossMaking).slice(0, 10), overheadsMasked: !showOh };
  }

  // ---- Project 360 (10.08) and the monthly reminder ----
  function widget(actor, projectId) {
    if (!on(actor.companyId)) return { figures: [], rows: [], note: 'The project P&L is not enabled for your company yet.' }; if (!may(actor, 'fin.pl.view', projectId)) return { figures: [], rows: [], note: 'You have no right to see the P&L of this project.' };
    const c = actor.companyId; const lm = lineMap(c); const t = todayIST(); const a = actual(c, projectId, fyStart(t), t, lm); const v = (k) => a.lines.find((x) => x.type === k)?.amount ?? 0;
    return { figures: [{ label: 'Revenue (year to date)', value: rs(v('REVENUE')), kind: 'money' }, { label: 'Gross profit', value: rs(v('GROSS_PROFIT')), kind: 'money' }, { label: 'Gross margin', value: v('REVENUE') ? `${Math.round((v('GROSS_PROFIT') * 1000) / v('REVENUE')) / 10} %` : '—' }], rows: [], link: `/finance/project-pl?projectId=${projectId}` };
  }
  const jobs = {
    /** From the 15th: projects with income or cost last month and no frozen snapshot are told to the accounts manager. */
    remind() { let n = 0; const today = todayIST(); if (Number(today.slice(8, 10)) < 15) return { reminded: 0 }; const [y, m] = today.slice(0, 7).split('-').map(Number); const last = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
      for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!on(c.id)) continue; const k = db.prepare("SELECT COUNT(DISTINCT l.project_id) AS n FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE j.company_id = ? AND j.status = 'APPROVED' AND l.project_id IS NOT NULL AND j.voucher_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM pl_snapshots s WHERE s.org_project_id = l.project_id AND s.period = ? AND s.status = 'APPROVED' AND s.deleted_at IS NULL)").get(c.id, `${last}-01`, monthEnd(last), last).n; if (!k) continue; n += 1; notify(c.id, 'fin.pl.alert', ['permission:fin.pl_snapshot.create'], last, 'P&L to freeze', `${k} project(s) have no frozen P&L snapshot for ${last}.`, '/finance/project-pl', `${c.id}-${last}`); }
      return { reminded: n }; },
  };
  function* approvedMetricFacts(companyId, asOf, projectId = null) {
    const facts = db.prepare(`SELECT * FROM (
      SELECT s.org_project_id AS projectId, s.id AS sourceId, s.period AS sourcePeriod,
        s.version AS sourceVersion, s.revenue_paise AS revenue, s.gross_profit_paise AS profit,
        ROW_NUMBER() OVER (PARTITION BY s.org_project_id ORDER BY s.period DESC, s.id DESC) AS newest
      FROM pl_snapshots s JOIN org_projects p ON p.id = s.org_project_id
        AND p.company_id = s.company_id AND p.deleted_at IS NULL
      WHERE s.company_id = :companyId AND s.period <= :period AND s.status = 'APPROVED'
        AND s.frozen_at IS NOT NULL AND s.deleted_at IS NULL
        ${projectId == null ? '' : 'AND s.org_project_id = :projectId'}
    ) WHERE newest = 1`).iterate({ companyId, period: asOf.slice(0, 7), ...(projectId == null ? {} : { projectId }) });
    for (const { revenue, profit, projectId: id, sourceId, sourcePeriod, sourceVersion } of facts) {
      yield { projectId: id, sourceId, sourcePeriod, sourceVersion,
        grossMargin: revenue ? Math.round((profit * 10000) / revenue) : null };
    }
  }
  return { structure, pl, snapshots, portfolio, widget, jobs, approvedMetricFacts };
}
