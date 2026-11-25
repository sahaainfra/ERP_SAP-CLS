import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { conflict, notFound } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { realtimeOf } from '../../platform/realtime/index.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { HANDOFFS, THREADS } from './threads.js';

/**
 * Part 30.01 — cross-module integration and real-time propagation.
 *
 * FR-01 the threads of threads.js verified on the live data of a company (verifyThreads): broken hand-offs, re-keyed fields, failed postings.
 * FR-02 the latency probe: a probe event goes through the outbox and the bus to its consumer, which announces it on the person's real-time
 *       room and in their notifications; the time from the event to each is recorded and compared with the target (2 s, a parameter).
 *       The bus's own history gives the latency of every consumer (event created → handled).
 * FR-03 the re-keying audit: the fields a hand-off carries over that differ from their source (threads.js `inherit`).
 * FR-04 the integration matrix: every event type of the catalogue with each consumer the bus delivers it to — producer, event, consumer,
 *       the tests that cover it, deliveries (processed, pending, dead) and latency — and its status.
 * A run (background job) stores a snapshot of all of it; the page shows the latest run and its history.
 */
export const INTEGRATION_FLAG = 'ff.qa.p3001';
export const CHECK_JOB = 'tst.integration.check';
export const PROBE_EVENT = 'tst.probe.sent';
export const PROBE_CONSUMER = 'tst.probe';
const TARGET_KEY = 'tst.integration.latency_target_ms';
const STUCK_KEY = 'tst.integration.pending_alert_minutes';
if (!parameterRegistry.get(TARGET_KEY)) parameterRegistry.define({ key: TARGET_KEY, dataType: 'integer', default: 2000, min: 100, max: 60000, scopes: ['system', 'company'], description: 'Part 30.01 FR-02: the most time (milliseconds) from a domain event to the dashboard and the notification it causes.' });
if (!parameterRegistry.get(STUCK_KEY)) parameterRegistry.define({ key: STUCK_KEY, dataType: 'integer', default: 5, min: 1, max: 1440, scopes: ['system', 'company'], description: 'Part 30.01: minutes after which an undelivered event marks its consumer as failing in the integration matrix.' });

