import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ROOT } from './db.js';
import { authenticate, permissionsOf, requirePermission } from './auth.js';
import { correlationMiddleware, errorHandler, badRequest, forbidden, HttpError } from './errors.js';
import { listFlags, resolveFlag, setFlag } from './flags.js';

const zodDetails = (err) => err.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message }));

function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('Some fields are invalid. Fix them and try again.', zodDetails(r.error));
  return r.data;
}

const idPart = z.coerce.number().int().positive();
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().max(100).default(''),
});
const evaluateQuery = z.object({
  keys: z.string().min(1).max(2000),
  company_id: idPart.optional(),
  project_id: idPart.optional(),
});
const scopeSchema = z.object({
  level: z.enum(['default', 'environment', 'company', 'project']),
  environment: z.enum(['development', 'test', 'staging', 'production']).optional(),
  companyId: idPart.optional(),
  projectId: idPart.optional(),
});
const patchBody = z
  .object({
    scope: scopeSchema,
    enabled: z.boolean(),
    reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
    version: z.number().int().positive().optional(),
  })
  .superRefine((b, ctx) => {
    const s = b.scope;
    const bad = (message, path) => ctx.addIssue({ code: 'custom', message, path: ['scope', path] });
    if (s.level === 'environment' && !s.environment) bad('environment is required for an environment default', 'environment');
    if (s.level === 'company' && !s.companyId) bad('companyId is required for a company override', 'companyId');
    if (s.level === 'project' && (!s.companyId || !s.projectId)) {
      bad('companyId and projectId are required for a project override', 'projectId');
    }
  });

export function createApp({ config, db, log = console.error }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationMiddleware);
  app.use((_req, res, next) => {
    res.set({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
    next();
  });
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', environment: config.environment }));

  const api = express.Router();
  api.use(authenticate(config));

  // Who am I, which permissions do I hold, and the environment: drives UI permission states.
  api.get('/core/session', (req, res) => {
    res.json({
      data: {
        user: req.actor.user,
        roles: req.actor.roles,
        companyId: req.actor.companyId,
        permissions: permissionsOf(req.actor),
        environment: config.environment,
      },
    });
  });

  api.get('/core/feature-flags', requirePermission('core.flag.view'), (req, res) => {
    const q = parse(listQuery, req.query);
    res.json(listFlags(db, { companyId: req.actor.companyId, ...q }));
  });

  api.get('/core/feature-flags/evaluate', (req, res) => {
    const q = parse(evaluateQuery, req.query);
    const companyId = q.company_id ?? req.actor.companyId;
    if (companyId != null && companyId !== req.actor.companyId) {
      throw forbidden('You can only evaluate flags for your own company.');
    }
    const keys = [...new Set(q.keys.split(',').map((k) => k.trim()).filter(Boolean))].slice(0, 100);
    const data = Object.fromEntries(
      keys.map((k) => [
        k,
        resolveFlag(db, k, { environment: config.environment, companyId, projectId: q.project_id ?? null }).enabled,
      ]),
    );
    res.json({ data });
  });

  api.patch('/core/feature-flags/:key', requirePermission('core.flag.configure'), (req, res) => {
    const key = parse(z.string().regex(/^ff\.[a-z0-9_.]+$/), req.params.key);
    const body = parse(patchBody, req.body);
    const s = body.scope;
    if ((s.level === 'company' || s.level === 'project') && s.companyId !== req.actor.companyId) {
      throw forbidden('You can only change overrides for your own company.');
    }
    const saved = setFlag(db, {
      key,
      scope: {
        level: s.level,
        environment: s.level === 'environment' ? s.environment : undefined,
        companyId: s.companyId,
        projectId: s.projectId,
      },
      enabled: body.enabled,
      reason: body.reason,
      version: body.version,
      actor: req.actor.user,
      correlationId: req.correlationId,
    });
    res.json({ data: { id: saved.id, key: saved.key, enabled: saved.enabled === 1, version: saved.version } });
  });

  app.use('/api/v1', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'No such API route.')));

  const dist = join(ROOT, 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use(errorHandler(log));
  return app;
}
