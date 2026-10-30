import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed download links (FR-06). The signature covers the file, the expiry, the variant and the disposition,
 * so none of them can be changed in the link. Access to the file was checked when the link was issued.
 */
export function createSigner(secret, now = () => Date.now()) {
  const mac = (id, exp, variant, disposition) => createHmac('sha256', secret).update(`${id}|${exp}|${variant}|${disposition}`).digest('base64url');
  return {
    sign({ id, ttlSeconds, variant = 'file', disposition = 'inline' }) {
      const exp = Math.floor(now() / 1000) + ttlSeconds;
      return { exp, v: variant, d: disposition, sig: mac(id, exp, variant, disposition) };
    },
    /** Returns null when the link is valid, otherwise 'expired' or 'invalid'. */
    check({ id, exp, v, d, sig }) {
      const e = Number(exp);
      if (!Number.isInteger(e) || typeof sig !== 'string' || !['file', 'thumbnail'].includes(v) || !['inline', 'attachment'].includes(d)) return 'invalid';
      const expected = Buffer.from(mac(id, e, v, d));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
      return e * 1000 < now() ? 'expired' : null;
    },
  };
}
