import { writeAudit } from '../audit/index.js';
import { eventTypes, publishEvent } from '../events/index.js';
import { log } from '../http/logger.js';
import { currentCorrelationId, pseudonym } from '../observability/context.js';
import { metrics as defaultMetrics } from '../observability/metrics.js';
import { redact, redactText } from '../observability/redact.js';
import { tracer as defaultTracer } from '../observability/tracing.js';
import { createBreaker, createRateLimiter } from './breaker.js';
import { ProviderError } from './providers.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
/** @type {[string, string, any][]} */
const HUB_EVENTS = [
  ['core.connector.changed', 'A connector was created, changed or switched off.', obj({ code: str, action: str }, ['code'])],
  ['core.connector.health_changed', 'A connector became healthy or failed, or its circuit breaker opened or closed.', obj({ code: str, state: str }, ['code', 'state'])],
  ['core.webhook.received', 'A verified webhook arrived from an outside service; the owning module consumes it.', obj({ connector: str, type: str, deliveryId: str, payload: {} }, ['connector', 'deliveryId'])],
];
for (const [type, description, schema] of HUB_EVENTS) eventTypes.define({ type, version: 1, schema, owner: 'core', description });

/** A failed call to an outside service. `code` is stable for callers to branch on. */
export class IntegrationError extends Error {
  constructor(code, message, { retryable = false, httpStatus = null, retryAfterMs = null, logId = null, details = [] } = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
    this.logId = logId;
    this.details = details;
  }
}

const BODY_KEY = /^(body|text|html|content|message|description)$/i;
/** Message text and document content do not belong in a log; keys that carry them are replaced before the generic redaction runs. */
const omitBodies = (v, depth = 0) => {
  if (Array.isArray(v)) return depth > 5 ? [] : v.slice(0, 20).map((x) => omitBodies(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, BODY_KEY.test(k) && x ? '[content omitted]' : omitBodies(x, depth + 1)]));
  return v;
};
const clip = (s, n = 4000) => (s.length > n ? `${s.slice(0, n)}...` : s);
const scrub = (s, secrets) => secrets.reduce((out, v) => (v && v.length >= 4 ? out.split(v).join('[secret]') : out), s);

/** Redacted text for the integration log: known fields masked, bodies omitted, long text cut, and the connector's own secret values removed wherever they appear (BR-01). */
export function logText(value, secretValues = []) {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? redactText(value) : redactText(JSON.stringify(redact(omitBodies(value))));
  return clip(scrub(text, secretValues));
}

async function withTimeout(fn, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderError(`The provider did not answer within ${ms} ms.`, { retryable: true, timeout: true }));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The integration service (FR-03, FR-04, FR-05, FR-07). `call` is the one way modules reach an outside service:
 * integrations.call('mail.main', 'send', { to, subject, text }, { companyId, actor, idempotencyKey }).
 * It checks the connector, applies the rate limit and the circuit breaker, reads the credentials (audited), calls the
 * provider with a timeout, retries retryable failures with back-off, and writes one redacted log row.
 */
