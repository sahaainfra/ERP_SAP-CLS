import { argon2, createHash, pbkdf2, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/** @type {(algorithm: string, params: any) => Promise<Buffer>} */
const argon2Async = /** @type {any} */ (promisify(argon2));
const pbkdf2Async = /** @type {any} */ (promisify(pbkdf2));
const scryptAsync = /** @type {any} */ (promisify(scrypt));

/** Argon2id parameters (OWASP minimum: 19 MiB, 2 passes, 1 lane). A hash written with weaker ones is upgraded at the next login. */
export const ARGON2_DEFAULT = Object.freeze({ memory: 19456, passes: 2, parallelism: 1 });
const TAG_LENGTH = 32;
const b64 = (buf) => buf.toString('base64').replace(/=+$/, '');
const eq = (a, b) => a.length === b.length && timingSafeEqual(a, b);

async function argonHash(plain, { memory, passes, parallelism }) {
  const nonce = randomBytes(16);
  const tag = await argon2Async('argon2id', { message: Buffer.from(plain, 'utf8'), nonce, parallelism, tagLength: TAG_LENGTH, memory, passes });
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(nonce)}$${b64(tag)}`;
}

async function argonVerify(stored, plain) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!m) return false;
  const [memory, passes, parallelism] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const expected = Buffer.from(m[5], 'base64');
  const tag = await argon2Async('argon2id', { message: Buffer.from(plain, 'utf8'), nonce: Buffer.from(m[4], 'base64'), parallelism, tagLength: expected.length, memory, passes });
  return eq(tag, expected);
}

/**
 * Hashes written by the systems this one replaces (BR-03). Each verifier answers "does this password match this stored hash";
 * none is ever written again: a successful login re-hashes with Argon2id.
 *   pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>
 *   scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
 *   sha256$<salt>$<hex of sha256(salt + password)>
 */
export const LEGACY_VERIFIERS = {
  async pbkdf2_sha256(stored, plain) {
    const [, iterations, salt, hash] = stored.split('$');
    const expected = Buffer.from(hash, 'base64');
    return eq(await pbkdf2Async(plain, Buffer.from(salt, 'base64'), Number(iterations), expected.length, 'sha256'), expected);
  },
  async scrypt(stored, plain) {
    const [, n, r, p, salt, hash] = stored.split('$');
    const expected = Buffer.from(hash, 'base64');
    return eq(await scryptAsync(plain, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 }), expected);
  },
  async sha256(stored, plain) {
    const [, salt, hex] = stored.split('$');
    return eq(Buffer.from(createHash('sha256').update(`${salt}${plain}`).digest('hex')), Buffer.from(hex ?? ''));
  },
};

export const algoOf = (stored) => (stored.startsWith('$argon2id$') ? 'argon2id' : stored.split('$')[0]);

/** A hasher with the given Argon2id cost. Tests pass a cheap cost; the application uses the default. */
export function createPasswordHasher({ cost = ARGON2_DEFAULT } = {}) {
  const params = { ...ARGON2_DEFAULT, ...cost };
  const weaker = (stored) => {
    const m = /m=(\d+),t=(\d+),p=(\d+)/.exec(stored);
    return !m || Number(m[1]) < params.memory || Number(m[2]) < params.passes;
  };
  return {
    params,
    hash: (plain) => argonHash(plain, params),
    /** @returns {Promise<{ ok: boolean, algo: string, needsRehash: boolean }>} */
    async verify(stored, plain) {
      const algo = algoOf(stored);
      let ok = false;
      try {
        if (algo === 'argon2id') ok = await argonVerify(stored, plain);
        else if (LEGACY_VERIFIERS[algo]) ok = await LEGACY_VERIFIERS[algo](stored, plain);
      } catch {
        ok = false; // a malformed stored value is a failed login, never a crash
      }
      return { ok, algo, needsRehash: ok && (algo !== 'argon2id' || weaker(stored)) };
    },
    /** Spend the time of a real check on an unknown user, so response time does not reveal whether the account exists (BR-01). */
    async decoy(plain) {
      this.decoyHash ??= await argonHash('decoy-password-never-used', params);
      await argonVerify(this.decoyHash, plain);
    },
  };
}