const shape = { type: 'object' };
for (const [type, description] of [
  [PROBE_EVENT, 'A latency probe sent through the outbox (part 30.01 FR-02): data { probeId }.'],
  ['tst.integration.checked', 'An integration check run finished (part 30.01): data { runId, status, threadsPassed, threads, edgesFailed, rekeyed, latencyP95Ms }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: shape, owner: 'tst', description });

// integrity: the states of this part's tables (the Data Health check)
integrityRegistry.register({ statuses: { tst_integration_runs: ['QUEUED', 'RUNNING', 'DONE', 'FAILED'], tst_latency_probes: ['SENT', 'PASS', 'FAIL'] } });
const iso = (d = new Date()) => d.toISOString();
const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : null);
const p95 = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
const matches = (pattern, type) => pattern === '*' || (pattern.endsWith('.*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type);
const COL = /^[a-z_][a-z0-9_]*$/;

// ---------------------------------------------------------------- the tests that cover an event or a consumer (the matrix's test IDs)
let testIndex = null;
/** Reads tests/*.test.js once: which files mention an event type or a consumer name. Production builds without the tests folder get none. */
export function testReferences(root = process.cwd()) {
  if (testIndex && testIndex.root === root) return testIndex;
  const dir = join(root, 'tests');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort() : [];
  testIndex = { root, available: files.length > 0, files: files.map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') })) };
  return testIndex;
}
const testsFor = (idx, needles) => idx.files.filter((f) => needles.some((n) => n && f.text.includes(`'${n}'`))).map((f) => f.name.replace(/\.test\.js$/, ''));

/** @param {any} context @param {{ jobs?: any, scheduler?: any, bus?: any, root?: string }} deps */
export function createIntegrationService(context, { jobs, scheduler, bus, root = process.cwd() } = {}) {
  const { db } = context;
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const columnsOf = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  const target = (companyId) => Number(createParameterStore(db).get(TARGET_KEY, { companyId, date: iso().slice(0, 10) }));
  const stuckMinutes = (companyId) => Number(createParameterStore(db).get(STUCK_KEY, { companyId, date: iso().slice(0, 10) }));
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, INTEGRATION_FLAG)) throw notFound('Integration testing is not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };

  // ---------------------------------------------------------------- FR-01 / FR-03: one hand-off on the data of a company
  const SAMPLES = 10;
  function checkHandoff(companyId, x) {
    const base = { code: x.code, label: x.label, to: x.to, from: x.from, events: x.events ?? [], consumers: x.consumers ?? [] };
    if (!has(x.to) || !has(x.from)) return { ...base, status: 'NOT_INSTALLED', total: 0, broken: 0, rekeyed: 0, brokenRows: [], rekeyedRows: [] };
    try {
      const P = { c: companyId };
      let total; let brokenRows = []; let rekeyedRows = [];
      if (x.custom) {
        total = db.prepare(x.custom.total).get(P).n;
        if (x.custom.broken) brokenRows = db.prepare(`${x.custom.broken} LIMIT 500`).all(P);
        if (x.custom.rekeyed) rekeyedRows = db.prepare(`${x.custom.rekeyed} LIMIT 500`).all(P);
      } else {
        const tc = columnsOf(x.to);
        const on = x.on ?? `f.id = t.${x.fk}`;
        const live = `t.company_id = :c${tc.has('deleted_at') ? ' AND t.deleted_at IS NULL' : ''}${x.where ? ` AND (${x.where})` : ''}`;
        const ref = tc.has(x.ref) ? `t.${x.ref}` : 't.id';
        total = db.prepare(`SELECT COUNT(*) AS n FROM ${x.to} t LEFT JOIN ${x.from} f ON ${on} WHERE ${live}`).get(P).n;
        const must = x.required ?? (x.fk ? `t.${x.fk} IS NOT NULL` : '0');
        brokenRows = db.prepare(`SELECT t.id, ${ref} AS ref${x.fk ? `, t.${x.fk} AS detail` : ''} FROM ${x.to} t LEFT JOIN ${x.from} f ON ${on} WHERE ${live} AND (${must}) AND f.id IS NULL LIMIT 500`).all(P);
        for (const [toCol, fromCol] of x.inherit ?? []) {
          const fe = COL.test(fromCol) ? `f.${fromCol}` : fromCol;
          rekeyedRows.push(...db.prepare(`SELECT t.id, ${ref} AS ref, '${toCol}' AS field, t.${toCol} AS value, ${fe} AS source FROM ${x.to} t JOIN ${x.from} f ON ${on} WHERE ${live} AND t.${toCol} IS NOT NULL AND ${fe} IS NOT NULL AND t.${toCol} IS NOT ${fe} LIMIT 500`).all(P));
        }
      }
      const labels = { ...Object.fromEntries((x.inherit ?? []).map(([to, , l]) => [to, l])), ...(x.fieldLabels ?? {}) };
      const status = brokenRows.length ? 'BROKEN' : rekeyedRows.length ? 'REKEYED' : total === 0 ? 'NO_DATA' : 'PASS';
      return { ...base, status, total, broken: brokenRows.length, rekeyed: rekeyedRows.length,
        brokenRows: brokenRows.slice(0, SAMPLES).map((r) => ({ id: r.id, ref: r.ref == null ? String(r.id) : String(r.ref), detail: r.detail == null ? null : String(r.detail) })),
        rekeyedRows: rekeyedRows.slice(0, SAMPLES).map((r) => ({ id: r.id, ref: r.ref == null ? String(r.id) : String(r.ref), field: r.field, fieldLabel: labels[r.field] ?? r.field, value: r.value == null ? null : String(r.value), source: r.source == null ? null : String(r.source) })) };
    } catch (e) {
      return { ...base, status: 'ERROR', error: String(e?.message ?? e).slice(0, 300), total: 0, broken: 0, rekeyed: 0, brokenRows: [], rekeyedRows: [] };
    }
  }
  /** The failed postings (23.02) of the thread's documents. */
  function postingFailures(companyId, types) {
    if (!types?.length || !has('fin_posting_log')) return { failed: 0, rows: [] };
    const rows = db.prepare(`SELECT id, event_type AS type, doc_ref AS ref, error FROM fin_posting_log WHERE company_id = ? AND log_status = 'FAILED' AND event_type IN (${types.map(() => '?').join(', ')}) ORDER BY id DESC LIMIT 200`).all(companyId, ...types);
    return { failed: rows.length, rows: rows.slice(0, SAMPLES) };
  }
  function verifyThreads(companyId, only = null) {
    return THREADS.filter((t) => !only || t.code === only).map((t) => {
      const handoffs = t.handoffs.map((x) => checkHandoff(companyId, x));
      const posting = postingFailures(companyId, t.posting);
      const failed = handoffs.filter((x) => ['BROKEN', 'REKEYED', 'ERROR'].includes(x.status)).length + (posting.failed ? 1 : 0);
      const withData = handoffs.filter((x) => x.total > 0).length;
      const installed = handoffs.filter((x) => x.status !== 'NOT_INSTALLED').length;
      const status = failed ? 'FAIL' : withData === 0 ? 'NO_DATA' : 'PASS';
      return { code: t.code, name: t.name, modules: t.modules, status, handoffs, posting, coverage: installed ? Math.round((withData / installed) * 1000) / 10 : 0,
        broken: handoffs.reduce((n, x) => n + x.broken, 0), rekeyed: handoffs.reduce((n, x) => n + x.rekeyed, 0) };
    });
  }

  // ---------------------------------------------------------------- FR-04 / FR-02: the matrix from the catalogue and the bus
  const HANDOFF_BY_EVENT = new Map();
  for (const x of HANDOFFS) for (const e of x.events ?? []) HANDOFF_BY_EVENT.set(e, [...(HANDOFF_BY_EVENT.get(e) ?? []), x.code]);
  const LATENCY_WINDOW_DAYS = 30;
  function deliveryStats(companyId) {
    if (!has('core_inbox')) return new Map();
    const since = iso(new Date(Date.now() - LATENCY_WINDOW_DAYS * 86_400_000));
    const out = new Map();
    for (const r of db.prepare('SELECT consumer, event_type AS type, status, COUNT(*) AS n, MAX(processed_at) AS last, MIN(CASE WHEN status = \'PENDING\' THEN created_at END) AS oldest FROM core_inbox WHERE company_id = ? GROUP BY consumer, event_type, status').all(companyId)) {
      const k = `${r.consumer}|${r.type}`; const s = out.get(k) ?? { processed: 0, pending: 0, dead: 0, discarded: 0, last: null, oldestPending: null, latencies: [] };
      s[String(r.status).toLowerCase()] = r.n; if (r.last && (!s.last || r.last > s.last)) s.last = r.last; if (r.oldest) s.oldestPending = r.oldest; out.set(k, s);
    }
    for (const r of db.prepare("SELECT i.consumer, i.event_type AS type, o.created_at AS sent, i.processed_at AS done FROM core_inbox i JOIN core_outbox o ON o.id = i.outbox_id WHERE i.company_id = ? AND i.status = 'PROCESSED' AND i.processed_at >= ? ORDER BY i.id DESC LIMIT 20000").all(companyId, since)) {
      const s = out.get(`${r.consumer}|${r.type}`); const l = ms(r.sent, r.done); if (s && l != null && l >= 0) s.latencies.push(l);
    }
    return out;
  }
  function publishedCounts(companyId) {
    const out = new Map();
    if (!has('core_outbox')) return out;
    const since = iso(new Date(Date.now() - LATENCY_WINDOW_DAYS * 86_400_000));
    for (const r of db.prepare("SELECT event_type AS type, COUNT(*) AS n, MAX(created_at) AS last FROM core_outbox WHERE created_at >= ? AND json_extract(payload, '$.companyId') = ? GROUP BY event_type").all(since, companyId)) out.set(r.type, { n: r.n, last: r.last });
    return out;
  }
  function matrix(companyId) {
    const consumers = bus?.consumers?.() ?? [];
    const types = eventTypes.list();
    const declared = new Set(types.map((t) => t.type));
    const stats = deliveryStats(companyId);
    const published = publishedCounts(companyId);
    const idx = testReferences(root);
    const stuckMs = stuckMinutes(companyId) * 60_000;
    const now = Date.now();
    const rows = [];
    for (const t of types) {
      const subs = consumers.filter((c) => c.patterns.some((p) => matches(p, t.type)));
      for (const c of subs) {
        const s = stats.get(`${c.name}|${t.type}`) ?? { processed: 0, pending: 0, dead: 0, discarded: 0, last: null, oldestPending: null, latencies: [] };
        const pub = published.get(t.type)?.n ?? 0;
        const stuck = s.pending > 0 && s.oldestPending && now - Date.parse(s.oldestPending) > stuckMs;
        const tests = idx.available ? testsFor(idx, [t.type, c.name]) : [];
        const threads = HANDOFF_BY_EVENT.get(t.type) ?? [];
        const status = s.dead > 0 || stuck ? 'FAIL' : s.processed > 0 ? 'PASS' : pub > 0 && s.pending > 0 ? 'PENDING' : 'NOT_EXERCISED';
        rows.push({ producer: t.owner, event: t.type, version: t.version, description: t.description, consumer: c.name, consumerModule: c.name.split('.')[0], wildcard: !c.patterns.includes(t.type),
          published: pub, processed: s.processed, pending: s.pending, dead: s.dead, discarded: s.discarded, lastAt: s.last, latencyP95Ms: p95(s.latencies), samples: s.latencies.length,
          tests, threads, testIds: [...threads, ...tests], status });
      }
    }
    // a subscription to an event nobody declares is a hand-off that can never happen (BR-01)
    const dangling = [];
    for (const c of consumers) for (const p of c.patterns) if (!p.includes('*') && !declared.has(p)) dangling.push({ consumer: c.name, pattern: p, published: published.get(p)?.n ?? 0 });
    // declared events no consumer takes (information: many are for audit and webhooks only)
    const unconsumed = types.filter((t) => !consumers.some((c) => c.patterns.some((p) => matches(p, t.type)))).length;
    return { rows, dangling, unconsumed, eventTypes: types.length, consumers: consumers.length, testsAvailable: idx.available };
  }

  // ---------------------------------------------------------------- FR-02: the latency probe
  function probeView(p) {
    return { id: p.id, probeNo: p.probe_no, status: p.status, sentAt: p.sent_at, consumedAt: p.consumed_at, realtimeAt: p.realtime_at, notifiedAt: p.notified_at,
      busMs: ms(p.sent_at, p.consumed_at), realtimeMs: p.latency_ms, notificationMs: ms(p.sent_at, p.notified_at), targetMs: p.target_ms, requestedBy: p.requested_by };
  }
  const probes = {
    send(actor) {
      guard(actor, 'tst.integration.run');
      return transaction(db, () => {
        const no = `PRB-${String((db.prepare('SELECT COUNT(*) AS n FROM tst_latency_probes WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1).padStart(6, '0')}`;
        const sentAt = iso();
        const id = Number(db.prepare("INSERT INTO tst_latency_probes (company_id, probe_no, status, sent_at, target_ms, requested_by, created_by, source_type) VALUES (?, ?, 'SENT', ?, ?, ?, ?, 'probe')").run(actor.companyId, no, sentAt, target(actor.companyId), actor.user, actor.user).lastInsertRowid);
        publishEvent(db, { type: PROBE_EVENT, entity: 'tst_latency_probes', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { probeId: id }, now: new Date(sentAt) });
        writeAudit(db, { companyId: actor.companyId, entity: 'tst_latency_probes', entityId: id, action: 'create', newValues: { probeNo: no }, actor: actor.user });
        return probeView(db.prepare('SELECT * FROM tst_latency_probes WHERE id = ?').get(id));
      });
    },
    get(actor, id) {
      guard(actor, 'tst.integration.view');
      const p = db.prepare('SELECT * FROM tst_latency_probes WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
      if (!p) throw notFound('That probe does not exist.');
      return probeView(p);
    },
    list(actor) {
      guard(actor, 'tst.integration.view');
      return db.prepare('SELECT * FROM tst_latency_probes WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 20').all(actor.companyId).map(probeView);
    },
    /** The consumer (runs inside the bus's transaction): announce on the person's room and notifications and record the times. */
    handle(event) {
      const p = db.prepare('SELECT * FROM tst_latency_probes WHERE id = ?').get(Number(event.data?.probeId));
      if (!p || p.status !== 'SENT') return;
      const consumedAt = iso();
      realtimeOf(db).publish({ companyId: p.company_id, rooms: [`user:${p.requested_by}`], type: 'tst.probe.delivered', entity: 'tst_latency_probes', entityId: p.id, data: { probeId: p.id, probeNo: p.probe_no } });
      const realtimeAt = iso();
      let notifiedAt = null;
      try { notificationsOf(db).notify({ companyId: p.company_id, templateCode: 'tst.probe.delivered', recipients: [`user:${p.requested_by}`], channels: ['IN_APP'], priority: 'LOW', data: { probe: p.probe_no }, link: '/admin/integration-matrix', sourceType: 'tst_latency_probes', sourceId: p.id }); notifiedAt = iso(); } catch { /* the dashboard time is still recorded */ }
      const latency = ms(p.sent_at, notifiedAt ?? realtimeAt);
      db.prepare('UPDATE tst_latency_probes SET status = ?, consumed_at = ?, realtime_at = ?, notified_at = ?, latency_ms = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(latency <= p.target_ms ? 'PASS' : 'FAIL', consumedAt, realtimeAt, notifiedAt, latency, iso(), p.id);
    },
  };
  function latencySummary(companyId) {
    const recent = db.prepare("SELECT * FROM tst_latency_probes WHERE company_id = ? AND status IN ('PASS', 'FAIL') ORDER BY id DESC LIMIT 20").all(companyId);
    const xs = recent.map((p) => p.latency_ms).filter((x) => x != null);
    return { targetMs: target(companyId), probes: recent.length, p95Ms: p95(xs), maxMs: xs.length ? Math.max(...xs) : null, withinTarget: xs.length > 0 && p95(xs) <= target(companyId) };
  }

  // ---------------------------------------------------------------- the run (background job) and its snapshot
  function compute(companyId) {
    const threads = verifyThreads(companyId);
    const m = matrix(companyId);
    const latency = latencySummary(companyId);
    const rekeying = threads.flatMap((t) => t.handoffs.filter((x) => x.rekeyed > 0).map((x) => ({ thread: t.code, handoff: x.code, label: x.label, to: x.to, from: x.from, count: x.rekeyed, rows: x.rekeyedRows })));
    const edgesFailed = m.rows.filter((r) => r.status === 'FAIL').length;
    const consumerLatencies = m.rows.filter((r) => r.latencyP95Ms != null).map((r) => r.latencyP95Ms);
    const totals = {
      threads: threads.length, threadsPassed: threads.filter((t) => t.status === 'PASS').length, threadsFailed: threads.filter((t) => t.status === 'FAIL').length, threadsNoData: threads.filter((t) => t.status === 'NO_DATA').length,
      handoffs: HANDOFFS.length, handoffsBroken: threads.reduce((n, t) => n + t.handoffs.filter((x) => x.status === 'BROKEN').length, 0), rekeyed: rekeying.reduce((n, r) => n + r.count, 0),
      edges: m.rows.length, edgesPassed: m.rows.filter((r) => r.status === 'PASS').length, edgesFailed, edgesNotExercised: m.rows.filter((r) => r.status === 'NOT_EXERCISED').length, dangling: m.dangling.length,
      eventTypes: m.eventTypes, consumers: m.consumers, unconsumed: m.unconsumed, consumerLatencyP95Ms: p95(consumerLatencies), probeP95Ms: latency.p95Ms, targetMs: latency.targetMs,
    };
    // a subscription to an event nobody publishes is a warning (listed, and a defect of its owner); it does not stop delivery of anything that happens
    const green = totals.threadsFailed === 0 && totals.threadsPassed > 0 && edgesFailed === 0 && totals.rekeyed === 0 && (latency.p95Ms == null || latency.p95Ms <= latency.targetMs);
    return { status: green ? 'GREEN' : 'RED', totals, threads, matrix: m.rows, dangling: m.dangling, rekeying, latency, testsAvailable: m.testsAvailable, computedAt: iso() };
  }
  const runView = (r, full = false) => {
    /** @type {any} */
    const o = { id: r.id, runNo: r.run_no, status: r.status, result: r.result_status, startedAt: r.started_at, finishedAt: r.finished_at, requestedBy: r.requested_by, error: r.error,
      totals: r.totals_json ? JSON.parse(r.totals_json) : null };
    if (full && r.result_json) { const rest = JSON.parse(r.result_json); delete rest.status; Object.assign(o, rest); }
    return o;
  };
  function execute(runId) {
    const r = db.prepare('SELECT * FROM tst_integration_runs WHERE id = ?').get(runId);
    if (!r || r.status !== 'QUEUED') return null;
    db.prepare("UPDATE tst_integration_runs SET status = 'RUNNING', started_at = ?, updated_at = ? WHERE id = ?").run(iso(), iso(), r.id);
    try {
      const out = compute(r.company_id);
      transaction(db, () => {
        db.prepare("UPDATE tst_integration_runs SET status = 'DONE', result_status = ?, finished_at = ?, totals_json = ?, result_json = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(out.status, iso(), JSON.stringify(out.totals), JSON.stringify(out), iso(), r.id);
        publishEvent(db, { type: 'tst.integration.checked', entity: 'tst_integration_runs', entityId: r.id, actorId: r.requested_by, companyId: r.company_id, data: { runId: r.id, status: out.status, threadsPassed: out.totals.threadsPassed, threads: out.totals.threads, edgesFailed: out.totals.edgesFailed, rekeyed: out.totals.rekeyed, latencyP95Ms: out.totals.probeP95Ms } });
      });
      try { notificationsOf(db).notify({ companyId: r.company_id, templateCode: 'tst.check.completed', recipients: [r.requested_by === 'system' ? 'permission:tst.integration.run' : `user:${r.requested_by}`], channels: r.requested_by === 'system' ? ['IN_APP', 'EMAIL'] : ['IN_APP'], priority: out.status === 'GREEN' ? 'LOW' : 'HIGH', data: { run: r.run_no, kind: 'Integration check', result: out.status }, link: `/admin/integration-matrix?run=${r.id}`, sourceType: 'tst_integration_runs', sourceId: r.id }); } catch { /* the run is saved */ }
      return out;
    } catch (e) {
      db.prepare("UPDATE tst_integration_runs SET status = 'FAILED', finished_at = ?, error = ?, updated_at = ? WHERE id = ?").run(iso(), String(e?.message ?? e).slice(0, 500), iso(), r.id);
      throw e;
    }
  }
  function queue(companyId, by) {
    if (db.prepare("SELECT 1 FROM tst_integration_runs WHERE company_id = ? AND status IN ('QUEUED', 'RUNNING') AND created_at > ?").get(companyId, iso(new Date(Date.now() - 10 * 60_000)))) throw conflict('A check is already running for this company; wait for it to finish.');
    const no = `ITR-${String((db.prepare('SELECT COUNT(*) AS n FROM tst_integration_runs WHERE company_id = ?').get(companyId).n ?? 0) + 1).padStart(6, '0')}`;
    const id = Number(db.prepare("INSERT INTO tst_integration_runs (company_id, run_no, status, requested_by, created_by, source_type) VALUES (?, ?, 'QUEUED', ?, ?, 'run')").run(companyId, no, by, by).lastInsertRowid);
    if (jobs) jobs.enqueue(CHECK_JOB, { runId: id }, { createdBy: by, companyId }); else execute(id);
    return id;
  }
  const runs = {
    start(actor) {
      guard(actor, 'tst.integration.run');
      const id = queue(actor.companyId, actor.user);
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_integration_runs', entityId: id, action: 'run', actor: actor.user });
      return runView(db.prepare('SELECT * FROM tst_integration_runs WHERE id = ?').get(id));
    },
    list(actor) {
      guard(actor, 'tst.integration.view');
      return db.prepare('SELECT * FROM tst_integration_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30').all(actor.companyId).map((r) => runView(r));
    },
    get(actor, id) {
      guard(actor, 'tst.integration.view');
      const r = db.prepare('SELECT * FROM tst_integration_runs WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
      if (!r) throw notFound('That run does not exist.');
      return runView(r, true);
    },
    latest(actor) {
      guard(actor, 'tst.integration.view');
      const r = db.prepare("SELECT * FROM tst_integration_runs WHERE company_id = ? AND status = 'DONE' ORDER BY id DESC LIMIT 1").get(actor.companyId);
      return r ? runView(r, true) : null;
    },
  };

  /** The page: the latest run (or a live computation when none exists yet), filtered, with the run history and the probes. */
  function overview(actor, q = {}) {
    guard(actor, 'tst.integration.view');
    const run = q.run ? runs.get(actor, q.run) : runs.latest(actor);
    /** @type {any} */
    const data = run?.threads ? { ...run, status: run.result } : { ...compute(actor.companyId), id: null, runNo: null, live: true };
    const rows = data.matrix.filter((r) => (!q.status || r.status === q.status) && (!q.module || r.producer === q.module || r.consumerModule === q.module) && (!q.q || `${r.event} ${r.consumer}`.includes(q.q)));
    const page = Math.max(1, q.page ?? 1); const size = Math.min(200, q.pageSize ?? 50);
    const byModule = new Map(); for (const r of data.matrix) { const m = byModule.get(r.producer) ?? { module: r.producer, pass: 0, fail: 0, other: 0 }; if (r.status === 'PASS') m.pass += 1; else if (r.status === 'FAIL') m.fail += 1; else m.other += 1; byModule.set(r.producer, m); }
    return { run: { id: data.id ?? null, runNo: data.runNo ?? null, status: data.status, live: Boolean(data.live), computedAt: data.computedAt, requestedBy: data.requestedBy ?? null },
      totals: data.totals, threads: data.threads, rekeying: data.rekeying, dangling: data.dangling, latency: latencySummary(actor.companyId), testsAvailable: data.testsAvailable,
      matrix: { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size },
      byModule: [...byModule.values()].sort((a, b) => b.pass + b.fail + b.other - (a.pass + a.fail + a.other)).slice(0, 20),
      history: runs.list(actor).filter((r) => r.status === 'DONE').slice(0, 12).reverse(), probes: probes.list(actor),
      modules: [...new Set(data.matrix.flatMap((r) => [r.producer, r.consumerModule]))].sort(),
      can: { run: hasPermissionAnywhere(actor, 'tst.integration.run'), export: hasPermissionAnywhere(actor, 'tst.integration.export') } };
  }
  function exportMatrix(actor, q, format) {
    guard(actor, 'tst.integration.export');
    const o = overview(actor, { ...q, page: 1, pageSize: 200 });
    /** @type {any} */
    const all = (q.run ? runs.get(actor, q.run) : runs.latest(actor)) ?? compute(actor.companyId);
    const rows = all.matrix.filter((r) => (!q.status || r.status === q.status) && (!q.module || r.producer === q.module || r.consumerModule === q.module))
      .map((r) => ({ producer: r.producer, event: r.event, consumer: r.consumer, tests: r.testIds.join(' '), published: r.published, processed: r.processed, pending: r.pending, dead: r.dead, latency: r.latencyP95Ms ?? '', status: r.status }));
    const columns = [['producer', 'Producer'], ['event', 'Event'], ['consumer', 'Consumer'], ['tests', 'Test IDs'], ['published', 'Published'], ['processed', 'Processed'], ['pending', 'Pending'], ['dead', 'Dead letters'], ['latency', 'Latency p95 (ms)'], ['status', 'Status']].map(([key, label]) => ({ key, label }));
    const t = o.totals;
    const buffer = writeExport(format, { columns, rows, title: 'Integration matrix', sheetName: 'Matrix', footer: [`Run ${o.run.runNo ?? 'live'}: ${o.run.status} · threads ${t.threadsPassed}/${t.threads} passed · edges ${t.edgesPassed} passed, ${t.edgesFailed} failing · re-keyed fields ${t.rekeyed} · probe p95 ${t.probeP95Ms ?? '—'} ms (target ${t.targetMs} ms)`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'tst.integration_matrix', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `integration-matrix.${format}` };
  }

  if (jobs) {
    jobs.register(CHECK_JOB, (ctx) => {
      const runId = Number(ctx.params?.runId);
      if (runId) { const out = execute(runId); return { status: out?.status ?? 'SKIPPED' }; }
      // the nightly schedule: one run for each company where the part is on
      let n = 0;
      for (const c of db.prepare('SELECT id FROM org_companies').all()) if (context.flags.isOn({ companyId: c.id }, INTEGRATION_FLAG)) { try { queue(c.id, 'system'); n += 1; } catch { /* one is running */ } }
      return { queued: n };
    }, { maxAttempts: 2, description: 'Integration check (part 30.01): threads, hand-offs, re-keying, the event matrix and latency.' });
    scheduler?.define({ code: CHECK_JOB, cron: '50 20 * * *', jobType: CHECK_JOB, description: 'Nightly integration check at 02:20 IST (part 30.01).' });
  }
  bus?.subscribe?.(PROBE_EVENT, (event) => probes.handle(event), { consumer: PROBE_CONSUMER, maxAttempts: 3 });

  return { verifyThreads, checkHandoff, matrix, compute, execute, runs, probes, overview, exportMatrix, latencySummary };
}
