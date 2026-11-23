import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';

/**
 * Part 30.06 — performance, scalability and load testing: the results.
 *
 * FR-01 the load models (scripts/load_test.mjs, perf/k6/*.js): 1,000 concurrent users browsing lists and records, a morning burst of 2,000
 *       punches a minute, 200 DPRs in the evening half hour, month-end posting with the reports, the real-time path; and the soak.
 * FR-02 every run is recorded here (POST /tst/perf/runs, by the runner or CI) with each journey's percentiles and throughput; each journey
 *       is held to its SLO, read from parameters (changed only through the parameter change request, maker-checker):
 *       list 500 ms, record 300 ms, save 800 ms, report 3 s, real-time 2 s (p95), the punch burst 2,000 a minute.
 * T-01  a run passes when every journey meets its SLO with no error; a soak passes when the memory after warm-up grows less than the
 *       allowed percentage (no leak).
 */
export const PERF_FLAG = 'ff.qa.p3006';
export const SLO_KINDS = ['LIST', 'RECORD', 'SAVE', 'REPORT', 'REALTIME', 'BURST'];
const SLO = { LIST: 'tst.perf.slo_list_ms', RECORD: 'tst.perf.slo_record_ms', SAVE: 'tst.perf.slo_save_ms', REPORT: 'tst.perf.slo_report_ms', REALTIME: 'tst.perf.slo_realtime_ms' };
const BURST_RATE = 'tst.perf.punch_burst_per_min';
const SOAK_GROWTH = 'tst.perf.soak_growth_pct';
for (const [key, def, min, max, description] of /** @type {[string, number, number, number, string][]} */ ([
  [SLO.LIST, 500, 50, 60_000, 'Part 30.06 SLO: a list answers within this many milliseconds at p95.'],
  [SLO.RECORD, 300, 50, 60_000, 'Part 30.06 SLO: a record (object page) answers within this many milliseconds at p95.'],
  [SLO.SAVE, 800, 50, 60_000, 'Part 30.06 SLO: a save answers within this many milliseconds at p95.'],
  [SLO.REPORT, 3000, 100, 120_000, 'Part 30.06 SLO: a report of the month-end answers within this many milliseconds at p95.'],
  [SLO.REALTIME, 2000, 100, 60_000, 'Part 30.06 SLO: an event reaches the person\'s screen and notifications within this many milliseconds at p95.'],
  [BURST_RATE, 2000, 1, 1_000_000, 'Part 30.06 SLO: the punches a minute the morning burst must take without error.'],
  [SOAK_GROWTH, 10, 1, 1000, 'Part 30.06 T-01: the largest growth of the memory in use over a soak, after warm-up, in per cent (more is a leak).'],
])) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });

integrityRegistry.register({ statuses: { tst_perf_runs: ['PASS', 'FAIL'], tst_perf_results: ['PASS', 'FAIL'] } });
if (!eventTypes.get('tst.perf.recorded')) eventTypes.define({ type: 'tst.perf.recorded', version: 1, schema: { type: 'object' }, owner: 'tst', description: 'A performance run was recorded (part 30.06): data { runId, runNo, profile, result, failed }.' });

const iso = (d = new Date()) => d.toISOString();
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** The growth of the memory over a soak: the samples after the first tenth (warm-up), first against the last three (smoothed). */
export function memoryGrowth(samples = []) {
  if (samples.length < 4) return { growthPct: null, slopeMbPerHour: null };
  const s = samples.slice(Math.floor(samples.length / 10));
  const start = s[0].rssMb; const tail = s.slice(-3); const end = tail.reduce((a, x) => a + x.rssMb, 0) / tail.length;
  const n = s.length; const xs = s.map((x) => x.t / 3600); const ys = s.map((x) => x.rssMb);
  const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : 0;
  return { growthPct: start > 0 ? r2(((end - start) / start) * 100) : null, slopeMbPerHour: r2(slope) };
}

/** The default SLOs (the parameters' defaults), for the runner's own verdict where no installation is asked. */
export const DEFAULT_SLOS = Object.freeze({ LIST: 500, RECORD: 300, SAVE: 800, REPORT: 3000, REALTIME: 2000, BURST_PER_MIN: 2000, SOAK_GROWTH_PCT: 10 });

