import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, approvedContract, as, fill, key, ready } from './ctr-helpers.js';
import { statutoryResolver } from '../src/server/modules/mdm/statutory.js';

// Part 166.8: the statutory changes of 2025-26 as dated master rows.
//  T-01 a vendor invoice for cement dated 21-09-2025 is at 28 %, dated 22-09-2025 at 18 % (Notification 9/2025-CT(Rate)).
//  T-02 a sub bill credited on 31-03-2026 deducts under 194C, on 01-04-2026 under s.393(1) of the 2025 Act; the certificate form of each date (16A, 131).
//  T-03 wagesUnderCode: basic 40 %, allowances 60 % → wages are 50 % of the remuneration (Code on Wages, s.2(y)).
//  T-04 draft documents that cross an effective date are in the migration report; approved ones are not, and are unchanged (hash compare).
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...BASE, mse: as('SE', 'mse1'), qs2: as('QS', 'qs2'), sub: as('SUBCO', 'sub1'), fin: as('FINEX', 'fin1'), hr: as('HRMGR', 'hr1'), acc8: as('ACCMGR', 'acc1') };
const M = '/api/v1/mdm'; const B = '/api/v1/bill';

async function world(baseline = false) {
  const r = await ready(opened, { baseline }); const d = r.d;
  for (const [u, role] of [['mse1', 'SE'], ['qs2', 'QS'], ['sub1', 'SUBCO'], ['fin1', 'FINEX'], ['hr1', 'HRMGR']]) d.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u, u, JSON.stringify([role]), `${u}@example.com`);
  const call = (who, method, path, body) => r.api.call(method, path, { ...who, headers: key(), body });
  return { ...r, d, call, ctr: r };
}

test('FR-02 resolution by date: cement 28 % to 21-09-2025 and 18 % from 22-09-2025; the 40 % slab; TDS 194C to 31-03-2026 and 393(1) from 01-04-2026 with its payment code; forms 16A and 131', async () => {
  const w = await world(); const res = statutoryResolver(w.d);
  assert.deepEqual([res.gst(1, { hsn: '2523', date: '2025-09-21' }).pct, res.gst(1, { hsn: '2523', date: '2025-09-22' }).pct], [28, 18]);
  assert.equal(res.gst(1, { hsn: '2523', date: '2017-07-01' }).rateCode, 'GST28');
  const g40 = w.d.prepare("SELECT igst_pct, effective_from FROM mdm_gst_rates WHERE code = 'GST40' AND company_id IS NULL").get();
  assert.deepEqual([g40.igst_pct / 10_000, g40.effective_from], [40, '2025-09-22']);
  const old = res.tds(1, { nature: 'CONTRACTOR', date: '2026-03-31', constitution: 'PARTNERSHIP' }); const neu = res.tds(1, { nature: 'CONTRACTOR', date: '2026-04-01', constitution: 'PARTNERSHIP' });
  assert.deepEqual([old.section, old.act, old.pct, old.paymentCode, old.certificate, old.statement], ['194C', 'IT1961', 2, '94C', '16A', '26Q']);
  assert.deepEqual([neu.section, neu.act, neu.pct, neu.paymentCode, neu.certificate, neu.statement], ['393(1)', 'IT2025', 2, '1024', '131', '140']);
  assert.match(neu.legalRef, /393\(1\).*2025/);
  assert.deepEqual([res.tds(1, { nature: 'CONTRACTOR', date: '2026-04-01', constitution: 'INDIVIDUAL' }).pct, res.tds(1, { nature: 'CONTRACTOR', date: '2026-04-01', constitution: 'HUF' }).paymentCode], [1, '1023']);
  assert.deepEqual(['SALARY_CERT', 'SALARY_RETURN'].map((p) => [res.form(1, { purpose: p, date: '2026-03-31' }).formCode, res.form(1, { purpose: p, date: '2026-04-01' }).formCode]), [['16', '130'], ['24Q', '138']]);
  // the same through the API of the page, for an accounts manager
  const l = await w.call(U.acc8, 'GET', `${M}/statutory/lookup?hsn=2523&nature=CONTRACTOR&date=2026-04-01`);
  assert.equal(l.status, 200, JSON.stringify(l.json));
  assert.deepEqual([l.json.data.gst.pct, l.json.data.tds.section, l.json.data.forms.find((f) => f.purpose === 'NON_SALARY_CERT').formCode], [18, '393(1)', '131']);
  // the masters: the TDS row shows its nature and Act; the new masters are listed in the catalogue
  const cat = (await w.call(U.acc8, 'GET', `${M}/common`)).json.data.rows;
  for (const m of ['tds-forms', 'statutory-calendar', 'labour-rules', 'pay-components']) assert.ok(cat.some((x) => x.code === m), m);
  assert.ok(cat.find((x) => x.code === 'tds-sections').fields.some((f) => f.key === 'natureCode'));
  const tds = (await w.call(U.acc8, 'GET', `${M}/common/tds-sections?asOf=2026-04-01&q=393`)).json.data.rows;
  assert.ok(tds.some((t) => t.section === '393(1)' && t.natureCode === 'CONTRACTOR' && t.actCode === 'IT2025'));
});

