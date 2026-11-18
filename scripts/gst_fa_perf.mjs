// npm run erp:gst-fa-perf -- [--queries 30]
// Parts 23.07, 23.08 and 23.09 §14: fills 100 000 e-invoices and 100 000 e-way bills over 50 projects (23.07), 100 000 AP bills with GST and a GSTR-2B of
// 100 000 documents for them (23.08), and 100 000 fixed assets (23.09), then times what the screens and the runs ask: the e-invoice and e-way bill lists (first
// page, a status filter, a deep page), one e-invoice, the IRN-due worklist, the tax resolver; the 2B match of a month (10 000 documents) and its worklist, an ITC
// review of the month; the asset list, one asset with its schedule, the depreciation preview and run of a month for 10 000 assets, the fixed asset schedule.
// Prints the query plans. The standard (05_GLOBAL_STANDARDS §11): p95 <= 500 ms for a list, <= 300 ms for one record, <= 800 ms for a save; a run is a batch.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createBase } from '../src/server/modules/proc/base.js';
import { bindFin, createFinService } from '../src/server/modules/fin/service.js';
import { createGlService } from '../src/server/modules/fin/gl.js';
import { createGstService } from '../src/server/modules/fin/gst.js';
import { createGstReconService } from '../src/server/modules/fin/gstrecon.js';
import { createAssetService } from '../src/server/modules/fin/assets.js';