/** T-01: each journey against its SLO (p95, no error, and for the burst its rate); a soak also against the growth of its memory. */
export function judgeRun(b, s = DEFAULT_SLOS) {
  const scale = b.profile === 'SMOKE' ? b.burstScale ?? null : null;
  const judged = b.results.map((x) => {
    const sloMs = x.sloKind === 'BURST' ? s.SAVE : s[x.sloKind];
    // the burst is held to 2,000 a minute; a smoke run sends a tenth of it, so it is held to its own pace
    const target = x.sloKind === 'BURST' ? r2((scale ?? s.BURST_PER_MIN) / 60) : (x.targetRps ?? null);
    const fast = x.p95 <= sloMs; const enough = target == null || x.throughputRps >= target * 0.98; // 2 % for the clock of the runner
    return { ...x, sloMs, targetRps: target, status: fast && enough && x.errors === 0 ? 'PASS' : 'FAIL' };
  });
  const mem = b.memory ? { samples: (b.memory.samples ?? []).slice(0, 5000), ...memoryGrowth(b.memory.samples ?? []) } : null;
  const soakOk = b.profile !== 'SOAK' || (mem?.growthPct != null && mem.growthPct <= s.SOAK_GROWTH_PCT);
  return { judged, mem, soakOk, result: judged.every((x) => x.status === 'PASS') && soakOk ? 'PASS' : 'FAIL' };
}