test('T-01 a vendor invoice for cement: dated 21-09-2025 at 28 % it matches; dated 22-09-2025 at 28 % the rate is not in force; at 18 % it is', async () => {
  const w = await world(); const d = w.d;
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'VCEM', 'Ultra Cement Ltd', 'Ultra', 'PUBLIC_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const item = fill(d, 'mdm_items', { company_id: 1, code: 'CEM53', name: 'Cement 53 grade', hsn_sac_code: '2523' }); const store = fill(d, 'inv_stores', { company_id: 1, org_project_id: w.A, code: 'ST1', name: 'Main store' });
  const po = fill(d, 'proc_purchase_orders', { company_id: 1, vendor_id: vendor, org_project_id: w.A, doc_date: '2025-09-10', status: 'APPROVED', credit_days: 30, vendor_gstin: '27AAACU1234A1Z5', requested_by: 'buyer1' });
  const pl = fill(d, 'proc_po_lines', { company_id: 1, po_id: po, line_no: 1, item_id: item, qty: 300_000, uom: 'bag', rate: 40_000, gst_pct: 280_000, tax_code: 'GST28' });
  const grn = fill(d, 'inv_grns', { company_id: 1, po_id: po, vendor_id: vendor, store_id: store, org_project_id: w.A, received_date: '2025-09-15', status: 'APPROVED', requested_by: 'acc1' });
  fill(d, 'inv_grn_lines', { company_id: 1, grn_id: grn, line_no: 1, po_line_id: pl, item_id: item, uom: 'bag', received_qty: 300_000, accepted_qty: 300_000 });
  const inv = (no, date, gstPct) => w.call(U.fin, 'POST', `${B}/vendor-invoices`, { invoiceKind: 'PO', vendorId: vendor, poId: po, vendorGstin: '27AAACU1234A1Z5', invoiceNo: no, invoiceDate: date, source: 'MANUAL', lines: [{ poLineId: pl, qty: 10, rate: 400, gstPct, hsn: '2523' }] });
  const before = await inv('UC/101', '2025-09-21', 28); assert.equal(before.status, 201, JSON.stringify(before.json));
  assert.deepEqual([before.json.data.matchStatus, before.json.data.tax], ['MATCHED', 1_120], '10 bags at 400, 28 % on 21-09-2025');
  const after28 = (await inv('UC/102', '2025-09-22', 28)).json.data;
  assert.ok(after28.exceptions.some((e) => e.code === 'GST_RATE_OF_DATE' && /18% on 2025-09-22/.test(e.message)), JSON.stringify(after28.exceptions));
  const after18 = (await inv('UC/103', '2025-09-22', 18)).json.data;
  assert.equal(after18.exceptions.some((e) => e.code === 'GST_RATE_OF_DATE'), false, 'the rate in force on the invoice date');
  assert.equal(after18.tax, 720, '18 % of 4,000');
  return { w, vendor, po, pl, ids: [before.json.data.id, after28.id, after18.id] };
});

