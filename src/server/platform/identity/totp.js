import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export function base32Decode(text) {
  let bits = '';
  for (const ch of text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Not a base32 string');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** A new shared secret: 160 bits, base32, as authenticator apps expect. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** RFC 6238 / RFC 4226: HMAC-SHA1, 30 second steps, 6 digits. */
export function totpAt(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const counterAt = (nowMs, step = 30) => Math.floor(nowMs / 1000 / step);

/**
 * Check a code within one step either side of now (clock drift). A step that was already used (`lastCounter`) is refused, so a code
 * seen over a shoulder or replayed cannot be used twice. Returns the matching counter, or null.
 */
export function verifyTotp(secret, code, { nowMs = Date.now(), window = 1, lastCounter = null } = {}) {
  if (!/^\d{6}$/.test(String(code ?? ''))) return null;
  const now = counterAt(nowMs);
  for (let c = now - window; c <= now + window; c += 1) {
    if (lastCounter !== null && c <= lastCounter) continue;
    const expected = Buffer.from(totpAt(secret, c));
    const given = Buffer.from(String(code));
    if (given.length === expected.length && timingSafeEqual(given, expected)) return c;
  }
  return null;
}

export const otpauthUri = ({ issuer, account, secret }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
