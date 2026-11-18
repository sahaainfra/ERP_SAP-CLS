import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants, createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';
import { httpGsp, resetGspSessions } from '../src/server/modules/fin/gsp.js';

// D-731: the encrypted session of the IRP and of the e-way bill system, against a portal played in the test with its own RSA key pair:
// the credentials and the AppKey travel RSA-encrypted, the SEK comes back under the AppKey, requests and answers are AES-256-ECB under the SEK,
// the token is reused, and fetched again once when the portal says it is invalid.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const aesEnc = (k, b) => { const c = createCipheriv('aes-256-ecb', k, null); return Buffer.concat([c.update(b), c.final()]); };
const aesDec = (k, b) => { const d = createDecipheriv('aes-256-ecb', k, null); return Buffer.concat([d.update(b), d.final()]); };
const rsaDec = (b64) => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(b64, 'base64'));

function portal() {
  const tokens = new Map(); const calls = []; let n = 0; const state = { expireNext: false };
  const answer = (obj, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj) });
  async function fetch(url, init) {
    const path = new URL(url).pathname; const h = init.headers; const body = init.body ? JSON.parse(init.body) : null; calls.push(path);
    if (path === '/eivital/v1.04/auth') {
      const p = JSON.parse(Buffer.from(rsaDec(body.Data).toString('utf8'), 'base64').toString('utf8'));
      if (p.UserName !== 'api_user' || p.Password !== 'secret-pw' || h.client_id !== 'cid') return answer({ Status: 0, ErrorDetails: [{ ErrorCode: '1010', ErrorMessage: 'Invalid credentials' }] });
      const sek = randomBytes(32); n += 1; const token = `T${n}`; tokens.set(token, sek);
      return answer({ Status: 1, Data: { AuthToken: token, Sek: aesEnc(Buffer.from(p.AppKey, 'base64'), sek).toString('base64'), TokenExpiry: '2099-12-31 23:59:00' } });
    }
    if (path === '/eicore/v1.03/Invoice') {
      const sek = tokens.get(h.AuthToken); if (!sek || state.expireNext) { state.expireNext = false; tokens.delete(h.AuthToken); return answer({ Status: 0, ErrorDetails: [{ ErrorCode: '1005', ErrorMessage: 'Invalid Token' }] }); }
      const inv = JSON.parse(aesDec(sek, Buffer.from(body.Data, 'base64')).toString('utf8'));
      return answer({ Status: 1, Data: aesEnc(sek, Buffer.from(JSON.stringify({ AckNo: 112010000000001, AckDt: '2026-11-18 10:00:00', Irn: `irn-of-${inv.DocDtls.No}`, SignedQRCode: 'qr', Status: 'ACT' }))).toString('base64') });
    }
    if (path === '/ewaybillapi/v1.03/auth') {
      if (rsaDec(body.password).toString('utf8') !== 'ewb-pw' || body.action !== 'ACCESSTOKEN') return answer({ status: '0', error: { errorCodes: '108', message: 'Invalid login' } });
      const appKey = Buffer.from(rsaDec(body.app_key).toString('utf8'), 'base64'); const sek = randomBytes(32); n += 1; tokens.set(`E${n}`, sek);
      return answer({ status: '1', authtoken: `E${n}`, sek: aesEnc(appKey, sek).toString('base64') });
    }
    if (path === '/ewaybillapi/v1.03/ewayapi') {
      const sek = tokens.get(h.authtoken); const req = JSON.parse(Buffer.from(aesDec(sek, Buffer.from(body.data, 'base64')).toString('utf8'), 'base64').toString('utf8'));
      assert.equal(body.action, 'GENEWAYBILL');
      return answer({ status: '1', data: aesEnc(sek, Buffer.from(Buffer.from(JSON.stringify({ ewayBillNo: 181000000001, ewayBillDate: '18/11/2026 10:00:00 AM', validUpto: null, docNo: req.docNo })).toString('base64'))).toString('base64') });
    }
    return answer({ message: 'not found' }, 404);
  }
  return { fetch, calls, state };
}
const ctxOf = (p, over = {}) => ({ config: { baseUrl: 'https://portal.test', gstin: '36AAACM1234F1Z5', userName: 'api_user', encryption: 'IRP', publicKey, irnPath: '/eicore/v1.03/Invoice', ewbPath: '/ewaybillapi/v1.03/ewayapi', ...over }, secrets: { client_id: 'cid', client_secret: 'cs', password: 'secret-pw', ewb_password: 'ewb-pw' }, fetch: p.fetch });

test('D-731 IRN through the IRP session: encrypted both ways, the token reused, renewed once when invalid', async () => {
  resetGspSessions(); const p = portal(); const gsp = httpGsp(); const ctx = ctxOf(p);
  const a = await gsp.operations.generateIrn.run(ctx, { json: { DocDtls: { No: 'INV/1' } } }); assert.equal(a.data.Irn, 'irn-of-INV/1'); assert.equal(a.data.Status, 'ACT');
  await gsp.operations.generateIrn.run(ctx, { json: { DocDtls: { No: 'INV/2' } } }); assert.deepEqual(p.calls, ['/eivital/v1.04/auth', '/eicore/v1.03/Invoice', '/eicore/v1.03/Invoice'], 'one authentication for both');
  p.state.expireNext = true; const c = await gsp.operations.generateIrn.run(ctx, { json: { DocDtls: { No: 'INV/3' } } }); assert.equal(c.data.Irn, 'irn-of-INV/3'); assert.equal(p.calls.filter((x) => x === '/eivital/v1.04/auth').length, 2, 'authenticated again after 1005');
  resetGspSessions(); await assert.rejects(gsp.operations.generateIrn.run({ ...ctx, secrets: { ...ctx.secrets, password: 'wrong' } }, { json: { DocDtls: { No: 'INV/4' } } }), /1010: Invalid credentials/);
});

test('D-731 e-way bill through its own session; the configuration is checked', async () => {
  resetGspSessions(); const p = portal(); const gsp = httpGsp();
  const e = await gsp.operations.generateEwb.run(ctxOf(p), { docNo: 'TRF/1', fromGstin: '36AAACM1234F1Z5' }); assert.equal(e.data.ewayBillNo, 181000000001); assert.equal(e.data.docNo, 'TRF/1');
  assert.deepEqual(p.calls, ['/ewaybillapi/v1.03/auth', '/ewaybillapi/v1.03/ewayapi']);
  assert.deepEqual(gsp.validateConfig({ baseUrl: 'https://gsp.example.com', gstin: '36AAACM1234F1Z5', encryption: 'IRP', publicKey }, 'production'), []);
  assert.match(gsp.validateConfig({ baseUrl: 'https://gsp.example.com', gstin: '36AAACM1234F1Z5', encryption: 'IRP', publicKey: 'nope' }, 'production').join(' '), /publicKey/);
  assert.match(gsp.validateConfig({ baseUrl: 'https://gsp.example.com', gstin: '36AAACM1234F1Z5', encryption: 'AES' }, 'production').join(' '), /encryption/);
  // plain mode is unchanged: JSON to the GSP with its headers
  resetGspSessions(); const plain = await gsp.operations.generateIrn.run({ ...ctxOf(p, { encryption: 'NONE', irnPath: '/plain' }), fetch: async (url, init) => ({ ok: true, status: 200, text: async () => JSON.stringify({ got: JSON.parse(init.body).DocDtls.No, cid: init.headers['client-id'] }) }) }, { json: { DocDtls: { No: 'X' } } }); assert.deepEqual(plain.data, { got: 'X', cid: 'cid' });
});
