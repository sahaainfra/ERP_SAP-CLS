import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Used only when no AUTH_SECRET is configured, which config.js refuses in staging and production. */
export const DEV_AUTH_SECRET = 'development-only-auth-secret-never-use-in-production';

const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

/** HS256 JWT. `typ` is carried in the payload (`t`) so an access token cannot be used as a challenge token or the reverse. */
export function signJwt(payload, secret, { expiresInSec, nowMs = Date.now() }) {
  const iat = Math.floor(nowMs / 1000);
  const body = enc({ ...payload, iat, exp: iat + expiresInSec });
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  return `${head}.${body}.${sign(`${head}.${body}`, secret)}`;
}

/** @returns {any | null} the payload, or null when the token is malformed, tampered, of another type or expired. */
export function verifyJwt(token, secret, /** @type {{ type?: string, nowMs?: number }} */ { type, nowMs = Date.now() } = {}) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const given = Buffer.from(parts[2]);
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    if (JSON.parse(Buffer.from(parts[0], 'base64url').toString()).alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
    if (type && payload.t !== type) return null;
    return payload;
  } catch {
    return null;
  }
}

/** A random, URL-safe token, and the hash that is stored instead of it. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const newPublicId = () => randomBytes(16).toString('hex');