export function createIntegrations({ db, secrets, providers, fetchImpl = (/** @type {any} */ url, /** @type {any} */ init) => globalThis.fetch(url, init), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), metrics = defaultMetrics, tracer = defaultTracer }) {
  const breakers = new Map();
  const limiter = createRateLimiter({ now });

  const connectorOf = (companyId, code) => db.prepare('SELECT * FROM core_connectors WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL').get(companyId, code);

  const breakerFor = (c) => {
    const resetMs = c.breaker_reset_seconds * 1000;
    let b = breakers.get(c.id);
    if (!b || b.config.threshold !== c.breaker_threshold || b.config.resetMs !== resetMs) {
      b = createBreaker({ threshold: c.breaker_threshold, resetMs, now });
      breakers.set(c.id, b);
    }
    return b;
  };

  const writeLog = (c, entry) => {
    const res = db.prepare(
      `INSERT INTO core_integration_logs (company_id, connector_id, direction, operation, endpoint, status, http_status, duration_ms, attempts, request_redacted, response_redacted, error, correlation_id, user_ref)
       VALUES (:company, :connector, :direction, :operation, :endpoint, :status, :http, :duration, :attempts, :request, :response, :error, :cid, :user)`,
    ).run({
      company: c.company_id, connector: c.id, direction: entry.direction ?? 'outbound', operation: entry.operation, endpoint: entry.endpoint ?? null, status: entry.status, http: entry.httpStatus ?? null,
      duration: Math.round(entry.durationMs ?? 0), attempts: entry.attempts ?? 1, request: entry.request ?? null, response: entry.response ?? null, error: entry.error ?? null,
      cid: entry.correlationId ?? currentCorrelationId(), user: entry.user ?? null,
    });
    metrics.counter(`integration.${entry.status}`);
    return Number(res.lastInsertRowid);
  };

  const announce = (c, state, message) => {
    try {
      publishEvent(db, { type: 'core.connector.health_changed', entity: 'connector', entityId: c.id, actorId: 'integration-hub', companyId: c.company_id, data: { code: c.code, state, message } });
    } catch (err) {
      log.warn({ msg: 'could not publish connector health event', code: c.code, error: err.message });
    }
  };

  const contextFor = (c, signal, extra) => ({ connector: c, config: JSON.parse(c.config_json), fetch: fetchImpl, signal, ...extra });

  const hub = {
    breakers,
    limiter,

    breakerState: (connectorId) => breakers.get(connectorId)?.snapshot() ?? { state: 'closed', failures: 0, openedAt: null, retryAfterMs: 0 },
    rateUsage: (connectorId) => limiter.used(connectorId),

    async call(code, operation, payload, opts = {}) {
      const { companyId, actor = null, idempotencyKey = null, correlationId = currentCorrelationId(), timeoutMs = null } = opts;
      const c = companyId == null ? null : connectorOf(companyId, code);
      if (!c) throw new IntegrationError('CONNECTOR_NOT_FOUND', `There is no connector "${code}" for this company.`);
      const user = actor ? pseudonym(actor.user) : null;
      const base = { operation, correlationId, user, request: logText(payload) };
      const refuse = (status, errCode, message, extra = {}) => {
        const logId = writeLog(c, { ...base, status, error: message });
        return new IntegrationError(errCode, message, { logId, ...extra });
      };
      if (c.status === 'PENDING') throw refuse('rejected', 'CONNECTOR_NOT_APPROVED', `Connector "${code}" is waiting for approval.`);
      if (c.status !== 'ENABLED') throw refuse('rejected', 'CONNECTOR_DISABLED', `Connector "${code}" is switched off.`);
      const provider = providers.get(c.type, c.provider);
      const op = provider?.operations[operation];
      if (!provider || !op) throw refuse('rejected', 'UNKNOWN_OPERATION', `Connector "${code}" (${c.type}/${c.provider}) does not offer "${operation}".`);
      const problems = op.validate?.(payload) ?? [];
      if (problems.length) throw refuse('rejected', 'INVALID_PAYLOAD', `The request is not valid: ${problems.map((p) => p.message).join(' ')}`, { details: problems });

      const rate = limiter.take(c.id, c.rate_limit_per_minute);
      if (!rate.ok) throw refuse('rate_limited', 'RATE_LIMITED', `Connector "${code}" is limited to ${c.rate_limit_per_minute} calls a minute. Try again shortly.`, { retryable: true, retryAfterMs: rate.retryAfterMs });
      const breaker = breakerFor(c);
      if (!breaker.allow()) {
        const snap = breaker.snapshot();
        throw refuse('circuit_open', 'CIRCUIT_OPEN', `Connector "${code}" is paused after repeated failures; it will be tried again in ${Math.ceil(snap.retryAfterMs / 1000)} seconds.`, { retryable: true, retryAfterMs: snap.retryAfterMs });
      }

      const wanted = [...provider.secrets.map((s) => s.name), 'webhook_secret'];
      const { values, expired } = secrets.read(c, wanted, { purpose: `${operation}`, actor: actor?.user ?? 'system', correlationId });
      const secretValues = Object.values(values);
      const missing = provider.secrets.filter((s) => s.required && !values[s.name]).map((s) => s.name);
      if (missing.length || expired.length) {
        breaker.success(); // a set-up problem is not the provider's fault; hand back the probe slot
        const msg = expired.length ? `The credential ${expired.join(', ')} has expired. Rotate it.` : `The credential ${missing.join(', ')} is not set.`;
        throw refuse('rejected', 'SECRET_MISSING', msg);
      }

      const timeout = timeoutMs ?? c.timeout_ms;
      const started = now();
      let attempts = 0;
      let lastError = null;
      let result = null;
      await tracer.withSpan(`integration ${code}.${operation}`, { kind: 'client', attributes: { 'integration.connector': code, 'integration.operation': operation } }, async () => {
        while (attempts <= c.max_retries) {
          attempts += 1;
          try {
            result = await withTimeout((signal) => op.run(contextFor(c, signal, { secrets: values, idempotencyKey, correlationId }), payload), timeout);
            lastError = null;
            return;
          } catch (err) {
            lastError = err instanceof ProviderError ? err : new ProviderError(`Unexpected failure in the provider: ${err?.message ?? err}`, { retryable: false });
            if (!lastError.retryable || attempts > c.max_retries) return;
            await sleep(c.retry_backoff_ms * 2 ** (attempts - 1));
          }
        }
      });
      const durationMs = now() - started;
      const entryBase = { ...base, durationMs, attempts, request: logText(payload, secretValues), endpoint: JSON.parse(c.config_json).baseUrl ?? null };

      if (!lastError) {
        const closed = breaker.success();
        const logId = writeLog(c, { ...entryBase, status: 'success', httpStatus: result?.httpStatus, response: logText(result?.data, secretValues) });
        db.prepare('UPDATE core_connectors SET last_used_at = ? WHERE id = ?').run(new Date(now()).toISOString(), c.id);
        if (closed) announce(c, 'circuit_closed', 'A call succeeded; the circuit closed.');
        return { ok: true, data: result?.data ?? null, httpStatus: result?.httpStatus ?? null, attempts, durationMs, logId };
      }

      // A refusal by the provider for a bad request (4xx other than 408/429) is the caller's mistake, not a sign the provider is down.
      const countsAgainstProvider = lastError.retryable || lastError.timeout;
      const opened = countsAgainstProvider ? breaker.failure() : breaker.success();
      const message = scrub(redactText(lastError.message), secretValues);
      const logId = writeLog(c, { ...entryBase, status: lastError.timeout ? 'timeout' : 'failure', httpStatus: lastError.httpStatus, response: logText(lastError.response, secretValues), error: message });
      if (opened === 'open') {
        log.warn({ msg: 'connector circuit opened', connector: code, failures: c.breaker_threshold });
        announce(c, 'circuit_open', `Circuit opened after ${c.breaker_threshold} failures.`);
      }
      throw new IntegrationError(lastError.timeout ? 'TIMEOUT' : 'PROVIDER_ERROR', message, { retryable: lastError.retryable, httpStatus: lastError.httpStatus, logId });
    },

    /** Test connection (FR-07): one health request, no retries, never trips the breaker. Records the result on the connector. */
    async testConnection(connectorId, { actor = null, correlationId = currentCorrelationId() } = {}) {
      const c = db.prepare('SELECT * FROM core_connectors WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(connectorId);
      if (!c) throw new IntegrationError('CONNECTOR_NOT_FOUND', 'That connector does not exist.');
      const provider = providers.get(c.type, c.provider);
      const user = actor ? pseudonym(actor.user) : null;
      const started = now();
      let status = 'ok';
      let message;
      let secretValues = [];
      let httpStatus = null;
      try {
        if (!provider) throw new ProviderError(`No provider ${c.type}/${c.provider} is installed.`);
        const { values, expired } = secrets.read(c, [...provider.secrets.map((s) => s.name)], { purpose: 'test connection', actor: actor?.user ?? 'system', correlationId });
        secretValues = Object.values(values);
        const missing = provider.secrets.filter((s) => s.required && !values[s.name]).map((s) => s.name);
        if (missing.length) throw new ProviderError(`The credential ${missing.join(', ')} is not set.`);
        if (expired.length) throw new ProviderError(`The credential ${expired.join(', ')} has expired.`);
        const out = await withTimeout((signal) => provider.health(contextFor(c, signal, { secrets: values, correlationId })), c.timeout_ms);
        message = out?.message ?? 'Reachable.';
      } catch (err) {
        status = 'failed';
        message = scrub(redactText(err?.message ?? String(err)), secretValues);
        httpStatus = err?.httpStatus ?? null;
      }
      const durationMs = now() - started;
      const stamp = new Date(now()).toISOString();
      const changed = c.last_health_status !== status;
      db.prepare('UPDATE core_connectors SET last_health_at = ?, last_health_status = ?, last_health_message = ? WHERE id = ?').run(stamp, status, message.slice(0, 300), c.id);
      const logId = writeLog(c, { operation: 'health', direction: 'test', status: status === 'ok' ? 'success' : 'failure', httpStatus, durationMs, error: status === 'ok' ? null : message, response: status === 'ok' ? message : null, correlationId, user });
      if (changed) announce(c, status === 'ok' ? 'healthy' : 'unhealthy', message);
      writeAudit(db, { entity: 'core_connectors', entityId: c.id, action: 'test_connection', newValues: { code: c.code, status, durationMs }, actor: actor?.user ?? 'system', correlationId });
      return { status, message, durationMs, checkedAt: stamp, logId };
    },

    /** Used by the webhook receiver: write an inbound row. */
    logInbound(c, entry) {
      return writeLog(c, { ...entry, direction: 'inbound' });
    },

    /** Delete log rows older than each connector's retention (FR-05). */
    purgeLogs() {
      let removed = 0;
      for (const c of db.prepare('SELECT id, retention_days FROM core_connectors').all()) {
        removed += db.prepare('DELETE FROM core_integration_logs WHERE connector_id = ? AND created_at < ?').run(c.id, new Date(now() - c.retention_days * 86_400_000).toISOString()).changes;
      }
      return removed;
    },
  };
  return hub;
}