export function createPerfService(context) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, PERF_FLAG)) throw notFound('Performance test results are not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const param = (companyId, key) => Number(createParameterStore(db).get(key, { companyId, date: todayIST() }));
  const slos = (companyId) => ({ LIST: param(companyId, SLO.LIST), RECORD: param(companyId, SLO.RECORD), SAVE: param(companyId, SLO.SAVE), REPORT: param(companyId, SLO.REPORT), REALTIME: param(companyId, SLO.REALTIME), BURST_PER_MIN: param(companyId, BURST_RATE), SOAK_GROWTH_PCT: param(companyId, SOAK_GROWTH) });
  const runView = (r) => { const mem = (() => { try { return JSON.parse(r.memory_json ?? 'null'); } catch { return null; } })(); return { id: r.id, runNo: r.run_no, profile: r.profile, tool: r.tool, environment: r.environment, machine: r.machine, startedAt: r.started_at, finishedAt: r.finished_at, durationS: r.duration_s, users: r.users_count, requests: r.requests_count, errors: r.errors_count, rss: { start: r.rss_start_mb, end: r.rss_end_mb, max: r.rss_max_mb }, growthPct: mem?.growthPct ?? null, slopeMbPerHour: mem?.slopeMbPerHour ?? null, result: r.result_status, commitRef: r.commit_ref, requestedBy: r.requested_by }; };
  const resultView = (x) => ({ id: x.id, model: x.model, journey: x.journey, sloKind: x.slo_kind, sloMs: x.slo_ms, requests: x.requests_count, errors: x.errors_count, p50: Number(x.p50_ms), p95: Number(x.p95_ms), p99: Number(x.p99_ms), max: Number(x.max_ms), throughputRps: Number(x.throughput_rps), targetRps: x.target_rps == null ? null : Number(x.target_rps), status: x.status });

  /** FR-02 a run and its journeys, each judged against its SLO now. */
  function record(actor, b) {
    guard(actor, 'tst.perf.record');
    if (Date.parse(b.finishedAt) < Date.parse(b.startedAt)) throw badRequest('The run finishes before it starts.', [{ field: 'finishedAt', message: 'After startedAt' }]);
    const { judged, mem, result } = judgeRun(b, slos(actor.companyId));
    const requests = judged.reduce((a, x) => a + x.requests, 0); const errors = judged.reduce((a, x) => a + x.errors, 0);
    return transaction(db, () => {
      const no = `PRF-${String((db.prepare('SELECT COUNT(*) AS n FROM tst_perf_runs WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1).padStart(5, '0')}`;
      const id = Number(db.prepare("INSERT INTO tst_perf_runs (company_id, run_no, profile, tool, environment, machine, started_at, finished_at, duration_s, users_count, requests_count, errors_count, rss_start_mb, rss_end_mb, rss_max_mb, memory_json, result_status, commit_ref, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'perf_runner')")
        .run(actor.companyId, no, b.profile, b.tool, b.environment, b.machine ?? null, b.startedAt, b.finishedAt, Math.round((Date.parse(b.finishedAt) - Date.parse(b.startedAt)) / 1000), b.users ?? 0, requests, errors, b.memory?.startMb ?? null, b.memory?.endMb ?? null, b.memory?.maxMb ?? null, mem ? JSON.stringify(mem) : null, result, b.commitRef ?? null, actor.user, actor.user).lastInsertRowid);
      const ins = db.prepare('INSERT INTO tst_perf_results (company_id, run_id, model, journey, slo_kind, slo_ms, requests_count, errors_count, p50_ms, p95_ms, p99_ms, max_ms, throughput_rps, target_rps, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'perf_runner\')');
      for (const x of judged) ins.run(actor.companyId, id, x.model, x.journey, x.sloKind, x.sloMs, x.requests, x.errors, r2(x.p50), r2(x.p95), r2(x.p99), r2(x.max), r2(x.throughputRps), x.targetRps, x.status, actor.user);
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_perf_runs', entityId: id, action: 'record', newValues: { runNo: no, profile: b.profile, result, journeys: judged.length, failed: judged.filter((x) => x.status === 'FAIL').length }, actor: actor.user });
      publishEvent(db, { type: 'tst.perf.recorded', entity: 'tst_perf_runs', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { runId: id, runNo: no, profile: b.profile, result, failed: judged.filter((x) => x.status === 'FAIL').length } });
      return run(actor, id);
    });
  }

  function run(actor, id) {
    guard(actor, 'tst.perf.view');
    const r = db.prepare('SELECT * FROM tst_perf_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!r) throw notFound('That performance run does not exist.');
    const mem = (() => { try { return JSON.parse(r.memory_json ?? 'null'); } catch { return null; } })();
    return { ...runView(r), memory: mem?.samples ?? [], results: db.prepare('SELECT * FROM tst_perf_results WHERE run_id = ? ORDER BY model, journey').all(r.id).map(resultView) };
  }

  /** The console: the SLOs, the verdict of the latest load and soak runs, p95 per kind over the runs, the runs, the selected run. */
  function overview(actor, q = {}) {
    guard(actor, 'tst.perf.view');
    const c = actor.companyId;
    const latest = (profile) => db.prepare('SELECT * FROM tst_perf_runs WHERE company_id = ? AND profile = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(c, profile);
    const last = Object.fromEntries(['SMOKE', 'LOAD', 'STRESS', 'SOAK'].map((p) => { const r = latest(p); return [p, r ? runView(r) : null]; }));
    const history = db.prepare('SELECT * FROM tst_perf_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 20').all(c).reverse();
    const trend = history.map((h) => ({ runNo: h.run_no, id: h.id, profile: h.profile, ...Object.fromEntries(SLO_KINDS.map((k) => [k, db.prepare('SELECT MAX(p95_ms) AS m FROM tst_perf_results WHERE run_id = ? AND slo_kind = ?').get(h.id, k).m])) }));
    const where = ['company_id = ?', 'deleted_at IS NULL']; const p = [c];
    if (q.profile) { where.push('profile = ?'); p.push(q.profile); }
    if (q.result) { where.push('result_status = ?'); p.push(q.result); }
    const pageSize = q.pageSize ?? 20; const pg = q.page ?? 1;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM tst_perf_runs WHERE ${where.join(' AND ')}`).get(...p).n;
    const rows = db.prepare(`SELECT * FROM tst_perf_runs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (pg - 1) * pageSize).map(runView);
    const selectedId = q.run ?? last.LOAD?.id ?? rows[0]?.id ?? null;
    const selected = selectedId ? run(actor, selectedId) : null;
    const verdict = !last.LOAD ? 'NOT_TESTED' : last.LOAD.result === 'PASS' && (!last.SOAK || last.SOAK.result === 'PASS') ? 'PASS' : 'FAIL';
    return { slos: slos(c), verdict, last, trend, runs: { rows, total, page: pg, pageSize }, selected, can: { record: hasPermissionAnywhere(actor, 'tst.perf.record'), export: hasPermissionAnywhere(actor, 'tst.perf.export'), parameters: hasPermissionAnywhere(actor, 'core.parameter.manage') } };
  }

  function exportRun(actor, runId, format) {
    guard(actor, 'tst.perf.export');
    const r = run(actor, runId);
    const rows = r.results.map((x) => ({ model: x.model, journey: x.journey, kind: x.sloKind, slo: x.sloMs, requests: x.requests, errors: x.errors, p50: x.p50, p95: x.p95, p99: x.p99, max: x.max, rps: x.throughputRps, target: x.targetRps ?? '', status: x.status }));
    const columns = [['model', 'Load model'], ['journey', 'Journey'], ['kind', 'SLO kind'], ['slo', 'SLO p95 (ms)'], ['requests', 'Requests'], ['errors', 'Errors'], ['p50', 'p50 (ms)'], ['p95', 'p95 (ms)'], ['p99', 'p99 (ms)'], ['max', 'Max (ms)'], ['rps', 'Requests/s'], ['target', 'Target/s'], ['status', 'Result']].map(([key, label]) => ({ key, label }));
    const buffer = writeExport(format, { columns, rows, title: `Performance run ${r.runNo} (${r.profile})`, sheetName: 'Journeys', footer: [`${r.runNo} · ${r.profile} · ${r.users} users · ${r.durationS} s · ${r.requests} requests · ${r.errors} errors · memory ${r.rss.start ?? '—'} → ${r.rss.end ?? '—'} MB (max ${r.rss.max ?? '—'}) · ${r.result}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'tst.perf', action: 'export', newValues: { format, run: r.runNo }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `performance-${r.runNo}.${format}` };
  }

  return { record, run, overview, exportRun, slos };
}
