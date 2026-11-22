import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { filesOf } from '../../platform/files/registry.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { billOf } from '../bill/index.js';
import { parseViCreate } from '../bill/validators.js';
import { ctrOf } from '../ctr/index.js';
import { parseClause } from '../ctr/validators.js';
import { documentsOf } from '../eng/documents.js';
import { enggOf } from '../engg/drawings.js';
import { parseLetterCreate } from '../engg/validators.js';
import { createBase, nowIso } from '../proc/base.js';

/**
 * Part 28.04 — document and contract intelligence.
 *
 * FR-01 every clean upload (the `core.file.available` event of the file service) of a supported type is queued for text extraction: the text
 * layer of a PDF (pdfjs), plain text, and scanned images through a local OCR engine when one is installed (`tesseract.js`, optional — see
 * D-786). The text is kept with the extraction and searchable.
 * FR-03 the text is classified (invoice, certificate, letter, contract, other) from weighted cues, and compared with earlier documents of the
 * company: the same bytes are a duplicate, a 64-bit SimHash of word shingles within 8 bits (a company parameter) a near-duplicate.
 * FR-02 extractors suggest fields with a confidence and the place in the text they came from: vendor invoice header (GSTIN with its check
 * digit, number, date, amounts), certificate number, issuer and expiry, letter reference, date, subject and sender, contract clauses with a
 * category and time-bar.
 * FR-04, BR-01 nothing is applied by itself: a person reviews the suggestions next to the document, edits or confirms them — a field below the
 * confidence threshold must be confirmed or edited — and accepting creates a DRAFT through the owner's own service with the person's rights:
 * a vendor invoice registration (22.06, source OCR), an inward letter (11.05), clauses in a contract's clause library (21.01), or the validity
 * date of the controlled document (04.10). Every accepted value is compared with its suggestion, which measures the accuracy (T-01).
 */

export const DI_FLAG = 'ff.ai.p2804';
export const DI_TYPES = Object.freeze({ INVOICE: 'Vendor invoice', CERTIFICATE: 'Certificate', LETTER: 'Letter', CONTRACT: 'Contract', OTHER: 'Other document' });
export const DI_STATUSES = Object.freeze(['EXTRACTED', 'NO_TEXT', 'ACCEPTED', 'REJECTED', 'FAILED']);
const SUPPORTED = new Set(['pdf', 'txt', 'png', 'jpg', 'jpeg']);
const IMAGES = new Set(['png', 'jpg', 'jpeg']);
const SLA_HOURS = 48;
for (const [key, def, description, min, max, type] of [
  ['ai.docintel.confirm_below', 0.85, 'BR-01: a suggested field with a confidence below this must be confirmed or edited before it is accepted.', 0.5, 0.99, 'decimal'],
  ['ai.docintel.near_dup_bits', 8, 'FR-03: two documents whose SimHash differ in at most this many of 64 bits are near-duplicates (short business documents: one changed word moves about 5 bits; another invoice of the same vendor about 30).', 0, 20, 'integer'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description, min, max });

const shape = { type: 'object', additionalProperties: true };
eventTypes.define({ type: 'ai.docintel.extracted', version: 1, schema: shape, owner: 'ai', description: 'Text and suggestions were extracted from a document (part 28.04): data { fileId, docType, duplicateOf }.' });
eventTypes.define({ type: 'ai.docintel.applied', version: 1, schema: shape, owner: 'ai', description: 'A reviewed extraction created a draft in its module (part 28.04): data { docType, entity, ids }.' });
eventTypes.define({ type: 'ai.docintel.rejected', version: 1, schema: shape, owner: 'ai', description: 'A person rejected the suggestions of a document (part 28.04).' });

// ------------------------------------------------------------------------------------------------------------------- text (FR-01)
const require = createRequire(import.meta.url);
let pdfjsP = null;
const pdfjs = () => (pdfjsP ??= import('pdfjs-dist/legacy/build/pdf.mjs'));
let ocrP = null;
/** The optional local OCR engine for scanned images; null when it is not installed. */
async function ocrEngine() {
  ocrP ??= (async () => {
    try {
      const names = ['tesseract.js', '@tesseract.js-data/eng']; // optional packages: absent unless the server installs them (D-786)
      const [{ createWorker }, data] = await Promise.all(names.map((n) => import(n)));
      const eng = data.default ?? data;
      return await createWorker('eng', 1, { langPath: eng.langPath, gzip: eng.gzip, cachePath: join(process.cwd(), 'data', 'ocr-cache') });
    } catch { return null; }
  })();
  return ocrP;
}
/** The text of a file: { text, engine, pages, confidence } — engine PDF_TEXT, TEXT, OCR or NONE (with a reason). */
export async function textOf(buffer, ext) {
  const e = String(ext).toLowerCase();
  if (e === 'txt') return { text: buffer.toString('utf8'), engine: 'TEXT', pages: 1, confidence: 1 };
  if (e === 'pdf') {
    const lib = await pdfjs();
    const fonts = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
    const doc = await lib.getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, disableFontFace: true, standardFontDataUrl: fonts }).promise;
    const parts = [];
    for (let i = 1; i <= Math.min(doc.numPages, 50); i += 1) {
      const tc = await (await doc.getPage(i)).getTextContent();
      parts.push(tc.items.map((x) => `${x.str}${x.hasEOL ? '\n' : ' '}`).join('').replace(/[ \t]+\n/g, '\n'));
    }
    await doc.destroy();
    const text = parts.join('\n').trim();
    if (text.length >= 20) return { text, engine: 'PDF_TEXT', pages: doc.numPages, confidence: 1 };
    return { text: '', engine: 'NONE', pages: doc.numPages, confidence: 0, reason: 'The PDF has no text layer (a scan); OCR of scanned pages needs the local OCR engine (D-786).' };
  }
  if (IMAGES.has(e)) {
    const w = await ocrEngine();
    if (!w) return { text: '', engine: 'NONE', pages: 1, confidence: 0, reason: 'Scanned image: the local OCR engine is not installed on this server (D-786).' };
    const r = await w.recognize(buffer);
    return { text: r.data.text.trim(), engine: 'OCR', pages: 1, confidence: Math.round(r.data.confidence) / 100 };
  }
  return { text: '', engine: 'NONE', pages: 0, confidence: 0, reason: `Files of type .${e} are not read.` };
}

