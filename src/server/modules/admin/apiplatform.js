import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { TEMPLATE_PERMISSIONS, authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, maskPayload, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { signWebhook } from '../../platform/integrations/webhooks.js';

/**
 * Part 29.03 — public API, webhooks and developer portal.
 *
 * A client is a service account: OAuth2 client credentials (`POST /api/public/v1/oauth/token`) give a one-hour bearer token for the
 * scopes it was granted. Each scope maps to permission keys and the subscribable events; the client's role must hold every permission of
 * its scopes, and the token's actor holds only those (optionally for chosen projects only). The public routes are a catalogue of internal
 * routes: the gateway checks the token, version, deprecation, scope and rate tier, then hands the request to the internal API as the
 * service account, so the same permission checks, workflows, idempotency, read-only mode and audit apply (BR-01). A client with a write
 * scope is active only after the director approves it (ITADM → DIR).
 *
 * Webhooks subscribe a client to domain events of its scopes. A consumer on the event bus queues one delivery per event and webhook; a job
 * posts it signed with HMAC-SHA256 over `<timestamp>.<body>` (`x-signature`, `x-timestamp`, `x-delivery-id`), retries with back-off and
 * keeps every attempt; a delivery can be replayed. api_usage counts calls, errors and throttles per day and endpoint.
 */
export const API_FLAG = 'ff.admin.p2903';
export const CLIENT_TYPE = 'api_client_activation';
export const TOKEN_TTL_SECONDS = 3600;
export const ROTATION_GRACE_HOURS = 24;
export const MAX_ATTEMPTS = 6;
const BACKOFF_MIN = [1, 5, 30, 120, 360];

/** FR-05: calls a minute per tier. */
export const TIERS = Object.freeze({ BASIC: 60, STANDARD: 300, PREMIUM: 1200 });

/** FR-02: scopes, the permissions they carry and the events a webhook of the scope may receive. */
export const SCOPES = Object.freeze({
  'masters:read': { label: 'Read item and partner masters', permissions: ['mdm.record.view'], events: ['mdm.*'], write: false },
  'procurement:read': { label: 'Read material requests and purchase orders', permissions: ['proc.material_request.view', 'proc.purchase_order.view'], events: ['proc.*'], write: false },
  'procurement:write': { label: 'Raise material requests', permissions: ['proc.material_request.view', 'proc.material_request.create'], events: [], write: true },
  'site:read': { label: 'Read daily progress reports', permissions: ['site.dpr.view'], events: ['site.*'], write: false },
  'attendance:write': { label: 'Send device punches', permissions: ['att.punch.device'], events: ['att.*'], write: true },
  'plant:read': { label: 'Read machine positions', permissions: ['plant.telematics.view'], events: ['plant.*'], write: false },
  'plant:write': { label: 'Send telematics readings', permissions: ['plant.telematics.ingest'], events: [], write: true },
});

/** FR-01: the public catalogue — a stable subset of internal routes. A deprecated route answers with Deprecation and Sunset headers until its sunset, then 410. */
export const CATALOGUE = Object.freeze([
  { id: 'items.list', version: 'v1', method: 'GET', path: '/items', internal: '/mdm/items', scope: 'masters:read', summary: 'Items of the item master, paged (q, page, pageSize).', since: '2026-11-22' },
  { id: 'material_requests.list', version: 'v1', method: 'GET', path: '/material-requests', internal: '/proc/material-requests', scope: 'procurement:read', summary: 'Material requests of the projects the client may see.', since: '2026-11-22' },
  { id: 'material_requests.create', version: 'v1', method: 'POST', path: '/material-requests', internal: '/proc/material-requests', scope: 'procurement:write', summary: 'Raise a material request; it follows the normal approval workflow. Needs Idempotency-Key.', since: '2026-11-22', bulk: true },
  { id: 'purchase_orders.list', version: 'v1', method: 'GET', path: '/purchase-orders', internal: '/proc/purchase-orders', scope: 'procurement:read', summary: 'Purchase orders with status.', since: '2026-11-22' },
  { id: 'dprs.list', version: 'v1', method: 'GET', path: '/dprs', internal: '/site/dprs', scope: 'site:read', summary: 'Daily progress reports.', since: '2026-11-22' },
  { id: 'dpr.list', version: 'v1', method: 'GET', path: '/dpr', internal: '/site/dprs', scope: 'site:read', summary: 'Old name of dprs.list.', since: '2026-11-22', deprecated: '2026-11-22', sunset: '2027-05-31', replacement: '/v1/dprs' },
  { id: 'punches.create', version: 'v1', method: 'POST', path: '/attendance/punches', internal: '/att/punches/device', scope: 'attendance:write', summary: 'A device punch; the attendance rules apply and a repeated clientUuid is a replay. Needs Idempotency-Key.', since: '2026-11-22', bulk: true },
  { id: 'telematics.positions', version: 'v1', method: 'GET', path: '/telematics/positions', internal: '/plant/telematics/positions', scope: 'plant:read', summary: 'Latest position of each machine.', since: '2026-11-22' },
  { id: 'telematics.ingest', version: 'v1', method: 'POST', path: '/telematics/readings', internal: '/plant/telematics/ingest', scope: 'plant:write', summary: 'Readings (assetCode, timestamp, lat, lng, engineHours, ignition, fuelLevel) in bulk. Needs Idempotency-Key.', since: '2026-11-22', bulk: true },
]);
export const VERSIONS = Object.freeze([{ version: 'v1', status: 'CURRENT', since: '2026-11-22' }]);
export const DEPRECATION_POLICY = 'A version stays available for at least 12 months after its successor; a deprecated route answers with the Deprecation, Sunset and Link headers for at least 6 months, then 410 Gone.';
export const CHANGELOG = Object.freeze([
  { date: '2026-11-22', version: 'v1', changes: ['First public version: items, material requests, purchase orders, daily progress reports, device punches and telematics.', 'Bulk endpoint for write routes (up to 100 calls).', 'Webhooks for master, procurement, site, attendance and plant events, signed with HMAC-SHA256.', '/v1/dpr deprecated in favour of /v1/dprs (sunset 31 May 2027).'] },
]);

const iso = (d = new Date()) => d.toISOString();
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const sameHash = (a, b) => Boolean(a && b) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const patternMatch = (pattern, type) => pattern === type || (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1)));
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd])/i;
const DENIED_ROLES = new Set(['SYSADM', 'ITADM', 'DIR']);

