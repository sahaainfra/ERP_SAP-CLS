import { randomUUID } from 'node:crypto';
import express from 'express';
import { runWithContext } from '../observability/context.js';
import { pseudonym } from '../observability/context.js';
import { metrics as defaultMetrics } from '../observability/metrics.js';
import { formatTraceparent, parseTraceparent, tracer as defaultTracer } from '../observability/tracing.js';

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

/** The pattern a request matched ("/api/v1/core/files/:id"), never the raw URL, so metrics and logs stay low in cardinality. */
export function routeLabel(req) {
  const pattern = req.route?.path;
  if (typeof pattern !== 'string') return 'unmatched';
  return `${req.baseUrl ?? ''}${pattern === '/' ? '' : pattern}` || '/';
}
const moduleOf = (route) => /^\/api\/v\d+\/([a-z0-9_-]+)/.exec(route)?.[1] ?? (route.startsWith('/health') ? 'health' : 'app');

/**
 * Start the work of a request: its context (correlation ID, for every log line written while it runs, however deep) and the
 * root span of its trace, continuing a W3C `traceparent` from the caller when there is one (FR-03). The trace ID goes back in
 * the `traceparent` and `x-trace-id` headers.
 */
export function observabilityMiddleware({ tracer = defaultTracer } = {}) {
  return (req, res, next) => {
    const parent = parseTraceparent(req.get('traceparent'));
    runWithContext({ correlationId: req.correlationId }, () => {
      const span = tracer.startSpan(`${req.method} ${req.path}`, { kind: 'server', parent, attributes: { 'http.method': req.method, 'correlation.id': req.correlationId } });
      req.span = span;
      res.set({ traceparent: formatTraceparent(span.traceId, span.spanId), 'x-trace-id': span.traceId });
      runWithContext({ span }, next);
    });
  };
}

/** One log line per finished request, and the request counted in the metrics: method, route pattern, status, duration, pseudonymised user. */
export function requestLogger(logger, { metrics = defaultMetrics } = {}) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const route = routeLabel(req);
      metrics.observeRequest({ method: req.method, route, status: res.statusCode, durationMs });
      req.span?.end({ status: res.statusCode >= 500 ? 'error' : 'ok', attributes: { 'http.status_code': res.statusCode, 'http.route': route } });
      if (req.span) req.span.name = `${req.method} ${route}`;
      logger.info({
        msg: 'request',
        correlationId: req.correlationId,
        traceId: req.span?.traceId ?? null,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        route,
        module: moduleOf(route),
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        user: pseudonym(req.actor?.user),
      });
    });
    next();
  };
}

/** The shared request pipeline: correlation ID, trace, headers, request log and metrics, body limit and JSON parsing. */
export function applyPipeline(app, { logger, bodyLimit = BODY_LIMIT, metrics = defaultMetrics, tracer = defaultTracer }) {
  app.disable('x-powered-by');
  app.use(correlationMiddleware);
  app.use(observabilityMiddleware({ tracer }));
  app.use(securityHeaders);
  app.use(requestLogger(logger, { metrics }));
  app.use(express.json({ limit: bodyLimit }));
}
