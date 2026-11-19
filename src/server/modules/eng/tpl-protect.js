import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';

// Part 24.05 (extends 04.11): a generated PDF opened only with a password — the payslip sent by e-mail. The standard security handler of the PDF format,
// revision 4 with AES-128 (AESV2): every string and stream of the document is encrypted with a key of its object, derived from the file key, which is derived
// from the user password (ISO 32000-1, 7.6.3, algorithms 2, 3 and 5). The owner password is random and kept by no one: the document can be printed, not changed.
// RC4 is used only inside the key derivation the format prescribes (written here: the OpenSSL default provider no longer carries it).

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...parts) => { const h = createHash('md5'); for (const p of parts) h.update(p); return h.digest(); };
const padded = (pw) => Buffer.concat([Buffer.from(String(pw ?? ''), 'latin1'), PAD]).subarray(0, 32);
function rc4(key, data) {
  const s = new Uint8Array(256); for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0; for (let i = 0; i < 256; i += 1) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length); let i = 0; j = 0;
  for (let k = 0; k < data.length; k += 1) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
  return out;
}
const rc4Rounds = (key, data) => { let o = rc4(key, data); for (let i = 1; i <= 19; i += 1) o = rc4(Buffer.from(key.map((b) => b ^ i)), o); return o; };
/** Print (bit 3) and high-quality print (bit 12) allowed, extraction for accessibility (bit 10); no change, no copy. As a signed 32-bit number. */
export const PERMISSIONS = (0xfffff0c0 | 4 | 512 | 2048) | 0;

/** Algorithm 3: the O entry. */
export function ownerEntry(owner, user) { let h = md5(padded(owner)); for (let i = 0; i < 50; i += 1) h = md5(h); return rc4Rounds(h.subarray(0, 16), padded(user)); }
/** Algorithm 2: the file key. */
export function fileKey(user, O, P, id0) { const p = Buffer.alloc(4); p.writeInt32LE(P); let h = md5(padded(user), O, p, id0); for (let i = 0; i < 50; i += 1) h = md5(h.subarray(0, 16)); return h.subarray(0, 16); }
/** Algorithm 5: the U entry (its first 16 bytes are compared when the file is opened). */
export function userEntry(key, id0) { return Buffer.concat([rc4Rounds(key, md5(PAD, id0)), Buffer.alloc(16)]); }
const objectKey = (key, num, gen) => { const n = Buffer.alloc(5); n.writeUIntLE(num, 0, 3); n.writeUIntLE(gen, 3, 2); return md5(key, n, Buffer.from('sAlT', 'latin1')).subarray(0, 16); };
const aes = (k, data) => { const iv = randomBytes(16); const c = createCipheriv('aes-128-cbc', k, iv); return Buffer.concat([iv, c.update(Buffer.from(data)), c.final()]); };

/**
 * A PDF made by the template service, encrypted so that it opens only with `password`.
 * @param {Buffer|Uint8Array} bytes @param {string} password @returns {Promise<Buffer>}
 */
export async function protectPdf(bytes, password) {
  if (!password || String(password).length < 4) throw new Error('A password of at least four characters is needed to protect a document.');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = pdf.context;
  const id0 = randomBytes(16);
  const O = ownerEntry(randomBytes(24).toString('hex'), password);
  const key = fileKey(password, O, PERMISSIONS, id0);
  const U = userEntry(key, id0);
  const encString = (k, s) => PDFHexString.of(aes(k, s.asBytes()).toString('hex'));
  const walk = (k, o) => {
    if (o instanceof PDFString || o instanceof PDFHexString) return encString(k, o);
    if (o instanceof PDFDict) { for (const [name, v] of o.entries()) { const n = walk(k, v); if (n !== v) o.set(name, n); } return o; }
    if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i += 1) { const v = o.get(i); const n = walk(k, v); if (n !== v) o.set(i, n); } return o; }
    return o;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const k = objectKey(key, ref.objectNumber, ref.generationNumber);
    if (obj instanceof PDFRawStream) {
      const type = obj.dict.get(PDFName.of('Type'));
      if (type === PDFName.of('XRef') || type === PDFName.of('ObjStm')) continue;
      walk(k, obj.dict);
      ctx.assign(ref, PDFRawStream.of(obj.dict, aes(k, obj.contents)));
    } else walk(k, obj);
  }
  const cf = ctx.obj({ StdCF: ctx.obj({ AuthEvent: PDFName.of('DocOpen'), CFM: PDFName.of('AESV2'), Length: PDFNumber.of(16) }) });
  const enc = ctx.obj({ Filter: PDFName.of('Standard'), V: PDFNumber.of(4), R: PDFNumber.of(4), Length: PDFNumber.of(128), CF: cf, StmF: PDFName.of('StdCF'), StrF: PDFName.of('StdCF'), O: PDFHexString.of(O.toString('hex')), U: PDFHexString.of(U.toString('hex')), P: PDFNumber.of(PERMISSIONS) });
  ctx.trailerInfo.Encrypt = ctx.register(enc);
  const idHex = PDFHexString.of(id0.toString('hex'));
  ctx.trailerInfo.ID = ctx.obj([idHex, idHex]);
  return Buffer.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

/** Does `password` open this protected PDF? (Algorithm 6: the U entry recomputed from the password.) For the tests and the support desk. */
export function opensWith(bytes, password) {
  const text = Buffer.from(bytes).toString('latin1');
  const hex = (name) => { const m = new RegExp(`/${name}\\s*<([0-9A-Fa-f]+)>`).exec(text); return m ? Buffer.from(m[1], 'hex') : null; };
  const O = hex('O'); const U = hex('U'); const p = /\/P\s+(-?\d+)/.exec(text); const id = /\/ID\s*\[\s*<([0-9A-Fa-f]+)>/.exec(text);
  if (!O || !U || !p || !id) return false;
  const key = fileKey(password, O, Number(p[1]), Buffer.from(id[1], 'hex'));
  return userEntry(key, Buffer.from(id[1], 'hex')).subarray(0, 16).equals(U.subarray(0, 16));
}
