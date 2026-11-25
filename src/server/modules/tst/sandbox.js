import { randomUUID } from 'node:crypto';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { sandboxOf } from '../../platform/sandbox/index.js';
import { todayIST } from '../../../shared/dates.js';
import { isoOf, ordOf } from '../plan/cpm.js';

/**
 * Part 30.04 FR-03 … FR-05, BR-01: the simulation sandbox.
 *
 * The sandbox is an installation started with ERP_SANDBOX=true on a database of its own (platform/sandbox: nothing leaves it; the shell shows
 * a SANDBOX banner). Here, and only there:
 *  - generate: a synthetic company (code SBX-n) with its people (one per role the threads need), masters (items, partners), four projects with
 *    sites, WBS, BOQ with norms, an approved budget, schedule and baseline, a store, and twelve months of transactions (daily progress reports
 *    through the progress engine, stock receipts and issues through the stock API). Every row is written with foreign keys on.
 *  - reset: one click removes every synthetic company and everything that belongs to it, then generates a fresh one.
 *  - scenario packs (FR-04): each run builds its own project and executes the business thread through the HTTP API, as the people of the
 *    company would (reports, a progress period submitted and approved, stock movements, a material reconciliation), then reads the KPI back
 *    through the API and compares it with the expected value of the pack:
 *      DELAYED       a project behind its baseline: SPI 0.76 (planned 50 %, done 38 %), CPI 0.9048;
 *      LOSS_MAKING   on time but over cost: SPI 1, CPI 0.8, EAC Rs 12,50,000 on a budget of Rs 10,00,000;
 *      HIGH_WASTAGE  cement issued beyond the norm: 300 bags against 240, wastage 25 % over the 5 % allowed.
 * A real installation refuses all of this (409): synthetic data never reaches production data (BR-01).
 */
export const SANDBOX_FLAG = 'ff.qa.p3004';
const iso = (d = new Date()) => d.toISOString();
const ROLES = { sysadm: 'SYSADM', plan: 'PLAN', pm: 'PM', cm: 'CM', qs: 'QS', store1: 'STOREMGR', store2: 'STOREMGR', sk: 'SK', hr: 'HRMGR' };
export const PACKS = Object.freeze({
  DELAYED: { label: 'Delayed project', kpis: { spi: 0.76, planned: 50, physical: 38, cpi: 0.9048 }, check: 'SPI below 0.9' },
  LOSS_MAKING: { label: 'Loss-making project', kpis: { spi: 1, cpi: 0.8, eac: 1_250_000 }, check: 'CPI below 1 and EAC above the budget' },
  HIGH_WASTAGE: { label: 'High wastage', kpis: { theoreticalBase: 240, actual: 300, wastagePct: 25, overAllowed: true }, check: 'Wastage above the allowed 5 %' },
});

integrityRegistry.register({ statuses: { tst_sandbox_runs: ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] } });

