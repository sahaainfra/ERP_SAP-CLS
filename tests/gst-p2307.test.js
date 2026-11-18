import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { todayIST } from '../src/shared/dates.js';
import { gstinCheckChar } from '../src/shared/gst.js';
import { readSignedQr } from '../src/server/modules/fin/gsp.js';
import { taxOf, timeOfSupply } from '../src/server/modules/fin/gst.js';

// Part 23.07: the GST tax engine, e-invoice (IRN) and e-way bill.
//  T-01 inter- and intra-state, reverse charge and SEZ scenarios give the right tax lines; the IRN sandbox round trip works.
//  and: export, works contract place of supply, the GST 2.0 rate change by time of supply (s.14), determinism; GSTIN checks; the settings made by the accounts
//  manager and approved by the CFO (the maker never approves); an IRN made by itself when an invoice is issued, its QR, the number unique whatever its case, the
//  30-day window blocking, a failure retried after the master is corrected, cancellation within 24 hours; e-way bills with validity by distance, vehicle update,
//  extension refused outside its window, cancellation; rights and project isolation.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), aud: as('AUD', 'aud1'), stm: as('STOREMGR', 'stm9'), se: as('SE', 'se9') };
const F = '/api/v1/fin';
const today = todayIST();
const g = (first14) => `${first14}${gstinCheckChar(first14)}`;
const OWN = g('36AAACM1234F1Z'); const CLIENT = g('36AAAGT1234F1Z'); const MH = g('27AABCD1234E1Z'); const SEZ = g('36AABCS4321K1Z');
const ago = (n) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  d.prepare("INSERT INTO core_company_settings (company_id, legal_name, address_json, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', ?, ?) ON CONFLICT(company_id) DO UPDATE SET legal_name = excluded.legal_name, address_json = excluded.address_json, gstins_json = excluded.gstins_json")
    .run(JSON.stringify({ line1: 'Plot 12, Hitech City', line2: '', city: 'Hyderabad', stateCode: '36', pincode: '500081' }), JSON.stringify([{ gstin: OWN, stateCode: '36' }]));
  const client = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (1, 'C1', 'Telangana Housing Board', 'TSHB', 'GOVERNMENT', 'AAAGT1234F', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const addr = fill(d, 'mdm_partner_addresses', { company_id: 1, partner_id: client, address_type: 'BILLING', address: 'Gruhakalpa, Nampally', city: 'Hyderabad', state_code: '36', pin: '500001', is_default: 1 });
  const contract = fill(d, 'ctr_contracts', { company_id: 1, org_project_id: r.A, client_partner_id: client, status: 'APPROVED' });
  d.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, max_retries) VALUES (1, 'GSP-SBX', 'GST sandbox', 'gsp', 'sandbox', 'development', '{}', 'ENABLED', 0)").run();
  let n = 0;
  /** A tax invoice issued (22.04): the row, then its event (irnRequired when e-invoicing is on). */
  const issue = (date, taxable, { no = null, project = r.A, inter = false } = {}) => { n += 1; const gst = Math.round(taxable * 18) / 100; const invNo = no ?? `INV/26-27/${String(n).padStart(4, '0')}`;
    const ti = fill(d, 'bill_tax_invoices', { company_id: 1, org_project_id: project, contract_id: contract, bill_id: 900 + n, invoice_no: invNo, invoice_date: date, sac_code: '9954', description: 'Construction of housing blocks, RA bill', gst_pct_bp: 1800, taxable_paise: Math.round(taxable * 100), cgst_paise: inter ? 0 : Math.round(gst * 50), sgst_paise: inter ? 0 : Math.round(gst * 50), igst_paise: inter ? Math.round(gst * 100) : 0, total_paise: Math.round((taxable + gst) * 100), supply: inter ? 'inter' : 'intra', gstin_from: OWN, gstin_to: inter ? MH : CLIENT, place_state: inter ? '27' : '36', due_date: date, status: 'APPROVED', irn_state: 'PENDING', ar_state: 'HANDED' });
    publishEvent(d, { type: 'bill.invoice.issued', entity: 'bill_tax_invoices', entityId: ti, actorId: 'test', companyId: 1, data: { invoiceId: ti, invoiceNo: invNo, invoiceDate: date, projectId: project, contractId: contract, irnRequired: true } }); return ti; };
  /** Waits for the IRN calls the consumers started (they run after the event, through the connector). */
  const settle = async (ti) => { for (let k = 0; k < 50; k += 1) { const e = d.prepare("SELECT einv_status FROM gst_einvoices WHERE document_type = 'bill_tax_invoices' AND document_id = ?").get(ti); if (e && e.einv_status !== 'PENDING') return e.einv_status; await new Promise((res) => setTimeout(res, 20)); } return null; };
  return { ...r, call, client, addr, contract, issue, settle };
}

