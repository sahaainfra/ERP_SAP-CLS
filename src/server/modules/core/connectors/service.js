import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope, findScoped } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { HttpError, badRequest, conflict, notFound, unauthorized, unprocessable } from '../../../platform/http/errors.js';
import { CFO_TYPES, CONNECTOR_TYPES, IntegrationError, TYPE_INTERFACES } from '../../../platform/integrations/index.js';
import { deliveryIdOf, verifyWebhook } from '../../../platform/integrations/webhooks.js';
import { logText } from '../../../platform/integrations/hub.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';

const SECRETISH = /(secret|password|passwd|token|api[_-]?key|authorization|credential|private[_-]?key)/i;
const DEFAULTS = { timeoutMs: 10_000, maxRetries: 2, retryBackoffMs: 500, rateLimitPerMinute: 60, breakerThreshold: 5, breakerResetSeconds: 60, retentionDays: 90 };
const COLUMN = { name: 'name', provider: 'provider', environment: 'environment', timeoutMs: 'timeout_ms', maxRetries: 'max_retries', retryBackoffMs: 'retry_backoff_ms', rateLimitPerMinute: 'rate_limit_per_minute', breakerThreshold: 'breaker_threshold', breakerResetSeconds: 'breaker_reset_seconds', retentionDays: 'retention_days' };
const WEBHOOK_SECRET = 'webhook_secret';

const present = (c) => ({
  id: c.id,
  code: c.code,
  name: c.name,
  type: c.type,
  provider: c.provider,
  environment: c.environment,
  status: c.status,
  config: JSON.parse(c.config_json),
  timeoutMs: c.timeout_ms,
  maxRetries: c.max_retries,
  retryBackoffMs: c.retry_backoff_ms,
  rateLimitPerMinute: c.rate_limit_per_minute,
  breakerThreshold: c.breaker_threshold,
  breakerResetSeconds: c.breaker_reset_seconds,
  retentionDays: c.retention_days,
  health: { status: c.last_health_status, checkedAt: c.last_health_at, message: c.last_health_message },
  lastUsedAt: c.last_used_at,
  version: c.version,
  createdBy: c.created_by,
  createdAt: c.created_at,
});

/** Problems with a connector's settings for its provider; empty when fine. Credentials never go in the settings. */
export function configProblems(providers, type, providerName, config, environment) {
  const provider = providers.get(type, providerName);
  if (!provider) return [`There is no provider "${providerName}" for ${type} connectors.`];
  const problems = [];
  const known = new Set(provider.configFields.map((f) => f.name));
  for (const key of Object.keys(config)) {
    if (SECRETISH.test(key)) problems.push(`"${key}" looks like a credential. Credentials go in the secrets, not the settings.`);
    else if (!known.has(key)) problems.push(`"${key}" is not a setting of ${provider.label}.`);
  }
  for (const f of provider.configFields) if (f.required && !String(config[f.name] ?? '').trim()) problems.push(`${f.label} is required.`);
  return [...problems, ...(provider.validateConfig?.(config, environment) ?? [])];
}

const chainFor = (type) => (CFO_TYPES.has(type) ? ['SYSADM', 'CFO'] : ['SYSADM']);

