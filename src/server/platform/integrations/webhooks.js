import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** The signature a sender computes: HMAC-SHA256, hex, over `<timestamp>.<raw body>` (so a captured body cannot be replayed under a new time). */
export const signWebhook = (secret, timestamp, rawBody) => createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');

/**
 * Check an inbound webhook (FR-06). Headers: `x-signature` (`sha256=<hex>` or just the hex) and `x-timestamp` (seconds since
 * the epoch). A missing or wrong signature, or a timestamp more than five minutes from now, is refused. Replay protection by
 * delivery ID is the caller's job (`deliveryIdOf`).
 * @returns {{ ok: true } | { ok: false, reason: 'missing_signature' | 'bad_timestamp' | 'stale_timestamp' | 'bad_signature' }}
 */
export function verifyWebhook({ secret, rawBody, signature, timestamp, nowMs = Date.now(), toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS }) {
  if (!signature || !timestamp) return { ok: false, reason: 'missing_signature' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'bad_timestamp' };
  const seconds = ts > 1e12 ? ts / 1000 : ts;
  if (Math.abs(nowMs / 1000 - seconds) > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };
  const given = Buffer.from(String(signature).replace(/^sha256=/i, '').trim().toLowerCase(), 'utf8');
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

/** The ID that makes a delivery unique: the sender's `x-delivery-id` when it sends one, else a hash of the signed content. */
export const deliveryIdOf = (headerValue, signature, timestamp) =>
  headerValue && /^[\w.:-]{1,100}$/.test(headerValue) ? headerValue : createHash('sha256').update(`${timestamp}.${signature}`).digest('hex').slice(0, 40);