/** @param {any} context @param {{ config?: any }} [options] */
export function createSandboxService(context, { config = {} } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, SANDBOX_FLAG)) throw notFound('The test programme and sandbox are not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const requireSandbox = () => {
    const s = sandboxOf(db);
    if (!s) throw conflict('This installation is not a sandbox. Synthetic data, resets and scenario packs run only in a sandbox started with ERP_SANDBOX=true on its own database.');
    if (config.authMode !== 'dev-headers') throw conflict('The scenario runner acts as the synthetic people of the sandbox and needs AUTH_MODE=dev-headers in the sandbox.');
    return s;
  };
  const companies = () => db.prepare("SELECT id, code, legal_name AS name, created_at AS createdAt FROM org_companies WHERE code LIKE 'SBX-%' AND created_by = 'sandbox' ORDER BY id").all();
  const runView = (r) => ({ id: r.id, runNo: r.run_no, kind: r.kind, pack: r.pack, label: r.pack ? PACKS[r.pack]?.label ?? r.pack : null, status: r.status, result: r.result_status, params: parse(r.params_json, {}), expected: parse(r.expected_json, null), actual: parse(r.actual_json, null), counts: parse(r.counts_json, null), error: r.error, startedAt: r.started_at, finishedAt: r.finished_at, requestedBy: r.requested_by });
  function parse(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

  function status(actor) {
    guard(actor, 'tst.sandbox.view');
    const s = sandboxOf(db);
    const runs = db.prepare('SELECT * FROM tst_sandbox_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30').all(actor.companyId).map(runView);
    const cos = companies().map((c) => ({ ...c, projects: db.prepare('SELECT COUNT(*) AS n FROM org_projects WHERE company_id = ?').get(c.id).n, users: db.prepare('SELECT COUNT(*) AS n FROM iam_users WHERE company_id = ?').get(c.id).n }));
    const last = (pack) => runs.find((r) => r.kind === 'SCENARIO' && r.pack === pack) ?? null;
    return {
      sandbox: Boolean(s), since: s?.since ?? null, database: s ? (s.databasePath ?? ':memory:') : null, blocked: s ? { ...s.blocked } : null, lastBlocked: s ? s.last.slice(0, 10) : [], runnerReady: Boolean(s) && config.authMode === 'dev-headers',
      can: { manage: hasPermissionAnywhere(actor, 'tst.sandbox.manage') },
      companies: cos, packs: Object.entries(PACKS).map(([code, p]) => ({ code, label: p.label, check: p.check, expected: p.kpis, last: last(code) })), runs,
    };
  }

  // ---------------------------------------------------------------- the run log
  function newRun(actor, kind, pack = null, params = {}) {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM tst_sandbox_runs WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
    const runNo = `SBX-${String(n).padStart(6, '0')}`;
    const id = Number(db.prepare("INSERT INTO tst_sandbox_runs (company_id, run_no, kind, pack, status, params_json, started_at, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, 'sandbox')").run(actor.companyId, runNo, kind, pack, JSON.stringify(params), iso(), actor.user, actor.user).lastInsertRowid);
    return id;
  }
  function finish(actor, id, { status: st = 'DONE', result = null, expected = null, actual = null, counts = null, error = null }) {
    db.prepare('UPDATE tst_sandbox_runs SET status = ?, result_status = ?, expected_json = ?, actual_json = ?, counts_json = ?, error = ?, finished_at = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?')
      .run(st, result, expected ? JSON.stringify(expected) : null, actual ? JSON.stringify(actual) : null, counts ? JSON.stringify(counts) : null, error, iso(), iso(), actor.user, id);
    const r = db.prepare('SELECT * FROM tst_sandbox_runs WHERE id = ?').get(id);
    writeAudit(db, { companyId: actor.companyId, entity: 'tst_sandbox_runs', entityId: id, action: r.kind.toLowerCase(), newValues: { pack: r.pack, status: st, result, counts }, actor: actor.user });
    return runView(r);
  }

  // ---------------------------------------------------------------- the HTTP client of the synthetic people
  function client(base, co) {
    let seq = 0;
    return async (who, method, path, body) => {
      const headers = { 'content-type': 'application/json', 'x-erp-user': who, 'x-erp-roles': ROLES[who.split('.').pop()] ?? 'SYSADM', 'x-erp-company': String(co), 'x-correlation-id': `sandbox-${randomUUID()}` };
      if (method !== 'GET') headers['idempotency-key'] = `sbx-${co}-${Date.now().toString(36)}-${(seq += 1)}-${randomUUID().slice(0, 8)}`;
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (res.status >= 400) { const e = /** @type {any} */ (new Error(`${method} ${path} as ${who}: ${res.status} ${json?.error?.message ?? ''}`.trim())); e.status = res.status; e.body = json; throw e; }
      return json?.data;
    };
  }
  const user = (co, k) => `sbx${co}.${k}`;
  const tasksOf = async (call, who) => (await call(who, 'GET', '/api/v1/workflow/tasks?mine=assigned')).rows;
  async function approve(call, who, instanceId) {
    const task = (await tasksOf(call, who)).find((x) => x.instance.id === instanceId);
    if (!task) throw new Error(`${who} has no task for workflow instance ${instanceId}`);
    return call(who, 'POST', `/api/v1/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'Checked in the sandbox scenario' });
  }

  // ---------------------------------------------------------------- the synthetic data (written with foreign keys on)
  const fill = (table, vals) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
    const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
    const fks = new Map(db.prepare(`PRAGMA foreign_key_list(${table})`).all().map((f) => [f.from, f.table]));
    const names = []; const params = [];
    for (const c of cols) {
      if (c.name === 'id') continue;
      if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); continue; }
      if (c.name === 'created_by' || c.name === 'requested_by') { names.push(c.name); params.push('sandbox'); continue; }
      if (c.name === 'source_type') { names.push(c.name); params.push('sandbox'); continue; }
      if (c.notnull && c.dflt_value == null && fks.has(c.name)) throw new Error(`Sandbox generator: ${table}.${c.name} needs a ${fks.get(c.name)} row`);
      if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `SBX-${table}-${randomUUID().slice(0, 8)}`)); }
    }
    return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
  };
  const TODAY = () => todayIST();
  const day = (n) => isoOf(ordOf(TODAY()) - n);

  /** A synthetic company with its people, flags and masters. */
  function makeCompany() {
    return transaction(db, () => {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM org_companies WHERE code LIKE 'SBX-%'").get().n ?? 0) + 1;
      const code = `SBX-${n}`;
      const co = Number(db.prepare("INSERT INTO org_companies (code, legal_name, short_name, status, created_by) VALUES (?, ?, ?, 'ACTIVE', 'sandbox')").run(code, `Sandbox Constructions ${n} Pvt Ltd (synthetic)`, `Sandbox ${n}`).lastInsertRowid);
      // every feature on: the sandbox is where people learn the whole system
      for (const f of db.prepare('SELECT DISTINCT key, description FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled, created_by, source_type) VALUES (?, ?, ?, 0, 1, 'sandbox', 'sandbox')").run(f.key, co, f.description ?? f.key);
      for (const [k, role] of Object.entries(ROLES)) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(co, user(co, k), `Sandbox ${role} (${k})`, JSON.stringify([role]), `${user(co, k)}@sandbox.invalid`);
      const cat = fill('mdm_item_categories', { company_id: co, code: 'CEMENT', name: 'Cement', code_prefix: 'CEM', item_types_json: '[]', attribute_template_json: '[]', steward_role: 'PROCMGR', category_status: 'ACTIVE' });
      const items = {};
      for (const [c, name, uom] of [['SBX-CEM', 'Cement OPC 53 (synthetic)', 'bag'], ['SBX-STL', 'TMT steel Fe500 (synthetic)', 'kg'], ['SBX-SND', 'River sand (synthetic)', 'cum']]) items[c] = fill('mdm_items', { company_id: co, code: c, name, item_type: 'MATERIAL', category_id: cat, base_uom: uom, effective_from: '2025-01-01', item_status: 'ACTIVE', stock_tracked: 1 });
      for (const [c, name] of [['SBX-CLI', 'Synthetic Housing Board'], ['SBX-VEN', 'Synthetic Cement Traders'], ['SBX-SUB', 'Synthetic Formwork Contractors']]) fill('mdm_partners', { company_id: co, code: c, legal_name: name, trade_name: name, constitution: 'PRIVATE_LIMITED', partner_status: 'ACTIVE', steward_role: 'PROCMGR' });
      return { co, code, items };
    });
  }

  /**
   * A project with the shape of the progress worked example: A10 100 m3 on WBS 1 (budget Rs 6,00,000), A20 50 m3 on WBS 2 (Rs 4,00,000),
   * milestone M1; an approved schedule, budget and current baseline (A10 from today - 9 to today + 10, A20 from today - 4 to today + 5: 50 %
   * planned today); a BOQ line of concrete with a norm of 8 bags of cement a m3 (5 % wastage allowed) mapped to A10; a site store.
   */
  function makeProject(co, items, code, name, { baselineStart = 9, months = 0 } = {}) {
    return transaction(db, () => {
      const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(co, code, name).lastInsertRowid);
      const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, ?, 'ACTIVE')").run(co, pid, `${code}-S1`, `${name} site`).lastInsertRowid);
      const w1 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '1', 'Substructure', 1, 'sandbox')").run(co, pid).lastInsertRowid);
      const w2 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '2', 'Superstructure', 1, 'sandbox')").run(co, pid).lastInsertRowid);
      const ver = fill('proj_boq_versions', { company_id: co, project_id: pid, org_project_id: pid, version_no: 1, name: 'Contract BOQ' });
      const line = fill('proj_boq_lines', { company_id: co, version_id: ver, project_id: pid, line_kind: 'ITEM', item_code: 'C1', description: 'Reinforced cement concrete M25', uom: 'm3', qty: 100_000 });
      fill('proj_boq_line_norms', { company_id: co, line_id: line, resource_item_id: items['SBX-CEM'], norm_type: 'MATERIAL', description: 'Cement', uom: 'bag', qty_per_unit: 8000, wastage_pct: 500 });
      const start = day(Math.max(baselineStart, months * 30));
      const cal = fill('plan_calendars', { company_id: co, org_project_id: pid, code: `${code}-CAL`, name: 'Six-day week', work_week: '1111110', status: 'ACTIVE' });
      const sch = fill('plan_schedules', { company_id: co, org_project_id: pid, project_id: pid, calendar_id: cal, name: `${name} schedule`, status: 'APPROVED', start_date: start });
      const a = {};
      for (const [c, nm, qty, wbs, dur, type] of [['A10', 'Excavation and raft concrete', 100_000, w1, 20, null], ['A20', 'Columns and slabs', 50_000, w2, 10, null], ['M1', 'Structure complete', 0, w2, 0, 'MILESTONE']]) {
        a[c] = fill('plan_activities', { company_id: co, schedule_id: sch, project_id: pid, code: c, name: nm, qty, uom: qty ? 'm3' : null, wbs_id: wbs, duration_days: dur, ...(type ? { act_type: type } : {}) });
      }
      fill('plan_activity_boq', { company_id: co, activity_id: a.A10, boq_line_id: line, qty: 100_000 });
      const wa = fill('site_work_authorisations', { company_id: co, org_project_id: pid, project_id: pid, wa_site_id: site, site_id: site, wa_no: `WA/${code}/0001`, plan_date: start, activity_id: a.A10, wbs_id: w1, planned_qty: 150_000, uom: 'm3', start_time: '08:00', end_time: '18:00', supervisor: 'sandbox', status: 'APPROVED' });
      const bud = fill('bud_budgets', { company_id: co, org_project_id: pid, project_id: pid, doc_no: `BUD/${code}/1`, doc_date: day(30), name: 'Original budget', status: 'APPROVED' });
      for (const [w, amt] of [[w1, 60_000_000], [w2, 40_000_000]]) fill('bud_lines', { company_id: co, budget_id: bud, line_kind: 'DIRECT', wbs_id: w, resource_type: 'OTHER', resource_name: 'Work', amount: amt });
      const snap = { v: 1, activities: [{ code: 'A10', start: day(baselineStart), finish: isoOf(ordOf(TODAY()) + 10) }, { code: 'A20', start: day(4), finish: isoOf(ordOf(TODAY()) + 5) }, { code: 'M1', start: day(3), finish: day(3) }] };
      fill('plan_baselines', { company_id: co, doc_no: `BL/${code}/0`, doc_date: day(20), org_project_id: pid, project_id: pid, schedule_id: sch, baseline_no: 0, name: 'Contract baseline', reason: 'Original programme', snapshot_json: JSON.stringify(snap), snapshot_hash: 'sandbox', status: 'APPROVED', is_current: 1 });
      const store = fill('inv_stores', { company_id: co, code: `${code}-ST`, name: `${name} store`, store_type: 'SITE_STORE', org_project_id: pid, org_site_id: site, project_id: pid, site_id: site, keeper_ids_json: JSON.stringify([user(co, 'sk')]), store_status: 'ACTIVE', approved_by: 'sandbox', approved_at: iso() });
      return { pid, site, w1, w2, a, sch, bud, store, line, wa };
    });
  }

  let dprSeq = 0;
  /** An approved daily progress report: the report and its work lines, and the event the progress engine reads (14.05). */
  function dpr(co, p, date, work) {
    const id = transaction(db, () => {
      const d = fill('site_dprs', { company_id: co, doc_no: `DPR/SBX/${co}/${Date.now().toString(36)}${(dprSeq += 1)}`, org_project_id: p.pid, dpr_site_id: p.site, project_id: p.pid, site_id: p.site, dpr_date: date, supervisor: 'sandbox', scope: 'SITE', status: 'APPROVED' });
      for (const [c, qty] of work) fill('site_dpr_work', { company_id: co, dpr_id: d, activity_id: p.a[c], wa_id: p.wa, qty: Math.round(qty * 1000) });
      publishEvent(db, { type: 'site.dpr.approved', entity: 'site_dpr', entityId: d, actorId: 'sandbox', companyId: co, projectId: p.pid, siteId: p.site, data: { dprId: d, docNo: `DPR/${d}`, projectId: p.pid, siteId: p.site, date, scope: 'SITE', supersedes: null, work: work.map(([c, qty]) => ({ activityId: p.a[c], qty, uom: 'm3' })) } });
      return d;
    });
    return id;
  }
  const drain = async () => { const bus = runtimeOf(db)?.bus; if (bus) await bus.drain(); };

  async function setupCompany(call, co) {
    const sys = user(co, 'sysadm');
    await call(sys, 'PUT', '/api/v1/core/company-settings', { legalName: `Sandbox Constructions ${co} Pvt Ltd (synthetic)`, reason: 'sandbox set-up' });
    const t = TODAY(); const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < 4 ? 1 : 0);
    for (const start of [`${y - 1}-04-01`, `${y}-04-01`]) await call(sys, 'POST', '/api/v1/core/financial-years', { startDate: start }).catch((e) => { if (e.status !== 409) throw e; });
  }

  // ---------------------------------------------------------------- FR-03: generate and reset
  async function generate(actor, { months = 12 } = {}, { base }) {
    guard(actor, 'tst.sandbox.manage'); requireSandbox();
    if (!Number.isInteger(months) || months < 1 || months > 24) throw badRequest('Months must be 1 to 24.', [{ field: 'months', message: 'Between 1 and 24' }]);
    const run = newRun(actor, 'GENERATE', null, { months });
    try { return finish(actor, run, { counts: await build(months, base) }); } catch (err) { return finish(actor, run, { status: "FAILED", error: String(err.message ?? err).slice(0, 1000) }); }
  }
  async function build(months, base) {
    const { co, code, items } = makeCompany();
    const call = client(base, co);
    await setupCompany(call, co);
    const projects = [['BASE', 'Synthetic Tower A (on track)'], ['MALL', 'Synthetic Mall B'], ['ROAD', 'Synthetic Ring Road C'], ['HOSP', 'Synthetic Hospital D']].map(([c, name]) => ({ code: `${code}-${c}`, name, ...makeProject(co, items, `${code}-${c}`, name, { months }) }));
    let dprs = 0; let movements = 0;
    for (const p of projects) {
      // twelve months of work: one approved report a month, and the cement received and issued for it through the stock API
      for (let m = months - 1; m >= 0; m -= 1) {
        const date = day(m * 30 + 1);
        dpr(co, p, date, [['A10', 100 / (months * 2)]]); dprs += 1;
        await call(user(co, 'store1'), 'POST', '/api/v1/inv/movements', { storeId: p.store, itemId: items['SBX-CEM'], type: 'RECEIPT', qty: 60, rate: 380, date, reason: 'Synthetic monthly receipt (sandbox)' });
        await call(user(co, 'store1'), 'POST', '/api/v1/inv/movements', { storeId: p.store, itemId: items['SBX-CEM'], type: 'ISSUE', qty: 40, date, reason: 'Synthetic monthly issue (sandbox)' });
        movements += 2;
      }
    }
    await drain();
    return { companyId: co, company: code, users: Object.keys(ROLES).length, projects: projects.length, boqLines: projects.length, budgets: projects.length, schedules: projects.length, dprs, movements, months, integrity: fkProblems() };
  }
  const fkProblems = () => db.prepare('PRAGMA foreign_key_check').all().length;

  /** FR-03 one-click reset: every synthetic company and all its rows go; a fresh company is generated. */
  async function reset(actor, { base }) {
    guard(actor, 'tst.sandbox.manage'); requireSandbox();
    const run = newRun(actor, 'RESET');
    try {
      const removed = wipe();
      const counts = await build(12, base);
      return finish(actor, run, { counts: { removed, ...counts } });
    } catch (err) { return finish(actor, run, { status: 'FAILED', error: String(err.message ?? err).slice(0, 1000) }); }
  }
  function wipe() {
    const ids = companies().map((c) => c.id);
    if (!ids.length) return { companies: 0, rows: 0, kept: 0 };
    // append-only tables (the audit trail, hash-chained ledgers) refuse deletes by trigger: their rows stay as the trail of the sandbox
    const appendOnly = new Set();
    const chained = (t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => /^(prev_hash|row_hash|hash_prev|chain_hash|entry_hash)$/.test(c.name)) || t === 'core_audit_log';
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('org_companies', 'tst_sandbox_runs', 'core_schema_migrations')").all().map((t) => t.name)
      .filter((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'company_id'));
    const marks = ids.map(() => '?').join(', ');
    let rows = 0; let kept = 0;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        const del = (t, where, ...p) => { try { return Number(db.prepare(`DELETE FROM ${t} WHERE ${where}`).run(...p).changes); } catch (err) {
          // an immutable ledger of the synthetic company (stock, approved documents): its delete guards are lifted for this statement only;
          // a hash-chained trail (the audit log) is never touched, so its verification stays intact
          if (chained(t)) { appendOnly.add(t); return 0; }
          const guards = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql LIKE '%BEFORE DELETE%'").all(t);
          if (!guards.length) throw err;
          for (const g of guards) db.exec(`DROP TRIGGER ${g.name}`);
          try { return Number(db.prepare(`DELETE FROM ${t} WHERE ${where}`).run(...p).changes); } finally { for (const g of guards) db.exec(g.sql); }
        } };
        for (const t of tables) rows += del(t, `company_id IN (${marks})`, ...ids);
        // child rows without a company of their own follow their parents
        for (let pass = 0; pass < 10; pass += 1) {
          const orphans = db.prepare('PRAGMA foreign_key_check').all().filter((o) => !appendOnly.has(o.table) && o.parent !== 'org_companies');
          if (!orphans.length) break;
          for (const o of orphans) rows += del(o.table, 'rowid = ?', o.rowid);
        }
        for (const id of ids) {
          const held = [...appendOnly].some((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'company_id') && db.prepare(`SELECT 1 FROM ${t} WHERE company_id = ? LIMIT 1`).get(id));
          if (held) { db.prepare("UPDATE org_companies SET code = 'SBXR-' || id, status = 'INACTIVE', updated_at = ?, updated_by = 'sandbox' WHERE id = ?").run(iso(), id); kept += 1; } else rows += Number(db.prepare('DELETE FROM org_companies WHERE id = ?').run(id).changes);
        }
      });
    } finally { db.exec('PRAGMA foreign_keys = ON'); }
    return { companies: ids.length, rows, kept, appendOnly: [...appendOnly].sort() };
  }

  // ---------------------------------------------------------------- FR-04: the scenario packs, through the API
  const near = (a, b) => (typeof b === 'boolean' ? a === b : a != null && Math.abs(Number(a) - Number(b)) < 0.00011);
  async function runScenario(actor, { pack }, { base }) {
    guard(actor, 'tst.sandbox.manage'); requireSandbox();
    if (!PACKS[pack]) throw badRequest('Unknown scenario pack.', [{ field: 'pack', message: Object.keys(PACKS).join(', ') }]);
    let target = companies().at(-1);
    const run = newRun(actor, 'SCENARIO', pack, { companyId: target?.id ?? null });
    const expected = PACKS[pack].kpis;
    try {
      if (!target) { await build(12, base); target = companies().at(-1); }
      const co = target.id;
      const items = Object.fromEntries(db.prepare("SELECT code, id FROM mdm_items WHERE company_id = ? AND code LIKE 'SBX-%'").all(co).map((x) => [x.code, x.id]));
      const call = client(base, co);
      const no = db.prepare('SELECT run_no FROM tst_sandbox_runs WHERE id = ?').get(run).run_no.slice(4);
      const p = makeProject(co, items, `${target.code}-${pack.slice(0, 3)}-${no}`, `${PACKS[pack].label} (scenario ${no})`);
      const actual = pack === 'HIGH_WASTAGE' ? await wastageThread(call, co, p, items) : await progressThread(call, co, p, pack);
      const checks = Object.entries(expected).map(([k, v]) => ({ kpi: k, expected: v, actual: actual[k] ?? null, pass: near(actual[k], v) }));
      const result = checks.every((c) => c.pass) ? 'PASS' : 'FAIL';
      return finish(actor, run, { result, expected, actual: { ...actual, checks, projectId: p.pid, companyId: co }, counts: { companyId: co, projectId: p.pid } });
    } catch (err) {
      return finish(actor, run, { status: 'FAILED', result: 'FAIL', expected, error: String(err.message ?? err).slice(0, 1000) });
    }
  }

  /** Progress reports, a progress period with its actual cost submitted by planning and approved by the PM, the closed period's EVM. */
  async function progressThread(call, co, p, pack) {
    const work = pack === 'DELAYED' ? [['A10', 50], ['A20', 10]] : [['A10', 50], ['A20', 25]];
    dpr(co, p, TODAY(), work);
    await drain();
    const actualCost = pack === 'DELAYED' ? 420_000 : 625_000;
    const plan = user(co, 'plan'); const pm = user(co, 'pm');
    const live = await call(plan, 'GET', `/api/v1/site/progress/report?projectId=${p.pid}`);
    const per = await call(plan, 'POST', '/api/v1/site/periods', { projectId: p.pid, periodType: 'MONTH', periodEnd: TODAY(), actualCost });
    const sent = await call(plan, 'POST', `/api/v1/site/periods/${per.id}/submit`);
    await approve(call, pm, sent.workflowInstanceId);
    const closed = await call(pm, 'GET', `/api/v1/site/periods/${per.id}`);
    const dash = await call(pm, 'GET', `/api/v1/site/progress/dashboard?projectId=${p.pid}`);
    return { spi: closed.snapshot.project.spi, cpi: closed.snapshot.project.cpi, eac: closed.snapshot.project.eac, planned: closed.snapshot.summary.planned, physical: closed.snapshot.summary.physical, liveSpi: live.project.spi, periodStatus: closed.status, periodNo: closed.docNo, dashboardSpi: dash.lastClosed?.spi ?? null, dashboardCpi: dash.lastClosed?.cpi ?? null, budget: 1_000_000 };
  }

  /** 30 m3 of concrete reported; 300 bags of cement received and issued through the stock API; the QS reconciles the month. */
  async function wastageThread(call, co, p, items) {
    const date = TODAY();
    dpr(co, p, date, [['A10', 30]]);
    await drain();
    const mgr = user(co, 'store1'); const qs = user(co, 'qs');
    await call(mgr, 'POST', '/api/v1/inv/movements', { storeId: p.store, itemId: items['SBX-CEM'], type: 'RECEIPT', qty: 400, rate: 380, date, reason: 'Cement received for the slab (sandbox scenario)' });
    await call(mgr, 'POST', '/api/v1/inv/movements', { storeId: p.store, itemId: items['SBX-CEM'], type: 'ISSUE', qty: 300, date, reason: 'Cement issued to the slab (sandbox scenario)' });
    const keyed = (await call(qs, 'GET', '/api/v1/inv/reconciliation-materials')) ?? [];
    const list = Array.isArray(keyed) ? keyed : keyed.rows ?? [];
    if (!list.some((m) => m.itemId === items['SBX-CEM'])) await call(qs, 'POST', '/api/v1/inv/reconciliation-materials', { itemId: items['SBX-CEM'], defaultWastagePct: 5 });
    const rec = await call(qs, 'POST', '/api/v1/inv/reconciliations', { projectId: p.pid, siteId: p.site, period: date.slice(0, 7) });
    const l = rec.lines.find((x) => x.itemId === items['SBX-CEM']) ?? rec.lines[0];
    return { theoreticalBase: l.theoreticalBase, theoretical: l.theoretical, actual: l.actual, wastagePct: l.wastagePct, allowedWastagePct: l.allowedWastagePct, overAllowed: l.overAllowed, reconciliation: rec.docNo };
  }

  return { status, generate, reset, runScenario, wipe, companies };
}