// ------------------------------------------------------------------------------------------------------------------- classification (FR-03)
/** @type {Record<string, [RegExp, number][]>} */
const CUES = {
  INVOICE: [[/tax\s+invoice/i, 3], [/invoice\s*(no|number|#)/i, 2], [/\bgstin\b/i, 1], [/\bhsn\b/i, 1], [/\b(cgst|sgst|igst)\b/i, 1], [/taxable\s+value/i, 2], [/(grand\s+total|amount\s+payable)/i, 1]],
  CERTIFICATE: [[/certificate/i, 3], [/(certify|certified)\s+that/i, 2], [/(valid\s+(up\s?to|until|till)|expiry|expires|validity)/i, 2], [/(test\s+report|calibration|conformity)/i, 1], [/issued\s+by/i, 1]],
  LETTER: [[/\b(subject|sub)\s*[:.-]/i, 2], [/dear\s+(sir|madam|sirs)/i, 2], [/yours\s+(faithfully|sincerely|truly)/i, 2], [/\b(our|your)?\s*ref(erence)?\.?\s*(no)?\s*[:.]/i, 1], [/with\s+reference\s+to/i, 1]],
  CONTRACT: [[/\bagreement\b/i, 2], [/\bclause\b/i, 2], [/hereinafter/i, 2], [/\bwhereas\b/i, 2], [/liquidated\s+damages/i, 2], [/arbitration/i, 1], [/\bparties\b/i, 1]],
};
export function classify(text) {
  const scores = Object.fromEntries(Object.entries(CUES).map(([t, cues]) => [t, cues.reduce((s, [re, w]) => s + (re.test(text) ? w : 0), 0)]));
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, best] = ranked[0]; const total = ranked.reduce((s, [, v]) => s + v, 0);
  if (best < 3) return { type: 'OTHER', confidence: 0.5, scores };
  return { type: top, confidence: Math.round(Math.min(0.99, 0.5 + 0.5 * (best / total) * Math.min(1, best / 6)) * 100) / 100, scores };
}

// ------------------------------------------------------------------------------------------------------------------- extraction (FR-02)
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE_RE = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/;
/** An Indian date (dd-mm-yyyy, dd/mm/yyyy, 14 Nov 2026) or an ISO one, as YYYY-MM-DD; null when it is not a real date. */
export function parseDate(s) {
  const m = DATE_RE.exec(s); if (!m) return null;
  let y; let mo; let d;
  if (m[1]) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (m[4]) [d, mo, y] = [Number(m[4]), Number(m[5]), Number(m[6])];
  else { d = Number(m[7]); mo = MONTHS[m[8].toLowerCase().slice(0, m[8].toLowerCase().startsWith('sept') ? 4 : 3)]; y = Number(m[9]); }
  if (!mo || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}
/** An amount written the Indian way (1,18,000.00, Rs. 5,000/-) in rupees. */
export const parseAmount = (s) => { const v = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; };
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** The GSTIN check digit (the 15th character) per the GSTN algorithm. */
export function gstinValid(g) {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(g)) return false;
  let sum = 0; for (let i = 0; i < 14; i += 1) { const p = B36.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return B36[(36 - (sum % 36)) % 36] === g[14];
}
const field = (value, confidence, m, text, label) => ({ value, confidence: Math.round(confidence * 100) / 100, start: m ? m.index : null, end: m ? m.index + m[0].length : null, label, quote: m ? text.slice(m.index, m.index + m[0].length).slice(0, 160) : null });
const find = (re, text) => { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`); let last = null; let m; while ((m = g.exec(text))) { last = m; if (!m[0].length) g.lastIndex += 1; } return last; };
const first = (re, text) => re.exec(text);
const COMPANY = /^[^\n]{0,60}\b(Pvt\.?\s*Ltd\.?|Private\s+Limited|Limited|Ltd\.?|LLP|Traders|Enterprises|Industries|Constructions?|Infra(?:structure)?|Agencies|& Co\.?)\b[^\n]{0,30}$/im;
const DATE_SRC = DATE_RE.source;

function invoiceFields(text) {
  const f = {};
  const g = first(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d])\b/, text);
  if (g) f.vendorGstin = field(g[1], gstinValid(g[1]) ? 0.97 : 0.6, g, text, 'Vendor GSTIN');
  const no = first(/(?:invoice|bill|inv)\.?\s*(?:no|number|#)\.?\s*[:-]?\s*([A-Z0-9][A-Z0-9/-]{2,39})/i, text);
  if (no) f.invoiceNo = field(no[1], 0.92, no, text, 'Invoice number');
  const dl = first(new RegExp(`(?:invoice|bill)\\s*date\\s*[:\\-]?\\s*(${DATE_SRC})`, 'i'), text) ?? first(new RegExp(`\\bdate\\s*[:\\-]?\\s*(${DATE_SRC})`, 'i'), text);
  const anyDate = dl ? null : first(new RegExp(DATE_SRC), text);
  if (dl && parseDate(dl[1])) f.invoiceDate = field(parseDate(dl[1]), /invoice|bill/i.test(dl[0]) ? 0.92 : 0.8, dl, text, 'Invoice date');
  else if (anyDate && parseDate(anyDate[0])) f.invoiceDate = field(parseDate(anyDate[0]), 0.6, anyDate, text, 'Invoice date');
  const amt = '(?:rs\\.?|inr|₹)?\\s*([\\d,]+(?:\\.\\d{1,2})?)';
  const total = find(new RegExp(`(?:grand\\s+total|invoice\\s+total|amount\\s+payable|total\\s+amount)\\s*[:\\-]?\\s*${amt}`, 'i'), text) ?? find(new RegExp(`\\btotal\\s*[:\\-]?\\s*${amt}`, 'i'), text);
  if (total) f.total = field(parseAmount(total[1]), /grand|payable|invoice|amount/i.test(total[0]) ? 0.9 : 0.72, total, text, 'Invoice total (₹)');
  const taxable = find(new RegExp(`(?:taxable\\s+value|sub\\s*-?\\s*total|taxable\\s+amount)\\s*[:\\-]?\\s*${amt}`, 'i'), text);
  if (taxable) f.taxable = field(parseAmount(taxable[1]), 0.88, taxable, text, 'Taxable value (₹)');
  const taxes = ['igst', 'cgst', 'sgst'].map((k) => find(new RegExp(`\\b${k}\\b[^\\n\\d]{0,20}(?:\\d{1,2}(?:\\.\\d+)?\\s*%)?[^\\n\\d]{0,10}${amt}`, 'i'), text)).filter(Boolean);
  if (taxes.length) f.gst = field(Math.round(taxes.reduce((s, m) => s + parseAmount(m[1]), 0) * 100) / 100, 0.8, taxes[0], text, 'GST (₹)');
  const head = text.slice(0, g ? Math.max(0, g.index) + 1 : 400);
  const vendor = first(COMPANY, head) ?? first(COMPANY, text);
  if (vendor) f.vendorName = field(vendor[0].trim().replace(/\s{2,}/g, ' '), 0.7, vendor, text, 'Vendor');
  if (f.total && f.taxable && f.gst) { const ok = Math.abs(f.taxable.value + f.gst.value - f.total.value) <= 1; for (const k of ['total', 'taxable', 'gst']) f[k].confidence = Math.round(Math.min(0.99, f[k].confidence + (ok ? 0.07 : -0.2)) * 100) / 100; }
  return f;
}
function certificateFields(text) {
  const f = {};
  const no = first(/certificate\s*(?:no|number)\.?\s*[:-]?\s*([A-Z0-9][A-Z0-9/-]{2,39})/i, text);
  if (no) f.certificateNo = field(no[1], 0.9, no, text, 'Certificate number');
  const by = first(/(?:issued\s+by|issuing\s+authority)\s*[:-]?\s*([^\n]{3,120})/i, text);
  if (by) f.issuedBy = field(by[1].trim(), 0.85, by, text, 'Issued by');
  const until = first(new RegExp(`(?:valid\\s+(?:up\\s?to|until|till)|expir(?:y|es)(?:\\s+date|\\s+on)?|validity(?:\\s+up\\s?to)?)\\s*[:\\-]?\\s*(${DATE_SRC})`, 'i'), text);
  if (until && parseDate(until[1])) f.validUntil = field(parseDate(until[1]), 0.93, until, text, 'Valid until');
  const issued = first(new RegExp(`(?:date\\s+of\\s+issue|issued\\s+on|issue\\s+date)\\s*[:\\-]?\\s*(${DATE_SRC})`, 'i'), text);
  if (issued && parseDate(issued[1])) f.issuedOn = field(parseDate(issued[1]), 0.88, issued, text, 'Issued on');
  return f;
}
/** @type {[RegExp, string][]} */
const LETTER_CAT = [[/\bnotice\b/i, 'NOTICE'], [/\binstruct/i, 'INSTRUCTION'], [/\bpayment|invoice|bill\b/i, 'PAYMENT'], [/\bapprov/i, 'APPROVAL'], [/\b(query|clarif)/i, 'QUERY']];
function letterFields(text) {
  const f = {};
  const ref = first(/(?:our|your)?\s*ref(?:erence)?\.?\s*(?:no)?\.?\s*[:-]\s*([A-Z0-9][A-Z0-9/\-.]{2,59})/i, text);
  if (ref) f.theirRef = field(ref[1], 0.88, ref, text, 'Their reference');
  const dl = first(new RegExp(`\\bdate[d]?\\s*[:\\-]?\\s*(${DATE_SRC})`, 'i'), text) ?? first(new RegExp(DATE_SRC), text);
  const iso = dl ? parseDate(dl[1] ?? dl[0]) : null;
  if (iso) f.letterDate = field(iso, /date/i.test(dl[0]) ? 0.9 : 0.7, dl, text, 'Letter date');
  const sub = first(/\b(?:subject|sub)\s*[:.-]\s*([^\n]{3,300})/i, text);
  if (sub) f.subject = field(sub[1].trim(), 0.93, sub, text, 'Subject');
  const from = first(/^\s*from\s*[:-]\s*([^\n]{2,160})/im, text) ?? first(COMPANY, text.slice(0, 500));
  if (from) f.party = field((from[1] ?? from[0]).trim(), from[1] ? 0.85 : 0.65, from, text, 'From (party)');
  const cat = LETTER_CAT.find(([re]) => re.test(sub?.[1] ?? text.slice(0, 600)));
  f.category = field(cat?.[1] ?? 'OTHER', cat ? 0.7 : 0.5, null, text, 'Category');
  return f;
}
/** @type {[RegExp, string][]} */
const CLAUSE_CAT = [[/liquidated\s+damages|\bLD\b/i, 'LD'], [/price\s+variation|escalation/i, 'PVC'], [/time[-\s]?bar|shall\s+be\s+barred/i, 'TIME_BAR'], [/variation|change\s+order|extra\s+item/i, 'VARIATION'],
  [/payment|retention|advance|interim\s+bill/i, 'PAYMENT'], [/terminat/i, 'TERMINATION'], [/arbitrat|dispute|conciliat/i, 'DISPUTE'], [/insurance/i, 'INSURANCE'], [/bank\s+guarantee|security\s+deposit|performance\s+security/i, 'SECURITY'], [/\bnotice\b/i, 'NOTICE']];
/** Contract clauses: numbered headings ("12.3 Payment terms", "Clause 21 - Arbitration") with their text, category and time-bar. */
export function contractClauses(text) {
  const re = /^\s*(?:clause\s+)?(\d{1,2}(?:\.\d{1,2}){0,2})[.):\-\s]+([A-Z][A-Za-z ,&/'()-]{2,80})\s*$/gm;
  const heads = []; let m; while ((m = re.exec(text))) heads.push({ no: m[1], title: m[2].trim(), at: m.index, end: m.index + m[0].length });
  return heads.map((h, i) => {
    const body = text.slice(h.end, heads[i + 1]?.at ?? Math.min(text.length, h.end + 3000)).trim().replace(/\s+/g, ' ');
    const cat = CLAUSE_CAT.find(([r]) => r.test(h.title)) ?? CLAUSE_CAT.find(([r]) => r.test(body)); // the heading names the clause; the text only when it does not
    const bar = /within\s+(\d{1,3})\s*(?:\(\w+\)\s*)?days/i.exec(body);
    const sentence = (body.match(/^[^.]{10,300}\./) ?? [body.slice(0, 300)])[0].trim();
    return { clauseNo: h.no, title: h.title, category: cat?.[1] ?? 'OTHER', summary: sentence || h.title, timeBarDays: bar ? Number(bar[1]) : null, confidence: cat ? 0.82 : 0.6, start: h.at, end: h.end };
  });
}
/** The suggestions for a type: { fields, clauses?, summary? }. */
export function extract(type, text) {
  if (type === 'INVOICE') return { fields: invoiceFields(text) };
  if (type === 'CERTIFICATE') return { fields: certificateFields(text) };
  if (type === 'LETTER') return { fields: letterFields(text) };
  if (type === 'CONTRACT') {
    const clauses = contractClauses(text); const by = {};
    for (const c of clauses) by[c.category] = (by[c.category] ?? 0) + 1;
    const ld = /liquidated\s+damages[^.]{0,120}?(\d+(?:\.\d+)?)\s*%/i.exec(text); const ret = /retention[^.]{0,80}?(\d+(?:\.\d+)?)\s*%/i.exec(text);
    const summary = `${clauses.length} clauses: ${Object.entries(by).map(([k, n]) => `${n} ${k.toLowerCase().replace('_', '-')}`).join(', ') || 'none found'}.${ld ? ` Liquidated damages ${ld[1]} %.` : ''}${ret ? ` Retention ${ret[1]} %.` : ''}`;
    return { fields: {}, clauses, summary };
  }
  return { fields: {} };
}

// ------------------------------------------------------------------------------------------------------------------- near-duplicates (FR-03)
const fnv = (s) => { let h = 0xcbf29ce484222325n; for (let i = 0; i < s.length; i += 1) { h ^= BigInt(s.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return h; };
/** A 64-bit SimHash (hex) of the word 3-shingles of a text; null for a text too short to compare. */
export function simhash(text) {
  const w = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (w.length < 8) return null;
  const v = Array(64).fill(0);
  for (let i = 0; i + 2 < w.length; i += 1) { const h = fnv(`${w[i]} ${w[i + 1]} ${w[i + 2]}`); for (let b = 0; b < 64; b += 1) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1; }
  let out = 0n; for (let b = 0; b < 64; b += 1) if (v[b] > 0) out |= 1n << BigInt(b);
  return out.toString(16).padStart(16, '0');
}
export const hamming = (a, b) => { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`); let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

// ------------------------------------------------------------------------------------------------------------------- the service
const services = new WeakMap();
export const docIntelOf = (db) => services.get(db) ?? null;
export function requireDocIntel(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, DI_FLAG)) throw notFound('Document intelligence is not enabled for this company.');
}

/** @param {any} context @param {{ jobs?: any, bus?: any }} [deps] */
export function createDocIntel(context, { jobs, bus } = {}) {
  const { db } = context;
  const base = createBase({ db });
  const authz = authzOf(db);
  const guard = (actor, key) => { requireDocIntel(context, actor); if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`); };
  const audit = (actor, id, action, extra = {}) => writeAudit(db, { companyId: actor.companyId, entity: 'di_extractions', entityId: String(id), action, actor: actor.user, ...extra });
  const threshold = (companyId) => Number(base.param(companyId, 'ai.docintel.confirm_below') ?? 0.85);
  const flagOn = (companyId) => { try { return context.flags.isOn({ companyId, user: 'system', roles: [] }, DI_FLAG); } catch { return false; } };

  /** Extract one file (the job, or on request): text, type, suggestions and duplicates; one extraction per file, refreshed while it is not reviewed. */
  async function process(fileId, by = 'system') {
    const files = filesOf(db); if (!files?.bytesOf) throw notFound('The file service is not installed.');
    const { file, companyId, projectId, siteId, buffer } = await files.bytesOf(fileId);
    const prior = db.prepare('SELECT * FROM di_extractions WHERE company_id = ? AND file_id = ? AND deleted_at IS NULL').get(companyId, file.id);
    if (prior && ['ACCEPTED', 'REJECTED'].includes(prior.status)) return prior;
    let t;
    try { t = await textOf(buffer, file.extension); } catch (e) { t = { text: '', engine: 'NONE', pages: 0, confidence: 0, reason: `The file could not be read: ${String(e?.message ?? e).slice(0, 200)}` }; }
    const cls = t.text ? classify(t.text) : { type: 'OTHER', confidence: 0, scores: {} };
    const sug = t.text ? extract(cls.type, t.text) : { fields: {} };
    const hash = t.text ? simhash(t.text) : null;
    const exact = db.prepare('SELECT x.id, x.file_id, f.original_name FROM di_extractions x JOIN core_files f ON f.id = x.file_id WHERE x.company_id = ? AND x.file_id <> ? AND x.sha256 = ? AND x.deleted_at IS NULL ORDER BY x.id LIMIT 1').get(companyId, file.id, file.sha256);
    let dup = exact ? { fileId: exact.file_id, name: exact.original_name, similarity: 1, kind: 'EXACT' } : null;
    if (!dup && hash) {
      const bits = Number(base.param(companyId, 'ai.docintel.near_dup_bits') ?? 8);
      for (const r of db.prepare('SELECT x.file_id, x.simhash, f.original_name FROM di_extractions x JOIN core_files f ON f.id = x.file_id WHERE x.company_id = ? AND x.file_id <> ? AND x.simhash IS NOT NULL AND x.doc_type = ? AND x.deleted_at IS NULL ORDER BY x.id DESC LIMIT 5000').all(companyId, file.id, cls.type)) {
        const d = hamming(hash, r.simhash); if (d <= bits) { dup = { fileId: r.file_id, name: r.original_name, similarity: Math.round((1 - d / 64) * 1000) / 1000, kind: 'NEAR' }; break; }
      }
    }
    const status = t.text ? 'EXTRACTED' : 'NO_TEXT';
    const row = transaction(db, () => {
      const stamp = nowIso();
      const vals = [cls.type, cls.confidence, t.engine, t.confidence, t.pages, t.text.slice(0, 200_000), hash, file.sha256, JSON.stringify(sug.fields), JSON.stringify(sug.clauses ?? []), sug.summary ?? null, dup?.fileId ?? null, dup ? JSON.stringify(dup) : null, status, t.reason ?? null, stamp];
      let id;
      if (prior) { db.prepare('UPDATE di_extractions SET doc_type = ?, class_confidence = ?, engine = ?, ocr_confidence = ?, pages = ?, text_content = ?, simhash = ?, sha256 = ?, fields_json = ?, clauses_json = ?, summary = ?, duplicate_of_file_id = ?, duplicate_json = ?, status = ?, reason = ?, extracted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...vals, by, stamp, prior.id); id = prior.id; }
      else {
        const docNo = base.number(companyId, by, 'AI_DOC_EXTRACTION', 'di_extractions', 'DIX');
        id = Number(db.prepare(`INSERT INTO di_extractions (company_id, doc_no, file_id, file_name, linked_entity, linked_id, doc_type, class_confidence, engine, ocr_confidence, pages, text_content, simhash, sha256, fields_json, clauses_json, summary, duplicate_of_file_id, duplicate_json, status, reason, extracted_at, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'core_files', ?)`).run(companyId, docNo, file.id, file.name, file.linkedEntity, file.linkedId, ...vals, projectId ?? null, siteId ?? null, by, String(file.id)).lastInsertRowid);
      }
      writeAudit(db, { companyId, entity: 'di_extractions', entityId: String(id), action: prior ? 're-extract' : 'extract', actor: by, newValues: { fileId: file.id, docType: cls.type, engine: t.engine, fields: Object.keys(sug.fields), duplicateOf: dup?.fileId ?? null } });
      publishEvent(db, { type: 'ai.docintel.extracted', entity: 'di_extractions', entityId: id, actorId: by, companyId, projectId: projectId ?? null, data: { fileId: file.id, docType: cls.type, duplicateOf: dup?.fileId ?? null } });
      return db.prepare('SELECT * FROM di_extractions WHERE id = ?').get(id);
    });
    return row;
  }

  // ---- views
  const visible = (actor, a = 'x') => authz.scopeFilter(actor, 'ai.docintel.view', { project: `${a}.project_id`, site: `${a}.site_id` }).sql;
  const ageHours = (x) => Math.max(0, Math.round((Date.now() - Date.parse(x.extracted_at)) / 3_600_000));
  const listView = (x) => {
    const f = JSON.parse(x.fields_json); const low = Object.values(f).filter((v) => v.confidence < 0.85).length; const h = ageHours(x);
    return { id: x.id, docNo: x.doc_no, fileId: x.file_id, fileName: x.file_name, docType: x.doc_type, docTypeLabel: DI_TYPES[x.doc_type], classConfidence: x.class_confidence, engine: x.engine, status: x.status,
      fields: Object.keys(f).length + JSON.parse(x.clauses_json).length, lowConfidence: low, duplicate: x.duplicate_json ? JSON.parse(x.duplicate_json) : null, extractedAt: x.extracted_at, ageHours: h,
      sla: ['ACCEPTED', 'REJECTED'].includes(x.status) ? null : h >= SLA_HOURS ? 'OVERDUE' : h >= SLA_HOURS / 2 ? 'DUE_SOON' : 'ON_TIME', projectId: x.project_id, reviewedBy: x.reviewed_by };
  };
  function row(actor, id) {
    const x = db.prepare(`SELECT * FROM di_extractions x WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL AND ${visible(actor)}`).get(Number(id), actor.companyId);
    if (!x) throw notFound('That extraction does not exist.');
    filesOf(db).get(actor, x.file_id); // the person must also be allowed to open the document itself
    return x;
  }
  const svc = {
    process,
    list(actor, { status = 'OPEN', docType = null, q = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'ai.docintel.view');
      const where = ['x.company_id = ?', 'x.deleted_at IS NULL', visible(actor)]; const params = [actor.companyId];
      if (status === 'OPEN') where.push("x.status IN ('EXTRACTED', 'NO_TEXT')"); else if (status !== 'ALL') { where.push('x.status = ?'); params.push(status); }
      if (docType) { where.push('x.doc_type = ?'); params.push(docType); }
      if (q) { where.push('(x.text_content LIKE ? OR x.file_name LIKE ? OR x.doc_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      const sql = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM di_extractions x WHERE ${sql}`).get(...params).n;
      // the queue: the oldest open work first (SLA age), then the least confident
      const rows = db.prepare(`SELECT x.* FROM di_extractions x WHERE ${sql} ORDER BY x.status IN ('EXTRACTED', 'NO_TEXT') DESC, x.extracted_at ASC, x.class_confidence ASC, x.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize).map(listView);
      const counts = Object.fromEntries(db.prepare(`SELECT x.doc_type AS t, COUNT(*) AS n FROM di_extractions x WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.status IN ('EXTRACTED', 'NO_TEXT') AND ${visible(actor)} GROUP BY x.doc_type`).all(actor.companyId).map((r) => [r.t, r.n]));
      return { rows, total, page, pageSize, open: counts, types: Object.entries(DI_TYPES).map(([code, label]) => ({ code, label })), canReview: hasPermissionAnywhere(actor, 'ai.docintel.review'), canRun: hasPermissionAnywhere(actor, 'ai.docintel.run'), threshold: threshold(actor.companyId) };
    },
    get(actor, id) {
      guard(actor, 'ai.docintel.view');
      const x = row(actor, id); const th = threshold(actor.companyId);
      const fields = Object.entries(JSON.parse(x.fields_json)).map(([key, v]) => ({ key, ...v, mustConfirm: v.confidence < th }));
      const clauses = JSON.parse(x.clauses_json).map((c, i) => ({ index: i, ...c, mustConfirm: c.confidence < th }));
      let preview; try { preview = filesOf(db).signedUrl(actor, x.file_id, { variant: 'original', download: false })?.url ?? null; } catch { preview = null; }
      const vendor = fields.find((f) => f.key === 'vendorGstin') ? db.prepare(`SELECT p.id, p.legal_name FROM mdm_partner_gstins g JOIN mdm_partners p ON p.id = g.partner_id WHERE g.company_id = ? AND g.gstin = ? AND g.deleted_at IS NULL LIMIT 1`).get(actor.companyId, fields.find((f) => f.key === 'vendorGstin').value) ?? null : null;
      const targets = targetsOf(actor, x, vendor);
      return { ...listView(x), text: x.text_content, summary: x.summary, reason: x.reason, fields, clauses, threshold: th, preview, vendor: vendor ? { id: vendor.id, name: vendor.legal_name } : null, targets, applied: x.applied_json ? JSON.parse(x.applied_json) : null,
        reviewNote: x.review_note, reviewedAt: x.reviewed_at, rowVersion: x.version, can: { review: hasPermissionAnywhere(actor, 'ai.docintel.review') && x.status === 'EXTRACTED', reject: hasPermissionAnywhere(actor, 'ai.docintel.review') && ['EXTRACTED', 'NO_TEXT'].includes(x.status), rerun: hasPermissionAnywhere(actor, 'ai.docintel.run') && !['ACCEPTED', 'REJECTED'].includes(x.status) } };
    },
    async extract(actor, fileId) {
      guard(actor, 'ai.docintel.run');
      const f = filesOf(db).get(actor, Number(fileId)); // the person may open the file
      if (!SUPPORTED.has(f.extension)) throw unprocessable(`Files of type .${f.extension} are not read; use PDF, text or an image.`);
      const r = await process(f.id, actor.user);
      return svc.get(actor, r.id);
    },
    accept(actor, id, b) {
      guard(actor, 'ai.docintel.review');
      const x = row(actor, id);
      if (x.status !== 'EXTRACTED') throw unprocessable('Only an extraction waiting for review is accepted.');
      if (b.rowVersion !== x.version) throw conflict('The extraction was changed (re-extracted or reviewed) by someone else. Reload it.');
      const th = threshold(actor.companyId); const sug = JSON.parse(x.fields_json); const values = { ...b.values };
      // BR-01: every low-confidence suggestion used as it is must be confirmed explicitly
      const unconfirmed = Object.entries(sug).filter(([k, v]) => v.confidence < th && (values[k] === undefined || String(values[k]) === String(v.value)) && !(b.confirmed ?? []).includes(k)).map(([k, v]) => v.label ?? k);
      if (unconfirmed.length && x.doc_type !== 'CONTRACT') throw unprocessable(`Confirm or correct the low-confidence fields first: ${unconfirmed.join(', ')}.`);
      const final = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(sug).map(([k, v]) => [k, v.value])), ...values }).filter(([, v]) => v !== '' && v != null));
      const applied = apply(actor, x, final, b);
      const changed = Object.entries(sug).filter(([k, v]) => final[k] !== undefined && String(final[k]) !== String(v.value)).map(([k]) => k);
      transaction(db, () => {
        db.prepare("UPDATE di_extractions SET status = 'ACCEPTED', final_json = ?, changed_json = ?, applied_json = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(JSON.stringify(final), JSON.stringify(changed), JSON.stringify(applied), actor.user, nowIso(), b.note ?? null, actor.user, nowIso(), x.id);
        audit(actor, x.id, 'accept', { oldValues: Object.fromEntries(Object.entries(sug).map(([k, v]) => [k, v.value])), newValues: { values: final, applied } });
        publishEvent(db, { type: 'ai.docintel.applied', entity: 'di_extractions', entityId: x.id, actorId: actor.user, companyId: actor.companyId, projectId: x.project_id ?? null, data: { docType: x.doc_type, entity: applied.entity, ids: applied.ids } });
      });
      return svc.get(actor, x.id);
    },
    reject(actor, id, { reason, rowVersion }) {
      guard(actor, 'ai.docintel.review');
      const x = row(actor, id);
      if (!['EXTRACTED', 'NO_TEXT'].includes(x.status)) throw unprocessable('This extraction was reviewed already.');
      if (rowVersion !== x.version) throw conflict('The extraction was changed by someone else. Reload it.');
      transaction(db, () => {
        db.prepare("UPDATE di_extractions SET status = 'REJECTED', reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), reason, actor.user, nowIso(), x.id);
        audit(actor, x.id, 'reject', { reason });
        publishEvent(db, { type: 'ai.docintel.rejected', entity: 'di_extractions', entityId: x.id, actorId: actor.user, companyId: actor.companyId, projectId: x.project_id ?? null, data: { docType: x.doc_type } });
      });
      return svc.get(actor, x.id);
    },
    /** T-01 in use: of the fields suggested on accepted documents, the share accepted unchanged, by type and field. */
    accuracy(actor) {
      guard(actor, 'ai.docintel.view');
      const by = {};
      for (const x of db.prepare(`SELECT x.doc_type, x.fields_json, x.changed_json FROM di_extractions x WHERE x.company_id = ? AND x.status = 'ACCEPTED' AND x.deleted_at IS NULL AND ${visible(actor)}`).all(actor.companyId)) {
        const changed = new Set(JSON.parse(x.changed_json ?? '[]'));
        for (const k of Object.keys(JSON.parse(x.fields_json))) { const key = `${x.doc_type}.${k}`; by[key] ??= { docType: x.doc_type, field: k, suggested: 0, unchanged: 0 }; by[key].suggested += 1; if (!changed.has(k)) by[key].unchanged += 1; }
      }
      const rows = Object.values(by).map((r) => ({ ...r, accuracyPct: Math.round((r.unchanged / r.suggested) * 1000) / 10 }));
      const s = rows.reduce((a, r) => a + r.suggested, 0); const u = rows.reduce((a, r) => a + r.unchanged, 0);
      return { rows, overallPct: s ? Math.round((u / s) * 1000) / 10 : null, suggested: s };
    },
    exportList(actor, q, format) {
      guard(actor, 'ai.docintel.view');
      const l = svc.list(actor, { ...q, page: 1, pageSize: 1000 });
      const columns = [['docNo', 'Extraction'], ['fileName', 'File'], ['docType', 'Type'], ['status', 'Status'], ['fields', 'Fields'], ['lowConfidence', 'To confirm'], ['duplicate', 'Duplicate of'], ['extractedAt', 'Extracted'], ['reviewedBy', 'Reviewed by']].map(([key, label]) => ({ key, label }));
      const rows = l.rows.map((r) => ({ ...r, docType: r.docTypeLabel, duplicate: r.duplicate ? `${r.duplicate.name} (${r.duplicate.kind.toLowerCase()})` : '', fields: String(r.fields), lowConfidence: String(r.lowConfidence), reviewedBy: r.reviewedBy ?? '' }));
      const buffer = writeExport(format, { columns, rows, title: 'Document extractions', sheetName: 'Extractions', footer: [`${l.total} extractions · filters ${JSON.stringify(q)} · no document text is exported`] });
      writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'ai.docintel', action: 'export', actor: actor.user, newValues: { format, q } });
      return { buffer, contentType: FORMATS[format], fileName: `document-extractions.${format}` };
    },
  };

  /** What accepting can create, for the review form: the project, the vendor's orders, the contracts, the controlled document. */
  function targetsOf(actor, x, vendor) {
    const projects = db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => base.may(actor, 'ai.docintel.view', p.id)).map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }));
    if (x.doc_type === 'INVOICE') {
      const pos = vendor ? db.prepare("SELECT id, doc_no, org_project_id FROM proc_purchase_orders WHERE company_id = ? AND vendor_id = ? AND deleted_at IS NULL AND status = 'APPROVED' ORDER BY id DESC LIMIT 50").all(actor.companyId, vendor.id).map((p) => ({ id: p.id, label: p.doc_no, projectId: p.org_project_id })) : [];
      return { kind: 'bill_vendor_invoices', label: 'Vendor invoice registration (22.06)', projects, orders: pos };
    }
    if (x.doc_type === 'LETTER') return { kind: 'engg_letters', label: 'Inward letter (11.05)', projects };
    if (x.doc_type === 'CONTRACT') {
      const contracts = ctrOf(db) ? db.prepare('SELECT id, contract_no, org_project_id FROM ctr_contracts WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 100').all(actor.companyId).filter((c) => base.may(actor, 'ctr.clause.manage', c.org_project_id)).map((c) => ({ id: c.id, label: c.contract_no })) : [];
      return { kind: 'ctr_clauses', label: 'Contract clause library (21.01)', contracts };
    }
    if (x.doc_type === 'CERTIFICATE') {
      const doc = x.linked_entity === 'doc_version' ? db.prepare('SELECT d.id, d.doc_no, d.title, d.valid_until FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ?').get(x.linked_id) : null;
      return { kind: 'doc_documents', label: 'Validity of the controlled document (04.10)', document: doc ? { id: doc.id, label: `${doc.doc_no} ${doc.title}`, validUntil: doc.valid_until } : null };
    }
    return { kind: null, label: null };
  }

  /** Create the draft in its module through the module's own service and rights (FR-02); returns { entity, ids, route }. */
  function apply(actor, x, v, b) {
    const t = b.target ?? {};
    if (x.doc_type === 'INVOICE') {
      const bill = billOf(db); if (!bill?.svc?.vendorInvoices) throw unprocessable('Vendor invoices (22.06) are not installed.');
      if (!t.poId) throw unprocessable('Choose the purchase order this invoice is against.');
      const po = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(t.poId), actor.companyId);
      if (!po) throw notFound('That purchase order does not exist.');
      // the goods accepted on each order line and not yet invoiced, at the order rate and tax (22.06 matches the invoice against them again)
      const accepted = db.prepare("SELECT COALESCE(SUM(l.accepted_qty - COALESCE(l.returned_qty, 0)), 0) AS s FROM inv_grn_lines l JOIN inv_grns g ON g.id = l.grn_id WHERE l.po_line_id = ? AND g.status = 'APPROVED' AND g.deleted_at IS NULL AND l.deleted_at IS NULL");
      const invoiced = db.prepare("SELECT COALESCE(SUM(l.qty_th), 0) AS s FROM bill_vendor_invoice_lines l JOIN bill_vendor_invoices i ON i.id = l.invoice_id WHERE l.po_line_id = ? AND i.deleted_at IS NULL AND i.status NOT IN ('CANCELLED', 'REJECTED')");
      const lines = db.prepare('SELECT * FROM proc_po_lines WHERE po_id = ? AND deleted_at IS NULL ORDER BY line_no').all(po.id).map((l) => ({ l, open: Math.max(0, accepted.get(l.id).s - invoiced.get(l.id).s) })).filter((r) => r.open > 0)
        .map(({ l, open }) => ({ poLineId: l.id, description: l.description ?? undefined, uom: l.uom ?? undefined, qty: open / 1000, rate: l.rate / 100, gstPct: (l.gst_pct ?? 0) / 10000 }));
      if (!lines.length) throw unprocessable(`Nothing received on ${po.doc_no} is waiting to be invoiced; the invoice cannot be pre-filled against it.`);
      if (!v.invoiceNo || !v.invoiceDate) throw unprocessable('The invoice number and date are needed.');
      const made = bill.svc.vendorInvoices.create(actor, parseViCreate({ projectId: po.org_project_id, invoiceKind: 'PO', vendorId: po.vendor_id, poId: po.id, vendorGstin: v.vendorGstin ?? null, invoiceNo: String(v.invoiceNo), invoiceDate: v.invoiceDate,
        source: 'OCR', declaredTotal: v.total != null ? Number(v.total) : null, notes: `Pre-filled from ${x.file_name} (${x.doc_no}) after review by ${actor.user}.`, lines }));
      return { entity: 'bill_vendor_invoices', ids: [made.id], label: made.docNo ?? made.doc_no, route: `/bill/vendor-invoices?id=${made.id}` };
    }
    if (x.doc_type === 'LETTER') {
      const engg = enggOf(db); if (!engg?.letters) throw unprocessable('The correspondence register (11.05) is not installed.');
      if (!t.projectId) throw unprocessable('Choose the project of the letter.');
      const made = engg.letters.create(actor, parseLetterCreate({ projectId: Number(t.projectId), direction: 'IN', theirRef: v.theirRef ?? undefined, letterDate: v.letterDate ?? todayIST(), receivedOn: todayIST(), party: String(v.party ?? 'Unknown sender'),
        subject: String(v.subject ?? x.file_name), category: v.category ?? 'OTHER', bodyText: (x.text_content ?? '').slice(0, 20000), contractual: false }));
      return { entity: 'engg_letters', ids: [made.id], label: made.letterNo ?? made.docNo ?? `Letter ${made.id}`, route: `/engg/letters?id=${made.id}` };
    }
    if (x.doc_type === 'CONTRACT') {
      const ctr = ctrOf(db); if (!ctr?.svc?.clauses) throw unprocessable('The contract register (21.01) is not installed.');
      if (!t.contractId) throw unprocessable('Choose the contract the clauses belong to.');
      const all = JSON.parse(x.clauses_json); const pick = (b.clauses ?? []).map((c) => ({ ...all[c.index], ...c })).filter((c) => c.clauseNo);
      if (!pick.length) throw unprocessable('Choose at least one clause to add.');
      const th = threshold(actor.companyId);
      const unconfirmed = pick.filter((c) => all[c.index]?.confidence < th && !c.confirmed && c.category === all[c.index].category);
      if (unconfirmed.length) throw unprocessable(`Confirm or correct the category of clauses ${unconfirmed.map((c) => c.clauseNo).join(', ')} first.`);
      const ids = []; const skipped = [];
      for (const c of pick) {
        try { ctr.svc.clauses.add(actor, Number(t.contractId), parseClause({ clauseNo: c.clauseNo, title: c.title, category: c.category, summary: c.summary.length >= 5 ? c.summary : `${c.title}.`, textRef: `${x.doc_no} ${x.file_name}`.slice(0, 200), timeBarDays: c.timeBarDays ?? null }));
          ids.push(db.prepare('SELECT id FROM ctr_clauses WHERE contract_id = ? AND clause_no = ? AND deleted_at IS NULL').get(Number(t.contractId), c.clauseNo).id); } catch (e) { if (e.status === 409) skipped.push(c.clauseNo); else throw e; }
      }
      return { entity: 'ctr_clauses', ids, skipped, label: `${ids.length} clauses`, route: `/ctr/contracts?id=${t.contractId}` };
    }
    if (x.doc_type === 'CERTIFICATE') {
      if (!v.validUntil) throw unprocessable('The validity date is needed.');
      const docs = documentsOf(db);
      const d = x.linked_entity === 'doc_version' ? db.prepare('SELECT d.* FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.id = ?').get(x.linked_id) : null;
      if (!docs || !d) throw unprocessable('This certificate is not a controlled document: register it in the document register to record its validity.');
      docs.documents.update(actor, d.id, { validUntil: v.validUntil, version: d.version });
      return { entity: 'doc_documents', ids: [d.id], label: d.doc_no, route: `/documents?id=${d.id}` };
    }
    throw unprocessable('Documents of this type have no target: reject it, or change its type by re-extracting a clearer copy.');
  }

  services.set(db, svc);
  contexts.set(db, context);
  if (jobs) jobs.register('ai.docintel.extract', (ctx) => process(ctx.params.fileId), { maxAttempts: 3, description: 'Extracts the text, type, fields and duplicates of an uploaded document (part 28.04).' });
  // FR-01: the upload hook — every file cleared by the virus scan, of a supported type, in a company with the flag on
  if (bus && jobs) bus.subscribe('core.file.available', (event, { db: tx }) => {
    const f = tx.prepare('SELECT id, company_id, extension FROM core_files WHERE id = ?').get(Number(event.entityId));
    if (!f || !SUPPORTED.has(f.extension) || !flagOn(f.company_id)) return;
    jobs.enqueue('ai.docintel.extract', { fileId: f.id }, { createdBy: 'docintel', companyId: f.company_id });
  }, { consumer: 'ai.docintel' });
  return svc;
}

const contexts = new WeakMap();
widgetRegistry.register({
  code: 'ai.docintel_queue',
  available: (db, actor) => { const c = contexts.get(db); if (!c || !hasPermissionAnywhere(actor, 'ai.docintel.view')) return false; try { requireDocIntel(c, actor); return true; } catch { return false; } },
  provider({ db, actor }) {
    const l = docIntelOf(db).list(actor, { pageSize: 1 }); const open = l.total;
    return { label: 'Documents to review', value: open, unit: 'documents', subtitle: Object.entries(l.open).map(([k, n]) => `${n} ${DI_TYPES[k].toLowerCase()}`).join(' · ') || 'Nothing waiting', status: open ? 'amber' : 'green', drill: '/ai/documents' };
  },
});
