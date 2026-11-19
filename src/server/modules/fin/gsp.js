import { constants, createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';
import { ProviderError, endpointProblem, httpJson } from '../../platform/integrations/providers.js';
import { gstinProblem } from '../../../shared/gst.js';

// Part 23.07: the GST providers of the integration hub (01.08, connector type "gsp"). Every e-invoice, e-way bill and GSTIN search goes through a connector
// approved by the CFO, so the hub's rate limit, circuit breaker, retries, credential vault and call log apply.
//  - "sandbox": the IRP and the e-way bill system played inside the ERP for set-up, training and tests. It checks the request as the portal does (the schema's
//    required fields, the GSTINs, the arithmetic, a document number used once per supplier, year and type whatever its case, the 30-day reporting window,
//    cancellation within 24 hours) and answers with the portal's fields: the IRN is the SHA-256 of supplier GSTIN, year, type and number as the IRP computes it;
//    the signed QR is a JWT. Nothing leaves the system; the answers are marked as sandbox ones.
//  - "gsp_http": an authorised GSP/ASP's JSON API (base URL, paths, client id and secret). A GSP's own token and payload encryption are its adapter's work (D-731).

const pad = (n, w = 2) => String(n).padStart(w, '0');
const istNow = (now) => new Date(now + 5.5 * 3600_000);
const istStamp = (now) => { const d = istNow(now); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const istDate = (now) => istStamp(now).slice(0, 10);
const fromDdMm = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const b64u = (s) => Buffer.from(s).toString('base64url');
/** The financial year of a date, as the IRP writes it: 2026-27. */
export const fyOf = (date) => { const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
/** The IRN: SHA-256 (hex, 64 characters) of the supplier GSTIN, the financial year, the document type and the document number in capitals. */
export const irnOf = (gstin, fy, type, no) => createHash('sha256').update(`${gstin}${fy}${type}${String(no).toUpperCase()}`).digest('hex');
/** The end of the day (23:59:59 IST) that is `days` days after a moment, as an ISO instant: the validity rule of an e-way bill (a day ends at midnight). */
export function endOfIstDay(iso, days) { const d = istNow(Date.parse(iso)); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(23, 59, 59, 0); return new Date(d.getTime() - 5.5 * 3600_000).toISOString(); }
/** Days of validity for a distance: one day for each `perDay` km or part of it. */
export const validityDays = (km, perDay) => Math.max(1, Math.ceil(Number(km) / Number(perDay)));

const SANDBOX_KEY = 'erp-sandbox-irp-signing-key (not a NIC key)';
const jwt = (payload) => { const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'SANDBOX' })); const p = b64u(JSON.stringify(payload)); return `${h}.${p}.${createHmac('sha256', SANDBOX_KEY).update(`${h}.${p}`).digest('base64url')}`; };
/** Reads a signed QR (any JWT): its claims. The sandbox signature is checked; a production one is the IRP's and is kept as received. */
export function readSignedQr(token) {
  const [h, p, s] = String(token ?? '').split('.'); if (!p) return null;
  let head; let claims; try { head = JSON.parse(Buffer.from(h, 'base64url').toString()); claims = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
  const data = typeof claims.data === 'string' ? JSON.parse(claims.data) : claims.data;
  return { kid: head.kid ?? null, sandboxValid: head.kid === 'SANDBOX' ? createHmac('sha256', SANDBOX_KEY).update(`${h}.${p}`).digest('base64url') === s : null, ...data };
}

const refuse = (code, message) => new ProviderError(`${code}: ${message}`, { retryable: false, httpStatus: 400, response: { status: 0, errorDetails: [{ ErrorCode: code, ErrorMessage: message }] } });
const R2 = (n) => Math.round(Number(n) * 100);

/** The checks of the IRP's schema 1.1 that matter for a construction company's invoices and notes. Returns problems or []. */
export function einvoiceProblems(j) {
  const p = [];
  const need = (cond, field, message) => { if (!cond) p.push({ field, message }); };
  need(j && j.Version === '1.1', 'Version', 'The schema version is 1.1.');
  if (!j || typeof j !== 'object') return p;
  need(['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'].includes(j.TranDtls?.SupTyp), 'TranDtls.SupTyp', 'The supply type is one of B2B, SEZWP, SEZWOP, EXPWP, EXPWOP, DEXP.');
  need(['INV', 'CRN', 'DBN'].includes(j.DocDtls?.Typ), 'DocDtls.Typ', 'The document type is INV, CRN or DBN.');
  need(/^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/.test(String(j.DocDtls?.No ?? '')), 'DocDtls.No', 'The document number has 1 to 16 characters (letters, digits, / and -), not starting with 0, / or -.');
  need(Boolean(fromDdMm(j.DocDtls?.Dt)), 'DocDtls.Dt', 'The document date is written dd/mm/yyyy.');
  for (const [who, x] of [['SellerDtls', j.SellerDtls], ['BuyerDtls', j.BuyerDtls]]) {
    if (who === 'BuyerDtls' && String(x?.Gstin) === 'URP') { need(['EXPWP', 'EXPWOP'].includes(j.TranDtls?.SupTyp), `${who}.Gstin`, 'URP (unregistered) is for an export only.'); } else need(!gstinProblem(String(x?.Gstin ?? '')), `${who}.Gstin`, `${who === 'SellerDtls' ? 'The supplier' : 'The recipient'} GSTIN is not valid.`);
    need(String(x?.LglNm ?? '').trim().length >= 3, `${who}.LglNm`, 'The legal name has at least 3 characters.');
    need(String(x?.Addr1 ?? '').trim().length >= 1, `${who}.Addr1`, 'The address line is required.');
    need(String(x?.Loc ?? '').trim().length >= 3, `${who}.Loc`, 'The place has at least 3 characters.');
    need(/^[1-9]\d{5}$/.test(String(x?.Pin ?? '')) || (who === 'BuyerDtls' && String(x?.Pin) === '999999'), `${who}.Pin`, 'The PIN code has 6 digits.');
    need(/^\d{2}$/.test(String(x?.Stcd ?? '')), `${who}.Stcd`, 'The state code has 2 digits.');
  }
  need(/^\d{2}$/.test(String(j.BuyerDtls?.Pos ?? '')), 'BuyerDtls.Pos', 'The place of supply is a 2-digit state code.');
  const items = Array.isArray(j.ItemList) ? j.ItemList : [];
  need(items.length >= 1 && items.length <= 1000, 'ItemList', 'An invoice has 1 to 1000 items.');
  let ass = 0; let cg = 0; let sg = 0; let ig = 0; let ces = 0; let tot = 0;
  items.forEach((it, i) => {
    need(/^\d{4,8}$/.test(String(it.HsnCd ?? '')), `ItemList.${i}.HsnCd`, 'The HSN/SAC code has 4 to 8 digits.');
    need([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40].includes(Number(it.GstRt)), `ItemList.${i}.GstRt`, 'The GST rate is one of the notified rates.');
    const a = R2(it.AssAmt); const t = R2(it.TotItemVal); const tax = R2(it.CgstAmt ?? 0) + R2(it.SgstAmt ?? 0) + R2(it.IgstAmt ?? 0) + R2(it.CesAmt ?? 0);
    need(Math.abs(a + tax - t) <= 100, `ItemList.${i}.TotItemVal`, 'The item value is the assessable value plus its taxes.');
    if (R2(it.IgstAmt ?? 0) > 0) need(R2(it.CgstAmt ?? 0) === 0 && R2(it.SgstAmt ?? 0) === 0, `ItemList.${i}.IgstAmt`, 'An item carries IGST or CGST and SGST, not both.');
    if (Number(it.GstRt) > 0 && j.TranDtls?.SupTyp === 'B2B' && j.TranDtls?.RegRev !== 'Y') need(Math.abs(Math.round((a * Number(it.GstRt)) / 100) - (R2(it.CgstAmt ?? 0) + R2(it.SgstAmt ?? 0) + R2(it.IgstAmt ?? 0))) <= 100, `ItemList.${i}.GstRt`, 'The tax of the item is its assessable value times the rate.');
    ass += a; cg += R2(it.CgstAmt ?? 0); sg += R2(it.SgstAmt ?? 0); ig += R2(it.IgstAmt ?? 0); ces += R2(it.CesAmt ?? 0); tot += t;
  });
  const v = j.ValDtls ?? {};
  need(Math.abs(R2(v.AssVal) - ass) <= 100 && Math.abs(R2(v.CgstVal ?? 0) - cg) <= 100 && Math.abs(R2(v.SgstVal ?? 0) - sg) <= 100 && Math.abs(R2(v.IgstVal ?? 0) - ig) <= 100 && Math.abs(R2(v.CesVal ?? 0) - ces) <= 100, 'ValDtls', 'The totals are the sums of the items.');
  need(Math.abs(R2(v.TotInvVal) - tot - R2(v.OthChrg ?? 0) + R2(v.Discount ?? 0) - R2(v.RndOffAmt ?? 0)) <= 100, 'ValDtls.TotInvVal', 'The invoice value is the sum of the items, other charges and the rounding off, less the discount.');
  const intra = String(j.SellerDtls?.Stcd) === String(j.BuyerDtls?.Pos) && j.TranDtls?.SupTyp === 'B2B' && j.TranDtls?.IgstOnIntra !== 'Y';
  if (intra && ig > 0) p.push({ field: 'ValDtls.IgstVal', message: 'The supplier and the place of supply are in the same state: CGST and SGST, not IGST.' });
  if (!intra && (cg > 0 || sg > 0)) p.push({ field: 'ValDtls.CgstVal', message: 'The place of supply is in another state (or SEZ or export): IGST, not CGST and SGST.' });
  return p;
}

/** The sandbox IRP and e-way bill system. State lives with the provider registry of the database (one per application). */
// D-735: GSTR-2B as the sandbox gives it, by GSTIN and return period (MMYYYY); set for training and tests (empty when nothing is set).
const SANDBOX_2B = new Map();
/** @param {string} gstin @param {string} rtnprd MMYYYY @param {any} docdata GSTN's docdata { b2b, cdnr } */
export const seedSandbox2b = (gstin, rtnprd, docdata) => SANDBOX_2B.set(`${gstin}|${rtnprd}`, docdata);
export function sandboxGsp({ now = () => Date.now() } = {}) {
  const irns = new Map(); // IRN -> { ackNo, ackDt, cancelled }
  const ewbs = new Map(); // EWB number -> { at, validUpto, cancelled, docKey }
  const ewbDocs = new Map();
  let ack = 0; let ewbSeq = 0;
  const gstinStatus = (g) => { const x = String(g ?? ''); if (gstinProblem(x)) return null; return x[12] === '9' ? 'CANCELLED' : 'ACTIVE'; };
  return {
    type: 'gsp',
    provider: 'sandbox',
    label: 'GST sandbox (IRP and e-way bill system played inside the ERP)',
    description: 'Checks e-invoices and e-way bills as the portal does and answers with an IRN, acknowledgement, signed QR or e-way bill number. Nothing is reported to GSTN. For set-up, training and tests.',
    configFields: [{ name: 'reportingWindowDays', label: 'Reporting window (days) for the sandbox check', help: 'Default 30' }],
    secrets: [],
    operations: {
      searchGstin: {
        validate: (p) => (p && typeof p.gstin === 'string' ? [] : [{ field: 'gstin', message: 'Give a GSTIN.' }]),
        async run(_ctx, p) { const st = gstinStatus(p.gstin); if (!st) throw refuse('3028', 'GSTIN is invalid.'); return { httpStatus: 200, data: { Gstin: p.gstin, Status: st, StateCode: p.gstin.slice(0, 2), LegalName: p.legalName ?? null, Sandbox: true } }; },
      },
      generateIrn: {
        validate: (p) => einvoiceProblems(p?.json),
        async run(ctx, p) {
          const j = p.json; const dt = fromDdMm(j.DocDtls.Dt); const today = istDate(now()); const win = Number(ctx.config?.reportingWindowDays ?? p.windowDays ?? 30);
          if (dt > today) throw refuse('2163', 'The document date cannot be after today.');
          if (p.windowApplies && daysBetween(dt, today) > win) throw refuse('2283', `A document older than ${win} days cannot be reported by a taxpayer with AATO of ₹10 crore or more.`);
          const irn = irnOf(j.SellerDtls.Gstin, fyOf(dt), j.DocDtls.Typ, j.DocDtls.No);
          if (irns.has(irn)) { const x = irns.get(irn); throw new ProviderError('2150: Duplicate IRN', { retryable: false, httpStatus: 400, response: { status: 0, errorDetails: [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }], InfoDtls: [{ InfCd: 'DUPIRN', Desc: { Irn: irn, AckNo: x.ackNo, AckDt: x.ackDt } }] } }); }
          ack += 1; const ackNo = `${String(now()).slice(-9)}${String(ack).padStart(6, '0')}`.slice(-15); const ackDt = istStamp(now());
          const items = j.ItemList; const main = [...items].sort((a, b) => Number(b.AssAmt) - Number(a.AssAmt))[0];
          const qr = jwt({ data: JSON.stringify({ SellerGstin: j.SellerDtls.Gstin, BuyerGstin: j.BuyerDtls.Gstin, DocNo: j.DocDtls.No, DocTyp: j.DocDtls.Typ, DocDt: j.DocDtls.Dt, TotInvVal: Number(j.ValDtls.TotInvVal), ItemCnt: items.length, MainHsnCode: main.HsnCd, Irn: irn, IrnDt: ackDt }), iss: 'SANDBOX-IRP' });
          irns.set(irn, { ackNo, ackDt, at: now(), cancelled: false });
          return { httpStatus: 200, data: { AckNo: ackNo, AckDt: ackDt, Irn: irn, SignedInvoice: jwt({ data: JSON.stringify({ Irn: irn, AckNo: ackNo }), iss: 'SANDBOX-IRP' }), SignedQRCode: qr, Status: 'ACT', Sandbox: true } };
        },
      },
      cancelIrn: {
        validate: (p) => (p && /^[0-9a-f]{64}$/.test(String(p.Irn)) && ['1', '2', '3', '4'].includes(String(p.CnlRsn)) && String(p.CnlRem ?? '').trim().length >= 3 ? [] : [{ field: 'Irn', message: 'Give the IRN, a reason (1 to 4) and a remark.' }]),
        async run(_ctx, p) {
          const x = irns.get(p.Irn); if (!x) throw refuse('2154', 'The IRN does not exist.'); if (x.cancelled) throw refuse('9999', 'The IRN is already cancelled.');
          if (now() - x.at > (p.cancelHours ?? 24) * 3600_000) throw refuse('2270', 'An IRN is cancelled within 24 hours of its generation.');
          x.cancelled = true; return { httpStatus: 200, data: { Irn: p.Irn, CancelDate: istStamp(now()), Sandbox: true } };
        },
      },
      generateEwb: {
        validate: (p) => { const q = []; if (!p || gstinProblem(String(p.fromGstin ?? ''))) q.push({ field: 'fromGstin', message: 'The consignor GSTIN is not valid.' }); if (p?.toGstin && p.toGstin !== 'URP' && gstinProblem(String(p.toGstin))) q.push({ field: 'toGstin', message: 'The consignee GSTIN is not valid.' }); if (!/^[1-9]\d{5}$/.test(String(p?.fromPincode ?? '')) || !/^[1-9]\d{5}$/.test(String(p?.toPincode ?? ''))) q.push({ field: 'pincode', message: 'The PIN codes have 6 digits.' }); if (!(Number(p?.transDistance) >= 1 && Number(p?.transDistance) <= 4000)) q.push({ field: 'transDistance', message: 'The distance is 1 to 4000 km.' }); if (!/^\d{4,8}$/.test(String(p?.hsnCode ?? ''))) q.push({ field: 'hsnCode', message: 'The HSN code has 4 to 8 digits.' }); if (p?.vehicleNo && !/^[A-Z]{2}[0-9A-Z]{2,4}[A-Z]{0,3}[0-9]{4}$|^TMP[0-9A-Z]{6,12}$/.test(String(p.vehicleNo))) q.push({ field: 'vehicleNo', message: 'The vehicle number is not in the format of a registration number (KA01AB1234).' }); return q; },
        async run(_ctx, p) {
          const key = `${p.fromGstin}|${p.docType}|${String(p.docNo).toUpperCase()}`; if (ewbDocs.has(key) && !ewbs.get(ewbDocs.get(key)).cancelled) throw refuse('604', 'An e-way bill already exists for this document.');
          const dt = p.docDate; const today = istDate(now()); if (dt > today) throw refuse('214', 'The document date cannot be after today.'); if (daysBetween(dt, today) > Number(p.maxDocAgeDays ?? 180)) throw refuse('2190', `A document older than ${p.maxDocAgeDays ?? 180} days cannot be used to generate an e-way bill.`);
          ewbSeq += 1; const no = `${(String(now()).slice(-6) + String(ewbSeq).padStart(6, '0')).slice(-12)}`.replace(/^0/, '1');
          const at = new Date(now()).toISOString(); const validUpto = p.vehicleNo ? endOfIstDay(at, validityDays(p.transDistance, p.kmPerDay ?? 200)) : null;
          ewbs.set(no, { at: now(), validUpto, cancelled: false, docKey: key, km: Number(p.transDistance), kmPerDay: p.kmPerDay ?? 200 }); ewbDocs.set(key, no);
          return { httpStatus: 200, data: { ewayBillNo: no, ewayBillDate: istStamp(now()), validUpto, sandbox: true } };
        },
      },
      updatePartB: {
        validate: (p) => (p && /^\d{12}$/.test(String(p.ewbNo)) && /^[A-Z0-9]{6,15}$/.test(String(p.vehicleNo ?? '')) ? [] : [{ field: 'vehicleNo', message: 'Give the e-way bill number and the vehicle number.' }]),
        async run(_ctx, p) { const x = ewbs.get(String(p.ewbNo)); if (!x || x.cancelled) throw refuse('312', 'The e-way bill does not exist or is cancelled.'); if (x.validUpto && Date.parse(x.validUpto) < now()) throw refuse('338', 'The e-way bill has expired; extend it.'); if (!x.validUpto) x.validUpto = endOfIstDay(new Date(now()).toISOString(), validityDays(x.km, x.kmPerDay)); return { httpStatus: 200, data: { vehUpdDate: istStamp(now()), validUpto: x.validUpto, sandbox: true } }; },
      },
      extendEwb: {
        validate: (p) => (p && /^\d{12}$/.test(String(p.ewbNo)) && Number(p.remainingDistance) >= 1 ? [] : [{ field: 'remainingDistance', message: 'Give the e-way bill number and the distance left.' }]),
        async run(_ctx, p) {
          const x = ewbs.get(String(p.ewbNo)); if (!x || x.cancelled) throw refuse('312', 'The e-way bill does not exist or is cancelled.'); if (!x.validUpto) throw refuse('339', 'Part B is not entered.');
          const win = (p.windowHours ?? 8) * 3600_000; const end = Date.parse(x.validUpto); if (now() < end - win || now() > end + win) throw refuse('317', `An e-way bill is extended within ${p.windowHours ?? 8} hours before or after it expires.`);
          const next = endOfIstDay(new Date(Math.max(now(), end)).toISOString(), validityDays(p.remainingDistance, p.kmPerDay ?? 200)); const cap = x.at + (p.capDays ?? 360) * 86_400_000;
          if (Date.parse(next) > cap) throw refuse('4021', `An e-way bill is not extended beyond ${p.capDays ?? 360} days from its generation.`);
          x.validUpto = next; return { httpStatus: 200, data: { validUpto: next, updatedDate: istStamp(now()), sandbox: true } };
        },
      },
      get2b: {
        validate: (p) => (p && !gstinProblem(String(p.gstin ?? '')) && /^(0[1-9]|1[0-2])\d{4}$/.test(String(p.rtnprd ?? '')) ? [] : [{ field: 'rtnprd', message: 'Give the GSTIN and the return period (MMYYYY).' }]),
        async run(_ctx, p) { const doc = SANDBOX_2B.get(`${p.gstin}|${p.rtnprd}`) ?? { b2b: [], cdnr: [] }; return { httpStatus: 200, data: { data: { gstin: p.gstin, rtnprd: p.rtnprd, gendt: istDate(now()).split('-').reverse().join('-'), docdata: doc }, Sandbox: true } }; },
      },
      cancelEwb: {
        validate: (p) => (p && /^\d{12}$/.test(String(p.ewbNo)) && ['1', '2', '3', '4'].includes(String(p.cancelRsnCode)) ? [] : [{ field: 'cancelRsnCode', message: 'Give the e-way bill number and a reason (1 to 4).' }]),
        async run(_ctx, p) { const x = ewbs.get(String(p.ewbNo)); if (!x) throw refuse('312', 'The e-way bill does not exist.'); if (x.cancelled) throw refuse('315', 'The e-way bill is already cancelled.'); if (now() - x.at > (p.cancelHours ?? 24) * 3600_000) throw refuse('315', 'An e-way bill is cancelled within 24 hours of its generation.'); x.cancelled = true; return { httpStatus: 200, data: { ewayBillNo: p.ewbNo, cancelDate: istStamp(now()), sandbox: true } }; },
      },
    },
    async health() { return { message: 'GST sandbox ready (nothing is reported to GSTN).' }; },
    sample: { operation: 'searchGstin', payload: () => ({ gstin: '36AAACR5055K1Z5' }) },
  };
}