async function subWorld(w) {
  const d = w.d; const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const k = await approvedContract(w.ctr); const sub = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'SUB8', 'Shree Earthworks', 'Shree', 'PARTNERSHIP', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid); fill(d, 'mdm_partner_roles', { company_id: 1, partner_id: sub, partner_role: 'SUBCONTRACTOR' });
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: w.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED' });
  const cl = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '1.1', description: 'Item 1.1', uom: 'cum', qty: 1_000_000, rate: 10_000_000, amount: 0 });
  const c = await w.call(U.com, 'POST', '/api/v1/ctr/work-orders', { projectId: w.A, woNo: `WO-${Math.random().toString(36).slice(2, 7)}`, woType: 'ITEM_RATE', contractId: k.id, subcontractorId: sub, selectionKind: 'NEGOTIATED', justification: 'Only local party with the plant', title: 'Earthwork in embankment', startDate: day(0), endDate: day(180), retentionPct: 0, sdPct: 0, advancePct: 0, advanceRecoveryPct: 0, tdsSection: '194C', gstMode: 'EXEMPT', gstPct: 0, paymentDays: 30, ldPct: 0.5, ldCapPct: 10, safetyPenalty: 5000, items: [{ itemKind: 'BOQ', boqLineId: cl, clientBoqLineId: null, description: 'Earthwork in embankment', uom: 'cum', qty: 1000, rate: 800 }] });
  assert.equal(c.status, 201, JSON.stringify(c.json)); const woId = c.json.data.id;
  assert.equal((await w.call(U.com, 'POST', `/api/v1/ctr/work-orders/${woId}/submit`)).status, 202); const wf = w.wf('ctr_work_orders', woId);
  for (const who of [U.com2, U.pd, U.dir, U.cfo]) { if ((await w.call(U.com, 'GET', `/api/v1/ctr/work-orders/${woId}`)).json.data.status === 'APPROVED') break; await w.act(who, wf).catch(() => null); }
  // the order and its work ran from March 2026: a bill for March and one for April
  d.prepare("UPDATE ctr_work_orders SET start_date = '2026-03-01' WHERE id = ?").run(woId);
  const item = d.prepare('SELECT id FROM ctr_wo_items WHERE wo_id = ?').get(woId).id;
  const measure = async (qty, on) => { const m = await w.call(U.mse, 'POST', `${B}/sub-measurements`, { woId, woItemId: item, description: 'Measured', template: 'QTY', qty, measuredOn: day(-1) }); assert.equal(m.status, 201, JSON.stringify(m.json)); const id = m.json.data.id; assert.equal((await w.call(U.sub, 'POST', `${B}/sub-measurements/${id}/sign`, { signer: 'R. Patel', signedOn: day(-1), method: 'MANUAL', signatureRef: 'SIG-1' })).status, 200); assert.equal((await w.call(U.qs, 'POST', `${B}/sub-measurements/${id}/verify`)).status, 200); d.prepare('UPDATE bill_sub_measurements SET measured_on = ? WHERE id = ?').run(on, id); return id; };
  return { sub, woId, item, measure };
}

test('T-02 a sub bill credited on 31-03-2026 deducts under 194C, on 01-04-2026 under s.393(1); each names its certificate form', async () => {
  const w = await world(true); const s = await subWorld(w);
  await s.measure(100, '2026-03-20');
  const march = await w.call(U.qs, 'POST', `${B}/sub-bills`, { woId: s.woId, billType: 'RA', periodFrom: '2026-03-01', periodTo: '2026-03-31', manual: [] });
  assert.equal(march.status, 201, JSON.stringify(march.json));
  const t1 = march.json.data.deductions.find((x) => x.kind === 'TDS');
  assert.deepEqual([t1.section, t1.act, t1.pct, t1.paymentCode, t1.certificate], ['194C', 'IT1961', 2, '94C', '16A'], JSON.stringify(t1));
  assert.match(t1.label, /194C/); assert.match(t1.note, /Form 16A/);
  // the March bill goes through its approval (site engineer, second QS, project manager)
  assert.equal((await w.call(U.qs, 'POST', `${B}/sub-bills/${march.json.data.id}/submit`)).status, 202); const f = w.wf('bill_sub_bills', march.json.data.id); for (const u of [U.mse, U.qs2, U.pm]) await w.act(u, f);
  assert.equal((await w.call(U.qs, 'GET', `${B}/sub-bills/${march.json.data.id}`)).json.data.status, 'APPROVED');
  await s.measure(50, '2026-04-01');
  const april = await w.call(U.qs, 'POST', `${B}/sub-bills`, { woId: s.woId, billType: 'RA', periodFrom: '2026-04-01', periodTo: '2026-04-01', manual: [] });
  assert.equal(april.status, 201, JSON.stringify(april.json));
  const t2 = april.json.data.deductions.find((x) => x.kind === 'TDS');
  assert.deepEqual([t2.section, t2.act, t2.pct, t2.paymentCode, t2.certificate], ['393(1)', 'IT2025', 2, '1024', '131'], JSON.stringify(t2));
  assert.match(t2.note, /Section 393\(1\).*Income-tax Act, 2025.*payment code 1024.*Form 131/);
  // 2 % of 40,000 (50 cum at 800) under either Act: the rate carries over
  assert.equal(t2.amount, 800);
});

