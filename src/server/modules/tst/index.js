import { Router } from 'express';
import { z } from 'zod';
import { idempotency } from '../../platform/http/idempotency.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { parse } from '../../platform/validation/index.js';
import { createFlagService } from '../core/api.js';
import { createIntegrationService } from './integration.js';
import { CHECKS, createReconService } from './recon.js';
import { CHECKLIST, createPageAuditService } from './pageaudit.js';
import { PART, TYPES, createCatalogueService } from './catalogue.js';
import { PACKS, createSandboxService } from './sandbox.js';
import { CONTROLS, SEVERITIES, SOURCES, STATUSES, createSecurityService } from './security.js';
import { SLO_KINDS, createPerfService } from './perf.js';
import { createA11yService } from './a11y.js';
import { ENV_CODES, createOpsService } from './ops.js';
import { KINDS, createManualsService } from './manuals.js';
import { SEVERITIES as UAT_SEVERITIES, createGoLiveService } from './golive.js';

// Module M30 (tst): system integration, quality assurance and go-live. The module code `qa` belongs to site quality (M18), so the go-live
// testing parts use `tst` (the table prefix of the pack, tst_page_audit). Part 30.01 mounts the integration matrix and the latency probe,
// 30.02 the reconciliation suite, 30.03 the page completion audit, 30.04 the test catalogue and the simulation sandbox, each behind its own flag
// (ff.qa.p3001 … p3004).
const id = (v) => parse(z.coerce.number().int().positive(), v);
const actorKey = ({ companyId, userId, user }) => JSON.stringify([companyId, userId ?? null, user]);
const reason = z.string().trim().min(5).max(500);
const page = { page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(200).default(25) };

const services = new WeakMap();
/** The services of this module for a database (the integration tests and the matrix document use them without HTTP). */
export const tstOf = (db) => services.get(db) ?? null;