// ---- D-731: the encrypted API of the IRP and of the e-way bill system (direct, or through a GSP that passes it on) ----
// e-invoice: the credentials and a random 32-byte AppKey are sent RSA-encrypted with the IRP's public key; the answer carries the AuthToken and the
// session key (SEK) encrypted with the AppKey (AES-256-ECB). Each request is then {"Data": AES-256-ECB(SEK, JSON)} in Base64 and each answer's Data is
// decrypted with the SEK. e-way bills: the password and the AppKey are each RSA-encrypted; a request is {"action", "data": AES(SEK, Base64(JSON))} and the
// answer's data decrypts to Base64 JSON. The token is kept until ten minutes before it expires and fetched again once when the portal says it is invalid.
const aesEnc = (key, buf) => { const c = createCipheriv('aes-256-ecb', key, null); return Buffer.concat([c.update(buf), c.final()]); };
const aesDec = (key, buf) => { const d = createDecipheriv('aes-256-ecb', key, null); return Buffer.concat([d.update(buf), d.final()]); };
const rsaB64 = (pem, buf) => publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, buf).toString('base64');
const b64 = (x) => Buffer.from(x).toString('base64');
const sessions = new Map();
/** Forget the sessions (a test, or a key changed). */
export const resetGspSessions = () => sessions.clear();
const sessionKey = (ctx, kind) => `${kind}|${ctx.config.baseUrl}|${ctx.config.gstin}|${ctx.config.userName}|${ctx.secrets.client_id ?? ''}`;
const portalError = (d, what) => { const e = d?.ErrorDetails ?? d?.errorDetails ?? (d?.error ? [{ ErrorCode: d.error?.errorCodes ?? d.error, ErrorMessage: d.error?.message ?? String(d.error) }] : []); const first = Array.isArray(e) ? e[0] : e; const code = String(first?.ErrorCode ?? first?.errorCode ?? ''); const err = new ProviderError(`${code ? `${code}: ` : ''}${first?.ErrorMessage ?? first?.errorMessage ?? `${what} refused`}`, { retryable: false, httpStatus: 400, response: d }); return Object.assign(err, { code }); };
const tokenInvalid = (x) => /^(1005|238|GSP102)$/.test(String(x?.code ?? '')) || /invalid token|token expired/i.test(String(x?.message ?? ''));
const einvHeaders = (ctx, token = null) => ({ client_id: ctx.secrets.client_id ?? '', client_secret: ctx.secrets.client_secret ?? '', gstin: ctx.config.gstin ?? '', user_name: ctx.config.userName ?? '', ...(token ? { AuthToken: token } : {}) });
const ewbHeaders = (ctx, token = null) => ({ 'client-id': ctx.secrets.client_id ?? '', 'client-secret': ctx.secrets.client_secret ?? '', gstin: ctx.config.gstin ?? '', ...(token ? { authtoken: token } : {}) });
async function einvSession(ctx, force = false) {
  const k = sessionKey(ctx, 'EINV'); const now = Date.now(); const cur = sessions.get(k); if (cur && !force && cur.until > now) return cur;
  const appKey = randomBytes(32); const payload = { UserName: ctx.config.userName, Password: ctx.secrets.password ?? '', AppKey: appKey.toString('base64'), ForceRefreshAccessToken: Boolean(force) };
  const out = await httpJson(ctx, { path: ctx.config.authPath || '/eivital/v1.04/auth', headers: einvHeaders(ctx), body: { Data: rsaB64(ctx.config.publicKey, Buffer.from(b64(JSON.stringify(payload)))) } });
  const d = out.data ?? {}; if (String(d.Status) !== '1' || !d.Data?.Sek) throw portalError(d, 'The IRP authentication was');
  const s = { token: d.Data.AuthToken, sek: aesDec(appKey, Buffer.from(d.Data.Sek, 'base64')), until: (Date.parse(String(d.Data.TokenExpiry ?? '').replace(' ', 'T') + '+05:30') || now + 6 * 3600_000) - 600_000 };
  sessions.set(k, s); return s;
}
/** @param {any} ctx @param {{ method?: string, path: string, body?: any }} req */
async function einvCall(ctx, { method = 'POST', path, body = undefined }, retried = false) {
  const s = await einvSession(ctx);
  const out = await httpJson(ctx, { method, path, headers: einvHeaders(ctx, s.token), body: body === undefined ? undefined : { Data: aesEnc(s.sek, Buffer.from(JSON.stringify(body))).toString('base64') } });
  const d = out.data ?? {};
  if (String(d.Status) !== '1') { const e = portalError(d, 'The IRP'); if (!retried && tokenInvalid(e)) { sessions.delete(sessionKey(ctx, 'EINV')); await einvSession(ctx, true); return einvCall(ctx, { method, path, body }, true); } throw e; }
  const data = typeof d.Data === 'string' ? JSON.parse(aesDec(s.sek, Buffer.from(d.Data, 'base64')).toString('utf8')) : d.Data;
  return { httpStatus: out.httpStatus, data };
}
async function ewbSession(ctx, force = false) {
  const k = sessionKey(ctx, 'EWB'); const now = Date.now(); const cur = sessions.get(k); if (cur && !force && cur.until > now) return cur;
  const appKey = randomBytes(32);
  const out = await httpJson(ctx, { path: ctx.config.ewbAuthPath || '/ewaybillapi/v1.03/auth', headers: ewbHeaders(ctx), body: { action: 'ACCESSTOKEN', username: ctx.config.ewbUserName || ctx.config.userName, password: rsaB64(ctx.config.publicKey, Buffer.from(ctx.secrets.ewb_password || ctx.secrets.password || '')), app_key: rsaB64(ctx.config.publicKey, Buffer.from(appKey.toString('base64'))) } });
  const d = out.data ?? {}; if (String(d.status) !== '1' || !d.sek) throw portalError(d, 'The e-way bill authentication was');
  const s = { token: d.authtoken, sek: aesDec(appKey, Buffer.from(d.sek, 'base64')), until: now + 6 * 3600_000 - 600_000 }; sessions.set(k, s); return s;
}
async function ewbCall(ctx, { path, action, body }, retried = false) {
  const s = await ewbSession(ctx);
  const out = await httpJson(ctx, { path, headers: ewbHeaders(ctx, s.token), body: { action, data: aesEnc(s.sek, Buffer.from(b64(JSON.stringify(body)))).toString('base64') } });
  const d = out.data ?? {};
  if (String(d.status) !== '1') { const e = portalError(d, 'The e-way bill system'); if (!retried && tokenInvalid(e)) { sessions.delete(sessionKey(ctx, 'EWB')); await ewbSession(ctx, true); return ewbCall(ctx, { path, action, body }, true); } throw e; }
  const data = typeof d.data === 'string' ? JSON.parse(Buffer.from(aesDec(s.sek, Buffer.from(d.data, 'base64')).toString('utf8'), 'base64').toString('utf8')) : d.data;
  return { httpStatus: out.httpStatus, data };
}