/** The approved creation or change of a connector, including promotion of its staged credentials, is applied in the approver's transaction (BR-02). */
export function createConnectorChangeHandler({ providers, secrets }) {
  return {
    apply(db, request, actor) {
      const { connectorId, changes = {}, secretKeys = [] } = request.payload;
      const c = db.prepare('SELECT * FROM core_connectors WHERE id = ? AND company_id = ? AND is_active = 1 AND deleted_at IS NULL').get(connectorId, request.companyId);
      if (!c) throw unprocessable('The connector no longer exists.');
      const nextProvider = changes.provider ?? c.provider;
      const nextEnv = changes.environment ?? c.environment;
      const nextConfig = changes.config ?? JSON.parse(c.config_json);
      const problems = configProblems(providers, c.type, nextProvider, nextConfig, nextEnv);
      if (problems.length) throw unprocessable(`The requested settings are no longer valid: ${problems.join(' ')}`);
      secrets.promote(c, secretKeys, actor);
      let status = c.status === 'PENDING' ? 'DISABLED' : c.status;
      if (changes.enabled !== undefined) status = changes.enabled ? 'ENABLED' : 'DISABLED';
      if (status === 'ENABLED') {
        const missing = providers.get(c.type, nextProvider).secrets.filter((s) => s.required && !secrets.has(c.id, s.name)).map((s) => s.name);
        if (missing.length) throw unprocessable(`The connector cannot be switched on: the credential ${missing.join(', ')} is not set.`);
      }
      const next = { name: changes.name ?? c.name, provider: nextProvider, environment: nextEnv, config_json: JSON.stringify(nextConfig), status };
      for (const [k, col] of Object.entries(COLUMN)) if (!(col in next) && changes[k] !== undefined) next[col] = changes[k];
      const cols = Object.keys(next);
      db.prepare(`UPDATE core_connectors SET ${cols.map((k) => `${k} = :${k}`).join(', ')}, updated_by = :actor, updated_at = :now, version = version + 1 WHERE id = :id`)
        .run({ ...next, actor: actor.user, now: new Date().toISOString(), id: c.id });
      writeAudit(db, {
        entity: 'core_connectors', entityId: c.id, action: c.status === 'PENDING' ? 'create_approved' : 'change_approved',
        oldValues: { ...present(c), health: undefined }, newValues: { ...next, credentialsChanged: secretKeys }, reason: request.reason, actor: actor.user,
      });
      publishEvent(db, { type: 'core.connector.changed', entity: 'connector', entityId: c.id, actorId: actor.user, companyId: request.companyId, data: { code: c.code, action: c.status === 'PENDING' ? 'created' : 'changed', status } });
    },
  };
}

const toHttp = (err) => {
  if (!(err instanceof IntegrationError)) return err;
  if (err.code === 'RATE_LIMITED') return new HttpError(429, 'RATE_LIMITED', err.message);
  if (['CIRCUIT_OPEN', 'TIMEOUT', 'PROVIDER_ERROR'].includes(err.code)) return new HttpError(503, 'SERVICE_UNAVAILABLE', err.message);
  if (err.code === 'CONNECTOR_NOT_FOUND') return notFound(err.message);
  return unprocessable(err.message, err.details);
};