const args = process.argv.slice(2);
const queries = Number(args.includes('--queries') ? args[args.indexOf('--queries') + 1] : 30);
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = OFF;'); migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
db.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', '[{\"gstin\":\"36AAACM1234F1Z5\",\"stateCode\":\"36\"}]') ON CONFLICT(company_id) DO NOTHING").run();
db.exec('BEGIN');
const fy = Number(db.prepare("INSERT INTO core_financial_years (company_id, code, start_date, end_date, status, created_by) VALUES (1, '2026-27', '2026-04-01', '2027-03-31', 'Open', 'perf')").run().lastInsertRowid);
for (let m = 0; m < 12; m += 1) { const mm = ((3 + m) % 12) + 1; const yy = 2026 + (m >= 9 ? 1 : 0); const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); db.prepare("INSERT INTO core_periods (company_id, fy_id, period_no, name, start_date, end_date, created_by) VALUES (1, ?, ?, ?, ?, ?, 'perf')").run(fy, m + 1, `P${m + 1}`, `${yy}-${String(mm).padStart(2, '0')}-01`, `${yy}-${String(mm).padStart(2, '0')}-${last}`); }
const projects = []; for (let p = 1; p <= 50; p += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`).lastInsertRowid));
db.exec('COMMIT');
const fin = createFinService({ db }); bindFin(db, fin); fin.ensureSetup(1);
const acct = (code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code).id;
const flags = { isOn: () => true }; const base = createBase({ db }); const gl = createGlService({ db, base });
const gs = createGstService({ db, base, flags }); const gr = createGstReconService({ db, base, gl, flags, gst: () => gs }); const fa = createAssetService({ db, base, gl, flags, tax: () => gs });
const acc = { user: 'acc', roles: ['ACCMGR'], companyId: 1 };
const p95 = (ms) => [...ms].sort((x, y) => x - y)[Math.floor(ms.length * 0.95)] ?? 0;
const results = [];
const time = (label, limit, fn, n = queries) => { const ms = []; for (let i = 0; i < n; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } const r = { label, p95: Math.round(p95(ms)), limit, ok: p95(ms) <= limit }; results.push(r); console.log(`${r.ok ? 'OK  ' : 'OVER'} ${label}: p95 ${r.p95} ms (limit ${limit})`); };
const day = (i) => `2026-${String(4 + (i % 7)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;

console.log('Filling 100 000 e-invoices and 100 000 e-way bills...');
db.exec('BEGIN');
const insE = db.prepare("INSERT INTO gst_einvoices (company_id, doc_no, document_type, document_id, irp_doc_type, document_no, document_date, fy, seller_gstin, buyer_gstin, taxable_paise, tax_paise, total_paise, irn, ack_no, ack_date, einv_status, attempts, org_project_id, created_by) VALUES (1, ?, 'bill_tax_invoices', ?, 'INV', ?, ?, '2026-27', '36AAACM1234F1Z5', '36AAAGT1234F1Z1', ?, ?, ?, ?, ?, ?, ?, 1, ?, 'perf')");
const insW = db.prepare("INSERT INTO gst_ewaybills (company_id, doc_no, document_type, document_id, document_no, document_date, ewb_doc_type, sub_type, from_gstin, to_gstin, from_state, to_state, from_pin, to_pin, distance_km, hsn_code, value_paise, ewb_no, ewb_date, valid_until, ewb_status, org_project_id, created_by) VALUES (1, ?, 'inv_transfers', ?, ?, ?, 'CHL', 'BRANCH_TRANSFER', '36AAACM1234F1Z5', '36AAACM1234F1Z5', '36', '36', '500081', '502032', ?, '7214', ?, ?, ?, ?, ?, ?, 'perf')");
for (let i = 0; i < 100_000; i += 1) { const st = i % 50 === 0 ? 'FAILED' : 'GENERATED'; insE.run(`EI/${i + 1}`, i + 1, `INV/${i + 1}`, day(i), 1_000_000 + i, 180_000, 1_180_000 + i, st === 'GENERATED' ? `irn${i}` : null, st === 'GENERATED' ? String(100000000000000 + i) : null, '2026-10-01 10:00:00', st, projects[i % 50]); insW.run(`EWB/${i + 1}`, i + 1, `TRF/${i + 1}`, day(i), 30 + (i % 400), 5_000_000 + i, String(100000000000 + i), '2026-10-01T05:00:00Z', `2026-${String(10 + (i % 2)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T18:29:59Z`, i % 10 ? 'ACTIVE' : 'EXPIRED', projects[i % 50]); }
db.exec('COMMIT'); db.exec('ANALYZE');
time('e-invoice list, first page', 500, () => gs.einvoices.list(acc, {}));
time('e-invoice list, failed only', 500, () => gs.einvoices.list(acc, { 'filter[status]': 'FAILED' }));
time('e-invoice list, page 200', 500, () => gs.einvoices.list(acc, { page: '200' }));
time('one e-invoice with its log', 300, (i) => gs.einvoices.get(acc, 1 + i * 37));
time('e-way bill list, valid only', 500, () => gs.ewaybills.list(acc, { 'filter[status]': 'ACTIVE' }));
time('tax resolver, 10 lines', 300, () => gs.resolve({ ...acc, roles: ['ACCMGR'] }, { docDate: '2026-10-15', supplierState: '36', recipientState: '27', lines: Array.from({ length: 10 }, (_, k) => ({ hsn: ['7214', '2523', '9954', '2517', '7308'][k % 5], taxable: 1000 + k })) }));

console.log('\nFilling 100 000 AP bills with GST and a GSTR-2B of 100 000 documents...');
db.exec('BEGIN');
const vendors = []; for (let v = 0; v < 500; v += 1) { const id = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'perf')").run(`V${v}`, `Vendor ${v}`).lastInsertRowid); const g = `36AABCV${String(v).padStart(4, '0')}A1Z${v % 10}`; db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, gstin, state_code, gstin_status, created_by) VALUES (1, ?, ?, '36', 'ACTIVE', 'perf')").run(id, g); vendors.push({ id, g }); }
const exp = acct('510001'); const insB = db.prepare("INSERT INTO ap_bills (company_id, doc_no, bill_source, partner_id, payee_name, bill_no, bill_date, due_date, expense_account_id, gross_paise, gst_input_paise, total_paise, net_payable_paise, org_project_id, status, created_by) VALUES (1, ?, 'DIRECT', ?, 'Vendor', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 'perf')");
const imp = Number(db.prepare("INSERT INTO gst_2b_imports (company_id, doc_no, period, gstin, file_name, file_format, created_by) VALUES (1, '2B/1', '2026-10', '36AAACM1234F1Z5', 'perf.json', 'JSON', 'perf')").run().lastInsertRowid);
const ins2 = db.prepare("INSERT INTO gst_2b_lines (company_id, import_id, period, line_hash, supplier_gstin, invoice_no, invoice_date, taxable_paise, cgst_paise, sgst_paise, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'perf')");
for (let i = 0; i < 100_000; i += 1) { const v = vendors[i % 500]; const period = `2026-${String(4 + (i % 7)).padStart(2, '0')}`; const date = `${period}-${String(1 + (i % 28)).padStart(2, '0')}`; const taxable = 100_000 + (i % 1000) * 100; const gst = Math.round(taxable * 0.18); insB.run(`AP/${i + 1}`, v.id, `B-${i + 1}`, date, date, exp, taxable, gst, taxable + gst, taxable + gst, projects[i % 50]); ins2.run(imp, period, `h${i}`, v.g, i % 20 === 0 ? `B-${i + 1}X` : `b/${i + 1}`, date, taxable, i % 25 === 0 ? Math.round(gst / 2) + 500 : Math.round(gst / 2), gst - Math.round(gst / 2)); }
db.exec('COMMIT'); db.exec('ANALYZE');
time('GSTR-2B match of a month (14 300 documents against the books)', 30_000, () => gr.match(1, '2026-10'), 1);
time('2B worklist of the month', 500, () => gr.recon.worklist(acc, { period: '2026-10', status: 'MISMATCH_AMOUNT' }), 10);
time('ITC review of the month (create and work out)', 30_000, () => gr.reviews.create(acc, { period: '2026-10' }), 1);

console.log('\nFilling 100 000 fixed assets...');
db.exec('BEGIN');
const insA = db.prepare("INSERT INTO fa_assets (company_id, doc_no, class_code, description, cost_paise, cap_date, org_project_id, cap_source, useful_life_months, residual_paise, book_method, tax_block, tax_rate_bp, accumulated_dep_paise, wdv_paise, fy_base_paise, fy_base_year, asset_state, status, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, 'OPENING', ?, ?, ?, 'PM_GENERAL', 1500, 0, ?, ?, '2026-27', ?, 'APPROVED', 'perf')");
for (let i = 0; i < 100_000; i += 1) { const cost = 10_000_000 + (i % 1000) * 10_000; insA.run(`FA/${i + 1}`, i % 3 ? 'PM_CONSTRUCTION' : 'VEHICLE', `Asset ${i + 1}`, cost, '2026-04-01', projects[i % 50], i % 3 ? 144 : 96, Math.round(cost * 0.05), i % 3 ? 'SLM' : 'WDV', cost, cost, i < 10_000 ? 'IN_USE' : 'DISPOSED'); }
db.exec("UPDATE fa_assets SET disposed_on = '2026-04-01' WHERE asset_state = 'DISPOSED'");
db.exec('COMMIT'); db.exec('ANALYZE');
time('asset list, first page', 500, () => fa.assets.list(acc, {}));
time('asset list, in use, a class', 500, () => fa.assets.list(acc, { 'filter[state]': 'IN_USE', 'filter[classCode]': 'VEHICLE' }));
time('one asset with its schedule', 300, (i) => fa.assets.get(acc, 1 + i * 13));
time('depreciation preview of a month (10 000 assets in use)', 5_000, () => fa.depreciation.preview(acc, { period: '2026-04' }), 3);
time('depreciation run of a month (10 000 assets, one journal)', 30_000, () => fa.depreciation.run(acc, { period: '2026-04' }), 1);
time('fixed asset schedule of the year (100 000 assets)', 30_000, () => fa.schedule(acc, { fy: '2026-27' }), 1);

console.log('\nQuery plans:');
const plan = (label, sql) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()) console.log(`    ${r.detail}`); };
plan('e-invoices failed', "SELECT x.* FROM gst_einvoices x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.einv_status = 'FAILED' ORDER BY x.id DESC LIMIT 25");
plan('e-way bills valid', "SELECT x.* FROM gst_ewaybills x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.ewb_status = 'ACTIVE' ORDER BY x.id DESC LIMIT 25");
plan('2B lines of a month by category', "SELECT * FROM gst_2b_lines WHERE company_id = 1 AND period = '2026-10' AND match_status = 'MISMATCH_AMOUNT'");
plan('assets in use', "SELECT x.* FROM fa_assets x WHERE x.company_id = 1 AND x.status = 'APPROVED' AND x.asset_state = 'IN_USE' AND x.cap_date <= '2026-04-30' AND x.deleted_at IS NULL");
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