/** The settings: proposed by the accounts manager, approved by the CFO. */
async function settingsOn(w, body) {
  const s = await w.call(U.acc, 'POST', '/gst/settings', { effectiveFrom: ago(400), aato: '1200000000', einvoiceEnabled: true, ewayEnabled: true, gspConnector: 'GSP-SBX', gspMode: 'SANDBOX', changeNote: 'Turnover above ₹10 crore: e-invoicing and e-way bills through the sandbox', ...body });
  assert.equal(s.status, 201, JSON.stringify(s.json)); const id = s.json.data.id;
  assert.equal((await w.call(U.acc, 'POST', `/gst/settings/${id}/submit`)).status, 202);
  const inst = w.wf('gst_settings', id); assert.equal((await w.tasksOf(U.acc)).filter((t) => t.instance.id === inst).length, 0, 'the maker has no task to approve');
  assert.equal((await w.act(U.cfo, inst)).status, 200); return id;
}

test('T-01 tax lines: intra- and inter-state, reverse charge, SEZ, export, works contract, GST 2.0 by time of supply; deterministic', async () => {
  const w = await world(); const res = (b, who = U.acc) => w.call(who, 'POST', '/gst/resolve', b);
  // intra-state: TMT bars (HSN 7214, 18 %): CGST 9 % + SGST 9 %
  let x = await res({ docDate: today, supplierGstin: OWN, recipientGstin: CLIENT, lines: [{ hsn: '7214', taxable: '100000.00' }] }); assert.equal(x.status, 200, JSON.stringify(x.json)); let t = x.json.data;
  assert.equal(t.interState, false); assert.equal(t.lines[0].cgst, 9000); assert.equal(t.lines[0].sgst, 9000); assert.equal(t.lines[0].igst, 0); assert.equal(t.totals.invoiceValue, 118000);
  // inter-state: Telangana to Maharashtra: IGST 18 %
  t = (await res({ docDate: today, supplierGstin: OWN, recipientGstin: MH, lines: [{ hsn: '7214', taxable: 100000 }, { hsn: '2517', taxable: 50000 }] })).json.data;
  assert.equal(t.interState, true); assert.equal(t.lines[0].igst, 18000); assert.equal(t.lines[1].igst, 2500); assert.equal(t.totals.tax, 20500); assert.equal(t.taxHeads, 'IGST');
  // works contract on immovable property in Telangana for a Maharashtra client: the place of supply is where the property is (s.12(3)): CGST + SGST
  t = (await res({ docDate: today, supplierGstin: OWN, recipientGstin: MH, propertyState: '36', lines: [{ hsn: '9954', taxable: 1000000 }] })).json.data;
  assert.equal(t.placeOfSupply, '36'); assert.equal(t.interState, false); assert.equal(t.lines[0].cgst, 90000);
  // reverse charge: goods transport agency (SAC 996511, RCM in the master) to a registered recipient: tax shown, not in the invoice value
  t = (await res({ docDate: today, supplierState: '36', recipientGstin: OWN, lines: [{ hsn: '996511', taxable: 20000 }] })).json.data;
  assert.equal(t.lines[0].reverseCharge, true); assert.equal(t.totals.reverseChargeTax, 1000); assert.equal(t.totals.tax, 0); assert.equal(t.totals.invoiceValue, 20000);
  // SEZ unit in the same state: IGST whatever the state; without payment (LUT) zero-rated, with payment IGST charged
  t = (await res({ docDate: today, supplierGstin: OWN, recipientGstin: SEZ, supplyKind: 'SEZ', lines: [{ hsn: '7308', taxable: 500000 }] })).json.data;
  assert.equal(t.interState, true); assert.equal(t.zeroRated, true); assert.equal(t.totals.tax, 0); assert.equal(t.lines[0].gstRate, 18);
  t = (await res({ docDate: today, supplierGstin: OWN, recipientGstin: SEZ, supplyKind: 'SEZ', withPayment: true, lines: [{ hsn: '7308', taxable: 500000 }] })).json.data;
  assert.equal(t.lines[0].igst, 90000); assert.equal(t.lines[0].cgst, 0);
  t = (await res({ docDate: today, supplierGstin: OWN, supplyKind: 'EXPORT', lines: [{ hsn: '7308', taxable: 100 }] })).json.data; assert.equal(t.placeOfSupply, '96'); assert.equal(t.totals.tax, 0);
  // GST 2.0: cement (2523) 28 % until 21-09-2025, 18 % from 22-09-2025 (the dated HSN master of 166.8)
  t = (await res({ docDate: '2025-09-10', supplierGstin: OWN, recipientGstin: CLIENT, lines: [{ hsn: '2523', taxable: 1000 }] })).json.data; assert.equal(t.lines[0].gstRate, 28);
  t = (await res({ docDate: '2025-09-25', supplierGstin: OWN, recipientGstin: CLIENT, lines: [{ hsn: '2523', taxable: 1000 }] })).json.data; assert.equal(t.lines[0].gstRate, 18);
  // supplied before the change, invoiced and paid after: two of three after → the new rate; supplied and invoiced before, paid after → the old rate
  t = (await res({ docDate: '2025-09-25', supplyDate: '2025-09-15', paymentDate: '2025-09-26', supplierGstin: OWN, recipientGstin: CLIENT, lines: [{ hsn: '2523', taxable: 1000 }] })).json.data; assert.equal(t.lines[0].gstRate, 18); assert.match(t.lines[0].rateRule, /invoice and payment/);
  t = (await res({ docDate: '2025-09-18', supplyDate: '2025-09-15', paymentDate: '2025-09-26', supplierGstin: OWN, recipientGstin: CLIENT, lines: [{ hsn: '2523', taxable: 1000 }] })).json.data; assert.equal(t.lines[0].gstRate, 28); assert.equal(t.lines[0].cgst, 140);
  // deterministic; rounding half up to the paisa; bad inputs refused
  const b = { docDate: today, supplierGstin: OWN, recipientGstin: MH, lines: [{ hsn: '7214', taxable: '1234.57' }] };
  assert.deepEqual((await res(b)).json.data, (await res(b)).json.data); assert.equal(taxOf(123457, 180000), 22222); assert.equal(taxOf(5, 90000), 0); assert.equal(taxOf(6, 90000), 1);
  assert.equal(timeOfSupply({ supplyDate: '2025-09-01', invoiceDate: '2025-09-30' }, (dt) => (dt < '2025-09-22' ? 'old' : 'new')).date, '2025-09-30');
  assert.equal((await res({ docDate: today, supplierGstin: '36AAACM1234F1Z0', lines: [{ hsn: '7214', taxable: 1 }] })).status, 400);
  assert.equal((await res({ docDate: today, supplierGstin: OWN, lines: [{ hsn: '99999999', taxable: 1 }] })).status, 422);
  assert.equal((await res({ docDate: today, supplierGstin: OWN, lines: [{ hsn: '7214', taxable: 1 }] }, U.se)).status, 403);
});