/** Connectors, their credentials, the call log and the inbound webhook receiver. */
export function createConnectorService({ db, integrations, approvals, isFlagOn }) {
  const { hub, secrets, providers } = integrations;
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const view = (actor) => {
    assertPermission(actor, 'core.connectors.view');
    return companyOf(actor);
  };
  const configure = (actor) => {
    assertPermission(actor, 'core.connectors.configure');
    return companyOf(actor);
  };
  const load = (actor, id) => {
    const c = findScoped(db, 'core_connectors', actor, id);
    if (!c) throw notFound('That connector does not exist.');
    return c;
  };
  const providerOf = (type, name) => {
    const p = providers.get(type, name);
    if (!p) throw unprocessable(`There is no provider "${name}" for ${type} connectors.`);
    return p;
  };
  const withBreaker = (c) => ({ ...present(c), breaker: c.status === 'ENABLED' ? hub.breakerState(c.id) : null, callsLastMinute: hub.rateUsage(c.id) });
  const stageSecrets = (actor, c, values, expiry = {}) => {
    for (const [key, value] of Object.entries(values)) secrets.stage(actor, c, key, value, { expiresAt: expiry[key] ? `${expiry[key]}T23:59:59.000Z` : null });
  };
  const checkSecretNames = (provider, names) => {
    const allowed = new Set([...provider.secrets.map((s) => s.name), WEBHOOK_SECRET]);
    const bad = names.filter((n) => !allowed.has(n));
    if (bad.length) throw badRequest('Some credentials are not used by this provider.', bad.map((n) => ({ field: `secrets.${n}`, message: `${provider.label} takes: ${[...allowed].join(', ')}.` })));
  };

  return {
    /** What can be configured: types, their providers, settings and credentials. */
    catalog(actor) {
      view(actor);
      return CONNECTOR_TYPES.map((type) => ({
        type, label: TYPE_INTERFACES[type].label, description: TYPE_INTERFACES[type].description, operations: TYPE_INTERFACES[type].operations, needsCfo: CFO_TYPES.has(type),
        providers: providers.forType(type).map((p) => ({ provider: p.provider, label: p.label, description: p.description, configFields: p.configFields, secrets: [...p.secrets, { name: WEBHOOK_SECRET, label: 'Webhook signing secret (optional)', required: false }], canSample: Boolean(p.sample) })),
      }));
    },

    list(actor, query) {
      const company = view(actor);
      const params = { c: company, q: likePattern(query.q), type: query.filters.type ?? null, status: query.filters.status ?? null, env: query.filters.environment ?? null };
      const where = "company_id = :c AND is_active = 1 AND deleted_at IS NULL AND (code LIKE :q ESCAPE '\\' OR name LIKE :q ESCAPE '\\' OR provider LIKE :q ESCAPE '\\') AND (:type IS NULL OR type = :type) AND (:status IS NULL OR status = :status) AND (:env IS NULL OR environment = :env)";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_connectors WHERE ${where}`).get(params).n;
      const order = orderBySql(query.sort, { code: 'code', type: 'type', status: 'status', last_health_at: 'last_health_at', name: 'name' }, 'id');
      const rows = db.prepare(`SELECT * FROM core_connectors WHERE ${where} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map(withBreaker), total, query);
    },

    get(actor, id) {
      view(actor);
      const c = load(actor, id);
      const provider = providers.get(c.type, c.provider);
      return {
        ...withBreaker(c),
        secrets: secrets.describe(c.id).filter((s) => s.status === 'ACTIVE'),
        pendingSecrets: secrets.describe(c.id).filter((s) => s.status === 'PENDING').map((s) => s.key),
        openRequest: approvals.hasOpen(c.company_id, 'connector_change', 'connector', c.id),
        providerInfo: provider ? { label: provider.label, configFields: provider.configFields, secrets: [...provider.secrets, { name: WEBHOOK_SECRET, label: 'Webhook signing secret (optional)', required: false }], canSample: Boolean(provider.sample) } : null,
        webhook: { path: `/api/v1/core/webhooks/${c.code}`, signedWith: 'HMAC-SHA256 over "<x-timestamp>.<body>" in x-signature; optional x-delivery-id', ready: secrets.has(c.id, WEBHOOK_SECRET) },
        needsCfo: CFO_TYPES.has(c.type),
      };
    },

    /** Credentials: names, state and dates, never values (BR-01). */
    secrets(actor, id) {
      view(actor);
      return secrets.describe(load(actor, id).id);
    },

    /** Ask for a new connector. It exists, switched off and unusable, until the request is approved. */
    requestCreate(actor, body) {
      const company = configure(actor);
      const provider = providerOf(body.type, body.provider);
      if (db.prepare('SELECT 1 FROM core_connectors WHERE code = ?').get(body.code)) throw conflict(`A connector with the code "${body.code}" already exists. Codes are unique across the system.`);
      const problems = configProblems(providers, body.type, body.provider, body.config, body.environment);
      if (problems.length) throw badRequest('The settings are not valid.', problems.map((message) => ({ field: 'config', message })));
      checkSecretNames(provider, Object.keys(body.secrets));
      const missing = provider.secrets.filter((s) => s.required && !body.secrets[s.name]).map((s) => s.name);
      if (body.enabled && missing.length) throw unprocessable(`To switch the connector on, also give the credential ${missing.join(', ')}.`);
      const id = transaction(db, () => {
        const res = db.prepare(
          `INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, timeout_ms, max_retries, retry_backoff_ms, rate_limit_per_minute, breaker_threshold, breaker_reset_seconds, retention_days, created_by, source_type)
           VALUES (:c, :code, :name, :type, :provider, :env, :config, 'PENDING', :timeout, :retries, :backoff, :rate, :threshold, :reset, :retention, :actor, 'connector')`,
        ).run({
          c: company, code: body.code, name: body.name, type: body.type, provider: body.provider, env: body.environment, config: JSON.stringify(body.config),
          timeout: body.timeoutMs ?? DEFAULTS.timeoutMs, retries: body.maxRetries ?? DEFAULTS.maxRetries, backoff: body.retryBackoffMs ?? DEFAULTS.retryBackoffMs, rate: body.rateLimitPerMinute ?? DEFAULTS.rateLimitPerMinute,
          threshold: body.breakerThreshold ?? DEFAULTS.breakerThreshold, reset: body.breakerResetSeconds ?? DEFAULTS.breakerResetSeconds, retention: body.retentionDays ?? DEFAULTS.retentionDays, actor: actor.user,
        });
        const cid = Number(res.lastInsertRowid);
        writeAudit(db, { entity: 'core_connectors', entityId: cid, action: 'create_requested', newValues: { code: body.code, type: body.type, provider: body.provider, environment: body.environment }, reason: body.reason, actor: actor.user });
        return cid;
      });
      const c = db.prepare('SELECT * FROM core_connectors WHERE id = ?').get(id);
      stageSecrets(actor, c, body.secrets, body.secretExpiry);
      const request = approvals.submit(actor, {
        type: 'connector_change', title: `Create connector ${body.code} (${body.type}/${body.provider})`, targetType: 'connector', targetId: id,
        payload: { connectorId: id, code: body.code, changes: { enabled: body.enabled }, secretKeys: Object.keys(body.secrets), needsCfo: CFO_TYPES.has(body.type) }, reason: body.reason, chain: chainFor(body.type),
      });
      return { connector: withBreaker(c), request };
    },

    /** Ask to change settings, limits or credentials, or to switch the connector on. Nothing changes until approved. */
    requestChange(actor, id, body) {
      const company = configure(actor);
      const c = load(actor, id);
      const changes = body.changes;
      const secretNames = Object.keys(body.secrets);
      const provider = providerOf(c.type, changes.provider ?? c.provider);
      if (changes.provider === undefined && !providers.get(c.type, c.provider)) throw unprocessable('This connector uses a provider that is no longer installed.');
      checkSecretNames(provider, secretNames);
      const current = present(c);
      const changed = Object.fromEntries(Object.entries(changes).filter(([k, v]) => JSON.stringify(k === 'enabled' ? c.status === 'ENABLED' : current[k]) !== JSON.stringify(v)));
      if (Object.keys(changed).length === 0 && secretNames.length === 0) throw unprocessable('Nothing would change: the requested values are the current ones.');
      const problems = configProblems(providers, c.type, changed.provider ?? c.provider, changed.config ?? current.config, changed.environment ?? c.environment);
      if (problems.length) throw badRequest('The settings are not valid.', problems.map((message) => ({ field: 'config', message })));
      const enabling = changed.enabled === true || (c.status === 'ENABLED' && changed.enabled !== false);
      if (enabling) {
        const missing = provider.secrets.filter((s) => s.required && !secrets.has(c.id, s.name) && !secretNames.includes(s.name)).map((s) => s.name);
        if (missing.length) throw unprocessable(`The connector cannot be on without the credential ${missing.join(', ')}. Add it to this request.`);
      }
      if (approvals.hasOpen(company, 'connector_change', 'connector', c.id)) throw conflict('There is already an open change request for this connector. Decide or withdraw it first.');
      stageSecrets(actor, c, body.secrets, body.secretExpiry);
      return approvals.submit(actor, {
        type: 'connector_change', title: `${secretNames.length ? 'Credential or settings change' : 'Change'} for connector ${c.code}`, targetType: 'connector', targetId: c.id,
        payload: { connectorId: c.id, code: c.code, changes: changed, from: Object.fromEntries(Object.keys(changed).map((k) => [k, k === 'enabled' ? c.status === 'ENABLED' : current[k]])), secretKeys: secretNames, needsCfo: CFO_TYPES.has(c.type) },
        reason: body.reason, chain: chainFor(c.type),
      });
    },

    /** Switching a connector off is immediate (a safety control); switching it on again needs approval. */
    disable(actor, id, { reason }, correlationId) {
      configure(actor);
      const c = load(actor, id);
      if (c.status !== 'ENABLED') throw unprocessable('That connector is not switched on.');
      transaction(db, () => {
        db.prepare("UPDATE core_connectors SET status = 'DISABLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, new Date().toISOString(), c.id);
        writeAudit(db, { entity: 'core_connectors', entityId: c.id, action: 'disabled', oldValues: { status: 'ENABLED' }, newValues: { status: 'DISABLED' }, reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.connector.changed', entity: 'connector', entityId: c.id, actorId: actor.user, companyId: c.company_id, data: { code: c.code, action: 'disabled', status: 'DISABLED' } });
      });
      return withBreaker(load(actor, id));
    },

    async test(actor, id, correlationId) {
      configure(actor);
      const c = load(actor, id);
      if (c.status === 'PENDING') throw conflict('This connector is waiting for approval. Test it once the request is approved.');
      const out = await hub.testConnection(c.id, { actor, correlationId });
      return { ...out, connector: withBreaker(load(actor, id)) };
    },

    /** Send the provider's sample message through the abstraction, to prove the connector end to end. */
    async sample(actor, id, correlationId) {
      configure(actor);
      const c = load(actor, id);
      const provider = providers.get(c.type, c.provider);
      if (!provider?.sample) throw unprocessable(`${provider?.label ?? c.provider} has no sample operation.`);
      try {
        const out = await hub.call(c.code, provider.sample.operation, provider.sample.payload(actor), { companyId: c.company_id, actor, correlationId });
        return { operation: provider.sample.operation, result: out.data, attempts: out.attempts, durationMs: out.durationMs, logId: out.logId };
      } catch (err) {
        throw toHttp(err);
      }
    },

    logs(actor, query) {
      const company = view(actor);
      const params = { c: company, q: likePattern(query.q), connector: query.filters.connector ?? null, status: query.filters.status ?? null, direction: query.filters.direction ?? null, from: query.from ? `${query.from}T00:00:00.000Z` : null, to: query.to ? `${query.to}T23:59:59.999Z` : null };
      const where = "l.company_id = :c AND (:connector IS NULL OR k.code = :connector) AND (:status IS NULL OR l.status = :status) AND (:direction IS NULL OR l.direction = :direction) AND (:from IS NULL OR l.created_at >= :from) AND (:to IS NULL OR l.created_at <= :to) AND (l.operation LIKE :q ESCAPE '\\' OR l.correlation_id LIKE :q ESCAPE '\\' OR COALESCE(l.error, '') LIKE :q ESCAPE '\\' OR k.code LIKE :q ESCAPE '\\')";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_integration_logs l JOIN core_connectors k ON k.id = l.connector_id WHERE ${where}`).get(params).n;
      const order = orderBySql(query.sort, { created_at: 'l.created_at', duration_ms: 'l.duration_ms', status: 'l.status' }, 'l.id DESC');
      const rows = db.prepare(`SELECT l.*, k.code AS connector_code, k.name AS connector_name FROM core_integration_logs l JOIN core_connectors k ON k.id = l.connector_id WHERE ${where} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((r) => presentLog(r, false)), total, query);
    },

    log(actor, id) {
      const company = view(actor);
      const r = db.prepare('SELECT l.*, k.code AS connector_code, k.name AS connector_name FROM core_integration_logs l JOIN core_connectors k ON k.id = l.connector_id WHERE l.id = ? AND l.company_id = ?').get(id, company);
      if (!r) throw notFound('That log entry does not exist.');
      return presentLog(r, true);
    },

    /** An inbound webhook (FR-06). Public: its proof of origin is the signature. Unknown, off or unconfigured connectors all answer 404. */
    receiveWebhook(code, { rawBody, body, headers }) {
      const c = db.prepare('SELECT * FROM core_connectors WHERE code = ? AND is_active = 1 AND deleted_at IS NULL').get(code);
      if (!c || c.status !== 'ENABLED' || !isFlagOn({ companyId: c.company_id, roles: [] }, 'ff.core.p0108')) throw notFound('There is no such webhook.');
      const started = Date.now();
      const rate = hub.limiter.take(`webhook:${c.id}`, c.rate_limit_per_minute);
      if (!rate.ok) {
        hub.logInbound(c, { operation: 'webhook', status: 'rate_limited', error: 'Too many deliveries in a minute.' });
        throw new HttpError(429, 'RATE_LIMITED', 'Too many webhook deliveries. Retry with back-off.');
      }
      const { values } = secrets.read(c, [WEBHOOK_SECRET], { purpose: 'webhook verification', actor: 'webhook' });
      const secret = values[WEBHOOK_SECRET];
      if (!secret) throw notFound('There is no such webhook.');
      if (!rawBody) throw badRequest('Send the webhook as a JSON body.');
      const signature = headers['x-signature'];
      const timestamp = headers['x-timestamp'];
      const verdict = verifyWebhook({ secret, rawBody, signature, timestamp });
      const base = { operation: 'webhook', durationMs: Date.now() - started };
      if (verdict.ok === false) {
        hub.logInbound(c, { ...base, status: 'rejected', error: `Signature check failed: ${verdict.reason}.`, request: logText(body, [secret]) });
        throw unauthorized('The webhook signature is not valid.');
      }
      const deliveryId = deliveryIdOf(headers['x-delivery-id'], signature, timestamp);
      try {
        transaction(db, () => {
          db.prepare('INSERT INTO core_webhook_receipts (connector_id, delivery_id) VALUES (?, ?)').run(c.id, deliveryId);
          publishEvent(db, { type: 'core.webhook.received', entity: 'connector', entityId: c.id, actorId: `webhook:${c.code}`, companyId: c.company_id, data: { connector: c.code, type: c.type, deliveryId, payload: body ?? {} } });
        });
      } catch (err) {
        if (/UNIQUE/i.test(String(err.message))) {
          hub.logInbound(c, { ...base, status: 'duplicate', error: `Delivery ${deliveryId} was already processed.`, request: logText(body, [secret]) });
          return { received: true, duplicate: true, deliveryId };
        }
        throw err;
      }
      hub.logInbound(c, { ...base, status: 'success', request: logText(body, [secret]), response: `accepted delivery ${deliveryId}` });
      return { received: true, duplicate: false, deliveryId };
    },
  };
}

const presentLog = (r, detail) => ({
  id: r.id,
  connector: r.connector_code,
  connectorName: r.connector_name,
  direction: r.direction,
  operation: r.operation,
  endpoint: r.endpoint,
  status: r.status,
  httpStatus: r.http_status,
  durationMs: r.duration_ms,
  attempts: r.attempts,
  error: r.error,
  correlationId: r.correlation_id,
  user: r.user_ref,
  createdAt: r.created_at,
  ...(detail ? { request: r.request_redacted, response: r.response_redacted } : {}),
});