test('T-03 wagesUnderCode: basic 40 % and allowances 60 % make wages 50 % of the remuneration; before the Code (October 2025) wages are the basic; rights', async () => {
  const w = await world(); const d = w.d;
  const emp = fill(d, 'hr_employees', { company_id: 1, employee_code: 'E-8801', full_name: 'Asha Kulkarni', employment_status: 'ACTIVE' });
  const put = (who, body) => w.call(who, 'PUT', `${M}/statutory/employees/${emp}/pay`, body);
  const body = { effectiveFrom: '2025-10-01', reason: 'Salary structure on joining', lines: [{ code: 'BASIC', amount: 40_000 }, { code: 'HRA', amount: 30_000 }, { code: 'CONVEYANCE', amount: 10_000 }, { code: 'COMMISSION', amount: 20_000 }] };
  assert.equal((await put(U.mse, body)).status, 403, 'a site engineer may not set pay');
  const p = await put(U.hr, body); assert.equal(p.status, 200, JSON.stringify(p.json));
  const may = (await w.call(U.hr, 'GET', `${M}/statutory/employees/${emp}/wages?month=2026-05`)).json.data;
  assert.deepEqual([may.remuneration, may.excluded, may.addedBack, may.wages, may.ruleApplies], [100_000, 60_000, 10_000, 50_000, true], JSON.stringify(may));
  assert.equal(may.wages / may.remuneration, 0.5);
  const oct = (await w.call(U.hr, 'GET', `${M}/statutory/employees/${emp}/wages?month=2025-10`)).json.data;
  assert.deepEqual([oct.wages, oct.ruleApplies, oct.addedBack], [40_000, false, 0], 'the Code was in force from 21-11-2025');
  // exclusions within half: nothing is added back
  await put(U.hr, { effectiveFrom: '2026-06-01', reason: 'Revision', lines: [{ code: 'BASIC', amount: 60_000 }, { code: 'HRA', amount: 40_000 }] });
  const jun = (await w.call(U.hr, 'GET', `${M}/statutory/employees/${emp}/wages?month=2026-06`)).json.data;
  assert.deepEqual([jun.remuneration, jun.wages, jun.addedBack], [100_000, 60_000, 0]);
  assert.equal((await w.call(U.hr, 'GET', `${M}/statutory/employees/${emp}/wages?month=2026-05`)).json.data.wages, 50_000, 'May keeps the structure of its date');
  assert.equal((await put(U.hr, { effectiveFrom: '2026-07-01', reason: 'Bad', lines: [{ code: 'NOPE', amount: 1 }] })).status, 400);
  assert.equal((await w.call(U.mse, 'GET', `${M}/statutory/employees/${emp}/wages?month=2026-05`)).status, 403, 'pay is sensitive');
  assert.equal((await w.call({ ...U.hr, company: '2' }, 'GET', `${M}/statutory/employees/${emp}/wages?month=2026-05`)).status, 404, 'another company');
});

