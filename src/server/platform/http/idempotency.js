import { createHash } from 'node:crypto';
import { transaction } from '../db/index.js';
import { HttpError, badRequest, conflict } from './errors.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_FORMAT = /^[\w.:-]{8,128}$/;
const PURGE_BATCH = 100;

/** Canonical JSON: object keys sorted, so the same body always hashes the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export const requestHash = (req) => createHash('sha256').update(`${req.method}\n${req.originalUrl}\n${canonical(req.body ?? null)}`).digest('hex');

/**
 * Idempotency middleware (FR-04, BR-02). Put it after authentication on every submit, post, payment, stock and
 * approval endpoint, with `required: true`: the client sends `Idempotency-Key` and a retry never repeats the action.
 *
 * - first request with a key: the handler runs; a 2xx response is stored for `ttlMs` (default 24 hours)
 * - same key, same request: the stored response is returned again with `Idempotency-Replayed: true`
 * - same key, different request: 422 `IDEMPOTENCY_KEY_REUSED`
 * - same key while the first request is still running: 409 `REQUEST_IN_PROGRESS`
 * - a non-2xx result is not stored, so the client can fix the request and retry with the same key
 * Keys are scoped to the actor key and endpoint. The default actor key is the username.
 * Expired keys are purged as new ones arrive.
 */
export function idempotency(db, { required = false, ttlMs = IDEMPOTENCY_TTL_MS, now = () => Date.now(), actorKey = (actor) => actor.user } = {}) {
  return (req, res, next) => {
    const key = req.get('idempotency-key');
    if (key === undefined) {
      if (!required) return next();
      return next(badRequest('This action needs an Idempotency-Key header so a retry cannot repeat it. Send a unique value (a UUID) for each new action.', [{ field: 'Idempotency-Key', message: 'is required' }]));
    }
    if (!KEY_FORMAT.test(key)) {
      return next(badRequest('The Idempotency-Key must be 8 to 128 letters, digits, dots, colons, dashes or underscores.', [{ field: 'Idempotency-Key', message: 'has an invalid format' }]));
    }
    if (!req.actor?.user) return next(new Error('idempotency() must run after authentication'));
    const user = actorKey(req.actor);
    const endpoint = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
    const hash = requestHash(req);
    const stamp = now();

    let replay = null;
    try {
      transaction(db, () => {
        db.prepare('DELETE FROM core_idempotency_keys WHERE id IN (SELECT id FROM core_idempotency_keys WHERE expires_at < ? ORDER BY expires_at LIMIT ?)').run(new Date(stamp).toISOString(), PURGE_BATCH);
        const row = db.prepare('SELECT * FROM core_idempotency_keys WHERE user_id = ? AND endpoint = ? AND key = ?').get(user, endpoint, key);
        if (row && Date.parse(row.expires_at) > stamp) {
          if (row.request_hash !== hash) {
            throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request. Use a new key for a new action, or repeat the original request exactly.');
          }
          if (row.response_status == null) throw conflict('A request with this Idempotency-Key is still being processed. Wait a moment and check the result before retrying.');
          replay = row;
          return;
        }
        if (row) db.prepare('DELETE FROM core_idempotency_keys WHERE id = ?').run(row.id);
        db.prepare('INSERT INTO core_idempotency_keys (key, user_id, endpoint, request_hash, expires_at) VALUES (?, ?, ?, ?, ?)').run(key, user, endpoint, hash, new Date(stamp + ttlMs).toISOString());
      });
    } catch (err) {
      return next(err instanceof HttpError && err.code === 'VERSION_CONFLICT' ? Object.assign(err, { code: 'REQUEST_IN_PROGRESS' }) : err);
    }

    if (replay) {
      res.set('idempotency-replayed', 'true');
      return res.status(replay.response_status).type('application/json').send(replay.response_body);
    }

    // First time: remember a successful response, forget a failed one so the client can retry with the same key.
    let body;
    const send = res.send.bind(res);
    res.send = (payload) => {
      // a compressed JSON answer (part 166.4, compressJson) is kept as the JSON it was, so a replay sends the same answer
      body = typeof payload === 'string' ? payload : (res.locals?.jsonText ?? payload);
      return send(payload);
    };
    res.on('finish', () => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 300 && typeof body === 'string') {
          db.prepare('UPDATE core_idempotency_keys SET response_status = ?, response_body = ? WHERE user_id = ? AND endpoint = ? AND key = ?').run(res.statusCode, body, user, endpoint, key);
        } else {
          db.prepare('DELETE FROM core_idempotency_keys WHERE user_id = ? AND endpoint = ? AND key = ?').run(user, endpoint, key);
        }
      } catch {
        /* the database is going away: nothing more can be recorded */
      }
    });
    res.on('close', () => {
      if (!res.writableFinished) {
        try {
          db.prepare('DELETE FROM core_idempotency_keys WHERE user_id = ? AND endpoint = ? AND key = ? AND response_status IS NULL').run(user, endpoint, key);
        } catch {
          /* ignore */
        }
      }
    });
    return next();
  };
}
