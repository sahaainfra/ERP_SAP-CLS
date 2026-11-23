import { Router } from 'express';
import { z } from 'zod';
import { idempotency } from '../../platform/http/idempotency.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { parse } from '../../platform/validation/index.js';
import { createFlagService } from '../core/api.js';
import { createIntegrationService } from './integration.js';
import { CHECKS, createReconService } from './recon.js';
import { CHECKLIST, createPageAuditService } from './pageaudit.js';

// Module M30 (tst): system integration, quality assurance and go-live. The module code `qa` belongs to site quality (M18), so the go-live
// testing parts use `tst` (the table prefix of the pack, tst_page_audit). Part 30.01 mounts the integration matrix and the latency probe,
// 30.02 the reconciliation suite, 30.03 the page completion audit, each behind its own flag (ff.qa.p3001 … p3003).
const id = (v) => parse(z.coerce.number().int().positive(), v);
const actorKey = ({ companyId, userId, user }) => JSON.stringify([companyId, userId ?? null, user]);
const reason = z.string().trim().min(5).max(500);
const page = { page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(200).default(25) };

const services = new WeakMap();
/** The services of this module for a database (the integration tests and the matrix document use them without HTTP). */
export const tstOf = (db) => services.get(db) ?? null;

export const tst = {
  code: 'tst', name: 'System Integration, Quality Assurance & Go-Live', routePrefix: '/api/v1/tst', ownerPart: '30.01',
  status: 'Integration matrix and real-time latency (30.01), reconciliation suite and trace completeness (30.02), page completion audit (30.03).',
  tables: ['tst_integration_runs', 'tst_latency_probes', 'tst_recon_runs', 'tst_recon_results', 'tst_page_audit', 'tst_page_audit_runs'], resources: ['integration', 'reconciliation', 'page-audits'],
  mount(api, { db, config }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tst_integration_runs'").get()) return;
    const context = { db, environment: config.environment ?? 'development', flags: createFlagService({ db, environment: config.environment }) };
    const runtime = runtimeOf(db);
    const integration = createIntegrationService(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler, bus: runtime?.bus });
    const recon = createReconService(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler });
    const audit = createPageAuditService(context);
    services.set(db, { integration, recon, audit });
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

    api.use('/tst', r);
  },
};
