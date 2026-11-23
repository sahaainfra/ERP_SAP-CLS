import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { pageCode, registeredPages } from './pageaudit.js';

/**
 * Part 30.07 — accessibility, responsive and device validation.
 *
 * FR-01 the device and browser matrix (`tst_devices`): what CI emulates in Chromium (low-end and mid-range Android, iPhone SE size, a 10-inch
 *       tablet, desktop at 1280 and 1920, with CPU slowdown and network throttling) and what a tester runs by hand on the real thing (real
 *       phones, Firefox and Safari).
 * FR-02 the axe sweep of every registered page (WCAG 2.1 A and AA; e2e/tst-a11y-sweep.spec.js), and screen-reader sessions (NVDA, VoiceOver,
 *       TalkBack) recorded by the tester, with the accessibility-tree check of the key journeys (e2e/tst-device-matrix.spec.js).
 * FR-03 the responsive sweep of every page at 360, 768, 1280 and 1920 px, and the field journeys on throttled and offline networks, in Hindi
 *       and Telugu (the device journeys).
 * FR-04 every failing page or journey is an issue: fixed in a commit, and re-tested by the next run that passes on the same page and check.
 * BR-01 no serious or critical accessibility finding on a business page (the latest axe sweep of each width); the validation report is signed
 *       off through the approval engine (`tst_a11y_signoff`, the UX lead asks, the QA lead approves, never the same person) only when it holds.
 */
export const A11Y_FLAG = 'ff.qa.p3007';
export const SIGNOFF_TYPE = 'tst_a11y_signoff';
export const KINDS = ['AXE', 'RESPONSIVE', 'DEVICE', 'SCREEN_READER'];
export const WIDTHS = [360, 768, 1280, 1920];
const iso = (d = new Date()) => d.toISOString();
const IMPACTS = ['critical', 'serious', 'moderate', 'minor'];
/** Consoles of the administrators and developers; every other page is a business page for BR-01. */
const CONSOLE = /^\/(admin|dev|ui\/(styleguide|gallery|components)|core\/(flags|about|architecture|routes|events|jobs|integrity))/;
export const isBusinessPage = (route) => !CONSOLE.test(route ?? '');