test('T-04 the migration report lists draft documents that cross an effective date; approved ones are not listed and do not change (hash compare); the calendar and its alert', async () => {
  const w = await world(); const d = w.d; const svc = (await import('../src/server/modules/mdm/statutory.js')).createStatutoryService({ db: d, flags: null });
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'VCM2', 'Ultra Cement Ltd', 'Ultra', 'PUBLIC_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const mk = (no, date, status, gst) => { const id = fill(d, 'bill_vendor_invoices', { company_id: 1, org_project_id: w.A, vendor_id: vendor, doc_no: `VI/T4/${no}`, invoice_no: no, invoice_date: date, status, total_paise: 100 }); fill(d, 'bill_vendor_invoice_lines', { company_id: 1, invoice_id: id, line_no: 1, hsn: '2523', qty_th: 1000, rate_paise: 40_000, gst_pct_bp: gst, taxable_paise: 40_000, tax_paise: 0, amount_paise: 40_000 }); return id; };
  const draft = mk('D1', '2025-09-25', 'DRAFT', 2800); const ok = mk('D2', '2025-09-25', 'DRAFT', 1800); const approved = mk('A1', '2025-09-25', 'APPROVED', 2800); const older = mk('D3', '2025-09-20', 'DRAFT', 2800);
  const hash = svc.hashOf('bill_vendor_invoices', approved); const lineHash = d.prepare('SELECT * FROM bill_vendor_invoice_lines WHERE invoice_id = ?').get(approved);
  const rep = await w.call(U.acc8, 'GET', `${M}/statutory/migration-report`); assert.equal(rep.status, 200, JSON.stringify(rep.json));
  const ids = rep.json.data.rows.filter((r) => r.kind === 'VINV').map((r) => r.id);
  assert.ok(ids.includes(draft), 'a draft at 28 % dated after 22-09-2025'); assert.ok(!ids.includes(ok), 'a draft at the rate of its date'); assert.ok(!ids.includes(older), 'a draft dated before the change keeps 28 %'); assert.ok(!ids.includes(approved), 'an approved invoice is never listed');
  assert.equal(rep.json.data.rows.find((r) => r.id === draft).inForce.startsWith('18%'), true);
  assert.ok(rep.json.data.changes.some((c) => c.kind === 'TDS' && /393\(1\) CONTRACTOR/.test(c.ref)));
  assert.equal(svc.hashOf('bill_vendor_invoices', approved), hash, 'the approved invoice is unchanged');
  assert.deepEqual(d.prepare('SELECT * FROM bill_vendor_invoice_lines WHERE invoice_id = ?').get(approved), lineHash);
  // FR-03: the calendar: the statement for Q4 of 2025-26 is due 31-05-2026 in Form 26Q; Q1 of 2026-27 by 31-07-2026 in Form 140; March's deposit by 30 April
  const cal = (await w.call(U.acc8, 'GET', `${M}/statutory/calendar?from=2026-03&to=2026-06`)).json.data.rows;
  const q4 = cal.find((r) => r.code === 'TDS_RET_Q4'); const q1 = cal.find((r) => r.code === 'TDS_RET_Q1'); const mar = cal.filter((r) => r.purpose === 'TDS_DEPOSIT' && r.periodEnd === '2026-03-31');
  assert.deepEqual([q4.dueDate, q4.form, q1.dueDate, q1.form], ['2026-05-31', 'Form 26Q', '2026-07-31', 'Form 140']);
  assert.deepEqual(mar.map((r) => [r.code, r.dueDate]), [['TDS_DEPOSIT_MAR', '2026-04-30']], 'March has its own due date, not the 7th');
  assert.equal(cal.find((r) => r.code === 'TDS_DEPOSIT' && r.periodEnd === '2026-04-30').dueDate, '2026-05-07');
  const { alertDatasets } = await import('../src/server/platform/alerts/index.js');
  const rows = alertDatasets.get('mdm.statutory_due').query(d, { companyId: 1, today: '2026-07-25' });
  const due = rows.find((r) => r.fields.obligation.includes('April to June'));
  assert.deepEqual([due.fields.dueDate, due.fields.daysToDue, due.fields.withinAlert, due.fields.form], ['2026-07-31', 6, true, 'Form 140']);
  assert.ok(d.prepare("SELECT 1 FROM alr_rules WHERE code = 'mdm.statutory_due' AND status = 'LIBRARY'").get(), 'the library rule');
  // rights: a site engineer reads the report without the documents they may not open; another company's documents are not listed
  const se = (await w.call(U.mse, 'GET', `${M}/statutory/migration-report`)).json.data;
  assert.deepEqual([se.scope.vendorInvoices, se.rows.filter((r) => r.kind === 'VINV').length], [false, 0]);
  assert.equal((await w.call({ ...U.acc8, company: '2' }, 'GET', `${M}/statutory/migration-report`)).json.data.rows.filter((r) => r.kind === 'VINV').length, 0);
});