test('T-01 the IRN sandbox round trip: settings approved, IRN made by itself, QR, case-insensitive number, window, retry, cancel; GSTIN checks; rights', async () => {
  const w = await world(); const d = w.d;
  // nothing is sent before the settings are approved: e-invoicing is off
  const t0 = w.issue(today, 100000); await w.drain(); await new Promise((r) => setTimeout(r, 30)); assert.equal(d.prepare('SELECT COUNT(*) AS n FROM gst_einvoices').get().n, 0);
  assert.equal((await w.call(U.acc, 'POST', '/gst/settings', { gspMode: 'SANDBOX', changeNote: 'x' })).status, 400, 'a short note is refused');
  const bad = await w.call(U.acc, 'POST', '/gst/settings', { einvoiceEnabled: true, gspConnector: null, changeNote: 'turn on without a connector' }); assert.equal(bad.status, 201);
  assert.equal((await w.call(U.acc, 'POST', `/gst/settings/${bad.json.data.id}/submit`)).status, 400, 'e-invoicing needs a GSP connector');
  assert.equal((await w.call(U.fin, 'POST', '/gst/settings', { changeNote: 'not mine to propose' })).status, 403);
  await settingsOn(w, {});
  const cur = (await w.call(U.cfo, 'GET', '/gst/settings')).json.data; assert.equal(cur.current.einvoiceEnabled, true); assert.equal(cur.current.irnWindowDays, 30); assert.equal(cur.connectors[0].code, 'GSP-SBX');
  assert.ok(d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'gst_settings' AND action = 'approve'").get(), 'the approval is audited');
  // GSTINs: format and check character, then the sandbox's status
  let gc = await w.call(U.acc, 'POST', '/gst/gstin-check', { gstin: CLIENT }); assert.equal(gc.status, 200); assert.equal(gc.json.data.valid, true); assert.equal(gc.json.data.status, 'ACTIVE'); assert.equal(gc.json.data.source, 'SANDBOX');
  gc = await w.call(U.acc, 'POST', '/gst/gstin-check', { gstin: `${CLIENT.slice(0, 14)}${CLIENT[14] === 'A' ? 'B' : 'A'}` }); assert.equal(gc.json.data.valid, false); assert.match(gc.json.data.problem, /check character/);
  // an invoice issued: the IRN is made by itself, handed to the invoice, the QR signed
  const t1 = w.issue(today, 250000); await w.drain(); assert.equal(await w.settle(t1), 'GENERATED');
  const e1 = d.prepare("SELECT * FROM gst_einvoices WHERE document_type = 'bill_tax_invoices' AND document_id = ?").get(t1);
  assert.equal(e1.irn, createHash('sha256').update(`${OWN}${e1.fy}INV${e1.document_no.toUpperCase()}`).digest('hex'));
  const inv = d.prepare('SELECT irn, ack_no, irn_state FROM bill_tax_invoices WHERE id = ?').get(t1); assert.equal(inv.irn_state, 'GENERATED'); assert.equal(inv.irn, e1.irn); assert.equal(inv.ack_no, e1.ack_no);
  // D-732: the tax invoice's own print carries the IRN and the signed QR (drawn as squares on the page)
  const pr = await w.api.raw('GET', `/api/v1/bill/tax-invoices/${t1}/print`, { ...U.acc }); assert.equal(pr.status, 200, pr.buffer.toString('utf8').slice(0, 300)); const ipdf = pr.buffer.toString('latin1'); assert.match(ipdf, /Tax invoice INV/); assert.ok(ipdf.includes(e1.irn.slice(0, 60))); assert.ok((ipdf.match(/ re f/g) ?? []).length > 100, 'the QR is drawn');
  const qr = readSignedQr(e1.signed_qr); assert.equal(qr.sandboxValid, true); assert.equal(qr.Irn, e1.irn); assert.equal(qr.TotInvVal, 295000); assert.equal(qr.MainHsnCode, '9954');
  const view = (await w.call(U.fin, 'GET', `/einvoices/${e1.id}`)).json.data; assert.equal(view.status, 'GENERATED'); assert.equal(view.can.cancel, false, 'the finance executive retries, does not cancel'); assert.ok(view.log.some((l) => l.action === 'generate' && l.outcome === 'OK'));
  assert.equal(w.events('fin.einvoice.generated').length, 1);
  assert.equal((await w.call(U.acc, 'GET', `/einvoices/${e1.id}/qr`)).status, 200);
  const pdf = await w.api.call('GET', `${F}/einvoices/${e1.id}/print`, { ...U.acc }); assert.equal(pdf.status, 200);
  // the same number in other letters is the same number for the IRP
  // (22.04's own numbers are unique without regard to case; a number reported from another source in other letters blocks this one)
  fill(d, 'gst_einvoices', { company_id: 1, doc_no: 'EI/OTHER', document_type: 'ar_credit_notes', document_id: 999, irp_doc_type: 'INV', document_no: 'inv/26-27/case', document_date: today, fy: e1.fy, seller_gstin: OWN, einv_status: 'GENERATED' });
  const t2 = fill(d, 'bill_tax_invoices', { company_id: 1, org_project_id: w.A, contract_id: w.contract, bill_id: 989, invoice_no: 'INV/26-27/CASE', invoice_date: today, sac_code: '9954', gst_pct_bp: 1800, taxable_paise: 100000, cgst_paise: 9000, sgst_paise: 9000, igst_paise: 0, total_paise: 118000, supply: 'intra', gstin_from: OWN, gstin_to: CLIENT, place_state: '36', status: 'APPROVED', irn_state: 'PENDING', ar_state: 'HANDED' });
  const c2 = await w.call(U.acc, 'POST', '/einvoices', { documentType: 'bill_tax_invoices', documentId: t2 }); assert.equal(c2.status, 409); assert.match(c2.json.error.message, /capitals/);
  // older than the window (AATO ₹12 crore): blocked, shown on the worklist as blocked
  const t3 = w.issue(ago(35), 1000); await w.drain(); assert.equal(await w.settle(t3), 'BLOCKED');
  const due = (await w.call(U.acc, 'GET', '/einvoices/due')).json.data; assert.equal(due.windowApplies, true); assert.ok(due.rows.find((r) => r.documentId === t3 && r.level === 'BLOCKED'));
  // day 22 of the window: amber on the worklist; generated by hand
  const t4 = fill(d, 'bill_tax_invoices', { company_id: 1, org_project_id: w.A, contract_id: w.contract, bill_id: 990, invoice_no: 'INV/26-27/D22', invoice_date: ago(22), sac_code: '9954', gst_pct_bp: 1800, taxable_paise: 100000, cgst_paise: 9000, sgst_paise: 9000, igst_paise: 0, total_paise: 118000, supply: 'intra', gstin_from: OWN, gstin_to: CLIENT, place_state: '36', status: 'APPROVED', irn_state: 'PENDING', ar_state: 'HANDED' });
  const due2 = (await w.call(U.acc, 'GET', '/einvoices/due')).json.data; const r4 = due2.rows.find((r) => r.documentId === t4); assert.equal(r4.level, 'AMBER'); assert.equal(r4.daysLeft, 8); assert.equal(r4.can.generate, true);
  assert.equal((await w.call(U.fin, 'POST', '/einvoices', { documentType: 'bill_tax_invoices', documentId: t4 })).status, 403, 'the finance executive does not generate');
  const g4 = await w.call(U.acc, 'POST', '/einvoices', { documentType: 'bill_tax_invoices', documentId: t4 }); assert.equal(g4.status, 201, JSON.stringify(g4.json)); assert.equal(g4.json.data.status, 'GENERATED');
  // the client's PIN missing: refused by the schema check, retried after the master is corrected
  d.prepare("UPDATE mdm_partner_addresses SET pin = NULL WHERE id = ?").run(w.addr);
  const t5 = w.issue(today, 5000); await w.drain(); assert.equal(await w.settle(t5), 'FAILED');
  const e5 = d.prepare("SELECT * FROM gst_einvoices WHERE document_id = ? AND document_type = 'bill_tax_invoices'").get(t5); assert.match(e5.error, /PIN/); assert.equal(d.prepare('SELECT irn_state FROM bill_tax_invoices WHERE id = ?').get(t5).irn_state, 'FAILED');
  d.prepare("UPDATE mdm_partner_addresses SET pin = '500001' WHERE id = ?").run(w.addr);
  const rt = await w.call(U.fin, 'POST', `/einvoices/${e5.id}/retry`); assert.equal(rt.status, 200, JSON.stringify(rt.json)); assert.equal(rt.json.data.status, 'GENERATED'); assert.equal(rt.json.data.attempts, 2);
  // a document whose heads disagree with the tax engine is refused before it is sent
  const t6 = fill(d, 'bill_tax_invoices', { company_id: 1, org_project_id: w.A, contract_id: w.contract, bill_id: 991, invoice_no: 'INV/26-27/BADHEAD', invoice_date: today, sac_code: '9954', gst_pct_bp: 1800, taxable_paise: 100000, cgst_paise: 0, sgst_paise: 0, igst_paise: 18000, total_paise: 118000, supply: 'inter', gstin_from: OWN, gstin_to: CLIENT, place_state: '36', status: 'APPROVED', irn_state: 'PENDING', ar_state: 'HANDED' });
  const b6 = await w.call(U.acc, 'POST', '/einvoices', { documentType: 'bill_tax_invoices', documentId: t6 }); assert.equal(b6.status, 422); assert.match(b6.json.error.message, /tax engine/);
  // cancelled within 24 hours, by the accounts manager only; the invoice may then be cancelled
  assert.equal((await w.call(U.fin, 'POST', `/einvoices/${e1.id}/cancel`, { reasonCode: '2', remark: 'Wrong client address' })).status, 403);
  const cn = await w.call(U.acc, 'POST', `/einvoices/${e1.id}/cancel`, { reasonCode: '2', remark: 'Wrong client address' }); assert.equal(cn.status, 200, JSON.stringify(cn.json)); assert.equal(cn.json.data.status, 'CANCELLED');
  assert.equal(d.prepare('SELECT irn_state FROM bill_tax_invoices WHERE id = ?').get(t1).irn_state, 'NONE'); assert.equal((await w.call(U.acc, 'POST', `/einvoices/${e1.id}/cancel`, { reasonCode: '2', remark: 'again' })).status, 409);
  // the register: list, export, rights, the auditor reads, the site engineer does not
  const l = await w.call(U.aud, 'GET', '/einvoices?sort=-docNo'); assert.equal(l.status, 200); assert.ok(l.json.data.length >= 4);
  assert.equal((await w.call(U.se, 'GET', '/einvoices')).status, 403); assert.equal((await w.call(U.acc, 'GET', '/einvoices/export')).status, 200);
  const ex = await w.call(U.acc, 'GET', '/gst/settings/export'); assert.equal(ex.status, 200);
  void t0;
});

test('e-way bills: validity by distance, vehicle update, extension window, cancellation; the transfer takes the number; rights', async () => {
  const w = await world(); const d = w.d; await settingsOn(w, {});
  const ti = w.issue(today, 80000, { inter: true }); await w.drain(); await w.settle(ti);
  const prep = await w.call(U.acc, 'GET', `/ewaybills/prepare?documentType=bill_tax_invoices&documentId=${ti}`); assert.equal(prep.status, 200, JSON.stringify(prep.json)); assert.equal(prep.json.data.required, true); assert.equal(prep.json.data.toState, '27');
  // the consignee's PIN comes from the partner master; a wrong one typed on the form is refused
  assert.equal(prep.json.data.toPin, '500001'); const no = await w.call(U.acc, 'POST', '/ewaybills', { documentType: 'bill_tax_invoices', documentId: ti, distance: 450, toPin: '01234' }); assert.equal(no.status, 400);
  const e = await w.call(U.acc, 'POST', '/ewaybills', { documentType: 'bill_tax_invoices', documentId: ti, toPin: '411001', distance: 450, hsn: '7308', vehicleNo: 'TS 09 EA 1234' }); assert.equal(e.status, 201, JSON.stringify(e.json));
  const x = e.json.data; assert.equal(x.status, 'ACTIVE'); assert.match(x.ewbNo, /^\d{12}$/); assert.equal(x.vehicleNo, 'TS09EA1234');
  // 450 km at 200 km a day: 3 days, to the end of the third day after today (IST)
  const end = new Date(Date.parse(x.validUntil) + 5.5 * 3600_000).toISOString(); const plus3 = new Date(`${today}T00:00:00Z`); plus3.setUTCDate(plus3.getUTCDate() + 3); assert.equal(end.slice(0, 10), plus3.toISOString().slice(0, 10)); assert.equal(end.slice(11, 19), '23:59:59');
  assert.equal((await w.call(U.acc, 'POST', '/ewaybills', { documentType: 'bill_tax_invoices', documentId: ti, toPin: '411001', distance: 450, hsn: '7308' })).status, 409, 'one live e-way bill per document');
  // the vehicle broke down: Part B again, the validity unchanged
  const v = await w.call(U.acc, 'POST', `/ewaybills/${x.id}/vehicle`, { vehicleNo: 'TS10UB5678', fromPlace: 'Zaheerabad', reasonCode: '1', remark: 'Breakdown', version: x.version }); assert.equal(v.status, 200, JSON.stringify(v.json)); assert.equal(v.json.data.vehicleNo, 'TS10UB5678'); assert.equal(v.json.data.validUntil, x.validUntil); assert.equal(v.json.data.history.length, 2);
  // extension only within 8 hours of the expiry
  const ext = await w.call(U.acc, 'POST', `/ewaybills/${x.id}/extend`, { remainingKm: 120, fromPlace: 'Solapur', reasonCode: '1', remark: 'Natural calamity' }); assert.equal(ext.status, 422); assert.match(ext.json.error.message, /within 8 hours/);
  // the store manager makes the e-way bill of a transfer; the dispatch takes its number
  const store = (code) => fill(d, 'inv_stores', { company_id: 1, code, name: `Store ${code}`, store_type: 'SITE_STORE', org_project_id: w.A });
  const tr = fill(d, 'inv_transfers', { company_id: 1, doc_no: 'TRF/000001', request_date: today, from_store_id: store('S1'), to_store_id: store('S2'), from_project_id: w.A, to_project_id: w.A, total_value: 7500000, status: 'APPROVED' });
  const te = await w.call(U.stm, 'POST', '/ewaybills', { documentType: 'inv_transfers', documentId: tr, fromPin: '500081', toPin: '502032', distance: 60, hsn: '7214' }); assert.equal(te.status, 201, JSON.stringify(te.json)); assert.equal(te.json.data.status, 'PART_A', 'no vehicle yet: Part A only');
  const te2 = await w.call(U.stm, 'POST', `/ewaybills/${te.json.data.id}/vehicle`, { vehicleNo: 'TS07UA4321', fromPlace: 'Hyderabad', reasonCode: '4', remark: 'First vehicle', version: te.json.data.version }); assert.equal(te2.json.data.status, 'ACTIVE'); assert.ok(te2.json.data.validUntil);
  // D-734: concrete leaving the premises is ticketed without a number; the e-way bill made here writes it on the ticket, its cancellation takes it off
  const tk = fill(d, 'bp_delivery_tickets', { company_id: 1, ticket_no: 'DT-0001', qr_code: 'DT:1', org_project_id: w.A, grade: 'M25', qty_milli: 6000, truck_no: 'TS08TM1111', outside_premises: 1, eway_no: null, departed_at: `${today}T08:00`, status: 'APPROVED' });
  const tw = await w.call(U.acc, 'POST', '/ewaybills', { documentType: 'bp_delivery_tickets', documentId: tk, fromPin: '500081', toPin: '502032', distance: 40, hsn: '3824', value: '36000', vehicleNo: 'TS08TM1111' }); assert.equal(tw.status, 201, JSON.stringify(tw.json));
  await w.drain(); assert.equal(d.prepare('SELECT eway_no FROM bp_delivery_tickets WHERE id = ?').get(tk).eway_no, tw.json.data.ewbNo);
  assert.equal((await w.call(U.acc, 'POST', `/ewaybills/${tw.json.data.id}/cancel`, { reasonCode: '2', remark: 'Wrong entry' })).status, 200); await w.drain(); assert.equal(d.prepare('SELECT eway_no FROM bp_delivery_tickets WHERE id = ?').get(tk).eway_no, null);
  assert.equal(w.events('fin.ewaybill.generated').length, 3);
  // cancelled within 24 hours by the accounts manager; the store manager may not cancel
  assert.equal((await w.call(U.stm, 'POST', `/ewaybills/${x.id}/cancel`, { reasonCode: '3', remark: 'Order cancelled' })).status, 403);
  const c = await w.call(U.acc, 'POST', `/ewaybills/${x.id}/cancel`, { reasonCode: '3', remark: 'Order cancelled' }); assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.data.status, 'CANCELLED');
  const list = await w.call(U.acc, 'GET', '/ewaybills'); assert.equal(list.status, 200); assert.equal(list.json.data.length, 3);
  assert.equal((await w.call(U.se, 'GET', '/ewaybills')).status, 403); assert.equal((await w.call(U.acc, 'GET', '/ewaybills/export')).status, 200);
  // the daily work: nothing due to expire within 12 hours yet, nothing expired
  const { gstOf } = await import('../src/server/modules/fin/index.js'); const a = gstOf(d).jobs.alerts(); assert.equal(a.expired, 0);
});
