import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import '../src/server/modules/registry.js';
import { classify, closeOcr, contractClauses, extract, gstinValid, hamming, parseAmount, parseDate, simhash, textOf } from '../src/server/modules/ai/docintel.js';
import { createRequire } from 'node:module';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { fill } from './qa-helpers.js';
import { setupCompany, startApi } from './helpers.js';

// Part 28.04: document and contract intelligence.
// T-01 extraction accuracy is measured on a sample set, and nothing is applied without acceptance; FR-01 the upload hook extracts the text of
// a PDF attached to the document register; FR-02 invoice, certificate, letter and contract extractors, applied after review to 22.06, 04.10,
// 11.05 and 21.01 through their own services; FR-03 classification and near-duplicates; FR-04, BR-01 low-confidence fields must be confirmed;
// section 8 roles; 409 on a stale version; volume.
const A = '/api/v1/ai';
const C = '/api/v1/core';
const D = '/api/v1/doc';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `di-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const fin = as('FINEX', 'di-fin'); const doc = as('DOC', 'di-doc'); const com = as('COMMGR', 'di-com'); const se = as('SE', 'di-se'); const aud = as('AUD', 'di-aud');
const opened = []; after(async () => { for (const c of opened) await c(); await closeOcr(); });
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A GSTIN with its correct check digit. */
const gstin = (first14) => { let s = 0; for (let i = 0; i < 14; i += 1) { const p = B36.indexOf(first14[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); } return first14 + B36[(36 - (s % 36)) % 36]; };
const G1 = gstin('36AABCS1429B1Z'); const G2 = gstin('27AAACU1234A1Z'); const G3 = gstin('29AAFCR5555K1Z');
const pdf = async (lines) => { const p = await PDFDocument.create(); const font = await p.embedFont(StandardFonts.Helvetica); let page = p.addPage([595, 842]); let y = 800;
  for (const l of lines) { if (y < 60) { page = p.addPage([595, 842]); y = 800; } page.drawText(l, { x: 40, y, size: 11, font }); y -= 18; } return Buffer.from(await p.save()); };

// ---- the sample set: documents of each kind with what a person would key in (T-01)
const SAMPLES = [
  { type: 'INVOICE', text: `Shree Cement Traders Pvt Ltd\nPlot 12, Industrial Area, Hyderabad\nGSTIN: ${G1}\nTAX INVOICE\nInvoice No: INV-2026/0457\nInvoice Date: 14-11-2026\nHSN 2523 OPC cement 53 grade 200 bags\nTaxable Value: 1,00,000.00\nIGST 18%: 18,000.00\nGrand Total: Rs 1,18,000.00`,
    truth: { vendorGstin: G1, invoiceNo: 'INV-2026/0457', invoiceDate: '2026-11-14', taxable: 100000, gst: 18000, total: 118000, vendorName: 'Shree Cement Traders Pvt Ltd' } },
  { type: 'INVOICE', text: `Ultra Steel Enterprises\nGSTIN ${G2}\nTax Invoice\nBill No. US/26-27/1189   Date: 02/10/2026\nTMT bars Fe500D 4.2 MT HSN 7214\nSub Total 2,52,000.00\nCGST 9% 22,680.00\nSGST 9% 22,680.00\nAmount Payable 2,97,360.00`,
    truth: { vendorGstin: G2, invoiceNo: 'US/26-27/1189', invoiceDate: '2026-10-02', taxable: 252000, gst: 45360, total: 297360, vendorName: 'Ultra Steel Enterprises' } },
  { type: 'INVOICE', text: `Ready Mix Concrete Industries Limited\nTAX INVOICE    GSTIN: ${G3}\nInvoice Number: RMC-7781\nInvoice Date 5 Nov 2026\nM30 concrete 48 cum\nTaxable Value 2,40,000\nIGST 18% 43,200\nInvoice Total 2,83,200`,
    truth: { vendorGstin: G3, invoiceNo: 'RMC-7781', invoiceDate: '2026-11-05', taxable: 240000, gst: 43200, total: 283200, vendorName: 'Ready Mix Concrete Industries Limited' } },
  { type: 'CERTIFICATE', text: 'TEST CERTIFICATE\nCertificate No: TC/2026/0091\nThis is to certify that the weighbridge serial 8812 was calibrated.\nIssued by: Telangana Legal Metrology Department\nDate of Issue: 01-04-2026\nValid up to: 31-03-2027',
    truth: { certificateNo: 'TC/2026/0091', issuedBy: 'Telangana Legal Metrology Department', issuedOn: '2026-04-01', validUntil: '2027-03-31' } },
  { type: 'CERTIFICATE', text: 'CERTIFICATE OF INSURANCE\nCertificate Number INS-55-2026\nWe certify that the contractor all risk policy is in force.\nIssuing Authority: National Assurance Co Ltd\nIssue Date 15 Jan 2026\nExpiry Date: 14 Jan 2027',
    truth: { certificateNo: 'INS-55-2026', issuedBy: 'National Assurance Co Ltd', issuedOn: '2026-01-15', validUntil: '2027-01-14' } },
  { type: 'LETTER', text: 'From: Roads and Buildings Department, Hyderabad\nRef No: RB/EE/2026/442\nDate: 18-11-2026\nTo: The Project Manager\nSubject: Notice of delay in pier cap casting at P12\nDear Sir,\nWith reference to the above, you are hereby given notice...\nYours faithfully,\nExecutive Engineer',
    truth: { party: 'Roads and Buildings Department, Hyderabad', theirRef: 'RB/EE/2026/442', letterDate: '2026-11-18', subject: 'Notice of delay in pier cap casting at P12', category: 'NOTICE' } },
  { type: 'LETTER', text: 'From: Metro Rail Authority\nYour Ref: MRA/CON/77\nDated 3 Nov 2026\nSub: Approval of revised bar bending schedule\nDear Sirs,\nWe convey the approval of the revised schedule submitted.\nYours sincerely,\nChief Engineer',
    truth: { party: 'Metro Rail Authority', theirRef: 'MRA/CON/77', letterDate: '2026-11-03', subject: 'Approval of revised bar bending schedule', category: 'APPROVAL' } },
];
const CONTRACT = ['CONTRACT AGREEMENT', 'This agreement is made between the Employer and the Contractor, hereinafter called the parties.', 'Whereas the Employer wishes to build the flyover.',
  '12. Payment Terms', 'Interim bills shall be paid within 30 days of certification. Retention of 5 % shall be deducted from each bill.',
  '13. Liquidated Damages', 'Liquidated damages at 0.5 % of the contract price per week of delay, subject to a cap of 10 %.',
  '14. Variations', 'Any variation shall be notified by the Contractor within 14 days of the instruction, failing which the claim shall be barred.',
  '21. Arbitration', 'Disputes shall be referred to arbitration under the Arbitration and Conciliation Act 1996.'];

test('T-01 FR-02 FR-03 extraction accuracy on the sample set, classification, the GSTIN check digit, dates, amounts and near-duplicates', () => {
  assert.equal(gstinValid(G1), true); assert.equal(gstinValid(`${G1.slice(0, 14)}${G1[14] === 'A' ? 'B' : 'A'}`), false);
  assert.deepEqual(['14-11-2026', '02/10/2026', '5 Nov 2026', '2026-12-01', '31-02-2026'].map(parseDate), ['2026-11-14', '2026-10-02', '2026-11-05', '2026-12-01', null]);
  assert.deepEqual(['Rs 1,18,000.00', '₹ 5,000/-', '2,97,360'].map(parseAmount), [118000, 5000, 297360]);
  let fields = 0; let right = 0; let types = 0;
  for (const s of SAMPLES) {
    const c = classify(s.text); if (c.type === s.type) types += 1;
    const f = extract(s.type, s.text).fields;
    for (const [k, v] of Object.entries(s.truth)) { fields += 1; if (f[k] && String(f[k].value) === String(v)) right += 1; else console.log('MISS', s.type, k, f[k]?.value, '≠', v); }
    for (const v of Object.values(f)) { assert.ok(v.confidence > 0 && v.confidence <= 1); if (v.start != null) assert.ok(s.text.slice(v.start, v.end).length > 0, 'a source position for the highlight'); }
  }
  const accuracy = right / fields;
  assert.ok(accuracy >= 0.9, `field accuracy ${Math.round(accuracy * 100)} % on ${fields} fields`); assert.equal(types, SAMPLES.length, 'every sample classified right');
  const clauses = contractClauses(CONTRACT.join('\n'));
  assert.deepEqual(clauses.map((c) => [c.clauseNo, c.category]), [['12', 'PAYMENT'], ['13', 'LD'], ['14', 'VARIATION'], ['21', 'DISPUTE']]);
  assert.equal(clauses.find((c) => c.clauseNo === '14').timeBarDays, 14); assert.equal(classify(CONTRACT.join('\n')).type, 'CONTRACT');
  assert.match(extract('CONTRACT', CONTRACT.join('\n')).summary, /Liquidated damages 0.5 %.*Retention 5 %/);
  // FR-03: a re-typed copy with a changed line is a near-duplicate; another invoice is not
  const a = simhash(SAMPLES[0].text); const b = simhash(SAMPLES[0].text.replace('200 bags', '200 bag')); const c = simhash(SAMPLES[1].text);
  assert.ok(hamming(a, b) <= 8, `near ${hamming(a, b)}`); assert.ok(hamming(a, c) > 16, `far ${hamming(a, c)}`);
  assert.equal(classify('Minutes of the site meeting held on Monday').type, 'OTHER');
  // a low-confidence guess stays below the threshold: a vendor found only by its company suffix
  assert.ok(extract('INVOICE', SAMPLES[0].text).fields.vendorName.confidence < 0.85);
});

async function setup() {
  const storage = mkdtempSync(join(tmpdir(), 'erp-di-'));
  const api = await startApi({}, { storagePath: storage }); opened.push(async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); });
  await setupCompany(api); const db = api.db;
  for (const [n, r] of [['di-fin', 'FINEX'], ['di-doc', 'DOC'], ['di-com', 'COMMGR'], ['di-se', 'SE'], ['di-aud', 'AUD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.ai.p2804', 1, 'Document intelligence fixture', 0, 1)").run();
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'DI-1', 'Flyover', 'BRIDGE', 'ACTIVE')").run().lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'APPROVED', 'EXECUTION', 'pm', 100000000, '2026-01-01', '2027-12-31', 'test')").run(project);
  db.exec('PRAGMA foreign_keys = OFF');
  const vendor = fill(db, 'mdm_partners', { company_id: 1, code: 'VSC', legal_name: 'Shree Cement Traders Pvt Ltd', trade_name: 'Shree', constitution: 'PRIVATE_LIMITED', partner_status: 'ACTIVE', steward_role: 'PROCMGR', created_by: 'test' });
  fill(db, 'mdm_partner_gstins', { company_id: 1, partner_id: vendor, state_code: '36', gstin: G1, gstin_status: 'ACTIVE' });
  const item = fill(db, 'mdm_items', { company_id: 1, code: 'OPC53', name: 'OPC cement 53' }); const store = fill(db, 'inv_stores', { company_id: 1, org_project_id: project, code: 'S1', name: 'Store' });
  const po = fill(db, 'proc_purchase_orders', { company_id: 1, doc_no: 'PO/DI/1', vendor_id: vendor, org_project_id: project, status: 'APPROVED', credit_days: 30, vendor_gstin: G1, requested_by: 'buyer' });
  const pl = fill(db, 'proc_po_lines', { company_id: 1, po_id: po, line_no: 1, item_id: item, description: 'OPC cement 53', qty: 300_000, uom: 'bag', rate: 50_000, gst_pct: 180_000 });
  const grn = fill(db, 'inv_grns', { company_id: 1, po_id: po, vendor_id: vendor, store_id: store, org_project_id: project, received_date: '2026-11-12', status: 'APPROVED', requested_by: 'stores' });
  fill(db, 'inv_grn_lines', { company_id: 1, grn_id: grn, line_no: 1, po_line_id: pl, item_id: item, uom: 'bag', received_qty: 200_000, accepted_qty: 200_000 });
  const contract = fill(db, 'ctr_contracts', { company_id: 1, org_project_id: project, contract_no: 'CON/DI/1', title: 'Flyover works', status: 'APPROVED', requested_by: 'com2' });
  db.exec('PRAGMA foreign_keys = ON');
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  const drain = async () => { for (let i = 0; i < 4; i += 1) { await runtimeOf(db).jobs.drain(); runtimeOf(db).bus.drain(); } await runtimeOf(db).jobs.drain(); };
  /** A controlled document with the file attached to its first revision (the 04.10 upload path). */
  const upload = async (bytes, name, docType = 'DRAWING', extra = {}) => {
    const d = await call(doc, 'POST', `${D}/documents`, { title: name, docType, projectId: project, ...extra }); assert.equal(d.status, 201, JSON.stringify(d.json));
    const g = (await call(doc, 'GET', `${D}/documents/${d.json.data.id}`)).json.data;
    const fd = new FormData(); fd.append('entity', 'doc_version'); fd.append('entityId', String(g.draftVersionId)); fd.append('file', new Blob([bytes]), name);
    const f = await api.raw('POST', `${C}/files`, { ...doc, body: fd }); assert.equal(f.status, 201, JSON.stringify(f.json));
    await drain();
    return { file: f.json.data, document: d.json.data };
  };
  const byFile = (fileId) => db.prepare('SELECT * FROM di_extractions WHERE file_id = ?').get(fileId);
  return { api, db, call, project, vendor, po, pl, contract, upload, byFile, drain };
}

test('FR-01 FR-04 BR-01 T-01 the upload hook extracts; nothing is applied until a reviewer accepts; low-confidence fields need confirmation; the invoice and the letter are pre-filled as drafts', async () => {
  const t = await setup();
  const invBytes = await pdf(SAMPLES[0].text.split('\n'));
  const inv = await t.upload(invBytes, 'shree-invoice.pdf');
  const x = t.byFile(inv.file.id); assert.ok(x, 'extracted on upload'); assert.deepEqual([x.status, x.doc_type, x.engine], ['EXTRACTED', 'INVOICE', 'PDF_TEXT']);
  assert.match(x.text_content, /INV-2026\/0457/, 'searchable text');
  // T-01: nothing applied before acceptance
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM bill_vendor_invoices').get().n, 0);
  const list = (await t.call(fin, 'GET', `${A}/documents`)).json.data; assert.equal(list.total, 1); assert.equal(list.rows[0].sla, 'ON_TIME'); assert.ok(list.rows[0].lowConfidence >= 1);
  const found = (await t.call(fin, 'GET', `${A}/documents?q=INV-2026`)).json.data; assert.equal(found.total, 1, 'searchable');
  const g = (await t.call(fin, 'GET', `${A}/documents/${x.id}`)).json.data;
  assert.equal(g.vendor.id, t.vendor, 'the GSTIN finds the vendor'); assert.deepEqual(g.targets.orders.map((o) => o.id), [t.po]);
  const fv = Object.fromEntries(g.fields.map((f) => [f.key, f])); assert.equal(fv.total.value, 118000); assert.equal(fv.vendorGstin.mustConfirm, false); assert.equal(fv.vendorName.mustConfirm, true);
  assert.ok(g.text.slice(fv.invoiceNo.start, fv.invoiceNo.end).includes('INV-2026/0457'), 'the source position highlights the number'); assert.match(g.preview, /\/content\?/, 'the document opens beside the fields');
  // section 8: a site engineer may not see the queue; the auditor reads but does not review
  assert.equal((await t.call(se, 'GET', `${A}/documents`)).status, 403);
  assert.equal((await t.call(aud, 'POST', `${A}/documents/${x.id}/accept`, { rowVersion: g.rowVersion, target: { poId: t.po } })).status, 403);
  // BR-01: the vendor name (low confidence) must be confirmed or corrected
  const refused = await t.call(fin, 'POST', `${A}/documents/${x.id}/accept`, { rowVersion: g.rowVersion, target: { poId: t.po } });
  assert.equal(refused.status, 422); assert.match(refused.json.error.message, /Vendor/);
  assert.equal((await t.call(fin, 'POST', `${A}/documents/${x.id}/accept`, { rowVersion: g.rowVersion + 5, confirmed: ['vendorName'], target: { poId: t.po } })).status, 409, 'a stale version');
  const ok = await t.call(fin, 'POST', `${A}/documents/${x.id}/accept`, { rowVersion: g.rowVersion, confirmed: ['vendorName'], values: { invoiceNo: 'INV-2026/0457' }, target: { poId: t.po } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.data.status, 'ACCEPTED'); assert.equal(ok.json.data.applied.entity, 'bill_vendor_invoices');
  const vi = t.db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(ok.json.data.applied.ids[0]);
  assert.deepEqual([vi.status, vi.source, vi.invoice_no, vi.invoice_date, vi.vendor_id, vi.declared_total_paise, vi.vendor_gstin], ['DRAFT', 'OCR', 'INV-2026/0457', '2026-11-14', t.vendor, 11_800_000, G1]);
  assert.equal(t.db.prepare('SELECT qty_th FROM bill_vendor_invoice_lines WHERE invoice_id = ?').get(vi.id).qty_th, 200_000, 'the goods accepted and not invoiced');
  assert.equal((await t.call(fin, 'POST', `${A}/documents/${x.id}/accept`, { rowVersion: ok.json.data.rowVersion, confirmed: ['vendorName'], target: { poId: t.po } })).status, 422, 'accepted once');
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'di_extractions' AND action = 'accept'").get());
  // FR-03: the same bytes again (another document) are an exact duplicate; a near copy is a near-duplicate
  const again = await t.upload(invBytes, 'shree-invoice-copy.pdf');
  assert.equal(JSON.parse(t.byFile(again.file.id).duplicate_json).kind, 'EXACT');
  const near = await t.upload(await pdf(SAMPLES[0].text.replace('200 bags', '200 bag').split('\n')), 'shree-invoice-retyped.pdf');
  assert.equal(JSON.parse(t.byFile(near.file.id).duplicate_json).kind, 'NEAR');
  // the letter: the document controller accepts it as an inward letter of the project
  const let1 = await t.upload(await pdf(SAMPLES[5].text.split('\n')), 'rb-notice.pdf');
  const lx = (await t.call(doc, 'GET', `${A}/documents/${t.byFile(let1.file.id).id}`)).json.data; assert.equal(lx.docType, 'LETTER');
  const lacc = await t.call(doc, 'POST', `${A}/documents/${lx.id}/accept`, { rowVersion: lx.rowVersion, confirmed: lx.fields.filter((f) => f.mustConfirm).map((f) => f.key), target: { projectId: t.project } });
  assert.equal(lacc.status, 200, JSON.stringify(lacc.json));
  const letter = t.db.prepare('SELECT * FROM engg_letters WHERE id = ?').get(lacc.json.data.applied.ids[0]);
  assert.deepEqual([letter.direction, letter.subject, letter.their_ref, letter.category], ['IN', 'Notice of delay in pier cap casting at P12', 'RB/EE/2026/442', 'NOTICE']);
  // reject, and the accuracy measured from the reviews (T-01 in use)
  const other = await t.upload(await pdf(SAMPLES[6].text.split('\n')), 'mra-approval.pdf');
  const ox = (await t.call(doc, 'GET', `${A}/documents/${t.byFile(other.file.id).id}`)).json.data;
  assert.equal((await t.call(doc, 'POST', `${A}/documents/${ox.id}/reject`, { reason: 'Already registered by hand', rowVersion: ox.rowVersion })).json.data.status, 'REJECTED');
  const acc = (await t.call(fin, 'GET', `${A}/documents/accuracy`)).json.data; assert.ok(acc.suggested >= 10); assert.ok(acc.overallPct >= 80, JSON.stringify(acc));
  const xl = await t.api.raw('GET', `${A}/documents/export?format=csv&status=ALL`, fin); assert.equal(xl.status, 200); assert.ok(!xl.buffer.toString('utf8').includes('Grand Total'), 'no document text in the export');
});

test('FR-02 a certificate sets the validity of its controlled document; contract clauses go to the clause library on confirmation', async () => {
  const t = await setup();
  const vt = t.db.prepare("SELECT code FROM doc_types WHERE company_id IS NULL AND has_validity = 1 AND status = 'ACTIVE' ORDER BY code LIMIT 1").get() ?? t.db.prepare('SELECT code FROM doc_types WHERE has_validity = 1 LIMIT 1').get();
  assert.ok(vt, 'a document type with a validity date');
  const cert = await t.upload(await pdf(SAMPLES[3].text.split('\n')), 'weighbridge-calibration.pdf', vt.code, { validUntil: '2026-12-31' });
  const cx = (await t.call(doc, 'GET', `${A}/documents/${t.byFile(cert.file.id).id}`)).json.data;
  assert.equal(cx.docType, 'CERTIFICATE'); assert.equal(cx.targets.document.id, cert.document.id);
  const cacc = await t.call(doc, 'POST', `${A}/documents/${cx.id}/accept`, { rowVersion: cx.rowVersion, confirmed: cx.fields.filter((f) => f.mustConfirm).map((f) => f.key) });
  assert.equal(cacc.status, 200, JSON.stringify(cacc.json));
  assert.equal(t.db.prepare('SELECT valid_until FROM doc_documents WHERE id = ?').get(cert.document.id).valid_until, '2027-03-31');
  // the contract: the commercial manager picks clauses; a low-confidence category must be confirmed or changed
  const ct = await t.upload(await pdf(CONTRACT), 'flyover-agreement.pdf');
  const kx = (await t.call(com, 'GET', `${A}/documents/${t.byFile(ct.file.id).id}`)).json.data;
  assert.equal(kx.docType, 'CONTRACT'); assert.equal(kx.clauses.length, 4); assert.deepEqual(kx.targets.contracts.map((c) => c.id), [t.contract]);
  const pick = kx.clauses.slice(0, 3).map((c) => ({ index: c.index, confirmed: true }));
  assert.equal((await t.call(fin, 'POST', `${A}/documents/${kx.id}/accept`, { rowVersion: kx.rowVersion, target: { contractId: t.contract }, clauses: pick })).status, 404, 'the finance executive may not open the contract document, so the extraction does not exist for them');
  const kacc = await t.call(com, 'POST', `${A}/documents/${kx.id}/accept`, { rowVersion: kx.rowVersion, target: { contractId: t.contract }, clauses: pick });
  assert.equal(kacc.status, 200, JSON.stringify(kacc.json));
  const added = t.db.prepare('SELECT clause_no, category, time_bar_days, source_type FROM ctr_clauses WHERE contract_id = ? ORDER BY clause_no').all(t.contract);
  assert.deepEqual(added.map((c) => [c.clause_no, c.category]), [['12', 'PAYMENT'], ['13', 'LD'], ['14', 'VARIATION']]); assert.equal(added[2].time_bar_days, 14);
});

test('the text of files: a text layer, plain text, a file that is not an image; volume of the queue', async () => {
  const p = await textOf(await pdf(['Hello invoice world', 'Second line of text here']), 'pdf');
  assert.equal(p.engine, 'PDF_TEXT'); assert.match(p.text, /Second line/);
  assert.equal((await textOf(Buffer.from('plain words in a file'), 'txt')).engine, 'TEXT');
  const broken = await textOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'png'); // not an image: said so, never thrown
  assert.equal(broken.engine, 'NONE'); assert.match(broken.reason, /OCR engine/);
  const t = await setup();
  const fid = Number(t.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id) VALUES (1, 'k/x', 'x.pdf', 'pdf', 'application/pdf', 'document', 1, 'h', 'CLEAN', 'sample_document', 1)").run().lastInsertRowid);
  t.db.exec('PRAGMA foreign_keys = OFF'); t.db.exec('BEGIN');
  const ins = t.db.prepare("INSERT INTO di_extractions (company_id, doc_no, file_id, file_name, doc_type, engine, status, extracted_at, project_id, fields_json) VALUES (1, ?, ?, 'f.pdf', ?, 'PDF_TEXT', ?, '2026-11-20T00:00:00Z', ?, '{}')");
  for (let i = 0; i < 100_000; i += 1) ins.run(`V/${i}`, fid + 1 + i, ['INVOICE', 'LETTER', 'CERTIFICATE'][i % 3], i % 4 ? 'EXTRACTED' : 'ACCEPTED', t.project);
  t.db.exec('COMMIT'); t.db.exec('PRAGMA foreign_keys = ON');
  const t0 = performance.now(); const r = await t.call(fin, 'GET', `${A}/documents?docType=INVOICE&pageSize=25`); const ms = performance.now() - t0;
  assert.equal(r.status, 200); assert.equal(r.json.data.rows.length, 25); assert.ok(ms < 500, `${ms} ms`);
  const plan = t.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM di_extractions x WHERE x.company_id = 1 AND x.doc_type = 'INVOICE' AND x.status IN ('EXTRACTED', 'NO_TEXT')").all().map((x) => x.detail).join(' ');
  assert.match(plan, /ix_di_extractions/);
});

// D-786: scanned images and scanned PDFs (no text layer) are read by the local OCR engine (tesseract.js with its English data)
// The page is drawn with a font the repository ships (Liberation Sans, from pdfjs-dist), not the machine's 'sans-serif': on a CI runner that has no Latin
// text font the letters were not drawn at all and only the digits came out (D-786 failed there as '2026 0457' for 'INV-2026/0457').
GlobalFonts.registerFromPath(createRequire(import.meta.url).resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'), 'OCR Test Sans');
const scanned = () => { const c = createCanvas(1240, 1754); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754); g.fillStyle = '#000'; g.font = "34px 'OCR Test Sans'";
  ['Shree Cement Traders Pvt Ltd', 'TAX INVOICE', 'Invoice No: INV-2026/0457', 'Invoice Date: 14-11-2026', 'Grand Total 1,18,000.00'].forEach((l, i) => g.fillText(l, 100, 150 + i * 60)); return c.toBuffer('image/png'); };
test('D-786 a scanned invoice is read by OCR, as an image and as a PDF without a text layer, and extracted', async () => {
  const png = scanned();
  const img = await textOf(png, 'png');
  assert.equal(img.engine, 'OCR'); assert.match(img.text, /INV-2026\/0457/); assert.ok(img.confidence >= 0.7, `confidence ${img.confidence}`);
  const p = await PDFDocument.create(); const page = p.addPage([595, 842]); page.drawImage(await p.embedPng(png), { x: 0, y: 0, width: 595, height: 842 });
  const scan = await textOf(Buffer.from(await p.save()), 'pdf');
  assert.equal(scan.engine, 'OCR'); assert.equal(scan.pages, 1); assert.match(scan.text, /TAX INVOICE/);
  const { type } = classify(scan.text); assert.equal(type, 'INVOICE');
  const { fields } = extract('INVOICE', scan.text); assert.equal(fields.invoiceNo.value, 'INV-2026/0457'); assert.equal(fields.invoiceDate.value, '2026-11-14');
});