// the device matrix is the installation's (seeded once, company_id empty); the runs and results belong to a company
integrityRegistry.register({ companyOptional: ['tst_devices'], statuses: { tst_devices: ['ACTIVE', 'RETIRED'], tst_a11y_runs: ['RUNNING', 'DONE'], tst_a11y_results: ['PASS', 'FAIL', 'ERROR'] } });
for (const [type, description] of [
  ['tst.a11y.recorded', 'An accessibility, responsive, device or screen-reader run was recorded (part 30.07): data { runId, kind, width, items, failed, serious }.'],
  ['tst.a11y.signed_off', 'The accessibility and device validation report was signed off (part 30.07): data { requestId, pages, devices }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: { type: 'object' }, owner: 'tst', description });

export function createA11yService(context, { root = process.cwd() } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, A11Y_FLAG)) throw notFound('Accessibility and device validation is not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  let inventory = null;
  const pages = () => (inventory ??= registeredPages(root).filter((p) => !p.onboardingOnly));
  const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const deviceRow = (companyId, code) => db.prepare('SELECT * FROM tst_devices WHERE code = ? AND (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL ORDER BY company_id IS NULL LIMIT 1').get(code, companyId);
  const runView = (r) => ({ id: r.id, runNo: r.run_no, kind: r.run_kind, device: r.device_id ? db.prepare('SELECT code, label FROM tst_devices WHERE id = ?').get(r.device_id) : null, width: r.width, height: r.height, theme: r.theme, language: r.language, network: r.network, assistiveTech: r.assistive_tech, status: r.status, items: r.items_count, failed: r.failed_count, serious: r.serious_count, startedAt: r.started_at, finishedAt: r.finished_at, requestedBy: r.requested_by });
  const resultView = (x) => ({ id: x.id, runId: x.run_id, pageCode: x.page_code, route: x.route, journey: x.journey, status: x.status, counts: { critical: x.critical_count, serious: x.serious_count, moderate: x.moderate_count, minor: x.minor_count }, violations: parse(x.violations_json, []), overflowPx: x.overflow_px, smallTargets: x.small_targets, tinyInputs: x.tiny_inputs, loadMs: x.load_ms, steps: parse(x.steps_json, null), notes: x.notes, issue: x.issue_status, fixedIn: x.fixed_in, fixedBy: x.fixed_by, fixedAt: x.fixed_at, retestedAt: x.retested_at, testedBy: x.tested_by, testedAt: x.tested_at, business: x.route ? isBusinessPage(x.route) : true });

  // ---------------------------------------------------------------- recording runs (sweeps and journeys are posted by the runners)
  function newRun(actor, b) {
    const device = b.deviceCode ? deviceRow(actor.companyId, b.deviceCode) : null;
    if (b.deviceCode && !device) throw badRequest('Unknown device.', [{ field: 'deviceCode', message: 'Not in the device matrix' }]);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM tst_a11y_runs WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
    return Number(db.prepare("INSERT INTO tst_a11y_runs (company_id, run_no, run_kind, device_id, width, height, theme, language, network, assistive_tech, status, started_at, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?, 'a11y')")
      .run(actor.companyId, `A11Y-${String(n).padStart(6, '0')}`, b.kind, device?.id ?? null, b.width ?? device?.width ?? null, b.height ?? device?.height ?? null, b.theme ?? 'light', b.language ?? 'en', b.network ?? device?.network ?? 'FAST', b.assistiveTech ?? null, iso(), actor.user, actor.user).lastInsertRowid);
  }
  const ins = () => db.prepare("INSERT INTO tst_a11y_results (company_id, run_id, page_code, route, journey, status, critical_count, serious_count, moderate_count, minor_count, violations_json, overflow_px, small_targets, tiny_inputs, load_ms, steps_json, notes, issue_status, tested_by, tested_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'a11y')");
  /** What fails a page or a journey: a serious or critical axe finding, sideways scrolling, an error, or a failed step. */
  function judge(kind, r) {
    const count = (imp) => (r.violations ?? []).filter((v) => v.impact === imp).reduce((a, v) => a + (v.nodes ?? 1), 0);
    const c = Object.fromEntries(IMPACTS.map((i) => [i, count(i)]));
    const stepsFailed = (r.steps ?? []).some((s) => s.result === 'FAIL');
    const fail = r.error || (r.overflowPx ?? 0) > 0 || c.critical > 0 || c.serious > 0 || stepsFailed || r.result === 'FAIL';
    return { c, status: r.error ? 'ERROR' : fail ? 'FAIL' : 'PASS' };
  }
  /** FR-02 FR-03: a batch of results; with `final` the run closes and reports its coverage of the registered pages (sweeps). */
  function recordRun(actor, b) {
    guard(actor, 'tst.a11y.record');
    const byRoute = new Map(pages().map((p) => [p.route, p]));
    if (b.kind === 'AXE' || b.kind === 'RESPONSIVE') {
      const unknown = b.results.filter((r) => !byRoute.has(r.route)).map((r) => r.route);
      if (unknown.length) throw badRequest('Some routes are not registered pages.', unknown.slice(0, 20).map((r) => ({ field: 'results', message: r })));
      if (!b.width) throw badRequest('A sweep is at one width.', [{ field: 'width', message: 'Required' }]);
    } else if (b.results.some((r) => !r.journey)) throw badRequest('A device or screen-reader result names its journey.', [{ field: 'results', message: 'journey' }]);
    return transaction(db, () => {
      let run = b.runId;
      if (run) {
        const cur = db.prepare('SELECT * FROM tst_a11y_runs WHERE id = ? AND company_id = ?').get(run, actor.companyId);
        if (!cur) throw notFound('That run does not exist.');
        if (cur.status !== 'RUNNING') throw conflict('That run is finished; start a new one.');
        if (cur.run_kind !== b.kind || (cur.width ?? null) !== (b.width ?? cur.width ?? null)) throw badRequest('The batch is for another kind of run or another width.', [{ field: 'runId', message: cur.run_no }]);
      } else run = newRun(actor, b);
      const add = ins();
      for (const r of b.results) {
        const { c, status } = judge(b.kind, r);
        add.run(actor.companyId, run, r.route ? pageCode(r.route) : null, r.route ?? null, r.journey ?? null, status, c.critical, c.serious, c.moderate, c.minor, JSON.stringify((r.violations ?? []).slice(0, 40)), r.overflowPx ?? 0, r.smallTargets ?? 0, r.tinyInputs ?? 0, r.loadMs ?? null, r.steps ? JSON.stringify(r.steps.slice(0, 40)) : null, r.error ?? r.notes ?? null, status === 'PASS' ? 'NONE' : 'OPEN', actor.user, iso(), actor.user);
      }
      const counts = db.prepare("SELECT COUNT(*) AS n, SUM(status <> 'PASS') AS f, SUM(serious_count + critical_count > 0) AS s FROM tst_a11y_results WHERE run_id = ?").get(run);
      db.prepare('UPDATE tst_a11y_runs SET items_count = ?, failed_count = ?, serious_count = ?, updated_at = ? WHERE id = ?').run(counts.n, counts.f ?? 0, counts.s ?? 0, iso(), run);
      if (b.final === false) return { id: run, status: 'RUNNING', items: counts.n, failed: counts.f ?? 0 };
      return finishRun(actor, run);
    });
  }
  function finishRun(actor, run) {
    const r = db.prepare('SELECT * FROM tst_a11y_runs WHERE id = ?').get(run);
    db.prepare("UPDATE tst_a11y_runs SET status = 'DONE', finished_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), iso(), run);
    // FR-04: an issue fixed or still open on a page (or journey) passes in this run of the same kind and width: re-tested
    const passed = db.prepare("SELECT page_code, journey FROM tst_a11y_results WHERE run_id = ? AND status = 'PASS'").all(run);
    const retest = db.prepare(`UPDATE tst_a11y_results SET issue_status = 'RETESTED', retested_run_id = ?, retested_at = ?, updated_at = ?, version = version + 1
      WHERE company_id = ? AND issue_status IN ('OPEN', 'FIXED') AND run_id IN (SELECT id FROM tst_a11y_runs WHERE company_id = ? AND run_kind = ? AND COALESCE(width, 0) = COALESCE(?, 0) AND COALESCE(device_id, 0) = COALESCE(?, 0) AND id < ?)
      AND COALESCE(page_code, '') = COALESCE(?, '') AND COALESCE(journey, '') = COALESCE(?, '')`);
    let retested = 0;
    for (const p of passed) retested += Number(retest.run(run, iso(), iso(), actor.companyId, actor.companyId, r.run_kind, r.width, r.device_id, run, p.page_code, p.journey).changes);
    const out = runView(db.prepare('SELECT * FROM tst_a11y_runs WHERE id = ?').get(run));
    let coverage = null;
    if (r.run_kind === 'AXE' || r.run_kind === 'RESPONSIVE') {
      const posted = new Set(db.prepare('SELECT DISTINCT route FROM tst_a11y_results WHERE run_id = ?').all(run).map((x) => x.route));
      const all = pages(); const missing = all.filter((p) => !posted.has(p.route)).map((p) => p.route);
      coverage = { registered: all.length, swept: all.length - missing.length, pct: all.length ? Math.floor(((all.length - missing.length) / all.length) * 1000) / 10 : 100, missing: missing.slice(0, 50), missingCount: missing.length };
    }
    writeAudit(db, { companyId: actor.companyId, entity: 'tst_a11y_runs', entityId: run, action: 'record', newValues: { kind: r.run_kind, width: r.width, items: out.items, failed: out.failed, serious: out.serious, retested }, actor: actor.user });
    publishEvent(db, { type: 'tst.a11y.recorded', entity: 'tst_a11y_runs', entityId: run, actorId: actor.user, companyId: actor.companyId, data: { runId: run, kind: r.run_kind, width: r.width, items: out.items, failed: out.failed, serious: out.serious } });
    return { ...out, retested, coverage };
  }
  /** FR-02: a screen-reader session or a device journey run by hand on a real device or browser. */
  function recordManual(actor, b) {
    guard(actor, 'tst.a11y.record');
    if (b.kind === 'DEVICE' && !b.deviceCode) throw badRequest('A device journey names its device.', [{ field: 'deviceCode', message: 'Required' }]);
    if (b.kind === 'SCREEN_READER' && !b.assistiveTech) throw badRequest('A screen-reader session names the screen reader.', [{ field: 'assistiveTech', message: 'NVDA, VoiceOver, TalkBack' }]);
    if (b.result === 'FAIL' && !(b.notes?.trim().length >= 10)) throw badRequest('A failed journey says what failed.', [{ field: 'notes', message: 'At least 10 characters' }]);
    return recordRun(actor, { kind: b.kind, deviceCode: b.deviceCode, assistiveTech: b.assistiveTech, language: b.language, network: b.network, final: true, results: [{ journey: b.journey, route: b.route, result: b.result, steps: b.steps, notes: b.notes }] });
  }
  /** FR-04: the commit that fixed an issue; the next passing run of the same check re-tests it. */
  function fixIssue(actor, id, { fixedIn }) {
    guard(actor, 'tst.a11y.record');
    const x = db.prepare('SELECT * FROM tst_a11y_results WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!x) throw notFound('That result does not exist.');
    if (x.issue_status !== 'OPEN') throw conflict('Only an open issue is marked fixed.');
    db.prepare("UPDATE tst_a11y_results SET issue_status = 'FIXED', fixed_in = ?, fixed_by = ?, fixed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(fixedIn, actor.user, iso(), iso(), x.id);
    writeAudit(db, { companyId: actor.companyId, entity: 'tst_a11y_results', entityId: x.id, action: 'fix', newValues: { fixedIn }, actor: actor.user });
    return resultView(db.prepare('SELECT * FROM tst_a11y_results WHERE id = ?').get(x.id));
  }

  // ---------------------------------------------------------------- the report
  const latestRun = (c, kind, width) => db.prepare("SELECT * FROM tst_a11y_runs WHERE company_id = ? AND run_kind = ? AND COALESCE(width, 0) = COALESCE(?, 0) AND status = 'DONE' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(c, kind, width);
  function verdictOf(c) {
    const axe = WIDTHS.map((w) => latestRun(c, 'AXE', w)).filter(Boolean);
    const blockers = [];
    for (const r of axe) for (const x of db.prepare('SELECT route, critical_count, serious_count FROM tst_a11y_results WHERE run_id = ? AND (critical_count + serious_count) > 0').all(r.id)) if (isBusinessPage(x.route)) blockers.push({ route: x.route, width: r.width, critical: x.critical_count, serious: x.serious_count });
    const sweeps = WIDTHS.map((w) => ({ width: w, axe: latestRun(c, 'AXE', w), responsive: latestRun(c, 'RESPONSIVE', w) })).map((s) => ({ width: s.width, axe: s.axe ? runView(s.axe) : null, responsive: s.responsive ? runView(s.responsive) : null }));
    return { swept: axe.length > 0, blocked: axe.length === 0 || blockers.length > 0, blockers: blockers.slice(0, 50), blockerCount: blockers.length, sweeps };
  }
  function overview(actor, q = {}) {
    guard(actor, 'tst.a11y.view');
    const c = actor.companyId;
    const v = verdictOf(c);
    const devices = db.prepare('SELECT * FROM tst_devices WHERE (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL AND status = \'ACTIVE\' ORDER BY sort_order, id').all(c).map((d) => {
      const last = db.prepare("SELECT * FROM tst_a11y_runs WHERE company_id = ? AND device_id = ? AND run_kind = 'DEVICE' AND status = 'DONE' ORDER BY id DESC LIMIT 1").get(c, d.id);
      return { code: d.code, label: d.label, deviceClass: d.device_class, os: d.os, browser: d.browser, width: d.width, height: d.height, ramGb: d.ram_gb == null ? null : Number(d.ram_gb), cpuSlowdown: d.cpu_slowdown, network: d.network, automation: d.automation, last: last ? { ...runView(last), result: last.failed_count ? 'FAIL' : 'PASS' } : null };
    });
    const sr = db.prepare("SELECT * FROM tst_a11y_runs WHERE company_id = ? AND run_kind = 'SCREEN_READER' AND status = 'DONE' ORDER BY id DESC LIMIT 20").all(c).map((r) => ({ ...runView(r), journey: db.prepare('SELECT journey FROM tst_a11y_results WHERE run_id = ? LIMIT 1').get(r.id)?.journey ?? null, result: r.failed_count ? 'FAIL' : 'PASS' }));
    // the chart: per width, pages with serious or critical findings, with moderate or minor only, and scrolling sideways (latest sweeps)
    const byWidth = v.sweeps.map((s) => {
      const axe = s.axe ? db.prepare('SELECT SUM(critical_count + serious_count > 0) AS s, SUM(critical_count + serious_count = 0 AND moderate_count + minor_count > 0) AS m FROM tst_a11y_results WHERE run_id = ?').get(s.axe.id) : { s: 0, m: 0 };
      const resp = s.responsive ?? s.axe; const ov = resp ? db.prepare('SELECT SUM(overflow_px > 0) AS o FROM tst_a11y_results WHERE run_id = ?').get(resp.id).o ?? 0 : 0;
      return { width: s.width, serious: axe.s ?? 0, moderate: axe.m ?? 0, overflow: ov, swept: (resp?.items ?? 0) };
    });
    const rules = new Map();
    for (const s of v.sweeps) if (s.axe) for (const x of db.prepare('SELECT violations_json FROM tst_a11y_results WHERE run_id = ? AND violations_json <> \'[]\'').all(s.axe.id)) for (const vio of parse(x.violations_json, [])) { const k = vio.rule; const cur = rules.get(k) ?? { rule: k, impact: vio.impact, help: vio.help, pages: 0, nodes: 0 }; cur.pages += 1; cur.nodes += vio.nodes ?? 0; rules.set(k, cur); }
    const where = ['r.company_id = ?', 'r.deleted_at IS NULL']; const p = [c];
    if (q.issue === 'ACTIVE' || !q.issue) where.push("r.issue_status IN ('OPEN', 'FIXED')"); else if (q.issue !== 'ALL') { where.push('r.issue_status = ?'); p.push(q.issue); }
    if (q.kind) { where.push('u.run_kind = ?'); p.push(q.kind); }
    if (q.width) { where.push('u.width = ?'); p.push(q.width); }
    if (q.q) { where.push("(r.route LIKE ? ESCAPE '\\' OR r.journey LIKE ? ESCAPE '\\' OR r.violations_json LIKE ? ESCAPE '\\')"); const like = `%${q.q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`; p.push(like, like, like); }
    const pageSize = q.pageSize ?? 25; const pg = q.page ?? 1;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM tst_a11y_results r JOIN tst_a11y_runs u ON u.id = r.run_id WHERE ${where.join(' AND ')}`).get(...p).n;
    const rows = db.prepare(`SELECT r.*, u.run_kind, u.width, u.run_no FROM tst_a11y_results r JOIN tst_a11y_runs u ON u.id = r.run_id WHERE ${where.join(' AND ')} ORDER BY (r.critical_count + r.serious_count) DESC, r.overflow_px DESC, r.id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (pg - 1) * pageSize)
      .map((x) => ({ ...resultView(x), kind: x.run_kind, width: x.width, runNo: x.run_no }));
    const issues = db.prepare("SELECT issue_status AS s, COUNT(*) AS n FROM tst_a11y_results WHERE company_id = ? AND issue_status <> 'NONE' AND deleted_at IS NULL GROUP BY issue_status").all(c);
    const signoff = db.prepare('SELECT * FROM core_change_requests WHERE company_id = ? AND type = ? ORDER BY id DESC LIMIT 1').get(c, SIGNOFF_TYPE);
    const awaiting = signoff ? engine.awaiting(actor).some((x) => x.id === signoff.id) : false;
    const runs = db.prepare('SELECT * FROM tst_a11y_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 15').all(c).map(runView);
    return {
      verdict: { blocked: v.blocked, swept: v.swept, blockers: v.blockers, blockerCount: v.blockerCount }, sweeps: v.sweeps, byWidth,
      rules: [...rules.values()].sort((a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact) || b.pages - a.pages).slice(0, 15),
      devices, screenReader: sr, runs,
      issues: { open: issues.find((x) => x.s === 'OPEN')?.n ?? 0, fixed: issues.find((x) => x.s === 'FIXED')?.n ?? 0, retested: issues.find((x) => x.s === 'RETESTED')?.n ?? 0 },
      results: { rows, total, page: pg, pageSize },
      signoff: signoff ? { id: signoff.id, status: signoff.status, requestedBy: signoff.requested_by, at: signoff.created_at, awaitingMe: awaiting } : null,
      can: { record: hasPermissionAnywhere(actor, 'tst.a11y.record'), signoff: hasPermissionAnywhere(actor, 'tst.a11y.signoff'), export: hasPermissionAnywhere(actor, 'tst.a11y.export') },
    };
  }
  function result(actor, id) {
    guard(actor, 'tst.a11y.view');
    const x = db.prepare('SELECT r.*, u.run_kind, u.width, u.run_no FROM tst_a11y_results r JOIN tst_a11y_runs u ON u.id = r.run_id WHERE r.id = ? AND r.company_id = ? AND r.deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!x) throw notFound('That result does not exist.');
    const history = db.prepare('SELECT r.status, r.serious_count + r.critical_count AS serious, r.overflow_px, u.run_no, u.width, r.tested_at FROM tst_a11y_results r JOIN tst_a11y_runs u ON u.id = r.run_id WHERE r.company_id = ? AND COALESCE(r.page_code, r.journey) = COALESCE(?, ?) AND u.run_kind = ? ORDER BY r.id DESC LIMIT 12').all(actor.companyId, x.page_code, x.journey, x.run_kind);
    return { ...resultView(x), kind: x.run_kind, width: x.width, runNo: x.run_no, history: history.map((h) => ({ status: h.status, serious: h.serious, overflowPx: h.overflow_px, runNo: h.run_no, width: h.width, at: h.tested_at })) };
  }

  // ---------------------------------------------------------------- AC-01 the sign-off (maker-checker)
  const engine = createApprovalEngine({ db, handlers: { [SIGNOFF_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      writeAudit(db, { companyId: request.companyId ?? actor.companyId, entity: 'tst_a11y_signoff', entityId: request.id, action: 'signed_off', newValues: request.payload, actor: actor.user });
      publishEvent(db, { type: 'tst.a11y.signed_off', entity: 'core_change_requests', entityId: request.id, actorId: actor.user, companyId: actor.companyId, data: { requestId: request.id, pages: request.payload.pages, devices: request.payload.devices } });
    },
  } } });
  function requestSignoff(actor, { reason }) {
    guard(actor, 'tst.a11y.signoff');
    const v = verdictOf(actor.companyId);
    if (!v.swept) throw unprocessable('Nothing to sign: no accessibility sweep has been recorded.');
    if (v.blocked) throw unprocessable(`${v.blockerCount} business page(s) still have serious or critical accessibility findings (BR-01). Fix and re-test them first.`);
    const open = db.prepare("SELECT COUNT(*) AS n FROM tst_a11y_results WHERE company_id = ? AND issue_status = 'OPEN' AND deleted_at IS NULL").get(actor.companyId).n;
    const devices = db.prepare("SELECT COUNT(DISTINCT device_id) AS n FROM tst_a11y_runs WHERE company_id = ? AND run_kind = 'DEVICE' AND status = 'DONE' AND failed_count = 0").get(actor.companyId).n;
    const pagesSwept = Math.max(0, ...v.sweeps.map((s) => s.axe?.items ?? 0));
    return transaction(db, () => {
      const req = engine.submit(actor, { type: SIGNOFF_TYPE, title: `Accessibility and device validation sign-off (${pagesSwept} pages, ${devices} devices)`, targetType: 'tst_a11y_runs', targetId: '0', payload: { pages: pagesSwept, devices, openIssues: open, sweeps: v.sweeps.map((s) => ({ width: s.width, axe: s.axe?.runNo ?? null, responsive: s.responsive?.runNo ?? null })) }, reason, chain: ['ITADM'] });
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_a11y_signoff', entityId: req.id, action: 'request', newValues: { pages: pagesSwept, devices, openIssues: open }, reason, actor: actor.user });
      return { id: req.id, status: req.status };
    });
  }
  function decideSignoff(actor, id, body) {
    guard(actor, 'tst.a11y.view');
    const r = db.prepare('SELECT * FROM core_change_requests WHERE id = ? AND company_id = ? AND type = ?').get(Number(id), actor.companyId, SIGNOFF_TYPE);
    if (!r) throw notFound('That sign-off does not exist.');
    const out = engine.act(actor, r.id, body);
    return { id: out.id, status: out.status };
  }

  function exportResults(actor, q, format) {
    guard(actor, 'tst.a11y.export');
    const o = overview(actor, { ...q, page: 1, pageSize: 100000 });
    const rows = o.results.rows.map((x) => ({ run: x.runNo, kind: x.kind, width: x.width ?? '', page: x.route ?? x.journey ?? '', status: x.status, serious: x.counts.critical + x.counts.serious, other: x.counts.moderate + x.counts.minor, overflow: x.overflowPx, targets: x.smallTargets, rules: x.violations.map((v) => `${v.rule} (${v.impact})`).join('; '), issue: x.issue, fixedIn: x.fixedIn ?? '' }));
    const columns = [['run', 'Run'], ['kind', 'Check'], ['width', 'Width'], ['page', 'Page or journey'], ['status', 'Result'], ['serious', 'Serious/critical'], ['other', 'Moderate/minor'], ['overflow', 'Overflow (px)'], ['targets', 'Small targets'], ['rules', 'Rules'], ['issue', 'Issue'], ['fixedIn', 'Fixed in']].map(([key, label]) => ({ key, label }));
    const buffer = writeExport(format, { columns, rows, title: 'Accessibility and device validation', sheetName: 'Results', footer: [`${rows.length} results · business pages with serious or critical findings: ${o.verdict.blockerCount} · issues open ${o.issues.open}, fixed ${o.issues.fixed}, re-tested ${o.issues.retested}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'tst.a11y', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `accessibility-validation.${format}` };
  }

  return { recordRun, recordManual, fixIssue, overview, result, requestSignoff, decideSignoff, exportResults, engine, pages };
}
