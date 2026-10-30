import { randomUUID } from 'node:crypto';
import express from 'express';

export const BODY_LIMIT = '50kb';

/** Accept a well-formed X-Correlation-Id from the caller, otherwise generate one; echo it back. */
export function correlationMiddleware(req, res, next) {
  const incoming = req.get('x-correlation-id');
  req.correlationId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.set('x-correlation-id', req.correlationId);
  next();
}

export function securityHeaders(_req, res, next) {
  res.set({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
  next();
}

/** One log line per finished request: method, path (no query), status, duration, user. */
export function requestLogger(logger) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info({
        msg: 'request',
        correlationId: req.correlationId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        user: req.actor?.user ?? null,
      });
    });
    next();
  };
}

/** The shared request pipeline (FR-02): correlation ID, headers, request log, body limit and JSON parsing. */
export function applyPipeline(app, { logger, bodyLimit = BODY_LIMIT }) {
  app.disable('x-powered-by');
  app.use(correlationMiddleware);
  app.use(securityHeaders);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: bodyLimit }));
}