const services = new WeakMap();
export const apiPlatformOf = (db) => services.get(db) ?? null;

/** @param {any} context @param {{ jobs?: any, scheduler?: any, bus?: any }} [deps] */
export function createApiPlatform(context, { jobs, scheduler, bus } = {}) {
  const { db } = context;
  const production = ['staging', 'production'].includes(context.environment);
  const authz = authzOf(db);
  const vault = () => integrationsOf(db).vault;
  const flagOn = (companyId) => context.flags.isOn({ companyId, user: 'api', roles: [] }, API_FLAG);
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, API_FLAG)) throw notFound('The public API is not enabled for this company.');
    if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`);
  };
  const clientRow = (actor, id) => { const c = db.prepare('SELECT * FROM api_clients WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!c) throw notFound('That API client does not exist.'); return c; };

  // ---------------------------------------------------------------- approval: a client with a write scope is active only after DIR approves
  const engine = createApprovalEngine({ db, handlers: { [CLIENT_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const c = db.prepare('SELECT * FROM api_clients WHERE id = ?').get(request.payload.clientRef);
      if (!c || c.status !== 'PENDING_APPROVAL') throw conflict('The client is no longer waiting for approval.');
      db.prepare("UPDATE api_clients SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), actor.user, iso(), c.id);
      writeAudit(db, { companyId: c.company_id, entity: 'api_clients', entityId: String(c.id), action: 'approve', actor: actor.user, newValues: { status: 'ACTIVE' } });
      publishEvent(db, { type: 'admin.api_client.activated', entity: 'api_clients', entityId: c.id, actorId: actor.user, companyId: c.company_id, data: { clientId: c.client_id, scopes: JSON.parse(c.scopes_json) } });
    },
  } } });

  const view = (c, mine = new Set()) => ({
    id: c.id, clientId: c.client_id, name: c.name, ownerPartnerId: c.owner_partner_id, role: c.role_code, scopes: JSON.parse(c.scopes_json), projectIds: c.project_ids_json ? JSON.parse(c.project_ids_json) : null,
    tier: c.tier_code, perMinute: TIERS[c.tier_code], environment: c.environment, status: c.status, secretHint: c.secret_hint, rotatedAt: c.secret_rotated_at, previousSecretUntil: c.prev_secret_expires_at && c.prev_secret_expires_at > iso() ? c.prev_secret_expires_at : null,
    requestId: c.request_id, canApprove: mine.has(c.request_id), approvedBy: c.approved_by, lastUsedAt: c.last_used_at, by: c.created_by, createdAt: c.created_at,
  });
  const newSecret = () => `cs_${randomBytes(32).toString('base64url')}`;

  const clients = {
    list(actor, { status = null } = {}) {
      guard(actor, 'adm.api.view');
      const rows = db.prepare(`SELECT * FROM api_clients WHERE company_id = ? AND deleted_at IS NULL ${status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT 500`).all(...[actor.companyId, ...(status ? [status] : [])]);
      const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      const since = iso(new Date(Date.now() - 30 * 86_400_000)).slice(0, 10);
      const use = db.prepare('SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(errors), 0) AS errors FROM api_usage WHERE client_ref = ? AND day >= ?');
      const hooks = db.prepare("SELECT COUNT(*) AS n FROM api_webhooks WHERE client_ref = ? AND status = 'ACTIVE' AND deleted_at IS NULL");
      return { rows: rows.map((c) => ({ ...view(c, mine), calls30d: use.get(c.id, since).calls, errors30d: use.get(c.id, since).errors, webhooks: hooks.get(c.id).n })),
        canManage: hasPermissionAnywhere(actor, 'adm.api.manage'), scopes: Object.entries(SCOPES).map(([code, s]) => ({ code, label: s.label, write: s.write })), tiers: Object.entries(TIERS).map(([code, perMinute]) => ({ code, perMinute })),
        roles: Object.keys(TEMPLATE_PERMISSIONS).filter((r) => !DENIED_ROLES.has(r) && Object.values(SCOPES).some((s) => s.permissions.every((p) => TEMPLATE_PERMISSIONS[r].includes(p)))).sort() };
    },
    /** FR-02: a service account with scopes; the secret is shown once. Write scopes wait for the director's approval. */
    create(actor, { name, role, scopes, projectIds = null, tier = 'STANDARD', environment = 'SANDBOX', ownerPartnerId = null, reason }) {
      guard(actor, 'adm.api.manage');
      const uniq = [...new Set(scopes)];
      for (const s of uniq) if (!SCOPES[s]) throw unprocessable(`Unknown scope ${s}.`);
      if (DENIED_ROLES.has(role) || !TEMPLATE_PERMISSIONS[role]) throw unprocessable(`A client cannot act as ${role}.`);
      const missing = uniq.flatMap((s) => SCOPES[s].permissions).filter((p) => !TEMPLATE_PERMISSIONS[role].includes(p));
      if (missing.length) throw unprocessable(`The role ${role} does not hold ${[...new Set(missing)].join(', ')}, so it cannot be given those scopes.`);
      const write = uniq.some((s) => SCOPES[s].write);
      if (environment === 'SANDBOX' && write && production) throw unprocessable('A sandbox client in this environment is read-only.');
      if (ownerPartnerId && !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ?').get(ownerPartnerId, actor.companyId)) throw unprocessable('That partner does not exist.');
      if (projectIds?.length) { const n = db.prepare(`SELECT COUNT(*) AS n FROM org_projects WHERE company_id = ? AND id IN (${projectIds.map(() => '?').join(',')})`).get(actor.companyId, ...projectIds).n; if (n !== new Set(projectIds).size) throw unprocessable('A project does not exist in this company.'); }
      const clientId = `cli_${randomBytes(10).toString('hex')}`; const secret = newSecret();
      return transaction(db, () => {
        const username = `svc-${clientId.slice(4)}`;
        const userId = Number(db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(actor.companyId, username, `API client ${name}`, JSON.stringify([role])).lastInsertRowid);
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'iam_user_profiles'").get()) db.prepare("INSERT INTO iam_user_profiles (company_id, user_id, user_type, created_by, source_type) VALUES (?, ?, 'SERVICE_ACCOUNT', ?, 'api_client')").run(actor.companyId, userId, actor.user);
        const id = Number(db.prepare(`INSERT INTO api_clients (company_id, client_id, name, owner_partner_id, service_user_id, role_code, scopes_json, project_ids_json, tier_code, environment, status, secret_hash, secret_hint, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api_client')`).run(actor.companyId, clientId, name, ownerPartnerId, userId, role, JSON.stringify(uniq), projectIds?.length ? JSON.stringify([...new Set(projectIds)]) : null, tier, environment, write ? 'PENDING_APPROVAL' : 'ACTIVE', sha(secret), secret.slice(-4), actor.user).lastInsertRowid);
        let requestId = null;
        if (write) {
          requestId = engine.submit(actor, { type: CLIENT_TYPE, title: `API client ${name} with write scopes (${uniq.filter((s) => SCOPES[s].write).join(', ')})`, targetType: 'api_clients', targetId: String(id), payload: { clientRef: id, clientId, scopes: uniq, role }, reason, chain: ['DIR'] }).id;
          db.prepare('UPDATE api_clients SET request_id = ? WHERE id = ?').run(requestId, id);
        }
        writeAudit(db, { companyId: actor.companyId, entity: 'api_clients', entityId: String(id), action: 'create', actor: actor.user, newValues: { clientId, name, role, scopes: uniq, tier, environment, reason } });
        publishEvent(db, { type: 'admin.api_client.created', entity: 'api_clients', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { clientId, scopes: uniq, pending: write } });
        return { ...view(db.prepare('SELECT * FROM api_clients WHERE id = ?').get(id)), clientSecret: secret, requestId };
      });
    },
    decide(actor, requestId, body) {
      guard(actor, 'adm.api.view'); const r = engine.get(actor, requestId); if (r.type !== CLIENT_TYPE) throw notFound('That request does not exist.');
      const out = engine.act(actor, requestId, body);
      if (out.status === 'REJECTED') db.prepare("UPDATE api_clients SET status = 'REJECTED', updated_by = ?, updated_at = ? WHERE request_id = ? AND status = 'PENDING_APPROVAL'").run(actor.user, iso(), requestId);
      return out;
    },
    /** FR-02 key rotation: a new secret now; the old one keeps working for 24 hours so callers can switch. */
    rotate(actor, id, { reason }) {
      guard(actor, 'adm.api.manage');
      const c = clientRow(actor, id); if (['REVOKED', 'REJECTED'].includes(c.status)) throw unprocessable('A revoked or rejected client cannot be rotated.');
      const secret = newSecret(); const until = iso(new Date(Date.now() + ROTATION_GRACE_HOURS * 3_600_000));
      db.prepare('UPDATE api_clients SET prev_secret_hash = secret_hash, prev_secret_expires_at = ?, secret_hash = ?, secret_hint = ?, secret_rotated_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(until, sha(secret), secret.slice(-4), iso(), actor.user, iso(), c.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'api_clients', entityId: String(c.id), action: 'rotate_secret', actor: actor.user, newValues: { previousValidUntil: until, reason } });
      return { ...view(db.prepare('SELECT * FROM api_clients WHERE id = ?').get(c.id)), clientSecret: secret };
    },
    revoke(actor, id, { reason }) {
      guard(actor, 'adm.api.manage');
      const c = clientRow(actor, id); if (c.status === 'REVOKED') throw conflict('The client is already revoked.');
      return transaction(db, () => {
        db.prepare("UPDATE api_clients SET status = 'REVOKED', prev_secret_hash = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), c.id);
        db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE client_ref = ? AND revoked_at IS NULL').run(iso(), c.id);
        db.prepare("UPDATE api_webhooks SET status = 'DISABLED', updated_by = ?, updated_at = ? WHERE client_ref = ?").run(actor.user, iso(), c.id);
        writeAudit(db, { companyId: actor.companyId, entity: 'api_clients', entityId: String(c.id), action: 'revoke', actor: actor.user, oldValues: { status: c.status }, newValues: { status: 'REVOKED', reason } });
        publishEvent(db, { type: 'admin.api_client.revoked', entity: 'api_clients', entityId: c.id, actorId: actor.user, companyId: c.company_id, data: { clientId: c.client_id } });
        return view(db.prepare('SELECT * FROM api_clients WHERE id = ?').get(c.id));
      });
    },
  };

  // ---------------------------------------------------------------- OAuth2 client credentials
  /** @returns {{ access_token: string, token_type: 'Bearer', expires_in: number, scope: string }} */
  function issueToken({ clientId, clientSecret, scope }) {
    const oauth = (status, error, description) => Object.assign(new HttpError(status, 'OAUTH', description), { oauth: { error, error_description: description } });
    const c = clientId ? db.prepare('SELECT * FROM api_clients WHERE client_id = ? AND deleted_at IS NULL').get(String(clientId)) : null;
    const h = sha(clientSecret ?? '');
    const ok = c && (sameHash(h, c.secret_hash) || (c.prev_secret_hash && c.prev_secret_expires_at > iso() && sameHash(h, c.prev_secret_hash)));
    if (!ok) throw oauth(401, 'invalid_client', 'The client id or secret is wrong.');
    if (!flagOn(c.company_id)) throw oauth(401, 'invalid_client', 'The public API is not enabled for this company.');
    if (c.status !== 'ACTIVE') throw oauth(401, 'invalid_client', c.status === 'PENDING_APPROVAL' ? 'The client is waiting for approval.' : `The client is ${c.status.toLowerCase()}.`);
    const granted = JSON.parse(c.scopes_json);
    const asked = scope ? String(scope).split(/[\s,]+/).filter(Boolean) : granted;
    const extra = asked.filter((s) => !granted.includes(s)); if (extra.length) throw oauth(400, 'invalid_scope', `The client is not granted ${extra.join(', ')}.`);
    const token = `at_${randomBytes(32).toString('base64url')}`;
    db.prepare("INSERT INTO api_tokens (company_id, client_ref, token_hash, scopes_json, expires_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'oauth')").run(c.company_id, c.id, sha(token), JSON.stringify(asked), iso(new Date(Date.now() + TOKEN_TTL_SECONDS * 1000)), c.client_id);
    db.prepare('UPDATE api_clients SET last_used_at = ? WHERE id = ?').run(iso(), c.id);
    return { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, scope: asked.join(' ') };
  }

  /** The service account's actor: its role's grants narrowed to the token's scopes (and to the client's projects, when it has them). */
  function actorOf(c, scopes) {
    const user = db.prepare('SELECT username FROM iam_users WHERE id = ?').get(c.service_user_id);
    const actor = { user: user?.username ?? `svc-${c.client_id}`, userId: c.service_user_id, roles: [c.role_code], companyId: c.company_id, apiClient: c.client_id };
    authz.enrich(actor);
    const keep = new Set(scopes.flatMap((s) => SCOPES[s]?.permissions ?? []));
    const projects = c.project_ids_json ? JSON.parse(c.project_ids_json) : null;
    const g = actor.grants; const grants = new Map();
    for (const [k, v] of g.grants) {
      if (!keep.has(k)) continue;
      grants.set(k, projects ? { ...v, allow: { company: false, projects: new Set(projects), sites: new Set(), branches: new Set(), departments: new Set(), own: false } } : v);
    }
    actor.grants = { ...g, grants, perms: projects ? [] : g.perms.filter((k) => keep.has(k)), anywhere: g.anywhere.filter((k) => keep.has(k)), elevations: [] };
    actor.elevated = [];
    return actor;
  }

  // ---------------------------------------------------------------- the gateway
  const windows = new Map();
  function throttle(c) {
    const minute = Math.floor(Date.now() / 60_000); const key = c.id; const w = windows.get(key);
    const cur = w && w.minute === minute ? w : { minute, n: 0 }; cur.n += 1; windows.set(key, cur);
    const limit = TIERS[c.tier_code]; return { limit, remaining: Math.max(0, limit - cur.n), over: cur.n > limit, retryAfter: 60 - Math.floor((Date.now() / 1000) % 60) };
  }
  const usage = db.prepare(`INSERT INTO api_usage (company_id, client_ref, day, endpoint_id, calls, errors, throttled, total_ms, source_type) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'gateway')
    ON CONFLICT (client_ref, day, endpoint_id) DO UPDATE SET calls = calls + 1, errors = errors + excluded.errors, throttled = throttled + excluded.throttled, total_ms = total_ms + excluded.total_ms`);
  const record = (c, endpointId, started, status) => { try { usage.run(c.company_id, c.id, iso().slice(0, 10), endpointId, status >= 400 && status !== 429 ? 1 : 0, status === 429 ? 1 : 0, Math.round(performance.now() - started)); } catch { /* counting never breaks a call */ } };
  const matchRoute = (method, version, path) => {
    for (const e of CATALOGUE) {
      if (e.version !== version || e.method !== method) continue;
      const names = []; const re = new RegExp(`^${e.path.replace(/:([a-z]+)/gi, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
      const m = re.exec(path); if (m) return { entry: e, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) };
    }
    return null;
  };
  const readForm = (req) => new Promise((resolve) => { let b = ''; req.on('data', (x) => { b += x; }); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b)))); req.on('error', () => resolve({})); });

  /** Express handler for /api/public; `api` is the internal API router the request is handed to. */
  async function handle(req, res, next, api) {
    const m = /^\/(v\d+)(\/.*)?$/.exec(req.path);
    const fail = (status, code, message, headers = {}) => res.status(status).set(headers).json({ error: { code, message, correlationId: req.correlationId ?? null } });
    if (!m) return fail(404, 'NOT_FOUND', `No such public API route. Versions: ${VERSIONS.map((v) => v.version).join(', ')}.`);
    const [, version, path = '/'] = m;
    if (!VERSIONS.some((v) => v.version === version)) return fail(404, 'UNKNOWN_VERSION', `API version ${version} does not exist. Versions: ${VERSIONS.map((v) => v.version).join(', ')}.`);
    try {
      if (path === '/oauth/token') {
        if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
        let body = req.body && Object.keys(req.body).length ? req.body : {};
        if (!Object.keys(body).length && /application\/x-www-form-urlencoded/.test(req.get('content-type') ?? '')) body = await readForm(req);
        const basic = /^Basic (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
        const [bid, bsecret] = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':') : [];
        if ((body.grant_type ?? 'client_credentials') !== 'client_credentials') return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only client_credentials is supported.' });
        return res.set('cache-control', 'no-store').json(issueToken({ clientId: body.client_id ?? bid, clientSecret: body.client_secret ?? bsecret, scope: body.scope }));
      }
      const token = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
      const t = token ? db.prepare('SELECT t.*, c.status AS client_status FROM api_tokens t JOIN api_clients c ON c.id = t.client_ref WHERE t.token_hash = ?').get(sha(token)) : null;
      if (!t || t.revoked_at || t.expires_at <= iso() || t.client_status !== 'ACTIVE' || !flagOn(t.company_id)) return fail(401, 'INVALID_TOKEN', 'The access token is missing, expired or revoked. Get one from /oauth/token.', { 'www-authenticate': 'Bearer error="invalid_token"' });
      const c = db.prepare('SELECT * FROM api_clients WHERE id = ?').get(t.client_ref); const scopes = JSON.parse(t.scopes_json);
      if (path === '/bulk') return bulk(req, res, version, token, c);
      const hit = matchRoute(req.method, version, path);
      if (!hit) return fail(404, 'NOT_FOUND', 'No such public API route; see the catalogue in the developer portal.');
      const { entry } = hit; const started = performance.now();
      if (entry.sunset && entry.sunset < iso().slice(0, 10)) { record(c, entry.id, started, 410); return fail(410, 'GONE', `${entry.path} was retired on ${entry.sunset}; use ${entry.replacement}.`); }
      if (entry.deprecated) res.set({ deprecation: `@${Math.floor(Date.parse(entry.deprecated) / 1000)}`, sunset: new Date(`${entry.sunset}T00:00:00Z`).toUTCString(), link: `</api/public${entry.replacement}>; rel="successor-version"` });
      if (!scopes.includes(entry.scope)) { record(c, entry.id, started, 403); return fail(403, 'INSUFFICIENT_SCOPE', `This route needs the scope ${entry.scope}.`, { 'www-authenticate': `Bearer error="insufficient_scope", scope="${entry.scope}"` }); }
      const rl = throttle(c); res.set({ 'ratelimit-limit': String(rl.limit), 'ratelimit-remaining': String(rl.remaining) });
      if (rl.over) { record(c, entry.id, started, 429); return fail(429, 'RATE_LIMITED', `The ${c.tier_code} tier allows ${rl.limit} calls a minute.`, { 'retry-after': String(rl.retryAfter) }); }
      db.prepare('UPDATE api_clients SET last_used_at = ? WHERE id = ?').run(iso(), c.id);
      res.on('finish', () => record(c, entry.id, started, res.statusCode));
      req.apiClient = c.client_id; req.actor = actorOf(c, scopes);
      const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      let internal = entry.internal; for (const [k, v] of Object.entries(hit.params)) internal = internal.replace(`:${k}`, encodeURIComponent(v));
      req.url = `${internal}${q}`; req.baseUrl = '/api/v1';
      return api(req, res, next);
    } catch (e) {
      if (e?.oauth) return res.status(e.status).set('cache-control', 'no-store').json(e.oauth);
      return next(e);
    }
  }

  /** Bulk: up to 100 write calls, each sent back through the gateway with its own idempotency key, so each is checked and recorded alone. */
  async function bulk(req, res, version, token, c) {
    const key = req.get('idempotency-key');
    const items = Array.isArray(req.body?.requests) ? req.body.requests : null;
    const bad = (msg) => res.status(422).json({ error: { code: 'VALIDATION', message: msg, correlationId: req.correlationId ?? null } });
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } });
    if (!key) return bad('A bulk call needs an Idempotency-Key header.');
    if (!items || !items.length || items.length > 100) return bad('Send requests: an array of 1 to 100 calls.');
    const ids = new Set();
    for (const [i, it] of items.entries()) {
      const hit = it && typeof it.path === 'string' ? matchRoute(String(it.method ?? 'POST').toUpperCase(), version, it.path) : null;
      if (!hit || !hit.entry.bulk) return bad(`Call ${i + 1}: ${it?.path ?? 'no path'} is not a bulk route.`);
      const id = String(it.id ?? i + 1); if (ids.has(id)) return bad(`Call id ${id} is used twice.`); ids.add(id);
    }
    const port = req.socket.localPort; const results = [];
    for (const [i, it] of items.entries()) {
      const id = String(it.id ?? i + 1);
      const r = await fetch(`http://127.0.0.1:${port}/api/public/${version}${it.path}`, { method: String(it.method ?? 'POST').toUpperCase(), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': `${key}:${id}`, 'x-correlation-id': req.correlationId ?? '' }, body: JSON.stringify(it.body ?? {}) });
      results.push({ id, status: r.status, body: await r.json().catch(() => null) });
    }
    writeAudit(db, { companyId: c.company_id, entity: 'api_clients', entityId: String(c.id), action: 'bulk', actor: c.client_id, newValues: { calls: items.length, failed: results.filter((r) => r.status >= 400).length } });
    return res.status(207).json({ data: { results, succeeded: results.filter((r) => r.status < 400).length, failed: results.filter((r) => r.status >= 400).length } });
  }

  // ---------------------------------------------------------------- webhooks
  const allowedEvents = (c) => JSON.parse(c.scopes_json).flatMap((s) => SCOPES[s]?.events ?? []);
  const covers = (allowed, pattern) => allowed.some((a) => a === pattern || (a.endsWith('.*') && (pattern.startsWith(a.slice(0, -1)))));
  const hookView = (w, c) => ({ id: w.id, clientRef: w.client_ref, client: c?.name ?? null, clientId: c?.client_id ?? null, url: w.url, events: JSON.parse(w.event_types_json), status: w.status, secretHint: w.secret_hint, failureStreak: w.failure_streak, lastDeliveryAt: w.last_delivery_at, by: w.created_by, createdAt: w.created_at });
  function checkUrl(raw) {
    let u; try { u = new URL(raw); } catch { throw unprocessable('Give a full URL, such as https://example.com/hooks/erp.'); }
    if (production && u.protocol !== 'https:') throw unprocessable('A webhook URL must use https.');
    if (!['https:', 'http:'].includes(u.protocol)) throw unprocessable('A webhook URL must use https.');
    if (production && PRIVATE_HOST.test(u.hostname)) throw unprocessable('A webhook URL must be a public address.');
    if (u.username || u.password) throw unprocessable('Do not put credentials in the URL; verify the signature instead.');
    return u.toString();
  }
  const webhooks = {
    list(actor) {
      guard(actor, 'adm.api.view');
      const rows = db.prepare('SELECT w.*, c.name AS cname, c.client_id AS cid FROM api_webhooks w JOIN api_clients c ON c.id = w.client_ref WHERE w.company_id = ? AND w.deleted_at IS NULL ORDER BY w.id DESC LIMIT 500').all(actor.companyId);
      const stats = db.prepare("SELECT SUM(status = 'DELIVERED') AS ok, SUM(status = 'DEAD') AS dead, SUM(status IN ('PENDING', 'FAILED')) AS waiting FROM api_webhook_deliveries WHERE webhook_id = ?");
      return { rows: rows.map((w) => ({ ...hookView(w, { name: w.cname, client_id: w.cid }), ...Object.fromEntries(Object.entries(stats.get(w.id)).map(([k, v]) => [k, v ?? 0])) })), canManage: hasPermissionAnywhere(actor, 'adm.api.manage') };
    },
    create(actor, { clientRef, url, events }) {
      guard(actor, 'adm.api.manage');
      const c = clientRow(actor, clientRef); if (['REVOKED', 'REJECTED'].includes(c.status)) throw unprocessable('The client is revoked or rejected.');
      const allowed = allowedEvents(c); const uniq = [...new Set(events)];
      const outside = uniq.filter((p) => !covers(allowed, p)); if (outside.length) throw forbidden(`The client's scopes do not cover ${outside.join(', ')}.`);
      const clean = checkUrl(url); const secret = `whsec_${randomBytes(32).toString('base64url')}`;
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO api_webhooks (company_id, client_ref, url, event_types_json, secret_enc, secret_hint, created_by, source_type) VALUES (?, ?, ?, ?, 'pending', ?, ?, 'webhook')").run(actor.companyId, c.id, clean, JSON.stringify(uniq), secret.slice(-4), actor.user).lastInsertRowid);
        db.prepare('UPDATE api_webhooks SET secret_enc = ? WHERE id = ?').run(vault().encrypt(secret, `webhook/${actor.companyId}/${id}`), id);
        writeAudit(db, { companyId: actor.companyId, entity: 'api_webhooks', entityId: String(id), action: 'create', actor: actor.user, newValues: { client: c.client_id, url: clean, events: uniq } });
        return { ...hookView(db.prepare('SELECT * FROM api_webhooks WHERE id = ?').get(id), c), signingSecret: secret };
      });
    },
    setStatus(actor, id, on) {
      guard(actor, 'adm.api.manage');
      const w = db.prepare('SELECT * FROM api_webhooks WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!w) throw notFound('That webhook does not exist.');
      if (on && db.prepare('SELECT status FROM api_clients WHERE id = ?').get(w.client_ref).status === 'REVOKED') throw unprocessable('The client is revoked.');
      db.prepare('UPDATE api_webhooks SET status = ?, failure_streak = CASE WHEN ? THEN 0 ELSE failure_streak END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(on ? 'ACTIVE' : 'DISABLED', on ? 1 : 0, actor.user, iso(), w.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'api_webhooks', entityId: String(w.id), action: on ? 'enable' : 'disable', actor: actor.user });
      return hookView(db.prepare('SELECT * FROM api_webhooks WHERE id = ?').get(w.id));
    },
    /** A ping delivered at once, to check the endpoint and its signature check. */
    async test(actor, id) {
      guard(actor, 'adm.api.manage');
      const w = db.prepare('SELECT * FROM api_webhooks WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!w) throw notFound('That webhook does not exist.');
      const eventId = `ping-${randomBytes(8).toString('hex')}`;
      const env = { type: 'admin.webhook.pinged', eventId, occurredAt: iso(), companyId: actor.companyId, data: { webhookId: w.id, by: actor.user } };
      const dId = Number(db.prepare("INSERT INTO api_webhook_deliveries (company_id, webhook_id, event_id, event_type, payload_json, next_attempt_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'ping')").run(actor.companyId, w.id, eventId, env.type, JSON.stringify(env), iso(), actor.user).lastInsertRowid);
      await attempt(db.prepare('SELECT * FROM api_webhook_deliveries WHERE id = ?').get(dId));
      return deliveries.get(actor, dId);
    },
  };

  const deliveryView = (d) => ({ id: d.id, webhookId: d.webhook_id, eventId: d.event_id, eventType: d.event_type, status: d.status, attempts: d.attempts, responseCode: d.response_code, error: d.last_error, nextAttemptAt: d.status === 'FAILED' || d.status === 'PENDING' ? d.next_attempt_at : null, deliveredAt: d.delivered_at, durationMs: d.duration_ms, replayOf: d.replay_of, createdAt: d.created_at });
  const deliveries = {
    list(actor, { webhookId = null, status = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'adm.api.view');
      const where = ['company_id = ?']; const p = [actor.companyId];
      if (webhookId) { where.push('webhook_id = ?'); p.push(webhookId); } if (status) { where.push('status = ?'); p.push(status); }
      const sql = where.join(' AND ');
      return { rows: db.prepare(`SELECT * FROM api_webhook_deliveries WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize).map(deliveryView), total: db.prepare(`SELECT COUNT(*) AS n FROM api_webhook_deliveries WHERE ${sql}`).get(...p).n, page, pageSize };
    },
    get(actor, id) { guard(actor, 'adm.api.view'); const d = db.prepare('SELECT * FROM api_webhook_deliveries WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!d) throw notFound('That delivery does not exist.'); return { ...deliveryView(d), payload: JSON.parse(d.payload_json) }; },
    /** FR-03 replay: the same event sent again as a new delivery (the receiver de-duplicates by event id). */
    async replay(actor, id) {
      guard(actor, 'adm.api.manage');
      const d = db.prepare('SELECT * FROM api_webhook_deliveries WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!d) throw notFound('That delivery does not exist.');
      const w = db.prepare('SELECT status FROM api_webhooks WHERE id = ?').get(d.webhook_id); if (w.status !== 'ACTIVE') throw unprocessable('The webhook is disabled; enable it first.');
      const nId = Number(db.prepare("INSERT INTO api_webhook_deliveries (company_id, webhook_id, event_id, event_type, payload_json, next_attempt_at, replay_of, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'replay')").run(d.company_id, d.webhook_id, d.event_id, d.event_type, d.payload_json, iso(), d.replay_of ?? d.id, actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'api_webhook_deliveries', entityId: String(d.id), action: 'replay', actor: actor.user, newValues: { replay: nId } });
      await attempt(db.prepare('SELECT * FROM api_webhook_deliveries WHERE id = ?').get(nId));
      return deliveries.get(actor, nId);
    },
    exportList(actor, q, format) {
      const l = deliveries.list(actor, { ...q, page: 1, pageSize: 100 });
      const columns = [['createdAt', 'Queued'], ['webhookId', 'Webhook'], ['eventType', 'Event'], ['eventId', 'Event id'], ['status', 'Status'], ['attempts', 'Attempts'], ['responseCode', 'Response'], ['error', 'Last error']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'api_webhook_deliveries', action: 'export', actor: actor.user, newValues: { format } });
      return { buffer: writeExport(format, { columns, rows: l.rows.map((r) => ({ ...r, attempts: String(r.attempts), responseCode: r.responseCode == null ? '' : String(r.responseCode) })), title: 'Webhook deliveries', sheetName: 'Deliveries' }), contentType: FORMATS[format], fileName: `webhook-deliveries.${format}` };
    },
  };

  /** One HTTP attempt of a delivery: signed, 10 s timeout, the outcome kept. */
  async function attempt(d) {
    const w = db.prepare('SELECT * FROM api_webhooks WHERE id = ?').get(d.webhook_id);
    const body = d.payload_json; const ts = String(Math.floor(Date.now() / 1000)); const started = performance.now();
    let code = null; let error = null;
    try {
      const secret = vault().decrypt(w.secret_enc, `webhook/${w.company_id}/${w.id}`);
      const r = await fetch(w.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json', 'user-agent': 'erp-webhooks/1', 'x-erp-event': d.event_type, 'x-delivery-id': d.event_id, 'x-timestamp': ts, 'x-signature': `sha256=${signWebhook(secret, ts, body)}` }, body });
      code = r.status; if (r.status < 200 || r.status >= 300) error = `The endpoint answered ${r.status}.`;
      await r.arrayBuffer().catch(() => null);
    } catch (e) { error = String(e?.name === 'TimeoutError' ? 'No answer within 10 seconds.' : e?.message ?? e).slice(0, 300); }
    const attempts = d.attempts + 1; const ok = !error;
    const status = ok ? 'DELIVERED' : attempts >= MAX_ATTEMPTS ? 'DEAD' : 'FAILED';
    const next = ok || status === 'DEAD' ? d.next_attempt_at : iso(new Date(Date.now() + BACKOFF_MIN[attempts - 1] * 60_000));
    db.prepare('UPDATE api_webhook_deliveries SET status = ?, attempts = ?, response_code = ?, last_error = ?, next_attempt_at = ?, delivered_at = ?, duration_ms = ?, updated_at = ? WHERE id = ?').run(status, attempts, code, error, next, ok ? iso() : null, Math.round(performance.now() - started), iso(), d.id);
    db.prepare('UPDATE api_webhooks SET last_delivery_at = ?, failure_streak = CASE WHEN ? THEN 0 ELSE failure_streak + 1 END WHERE id = ?').run(iso(), ok ? 1 : 0, w.id);
    if (status === 'DEAD') publishEvent(db, { type: 'admin.webhook.dead_lettered', entity: 'api_webhook_deliveries', entityId: d.id, actorId: 'system', companyId: d.company_id, data: { webhookId: w.id, eventId: d.event_id, eventType: d.event_type, attempts } });
    return status;
  }
  async function deliverDue(limit = 50) {
    const due = db.prepare("SELECT d.* FROM api_webhook_deliveries d JOIN api_webhooks w ON w.id = d.webhook_id WHERE d.status IN ('PENDING', 'FAILED') AND d.next_attempt_at <= ? AND w.status = 'ACTIVE' ORDER BY d.id LIMIT ?").all(iso(), limit);
    const out = { delivered: 0, failed: 0, dead: 0 };
    for (const d of due) { const s = await attempt(d); if (s === 'DELIVERED') out.delivered += 1; else if (s === 'DEAD') out.dead += 1; else out.failed += 1; }
    return out;
  }
  /** The bus consumer: one delivery per event and matching webhook of the event's company (masked like every event leaving the system). */
  function fanOut(event) {
    if (!event.companyId || !flagOn(event.companyId)) return;
    const hooks = db.prepare("SELECT * FROM api_webhooks WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").all(event.companyId);
    for (const w of hooks) {
      if (!JSON.parse(w.event_types_json).some((p) => patternMatch(p, event.type))) continue;
      const payload = { type: event.type, eventId: event.eventId, occurredAt: event.occurredAt ?? iso(), companyId: event.companyId, entity: event.entity ?? null, entityId: event.entityId ?? null, data: maskPayload(event.data ?? {}) };
      db.prepare("INSERT OR IGNORE INTO api_webhook_deliveries (company_id, webhook_id, event_id, event_type, payload_json, next_attempt_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'system', 'event')").run(event.companyId, w.id, event.eventId, event.type, JSON.stringify(payload), iso());
    }
  }

  // ---------------------------------------------------------------- portal and usage
  function portal(actor) {
    guard(actor, 'adm.api.portal');
    const events = eventTypes.list().filter((e) => Object.values(SCOPES).some((s) => s.events.some((p) => patternMatch(p, e.type)))).map((e) => ({ type: e.type, version: e.version, description: e.description, scope: Object.entries(SCOPES).find(([, s]) => s.events.some((p) => patternMatch(p, e.type)))[0] }));
    return { baseUrl: '/api/public/v1', tokenUrl: '/api/public/v1/oauth/token', versions: VERSIONS, deprecationPolicy: DEPRECATION_POLICY, changelog: CHANGELOG, tiers: Object.entries(TIERS).map(([code, perMinute]) => ({ code, perMinute })), tokenTtl: TOKEN_TTL_SECONDS,
      scopes: Object.entries(SCOPES).map(([code, s]) => ({ code, label: s.label, write: s.write, events: s.events })), endpoints: CATALOGUE.map((e) => ({ ...e, fullPath: `/api/public/${e.version}${e.path}` })), events,
      signature: { header: 'x-signature', timestampHeader: 'x-timestamp', deliveryHeader: 'x-delivery-id', algorithm: 'HMAC-SHA256 over "<x-timestamp>.<raw body>", hex, prefixed sha256=', toleranceSeconds: 300 },
      sandbox: db.prepare("SELECT id, client_id, name, scopes_json FROM api_clients WHERE company_id = ? AND environment = 'SANDBOX' AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id DESC LIMIT 20").all(actor.companyId).map((c) => ({ id: c.id, clientId: c.client_id, name: c.name, scopes: JSON.parse(c.scopes_json) })) };
  }
  function usageReport(actor, { days = 30 } = {}) {
    guard(actor, 'adm.api.view');
    const since = iso(new Date(Date.now() - days * 86_400_000)).slice(0, 10);
    const byClient = db.prepare('SELECT c.id, c.name, c.client_id, c.tier_code, SUM(u.calls) AS calls, SUM(u.errors) AS errors, SUM(u.throttled) AS throttled, SUM(u.total_ms) AS ms FROM api_usage u JOIN api_clients c ON c.id = u.client_ref WHERE u.company_id = ? AND u.day >= ? GROUP BY c.id ORDER BY calls DESC').all(actor.companyId, since);
    const byDay = db.prepare('SELECT day, SUM(calls) AS calls, SUM(errors) AS errors, SUM(throttled) AS throttled FROM api_usage WHERE company_id = ? AND day >= ? GROUP BY day ORDER BY day').all(actor.companyId, since);
    const byEndpoint = db.prepare('SELECT endpoint_id, SUM(calls) AS calls, SUM(errors) AS errors, SUM(total_ms) AS ms FROM api_usage WHERE company_id = ? AND day >= ? GROUP BY endpoint_id ORDER BY calls DESC').all(actor.companyId, since);
    const avg = (ms, calls) => (calls ? Math.round(ms / calls) : 0);
    const total = byDay.reduce((a, d) => ({ calls: a.calls + d.calls, errors: a.errors + d.errors, throttled: a.throttled + d.throttled }), { calls: 0, errors: 0, throttled: 0 });
    return { days, since, total: { ...total, errorRatePct: total.calls ? String(((total.errors / total.calls) * 100).toFixed(1)) : '0.0' },
      byClient: byClient.map((r) => ({ id: r.id, name: r.name, clientId: r.client_id, tier: r.tier_code, perMinute: TIERS[r.tier_code], calls: r.calls, errors: r.errors, throttled: r.throttled, avgMs: avg(r.ms, r.calls) })),
      byDay, byEndpoint: byEndpoint.map((r) => ({ endpoint: r.endpoint_id, calls: r.calls, errors: r.errors, avgMs: avg(r.ms, r.calls) })),
      deliveries: db.prepare("SELECT SUM(status = 'DELIVERED') AS delivered, SUM(status IN ('PENDING', 'FAILED')) AS waiting, SUM(status = 'DEAD') AS dead FROM api_webhook_deliveries WHERE company_id = ? AND created_at >= ?").get(actor.companyId, since) };
  }

  const svc = { clients, issueToken, handle, webhooks, deliveries, deliverDue, fanOut, portal, usage: usageReport, engine, actorOf };
  services.set(db, svc);
  if (bus) bus.subscribe(['mdm.*', 'proc.*', 'site.*', 'att.*', 'plant.*'], (event) => fanOut(event), { consumer: 'admin.webhooks' });
  if (jobs) {
    jobs.register('admin.webhooks.deliver', async () => deliverDue(200), { description: 'Sends the webhook deliveries that are due, with retries (part 29.03).' });
    scheduler?.define({ code: 'admin.webhooks.deliver', cron: '* * * * *', jobType: 'admin.webhooks.deliver', description: 'Every minute: webhook deliveries due and their retries.' });
  }
  return svc;
}