const publicKeyProblem = (pem) => { try { createPublicKey(String(pem ?? '')); return null; } catch { return 'publicKey must be the public key (PEM) of the IRP / e-way bill system from its portal.'; } };
/** An authorised GSP/ASP's JSON API: the operations are posted to configurable paths with the client id and secret; the GSP answers in the IRP's own fields. */
export function httpGsp() {
  const path = (ctx, k, d) => ctx.config[k] || d;
  const headers = (ctx) => ({ 'client-id': ctx.secrets.client_id ?? '', 'client-secret': ctx.secrets.client_secret ?? '', 'user-name': ctx.config.userName ?? '', password: ctx.secrets.password ?? '', gstin: ctx.config.gstin ?? '' });
  const encrypted = (ctx) => String(ctx.config.encryption ?? 'NONE').toUpperCase() === 'IRP';
  /** An operation: plain JSON to the GSP, or (encryption IRP, D-731) the portal's encrypted session; `action` marks an e-way bill call. */
  const op = (k, d, validate = undefined, action = null) => ({ validate, run: (ctx, p) => (!encrypted(ctx) ? httpJson(ctx, { path: path(ctx, k, d), headers: headers(ctx), body: p.json ?? p }) : action ? ewbCall(ctx, { path: path(ctx, k, d), action, body: p.json ?? p }) : einvCall(ctx, { path: path(ctx, k, d), body: p.json ?? p })) });
  return {
    type: 'gsp', provider: 'gsp_http', label: 'Authorised GSP / ASP (JSON API)',
    description: 'Calls the e-invoice and e-way bill API of a GST Suvidha Provider with its client id and secret and the taxpayer\'s API user. With encryption IRP the portal\'s AES/RSA session is made here (D-731); production use still needs the GSP\'s (or the IRP\'s) certification of this client.',
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true }, { name: 'gstin', label: 'GSTIN of the API user', required: true }, { name: 'userName', label: 'API user name', required: true }, { name: 'irnPath', label: 'Generate IRN path', help: 'Default /einvoice/v1.03/invoice' }, { name: 'cancelIrnPath', label: 'Cancel IRN path', help: 'Default /einvoice/v1.03/invoice/cancel' }, { name: 'ewbPath', label: 'Generate e-way bill path', help: 'Default /ewaybill/v1.03/ewayapi/genewaybill' }, { name: 'partBPath', label: 'Vehicle update path' }, { name: 'extendPath', label: 'Extension path' }, { name: 'cancelEwbPath', label: 'Cancel e-way bill path' }, { name: 'gstinPath', label: 'GSTIN search path', help: 'Default /einvoice/v1.03/Master/gstin' }, { name: 'gstr2bPath', label: 'GSTR-2B path', help: 'Default /gstr2b/v1.0/get (D-735)' }, { name: 'encryption', label: 'Encryption', help: 'NONE: the GSP takes plain JSON and encrypts for the portal. IRP: the AES/RSA session of the IRP and the e-way bill system is made here (D-731).' }, { name: 'publicKey', label: 'Public key of the IRP / e-way bill system (PEM)', help: 'Needed for encryption IRP' }, { name: 'authPath', label: 'IRP authentication path', help: 'Default /eivital/v1.04/auth' }, { name: 'ewbAuthPath', label: 'E-way bill authentication path', help: 'Default /ewaybillapi/v1.03/auth' }, { name: 'ewbUserName', label: 'E-way bill API user (if not the e-invoice one)' }],
    secrets: [{ name: 'client_id', label: 'Client id', required: true }, { name: 'client_secret', label: 'Client secret', required: true }, { name: 'password', label: 'API user password', required: true }, { name: 'ewb_password', label: 'E-way bill API user password (if not the e-invoice one)' }],
    validateConfig: (c, env) => [endpointProblem(String(c.baseUrl ?? ''), env), /^[0-9]{2}[A-Z0-9]{13}$/.test(String(c.gstin ?? '')) ? null : 'gstin must be the 15-character GSTIN of the API user.', !['NONE', 'IRP', ''].includes(String(c.encryption ?? '').toUpperCase()) ? 'encryption is NONE (the GSP encrypts) or IRP (the portal\'s AES/RSA session here).' : null, String(c.encryption ?? '').toUpperCase() === 'IRP' ? publicKeyProblem(c.publicKey) : null].filter(Boolean),
    operations: {
      searchGstin: { run: (ctx, p) => (encrypted(ctx) ? einvCall(ctx, { method: 'GET', path: `${path(ctx, 'gstinPath', '/eivital/v1.04/Master/gstin')}/${encodeURIComponent(p.gstin)}` }) : httpJson(ctx, { method: 'GET', path: `${path(ctx, 'gstinPath', '/einvoice/v1.03/Master/gstin')}?param1=${encodeURIComponent(p.gstin)}`, headers: headers(ctx) })) },
      generateIrn: op('irnPath', '/einvoice/v1.03/invoice', (p) => einvoiceProblems(p?.json)),
      cancelIrn: op('cancelIrnPath', '/einvoice/v1.03/invoice/cancel'),
      generateEwb: op('ewbPath', '/ewaybill/v1.03/ewayapi/genewaybill', undefined, 'GENEWAYBILL'),
      updatePartB: op('partBPath', '/ewaybill/v1.03/ewayapi/vehewb', undefined, 'VEHEWB'),
      extendEwb: op('extendPath', '/ewaybill/v1.03/ewayapi/extendvalidity', undefined, 'EXTENDVALIDITY'),
      cancelEwb: op('cancelEwbPath', '/ewaybill/v1.03/ewayapi/canewb', undefined, 'CANEWB'),
      get2b: { run: (ctx, p) => httpJson(ctx, { method: 'GET', path: `${path(ctx, 'gstr2bPath', '/gstr2b/v1.0/get')}?gstin=${encodeURIComponent(p.gstin)}&rtnprd=${encodeURIComponent(p.rtnprd)}`, headers: headers(ctx) }) }, // D-735
    },
    health: async (ctx) => { const out = await httpJson(ctx, { method: 'GET', path: ctx.config.healthPath || '/health', headers: headers(ctx) }); return { message: `GSP answered HTTP ${out.httpStatus}.` }; },
  };
}