export const tst = {
  code: 'tst', name: 'System Integration, Quality Assurance & Go-Live', routePrefix: '/api/v1/tst', ownerPart: '30.01',
  status: 'Integration matrix and real-time latency (30.01), reconciliation suite and trace completeness (30.02), page completion audit (30.03), test catalogue, coverage and simulation sandbox (30.04), security findings and remediation (30.05), performance test results (30.06), accessibility and device validation (30.07), operations runbooks and environments (30.08).',
  tables: ['tst_integration_runs', 'tst_latency_probes', 'tst_recon_runs', 'tst_recon_results', 'tst_page_audit', 'tst_page_audit_runs', 'tst_test_catalogue', 'tst_test_runs', 'tst_sandbox_runs', 'sct_findings', 'sct_scan_runs', 'sct_reviews', 'tst_perf_runs', 'tst_perf_results', 'tst_devices', 'tst_a11y_runs', 'tst_a11y_results', 'ops_environments', 'ops_deployments', 'ops_runbooks', 'ops_oncall', 'ops_pages', 'man_captures', 'man_screens', 'man_packages', 'man_manuals', 'golive_checklist', 'uat_scripts', 'uat_defects', 'uat_signoffs', 'golive_cutover_runs', 'golive_cutover_steps', 'golive_decisions', 'golive_hypercare', 'golive_hypercare_days'], resources: ['ops', 'a11y', 'integration', 'reconciliation', 'page-audits', 'tests', 'sandbox', 'security', 'perf'],
  mount(api, { db, config, storagePath, buildInfo }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tst_integration_runs'").get()) return;
    const context = { db, environment: config.environment ?? 'development', flags: createFlagService({ db, environment: config.environment }) };
    const runtime = runtimeOf(db);
    const integration = createIntegrationService(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler, bus: runtime?.bus });
    const recon = createReconService(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler });
    const audit = createPageAuditService(context);
    const catalogue = createCatalogueService(context);
    const sandbox = createSandboxService(context, { config });
    const security = createSecurityService(context);
    const perf = createPerfService(context);
    const a11y = createA11yService(context);
    const ops = createOpsService(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler, bus: runtime?.bus });
    const manuals = createManualsService(context, { storagePath, buildInfo, jobs: runtime?.jobs });
    const golive = createGoLiveService(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler });
    services.set(db, { integration, recon, audit, catalogue, sandbox, security, perf, a11y, ops, manuals, golive });
    const r = Router();
    const ok = (res, data, status = 200) => res.status(status).json({ data });
    const idem = idempotency(db, { required: true, actorKey });
    const send = (res, out) => res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' }).send(out.buffer);
    const format = z.enum(['csv', 'xlsx', 'pdf']).default('xlsx');

    // ---- part 30.01: the integration matrix, threads, re-keying and latency
    const matrixQ = { run: z.coerce.number().int().positive().optional(), status: z.enum(['PASS', 'FAIL', 'PENDING', 'NOT_EXERCISED']).optional(), module: z.string().regex(/^[a-z]{2,10}$/).optional(), q: z.string().trim().min(2).max(80).optional() };
    r.get('/integration', (req, res) => ok(res, integration.overview(req.actor, parse(z.object({ ...matrixQ, ...page, pageSize: z.coerce.number().int().positive().max(200).default(50) }).strict(), req.query))));
    r.get('/integration/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...matrixQ, format }).strict(), req.query); return send(res, integration.exportMatrix(req.actor, q, f)); });
    r.post('/integration/runs', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, integration.runs.start(req.actor), 202); });
    r.get('/integration/runs/:id', (req, res) => ok(res, integration.runs.get(req.actor, id(req.params.id))));
    r.post('/integration/probes', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, integration.probes.send(req.actor), 202); });
    r.get('/integration/probes/:id', (req, res) => ok(res, integration.probes.get(req.actor, id(req.params.id))));

    // ---- part 30.02: the reconciliation suite and trace completeness
    const reconQ = { run: z.coerce.number().int().positive().optional(), check: z.enum(Object.keys(CHECKS)).optional(), status: z.enum(['PASS', 'FAIL', 'INFO', 'SKIPPED', 'ERROR']).optional(), q: z.string().trim().min(2).max(80).optional() };
    r.get('/reconciliation', (req, res) => ok(res, recon.health(req.actor, parse(z.object({ ...reconQ, ...page }).strict(), req.query))));
    r.get('/reconciliation/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...reconQ, format }).strict(), req.query); return send(res, recon.exportResults(req.actor, q, f)); });
    r.post('/reconciliation/runs', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, recon.runs.start(req.actor), 202); });
    r.get('/reconciliation/runs/:id', (req, res) => ok(res, recon.runs.get(req.actor, id(req.params.id))));

    // ---- part 30.03: the page completion audit
    const pagesQ = { module: z.string().regex(/^[a-z]{2,10}$/).optional(), status: z.enum(['PASS', 'FAIL', 'NOT_TESTED']).optional(), q: z.string().trim().min(2).max(80).optional(), nav: z.enum(['1']).optional() };
    const code = (v) => parse(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,120}$/), v);
    const checklistItem = z.object({ code: z.enum(CHECKLIST.map((c) => c.code)), result: z.enum(['PASS', 'FAIL', 'NA']), note: z.string().trim().max(500).optional() }).strict();
    const defect = z.object({ title: z.string().trim().min(5).max(300), severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']), checklist: z.enum(CHECKLIST.map((c) => c.code)).optional() }).strict();
    const crawlResult = z.object({ route: z.string().regex(/^\/[A-Za-z0-9/_:.-]{0,200}$/), state: z.enum(['content', 'empty', 'error', 'denied', 'blank']), consoleErrors: z.array(z.string().max(500)).max(50).default([]), failedRequests: z.array(z.string().max(500)).max(50).default([]), overflowPx: z.number().int().min(0).max(100000).default(0), loadMs: z.number().int().min(0).max(600000).optional(), a11y: z.array(z.string().max(300)).max(50).optional() }).strict();
    r.get('/page-audits', (req, res) => ok(res, audit.pages(req.actor, parse(z.object({ ...pagesQ, ...page }).strict(), req.query))));
    r.get('/page-audits/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...pagesQ, format }).strict(), req.query); return send(res, audit.exportPages(req.actor, q, f)); });
    r.get('/page-audits/pages/:code', (req, res) => ok(res, audit.page(req.actor, code(req.params.code))));
    r.post('/page-audits', idem, (req, res) => ok(res, audit.record(req.actor, parse(z.object({ pageCode: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,120}$/), roleTested: z.string().regex(/^[A-Z][A-Z0-9-]{1,15}$/), checklist: z.array(checklistItem).min(1).max(20), defects: z.array(defect).max(30).default([]), notes: z.string().trim().max(2000).optional() }).strict(), req.body)), 201));
    r.post('/page-audits/:id/evidence', idem, (req, res) => ok(res, audit.addEvidence(req.actor, id(req.params.id), parse(z.object({ fileId: z.number().int().positive() }).strict(), req.body))));
    r.post('/page-audits/:id/defects/:no/fix', idem, (req, res) => ok(res, audit.fixDefect(req.actor, id(req.params.id), id(req.params.no), parse(z.object({ fixRef: z.string().trim().min(5).max(200) }).strict(), req.body))));
    r.post('/page-audits/:id/defects/:no/reschedule', idem, (req, res) => ok(res, audit.requestReschedule(req.actor, id(req.params.id), id(req.params.no), parse(z.object({ targetPart: z.string().regex(/^\d{2}\.\d{2}$/), reason }).strict(), req.body)), 201));
    r.post('/page-audits/reschedules/:id/act', idem, (req, res) => ok(res, audit.decideReschedule(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(), version: z.number().int().positive().optional() }).strict(), req.body))));
    r.post('/page-audits/static-scan', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, audit.staticScan(req.actor), 201); });
    r.post('/page-audits/crawl', idem, (req, res) => ok(res, audit.crawl(req.actor, parse(z.object({ viewport: z.enum(['desktop', 'mobile']), role: z.string().regex(/^[A-Z][A-Z0-9_-]{1,30}$/).optional(), runId: z.number().int().positive().optional(), final: z.boolean().default(true), results: z.array(crawlResult).min(1).max(200) }).strict(), req.body)), 201));

    // ---- part 30.04: the test catalogue, coverage and results; the simulation sandbox
    const testsQ = { part: z.string().regex(PART).optional(), type: z.enum(TYPES).optional(), result: z.enum(['PASS', 'FAIL', 'SKIP', 'NOT_RUN']).optional(), status: z.enum(['ACTIVE', 'RETIRED', 'ALL']).optional(), q: z.string().trim().min(2).max(80).optional() };
    const base = (req) => `http://127.0.0.1:${req.socket.localPort}`;
    r.get('/tests', (req, res) => ok(res, catalogue.coverage(req.actor, parse(z.object({ ...testsQ, gaps: z.enum(['1']).optional(), ...page }).strict(), req.query))));
    r.get('/tests/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...testsQ, format }).strict(), req.query); return send(res, catalogue.exportCatalogue(req.actor, q, f)); });
    r.get('/tests/:testId', (req, res) => ok(res, catalogue.test(req.actor, parse(z.string().regex(/^[\w.-]{1,120}#[0-9a-f]{8}(-\d+)?$/), req.params.testId))));
    r.post('/tests/sync', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, catalogue.sync(req.actor), 201); });
    r.post('/tests/manual', idem, (req, res) => ok(res, catalogue.addManual(req.actor, parse(z.object({ partId: z.string().regex(PART), name: z.string().trim().min(10).max(500), type: z.enum(TYPES), requirementRef: z.string().trim().max(200).optional(), result: z.enum(['PASS', 'FAIL', 'SKIP']).optional() }).strict(), req.body)), 201));
    r.post('/test-runs', idem, (req, res) => ok(res, catalogue.recordRun(req.actor, parse(z.object({ source: z.enum(['CI', 'LOCAL', 'SANDBOX']), suite: z.enum(['UNIT_API', 'E2E', 'VISUAL', 'AUTHZ', 'PERF', 'ALL']), commitRef: z.string().regex(/^[0-9a-f]{7,40}$/).optional(), startedAt: z.string().datetime().optional(), runId: z.number().int().positive().optional(), results: z.array(z.object({ file: z.string().regex(/^(tests|e2e)\/[\w.-]+\.(test|spec)\.js$/), name: z.string().min(1).max(2000), result: z.enum(['PASS', 'FAIL', 'SKIP']), durationMs: z.number().int().min(0).max(36_000_000).optional() }).strict()).min(1).max(1000) }).strict(), req.body)), 201));
    r.get('/sandbox', (req, res) => ok(res, sandbox.status(req.actor)));
    r.post('/sandbox/generate', idem, async (req, res) => ok(res, await sandbox.generate(req.actor, parse(z.object({ months: z.number().int().min(1).max(24).default(12) }).strict(), req.body ?? {}), { base: base(req) }), 201));
    r.post('/sandbox/reset', idem, async (req, res) => { parse(z.object({ confirm: z.literal('RESET') }).strict(), req.body ?? {}); return ok(res, await sandbox.reset(req.actor, { base: base(req) }), 201); });
    r.post('/sandbox/scenarios', idem, async (req, res) => ok(res, await sandbox.runScenario(req.actor, parse(z.object({ pack: z.enum(Object.keys(PACKS)) }).strict(), req.body), { base: base(req) }), 201));

    // ---- part 30.05: security findings and remediation (restricted: never cached)
    const sec = Router();
    sec.use((_req, res, next) => { res.set('cache-control', 'no-store'); next(); });
    const findingsQ = { severity: z.enum(SEVERITIES).optional(), status: z.enum([...STATUSES, 'BLOCKING', 'ACTIVE']).optional(), source: z.enum(SOURCES).optional(), q: z.string().trim().min(2).max(80).optional() };
    const scanFinding = z.object({ severity: z.enum(SEVERITIES), title: z.string().trim().min(5).max(300), description: z.string().trim().max(2000).optional(), endpoint: z.string().trim().max(300).optional(), cwe: z.string().regex(/^CWE-\d{1,5}$|^GHSA-[\w-]{4,40}$|^CVE-\d{4}-\d{3,7}$/).optional(), rule: z.string().regex(/^[A-Za-z0-9_.:-]{1,60}$/).optional(), key: z.string().max(400).optional() }).strict();
    sec.get('/', (req, res) => ok(res, security.overview(req.actor, parse(z.object({ ...findingsQ, ...page }).strict(), req.query))));
    sec.get('/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...findingsQ, format }).strict(), req.query); return send(res, security.exportFindings(req.actor, q, f)); });
    sec.get('/findings/:id', (req, res) => ok(res, security.finding(req.actor, id(req.params.id))));
    sec.post('/findings', idem, (req, res) => ok(res, security.record(req.actor, parse(z.object({ source: z.enum(['PENTEST', 'MOBILE', 'REVIEW']), severity: z.enum(SEVERITIES), title: z.string().trim().min(5).max(300), description: z.string().trim().max(4000).optional(), endpoint: z.string().trim().max(300).optional(), cwe: z.string().regex(/^CWE-\d{1,5}$/).optional() }).strict(), req.body)), 201));
    sec.post('/findings/:id/fix', idem, (req, res) => ok(res, security.fix(req.actor, id(req.params.id), parse(z.object({ fixedIn: z.string().regex(/^[0-9a-f]{7,40}$/), note: z.string().trim().max(1000).optional() }).strict(), req.body))));
    sec.post('/findings/:id/retest', idem, (req, res) => ok(res, security.retest(req.actor, id(req.params.id), parse(z.object({ result: z.enum(['PASS', 'FAIL']), note: z.string().trim().min(5).max(1000) }).strict(), req.body))));
    sec.post('/findings/:id/risk', idem, (req, res) => ok(res, security.requestDecision(req.actor, id(req.params.id), parse(z.object({ decision: z.enum(['ACCEPT', 'FALSE_POSITIVE']), reason, until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(), req.body)), 201));
    sec.post('/risk-requests/:id/act', idem, (req, res) => ok(res, security.decide(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(), version: z.number().int().positive().optional() }).strict(), req.body))));
    sec.post('/scans', idem, async (req, res) => ok(res, await security.runScan(req.actor, parse(z.object({ kind: z.enum(['AUTHZ', 'SAST', 'SECRETS']) }).strict(), req.body)), 201));
    sec.post('/scans/results', idem, (req, res) => ok(res, security.postScan(req.actor, parse(z.object({ kind: z.enum(['DAST', 'DEPENDENCIES']), checked: z.number().int().min(0).max(1_000_000), findings: z.array(scanFinding).max(200) }).strict(), req.body)), 201));
    sec.post('/reviews', idem, (req, res) => ok(res, security.review(req.actor, parse(z.object({ controlCode: z.enum(CONTROLS.map((c) => c.code)), status: z.enum(['PASS', 'GAP', 'NA']), evidence: z.string().trim().min(10).max(2000), severity: z.enum(SEVERITIES).optional() }).strict(), req.body)), 201));
    r.use('/security', sec);

    // ---- part 30.06: performance test results
    const perfQ = { profile: z.enum(['SMOKE', 'LOAD', 'STRESS', 'SOAK']).optional(), result: z.enum(['PASS', 'FAIL']).optional(), run: z.coerce.number().int().positive().optional() };
    const ms = z.number().min(0).max(3_600_000);
    r.get('/perf', (req, res) => ok(res, perf.overview(req.actor, parse(z.object({ ...perfQ, ...page }).strict(), req.query))));
    r.get('/perf/runs/:id', (req, res) => ok(res, perf.run(req.actor, id(req.params.id))));
    r.get('/perf/runs/:id/export', (req, res) => { const { format: f } = parse(z.object({ format }).strict(), req.query); return send(res, perf.exportRun(req.actor, id(req.params.id), f)); });
    r.post('/perf/runs', idem, (req, res) => ok(res, perf.record(req.actor, parse(z.object({
      profile: z.enum(['SMOKE', 'LOAD', 'STRESS', 'SOAK']), tool: z.enum(['NODE', 'K6']), environment: z.string().trim().min(2).max(60), machine: z.string().trim().max(200).optional(),
      startedAt: z.string().datetime(), finishedAt: z.string().datetime(), users: z.number().int().min(0).max(1_000_000).default(0), burstScale: z.number().int().min(1).max(1_000_000).optional(), commitRef: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
      memory: z.object({ startMb: z.number().int().min(0).max(1_000_000).optional(), endMb: z.number().int().min(0).max(1_000_000).optional(), maxMb: z.number().int().min(0).max(1_000_000).optional(), samples: z.array(z.object({ t: z.number().min(0).max(1_000_000), rssMb: z.number().min(0).max(1_000_000) }).strict()).max(2000).default([]) }).strict().optional(),
      results: z.array(z.object({ model: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/), journey: z.string().trim().min(2).max(120), sloKind: z.enum(SLO_KINDS), requests: z.number().int().min(0), errors: z.number().int().min(0), p50: ms, p95: ms, p99: ms, max: ms, throughputRps: z.number().min(0).max(1_000_000), targetRps: z.number().min(0).max(1_000_000).optional() }).strict()).min(1).max(60),
    }).strict(), req.body)), 201));

    // ---- part 30.07: accessibility, responsive and device validation
    const a11yQ = { kind: z.enum(['AXE', 'RESPONSIVE', 'DEVICE', 'SCREEN_READER']).optional(), width: z.coerce.number().int().positive().max(4000).optional(), issue: z.enum(['ACTIVE', 'OPEN', 'FIXED', 'RETESTED', 'NONE', 'ALL']).optional(), q: z.string().trim().min(2).max(80).optional() };
    const violation = z.object({ rule: z.string().regex(/^[a-z0-9-]{2,80}$/), impact: z.enum(['critical', 'serious', 'moderate', 'minor']), help: z.string().max(300).default(''), nodes: z.number().int().min(0).max(100000).default(1), targets: z.array(z.string().max(200)).max(5).default([]) }).strict();
    const step = z.object({ step: z.string().trim().min(2).max(200), result: z.enum(['PASS', 'FAIL', 'SKIP']), ms: z.number().int().min(0).max(600000).optional(), note: z.string().max(500).optional() }).strict();
    const a11yResult = z.object({ route: z.string().regex(/^\/[A-Za-z0-9/_:.-]{0,200}$/).optional(), journey: z.string().trim().min(3).max(120).optional(), result: z.enum(['PASS', 'FAIL']).optional(), violations: z.array(violation).max(60).default([]), overflowPx: z.number().int().min(0).max(100000).default(0), smallTargets: z.number().int().min(0).max(10000).default(0), tinyInputs: z.number().int().min(0).max(10000).default(0), loadMs: z.number().int().min(0).max(600000).optional(), steps: z.array(step).max(40).optional(), notes: z.string().max(1000).optional(), error: z.string().max(500).optional() }).strict();
    const lang = z.enum(['en', 'hi', 'te']).optional(); const net = z.enum(['FAST', 'FAST_3G', 'SLOW_3G', 'OFFLINE']).optional();
    r.get('/a11y', (req, res) => ok(res, a11y.overview(req.actor, parse(z.object({ ...a11yQ, ...page }).strict(), req.query))));
    r.get('/a11y/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...a11yQ, format }).strict(), req.query); return send(res, a11y.exportResults(req.actor, q, f)); });
    r.get('/a11y/results/:id', (req, res) => ok(res, a11y.result(req.actor, id(req.params.id))));
    r.post('/a11y/runs', idem, (req, res) => ok(res, a11y.recordRun(req.actor, parse(z.object({ kind: z.enum(['AXE', 'RESPONSIVE', 'DEVICE', 'SCREEN_READER']), deviceCode: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(), width: z.number().int().positive().max(4000).optional(), height: z.number().int().positive().max(4000).optional(), theme: z.enum(['light', 'dark', 'high-contrast']).optional(), language: lang, network: net, assistiveTech: z.string().trim().max(60).optional(), runId: z.number().int().positive().optional(), final: z.boolean().default(true), results: z.array(a11yResult).min(1).max(200) }).strict(), req.body)), 201));
    r.post('/a11y/manual', idem, (req, res) => ok(res, a11y.recordManual(req.actor, parse(z.object({ kind: z.enum(['DEVICE', 'SCREEN_READER']), deviceCode: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(), assistiveTech: z.enum(['NVDA', 'JAWS', 'VoiceOver', 'TalkBack', 'Narrator']).optional(), language: lang, network: net, journey: z.string().trim().min(3).max(120), route: z.string().regex(/^\/[A-Za-z0-9/_:.-]{0,200}$/).optional(), result: z.enum(['PASS', 'FAIL']), steps: z.array(step).max(40).optional(), notes: z.string().trim().max(1000).optional() }).strict(), req.body)), 201));
    r.post('/a11y/results/:id/fix', idem, (req, res) => ok(res, a11y.fixIssue(req.actor, id(req.params.id), parse(z.object({ fixedIn: z.string().regex(/^[0-9a-f]{7,40}$/) }).strict(), req.body))));
    r.post('/a11y/signoff', idem, (req, res) => ok(res, a11y.requestSignoff(req.actor, parse(z.object({ reason }).strict(), req.body)), 201));
    r.post('/a11y/signoff/:id/act', idem, (req, res) => ok(res, a11y.decideSignoff(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(), version: z.number().int().positive().optional() }).strict(), req.body))));

    // ---- part 30.08: operations — environments, deployments, runbooks, on-call
    const opsQ = { environment: z.enum(ENV_CODES).optional(), kind: z.enum(['DEPLOY', 'ROLLBACK', 'REHEARSAL']).optional(), status: z.enum(['SUCCEEDED', 'FAILED', 'ROLLED_BACK']).optional() };
    const stepIn = z.object({ step: z.string().trim().min(2).max(200), result: z.enum(['PASS', 'FAIL', 'SKIP']), ms: z.number().int().min(0).max(36_000_000).optional(), note: z.string().max(500).optional() }).strict();
    const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
    const rbCode = (v) => parse(z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/), v);
    r.get('/ops', (req, res) => ok(res, ops.overview(req.actor, parse(z.object({ ...opsQ, ...page }).strict(), req.query))));
    r.get('/ops/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...opsQ, format }).strict(), req.query); return send(res, ops.exportDeployments(req.actor, q, f)); });
    r.post('/ops/deployments', idem, (req, res) => ok(res, ops.recordDeployment(req.actor, parse(z.object({ environment: z.enum(ENV_CODES), kind: z.enum(['DEPLOY', 'ROLLBACK', 'REHEARSAL']), method: z.enum(['BLUE_GREEN', 'IN_PLACE']).optional(), buildId: z.string().regex(/^[\w.-]{1,80}$/).optional(), version: z.string().max(60).optional(), commitRef: z.string().regex(/^[0-9a-f]{7,40}$/).optional(), artifactSha256: sha256.optional(), pipelineRun: z.string().regex(/^[\w.:/#-]{3,200}$/).optional(), slot: z.enum(['blue', 'green']).optional(), status: z.enum(['SUCCEEDED', 'FAILED', 'ROLLED_BACK']), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), requests: z.number().int().min(0).optional(), failedRequests: z.number().int().min(0).optional(), steps: z.array(stepIn).max(40).optional(), reason: z.string().max(500).optional() }).strict(), req.body)), 201));
    r.post('/ops/rehearsals', idem, (req, res) => ok(res, ops.recordRehearsal(req.actor, parse(z.object({ environment: z.enum(ENV_CODES), kind: z.literal('ZERO_DOWNTIME'), ok: z.boolean(), requests: z.number().int().min(0), failed: z.number().int().min(0), steps: z.array(z.object({ name: z.string().min(2).max(200), ok: z.boolean(), ms: z.number().int().min(0), detail: z.string().max(300) }).strict()).min(1).max(40) }).strict(), req.body)), 201));
    r.post('/ops/runbooks/sync', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, ops.syncRunbooks(req.actor), 201); });
    r.get('/ops/runbooks/:code', (req, res) => ok(res, ops.runbook(req.actor, rbCode(req.params.code))));
    r.post('/ops/runbooks/:code/submit', idem, (req, res) => ok(res, ops.submitRunbook(req.actor, rbCode(req.params.code), parse(z.object({ reason }).strict(), req.body)), 201));
    r.post('/ops/runbook-requests/:id/act', idem, (req, res) => ok(res, ops.decideRunbook(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(), version: z.number().int().positive().optional() }).strict(), req.body))));
    r.post('/ops/oncall', idem, (req, res) => ok(res, ops.addShift(req.actor, parse(z.object({ username: z.string().trim().min(2).max(80), level: z.enum(['L1', 'L2', 'L3']), fromAt: z.string().datetime(), toAt: z.string().datetime() }).strict(), req.body)), 201));
    r.post('/ops/oncall/:id/cancel', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, ops.cancelShift(req.actor, id(req.params.id))); });
    r.post('/ops/pages/:id/acknowledge', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, ops.acknowledge(req.actor, id(req.params.id))); });

    // ---- part 30.09: the documentation library, the screen captures and their drift, the package and its approval
    const manQ = { kind: z.enum(KINDS).optional(), language: z.enum(['en', 'hi']).optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STALE']).optional(), owner: z.string().regex(/^[A-Z][A-Z0-9-]{1,15}$/).optional(), q: z.string().trim().min(2).max(80).optional(), sort: z.string().regex(/^(title|kind|status|pages|owner|language)(:(asc|desc))?$/).optional() };
    const signature = z.object({ title: z.string().max(300).optional(), tabs: z.array(z.string().max(200)).max(60).optional(), actions: z.array(z.string().max(200)).max(120).optional(), fields: z.array(z.string().max(200)).max(120).optional(), headings: z.array(z.string().max(200)).max(60).optional(), columns: z.array(z.string().max(200)).max(60).optional() }).strict();
    const screen = z.object({ route: z.string().regex(/^\/[A-Za-z0-9/_.-]{0,200}$/), viewport: z.enum(['DESKTOP', 'MOBILE']), role: z.string().regex(/^[A-Z][A-Z0-9-]{1,15}$/).optional(), signature, fileId: z.number().int().positive().optional() }).strict();
    r.get('/manuals', (req, res) => ok(res, manuals.library(req.actor, parse(z.object({ ...manQ, ...page }).strict(), req.query))));
    r.get('/manuals/export', (req, res) => { const { format: f, ...q } = parse(z.object({ ...manQ, format }).strict(), req.query); return send(res, manuals.exportList(req.actor, q, f)); });
    r.get('/manuals/:id/download', (req, res) => send(res, manuals.download(req.actor, id(req.params.id), parse(z.object({ format: z.enum(['pdf', 'docx']).default('pdf') }).strict(), req.query).format)));
    r.post('/manuals/decisions', idem, (req, res) => ok(res, manuals.decide(req.actor, parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(200), action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional() }).strict(), req.body))));
    r.post('/manuals/submissions', idem, (req, res) => ok(res, manuals.submit(req.actor, parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500).optional(), reason }).strict(), req.body)), 201));
    r.post('/manuals/packages', idem, async (req, res, next) => { try { ok(res, await manuals.generate(req.actor, parse(z.object({ captureId: z.number().int().positive().optional(), only: z.array(z.string().regex(/^[a-z]+\.[A-Za-z0-9-]+\.(en|hi)$/)).min(1).max(200).optional() }).strict(), req.body ?? {})), 202); } catch (err) { next(err); } });
    r.get('/manuals/packages/:id', (req, res) => ok(res, manuals.packageStatus(req.actor, id(req.params.id))));
    r.get('/manuals/packages/:id/download', (req, res) => send(res, manuals.downloadPackage(req.actor, id(req.params.id))));
    r.post('/manuals/captures', idem, (req, res) => ok(res, manuals.startCapture(req.actor, parse(z.object({ buildId: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).optional() }).strict(), req.body ?? {})), 201));
    r.get('/manuals/captures/:id', (req, res) => ok(res, manuals.capture(req.actor, id(req.params.id), parse(z.object({ drift: z.enum(['SAME', 'CHANGED', 'NEW']).optional() }).strict(), req.query))));
    r.post('/manuals/captures/:id/screens', (req, res) => ok(res, manuals.addScreens(req.actor, id(req.params.id), parse(z.object({ screens: z.array(screen).min(1).max(40) }).strict(), req.body).screens)));
    r.post('/manuals/captures/:id/compare', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, manuals.compareCapture(req.actor, id(req.params.id))); });
    r.post('/manuals/captures/:id/accept', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, manuals.acceptCapture(req.actor, id(req.params.id))); });

    // ---- part 30.10: UAT, the readiness checklist, the cut-over runbook, the go/no-go decision and hypercare
    const glQ = { module: z.string().regex(/^[a-z]{2,10}$/).optional(), status: z.enum(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED']).optional(), mine: z.enum(['1']).optional() };
    const decideBody = z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(), version: z.number().int().positive().optional() }).strict();
    const aw = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };
    const day = (v) => parse(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), v);
    r.get('/golive', (req, res) => ok(res, golive.overview(req.actor, parse(z.object({ ...glQ, ...page }).strict(), req.query))));
    r.get('/golive/export', (req, res) => { const q = parse(z.object({ kind: z.enum(['checklist', 'uat', 'hypercare']), format }).strict(), req.query); return send(res, golive.exportReport(req.actor, { kind: q.kind }, q.format)); });
    r.post('/golive/evaluate', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, golive.evaluate(req.actor)); });
    r.post('/golive/checklist/:id', idem, (req, res) => ok(res, golive.setItem(req.actor, id(req.params.id), parse(z.object({ status: z.enum(['MET', 'NOT_MET', 'WAIVED', 'OPEN']), evidence: z.array(z.string().trim().min(3).max(300)).max(10).default([]), note: z.string().trim().max(1000).optional(), ownerId: z.string().trim().min(2).max(80).optional(), version: z.number().int().positive().optional() }).strict(), req.body))));
    r.post('/golive/uat/scripts/generate', idem, (req, res) => { parse(z.object({}).strict(), req.body ?? {}); return ok(res, golive.generateScripts(req.actor), 201); });
    r.post('/golive/uat/scripts/:id/run', idem, (req, res) => ok(res, golive.runScript(req.actor, id(req.params.id), parse(z.object({ result: z.enum(['PASS', 'FAIL', 'BLOCKED']), notes: z.string().trim().max(1000).optional(), defect: z.object({ title: z.string().trim().min(5).max(300), description: z.string().trim().max(2000).optional(), severity: z.enum(UAT_SEVERITIES) }).strict().optional(), version: z.number().int().positive().optional() }).strict(), req.body))));
    r.post('/golive/uat/defects', idem, (req, res) => ok(res, golive.raiseDefect(req.actor, parse(z.object({ module: z.string().regex(/^[a-z]{2,10}$/), title: z.string().trim().min(5).max(300), description: z.string().trim().max(2000).optional(), severity: z.enum(UAT_SEVERITIES) }).strict(), req.body)), 201));
    r.post('/golive/uat/defects/:id/triage', idem, (req, res) => ok(res, golive.triage(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['triage', 'fix', 'close', 'defer', 'reopen']), severity: z.enum(UAT_SEVERITIES).optional(), ownerId: z.string().trim().min(2).max(80).optional(), fixedIn: z.string().regex(/^[0-9a-f]{7,40}$/).optional(), reason: z.string().trim().max(500).optional(), version: z.number().int().positive().optional() }).strict(), req.body))));
    r.post('/golive/uat/signoffs', idem, (req, res) => { const b = parse(z.object({ module: z.string().regex(/^[a-z]{2,10}$/), reason }).strict(), req.body); return ok(res, golive.requestSignoff(req.actor, b.module, { reason: b.reason }), 201); });
    r.post('/golive/requests/:id/act', idem, (req, res) => ok(res, golive.decide(req.actor, id(req.params.id), parse(decideBody, req.body))));
    r.post('/golive/cutover/runs', idem, (req, res) => ok(res, golive.planRun(req.actor, parse(z.object({ kind: z.enum(['DRY_RUN', 'PRODUCTION']), windowMinutes: z.number().int().min(30).max(4320).optional(), plannedStart: z.string().datetime().optional() }).strict(), req.body)), 201));
    r.post('/golive/cutover/runs/:id/start', idem, aw(async (req, res) => { parse(z.object({}).strict(), req.body ?? {}); ok(res, await golive.startRun(req.actor, id(req.params.id))); }));
    r.post('/golive/cutover/runs/:id/rollback', idem, (req, res) => ok(res, golive.rollBack(req.actor, id(req.params.id), parse(z.object({ reason }).strict(), req.body))));
    r.post('/golive/cutover/steps/:id/complete', idem, aw(async (req, res) => ok(res, await golive.completeStep(req.actor, id(req.params.id), parse(z.object({ result: z.enum(['DONE', 'FAILED']), detail: z.string().trim().min(5).max(500) }).strict(), req.body)))));
    r.post('/golive/decisions', idem, (req, res) => ok(res, golive.submitDecision(req.actor, parse(z.object({ meetingAt: z.string().datetime(), attendees: z.array(z.string().trim().min(2).max(120)).min(2).max(40), recommendation: z.enum(['GO', 'NO_GO']), goLiveAt: z.string().datetime().optional(), minutes: z.string().trim().min(20).max(4000) }).strict(), req.body)), 201));
    r.post('/golive/hypercare', idem, (req, res) => ok(res, golive.startHypercare(req.actor, parse(z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), warRoom: z.array(z.string().regex(/^[A-Z][A-Z0-9-]{1,15}$/)).max(20).optional() }).strict(), req.body ?? {})), 201));
    r.post('/golive/hypercare/days/:date/publish', idem, (req, res) => ok(res, golive.publishDay(req.actor, day(req.params.date), parse(z.object({ triageNotes: z.string().trim().min(10).max(4000) }).strict(), req.body))));
    r.post('/golive/hypercare/handover', idem, (req, res) => ok(res, golive.requestHandover(req.actor, parse(z.object({ notes: z.string().trim().min(20).max(4000) }).strict(), req.body)), 201));

    api.use('/tst', r);
  },
};
