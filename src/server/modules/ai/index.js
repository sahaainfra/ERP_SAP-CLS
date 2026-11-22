import { Router } from 'express';
import { z } from 'zod';
import { idempotency } from '../../platform/http/idempotency.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { parse } from '../../platform/validation/index.js';
import { createFlagService } from '../core/api.js';
import { createAiGateway } from './gateway.js';
import './features.js';
import { createAssistant } from './assistant.js';
import { createVision } from './vision.js';
import { createDocIntel, DI_STATUSES, DI_TYPES } from './docintel.js';
import { ANOMALY_KINDS, createForecasting, METHODS, USE_CASES } from './forecast.js';

// Module M28 (ai): the AI gateway and its governance (part 28.01). Every AI feature of the ERP calls aiOf(db).run(); the routes here configure
// the providers, the features and their enablement, the kill switch, and show the usage, cost and log.
const id = (v) => parse(z.coerce.number().int().positive(), v);
const actorKey = ({ companyId, userId, user }) => JSON.stringify([companyId, userId ?? null, user]);

export const ai = {
  code: 'ai', name: 'AI', routePrefix: '/api/v1/ai', ownerPart: '28.01',
  status: 'AI gateway: providers through the integration hub, features with enablement approval, quotas, kill switch, redacted log.',
  tables: ['ai_providers', 'ai_features', 'ai_logs', 'ai_controls', 'ai_drafts', 'ai_feedback', 'aif_models', 'aif_forecasts', 'aif_anomalies', 'di_extractions', 'cv_results'], companyOptional: [], resources: ['features', 'providers', 'controls', 'run', 'usage', 'logs', 'assistant', 'copilots', 'drafts', 'feedback', 'forecasts', 'models', 'anomalies', 'documents', 'vision'],
  mount(api, { db, config }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_features'").get()) return;
    const context = { db, flags: createFlagService({ db, environment: config.environment }) };
    const runtime = runtimeOf(db);
    const svc = createAiGateway(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler });
    const r = Router();
    const ok = (res, data, status = 200) => res.status(status).json({ data });
    const idem = idempotency(db, { required: true, actorKey });
    const send = (res, out) => res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' }).send(out.buffer);
    const roles = z.array(z.string().regex(/^[A-Z][A-Z0-9-]{1,19}$/)).max(50);
    const quota = z.object({ perUserDaily: z.number().int().min(0).max(100000), monthlyBudget: z.number().min(0).max(1e9), alertPct: z.number().int().min(1).max(100) }).strict();
    const featureBody = z.object({ code: z.string().regex(/^ai\.[a-z_]+$/), description: z.string().trim().max(500).optional(), providerCode: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/), tools: z.array(z.string().max(60)).max(20).optional(),
      roles: roles.optional(), projects: z.union([z.literal('ALL'), z.array(z.number().int().positive()).max(500)]).optional(), quota: quota.optional() }).strict();
    const reason = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
    const logQ = z.object({ feature: z.string().max(60).optional(), outcome: z.enum(['OK', 'BLOCKED', 'ERROR']).optional(), user: z.string().max(80).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), page: z.coerce.number().int().positive().max(10000).optional(), pageSize: z.coerce.number().int().positive().max(100).optional() }).strict();

    r.get('/features', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, svc.features.catalogue(req.actor)); });
    r.post('/features', idem, (req, res) => ok(res, svc.features.create(req.actor, parse(featureBody, req.body)), 201));
    r.get('/features/:id', (req, res) => ok(res, svc.features.get(req.actor, id(req.params.id))));
    r.patch('/features/:id', (req, res) => ok(res, svc.features.update(req.actor, id(req.params.id), parse(featureBody.omit({ code: true }).partial().extend({ rowVersion: z.number().int().positive() }).strict(), req.body))));
    r.delete('/features/:id', (req, res) => ok(res, svc.features.remove(req.actor, id(req.params.id))));
    r.post('/features/:id/evaluate', idem, async (req, res, next) => { try { ok(res, await svc.features.evaluate(req.actor, id(req.params.id))); } catch (e) { next(e); } });
    r.post('/features/:id/submit', idem, (req, res) => ok(res, svc.features.submit(req.actor, id(req.params.id))));
    r.post('/features/:id/withdraw', idem, (req, res) => ok(res, svc.features.withdraw(req.actor, id(req.params.id), parse(reason, req.body))));
    r.post('/features/:id/cancel', idem, (req, res) => ok(res, svc.features.cancel(req.actor, id(req.params.id), parse(reason, req.body))));
    r.post('/features/:id/disable', idem, (req, res) => ok(res, svc.features.disable(req.actor, id(req.params.id), parse(reason, req.body))));
    r.post('/features/:id/amend', idem, (req, res) => ok(res, svc.features.amend(req.actor, id(req.params.id), parse(reason, req.body)), 201));
    r.get('/features/:id/history', (req, res) => ok(res, svc.features.history(req.actor, id(req.params.id))));
    r.get('/providers', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, svc.providers.list(req.actor)); });
    r.post('/providers', idem, (req, res) => ok(res, svc.providers.create(req.actor, parse(z.object({ code: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/), provider: z.enum(['anthropic', 'openai_compatible', 'sandbox']),
      model: z.string().trim().min(2).max(80), connector: z.string().min(2).max(80), priceInPerMTok: z.number().min(0).max(1e7), priceOutPerMTok: z.number().min(0).max(1e7) }).strict(), req.body)), 201));
    r.patch('/providers/:id', (req, res) => ok(res, svc.providers.update(req.actor, id(req.params.id), parse(z.object({ model: z.string().trim().min(2).max(80).optional(), priceInPerMTok: z.number().min(0).max(1e7).optional(),
      priceOutPerMTok: z.number().min(0).max(1e7).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), rowVersion: z.number().int().positive() }).strict(), req.body))));
    r.get('/controls', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, svc.controls.get(req.actor)); });
    r.post('/controls/kill-switch', idem, (req, res) => ok(res, svc.controls.setKill(req.actor, parse(z.object({ on: z.boolean(), reason: z.string().trim().min(5).max(500) }).strict(), req.body))));
    r.patch('/controls', (req, res) => ok(res, svc.controls.setRetention(req.actor, parse(z.object({ retentionDays: z.number().int().min(7).max(3650) }).strict(), req.body))));
    r.post('/run/:code', async (req, res, next) => {
      try { ok(res, await svc.run(req.actor, parse(z.string().regex(/^ai\.[a-z_]+$/), req.params.code), parse(z.object({ input: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])) }).strict(), req.body).input)); } catch (e) { next(e); }
    });
    r.get('/usage', (req, res) => ok(res, svc.usage(req.actor, parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).strict(), req.query))));
    r.get('/logs', (req, res) => ok(res, svc.logs.list(req.actor, parse(logQ, req.query))));
    r.get('/logs/export', (req, res) => { const { format, ...q } = parse(logQ.extend({ format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }), req.query); return send(res, svc.logs.exportList(req.actor, q, format)); });
    r.get('/logs/:id', (req, res) => ok(res, svc.logs.get(req.actor, id(req.params.id))));
    // ---- part 28.02: the assistant, the role copilots, drafts and feedback (every call through the gateway above)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_drafts'").get()) {
      const asst = createAssistant(context);
      const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
      r.get('/assistant/me', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, asst.me(req.actor)); });
      r.post('/assistant/ask', wrap(async (req, res) => ok(res, await asst.ask(req.actor, parse(z.object({ question: z.string().trim().min(3).max(500), projectId: z.number().int().positive().optional(), route: z.string().max(200).optional() }).strict(), req.body)))));
      r.post('/copilots/:kind', wrap(async (req, res) => ok(res, await asst.copilot(req.actor, parse(z.enum(['pm', 'qs', 'procurement', 'finance']), req.params.kind),
        parse(z.object({ projectId: z.number().int().positive().optional(), vendor: z.string().trim().min(2).max(120).optional() }).strict(), req.body)))));
      r.get('/drafts', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, asst.drafts(req.actor)); });
      r.post('/drafts', wrap(async (req, res) => ok(res, await asst.draft(req.actor, parse(z.object({ kind: z.enum(['RFI', 'LETTER', 'RFQ', 'MOM', 'DPR_NARRATIVE', 'MIS_COMMENTARY']), projectId: z.number().int().positive().optional(), brief: z.string().trim().min(10).max(1500) }).strict(), req.body)), 201)));
      r.post('/drafts/:id/save', idem, (req, res) => ok(res, asst.save(req.actor, id(req.params.id), parse(z.object({ subject: z.string().trim().min(3).max(300), body: z.string().trim().min(10).max(20000).optional(),
        discipline: z.enum(['ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE']).optional(), requiredBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
        party: z.string().trim().min(2).max(160).optional(), letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), category: z.enum(['INSTRUCTION', 'NOTICE', 'APPROVAL', 'QUERY', 'PAYMENT', 'OTHER']).optional(), projectId: z.number().int().positive().optional() }).strict(), req.body)), 201));
      r.post('/drafts/:id/discard', (req, res) => ok(res, asst.discard(req.actor, id(req.params.id))));
      r.post('/feedback', (req, res) => ok(res, asst.feedback(req.actor, parse(z.object({ logId: z.number().int().positive(), rating: z.union([z.literal(1), z.literal(-1)]), comment: z.string().trim().max(500).optional() }).strict(), req.body))));
      r.get('/feedback', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, asst.feedbackSummary(req.actor)); });
    }
    // ---- part 28.03: forecasting, the model registry with back-testing and approval, and anomaly detection
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'aif_models'").get()) {
      const fc = createForecasting(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler });
      const pos = z.coerce.number().int().positive();
      const subject = { itemId: pos.optional(), region: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/).optional(), projectId: pos.optional(), activityId: pos.optional() };
      const useCase = z.enum(Object.keys(USE_CASES));
      const params = z.record(z.string().max(20), z.number()).optional();
      r.get('/forecasts/options', (req, res) => ok(res, fc.options(req.actor, parse(z.object({ projectId: pos.optional() }).strict(), req.query))));
      r.get('/forecasts/latest', (req, res) => ok(res, fc.latest(req.actor, parse(z.object({ projectId: pos.optional() }).strict(), req.query))));
      r.get('/forecasts', (req, res) => ok(res, fc.forecast(req.actor, parse(z.object({ useCase, ...subject, modelId: pos.optional() }).strict(), req.query))));
      r.get('/models', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, fc.models.list(req.actor)); });
      r.post('/models', idem, (req, res) => ok(res, fc.models.create(req.actor, parse(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), name: z.string().trim().min(3).max(120), useCase,
        method: z.enum(Object.keys(METHODS)), params, horizon: z.number().int().min(1).max(24).optional() }).strict(), req.body)), 201));
      r.get('/models/:id', (req, res) => ok(res, fc.models.get(req.actor, id(req.params.id))));
      r.patch('/models/:id', (req, res) => ok(res, fc.models.update(req.actor, id(req.params.id), parse(z.object({ name: z.string().trim().min(3).max(120).optional(), method: z.enum(Object.keys(METHODS)).optional(), params,
        horizon: z.number().int().min(1).max(24).optional(), rowVersion: z.number().int().positive() }).strict(), req.body))));
      r.delete('/models/:id', (req, res) => ok(res, fc.models.remove(req.actor, id(req.params.id))));
      r.post('/models/:id/backtest', idem, (req, res) => ok(res, fc.models.runBacktest(req.actor, id(req.params.id), parse(z.object({ itemId: z.number().int().positive().optional(), region: subject.region,
        projectId: z.number().int().positive().optional(), activityId: z.number().int().positive().optional() }).strict(), req.body))));
      r.get('/models/:id/backtest/export', (req, res) => send(res, fc.models.exportBacktest(req.actor, id(req.params.id), parse(z.object({ format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }).strict(), req.query).format)));
      r.post('/models/:id/submit', idem, (req, res) => ok(res, fc.models.submit(req.actor, id(req.params.id))));
      r.post('/models/:id/withdraw', idem, (req, res) => ok(res, fc.models.withdraw(req.actor, id(req.params.id), parse(reason, req.body))));
      r.post('/models/:id/cancel', idem, (req, res) => ok(res, fc.models.cancel(req.actor, id(req.params.id), parse(reason, req.body))));
      r.post('/models/:id/retire', idem, (req, res) => ok(res, fc.models.retire(req.actor, id(req.params.id), parse(reason, req.body))));
      r.post('/models/:id/amend', idem, (req, res) => ok(res, fc.models.amend(req.actor, id(req.params.id), parse(reason, req.body)), 201));
      r.get('/models/:id/history', (req, res) => ok(res, fc.models.history(req.actor, id(req.params.id))));
      r.get('/anomalies', (req, res) => ok(res, fc.anomalies.list(req.actor, parse(z.object({ status: z.enum(['OPEN', 'CONFIRMED', 'DISMISSED', 'ALL']).default('OPEN'), kind: z.enum(Object.keys(ANOMALY_KINDS)).optional(),
        projectId: pos.optional(), page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
      r.post('/anomalies/run', idem, (req, res) => ok(res, fc.anomalies.run(req.actor)));
      r.post('/anomalies/:id/review', idem, (req, res) => ok(res, fc.anomalies.review(req.actor, id(req.params.id), parse(z.object({ outcome: z.enum(['CONFIRMED', 'DISMISSED']), note: z.string().trim().min(5).max(500) }).strict(), req.body))));
    }
    // ---- part 28.04: document and contract intelligence (extraction on upload, review, apply to the owner modules)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'di_extractions'").get()) {
      const di = createDocIntel(context, { jobs: runtime?.jobs, bus: runtime?.bus });
      const listQ = z.object({ status: z.enum(['OPEN', 'ALL', ...DI_STATUSES]).default('OPEN'), docType: z.enum(Object.keys(DI_TYPES)).optional(), q: z.string().trim().min(2).max(100).optional(),
        page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict();
      const wrapDi = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
      r.get('/documents', (req, res) => ok(res, di.list(req.actor, parse(listQ, req.query))));
      r.get('/documents/export', (req, res) => { const { format, ...q } = parse(listQ.extend({ format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }), req.query); return send(res, di.exportList(req.actor, q, format)); });
      r.get('/documents/accuracy', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, di.accuracy(req.actor)); });
      r.post('/documents/extract', idem, wrapDi(async (req, res) => ok(res, await di.extract(req.actor, parse(z.object({ fileId: z.number().int().positive() }).strict(), req.body).fileId), 201)));
      r.get('/documents/:id', (req, res) => ok(res, di.get(req.actor, id(req.params.id))));
      const val = z.union([z.string().trim().max(300), z.number(), z.null()]);
      r.post('/documents/:id/accept', idem, (req, res) => ok(res, di.accept(req.actor, id(req.params.id), parse(z.object({ values: z.record(z.string().max(40), val).default({}), confirmed: z.array(z.string().max(40)).max(40).default([]),
        target: z.object({ projectId: z.number().int().positive().optional(), poId: z.number().int().positive().optional(), contractId: z.number().int().positive().optional() }).strict().default({}),
        clauses: z.array(z.object({ index: z.number().int().min(0).max(500), clauseNo: z.string().trim().min(1).max(30).optional(), title: z.string().trim().min(2).max(200).optional(), category: z.enum(['NOTICE', 'TIME_BAR', 'VARIATION', 'PAYMENT', 'TERMINATION', 'LD', 'PVC', 'DISPUTE', 'INSURANCE', 'SECURITY', 'OTHER']).optional(),
          summary: z.string().trim().min(5).max(4000).optional(), timeBarDays: z.number().int().min(0).max(3650).nullish(), confirmed: z.boolean().optional() }).strict()).max(200).optional(),
        note: z.string().trim().max(500).optional(), rowVersion: z.number().int().positive() }).strict(), req.body))));
      r.post('/documents/:id/reject', idem, (req, res) => ok(res, di.reject(req.actor, id(req.params.id), parse(z.object({ reason: z.string().trim().min(5).max(500), rowVersion: z.number().int().positive() }).strict(), req.body))));
    }
    // ---- part 28.05: computer vision decision support (analysis of site photographs, review, blurring, model performance)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cv_results'").get()) {
      const cv = createVision(context, { jobs: runtime?.jobs, bus: runtime?.bus });
      const wrapCv = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
      const index = (v) => parse(z.coerce.number().int().min(0).max(49), v);
      const box = z.array(z.number().min(0).max(1)).length(4);
      r.get('/vision', (req, res) => ok(res, cv.list(req.actor, parse(z.object({ status: z.enum(['PENDING', 'REVIEWED', 'NO_FINDINGS', 'FAILED', 'ALL']).default('PENDING'), page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
      r.get('/vision/performance', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, cv.performance(req.actor)); });
      r.post('/vision/run', idem, wrapCv(async (req, res) => ok(res, await cv.run(req.actor, parse(z.object({ fileId: z.number().int().positive() }).strict(), req.body).fileId), 201)));
      r.get('/vision/:id', (req, res) => ok(res, cv.get(req.actor, id(req.params.id))));
      r.post('/vision/:id/labels/:index/confirm', idem, wrapCv(async (req, res) => ok(res, await cv.confirm(req.actor, id(req.params.id), index(req.params.index), parse(z.object({ projectId: z.number().int().positive().optional(), siteId: z.number().int().positive().optional(),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'MINOR', 'MAJOR']).optional(), description: z.string().trim().min(5).max(2000).optional(), actionRequired: z.string().trim().max(1000).optional(), note: z.string().trim().max(500).optional(), rowVersion: z.number().int().positive() }).strict(), req.body)))));
      r.post('/vision/:id/labels/:index/false-positive', idem, (req, res) => ok(res, cv.falsePositive(req.actor, id(req.params.id), index(req.params.index), parse(z.object({ reason: z.string().trim().min(3).max(300), rowVersion: z.number().int().positive() }).strict(), req.body))));
      r.post('/vision/:id/blur', idem, wrapCv(async (req, res) => ok(res, await cv.blur(req.actor, id(req.params.id), parse(z.object({ boxes: z.array(box).min(1).max(20) }).strict(), req.body)))));
    }
    api.use('/ai', r);
  },
};
