import { Router } from 'express';
import { z } from 'zod';
import { idempotency } from '../../platform/http/idempotency.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { parse } from '../../platform/validation/index.js';
import { createFlagService } from '../core/api.js';
import { createAiGateway } from './gateway.js';
import './features.js';

// Module M28 (ai): the AI gateway and its governance (part 28.01). Every AI feature of the ERP calls aiOf(db).run(); the routes here configure
// the providers, the features and their enablement, the kill switch, and show the usage, cost and log.
const id = (v) => parse(z.coerce.number().int().positive(), v);
const actorKey = ({ companyId, userId, user }) => JSON.stringify([companyId, userId ?? null, user]);

export const ai = {
  code: 'ai', name: 'AI', routePrefix: '/api/v1/ai', ownerPart: '28.01',
  status: 'AI gateway: providers through the integration hub, features with enablement approval, quotas, kill switch, redacted log.',
  tables: ['ai_providers', 'ai_features', 'ai_logs', 'ai_controls'], companyOptional: [], resources: ['features', 'providers', 'controls', 'run', 'usage', 'logs'],
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
    api.use('/ai', r);
  },
};
